import { monitoredDb } from '../database/monitoredDatabase.js';
import type { Session } from '../database/schema.js';
import { monitoringService } from './monitoringService.js';
import { structuredLogger } from './structuredLogger.js';
import { PerformanceTimer } from '../mcp/utils/performance.js';

export interface RetentionPolicy {
  name: string;
  activeSessionTtl: number; // hours
  archivedSessionTtl: number; // days
  logRetentionDays: number;
  metricsRetentionDays: number;
  dormantThresholdHours: number; // hours of inactivity before marking dormant
}

export interface SessionCleanupResult {
  expiredSessions: number;
  archivedSessions: number;
  orphanedSessions: number;
  deletedSessions: number;
}

export interface SessionManagerConfig {
  defaultRetentionPolicy: RetentionPolicy;
  cleanupIntervalMinutes: number;
  dormantCheckIntervalMinutes: number;
  maxConcurrentCleanups: number;
}

class SessionManagerService {
  private retentionPolicies: Map<string, RetentionPolicy> = new Map();
  private config: SessionManagerConfig;
  private cleanupInProgress = false;

  constructor(config?: Partial<SessionManagerConfig>) {
    // Default configuration
    this.config = {
      defaultRetentionPolicy: {
        name: 'standard',
        activeSessionTtl: 24, // 24 hours
        archivedSessionTtl: 30, // 30 days
        logRetentionDays: 7,
        metricsRetentionDays: 30,
        dormantThresholdHours: 2 // 2 hours of inactivity
      },
      cleanupIntervalMinutes: 60, // Run cleanup every hour
      dormantCheckIntervalMinutes: 30, // Check for dormant sessions every 30 minutes
      maxConcurrentCleanups: 3,
      ...config
    };

    // Initialize with default retention policy
    this.retentionPolicies.set('standard', this.config.defaultRetentionPolicy);
    
    // Add additional predefined policies
    this.retentionPolicies.set('extended', {
      name: 'extended',
      activeSessionTtl: 72, // 3 days
      archivedSessionTtl: 90, // 90 days
      logRetentionDays: 30,
      metricsRetentionDays: 90,
      dormantThresholdHours: 6
    });

    this.retentionPolicies.set('short', {
      name: 'short',
      activeSessionTtl: 4, // 4 hours
      archivedSessionTtl: 7, // 7 days
      logRetentionDays: 3,
      metricsRetentionDays: 7,
      dormantThresholdHours: 1
    });
  }

  /**
   * Schedule session expiration based on retention policy
   */
  async scheduleExpiration(sessionId: string, customExpiresAt?: Date): Promise<void> {
    const timer = new PerformanceTimer();
    const operationId = `schedule_expiration_${Date.now()}`;

    try {
      structuredLogger.logSystemEvent({
        timestamp: new Date(),
        component: 'SessionManager',
        operation: 'schedule_expiration_start',
        status: 'started',
        metadata: { operationId, sessionId }
      });

      const session = await this.getSessionById(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }
      timer.checkpoint('session_retrieved');

      const policy = this.retentionPolicies.get(session.retentionPolicy) || this.config.defaultRetentionPolicy;
      
      // Calculate expiration time
      const expiresAt = customExpiresAt || new Date(Date.now() + policy.activeSessionTtl * 60 * 60 * 1000);
      timer.checkpoint('expiration_calculated');

      // Update session with expiration time
      await monitoredDb.query(
        'UPDATE sessions SET expires_at = $1 WHERE id = $2',
        [expiresAt, sessionId]
      );
      timer.checkpoint('session_updated');

      // Log the scheduling event
      await this.logLifecycleEvent(sessionId, 'expiration_scheduled', {
        expires_at: expiresAt,
        retention_policy: policy.name,
        ttl_hours: policy.activeSessionTtl
      });
      timer.checkpoint('lifecycle_logged');

      const duration = timer.getElapsed();

      // Record performance metrics
      monitoringService.recordPerformanceMetrics('schedule_expiration', {
        operation: 'schedule_expiration',
        duration,
        success: true,
        metadata: {
          sessionId,
          retentionPolicy: policy.name,
          ttlHours: policy.activeSessionTtl
        }
      });

      structuredLogger.logSystemEvent({
        timestamp: new Date(),
        component: 'SessionManager',
        operation: 'schedule_expiration_complete',
        status: 'completed',
        metadata: {
          operationId,
          sessionId,
          durationMs: duration,
          expiresAt: expiresAt.toISOString(),
          retentionPolicy: policy.name
        }
      });

      console.log(`Session ${sessionId} scheduled for expiration at ${expiresAt}`);
    } catch (error) {
      const duration = timer.getElapsed();

      // Record error metrics
      monitoringService.recordPerformanceMetrics('schedule_expiration', {
        operation: 'schedule_expiration',
        duration,
        success: false,
        metadata: { sessionId, error: (error as Error).message }
      });

      // Log error
      structuredLogger.logError(error as Error, {
        timestamp: new Date(),
        errorType: 'ServiceError',
        component: 'SessionManager',
        operation: 'schedule_expiration',
        additionalInfo: { operationId, sessionId, durationMs: duration }
      });

      throw error;
    }
  }

