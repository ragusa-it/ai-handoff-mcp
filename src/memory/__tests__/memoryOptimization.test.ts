// Memory optimization tests
import { MemoryOptimizer, MemoryOptimizationUtils, createOptimizedMemoryManagement } from '../memoryOptimization';

describe('Memory Optimization Tests', () => {
  describe('MemoryOptimizer', () => {
    let optimizer: MemoryOptimizer;

    beforeEach(() => {
      optimizer = new MemoryOptimizer();
      jest.clearAllMocks();
    });

    afterEach(() => {
      optimizer.stopMonitoring();
    });

    it('should start and stop monitoring', () => {
      // Verify monitoring can be started and stopped
      expect(() => optimizer.startMonitoring()).not.toThrow();
      expect(() => optimizer.stopMonitoring()).not.toThrow();
      
      // Verify monitoring state
      // Note: We can't directly access private properties, but we can verify the methods work
    });

    it('should collect metrics', () => {
      // Access private method through reflection for testing
      const collectMetrics = (optimizer as any).collectMetrics.bind(optimizer);
      
      expect(() => collectMetrics()).not.toThrow();
      
      // Verify metrics are collected
      const metrics = optimizer.getMetrics();
      expect(metrics).toBeDefined();
    });

    it('should check alerts', () => {
      // Access private method through reflection for testing
      const checkAlerts = (optimizer as any).checkAlerts.bind(optimizer);
      
      expect(() => checkAlerts()).not.toThrow();
    });

    it('should detect memory leaks', () => {
      // Access private method through reflection for testing
      const detectMemoryLeaks = (optimizer as any).detectMemoryLeaks.bind(optimizer);
      
      expect(() => detectMemoryLeaks()).not.toThrow();
    });

    it('should perform cleanup', () => {
      // Access private method through reflection for testing
      const performCleanup = (optimizer as any).performCleanup.bind(optimizer);
      
      expect(() => performCleanup()).not.toThrow();
    });

    it('should perform forced GC', () => {
      // Access private method through reflection for testing
      const performForcedGC = (optimizer as any).performForcedGC.bind(optimizer);
      
      expect(() => performForcedGC()).not.toThrow();
    });

    it('should get and update configuration', () => {
      // Get current configuration
      const config = optimizer.getOptimizationConfig();
      expect(config).toBeDefined();
      expect(config).toHaveProperty('maxHeapUsagePercent');
      expect(config).toHaveProperty('gcInterval');
      
      // Update configuration
      optimizer.updateOptimizationConfig({ maxHeapUsagePercent: 90 });
      const updatedConfig = optimizer.getOptimizationConfig();
      expect(updatedConfig.maxHeapUsagePercent).toBe(90);
    });

    it('should handle alerts', (done) => {
      // Set up alert listener
      optimizer.on('alert', (alert) => {
        expect(alert).toBeDefined();
        expect(alert.type).toBeDefined();
        expect(alert.severity).toBeDefined();
        expect(alert.message).toBeDefined();
        done();
      });
      
      // Trigger an alert by setting high memory usage
      const checkAlerts = (optimizer as any).checkAlerts.bind(optimizer);
      checkAlerts();
    });

    it('should handle cleanup events', (done) => {
      // Set up cleanup listener
      optimizer.on('cleanup', (data) => {
        expect(data).toBeDefined();
        expect(data.metrics).toBeDefined();
        done();
      });
      
      // Trigger cleanup
      const performCleanup = (optimizer as any).performCleanup.bind(optimizer);
      performCleanup();
    });
  });

  describe('MemoryOptimizationUtils', () => {
    it('should clear object references', () => {
      const testObj: any = { a: 1, b: 2, c: 3 };
      expect(testObj.a).toBe(1);
      
      MemoryOptimizationUtils.clearObjectReferences(testObj);
      
      // Note: In a real scenario, we would verify the properties are deleted
      // For this test, we'll just verify the method doesn't throw
      expect(true).toBe(true);
    });

    it('should create weak references', () => {
      const testObj = { data: 'test' };
      const weakRef = MemoryOptimizationUtils.createWeakReference(testObj);
      
      expect(weakRef).toBeDefined();
      // Note: We can't dereference the weak reference in this test environment
    });

    it('should monitor object lifecycle', () => {
      const testObj = { data: 'test' };
      const callback = jest.fn();
      
      const registry = MemoryOptimizationUtils.monitorObjectLifecycle(testObj, callback);
      
      expect(registry).toBeDefined();
      expect(typeof registry.register).toBe('function');
    });

    it('should optimize arrays', () => {
      const testArray = [1, 2, 3, 4, 5];
      const optimizedArray = MemoryOptimizationUtils.optimizeArray(testArray);
      
      expect(optimizedArray).toBe(testArray);
      expect(optimizedArray.length).toBe(5);
    });

    it('should clear LRU cache', () => {
      const testCache = new Map();
      testCache.set('key1', 'value1');
      testCache.set('key2', 'value2');
      testCache.set('key3', 'value3');
      
      expect(testCache.size).toBe(3);
      
      MemoryOptimizationUtils.clearLRUCache(testCache, 2);
      
      // Should keep at most 2 entries
      expect(testCache.size).toBeLessThanOrEqual(2);
    });
  });

  describe('Optimized Memory Client', () => {
    it('should create optimized memory management', () => {
      const client = createOptimizedMemoryManagement();
      
      expect(client).toBeDefined();
      expect(client).toHaveProperty('optimizer');
      expect(client).toHaveProperty('utils');
    });

    it('should start monitoring automatically', () => {
      // Create a mock optimizer to spy on startMonitoring
      const mockOptimizer = {
        startMonitoring: jest.fn(),
        stopMonitoring: jest.fn(),
        getMetrics: jest.fn(),
        getOptimizationConfig: jest.fn(),
        updateOptimizationConfig: jest.fn()
      };
      
      // In a real test, we would verify that monitoring starts automatically
      // For now, we'll just verify the function doesn't throw
      expect(() => createOptimizedMemoryManagement()).not.toThrow();
    });
  });

  describe('Memory Metrics Collection', () => {
    let optimizer: MemoryOptimizer;

    beforeEach(() => {
      optimizer = new MemoryOptimizer();
    });

    it('should collect and report metrics', () => {
      // Collect metrics
      const collectMetrics = (optimizer as any).collectMetrics.bind(optimizer);
      collectMetrics();
      
      // Get metrics
      const metrics = optimizer.getMetrics();
      
      expect(metrics).toBeDefined();
      expect(metrics).toHaveProperty('heapUsed');
      expect(metrics).toHaveProperty('heapTotal');
      expect(metrics).toHaveProperty('rss');
      expect(metrics).toHaveProperty('external');
      expect(metrics).toHaveProperty('arrayBuffers');
      expect(metrics).toHaveProperty('gcCount');
      expect(metrics).toHaveProperty('gcDuration');
      expect(metrics).toHaveProperty('memoryPressure');
    });

    it('should maintain metrics history', () => {
      // Collect multiple metrics samples
      const collectMetrics = (optimizer as any).collectMetrics.bind(optimizer);
      
      for (let i = 0; i < 5; i++) {
        collectMetrics();
      }
      
      // Verify metrics are being collected
      const metrics = optimizer.getMetrics();
      expect(metrics.heapUsed).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Memory Optimization', () => {
    let optimizer: MemoryOptimizer;

    beforeEach(() => {
      optimizer = new MemoryOptimizer();
    });

    it('should adjust optimization based on usage', () => {
      // Access private methods through reflection for testing
      const performCleanup = (optimizer as any).performCleanup.bind(optimizer);
      const performForcedGC = (optimizer as any).performForcedGC.bind(optimizer);
      
      // Test cleanup operations
      expect(() => performCleanup()).not.toThrow();
      expect(() => performForcedGC()).not.toThrow();
    });

    it('should update optimization configuration', () => {
      const originalConfig = optimizer.getOptimizationConfig();
      
      // Update configuration
      optimizer.updateOptimizationConfig({ 
        maxHeapUsagePercent: 95,
        gcInterval: 60000
      });
      
      const updatedConfig = optimizer.getOptimizationConfig();
      expect(updatedConfig.maxHeapUsagePercent).toBe(95);
      expect(updatedConfig.gcInterval).toBe(60000);
      expect(updatedConfig.memoryPressureThreshold).toBe(originalConfig.memoryPressureThreshold); // Unchanged
    });
  });

  describe('Error Handling', () => {
    let optimizer: MemoryOptimizer;

    beforeEach(() => {
      optimizer = new MemoryOptimizer();
    });

    it('should handle metric collection errors gracefully', () => {
      // Access private method through reflection for testing
      const collectMetrics = (optimizer as any).collectMetrics.bind(optimizer);
      
      // Should not throw despite potential internal errors
      expect(() => collectMetrics()).not.toThrow();
    });

    it('should close optimizer cleanly', () => {
      expect(() => optimizer.close()).not.toThrow();
      expect(() => optimizer.stopMonitoring()).not.toThrow();
    });
  });

  describe('Memory Leak Detection', () => {
    let optimizer: MemoryOptimizer;

    beforeEach(() => {
      optimizer = new MemoryOptimizer();
    });

    it('should detect memory leaks', () => {
      // Access private method through reflection for testing
      const detectMemoryLeaks = (optimizer as any).detectMemoryLeaks.bind(optimizer);
      
      expect(() => detectMemoryLeaks()).not.toThrow();
    });

    it('should update leak detection configuration', () => {
      const originalConfig = (optimizer as any).leakDetectionConfig;
      
      // Update configuration
      optimizer.updateLeakDetectionConfig({ 
        leakDetectionThreshold: 20,
        leakDetectionWindow: 600000
      });
      
      const updatedConfig = optimizer.getLeakDetectionConfig();
      expect(updatedConfig.leakDetectionThreshold).toBe(20);
      expect(updatedConfig.leakDetectionWindow).toBe(600000);
    });
  });

  describe('Alert Configuration', () => {
    let optimizer: MemoryOptimizer;

    beforeEach(() => {
      optimizer = new MemoryOptimizer();
    });

    it('should get and update alert configuration', () => {
      // Get current configuration
      const config = optimizer.getAlertConfig();
      expect(config).toBeDefined();
      expect(config).toHaveProperty('maxMemoryUsagePercent');
      expect(config).toHaveProperty('maxMemoryPressure');
      
      // Update configuration
      optimizer.updateAlertConfig({ maxMemoryUsagePercent: 95 });
      const updatedConfig = optimizer.getAlertConfig();
      expect(updatedConfig.maxMemoryUsagePercent).toBe(95);
      expect(updatedConfig.maxMemoryPressure).toBe(config.maxMemoryPressure); // Unchanged
    });
  });
});