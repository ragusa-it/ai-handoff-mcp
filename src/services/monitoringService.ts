import { db } from '../database/index.js';
import { structuredLogger } from './structuredLogger.js';
import { PerformanceTimer } from '../mcp/utils/performance.js';

// Health status interfaces
export interface ComponentHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  responseTime: number;
  lastCheck: Date;
  error?: string;
  details?: Record<string, any>;
}

export interface HealthStatus {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  components: {
    database: ComponentHealth;
    redis: ComponentHealth;
    system: ComponentHealth;
  };
  timestamp: Date;
  uptime: number;
}

// Metrics interfaces
export interface HandoffMetrics {
  sessionId: string;
  agentFrom: string;
  agentTo: string;
  duration: number;
  success: boolean;
  contextSize?: number;
  errorType?: string;
}

export interface PerformanceMetrics {
  operation: string;
  duration: number;
  success: boolean;
  memoryUsage?: number;
  cpuUsage?: number;
  metadata?: Record<string, any>;
}

export interface SystemMetrics {
  timestamp: Date;
  memory: {
    used: number;
    total: number;
    percentage: number;
  };
  cpu: {
    usage: number;
  };
  database: {
    activeConnections: number;
    queryCount: number;
    avgResponseTime: number;
  };
  redis: {
    connected: boolean;
    memoryUsage: number;
    keyCount: number;
  };
  sessions: {
    active: number;
    dormant: number;
    archived: number;
  };
}

// Configuration interface
export interface MonitoringConfig {
  healthCheckInterval: number; // seconds
  metricsCollectionInterval: number; // seconds
  alertThresholds: {
    responseTime: number; // ms
    errorRate: number; // percentage
    memoryUsage: number; // percentage
    diskUsage: number; // percentage
  };
  enablePrometheusExport: boolean;
  enableHealthEndpoint: boolean;
}

/**
 * Monitoring Service Interface
 */
export interface IMonitoringService {
  // Health checks
  getSystemHealth(): Promise<HealthStatus>;
  checkDatabaseHealth(): Promise<ComponentHealth>;
  checkRedisHealth(): Promise<ComponentHealth>;
  checkSystemHealth(): Promise<ComponentHealth>;
  
  // Metrics collection
  recordToolCall(toolName: string, duration: number, success: boolean, metadata?: Record<string, any>): void;
  recordHandoffMetrics(sessionId: string, metrics: HandoffMetrics): void;
  recordPerformanceMetrics(operation: string, metrics: PerformanceMetrics): void;
  recordDatabaseQuery(query: string, duration: number, success: boolean): void;
  recordRedisOperation(operation: string, duration: number, success: boolean): void;
  
  // Metrics export
  getPrometheusMetrics(): string;
  getSystemMetrics(): Promise<SystemMetrics>;
  
  // Historical analysis and aggregation
  getMetricsAggregation(metricName: string, timeRange: { start: Date; end: Date }, aggregationType: 'avg' | 'sum' | 'count' | 'min' | 'max'): Promise<number>;
  getPerformanceTrends(operation: string, timeRange: { start: Date; end: Date }): Promise<Array<{ timestamp: Date; avgDuration: number; successRate: number }>>;
  storeMetricsAggregation(aggregationType: string, timeBucket: Date, aggregationData: Record<string, any>): Promise<void>;
  
  // Configuration and lifecycle
  updateConfig(config: Partial<MonitoringConfig>): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Monitoring Service Implementation
 * Provides comprehensive system monitoring, health checks, and metrics collection
 */
export class MonitoringService implements IMonitoringService {
  private config: MonitoringConfig;
  private startTime: Date;
  private healthCheckTimer?: NodeJS.Timeout | undefined;
  private metricsCollectionTimer?: NodeJS.Timeout | undefined;
  private isRunning = false;
  
  // In-memory metrics storage for Prometheus export
  private metrics = {
    toolCalls: new Map<string, { count: number; totalDuration: number; errors: number }>(),
    handoffs: new Map<string, { count: number; totalDuration: number; errors: number }>(),
    databaseQueries: new Map<string, { count: number; totalDuration: number; errors: number }>(),
    redisOperations: new Map<string, { count: number; totalDuration: number; errors: number }>(),
    systemMetrics: {
      memoryUsage: 0,
      cpuUsage: 0,
      activeConnections: 0,
      activeSessions: 0
    }
  };

  constructor(config?: Partial<MonitoringConfig>) {
    this.config = {
      healthCheckInterval: 30, // 30 seconds
      metricsCollectionInterval: 60, // 60 seconds
      alertThresholds: {
        responseTime: 1000, // 1 second
        errorRate: 5, // 5%
        memoryUsage: 80, // 80%
        diskUsage: 85 // 85%
      },
      enablePrometheusExport: true,
      enableHealthEndpoint: true,
      ...config
    };
    
    this.startTime = new Date();
  }

