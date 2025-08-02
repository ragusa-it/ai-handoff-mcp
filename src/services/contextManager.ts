import { monitoredDb } from '../database/monitoredDatabase.js';
import type { Session, ContextHistoryEntry } from '../database/schema.js';
import { monitoringService } from './monitoringService.js';
import { structuredLogger } from './structuredLogger.js';
import { PerformanceTimer } from '../mcp/utils/performance.js';

export interface ContextSummary {
  sessionKey: string;
  summary: string;
  keyPoints: string[];
  messageCount: number;
  fileCount: number;
  toolCallCount: number;
  lastUpdated: Date;
  participants: string[];
}

export interface FullContext {
  session: Session;
  contextHistory: ContextHistoryEntry[];
  summary: ContextSummary;
}

class ContextManagerService {
  async getFullContext(sessionKey: string): Promise<FullContext | null> {
    const timer = new PerformanceTimer();
    const operationId = `get_full_context_${Date.now()}`;

    try {
      structuredLogger.info('Context manager operation', {
        timestamp: new Date(),
        metadata: {
          component: 'ContextManager',
          operation: 'get_full_context_start',
          status: 'started',
          operationId,
          sessionKey
        }
      });

      // Get session
      const session = await monitoredDb.getSession(sessionKey);
      if (!session) {
        const duration = timer.getElapsed();
        
        // Record metrics for failed operation
        monitoringService.recordPerformanceMetrics('get_full_context', {
          operation: 'get_full_context',
          duration,
          success: false,
          metadata: { sessionKey, reason: 'session_not_found' }
        });

        return null;
      }
      timer.checkpoint('session_retrieved');

      // Get context history
      const contextHistory = await monitoredDb.getContextHistory(session.id);
      timer.checkpoint('context_history_retrieved');

      // Generate summary
      const summary = await this.createHandoffSummary(sessionKey);
      timer.checkpoint('summary_generated');

      const duration = timer.getElapsed();
      const contextSize = JSON.stringify(contextHistory).length;

      // Record successful metrics
      monitoringService.recordPerformanceMetrics('get_full_context', {
        operation: 'get_full_context',
        duration,
        success: true,
        metadata: {
          sessionKey,
          contextEntries: contextHistory.length,
          contextSizeBytes: contextSize
        }
      });

      // Log performance metrics
      structuredLogger.info('Context manager operation', {
        timestamp: new Date(),
        metadata: {
          sessionId: session.id,
          metricName: 'context_retrieval_duration',
          metricValue: duration,
          metricType: 'timer',
          unit: 'milliseconds',
          tags: { sessionKey, contextEntries: contextHistory.length.toString() },
          performanceBreakdown: timer.getAllCheckpointDurations()
        }
      });

      structuredLogger.info('Context manager operation', {
        timestamp: new Date(),
        metadata: {
          component: 'ContextManager',
          operation: 'get_full_context_complete',
          status: 'completed',
          operationId,
          sessionId: session.id,
          durationMs: duration,
          contextEntries: contextHistory.length,
          contextSizeBytes: contextSize
        }
      });

      return {
        session,
        contextHistory,
        summary
      };
    } catch (error) {
      const duration = timer.getElapsed();

      // Record error metrics
      monitoringService.recordPerformanceMetrics('get_full_context', {
        operation: 'get_full_context',
        duration,
        success: false,
        metadata: { sessionKey, error: (error as Error).message }
      });

      // Log error
      structuredLogger.error('Context manager error', {
        timestamp: new Date(),
        metadata: {
          errorType: 'ServiceError',
          component: 'ContextManager',
          operation: 'get_full_context',
          additionalInfo: { operationId, sessionKey, durationMs: duration }
        }
      });

      throw error;
    }
  }

