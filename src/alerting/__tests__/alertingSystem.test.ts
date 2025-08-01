import { AlertingSystem, alertingUtils, createOptimizedAlertingSystem } from '../alertingSystem';
import { MetricAlert } from '../../metrics/types';

// Mock console methods
const mockConsoleDebug = jest.spyOn(console, 'debug').mockImplementation();
const mockConsoleInfo = jest.spyOn(console, 'info').mockImplementation();
const mockConsoleError = jest.spyOn(console, 'error').mockImplementation();

describe('AlertingSystem', () => {
  let alertingSystem: AlertingSystem;
  let mockAlert: MetricAlert;

  beforeEach(() => {
    alertingSystem = new AlertingSystem({
      enableEmailNotifications: true,
      enableSlackNotifications: true,
      enableWebhookNotifications: true,
      emailRecipients: ['test@example.com'],
      slackWebhookUrl: 'https://hooks.slack.com/services/test',
      webhookUrl: 'https://webhook.example.com/alerts'
    });

    mockAlert = {
      type: 'HIGH_MEMORY_USAGE',
      severity: 'WARNING',
      message: 'Memory usage exceeded threshold',
      timestamp: new Date(),
      value: 85.5,
      threshold: 80
    };
  });

  afterEach(() => {
    alertingSystem.close();
    jest.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize with default configuration', () => {
      const defaultSystem = new AlertingSystem();
      expect(defaultSystem).toBeInstanceOf(AlertingSystem);
      defaultSystem.close();
    });

    it('should initialize with custom configuration', () => {
      const customSystem = new AlertingSystem({
        enableEmailNotifications: true,
        emailRecipients: ['admin@example.com']
      });
      
      expect(customSystem).toBeInstanceOf(AlertingSystem);
      customSystem.close();
    });
  });

  describe('Alert Processing', () => {
    it('should process alert successfully', async () => {
      const alertProcessedCallback = jest.fn();
      alertingSystem.on('alertProcessed', alertProcessedCallback);

      await alertingSystem.processAlert(mockAlert);

      expect(alertProcessedCallback).toHaveBeenCalled();
      expect(mockConsoleInfo).toHaveBeenCalledWith(
        expect.stringContaining('Alert processed')
      );
    });

    it('should suppress duplicate alerts', async () => {
      // Process the same alert twice
      await alertingSystem.processAlert(mockAlert);
      await alertingSystem.processAlert(mockAlert);

      // Second alert should be suppressed
      expect(mockConsoleDebug).toHaveBeenCalledWith(
        expect.stringContaining('Duplicate alert suppressed')
      );
    });

    it('should handle alert processing errors', async () => {
      const errorCallback = jest.fn();
      alertingSystem.on('error', errorCallback);

      // Force an error by mocking a failure
      jest.spyOn(alertingSystem as any, 'sendNotifications').mockRejectedValue(new Error('Test error'));

      await alertingSystem.processAlert(mockAlert);

      expect(errorCallback).toHaveBeenCalled();
      expect(mockConsoleError).toHaveBeenCalledWith(
        'Error processing alert:',
        expect.any(Error)
      );
    });
  });

  describe('Alert Resolution', () => {
    it('should resolve active alert', async () => {
      const alertResolvedCallback = jest.fn();
      alertingSystem.on('alertResolved', alertResolvedCallback);

      // Process an alert first
      await alertingSystem.processAlert(mockAlert);
      
      // Get the alert ID from active alerts
      const activeAlerts = alertingSystem.getActiveAlerts();
      const alertId = activeAlerts[0].id;

      // Resolve the alert
      const result = alertingSystem.resolveAlert(alertId);

      expect(result).toBe(true);
      expect(alertResolvedCallback).toHaveBeenCalled();
      expect(mockConsoleInfo).toHaveBeenCalledWith(
        expect.stringContaining('Alert resolved')
      );
    });

    it('should return false for non-existent alert resolution', () => {
      const result = alertingSystem.resolveAlert('non-existent-id');
      expect(result).toBe(false);
    });
  });

  describe('Alert Management', () => {
    it('should get active alerts', async () => {
      await alertingSystem.processAlert(mockAlert);
      const activeAlerts = alertingSystem.getActiveAlerts();
      
      expect(activeAlerts).toHaveLength(1);
      expect(activeAlerts[0].alert).toEqual(mockAlert);
    });

    it('should get alert history', async () => {
      await alertingSystem.processAlert(mockAlert);
      const history = alertingSystem.getAlertHistory();
      
      expect(history).toHaveLength(1);
      expect(history[0].alert).toEqual(mockAlert);
    });

    it('should limit alert history by count', async () => {
      // Process multiple alerts
      for (let i = 0; i < 5; i++) {
        await alertingSystem.processAlert({
          ...mockAlert,
          message: `Test alert ${i}`
        });
      }
      
      const history = alertingSystem.getAlertHistory(3);
      expect(history).toHaveLength(3);
    });

    it('should get alert statistics', async () => {
      // Process an alert
      await alertingSystem.processAlert(mockAlert);
      
      const stats = alertingSystem.getAlertStatistics();
      expect(stats.totalAlerts).toBe(1);
      expect(stats.activeAlerts).toBe(1);
      expect(stats.resolvedAlerts).toBe(0);
    });
  });

  describe('Configuration Management', () => {
    it('should update configuration', () => {
      const initialConfig = { enableEmailNotifications: true };
      const system = new AlertingSystem(initialConfig);
      
      system.updateConfig({ enableSlackNotifications: true });
      
      // Note: We can't directly check private config, but we can verify the method was called
      expect(mockConsoleInfo).toHaveBeenCalledWith('Alerting configuration updated');
      
      system.close();
    });
  });

  describe('Notification Channels', () => {
    it('should send notifications to all enabled channels', async () => {
      const sendEmailSpy = jest.spyOn(alertingSystem as any, 'sendEmailNotification');
      const sendSlackSpy = jest.spyOn(alertingSystem as any, 'sendSlackNotification');
      const sendWebhookSpy = jest.spyOn(alertingSystem as any, 'sendWebhookNotification');

      await alertingSystem.processAlert(mockAlert);

      expect(sendEmailSpy).toHaveBeenCalled();
      expect(sendSlackSpy).toHaveBeenCalled();
      expect(sendWebhookSpy).toHaveBeenCalled();
    });

    it('should not send notifications when all channels are disabled', async () => {
      const system = new AlertingSystem({
        enableEmailNotifications: false,
        enableSlackNotifications: false,
        enableWebhookNotifications: false
      });

      const sendEmailSpy = jest.spyOn(system as any, 'sendEmailNotification');
      const sendSlackSpy = jest.spyOn(system as any, 'sendSlackNotification');
      const sendWebhookSpy = jest.spyOn(system as any, 'sendWebhookNotification');

      await system.processAlert(mockAlert);

      // Notifications should not be sent
      expect(sendEmailSpy).not.toHaveBeenCalled();
      expect(sendSlackSpy).not.toHaveBeenCalled();
      expect(sendWebhookSpy).not.toHaveBeenCalled();

      system.close();
    });
  });

  describe('Escalation Management', () => {
    it('should handle alert escalation', async () => {
      const escalationSystem = new AlertingSystem({
        enableEscalation: true,
        escalationThreshold: 2,
        escalationRecipients: ['escalation@example.com']
      });

      // Process the same alert type multiple times to trigger escalation
      const alert1 = { ...mockAlert };
      const alert2 = { ...mockAlert };
      
      await escalationSystem.processAlert(alert1);
      await escalationSystem.processAlert(alert2);

      // Check that alerts were processed (we can't directly check escalation level in private methods)
      const activeAlerts = escalationSystem.getActiveAlerts();
      expect(activeAlerts).toHaveLength(2);

      escalationSystem.close();
    });
  });
});

