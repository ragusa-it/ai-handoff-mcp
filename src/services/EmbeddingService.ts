import { z } from 'zod';
import { logger } from './structuredLogger.js';

/**
 * Embedding Service
 * 
 * Purpose: Unified embedding abstraction supporting both local models (bge-m3 via Python)
 * and cloud providers (OpenAI) with automatic fallback and caching.
 * 
 * Adopts Python plan's approach: local-first with cloud fallback.
 * 
 * Public API:
 * - async getEmbedding(text: string) -> number[]
 * - async getEmbeddings(texts: string[]) -> number[][]
 * - async getSimilarity(text1: string, text2: string) -> number
 * 
 * Providers:
 * - bge-m3 via sentence-transformers (local Python bridge)
 * - OpenAI text-embedding-3-small (fallback)
 * - Cache results in Redis for performance
 */

// Configuration and validation
const EmbeddingConfigSchema = z.object({
  provider: z.enum(['bge-m3', 'openai', 'auto']).default('auto'),
  openai_api_key: z.string().optional(),
  python_bridge_url: z.string().default('http://localhost:8001'),
  model_name: z.string().default('BAAI/bge-m3'),
  max_tokens: z.number().default(8192),
  cache_enabled: z.boolean().default(true),
  cache_ttl_seconds: z.number().default(86400), // 24 hours
  batch_size: z.number().default(32),
  timeout_ms: z.number().default(30000),
});

type EmbeddingConfig = z.infer<typeof EmbeddingConfigSchema>;

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  provider: 'bge-m3' | 'openai';
  cached: boolean;
  processing_time_ms: number;
}

export interface EmbeddingBatchResult {
  embeddings: number[][];
  model: string;
  provider: 'bge-m3' | 'openai';
  cached_count: number;
  total_count: number;
  processing_time_ms: number;
}

export interface SimilarityResult {
  similarity: number;
  method: 'cosine' | 'dot_product' | 'euclidean';
  embeddings_cached: boolean;
}

export class EmbeddingService {
  private config: EmbeddingConfig;
  private cache: Map<string, { embedding: number[]; timestamp: number; provider: string }>;
  private redis?: any; // Redis client for persistent caching

  constructor(config: Partial<EmbeddingConfig> = {}, redis?: any) {
    this.config = EmbeddingConfigSchema.parse({
      ...this.getConfigFromEnv(),
      ...config,
    });
    this.redis = redis;
    this.cache = new Map();

    logger.info('EmbeddingService initialized', {
      provider: this.config.provider,
      cache_enabled: this.config.cache_enabled,
      python_bridge_url: this.config.python_bridge_url,
    });
  }

  /**
   * Get embedding for a single text
   */
  async getEmbedding(text: string): Promise<EmbeddingResult> {
    const startTime = Date.now();
    
    // Validate and normalize input
    if (!text || text.trim().length === 0) {
      throw new Error('Text cannot be empty');
    }

    const normalizedText = this.normalizeText(text);
    const cacheKey = this.getCacheKey(normalizedText);

    // Check cache first
    if (this.config.cache_enabled) {
      const cached = await this.getCachedEmbedding(cacheKey);
      if (cached) {
        return {
          embedding: cached.embedding,
          model: this.config.model_name,
          provider: cached.provider as 'bge-m3' | 'openai',
          cached: true,
          processing_time_ms: Date.now() - startTime,
        };
      }
    }

    // Get embedding from provider
    let result: EmbeddingResult;
    
    try {
      if (this.config.provider === 'auto') {
        // Try local first, then fallback to OpenAI
        try {
          result = await this.getEmbeddingFromLocal(normalizedText, startTime);
        } catch (localError) {
          logger.warn('Local embedding failed, falling back to OpenAI', { 
            error: localError instanceof Error ? localError.message : String(localError)
          });
          result = await this.getEmbeddingFromOpenAI(normalizedText, startTime);
        }
      } else if (this.config.provider === 'bge-m3') {
        result = await this.getEmbeddingFromLocal(normalizedText, startTime);
      } else if (this.config.provider === 'openai') {
        result = await this.getEmbeddingFromOpenAI(normalizedText, startTime);
      } else {
        throw new Error(`Unsupported provider: ${this.config.provider}`);
      }

      // Cache the result
      if (this.config.cache_enabled) {
        await this.cacheEmbedding(cacheKey, result.embedding, result.provider);
      }

      result.cached = false;
      return result;

    } catch (error) {
      logger.error('Failed to get embedding', { 
        error: error instanceof Error ? error.message : String(error),
        text_length: text.length,
        provider: this.config.provider,
      });
      throw error;
    }
  }

