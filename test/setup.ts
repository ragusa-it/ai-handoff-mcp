// Test environment configuration
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/ai_handoff_test';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.PORT = '3000';
process.env.SESSION_SECRET = 'test-secret';
process.env.SESSION_EXPIRATION = '3600';

// Global test timeout
jest.setTimeout(30000); // 30 seconds

// Mock MCP server configuration
process.env.MCP_SERVER_NAME = 'test-server';
process.env.MCP_SERVER_VERSION = '1.0.0';
