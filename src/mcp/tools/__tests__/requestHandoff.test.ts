import { requestHandoffTool } from '../requestHandoff.js';
import { monitoredDb } from '../../../database/monitoredDatabase.js';
import { contextManagerService } from '../../../services/contextManager.js';
import { sessionManagerService } from '../../../services/sessionManager.js';
import { structuredLogger } from '../../../services/structuredLogger.js';
import { monitoringService } from '../../../services/monitoringService.js';

// Mock the monitored database
jest.mock('../../../database/monitoredDatabase.js', () => ({
  monitoredDb: {
    getSession: jest.fn(),
    query: jest.fn(),
    setCache: jest.fn(),
    getCache: jest.fn(),
    deleteCache: jest.fn(),
    addContextEntry: jest.fn(),
    updateSession: jest.fn()
  }
}));

// Mock the context manager service
jest.mock('../../../services/contextManager.js', () => ({
  contextManagerService: {
    getFullContext: jest.fn(),
    createHandoffSummary: jest.fn()
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
    logToolCall: jest.fn(),
    logHandoffEvent: jest.fn(),
    logPerformanceMetric: jest.fn(),
    logError: jest.fn()
  }
}));

// Mock the monitoring service
jest.mock('../../../services/monitoringService.js', () => ({
  monitoringService: {
    recordHandoffMetrics: jest.fn()
  }
}));

