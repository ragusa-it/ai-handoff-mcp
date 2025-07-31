-- Configuration Management Tables Migration
-- Adds tables for system configuration management, backups, and audit trails

-- System Configuration table
-- Stores the current and historical configurations
CREATE TABLE IF NOT EXISTS system_configuration (
    id SERIAL PRIMARY KEY,
    config_data JSONB NOT NULL,
    version VARCHAR(255) NOT NULL,
    updated_by VARCHAR(255) NOT NULL DEFAULT 'system',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE
);

-- Configuration Backups table
-- Stores metadata about configuration backups
CREATE TABLE IF NOT EXISTS configuration_backups (
    id SERIAL PRIMARY KEY,
    backup_id VARCHAR(255) UNIQUE NOT NULL,
    backup_path TEXT NOT NULL,
    config_version VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    file_size_bytes BIGINT,
    checksum VARCHAR(64)
);

-- Configuration Audit Log table
-- Tracks all configuration changes for compliance and troubleshooting
CREATE TABLE IF NOT EXISTS configuration_audit_log (
    id SERIAL PRIMARY KEY,
    config_version VARCHAR(255) NOT NULL,
    changed_by VARCHAR(255) NOT NULL,
    change_timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    change_type VARCHAR(50) DEFAULT 'update', -- 'create', 'update', 'restore', 'reset'
    config_snapshot JSONB NOT NULL,
    previous_config_snapshot JSONB,
    change_summary JSONB, -- Summary of what changed
    ip_address INET,
    user_agent TEXT
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_system_configuration_version ON system_configuration(version);
CREATE INDEX IF NOT EXISTS idx_system_configuration_created_at ON system_configuration(created_at);
CREATE INDEX IF NOT EXISTS idx_system_configuration_is_active ON system_configuration(is_active);

CREATE INDEX IF NOT EXISTS idx_configuration_backups_backup_id ON configuration_backups(backup_id);
CREATE INDEX IF NOT EXISTS idx_configuration_backups_created_at ON configuration_backups(created_at);
CREATE INDEX IF NOT EXISTS idx_configuration_backups_config_version ON configuration_backups(config_version);

CREATE INDEX IF NOT EXISTS idx_configuration_audit_log_config_version ON configuration_audit_log(config_version);
CREATE INDEX IF NOT EXISTS idx_configuration_audit_log_changed_by ON configuration_audit_log(changed_by);
CREATE INDEX IF NOT EXISTS idx_configuration_audit_log_change_timestamp ON configuration_audit_log(change_timestamp);
CREATE INDEX IF NOT EXISTS idx_configuration_audit_log_change_type ON configuration_audit_log(change_type);

-- GIN indexes for JSONB columns for efficient JSON queries
CREATE INDEX IF NOT EXISTS idx_system_configuration_config_data_gin ON system_configuration USING GIN(config_data);
CREATE INDEX IF NOT EXISTS idx_configuration_audit_config_snapshot_gin ON configuration_audit_log USING GIN(config_snapshot);

-- Triggers for automatic timestamp updates
CREATE OR REPLACE FUNCTION update_configuration_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.created_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply the trigger to system_configuration table
DROP TRIGGER IF EXISTS trigger_update_configuration_timestamp ON system_configuration;
CREATE TRIGGER trigger_update_configuration_timestamp
    BEFORE INSERT ON system_configuration
    FOR EACH ROW
    EXECUTE FUNCTION update_configuration_timestamp();

-- Function to automatically deactivate previous configurations
CREATE OR REPLACE FUNCTION deactivate_previous_configurations()
RETURNS TRIGGER AS $$
BEGIN
    -- Deactivate all previous configurations when a new active one is inserted
    IF NEW.is_active = TRUE THEN
        UPDATE system_configuration 
        SET is_active = FALSE 
        WHERE id != NEW.id AND is_active = TRUE;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply the trigger to ensure only one active configuration
DROP TRIGGER IF EXISTS trigger_deactivate_previous_configurations ON system_configuration;
CREATE TRIGGER trigger_deactivate_previous_configurations
    AFTER INSERT ON system_configuration
    FOR EACH ROW
    EXECUTE FUNCTION deactivate_previous_configurations();

-- View for current active configuration
CREATE OR REPLACE VIEW current_system_configuration AS
SELECT 
    id,
    config_data,
    version,
    updated_by,
    created_at
FROM system_configuration 
WHERE is_active = TRUE 
ORDER BY created_at DESC 
LIMIT 1;

-- View for configuration change history with summary
CREATE OR REPLACE VIEW configuration_change_history AS
SELECT 
    cal.id,
    cal.config_version,
    cal.changed_by,
    cal.change_timestamp,
    cal.change_type,
    cal.change_summary,
    sc.version as current_version,
    sc.created_at as config_created_at
FROM configuration_audit_log cal
LEFT JOIN system_configuration sc ON cal.config_version = sc.version
ORDER BY cal.change_timestamp DESC;

-- View for backup statistics
CREATE OR REPLACE VIEW configuration_backup_stats AS
SELECT 
    COUNT(*) as total_backups,
    MIN(created_at) as oldest_backup,
    MAX(created_at) as newest_backup,
    SUM(file_size_bytes) as total_backup_size_bytes,
    AVG(file_size_bytes) as avg_backup_size_bytes,
    COUNT(DISTINCT config_version) as unique_versions_backed_up
FROM configuration_backups;

-- Insert initial default configuration if none exists
INSERT INTO system_configuration (config_data, version, updated_by, is_active)
SELECT 
    '{
        "retention": {
            "sessionExpirationDays": 30,
            "contextHistoryRetentionDays": 90,
            "performanceLogsRetentionDays": 30,
            "systemMetricsRetentionDays": 90,
            "analyticsAggregationRetentionDays": 365,
            "dormantSessionThresholdDays": 7,
            "archiveAfterDays": 90,
            "purgeArchivedAfterDays": 365,
            "enableAutoCleanup": true,
            "cleanupScheduleCron": "0 2 * * *"
        },
        "monitoring": {
            "healthCheckInterval": 30,
            "metricsCollectionInterval": 60,
            "performanceTrackingEnabled": true,
            "alertThresholds": {
                "responseTime": 1000,
                "errorRate": 5,
                "memoryUsage": 80,
                "diskUsage": 85,
                "cpuUsage": 80,
                "sessionCount": 1000
            },
            "enablePrometheusExport": true,
            "enableHealthEndpoint": true,
            "enableStructuredLogging": true,
            "logLevel": "info",
            "enableAuditTrail": true,
            "anomalyDetectionEnabled": true,
            "anomalyDetectionThresholds": {
                "sessionDurationZScore": 2.5,
                "contextSizeZScore": 2.5,
                "handoffFrequencyZScore": 2.5
            }
        },
        "analytics": {
            "enableSessionAnalytics": true,
            "enablePerformanceAnalytics": true,
            "enableUsageAnalytics": true,
            "aggregationIntervals": {
                "realTime": true,
                "hourly": true,
                "daily": true,
                "weekly": true,
                "monthly": false
            },
            "dataRetentionPolicy": {
                "rawDataDays": 30,
                "aggregatedDataDays": 365,
                "enableDataCompression": true
            },
            "reportingEnabled": false,
            "reportingSchedule": "0 6 * * 1",
            "exportFormats": ["json"],
            "enableTrendAnalysis": true,
            "enablePredictiveAnalytics": false,
            "mlModelUpdateInterval": 24
        },
        "version": "1.0.0",
        "lastUpdated": "' || CURRENT_TIMESTAMP || '",
        "updatedBy": "migration"
    }'::jsonb,
    '1.0.0',
    'migration',
    true
