# Usage: Codebase Analysis

This guide describes how to leverage the optional codebase analysis capability to derive insights from a repository and feed them into sessions and handoffs. It integrates with the MCP server via tools and/or service APIs exposed internally.

Status
- Optional feature: enable only if codebase analysis is relevant for your use case.
- Backed by the Codebase Analyzer service and related specs in ./specs/mcp-context-handoff-core.

Related Code
- Service: [src/services/codebaseAnalyzer.ts](src/services/codebaseAnalyzer.ts)
- Supporting services: [src/services/contextManager.ts](src/services/contextManager.ts), [src/services/sessionManager.ts](src/services/sessionManager.ts)
- Metrics: [src/metrics/metricsCollection.ts](src/metrics/metricsCollection.ts)
- Error handling: [src/services/errorHandler.ts](src/services/errorHandler.ts)
- Requirements/Design: [specs/mcp-context-handoff-core/requirements.md](specs/mcp-context-handoff-core/requirements.md), [specs/mcp-context-handoff-core/design.md](specs/mcp-context-handoff-core/design.md), [specs/mcp-context-handoff-core/tasks.md](specs/mcp-context-handoff-core/tasks.md)

Typical Workflow
1) Register a session
2) Run analysis for a target path or repository
3) Persist useful findings as session context
4) Optionally request a handoff to another agent with the analysis summary

Mermaid Sequence
```mermaid
sequenceDiagram
  autonumber
  participant Client
  participant MCP as MCP Server
  participant Analyzer as Codebase Analyzer
  participant DB as Postgres

  Client->>MCP: callTool registerSession(sessionKey, agentFrom)
  MCP->>DB: create session record
  DB-->>MCP: session active
  MCP-->>Client: session created

  Client->>MCP: analyzeCodebase({ rootPath, patterns, depth })
  MCP->>Analyzer: analyze({ rootPath, patterns, depth })
  Analyzer->>Analyzer: scan files, compute metrics, extract symbols
  Analyzer-->>MCP: analysis summary + artifacts
  MCP->>DB: persist artifacts reference
  MCP-->>Client: analysis result (JSON)

  Client->>MCP: updateContext with summary
  MCP-->>Client: context appended
```

Example: Running Analysis and Storing Findings
```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['dist/server.js']
});
const client = new Client({ name: 'analysis-client', version: '1.0.0' }, { capabilities: {} });

await client.connect(transport);

// 1) Register session
const reg = await client.callTool({
  name: 'registerSession',
  arguments: {
    sessionKey: 'session-' + Date.now(),
    agentFrom: 'analysis-client',
    metadata: { repo: 'local', purpose: 'codebase-analysis' }
  }
});
const session = JSON.parse(reg.content[0].text).session;

// 2) Run codebase analysis (tool name may be exposed if enabled)
const analysis = await client.callTool({
  name: 'analyzeCodebase',
  arguments: {
    rootPath: '.',
    patterns: ['src/**/*.ts'],
    depth: 6,
    includeMetrics: true,
    includeSymbolIndex: true
  }
});
const analysisPayload = JSON.parse(analysis.content[0].text);

// 3) Store summarized findings as session context
await client.callTool({
  name: 'updateContext',
  arguments: {
    sessionKey: session.sessionKey,
    contextType: 'message',
    content: `Analysis summary:\nFiles: ${analysisPayload.files}\nModules: ${analysisPayload.modules}\nHotspots: ${analysisPayload.hotspots?.join(', ') || 'none'}`
  }
});
```

Expected Response Shapes
- analyzeCodebase success
```json
{
  "success": true,
  "files": 124,
  "modules": 18,
  "hotspots": ["src/services/contextManager.ts", "src/database/resilientDatabase.ts"],
  "metrics": {
    "avgFunctionLength": 14.2,
    "maxDepth": 7,
    "cyclomaticHotspots": 5
  },
  "symbols": {
    "functions": 312,
    "classes": 27,
    "exports": 156
  },
  "artifacts": [
    { "type": "summary", "uri": "handoff://summary/session-..." },
    { "type": "symbolIndex", "uri": "handoff://analysis/symbols/session-..." }
  ],
  "timestamp": "2025-08-02T12:00:00.000Z"
}
```

- analyzeCodebase failure examples
```json
{ "success": false, "error": "Path not found", "errorCode": "VALIDATION_ERROR", "details": { "rootPath": "unknown/" } }
```
```json
{ "success": false, "error": "Repository too large for configured limits", "errorCode": "RATE_LIMITED", "details": { "limit": "maxFiles=10000" } }
```

Operational Notes
- Performance: Large repositories can be slow to scan; see ../performance.md for tuning (I/O concurrency, caching).
- Limits: Max file count, ignored patterns, and depth are configurable; see ../configuration.md.
- Caching: Results may be cached in Redis to accelerate repeated analysis runs.
- Persistence: Only summary/artifact references are stored by default; raw scans are ephemeral unless configured.

Security Considerations
- Path traversal protections are enforced in the analyzer module.
- Secrets-in-code scanning is disabled by default; enable only if appropriate and ensure proper handling of findings.
- Avoid exposing raw source content unless necessary; prefer metadata and summaries.

Troubleshooting
- Empty results: verify patterns and depth; check logs for ignored paths.
- Timeouts: increase operation timeout and/or reduce patterns; review metrics in ../performance.md.
- Memory pressure: limit includeSymbolIndex; adjust worker concurrency.

Related
- Sessions: ./sessions.md
- Context: ./context.md
- Handoff: ./handoff.md
- API Reference: ../api-reference.md
- Configuration: ../configuration.md
- Performance: ../performance.md