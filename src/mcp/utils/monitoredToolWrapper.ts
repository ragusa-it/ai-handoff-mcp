import { structuredLogger } from '../../services/structuredLogger.js';
import { monitoringService } from '../../services/monitoringService.js';
import { PerformanceTimer } from './performance.js';

/**
 * Tool execution context for monitoring
 */
export interface ToolExecutionContext {
  toolName: string;
  sessionId?: string;
  inputParameters: Record<string, any>;
  startTime: Date;
  executionId: string;
}

/**
 * Tool execution result for monitoring
 */
export interface ToolExecutionResult {
  success: boolean;
  duration: number;
  outputData?: any;
  errorMessage?: string;
  metadata?: Record<string, any>;
}

/**
 * Monitoring configuration for tools
 */
export interface ToolMonitoringConfig {
  enablePerformanceTracking: boolean;
  enableConcurrencyTracking: boolean;
  enableAlerts: boolean;
  slowExecutionThresholdMs: number;
  verySlowExecutionThresholdMs: number;
  maxConcurrentExecutions: number;
}

/**
 * Concurrent execution tracker
 */
class ConcurrentExecutionTracker {
  private activeExecutions = new Map<string, Set<string>>();
  private totalExecutions = new Map<string, number>();
  private maxConcurrentReached = new Map<string, number>();

  startExecution(toolName: string, executionId: string): number {
    if (!this.activeExecutions.has(toolName)) {
      this.activeExecutions.set(toolName, new Set());
      this.totalExecutions.set(toolName, 0);
      this.maxConcurrentReached.set(toolName, 0);
    }

    const activeSet = this.activeExecutions.get(toolName)!;
    activeSet.add(executionId);
    
    const currentCount = activeSet.size;
    const maxReached = this.maxConcurrentReached.get(toolName)!;
    
    if (currentCount > maxReached) {
      this.maxConcurrentReached.set(toolName, currentCount);
    }

    this.totalExecutions.set(toolName, this.totalExecutions.get(toolName)! + 1);

    return currentCount;
  }

  endExecution(toolName: string, executionId: string): number {
    const activeSet = this.activeExecutions.get(toolName);
    if (activeSet) {
      activeSet.delete(executionId);
      return activeSet.size;
    }
    return 0;
  }

  getCurrentConcurrency(toolName: string): number {
    return this.activeExecutions.get(toolName)?.size || 0;
  }

  getStats(toolName?: string) {
    if (toolName) {
      return {
        active: this.getCurrentConcurrency(toolName),
        total: this.totalExecutions.get(toolName) || 0,
        maxConcurrent: this.maxConcurrentReached.get(toolName) || 0
      };
    }

    const stats: Record<string, any> = {};
    for (const [tool, activeSet] of this.activeExecutions) {
      stats[tool] = {
        active: activeSet.size,
        total: this.totalExecutions.get(tool) || 0,
        maxConcurrent: this.maxConcurrentReached.get(tool) || 0
      };
    }
    return stats;
  }
}

/**
 * Monitored Tool Wrapper
 * Provides comprehensive monitoring for MCP tool executions
 */
export class MonitoredToolWrapper {
  private config: ToolMonitoringConfig;
  private concurrencyTracker = new ConcurrentExecutionTracker();
  private responseTimeTracker = new Map<string, number[]>();

  constructor(config?: Partial<ToolMonitoringConfig>) {
    this.config = {
      enablePerformanceTracking: true,
      enableConcurrencyTracking: true,
      enableAlerts: true,
      slowExecutionThresholdMs: 2000,
      verySlowExecutionThresholdMs: 10000,
      maxConcurrentExecutions: 10,
      ...config
    };
  }

