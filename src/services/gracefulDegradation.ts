import { structuredLogger } from './structuredLogger.js';
import { errorHandler, ErrorCategory, ErrorSeverity, EnhancedError } from './errorHandler.js';

// Service priority levels
export enum ServicePriority {
  CRITICAL = 'critical',      // Core functionality - system cannot operate without these
  IMPORTANT = 'important',    // Enhanced functionality - system can operate with limited features
  OPTIONAL = 'optional'       // Nice-to-have features - system operates normally without these
}

// Degradation modes
export enum DegradationMode {
  FULL_SERVICE = 'full_service',      // All services operational
  PERFORMANCE_MODE = 'performance',   // Optional services disabled for performance
  ESSENTIAL_ONLY = 'essential_only',  // Only critical services enabled
  EMERGENCY_MODE = 'emergency'        // Minimal functionality only
}

// Service health status
export interface ServiceHealth {
  name: string;
  priority: ServicePriority;
  healthy: boolean;
  lastCheck: Date;
  consecutiveFailures: number;
  responseTime: number;
  errorCount: number;
  fallbackEnabled: boolean;
  fallbackActive: boolean;
}

// Degradation configuration
export interface DegradationConfig {
  service: string;
  priority: ServicePriority;
  failureThreshold: number;
  recoveryThreshold: number;
  checkIntervalMs: number;
  fallbackFunction?: () => Promise<any>;
  disableOnDegradation: boolean;
  healthCheckFunction: () => Promise<boolean>;
}

// Graceful degradation result
export interface DegradationResult<T> {
  success: boolean;
  result?: T;
  degradationMode: DegradationMode;
  serviceHealth: Record<string, ServiceHealth>;
  fallbackUsed: boolean;
  error?: EnhancedError;
}

/**
 * Graceful Degradation Service
 * Handles service failures by gracefully reducing functionality instead of complete system failure
 */
export class GracefulDegradationService {
  private services = new Map<string, ServiceHealth>();
  private degradationConfigs = new Map<string, DegradationConfig>();
  private currentMode: DegradationMode = DegradationMode.FULL_SERVICE;
  private healthCheckIntervals = new Map<string, NodeJS.Timeout>();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  // Remove unused private constants to satisfy TS6133 (thresholds are derived from per-service configs)
  // private readonly MAX_CONSECUTIVE_FAILURES = 3;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  // private readonly RECOVERY_CHECK_INTERVAL = 30000; // 30 seconds
  
  /**
   * Register a service for graceful degradation monitoring
   */
  registerService(config: DegradationConfig): void {
    const serviceHealth: ServiceHealth = {
      name: config.service,
      priority: config.priority,
      healthy: true,
      lastCheck: new Date(),
      consecutiveFailures: 0,
      responseTime: 0,
      errorCount: 0,
      fallbackEnabled: !!config.fallbackFunction,
      fallbackActive: false
    };
    
    this.services.set(config.service, serviceHealth);
    this.degradationConfigs.set(config.service, config);
    
    // Start health checking
    this.startHealthCheck(config.service);
    
    structuredLogger.info('Service registered for graceful degradation', {
      timestamp: new Date(),
      metadata: {
        service: config.service,
        priority: config.priority,
        fallbackEnabled: serviceHealth.fallbackEnabled
      }
    });
  }
  
