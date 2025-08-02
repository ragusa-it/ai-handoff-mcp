# Usage: Context

This guide covers adding context to sessions, retrieving it, and summarization behavior. See implementation references in [src/mcp/tools/updateContext.ts](src/mcp/tools/updateContext.ts) and [src/services/contextManager.ts](src/services/contextManager.ts) for the exact fields and supported types.

## Tool Usage: update_context

Use the update_context tool to append one or more context entries to an existing session.

Tool name: update_context
Parameters:
- sessionKey: string (required) — identifier of the target session (from register_session).
- entries: array (required) — list of context entries to store. Each entry:
  - type: "message" | "file" | "tool_call" | "system" (required)
  - content: string (required) — primary content body. For file and tool_call, this may be a JSON/stringified payload or a concise extract.
  - metadata: object (optional) — arbitrary key/value tags (e.g., source, topic, user_id, correlation_id).

Notes:
- Batching is recommended: send multiple entries in entries to minimize round-trips.
- The tool accepts typical text sizes; very large blobs should be summarized or referenced via resources.

## Supported Context Types

- message: Free-form user/assistant text, prompts, or instructions.
  Expected fields: type="message", content (text), optional metadata (e.g., role, topic, turn_id).
- file: File reference or extracted content of a file.
  Expected fields: type="file", content (path, URI, or extract), optional metadata (e.g., mime_type, bytes, checksum).
- tool_call: Structured artifacts from tool invocations.
  Expected fields: type="tool_call", content (JSON/string describing tool name, args, result summary), optional metadata (e.g., status, latency_ms).
- system: System-generated audit, lifecycle, or summarization notes.
  Expected fields: type="system", content (text), optional metadata (e.g., stage, reason, component).

## Example: TypeScript invocation

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({ command: 'node', args: ['dist/server.js'] });
const client = new Client({ name: 'docs-example', version: '1.0.0' }, { capabilities: {} });
await client.connect(transport);

// sessionKey is obtained from register_session tool response
const sessionKey = 'session-1722600000000';

const result = await client.callTool({
  name: 'update_context',
  arguments: {
    sessionKey,
    entries: [
      {
        type: 'message',
        content: 'User asked to continue with implementation details',
        metadata: { source: 'user', topic: 'implementation' }
      },
      {
        type: 'system',
        content: 'Captured follow-up request for implementation phase',
        metadata: { stage: 'ingest' }
      }
    ]
  }
});

// Response payload is provided in res.content[0].text as JSON
const payload = JSON.parse(result.content[0].text);

// Example handling (shape may include success/message and updated counts or echo of entries)
if (payload.success) {
  console.log('Update ok:', payload.message);
  if (payload.updatedCount !== undefined) {
    console.log('Entries stored:', payload.updatedCount);
  }
  if (Array.isArray(payload.entries)) {
    console.log('Stored entries echo:', payload.entries.map(e => e.type));
  }
}
```

## Context Retrieval via Resources

You can read accumulated context using the context resource URI:
- handoff://context/{sessionKey}

Example (minimal):

```ts
// Retrieve full context for a session
const history = await client.readResource({ uri: `handoff://context/${sessionKey}` });
// Some clients expose contents as text; adapt as needed:
const text = history.contents?.[0]?.text ?? '';
console.log('Context history:', text);
```

Finding sessionKey:
- List sessions via: handoff://sessions
  - Use this to locate or enumerate sessions and extract the desired sessionKey.

```ts
// List sessions and pick a sessionKey
const sessions = await client.readResource({ uri: 'handoff://sessions' });
const raw = sessions.contents?.[0]?.text ?? '[]';
const list = JSON.parse(raw);
const sessionKey = list[0]?.sessionKey;
```

Ensure URIs are valid and use the handoff:// scheme.

## Operational Notes

- update_context validates and updates active sessions; dormant sessions may be reactivated per implementation policy.
- Large content updates may be measured via metrics (e.g., content size and timing).
- Implementations may cache recent previews to accelerate reads.

## Best Practices

- Batch updates: Prefer sending multiple entries in one update_context call to reduce overhead.
- Size limits: Avoid pushing very large blobs; store references or extracted summaries. Consider chunking if unavoidable.
- Organize entries: Use metadata to tag source, topic, stage, and correlation IDs for downstream filtering.
- Performance: Coalesce rapid-fire updates and debounce where possible; maintain a sensible entries batch size (e.g., 5–50).
- Summarize periodically: Use system entries to checkpoint summaries or milestones for faster retrieval.
- Validate inputs: Ensure type is one of message, file, tool_call, system and content is non-empty.
  
Related
- Sessions: ./sessions.md
- Handoff Requests: ./handoff.md
- Resources: ./resources.md