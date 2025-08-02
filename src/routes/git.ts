import { Router } from 'express';
import { Database } from '../config/database.js';
import { RedisManager } from '../config/redis.js';
import { GitController } from '../controllers/GitController.js';
import { logger } from '../services/structuredLogger.js';

/**
 * Git API Routes
 * 
 * These routes provide git repository integration capabilities:
 * - Repository scanning and commit analysis
 * - Commit querying and filtering
 * - Repository information and statistics
 * - Author-based commit analysis
 */

// Helper function to handle async route errors
function handleAsyncErrors(fn: Function) {
  return (req: any, res: any, next: any) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Middleware for request logging
function requestLogger(req: any, res: any, next: any) {
  const startTime = Date.now();
  
  logger.info('Git API request', {
    method: req.method,
    path: req.path,
    query: req.query,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
  });

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    logger.info('Git API response', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
    });
  });

  next();
}

/**
 * Create git routes with dependency injection
 */
export function createGitRoutes(db: Database, redis: RedisManager): Router {
  const router = Router();
  const gitController = new GitController(db, redis);

  // Apply request logging middleware
  router.use(requestLogger);

  /**
   * @openapi
   * /api/git/scan:
   *   post:
   *     summary: Trigger git repository scan
   *     description: Start scanning a git repository to extract commits and file changes
   *     tags: [Git]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - project_id
   *             properties:
   *               project_id:
   *                 type: string
   *                 format: uuid
   *                 description: ID of the project to scan
   *               branch:
   *                 type: string
   *                 description: Branch to scan (defaults to main/master)
   *               since:
   *                 type: string
   *                 format: date-time
   *                 description: Only scan commits after this date
   *               max_commits:
   *                 type: integer
   *                 minimum: 1
   *                 maximum: 5000
   *                 default: 1000
   *                 description: Maximum number of commits to scan
   *               include_files:
   *                 type: boolean
   *                 default: true
   *                 description: Whether to include file change information
   *               include_diffs:
   *                 type: boolean
   *                 default: true
   *                 description: Whether to include diff content for analysis
   *               force_rescan:
   *                 type: boolean
   *                 default: false
   *                 description: Force rescan even if already in progress
   *     responses:
   *       202:
   *         description: Scan started successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 message:
   *                   type: string
   *                 scan_id:
   *                   type: string
   *                 project_id:
   *                   type: string
   *                 repository_info:
   *                   type: object
   *                 scan_options:
   *                   type: object
   *       400:
   *         description: Invalid request or repository configuration
   *       404:
   *         description: Project not found
   *       409:
   *         description: Scan already in progress
   */
  router.post('/scan', handleAsyncErrors(async (req: any, res: any) => {
    await gitController.scanRepository(req, res);
  }));

  /**
   * @openapi
   * /api/git/scan/{scan_id}/status:
   *   get:
   *     summary: Get git scan status
   *     description: Check the status of a running git repository scan
   *     tags: [Git]
   *     parameters:
   *       - in: path
   *         name: scan_id
   *         required: true
   *         schema:
   *           type: string
   *         description: ID of the scan to check
   *     responses:
   *       200:
   *         description: Scan status retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 scan_id:
   *                   type: string
   *                 status:
   *                   type: string
   *                   enum: [running, completed, failed]
   *                 started_at:
   *                   type: string
   *                   format: date-time
   *                 completed_at:
   *                   type: string
   *                   format: date-time
   *                 results:
   *                   type: object
   *       404:
   *         description: Scan not found or expired
   */
  router.get('/scan/:scan_id/status', handleAsyncErrors(async (req: any, res: any) => {
    await gitController.getScanStatus(req, res);
  }));

  /**
   * @openapi
   * /api/git/commits:
   *   get:
   *     summary: Get commits for a project
   *     description: Query commits with filtering and pagination
   *     tags: [Git]
   *     parameters:
   *       - in: query
   *         name: project_id
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *         description: ID of the project
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           minimum: 1
   *           maximum: 100
   *           default: 50
   *         description: Number of commits to return
   *       - in: query
   *         name: offset
   *         schema:
   *           type: integer
   *           minimum: 0
   *           default: 0
   *         description: Number of commits to skip
   *       - in: query
   *         name: since
   *         schema:
   *           type: string
   *           format: date-time
   *         description: Only return commits after this date
   *       - in: query
   *         name: until
   *         schema:
   *           type: string
   *           format: date-time
   *         description: Only return commits before this date
   *       - in: query
   *         name: author
   *         schema:
   *           type: string
   *         description: Filter by author name (partial match)
   *       - in: query
   *         name: branch
   *         schema:
   *           type: string
   *         description: Filter by branch name
   *       - in: query
   *         name: file_path
   *         schema:
   *           type: string
   *         description: Filter by file path (partial match)
   *       - in: query
   *         name: change_type
   *         schema:
   *           type: string
   *           enum: [A, M, D, R, C, T]
   *         description: Filter by change type
   *       - in: query
   *         name: sort_by
   *         schema:
   *           type: string
   *           enum: [committed_at, author_name, message]
   *           default: committed_at
   *         description: Sort field
   *       - in: query
   *         name: sort_order
   *         schema:
   *           type: string
   *           enum: [asc, desc]
   *           default: desc
   *         description: Sort order
   *     responses:
   *       200:
   *         description: Commits retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 project_id:
   *                   type: string
   *                 pagination:
   *                   type: object
   *                 commits:
   *                   type: array
   *                   items:
   *                     type: object
   *       400:
   *         description: Invalid query parameters
   *       404:
   *         description: Project not found
   */
  router.get('/commits', handleAsyncErrors(async (req: any, res: any) => {
    await gitController.getCommits(req, res);
  }));

  /**
   * @openapi
   * /api/git/commits/{commit_id}:
   *   get:
   *     summary: Get commit details
   *     description: Get detailed information about a specific commit including files
   *     tags: [Git]
   *     parameters:
   *       - in: path
   *         name: commit_id
   *         required: true
   *         schema:
   *           type: string
   *         description: Git commit hash
   *       - in: query
   *         name: include_files
   *         schema:
   *           type: boolean
   *           default: true
   *         description: Whether to include file change details
   *     responses:
   *       200:
   *         description: Commit details retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 commit:
   *                   type: object
   *       400:
   *         description: Invalid commit hash format
   *       404:
   *         description: Commit not found
   */
  router.get('/commits/:commit_id', handleAsyncErrors(async (req: any, res: any) => {
    await gitController.getCommitDetails(req, res);
  }));

  /**
   * @openapi
   * /api/git/repository/info:
   *   get:
   *     summary: Get repository information
   *     description: Get repository status, statistics, and metadata
   *     tags: [Git]
   *     parameters:
   *       - in: query
   *         name: project_id
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *         description: ID of the project
   *     responses:
   *       200:
   *         description: Repository information retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 project_id:
   *                   type: string
   *                 repository_path:
   *                   type: string
   *                 repository_info:
   *                   type: object
   *                 commit_stats:
   *                   type: object
   *       400:
   *         description: Invalid query parameters or no repository configured
   *       404:
   *         description: Project not found
   */
  router.get('/repository/info', handleAsyncErrors(async (req: any, res: any) => {
    await gitController.getRepositoryInfo(req, res);
  }));

  /**
   * @openapi
   * /api/git/authors/{author}/commits:
   *   get:
   *     summary: Get commits by author
   *     description: Get commits made by a specific author
   *     tags: [Git]
   *     parameters:
   *       - in: path
   *         name: author
   *         required: true
   *         schema:
   *           type: string
   *         description: Author name
   *       - in: query
   *         name: project_id
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *         description: ID of the project
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           minimum: 1
   *           maximum: 100
   *           default: 20
   *         description: Number of commits to return
   *     responses:
   *       200:
   *         description: Author commits retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 project_id:
   *                   type: string
   *                 author:
   *                   type: string
   *                 commits:
   *                   type: array
   *                   items:
   *                     type: object
   *       400:
   *         description: Missing or invalid parameters
   */
  router.get('/authors/:author/commits', handleAsyncErrors(async (req: any, res: any) => {
    await gitController.getCommitsByAuthor(req, res);
  }));

  /**
   * @openapi
   * /api/git/recent:
   *   get:
   *     summary: Get recent commits
   *     description: Get the most recent commits for a project
   *     tags: [Git]
   *     parameters:
   *       - in: query
   *         name: project_id
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *         description: ID of the project
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           minimum: 1
   *           maximum: 50
   *           default: 10
   *         description: Number of recent commits to return
   *     responses:
   *       200:
   *         description: Recent commits retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 project_id:
   *                   type: string
   *                 commits:
   *                   type: array
   *                   items:
   *                     type: object
   *       400:
   *         description: Missing or invalid parameters
   */
  router.get('/recent', handleAsyncErrors(async (req: any, res: any) => {
    await gitController.getRecentCommits(req, res);
  }));

  // Error handling middleware for git routes
  router.use((error: any, req: any, res: any, next: any) => {
    logger.error('Git API error', {
      error: error.message,
      stack: error.stack,
      method: req.method,
      path: req.path,
      query: req.query,
      body: req.body,
    });

    // Handle specific error types
    if (error.name === 'ValidationError') {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: error.details,
      });
      return;
    }

    if (error.name === 'UnauthorizedError') {
      res.status(401).json({
        success: false,
        error: 'Unauthorized',
      });
      return;
    }

    if (error.code === 'ENOENT') {
      res.status(404).json({
        success: false,
        error: 'Repository or file not found',
      });
      return;
    }

    // Generic server error
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      ...(process.env.NODE_ENV === 'development' && {
        details: error.message,
        stack: error.stack,
      }),
    });
  });

  return router;
}