  /**
   * Execute operation with graceful degradation
   */
  async executeWithDegradation<T>(
    serviceName: string,
    operation: () => Promise<T>,
    fallbackValue?: T
  ): Promise<DegradationResult<T>> {
    const service = this.services.get(serviceName);
    const config = this.degradationConfigs.get(serviceName);
    
    if (!service || !config) {
      throw new EnhancedError(
        `Service ${serviceName} not registered for graceful degradation`,
        {
          category: ErrorCategory.SYSTEM,
          severity: ErrorSeverity.HIGH,
          component: 'GracefulDegradationService',
          operation: 'executeWithDegradation',
          timestamp: new Date(),
          metadata: { serviceName }
        }
      );
    }
    
    // Check if service should be skipped due to current degradation mode
    if (this.shouldSkipService(service.priority)) {
      return this.handleSkippedService(serviceName, fallbackValue);
    }
    
    // Check if service is currently unhealthy and has fallback
    if (!service.healthy && service.fallbackEnabled && config.fallbackFunction) {
      return this.executeFallback(serviceName, config.fallbackFunction);
    }
    
    // Try to execute the main operation
    const startTime = Date.now();
    
    try {
      const result = await operation();
      
      // Update service health on success
      this.updateServiceHealth(serviceName, true, Date.now() - startTime);
      
      return {
        success: true,
        result,
        degradationMode: this.currentMode,
        serviceHealth: this.getServiceHealthSnapshot(),
        fallbackUsed: false
      };
    } catch (error) {
      // Update service health on failure
      this.updateServiceHealth(serviceName, false, Date.now() - startTime, error);
      
      // Try fallback if available
      if (service.fallbackEnabled && config.fallbackFunction) {
        return this.executeFallback(serviceName, config.fallbackFunction);
      }
      
      // If no fallback and service is optional/important, degrade gracefully
      if (service.priority !== ServicePriority.CRITICAL) {
        return this.handleNonCriticalFailure(serviceName, error, fallbackValue);
      }
      
      // Critical service failure - propagate error
      const enhancedError = errorHandler.createEnhancedError(error, {
        category: ErrorCategory.SYSTEM,
        severity: ErrorSeverity.CRITICAL,
        component: serviceName,
        operation: 'executeWithDegradation',
        timestamp: new Date(),
        metadata: { priority: service.priority }
      });
      
      return {
        success: false,
        degradationMode: this.currentMode,
        serviceHealth: this.getServiceHealthSnapshot(),
        fallbackUsed: false,
        error: enhancedError
      };
    }
  }
  
  /**
   * Check if service should be skipped based on current degradation mode
   */
  private shouldSkipService(priority: ServicePriority): boolean {
    switch (this.currentMode) {
      case DegradationMode.PERFORMANCE_MODE:
        return priority === ServicePriority.OPTIONAL;
      case DegradationMode.ESSENTIAL_ONLY:
        return priority === ServicePriority.OPTIONAL;
      case DegradationMode.EMERGENCY_MODE:
        return priority !== ServicePriority.CRITICAL;
      default:
        return false;
    }
  }
  
  /**
   * Handle skipped service execution
   */
  private handleSkippedService<T>(
    serviceName: string,
    fallbackValue?: T
  ): DegradationResult<T> {
    structuredLogger.info('Service skipped due to degradation mode', {
      timestamp: new Date(),
      metadata: {
        service: serviceName,
        degradationMode: this.currentMode
      }
    });
    
    return {
      success: true,
      result: fallbackValue as T,
      degradationMode: this.currentMode,
      serviceHealth: this.getServiceHealthSnapshot(),
      fallbackUsed: true
    };
  }
  
  /**
   * Execute fallback function
   */
  private async executeFallback<T>(
    serviceName: string,
    fallbackFunction: () => Promise<T>
  ): Promise<DegradationResult<T>> {
    const service = this.services.get(serviceName)!;
    service.fallbackActive = true;
    
    try {
      const result = await fallbackFunction();
      
      structuredLogger.warn('Service fallback executed successfully', {
        timestamp: new Date(),
        warningType: 'Performance',
        component: 'GracefulDegradation',
        metadata: {
          service: serviceName,
          degradationMode: this.currentMode
        }
      } as any);
      
      return {
        success: true,
        result,
        degradationMode: this.currentMode,
        serviceHealth: this.getServiceHealthSnapshot(),
        fallbackUsed: true
      };
    } catch (fallbackError) {
      service.fallbackActive = false;
      
      const enhancedError = errorHandler.createEnhancedError(fallbackError, {
        category: ErrorCategory.SYSTEM,
        severity: ErrorSeverity.HIGH,
        component: serviceName,
        operation: 'fallback',
        timestamp: new Date()
      });
      
      structuredLogger.error('Service fallback failed', {
        timestamp: new Date(),
        metadata: {
          service: serviceName,
          error: enhancedError.message
        }
      });
      
      return {
        success: false,
        degradationMode: this.currentMode,
        serviceHealth: this.getServiceHealthSnapshot(),
        fallbackUsed: true,
        error: enhancedError
      };
    }
  }
  
