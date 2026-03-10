/**
 * ESP32-CAM Relay Server
 * ─────────────────────────────────────────────────────────────────
 * Spouštění:
 *   npm install
 *   node server.js
 *
 * Endpointy:
 *   WS  /          – ESP32-CAM se připojuje sem (posílá JPEG frames)
 *   GET /stream    – MJPEG HTTP stream pro prohlížeč
 *   GET /snapshot  – Aktuální JPEG snímek (single frame)
 *   POST /motor    – Přijímá motor příkazy z Vercel, přeposílá na ESP32
 *   GET /status    – Health check + statistiky
 */

"use strict";

const http = require("http");
const express = require("express");
const { WebSocketServer, WebSocket } = require("ws");
const cors = require("cors");

// ─────────────────────────────────────────────────────────────────
//  KONFIGURACE
// ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
const MJPEG_BOUNDARY = "ESP32CAM_STREAM_BOUNDARY";
const MAX_FPS = 30;                   // Limit FPS pro MJPEG klienty
const FRAME_MIN_MS = 1000 / MAX_FPS;

// ─────────────────────────────────────────────────────────────────
//  STAV SERVERU
// ─────────────────────────────────────────────────────────────────
let esp32Socket = null;    // Aktivní WebSocket spojení s ESP32
let lastFrame = null;    // Poslední přijatý JPEG frame (Buffer)
let lastFrameTime = 0;       // Timestamp posledního frame
let frameCount = 0;       // Celkový počet přijatých snímků
let mjpegClients = new Set(); // Aktivní MJPEG HTTP klienti

const stats = {
    esp32Connected: false,
    esp32ConnectedAt: null,
    framesReceived: 0,
    framesPerSecond: 0,
    motorCommands: 0,
    mjpegViewers: 0,
};

// FPS měření
let fpsFrameCount = 0;
setInterval(() => {
    stats.framesPerSecond = fpsFrameCount;
    fpsFrameCount = 0;
}, 1000);

// ─────────────────────────────────────────────────────────────────
//  EXPRESS APP + MIDDLEWARE
// ─────────────────────────────────────────────────────────────────
const app = express();

app.use(cors({
    origin: "*", // V produkci omezte na vaši Vercel doménu
    methods: ["GET", "POST"],
}));
app.use(express.json());

// Request logging
app.use((req, res, next) => {
    const ts = new Date().toISOString();
    console.log(`[${ts}] ${req.method} ${req.path} – ${req.ip}`);
    next();
});

// ─────────────────────────────────────────────────────────────────
//  MJPEG HELPER – poslat frame všem klientům
// ─────────────────────────────────────────────────────────────────
function broadcastFrame(frameBuffer) {
    if (mjpegClients.size === 0) return;

    const header = Buffer.from(
        `--${MJPEG_BOUNDARY}\r\n` +
        `Content-Type: image/jpeg\r\n` +
        `Content-Length: ${frameBuffer.length}\r\n\r\n`
    );

    for (const res of mjpegClients) {
        try {
            res.write(header);
            res.write(frameBuffer);
            res.write(Buffer.from("\r\n"));
        } catch (err) {
            console.error("[MJPEG] Chyba zápisu ke klientovi:", err.message);
            mjpegClients.delete(res);
            stats.mjpegViewers = mjpegClients.size;
        }
    }
}

// ─────────────────────────────────────────────────────────────────
//  HTTP ENDPOINTY
// ─────────────────────────────────────────────────────────────────

/**
 * GET /stream – Nekonečný MJPEG stream
 * Prohlížeč se připojí přes <img src="http://oracle:8080/stream">
 */
app.get("/stream", (req, res) => {
    res.writeHead(200, {
        "Content-Type": `multipart/x-mixed-replace; boundary=${MJPEG_BOUNDARY}`,
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
    });

    mjpegClients.add(res);
    stats.mjpegViewers = mjpegClients.size;
    console.log(`[MJPEG] Nový divák. Celkem: ${mjpegClients.size}`);

    // Okamžitě pošle poslední dostupný snímek (pokud existuje)
    if (lastFrame) {
        const header = Buffer.from(
            `--${MJPEG_BOUNDARY}\r\n` +
            `Content-Type: image/jpeg\r\n` +
            `Content-Length: ${lastFrame.length}\r\n\r\n`
        );
        res.write(header);
        res.write(lastFrame);
        res.write(Buffer.from("\r\n"));
    }

    req.on("close", () => {
        mjpegClients.delete(res);
        stats.mjpegViewers = mjpegClients.size;
        console.log(`[MJPEG] Divák odpojen. Zbývá: ${mjpegClients.size}`);
    });
});

/**
 * GET /snapshot – Vrátí aktuální JPEG snímek (single image)
 */
app.get("/snapshot", (req, res) => {
    if (!lastFrame) {
        return res.status(503).json({
            error: "Žádný snímek k dispozici",
            esp32Connected: stats.esp32Connected,
        });
    }
    res.writeHead(200, {
        "Content-Type": "image/jpeg",
        "Content-Length": lastFrame.length,
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*",
    });
    res.end(lastFrame);
});

/**
 * POST /motor – Přijme motor příkaz z Vercel, přepošle na ESP32
 * Body: { "dir": "forward" | "backward" | "left" | "right" | "stop" }
 */
