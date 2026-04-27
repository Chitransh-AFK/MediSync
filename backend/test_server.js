/*
 * ============================================================
 *  test_server.js — Simple RTC Test Receiver
 *  Run: node test_server.js
 *
 *  Listens on port 4000.
 *  When ESP sends RTC time, prints it nicely to CMD.
 * ============================================================
 */

'use strict';
const http = require('http');
const PORT = 4000;

// ── Color codes for CMD ────────────────────────────────────────
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const BOLD   = '\x1b[1m';
const RESET  = '\x1b[0m';

let receiveCount = 0;

// ── Server ─────────────────────────────────────────────────────
const server = http.createServer((req, res) => {

  // Only handle POST /rtc-time
  if (req.method === 'POST' && req.url === '/rtc-time') {
    let body = '';

    req.on('data', chunk => { body += chunk.toString(); });

    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        receiveCount++;

        const now    = new Date();
        const pcTime = now.toLocaleTimeString('en-IN', { hour12: false });

        console.log(`\n${BOLD}${'─'.repeat(52)}${RESET}`);
        console.log(`${CYAN}  📦  Packet #${receiveCount}  received at PC time: ${pcTime}${RESET}`);
        console.log(`${'─'.repeat(52)}`);

        if (data.rtc_ok) {
          console.log(`${GREEN}  ✅  RTC STATUS   : OK${RESET}`);
        } else {
          console.log(`${RED}  ❌  RTC STATUS   : BAD (year < 2024 — needs NTP sync)${RESET}`);
        }

        console.log(`${BOLD}  📅  RTC Date     :${RESET} ${data.date}  (${data.day_of_week})`);
        console.log(`${BOLD}  🕐  RTC Time     :${RESET} ${CYAN}${data.time}${RESET} (IST)`);
        console.log(`${BOLD}  🌡️   DS3231 Temp  :${RESET} ${data.temperature}°C`);

        // Compare ESP time vs PC time
        if (data.rtc_ok) {
          const [h, m, s]  = data.time.split(':').map(Number);
          const espSec      = h * 3600 + m * 60 + s;
          const pcH         = now.getHours();
          const pcM         = now.getMinutes();
          const pcS         = now.getSeconds();
          const pcSec       = pcH * 3600 + pcM * 60 + pcS;
          const diffSec     = Math.abs(espSec - pcSec);

          if (diffSec <= 5) {
            console.log(`${GREEN}  ⏱️   Time drift    : ${diffSec}s — In sync!${RESET}`);
          } else if (diffSec <= 30) {
            console.log(`${YELLOW}  ⏱️   Time drift    : ${diffSec}s — Minor drift${RESET}`);
          } else {
            console.log(`${RED}  ⏱️   Time drift    : ${diffSec}s — OUT OF SYNC! Re-flash to force NTP.${RESET}`);
          }
        }

        console.log(`${'─'.repeat(52)}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, received: receiveCount }));

      } catch (e) {
        console.log(`${RED}  ❌  Invalid JSON received: ${body}${RESET}`);
        res.writeHead(400);
        res.end('Bad JSON');
      }
    });

  } else {
    // Unknown route
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n${BOLD}${'='.repeat(52)}${RESET}`);
  console.log(`${GREEN}${BOLD}   🟢  RTC Test Server running on port ${PORT}${RESET}`);
  console.log(`${BOLD}${'='.repeat(52)}${RESET}`);
  console.log(`   Waiting for ESP8266 to send RTC time...`);
  console.log(`   ESP should POST to: http://<YOUR_PC_IP>:${PORT}/rtc-time`);
  console.log(`   Press Ctrl+C to stop.\n`);
});