  /**
   * Handle non-critical service failure
   */
  private handleNonCriticalFailure<T>(
    serviceName: string,
    _error: unknown,
    fallbackValue?: T
  ): DegradationResult<T> {
    const enhancedError = errorHandler.createEnhancedError(_error, {
      category: ErrorCategory.SYSTEM,
      severity: ErrorSeverity.MEDIUM,
      component: serviceName,
      operation: 'nonCriticalFailure',
      timestamp: new Date()
    });
    
    structuredLogger.warn('Non-critical service failed, continuing with degraded functionality', {
      timestamp: new Date(),
      warningType: 'Performance',
      component: 'GracefulDegradation',
      metadata: {
        service: serviceName,
        error: enhancedError.message,
        degradationMode: this.currentMode
      }
    } as any);
    
    return {
      success: true, // System continues to operate
      result: fallbackValue as T,
      degradationMode: this.currentMode,
      serviceHealth: this.getServiceHealthSnapshot(),
      fallbackUsed: true,
      error: enhancedError
    };
  }
  
  /**
   * Update service health metrics
   */
  private updateServiceHealth(
    serviceName: string,
    success: boolean,
    responseTime: number,
    _error?: unknown
  ): void {
    const service = this.services.get(serviceName);
    if (!service) return;
    
    service.lastCheck = new Date();
    service.responseTime = responseTime;
    
    if (success) {
      service.consecutiveFailures = 0;
      if (!service.healthy) {
        service.healthy = true;
        service.fallbackActive = false;
        structuredLogger.info('Service recovered', {
          timestamp: new Date(),
          metadata: {
            service: serviceName,
            responseTime
          }
        });
      }
    } else {
      service.consecutiveFailures++;
      service.errorCount++;
      
      const config = this.degradationConfigs.get(serviceName)!;
      
      if (service.healthy && service.consecutiveFailures >= config.failureThreshold) {
        service.healthy = false;
        structuredLogger.warn('Service marked as unhealthy', {
          timestamp: new Date(),
          warningType: 'Performance',
          component: 'GracefulDegradation',
          metadata: {
            service: serviceName,
            consecutiveFailures: service.consecutiveFailures,
            threshold: config.failureThreshold
          }
        } as any);
        
        // Check if we need to update degradation mode
        this.evaluateDegradationMode();
      }
    }
  }
  
  /**
   * Start health check for a service
   */
  private startHealthCheck(serviceName: string): void {
    const config = this.degradationConfigs.get(serviceName);
    if (!config) return;
    
    const interval = setInterval(async () => {
      const service = this.services.get(serviceName);
      if (!service) return;
      
      try {
        const startTime = Date.now();
        const healthy = await config.healthCheckFunction();
        const responseTime = Date.now() - startTime;
        
        this.updateServiceHealth(serviceName, healthy, responseTime);
      } catch (error) {
        this.updateServiceHealth(serviceName, false, 0, error);
      }
    }, config.checkIntervalMs);
    
    this.healthCheckIntervals.set(serviceName, interval);
  }
  
