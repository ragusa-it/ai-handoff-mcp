import { Router } from 'express';
import { ProjectController, validateProjectId } from '../controllers/ProjectController.js';
import { Database } from '../config/database.js';
import { RedisManager } from '../config/redis.js';
import { logger } from '../services/structuredLogger.js';

// Request logging middleware
const logRequest = (req: any, res: any, next: any) => {
  logger.info('API Request', {
    method: req.method,
    path: req.path,
    query: req.query,
    userAgent: req.get('User-Agent'),
    ip: req.ip,
  });
  next();
};

// Error handling middleware
const handleAsyncErrors = (fn: any) => (req: any, res: any, next: any) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export function createProjectRoutes(db: Database, redis: RedisManager): Router {
  const router = Router();
  const projectController = new ProjectController(db, redis);

  // Apply request logging to all routes
  router.use(logRequest);

  /**
   * @swagger
   * /api/projects:
   *   post:
   *     summary: Create a new project
   *     tags: [Projects]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - name
   *               - repo_path
   *             properties:
   *               name:
   *                 type: string
   *                 description: Project name
   *                 example: "My AI Project"
   *               description:
   *                 type: string
   *                 description: Project description
   *                 example: "An AI-powered web application"
   *               repo_path:
   *                 type: string
   *                 description: Absolute path to git repository
   *                 example: "/Users/john/projects/my-ai-project"
   *               config:
   *                 type: object
   *                 description: Project configuration
   *     responses:
   *       201:
   *         description: Project created successfully
   *       400:
   *         description: Validation error
   *       409:
   *         description: Repository path already in use
   */
  router.post('/', handleAsyncErrors(async (req: any, res: any) => {
    await projectController.create(req, res);
  }));

  /**
   * @swagger
   * /api/projects:
   *   get:
   *     summary: Get all projects with pagination
   *     tags: [Projects]
   *     parameters:
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           minimum: 1
   *           maximum: 100
   *           default: 20
   *         description: Number of projects per page
   *       - in: query
   *         name: offset
   *         schema:
   *           type: integer
   *           minimum: 0
   *           default: 0
   *         description: Number of projects to skip
   *       - in: query
   *         name: search
   *         schema:
   *           type: string
   *         description: Search term for project name or description
   *       - in: query
   *         name: sort_by
   *         schema:
   *           type: string
   *           enum: [name, created_at, updated_at]
   *           default: updated_at
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
   *         description: Projects retrieved successfully
   */
  router.get('/', handleAsyncErrors(async (req: any, res: any) => {
    await projectController.findAll(req, res);
  }));

  /**
   * @swagger
   * /api/projects/{id}:
   *   get:
   *     summary: Get project by ID
   *     tags: [Projects]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *         description: Project UUID
   *       - in: query
   *         name: stats
   *         schema:
   *           type: boolean
   *           default: false
   *         description: Include project statistics
   *     responses:
   *       200:
   *         description: Project retrieved successfully
   *       404:
   *         description: Project not found
   */
  router.get('/:id', validateProjectId, handleAsyncErrors(async (req: any, res: any) => {
    await projectController.findById(req, res);
  }));

  /**
   * @swagger
   * /api/projects/{id}:
   *   put:
   *     summary: Update project
   *     tags: [Projects]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *         description: Project UUID
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               name:
   *                 type: string
   *                 description: Project name
   *               description:
   *                 type: string
   *                 description: Project description
   *               repo_path:
   *                 type: string
   *                 description: Absolute path to git repository
   *               config:
   *                 type: object
   *                 description: Project configuration
   *     responses:
   *       200:
   *         description: Project updated successfully
   *       404:
   *         description: Project not found
   *       400:
   *         description: Validation error
   */
  router.put('/:id', validateProjectId, handleAsyncErrors(async (req: any, res: any) => {
    await projectController.update(req, res);
  }));

  /**
   * @swagger
   * /api/projects/{id}:
   *   delete:
   *     summary: Delete project
   *     tags: [Projects]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *         description: Project UUID
   *       - in: query
   *         name: force
   *         schema:
   *           type: boolean
   *           default: false
   *         description: Force deletion even with related data
   *     responses:
   *       200:
   *         description: Project deleted successfully
   *       404:
   *         description: Project not found
   *       409:
   *         description: Project has related data (use force=true)
   */
  router.delete('/:id', validateProjectId, handleAsyncErrors(async (req: any, res: any) => {
    await projectController.delete(req, res);
  }));

  /**
   * @swagger
   * /api/projects/{id}/activity:
   *   get:
   *     summary: Get project activity summary
   *     tags: [Projects]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *         description: Project UUID
   *       - in: query
   *         name: days
   *         schema:
   *           type: integer
   *           minimum: 1
   *           maximum: 365
   *           default: 7
   *         description: Number of days to include in activity summary
   *     responses:
   *       200:
   *         description: Activity summary retrieved successfully
   *       404:
   *         description: Project not found
   */
  router.get('/:id/activity', validateProjectId, handleAsyncErrors(async (req: any, res: any) => {
    await projectController.getActivity(req, res);
  }));

  /**
   * @swagger
   * /api/projects/{id}/scan:
   *   post:
   *     summary: Trigger manual git scan
   *     tags: [Projects]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *         description: Project UUID
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               branch:
   *                 type: string
   *                 description: Git branch to scan
   *                 default: "main"
   *               since:
   *                 type: string
   *                 format: date-time
   *                 description: Only scan commits since this date
   *     responses:
   *       200:
   *         description: Git scan triggered successfully
   *       404:
   *         description: Project not found
   */
  router.post('/:id/scan', validateProjectId, handleAsyncErrors(async (req: any, res: any) => {
    await projectController.triggerGitScan(req, res);
  }));

  // Health check endpoint
  router.get('/health', (req: any, res: any) => {
    res.json({
      success: true,
      message: 'Projects API is healthy',
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}

// Export route configuration for documentation
export const projectRouteConfig = {
  basePath: '/api/projects',
  description: 'Project management endpoints for git-integrated memory system',
  tags: ['Projects'],
  endpoints: [
    {
      method: 'POST',
      path: '/',
      description: 'Create a new project',
      requiresAuth: false,
    },
    {
      method: 'GET',
      path: '/',
      description: 'List all projects with pagination and search',
      requiresAuth: false,
    },
    {
      method: 'GET',
      path: '/:id',
      description: 'Get project by ID with optional statistics',
      requiresAuth: false,
    },
    {
      method: 'PUT',
      path: '/:id',
      description: 'Update project details',
      requiresAuth: false,
    },
    {
      method: 'DELETE',
      path: '/:id',
      description: 'Delete project (with optional force)',
      requiresAuth: false,
    },
    {
      method: 'GET',
      path: '/:id/activity',
      description: 'Get project activity summary',
      requiresAuth: false,
    },
    {
      method: 'POST',
      path: '/:id/scan',
      description: 'Trigger manual git repository scan',
      requiresAuth: false,
    },
  ],
};
