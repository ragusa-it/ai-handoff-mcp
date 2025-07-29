import { DatabaseManager } from './index.js';
import { monitoringService } from '../services/monitoringService.js';
import { structuredLogger } from '../services/structuredLogger.js';
import { PerformanceTimer } from '../mcp/utils/performance.js';
import type { Session, ContextHistoryEntry } from './schema.js';

/**
 * Monitored Database Wrapper
 * Wraps all database operations with performance monitoring and alerting
 */
export class MonitoredDatabaseManager extends DatabaseManager {
  private alertThresholds = {
    slowQueryMs: 1000,
    verySlowQueryMs: 5000,
    errorRateThreshold: 0.05 // 5%
  };

  private queryStats = {
    totalQueries: 0,
    totalErrors: 0,
    slowQueries: 0
  };

  /**
   * Wrap database query with monitoring
   */
  async query<T = any>(text: string, params?: any[]): Promise<{ rows: T[]; rowCount: number }> {
    const timer = new PerformanceTimer();
    const queryId = `query_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    let success = true;
    let error: Error | null = null;

    try {
      // Log query start
      structuredLogger.logSystemEvent({
        timestamp: new Date(),
        component: 'MonitoredDatabase',
        operation: 'query_start',
        status: 'started',
        metadata: {
          queryId,
          queryPreview: text.substring(0, 100),
          paramCount: params?.length || 0
        }
      });

      // Execute the query
      const result = await super.query<T>(text, params);
      
      const duration = timer.getElapsed();
      this.queryStats.totalQueries++;

      // Check for slow queries
      if (duration > this.alertThresholds.slowQueryMs) {
        this.queryStats.slowQueries++;
        
        const alertLevel = duration > this.alertThresholds.verySlowQueryMs ? 'critical' : 'warning';
        
        structuredLogger.logWarning(`Slow database query detected (${duration}ms)`, {
          timestamp: new Date(),
          warningType: 'Performance',
          component: 'DatabaseQuery',
          threshold: this.alertThresholds.slowQueryMs,
          currentValue: duration,
          recommendation: 'Consider optimizing query or adding indexes',
          metadata: {
            queryId,
            queryPreview: text.substring(0, 200),
            alertLevel,
            rowCount: result.rowCount
          }
        });

        // Trigger alert for very slow queries
        if (alertLevel === 'critical') {
          await this.triggerSlowQueryAlert(queryId, text, duration, result.rowCount);
        }
      }

      // Record metrics
      monitoringService.recordDatabaseQuery(text, duration, success);

      // Log successful query completion
      structuredLogger.logSystemEvent({
        timestamp: new Date(),
        component: 'MonitoredDatabase',
        operation: 'query_complete',
        status: 'completed',
        metadata: {
          queryId,
          durationMs: duration,
          rowCount: result.rowCount,
          isSlowQuery: duration > this.alertThresholds.slowQueryMs
        }
      });

      return result;
    } catch (err) {
      success = false;
      error = err as Error;
      this.queryStats.totalErrors++;
      
      const duration = timer.getElapsed();

      // Record error metrics
      monitoringService.recordDatabaseQuery(text, duration, success);

      // Log database error
      structuredLogger.logError(error, {
        timestamp: new Date(),
        errorType: 'DatabaseError',
        component: 'MonitoredDatabase',
        operation: 'query',
        additionalInfo: {
          queryId,
          queryPreview: text.substring(0, 200),
          paramCount: params?.length || 0,
          durationMs: duration
        }
      });

      // Check error rate and trigger alerts if needed
      await this.checkErrorRateAndAlert();

      throw error;
    }
  }

  /**
   * Monitored session creation
   */
  async createSession(sessionKey: string, agentFrom: string, metadata: Record<string, any> = {}): Promise<Session> {
    const timer = new PerformanceTimer();
    const operationId = `create_session_${Date.now()}`;

    try {
      structuredLogger.logSystemEvent({
        timestamp: new Date(),
        component: 'MonitoredDatabase',
        operation: 'create_session_start',
        status: 'started',
        metadata: { operationId, sessionKey, agentFrom }
      });

      const session = await super.createSession(sessionKey, agentFrom, metadata);
      const duration = timer.getElapsed();

      // Record performance metrics
      monitoringService.recordPerformanceMetrics('create_session', {
        operation: 'create_session',
        duration,
        success: true,
        metadata: { sessionKey, agentFrom }
      });

      // Log successful session creation
      structuredLogger.logSystemEvent({
        timestamp: new Date(),
        component: 'MonitoredDatabase',
        operation: 'create_session_complete',
        status: 'completed',
        metadata: {
          operationId,
          sessionId: session.id,
          durationMs: duration
        }
      });

      return session;
    } catch (error) {
      const duration = timer.getElapsed();

      // Record error metrics
      monitoringService.recordPerformanceMetrics('create_session', {
        operation: 'create_session',
        duration,
        success: false,
        metadata: { sessionKey, agentFrom, error: (error as Error).message }
      });

      // Log error
      structuredLogger.logError(error as Error, {
        timestamp: new Date(),
        errorType: 'DatabaseError',
        component: 'MonitoredDatabase',
        operation: 'create_session',
        additionalInfo: { operationId, sessionKey, agentFrom }
      });

      throw error;
    }
  }

  /**
   * Monitored session retrieval
   */
  async getSession(sessionKey: string): Promise<Session | null> {
    const timer = new PerformanceTimer();
    const operationId = `get_session_${Date.now()}`;

    try {
      const session = await super.getSession(sessionKey);
      const duration = timer.getElapsed();

      // Record cache hit/miss metrics
      const cacheHit = session !== null;
      monitoringService.recordPerformanceMetrics('get_session', {
        operation: 'get_session',
        duration,
        success: true,
        metadata: { sessionKey, cacheHit, found: session !== null }
      });

      // Log performance metric for session retrieval
      structuredLogger.logPerformanceMetric({
        timestamp: new Date(),
        metricName: 'session_retrieval_duration',
        metricValue: duration,
        metricType: 'timer',
        unit: 'milliseconds',
        tags: { sessionKey, found: (session !== null).toString() }
      });

      return session;
    } catch (error) {
      const duration = timer.getElapsed();

      monitoringService.recordPerformanceMetrics('get_session', {
        operation: 'get_session',
        duration,
        success: false,
        metadata: { sessionKey, error: (error as Error).message }
      });

      structuredLogger.logError(error as Error, {
        timestamp: new Date(),
        errorType: 'DatabaseError',
        component: 'MonitoredDatabase',
        operation: 'get_session',
        additionalInfo: { operationId, sessionKey }
      });

      throw error;
    }
  }

  /**
   * Monitored context entry addition
   */
  async addContextEntry(
    sessionId: string, 
    contextType: ContextHistoryEntry['contextType'], 
    content: string, 
    metadata: Record<string, any> = {}
  ): Promise<ContextHistoryEntry> {
    const timer = new PerformanceTimer();
    const operationId = `add_context_${Date.now()}`;
    const contentSize = Buffer.byteLength(content, 'utf8');

    try {
      structuredLogger.logSystemEvent({
        timestamp: new Date(),
        component: 'MonitoredDatabase',
        operation: 'add_context_start',
        status: 'started',
        metadata: { operationId, sessionId, contextType, contentSize }
      });

      const contextEntry = await super.addContextEntry(sessionId, contextType, content, metadata);
      const duration = timer.getElapsed();

      // Record performance metrics
      monitoringService.recordPerformanceMetrics('add_context', {
        operation: 'add_context',
        duration,
        success: true,
        metadata: { 
          sessionId, 
          contextType, 
          contentSize,
          sequenceNumber: contextEntry.sequenceNumber
        }
      });

      // Log context size metrics
      structuredLogger.logPerformanceMetric({
        timestamp: new Date(),
        sessionId,
        metricName: 'context_entry_size',
        metricValue: contentSize,
        metricType: 'gauge',
        unit: 'bytes',
        tags: { contextType, sessionId }
      });

      // Alert on large context entries
      if (contentSize > 100000) { // 100KB threshold
        structuredLogger.logWarning(`Large context entry detected (${contentSize} bytes)`, {
          timestamp: new Date(),
          warningType: 'Resource',
          component: 'ContextEntry',
          threshold: 100000,
          currentValue: contentSize,
          recommendation: 'Consider breaking large context into smaller chunks',
          metadata: { sessionId, contextType, sequenceNumber: contextEntry.sequenceNumber }
        });
      }

      structuredLogger.logSystemEvent({
        timestamp: new Date(),
        component: 'MonitoredDatabase',
        operation: 'add_context_complete',
        status: 'completed',
        metadata: {
          operationId,
          contextEntryId: contextEntry.id,
          durationMs: duration,
          contentSize
        }
      });

      return contextEntry;
    } catch (error) {
      const duration = timer.getElapsed();

      monitoringService.recordPerformanceMetrics('add_context', {
        operation: 'add_context',
        duration,
        success: false,
        metadata: { sessionId, contextType, contentSize, error: (error as Error).message }
      });

      structuredLogger.logError(error as Error, {
        timestamp: new Date(),
        errorType: 'DatabaseError',
        component: 'MonitoredDatabase',
        operation: 'add_context',
        additionalInfo: { operationId, sessionId, contextType, contentSize }
      });

      throw error;
    }
  }

  /**
   * Monitored Redis cache operations
   */
  async setCache(key: string, value: any, ttlSeconds?: number): Promise<void> {
    const timer = new PerformanceTimer();
    const operationId = `set_cache_${Date.now()}`;
    const valueSize = Buffer.byteLength(JSON.stringify(value), 'utf8');

    try {
      await super.setCache(key, value, ttlSeconds);
      const duration = timer.getElapsed();

      // Record Redis operation metrics
      monitoringService.recordRedisOperation('SET', duration, true);

      // Log cache operation
      structuredLogger.logPerformanceMetric({
        timestamp: new Date(),
        metricName: 'redis_set_duration',
        metricValue: duration,
        metricType: 'timer',
        unit: 'milliseconds',
        tags: { operation: 'SET', key_prefix: key.split(':')[0] }
      });

      // Alert on large cache values
      if (valueSize > 1000000) { // 1MB threshold
        structuredLogger.logWarning(`Large cache value detected (${valueSize} bytes)`, {
          timestamp: new Date(),
          warningType: 'Resource',
          component: 'RedisCache',
          threshold: 1000000,
          currentValue: valueSize,
          recommendation: 'Consider compressing large cache values or using database storage',
          metadata: { key, ttlSeconds }
        });
      }

    } catch (error) {
      const duration = timer.getElapsed();
      
      monitoringService.recordRedisOperation('SET', duration, false);

      structuredLogger.logError(error as Error, {
        timestamp: new Date(),
        errorType: 'RedisError',
        component: 'MonitoredDatabase',
        operation: 'set_cache',
        additionalInfo: { operationId, key, valueSize, ttlSeconds }
      });

      throw error;
    }
  }

  /**
   * Monitored Redis cache retrieval
   */
  async getCache<T = any>(key: string): Promise<T | null> {
    const timer = new PerformanceTimer();

    try {
      const result = await super.getCache<T>(key);
      const duration = timer.getElapsed();
      const cacheHit = result !== null;

      // Record Redis operation metrics
      monitoringService.recordRedisOperation('GET', duration, true);

      // Log cache hit/miss metrics
      structuredLogger.logPerformanceMetric({
        timestamp: new Date(),
        metricName: 'redis_get_duration',
        metricValue: duration,
        metricType: 'timer',
        unit: 'milliseconds',
        tags: { 
          operation: 'GET', 
          key_prefix: key.split(':')[0],
          cache_hit: cacheHit.toString()
        }
      });

      return result;
    } catch (error) {
      const duration = timer.getElapsed();
      
      monitoringService.recordRedisOperation('GET', duration, false);

      structuredLogger.logError(error as Error, {
        timestamp: new Date(),
        errorType: 'RedisError',
        component: 'MonitoredDatabase',
        operation: 'get_cache',
        additionalInfo: { key }
      });

      throw error;
    }
  }

  /**
   * Get database performance statistics
   */
  getPerformanceStats() {
    const errorRate = this.queryStats.totalQueries > 0 
      ? this.queryStats.totalErrors / this.queryStats.totalQueries 
      : 0;

    return {
      totalQueries: this.queryStats.totalQueries,
      totalErrors: this.queryStats.totalErrors,
      slowQueries: this.queryStats.slowQueries,
      errorRate,
      slowQueryRate: this.queryStats.totalQueries > 0 
        ? this.queryStats.slowQueries / this.queryStats.totalQueries 
        : 0
    };
  }

  /**
   * Check error rate and trigger alerts if threshold exceeded
   */
  private async checkErrorRateAndAlert(): Promise<void> {
    const stats = this.getPerformanceStats();
    
    if (stats.errorRate > this.alertThresholds.errorRateThreshold && stats.totalQueries > 10) {
      structuredLogger.logWarning(`High database error rate detected (${(stats.errorRate * 100).toFixed(2)}%)`, {
        timestamp: new Date(),
        warningType: 'Resource',
        component: 'DatabaseErrorRate',
        threshold: this.alertThresholds.errorRateThreshold * 100,
        currentValue: stats.errorRate * 100,
        recommendation: 'Check database connectivity and query patterns',
        metadata: {
          totalQueries: stats.totalQueries,
          totalErrors: stats.totalErrors,
          slowQueries: stats.slowQueries
        }
      });
    }
  }

  /**
   * Trigger alert for very slow queries
   */
  private async triggerSlowQueryAlert(queryId: string, query: string, duration: number, rowCount: number): Promise<void> {
    structuredLogger.logWarning(`Critical slow query alert (${duration}ms)`, {
      timestamp: new Date(),
      warningType: 'Performance',
      component: 'CriticalSlowQuery',
      threshold: this.alertThresholds.verySlowQueryMs,
      currentValue: duration,
      recommendation: 'Immediate query optimization required - consider adding indexes or rewriting query',
      metadata: {
        queryId,
        queryPreview: query.substring(0, 300),
        rowCount,
        severity: 'critical'
      }
    });

    // Log performance metric for critical slow query
    structuredLogger.logPerformanceMetric({
      timestamp: new Date(),
      metricName: 'critical_slow_query',
      metricValue: duration,
      metricType: 'timer',
      unit: 'milliseconds',
      tags: { 
        severity: 'critical',
        query_id: queryId
      }
    });
  }

  /**
   * Reset performance statistics (useful for testing or periodic resets)
   */
  resetPerformanceStats(): void {
    this.queryStats = {
      totalQueries: 0,
      totalErrors: 0,
      slowQueries: 0
    };

    structuredLogger.logSystemEvent({
      timestamp: new Date(),
      component: 'MonitoredDatabase',
      operation: 'reset_stats',
      status: 'completed'
    });
  }
}

// Export monitored database instance
export const monitoredDb = new MonitoredDatabaseManager();