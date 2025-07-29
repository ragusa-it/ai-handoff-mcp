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