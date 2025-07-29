import { db } from '../database/index.js';
import { structuredLogger, type PerformanceMetric, type SystemContext } from './structuredLogger.js';
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
  private healthCheckTimer?: NodeJS.Timeout;
  private metricsCollectionTimer?: NodeJS.Timeout;
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
        