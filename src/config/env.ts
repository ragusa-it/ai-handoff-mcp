import { z } from 'zod';

export const envSchema = z.object({
  // Database Configuration
  DATABASE_URL: z.string().url(),
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().default(5432),
  DB_NAME: z.string().default('ai_handoff'),
  DB_USER: z.string().default('ai_handoff_user'),
  DB_PASSWORD: z.string(),

  // Redis Configuration
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),

  // Server Configuration
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // MCP Configuration
  MCP_SERVER_NAME: z.string().default('ai-handoff-mcp'),
  MCP_SERVER_VERSION: z.string().default('1.0.0'),

  // Security
  SESSION_SECRET: z.string().min(10),
  JWT_SECRET: z.string().min(10),

  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),

  // Retention Policy Configuration
  RETENTION_SESSION_EXPIRATION_DAYS: z.coerce.number().min(1).max(365).default(30),
  RETENTION_CONTEXT_HISTORY_DAYS: z.coerce.number().min(1).max(365).default(90),
  RETENTION_PERFORMANCE_LOGS_DAYS: z.coerce.number().min(1).max(365).default(30),
  RETENTION_SYSTEM_METRICS_DAYS: z.coerce.number().min(1).max(365).default(90),
  RETENTION_ANALYTICS_AGGREGATION_DAYS: z.coerce.number().min(1).max(730).default(365),
  RETENTION_DORMANT_SESSION_THRESHOLD_DAYS: z.coerce.number().min(1).max(30).default(7),
  RETENTION_ARCHIVE_AFTER_DAYS: z.coerce.number().min(1).max(365).default(90),
  RETENTION_PURGE_ARCHIVED_DAYS: z.coerce.number().min(30).max(2555).default(365),
  RETENTION_ENABLE_AUTO_CLEANUP: z.coerce.boolean().default(true),
  RETENTION_CLEANUP_SCHEDULE_CRON: z.string().default('0 2 * * *'),

  // Monitoring Configuration
  MONITORING_HEALTH_CHECK_INTERVAL: z.coerce.number().min(10).max(3600).default(30),
  MONITORING_METRICS_COLLECTION_INTERVAL: z.coerce.number().min(10).max(3600).default(60),
  MONITORING_PERFORMANCE_TRACKING_ENABLED: z.coerce.boolean().default(true),
  MONITORING_ALERT_THRESHOLD_RESPONSE_TIME: z.coerce.number().min(100).max(30000).default(1000),
  MONITORING_ALERT_THRESHOLD_ERROR_RATE: z.coerce.number().min(0).max(100).default(5),
  MONITORING_ALERT_THRESHOLD_MEMORY_USAGE: z.coerce.number().min(50).max(95).default(80),
  MONITORING_ALERT_THRESHOLD_DISK_USAGE: z.coerce.number().min(50).max(95).default(85),
  MONITORING_ALERT_THRESHOLD_CPU_USAGE: z.coerce.number().min(50).max(95).default(80),
  MONITORING_ALERT_THRESHOLD_SESSION_COUNT: z.coerce.number().min(10).max(10000).default(1000),
  MONITORING_ENABLE_PROMETHEUS_EXPORT: z.coerce.boolean().default(true),
  MONITORING_ENABLE_HEALTH_ENDPOINT: z.coerce.boolean().default(true),
  MONITORING_ENABLE_STRUCTURED_LOGGING: z.coerce.boolean().default(true),
  MONITORING_ENABLE_AUDIT_TRAIL: z.coerce.boolean().default(true),
  MONITORING_ANOMALY_DETECTION_ENABLED: z.coerce.boolean().default(true),
  MONITORING_ANOMALY_SESSION_DURATION_ZSCORE: z.coerce.number().min(1).max(5).default(2.5),
  MONITORING_ANOMALY_CONTEXT_SIZE_ZSCORE: z.coerce.number().min(1).max(5).default(2.5),
  MONITORING_ANOMALY_HANDOFF_FREQUENCY_ZSCORE: z.coerce.number().min(1).max(5).default(2.5),

  // Analytics Configuration
  ANALYTICS_ENABLE_SESSION_ANALYTICS: z.coerce.boolean().default(true),
  ANALYTICS_ENABLE_PERFORMANCE_ANALYTICS: z.coerce.boolean().default(true),
  ANALYTICS_ENABLE_USAGE_ANALYTICS: z.coerce.boolean().default(true),
  ANALYTICS_AGGREGATION_REALTIME: z.coerce.boolean().default(true),
  ANALYTICS_AGGREGATION_HOURLY: z.coerce.boolean().default(true),
  ANALYTICS_AGGREGATION_DAILY: z.coerce.boolean().default(true),
  ANALYTICS_AGGREGATION_WEEKLY: z.coerce.boolean().default(true),
  ANALYTICS_AGGREGATION_MONTHLY: z.coerce.boolean().default(false),
  ANALYTICS_RAW_DATA_RETENTION_DAYS: z.coerce.number().min(1).max(90).default(30),
  ANALYTICS_AGGREGATED_DATA_RETENTION_DAYS: z.coerce.number().min(30).max(730).default(365),
  ANALYTICS_ENABLE_DATA_COMPRESSION: z.coerce.boolean().default(true),
  ANALYTICS_REPORTING_ENABLED: z.coerce.boolean().default(false),
  ANALYTICS_REPORTING_SCHEDULE: z.string().default('0 6 * * 1'),
  ANALYTICS_EXPORT_FORMATS: z.string().default('json'),
  ANALYTICS_ENABLE_TREND_ANALYSIS: z.coerce.boolean().default(true),
  ANALYTICS_ENABLE_PREDICTIVE_ANALYTICS: z.coerce.boolean().default(false),
  ANALYTICS_ML_MODEL_UPDATE_INTERVAL: z.coerce.number().min(1).max(168).default(24),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(): EnvConfig {
  const result = envSchema.safeParse(process.env);
  
  if (!result.success) {
    console.error('❌ Invalid environment configuration:');
    console.error(result.error.flatten().fieldErrors);
    process.exit(1);
  }
  
  return result.data;
}