  async createHandoffSummary(sessionKey: string): Promise<ContextSummary> {
    const timer = new PerformanceTimer();
    const operationId = `create_handoff_summary_${Date.now()}`;

    try {
      structuredLogger.info('Context manager operation', {
        timestamp: new Date(),
        metadata: {
          component: 'ContextManager',
          operation: 'create_handoff_summary_start',
          status: 'started',
          operationId,
          sessionKey
        }
      });

      const session = await monitoredDb.getSession(sessionKey);
      if (!session) {
        throw new Error('Session not found');
      }
      timer.checkpoint('session_retrieved');

      const contextHistory = await monitoredDb.getContextHistory(session.id);
      timer.checkpoint('context_history_retrieved');

      // Analyze context types
      const messageCount = contextHistory.filter(c => c.contextType === 'message').length;
      const fileCount = contextHistory.filter(c => c.contextType === 'file').length;
      const toolCallCount = contextHistory.filter(c => c.contextType === 'tool_call').length;
      timer.checkpoint('context_analyzed');

      // Extract key information
      const keyPoints = this.extractKeyPoints(contextHistory);
      const participants = this.extractParticipants(session, contextHistory);
      const summary = this.generateSummaryText(contextHistory, session);
      timer.checkpoint('summary_generated');

      const duration = timer.getElapsed();
      const summaryLength = summary.length;

      // Record performance metrics
      monitoringService.recordPerformanceMetrics('create_handoff_summary', {
        operation: 'create_handoff_summary',
        duration,
        success: true,
        metadata: {
          sessionKey,
          contextEntries: contextHistory.length,
          summaryLength,
          messageCount,
          fileCount,
          toolCallCount
        }
      });

      // Log performance metric
      structuredLogger.info('Context manager operation', {
        timestamp: new Date(),
        metadata: {
          sessionId: session.id,
          metricName: 'handoff_summary_generation_duration',
          metricValue: duration,
          metricType: 'timer',
          unit: 'milliseconds',
          tags: { sessionKey, contextEntries: contextHistory.length.toString() },
          performanceBreakdown: timer.getAllCheckpointDurations()
        }
      });

      structuredLogger.info('Context manager operation', {
        timestamp: new Date(),
        metadata: {
          component: 'ContextManager',
          operation: 'create_handoff_summary_complete',
          status: 'completed',
          operationId,
          sessionId: session.id,
          durationMs: duration,
          summaryLength,
          contextEntries: contextHistory.length
        }
      });

      return {
        sessionKey,
        summary,
        keyPoints,
        messageCount,
        fileCount,
        toolCallCount,
        lastUpdated: contextHistory.length > 0 ? contextHistory[contextHistory.length - 1].createdAt : session.createdAt,
        participants
      };
    } catch (error) {
      const duration = timer.getElapsed();

      // Record error metrics
      monitoringService.recordPerformanceMetrics('create_handoff_summary', {
        operation: 'create_handoff_summary',
        duration,
        success: false,
        metadata: { sessionKey, error: (error as Error).message }
      });

      // Log error
      structuredLogger.error('Context manager error', {
        timestamp: new Date(),
        metadata: {
          errorType: 'ServiceError',
          component: 'ContextManager',
          operation: 'create_handoff_summary',
          additionalInfo: { operationId, sessionKey, durationMs: duration }
        }
      });

      throw error;
    }
  }

