export interface Session {
  id: string;
  sessionKey: string;
  agentFrom: string;
  agentTo?: string;
  status: 'active' | 'completed' | 'expired' | 'cancelled';
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
  metadata: Record<string, any>;
  // Enhanced monitoring fields
  lastActivityAt: Date;
  isDormant: boolean;
  archivedAt?: Date;
  retentionPolicy: string;
}

export interface ContextHistoryEntry {
  id: string;
  sessionId: string;
  sequenceNumber: number;
  contextType: 'message' | 'file' | 'tool_call' | 'system';
  content: string;
  metadata: Record<string, any>;
  createdAt: Date;
  // Enhanced monitoring fields
  processingTimeMs?: number;
  contentSizeBytes?: number;
}

export interface CodebaseSnapshot {
  id: string;
  sessionId: string;
  filePath: string;
  contentHash: string;
  content?: string;
  analysisResult: Record<string, any>;
  createdAt: Date;
}

export interface HandoffRequest {
  id: string;
  sessionId: string;
  requestingAgent: string;
  targetAgent?: string;
  requestType: 'context_transfer' | 'full_handoff' | 'collaboration';
  requestData: Record<string, any>;
  status: 'pending' | 'accepted' | 'rejected' | 'completed';
  createdAt: Date;
  completedAt?: Date;
}

// Enhanced error handling and recovery interfaces
export interface RecoveryCheckpoint {
  id: string;
  sessionId: string;
  checkpointId: string;
  timestamp: Date;
  sessionState: string; // JSON
  contextSnapshot: string; // JSON
  metadata: Record<string, any>;
  dataIntegrity: string; // JSON
}

export interface RecoveryBackup {
  id: string;
  backupId: string;
  sessionId: string;
  timestamp: Date;
  sessionData: string; // JSON
  contextData: string; // JSON
}
}

// New monitoring interfaces
export interface SessionLifecycleEvent {
  id: string;
  sessionId: string;
  eventType: 'created' | 'expired' | 'archived' | 'dormant' | 'reactivated' | 'status_changed';
  eventData: Record<string, any>;
  createdAt: Date;
}

export interface SystemMetric {
  id: string;
  metricName: string;
  metricValue: number;
  metricType: 'counter' | 'gauge' | 'histogram';
  labels: Record<string, any>;
  recordedAt: Date;
}

export interface PerformanceLog {
  id: string;
  operation: string;
  durationMs: number;
  success: boolean;
  sessionId?: string;
  metadata: Record<string, any>;
  createdAt: Date;
}

export interface AnalyticsAggregation {
  id: string;
  aggregationType: 'session_stats' | 'handoff_stats' | 'performance_trends';
  timeBucket: Date;
  aggregationData: Record<string, any>;
  createdAt: Date;
}

// Database table creation SQL
export const createSessionsTable = `
  CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_key VARCHAR(255) UNIQUE NOT NULL,
    agent_from VARCHAR(100) NOT NULL,
    agent_to VARCHAR(100),
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB DEFAULT '{}'::jsonb,
    last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_dormant BOOLEAN DEFAULT FALSE,
    archived_at TIMESTAMP WITH TIME ZONE,
    retention_policy VARCHAR(50) DEFAULT 'standard'
  );
`;

export const createContextHistoryTable = `
  CREATE TABLE IF NOT EXISTS context_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    sequence_number INTEGER NOT NULL,
    context_type VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    processing_time_ms INTEGER,
    content_size_bytes INTEGER,
    UNIQUE(session_id, sequence_number)
  );
`;

export const createCodebaseSnapshotsTable = `
  CREATE TABLE IF NOT EXISTS codebase_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    file_path VARCHAR(500) NOT NULL,
    content_hash VARCHAR(64) NOT NULL,
    content TEXT,
    analysis_result JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );
`;

export const createHandoffRequestsTable = `
  CREATE TABLE IF NOT EXISTS handoff_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    requesting_agent VARCHAR(100) NOT NULL,
    target_agent VARCHAR(100),
    request_type VARCHAR(50) NOT NULL DEFAULT 'context_transfer',
    request_data JSONB DEFAULT '{}'::jsonb,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
  );
`;

// New monitoring tables
export const createSessionLifecycleTable = `
  CREATE TABLE IF NOT EXISTS session_lifecycle (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    event_data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );
`;

export const createSystemMetricsTable = `
  CREATE TABLE IF NOT EXISTS system_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    metric_name VARCHAR(100) NOT NULL,
    metric_value DECIMAL NOT NULL,
    metric_type VARCHAR(50) NOT NULL,
    labels JSONB DEFAULT '{}'::jsonb,
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );
`;

export const createPerformanceLogsTable = `
  CREATE TABLE IF NOT EXISTS performance_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation VARCHAR(100) NOT NULL,
    duration_ms INTEGER NOT NULL,
    success BOOLEAN NOT NULL,
    session_id UUID REFERENCES sessions(id),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );
`;

