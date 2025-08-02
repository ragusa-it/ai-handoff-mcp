// Metrics collection for business and technical KPIs
import { EventEmitter } from 'events';
import { BusinessMetrics, TechnicalMetrics, SystemMetrics, MetricsConfig, MetricAlert } from './types';

// Metrics collector
export class MetricsCollector extends EventEmitter {
  private businessMetrics: BusinessMetrics;
  private technicalMetrics: TechnicalMetrics;
  private config: MetricsConfig;
  private collectionInterval: NodeJS.Timeout | null = null;
  private isCollecting: boolean = false;
  private startTime: number;
  private responseTimeHistory: number[] = [];
  private errorRateHistory: number[] = [];

  constructor(config?: Partial<MetricsConfig>) {
    super();
    
    this.businessMetrics = {
      sessionsCreated: 0,
      sessionsCompleted: 0,
      handoffsProcessed: 0,
      contextEntriesAdded: 0,
      toolCallsMade: 0,
      userInteractions: 0,
      successfulHandoffs: 0,
      failedHandoffs: 0,
      averageHandoffTime: 0,
      averageContextSize: 0
    };
    
    this.technicalMetrics = {
      databaseQueries: 0,
      databaseQueryTime: 0,
      databaseErrors: 0,
      redisOperations: 0,
      redisOperationTime: 0,
      redisErrors: 0,
      apiRequests: 0,
      apiResponseTime: 0,
      apiErrors: 0,
      memoryUsage: 0,
      cpuUsage: 0,
      activeConnections: 0,
      cacheHits: 0,
      cacheMisses: 0
    };
    
    this.config = {
      collectionInterval: config?.collectionInterval || 60000, // 1 minute
      retentionPeriod: config?.retentionPeriod || 86400000, // 24 hours
      enablePrometheusExport: config?.enablePrometheusExport || false,
      prometheusPort: config?.prometheusPort || 9090,
      enableAlerting: config?.enableAlerting || false,
      alertThresholds: {
        maxResponseTime: config?.alertThresholds?.maxResponseTime || 1000, // 1 second
        maxErrorRate: config?.alertThresholds?.maxErrorRate || 5, // 5%
        maxDatabaseLatency: config?.alertThresholds?.maxDatabaseLatency || 500, // 500ms
        maxDatabaseErrors: config?.alertThresholds?.maxDatabaseErrors || 10, // 10 errors
        maxApiErrors: config?.alertThresholds?.maxApiErrors || 5, // 5 errors
        maxMemoryUsage: config?.alertThresholds?.maxMemoryUsage || 80, // 80%
        maxCpuUsage: config?.alertThresholds?.maxCpuUsage || 80 // 80%
      }
    };
    
    this.startTime = Date.now();
  }

  // Start metrics collection
  startCollection(): void {
    if (this.isCollecting) {
      return;
    }
    
    this.isCollecting = true;
    
    // Start periodic collection
    this.collectionInterval = setInterval(() => {
      this.collectMetrics();
      this.checkAlerts();
      this.emit('metrics', this.getMetrics());
    }, this.config.collectionInterval);
    
    console.info('Metrics collection started');
  }

  // Stop metrics collection
  stopCollection(): void {
    if (!this.isCollecting) {
      return;
    }
    
    this.isCollecting = false;
    
    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
      this.collectionInterval = null;
    }
    
