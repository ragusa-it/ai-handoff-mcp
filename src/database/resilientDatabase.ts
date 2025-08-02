import { Pool, PoolConfig } from 'pg';
import { createClient, RedisClientType, RedisClientOptions } from 'redis';
import { databaseConfig, redisConfig } from '../config/index.js';
import { errorHandler, ErrorCategory, ErrorSeverity, defaultRecoveryConfigs } from '../services/errorHandler.js';
import { gracefulDegradation, ServicePriority } from '../services/gracefulDegradation.js';
import { structuredLogger } from '../services/structuredLogger.js';
import { 
  createSessionsTable, 
  createContextHistoryTable, 
  createCodebaseSnapshotsTable, 
  createHandoffRequestsTable,
  createSessionLifecycleTable,
  createSystemMetricsTable,
  createPerformanceLogsTable,
  createAnalyticsAggregationsTable,
  createRecoveryCheckpointsTable,
  createRecoveryBackupsTable,
  createIndexes,
  createTriggers,
  createEnhancedTriggers,
  createMonitoringViews,
} from './schema.js';

// Connection pool configuration
interface ResilientPoolConfig extends PoolConfig {
  maxReconnectAttempts?: number;
  reconnectDelayMs?: number;
  connectionHealthCheckMs?: number;
  idleTimeoutMs?: number;
  acquireTimeoutMs?: number;
}

// Redis cluster configuration
interface ResilientRedisConfig extends RedisClientOptions {
  clusters?: Array<{ host: string; port: number }>;
  enableFailover?: boolean;
  failoverTimeout?: number;
  maxReconnectAttempts?: number;
  reconnectDelayMs?: number;
}

// Connection health status
interface ConnectionHealth {
  connected: boolean;
  lastHealthCheck: Date;
  consecutiveFailures: number;
  totalConnections?: number;
  activeConnections?: number;
  idleConnections?: number;
  avgResponseTime?: number;
}

/**
 * Resilient Database Manager with automatic failover and recovery
 */
export class ResilientDatabaseManager {
  private pgPool: Pool;
  private redisClient: RedisClientType;
  private redisBackupClients: RedisClientType[] = [];
  private isInitialized = false;
  private pgHealth: ConnectionHealth = {
    connected: false,
    lastHealthCheck: new Date(),
    consecutiveFailures: 0
  };
  private redisHealth: ConnectionHealth = {
    connected: false,
    lastHealthCheck: new Date(),
    consecutiveFailures: 0
  };
  private healthCheckInterval?: NodeJS.Timeout;
  private readonly HEALTH_CHECK_INTERVAL = 30000; // 30 seconds
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  // Remove unused constant to satisfy TS6133
  // private readonly MAX_RECONNECT_ATTEMPTS = 5;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  // Remove unused constant to satisfy TS6133
  // private readonly RECONNECT_DELAY_MS = 5000;
  
  constructor(
    private pgConfig: ResilientPoolConfig = {},
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private /* unused */ _redisConf: ResilientRedisConfig = {}
  ) {
    // Enhanced PostgreSQL pool configuration
    const poolConfig: ResilientPoolConfig = {
      ...databaseConfig,
      ...pgConfig,
      max: pgConfig.max || 20,
      min: pgConfig.min || 5,
      idleTimeoutMs: pgConfig.idleTimeoutMs || 30000,
      connectionTimeoutMillis: (pgConfig as any).connectionTimeoutMillis ?? 10000,
      acquireTimeoutMs: pgConfig.acquireTimeoutMs || 5000,
      statement_timeout: pgConfig.statement_timeout || 30000,
      query_timeout: pgConfig.query_timeout || 30000
    };
    
    this.pgPool = new Pool(poolConfig);
    this.setupPostgreSQLEventHandlers();
    
    // Enhanced Redis configuration
    const redisConfiguration: ResilientRedisConfig = {
      ...redisConfig,
      ...this._redisConf
    };
    
    this.redisClient = createClient(redisConfiguration) as RedisClientType;
    this.setupRedisEventHandlers();
    
    // Setup backup Redis instances if configured
    this.setupRedisBackupInstances(this._redisConf);
  }
  
