import dotenv from 'dotenv';
import { validateEnv, type EnvConfig } from './env.js';
import type { RetentionPolicy, MonitoringConfig, AnalyticsConfig } from '../services/configurationManager.js';

// Load environment variables
dotenv.config();

// Validate and export configuration
export const config: EnvConfig = validateEnv();

// Helper function to check if we're in development mode
export const isDevelopment = () => config.NODE_ENV === 'development';
export const isProduction = () => config.NODE_ENV === 'production';
export const isTest = () => config.NODE_ENV === 'test';

// Database configuration object
export const databaseConfig = {
  connectionString: config.DATABASE_URL,
  host: config.DB_HOST,
  port: config.DB_PORT,
  database: config.DB_NAME,
  user: config.DB_USER,
  password: config.DB_PASSWORD,
  ssl: isProduction() ? { rejectUnauthorized: false } : false,
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
};

// Redis configuration object
export const redisConfig = {
  url: config.REDIS_URL,
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  retryDelayOnFailover: 100,
  enableReadyCheck: false,
  maxRetriesPerRequest: null,
};

// MCP server configuration
export const mcpConfig = {
  name: config.MCP_SERVER_NAME,
  version: config.MCP_SERVER_VERSION,
};

// Logging configuration
export const loggingConfig = {
  level: config.LOG_LEVEL,
};

// Load monitoring configuration from environment variables
export function getRetentionPolicyFromEnv(): RetentionPolicy {
  return {
    sessionExpirationDays: config.RETENTION_SESSION_EXPIRATION_DAYS,
    contextHistoryRetentionDays: config.RETENTION_CONTEXT_HISTORY_DAYS,
    performanceLogsRetentionDays: config.RETENTION_PERFORMANCE_LOGS_DAYS,
    systemMetricsRetentionDays: config.RETENTION_SYSTEM_METRICS_DAYS,
    analyticsAggregationRetentionDays: config.RETENTION_ANALYTICS_AGGREGATION_DAYS,
    dormantSessionThresholdDays: config.RETENTION_DORMANT_SESSION_THRESHOLD_DAYS,
    archiveAfterDays: config.RETENTION_ARCHIVE_AFTER_DAYS,
    purgeArchivedAfterDays: config.RETENTION_PURGE_ARCHIVED_DAYS,
    enableAutoCleanup: config.RETENTION_ENABLE_AUTO_CLEANUP,
    cleanupScheduleCron: config.RETENTION_CLEANUP_SCHEDULE_CRON,
  };
}

export function getMonitoringConfigFromEnv(): MonitoringConfig {
  return {
    healthCheckInterval: config.MONITORING_HEALTH_CHECK_INTERVAL,
    metricsCollectionInterval: config.MONITORING_METRICS_COLLECTION_INTERVAL,
    performanceTrackingEnabled: config.MONITORING_PERFORMANCE_TRACKING_ENABLED,
    alertThresholds: {
      responseTime: config.MONITORING_ALERT_THRESHOLD_RESPONSE_TIME,
      errorRate: config.MONITORING_ALERT_THRESHOLD_ERROR_RATE,
      memoryUsage: config.MONITORING_ALERT_THRESHOLD_MEMORY_USAGE,
      diskUsage: config.MONITORING_ALERT_THRESHOLD_DISK_USAGE,
      cpuUsage: config.MONITORING_ALERT_THRESHOLD_CPU_USAGE,
      sessionCount: config.MONITORING_ALERT_THRESHOLD_SESSION_COUNT,
    },
    enablePrometheusExport: config.MONITORING_ENABLE_PROMETHEUS_EXPORT,
    enableHealthEndpoint: config.MONITORING_ENABLE_HEALTH_ENDPOINT,
    enableStructuredLogging: config.MONITORING_ENABLE_STRUCTURED_LOGGING,
    logLevel: config.LOG_LEVEL,
    enableAuditTrail: config.MONITORING_ENABLE_AUDIT_TRAIL,
    anomalyDetectionEnabled: config.MONITORING_ANOMALY_DETECTION_ENABLED,
    anomalyDetectionThresholds: {
      sessionDurationZScore: config.MONITORING_ANOMALY_SESSION_DURATION_ZSCORE,
      contextSizeZScore: config.MONITORING_ANOMALY_CONTEXT_SIZE_ZSCORE,
      handoffFrequencyZScore: config.MONITORING_ANOMALY_HANDOFF_FREQUENCY_ZSCORE,
    },
  };
}

export function getAnalyticsConfigFromEnv(): AnalyticsConfig {
  const exportFormats = config.ANALYTICS_EXPORT_FORMATS.split(',').map(f => f.trim());
  
  return {
    enableSessionAnalytics: config.ANALYTICS_ENABLE_SESSION_ANALYTICS,
    enablePerformanceAnalytics: config.ANALYTICS_ENABLE_PERFORMANCE_ANALYTICS,
    enableUsageAnalytics: config.ANALYTICS_ENABLE_USAGE_ANALYTICS,
    aggregationIntervals: {
      realTime: config.ANALYTICS_AGGREGATION_REALTIME,
      hourly: config.ANALYTICS_AGGREGATION_HOURLY,
      daily: config.ANALYTICS_AGGREGATION_DAILY,
      weekly: config.ANALYTICS_AGGREGATION_WEEKLY,
      monthly: config.ANALYTICS_AGGREGATION_MONTHLY,
    },
    dataRetentionPolicy: {
      rawDataDays: config.ANALYTICS_RAW_DATA_RETENTION_DAYS,
      aggregatedDataDays: config.ANALYTICS_AGGREGATED_DATA_RETENTION_DAYS,
      enableDataCompression: config.ANALYTICS_ENABLE_DATA_COMPRESSION,
    },
    reportingEnabled: config.ANALYTICS_REPORTING_ENABLED,
    reportingSchedule: config.ANALYTICS_REPORTING_SCHEDULE,
    exportFormats: exportFormats as Array<'json' | 'csv' | 'prometheus'>,
    enableTrendAnalysis: config.ANALYTICS_ENABLE_TREND_ANALYSIS,
    enablePredictiveAnalytics: config.ANALYTICS_ENABLE_PREDICTIVE_ANALYTICS,
    mlModelUpdateInterval: config.ANALYTICS_ML_MODEL_UPDATE_INTERVAL,
  };
}

export default config;