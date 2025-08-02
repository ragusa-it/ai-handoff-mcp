import { z } from 'zod';
import { Database } from '../config/database.js';
import { logger } from '../services/structuredLogger.js';

/**
 * Enhanced Memory Model
 * 
 * Purpose: Unified memory storage for agent-created and git-extracted memories
 * with vector embeddings, semantic search, and cross-linking capabilities.
 * 
 * Adopts Python plan's schema design with Node.js/TypeScript implementation.
 */

// Validation Schemas
export const MemoryTypeSchema = z.enum(['semantic', 'episodic', 'factual']);
export const MemorySourceSchema = z.enum(['git', 'agent', 'pr', 'system']);
export const MemoryMetadataSchema = z.object({
  // Git-specific metadata
  conventional_type: z.string().optional(),
  scope: z.string().optional(),
  breaking: z.boolean().optional(),
  issues: z.array(z.number()).optional(),
  component: z.string().optional(),
  change_type: z.string().optional(),
  
  // Agent-specific metadata
  session_id: z.string().optional(),
  context_window: z.number().optional(),
  agent_id: z.string().optional(),
  importance: z.number().min(1).max(10).optional(),
  tags: z.array(z.string()).optional(),
  
  // Extraction metadata
  confidence: z.number().min(0).max(1).optional(),
  extraction_method: z.string().optional(),
  llm_model: z.string().optional(),
  
  // Additional structured data
  entities: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
  related_docs: z.array(z.string()).optional(),
});

export const MemorySchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  type: MemoryTypeSchema,
  content: z.string().min(1).max(10000),
  embedding: z.array(z.number()).nullable(),
  metadata: MemoryMetadataSchema.optional().default({}),
  source: MemorySourceSchema.default('agent'),
  repo_paths: z.array(z.string()).default([]),
  commit_hashes: z.array(z.string()).default([]),
  line_ranges: z.array(z.string()).default([]), // Format: "start:end"
  extracted_from: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  created_at: z.date(),
  updated_at: z.date(),
});

export const CreateMemorySchema = MemorySchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
}).extend({
  embedding: z.array(z.number()).optional(),
});

export const UpdateMemorySchema = CreateMemorySchema.partial().extend({
  id: z.string().uuid(),
});

export const MemoryQuerySchema = z.object({
  project_id: z.string().uuid(),
  q: z.string().optional(), // Text query for semantic search
  type: MemoryTypeSchema.optional(),
  source: MemorySourceSchema.optional(),
  repo_paths: z.array(z.string()).optional(),
  commit_hashes: z.array(z.string()).optional(),
  since: z.date().optional(),
  until: z.date().optional(),
  tags: z.array(z.string()).optional(),
  min_confidence: z.number().min(0).max(1).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
  include_embeddings: z.boolean().default(false),
  similarity_threshold: z.number().min(0).max(1).default(0.7),
});

export const MemoryLinkSchema = z.object({
  id: z.string().uuid(),
  memory_id: z.string().uuid(),
  target_type: z.enum(['commit', 'file', 'task', 'memory']),
  target_id: z.string(),
  link_type: z.enum(['relates_to', 'supersedes', 'derived_from', 'contradicts', 'supports']),
  weight: z.number().min(0).max(1),
  metadata: z.record(z.any()).default({}),
  created_at: z.date(),
});

export const CreateMemoryLinkSchema = MemoryLinkSchema.omit({
  id: true,
  created_at: true,
});

// TypeScript Types
export type Memory = z.infer<typeof MemorySchema>;
export type CreateMemoryData = z.infer<typeof CreateMemorySchema>;
export type UpdateMemoryData = z.infer<typeof UpdateMemorySchema>;
export type MemoryQuery = z.infer<typeof MemoryQuerySchema>;
export type MemoryLink = z.infer<typeof MemoryLinkSchema>;
export type CreateMemoryLinkData = z.infer<typeof CreateMemoryLinkSchema>;
export type MemoryType = z.infer<typeof MemoryTypeSchema>;
export type MemorySource = z.infer<typeof MemorySourceSchema>;
export type MemoryMetadata = z.infer<typeof MemoryMetadataSchema>;

