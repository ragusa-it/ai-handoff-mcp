import { updateContextTool } from '../updateContext.js';
import { monitoredDb } from '../../../database/monitoredDatabase.js';
import { sessionManagerService } from '../../../services/sessionManager.js';
import { structuredLogger } from '../../../services/structuredLogger.js';

// Mock the monitored database
jest.mock('../../../database/monitoredDatabase.js', () => ({
  monitoredDb: {
    getSession: jest.fn(),
    query: jest.fn(),
    setCache: jest.fn(),
    getCache: jest.fn(),
    deleteCache: jest.fn(),
    addContextEntry: jest.fn()
  }
}));

// Mock the session manager service
jest.mock('../../../services/sessionManager.js', () => ({
  sessionManagerService: {
    reactivateSession: jest.fn()
  }
}));

// Mock the structured logger
jest.mock('../../../services/structuredLogger.js', () => ({
  structuredLogger: {
    logError: jest.fn()
  }
}));

describe('updateContextTool', () => {
  const mockDb = monitoredDb as jest.Mocked<typeof monitoredDb>;
  const mockSessionManager = sessionManagerService as jest.Mocked<typeof sessionManagerService>;
  const mockLogger = structuredLogger as jest.Mocked<typeof structuredLogger>;

  const mockSession = {
    id: 'test-session-id',
    sessionKey: 'test-session-key',
    agentFrom: 'test-agent',
    agentTo: undefined,
    status: 'active' as const,
    createdAt: new Date('2023-01-01T00:00:00Z'),
    updatedAt: new Date('2023-01-01T00:00:00Z'),
    lastActivityAt: new Date('2023-01-01T00:00:00Z'),
    isDormant: false,
    retentionPolicy: 'standard',
    metadata: {},
    expiresAt: undefined,
    archivedAt: undefined
  };

  const mockDormantSession = {
    id: 'test-session-id',
    sessionKey: 'test-session-key',
    agentFrom: 'test-agent',
    agentTo: undefined,
    status: 'active' as const,
    createdAt: new Date('2023-01-01T00:00:00Z'),
    updatedAt: new Date('2023-01-01T00:00:00Z'),
    lastActivityAt: new Date('2023-01-01T00:00:00Z'),
    isDormant: true,
    retentionPolicy: 'standard',
    metadata: {},
    expiresAt: undefined,
    archivedAt: undefined
  };

  const mockContextEntry = {
    id: 'context-entry-id',
    sessionId: 'test-session-id',
    sequenceNumber: 1,
    contextType: 'message' as const,
    content: 'Test message content',
    metadata: { test: 'metadata' },
    createdAt: new Date('2023-01-01T00:00:00Z'),
    processingTimeMs: 10,
    contentSizeBytes: 100
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock console.error to prevent test output pollution
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('successful context update', () => {
    it('should update context successfully for active session', async () => {
      mockDb.getSession.mockResolvedValueOnce(mockSession);
      mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // update session query
      mockDb.addContextEntry.mockResolvedValueOnce(mockContextEntry);
      mockDb.setCache.mockResolvedValueOnce(undefined);
      mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // update context entry query

      const args = {
        sessionKey: 'test-session-key',
        contextType: 'message' as const,
        content: 'Test message content',
        metadata: { test: 'metadata' }
      };

      const result = await updateContextTool(args);

      expect(result.content[0].type).toBe('text');
      const parsedResult = JSON.parse(result.content[0].text);
      expect(parsedResult.success).toBe(true);
      expect(parsedResult.message).toBe('Context updated successfully');
      expect(parsedResult.contextEntry.id).toBe('context-entry-id');
      
      // Verify all the expected calls were made
      expect(mockDb.getSession).toHaveBeenCalledWith('test-session-key');
      expect(mockDb.query).toHaveBeenCalledWith(
        'UPDATE sessions SET last_activity_at = NOW(), updated_at = NOW() WHERE id = $1',
        ['test-session-id']
      );
      expect(mockDb.addContextEntry).toHaveBeenCalledWith(
        'test-session-id',
        'message',
        'Test message content',
        expect.objectContaining({ timestamp: expect.any(String), test: 'metadata' })
      );
      expect(mockDb.setCache).toHaveBeenCalledWith(
        'session:test-session-key:latest_context',
        expect.objectContaining({
          lastUpdate: expect.any(Date),
          contextType: 'message',
          sequenceNumber: 1,
          preview: 'Test message content'
        }),
        3600
      );
    });

    it('should reactivate dormant session when updating context', async () => {
      mockDb.getSession.mockResolvedValueOnce(mockDormantSession);
      mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // update session query
      mockSessionManager.reactivateSession.mockResolvedValueOnce(undefined);
      mockDb.addContextEntry.mockResolvedValueOnce(mockContextEntry);
      mockDb.setCache.mockResolvedValueOnce(undefined);
      mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // update context entry query

      const args = {
        sessionKey: 'test-session-key',
        contextType: 'message' as const,
        content: 'Test message content'
      };

      const result = await updateContextTool(args);

      expect(result.content[0].type).toBe('text');
      const parsedResult = JSON.parse(result.content[0].text);
      expect(parsedResult.success).toBe(true);
      
      // Verify session was reactivated
      expect(mockSessionManager.reactivateSession).toHaveBeenCalledWith('test-session-id');
    });
  });

  describe('session validation', () => {
    it('should return error when session is not found', async () => {
      mockDb.getSession.mockResolvedValueOnce(null);

      const args = {
        sessionKey: 'non-existent-session',
        contextType: 'message' as const,
        content: 'Test message content'
      };

      const result = await updateContextTool(args);

      expect(result.content[0].type).toBe('text');
      const parsedResult = JSON.parse(result.content[0].text);
      expect(parsedResult.success).toBe(false);
      expect(parsedResult.error).toBe('Session not found');
      expect(parsedResult.sessionKey).toBe('non-existent-session');
    });

    it('should return error when session is not active', async () => {
      const inactiveSession = { ...mockSession, status: 'completed' as const };
      mockDb.getSession.mockResolvedValueOnce(inactiveSession);

      const args = {
        sessionKey: 'test-session-key',
        contextType: 'message' as const,
        content: 'Test message content'
      };

      const result = await updateContextTool(args);

      expect(result.content[0].type).toBe('text');
      const parsedResult = JSON.parse(result.content[0].text);
      expect(parsedResult.success).toBe(false);
      expect(parsedResult.error).toBe('Session is not active');
      expect(parsedResult.sessionKey).toBe('test-session-key');
      expect(parsedResult.currentStatus).toBe('completed');
    });
  });

  describe('error handling', () => {
    it('should handle database errors gracefully', async () => {
      const error = new Error('Database connection failed');
      mockDb.getSession.mockRejectedValueOnce(error);

      const args = {
        sessionKey: 'test-session-key',
        contextType: 'message' as const,
        content: 'Test message content'
      };

      const result = await updateContextTool(args);

      expect(result.content[0].type).toBe('text');
      const parsedResult = JSON.parse(result.content[0].text);
      expect(parsedResult.success).toBe(false);
      expect(parsedResult.error).toBe('Failed to update context');
      
      // Verify error was logged
      expect(mockLogger.logError).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          component: 'updateContext',
          operation: 'context_update'
        })
      );
    });

    it('should handle context entry creation errors', async () => {
      const error = new Error('Failed to create context entry');
      mockDb.getSession.mockResolvedValueOnce(mockSession);
      mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // update session query
      mockDb.addContextEntry.mockRejectedValueOnce(error);

      const args = {
        sessionKey: 'test-session-key',
        contextType: 'message' as const,
        content: 'Test message content'
      };

      const result = await updateContextTool(args);

      expect(result.content[0].type).toBe('text');
      const parsedResult = JSON.parse(result.content[0].text);
      expect(parsedResult.success).toBe(false);
      expect(parsedResult.error).toBe('Failed to update context');
    });
  });

  describe('content size tracking', () => {
    it('should correctly calculate and store content size', async () => {
      const largeContent = 'A'.repeat(1000); // 1000 character content
      mockDb.getSession.mockResolvedValueOnce(mockSession);
      mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // update session query
      mockDb.addContextEntry.mockResolvedValueOnce({
        ...mockContextEntry,
        content: largeContent
      });
      mockDb.setCache.mockResolvedValueOnce(undefined);
      mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // update context entry query

      const args = {
        sessionKey: 'test-session-key',
        contextType: 'message' as const,
        content: largeContent
      };

      await updateContextTool(args);

      // Verify content size was updated
      expect(mockDb.query).toHaveBeenCalledWith(
        'UPDATE context_history SET content_size_bytes = $1 WHERE id = $2',
        [1000, 'context-entry-id']
      );
    });
  });

  describe('cache management', () => {
    it('should cache latest context with preview', async () => {
      const longContent = 'This is a very long message content that exceeds 200 characters. '.repeat(10);
      mockDb.getSession.mockResolvedValueOnce(mockSession);
      mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // update session query
      mockDb.addContextEntry.mockResolvedValueOnce({
        ...mockContextEntry,
        content: longContent
      });
      mockDb.setCache.mockResolvedValueOnce(undefined);
      mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // update context entry query

      const args = {
        sessionKey: 'test-session-key',
        contextType: 'message' as const,
        content: longContent
      };

      await updateContextTool(args);

      // Verify cache was set with preview
      expect(mockDb.setCache).toHaveBeenCalledWith(
        'session:test-session-key:latest_context',
        expect.objectContaining({
          preview: expect.stringContaining('This is a very long message content that exceeds 200 characters.')
        }),
        3600
      );
      
      // Preview should be truncated with '...'
      const setCacheCall = mockDb.setCache.mock.calls[0];
      const preview = setCacheCall[1].preview;
      expect(preview).toMatch(/\.\.\.$/);
      expect(preview.length).toBeLessThan(longContent.length);
    });
  });
});