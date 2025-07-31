import {
  CallToolRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { configurationManager, type RetentionPolicy, type MonitoringConfig, type AnalyticsConfig } from '../../services/configurationManager.js';
import { structuredLogger } from '../../services/structuredLogger.js';
import { PerformanceTimer } from '../utils/performance.js';

// Input validation schema
const UpdateConfigurationSchema = z.object({
  configSection: z.enum(['retention', 'monitoring', 'analytics', 'all']),
  configuration: z.record(z.any()).optional(),
  retentionPolicy: z.object({
    sessionExpirationDays: z.number().min(1).max(365).optional(),
    contextHistoryRetentionDays: z.number().min(1).max(365).optional(),
    performanceLogsRetentionDays: z.number().min(1).max(365).optional(),
    systemMetricsRetentionDays: z.number().min(1).max(365).optional(),
    analyticsAggregationRetentionDays: z.number().min(1).max(730).optional(),
    dormantSessionThresholdDays: z.number().min(1).max(30).optional(),
    archiveAfterDays: z.number().min(1).max(365).optional(),
    purgeArchivedAfterDays: z.number().min(30).max(2555).optional(),
    enableAutoCleanup: z.boolean().optional(),
    cleanupScheduleCron: z.string().optional(),
  }).optional(),
  monitoringConfig: z.object({
    healthCheckInterval: z.number().min(10).max(3600).optional(),
    metricsCollectionInterval: z.number().min(10).max(3600).optional(),
    performanceTrackingEnabled: z.boolean().optional(),
    alertThresholds: z.object({
      responseTime: z.number().min(100).max(30000).optional(),
      errorRate: z.number().min(0).max(100).optional(),
      memoryUsage: z.number().min(50).max(95).optional(),
      diskUsage: z.number().min(50).max(95).optional(),
      cpuUsage: z.number().min(50).max(95).optional(),
      sessionCount: z.number().min(10).max(10000).optional(),
    }).optional(),
    enablePrometheusExport: z.boolean().optional(),
    enableHealthEndpoint: z.boolean().optional(),
    enableStructuredLogging: z.boolean().optional(),
    logLevel: z.enum(['error', 'warn', 'info', 'debug']).optional(),
    enableAuditTrail: z.boolean().optional(),
    anomalyDetectionEnabled: z.boolean().optional(),
    anomalyDetectionThresholds: z.object({
      sessionDurationZScore: z.number().min(1).max(5).optional(),
      contextSizeZScore: z.number().min(1).max(5).optional(),
      handoffFrequencyZScore: z.number().min(1).max(5).optional(),
    }).optional(),
  }).optional(),
  analyticsConfig: z.object({
    enableSessionAnalytics: z.boolean().optional(),
    enablePerformanceAnalytics: z.boolean().optional(),
    enableUsageAnalytics: z.boolean().optional(),
    aggregationIntervals: z.object({
      realTime: z.boolean().optional(),
      hourly: z.boolean().optional(),
      daily: z.boolean().optional(),
      weekly: z.boolean().optional(),
      monthly: z.boolean().optional(),
    }).optional(),
    dataRetentionPolicy: z.object({
      rawDataDays: z.number().min(1).max(90).optional(),
      aggregatedDataDays: z.number().min(30).max(730).optional(),
      enableDataCompression: z.boolean().optional(),
    }).optional(),
    reportingEnabled: z.boolean().optional(),
    reportingSchedule: z.string().optional(),
    exportFormats: z.array(z.enum(['json', 'csv', 'prometheus'])).optional(),
    enableTrendAnalysis: z.boolean().optional(),
    enablePredictiveAnalytics: z.boolean().optional(),
    mlModelUpdateInterval: z.number().min(1).max(168).optional(),
  }).optional(),
  updatedBy: z.string().default('mcp-tool'),
});

/**
 * Helper function to filter out undefined values recursively
 */
function filterUndefinedValues(obj: any): any {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => filterUndefinedValues(item));
  }
  
  const filtered: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      filtered[key] = filterUndefinedValues(value);
    }
  }
  return filtered;
}

/**
 * Update Configuration Tool
 * Updates system configuration including retention policies, monitoring settings, and analytics configuration
 */