app.post("/motor", (req, res) => {
    const { dir } = req.body;
    const validDirs = ["forward", "backward", "left", "right", "stop"];

    if (!dir || !validDirs.includes(dir)) {
        return res.status(400).json({
            error: "Neplatný příkaz",
            valid: validDirs,
        });
    }

    if (!esp32Socket || esp32Socket.readyState !== WebSocket.OPEN) {
        return res.status(503).json({
            error: "ESP32 není připojeno",
            esp32Connected: false,
        });
    }

    const command = JSON.stringify({ dir });
    esp32Socket.send(command, (err) => {
        if (err) {
            console.error("[Motor] Chyba odeslání příkazu:", err.message);
            return res.status(500).json({ error: "Chyba odeslání příkazu na ESP32" });
        }
        stats.motorCommands++;
        console.log(`[Motor] Příkaz odeslán: ${command}`);
        res.json({ ok: true, dir, timestamp: Date.now() });
    });
});

/**
 * GET /status – Health check a statistiky
 */
app.get("/status", (req, res) => {
    res.json({
        ...stats,
        uptime: process.uptime(),
        lastFrameAge: lastFrameTime ? (Date.now() - lastFrameTime) : null,
        nodeVersion: process.version,
        timestamp: new Date().toISOString(),
    });
});

/**
 * GET / – Základní info stránka
 */
app.get("/", (req, res) => {
    res.json({
        name: "ESP32-CAM Relay Server",
        version: "1.0.0",
        endpoints: {
            stream: "GET  /stream   – MJPEG video stream",
            snapshot: "GET  /snapshot – Aktuální JPEG snímek",
            motor: "POST /motor    – Motor příkaz { dir: string }",
            status: "GET  /status   – Statistiky serveru",
        },
    });
});

// ─────────────────────────────────────────────────────────────────
//  HTTP + WEBSOCKET SERVER
// ─────────────────────────────────────────────────────────────────
const server = http.createServer(app);

const wss = new WebSocketServer({
    server,
    path: "/",
    maxPayload: 1024 * 1024, // Max 1MB per frame (JPEG VGA ~ 30-80KB)
});

wss.on("connection", (socket, request) => {
    const clientIP = request.socket.remoteAddress;
    console.log(`[WS] Nové WebSocket spojení od: ${clientIP}`);

    // Zatím přijímáme jen jedno ESP32 spojení najednou
    if (esp32Socket && esp32Socket.readyState === WebSocket.OPEN) {
        console.log("[WS] Nahrazuji staré ESP32 spojení novým");
        esp32Socket.close();
    }

    esp32Socket = socket;
    stats.esp32Connected = true;
    stats.esp32ConnectedAt = new Date().toISOString();
    console.log(`[WS] ESP32 připojeno! (${clientIP})`);

    socket.on("message", (data, isBinary) => {
        if (isBinary) {
            // Binární data = JPEG frame z kamery
            lastFrame = data;
            lastFrameTime = Date.now();
            stats.framesReceived++;
            fpsFrameCount++;
            broadcastFrame(data);
        } else {
            // Textová zpráva = JSON status/identifikace
            const text = data.toString();
            console.log(`[WS] Textová zpráva: ${text}`);
            try {
                const msg = JSON.parse(text);
                if (msg.type === "esp32") {
                    console.log(`[WS] ESP32 identifikace: role=${msg.role}`);
                }
            } catch (_) {
                // Ignorovat neplatné JSON
            }
        }
    });

    socket.on("close", (code, reason) => {
        console.log(`[WS] ESP32 odpojeno. Kód: ${code}, Důvod: ${reason}`);
        if (esp32Socket === socket) {
            esp32Socket = null;
            stats.esp32Connected = false;
            stats.esp32ConnectedAt = null;
        }
    });

    socket.on("error", (err) => {
        console.error("[WS] WebSocket chyba:", err.message);
    });

    // Heartbeat – detekce zombie spojení
    socket.isAlive = true;
    socket.on("pong", () => { socket.isAlive = true; });
});

// Heartbeat interval – kontrola živých spojení každých 30s
const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((socket) => {
        if (!socket.isAlive) {
            console.log("[WS] Zombie spojení detekováno – ukončuji");
            return socket.terminate();
        }
        socket.isAlive = false;
        socket.ping();
    });
}, 30000);

wss.on("close", () => clearInterval(heartbeatInterval));

// ─────────────────────────────────────────────────────────────────
//  SPUŠTĚNÍ
// ─────────────────────────────────────────────────────────────────
server.listen(PORT, "0.0.0.0", () => {
    console.log("╔═══════════════════════════════════════════╗");
    console.log("║      ESP32-CAM Relay Server v1.0.0        ║");
    console.log("╠═══════════════════════════════════════════╣");
    console.log(`║  Port:     ${PORT.toString().padEnd(32)} ║`);
    console.log(`║  Stream:   http://0.0.0.0:${PORT}/stream ${"".padEnd(10)} ║`);
    console.log(`║  Status:   http://0.0.0.0:${PORT}/status ${"".padEnd(10)} ║`);
    console.log("╚═══════════════════════════════════════════╝");
});

// Graceful shutdown
process.on("SIGTERM", () => {
    console.log("[Server] SIGTERM přijat – ukončuji...");
    server.close(() => process.exit(0));
});

process.on("SIGINT", () => {
    console.log("\n[Server] SIGINT přijat – ukončuji...");
    server.close(() => process.exit(0));
});