/**
 * Swagger schema definitions for Git API
 */
export const gitApiSchemas = {
  GitScanRequest: {
    type: 'object',
    required: ['project_id'],
    properties: {
      project_id: { type: 'string', format: 'uuid' },
      branch: { type: 'string' },
      since: { type: 'string', format: 'date-time' },
      max_commits: { type: 'integer', minimum: 1, maximum: 5000, default: 1000 },
      include_files: { type: 'boolean', default: true },
      include_diffs: { type: 'boolean', default: true },
      force_rescan: { type: 'boolean', default: false },
    },
  },
  CommitSummary: {
    type: 'object',
    properties: {
      commit_id: { type: 'string' },
      project_id: { type: 'string' },
      author_name: { type: 'string' },
      committed_at: { type: 'string', format: 'date-time' },
      message: { type: 'string' },
      file_count: { type: 'integer' },
      added_lines: { type: 'integer' },
      removed_lines: { type: 'integer' },
      is_merge: { type: 'boolean' },
      is_conventional: { type: 'boolean' },
      breaking_change: { type: 'boolean' },
    },
  },
  CommitWithFiles: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      project_id: { type: 'string' },
      author_name: { type: 'string' },
      author_email: { type: 'string' },
      committed_at: { type: 'string', format: 'date-time' },
      message: { type: 'string' },
      parents: { type: 'array', items: { type: 'string' } },
      branches: { type: 'array', items: { type: 'string' } },
      metadata: { type: 'object' },
      files: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            change_type: { type: 'string', enum: ['A', 'M', 'D', 'R', 'C', 'T'] },
            language: { type: 'string' },
            added_lines: { type: 'integer' },
            removed_lines: { type: 'integer' },
            hunk_preview: { type: 'string' },
          },
        },
      },
      stats: {
        type: 'object',
        properties: {
          total_files: { type: 'integer' },
          added_lines: { type: 'integer' },
          removed_lines: { type: 'integer' },
          languages: { type: 'object' },
        },
      },
    },
  },
  RepositoryInfo: {
    type: 'object',
    properties: {
      isValid: { type: 'boolean' },
      currentBranch: { type: 'string' },
      commitCount: { type: 'integer' },
      lastCommit: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          message: { type: 'string' },
          author: { type: 'string' },
          date: { type: 'string', format: 'date-time' },
        },
      },
      branches: { type: 'array', items: { type: 'string' } },
    },
  },
};

export default createGitRoutes;
