# Quick Start

This guide gets you running the AI Handoff MCP Server and calling its MCP tools with a minimal Docusaurus-friendly structure.

Prerequisites
- Node.js LTS >= 18
- PostgreSQL 13+ and Redis 6+ recommended 7+
- Docker optional for local infra
- bash, git

Install
```bash
git clone <repository-url>
cd ai-handoff-mcp
npm install
```

Configure
```bash
cp .env.example .env
# Edit .env to set DATABASE_URL and REDIS_URL if needed
```

Run Infra locally optional
```bash
docker-compose up -d postgres redis
```

Initialize Database
```bash
# If provided by this repo
npm run db:setup
```

Build and Start
```bash
npm run build
npm start
# or development mode with hot reload
npm run dev
```

Minimal Client Example register_session, update_context, request_handoff
```ts
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

// Register session
const reg = await client.callTool({
  name: 'register_session',
  arguments: {
    session_key: 'session-' + Date.now(),
    agent_from: 'example-client',
    metadata: { purpose: 'quick-start' }
  }
});
const regPayload = JSON.parse(reg.content[0].text);
const session_key = regPayload.session.session_key;

// Update context
await client.callTool({
  name: 'update_context',
  arguments: {
    session_key,
    context_type: 'message',
    content: 'Hello from Quick Start',
    metadata: { channel: 'demo' }
  }
});

// Request handoff
const handoff = await client.callTool({
  name: 'request_handoff',
  arguments: {
    session_key,
    target_agent: 'downstream-assistant',
    request_type: 'context_transfer',
    request_data: { instructions: 'Continue conversation' }
  }
});
console.log('Handoff result:', handoff.content[0].text);
```

Verify Resources
```ts
// Example using MCP client's readResource

// Health check
const health = await client.readResource({ uri: 'handoff://health' });
console.log('Health:', JSON.parse(health.content[0].text).status);

// List sessions
const sessions = await client.readResource({ uri: 'handoff://sessions' });
const sessionsJson = JSON.parse(sessions.content[0].text);
console.log('Sessions total:', sessionsJson.total);

// Get session context
const context = await client.readResource({ uri: `handoff://context/${session_key}` });
const ctxJson = JSON.parse(context.content[0].text);
console.log('Context entries:', (ctxJson.entries ?? []).length);

// Metrics overview
const metrics = await client.readResource({ uri: 'handoff://metrics' });
console.log(metrics.content[0].text.split('\n').slice(0, 3).join('\n'));
```

Common Commands
```bash
npm run build           # compile TypeScript
npm start               # run compiled server
npm run dev             # dev server
npm test                # run Jest tests
npm run lint            # lint
```

Next Steps
- Core Concepts: ./core-concepts.md
- Usage: sessions ./usage/sessions.md, context ./usage/context.md, handoff ./usage/handoff.md
- API Reference: ./api-reference.md