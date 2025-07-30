# AI Handoff MCP Server

A Model Context Protocol (MCP) server for seamless context transfer between AI agents, enabling efficient handoffs with complete conversation history, codebase analysis, and comprehensive session monitoring capabilities.

## Features

- 🔄 **Session Management**: Create and manage handoff sessions with lifecycle tracking and automatic expiration
- 📝 **Context History**: Track complete conversation history with performance metrics and analytics
- 🔍 **Codebase Analysis**: Analyze code files for better context understanding
- 💾 **Persistent Storage**: PostgreSQL for data persistence and Redis for caching with optimized performance
- 🛠️ **MCP Tools**: Standard MCP tools for session registration, context updates, and handoff requests
- 📊 **Context Summarization**: Automatic generation of handoff summaries with intelligent insights
- 🏥 **Health Monitoring**: Comprehensive health checks and system monitoring with Prometheus metrics
- 📈 **Analytics & Insights**: Advanced analytics for session patterns, performance trends, and usage statistics
- ⚡ **Performance Optimization**: Background job processing, connection pooling, and intelligent caching
- 🔧 **Structured Logging**: Comprehensive logging with contextual information and error tracking

## Quick Start

1. **Clone and install dependencies**:
   ```bash
   git clone <repository-url>
   cd ai-handoff-mcp
   npm install
   ```

2. **Set up environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Start database services**:
   ```bash
   docker-compose up -d postgres redis
   ```

4. **Initialize database**:
   ```bash
   npm run db:setup
   ```

5. **Build and start the server**:
   ```bash
   npm run build
   npm start
   ```

   Or for development:
   ```bash
   npm run dev
   ```

## Project Structure

```
src/
├── server.ts                    # Main MCP server entry point
├── config/
│   ├── index.ts                 # Configuration management
│   └── env.ts                   # Environment variable handling
├── database/
│   ├── index.ts                 # Database manager with connection pooling
│   └── schema.ts                # Enhanced table definitions and types
├── mcp/
│   ├── tools/
│   │   ├── registerSession.ts   # Session registration with lifecycle tracking
│   │   ├── updateContext.ts     # Context updates with performance metrics
│   │   ├── requestHandoff.ts    # Enhanced handoff request handler
│   │   └── index.ts             # Tool exports and management
│   └── resources/
│       └── index.ts             # MCP resource definitions
└── services/
    ├── contextManager.ts        # Context management with caching
    ├── codebaseAnalyzer.ts      # Advanced code analysis functionality
    ├── sessionManager.ts        # Session lifecycle and cleanup management
    ├── monitoringService.ts     # Health monitoring and metrics collection
    ├── analyticsService.ts      # Analytics and insights generation
    ├── structuredLogger.ts      # Comprehensive structured logging
    └── backgroundJobScheduler.ts # Background job processing and scheduling
```

## Available MCP Tools

### 1. Register Session
Create a new handoff session:
```json
{
  "name": "register_session",
  "arguments": {
    "sessionKey": "unique-session-id",
    "agentFrom": "agent-name",
    "metadata": {}
  }
}
```

### 2. Update Context
Add context to an active session:
```json
{
  "name": "update_context",
  "arguments": {
    "sessionKey": "session-id",
    "contextType": "message|file|tool_call|system",
    "content": "context content",
    "metadata": {}
  }
}
```

### 3. Request Handoff
Request handoff to another agent:
```json
{
  "name": "request_handoff",
  "arguments": {
    "sessionKey": "session-id",
    "targetAgent": "target-agent-name",
    "requestType": "context_transfer|full_handoff|collaboration",
    "requestData": {}
  }
}
```

### 4. Analyze Codebase
Analyze code files for context:
```json
{
  "name": "analyze_codebase",
  "arguments": {
    "sessionKey": "session-id",
    "filePaths": ["path/to/file1.ts", "path/to/file2.js"],
    "analysisType": "syntax|dependencies|structure|full"
  }
}
```

