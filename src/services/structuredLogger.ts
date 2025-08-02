// Import config lazily to avoid environment validation during tests

// Log levels in order of severity
export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3
}

// Context interfaces for different log types
export interface BaseLogContext {
  timestamp?: Date;
  sessionId?: string;
  correlationId?: string;
  userId?: string;
  metadata?: Record<string, any>;
  // Allow additional properties for flexible logging
  [key: string]: any;
}

export interface ToolCallContext extends BaseLogContext {
  toolName: string;
  executionTimeMs: number;
  success: boolean;
  inputParameters?: Record<string, any>;
  outputData?: any;
  errorMessage?: string;
}

export interface HandoffContext extends BaseLogContext {
  agentFrom: string;
  agentTo: string;
  handoffType: 'request' | 'accept' | 'reject' | 'complete';
  contextSize?: number;
  processingTimeMs?: number;
  success: boolean;
  reason?: string;
}

export interface SystemContext extends BaseLogContext {
  component: string;
  operation: string;
  duration?: number;
  resourceUsage?: {
    memoryMB?: number;
    cpuPercent?: number;
    diskUsageMB?: number;
  };
  status: 'started' | 'completed' | 'failed';
}

export interface ErrorContext extends BaseLogContext {
  errorType: 'SystemError' | 'SessionError' | 'PerformanceError' | 'ValidationError' | 'UnknownError' | 'DatabaseError' | 'RedisError' | 'ServiceError' | 'ToolExecutionError';
  component: string;
  operation?: string;
  stackTrace?: string;
  additionalInfo?: Record<string, any>;
}

export interface WarningContext extends BaseLogContext {
  warningType: 'Performance' | 'Resource' | 'Configuration' | 'Deprecation';
  component: string;
  threshold?: number;
  currentValue?: number;
  recommendation?: string;
}

export interface PerformanceMetric extends BaseLogContext {
  metricName: string;
  metricValue: number;
  metricType: 'counter' | 'gauge' | 'histogram' | 'timer';
  unit: string;
  tags?: Record<string, string>;
}

export interface ResourceUsage extends BaseLogContext {
  component: string;
  memoryUsageMB: number;
  cpuUsagePercent: number;
  diskUsageMB?: number;
  networkBytesIn?: number;
  networkBytesOut?: number;
  activeConnections?: number;
}

// Structured log entry interface
export interface StructuredLogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  logType: 'tool_call' | 'handoff' | 'system' | 'error' | 'warning' | 'performance' | 'resource';
  context: BaseLogContext;
  environment: {
    nodeEnv: string;
    serverVersion: string;
    hostname: string;
    pid: number;
  };
}

// Logger configuration interface
export interface LoggerConfig {
  level: LogLevel;
  enableConsoleOutput: boolean;
  enableFileOutput: boolean;
  enableJsonFormat: boolean;
  includeStackTrace: boolean;
  maxLogFileSize: number; // in MB
  logRotationCount: number;
  filterSensitiveData: boolean;
}

/**
 * Structured Logger Interface
 * Provides comprehensive logging capabilities for different event types
 */
export interface IStructuredLogger {
  // Operation logging
  logToolCall(context: ToolCallContext): void;
  logHandoffEvent(context: HandoffContext): void;
  logSystemEvent(context: SystemContext): void;
  
  // Error and warning logging
  logError(error: Error, context: ErrorContext): void;
  logWarning(message: string, context: WarningContext): void;
  
  // Performance and resource logging
  logPerformanceMetric(metric: PerformanceMetric): void;
  logResourceUsage(usage: ResourceUsage): void;
  
  // Generic logging methods
  log(level: LogLevel, message: string, context?: BaseLogContext): void;
  debug(message: string, context?: BaseLogContext): void;
  info(message: string, context?: BaseLogContext): void;
  warn(message: string, context?: BaseLogContext): void;
  error(message: string, context?: BaseLogContext): void;
  
  // Configuration and utility methods
  setLogLevel(level: LogLevel): void;
  getLogLevel(): LogLevel;
  isLevelEnabled(level: LogLevel): boolean;
  flush(): Promise<void>;
}

