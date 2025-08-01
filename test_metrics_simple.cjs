// Simple test to verify metrics collection is working
const { MetricsCollector } = require('./dist/metrics/metricsCollection');

async function testMetrics() {
  console.log('Testing metrics collection...');
  
  // Create metrics collector
  const collector = new MetricsCollector({
    collectionInterval: 5000, // 5 seconds
    enableAlerting: true,
    alertThresholds: {
      maxResponseTime: 1000,
      maxErrorRate: 5,
      maxDatabaseLatency: 500,
      maxDatabaseErrors: 10,
      maxApiErrors: 5,
      maxMemoryUsage: 80,
      maxCpuUsage: 80
    }
  });
  
  // Listen for alerts
  collector.on('alert', (alert) => {
    console.log('ALERT:', alert.type, alert.message);
  });
  
  // Listen for metrics updates
  collector.on('metrics', (metrics) => {
    console.log('METRICS UPDATE:', {
      uptime: Math.round(metrics.uptime / 1000) + 's',
      memory: metrics.technical.memoryUsage.toFixed(2) + '%',
      cpu: metrics.technical.cpuUsage.toFixed(2) + '%'
    });
  });
  
  // Start collection
  collector.startCollection();
  console.log('Metrics collection started');
  
  // Update some metrics
  collector.updateBusinessMetrics({
    sessionsCreated: 5,
    handoffsProcessed: 3,
    successfulHandoffs: 2,
    failedHandoffs: 1
  });
  
  collector.updateTechnicalMetrics({
    databaseQueries: 50,
    databaseQueryTime: 250,
    apiRequests: 100,
    apiResponseTime: 150,
    memoryUsage: 45.5,
    cpuUsage: 25.3
  });
  
  console.log('Initial metrics updated');
  
  // Simulate some load
  setTimeout(() => {
    collector.updateTechnicalMetrics({
      memoryUsage: 75.0,
      cpuUsage: 65.0,
      apiErrors: 3 // This might trigger an alert
    });
    
    console.log('Load simulation metrics updated');
  }, 3000);
  
  // Run for 15 seconds then stop
  setTimeout(() => {
    collector.stopCollection();
    console.log('Metrics collection stopped');
    
    // Show final metrics
    const finalMetrics = collector.getMetrics();
    console.log('Final metrics:', {
      uptime: Math.round(finalMetrics.uptime / 1000) + 's',
      sessions: finalMetrics.business.sessionsCreated,
      handoffs: finalMetrics.business.handoffsProcessed,
      memory: finalMetrics.technical.memoryUsage.toFixed(2) + '%',
      cpu: finalMetrics.technical.cpuUsage.toFixed(2) + '%'
    });
    
    collector.close();
    console.log('Test completed successfully');
  }, 15000);
}

// Run the test
testMetrics().catch(console.error);