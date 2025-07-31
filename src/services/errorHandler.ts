import { structuredLogger } from './structuredLogger.js';
import { monitoringService } from './monitoringService.js';

// Error classification enums
export enum ErrorCategory {
  SYSTEM = 'SystemError',
  SESSION = 'SessionError', 
  PERFORMANCE = 'PerformanceError',
  VALIDATION = 'ValidationError',
  NETWORK = 'NetworkError',
  AUTHENTICATION = 'AuthenticationError',
  AUTHORIZATION = 'AuthorizationError',
  EXTERNAL_SERVICE = 'ExternalServiceError'
}

export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export enum RecoveryStrategy {
  RETRY = 'retry',
  FALLBACK = 'fallback',
  DEGRADE = 'degrade',
  FAIL_FAST = 'fail_fast',
  CIRCUIT_BREAK = 'circuit_break'
}

// Enhanced error interfaces
export interface ErrorContext {
  category: ErrorCategory;
  severity: ErrorSeverity;
  component: string;
  operation: string;
  sessionId?: string;
  userId?: string;
  metadata?: Record<string, any>;
  timestamp: Date;
  requestId?: string;
  traceId?: string;
}

export interface RecoveryConfig {
  strategy: RecoveryStrategy;
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterEnabled: boolean;
  timeout?: number;
  fallbackFunction?: () => Promise<any>;
  circuitBreakerThreshold?: number;
}

export interface ErrorHandlingResult {
  success: boolean;
  result?: any;
  error?: EnhancedError;
  attemptsUsed: number;
  totalTimeMs: number;
  recoveryApplied: boolean;
  recoveryStrategy?: RecoveryStrategy;
}

// Enhanced Error class
export class EnhancedError extends Error {
  public readonly category: ErrorCategory;
  public readonly severity: ErrorSeverity;
  public readonly component: string;
  public readonly operation: string;
  public readonly sessionId?: string;
  public readonly userId?: string;
  public readonly metadata: Record<string, any>;
  public readonly timestamp: Date;
  public readonly requestId?: string;
  public readonly traceId?: string;
  public readonly originalError?: Error;
  public readonly errorCode: string;
  
  constructor(
    message: string,
    context: ErrorContext,
    originalError?: Error
  ) {
    super(message);
    this.name = 'EnhancedError';
    this.category = context.category;
    this.severity = context.severity;
    this.component = context.component;
    this.operation = context.operation;
    this.sessionId = context.sessionId;
    this.userId = context.userId;
    this.metadata = context.metadata || {};
    this.timestamp = context.timestamp;
    this.requestId = context.requestId;
    this.traceId = context.traceId;
    this.originalError = originalError;
    this.errorCode = this.generateErrorCode();
    
    // Maintain proper stack trace
    if (originalError && originalError.stack) {
      this.stack = originalError.stack;
    }
  }
  
  private generateErrorCode(): string {
    const timestamp = this.timestamp.getTime().toString(36);
    const categoryCode = this.category.substring(0, 3).toUpperCase();
    const componentCode = this.component.substring(0, 3).toUpperCase();
    return `${categoryCode}-${componentCode}-${timestamp}`;
  }
  
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      category: this.category,
      severity: this.severity,
      component: this.component,
      operation: this.operation,
      sessionId: this.sessionId,
      userId: this.userId,
      metadata: this.metadata,
      timestamp: this.timestamp.toISOString(),
      requestId: this.requestId,
      traceId: this.traceId,
      errorCode: this.errorCode,
      originalError: this.originalError?.message,
      stack: this.stack
    };
  }
}

// Circuit Breaker implementation
export class CircuitBreaker {
  private failures: number = 0;
  private lastFailureTime: number = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  
  constructor(
    private threshold: number = 5,
    private timeoutMs: number = 60000, // 1 minute
    private monitorPeriodMs: number = 10000 // 10 seconds
  ) {}
  
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.timeoutMs) {
        this.state = 'HALF_OPEN';
      } else {
        throw new EnhancedError(
          'Circuit breaker is open',
          {
            category: ErrorCategory.SYSTEM,
            severity: ErrorSeverity.HIGH,
            component: 'CircuitBreaker',
            operation: 'execute',
            timestamp: new Date()
          }
        );
      }
    }
    
    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  private onSuccess(): void {
    this.failures = 0;
    this.state = 'CLOSED';
  }
  
  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    
    if (this.failures >= this.threshold) {
      this.state = 'OPEN';
    }
  }
  
  getState(): string {
    return this.state;
  }
  
  getFailureCount(): number {
    return this.failures;
  }
  
  reset(): void {
    this.failures = 0;
    this.state = 'CLOSED';
    this.lastFailureTime = 0;
  }
}

// Enhanced Error Handler Service
export class ErrorHandlerService {
  private circuitBreakers = new Map<string, CircuitBreaker>();
  private alertCooldowns = new Map<string, number>();
  private readonly alertCooldownMs = 300000; // 5 minutes
  
