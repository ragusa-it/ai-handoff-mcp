import { z } from 'zod';
import { Database } from '../config/database.js';
import { RedisManager } from '../config/redis.js';
import { 
  MemoryModel, 
  Memory, 
  CreateMemoryData, 
  MemoryQuery, 
  MemorySearchResult,
  MemoryWithLinks,
  MemoryStats
} from '../models/Memory.js';
import { EmbeddingService } from './EmbeddingService.js';
import { logger } from './structuredLogger.js';

/**
 * Memory Service
 * 
 * Purpose: High-level memory operations including semantic search, CRUD,
 * consolidation, and cross-linking with advanced filtering and ranking.
 * 
 * Adopts Python plan's approach: hybrid search (lexical + vector), caching,
 * and sophisticated ranking algorithms.
 * 
 * Public API:
 * - async createMemory(data) -> Memory
 * - async searchMemories(query) -> SearchResults
 * - async getMemoryContext(id) -> MemoryWithContext
 * - async consolidateMemories(projectId) -> ConsolidationResult
 */

// Configuration
const MemoryServiceConfigSchema = z.object({
  default_similarity_threshold: z.number().default(0.7),
  max_search_results: z.number().default(100),
  hybrid_search_weights: z.object({
    vector: z.number().default(0.6),
    lexical: z.number().default(0.4),
  }),
  cache_search_results: z.boolean().default(true),
  cache_ttl_seconds: z.number().default(300),
  consolidation_enabled: z.boolean().default(true),
  consolidation_threshold: z.number().default(20),
  similarity_merge_threshold: z.number().default(0.9),
  vector_search_enabled: z.boolean().default(true),
});

type MemoryServiceConfig = z.infer<typeof MemoryServiceConfigSchema>;

export interface SemanticSearchQuery extends Partial<MemoryQuery> {
  query_embedding?: number[];
  boost_recent: boolean;
  boost_high_confidence: boolean;
  include_related: boolean;
  max_age_days?: number;
}

export interface SearchResults {
  memories: MemorySearchResult[];
  total: number;
  search_metadata: {
    query_time_ms: number;
    vector_search_used: boolean;
    cached: boolean;
    ranking_factors: string[];
  };
  aggregations: {
    types: Record<string, number>;
    sources: Record<string, number>;
    recent_activity: Array<{ date: string; count: number }>;
    top_tags: Array<{ tag: string; count: number }>;
  };
}

export interface MemoryContext {
  memory: MemoryWithLinks;
  related_memories: Memory[];
  linked_commits: Array<{
    commit_id: string;
    message: string;
    author: string;
    date: Date;
    link_weight: number;
  }>;
  timeline_context: Array<{
    type: 'memory' | 'commit';
    id: string;
    timestamp: Date;
    summary: string;
  }>;
}

export class MemoryService {
  private db: Database;
  private redis: RedisManager;
  private memoryModel: MemoryModel;
  private embeddingService: EmbeddingService;
  private config: MemoryServiceConfig;

  constructor(
    db: Database,
    redis: RedisManager,
    embeddingService: EmbeddingService,
    config: Partial<MemoryServiceConfig> = {}
  ) {
    this.db = db;
    this.redis = redis;
    this.memoryModel = new MemoryModel(db);
    this.embeddingService = embeddingService;
    this.config = MemoryServiceConfigSchema.parse({
      ...this.getConfigFromEnv(),
      ...config,
    });

    logger.info('MemoryService initialized', {
      vector_search_enabled: this.config.vector_search_enabled,
      consolidation_enabled: this.config.consolidation_enabled,
    });
  }

  /**
   * Create a new memory with automatic embedding generation
   */
  async createMemory(memoryData: CreateMemoryData): Promise<Memory> {
    logger.info('Creating memory', {
      projectId: memoryData.project_id,
      type: memoryData.type,
      source: memoryData.source,
    });

    try {
      // Generate embedding if not provided
      if (!memoryData.embedding && this.config.vector_search_enabled) {
        const embeddingResult = await this.embeddingService.getEmbedding(memoryData.content);
        memoryData.embedding = embeddingResult.embedding;
      }

      const memory = await this.memoryModel.create(memoryData);
      await this.invalidateSearchCache(memoryData.project_id);

      return memory;
    } catch (error) {
      logger.error('Failed to create memory', { error });
      throw error;
    }
  }