  /**
   * Expire a session and transition it to expired status
   */
  async expireSession(sessionId: string): Promise<void> {
    try {
      const session = await this.getSessionById(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      if (session.status === 'expired' || session.archivedAt) {
        console.log(`Session ${sessionId} is already expired or archived`);
        return;
      }

      // Update session status to expired
      await monitoredDb.query(
        'UPDATE sessions SET status = $1, updated_at = NOW() WHERE id = $2',
        ['expired', sessionId]
      );

      // Ensure referential integrity (don't fail the operation if this fails)
      try {
        await this.ensureReferentialIntegrity(sessionId);
      } catch (error) {
        console.warn(`Referential integrity check failed for session ${sessionId}:`, error);
      }

      // Log the expiration event
      await this.logLifecycleEvent(sessionId, 'expired', {
        previous_status: session.status,
        expired_at: new Date(),
        retention_policy: session.retentionPolicy
      });

      console.log(`Session ${sessionId} expired successfully`);
    } catch (error) {
      console.error(`Error expiring session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Archive a session to cold storage while maintaining read-only access
   */
  async archiveSession(sessionId: string): Promise<void> {
    try {
      const session = await this.getSessionById(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      if (session.archivedAt) {
        console.log(`Session ${sessionId} is already archived`);
        return;
      }

      const archivedAt = new Date();

      // Update session with archived timestamp
      await monitoredDb.query(
        'UPDATE sessions SET archived_at = $1, is_dormant = true, updated_at = NOW() WHERE id = $2',
        [archivedAt, sessionId]
      );

      // Cache session data in Redis for faster read access
      const cacheKey = `archived_session:${sessionId}`;
      const cacheKeyBySessionKey = `archived_session_by_key:${session.sessionKey}`;
      const sessionData = {
        ...session,
        archivedAt,
        isDormant: true
      };
      
      // Cache for 7 days by default
      await monitoredDb.setCache(cacheKey, sessionData, 7 * 24 * 60 * 60);
      await monitoredDb.setCache(cacheKeyBySessionKey, sessionData, 7 * 24 * 60 * 60);

      // Ensure referential integrity (don't fail the operation if this fails)
      try {
        await this.ensureReferentialIntegrity(sessionId);
      } catch (error) {
        console.warn(`Referential integrity check failed for session ${sessionId}:`, error);
      }

      // Log the archival event
      await this.logLifecycleEvent(sessionId, 'archived', {
        archived_at: archivedAt,
        previous_status: session.status,
        retention_policy: session.retentionPolicy
      });

      console.log(`Session ${sessionId} archived successfully`);
    } catch (error) {
      console.error(`Error archiving session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Clean up orphaned and expired sessions
   */
  async cleanupOrphanedSessions(): Promise<number> {
    if (this.cleanupInProgress) {
      console.log('Cleanup already in progress, skipping');
      return 0;
    }

    this.cleanupInProgress = true;
    let cleanedCount = 0;

    try {
      // Find orphaned sessions (sessions with no recent activity and no context)
      const orphanedQuery = `
        SELECT s.id, s.session_key, s.status, s.last_activity_at
        FROM sessions s
        LEFT JOIN context_history ch ON s.id = ch.session_id
        WHERE s.last_activity_at < NOW() - INTERVAL '7 days'
          AND s.status NOT IN ('archived', 'completed')
          AND ch.id IS NULL
      `;

      const orphanedResult = await monitoredDb.query(orphanedQuery);
      
      for (const session of orphanedResult.rows) {
        try {
          await this.expireSession(session.id);
          await this.archiveSession(session.id);
          cleanedCount++;
          
          console.log(`Cleaned up orphaned session: ${session.session_key}`);
        } catch (error) {
          console.error(`Error cleaning up orphaned session ${session.id}:`, error);
        }
      }

      // Find and expire sessions past their TTL
      const expiredQuery = `
        SELECT id, session_key, status
        FROM sessions
        WHERE expires_at IS NOT NULL 
          AND expires_at < NOW()
          AND status NOT IN ('expired', 'archived')
      `;

      const expiredResult = await monitoredDb.query(expiredQuery);
      
      for (const session of expiredResult.rows) {
        try {
          await this.expireSession(session.id);
          cleanedCount++;
        } catch (error) {
          console.error(`Error expiring session ${session.id}:`, error);
        }
      }

      console.log(`Cleanup completed: ${cleanedCount} sessions processed`);
      return cleanedCount;
    } catch (error) {
      console.error('Error during session cleanup:', error);
      throw error;
    } finally {
      this.cleanupInProgress = false;
    }
  }

  /**
   * Mark a session as dormant and reduce its cache priority
   */
  async markSessionDormant(sessionId: string): Promise<void> {
    try {
      const session = await this.getSessionById(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      if (session.isDormant) {
        console.log(`Session ${sessionId} is already dormant`);
        return;
      }

      // Update session to dormant status
      await monitoredDb.query(
        'UPDATE sessions SET is_dormant = true, updated_at = NOW() WHERE id = $1',
        [sessionId]
      );

      // Reduce cache priority by moving to a different cache tier
      const cacheKey = `session:${sessionId}`;
      const dormantCacheKey = `dormant_session:${sessionId}`;
      
      const cachedData = await monitoredDb.getCache(cacheKey);
      if (cachedData) {
        // Move to dormant cache with longer TTL but lower priority
        await monitoredDb.setCache(dormantCacheKey, cachedData, 24 * 60 * 60); // 24 hours
        await monitoredDb.deleteCache(cacheKey);
      }

      // Log the dormant event
      await this.logLifecycleEvent(sessionId, 'dormant', {
        marked_dormant_at: new Date(),
        last_activity: session.lastActivityAt
      });

      console.log(`Session ${sessionId} marked as dormant`);
    } catch (error) {
      console.error(`Error marking session ${sessionId} as dormant:`, error);
      throw error;
    }
  }

  /**
   * Reactivate a dormant session
   */
  async reactivateSession(sessionId: string): Promise<void> {
    try {
      const session = await this.getSessionById(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      if (!session.isDormant) {
        console.log(`Session ${sessionId} is not dormant`);
        return;
      }

      // Update session to active status
      await monitoredDb.query(
        'UPDATE sessions SET is_dormant = false, last_activity_at = NOW(), updated_at = NOW() WHERE id = $1',
        [sessionId]
      );

      // Move back to active cache tier
      const dormantCacheKey = `dormant_session:${sessionId}`;
      const cacheKey = `session:${sessionId}`;
      
      const cachedData = await monitoredDb.getCache(dormantCacheKey);
      if (cachedData) {
        // Move to active cache with shorter TTL but higher priority
        await monitoredDb.setCache(cacheKey, { ...cachedData, isDormant: false }, 4 * 60 * 60); // 4 hours
        await monitoredDb.deleteCache(dormantCacheKey);
      }

      // Log the reactivation event
      await this.logLifecycleEvent(sessionId, 'reactivated', {
        reactivated_at: new Date(),
        was_dormant_since: session.lastActivityAt
      });

      console.log(`Session ${sessionId} reactivated successfully`);
    } catch (error) {
      console.error(`Error reactivating session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Update retention policy for the service
   */
  async updateRetentionPolicy(policy: RetentionPolicy): Promise<void> {
    try {
      // Validate policy
      if (!policy.name || policy.activeSessionTtl <= 0 || policy.archivedSessionTtl <= 0) {
        throw new Error('Invalid retention policy configuration');
      }

      // Store the policy
      this.retentionPolicies.set(policy.name, policy);

      console.log(`Retention policy '${policy.name}' updated successfully`);
    } catch (error) {
      console.error(`Error updating retention policy:`, error);
      throw error;
    }
  }

  /**
   * Get retention policy by name
   */
  getRetentionPolicy(name: string): RetentionPolicy | undefined {
    return this.retentionPolicies.get(name);
  }

  /**
   * Get all available retention policies
   */
  getAllRetentionPolicies(): RetentionPolicy[] {
    return Array.from(this.retentionPolicies.values());
  }

  /**
   * Detect and mark dormant sessions based on inactivity
   */
  async detectDormantSessions(): Promise<number> {
    try {
      let processedCount = 0;

      // Get all retention policies to check different thresholds
      for (const policy of this.retentionPolicies.values()) {
        const thresholdTime = new Date(Date.now() - policy.dormantThresholdHours * 60 * 60 * 1000);
        
        const dormantQuery = `
          SELECT id, session_key, last_activity_at
          FROM sessions
          WHERE retention_policy = $1
            AND is_dormant = false
            AND status IN ('active', 'pending')
            AND last_activity_at < $2
        `;

        const result = await monitoredDb.query(dormantQuery, [policy.name, thresholdTime]);
        
        for (const session of result.rows) {
          try {
            await this.markSessionDormant(session.id);
            processedCount++;
          } catch (error) {
            console.error(`Error marking session ${session.id} as dormant:`, error);
          }
        }
      }

      if (processedCount > 0) {
        console.log(`Detected and marked ${processedCount} sessions as dormant`);
      }

      return processedCount;
    } catch (error) {
      console.error('Error detecting dormant sessions:', error);
      throw error;
    }
  }

  /**
   * Get comprehensive cleanup statistics
   */
  async getCleanupStats(): Promise<SessionCleanupResult> {
    try {
      const stats: SessionCleanupResult = {
        expiredSessions: 0,
        archivedSessions: 0,
        orphanedSessions: 0,
        deletedSessions: 0
      };

      // Count expired sessions
      const expiredResult = await monitoredDb.query(
        "SELECT COUNT(*) as count FROM sessions WHERE status = 'expired'"
      );
      stats.expiredSessions = parseInt(expiredResult.rows[0].count);

      // Count archived sessions
      const archivedResult = await monitoredDb.query(
        'SELECT COUNT(*) as count FROM sessions WHERE archived_at IS NOT NULL'
      );
      stats.archivedSessions = parseInt(archivedResult.rows[0].count);

      // Count potential orphaned sessions
      const orphanedResult = await monitoredDb.query(`
        SELECT COUNT(*) as count
        FROM sessions s
        LEFT JOIN context_history ch ON s.id = ch.session_id
        WHERE s.last_activity_at < NOW() - INTERVAL '7 days'
          AND s.status NOT IN ('archived', 'completed')
          AND ch.id IS NULL
      `);
      stats.orphanedSessions = parseInt(orphanedResult.rows[0].count);

      return stats;
    } catch (error) {
      console.error('Error getting cleanup stats:', error);
      throw error;
    }
  }

  /**
   * Helper method to get session by ID
   */
  private async getSessionById(sessionId: string): Promise<Session | null> {
    try {
      const result = await monitoredDb.query('SELECT * FROM sessions WHERE id = $1', [sessionId]);
      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
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
    } catch (error) {
      console.error(`Error getting session by ID ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Ensure referential integrity during session lifecycle transitions
   */
  async ensureReferentialIntegrity(sessionId: string): Promise<void> {
    try {
      await monitoredDb.query('BEGIN');
      
      try {
        // Check for orphaned context entries
        const orphanedContextQuery = `
          SELECT COUNT(*) as count
          FROM context_history ch
          LEFT JOIN sessions s ON ch.session_id = s.id
          WHERE ch.session_id = $1 AND s.id IS NULL
        `;
        const orphanedResult = await monitoredDb.query(orphanedContextQuery, [sessionId]);
        
        if (parseInt(orphanedResult.rows[0].count) > 0) {
          console.warn(`Found orphaned context entries for session ${sessionId}`);
        }

        // Check for orphaned lifecycle events
        const orphanedLifecycleQuery = `
          SELECT COUNT(*) as count
          FROM session_lifecycle sl
          LEFT JOIN sessions s ON sl.session_id = s.id
          WHERE sl.session_id = $1 AND s.id IS NULL
        `;
        const orphanedLifecycleResult = await monitoredDb.query(orphanedLifecycleQuery, [sessionId]);
        
        if (parseInt(orphanedLifecycleResult.rows[0].count) > 0) {
          console.warn(`Found orphaned lifecycle events for session ${sessionId}`);
        }

        // Check for orphaned performance logs
        const orphanedPerformanceQuery = `
          SELECT COUNT(*) as count
          FROM performance_logs pl
          LEFT JOIN sessions s ON pl.session_id = s.id
          WHERE pl.session_id = $1 AND s.id IS NULL
        `;
        const orphanedPerformanceResult = await monitoredDb.query(orphanedPerformanceQuery, [sessionId]);
        
        if (parseInt(orphanedPerformanceResult.rows[0].count) > 0) {
          console.warn(`Found orphaned performance logs for session ${sessionId}`);
        }

        await monitoredDb.query('COMMIT');
      } catch (error) {
        await monitoredDb.query('ROLLBACK');
        throw error;
      }
    } catch (error) {
      console.error(`Error checking referential integrity for session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Helper method to log lifecycle events
   */
  private async logLifecycleEvent(sessionId: string, eventType: string, eventData: Record<string, any>): Promise<void> {
    try {
      await monitoredDb.query(
        'INSERT INTO session_lifecycle (session_id, event_type, event_data) VALUES ($1, $2, $3)',
        [sessionId, eventType, JSON.stringify(eventData)]
      );
    } catch (error) {
      console.error(`Error logging lifecycle event for session ${sessionId}:`, error);
      // Don't throw here to avoid breaking the main operation
    }
  }
}

export const sessionManagerService = new SessionManagerService();
export { SessionManagerService };