import { AnalyticsService, type AnalyticsQuery } from '../analyticsService.js';
import { monitoredDb } from '../../database/monitoredDatabase.js';
import { monitoringService } from '../monitoringService.js';

// Mock the monitored database
jest.mock('../../database/monitoredDatabase.js', () => ({
  monitoredDb: {
    query: jest.fn()
  }
}));

// Mock the monitoring service
jest.mock('../monitoringService.js', () => ({
  monitoringService: {
    recordPerformanceMetrics: jest.fn(),
    storeMetricsAggregation: jest.fn(),
    getSystemMetrics: jest.fn()
  }
}));

describe('AnalyticsService', () => {
  let analyticsService: AnalyticsService;
  const mockDb = monitoredDb as jest.Mocked<typeof monitoredDb>;
  const mockMonitoringService = monitoringService as jest.Mocked<typeof monitoringService>;

  const defaultQuery: AnalyticsQuery = {
    timeRange: {
      start: new Date('2023-01-01T00:00:00Z'),
      end: new Date('2023-01-01T23:59:59Z')
    },
    granularity: 'hour'
  };

  beforeEach(() => {
    analyticsService = new AnalyticsService();
    jest.clearAllMocks();
  });

  describe('getSessionStatistics', () => {
    it('should calculate session statistics correctly', async () => {
      // Mock session counts data
      mockDb.query
        .mockResolvedValueOnce({
          rows: [
            { status: 'active', count: '10', avg_duration_seconds: '300', avg_context_volume: '5', avg_participant_count: '2' },
            { status: 'completed', count: '5', avg_duration_seconds: '600', avg_context_volume: '8', avg_participant_count: '3' },
            { status: 'expired', count: '2', avg_duration_seconds: '900', avg_context_volume: '3', avg_participant_count: '1' }
          ],
          rowCount: 3
        })
        .mockResolvedValueOnce({
          rows: [
            { agent_from: 'agent1', count: '12' },
            { agent_from: 'agent2', count: '5' }
          ],
          rowCount: 2
        });

      const result = await analyticsService.getSessionStatistics(defaultQuery);

      expect(result).toEqual({
        totalSessions: 17,
        activeSessions: 10,
        completedSessions: 5,
        expiredSessions: 2,
        archivedSessions: 0,
        averageSessionDuration: expect.any(Number),
        averageContextVolume: expect.any(Number),
        averageParticipantCount: expect.any(Number),
        sessionsByStatus: {
          active: 10,
          completed: 5,
          expired: 2
        },
        sessionsByAgent: {
          agent1: 12,
          agent2: 5
        },
        timeRange: defaultQuery.timeRange
      });

      expect(mockDb.query).toHaveBeenCalledTimes(2);
      expect(mockMonitoringService.recordPerformanceMetrics).toHaveBeenCalledWith(
        'get_session_statistics',
        expect.objectContaining({
          operation: 'get_session_statistics',
          success: true
        })
      );
    });

    it('should handle empty data gracefully', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await analyticsService.getSessionStatistics(defaultQuery);

      expect(result.totalSessions).toBe(0);
      expect(result.activeSessions).toBe(0);
      expect(result.averageSessionDuration).toBe(0);
      expect(result.sessionsByStatus).toEqual({});
      expect(result.sessionsByAgent).toEqual({});
    });

    it('should apply filters correctly', async () => {
      const queryWithFilters: AnalyticsQuery = {
        ...defaultQuery,
        filters: {
          sessionStatus: ['active', 'completed'],
          agentNames: ['agent1']
        }
      };

      mockDb.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await analyticsService.getSessionStatistics(queryWithFilters);

      expect(mockDb.query).toHaveBeenNthCalledWith(1, 
        expect.stringContaining('AND s.status = ANY($3)'),
        [defaultQuery.timeRange.start, defaultQuery.timeRange.end, ['active', 'completed']]
      );

      expect(mockDb.query).toHaveBeenNthCalledWith(2,
        expect.stringContaining('AND agent_from = ANY($3)'),
        [defaultQuery.timeRange.start, defaultQuery.timeRange.end, ['agent1']]
      );
    });

    it('should handle database errors', async () => {
      const error = new Error('Database connection failed');
      mockDb.query.mockRejectedValue(error);

      await expect(analyticsService.getSessionStatistics(defaultQuery))
        .rejects.toThrow('Database connection failed');

      expect(mockMonitoringService.recordPerformanceMetrics).toHaveBeenCalledWith(
        'get_session_statistics',
        expect.objectContaining({
          operation: 'get_session_statistics',
          success: false,
          metadata: expect.objectContaining({
            error: 'Database connection failed'
          })
        })
      );
    });
  });

  describe('getHandoffAnalytics', () => {
    it('should calculate handoff analytics correctly', async () => {
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            success: true,
            duration_ms: '1000',
            agent_from: 'agent1',
            agent_to: 'agent2',
            context_size: '5000',
            error_type: null,
            created_at: '2023-01-01T10:00:00Z'
          },
          {
            success: false,
            duration_ms: '2000',
            agent_from: 'agent1',
            agent_to: 'agent2',
            context_size: '3000',
            error_type: 'timeout',
            created_at: '2023-01-01T11:00:00Z'
          },
          {
            success: true,
            duration_ms: '800',
            agent_from: 'agent2',
            agent_to: 'agent3',
            context_size: '4000',
            error_type: null,
            created_at: '2023-01-01T12:00:00Z'
          }
        ],
        rowCount: 3
      });

      const result = await analyticsService.getHandoffAnalytics(defaultQuery);

      expect(result).toEqual({
        totalHandoffs: 3,
        successfulHandoffs: 2,
        failedHandoffs: 1,
        successRate: expect.closeTo(66.67, 1),
        averageProcessingTime: expect.closeTo(1266.67, 1),
        handoffsByRoute: {
          'agent1->agent2': expect.objectContaining({
            count: 2,
            successRate: 50,
            avgProcessingTime: expect.any(Number),
            avgContextSize: expect.any(Number)
          }),
          'agent2->agent3': expect.objectContaining({
            count: 1,
            successRate: 100,
            avgProcessingTime: 800,
            avgContextSize: 4000
          })
        },
        failureReasons: {
          timeout: 1
        },
        handoffTrends: expect.any(Array),
        timeRange: defaultQuery.timeRange
      });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM performance_logs pl'),
        [defaultQuery.timeRange.start, defaultQuery.timeRange.end]
      );
    });

    it('should calculate handoff trends by time buckets', async () => {
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            success: true,
            duration_ms: '1000',
            agent_from: 'agent1',
            agent_to: 'agent2',
            context_size: '5000',
            error_type: null,
            created_at: '2023-01-01T10:30:00Z' // Hour bucket 10:00-11:00
          },
          {
            success: false,
            duration_ms: '2000',
            agent_from: 'agent1',
            agent_to: 'agent2',
            context_size: '3000',
            error_type: 'timeout',
            created_at: '2023-01-01T10:45:00Z' // Same hour bucket
          },
          {
            success: true,
            duration_ms: '800',
            agent_from: 'agent2',
            agent_to: 'agent3',
            context_size: '4000',
            error_type: null,
            created_at: '2023-01-01T11:30:00Z' // Hour bucket 11:00-12:00
          }
        ],
        rowCount: 3
      });

      const result = await analyticsService.getHandoffAnalytics(defaultQuery);

      expect(result.handoffTrends).toHaveLength(2);
      
      // First bucket (10:00-11:00) should have 2 handoffs with 50% success rate
      const firstBucket = result.handoffTrends.find(trend => 
        trend.timestamp.getUTCHours() === 10
      );
      expect(firstBucket).toBeDefined();
      expect(firstBucket?.count).toBe(2);
      expect(firstBucket?.successRate).toBe(50);

      // Second bucket (11:00-12:00) should have 1 handoff with 100% success rate
      const secondBucket = result.handoffTrends.find(trend => 
        trend.timestamp.getUTCHours() === 11
      );
      expect(secondBucket).toBeDefined();
      expect(secondBucket?.count).toBe(1);
      expect(secondBucket?.successRate).toBe(100);
    });
  });

  describe('getContextGrowthPatterns', () => {
    it('should analyze context growth patterns correctly', async () => {
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            context_type: 'message',
            content_size_bytes: '1000',
            created_at: '2023-01-01T10:00:00Z',
            session_key: 'session1'
          },
          {
            context_type: 'message',
            content_size_bytes: '1500',
            created_at: '2023-01-01T10:30:00Z',
            session_key: 'session1'
          },
          {
            context_type: 'file',
            content_size_bytes: '50000',
            created_at: '2023-01-01T11:00:00Z',
            session_key: 'session2'
          },
          {
            context_type: 'tool_call',
            content_size_bytes: '500',
            created_at: '2023-01-01T11:30:00Z',
            session_key: 'session2'
          }
        ],
        rowCount: 4
      });

      const result = await analyticsService.getContextGrowthPatterns(defaultQuery);

      expect(result).toEqual({
        totalContextEntries: 4,
        contentTypeDistribution: {
          message: {
            count: 2,
            avgSize: 1250,
            totalSize: 2500,
            percentage: 50
          },
          file: {
            count: 1,
            avgSize: 50000,
            totalSize: 50000,
            percentage: 25
          },
          tool_call: {
            count: 1,
            avgSize: 500,
            totalSize: 500,
            percentage: 25
          }
        },
        growthTrends: expect.any(Array),
        sizeTrends: expect.any(Array),
        anomalies: expect.any(Array),
        timeRange: defaultQuery.timeRange
      });

      expect(result.growthTrends.length).toBeGreaterThan(0);
      expect(result.sizeTrends.length).toBeGreaterThan(0);
    });

    it('should detect size anomalies', async () => {
      // Mock data with a large file that should trigger anomaly detection
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            context_type: 'message',
            content_size_bytes: '1000',
            created_at: '2023-01-01T10:00:00Z',
            session_key: 'session1'
          },
          {
            context_type: 'file',
            content_size_bytes: '10000000', // 10MB - should trigger anomaly
            created_at: '2023-01-01T11:00:00Z',
            session_key: 'session2'
          }
        ],
        rowCount: 2
      });

      const result = await analyticsService.getContextGrowthPatterns(defaultQuery);

      expect(result.anomalies.length).toBeGreaterThan(0);
      const sizeAnomaly = result.anomalies.find(a => a.type === 'size_spike');
      expect(sizeAnomaly).toBeDefined();
      expect(sizeAnomaly?.severity).toBe('high');
    });
  });

  describe('getPerformanceTrends', () => {
    it('should analyze performance trends correctly', async () => {
      // Mock performance logs
      mockDb.query
        .mockResolvedValueOnce({
          rows: [
            {
              operation: 'get_session',
              duration_ms: '100',
              success: true,
              created_at: '2023-01-01T10:00:00Z',
              metadata: '{}'
            },
            {
              operation: 'get_session',
              duration_ms: '150',
              success: true,
              created_at: '2023-01-01T10:30:00Z',
              metadata: '{}'
            },
            {
              operation: 'create_session',
              duration_ms: '200',
              success: true,
              created_at: '2023-01-01T11:00:00Z',
              metadata: '{}'
            },
            {
              operation: 'create_session',
              duration_ms: '3000', // Slow operation
              success: false,
              created_at: '2023-01-01T11:30:00Z',
              metadata: '{}'
            }
          ],
          rowCount: 4
        })
        // Mock system metrics
        .mockResolvedValueOnce({
          rows: [
            {
              metric_name: 'memory_usage_percentage',
              metric_value: '75.5',
              recorded_at: '2023-01-01T10:00:00Z',
              labels: '{}'
            },
            {
              metric_name: 'cpu_usage_percentage',
              metric_value: '45.2',
              recorded_at: '2023-01-01T10:00:00Z',
              labels: '{}'
            },
            {
              metric_name: 'active_sessions',
              metric_value: '25',
              recorded_at: '2023-01-01T10:00:00Z',
              labels: '{}'
            }
          ],
          rowCount: 3
        })
        // Mock database performance query
        .mockResolvedValueOnce({
          rows: [
            {
              total_queries: '100',
              slow_queries: '5',
              avg_query_time: '50',
              failed_queries: '2',
              operation: 'SELECT'
            }
          ],
          rowCount: 1
        });

      const result = await analyticsService.getPerformanceTrends(defaultQuery);

      expect(result).toEqual({
        operationMetrics: {
          get_session: {
            totalCalls: 2,
            successfulCalls: 2,
            failedCalls: 0,
            successRate: 100,
            avgDuration: 125,
            minDuration: 100,
            maxDuration: 150,
            p95Duration: expect.any(Number),
            trend: expect.any(String)
          },
          create_session: {
            totalCalls: 2,
            successfulCalls: 1,
            failedCalls: 1,
            successRate: 50,
            avgDuration: 1600,
            minDuration: 200,
            maxDuration: 3000,
            p95Duration: expect.any(Number),
            trend: expect.any(String)
          }
        },
        databasePerformance: expect.objectContaining({
          totalQueries: 100,
          slowQueries: 5,
          avgQueryTime: 50,
          errorRate: 2
        }),
        systemResourceTrends: expect.any(Array),
        slowOperations: expect.arrayContaining([
          expect.objectContaining({
            operation: 'create_session',
            duration: 3000
          })
        ]),
        timeRange: defaultQuery.timeRange
      });

      expect(result.slowOperations.length).toBe(1);
      expect(result.systemResourceTrends.length).toBeGreaterThan(0);
    });

    it('should filter operations when specified', async () => {
      const queryWithFilters: AnalyticsQuery = {
        ...defaultQuery,
        filters: {
          operations: ['get_session']
        }
      };

      mockDb.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await analyticsService.getPerformanceTrends(queryWithFilters);

      expect(mockDb.query).toHaveBeenNthCalledWith(1,
        expect.stringContaining('AND operation = ANY($3)'),
        [defaultQuery.timeRange.start, defaultQuery.timeRange.end, ['get_session']]
      );
    });
  });

  describe('getResourceUtilization', () => {
    it('should return current and historical resource utilization', async () => {
      // Mock current system metrics
      mockMonitoringService.getSystemMetrics.mockResolvedValue({
        timestamp: new Date(),
        memory: { used: 8000000000, total: 16000000000, percentage: 50 },
        cpu: { usage: 25 },
        database: { activeConnections: 10, queryCount: 100, avgResponseTime: 50 },
        redis: { connected: true, memoryUsage: 1000000, keyCount: 500 },
        sessions: { active: 20, dormant: 5, archived: 100 }
      });

      // Mock historical data
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            metric_name: 'memory_usage_percentage',
            metric_value: '60',
            recorded_at: '2023-01-01T10:00:00Z'
          },
          {
            metric_name: 'cpu_usage_percentage',
            metric_value: '40',
            recorded_at: '2023-01-01T10:00:00Z'
          },
          {
            metric_name: 'active_connections',
            metric_value: '15',
            recorded_at: '2023-01-01T10:00:00Z'
          },
          {
            metric_name: 'active_sessions',
            metric_value: '25',
            recorded_at: '2023-01-01T10:00:00Z'
          }
        ],
        rowCount: 4
      });

      const result = await analyticsService.getResourceUtilization(defaultQuery);

      expect(result).toEqual({
        current: {
          memoryUsage: 50,
          cpuUsage: 25,
          diskUsage: 0,
          networkIO: 0,
          activeConnections: 10,
          activeSessions: 20
        },
        historical: expect.any(Array),
        alerts: expect.any(Array),
        recommendations: expect.any(Array)
      });

      expect(result.historical.length).toBeGreaterThan(0);
      expect(mockMonitoringService.getSystemMetrics).toHaveBeenCalled();
    });

    it('should generate alerts for high resource usage', async () => {
      mockMonitoringService.getSystemMetrics.mockResolvedValue({
        timestamp: new Date(),
        memory: { used: 15000000000, total: 16000000000, percentage: 93.75 },
        cpu: { usage: 85 },
        database: { activeConnections: 150, queryCount: 100, avgResponseTime: 50 },
        redis: { connected: true, memoryUsage: 1000000, keyCount: 500 },
        sessions: { active: 20, dormant: 5, archived: 100 }
      });

      // Mock historical data with high resource usage
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            metric_name: 'memory_usage_percentage',
            metric_value: '95', // Should trigger critical alert
            recorded_at: '2023-01-01T10:00:00Z'
          },
          {
            metric_name: 'cpu_usage_percentage',
            metric_value: '85', // Should trigger warning alert
            recorded_at: '2023-01-01T10:00:00Z'
          },
          {
            metric_name: 'active_connections',
            metric_value: '150', // Should trigger warning alert
            recorded_at: '2023-01-01T10:00:00Z'
          }
        ],
        rowCount: 3
      });

      const result = await analyticsService.getResourceUtilization(defaultQuery);

      expect(result.alerts.length).toBeGreaterThan(0);
      
      const memoryAlert = result.alerts.find(a => a.type === 'memory');
      expect(memoryAlert).toBeDefined();
      expect(memoryAlert?.severity).toBe('critical');

      const cpuAlert = result.alerts.find(a => a.type === 'cpu');
      expect(cpuAlert).toBeDefined();
      expect(cpuAlert?.severity).toBe('warning');

      expect(result.recommendations.length).toBeGreaterThan(0);
      const scaleUpRecommendation = result.recommendations.find(r => r.type === 'scale_up');
      expect(scaleUpRecommendation).toBeDefined();
    });
  });

  describe('aggregateAnalyticsData', () => {
    it('should aggregate hourly session stats', async () => {
      const timeBucket = new Date('2023-01-01T10:00:00Z');
      
      mockDb.query.mockResolvedValueOnce({
        rows: [
          { status: 'active', count: '5', avg_duration: '300' },
          { status: 'completed', count: '3', avg_duration: '600' }
        ],
        rowCount: 2
      });

      await analyticsService.aggregateAnalyticsData(timeBucket, 'hourly_session_stats');

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM sessions'),
        [timeBucket, new Date('2023-01-01T11:00:00Z')]
      );

      expect(mockMonitoringService.storeMetricsAggregation).toHaveBeenCalledWith(
        'hourly_session_stats',
        timeBucket,
        expect.objectContaining({
          timestamp: timeBucket,
          totalSessions: 8,
          sessionsByStatus: {
            active: 5,
            completed: 3
          }
        })
      );
    });

    it('should aggregate hourly handoff stats', async () => {
      const timeBucket = new Date('2023-01-01T10:00:00Z');
      
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            success: true,
            count: '10',
            avg_duration: '1000',
            agent_from: 'agent1',
            agent_to: 'agent2'
          },
          {
            success: false,
            count: '2',
            avg_duration: '2000',
            agent_from: 'agent1',
            agent_to: 'agent2'
          }
        ],
        rowCount: 2
      });

      await analyticsService.aggregateAnalyticsData(timeBucket, 'hourly_handoff_stats');

      expect(mockMonitoringService.storeMetricsAggregation).toHaveBeenCalledWith(
        'hourly_handoff_stats',
        timeBucket,
        expect.objectContaining({
          timestamp: timeBucket,
          totalHandoffs: 12,
          successfulHandoffs: 10,
          failedHandoffs: 2,
          successRate: expect.closeTo(83.33, 1)
        })
      );
    });

    it('should handle unknown aggregation types', async () => {
      const timeBucket = new Date('2023-01-01T10:00:00Z');
      
      await expect(
        analyticsService.aggregateAnalyticsData(timeBucket, 'unknown_type')
      ).rejects.toThrow('Unknown aggregation type: unknown_type');
    });
  });

  describe('caching', () => {
    it('should cache results and return from cache on subsequent calls', async () => {
      // Mock first call
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ status: 'active', count: '5' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ agent_from: 'agent1', count: '5' }], rowCount: 1 });

      // First call should hit database
      const result1 = await analyticsService.getSessionStatistics(defaultQuery);
      expect(mockDb.query).toHaveBeenCalledTimes(2);

      // Reset mock call count
      jest.clearAllMocks();

      // Second call should return from cache
      const result2 = await analyticsService.getSessionStatistics(defaultQuery);
      expect(mockDb.query).not.toHaveBeenCalled();
      expect(result2).toEqual(result1);
    });

    it('should not use cache for different queries', async () => {
      const query1 = defaultQuery;
      const query2 = {
        ...defaultQuery,
        filters: { sessionStatus: ['active'] }
      };

      // Mock both calls
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ status: 'active', count: '5' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ agent_from: 'agent1', count: '5' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ status: 'active', count: '3' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ agent_from: 'agent1', count: '3' }], rowCount: 1 });

      await analyticsService.getSessionStatistics(query1);
      await analyticsService.getSessionStatistics(query2);

      expect(mockDb.query).toHaveBeenCalledTimes(4); // Both queries hit database
    });
  });

  describe('error handling', () => {
    it('should handle and log errors gracefully', async () => {
      const error = new Error('Database error');
      mockDb.query.mockRejectedValue(error);

      await expect(analyticsService.getSessionStatistics(defaultQuery))
        .rejects.toThrow('Database error');

      expect(mockMonitoringService.recordPerformanceMetrics).toHaveBeenCalledWith(
        'get_session_statistics',
        expect.objectContaining({
          success: false,
          metadata: expect.objectContaining({
            error: 'Database error'
          })
        })
      );
    });

    it('should handle partial data gracefully', async () => {
      // Mock incomplete data
      mockDb.query
        .mockResolvedValueOnce({
          rows: [
            { status: 'active', count: '5', avg_duration_seconds: null, avg_context_volume: null }
          ],
          rowCount: 1
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await analyticsService.getSessionStatistics(defaultQuery);

      expect(result.totalSessions).toBe(5);
      expect(result.averageSessionDuration).toBe(0);
      expect(result.averageContextVolume).toBe(0);
      expect(result.sessionsByAgent).toEqual({});
    });
  });
});