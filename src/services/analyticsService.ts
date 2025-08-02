import { monitoredDb } from '../database/monitoredDatabase.js';
import { monitoringService, SystemMetrics } from './monitoringService.js';
import { structuredLogger } from './structuredLogger.js';
import { PerformanceTimer } from '../mcp/utils/performance.js';
import type { IConfigurationManager, AnalyticsConfig } from './configurationManager.js';

// Analytics interfaces
export interface SessionStatistics {
  totalSessions: number;
  activeSessions: number;
  completedSessions: number;
  expiredSessions: number;
  archivedSessions: number;
  averageSessionDuration: number;
  averageContextVolume: number;
  averageParticipantCount: number;
  sessionsByStatus: Record<string, number>;
  sessionsByAgent: Record<string, number>;
  timeRange: { start: Date; end: Date };
}

export interface HandoffAnalytics {
  totalHandoffs: number;
  successfulHandoffs: number;
  failedHandoffs: number;
  successRate: number;
  averageProcessingTime: number;
  handoffsByRoute: Record<string, HandoffRouteStats>;
  failureReasons: Record<string, number>;
  handoffTrends: Array<{
    timestamp: Date;
    count: number;
    successRate: number;
    avgProcessingTime: number;
  }>;
  timeRange: { start: Date; end: Date };
}

export interface HandoffRouteStats {
  count: number;
  successRate: number;
  avgProcessingTime: number;
  avgContextSize: number;
}

export interface ContextGrowthPattern {
  totalContextEntries: number;
  contentTypeDistribution: Record<string, ContextTypeStats>;
  growthTrends: Array<{
    timestamp: Date;
    entryCount: number;
    avgContentSize: number;
    contentTypes: Record<string, number>;
  }>;
  sizeTrends: Array<{
    timestamp: Date;
    avgSize: number;
    maxSize: number;
    minSize: number;
  }>;
  anomalies: Array<{
    timestamp: Date;
    type: 'size_spike' | 'volume_spike' | 'unusual_type';
    description: string;
    severity: 'low' | 'medium' | 'high';
  }>;
  timeRange: { start: Date; end: Date };
}

export interface ContextTypeStats {
  count: number;
  avgSize: number;
  totalSize: number;
  percentage: number;
}

export interface PerformanceTrends {
  operationMetrics: Record<string, OperationMetrics>;
  databasePerformance: DatabasePerformanceMetrics;
  systemResourceTrends: Array<{
    timestamp: Date;
    memoryUsage: number;
    cpuUsage: number;
    activeConnections: number;
    activeSessions: number;
  }>;
  slowOperations: Array<{
    operation: string;
    timestamp: Date;
    duration: number;
    metadata?: Record<string, any>;
  }>;
  timeRange: { start: Date; end: Date };
}

export interface OperationMetrics {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  successRate: number;
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
  p95Duration: number;
  trend: 'improving' | 'degrading' | 'stable';
}

export interface DatabasePerformanceMetrics {
  totalQueries: number;
  slowQueries: number;
  avgQueryTime: number;
  errorRate: number;
  connectionPoolUsage: number;
  cacheHitRate: number;
  topSlowQueries: Array<{
    queryPattern: string;
    avgDuration: number;
    count: number;
  }>;
}

export interface ResourceUtilization {
  current: {
    memoryUsage: number;
    cpuUsage: number;
    diskUsage: number;
    networkIO: number;
    activeConnections: number;
    activeSessions: number;
  };
  historical: Array<{
    timestamp: Date;
    memoryUsage: number;
    cpuUsage: number;
    diskUsage: number;
    activeConnections: number;
    activeSessions: number;
  }>;
  alerts: Array<{
    timestamp: Date;
    type: 'memory' | 'cpu' | 'disk' | 'connections';
    threshold: number;
    currentValue: number;
    severity: 'warning' | 'critical';
  }>;
  recommendations: Array<{
    type: 'scale_up' | 'optimize' | 'cleanup';
    description: string;
    priority: 'low' | 'medium' | 'high';
  }>;
}

export interface AnalyticsQuery {
  timeRange: { start: Date; end: Date };
  granularity?: 'hour' | 'day' | 'week' | 'month';
  filters?: {
    sessionStatus?: string[];
    agentNames?: string[];
    operations?: string[];
  };
  includeAnomalies?: boolean;
}

// Anomaly detection interfaces
export interface Anomaly {
  id: string;
  timestamp: Date;
  type: 'session_pattern' | 'performance_degradation' | 'resource_spike' | 'handoff_failure' | 'context_growth';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  affectedComponents: string[];
  metrics: Record<string, number>;
  confidence: number; // 0-1 scale
  suggestedActions: string[];
  relatedAnomalies?: string[];
}

export interface AnomalyDetectionConfig {
  sensitivity: number; // 0-1 scale, higher = more sensitive
  lookbackWindow: number; // hours
  minimumDataPoints: number;
  thresholds: {
    sessionVolumeSpike: number; // multiplier of baseline
    performanceDegradation: number; // percentage increase
    resourceUsageSpike: number; // percentage increase
    handoffFailureRate: number; // percentage
    contextGrowthRate: number; // multiplier of baseline
  };
}

// Recommendation engine interfaces
export interface Recommendation {
  id: string;
  timestamp: Date;
  type: 'performance' | 'resource' | 'configuration' | 'maintenance';
  priority: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  impact: string;
  effort: 'low' | 'medium' | 'high';
  category: 'scaling' | 'optimization' | 'cleanup' | 'monitoring';
  actionItems: string[];
  expectedBenefit: string;
  relatedMetrics: Record<string, number>;
  validUntil?: Date;
}

export interface TrendAnalysis {
  metric: string;
  timeRange: { start: Date; end: Date };
  trend: 'increasing' | 'decreasing' | 'stable' | 'volatile';
  changeRate: number; // percentage change per time unit
  confidence: number; // 0-1 scale
  seasonality?: {
    detected: boolean;
    period?: number; // hours
    amplitude?: number;
  };
  forecast?: Array<{
    timestamp: Date;
    predictedValue: number;
    confidenceInterval: { lower: number; upper: number };
  }>;
}

/**
 * AnalyticsService provides comprehensive analytics and insights
 * for session management, handoff patterns, and system performance
 */
export class AnalyticsService {
  private cache = new Map<string, { data: any; expires: number }>();
  private cacheTimeout = 5 * 60 * 1000; // 5 minutes

  constructor() {
    // Initialize analytics service
    this.initializeAnalytics();
  }

  /**
   * Set the configuration manager for dynamic configuration updates
   */
  setConfigurationManager(configManager: IConfigurationManager): void {
    // Load current analytics configuration
    const currentConfig = configManager.getAnalyticsConfig();
    
    // Listen for configuration changes
    configManager.on('configChanged', (newConfig: any) => {
      const newAnalyticsConfig = newConfig.analytics;
      if (newAnalyticsConfig) {
        this.onConfigurationChanged(newAnalyticsConfig);
      }
    });
    
    // Apply initial configuration
    this.onConfigurationChanged(currentConfig);
  }

  /**
   * Handle configuration changes
   */
  private onConfigurationChanged(newConfig: AnalyticsConfig): void {
    structuredLogger.info('Analytics service operation', {
      timestamp: new Date(),
      metadata: {
        component: 'AnalyticsService',
        operation: 'configurationChanged',
        status: 'completed',
        enableSessionAnalytics: newConfig.enableSessionAnalytics,
        enablePerformanceAnalytics: newConfig.enablePerformanceAnalytics,
        enableUsageAnalytics: newConfig.enableUsageAnalytics,
        enableTrendAnalysis: newConfig.enableTrendAnalysis,
        enablePredictiveAnalytics: newConfig.enablePredictiveAnalytics
      }
    });
  }

  /**
   * Initialize analytics service and start background aggregation
   */
  private async initializeAnalytics(): Promise<void> {
    try {
      // Ensure analytics aggregations table exists and has recent data
      await this.ensureAggregationsUpToDate();

      structuredLogger.info('Analytics service operation', {
        timestamp: new Date(),
        metadata: {
          component: 'AnalyticsService',
          operation: 'initialize',
          status: 'completed'
        }
      });
    } catch (error) {
      structuredLogger.error('Analytics service error', {
        timestamp: new Date(),
        metadata: {
          errorType: 'SystemError',
          component: 'AnalyticsService',
          operation: 'initialize'
        }
      });
    }
  }

  /**
   * Get comprehensive session statistics
   */
  async getSessionStatistics(query: AnalyticsQuery): Promise<SessionStatistics> {
    const timer = new PerformanceTimer();
    const cacheKey = `session_stats_${JSON.stringify(query)}`;

    try {
      // Check cache first
      const cached = this.getFromCache<SessionStatistics>(cacheKey);
      if (cached) {
        return cached;
      }

      structuredLogger.info('Analytics service operation', {
        timestamp: new Date(),
        metadata: {
          component: 'AnalyticsService',
          operation: 'get_session_statistics_start',
          status: 'started',
          timeRange: query.timeRange
        }
      });

      // Get session counts by status
      const sessionCountsQuery = `
        SELECT 
          status,
          COUNT(*) as count,
          AVG(EXTRACT(EPOCH FROM (COALESCE(updated_at, NOW()) - created_at))) as avg_duration_seconds,
          AVG(context_volume) as avg_context_volume,
          AVG(participant_count) as avg_participant_count
        FROM sessions s
        LEFT JOIN (
          SELECT 
            session_id,
            COUNT(*) as context_volume,
            COUNT(DISTINCT CASE WHEN metadata->>'agent' IS NOT NULL THEN metadata->>'agent' END) + 1 as participant_count
          FROM context_history 
          GROUP BY session_id
        ) ch ON s.id = ch.session_id
        WHERE s.created_at BETWEEN $1 AND $2
        ${query.filters?.sessionStatus ? 'AND s.status = ANY($3)' : ''}
        GROUP BY status
      `;

      const params: any[] = [query.timeRange.start, query.timeRange.end];
      if (query.filters?.sessionStatus) {
        params.push(query.filters.sessionStatus);
      }

      const sessionCounts = await monitoredDb.query(sessionCountsQuery, params);
      timer.checkpoint('session_counts');

      // Get sessions by agent
      const agentCountsQuery = `
        SELECT 
          agent_from,
          COUNT(*) as count
        FROM sessions
        WHERE created_at BETWEEN $1 AND $2
        ${query.filters?.agentNames ? 'AND agent_from = ANY($3)' : ''}
        GROUP BY agent_from
        ORDER BY count DESC
      `;

      const agentParams: any[] = [query.timeRange.start, query.timeRange.end];
      if (query.filters?.agentNames) {
        agentParams.push(query.filters.agentNames);
      }

      const agentCounts = await monitoredDb.query(agentCountsQuery, agentParams);
      timer.checkpoint('agent_counts');

      // Calculate statistics
      let totalSessions = 0;
      let activeSessions = 0;
      let completedSessions = 0;
      let expiredSessions = 0;
      let archivedSessions = 0;
      let totalDuration = 0;
      let totalContextVolume = 0;
      let totalParticipants = 0;
      let sessionCount = 0;

      const sessionsByStatus: Record<string, number> = {};

      for (const row of sessionCounts.rows) {
        const count = parseInt(row.count);
        const status = row.status;
        
        sessionsByStatus[status] = count;
        totalSessions += count;

        if (status === 'active') activeSessions = count;
        else if (status === 'completed') completedSessions = count;
        else if (status === 'expired') expiredSessions = count;
        else if (status === 'archived') archivedSessions = count;

        if (row.avg_duration_seconds) {
          totalDuration += parseFloat(row.avg_duration_seconds) * count;
          sessionCount += count;
        }

        if (row.avg_context_volume) {
          totalContextVolume += parseFloat(row.avg_context_volume) * count;
        }

        if (row.avg_participant_count) {
          totalParticipants += parseFloat(row.avg_participant_count) * count;
        }
      }

      const sessionsByAgent: Record<string, number> = {};
      for (const row of agentCounts.rows) {
        sessionsByAgent[row.agent_from] = parseInt(row.count);
      }

      const statistics: SessionStatistics = {
        totalSessions,
        activeSessions,
        completedSessions,
        expiredSessions,
        archivedSessions,
        averageSessionDuration: sessionCount > 0 ? totalDuration / sessionCount : 0,
        averageContextVolume: totalSessions > 0 ? totalContextVolume / totalSessions : 0,
        averageParticipantCount: totalSessions > 0 ? totalParticipants / totalSessions : 0,
        sessionsByStatus,
        sessionsByAgent,
        timeRange: query.timeRange
      };

      // Cache the results
      this.setCache(cacheKey, statistics);

      const duration = timer.getElapsed();

      // Record analytics performance
      monitoringService.recordPerformanceMetrics('get_session_statistics', {
        operation: 'get_session_statistics',
        duration,
        success: true,
        metadata: {
          totalSessions,
          timeRangeHours: (query.timeRange.end.getTime() - query.timeRange.start.getTime()) / (1000 * 60 * 60)
        }
      });

      structuredLogger.info('Analytics service operation', {
        timestamp: new Date(),
        metadata: {
          component: 'AnalyticsService',
          operation: 'get_session_statistics_complete',
          status: 'completed',
          durationMs: duration,
          totalSessions,
          performanceBreakdown: timer.getAllCheckpointDurations()
        }
      });

      return statistics;

    } catch (error) {
      const duration = timer.getElapsed();

      monitoringService.recordPerformanceMetrics('get_session_statistics', {
        operation: 'get_session_statistics',
        duration,
        success: false,
        metadata: { error: (error as Error).message }
      });

      structuredLogger.error('Analytics service error', {
        timestamp: new Date(),
        metadata: {
          errorType: 'ServiceError',
          component: 'AnalyticsService',
          operation: 'get_session_statistics',
          additionalInfo: { timeRange: query.timeRange, durationMs: duration }
        }
      });

      throw error;
    }
  }