  /**
   * Get embeddings for multiple texts (batched)
   */
  async getEmbeddings(texts: string[]): Promise<EmbeddingBatchResult> {
    const startTime = Date.now();
    
    if (!texts || texts.length === 0) {
      throw new Error('Texts array cannot be empty');
    }

    const normalizedTexts = texts.map(text => this.normalizeText(text));
    const embeddings: number[][] = [];
    const cacheKeys = normalizedTexts.map(text => this.getCacheKey(text));
    
    let cachedCount = 0;
    const uncachedTexts: string[] = [];
    const uncachedIndices: number[] = [];

    // Check cache for each text
    if (this.config.cache_enabled) {
      for (let i = 0; i < normalizedTexts.length; i++) {
        const cached = await this.getCachedEmbedding(cacheKeys[i]);
        if (cached) {
          embeddings[i] = cached.embedding;
          cachedCount++;
        } else {
          uncachedTexts.push(normalizedTexts[i]);
          uncachedIndices.push(i);
        }
      }
    } else {
      uncachedTexts.push(...normalizedTexts);
      uncachedIndices.push(...normalizedTexts.map((_, i) => i));
    }

    let provider: 'bge-m3' | 'openai' = 'bge-m3';

    // Get embeddings for uncached texts
    if (uncachedTexts.length > 0) {
      try {
        const batchResults = await this.getBatchEmbeddings(uncachedTexts);
        provider = batchResults.provider;
        
        // Fill in the embeddings array
        for (let i = 0; i < uncachedIndices.length; i++) {
          const index = uncachedIndices[i];
          embeddings[index] = batchResults.embeddings[i];
          
          // Cache individual results
          if (this.config.cache_enabled) {
            await this.cacheEmbedding(cacheKeys[index], batchResults.embeddings[i], provider);
          }
        }
      } catch (error) {
        logger.error('Failed to get batch embeddings', { 
          error: error instanceof Error ? error.message : String(error),
          uncached_count: uncachedTexts.length,
        });
        throw error;
      }
    }

    return {
      embeddings,
      model: this.config.model_name,
      provider,
      cached_count: cachedCount,
      total_count: texts.length,
      processing_time_ms: Date.now() - startTime,
    };
  }

  /**
   * Calculate semantic similarity between two texts
   */
  async getSimilarity(text1: string, text2: string, method: 'cosine' | 'dot_product' | 'euclidean' = 'cosine'): Promise<SimilarityResult> {
    const [result1, result2] = await Promise.all([
      this.getEmbedding(text1),
      this.getEmbedding(text2),
    ]);

    const similarity = this.calculateSimilarity(result1.embedding, result2.embedding, method);

    return {
      similarity,
      method,
      embeddings_cached: result1.cached && result2.cached,
    };
  }

  /**
   * Get embedding from local Python service (bge-m3)
   */
  private async getEmbeddingFromLocal(text: string, startTime: number): Promise<EmbeddingResult> {
    const url = `${this.config.python_bridge_url}/embeddings`;
    
    const requestBody = {
      texts: [text],
      model: this.config.model_name,
      normalize: true,
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(this.config.timeout_ms),
      });

