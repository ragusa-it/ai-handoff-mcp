import { Pool } from 'pg';
import { createClient, RedisClientType } from 'redis';
import { databaseConfig, redisConfig } from '../config/index.js';
import { 
  createSessionsTable, 
  createContextHistoryTable, 
  createCodebaseSnapshotsTable, 
  createHandoffRequestsTable,
  createIndexes,
  createTriggers,
  type Session,
  type ContextHistoryEntry
} from './schema.js';

export class DatabaseManager {
  private pool: Pool;
  private redisClient: RedisClientType;
  private isInitialized = false;

  constructor() {
    this.pool = new Pool(databaseConfig);
    this.redisClient = createClient(redisConfig) as RedisClientType;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Test PostgreSQL connection
      await this.pool.query('SELECT NOW()');
      console.log('✅ PostgreSQL connected successfully');

      // Initialize database schema
      await this.initializeSchema();

      // Connect to Redis
      await this.redisClient.connect();
      console.log('✅ Redis connected successfully');

      this.isInitialized = true;
    } catch (error) {
      console.error('❌ Database initialization failed:', error);
      throw error;
    }
  }

  private async initializeSchema(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      
      await client.query(createSessionsTable);
      await client.query(createContextHistoryTable);
      await client.query(createCodebaseSnapshotsTable);
      await client.query(createHandoffRequestsTable);
      await client.query(createIndexes);
      await client.query(createTriggers);
      
      await client.query('COMMIT');
      console.log('✅ Database schema initialized');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
    await this.redisClient.quit();
    this.isInitialized = false;
  }

  // Session management methods
  async createSession(sessionKey: string, agentFrom: string, metadata: Record<string, any> = {}): Promise<Session> {
    const query = `
      INSERT INTO sessions (session_key, agent_from, metadata)
      VALUES ($1, $2, $3)
      RETURNING *
    `;
    const result = await this.pool.query(query, [sessionKey, agentFrom, JSON.stringify(metadata)]);
    return this.mapRowToSession(result.rows[0]);
  }

  async getSession(sessionKey: string): Promise<Session | null> {
    const query = 'SELECT * FROM sessions WHERE session_key = $1';
    const result = await this.pool.query(query, [sessionKey]);
    return result.rows.length > 0 ? this.mapRowToSession(result.rows[0]) : null;
  }

  async updateSession(sessionKey: string, updates: Partial<Session>): Promise<Session | null> {
    const setParts: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (updates.agentTo !== undefined) {
      setParts.push(`agent_to = $${paramCount++}`);
      values.push(updates.agentTo);
    }
    if (updates.status !== undefined) {
      setParts.push(`status = $${paramCount++}`);
      values.push(updates.status);
    }
    if (updates.expiresAt !== undefined) {
      setParts.push(`expires_at = $${paramCount++}`);
      values.push(updates.expiresAt);
    }
    if (updates.metadata !== undefined) {
      setParts.push(`metadata = $${paramCount++}`);
      values.push(JSON.stringify(updates.metadata));
    }

    if (setParts.length === 0) return null;

    values.push(sessionKey);
    const query = `
      UPDATE sessions 
      SET ${setParts.join(', ')}
      WHERE session_key = $${paramCount}
      RETURNING *
    `;
    
    const result = await this.pool.query(query, values);
    return result.rows.length > 0 ? this.mapRowToSession(result.rows[0]) : null;
  }

  // Context history methods
  async addContextEntry(sessionId: string, contextType: ContextHistoryEntry['contextType'], content: string, metadata: Record<string, any> = {}): Promise<ContextHistoryEntry> {
    // Get the next sequence number
    const seqQuery = `
      SELECT COALESCE(MAX(sequence_number), 0) + 1 as next_seq
      FROM context_history 
      WHERE session_id = $1
    `;
    const seqResult = await this.pool.query(seqQuery, [sessionId]);
    const sequenceNumber = seqResult.rows[0].next_seq;

    const query = `
      INSERT INTO context_history (session_id, sequence_number, context_type, content, metadata)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    const result = await this.pool.query(query, [sessionId, sequenceNumber, contextType, content, JSON.stringify(metadata)]);
    return this.mapRowToContextHistory(result.rows[0]);
  }

  async getContextHistory(sessionId: string, limit?: number): Promise<ContextHistoryEntry[]> {
    let query = `
      SELECT * FROM context_history 
      WHERE session_id = $1 
      ORDER BY sequence_number ASC
    `;
    const params = [sessionId];

    if (limit) {
      query += ` LIMIT $2`;
      params.push(limit.toString());
    }

    const result = await this.pool.query(query, params);
    return result.rows.map(this.mapRowToContextHistory);
  }

  // Redis caching methods
  async setCache(key: string, value: any, ttlSeconds?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    if (ttlSeconds) {
      await this.redisClient.setEx(key, ttlSeconds, serialized);
    } else {
      await this.redisClient.set(key, serialized);
    }
  }

  async getCache<T = any>(key: string): Promise<T | null> {
    const cached = await this.redisClient.get(key);
    return cached ? JSON.parse(cached) : null;
  }

  async deleteCache(key: string): Promise<void> {
    await this.redisClient.del(key);
  }

  // Helper methods for row mapping
  private mapRowToSession(row: any): Session {
    return {
      id: row.id,
      sessionKey: row.session_key,
      agentFrom: row.agent_from,
      agentTo: row.agent_to,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
      metadata: row.metadata || {}
    };
  }

  private mapRowToContextHistory(row: any): ContextHistoryEntry {
    return {
      id: row.id,
      sessionId: row.session_id,
      sequenceNumber: row.sequence_number,
      contextType: row.context_type,
      content: row.content,
      metadata: row.metadata || {},
      createdAt: row.created_at
    };
  }

  // Health check method
  async healthCheck(): Promise<{ postgres: boolean; redis: boolean }> {
    const result = { postgres: false, redis: false };

    try {
      await this.pool.query('SELECT 1');
      result.postgres = true;
    } catch (error) {
      console.error('PostgreSQL health check failed:', error);
    }

    try {
      await this.redisClient.ping();
      result.redis = true;
    } catch (error) {
      console.error('Redis health check failed:', error);
    }

    return result;
  }
}

// Export a singleton instance
export const db = new DatabaseManager();