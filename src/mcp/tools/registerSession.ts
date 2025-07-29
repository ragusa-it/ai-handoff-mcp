import { db } from '../../database/index.js';
import { structuredLogger } from '../../services/structuredLogger.js';

export interface RegisterSessionArgs {
  sessionKey: string;
  agentFrom: string;
  metadata?: Record<string, any>;
}

export async function registerSessionTool(args: RegisterSessionArgs) {
  const { sessionKey, agentFrom, metadata = {} } = args;
  const startTime = Date.now();

  try {
    // Check if session already exists
    const existingSession = await db.getSession(sessionKey);
    if (existingSession) {
      const executionTime = Date.now() - startTime;
      
      // Log session creation attempt with existing session
      structuredLogger.logToolCall({
        timestamp: new Date(),
        toolName: 'registerSession',
        executionTimeMs: executionTime,
        success: false,
        sessionId: existingSession.id,
        inputParameters: { sessionKey, agentFrom },
        errorMessage: 'Session already exists',
        metadata: { existingSessionStatus: existingSession.status }
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'Session already exists',
              sessionKey,
              existingSession: {
                id: existingSession.id,
                status: existingSession.status,
                agentFrom: existingSession.agentFrom,
                createdAt: existingSession.createdAt
              }
            }, null, 2)
          }
        ]
      };
    }

    // Create new session
    const session = await db.createSession(sessionKey, agentFrom, metadata);

    // Add initial context entry
    await db.addContextEntry(
      session.id,
      'system',
      `Session registered by agent: ${agentFrom}`,
      { action: 'session_registered', ...metadata }
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
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
          }, null, 2)
        }
      ]
    };
  } catch (error) {
    console.error('Error registering session:', error);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: 'Failed to register session',
            details: error instanceof Error ? error.message : 'Unknown error'
          }, null, 2)
        }
      ]
    };
  }
}