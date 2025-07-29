import { db } from '../../database/index.js';
import type { ContextHistoryEntry } from '../../database/schema.js';

export interface UpdateContextArgs {
  sessionKey: string;
  contextType: ContextHistoryEntry['contextType'];
  content: string;
  metadata?: Record<string, any>;
}

export async function updateContextTool(args: UpdateContextArgs) {
  const { sessionKey, contextType, content, metadata = {} } = args;

  try {
    // Verify session exists and is active
    const session = await db.getSession(sessionKey);
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

    // Add context entry
    const contextEntry = await db.addContextEntry(
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
    await db.setCache(cacheKey, {
      lastUpdate: contextEntry.createdAt,
      contextType,
      sequenceNumber: contextEntry.sequenceNumber,
      preview: content.substring(0, 200) + (content.length > 200 ? '...' : '')
    }, 3600); // Cache for 1 hour

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
    console.error('Error updating context:', error);
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