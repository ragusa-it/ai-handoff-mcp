# Usage: Context

This guide covers adding context to sessions, retrieving it, and summarization behavior.

Add Context updateContext
```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({ command: 'node', args: ['dist/server.js'] });
const client = new Client({ name: 'docs-example', version: '1.0.0' }, { capabilities: {} });
await client.connect(transport);

// Assume sessionKey comes from registerSession
const res = await client.callTool({
  name: 'updateContext',
  arguments: {
    sessionKey: 'session-1722600000000',
    contextType: 'message',
    content: 'User asked to continue with implementation details',
    metadata: { source: 'user', topic: 'implementation' }
  }
});

const payload = JSON.parse(res.content[0].text);
console.log('Context entry:', payload.contextEntry);
```

Expected Response Shape
```json
{
  "success": true,
  "message": "Context updated successfully",
  "contextEntry": {
    "id": "uuid",
    "sequenceNumber": 3,
    "contextType": "message",
    "contentLength": 46,
    "createdAt": "2025-08-02T12:05:00.000Z"
  },
  "session": {
    "id": "uuid",
    "sessionKey": "session-1722600000000",
    "status": "active"
  }
}
```

Context Types
- message: free-form text, prompts, instructions
- file: file references or extracts
- tool_call: structured tool invocation artifacts
- system: system-generated entries audit, lifecycle, summaries

Operational Notes
- updateContext validates the session is active and reactivates dormant sessions
- Large content updates are recorded with content_size_bytes metrics
- Latest context preview cached with TTL to accelerate reads

Retrieve Context via Resource
```ts
// Using MCP resource access if available in your client
// const history = await client.accessResource({ uri: `handoff://context/${sessionKey}` });
// console.log('Full context:', history.contents[0].text);
```

Merge and Organization Tips
- Keep entries small and frequent to improve summarization quality
- Use metadata to tag source, intent, and topic for downstream agents
- Use system entries to track milestones and handoff boundaries

Related
- Sessions: ./sessions.md
- Handoff Requests: ./handoff.md
- Resources: ./resources.md