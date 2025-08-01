// Distributed tracing for request flow analysis and bottleneck identification
import { EventEmitter } from 'events';

// Trace span interface
export interface TraceSpan {
  id: string;
  parentId: string | undefined;
  traceId: string;
  name: string;
  startTime: number;
  endTime: number | undefined;
  duration: number | undefined;
  status: 'ACTIVE' | 'SUCCESS' | 'ERROR';
  tags: Record<string, string | number | boolean>;
  logs: TraceLog[];
}

// Trace log interface
export interface TraceLog {
  timestamp: number;
  message: string;
  fields: Record<string, any> | undefined;
}

// Tracing configuration
export interface TracingConfig {
  serviceName: string;
  sampleRate: number; // 0.0 to 1.0
  enableRemoteReporting: boolean;
  remoteReportingUrl: string;
  maxTraceRetention: number; // milliseconds
  maxTracesToKeep: number;
  enablePerformanceAnalysis: boolean;
  performanceAnalysisInterval: number; // milliseconds
}

// Performance analysis result
export interface PerformanceAnalysis {
  traceId: string;
  bottlenecks: Bottleneck[];
  recommendations: string[];
  overallDuration: number;
}

// Bottleneck identification
export interface Bottleneck {
  spanName: string;
  duration: number;
  percentageOfTotal: number;
  recommendation: string;
}

// Distributed tracer
export class DistributedTracer extends EventEmitter {
  private config: TracingConfig;
  private activeTraces: Map<string, TraceSpan>;
  private traceHistory: TraceSpan[];
  private performanceAnalysisInterval: NodeJS.Timeout | null = null;

  constructor(config?: Partial<TracingConfig>) {
    super();
    
    this.config = {
      serviceName: config?.serviceName || 'ai-handoff-mcp',
      sampleRate: config?.sampleRate || 1.0,
      enableRemoteReporting: config?.enableRemoteReporting || false,
      remoteReportingUrl: config?.remoteReportingUrl || '',
      maxTraceRetention: config?.maxTraceRetention || 3600000, // 1 hour
      maxTracesToKeep: config?.maxTracesToKeep || 1000,
      enablePerformanceAnalysis: config?.enablePerformanceAnalysis || false,
      performanceAnalysisInterval: config?.performanceAnalysisInterval || 60000 // 1 minute
    };
    
    this.activeTraces = new Map();
    this.traceHistory = [];
    
    // Start performance analysis if enabled
    if (this.config.enablePerformanceAnalysis) {
      this.startPerformanceAnalysis();
    }
  }

  // Start a new trace span
  startSpan(name: string, parentId?: string, tags?: Record<string, string | number | boolean>): TraceSpan {
    // Check sampling rate
    if (Math.random() > this.config.sampleRate) {
      // Not sampled, return a minimal span
      return {
        id: this.generateId(),
        parentId: undefined,
        traceId: this.generateId(),
        name: name,
        startTime: Date.now(),
        endTime: undefined,
        duration: undefined,
        status: 'ACTIVE',
        tags: tags || {},
        logs: []
      };
    }
    
    const traceId = parentId ? this.getTraceIdFromParent(parentId) : this.generateId();
    const spanId = this.generateId();
    
    const span: TraceSpan = {
      id: spanId,
      parentId: parentId,
      traceId: traceId,
      name: name,
      startTime: Date.now(),
      endTime: undefined,
      duration: undefined,
      status: 'ACTIVE',
      tags: tags || {},
      logs: []
    };
    
    // Add to active traces
    this.activeTraces.set(spanId, span);
    
    // Log span start
    this.logEvent(spanId, `Span started: ${name}`);
    
    return span;
  }

