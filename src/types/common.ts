// Common type definitions to replace 'any' usage throughout the codebase

// Base metadata interfaces for different use cases
export interface BaseMetadata {
  [key: string]: unknown;
}

export interface SessionMetadata extends BaseMetadata {
  priority?: 'low' | 'medium' | 'high';
  tags?: string[];
  source?: string;
  environment?: 'dev' | 'staging' | 'prod';
  version?: string;
  clientInfo?: {
    userAgent?: string;
    platform?: string;
    version?: string;
  };
}

export interface ContextMetadata extends BaseMetadata {
  source?: string;
  encoding?: string;
  mimeType?: string;
  checksum?: string;
  transformations?: string[];
  originalSize?: number;
  compressedSize?: number;
}

export interface AnalysisResult {
  type: 'codebase' | 'file' | 'content';
  summary: string;
  complexity?: number;
  linesOfCode?: number;
  dependencies?: string[];
  issues?: Array<{
    type: 'error' | 'warning' | 'info';
    message: string;
    line?: number;
    column?: number;
  }>;
  metrics?: {
    maintainabilityIndex?: number;
    cyclomaticComplexity?: number;
    cognitiveComplexity?: number;
    technicalDebt?: number;
  };
  technologies?: string[];
  patterns?: string[];
  recommendations?: string[];
}

export interface HandoffRequestData extends BaseMetadata {
  reason?: string;
  urgency?: 'low' | 'medium' | 'high' | 'critical';
  context?: {
    summary: string;
    keyPoints: string[];
    currentState: string;
    nextSteps?: string[];
  };
  requirements?: {
    skills?: string[];
    access?: string[];
    tools?: string[];
  };
  transfer?: {
    format: 'full' | 'summary' | 'selective';
    includeHistory: boolean;
    includeFiles: boolean;
    includeContext: boolean;
  };
}

export interface LifecycleEventData extends BaseMetadata {
  trigger?: 'user' | 'system' | 'timeout' | 'error';
  reason?: string;
  previousState?: string;
  newState?: string;
  duration?: number;
  details?: string;
}

export interface SystemLabels extends BaseMetadata {
  service?: string;
  component?: string;
  environment?: string;
  region?: string;
  version?: string;
  instance?: string;
}

export interface PerformanceMetadata extends BaseMetadata {
  operationType?: 'read' | 'write' | 'query' | 'update' | 'delete';
  resourceUsage?: {
    memory?: number;
    cpu?: number;
    network?: number;
    storage?: number;
  };
  cacheHit?: boolean;
  retryCount?: number;
  timeoutMs?: number;
  errorType?: string;
  stackTrace?: string;
}

export interface AggregationData {
  period: 'hour' | 'day' | 'week' | 'month';
  metrics: {
    [metricName: string]: {
      count: number;
      sum: number;
      avg: number;
      min: number;
      max: number;
      p95?: number;
      p99?: number;
    };
  };
  trends?: {
    direction: 'up' | 'down' | 'stable';
    change: number;
    confidence: number;
  };
  anomalies?: Array<{
    type: string;
    severity: 'low' | 'medium' | 'high';
    description: string;
    value: number;
    threshold: number;
  }>;
}

// Analytics-specific types
export interface AnalyticsMetadata extends BaseMetadata {
  queryType?: string;
  dataSource?: string;
  aggregationLevel?: string;
  filters?: string[];
  timeRange?: {
    start: Date;
    end: Date;
  };
}

export interface ResourceUsageData {
  cpu: number;
  memory: number;
  network: number;
  storage: number;
  connections: number;
  activeQueries: number;
  timestamp: Date;
}

export interface SessionStatsData {
  totalSessions: number;
  activeSessions: number;
  completedSessions: number;
  avgDuration: number;
  peakConcurrency: number;
  creationRate: number;
  completionRate: number;
}

export interface HandoffStatsData {
  totalHandoffs: number;
  successfulHandoffs: number;
  failedHandoffs: number;
  avgProcessingTime: number;
  successRate: number;
  byAgent: Record<string, {
    requested: number;
    completed: number;
    avgTime: number;
  }>;
}

export interface PerformanceStatsData {
  totalOperations: number;
  avgResponseTime: number;
  p95ResponseTime: number;
  errorRate: number;
  throughput: number;
  slowQueries: number;
  cacheHitRate: number;
}

// Database query parameter types
export type QueryParameter = string | number | boolean | Date | null | undefined;

// Job result types
export interface JobResult {
  success: boolean;
  duration: number;
  recordsProcessed?: number;
  recordsSkipped?: number;
  errors?: string[];
  warnings?: string[];
  summary?: string;
  details?: BaseMetadata;
}

// Cache value types - more permissive than BaseMetadata
export type CacheValue = unknown;

// Tool call metadata
export interface ToolCallMetadata extends BaseMetadata {
  toolName: string;
  version?: string;
  inputHash?: string;
  outputHash?: string;
  cached?: boolean;
  retries?: number;
  warnings?: string[];
}

// Error context types
export interface ErrorContext extends BaseMetadata {
  operation: string;
  component: string;
  timestamp: Date;
  sessionId?: string;
  userId?: string;
  requestId?: string;
  stackTrace?: string;
  additionalInfo?: BaseMetadata;
}

// Statistics types
export interface StatsData {
  [key: string]: unknown;
}