  /**
   * Start the monitoring service
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.startTime = new Date();

    // Start periodic health checks
    this.healthCheckTimer = setInterval(
      () => this.performPeriodicHealthCheck(),
      this.config.healthCheckInterval * 1000
    );

    // Start periodic metrics collection
    this.metricsCollectionTimer = setInterval(
      () => this.collectSystemMetrics(),
      this.config.metricsCollectionInterval * 1000
    );

    structuredLogger.logSystemEvent({
      timestamp: new Date(),
      component: 'MonitoringService',
      operation: 'start',
      status: 'completed'
    });

    console.log('✅ Monitoring service started');
  }

  /**
   * Stop the monitoring service
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }

    if (this.metricsCollectionTimer) {
      clearInterval(this.metricsCollectionTimer);
      this.metricsCollectionTimer = undefined;
    }

    structuredLogger.logSystemEvent({
      timestamp: new Date(),
      component: 'MonitoringService',
      operation: 'stop',
      status: 'completed'
    });

    console.log('✅ Monitoring service stopped');
  }

  /**
   * Get comprehensive system health status
   */
  async getSystemHealth(): Promise<HealthStatus> {
    const timer = new PerformanceTimer();
    
    try {
      const [databaseHealth, redisHealth, systemHealth] = await Promise.all([
        this.checkDatabaseHealth(),
        this.checkRedisHealth(),
        this.checkSystemHealth()
      ]);

      const components = {
        database: databaseHealth,
        redis: redisHealth,
        system: systemHealth
      };

      // Determine overall health
      let overall: HealthStatus['overall'] = 'healthy';
      if (Object.values(components).some(c => c.status === 'unhealthy')) {
        overall = 'unhealthy';
      } else if (Object.values(components).some(c => c.status === 'degraded')) {
        overall = 'degraded';
      }

      const healthStatus: HealthStatus = {
        overall,
        components,
        timestamp: new Date(),
        uptime: Date.now() - this.startTime.getTime()
      };

      // Log health check performance
      structuredLogger.logPerformanceMetric({
        timestamp: new Date(),
        metricName: 'health_check_duration',
        metricValue: timer.getElapsed(),
        metricType: 'timer',
        unit: 'ms',
        tags: { overall_status: overall }
      });

      return healthStatus;
    } catch (error) {
      structuredLogger.logError(error as Error, {
        timestamp: new Date(),
        errorType: 'SystemError',
        component: 'MonitoringService',
        operation: 'getSystemHealth'
      });

      return {
        overall: 'unhealthy',
        components: {
          database: { status: 'unhealthy', responseTime: 0, lastCheck: new Date(), error: 'Health check failed' },
          redis: { status: 'unhealthy', responseTime: 0, lastCheck: new Date(), error: 'Health check failed' },
          system: { status: 'unhealthy', responseTime: 0, lastCheck: new Date(), error: 'Health check failed' }
        },
        timestamp: new Date(),
        uptime: Date.now() - this.startTime.getTime()
      };
    }
  }

  /**
   * Check database health and connectivity
   */
  async checkDatabaseHealth(): Promise<ComponentHealth> {
    const timer = new PerformanceTimer();
    const lastCheck = new Date();

    try {
      // Test basic connectivity
      await db.query('SELECT 1');
      timer.checkpoint('basic_query');

      // Test table access
      const sessionCount = await db.query('SELECT COUNT(*) as count FROM sessions');
      timer.checkpoint('table_access');

      const responseTime = timer.getElapsed();
      
      // Determine status based on response time
      let status: ComponentHealth['status'] = 'healthy';
      if (responseTime > this.config.alertThresholds.responseTime) {
        status = 'degraded';
      }

      return {
        status,
        responseTime,
        lastCheck,
        details: {
          sessionCount: parseInt(sessionCount.rows[0].count),
          queryDuration: timer.getAllCheckpointDurations()
        }
      };
    } catch (error) {
      const responseTime = timer.getElapsed();
      
      structuredLogger.logError(error as Error, {
        timestamp: new Date(),
        errorType: 'SystemError',
        component: 'DatabaseHealthCheck',
        operation: 'checkDatabaseHealth'
      });

      return {
        status: 'unhealthy',
        responseTime,
        lastCheck,
        error: (error as Error).message
      };
    }
  }

