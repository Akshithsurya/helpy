const http = require('http');

const MOCK_EXTENSION_ID = 'test-extension-id-123';
let bridgeToken = '';

// Helper to simulate getBridgeHeaders
function getBridgeHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (bridgeToken) {
    headers['X-Helpy-Bridge-Token'] = bridgeToken;
  }
  return headers;
}

// Simulate isCurrentExtensionSession (with the fix!)
function isCurrentExtensionSession(data = {}) {
  const activeExtensionId =
    data?.registeredExtensionId ||
    data?.bridge?.registeredExtensionId ||
    data?.extensionSettings?.registeredExtensionId ||
    null;
  console.log('isCurrentExtensionSession check:', {
    activeExtensionId,
    MOCK_EXTENSION_ID,
    matches: activeExtensionId === MOCK_EXTENSION_ID,
  });
  return Boolean(activeExtensionId && activeExtensionId === MOCK_EXTENSION_ID);
}

// Simulate registerWithApp
async function registerWithApp() {
  console.log('\n=== Testing registerWithApp ===');
  const postData = JSON.stringify({ extensionId: MOCK_EXTENSION_ID });

  const options = {
    hostname: 'localhost',
    port: 3456,
    path: '/api/extension/register',
    method: 'POST',
    headers: getBridgeHeaders(),
  };

  return new Promise((resolve) => {
    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        console.log('registerWithApp response status:', res.statusCode);
        const responseData = JSON.parse(data);
        console.log('registerWithApp response body:', JSON.stringify(responseData, null, 2));

        if (res.ok || res.statusCode === 200) {
          if (responseData.bridgeToken && responseData.bridgeToken !== bridgeToken) {
            bridgeToken = responseData.bridgeToken;
            console.log('Updated bridgeToken:', bridgeToken);
          }
          if (!isCurrentExtensionSession(responseData)) {
            console.log('isCurrentExtensionSession returned false');
            resolve(false);
            return;
          }
          console.log('registerWithApp succeeded!');
          resolve(true);
        } else {
          console.log('registerWithApp failed!');
          resolve(false);
        }
      });
    });

    req.on('error', (error) => {
      console.error('Error in registerWithApp:', error);
      resolve(false);
    });

    req.write(postData);
    req.end();
  });
}

// Simulate syncBridgeSession
async function syncBridgeSession() {
  console.log('\n=== Testing syncBridgeSession ===');
  const options = {
    hostname: 'localhost',
    port: 3456,
    path: '/api/settings',
    method: 'GET',
    headers: getBridgeHeaders(),
  };

  return new Promise((resolve) => {
    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        console.log('syncBridgeSession response status:', res.statusCode);
        const responseData = JSON.parse(data);
        console.log('syncBridgeSession response body:', JSON.stringify(responseData, null, 2));

        if (res.statusCode === 200) {
          if (
            responseData.extensionSettings?.bridgeToken &&
            responseData.extensionSettings.bridgeToken !== bridgeToken
          ) {
            bridgeToken = responseData.extensionSettings.bridgeToken;
            console.log('Updated bridgeToken from extensionSettings:', bridgeToken);
          }

          if (!isCurrentExtensionSession(responseData)) {
            console.log('isCurrentExtensionSession returned false in syncBridgeSession');
            resolve(false);
            return;
          }

          console.log('syncBridgeSession succeeded!');
          resolve(true);
        } else {
          console.log('syncBridgeSession failed!');
          resolve(false);
        }
      });
    });

    req.on('error', (error) => {
      console.error('Error in syncBridgeSession:', error);
      resolve(false);
    });

    req.end();
  });
}

// Simulate ensureBridgeConnection
async function ensureBridgeConnection() {
  console.log('\n=== Testing ensureBridgeConnection ===');
  const registered = await registerWithApp();
  if (!registered) {
    console.log('ensureBridgeConnection: registration failed');
    return false;
  }
  const synced = await syncBridgeSession();
  if (!synced) {
    console.log('ensureBridgeConnection: sync failed');
    return false;
  }
  console.log('ensureBridgeConnection: SUCCESS!');
  return true;
}

// Run the full test
async function runTest() {
  const success = await ensureBridgeConnection();
  console.log('\n=== Final Result ===');
  console.log('Overall test passed:', success);
}

runTest();
