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
  - session_key string required
  - agent_from string required
  - metadata object optional
- Returns
  - success boolean
  - message string
  - session object id, session_key, agent_from, status, created_at, metadata

Example
```ts
const res = await client.callTool({
  name: 'register_session',
  arguments: { session_key: 'session-' + Date.now(), agent_from: 'docs', metadata: { purpose: 'api-ref' } }
});
const payload = JSON.parse(res.content[0].text);
```

Failure Example duplicate
```json
{
  "success": false,
  "error": "Session already exists",
  "details": {
    "session_key": "session-...",
    "existing_session": { "id": "uuid", "status": "active", "agent_from": "docs", "created_at": "..." }
  }
}
```

update_context
- Purpose: Append a context entry to an active session with sequencing
- Arguments
  - session_key string required
  - context_type message file tool_call system required
  - content string required
  - metadata object optional
- Returns
  - success boolean
  - message string
  - context_entry object id, sequence_number, context_type, content_length, created_at
  - session object id, session_key, status

Example
```ts
const res = await client.callTool({
  name: 'update_context',
  arguments: { session_key, context_type: 'message', content: 'Hello', metadata: { source: 'user' } }
});
const payload = JSON.parse(res.content[0].text);
```

Error Cases
- Session not found
```json
{ "success": false, "error": "Session not found", "session_key": "..." }
```
- Session not active
```json
{ "success": false, "error": "Session is not active", "session_key": "...", "current_status": "expired" }
```

request_handoff
- Purpose: Prepare and request a handoff to a target agent
- Arguments
  - session_key string required
  - target_agent string required
  - request_type context_transfer full_handoff collaboration required
  - request_data object optional includes instructions, priority
- Returns
  - success boolean
  - handoff_id string
  - status string pending completed failed
  - timestamp ISO string

Example
```ts
const res = await client.callTool({
  name: 'request_handoff',
  arguments: {
    session_key,
    target_agent: 'downstream-assistant',
    request_type: 'context_transfer',
    request_data: { instructions: 'Continue', priority: 'normal' }
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
  - options object optional validate_only boolean, restart_required boolean
- Returns
  - success boolean
  - restart_required boolean
  - validation_errors string[] optional

manage_configuration_backup
- Purpose: Manage configuration backups
- Arguments
  - action string required create restore list delete
  - backup_id string optional required for restore delete
  - options object optional action-specific
- Returns
  - success boolean
  - backup_id string for create
  - backups array for list

analyze_codebase
- Purpose: Analyze codebase files and extract context
- Arguments
  - session_key string required
  - file_paths string[] required
  - analysis_type string optional syntax dependencies structure full
- Returns
  - success boolean
  - analyzed_files number
  - context_summary object

Example
```ts
const res = await client.callTool({
  name: 'analyze_codebase',
  arguments: { session_key, file_paths: ['src/index.ts','src/server.ts'], analysis_type: 'structure' }
});
const payload = JSON.parse(res.content[0].text);
```

get_job_status
- Purpose: Get background job status and statistics
- Arguments
  - job_name string optional
- Returns
  - success boolean
  - jobs array name, status, last_run_at, next_run_at, runs, failures

Example
```ts
const res = await client.callTool({
  name: 'get_job_status',
  arguments: { job_name: 'analytics-rollup' }
});
const payload = JSON.parse(res.content[0].text);
```

run_job_now
- Purpose: Manually trigger background jobs
- Arguments
  - job_name string required
- Returns
  - success boolean
  - job object name, triggered_at, result

Example
```ts
const res = await client.callTool({
  name: 'run_job_now',
  arguments: { job_name: 'analytics-rollup' }
});
const payload = JSON.parse(res.content[0].text);
```

update_job_config
- Purpose: Update background job configuration
- Arguments
  - job_name string required
  - config object required
    - interval_ms number
    - enabled boolean
    - max_retries number
    - retry_delay_ms number
- Returns
  - success boolean
  - updated object job_name, config

Example
```ts
const res = await client.callTool({
  name: 'update_job_config',
  arguments: { job_name: 'analytics-rollup', config: { interval_ms: 300000, enabled: true } }
});
const payload = JSON.parse(res.content[0].text);
```

Resources

handoff://sessions
- Description: Active sessions JSON list
- Returns
  - sessions array session_key, status, agent_from, created_at
  - total number

handoff://context/{session_key}
- Description: Full ordered context history for a session
- Returns
  - session_key string
  - entries array sequence_number, context_type, content, created_at, metadata
  - has_more boolean

handoff://summary/{session_key}
- Description: Summarized context for quick inspection
- Returns
  - session_key string
  - summary string
  - generated_at ISO string

handoff://agents/{agent_id}/sessions
- Description: Sessions associated with an agent
- Returns
  - agent_id string
  - sessions array session_key, status, created_at

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
  "error_code": "MACHINE_CODE",
  "details": { "field": "session_key" },
  "timestamp": "2025-08-02T12:00:00Z",
  "request_id": "correlation-id"
}
```

TypeScript Types Summary indicative
- register_session_args in code: src/mcp/tools/register_session.ts
- update_context_args in code: src/mcp/tools/update_context.ts
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