  /**
   * Handle errors with recovery mechanisms
   */
  async handleWithRecovery<T>(
    operation: () => Promise<T>,
    recoveryConfig: RecoveryConfig,
    errorContext: Omit<ErrorContext, 'timestamp'>
  ): Promise<ErrorHandlingResult> {
    const startTime = Date.now();
    let attemptsUsed = 0;
    let lastError: EnhancedError | undefined;
    
    const context: ErrorContext = {
      ...errorContext,
      timestamp: new Date()
    };
    
    // Apply circuit breaker if configured
    if (recoveryConfig.strategy === RecoveryStrategy.CIRCUIT_BREAK) {
      const breakerKey = `${context.component}:${context.operation}`;
      const circuitBreaker = this.getOrCreateCircuitBreaker(
        breakerKey,
        recoveryConfig.circuitBreakerThreshold || 5
      );
      
      try {
        const result = await circuitBreaker.execute(operation);
        return {
          success: true,
          result,
          attemptsUsed: 1,
          totalTimeMs: Date.now() - startTime,
          recoveryApplied: false
        };
      } catch (error) {
        lastError = this.createEnhancedError(error, context);
        await this.logAndAlert(lastError);
        
        return {
          success: false,
          error: lastError,
          attemptsUsed: 1,
          totalTimeMs: Date.now() - startTime,
          recoveryApplied: true,
          recoveryStrategy: RecoveryStrategy.CIRCUIT_BREAK
        };
      }
    }
    
    // Implement retry strategy with exponential backoff
    if (recoveryConfig.strategy === RecoveryStrategy.RETRY) {
      for (let attempt = 1; attempt <= recoveryConfig.maxRetries; attempt++) {
        attemptsUsed = attempt;
        
        try {
          const result = await this.executeWithTimeout(operation, recoveryConfig.timeout);
          
          // Log successful recovery if we had previous failures
          if (attempt > 1) {
            structuredLogger.logInfo('Operation recovered after retries', {
              component: context.component,
              operation: context.operation,
              attemptsUsed,
              totalTimeMs: Date.now() - startTime,
              sessionId: context.sessionId
            });
          }
          
          return {
            success: true,
            result,
            attemptsUsed,
            totalTimeMs: Date.now() - startTime,
            recoveryApplied: attempt > 1,
            recoveryStrategy: RecoveryStrategy.RETRY
          };
        } catch (error) {
          lastError = this.createEnhancedError(error, context);
          
          // If this is the last attempt, don't wait
          if (attempt < recoveryConfig.maxRetries) {
            const delay = this.calculateBackoffDelay(
              attempt,
              recoveryConfig.initialDelayMs,
              recoveryConfig.maxDelayMs,
              recoveryConfig.backoffMultiplier,
              recoveryConfig.jitterEnabled
            );
            
            await this.sleep(delay);
          }
        }
      }
    }
    
    // Apply fallback strategy
    if (recoveryConfig.strategy === RecoveryStrategy.FALLBACK && recoveryConfig.fallbackFunction) {
      try {
        const result = await recoveryConfig.fallbackFunction();
        
        // Log the fallback usage
        if (lastError) {
          await this.logAndAlert(lastError);
        }
        
        structuredLogger.logWarning('Fallback mechanism activated', {
          component: context.component,
          operation: context.operation,
          originalError: lastError?.message,
          sessionId: context.sessionId
        });
        
        return {
          success: true,
          result,
          attemptsUsed,
          totalTimeMs: Date.now() - startTime,
          recoveryApplied: true,
          recoveryStrategy: RecoveryStrategy.FALLBACK
        };
      } catch (fallbackError) {
        lastError = this.createEnhancedError(fallbackError, {
          ...context,
          operation: `${context.operation}:fallback`
        });
      }
    }
    
    // If we get here, all recovery attempts failed
    if (lastError) {
      await this.logAndAlert(lastError);
    }
    
    return {
      success: false,
      error: lastError,
      attemptsUsed,
      totalTimeMs: Date.now() - startTime,
      recoveryApplied: attemptsUsed > 1 || recoveryConfig.strategy === RecoveryStrategy.FALLBACK,
      recoveryStrategy: recoveryConfig.strategy
    };
  }
  
  /**
   * Create an enhanced error from a regular error
   */
  createEnhancedError(
    error: unknown,
    context: ErrorContext,
    message?: string
  ): EnhancedError {
    const originalError = error instanceof Error ? error : new Error(String(error));
    const errorMessage = message || originalError.message || 'Unknown error occurred';
    
    return new EnhancedError(errorMessage, context, originalError);
  }
  
