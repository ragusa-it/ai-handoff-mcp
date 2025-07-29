-- AI Handoff MCP Database Schema

-- Sessions table to track active handoff sessions
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_key VARCHAR(255) UNIQUE NOT NULL,
    agent_from VARCHAR(100) NOT NULL,
    agent_to VARCHAR(100),
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Context history table to store conversation and context data
CREATE TABLE IF NOT EXISTS context_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    sequence_number INTEGER NOT NULL,
    context_type VARCHAR(50) NOT NULL, -- 'message', 'file', 'tool_call', 'system'
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(session_id, sequence_number)
);

-- Codebase snapshots table for storing code analysis results
CREATE TABLE IF NOT EXISTS codebase_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    file_path VARCHAR(500) NOT NULL,
    content_hash VARCHAR(64) NOT NULL,
    content TEXT,
    analysis_result JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Handoff requests table for tracking handoff attempts
CREATE TABLE IF NOT EXISTS handoff_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    requesting_agent VARCHAR(100) NOT NULL,
    target_agent VARCHAR(100),
    request_type VARCHAR(50) NOT NULL DEFAULT 'context_transfer',
    request_data JSONB DEFAULT '{}'::jsonb,
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'accepted', 'rejected', 'completed'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_sessions_session_key ON sessions(session_key);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at);

CREATE INDEX IF NOT EXISTS idx_context_history_session_id ON context_history(session_id);
CREATE INDEX IF NOT EXISTS idx_context_history_sequence ON context_history(session_id, sequence_number);
CREATE INDEX IF NOT EXISTS idx_context_history_created_at ON context_history(created_at);

CREATE INDEX IF NOT EXISTS idx_codebase_snapshots_session_id ON codebase_snapshots(session_id);
CREATE INDEX IF NOT EXISTS idx_codebase_snapshots_file_path ON codebase_snapshots(file_path);

CREATE INDEX IF NOT EXISTS idx_handoff_requests_session_id ON handoff_requests(session_id);
CREATE INDEX IF NOT EXISTS idx_handoff_requests_status ON handoff_requests(status);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to automatically update updated_at
CREATE TRIGGER update_sessions_updated_at 
    BEFORE UPDATE ON sessions 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enhanced monitoring tables (Task 4.2)

-- Add enhanced monitoring fields to existing tables
ALTER TABLE sessions 
ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS is_dormant BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS retention_policy VARCHAR(50) DEFAULT 'standard';

ALTER TABLE context_history 
ADD COLUMN IF NOT EXISTS processing_time_ms INTEGER,
ADD COLUMN IF NOT EXISTS content_size_bytes INTEGER;

