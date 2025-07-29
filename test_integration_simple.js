// Simple test to verify the integration code compiles and imports correctly
import { sessionManagerService } from './dist/services/sessionManager.js';

console.log('Testing session manager integration compilation...');

try {
  // Test that the session manager service is properly exported
  if (sessionManagerService) {
    console.log('✓ SessionManagerService imported successfully');
  }
  
  // Test that the service has the expected methods
  const expectedMethods = [
    'scheduleExpiration',
    'expireSession', 
    'archiveSession',
    'markSessionDormant',
    'reactivateSession',
    'cleanupOrphanedSessions',
    'detectDormantSessions',
    'ensureReferentialIntegrity'
  ];
  
  for (const method of expectedMethods) {
    if (typeof sessionManagerService[method] === 'function') {
      console.log(`✓ Method ${method} exists`);
    } else {
      throw new Error(`Method ${method} is missing or not a function`);
    }
  }
  
  console.log('\n✅ Session manager integration compilation test passed!');
  console.log('All expected methods are available and the service is properly integrated.');
  
} catch (error) {
  console.error('❌ Integration compilation test failed:', error.message);
  process.exit(1);
}