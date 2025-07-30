import { sessionManagerService } from './sessionManager.js';
import type { RetentionPolicy } from './sessionManager.js';
import { JobResult as CommonJobResult } from '../types/common.js';

export interface JobConfig {
  name: string;
  intervalMs: number;
  enabled: boolean;
  maxRetries: number;
  retryDelayMs: number;
}

export interface JobResult {
  jobName: string;
  success: boolean;
  startTime: Date;
  endTime: Date;
  duration: number;
  result?: CommonJobResult;
  error?: string;
  retryCount: number;
}

export interface JobStats {
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  averageDuration: number;
  lastRun?: Date;
  lastSuccess?: Date;
  lastFailure?: Date;
}

class BackgroundJobScheduler {
  private jobs: Map<string, NodeJS.Timeout> = new Map();
  private jobConfigs: Map<string, JobConfig> = new Map();
  private jobStats: Map<string, JobStats> = new Map();
  private isShuttingDown = false;
  private activeJobs = new Set<string>();

  constructor() {
    this.initializeDefaultJobs();
  }

  /**
   * Initialize default job configurations
   */
  private initializeDefaultJobs(): void {
    // Session expiration and cleanup job
    this.jobConfigs.set('session-cleanup', {
      name: 'session-cleanup',
      intervalMs: 60 * 60 * 1000, // 1 hour
      enabled: true,
      maxRetries: 3,
      retryDelayMs: 5 * 60 * 1000 // 5 minutes
    });

    // Dormant session detection job
    this.jobConfigs.set('dormant-detection', {
      name: 'dormant-detection',
      intervalMs: 30 * 60 * 1000, // 30 minutes
      enabled: true,
      maxRetries: 3,
      retryDelayMs: 2 * 60 * 1000 // 2 minutes
    });

    // Retention policy enforcement job
    this.jobConfigs.set('retention-enforcement', {
      name: 'retention-enforcement',
      intervalMs: 24 * 60 * 60 * 1000, // 24 hours
      enabled: true,
      maxRetries: 5,
      retryDelayMs: 10 * 60 * 1000 // 10 minutes
    });

    // Cache optimization job
    this.jobConfigs.set('cache-optimization', {
      name: 'cache-optimization',
      intervalMs: 2 * 60 * 60 * 1000, // 2 hours
      enabled: true,
      maxRetries: 2,
      retryDelayMs: 15 * 60 * 1000 // 15 minutes
    });

    // Initialize stats for all jobs
    for (const config of this.jobConfigs.values()) {
      this.jobStats.set(config.name, {
        totalRuns: 0,
        successfulRuns: 0,
        failedRuns: 0,
        averageDuration: 0
      });
    }
  }

  /**
   * Start all enabled background jobs
   */
  async startAllJobs(): Promise<void> {
    if (this.isShuttingDown) {
      throw new Error('Cannot start jobs during shutdown');
    }

    console.log('Starting background job scheduler...');

    for (const config of this.jobConfigs.values()) {
      if (config.enabled) {
        await this.startJob(config.name);
      }
    }

    console.log(`Started ${this.jobs.size} background jobs`);
  }

  /**
   * Start a specific job
   */
  async startJob(jobName: string): Promise<void> {
    const config = this.jobConfigs.get(jobName);
    if (!config) {
      throw new Error(`Job configuration not found: ${jobName}`);
    }

    if (this.jobs.has(jobName)) {
      console.log(`Job ${jobName} is already running`);
      return;
    }

    console.log(`Starting job: ${jobName} (interval: ${config.intervalMs}ms)`);

    // Run the job immediately on start
    this.executeJobWithRetry(jobName);

    // Schedule recurring execution
    const timer = setInterval(() => {
      if (!this.isShuttingDown) {
        this.executeJobWithRetry(jobName);
      }
    }, config.intervalMs);

    this.jobs.set(jobName, timer);
  }

