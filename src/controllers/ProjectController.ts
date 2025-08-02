import { Request, Response } from 'express';
import { ProjectModel, CreateProjectData, UpdateProjectData, ProjectQuery } from '../models/Project.js';
import { Database } from '../config/database.js';
import { RedisManager } from '../config/redis.js';
import { logger } from '../services/structuredLogger.js';
import { z } from 'zod';
import { existsSync, statSync } from 'fs';
import { resolve } from 'path';

export class ProjectController {
  private projectModel: ProjectModel;
  private redis: RedisManager;

  constructor(db: Database, redis: RedisManager) {
    this.projectModel = new ProjectModel(db);
    this.redis = redis;
  }

  /**
   * Create a new project
   * POST /api/projects
   */
  async create(req: Request, res: Response): Promise<void> {
    try {
      const data: CreateProjectData = req.body;

      // Validate repo path exists and is accessible
      const repoValidation = await this.validateRepoPath(data.repo_path);
      if (!repoValidation.valid) {
        res.status(400).json({
          success: false,
          error: 'Invalid repository path',
          details: repoValidation.error,
        });
        return;
      }

      // Check if repo path is already used by another project
      const isRepoPathUnique = await this.projectModel.validateRepoPath(data.repo_path);
      if (!isRepoPathUnique) {
        res.status(409).json({
          success: false,
          error: 'Repository path already in use',
          details: { repo_path: data.repo_path },
        });
        return;
      }

      // Create project
      const project = await this.projectModel.create(data);

      // Cache project for quick access
      await this.redis.set(`project:${project.id}`, project, 3600);

      // Trigger initial git scan if auto_scan is enabled
      if (project.config.git?.auto_scan_enabled !== false) {
        await this.redis.enqueueJob('git-scan', {
          projectId: project.id,
          repoPath: project.repo_path,
          type: 'initial_scan',
        });
      }

      res.status(201).json({
        success: true,
        message: 'Project created successfully',
        project,
      });

    } catch (error) {
      logger.error('Failed to create project', { body: req.body, error });
      
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: 'Validation error',
          details: error.errors,
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Internal server error',
          message: 'Failed to create project',
        });
      }
    }
  }

  /**
   * Get all projects with pagination and search
   * GET /api/projects
   */
  async findAll(req: Request, res: Response): Promise<void> {
    try {
      const queryParams: Partial<ProjectQuery> = {
        limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
        offset: req.query.offset ? parseInt(req.query.offset as string) : undefined,
        search: req.query.search as string,
        sort_by: req.query.sort_by as any,
        sort_order: req.query.sort_order as any,
      };

      const result = await this.projectModel.findAll(queryParams);

      res.json({
        success: true,
        projects: result.projects,
        pagination: {
          total: result.total,
          limit: queryParams.limit || 20,
          offset: queryParams.offset || 0,
          pages: Math.ceil(result.total / (queryParams.limit || 20)),
        },
      });

    } catch (error) {
      logger.error('Failed to fetch projects', { query: req.query, error });
      
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: 'Invalid query parameters',
          details: error.errors,
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Internal server error',
          message: 'Failed to fetch projects',
        });
      }
    }
  }

  /**
   * Get project by ID
   * GET /api/projects/:id
   */
  async findById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const includeStats = req.query.stats === 'true';

      // Try cache first
      let project = await this.redis.get(`project:${id}`);

      if (!project) {
        // Fetch from database
        if (includeStats) {
          project = await this.projectModel.getWithStats(id);
        } else {
          project = await this.projectModel.findById(id);
        }

        if (project) {
          // Cache for future requests
          await this.redis.set(`project:${id}`, project, 3600);
        }
      }

      if (!project) {
        res.status(404).json({
          success: false,
          error: 'Project not found',
          project_id: id,
        });
        return;
      }

      res.json({
        success: true,
        project,
      });

    } catch (error) {
      logger.error('Failed to fetch project', { id: req.params.id, error });
      
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: 'Failed to fetch project',
      });
    }
  }

  /**
   * Update project
   * PUT /api/projects/:id
   */
  async update(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const data: Partial<CreateProjectData> = req.body;

      // If repo_path is being updated, validate it
      if (data.repo_path) {
        const repoValidation = await this.validateRepoPath(data.repo_path);
        if (!repoValidation.valid) {
          res.status(400).json({
            success: false,
            error: 'Invalid repository path',
            details: repoValidation.error,
          });
          return;
        }

        // Check uniqueness (excluding current project)
        const isRepoPathUnique = await this.projectModel.validateRepoPath(data.repo_path, id);
        if (!isRepoPathUnique) {
          res.status(409).json({
            success: false,
            error: 'Repository path already in use',
            details: { repo_path: data.repo_path },
          });
          return;
        }
      }

      const project = await this.projectModel.update(id, data);

      if (!project) {
        res.status(404).json({
          success: false,
          error: 'Project not found',
          project_id: id,
        });
        return;
      }

      // Update cache
      await this.redis.set(`project:${id}`, project, 3600);

      // Trigger git rescan if repo path changed
      if (data.repo_path) {
        await this.redis.enqueueJob('git-scan', {
          projectId: id,
          repoPath: data.repo_path,
          type: 'repo_path_changed',
        });
      }

      res.json({
        success: true,
        message: 'Project updated successfully',
        project,
      });

    } catch (error) {
      logger.error('Failed to update project', { id: req.params.id, body: req.body, error });
      
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: 'Validation error',
          details: error.errors,
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Internal server error',
          message: 'Failed to update project',
        });
      }
    }
  }

  /**
   * Delete project
   * DELETE /api/projects/:id
   */
  async delete(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const force = req.query.force === 'true';

      // Check if project exists
      const project = await this.projectModel.findById(id);
      if (!project) {
        res.status(404).json({
          success: false,
          error: 'Project not found',
          project_id: id,
        });
        return;
      }

      // Check for related data if not forcing deletion
      if (!force) {
        const projectWithStats = await this.projectModel.getWithStats(id);
        const hasData = projectWithStats && (
          projectWithStats.stats.total_commits > 0 ||
          projectWithStats.stats.total_memories > 0 ||
          projectWithStats.stats.total_tasks > 0 ||
          projectWithStats.stats.active_sessions > 0
        );

        if (hasData) {
          res.status(409).json({
            success: false,
            error: 'Project has related data',
            message: 'Use force=true to delete project with all related data',
            stats: projectWithStats?.stats,
          });
          return;
        }
      }

      const deleted = await this.projectModel.delete(id);

      if (!deleted) {
        res.status(404).json({
          success: false,
          error: 'Project not found',
          project_id: id,
        });
        return;
      }

      // Remove from cache
      await this.redis.del(`project:${id}`);

      // Enqueue cleanup job for related data
      await this.redis.enqueueJob('cleanup', {
        projectId: id,
        type: 'project_deleted',
      });

      res.json({
        success: true,
        message: 'Project deleted successfully',
        project_id: id,
      });

    } catch (error) {
      logger.error('Failed to delete project', { id: req.params.id, error });
      
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: 'Failed to delete project',
      });
    }
  }

  /**
   * Get project activity summary
   * GET /api/projects/:id/activity
   */
  async getActivity(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const days = parseInt(req.query.days as string) || 7;

      // This would typically aggregate activity from various tables
      // For now, return a placeholder structure
      const activity = {
        project_id: id,
        period_days: days,
        summary: {
          commits: 0,
          memories_created: 0,
          tasks_completed: 0,
          handoffs: 0,
        },
        timeline: [], // Array of daily activity
      };

      res.json({
        success: true,
        activity,
      });

    } catch (error) {
      logger.error('Failed to fetch project activity', { id: req.params.id, error });
      
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: 'Failed to fetch project activity',
      });
    }
  }

  /**
   * Trigger manual git scan
   * POST /api/projects/:id/scan
   */
  async triggerGitScan(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { branch, since } = req.body;

      const project = await this.projectModel.findById(id);
      if (!project) {
        res.status(404).json({
          success: false,
          error: 'Project not found',
          project_id: id,
        });
        return;
      }

      // Enqueue git scan job
      await this.redis.enqueueJob('git-scan', {
        projectId: id,
        repoPath: project.repo_path,
        branch: branch || 'main',
        since: since ? new Date(since) : undefined,
        type: 'manual_scan',
      });

      res.json({
        success: true,
        message: 'Git scan triggered successfully',
        project_id: id,
      });

    } catch (error) {
      logger.error('Failed to trigger git scan', { id: req.params.id, body: req.body, error });
      
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: 'Failed to trigger git scan',
      });
    }
  }

  /**
   * Validate repository path
   */
  private async validateRepoPath(repoPath: string): Promise<{ valid: boolean; error?: string }> {
    try {
      const resolvedPath = resolve(repoPath);

      // Check if path exists
      if (!existsSync(resolvedPath)) {
        return {
          valid: false,
          error: 'Repository path does not exist',
        };
      }

      // Check if it's a directory
      const stats = statSync(resolvedPath);
      if (!stats.isDirectory()) {
        return {
          valid: false,
          error: 'Repository path is not a directory',
        };
      }

      // Check if it's a git repository (has .git directory)
      const gitPath = resolve(resolvedPath, '.git');
      if (!existsSync(gitPath)) {
        return {
          valid: false,
          error: 'Directory is not a git repository (no .git directory found)',
        };
      }

      return { valid: true };

    } catch (error) {
      logger.error('Error validating repo path', { repoPath, error });
      return {
        valid: false,
        error: 'Failed to validate repository path',
      };
    }
  }
}

// Middleware for parameter validation
export const validateProjectId = (req: Request, res: Response, next: Function): void => {
  const { id } = req.params;
  
  if (!id) {
    res.status(400).json({
      success: false,
      error: 'Project ID is required',
    });
    return;
  }

  // Basic UUID validation
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) {
    res.status(400).json({
      success: false,
      error: 'Invalid project ID format',
      project_id: id,
    });
    return;
  }

  next();
};
