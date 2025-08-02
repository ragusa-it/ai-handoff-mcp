# AI Handoff MCP Server

A Model Context Protocol MCP server enabling reliable session and context handoff between AI agents with persistence, monitoring, analytics, and structured logging.

Assumptions
- Project name: AI Handoff MCP Server
- Scope: Provide reliable session/context handoff between AI agents over MCP with persistence, monitoring, analytics, and structured logging
- Primary use cases: Register sessions, add context, request handoff, retrieve context/resources; optional codebase analysis integration
- Supported platforms: Node.js LTS >=18, macOS/Linux; Docker provided; Postgres and Redis required for production usage
- Personas: AI integrator/developers primary, operators/SREs secondary, contributors
- Stability: Beta; semantic versioning; limited breaking changes noted in release notes
- Support: Best-effort via repository issues

Documentation Index
- Overview: ./docs/overview.md
- Quick Start: ./docs/quick-start.md
- Core Concepts: ./docs/core-concepts.md
- Usage Guides
  - Sessions: ./docs/usage/sessions.md
  - Context: ./docs/usage/context.md
  - Handoff: ./docs/usage/handoff.md
  - Configuration Tooling: ./docs/usage/configuration.md
  - Resources: ./docs/usage/resources.md
  - Codebase Analysis: ./docs/usage/codebase-analysis.md
- API Reference: ./docs/api-reference.md
- Configuration: ./docs/configuration.md
- Deployment: ./docs/deployment.md
- Security: ./docs/security.md
- Troubleshooting: ./docs/troubleshooting.md
- Performance: ./docs/performance.md
- Contributing: ./docs/contributing.md
- Release Notes: ./docs/release-notes.md
- License: ./docs/license.md
- FAQ: ./docs/faq.md

Quick Start
1. Install
   ```bash
   git clone <repository-url>
   cd ai-handoff-mcp
   npm install
   ```
2. Configure
   ```bash
   cp .env.example .env
   # Edit .env with Postgres and Redis credentials
   ```
3. Run infrastructure
   ```bash
   docker-compose up -d postgres redis
   ```
4. Build and start
   ```bash
   npm run build
   npm start
   # or
   npm run dev
   ```

Minimal MCP Client Example
```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['dist/server.js']
});

const client = new Client({ name: 'example-client', version: '1.0.0' }, { capabilities: {} });
await client.connect(transport);

// Register a session
const reg = await client.callTool({
  name: 'registerSession',
  arguments: { sessionKey: 'session-' + Date.now(), agentFrom: 'example-client', metadata: { purpose: 'demo' } }
});

// Update context
await client.callTool({
  name: 'updateContext',
  arguments: {
    sessionKey: JSON.parse(reg.content[0].text).session.sessionKey,
    contextType: 'message',
    content: 'Hello from client',
    metadata: { channel: 'demo' }
  }
});

// Request handoff
await client.callTool({
  name: 'requestHandoff',
  arguments: {
    sessionKey: JSON.parse(reg.content[0].text).session.sessionKey,
    targetAgent: 'downstream-assistant',
    requestType: 'context_transfer',
    requestData: { instructions: 'Continue conversation' }
  }
});
```

Environment Requirements
- Node.js LTS >= 18
- PostgreSQL 13+ and Redis 6+ (7+ recommended)
- macOS or Linux
- Docker optional but recommended for local infra

Configuration
See ./docs/configuration.md and ./.env.example for all environment variables and defaults. Typical production overrides and docker-compose snippets are included.

Deployment
See ./docs/deployment.md for local, Docker, Compose, and CI/CD notes with monitoring hooks, metrics, and scaling guidance.

Troubleshooting and Performance
- Troubleshooting: ./docs/troubleshooting.md
- Performance: ./docs/performance.md

Security
See ./docs/security.md for permissions, data handling, and secrets management. Known limitations are documented.

Contributing and Support
- Contribution guide: ./docs/contributing.md
- Support: best-effort via issues. Please include version, environment, and logs.

License
MIT, see ./LICENSE

Notes for Existing Docs
- docs/api.md has been reorganized into API Reference and Usage guides. A short note remains in docs/api.md pointing to canonical locations.