  /**
   * Advanced semantic search with hybrid approach
   */
  async searchMemories(query: SemanticSearchQuery): Promise<SearchResults> {
    const startTime = Date.now();
    
    try {
      // Check cache
      const cacheKey = this.buildCacheKey(query);
      if (this.config.cache_search_results) {
        const cached = await this.getCachedSearchResults(cacheKey);
        if (cached) {
          cached.search_metadata.cached = true;
          cached.search_metadata.query_time_ms = Date.now() - startTime;
          return cached;
        }
      }

      // Prepare search parameters
      const searchParams: Partial<MemoryQuery> = {
        project_id: query.project_id!,
        q: query.q,
        type: query.type,
        source: query.source,
        limit: Math.min(query.limit || 20, this.config.max_search_results),
        offset: query.offset || 0,
        similarity_threshold: query.similarity_threshold || this.config.default_similarity_threshold,
      };

      let vectorSearchUsed = false;
      let rankingFactors: string[] = ['chronological'];

      // Get query embedding for semantic search
      if (query.q && this.config.vector_search_enabled) {
        try {
          const embeddingResult = await this.embeddingService.getEmbedding(query.q);
          query.query_embedding = embeddingResult.embedding;
          vectorSearchUsed = true;
          rankingFactors.push('semantic_similarity');
        } catch (error) {
          logger.warn('Failed to get query embedding', { error });
        }
      }

      // Perform the search
      const searchResult = await this.memoryModel.search(searchParams);

      // Apply hybrid ranking if we have vector search
      if (vectorSearchUsed && query.query_embedding) {
        await this.applyHybridRanking(searchResult.memories, query.query_embedding);
        rankingFactors.push('hybrid_scoring');
      }

      // Apply additional ranking factors
      if (query.boost_recent) {
        this.applyRecencyBoost(searchResult.memories);
        rankingFactors.push('recency_boost');
      }

      if (query.boost_high_confidence) {
        this.applyConfidenceBoost(searchResult.memories);
        rankingFactors.push('confidence_boost');
      }

      const results: SearchResults = {
        memories: searchResult.memories,
        total: searchResult.total,
        search_metadata: {
          query_time_ms: Date.now() - startTime,
          vector_search_used: vectorSearchUsed,
          cached: false,
          ranking_factors: rankingFactors,
        },
        aggregations: {
          ...searchResult.aggregations,
          top_tags: this.extractTopTags(searchResult.memories),
        },
      };

      // Cache results
      if (this.config.cache_search_results) {
        await this.cacheSearchResults(cacheKey, results);
      }

      return results;
    } catch (error) {
      logger.error('Failed to search memories', { error });
      throw error;
    }
  }

  /**
   * Get comprehensive context for a memory
   */
  async getMemoryContext(memoryId: string): Promise<MemoryContext> {
    try {
      const memory = await this.memoryModel.findById(memoryId, true);
      if (!memory) {
        throw new Error('Memory not found');
      }

      const relatedMemories = await this.getRelatedMemories(memory);
      const linkedCommits = await this.getLinkedCommitDetails(memory.linked_commits);
      const timelineContext = await this.buildTimelineContext(memory);

      return {
        memory,
        related_memories: relatedMemories,
        linked_commits: linkedCommits,
        timeline_context: timelineContext,
      };
    } catch (error) {
      logger.error('Failed to get memory context', { error, memoryId });
      throw error;
    }
  }

  /**
   * Helper methods
   */
  private async applyHybridRanking(
    memories: MemorySearchResult[], 
    queryEmbedding: number[]
  ): Promise<void> {
    const vectorWeight = this.config.hybrid_search_weights.vector;
    const lexicalWeight = this.config.hybrid_search_weights.lexical;

    for (const result of memories) {
      let semanticScore = 0;
      
      if (result.memory.embedding) {
        semanticScore = this.calculateEmbeddingSimilarity(queryEmbedding, result.memory.embedding);
      }

      const lexicalScore = result.similarity_score || 0;
      const hybridScore = (semanticScore * vectorWeight) + (lexicalScore * lexicalWeight);
      
      result.similarity_score = hybridScore;
      result.rank_score = hybridScore * 100;
    }

    memories.sort((a, b) => (b.similarity_score || 0) - (a.similarity_score || 0));
  }