/**
 * Structured Logger Implementation
 * Provides JSON-formatted logging with contextual information and filtering
 */
export class StructuredLogger implements IStructuredLogger {
  private config: LoggerConfig;
  private hostname: string;
  private pid: number;
  private serverVersion: string;

  constructor(config?: Partial<LoggerConfig>) {
    this.config = {
      level: this.parseLogLevel(process.env.LOG_LEVEL || 'info'),
      enableConsoleOutput: true,
      enableFileOutput: false,
      enableJsonFormat: true,
      includeStackTrace: true,
      maxLogFileSize: 100, // 100MB
      logRotationCount: 5,
      filterSensitiveData: true,
      ...config
    };

    this.hostname = process.env.HOSTNAME || 'localhost';
    this.pid = process.pid;
    this.serverVersion = process.env.npm_package_version || '1.0.0';
  }

  private parseLogLevel(level: string): LogLevel {
    switch (level.toLowerCase()) {
      case 'error': return LogLevel.ERROR;
      case 'warn': return LogLevel.WARN;
      case 'info': return LogLevel.INFO;
      case 'debug': return LogLevel.DEBUG;
      default: return LogLevel.INFO;
    }
  }

  private createBaseLogEntry(
    level: LogLevel,
    message: string,
    logType: StructuredLogEntry['logType'],
    context: BaseLogContext
  ): StructuredLogEntry {
    return {
      level,
      message,
      timestamp: new Date().toISOString(),
      logType,
      context: this.sanitizeContext(context),
      environment: {
        nodeEnv: process.env.NODE_ENV || 'development',
        serverVersion: this.serverVersion,
        hostname: this.hostname,
        pid: this.pid
      }
    };
  }

  private sanitizeContext(context: BaseLogContext): BaseLogContext {
    if (!this.config.filterSensitiveData) {
      return context;
    }

    // Create a deep copy to avoid modifying the original
    const sanitized = JSON.parse(JSON.stringify(context));
    
    // Remove or mask sensitive fields
    const sensitiveFields = ['password', 'token', 'secret', 'key', 'auth', 'credential'];
    
    const maskSensitiveData = (obj: any): any => {
      if (typeof obj !== 'object' || obj === null) {
        return obj;
      }

      for (const key in obj) {
        if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
          obj[key] = '[REDACTED]';
        } else if (typeof obj[key] === 'object') {
          obj[key] = maskSensitiveData(obj[key]);
        }
      }
      return obj;
    };