  /**
   * Evaluate and update degradation mode based on service health
   */
  private evaluateDegradationMode(): void {
    const unhealthyServices = Array.from(this.services.values()).filter(s => !s.healthy);
    const criticalDown = unhealthyServices.some(s => s.priority === ServicePriority.CRITICAL);
    const importantDown = unhealthyServices.filter(s => s.priority === ServicePriority.IMPORTANT).length;
    const optionalDown = unhealthyServices.filter(s => s.priority === ServicePriority.OPTIONAL).length;
    
    let newMode = DegradationMode.FULL_SERVICE;
    
    // Determine degradation mode based on failed services
    if (criticalDown) {
      newMode = DegradationMode.EMERGENCY_MODE;
    } else if (importantDown >= 2) {
      newMode = DegradationMode.ESSENTIAL_ONLY;
    } else if (importantDown >= 1 || optionalDown >= 3) {
      newMode = DegradationMode.PERFORMANCE_MODE;
    }
    
    if (newMode !== this.currentMode) {
      const oldMode = this.currentMode;
      this.currentMode = newMode;
      
      structuredLogger.warn('Degradation mode changed', {
        timestamp: new Date(),
        warningType: 'Performance',
        component: 'GracefulDegradation',
        metadata: {
          oldMode,
          newMode,
          unhealthyServices: unhealthyServices.map(s => ({
            name: s.name,
            priority: s.priority,
            consecutiveFailures: s.consecutiveFailures
          }))
        }
      } as any);
    }
  }
  
  /**
   * Get current service health snapshot
   */
  getServiceHealthSnapshot(): Record<string, ServiceHealth> {
    const snapshot: Record<string, ServiceHealth> = {};
    
    for (const [name, health] of this.services.entries()) {
      snapshot[name] = { ...health };
    }
    
    return snapshot;
  }
  
  /**
   * Get current degradation mode
   */
  getCurrentMode(): DegradationMode {
    return this.currentMode;
  }
  
  /**
   * Force degradation mode (for testing or manual intervention)
   */
  setDegradationMode(mode: DegradationMode): void {
    const oldMode = this.currentMode;
    this.currentMode = mode;
    
    structuredLogger.warn('Degradation mode manually changed', {
      timestamp: new Date(),
      warningType: 'Performance',
      component: 'GracefulDegradation',
      metadata: {
        oldMode,
        newMode: mode
      }
    } as any);
  }
  
  /**
   * Reset service health (clear failure counts)
   */
  resetServiceHealth(serviceName?: string): void {
    if (serviceName) {
      const service = this.services.get(serviceName);
      if (service) {
        service.consecutiveFailures = 0;
        service.errorCount = 0;
        service.healthy = true;
        service.fallbackActive = false;
      }
    } else {
      // Reset all services
      for (const service of this.services.values()) {
        service.consecutiveFailures = 0;
        service.errorCount = 0;
        service.healthy = true;
        service.fallbackActive = false;
      }
      this.currentMode = DegradationMode.FULL_SERVICE;
    }
    
    structuredLogger.info('Service health reset', {
      timestamp: new Date(),
      metadata: { serviceName: serviceName || 'all' }
    });
  }
  
  /**
   * Shutdown health checking
   */
  shutdown(): void {
    for (const interval of this.healthCheckIntervals.values()) {
      clearInterval(interval);
    }
    this.healthCheckIntervals.clear();
    
    structuredLogger.info('Graceful degradation service shut down', {
      timestamp: new Date()
    });
  }
  
  /**
   * Get system health report
   */
  getHealthReport(): {
    degradationMode: DegradationMode;
    totalServices: number;
    healthyServices: number;
    unhealthyServices: number;
    criticalServicesDown: number;
    servicesWithFallback: number;
    activeFallbacks: number;
  } {
    const services = Array.from(this.services.values());
    
    return {
      degradationMode: this.currentMode,
      totalServices: services.length,
      healthyServices: services.filter(s => s.healthy).length,
      unhealthyServices: services.filter(s => !s.healthy).length,
      criticalServicesDown: services.filter(s => !s.healthy && s.priority === ServicePriority.CRITICAL).length,
      servicesWithFallback: services.filter(s => s.fallbackEnabled).length,
      activeFallbacks: services.filter(s => s.fallbackActive).length
    };
  }
}

// Export singleton instance
export const gracefulDegradation = new GracefulDegradationService();