WHERE NOT EXISTS (SELECT 1 FROM system_configuration LIMIT 1);

-- Log the initial configuration creation
INSERT INTO configuration_audit_log (config_version, changed_by, change_type, config_snapshot)
SELECT 
    '1.0.0',
    'migration',
    'create',
    config_data
FROM system_configuration 
WHERE version = '1.0.0' AND updated_by = 'migration'
ON CONFLICT DO NOTHING;

-- Add comments for documentation
COMMENT ON TABLE system_configuration IS 'Stores system configuration with versioning and activation status';
COMMENT ON TABLE configuration_backups IS 'Metadata for configuration backup files stored on filesystem';
COMMENT ON TABLE configuration_audit_log IS 'Complete audit trail of all configuration changes';

COMMENT ON COLUMN system_configuration.config_data IS 'Complete configuration as JSONB including retention, monitoring, and analytics settings';
COMMENT ON COLUMN system_configuration.version IS 'Semantic version of the configuration (e.g., 1.2.3)';
COMMENT ON COLUMN system_configuration.is_active IS 'Only one configuration should be active at a time';

COMMENT ON COLUMN configuration_backups.backup_id IS 'Unique identifier for the backup (used for restore operations)';
COMMENT ON COLUMN configuration_backups.backup_path IS 'File system path to the backup file';
COMMENT ON COLUMN configuration_backups.checksum IS 'SHA-256 checksum of the backup file for integrity verification';

COMMENT ON COLUMN configuration_audit_log.change_summary IS 'JSON summary of what specific fields were changed';
COMMENT ON COLUMN configuration_audit_log.previous_config_snapshot IS 'Previous configuration state for comparison';

COMMENT ON VIEW current_system_configuration IS 'Always returns the currently active system configuration';
COMMENT ON VIEW configuration_change_history IS 'Historical view of all configuration changes with metadata';
COMMENT ON VIEW configuration_backup_stats IS 'Statistics about configuration backups';

-- Grant appropriate permissions (adjust based on your user setup)
-- GRANT SELECT, INSERT, UPDATE ON system_configuration TO ai_handoff_user;
-- GRANT SELECT, INSERT ON configuration_backups TO ai_handoff_user;
-- GRANT SELECT, INSERT ON configuration_audit_log TO ai_handoff_user;
-- GRANT SELECT ON current_system_configuration TO ai_handoff_user;
-- GRANT SELECT ON configuration_change_history TO ai_handoff_user;
-- GRANT SELECT ON configuration_backup_stats TO ai_handoff_user;