-- Session lifecycle events table
CREATE TABLE IF NOT EXISTS session_lifecycle (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    event_data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- System metrics table
CREATE TABLE IF NOT EXISTS system_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    metric_name VARCHAR(100) NOT NULL,
    metric_value DECIMAL NOT NULL,
    metric_type VARCHAR(50) NOT NULL,
    labels JSONB DEFAULT '{}'::jsonb,
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Performance logs table
CREATE TABLE IF NOT EXISTS performance_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation VARCHAR(100) NOT NULL,
    duration_ms INTEGER NOT NULL,
    success BOOLEAN NOT NULL,
    session_id UUID REFERENCES sessions(id),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Analytics aggregations table
CREATE TABLE IF NOT EXISTS analytics_aggregations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregation_type VARCHAR(50) NOT NULL,
    time_bucket TIMESTAMP WITH TIME ZONE NOT NULL,
    aggregation_data JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enhanced monitoring indexes
CREATE INDEX IF NOT EXISTS idx_sessions_last_activity_at ON sessions(last_activity_at);
CREATE INDEX IF NOT EXISTS idx_sessions_is_dormant ON sessions(is_dormant);
CREATE INDEX IF NOT EXISTS idx_sessions_archived_at ON sessions(archived_at);
CREATE INDEX IF NOT EXISTS idx_sessions_retention_policy ON sessions(retention_policy);
CREATE INDEX IF NOT EXISTS idx_sessions_status_last_activity ON sessions(status, last_activity_at);
CREATE INDEX IF NOT EXISTS idx_sessions_dormant_last_activity ON sessions(is_dormant, last_activity_at);

CREATE INDEX IF NOT EXISTS idx_context_history_processing_time ON context_history(processing_time_ms);
CREATE INDEX IF NOT EXISTS idx_context_history_content_size ON context_history(content_size_bytes);

CREATE INDEX IF NOT EXISTS idx_session_lifecycle_session_id ON session_lifecycle(session_id);
CREATE INDEX IF NOT EXISTS idx_session_lifecycle_event_type ON session_lifecycle(event_type);
CREATE INDEX IF NOT EXISTS idx_session_lifecycle_created_at ON session_lifecycle(created_at);

CREATE INDEX IF NOT EXISTS idx_system_metrics_name ON system_metrics(metric_name);
CREATE INDEX IF NOT EXISTS idx_system_metrics_recorded_at ON system_metrics(recorded_at);
CREATE INDEX IF NOT EXISTS idx_system_metrics_name_recorded_at ON system_metrics(metric_name, recorded_at);
CREATE INDEX IF NOT EXISTS idx_system_metrics_labels ON system_metrics USING GIN(labels);

CREATE INDEX IF NOT EXISTS idx_performance_logs_operation ON performance_logs(operation);
CREATE INDEX IF NOT EXISTS idx_performance_logs_session_id ON performance_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_performance_logs_created_at ON performance_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_performance_logs_success ON performance_logs(success);
CREATE INDEX IF NOT EXISTS idx_performance_logs_operation_created_at ON performance_logs(operation, created_at);

CREATE INDEX IF NOT EXISTS idx_analytics_aggregations_type ON analytics_aggregations(aggregation_type);
CREATE INDEX IF NOT EXISTS idx_analytics_aggregations_time_bucket ON analytics_aggregations(time_bucket);
CREATE INDEX IF NOT EXISTS idx_analytics_aggregations_type_time_bucket ON analytics_aggregations(aggregation_type, time_bucket);

-- Enhanced monitoring triggers

-- Function to automatically update last_activity_at when sessions are updated
CREATE OR REPLACE FUNCTION update_last_activity_at()
RETURNS TRIGGER AS $
BEGIN
    NEW.last_activity_at = NOW();
    RETURN NEW;
END;
$ language 'plpgsql';

-- Trigger to automatically update last_activity_at on session updates
DROP TRIGGER IF EXISTS update_sessions_last_activity ON sessions;
CREATE TRIGGER update_sessions_last_activity 
    BEFORE UPDATE ON sessions 
    FOR EACH ROW EXECUTE FUNCTION update_last_activity_at();

-- Function to automatically log session lifecycle events
CREATE OR REPLACE FUNCTION log_session_lifecycle_event()
RETURNS TRIGGER AS $
BEGIN
    -- Log creation event
    IF TG_OP = 'INSERT' THEN
        INSERT INTO session_lifecycle (session_id, event_type, event_data)
        VALUES (NEW.id, 'created', jsonb_build_object(
            'agent_from', NEW.agent_from,
            'agent_to', NEW.agent_to,
            'retention_policy', NEW.retention_policy
        ));
        RETURN NEW;
    END IF;
    
    -- Log status changes and other significant updates
    IF TG_OP = 'UPDATE' THEN
        -- Log status changes
        IF OLD.status != NEW.status THEN
            INSERT INTO session_lifecycle (session_id, event_type, event_data)
            VALUES (NEW.id, 'status_changed', jsonb_build_object(
                'old_status', OLD.status,
                'new_status', NEW.status
            ));
        END IF;
        
        -- Log dormant state changes
        IF OLD.is_dormant != NEW.is_dormant THEN
            INSERT INTO session_lifecycle (session_id, event_type, event_data)
            VALUES (NEW.id, 
                CASE WHEN NEW.is_dormant THEN 'dormant' ELSE 'reactivated' END,
                jsonb_build_object('previous_state', OLD.is_dormant)
            );
        END IF;
        
        -- Log archival
        IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN
            INSERT INTO session_lifecycle (session_id, event_type, event_data)
            VALUES (NEW.id, 'archived', jsonb_build_object(
                'archived_at', NEW.archived_at,
                'final_status', NEW.status
            ));
        END IF;
        
        RETURN NEW;
    END IF;
    
    RETURN NULL;
END;
$ language 'plpgsql';

-- Trigger to automatically log session lifecycle events
DROP TRIGGER IF EXISTS log_session_lifecycle ON sessions;
CREATE TRIGGER log_session_lifecycle
    AFTER INSERT OR UPDATE ON sessions
    FOR EACH ROW EXECUTE FUNCTION log_session_lifecycle_event();

-- Monitoring views for easy querying

-- Create a view for easy session monitoring
CREATE OR REPLACE VIEW session_monitoring_view AS
SELECT 
    s.id,
    s.session_key,
    s.agent_from,
    s.agent_to,
    s.status,
    s.created_at,
    s.updated_at,
    s.last_activity_at,
    s.is_dormant,
    s.archived_at,
    s.retention_policy,
    s.expires_at,
    EXTRACT(EPOCH FROM (NOW() - s.last_activity_at))/3600 as hours_since_activity,
    (SELECT COUNT(*) FROM context_history ch WHERE ch.session_id = s.id) as context_entries,
    (SELECT COUNT(*) FROM handoff_requests hr WHERE hr.session_id = s.id) as handoff_requests,
    (SELECT event_type FROM session_lifecycle sl WHERE sl.session_id = s.id ORDER BY sl.created_at DESC LIMIT 1) as last_lifecycle_event
FROM sessions s;

-- Create a view for performance monitoring
CREATE OR REPLACE VIEW performance_monitoring_view AS
SELECT 
    operation,
    COUNT(*) as total_calls,
    AVG(duration_ms) as avg_duration_ms,
    MIN(duration_ms) as min_duration_ms,
    MAX(duration_ms) as max_duration_ms,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) as p95_duration_ms,
    COUNT(*) FILTER (WHERE success = true) as successful_calls,
    COUNT(*) FILTER (WHERE success = false) as failed_calls,
    (COUNT(*) FILTER (WHERE success = true) * 100.0 / COUNT(*)) as success_rate_percent
FROM performance_logs
WHERE created_at >= NOW() - INTERVAL '24 hours'
GROUP BY operation
ORDER BY total_calls DESC;