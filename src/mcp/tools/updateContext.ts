import { monitoredDb } from '../../database/monitoredDatabase.js';
import type { ContextHistoryEntry } from '../../database/schema.js';
import { structuredLogger } from '../../services/structuredLogger.js';
import { sessionManagerService } from '../../services/sessionManager.js';
import { monitoredToolWrapper } from '../utils/monitoredToolWrapper.js';

export interface UpdateContextArgs {
  sessionKey: string;
  contextType: ContextHistoryEntry['contextType'];
  content: string;
  metadata?: Record<string, any>;
}

// Internal implementation without monitoring wrapper
async function _updateContextTool(args: UpdateContextArgs) {
  const { sessionKey, contextType, content, metadata = {} } = args;
  const contentSize = Buffer.byteLength(content, 'utf8');

  try {
    // Verify session exists and is active
    const session = await monitoredDb.getSession(sessionKey);
    if (!session) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'Session not found',
              sessionKey
            }, null, 2)
          }
        ]
      };
    }

    if (session.status !== 'active') {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'Session is not active',
              sessionKey,
              currentStatus: session.status
            }, null, 2)
          }
        ]
      };
    }

    // Update session last activity timestamp
    await monitoredDb.query(
      'UPDATE sessions SET last_activity_at = NOW(), updated_at = NOW() WHERE id = $1',
      [session.id]
    );

    // Reactivate session if it was dormant
    if (session.isDormant) {
      await sessionManagerService.reactivateSession(session.id);
    }

    // Add context entry with processing time and content size
    const contextEntry = await monitoredDb.addContextEntry(
      session.id,
      contextType,
      content,
      {
        timestamp: new Date().toISOString(),
        ...metadata
      }
    );

    // Cache the latest context for quick access
    const cacheKey = `session:${sessionKey}:latest_context`;
    await monitoredDb.setCache(cacheKey, {
      lastUpdate: contextEntry.createdAt,
      contextType,
      sequenceNumber: contextEntry.sequenceNumber,
      preview: content.substring(0, 200) + (content.length > 200 ? '...' : '')
    }, 3600); // Cache for 1 hour

    // Update context entry with performance metrics
    await monitoredDb.query(
      'UPDATE context_history SET content_size_bytes = $1 WHERE id = $2',
      [contentSize, contextEntry.id]
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: 'Context updated successfully',
            contextEntry: {
              id: contextEntry.id,
              sequenceNumber: contextEntry.sequenceNumber,
              contextType: contextEntry.contextType,
              contentLength: content.length,
              createdAt: contextEntry.createdAt
            },
            session: {
              id: session.id,
              sessionKey: session.sessionKey,
              status: session.status
            }
          }, null, 2)
        }
      ]
    };
  } catch (error) {
    // Log error with structured logging
    structuredLogger.logError(error instanceof Error ? error : new Error('Unknown error'), {
      timestamp: new Date(),
      errorType: 'SystemError',
      component: 'updateContext',
      operation: 'context_update',
      sessionId: sessionKey,
      additionalInfo: { sessionKey, contextType, contentSize }
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: 'Failed to update context',
            details: error instanceof Error ? error.message : 'Unknown error'
          }, null, 2)
        }
      ]
    };
  }
}

// Export monitored version
export const updateContextTool = monitoredToolWrapper.wrapTool(
  'updateContext',
  _updateContextTool
);