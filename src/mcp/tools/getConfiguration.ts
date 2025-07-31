import {
  CallToolRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { configurationManager } from '../../services/configurationManager.js';
import { structuredLogger } from '../../services/structuredLogger.js';
import { PerformanceTimer } from '../utils/performance.js';

// Input validation schema
const GetConfigurationSchema = z.object({
  configSection: z.enum(['retention', 'monitoring', 'analytics', 'all', 'backups']).default('all'),
  includeMetadata: z.boolean().default(true),
  format: z.enum(['json', 'yaml']).default('json'),
});

/**
 * Get Configuration Tool
 * Retrieves current system configuration including retention policies, monitoring settings, and analytics configuration
 */
export async function getConfigurationTool(request: z.infer<typeof CallToolRequestSchema>) {
  const timer = new PerformanceTimer();
  
  try {
    // Validate input
    const validationResult = GetConfigurationSchema.safeParse(request.params);
    if (!validationResult.success) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid configuration query parameters: ${validationResult.error.message}`
      );
    }

    const { configSection, includeMetadata, format } = validationResult.data;

    structuredLogger.logToolCall({
      timestamp: new Date(),
      toolName: 'get_configuration',
      executionTimeMs: 0,
      success: true,
      inputParameters: {
        configSection,
        includeMetadata,
        format
      }
    });

    let result: any = {};

    // Get specific configuration sections
    switch (configSection) {
      case 'retention':
        result = {
          retentionPolicy: configurationManager.getRetentionPolicy()
        };
        break;

      case 'monitoring':
        result = {
          monitoringConfig: configurationManager.getMonitoringConfig()
        };
        break;

      case 'analytics':
        result = {
          analyticsConfig: configurationManager.getAnalyticsConfig()
        };
        break;

      case 'backups':
        result = {
          availableBackups: await configurationManager.listBackups()
        };
        break;

      case 'all':
      default:
        result = {
          configuration: configurationManager.getCurrentConfiguration(),
          availableBackups: await configurationManager.listBackups()
        };
        break;
    }

    timer.checkpoint('configuration_retrieved');

    // Add metadata if requested
    if (includeMetadata) {
      const currentConfig = configurationManager.getCurrentConfiguration();
      result._metadata = {
        version: currentConfig.version,
        lastUpdated: currentConfig.lastUpdated,
        updatedBy: currentConfig.updatedBy,
        retrievedAt: new Date(),
        configSection,
        format
      };
    }

    // Format response based on requested format  
    let responseText: string;
    if (format === 'yaml') {
      // Simple YAML-like formatting for readability
      responseText = convertToYamlLike(result);
    } else {
      responseText = JSON.stringify(result, null, 2);
    }

    const response = {
      success: true,
      message: `Configuration section '${configSection}' retrieved successfully`,
      data: result,
      format,
      performance: {
        duration: timer.getElapsed(),
        checkpoints: timer.getAllCheckpointDurations()
      }
    };

    structuredLogger.logPerformanceMetric({
      timestamp: new Date(),
      metricName: 'get_configuration_duration',
      metricValue: timer.getElapsed(),
      metricType: 'timer',
      unit: 'ms',
      tags: {
        config_section: configSection,
        format,
        success: 'true'
      }
    });

    return {
      content: [
        {
          type: 'text',
          text: format === 'yaml' ? responseText : JSON.stringify(response, null, 2),
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    
    structuredLogger.logError(error as Error, {
      timestamp: new Date(),
      errorType: 'SystemError',
      component: 'GetConfigurationTool',
      operation: 'get_configuration'
    });

    structuredLogger.logPerformanceMetric({
      timestamp: new Date(),
      metricName: 'get_configuration_duration',
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

    throw new McpError(ErrorCode.InternalError, `Failed to retrieve configuration: ${errorMessage}`);
  }
}

/**
 * Convert JSON object to YAML-like format for better readability
 */
function convertToYamlLike(obj: any, indent = 0): string {
  const spaces = '  '.repeat(indent);
  let result = '';

  if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        result += `${spaces}${key}:\n${convertToYamlLike(value, indent + 1)}`;
      } else if (Array.isArray(value)) {
        result += `${spaces}${key}:\n`;
        for (const item of value) {
          result += `${spaces}  - ${typeof item === 'object' ? JSON.stringify(item) : item}\n`;
        }
      } else {
        const valueStr = typeof value === 'string' ? `"${value}"` : String(value);
        result += `${spaces}${key}: ${valueStr}\n`;
      }
    }
  } else if (Array.isArray(obj)) {
    for (const item of obj) {
      result += `${spaces}- ${typeof item === 'object' ? JSON.stringify(item) : item}\n`;
    }
  } else {
    result = String(obj);
  }

  return result;
}