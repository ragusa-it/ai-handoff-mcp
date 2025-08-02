import { z } from 'zod';
import { Database } from '../config/database.js';
import { logger } from '../services/structuredLogger.js';

// Validation Schemas
export const ProjectConfigSchema = z.object({
  memory: z.object({
    semantic_search_enabled: z.boolean().default(true),
    embedding_model: z.enum(['openai', 'sentence-transformers', 'custom']).default('openai'),
    memory_retention_days: z.number().int().min(1).max(365).default(90),
    auto_consolidation: z.boolean().default(true),
    consolidation_threshold: z.number().int().min(5).max(100).default(20),
  }).optional(),
  
  steering: z.object({
    default_persona: z.string().default('general'),
    constraint_enforcement: z.enum(['strict', 'flexible', 'advisory']).default('flexible'),
    user_preference_learning: z.boolean().default(true),
    dynamic_prompting: z.boolean().default(true),
  }).optional(),
  
  handoff: z.object({
    default_workflow: z.string().default('standard'),
    auto_filtering: z.boolean().default(true),
    privacy_mode: z.enum(['strict', 'balanced', 'permissive']).default('balanced'),
    audit_required: z.boolean().default(false),
  }).optional(),
  
  collaboration: z.object({
    multi_user_enabled: z.boolean().default(false),
    real_time_sync: z.boolean().default(false),
    access_control: z.enum(['owner', 'rbac', 'custom']).default('owner'),
  }).optional(),
  
  git: z.object({
    auto_scan_enabled: z.boolean().default(true),
    scan_interval_hours: z.number().int().min(1).max(168).default(24),
    track_branches: z.array(z.string()).default(['main', 'master', 'develop']),
    ignore_patterns: z.array(z.string()).default(['node_modules/**', '*.log', '.env*']),
    max_commit_history: z.number().int().min(100).max(10000).default(1000),
  }).optional(),
}).default({});

export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(255).trim(),
  description: z.string().max(1000).optional(),
  repo_path: z.string().min(1).trim(),
  config: ProjectConfigSchema,
});

export const UpdateProjectSchema = CreateProjectSchema.partial().extend({
  id: z.string().uuid(),
});

export const ProjectQuerySchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
  search: z.string().optional(),
  sort_by: z.enum(['name', 'created_at', 'updated_at']).default('updated_at'),
  sort_order: z.enum(['asc', 'desc']).default('desc'),
});

// TypeScript Types
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
export type CreateProjectData = z.infer<typeof CreateProjectSchema>;
export type UpdateProjectData = z.infer<typeof UpdateProjectSchema>;
export type ProjectQuery = z.infer<typeof ProjectQuerySchema>;

export interface Project {
  id: string;
  name: string;
  description?: string;
  repo_path: string;
  config: ProjectConfig;
  created_at: Date;
  updated_at: Date;
  
  // Computed fields
  total_commits?: number;
  total_memories?: number;
  last_scan_at?: Date;
  scan_status?: 'idle' | 'scanning' | 'error';
}

export interface ProjectWithStats extends Project {
  stats: {
    total_commits: number;
    total_memories: number;
    total_tasks: number;
    active_sessions: number;
    last_activity_at?: Date;
  };
}

// Database Operations
export class ProjectModel {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async create(data: CreateProjectData): Promise<Project> {
    const validatedData = CreateProjectSchema.parse(data);
    
    const query = `
      INSERT INTO projects (name, description, repo_path, config)
      VALUES ($1, $2, $3, $4)
      RETURNING id, name, description, repo_path, config, created_at, updated_at
    `;

    try {
      const result = await this.db.query(query, [
        validatedData.name,
        validatedData.description,
        validatedData.repo_path,
        JSON.stringify(validatedData.config),
      ]);

      const project = result.rows[0];
      project.config = JSON.parse(project.config);

      logger.info('Project created', { 
        projectId: project.id, 
        name: project.name,
        repoPath: project.repo_path 
      });

      return project;
    } catch (error) {
      logger.error('Failed to create project', { data: validatedData, error });
      throw error;
    }
  }

  async findById(id: string): Promise<Project | null> {
    const query = `
      SELECT id, name, description, repo_path, config, created_at, updated_at
      FROM projects 
      WHERE id = $1
    `;

    try {
      const result = await this.db.query(query, [id]);
      
      if (result.rows.length === 0) {
        return null;
      }

      const project = result.rows[0];
      project.config = JSON.parse(project.config);
      
      return project;
    } catch (error) {
      logger.error('Failed to find project by ID', { id, error });
      throw error;
    }
  }

  async findByRepoPath(repoPath: string): Promise<Project | null> {
    const query = `
      SELECT id, name, description, repo_path, config, created_at, updated_at
      FROM projects 
      WHERE repo_path = $1
    `;

    try {
      const result = await this.db.query(query, [repoPath]);
      
      if (result.rows.length === 0) {
        return null;
      }

      const project = result.rows[0];
      project.config = JSON.parse(project.config);
      
      return project;
    } catch (error) {
      logger.error('Failed to find project by repo path', { repoPath, error });
      throw error;
    }
  }