  private extractKeyPoints(contextHistory: ContextHistoryEntry[]): string[] {
    const keyPoints: string[] = [];

    // Extract system actions
    const systemEntries = contextHistory.filter(c => c.contextType === 'system');
    systemEntries.forEach(entry => {
      if (entry.metadata.action) {
        keyPoints.push(`System: ${entry.metadata.action}`);
      }
    });

    // Extract important messages (simplified logic)
    const messageEntries = contextHistory.filter(c => c.contextType === 'message');
    if (messageEntries.length > 0) {
      keyPoints.push(`${messageEntries.length} messages exchanged`);
      
      // Add first and last message previews
      if (messageEntries.length > 0) {
        const firstMessage = messageEntries[0];
        keyPoints.push(`First message: ${firstMessage.content.substring(0, 100)}...`);
        
        if (messageEntries.length > 1) {
          const lastMessage = messageEntries[messageEntries.length - 1];
          keyPoints.push(`Last message: ${lastMessage.content.substring(0, 100)}...`);
        }
      }
    }

    // Extract file operations
    const fileEntries = contextHistory.filter(c => c.contextType === 'file');
    if (fileEntries.length > 0) {
      keyPoints.push(`${fileEntries.length} file operations`);
      const fileTypes = [...new Set(fileEntries.map(f => f.metadata.fileType || 'unknown'))];
      keyPoints.push(`File types: ${fileTypes.join(', ')}`);
    }

    // Extract tool calls
    const toolEntries = contextHistory.filter(c => c.contextType === 'tool_call');
    if (toolEntries.length > 0) {
      keyPoints.push(`${toolEntries.length} tool calls`);
      const tools = [...new Set(toolEntries.map(t => t.metadata.toolName || 'unknown'))];
      keyPoints.push(`Tools used: ${tools.join(', ')}`);
    }

    return keyPoints;
  }

  private extractParticipants(session: Session, contextHistory: ContextHistoryEntry[]): string[] {
    const participants = new Set<string>();
    
    // Add session agents
    participants.add(session.agentFrom);
    if (session.agentTo) {
      participants.add(session.agentTo);
    }

    // Extract from metadata if available
    contextHistory.forEach(entry => {
      if (entry.metadata.agent) {
        participants.add(entry.metadata.agent);
      }
      if (entry.metadata.user) {
        participants.add(`user:${entry.metadata.user}`);
      }
    });

    return Array.from(participants);
  }

  private generateSummaryText(contextHistory: ContextHistoryEntry[], session: Session): string {
    const totalEntries = contextHistory.length;
    const timeSpan = contextHistory.length > 0 
      ? new Date(contextHistory[contextHistory.length - 1].createdAt).getTime() - new Date(contextHistory[0].createdAt).getTime()
      : 0;
    
    const duration = timeSpan > 0 ? Math.round(timeSpan / (1000 * 60)) : 0; // minutes

    let summary = `Session '${session.sessionKey}' initiated by ${session.agentFrom}`;
    
    if (session.agentTo) {
      summary += ` with handoff requested to ${session.agentTo}`;
    }
    
    summary += `. Total of ${totalEntries} context entries`;
    
    if (duration > 0) {
      summary += ` over ${duration} minutes`;
    }
    
    summary += `. Current status: ${session.status}.`;

    // Add context breakdown
    const breakdown = this.getContextBreakdown(contextHistory);
    if (breakdown.length > 0) {
      summary += ` Context includes: ${breakdown.join(', ')}.`;
    }

    return summary;
  }

  private getContextBreakdown(contextHistory: ContextHistoryEntry[]): string[] {
    const breakdown: string[] = [];
    
    const messageCount = contextHistory.filter(c => c.contextType === 'message').length;
    if (messageCount > 0) breakdown.push(`${messageCount} messages`);
    
    const fileCount = contextHistory.filter(c => c.contextType === 'file').length;
    if (fileCount > 0) breakdown.push(`${fileCount} files`);
    
    const toolCount = contextHistory.filter(c => c.contextType === 'tool_call').length;
    if (toolCount > 0) breakdown.push(`${toolCount} tool calls`);
    
    const systemCount = contextHistory.filter(c => c.contextType === 'system').length;
    if (systemCount > 0) breakdown.push(`${systemCount} system events`);

    return breakdown;
  }

  async getSessionsByAgent(agent: string): Promise<Session[]> {
    try {
      const sessions = await monitoredDb.query<Session>(
        'SELECT * FROM sessions WHERE agentFrom = $1 OR agentTo = $1',
        [agent]
      );
      return sessions.rows;
    } catch (error) {
      console.error('Error fetching sessions by agent:', error);
      // In a full implementation, you'd add this method to DatabaseManager
      return [];
    }
  }
}

export const contextManagerService = new ContextManagerService();