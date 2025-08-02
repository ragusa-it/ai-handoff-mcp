import { z } from 'zod';
import { Database } from '../config/database.js';
import { logger } from '../services/structuredLogger.js';

// Validation Schemas
export const CommitSchema = z.object({
  id: z.string().length(40, 'Commit hash must be 40 characters'), // Git SHA-1 hash
  project_id: z.string().uuid(),
  author_name: z.string().min(1).max(255),
  author_email: z.string().email().max(255),
  committed_at: z.date(),
  message: z.string().min(1),
  parents: z.array(z.string().length(40)).default([]),
  branches: z.array(z.string()).default([]),
  metadata: z.record(z.any()).default({}),
});

export const CommitFileSchema = z.object({
  commit_id: z.string().length(40),
  path: z.string().min(1),
  change_type: z.enum(['A', 'M', 'D', 'R', 'C', 'T']), // Added, Modified, Deleted, Renamed, Copied, Type changed
  language: z.string().max(50).optional(),
  added_lines: z.number().int().min(0).default(0),
  removed_lines: z.number().int().min(0).default(0),
  hunk_preview: z.string().optional(),
});

export const CreateCommitSchema = CommitSchema.omit({ 
  metadata: true 
}).extend({
  metadata: z.record(z.any()).optional().default({}),
});

export const CreateCommitFileSchema = CommitFileSchema;

