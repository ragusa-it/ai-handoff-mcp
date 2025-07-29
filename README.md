# AI Handoff MCP Server

A Model Context Protocol (MCP) server for seamless context transfer between AI agents, enabling efficient handoffs with complete conversation history and codebase analysis.

## Features

- 🔄 **Session Management**: Create and manage handoff sessions between AI agents
- 📝 **Context History**: Track complete conversation history with different content types
- 🔍 **Codebase Analysis**: Analyze code files for better context understanding
- 💾 **Persistent Storage**: PostgreSQL for data persistence and Redis for caching
- 🛠️ **MCP Tools**: Standard MCP tools for session registration, context updates, and handoff requests
- 📊 **Context Summarization**: Automatic generation of handoff summaries

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
├── server.ts              # Main MCP server entry point
├── config/
│   ├── index.ts           # Configuration management
│   └── env.ts             # Environment variable handling
├── database/
│   ├── index.ts           # Database manager
│   └── schema.ts          # Table definitions and types
├── mcp/
│   ├── tools/
│   │   ├── registerSession.ts    # Session registration handler
│   │   ├── updateContext.ts      # Context update handler
│   │   └── requestHandoff.ts     # Handoff request handler
│   └── resources/
│       └── index.ts       # Resource definitions
└── services/
    ├── contextManager.ts   # Context management logic
    └── codebaseAnalyzer.ts # Code analysis functionality
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

## Available MCP Resources

- `handoff://sessions` - List of active sessions
- `handoff://context/{sessionKey}` - Complete context for a session
- `handoff://summary/{sessionKey}` - Context summary for a session

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

- **sessions**: Track handoff sessions
- **context_history**: Store conversation and context data
- **codebase_snapshots**: Store code analysis results
- **handoff_requests**: Track handoff attempts

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
npm test
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

## Support

For issues and questions, please use the GitHub issue tracker.