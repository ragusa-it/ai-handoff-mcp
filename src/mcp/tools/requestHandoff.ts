import { db } from '../../database/index.js';
import { contextManagerService } from '../../services/contextManager.js';

export interface RequestHandoffArgs {
  sessionKey: string;
  targetAgent: string;
  requestType?: 'context_transfer' | 'full_handoff' | 'collaboration';
  requestData?: Record<string, any>;
}

export async function requestHandoffTool(args: RequestHandoffArgs) {
  const { sessionKey, targetAgent, requestType = 'context_transfer', requestData = {} } = args;

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

    // Get full context for the handoff
    const fullContext = await contextManagerService.getFullContext(sessionKey);
    
    if (!fullContext) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'Failed to retrieve context for session',
              sessionKey
            }, null, 2)
          }
        ]
      };
    }
    
    // Create handoff summary
    const handoffSummary = await contextManagerService.createHandoffSummary(sessionKey);

    // Update session with target agent
    await db.updateSession(sessionKey, {
      agentTo: targetAgent,
      status: requestType === 'full_handoff' ? 'completed' : 'active',
      metadata: {
        ...session.metadata,
        lastHandoffRequest: new Date().toISOString(),
        requestType,
        targetAgent
      }
    });

    // Add context entry for the handoff request
    await db.addContextEntry(
      session.id,
      'system',
      `Handoff requested to agent: ${targetAgent}`,
      {
        action: 'handoff_requested',
        requestType,
        targetAgent,
        contextSummary: handoffSummary.summary,
        totalContextEntries: fullContext.contextHistory.length,
        ...requestData
      }
    );

    // Cache the handoff package for the target agent
    const handoffPackage = {
      sessionKey,
      sourceAgent: session.agentFrom,
      targetAgent,
      requestType,
      handoffSummary,
      fullContext,
      requestData,
      timestamp: new Date().toISOString()
    };

    const cacheKey = `handoff:${targetAgent}:${sessionKey}`;
    await db.setCache(cacheKey, handoffPackage, 24 * 3600); // Cache for 24 hours

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: 'Handoff request processed successfully',
            handoff: {
              sessionKey,
              sourceAgent: session.agentFrom,
              targetAgent,
              requestType,
              contextSummary: handoffSummary.summary,
              contextEntries: fullContext.contextHistory.length,
              cacheKey,
              status: requestType === 'full_handoff' ? 'completed' : 'active'
            },
            instructions: {
              message: `The context has been prepared for agent '${targetAgent}'.`,
              nextSteps: [
                `The target agent can retrieve the context using sessionKey: ${sessionKey}`,
                `Context is cached and immediately available`,
                `Full context history includes ${fullContext.contextHistory.length} entries`,
                requestType === 'full_handoff' 
                  ? 'Session has been marked as completed - original agent handoff is complete'
                  : 'Session remains active for continued collaboration'
              ]
            }
          }, null, 2)
        }
      ]
    };
  } catch (error) {
    console.error('Error processing handoff request:', error);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: 'Failed to process handoff request',
            details: error instanceof Error ? error.message : 'Unknown error'
          }, null, 2)
        }
      ]
    };
  }
}