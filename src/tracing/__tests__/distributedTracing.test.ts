import { DistributedTracer, tracingUtils, createOptimizedTracingSystem } from '../distributedTracing';

// Mock console methods
const mockConsoleDebug = jest.spyOn(console, 'debug').mockImplementation();
const mockConsoleInfo = jest.spyOn(console, 'info').mockImplementation();
const mockConsoleWarn = jest.spyOn(console, 'warn').mockImplementation();
const mockConsoleError = jest.spyOn(console, 'error').mockImplementation();

describe('DistributedTracer', () => {
  let tracer: DistributedTracer;

  beforeEach(() => {
    tracer = new DistributedTracer({
      serviceName: 'test-service',
      sampleRate: 1.0,
      enableRemoteReporting: true,
      remoteReportingUrl: 'https://tracing.example.com/api/v1/spans'
    });
  });

  afterEach(() => {
    tracer.close();
    jest.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize with default configuration', () => {
      const defaultTracer = new DistributedTracer();
      expect(defaultTracer).toBeInstanceOf(DistributedTracer);
      defaultTracer.close();
    });

    it('should initialize with custom configuration', () => {
      const customTracer = new DistributedTracer({
        serviceName: 'custom-service',
        sampleRate: 0.5
      });
      
      expect(customTracer).toBeInstanceOf(DistributedTracer);
      customTracer.close();
    });
  });

  describe('Span Management', () => {
    it('should start a new span', () => {
      const span = tracer.startSpan('test-operation');
      
      expect(span).toBeDefined();
      expect(span.id).toBeDefined();
      expect(span.traceId).toBeDefined();
      expect(span.name).toBe('test-operation');
      expect(span.startTime).toBeDefined();
      expect(span.status).toBe('ACTIVE');
    });

    it('should start a child span with parent', () => {
      const parentSpan = tracer.startSpan('parent-operation');
      const childSpan = tracer.startSpan('child-operation', parentSpan.id);
      
      expect(childSpan.parentId).toBe(parentSpan.id);
      expect(childSpan.traceId).toBe(parentSpan.traceId);
    });

    it('should end a span successfully', () => {
      const spanEndedCallback = jest.fn();
      tracer.on('spanEnded', spanEndedCallback);
      
      const span = tracer.startSpan('test-operation');
      tracer.endSpan(span.id, 'SUCCESS');
      
      expect(span.status).toBe('SUCCESS');
      expect(span.endTime).toBeDefined();
      expect(span.duration).toBeDefined();
      expect(spanEndedCallback).toHaveBeenCalledWith(expect.objectContaining({
        id: span.id,
        status: 'SUCCESS'
      }));
    });

    it('should end a span with error', () => {
      const span = tracer.startSpan('test-operation');
      tracer.endSpan(span.id, 'ERROR', 'Test error message');
      
      expect(span.status).toBe('ERROR');
      expect(span.tags.errorMessage).toBe('Test error message');
    });

    it('should warn when ending non-existent span', () => {
      tracer.endSpan('non-existent-id');
      
      expect(mockConsoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('Attempted to end non-existent span')
      );
    });
  });

  describe('Span Logging and Tagging', () => {
    it('should add log events to span', () => {
      const span = tracer.startSpan('test-operation');
      tracer.logEvent(span.id, 'Test log message', { key: 'value' });
      
      expect(span.logs).toHaveLength(1);
      expect(span.logs[0].message).toBe('Test log message');
      expect(span.logs[0].fields).toEqual({ key: 'value' });
    });

    it('should warn when logging to non-existent span', () => {
      tracer.logEvent('non-existent-id', 'Test log message');
      
      expect(mockConsoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('Attempted to log event to non-existent span')
      );
    });

    it('should add tags to span', () => {
      const span = tracer.startSpan('test-operation');
      tracer.addTags(span.id, { tag1: 'value1', tag2: 42 });
      
      expect(span.tags.tag1).toBe('value1');
      expect(span.tags.tag2).toBe(42);
    });

    it('should warn when adding tags to non-existent span', () => {
      tracer.addTags('non-existent-id', { tag1: 'value1' });
      
      expect(mockConsoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('Attempted to add tags to non-existent span')
      );
    });
  });

  describe('Trace Management', () => {
    it('should get active traces', () => {
      const span1 = tracer.startSpan('operation-1');
      const span2 = tracer.startSpan('operation-2');
      
      const activeTraces = tracer.getActiveTraces();
      
      expect(activeTraces).toHaveLength(2);
      expect(activeTraces.map(s => s.id)).toContain(span1.id);
      expect(activeTraces.map(s => s.id)).toContain(span2.id);
    });

    it('should get trace history', () => {
      const span = tracer.startSpan('test-operation');
      tracer.endSpan(span.id);
      
      const history = tracer.getTraceHistory();
      
      expect(history).toHaveLength(1);
      expect(history[0].id).toBe(span.id);
    });

    it('should limit trace history by count', () => {
      // Create multiple spans
      for (let i = 0; i < 5; i++) {
        const span = tracer.startSpan(`operation-${i}`);
        tracer.endSpan(span.id);
      }
      
      const history = tracer.getTraceHistory(3);
      expect(history).toHaveLength(3);
    });

    it('should get trace by ID', () => {
      const span = tracer.startSpan('test-operation');
      const traceSpans = tracer.getTrace(span.traceId);
      
      expect(traceSpans).toHaveLength(1);
      expect(traceSpans[0].id).toBe(span.id);
    });
  });

  describe('Performance Analysis', () => {
    it('should get performance analysis', () => {
      // Create a span with long duration
      const span = tracer.startSpan('slow-operation');
      
      // Simulate long operation
      const startTime = span.startTime;
      jest.spyOn(global.Date, 'now').mockImplementation(() => startTime + 2000); // 2 seconds
      
      tracer.endSpan(span.id);
      
      const analysis = tracer.getPerformanceAnalysis();
      
      // Restore Date.now
      (global.Date.now as jest.Mock).mockRestore();
      
      // Should have performance analysis for slow operations
      expect(analysis).toBeDefined();
    });

    it('should analyze a single trace', () => {
      const span = tracer.startSpan('test-operation');
      
      // Simulate long operation
      const startTime = span.startTime;
      jest.spyOn(global.Date, 'now').mockImplementation(() => startTime + 1500); // 1.5 seconds
      
      tracer.endSpan(span.id);
      
      const analysis = (tracer as any).analyzeTrace(span);
      
      // Restore Date.now
      (global.Date.now as jest.Mock).mockRestore();
      
      expect(analysis.traceId).toBe(span.traceId);
      expect(analysis.overallDuration).toBe(1500);
    });
  });

  describe('Trace Reporting', () => {
    it('should report trace to remote service', async () => {
      const span = tracer.startSpan('test-operation');
      tracer.endSpan(span.id);
      
      // Wait for async reporting
      await new Promise(resolve => setTimeout(resolve, 50));
      
      expect(mockConsoleDebug).toHaveBeenCalledWith(
        expect.stringContaining('Reporting trace')
      );
      expect(mockConsoleDebug).toHaveBeenCalledWith(
        expect.stringContaining('Trace reported successfully')
      );
    });

    it('should handle trace reporting errors', async () => {
      // Mock fetch to simulate network error
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
      
      const span = tracer.startSpan('test-operation');
      tracer.endSpan(span.id);
      
      // Wait for async reporting
      await new Promise(resolve => setTimeout(resolve, 50));
      
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('Error reporting trace'),
        expect.any(Error)
      );
      
      // Restore fetch
      global.fetch = originalFetch;
    });
  });

  describe('Trace Cleanup', () => {
    it('should clean up old traces', () => {
      // Create a span and end it
      const span = tracer.startSpan('test-operation');
      tracer.endSpan(span.id);
      
      // Verify it's in history
      expect(tracer.getTraceHistory()).toHaveLength(1);
      
      // Clean up traces
      (tracer as any).cleanupOldTraces();
      
      // Should still be in history (not expired yet)
      expect(tracer.getTraceHistory()).toHaveLength(1);
    });

    it('should limit trace history size', () => {
      const tracerWithLimit = new DistributedTracer({
        maxTracesToKeep: 2
      });
      
      // Create more spans than limit
      for (let i = 0; i < 5; i++) {
        const span = tracerWithLimit.startSpan(`operation-${i}`);
        tracerWithLimit.endSpan(span.id);
      }
      
      const history = tracerWithLimit.getTraceHistory();
      expect(history).toHaveLength(2); // Limited to 2
      
      tracerWithLimit.close();
    });
  });
});

