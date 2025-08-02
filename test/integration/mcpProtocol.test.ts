import { McpClient } from '@modelcontextprotocol/sdk/client';
import { createServer, Server as HttpServer } from 'http';
import { AddressInfo } from 'net';
import { db } from '../../src/database';
import { sessionManagerService } from '../../src/services/sessionManager';
import { contextManagerService } from '../../src/services/contextManager';
import { config } from '../../src/config';

// Import the server initialization function
let serverInstance: any;

try {
  // @ts-ignore - We're importing the server instance directly
  const serverModule = await import('../../src/server');
  serverInstance = serverModule.default || serverInstance;
} catch (error) {
  console.error('Failed to import server module:', error);
  throw error;
}

// Test configuration
const TEST_PORT = 0; // Let OS assign random port
const TEST_HOST = '127.0.0.1';

// Test data
const TEST_SESSION = {
  agentId: 'test-agent',
  metadata: { test: true },
  expiresIn: 3600, // 1 hour
};

describe('MCP Protocol Integration Tests', () => {
  let server: HttpServer;
  let client: McpClient;
  let serverUrl: string;
  let testSessionKey: string;

  beforeAll(async () => {
    // Initialize test database
    await db.migrate.latest();
    
    // Create HTTP server
    server = createServer((req, res) => {
      // Handle HTTP requests here if needed
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'ok' }));
    });
    
    // Start the MCP server if available
    if (serverInstance) {
      serverInstance.start();
    }
    
    // Start server
    await new Promise<void>((resolve) => {
      server.listen(TEST_PORT, TEST_HOST, resolve);
    });
    
    const address = server.address() as AddressInfo;
    serverUrl = `http://${TEST_HOST}:${address.port}`;
    
    // Initialize MCP client
    client = new McpClient({
      serverUrl,
      clientInfo: {
        name: 'mcp-integration-test',
        version: '1.0.0',
      },
    });
  });

  afterAll(async () => {
    // Cleanup
    await new Promise<void>((resolve) => server.close(resolve));
    await db.destroy();
  });

  describe('Session Management', () => {
    it('should register a new session', async () => {
      const response = await client.callTool('register_session', {
        agentId: TEST_SESSION.agentId,
        metadata: TEST_SESSION.metadata,
        expiresIn: TEST_SESSION.expiresIn,
      });

      expect(response).toHaveProperty('sessionKey');
      expect(response).toHaveProperty('expiresAt');
      
      testSessionKey = response.sessionKey;
      expect(testSessionKey).toMatch(/^[a-f0-9-]+$/);
    });

    it('should retrieve session details', async () => {
      const response = await client.callTool('get_session', {
        sessionKey: testSessionKey,
      });

      expect(response).toMatchObject({
        sessionKey: testSessionKey,
        agentId: TEST_SESSION.agentId,
        metadata: TEST_SESSION.metadata,
        status: 'active',
      });
    });
  });

  describe('Context Management', () => {
    it('should add context to a session', async () => {
      const context = {
        type: 'message',
        content: 'Test message',
        role: 'user',
        timestamp: new Date().toISOString(),
      };

      const response = await client.callTool('update_context', {
        sessionKey: testSessionKey,
        context,
      });

      expect(response).toHaveProperty('contextId');
      expect(response).toHaveProperty('sequenceNumber');
      expect(response.sequenceNumber).toBe(1);
    });

    it('should retrieve session context', async () => {
      const response = await client.callTool('get_context', {
        sessionKey: testSessionKey,
      });

      expect(Array.isArray(response.context)).toBe(true);
      expect(response.context.length).toBe(1);
      expect(response.context[0]).toMatchObject({
        type: 'message',
        content: 'Test message',
        role: 'user',
      });
    });
  });

  describe('Handoff Workflow', () => {
    it('should initiate a handoff', async () => {
      const response = await client.callTool('request_handoff', {
        sessionKey: testSessionKey,
        targetAgent: 'target-agent',
        handoffType: 'context_transfer',
        metadata: { priority: 'high' },
      });

      expect(response).toHaveProperty('handoffId');
      expect(response).toHaveProperty('status', 'pending');
      expect(response).toHaveProperty('contextSummary');
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid session key', async () => {
      await expect(
        client.callTool('get_session', {
          sessionKey: 'invalid-session-key',
        })
      ).rejects.toThrow('Session not found');
    });

    it('should handle invalid tool calls', async () => {
      await expect(
        client.callTool('nonexistent_tool', {})
      ).rejects.toThrow('Tool not found');
    });
  });
});
