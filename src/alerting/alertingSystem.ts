// Alerting system for critical system metrics with notification routing
import { EventEmitter } from 'events';
import { MetricAlert } from '../metrics/types';

// Alerting configuration
interface AlertingConfig {
  enableEmailNotifications: boolean;
  enableSlackNotifications: boolean;
  enableWebhookNotifications: boolean;
  emailRecipients: string[];
  slackWebhookUrl: string;
  webhookUrl: string;
  enableDeduplication: boolean;
  deduplicationWindow: number; // milliseconds
  enableEscalation: boolean;
  escalationThreshold: number; // number of alerts before escalation
  escalationRecipients: string[];
}

// Alert notification
interface AlertNotification {
  id: string;
  alert: MetricAlert;
  timestamp: Date;
  status: 'SENT' | 'FAILED' | 'PENDING';
  channels: string[];
  escalationLevel: number;
}

// Alerting system
export class AlertingSystem extends EventEmitter {
  private config: AlertingConfig;
  private activeAlerts: Map<string, AlertNotification>;
  private alertHistory: AlertNotification[];
  private deduplicationCache: Map<string, number>;
  private escalationCounters: Map<string, number>;

  constructor(config?: Partial<AlertingConfig>) {
    super();
    
    this.config = {
      enableEmailNotifications: config?.enableEmailNotifications || false,
      enableSlackNotifications: config?.enableSlackNotifications || false,
      enableWebhookNotifications: config?.enableWebhookNotifications || false,
      emailRecipients: config?.emailRecipients || [],
      slackWebhookUrl: config?.slackWebhookUrl || '',
      webhookUrl: config?.webhookUrl || '',
      enableDeduplication: config?.enableDeduplication !== undefined ? config.enableDeduplication : true,
      deduplicationWindow: config?.deduplicationWindow || 300000, // 5 minutes
      enableEscalation: config?.enableEscalation || false,
      escalationThreshold: config?.escalationThreshold || 3,
      escalationRecipients: config?.escalationRecipients || []
    };
    
    this.activeAlerts = new Map();
    this.alertHistory = [];
    this.deduplicationCache = new Map();
    this.escalationCounters = new Map();
  }

  // Process incoming alert
  async processAlert(alert: MetricAlert): Promise<void> {
    try {
      // Check for deduplication
      if (this.config.enableDeduplication && this.isDuplicateAlert(alert)) {
        console.debug(`Duplicate alert suppressed: ${alert.type}`);
        return;
      }
      
      // Generate alert ID
      const alertId = this.generateAlertId(alert);
      
      // Check for escalation
      const escalationLevel = this.checkEscalation(alert.type);
      
      // Create alert notification
      const notification: AlertNotification = {
        id: alertId,
        alert,
        timestamp: new Date(),
        status: 'PENDING',
        channels: this.getNotificationChannels(),
        escalationLevel
      };
      
      // Add to active alerts
      this.activeAlerts.set(alertId, notification);
      
      // Send notifications
      await this.sendNotifications(notification);
      
      // Update status
      notification.status = 'SENT';
      
      // Add to history
      this.alertHistory.push(notification);
      if (this.alertHistory.length > 1000) {
        this.alertHistory.shift();
      }
      
      // Emit event
      this.emit('alertProcessed', notification);
      
      console.info(`Alert processed: ${alert.type} - ${alert.message}`);
    } catch (error) {
      console.error('Error processing alert:', error);
      this.emit('error', error);
    }
  }

  // Check if alert is duplicate
  private isDuplicateAlert(alert: MetricAlert): boolean {
    const key = `${alert.type}-${alert.message}`;
    const lastTimestamp = this.deduplicationCache.get(key);
    
    if (lastTimestamp) {
      const now = Date.now();
      if (now - lastTimestamp < this.config.deduplicationWindow) {
        return true;
      }
    }
    
    // Update cache
    this.deduplicationCache.set(key, Date.now());
    
    // Clean up old cache entries
    this.cleanupDeduplicationCache();
    
    return false;
  }

  // Cleanup deduplication cache
  private cleanupDeduplicationCache(): void {
    const now = Date.now();
    const expirationTime = this.config.deduplicationWindow * 2;
    
    for (const [key, timestamp] of this.deduplicationCache.entries()) {
      if (now - timestamp > expirationTime) {
        this.deduplicationCache.delete(key);
      }
    }
  }

  // Check for escalation
  private checkEscalation(alertType: string): number {
    if (!this.config.enableEscalation) {
      return 0;
    }
    
    const counter = this.escalationCounters.get(alertType) || 0;
    const newCounter = counter + 1;
    this.escalationCounters.set(alertType, newCounter);
    
    // Reset counter if alert is resolved (simplified logic)
    if (newCounter > this.config.escalationThreshold * 2) {
      this.escalationCounters.set(alertType, 0);
      return 0;
    }
    
    return Math.floor(newCounter / this.config.escalationThreshold);
  }

