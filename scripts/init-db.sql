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