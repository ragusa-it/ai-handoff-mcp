// Memory usage optimization with garbage collection tuning
import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';

// Type definitions
interface MemoryMetrics {
  heapUsed: number;
  heapTotal: number;
  rss: number;
  external: number;
  arrayBuffers: number;
  gcCount: number;
  gcDuration: number;
  memoryPressure: number; // 0-100 scale
}

interface MemoryOptimizationConfig {
  maxHeapUsagePercent: number;
  gcInterval: number;
  gcThreshold: number;
  memoryPressureThreshold: number;
  cleanupInterval: number;
  enableForcedGC: boolean;
}

interface MemoryAlertConfig {
  maxMemoryUsagePercent: number;
  maxMemoryPressure: number;
  alertNotificationCallback?: ((alert: MemoryAlert) => void) | undefined;
}

interface MemoryAlert {
  type: 'HIGH_MEMORY_USAGE' | 'HIGH_MEMORY_PRESSURE' | 'MEMORY_LEAK';
  severity: 'WARNING' | 'CRITICAL';
  message: string;
  timestamp: Date;
  metrics: MemoryMetrics;
}

interface MemoryLeakDetectionConfig {
  leakDetectionThreshold: number;
  leakDetectionWindow: number;
  leakDetectionSampleSize: number;
}

// Memory optimizer
export class MemoryOptimizer extends EventEmitter {
  private metrics: MemoryMetrics;
  private optimizationConfig: MemoryOptimizationConfig;
  private alertConfig: MemoryAlertConfig;
  private leakDetectionConfig: MemoryLeakDetectionConfig;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private gcInterval: NodeJS.Timeout | null = null;
  private isMonitoring: boolean = false;
  private memoryUsageHistory: number[] = [];
  private gcHistory: Array<{ timestamp: number; duration: number }> = [];
  private leakDetectionSamples: Array<{ timestamp: number; memoryUsage: number }> = [];

  constructor(
    optimizationConfig?: Partial<MemoryOptimizationConfig>,
    alertConfig?: MemoryAlertConfig,
    leakDetectionConfig?: Partial<MemoryLeakDetectionConfig>
  ) {
    super();
    
    this.metrics = {
      heapUsed: 0,
      heapTotal: 0,
      rss: 0,
      external: 0,
      arrayBuffers: 0,
      gcCount: 0,
      gcDuration: 0,
      memoryPressure: 0
    };
    
    this.optimizationConfig = {
      maxHeapUsagePercent: optimizationConfig?.maxHeapUsagePercent || 80,
      gcInterval: optimizationConfig?.gcInterval || 30000, // 30 seconds
      gcThreshold: optimizationConfig?.gcThreshold || 50, // 50MB
      memoryPressureThreshold: optimizationConfig?.memoryPressureThreshold || 70,
      cleanupInterval: optimizationConfig?.cleanupInterval || 60000, // 1 minute
      enableForcedGC: optimizationConfig?.enableForcedGC || false
    };
    
    this.alertConfig = {
      maxMemoryUsagePercent: alertConfig?.maxMemoryUsagePercent || 90,
      maxMemoryPressure: alertConfig?.maxMemoryPressure || 85,
      alertNotificationCallback: alertConfig?.alertNotificationCallback
    };
    
    this.leakDetectionConfig = {
      leakDetectionThreshold: leakDetectionConfig?.leakDetectionThreshold || 10, // 10MB per minute
      leakDetectionWindow: leakDetectionConfig?.leakDetectionWindow || 300000, // 5 minutes
      leakDetectionSampleSize: leakDetectionConfig?.leakDetectionSampleSize || 10
    };
  }