  /**
   * Get handoff analytics and success rates
   */
  async getHandoffAnalytics(query: AnalyticsQuery): Promise<HandoffAnalytics> {
    const timer = new PerformanceTimer();
    const cacheKey = `handoff_analytics_${JSON.stringify(query)}`;

    try {
      // Check cache first
      const cached = this.getFromCache<HandoffAnalytics>(cacheKey);
      if (cached) {
        return cached;
      }

      structuredLogger.info('Analytics service operation', {
  timestamp: new Date(),
  metadata: {
    component: 'AnalyticsService',
    operation: 'get_handoff_analytics_start',
    status: 'started',
    timeRange: query.timeRange
  }
});

      // Get handoff data from performance logs and sessions
      const handoffQuery = `
        SELECT 
          pl.success,
          pl.duration_ms,
          pl.metadata->>'agent_from' as agent_from,
          pl.metadata->>'agent_to' as agent_to,
          pl.metadata->>'context_size' as context_size,
          pl.metadata->>'error_type' as error_type,
          pl.created_at
        FROM performance_logs pl
        WHERE pl.operation = 'handoff'
        AND pl.created_at BETWEEN $1 AND $2
        ORDER BY pl.created_at DESC
      `;

      const handoffData = await monitoredDb.query(handoffQuery, [query.timeRange.start, query.timeRange.end]);
      timer.checkpoint('handoff_data');

      // Process handoff statistics
      let totalHandoffs = 0;
      let successfulHandoffs = 0;
      const handoffsByRoute: Record<string, HandoffRouteStats> = {};
      const failureReasons: Record<string, number> = {};
      const processingTimes: number[] = [];

      // Create time buckets for trends
      const granularity = query.granularity || 'hour';
      const trendBuckets = this.createTimeBuckets(query.timeRange, granularity);
      const handoffTrends: Array<{
        timestamp: Date;
        count: number;
        successRate: number;
        avgProcessingTime: number;
      }> = new Array(trendBuckets.length).fill(null).map((_, i) => ({
        timestamp: trendBuckets[i],
        count: 0,
        successRate: 0,
        avgProcessingTime: 0
      }));

      for (const row of handoffData.rows) {
        totalHandoffs++;
        const isSuccess = row.success;
        const duration = parseInt(row.duration_ms) || 0;
        const agentFrom = row.agent_from || 'unknown';
        const agentTo = row.agent_to || 'unknown';
        const contextSize = parseInt(row.context_size) || 0;
        const errorType = row.error_type;
        const timestamp = new Date(row.created_at);

        processingTimes.push(duration);

        if (isSuccess) {
          successfulHandoffs++;
        } else if (errorType) {
          failureReasons[errorType] = (failureReasons[errorType] || 0) + 1;
        }

        // Track by route
        const route = `${agentFrom}->${agentTo}`;
        if (!handoffsByRoute[route]) {
          handoffsByRoute[route] = {
            count: 0,
            successRate: 0,
            avgProcessingTime: 0,
            avgContextSize: 0
          };
        }

        const routeStats = handoffsByRoute[route];
        routeStats.count++;
        routeStats.avgProcessingTime = (routeStats.avgProcessingTime * (routeStats.count - 1) + duration) / routeStats.count;
        routeStats.avgContextSize = (routeStats.avgContextSize * (routeStats.count - 1) + contextSize) / routeStats.count;

        // Add to trend bucket
        const bucketIndex = this.findTimeBucket(timestamp, trendBuckets);
        if (bucketIndex >= 0 && bucketIndex < handoffTrends.length) {
          handoffTrends[bucketIndex].count++;
          handoffTrends[bucketIndex].avgProcessingTime = 
            (handoffTrends[bucketIndex].avgProcessingTime * (handoffTrends[bucketIndex].count - 1) + duration) / handoffTrends[bucketIndex].count;
        }
      }

      // Calculate success rates for routes
      for (const route in handoffsByRoute) {
        const routeSuccesses = handoffData.rows.filter(row => 
          `${row.agent_from || 'unknown'}->${row.agent_to || 'unknown'}` === route && row.success
        ).length;
        handoffsByRoute[route].successRate = (routeSuccesses / handoffsByRoute[route].count) * 100;
      }

      // Calculate success rates for trends
      for (let i = 0; i < handoffTrends.length; i++) {
        const bucketSuccesses = handoffData.rows.filter(row => {
          const timestamp = new Date(row.created_at);
          return this.findTimeBucket(timestamp, trendBuckets) === i && row.success;
        }).length;
        handoffTrends[i].successRate = handoffTrends[i].count > 0 ? (bucketSuccesses / handoffTrends[i].count) * 100 : 0;
      }

      const analytics: HandoffAnalytics = {
        totalHandoffs,
        successfulHandoffs,
        failedHandoffs: totalHandoffs - successfulHandoffs,
        successRate: totalHandoffs > 0 ? (successfulHandoffs / totalHandoffs) * 100 : 0,
        averageProcessingTime: processingTimes.length > 0 ? processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length : 0,
        handoffsByRoute,
        failureReasons,
        handoffTrends: handoffTrends.filter(trend => trend.count > 0),
        timeRange: query.timeRange
      };

      // Cache the results
      this.setCache(cacheKey, analytics);

      const duration = timer.getElapsed();

      monitoringService.recordPerformanceMetrics('get_handoff_analytics', {
        operation: 'get_handoff_analytics',
        duration,
        success: true,
        metadata: {
          totalHandoffs,
          timeRangeHours: (query.timeRange.end.getTime() - query.timeRange.start.getTime()) / (1000 * 60 * 60)
        }
      } as any);

      structuredLogger.info('Analytics service operation', {
  timestamp: new Date(),
  metadata: {
    component: 'AnalyticsService',
    operation: 'get_handoff_analytics_complete',
    status: 'completed',
    durationMs: duration,
    totalHandoffs,
    successRate: analytics.successRate,
    performanceBreakdown: timer.getAllCheckpointDurations()
  }
});

      return analytics;

    } catch (error) {
      const duration = timer.getElapsed();

      monitoringService.recordPerformanceMetrics('get_handoff_analytics', {
        operation: 'get_handoff_analytics',
        duration,
        success: false,
        metadata: { error: (error as Error).message }
      } as any);

      structuredLogger.error('Analytics service error', {
        timestamp: new Date(),
        errorType: 'ServiceError',
        component: 'AnalyticsService',
        operation: 'get_handoff_analytics',
        additionalInfo: { timeRange: query.timeRange, durationMs: duration }
      } as any);

      throw error;
    }
  }

  /**
   * Analyze context growth patterns and content type distribution
   */
  async getContextGrowthPatterns(query: AnalyticsQuery): Promise<ContextGrowthPattern> {
    const timer = new PerformanceTimer();
    const cacheKey = `context_growth_${JSON.stringify(query)}`;

    try {
      // Check cache first
      const cached = this.getFromCache<ContextGrowthPattern>(cacheKey);
      if (cached) {
        return cached;
      }

      structuredLogger.info('Analytics service operation', {
  timestamp: new Date(),
  metadata: {
    component: 'AnalyticsService',
    operation: 'get_context_growth_patterns_start',
    status: 'started',
    timeRange: query.timeRange
  }
});

      // Get context data
      const contextQuery = `
        SELECT 
          ch.context_type,
          ch.content_size_bytes,
          ch.created_at,
          s.session_key
        FROM context_history ch
        JOIN sessions s ON ch.session_id = s.id
        WHERE ch.created_at BETWEEN $1 AND $2
        ORDER BY ch.created_at ASC
      `;

      const contextData = await monitoredDb.query(contextQuery, [query.timeRange.start, query.timeRange.end]);
      timer.checkpoint('context_data');

      // Process content type distribution
      const contentTypeStats: Record<string, ContextTypeStats> = {};
      let totalEntries = 0;
      let totalSize = 0;

      for (const row of contextData.rows) {
        const contextType = row.context_type;
        const size = parseInt(row.content_size_bytes) || 0;

        totalEntries++;
        totalSize += size;

        if (!contentTypeStats[contextType]) {
          contentTypeStats[contextType] = {
            count: 0,
            avgSize: 0,
            totalSize: 0,
            percentage: 0
          };
        }

        const stats = contentTypeStats[contextType];
        stats.count++;
        stats.totalSize += size;
        stats.avgSize = stats.totalSize / stats.count;
      }

      // Calculate percentages
      for (const type in contentTypeStats) {
        contentTypeStats[type].percentage = (contentTypeStats[type].count / totalEntries) * 100;
      }

      // Create growth trends
      const granularity = query.granularity || 'hour';
      const timeBuckets = this.createTimeBuckets(query.timeRange, granularity);
      const growthTrends: Array<{
        timestamp: Date;
        entryCount: number;
        avgContentSize: number;
        contentTypes: Record<string, number>;
      }> = [];

      const sizeTrends: Array<{
        timestamp: Date;
        avgSize: number;
        maxSize: number;
        minSize: number;
      }> = [];

      for (let i = 0; i < timeBuckets.length; i++) {
        const bucketStart = timeBuckets[i];
        const bucketEnd = i < timeBuckets.length - 1 ? timeBuckets[i + 1] : query.timeRange.end;

        const bucketData = contextData.rows.filter(row => {
          const timestamp = new Date(row.created_at);
          return timestamp >= bucketStart && timestamp < bucketEnd;
        });

        if (bucketData.length > 0) {
          const sizes = bucketData.map(row => parseInt(row.content_size_bytes) || 0);
          const contentTypes: Record<string, number> = {};

          for (const row of bucketData) {
            contentTypes[row.context_type] = (contentTypes[row.context_type] || 0) + 1;
          }

          growthTrends.push({
            timestamp: bucketStart,
            entryCount: bucketData.length,
            avgContentSize: sizes.reduce((a, b) => a + b, 0) / sizes.length,
            contentTypes
          } as any);

          sizeTrends.push({
            timestamp: bucketStart,
            avgSize: sizes.reduce((a, b) => a + b, 0) / sizes.length,
            maxSize: Math.max(...sizes),
            minSize: Math.min(...sizes)
          } as any);
        }
      }

      // Detect anomalies
      const anomalies = this.detectContextAnomalies(growthTrends, sizeTrends);

      const patterns: ContextGrowthPattern = {
        totalContextEntries: totalEntries,
        contentTypeDistribution: contentTypeStats,
        growthTrends,
        sizeTrends,
        anomalies,
        timeRange: query.timeRange
      };

      // Cache the results
      this.setCache(cacheKey, patterns);

      const duration = timer.getElapsed();

      monitoringService.recordPerformanceMetrics('get_context_growth_patterns', {
        operation: 'get_context_growth_patterns',
        duration,
        success: true,
        metadata: {
          totalEntries,
          contentTypes: Object.keys(contentTypeStats).length,
          timeRangeHours: (query.timeRange.end.getTime() - query.timeRange.start.getTime()) / (1000 * 60 * 60)
        }
      } as any);

      structuredLogger.info('Analytics service operation', {
        timestamp: new Date(),
        component: 'AnalyticsService',
        operation: 'get_context_growth_patterns_complete',
        status: 'completed',
        metadata: {
          durationMs: duration,
          totalEntries,
          anomalies: anomalies.length,
          performanceBreakdown: timer.getAllCheckpointDurations()
        }
      } as any);

      return patterns;

    } catch (error) {
      const duration = timer.getElapsed();

      monitoringService.recordPerformanceMetrics('get_context_growth_patterns', {
        operation: 'get_context_growth_patterns',
        duration,
        success: false,
        metadata: { error: (error as Error).message }
      } as any);

      structuredLogger.error('Analytics service error', {
        timestamp: new Date(),
        errorType: 'ServiceError',
        component: 'AnalyticsService',
        operation: 'get_context_growth_patterns',
        additionalInfo: { timeRange: query.timeRange, durationMs: duration }
      } as any);

      throw error;
    }
  }

