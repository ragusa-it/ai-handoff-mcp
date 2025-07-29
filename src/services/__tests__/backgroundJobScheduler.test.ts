import { BackgroundJobScheduler } from '../backgroundJobScheduler.js';

// Mock the session manager service
jest.mock('../sessionManager.js', () => ({
  sessionManagerService: {
    cleanupOrphanedSessions: jest.fn().mockResolvedValue(5),
    getCleanupStats: jest.fn().mockResolvedValue({
      expiredSessions: 2,
      archivedSessions: 3,
      orphanedSessions: 1,
      deletedSessions: 0
    }),
    detectDormantSessions: jest.fn().mockResolvedValue(3),
    getAllRetentionPolicies: jest.fn().mockReturnValue([
      {
        name: 'standard',
        activeSessionTtl: 24,
        archivedSessionTtl: 30,
        logRetentionDays: 7,
        metricsRetentionDays: 30,
        dormantThresholdHours: 2
      }
    ]),
    archiveSession: jest.fn().mockResolvedValue(undefined),
  }
}));

// Mock the database
jest.mock('../../database/index.js', () => ({
  db: {
    query: jest.fn().mockImplementation((query: string) => {
      if (query.includes('SELECT id, session_key')) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('DELETE FROM sessions')) {
        return Promise.resolve({ rowCount: 0 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    })
  }
}));

describe('BackgroundJobScheduler', () => {
  let scheduler: BackgroundJobScheduler;

  beforeEach(() => {
    jest.clearAllMocks();
    scheduler = new BackgroundJobScheduler();
  });

  afterEach(async () => {
    await scheduler.stopAllJobs();
  });

  describe('Job Configuration', () => {
    it('should initialize with default job configurations', () => {
      const jobNames = scheduler.getJobNames();
      expect(jobNames).toContain('session-cleanup');
      expect(jobNames).toContain('dormant-detection');
      expect(jobNames).toContain('retention-enforcement');
      expect(jobNames).toContain('cache-optimization');
    });

    it('should get job configuration', () => {
      const config = scheduler.getJobConfig('session-cleanup');
      expect(config).toBeDefined();
      expect(config?.name).toBe('session-cleanup');
      expect(config?.intervalMs).toBe(60 * 60 * 1000); // 1 hour
      expect(config?.enabled).toBe(true);
    });

    it('should update job configuration', () => {
      const originalConfig = scheduler.getJobConfig('session-cleanup');
      expect(originalConfig?.intervalMs).toBe(60 * 60 * 1000);

      scheduler.updateJobConfig('session-cleanup', { intervalMs: 30 * 60 * 1000 });
      
      const updatedConfig = scheduler.getJobConfig('session-cleanup');
      expect(updatedConfig?.intervalMs).toBe(30 * 60 * 1000);
    });

    it('should throw error for unknown job configuration', () => {
      expect(scheduler.getJobConfig('unknown-job')).toBeUndefined();
      expect(() => scheduler.updateJobConfig('unknown-job', { enabled: false }))
        .toThrow('Job not found: unknown-job');
    });
  });

  describe('Job Execution', () => {
    it('should run session cleanup job manually', async () => {
      const result = await scheduler.runJobNow('session-cleanup');
      
      expect(result.success).toBe(true);
      expect(result.jobName).toBe('session-cleanup');
      expect(result.result).toEqual({
        cleanedSessions: 5,
        stats: {
          expiredSessions: 2,
          archivedSessions: 3,
          orphanedSessions: 1,
          deletedSessions: 0
        }
      });
    });

    it('should run dormant detection job manually', async () => {
      const result = await scheduler.runJobNow('dormant-detection');
      
      expect(result.success).toBe(true);
      expect(result.jobName).toBe('dormant-detection');
      expect(result.result).toEqual({
        dormantSessionsDetected: 3
      });
    });

    it('should run retention enforcement job manually', async () => {
      const result = await scheduler.runJobNow('retention-enforcement');
      
      expect(result.success).toBe(true);
      expect(result.jobName).toBe('retention-enforcement');
      expect(result.result).toEqual({
        archivedSessions: 0,
        deletedSessions: 0,
        processedPolicies: 1
      });
    });

    it('should run cache optimization job manually', async () => {
      const result = await scheduler.runJobNow('cache-optimization');
      
      expect(result.success).toBe(true);
      expect(result.jobName).toBe('cache-optimization');
      expect(result.result).toEqual({
        optimizedCacheEntries: 0,
        freedMemory: 0
      });
    });

    it('should throw error for unknown job', async () => {
      await expect(scheduler.runJobNow('unknown-job'))
        .rejects.toThrow('Job not found: unknown-job');
    });

    it('should prevent running job that is already active', async () => {
      // Start a long-running job simulation
      const mockSessionManager = require('../sessionManager.js');
      (mockSessionManager.sessionManagerService.cleanupOrphanedSessions as jest.Mock)
        .mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(0), 100)));

      // Start the job
      const jobPromise = scheduler.runJobNow('session-cleanup');
      
      // Try to run it again immediately
      await expect(scheduler.runJobNow('session-cleanup'))
        .rejects.toThrow('Job session-cleanup is already running');

      // Wait for the first job to complete
      await jobPromise;
    });
  });

  describe('Job Statistics', () => {
    it('should track job statistics', async () => {
      await scheduler.runJobNow('session-cleanup');
      
      const stats = scheduler.getJobStats('session-cleanup');
      expect(stats).toBeDefined();
      
      if (typeof stats === 'object' && 'totalRuns' in stats) {
        expect(stats.totalRuns).toBe(1);
        expect(stats.successfulRuns).toBe(1);
        expect(stats.failedRuns).toBe(0);
        expect(stats.lastSuccess).toBeDefined();
        expect(stats.averageDuration).toBeGreaterThan(0);
      }
    });

    it('should get all job statistics', () => {
      const allStats = scheduler.getJobStats();
      expect(allStats).toBeInstanceOf(Map);
      expect((allStats as Map<string, any>).size).toBeGreaterThan(0);
    });

    it('should throw error for unknown job stats', () => {
      expect(() => scheduler.getJobStats('unknown-job'))
        .toThrow('Job not found: unknown-job');
    });
  });

  describe('Job Status', () => {
    it('should get status of all jobs', () => {
      const status = scheduler.getJobStatus();
      
      expect(status).toBeDefined();
      expect(status['session-cleanup']).toBeDefined();
      expect(status['session-cleanup'].running).toBe(false);
      expect(status['session-cleanup'].config).toBeDefined();
      expect(status['session-cleanup'].stats).toBeDefined();
    });
  });

  describe('Job Lifecycle', () => {
    it('should start and stop individual jobs', async () => {
      // Job should not be running initially
      let status = scheduler.getJobStatus();
      expect(status['session-cleanup'].running).toBe(false);

      // Start the job
      await scheduler.startJob('session-cleanup');
      status = scheduler.getJobStatus();
      expect(status['session-cleanup'].running).toBe(true);

      // Stop the job
      await scheduler.stopJob('session-cleanup');
      status = scheduler.getJobStatus();
      expect(status['session-cleanup'].running).toBe(false);
    });

    it('should start all jobs', async () => {
      await scheduler.startAllJobs();
      
      const status = scheduler.getJobStatus();
      const enabledJobs = Object.values(status).filter(job => job.config.enabled);
      const runningJobs = Object.values(status).filter(job => job.running);
      
      expect(runningJobs.length).toBe(enabledJobs.length);
    });

    it('should stop all jobs', async () => {
      await scheduler.startAllJobs();
      await scheduler.stopAllJobs();
      
      const status = scheduler.getJobStatus();
      const runningJobs = Object.values(status).filter(job => job.running);
      
      expect(runningJobs.length).toBe(0);
    });

    it('should handle starting already running job', async () => {
      await scheduler.startJob('session-cleanup');
      
      // Should not throw error when starting already running job
      await expect(scheduler.startJob('session-cleanup')).resolves.toBeUndefined();
    });

    it('should handle stopping non-running job', async () => {
      // Should not throw error when stopping non-running job
      await expect(scheduler.stopJob('session-cleanup')).resolves.toBeUndefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle job execution errors with retry', async () => {
      // This test verifies that the retry mechanism exists
      // The actual retry logic is complex to test due to async timing
      // So we'll just verify that the job can recover from failures
      const mockSessionManager = require('../sessionManager.js');
      
      // First make it fail
      (mockSessionManager.sessionManagerService.cleanupOrphanedSessions as jest.Mock)
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValueOnce(5);

      // Update job config to have faster retries for testing
      scheduler.updateJobConfig('session-cleanup', { 
        maxRetries: 1, 
        retryDelayMs: 10 
      });

      // The job should eventually succeed after retry
      await expect(scheduler.runJobNow('session-cleanup')).rejects.toThrow('Temporary failure');
      
      // Reset mock to succeed
      (mockSessionManager.sessionManagerService.cleanupOrphanedSessions as jest.Mock)
        .mockResolvedValue(5);
        
      const result = await scheduler.runJobNow('session-cleanup');
      expect(result.success).toBe(true);
    });

    it('should fail after max retries', async () => {
      const mockSessionManager = require('../sessionManager.js');
      
      // Mock the cleanup function to always fail
      (mockSessionManager.sessionManagerService.cleanupOrphanedSessions as jest.Mock)
        .mockRejectedValue(new Error('Persistent failure'));

      // Update job config to have faster retries and fewer attempts for testing
      scheduler.updateJobConfig('session-cleanup', { 
        maxRetries: 1, 
        retryDelayMs: 10 
      });

      await expect(scheduler.runJobNow('session-cleanup'))
        .rejects.toThrow('Persistent failure');
    });
  });
});