  // Start monitoring and optimization
  startMonitoring(): void {
    if (this.isMonitoring) {
      return;
    }
    
    this.isMonitoring = true;
    
    // Start periodic monitoring
    this.monitoringInterval = setInterval(() => {
      this.collectMetrics();
      this.checkAlerts();
      this.detectMemoryLeaks();
    }, 5000); // Check every 5 seconds
    
    // Start cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.performCleanup();
    }, this.optimizationConfig.cleanupInterval);
    
    // Start GC interval if enabled
    if (this.optimizationConfig.enableForcedGC) {
      this.gcInterval = setInterval(() => {
        this.performForcedGC();
      }, this.optimizationConfig.gcInterval);
    }
    
    console.info('Memory optimization monitoring started');
  }

  // Stop monitoring
  stopMonitoring(): void {
    if (!this.isMonitoring) {
      return;
    }
    
    this.isMonitoring = false;
    
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    if (this.gcInterval) {
      clearInterval(this.gcInterval);
      this.gcInterval = null;
    }
    
    console.info('Memory optimization monitoring stopped');
  }

  // Collect memory metrics
  private collectMetrics(): void {
    try {
      // Get memory usage from Node.js
      const memoryUsage = process.memoryUsage();
      
      this.metrics.heapUsed = memoryUsage.heapUsed;
      this.metrics.heapTotal = memoryUsage.heapTotal;
      this.metrics.rss = memoryUsage.rss;
      this.metrics.external = memoryUsage.external;
      this.metrics.arrayBuffers = memoryUsage.arrayBuffers || 0;
      
      // Calculate memory pressure (0-100 scale)
      this.metrics.memoryPressure = Math.min(
        100, 
        (this.metrics.heapUsed / this.metrics.heapTotal) * 100
      );
      
      // Update history arrays
      this.memoryUsageHistory.push(this.metrics.heapUsed);
      
      // Keep only last 60 samples (5 minutes with 5-second intervals)
      if (this.memoryUsageHistory.length > 60) {
        this.memoryUsageHistory.shift();
      }
      
      // Log metrics for debugging
      console.debug('Memory metrics collected:', {
        heapUsed: `${(this.metrics.heapUsed / 1024 / 1024).toFixed(2)} MB`,
        heapTotal: `${(this.metrics.heapTotal / 1024 / 1024).toFixed(2)} MB`,
        memoryPressure: `${this.metrics.memoryPressure.toFixed(2)}%`
      });
    } catch (error) {
      console.error('Error collecting memory metrics:', error);
    }
  }

  // Check for alerts based on metrics
  private checkAlerts(): void {
    const currentTime = new Date();
    
    // Check memory usage
    const memoryUsagePercent = (this.metrics.heapUsed / this.metrics.heapTotal) * 100;
    if (memoryUsagePercent > this.alertConfig.maxMemoryUsagePercent) {
      const alert: MemoryAlert = {
        type: 'HIGH_MEMORY_USAGE',
        severity: 'CRITICAL',
        message: `High memory usage detected: ${memoryUsagePercent.toFixed(2)}%`,
        timestamp: currentTime,
        metrics: { ...this.metrics }
      };
      
      this.emit('alert', alert);
      if (this.alertConfig.alertNotificationCallback) {
        this.alertConfig.alertNotificationCallback(alert);
      }
    }
    
    // Check memory pressure
    if (this.metrics.memoryPressure > this.alertConfig.maxMemoryPressure) {
      const alert: MemoryAlert = {
        type: 'HIGH_MEMORY_PRESSURE',
        severity: 'WARNING',
        message: `High memory pressure detected: ${this.metrics.memoryPressure.toFixed(2)}%`,
        timestamp: currentTime,
        metrics: { ...this.metrics }
      };
      
      this.emit('alert', alert);
      if (this.alertConfig.alertNotificationCallback) {
        this.alertConfig.alertNotificationCallback(alert);
      }
    }
  }

  // Detect memory leaks
  private detectMemoryLeaks(): void {
    // Add current sample
    this.leakDetectionSamples.push({
      timestamp: Date.now(),
      memoryUsage: this.metrics.heapUsed
    });
    
    // Keep only samples within the detection window
    const windowStart = Date.now() - this.leakDetectionConfig.leakDetectionWindow;
    this.leakDetectionSamples = this.leakDetectionSamples.filter(
      sample => sample.timestamp >= windowStart
    );
    
    // Need at least 3 samples to detect a trend
    if (this.leakDetectionSamples.length < 3) {
      return;
    }
    
    // Calculate memory usage trend
    const firstSample = this.leakDetectionSamples[0];
    const lastSample = this.leakDetectionSamples[this.leakDetectionSamples.length - 1];
    const timeDiffMinutes = (lastSample.timestamp - firstSample.timestamp) / 60000;
    const memoryDiffMB = (lastSample.memoryUsage - firstSample.memoryUsage) / 1024 / 1024;
    const memoryGrowthRate = timeDiffMinutes > 0 ? memoryDiffMB / timeDiffMinutes : 0;
    
    // Check if memory growth rate exceeds threshold
    if (memoryGrowthRate > this.leakDetectionConfig.leakDetectionThreshold) {
      const alert: MemoryAlert = {
        type: 'MEMORY_LEAK',
        severity: 'CRITICAL',
        message: `Memory leak detected: ${memoryGrowthRate.toFixed(2)} MB/minute growth`,
        timestamp: new Date(),
        metrics: { ...this.metrics }
      };
      
      this.emit('alert', alert);
      if (this.alertConfig.alertNotificationCallback) {
        this.alertConfig.alertNotificationCallback(alert);
      }
    }
  }

  // Perform cleanup operations
  private performCleanup(): void {
    // Trigger garbage collection if memory pressure is high
    if (this.metrics.memoryPressure > this.optimizationConfig.memoryPressureThreshold) {
      this.performForcedGC();
    }
    
    // Emit cleanup event for application-specific cleanup
    this.emit('cleanup', { metrics: { ...this.metrics } });
    
    console.debug('Memory cleanup performed');
  }

  // Perform forced garbage collection
  private performForcedGC(): void {
    if (this.optimizationConfig.enableForcedGC && global.gc) {
      const gcStart = performance.now();
      
      // Perform garbage collection
      global.gc();
      
      const gcDuration = performance.now() - gcStart;
      
      // Update GC metrics
      this.metrics.gcCount++;
      this.metrics.gcDuration += gcDuration;
      
      // Add to GC history
      this.gcHistory.push({
        timestamp: Date.now(),
        duration: gcDuration
      });
      
      // Keep only last 100 GC events
      if (this.gcHistory.length > 100) {
        this.gcHistory.shift();
      }
      
      console.debug(`Forced GC completed in ${gcDuration.toFixed(2)}ms`);
    }
  }

  // Get current metrics
  getMetrics(): MemoryMetrics {
    return { ...this.metrics };
  }

  // Get optimization configuration
  getOptimizationConfig(): MemoryOptimizationConfig {
    return { ...this.optimizationConfig };
  }

  // Update optimization configuration
  updateOptimizationConfig(newConfig: Partial<MemoryOptimizationConfig>): void {
    this.optimizationConfig = {
      ...this.optimizationConfig,
      ...newConfig
    };
  }

  // Get alert configuration
  getAlertConfig(): MemoryAlertConfig {
    return { ...this.alertConfig };
  }

  // Update alert configuration
  updateAlertConfig(newConfig: Partial<MemoryAlertConfig>): void {
    this.alertConfig = {
      ...this.alertConfig,
      ...newConfig
    };
  }

  // Get leak detection configuration
  getLeakDetectionConfig(): MemoryLeakDetectionConfig {
    return { ...this.leakDetectionConfig };
  }

  // Update leak detection configuration
  updateLeakDetectionConfig(newConfig: Partial<MemoryLeakDetectionConfig>): void {
    this.leakDetectionConfig = {
      ...this.leakDetectionConfig,
      ...newConfig
    };
  }

  // Close optimizer and cleanup resources
  close(): void {
    this.stopMonitoring();
  }
}

