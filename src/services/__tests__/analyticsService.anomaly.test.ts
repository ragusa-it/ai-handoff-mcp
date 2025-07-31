import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { AnalyticsService, Anomaly, AnomalyDetectionConfig } from '../analyticsService.js';
import { monitoredDb } from '../../database/monitoredDatabase.js';
import { monitoringService } from '../monitoringService.js';

// Mock dependencies
jest.mock('../../database/monitoredDatabase.js');
jest.mock('../monitoringService.js');
jest.mock('../structuredLogger.js');

const mockMonitoredDb = monitoredDb as jest.Mocked<typeof monitoredDb>;
const mockMonitoringService = monitoringService as jest.Mocked<typeof monitoringService>;

describe('AnalyticsService - Anomaly Detection and Recommendations', () => {
  let service: AnalyticsService;
  const now = new Date('2024-01-15T12:00:00Z');
  const timeRange = {
    start: new Date('2024-01-14T12:00:00Z'),
    end: now
  };

  beforeEach(() => {
    service = new AnalyticsService();
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(now);

    // Mock monitoring service methods
    mockMonitoringService.recordPerformanceMetrics.mockImplementation(jest.fn());
    mockMonitoringService.getSystemMetrics.mockResolvedValue({
      timestamp: now,
      memory: { used: 8000000000, total: 16000000000, percentage: 50 },
      cpu: { usage: 30 },
      database: { activeConnections: 25, queryCount: 1000, avgResponseTime: 150 },
      redis: { connected: true, memoryUsage: 100000000, keyCount: 5000 },
      sessions: { active: 500, dormant: 100, archived: 50 }
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('detectAnomalies', () => {
    it('should detect session volume spike anomalies', async () => {
      // Mock session data showing a volume spike
      mockMonitoredDb.query
        .mockResolvedValueOnce({
          rows: [
            { hour: new Date('2024-01-15T11:00:00Z'), session_count: '1000', status: 'active', agent_from: 'agent1' },
            { hour: new Date('2024-01-15T10:00:00Z'), session_count: '100', status: 'active', agent_from: 'agent1' },
            { hour: new Date('2024-01-15T09:00:00Z'), session_count: '120', status: 'active', agent_from: 'agent1' },
            { hour: new Date('2024-01-15T08:00:00Z'), session_count: '110', status: 'active', agent_from: 'agent1' }
          ],
          rowCount: 4
        })
        // Mock performance data
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Mock resource data
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Mock handoff data
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Mock context data
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const anomalies = await service.detectAnomalies();

      expect(anomalies).toHaveLength(1);
      expect(anomalies[0].type).toBe('session_pattern');
      expect(anomalies[0].severity).toBe('high');
      expect(anomalies[0].description).toContain('session volume spike');
      expect(anomalies[0].suggestedActions).toContain('Check for automated session creation');
    });

    it('should detect performance degradation anomalies', async () => {
      // Mock session data
      mockMonitoredDb.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Mock performance data showing degradation
        .mockResolvedValueOnce({
          rows: [
            { operation: 'handoff', hour: new Date('2024-01-15T11:00:00Z'), avg_duration: '8000', operation_count: '10', failed_count: '0' },
            { operation: 'handoff', hour: new Date('2024-01-15T10:00:00Z'), avg_duration: '7500', operation_count: '12', failed_count: '0' },
            { operation: 'handoff', hour: new Date('2024-01-15T09:00:00Z'), avg_duration: '1000', operation_count: '15', failed_count: '0' },
            { operation: 'handoff', hour: new Date('2024-01-15T08:00:00Z'), avg_duration: '1200', operation_count: '8', failed_count: '0' }
          ],
          rowCount: 4
        })
        // Mock other data
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const anomalies = await service.detectAnomalies();

      expect(anomalies).toHaveLength(1);
      expect(anomalies[0].type).toBe('performance_degradation');
      expect(anomalies[0].description).toContain('Performance degradation in handoff');
      expect(anomalies[0].suggestedActions).toContain('Check system resource usage');
    });

    it('should detect resource usage spike anomalies', async () => {
      // Mock data
      mockMonitoredDb.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Mock resource data showing memory spike
        .mockResolvedValueOnce({
          rows: [
            { metric_name: 'memory_usage_percentage', hour: new Date('2024-01-15T11:00:00Z'), avg_value: '95', max_value: '98' },
            { metric_name: 'memory_usage_percentage', hour: new Date('2024-01-15T10:00:00Z'), avg_value: '50', max_value: '55' },
            { metric_name: 'memory_usage_percentage', hour: new Date('2024-01-15T09:00:00Z'), avg_value: '45', max_value: '50' }
          ],
          rowCount: 3
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const anomalies = await service.detectAnomalies();

      expect(anomalies).toHaveLength(1);
      expect(anomalies[0].type).toBe('resource_spike');
      expect(anomalies[0].description).toContain('memory usage_percentage spike');
      expect(anomalies[0].severity).toBe('critical');
    });

    it('should detect handoff failure anomalies', async () => {
      // Mock data
      mockMonitoredDb.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Mock handoff data showing high failure rate
        .mockResolvedValueOnce({
          rows: [
            { 
              hour: new Date('2024-01-15T11:00:00Z'), 
              total_handoffs: '20', 
              failed_handoffs: '12', 
              avg_duration: '3000',
              agent_from: 'agent1',
              agent_to: 'agent2'
            },
            { 
              hour: new Date('2024-01-15T10:00:00Z'), 
              total_handoffs: '15', 
              failed_handoffs: '2', 
              avg_duration: '2000',
              agent_from: 'agent1',
              agent_to: 'agent2'
            }
          ],
          rowCount: 2
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const anomalies = await service.detectAnomalies();

      expect(anomalies).toHaveLength(1);
      expect(anomalies[0].type).toBe('handoff_failure');
      expect(anomalies[0].description).toContain('High handoff failure rate');
      expect(anomalies[0].suggestedActions).toContain('Check agent connectivity');
    });

    it('should detect context growth anomalies', async () => {
      // Mock data
      mockMonitoredDb.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Mock context data showing unusual growth
        .mockResolvedValueOnce({
          rows: [
            { 
              hour: new Date('2024-01-15T11:00:00Z'), 
              entry_count: '25000', 
              avg_size: '50000', 
              max_size: '10485760', // 10MB
              total_size: '1250000000'
            },
            { 
              hour: new Date('2024-01-15T10:00:00Z'), 
              entry_count: '1000', 
              avg_size: '30000', 
              max_size: '100000',
              total_size: '30000000'
            },
            { 
              hour: new Date('2024-01-15T09:00:00Z'), 
              entry_count: '1100', 
              avg_size: '32000', 
              max_size: '120000',
              total_size: '35200000'
            }
          ],
          rowCount: 2
        });

      const anomalies = await service.detectAnomalies({
        thresholds: {
          sessionVolumeSpike: 3.0,
          performanceDegradation: 50,
          resourceUsageSpike: 80,
          handoffFailureRate: 20,
          contextGrowthRate: 2.5
        }
      });

      expect(anomalies).toHaveLength(2); // Volume growth + size spike
      expect(anomalies.some(a => a.type === 'context_growth' && a.description.includes('volume growth'))).toBe(true);
      expect(anomalies.some(a => a.type === 'context_growth' && a.description.includes('Large context entry'))).toBe(true);
    });

    it('should use custom detection configuration', async () => {
      const customConfig: Partial<AnomalyDetectionConfig> = {
        sensitivity: 0.9,
        thresholds: {
          sessionVolumeSpike: 2.0,
          performanceDegradation: 25,
          resourceUsageSpike: 70,
          handoffFailureRate: 15,
          contextGrowthRate: 2.5
        }
      };

      // Mock minimal data
      mockMonitoredDb.query
        .mockResolvedValue({ rows: [], rowCount: 0 });

      await service.detectAnomalies(customConfig);

      // Verify the method was called (configuration is used internally)
      expect(mockMonitoredDb.query).toHaveBeenCalled();
    });
  });

  describe('generateRecommendations', () => {
    beforeEach(() => {
      // Mock all the data fetching methods
      jest.spyOn(service, 'getPerformanceTrends').mockResolvedValue({
        operationMetrics: {
          'handoff': {
            totalCalls: 1000,
            successfulCalls: 950,
            failedCalls: 50,
            successRate: 95,
            avgDuration: 2500,
            minDuration: 100,
            maxDuration: 8000,
            p95Duration: 5000,
            trend: 'degrading'
          }
        },
        databasePerformance: {
          totalQueries: 5000,
          slowQueries: 50,
          avgQueryTime: 600,
          errorRate: 2,
          connectionPoolUsage: 75,
          cacheHitRate: 85,
          topSlowQueries: []
        },
        systemResourceTrends: [],
        slowOperations: [
          { operation: 'complex_query', timestamp: now, duration: 3000 },
          { operation: 'data_processing', timestamp: now, duration: 2500 }
        ],
        timeRange
      });

      jest.spyOn(service, 'getResourceUtilization').mockResolvedValue({
        current: {
          memoryUsage: 85,
          cpuUsage: 70,
          diskUsage: 60,
          networkIO: 50,
          activeConnections: 120,
          activeSessions: 1500
        },
        historical: [],
        alerts: [],
        recommendations: []
      });

      jest.spyOn(service, 'getSessionStatistics').mockResolvedValue({
        totalSessions: 2000,
        activeSessions: 1500,
        completedSessions: 400,
        expiredSessions: 80,
        archivedSessions: 20,
        averageSessionDuration: 90000, // 25 hours
        averageContextVolume: 150,
        averageParticipantCount: 2.5,
        sessionsByStatus: { active: 1500, completed: 400, expired: 80, failed: 20 },
        sessionsByAgent: { agent1: 1000, agent2: 1000 },
        timeRange
      });

      jest.spyOn(service, 'getHandoffAnalytics').mockResolvedValue({
        totalHandoffs: 500,
        successfulHandoffs: 425,
        failedHandoffs: 75,
        successRate: 85,
        averageProcessingTime: 6000,
        handoffsByRoute: {},
        failureReasons: {},
        handoffTrends: [],
        timeRange
      });
    });

    it('should generate performance recommendations for slow operations', async () => {
      const recommendations = await service.generateRecommendations();

      const perfRec = recommendations.find(r => r.type === 'performance' && r.title.includes('Slow Operations'));
      expect(perfRec).toBeDefined();
      expect(perfRec!.priority).toBe('medium');
      expect(perfRec!.actionItems).toContain('Profile slow database queries and add indexes');
    });

    it('should generate resource recommendations for high memory usage', async () => {
      // Override the monitoring service mock for this test
      mockMonitoringService.getSystemMetrics.mockResolvedValueOnce({
        timestamp: now,
        memory: { used: 13600000000, total: 16000000000, percentage: 85 },
        cpu: { usage: 70 },
        database: { activeConnections: 120, queryCount: 1000, avgResponseTime: 150 },
        redis: { connected: true, memoryUsage: 100000000, keyCount: 5000 },
        sessions: { active: 1500, dormant: 100, archived: 50 }
      });

      const recommendations = await service.generateRecommendations();

      const resourceRec = recommendations.find(r => r.type === 'resource' && r.title.includes('Memory Usage'));
      expect(resourceRec).toBeDefined();
      expect(resourceRec!.priority).toBe('high');
      expect(resourceRec!.actionItems).toContain('Increase available memory or scale horizontally');
    });

    it('should generate session management recommendations', async () => {
      const recommendations = await service.generateRecommendations();

      const sessionRec = recommendations.find(r => r.type === 'configuration' && r.title.includes('Session Duration'));
      expect(sessionRec).toBeDefined();
      expect(sessionRec!.actionItems).toContain('Review session timeout policies');
    });

    it('should generate handoff optimization recommendations', async () => {
      const recommendations = await service.generateRecommendations();

      const handoffRecs = recommendations.filter(r => r.title.includes('Handoff'));
      expect(handoffRecs.length).toBeGreaterThan(0);
      
      const successRateRec = handoffRecs.find(r => r.title.includes('Success Rate'));
      expect(successRateRec).toBeDefined();
      expect(successRateRec!.priority).toBe('medium');

      const performanceRec = handoffRecs.find(r => r.title.includes('Processing'));
      expect(performanceRec).toBeDefined();
      expect(performanceRec!.actionItems).toContain('Profile handoff processing pipeline');
    });

    it('should generate configuration recommendations', async () => {
      const recommendations = await service.generateRecommendations();

      const configRec = recommendations.find(r => r.type === 'configuration' && r.title.includes('Database'));
      expect(configRec).toBeDefined();
      expect(configRec!.actionItems).toContain('Add database indexes for frequently queried columns');
    });

    it('should sort recommendations by priority', async () => {
      const recommendations = await service.generateRecommendations();

      expect(recommendations.length).toBeGreaterThan(0);
      
      // Check that high priority recommendations come before medium priority
      const priorities = recommendations.map(r => r.priority);
      const highIndex = priorities.indexOf('high');
      const mediumIndex = priorities.indexOf('medium');
      
      if (highIndex !== -1 && mediumIndex !== -1) {
        expect(highIndex).toBeLessThan(mediumIndex);
      }
    });
  });

  describe('analyzeTrends', () => {
    it('should analyze session count trends', async () => {
      mockMonitoredDb.query.mockResolvedValue({
        rows: [
          { timestamp: new Date('2024-01-14T12:00:00Z'), value: '100' },
          { timestamp: new Date('2024-01-14T13:00:00Z'), value: '120' },
          { timestamp: new Date('2024-01-14T14:00:00Z'), value: '140' },
          { timestamp: new Date('2024-01-14T15:00:00Z'), value: '160' },
          { timestamp: new Date('2024-01-14T16:00:00Z'), value: '180' }
        ],
        rowCount: 5
      });

      const trends = await service.analyzeTrends(['session_count'], timeRange);

      expect(trends).toHaveLength(1);
      expect(trends[0].metric).toBe('session_count');
      expect(trends[0].trend).toBe('increasing');
      expect(trends[0].changeRate).toBeGreaterThan(0);
      expect(trends[0].confidence).toBeGreaterThan(0.8);
    });

    it('should analyze handoff success rate trends', async () => {
      mockMonitoredDb.query.mockResolvedValue({
        rows: [
          { timestamp: new Date('2024-01-14T12:00:00Z'), value: '95.0' },
          { timestamp: new Date('2024-01-14T13:00:00Z'), value: '92.0' },
          { timestamp: new Date('2024-01-14T14:00:00Z'), value: '88.0' },
          { timestamp: new Date('2024-01-14T15:00:00Z'), value: '85.0' }
        ],
        rowCount: 4
      });

      const trends = await service.analyzeTrends(['handoff_success_rate'], timeRange);

      expect(trends).toHaveLength(1);
      expect(trends[0].metric).toBe('handoff_success_rate');
      expect(trends[0].trend).toBe('decreasing');
      expect(trends[0].changeRate).toBeLessThan(0);
    });

    it('should detect stable trends', async () => {
      mockMonitoredDb.query.mockResolvedValue({
        rows: [
          { timestamp: new Date('2024-01-14T12:00:00Z'), value: '100' },
          { timestamp: new Date('2024-01-14T13:00:00Z'), value: '101' },
          { timestamp: new Date('2024-01-14T14:00:00Z'), value: '99' },
          { timestamp: new Date('2024-01-14T15:00:00Z'), value: '100' },
          { timestamp: new Date('2024-01-14T16:00:00Z'), value: '102' }
        ],
        rowCount: 5
      });

      const trends = await service.analyzeTrends(['memory_usage'], timeRange);

      expect(trends).toHaveLength(1);
      expect(trends[0].trend).toBe('stable');
    });

    it('should generate forecasts for trends', async () => {
      mockMonitoredDb.query.mockResolvedValue({
        rows: [
          { timestamp: new Date('2024-01-14T12:00:00Z'), value: '100' },
          { timestamp: new Date('2024-01-14T13:00:00Z'), value: '110' },
          { timestamp: new Date('2024-01-14T14:00:00Z'), value: '120' },
          { timestamp: new Date('2024-01-14T15:00:00Z'), value: '130' }
        ],
        rowCount: 4
      });

      const trends = await service.analyzeTrends(['session_count'], timeRange);

      expect(trends[0].forecast).toBeDefined();
      expect(trends[0].forecast!.length).toBe(24); // 24 hour forecast
      expect(trends[0].forecast![0].predictedValue).toBeGreaterThan(130);
      expect(trends[0].forecast![0].confidenceInterval).toBeDefined();
    });
  });

  describe('triggerAnomalyAlerts', () => {
    it('should trigger alerts for medium and higher severity anomalies', async () => {
      // Reset mock call count
      jest.clearAllMocks();
      
      const anomalies: Anomaly[] = [
        {
          id: 'test-low',
          timestamp: now,
          type: 'session_pattern',
          severity: 'low',
          description: 'Low severity anomaly',
          affectedComponents: ['test'],
          metrics: {},
          confidence: 0.5,
          suggestedActions: []
        },
        {
          id: 'test-medium',
          timestamp: now,
          type: 'performance_degradation',
          severity: 'medium',
          description: 'Medium severity anomaly',
          affectedComponents: ['test'],
          metrics: {},
          confidence: 0.7,
          suggestedActions: []
        },
        {
          id: 'test-critical',
          timestamp: now,
          type: 'resource_spike',
          severity: 'critical',
          description: 'Critical severity anomaly',
          affectedComponents: ['test'],
          metrics: {},
          confidence: 0.9,
          suggestedActions: []
        }
      ];

      mockMonitoredDb.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await service.triggerAnomalyAlerts(anomalies);

      // Should record metrics for medium and critical anomalies (not low)
      expect(mockMonitoredDb.query).toHaveBeenCalledTimes(3); // 2 anomaly metrics + 1 critical notification
    });

    it('should handle critical anomaly notifications', async () => {
      // Reset mock call count
      jest.clearAllMocks();
      
      const criticalAnomaly: Anomaly = {
        id: 'test-critical',
        timestamp: now,
        type: 'resource_spike',
        severity: 'critical',
        description: 'Critical memory spike',
        affectedComponents: ['memory', 'system'],
        metrics: { memoryUsage: 98 },
        confidence: 0.95,
        suggestedActions: ['Scale resources immediately']
      };

      mockMonitoredDb.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await service.triggerAnomalyAlerts([criticalAnomaly]);

      // Should record both anomaly metric and critical notification
      expect(mockMonitoredDb.query).toHaveBeenCalledTimes(2);
    });
  });

  describe('error handling', () => {
    it('should handle database errors gracefully in anomaly detection', async () => {
      mockMonitoredDb.query.mockRejectedValue(new Error('Database connection failed'));

      await expect(service.detectAnomalies()).rejects.toThrow('Database connection failed');
      expect(mockMonitoringService.recordPerformanceMetrics).toHaveBeenCalledWith(
        'detect_anomalies',
        expect.objectContaining({ success: false })
      );
    });

    it('should handle errors in recommendation generation', async () => {
      jest.spyOn(service, 'getPerformanceTrends').mockRejectedValue(new Error('Performance data unavailable'));

      await expect(service.generateRecommendations()).rejects.toThrow('Performance data unavailable');
      expect(mockMonitoringService.recordPerformanceMetrics).toHaveBeenCalledWith(
        'generate_recommendations',
        expect.objectContaining({ success: false })
      );
    });
  });

  describe('caching', () => {
    it('should cache anomaly detection results', async () => {
      mockMonitoredDb.query.mockResolvedValue({ rows: [], rowCount: 0 });

      // First call
      await service.detectAnomalies();
      const firstCallCount = mockMonitoredDb.query.mock.calls.length;

      // Second call should use cache
      await service.detectAnomalies();
      expect(mockMonitoredDb.query.mock.calls.length).toBe(firstCallCount);
    });

    it('should cache recommendation results', async () => {
      // Mock the methods to avoid actual database calls
      jest.spyOn(service, 'getPerformanceTrends').mockResolvedValue({
        operationMetrics: {},
        databasePerformance: {
          totalQueries: 0,
          slowQueries: 0,
          avgQueryTime: 0,
          errorRate: 0,
          connectionPoolUsage: 0,
          cacheHitRate: 0,
          topSlowQueries: []
        },
        systemResourceTrends: [],
        slowOperations: [],
        timeRange
      });

      jest.spyOn(service, 'getResourceUtilization').mockResolvedValue({
        current: {
          memoryUsage: 50,
          cpuUsage: 30,
          diskUsage: 40,
          networkIO: 20,
          activeConnections: 25,
          activeSessions: 500
        },
        historical: [],
        alerts: [],
        recommendations: []
      });

      jest.spyOn(service, 'getSessionStatistics').mockResolvedValue({
        totalSessions: 1000,
        activeSessions: 500,
        completedSessions: 400,
        expiredSessions: 80,
        archivedSessions: 20,
        averageSessionDuration: 3600,
        averageContextVolume: 100,
        averageParticipantCount: 2,
        sessionsByStatus: {},
        sessionsByAgent: {},
        timeRange
      });

      jest.spyOn(service, 'getHandoffAnalytics').mockResolvedValue({
        totalHandoffs: 200,
        successfulHandoffs: 190,
        failedHandoffs: 10,
        successRate: 95,
        averageProcessingTime: 2000,
        handoffsByRoute: {},
        failureReasons: {},
        handoffTrends: [],
        timeRange
      });

      // First call
      const firstResult = await service.generateRecommendations();
      
      // Second call should return cached result
      const secondResult = await service.generateRecommendations();
      
      expect(firstResult).toEqual(secondResult);
    });
  });
});