  /**
   * Stop a specific job
   */
  async stopJob(jobName: string): Promise<void> {
    const timer = this.jobs.get(jobName);
    if (timer) {
      clearInterval(timer);
      this.jobs.delete(jobName);
      console.log(`Stopped job: ${jobName}`);
    }

    // Wait for active job execution to complete
    if (this.activeJobs.has(jobName)) {
      console.log(`Waiting for active job ${jobName} to complete...`);
      while (this.activeJobs.has(jobName)) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }

  /**
   * Stop all background jobs
   */
  async stopAllJobs(): Promise<void> {
    this.isShuttingDown = true;
    console.log('Stopping all background jobs...');

    const stopPromises = Array.from(this.jobs.keys()).map(jobName => this.stopJob(jobName));
    await Promise.all(stopPromises);

    console.log('All background jobs stopped');
  }

  /**
   * Execute a job with retry logic
   */
  private async executeJobWithRetry(jobName: string, retryCount = 0): Promise<void> {
    const config = this.jobConfigs.get(jobName);
    if (!config || this.isShuttingDown) {
      return;
    }

    if (this.activeJobs.has(jobName)) {
      console.log(`Job ${jobName} is already running, skipping execution`);
      return;
    }

    this.activeJobs.add(jobName);
    const startTime = new Date();

    try {
      const result = await this.executeJob(jobName);
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      this.recordJobResult({
        jobName,
        success: true,
        startTime,
        endTime,
        duration,
        result,
        retryCount
      });

      console.log(`Job ${jobName} completed successfully in ${duration}ms`);
    } catch (error) {
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();
      const errorMessage = error instanceof Error ? error.message : String(error);

      console.error(`Job ${jobName} failed after ${duration}ms:`, errorMessage);

      if (retryCount < config.maxRetries) {
        console.log(`Retrying job ${jobName} in ${config.retryDelayMs}ms (attempt ${retryCount + 1}/${config.maxRetries})`);
        
        setTimeout(() => {
          this.activeJobs.delete(jobName);
          this.executeJobWithRetry(jobName, retryCount + 1);
        }, config.retryDelayMs);
        return;
      }

      this.recordJobResult({
        jobName,
        success: false,
        startTime,
        endTime,
        duration,
        error: errorMessage,
        retryCount
      });
    } finally {
      this.activeJobs.delete(jobName);
    }
  }

  /**
   * Execute a specific job
   */
  private async executeJob(jobName: string): Promise<CommonJobResult> {
    switch (jobName) {
      case 'session-cleanup':
        return await this.runSessionCleanupJob();
      
      case 'dormant-detection':
        return await this.runDormantDetectionJob();
      
      case 'retention-enforcement':
        return await this.runRetentionEnforcementJob();
      
      case 'cache-optimization':
        return await this.runCacheOptimizationJob();
      
      default:
        throw new Error(`Unknown job: ${jobName}`);
    }
  }

  /**
   * Session cleanup job implementation
   */
  private async runSessionCleanupJob(): Promise<CommonJobResult> {
    console.log('Running session cleanup job...');
    
    const cleanedCount = await sessionManagerService.cleanupOrphanedSessions();
    const stats = await sessionManagerService.getCleanupStats();
    
    return {
      cleanedSessions: cleanedCount,
      stats
    };
  }

  /**
   * Dormant session detection job implementation
   */
  private async runDormantDetectionJob(): Promise<CommonJobResult> {
    console.log('Running dormant session detection job...');
    
    const dormantCount = await sessionManagerService.detectDormantSessions();
    
    return {
      dormantSessionsDetected: dormantCount
    };
  }

  /**
   * Retention policy enforcement job implementation
   */
  private async runRetentionEnforcementJob(): Promise<CommonJobResult> {
    console.log('Running retention policy enforcement job...');
    
    const results = {
      archivedSessions: 0,
      deletedSessions: 0,
      processedPolicies: 0
    };

    // Get all retention policies
    const policies = sessionManagerService.getAllRetentionPolicies();
    
    for (const policy of policies) {
      try {
        const policyResults = await this.enforceRetentionPolicy(policy);
        results.archivedSessions += policyResults.archivedSessions;
        results.deletedSessions += policyResults.deletedSessions;
        results.processedPolicies++;
      } catch (error) {
        console.error(`Error enforcing retention policy ${policy.name}:`, error);
      }
    }
    
    return results;
  }

  /**
   * Cache optimization job implementation
   */
  private async runCacheOptimizationJob(): Promise<CommonJobResult> {
    console.log('Running cache optimization job...');
    
    // This would implement cache cleanup and optimization logic
    // For now, we'll return basic stats
    return {
      optimizedCacheEntries: 0,
      freedMemory: 0
    };
  }

  /**
   * Enforce a specific retention policy
   */
  private async enforceRetentionPolicy(policy: RetentionPolicy): Promise<{ archivedSessions: number; deletedSessions: number }> {
    const results = { archivedSessions: 0, deletedSessions: 0 };
    
    try {
      // Archive sessions that have exceeded their active TTL
      const archiveThreshold = new Date(Date.now() - policy.activeSessionTtl * 60 * 60 * 1000);
      
      // Find sessions to archive (active sessions past their TTL)
      const { db } = await import('../database/index.js');
      const sessionsToArchive = await db.query(`
        SELECT id, session_key
        FROM sessions
        WHERE retention_policy = $1
          AND status IN ('active', 'completed')
          AND archived_at IS NULL
          AND (expires_at IS NULL OR expires_at < $2)
          AND last_activity_at < $2
      `, [policy.name, archiveThreshold]);

      for (const session of sessionsToArchive.rows) {
        try {
          await sessionManagerService.archiveSession(session.id);
          results.archivedSessions++;
        } catch (error) {
          console.error(`Error archiving session ${session.id}:`, error);
        }
      }

      // Delete archived sessions that have exceeded their archived TTL
      const deleteThreshold = new Date(Date.now() - policy.archivedSessionTtl * 24 * 60 * 60 * 1000);
      
      const sessionsToDelete = await db.query(`
        SELECT id, session_key
        FROM sessions
        WHERE retention_policy = $1
          AND archived_at IS NOT NULL
          AND archived_at < $2
      `, [policy.name, deleteThreshold]);

      for (const session of sessionsToDelete.rows) {
        try {
          // Delete session and all related data
          await db.query('DELETE FROM sessions WHERE id = $1', [session.id]);
          results.deletedSessions++;
          console.log(`Deleted expired archived session: ${session.session_key}`);
        } catch (error) {
          console.error(`Error deleting session ${session.id}:`, error);
        }
      }

      console.log(`Retention policy ${policy.name}: archived ${results.archivedSessions}, deleted ${results.deletedSessions}`);
    } catch (error) {
      console.error(`Error enforcing retention policy ${policy.name}:`, error);
      throw error;
    }
    
    return results;
  }

  /**
   * Record job execution result and update statistics
   */
  private recordJobResult(result: JobResult): void {
    const stats = this.jobStats.get(result.jobName);
    if (!stats) return;

    stats.totalRuns++;
    stats.lastRun = result.endTime;

    if (result.success) {
      stats.successfulRuns++;
      stats.lastSuccess = result.endTime;
    } else {
      stats.failedRuns++;
      stats.lastFailure = result.endTime;
    }

    // Update average duration (simple moving average)
    stats.averageDuration = ((stats.averageDuration * (stats.totalRuns - 1)) + result.duration) / stats.totalRuns;

    this.jobStats.set(result.jobName, stats);
  }

  /**
   * Get job statistics
   */
  getJobStats(jobName?: string): JobStats | Map<string, JobStats> {
    if (jobName) {
      const stats = this.jobStats.get(jobName);
      if (!stats) {
        throw new Error(`Job not found: ${jobName}`);
      }
      return stats;
    }
    return new Map(this.jobStats);
  }

  /**
   * Get job configuration
   */
  getJobConfig(jobName: string): JobConfig | undefined {
    return this.jobConfigs.get(jobName);
  }

  /**
   * Update job configuration
   */
  updateJobConfig(jobName: string, updates: Partial<JobConfig>): void {
    const config = this.jobConfigs.get(jobName);
    if (!config) {
      throw new Error(`Job not found: ${jobName}`);
    }

    const updatedConfig = { ...config, ...updates };
    this.jobConfigs.set(jobName, updatedConfig);

    // Restart the job if it's running and the interval changed
    if (this.jobs.has(jobName) && updates.intervalMs && updates.intervalMs !== config.intervalMs) {
      this.stopJob(jobName).then(() => {
        if (updatedConfig.enabled) {
          this.startJob(jobName);
        }
      });
    }

    console.log(`Updated job configuration for ${jobName}`);
  }

  /**
   * Get list of all job names
   */
  getJobNames(): string[] {
    return Array.from(this.jobConfigs.keys());
  }

  /**
   * Get status of all jobs
   */
  getJobStatus(): Record<string, { running: boolean; config: JobConfig; stats: JobStats }> {
    const status: Record<string, { running: boolean; config: JobConfig; stats: JobStats }> = {};
    
    for (const [jobName, config] of this.jobConfigs) {
      const stats = this.jobStats.get(jobName)!;
      status[jobName] = {
        running: this.jobs.has(jobName),
        config,
        stats
      };
    }
    
    return status;
  }

  /**
   * Force run a job immediately (outside of its schedule)
   */
  async runJobNow(jobName: string): Promise<JobResult> {
    const config = this.jobConfigs.get(jobName);
    if (!config) {
      throw new Error(`Job not found: ${jobName}`);
    }

    if (this.activeJobs.has(jobName)) {
      throw new Error(`Job ${jobName} is already running`);
    }

    console.log(`Manually triggering job: ${jobName}`);
    
    const startTime = new Date();
    this.activeJobs.add(jobName);

    try {
      const result = await this.executeJob(jobName);
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      const jobResult: JobResult = {
        jobName,
        success: true,
        startTime,
        endTime,
        duration,
        result,
        retryCount: 0
      };

      this.recordJobResult(jobResult);
      return jobResult;
    } catch (error) {
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();
      const errorMessage = error instanceof Error ? error.message : String(error);

      const jobResult: JobResult = {
        jobName,
        success: false,
        startTime,
        endTime,
        duration,
        error: errorMessage,
        retryCount: 0
      };

      this.recordJobResult(jobResult);
      throw error;
    } finally {
      this.activeJobs.delete(jobName);
    }
  }
}

export const backgroundJobScheduler = new BackgroundJobScheduler();
export { BackgroundJobScheduler };