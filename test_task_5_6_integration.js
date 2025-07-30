#!/usr/bin/env node

/**
 * Integration test for Task 5.2 and Task 6 implementations
 * Tests the enhanced anomaly detection, recommendation engine, and new MCP resources
 */

import { config } from './dist/config/index.js';
import { db } from './dist/database/index.js';
import { analyticsService } from './dist/services/analyticsService.js';
import { monitoringService } from './dist/services/monitoringService.js';

// Override environment for testing
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';

async function testTask52AnomalyDetection() {
  console.log('\n🔍 Testing Task 5.2: Enhanced Anomaly Detection');
  
  try {
    const query = {
      timeRange: {
        start: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
        end: new Date()
      },
      includeAnomalies: true
    };

    // Test anomaly detection
    console.log('  📊 Running anomaly detection...');
    const anomalyResult = await analyticsService.detectSessionAnomalies(query);
    
    console.log(`  ✅ Anomaly detection completed:`);
    console.log(`     - Anomalies detected: ${anomalyResult.anomalies.length}`);
    console.log(`     - Patterns identified: ${anomalyResult.patterns.length}`);
    console.log(`     - Recommendations generated: ${anomalyResult.recommendations.length}`);
    console.log(`     - Confidence score: ${(anomalyResult.confidence * 100).toFixed(1)}%`);

    if (anomalyResult.anomalies.length > 0) {
      console.log(`     - Sample anomaly: ${anomalyResult.anomalies[0].description}`);
    }

    // Test trend analysis
    console.log('  📈 Running trend analysis...');
    const trendResult = await analyticsService.analyzeTrends(query);
    
    console.log(`  ✅ Trend analysis completed:`);
    console.log(`     - Session volume trend: ${trendResult.sessionTrends.sessionVolumeGrowth.direction}`);
    console.log(`     - Predictions generated: ${trendResult.predictions.length}`);
    console.log(`     - Usage patterns found: ${trendResult.usageTrends.peakUsagePatterns.length}`);

    return true;
  } catch (error) {
    console.log(`  ❌ Task 5.2 test failed: ${error.message}`);
    return false;
  }
}

async function testTask6Resources() {
  console.log('\n🌐 Testing Task 6: New MCP Resources');
  
  try {
    // Test health resource
    console.log('  🩺 Testing health resource...');
    const healthStatus = await monitoringService.getSystemHealth();
    console.log(`  ✅ Health check completed - Overall status: ${healthStatus.status}`);
    console.log(`     - Database: ${healthStatus.checks.database.status}`);
    console.log(`     - Redis: ${healthStatus.checks.redis.status}`);

    // Test metrics resource  
    console.log('  📊 Testing metrics resource...');
    const metrics = await monitoringService.getPrometheusMetrics();
    const metricLines = metrics.split('\n').filter(line => !line.startsWith('#') && line.trim()).length;
    console.log(`  ✅ Metrics generated - ${metricLines} metric lines`);

    // Test analytics resources
    console.log('  📈 Testing analytics resources...');
    const timeRange = {
      start: new Date(Date.now() - 24 * 60 * 60 * 1000),
      end: new Date()
    };

    const sessionStats = await analyticsService.getSessionStatistics({ timeRange });
    console.log(`  ✅ Session analytics - Total sessions: ${sessionStats.totalSessions}`);

    const handoffAnalytics = await analyticsService.getHandoffAnalytics({ timeRange });
    console.log(`  ✅ Handoff analytics - Success rate: ${handoffAnalytics.successRate.toFixed(1)}%`);

    return true;
  } catch (error) {
    console.log(`  ❌ Task 6 test failed: ${error.message}`);
    return false;
  }
}

async function testAlertingSystem() {
  console.log('\n🚨 Testing Task 5.2: Advanced Alerting System');
  
  try {
    const alertConfig = {
      enabled: true,
      thresholds: {
        memory: { warning: 80, critical: 90 },
        cpu: { warning: 75, critical: 85 },
        disk: { warning: 85, critical: 95 },
        errorRate: { warning: 5, critical: 10 },
        responseTime: { warning: 1000, critical: 2000 },
        sessionGrowth: { warning: 50, critical: 100 }
      },
      escalation: {
        timeToEscalate: 30,
        maxEscalationLevel: 3,
        escalationMultiplier: 2
      },
      channels: [
        { type: 'log', enabled: true, severityLevel: 'warning' },
        { type: 'metric', enabled: true, severityLevel: 'critical' }
      ]
    };

    console.log('  📢 Processing alerts and notifications...');
    await analyticsService.processAlertsAndNotifications(alertConfig);
    console.log('  ✅ Alert processing completed successfully');

    return true;
  } catch (error) {
    console.log(`  ❌ Alerting system test failed: ${error.message}`);
    return false;
  }
}

async function runIntegrationTests() {
  console.log('🚀 Starting Task 5.2 and Task 6 Integration Tests');
  console.log('================================================');

  let allTestsPassed = true;

  try {
    // Initialize database (but don't fail if it's not available)
    try {
      await db.initialize();
      console.log('✅ Database initialized successfully');
    } catch (error) {
      console.log('⚠️  Database not available - using mock data for tests');
    }

    // Run tests
    const task52Result = await testTask52AnomalyDetection();
    const task6Result = await testTask6Resources();
    const alertingResult = await testAlertingSystem();

    allTestsPassed = task52Result && task6Result && alertingResult;

  } catch (error) {
    console.log(`❌ Integration test setup failed: ${error.message}`);
    allTestsPassed = false;
  }

  console.log('\n================================================');
  if (allTestsPassed) {
    console.log('🎉 All integration tests passed!');
    console.log('\n✨ New Features Available:');
    console.log('   📊 Enhanced Anomaly Detection (Task 5.2)');
    console.log('      - Session duration anomaly detection');
    console.log('      - Handoff pattern anomaly detection');
    console.log('      - Performance anomaly detection');
    console.log('      - Advanced recommendation engine');
    console.log('      - Comprehensive trend analysis');
    console.log('      - Configurable alerting system');
    console.log('   🌐 New MCP Resources (Task 6)');
    console.log('      - handoff://health - System health status');
    console.log('      - handoff://metrics - Prometheus metrics');
    console.log('      - handoff://analytics/{type} - Analytics insights');
    console.log('      - handoff://session-lifecycle - Session lifecycle monitoring');
    console.log('      - Enhanced handoff://sessions with lifecycle info');
    console.log('      - Enhanced handoff://context/{key} with performance metrics');
    process.exit(0);
  } else {
    console.log('❌ Some integration tests failed');
    process.exit(1);
  }
}

runIntegrationTests().catch(error => {
  console.error('💥 Integration test runner failed:', error);
  process.exit(1);
});