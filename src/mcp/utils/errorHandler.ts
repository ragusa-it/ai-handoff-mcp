import { structuredLogger } from '../../services/structuredLogger.js';

export interface ToolErrorContext {
  toolName: string;
  executionTimeMs: number;
  sessionId?: string;
  inputParameters: Record<string, any>;
  errorMessage: string;
  metadata?: Record<string, any>;
}

export interface SystemErrorContext {
  component: string;
  operation: string;
  sessionId?: string;
  additionalInfo?: Record<string, any>;
}

/**
 * Standardized error handling for MCP tools
 */
export function handleToolError(
  error: unknown,
  toolContext: ToolErrorContext,
  systemContext: SystemErrorContext
) {
  const errorInstance = error instanceof Error ? error : new Error('Unknown error');
  
  // Log error with structured logging
  const errorContext: any = {
    timestamp: new Date(),
    errorType: 'SystemError',
    component: systemContext.component,
    operation: systemContext.operation,
    additionalInfo: systemContext.additionalInfo || {}
  };
  
  if (systemContext.sessionId) {
    errorContext.sessionId = systemContext.sessionId;
  }
  
  structuredLogger.logError(errorInstance, errorContext);

  // Log tool call failure
  const toolCallContext: any = {
    timestamp: new Date(),
    toolName: toolContext.toolName,
    executionTimeMs: toolContext.executionTimeMs,
    success: false,
    inputParameters: toolContext.inputParameters,
    errorMessage: toolContext.errorMessage,
    metadata: toolContext.metadata || {}
  };
  
  if (toolContext.sessionId) {
    toolCallContext.sessionId = toolContext.sessionId;
  }
  
  structuredLogger.logToolCall(toolCallContext);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: `Failed to ${systemContext.operation}`,
          details: errorInstance.message
        }, null, 2)
      }
    ]
  };
}

/**
 * Standardized success response formatting
 */
export function createSuccessResponse(data: any): any {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2)
      }
    ]
  };
}

/**
 * Standardized failure response formatting
 */
export function createFailureResponse(error: string, details?: any): any {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          success: false,
          error,
          ...details
        }, null, 2)
      }
    ]
  };
}