export interface MemoryWithLinks extends Memory {
  links: MemoryLink[];
  related_memories: Memory[];
  linked_commits: Array<{
    commit_id: string;
    link_type: string;
    weight: number;
  }>;
}

export interface MemorySearchResult {
  memory: Memory;
  similarity_score?: number;
  rank_score: number;
  match_reasons: string[];
}

export interface MemoryStats {
  total_memories: number;
  by_type: Record<MemoryType, number>;
  by_source: Record<MemorySource, number>;
  recent_count: number; // Last 7 days
  avg_confidence: number;
  top_tags: Array<{ tag: string; count: number }>;
  top_components: Array<{ component: string; count: number }>;
}

// Database Operations
export class MemoryModel {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Create a new memory with validation and embedding support
   */
  async create(memoryData: CreateMemoryData): Promise<Memory> {
    const validatedData = CreateMemorySchema.parse(memoryData);
    
    const id = crypto.randomUUID();
    const now = new Date();
    
    const query = `
      INSERT INTO memories (
        id, project_id, type, content, embedding, metadata, source,
        repo_paths, commit_hashes, line_ranges, extracted_from, confidence,
        created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `;

    try {
      const result = await this.db.query(query, [
        id,
        validatedData.project_id,
        validatedData.type,
        validatedData.content,
        validatedData.embedding ? JSON.stringify(validatedData.embedding) : null,
        JSON.stringify(validatedData.metadata || {}),
        validatedData.source,
        validatedData.repo_paths,
        validatedData.commit_hashes,
        validatedData.line_ranges,
        validatedData.extracted_from,
        validatedData.confidence,
        now,
        now,
      ]);

      const memory = this.parseMemoryRow(result.rows[0]);
      
      logger.info('Memory created', {
        memoryId: memory.id,
        projectId: memory.project_id,
        type: memory.type,
        source: memory.source,
        contentLength: memory.content.length,
      });

      return memory;
    } catch (error) {
      logger.error('Failed to create memory', { error, memoryData });
      throw error;
    }
  }

  /**
   * Find memory by ID with optional links
   */
  async findById(id: string, includeLinks = false): Promise<MemoryWithLinks | null> {
    const query = `
      SELECT * FROM memories WHERE id = $1
    `;

    try {
      const result = await this.db.query(query, [id]);
      
      if (result.rows.length === 0) {
        return null;
      }

      const memory = this.parseMemoryRow(result.rows[0]);
      
      if (!includeLinks) {
        return {
          ...memory,
          links: [],
          related_memories: [],
          linked_commits: [],
        };
      }

      // Get links
      const links = await this.getMemoryLinks(id);
      
      // Get related memories (linked to this memory)
      const relatedMemories = await this.getRelatedMemories(id);
      
      // Get linked commits
      const linkedCommits = await this.getLinkedCommits(id);

      return {
        ...memory,
        links,
        related_memories: relatedMemories,
        linked_commits: linkedCommits,
      };
    } catch (error) {
      logger.error('Failed to find memory by ID', { error, id });
      throw error;
    }
  }

