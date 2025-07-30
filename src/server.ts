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
import { contextManagerService } from './services/contextManager.js';
import { codebaseAnalyzerService } from './services/codebaseAnalyzer.js';
import { backgroundJobScheduler } from './services/backgroundJobScheduler.js';
import { monitoringService } from './services/monitoringService.js';
import { 
  analyticsService,
  SessionStatistics,
  HandoffAnalytics,
  PerformanceTrends,
  TrendAnalysisResult,
  SessionAnomalyDetectionResult,
  ResourceUtilization
} from './services/analyticsService.js';

// Union type for all possible analytics data types
type AnalyticsData = 
  | SessionStatistics 
  | HandoffAnalytics 
  | PerformanceTrends 
  | TrendAnalysisResult 
  | SessionAnomalyDetectionResult 
  | ResourceUtilization;

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
            description: 'List of active handoff sessions with enhanced lifecycle status and health information',
            mimeType: 'application/json'
          },
          {
            uri: 'handoff://context/{sessionKey}',
            name: 'Session Context',
            description: 'Complete context history for a session with performance metrics and analytics',
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
          // New Task 6.1 resources: health and metrics MCP resources
          {
            uri: 'handoff://health',
            name: 'System Health',
            description: 'Current system health status including database, Redis, and overall system health',
            mimeType: 'application/json'
          },
          {
            uri: 'handoff://metrics',
            name: 'System Metrics',
            description: 'Prometheus-compatible metrics for sessions, handoffs, and system performance',
            mimeType: 'text/plain'
          },
          {
            uri: 'handoff://analytics/{type}',
            name: 'Analytics Insights',
            description: 'Analytics insights for sessions, handoffs, performance, or trends',
            mimeType: 'application/json'
          },
          {
            uri: 'handoff://session-lifecycle',
            name: 'Session Lifecycle',
            description: 'Monitoring information for session states and lifecycle events',
            mimeType: 'application/json'
          }
        ]
      };
    });

    // Handle resource reads
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;

      // Enhanced sessions resource (Task 6.2)
      if (uri === 'handoff://sessions') {
        try {
          // Get sessions with enhanced lifecycle status and health information
          const query = `
            SELECT 
              s.session_key,
              s.agent_name,
              s.status,
              s.created_at,
              s.updated_at,
              s.expires_at,
              COUNT(ch.id) as context_entries,
              AVG(CASE WHEN ch.created_at > NOW() - INTERVAL '1 hour' THEN 1 ELSE 0 END) as recent_activity,
              MAX(ch.created_at) as last_activity
            FROM sessions s
            LEFT JOIN context_history ch ON s.session_key = ch.session_key
            WHERE s.status IN ('active', 'dormant')
            GROUP BY s.session_key, s.agent_name, s.status, s.created_at, s.updated_at, s.expires_at
            ORDER BY s.updated_at DESC
            LIMIT 50
          `;
          
          const result = await db.query(query);
          const sessionData = {
            total_sessions: result.rows.length,
            sessions: result.rows.map(row => ({
              session_key: row.session_key,
              agent_name: row.agent_name,
              status: row.status,
              created_at: row.created_at,
              updated_at: row.updated_at,
              expires_at: row.expires_at,
              context_entries: parseInt(row.context_entries),
              recent_activity: parseFloat(row.recent_activity),
              last_activity: row.last_activity,
              health_status: row.status === 'active' ? 'healthy' : 'dormant'
            })),
            timestamp: new Date().toISOString()
          };

          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(sessionData, null, 2)
              }
            ]
          };
        } catch (error) {
          throw new McpError(
            ErrorCode.InternalError,
            `Failed to fetch sessions: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }

      // Enhanced context resource (Task 6.2)
      if (uri.startsWith('handoff://context/')) {
        const sessionKey = uri.replace('handoff://context/', '');
        try {
          const context = await contextManagerService.getFullContext(sessionKey);
          
          // Add performance metrics and analytics
          const query = `
            SELECT 
              COUNT(*) as total_entries,
              AVG(LENGTH(content)) as avg_content_size,
              MAX(LENGTH(content)) as max_content_size,
              COUNT(DISTINCT content_type) as content_types,
              MIN(created_at) as first_entry,
              MAX(created_at) as last_entry
            FROM context_history 
            WHERE session_key = $1
          `;
          
          const metricsResult = await db.query(query, [sessionKey]);
          const metrics = metricsResult.rows[0];
          
          const enhancedContext = {
            ...context,
            performance_metrics: {
              total_entries: parseInt(metrics.total_entries),
              avg_content_size: Math.round(parseFloat(metrics.avg_content_size) || 0),
              max_content_size: parseInt(metrics.max_content_size) || 0,
              content_types: parseInt(metrics.content_types),
              first_entry: metrics.first_entry,
              last_entry: metrics.last_entry,
              session_duration: metrics.first_entry && metrics.last_entry 
                ? Math.round((new Date(metrics.last_entry).getTime() - new Date(metrics.first_entry).getTime()) / 1000)
                : 0
            },
            timestamp: new Date().toISOString()
          };
          
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(enhancedContext, null, 2)
              }
            ]
          };
        } catch (error) {
          throw new McpError(
            ErrorCode.InternalError,
            `Failed to fetch context for session ${sessionKey}: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
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

      // New Task 6.1 resources: health and metrics MCP resources

      // Health check resource
      if (uri === 'handoff://health') {
        try {
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
        } catch (error) {
          throw new McpError(
            ErrorCode.InternalError,
            `Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }

      // Metrics resource for Prometheus export
      if (uri === 'handoff://metrics') {
        try {
          const metrics = await monitoringService.getPrometheusMetrics();
          
          return {
            contents: [
              {
                uri,
                mimeType: 'text/plain',
                text: metrics
              }
            ]
          };
        } catch (error) {
          throw new McpError(
            ErrorCode.InternalError,
            `Failed to generate metrics: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }

      // Analytics insights resource
      if (uri.startsWith('handoff://analytics/')) {
        const analyticsType = uri.replace('handoff://analytics/', '');
        
        try {
          const timeRange = {
            start: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
            end: new Date()
          };
          
          let analyticsData: AnalyticsData;
          
          switch (analyticsType) {
            case 'sessions':
              analyticsData = await analyticsService.getSessionStatistics({ timeRange });
              break;
            case 'handoffs':
              analyticsData = await analyticsService.getHandoffAnalytics({ timeRange });
              break;
            case 'performance':
              analyticsData = await analyticsService.getPerformanceTrends({ timeRange });
              break;
            case 'trends':
              analyticsData = await analyticsService.analyzeTrends({ timeRange });
              break;
            case 'anomalies':
              analyticsData = await analyticsService.detectSessionAnomalies({ timeRange, includeAnomalies: true });
              break;
            case 'resources':
              analyticsData = await analyticsService.getResourceUtilization({ timeRange });
              break;
            default:
              throw new McpError(
                ErrorCode.InvalidRequest,
                `Unknown analytics type: ${analyticsType}. Available types: sessions, handoffs, performance, trends, anomalies, resources`
              );
          }
          
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify({
                  type: analyticsType,
                  data: analyticsData,
                  timestamp: new Date().toISOString(),
                  timeRange
                }, null, 2)
              }
            ]
          };
        } catch (error) {
          throw new McpError(
            ErrorCode.InternalError,
            `Failed to generate analytics for ${analyticsType}: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }

      // Session lifecycle monitoring resource
      if (uri === 'handoff://session-lifecycle') {
        try {
          const query = `
            SELECT 
              event_type,
              COUNT(*) as event_count,
              DATE_TRUNC('hour', timestamp) as hour_bucket
            FROM session_lifecycle
            WHERE timestamp > NOW() - INTERVAL '24 hours'
            GROUP BY event_type, DATE_TRUNC('hour', timestamp)
            ORDER BY hour_bucket DESC, event_type
          `;
          
          const result = await db.query(query);
          
          const lifecycleData = {
            summary: {
              total_events: result.rows.reduce((sum, row) => sum + parseInt(row.event_count), 0),
              event_types: [...new Set(result.rows.map(row => row.event_type))],
              timeframe: 'last 24 hours'
            },
            events: result.rows.map(row => ({
              event_type: row.event_type,
              count: parseInt(row.event_count),
              hour: row.hour_bucket
            })),
            timestamp: new Date().toISOString()
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
        } catch (error) {
          throw new McpError(
            ErrorCode.InternalError,
            `Failed to fetch session lifecycle data: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }

      throw new McpError(
        ErrorCode.InvalidRequest,
        `Unknown resource: ${uri}`
      );
    });
  }

  async start() {
    // Initialize database
    await db.initialize();
    
    // Start background job scheduler
    await backgroundJobScheduler.startAllJobs();
    
    // Create transport and connect
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    
    console.log('✅ AI Handoff MCP Server started successfully');
    console.log(`📡 Server: ${mcpConfig.name} v${mcpConfig.version}`);
    console.log(`🔧 Environment: ${config.NODE_ENV}`);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('🛑 Shutting down server...');
  await backgroundJobScheduler.stopAllJobs();
  await db.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('🛑 Shutting down server...');
  await backgroundJobScheduler.stopAllJobs();
  await db.close();
  process.exit(0);
});

// Start the server
const server = new AIHandoffMCPServer();
server.start().catch((error) => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});