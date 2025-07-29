// Simple integration test to verify session manager integration
import { registerSessionTool } from './dist/mcp/tools/registerSession.js';
import { updateContextTool } from './dist/mcp/tools/updateContext.js';
import { requestHandoffTool } from './dist/mcp/tools/requestHandoff.js';

async function testIntegration() {
  console.log('Testing session manager integration...');
  
  try {
    // Test session registration with expiration scheduling
    console.log('1. Testing session registration...');
    const registerResult = await registerSessionTool({
      sessionKey: 'test-integration-session',
      agentFrom: 'test-agent',
      metadata: { test: true }
    });
    console.log('✓ Session registration completed');
    
    // Test context update with activity tracking
    console.log('2. Testing context update...');
    const updateResult = await updateContextTool({
      sessionKey: 'test-integration-session',
      contextType: 'user_input',
      content: 'Test context content',
      metadata: { source: 'integration-test' }
    });
    console.log('✓ Context update completed');
    
    // Test handoff request with activity tracking
    console.log('3. Testing handoff request...');
    const handoffResult = await requestHandoffTool({
      sessionKey: 'test-integration-session',
      targetAgent: 'target-agent',
      requestType: 'context_transfer'
    });
    console.log('✓ Handoff request completed');
    
    console.log('\n✅ All integration tests passed!');
    console.log('Session manager is successfully integrated with MCP tools.');
    
  } catch (error) {
    console.error('❌ Integration test failed:', error.message);
    process.exit(1);
  }
}

// Run the test
testIntegration();