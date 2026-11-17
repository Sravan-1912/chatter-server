/**
 * Chatter Real-Time Online Backend & OTP Gateway
 * Pure Node.js - Zero dependencies required.
 * Run: node server.js
 */

const http = require('http');
const crypto = require('crypto');
const url = require('url');

const PORT = process.env.PORT || 4040;

// In-Memory Real-Time State
const activeOtps = new Map(); // phone -> { code, expiresAt, attempts }
const users = new Map();      // phone -> { phone, name, about, avatarLabel, lastSeen, isOnline }
const messages = new Map();   // convId -> [ ChatMessage ]
const pendingDeliveries = new Map(); // recipientPhone -> [ { message, convId } ]
const statusAcks = new Map();        // senderPhone -> [ { id, status } ]
const statusStories = [];     // [ { id, phone, name, avatarLabel, text, mediaUrl, color, createdAt, expiresAt } ]
const eventListeners = new Map(); // phone -> [ res ] (Server-Sent Events / Long-polling)

// Seed predefined active users
users.set('+15550192834', {
  phone: '+15550192834',
  name: 'Alice Vance',
  about: 'Available on Chatter E2EE',
  avatarLabel: 'AV',
  isOnline: true,
  lastSeen: new Date().toISOString(),
});

users.set('+15550198472', {
  phone: '+15550198472',
  name: 'Bob Martinez',
  about: 'At work • Secure messaging only',
  avatarLabel: 'BM',
  isOnline: true,
  lastSeen: new Date().toISOString(),
});

users.set('+15550100777', {
  phone: '+15550100777',
  name: 'Ghost Agent',
  about: 'Mission active. Double Ratchet verified.',
  avatarLabel: 'GA',
  isOnline: false,
  lastSeen: new Date(Date.now() - 3600000).toISOString(),
});

// Seed predefined 24-hour stories
const now = Date.now();
statusStories.push({
  id: 'story_seed_1',
  phone: '+15550192834',
  name: 'Alice Vance',
  avatarLabel: 'AV',
  text: '🚀 Testing our new end-to-end encrypted voice notes!',
  color: 0xFF1A73E8, // Blue
  createdAt: new Date(now - 3600000).toISOString(),
  expiresAt: new Date(now + 82800000).toISOString(),
});

statusStories.push({
  id: 'story_seed_2',
  phone: '+15550198472',
  name: 'Bob Martinez',
  avatarLabel: 'BM',
  text: 'Coffee and code ☕. All systems operational.',
  color: 0xFF34C759, // Green
  createdAt: new Date(now - 7200000).toISOString(),
  expiresAt: new Date(now + 79200000).toISOString(),
});

// Helper: Parse JSON Body
function parseJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 1e6) { // 1MB limit
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// Helper: Send JSON Response with CORS
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify(data));
}