  /**
   * Semantic and hybrid search with advanced filtering
   */
  async search(queryParams: Partial<MemoryQuery>): Promise<{
    memories: MemorySearchResult[];
    total: number;
    aggregations: {
      types: Record<string, number>;
      sources: Record<string, number>;
      recent_activity: Array<{ date: string; count: number }>;
    };
  }> {
    const validatedQuery = MemoryQuerySchema.parse(queryParams);
    
    const conditions: string[] = ['project_id = $1'];
    const queryValues: any[] = [validatedQuery.project_id];
    let paramCount = 1;

    // Build WHERE conditions
    if (validatedQuery.type) {
      conditions.push(`type = $${++paramCount}`);
      queryValues.push(validatedQuery.type);
    }

    if (validatedQuery.source) {
      conditions.push(`source = $${++paramCount}`);
      queryValues.push(validatedQuery.source);
    }

    if (validatedQuery.repo_paths && validatedQuery.repo_paths.length > 0) {
      conditions.push(`repo_paths && $${++paramCount}`);
      queryValues.push(validatedQuery.repo_paths);
    }

    if (validatedQuery.commit_hashes && validatedQuery.commit_hashes.length > 0) {
      conditions.push(`commit_hashes && $${++paramCount}`);
      queryValues.push(validatedQuery.commit_hashes);
    }

    if (validatedQuery.since) {
      conditions.push(`created_at >= $${++paramCount}`);
      queryValues.push(validatedQuery.since);
    }

    if (validatedQuery.until) {
      conditions.push(`created_at <= $${++paramCount}`);
      queryValues.push(validatedQuery.until);
    }

    if (validatedQuery.min_confidence !== undefined) {
      conditions.push(`confidence >= $${++paramCount}`);
      queryValues.push(validatedQuery.min_confidence);
    }

    if (validatedQuery.tags && validatedQuery.tags.length > 0) {
      const tagConditions = validatedQuery.tags.map(() => {
        return `metadata->>'tags' ILIKE $${++paramCount}`;
      });
      conditions.push(`(${tagConditions.join(' OR ')})`);
      validatedQuery.tags.forEach(tag => queryValues.push(`%${tag}%`));
    }

    const whereClause = conditions.join(' AND ');

    // Semantic search with vector similarity
    let orderClause = 'ORDER BY created_at DESC';
    let selectFields = 'm.*';
    let similarity_score = 'NULL as similarity_score';

    if (validatedQuery.q && validatedQuery.q.trim()) {
      // This would need embedding service to get query vector
      // For now, use text search as fallback
      conditions.push(`(
        content ILIKE $${++paramCount} OR 
        to_tsvector('english', content) @@ plainto_tsquery('english', $${++paramCount})
      )`);
      queryValues.push(`%${validatedQuery.q}%`);
      queryValues.push(validatedQuery.q);
      
      // TODO: Add vector similarity when embedding service is ready
      // similarity_score = `1 - (embedding <=> $${++paramCount}) as similarity_score`;
      // queryValues.push(queryEmbedding);
      // orderClause = 'ORDER BY similarity_score DESC, created_at DESC';
    }

    // Main query
    const dataQuery = `
      SELECT 
        ${selectFields},
        ${similarity_score},
        ROW_NUMBER() OVER (${orderClause}) as rank_score
      FROM memories m
      WHERE ${whereClause}
      ${orderClause}
      LIMIT $${++paramCount} OFFSET $${++paramCount}
    `;

    queryValues.push(validatedQuery.limit, validatedQuery.offset);

    // Count query
    const countQuery = `
      SELECT COUNT(*) as total
      FROM memories m
      WHERE ${whereClause}
    `;

    // Aggregation queries
    const typeAggQuery = `
      SELECT type, COUNT(*) as count
      FROM memories m
      WHERE ${whereClause}
      GROUP BY type
    `;

    const sourceAggQuery = `
      SELECT source, COUNT(*) as count
      FROM memories m
      WHERE ${whereClause}
      GROUP BY source
    `;

    const activityAggQuery = `
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM memories m
      WHERE ${whereClause} AND created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `;

    try {
      const [dataResult, countResult, typeResult, sourceResult, activityResult] = await Promise.all([
        this.db.query(dataQuery, queryValues),
        this.db.query(countQuery, queryValues.slice(0, -2)), // Remove limit/offset
        this.db.query(typeAggQuery, queryValues.slice(0, -2)),
        this.db.query(sourceAggQuery, queryValues.slice(0, -2)),
        this.db.query(activityAggQuery, queryValues.slice(0, -2)),
      ]);

      const memories: MemorySearchResult[] = dataResult.rows.map(row => {
        const memory = this.parseMemoryRow(row);
        return {
          memory,
          similarity_score: row.similarity_score,
          rank_score: parseInt(row.rank_score),
          match_reasons: this.getMatchReasons(memory, validatedQuery),
        };
      });

      const aggregations = {
        types: Object.fromEntries(
          typeResult.rows.map(row => [row.type, parseInt(row.count)])
        ),
        sources: Object.fromEntries(
          sourceResult.rows.map(row => [row.source, parseInt(row.count)])
        ),
        recent_activity: activityResult.rows.map(row => ({
          date: row.date,
          count: parseInt(row.count),
        })),
      };

      return {
        memories,
        total: parseInt(countResult.rows[0].total),
        aggregations,
      };
    } catch (error) {
      logger.error('Failed to search memories', { error, queryParams });
      throw error;
    }
  }

