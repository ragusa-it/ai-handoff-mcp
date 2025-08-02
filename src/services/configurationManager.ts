import { z } from 'zod';
import { EventEmitter } from 'events';
import { db } from '../database/index.js';
import { structuredLogger } from './structuredLogger.js';
import { writeFile, readFile, access } from 'fs/promises';
import { constants } from 'fs';
import path from 'path';

// ===== Configuration Interfaces =====

export interface RetentionPolicy {
  sessionExpirationDays: number;
  contextHistoryRetentionDays: number;
  performanceLogsRetentionDays: number;
  systemMetricsRetentionDays: number;
  analyticsAggregationRetentionDays: number;
  dormantSessionThresholdDays: number;
  archiveAfterDays: number;
  purgeArchivedAfterDays: number;
  enableAutoCleanup: boolean;
  cleanupScheduleCron: string;
}

export interface MonitoringConfig {
  healthCheckInterval: number; // seconds
  metricsCollectionInterval: number; // seconds
  performanceTrackingEnabled: boolean;
  alertThresholds: {
    responseTime: number; // ms
    errorRate: number; // percentage
    memoryUsage: number; // percentage
    diskUsage: number; // percentage
    cpuUsage: number; // percentage
    sessionCount: number; // max concurrent sessions
  };
  enablePrometheusExport: boolean;
  enableHealthEndpoint: boolean;
  enableStructuredLogging: boolean;
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  enableAuditTrail: boolean;
  anomalyDetectionEnabled: boolean;
  anomalyDetectionThresholds: {
    sessionDurationZScore: number;
    contextSizeZScore: number;
    handoffFrequencyZScore: number;
  };
}

export interface AnalyticsConfig {
  enableSessionAnalytics: boolean;
  enablePerformanceAnalytics: boolean;
  enableUsageAnalytics: boolean;
  aggregationIntervals: {
    realTime: boolean;
    hourly: boolean;
    daily: boolean;
    weekly: boolean;
    monthly: boolean;
  };
  dataRetentionPolicy: {
    rawDataDays: number;
    aggregatedDataDays: number;
    enableDataCompression: boolean;
  };
  reportingEnabled: boolean;
  reportingSchedule: string; // cron expression
  exportFormats: string[]; // ['json', 'csv', 'prometheus']
  enableTrendAnalysis: boolean;
  enablePredictiveAnalytics: boolean;
  mlModelUpdateInterval: number; // hours
}

export interface SystemConfiguration {
  retention: RetentionPolicy;
  monitoring: MonitoringConfig;
  analytics: AnalyticsConfig;
  version: string;
  lastUpdated: Date;
  updatedBy: string;
}

// ===== Zod Schemas for Validation =====

export const RetentionPolicySchema = z.object({
  sessionExpirationDays: z.number().min(1).max(365).default(30),
  contextHistoryRetentionDays: z.number().min(1).max(365).default(90),
  performanceLogsRetentionDays: z.number().min(1).max(365).default(30),
  systemMetricsRetentionDays: z.number().min(1).max(365).default(90),
  analyticsAggregationRetentionDays: z.number().min(1).max(730).default(365),
  dormantSessionThresholdDays: z.number().min(1).max(30).default(7),
  archiveAfterDays: z.number().min(1).max(365).default(90),
  purgeArchivedAfterDays: z.number().min(30).max(2555).default(365), // ~7 years max
  enableAutoCleanup: z.boolean().default(true),
  cleanupScheduleCron: z.string().default('0 2 * * *') // Daily at 2 AM
});

