# Usage: Sessions

This guide covers registering sessions and understanding the session lifecycle.

Register a Session
```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({ command: 'node', args: ['dist/server.js'] });
const client = new Client({ name: 'docs-example', version: '1.0.0' }, { capabilities: {} });
await client.connect(transport);

const res = await client.callTool({
  name: 'registerSession',
  arguments: {
    sessionKey: 'session-' + Date.now(),
    agentFrom: 'docs-example',
    metadata: { purpose: 'session-demo' }
  }
});

// Tool responses are text-wrapped JSON per MCP SDK conventions
const payload = JSON.parse(res.content[0].text);
console.log('Session:', payload.session);
```

Expected Response
```json
{
  "success": true,
  "message": "Session registered successfully",
  "session": {
    "id": "uuid",
    "sessionKey": "session-1722600000000",
    "agentFrom": "docs-example",
    "status": "active",
    "createdAt": "2025-08-02T12:00:00.000Z",
    "metadata": {
      "purpose": "session-demo"
    }
  }
}
```

Lifecycle States
- active: session is active and accepts updates
- dormant: session detected inactive past threshold, reactivates on new activity
- expired: TTL exceeded; moved to archival flow
- archived: retained read-only per retention policy

Lifecycle Diagram
```mermaid
stateDiagram-v2
  [*] --> active
  active --> dormant: inactivity threshold
  dormant --> active: new updateContext
  active --> expired: TTL exceeded
  dormant --> expired: TTL exceeded
  expired --> archived: retention policy
  archived --> [*]
```

Operational Notes
- Duplicate registration returns a failure with existing session metadata
- Expiration is scheduled via Session Manager background workflows
- A system context entry is appended upon registration for auditability

Related
- Context Updates: ./context.md
- Handoff Requests: ./handoff.md
- Resources: ./resources.md