describe('TracingUtils', () => {
  describe('formatTraceDuration', () => {
    it('should format milliseconds correctly', () => {
      const formatted = tracingUtils.formatTraceDuration(0.5);
      expect(formatted).toBe('0.50ms');
    });

    it('should format seconds correctly', () => {
      const formatted = tracingUtils.formatTraceDuration(1500);
      expect(formatted).toBe('1.50s');
    });
  });

  describe('getTraceStatusColor', () => {
    it('should return correct color for ACTIVE status', () => {
      const color = tracingUtils.getTraceStatusColor('ACTIVE');
      expect(color).toBe('#0000FF');
    });

    it('should return correct color for SUCCESS status', () => {
      const color = tracingUtils.getTraceStatusColor('SUCCESS');
      expect(color).toBe('#00FF00');
    });

    it('should return correct color for ERROR status', () => {
      const color = tracingUtils.getTraceStatusColor('ERROR');
      expect(color).toBe('#FF0000');
    });
  });

  describe('calculatePercentile', () => {
    it('should calculate percentile correctly', () => {
      const values = [1, 2, 3, 4, 5];
      const percentile50 = tracingUtils.calculatePercentile(values, 50);
      expect(percentile50).toBe(3);
    });

    it('should return 0 for empty array', () => {
      const percentile = tracingUtils.calculatePercentile([], 50);
      expect(percentile).toBe(0);
    });
  });
});

describe('OptimizedTracingClient', () => {
  it('should create optimized tracing client', () => {
    const client = createOptimizedTracingSystem({
      serviceName: 'test-service'
    });

    expect(client).toHaveProperty('tracer');
    expect(client).toHaveProperty('utils');
    expect(client.tracer).toBeInstanceOf(DistributedTracer);
    expect(client.utils).toBe(tracingUtils);

    client.tracer.close();
  });

  it('should create optimized tracing client with default config', () => {
    const client = createOptimizedTracingSystem();
    
    expect(client).toHaveProperty('tracer');
    expect(client).toHaveProperty('utils');
    
    client.tracer.close();
  });
});

// Restore console methods
afterAll(() => {
  mockConsoleDebug.mockRestore();
  mockConsoleInfo.mockRestore();
  mockConsoleWarn.mockRestore();
  mockConsoleError.mockRestore();
});