export const MonitoringConfigSchema = z.object({
  healthCheckInterval: z.number().min(10).max(3600).default(30), // 10 seconds to 1 hour
  metricsCollectionInterval: z.number().min(10).max(3600).default(60), // 10 seconds to 1 hour
  performanceTrackingEnabled: z.boolean().default(true),
  alertThresholds: z.object({
    responseTime: z.number().min(100).max(30000).default(1000), // 100ms to 30s
    errorRate: z.number().min(0).max(100).default(5), // 0% to 100%
    memoryUsage: z.number().min(50).max(95).default(80), // 50% to 95%
    diskUsage: z.number().min(50).max(95).default(85), // 50% to 95%
    cpuUsage: z.number().min(50).max(95).default(80), // 50% to 95%
    sessionCount: z.number().min(10).max(10000).default(1000) // 10 to 10k sessions
  }).default({}),
  enablePrometheusExport: z.boolean().default(true),
  enableHealthEndpoint: z.boolean().default(true),
  enableStructuredLogging: z.boolean().default(true),
  logLevel: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  enableAuditTrail: z.boolean().default(true),
  anomalyDetectionEnabled: z.boolean().default(true),
  anomalyDetectionThresholds: z.object({
    sessionDurationZScore: z.number().min(1).max(5).default(2.5),
    contextSizeZScore: z.number().min(1).max(5).default(2.5),
    handoffFrequencyZScore: z.number().min(1).max(5).default(2.5)
  }).default({})
});

export const AnalyticsConfigSchema = z.object({
  enableSessionAnalytics: z.boolean().default(true),
  enablePerformanceAnalytics: z.boolean().default(true),
  enableUsageAnalytics: z.boolean().default(true),
  aggregationIntervals: z.object({
    realTime: z.boolean().default(true),
    hourly: z.boolean().default(true),
    daily: z.boolean().default(true),
    weekly: z.boolean().default(true),
    monthly: z.boolean().default(false)
  }).default({}),
  dataRetentionPolicy: z.object({
    rawDataDays: z.number().min(1).max(90).default(30),
    aggregatedDataDays: z.number().min(30).max(730).default(365),
    enableDataCompression: z.boolean().default(true)
  }).default({}),
  reportingEnabled: z.boolean().default(false),
  reportingSchedule: z.string().default('0 6 * * 1'), // Weekly on Monday at 6 AM
  exportFormats: z.array(z.enum(['json', 'csv', 'prometheus'])).default(['json']),
  enableTrendAnalysis: z.boolean().default(true),
  enablePredictiveAnalytics: z.boolean().default(false),
  mlModelUpdateInterval: z.number().min(1).max(168).default(24) // 1 hour to 1 week
});

export const SystemConfigurationSchema = z.object({
  retention: RetentionPolicySchema,
  monitoring: MonitoringConfigSchema,
  analytics: AnalyticsConfigSchema,
  version: z.string().default('1.0.0'),
  lastUpdated: z.date().default(() => new Date()),
  updatedBy: z.string().default('system')
});

// ===== Configuration Manager Service =====

export interface IConfigurationManager {
  // Configuration loading and management
  loadConfiguration(): Promise<SystemConfiguration>;
  saveConfiguration(config: Partial<SystemConfiguration>): Promise<SystemConfiguration>;
  validateConfiguration(config: unknown): SystemConfiguration;
  resetToDefaults(): Promise<SystemConfiguration>;
  
  // Hot reload and watching
  enableHotReload(): void;
  disableHotReload(): void;
  reloadConfiguration(): Promise<SystemConfiguration>;
  
  // Individual config section management
  updateRetentionPolicy(policy: Partial<RetentionPolicy>): Promise<RetentionPolicy>;
  updateMonitoringConfig(config: Partial<MonitoringConfig>): Promise<MonitoringConfig>;
  updateAnalyticsConfig(config: Partial<AnalyticsConfig>): Promise<AnalyticsConfig>;
  
  // Configuration queries
  getRetentionPolicy(): RetentionPolicy;
  getMonitoringConfig(): MonitoringConfig;
  getAnalyticsConfig(): AnalyticsConfig;
  getCurrentConfiguration(): SystemConfiguration;
  
  // Backup and restore
  createBackup(): Promise<string>;
  restoreFromBackup(backupId: string): Promise<SystemConfiguration>;
  listBackups(): Promise<Array<{ id: string; timestamp: Date; version: string }>>;
  
