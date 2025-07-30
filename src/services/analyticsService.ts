import { monitoredDb } from '../database/monitoredDatabase.js';
import { monitoringService } from './monitoringService.js';
import { structuredLogger } from './structuredLogger.js';
import { PerformanceTimer } from '../mcp/utils/performance.js';

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
   * Initialize analytics service and start background aggregation
   */
  private async initializeAnalytics(): Promise<void> {
    try {
      // Ensure analytics aggregations table exists and has recent data
      await this.ensureAggregationsUpToDate();

      structuredLogger.logSystemEvent({
        timestamp: new Date(),
        component: 'AnalyticsService',
        operation: 'initialize',
        status: 'completed'
      });
    } catch (error) {
      structuredLogger.logError(error as Error, {
        timestamp: new Date(),
        errorType: 'SystemError',
        component: 'AnalyticsService',
        operation: 'initialize'
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

      structuredLogger.logSystemEvent({
        timestamp: new Date(),
        component: 'AnalyticsService',
        operation: 'get_session_statistics_start',
        status: 'started',
        metadata: { timeRange: query.timeRange }
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

      structuredLogger.logSystemEvent({
        timestamp: new Date(),
        component: 'AnalyticsService',
        operation: 'get_session_statistics_complete',
        status: 'completed',
        metadata: {
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

      structuredLogger.logError(error as Error, {
        timestamp: new Date(),
        errorType: 'ServiceError',
        component: 'AnalyticsService',
        operation: 'get_session_statistics',
        additionalInfo: { timeRange: query.timeRange, durationMs: duration }
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

      structuredLogger.logSystemEvent({
        timestamp: new Date(),
        component: 'AnalyticsService',
        operation: 'get_handoff_analytics_start',
        status: 'started',
        metadata: { timeRange: query.timeRange }
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
      });

      structuredLogger.logSystemEvent({
        timestamp: new Date(),
        component: 'AnalyticsService',
        operation: 'get_handoff_analytics_complete',
        status: 'completed',
        metadata: {
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
      });

      structuredLogger.logError(error as Error, {
        timestamp: new Date(),
        errorType: 'ServiceError',
        component: 'AnalyticsService',
        operation: 'get_handoff_analytics',
        additionalInfo: { timeRange: query.timeRange, durationMs: duration }
      });

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

      structuredLogger.logSystemEvent({
        timestamp: new Date(),
        component: 'AnalyticsService',
        operation: 'get_context_growth_patterns_start',
        status: 'started',
        metadata: { timeRange: query.timeRange }
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
          });

          sizeTrends.push({
            timestamp: bucketStart,
            avgSize: sizes.reduce((a, b) => a + b, 0) / sizes.length,
            maxSize: Math.max(...sizes),
            minSize: Math.min(...sizes)
          });
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
      });

      structuredLogger.logSystemEvent({
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
      });

      return patterns;

    } catch (error) {
      const duration = timer.getElapsed();

      monitoringService.recordPerformanceMetrics('get_context_growth_patterns', {
        operation: 'get_context_growth_patterns',
        duration,
        success: false,
        metadata: { error: (error as Error).message }
      });

      structuredLogger.logError(error as Error, {
        timestamp: new Date(),
        errorType: 'ServiceError',
        component: 'AnalyticsService',
        operation: 'get_context_growth_patterns',
        additionalInfo: { timeRange: query.timeRange, durationMs: duration }
      });

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

      structuredLogger.logSystemEvent({
        timestamp: new Date(),
        component: 'AnalyticsService',
        operation: 'get_performance_trends_start',
        status: 'started',
        metadata: { timeRange: query.timeRange }
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
          });
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
          });
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
      });

      structuredLogger.logSystemEvent({
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
      });

      return trends;

    } catch (error) {
      const duration = timer.getElapsed();

      monitoringService.recordPerformanceMetrics('get_performance_trends', {
        operation: 'get_performance_trends',
        duration,
        success: false,
        metadata: { error: (error as Error).message }
      });

      structuredLogger.logError(error as Error, {
        timestamp: new Date(),
        errorType: 'ServiceError',
        component: 'AnalyticsService',
        operation: 'get_performance_trends',
        additionalInfo: { timeRange: query.timeRange, durationMs: duration }
      });

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

      structuredLogger.logSystemEvent({
        timestamp: new Date(),
        component: 'AnalyticsService',
        operation: 'get_resource_utilization_start',
        status: 'started',
        metadata: { timeRange: query.timeRange }
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
          });
        }
      }

      // Generate alerts and recommendations
      const alerts = this.generateResourceAlerts(historical);
      const recommendations = this.generateResourceRecommendations(currentSystemMetrics, historical);

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
      });

      structuredLogger.logSystemEvent({
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
      });

      return utilization;

    } catch (error) {
      const duration = timer.getElapsed();

      monitoringService.recordPerformanceMetrics('get_resource_utilization', {
        operation: 'get_resource_utilization',
        duration,
        success: false,
        metadata: { error: (error as Error).message }
      });

      structuredLogger.logError(error as Error, {
        timestamp: new Date(),
        errorType: 'ServiceError',
        component: 'AnalyticsService',
        operation: 'get_resource_utilization',
        additionalInfo: { timeRange: query.timeRange, durationMs: duration }
      });

      throw error;
    }
  }

  /**
   * Aggregate analytics data for efficient querying
   */
  async aggregateAnalyticsData(timeBucket: Date, aggregationType: string): Promise<void> {
    const timer = new PerformanceTimer();

    try {
      structuredLogger.logSystemEvent({
        timestamp: new Date(),
        component: 'AnalyticsService',
        operation: 'aggregate_analytics_data_start',
        status: 'started',
        metadata: { timeBucket, aggregationType }
      });

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
      });

      structuredLogger.logSystemEvent({
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
      });

    } catch (error) {
      const duration = timer.getElapsed();

      monitoringService.recordPerformanceMetrics('aggregate_analytics_data', {
        operation: 'aggregate_analytics_data',
        duration,
        success: false,
        metadata: { aggregationType, error: (error as Error).message }
      });

      structuredLogger.logError(error as Error, {
        timestamp: new Date(),
        errorType: 'ServiceError',
        component: 'AnalyticsService',
        operation: 'aggregate_analytics_data',
        additionalInfo: { aggregationType, timeBucket, durationMs: duration }
      });

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
      structuredLogger.logError(error as Error, {
        timestamp: new Date(),
        errorType: 'ServiceError',
        component: 'AnalyticsService',
        operation: 'ensureAggregationsUpToDate'
      });
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
        });
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
        });
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
        });
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
        });
      }

      if (dataPoint.cpuUsage > 80) {
        alerts.push({
          timestamp: dataPoint.timestamp,
          type: 'cpu',
          threshold: 80,
          currentValue: dataPoint.cpuUsage,
          severity: dataPoint.cpuUsage > 90 ? 'critical' : 'warning'
        });
      }

      if (dataPoint.activeConnections > 100) {
        alerts.push({
          timestamp: dataPoint.timestamp,
          type: 'connections',
          threshold: 100,
          currentValue: dataPoint.activeConnections,
          severity: dataPoint.activeConnections > 200 ? 'critical' : 'warning'
        });
      }
    }

    return alerts;
  }

  private generateResourceRecommendations(current: any, historical: Array<any>): Array<{ type: 'scale_up' | 'optimize' | 'cleanup'; description: string; priority: 'low' | 'medium' | 'high' }> {
    const recommendations: Array<{ type: 'scale_up' | 'optimize' | 'cleanup'; description: string; priority: 'low' | 'medium' | 'high' }> = [];

    const memoryUsage = current.memory?.percentage || current.memoryUsage || 0;
    if (memoryUsage > 85) {
      recommendations.push({
        type: 'scale_up',
        description: 'Memory usage is consistently high. Consider increasing available memory or scaling horizontally.',
        priority: 'high'
      });
    }

    const activeSessions = current.sessions?.active || current.activeSessions || 0;
    if (activeSessions > 1000) {
      recommendations.push({
        type: 'optimize',
        description: 'High number of active sessions. Consider implementing session cleanup or dormancy detection.',
        priority: 'medium'
      });
    }

    const avgMemoryUsage = historical.reduce((sum, h) => sum + h.memoryUsage, 0) / historical.length;
    if (avgMemoryUsage > 70) {
      recommendations.push({
        type: 'cleanup',
        description: 'Memory usage trending upward. Review for memory leaks and implement garbage collection optimization.',
        priority: 'medium'
      });
    }

    return recommendations;
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
    });
  }
}

// Export singleton instance
export const analyticsService = new AnalyticsService();