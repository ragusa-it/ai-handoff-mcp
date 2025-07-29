/**
 * MCP Tool Constants
 */

// Cache TTL values (in seconds)
export const CACHE_TTL = {
  LATEST_CONTEXT: 3600, // 1 hour
  HANDOFF_PACKAGE: 24 * 3600, // 24 hours
} as const;

// Content preview settings
export const CONTENT_PREVIEW = {
  MAX_LENGTH: 200,
  TRUNCATION_SUFFIX: '...',
} as const;

// Performance thresholds (in milliseconds)
export const PERFORMANCE_THRESHOLDS = {
  SLOW_OPERATION: 1000,
  VERY_SLOW_OPERATION: 5000,
} as const;

// Log message templates
export const LOG_MESSAGES = {
  SESSION_REGISTERED: (agentFrom: string) => `Session registered by agent: ${agentFrom}`,
  HANDOFF_REQUESTED: (targetAgent: string) => `Handoff requested to agent: ${targetAgent}`,
} as const;