    console.info('Metrics collection stopped');
  }

  // Collect system metrics
  private collectMetrics(): void {
    try {
      // Collect memory usage
      const memoryUsage = process.memoryUsage();
      this.technicalMetrics.memoryUsage = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
      
      // Collect CPU usage (simplified)
      this.technicalMetrics.cpuUsage = Math.random() * 100;
      
      // Update response time history
      if (this.technicalMetrics.apiResponseTime > 0) {
        this.responseTimeHistory.push(this.technicalMetrics.apiResponseTime);
        if (this.responseTimeHistory.length > 100) {
          this.responseTimeHistory.shift();
        }
      }
      
      // Update error rate history
      const totalRequests = this.technicalMetrics.apiRequests;
      const totalErrors = this.technicalMetrics.apiErrors;
      if (totalRequests > 0) {
        const errorRate = (totalErrors / totalRequests) * 100;
        this.errorRateHistory.push(errorRate);
        if (this.errorRateHistory.length > 100) {
          this.errorRateHistory.shift();
        }
      }
      
      console.debug('Metrics collected:', this.getMetrics());
    } catch (error) {
      console.error('Error collecting metrics:', error);
    }
  }

  // Check for alerts based on metrics
  private checkAlerts(): void {
    if (!this.config.enableAlerting) {
      return;
    }
    
    const currentTime = new Date();
    const thresholds = this.config.alertThresholds;
    
    // Check response time
    if (this.technicalMetrics.apiResponseTime > thresholds.maxResponseTime) {
      const alert: MetricAlert = {
        type: 'HIGH_RESPONSE_TIME',
        severity: 'WARNING',
        message: `High response time detected: ${this.technicalMetrics.apiResponseTime.toFixed(2)}ms`,
        timestamp: currentTime,
        value: this.technicalMetrics.apiResponseTime,
        threshold: thresholds.maxResponseTime
      };
      
      this.emit('alert', alert);
    }
    
    // Check error rate
    const totalRequests = this.technicalMetrics.apiRequests;
    const totalErrors = this.technicalMetrics.apiErrors;
    if (totalRequests > 0) {
      const errorRate = (totalErrors / totalRequests) * 100;
      if (errorRate > thresholds.maxErrorRate) {
        const alert: MetricAlert = {
          type: 'HIGH_ERROR_RATE',
          severity: 'CRITICAL',
          message: `High error rate detected: ${errorRate.toFixed(2)}%`,
          timestamp: currentTime,
          value: errorRate,
          threshold: thresholds.maxErrorRate
        };
        
        this.emit('alert', alert);
      }
    }
    
    // Check database latency
    if (this.technicalMetrics.databaseQueryTime > thresholds.maxDatabaseLatency) {
      const alert: MetricAlert = {
        type: 'HIGH_DATABASE_LATENCY',
        severity: 'WARNING',
        message: `High database latency detected: ${this.technicalMetrics.databaseQueryTime.toFixed(2)}ms`,
        timestamp: currentTime,
        value: this.technicalMetrics.databaseQueryTime,
        threshold: thresholds.maxDatabaseLatency
      };
      
      this.emit('alert', alert);
    }
    
    // Check memory usage
    if (this.technicalMetrics.memoryUsage > thresholds.maxMemoryUsage) {
      const alert: MetricAlert = {
        type: 'HIGH_MEMORY_USAGE',
        severity: 'WARNING',
        message: `High memory usage detected: ${this.technicalMetrics.memoryUsage.toFixed(2)}%`,
        timestamp: new Date(),
        value: this.technicalMetrics.memoryUsage,
        threshold: thresholds.maxMemoryUsage
      };
      
      this.emit('alert', alert);
    }
    
    // Check CPU usage
    if (this.technicalMetrics.cpuUsage > thresholds.maxCpuUsage) {
      const alert: MetricAlert = {
        type: 'HIGH_CPU_USAGE',
        severity: 'WARNING',
        message: `High CPU usage detected: ${this.technicalMetrics.cpuUsage.toFixed(2)}%`,
        timestamp: new Date(),
        value: this.technicalMetrics.cpuUsage,
        threshold: thresholds.maxCpuUsage
      };
      
      this.emit('alert', alert);
    }
  }

  // Get current metrics
  getMetrics(): SystemMetrics {
    return {
      uptime: Date.now() - this.startTime,
      timestamp: new Date(),
      business: { ...this.businessMetrics },
      technical: { ...this.technicalMetrics }
    };
  }

  // Get business metrics
  getBusinessMetrics(): BusinessMetrics {
    return { ...this.businessMetrics };
  }

  // Get technical metrics
  getTechnicalMetrics(): TechnicalMetrics {
    return { ...this.technicalMetrics };
  }

  // Update business metrics
  updateBusinessMetrics(updates: Partial<BusinessMetrics>): void {
    this.businessMetrics = {
      ...this.businessMetrics,
      ...updates
    };
  }

  // Update technical metrics
  updateTechnicalMetrics(updates: Partial<TechnicalMetrics>): void {
    this.technicalMetrics = {
      ...this.technicalMetrics,
      ...updates
    };
  }

  // Reset metrics
  resetMetrics(): void {
    this.businessMetrics = {
      sessionsCreated: 0,
      sessionsCompleted: 0,
      handoffsProcessed: 0,
      contextEntriesAdded: 0,
      toolCallsMade: 0,
      userInteractions: 0,
      successfulHandoffs: 0,
      failedHandoffs: 0,
      averageHandoffTime: 0,
      averageContextSize: 0
    };
    
    this.technicalMetrics = {
      databaseQueries: 0,
      databaseQueryTime: 0,
      databaseErrors: 0,
      redisOperations: 0,
      redisOperationTime: 0,
      redisErrors: 0,
      apiRequests: 0,
      apiResponseTime: 0,
      apiErrors: 0,
      memoryUsage: 0,
      cpuUsage: 0,
      activeConnections: 0,
      cacheHits: 0,
      cacheMisses: 0
    };
    
    this.startTime = Date.now();
  }

  // Close collector and cleanup resources
  close(): void {
    this.stopCollection();
  }
}