  // End a trace span
  endSpan(spanId: string, status: 'SUCCESS' | 'ERROR' = 'SUCCESS', errorMessage?: string): void {
    const span = this.activeTraces.get(spanId);
    if (!span) {
      console.warn(`Attempted to end non-existent span: ${spanId}`);
      return;
    }
    
    // Update span properties
    span.endTime = Date.now();
    span.duration = span.endTime - span.startTime;
    span.status = status;
    
    // Add error message if applicable
    if (errorMessage) {
      span.tags.errorMessage = errorMessage;
    }
    
    // Log span end
    this.logEvent(spanId, `Span ended: ${span.name} with status ${status}`);
    
    // Move to history
    this.activeTraces.delete(spanId);
    this.traceHistory.push(span);
    
    // Emit event
    this.emit('spanEnded', span);
    
    // Check if trace is complete
    if (this.isTraceComplete(span.traceId)) {
      this.emit('traceComplete', span.traceId);
    }
    
    // Report trace if enabled
    if (this.config.enableRemoteReporting && this.config.remoteReportingUrl) {
      this.reportTrace(span);
    }
    
    // Clean up old traces
    this.cleanupOldTraces();
  }

  // Add a log event to a span
  logEvent(spanId: string, message: string, fields?: Record<string, any>): void {
    const span = this.activeTraces.get(spanId) || this.findSpanInHistory(spanId);
    if (!span) {
      console.warn(`Attempted to log event to non-existent span: ${spanId}`);
      return;
    }
    
    const log: TraceLog = {
      timestamp: Date.now(),
      message: message,
      fields: fields
    };
    
    span.logs.push(log);
  }

  // Add tags to a span
  addTags(spanId: string, tags: Record<string, string | number | boolean>): void {
    const span = this.activeTraces.get(spanId) || this.findSpanInHistory(spanId);
    if (!span) {
      console.warn(`Attempted to add tags to non-existent span: ${spanId}`);
      return;
    }
    
    span.tags = { ...span.tags, ...tags };
  }

  // Get active traces
  getActiveTraces(): TraceSpan[] {
    return Array.from(this.activeTraces.values());
  }

  // Get trace history
  getTraceHistory(limit?: number): TraceSpan[] {
    const history = [...this.traceHistory].reverse();
    return limit ? history.slice(0, limit) : history;
  }

  // Get trace by ID
  getTrace(traceId: string): TraceSpan[] {
    const traceSpans = [...this.activeTraces.values(), ...this.traceHistory].filter(
      span => span.traceId === traceId
    );
    return traceSpans;
  }

  // Get performance analysis
  getPerformanceAnalysis(traceId?: string): PerformanceAnalysis[] {
    const tracesToAnalyze = traceId ? this.getTrace(traceId) : this.traceHistory;
    
    return tracesToAnalyze
      .filter(span => span.duration !== undefined && span.duration > 0)
      .map(span => this.analyzeTrace(span))
      .filter(analysis => analysis.bottlenecks.length > 0);
  }

  // Analyze a single trace
  private analyzeTrace(span: TraceSpan): PerformanceAnalysis {
    const bottlenecks: Bottleneck[] = [];
    const totalDuration = span.duration || 0;
    
    // Simple bottleneck detection based on duration
    if (totalDuration > 1000) { // More than 1 second
      bottlenecks.push({
        spanName: span.name,
        duration: totalDuration,
        percentageOfTotal: 100,
        recommendation: `Optimize ${span.name} - duration of ${totalDuration}ms exceeds threshold`
      });
    }
    
    return {
      traceId: span.traceId,
      bottlenecks,
      recommendations: bottlenecks.map(b => b.recommendation),
      overallDuration: totalDuration
    };
  }

  // Find span in history
  private findSpanInHistory(spanId: string): TraceSpan | undefined {
    return this.traceHistory.find(span => span.id === spanId);
  }

  // Get trace ID from parent
  private getTraceIdFromParent(parentId: string): string {
    const parentSpan = this.activeTraces.get(parentId) || this.findSpanInHistory(parentId);
    return parentSpan ? parentSpan.traceId : this.generateId();
  }

