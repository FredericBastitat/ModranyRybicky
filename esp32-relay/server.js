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
  res.json({
    status: "ESP32 Relay Active",
    bandwidth_used_gb: getBytesInGB(stats.bytesSent),
    bandwidth_limit_gb: BANDWIDTH_LIMIT_GB,
    esp32_connected: !!esp32Socket,
    viewers: mjpegClients.size,
    uptime_seconds: Math.floor((Date.now() - stats.startTime) / 1000)
  });
});

/**
 * MJPEG STREAM s pojistkami
 * Use: /stream?token=vaše_heslo
 */
app.get("/stream", (req, res) => {
  // 1. Kontrola Tokenu
  if (req.query.token !== AUTH_TOKEN) {
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
