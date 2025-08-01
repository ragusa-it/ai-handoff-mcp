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
- `src/server.ts` - Main MCP server entry point handling protocol communication
- `src/services/configurationManager.ts` - Central configuration management with hot reload
- `src/services/contextManager.ts` - Context storage and retrieval with caching
- `src/services/sessionManager.ts` - Session lifecycle management and cleanup
- `src/services/monitoringService.ts` - System health monitoring and metrics collection
- `src/services/analyticsService.ts` - Analytics and insights generation
- `src/services/codebaseAnalyzer.ts` - Code file analysis for context extraction

### MCP Integration Layer
- `src/mcp/tools/` - Implementation of MCP tools (register_session, update_context, request_handoff, etc.)
- `src/mcp/resources/` - MCP resource handlers for dynamic data access

### Data Layer
- `src/database/` - Database connection management and optimized queries
- PostgreSQL for persistent storage
- Redis for caching frequently accessed data

### Infrastructure
- `src/config/` - Environment and system configuration
- Structured logging with `src/services/structuredLogger.ts`

## Key Integration Points

1. **MCP Protocol Communication**: The server implements the Model Context Protocol for standardized AI agent communication
2. **Database Integration**: PostgreSQL for data persistence with connection pooling for performance
3. **Caching Layer**: Redis for improved performance of frequently accessed data
4. **Background Processing**: Scheduled jobs for cleanup, analytics, and maintenance tasks
5. **Monitoring and Observability**: Prometheus-compatible metrics and structured logging

## Common Development Tasks

- Adding new MCP tools: Extend `src/mcp/tools/` and register in `src/server.ts`
- Creating new services: Add to `src/services/` and integrate in server initialization
- Modifying database schema: Update `scripts/init-db.sql` and add migration scripts
- Adding configuration options: Extend interfaces in `src/services/configurationManager.ts`