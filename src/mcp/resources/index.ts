// MCP Resources for AI Handoff
// Resources provide read-only access to session data and context

export interface HandoffResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export const HANDOFF_RESOURCES: HandoffResource[] = [
  {
    uri: 'handoff://sessions',
    name: 'Active Sessions',
    description: 'List of active handoff sessions',
    mimeType: 'application/json'
  },
  {
    uri: 'handoff://context/{sessionKey}',
    name: 'Session Context',
    description: 'Complete context history for a session',
    mimeType: 'application/json'
  },
  {
    uri: 'handoff://summary/{sessionKey}',
    name: 'Context Summary',
    description: 'Summarized context for quick handoff overview',
    mimeType: 'application/json'
  },
  {
    uri: 'handoff://agents/{agentId}/sessions',
    name: 'Agent Sessions',
    description: 'Sessions associated with a specific agent',
    mimeType: 'application/json'
  }
];

export function parseResourceUri(uri: string): { type: string; params: Record<string, string> } {
  const match = uri.match(/^handoff:\/\/([^\/]+)(?:\/(.+))?$/);
  if (!match) {
    throw new Error(`Invalid handoff resource URI: ${uri}`);
  }

  const [, type, path] = match;
  const params: Record<string, string> = {};

  if (path) {
    // Handle parameterized paths like context/{sessionKey}
    if (type === 'context' || type === 'summary') {
      params.sessionKey = path;
    } else if (type === 'agents') {
      const agentMatch = path.match(/^([^\/]+)\/sessions$/);
      if (agentMatch) {
        params.agentId = agentMatch[1];
      }
    }
  }

  return { type, params };
}