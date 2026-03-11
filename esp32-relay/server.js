"use strict";

/**
 * ESP32-CAM Relay Server for Fly.io
 * 
 * Safeties:
 * 1. BANDWIDTH_LIMIT_GB: Safety cap for outbound data.
 * 2. AUTH_TOKEN: Simple protection for the stream.
 * 3. MAX_VIEWERS: Limit simultaneous connections.
 * 4. FORCED FPS: Strict frame timing.
 */

const http = require("http");
const express = require("express");
const { WebSocketServer, WebSocket } = require("ws");
const cors = require("cors");

// --- KONFIGURACE (Většinou přes Env Vars) ---
const PORT = process.env.PORT || 8080;
const AUTH_TOKEN = process.env.AUTH_TOKEN || "zmen-me-prosim"; // Bezpečnostní token
const BANDWIDTH_LIMIT_GB = parseFloat(process.env.LIMIT_GB || "50"); // Měsíční limit v GB
const MAX_VIEWERS = parseInt(process.env.MAX_VIEWERS || "3"); // Max počet diváků
const MAX_FPS = parseInt(process.env.MAX_FPS || "15"); // Limit FPS šetří data
const FRAME_MIN_MS = 1000 / MAX_FPS;

const MJPEG_BOUNDARY = "ESP32CAM_STREAM_BOUNDARY";

// --- STAV SYSTÉMU ---
let esp32Socket = null;
let lastFrame = null;
let lastFrameTime = 0;
let mjpegClients = new Set();

const stats = {
  esp32Connected: false,
  bytesSent: 0, // Cumulative bytes sent in current process lifespan
  viewersCount: 0,
  startTime: Date.now(),
  framesReceived: 0,
};

// Pomocná funkce pro převod na GB
const getBytesInGB = (bytes) => (bytes / (1024 * 1024 * 1024)).toFixed(4);

// Kontrola limitu
function isOverLimit() {
  const currentGB = stats.bytesSent / (1024 * 1024 * 1024);
  return currentGB >= BANDWIDTH_LIMIT_GB;
}

const app = express();
app.use(cors());
app.use(express.json());

// Middleware pro logování a kontrolu limitu
app.use((req, res, next) => {
  if (isOverLimit() && req.path === "/stream") {
    return res.status(429).send("Bandwidth limit reached for this month/session.");
  }
  next();
});

// --- HTTP ENDPOINTY ---

app.get("/", (req, res) => {
  res.send(`
    <html>
      <head>
        <title>ESP32 Relay Dashboard</title>
        <style>
          body { background: #0f172a; color: #f8fafc; font-family: system-ui, sans-serif; padding: 2rem; line-height: 1.5; }
          .container { max-width: 600px; margin: 0 auto; background: #1e293b; padding: 2rem; rounded: 1rem; border: 1px solid #334155; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); border-radius: 12px; }
          h1 { color: #38bdf8; margin-top: 0; }
          .stat { display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid #334155; }
          .stat:last-child { border-bottom: none; }
          .label { color: #94a3b8; }
          .value { font-weight: bold; }
          .online { color: #4ade80; }
          .offline { color: #f87171; }
          .btn { display: inline-block; background: #38bdf8; color: #0f172a; padding: 0.75rem 1.5rem; border-radius: 0.5rem; text-decoration: none; font-weight: bold; margin-top: 1.5rem; transition: transform 0.2s; }
          .btn:hover { transform: translateY(-2px); background: #7dd3fc; }
          code { background: #0f172a; padding: 0.2rem 0.4rem; border-radius: 0.25rem; font-size: 0.9em; }
        </style>
        <script>
          // Skript pro automatický append tokenu z URL do odkazu, pokud jej uživatel zadá
          window.onload = () => {
             const urlParams = new URLSearchParams(window.location.search);
             const token = urlParams.get('token');
             if (token) {
               document.getElementById('stream-link').href = '/stream?token=' + token;
             }
          };
        </script>
      </head>
      <body>
        <div class="container">
          <h1>🐟 ESP32 Relay Server</h1>
          <div class="stat">
            <span class="label">Hardware Status:</span>
            <span class="value ${esp32Socket ? 'online' : 'offline'}">${esp32Socket ? '🟢 Connected' : '🔴 Disconnected'}</span>
          </div>
          <div class="stat">
            <span class="label">Bandwidth Used:</span>
            <span class="value">${getBytesInGB(stats.bytesSent)} / ${BANDWIDTH_LIMIT_GB} GB</span>
          </div>
          <div class="stat">
            <span class="label">Live Viewers:</span>
            <span class="value">${mjpegClients.size} / ${MAX_VIEWERS}</span>
          </div>
          <div class="stat">
            <span class="label">Frames Received:</span>
            <span class="value">${stats.framesReceived}</span>
          </div>
          
          <div style="margin-top: 2rem; padding: 1rem; background: #0f172a; border-radius: 0.5rem; border: 1px dashed #334155;">
            <p style="margin-top:0; font-size: 0.9rem; color: #94a3b8;">Pro test streamu přidejte token do URL:</p>
            <code>?token=VASE_HESLO</code>
          </div>

          <a href="/stream" id="stream-link" class="btn">Otevřít Video Stream</a>
        </div>
      </body>
    </html>
  `);
});

