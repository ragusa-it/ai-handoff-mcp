import { db } from '../../database/index.js';
import { structuredLogger } from '../../services/structuredLogger.js';
import { sessionManagerService } from '../../services/sessionManager.js';
import { handleToolError, createSuccessResponse, createFailureResponse } from '../utils/errorHandler.js';
import { PerformanceTimer } from '../utils/performance.js';
import { LOG_MESSAGES } from '../constants.js';

export interface RegisterSessionArgs {
  sessionKey: string;
  agentFrom: string;
  metadata?: Record<string, any>;
}

export async function registerSessionTool(args: RegisterSessionArgs) {
  const { sessionKey, agentFrom, metadata = {} } = args;
  const timer = new PerformanceTimer();

  try {
    // Check if session already exists
    const existingSession = await db.getSession(sessionKey);
    timer.checkpoint('session_check');
    
    if (existingSession) {
      // Log session creation attempt with existing session
      structuredLogger.logToolCall({
        timestamp: new Date(),
        toolName: 'registerSession',
        executionTimeMs: timer.getElapsed(),
        success: false,
        sessionId: existingSession.id,
        inputParameters: { sessionKey, agentFrom },
        errorMessage: 'Session already exists',
        metadata: { existingSessionStatus: existingSession.status }
      });

      return createFailureResponse('Session already exists', {
        sessionKey,
        existingSession: {
          id: existingSession.id,
          status: existingSession.status,
          agentFrom: existingSession.agentFrom,
          createdAt: existingSession.createdAt
        }
      });
    }

    // Create new session
    const session = await db.createSession(sessionKey, agentFrom, metadata);
    timer.checkpoint('session_created');

    // Schedule session expiration using session manager
    await sessionManagerService.scheduleExpiration(session.id);
    timer.checkpoint('expiration_scheduled');

    // Add initial context entry
    await db.addContextEntry(
      session.id,
      'system',
      LOG_MESSAGES.SESSION_REGISTERED(agentFrom),
      { action: 'session_registered', ...metadata }
    );
    timer.checkpoint('context_added');

    // Log successful session creation
    structuredLogger.logToolCall({
      timestamp: new Date(),
      toolName: 'registerSession',
      executionTimeMs: timer.getElapsed(),
      success: true,
      sessionId: session.id,
      inputParameters: { sessionKey, agentFrom },
      outputData: {
        sessionId: session.id,
        status: session.status,
        createdAt: session.createdAt
      },
      metadata: { 
        metadataKeys: Object.keys(metadata),
        performanceBreakdown: timer.getAllCheckpointDurations()
      }
    });

    return createSuccessResponse({
      success: true,
      message: 'Session registered successfully',
      session: {
        id: session.id,
        sessionKey: session.sessionKey,
        agentFrom: session.agentFrom,
        status: session.status,
        createdAt: session.createdAt,
        metadata: session.metadata
      }
    });
  } catch (error) {
    return handleToolError(
      error,
      {
        toolName: 'registerSession',
        executionTimeMs: timer.getElapsed(),
        inputParameters: { sessionKey, agentFrom },
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        metadata: { performanceBreakdown: timer.getAllCheckpointDurations() }
      },
      {
        component: 'registerSession',
        operation: 'session_creation',
        sessionId: sessionKey,
        additionalInfo: { sessionKey, agentFrom }
      }
    );
  }
}