  // Generate alert ID
  private generateAlertId(alert: MetricAlert): string {
    return `${alert.type}-${alert.timestamp.getTime()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // Get notification channels
  private getNotificationChannels(): string[] {
    const channels: string[] = [];
    
    if (this.config.enableEmailNotifications) {
      channels.push('email');
    }
    
    if (this.config.enableSlackNotifications) {
      channels.push('slack');
    }
    
    if (this.config.enableWebhookNotifications) {
      channels.push('webhook');
    }
    
    return channels;
  }

  // Send notifications
  private async sendNotifications(notification: AlertNotification): Promise<void> {
    const promises: Promise<void>[] = [];
    
    // Send email notifications
    if (this.config.enableEmailNotifications && this.config.emailRecipients.length > 0) {
      promises.push(this.sendEmailNotification(notification));
    }
    
    // Send Slack notifications
    if (this.config.enableSlackNotifications && this.config.slackWebhookUrl) {
      promises.push(this.sendSlackNotification(notification));
    }
    
    // Send webhook notifications
    if (this.config.enableWebhookNotifications && this.config.webhookUrl) {
      promises.push(this.sendWebhookNotification(notification));
    }
    
    // Wait for all notifications to be sent
    await Promise.allSettled(promises);
  }

  // Send email notification (simulated)
  private async sendEmailNotification(notification: AlertNotification): Promise<void> {
    try {
      // In a real implementation, this would send actual emails
      console.debug(`Sending email notification to ${this.config.emailRecipients.length} recipients`);
      
      // Simulate email sending delay
      await new Promise(resolve => setTimeout(resolve, 100));
      
      console.debug(`Email notification sent for alert ${notification.id}`);
    } catch (error) {
      console.error('Error sending email notification:', error);
      throw error;
    }
  }

  // Send Slack notification (simulated)
  private async sendSlackNotification(notification: AlertNotification): Promise<void> {
    try {
      // In a real implementation, this would send actual Slack messages
      console.debug(`Sending Slack notification to webhook`);
      
      // Simulate Slack sending delay
      await new Promise(resolve => setTimeout(resolve, 100));
      
      console.debug(`Slack notification sent for alert ${notification.id}`);
    } catch (error) {
      console.error('Error sending Slack notification:', error);
      throw error;
    }
  }

  // Send webhook notification (simulated)
  private async sendWebhookNotification(notification: AlertNotification): Promise<void> {
    try {
      // In a real implementation, this would send actual webhook requests
      console.debug(`Sending webhook notification to ${this.config.webhookUrl}`);
      
      // Simulate webhook sending delay
      await new Promise(resolve => setTimeout(resolve, 100));
      
      console.debug(`Webhook notification sent for alert ${notification.id}`);
    } catch (error) {
      console.error('Error sending webhook notification:', error);
      throw error;
    }
  }

  // Resolve alert
  resolveAlert(alertId: string): boolean {
    const notification = this.activeAlerts.get(alertId);
    if (!notification) {
      return false;
    }
    
    // Remove from active alerts
    this.activeAlerts.delete(alertId);
    
    // Emit event
    this.emit('alertResolved', notification);
    
    console.info(`Alert resolved: ${alertId}`);
    return true;
  }

  // Get active alerts
  getActiveAlerts(): AlertNotification[] {
    return Array.from(this.activeAlerts.values());
  }

  // Get alert history
  getAlertHistory(limit?: number): AlertNotification[] {
    const history = [...this.alertHistory].reverse();
    return limit ? history.slice(0, limit) : history;
  }

  // Get alert statistics
  getAlertStatistics(): {
    totalAlerts: number;
    activeAlerts: number;
    resolvedAlerts: number;
    escalationCount: number;
  } {
    return {
      totalAlerts: this.alertHistory.length,
      activeAlerts: this.activeAlerts.size,
      resolvedAlerts: this.alertHistory.length - this.activeAlerts.size,
      escalationCount: Array.from(this.escalationCounters.values()).reduce((sum, count) => sum + count, 0)
    };
  }

  // Update configuration
  updateConfig(newConfig: Partial<AlertingConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.info('Alerting configuration updated');
  }

  // Close alerting system and cleanup resources
  close(): void {
    this.activeAlerts.clear();
    this.alertHistory.length = 0;
    this.deduplicationCache.clear();
    this.escalationCounters.clear();
    
    console.info('Alerting system closed');
  }
}

// Export alerting utilities
export interface AlertingUtils {
  formatAlertMessage: (alert: MetricAlert) => string;
  getAlertSeverityColor: (severity: MetricAlert['severity']) => string;
  shouldNotify: (alert: MetricAlert, timeWindow: number) => boolean;
}

// Alerting utilities
export const alertingUtils: AlertingUtils = {
  // Format alert message
  formatAlertMessage(alert: MetricAlert): string {
    return `[${alert.severity}] ${alert.type}: ${alert.message} (Value: ${alert.value}, Threshold: ${alert.threshold})`;
  },

  // Get alert severity color
  getAlertSeverityColor(severity: MetricAlert['severity']): string {
    switch (severity) {
      case 'CRITICAL':
        return '#FF0000'; // Red
      case 'WARNING':
        return '#FFA500'; // Orange
      default:
        return '#000000'; // Black
    }
  },

  // Check if alert should notify based on time window
  shouldNotify(alert: MetricAlert, timeWindow: number): boolean {
    const now = Date.now();
    const alertTime = alert.timestamp.getTime();
    return now - alertTime < timeWindow;
  }
};

// Export optimized alerting client
export interface OptimizedAlertingClient {
  alertingSystem: AlertingSystem;
  utils: AlertingUtils;
}

// Create optimized alerting system
export function createOptimizedAlertingSystem(config?: Partial<AlertingConfig>): OptimizedAlertingClient {
  const alertingSystem = new AlertingSystem(config);
  
  return {
    alertingSystem,
    utils: alertingUtils
  };
}