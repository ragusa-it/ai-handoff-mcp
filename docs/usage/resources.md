# Usage: Resources

Resource Overview
MCP resources expose read-only data over URIs using the handoff:// scheme. Clients retrieve resources via the MCP readResource capability and receive JSON payloads or text depending on the endpoint.

Minimal client usage
```ts
// TypeScript example using an MCP client with readResource({ uri: string })
const res = await client.readResource({ uri: 'handoff://sessions' });
const json = JSON.parse(res.content[0].text);
console.log('Active sessions:', json.sessions?.length ?? 0);
```

Session Resources
- handoff://sessions
  - Description: List active sessions
  - Payload shape:
    ```json
    { "sessions": [ { "session_key": "string", "status": "active|ended", "agent_from": "string", "created_at": "ISO-8601" } ], "total": 0 }
    ```
- handoff://context/{session_key}
  - Description: Full context history for a specific session
  - Payload shape:
    ```json
    { "session_key": "string", "entries": [ { "sequence_number": 1, "context_type": "system|message|event", "content": "string|object", "created_at": "ISO-8601" } ], "has_more": false }
    ```
- handoff://sessions/lifecycle
  - Description: Stream/monitor session lifecycle events (created, updated, ended)
  - Payload shape (poll/read returns latest snapshot):
    ```json
    { "events": [ { "type": "created|updated|ended", "session_key": "string", "timestamp": "ISO-8601", "details": {}} ] }
    ```

System Resources
- handoff://health
  - Description: System health status (readiness/liveness, component checks)
  - Payload shape:
    ```json
    { "status": "ok|degraded|error", "components": [ { "name": "string", "status": "ok|warn|error", "details": {} } ], "timestamp": "ISO-8601" }
    ```
- handoff://metrics
  - Description: Prometheus metrics in text exposition format
  - Payload: text/plain (Prometheus exposition)
- handoff://jobs
  - Description: Background jobs status overview
  - Payload shape:
    ```json
    { "jobs": [ { "name": "string", "state": "idle|running|failed|completed", "last_run_at": "ISO-8601", "next_run_at": "ISO-8601", "runs": { "success": 0, "failed": 0 } } ] }
    ```
- handoff://jobs/{job_name}
  - Description: Details for a specific job
  - Payload shape:
    ```json
    { "name": "string", "state": "idle|running|failed|completed", "last_error": "string|null", "history": [ { "run_at": "ISO-8601", "status": "success|failed", "duration_ms": 0 } ] }
    ```

Analytics Resources
- handoff://analytics/{type}
  - Description: Analytics datasets (sessions, handoffs, context, performance, resources)
  - Valid {type} values: "sessions", "handoffs", "context", "performance", "resources"
  - Payload shape (generic):
    ```json
    { "type": "string", "range": { "from": "ISO-8601", "to": "ISO-8601" }, "data": [ { "metric": "string", "value": 0, "dimensions": {} } ] }
    ```

Configuration Resources
- handoff://configuration
  - Description: Current configuration snapshot
  - Payload shape:
    ```json
    { "version": "string", "updated_at": "ISO-8601", "settings": { "feature_flags": {}, "limits": {}, "endpoints": {} } }
    ```
- handoff://configuration/backups
  - Description: List or details of configuration backups
  - Payload shape:
    ```json
    { "backups": [ { "id": "string", "created_at": "ISO-8601", "checksum": "string", "size_bytes": 0 } ], "total": 0 }
    ```

Usage Examples

TypeScript: sessions and context
```ts
const sessionsRes = await client.readResource({ uri: 'handoff://sessions' });
const sessionsJson = JSON.parse(sessionsRes.content[0].text);
console.log('Sessions total:', sessionsJson.total);

const session_key = sessionsJson.sessions?.[0]?.session_key ?? 'session-1722600000000';
const ctxRes = await client.readResource({ uri: `handoff://context/${session_key}` });
const ctxJson = JSON.parse(ctxRes.content[0].text);
for (const e of ctxJson.entries ?? []) {
  console.log(`#${e.sequence_number} [${e.context_type}]`, e.created_at);
}
```

TypeScript: system health and metrics
```ts
const healthRes = await client.readResource({ uri: 'handoff://health' });
const health = JSON.parse(healthRes.content[0].text);
console.log('Health:', health.status);

const metricsRes = await client.readResource({ uri: 'handoff://metrics' });
// Prometheus exposition text is in metricsRes.content[0].text
console.log(metricsRes.content[0].text.split('\n').slice(0, 5).join('\n'));
```

TypeScript: jobs overview and specific job
```ts
const jobsRes = await client.readResource({ uri: 'handoff://jobs' });
const jobs = JSON.parse(jobsRes.content[0].text);
console.log('Jobs:', jobs.jobs.map((j: any) => `${j.name}:${j.state}`).join(', '));

const job_name = jobs.jobs?.[0]?.name ?? 'daily_aggregation';
const jobDetailRes = await client.readResource({ uri: `handoff://jobs/${job_name}` });
const jobDetail = JSON.parse(jobDetailRes.content[0].text);
console.log('Job history entries:', jobDetail.history?.length ?? 0);
```

TypeScript: analytics datasets
```ts
const types = ['sessions', 'handoffs', 'context', 'performance', 'resources'] as const;
for (const t of types) {
  const res = await client.readResource({ uri: `handoff://analytics/${t}` });
  const body = JSON.parse(res.content[0].text);
  console.log(`[analytics:${t}]`, (body.data ?? []).length);
}
```

TypeScript: configuration and backups
```ts
const cfgRes = await client.readResource({ uri: 'handoff://configuration' });
const cfg = JSON.parse(cfgRes.content[0].text);
console.log('Config version:', cfg.version);

const backupsRes = await client.readResource({ uri: 'handoff://configuration/backups' });
const backups = JSON.parse(backupsRes.content[0].text);
console.log('Backups:', backups.total);
```

Notes
- URIs are validated by the server resource registry.
- Large payloads may be truncated or paginated with has_more indicators.
- Use snake_case tool and parameter names when cross-referencing tools elsewhere in docs.

Related
- Sessions: ./sessions.md
- Context: ./context.md
- API Reference: ../api-reference.md