  /**
   * Initialize database connections with enhanced error handling
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    
    const initResult = await errorHandler.handleWithRecovery(
      async () => {
        // Initialize PostgreSQL
        await this.initializePostgreSQL();
        
        // Initialize Redis
        await this.initializeRedis();
        
        // Register services for graceful degradation
        this.registerServicesForDegradation();
        
        // Start health monitoring
        this.startHealthMonitoring();
        
        this.isInitialized = true;
        
        structuredLogger.info('Resilient database manager initialized successfully', {
          timestamp: new Date(),
          metadata: {
            postgresConnected: this.pgHealth.connected,
            redisConnected: this.redisHealth.connected,
            backupInstances: this.redisBackupClients.length
          }
        });
      },
      {
        ...defaultRecoveryConfigs.database,
        maxRetries: 5,
        initialDelayMs: 2000
      },
      {
        category: ErrorCategory.SYSTEM,
        severity: ErrorSeverity.CRITICAL,
        component: 'ResilientDatabaseManager',
        operation: 'initialize'
      }
    );
    
    if (!initResult.success) {
      throw initResult.error || new Error('Database initialization failed');
    }
  }
  
  /**
   * Initialize PostgreSQL with enhanced error handling
   */
  private async initializePostgreSQL(): Promise<void> {
    try {
      // Test connection
      const client = await this.pgPool.connect();
      await client.query('SELECT NOW()');
      client.release();
      
      // Initialize schema
      await this.initializeSchema();
      
      this.pgHealth.connected = true;
      this.pgHealth.consecutiveFailures = 0;
      
      structuredLogger.info('PostgreSQL initialized successfully', {
        timestamp: new Date(),
        metadata: {
          host: this.pgConfig.host,
          port: this.pgConfig.port,
          database: this.pgConfig.database
        }
      });
    } catch (error) {
      this.pgHealth.connected = false;
      this.pgHealth.consecutiveFailures++;
      throw error;
    }
  }
  
  /**
   * Initialize Redis with enhanced error handling
   */
  private async initializeRedis(): Promise<void> {
    try {
      await this.redisClient.connect();
      await this.redisClient.ping();
      
      this.redisHealth.connected = true;
      this.redisHealth.consecutiveFailures = 0;
      
      structuredLogger.info('Redis initialized successfully');
      
      // Initialize backup Redis instances
      for (let i = 0; i < this.redisBackupClients.length; i++) {
        try {
          await this.redisBackupClients[i].connect();
          structuredLogger.info(`Redis backup instance ${i + 1} connected`);
        } catch (error) {
          structuredLogger.logWarning(`Failed to connect to Redis backup instance ${i + 1}`, {
            timestamp: new Date(),
            warningType: 'Resource',
            component: 'ResilientDatabaseManager',
            metadata: {
              backupIndex: i + 1,
              error: error instanceof Error ? error.message : String(error)
            }
          });
        }
      }
    } catch (error) {
      this.redisHealth.connected = false;
      this.redisHealth.consecutiveFailures++;
      throw error;
    }
  }
  
  /**
   * Setup PostgreSQL event handlers
   */
  private setupPostgreSQLEventHandlers(): void {
    this.pgPool.on('connect', (_client) => {
      this.pgHealth.connected = true;
      this.pgHealth.consecutiveFailures = 0;
      structuredLogger.info('PostgreSQL client connected');
    });
    
    this.pgPool.on('error', (error, _client) => {
      this.pgHealth.consecutiveFailures++;
      const errorObj = error instanceof Error ? error : new Error(String(error));
      structuredLogger.logError(errorObj, {
        timestamp: new Date(),
        errorType: 'DatabaseError',
        component: 'ResilientDatabaseManager',
        operation: 'pool_error',
        additionalInfo: {
          error: errorObj.message,
          consecutiveFailures: this.pgHealth.consecutiveFailures
        }
      });
      
      // Attempt recovery if multiple consecutive failures
      if (this.pgHealth.consecutiveFailures >= 3) {
        this.attemptPostgreSQLRecovery();
      }
    });
    
    this.pgPool.on('remove', (_client) => {
      structuredLogger.info('PostgreSQL client removed from pool');
    });
  }
  