  /**
   * Check Redis health and connectivity
   */
  async checkRedisHealth(): Promise<ComponentHealth> {
    const timer = new PerformanceTimer();
    const lastCheck = new Date();

    try {
      // Test basic connectivity with ping
      await db.query('SELECT 1'); // This will test Redis through the db health check
      const testKey = `health_check_${Date.now()}`;
      
      // Test set operation
      await db.setCache(testKey, { test: true }, 10);
      timer.checkpoint('set_operation');

      // Test get operation
      const retrieved = await db.getCache(testKey);
      timer.checkpoint('get_operation');

      // Clean up test key
      await db.deleteCache(testKey);
      timer.checkpoint('delete_operation');

      const responseTime = timer.getElapsed();
      
      // Determine status based on response time
      let status: ComponentHealth['status'] = 'healthy';
      if (responseTime > this.config.alertThresholds.responseTime) {
        status = 'degraded';
      }

      return {
        status,
        responseTime,
        lastCheck,
        details: {
          testSuccessful: retrieved !== null,
          operationDurations: timer.getAllCheckpointDurations()
        }
      };
    } catch (error) {
      const responseTime = timer.getElapsed();
      
      structuredLogger.logError(error as Error, {
        timestamp: new Date(),
        errorType: 'SystemError',
        component: 'RedisHealthCheck',
        operation: 'checkRedisHealth'
      });

      return {
        status: 'unhealthy',
        responseTime,
        lastCheck,
        error: (error as Error).message
      };
    }
  }

  /**
   * Check system resource health
   */
  async checkSystemHealth(): Promise<ComponentHealth> {
    const timer = new PerformanceTimer();
    const lastCheck = new Date();

    try {
      // Get memory usage
      const memoryUsage = process.memoryUsage();
      const totalMemory = memoryUsage.heapTotal + memoryUsage.external;
      const usedMemory = memoryUsage.heapUsed;
      const memoryPercentage = (usedMemory / totalMemory) * 100;

      timer.checkpoint('memory_check');

      // Get CPU usage (simplified - in production you'd use a proper CPU monitoring library)
      const cpuUsage = process.cpuUsage();
      const cpuPercentage = (cpuUsage.user + cpuUsage.system) / 1000000; // Convert to percentage approximation

      timer.checkpoint('cpu_check');

      const responseTime = timer.getElapsed();
      
      // Determine status based on resource usage
      let status: ComponentHealth['status'] = 'healthy';
      if (memoryPercentage > this.config.alertThresholds.memoryUsage) {
        status = 'degraded';
      }
      if (memoryPercentage > 95) {
        status = 'unhealthy';
      }

      return {
        status,
        responseTime,
        lastCheck,
        details: {
          memory: {
            used: usedMemory,
            total: totalMemory,
            percentage: memoryPercentage
          },
          cpu: {
            usage: cpuPercentage
          },
          uptime: process.uptime()
        }
      };
    } catch (error) {
      const responseTime = timer.getElapsed();
      
      structuredLogger.logError(error as Error, {
        timestamp: new Date(),
        errorType: 'SystemError',
        component: 'SystemHealthCheck',
        operation: 'checkSystemHealth'
      });

      return {
        status: 'unhealthy',
        responseTime,
        lastCheck,
        error: (error as Error).message
      };
    }
  }  /**

   * Record tool call metrics
   */
  recordToolCall(toolName: string, duration: number, success: boolean, metadata?: Record<string, any>): void {
    try {
      // Update in-memory metrics
      const existing = this.metrics.toolCalls.get(toolName) || { count: 0, totalDuration: 0, errors: 0 };
      existing.count++;
      existing.totalDuration += duration;
      if (!success) {
        existing.errors++;
      }
      this.metrics.toolCalls.set(toolName, existing);

      // Log performance metric
      structuredLogger.logPerformanceMetric({
        timestamp: new Date(),
        metricName: 'tool_call_duration',
        metricValue: duration,
        metricType: 'timer',
        unit: 'ms',
        tags: {
          tool_name: toolName,
          success: success.toString()
        },
        metadata: metadata || {}
      });

      // Store in database for historical analysis
      this.storePerformanceLog('tool_call', duration, success, undefined, {
        tool_name: toolName,
        ...metadata
      }).catch(error => {
        structuredLogger.logError(error, {
          timestamp: new Date(),
          errorType: 'SystemError',
          component: 'MonitoringService',
          operation: 'recordToolCall'
        });
      });
    } catch (error) {
      structuredLogger.logError(error as Error, {
        timestamp: new Date(),
        errorType: 'SystemError',
        component: 'MonitoringService',
        operation: 'recordToolCall'
      });
    }
  }