  /**
   * Get performance trends and identify optimization opportunities
   */
  async getPerformanceTrends(query: AnalyticsQuery): Promise<PerformanceTrends> {
    const timer = new PerformanceTimer();
    const cacheKey = `performance_trends_${JSON.stringify(query)}`;

    try {
      // Check cache first
      const cached = this.getFromCache<PerformanceTrends>(cacheKey);
      if (cached) {
        return cached;
      }

      structuredLogger.info('Analytics service operation', {
  timestamp: new Date(),
  metadata: {
    component: 'AnalyticsService',
    operation: 'get_performance_trends_start',
    status: 'started',
    timeRange: query.timeRange
  }
});

      // Get performance data
      const performanceQuery = `
        SELECT 
          operation,
          duration_ms,
          success,
          created_at,
          metadata
        FROM performance_logs
        WHERE created_at BETWEEN $1 AND $2
        ${query.filters?.operations ? 'AND operation = ANY($3)' : ''}
        ORDER BY created_at DESC
      `;

      const params: any[] = [query.timeRange.start, query.timeRange.end];
      if (query.filters?.operations) {
        params.push(query.filters.operations);
      }

      const performanceData = await monitoredDb.query(performanceQuery, params);
      timer.checkpoint('performance_data');

      // Get system metrics
      const systemMetricsQuery = `
        SELECT 
          metric_name,
          metric_value,
          recorded_at,
          labels
        FROM system_metrics
        WHERE recorded_at BETWEEN $1 AND $2
        AND metric_name IN ('memory_usage_percentage', 'cpu_usage_percentage', 'active_sessions', 'active_connections')
        ORDER BY recorded_at ASC
      `;

      const systemMetrics = await monitoredDb.query(systemMetricsQuery, [query.timeRange.start, query.timeRange.end]);
      timer.checkpoint('system_metrics');

      // Process operation metrics
      const operationMetrics: Record<string, OperationMetrics> = {};
      const slowOperations: Array<{
        operation: string;
        timestamp: Date;
        duration: number;
        metadata?: Record<string, any>;
      }> = [];

      for (const row of performanceData.rows) {
        const operation = row.operation;
        const duration = parseInt(row.duration_ms);
        const success = row.success;
        const timestamp = new Date(row.created_at);

        if (!operationMetrics[operation]) {
          operationMetrics[operation] = {
            totalCalls: 0,
            successfulCalls: 0,
            failedCalls: 0,
            successRate: 0,
            avgDuration: 0,
            minDuration: Infinity,
            maxDuration: 0,
            p95Duration: 0,
            trend: 'stable'
          };
        }

        const metrics = operationMetrics[operation];
        metrics.totalCalls++;
        
        if (success) {
          metrics.successfulCalls++;
        } else {
          metrics.failedCalls++;
        }

        metrics.avgDuration = (metrics.avgDuration * (metrics.totalCalls - 1) + duration) / metrics.totalCalls;
        metrics.minDuration = Math.min(metrics.minDuration, duration);
        metrics.maxDuration = Math.max(metrics.maxDuration, duration);
        metrics.successRate = (metrics.successfulCalls / metrics.totalCalls) * 100;

        // Track slow operations (>2s)
        if (duration > 2000) {
          slowOperations.push({
            operation,
            timestamp,
            duration,
            metadata: row.metadata ? JSON.parse(row.metadata) : undefined
          } as any);
        }
      }

      // Calculate P95 durations and trends
      for (const operation in operationMetrics) {
        const durations = performanceData.rows
          .filter(row => row.operation === operation)
          .map(row => parseInt(row.duration_ms))
          .sort((a, b) => a - b);
        
        const p95Index = Math.floor(durations.length * 0.95);
        operationMetrics[operation].p95Duration = durations[p95Index] || 0;

        // Calculate trend (simplified)
        const recentDurations = durations.slice(-10);
        const olderDurations = durations.slice(0, 10);
        
        if (recentDurations.length > 0 && olderDurations.length > 0) {
          const recentAvg = recentDurations.reduce((a, b) => a + b, 0) / recentDurations.length;
          const olderAvg = olderDurations.reduce((a, b) => a + b, 0) / olderDurations.length;
          
          if (recentAvg > olderAvg * 1.2) {
            operationMetrics[operation].trend = 'degrading';
          } else if (recentAvg < olderAvg * 0.8) {
            operationMetrics[operation].trend = 'improving';
          }
        }
      }

      // Process system resource trends
      const systemResourceTrends: Array<{
        timestamp: Date;
        memoryUsage: number;
        cpuUsage: number;
        activeConnections: number;
        activeSessions: number;
      }> = [];

      const granularity = query.granularity || 'hour';
      const timeBuckets = this.createTimeBuckets(query.timeRange, granularity);

      for (const bucket of timeBuckets) {
        const bucketEnd = new Date(bucket.getTime() + this.getGranularityMs(granularity));
        const bucketMetrics = systemMetrics.rows.filter(row => {
          const timestamp = new Date(row.recorded_at);
          return timestamp >= bucket && timestamp < bucketEnd;
        });

        if (bucketMetrics.length > 0) {
          const memoryMetrics = bucketMetrics.filter(m => m.metric_name === 'memory_usage_percentage');
          const cpuMetrics = bucketMetrics.filter(m => m.metric_name === 'cpu_usage_percentage');
          const connectionMetrics = bucketMetrics.filter(m => m.metric_name === 'active_connections');
          const sessionMetrics = bucketMetrics.filter(m => m.metric_name === 'active_sessions');

          systemResourceTrends.push({
            timestamp: bucket,
            memoryUsage: memoryMetrics.length > 0 ? 
              memoryMetrics.reduce((sum, m) => sum + parseFloat(m.metric_value), 0) / memoryMetrics.length : 0,
            cpuUsage: cpuMetrics.length > 0 ? 
              cpuMetrics.reduce((sum, m) => sum + parseFloat(m.metric_value), 0) / cpuMetrics.length : 0,
            activeConnections: connectionMetrics.length > 0 ? 
              connectionMetrics.reduce((sum, m) => sum + parseFloat(m.metric_value), 0) / connectionMetrics.length : 0,
            activeSessions: sessionMetrics.length > 0 ? 
              sessionMetrics.reduce((sum, m) => sum + parseFloat(m.metric_value), 0) / sessionMetrics.length : 0
          } as any);
        }
      }

      // Get database performance metrics
      const databasePerformanceMetrics = await this.getDatabasePerformanceMetrics(query.timeRange);
      timer.checkpoint('database_metrics');

      const trends: PerformanceTrends = {
        operationMetrics,
        databasePerformance: databasePerformanceMetrics,
        systemResourceTrends,
        slowOperations: slowOperations.slice(0, 50), // Limit to top 50
        timeRange: query.timeRange
      };

      // Cache the results
      this.setCache(cacheKey, trends);

      const duration = timer.getElapsed();

      monitoringService.recordPerformanceMetrics('get_performance_trends', {
        operation: 'get_performance_trends',
        duration,
        success: true,
        metadata: {
          operationsCount: Object.keys(operationMetrics).length,
          slowOperationsCount: slowOperations.length,
          timeRangeHours: (query.timeRange.end.getTime() - query.timeRange.start.getTime()) / (1000 * 60 * 60)
        }
      } as any);

      structuredLogger.info('Analytics service operation', {
        timestamp: new Date(),
        component: 'AnalyticsService',
        operation: 'get_performance_trends_complete',
        status: 'completed',
        metadata: {
          durationMs: duration,
          operationsCount: Object.keys(operationMetrics).length,
          slowOperationsCount: slowOperations.length,
          performanceBreakdown: timer.getAllCheckpointDurations()
        }
      } as any);

      return trends;

    } catch (error) {
      const duration = timer.getElapsed();

      monitoringService.recordPerformanceMetrics('get_performance_trends', {
        operation: 'get_performance_trends',
        duration,
        success: false,
        metadata: { error: (error as Error).message }
      } as any);

      structuredLogger.error('Analytics service error', {
        timestamp: new Date(),
        errorType: 'ServiceError',
        component: 'AnalyticsService',
        operation: 'get_performance_trends',
        additionalInfo: { timeRange: query.timeRange, durationMs: duration }
      } as any);

      throw error;
    }
  }

  /**
   * Get current and historical resource utilization
   */
  async getResourceUtilization(query: AnalyticsQuery): Promise<ResourceUtilization> {
    const timer = new PerformanceTimer();
    const cacheKey = `resource_utilization_${JSON.stringify(query)}`;

    try {
      // Check cache first
      const cached = this.getFromCache<ResourceUtilization>(cacheKey);
      if (cached) {
        return cached;
      }

      structuredLogger.info('Analytics service operation', {
  timestamp: new Date(),
  metadata: {
    component: 'AnalyticsService',
    operation: 'get_resource_utilization_start',
    status: 'started',
    timeRange: query.timeRange
  }
});

      // Get current system metrics
      const currentSystemMetrics = await monitoringService.getSystemMetrics();
      timer.checkpoint('current_metrics');

      // Get historical resource data
      const historicalQuery = `
        SELECT 
          metric_name,
          metric_value,
          recorded_at
        FROM system_metrics
        WHERE recorded_at BETWEEN $1 AND $2
        AND metric_name IN ('memory_usage_percentage', 'cpu_usage_percentage', 'active_connections', 'active_sessions')
        ORDER BY recorded_at ASC
      `;

      const historicalData = await monitoredDb.query(historicalQuery, [query.timeRange.start, query.timeRange.end]);
      timer.checkpoint('historical_data');

      // Process historical data
      const historical: Array<{
        timestamp: Date;
        memoryUsage: number;
        cpuUsage: number;
        diskUsage: number;
        activeConnections: number;
        activeSessions: number;
      }> = [];

      const granularity = query.granularity || 'hour';
      const timeBuckets = this.createTimeBuckets(query.timeRange, granularity);

      for (const bucket of timeBuckets) {
        const bucketEnd = new Date(bucket.getTime() + this.getGranularityMs(granularity));
        const bucketData = historicalData.rows.filter(row => {
          const timestamp = new Date(row.recorded_at);
          return timestamp >= bucket && timestamp < bucketEnd;
        });

        if (bucketData.length > 0) {
          const memoryData = bucketData.filter(d => d.metric_name === 'memory_usage_percentage');
          const cpuData = bucketData.filter(d => d.metric_name === 'cpu_usage_percentage');
          const connectionData = bucketData.filter(d => d.metric_name === 'active_connections');
          const sessionData = bucketData.filter(d => d.metric_name === 'active_sessions');

          historical.push({
            timestamp: bucket,
            memoryUsage: memoryData.length > 0 ? 
              memoryData.reduce((sum, d) => sum + parseFloat(d.metric_value), 0) / memoryData.length : 0,
            cpuUsage: cpuData.length > 0 ? 
              cpuData.reduce((sum, d) => sum + parseFloat(d.metric_value), 0) / cpuData.length : 0,
            diskUsage: 0, // Would need actual disk usage monitoring
            activeConnections: connectionData.length > 0 ? 
              connectionData.reduce((sum, d) => sum + parseFloat(d.metric_value), 0) / connectionData.length : 0,
            activeSessions: sessionData.length > 0 ? 
              sessionData.reduce((sum, d) => sum + parseFloat(d.metric_value), 0) / sessionData.length : 0
          } as any);
        }
      }

      // Generate alerts and recommendations
      const alerts = this.generateResourceAlerts(historical);
      const recommendations = this.generateOldResourceRecommendations(currentSystemMetrics, historical);

      const utilization: ResourceUtilization = {
        current: {
          memoryUsage: currentSystemMetrics.memory.percentage,
          cpuUsage: currentSystemMetrics.cpu.usage,
          diskUsage: 0, // Would need actual disk monitoring
          networkIO: 0, // Would need actual network monitoring
          activeConnections: currentSystemMetrics.database.activeConnections,
          activeSessions: currentSystemMetrics.sessions.active
        },
        historical,
        alerts,
        recommendations
      };

      // Cache the results
      this.setCache(cacheKey, utilization);

      const duration = timer.getElapsed();

      monitoringService.recordPerformanceMetrics('get_resource_utilization', {
        operation: 'get_resource_utilization',
        duration,
        success: true,
        metadata: {
          historicalDataPoints: historical.length,
          alertsCount: alerts.length,
          recommendationsCount: recommendations.length
        }
      } as any);

      structuredLogger.info('Analytics service operation', {
        timestamp: new Date(),
        component: 'AnalyticsService',
        operation: 'get_resource_utilization_complete',
        status: 'completed',
        metadata: {
          durationMs: duration,
          currentMemoryUsage: utilization.current.memoryUsage,
          alertsCount: alerts.length,
          performanceBreakdown: timer.getAllCheckpointDurations()
        }
      } as any);

      return utilization;

    } catch (error) {
      const duration = timer.getElapsed();

      monitoringService.recordPerformanceMetrics('get_resource_utilization', {
        operation: 'get_resource_utilization',
        duration,
        success: false,
        metadata: { error: (error as Error).message }
      } as any);

      structuredLogger.error('Analytics service error', {
        timestamp: new Date(),
        errorType: 'ServiceError',
        component: 'AnalyticsService',
        operation: 'get_resource_utilization',
        additionalInfo: { timeRange: query.timeRange, durationMs: duration }
      } as any);

      throw error;
    }
  }

