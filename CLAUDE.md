# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an AI Handoff Model Context Protocol (MCP) server that enables seamless context transfer between AI agents. It implements the standard MCP protocol with tools for session management, context tracking, and agent handoffs, backed by PostgreSQL for persistence and Redis for caching.

## Development Commands

### Build and Run
```bash
npm run build          # Compile TypeScript to dist/
npm start             # Run the compiled server
npm run dev           # Development mode with hot reload using tsx watch
```

### Database Setup
```bash
npm run db:setup      # Initialize PostgreSQL schema and run migrations
docker-compose up -d postgres redis  # Start database services
```

### Testing and Quality
```bash
npm test              # Run Jest test suite
npm run lint          # ESLint code analysis
npm run lint:fix      # Auto-fix ESLint issues
```

## Architecture Overview

### Core MCP Server Structure
- **Server Entry Point**: `src/server.ts` - Main MCP server implementing stdio transport
- **Tool Handlers**: `src/mcp/tools/` - Individual MCP tool implementations
- **Database Layer**: `src/database/` - PostgreSQL/Redis connection management
- **Services**: `src/services/` - Business logic for context management and codebase analysis

### Key MCP Tools Available
1. **register_session** - Creates new handoff sessions with metadata
2. **update_context** - Adds context entries (messages, files, tool calls, system events)
3. **request_handoff** - Generates summaries and requests agent handoffs
4. **analyze_codebase** - Analyzes code files for context extraction
5. **Background job management tools** - For monitoring and job control

### Database Schema
The system uses PostgreSQL with these main tables:
- `sessions` - Track handoff sessions with enhanced monitoring fields
- `context_history` - Store conversation context with performance metrics
- `codebase_snapshots` - Store code analysis results
- `handoff_requests` - Track handoff attempts
- `session_lifecycle` - Log session events for monitoring
- `system_metrics`, `performance_logs`, `analytics_aggregations` - Enhanced monitoring

## Technical Details

### TypeScript Configuration
- ES2022 target with ESM modules
- Strict type checking enabled
- Declaration files generated in dist/
- Source maps for debugging

### Testing Setup
- Jest with ts-jest preset
- ESM support configured
- Tests in `**/__tests__/**/*.test.ts` and `**/*.test.ts`
- Coverage reporting enabled

### MCP Protocol Implementation
- Standard MCP tool and resource handlers
- JSON schema validation for all tool inputs
- Proper error codes (InvalidParams, MethodNotFound, InternalError)
- Resource endpoints: `handoff://sessions`, `handoff://context/{sessionKey}`, `handoff://jobs`

### Database Patterns
- Connection pooling for PostgreSQL
- Redis caching for frequently accessed context
- Automatic timestamp triggers and lifecycle event logging
- Comprehensive indexing for query performance
- Monitoring views for operational insights

## Environment Configuration

Required environment variables (see .env.example):
```bash
# Database
DATABASE_URL=postgresql://ai_handoff_user:password@localhost:5432/ai_handoff
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ai_handoff
DB_USER=ai_handoff_user
DB_PASSWORD=ai_handoff_password

# Redis
REDIS_URL=redis://localhost:6379
REDIS_HOST=localhost
REDIS_PORT=6379

# Server
PORT=3000
NODE_ENV=development

# MCP
MCP_SERVER_NAME=ai-handoff-mcp
MCP_SERVER_VERSION=1.0.0
```

## Development Patterns

### Adding New MCP Tools
1. Create tool handler in `src/mcp/tools/`
2. Add schema definition in `src/server.ts` ListToolsRequestSchema handler
3. Add case in CallToolRequestSchema handler
4. Export from `src/mcp/tools/index.ts`

### Service Layer Pattern
Services in `src/services/` provide business logic abstraction:
- `contextManager.ts` - Context retrieval and summarization
- `codebaseAnalyzer.ts` - Code analysis functionality
- `backgroundJobScheduler.ts` - Job management and monitoring
- `monitoringService.ts` - Enhanced session monitoring

### Error Handling
- Use McpError with proper ErrorCode enum values
- Catch and wrap service errors in tool handlers
- Log errors before throwing McpError with InternalError code

### Performance Considerations
- Redis caching for recent context lookups
- Database connection pooling
- Performance logging for all operations
- Background job processing for heavy tasks

## Docker Services

The `docker-compose.yml` provides:
- PostgreSQL 15 with persistent storage
- Redis 7 with persistent storage  
- Optional pgAdmin for database management (--profile tools)

## Monitoring and Analytics

The system includes comprehensive monitoring:
- Session lifecycle tracking with automatic event logging
- Performance metrics for all operations
- System metrics collection
- Analytics aggregations for trend analysis
- Built-in monitoring views for operational insights

## Background Jobs

Background job system for:
- Session cleanup and archival
- Performance data aggregation
- System health monitoring
- Dormant session detection

## MCP Tools

Use all MCP tools at your disposal