    return maskSensitiveData(sanitized);
  }

  private writeLog(entry: StructuredLogEntry): void {
    if (!this.isLevelEnabled(entry.level)) {
      return;
    }

    if (this.config.enableConsoleOutput) {
      this.writeToConsole(entry);
    }

    if (this.config.enableFileOutput) {
      this.writeToFile(entry);
    }
  }

  private writeToConsole(entry: StructuredLogEntry): void {
    const output = this.config.enableJsonFormat 
      ? JSON.stringify(entry, null, 2)
      : this.formatHumanReadable(entry);

    switch (entry.level) {
      case LogLevel.ERROR:
        console.error(output);
        break;
      case LogLevel.WARN:
        console.warn(output);
        break;
      case LogLevel.INFO:
        console.info(output);
        break;
      case LogLevel.DEBUG:
        console.debug(output);
        break;
    }
  }

  private writeToFile(entry: StructuredLogEntry): void {
    // File logging implementation would go here
    // For now, we'll just implement console logging
    console.log(`[FILE] ${JSON.stringify(entry)}`);
    // In a production system, you'd implement file rotation, etc.
  }

  private formatHumanReadable(entry: StructuredLogEntry): string {
    const levelName = LogLevel[entry.level];
    const timestamp = new Date(entry.timestamp).toLocaleString();
    
    let formatted = `[${timestamp}] ${levelName}: ${entry.message}`;
    
    if (entry.context.sessionId) {
      formatted += ` | Session: ${entry.context.sessionId}`;
    }
    
    if (entry.context.correlationId) {
      formatted += ` | Correlation: ${entry.context.correlationId}`;
    }

    return formatted;
  }

  // Tool call logging
  logToolCall(context: ToolCallContext): void {
    const message = `Tool '${context.toolName}' ${context.success ? 'completed' : 'failed'} in ${context.executionTimeMs}ms`;
    const entry = this.createBaseLogEntry(
      context.success ? LogLevel.INFO : LogLevel.ERROR,
      message,
      'tool_call',
      context
    );
    this.writeLog(entry);
  }

  // Handoff event logging
  logHandoffEvent(context: HandoffContext): void {
    const message = `Handoff ${context.handoffType} from ${context.agentFrom} to ${context.agentTo} ${context.success ? 'succeeded' : 'failed'}`;
    const entry = this.createBaseLogEntry(
      context.success ? LogLevel.INFO : LogLevel.WARN,
      message,
      'handoff',
      context
    );
    this.writeLog(entry);
  }

  // System event logging
  logSystemEvent(context: SystemContext): void {
    const message = `${context.component} ${context.operation} ${context.status}${context.duration ? ` in ${context.duration}ms` : ''}`;
    const level = context.status === 'failed' ? LogLevel.ERROR : LogLevel.INFO;
    const entry = this.createBaseLogEntry(level, message, 'system', context);
    this.writeLog(entry);
  }

  // Error logging
  logError(error: Error, context: ErrorContext): void {
    const enhancedContext = {
      ...context,
      stackTrace: this.config.includeStackTrace ? error.stack : undefined,
      errorMessage: error.message,
      errorName: error.name
    };

    const message = `${context.errorType} in ${context.component}: ${error.message}`;
    const entry = this.createBaseLogEntry(LogLevel.ERROR, message, 'error', enhancedContext);
    this.writeLog(entry);
  }

  // Warning logging
  logWarning(message: string, context: WarningContext): void {
    const entry = this.createBaseLogEntry(LogLevel.WARN, message, 'warning', context);
    this.writeLog(entry);
  }

  // Performance metric logging
  logPerformanceMetric(metric: PerformanceMetric): void {
    const message = `Performance metric: ${metric.metricName} = ${metric.metricValue} ${metric.unit}`;
    const entry = this.createBaseLogEntry(LogLevel.DEBUG, message, 'performance', metric);
    this.writeLog(entry);
  }

  // Resource usage logging
  logResourceUsage(usage: ResourceUsage): void {
    const message = `Resource usage for ${usage.component}: Memory=${usage.memoryUsageMB}MB, CPU=${usage.cpuUsagePercent}%`;
    const entry = this.createBaseLogEntry(LogLevel.DEBUG, message, 'resource', usage);
    this.writeLog(entry);
  }

  // Generic logging methods
  log(level: LogLevel, message: string, context?: BaseLogContext): void {
    const enhancedContext: BaseLogContext = {
      timestamp: new Date(),
      ...context
    };
    const entry = this.createBaseLogEntry(level, message, 'system', enhancedContext);
    this.writeLog(entry);
  }

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
    this.config.level = level;
  }

  getLogLevel(): LogLevel {
    return this.config.level;
  }

  isLevelEnabled(level: LogLevel): boolean {
    return level <= this.config.level;
  }

  async flush(): Promise<void> {
    // In a real implementation, this would flush any buffered logs
    // For console logging, this is a no-op
    return Promise.resolve();
  }
}

// Create and export a default logger instance
export const structuredLogger = new StructuredLogger();

// Export default logger as 'logger' for convenience
export const logger = structuredLogger;

// Export utility functions
export function createLogger(config?: Partial<LoggerConfig>): StructuredLogger {
  return new StructuredLogger(config);
}

export function getLogLevelFromString(level: string): LogLevel {
  switch (level.toLowerCase()) {
    case 'error': return LogLevel.ERROR;
    case 'warn': return LogLevel.WARN;
    case 'info': return LogLevel.INFO;
    case 'debug': return LogLevel.DEBUG;
    default: return LogLevel.INFO;
  }
}