  /**
   * Detect anomalies in system behavior and session patterns
   */
  async detectAnomalies(config?: Partial<AnomalyDetectionConfig>): Promise<Anomaly[]> {
    const timer = new PerformanceTimer();
    const cacheKey = `anomalies_${JSON.stringify(config)}`;

    try {
      // Check cache first
      const cached = this.getFromCache<Anomaly[]>(cacheKey);
      if (cached) {
        return cached;
      }

      structuredLogger.info('Analytics service operation', {
  timestamp: new Date(),
  metadata: {
    component: 'AnalyticsService',
    operation: 'detect_anomalies_start',
    status: 'started',
    config
  }
});

      const detectionConfig: AnomalyDetectionConfig = {
        sensitivity: 0.7,
        lookbackWindow: 24,
        minimumDataPoints: 3,
        thresholds: {
          sessionVolumeSpike: 3.0,
          performanceDegradation: 50,
          resourceUsageSpike: 80,
          handoffFailureRate: 20,
          contextGrowthRate: 5.0
        },
        ...config
      };

      const now = new Date();
      const lookbackStart = new Date(now.getTime() - detectionConfig.lookbackWindow * 60 * 60 * 1000);
      const timeRange = { start: lookbackStart, end: now };

      const anomalies: Anomaly[] = [];

      // Detect session pattern anomalies
      const sessionAnomalies = await this.detectSessionPatternAnomalies(timeRange, detectionConfig);
      anomalies.push(...sessionAnomalies);
      timer.checkpoint('session_anomalies');

      // Detect performance anomalies
      const performanceAnomalies = await this.detectPerformanceAnomalies(timeRange, detectionConfig);
      anomalies.push(...performanceAnomalies);
      timer.checkpoint('performance_anomalies');

      // Detect resource usage anomalies
      const resourceAnomalies = await this.detectResourceAnomalies(timeRange, detectionConfig);
      anomalies.push(...resourceAnomalies);
      timer.checkpoint('resource_anomalies');

      // Detect handoff failure anomalies
      const handoffAnomalies = await this.detectHandoffAnomalies(timeRange, detectionConfig);
      anomalies.push(...handoffAnomalies);
      timer.checkpoint('handoff_anomalies');

      // Detect context growth anomalies
      const contextAnomalies = await this.detectContextGrowthAnomalies(timeRange, detectionConfig);
      anomalies.push(...contextAnomalies);
      timer.checkpoint('context_anomalies');

      // Sort by severity and timestamp
      anomalies.sort((a, b) => {
        const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
        const severityDiff = severityOrder[b.severity] - severityOrder[a.severity];
        if (severityDiff !== 0) return severityDiff;
        return b.timestamp.getTime() - a.timestamp.getTime();
      });

      // Cache the results
      this.setCache(cacheKey, anomalies);

      const duration = timer.getElapsed();

      monitoringService.recordPerformanceMetrics('detect_anomalies', {
        operation: 'detect_anomalies',
        duration,
        success: true,
        metadata: {
          anomaliesFound: anomalies.length,
          lookbackHours: detectionConfig.lookbackWindow,
          performanceBreakdown: timer.getAllCheckpointDurations()
        }
      } as any);

      structuredLogger.info('Analytics service operation', {
        timestamp: new Date(),
        component: 'AnalyticsService',
        operation: 'detect_anomalies_complete',
        status: 'completed',
        metadata: {
          durationMs: duration,
          anomaliesFound: anomalies.length,
          severityBreakdown: this.getAnomalySeverityBreakdown(anomalies),
          performanceBreakdown: timer.getAllCheckpointDurations()
        }
      } as any);

      return anomalies;

    } catch (error) {
      const duration = timer.getElapsed();

      monitoringService.recordPerformanceMetrics('detect_anomalies', {
        operation: 'detect_anomalies',
        duration,
        success: false,
        metadata: { error: (error as Error).message }
      } as any);

      structuredLogger.error('Analytics service error', {
        timestamp: new Date(),
        errorType: 'ServiceError',
        component: 'AnalyticsService',
        operation: 'detect_anomalies',
        additionalInfo: { config, durationMs: duration }
      } as any);

      throw error;
    }
  }