  async findAll(queryParams: Partial<ProjectQuery> = {}): Promise<{ projects: Project[]; total: number }> {
    const validatedQuery = ProjectQuerySchema.parse(queryParams);
    
    let whereClause = '';
    let queryValues: any[] = [];
    
    if (validatedQuery.search) {
      whereClause = `WHERE name ILIKE $1 OR description ILIKE $1`;
      queryValues.push(`%${validatedQuery.search}%`);
    }

    const countQuery = `SELECT COUNT(*) FROM projects ${whereClause}`;
    const dataQuery = `
      SELECT id, name, description, repo_path, config, created_at, updated_at
      FROM projects 
      ${whereClause}
      ORDER BY ${validatedQuery.sort_by} ${validatedQuery.sort_order}
      LIMIT $${queryValues.length + 1} OFFSET $${queryValues.length + 2}
    `;

    try {
      const [countResult, dataResult] = await Promise.all([
        this.db.query(countQuery, queryValues),
        this.db.query(dataQuery, [...queryValues, validatedQuery.limit, validatedQuery.offset]),
      ]);

      const projects = dataResult.rows.map((row: any) => ({
        ...row,
        config: JSON.parse(row.config),
      }));

      return {
        projects,
        total: parseInt(countResult.rows[0].count),
      };
    } catch (error) {
      logger.error('Failed to find projects', { queryParams, error });
      throw error;
    }
  }

  async update(id: string, data: Partial<CreateProjectData>): Promise<Project | null> {
    const validatedData = UpdateProjectSchema.parse({ ...data, id });
    
    const updateFields: string[] = [];
    const updateValues: any[] = [];
    let paramCount = 1;

    if (validatedData.name !== undefined) {
      updateFields.push(`name = $${paramCount++}`);
      updateValues.push(validatedData.name);
    }

    if (validatedData.description !== undefined) {
      updateFields.push(`description = $${paramCount++}`);
      updateValues.push(validatedData.description);
    }

    if (validatedData.repo_path !== undefined) {
      updateFields.push(`repo_path = $${paramCount++}`);
      updateValues.push(validatedData.repo_path);
    }

    if (validatedData.config !== undefined) {
      updateFields.push(`config = $${paramCount++}`);
      updateValues.push(JSON.stringify(validatedData.config));
    }

    if (updateFields.length === 0) {
      return this.findById(id);
    }

    updateFields.push(`updated_at = NOW()`);
    updateValues.push(id);

    const query = `
      UPDATE projects 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING id, name, description, repo_path, config, created_at, updated_at
    `;

    try {
      const result = await this.db.query(query, updateValues);
      
      if (result.rows.length === 0) {
        return null;
      }

      const project = result.rows[0];
      project.config = JSON.parse(project.config);

      logger.info('Project updated', { 
        projectId: project.id, 
        updatedFields: Object.keys(data) 
      });

      return project;
    } catch (error) {
      logger.error('Failed to update project', { id, data, error });
      throw error;
    }
  }

  async delete(id: string): Promise<boolean> {
    const query = 'DELETE FROM projects WHERE id = $1';

    try {
      const result = await this.db.query(query, [id]);
      
      logger.info('Project deleted', { projectId: id });
      
      return result.rowCount > 0;
    } catch (error) {
      logger.error('Failed to delete project', { id, error });
      throw error;
    }
  }

  async getWithStats(id: string): Promise<ProjectWithStats | null> {
    const query = `
      SELECT 
        p.id, p.name, p.description, p.repo_path, p.config, p.created_at, p.updated_at,
        COALESCE(commit_count.total, 0) as total_commits,
        COALESCE(memory_count.total, 0) as total_memories,
        COALESCE(task_count.total, 0) as total_tasks,
        COALESCE(session_count.total, 0) as active_sessions,
        last_activity.last_activity_at
      FROM projects p
      LEFT JOIN (
        SELECT project_id, COUNT(*) as total 
        FROM commits 
        WHERE project_id = $1 
        GROUP BY project_id
      ) commit_count ON p.id = commit_count.project_id
      LEFT JOIN (
        SELECT project_id, COUNT(*) as total 
        FROM memories 
        WHERE project_id = $1 
        GROUP BY project_id
      ) memory_count ON p.id = memory_count.project_id
      LEFT JOIN (
        SELECT project_id, COUNT(*) as total 
        FROM tasks 
        WHERE project_id = $1 AND status != 'completed'
        GROUP BY project_id
      ) task_count ON p.id = task_count.project_id
      LEFT JOIN (
        SELECT project_id, COUNT(*) as total
        FROM sessions 
        WHERE project_id = $1 AND status = 'active'
        GROUP BY project_id
      ) session_count ON p.id = session_count.project_id
      LEFT JOIN (
        SELECT project_id, MAX(updated_at) as last_activity_at
        FROM (
          SELECT project_id, updated_at FROM memories WHERE project_id = $1
          UNION ALL
          SELECT project_id, updated_at FROM tasks WHERE project_id = $1
          UNION ALL
          SELECT project_id, updated_at FROM sessions WHERE project_id = $1
        ) activities
        GROUP BY project_id
      ) last_activity ON p.id = last_activity.project_id
      WHERE p.id = $1
    `;

    try {
      const result = await this.db.query(query, [id]);
      
      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        repo_path: row.repo_path,
        config: JSON.parse(row.config),
        created_at: row.created_at,
        updated_at: row.updated_at,
        stats: {
          total_commits: parseInt(row.total_commits) || 0,
          total_memories: parseInt(row.total_memories) || 0,
          total_tasks: parseInt(row.total_tasks) || 0,
          active_sessions: parseInt(row.active_sessions) || 0,
          last_activity_at: row.last_activity_at,
        },
      };
    } catch (error) {
      logger.error('Failed to get project with stats', { id, error });
      throw error;
    }
  }

  async validateRepoPath(repoPath: string, excludeProjectId?: string): Promise<boolean> {
    let query = 'SELECT COUNT(*) FROM projects WHERE repo_path = $1';
    const values: any[] = [repoPath];

    if (excludeProjectId) {
      query += ' AND id != $2';
      values.push(excludeProjectId);
    }

    try {
      const result = await this.db.query(query, values);
      return parseInt(result.rows[0].count) === 0;
    } catch (error) {
      logger.error('Failed to validate repo path', { repoPath, excludeProjectId, error });
      throw error;
    }
  }
}
