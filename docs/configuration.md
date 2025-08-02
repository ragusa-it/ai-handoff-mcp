# Configuration

This page documents all configuration settings, defaults, environment variables, and sample configs. It maps directly to the runtime schema in src/config/env.ts and references .env.example and docker-compose overrides.

Overview
- Configuration sources
  - Environment variables .env, CI/CD injected
  - Docker Compose environment sections
- Validation
  - All variables are validated at startup by a Zod schema see src/config/env.ts
  - On invalid configuration the process exits with a descriptive error
- Reloading
  - Runtime updates via MCP tools getConfiguration, updateConfiguration, manageConfigurationBackup
  - Some changes may require restart

Environment Variables

Server
- PORT number, default 3000
- NODE_ENV development, production, test default development
- MCP_SERVER_NAME default ai-handoff-mcp
- MCP_SERVER_VERSION default 1.0.0

Database
- DATABASE_URL required Postgres URL
- DB_HOST default localhost
- DB_PORT default 5432
- DB_NAME default ai_handoff
- DB_USER default ai_handoff_user
- DB_PASSWORD required

Redis
- REDIS_URL default redis://localhost:6379
- REDIS_HOST default localhost
- REDIS_PORT default 6379

Security
- SESSION_SECRET required min length 10
- JWT_SECRET required min length 10

Logging
- LOG_LEVEL error, warn, info, debug default info

Retention and Lifecycle
- RETENTION_SESSION_EXPIRATION_DAYS default 30
- RETENTION_CONTEXT_HISTORY_DAYS default 90
- RETENTION_PERFORMANCE_LOGS_DAYS default 30
- RETENTION_SYSTEM_METRICS_DAYS default 90
- RETENTION_ANALYTICS_AGGREGATION_DAYS default 365
- RETENTION_DORMANT_SESSION_THRESHOLD_DAYS default 7
- RETENTION_ARCHIVE_AFTER_DAYS default 90
- RETENTION_PURGE_ARCHIVED_DAYS default 365
- RETENTION_ENABLE_AUTO_CLEANUP default true
- RETENTION_CLEANUP_SCHEDULE_CRON default 0 2 * * *

Monitoring and Metrics
- MONITORING_HEALTH_CHECK_INTERVAL default 30 seconds
- MONITORING_METRICS_COLLECTION_INTERVAL default 60 seconds
- MONITORING_PERFORMANCE_TRACKING_ENABLED default true
- MONITORING_ALERT_THRESHOLD_RESPONSE_TIME default 1000 ms
- MONITORING_ALERT_THRESHOLD_ERROR_RATE default 5 percent
- MONITORING_ALERT_THRESHOLD_MEMORY_USAGE default 80 percent
- MONITORING_ALERT_THRESHOLD_DISK_USAGE default 85 percent
- MONITORING_ALERT_THRESHOLD_CPU_USAGE default 80 percent
- MONITORING_ALERT_THRESHOLD_SESSION_COUNT default 1000
- MONITORING_ENABLE_PROMETHEUS_EXPORT default true
- MONITORING_ENABLE_HEALTH_ENDPOINT default true
- MONITORING_ENABLE_STRUCTURED_LOGGING default true
- MONITORING_ENABLE_AUDIT_TRAIL default true
- MONITORING_ANOMALY_DETECTION_ENABLED default true
- MONITORING_ANOMALY_SESSION_DURATION_ZSCORE default 2.5
- MONITORING_ANOMALY_CONTEXT_SIZE_ZSCORE default 2.5
- MONITORING_ANOMALY_HANDOFF_FREQUENCY_ZSCORE default 2.5

Analytics
- ANALYTICS_ENABLE_SESSION_ANALYTICS default true
- ANALYTICS_ENABLE_PERFORMANCE_ANALYTICS default true
- ANALYTICS_ENABLE_USAGE_ANALYTICS default true
- ANALYTICS_AGGREGATION_REALTIME default true
- ANALYTICS_AGGREGATION_HOURLY default true
- ANALYTICS_AGGREGATION_DAILY default true
- ANALYTICS_AGGREGATION_WEEKLY default true
- ANALYTICS_AGGREGATION_MONTHLY default false
- ANALYTICS_RAW_DATA_RETENTION_DAYS default 30
- ANALYTICS_AGGREGATED_DATA_RETENTION_DAYS default 365
- ANALYTICS_ENABLE_DATA_COMPRESSION default true
- ANALYTICS_REPORTING_ENABLED default false
- ANALYTICS_REPORTING_SCHEDULE default 0 6 * * 1
- ANALYTICS_EXPORT_FORMATS default json
- ANALYTICS_ENABLE_TREND_ANALYSIS default true
- ANALYTICS_ENABLE_PREDICTIVE_ANALYTICS default false
- ANALYTICS_ML_MODEL_UPDATE_INTERVAL default 24 hours

Reference Files
- .env.example provides a comprehensive template with safe defaults
- docker-compose.yml includes Postgres and Redis services with named volumes

Sample .env production snippet
```env
NODE_ENV=production
PORT=3000

# Database
DATABASE_URL=postgresql://handoff_user:strong-password@postgres:5432/ai_handoff
DB_PASSWORD=strong-password

# Redis
REDIS_URL=redis://redis:6379

# Security
SESSION_SECRET=please-change-me-super-long-random
JWT_SECRET=please-change-me-super-long-random

# Logging and Metrics
LOG_LEVEL=info
MONITORING_ENABLE_PROMETHEUS_EXPORT=true
MONITORING_HEALTH_CHECK_INTERVAL=30
```

Docker Compose overrides example
```yaml
services:
  handoff-server:
    image: your-repo/ai-handoff-mcp:latest
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://handoff_user:${DB_PASSWORD}@postgres:5432/ai_handoff
      REDIS_URL: redis://redis:6379
      LOG_LEVEL: info
      MONITORING_ENABLE_PROMETHEUS_EXPORT: true
    depends_on:
      - postgres
      - redis
    ports:
      - 3000:3000
    restart: unless-stopped
```

Runtime Configuration via Tools
- getConfiguration read snapshot or selected keys
- updateConfiguration validate and apply changes optionally validateOnly
- manageConfigurationBackup create, list, restore configuration snapshots

Mappings
- Validation schema and defaults are defined in src/config/env.ts
- Example values and ranges are mirrored in .env.example

Related
- Usage Configuration Tools: ./usage/configuration.md
- Deployment: ./deployment.md
- API Reference: ./api-reference.md