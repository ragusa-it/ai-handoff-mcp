import { Database } from '../config/database.js';
import { RedisManager } from '../config/redis.js';
import { GitService, GitScanOptions } from '../services/GitService.js';
import { ProjectModel } from '../models/Project.js';
import { logger } from '../services/structuredLogger.js';

/**
 * Background job processor for git repository scanning
 * Handles queued git scan operations asynchronously
 */

export interface GitScanJobData {
  scanId: string;
  projectId: string;
  options: GitScanOptions;
  priority?: 'low' | 'normal' | 'high';
  retryCount?: number;
  maxRetries?: number;
}

export class GitScanJob {
  private db: Database;
  private redis: RedisManager;
  private gitService: GitService;
  private projectModel: ProjectModel;
  private isProcessing = false;
  private processingInterval?: NodeJS.Timeout;

  constructor(db: Database, redis: RedisManager) {
    this.db = db;
    this.redis = redis;
    this.gitService = new GitService(db);
    this.projectModel = new ProjectModel(db);
  }

  /**
   * Start the job processor
   */
  async start(): Promise<void> {
    if (this.isProcessing) {
      logger.warn('GitScanJob processor is already running');
      return;
    }

    this.isProcessing = true;
    logger.info('Starting GitScanJob processor');

    // Process jobs every 5 seconds
    this.processingInterval = setInterval(async () => {
      try {
        await this.processNextJob();
      } catch (error) {
        logger.error('Error in GitScanJob processor', { error });
      }
    }, 5000);

    // Process any existing jobs immediately
    await this.processNextJob();
  }

  /**
   * Stop the job processor
   */
  async stop(): Promise<void> {
    this.isProcessing = false;
    
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = undefined;
    }

