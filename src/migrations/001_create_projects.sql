-- Migration: 001_create_projects.sql
-- Description: Create projects table with git integration and configuration support
-- Created: 2025-08-02

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create projects table
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    repo_path TEXT NOT NULL UNIQUE,
    config JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX idx_projects_name ON projects USING gin(to_tsvector('english', name));
CREATE INDEX idx_projects_description ON projects USING gin(to_tsvector('english', description)) WHERE description IS NOT NULL;
CREATE INDEX idx_projects_repo_path ON projects(repo_path);
CREATE INDEX idx_projects_created_at ON projects(created_at);
CREATE INDEX idx_projects_updated_at ON projects(updated_at);

-- Create GIN index for JSONB config field for fast config queries
CREATE INDEX idx_projects_config ON projects USING gin(config);

-- Create specific functional indexes for common config queries
CREATE INDEX idx_projects_git_auto_scan ON projects((config->'git'->>'auto_scan_enabled')) WHERE config->'git'->>'auto_scan_enabled' IS NOT NULL;
CREATE INDEX idx_projects_memory_search ON projects((config->'memory'->>'semantic_search_enabled')) WHERE config->'memory'->>'semantic_search_enabled' IS NOT NULL;

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to automatically update updated_at on row changes
CREATE TRIGGER update_projects_updated_at 
    BEFORE UPDATE ON projects 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE projects IS 'Core projects table for git-integrated memory system';
COMMENT ON COLUMN projects.id IS 'Unique project identifier (UUID)';
COMMENT ON COLUMN projects.name IS 'Human-readable project name';
COMMENT ON COLUMN projects.description IS 'Optional project description';
COMMENT ON COLUMN projects.repo_path IS 'Absolute path to git repository (must be unique)';
COMMENT ON COLUMN projects.config IS 'Project configuration as JSONB (memory, steering, handoff, collaboration, git settings)';
COMMENT ON COLUMN projects.created_at IS 'Project creation timestamp';
COMMENT ON COLUMN projects.updated_at IS 'Last modification timestamp (automatically updated)';

-- Create validation function for repo_path format
CREATE OR REPLACE FUNCTION validate_repo_path(path TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    -- Basic validation: must be absolute path and not empty
    RETURN path IS NOT NULL 
           AND LENGTH(TRIM(path)) > 0 
           AND path ~ '^/.*'  -- Must start with / (absolute path)
           AND path !~ '\.\./'; -- No parent directory references for security
END;
$$ LANGUAGE plpgsql;

-- Add check constraint for repo_path validation
ALTER TABLE projects ADD CONSTRAINT check_valid_repo_path 
    CHECK (validate_repo_path(repo_path));

-- Add check constraint for non-empty name
ALTER TABLE projects ADD CONSTRAINT check_non_empty_name 
    CHECK (LENGTH(TRIM(name)) > 0);

-- Create function to validate config JSONB structure
CREATE OR REPLACE FUNCTION validate_project_config(config JSONB)
RETURNS BOOLEAN AS $$
BEGIN
    -- Allow empty config
    IF config IS NULL OR config = '{}'::jsonb THEN
        RETURN TRUE;
    END IF;
    
    -- Validate that if sections exist, they have expected structure
    -- This is a basic validation - more detailed validation happens in application code
    
    -- Check memory config section
    IF config ? 'memory' THEN
        IF NOT (config->'memory' ? 'semantic_search_enabled' AND 
                jsonb_typeof(config->'memory'->'semantic_search_enabled') = 'boolean') THEN
            -- Allow missing fields, they have defaults
        END IF;
    END IF;
    
    -- Check git config section
    IF config ? 'git' THEN
        IF config->'git' ? 'auto_scan_enabled' AND 
           jsonb_typeof(config->'git'->'auto_scan_enabled') != 'boolean' THEN
            RETURN FALSE;
        END IF;
        
        IF config->'git' ? 'scan_interval_hours' AND 
           (jsonb_typeof(config->'git'->'scan_interval_hours') != 'number' OR
            (config->'git'->>'scan_interval_hours')::int < 1 OR
            (config->'git'->>'scan_interval_hours')::int > 168) THEN
            RETURN FALSE;
        END IF;
    END IF;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Add check constraint for config validation
ALTER TABLE projects ADD CONSTRAINT check_valid_config 
    CHECK (validate_project_config(config));

-- Insert some example data for development (remove in production)
-- INSERT INTO projects (name, description, repo_path, config) VALUES 
-- (
--     'Example Project',
--     'A sample project for testing the git-integrated memory system',
--     '/tmp/example-repo',
--     '{
--         "memory": {
--             "semantic_search_enabled": true,
--             "embedding_model": "openai",
--             "memory_retention_days": 90,
--             "auto_consolidation": true
--         },
--         "git": {
--             "auto_scan_enabled": true,
--             "scan_interval_hours": 24,
--             "track_branches": ["main", "develop"],
--             "ignore_patterns": ["node_modules/**", "*.log"]
--         },
--         "steering": {
--             "default_persona": "developer",
--             "constraint_enforcement": "flexible"
--         }
--     }'::jsonb
-- );

-- Create view for projects with computed fields
CREATE VIEW projects_with_stats AS
SELECT 
    p.*,
    COALESCE(c.commit_count, 0) as total_commits,
    COALESCE(m.memory_count, 0) as total_memories,
    COALESCE(t.task_count, 0) as total_tasks,
    COALESCE(s.active_session_count, 0) as active_sessions,
    GREATEST(p.updated_at, c.last_commit_at, m.last_memory_at) as last_activity_at
FROM projects p
LEFT JOIN (
    SELECT project_id, COUNT(*) as commit_count, MAX(committed_at) as last_commit_at
    FROM commits 
    GROUP BY project_id
) c ON p.id = c.project_id
LEFT JOIN (
    SELECT project_id, COUNT(*) as memory_count, MAX(updated_at) as last_memory_at
    FROM memories 
    GROUP BY project_id
) m ON p.id = m.project_id
LEFT JOIN (
    SELECT project_id, COUNT(*) as task_count
    FROM tasks 
    WHERE status != 'completed'
    GROUP BY project_id
) t ON p.id = t.project_id
LEFT JOIN (
    SELECT project_id, COUNT(*) as active_session_count
    FROM sessions 
    WHERE status = 'active'
    GROUP BY project_id
) s ON p.id = s.project_id;

COMMENT ON VIEW projects_with_stats IS 'Projects with aggregated statistics from related tables';

-- Grant permissions (adjust as needed for your setup)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON projects TO ai_handoff_app;
-- GRANT SELECT ON projects_with_stats TO ai_handoff_app;
-- GRANT USAGE ON SEQUENCE projects_id_seq TO ai_handoff_app;