export const CommitQuerySchema = z.object({
  project_id: z.string().uuid(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
  since: z.date().optional(),
  until: z.date().optional(),
  author: z.string().optional(),
  branch: z.string().optional(),
  file_path: z.string().optional(),
  change_type: z.enum(['A', 'M', 'D', 'R', 'C', 'T']).optional(),
  sort_by: z.enum(['committed_at', 'author_name', 'message']).default('committed_at'),
  sort_order: z.enum(['asc', 'desc']).default('desc'),
});

// TypeScript Types
export type Commit = z.infer<typeof CommitSchema>;
export type CommitFile = z.infer<typeof CommitFileSchema>;
export type CreateCommitData = z.infer<typeof CreateCommitSchema>;
export type CreateCommitFileData = z.infer<typeof CreateCommitFileSchema>;
export type CommitQuery = z.infer<typeof CommitQuerySchema>;

export interface CommitWithFiles extends Commit {
  files: CommitFile[];
  stats: {
    total_files: number;
    added_lines: number;
    removed_lines: number;
    languages: Record<string, number>; // language -> file count
  };
}

export interface CommitSummary {
  commit_id: string;
  project_id: string;
  author_name: string;
  committed_at: Date;
  message: string;
  file_count: number;
  added_lines: number;
  removed_lines: number;
  is_merge: boolean;
  is_conventional: boolean;
  conventional_type?: string;
  breaking_change: boolean;
}

// Database Operations
export class CommitModel {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async create(commitData: CreateCommitData, files: CreateCommitFileData[] = []): Promise<CommitWithFiles> {
    const validatedCommit = CreateCommitSchema.parse(commitData);
    const validatedFiles = files.map(file => CreateCommitFileSchema.parse(file));

    const result = await this.db.transaction(async (client) => {
      // Insert commit
      const commitQuery = `
        INSERT INTO commits (id, project_id, author_name, author_email, committed_at, message, parents, branches, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO UPDATE SET
          branches = EXCLUDED.branches,
          metadata = EXCLUDED.metadata
        RETURNING *
      `;

      const commitResult = await client.query(commitQuery, [
        validatedCommit.id,
        validatedCommit.project_id,
        validatedCommit.author_name,
        validatedCommit.author_email,
        validatedCommit.committed_at,
        validatedCommit.message,
        validatedCommit.parents,
        validatedCommit.branches,
        JSON.stringify(validatedCommit.metadata),
      ]);

      const commit = commitResult.rows[0];
      commit.metadata = JSON.parse(commit.metadata);

      // Insert commit files
      const insertedFiles: CommitFile[] = [];
      if (validatedFiles.length > 0) {
        const fileValues = validatedFiles.map((file, index) => {
          const baseIndex = index * 7;
          return `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5}, $${baseIndex + 6}, $${baseIndex + 7})`;
        }).join(', ');

        const fileParams = validatedFiles.flatMap(file => [
          file.commit_id,
          file.path,
          file.change_type,
          file.language,
          file.added_lines,
          file.removed_lines,
          file.hunk_preview,
        ]);

        const filesQuery = `
          INSERT INTO commit_files (commit_id, path, change_type, language, added_lines, removed_lines, hunk_preview)
          VALUES ${fileValues}
          ON CONFLICT (commit_id, path) DO UPDATE SET
            change_type = EXCLUDED.change_type,
            language = EXCLUDED.language,
            added_lines = EXCLUDED.added_lines,
            removed_lines = EXCLUDED.removed_lines,
            hunk_preview = EXCLUDED.hunk_preview
          RETURNING *
        `;

        const filesResult = await client.query(filesQuery, fileParams);
        insertedFiles.push(...filesResult.rows);
      }

      // Calculate statistics
      const stats = this.calculateCommitStats(insertedFiles);

      return {
        ...commit,
        files: insertedFiles,
        stats,
      };
    });

    logger.info('Commit created/updated', {
      commitId: result.id,
      projectId: result.project_id,
      fileCount: result.files.length,
      author: result.author_name,
    });

    return result;
  }

  async findById(commitId: string, includeFiles = false): Promise<CommitWithFiles | null> {
    const query = `
      SELECT id, project_id, author_name, author_email, committed_at, message, parents, branches, metadata, created_at
      FROM commits 
      WHERE id = $1
    `;

    try {
      const result = await this.db.query(query, [commitId]);
      
      if (result.rows.length === 0) {
        return null;
      }

      const commit = result.rows[0];
      commit.metadata = JSON.parse(commit.metadata);

      let files: CommitFile[] = [];
      if (includeFiles) {
        files = await this.getCommitFiles(commitId);
      }

      const stats = this.calculateCommitStats(files);

      return {
        ...commit,
        files,
        stats,
      };
    } catch (error) {
      logger.error('Failed to find commit by ID', { commitId, error });
      throw error;
    }
  }

  async findByProject(queryParams: Partial<CommitQuery>): Promise<{ commits: CommitSummary[]; total: number }> {
    const validatedQuery = CommitQuerySchema.parse(queryParams);
    
    const conditions: string[] = ['c.project_id = $1'];
    const queryValues: any[] = [validatedQuery.project_id];
    let paramCount = 1;

    if (validatedQuery.since) {
      conditions.push(`c.committed_at >= $${++paramCount}`);
      queryValues.push(validatedQuery.since);
    }

    if (validatedQuery.until) {
      conditions.push(`c.committed_at <= $${++paramCount}`);
      queryValues.push(validatedQuery.until);
    }

    if (validatedQuery.author) {
      conditions.push(`c.author_name ILIKE $${++paramCount}`);
      queryValues.push(`%${validatedQuery.author}%`);
    }

    if (validatedQuery.branch) {
      conditions.push(`$${++paramCount} = ANY(c.branches)`);
      queryValues.push(validatedQuery.branch);
    }

    if (validatedQuery.file_path) {
      conditions.push(`EXISTS (
        SELECT 1 FROM commit_files cf 
        WHERE cf.commit_id = c.id AND cf.path ILIKE $${++paramCount}
      )`);
      queryValues.push(`%${validatedQuery.file_path}%`);
    }

    if (validatedQuery.change_type) {
      conditions.push(`EXISTS (
        SELECT 1 FROM commit_files cf 
        WHERE cf.commit_id = c.id AND cf.change_type = $${++paramCount}
      )`);
      queryValues.push(validatedQuery.change_type);
    }

    const whereClause = conditions.join(' AND ');
    
    const countQuery = `
      SELECT COUNT(DISTINCT c.id) 
      FROM commits c 
      WHERE ${whereClause}
    `;

    const dataQuery = `
      SELECT 
        c.id as commit_id,
        c.project_id,
        c.author_name,
        c.committed_at,
        c.message,
        c.parents,
        COALESCE(cf_stats.file_count, 0) as file_count,
        COALESCE(cf_stats.added_lines, 0) as added_lines,
        COALESCE(cf_stats.removed_lines, 0) as removed_lines,
        (array_length(c.parents, 1) > 1) as is_merge,
        (c.message ~ '^(feat|fix|docs|style|refactor|perf|test|chore|build|ci)(\(.+\))?!?:') as is_conventional,
        (c.message ~ '^(feat|fix|docs|style|refactor|perf|test|chore|build|ci)(\(.+\))?!:') as breaking_change
      FROM commits c
      LEFT JOIN (
        SELECT 
          commit_id,
          COUNT(*) as file_count,
          SUM(added_lines) as added_lines,
          SUM(removed_lines) as removed_lines
        FROM commit_files
        GROUP BY commit_id
      ) cf_stats ON c.id = cf_stats.commit_id
      WHERE ${whereClause}
      ORDER BY c.${validatedQuery.sort_by} ${validatedQuery.sort_order}
      LIMIT $${++paramCount} OFFSET $${++paramCount}
    `;

    try {
      const [countResult, dataResult] = await Promise.all([
        this.db.query(countQuery, queryValues),
        this.db.query(dataQuery, [...queryValues, validatedQuery.limit, validatedQuery.offset]),
      ]);

      const commits: CommitSummary[] = dataResult.rows.map((row: any) => ({
        commit_id: row.commit_id,
        project_id: row.project_id,
        author_name: row.author_name,
        committed_at: row.committed_at,
        message: row.message,
        file_count: parseInt(row.file_count) || 0,
        added_lines: parseInt(row.added_lines) || 0,
        removed_lines: parseInt(row.removed_lines) || 0,
        is_merge: row.is_merge || false,
        is_conventional: row.is_conventional || false,
        conventional_type: this.extractConventionalType(row.message),
        breaking_change: row.breaking_change || false,
      }));

      return {
        commits,
        total: parseInt(countResult.rows[0].count),
      };
    } catch (error) {
      logger.error('Failed to find commits by project', { queryParams, error });
      throw error;
    }
  }

  async getCommitFiles(commitId: string): Promise<CommitFile[]> {
    const query = `
      SELECT id, commit_id, path, change_type, language, added_lines, removed_lines, hunk_preview, created_at
      FROM commit_files 
      WHERE commit_id = $1
      ORDER BY path
    `;

    try {
      const result = await this.db.query(query, [commitId]);
      return result.rows;
    } catch (error) {
      logger.error('Failed to get commit files', { commitId, error });
      throw error;
    }
  }

  async getRecentCommits(projectId: string, limit = 10): Promise<CommitSummary[]> {
    const result = await this.findByProject({
      project_id: projectId,
      limit,
      sort_by: 'committed_at',
      sort_order: 'desc',
    });

    return result.commits;
  }

  async getCommitsByAuthor(projectId: string, author: string, limit = 20): Promise<CommitSummary[]> {
    const result = await this.findByProject({
      project_id: projectId,
      author,
      limit,
      sort_by: 'committed_at',
      sort_order: 'desc',
    });

    return result.commits;
  }

  async getCommitStats(projectId: string, since?: Date): Promise<{
    total_commits: number;
    total_files: number;
    total_added_lines: number;
    total_removed_lines: number;
    authors: Record<string, number>;
    languages: Record<string, number>;
    conventional_types: Record<string, number>;
  }> {
    const conditions = ['c.project_id = $1'];
    const values: any[] = [projectId];

    if (since) {
      conditions.push('c.committed_at >= $2');
      values.push(since);
    }

    const whereClause = conditions.join(' AND ');

    const query = `
      SELECT 
        COUNT(DISTINCT c.id) as total_commits,
        COUNT(cf.path) as total_files,
        SUM(cf.added_lines) as total_added_lines,
        SUM(cf.removed_lines) as total_removed_lines,
        json_object_agg(DISTINCT c.author_name, author_counts.count) FILTER (WHERE author_counts.count IS NOT NULL) as authors,
        json_object_agg(DISTINCT cf.language, lang_counts.count) FILTER (WHERE lang_counts.count IS NOT NULL) as languages
      FROM commits c
      LEFT JOIN commit_files cf ON c.id = cf.commit_id
      LEFT JOIN (
        SELECT author_name, COUNT(*) as count
        FROM commits
        WHERE ${whereClause}
        GROUP BY author_name
      ) author_counts ON c.author_name = author_counts.author_name
      LEFT JOIN (
        SELECT cf2.language, COUNT(*) as count
        FROM commits c2
        JOIN commit_files cf2 ON c2.id = cf2.commit_id
        WHERE ${whereClause} AND cf2.language IS NOT NULL
        GROUP BY cf2.language
      ) lang_counts ON cf.language = lang_counts.language
      WHERE ${whereClause}
    `;

    try {
      const result = await this.db.query(query, values);
      const row = result.rows[0];

      return {
        total_commits: parseInt(row.total_commits) || 0,
        total_files: parseInt(row.total_files) || 0,
        total_added_lines: parseInt(row.total_added_lines) || 0,
        total_removed_lines: parseInt(row.total_removed_lines) || 0,
        authors: row.authors || {},
        languages: row.languages || {},
        conventional_types: {}, // TODO: Calculate from commit messages
      };
    } catch (error) {
      logger.error('Failed to get commit stats', { projectId, since, error });
      throw error;
    }
  }

  async deleteByProject(projectId: string): Promise<number> {
    try {
      const result = await this.db.query(
        'DELETE FROM commits WHERE project_id = $1',
        [projectId]
      );

      logger.info('Commits deleted for project', { 
        projectId, 
        deletedCount: result.rowCount 
      });

      return result.rowCount || 0;
    } catch (error) {
      logger.error('Failed to delete commits by project', { projectId, error });
      throw error;
    }
  }

  private calculateCommitStats(files: CommitFile[]) {
    const stats = {
      total_files: files.length,
      added_lines: files.reduce((sum, f) => sum + f.added_lines, 0),
      removed_lines: files.reduce((sum, f) => sum + f.removed_lines, 0),
      languages: {} as Record<string, number>,
    };

    files.forEach(file => {
      if (file.language) {
        stats.languages[file.language] = (stats.languages[file.language] || 0) + 1;
      }
    });

    return stats;
  }

  private extractConventionalType(message: string): string | undefined {
    const match = message.match(/^(feat|fix|docs|style|refactor|perf|test|chore|build|ci)(\(.+\))?!?:/);
    return match ? match[1] : undefined;
  }
}