  /**
   * Record handoff metrics
   */
  recordHandoffMetrics(sessionId: string, metrics: HandoffMetrics): void {
    try {
      const handoffKey = `${metrics.agentFrom}_to_${metrics.agentTo}`;
      
      // Update in-memory metrics
      const existing = this.metrics.handoffs.get(handoffKey) || { count: 0, totalDuration: 0, errors: 0 };
      existing.count++;
      existing.totalDuration += metrics.duration;
      if (!metrics.success) {
        existing.errors++;
      }
      this.metrics.handoffs.set(handoffKey, existing);

      // Log performance metric
      structuredLogger.logPerformanceMetric({
        timestamp: new Date(),
        metricName: 'handoff_duration',
        metricValue: metrics.duration,
        metricType: 'timer',
        unit: 'ms',
        tags: {
          agent_from: metrics.agentFrom,
          agent_to: metrics.agentTo,
          success: metrics.success.toString()
        },
        sessionId
      });

      // Store in database for historical analysis
      this.storePerformanceLog('handoff', metrics.duration, metrics.success, sessionId, {
        agent_from: metrics.agentFrom,
        agent_to: metrics.agentTo,
        context_size: metrics.contextSize,
        error_type: metrics.errorType
      }).catch(error => {
        structuredLogger.logError(error, {
          timestamp: new Date(),
          errorType: 'SystemError',
          component: 'MonitoringService',
          operation: 'recordHandoffMetrics'
        });
      });
    } catch (error) {
      structuredLogger.logError(error as Error, {
        timestamp: new Date(),
        errorType: 'SystemError',
        component: 'MonitoringService',
        operation: 'recordHandoffMetrics'
      });
    }
  }

  /**
   * Record performance metrics for operations
   */
  recordPerformanceMetrics(_operation: string, metrics: PerformanceMetrics): void {
    try {
      // Log performance metric
      structuredLogger.logPerformanceMetric({
        timestamp: new Date(),
        metricName: 'operation_duration',
        metricValue: metrics.duration,
        metricType: 'timer',
        unit: 'ms',
        tags: {
          operation: metrics.operation,
          success: metrics.success.toString()
        },
        metadata: metrics.metadata || {}
      });

      // Store in database for historical analysis
      this.storePerformanceLog(metrics.operation, metrics.duration, metrics.success, undefined, {
        memory_usage: metrics.memoryUsage,
        cpu_usage: metrics.cpuUsage,
        ...metrics.metadata
      }).catch(error => {
        structuredLogger.logError(error, {
          timestamp: new Date(),
          errorType: 'SystemError',
          component: 'MonitoringService',
          operation: 'recordPerformanceMetrics'
        });
      });
    } catch (error) {
      structuredLogger.logError(error as Error, {
        timestamp: new Date(),
        errorType: 'SystemError',
        component: 'MonitoringService',
        operation: 'recordPerformanceMetrics'
      });
    }
  }

  /**
   * Record database query performance
   */
  recordDatabaseQuery(query: string, duration: number, success: boolean): void {
    try {
      // Sanitize query for metrics (remove parameters)
      const sanitizedQuery = query.replace(/\$\d+/g, '?').substring(0, 100);
      
      // Update in-memory metrics
      const existing = this.metrics.databaseQueries.get(sanitizedQuery) || { count: 0, totalDuration: 0, errors: 0 };
      existing.count++;
      existing.totalDuration += duration;
      if (!success) {
        existing.errors++;
      }
      this.metrics.databaseQueries.set(sanitizedQuery, existing);

      // Log performance metric
      structuredLogger.logPerformanceMetric({
        timestamp: new Date(),
        metricName: 'database_query_duration',
        metricValue: duration,
        metricType: 'timer',
        unit: 'ms',
        tags: {
          success: success.toString()
        }
      });

      // Store in database for historical analysis (avoid recursion by not storing DB query metrics in DB)
      if (duration > this.config.alertThresholds.responseTime) {
        structuredLogger.logWarning(`Slow database query detected: ${duration}ms`, {
          timestamp: new Date(),
          warningType: 'Performance',
          component: 'DatabaseQuery',
          threshold: this.config.alertThresholds.responseTime,
          currentValue: duration,
          recommendation: 'Consider optimizing query or adding indexes'
        });
      }
    } catch (error) {
      structuredLogger.logError(error as Error, {
        timestamp: new Date(),
        errorType: 'SystemError',
        component: 'MonitoringService',
        operation: 'recordDatabaseQuery'
      });
    }
  }

  /**
   * Record Redis operation performance
   */
  recordRedisOperation(operation: string, duration: number, success: boolean): void {
    try {
      // Update in-memory metrics
      const existing = this.metrics.redisOperations.get(operation) || { count: 0, totalDuration: 0, errors: 0 };
      existing.count++;
      existing.totalDuration += duration;
      if (!success) {
        existing.errors++;
      }
      this.metrics.redisOperations.set(operation, existing);

      // Log performance metric
      structuredLogger.logPerformanceMetric({
        timestamp: new Date(),
        metricName: 'redis_operation_duration',
        metricValue: duration,
        metricType: 'timer',
        unit: 'ms',
        tags: {
          operation,
          success: success.toString()
        }
      });

      // Alert on slow Redis operations
      if (duration > this.config.alertThresholds.responseTime / 2) { // Redis should be faster than DB
        structuredLogger.logWarning(`Slow Redis operation detected: ${operation} took ${duration}ms`, {
          timestamp: new Date(),
          warningType: 'Performance',
          component: 'RedisOperation',
          threshold: this.config.alertThresholds.responseTime / 2,
          currentValue: duration,
          recommendation: 'Check Redis connectivity and memory usage'
        });
      }
    } catch (error) {
      structuredLogger.logError(error as Error, {
        timestamp: new Date(),
        errorType: 'SystemError',
        component: 'MonitoringService',
        operation: 'recordRedisOperation'
      });
    }
  }

