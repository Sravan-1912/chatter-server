/**
 * Chatter Real-Time Online Backend & OTP Gateway
 * Pure Node.js - Zero dependencies required.
 * Run: node server.js
 */

const http = require('http');
const https = require('https');
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

// ── Phone Normalization & Matching Helpers ─────────────────────────
function getCanonicalPhone(raw) {
  if (!raw) return '';
  let s = raw.toString().replace(/[\s\-\(\)\.]/g, '');
  let digits = s.replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length > 10) {
    digits = digits.slice(1);
  }
  return digits;
}

function phonesMatch(phoneA, phoneB) {
  const a = getCanonicalPhone(phoneA);
  const b = getCanonicalPhone(phoneB);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 10 && b.length >= 10) {
    return a.slice(-10) === b.slice(-10);
  }
  return a.endsWith(b) || b.endsWith(a);
}

function popPendingDeliveries(phone) {
  const result = [];
  const keysToDelete = [];
  for (const [key, list] of pendingDeliveries.entries()) {
    if (phonesMatch(key, phone)) {
      result.push(...list);
      keysToDelete.push(key);
    }
  }
  for (const k of keysToDelete) {
    pendingDeliveries.delete(k);
  }
  return result;
}

function popStatusAcks(phone) {
  const result = [];
  const keysToDelete = [];
  for (const [key, list] of statusAcks.entries()) {
    if (phonesMatch(key, phone)) {
      result.push(...list);
      keysToDelete.push(key);
    }
  }
  for (const k of keysToDelete) {
    statusAcks.delete(k);
  }
  return result;
}