  // Event handling
  on(event: 'configChanged', listener: (config: SystemConfiguration) => void): void;
  on(event: 'configError', listener: (error: Error) => void): void;
  on(event: 'configValidationError', listener: (errors: any) => void): void;
}

/**
 * Configuration Manager Service
 * Handles loading, validation, persistence, and hot-reload of system configuration
 */
export class ConfigurationManager extends EventEmitter implements IConfigurationManager {
  private currentConfig: SystemConfiguration;
  private configFilePath: string;
  private backupDirectory: string;
  private hotReloadEnabled = false;
  private hotReloadInterval?: NodeJS.Timeout | undefined;
  private lastConfigHash?: string;

  constructor(configFilePath?: string, backupDirectory?: string) {
    super();
    
    this.configFilePath = configFilePath || path.join(process.cwd(), 'config', 'system-config.json');
    this.backupDirectory = backupDirectory || path.join(process.cwd(), 'config', 'backups');
    
    // Initialize with default configuration
    this.currentConfig = this.getDefaultConfiguration();
  }

  /**
   * Load configuration from file and database
   */
  async loadConfiguration(): Promise<SystemConfiguration> {
    try {
      let config: SystemConfiguration;
      
      // Try to load from database first
      const dbConfig = await this.loadFromDatabase();
      if (dbConfig) {
        config = dbConfig;
      } else {
        // Fall back to file system
        config = await this.loadFromFile();
      }
      
      // Validate and merge with defaults
      this.currentConfig = this.validateConfiguration(config);
      
      // Update hash for hot reload
      this.lastConfigHash = this.hashConfiguration(this.currentConfig);
      
    structuredLogger.info('Configuration loaded successfully', {
      timestamp: new Date(),
      metadata: {
        component: 'ConfigurationManager',
        operation: 'loadConfiguration',
        status: 'completed',
        version: this.currentConfig.version
      }
    });
      
      return this.currentConfig;
    } catch (error) {
    structuredLogger.error('Failed to load configuration', {
      timestamp: new Date(),
      metadata: {
        errorType: 'SystemError',
        component: 'ConfigurationManager',
        operation: 'loadConfiguration',
        errorMessage: (error as Error).message
      }
    });
      
      this.emit('configError', error);
      
      // Return default configuration on error
      this.currentConfig = this.getDefaultConfiguration();
      return this.currentConfig;
    }
  }

  /**
   * Save configuration to database and file
   */
  async saveConfiguration(config: Partial<SystemConfiguration>): Promise<SystemConfiguration> {
    try {
      // Merge with current configuration
      const mergedConfig = {
        ...this.currentConfig,
        ...config,
        lastUpdated: new Date(),
        version: this.incrementVersion(this.currentConfig.version)
      };
      
      // Validate the merged configuration
      const validatedConfig = this.validateConfiguration(mergedConfig);
      
      // Create backup before saving
      await this.createBackup();
      
      // Save to database
      await this.saveToDatabase(validatedConfig);
      
      // Save to file system
      await this.saveToFile(validatedConfig);
      
      // Update current configuration
      this.currentConfig = validatedConfig;
      this.lastConfigHash = this.hashConfiguration(this.currentConfig);
      
      // Log the configuration change
      await this.logConfigurationChange(validatedConfig, 'system');
      
      // Emit change event
      this.emit('configChanged', validatedConfig);
      
    structuredLogger.info('Configuration saved successfully', {
      timestamp: new Date(),
      metadata: {
        component: 'ConfigurationManager',
        operation: 'saveConfiguration',
        status: 'completed',
        version: validatedConfig.version
      }
    });
      
      return validatedConfig;
    } catch (error) {
    structuredLogger.error('Failed to save configuration', {
      timestamp: new Date(),
      metadata: {
        errorType: 'SystemError',
        component: 'ConfigurationManager',
        operation: 'saveConfiguration',
        errorMessage: (error as Error).message
      }
    });
      
      this.emit('configError', error);
      throw error;
    }
  }

