import { resilientDb } from '../database/resilientDatabase.js';
import { errorHandler, ErrorCategory, ErrorSeverity, RecoveryStrategy } from './errorHandler.js';
import { gracefulDegradation, ServicePriority } from './gracefulDegradation.js';
import { structuredLogger } from './structuredLogger.js';
import { Session, ContextHistoryEntry } from '../database/schema.js';

// Recovery state interfaces
export interface SessionRecoveryState {
  sessionId: string;
  sessionKey: string;
  lastCheckpoint: Date;
  contextEntries: number;
  recoveryMetadata: Record<string, any>;
  recoveryAttempts: number;
  lastRecoveryAttempt?: Date;
  corrupted: boolean;
}

export interface RecoveryCheckpoint {
  sessionId: string;
  checkpointId: string;
  timestamp: Date;
  sessionState: Partial<Session>;
  contextSnapshot: ContextHistoryEntry[];
  metadata: Record<string, any>;
  dataIntegrity: {
    contextEntriesCount: number;
    lastSequenceNumber: number;
    checksum: string;
  };
}

export interface RecoveryOptions {
  maxRecoveryAttempts: number;
  recoveryTimeoutMs: number;
  validateIntegrity: boolean;
  createBackup: boolean;
  recoveryStrategy: 'complete' | 'partial' | 'minimal';
  skipCorrupted: boolean;
}

export interface RecoveryResult {
  success: boolean;
  sessionId: string;
  recoveredSession?: Session;
  recoveredContextEntries: number;
  errors: string[];
  warnings: string[];
  recoveryMethod: string;
  integrityStatus: 'valid' | 'partial' | 'corrupted';
  recoveryTimeMs: number;
}

/**
 * Session State Recovery Service
 * Handles recovery of session state from persistent storage in case of failures
 */
export class StateRecoveryService {
  private recoveryStates = new Map<string, SessionRecoveryState>();
  private checkpointInterval?: NodeJS.Timeout;
  private readonly CHECKPOINT_INTERVAL_MS = 300000; // 5 minutes
  private readonly MAX_RECOVERY_ATTEMPTS = 3;
  private readonly RECOVERY_TIMEOUT_MS = 30000; // 30 seconds
  
  constructor() {
    this.registerForGracefulDegradation();
  }
  
  /**
   * Register service for graceful degradation
   */
  private registerForGracefulDegradation(): void {
    gracefulDegradation.registerService({
      service: 'stateRecovery',
      priority: ServicePriority.IMPORTANT,
      failureThreshold: 2,
      recoveryThreshold: 1,
      checkIntervalMs: 60000,
      disableOnDegradation: false,
      healthCheckFunction: async () => {
        try {
          // Simple health check - try to create and read a test checkpoint
          const testCheckpoint: RecoveryCheckpoint = {
            sessionId: 'health-check',
            checkpointId: `hc-${Date.now()}`,
            timestamp: new Date(),
            sessionState: { sessionKey: 'test' },
            contextSnapshot: [],
            metadata: { healthCheck: true },
            dataIntegrity: {
              contextEntriesCount: 0,
              lastSequenceNumber: 0,
              checksum: 'test'
            }
          };
          
          await this.storeCheckpoint(testCheckpoint);
          await this.removeCheckpoint('health-check', testCheckpoint.checkpointId);
          
          return true;
        } catch (error) {
          return false;
        }
      }
    });
  }
  
  /**
   * Start automatic checkpoint creation
   */
  startCheckpointing(): void {
    if (this.checkpointInterval) {
      clearInterval(this.checkpointInterval);
    }
    
    this.checkpointInterval = setInterval(async () => {
      await this.createAutomaticCheckpoints();
    }, this.CHECKPOINT_INTERVAL_MS);
    
    structuredLogger.logInfo('Automatic checkpointing started', {
      intervalMs: this.CHECKPOINT_INTERVAL_MS
    });
  }
  
  /**
   * Stop automatic checkpoint creation
   */
  stopCheckpointing(): void {
    if (this.checkpointInterval) {
      clearInterval(this.checkpointInterval);
      this.checkpointInterval = undefined;
    }
    
    structuredLogger.logInfo('Automatic checkpointing stopped');
  }
  
