const WebSocket = require('ws');

async function testSystem() {
  console.log('--- Starting Integration Test ---');

  // 1. Test GET /webhook verification
  console.log('\n[1] Testing Meta GET Webhook verification...');
  const verifyRes = await fetch('http://localhost:3000/webhook?hub.mode=subscribe&hub.verify_token=my_secret_webhook_token&hub.challenge=VERIFY_MATCH');
  const verifyText = await verifyRes.text();
  console.log('GET /webhook response status:', verifyRes.status, '| body:', verifyText);
  if (verifyRes.status === 200 && verifyText === 'VERIFY_MATCH') {
    console.log('✅ GET /webhook Verification Passed!');
  } else {
    console.error('❌ GET /webhook Verification Failed!');
  }

  // 2. Test WebSocket connection
  console.log('\n[2] Connecting test WebSocket client to ws://localhost:3000...');
  const receivedMessages = [];
  const ws = new WebSocket('ws://localhost:3000');

  await new Promise((resolve) => {
    ws.on('open', () => {
      console.log('✅ WebSocket Client Connected successfully');
      resolve();
    });
  });

  ws.on('message', (data) => {
    const parsed = JSON.parse(data.toString());
    console.log('📩 [WS Client Received]:', parsed);
    receivedMessages.push(parsed);
  });

  // 3. Test Meta POST /webhook
  console.log('\n[3] Triggering Meta Page Leadgen POST /webhook...');
  const webhookRes = await fetch('http://localhost:3000/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      object: 'page',
      entry: [
        {
          id: 'PAGE_987654',
          time: Math.floor(Date.now() / 1000),
          changes: [
            {
              field: 'leadgen',
              value: {
                created_time: Math.floor(Date.now() / 1000),
                leadgen_id: 'LG_TEST_998877',
                page_id: 'PAGE_987654',
                form_id: 'FORM_META_PROMO'
              }
            }
          ]
        }
      ]
    })
  });
  const webhookStatusText = await webhookRes.text();
  console.log('POST /webhook response status:', webhookRes.status, '| body:', webhookStatusText);

  // 4. Test POST /api/test-lead
  console.log('\n[4] Triggering POST /api/test-lead...');
  const testLeadRes = await fetch('http://localhost:3000/api/test-lead', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Integration Test Lead', email: 'test@example.com' })
  });
  const testLeadData = await testLeadRes.json();
  console.log('POST /api/test-lead response:', testLeadData.success ? '✅ Success' : '❌ Failed');

  // Wait 1 second to gather WS messages
  await new Promise((r) => setTimeout(r, 1000));

  console.log('\n--- Test Summary ---');
  console.log(`Total WebSocket messages received by client: ${receivedMessages.length}`);
  const newLeadMsgs = receivedMessages.filter(m => m.type === 'NEW_LEAD');
  console.log(`NEW_LEAD messages received: ${newLeadMsgs.length}`);
  
  ws.close();

  if (newLeadMsgs.length >= 2) {
    console.log('🎉 ALL INTEGRATION TESTS PASSED PERFECTLY!');
  } else {
    console.error('⚠️ Expected at least 2 NEW_LEAD messages');
  }
}

testSystem().catch(console.error);
