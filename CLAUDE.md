# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an AI Handoff MCP (Model Context Protocol) Server that enables seamless context transfer between AI agents. The system provides comprehensive session management, context history tracking, codebase analysis, and advanced monitoring capabilities.

## Key Commands

### Development
- `npm run dev` - Start development server with hot reloading
- `npm run build` - Compile TypeScript to JavaScript
- `npm start` - Start production server
- `npm test` - Run test suite
- `npm run test:watch` - Run tests in watch mode
- `npm run lint` - Check for linting errors
- `npm run lint:fix` - Fix linting errors automatically

### Database
- `npm run db:setup` - Initialize database with required schema
- `docker-compose up -d postgres redis` - Start database services

## Architecture Overview

The server is built with a modular architecture organized into the following key areas:

### Core Services
- [`src/server.ts`](src/server.ts) - Main MCP server entry point handling protocol communication
- [`src/services/configurationManager.ts`](src/services/configurationManager.ts) - Central configuration management with hot reload
- [`src/services/contextManager.ts`](src/services/contextManager.ts) - Context storage and retrieval with caching
- [`src/services/sessionManager.ts`](src/services/sessionManager.ts) - Session lifecycle management and cleanup
- [`src/services/monitoringService.ts`](src/services/monitoringService.ts) - System health monitoring and metrics collection
- [`src/services/analyticsService.ts`](src/services/analyticsService.ts) - Analytics and insights generation
- [`src/services/codebaseAnalyzer.ts`](src/services/codebaseAnalyzer.ts) - Code file analysis for context extraction
- [`src/services/backgroundJobScheduler.ts`](src/services/backgroundJobScheduler.ts) - Background job management (scheduling, execution, status)

### MCP Integration Layer
- [`src/mcp/tools/`](src/mcp/tools/) - Implementation of MCP tools (register_session, update_context, request_handoff, analyze_codebase, get_configuration, update_configuration, manage_configuration_backup, get_job_status, run_job_now, update_job_config)
- [`src/mcp/resources/`](src/mcp/resources/) - MCP resource handlers for dynamic data access
  - Health: handoff://health
  - Metrics: handoff://metrics
  - Analytics: handoff://analytics/{type}
  - Sessions: handoff://sessions
  - Context: handoff://context/{sessionKey}

### Data Layer
- [`src/database/`](src/database/) - Database connection management and optimized queries
- PostgreSQL for persistent storage
- Redis for caching frequently accessed data

### Infrastructure
- [`src/config/`](src/config/) - Environment and system configuration
- Structured logging with [`src/services/structuredLogger.ts`](src/services/structuredLogger.ts)

## Key Integration Points

1. MCP Protocol tools (snake_case):
   - Sessions/Context/Handoff/Analysis: register_session, update_context, request_handoff, analyze_codebase
   - Configuration: get_configuration, update_configuration, manage_configuration_backup
   - Jobs: get_job_status, run_job_now, update_job_config
2. Resources (URIs):
   - Health: handoff://health
   - Metrics: handoff://metrics
   - Analytics: handoff://analytics/{type}
   - Sessions: handoff://sessions
   - Context: handoff://context/{sessionKey}
3. Database Integration: PostgreSQL for data persistence with connection pooling for performance
4. Caching Layer: Redis for improved performance of frequently accessed data
5. Background Processing: Scheduled jobs for cleanup, analytics, and maintenance tasks (exposed via job tools above)
6. Monitoring and Observability: Prometheus-compatible metrics and structured logging

## Common Development Tasks

- Adding new MCP tools: Extend [`src/mcp/tools/`](src/mcp/tools/) and register in [`src/server.ts`](src/server.ts)
  - Session/Context/Handoff: [`src/mcp/tools/registerSession.ts`](src/mcp/tools/registerSession.ts), [`src/mcp/tools/updateContext.ts`](src/mcp/tools/updateContext.ts), [`src/mcp/tools/requestHandoff.ts`](src/mcp/tools/requestHandoff.ts)
  - Codebase Analysis: ensure tool name analyze_codebase maps to service [`src/services/codebaseAnalyzer.ts`](src/services/codebaseAnalyzer.ts)
  - Configuration: [`src/mcp/tools/getConfiguration.ts`](src/mcp/tools/getConfiguration.ts), [`src/mcp/tools/updateConfiguration.ts`](src/mcp/tools/updateConfiguration.ts), [`src/mcp/tools/manageConfigurationBackup.ts`](src/mcp/tools/manageConfigurationBackup.ts)
  - Jobs (naming in server: get_job_status, run_job_now, update_job_config) backed by [`src/services/backgroundJobScheduler.ts`](src/services/backgroundJobScheduler.ts)
- Creating new services: Add to [`src/services/`](src/services/) and integrate in server initialization
- Modifying database schema: Update [`scripts/init-db.sql`](scripts/init-db.sql) and add migration scripts
- Adding configuration options: Extend interfaces in [`src/services/configurationManager.ts`](src/services/configurationManager.ts)
- Example integration calls (tool names in snake_case):
  - register_session -> initialize or attach to a session; related resources: handoff://sessions
  - update_context -> write context; read via handoff://context/{sessionKey}
  - request_handoff -> trigger handoff workflow; observe health/metrics via handoff://health and handoff://metrics
  - analyze_codebase -> request analysis; results available under handoff://analytics/{type}
  - get_configuration / update_configuration / manage_configuration_backup -> configuration lifecycle
  - get_job_status / run_job_now / update_job_config -> background job management