    logger.info('GitScanJob processor stopped');
  }

  /**
   * Queue a git scan job
   */
  async queueScan(jobData: GitScanJobData): Promise<void> {
    const job = {
      ...jobData,
      queuedAt: new Date().toISOString(),
      retryCount: jobData.retryCount || 0,
      maxRetries: jobData.maxRetries || 3,
      priority: jobData.priority || 'normal',
    };

    const queueKey = this.getQueueKey(job.priority);
    const jobKey = `git_scan_job:${job.scanId}`;

    // Store job data
    await this.redis.set(jobKey, JSON.stringify(job), 3600); // 1 hour TTL

    // Add to appropriate priority queue
    await this.redis.client.lpush(queueKey, job.scanId);

    logger.info('Git scan job queued', {
      scanId: job.scanId,
      projectId: job.projectId,
      priority: job.priority,
    });
  }

  /**
   * Process the next job in queue
   */
  private async processNextJob(): Promise<void> {
    if (!this.isProcessing) return;

    // Check queues in priority order
    const queues = ['git_scan_queue:high', 'git_scan_queue:normal', 'git_scan_queue:low'];
    
    for (const queueKey of queues) {
      const scanId = await this.redis.client.rpop(queueKey);
      if (scanId) {
        await this.processJob(scanId);
        return; // Process one job at a time
      }
    }
  }

  /**
   * Process a specific job
   */
  private async processJob(scanId: string): Promise<void> {
    const jobKey = `git_scan_job:${scanId}`;
    const statusKey = `git_scan_status:${scanId}`;

    try {
      // Get job data
      const jobDataStr = await this.redis.get(jobKey);
      if (!jobDataStr) {
        logger.warn('Job data not found', { scanId, jobKey });
        return;
      }

      const jobData: GitScanJobData & {
        queuedAt: string;
        retryCount: number;
        maxRetries: number;
        priority: string;
      } = JSON.parse(jobDataStr);

      logger.info('Processing git scan job', {
        scanId,
        projectId: jobData.projectId,
        priority: jobData.priority,
        retryCount: jobData.retryCount,
      });

      // Update status to running
      await this.updateJobStatus(statusKey, {
        status: 'running',
        started_at: new Date().toISOString(),
        project_id: jobData.projectId,
        scan_id: scanId,
        options: jobData.options,
      });

      // Get project information
      const project = await this.projectModel.findById(jobData.projectId);
      if (!project) {
        throw new Error(`Project not found: ${jobData.projectId}`);
      }

      if (!project.repo_path) {
        throw new Error(`Project does not have git repository configured: ${jobData.projectId}`);
      }

      // Update options with actual repository path
      const scanOptions: GitScanOptions = {
        ...jobData.options,
        repositoryPath: project.repo_path,
      };

      // Perform the git scan
      const results = await this.gitService.scanRepository(scanOptions);

      // Update status to completed
      await this.updateJobStatus(statusKey, {
        status: 'completed',
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        project_id: jobData.projectId,
        project_name: project.name,
        scan_id: scanId,
        results,
        options: scanOptions,
      });

      // Clean up job data
      await this.redis.delete(jobKey);

      // Clear project scan lock
      const scanLockKey = `git_scan:${jobData.projectId}`;
      await this.redis.delete(scanLockKey);

      // Invalidate related caches
      await this.invalidateProjectCaches(jobData.projectId);

      logger.info('Git scan job completed successfully', {
        scanId,
        projectId: jobData.projectId,
        results,
      });

    } catch (error) {
      logger.error('Git scan job failed', { scanId, error });
      await this.handleJobFailure(scanId, jobKey, statusKey, error as Error);
    }
  }

  /**
   * Handle job failure with retry logic
   */
  private async handleJobFailure(
    scanId: string,
    jobKey: string,
    statusKey: string,
    error: Error
  ): Promise<void> {
    try {
      // Get job data to check retry count
      const jobDataStr = await this.redis.get(jobKey);
      if (!jobDataStr) {
        logger.warn('Job data not found for failure handling', { scanId });
        return;
      }

      const jobData: GitScanJobData & {
        queuedAt: string;
        retryCount: number;
        maxRetries: number;
        priority: string;
      } = JSON.parse(jobDataStr);

      const shouldRetry = jobData.retryCount < jobData.maxRetries;

      if (shouldRetry) {
        // Increment retry count and requeue
        jobData.retryCount++;
        
        // Use exponential backoff: wait 2^retryCount minutes
        const delayMinutes = Math.pow(2, jobData.retryCount);
        const delayMs = delayMinutes * 60 * 1000;

        logger.info('Retrying git scan job', {
          scanId,
          retryCount: jobData.retryCount,
          maxRetries: jobData.maxRetries,
          delayMinutes,
        });

        // Schedule retry
        setTimeout(async () => {
          await this.queueScan(jobData);
        }, delayMs);

        // Update status to retrying
        await this.updateJobStatus(statusKey, {
          status: 'retrying',
          started_at: new Date().toISOString(),
          failed_at: new Date().toISOString(),
          next_retry_at: new Date(Date.now() + delayMs).toISOString(),
          project_id: jobData.projectId,
          scan_id: scanId,
          error: error.message,
          retry_count: jobData.retryCount,
          max_retries: jobData.maxRetries,
          options: jobData.options,
        });

      } else {
        // Max retries reached, mark as permanently failed
        await this.updateJobStatus(statusKey, {
          status: 'failed',
          started_at: new Date().toISOString(),
          failed_at: new Date().toISOString(),
          project_id: jobData.projectId,
          scan_id: scanId,
          error: error.message,
          retry_count: jobData.retryCount,
          max_retries: jobData.maxRetries,
          options: jobData.options,
        });

        // Clean up job data
        await this.redis.delete(jobKey);

        // Clear project scan lock
        const scanLockKey = `git_scan:${jobData.projectId}`;
        await this.redis.delete(scanLockKey);

        logger.error('Git scan job permanently failed', {
          scanId,
          projectId: jobData.projectId,
          retryCount: jobData.retryCount,
          error: error.message,
        });
      }

    } catch (retryError) {
      logger.error('Failed to handle job failure', { scanId, error: retryError });
    }
  }

  /**
   * Update job status in Redis
   */
  private async updateJobStatus(statusKey: string, status: any): Promise<void> {
    await this.redis.set(statusKey, JSON.stringify(status), 3600); // 1 hour TTL
  }

  /**
   * Get queue key based on priority
   */
  private getQueueKey(priority: 'low' | 'normal' | 'high'): string {
    return `git_scan_queue:${priority}`;
  }

  /**
   * Invalidate project-related caches
   */
  private async invalidateProjectCaches(projectId: string): Promise<void> {
    try {
      const patterns = [
        `commits:*"project_id":"${projectId}"*`,
        `commit:*`,
        `recent_commits:${projectId}:*`,
        `repo_info:${projectId}`,
        `project:${projectId}`,
      ];

      for (const pattern of patterns) {
        const keys = await this.redis.keys([pattern]);
        if (keys.length > 0) {
          await this.redis.deleteMany(keys);
        }
      }

      logger.info('Invalidated project caches after git scan', { 
        projectId,
        patterns,
      });

    } catch (error) {
      logger.warn('Failed to invalidate caches after git scan', { 
        projectId, 
        error 
      });
    }
  }

  /**
   * Get job queue statistics
   */
  async getQueueStats(): Promise<{
    high: number;
    normal: number;
    low: number;
    total: number;
  }> {
    try {
      const [high, normal, low] = await Promise.all([
        this.redis.client.llen('git_scan_queue:high'),
        this.redis.client.llen('git_scan_queue:normal'),
        this.redis.client.llen('git_scan_queue:low'),
      ]);

      return {
        high,
        normal,
        low,
        total: high + normal + low,
      };
    } catch (error) {
      logger.error('Failed to get queue stats', { error });
      return { high: 0, normal: 0, low: 0, total: 0 };
    }
  }

  /**
   * Get list of active/queued jobs
   */
  async getActiveJobs(): Promise<Array<{
    scanId: string;
    projectId: string;
    status: string;
    queuedAt?: string;
    startedAt?: string;
    priority: string;
  }>> {
    try {
      const jobs: Array<{
        scanId: string;
        projectId: string;
        status: string;
        queuedAt?: string;
        startedAt?: string;
        priority: string;
      }> = [];

      // Get all job keys
      const jobKeys = await this.redis.keys(['git_scan_job:*']);
      
      // Get all status keys
      const statusKeys = await this.redis.keys(['git_scan_status:*']);

      // Combine job and status information
      for (const jobKey of jobKeys) {
        const jobDataStr = await this.redis.get(jobKey);
        if (jobDataStr) {
          const jobData = JSON.parse(jobDataStr);
          const scanId = jobKey.split(':')[1];
          const statusKey = `git_scan_status:${scanId}`;
          
          let status = 'queued';
          let startedAt: string | undefined;

          const statusDataStr = await this.redis.get(statusKey);
          if (statusDataStr) {
            const statusData = JSON.parse(statusDataStr);
            status = statusData.status;
            startedAt = statusData.started_at;
          }

          const jobEntry: {
            scanId: string;
            projectId: string;
            status: string;
            queuedAt?: string;
            startedAt?: string;
            priority: string;
          } = {
            scanId,
            projectId: jobData.projectId,
            status,
            queuedAt: jobData.queuedAt,
            priority: jobData.priority,
          };
          
          // Only add startedAt if it's not undefined to satisfy exactOptionalPropertyTypes
          if (startedAt !== undefined) {
            jobEntry.startedAt = startedAt;
          }
          
          jobs.push(jobEntry);
        }
      }

      return jobs.sort((a, b) => {
        // Sort by queued time, newest first
        const aTime = new Date(a.queuedAt || 0).getTime();
        const bTime = new Date(b.queuedAt || 0).getTime();
        return bTime - aTime;
      });

    } catch (error) {
      logger.error('Failed to get active jobs', { error });
      return [];
    }
  }

  /**
   * Cancel a queued job
   */
  async cancelJob(scanId: string): Promise<boolean> {
    try {
      const jobKey = `git_scan_job:${scanId}`;
      const statusKey = `git_scan_status:${scanId}`;

      // Get job data to determine which queue it's in
      const jobDataStr = await this.redis.get(jobKey);
      if (!jobDataStr) {
        return false; // Job not found
      }

      const jobData = JSON.parse(jobDataStr);

      // Remove from queue
      const queueKey = this.getQueueKey(jobData.priority);
      await this.redis.client.lrem(queueKey, 0, scanId);

      // Update status to cancelled
      await this.updateJobStatus(statusKey, {
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        project_id: jobData.projectId,
        scan_id: scanId,
      });

      // Clean up job data
      await this.redis.delete(jobKey);

      // Clear project scan lock
      const scanLockKey = `git_scan:${jobData.projectId}`;
      await this.redis.delete(scanLockKey);

      logger.info('Git scan job cancelled', {
        scanId,
        projectId: jobData.projectId,
      });

      return true;

    } catch (error) {
      logger.error('Failed to cancel job', { scanId, error });
      return false;
    }
  }
}