  /**
   * Setup Redis event handlers
   */
  private setupRedisEventHandlers(): void {
    this.redisClient.on('connect', () => {
      this.redisHealth.connected = true;
      this.redisHealth.consecutiveFailures = 0;
      structuredLogger.info('Redis client connected');
    });
    
    this.redisClient.on('error', (error) => {
      this.redisHealth.consecutiveFailures++;
      const errorObj = error instanceof Error ? error : new Error(String(error));
      structuredLogger.logError(errorObj, {
        timestamp: new Date(),
        errorType: 'RedisError',
        component: 'ResilientDatabaseManager',
        operation: 'client_error',
        additionalInfo: {
          error: errorObj.message,
          consecutiveFailures: this.redisHealth.consecutiveFailures
        }
      });
    });
    
    this.redisClient.on('reconnecting', () => {
      structuredLogger.info('Redis client reconnecting');
    });
    
    this.redisClient.on('end', () => {
      this.redisHealth.connected = false;
      structuredLogger.logWarning('Redis client connection ended', {
        timestamp: new Date(),
        warningType: 'Resource',
        component: 'ResilientDatabaseManager'
      });
    });
  }
  
  /**
   * Setup Redis backup instances
   */
  private setupRedisBackupInstances(config: ResilientRedisConfig): void {
    if (!config.clusters || !config.enableFailover) return;
    
    for (const cluster of config.clusters) {
      const backupConfig: RedisClientOptions = {
        ...config,
        socket: {
          ...config.socket,
          host: cluster.host,
          port: cluster.port
        }
      };
      
      const backupClient = createClient(backupConfig) as RedisClientType;
      this.redisBackupClients.push(backupClient);
      
      backupClient.on('error', (error) => {
        structuredLogger.logWarning('Redis backup instance error', {
          timestamp: new Date(),
          warningType: 'Resource',
          component: 'ResilientDatabaseManager',
          metadata: {
            host: cluster.host,
            port: cluster.port,
            error: error.message
          }
        });
      });
    }
  }
  