  /**
   * Wrap a tool function with comprehensive monitoring
   */
  wrapTool<TArgs, TResult>(
    toolName: string,
    toolFunction: (args: TArgs) => Promise<TResult>
  ): (args: TArgs) => Promise<TResult> {
    return async (args: TArgs): Promise<TResult> => {
      const executionId = `${toolName}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const timer = new PerformanceTimer();
      const extractedSessionId = this.extractSessionId(args);
      const context: ToolExecutionContext = {
        toolName,
        sessionId: extractedSessionId || '',
        inputParameters: this.sanitizeInputParameters(args),
        startTime: new Date(),
        executionId
      };

      let result: TResult;
      let success = true;
      let errorMessage: string | undefined;
      let concurrentExecutions = 0;

      try {
        // Track concurrent executions
        if (this.config.enableConcurrencyTracking) {
          concurrentExecutions = this.concurrencyTracker.startExecution(toolName, executionId);
          
          // Alert on high concurrency
          if (concurrentExecutions > this.config.maxConcurrentExecutions) {
            await this.triggerConcurrencyAlert(toolName, concurrentExecutions);
          }
        }

        // Log tool execution start
        structuredLogger.logToolCall({
          timestamp: context.startTime,
          toolName,
          executionTimeMs: 0,
          success: true,
          ...(extractedSessionId && { sessionId: extractedSessionId }),
          inputParameters: context.inputParameters,
          metadata: {
            executionId,
            concurrentExecutions,
            phase: 'start'
          }
        });

        // Execute the tool
        result = await toolFunction(args);
        
        const duration = timer.getElapsed();

        // Track response times
        if (this.config.enablePerformanceTracking) {
          this.trackResponseTime(toolName, duration);
        }

        // Check for slow execution and trigger alerts
        if (this.config.enableAlerts) {
          await this.checkPerformanceAndAlert(toolName, duration, context);
        }

        // Record successful execution metrics
        monitoringService.recordToolCall(toolName, duration, success, {
          sessionId: context.sessionId,
          concurrentExecutions,
          executionId
        });

        // Log successful tool completion
        structuredLogger.logToolCall({
          timestamp: new Date(),
          toolName,
          executionTimeMs: duration,
          success,
          ...(extractedSessionId && { sessionId: extractedSessionId }),
          inputParameters: context.inputParameters,
          outputData: this.sanitizeOutputData(result),
          metadata: {
            executionId,
            concurrentExecutions,
            phase: 'complete',
            performanceBreakdown: timer.getAllCheckpointDurations()
          }
        });

        return result;

      } catch (error) {
        success = false;
        errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const duration = timer.getElapsed();

        // Record failed execution metrics
        monitoringService.recordToolCall(toolName, duration, success, {
          sessionId: context.sessionId,
          concurrentExecutions,
          executionId,
          errorMessage
        });

        // Log tool execution error
        structuredLogger.logError(error as Error, {
          timestamp: new Date(),
          errorType: 'ToolExecutionError',
          component: 'MonitoredToolWrapper',
          operation: toolName,
          ...(extractedSessionId && { sessionId: extractedSessionId }),
          additionalInfo: {
            executionId,
            inputParameters: context.inputParameters,
            concurrentExecutions,
            durationMs: duration
          }
        });

        // Log failed tool call
        structuredLogger.logToolCall({
          timestamp: new Date(),
          toolName,
          executionTimeMs: duration,
          success,
          ...(extractedSessionId && { sessionId: extractedSessionId }),
          inputParameters: context.inputParameters,
          errorMessage,
          metadata: {
            executionId,
            concurrentExecutions,
            phase: 'error'
          }
        });

        throw error;

      } finally {
        // End concurrent execution tracking
        if (this.config.enableConcurrencyTracking) {
          this.concurrencyTracker.endExecution(toolName, executionId);
        }
      }
    };
  }

  /**
   * Get tool execution statistics
   */
  getToolStats(toolName?: string) {
    const concurrencyStats = this.concurrencyTracker.getStats(toolName);
    
    if (toolName) {
      const responseTimes = this.responseTimeTracker.get(toolName) || [];
      return {
        concurrency: concurrencyStats,
        performance: this.calculatePerformanceStats(responseTimes)
      };
    }

    const allStats: Record<string, any> = {};
    for (const [tool, responseTimes] of this.responseTimeTracker) {
      allStats[tool] = {
        concurrency: concurrencyStats[tool] || { active: 0, total: 0, maxConcurrent: 0 },
        performance: this.calculatePerformanceStats(responseTimes)
      };
    }

    return allStats;
  }

  /**
   * Update monitoring configuration
   */
  updateConfig(config: Partial<ToolMonitoringConfig>): void {
    this.config = { ...this.config, ...config };
    
    structuredLogger.logSystemEvent({
      timestamp: new Date(),
      component: 'MonitoredToolWrapper',
      operation: 'updateConfig',
      status: 'completed',
      metadata: config
    });
  }

  /**
   * Extract session ID from tool arguments
   */
  private extractSessionId(args: any): string | undefined {
    if (typeof args === 'object' && args !== null) {
      return args.sessionKey || args.sessionId;
    }
    return undefined;
  }

  /**
   * Sanitize input parameters for logging (remove sensitive data)
   */
  private sanitizeInputParameters(args: any): Record<string, any> {
    if (typeof args !== 'object' || args === null) {
      return { args: String(args) };
    }

    const sanitized: Record<string, any> = {};
    for (const [key, value] of Object.entries(args)) {
      // Skip potentially sensitive fields
      if (key.toLowerCase().includes('password') || 
          key.toLowerCase().includes('token') || 
          key.toLowerCase().includes('secret')) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'string' && value.length > 1000) {
        // Truncate very long strings
        sanitized[key] = value.substring(0, 1000) + '... [TRUNCATED]';
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Sanitize output data for logging
   */
  private sanitizeOutputData(result: any): any {
    if (typeof result !== 'object' || result === null) {
      return result;
    }

    // For MCP tool responses, typically extract just the success status and basic info
    if (result.content && Array.isArray(result.content)) {
      return {
        contentType: 'mcp_response',
        contentCount: result.content.length,
        hasText: result.content.some((c: any) => c.type === 'text'),
        hasImage: result.content.some((c: any) => c.type === 'image')
      };
    }

    return { resultType: typeof result };
  }

  /**
   * Track response time for performance analysis
   */
  private trackResponseTime(toolName: string, duration: number): void {
    if (!this.responseTimeTracker.has(toolName)) {
      this.responseTimeTracker.set(toolName, []);
    }

    const times = this.responseTimeTracker.get(toolName)!;
    times.push(duration);

    // Keep only last 100 response times to prevent memory growth
    if (times.length > 100) {
      times.shift();
    }
  }

  /**
   * Calculate performance statistics from response times
   */
  private calculatePerformanceStats(responseTimes: number[]) {
    if (responseTimes.length === 0) {
      return {
        count: 0,
        avgResponseTime: 0,
        minResponseTime: 0,
        maxResponseTime: 0,
        p95ResponseTime: 0,
        p99ResponseTime: 0
      };
    }

    const sorted = [...responseTimes].sort((a, b) => a - b);
    const sum = responseTimes.reduce((a, b) => a + b, 0);

    return {
      count: responseTimes.length,
      avgResponseTime: sum / responseTimes.length,
      minResponseTime: sorted[0],
      maxResponseTime: sorted[sorted.length - 1],
      p95ResponseTime: sorted[Math.floor(sorted.length * 0.95)],
      p99ResponseTime: sorted[Math.floor(sorted.length * 0.99)]
    };
  }

  /**
   * Check performance and trigger alerts if needed
   */
  private async checkPerformanceAndAlert(
    toolName: string, 
    duration: number, 
    context: ToolExecutionContext
  ): Promise<void> {
    if (duration > this.config.verySlowExecutionThresholdMs) {
      // Critical slow execution alert
      structuredLogger.logWarning(`Critical slow tool execution: ${toolName} (${duration}ms)`, {
        timestamp: new Date(),
        warningType: 'Performance',
        component: 'ToolExecution',
        threshold: this.config.verySlowExecutionThresholdMs,
        currentValue: duration,
        recommendation: 'Immediate optimization required - tool execution is critically slow',
        metadata: {
          toolName,
          executionId: context.executionId,
          sessionId: context.sessionId,
          severity: 'critical'
        }
      });

    } else if (duration > this.config.slowExecutionThresholdMs) {
      // Slow execution warning
      structuredLogger.logWarning(`Slow tool execution: ${toolName} (${duration}ms)`, {
        timestamp: new Date(),
        warningType: 'Performance',
        component: 'ToolExecution',
        threshold: this.config.slowExecutionThresholdMs,
        currentValue: duration,
        recommendation: 'Consider optimizing tool execution or checking system resources',
        metadata: {
          toolName,
          executionId: context.executionId,
          sessionId: context.sessionId,
          severity: 'warning'
        }
      });
    }
  }

  /**
   * Trigger concurrency alert
   */
  private async triggerConcurrencyAlert(toolName: string, concurrentExecutions: number): Promise<void> {
    structuredLogger.logWarning(`High concurrent tool executions: ${toolName} (${concurrentExecutions} concurrent)`, {
      timestamp: new Date(),
      warningType: 'Resource',
      component: 'ToolConcurrency',
      threshold: this.config.maxConcurrentExecutions,
      currentValue: concurrentExecutions,
      recommendation: 'Monitor system resources and consider implementing rate limiting',
      metadata: {
        toolName,
        severity: concurrentExecutions > this.config.maxConcurrentExecutions * 2 ? 'critical' : 'warning'
      }
    });

    // Log performance metric for high concurrency
    structuredLogger.logPerformanceMetric({
      timestamp: new Date(),
      metricName: 'tool_concurrent_executions',
      metricValue: concurrentExecutions,
      metricType: 'gauge',
      unit: 'count',
      tags: { 
        tool_name: toolName,
        severity: concurrentExecutions > this.config.maxConcurrentExecutions * 2 ? 'critical' : 'warning'
      }
    });
  }
}

// Export singleton instance
export const monitoredToolWrapper = new MonitoredToolWrapper();