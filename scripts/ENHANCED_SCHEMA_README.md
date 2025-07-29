# Enhanced Session Monitoring Schema

This document describes the enhanced database schema implementation for comprehensive session lifecycle management, monitoring capabilities, and operational insights.

## Overview

The enhanced schema builds upon the existing AI Handoff MCP database by adding:
- Session lifecycle tracking with automatic event logging
- System metrics collection and storage
- Performance logging for all operations
- Analytics aggregations for insights
- Enhanced monitoring views for easy querying

## New Database Tables

### 1. session_lifecycle
Tracks all session lifecycle events automatically through database triggers.

**Columns:**
- `id` (UUID) - Primary key
- `session_id` (UUID) - References sessions.id
- `event_type` (VARCHAR) - Event type: 'created', 'expired', 'archived', 'dormant', 'reactivated', 'status_changed'
- `event_data` (JSONB) - Additional event metadata
- `created_at` (TIMESTAMP) - Event timestamp

### 2. system_metrics
Stores system performance and operational metrics.

**Columns:**
- `id` (UUID) - Primary key
- `metric_name` (VARCHAR) - Metric identifier
- `metric_value` (DECIMAL) - Metric value
- `metric_type` (VARCHAR) - Type: 'counter', 'gauge', 'histogram'
- `labels` (JSONB) - Metric labels for filtering
- `recorded_at` (TIMESTAMP) - Recording timestamp

### 3. performance_logs
Records performance data for all system operations.

**Columns:**
- `id` (UUID) - Primary key
- `operation` (VARCHAR) - Operation name
- `duration_ms` (INTEGER) - Operation duration in milliseconds
- `success` (BOOLEAN) - Operation success status
- `session_id` (UUID) - Optional session reference
- `metadata` (JSONB) - Additional operation metadata
- `created_at` (TIMESTAMP) - Log timestamp

### 4. analytics_aggregations
Stores pre-computed analytics data for efficient querying.

**Columns:**
- `id` (UUID) - Primary key
- `aggregation_type` (VARCHAR) - Type: 'session_stats', 'handoff_stats', 'performance_trends'
- `time_bucket` (TIMESTAMP) - Time bucket for aggregation
- `aggregation_data` (JSONB) - Aggregated data
- `created_at` (TIMESTAMP) - Creation timestamp

## Enhanced Existing Tables

### sessions table
Added monitoring columns:
- `last_activity_at` (TIMESTAMP) - Last session activity
- `is_dormant` (BOOLEAN) - Dormant status flag
- `archived_at` (TIMESTAMP) - Archive timestamp
- `retention_policy` (VARCHAR) - Retention policy name

### context_history table
Added performance tracking columns:
- `processing_time_ms` (INTEGER) - Processing time in milliseconds
- `content_size_bytes` (INTEGER) - Content size in bytes

## Database Indexes

Comprehensive indexing strategy for optimal query performance:

### Session Monitoring Indexes
- `idx_sessions_last_activity_at` - For activity-based queries
- `idx_sessions_is_dormant` - For dormant session queries
- `idx_sessions_archived_at` - For archive queries
- `idx_sessions_retention_policy` - For retention policy queries
- `idx_sessions_status_last_activity` - Composite index for status and activity
- `idx_sessions_dormant_last_activity` - Composite index for dormant sessions

### Performance Indexes
- `idx_performance_logs_operation` - For operation-specific queries
- `idx_performance_logs_operation_created_at` - For time-series queries
- `idx_system_metrics_name_recorded_at` - For metric time-series
- `idx_system_metrics_labels` - GIN index for label queries

## Database Triggers

### Automatic Session Lifecycle Logging
- `log_session_lifecycle` trigger automatically logs all session events
- Tracks creation, status changes, dormant state changes, and archival

### Activity Tracking
- `update_sessions_last_activity` trigger updates last_activity_at on session updates
- `update_sessions_updated_at` trigger maintains updated_at timestamps

## Monitoring Views

### session_monitoring_view
Comprehensive view for session monitoring including:
- Session details and status
- Activity metrics (hours since last activity)
- Context and handoff counts
- Last lifecycle event

### performance_monitoring_view
Performance analytics view showing:
- Operation statistics (total calls, success rate)
- Performance metrics (avg, min, max, p95 duration)
- 24-hour rolling window data

## Migration Scripts

### For Existing Databases
- `scripts/migrations/001_enhanced_monitoring_schema.sql` - Migration script
- `scripts/run-migration.sh` - Safe migration runner with backup

### For New Installations
- `scripts/init-enhanced-db.sql` - Complete enhanced schema
- `scripts/setup-enhanced-db.sh` - Database setup script

## Validation

- `scripts/validate-schema.cjs` - Schema validation script
- Validates all required tables, columns, and interfaces
- Ensures schema completeness before deployment

## Usage Examples

### Query Session Activity
```sql
SELECT * FROM session_monitoring_view 
WHERE hours_since_activity > 24 
AND is_dormant = false;
```

### Monitor Performance
```sql
SELECT * FROM performance_monitoring_view 
WHERE success_rate_percent < 95;
```

### Track Session Lifecycle
```sql
SELECT sl.event_type, sl.event_data, sl.created_at
FROM session_lifecycle sl
WHERE sl.session_id = 'your-session-id'
ORDER BY sl.created_at DESC;
```

## Requirements Addressed

This implementation addresses the following requirements:

- **1.1**: Automated session lifecycle management with configurable expiration
- **1.4**: Read-only access to archived session data
- **6.4**: Referential integrity during session lifecycle transitions

## Next Steps

1. Run the migration on existing databases: `./scripts/run-migration.sh`
2. Or setup new database: `./scripts/setup-enhanced-db.sh`
3. Update application code to use new monitoring features
4. Configure retention policies
5. Set up monitoring dashboards using the new views