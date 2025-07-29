#!/bin/bash

# AI Handoff MCP - Database Setup Script

echo "🚀 Setting up AI Handoff MCP Database..."

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Default values if not set in environment
DB_HOST=${DB_HOST:-localhost}
DB_PORT=${DB_PORT:-5432}
DB_NAME=${DB_NAME:-ai_handoff}
DB_USER=${DB_USER:-ai_handoff_user}
DB_PASSWORD=${DB_PASSWORD:-ai_handoff_password}

echo "📋 Database Configuration:"
echo "  Host: $DB_HOST"
echo "  Port: $DB_PORT"
echo "  Database: $DB_NAME"
echo "  User: $DB_USER"

# Function to check if PostgreSQL is running
check_postgres() {
    pg_isready -h $DB_HOST -p $DB_PORT -q
    return $?
}

# Function to wait for PostgreSQL
wait_for_postgres() {
    echo "⏳ Waiting for PostgreSQL to be ready..."
    for i in {1..30}; do
        if check_postgres; then
            echo "✅ PostgreSQL is ready!"
            return 0
        fi
        echo "   Attempt $i/30: PostgreSQL not ready, waiting..."
        sleep 2
    done
    echo "❌ PostgreSQL is not available after 60 seconds"
    return 1
}

# Function to check if Redis is running
check_redis() {
    redis-cli -h ${REDIS_HOST:-localhost} -p ${REDIS_PORT:-6379} ping > /dev/null 2>&1
    return $?
}

# Function to wait for Redis
wait_for_redis() {
    echo "⏳ Waiting for Redis to be ready..."
    for i in {1..30}; do
        if check_redis; then
            echo "✅ Redis is ready!"
            return 0
        fi
        echo "   Attempt $i/30: Redis not ready, waiting..."
        sleep 2
    done
    echo "❌ Redis is not available after 60 seconds"
    return 1
}

# Start Docker services if docker-compose.yml exists
if [ -f docker-compose.yml ]; then
    echo "🐳 Starting Docker services..."
    docker-compose up -d postgres redis
    
    # Wait for services to be ready
    if ! wait_for_postgres; then
        echo "❌ Failed to start PostgreSQL"
        exit 1
    fi
    
    if ! wait_for_redis; then
        echo "❌ Failed to start Redis"
        exit 1
    fi
else
    echo "⚠️  docker-compose.yml not found. Assuming external database services."
    
    # Just check if services are available
    if ! check_postgres; then
        echo "❌ PostgreSQL is not available at $DB_HOST:$DB_PORT"
        echo "   Please start PostgreSQL or run 'docker-compose up -d postgres'"
        exit 1
    fi
    
    if ! check_redis; then
        echo "❌ Redis is not available"
        echo "   Please start Redis or run 'docker-compose up -d redis'"
        exit 1
    fi
fi

# Test database connection
echo "🔍 Testing database connection..."
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d postgres -c "SELECT version();" > /dev/null 2>&1

if [ $? -ne 0 ]; then
    echo "❌ Cannot connect to PostgreSQL database"
    echo "   Please check your database configuration"
    exit 1
fi

echo "✅ Database connection successful!"

# Initialize database schema (if init-db.sql exists and hasn't been run)
if [ -f scripts/init-db.sql ]; then
    echo "📊 Initializing database schema..."
    PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f scripts/init-db.sql

    if [ $? -eq 0 ]; then
        echo "✅ Database schema initialized successfully!"
    else
        echo "⚠️  Database schema initialization had some issues (this might be normal if already initialized)"
    fi
else
    echo "⚠️  scripts/init-db.sql not found. Skipping schema initialization."
fi

# Test Redis connection
echo "🔍 Testing Redis connection..."
redis-cli -h ${REDIS_HOST:-localhost} -p ${REDIS_PORT:-6379} ping > /dev/null 2>&1

if [ $? -eq 0 ]; then
    echo "✅ Redis connection successful!"
else
    echo "❌ Cannot connect to Redis"
    exit 1
fi

echo ""
echo "🎉 Database setup completed successfully!"
echo ""
echo "📝 Next steps:"
echo "   1. Run 'npm run build' to compile TypeScript"
echo "   2. Run 'npm start' to start the AI Handoff MCP server"
echo "   3. Or run 'npm run dev' for development mode"
echo ""