export async function updateConfigurationTool(request: z.infer<typeof CallToolRequestSchema>) {
  const timer = new PerformanceTimer();
  
  try {
    // Validate input
    const validationResult = UpdateConfigurationSchema.safeParse(request.params);
    if (!validationResult.success) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid configuration update parameters: ${validationResult.error.message}`
      );
    }

    const { 
      configSection, 
      configuration, 
      retentionPolicy, 
      monitoringConfig, 
      analyticsConfig,
      updatedBy 
    } = validationResult.data;

    structuredLogger.logToolCall({
      timestamp: new Date(),
      toolName: 'update_configuration',
      executionTimeMs: 0,
      success: true,
      inputParameters: {
        configSection,
        hasRetentionPolicy: !!retentionPolicy,
        hasMonitoringConfig: !!monitoringConfig,
        hasAnalyticsConfig: !!analyticsConfig,
        updatedBy
      }
    });

    let result: any = {};

    // Update specific configuration sections
    switch (configSection) {
      case 'retention':
        if (retentionPolicy) {
          // Filter out undefined values
          const filteredPolicy = Object.fromEntries(
            Object.entries(retentionPolicy).filter(([_, value]) => value !== undefined)
          ) as Partial<RetentionPolicy>;
          result.retentionPolicy = await configurationManager.updateRetentionPolicy(filteredPolicy);
        } else {
          throw new McpError(
            ErrorCode.InvalidParams,
            'retentionPolicy is required when configSection is "retention"'
          );
        }
        break;

      case 'monitoring':
        if (monitoringConfig) {
          // Filter out undefined values recursively
          const filteredConfig = filterUndefinedValues(monitoringConfig) as Partial<MonitoringConfig>;
          result.monitoringConfig = await configurationManager.updateMonitoringConfig(filteredConfig);
        } else {
          throw new McpError(
            ErrorCode.InvalidParams,
            'monitoringConfig is required when configSection is "monitoring"'
          );
        }
        break;

      case 'analytics':
        if (analyticsConfig) {
          // Filter out undefined values recursively
          const filteredConfig = filterUndefinedValues(analyticsConfig) as Partial<AnalyticsConfig>;
          result.analyticsConfig = await configurationManager.updateAnalyticsConfig(filteredConfig);
        } else {
          throw new McpError(
            ErrorCode.InvalidParams,
            'analyticsConfig is required when configSection is "analytics"'
          );
        }
        break;

      case 'all':
        // Update all provided configurations
        const updatePayload: any = { updatedBy };
        
        if (retentionPolicy) {
          updatePayload.retention = { ...configurationManager.getRetentionPolicy(), ...retentionPolicy };
        }
        
        if (monitoringConfig) {
          updatePayload.monitoring = { ...configurationManager.getMonitoringConfig(), ...monitoringConfig };
        }
        
        if (analyticsConfig) {
          updatePayload.analytics = { ...configurationManager.getAnalyticsConfig(), ...analyticsConfig };
        }
        
        if (configuration) {
          Object.assign(updatePayload, configuration);
        }

        result.configuration = await configurationManager.saveConfiguration(updatePayload);
        break;

      default:
        throw new McpError(
          ErrorCode.InvalidParams,
          `Unknown configuration section: ${configSection}`
        );
    }

    timer.checkpoint('configuration_updated');

    const response = {
      success: true,
      message: `Configuration section '${configSection}' updated successfully`,
      data: result,
      performance: {
        duration: timer.getElapsed(),
        checkpoints: timer.getAllCheckpointDurations()
      },
      timestamp: new Date().toISOString()
    };

    structuredLogger.logPerformanceMetric({
      timestamp: new Date(),
      metricName: 'update_configuration_duration',
      metricValue: timer.getElapsed(),
      metricType: 'timer',
      unit: 'ms',
      tags: {
        config_section: configSection,
        success: 'true'
      }
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    
    structuredLogger.logError(error as Error, {
      timestamp: new Date(),
      errorType: 'SystemError',
      component: 'UpdateConfigurationTool',
      operation: 'update_configuration'
    });

    structuredLogger.logPerformanceMetric({
      timestamp: new Date(),
      metricName: 'update_configuration_duration',
      metricValue: timer.getElapsed(),
      metricType: 'timer',
      unit: 'ms',
      tags: {
        success: 'false'
      }
    });

    if (error instanceof McpError) {
      throw error;
    }

    throw new McpError(ErrorCode.InternalError, `Failed to update configuration: ${errorMessage}`);
  }
}