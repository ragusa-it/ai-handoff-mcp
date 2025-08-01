import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { db } from '../../database/index.js';
import { SessionManagerService } from '../sessionManager.js';
import { MonitoringService } from '../monitoringService.js';
import { AnalyticsService } from '../analyticsService.js';
import { configurationManager } from '../configurationManager.js';

// Test utilities
interface TestSession {
  id: string;
  sessionKey: string;
  agentFrom: string;
  agentTo: string;
  status: string;
}

class SimpleTestHelper {
  private createdSessions: string[] = [];

  async createTestSession(overrides: Partial<TestSession> = {}): Promise<TestSession> {
    const sessionData = {
      sessionKey: `test-session-${Date.now()}-${Math.random()}`,
      agentFrom: 'test-agent-1',
      agentTo: 'test-agent-2',
      status: 'active',
      ...overrides
    };

    const result = await db.query(
      `INSERT INTO sessions (session_key, agent_from, agent_to, status, created_at, updated_at, last_activity_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW(), NOW())
       RETURNING id, session_key, agent_from, agent_to, status`,
      [sessionData.sessionKey, sessionData.agentFrom, sessionData.agentTo, sessionData.status]
    );

    const session = {
      id: result.rows[0].id,
      sessionKey: result.rows[0].session_key,
      agentFrom: result.rows[0].agent_from,
      agentTo: result.rows[0].agent_to,
      status: result.rows[0].status
    };

    this.createdSessions.push(session.id);
    return session;
  }

  async createTestContext(sessionId: string, contextType: string = 'user_message', contentSize: number = 1024): Promise<void> {
    await db.query(
      `INSERT INTO context_history (session_id, sequence_number, context_type, content, content_size_bytes, created_at)
       VALUES ($1, 1, $2, $3, $4, NOW())`,
      [sessionId, contextType, JSON.stringify({ test: 'data' }), contentSize]
    );
  }