  /**
   * Get Prometheus-compatible metrics export
   */
  getPrometheusMetrics(): string {
    if (!this.config.enablePrometheusExport) {
      return '';
    }

    try {
      const lines: string[] = [];
      const timestamp = Date.now();

      // Tool call metrics
      lines.push('# HELP tool_calls_total Total number of tool calls');
      lines.push('# TYPE tool_calls_total counter');
      for (const [toolName, metrics] of this.metrics.toolCalls) {
        lines.push(`tool_calls_total{tool_name="${toolName}"} ${metrics.count} ${timestamp}`);
      }

      lines.push('# HELP tool_call_duration_seconds Tool call duration in seconds');
      lines.push('# TYPE tool_call_duration_seconds histogram');
      for (const [toolName, metrics] of this.metrics.toolCalls) {
        const avgDuration = metrics.totalDuration / metrics.count / 1000; // Convert to seconds
        lines.push(`tool_call_duration_seconds{tool_name="${toolName}"} ${avgDuration} ${timestamp}`);
      }

      lines.push('# HELP tool_call_errors_total Total number of tool call errors');
      lines.push('# TYPE tool_call_errors_total counter');
      for (const [toolName, metrics] of this.metrics.toolCalls) {
        lines.push(`tool_call_errors_total{tool_name="${toolName}"} ${metrics.errors} ${timestamp}`);
      }

      // Handoff metrics
      lines.push('# HELP handoffs_total Total number of handoffs');
      lines.push('# TYPE handoffs_total counter');
      for (const [handoffKey, metrics] of this.metrics.handoffs) {
        lines.push(`handoffs_total{handoff_type="${handoffKey}"} ${metrics.count} ${timestamp}`);
      }

      lines.push('# HELP handoff_duration_seconds Handoff duration in seconds');
      lines.push('# TYPE handoff_duration_seconds histogram');
      for (const [handoffKey, metrics] of this.metrics.handoffs) {
        const avgDuration = metrics.totalDuration / metrics.count / 1000; // Convert to seconds
        lines.push(`handoff_duration_seconds{handoff_type="${handoffKey}"} ${avgDuration} ${timestamp}`);
      }

      // Database metrics
      lines.push('# HELP database_queries_total Total number of database queries');
      lines.push('# TYPE database_queries_total counter');
      let totalQueries = 0;
      for (const [, metrics] of this.metrics.databaseQueries) {
        totalQueries += metrics.count;
      }
      lines.push(`database_queries_total ${totalQueries} ${timestamp}`);

      lines.push('# HELP database_query_duration_seconds Average database query duration in seconds');
      lines.push('# TYPE database_query_duration_seconds gauge');
      let totalDuration = 0;
      let totalCount = 0;
      for (const [, metrics] of this.metrics.databaseQueries) {
        totalDuration += metrics.totalDuration;
        totalCount += metrics.count;
      }
      if (totalCount > 0) {
        const avgDuration = totalDuration / totalCount / 1000; // Convert to seconds
        lines.push(`database_query_duration_seconds ${avgDuration} ${timestamp}`);
      }

      // Redis metrics
      lines.push('# HELP redis_operations_total Total number of Redis operations');
      lines.push('# TYPE redis_operations_total counter');
      for (const [operation, metrics] of this.metrics.redisOperations) {
        lines.push(`redis_operations_total{operation="${operation}"} ${metrics.count} ${timestamp}`);
      }

      lines.push('# HELP redis_operation_duration_seconds Redis operation duration in seconds');
      lines.push('# TYPE redis_operation_duration_seconds histogram');
      for (const [operation, metrics] of this.metrics.redisOperations) {
        const avgDuration = metrics.totalDuration / metrics.count / 1000; // Convert to seconds
        lines.push(`redis_operation_duration_seconds{operation="${operation}"} ${avgDuration} ${timestamp}`);
      }

      lines.push('# HELP redis_operation_errors_total Total number of Redis operation errors');
      lines.push('# TYPE redis_operation_errors_total counter');
      for (const [operation, metrics] of this.metrics.redisOperations) {
        lines.push(`redis_operation_errors_total{operation="${operation}"} ${metrics.errors} ${timestamp}`);
      }

      // System metrics
      lines.push('# HELP system_memory_usage_bytes Current memory usage in bytes');
      lines.push('# TYPE system_memory_usage_bytes gauge');
      const memoryUsage = process.memoryUsage();
      lines.push(`system_memory_usage_bytes ${memoryUsage.heapUsed} ${timestamp}`);

      lines.push('# HELP system_memory_usage_percentage Current memory usage percentage');
      lines.push('# TYPE system_memory_usage_percentage gauge');
      const memoryPercentage = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
      lines.push(`system_memory_usage_percentage ${memoryPercentage} ${timestamp}`);

      lines.push('# HELP system_uptime_seconds System uptime in seconds');
      lines.push('# TYPE system_uptime_seconds counter');
      const uptime = (Date.now() - this.startTime.getTime()) / 1000;
      lines.push(`system_uptime_seconds ${uptime} ${timestamp}`);

      lines.push('# HELP active_sessions_total Current number of active sessions');
      lines.push('# TYPE active_sessions_total gauge');
      lines.push(`active_sessions_total ${this.metrics.systemMetrics.activeSessions} ${timestamp}`);

      return lines.join('\n') + '\n';
    } catch (error) {
      structuredLogger.logError(error as Error, {
        timestamp: new Date(),
        errorType: 'SystemError',
        component: 'MonitoringService',
        operation: 'getPrometheusMetrics'
      });
      return '';
    }
  }

