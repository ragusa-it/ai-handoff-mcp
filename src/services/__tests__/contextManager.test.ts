import { contextManagerService } from '../contextManager.js';
import { monitoredDb } from '../../database/monitoredDatabase.js';
import { monitoringService } from '../../services/monitoringService.js';
import { structuredLogger } from '../../services/structuredLogger.js';

// Mock the monitored database
jest.mock('../../database/monitoredDatabase.js', () => ({
  monitoredDb: {
    getSession: jest.fn(),
    getContextHistory: jest.fn(),
    query: jest.fn(),
    setCache: jest.fn(),
    getCache: jest.fn(),
    deleteCache: jest.fn()
  }
}));

// Mock the monitoring service
jest.mock('../../services/monitoringService.js', () => ({
  monitoringService: {
    recordPerformanceMetrics: jest.fn()
  }
}));

// Mock the structured logger
jest.mock('../../services/structuredLogger.js', () => ({
  structuredLogger: {
    logSystemEvent: jest.fn(),
    logPerformanceMetric: jest.fn(),
    logError: jest.fn()
  }
}));

describe('ContextManagerService', () => {
  let contextManager: typeof contextManagerService;
  const mockDb = monitoredDb as jest.Mocked<typeof monitoredDb>;
  const mockMonitoring = monitoringService as jest.Mocked<typeof monitoringService>;
  const mockLogger = structuredLogger as jest.Mocked<typeof structuredLogger>;

  const mockSession = {
    id: 'test-session-id',
    sessionKey: 'test-session-key',
    agentFrom: 'agent1',
    agentTo: 'agent2',
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

  const mockContextHistory = [
    {
      id: 'context-1',
      sessionId: 'test-session-id',
      sequenceNumber: 1,
      contextType: 'system' as const,
      content: 'Session created',
      metadata: { action: 'session_created' },
      createdAt: new Date('2023-01-01T00:00:00Z'),
      processingTimeMs: 10,
      contentSizeBytes: 50
    },
    {
      id: 'context-2',
      sessionId: 'test-session-id',
      sequenceNumber: 2,
      contextType: 'message' as const,
      content: 'Hello, how can I help you?',
      metadata: { user: 'user1' },
      createdAt: new Date('2023-01-01T00:01:00Z'),
      processingTimeMs: 15,
      contentSizeBytes: 100
    },
    {
      id: 'context-3',
      sessionId: 'test-session-id',
      sequenceNumber: 3,
      contextType: 'tool_call' as const,
      content: 'Called tool: search',
      metadata: { toolName: 'search', parameters: { query: 'help' } },
      createdAt: new Date('2023-01-01T00:02:00Z'),
      processingTimeMs: 20,
      contentSizeBytes: 75
    }
  ];

  beforeEach(() => {
    contextManager = contextManagerService;
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('getFullContext', () => {
    it('should return null when session is not found', async () => {
      mockDb.getSession.mockResolvedValueOnce(null);

      const result = await contextManager.getFullContext('non-existent-key');

      expect(result).toBeNull();
      expect(mockDb.getSession).toHaveBeenCalledWith('non-existent-key');
      expect(mockMonitoring.recordPerformanceMetrics).toHaveBeenCalledWith(
        'get_full_context',
        expect.objectContaining({
          operation: 'get_full_context',
          success: false,
          metadata: expect.objectContaining({ reason: 'session_not_found' })
        })
      );
    });

    it('should return full context when session and context history are found', async () => {
      mockDb.getSession.mockResolvedValueOnce(mockSession);
      mockDb.getContextHistory.mockResolvedValueOnce(mockContextHistory);
      // Mock the createHandoffSummary method
      jest.spyOn(contextManager, 'createHandoffSummary').mockResolvedValueOnce({
        sessionKey: 'test-session-key',
        summary: 'Test session with 3 context entries',
        keyPoints: ['Session created', '2 messages exchanged', '1 tool calls'],
        messageCount: 1,
        fileCount: 0,
        toolCallCount: 1,
        lastUpdated: new Date('2023-01-01T00:02:00Z'),
        participants: ['agent1', 'agent2', 'user:user1']
      });

      const result = await contextManager.getFullContext('test-session-key');

      expect(result).not.toBeNull();
      expect(result?.session).toEqual(mockSession);
      expect(result?.contextHistory).toEqual(mockContextHistory);
      expect(result?.summary).toBeDefined();
      expect(mockDb.getSession).toHaveBeenCalledWith('test-session-key');
      expect(mockDb.getContextHistory).toHaveBeenCalledWith('test-session-id');
      expect(contextManager.createHandoffSummary).toHaveBeenCalledWith('test-session-key');
    });

    it('should handle errors gracefully', async () => {
      mockDb.getSession.mockRejectedValueOnce(new Error('Database error'));

      await expect(contextManager.getFullContext('test-session-key')).rejects.toThrow('Database error');
      
      expect(mockMonitoring.recordPerformanceMetrics).toHaveBeenCalledWith(
        'get_full_context',
        expect.objectContaining({
          operation: 'get_full_context',
          success: false,
          metadata: expect.objectContaining({ error: 'Database error' })
        })
      );
      expect(mockLogger.logError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          component: 'ContextManager',
          operation: 'get_full_context'
        })
      );
    });
  });

  describe('createHandoffSummary', () => {
    it('should throw error when session is not found', async () => {
      mockDb.getSession.mockResolvedValueOnce(null);

      await expect(contextManager.createHandoffSummary('non-existent-key')).rejects.toThrow('Session not found');
      expect(mockDb.getSession).toHaveBeenCalledWith('non-existent-key');
    });

    it('should create a comprehensive handoff summary', async () => {
      mockDb.getSession.mockResolvedValueOnce(mockSession);
      mockDb.getContextHistory.mockResolvedValueOnce(mockContextHistory);

      const summary = await contextManager.createHandoffSummary('test-session-key');

      expect(summary).toBeDefined();
      expect(summary.sessionKey).toBe('test-session-key');
      expect(summary.summary).toContain('test-session-key');
      expect(summary.summary).toContain('agent1');
      expect(summary.messageCount).toBe(1);
      expect(summary.fileCount).toBe(0);
      expect(summary.toolCallCount).toBe(1);
      expect(summary.keyPoints).toHaveLength(5); // system action + message info + tool call info
      expect(summary.participants).toContain('agent1');
      expect(summary.participants).toContain('agent2');
      expect(summary.participants).toContain('user:user1');
      expect(summary.lastUpdated).toEqual(new Date('2023-01-01T00:02:00Z'));
    });

    it('should handle empty context history', async () => {
      mockDb.getSession.mockResolvedValueOnce(mockSession);
      mockDb.getContextHistory.mockResolvedValueOnce([]);

      const summary = await contextManager.createHandoffSummary('test-session-key');

      expect(summary).toBeDefined();
      expect(summary.messageCount).toBe(0);
      expect(summary.fileCount).toBe(0);
      expect(summary.toolCallCount).toBe(0);
      expect(summary.keyPoints).toHaveLength(0);
    });

    it('should handle errors gracefully', async () => {
      mockDb.getSession.mockRejectedValueOnce(new Error('Database error'));

      await expect(contextManager.createHandoffSummary('test-session-key')).rejects.toThrow('Database error');
      
      expect(mockMonitoring.recordPerformanceMetrics).toHaveBeenCalledWith(
        'create_handoff_summary',
        expect.objectContaining({
          operation: 'create_handoff_summary',
          success: false,
          metadata: expect.objectContaining({ error: 'Database error' })
        })
      );
      expect(mockLogger.logError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          component: 'ContextManager',
          operation: 'create_handoff_summary'
        })
      );
    });
  });

  describe('extractKeyPoints', () => {
    it('should extract key points from context history', () => {
      // Use reflection to access private method
      const extractKeyPoints = (contextManager as any).extractKeyPoints.bind(contextManager);
      const keyPoints = extractKeyPoints(mockContextHistory);

      expect(keyPoints).toContain('System: session_created');
      expect(keyPoints).toContain('1 messages exchanged');
      expect(keyPoints).toContain('1 tool calls');
    });

    it('should handle empty context history', () => {
      const extractKeyPoints = (contextManager as any).extractKeyPoints.bind(contextManager);
      const keyPoints = extractKeyPoints([]);

      expect(keyPoints).toHaveLength(0);
    });
  });

  describe('extractParticipants', () => {
    it('should extract participants from session and context history', () => {
      const extractParticipants = (contextManager as any).extractParticipants.bind(contextManager);
      const participants = extractParticipants(mockSession, mockContextHistory);

      expect(participants).toContain('agent1');
      expect(participants).toContain('agent2');
      expect(participants).toContain('user:user1');
    });

    it('should handle context history with no user metadata', () => {
      const extractParticipants = (contextManager as any).extractParticipants.bind(contextManager);
      const participants = extractParticipants(mockSession, [
        {
          id: 'context-1',
          sessionId: 'test-session-id',
          sequenceNumber: 1,
          contextType: 'system' as const,
          content: 'Session created',
          metadata: {},
          createdAt: new Date(),
          processingTimeMs: 10,
          contentSizeBytes: 50
        }
      ]);

      expect(participants).toContain('agent1');
      expect(participants).toContain('agent2');
      expect(participants).toHaveLength(2);
    });
  });

  describe('generateSummaryText', () => {
    it('should generate a summary text', () => {
      const generateSummaryText = (contextManager as any).generateSummaryText.bind(contextManager);
      const summary = generateSummaryText(mockContextHistory, mockSession);

      expect(summary).toContain('test-session-key');
      expect(summary).toContain('agent1');
      expect(summary).toContain('3 context entries');
    });

    it('should handle empty context history', () => {
      const generateSummaryText = (contextManager as any).generateSummaryText.bind(contextManager);
      const summary = generateSummaryText([], mockSession);

      expect(summary).toContain('test-session-key');
      expect(summary).toContain('agent1');
      expect(summary).toContain('0 context entries');
    });
  });

  describe('getContextBreakdown', () => {
    it('should generate context breakdown', () => {
      const getContextBreakdown = (contextManager as any).getContextBreakdown.bind(contextManager);
      const breakdown = getContextBreakdown(mockContextHistory);

      expect(breakdown).toContain('1 messages');
      expect(breakdown).toContain('1 tool calls');
      expect(breakdown).toContain('1 system events');
    });

    it('should handle empty context history', () => {
      const getContextBreakdown = (contextManager as any).getContextBreakdown.bind(contextManager);
      const breakdown = getContextBreakdown([]);

      expect(breakdown).toHaveLength(0);
    });
  });
});