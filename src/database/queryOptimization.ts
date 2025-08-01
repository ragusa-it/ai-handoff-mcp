// Query optimization implementation with prepared statement caching
import { Pool, QueryResult, QueryResultRow } from 'pg';
import { performance } from 'perf_hooks';

// Type definitions
interface PreparedStatement {
  name: string;
  query: string;
  values: any[];
  lastUsed: number;
  hitCount: number;
}

interface QueryPlan {
  query: string;
  plan: any;
  executionTime: number;
  cost: number;
}

// Prepared statement cache
class PreparedStatementCache {
  private cache: Map<string, PreparedStatement> = new Map();
  private maxSize: number;
  private ttl: number; // Time to live in milliseconds

  constructor(maxSize: number = 100, ttl: number = 300000) { // 5 minutes default TTL
    this.maxSize = maxSize;
    this.ttl = ttl;
  }

  // Get cached prepared statement
  get(key: string): PreparedStatement | undefined {
    const statement = this.cache.get(key);
    if (statement) {
      // Check if statement is expired
      if (Date.now() - statement.lastUsed > this.ttl) {
        this.cache.delete(key);
        return undefined;
      }
      
      // Update usage statistics
      statement.lastUsed = Date.now();
      statement.hitCount++;
      return statement;
    }
    return undefined;
  }

  // Set prepared statement in cache
  set(key: string, statement: PreparedStatement): void {
    // Evict oldest entries if cache is full
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }
    
    this.cache.set(key, statement);
  }

  // Evict oldest cached statement
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    
    for (const [key, statement] of this.cache.entries()) {
      if (statement.lastUsed < oldestTime) {
        oldestTime = statement.lastUsed;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }

  // Clear expired statements
  clearExpired(): void {
    const now = Date.now();
    for (const [key, statement] of this.cache.entries()) {
      if (now - statement.lastUsed > this.ttl) {
        this.cache.delete(key);
      }
    }
  }

  // Get cache statistics
  getStats(): { size: number; hitRate: number; totalHits: number } {
    let totalHits = 0;
    for (const statement of this.cache.values()) {
      totalHits += statement.hitCount;
    }
    
    return {
      size: this.cache.size,
      hitRate: this.cache.size > 0 ? totalHits / this.cache.size : 0,
      totalHits
    };
  }
}

// Query optimizer
export class QueryOptimizer {
  private pool: Pool;
  private statementCache: PreparedStatementCache;
  private queryPlans: Map<string, QueryPlan> = new Map();
  private enableCaching: boolean;

  constructor(pool: Pool, enableCaching: boolean = true) {
    this.pool = pool;
    this.enableCaching = enableCaching;
    this.statementCache = new PreparedStatementCache(100, 300000); // 100 max, 5 min TTL
    
    // Periodically clean expired cache entries
    setInterval(() => {
      this.statementCache.clearExpired();
    }, 60000); // Every minute
  }

  // Execute optimized query with prepared statement caching
  async executeQuery<T extends QueryResultRow>(query: string, values: any[] = []): Promise<QueryResult<T>> {
    const startTime = performance.now();
    
    try {
      // Generate cache key
      const cacheKey = this.generateCacheKey(query, values);
      
      if (this.enableCaching) {
        // Check if we have a cached prepared statement
        const cachedStatement = this.statementCache.get(cacheKey);
        
        if (cachedStatement) {
          // Use cached prepared statement
          const result = await this.pool.query(cachedStatement.query, cachedStatement.values);
          const executionTime = performance.now() - startTime;
          
          // Log performance metrics
          this.logPerformance(query, executionTime, true);
          
          return result;
        } else {
          // Prepare new statement and cache it
          const preparedQuery = `PREPARE ${cacheKey} AS ${query}`;
          await this.pool.query(preparedQuery);
          
          // Cache the prepared statement
          const statement: PreparedStatement = {
            name: cacheKey,
            query: `EXECUTE ${cacheKey}`,
            values: values,
            lastUsed: Date.now(),
            hitCount: 0
          };
          
          this.statementCache.set(cacheKey, statement);
          
          // Execute the prepared statement
          const result = await this.pool.query(statement.query, statement.values);
          const executionTime = performance.now() - startTime;
          
          // Log performance metrics
          this.logPerformance(query, executionTime, false);
          
          return result;
        }
      } else {
        // Execute without caching
        const result = await this.pool.query(query, values);
        const executionTime = performance.now() - startTime;
        
        // Log performance metrics
        this.logPerformance(query, executionTime, false);
        
        return result;
      }
    } catch (error) {
      // Log error
      console.error(`Query execution failed: ${error}`);
      throw error;
    }
  }

  // Generate cache key for prepared statements
  private generateCacheKey(query: string, values: any[]): string {
    // Create a hash of the query and values for cache key
    const queryHash = this.simpleHash(query);
    const valuesHash = this.simpleHash(JSON.stringify(values));
    return `stmt_${queryHash}_${valuesHash}`;
  }

