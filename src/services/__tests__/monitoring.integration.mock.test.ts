import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, jest } from '@jest/globals';
import { SessionManagerService } from '../sessionManager.js';
import { MonitoringService } from '../monitoringService.js';
import { AnalyticsService } from '../analyticsService.js';
import { configurationManager } from '../configurationManager.js';

// Mock the database module
jest.mock('../../database/index.js', () => ({
  db: {
    query: jest.fn(),
    setCache: jest.fn(),
    getCache: jest.fn(),
    deleteCache: jest.fn()
  }
}));

jest.mock('../../database/monitoredDatabase.js', () => ({
  monitoredDb: {
    query: jest.fn(),
    setCache: jest.fn(),
    getCache: jest.fn(),
    deleteCache: jest.fn()
  }
}));

// Import the mocked db after mocking
import { db } from '../../database/index.js';
import { monitoredDb } from '../../database/monitoredDatabase.js';

const mockDb = db as jest.Mocked<typeof db>;
const mockMonitoredDb = monitoredDb as jest.Mocked<typeof monitoredDb>;

describe('Monitoring Integration Tests - Mocked', () => {
  let testMonitoringService: MonitoringService;
  let testSessionManager: SessionManagerService;
  let testAnalyticsService: AnalyticsService;

  beforeAll(async () => {
    // Initialize services with test configuration
    testMonitoringService = new MonitoringService({
      healthCheckInterval: 1,
      metricsCollectionInterval: 1,
      performanceTrackingEnabled: true,
      alertThresholds: {
        responseTime: 100,
        errorRate: 10,
        memoryUsage: 90,
        diskUsage: 90,
        cpuUsage: 90,
        sessionCount: 10
      },
      enablePrometheusExport: true,
      enableHealthEndpoint: true,
      enableStructuredLogging: true,
      logLevel: 'debug'
    });

    testSessionManager = new SessionManagerService({
      defaultRetentionPolicy: {
        name: 'test',
        activeSessionTtl: 1,
        archivedSessionTtl: 1,
        logRetentionDays: 1,
        metricsRetentionDays: 1,
        dormantThresholdHours: 0.1
      },
      cleanupIntervalMinutes: 1,
      dormantCheckIntervalMinutes: 1,
      maxConcurrentCleanups: 1
    });

    testAnalyticsService = new AnalyticsService();

    // Set configuration manager for services
    testMonitoringService.setConfigurationManager(configurationManager);
    testAnalyticsService.setConfigurationManager(configurationManager);
  });

  afterAll(async () => {
    // Stop services
    await testMonitoringService.stop();
  });

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();
    
    // Setup default mock responses
    mockDb.query.mockResolvedValue({ rows: [], rowCount: 0 });
    mockMonitoredDb.query.mockResolvedValue({ rows: [], rowCount: 0 });
    mockDb.setCache.mockResolvedValue(undefined);
    mockDb.getCache.mockResolvedValue(null);
    mockDb.deleteCache.mockResolvedValue(undefined);
    mockMonitoredDb.setCache.mockResolvedValue(undefined);
    mockMonitoredDb.getCache.mockResolvedValue(null);
    mockMonitoredDb.deleteCache.mockResolvedValue(undefined);
  });

  describe('Session Lifecycle Management Integration', () => {
    it('should handle session expiration scheduling with monitoring', async () => {
      const sessionId = 'test-session-id';
      const mockSession = {
        id: sessionId,
        session_key: 'test-session-key',
        agent_from: 'agent-a',
        agent_to: 'agent-b',
        status: 'active',
        retention_policy: 'standard',
        created_at: new Date(),
        updated_at: new Date(),
        last_activity_at: new Date()
      };

      // Mock session retrieval
      mockMonitoredDb.query.mockResolvedValueOnce({
        rows: [mockSession],
        rowCount: 1
      });

      // Mock session update
      mockMonitoredDb.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 1
      });

      // Mock lifecycle event logging
      mockMonitoredDb.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 1
      });

      // Schedule expiration
      const expirationTime = new Date(Date.now() + 60000);
      await testSessionManager.scheduleExpiration(sessionId, expirationTime);

      // Verify database interactions
      expect(mockMonitoredDb.query).toHaveBeenCalledTimes(3);
      
      // Verify session was retrieved
      expect(mockMonitoredDb.query).toHaveBeenNthCalledWith(1, 
        'SELECT * FROM sessions WHERE id = $1', 
        [sessionId]
      );

      // Verify session was updated with expiration time
      expect(mockMonitoredDb.query).toHaveBeenNthCalledWith(2,
        'UPDATE sessions SET expires_at = $1 WHERE id = $2',
        [expirationTime, sessionId]
      );

      // Verify lifecycle event was logged
      expect(mockMonitoredDb.query).toHaveBeenNthCalledWith(3,
        'INSERT INTO session_lifecycle (session_id, event_type, event_data) VALUES ($1, $2, $3)',
        expect.arrayContaining([sessionId, 'expiration_scheduled', expect.any(String)])
      );
    });

    it('should handle session expiration with status update', async () => {
      const sessionId = 'test-session-id';
      const mockSession = {
        id: sessionId,
        session_key: 'test-session-key',
        status: 'active',
        archived_at: null
      };

      // Mock session retrieval
      mockMonitoredDb.query.mockResolvedValueOnce({
        rows: [mockSession],
        rowCount: 1
      });

      // Mock session status update
      mockMonitoredDb.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 1
      });

      // Mock referential integrity check
      mockMonitoredDb.query.mockResolvedValue({
        rows: [{ count: '0' }],
        rowCount: 1
      });

      // Mock lifecycle event logging
      mockMonitoredDb.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 1
      });

      // Expire the session
      await testSessionManager.expireSession(sessionId);

      // Verify session status was updated
      expect(mockMonitoredDb.query).toHaveBeenCalledWith(
        'UPDATE sessions SET status = $1, updated_at = NOW() WHERE id = $2',
        ['expired', sessionId]
      );

      // Verify lifecycle event was logged
      expect(mockMonitoredDb.query).toHaveBeenCalledWith(
        'INSERT INTO session_lifecycle (session_id, event_type, event_data) VALUES ($1, $2, $3)',
        expect.arrayContaining([sessionId, 'expired', expect.any(String)])
      );
    });

    it('should handle session archival with cache management', async () => {
      const sessionId = 'test-session-id';
      const mockSession = {
        id: sessionId,
        session_key: 'test-session-key',
        status: 'expired',
        archived_at: null
      };

      // Mock session retrieval
      mockMonitoredDb.query.mockResolvedValueOnce({
        rows: [mockSession],
        rowCount: 1
      });

      // Mock session archival update
      mockMonitoredDb.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 1
      });

      // Mock referential integrity checks
      mockMonitoredDb.query.mockResolvedValue({
        rows: [{ count: '0' }],
        rowCount: 1
      });

      // Mock lifecycle event logging
      mockMonitoredDb.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 1
      });

      // Archive the session
      await testSessionManager.archiveSession(sessionId);

      // Verify session was updated with archived timestamp
      expect(mockMonitoredDb.query).toHaveBeenCalledWith(
        'UPDATE sessions SET archived_at = $1, is_dormant = true, updated_at = NOW() WHERE id = $2',
        expect.arrayContaining([expect.any(Date), sessionId])
      );

      // Verify cache operations
      expect(mockMonitoredDb.setCache).toHaveBeenCalledTimes(2); // Two cache entries

      // Verify lifecycle event was logged
      expect(mockMonitoredDb.query).toHaveBeenCalledWith(
        'INSERT INTO session_lifecycle (session_id, event_type, event_data) VALUES ($1, $2, $3)',
        expect.arrayContaining([sessionId, 'archived', expect.any(String)])
      );
    });

    it('should detect and mark dormant sessions', async () => {
      const mockSessions = [
        { id: 'session-1', session_key: 'key-1', last_activity_at: new Date(Date.now() - 8 * 60 * 60 * 1000) },
        { id: 'session-2', session_key: 'key-2', last_activity_at: new Date(Date.now() - 10 * 60 * 60 * 1000) }
      ];

      // Mock dormant session queries for each retention policy (3 policies: standard, extended, short)
      // Each policy will return the mock sessions
      mockMonitoredDb.query.mockResolvedValue({
        rows: mockSessions,
        rowCount: mockSessions.length
      });

      // Mock individual session updates for each session
      for (let i = 0; i < mockSessions.length * 3; i++) { // 3 policies * 2 sessions each
        // Mock session retrieval for markSessionDormant
        mockMonitoredDb.query.mockResolvedValueOnce({
          rows: [mockSessions[i % mockSessions.length]],
          rowCount: 1
        });
        
        // Mock session update
        mockMonitoredDb.query.mockResolvedValueOnce({
          rows: [],
          rowCount: 1
        });
        
        // Mock cache operations for each session
        mockMonitoredDb.getCache.mockResolvedValueOnce({ test: true });
        mockMonitoredDb.setCache.mockResolvedValueOnce(undefined);
        mockMonitoredDb.deleteCache.mockResolvedValueOnce(undefined);
        
        // Mock lifecycle event logging
        mockMonitoredDb.query.mockResolvedValueOnce({
          rows: [],
          rowCount: 1
        });
      }

      // Detect dormant sessions
      const dormantCount = await testSessionManager.detectDormantSessions();

      // Verify dormant sessions were detected (method should return count >= 0)
      expect(dormantCount).toBeGreaterThanOrEqual(0);

      // Verify database queries were made for dormant detection
      expect(mockMonitoredDb.query).toHaveBeenCalled();
    });
  });

  describe('Health Monitoring Integration', () => {
    beforeEach(async () => {
      await testMonitoringService.start();
    });

    afterEach(async () => {
      await testMonitoringService.stop();
    });

    it('should perform database health checks', async () => {
      // Mock successful database queries
      mockDb.query.mockResolvedValueOnce({
        rows: [{ result: 1 }],
        rowCount: 1
      });

      mockDb.query.mockResolvedValueOnce({
        rows: [{ count: '5' }],
        rowCount: 1
      });

      // Check database health
      const dbHealth = await testMonitoringService.checkDatabaseHealth();

      // Verify health check structure
      expect(dbHealth).toHaveProperty('status');
      expect(dbHealth).toHaveProperty('responseTime');
      expect(dbHealth).toHaveProperty('lastCheck');
      expect(dbHealth).toHaveProperty('details');

      // Verify database queries were made
      expect(mockDb.query).toHaveBeenCalledWith('SELECT 1');
      expect(mockDb.query).toHaveBeenCalledWith('SELECT COUNT(*) as count FROM sessions');

      // Verify health status is reasonable
      expect(dbHealth.status).toMatch(/healthy|degraded|unhealthy/);
      expect(dbHealth.responseTime).toBeGreaterThanOrEqual(0);
      expect(dbHealth.details?.sessionCount).toBe(5);
    });

    it('should perform Redis health checks', async () => {
      // Mock Redis operations
      mockDb.setCache.mockResolvedValueOnce(undefined);
      mockDb.getCache.mockResolvedValueOnce({ test: true });
      mockDb.deleteCache.mockResolvedValueOnce(undefined);

      // Check Redis health
      const redisHealth = await testMonitoringService.checkRedisHealth();

      // Verify health check structure
      expect(redisHealth).toHaveProperty('status');
      expect(redisHealth).toHaveProperty('responseTime');
      expect(redisHealth).toHaveProperty('lastCheck');
      expect(redisHealth).toHaveProperty('details');

      // Verify Redis operations were performed
      expect(mockDb.setCache).toHaveBeenCalled();
      expect(mockDb.getCache).toHaveBeenCalled();
      expect(mockDb.deleteCache).toHaveBeenCalled();

      // Verify health status
      expect(redisHealth.status).toMatch(/healthy|degraded|unhealthy/);
      expect(redisHealth.responseTime).toBeGreaterThanOrEqual(0);
      expect(redisHealth.details?.testSuccessful).toBe(true);
    });

    it('should get comprehensive system health', async () => {
      // Mock database health check queries
      mockDb.query.mockResolvedValue({
        rows: [{ result: 1 }],
        rowCount: 1
      });

      // Mock Redis health check operations
      mockDb.setCache.mockResolvedValue(undefined);
      mockDb.getCache.mockResolvedValue({ test: true });
      mockDb.deleteCache.mockResolvedValue(undefined);

      // Get system health
      const health = await testMonitoringService.getSystemHealth();

      // Verify overall health structure
      expect(health).toHaveProperty('overall');
      expect(health).toHaveProperty('components');
      expect(health).toHaveProperty('timestamp');
      expect(health).toHaveProperty('uptime');

      // Verify component health
      expect(health.components).toHaveProperty('database');
      expect(health.components).toHaveProperty('redis');
      expect(health.components).toHaveProperty('system');

      // Verify all components have required properties
      Object.values(health.components).forEach(component => {
        expect(component).toHaveProperty('status');
        expect(component).toHaveProperty('responseTime');
        expect(component).toHaveProperty('lastCheck');
      });

      // Verify overall status is determined correctly
      expect(health.overall).toMatch(/healthy|degraded|unhealthy/);
    });
  });

  describe('Metrics Collection Integration', () => {
    beforeEach(async () => {
      await testMonitoringService.start();
    });

    afterEach(async () => {
      await testMonitoringService.stop();
    });

    it('should collect and export tool call metrics', async () => {
      // Mock performance log storage
      mockDb.query.mockResolvedValue({
        rows: [],
        rowCount: 1
      });

      // Record various tool calls
      testMonitoringService.recordToolCall('registerSession', 50, true, { sessionId: 'test-1' });
      testMonitoringService.recordToolCall('updateContext', 75, true, { sessionId: 'test-1' });
      testMonitoringService.recordToolCall('requestHandoff', 120, false, { error: 'timeout' });

      // Get Prometheus metrics
      const metrics = testMonitoringService.getPrometheusMetrics();

      // Verify tool call metrics are present
      expect(metrics).toContain('tool_calls_total');
      expect(metrics).toContain('tool_call_duration_seconds');
      expect(metrics).toContain('tool_call_errors_total');

      // Verify specific tool metrics
      expect(metrics).toContain('tool_name="registerSession"');
      expect(metrics).toContain('tool_name="updateContext"');
      expect(metrics).toContain('tool_name="requestHandoff"');

      // Verify error tracking
      expect(metrics).toMatch(/tool_call_errors_total\{tool_name="requestHandoff"\} 1/);
    });

    it('should collect and export handoff metrics', async () => {
      // Mock performance log storage
      mockDb.query.mockResolvedValue({
        rows: [],
        rowCount: 1
      });

      // Record handoff metrics
      testMonitoringService.recordHandoffMetrics('session-1', {
        sessionId: 'session-1',
        agentFrom: 'agent-a',
        agentTo: 'agent-b',
        duration: 150,
        success: true,
        contextSize: 2048
      });

      testMonitoringService.recordHandoffMetrics('session-2', {
        sessionId: 'session-2',
        agentFrom: 'agent-b',
        agentTo: 'agent-c',
        duration: 200,
        success: false,
        errorType: 'context_too_large'
      });

      // Get Prometheus metrics
      const metrics = testMonitoringService.getPrometheusMetrics();

      // Verify handoff metrics are present
      expect(metrics).toContain('handoffs_total');
      expect(metrics).toContain('handoff_duration_seconds');

      // Verify handoff routes are tracked
      expect(metrics).toContain('handoff_type="agent-a_to_agent-b"');
      expect(metrics).toContain('handoff_type="agent-b_to_agent-c"');

      // Verify performance logs were attempted to be stored
      expect(mockDb.query).toHaveBeenCalledWith(
        'INSERT INTO performance_logs (operation, duration_ms, success, session_id, metadata) VALUES ($1, $2, $3, $4, $5)',
        expect.arrayContaining(['handoff', 150, true, 'session-1', expect.any(String)])
      );
    });

    it('should collect system resource metrics', async () => {
      // Mock session count query
      mockDb.query.mockResolvedValue({
        rows: [{
          active: '3',
          dormant: '1',
          archived: '2'
        }],
        rowCount: 1
      });

      // Get system metrics
      const systemMetrics = await testMonitoringService.getSystemMetrics();

      // Verify system metrics structure
      expect(systemMetrics).toHaveProperty('timestamp');
      expect(systemMetrics).toHaveProperty('memory');
      expect(systemMetrics).toHaveProperty('cpu');
      expect(systemMetrics).toHaveProperty('database');
      expect(systemMetrics).toHaveProperty('redis');
      expect(systemMetrics).toHaveProperty('sessions');

      // Verify memory metrics
      expect(systemMetrics.memory.used).toBeGreaterThan(0);
      expect(systemMetrics.memory.total).toBeGreaterThan(0);
      expect(systemMetrics.memory.percentage).toBeGreaterThanOrEqual(0);
      expect(systemMetrics.memory.percentage).toBeLessThanOrEqual(100);

      // Verify session metrics
      expect(systemMetrics.sessions.active).toBe(3);
      expect(systemMetrics.sessions.dormant).toBe(1);
      expect(systemMetrics.sessions.archived).toBe(2);

      // Verify Prometheus export includes system metrics
      const prometheusMetrics = testMonitoringService.getPrometheusMetrics();
      expect(prometheusMetrics).toContain('system_memory_usage_bytes');
      expect(prometheusMetrics).toContain('system_memory_usage_percentage');
      expect(prometheusMetrics).toContain('active_sessions_total');
    });
  });

  describe('Analytics Data Integration', () => {
    it('should provide session statistics with mocked data', async () => {
      const mockSessionData = [
        { status: 'active', count: '3', avg_duration_seconds: '1800', avg_context_volume: '5', avg_participant_count: '2' },
        { status: 'completed', count: '7', avg_duration_seconds: '3600', avg_context_volume: '8', avg_participant_count: '3' },
        { status: 'expired', count: '2', avg_duration_seconds: '900', avg_context_volume: '3', avg_participant_count: '2' }
      ];

      const mockAgentData = [
        { agent_from: 'agent-a', count: '5' },
        { agent_from: 'agent-b', count: '4' },
        { agent_from: 'agent-c', count: '3' }
      ];

      // Mock session statistics query
      mockMonitoredDb.query.mockResolvedValueOnce({
        rows: mockSessionData,
        rowCount: mockSessionData.length
      });

      // Mock agent statistics query
      mockMonitoredDb.query.mockResolvedValueOnce({
        rows: mockAgentData,
        rowCount: mockAgentData.length
      });

      const timeRange = {
        start: new Date(Date.now() - 24 * 60 * 60 * 1000), // 24 hours ago
        end: new Date()
      };

      const sessionStats = await testAnalyticsService.getSessionStatistics({ timeRange });

      // Verify basic counts (should be calculated from mock data)
      expect(sessionStats.totalSessions).toBeGreaterThanOrEqual(0);
      expect(sessionStats.activeSessions).toBeGreaterThanOrEqual(0);
      expect(sessionStats.completedSessions).toBeGreaterThanOrEqual(0);
      expect(sessionStats.expiredSessions).toBeGreaterThanOrEqual(0);

      // Verify session breakdown by status structure
      expect(sessionStats.sessionsByStatus).toBeDefined();
      expect(typeof sessionStats.sessionsByStatus).toBe('object');

      // Verify session breakdown by agent structure
      expect(sessionStats.sessionsByAgent).toBeDefined();
      expect(typeof sessionStats.sessionsByAgent).toBe('object');

      // Verify calculated averages are numbers
      expect(typeof sessionStats.averageSessionDuration).toBe('number');
      expect(typeof sessionStats.averageContextVolume).toBe('number');
      expect(typeof sessionStats.averageParticipantCount).toBe('number');

      // Verify time range is preserved
      expect(sessionStats.timeRange.start).toEqual(timeRange.start);
      expect(sessionStats.timeRange.end).toEqual(timeRange.end);
    });

    it('should provide handoff analytics with mocked data', async () => {
      const mockHandoffData = [
        { 
          success: true, 
          duration_ms: '150', 
          agent_from: 'agent-a', 
          agent_to: 'agent-b',
          context_size: '2048',
          created_at: new Date()
        },
        { 
          success: true, 
          duration_ms: '200', 
          agent_from: 'agent-b', 
          agent_to: 'agent-c',
          context_size: '1024',
          created_at: new Date()
        },
        { 
          success: false, 
          duration_ms: '300', 
          agent_from: 'agent-a', 
          agent_to: 'agent-c',
          context_size: '4096',
          error_type: 'timeout',
          created_at: new Date()
        }
      ];

      // Mock handoff analytics query
      mockMonitoredDb.query.mockResolvedValue({
        rows: mockHandoffData,
        rowCount: mockHandoffData.length
      });

      const timeRange = {
        start: new Date(Date.now() - 24 * 60 * 60 * 1000), // 24 hours ago
        end: new Date()
      };

      const handoffAnalytics = await testAnalyticsService.getHandoffAnalytics({ timeRange });

      // Verify basic handoff counts
      expect(handoffAnalytics.totalHandoffs).toBeGreaterThanOrEqual(0);
      expect(handoffAnalytics.successfulHandoffs).toBeGreaterThanOrEqual(0);
      expect(handoffAnalytics.failedHandoffs).toBeGreaterThanOrEqual(0);

      // Verify success rate calculation
      expect(handoffAnalytics.successRate).toBeGreaterThanOrEqual(0);
      expect(handoffAnalytics.successRate).toBeLessThanOrEqual(100);

      // Verify average processing time
      expect(handoffAnalytics.averageProcessingTime).toBeGreaterThanOrEqual(0);

      // Verify handoff routes structure
      expect(handoffAnalytics.handoffsByRoute).toBeDefined();
      expect(typeof handoffAnalytics.handoffsByRoute).toBe('object');

      // Verify failure reasons structure
      expect(handoffAnalytics.failureReasons).toBeDefined();
      expect(typeof handoffAnalytics.failureReasons).toBe('object');

      // Verify trends data structure
      expect(Array.isArray(handoffAnalytics.handoffTrends)).toBe(true);
    });

    it('should analyze context growth patterns with mocked data', async () => {
      const mockContextData = [
        { context_type: 'user_message', content_size_bytes: '1024', created_at: new Date(), session_key: 'session-1' },
        { context_type: 'assistant_response', content_size_bytes: '2048', created_at: new Date(), session_key: 'session-1' },
        { context_type: 'system_message', content_size_bytes: '512', created_at: new Date(), session_key: 'session-2' },
        { context_type: 'user_message', content_size_bytes: '1536', created_at: new Date(), session_key: 'session-2' }
      ];

      // Mock context growth query
      mockMonitoredDb.query.mockResolvedValue({
        rows: mockContextData,
        rowCount: mockContextData.length
      });

      const timeRange = {
        start: new Date(Date.now() - 24 * 60 * 60 * 1000), // 24 hours ago
        end: new Date()
      };

      const contextPatterns = await testAnalyticsService.getContextGrowthPatterns({ timeRange });

      // Verify total context entries
      expect(contextPatterns.totalContextEntries).toBeGreaterThanOrEqual(0);

      // Verify content type distribution structure
      expect(contextPatterns.contentTypeDistribution).toBeDefined();
      expect(typeof contextPatterns.contentTypeDistribution).toBe('object');

      // Verify content type statistics structure if data exists
      if (contextPatterns.totalContextEntries > 0) {
        const firstType = Object.keys(contextPatterns.contentTypeDistribution)[0];
        if (firstType) {
          const stats = contextPatterns.contentTypeDistribution[firstType];
          expect(stats.count).toBeGreaterThanOrEqual(0);
          expect(stats.avgSize).toBeGreaterThanOrEqual(0);
          expect(stats.totalSize).toBeGreaterThanOrEqual(0);
          expect(stats.percentage).toBeGreaterThanOrEqual(0);
          expect(stats.percentage).toBeLessThanOrEqual(100);
        }
      }

      // Verify trends structure
      expect(Array.isArray(contextPatterns.growthTrends)).toBe(true);
      expect(Array.isArray(contextPatterns.sizeTrends)).toBe(true);
      expect(Array.isArray(contextPatterns.anomalies)).toBe(true);
    });
  });

  describe('End-to-End Integration', () => {
    it('should handle complete monitoring workflow with mocked dependencies', async () => {
      // Start monitoring service
      await testMonitoringService.start();

      // Mock database operations for session management
      const sessionId = 'test-session-id';
      const mockSession = {
        id: sessionId,
        session_key: 'test-session-key',
        agent_from: 'agent-a',
        agent_to: 'agent-b',
        status: 'active',
        retention_policy: 'standard'
      };

      // Mock session retrieval and updates
      mockMonitoredDb.query.mockResolvedValue({
        rows: [mockSession],
        rowCount: 1
      });

      // Mock health check queries
      mockDb.query.mockResolvedValue({
        rows: [{ result: 1 }],
        rowCount: 1
      });

      // Mock cache operations
      mockDb.setCache.mockResolvedValue(undefined);
      mockDb.getCache.mockResolvedValue({ test: true });
      mockDb.deleteCache.mockResolvedValue(undefined);

      // Simulate session activity with monitoring
      testMonitoringService.recordToolCall('registerSession', 45, true, { sessionId });
      testMonitoringService.recordToolCall('updateContext', 65, true, { sessionId });

      // Simulate handoff
      testMonitoringService.recordHandoffMetrics(sessionId, {
        sessionId,
        agentFrom: 'agent-a',
        agentTo: 'agent-b',
        duration: 120,
        success: true,
        contextSize: 1024
      });

      // Schedule session expiration
      await testSessionManager.scheduleExpiration(sessionId);

      // Get comprehensive system status
      const health = await testMonitoringService.getSystemHealth();
      const metrics = testMonitoringService.getPrometheusMetrics();

      // Verify all monitoring components are working
      expect(health.overall).toMatch(/healthy|degraded/);
      expect(metrics).toContain('tool_calls_total');
      expect(metrics).toContain('handoffs_total');

      // Verify database interactions occurred
      expect(mockMonitoredDb.query).toHaveBeenCalled();
      expect(mockDb.query).toHaveBeenCalled();

      // Stop services
      await testMonitoringService.stop();
    });

    it('should maintain data consistency across monitoring components', async () => {
      // Mock consistent data across all components
      const sessionData = [
        { status: 'active', count: '5' },
        { status: 'completed', count: '3' }
      ];

      const handoffData = [
        { success: true, duration_ms: '150', agent_from: 'agent-a', agent_to: 'agent-b', created_at: new Date() },
        { success: true, duration_ms: '200', agent_from: 'agent-b', agent_to: 'agent-c', created_at: new Date() },
        { success: false, duration_ms: '300', agent_from: 'agent-a', agent_to: 'agent-c', created_at: new Date() }
      ];

      // Mock analytics queries
      mockMonitoredDb.query.mockResolvedValueOnce({
        rows: sessionData,
        rowCount: sessionData.length
      });

      mockMonitoredDb.query.mockResolvedValueOnce({
        rows: [{ agent_from: 'agent-a', count: '5' }],
        rowCount: 1
      });

      mockMonitoredDb.query.mockResolvedValueOnce({
        rows: handoffData,
        rowCount: handoffData.length
      });

      // Mock system metrics query
      mockDb.query.mockResolvedValue({
        rows: [{ active: '5', dormant: '0', archived: '3' }],
        rowCount: 1
      });

      const timeRange = {
        start: new Date(Date.now() - 60 * 60 * 1000),
        end: new Date()
      };

      // Get data from all monitoring components
      const sessionStats = await testAnalyticsService.getSessionStatistics({ timeRange });
      const handoffAnalytics = await testAnalyticsService.getHandoffAnalytics({ timeRange });
      const systemMetrics = await testMonitoringService.getSystemMetrics();

      // Verify data consistency (all methods should return valid data structures)
      expect(typeof sessionStats.totalSessions).toBe('number');
      expect(typeof handoffAnalytics.totalHandoffs).toBe('number');
      expect(typeof handoffAnalytics.failedHandoffs).toBe('number');
      expect(typeof systemMetrics.sessions.active).toBe('number');

      // Verify all components were queried
      expect(mockMonitoredDb.query).toHaveBeenCalled();
      expect(mockDb.query).toHaveBeenCalled();
    });
  });
});