  async createTestPerformanceLog(operation: string, duration: number, success: boolean, sessionId?: string): Promise<void> {
    await db.query(
      `INSERT INTO performance_logs (operation, duration_ms, success, session_id, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [operation, duration, success, sessionId, JSON.stringify({ test: true })]
    );
  }

  async cleanup(): Promise<void> {
    if (this.createdSessions.length > 0) {
      await db.query('DELETE FROM context_history WHERE session_id = ANY($1)', [this.createdSessions]);
      await db.query('DELETE FROM session_lifecycle WHERE session_id = ANY($1)', [this.createdSessions]);
      await db.query('DELETE FROM performance_logs WHERE session_id = ANY($1)', [this.createdSessions]);
      await db.query('DELETE FROM sessions WHERE id = ANY($1)', [this.createdSessions]);
      this.createdSessions = [];
    }

    // Clean up test data
    await db.query("DELETE FROM system_metrics WHERE labels->>'test' = 'true' OR metric_name LIKE 'test_%'");
    await db.query("DELETE FROM performance_logs WHERE metadata->>'test' = 'true'");
  }

  async waitForAsyncOperations(timeoutMs: number = 100): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, timeoutMs));
  }
}

describe('Monitoring Integration Tests - Simple', () => {
  let testHelper: SimpleTestHelper;
  let testMonitoringService: MonitoringService;
  let testSessionManager: SessionManagerService;
  let testAnalyticsService: AnalyticsService;

  beforeAll(async () => {
    // Ensure database connection is established
    await db.query('SELECT 1');
    
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

    testHelper = new SimpleTestHelper();
  });

  afterAll(async () => {
    // Stop services
    await testMonitoringService.stop();
    
    // Final cleanup
    await testHelper.cleanup();
  });

  beforeEach(async () => {
    // Clean up before each test
    await testHelper.cleanup();
  });

  afterEach(async () => {
    // Clean up after each test
    await testHelper.cleanup();
  });

  describe('Session Lifecycle Management Integration', () => {
    it('should handle basic session lifecycle operations', async () => {
      // Create a test session
      const session = await testHelper.createTestSession({
        status: 'active'
      });

      // Add some context to the session
      await testHelper.createTestContext(session.id, 'user_message', 2048);

      // Schedule expiration
      const expirationTime = new Date(Date.now() + 60000); // 1 minute from now
      await testSessionManager.scheduleExpiration(session.id, expirationTime);

      // Verify session has expiration time set
      const sessionAfterScheduling = await db.query('SELECT expires_at FROM sessions WHERE id = $1', [session.id]);
      expect(sessionAfterScheduling.rows[0].expires_at).toBeTruthy();

      // Expire the session
      await testSessionManager.expireSession(session.id);

      // Verify session status changed
      const expiredSession = await db.query('SELECT status FROM sessions WHERE id = $1', [session.id]);
      expect(expiredSession.rows[0].status).toBe('expired');

      // Archive the session
      await testSessionManager.archiveSession(session.id);

      // Verify session is archived
      const archivedSession = await db.query('SELECT archived_at, is_dormant FROM sessions WHERE id = $1', [session.id]);
      expect(archivedSession.rows[0].archived_at).toBeTruthy();
      expect(archivedSession.rows[0].is_dormant).toBe(true);
    });

    it('should handle dormant session detection', async () => {
      // Create a session with old last_activity_at
      const session = await testHelper.createTestSession({
        status: 'active'
      });

      // Manually set last_activity_at to simulate dormant session
      await db.query(
        'UPDATE sessions SET last_activity_at = $1 WHERE id = $2',
        [new Date(Date.now() - 7 * 60 * 1000), session.id] // 7 minutes ago
      );

      // Detect dormant sessions
      const dormantCount = await testSessionManager.detectDormantSessions();
      expect(dormantCount).toBeGreaterThan(0);

      // Verify session is marked as dormant
      const dormantSession = await db.query('SELECT is_dormant FROM sessions WHERE id = $1', [session.id]);
      expect(dormantSession.rows[0].is_dormant).toBe(true);

      // Reactivate the session
      await testSessionManager.reactivateSession(session.id);

      // Verify session is no longer dormant
      const reactivatedSession = await db.query('SELECT is_dormant, last_activity_at FROM sessions WHERE id = $1', [session.id]);
      expect(reactivatedSession.rows[0].is_dormant).toBe(false);
      expect(new Date(reactivatedSession.rows[0].last_activity_at).getTime()).toBeGreaterThan(Date.now() - 5000);
    });

    it('should handle orphaned session cleanup', async () => {
      // Create a session without any context (orphaned)
      const orphanedSession = await testHelper.createTestSession({
        status: 'active'
      });

      // Set last_activity_at to more than 7 days ago
      await db.query(
        'UPDATE sessions SET last_activity_at = $1 WHERE id = $2',
        [new Date(Date.now() - 8 * 24 * 60 * 60 * 1000), orphanedSession.id] // 8 days ago
      );

      // Create a normal session with context
      const normalSession = await testHelper.createTestSession({
        status: 'active'
      });
      await testHelper.createTestContext(normalSession.id);

      // Run cleanup
      const cleanedCount = await testSessionManager.cleanupOrphanedSessions();
      expect(cleanedCount).toBeGreaterThan(0);

      // Verify orphaned session was processed
      const orphanedAfterCleanup = await db.query('SELECT status FROM sessions WHERE id = $1', [orphanedSession.id]);
      expect(orphanedAfterCleanup.rows[0].status).toBe('expired');

      // Verify normal session was not affected
      const normalAfterCleanup = await db.query('SELECT status FROM sessions WHERE id = $1', [normalSession.id]);
      expect(normalAfterCleanup.rows[0].status).toBe('active');
    });
  });

  describe('Health Monitoring Integration', () => {
    beforeEach(async () => {
      await testMonitoringService.start();
      await testHelper.waitForAsyncOperations(100);
    });

    afterEach(async () => {
      await testMonitoringService.stop();
    });

    it('should perform comprehensive health checks', async () => {
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

      // Verify database health
      expect(health.components.database.status).toMatch(/healthy|degraded|unhealthy/);
      expect(health.components.database.responseTime).toBeGreaterThan(0);
      expect(health.components.database.lastCheck).toBeInstanceOf(Date);

      // Verify Redis health
      expect(health.components.redis.status).toMatch(/healthy|degraded|unhealthy/);
      expect(health.components.redis.responseTime).toBeGreaterThan(0);

      // Verify system health
      expect(health.components.system.status).toMatch(/healthy|degraded|unhealthy/);
      expect(health.components.system.details).toHaveProperty('memory');
      expect(health.components.system.details).toHaveProperty('cpu');
    });

    it('should detect database connectivity', async () => {
      // Test database health specifically
      const dbHealth = await testMonitoringService.checkDatabaseHealth();

      expect(dbHealth.status).toMatch(/healthy|degraded|unhealthy/);
      expect(dbHealth.responseTime).toBeGreaterThan(0);
      expect(dbHealth.details).toHaveProperty('sessionCount');
    });

    it('should detect Redis connectivity', async () => {
      // Test Redis health specifically
      const redisHealth = await testMonitoringService.checkRedisHealth();

      expect(redisHealth.status).toMatch(/healthy|degraded|unhealthy/);
      expect(redisHealth.responseTime).toBeGreaterThan(0);
      expect(redisHealth.details).toHaveProperty('testSuccessful');
    });
  });

  describe('Metrics Collection and Export Integration', () => {
    beforeEach(async () => {
      await testMonitoringService.start();
      await testHelper.waitForAsyncOperations(100);
    });

    afterEach(async () => {
      await testMonitoringService.stop();
    });

    it('should collect and export tool call metrics', async () => {
      // Record various tool calls
      testMonitoringService.recordToolCall('registerSession', 50, true, { sessionId: 'test-1' });
      testMonitoringService.recordToolCall('updateContext', 75, true, { sessionId: 'test-1' });
      testMonitoringService.recordToolCall('requestHandoff', 120, false, { error: 'timeout' });
      testMonitoringService.recordToolCall('registerSession', 45, true, { sessionId: 'test-2' });

      await testHelper.waitForAsyncOperations(100);

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
    });

    it('should collect and export handoff metrics', async () => {
      // Create test sessions for handoff metrics
      const session1 = await testHelper.createTestSession();
      const session2 = await testHelper.createTestSession();

      // Record handoff metrics
      testMonitoringService.recordHandoffMetrics(session1.id, {
        sessionId: session1.id,
        agentFrom: 'agent-a',
        agentTo: 'agent-b',
        duration: 150,
        success: true,
        contextSize: 2048
      });

      testMonitoringService.recordHandoffMetrics(session2.id, {
        sessionId: session2.id,
        agentFrom: 'agent-b',
        agentTo: 'agent-c',
        duration: 200,
        success: false,
        errorType: 'context_too_large'
      });

      await testHelper.waitForAsyncOperations(100);

      // Get Prometheus metrics
      const metrics = testMonitoringService.getPrometheusMetrics();

      // Verify handoff metrics are present
      expect(metrics).toContain('handoffs_total');
      expect(metrics).toContain('handoff_duration_seconds');

      // Verify handoff routes are tracked
      expect(metrics).toContain('handoff_type="agent-a_to_agent-b"');
      expect(metrics).toContain('handoff_type="agent-b_to_agent-c"');

      // Verify performance logs were created
      const performanceLogs = await db.query(
        'SELECT operation, success, metadata FROM performance_logs WHERE operation = $1 ORDER BY created_at DESC LIMIT 2',
        ['handoff']
      );
      expect(performanceLogs.rows).toHaveLength(2);
      expect(performanceLogs.rows[0].success).toBe(false);
      expect(performanceLogs.rows[1].success).toBe(true);
    });

    it('should collect system resource metrics', async () => {
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
      expect(systemMetrics.sessions.active).toBeGreaterThanOrEqual(0);
      expect(systemMetrics.sessions.dormant).toBeGreaterThanOrEqual(0);
      expect(systemMetrics.sessions.archived).toBeGreaterThanOrEqual(0);

      // Verify Prometheus export includes system metrics
      const prometheusMetrics = testMonitoringService.getPrometheusMetrics();
      expect(prometheusMetrics).toContain('system_memory_usage_bytes');
      expect(prometheusMetrics).toContain('system_memory_usage_percentage');
      expect(prometheusMetrics).toContain('active_sessions_total');
    });
  });

  describe('Analytics Data Accuracy Integration', () => {
    beforeEach(async () => {
      // Create test data for analytics
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      // Create sessions with different statuses
      const activeSession = await testHelper.createTestSession({
        status: 'active',
        agentFrom: 'agent-a',
        agentTo: 'agent-b'
      });

      const completedSession = await testHelper.createTestSession({
        status: 'completed',
        agentFrom: 'agent-b',
        agentTo: 'agent-c'
      });

      // Update timestamps to simulate historical data
      await db.query('UPDATE sessions SET created_at = $1 WHERE id = $2', [oneHourAgo, activeSession.id]);

      // Create context entries
      await testHelper.createTestContext(activeSession.id, 'user_message', 1024);
      await testHelper.createTestContext(completedSession.id, 'assistant_response', 2048);

      // Create performance logs for handoffs
      await testHelper.createTestPerformanceLog('handoff', 150, true, activeSession.id);
      await testHelper.createTestPerformanceLog('handoff', 200, true, completedSession.id);
    });

    it('should provide accurate session statistics', async () => {
      const timeRange = {
        start: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
        end: new Date()
      };

      const sessionStats = await testAnalyticsService.getSessionStatistics({ timeRange });

      // Verify basic counts
      expect(sessionStats.totalSessions).toBeGreaterThanOrEqual(2);
      expect(sessionStats.activeSessions).toBeGreaterThanOrEqual(1);
      expect(sessionStats.completedSessions).toBeGreaterThanOrEqual(1);

      // Verify session breakdown by status
      expect(sessionStats.sessionsByStatus).toHaveProperty('active');
      expect(sessionStats.sessionsByStatus).toHaveProperty('completed');

      // Verify session breakdown by agent
      expect(sessionStats.sessionsByAgent).toHaveProperty('agent-a');
      expect(sessionStats.sessionsByAgent).toHaveProperty('agent-b');

      // Verify calculated averages are reasonable
      expect(sessionStats.averageSessionDuration).toBeGreaterThanOrEqual(0);
      expect(sessionStats.averageContextVolume).toBeGreaterThanOrEqual(0);

      // Verify time range is preserved
      expect(sessionStats.timeRange.start).toEqual(timeRange.start);
      expect(sessionStats.timeRange.end).toEqual(timeRange.end);
    });

    it('should provide accurate handoff analytics', async () => {
      const timeRange = {
        start: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
        end: new Date()
      };

      const handoffAnalytics = await testAnalyticsService.getHandoffAnalytics({ timeRange });

      // Verify basic handoff counts
      expect(handoffAnalytics.totalHandoffs).toBeGreaterThanOrEqual(2);
      expect(handoffAnalytics.successfulHandoffs).toBeGreaterThanOrEqual(2);
      expect(handoffAnalytics.failedHandoffs).toBeGreaterThanOrEqual(0);

      // Verify success rate calculation
      const expectedSuccessRate = (handoffAnalytics.successfulHandoffs / handoffAnalytics.totalHandoffs) * 100;
      expect(handoffAnalytics.successRate).toBeCloseTo(expectedSuccessRate, 1);

      // Verify average processing time is reasonable
      expect(handoffAnalytics.averageProcessingTime).toBeGreaterThan(0);
      expect(handoffAnalytics.averageProcessingTime).toBeLessThan(1000);

      // Verify handoff routes are tracked
      expect(Object.keys(handoffAnalytics.handoffsByRoute).length).toBeGreaterThan(0);

      // Verify trends data structure
      expect(Array.isArray(handoffAnalytics.handoffTrends)).toBe(true);
    });

    it('should analyze context growth patterns', async () => {
      const timeRange = {
        start: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
        end: new Date()
      };

      const contextPatterns = await testAnalyticsService.getContextGrowthPatterns({ timeRange });

      // Verify total context entries
      expect(contextPatterns.totalContextEntries).toBeGreaterThanOrEqual(2);

      // Verify content type distribution
      expect(contextPatterns.contentTypeDistribution).toHaveProperty('user_message');
      expect(contextPatterns.contentTypeDistribution).toHaveProperty('assistant_response');

      // Verify content type statistics
      const userMessageStats = contextPatterns.contentTypeDistribution['user_message'];
      if (userMessageStats) {
        expect(userMessageStats.count).toBeGreaterThan(0);
        expect(userMessageStats.avgSize).toBeGreaterThan(0);
        expect(userMessageStats.totalSize).toBeGreaterThan(0);
        expect(userMessageStats.percentage).toBeGreaterThan(0);
        expect(userMessageStats.percentage).toBeLessThanOrEqual(100);
      }

      // Verify trends structure
      expect(Array.isArray(contextPatterns.growthTrends)).toBe(true);
      expect(Array.isArray(contextPatterns.sizeTrends)).toBe(true);
      expect(Array.isArray(contextPatterns.anomalies)).toBe(true);
    });
  });

  describe('End-to-End Monitoring Integration', () => {
    it('should handle complete monitoring workflow', async () => {
      // Start monitoring service
      await testMonitoringService.start();
      await testHelper.waitForAsyncOperations(100);

      // Create a session and simulate complete workflow
      const session = await testHelper.createTestSession();

      // Simulate session activity with monitoring
      testMonitoringService.recordToolCall('registerSession', 45, true, { sessionId: session.id });
      
      await testHelper.createTestContext(session.id, 'user_message', 1024);
      testMonitoringService.recordToolCall('updateContext', 65, true, { sessionId: session.id });

      // Simulate handoff
      testMonitoringService.recordHandoffMetrics(session.id, {
        sessionId: session.id,
        agentFrom: 'agent-a',
        agentTo: 'agent-b',
        duration: 120,
        success: true,
        contextSize: 1024
      });

      // Schedule session expiration
      await testSessionManager.scheduleExpiration(session.id);

      // Get comprehensive system status
      const health = await testMonitoringService.getSystemHealth();
      const metrics = testMonitoringService.getPrometheusMetrics();
      const systemMetrics = await testMonitoringService.getSystemMetrics();

      // Verify all monitoring components are working
      expect(health.overall).toMatch(/healthy|degraded/);
      expect(metrics).toContain('tool_calls_total');
      expect(metrics).toContain('handoffs_total');
      expect(systemMetrics.sessions.active).toBeGreaterThan(0);

      // Get analytics
      const timeRange = {
        start: new Date(Date.now() - 60 * 60 * 1000),
        end: new Date()
      };

      const sessionStats = await testAnalyticsService.getSessionStatistics({ timeRange });
      const handoffAnalytics = await testAnalyticsService.getHandoffAnalytics({ timeRange });

      // Verify analytics reflect the activity
      expect(sessionStats.totalSessions).toBeGreaterThan(0);
      expect(handoffAnalytics.totalHandoffs).toBeGreaterThan(0);
      expect(handoffAnalytics.successRate).toBeGreaterThan(0);

      // Verify session lifecycle was tracked
      const lifecycleEvents = await db.query(
        'SELECT event_type FROM session_lifecycle WHERE session_id = $1',
        [session.id]
      );
      expect(lifecycleEvents.rows.length).toBeGreaterThan(0);

      // Stop services
      await testMonitoringService.stop();
    });
  });
});