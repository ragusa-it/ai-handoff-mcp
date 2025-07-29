#!/bin/bash

# Enhanced AI Handoff MCP Database Setup Script
# This script sets up the complete database with enhanced monitoring features

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
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-postgres}

echo "🚀 Setting up Enhanced AI Handoff MCP Database"
echo "Database: $DB_NAME on $DB_HOST:$DB_PORT"

# Check if PostgreSQL is running
echo "📡 Checking PostgreSQL connectivity..."
if ! pg_isready -h "$DB_HOST" -p "$DB_PORT" > /dev/null 2>&1; then
    echo "❌ PostgreSQL is not running or not accessible at $DB_HOST:$DB_PORT"
    echo "Please ensure PostgreSQL is running and accessible."
    exit 1
fi

echo "✅ PostgreSQL is running"

# Create database if it doesn't exist
echo "🗄️  Creating database if it doesn't exist..."
if ! psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -lqt | cut -d \| -f 1 | grep -qw "$DB_NAME"; then
    echo "Creating database: $DB_NAME"
    createdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME"
    echo "✅ Database created successfully"
else
    echo "✅ Database already exists"
fi

# Run the enhanced database initialization script
echo "🔧 Initializing enhanced database schema..."
if psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "scripts/init-enhanced-db.sql"; then
    echo "✅ Enhanced database schema initialized successfully"
else
    echo "❌ Failed to initialize database schema"
    exit 1
fi

# Verify the setup
echo "🔍 Verifying database setup..."

# Check tables
TABLES=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "
    SELECT COUNT(*) FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_type = 'BASE TABLE';
")

echo "📊 Found $TABLES tables in the database"

# Check specific monitoring tables
MONITORING_TABLES=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "
    SELECT table_name FROM information_schema.tables 
    WHERE table_name IN ('session_lifecycle', 'system_metrics', 'performance_logs', 'analytics_aggregations')
    AND table_schema = 'public'
    ORDER BY table_name;
")

echo "🔍 Monitoring tables found:"
echo "$MONITORING_TABLES" | while read -r table; do
    if [ -n "$table" ]; then
        echo "  ✅ $table"
    fi
done

# Check views
VIEWS=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "
    SELECT COUNT(*) FROM information_schema.views 
    WHERE table_schema = 'public';
")

echo "👁️  Found $VIEWS monitoring views"

# Check if initial metric was inserted
INITIAL_METRIC=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "
    SELECT COUNT(*) FROM system_metrics 
    WHERE metric_name = 'schema_initialized';
")

if [ "$INITIAL_METRIC" -gt 0 ]; then
    echo "✅ Initial system metric recorded"
else
    echo "⚠️  Warning: Initial system metric not found"
fi

echo ""
echo "🎉 Enhanced AI Handoff MCP Database Setup Complete!"
echo ""
echo "Database Features:"
echo "  • Session lifecycle management with automatic event logging"
echo "  • System metrics collection and storage"
echo "  • Performance logging for all operations"
echo "  • Analytics aggregations for insights"
echo "  • Monitoring views for easy querying"
echo "  • Automatic triggers for data consistency"
echo ""
echo "Connection Details:"
echo "  Host: $DB_HOST"
echo "  Port: $DB_PORT"
echo "  Database: $DB_NAME"
echo "  User: $DB_USER"
echo ""
echo "Next Steps:"
echo "  1. Update your .env file with the database connection details"
echo "  2. Start your AI Handoff MCP server"
echo "  3. Monitor sessions using the new monitoring views"
echo ""