import { z } from 'zod';

export const envSchema = z.object({
  // Database Configuration
  DATABASE_URL: z.string().url(),
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().default(5432),
  DB_NAME: z.string().default('ai_handoff'),
  DB_USER: z.string().default('ai_handoff_user'),
  DB_PASSWORD: z.string(),

  // Redis Configuration
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),

  // Server Configuration
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // MCP Configuration
  MCP_SERVER_NAME: z.string().default('ai-handoff-mcp'),
  MCP_SERVER_VERSION: z.string().default('1.0.0'),

  // Security
  SESSION_SECRET: z.string().min(10),
  JWT_SECRET: z.string().min(10),

  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(): EnvConfig {
  const result = envSchema.safeParse(process.env);
  
  if (!result.success) {
    console.error('❌ Invalid environment configuration:');
    console.error(result.error.flatten().fieldErrors);
    process.exit(1);
  }
  
  return result.data;
}