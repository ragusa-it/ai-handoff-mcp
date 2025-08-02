# Usage: Resources

MCP resources provide read-only access to session data and derived artifacts using URIs under the handoff scheme.

Available Resources
- handoff://sessions
  - Description: List of active sessions
  - MIME: application/json
- handoff://context/{sessionKey}
  - Description: Full context history for a session
  - MIME: application/json
- handoff://summary/{sessionKey}
  - Description: Summarized context for a session
  - MIME: application/json
- handoff://agents/{agentId}/sessions
  - Description: Sessions associated with a specific agent
  - MIME: application/json

Client Access Example
```ts
// Using an MCP client that supports accessResource
const sessions = await client.accessResource({ uri: 'handoff://sessions' });
// console.log('Active sessions:', sessions.contents[0].text);

const sessionKey = 'session-1722600000000';
const context = await client.accessResource({ uri: `handoff://context/${sessionKey}` });
// console.log('Context history:', context.contents[0].text);

const summary = await client.accessResource({ uri: `handoff://summary/${sessionKey}` });
// console.log('Summary:', summary.contents[0].text);

const agentSessions = await client.accessResource({ uri: 'handoff://agents/downstream-assistant/sessions' });
// console.log('Agent sessions:', agentSessions.contents[0].text);
```

Response Shapes examples
- handoff://sessions
```json
{
  "sessions": [
    { "sessionKey": "session-1722600000000", "status": "active", "agentFrom": "example-client", "createdAt": "2025-08-02T12:00:00.000Z" }
  ],
  "total": 1
}
```

- handoff://context/{sessionKey}
```json
{
  "sessionKey": "session-1722600000000",
  "entries": [
    { "sequenceNumber": 1, "contextType": "system", "content": "Session registered", "createdAt": "2025-08-02T12:00:00.000Z" },
    { "sequenceNumber": 2, "contextType": "message", "content": "Hello", "createdAt": "2025-08-02T12:01:00.000Z" }
  ],
  "hasMore": false
}
```

- handoff://summary/{sessionKey}
```json
{
  "sessionKey": "session-1722600000000",
  "summary": "User greeted and requested implementation details. Key topics: implementation.",
  "generatedAt": "2025-08-02T12:02:00.000Z"
}
```

Notes
- URIs are parsed and validated by the server resource registry
- Large contexts may be paginated or truncated with hasMore indicators
- Summaries are cached with TTL for performance

Related
- Sessions: ./sessions.md
- Context: ./context.md
- API Reference: ../api-reference.md