// Memory optimization utilities
export class MemoryOptimizationUtils {
  // Clear object references to help with garbage collection
  static clearObjectReferences(obj: any): void {
    if (obj && typeof obj === 'object') {
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          delete obj[key];
        }
      }
    }
  }

  // Create weak references for large objects
  static createWeakReference<T extends object>(obj: T): WeakRef<T> {
    return new WeakRef(obj);
  }

  // Monitor object lifecycle with FinalizationRegistry
  static monitorObjectLifecycle(obj: object, callback: (heldValue: any) => void): FinalizationRegistry<any> {
    const registry = new FinalizationRegistry(callback);
    registry.register(obj, 'object finalized');
    return registry;
  }

  // Optimize array usage
  static optimizeArray<T>(array: T[]): T[] {
    // Trim array to actual length to free up memory
    array.length = array.length;
    return array;
  }

  // Clear cache entries based on LRU strategy
  static clearLRUCache(cache: Map<any, any>, maxEntries: number): void {
    if (cache.size > maxEntries) {
      const keysToDelete = Array.from(cache.keys()).slice(0, cache.size - maxEntries);
      keysToDelete.forEach(key => cache.delete(key));
    }
  }
}

// Export optimized memory client
export interface OptimizedMemoryClient {
  optimizer: MemoryOptimizer;
  utils: typeof MemoryOptimizationUtils;
}

// Create optimized memory management
export function createOptimizedMemoryManagement(
  optimizationConfig?: Partial<MemoryOptimizationConfig>,
  alertConfig?: MemoryAlertConfig,
  leakDetectionConfig?: Partial<MemoryLeakDetectionConfig>
): OptimizedMemoryClient {
  const optimizer = new MemoryOptimizer(optimizationConfig, alertConfig, leakDetectionConfig);
  
  // Start monitoring
  optimizer.startMonitoring();
  
  return {
    optimizer,
    utils: MemoryOptimizationUtils
  };
}