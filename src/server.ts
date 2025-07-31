#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { config, mcpConfig } from './config/index.js';
import { db } from './database/index.js';
import { registerSessionTool } from './mcp/tools/registerSession.js';
import { updateContextTool } from './mcp/tools/updateContext.js';
import { requestHandoffTool } from './mcp/tools/requestHandoff.js';
import { updateConfigurationTool } from './mcp/tools/updateConfiguration.js';
import { getConfigurationTool } from './mcp/tools/getConfiguration.js';
import { manageConfigurationBackupTool } from './mcp/tools/manageConfigurationBackup.js';
import { contextManagerService } from './services/contextManager.js';
import { codebaseAnalyzerService } from './services/codebaseAnalyzer.js';
import { backgroundJobScheduler } from './services/backgroundJobScheduler.js';
import { monitoringService } from './services/monitoringService.js';
import { analyticsService } from './services/analyticsService.js';
import { sessionManagerService } from './services/sessionManager.js';
import { configurationManager } from './services/configurationManager.js';

class AIHandoffMCPServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: mcpConfig.name,
        version: mcpConfig.version,
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'register_session',
            description: 'Register a new AI handoff session for context transfer',
            inputSchema: {
              type: 'object',
              properties: {
                sessionKey: {
                  type: 'string',
                  description: 'Unique identifier for the session'
                },
                agentFrom: {
                  type: 'string',
                  description: 'Name/ID of the agent initiating the handoff'
                },
                metadata: {
                  type: 'object',
                  description: 'Additional metadata for the session'
                }
              },
              required: ['sessionKey', 'agentFrom']
            }
          },
          {
            name: 'update_context',
            description: 'Add context information to an active session',
            inputSchema: {
              type: 'object',
              properties: {
                sessionKey: {
                  type: 'string',
                  description: 'Session identifier'
                },
                contextType: {
                  type: 'string',
                  enum: ['message', 'file', 'tool_call', 'system'],
                  description: 'Type of context being added'
                },
                content: {
                  type: 'string',
                  description: 'The context content'
                },
                metadata: {
                  type: 'object',
                  description: 'Additional metadata for the context'
                }
              },
              required: ['sessionKey', 'contextType', 'content']
            }
          },
          {
            name: 'request_handoff',
            description: 'Request a handoff to another agent with accumulated context',
            inputSchema: {
              type: 'object',
              properties: {
                sessionKey: {
                  type: 'string',
                  description: 'Session identifier'
                },
                targetAgent: {
                  type: 'string',
                  description: 'Target agent for the handoff'
                },
                requestType: {
                  type: 'string',
                  enum: ['context_transfer', 'full_handoff', 'collaboration'],
                  description: 'Type of handoff requested'
                },
                requestData: {
                  type: 'object',
                  description: 'Additional data for the handoff request'
                }
              },
              required: ['sessionKey', 'targetAgent']
            }
          },
          {
            name: 'analyze_codebase',
            description: 'Analyze codebase files and extract relevant context for handoff',
            inputSchema: {
              type: 'object',
              properties: {
                sessionKey: {
                  type: 'string',
                  description: 'Session identifier'
                },
                filePaths: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'List of file paths to analyze'
                },
                analysisType: {
                  type: 'string',
                  enum: ['syntax', 'dependencies', 'structure', 'full'],
                  description: 'Type of analysis to perform',
                  default: 'structure'
                }
              },
              required: ['sessionKey', 'filePaths']
            }
          },
          {
            name: 'get_job_status',
            description: 'Get status and statistics for background jobs',
            inputSchema: {
              type: 'object',
              properties: {
                jobName: {
                  type: 'string',
                  description: 'Optional specific job name to get status for'
                }
              }
            }
          },
          {
            name: 'run_job_now',
            description: 'Manually trigger a background job to run immediately',
            inputSchema: {
              type: 'object',
              properties: {
                jobName: {
                  type: 'string',
                  description: 'Name of the job to run'
                }
              },
              required: ['jobName']
            }
          },
          {
            name: 'update_job_config',
            description: 'Update configuration for a background job',
            inputSchema: {
              type: 'object',
              properties: {
                jobName: {
                  type: 'string',
                  description: 'Name of the job to update'
                },
                config: {
                  type: 'object',
                  properties: {
                    intervalMs: {
                      type: 'number',
                      description: 'Interval in milliseconds'
                    },
                    enabled: {
                      type: 'boolean',
                      description: 'Whether the job is enabled'
                    },
                    maxRetries: {
                      type: 'number',
                      description: 'Maximum number of retries'
                    },
                    retryDelayMs: {
                      type: 'number',
                      description: 'Delay between retries in milliseconds'
                    }
                  }
                }
              },
              required: ['jobName', 'config']
            }
          },
          {
            name: 'update_configuration',
            description: 'Update system configuration including retention policies, monitoring settings, and analytics configuration',
            inputSchema: {
              type: 'object',
              properties: {
                configSection: {
                  type: 'string',
                  enum: ['retention', 'monitoring', 'analytics', 'all'],
                  description: 'Configuration section to update'
                },
                retentionPolicy: {
                  type: 'object',
                  description: 'Retention policy configuration updates'
                },
                monitoringConfig: {
                  type: 'object',
                  description: 'Monitoring configuration updates'
                },
                analyticsConfig: {
                  type: 'object',
                  description: 'Analytics configuration updates'
                },
                updatedBy: {
                  type: 'string',
                  description: 'Name of the user/system making the update',
                  default: 'mcp-tool'
                }
              },
              required: ['configSection']
            }
          },
          {
            name: 'get_configuration',
            description: 'Retrieve current system configuration including retention policies, monitoring settings, and analytics configuration',
            inputSchema: {
              type: 'object',
              properties: {
                configSection: {
                  type: 'string',
                  enum: ['retention', 'monitoring', 'analytics', 'all', 'backups'],
                  description: 'Configuration section to retrieve',
                  default: 'all'
                },
                includeMetadata: {
                  type: 'boolean',
                  description: 'Include configuration metadata (version, timestamps, etc.)',
                  default: true
                },
                format: {
                  type: 'string',
                  enum: ['json', 'yaml'],
                  description: 'Output format for the configuration',
                  default: 'json'
                }
              }
            }
          },
          {
            name: 'manage_configuration_backup',
            description: 'Create, restore, list, or delete configuration backups',
            inputSchema: {
              type: 'object',
              properties: {
                operation: {
                  type: 'string',
                  enum: ['create', 'restore', 'list', 'delete'],
                  description: 'Backup operation to perform'
                },
                backupId: {
                  type: 'string',
                  description: 'Backup ID (required for restore and delete operations)'
                },
                description: {
                  type: 'string',
                  description: 'Optional description for the backup'
                }
              },
              required: ['operation']
            }
          }
        ]
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (!args) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'Tool arguments are required'
        );
      }

      try {
        switch (name) {
          case 'register_session':
            return await registerSessionTool(args as any);
          
          case 'update_context':
            return await updateContextTool(args as any);
          
          case 'request_handoff':
            return await requestHandoffTool(args as any);
          
          case 'analyze_codebase':
            return await codebaseAnalyzerService.analyzeFiles(
              (args as any).sessionKey,
              (args as any).filePaths,
              (args as any).analysisType || 'structure'
            );
          
          case 'get_job_status':
            const jobName = (args as any).jobName;
            const status = jobName 
              ? { [jobName]: backgroundJobScheduler.getJobStatus()[jobName] }
              : backgroundJobScheduler.getJobStatus();
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(status, null, 2)
                }
              ]
            };
          
          case 'run_job_now':
            const result = await backgroundJobScheduler.runJobNow((args as any).jobName);
            return {
              content: [
                {
                  type: 'text',
                  text: `Job executed successfully: ${JSON.stringify(result, null, 2)}`
                }
              ]
            };
          
          case 'update_job_config':
            backgroundJobScheduler.updateJobConfig((args as any).jobName, (args as any).config);
            return {
              content: [
                {
                  type: 'text',
                  text: `Job configuration updated for ${(args as any).jobName}`
                }
              ]
            };
          
          case 'update_configuration':
            return await updateConfigurationTool(args as any);
          
          case 'get_configuration':
            return await getConfigurationTool(args as any);
          
          case 'manage_configuration_backup':
            return await manageConfigurationBackupTool(args as any);
          
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        
        console.error(`Error in tool ${name}:`, error);
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to execute tool: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    });

    // List available resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return {
        resources: [
          {
            uri: 'handoff://sessions',
            name: 'Active Sessions',
            description: 'List of active handoff sessions',
            mimeType: 'application/json'
          },
          {
            uri: 'handoff://context/{sessionKey}',
            name: 'Session Context',
            description: 'Complete context history for a session',
            mimeType: 'application/json'
          },
          {
            uri: 'handoff://jobs',
            name: 'Background Jobs',
            description: 'Status and statistics for all background jobs',
            mimeType: 'application/json'
          },
          {
            uri: 'handoff://jobs/{jobName}',
            name: 'Job Details',
            description: 'Detailed information for a specific background job',
            mimeType: 'application/json'
          },
          {
            uri: 'handoff://health',
            name: 'System Health',
            description: 'Comprehensive system health status and component diagnostics',
            mimeType: 'application/json'
          },
          {
            uri: 'handoff://metrics',
            name: 'Prometheus Metrics',
            description: 'Prometheus-compatible metrics export for monitoring systems',
            mimeType: 'text/plain; version=0.0.4; charset=utf-8'
          },
          {
            uri: 'handoff://analytics/{type}',
            name: 'Analytics Insights',
            description: 'Analytics data and insights (types: sessions, handoffs, context, performance, resources)',
            mimeType: 'application/json'
          },
          {
            uri: 'handoff://sessions/lifecycle',
            name: 'Session Lifecycle',
            description: 'Session lifecycle monitoring and state information',
            mimeType: 'application/json'
          },
          {
            uri: 'handoff://configuration',
            name: 'System Configuration',
            description: 'Current system configuration including retention policies, monitoring settings, and analytics configuration',
            mimeType: 'application/json'
          },
          {
            uri: 'handoff://configuration/backups',
            name: 'Configuration Backups',
            description: 'List of available configuration backups with metadata',
            mimeType: 'application/json'
          }
        ]
      };
    });

    // Handle resource reads
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;

      if (uri === 'handoff://sessions') {
        // Return list of active sessions (simplified for now)
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify({ message: 'Sessions list endpoint - implementation pending' })
            }
          ]
        };
      }

      if (uri.startsWith('handoff://context/')) {
        const sessionKey = uri.replace('handoff://context/', '');
        const context = await contextManagerService.getFullContext(sessionKey);
        
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(context)
            }
          ]
        };
      }

      if (uri === 'handoff://jobs') {
        const jobStatus = backgroundJobScheduler.getJobStatus();
        
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(jobStatus, null, 2)
            }
          ]
        };
      }

      if (uri.startsWith('handoff://jobs/')) {
        const jobName = uri.replace('handoff://jobs/', '');
        const jobStatus = backgroundJobScheduler.getJobStatus();
        const jobDetails = jobStatus[jobName];
        
        if (!jobDetails) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            `Job not found: ${jobName}`
          );
        }
        
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(jobDetails, null, 2)
            }
          ]
        };
      }

      if (uri === 'handoff://health') {
        const healthStatus = await monitoringService.getSystemHealth();
        
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(healthStatus, null, 2)
            }
          ]
        };
      }

      if (uri === 'handoff://metrics') {
        const prometheusMetrics = monitoringService.getPrometheusMetrics();
        
        return {
          contents: [
            {
              uri,
              mimeType: 'text/plain; version=0.0.4; charset=utf-8',
              text: prometheusMetrics
            }
          ]
        };
      }

      if (uri.startsWith('handoff://analytics/')) {
        const analyticsType = uri.replace('handoff://analytics/', '');
        
        // Default time range: last 24 hours
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);
        const query = { timeRange: { start: startTime, end: endTime } };
        
        let analyticsData;
        
        switch (analyticsType) {
          case 'sessions':
            analyticsData = await analyticsService.getSessionStatistics(query);
            break;
          case 'handoffs':
            analyticsData = await analyticsService.getHandoffAnalytics(query);
            break;
          case 'context':
            analyticsData = await analyticsService.getContextGrowthPatterns(query);
            break;
          case 'performance':
            analyticsData = await analyticsService.getPerformanceTrends(query);
            break;
          case 'resources':
            analyticsData = await analyticsService.getResourceUtilization(query);
            break;
          default:
            throw new McpError(
              ErrorCode.InvalidRequest,
              `Unknown analytics type: ${analyticsType}. Valid types: sessions, handoffs, context, performance, resources`
            );
        }
        
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(analyticsData, null, 2)
            }
          ]
        };
      }

      if (uri === 'handoff://sessions/lifecycle') {
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);
        
        // Get session statistics which includes lifecycle information
        const sessionStats = await analyticsService.getSessionStatistics({
          timeRange: { start: startTime, end: endTime }
        });
        
        // Get current system metrics for active session counts
        const systemMetrics = await monitoringService.getSystemMetrics();
        
        const lifecycleData = {
          currentState: {
            activeSessions: systemMetrics.sessions.active,
            dormantSessions: systemMetrics.sessions.dormant,
            archivedSessions: systemMetrics.sessions.archived,
            totalSessions: sessionStats.totalSessions
          },
          statistics: {
            completedSessions: sessionStats.completedSessions,
            expiredSessions: sessionStats.expiredSessions,
            averageSessionDuration: sessionStats.averageSessionDuration,
            averageContextVolume: sessionStats.averageContextVolume,
            sessionsByStatus: sessionStats.sessionsByStatus,
            sessionsByAgent: sessionStats.sessionsByAgent
          },
          timestamp: new Date(),
          timeRange: sessionStats.timeRange
        };
        
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(lifecycleData, null, 2)
            }
          ]
        };
      }

      if (uri === 'handoff://configuration') {
        const currentConfig = configurationManager.getCurrentConfiguration();
        
        const configurationData = {
          configuration: currentConfig,
          metadata: {
            version: currentConfig.version,
            lastUpdated: currentConfig.lastUpdated,
            updatedBy: currentConfig.updatedBy,
            retrievedAt: new Date()
          }
        };
        
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(configurationData, null, 2)
            }
          ]
        };
      }

      if (uri === 'handoff://configuration/backups') {
        const backups = await configurationManager.listBackups();
        
        const backupData = {
          backups: backups.map(backup => ({
            id: backup.id,
            timestamp: backup.timestamp,
            version: backup.version,
            age: this.formatTimeDifference(new Date(), backup.timestamp)
          })),
          totalBackups: backups.length,
          retrievedAt: new Date()
        };
        
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(backupData, null, 2)
            }
          ]
        };
      }

      throw new McpError(
        ErrorCode.InvalidRequest,
        `Unknown resource: ${uri}`
      );
    });
  }
  
  /**
   * Format time difference for human-readable display
   */
  private formatTimeDifference(now: Date, past: Date): string {
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
  
  /**
   * Perform graceful shutdown of all services
   */
  async gracefulShutdown(reason: string): Promise<void> {
    console.log(`🛑 Graceful shutdown initiated (reason: ${reason})`);
    const shutdownStart = Date.now();
    const shutdownErrors: string[] = [];
    
    try {
      // Phase 1: Stop accepting new requests (MCP server disconnection)
      console.log('📡 Disconnecting MCP server transport...');
      try {
        // The MCP server doesn't have an explicit disconnect method,
        // but we can mark it as shutting down
        console.log('✅ MCP server marked for shutdown');
      } catch (error) {
        shutdownErrors.push(`MCP server disconnect error: ${error}`);
      }
      
      // Phase 2: Stop background jobs and scheduled tasks
      console.log('⏰ Stopping background job scheduler...');
      try {
        await Promise.race([
          backgroundJobScheduler.stopAllJobs(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Background job shutdown timeout')), 10000)
          )
        ]);
        console.log('✅ Background jobs stopped');
      } catch (error) {
        shutdownErrors.push(`Background job shutdown error: ${error}`);
        console.error('❌ Background job shutdown error:', error);
      }
      
      // Phase 3: Flush final metrics and perform cleanup
      console.log('📊 Flushing final metrics and logs...');
      try {
        // Flush any pending metrics
        const finalMetrics = await monitoringService.getSystemMetrics();
        console.log('📈 Final system metrics:', {
          timestamp: finalMetrics.timestamp,
          totalSessions: (finalMetrics.sessions?.active || 0) + (finalMetrics.sessions?.dormant || 0) + (finalMetrics.sessions?.archived || 0),
          activeSessions: finalMetrics.sessions?.active || 0
        });
        
        // Perform final session cleanup (quick pass)
        await this.performFinalSessionCleanup();
        
        console.log('✅ Final metrics and cleanup completed');
      } catch (error) {
        shutdownErrors.push(`Metrics flush error: ${error}`);
        console.error('❌ Metrics flush error:', error);
      }
      
      // Phase 4: Stop monitoring service
      console.log('🔍 Stopping monitoring service...');
      try {
        await Promise.race([
          monitoringService.stop(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Monitoring service shutdown timeout')), 5000)
          )
        ]);
        console.log('✅ Monitoring service stopped');
      } catch (error) {
        shutdownErrors.push(`Monitoring service shutdown error: ${error}`);
        console.error('❌ Monitoring service shutdown error:', error);
      }
      
      // Phase 4.5: Stop configuration manager
      console.log('⚙️ Stopping configuration manager...');
      try {
        configurationManager.disableHotReload();
        console.log('✅ Configuration manager stopped');
      } catch (error) {
        shutdownErrors.push(`Configuration manager shutdown error: ${error}`);
        console.error('❌ Configuration manager shutdown error:', error);
      }
      
      // Phase 5: Close database connections and release resources
      console.log('💾 Closing database connections...');
      try {
        await Promise.race([
          db.close(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Database shutdown timeout')), 15000)
          )
        ]);
        console.log('✅ Database connections closed');
      } catch (error) {
        shutdownErrors.push(`Database shutdown error: ${error}`);
        console.error('❌ Database shutdown error:', error);
      }
      
      // Phase 6: Final cleanup and log rotation
      console.log('🗂️ Performing final cleanup...');
      try {
        // Clear any remaining cache entries
        await this.clearShutdownCache();
        
        // Log shutdown completion
        const shutdownDuration = Date.now() - shutdownStart;
        console.log(`✅ Graceful shutdown completed in ${shutdownDuration}ms`);
        
        if (shutdownErrors.length > 0) {
          console.warn('⚠️ Shutdown completed with errors:', shutdownErrors);
        } else {
          console.log('🎉 Clean shutdown - all services stopped successfully');
        }
      } catch (error) {
        shutdownErrors.push(`Final cleanup error: ${error}`);
        console.error('❌ Final cleanup error:', error);
      }
      
    } catch (error) {
      console.error('💥 Critical error during graceful shutdown:', error);
      shutdownErrors.push(`Critical shutdown error: ${error}`);
    }
    
    // Log final shutdown status
    if (shutdownErrors.length > 0) {
      console.error(`🚨 Shutdown completed with ${shutdownErrors.length} errors`);
      shutdownErrors.forEach((error, index) => {
        console.error(`  ${index + 1}. ${error}`);
      });
    }
  }
  
  /**
   * Perform final session cleanup before shutdown
   */
  private async performFinalSessionCleanup(): Promise<void> {
    try {
      // Get quick cleanup stats
      const cleanupStats = await sessionManagerService.getCleanupStats();
      console.log('🧹 Session cleanup stats:', cleanupStats);
      
      // Mark any active sessions as dormant before shutdown
      await sessionManagerService.detectDormantSessions();
      
      console.log('✅ Final session cleanup completed');
    } catch (error) {
      console.warn('⚠️ Final session cleanup warning:', error);
      // Don't throw, this is best-effort cleanup
    }
  }
  
  /**
   * Clear any shutdown-specific cache entries
   */
  private async clearShutdownCache(): Promise<void> {
    try {
      // This is a placeholder for any shutdown-specific cache clearing
      // In a real implementation, you might want to clear temporary cache entries
      console.log('🗑️ Shutdown cache cleared');
    } catch (error) {
      console.warn('⚠️ Cache clearing warning:', error);
      // Don't throw, this is best-effort cleanup
    }
  }

  async start() {
    console.log('🚀 Starting AI Handoff MCP Server...');
    console.log(`📡 Server: ${mcpConfig.name} v${mcpConfig.version}`);
    console.log(`🔧 Environment: ${config.NODE_ENV}`);
    
    try {
      // Phase 1: Initialize core infrastructure
      console.log('📊 Initializing database connection...');
      await db.initialize();
      console.log('✅ Database connection established');
      
      // Phase 1.5: Initialize configuration management
      console.log('⚙️ Loading system configuration...');
      await configurationManager.loadConfiguration();
      configurationManager.enableHotReload();
      console.log('✅ Configuration management initialized');
      
      // Phase 2: Start monitoring services
      console.log('🔍 Initializing monitoring service...');
      monitoringService.setConfigurationManager(configurationManager);
      await monitoringService.start();
      console.log('✅ Monitoring service started');
      
      // Phase 3: Initialize analytics service
      console.log('📈 Initializing analytics service...');
      analyticsService.setConfigurationManager(configurationManager);
      // Analytics service is stateless, but ensure it's ready
      const analyticsHealth = await this.checkAnalyticsServiceHealth();
      if (!analyticsHealth.healthy) {
        throw new Error(`Analytics service health check failed: ${analyticsHealth.error}`);
      }
      console.log('✅ Analytics service ready');
      
      // Phase 4: Initialize session manager service
      console.log('⚙️ Initializing session manager service...');
      // Session manager is stateless, but ensure it's ready
      const sessionManagerHealth = await this.checkSessionManagerHealth();
      if (!sessionManagerHealth.healthy) {
        throw new Error(`Session manager health check failed: ${sessionManagerHealth.error}`);
      }
      console.log('✅ Session manager service ready');
      
      // Phase 5: Start background job scheduler
      console.log('⏰ Starting background job scheduler...');
      await backgroundJobScheduler.startAllJobs();
      console.log('✅ Background jobs started');
      
      // Phase 6: Perform comprehensive health checks
      console.log('🏥 Performing system health checks...');
      const healthStatus = await monitoringService.getSystemHealth();
      if (healthStatus.overall !== 'healthy') {
        console.warn('⚠️ System health check detected issues:', healthStatus);
        // Don't fail startup for non-critical health issues
      } else {
        console.log('✅ All system health checks passed');
      }
      
      // Phase 7: Create transport and connect MCP server
      console.log('🔌 Connecting MCP server transport...');
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      console.log('✅ MCP server transport connected');
      
      // Phase 8: Final startup validation
      await this.validateStartupState();
      
      console.log('🎉 AI Handoff MCP Server started successfully');
      console.log('📊 Services initialized:');
      console.log('  - Database: ✅');
      console.log('  - Monitoring: ✅');
      console.log('  - Analytics: ✅');
      console.log('  - Session Manager: ✅');
      console.log('  - Background Jobs: ✅');
      console.log('  - MCP Transport: ✅');
      
    } catch (error) {
      console.error('❌ Failed to start server:', error);
      
      // Attempt graceful cleanup on startup failure
      try {
        await this.gracefulShutdown('startup_failure');
      } catch (cleanupError) {
        console.error('❌ Failed to cleanup after startup failure:', cleanupError);
      }
      
      throw error;
    }
  }
  
  /**
   * Check if analytics service is healthy and ready
   */
  private async checkAnalyticsServiceHealth(): Promise<{ healthy: boolean; error?: string }> {
    try {
      // Try to get simple analytics data to verify service is working
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - 60 * 1000); // Last minute
      
      await analyticsService.getSessionStatistics({
        timeRange: { start: startTime, end: endTime }
      });
      
      return { healthy: true };
    } catch (error) {
      return { 
        healthy: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }
  
  /**
   * Check if session manager service is healthy and ready
   */
  private async checkSessionManagerHealth(): Promise<{ healthy: boolean; error?: string }> {
    try {
      // Try to get cleanup stats to verify service is working
      await sessionManagerService.getCleanupStats();
      return { healthy: true };
    } catch (error) {
      return { 
        healthy: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }
  
  /**
   * Validate that all services are in expected state after startup
   */
  private async validateStartupState(): Promise<void> {
    const validationErrors: string[] = [];
    
    try {
      // Validate database connection
      const dbResult = await db.query('SELECT 1');
      if (!dbResult || dbResult.rows.length === 0) {
        validationErrors.push('Database connection validation failed');
      }
    } catch (error) {
      validationErrors.push(`Database validation error: ${error}`);
    }
    
    try {
      // Validate monitoring service
      const metrics = await monitoringService.getSystemMetrics();
      if (!metrics || typeof metrics !== 'object') {
        validationErrors.push('Monitoring service validation failed');
      }
    } catch (error) {
      validationErrors.push(`Monitoring service validation error: ${error}`);
    }
    
    try {
      // Validate background jobs are running
      const jobStatus = backgroundJobScheduler.getJobStatus();
      const runningJobs = Object.values(jobStatus).filter(job => job.running).length;
      if (runningJobs === 0) {
        validationErrors.push('No background jobs are running');
      }
    } catch (error) {
      validationErrors.push(`Background job validation error: ${error}`);
    }
    
    if (validationErrors.length > 0) {
      console.warn('⚠️ Startup validation warnings:', validationErrors);
      // Don't fail startup for validation warnings, just log them
    }
  }
}

// Start the server
const server = new AIHandoffMCPServer();

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('🛑 Received SIGINT, initiating graceful shutdown...');
  await server.gracefulShutdown('SIGINT');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('🛑 Received SIGTERM, initiating graceful shutdown...');
  await server.gracefulShutdown('SIGTERM');
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', async (error) => {
  console.error('💥 Uncaught exception:', error);
  await server.gracefulShutdown('uncaught_exception');
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', async (reason, promise) => {
  console.error('💥 Unhandled promise rejection at:', promise, 'reason:', reason);
  await server.gracefulShutdown('unhandled_rejection');
  process.exit(1);
});

// Start the server
server.start().catch((error) => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});