  /**
   * Get comprehensive system metrics
   */
  async getSystemMetrics(): Promise<SystemMetrics> {
    try {
      const memoryUsage = process.memoryUsage();
      const totalMemory = memoryUsage.heapTotal + memoryUsage.external;
      const usedMemory = memoryUsage.heapUsed;
      const memoryPercentage = (usedMemory / totalMemory) * 100;

      // Get database metrics
      const sessionCounts = await db.query(`
        SELECT 
          COUNT(*) FILTER (WHERE status = 'active') as active,
          COUNT(*) FILTER (WHERE is_dormant = true) as dormant,
          COUNT(*) FILTER (WHERE archived_at IS NOT NULL) as archived
        FROM sessions
      `);

      const sessionStats = sessionCounts.rows[0];

      return {
        timestamp: new Date(),
        memory: {
          used: usedMemory,
          total: totalMemory,
          percentage: memoryPercentage
        },
        cpu: {
          usage: 0 // Simplified - would need proper CPU monitoring library
        },
        database: {
          activeConnections: 0, // Would need to query pg_stat_activity
          queryCount: Array.from(this.metrics.databaseQueries.values()).reduce((sum, m) => sum + m.count, 0),
          avgResponseTime: this.calculateAverageResponseTime(this.metrics.databaseQueries)
        },
        redis: {
          connected: true, // Simplified - would check actual Redis connection
          memoryUsage: 0, // Would need Redis INFO command
          keyCount: 0 // Would need Redis DBSIZE command
        },
        sessions: {
          active: parseInt(sessionStats.active) || 0,
          dormant: parseInt(sessionStats.dormant) || 0,
          archived: parseInt(sessionStats.archived) || 0
        }
      };
    } catch (error) {
      structuredLogger.logError(error as Error, {
        timestamp: new Date(),
        errorType: 'SystemError',
        component: 'MonitoringService',
        operation: 'getSystemMetrics'
      });

      // Return default metrics on error
      const memoryUsage = process.memoryUsage();
      return {
        timestamp: new Date(),
        memory: {
          used: memoryUsage.heapUsed,
          total: memoryUsage.heapTotal,
          percentage: (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100
        },
        cpu: { usage: 0 },
        database: { activeConnections: 0, queryCount: 0, avgResponseTime: 0 },
        redis: { connected: false, memoryUsage: 0, keyCount: 0 },
        sessions: { active: 0, dormant: 0, archived: 0 }
      };
    }
  }

  /**
   * Update monitoring configuration
   */
  updateConfig(config: Partial<MonitoringConfig>): void {
    this.config = { ...this.config, ...config };
    
    structuredLogger.logSystemEvent({
      timestamp: new Date(),
      component: 'MonitoringService',
      operation: 'updateConfig',
      status: 'completed',
      metadata: config
    });
  }

  /**
   * Perform periodic health check
   */
  private async performPeriodicHealthCheck(): Promise<void> {
    try {
      const health = await this.getSystemHealth();
      
      // Alert on unhealthy status
      if (health.overall === 'unhealthy') {
        structuredLogger.logWarning('System health check failed', {
          timestamp: new Date(),
          warningType: 'Resource',
          component: 'SystemHealth',
          recommendation: 'Check component health details'
        });
      }

      // Update system metrics
      this.updateSystemMetrics();
    } catch (error) {
      structuredLogger.logError(error as Error, {
        timestamp: new Date(),
        errorType: 'SystemError',
        component: 'MonitoringService',
        operation: 'performPeriodicHealthCheck'
      });
    }
  }

  /**
   * Collect system metrics periodically
   */
  private async collectSystemMetrics(): Promise<void> {
    try {
      const metrics = await this.getSystemMetrics();
      
      // Update in-memory metrics
      this.metrics.systemMetrics.memoryUsage = metrics.memory.percentage;
      this.metrics.systemMetrics.cpuUsage = metrics.cpu.usage;
      this.metrics.systemMetrics.activeSessions = metrics.sessions.active;

      // Store metrics in database
      await this.storeSystemMetrics(metrics);

      // Perform hourly aggregations
      await this.performHourlyAggregations();
    } catch (error) {
      structuredLogger.logError(error as Error, {
        timestamp: new Date(),
        errorType: 'SystemError',
        component: 'MonitoringService',
        operation: 'collectSystemMetrics'
      });
    }
  }

  /**
   * Perform hourly aggregations for analytics
   */
  private async performHourlyAggregations(): Promise<void> {
    try {
      const now = new Date();
      const hourBucket = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());
      
      // Check if we already have aggregations for this hour
      const existingAggregation = await db.query(
        'SELECT id FROM analytics_aggregations WHERE aggregation_type = $1 AND time_bucket = $2',
        ['hourly_performance', hourBucket]
      );

      if (existingAggregation.rows.length > 0) {
        return; // Already aggregated for this hour
      }

      // Aggregate performance metrics for the current hour
      const performanceAggregation = await db.query(`
        SELECT 
          operation,
          COUNT(*) as total_calls,
          AVG(duration_ms) as avg_duration,
          MIN(duration_ms) as min_duration,
          MAX(duration_ms) as max_duration,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) as p95_duration,
          COUNT(*) FILTER (WHERE success = true) as successful_calls,
          COUNT(*) FILTER (WHERE success = false) as failed_calls
        FROM performance_logs 
        WHERE created_at >= $1 AND created_at < $2
        GROUP BY operation
      `, [hourBucket, new Date(hourBucket.getTime() + 60 * 60 * 1000)]);

      const aggregationData = {
        operations: performanceAggregation.rows.reduce((acc, row) => {
          acc[row.operation] = {
            totalCalls: parseInt(row.total_calls),
            avgDuration: parseFloat(row.avg_duration || '0'),
            minDuration: parseFloat(row.min_duration || '0'),
            maxDuration: parseFloat(row.max_duration || '0'),
            p95Duration: parseFloat(row.p95_duration || '0'),
            successfulCalls: parseInt(row.successful_calls),
            failedCalls: parseInt(row.failed_calls),
            successRate: (parseInt(row.successful_calls) / parseInt(row.total_calls)) * 100
          };
          return acc;
        }, {} as Record<string, any>)
      };

      // Store the aggregation
      await this.storeMetricsAggregation('hourly_performance', hourBucket, aggregationData);

      structuredLogger.logSystemEvent({
        timestamp: new Date(),
        component: 'MonitoringService',
        operation: 'performHourlyAggregations',
        status: 'completed',
        metadata: { hourBucket: hourBucket.toISOString(), operationsCount: Object.keys(aggregationData.operations).length }
      });
    } catch (error) {
      structuredLogger.logError(error as Error, {
        timestamp: new Date(),
        errorType: 'SystemError',
        component: 'MonitoringService',
        operation: 'performHourlyAggregations'
      });
    }
  }

