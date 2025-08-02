import { Pool, PoolConfig, PoolClient } from 'pg';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../services/structuredLogger.js';

export interface DatabaseConfig extends PoolConfig {
  database: string;
  user: string;
  password: string;
  host: string;
  port: number;
  ssl?: boolean;
  connectionTimeoutMillis?: number;
  idleTimeoutMillis?: number;
  max?: number;
}

export class Database {
  private pool: Pool;
  private static instance: Database;

  constructor(config: DatabaseConfig) {
    this.pool = new Pool({
      ...config,
      max: config.max || 20,
      idleTimeoutMillis: config.idleTimeoutMillis || 30000,
      connectionTimeoutMillis: config.connectionTimeoutMillis || 2000,
    });

    // Handle pool errors
    this.pool.on('error', (err) => {
      logger.error('Unexpected error on idle client', { error: err });
    });
  }

  static getInstance(config?: DatabaseConfig): Database {
    if (!Database.instance) {
      if (!config) {
        throw new Error('Database config required for first initialization');
      }
      Database.instance = new Database(config);
    }
    return Database.instance;
  }

  async getClient(): Promise<PoolClient> {
    return this.pool.connect();
  }

  async query(text: string, params?: any[]): Promise<any> {
    const start = Date.now();
    try {
      const res = await this.pool.query(text, params);
      const duration = Date.now() - start;
      logger.debug('Executed query', { text, duration, rows: res.rowCount });
      return res;
    } catch (error) {
      logger.error('Query error', { text, params, error });
      throw error;
    }
  }

  async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.getClient();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async healthCheck(): Promise<boolean> {
    try {
      const result = await this.query('SELECT 1 as health');
      return result.rows[0]?.health === 1;
    } catch (error) {
      logger.error('Database health check failed', { error });
      return false;
    }
  }
}

export class MigrationRunner {
  private db: Database;
  private migrationsPath: string;

  constructor(db: Database, migrationsPath: string = 'src/migrations') {
    this.db = db;
    this.migrationsPath = migrationsPath;
  }

  async runMigrations(): Promise<void> {
    logger.info('Starting database migrations');

    // Create migrations table if it doesn't exist
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Get executed migrations
    const executedResult = await this.db.query(
      'SELECT filename FROM migrations ORDER BY id'
    );
    const executedMigrations = new Set(
      executedResult.rows.map((row: any) => row.filename)
    );

    // Get available migration files
    const migrationFiles = this.getMigrationFiles();

    // Run pending migrations
    for (const filename of migrationFiles) {
      if (!executedMigrations.has(filename)) {
        await this.runMigration(filename);
      }
    }

    logger.info('Database migrations completed');
  }

  private getMigrationFiles(): string[] {
    const fs = require('fs');
    const path = require('path');
    
    if (!existsSync(this.migrationsPath)) {
      logger.warn('Migrations directory not found', { path: this.migrationsPath });
      return [];
    }

    return fs
      .readdirSync(this.migrationsPath)
      .filter((file: string) => file.endsWith('.sql'))
      .sort();
  }

  private async runMigration(filename: string): Promise<void> {
    const filePath = join(this.migrationsPath, filename);
    
    try {
      const sql = readFileSync(filePath, 'utf8');
      
      logger.info('Running migration', { filename });
      
      await this.db.transaction(async (client) => {
        // Execute migration SQL
        await client.query(sql);
        
        // Record migration as executed
        await client.query(
          'INSERT INTO migrations (filename) VALUES ($1)',
          [filename]
        );
      });

      logger.info('Migration completed', { filename });
    } catch (error) {
      logger.error('Migration failed', { filename, error });
      throw new Error(`Migration ${filename} failed: ${error}`);
    }
  }

  async rollbackLastMigration(): Promise<void> {
    const lastMigration = await this.db.query(
      'SELECT filename FROM migrations ORDER BY id DESC LIMIT 1'
    );

    if (lastMigration.rows.length === 0) {
      logger.info('No migrations to rollback');
      return;
    }

    const filename = lastMigration.rows[0].filename;
    logger.warn('Rolling back migration', { filename });

    // Remove from migrations table
    await this.db.query(
      'DELETE FROM migrations WHERE filename = $1',
      [filename]
    );

    logger.info('Migration rollback completed', { filename });
    logger.warn('Note: Automatic schema rollback not implemented. Manual cleanup may be required.');
  }
}

// Initialize database from environment
export function createDatabaseFromEnv(): Database {
  const config: DatabaseConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'ai_handoff',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl: process.env.DB_SSL === 'true',
    max: parseInt(process.env.DB_POOL_MAX || '20'),
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000'),
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT || '2000'),
  };

  return Database.getInstance(config);
}