  /**
   * Log error and trigger alerts if necessary
   */
  async logAndAlert(error: EnhancedError): Promise<void> {
    // Always log the error
    structuredLogger.logError(error, {
      errorCode: error.errorCode,
      category: error.category,
      severity: error.severity,
      component: error.component,
      operation: error.operation,
      sessionId: error.sessionId,
      metadata: error.metadata
    });
    
    // Record performance impact if available
    if (monitoringService) {
      await monitoringService.recordPerformanceMetric({
        operation: error.operation,
        duration: 0, // Error occurred, no successful duration
        success: false,
        metadata: {
          errorCategory: error.category,
          errorSeverity: error.severity,
          errorCode: error.errorCode
        }
      });
    }
    
    // Trigger alerts for high severity errors
    if (error.severity === ErrorSeverity.HIGH || error.severity === ErrorSeverity.CRITICAL) {
      await this.triggerAlert(error);
    }
  }
  
  /**
   * Trigger alert with cooldown to prevent spam
   */
  private async triggerAlert(error: EnhancedError): Promise<void> {
    const alertKey = `${error.component}:${error.category}:${error.severity}`;
    const now = Date.now();
    const lastAlert = this.alertCooldowns.get(alertKey);
    
    // Check if we're still in cooldown period
    if (lastAlert && (now - lastAlert) < this.alertCooldownMs) {
      return;
    }
    
    // Set cooldown
    this.alertCooldowns.set(alertKey, now);
    
    // Log alert (in production, this would integrate with alerting systems)
    structuredLogger.logError('ALERT: Critical error detected', {
      errorCode: error.errorCode,
      category: error.category,
      severity: error.severity,
      component: error.component,
      operation: error.operation,
      message: error.message,
      sessionId: error.sessionId,
      timestamp: error.timestamp.toISOString(),
      alertKey
    });
    
    // TODO: Integrate with external alerting systems (PagerDuty, Slack, etc.)
    // await this.sendToAlertingSystem(error);
  }
  
  /**
   * Execute operation with timeout
   */
  private async executeWithTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs?: number
  ): Promise<T> {
    if (!timeoutMs) {
      return operation();
    }
    
    return Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Operation timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      })
    ]);
  }
  
  /**
   * Calculate exponential backoff delay with jitter
   */
  private calculateBackoffDelay(
    attempt: number,
    initialDelayMs: number,
    maxDelayMs: number,
    backoffMultiplier: number,
    jitterEnabled: boolean
  ): number {
    let delay = initialDelayMs * Math.pow(backoffMultiplier, attempt - 1);
    delay = Math.min(delay, maxDelayMs);
    
    if (jitterEnabled) {
      // Add random jitter (±25% of the calculated delay)
      const jitter = delay * 0.25 * (Math.random() * 2 - 1);
      delay += jitter;
    }
    
    return Math.max(0, delay);
  }
  
  /**
   * Get or create circuit breaker for a specific operation
   */
  private getOrCreateCircuitBreaker(key: string, threshold: number): CircuitBreaker {
    if (!this.circuitBreakers.has(key)) {
      this.circuitBreakers.set(key, new CircuitBreaker(threshold));
    }
    return this.circuitBreakers.get(key)!;
  }
  
  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Get circuit breaker status for monitoring
   */
  getCircuitBreakerStatus(): Record<string, { state: string; failures: number }> {
    const status: Record<string, { state: string; failures: number }> = {};
    
    for (const [key, breaker] of this.circuitBreakers.entries()) {
      status[key] = {
        state: breaker.getState(),
        failures: breaker.getFailureCount()
      };
    }
    
    return status;
  }
  
  /**
   * Reset circuit breaker
   */
  resetCircuitBreaker(key: string): boolean {
    const breaker = this.circuitBreakers.get(key);
    if (breaker) {
      breaker.reset();
      return true;
    }
    return false;
  }
  
  /**
   * Reset all circuit breakers
   */
  resetAllCircuitBreakers(): void {
    for (const breaker of this.circuitBreakers.values()) {
      breaker.reset();
    }
  }
}

// Export singleton instance
export const errorHandler = new ErrorHandlerService();

// Default recovery configurations
export const defaultRecoveryConfigs = {
  database: {
    strategy: RecoveryStrategy.RETRY,
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 10000,
    backoffMultiplier: 2,
    jitterEnabled: true,
    timeout: 30000
  },
  redis: {
    strategy: RecoveryStrategy.FALLBACK,
    maxRetries: 2,
    initialDelayMs: 500,
    maxDelayMs: 5000,
    backoffMultiplier: 2,
    jitterEnabled: true,
    timeout: 10000
  },
  externalService: {
    strategy: RecoveryStrategy.CIRCUIT_BREAK,
    maxRetries: 2,
    initialDelayMs: 1000,
    maxDelayMs: 5000,
    backoffMultiplier: 2,
    jitterEnabled: true,
    timeout: 15000,
    circuitBreakerThreshold: 3
  },
  session: {
    strategy: RecoveryStrategy.RETRY,
    maxRetries: 2,
    initialDelayMs: 500,
    maxDelayMs: 2000,
    backoffMultiplier: 1.5,
    jitterEnabled: false,
    timeout: 5000
  }
};