  // Simple hash function for cache keys
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }

  // Log performance metrics
  private logPerformance(query: string, executionTime: number, wasCached: boolean): void {
    // In a real implementation, this would send metrics to a monitoring system
    console.debug(`Query performance: ${executionTime.toFixed(2)}ms, cached: ${wasCached}, query: ${query.substring(0, 100)}...`);
  }

  // Get cache statistics
  getCacheStats(): { size: number; hitRate: number; totalHits: number } {
    return this.statementCache.getStats();
  }

  // Clear cache
  clearCache(): void {
    this.statementCache = new PreparedStatementCache(100, 300000);
    this.queryPlans.clear();
  }

  // Analyze query plan
  async analyzeQuery(query: string, values: any[] = []): Promise<any> {
    try {
      // Use EXPLAIN to get query plan
      const explainQuery = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`;
      const result = await this.pool.query(explainQuery, values);
      
      // Store query plan for optimization
      const planKey = this.generateCacheKey(query, values);
      const plan: QueryPlan = {
        query: query,
        plan: result.rows,
        executionTime: 0, // Would be set from actual execution
        cost: this.extractCostFromPlan(result.rows)
      };
      
      this.queryPlans.set(planKey, plan);
      
      return result.rows;
    } catch (error) {
      console.error(`Query analysis failed: ${error}`);
      throw error;
    }
  }

  // Extract cost from query plan
  private extractCostFromPlan(plan: any[]): number {
    try {
      // Extract cost from PostgreSQL EXPLAIN output
      if (plan && plan[0] && plan[0]['QUERY PLAN']) {
        const planData = plan[0]['QUERY PLAN'];
        if (planData[0] && planData[0].Plan) {
          return planData[0].Plan['Total Cost'] || 0;
        }
      }
      return 0;
    } catch (error) {
      console.warn('Failed to extract cost from query plan:', error);
      return 0;
    }
  }

  // Optimize query based on analysis
  optimizeQuery(query: string, values: any[] = []): string {
    // In a real implementation, this would analyze the query and suggest optimizations
    // For now, we'll just return the original query
    return query;
  }

  // Close optimizer and cleanup resources
  async close(): Promise<void> {
    // Clear cache and cleanup
    this.clearCache();
    
    // Close any prepared statements
    for (const [key] of this.queryPlans.entries()) {
      try {
        await this.pool.query(`DEALLOCATE ${key}`);
      } catch (error) {
        // Ignore errors during cleanup
      }
    }
  }
}

// Connection pool optimizer
export class ConnectionPoolOptimizer {
  private pool: Pool;
  private optimalConfig: any;
  private monitoringInterval: NodeJS.Timeout | null = null;

  constructor(pool: Pool) {
    this.pool = pool;
    this.optimalConfig = {
      min: 5,
      max: 20,
      acquireTimeoutMillis: 30000,
      createTimeoutMillis: 30000,
      destroyTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      reapIntervalMillis: 1000
    };
  }

  // Start monitoring and optimization
  startMonitoring(): void {
    this.monitoringInterval = setInterval(() => {
      this.optimizePool();
    }, 30000); // Check every 30 seconds
  }

  // Stop monitoring
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }

  // Optimize connection pool based on usage patterns
  private optimizePool(): void {
    // Get current pool statistics
    const poolStats = this.getPoolStats();
    
    // Adjust pool size based on usage
    if (poolStats.waiting > 0 && poolStats.available === 0) {
      // Increase pool size if there are waiting connections
      this.increasePoolSize();
    } else if (poolStats.available > poolStats.used * 2) {
      // Decrease pool size if there are many unused connections
      this.decreasePoolSize();
    }
    
    // Log optimization decisions
    console.debug('Pool optimization:', poolStats);
  }

  // Get pool statistics
  private getPoolStats(): { 
    total: number; 
    used: number; 
    available: number; 
    waiting: number 
  } {
    // In a real implementation, this would get actual pool statistics
    // For now, we'll return mock data
    return {
      total: 10,
      used: 5,
      available: 5,
      waiting: 0
    };
  }

  // Increase pool size
  private increasePoolSize(): void {
    // In a real implementation, this would dynamically adjust pool configuration
    console.debug('Increasing pool size');
  }

  // Decrease pool size
  private decreasePoolSize(): void {
    // In a real implementation, this would dynamically adjust pool configuration
    console.debug('Decreasing pool size');
  }

  // Get optimal configuration
  getOptimalConfig(): any {
    return this.optimalConfig;
  }

  // Close optimizer
  close(): void {
    this.stopMonitoring();
  }
}

// Export optimized database client
export interface OptimizedDatabaseClient {
  query: <T extends QueryResultRow = any>(query: string, values?: any[]) => Promise<QueryResult<T>>;
  optimizer: QueryOptimizer;
  poolOptimizer: ConnectionPoolOptimizer;
}

// Create optimized database client
export function createOptimizedDatabaseClient(pool: Pool): OptimizedDatabaseClient {
  const optimizer = new QueryOptimizer(pool);
  const poolOptimizer = new ConnectionPoolOptimizer(pool);
  
  // Start monitoring
  poolOptimizer.startMonitoring();
  
  return {
    query: async <T extends QueryResultRow = any>(query: string, values: any[] = []) => {
      return optimizer.executeQuery<T>(query, values);
    },
    optimizer,
    poolOptimizer
  };
}