  /**
   * Create checkpoint for a session
   */
  async createCheckpoint(
    sessionId: string,
    metadata: Record<string, any> = {}
  ): Promise<RecoveryCheckpoint> {
    const recoveryResult = await errorHandler.handleWithRecovery(
      async () => {
        // Get current session state
        const session = await resilientDb.query(
          'SELECT * FROM sessions WHERE id = $1',
          [sessionId]
        );
        
        if (session.rows.length === 0) {
          throw new Error(`Session not found: ${sessionId}`);
        }
        
        // Get context history
        const contextResult = await resilientDb.query(
          'SELECT * FROM context_history WHERE session_id = $1 ORDER BY sequence_number ASC',
          [sessionId]
        );
        
        const contextEntries = contextResult.rows.map(this.mapRowToContextHistory);
        
        // Calculate data integrity checksum
        const checksum = this.calculateChecksum(session.rows[0], contextEntries);
        
        const checkpoint: RecoveryCheckpoint = {
          sessionId,
          checkpointId: `cp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          timestamp: new Date(),
          sessionState: this.mapRowToSession(session.rows[0]),
          contextSnapshot: contextEntries,
          metadata: {
            ...metadata,
            createdBy: 'StateRecoveryService',
            automatic: false
          },
          dataIntegrity: {
            contextEntriesCount: contextEntries.length,
            lastSequenceNumber: contextEntries.length > 0 
              ? Math.max(...contextEntries.map(e => e.sequenceNumber))
              : 0,
            checksum
          }
        };
        
        // Store checkpoint
        await this.storeCheckpoint(checkpoint);
        
        // Update recovery state
        this.updateRecoveryState(sessionId, {
          sessionId,
          sessionKey: checkpoint.sessionState.sessionKey || '',
          lastCheckpoint: checkpoint.timestamp,
          contextEntries: contextEntries.length,
          recoveryMetadata: metadata,
          recoveryAttempts: 0,
          corrupted: false
        });
        
        structuredLogger.logInfo('Session checkpoint created', {
          sessionId,
          checkpointId: checkpoint.checkpointId,
          contextEntries: contextEntries.length,
          checksum
        });
        
        return checkpoint;
      },
      {
        strategy: RecoveryStrategy.RETRY,
        maxRetries: 2,
        initialDelayMs: 1000,
        maxDelayMs: 5000,
        backoffMultiplier: 2,
        jitterEnabled: true,
        timeout: 15000
      },
      {
        category: ErrorCategory.SESSION,
        severity: ErrorSeverity.MEDIUM,
        component: 'StateRecoveryService',
        operation: 'createCheckpoint',
        sessionId
      }
    );
    
    if (!recoveryResult.success) {
      throw recoveryResult.error || new Error('Failed to create checkpoint');
    }
    
    return recoveryResult.result;
  }
  
  /**
   * Recover session from latest checkpoint
   */
  async recoverSession(
    sessionId: string,
    options: Partial<RecoveryOptions> = {}
  ): Promise<RecoveryResult> {
    const startTime = Date.now();
    const recoveryOptions: RecoveryOptions = {
      maxRecoveryAttempts: options.maxRecoveryAttempts || this.MAX_RECOVERY_ATTEMPTS,
      recoveryTimeoutMs: options.recoveryTimeoutMs || this.RECOVERY_TIMEOUT_MS,
      validateIntegrity: options.validateIntegrity ?? true,
      createBackup: options.createBackup ?? true,
      recoveryStrategy: options.recoveryStrategy || 'complete',
      skipCorrupted: options.skipCorrupted ?? false
    };
    
    const result: RecoveryResult = {
      success: false,
      sessionId,
      recoveredContextEntries: 0,
      errors: [],
      warnings: [],
      recoveryMethod: 'none',
      integrityStatus: 'corrupted',
      recoveryTimeMs: 0
    };
    
    try {
      // Get recovery state
      let recoveryState = this.recoveryStates.get(sessionId);
      if (!recoveryState) {
        // Initialize recovery state
        recoveryState = {
          sessionId,
          sessionKey: '',
          lastCheckpoint: new Date(0),
          contextEntries: 0,
          recoveryMetadata: {},
          recoveryAttempts: 0,
          corrupted: false
        };
        this.recoveryStates.set(sessionId, recoveryState);
      }
      
      // Check if we've exceeded max recovery attempts
      if (recoveryState.recoveryAttempts >= recoveryOptions.maxRecoveryAttempts) {
        result.errors.push('Maximum recovery attempts exceeded');
        return result;
      }
      
      // Update recovery attempt
      recoveryState.recoveryAttempts++;
      recoveryState.lastRecoveryAttempt = new Date();
      
      // Find latest checkpoint
      const checkpoint = await this.getLatestCheckpoint(sessionId);
      if (!checkpoint) {
        result.errors.push('No checkpoint found for session');
        result.recoveryMethod = 'no_checkpoint';
        return result;
      }
      
      // Validate checkpoint integrity if requested
      if (recoveryOptions.validateIntegrity) {
        const integrityResult = await this.validateCheckpointIntegrity(checkpoint);
        result.integrityStatus = integrityResult.status;
        
        if (integrityResult.status === 'corrupted' && !recoveryOptions.skipCorrupted) {
          result.errors.push('Checkpoint is corrupted and skipCorrupted is false');
          recoveryState.corrupted = true;
          return result;
        }
        
        if (integrityResult.warnings.length > 0) {
          result.warnings.push(...integrityResult.warnings);
        }
      }
      
      // Create backup if requested
      if (recoveryOptions.createBackup) {
        await this.createRecoveryBackup(sessionId);
      }
      
      // Perform recovery based on strategy
      const recoveryResult = await this.executeRecovery(checkpoint, recoveryOptions);
      
      result.success = recoveryResult.success;
      result.recoveredSession = recoveryResult.session;
      result.recoveredContextEntries = recoveryResult.contextEntries;
      result.recoveryMethod = recoveryResult.method;
      result.errors.push(...recoveryResult.errors);
      result.warnings.push(...recoveryResult.warnings);
      
      if (result.success) {
        // Reset recovery state on success
        recoveryState.recoveryAttempts = 0;
        recoveryState.lastCheckpoint = checkpoint.timestamp;
        recoveryState.corrupted = false;
        
        structuredLogger.logInfo('Session recovery completed successfully', {
          sessionId,
          recoveryMethod: result.recoveryMethod,
          contextEntries: result.recoveredContextEntries,
          integrityStatus: result.integrityStatus,
          recoveryTimeMs: Date.now() - startTime
        });
      } else {
        structuredLogger.logError('Session recovery failed', {
          sessionId,
          errors: result.errors,
          recoveryAttempts: recoveryState.recoveryAttempts,
          recoveryTimeMs: Date.now() - startTime
        });
      }
      
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
      
      structuredLogger.logError('Session recovery encountered error', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
    }
    
    result.recoveryTimeMs = Date.now() - startTime;
    return result;
  }
  
  /**
   * Execute the actual recovery process
   */
  private async executeRecovery(
    checkpoint: RecoveryCheckpoint,
    options: RecoveryOptions
  ): Promise<{
    success: boolean;
    session?: Session;
    contextEntries: number;
    method: string;
    errors: string[];
    warnings: string[];
  }> {
    const result = {
      success: false,
      contextEntries: 0,
      method: '',
      errors: [] as string[],
      warnings: [] as string[]
    };
    
    try {
      switch (options.recoveryStrategy) {
        case 'complete':
          return await this.completeRecovery(checkpoint);
        case 'partial':
          return await this.partialRecovery(checkpoint);
        case 'minimal':
          return await this.minimalRecovery(checkpoint);
        default:
          result.errors.push(`Unknown recovery strategy: ${options.recoveryStrategy}`);
          return result;
      }
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
      return result;
    }
  }
  
  /**
   * Complete recovery - restore full session state and all context
   */
  private async completeRecovery(checkpoint: RecoveryCheckpoint): Promise<any> {
    const client = await resilientDb.query('SELECT 1', []); // Get connection
    
    try {
      await resilientDb.query('BEGIN', []);
      
      // Restore session state
      await this.restoreSessionState(checkpoint);
      
      // Restore context history
      await this.restoreContextHistory(checkpoint);
      
      await resilientDb.query('COMMIT', []);
      
      return {
        success: true,
        session: checkpoint.sessionState as Session,
        contextEntries: checkpoint.contextSnapshot.length,
        method: 'complete_recovery',
        errors: [],
        warnings: []
      };
    } catch (error) {
      await resilientDb.query('ROLLBACK', []);
      throw error;
    }
  }
  
  /**
   * Partial recovery - restore session state and recent context
   */
  private async partialRecovery(checkpoint: RecoveryCheckpoint): Promise<any> {
    const client = await resilientDb.query('SELECT 1', []);
    
    try {
      await resilientDb.query('BEGIN', []);
      
      // Restore session state
      await this.restoreSessionState(checkpoint);
      
      // Restore only recent context (last 50 entries)
      const recentContext = checkpoint.contextSnapshot.slice(-50);
      await this.restoreContextHistory({ ...checkpoint, contextSnapshot: recentContext });
      
      await resilientDb.query('COMMIT', []);
      
      return {
        success: true,
        session: checkpoint.sessionState as Session,
        contextEntries: recentContext.length,
        method: 'partial_recovery',
        errors: [],
        warnings: checkpoint.contextSnapshot.length > 50 
          ? [`Only ${recentContext.length} of ${checkpoint.contextSnapshot.length} context entries recovered`]
          : []
      };
    } catch (error) {
      await resilientDb.query('ROLLBACK', []);
      throw error;
    }
  }
  
  /**
   * Minimal recovery - restore only session metadata
   */
  private async minimalRecovery(checkpoint: RecoveryCheckpoint): Promise<any> {
    try {
      // Restore only session state, no context
      await this.restoreSessionState(checkpoint);
      
      return {
        success: true,
        session: checkpoint.sessionState as Session,
        contextEntries: 0,
        method: 'minimal_recovery',
        errors: [],
        warnings: ['Context history not recovered in minimal recovery mode']
      };
    } catch (error) {
      throw error;
    }
  }
  
  /**
   * Restore session state from checkpoint
   */
  private async restoreSessionState(checkpoint: RecoveryCheckpoint): Promise<void> {
    const session = checkpoint.sessionState;
    
    const query = `
      INSERT INTO sessions (
        id, session_key, agent_from, agent_to, status, 
        created_at, updated_at, expires_at, metadata,
        last_activity_at, is_dormant, retention_policy
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
      )
      ON CONFLICT (id) DO UPDATE SET
        session_key = EXCLUDED.session_key,
        agent_from = EXCLUDED.agent_from,
        agent_to = EXCLUDED.agent_to,
        status = EXCLUDED.status,
        updated_at = NOW(),
        expires_at = EXCLUDED.expires_at,
        metadata = EXCLUDED.metadata,
        last_activity_at = EXCLUDED.last_activity_at,
        is_dormant = EXCLUDED.is_dormant,
        retention_policy = EXCLUDED.retention_policy
    `;
    
    await resilientDb.query(query, [
      checkpoint.sessionId,
      session.sessionKey,
      session.agentFrom,
      session.agentTo,
      session.status || 'pending',
      session.createdAt || checkpoint.timestamp,
      checkpoint.timestamp,
      session.expiresAt,
      JSON.stringify(session.metadata || {}),
      session.lastActivityAt || checkpoint.timestamp,
      session.isDormant || false,
      session.retentionPolicy || 'standard'
    ]);
  }
  
  /**
   * Restore context history from checkpoint
   */
  private async restoreContextHistory(checkpoint: RecoveryCheckpoint): Promise<void> {
    // Clear existing context history
    await resilientDb.query(
      'DELETE FROM context_history WHERE session_id = $1',
      [checkpoint.sessionId]
    );
    
    // Restore context entries
    for (const entry of checkpoint.contextSnapshot) {
      await resilientDb.query(`
        INSERT INTO context_history (
          session_id, sequence_number, context_type, content, metadata, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        checkpoint.sessionId,
        entry.sequenceNumber,
        entry.contextType,
        entry.content,
        JSON.stringify(entry.metadata || {}),
        entry.createdAt
      ]);
    }
  }
  
  /**
   * Create automatic checkpoints for active sessions
   */
  private async createAutomaticCheckpoints(): Promise<void> {
    try {
      // Get active sessions that haven't been checkpointed recently
      const sessions = await resilientDb.query(`
        SELECT id, session_key, last_activity_at
        FROM sessions 
        WHERE status IN ('pending', 'active')
        AND last_activity_at > NOW() - INTERVAL '1 hour'
        AND archived_at IS NULL
      `);
      
      for (const session of sessions.rows) {
        const recoveryState = this.recoveryStates.get(session.id);
        const lastCheckpoint = recoveryState?.lastCheckpoint || new Date(0);
        const timeSinceCheckpoint = Date.now() - lastCheckpoint.getTime();
        
        // Create checkpoint if it's been more than the interval since last checkpoint
        if (timeSinceCheckpoint > this.CHECKPOINT_INTERVAL_MS) {
          try {
            await this.createCheckpoint(session.id, { automatic: true });
          } catch (error) {
            structuredLogger.logWarning('Failed to create automatic checkpoint', {
              sessionId: session.id,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      }
    } catch (error) {
      structuredLogger.logError('Error during automatic checkpoint creation', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  
  /**
   * Store checkpoint in database
   */
  private async storeCheckpoint(checkpoint: RecoveryCheckpoint): Promise<void> {
    await resilientDb.query(`
      INSERT INTO recovery_checkpoints (
        session_id, checkpoint_id, timestamp, session_state, 
        context_snapshot, metadata, data_integrity
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (session_id, checkpoint_id) DO UPDATE SET
        timestamp = EXCLUDED.timestamp,
        session_state = EXCLUDED.session_state,
        context_snapshot = EXCLUDED.context_snapshot,
        metadata = EXCLUDED.metadata,
        data_integrity = EXCLUDED.data_integrity
    `, [
      checkpoint.sessionId,
      checkpoint.checkpointId,
      checkpoint.timestamp,
      JSON.stringify(checkpoint.sessionState),
      JSON.stringify(checkpoint.contextSnapshot),
      JSON.stringify(checkpoint.metadata),
      JSON.stringify(checkpoint.dataIntegrity)
    ]);
  }
  
  /**
   * Get latest checkpoint for session
   */
  private async getLatestCheckpoint(sessionId: string): Promise<RecoveryCheckpoint | null> {
    const result = await resilientDb.query(`
      SELECT * FROM recovery_checkpoints 
      WHERE session_id = $1 
      ORDER BY timestamp DESC 
      LIMIT 1
    `, [sessionId]);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    const row = result.rows[0];
    return {
      sessionId: row.session_id,
      checkpointId: row.checkpoint_id,
      timestamp: row.timestamp,
      sessionState: JSON.parse(row.session_state),
      contextSnapshot: JSON.parse(row.context_snapshot),
      metadata: JSON.parse(row.metadata),
      dataIntegrity: JSON.parse(row.data_integrity)
    };
  }
  
  /**
   * Validate checkpoint integrity
   */
  private async validateCheckpointIntegrity(checkpoint: RecoveryCheckpoint): Promise<{
    status: 'valid' | 'partial' | 'corrupted';
    warnings: string[];
  }> {
    const warnings: string[] = [];
    
    try {
      // Calculate current checksum
      const currentChecksum = this.calculateChecksum(
        checkpoint.sessionState,
        checkpoint.contextSnapshot
      );
      
      // Compare with stored checksum
      if (currentChecksum !== checkpoint.dataIntegrity.checksum) {
        return { status: 'corrupted', warnings: ['Checksum mismatch detected'] };
      }
      
      // Validate context entries count
      if (checkpoint.contextSnapshot.length !== checkpoint.dataIntegrity.contextEntriesCount) {
        warnings.push('Context entries count mismatch');
      }
      
      // Validate sequence numbers are consecutive
      for (let i = 0; i < checkpoint.contextSnapshot.length; i++) {
        if (checkpoint.contextSnapshot[i].sequenceNumber !== i + 1) {
          warnings.push('Non-consecutive sequence numbers detected');
          break;
        }
      }
      
      return { 
        status: warnings.length > 0 ? 'partial' : 'valid', 
        warnings 
      };
    } catch (error) {
      return { 
        status: 'corrupted', 
        warnings: [`Integrity validation failed: ${error instanceof Error ? error.message : String(error)}`] 
      };
    }
  }
  
  /**
   * Calculate checksum for data integrity
   */
  private calculateChecksum(sessionState: any, contextEntries: any[]): string {
    const data = JSON.stringify({ sessionState, contextEntries });
    // Simple checksum calculation (in production, use a proper hash function)
    let checksum = 0;
    for (let i = 0; i < data.length; i++) {
      checksum = ((checksum << 5) - checksum + data.charCodeAt(i)) & 0xffffffff;
    }
    return checksum.toString(16);
  }
  
  /**
   * Create recovery backup
   */
  private async createRecoveryBackup(sessionId: string): Promise<void> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupId = `backup-${sessionId}-${timestamp}`;
      
      // Export current session data
      const sessionData = await resilientDb.query(
        'SELECT * FROM sessions WHERE id = $1',
        [sessionId]
      );
      
      const contextData = await resilientDb.query(
        'SELECT * FROM context_history WHERE session_id = $1 ORDER BY sequence_number',
        [sessionId]
      );
      
      // Store backup (this could be enhanced to use external storage)
      await resilientDb.query(`
        INSERT INTO recovery_backups (
          backup_id, session_id, timestamp, session_data, context_data
        ) VALUES ($1, $2, $3, $4, $5)
      `, [
        backupId,
        sessionId,
        new Date(),
        JSON.stringify(sessionData.rows),
        JSON.stringify(contextData.rows)
      ]);
      
      structuredLogger.logInfo('Recovery backup created', {
        sessionId,
        backupId
      });
    } catch (error) {
      structuredLogger.logWarning('Failed to create recovery backup', {
        sessionId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  
  /**
   * Remove old checkpoints
   */
  async cleanupOldCheckpoints(retentionDays: number = 7): Promise<void> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
      
      const result = await resilientDb.query(`
        DELETE FROM recovery_checkpoints 
        WHERE timestamp < $1
      `, [cutoffDate]);
      
      structuredLogger.logInfo('Old checkpoints cleaned up', {
        removedCount: result.rowCount,
        cutoffDate: cutoffDate.toISOString()
      });
    } catch (error) {
      structuredLogger.logError('Failed to cleanup old checkpoints', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  
  /**
   * Remove specific checkpoint
   */
  private async removeCheckpoint(sessionId: string, checkpointId: string): Promise<void> {
    await resilientDb.query(`
      DELETE FROM recovery_checkpoints 
      WHERE session_id = $1 AND checkpoint_id = $2
    `, [sessionId, checkpointId]);
  }
  
  /**
   * Update recovery state
   */
  private updateRecoveryState(sessionId: string, state: SessionRecoveryState): void {
    this.recoveryStates.set(sessionId, state);
  }
  
  /**
   * Helper method to map database row to Session
   */
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
  
  /**
   * Helper method to map database row to context history entry
   */
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
  
  /**
   * Get recovery statistics
   */
  getRecoveryStatistics(): {
    trackedSessions: number;
    totalRecoveryAttempts: number;
    successfulRecoveries: number;
    corruptedSessions: number;
    averageRecoveryAttempts: number;
  } {
    const states = Array.from(this.recoveryStates.values());
    
    return {
      trackedSessions: states.length,
      totalRecoveryAttempts: states.reduce((sum, state) => sum + state.recoveryAttempts, 0),
      successfulRecoveries: states.filter(state => state.recoveryAttempts > 0 && !state.corrupted).length,
      corruptedSessions: states.filter(state => state.corrupted).length,
      averageRecoveryAttempts: states.length > 0 
        ? states.reduce((sum, state) => sum + state.recoveryAttempts, 0) / states.length 
        : 0
    };
  }
  
  /**
   * Shutdown service
   */
  shutdown(): void {
    this.stopCheckpointing();
    this.recoveryStates.clear();
    structuredLogger.logInfo('State recovery service shut down');
  }
}

// Export singleton instance
export const stateRecovery = new StateRecoveryService();