  /**
   * Validate configuration against schemas
   */
  validateConfiguration(config: unknown): SystemConfiguration {
    try {
      const result = SystemConfigurationSchema.safeParse(config);
      
      if (!result.success) {
        const validationError = new Error('Configuration validation failed');
    structuredLogger.error('Configuration validation failed', {
      timestamp: new Date(),
      metadata: {
        errorType: 'ValidationError',
        component: 'ConfigurationManager',
        operation: 'validateConfiguration',
        errors: result.error.flatten()
      }
    });
        
        this.emit('configValidationError', result.error.flatten());
        throw validationError;
      }
      
      return result.data;
    } catch (error) {
      // If validation fails completely, return defaults
    structuredLogger.error('Configuration validation error', {
      timestamp: new Date(),
      metadata: {
        errorType: 'ValidationError',
        component: 'ConfigurationManager',
        operation: 'validateConfiguration',
        errorMessage: (error as Error).message
      }
    });
      
      return this.getDefaultConfiguration();
    }
  }

  /**
   * Reset configuration to defaults
   */
  async resetToDefaults(): Promise<SystemConfiguration> {
    const defaultConfig = this.getDefaultConfiguration();
    return await this.saveConfiguration(defaultConfig);
  }

  /**
   * Enable hot reload of configuration
   */
  enableHotReload(): void {
    if (this.hotReloadEnabled) {
      return;
    }
    
    this.hotReloadEnabled = true;
    this.hotReloadInterval = setInterval(
      () => this.checkForConfigChanges(),
      30000 // Check every 30 seconds
    );
    
    structuredLogger.info('Hot reload enabled', {
      timestamp: new Date(),
      metadata: {
        component: 'ConfigurationManager',
        operation: 'enableHotReload',
        status: 'completed'
      }
    });
  }

  /**
   * Disable hot reload of configuration
   */
  disableHotReload(): void {
    if (!this.hotReloadEnabled) {
      return;
    }
    
    this.hotReloadEnabled = false;
    if (this.hotReloadInterval) {
      clearInterval(this.hotReloadInterval);
      this.hotReloadInterval = undefined;
    }
    
    structuredLogger.info('Hot reload disabled', {
      timestamp: new Date(),
      metadata: {
        component: 'ConfigurationManager',
        operation: 'disableHotReload',
        status: 'completed'
      }
    });
  }

  /**
   * Manually reload configuration
   */
  async reloadConfiguration(): Promise<SystemConfiguration> {
    const oldConfig = { ...this.currentConfig };
    const newConfig = await this.loadConfiguration();
    
    if (this.hashConfiguration(oldConfig) !== this.hashConfiguration(newConfig)) {
      this.emit('configChanged', newConfig);
    }
    
    return newConfig;
  }

  /**
   * Update retention policy
   */
  async updateRetentionPolicy(policy: Partial<RetentionPolicy>): Promise<RetentionPolicy> {
    const updatedConfig = await this.saveConfiguration({
      retention: { ...this.currentConfig.retention, ...policy }
    });
    return updatedConfig.retention;
  }

  /**
   * Update monitoring configuration
   */
  async updateMonitoringConfig(config: Partial<MonitoringConfig>): Promise<MonitoringConfig> {
    const updatedConfig = await this.saveConfiguration({
      monitoring: { ...this.currentConfig.monitoring, ...config }
    });
    return updatedConfig.monitoring;
  }

  /**
   * Update analytics configuration
   */
  async updateAnalyticsConfig(config: Partial<AnalyticsConfig>): Promise<AnalyticsConfig> {
    const updatedConfig = await this.saveConfiguration({
      analytics: { ...this.currentConfig.analytics, ...config }
    });
    return updatedConfig.analytics;
  }

  /**
   * Get current retention policy
   */
  getRetentionPolicy(): RetentionPolicy {
    return this.currentConfig.retention;
  }

  /**
   * Get current monitoring configuration
   */
  getMonitoringConfig(): MonitoringConfig {
    return this.currentConfig.monitoring;
  }

