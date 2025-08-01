// Type definitions for metrics collection
export interface BusinessMetrics {
  sessionsCreated: number;
  sessionsCompleted: number;
  handoffsProcessed: number;
  contextEntriesAdded: number;
  toolCallsMade: number;
  userInteractions: number;
  successfulHandoffs: number;
  failedHandoffs: number;
  averageHandoffTime: number;
  averageContextSize: number;
}

export interface TechnicalMetrics {
  databaseQueries: number;
  databaseQueryTime: number;
  databaseErrors: number;
  redisOperations: number;
  redisOperationTime: number;
  redisErrors: number;
  apiRequests: number;
  apiResponseTime: number;
  apiErrors: number;
  memoryUsage: number;
  cpuUsage: number;
  activeConnections: number;
  cacheHits: number;
  cacheMisses: number;
}

export interface SystemMetrics {
  uptime: number;
  timestamp: Date;
  business: BusinessMetrics;
  technical: TechnicalMetrics;
}

export interface MetricsConfig {
  collectionInterval: number;
  retentionPeriod: number;
  enablePrometheusExport: boolean;
  prometheusPort: number;
  enableAlerting: boolean;
  alertThresholds: AlertThresholds;
}

export interface AlertThresholds {
  maxResponseTime: number; // milliseconds
  maxErrorRate: number; // percentage
  maxDatabaseLatency: number; // milliseconds
  maxDatabaseErrors: number; // count
  maxApiErrors: number; // count
  maxMemoryUsage: number; // percentage
  maxCpuUsage: number; // percentage
}

export interface MetricAlert {
  type: 'HIGH_RESPONSE_TIME' | 'HIGH_ERROR_RATE' | 'HIGH_DATABASE_LATENCY' | 'HIGH_MEMORY_USAGE' | 'HIGH_CPU_USAGE';
  severity: 'WARNING' | 'CRITICAL';
  message: string;
  timestamp: Date;
  value: number;
  threshold: number;
}