  /**
   * Generate performance optimization recommendations
   */
  async generateRecommendations(): Promise<Recommendation[]> {
    const timer = new PerformanceTimer();
    const cacheKey = 'recommendations';

    try {
      // Check cache first
      const cached = this.getFromCache<Recommendation[]>(cacheKey);
      if (cached) {
        return cached;
      }

      structuredLogger.info('Analytics service operation', {
        timestamp: new Date(),
        component: 'AnalyticsService',
        operation: 'generate_recommendations_start',
        status: 'started'
      } as any);

      const now = new Date();
      const last24Hours = { start: new Date(now.getTime() - 24 * 60 * 60 * 1000), end: now };
      const last7Days = { start: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), end: now };

      const recommendations: Recommendation[] = [];

      // Get current system state
      const currentMetrics = await monitoringService.getSystemMetrics();
      const performanceTrends = await this.getPerformanceTrends({ timeRange: last24Hours } as any);
      const resourceUtilization = await this.getResourceUtilization({ timeRange: last24Hours } as any);
      const sessionStats = await this.getSessionStatistics({ timeRange: last7Days } as any);
      const handoffAnalytics = await this.getHandoffAnalytics({ timeRange: last7Days } as any);

      timer.checkpoint('data_collection');

      // Generate performance recommendations
      const performanceRecs = this.generatePerformanceRecommendations(performanceTrends, currentMetrics);
      recommendations.push(...performanceRecs);

      // Generate resource recommendations
      const resourceRecs = this.generateResourceRecommendations(resourceUtilization, currentMetrics);
      recommendations.push(...resourceRecs);

      // Generate session management recommendations
      const sessionRecs = this.generateSessionRecommendations(sessionStats, currentMetrics);
      recommendations.push(...sessionRecs);

      // Generate handoff optimization recommendations
      const handoffRecs = this.generateHandoffRecommendations(handoffAnalytics);
      recommendations.push(...handoffRecs);

      // Generate configuration recommendations
      const configRecs = this.generateConfigurationRecommendations(currentMetrics, performanceTrends);
      recommendations.push(...configRecs);

      timer.checkpoint('recommendation_generation');

      // Sort by priority and impact
      recommendations.sort((a, b) => {
        const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
        const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
        if (priorityDiff !== 0) return priorityDiff;
        return b.timestamp.getTime() - a.timestamp.getTime();
      });

      // Cache the results
      this.setCache(cacheKey, recommendations);

      const duration = timer.getElapsed();

      monitoringService.recordPerformanceMetrics('generate_recommendations', {
        operation: 'generate_recommendations',
        duration,
        success: true,
        metadata: {
          recommendationsGenerated: recommendations.length,
          performanceBreakdown: timer.getAllCheckpointDurations()
        }
      } as any);

      structuredLogger.info('Analytics service operation', {
        timestamp: new Date(),
        component: 'AnalyticsService',
        operation: 'generate_recommendations_complete',
        status: 'completed',
        metadata: {
          durationMs: duration,
          recommendationsGenerated: recommendations.length,
          priorityBreakdown: this.getRecommendationPriorityBreakdown(recommendations),
          performanceBreakdown: timer.getAllCheckpointDurations()
        }
      } as any);

      return recommendations;

    } catch (error) {
      const duration = timer.getElapsed();

      monitoringService.recordPerformanceMetrics('generate_recommendations', {
        operation: 'generate_recommendations',
        duration,
        success: false,
        metadata: { error: (error as Error).message }
      } as any);

      structuredLogger.error('Analytics service error', {
        timestamp: new Date(),
        errorType: 'ServiceError',
        component: 'AnalyticsService',
        operation: 'generate_recommendations',
        additionalInfo: { durationMs: duration }
      } as any);

      throw error;
    }
  }

  /**
   * Analyze trends in system metrics and usage patterns
   */
  async analyzeTrends(metrics: string[], timeRange: { start: Date; end: Date }): Promise<TrendAnalysis[]> {
    const timer = new PerformanceTimer();
    const cacheKey = `trends_${metrics.join(',')}_${JSON.stringify(timeRange)}`;

    try {
      // Check cache first
      const cached = this.getFromCache<TrendAnalysis[]>(cacheKey);
      if (cached) {
        return cached;
      }

      structuredLogger.info('Analytics service operation', {
        timestamp: new Date(),
        component: 'AnalyticsService',
        operation: 'analyze_trends_start',
        status: 'started',
        metadata: { metrics, timeRange }
      } as any);

      const trends: TrendAnalysis[] = [];

      for (const metric of metrics) {
        const trendAnalysis = await this.analyzeSingleMetricTrend(metric, timeRange);
        if (trendAnalysis) {
          trends.push(trendAnalysis);
        }
      }

      timer.checkpoint('trend_analysis');

      // Cache the results
      this.setCache(cacheKey, trends);

      const duration = timer.getElapsed();

      monitoringService.recordPerformanceMetrics('analyze_trends', {
        operation: 'analyze_trends',
        duration,
        success: true,
        metadata: {
          metricsAnalyzed: metrics.length,
          trendsFound: trends.length
        }
      } as any);

      structuredLogger.info('Analytics service operation', {
        timestamp: new Date(),
        component: 'AnalyticsService',
        operation: 'analyze_trends_complete',
        status: 'completed',
        metadata: {
          durationMs: duration,
          metricsAnalyzed: metrics.length,
          trendsFound: trends.length
        }
      } as any);

      return trends;

    } catch (error) {
      const duration = timer.getElapsed();

      monitoringService.recordPerformanceMetrics('analyze_trends', {
        operation: 'analyze_trends',
        duration,
        success: false,
        metadata: { error: (error as Error).message }
      } as any);

      structuredLogger.error('Analytics service error', {
        timestamp: new Date(),
        errorType: 'ServiceError',
        component: 'AnalyticsService',
        operation: 'analyze_trends',
        additionalInfo: { metrics, timeRange, durationMs: duration }
      } as any);

      throw error;
    }
  }

  /**
   * Trigger alerts for detected anomalies and performance issues
   */
  async triggerAnomalyAlerts(anomalies: Anomaly[]): Promise<void> {
    const timer = new PerformanceTimer();

    try {
      structuredLogger.info('Analytics service operation', {
        timestamp: new Date(),
        component: 'AnalyticsService',
        operation: 'trigger_anomaly_alerts_start',
        status: 'started',
        metadata: { anomaliesCount: anomalies.length }
      } as any);

      for (const anomaly of anomalies) {
        // Only alert on medium severity and above
        if (anomaly.severity === 'low') continue;

        // Log the anomaly as an alert
        structuredLogger.info('Analytics service operation', {
          timestamp: new Date(),
          component: 'AnalyticsService',
          operation: 'anomaly_alert',
          status: 'completed',
          metadata: {
            anomalyId: anomaly.id,
            type: anomaly.type,
            severity: anomaly.severity,
            description: anomaly.description,
            affectedComponents: anomaly.affectedComponents,
            confidence: anomaly.confidence,
            suggestedActions: anomaly.suggestedActions
          }
        } as any);

        // Record as a system metric for external monitoring
        await this.recordAnomalyMetric(anomaly);

        // For critical anomalies, also trigger immediate notifications
        if (anomaly.severity === 'critical') {
          await this.triggerCriticalAnomalyNotification(anomaly);
        }
      }

      const duration = timer.getElapsed();

      monitoringService.recordPerformanceMetrics('trigger_anomaly_alerts', {
        operation: 'trigger_anomaly_alerts',
        duration,
        success: true,
        metadata: { anomaliesProcessed: anomalies.length }
      } as any);

      structuredLogger.info('Analytics service operation', {
        timestamp: new Date(),
        component: 'AnalyticsService',
        operation: 'trigger_anomaly_alerts_complete',
        status: 'completed',
        metadata: {
          durationMs: duration,
          anomaliesProcessed: anomalies.length,
          alertsTriggered: anomalies.filter(a => a.severity !== 'low').length
        }
      } as any);

    } catch (error) {
      const duration = timer.getElapsed();

      monitoringService.recordPerformanceMetrics('trigger_anomaly_alerts', {
        operation: 'trigger_anomaly_alerts',
        duration,
        success: false,
        metadata: { error: (error as Error).message }
      } as any);

      structuredLogger.error('Analytics service error', {
        timestamp: new Date(),
        errorType: 'ServiceError',
        component: 'AnalyticsService',
        operation: 'trigger_anomaly_alerts',
        additionalInfo: { anomaliesCount: anomalies.length, durationMs: duration }
      } as any);

      throw error;
    }
  }

  /**
   * Aggregate analytics data for efficient querying
   */
  async aggregateAnalyticsData(timeBucket: Date, aggregationType: string): Promise<void> {
    const timer = new PerformanceTimer();

    try {
      structuredLogger.info('Analytics service operation', {
        timestamp: new Date(),
        component: 'AnalyticsService',
        operation: 'aggregate_analytics_data_start',
        status: 'started',
        metadata: { timeBucket, aggregationType }
      } as any);

      let aggregationData: Record<string, any> = {};

      switch (aggregationType) {
        case 'hourly_session_stats':
          aggregationData = await this.calculateHourlySessionStats(timeBucket);
          break;
        case 'hourly_handoff_stats':
          aggregationData = await this.calculateHourlyHandoffStats(timeBucket);
          break;
        case 'hourly_performance_trends':
          aggregationData = await this.calculateHourlyPerformanceTrends(timeBucket);
          break;
        case 'daily_context_growth':
          aggregationData = await this.calculateDailyContextGrowth(timeBucket);
          break;
        default:
          throw new Error(`Unknown aggregation type: ${aggregationType}`);
      }

      // Store aggregation in database
      await monitoringService.storeMetricsAggregation(aggregationType, timeBucket, aggregationData);

      const duration = timer.getElapsed();

      monitoringService.recordPerformanceMetrics('aggregate_analytics_data', {
        operation: 'aggregate_analytics_data',
        duration,
        success: true,
        metadata: { aggregationType, timeBucket: timeBucket.toISOString() }
      } as any);

      structuredLogger.info('Analytics service operation', {
        timestamp: new Date(),
        component: 'AnalyticsService',
        operation: 'aggregate_analytics_data_complete',
        status: 'completed',
        metadata: {
          durationMs: duration,
          aggregationType,
          timeBucket: timeBucket.toISOString(),
          dataKeys: Object.keys(aggregationData).length
        }
      } as any);

    } catch (error) {
      const duration = timer.getElapsed();

      monitoringService.recordPerformanceMetrics('aggregate_analytics_data', {
        operation: 'aggregate_analytics_data',
        duration,
        success: false,
        metadata: { aggregationType, error: (error as Error).message }
      } as any);

      structuredLogger.error('Analytics service error', {
        timestamp: new Date(),
        errorType: 'ServiceError',
        component: 'AnalyticsService',
        operation: 'aggregate_analytics_data',
        additionalInfo: { aggregationType, timeBucket, durationMs: duration }
      } as any);

      throw error;
    }
  }

  // Private helper methods

  private async ensureAggregationsUpToDate(): Promise<void> {
    // Check if we have recent aggregations and create them if needed
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    try {
      await this.aggregateAnalyticsData(hourAgo, 'hourly_session_stats');
      await this.aggregateAnalyticsData(hourAgo, 'hourly_handoff_stats');
      await this.aggregateAnalyticsData(hourAgo, 'hourly_performance_trends');
    } catch (error) {
      // Log but don't throw - aggregations are best-effort
      structuredLogger.error('Analytics service error', {
        timestamp: new Date(),
        errorType: 'ServiceError',
        component: 'AnalyticsService',
        operation: 'ensureAggregationsUpToDate'
      } as any);
    }
  }

  private async getDatabasePerformanceMetrics(timeRange: { start: Date; end: Date }): Promise<DatabasePerformanceMetrics> {
    const query = `
      SELECT 
        COUNT(*) as total_queries,
        COUNT(*) FILTER (WHERE duration_ms > 1000) as slow_queries,
        AVG(duration_ms) as avg_query_time,
        COUNT(*) FILTER (WHERE success = false) as failed_queries,
        operation
      FROM performance_logs
      WHERE operation LIKE '%query%' OR operation LIKE '%database%'
      AND created_at BETWEEN $1 AND $2
      GROUP BY operation
    `;

    const result = await monitoredDb.query(query, [timeRange.start, timeRange.end]);

    let totalQueries = 0;
    let slowQueries = 0;
    let totalDuration = 0;
    let failedQueries = 0;
    const topSlowQueries: Array<{ queryPattern: string; avgDuration: number; count: number }> = [];

    for (const row of result.rows) {
      const queries = parseInt(row.total_queries);
      const slow = parseInt(row.slow_queries);
      const avgTime = parseFloat(row.avg_query_time);
      const failed = parseInt(row.failed_queries);

      totalQueries += queries;
      slowQueries += slow;
      totalDuration += avgTime * queries;
      failedQueries += failed;

      if (slow > 0) {
        topSlowQueries.push({
          queryPattern: row.operation,
          avgDuration: avgTime,
          count: slow
        } as any);
      }
    }

    return {
      totalQueries,
      slowQueries,
      avgQueryTime: totalQueries > 0 ? totalDuration / totalQueries : 0,
      errorRate: totalQueries > 0 ? (failedQueries / totalQueries) * 100 : 0,
      connectionPoolUsage: 0, // Would need actual connection pool monitoring
      cacheHitRate: 0, // Would need actual cache monitoring
      topSlowQueries: topSlowQueries.sort((a, b) => b.avgDuration - a.avgDuration).slice(0, 10)
    };
  }

  private detectContextAnomalies(
    growthTrends: Array<{ timestamp: Date; entryCount: number; avgContentSize: number; contentTypes: Record<string, number> }>,
    sizeTrends: Array<{ timestamp: Date; avgSize: number; maxSize: number; minSize: number }>
  ): Array<{ timestamp: Date; type: 'size_spike' | 'volume_spike' | 'unusual_type'; description: string; severity: 'low' | 'medium' | 'high' }> {
    const anomalies: Array<{ timestamp: Date; type: 'size_spike' | 'volume_spike' | 'unusual_type'; description: string; severity: 'low' | 'medium' | 'high' }> = [];

    // Calculate baseline metrics
    const avgEntryCount = growthTrends.reduce((sum, t) => sum + t.entryCount, 0) / growthTrends.length;
    const avgSize = sizeTrends.reduce((sum, t) => sum + t.avgSize, 0) / sizeTrends.length;

    // Detect volume spikes
    for (const trend of growthTrends) {
      if (trend.entryCount > avgEntryCount * 3) {
        anomalies.push({
          timestamp: trend.timestamp,
          type: 'volume_spike',
          description: `Context entry volume spike: ${trend.entryCount} entries (${Math.round((trend.entryCount / avgEntryCount - 1) * 100)}% above average)`,
          severity: trend.entryCount > avgEntryCount * 5 ? 'high' : 'medium'
        } as any);
      }
    }

    // Detect size spikes
    for (const trend of sizeTrends) {
      // If maxSize is over 1MB (1048576 bytes) or 5x average, it's a spike
      if (trend.maxSize > 1048576 || trend.maxSize > avgSize * 5) {
        anomalies.push({
          timestamp: trend.timestamp,
          type: 'size_spike',
          description: `Content size spike: ${Math.round(trend.maxSize / 1024)}KB (${Math.round((trend.maxSize / avgSize - 1) * 100)}% above average)`,
          severity: trend.maxSize > 5242880 ? 'high' : 'medium' // 5MB threshold for high severity
        } as any);
      }
    }

    return anomalies;
  }

  private generateResourceAlerts(historical: Array<{ timestamp: Date; memoryUsage: number; cpuUsage: number; diskUsage: number; activeConnections: number; activeSessions: number }>): Array<{ timestamp: Date; type: 'memory' | 'cpu' | 'disk' | 'connections'; threshold: number; currentValue: number; severity: 'warning' | 'critical' }> {
    const alerts: Array<{ timestamp: Date; type: 'memory' | 'cpu' | 'disk' | 'connections'; threshold: number; currentValue: number; severity: 'warning' | 'critical' }> = [];

    for (const dataPoint of historical) {
      if (dataPoint.memoryUsage > 90) {
        alerts.push({
          timestamp: dataPoint.timestamp,
          type: 'memory',
          threshold: 90,
          currentValue: dataPoint.memoryUsage,
          severity: dataPoint.memoryUsage >= 95 ? 'critical' : 'warning'
        } as any);
      }

      if (dataPoint.cpuUsage > 80) {
        alerts.push({
          timestamp: dataPoint.timestamp,
          type: 'cpu',
          threshold: 80,
          currentValue: dataPoint.cpuUsage,
          severity: dataPoint.cpuUsage > 90 ? 'critical' : 'warning'
        } as any);
      }

      if (dataPoint.activeConnections > 100) {
        alerts.push({
          timestamp: dataPoint.timestamp,
          type: 'connections',
          threshold: 100,
          currentValue: dataPoint.activeConnections,
          severity: dataPoint.activeConnections > 200 ? 'critical' : 'warning'
        } as any);
      }
    }

    return alerts;
  }



  private async calculateHourlySessionStats(timeBucket: Date): Promise<Record<string, any>> {
    const bucketEnd = new Date(timeBucket.getTime() + 60 * 60 * 1000);
    
    const query = `
      SELECT 
        status,
        COUNT(*) as count,
        AVG(EXTRACT(EPOCH FROM (updated_at - created_at))) as avg_duration
      FROM sessions
      WHERE created_at >= $1 AND created_at < $2
      GROUP BY status
    `;

    const result = await monitoredDb.query(query, [timeBucket, bucketEnd]);
    
    const stats: Record<string, any> = {
      timestamp: timeBucket,
      totalSessions: 0,
      sessionsByStatus: {},
      avgDuration: 0
    };

    for (const row of result.rows) {
      const count = parseInt(row.count);
      stats.totalSessions += count;
      stats.sessionsByStatus[row.status] = count;
      if (row.avg_duration) {
        stats.avgDuration += parseFloat(row.avg_duration) * count;
      }
    }

    if (stats.totalSessions > 0) {
      stats.avgDuration /= stats.totalSessions;
    }

    return stats;
  }

  private async calculateHourlyHandoffStats(timeBucket: Date): Promise<Record<string, any>> {
    const bucketEnd = new Date(timeBucket.getTime() + 60 * 60 * 1000);
    
    const query = `
      SELECT 
        success,
        COUNT(*) as count,
        AVG(duration_ms) as avg_duration,
        metadata->>'agent_from' as agent_from,
        metadata->>'agent_to' as agent_to
      FROM performance_logs
      WHERE operation = 'handoff'
      AND created_at >= $1 AND created_at < $2
      GROUP BY success, metadata->>'agent_from', metadata->>'agent_to'
    `;

    const result = await monitoredDb.query(query, [timeBucket, bucketEnd]);
    
    const stats: Record<string, any> = {
      timestamp: timeBucket,
      totalHandoffs: 0,
      successfulHandoffs: 0,
      failedHandoffs: 0,
      avgDuration: 0,
      handoffRoutes: {}
    };

    for (const row of result.rows) {
      const count = parseInt(row.count);
      const success = row.success;
      const route = `${row.agent_from || 'unknown'}->${row.agent_to || 'unknown'}`;

      stats.totalHandoffs += count;
      
      if (success) {
        stats.successfulHandoffs += count;
      } else {
        stats.failedHandoffs += count;
      }

      if (row.avg_duration) {
        stats.avgDuration += parseFloat(row.avg_duration) * count;
      }

      if (!stats.handoffRoutes[route]) {
        stats.handoffRoutes[route] = { count: 0, successful: 0 };
      }
      stats.handoffRoutes[route].count += count;
      if (success) {
        stats.handoffRoutes[route].successful += count;
      }
    }

    if (stats.totalHandoffs > 0) {
      stats.avgDuration /= stats.totalHandoffs;
      stats.successRate = (stats.successfulHandoffs / stats.totalHandoffs) * 100;
    }

    return stats;
  }

  private async calculateHourlyPerformanceTrends(timeBucket: Date): Promise<Record<string, any>> {
    const bucketEnd = new Date(timeBucket.getTime() + 60 * 60 * 1000);
    
    const query = `
      SELECT 
        operation,
        COUNT(*) as count,
        AVG(duration_ms) as avg_duration,
        MIN(duration_ms) as min_duration,
        MAX(duration_ms) as max_duration,
        COUNT(*) FILTER (WHERE success = true) as successful,
        COUNT(*) FILTER (WHERE success = false) as failed
      FROM performance_logs
      WHERE created_at >= $1 AND created_at < $2
      GROUP BY operation
    `;

    const result = await monitoredDb.query(query, [timeBucket, bucketEnd]);
    
    const trends: Record<string, any> = {
      timestamp: timeBucket,
      operations: {}
    };

    for (const row of result.rows) {
      trends.operations[row.operation] = {
        count: parseInt(row.count),
        avgDuration: parseFloat(row.avg_duration || '0'),
        minDuration: parseFloat(row.min_duration || '0'),
        maxDuration: parseFloat(row.max_duration || '0'),
        successful: parseInt(row.successful),
        failed: parseInt(row.failed),
        successRate: parseInt(row.count) > 0 ? (parseInt(row.successful) / parseInt(row.count)) * 100 : 0
      };
    }

    return trends;
  }

  private async calculateDailyContextGrowth(timeBucket: Date): Promise<Record<string, any>> {
    const bucketEnd = new Date(timeBucket.getTime() + 24 * 60 * 60 * 1000);
    
    const query = `
      SELECT 
        context_type,
        COUNT(*) as count,
        AVG(content_size_bytes) as avg_size,
        SUM(content_size_bytes) as total_size
      FROM context_history
      WHERE created_at >= $1 AND created_at < $2
      GROUP BY context_type
    `;

    const result = await monitoredDb.query(query, [timeBucket, bucketEnd]);
    
    const growth: Record<string, any> = {
      timestamp: timeBucket,
      totalEntries: 0,
      totalSize: 0,
      contentTypes: {}
    };

    for (const row of result.rows) {
      const count = parseInt(row.count);
      const totalSize = parseInt(row.total_size || '0');
      
      growth.totalEntries += count;
      growth.totalSize += totalSize;
      
      growth.contentTypes[row.context_type] = {
        count,
        avgSize: parseFloat(row.avg_size || '0'),
        totalSize,
        percentage: 0 // Will be calculated after processing all types
      };
    }

    // Calculate percentages
    for (const type in growth.contentTypes) {
      growth.contentTypes[type].percentage = growth.totalEntries > 0 ? 
        (growth.contentTypes[type].count / growth.totalEntries) * 100 : 0;
    }

    return growth;
  }

  private createTimeBuckets(timeRange: { start: Date; end: Date }, granularity: 'hour' | 'day' | 'week' | 'month'): Date[] {
    const buckets: Date[] = [];
    const bucketSize = this.getGranularityMs(granularity);
    
    let current = new Date(timeRange.start);
    
    // Align to granularity boundary
    switch (granularity) {
      case 'hour':
        current.setMinutes(0, 0, 0);
        break;
      case 'day':
        current.setHours(0, 0, 0, 0);
        break;
      case 'week':
        current.setDate(current.getDate() - current.getDay());
        current.setHours(0, 0, 0, 0);
        break;
      case 'month':
        current.setDate(1);
        current.setHours(0, 0, 0, 0);
        break;
    }

    while (current < timeRange.end) {
      buckets.push(new Date(current));
      current = new Date(current.getTime() + bucketSize);
    }

    return buckets;
  }

  private findTimeBucket(timestamp: Date, buckets: Date[]): number {
    for (let i = 0; i < buckets.length - 1; i++) {
      if (timestamp >= buckets[i] && timestamp < buckets[i + 1]) {
        return i;
      }
    }
    if (buckets.length > 0 && timestamp >= buckets[buckets.length - 1]) {
      return buckets.length - 1;
    }
    return -1;
  }

  private getGranularityMs(granularity: 'hour' | 'day' | 'week' | 'month'): number {
    switch (granularity) {
      case 'hour': return 60 * 60 * 1000;
      case 'day': return 24 * 60 * 60 * 1000;
      case 'week': return 7 * 24 * 60 * 60 * 1000;
      case 'month': return 30 * 24 * 60 * 60 * 1000; // Approximate
    }
  }

  private getFromCache<T>(key: string): T | null {
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) {
      return cached.data as T;
    }
    this.cache.delete(key);
    return null;
  }

  private setCache<T>(key: string, data: T): void {
    this.cache.set(key, {
      data,
      expires: Date.now() + this.cacheTimeout
    } as any);
  }

  // Anomaly detection helper methods

  private async detectSessionPatternAnomalies(timeRange: { start: Date; end: Date }, config: AnomalyDetectionConfig): Promise<Anomaly[]> {
    const anomalies: Anomaly[] = [];

    // Get session creation patterns
    const sessionQuery = `
      SELECT 
        DATE_TRUNC('hour', created_at) as hour,
        COUNT(*) as session_count,
        status,
        agent_from
      FROM sessions
      WHERE created_at BETWEEN $1 AND $2
      GROUP BY DATE_TRUNC('hour', created_at), status, agent_from
      ORDER BY hour DESC
    `;

    const sessionData = await monitoredDb.query(sessionQuery, [timeRange.start, timeRange.end]);

    // Calculate baseline session volume
    const hourlyVolumes = new Map<string, number>();
    for (const row of sessionData.rows) {
      const hour = row.hour.toISOString();
      hourlyVolumes.set(hour, (hourlyVolumes.get(hour) || 0) + parseInt(row.session_count));
    }

    const volumes = Array.from(hourlyVolumes.values());
    if (volumes.length < config.minimumDataPoints) return anomalies;

    const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
    const stdDev = Math.sqrt(volumes.reduce((sum, vol) => sum + Math.pow(vol - avgVolume, 2), 0) / volumes.length);

    // Detect volume spikes
    for (const [hour, volume] of hourlyVolumes) {
      const threshold = avgVolume + (stdDev * config.sensitivity * 2);
      if (volume > threshold && volume > avgVolume * config.thresholds.sessionVolumeSpike) {
        anomalies.push({
          id: `session_volume_spike_${hour}`,
          timestamp: new Date(hour),
          type: 'session_pattern',
          severity: volume > avgVolume * 5 ? 'critical' : volume > avgVolume * 3 ? 'high' : 'medium',
          description: `Unusual session volume spike: ${volume} sessions (${Math.round((volume / avgVolume - 1) * 100)}% above average)`,
          affectedComponents: ['session_manager', 'database'],
          metrics: { volume, baseline: avgVolume, threshold },
          confidence: Math.min(0.95, (volume - threshold) / threshold),
          suggestedActions: [
            'Check for automated session creation',
            'Monitor system resources',
            'Review session cleanup policies',
            'Investigate potential DDoS or abuse'
          ]
        } as any);
      }
    }

    // Detect unusual failure patterns
    const failureRates = new Map<string, { total: number; failed: number }>();
    for (const row of sessionData.rows) {
      const hour = row.hour.toISOString();
      const count = parseInt(row.session_count);
      const isFailed = row.status === 'failed' || row.status === 'error';

      if (!failureRates.has(hour)) {
        failureRates.set(hour, { total: 0, failed: 0 } as any);
      }

      const stats = failureRates.get(hour)!;
      stats.total += count;
      if (isFailed) stats.failed += count;
    }

    for (const [hour, stats] of failureRates) {
      if (stats.total < 5) continue; // Skip low-volume hours
      
      const failureRate = (stats.failed / stats.total) * 100;
      if (failureRate > 25) { // More than 25% failure rate
        anomalies.push({
          id: `session_failure_spike_${hour}`,
          timestamp: new Date(hour),
          type: 'session_pattern',
          severity: failureRate > 50 ? 'critical' : failureRate > 35 ? 'high' : 'medium',
          description: `High session failure rate: ${failureRate.toFixed(1)}% (${stats.failed}/${stats.total} sessions)`,
          affectedComponents: ['session_manager', 'database', 'mcp_tools'],
          metrics: { failureRate, failedSessions: stats.failed, totalSessions: stats.total },
          confidence: Math.min(0.9, failureRate / 50),
          suggestedActions: [
            'Check system logs for error patterns',
            'Review database connectivity',
            'Monitor resource availability',
            'Investigate authentication issues'
          ]
        } as any);
      }
    }

    return anomalies;
  }

  private async detectPerformanceAnomalies(timeRange: { start: Date; end: Date }, config: AnomalyDetectionConfig): Promise<Anomaly[]> {
    const anomalies: Anomaly[] = [];

    // Get performance data
    const performanceQuery = `
      SELECT 
        operation,
        DATE_TRUNC('hour', created_at) as hour,
        AVG(duration_ms) as avg_duration,
        COUNT(*) as operation_count,
        COUNT(*) FILTER (WHERE success = false) as failed_count
      FROM performance_logs
      WHERE created_at BETWEEN $1 AND $2
      GROUP BY operation, DATE_TRUNC('hour', created_at)
      HAVING COUNT(*) >= 3
      ORDER BY hour DESC, operation
    `;

    const performanceData = await monitoredDb.query(performanceQuery, [timeRange.start, timeRange.end]);

    // Group by operation to calculate baselines
    const operationBaselines = new Map<string, { durations: number[]; avgDuration: number }>();

    for (const row of performanceData.rows) {
      const operation = row.operation;
      const duration = parseFloat(row.avg_duration);

      if (!operationBaselines.has(operation)) {
        operationBaselines.set(operation, { durations: [], avgDuration: 0 } as any);
      }

      operationBaselines.get(operation)!.durations.push(duration);
    }

    // Calculate baselines and detect anomalies
    for (const [operation, data] of operationBaselines) {
      if (data.durations.length < config.minimumDataPoints) continue;

      data.avgDuration = data.durations.reduce((a, b) => a + b, 0) / data.durations.length;
      // Calculate standard deviation for future use in anomaly detection
      // const stdDev = Math.sqrt(data.durations.reduce((sum, dur) => sum + Math.pow(dur - data.avgDuration, 2), 0) / data.durations.length);

      // Find recent performance degradations (data is ordered DESC, so first items are most recent)
      const recentDurations = data.durations.slice(0, Math.min(2, Math.floor(data.durations.length / 2)));
      const recentAvg = recentDurations.reduce((a, b) => a + b, 0) / recentDurations.length;

      const degradationThreshold = data.avgDuration * (1 + config.thresholds.performanceDegradation / 100);
      
      if (recentAvg > degradationThreshold) {
        const degradationPercent = ((recentAvg - data.avgDuration) / data.avgDuration) * 100;
        
        anomalies.push({
          id: `performance_degradation_${operation}_${Date.now()}`,
          timestamp: new Date(),
          type: 'performance_degradation',
          severity: degradationPercent > 100 ? 'critical' : degradationPercent > 75 ? 'high' : 'medium',
          description: `Performance degradation in ${operation}: ${recentAvg.toFixed(0)}ms average (${degradationPercent.toFixed(1)}% slower than baseline)`,
          affectedComponents: [operation, 'database', 'system'],
          metrics: { 
            currentAvg: recentAvg, 
            baseline: data.avgDuration, 
            degradationPercent,
            threshold: degradationThreshold 
          },
          confidence: Math.min(0.9, degradationPercent / 100),
          suggestedActions: [
            'Check system resource usage',
            'Review database query performance',
            'Monitor for memory leaks',
            'Consider scaling resources',
            'Review recent code changes'
          ]
        } as any);
      }
    }

    return anomalies;
  }

  private async detectResourceAnomalies(timeRange: { start: Date; end: Date }, config: AnomalyDetectionConfig): Promise<Anomaly[]> {
    const anomalies: Anomaly[] = [];

    // Get resource usage data
    const resourceQuery = `
      SELECT 
        metric_name,
        DATE_TRUNC('hour', recorded_at) as hour,
        AVG(metric_value) as avg_value,
        MAX(metric_value) as max_value
      FROM system_metrics
      WHERE recorded_at BETWEEN $1 AND $2
      AND metric_name IN ('memory_usage_percentage', 'cpu_usage_percentage', 'active_connections', 'active_sessions')
      GROUP BY metric_name, DATE_TRUNC('hour', recorded_at)
      ORDER BY hour DESC
    `;

    const resourceData = await monitoredDb.query(resourceQuery, [timeRange.start, timeRange.end]);

    // Group by metric type
    const metricData = new Map<string, Array<{ hour: Date; avg: number; max: number }>>();

    for (const row of resourceData.rows) {
      const metric = row.metric_name;
      if (!metricData.has(metric)) {
        metricData.set(metric, []);
      }

      metricData.get(metric)!.push({
        hour: new Date(row.hour),
        avg: parseFloat(row.avg_value),
        max: parseFloat(row.max_value)
      } as any);
    }

    // Detect resource spikes
    for (const [metric, data] of metricData) {
      if (data.length < config.minimumDataPoints) continue;

      const avgValues = data.map(d => d.avg);
      const baseline = avgValues.reduce((a, b) => a + b, 0) / avgValues.length;

      for (const point of data) {
        let threshold: number;
        let criticalThreshold: number;

        if (metric.includes('percentage')) {
          threshold = config.thresholds.resourceUsageSpike;
          criticalThreshold = 95;
        } else if (metric === 'active_connections') {
          threshold = Math.max(100, baseline * 2);
          criticalThreshold = Math.max(200, baseline * 3);
        } else {
          threshold = baseline * 2;
          criticalThreshold = baseline * 3;
        }

        if (point.max > threshold) {
          const severity = point.max > criticalThreshold ? 'critical' : 
                          point.max > threshold * 1.5 ? 'high' : 'medium';

          anomalies.push({
            id: `resource_spike_${metric}_${point.hour.getTime()}`,
            timestamp: point.hour,
            type: 'resource_spike',
            severity,
            description: `${metric.replace('_', ' ')} spike: ${point.max.toFixed(1)}${metric.includes('percentage') ? '%' : ''} (threshold: ${threshold.toFixed(1)})`,
            affectedComponents: ['system', 'database', 'session_manager'],
            metrics: { 
              currentValue: point.max, 
              avgValue: point.avg, 
              baseline, 
              threshold 
            },
            confidence: Math.min(0.95, (point.max - threshold) / threshold),
            suggestedActions: [
              'Monitor system resources',
              'Check for resource leaks',
              'Consider scaling resources',
              'Review active processes',
              'Implement resource limits'
            ]
          } as any);
        }
      }
    }

    return anomalies;
  }

  private async detectHandoffAnomalies(timeRange: { start: Date; end: Date }, config: AnomalyDetectionConfig): Promise<Anomaly[]> {
    const anomalies: Anomaly[] = [];

    // Get handoff data
    const handoffQuery = `
      SELECT 
        DATE_TRUNC('hour', created_at) as hour,
        COUNT(*) as total_handoffs,
        COUNT(*) FILTER (WHERE success = false) as failed_handoffs,
        AVG(duration_ms) as avg_duration,
        metadata->>'agent_from' as agent_from,
        metadata->>'agent_to' as agent_to
      FROM performance_logs
      WHERE operation = 'handoff'
      AND created_at BETWEEN $1 AND $2
      GROUP BY DATE_TRUNC('hour', created_at), metadata->>'agent_from', metadata->>'agent_to'
      HAVING COUNT(*) >= 3
      ORDER BY hour DESC
    `;

    const handoffData = await monitoredDb.query(handoffQuery, [timeRange.start, timeRange.end]);

    // Analyze failure rates by hour
    const hourlyStats = new Map<string, { total: number; failed: number; avgDuration: number }>();

    for (const row of handoffData.rows) {
      const hour = row.hour.toISOString();
      const total = parseInt(row.total_handoffs);
      const failed = parseInt(row.failed_handoffs);
      const duration = parseFloat(row.avg_duration);

      if (!hourlyStats.has(hour)) {
        hourlyStats.set(hour, { total: 0, failed: 0, avgDuration: 0 } as any);
      }

      const stats = hourlyStats.get(hour)!;
      stats.total += total;
      stats.failed += failed;
      stats.avgDuration = (stats.avgDuration * (stats.total - total) + duration * total) / stats.total;
    }

    // Detect handoff failure spikes
    for (const [hour, stats] of hourlyStats) {
      if (stats.total < 5) continue;

      const failureRate = (stats.failed / stats.total) * 100;
      
      if (failureRate > config.thresholds.handoffFailureRate) {
        anomalies.push({
          id: `handoff_failure_spike_${hour}`,
          timestamp: new Date(hour),
          type: 'handoff_failure',
          severity: failureRate > 50 ? 'critical' : failureRate > 35 ? 'high' : 'medium',
          description: `High handoff failure rate: ${failureRate.toFixed(1)}% (${stats.failed}/${stats.total} handoffs)`,
          affectedComponents: ['handoff_system', 'mcp_tools', 'session_manager'],
          metrics: { 
            failureRate, 
            failedHandoffs: stats.failed, 
            totalHandoffs: stats.total,
            avgDuration: stats.avgDuration
          },
          confidence: Math.min(0.9, failureRate / 50),
          suggestedActions: [
            'Check agent connectivity',
            'Review handoff timeout settings',
            'Monitor network latency',
            'Investigate authentication issues',
            'Review agent compatibility'
          ]
        } as any);
      }
    }

    return anomalies;
  }

  private async detectContextGrowthAnomalies(timeRange: { start: Date; end: Date }, config: AnomalyDetectionConfig): Promise<Anomaly[]> {
    const anomalies: Anomaly[] = [];

    // Get context growth data
    const contextQuery = `
      SELECT 
        DATE_TRUNC('hour', created_at) as hour,
        COUNT(*) as entry_count,
        AVG(content_size_bytes) as avg_size,
        MAX(content_size_bytes) as max_size,
        SUM(content_size_bytes) as total_size
      FROM context_history
      WHERE created_at BETWEEN $1 AND $2
      GROUP BY DATE_TRUNC('hour', created_at)
      ORDER BY hour DESC
    `;

    const contextData = await monitoredDb.query(contextQuery, [timeRange.start, timeRange.end]);

    if (contextData.rows.length < config.minimumDataPoints) return anomalies;

    // Calculate baselines
    const entryCounts = contextData.rows.map(row => parseInt(row.entry_count));
    // Calculate baseline metrics for future use
    // const avgSizes = contextData.rows.map(row => parseFloat(row.avg_size));
    // const totalSizes = contextData.rows.map(row => parseInt(row.total_size));

    const baselineEntryCount = entryCounts.reduce((a, b) => a + b, 0) / entryCounts.length;
    // Calculate baselines for future use
    // const baselineAvgSize = avgSizes.reduce((a, b) => a + b, 0) / avgSizes.length;
    // const baselineTotalSize = totalSizes.reduce((a, b) => a + b, 0) / totalSizes.length;

    // Detect anomalies
    for (const row of contextData.rows) {
      const hour = new Date(row.hour);
      const entryCount = parseInt(row.entry_count);
      const avgSize = parseFloat(row.avg_size);
      const maxSize = parseInt(row.max_size);
      const totalSize = parseInt(row.total_size);

      // Detect volume growth anomalies
      if (entryCount > baselineEntryCount * config.thresholds.contextGrowthRate) {
        const growthRate = ((entryCount - baselineEntryCount) / baselineEntryCount) * 100;
        
        anomalies.push({
          id: `context_volume_growth_${hour.getTime()}`,
          timestamp: hour,
          type: 'context_growth',
          severity: entryCount > baselineEntryCount * 10 ? 'critical' : 
                   entryCount > baselineEntryCount * 7 ? 'high' : 'medium',
          description: `Unusual context volume growth: ${entryCount} entries (${growthRate.toFixed(1)}% above baseline)`,
          affectedComponents: ['context_manager', 'database', 'memory'],
          metrics: { 
            entryCount, 
            baseline: baselineEntryCount, 
            growthRate,
            avgSize,
            totalSize
          },
          confidence: Math.min(0.9, growthRate / 500),
          suggestedActions: [
            'Review context cleanup policies',
            'Monitor memory usage',
            'Check for context leaks',
            'Implement context size limits',
            'Review session lifecycle management'
          ]
        } as any);
      }

      // Detect size anomalies
      if (maxSize > 5242880) { // 5MB threshold
        anomalies.push({
          id: `context_size_spike_${hour.getTime()}`,
          timestamp: hour,
          type: 'context_growth',
          severity: maxSize > 10485760 ? 'critical' : 'high', // 10MB critical threshold
          description: `Large context entry detected: ${Math.round(maxSize / 1024 / 1024)}MB (max size in hour)`,
          affectedComponents: ['context_manager', 'database', 'memory'],
          metrics: { 
            maxSize, 
            avgSize, 
            entryCount,
            sizeThreshold: 5242880
          },
          confidence: 0.95,
          suggestedActions: [
            'Implement content size validation',
            'Review large content sources',
            'Add content compression',
            'Set maximum content limits',
            'Monitor content types'
          ]
        } as any);
      }
    }

    return anomalies;
  }

  // Recommendation generation helper methods

  private generatePerformanceRecommendations(trends: PerformanceTrends, _currentMetrics: SystemMetrics): Recommendation[] {
    const recommendations: Recommendation[] = [];
    const now = new Date();

    // Analyze slow operations
    if (trends.slowOperations.length > 0) {
      const slowOpsCount = trends.slowOperations.length;
      const avgSlowDuration = trends.slowOperations.reduce((sum, op) => sum + op.duration, 0) / slowOpsCount;

      recommendations.push({
        id: `perf_slow_operations_${now.getTime()}`,
        timestamp: now,
        type: 'performance',
        priority: slowOpsCount > 20 ? 'high' : 'medium',
        title: 'Optimize Slow Operations',
        description: `${slowOpsCount} operations are running slower than 2 seconds, with an average duration of ${avgSlowDuration.toFixed(0)}ms`,
        impact: `Reducing slow operations could improve overall system responsiveness by 20-40%`,
        effort: 'medium',
        category: 'optimization',
        actionItems: [
          'Profile slow database queries and add indexes',
          'Implement query result caching',
          'Optimize data processing algorithms',
          'Consider async processing for heavy operations',
          'Add connection pooling optimization'
        ],
        expectedBenefit: 'Improved response times and better user experience',
        relatedMetrics: { 
          slowOperationsCount: slowOpsCount, 
          avgSlowDuration,
          p95Duration: Math.max(...Object.values(trends.operationMetrics).map(m => m.p95Duration))
        }
      } as any);
    }

    // Analyze degrading operations
    const degradingOps = Object.entries(trends.operationMetrics)
      .filter(([_, metrics]) => metrics.trend === 'degrading')
      .length;

    if (degradingOps > 0) {
      recommendations.push({
        id: `perf_degrading_trends_${now.getTime()}`,
        timestamp: now,
        type: 'performance',
        priority: degradingOps > 5 ? 'high' : 'medium',
        title: 'Address Performance Degradation Trends',
        description: `${degradingOps} operations show degrading performance trends`,
        impact: 'Preventing further degradation could maintain system stability',
        effort: 'medium',
        category: 'monitoring',
        actionItems: [
          'Set up automated performance monitoring',
          'Implement performance regression testing',
          'Review recent code changes for performance impact',
          'Add performance budgets to CI/CD pipeline',
          'Schedule regular performance audits'
        ],
        expectedBenefit: 'Proactive performance issue prevention',
        relatedMetrics: { degradingOperations: degradingOps }
      } as any);
    }

    return recommendations;
  }

  private generateOldResourceRecommendations(current: any, historical: Array<any>): Array<{ type: 'scale_up' | 'optimize' | 'cleanup'; description: string; priority: 'low' | 'medium' | 'high' }> {
    const recommendations: Array<{ type: 'scale_up' | 'optimize' | 'cleanup'; description: string; priority: 'low' | 'medium' | 'high' }> = [];

    const memoryUsage = current.memory?.percentage || current.memoryUsage || 0;
    if (memoryUsage > 85) {
      recommendations.push({
        type: 'scale_up',
        description: 'Memory usage is consistently high. Consider increasing available memory or scaling horizontally.',
        priority: 'high'
      } as any);
    }

    const activeSessions = current.sessions?.active || current.activeSessions || 0;
    if (activeSessions > 1000) {
      recommendations.push({
        type: 'optimize',
        description: 'High number of active sessions. Consider implementing session cleanup or dormancy detection.',
        priority: 'medium'
      } as any);
    }

    const avgMemoryUsage = historical.reduce((sum, h) => sum + h.memoryUsage, 0) / historical.length;
    if (avgMemoryUsage > 70) {
      recommendations.push({
        type: 'cleanup',
        description: 'Memory usage trending upward. Review for memory leaks and implement garbage collection optimization.',
        priority: 'medium'
      } as any);
    }

    return recommendations;
  }

  private generateResourceRecommendations(_utilization: ResourceUtilization, currentMetrics: SystemMetrics): Recommendation[] {
    const recommendations: Recommendation[] = [];
    const now = new Date();

    // Memory usage recommendations
    if (currentMetrics.memory.percentage > 80) {
      recommendations.push({
        id: `resource_memory_${now.getTime()}`,
        timestamp: now,
        type: 'resource',
        priority: currentMetrics.memory.percentage > 90 ? 'critical' : 'high',
        title: 'High Memory Usage Detected',
        description: `Memory usage is at ${currentMetrics.memory.percentage.toFixed(1)}%, approaching critical levels`,
        impact: 'High memory usage can lead to system instability and performance degradation',
        effort: 'medium',
        category: 'scaling',
        actionItems: [
          'Increase available memory or scale horizontally',
          'Implement memory usage monitoring and alerts',
          'Review and optimize memory-intensive operations',
          'Add garbage collection tuning',
          'Implement memory leak detection'
        ],
        expectedBenefit: 'Improved system stability and performance',
        relatedMetrics: { 
          currentMemoryUsage: currentMetrics.memory.percentage,
          memoryUsed: currentMetrics.memory.used,
          memoryTotal: currentMetrics.memory.total
        }
      } as any);
    }

    // Connection pool recommendations
    if (currentMetrics.database.activeConnections > 80) {
      recommendations.push({
        id: `resource_connections_${now.getTime()}`,
        timestamp: now,
        type: 'resource',
        priority: currentMetrics.database.activeConnections > 150 ? 'high' : 'medium',
        title: 'High Database Connection Usage',
        description: `${currentMetrics.database.activeConnections} active database connections detected`,
        impact: 'High connection usage can lead to connection pool exhaustion',
        effort: 'low',
        category: 'optimization',
        actionItems: [
          'Optimize connection pool configuration',
          'Implement connection pooling best practices',
          'Add connection usage monitoring',
          'Review long-running queries',
          'Implement connection timeout policies'
        ],
        expectedBenefit: 'Better database performance and resource utilization',
        relatedMetrics: { activeConnections: currentMetrics.database.activeConnections }
      } as any);
    }

    // Session management recommendations
    if (currentMetrics.sessions.active > 1000) {
      recommendations.push({
        id: `resource_sessions_${now.getTime()}`,
        timestamp: now,
        type: 'resource',
        priority: currentMetrics.sessions.active > 2000 ? 'high' : 'medium',
        title: 'High Active Session Count',
        description: `${currentMetrics.sessions.active} active sessions are consuming system resources`,
        impact: 'High session count increases memory usage and processing overhead',
        effort: 'medium',
        category: 'cleanup',
        actionItems: [
          'Implement aggressive session cleanup policies',
          'Add session dormancy detection',
          'Review session timeout configurations',
          'Implement session archival strategies',
          'Add session usage analytics'
        ],
        expectedBenefit: 'Reduced memory usage and improved system performance',
        relatedMetrics: { 
          activeSessions: currentMetrics.sessions.active,
          dormantSessions: currentMetrics.sessions.dormant,
          archivedSessions: currentMetrics.sessions.archived
        }
      } as any);
    }

    return recommendations;
  }

  private generateSessionRecommendations(sessionStats: SessionStatistics, _currentMetrics: SystemMetrics): Recommendation[] {
    const recommendations: Recommendation[] = [];
    const now = new Date();

    // Session duration recommendations
    if (sessionStats.averageSessionDuration > 86400) { // More than 24 hours
      recommendations.push({
        id: `session_duration_${now.getTime()}`,
        timestamp: now,
        type: 'configuration',
        priority: 'medium',
        title: 'Long Average Session Duration',
        description: `Average session duration is ${Math.round(sessionStats.averageSessionDuration / 3600)} hours`,
        impact: 'Long sessions consume resources and may indicate inefficient session management',
        effort: 'low',
        category: 'optimization',
        actionItems: [
          'Review session timeout policies',
          'Implement session activity tracking',
          'Add automatic session cleanup',
          'Set appropriate session expiration times',
          'Monitor session usage patterns'
        ],
        expectedBenefit: 'Better resource utilization and improved system performance',
        relatedMetrics: { 
          avgSessionDuration: sessionStats.averageSessionDuration,
          activeSessions: sessionStats.activeSessions,
          totalSessions: sessionStats.totalSessions
        }
      } as any);
    }

    // Session failure rate recommendations
    const failedSessions = sessionStats.sessionsByStatus['failed'] || 0;
    const errorSessions = sessionStats.sessionsByStatus['error'] || 0;
    const totalFailures = failedSessions + errorSessions;
    const failureRate = (totalFailures / sessionStats.totalSessions) * 100;

    if (failureRate > 10) {
      recommendations.push({
        id: `session_failures_${now.getTime()}`,
        timestamp: now,
        type: 'maintenance',
        priority: failureRate > 25 ? 'high' : 'medium',
        title: 'High Session Failure Rate',
        description: `${failureRate.toFixed(1)}% of sessions are failing (${totalFailures}/${sessionStats.totalSessions})`,
        impact: 'High failure rates indicate system reliability issues',
        effort: 'high',
        category: 'monitoring',
        actionItems: [
          'Investigate root causes of session failures',
          'Implement better error handling and recovery',
          'Add detailed failure logging and monitoring',
          'Review system dependencies and connectivity',
          'Implement retry mechanisms for transient failures'
        ],
        expectedBenefit: 'Improved system reliability and user experience',
        relatedMetrics: { 
          failureRate,
          failedSessions: totalFailures,
          totalSessions: sessionStats.totalSessions
        }
      } as any);
    }

    return recommendations;
  }

  private generateHandoffRecommendations(handoffAnalytics: HandoffAnalytics): Recommendation[] {
    const recommendations: Recommendation[] = [];
    const now = new Date();

    // Handoff success rate recommendations
    if (handoffAnalytics.successRate < 90) {
      recommendations.push({
        id: `handoff_success_rate_${now.getTime()}`,
        timestamp: now,
        type: 'performance',
        priority: handoffAnalytics.successRate < 75 ? 'high' : 'medium',
        title: 'Low Handoff Success Rate',
        description: `Handoff success rate is ${handoffAnalytics.successRate.toFixed(1)}% (${handoffAnalytics.successfulHandoffs}/${handoffAnalytics.totalHandoffs})`,
        impact: 'Low success rates affect user experience and system reliability',
        effort: 'medium',
        category: 'optimization',
        actionItems: [
          'Investigate common handoff failure patterns',
          'Implement better error handling in handoff process',
          'Add handoff retry mechanisms',
          'Review agent compatibility and connectivity',
          'Optimize handoff timeout settings'
        ],
        expectedBenefit: 'Improved handoff reliability and user experience',
        relatedMetrics: { 
          successRate: handoffAnalytics.successRate,
          totalHandoffs: handoffAnalytics.totalHandoffs,
          failedHandoffs: handoffAnalytics.failedHandoffs
        }
      } as any);
    }

    // Handoff performance recommendations
    if (handoffAnalytics.averageProcessingTime > 5000) { // More than 5 seconds
      recommendations.push({
        id: `handoff_performance_${now.getTime()}`,
        timestamp: now,
        type: 'performance',
        priority: handoffAnalytics.averageProcessingTime > 10000 ? 'high' : 'medium',
        title: 'Slow Handoff Processing',
        description: `Average handoff processing time is ${handoffAnalytics.averageProcessingTime.toFixed(0)}ms`,
        impact: 'Slow handoffs create poor user experience and system bottlenecks',
        effort: 'medium',
        category: 'optimization',
        actionItems: [
          'Profile handoff processing pipeline',
          'Optimize context serialization and transfer',
          'Implement handoff process caching',
          'Add parallel processing where possible',
          'Review network latency between agents'
        ],
        expectedBenefit: 'Faster handoffs and improved user experience',
        relatedMetrics: { 
          avgProcessingTime: handoffAnalytics.averageProcessingTime,
          totalHandoffs: handoffAnalytics.totalHandoffs
        }
      } as any);
    }

    return recommendations;
  }

  private generateConfigurationRecommendations(_currentMetrics: SystemMetrics, trends: PerformanceTrends): Recommendation[] {
    const recommendations: Recommendation[] = [];
    const now = new Date();

    // Database configuration recommendations
    if (trends.databasePerformance.avgQueryTime > 500) {
      recommendations.push({
        id: `config_database_${now.getTime()}`,
        timestamp: now,
        type: 'configuration',
        priority: trends.databasePerformance.avgQueryTime > 1000 ? 'high' : 'medium',
        title: 'Database Performance Optimization',
        description: `Average database query time is ${trends.databasePerformance.avgQueryTime.toFixed(0)}ms`,
        impact: 'Slow database queries affect overall system performance',
        effort: 'medium',
        category: 'optimization',
        actionItems: [
          'Add database indexes for frequently queried columns',
          'Optimize slow queries identified in performance logs',
          'Implement query result caching',
          'Review database connection pool settings',
          'Consider database query optimization tools'
        ],
        expectedBenefit: 'Faster database operations and improved system responsiveness',
        relatedMetrics: { 
          avgQueryTime: trends.databasePerformance.avgQueryTime,
          slowQueries: trends.databasePerformance.slowQueries,
          totalQueries: trends.databasePerformance.totalQueries
        }
      } as any);
    }

    // Monitoring configuration recommendations
    const monitoredOperations = Object.keys(trends.operationMetrics).length;
    if (monitoredOperations < 10) {
      recommendations.push({
        id: `config_monitoring_${now.getTime()}`,
        timestamp: now,
        type: 'configuration',
        priority: 'low',
        title: 'Expand Performance Monitoring',
        description: `Only ${monitoredOperations} operations are being monitored for performance`,
        impact: 'Limited monitoring reduces visibility into system performance',
        effort: 'low',
        category: 'monitoring',
        actionItems: [
          'Add performance monitoring to more operations',
          'Implement comprehensive metrics collection',
          'Set up automated performance alerting',
          'Create performance dashboards',
          'Add business metrics tracking'
        ],
        expectedBenefit: 'Better visibility into system performance and issues',
        relatedMetrics: { monitoredOperations }
      } as any);
    }

    return recommendations;
  }

  // Trend analysis helper methods

  private async analyzeSingleMetricTrend(metric: string, timeRange: { start: Date; end: Date }): Promise<TrendAnalysis | null> {
    let query: string;
    let params: any[];

    // Determine the appropriate query based on metric type
    switch (metric) {
      case 'session_count':
        query = `
          SELECT DATE_TRUNC('hour', created_at) as timestamp, COUNT(*) as value
          FROM sessions
          WHERE created_at BETWEEN $1 AND $2
          GROUP BY DATE_TRUNC('hour', created_at)
          ORDER BY timestamp ASC
        `;
        params = [timeRange.start, timeRange.end];
        break;

      case 'handoff_success_rate':
        query = `
          SELECT 
            DATE_TRUNC('hour', created_at) as timestamp,
            (COUNT(*) FILTER (WHERE success = true) * 100.0 / COUNT(*)) as value
          FROM performance_logs
          WHERE operation = 'handoff' AND created_at BETWEEN $1 AND $2
          GROUP BY DATE_TRUNC('hour', created_at)
          HAVING COUNT(*) >= 3
          ORDER BY timestamp ASC
        `;
        params = [timeRange.start, timeRange.end];
        break;

      case 'avg_response_time':
        query = `
          SELECT 
            DATE_TRUNC('hour', created_at) as timestamp,
            AVG(duration_ms) as value
          FROM performance_logs
          WHERE created_at BETWEEN $1 AND $2
          GROUP BY DATE_TRUNC('hour', created_at)
          ORDER BY timestamp ASC
        `;
        params = [timeRange.start, timeRange.end];
        break;

      case 'memory_usage':
        query = `
          SELECT 
            DATE_TRUNC('hour', recorded_at) as timestamp,
            AVG(metric_value) as value
          FROM system_metrics
          WHERE metric_name = 'memory_usage_percentage' AND recorded_at BETWEEN $1 AND $2
          GROUP BY DATE_TRUNC('hour', recorded_at)
          ORDER BY timestamp ASC
        `;
        params = [timeRange.start, timeRange.end];
        break;

      default:
        return null;
    }

    const result = await monitoredDb.query(query, params);
    
    if (result.rows.length < 3) {
      return null; // Not enough data points for trend analysis
    }

    const dataPoints = result.rows.map(row => ({
      timestamp: new Date(row.timestamp),
      value: parseFloat(row.value)
    }));

    // Calculate trend using linear regression
    const n = dataPoints.length;
    const sumX = dataPoints.reduce((sum, _point, index) => sum + index, 0);
    const sumY = dataPoints.reduce((sum, point) => sum + point.value, 0);
    const sumXY = dataPoints.reduce((sum, point, index) => sum + index * point.value, 0);
    const sumXX = dataPoints.reduce((sum, _point, index) => sum + index * index, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // Calculate correlation coefficient for confidence
    const meanX = sumX / n;
    const meanY = sumY / n;
    const numerator = dataPoints.reduce((sum, point, index) => sum + (index - meanX) * (point.value - meanY), 0);
    const denomX = Math.sqrt(dataPoints.reduce((sum, _point, index) => sum + Math.pow(index - meanX, 2), 0));
    const denomY = Math.sqrt(dataPoints.reduce((sum, point) => sum + Math.pow(point.value - meanY, 2), 0));
    const correlation = numerator / (denomX * denomY);

    // Determine trend direction
    let trend: 'increasing' | 'decreasing' | 'stable' | 'volatile';
    const avgValue = sumY / n;
    const relativeSlope = Math.abs(slope) / avgValue;

    if (relativeSlope < 0.01) {
      trend = 'stable';
    } else if (Math.abs(correlation) < 0.3) {
      trend = 'volatile';
    } else if (slope > 0) {
      trend = 'increasing';
    } else {
      trend = 'decreasing';
    }

    // Calculate change rate (percentage change per hour)
    const timeSpanHours = (timeRange.end.getTime() - timeRange.start.getTime()) / (1000 * 60 * 60);
    const totalChange = slope * (n - 1);
    const changeRate = (totalChange / avgValue) * 100 * (24 / timeSpanHours); // Normalize to daily rate

    // Simple seasonality detection (look for repeating patterns)
    const seasonality = this.detectSeasonality(dataPoints);

    // Generate simple forecast (linear projection)
    const forecast = this.generateForecast(dataPoints, slope, intercept, 24); // 24 hour forecast

    return {
      metric,
      timeRange,
      trend,
      changeRate,
      confidence: Math.abs(correlation),
      seasonality,
      forecast
    };
  }

  private detectSeasonality(dataPoints: Array<{ timestamp: Date; value: number }>): { detected: boolean; period?: number; amplitude?: number } {
    if (dataPoints.length < 24) {
      return { detected: false };
    }

    // Simple autocorrelation-based seasonality detection
    const values = dataPoints.map(p => p.value);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    
    // Check for 24-hour (daily) seasonality
    const period = 24;
    if (values.length >= period * 2) {
      let correlation = 0;
      let count = 0;
      
      for (let i = 0; i < values.length - period; i++) {
        correlation += (values[i] - mean) * (values[i + period] - mean);
        count++;
      }
      
      correlation /= count;
      
      // Calculate variance for normalization
      const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
      const normalizedCorrelation = correlation / variance;
      
      if (normalizedCorrelation > 0.3) {
        // Calculate amplitude as standard deviation of detrended values
        const amplitude = Math.sqrt(variance);
        
        return {
          detected: true,
          period,
          amplitude
        };
      }
    }

    return { detected: false };
  }

  private generateForecast(
    dataPoints: Array<{ timestamp: Date; value: number }>, 
    slope: number, 
    intercept: number, 
    forecastHours: number
  ): Array<{ timestamp: Date; predictedValue: number; confidenceInterval: { lower: number; upper: number } }> {
    const forecast: Array<{ timestamp: Date; predictedValue: number; confidenceInterval: { lower: number; upper: number } }> = [];
    
    const lastTimestamp = dataPoints[dataPoints.length - 1].timestamp;
    const n = dataPoints.length;
    
    // Calculate standard error for confidence intervals
    const residuals = dataPoints.map((point, index) => {
      const predicted = intercept + slope * index;
      return point.value - predicted;
    });
    
    const mse = residuals.reduce((sum, residual) => sum + residual * residual, 0) / (n - 2);
    const standardError = Math.sqrt(mse);
    
    for (let i = 1; i <= forecastHours; i++) {
      const forecastTimestamp = new Date(lastTimestamp.getTime() + i * 60 * 60 * 1000);
      const predictedValue = intercept + slope * (n + i - 1);
      
      // 95% confidence interval (approximately ±2 standard errors)
      const margin = 2 * standardError;
      
      forecast.push({
        timestamp: forecastTimestamp,
        predictedValue,
        confidenceInterval: {
          lower: predictedValue - margin,
          upper: predictedValue + margin
        }
      } as any);
    }
    
    return forecast;
  }

  // Alert helper methods

  private async recordAnomalyMetric(anomaly: Anomaly): Promise<void> {
    try {
      await monitoredDb.query(
        `INSERT INTO system_metrics (metric_name, metric_value, metric_type, labels, recorded_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          'anomaly_detected',
          1,
          'counter',
          JSON.stringify({
            anomaly_id: anomaly.id,
            type: anomaly.type,
            severity: anomaly.severity,
            confidence: anomaly.confidence
          }),
          anomaly.timestamp
        ]
      );
    } catch (error) {
      structuredLogger.error('Analytics service error', {
        timestamp: new Date(),
        errorType: 'DatabaseError',
        component: 'AnalyticsService',
        operation: 'recordAnomalyMetric',
        additionalInfo: { anomalyId: anomaly.id }
      } as any);
    }
  }

  private async triggerCriticalAnomalyNotification(anomaly: Anomaly): Promise<void> {
    // This would integrate with external alerting systems
    // For now, we'll just log it as a critical event
    structuredLogger.info('Analytics service operation', {
      timestamp: new Date(),
      component: 'AnalyticsService',
      operation: 'critical_anomaly_notification',
      status: 'completed',
      metadata: {
        anomalyId: anomaly.id,
        type: anomaly.type,
        severity: anomaly.severity,
        description: anomaly.description,
        affectedComponents: anomaly.affectedComponents,
        confidence: anomaly.confidence,
        suggestedActions: anomaly.suggestedActions,
        metrics: anomaly.metrics
      }
    } as any);

    // Record critical anomaly metric for external monitoring
    await monitoredDb.query(
      `INSERT INTO system_metrics (metric_name, metric_value, metric_type, labels, recorded_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        'critical_anomaly',
        1,
        'counter',
        JSON.stringify({
          anomaly_id: anomaly.id,
          type: anomaly.type,
          description: anomaly.description
        }),
        anomaly.timestamp
      ]
    );
  }

  private getAnomalySeverityBreakdown(anomalies: Anomaly[]): Record<string, number> {
    const breakdown: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    for (const anomaly of anomalies) {
      breakdown[anomaly.severity]++;
    }
    return breakdown;
  }

  private getRecommendationPriorityBreakdown(recommendations: Recommendation[]): Record<string, number> {
    const breakdown: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    for (const recommendation of recommendations) {
      breakdown[recommendation.priority]++;
    }
    return breakdown;
  }
}

// Export singleton instance
export const analyticsService = new AnalyticsService();