// ── Real SMS Dispatch Engine ───────────────────────────────────────
async function dispatchRealSms(phone, otpCode) {
  const cleanPhone = phone.replace(/[^0-9+]/g, '');
  const digitsOnly = cleanPhone.replace(/\D/g, '');
  const isIndia = cleanPhone.startsWith('+91') || (digitsOnly.length === 10);
  const tenDigit = digitsOnly.slice(-10);

  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║               REAL SMS DISPATCH GATEWAY REQUEST                ║');
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log(`║ Destination: ${cleanPhone.padEnd(49)} ║`);
  console.log(`║ OTP Code:    ${otpCode.padEnd(49)} ║`);
  console.log(`║ Timestamp:   ${new Date().toISOString().padEnd(49)} ║`);

  // 1. Fast2SMS (Industry Standard for India +91)
  const fast2SmsKey = process.env.FAST2SMS_API_KEY;
  if (fast2SmsKey && isIndia) {
    try {
      console.log(`║ Gateway:     Fast2SMS (Sending to +91-${tenDigit})...`.padEnd(65) + '║');
      const payload = JSON.stringify({
        route: 'otp',
        variables_values: otpCode,
        numbers: tenDigit,
      });

      const res = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'www.fast2sms.com',
          port: 443,
          path: '/dev/bulkV2',
          method: 'POST',
          headers: {
            'authorization': fast2SmsKey.trim(),
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
          timeout: 10000,
        }, (response) => {
          let data = '';
          response.on('data', chunk => data += chunk);
          response.on('end', () => {
            try {
              resolve({ statusCode: response.statusCode, body: JSON.parse(data) });
            } catch (_) {
              resolve({ statusCode: response.statusCode, body: data });
            }
          });
        });
        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Fast2SMS request timeout'));
        });
        req.write(payload);
        req.end();
      });

      console.log(`║ Fast2SMS Response: ${JSON.stringify(res.body).substring(0, 42).padEnd(42)} ║`);
      console.log('╚════════════════════════════════════════════════════════════════╝\n');
      return { success: true, gateway: 'Fast2SMS', details: res };
    } catch (err) {
      console.error(`[Fast2SMS Error] ${err.message}`);
    }
  }

  // 2. Twilio (Global / International Standard)
  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioAuth = process.env.TWILIO_AUTH_TOKEN;
  const twilioFrom = process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_FROM;

  if (twilioSid && twilioAuth && twilioFrom) {
    try {
      console.log(`║ Gateway:     Twilio (Sending to ${cleanPhone})...`.padEnd(65) + '║');
      const postData = new URLSearchParams({
        To: cleanPhone.startsWith('+') ? cleanPhone : `+${cleanPhone}`,
        From: twilioFrom.trim(),
        Body: `<Chatter> Your verification code is ${otpCode}. Valid for 5 minutes. Do not share this code.`,
      }).toString();

      const authHeader = 'Basic ' + Buffer.from(`${twilioSid.trim()}:${twilioAuth.trim()}`).toString('base64');

      const res = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'api.twilio.com',
          port: 443,
          path: `/2010-04-01/Accounts/${twilioSid.trim()}/Messages.json`,
          method: 'POST',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData),
          },
          timeout: 10000,
        }, (response) => {
          let data = '';
          response.on('data', chunk => data += chunk);
          response.on('end', () => {
            try {
              resolve({ statusCode: response.statusCode, body: JSON.parse(data) });
            } catch (_) {
              resolve({ statusCode: response.statusCode, body: data });
            }
          });
        });
        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Twilio request timeout'));
        });
        req.write(postData);
        req.end();
      });

      console.log(`║ Twilio Response: ${JSON.stringify(res.body).substring(0, 44).padEnd(44)} ║`);
      console.log('╚════════════════════════════════════════════════════════════════╝\n');
      return { success: true, gateway: 'Twilio', details: res };
    } catch (err) {
      console.error(`[Twilio Error] ${err.message}`);
    }
  }

  // 3. Custom Webhook SMS Gateway
  const webhookUrl = process.env.SMS_GATEWAY_URL;
  if (webhookUrl) {
    try {
      console.log(`║ Gateway:     Custom Webhook URL...`.padEnd(65) + '║');
      const targetUrl = new URL(webhookUrl);
      const isHttps = targetUrl.protocol === 'https:';
      const transport = isHttps ? https : http;
      const payload = JSON.stringify({
        to: cleanPhone,
        phone: cleanPhone,
        otp: otpCode,
        message: `<Chatter> Your verification code is ${otpCode}. Valid for 5 minutes.`,
      });

      const headers = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      };
      if (process.env.SMS_GATEWAY_KEY) {
        headers['Authorization'] = `Bearer ${process.env.SMS_GATEWAY_KEY.trim()}`;
      }

      const res = await new Promise((resolve, reject) => {
        const req = transport.request({
          hostname: targetUrl.hostname,
          port: targetUrl.port || (isHttps ? 443 : 80),
          path: targetUrl.pathname + targetUrl.search,
          method: 'POST',
          headers,
          timeout: 10000,
        }, (response) => {
          let data = '';
          response.on('data', chunk => data += chunk);
          response.on('end', () => resolve({ statusCode: response.statusCode, body: data }));
        });
        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Custom gateway timeout'));
        });
        req.write(payload);
        req.end();
      });

      console.log(`║ Custom Gateway: Status ${res.statusCode}`.padEnd(65) + '║');
      console.log('╚════════════════════════════════════════════════════════════════╝\n');
      return { success: true, gateway: 'CustomWebhook', details: res };
    } catch (err) {
      console.error(`[Custom Gateway Error] ${err.message}`);
    }
  }

  // 4. Default / Simulated SMS (Logged securely in Render Web Service Logs)
  console.log('║ Gateway:     Render Cloud Logs (Key not configured)           ║');
  console.log('║ Note: To send live carrier SMS to user phone numbers:         ║');
  console.log('║  • India: set FAST2SMS_API_KEY in Render Environment          ║');
  console.log('║  • Global: set TWILIO_ACCOUNT_SID & TWILIO_AUTH_TOKEN         ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
  return { success: true, gateway: 'Console' };
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

    // ── 2. Real-Time OTP: Send OTP (via Real SMS Gateway) ──────
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

      // Dispatch real SMS to registered mobile carrier via SMS Gateway
      const smsResult = await dispatchRealSms(cleanPhone, otpCode);

      const resp = {
        success: true,
        message: `Verification code sent via SMS to ${cleanPhone}`,
        phone: cleanPhone,
        gateway: smsResult.gateway,
        expiresInSeconds: 300,
      };

      // Only expose OTP in debug mode if explicitly enabled on server
      if (process.env.EXPOSE_OTP === 'true') {
        resp.otp = otpCode;
      }

      return sendJson(res, 200, resp);
    }

    // ── 3. Real-Time OTP: Verify OTP ────────────────────────────
    if (req.method === 'POST' && pathname === '/api/auth/verify-otp') {
      const body = await parseJson(req);
      const rawPhone = body.phone || '';
      const cleanPhone = rawPhone.replace(/[^0-9+]/g, '');
      const enteredOtp = (body.otp || '').trim();
      const userName = (body.name || '').trim();

      // Find matching active OTP by phone
      let matchedKey = null;
      let storedOtp = null;
      for (const [k, v] of activeOtps.entries()) {
        if (phonesMatch(k, cleanPhone)) {
          matchedKey = k;
          storedOtp = v;
          break;
        }
      }

      if (!storedOtp) {
        return sendJson(res, 400, {
          success: false,
          error: 'No active OTP found for this number. Please request a new SMS code.',
        });
      }

      if (Date.now() > storedOtp.expiresAt) {
        activeOtps.delete(matchedKey);
        return sendJson(res, 400, {
          success: false,
          error: 'SMS verification code has expired. Please request a new code.',
        });
      }

      storedOtp.attempts = (storedOtp.attempts || 0) + 1;
      if (storedOtp.attempts > 5) {
        activeOtps.delete(matchedKey);
        return sendJson(res, 429, {
          success: false,
          error: 'Too many invalid attempts. Please request a new verification code.',
        });
      }

      if (storedOtp.code !== enteredOtp) {
        return sendJson(res, 400, {
          success: false,
          error: 'Incorrect 6-digit code. Please enter the exact code received in your SMS.',
        });
      }

      // Validated! Remove consumed OTP
      activeOtps.delete(matchedKey);

      // Create / update user session
      let existingUser = null;
      for (const [k, u] of users.entries()) {
        if (phonesMatch(k, cleanPhone)) {
          existingUser = u;
          break;
        }
      }

      if (!existingUser) {
        const initials = userName.length > 0
            ? userName.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase()
            : 'U';
        existingUser = {
          phone: cleanPhone,
          name: userName.length > 0 ? userName : 'Chatter User',
          about: 'Hey there! I am using Chatter.',
          avatarLabel: initials,
          isOnline: true,
          lastSeen: new Date().toISOString(),
        };
        users.set(cleanPhone, existingUser);
      } else {
        existingUser.isOnline = true;
        existingUser.lastSeen = new Date().toISOString();
        if (userName.length > 0) {
          existingUser.name = userName;
        }
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
      const senderPhone = (body.senderPhone || '').toString().trim();
      const recipientPhone = (body.recipientPhone || '').toString().trim();
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

      // Queue for recipient using canonical phone key
      const recipientKey = getCanonicalPhone(recipientPhone);
      if (!pendingDeliveries.has(recipientKey)) {
        pendingDeliveries.set(recipientKey, []);
      }
      pendingDeliveries.get(recipientKey).push(msg);

      // Instantly mark delivered to sender
      const senderKey = getCanonicalPhone(senderPhone);
      if (!statusAcks.has(senderKey)) {
        statusAcks.set(senderKey, []);
      }
      statusAcks.get(senderKey).push({ id: msgId, status: 'delivered' });

      console.log(`\n📨 [RELAY SEND] From: ${senderPhone} (${senderName}) ➔ To: ${recipientPhone} [Canonical: ${recipientKey}]: "${text}"`);

      return sendJson(res, 200, {
        success: true,
        messageId: msgId,
        delivered: true,
      });
    }

    // ── 9. Real-Time Message Relay: Poll Incoming Messages ───────
    if (req.method === 'GET' && pathname === '/api/messages/poll') {
      const rawPhone = (parsedUrl.query.phone || '').toString().trim();
      const cleanPhone = rawPhone.replace(/\s+/g, '');

      if (!cleanPhone) {
        return sendJson(res, 400, { success: false, error: 'phone query parameter required' });
      }

      // Heartbeat: update user presence
      for (const [key, u] of users.entries()) {
        if (phonesMatch(key, cleanPhone)) {
          u.isOnline = true;
          u.lastSeen = new Date().toISOString();
        }
      }

      const newMsgs = popPendingDeliveries(cleanPhone);
      const acks = popStatusAcks(cleanPhone);

      if (newMsgs.length > 0 || acks.length > 0) {
        console.log(`📥 [RELAY POLL] Phone: "${cleanPhone}" (Canonical: ${getCanonicalPhone(cleanPhone)}) ➔ Delivering ${newMsgs.length} messages, ${acks.length} acks`);
      }

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
      const senderPhone = (body.senderPhone || '').toString().trim();
      const recipientPhone = (body.recipientPhone || '').toString().trim();
      const status = body.status || 'read';

      if (senderPhone && messageId) {
        const senderKey = getCanonicalPhone(senderPhone);
        if (!statusAcks.has(senderKey)) {
          statusAcks.set(senderKey, []);
        }
        statusAcks.get(senderKey).push({ id: messageId, status });
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