  /**
   * Register services for graceful degradation
   */
  private registerServicesForDegradation(): void {
    // Register PostgreSQL as critical service
    gracefulDegradation.registerService({
      service: 'postgresql',
      priority: ServicePriority.CRITICAL,
      failureThreshold: 3,
      recoveryThreshold: 1,
      checkIntervalMs: 30000,
      disableOnDegradation: false,
      healthCheckFunction: async () => {
        try {
          const client = await this.pgPool.connect();
          await client.query('SELECT 1');
          client.release();
          return true;
        } catch {
          return false;
        }
      }
    });
    
    // Register Redis as important service (can fallback to in-memory cache)
    gracefulDegradation.registerService({
      service: 'redis',
      priority: ServicePriority.IMPORTANT,
      failureThreshold: 2,
      recoveryThreshold: 1,
      checkIntervalMs: 15000,
      disableOnDegradation: false,
      healthCheckFunction: async () => {
        try {
          await this.redisClient.ping();
          return true;
        } catch {
          return false;
        }
      },
      fallbackFunction: async () => {
        // Fallback to in-memory cache (simplified)
        return { status: 'fallback_active', method: 'in_memory' };
      }
    });
  }
  
  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthCheck();
    }, this.HEALTH_CHECK_INTERVAL);
  }
  
  /**
   * Perform comprehensive health check
   */
  private async performHealthCheck(): Promise<void> {
    const startTime = Date.now();
    
    // Check PostgreSQL health
    try {
      const client = await this.pgPool.connect();
      await client.query('SELECT 1');
      client.release();
      
      this.pgHealth.lastHealthCheck = new Date();
      this.pgHealth.avgResponseTime = Date.now() - startTime;
      this.pgHealth.totalConnections = this.pgPool.totalCount;
      this.pgHealth.activeConnections = this.pgPool.totalCount - this.pgPool.idleCount;
      this.pgHealth.idleConnections = this.pgPool.idleCount;
      
      if (!this.pgHealth.connected) {
        this.pgHealth.connected = true;
        this.pgHealth.consecutiveFailures = 0;
        structuredLogger.info('PostgreSQL health recovered');
      }
    } catch (error) {
      this.pgHealth.connected = false;
      this.pgHealth.consecutiveFailures++;
      this.pgHealth.lastHealthCheck = new Date();
      
      const errorObj = error instanceof Error ? error : new Error(String(error));
      structuredLogger.logError(errorObj, {
        timestamp: new Date(),
        errorType: 'DatabaseError',
        component: 'ResilientDatabaseManager',
        operation: 'healthCheck',
        additionalInfo: {
          consecutiveFailures: this.pgHealth.consecutiveFailures
        }
      });
    }
    
    // Check Redis health
    try {
      await this.redisClient.ping();
      
      this.redisHealth.lastHealthCheck = new Date();
      
      if (!this.redisHealth.connected) {
        this.redisHealth.connected = true;
        this.redisHealth.consecutiveFailures = 0;
        structuredLogger.info('Redis health recovered');
      }
    } catch (error) {
      this.redisHealth.connected = false;
      this.redisHealth.consecutiveFailures++;
      this.redisHealth.lastHealthCheck = new Date();
      
      const errorObj = error instanceof Error ? error : new Error(String(error));
      structuredLogger.logError(errorObj, {
        timestamp: new Date(),
        errorType: 'RedisError',
        component: 'ResilientDatabaseManager',
        operation: 'healthCheck',
        additionalInfo: {
          consecutiveFailures: this.redisHealth.consecutiveFailures
        }
      });
      
      // Try backup Redis instances
      await this.tryRedisFailover();
    }
  }
  
  /**
   * Attempt PostgreSQL recovery
   */
  private async attemptPostgreSQLRecovery(): Promise<void> {
    structuredLogger.info('Attempting PostgreSQL recovery');
    
    try {
      // End the current pool and create a new one
      await this.pgPool.end();
      
      const poolConfig: ResilientPoolConfig = {
        ...databaseConfig,
        ...this.pgConfig,
        max: this.pgConfig.max || 20,
        min: this.pgConfig.min || 5
      };
      
      this.pgPool = new Pool(poolConfig);
      this.setupPostgreSQLEventHandlers();
      
      // Test the new connection
      const client = await this.pgPool.connect();
      await client.query('SELECT 1');
      client.release();
      
      this.pgHealth.connected = true;
      this.pgHealth.consecutiveFailures = 0;
      
      structuredLogger.info('PostgreSQL recovery successful');
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      structuredLogger.logError(errorObj, {
        timestamp: new Date(),
        errorType: 'DatabaseError',
        component: 'ResilientDatabaseManager',
        operation: 'recovery',
        additionalInfo: {
          error: errorObj.message
        }
      });
    }
  }
  
  /**
   * Try Redis failover to backup instances
   */
  private async tryRedisFailover(): Promise<void> {
    if (this.redisBackupClients.length === 0) return;
    
    for (let i = 0; i < this.redisBackupClients.length; i++) {
      try {
        await this.redisBackupClients[i].ping();
        
        // Swap primary and backup
        const oldPrimary = this.redisClient;
        this.redisClient = this.redisBackupClients[i];
        this.redisBackupClients[i] = oldPrimary;
        
        this.redisHealth.connected = true;
        this.redisHealth.consecutiveFailures = 0;
        
        structuredLogger.info('Redis failover successful', {
          timestamp: new Date(),
          metadata: {
            newPrimaryIndex: i
          }
        });
        
        return;
      } catch (error) {
        structuredLogger.logWarning(`Redis backup instance ${i} also unhealthy`, {
          timestamp: new Date(),
          warningType: 'Resource',
          component: 'ResilientDatabaseManager',
          metadata: {
            backupIndex: i,
            error: error instanceof Error ? error.message : String(error)
          }
        });
      }
    }
    
    const error = new Error('All Redis instances are unhealthy');
    structuredLogger.logError(error, {
      timestamp: new Date(),
      errorType: 'RedisError',
      component: 'ResilientDatabaseManager',
      operation: 'redis_failover'
    });
  }
  
  /**
   * Execute database query with resilience
   */
  async query<T = any>(text: string, params?: any[]): Promise<{ rows: T[]; rowCount: number }> {
    const queryResult = await errorHandler.handleWithRecovery(
      async () => {
        const client = await this.pgPool.connect();
        try {
          const result = await client.query(text, params);
          return {
            rows: result.rows,
            rowCount: result.rowCount || 0
          };
        } finally {
          client.release();
        }
      },
      defaultRecoveryConfigs.database,
      {
        category: ErrorCategory.SYSTEM,
        severity: ErrorSeverity.HIGH,
        component: 'ResilientDatabaseManager',
        operation: 'query'
      }
    );
    
    if (!queryResult.success) {
      throw queryResult.error || new Error('Database query failed');
    }
    
    return queryResult.result;
  }
  
  /**
   * Execute Redis command with resilience and fallback
   */
  async redisCommand<T>(
    command: (client: RedisClientType) => Promise<T>,
    fallbackValue?: T
  ): Promise<T> {
    const commandResult = await gracefulDegradation.executeWithDegradation(
      'redis',
      () => command(this.redisClient),
      fallbackValue
    );
    
    if (!commandResult.success && !commandResult.fallbackUsed) {
      throw commandResult.error || new Error('Redis command failed');
    }
    
    return commandResult.result as T;
  }
  
  /**
   * Get connection health status
   */
  getHealthStatus(): {
    postgresql: ConnectionHealth;
    redis: ConnectionHealth;
    backupRedisInstances: number;
    overallHealth: 'healthy' | 'degraded' | 'unhealthy';
  } {
    let overallHealth: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    
    if (!this.pgHealth.connected) {
      overallHealth = 'unhealthy';
    } else if (!this.redisHealth.connected) {
      overallHealth = 'degraded';
    }
    
    return {
      postgresql: { ...this.pgHealth },
      redis: { ...this.redisHealth },
      backupRedisInstances: this.redisBackupClients.length,
      overallHealth
    };
  }
  
  /**
   * Initialize database schema with error handling
   */
  private async initializeSchema(): Promise<void> {
    const client = await this.pgPool.connect();
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
      
      // Recovery tables
      await client.query(createRecoveryCheckpointsTable);
      await client.query(createRecoveryBackupsTable);
      
      await client.query(createIndexes);
      await client.query(createTriggers);
      await client.query(createEnhancedTriggers);
      await client.query(createMonitoringViews);
      
      await client.query('COMMIT');
      structuredLogger.info('Database schema initialized successfully');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    try {
      await this.pgPool.end();
      await this.redisClient.quit();
      
      for (const backupClient of this.redisBackupClients) {
        try {
          await backupClient.quit();
        } catch (error) {
          // Ignore errors during shutdown
        }
      }
      
      this.isInitialized = false;
      structuredLogger.info('Resilient database manager shut down gracefully');
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      structuredLogger.logError(errorObj, {
        timestamp: new Date(),
        errorType: 'SystemError',
        component: 'ResilientDatabaseManager',
        operation: 'shutdown',
        additionalInfo: {
          error: errorObj.message
        }
      });
    }
  }
}

// Export singleton instance
export const resilientDb = new ResilientDatabaseManager();