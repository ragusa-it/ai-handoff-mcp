-- Migration: Create Git Tables (commits and commit_files)
-- Version: 002
-- Description: Add commit and commit file tracking for git integration

-- Create commits table
CREATE TABLE IF NOT EXISTS commits (
    id VARCHAR(40) PRIMARY KEY,  -- Git SHA-1 hash
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    author_name VARCHAR(255) NOT NULL,
    author_email VARCHAR(255) NOT NULL,
    committed_at TIMESTAMP WITH TIME ZONE NOT NULL,
    message TEXT NOT NULL,
    parents TEXT[] DEFAULT '{}',  -- Array of parent commit hashes
    branches TEXT[] DEFAULT '{}',  -- Array of branch names containing this commit
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create commit_files table
CREATE TABLE IF NOT EXISTS commit_files (
    id SERIAL PRIMARY KEY,
    commit_id VARCHAR(40) NOT NULL REFERENCES commits(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    change_type CHAR(1) NOT NULL CHECK (change_type IN ('A', 'M', 'D', 'R', 'C', 'T')),
    language VARCHAR(50),
    added_lines INTEGER DEFAULT 0 CHECK (added_lines >= 0),
    removed_lines INTEGER DEFAULT 0 CHECK (removed_lines >= 0),
    hunk_preview TEXT,  -- First few lines of diff for preview
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(commit_id, path)
);

-- Create indexes for commits table
CREATE INDEX IF NOT EXISTS idx_commits_project_id ON commits(project_id);
CREATE INDEX IF NOT EXISTS idx_commits_author_name ON commits(author_name);
CREATE INDEX IF NOT EXISTS idx_commits_author_email ON commits(author_email);
CREATE INDEX IF NOT EXISTS idx_commits_committed_at ON commits(committed_at DESC);
CREATE INDEX IF NOT EXISTS idx_commits_message_fts ON commits USING gin(to_tsvector('english', message));
CREATE INDEX IF NOT EXISTS idx_commits_parents ON commits USING gin(parents);
CREATE INDEX IF NOT EXISTS idx_commits_branches ON commits USING gin(branches);
CREATE INDEX IF NOT EXISTS idx_commits_metadata ON commits USING gin(metadata);

-- Create indexes for commit_files table
CREATE INDEX IF NOT EXISTS idx_commit_files_commit_id ON commit_files(commit_id);
CREATE INDEX IF NOT EXISTS idx_commit_files_path ON commit_files(path);
CREATE INDEX IF NOT EXISTS idx_commit_files_change_type ON commit_files(change_type);
CREATE INDEX IF NOT EXISTS idx_commit_files_language ON commit_files(language);
CREATE INDEX IF NOT EXISTS idx_commit_files_lines ON commit_files(added_lines, removed_lines);
CREATE INDEX IF NOT EXISTS idx_commit_files_path_fts ON commit_files USING gin(to_tsvector('english', path));

-- Create composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_commits_project_author ON commits(project_id, author_name);
CREATE INDEX IF NOT EXISTS idx_commits_project_date ON commits(project_id, committed_at DESC);
CREATE INDEX IF NOT EXISTS idx_commit_files_commit_change ON commit_files(commit_id, change_type);

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_commits_updated_at 
    BEFORE UPDATE ON commits 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Add constraints and validation
ALTER TABLE commits ADD CONSTRAINT commits_id_format 
    CHECK (length(id) = 40 AND id ~ '^[a-f0-9]+$');

ALTER TABLE commits ADD CONSTRAINT commits_author_name_not_empty 
    CHECK (length(trim(author_name)) > 0);

ALTER TABLE commits ADD CONSTRAINT commits_author_email_format 
    CHECK (author_email ~ '^[^@]+@[^@]+\.[^@]+$');

ALTER TABLE commits ADD CONSTRAINT commits_message_not_empty 
    CHECK (length(trim(message)) > 0);

ALTER TABLE commit_files ADD CONSTRAINT commit_files_path_not_empty 
    CHECK (length(trim(path)) > 0);

-- Add comments for documentation
COMMENT ON TABLE commits IS 'Git commits tracked for each project with metadata and branch information';
COMMENT ON COLUMN commits.id IS 'Git SHA-1 commit hash (40 characters)';
COMMENT ON COLUMN commits.project_id IS 'Reference to the project this commit belongs to';
COMMENT ON COLUMN commits.parents IS 'Array of parent commit hashes for merge tracking';
COMMENT ON COLUMN commits.branches IS 'Array of branch names that contain this commit';
COMMENT ON COLUMN commits.metadata IS 'Additional metadata like tags, PR info, etc.';

COMMENT ON TABLE commit_files IS 'Files changed in each commit with diff statistics';
COMMENT ON COLUMN commit_files.change_type IS 'A=Added, M=Modified, D=Deleted, R=Renamed, C=Copied, T=Type changed';
COMMENT ON COLUMN commit_files.language IS 'Detected programming language of the file';
COMMENT ON COLUMN commit_files.hunk_preview IS 'Preview of the diff hunk for quick reference';

-- Create views for common queries
CREATE OR REPLACE VIEW commit_summaries AS
SELECT 
    c.id,
    c.project_id,
    c.author_name,
    c.author_email,
    c.committed_at,
    c.message,
    array_length(c.parents, 1) > 1 as is_merge,
    c.message ~ '^(feat|fix|docs|style|refactor|perf|test|chore|build|ci)(\(.+\))?!?:' as is_conventional,
    c.message ~ '^(feat|fix|docs|style|refactor|perf|test|chore|build|ci)(\(.+\))?!:' as breaking_change,
    COALESCE(cf_stats.file_count, 0) as file_count,
    COALESCE(cf_stats.added_lines, 0) as added_lines,
    COALESCE(cf_stats.removed_lines, 0) as removed_lines,
    COALESCE(cf_stats.languages, '{}') as languages
FROM commits c
LEFT JOIN (
    SELECT 
        commit_id,
        COUNT(*) as file_count,
        SUM(added_lines) as added_lines,
        SUM(removed_lines) as removed_lines,
        array_agg(DISTINCT language) FILTER (WHERE language IS NOT NULL) as languages
    FROM commit_files
    GROUP BY commit_id
) cf_stats ON c.id = cf_stats.commit_id;

COMMENT ON VIEW commit_summaries IS 'Enriched commit view with file statistics and conventional commit flags';

-- Create materialized view for project git statistics (refreshed periodically)
CREATE MATERIALIZED VIEW IF NOT EXISTS project_git_stats AS
SELECT 
    p.id as project_id,
    p.name as project_name,
    COUNT(DISTINCT c.id) as total_commits,
    COUNT(DISTINCT c.author_email) as unique_authors,
    COUNT(DISTINCT cf.path) as unique_files,
    SUM(cf.added_lines) as total_added_lines,
    SUM(cf.removed_lines) as total_removed_lines,
    MIN(c.committed_at) as first_commit_at,
    MAX(c.committed_at) as last_commit_at,
    COUNT(DISTINCT c.id) FILTER (WHERE array_length(c.parents, 1) > 1) as merge_commits,
    COUNT(DISTINCT c.id) FILTER (WHERE c.message ~ '^(feat|fix|docs|style|refactor|perf|test|chore|build|ci)(\(.+\))?!?:') as conventional_commits,
    json_object_agg(DISTINCT c.author_name, author_stats.commit_count) FILTER (WHERE author_stats.commit_count IS NOT NULL) as author_contributions,
    json_object_agg(DISTINCT cf.language, lang_stats.file_count) FILTER (WHERE lang_stats.file_count IS NOT NULL) as language_distribution
FROM projects p
LEFT JOIN commits c ON p.id = c.project_id
LEFT JOIN commit_files cf ON c.id = cf.commit_id
LEFT JOIN (
    SELECT c2.project_id, c2.author_name, COUNT(*) as commit_count
    FROM commits c2
    GROUP BY c2.project_id, c2.author_name
) author_stats ON p.id = author_stats.project_id AND c.author_name = author_stats.author_name
LEFT JOIN (
    SELECT c3.project_id, cf3.language, COUNT(*) as file_count
    FROM commits c3
    JOIN commit_files cf3 ON c3.id = cf3.commit_id
    WHERE cf3.language IS NOT NULL
    GROUP BY c3.project_id, cf3.language
) lang_stats ON p.id = lang_stats.project_id AND cf.language = lang_stats.language
GROUP BY p.id, p.name;

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_git_stats_project_id ON project_git_stats(project_id);

COMMENT ON MATERIALIZED VIEW project_git_stats IS 'Aggregated git statistics per project (refreshed periodically)';

-- Function to refresh git stats
CREATE OR REPLACE FUNCTION refresh_project_git_stats()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY project_git_stats;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION refresh_project_git_stats() IS 'Refresh materialized view for project git statistics';
