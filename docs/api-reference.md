# API Reference

This consolidated reference describes MCP tools and resources exposed by the AI Handoff MCP Server, mapping parameters, return payloads, and error shapes. Examples are runnable TypeScript using the MCP SDK client.

Conventions
- Tool responses are returned as MCP content array with a single text item containing JSON. Use JSON.parse on content[0].text.
- Errors are returned as structured JSON in the same content channel with success false and error fields.
- Resource reads return contents array; the first item text contains JSON-encoded payloads.

Tools

register_session
- Purpose: Create a new session with lifecycle initialization
- Arguments
  - sessionKey string required
  - agentFrom string required
  - metadata object optional
- Returns
  - success boolean
  - message string
  - session object id, sessionKey, agentFrom, status, createdAt, metadata

Example
```ts
const res = await client.callTool({
  name: 'register_session',
  arguments: { sessionKey: 'session-' + Date.now(), agentFrom: 'docs', metadata: { purpose: 'api-ref' } }
});
const payload = JSON.parse(res.content[0].text);
```

Failure Example duplicate
```json
{
  "success": false,
  "error": "Session already exists",
  "details": {
    "sessionKey": "session-...",
    "existingSession": { "id": "uuid", "status": "active", "agentFrom": "docs", "createdAt": "..." }
  }
}
```

update_context
- Purpose: Append a context entry to an active session with sequencing
- Arguments
  - sessionKey string required
  - contextType message file tool_call system required
  - content string required
  - metadata object optional
- Returns
  - success boolean
  - message string
  - contextEntry object id, sequenceNumber, contextType, contentLength, createdAt
  - session object id, sessionKey, status

Example
```ts
const res = await client.callTool({
  name: 'update_context',
  arguments: { sessionKey, contextType: 'message', content: 'Hello', metadata: { source: 'user' } }
});
const payload = JSON.parse(res.content[0].text);
```

Error Cases
- Session not found
```json
{ "success": false, "error": "Session not found", "sessionKey": "..." }
```
- Session not active
```json
{ "success": false, "error": "Session is not active", "sessionKey": "...", "currentStatus": "expired" }
```

request_handoff
- Purpose: Prepare and request a handoff to a target agent
- Arguments
  - sessionKey string required
  - targetAgent string required
  - requestType context_transfer full_handoff collaboration required
  - requestData object optional includes instructions, priority
- Returns
  - success boolean
  - handoffId string
  - status string pending completed failed
  - timestamp ISO string

Example
```ts
const res = await client.callTool({
  name: 'request_handoff',
  arguments: {
    sessionKey,
    targetAgent: 'downstream-assistant',
    requestType: 'context_transfer',
    requestData: { instructions: 'Continue', priority: 'normal' }
  }
});
const payload = JSON.parse(res.content[0].text);
```

get_configuration
- Purpose: Read effective configuration snapshot
- Arguments
  - keys string[] optional limit retrieval to selected keys
- Returns
  - configuration object flattened keys to values
  - timestamp ISO string

update_configuration
- Purpose: Update configuration values with validation
- Arguments
  - updates object required map of key to new value
  - options object optional validateOnly boolean, restartRequired boolean
- Returns
  - success boolean
  - restartRequired boolean
  - validationErrors string[] optional

manage_configuration_backup
- Purpose: Manage configuration backups
- Arguments
  - action string required create restore list delete
  - backupId string optional required for restore delete
  - options object optional action-specific
- Returns
  - success boolean
  - backupId string for create
  - backups array for list

analyze_codebase
- Purpose: Analyze codebase files and extract context
- Arguments
  - includeGlobs string[] optional
  - excludeGlobs string[] optional
  - maxFiles number optional
- Returns
  - success boolean
  - analyzedFiles number
  - contextSummary object

Example
```ts
const res = await client.callTool({
  name: 'analyze_codebase',
  arguments: { includeGlobs: ['src/**/*.ts'], excludeGlobs: ['**/__tests__/**'], maxFiles: 200 }
});
const payload = JSON.parse(res.content[0].text);
```

get_job_status
- Purpose: Get background job status and statistics
- Arguments
  - jobName string optional
- Returns
  - success boolean
  - jobs array name, status, lastRunAt, nextRunAt, runs, failures

Example
```ts
const res = await client.callTool({
  name: 'get_job_status',
  arguments: {}
});
const payload = JSON.parse(res.content[0].text);
```

run_job_now
- Purpose: Manually trigger background jobs
- Arguments
  - jobName string required
- Returns
  - success boolean
  - job object name, triggeredAt, result

Example
```ts
const res = await client.callTool({
  name: 'run_job_now',
  arguments: { jobName: 'analytics-rollup' }
});
const payload = JSON.parse(res.content[0].text);
```

update_job_config
- Purpose: Update background job configuration
- Arguments
  - jobName string required
  - config object required
- Returns
  - success boolean
  - updated object jobName, config

Example
```ts
const res = await client.callTool({
  name: 'update_job_config',
  arguments: { jobName: 'analytics-rollup', config: { interval: '5m', enabled: true } }
});
const payload = JSON.parse(res.content[0].text);
```

Resources

handoff://sessions
- Description: Active sessions JSON list
- Returns
  - sessions array sessionKey, status, agentFrom, createdAt
  - total number

handoff://context/{sessionKey}
- Description: Full ordered context history for a session
- Returns
  - sessionKey string
  - entries array sequenceNumber, contextType, content, createdAt, metadata
  - hasMore boolean

handoff://summary/{sessionKey}
- Description: Summarized context for quick inspection
- Returns
  - sessionKey string
  - summary string
  - generatedAt ISO string

handoff://agents/{agentId}/sessions
- Description: Sessions associated with an agent
- Returns
  - agentId string
  - sessions array sessionKey, status, createdAt

handoff://health
- Description: System health status

handoff://metrics
- Description: Prometheus metrics

handoff://analytics/{type}
- Description: Analytics data by type: sessions, handoffs, context, performance, resources

handoff://sessions/lifecycle
- Description: Session lifecycle monitoring

handoff://configuration
- Description: System configuration snapshot

handoff://configuration/backups
- Description: Configuration backups listing

handoff://jobs
- Description: Background jobs status overview

handoff://jobs/{jobName}
- Description: Specific job details including scheduling and last run

Error Reference

Common Error Types
- VALIDATION_ERROR 400 invalid parameters or schema
- SESSION_NOT_FOUND 404 session missing
- SESSION_EXPIRED 410 session no longer active
- HANDOFF_FAILED 502 handoff preparation failure
- RATE_LIMITED 429 throttling
- INTERNAL_ERROR 500 unexpected error

Error Payload Shape
```json
{
  "success": false,
  "error": "Human-readable message",
  "errorCode": "MACHINE_CODE",
  "details": { "field": "sessionKey" },
  "timestamp": "2025-08-02T12:00:00Z",
  "requestId": "correlation-id"
}
```

TypeScript Types Summary indicative
- RegisterSessionArgs in code: src/mcp/tools/registerSession.ts
- UpdateContextArgs in code: src/mcp/tools/updateContext.ts
- Resources catalog: src/mcp/resources/index.ts

Cross-References
- Sessions usage: ./usage/sessions.md
- Context usage: ./usage/context.md
- Handoff usage: ./usage/handoff.md
- Configuration usage: ./usage/configuration.md
- Resources usage: ./usage/resources.md

Notes on MCP Mapping
- callTool corresponds to tool name exports defined in src/mcp/tools/index.ts
- accessResource uses URIs defined in src/mcp/resources/index.ts
- All examples are aligned with tests under src/mcp/tools/__tests__ and test/integration for verifiability