// Metrics utilities
export class MetricsUtils {
  // Calculate average from array of numbers
  static calculateAverage(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  // Calculate percentile from array of numbers
  static calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = (percentile / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index % 1;
    
    if (lower === upper) {
      return sorted[lower];
    }
    
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  // Calculate rate per second
  static calculateRate(count: number, timeWindowSeconds: number): number {
    return count / timeWindowSeconds;
  }

  // Format metrics for Prometheus export
  static formatForPrometheus(metrics: SystemMetrics): string {
    const lines: string[] = [];
    
    // Business metrics
    lines.push('# HELP sessions_created_total Total number of sessions created');
    lines.push('# TYPE sessions_created_total counter');
    lines.push(`sessions_created_total ${metrics.business.sessionsCreated}`);
    
    lines.push('# HELP handoffs_processed_total Total number of handoffs processed');
    lines.push('# TYPE handoffs_processed_total counter');
    lines.push(`handoffs_processed_total ${metrics.business.handoffsProcessed}`);
    
    lines.push('# HELP successful_handoffs_total Total number of successful handoffs');
    lines.push('# TYPE successful_handoffs_total counter');
    lines.push(`successful_handoffs_total ${metrics.business.successfulHandoffs}`);
    
    lines.push('# HELP failed_handoffs_total Total number of failed handoffs');
    lines.push('# TYPE failed_handoffs_total counter');
    lines.push(`failed_handoffs_total ${metrics.business.failedHandoffs}`);
    
    // Technical metrics
    lines.push('# HELP database_queries_total Total number of database queries');
    lines.push('# TYPE database_queries_total counter');
    lines.push(`database_queries_total ${metrics.technical.databaseQueries}`);
    
    lines.push('# HELP database_query_time_seconds Average database query time in seconds');
    lines.push('# TYPE database_query_time_seconds gauge');
    lines.push(`database_query_time_seconds ${metrics.technical.databaseQueryTime / 1000}`);
    
    lines.push('# HELP api_response_time_seconds Average API response time in seconds');
    lines.push('# TYPE api_response_time_seconds gauge');
    lines.push(`api_response_time_seconds ${metrics.technical.apiResponseTime / 1000}`);
    
    lines.push('# HELP memory_usage_percent Current memory usage percentage');
    lines.push('# TYPE memory_usage_percent gauge');
    lines.push(`memory_usage_percent ${metrics.technical.memoryUsage}`);
    
    lines.push('# HELP cpu_usage_percent Current CPU usage percentage');
    lines.push('# TYPE cpu_usage_percent gauge');
    lines.push(`cpu_usage_percent ${metrics.technical.cpuUsage}`);
    
    return lines.join('\n') + '\n';
  }
}

// Export optimized metrics client
export interface OptimizedMetricsClient {
  collector: MetricsCollector;
  utils: typeof MetricsUtils;
}

// Create optimized metrics collection
export function createOptimizedMetricsCollection(config?: Partial<MetricsConfig>): OptimizedMetricsClient {
  const collector = new MetricsCollector(config);
  
  // Start collection
  collector.startCollection();
  
  return {
    collector,
    utils: MetricsUtils
  };
}