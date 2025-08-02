import { Request, Response } from 'express';
import { z } from 'zod';
import { Database } from '../config/database.js';
import { RedisManager } from '../config/redis.js';
import { CommitModel, CommitQuery } from '../models/Commit.js';
import { ProjectModel } from '../models/Project.js';
import { GitService, GitScanOptions } from '../services/GitService.js';
import { logger } from '../services/structuredLogger.js';
import { isValidCommitHash } from '../utils/gitUtils.js';

// Validation schemas
const GitScanRequestSchema = z.object({
  project_id: z.string().uuid(),
  branch: z.string().optional(),
  since: z.string().datetime().optional(),
  max_commits: z.number().int().min(1).max(5000).optional().default(1000),
  include_files: z.boolean().optional().default(true),
  include_diffs: z.boolean().optional().default(true),
  force_rescan: z.boolean().optional().default(false),
});

const CommitQueryRequestSchema = z.object({
  project_id: z.string().uuid(),
  limit: z.number().int().min(1).max(100).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  author: z.string().optional(),
  branch: z.string().optional(),
  file_path: z.string().optional(),
  change_type: z.enum(['A', 'M', 'D', 'R', 'C', 'T']).optional(),
  sort_by: z.enum(['committed_at', 'author_name', 'message']).optional().default('committed_at'),
  sort_order: z.enum(['asc', 'desc']).optional().default('desc'),
});

const RepoInfoRequestSchema = z.object({
  project_id: z.string().uuid(),
});

type GitScanRequest = z.infer<typeof GitScanRequestSchema>;
type CommitQueryRequest = z.infer<typeof CommitQueryRequestSchema>;
type RepoInfoRequest = z.infer<typeof RepoInfoRequestSchema>;

export class GitController {
  private db: Database;
  private redis: RedisManager;
  private gitService: GitService;
  private commitModel: CommitModel;
  private projectModel: ProjectModel;

  constructor(db: Database, redis: RedisManager) {
    this.db = db;
    this.redis = redis;
    this.gitService = new GitService(db);
    this.commitModel = new CommitModel(db);
    this.projectModel = new ProjectModel(db);
  }

