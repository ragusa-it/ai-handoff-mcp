import { MetricsCollector, MetricsUtils, createOptimizedMetricsCollection } from '../metricsCollection';
import { SystemMetrics, BusinessMetrics, TechnicalMetrics, MetricAlert } from '../types';

// Mock console methods
const mockConsoleDebug = jest.spyOn(console, 'debug').mockImplementation();
const mockConsoleWarn = jest.spyOn(console, 'warn').mockImplementation();

describe('MetricsCollector', () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    collector = new MetricsCollector();
    jest.useFakeTimers();
  });

  afterEach(() => {
    collector.close();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize with default configuration', () => {
      expect(collector).toBeInstanceOf(MetricsCollector);
    });

    it('should initialize with custom configuration', () => {
      const customCollector = new MetricsCollector({
        collectionInterval: 10000,
        alertThresholds: {
          maxResponseTime: 50,
          maxErrorRate: 10,
          maxDatabaseLatency: 25,
          maxDatabaseErrors: 50,
          maxApiErrors: 25,
          maxMemoryUsage: 85,
          maxCpuUsage: 80
        }
      });
      
      expect(customCollector).toBeInstanceOf(MetricsCollector);
      customCollector.close();
    });
  });

  describe('Metrics Collection', () => {
    it('should start and stop collection', () => {
      collector.startCollection();
      expect((collector as any).isCollecting).toBe(true);
      
      collector.stopCollection();
      expect((collector as any).isCollecting).toBe(false);
    });

    it('should collect metrics at regular intervals', () => {
      const collectMetricsSpy = jest.spyOn(collector as any, 'collectMetrics');
      
      collector.startCollection();
      jest.advanceTimersByTime(60000); // Advance by 1 minute
      
      // Should have collected metrics at least once
      expect(collectMetricsSpy).toHaveBeenCalled();
    });

    it('should update business metrics', () => {
      const initialMetrics = collector.getBusinessMetrics();
      
      collector.updateBusinessMetrics({
        sessionsCreated: 10,
        handoffsProcessed: 5,
        successfulHandoffs: 4,
        failedHandoffs: 1
      });
      
      const updatedMetrics = collector.getBusinessMetrics();
      expect(updatedMetrics.sessionsCreated).toBe(10);
      expect(updatedMetrics.handoffsProcessed).toBe(5);
      expect(updatedMetrics.successfulHandoffs).toBe(4);
      expect(updatedMetrics.failedHandoffs).toBe(1);
      expect(updatedMetrics.sessionsCreated).not.toBe(initialMetrics.sessionsCreated);
    });

    it('should update technical metrics', () => {
      const initialMetrics = collector.getTechnicalMetrics();
      
      collector.updateTechnicalMetrics({
        databaseQueries: 100,
        databaseQueryTime: 500,
        apiRequests: 200,
        apiResponseTime: 300,
        memoryUsage: 65.5,
        cpuUsage: 30.2
      });
      
      const updatedMetrics = collector.getTechnicalMetrics();
      expect(updatedMetrics.databaseQueries).toBe(100);
      expect(updatedMetrics.databaseQueryTime).toBe(500);
      expect(updatedMetrics.apiRequests).toBe(200);
      expect(updatedMetrics.apiResponseTime).toBe(300);
      expect(updatedMetrics.memoryUsage).toBe(65.5);
      expect(updatedMetrics.cpuUsage).toBe(30.2);
      expect(updatedMetrics.databaseQueries).not.toBe(initialMetrics.databaseQueries);
    });

    it('should reset metrics', () => {
      // Update some metrics first
      collector.updateBusinessMetrics({
        sessionsCreated: 10,
        handoffsProcessed: 5
      });
      
      collector.updateTechnicalMetrics({
        databaseQueries: 100,
        apiRequests: 200
      });
      
      // Reset metrics
      collector.resetMetrics();
      
      const businessMetrics = collector.getBusinessMetrics();
      const technicalMetrics = collector.getTechnicalMetrics();
      
      // All metrics should be reset to 0
      expect(businessMetrics.sessionsCreated).toBe(0);
      expect(businessMetrics.handoffsProcessed).toBe(0);
      expect(technicalMetrics.databaseQueries).toBe(0);
      expect(technicalMetrics.apiRequests).toBe(0);
    });

    it('should get complete metrics snapshot', () => {
      collector.updateBusinessMetrics({
        sessionsCreated: 15,
        successfulHandoffs: 12
      });
      
      collector.updateTechnicalMetrics({
        memoryUsage: 72.3,
        cpuUsage: 45.6
      });
      
      const metrics = collector.getMetrics();
      
      expect(metrics).toHaveProperty('uptime');
      expect(metrics).toHaveProperty('timestamp');
      expect(metrics.business.sessionsCreated).toBe(15);
      expect(metrics.business.successfulHandoffs).toBe(12);
      expect(metrics.technical.memoryUsage).toBe(72.3);
      expect(metrics.technical.cpuUsage).toBe(45.6);
    });
  });

  describe('Alerting System', () => {
    it('should emit alert when database errors exceed threshold', () => {
      const alertCallback = jest.fn();
      collector.on('alert', alertCallback);
      
      // Set database errors above threshold
      collector.updateTechnicalMetrics({
        databaseErrors: 15 // Default threshold is 10
      });
      
      // Trigger metrics collection
      (collector as any).collectMetrics();
      
      expect(alertCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'HIGH_DATABASE_LATENCY',
          severity: 'WARNING'
        })
      );
      
      // Trigger metrics collection
      (collector as any).collectMetrics();
      
      expect(alertCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'HIGH_DATABASE_ERRORS',
          severity: 'WARNING'
        })
      );
    });

    it('should emit alert when API errors exceed threshold', () => {
      const alertCallback = jest.fn();
      collector.on('alert', alertCallback);
      
      // Set API errors above threshold
      collector.updateTechnicalMetrics({
        apiErrors: 8 // Default threshold is 5
      });
      
      // Trigger metrics collection
      (collector as any).collectMetrics();
      
      expect(alertCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'HIGH_ERROR_RATE',
          severity: 'CRITICAL'
        })
      );
      
      // Trigger metrics collection
      (collector as any).collectMetrics();
      
      expect(alertCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'HIGH_API_ERRORS',
          severity: 'WARNING'
        })
      );
    });

    it('should emit alert when memory usage exceeds threshold', () => {
      const alertCallback = jest.fn();
      collector.on('alert', alertCallback);
      
      // Set memory usage above threshold
      collector.updateTechnicalMetrics({
        memoryUsage: 95 // Default threshold is 90
      });
      
      // Trigger metrics collection
      (collector as any).collectMetrics();
      
      expect(alertCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'HIGH_MEMORY_USAGE',
          severity: 'WARNING'
        })
      );
    });

    it('should emit alert when CPU usage exceeds threshold', () => {
      const alertCallback = jest.fn();
      collector.on('alert', alertCallback);
      
      // Set CPU usage above threshold
      collector.updateTechnicalMetrics({
        cpuUsage: 85 // Default threshold is 80
      });
      
      // Trigger metrics collection
      (collector as any).collectMetrics();
      
      expect(alertCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'HIGH_CPU_USAGE',
          severity: 'WARNING'
        })
      );
    });
  });

  describe('Metrics Utilities', () => {
    describe('calculateAverage', () => {
      it('should calculate average of numbers', () => {
        const values = [1, 2, 3, 4, 5];
        const average = MetricsUtils.calculateAverage(values);
        expect(average).toBe(3);
      });

      it('should return 0 for empty array', () => {
        const average = MetricsUtils.calculateAverage([]);
        expect(average).toBe(0);
      });
    });

    describe('calculatePercentile', () => {
      it('should calculate percentile correctly', () => {
        const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        const percentile50 = MetricsUtils.calculatePercentile(values, 50);
        const percentile90 = MetricsUtils.calculatePercentile(values, 90);
        
        expect(percentile50).toBe(5.5);
        expect(percentile90).toBe(9.1);
      });

      it('should return 0 for empty array', () => {
        const percentile = MetricsUtils.calculatePercentile([], 50);
        expect(percentile).toBe(0);
      });
    });

    describe('calculateRate', () => {
      it('should calculate rate per second', () => {
        const rate = MetricsUtils.calculateRate(100, 10); // 100 events in 10 seconds
        expect(rate).toBe(10); // 10 events per second
      });
    });

    describe('formatForPrometheus', () => {
      it('should format metrics for Prometheus export', () => {
        const metrics: SystemMetrics = {
          uptime: 3600000,
          timestamp: new Date(),
          business: {
            sessionsCreated: 100,
            sessionsCompleted: 95,
            handoffsProcessed: 80,
            contextEntriesAdded: 500,
            toolCallsMade: 200,
            userInteractions: 150,
            successfulHandoffs: 75,
            failedHandoffs: 5,
            averageHandoffTime: 1200,
            averageContextSize: 250
          },
          technical: {
            databaseQueries: 1000,
            databaseQueryTime: 5000,
            databaseErrors: 2,
            redisOperations: 500,
            redisOperationTime: 1000,
            redisErrors: 1,
            apiRequests: 300,
            apiResponseTime: 2000,
            apiErrors: 3,
            memoryUsage: 65.5,
            cpuUsage: 30.2,
            activeConnections: 25,
            cacheHits: 400,
            cacheMisses: 100
          }
        };
        
        const prometheusFormat = MetricsUtils.formatForPrometheus(metrics);
        expect(prometheusFormat).toContain('sessions_created_total 100');
        expect(prometheusFormat).toContain('handoffs_processed_total 80');
        expect(prometheusFormat).toContain('database_queries_total 1000');
        expect(prometheusFormat).toContain('memory_usage_percent 65.5');
        expect(prometheusFormat).toContain('cpu_usage_percent 30.2');
      });
    });
  });

  describe('Optimized Metrics Collection', () => {
    it('should create optimized metrics collection', () => {
      const metricsClient = createOptimizedMetricsCollection();
      
      expect(metricsClient).toHaveProperty('collector');
      expect(metricsClient).toHaveProperty('utils');
      expect(metricsClient.collector).toBeInstanceOf(MetricsCollector);
      expect(metricsClient.utils).toBe(MetricsUtils);
      
      // Should start collecting automatically
      expect((metricsClient.collector as any).isCollecting).toBe(true);
      
      metricsClient.collector.close();
    });

    it('should create optimized metrics collection with custom config', () => {
      const metricsClient = createOptimizedMetricsCollection({
        collectionInterval: 30000,
        alertThresholds: {
          maxResponseTime: 20,
          maxErrorRate: 5,
          maxDatabaseLatency: 10,
          maxDatabaseErrors: 20,
          maxApiErrors: 10,
          maxMemoryUsage: 85,
          maxCpuUsage: 75
        }
      });
      
      expect(metricsClient.collector).toBeInstanceOf(MetricsCollector);
      metricsClient.collector.close();
    });
  });
});

// Restore console methods
afterAll(() => {
  mockConsoleDebug.mockRestore();
  mockConsoleWarn.mockRestore();
});