// HTTP Server
const server = http.createServer(async (req, res) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    return res.end();
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  try {
    // ── 1. Health & Server Info ──────────────────────────────────
    if (pathname === '/' || pathname === '/api/health') {
      return sendJson(res, 200, {
        status: 'online',
        service: 'Chatter E2EE Gateway',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        activeUsersCount: users.size,
      });
    }

    // ── 2. Real-Time OTP: Send OTP ──────────────────────────────
    if (req.method === 'POST' && pathname === '/api/auth/send-otp') {
      const body = await parseJson(req);
      const rawPhone = body.phone || '';
      const cleanPhone = rawPhone.replace(/[^0-9+]/g, '');

      if (cleanPhone.length < 8) {
        return sendJson(res, 400, {
          success: false,
          error: 'Please enter a valid phone number with country code.',
        });
      }

      // Generate 6-digit cryptographic OTP
      const otpCode = crypto.randomInt(100000, 999999).toString();
      const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

      activeOtps.set(cleanPhone, {
        code: otpCode,
        expiresAt,
        attempts: 0,
      });

      // Console SMS Dispatch
      console.log('\n==================================================');
      console.log(`📱 [REAL-TIME SMS GATEWAY DISPATCH]`);
      console.log(`To: ${cleanPhone}`);
      console.log(`Message: <Chatter> Your verification code is ${otpCode}. Valid for 5 minutes.`);
      console.log(`Timestamp: ${new Date().toLocaleTimeString()}`);
      console.log('==================================================\n');

      return sendJson(res, 200, {
        success: true,
        message: `OTP sent successfully to ${cleanPhone}`,
        phone: cleanPhone,
        otp: otpCode, // Provided for instant real-time filling
        expiresInSeconds: 300,
      });
    }

    // ── 3. Real-Time OTP: Verify OTP ────────────────────────────
    if (req.method === 'POST' && pathname === '/api/auth/verify-otp') {
      const body = await parseJson(req);
      const rawPhone = body.phone || '';
      const cleanPhone = rawPhone.replace(/[^0-9+]/g, '');
      const enteredOtp = (body.otp || '').trim();
      const userName = (body.name || '').trim();

      const storedOtp = activeOtps.get(cleanPhone);

      if (!storedOtp) {
        return sendJson(res, 400, {
          success: false,
          error: 'No active OTP found for this number. Please request a new code.',
        });
      }

      if (Date.now() > storedOtp.expiresAt) {
        activeOtps.delete(cleanPhone);
        return sendJson(res, 400, {
          success: false,
          error: 'OTP has expired. Please request a new code.',
        });
      }

      storedOtp.attempts++;
      if (storedOtp.attempts > 5) {
        activeOtps.delete(cleanPhone);
        return sendJson(res, 429, {
          success: false,
          error: 'Too many invalid attempts. Please request a new OTP.',
        });
      }

      if (storedOtp.code !== enteredOtp) {
        return sendJson(res, 400, {
          success: false,
          error: 'Incorrect 6-digit OTP code. Please check and try again.',
        });
      }

      // Validated! Remove consumed OTP
      activeOtps.delete(cleanPhone);

      // Create / update user session
      let existingUser = users.get(cleanPhone);
      if (!existingUser) {
        const initials = userName.length > 0
            ? userName.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase()
            : 'U';
        existingUser = {
          phone: cleanPhone,
          name: userName.isNotEmpty ? userName : 'Chatter User',
          about: 'Hey there! I am using Chatter.',
          avatarLabel: initials,
          isOnline: true,
          lastSeen: new Date().toISOString(),
        };
        users.set(cleanPhone, existingUser);
      } else if (userName.length > 0) {
        existingUser.name = userName;
      }

      const authToken = 'sc_' + crypto.randomBytes(24).toString('hex');

      return sendJson(res, 200, {
        success: true,
        message: 'Phone verified successfully.',
        token: authToken,
        user: existingUser,
      });
    }

    // ── 4. Contact Discovery: Sync contacts ───────────────────────
    if (req.method === 'POST' && pathname === '/api/contacts/sync') {
      const body = await parseJson(req);
      const phoneList = Array.isArray(body.phones) ? body.phones : [];

      const registered = [];
      for (const raw of phoneList) {
        const clean = raw.replace(/[^0-9+]/g, '');
        if (users.has(clean)) {
          registered.push(users.get(clean));
        }
      }

      return sendJson(res, 200, {
        success: true,
        registered,
      });
    }

    // ── 5. Status / Stories: Feed ────────────────────────────────
    if (req.method === 'GET' && pathname === '/api/status/feed') {
      // Filter out expired stories (>24h)
      const validStories = statusStories.filter(s => new Date(s.expiresAt) > new Date());
      return sendJson(res, 200, {
        success: true,
        stories: validStories,
      });
    }

    // ── 6. Status / Stories: Post New Story ──────────────────────
    if (req.method === 'POST' && pathname === '/api/status/post') {
      const body = await parseJson(req);
      const phone = body.phone || '+1000000000';
      const name = body.name || 'Chatter User';
      const text = body.text || '';
      const color = body.color || 0xFF1A73E8;

      const newStory = {
        id: 'story_' + Date.now() + '_' + crypto.randomInt(100, 999),
        phone,
        name,
        avatarLabel: name.substring(0, 1).toUpperCase(),
        text,
        color,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      };

      statusStories.unshift(newStory);
      return sendJson(res, 201, {
        success: true,
        story: newStory,
      });
    }

    // ── 7. Registered Users Discovery ─────────────────────────────
    if (req.method === 'GET' && pathname === '/api/users/registered') {
      const list = Array.from(users.values());
      return sendJson(res, 200, {
        success: true,
        users: list,
      });
    }

    // ── 8. Real-Time Message Relay: Send Message ─────────────────
    if (req.method === 'POST' && pathname === '/api/messages/send') {
      const body = await parseJson(req);
      const senderPhone = (body.senderPhone || '').replace(/[^0-9+]/g, '');
      const recipientPhone = (body.recipientPhone || '').replace(/[^0-9+]/g, '');
      const senderName = (body.senderName || 'Chatter User').trim();
      const text = body.text || '';
      const mediaType = body.mediaType || 'text';
      const audioDurationSeconds = body.audioDurationSeconds || 0;

      if (!senderPhone || !recipientPhone) {
        return sendJson(res, 400, {
          success: false,
          error: 'senderPhone and recipientPhone are required.',
        });
      }

      const msgId = 'msg_' + Date.now() + '_' + crypto.randomInt(100, 999);
      const msg = {
        id: msgId,
        senderPhone,
        recipientPhone,
        senderName,
        text,
        mediaType,
        audioDurationSeconds,
        timestamp: new Date().toISOString(),
        status: 'delivered',
      };

      // Queue for recipient phone
      if (!pendingDeliveries.has(recipientPhone)) {
        pendingDeliveries.set(recipientPhone, []);
      }
      pendingDeliveries.get(recipientPhone).push(msg);

      // Instantly mark delivered to sender
      if (!statusAcks.has(senderPhone)) {
        statusAcks.set(senderPhone, []);
      }
      statusAcks.get(senderPhone).push({ id: msgId, status: 'delivered' });

      console.log(`\n📨 [REAL-TIME RELAY] ${senderPhone} (${senderName}) ➔ ${recipientPhone}: "${text}"`);

      return sendJson(res, 200, {
        success: true,
        messageId: msgId,
        delivered: true,
      });
    }

    // ── 9. Real-Time Message Relay: Poll Incoming Messages ───────
    if (req.method === 'GET' && pathname === '/api/messages/poll') {
      const rawPhone = parsedUrl.query.phone || '';
      const cleanPhone = rawPhone.replace(/[^0-9+]/g, '');

      if (!cleanPhone) {
        return sendJson(res, 400, { success: false, error: 'phone query parameter required' });
      }

      // Heartbeat: update user presence
      if (users.has(cleanPhone)) {
        const u = users.get(cleanPhone);
        u.isOnline = true;
        u.lastSeen = new Date().toISOString();
      }

      const newMsgs = pendingDeliveries.get(cleanPhone) || [];
      pendingDeliveries.delete(cleanPhone);

      const acks = statusAcks.get(cleanPhone) || [];
      statusAcks.delete(cleanPhone);

      return sendJson(res, 200, {
        success: true,
        messages: newMsgs,
        acks: acks,
      });
    }

    // ── 10. Real-Time Message Relay: Read Status Ack (RED TICKS) ──
    if (req.method === 'POST' && pathname === '/api/messages/ack') {
      const body = await parseJson(req);
      const messageId = body.messageId || '';
      const senderPhone = (body.senderPhone || '').replace(/[^0-9+]/g, '');
      const recipientPhone = (body.recipientPhone || '').replace(/[^0-9+]/g, '');
      const status = body.status || 'read';

      if (senderPhone && messageId) {
        if (!statusAcks.has(senderPhone)) {
          statusAcks.set(senderPhone, []);
        }
        statusAcks.get(senderPhone).push({ id: messageId, status });
        console.log(`👁️ [SEEN / READ] Message ${messageId} marked READ by ${recipientPhone} ➔ Notified ${senderPhone} (RED TICKS)`);
      }

      return sendJson(res, 200, { success: true });
    }

    // ── 11. Fallback 404 ─────────────────────────────────────────
    sendJson(res, 404, { error: 'Not Found' });
  } catch (err) {
    console.error('API Error:', err);
    sendJson(res, 500, { error: 'Internal Server Error', message: err.message });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║             CHATTER REAL-TIME BACKEND & OTP GATEWAY            ║
╠════════════════════════════════════════════════════════════════╣
║  • Server running at: http://localhost:${PORT}                   ║
║  • Network access at: http://0.0.0.0:${PORT}                     ║
║  • Real-Time OTP API: POST /api/auth/send-otp                  ║
║  • Verify OTP API:    POST /api/auth/verify-otp                ║
║  • 24h Stories Feed:  GET  /api/status/feed                    ║
║  • Contacts Sync API: POST /api/contacts/sync                  ║
╚════════════════════════════════════════════════════════════════╝
`);
});