  /**
   * Trigger git repository scan for a project
   * POST /api/git/scan
   */
  async scanRepository(req: Request, res: Response): Promise<void> {
    try {
      const data: GitScanRequest = GitScanRequestSchema.parse(req.body);
      
      logger.info('Git scan requested', {
        projectId: data.project_id,
        branch: data.branch,
        userId: (req as any).user?.id,
      });

      // Get project details
      const project = await this.projectModel.findById(data.project_id);
      if (!project) {
        res.status(404).json({
          success: false,
          error: 'Project not found',
        });
        return;
      }

      if (!project.git_repo_path) {
        res.status(400).json({
          success: false,
          error: 'Project does not have a git repository path configured',
        });
        return;
      }

      // Check if scan is already in progress
      const scanKey = `git_scan:${data.project_id}`;
      const scanInProgress = await this.redis.get(scanKey);
      
      if (scanInProgress && !data.force_rescan) {
        res.status(409).json({
          success: false,
          error: 'Git scan already in progress for this project',
          scan_id: scanInProgress,
        });
        return;
      }

      // Validate repository
      const repoInfo = await this.gitService.getRepositoryInfo(project.git_repo_path);
      if (!repoInfo.isValid) {
        res.status(400).json({
          success: false,
          error: 'Invalid git repository path',
          path: project.git_repo_path,
        });
        return;
      }

      // Generate scan ID and set progress flag
      const scanId = `scan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await this.redis.set(scanKey, scanId, 3600); // 1 hour expiry

      // Set up scan options
      const scanOptions: GitScanOptions = {
        projectId: data.project_id,
        repositoryPath: project.git_repo_path,
        branch: data.branch || repoInfo.currentBranch || 'main',
        since: data.since ? new Date(data.since) : undefined,
        maxCommits: data.max_commits,
        includeFiles: data.include_files,
        includeDiffs: data.include_diffs,
      };

      // Start background scan
      this.performGitScan(scanId, scanOptions, project.name)
        .catch(error => {
          logger.error('Background git scan failed', { scanId, error });
        });

      res.status(202).json({
        success: true,
        message: 'Git scan started',
        scan_id: scanId,
        project_id: data.project_id,
        repository_info: repoInfo,
        scan_options: scanOptions,
      });

    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: 'Invalid request data',
          details: error.errors,
        });
        return;
      }

      logger.error('Failed to start git scan', { error, body: req.body });
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }

  /**
   * Get git scan status
   * GET /api/git/scan/:scan_id/status
   */
  async getScanStatus(req: Request, res: Response): Promise<void> {
    try {
      const { scan_id } = req.params;
      
      const statusKey = `git_scan_status:${scan_id}`;
      const status = await this.redis.get(statusKey);

      if (!status) {
        res.status(404).json({
          success: false,
          error: 'Scan not found or expired',
        });
        return;
      }

      const parsedStatus = JSON.parse(status);
      
      res.json({
        success: true,
        scan_id,
        ...parsedStatus,
      });

    } catch (error) {
      logger.error('Failed to get scan status', { scanId: req.params.scan_id, error });
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }

  /**
   * Get commits for a project
   * GET /api/git/commits
   */
  async getCommits(req: Request, res: Response): Promise<void> {
    try {
      const queryData: CommitQueryRequest = CommitQueryRequestSchema.parse({
        ...req.query,
        project_id: req.query.project_id,
      });

      logger.info('Commits query requested', {
        projectId: queryData.project_id,
        limit: queryData.limit,
        offset: queryData.offset,
      });

      // Verify project exists
      const project = await this.projectModel.findById(queryData.project_id);
      if (!project) {
        res.status(404).json({
          success: false,
          error: 'Project not found',
        });
        return;
      }

      // Convert query data to CommitQuery format
      const commitQuery: Partial<CommitQuery> = {
        project_id: queryData.project_id,
        limit: queryData.limit,
        offset: queryData.offset,
        since: queryData.since ? new Date(queryData.since) : undefined,
        until: queryData.until ? new Date(queryData.until) : undefined,
        author: queryData.author,
        branch: queryData.branch,
        file_path: queryData.file_path,
        change_type: queryData.change_type,
        sort_by: queryData.sort_by,
        sort_order: queryData.sort_order,
      };

      // Check cache first
      const cacheKey = `commits:${JSON.stringify(commitQuery)}`;
      const cachedResult = await this.redis.get(cacheKey);
      
      if (cachedResult) {
        res.json({
          success: true,
          cached: true,
          ...JSON.parse(cachedResult),
        });
        return;
      }

      // Get commits from database
      const result = await this.commitModel.findByProject(commitQuery);

      // Cache result for 5 minutes
      await this.redis.set(cacheKey, JSON.stringify(result), 300);

      res.json({
        success: true,
        project_id: queryData.project_id,
        query: commitQuery,
        pagination: {
          limit: queryData.limit,
          offset: queryData.offset,
          total: result.total,
          has_more: queryData.offset + queryData.limit < result.total,
        },
        commits: result.commits,
      });

    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: 'Invalid query parameters',
          details: error.errors,
        });
        return;
      }

      logger.error('Failed to get commits', { error, query: req.query });
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }

  /**
   * Get specific commit details with files
   * GET /api/git/commits/:commit_id
   */
  async getCommitDetails(req: Request, res: Response): Promise<void> {
    try {
      const { commit_id } = req.params;
      const includeFiles = req.query.include_files !== 'false';

      if (!isValidCommitHash(commit_id)) {
        res.status(400).json({
          success: false,
          error: 'Invalid commit hash format',
        });
        return;
      }

      logger.info('Commit details requested', {
        commitId: commit_id,
        includeFiles,
      });

      // Check cache first
      const cacheKey = `commit:${commit_id}:${includeFiles}`;
      const cachedCommit = await this.redis.get(cacheKey);
      
      if (cachedCommit) {
        res.json({
          success: true,
          cached: true,
          commit: JSON.parse(cachedCommit),
        });
        return;
      }

      // Get commit from database
      const commit = await this.commitModel.findById(commit_id, includeFiles);

      if (!commit) {
        res.status(404).json({
          success: false,
          error: 'Commit not found',
        });
        return;
      }

      // Cache result for 1 hour
      await this.redis.set(cacheKey, JSON.stringify(commit), 3600);

      res.json({
        success: true,
        commit,
      });

    } catch (error) {
      logger.error('Failed to get commit details', { 
        commitId: req.params.commit_id, 
        error 
      });
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }

  /**
   * Get repository information and statistics
   * GET /api/git/repository/info
   */
  async getRepositoryInfo(req: Request, res: Response): Promise<void> {
    try {
      const queryData: RepoInfoRequest = RepoInfoRequestSchema.parse(req.query);

      logger.info('Repository info requested', {
        projectId: queryData.project_id,
      });

      // Get project
      const project = await this.projectModel.findById(queryData.project_id);
      if (!project) {
        res.status(404).json({
          success: false,
          error: 'Project not found',
        });
        return;
      }

      if (!project.git_repo_path) {
        res.status(400).json({
          success: false,
          error: 'Project does not have a git repository configured',
        });
        return;
      }

      // Check cache first
      const cacheKey = `repo_info:${queryData.project_id}`;
      const cachedInfo = await this.redis.get(cacheKey);
      
      if (cachedInfo) {
        res.json({
          success: true,
          cached: true,
          ...JSON.parse(cachedInfo),
        });
        return;
      }

      // Get repository info
      const repoInfo = await this.gitService.getRepositoryInfo(project.git_repo_path);
      
      // Get commit statistics
      const stats = await this.commitModel.getCommitStats(queryData.project_id);

      const result = {
        project_id: queryData.project_id,
        repository_path: project.git_repo_path,
        repository_info: repoInfo,
        commit_stats: stats,
      };

      // Cache for 10 minutes
      await this.redis.set(cacheKey, JSON.stringify(result), 600);

      res.json({
        success: true,
        ...result,
      });

    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: 'Invalid query parameters',
          details: error.errors,
        });
        return;
      }

      logger.error('Failed to get repository info', { error, query: req.query });
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }

  /**
   * Get commits by author
   * GET /api/git/authors/:author/commits
   */
  async getCommitsByAuthor(req: Request, res: Response): Promise<void> {
    try {
      const { author } = req.params;
      const { project_id } = req.query;
      const limit = parseInt(req.query.limit as string) || 20;

      if (!project_id || typeof project_id !== 'string') {
        res.status(400).json({
          success: false,
          error: 'project_id is required',
        });
        return;
      }

      logger.info('Commits by author requested', {
        author,
        projectId: project_id,
        limit,
      });

      const commits = await this.commitModel.getCommitsByAuthor(project_id, author, limit);

      res.json({
        success: true,
        project_id,
        author,
        commits,
      });

    } catch (error) {
      logger.error('Failed to get commits by author', { 
        author: req.params.author,
        error 
      });
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }

  /**
   * Get recent commits for a project
   * GET /api/git/recent
   */
  async getRecentCommits(req: Request, res: Response): Promise<void> {
    try {
      const { project_id } = req.query;
      const limit = parseInt(req.query.limit as string) || 10;

      if (!project_id || typeof project_id !== 'string') {
        res.status(400).json({
          success: false,
          error: 'project_id is required',
        });
        return;
      }

      logger.info('Recent commits requested', {
        projectId: project_id,
        limit,
      });

      // Check cache first
      const cacheKey = `recent_commits:${project_id}:${limit}`;
      const cachedCommits = await this.redis.get(cacheKey);
      
      if (cachedCommits) {
        res.json({
          success: true,
          cached: true,
          project_id,
          commits: JSON.parse(cachedCommits),
        });
        return;
      }

      const commits = await this.commitModel.getRecentCommits(project_id, limit);

      // Cache for 2 minutes
      await this.redis.set(cacheKey, JSON.stringify(commits), 120);

      res.json({
        success: true,
        project_id,
        commits,
      });

    } catch (error) {
      logger.error('Failed to get recent commits', { error, query: req.query });
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }

  /**
   * Background git scan implementation
   */
  private async performGitScan(
    scanId: string,
    options: GitScanOptions,
    projectName: string
  ): Promise<void> {
    const statusKey = `git_scan_status:${scanId}`;
    const progressKey = `git_scan:${options.projectId}`;

    try {
      // Update status to running
      await this.redis.set(statusKey, JSON.stringify({
        status: 'running',
        started_at: new Date().toISOString(),
        project_id: options.projectId,
        project_name: projectName,
        options,
      }), 3600);

      logger.info('Starting git scan', { scanId, options });

      // Perform the scan
      const results = await this.gitService.scanRepository(options);

      // Update final status
      await this.redis.set(statusKey, JSON.stringify({
        status: 'completed',
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        project_id: options.projectId,
        project_name: projectName,
        results,
        options,
      }), 3600);

      logger.info('Git scan completed', { scanId, results });

      // Clear progress flag
      await this.redis.delete(progressKey);

      // Invalidate relevant caches
      await this.invalidateProjectCaches(options.projectId);

    } catch (error) {
      logger.error('Git scan failed', { scanId, error });

      // Update status to failed
      await this.redis.set(statusKey, JSON.stringify({
        status: 'failed',
        started_at: new Date().toISOString(),
        failed_at: new Date().toISOString(),
        project_id: options.projectId,
        project_name: projectName,
        error: error instanceof Error ? error.message : 'Unknown error',
        options,
      }), 3600);

      // Clear progress flag
      await this.redis.delete(progressKey);
    }
  }

  /**
   * Invalidate caches related to a project
   */
  private async invalidateProjectCaches(projectId: string): Promise<void> {
    try {
      const keys = await this.redis.keys([
        `commits:*"project_id":"${projectId}"*`,
        `commit:*`,
        `recent_commits:${projectId}:*`,
        `repo_info:${projectId}`,
      ]);

      if (keys.length > 0) {
        await this.redis.deleteMany(keys);
        logger.info('Invalidated project caches', { projectId, keyCount: keys.length });
      }
    } catch (error) {
      logger.warn('Failed to invalidate caches', { projectId, error });
    }
  }
}
