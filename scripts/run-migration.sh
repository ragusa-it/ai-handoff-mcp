#!/bin/bash

# Enhanced Session Monitoring Migration Runner
# This script safely applies the enhanced monitoring schema migration

set -e  # Exit on any error

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Default database connection parameters
DB_HOST=${DB_HOST:-localhost}
DB_PORT=${DB_PORT:-5432}
DB_NAME=${DB_NAME:-handoff_mcp}
DB_USER=${DB_USER:-postgres}

echo "🚀 Starting Enhanced Session Monitoring Migration"
echo "Database: $DB_NAME on $DB_HOST:$DB_PORT"

# Check if database is accessible
echo "📡 Checking database connectivity..."
if ! psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1;" > /dev/null 2>&1; then
    echo "❌ Cannot connect to database. Please check your connection parameters."
    exit 1
fi

echo "✅ Database connection successful"

# Create a backup of current schema (optional but recommended)
echo "💾 Creating schema backup..."
pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" --schema-only > "backup_schema_$(date +%Y%m%d_%H%M%S).sql"
echo "✅ Schema backup created"

# Run the migration
echo "🔄 Applying enhanced monitoring schema migration..."
if psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "scripts/migrations/001_enhanced_monitoring_schema.sql"; then
    echo "✅ Migration applied successfully"
else
    echo "❌ Migration failed. Please check the error messages above."
    exit 1
fi

# Verify the migration by checking if new tables exist
echo "🔍 Verifying migration..."
TABLES_CHECK=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "
    SELECT COUNT(*) FROM information_schema.tables 
    WHERE table_name IN ('session_lifecycle', 'system_metrics', 'performance_logs', 'analytics_aggregations')
    AND table_schema = 'public';
")

if [ "$TABLES_CHECK" -eq 4 ]; then
    echo "✅ All new monitoring tables created successfully"
else
    echo "⚠️  Warning: Expected 4 new tables, found $TABLES_CHECK"
fi

# Check if new columns were added to existing tables
COLUMNS_CHECK=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "
    SELECT COUNT(*) FROM information_schema.columns 
    WHERE table_name = 'sessions' 
    AND column_name IN ('last_activity_at', 'is_dormant', 'archived_at', 'retention_policy')
    AND table_schema = 'public';
")

if [ "$COLUMNS_CHECK" -eq 4 ]; then
    echo "✅ All new session monitoring columns added successfully"
else
    echo "⚠️  Warning: Expected 4 new columns in sessions table, found $COLUMNS_CHECK"
fi

# Check if views were created
VIEWS_CHECK=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "
    SELECT COUNT(*) FROM information_schema.views 
    WHERE table_name IN ('session_monitoring_view', 'performance_monitoring_view')
    AND table_schema = 'public';
")

if [ "$VIEWS_CHECK" -eq 2 ]; then
    echo "✅ All monitoring views created successfully"
else
    echo "⚠️  Warning: Expected 2 monitoring views, found $VIEWS_CHECK"
fi

echo ""
echo "🎉 Enhanced Session Monitoring Migration Complete!"
echo ""
echo "New features available:"
echo "  • Session lifecycle tracking with automatic event logging"
echo "  • System metrics collection and storage"
echo "  • Performance logging for all operations"
echo "  • Analytics aggregations for insights"
echo "  • Enhanced monitoring views for easy querying"
echo ""
echo "Next steps:"
echo "  1. Update your application code to use the new monitoring features"
echo "  2. Configure retention policies for your use case"
echo "  3. Set up monitoring dashboards using the new views"
echo ""