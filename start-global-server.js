const { spawn } = require('child_process');
const path = require('path');

console.log('======================================================================');
console.log('       STARTING CHATTER REAL-TIME BACKEND & GLOBAL CLOUD TUNNEL       ');
console.log('======================================================================\n');

// 1. Start Local Backend
console.log('[1/2] Starting Local HTTP Server on port 4040...');
const serverPath = path.join(__dirname, 'server.js');
const serverProcess = spawn('node', [serverPath], { stdio: 'inherit' });

// 2. Start Cloudflare Tunnel
console.log('[2/2] Establishing global edge tunnel via Cloudflare...');
const cloudflaredPath = path.join(__dirname, 'cloudflared.exe');
const tunnelProcess = spawn(cloudflaredPath, ['tunnel', '--url', 'http://localhost:4040']);

let foundUrl = false;

tunnelProcess.stderr.on('data', (data) => {
  const text = data.toString();
  const match = text.match(/https:\/\/[a-z0-9\-]+\.trycloudflare\.com/i);
  if (match && !foundUrl) {
    foundUrl = true;
    const publicUrl = match[0];
    console.log('\n' + '═'.repeat(74));
    console.log('  🌐 CHATTER GLOBAL CLOUD GATEWAY ACTIVE (ACROSS DIFFERENT NETWORKS)');
    console.log('═'.repeat(74));
    console.log(`\n  ⭐ PUBLIC CLOUD URL:  ${publicUrl}\n`);
    console.log('  📲 TO CHAT ACROSS ANY NETWORK (4G / 5G / DIFFERENT WI-FI):');
    console.log('     1. Open Chatter on Phone 1 and Phone 2');
    console.log('     2. Tap the Gear icon (Settings) ➔ "Real-Time Gateway Server"');
    console.log(`     3. Enter Server URL:  ${publicUrl}`);
    console.log('     4. Tap "Test Connection" (shows 200 OK) ➔ Tap "Save & Apply"');
    console.log('\n  ✅ Done! Both phones can now chat in real-time from anywhere in the world!');
    console.log('═'.repeat(74) + '\n');
  }
});

process.on('SIGINT', () => {
  console.log('\nShutting down Chatter Global Gateway...');
  serverProcess.kill();
  tunnelProcess.kill();
  process.exit(0);
});