  /**
   * Get current analytics configuration
   */
  getAnalyticsConfig(): AnalyticsConfig {
    return this.currentConfig.analytics;
  }

  /**
   * Get current full configuration
   */
  getCurrentConfiguration(): SystemConfiguration {
    return { ...this.currentConfig };
  }

  /**
   * Create a backup of current configuration
   */
  async createBackup(): Promise<string> {
    try {
      const timestamp = new Date().toISOString();
      const backupId = `config-backup-${timestamp}`;
      const backupPath = path.join(this.backupDirectory, `${backupId}.json`);
      
      const backupData = {
        id: backupId,
        timestamp: new Date(),
        config: this.currentConfig
      };
      
      // Ensure backup directory exists
      await this.ensureDirectoryExists(this.backupDirectory);
      
      // Write backup file
      await writeFile(backupPath, JSON.stringify(backupData, null, 2));
      
      // Store backup metadata in database
      await db.query(
        'INSERT INTO configuration_backups (backup_id, backup_path, config_version, created_at) VALUES ($1, $2, $3, $4)',
        [backupId, backupPath, this.currentConfig.version, new Date()]
      );
      
    structuredLogger.info('Configuration backup created', {
      timestamp: new Date(),
      metadata: {
        component: 'ConfigurationManager',
        operation: 'createBackup',
        status: 'completed',
        backupId,
        backupPath
      }
    });
      
      return backupId;
    } catch (error) {
    structuredLogger.error('Failed to create configuration backup', {
      timestamp: new Date(),
      metadata: {
        errorType: 'SystemError',
        component: 'ConfigurationManager',
        operation: 'createBackup',
        errorMessage: (error as Error).message
      }
    });
      throw error;
    }
  }

  /**
   * Restore configuration from backup
   */
  async restoreFromBackup(backupId: string): Promise<SystemConfiguration> {
    try {
      // Get backup metadata from database
      const backupResult = await db.query(
        'SELECT backup_path FROM configuration_backups WHERE backup_id = $1',
        [backupId]
      );
      
      if (backupResult.rows.length === 0) {
        throw new Error(`Backup not found: ${backupId}`);
      }
      
      const backupPath = backupResult.rows[0].backup_path;
      
      // Read backup file
      const backupData = JSON.parse(await readFile(backupPath, 'utf-8'));
      
      // Restore configuration
      const restoredConfig = await this.saveConfiguration(backupData.config);
      
      // Log restoration
      await this.logConfigurationChange(restoredConfig, 'backup-restore');
      
    structuredLogger.info('Configuration restored from backup', {
      timestamp: new Date(),
      metadata: {
        component: 'ConfigurationManager',
        operation: 'restoreFromBackup',
        status: 'completed',
        backupId,
        version: restoredConfig.version
      }
    });
      
      return restoredConfig;
    } catch (error) {
    structuredLogger.error('Failed to restore configuration from backup', {
      timestamp: new Date(),
      metadata: {
        errorType: 'SystemError',
        component: 'ConfigurationManager',
        operation: 'restoreFromBackup',
        errorMessage: (error as Error).message
      }
    });
      throw error;
    }
  }

  /**
   * List available backups
   */
  async listBackups(): Promise<Array<{ id: string; timestamp: Date; version: string }>> {
    try {
      const result = await db.query(
        'SELECT backup_id, created_at, config_version FROM configuration_backups ORDER BY created_at DESC'
      );
      
      return result.rows.map(row => ({
        id: row.backup_id,
        timestamp: row.created_at,
        version: row.config_version
      }));
    } catch (error) {
    structuredLogger.error('Failed to list configuration backups', {
      timestamp: new Date(),
      metadata: {
        errorType: 'SystemError',
        component: 'ConfigurationManager',
        operation: 'listBackups',
        errorMessage: (error as Error).message
      }
    });
      return [];
    }
  }

  // ===== Private Methods =====