      if (!response.ok) {
        throw new Error(`Local embedding service error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      if (!data.embeddings || !Array.isArray(data.embeddings) || data.embeddings.length === 0) {
        throw new Error('Invalid response from local embedding service');
      }

      return {
        embedding: data.embeddings[0],
        model: data.model || this.config.model_name,
        provider: 'bge-m3',
        cached: false,
        processing_time_ms: Date.now() - startTime,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Local embedding service timeout');
      }
      throw new Error(`Local embedding failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get embedding from OpenAI
   */
  private async getEmbeddingFromOpenAI(text: string, startTime: number): Promise<EmbeddingResult> {
    if (!this.config.openai_api_key) {
      throw new Error('OpenAI API key not configured');
    }

    const url = 'https://api.openai.com/v1/embeddings';
    
    const requestBody = {
      input: text,
      model: 'text-embedding-3-small',
      encoding_format: 'float',
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.openai_api_key}`,
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(this.config.timeout_ms),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`OpenAI API error: ${response.status} ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json();
      
      if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
        throw new Error('Invalid response from OpenAI API');
      }

      return {
        embedding: data.data[0].embedding,
        model: 'text-embedding-3-small',
        provider: 'openai',
        cached: false,
        processing_time_ms: Date.now() - startTime,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('OpenAI API timeout');
      }
      throw new Error(`OpenAI embedding failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get batch embeddings with automatic provider selection
   */
  private async getBatchEmbeddings(texts: string[]): Promise<{
    embeddings: number[][];
    provider: 'bge-m3' | 'openai';
  }> {
    if (this.config.provider === 'auto') {
      try {
        return await this.getBatchEmbeddingsFromLocal(texts);
      } catch (localError) {
        logger.warn('Local batch embedding failed, falling back to OpenAI', { 
          error: localError instanceof Error ? localError.message : String(localError)
        });
        return await this.getBatchEmbeddingsFromOpenAI(texts);
      }
    } else if (this.config.provider === 'bge-m3') {
      return await this.getBatchEmbeddingsFromLocal(texts);
    } else {
      return await this.getBatchEmbeddingsFromOpenAI(texts);
    }
  }

  /**
   * Get batch embeddings from local service
   */
  private async getBatchEmbeddingsFromLocal(texts: string[]): Promise<{
    embeddings: number[][];
    provider: 'bge-m3';
  }> {
    const url = `${this.config.python_bridge_url}/embeddings`;
    
    const requestBody = {
      texts,
      model: this.config.model_name,
      normalize: true,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(this.config.timeout_ms),
    });

    if (!response.ok) {
      throw new Error(`Local embedding service error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    if (!data.embeddings || !Array.isArray(data.embeddings)) {
      throw new Error('Invalid response from local embedding service');
    }

    return {
      embeddings: data.embeddings,
      provider: 'bge-m3',
    };
  }

  /**
   * Get batch embeddings from OpenAI (chunked to respect rate limits)
   */
  private async getBatchEmbeddingsFromOpenAI(texts: string[]): Promise<{
    embeddings: number[][];
    provider: 'openai';
  }> {
    if (!this.config.openai_api_key) {
      throw new Error('OpenAI API key not configured');
    }

    const allEmbeddings: number[][] = [];
    const batchSize = Math.min(this.config.batch_size, 100); // OpenAI batch limit
    
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      
      const url = 'https://api.openai.com/v1/embeddings';
      const requestBody = {
        input: batch,
        model: 'text-embedding-3-small',
        encoding_format: 'float',
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.openai_api_key}`,
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(this.config.timeout_ms),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`OpenAI API error: ${response.status} ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json();
      
      if (!data.data || !Array.isArray(data.data)) {
        throw new Error('Invalid response from OpenAI API');
      }

      const batchEmbeddings = data.data.map((item: any) => item.embedding);
      allEmbeddings.push(...batchEmbeddings);
    }

    return {
      embeddings: allEmbeddings,
      provider: 'openai',
    };
  }

  /**
   * Cache operations
   */
  private async getCachedEmbedding(cacheKey: string): Promise<{ embedding: number[]; provider: string } | null> {
    // Check in-memory cache first
    const memoryCache = this.cache.get(cacheKey);
    if (memoryCache && Date.now() - memoryCache.timestamp < this.config.cache_ttl_seconds * 1000) {
      return { embedding: memoryCache.embedding, provider: memoryCache.provider };
    }

    // Check Redis cache
    if (this.redis) {
      try {
        const cached = await this.redis.get(`embedding:${cacheKey}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          // Update in-memory cache
          this.cache.set(cacheKey, {
            embedding: parsed.embedding,
            timestamp: Date.now(),
            provider: parsed.provider,
          });
          return { embedding: parsed.embedding, provider: parsed.provider };
        }
      } catch (error) {
        logger.warn('Failed to get cached embedding from Redis', { error });
      }
    }

    return null;
  }

  private async cacheEmbedding(cacheKey: string, embedding: number[], provider: string): Promise<void> {
    // Update in-memory cache
    this.cache.set(cacheKey, {
      embedding,
      timestamp: Date.now(),
      provider,
    });

    // Update Redis cache
    if (this.redis) {
      try {
        await this.redis.set(
          `embedding:${cacheKey}`,
          JSON.stringify({ embedding, provider }),
          this.config.cache_ttl_seconds
        );
      } catch (error) {
        logger.warn('Failed to cache embedding in Redis', { error });
      }
    }
  }

  /**
   * Utility methods
   */
  private normalizeText(text: string): string {
    return text.trim().replace(/\s+/g, ' ').substring(0, this.config.max_tokens);
  }

  private getCacheKey(text: string): string {
    // Create a hash of the normalized text for caching
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    return Array.from(data).map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
  }

  private calculateSimilarity(embedding1: number[], embedding2: number[], method: 'cosine' | 'dot_product' | 'euclidean'): number {
    if (embedding1.length !== embedding2.length) {
      throw new Error('Embeddings must have the same length');
    }

    switch (method) {
      case 'cosine':
        return this.cosineSimilarity(embedding1, embedding2);
      case 'dot_product':
        return this.dotProduct(embedding1, embedding2);
      case 'euclidean':
        return 1 / (1 + this.euclideanDistance(embedding1, embedding2));
      default:
        throw new Error(`Unsupported similarity method: ${method}`);
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    const dotProduct = this.dotProduct(a, b);
    const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
    
    if (magnitudeA === 0 || magnitudeB === 0) {
      return 0;
    }
    
    return dotProduct / (magnitudeA * magnitudeB);
  }

  private dotProduct(a: number[], b: number[]): number {
    return a.reduce((sum, val, i) => sum + val * b[i], 0);
  }

  private euclideanDistance(a: number[], b: number[]): number {
    const squaredDiffs = a.map((val, i) => Math.pow(val - b[i], 2));
    return Math.sqrt(squaredDiffs.reduce((sum, val) => sum + val, 0));
  }

  private getConfigFromEnv(): Partial<EmbeddingConfig> {
    return {
      provider: (process.env.EMBEDDINGS_PROVIDER as any) || 'auto',
      openai_api_key: process.env.OPENAI_API_KEY,
      python_bridge_url: process.env.PYTHON_BRIDGE_URL || 'http://localhost:8001',
      model_name: process.env.EMBEDDING_MODEL || 'BAAI/bge-m3',
      cache_enabled: process.env.EMBEDDING_CACHE_ENABLED !== 'false',
    };
  }

  /**
   * Health check for embedding service
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    providers: Record<string, { available: boolean; latency_ms?: number; error?: string }>;
    cache_stats: { memory_entries: number; redis_available: boolean };
  }> {
    const providerStatus: Record<string, { available: boolean; latency_ms?: number; error?: string }> = {};

    // Test local provider
    try {
      const startTime = Date.now();
      await this.getEmbeddingFromLocal('test', startTime);
      providerStatus['bge-m3'] = {
        available: true,
        latency_ms: Date.now() - startTime,
      };
    } catch (error) {
      providerStatus['bge-m3'] = {
        available: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    // Test OpenAI provider
    if (this.config.openai_api_key) {
      try {
        const startTime = Date.now();
        await this.getEmbeddingFromOpenAI('test', startTime);
        providerStatus['openai'] = {
          available: true,
          latency_ms: Date.now() - startTime,
        };
      } catch (error) {
        providerStatus['openai'] = {
          available: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    } else {
      providerStatus['openai'] = {
        available: false,
        error: 'API key not configured',
      };
    }

    // Determine overall status
    const availableProviders = Object.values(providerStatus).filter(p => p.available).length;
    let status: 'healthy' | 'degraded' | 'unhealthy';
    
    if (availableProviders === 0) {
      status = 'unhealthy';
    } else if (availableProviders === 1 && Object.keys(providerStatus).length > 1) {
      status = 'degraded';
    } else {
      status = 'healthy';
    }

    return {
      status,
      providers: providerStatus,
      cache_stats: {
        memory_entries: this.cache.size,
        redis_available: !!this.redis,
      },
    };
  }
}
