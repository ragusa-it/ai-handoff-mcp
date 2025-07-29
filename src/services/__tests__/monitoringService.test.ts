import { MonitoringService } from '../monitoringService.js';
import { db } from '../../database/index.js';

// Mock the database
jest.mock('../../database/index.js', () => ({
  db: {
    query: jest.fn(),
    setCache: jest.fn(),
    getCache: jest.fn(),
    deleteCache: jest.fn(),
    healthCheck: jest.fn()
  }
}));

// Mock the structured logger
jest.mock('../structuredLogger.js', () => ({
  structuredLogger: {
    logPerformanceMetric: jest.fn(),
    logSystemEvent: jest.fn(),
    logError: jest.fn(),
    logWarning: jest.fn()
  }
}));

describe('MonitoringService', () => {
  let monitoringService: MonitoringService;
  const mockDb = db as jest.Mocked<typeof db>;

  beforeEach(() => {
    jest.clearAllMocks();
    monitoringService = new MonitoringService({
      healthCheckInterval: 1, // 1 second for testing
      metricsCollectionInterval: 1,
      alertThresholds: {
        responseTime: 1000,
        errorRate: 5,
        memoryUsage: 80,
        diskUsage: 85
      },
      enablePrometheusExport: true,
      enableHealthEndpoint: true
    });
  });

  afterEach(async () => {
    await monitoringService.stop();
  });

  describe('Health Checks', () => {
    it('should check database health successfully', async () => {
      // Mock successful database query
      mockDb.query.mockResolvedValueOnce({ rows: [{ result: 1 }], rowCount: 1 });
      mockDb.query.mockResolvedValueOnce({ rows: [{ count: '5' }], rowCount: 1 });

      const health = await monitoringService.checkDatabaseHealth();

      expect(health.status).toBe('healthy');
      expect(health.responseTime).toBeGreaterThanOrEqual(0);
      expect(health.lastCheck).toBeInstanceOf(Date);
      expect(health.details).toBeDefined();
      expect(health.details?.sessionCount).toBe(5);
    });

    it('should detect database health issues', async () => {
      // Mock database error
      mockDb.query.mockRejectedValueOnce(new Error('Connection failed'));

      const health = await monitoringService.checkDatabaseHealth();

      expect(health.status).toBe('unhealthy');
      expect(health.error).toBe('Connection failed');
      expect(health.responseTime).toBeGreaterThanOrEqual(0);
    });

    it('should check Redis health successfully', async () => {
      // Mock successful Redis operations
      mockDb.query.mockResolvedValueOnce({ rows: [{ result: 1 }], rowCount: 1 });
      mockDb.setCache.mockResolvedValueOnce();
      mockDb.getCache.mockResolvedValueOnce({ test: true });
      mockDb.deleteCache.mockResolvedValueOnce();

      const health = await monitoringService.checkRedisHealth();

      expect(health.status).toBe('healthy');
      expect(health.responseTime).toBeGreaterThanOrEqual(0);
      expect(health.details?.testSuccessful).toBe(true);
    });

    it('should detect Redis health issues', async () => {
      // Mock Redis error
      mockDb.setCache.mockRejectedValueOnce(new Error('Redis connection failed'));

      const health = await monitoringService.checkRedisHealth();

      expect(health.status).toBe('unhealthy');
      expect(health.error).toBe('Redis connection failed');
    });

    it('should check system health', async () => {
      const health = await monitoringService.checkSystemHealth();

      expect(health.status).toMatch(/healthy|degraded|unhealthy/);
      expect(health.responseTime).toBeGreaterThanOrEqual(0);
      expect(health.details).toBeDefined();
      expect(health.details?.memory).toBeDefined();
      expect(health.details?.cpu).toBeDefined();
      expect(health.details?.uptime).toBeGreaterThan(0);
    });

    it('should get comprehensive system health', async () => {
      // Mock successful health checks
      mockDb.query.mockResolvedValue({ rows: [{ result: 1 }], rowCount: 1 });
      mockDb.setCache.mockResolvedValue();
      mockDb.getCache.mockResolvedValue({ test: true });
      mockDb.deleteCache.mockResolvedValue();

      const health = await monitoringService.getSystemHealth();

      expect(health.overall).toMatch(/healthy|degraded|unhealthy/);
      expect(health.components.database).toBeDefined();
      expect(health.components.redis).toBeDefined();
      expect(health.components.system).toBeDefined();
      expect(health.timestamp).toBeInstanceOf(Date);
      expect(health.uptime).toBeGreaterThanOrEqual(0);
    });

    it('should respond within 1 second under normal conditions', async () => {
      // Mock fast responses
      mockDb.query.mockResolvedValue({ rows: [{ result: 1 }], rowCount: 1 });
      mockDb.setCache.mockResolvedValue();
      mockDb.getCache.mockResolvedValue({ test: true });
      mockDb.deleteCache.mockResolvedValue();

      const startTime = Date.now();
      await monitoringService.getSystemHealth();
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(1000); // Should respond within 1 second
    });
  });

  describe('Metrics Collection', () => {
    it('should record tool call metrics', () => {
      const toolName = 'test-tool';
      const duration = 150;
      const success = true;
      const metadata = { param1: 'value1' };

      expect(() => {
        monitoringService.recordToolCall(toolName, duration, success, metadata);
      }).not.toThrow();
    });

    it('should record handoff metrics', () => {
      const sessionId = 'test-session-id';
      const metrics = {
        sessionId,
        agentFrom: 'agent1',
        agentTo: 'agent2',
        duration: 200,
        success: true,
        contextSize: 1024
      };

      expect(() => {
        monitoringService.recordHandoffMetrics(sessionId, metrics);
      }).not.toThrow();
    });

    it('should record performance metrics', () => {
      const operation = 'test-operation';
      const metrics = {
        operation,
        duration: 100,
        success: true,
        memoryUsage: 50,
        cpuUsage: 25
      };

      expect(() => {
        monitoringService.recordPerformanceMetrics(operation, metrics);
      }).not.toThrow();
    });

    it('should record database query metrics', () => {
      const query = 'SELECT * FROM sessions WHERE id = $1';
      const duration = 50;
      const success = true;

      expect(() => {
        monitoringService.recordDatabaseQuery(query, duration, success);
      }).not.toThrow();
    });

    it('should record Redis operation metrics', () => {
      const operation = 'GET';
      const duration = 10;
      const success = true;

      expect(() => {
        monitoringService.recordRedisOperation(operation, duration, success);
      }).not.toThrow();
    });
  });

  describe('System Metrics', () => {
    it('should get system metrics', async () => {
      // Mock database query for session counts
      mockDb.query.mockResolvedValueOnce({
        rows: [{ active: '3', dormant: '1', archived: '2' }],
        rowCount: 1
      });

      const metrics = await monitoringService.getSystemMetrics();

      expect(metrics.timestamp).toBeInstanceOf(Date);
      expect(metrics.memory).toBeDefined();
      expect(metrics.memory.used).toBeGreaterThan(0);
      expect(metrics.memory.total).toBeGreaterThan(0);
      expect(metrics.memory.percentage).toBeGreaterThanOrEqual(0);
      expect(metrics.cpu).toBeDefined();
      expect(metrics.sessions).toBeDefined();
      expect(metrics.sessions.active).toBe(3);
      expect(metrics.sessions.dormant).toBe(1);
      expect(metrics.sessions.archived).toBe(2);
    });
  });

  describe('Prometheus Metrics', () => {
    it('should generate Prometheus metrics', () => {
      // Record some metrics first
      monitoringService.recordToolCall('test-tool', 100, true);
      monitoringService.recordHandoffMetrics('session1', {
        sessionId: 'session1',
        agentFrom: 'agent1',
        agentTo: 'agent2',
        duration: 200,
        success: true
      });

      const prometheusMetrics = monitoringService.getPrometheusMetrics();

      expect(prometheusMetrics).toContain('tool_calls_total');
      expect(prometheusMetrics).toContain('handoffs_total');
      expect(prometheusMetrics).toContain('system_memory_usage_bytes');
      expect(prometheusMetrics).toContain('system_uptime_seconds');
    });

    it('should return empty string when Prometheus export is disabled', () => {
      const disabledService = new MonitoringService({
        enablePrometheusExport: false,
        healthCheckInterval: 30,
        metricsCollectionInterval: 60,
        alertThresholds: {
          responseTime: 1000,
          errorRate: 5,
          memoryUsage: 80,
          diskUsage: 85
        },
        enableHealthEndpoint: true
      });

      const prometheusMetrics = disabledService.getPrometheusMetrics();
      expect(prometheusMetrics).toBe('');
    });
  });

  describe('Service Lifecycle', () => {
    it('should start and stop the service', async () => {
      expect(monitoringService['isRunning']).toBe(false);

      await monitoringService.start();
      expect(monitoringService['isRunning']).toBe(true);

      await monitoringService.stop();
      expect(monitoringService['isRunning']).toBe(false);
    });

    it('should not start twice', async () => {
      await monitoringService.start();
      await monitoringService.start(); // Should not throw or cause issues
      expect(monitoringService['isRunning']).toBe(true);
    });

    it('should not stop twice', async () => {
      await monitoringService.start();
      await monitoringService.stop();
      await monitoringService.stop(); // Should not throw or cause issues
      expect(monitoringService['isRunning']).toBe(false);
    });
  });

  describe('Configuration', () => {
    it('should update configuration', () => {
      const newConfig = {
        healthCheckInterval: 60,
        alertThresholds: {
          responseTime: 2000,
          errorRate: 10,
          memoryUsage: 90,
          diskUsage: 95
        }
      };

      expect(() => {
        monitoringService.updateConfig(newConfig);
      }).not.toThrow();
    });
  });
});