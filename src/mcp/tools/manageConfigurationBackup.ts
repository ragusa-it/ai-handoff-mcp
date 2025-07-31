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
const ManageConfigurationBackupSchema = z.object({
  operation: z.enum(['create', 'restore', 'list', 'delete']),
  backupId: z.string().optional(),
  description: z.string().optional(),
});

/**
 * Manage Configuration Backup Tool
 * Creates, restores, lists, or deletes configuration backups
 */
export async function manageConfigurationBackupTool(request: z.infer<typeof CallToolRequestSchema>) {
  const timer = new PerformanceTimer();
  
  try {
    // Validate input
    const validationResult = ManageConfigurationBackupSchema.safeParse(request.params);
    if (!validationResult.success) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid backup management parameters: ${validationResult.error.message}`
      );
    }

    const { operation, backupId, description } = validationResult.data;

    // Validate required parameters for specific operations
    if ((operation === 'restore' || operation === 'delete') && !backupId) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `backupId is required for ${operation} operation`
      );
    }

    structuredLogger.logToolCall({
      timestamp: new Date(),
      toolName: 'manage_configuration_backup',
      executionTimeMs: 0,
      success: true,
      inputParameters: {
        operation,
        backupId,
        description
      }
    });

    let result: any = {};

    // Execute the requested operation
    switch (operation) {
      case 'create':
        timer.checkpoint('backup_create_start');
        const newBackupId = await configurationManager.createBackup();
        timer.checkpoint('backup_create_complete');
        
        result = {
          operation: 'create',
          backupId: newBackupId,
          description: description || `Backup created at ${new Date().toISOString()}`,
          timestamp: new Date(),
          message: 'Configuration backup created successfully'
        };
        break;

      case 'restore':
        timer.checkpoint('backup_restore_start');
        const restoredConfig = await configurationManager.restoreFromBackup(backupId!);
        timer.checkpoint('backup_restore_complete');
        
        result = {
          operation: 'restore',
          backupId: backupId!,
          restoredVersion: restoredConfig.version,
          restoredTimestamp: restoredConfig.lastUpdated,
          timestamp: new Date(),
          message: `Configuration restored from backup ${backupId}`
        };
        break;

      case 'list':
        timer.checkpoint('backup_list_start');
        const backups = await configurationManager.listBackups();
        timer.checkpoint('backup_list_complete');
        
        result = {
          operation: 'list',
          backups: backups.map(backup => ({
            id: backup.id,
            timestamp: backup.timestamp,
            version: backup.version,
            age: formatTimeDifference(new Date(), backup.timestamp)
          })),
          totalBackups: backups.length,
          timestamp: new Date(),
          message: `Found ${backups.length} configuration backups`
        };
        break;

      case 'delete':
        // Note: Actual deletion would require implementing delete functionality in configurationManager
        throw new McpError(
          ErrorCode.InvalidParams,
          'Delete operation is not yet implemented for security reasons. Backups are automatically cleaned up based on retention policies.'
        );

      default:
        throw new McpError(
          ErrorCode.InvalidParams,
          `Unknown backup operation: ${operation}`
        );
    }

    timer.checkpoint('operation_complete');

    const response = {
      success: true,
      data: result,
      performance: {
        duration: timer.getElapsed(),
        checkpoints: timer.getAllCheckpointDurations()
      },
      timestamp: new Date().toISOString()
    };

    structuredLogger.logPerformanceMetric({
      timestamp: new Date(),
      metricName: 'manage_configuration_backup_duration',
      metricValue: timer.getElapsed(),
      metricType: 'timer',
      unit: 'ms',
      tags: {
        operation,
        success: 'true'
      }
    });

    // Log successful backup operations for audit trail
    structuredLogger.logSystemEvent({
      timestamp: new Date(),
      component: 'ConfigurationBackupTool',
      operation: `backup_${operation}`,
      status: 'completed',
      metadata: {
        operation,
        backupId: backupId || result.backupId,
        description
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
      component: 'ManageConfigurationBackupTool',
      operation: 'manage_configuration_backup'
    });

    structuredLogger.logPerformanceMetric({
      timestamp: new Date(),
      metricName: 'manage_configuration_backup_duration',
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

    throw new McpError(ErrorCode.InternalError, `Failed to manage configuration backup: ${errorMessage}`);
  }
}

/**
 * Format time difference for human-readable display
 */
function formatTimeDifference(now: Date, past: Date): string {
  const diffMs = now.getTime() - past.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  } else if (diffHours > 0) {
    return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  } else if (diffMinutes > 0) {
    return `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`;
  } else {
    return 'Just now';
  }
}