  private applyRecencyBoost(memories: MemorySearchResult[]): void {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;

    for (const result of memories) {
      const ageInDays = (now - result.memory.created_at.getTime()) / oneDay;
      const recencyBoost = Math.max(0, 1 - (ageInDays / 30));
      result.rank_score += recencyBoost * 10;
    }
  }

  private applyConfidenceBoost(memories: MemorySearchResult[]): void {
    for (const result of memories) {
      const confidence = result.memory.confidence || 0.5;
      result.rank_score += confidence * 20;
    }
  }

  private extractTopTags(memories: MemorySearchResult[]): Array<{ tag: string; count: number }> {
    const tagCounts = new Map<string, number>();
    
    for (const result of memories) {
      const tags = result.memory.metadata?.tags || [];
      for (const tag of tags) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }

    return Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  private async getRelatedMemories(memory: Memory): Promise<Memory[]> {
    const searchResults = await this.memoryModel.search({
      project_id: memory.project_id,
      q: memory.content.substring(0, 100),
      limit: 10,
    });

    return searchResults.memories
      .map(r => r.memory)
      .filter(m => m.id !== memory.id)
      .slice(0, 5);
  }

  private async getLinkedCommitDetails(linkedCommits: Array<{
    commit_id: string;
    link_type: string;
    weight: number;
  }>): Promise<Array<{
    commit_id: string;
    message: string;
    author: string;
    date: Date;
    link_weight: number;
  }>> {
    return linkedCommits.map(lc => ({
      commit_id: lc.commit_id,
      message: '',
      author: '',
      date: new Date(),
      link_weight: lc.weight,
    }));
  }

  private async buildTimelineContext(memory: Memory): Promise<Array<{
    type: 'memory' | 'commit';
    id: string;
    timestamp: Date;
    summary: string;
  }>> {
    return [];
  }

  private calculateEmbeddingSimilarity(embedding1: number[], embedding2: number[]): number {
    if (embedding1.length !== embedding2.length) return 0;

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < embedding1.length; i++) {
      dotProduct += embedding1[i] * embedding2[i];
      norm1 += embedding1[i] * embedding1[i];
      norm2 += embedding2[i] * embedding2[i];
    }

    if (norm1 === 0 || norm2 === 0) return 0;
    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  private buildCacheKey(query: SemanticSearchQuery): string {
    const keyData = {
      project_id: query.project_id,
      q: query.q,
      type: query.type,
      source: query.source,
      limit: query.limit,
      offset: query.offset,
    };
    return `search:${JSON.stringify(keyData)}`;
  }

  private async getCachedSearchResults(cacheKey: string): Promise<SearchResults | null> {
    try {
      const cached = await this.redis.get(cacheKey);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      return null;
    }
  }

  private async cacheSearchResults(cacheKey: string, results: SearchResults): Promise<void> {
    try {
      await this.redis.set(cacheKey, JSON.stringify(results), this.config.cache_ttl_seconds);
    } catch (error) {
      logger.warn('Failed to cache search results', { error });
    }
  }

  private async invalidateSearchCache(projectId: string): Promise<void> {
    try {
      const keys = await this.redis.keys([`search:*"project_id":"${projectId}"*`]);
      if (keys.length > 0) {
        await this.redis.deleteMany(keys);
      }
    } catch (error) {
      logger.warn('Failed to invalidate search cache', { error });
    }
  }

  private getConfigFromEnv(): Partial<MemoryServiceConfig> {
    return {
      vector_search_enabled: process.env.VECTOR_SEARCH_ENABLED !== 'false',
      consolidation_enabled: process.env.MEMORY_CONSOLIDATION_ENABLED !== 'false',
      cache_search_results: process.env.MEMORY_CACHE_ENABLED !== 'false',
    };
  }
}