  /**
   * Get memories for a specific project with statistics
   */
  async getProjectMemories(projectId: string, limit = 50): Promise<{
    memories: Memory[];
    stats: MemoryStats;
  }> {
    try {
      // Get recent memories
      const memoriesQuery = `
        SELECT * FROM memories 
        WHERE project_id = $1 
        ORDER BY created_at DESC 
        LIMIT $2
      `;
      
      const memoriesResult = await this.db.query(memoriesQuery, [projectId, limit]);
      const memories = memoriesResult.rows.map(row => this.parseMemoryRow(row));

      // Get statistics
      const stats = await this.getMemoryStats(projectId);

      return { memories, stats };
    } catch (error) {
      logger.error('Failed to get project memories', { error, projectId });
      throw error;
    }
  }

  /**
   * Create a link between memories or memory and other entities
   */
  async createLink(linkData: CreateMemoryLinkData): Promise<MemoryLink> {
    const validatedData = CreateMemoryLinkSchema.parse(linkData);
    
    const id = crypto.randomUUID();
    const now = new Date();
    
    const query = `
      INSERT INTO memory_links (
        id, memory_id, target_type, target_id, link_type, weight, metadata, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (memory_id, target_type, target_id, link_type) 
      DO UPDATE SET weight = EXCLUDED.weight, metadata = EXCLUDED.metadata
      RETURNING *
    `;

    try {
      const result = await this.db.query(query, [
        id,
        validatedData.memory_id,
        validatedData.target_type,
        validatedData.target_id,
        validatedData.link_type,
        validatedData.weight,
        JSON.stringify(validatedData.metadata),
        now,
      ]);

      return this.parseMemoryLinkRow(result.rows[0]);
    } catch (error) {
      logger.error('Failed to create memory link', { error, linkData });
      throw error;
    }
  }

  /**
   * Update memory content and metadata
   */
  async update(updateData: UpdateMemoryData): Promise<Memory> {
    const validatedData = UpdateMemorySchema.parse(updateData);
    
    const updateFields: string[] = [];
    const queryValues: any[] = [];
    let paramCount = 0;

    // Build dynamic update query
    Object.entries(validatedData).forEach(([key, value]) => {
      if (key !== 'id' && value !== undefined) {
        paramCount++;
        if (key === 'metadata') {
          updateFields.push(`${key} = $${paramCount}`);
          queryValues.push(JSON.stringify(value));
        } else if (key === 'embedding') {
          updateFields.push(`${key} = $${paramCount}`);
          queryValues.push(value ? JSON.stringify(value) : null);
        } else {
          updateFields.push(`${key} = $${paramCount}`);
          queryValues.push(value);
        }
      }
    });

    updateFields.push(`updated_at = $${++paramCount}`);
    queryValues.push(new Date());
    queryValues.push(validatedData.id);

    const query = `
      UPDATE memories 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramCount + 1}
      RETURNING *
    `;

    try {
      const result = await this.db.query(query, queryValues);
      
      if (result.rows.length === 0) {
        throw new Error('Memory not found');
      }

      return this.parseMemoryRow(result.rows[0]);
    } catch (error) {
      logger.error('Failed to update memory', { error, updateData });
      throw error;
    }
  }

  /**
   * Delete memory and its links
   */
  async delete(id: string): Promise<void> {
    const query = `
      DELETE FROM memories WHERE id = $1
    `;

    try {
      const result = await this.db.query(query, [id]);
      
      if (result.rowCount === 0) {
        throw new Error('Memory not found');
      }

      logger.info('Memory deleted', { memoryId: id });
    } catch (error) {
      logger.error('Failed to delete memory', { error, id });
      throw error;
    }
  }

