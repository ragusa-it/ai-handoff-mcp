import { 
  LogLevel, 
  BaseLogContext, 
  ToolCallContext, 
  HandoffContext, 
  SystemContext, 
  ErrorContext, 
  WarningContext, 
  PerformanceMetric, 
  ResourceUsage, 
  IStructuredLogger 
} from '../../src/services/structuredLogger';

// Mock implementation of StructuredLogger for testing
export class MockStructuredLogger implements IStructuredLogger {
  logs: Array<{ level: LogLevel; message: string; context?: any }> = [];
  
  // Implement all required methods from the interface
  logToolCall(context: ToolCallContext): void {
    this.log(LogLevel.INFO, `Tool call: ${context.toolName}`, context);
  }
  
  logHandoffEvent(context: HandoffContext): void {
    const message = `Handoff ${context.handoffType} from ${context.agentFrom} to ${context.agentTo}`;
    this.log(context.success ? LogLevel.INFO : LogLevel.WARN, message, context);
  }
  
  logSystemEvent(context: SystemContext): void {
    const message = `${context.component} ${context.operation} ${context.status}`;
    const level = context.status === 'failed' ? LogLevel.ERROR : LogLevel.INFO;
    this.log(level, message, context);
  }
  
  // Error logging - matches the actual interface
  logError(error: Error, context: ErrorContext): void {
    const enhancedContext = {
      ...context,
      errorMessage: error.message,
      errorName: error.name,
      stackTrace: error.stack
    };
    this.log(LogLevel.ERROR, error.message, enhancedContext);
  }
  
  logWarning(message: string, context: WarningContext): void {
    this.log(LogLevel.WARN, message, context);
  }
  
  logPerformanceMetric(metric: PerformanceMetric): void {
    this.log(LogLevel.INFO, `Performance metric: ${metric.metricName}`, metric);
  }
  
  logResourceUsage(usage: ResourceUsage): void {
    this.log(LogLevel.INFO, 'Resource usage', usage);
  }
  
  log(level: LogLevel, message: string, context?: BaseLogContext): void {
    const logEntry = { 
      level, 
      message, 
      context: {
        timestamp: new Date(),
        ...context
      } 
    };
    
    this.logs.push(logEntry);
    
    // Also log to console for test debugging
    const levelStr = LogLevel[level].toUpperCase();
    console.log(`[${levelStr}] ${message}`, logEntry.context || '');
  }
  
  // Convenience methods for testing
  debug(message: string, context?: BaseLogContext): void {
    this.log(LogLevel.DEBUG, message, context);
  }
  
  info(message: string, context?: BaseLogContext): void {
    this.log(LogLevel.INFO, message, context);
  }
  
  warn(message: string, context?: BaseLogContext): void {
    this.log(LogLevel.WARN, message, context);
  }
  
  error(message: string, context?: BaseLogContext): void {
    this.log(LogLevel.ERROR, message, context);
  }
  
  // Configuration methods
  setLogLevel(level: LogLevel): void {
    // No-op for mock
  }
  
  getLogLevel(): LogLevel {
    return LogLevel.DEBUG;
  }
  
  isLevelEnabled(level: LogLevel): boolean {
    return true;
  }
  
  async flush(): Promise<void> {
    // No-op for mock
  }
  
  // Test helper methods
  clearLogs(): void {
    this.logs = [];
  }
  
  getLogs(level?: LogLevel): Array<{ level: LogLevel; message: string; context?: any }> {
    if (level !== undefined) {
      return this.logs.filter(log => log.level === level);
    }
    return [...this.logs];
  }
}

// Create a singleton instance for testing
export const mockStructuredLogger = new MockStructuredLogger();

export default mockStructuredLogger;