describe('AlertingUtils', () => {
  describe('formatAlertMessage', () => {
    it('should format alert message correctly', () => {
      const alert: MetricAlert = {
        type: 'HIGH_CPU_USAGE',
        severity: 'CRITICAL',
        message: 'CPU usage is too high',
        timestamp: new Date(),
        value: 95.5,
        threshold: 90
      };

      const formatted = alertingUtils.formatAlertMessage(alert);
      expect(formatted).toBe('[CRITICAL] HIGH_CPU_USAGE: CPU usage is too high (Value: 95.5, Threshold: 90)');
    });
  });

  describe('getAlertSeverityColor', () => {
    it('should return correct color for CRITICAL severity', () => {
      const color = alertingUtils.getAlertSeverityColor('CRITICAL');
      expect(color).toBe('#FF0000');
    });

    it('should return correct color for WARNING severity', () => {
      const color = alertingUtils.getAlertSeverityColor('WARNING');
      expect(color).toBe('#FFA500');
    });
  });

  describe('shouldNotify', () => {
    it('should return true for recent alerts', () => {
      const alert: MetricAlert = {
        type: 'HIGH_MEMORY_USAGE',
        severity: 'WARNING',
        message: 'Memory usage exceeded threshold',
        timestamp: new Date(),
        value: 85.5,
        threshold: 80
      };

      const shouldNotify = alertingUtils.shouldNotify(alert, 60000); // 1 minute window
      expect(shouldNotify).toBe(true);
    });

    it('should return false for old alerts', () => {
      const oldAlert: MetricAlert = {
        type: 'HIGH_MEMORY_USAGE',
        severity: 'WARNING',
        message: 'Memory usage exceeded threshold',
        timestamp: new Date(Date.now() - 120000), // 2 minutes ago
        value: 85.5,
        threshold: 80
      };

      const shouldNotify = alertingUtils.shouldNotify(oldAlert, 60000); // 1 minute window
      expect(shouldNotify).toBe(false);
    });
  });
});

describe('OptimizedAlertingClient', () => {
  it('should create optimized alerting client', () => {
    const client = createOptimizedAlertingSystem({
      enableEmailNotifications: true,
      emailRecipients: ['test@example.com']
    });

    expect(client).toHaveProperty('alertingSystem');
    expect(client).toHaveProperty('utils');
    expect(client.alertingSystem).toBeInstanceOf(AlertingSystem);
    expect(client.utils).toBe(alertingUtils);

    client.alertingSystem.close();
  });

  it('should create optimized alerting client with default config', () => {
    const client = createOptimizedAlertingSystem();
    
    expect(client).toHaveProperty('alertingSystem');
    expect(client).toHaveProperty('utils');
    
    client.alertingSystem.close();
  });
});

// Restore console methods
afterAll(() => {
  mockConsoleDebug.mockRestore();
  mockConsoleInfo.mockRestore();
  mockConsoleError.mockRestore();
});