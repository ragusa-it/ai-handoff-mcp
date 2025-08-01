import { registerSessionTool } from '../registerSession.js';
import { monitoredDb } from '../../../database/monitoredDatabase.js';
import { sessionManagerService } from '../../../services/sessionManager.js';
import { handleToolError, createSuccessResponse, createFailureResponse } from '../../utils/errorHandler.js';

// Mock the monitored database
jest.mock('../../../database/monitoredDatabase.js', () => ({
  monitoredDb: {
    getSession: jest.fn(),
    createSession: jest.fn(),
    query: jest.fn(),
    setCache: jest.fn(),
    getCache: jest.fn(),
    addContextEntry: jest.fn()
  }
}));

// Mock the session manager service
jest.mock('../../../services/sessionManager.js', () => ({
  sessionManagerService: {
    scheduleExpiration: jest.fn()
  }
}));

// Mock the error handler
jest.mock('../../utils/errorHandler.js', () => ({
  handleToolError: jest.fn(),
  createSuccessResponse: jest.fn((data) => data),
  createFailureResponse: jest.fn((message, data) => ({ success: false, message, ...data }))
}));

describe('registerSessionTool', () => {
  const mockDb = monitoredDb as jest.Mocked<typeof monitoredDb>;
  const mockSessionManager = sessionManagerService as jest.Mocked<typeof sessionManagerService>;
  const mockHandleToolError = handleToolError as jest.MockedFunction<typeof handleToolError>;
  const mockCreateSuccessResponse = createSuccessResponse as jest.MockedFunction<typeof createSuccessResponse>;
  const mockCreateFailureResponse = createFailureResponse as jest.MockedFunction<typeof createFailureResponse>;

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
    metadata: {}
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('successful registration', () => {
    it('should register a new session successfully', async () => {
      mockDb.getSession.mockResolvedValueOnce(null); // Session doesn't exist
      mockDb.createSession.mockResolvedValueOnce(mockSession);
      mockSessionManager.scheduleExpiration.mockResolvedValueOnce(undefined);
      mockDb.addContextEntry.mockResolvedValueOnce({
        id: 'context-entry-id',
        sessionId: 'test-session-id',
        sequenceNumber: 1,
        contextType: 'system',
        content: 'Session registered',
        metadata: { action: 'session_registered' },
        createdAt: new Date()
      });

      const args = {
        sessionKey: 'test-session-key',
        agentFrom: 'test-agent',
        metadata: { test: 'data' }
      };

      const result = await registerSessionTool(args);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Session registered successfully');
      expect(result.session).toEqual(mockSession);
      
      // Verify all the expected calls were made
      expect(mockDb.getSession).toHaveBeenCalledWith('test-session-key');
      expect(mockDb.createSession).toHaveBeenCalledWith('test-session-key', 'test-agent', { test: 'data' });
      expect(mockSessionManager.scheduleExpiration).toHaveBeenCalledWith('test-session-id');
      expect(mockDb.addContextEntry).toHaveBeenCalledWith(
        'test-session-id',
        'system',
        expect.any(String),
        expect.objectContaining({ action: 'session_registered', test: 'data' })
      );
    });
  });

  describe('session already exists', () => {
    it('should return failure response when session already exists', async () => {
      mockDb.getSession.mockResolvedValueOnce(mockSession);

      const args = {
        sessionKey: 'test-session-key',
        agentFrom: 'test-agent',
        metadata: { test: 'data' }
      };

      const result = await registerSessionTool(args);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Session already exists');
      expect(result.existingSession).toEqual({
        id: mockSession.id,
        status: mockSession.status,
        agentFrom: mockSession.agentFrom,
        createdAt: mockSession.createdAt
      });
      
      expect(mockDb.getSession).toHaveBeenCalledWith('test-session-key');
      expect(mockDb.createSession).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle database errors gracefully', async () => {
      const error = new Error('Database connection failed');
      mockDb.getSession.mockRejectedValueOnce(error);
      mockHandleToolError.mockImplementationOnce(() => ({
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: 'Database connection failed',
            details: 'Tool execution failed'
          })
        }]
      }));

      const args = {
        sessionKey: 'test-session-key',
        agentFrom: 'test-agent'
      };

      const result = await registerSessionTool(args);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database connection failed');
      expect(mockHandleToolError).toHaveBeenCalled();
    });

    it('should handle session creation errors', async () => {
      const error = new Error('Failed to create session');
      mockDb.getSession.mockResolvedValueOnce(null);
      mockDb.createSession.mockRejectedValueOnce(error);
      mockHandleToolError.mockImplementationOnce(() => ({
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: 'Failed to create session',
            details: 'Tool execution failed'
          })
        }]
      }));

      const args = {
        sessionKey: 'test-session-key',
        agentFrom: 'test-agent'
      };

      const result = await registerSessionTool(args);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to create session');
      expect(mockHandleToolError).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle empty metadata', async () => {
      mockDb.getSession.mockResolvedValueOnce(null);
      mockDb.createSession.mockResolvedValueOnce(mockSession);
      mockSessionManager.scheduleExpiration.mockResolvedValueOnce(undefined);
      mockDb.addContextEntry.mockResolvedValueOnce({
        id: 'context-entry-id',
        sessionId: 'test-session-id',
        sequenceNumber: 1,
        contextType: 'system',
        content: 'Session registered',
        metadata: { action: 'session_registered' },
        createdAt: new Date()
      });

      const args = {
        sessionKey: 'test-session-key',
        agentFrom: 'test-agent'
        // No metadata provided
      };

      const result = await registerSessionTool(args);

      expect(result.success).toBe(true);
      expect(mockDb.createSession).toHaveBeenCalledWith('test-session-key', 'test-agent', {});
      expect(mockDb.addContextEntry).toHaveBeenCalledWith(
        'test-session-id',
        'system',
        expect.any(String),
        expect.objectContaining({ action: 'session_registered' })
      );
    });

    it('should handle session scheduling errors gracefully', async () => {
      const error = new Error('Failed to schedule expiration');
      mockDb.getSession.mockResolvedValueOnce(null);
      mockDb.createSession.mockResolvedValueOnce(mockSession);
      mockSessionManager.scheduleExpiration.mockRejectedValueOnce(error);
      mockDb.addContextEntry.mockResolvedValueOnce({
        id: 'context-entry-id',
        sessionId: 'test-session-id',
        sequenceNumber: 1,
        contextType: 'system',
        content: 'Session registered',
        metadata: { action: 'session_registered' },
        createdAt: new Date()
      });

      const args = {
        sessionKey: 'test-session-key',
        agentFrom: 'test-agent'
      };

      // Should still succeed even if scheduling fails
      const result = await registerSessionTool(args);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Session registered successfully');
    });
  });
});