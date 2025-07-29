import { 
  StructuredLogger, 
  LogLevel, 
  createLogger,
  getLogLevelFromString,
  type ToolCallContext,
  type HandoffContext,
  type SystemContext,
  type ErrorContext,
  type WarningContext,
  type PerformanceMetric,
  type ResourceUsage
} from '../structuredLogger.js';

// Mock console methods
const originalConsole = { ...console };
const mockConsole = {
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn()
};

describe('StructuredLogger', () => {
  let logger: StructuredLogger;

  beforeEach(() => {
    // Replace console methods with mocks
    Object.assign(console, mockConsole);
    
    // Reset mocks
    Object.values(mockConsole).forEach(mock => mock.mockClear());
    
    // Create fresh logger instance
    logger = new StructuredLogger({
      level: LogLevel.DEBUG,
      enableConsoleOutput: true,
      enableJsonFormat: true
    });
  });

  afterEach(() => {
    // Restore original console
    Object.assign(console, originalConsole);
  });

  describe('Log Level Management', () => {
    test('should set and get log level correctly', () => {
      logger.setLogLevel(LogLevel.WARN);
      expect(logger.getLogLevel()).toBe(LogLevel.WARN);
    });

    test('should check if level is enabled correctly', () => {
      logger.setLogLevel(LogLevel.WARN);
      
      expect(logger.isLevelEnabled(LogLevel.ERROR)).toBe(true);
      expect(logger.isLevelEnabled(LogLevel.WARN)).toBe(true);
      expect(logger.isLevelEnabled(LogLevel.INFO)).toBe(false);
      expect(logger.isLevelEnabled(LogLevel.DEBUG)).toBe(false);
    });

    test('should filter logs based on level', () => {
      logger.setLogLevel(LogLevel.WARN);
      
      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warning message');
      logger.error('Error message');

      expect(mockConsole.debug).not.toHaveBeenCalled();
      expect(mockConsole.info).not.toHaveBeenCalled();
      expect(mockConsole.warn).toHaveBeenCalledTimes(1);
      expect(mockConsole.error).toHaveBeenCalledTimes(1);
    });
  });

  describe('Tool Call Logging', () => {
    test('should log successful tool call', () => {
      const context: ToolCallContext = {
        timestamp: new Date(),
        sessionId: 'test-session-123',
        toolName: 'registerSession',
        executionTimeMs: 150,
        success: true,
        inputParameters: { sessionKey: 'test-key' },
        outputData: { success: true }
      };

      logger.logToolCall(context);

      expect(mockConsole.info).toHaveBeenCalledTimes(1);
      const logCall = mockConsole.info.mock.calls[0][0];
      const logEntry = JSON.parse(logCall);

      expect(logEntry.level).toBe(LogLevel.INFO);
      expect(logEntry.logType).toBe('tool_call');
      expect(logEntry.message).toContain('registerSession');
      expect(logEntry.message).toContain('completed');
      expect(logEntry.message).toContain('150ms');
      expect(logEntry.context.sessionId).toBe('test-session-123');
    });

    test('should log failed tool call', () => {
      const context: ToolCallContext = {
        timestamp: new Date(),
        sessionId: 'test-session-123',
        toolName: 'updateContext',
        executionTimeMs: 75,
        success: false,
        errorMessage: 'Database connection failed'
      };

      logger.logToolCall(context);

      expect(mockConsole.error).toHaveBeenCalledTimes(1);
      const logCall = mockConsole.error.mock.calls[0][0];
      const logEntry = JSON.parse(logCall);

      expect(logEntry.level).toBe(LogLevel.ERROR);
      expect(logEntry.message).toContain('failed');
      expect(logEntry.context.errorMessage).toBe('Database connection failed');
    });
  });

  describe('Handoff Event Logging', () => {
    test('should log successful handoff request', () => {
      const context: HandoffContext = {
        timestamp: new Date(),
        sessionId: 'handoff-session-456',
        agentFrom: 'agent-a',
        agentTo: 'agent-b',
        handoffType: 'request',
        contextSize: 1024,
        processingTimeMs: 200,
        success: true
      };

      logger.logHandoffEvent(context);

      expect(mockConsole.info).toHaveBeenCalledTimes(1);
      const logCall = mockConsole.info.mock.calls[0][0];
      const logEntry = JSON.parse(logCall);

      expect(logEntry.level).toBe(LogLevel.INFO);
      expect(logEntry.logType).toBe('handoff');
      expect(logEntry.message).toContain('request from agent-a to agent-b succeeded');
    });

    test('should log failed handoff', () => {
      const context: HandoffContext = {
        timestamp: new Date(),
        sessionId: 'handoff-session-789',
        agentFrom: 'agent-x',
        agentTo: 'agent-y',
        handoffType: 'accept',
        success: false,
        reason: 'Agent not available'
      };

      logger.logHandoffEvent(context);

      expect(mockConsole.warn).toHaveBeenCalledTimes(1);
      const logCall = mockConsole.warn.mock.calls[0][0];
      const logEntry = JSON.parse(logCall);

      expect(logEntry.level).toBe(LogLevel.WARN);
      expect(logEntry.message).toContain('failed');
      expect(logEntry.context.reason).toBe('Agent not available');
    });
  });

  describe('System Event Logging', () => {
    test('should log system operation completion', () => {
      const context: SystemContext = {
        timestamp: new Date(),
        component: 'DatabaseManager',
        operation: 'connection_pool_init',
        duration: 500,
        status: 'completed',
        resourceUsage: {
          memoryMB: 64,
          cpuPercent: 15
        }
      };

      logger.logSystemEvent(context);

      expect(mockConsole.info).toHaveBeenCalledTimes(1);
      const logCall = mockConsole.info.mock.calls[0][0];
      const logEntry = JSON.parse(logCall);

      expect(logEntry.message).toContain('DatabaseManager connection_pool_init completed in 500ms');
      expect(logEntry.context.resourceUsage.memoryMB).toBe(64);
    });

    test('should log system failure', () => {
      const context: SystemContext = {
        timestamp: new Date(),
        component: 'RedisClient',
        operation: 'connect',
        status: 'failed'
      };

      logger.logSystemEvent(context);

      expect(mockConsole.error).toHaveBeenCalledTimes(1);
      const logCall = mockConsole.error.mock.calls[0][0];
      const logEntry = JSON.parse(logCall);

      expect(logEntry.level).toBe(LogLevel.ERROR);
      expect(logEntry.message).toContain('failed');
    });
  });

  describe('Error Logging', () => {
    test('should log error with context and stack trace', () => {
      const error = new Error('Database query timeout');
      const context: ErrorContext = {
        timestamp: new Date(),
        sessionId: 'error-session-123',
        errorType: 'SystemError',
        component: 'DatabaseManager',
        operation: 'executeQuery',
        additionalInfo: {
          query: 'SELECT * FROM sessions',
          timeout: 5000
        }
      };

      logger.logError(error, context);

      expect(mockConsole.error).toHaveBeenCalledTimes(1);
      const logCall = mockConsole.error.mock.calls[0][0];
      const logEntry = JSON.parse(logCall);

      expect(logEntry.level).toBe(LogLevel.ERROR);
      expect(logEntry.logType).toBe('error');
      expect(logEntry.message).toContain('SystemError in DatabaseManager');
      expect(logEntry.context.errorMessage).toBe('Database query timeout');
      expect(logEntry.context.stackTrace).toBeDefined();
    });
  });

  describe('Warning Logging', () => {
    test('should log performance warning', () => {
      const context: WarningContext = {
        timestamp: new Date(),
        warningType: 'Performance',
        component: 'SessionManager',
        threshold: 1000,
        currentValue: 1500,
        recommendation: 'Consider optimizing database queries'
      };

      logger.logWarning('Response time exceeded threshold', context);

      expect(mockConsole.warn).toHaveBeenCalledTimes(1);
      const logCall = mockConsole.warn.mock.calls[0][0];
      const logEntry = JSON.parse(logCall);

      expect(logEntry.level).toBe(LogLevel.WARN);
      expect(logEntry.logType).toBe('warning');
      expect(logEntry.context.threshold).toBe(1000);
      expect(logEntry.context.currentValue).toBe(1500);
    });
  });

  describe('Performance Metric Logging', () => {
    test('should log performance metrics', () => {
      const metric: PerformanceMetric = {
        timestamp: new Date(),
        metricName: 'database_query_duration',
        metricValue: 250,
        metricType: 'timer',
        unit: 'ms',
        tags: {
          operation: 'select',
          table: 'sessions'
        }
      };

      logger.logPerformanceMetric(metric);

      expect(mockConsole.debug).toHaveBeenCalledTimes(1);
      const logCall = mockConsole.debug.mock.calls[0][0];
      const logEntry = JSON.parse(logCall);

      expect(logEntry.level).toBe(LogLevel.DEBUG);
      expect(logEntry.logType).toBe('performance');
      expect(logEntry.message).toContain('database_query_duration = 250 ms');
    });
  });

  describe('Resource Usage Logging', () => {
    test('should log resource usage', () => {
      const usage: ResourceUsage = {
        timestamp: new Date(),
        component: 'MCP_Server',
        memoryUsageMB: 128,
        cpuUsagePercent: 25,
        diskUsageMB: 512,
        activeConnections: 15
      };

      logger.logResourceUsage(usage);

      expect(mockConsole.debug).toHaveBeenCalledTimes(1);
      const logCall = mockConsole.debug.mock.calls[0][0];
      const logEntry = JSON.parse(logCall);

      expect(logEntry.message).toContain('Memory=128MB, CPU=25%');
      expect(logEntry.context.activeConnections).toBe(15);
    });
  });

  describe('Sensitive Data Filtering', () => {
    test('should redact sensitive information', () => {
      const context: ToolCallContext = {
        timestamp: new Date(),
        toolName: 'authenticate',
        executionTimeMs: 100,
        success: true,
        inputParameters: {
          username: 'testuser',
          password: 'secret123',
          apiKey: 'abc-def-ghi',
          normalField: 'normal-value'
        }
      };

      logger.logToolCall(context);

      const logCall = mockConsole.info.mock.calls[0][0];
      const logEntry = JSON.parse(logCall);

      expect(logEntry.context.inputParameters.password).toBe('[REDACTED]');
      expect(logEntry.context.inputParameters.apiKey).toBe('[REDACTED]');
      expect(logEntry.context.inputParameters.normalField).toBe('normal-value');
      expect(logEntry.context.inputParameters.username).toBe('testuser');
    });
  });

  describe('Generic Logging Methods', () => {
    test('should support generic log method', () => {
      logger.log(LogLevel.INFO, 'Generic log message', {
        timestamp: new Date(),
        correlationId: 'corr-123'
      });

      expect(mockConsole.info).toHaveBeenCalledTimes(1);
      const logCall = mockConsole.info.mock.calls[0][0];
      const logEntry = JSON.parse(logCall);

      expect(logEntry.message).toBe('Generic log message');
      expect(logEntry.context.correlationId).toBe('corr-123');
    });

    test('should support convenience methods', () => {
      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warning message');
      logger.error('Error message');

      expect(mockConsole.debug).toHaveBeenCalledTimes(1);
      expect(mockConsole.info).toHaveBeenCalledTimes(1);
      expect(mockConsole.warn).toHaveBeenCalledTimes(1);
      expect(mockConsole.error).toHaveBeenCalledTimes(1);
    });
  });

  describe('Utility Functions', () => {
    test('should create logger with custom config', () => {
      const customLogger = createLogger({
        level: LogLevel.ERROR,
        enableJsonFormat: false
      });

      expect(customLogger.getLogLevel()).toBe(LogLevel.ERROR);
    });

    test('should parse log level from string', () => {
      expect(getLogLevelFromString('error')).toBe(LogLevel.ERROR);
      expect(getLogLevelFromString('WARN')).toBe(LogLevel.WARN);
      expect(getLogLevelFromString('info')).toBe(LogLevel.INFO);
      expect(getLogLevelFromString('DEBUG')).toBe(LogLevel.DEBUG);
      expect(getLogLevelFromString('invalid')).toBe(LogLevel.INFO);
    });
  });

  describe('Environment Information', () => {
    test('should include environment information in log entries', () => {
      logger.info('Test message');

      const logCall = mockConsole.info.mock.calls[0][0];
      const logEntry = JSON.parse(logCall);

      expect(logEntry.environment).toBeDefined();
      expect(logEntry.environment.nodeEnv).toBeDefined();
      expect(logEntry.environment.hostname).toBeDefined();
      expect(logEntry.environment.pid).toBe(process.pid);
    });
  });

  describe('Flush Method', () => {
    test('should flush logs successfully', async () => {
      await expect(logger.flush()).resolves.toBeUndefined();
    });
  });
});