  /**
   * Get default system configuration
   */
  private getDefaultConfiguration(): SystemConfiguration {
    return {
      retention: RetentionPolicySchema.parse({}),
      monitoring: MonitoringConfigSchema.parse({}),
      analytics: AnalyticsConfigSchema.parse({}),
      version: '1.0.0',
      lastUpdated: new Date(),
      updatedBy: 'system'
    };
  }

  /**
   * Load configuration from database
   */
  private async loadFromDatabase(): Promise<SystemConfiguration | null> {
    try {
      const result = await db.query(
        'SELECT config_data FROM system_configuration ORDER BY created_at DESC LIMIT 1'
      );
      
      if (result.rows.length === 0) {
        return null;
      }
      
      return result.rows[0].config_data;
    } catch (error) {
    structuredLogger.error('Failed to load configuration from database', {
      timestamp: new Date(),
      metadata: {
        errorType: 'SystemError',
        component: 'ConfigurationManager',
        operation: 'loadFromDatabase',
        errorMessage: (error as Error).message
      }
    });
      return null;
    }
  }

  /**
   * Save configuration to database
   */
  private async saveToDatabase(config: SystemConfiguration): Promise<void> {
    await db.query(
      'INSERT INTO system_configuration (config_data, version, updated_by) VALUES ($1, $2, $3)',
      [JSON.stringify(config), config.version, config.updatedBy]
    );
  }

  /**
   * Load configuration from file
   */
  private async loadFromFile(): Promise<SystemConfiguration> {
    try {
      await access(this.configFilePath, constants.F_OK);
      const fileContent = await readFile(this.configFilePath, 'utf-8');
      return JSON.parse(fileContent);
    } catch (error) {
      // File doesn't exist or can't be read, return defaults
      return this.getDefaultConfiguration();
    }
  }

  /**
   * Save configuration to file
   */
  private async saveToFile(config: SystemConfiguration): Promise<void> {
    await this.ensureDirectoryExists(path.dirname(this.configFilePath));
    await writeFile(this.configFilePath, JSON.stringify(config, null, 2));
  }

  /**
   * Check for configuration changes (hot reload)
   */
  private async checkForConfigChanges(): Promise<void> {
    try {
      const dbConfig = await this.loadFromDatabase();
      if (dbConfig) {
        const newHash = this.hashConfiguration(dbConfig);
        if (newHash !== this.lastConfigHash) {
          const validatedConfig = this.validateConfiguration(dbConfig);
          this.currentConfig = validatedConfig;
          this.lastConfigHash = newHash;
          this.emit('configChanged', validatedConfig);
        }
      }
    } catch (error) {
      this.emit('configError', error);
    }
  }

  /**
   * Hash configuration for change detection
   */
  private hashConfiguration(config: SystemConfiguration): string {
    return Buffer.from(JSON.stringify(config)).toString('base64');
  }

  /**
   * Increment version number
   */
  private incrementVersion(version: string): string {
    const parts = version.split('.');
    const patch = parseInt(parts[2] || '0') + 1;
    return `${parts[0]}.${parts[1]}.${patch}`;
  }

  /**
   * Log configuration changes for audit trail
   */
  private async logConfigurationChange(config: SystemConfiguration, changedBy: string): Promise<void> {
    try {
      await db.query(
        'INSERT INTO configuration_audit_log (config_version, changed_by, change_timestamp, config_snapshot) VALUES ($1, $2, $3, $4)',
        [config.version, changedBy, new Date(), JSON.stringify(config)]
      );
    } catch (error) {
    structuredLogger.error('Failed to log configuration change', {
      timestamp: new Date(),
      metadata: {
        errorType: 'SystemError',
        component: 'ConfigurationManager',
        operation: 'logConfigurationChange',
        errorMessage: (error as Error).message
      }
    });
    }
  }

  /**
   * Ensure directory exists
   */
  private async ensureDirectoryExists(dirPath: string): Promise<void> {
    try {
      await access(dirPath, constants.F_OK);
    } catch {
      // Directory doesn't exist, create it
      await require('fs').promises.mkdir(dirPath, { recursive: true });
    }
  }
}

// Create and export singleton instance
export const configurationManager = new ConfigurationManager();