  /**
   * Update in-memory system metrics
   */
  private updateSystemMetrics(): void {
    const memoryUsage = process.memoryUsage();
    const memoryPercentage = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
    
    this.metrics.systemMetrics.memoryUsage = memoryPercentage;
    
    // Alert on high memory usage
    if (memoryPercentage > this.config.alertThresholds.memoryUsage) {
      structuredLogger.logWarning(`High memory usage detected: ${memoryPercentage.toFixed(2)}%`, {
        timestamp: new Date(),
        warningType: 'Resource',
        component: 'SystemMemory',
        threshold: this.config.alertThresholds.memoryUsage,
        currentValue: memoryPercentage,
        recommendation: 'Consider restarting the service or investigating memory leaks'
      });
    }
  }

  /**
   * Store performance log in database
   */
  private async storePerformanceLog(
    operation: string,
    duration: number,
    success: boolean,
    sessionId?: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    try {
      await db.query(
        'INSERT INTO performance_logs (operation, duration_ms, success, session_id, metadata) VALUES ($1, $2, $3, $4, $5)',
        [operation, duration, success, sessionId || null, JSON.stringify(metadata || {})]
      );
    } catch (error) {
      // Don't log database errors when storing performance logs to avoid recursion
      console.error('Failed to store performance log:', error);
    }
  }

