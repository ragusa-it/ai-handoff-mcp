# AI Handoff MCP Server API Documentation

## Overview

The AI Handoff MCP Server provides a comprehensive API for managing context handoffs between AI systems using the Model Context Protocol (MCP). This documentation covers all available endpoints, tools, and resources.

## Table of Contents

1. [Core Tools](#core-tools)
2. [Resources](#resources)
3. [Configuration Management](#configuration-management)
4. [Session Management](#session-management)
5. [Context Operations](#context-operations)
6. [Error Handling](#error-handling)
7. [Authentication](#authentication)
8. [Rate Limiting](#rate-limiting)
9. [Examples](#examples)

## Core Tools

### registerSession

Registers a new session for context handoff operations.

**Parameters:**
- `sessionId` (string, required): Unique identifier for the session
- `metadata` (object, optional): Session metadata including:
  - `clientName` (string): Name of the client initiating the session
  - `clientVersion` (string): Version of the client
  - `capabilities` (string[]): List of client capabilities

**Returns:**
- `success` (boolean): Whether the session was registered successfully
- `sessionId` (string): The session ID
- `timestamp` (string): ISO 8601 timestamp of registration

**Example:**
```javascript
const response = await client.callTool({
  name: 'registerSession',
  arguments: {
    sessionId: 'session-123',
    metadata: {
      clientName: 'MyAIApp',
      clientVersion: '1.0.0',
      capabilities: ['text', 'image']
    }
  }
});
```

### updateContext

Updates the context for a session with new information.

**Parameters:**
- `sessionId` (string, required): Session identifier
- `contextData` (object, required): Context data to add/update:
  - `entries` (array): Array of context entries
  - `timestamp` (string): ISO 8601 timestamp
  - `source` (string): Source of the context data
- `options` (object, optional): Update options:
  - `mergeStrategy` (string): How to merge with existing context ('replace', 'append', 'merge')
  - `ttl` (number): Time-to-live in seconds

**Returns:**
- `success` (boolean): Whether the context was updated successfully
- `entriesAdded` (number): Number of entries added
- `totalEntries` (number): Total entries in context

**Example:**
```javascript
const response = await client.callTool({
  name: 'updateContext',
  arguments: {
    sessionId: 'session-123',
    contextData: {
      entries: [
        {
          id: 'entry-1',
          type: 'text',
          content: 'User requested information about AI models',
          timestamp: new Date().toISOString()
        }
      ],
      source: 'user-interaction'
    },
    options: {
      mergeStrategy: 'append',
      ttl: 3600
    }
  }
});
```

### requestHandoff

Requests a context handoff to another AI system.

**Parameters:**
- `sessionId` (string, required): Session identifier
- `targetSystem` (string, required): Target AI system identifier
- `handoffData` (object, required): Data for handoff:
  - `context` (object): Context to handoff
  - `instructions` (string): Instructions for the receiving system
  - `priority` (string): Priority level ('low', 'normal', 'high', 'critical')
- `options` (object, optional): Handoff options:
  - `timeout` (number): Timeout in seconds
  - `retryAttempts` (number): Number of retry attempts

**Returns:**
- `success` (boolean): Whether the handoff was successful
- `handoffId` (string): Unique identifier for the handoff
- `status` (string): Status of the handoff ('pending', 'completed', 'failed')
- `timestamp` (string): ISO 8601 timestamp of handoff

**Example:**
```javascript
const response = await client.callTool({
  name: 'requestHandoff',
  arguments: {
    sessionId: 'session-123',
    targetSystem: 'code-assistant-v2',
    handoffData: {
      context: {
        // Context data to handoff
      },
      instructions: 'Continue helping the user with their coding question',
      priority: 'high'
    },
    options: {
      timeout: 30,
      retryAttempts: 2
    }
  }
});
```

### getConfiguration

Retrieves the current server configuration.

**Parameters:**
- `keys` (string[], optional): Specific configuration keys to retrieve

**Returns:**
- `configuration` (object): Current configuration values
- `timestamp` (string): ISO 8601 timestamp of retrieval

**Example:**
```javascript
const response = await client.callTool({
  name: 'getConfiguration',
  arguments: {
    keys: ['logging.level', 'database.poolSize']
  }
});
```

### updateConfiguration

Updates server configuration values.

**Parameters:**
- `updates` (object, required): Configuration updates as key-value pairs
- `options` (object, optional): Update options:
  - `validateOnly` (boolean): Only validate without applying changes
  - `restartRequired` (boolean): Whether a restart is required for changes to take effect

**Returns:**
- `success` (boolean): Whether the configuration was updated successfully
- `restartRequired` (boolean): Whether a restart is required
- `validationErrors` (string[]): Any validation errors encountered

**Example:**
```javascript
const response = await client.callTool({
  name: 'updateConfiguration',
  arguments: {
    updates: {
      'logging.level': 'debug',
      'database.poolSize': 20
    },
    options: {
      validateOnly: false
    }
  }
});
```

### manageConfigurationBackup

Manages configuration backups (create, restore, list).

**Parameters:**
- `action` (string, required): Action to perform ('create', 'restore', 'list', 'delete')
- `backupId` (string, optional): Backup identifier (required for restore/delete)
- `options` (object, optional): Action-specific options

**Returns:**
- `success` (boolean): Whether the action was successful
- `backups` (array): List of backups (for list action)
- `backupId` (string): ID of created backup (for create action)

**Example:**
```javascript
// Create backup
const createResponse = await client.callTool({
  name: 'manageConfigurationBackup',
  arguments: {
    action: 'create',
    options: {
      description: 'Pre-update backup'
    }
  }
});

// List backups
const listResponse = await client.callTool({
  name: 'manageConfigurationBackup',
  arguments: {
    action: 'list'
  }
});
```

## Resources

### sessionHistory

Provides access to session history and context data.

**URI:** `handoff://sessions/{sessionId}/history`

**Parameters:**
- `sessionId` (string, required): Session identifier
- `limit` (number, optional): Maximum number of entries to return
- `before` (string, optional): Timestamp to filter entries before
- `after` (string, optional): Timestamp to filter entries after

**Returns:**
- `entries` (array): Context entries
- `total` (number): Total number of entries
- `hasMore` (boolean): Whether there are more entries

**Example:**
```javascript
const response = await client.accessResource({
  uri: 'handoff://sessions/session-123/history?limit=10'
});
```

### systemMetrics

Provides access to system performance metrics.

**URI:** `handoff://system/metrics`

**Parameters:**
- `type` (string, optional): Type of metrics ('business', 'technical', 'all')
- `period` (string, optional): Time period ('1h', '6h', '24h', '7d')

**Returns:**
- `metrics` (object): Current metrics data
- `timestamp` (string): ISO 8601 timestamp of collection

**Example:**
```javascript
const response = await client.accessResource({
  uri: 'handoff://system/metrics?type=all&period=1h'
});
```

### configurationSchema

Provides access to the configuration schema.

**URI:** `handoff://configuration/schema`

**Returns:**
- `schema` (object): JSON Schema for configuration
- `version` (string): Schema version

**Example:**
```javascript
const response = await client.accessResource({
  uri: 'handoff://configuration/schema'
});
```

## Configuration Management

### Configuration Keys

The server supports the following configuration keys:

| Key | Type | Description | Default |
|-----|------|-------------|---------|
| `server.port` | number | Server port | 3000 |
| `server.host` | string | Server host | 'localhost' |
| `database.url` | string | Database connection URL | 'postgresql://localhost:5432/handoff' |
| `database.poolSize` | number | Database connection pool size | 10 |
| `redis.url` | string | Redis connection URL | 'redis://localhost:6379' |
| `logging.level` | string | Logging level ('error', 'warn', 'info', 'debug') | 'info' |
| `metrics.enabled` | boolean | Enable metrics collection | true |
| `metrics.collectionInterval` | number | Metrics collection interval (ms) | 60000 |
| `alerting.enabled` | boolean | Enable alerting | true |
| `alerting.emailRecipients` | string[] | Email recipients for alerts | [] |

### Configuration Validation

Configuration values are validated against a schema. Invalid values will result in validation errors during updates.

## Session Management

### Session Lifecycle

1. **Registration**: Create a new session using `registerSession`
2. **Context Updates**: Add context using `updateContext`
3. **Handoff**: Transfer context to another system using `requestHandoff`
4. **Completion**: Session is automatically cleaned up after TTL expiration

### Session States

- `active`: Session is active and accepting updates
- `handoff`: Session is in the process of handoff
- `completed`: Session has been completed
- `expired`: Session has expired due to TTL

## Context Operations

### Context Entry Types

| Type | Description | Example |
|------|-------------|---------|
| `text` | Text-based context | User messages, documentation |
| `code` | Code snippets | Source code, examples |
| `image` | Image data | Diagrams, screenshots |
| `file` | File references | Document paths, URLs |
| `structured` | Structured data | JSON, YAML |

### Context Merging Strategies

- `replace`: Replace entire context
- `append`: Add new entries to existing context
- `merge`: Merge entries, updating existing ones

## Error Handling

### Error Response Format

All errors follow this format:
```json
{
  "error": {
    "type": "VALIDATION_ERROR",
    "message": "Invalid session ID",
    "code": 400,
    "details": {
      "field": "sessionId",
      "value": "invalid-id"
    }
  }
}
```

### Common Error Types

| Error Type | HTTP Code | Description |
|------------|-----------|-------------|
| `VALIDATION_ERROR` | 400 | Invalid input parameters |
| `SESSION_NOT_FOUND` | 404 | Session does not exist |
| `SESSION_EXPIRED` | 410 | Session has expired |
| `HANDOFF_FAILED` | 502 | Handoff to target system failed |
| `RATE_LIMITED` | 429 | Rate limit exceeded |
| `INTERNAL_ERROR` | 500 | Internal server error |

## Authentication

The API uses API key authentication. Include the `Authorization` header with your requests:

```
Authorization: Bearer YOUR_API_KEY
```

API keys can be managed through the configuration system.

## Rate Limiting

The API implements rate limiting to prevent abuse:

- **Per IP**: 1000 requests per minute
- **Per API Key**: 5000 requests per minute
- **Per Session**: 100 requests per minute

Exceeding limits will result in a `RATE_LIMITED` error.

## Examples

### Complete Session Flow

```javascript
// 1. Register session
const sessionResponse = await client.callTool({
  name: 'registerSession',
  arguments: {
    sessionId: 'session-' + Date.now(),
    metadata: {
      clientName: 'MyAIApp',
      capabilities: ['text', 'code']
    }
  }
});

const sessionId = sessionResponse.content.sessionId;

// 2. Update context
await client.callTool({
  name: 'updateContext',
  arguments: {
    sessionId: sessionId,
    contextData: {
      entries: [
        {
          id: 'user-query-1',
          type: 'text',
          content: 'How do I implement a binary search tree?',
          timestamp: new Date().toISOString()
        }
      ],
      source: 'user'
    }
  }
});

// 3. Request handoff to code assistant
const handoffResponse = await client.callTool({
  name: 'requestHandoff',
  arguments: {
    sessionId: sessionId,
    targetSystem: 'code-assistant-v2',
    handoffData: {
      context: {
        // Context data
      },
      instructions: 'Help the user implement a binary search tree in Python',
      priority: 'normal'
    }
  }
});

console.log('Handoff ID:', handoffResponse.content.handoffId);
```

### Configuration Management

```javascript
// Get current configuration
const configResponse = await client.callTool({
  name: 'getConfiguration',
  arguments: {
    keys: ['logging.level', 'database.poolSize']
  }
});

console.log('Current config:', configResponse.content.configuration);

// Update configuration
const updateResponse = await client.callTool({
  name: 'updateConfiguration',
  arguments: {
    updates: {
      'logging.level': 'debug'
    }
  }
});

if (updateResponse.content.restartRequired) {
  console.log('Server restart required for changes to take effect');
}
```

### Monitoring and Metrics

```javascript
// Get system metrics
const metricsResponse = await client.accessResource({
  uri: 'handoff://system/metrics?type=all&period=1h'
});

const metrics = metricsResponse.contents[0].text;
console.log('System metrics:', JSON.parse(metrics));

// Get session history
const historyResponse = await client.accessResource({
  uri: `handoff://sessions/${sessionId}/history?limit=50`
});

const history = historyResponse.contents[0].text;
console.log('Session history:', JSON.parse(history));