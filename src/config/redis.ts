import Redis, { RedisOptions } from 'ioredis';
import { logger } from '../services/structuredLogger.js';

export interface RedisConfig extends RedisOptions {
  host: string;
  port: number;
  password?: string;
  db?: number;
  keyPrefix?: string;
  retryDelayOnFailover?: number;
  maxRetriesPerRequest?: number;
  lazyConnect?: boolean;
}

export class RedisManager {
  private client: Redis;
  private subscriber: Redis;
  private publisher: Redis;
  private static instance: RedisManager;

  constructor(config: RedisConfig) {
    const baseConfig = {
      ...config,
      lazyConnect: true,
      retryDelayOnFailover: config.retryDelayOnFailover || 100,
      maxRetriesPerRequest: config.maxRetriesPerRequest || 3,
      keyPrefix: config.keyPrefix || 'handoff:',
    };

    this.client = new Redis(baseConfig);
    this.subscriber = new Redis(baseConfig);
    this.publisher = new Redis(baseConfig);

    this.setupEventHandlers();
  }

  static getInstance(config?: RedisConfig): RedisManager {
    if (!RedisManager.instance) {
      if (!config) {
        throw new Error('Redis config required for first initialization');
      }
      RedisManager.instance = new RedisManager(config);
    }
    return RedisManager.instance;
  }

  private setupEventHandlers(): void {
    this.client.on('connect', () => {
      logger.info('Redis client connected');
    });

    this.client.on('error', (error) => {
      logger.error('Redis client error', { error });
    });

    this.client.on('close', () => {
      logger.warn('Redis client connection closed');
    });

    this.subscriber.on('error', (error) => {
      logger.error('Redis subscriber error', { error });
    });

    this.publisher.on('error', (error) => {
      logger.error('Redis publisher error', { error });
    });
  }

  async connect(): Promise<void> {
    try {
      await Promise.all([
        this.client.connect(),
        this.subscriber.connect(),
        this.publisher.connect(),
      ]);
      logger.info('All Redis connections established');
    } catch (error) {
      logger.error('Failed to connect to Redis', { error });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    await Promise.all([
      this.client.disconnect(),
      this.subscriber.disconnect(),
      this.publisher.disconnect(),
    ]);
    logger.info('All Redis connections closed');
  }

  // Main client for general operations
  getClient(): Redis {
    return this.client;
  }

  // Subscriber for pub/sub operations
  getSubscriber(): Redis {
    return this.subscriber;
  }

  // Publisher for pub/sub operations
  getPublisher(): Redis {
    return this.publisher;
  }

  // Cache operations
  async set(key: string, value: any, ttl?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    if (ttl) {
      await this.client.setex(key, ttl, serialized);
    } else {
      await this.client.set(key, serialized);
    }
  }

  async get<T = any>(key: string): Promise<T | null> {
    const value = await this.client.get(key);
    return value ? JSON.parse(value) : null;
  }

  async del(key: string): Promise<number> {
    return this.client.del(key);
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result === 1;
  }

  // Hash operations for structured data
  async hset(key: string, field: string, value: any): Promise<void> {
    await this.client.hset(key, field, JSON.stringify(value));
  }

  async hget<T = any>(key: string, field: string): Promise<T | null> {
    const value = await this.client.hget(key, field);
    return value ? JSON.parse(value) : null;
  }

  async hgetall<T = any>(key: string): Promise<Record<string, T>> {
    const data = await this.client.hgetall(key);
    const result: Record<string, T> = {};
    
    for (const [field, value] of Object.entries(data)) {
      result[field] = JSON.parse(value);
    }
    
    return result;
  }

  // List operations for queues
  async lpush(key: string, ...values: any[]): Promise<number> {
    const serialized = values.map(v => JSON.stringify(v));
    return this.client.lpush(key, ...serialized);
  }

  async rpop<T = any>(key: string): Promise<T | null> {
    const value = await this.client.rpop(key);
    return value ? JSON.parse(value) : null;
  }

  async llen(key: string): Promise<number> {
    return this.client.llen(key);
  }

  // Sorted set operations for priority queues
  async zadd(key: string, score: number, member: any): Promise<number> {
    return this.client.zadd(key, score, JSON.stringify(member));
  }

  async zpopmin<T = any>(key: string, count = 1): Promise<T[]> {
    const results = await this.client.zpopmin(key, count);
    const items: T[] = [];
    
    for (let i = 0; i < results.length; i += 2) {
      items.push(JSON.parse(results[i]));
    }
    
    return items;
  }

  // Pub/Sub operations
  async publish(channel: string, message: any): Promise<number> {
    return this.publisher.publish(channel, JSON.stringify(message));
  }

  async subscribe(channel: string, callback: (message: any) => void): Promise<void> {
    await this.subscriber.subscribe(channel);
    this.subscriber.on('message', (receivedChannel, message) => {
      if (receivedChannel === channel) {
        try {
          const parsed = JSON.parse(message);
          callback(parsed);
        } catch (error) {
          logger.error('Failed to parse pub/sub message', { channel, message, error });
        }
      }
    });
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch (error) {
      logger.error('Redis health check failed', { error });
      return false;
    }
  }

  // Job queue specific operations
  async enqueueJob(queueName: string, jobData: any, priority = 0): Promise<void> {
    const job = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      data: jobData,
      enqueuedAt: new Date().toISOString(),
      attempts: 0,
      maxAttempts: 3,
    };

    await this.zadd(`queue:${queueName}`, priority, job);
    await this.publish(`queue:${queueName}:new`, { jobId: job.id });
  }

  async dequeueJob<T = any>(queueName: string): Promise<T | null> {
    const jobs = await this.zpopmin(`queue:${queueName}`, 1);
    return jobs.length > 0 ? jobs[0] : null;
  }

  async getQueueLength(queueName: string): Promise<number> {
    return this.client.zcard(`queue:${queueName}`);
  }

  // Session and context caching
  async cacheSession(sessionKey: string, data: any, ttl = 3600): Promise<void> {
    await this.set(`session:${sessionKey}`, data, ttl);
  }

  async getCachedSession<T = any>(sessionKey: string): Promise<T | null> {
    return this.get(`session:${sessionKey}`);
  }

  async cacheContext(sessionKey: string, contextData: any, ttl = 1800): Promise<void> {
    await this.set(`context:${sessionKey}`, contextData, ttl);
  }

  async getCachedContext<T = any>(sessionKey: string): Promise<T | null> {
    return this.get(`context:${sessionKey}`);
  }

  // Memory caching for vector search results
  async cacheMemorySearch(query: string, results: any[], ttl = 600): Promise<void> {
    const key = `memory_search:${Buffer.from(query).toString('base64')}`;
    await this.set(key, results, ttl);
  }

  async getCachedMemorySearch<T = any[]>(query: string): Promise<T | null> {
    const key = `memory_search:${Buffer.from(query).toString('base64')}`;
    return this.get(key);
  }
}

// Initialize Redis from environment
export function createRedisFromEnv(): RedisManager {
  const config: RedisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0'),
    keyPrefix: process.env.REDIS_KEY_PREFIX || 'handoff:',
    retryDelayOnFailover: parseInt(process.env.REDIS_RETRY_DELAY || '100'),
    maxRetriesPerRequest: parseInt(process.env.REDIS_MAX_RETRIES || '3'),
  };

  return RedisManager.getInstance(config);
}