  /**
   * Store system metrics in database
   */
  private async storeSystemMetrics(metrics: SystemMetrics): Promise<void> {
    try {
      const queries = [
        {
          name: 'memory_usage_bytes',
          value: metrics.memory.used,
          type: 'gauge',
          labels: { component: 'system' }
        },
        {
          name: 'memory_usage_percentage',
          value: metrics.memory.percentage,
          type: 'gauge',
          labels: { component: 'system' }
        },
        {
          name: 'cpu_usage_percentage',
          value: metrics.cpu.usage,
          type: 'gauge',
          labels: { component: 'system' }
        },
        {
          name: 'active_sessions',
          value: metrics.sessions.active,
          type: 'gauge',
          labels: { component: 'sessions' }
        },
        {
          name: 'dormant_sessions',
          value: metrics.sessions.dormant,
          type: 'gauge',
          labels: { component: 'sessions' }
        },
        {
          name: 'archived_sessions',
          value: metrics.sessions.archived,
          type: 'gauge',
          labels: { component: 'sessions' }
        }
      ];

      for (const metric of queries) {
        await db.query(
          'INSERT INTO system_metrics (metric_name, metric_value, metric_type, labels) VALUES ($1, $2, $3, $4)',
          [metric.name, metric.value, metric.type, JSON.stringify(metric.labels)]
        );
      }
    } catch (error) {
      structuredLogger.logError(error as Error, {
        timestamp: new Date(),
        errorType: 'SystemError',
        component: 'MonitoringService',
        operation: 'storeSystemMetrics'
      });
    }
  }

  /**
   * Get metrics aggregation for historical analysis
   */
  async getMetricsAggregation(
    metricName: string, 
    timeRange: { start: Date; end: Date }, 
    aggregationType: 'avg' | 'sum' | 'count' | 'min' | 'max'
  ): Promise<number> {
    try {
      const query = `
        SELECT ${aggregationType}(metric_value) as result
        FROM system_metrics 
        WHERE metric_name = $1 
        AND recorded_at BETWEEN $2 AND $3
      `;
      
      const result = await db.query(query, [metricName, timeRange.start, timeRange.end]);
      return parseFloat(result.rows[0]?.result || '0');
    } catch (error) {
      structuredLogger.logError(error as Error, {
        timestamp: new Date(),
        errorType: 'SystemError',
        component: 'MonitoringService',
        operation: 'getMetricsAggregation'
      });
      return 0;
    }
  }

  /**
   * Get performance trends for a specific operation
   */
  async getPerformanceTrends(
    operation: string, 
    timeRange: { start: Date; end: Date }
  ): Promise<Array<{ timestamp: Date; avgDuration: number; successRate: number }>> {
    try {
      const query = `
        SELECT 
          DATE_TRUNC('hour', created_at) as timestamp,
          AVG(duration_ms) as avg_duration,
          (COUNT(*) FILTER (WHERE success = true) * 100.0 / COUNT(*)) as success_rate
        FROM performance_logs 
        WHERE operation = $1 
        AND created_at BETWEEN $2 AND $3
        GROUP BY DATE_TRUNC('hour', created_at)
        ORDER BY timestamp ASC
      `;
      
      const result = await db.query(query, [operation, timeRange.start, timeRange.end]);
      return result.rows
        .filter(row => row.timestamp) // Filter out rows with null timestamps
        .map(row => ({
          timestamp: row.timestamp,
          avgDuration: parseFloat(row.avg_duration || '0'),
          successRate: parseFloat(row.success_rate || '0')
        }));
    } catch (error) {
      structuredLogger.logError(error as Error, {
        timestamp: new Date(),
        errorType: 'SystemError',
        component: 'MonitoringService',
        operation: 'getPerformanceTrends'
      });
      return [];
    }
  }

  /**
   * Store metrics aggregation for analytics
   */
  async storeMetricsAggregation(
    aggregationType: string, 
    timeBucket: Date, 
    aggregationData: Record<string, any>
  ): Promise<void> {
    try {
      await db.query(
        'INSERT INTO analytics_aggregations (aggregation_type, time_bucket, aggregation_data) VALUES ($1, $2, $3)',
        [aggregationType, timeBucket, JSON.stringify(aggregationData)]
      );
    } catch (error) {
      structuredLogger.logError(error as Error, {
        timestamp: new Date(),
        errorType: 'SystemError',
        component: 'MonitoringService',
        operation: 'storeMetricsAggregation'
      });
    }
  }

  /**
   * Calculate average response time from metrics map
   */
  private calculateAverageResponseTime(metricsMap: Map<string, { count: number; totalDuration: number; errors: number }>): number {
    let totalDuration = 0;
    let totalCount = 0;

    for (const metrics of metricsMap.values()) {
      totalDuration += metrics.totalDuration;
      totalCount += metrics.count;
    }

    return totalCount > 0 ? totalDuration / totalCount : 0;
  }
}

// Create and export a singleton instance
export const monitoringService = new MonitoringService();