### 5. Background Job Management
Manage and monitor background jobs:
```json
{
  "name": "schedule_job",
  "arguments": {
    "jobType": "cleanup|analytics|monitoring",
    "schedule": "cron-expression",
    "jobData": {}
  }
}
```

```json
{
  "name": "get_job_status",
  "arguments": {
    "jobId": "job-id"
  }
}
```

## Available MCP Resources

- `handoff://sessions` - List of active sessions with lifecycle status
- `handoff://context/{sessionKey}` - Complete context for a session with performance metrics
- `handoff://summary/{sessionKey}` - Context summary for a session
- `handoff://health` - System health status and component monitoring
- `handoff://metrics` - Prometheus-compatible metrics export
- `handoff://analytics/{type}` - Analytics insights and usage statistics
- `handoff://jobs` - Background job status and management

## Environment Configuration

Key environment variables in `.env`:

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

## Database Schema

The server uses PostgreSQL with the following main tables:

- **sessions**: Track handoff sessions with enhanced monitoring fields
- **context_history**: Store conversation and context data with performance metrics
- **codebase_snapshots**: Store code analysis results
- **handoff_requests**: Track handoff attempts
- **session_lifecycle**: Log session events for monitoring and analytics
- **system_metrics**: Store system performance and health data
- **performance_logs**: Track operation performance and timing
- **analytics_aggregations**: Store pre-computed analytics for efficient queries

## Development

### Building
```bash
npm run build
```

### Development Mode
```bash
npm run dev
```

### Database Setup
```bash
npm run db:setup
```

### Linting
```bash
npm run lint
npm run lint:fix
```

### Testing
```bash
npm test              # Run Jest test suite
npm run test:watch    # Run tests in watch mode
npm run test:coverage # Run tests with coverage report
```

## Docker Services

The included `docker-compose.yml` provides:

- **PostgreSQL 15** with persistent storage
- **Redis 7** with persistent storage
- **pgAdmin** (optional) for database management

Start services:
```bash
docker-compose up -d postgres redis
```

Start with pgAdmin:
```bash
docker-compose --profile tools up -d
```

## Monitoring and Analytics

### Health Monitoring
The server provides comprehensive health monitoring:
- Database and Redis connection health checks
- System resource monitoring (CPU, memory, disk)
- Component health status tracking
- Health check endpoint responding within 1 second under load

### Metrics and Analytics
- Prometheus-compatible metrics export
- Session lifecycle tracking and analytics  
- Performance metrics for all operations
- Usage pattern analysis and trends
- Anomaly detection for unusual session behavior
- Background job monitoring and status

### Session Lifecycle Management
- Automatic session expiration and cleanup
- Dormant session detection and archival
- Configurable retention policies
- Cache optimization for frequently accessed sessions
- Referential integrity maintenance during lifecycle transitions

### Performance Optimization
- Connection pooling for PostgreSQL and Redis
- Intelligent caching strategies
- Background job processing for heavy operations
- Performance logging and threshold monitoring
- Query optimization and indexing for analytics

## Usage with MCP Clients

This server implements the standard MCP protocol and can be used with any MCP-compatible client. The server communicates via stdio transport.

Example client connection:
```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['dist/server.js']
});

const client = new Client(
  { name: 'example-client', version: '1.0.0' },
  { capabilities: {} }
);

await client.connect(transport);
```

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## Configuration

The server supports extensive configuration through environment variables and configuration files. Key configuration areas include:

- **Retention Policies**: Configure session cleanup and archival
- **Monitoring Settings**: Adjust health check intervals and thresholds  
- **Performance Tuning**: Database pool sizes, cache settings, job schedules
- **Analytics Configuration**: Aggregation intervals and insight generation

## Support

For issues and questions:
- Check the [troubleshooting guide](./docs/troubleshooting.md) for common issues
- Review system logs and health endpoints for diagnostic information
- Use the GitHub issue tracker for bug reports and feature requests
- Monitor the analytics dashboard for performance insights