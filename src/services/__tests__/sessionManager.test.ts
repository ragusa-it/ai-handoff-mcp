import { SessionManagerService, type RetentionPolicy } from '../sessionManager.js';
import { monitoredDb } from '../../database/monitoredDatabase.js';

// Mock the monitored database
jest.mock('../../database/monitoredDatabase.js', () => ({
  monitoredDb: {
    query: jest.fn(),
    getCache: jest.fn(),
    setCache: jest.fn(),
    deleteCache: jest.fn()
  }
}));

describe('SessionManagerService', () => {
  let sessionManager: SessionManagerService;
  const mockDb = monitoredDb as jest.Mocked<typeof monitoredDb>;

  const mockSession = {
    id: 'test-session-id',
    sessionKey: 'test-session-key',
    agentFrom: 'agent1',
    agentTo: 'agent2',
    status: 'active' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastActivityAt: new Date(),
    isDormant: false,
    retentionPolicy: 'standard',
    metadata: {}
  };

  beforeEach(() => {
    sessionManager = new SessionManagerService();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('Retention Policy Management', () => {
    it('should initialize with default retention policies', () => {
      const policies = sessionManager.getAllRetentionPolicies();
      expect(policies).toHaveLength(3);
      
      const standardPolicy = sessionManager.getRetentionPolicy('standard');
      expect(standardPolicy).toBeDefined();
      expect(standardPolicy?.activeSessionTtl).toBe(24);
    });

    it('should update retention policy successfully', async () => {
      const customPolicy: RetentionPolicy = {
        name: 'custom',
        activeSessionTtl: 48,
        archivedSessionTtl: 60,
        logRetentionDays: 14,
        metricsRetentionDays: 60,
        dormantThresholdHours: 4
      };

      await sessionManager.updateRetentionPolicy(customPolicy);
      
      const retrievedPolicy = sessionManager.getRetentionPolicy('custom');
      expect(retrievedPolicy).toEqual(customPolicy);
    });

    it('should reject invalid retention policy', async () => {
      const invalidPolicy: RetentionPolicy = {
        name: '',
        activeSessionTtl: -1,
        archivedSessionTtl: 0,
        logRetentionDays: 0,
        metricsRetentionDays: 0,
        dormantThresholdHours: 0
      };

      await expect(sessionManager.updateRetentionPolicy(invalidPolicy))
        .rejects.toThrow('Invalid retention policy configuration');
    });
  });

  describe('Session Lifecycle Management', () => {
    beforeEach(() => {
      mockDb.query.mockResolvedValue({ rows: [mockSession], rowCount: 1 });
    });

    it('should schedule session expiration', async () => {
      await sessionManager.scheduleExpiration('test-session-id');

      expect(mockDb.query).toHaveBeenCalledWith(
        'SELECT * FROM sessions WHERE id = $1',
        ['test-session-id']
      );
      
      expect(mockDb.query).toHaveBeenCalledWith(
        'UPDATE sessions SET expires_at = $1 WHERE id = $2',
        expect.arrayContaining(['test-session-id'])
      );
    });

    it('should expire session successfully', async () => {
      await sessionManager.expireSession('test-session-id');

      expect(mockDb.query).toHaveBeenCalledWith(
        'UPDATE sessions SET status = $1, updated_at = NOW() WHERE id = $2',
        ['expired', 'test-session-id']
      );
    });

    it('should archive session successfully', async () => {
      await sessionManager.archiveSession('test-session-id');

      expect(mockDb.query).toHaveBeenCalledWith(
        'UPDATE sessions SET archived_at = $1, is_dormant = true, updated_at = NOW() WHERE id = $2',
        expect.arrayContaining(['test-session-id'])
      );

      expect(mockDb.setCache).toHaveBeenCalledWith(
        'archived_session:test-session-id',
        expect.objectContaining({ id: 'test-session-id' }),
        7 * 24 * 60 * 60
      );
    });

    it('should mark session as dormant', async () => {
      await sessionManager.markSessionDormant('test-session-id');

      expect(mockDb.query).toHaveBeenCalledWith(
        'UPDATE sessions SET is_dormant = true, updated_at = NOW() WHERE id = $1',
        ['test-session-id']
      );
    });

    it('should skip reactivation for non-dormant session', async () => {
      await sessionManager.reactivateSession('test-session-id');

      // Should only call getSessionById, not the update
      expect(mockDb.query).toHaveBeenCalledWith(
        'SELECT * FROM sessions WHERE id = $1',
        ['test-session-id']
      );
      
      // Should not call update since session is not dormant
      expect(mockDb.query).not.toHaveBeenCalledWith(
        'UPDATE sessions SET is_dormant = false, last_activity_at = NOW(), updated_at = NOW() WHERE id = $1',
        ['test-session-id']
      );
    });

    it('should handle session not found error', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await expect(sessionManager.expireSession('non-existent-id'))
        .rejects.toThrow('Session non-existent-id not found');
    });
  });

  describe('Session Cleanup', () => {
    it('should cleanup orphaned sessions', async () => {
      const orphanedSessions = [
        { id: 'orphan1', session_key: 'key1', status: 'active', last_activity_at: new Date() },
        { id: 'orphan2', session_key: 'key2', status: 'active', last_activity_at: new Date() }
      ];

      const expiredSessions = [
        { id: 'expired1', session_key: 'key3', status: 'active' }
      ];

      mockDb.query
        .mockResolvedValueOnce({ rows: orphanedSessions, rowCount: 2 }) // orphaned query
        .mockResolvedValueOnce({ rows: expiredSessions, rowCount: 1 }) // expired query
        .mockResolvedValue({ rows: [mockSession], rowCount: 1 }); // session lookups

      const cleanedCount = await sessionManager.cleanupOrphanedSessions();

      expect(cleanedCount).toBeGreaterThan(0);
      // Verify the orphaned sessions query was called
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('LEFT JOIN context_history ch ON s.id = ch.session_id')
      );
    });

    it('should get cleanup statistics', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ count: '5' }], rowCount: 1 }) // expired
        .mockResolvedValueOnce({ rows: [{ count: '3' }], rowCount: 1 }) // archived
        .mockResolvedValueOnce({ rows: [{ count: '2' }], rowCount: 1 }); // orphaned

      const stats = await sessionManager.getCleanupStats();

      expect(stats).toEqual({
        expiredSessions: 5,
        archivedSessions: 3,
        orphanedSessions: 2,
        deletedSessions: 0
      });
    });
  });

  describe('Dormant Session Detection', () => {
    it('should detect and mark dormant sessions', async () => {
      const activeSessions = [
        { id: 'session1', session_key: 'key1', last_activity_at: new Date() },
        { id: 'session2', session_key: 'key2', last_activity_at: new Date() }
      ];

      mockDb.query
        .mockResolvedValueOnce({ rows: activeSessions, rowCount: 2 }) // standard policy
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // extended policy
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // short policy
        .mockResolvedValue({ rows: [mockSession], rowCount: 1 }); // session lookups

      const processedCount = await sessionManager.detectDormantSessions();

      expect(processedCount).toBe(2);
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      mockDb.query.mockRejectedValue(new Error('Database connection failed'));

      await expect(sessionManager.expireSession('test-id'))
        .rejects.toThrow('Database connection failed');
    });

    it('should not throw on lifecycle logging errors', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [mockSession], rowCount: 1 }) // get session
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // update session
        .mockRejectedValueOnce(new Error('Logging failed')); // log lifecycle event

      // Should not throw despite logging error
      await expect(sessionManager.expireSession('test-id')).resolves.not.toThrow();
    });
  });
});