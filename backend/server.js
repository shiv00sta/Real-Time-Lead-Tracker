const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'my_secret_webhook_token';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Create HTTP server
const server = http.createServer(app);

// Initialize WebSocket server
const wss = new WebSocket.Server({ server });

// Track connected WebSocket clients
const clients = new Set();

wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`[WebSocket] New client connected from ${clientIp}. Total clients: ${clients.size + 1}`);
  clients.add(ws);

  // Send initial connection confirmation payload
  ws.send(JSON.stringify({
    type: 'CONNECTED',
    message: 'Successfully connected to Lead Updates WebSocket server',
    timestamp: new Date().toISOString()
  }));

  // Handle client messages (if any)
  ws.on('message', (message) => {
    try {
      const parsed = JSON.parse(message);
      console.log('[WebSocket] Message received from client:', parsed);
      if (parsed.type === 'PING') {
        ws.send(JSON.stringify({ type: 'PONG', timestamp: new Date().toISOString() }));
      }
    } catch (e) {
      console.log('[WebSocket] Raw message received:', message.toString());
    }
  });

  // Handle client disconnect
  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[WebSocket] Client disconnected. Total clients remaining: ${clients.size}`);
  });

  // Handle connection errors
  ws.on('error', (error) => {
    console.error('[WebSocket] Socket error:', error.message);
    clients.delete(ws);
  });
});

/**
 * Helper function to broadcast message payload to all connected WebSocket clients
 */
function broadcastLeadPayload(leadPayload) {
  const messageStr = JSON.stringify({
    type: 'NEW_LEAD',
    data: leadPayload,
    timestamp: new Date().toISOString()
  });

  console.log(`[WebSocket] Broadcasting NEW_LEAD to ${clients.size} client(s)...`);

  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(messageStr);
    }
  });
}

// ------------------- Express Routes ------------------- //

// Root Endpoint - Status check
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'Meta Lead Updates Backend',
    connectedClients: clients.size,
    verifyToken: VERIFY_TOKEN,
    endpoints: {
      webhook_verification: 'GET /webhook',
      webhook_ingestion: 'POST /webhook',
      test_trigger: 'POST /api/test-lead'
    }
  });
});

/**
 * 1. GET /webhook - Meta Webhook Verification Endpoint
 * Meta sends hub.mode, hub.verify_token, hub.challenge to verify ownership
 */
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log('[GET /webhook] Verification attempt received:');
  console.log(` - hub.mode: ${mode}`);
  console.log(` - hub.verify_token: ${token}`);
  console.log(` - hub.challenge: ${challenge}`);

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('[GET /webhook] WEBHOOK_VERIFIED successfully!');
      return res.status(200).send(challenge);
    } else {
      console.error('[GET /webhook] Verification failed. Token mismatch.');
      return res.sendStatus(403);
    }
  }

  return res.status(400).send('Missing hub.mode or hub.verify_token parameters.');
});

/**
 * 2. POST /webhook - Meta Incoming Lead Generation Events Endpoint
 * Handles leadgen payload from Meta page events
 */
app.post('/webhook', (req, res) => {
  const body = req.body;
  console.log('[POST /webhook] Incoming webhook body:', JSON.stringify(body, null, 2));

  // Check if this is an event from a page subscription
  if (body.object === 'page') {
    if (Array.isArray(body.entry)) {
      body.entry.forEach((entry) => {
        const pageId = entry.id;
        const entryTime = entry.time;

        if (Array.isArray(entry.changes)) {
          entry.changes.forEach((change) => {
            if (change.field === 'leadgen') {
              const leadValue = change.value || {};
              const leadPayload = {
                id: leadValue.leadgen_id || `lead_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                leadgen_id: leadValue.leadgen_id || `lg_${Date.now()}`,
                page_id: leadValue.page_id || pageId,
                form_id: leadValue.form_id || 'DEFAULT_FORM',
                adgroup_id: leadValue.adgroup_id || 'N/A',
                ad_id: leadValue.ad_id || 'N/A',
                created_time: leadValue.created_time || entryTime || Math.floor(Date.now() / 1000),
                name: leadValue.name || `Lead #${(leadValue.leadgen_id || '').slice(-4) || 'Meta'}`,
                email: leadValue.email || `lead_${Date.now().toString().slice(-4)}@example.com`,
                phone: leadValue.phone || '+1 (555) ' + Math.floor(1000000 + Math.random() * 9000000),
                source: 'Meta Page Webhook',
                receivedAt: new Date().toISOString()
              };

              console.log('[POST /webhook] Extracted Lead Payload:', leadPayload);

              // Broadcast to connected WebSocket clients immediately
              broadcastLeadPayload(leadPayload);
            }
          });
        }
      });
    }

    // Return a 200 OK response to Meta to acknowledge receipt of the event
    return res.status(200).send('EVENT_RECEIVED');
  } 
  
  // Also handle direct custom lead submission format for easy testing
  if (body.name || body.email || body.leadgen_id) {
    const customLeadPayload = {
      id: body.id || `lead_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      leadgen_id: body.leadgen_id || `lg_${Date.now()}`,
      page_id: body.page_id || '10293847561029',
      form_id: body.form_id || 'FORM_META_2026',
      name: body.name || 'Sample Meta Lead',
      email: body.email || 'sample.lead@example.com',
      phone: body.phone || '+1 555-0199',
      source: body.source || 'Custom Webhook POST',
      created_time: Math.floor(Date.now() / 1000),
      receivedAt: new Date().toISOString()
    };

    console.log('[POST /webhook] Direct custom lead payload:', customLeadPayload);
    broadcastLeadPayload(customLeadPayload);

    return res.status(200).json({
      status: 'success',
      message: 'Lead received and broadcasted',
      lead: customLeadPayload
    });
  }

  // If not a recognized payload structure
  return res.sendStatus(404);
});

/**
 * 3. POST /api/test-lead - Helper endpoint to simulate sample incoming lead payloads easily
 */
app.post('/api/test-lead', (req, res) => {
  const sampleNames = ['Alex Morgan', 'David Miller', 'Sophia Chen', 'Marcus Vance', 'Priya Sharma', 'Elena Rostova'];
  const sampleServices = ['Enterprise Cloud Plan', 'Product Demo Request', 'Lead Gen Automation', 'Mobile App Dev Inquiry'];

  const randomName = req.body.name || sampleNames[Math.floor(Math.random() * sampleNames.length)];
  const randomService = req.body.service || sampleServices[Math.floor(Math.random() * sampleServices.length)];

  const sampleLead = {
    id: `lead_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    leadgen_id: `lg_${Math.floor(1000000000 + Math.random() * 9000000000)}`,
    page_id: req.body.page_id || '987654321098',
    form_id: req.body.form_id || `FORM_${Math.floor(100 + Math.random() * 900)}`,
    name: randomName,
    email: req.body.email || `${randomName.toLowerCase().replace(/\s+/g, '.')}@example.com`,
    phone: req.body.phone || `+1 (${Math.floor(200 + Math.random() * 700)}) ${Math.floor(100 + Math.random() * 900)}-${Math.floor(1000 + Math.random() * 9000)}`,
    service: randomService,
    source: 'Meta Lead Ads (Simulated)',
    created_time: Math.floor(Date.now() / 1000),
    receivedAt: new Date().toISOString()
  };

  console.log('[POST /api/test-lead] Generating simulated lead:', sampleLead);

  broadcastLeadPayload(sampleLead);

  res.status(200).json({
    success: true,
    message: 'Test lead generated and broadcasted via WebSocket',
    lead: sampleLead
  });
});

// Start listening on HTTP + WebSocket server
server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(` Real-Time Lead Updates Backend Server Running!`);
  console.log(` HTTP URL      : http://localhost:${PORT}`);
  console.log(` WebSocket URL : ws://localhost:${PORT}`);
  console.log(` Verify Token  : ${VERIFY_TOKEN}`);
  console.log(` Webhook URL   : http://localhost:${PORT}/webhook`);
  console.log(` Test Lead API : http://localhost:${PORT}/api/test-lead`);
  console.log(`====================================================`);
});
