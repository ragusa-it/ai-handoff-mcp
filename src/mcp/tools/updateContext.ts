import { db } from '../../database/index.js';
import type { ContextHistoryEntry } from '../../database/schema.js';
import { structuredLogger } from '../../services/structuredLogger.js';
import { sessionManagerService } from '../../services/sessionManager.js';

export interface UpdateContextArgs {
  sessionKey: string;
  contextType: ContextHistoryEntry['contextType'];
  content: string;
  metadata?: Record<string, any>;
}

export async function updateContextTool(args: UpdateContextArgs) {
  const { sessionKey, contextType, content, metadata = {} } = args;
  const startTime = Date.now();
  const contentSize = Buffer.byteLength(content, 'utf8');

  try {
    // Verify session exists and is active
    const session = await db.getSession(sessionKey);
    if (!session) {
      const executionTime = Date.now() - startTime;
      
      structuredLogger.logToolCall({
        timestamp: new Date(),
        toolName: 'updateContext',
        executionTimeMs: executionTime,
        success: false,
        inputParameters: { sessionKey, contextType, contentSize },
        errorMessage: 'Session not found'
      });

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
      const executionTime = Date.now() - startTime;
      
      structuredLogger.logToolCall({
        timestamp: new Date(),
        toolName: 'updateContext',
        executionTimeMs: executionTime,
        success: false,
        sessionId: session.id,
        inputParameters: { sessionKey, contextType, contentSize },
        errorMessage: 'Session is not active',
        metadata: { currentStatus: session.status }
      });

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
    await db.query(
      'UPDATE sessions SET last_activity_at = NOW(), updated_at = NOW() WHERE id = $1',
      [session.id]
    );

    // Reactivate session if it was dormant
    if (session.isDormant) {
      await sessionManagerService.reactivateSession(session.id);
    }

    // Add context entry with processing time and content size
    const contextEntry = await db.addContextEntry(
      session.id,
      contextType,
      content,
      {
        timestamp: new Date().toISOString(),
        ...metadata
      }
    );

    // Update context entry with performance metrics
    await db.query(
      'UPDATE context_history SET processing_time_ms = $1, content_size_bytes = $2 WHERE id = $3',
      [executionTime, contentSize, contextEntry.id]
    );

    // Cache the latest context for quick access
    const cacheKey = `session:${sessionKey}:latest_context`;
    const cacheStartTime = Date.now();
    await db.setCache(cacheKey, {
      lastUpdate: contextEntry.createdAt,
      contextType,
      sequenceNumber: contextEntry.sequenceNumber,
      preview: content.substring(0, 200) + (content.length > 200 ? '...' : '')
    }, 3600); // Cache for 1 hour
    const cacheTime = Date.now() - cacheStartTime;

    const executionTime = Date.now() - startTime;

    // Log successful context update with performance metrics
    structuredLogger.logToolCall({
      timestamp: new Date(),
      toolName: 'updateContext',
      executionTimeMs: executionTime,
      success: true,
      sessionId: session.id,
      inputParameters: { sessionKey, contextType, contentSize },
      outputData: {
        contextEntryId: contextEntry.id,
        sequenceNumber: contextEntry.sequenceNumber,
        contentLength: content.length
      },
      metadata: {
        cacheTimeMs: cacheTime,
        contextType,
        metadataKeys: Object.keys(metadata)
      }
    });

    // Log performance metrics for context update
    structuredLogger.logPerformanceMetric({
      timestamp: new Date(),
      sessionId: session.id,
      metricName: 'context_update_duration',
      metricValue: executionTime,
      metricType: 'timer',
      unit: 'milliseconds',
      tags: { contextType, sessionKey }
    });

    structuredLogger.logPerformanceMetric({
      timestamp: new Date(),
      sessionId: session.id,
      metricName: 'context_content_size',
      metricValue: contentSize,
      metricType: 'gauge',
      unit: 'bytes',
      tags: { contextType, sessionKey }
    });

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
    const executionTime = Date.now() - startTime;
    
    // Log error with structured logging
    structuredLogger.logError(error instanceof Error ? error : new Error('Unknown error'), {
      timestamp: new Date(),
      errorType: 'SystemError',
      component: 'updateContext',
      operation: 'context_update',
      sessionId: sessionKey,
      additionalInfo: { sessionKey, contextType, contentSize }
    });

    // Log tool call failure
    structuredLogger.logToolCall({
      timestamp: new Date(),
      toolName: 'updateContext',
      executionTimeMs: executionTime,
      success: false,
      inputParameters: { sessionKey, contextType, contentSize },
      errorMessage: error instanceof Error ? error.message : 'Unknown error'
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