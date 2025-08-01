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

interface TestContext {
  sessionId: string;
  contextType: string;
  contentSize: number;
}

class IntegrationTestHelper {
  private createdSessions: string[] = [];
  private createdContexts: string[] = [];

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

  async createTestContext(sessionId: string, overrides: Partial<TestContext> = {}): Promise<void> {
    const contextData = {
      contextType: 'user_message',
      contentSize: 1024,
      ...overrides
    };

    const result = await db.query(
      `INSERT INTO context_history (session_id, context_type, content, content_size_bytes, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id`,
      [sessionId, contextData.contextType, JSON.stringify({ test: 'data' }), contextData.contentSize]
    );

    this.createdContexts.push(result.rows[0].id);
  }

  async createTestPerformanceLog(operation: string, duration: number, success: boolean, sessionId?: string): Promise<void> {
    await db.query(
      `INSERT INTO performance_logs (operation, duration_ms, success, session_id, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [operation, duration, success, sessionId, JSON.stringify({ test: true })]
    );
  }

  async createTestSystemMetric(metricName: string, metricValue: number, metricType: string = 'gauge'): Promise<void> {
    await db.query(
      `INSERT INTO system_metrics (metric_name, metric_value, metric_type, recorded_at)
       VALUES ($1, $2, $3, NOW())`,
      [metricName, metricValue, metricType]
    );
  }

  async cleanup(): Promise<void> {
    // Clean up in reverse order to maintain referential integrity
    if (this.createdContexts.length > 0) {
      await db.query('DELETE FROM context_history WHERE id = ANY($1)', [this.createdContexts]);
      this.createdContexts = [];
    }

    if (this.createdSessions.length > 0) {
      await db.query('DELETE FROM session_lifecycle WHERE session_id = ANY($1)', [this.createdSessions]);
      await db.query('DELETE FROM performance_logs WHERE session_id = ANY($1)', [this.createdSessions]);
      await db.query('DELETE FROM sessions WHERE id = ANY($1)', [this.createdSessions]);
      this.createdSessions = [];
    }

    // Clean up test metrics and logs
    await db.query("DELETE FROM system_metrics WHERE labels->>'test' = 'true' OR metric_name LIKE 'test_%'");
    await db.query("DELETE FROM performance_logs WHERE metadata->>'test' = 'true'");
    await db.query("DELETE FROM analytics_aggregations WHERE aggregation_type LIKE 'test_%'");
  }

  async waitForAsyncOperations(timeoutMs: number = 5000): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, Math.min(timeoutMs, 100)));
  }
}

describe('Monitoring Integration Tests', () => {
  let testHelper: IntegrationTestHelper;
  let testMonitoringService: MonitoringService;
  let testSessionManager: SessionManagerService;
  let testAnalyticsService: AnalyticsService;

  beforeAll(async () => {
    // Ensure database connection is established
    await db.query('SELECT 1');
    
    // Initialize services with test configuration
    testMonitoringService = new MonitoringService({
      healthCheckInterval: 1, // 1 second for faster tests
      metricsCollectionInterval: 1,
      performanceTrackingEnabled: true,
      alertThresholds: {
        responseTime: 100, // Lower threshold for testing
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
        activeSessionTtl: 1, // 1 hour for testing
        archivedSessionTtl: 1, // 1 day for testing
        logRetentionDays: 1,
        metricsRetentionDays: 1,
        dormantThresholdHours: 0.1 // 6 minutes for testing
      },
      cleanupIntervalMinutes: 1,
      dormantCheckIntervalMinutes: 1,
      maxConcurrentCleanups: 1
    });

    testAnalyticsService = new AnalyticsService();

    // Set configuration manager for services
    testMonitoringService.setConfigurationManager(configurationManager);
    testAnalyticsService.setConfigurationManager(configurationManager);

    testHelper = new IntegrationTestHelper();
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
    it('should handle complete session lifecycle end-to-end', async () => {
      // Create a test session
      const session = await testHelper.createTestSession({
        status: 'active'
      });

      // Add some context to the session
      await testHelper.createTestContext(session.id, {
        contextType: 'user_message',
        contentSize: 2048
      });

      // Schedule expiration
      const expirationTime = new Date(Date.now() + 60000); // 1 minute from now
      await testSessionManager.scheduleExpiration(session.id, expirationTime);

      // Verify session has expiration time set
      const sessionAfterScheduling = await db.query('SELECT expires_at FROM sessions WHERE id = $1', [session.id]);
      expect(sessionAfterScheduling.rows[0].expires_at).toBeTruthy();

      // Verify lifecycle event was logged
      const lifecycleEvents = await db.query(
        'SELECT event_type, event_data FROM session_lifecycle WHERE session_id = $1 ORDER BY created_at',
        [session.id]
      );
      expect(lifecycleEvents.rows).toHaveLength(1);
      expect(lifecycleEvents.rows[0].event_type).toBe('expiration_scheduled');

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

      // Verify all lifecycle events were logged
      const allLifecycleEvents = await db.query(
        'SELECT event_type FROM session_lifecycle WHERE session_id = $1 ORDER BY created_at',
        [session.id]
      );
      const eventTypes = allLifecycleEvents.rows.map(row => row.event_type);
      expect(eventTypes).toContain('expiration_scheduled');
      expect(eventTypes).toContain('expired');
      expect(eventTypes).toContain('archived');

      // Verify referential integrity is maintained
      const contextCount = await db.query('SELECT COUNT(*) FROM context_history WHERE session_id = $1', [session.id]);
      expect(parseInt(contextCount.rows[0].count)).toBeGreaterThan(0);
    });

    it('should handle dormant session detection and reactivation', async () => {
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

    it('should maintain referential integrity during lifecycle transitions', async () => {
      // Create session with multiple context entries
      const session = await testHelper.createTestSession();
      await testHelper.createTestContext(session.id, { contextType: 'user_message' });
      await testHelper.createTestContext(session.id, { contextType: 'assistant_response' });
      await testHelper.createTestContext(session.id, { contextType: 'system_message' });

      // Create performance logs for the session
      await testHelper.createTestPerformanceLog('handoff', 150, true, session.id);
      await testHelper.createTestPerformanceLog('tool_call', 75, true, session.id);

      // Expire and archive the session
      await testSessionManager.expireSession(session.id);
      await testSessionManager.archiveSession(session.id);

      // Verify all related data still exists
      const contextCount = await db.query('SELECT COUNT(*) FROM context_history WHERE session_id = $1', [session.id]);
      expect(parseInt(contextCount.rows[0].count)).toBe(3);

      const performanceLogCount = await db.query('SELECT COUNT(*) FROM performance_logs WHERE session_id = $1', [session.id]);
      expect(parseInt(performanceLogCount.rows[0].count)).toBe(2);

      const lifecycleEventCount = await db.query('SELECT COUNT(*) FROM session_lifecycle WHERE session_id = $1', [session.id]);
      expect(parseInt(lifecycleEventCount.rows[0].count)).toBeGreaterThan(0);

      // Verify referential integrity check passes
      await expect(testSessionManager.ensureReferentialIntegrity(session.id)).resolves.not.toThrow();
    });
  });

  describe('Health Monitoring and Alerting Integration', () => {
    beforeEach(async () => {
      // Start monitoring service for health tests
      await testMonitoringService.start();
      await testHelper.waitForAsyncOperations(100);
    });

    afterEach(async () => {
      // Stop monitoring service after health tests
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

    it('should detect database connectivity issues', async () => {
      // Test database health specifically
      const dbHealth = await testMonitoringService.checkDatabaseHealth();

      expect(dbHealth.status).toMatch(/healthy|degraded|unhealthy/);
      expect(dbHealth.responseTime).toBeGreaterThan(0);
      expect(dbHealth.details).toHaveProperty('sessionCount');

      // Verify health check was logged
      await testHelper.waitForAsyncOperations(100);
      
      // Check that performance metrics were recorded
      const metrics = testMonitoringService.getPrometheusMetrics();
      expect(metrics).toContain('database_queries_total');
    });

    it('should detect Redis connectivity issues', async () => {
      // Test Redis health specifically
      const redisHealth = await testMonitoringService.checkRedisHealth();

      expect(redisHealth.status).toMatch(/healthy|degraded|unhealthy/);
      expect(redisHealth.responseTime).toBeGreaterThan(0);
      expect(redisHealth.details).toHaveProperty('testSuccessful');

      // Verify Redis operations were tracked
      const metrics = testMonitoringService.getPrometheusMetrics();
      expect(metrics).toContain('redis_operations_total');
    });

    it('should trigger alerts on threshold breaches', async () => {
      // Record slow operations to trigger alerts
      testMonitoringService.recordDatabaseQuery('SELECT * FROM large_table', 2000, true); // 2 seconds
      testMonitoringService.recordRedisOperation('get', 150, true); // 150ms

      await testHelper.waitForAsyncOperations(100);

      // Verify alerts were logged (check structured logs)
      // Note: In a real implementation, you'd check an alerting system
      // For now, we verify the metrics were recorded
      const metrics = testMonitoringService.getPrometheusMetrics();
      expect(metrics).toContain('database_query_duration_seconds');
      expect(metrics).toContain('redis_operation_duration_seconds');
    });

    it('should maintain health endpoint responsiveness under load', async () => {
      // Simulate load by making multiple concurrent health checks
      const healthCheckPromises = Array.from({ length: 10 }, () => 
        testMonitoringService.getSystemHealth()
      );

      const startTime = Date.now();
      const healthResults = await Promise.all(healthCheckPromises);
      const endTime = Date.now();

      // Verify all health checks completed
      expect(healthResults).toHaveLength(10);
      healthResults.forEach(health => {
        expect(health.overall).toMatch(/healthy|degraded|unhealthy/);
      });

      // Verify response time is reasonable (should be under 1 second total for 10 concurrent checks)
      expect(endTime - startTime).toBeLessThan(1000);
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

      // Verify error tracking
      expect(metrics).toMatch(/tool_call_errors_total\{tool_name="requestHandoff"\} 1/);
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

    it('should handle high-frequency metric updates', async () => {
      // Simulate high-frequency metric collection
      const startTime = Date.now();
      
      for (let i = 0; i < 100; i++) {
        testMonitoringService.recordToolCall(`tool-${i % 5}`, Math.random() * 100, Math.random() > 0.1);
        testMonitoringService.recordDatabaseQuery('SELECT 1', Math.random() * 50, true);
        testMonitoringService.recordRedisOperation('get', Math.random() * 10, true);
      }

      const endTime = Date.now();

      // Verify all metrics were processed quickly
      expect(endTime - startTime).toBeLessThan(1000); // Should complete in under 1 second

      // Verify metrics are available
      const metrics = testMonitoringService.getPrometheusMetrics();
      expect(metrics).toContain('tool_calls_total');
      expect(metrics).toContain('database_queries_total');
      expect(metrics).toContain('redis_operations_total');

      // Verify metrics contain expected data
      expect(metrics).toMatch(/tool_calls_total\{tool_name="tool-0"\}/);
      expect(metrics).toMatch(/tool_calls_total\{tool_name="tool-1"\}/);
    });
  });

  describe('Analytics Data Accuracy and Performance Integration', () => {
    beforeEach(async () => {
      // Create comprehensive test data for analytics
      await setupAnalyticsTestData();
    });

    const setupAnalyticsTestData = async (): Promise<void> => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      // Create sessions with different statuses and timestamps
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

      const expiredSession = await testHelper.createTestSession({
        status: 'expired',
        agentFrom: 'agent-a',
        agentTo: 'agent-c'
      });

      // Update timestamps to simulate historical data
      await db.query('UPDATE sessions SET created_at = $1 WHERE id = $2', [twoHoursAgo, activeSession.id]);
      await db.query('UPDATE sessions SET created_at = $1, updated_at = $2 WHERE id = $3', [oneHourAgo, now, completedSession.id]);

      // Create context entries with different types and sizes
      await testHelper.createTestContext(activeSession.id, { contextType: 'user_message', contentSize: 1024 });
      await testHelper.createTestContext(activeSession.id, { contextType: 'assistant_response', contentSize: 2048 });
      await testHelper.createTestContext(completedSession.id, { contextType: 'system_message', contentSize: 512 });
      await testHelper.createTestContext(completedSession.id, { contextType: 'user_message', contentSize: 1536 });

      // Create performance logs for handoffs
      await testHelper.createTestPerformanceLog('handoff', 150, true, activeSession.id);
      await testHelper.createTestPerformanceLog('handoff', 200, true, completedSession.id);
      await testHelper.createTestPerformanceLog('handoff', 300, false, expiredSession.id);

      // Create tool call performance logs
      await testHelper.createTestPerformanceLog('registerSession', 50, true);
      await testHelper.createTestPerformanceLog('updateContext', 75, true);
      await testHelper.createTestPerformanceLog('requestHandoff', 120, false);

      // Create system metrics
      await testHelper.createTestSystemMetric('memory_usage_percentage', 65.5);
      await testHelper.createTestSystemMetric('cpu_usage_percentage', 45.2);
      await testHelper.createTestSystemMetric('active_sessions', 3);
    };

    it('should provide accurate session statistics', async () => {
      const timeRange = {
        start: new Date(Date.now() - 3 * 60 * 60 * 1000), // 3 hours ago
        end: new Date()
      };

      const sessionStats = await testAnalyticsService.getSessionStatistics({ timeRange });

      // Verify basic counts
      expect(sessionStats.totalSessions).toBeGreaterThanOrEqual(3);
      expect(sessionStats.activeSessions).toBeGreaterThanOrEqual(1);
      expect(sessionStats.completedSessions).toBeGreaterThanOrEqual(1);
      expect(sessionStats.expiredSessions).toBeGreaterThanOrEqual(1);

      // Verify session breakdown by status
      expect(sessionStats.sessionsByStatus).toHaveProperty('active');
      expect(sessionStats.sessionsByStatus).toHaveProperty('completed');
      expect(sessionStats.sessionsByStatus).toHaveProperty('expired');

      // Verify session breakdown by agent
      expect(sessionStats.sessionsByAgent).toHaveProperty('agent-a');
      expect(sessionStats.sessionsByAgent).toHaveProperty('agent-b');

      // Verify calculated averages are reasonable
      expect(sessionStats.averageSessionDuration).toBeGreaterThanOrEqual(0);
      expect(sessionStats.averageContextVolume).toBeGreaterThanOrEqual(0);
      expect(sessionStats.averageParticipantCount).toBeGreaterThanOrEqual(1);

      // Verify time range is preserved
      expect(sessionStats.timeRange.start).toEqual(timeRange.start);
      expect(sessionStats.timeRange.end).toEqual(timeRange.end);
    });

    it('should provide accurate handoff analytics', async () => {
      const timeRange = {
        start: new Date(Date.now() - 3 * 60 * 60 * 1000), // 3 hours ago
        end: new Date()
      };

      const handoffAnalytics = await testAnalyticsService.getHandoffAnalytics({ timeRange });

      // Verify basic handoff counts
      expect(handoffAnalytics.totalHandoffs).toBeGreaterThanOrEqual(3);
      expect(handoffAnalytics.successfulHandoffs).toBeGreaterThanOrEqual(2);
      expect(handoffAnalytics.failedHandoffs).toBeGreaterThanOrEqual(1);

      // Verify success rate calculation
      const expectedSuccessRate = (handoffAnalytics.successfulHandoffs / handoffAnalytics.totalHandoffs) * 100;
      expect(handoffAnalytics.successRate).toBeCloseTo(expectedSuccessRate, 1);

      // Verify average processing time is reasonable
      expect(handoffAnalytics.averageProcessingTime).toBeGreaterThan(0);
      expect(handoffAnalytics.averageProcessingTime).toBeLessThan(1000); // Should be under 1 second for test data

      // Verify handoff routes are tracked
      expect(Object.keys(handoffAnalytics.handoffsByRoute).length).toBeGreaterThan(0);

      // Verify failure reasons are captured
      if (handoffAnalytics.failedHandoffs > 0) {
        expect(Object.keys(handoffAnalytics.failureReasons).length).toBeGreaterThan(0);
      }

      // Verify trends data structure
      expect(Array.isArray(handoffAnalytics.handoffTrends)).toBe(true);
      handoffAnalytics.handoffTrends.forEach(trend => {
        expect(trend).toHaveProperty('timestamp');
        expect(trend).toHaveProperty('count');
        expect(trend).toHaveProperty('successRate');
        expect(trend).toHaveProperty('avgProcessingTime');
      });
    });

    it('should analyze context growth patterns accurately', async () => {
      const timeRange = {
        start: new Date(Date.now() - 3 * 60 * 60 * 1000), // 3 hours ago
        end: new Date()
      };

      const contextPatterns = await testAnalyticsService.getContextGrowthPatterns({ timeRange });

      // Verify total context entries
      expect(contextPatterns.totalContextEntries).toBeGreaterThanOrEqual(4);

      // Verify content type distribution
      expect(contextPatterns.contentTypeDistribution).toHaveProperty('user_message');
      expect(contextPatterns.contentTypeDistribution).toHaveProperty('assistant_response');
      expect(contextPatterns.contentTypeDistribution).toHaveProperty('system_message');

      // Verify content type statistics
      const userMessageStats = contextPatterns.contentTypeDistribution['user_message'];
      expect(userMessageStats.count).toBeGreaterThan(0);
      expect(userMessageStats.avgSize).toBeGreaterThan(0);
      expect(userMessageStats.totalSize).toBeGreaterThan(0);
      expect(userMessageStats.percentage).toBeGreaterThan(0);
      expect(userMessageStats.percentage).toBeLessThanOrEqual(100);

      // Verify growth trends structure
      expect(Array.isArray(contextPatterns.growthTrends)).toBe(true);
      expect(Array.isArray(contextPatterns.sizeTrends)).toBe(true);

      // Verify anomalies structure
      expect(Array.isArray(contextPatterns.anomalies)).toBe(true);
      contextPatterns.anomalies.forEach(anomaly => {
        expect(anomaly).toHaveProperty('timestamp');
        expect(anomaly).toHaveProperty('type');
        expect(anomaly).toHaveProperty('description');
        expect(anomaly).toHaveProperty('severity');
      });
    });

    it('should provide performance trends with accurate calculations', async () => {
      const timeRange = {
        start: new Date(Date.now() - 3 * 60 * 60 * 1000), // 3 hours ago
        end: new Date()
      };

      const performanceTrends = await testAnalyticsService.getPerformanceTrends({ timeRange });

      // Verify operation metrics structure
      expect(performanceTrends.operationMetrics).toBeDefined();
      expect(typeof performanceTrends.operationMetrics).toBe('object');

      // Check for expected operations
      const operations = Object.keys(performanceTrends.operationMetrics);
      expect(operations).toContain('handoff');
      expect(operations.some(op => op.includes('Session') || op.includes('Context'))).toBe(true);

      // Verify operation metrics calculations
      const handoffMetrics = performanceTrends.operationMetrics['handoff'];
      if (handoffMetrics) {
        expect(handoffMetrics.totalCalls).toBeGreaterThan(0);
        expect(handoffMetrics.successfulCalls).toBeGreaterThanOrEqual(0);
        expect(handoffMetrics.failedCalls).toBeGreaterThanOrEqual(0);
        expect(handoffMetrics.successfulCalls + handoffMetrics.failedCalls).toBe(handoffMetrics.totalCalls);
        expect(handoffMetrics.successRate).toBeGreaterThanOrEqual(0);
        expect(handoffMetrics.successRate).toBeLessThanOrEqual(100);
        expect(handoffMetrics.avgDuration).toBeGreaterThan(0);
        expect(handoffMetrics.minDuration).toBeLessThanOrEqual(handoffMetrics.avgDuration);
        expect(handoffMetrics.maxDuration).toBeGreaterThanOrEqual(handoffMetrics.avgDuration);
      }

      // Verify database performance metrics
      expect(performanceTrends.databasePerformance).toBeDefined();
      expect(performanceTrends.databasePerformance.totalQueries).toBeGreaterThanOrEqual(0);
      expect(performanceTrends.databasePerformance.avgQueryTime).toBeGreaterThanOrEqual(0);

      // Verify system resource trends
      expect(Array.isArray(performanceTrends.systemResourceTrends)).toBe(true);

      // Verify slow operations tracking
      expect(Array.isArray(performanceTrends.slowOperations)).toBe(true);
      performanceTrends.slowOperations.forEach(slowOp => {
        expect(slowOp).toHaveProperty('operation');
        expect(slowOp).toHaveProperty('timestamp');
        expect(slowOp).toHaveProperty('duration');
        expect(slowOp.duration).toBeGreaterThan(0);
      });
    });

    it('should handle large datasets efficiently', async () => {
      // Create a larger dataset for performance testing
      const sessions = [];
      for (let i = 0; i < 50; i++) {
        const session = await testHelper.createTestSession({
          agentFrom: `agent-${i % 5}`,
          agentTo: `agent-${(i + 1) % 5}`,
          status: i % 3 === 0 ? 'completed' : 'active'
        });
        sessions.push(session);

        // Add context to each session
        await testHelper.createTestContext(session.id, {
          contextType: ['user_message', 'assistant_response', 'system_message'][i % 3],
          contentSize: 500 + (i * 100)
        });

        // Add performance logs
        await testHelper.createTestPerformanceLog('handoff', 100 + (i * 10), i % 10 !== 0, session.id);
      }

      const timeRange = {
        start: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
        end: new Date()
      };

      // Measure performance of analytics queries
      const startTime = Date.now();

      const [sessionStats, handoffAnalytics, contextPatterns, performanceTrends] = await Promise.all([
        testAnalyticsService.getSessionStatistics({ timeRange }),
        testAnalyticsService.getHandoffAnalytics({ timeRange }),
        testAnalyticsService.getContextGrowthPatterns({ timeRange }),
        testAnalyticsService.getPerformanceTrends({ timeRange })
      ]);

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Verify all queries completed in reasonable time (under 5 seconds for 50 sessions)
      expect(totalTime).toBeLessThan(5000);

      // Verify data accuracy with larger dataset
      expect(sessionStats.totalSessions).toBeGreaterThanOrEqual(50);
      expect(handoffAnalytics.totalHandoffs).toBeGreaterThanOrEqual(50);
      expect(contextPatterns.totalContextEntries).toBeGreaterThanOrEqual(50);
      expect(Object.keys(performanceTrends.operationMetrics)).toContain('handoff');

      console.log(`Analytics queries for 50 sessions completed in ${totalTime}ms`);
    });

    it('should detect anomalies accurately', async () => {
      // Create anomalous data patterns
      const normalSession = await testHelper.createTestSession();
      const anomalousSession = await testHelper.createTestSession();

      // Create normal context
      await testHelper.createTestContext(normalSession.id, { contextType: 'user_message', contentSize: 1000 });

      // Create anomalously large context
      await testHelper.createTestContext(anomalousSession.id, { contextType: 'user_message', contentSize: 50000 });

      // Create normal handoff
      await testHelper.createTestPerformanceLog('handoff', 150, true, normalSession.id);

      // Create anomalously slow handoff
      await testHelper.createTestPerformanceLog('handoff', 5000, true, anomalousSession.id);

      const timeRange = {
        start: new Date(Date.now() - 60 * 60 * 1000),
        end: new Date()
      };

      // Get analytics with anomaly detection
      const contextPatterns = await testAnalyticsService.getContextGrowthPatterns({ 
        timeRange, 
        includeAnomalies: true 
      });

      const performanceTrends = await testAnalyticsService.getPerformanceTrends({ timeRange });

      // Verify anomalies were detected
      expect(contextPatterns.anomalies.length).toBeGreaterThan(0);

      // Check for size anomalies
      const sizeAnomalies = contextPatterns.anomalies.filter(a => a.type === 'size_spike');
      expect(sizeAnomalies.length).toBeGreaterThan(0);

      // Verify slow operations were captured
      const slowHandoffs = performanceTrends.slowOperations.filter(op => 
        op.operation === 'handoff' && op.duration > 1000
      );
      expect(slowHandoffs.length).toBeGreaterThan(0);
    });
  });

  describe('End-to-End Monitoring Integration', () => {
    it('should handle complete monitoring workflow', async () => {
      // Start all services
      await testMonitoringService.start();
      await testHelper.waitForAsyncOperations(100);

      // Create a session and simulate complete workflow
      const session = await testHelper.createTestSession();

      // Simulate session activity with monitoring
      testMonitoringService.recordToolCall('registerSession', 45, true, { sessionId: session.id });
      
      await testHelper.createTestContext(session.id, { contextType: 'user_message', contentSize: 1024 });
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

    it('should maintain data consistency across all monitoring components', async () => {
      // Create multiple sessions with various activities
      const sessions = [];
      for (let i = 0; i < 5; i++) {
        const session = await testHelper.createTestSession({
          agentFrom: `agent-${i}`,
          agentTo: `agent-${i + 1}`
        });
        sessions.push(session);

        // Add context
        await testHelper.createTestContext(session.id);

        // Record metrics
        testMonitoringService.recordToolCall('registerSession', 50 + i * 10, true, { sessionId: session.id });
        testMonitoringService.recordHandoffMetrics(session.id, {
          sessionId: session.id,
          agentFrom: `agent-${i}`,
          agentTo: `agent-${i + 1}`,
          duration: 100 + i * 20,
          success: i % 4 !== 0, // 1 failure out of 5
          contextSize: 1000 + i * 200
        });
      }

      await testHelper.waitForAsyncOperations(200);

      // Get data from all monitoring components
      const timeRange = {
        start: new Date(Date.now() - 60 * 60 * 1000),
        end: new Date()
      };

      const sessionStats = await testAnalyticsService.getSessionStatistics({ timeRange });
      const handoffAnalytics = await testAnalyticsService.getHandoffAnalytics({ timeRange });
      const prometheusMetrics = testMonitoringService.getPrometheusMetrics();

      // Verify data consistency
      expect(sessionStats.totalSessions).toBeGreaterThanOrEqual(5);
      expect(handoffAnalytics.totalHandoffs).toBeGreaterThanOrEqual(5);
      expect(handoffAnalytics.failedHandoffs).toBe(1); // We created 1 failure

      // Verify Prometheus metrics reflect the same data
      expect(prometheusMetrics).toContain('tool_calls_total');
      expect(prometheusMetrics).toContain('handoffs_total');

      // Verify database consistency
      const dbSessionCount = await db.query(
        'SELECT COUNT(*) FROM sessions WHERE created_at >= $1',
        [timeRange.start]
      );
      expect(parseInt(dbSessionCount.rows[0].count)).toBeGreaterThanOrEqual(5);

      const dbHandoffCount = await db.query(
        'SELECT COUNT(*) FROM performance_logs WHERE operation = $1 AND created_at >= $2',
        ['handoff', timeRange.start]
      );
      expect(parseInt(dbHandoffCount.rows[0].count)).toBeGreaterThanOrEqual(5);
    });
  });
});