  /**
   * Helper methods
   */
  private parseMemoryRow(row: any): Memory {
    return {
      id: row.id,
      project_id: row.project_id,
      type: row.type,
      content: row.content,
      embedding: row.embedding ? JSON.parse(row.embedding) : null,
      metadata: JSON.parse(row.metadata || '{}'),
      source: row.source,
      repo_paths: row.repo_paths || [],
      commit_hashes: row.commit_hashes || [],
      line_ranges: row.line_ranges || [],
      extracted_from: row.extracted_from,
      confidence: row.confidence,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
  }

  private parseMemoryLinkRow(row: any): MemoryLink {
    return {
      id: row.id,
      memory_id: row.memory_id,
      target_type: row.target_type,
      target_id: row.target_id,
      link_type: row.link_type,
      weight: row.weight,
      metadata: JSON.parse(row.metadata || '{}'),
      created_at: new Date(row.created_at),
    };
  }

  private async getMemoryLinks(memoryId: string): Promise<MemoryLink[]> {
    const query = `
      SELECT * FROM memory_links 
      WHERE memory_id = $1 
      ORDER BY weight DESC, created_at DESC
    `;
    
    const result = await this.db.query(query, [memoryId]);
    return result.rows.map(row => this.parseMemoryLinkRow(row));
  }

  private async getRelatedMemories(memoryId: string): Promise<Memory[]> {
    const query = `
      SELECT m.* FROM memories m
      JOIN memory_links ml ON (
        (ml.memory_id = $1 AND ml.target_type = 'memory' AND ml.target_id = m.id::text) OR
        (ml.memory_id = m.id AND ml.target_type = 'memory' AND ml.target_id = $1)
      )
      WHERE m.id != $1
      ORDER BY ml.weight DESC
      LIMIT 10
    `;
    
    const result = await this.db.query(query, [memoryId]);
    return result.rows.map(row => this.parseMemoryRow(row));
  }

  private async getLinkedCommits(memoryId: string): Promise<Array<{
    commit_id: string;
    link_type: string;
    weight: number;
  }>> {
    const query = `
      SELECT target_id as commit_id, link_type, weight
      FROM memory_links 
      WHERE memory_id = $1 AND target_type = 'commit'
      ORDER BY weight DESC
    `;
    
    const result = await this.db.query(query, [memoryId]);
    return result.rows;
  }

  private async getMemoryStats(projectId: string): Promise<MemoryStats> {
    const statsQuery = `
      SELECT 
        COUNT(*) as total_memories,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as recent_count,
        AVG(confidence) as avg_confidence
      FROM memories 
      WHERE project_id = $1
    `;

    const typeStatsQuery = `
      SELECT type, COUNT(*) as count
      FROM memories 
      WHERE project_id = $1
      GROUP BY type
    `;

    const sourceStatsQuery = `
      SELECT source, COUNT(*) as count
      FROM memories 
      WHERE project_id = $1
      GROUP BY source
    `;

    try {
      const [statsResult, typeResult, sourceResult] = await Promise.all([
        this.db.query(statsQuery, [projectId]),
        this.db.query(typeStatsQuery, [projectId]),
        this.db.query(sourceStatsQuery, [projectId]),
      ]);

      const stats = statsResult.rows[0];
      
      return {
        total_memories: parseInt(stats.total_memories) || 0,
        by_type: Object.fromEntries(
          typeResult.rows.map(row => [row.type, parseInt(row.count)])
        ) as Record<MemoryType, number>,
        by_source: Object.fromEntries(
          sourceResult.rows.map(row => [row.source, parseInt(row.count)])
        ) as Record<MemorySource, number>,
        recent_count: parseInt(stats.recent_count) || 0,
        avg_confidence: parseFloat(stats.avg_confidence) || 0,
        top_tags: [], // TODO: Extract from metadata
        top_components: [], // TODO: Extract from metadata
      };
    } catch (error) {
      logger.error('Failed to get memory stats', { error, projectId });
      throw error;
    }
  }

  private getMatchReasons(memory: Memory, query: MemoryQuery): string[] {
    const reasons: string[] = [];
    
    if (query.q) {
      if (memory.content.toLowerCase().includes(query.q.toLowerCase())) {
        reasons.push('content_match');
      }
    }
    
    if (query.repo_paths && memory.repo_paths.some(path => 
      query.repo_paths!.some(qPath => path.includes(qPath) || qPath.includes(path))
    )) {
      reasons.push('path_match');
    }
    
    if (query.commit_hashes && memory.commit_hashes.some(hash => 
      query.commit_hashes!.includes(hash)
    )) {
      reasons.push('commit_match');
    }
    
    if (query.type && memory.type === query.type) {
      reasons.push('type_match');
    }
    
    return reasons;
  }
}