/**
 * MJPEG STREAM s pojistkami
 * Use: /stream?token=vaše_heslo
 */
app.get("/stream", (req, res) => {
  // 1. Kontrola Tokenu (přijímáme ?token= nebo ?key=)
  const receivedToken = req.query.token || req.query.key;

  if (receivedToken !== AUTH_TOKEN) {
    console.warn(`[Stream] 403 Access Denied: Received "${receivedToken}", expected ${AUTH_TOKEN ? '***hidden***' : 'NOTHING (AUTH_TOKEN is empty!)'}`);
    return res.status(403).send("Unauthorized: Invalid or missing token.");
  }

  // 2. Kontrola počtu diváků
  if (mjpegClients.size >= MAX_VIEWERS) {
    return res.status(503).send("Too many viewers. Try again later.");
  }

  // 3. Kontrola celkového limitu (je i v middleware, ale jistota je jistota)
  if (isOverLimit()) {
    return res.status(429).send("Safety Cap: Bandwidth limit exceeded.");
  }

  res.writeHead(200, {
    "Content-Type": `multipart/x-mixed-replace; boundary=${MJPEG_BOUNDARY}`,
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
    "Connection": "keep-alive",
  });

  mjpegClients.add(res);
  stats.viewersCount = mjpegClients.size;
  console.log(`[Stream] Nový divák (IP: ${req.ip}). Celkem: ${mjpegClients.size}`);

  req.on("close", () => {
    mjpegClients.delete(res);
    stats.viewersCount = mjpegClients.size;
    console.log(`[Stream] Divák odpojen. Zbývá: ${mjpegClients.size}`);
  });
});

/**
 * POST /motor - Přeposlání příkazu na ESP32 (motor, světlo atd.)
 */
app.post("/motor", (req, res) => {
  if (req.headers['x-api-key'] !== AUTH_TOKEN && req.query.token !== AUTH_TOKEN) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  if (!esp32Socket || esp32Socket.readyState !== WebSocket.OPEN) {
    return res.status(503).json({ error: "ESP32 not connected" });
  }

  const command = JSON.stringify(req.body);
  esp32Socket.send(command);
  console.log(`[Motor] Odesláno: ${command}`);
  res.json({ ok: true });
});

app.get("/status", (req, res) => {
  res.json({
    esp32_connected: !!esp32Socket,
    bytes_sent_gb: getBytesInGB(stats.bytesSent),
    limit_gb: BANDWIDTH_LIMIT_GB,
    viewers: stats.viewersCount,
    frames_received: stats.framesReceived
  });
});

// --- SERVER & WEBSOCKET ---
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/" });

function broadcastFrame(frameBuffer) {
  if (mjpegClients.size === 0 || isOverLimit()) return;

  const frameHeader = `--${MJPEG_BOUNDARY}\r\n` +
    `Content-Type: image/jpeg\r\n` +
    `Content-Length: ${frameBuffer.length}\r\n\r\n`;

  const headerBuffer = Buffer.from(frameHeader);
  const footerBuffer = Buffer.from("\r\n");

  const totalBatchSize = headerBuffer.length + frameBuffer.length + footerBuffer.length;

  for (const res of mjpegClients) {
    try {
      res.write(headerBuffer);
      res.write(frameBuffer);
      res.write(footerBuffer);

      // Track bandwidth
      stats.bytesSent += totalBatchSize;
    } catch (err) {
      console.error("[Broadcast] Chyba zápisu:", err.message);
      mjpegClients.delete(res);
    }
  }
}

wss.on("connection", (socket, request) => {
  console.log(`[WS] ESP32 se připojuje...`);

  // Pro jednoduchost/volnost ESP32 nevyžaduje token v handshake (lze přidat)

  if (esp32Socket) {
    console.log("[WS] Odpojuji předchozí ESP32 instanci.");
    esp32Socket.terminate();
  }

  esp32Socket = socket;

  // Heartbeat pro detekce zombie spojení
  socket.isAlive = true;
  socket.on("pong", () => { socket.isAlive = true; });

  socket.on("message", (data, isBinary) => {
    if (isBinary) {
      const now = Date.now();
      if (now - lastFrameTime >= FRAME_MIN_MS) {
        lastFrame = data;
        lastFrameTime = now;
        stats.framesReceived++;
        broadcastFrame(data);
      }
    }
  });

  socket.on("close", () => {
    console.log("[WS] ESP32 odpojeno.");
    if (esp32Socket === socket) esp32Socket = null;
  });

  socket.on("error", (err) => console.error("[WS] Chyba:", err.message));
});

// Interval pro kontrolu živých spojení (každých 30s)
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((socket) => {
    if (socket.isAlive === false) {
      console.log("[WS] Zombie spojení detekováno – ukončuji");
      return socket.terminate();
    }
    socket.isAlive = false;
    socket.ping();
  });
}, 30000);

wss.on("close", () => clearInterval(heartbeatInterval));

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Relay server běží na portu ${PORT}`);
  console.log(`Bandwidth safe limit: ${BANDWIDTH_LIMIT_GB} GB`);
});