  // Check if trace is complete
  private isTraceComplete(traceId: string): boolean {
    // In a real implementation, this would check if all spans in a trace are complete
    // For now, we'll just check if there are no active spans with this trace ID
    const activeSpans = Array.from(this.activeTraces.values()).filter(
      span => span.traceId === traceId
    );
    return activeSpans.length === 0;
  }

  // Generate unique ID
  private generateId(): string {
    return Math.random().toString(36).substr(2, 9);
  }

  // Report trace to remote service
  private async reportTrace(span: TraceSpan): Promise<void> {
    try {
      // In a real implementation, this would send trace data to a remote service
      console.debug(`Reporting trace ${span.traceId} to ${this.config.remoteReportingUrl}`);
      
      // Simulate network delay
      await new Promise(resolve => setTimeout(resolve, 10));
      
      console.debug(`Trace ${span.traceId} reported successfully`);
    } catch (error) {
      console.error(`Error reporting trace ${span.traceId}:`, error);
    }
  }

  // Clean up old traces
  private cleanupOldTraces(): void {
    const now = Date.now();
    const expirationTime = this.config.maxTraceRetention;
    
    // Clean up trace history
    this.traceHistory = this.traceHistory.filter(span => {
      const spanEndTime = span.endTime || span.startTime;
      return now - spanEndTime < expirationTime;
    });
    
    // Limit trace history size
    if (this.traceHistory.length > this.config.maxTracesToKeep) {
      this.traceHistory = this.traceHistory.slice(-this.config.maxTracesToKeep);
    }
  }

  // Start performance analysis
  private startPerformanceAnalysis(): void {
    this.performanceAnalysisInterval = setInterval(() => {
      const analysis = this.getPerformanceAnalysis();
      if (analysis.length > 0) {
        this.emit('performanceAnalysis', analysis);
      }
    }, this.config.performanceAnalysisInterval);
  }

  // Stop performance analysis
  private stopPerformanceAnalysis(): void {
    if (this.performanceAnalysisInterval) {
      clearInterval(this.performanceAnalysisInterval);
      this.performanceAnalysisInterval = null;
    }
  }

  // Close tracer and cleanup resources
  close(): void {
    this.stopPerformanceAnalysis();
    this.activeTraces.clear();
    this.traceHistory.length = 0;
    
    console.info('Distributed tracer closed');
  }
}

// Tracing utilities
export interface TracingUtils {
  formatTraceDuration: (duration: number) => string;
  getTraceStatusColor: (status: TraceSpan['status']) => string;
  calculatePercentile: (values: number[], percentile: number) => number;
}

// Tracing utilities implementation
export const tracingUtils: TracingUtils = {
  // Format trace duration for display
  formatTraceDuration(duration: number): string {
    if (duration < 1) {
      return `${duration.toFixed(2)}ms`;
    } else if (duration < 1000) {
      return `${duration.toFixed(1)}ms`;
    } else {
      return `${(duration / 1000).toFixed(2)}s`;
    }
  },

  // Get trace status color
  getTraceStatusColor(status: TraceSpan['status']): string {
    switch (status) {
      case 'ACTIVE':
        return '#0000FF'; // Blue
      case 'SUCCESS':
        return '#00FF00'; // Green
      case 'ERROR':
        return '#FF0000'; // Red
      default:
        return '#000000'; // Black
    }
  },

  // Calculate percentile from array of numbers
  calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = (percentile / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index % 1;
    
    if (lower === upper) {
      return sorted[lower];
    }
    
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }
};

// Export optimized tracing client
export interface OptimizedTracingClient {
  tracer: DistributedTracer;
  utils: TracingUtils;
}

// Create optimized tracing system
export function createOptimizedTracingSystem(config?: Partial<TracingConfig>): OptimizedTracingClient {
  const tracer = new DistributedTracer(config);
  
  return {
    tracer,
    utils: tracingUtils
  };
}