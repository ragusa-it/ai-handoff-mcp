import { monitoredDb } from '../../database/monitoredDatabase.js';
import { contextManagerService } from '../../services/contextManager.js';
import { structuredLogger } from '../../services/structuredLogger.js';
import { sessionManagerService } from '../../services/sessionManager.js';
import { monitoredToolWrapper } from '../utils/monitoredToolWrapper.js';
import { monitoringService } from '../../services/monitoringService.js';

export interface RequestHandoffArgs {
  sessionKey: string;
  targetAgent: string;
  requestType?: 'context_transfer' | 'full_handoff' | 'collaboration';
  requestData?: Record<string, any>;
}

// Internal implementation without monitoring wrapper
async function _requestHandoffTool(args: RequestHandoffArgs) {
  const { sessionKey, targetAgent, requestType = 'context_transfer', requestData = {} } = args;
  const startTime = Date.now();

  try {
    // Verify session exists and is active
    const session = await monitoredDb.getSession(sessionKey);
    if (!session) {
      const executionTime = Date.now() - startTime;
      
      structuredLogger.logToolCall({
        timestamp: new Date(),
        toolName: 'requestHandoff',
        executionTimeMs: executionTime,
        success: false,
        inputParameters: { sessionKey, targetAgent, requestType },
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
        toolName: 'requestHandoff',
        executionTimeMs: executionTime,
        success: false,
        sessionId: session.id,
        inputParameters: { sessionKey, targetAgent, requestType },
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

    // Get full context for the handoff
    const contextStartTime = Date.now();
    const fullContext = await contextManagerService.getFullContext(sessionKey);
    const contextRetrievalTime = Date.now() - contextStartTime;
    
    if (!fullContext) {
      const executionTime = Date.now() - startTime;
      
      structuredLogger.logToolCall({
        timestamp: new Date(),
        toolName: 'requestHandoff',
        executionTimeMs: executionTime,
        success: false,
        sessionId: session.id,
        inputParameters: { sessionKey, targetAgent, requestType },
        errorMessage: 'Failed to retrieve context for session'
      });

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
    const summaryStartTime = Date.now();
    const handoffSummary = await contextManagerService.createHandoffSummary(sessionKey);
    const summaryTime = Date.now() - summaryStartTime;

    // Update session with target agent and track activity
    const updateStartTime = Date.now();
    await monitoredDb.updateSession(sessionKey, {
      agentTo: targetAgent,
      status: requestType === 'full_handoff' ? 'completed' : 'active',
      lastActivityAt: new Date(),
      metadata: {
        ...session.metadata,
        lastHandoffRequest: new Date().toISOString(),
        requestType,
        targetAgent
      }
    });
    const updateTime = Date.now() - updateStartTime;

    // Reactivate session if it was dormant
    if (session.isDormant) {
      await sessionManagerService.reactivateSession(session.id);
    }

    // Add context entry for the handoff request
    await monitoredDb.addContextEntry(
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
    const cacheStartTime = Date.now();
    await monitoredDb.setCache(cacheKey, handoffPackage, 24 * 3600); // Cache for 24 hours
    const cacheTime = Date.now() - cacheStartTime;

    const executionTime = Date.now() - startTime;
    const contextSize = JSON.stringify(fullContext).length;

    // Record handoff metrics
    monitoringService.recordHandoffMetrics(session.id, {
      sessionId: session.id,
      agentFrom: session.agentFrom,
      agentTo: targetAgent,
      duration: executionTime,
      success: true,
      contextSize
    });

    // Log successful handoff request
    structuredLogger.logHandoffEvent({
      timestamp: new Date(),
      sessionId: session.id,
      agentFrom: session.agentFrom,
      agentTo: targetAgent,
      handoffType: 'request',
      contextSize,
      processingTimeMs: executionTime,
      success: true,
      metadata: {
        requestType,
        contextEntries: fullContext.contextHistory.length,
        summaryLength: handoffSummary.summary.length
      }
    });

    // Log tool call success
    structuredLogger.logToolCall({
      timestamp: new Date(),
      toolName: 'requestHandoff',
      executionTimeMs: executionTime,
      success: true,
      sessionId: session.id,
      inputParameters: { sessionKey, targetAgent, requestType },
      outputData: {
        handoffType: requestType,
        contextEntries: fullContext.contextHistory.length,
        cacheKey
      },
      metadata: {
        contextRetrievalTimeMs: contextRetrievalTime,
        summaryTimeMs: summaryTime,
        updateTimeMs: updateTime,
        cacheTimeMs: cacheTime,
        contextSizeBytes: contextSize
      }
    });

    // Log performance metrics
    structuredLogger.logPerformanceMetric({
      timestamp: new Date(),
      sessionId: session.id,
      metricName: 'handoff_processing_duration',
      metricValue: executionTime,
      metricType: 'timer',
      unit: 'milliseconds',
      tags: { requestType, targetAgent, sourceAgent: session.agentFrom }
    });

    structuredLogger.logPerformanceMetric({
      timestamp: new Date(),
      sessionId: session.id,
      metricName: 'handoff_context_size',
      metricValue: contextSize,
      metricType: 'gauge',
      unit: 'bytes',
      tags: { requestType, targetAgent }
    });

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
    const executionTime = Date.now() - startTime;
    
    // Log error with structured logging
    structuredLogger.logError(error instanceof Error ? error : new Error('Unknown error'), {
      timestamp: new Date(),
      errorType: 'SystemError',
      component: 'requestHandoff',
      operation: 'handoff_request',
      sessionId: sessionKey,
      additionalInfo: { sessionKey, targetAgent, requestType }
    });

    // Log handoff failure
    structuredLogger.logHandoffEvent({
      timestamp: new Date(),
      sessionId: sessionKey,
      agentFrom: 'unknown',
      agentTo: targetAgent,
      handoffType: 'request',
      processingTimeMs: executionTime,
      success: false,
      reason: error instanceof Error ? error.message : 'Unknown error',
      metadata: { requestType }
    });

    // Log tool call failure
    structuredLogger.logToolCall({
      timestamp: new Date(),
      toolName: 'requestHandoff',
      executionTimeMs: executionTime,
      success: false,
      inputParameters: { sessionKey, targetAgent, requestType },
      errorMessage: error instanceof Error ? error.message : 'Unknown error'
    });

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

// Export monitored version
export const requestHandoffTool = monitoredToolWrapper.wrapTool(
  'requestHandoff',
  _requestHandoffTool
);