import { Pool } from 'pg';
import { createClient, RedisClientType } from 'redis';
import { databaseConfig, redisConfig } from '../config/index.js';
import { 
  createSessionsTable, 
  createContextHistoryTable, 
  createCodebaseSnapshotsTable, 
  createHandoffRequestsTable,
  createSessionLifecycleTable,
  createSystemMetricsTable,
  createPerformanceLogsTable,
  createAnalyticsAggregationsTable,
  createIndexes,
  createTriggers,
  createEnhancedTriggers,
  createMonitoringViews,
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
      
      // Enhanced monitoring tables
      await client.query(createSessionLifecycleTable);
      await client.query(createSystemMetricsTable);
      await client.query(createPerformanceLogsTable);
      await client.query(createAnalyticsAggregationsTable);
      
      await client.query(createIndexes);
      await client.query(createTriggers);
      await client.query(createEnhancedTriggers);
      await client.query(createMonitoringViews);
      
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
    // First try to get from active sessions
    const query = 'SELECT * FROM sessions WHERE session_key = $1';
    const result = await this.pool.query(query, [sessionKey]);
    
    if (result.rows.length > 0) {
      return this.mapRowToSession(result.rows[0]);
    }

    // If not found in active sessions, check archived cache
    const archivedCacheKey = `archived_session_by_key:${sessionKey}`;
    const cachedSession = await this.getCache<Session>(archivedCacheKey);
    
    return cachedSession;
  }

  async updateSession(sessionKey: string, updates: Partial<Session>): Promise<Session | null> {
    const setParts: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    // Check if session is archived - archived sessions are read-only
    const existingSession = await this.getSession(sessionKey);
    if (existingSession?.archivedAt) {
      throw new Error(`Cannot update archived session: ${sessionKey}`);
    }

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
    if (updates.lastActivityAt !== undefined) {
      setParts.push(`last_activity_at = $${paramCount++}`);
      values.push(updates.lastActivityAt);
    }
    if (updates.isDormant !== undefined) {
      setParts.push(`is_dormant = $${paramCount++}`);
      values.push(updates.isDormant);
    }
    if (updates.retentionPolicy !== undefined) {
      setParts.push(`retention_policy = $${paramCount++}`);
      values.push(updates.retentionPolicy);
    }

    // Always update the updated_at timestamp
    setParts.push(`updated_at = NOW()`);

    if (setParts.length === 1) return null; // Only updated_at was added

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

  // Archived session methods
  async getArchivedSession(sessionKey: string): Promise<Session | null> {
    // Check archived cache first
    const archivedCacheKey = `archived_session_by_key:${sessionKey}`;
    const cachedSession = await this.getCache<Session>(archivedCacheKey);
    
    if (cachedSession) {
      return cachedSession;
    }

    // If not in cache, query database for archived session
    const query = 'SELECT * FROM sessions WHERE session_key = $1 AND archived_at IS NOT NULL';
    const result = await this.pool.query(query, [sessionKey]);
    
    if (result.rows.length > 0) {
      const session = this.mapRowToSession(result.rows[0]);
      // Cache the archived session for future access
      await this.setCache(archivedCacheKey, session, 24 * 60 * 60); // Cache for 24 hours
      return session;
    }

    return null;
  }

  async getSessionById(sessionId: string): Promise<Session | null> {
    const query = 'SELECT * FROM sessions WHERE id = $1';
    const result = await this.pool.query(query, [sessionId]);
    return result.rows.length > 0 ? this.mapRowToSession(result.rows[0]) : null;
  }

  // Context history methods
  async addContextEntry(sessionId: string, contextType: ContextHistoryEntry['contextType'], content: string, metadata: Record<string, any> = {}): Promise<ContextHistoryEntry> {
    // Check if session is archived - archived sessions are read-only
    const session = await this.getSessionById(sessionId);
    if (session?.archivedAt) {
      throw new Error(`Cannot add context to archived session: ${sessionId}`);
    }

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
      metadata: row.metadata || {},
      lastActivityAt: row.last_activity_at || row.created_at,
      isDormant: row.is_dormant || false,
      archivedAt: row.archived_at,
      retentionPolicy: row.retention_policy || 'standard'
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
      createdAt: row.created_at,
      processingTimeMs: row.processing_time_ms,
      contentSizeBytes: row.content_size_bytes
    };
  }

  // Generic query method for direct SQL execution
  async query<T = any>(text: string, params?: any[]): Promise<{ rows: T[]; rowCount: number }> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(text, params);
      return {
        rows: result.rows,
        rowCount: result.rowCount || 0
      };
    } finally {
      client.release();
    }
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