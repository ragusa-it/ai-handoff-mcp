#!/bin/bash

# AI Handoff MCP - Server Start Script

echo "🚀 Starting AI Handoff MCP Server..."

# Load environment variables
if [ -f .env ]; then
    echo "📋 Loading environment from .env file..."
    export $(cat .env | grep -v '^#' | xargs)
else
    echo "⚠️  .env file not found, using default environment"
fi

# Set default values
NODE_ENV=${NODE_ENV:-development}
PORT=${PORT:-3000}

echo "🔧 Configuration:"
echo "   Environment: $NODE_ENV"
echo "   Port: $PORT"
echo "   MCP Server: ${MCP_SERVER_NAME:-ai-handoff-mcp} v${MCP_SERVER_VERSION:-1.0.0}"

# Check if build directory exists
if [ ! -d "dist" ]; then
    echo "📦 Build directory not found. Building TypeScript..."
    npm run build
    
    if [ $? -ne 0 ]; then
        echo "❌ Build failed. Please fix the errors and try again."
        exit 1
    fi
fi

# Check if database is available (optional - server will handle this)
if command -v pg_isready > /dev/null 2>&1; then
    DB_HOST=${DB_HOST:-localhost}
    DB_PORT=${DB_PORT:-5432}
    
    if pg_isready -h $DB_HOST -p $DB_PORT -q; then
        echo "✅ PostgreSQL is available"
    else
        echo "⚠️  PostgreSQL is not available at $DB_HOST:$DB_PORT"
        echo "   The server will attempt to connect and may fail if database is not ready"
    fi
fi

# Check if Redis is available (optional - server will handle this)
if command -v redis-cli > /dev/null 2>&1; then
    REDIS_HOST=${REDIS_HOST:-localhost}
    REDIS_PORT=${REDIS_PORT:-6379}
    
    if redis-cli -h $REDIS_HOST -p $REDIS_PORT ping > /dev/null 2>&1; then
        echo "✅ Redis is available"
    else
        echo "⚠️  Redis is not available at $REDIS_HOST:$REDIS_PORT"
        echo "   The server will attempt to connect and may fail if Redis is not ready"
    fi
fi

echo ""
echo "🎯 Starting MCP Server..."
echo "   Use Ctrl+C to stop the server"
echo ""

# Start the server
exec npm start