export const createAnalyticsAggregationsTable = `
  CREATE TABLE IF NOT EXISTS analytics_aggregations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregation_type VARCHAR(50) NOT NULL,
    time_bucket TIMESTAMP WITH TIME ZONE NOT NULL,
    aggregation_data JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );
`;

export const createIndexes = `
  -- Existing indexes
  CREATE INDEX IF NOT EXISTS idx_sessions_session_key ON sessions(session_key);
  CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
  CREATE INDEX IF NOT EXISTS idx_context_history_session_id ON context_history(session_id);
  CREATE INDEX IF NOT EXISTS idx_context_history_sequence ON context_history(session_id, sequence_number);
  CREATE INDEX IF NOT EXISTS idx_codebase_snapshots_session_id ON codebase_snapshots(session_id);
  CREATE INDEX IF NOT EXISTS idx_handoff_requests_session_id ON handoff_requests(session_id);
  
  -- Enhanced monitoring indexes for existing tables
  CREATE INDEX IF NOT EXISTS idx_sessions_last_activity_at ON sessions(last_activity_at);
  CREATE INDEX IF NOT EXISTS idx_sessions_is_dormant ON sessions(is_dormant);
  CREATE INDEX IF NOT EXISTS idx_sessions_archived_at ON sessions(archived_at);
  CREATE INDEX IF NOT EXISTS idx_sessions_retention_policy ON sessions(retention_policy);
  CREATE INDEX IF NOT EXISTS idx_sessions_status_last_activity ON sessions(status, last_activity_at);
  CREATE INDEX IF NOT EXISTS idx_sessions_dormant_last_activity ON sessions(is_dormant, last_activity_at);
  
  CREATE INDEX IF NOT EXISTS idx_context_history_processing_time ON context_history(processing_time_ms);
  CREATE INDEX IF NOT EXISTS idx_context_history_content_size ON context_history(content_size_bytes);
  
  -- New monitoring table indexes
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
`;

export const createTriggers = `
  CREATE OR REPLACE FUNCTION update_updated_at_column()
  RETURNS TRIGGER AS $$
  BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
  END;
  $$ language 'plpgsql';

  DROP TRIGGER IF EXISTS update_sessions_updated_at ON sessions;
  CREATE TRIGGER update_sessions_updated_at 
      BEFORE UPDATE ON sessions 
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
`;

// Enhanced monitoring triggers
export const createEnhancedTriggers = `
  -- Function to automatically update last_activity_at when sessions are updated
  CREATE OR REPLACE FUNCTION update_last_activity_at()
  RETURNS TRIGGER AS $$
  BEGIN
      NEW.last_activity_at = NOW();
      RETURN NEW;
  END;
  $$ language 'plpgsql';

  -- Trigger to automatically update last_activity_at on session updates
  DROP TRIGGER IF EXISTS update_sessions_last_activity ON sessions;
  CREATE TRIGGER update_sessions_last_activity 
      BEFORE UPDATE ON sessions 
      FOR EACH ROW EXECUTE FUNCTION update_last_activity_at();

  -- Function to automatically log session lifecycle events
  CREATE OR REPLACE FUNCTION log_session_lifecycle_event()
  RETURNS TRIGGER AS $$
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
  $$ language 'plpgsql';

  -- Trigger to automatically log session lifecycle events
  DROP TRIGGER IF EXISTS log_session_lifecycle ON sessions;
  CREATE TRIGGER log_session_lifecycle
      AFTER INSERT OR UPDATE ON sessions
      FOR EACH ROW EXECUTE FUNCTION log_session_lifecycle_event();
`;

// Monitoring views for easy querying
export const createMonitoringViews = `
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
`;

// Recovery checkpoint table
export const createRecoveryCheckpointsTable = `
  CREATE TABLE IF NOT EXISTS recovery_checkpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL,
    checkpoint_id VARCHAR(255) NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    session_state JSONB NOT NULL,
    context_snapshot JSONB NOT NULL,
    metadata JSONB DEFAULT '{}',
    data_integrity JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    UNIQUE(session_id, checkpoint_id)
  );
  
  -- Indexes for recovery checkpoints
  CREATE INDEX IF NOT EXISTS idx_recovery_checkpoints_session_id ON recovery_checkpoints(session_id);
  CREATE INDEX IF NOT EXISTS idx_recovery_checkpoints_timestamp ON recovery_checkpoints(timestamp);
  CREATE INDEX IF NOT EXISTS idx_recovery_checkpoints_session_timestamp ON recovery_checkpoints(session_id, timestamp DESC);
`;

// Recovery backup table
export const createRecoveryBackupsTable = `
  CREATE TABLE IF NOT EXISTS recovery_backups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    backup_id VARCHAR(255) NOT NULL UNIQUE,
    session_id UUID NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    session_data JSONB NOT NULL,
    context_data JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
  );
  
  -- Indexes for recovery backups
  CREATE INDEX IF NOT EXISTS idx_recovery_backups_session_id ON recovery_backups(session_id);
  CREATE INDEX IF NOT EXISTS idx_recovery_backups_timestamp ON recovery_backups(timestamp);
`;