describe('requestHandoffTool', () => {
  const mockDb = monitoredDb as jest.Mocked<typeof monitoredDb>;
  const mockContextManager = contextManagerService as jest.Mocked<typeof contextManagerService>;
  const mockSessionManager = sessionManagerService as jest.Mocked<typeof sessionManagerService>;
  const mockLogger = structuredLogger as jest.Mocked<typeof structuredLogger>;
  const mockMonitoring = monitoringService as jest.Mocked<typeof monitoringService>;

  const mockSession = {
    id: 'test-session-id',
    sessionKey: 'test-session-key',
    agentFrom: 'source-agent',
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
    agentFrom: 'source-agent',
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

  const mockFullContext = {
    session: mockSession,
    contextHistory: [
      {
        id: 'context-1',
        sessionId: 'test-session-id',
        sequenceNumber: 1,
        contextType: 'message' as const,
        content: 'Hello',
        metadata: {},
        createdAt: new Date('2023-01-01T00:00:00Z'),
        processingTimeMs: 10,
        contentSizeBytes: 50
      }
    ],
    summary: {
      sessionKey: 'test-session-key',
      summary: 'Test session summary',
      keyPoints: ['1 messages exchanged'],
      messageCount: 1,
      fileCount: 0,
      toolCallCount: 0,
      lastUpdated: new Date('2023-01-01T00:00:00Z'),
      participants: ['source-agent']
    }
  };

  const mockHandoffSummary = {
    sessionKey: 'test-session-key',
    summary: 'Test handoff summary',
    keyPoints: ['Session created'],
    messageCount: 1,
    fileCount: 0,
    toolCallCount: 0,
    lastUpdated: new Date('2023-01-01T00:00:00Z'),
    participants: ['source-agent']
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock console.error to prevent test output pollution
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('successful handoff request', () => {
    it('should process handoff request successfully for context_transfer', async () => {
      mockDb.getSession.mockResolvedValueOnce(mockSession);
      mockContextManager.getFullContext.mockResolvedValueOnce(mockFullContext);
      mockContextManager.createHandoffSummary.mockResolvedValueOnce(mockHandoffSummary);
      mockDb.updateSession.mockResolvedValueOnce(null);
      mockDb.addContextEntry.mockResolvedValueOnce({
        id: 'context-entry-id',
        sessionId: 'test-session-id',
        sequenceNumber: 2,
        contextType: 'system' as const,
        content: 'Handoff requested',
        metadata: {},
        createdAt: new Date()
      });
      mockDb.setCache.mockResolvedValueOnce(undefined);

      const args = {
        sessionKey: 'test-session-key',
        targetAgent: 'target-agent',
        requestType: 'context_transfer' as const,
        requestData: { custom: 'data' }
      };

      const result = await requestHandoffTool(args);

      expect(result.content[0].type).toBe('text');
      const parsedResult = JSON.parse(result.content[0].text);
      expect(parsedResult.success).toBe(true);
      expect(parsedResult.message).toBe('Handoff request processed successfully');
      expect(parsedResult.handoff.sessionKey).toBe('test-session-key');
      expect(parsedResult.handoff.sourceAgent).toBe('source-agent');
      expect(parsedResult.handoff.targetAgent).toBe('target-agent');
      expect(parsedResult.handoff.requestType).toBe('context_transfer');
      expect(parsedResult.handoff.status).toBe('active');
      
      // Verify all the expected calls were made
      expect(mockDb.getSession).toHaveBeenCalledWith('test-session-key');
      expect(mockContextManager.getFullContext).toHaveBeenCalledWith('test-session-key');
      expect(mockContextManager.createHandoffSummary).toHaveBeenCalledWith('test-session-key');
      expect(mockDb.updateSession).toHaveBeenCalledWith('test-session-key', expect.objectContaining({
        agentTo: 'target-agent',
        status: 'active'
      }));
      expect(mockDb.addContextEntry).toHaveBeenCalledWith(
        'test-session-id',
        'system',
        'Handoff requested to agent: target-agent',
        expect.objectContaining({
          action: 'handoff_requested',
          requestType: 'context_transfer',
          targetAgent: 'target-agent'
        })
      );
      expect(mockDb.setCache).toHaveBeenCalledWith(
        'handoff:target-agent:test-session-key',
        expect.objectContaining({
          sessionKey: 'test-session-key',
          sourceAgent: 'source-agent',
          targetAgent: 'target-agent',
          requestType: 'context_transfer',
          fullContext: mockFullContext
        }),
        24 * 3600
      );
      
      // Verify metrics were recorded
      expect(mockMonitoring.recordHandoffMetrics).toHaveBeenCalledWith(
        'test-session-id',
        expect.objectContaining({
          sessionId: 'test-session-id',
          agentFrom: 'source-agent',
          agentTo: 'target-agent',
          success: true
        })
      );
      
      // Verify logging
      expect(mockLogger.logHandoffEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'test-session-id',
          agentFrom: 'source-agent',
          agentTo: 'target-agent',
          handoffType: 'request',
          success: true
        })
      );
    });

    it('should process handoff request successfully for full_handoff', async () => {
      mockDb.getSession.mockResolvedValueOnce(mockSession);
      mockContextManager.getFullContext.mockResolvedValueOnce(mockFullContext);
      mockContextManager.createHandoffSummary.mockResolvedValueOnce(mockHandoffSummary);
      mockDb.updateSession.mockResolvedValueOnce(null);
      mockDb.addContextEntry.mockResolvedValueOnce({
        id: 'context-entry-id',
        sessionId: 'test-session-id',
        sequenceNumber: 2,
        contextType: 'system' as const,
        content: 'Handoff requested',
        metadata: {},
        createdAt: new Date()
      });
      mockDb.setCache.mockResolvedValueOnce(undefined);

      const args = {
        sessionKey: 'test-session-key',
        targetAgent: 'target-agent',
        requestType: 'full_handoff' as const
      };

      const result = await requestHandoffTool(args);

      expect(result.content[0].type).toBe('text');
      const parsedResult = JSON.parse(result.content[0].text);
      expect(parsedResult.success).toBe(true);
      expect(parsedResult.handoff.requestType).toBe('full_handoff');
      expect(parsedResult.handoff.status).toBe('completed'); // Should be completed for full_handoff
    });

    it('should reactivate dormant session when requesting handoff', async () => {
      mockDb.getSession.mockResolvedValueOnce(mockDormantSession);
      mockContextManager.getFullContext.mockResolvedValueOnce(mockFullContext);
      mockContextManager.createHandoffSummary.mockResolvedValueOnce(mockHandoffSummary);
      mockSessionManager.reactivateSession.mockResolvedValueOnce(undefined);
      mockDb.updateSession.mockResolvedValueOnce(null);
      mockDb.addContextEntry.mockResolvedValueOnce({
        id: 'context-entry-id',
        sessionId: 'test-session-id',
        sequenceNumber: 2,
        contextType: 'system' as const,
        content: 'Handoff requested',
        metadata: {},
        createdAt: new Date()
      });
      mockDb.setCache.mockResolvedValueOnce(undefined);

      const args = {
        sessionKey: 'test-session-key',
        targetAgent: 'target-agent'
      };

      const result = await requestHandoffTool(args);

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
        targetAgent: 'target-agent'
      };

      const result = await requestHandoffTool(args);

      expect(result.content[0].type).toBe('text');
      const parsedResult = JSON.parse(result.content[0].text);
      expect(parsedResult.success).toBe(false);
      expect(parsedResult.error).toBe('Session not found');
      expect(parsedResult.sessionKey).toBe('non-existent-session');
      
      // Verify logging
      expect(mockLogger.logToolCall).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: 'requestHandoff',
          success: false,
          errorMessage: 'Session not found'
        })
      );
    });

    it('should return error when session is not active', async () => {
      const inactiveSession = { ...mockSession, status: 'completed' as const };
      mockDb.getSession.mockResolvedValueOnce(inactiveSession);

      const args = {
        sessionKey: 'test-session-key',
        targetAgent: 'target-agent'
      };

      const result = await requestHandoffTool(args);

      expect(result.content[0].type).toBe('text');
      const parsedResult = JSON.parse(result.content[0].text);
      expect(parsedResult.success).toBe(false);
      expect(parsedResult.error).toBe('Session is not active');
      expect(parsedResult.sessionKey).toBe('test-session-key');
      expect(parsedResult.currentStatus).toBe('completed');
    });
  });

  describe('context retrieval', () => {
    it('should return error when full context cannot be retrieved', async () => {
      mockDb.getSession.mockResolvedValueOnce(mockSession);
      mockContextManager.getFullContext.mockResolvedValueOnce(null);

      const args = {
        sessionKey: 'test-session-key',
        targetAgent: 'target-agent'
      };

      const result = await requestHandoffTool(args);

      expect(result.content[0].type).toBe('text');
      const parsedResult = JSON.parse(result.content[0].text);
      expect(parsedResult.success).toBe(false);
      expect(parsedResult.error).toBe('Failed to retrieve context for session');
      
      // Verify logging
      expect(mockLogger.logToolCall).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: 'requestHandoff',
          success: false,
          errorMessage: 'Failed to retrieve context for session'
        })
      );
    });
  });

  describe('error handling', () => {
    it('should handle database errors gracefully', async () => {
      const error = new Error('Database connection failed');
      mockDb.getSession.mockRejectedValueOnce(error);

      const args = {
        sessionKey: 'test-session-key',
        targetAgent: 'target-agent'
      };

      const result = await requestHandoffTool(args);

      expect(result.content[0].type).toBe('text');
      const parsedResult = JSON.parse(result.content[0].text);
      expect(parsedResult.success).toBe(false);
      expect(parsedResult.error).toBe('Failed to process handoff request');
      
      // Verify error was logged
      expect(mockLogger.logError).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          component: 'requestHandoff',
          operation: 'handoff_request'
        })
      );
      
      // Verify handoff failure was logged
      expect(mockLogger.logHandoffEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'test-session-key',
          handoffType: 'request',
          success: false,
          reason: 'Database connection failed'
        })
      );
      
      // Verify tool call failure was logged
      expect(mockLogger.logToolCall).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: 'requestHandoff',
          success: false,
          errorMessage: 'Database connection failed'
        })
      );
    });

    it('should handle context manager errors gracefully', async () => {
      const error = new Error('Context manager failed');
      mockDb.getSession.mockResolvedValueOnce(mockSession);
      mockContextManager.getFullContext.mockRejectedValueOnce(error);

      const args = {
        sessionKey: 'test-session-key',
        targetAgent: 'target-agent'
      };

      const result = await requestHandoffTool(args);

      expect(result.content[0].type).toBe('text');
      const parsedResult = JSON.parse(result.content[0].text);
      expect(parsedResult.success).toBe(false);
      expect(parsedResult.error).toBe('Failed to process handoff request');
    });
  });

  describe('default values', () => {
    it('should use default requestType when not provided', async () => {
      mockDb.getSession.mockResolvedValueOnce(mockSession);
      mockContextManager.getFullContext.mockResolvedValueOnce(mockFullContext);
      mockContextManager.createHandoffSummary.mockResolvedValueOnce(mockHandoffSummary);
      mockDb.updateSession.mockResolvedValueOnce(null);
      mockDb.addContextEntry.mockResolvedValueOnce({
        id: 'context-entry-id',
        sessionId: 'test-session-id',
        sequenceNumber: 2,
        contextType: 'system' as const,
        content: 'Handoff requested',
        metadata: {},
        createdAt: new Date()
      });
      mockDb.setCache.mockResolvedValueOnce(undefined);

      const args = {
        sessionKey: 'test-session-key',
        targetAgent: 'target-agent'
        // No requestType provided, should default to 'context_transfer'
      };

      const result = await requestHandoffTool(args);

      expect(result.content[0].type).toBe('text');
      const parsedResult = JSON.parse(result.content[0].text);
      expect(parsedResult.success).toBe(true);
      expect(parsedResult.handoff.requestType).toBe('context_transfer');
    });
  });
});