import dotenv from 'dotenv';
import { validateEnv, type EnvConfig } from './env.js';

// Load environment variables
dotenv.config();

// Validate and export configuration
export const config: EnvConfig = validateEnv();

// Helper function to check if we're in development mode
export const isDevelopment = () => config.NODE_ENV === 'development';
export const isProduction = () => config.NODE_ENV === 'production';
export const isTest = () => config.NODE_ENV === 'test';

// Database configuration object
export const databaseConfig = {
  connectionString: config.DATABASE_URL,
  host: config.DB_HOST,
  port: config.DB_PORT,
  database: config.DB_NAME,
  user: config.DB_USER,
  password: config.DB_PASSWORD,
  ssl: isProduction() ? { rejectUnauthorized: false } : false,
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
};

// Redis configuration object
export const redisConfig = {
  url: config.REDIS_URL,
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  retryDelayOnFailover: 100,
  enableReadyCheck: false,
  maxRetriesPerRequest: null,
};

// MCP server configuration
export const mcpConfig = {
  name: config.MCP_SERVER_NAME,
  version: config.MCP_SERVER_VERSION,
};

// Logging configuration
export const loggingConfig = {
  level: config.LOG_LEVEL,
};

export default config;