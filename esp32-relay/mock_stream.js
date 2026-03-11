"use strict";

/**
 * ESP32-CAM Mock Streamer (pro testování bez hardware)
 * Posílá náhodné testovací snímky na Relay Server přes WebSocket.
 */

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

// KONFIGURACE
const RELAY_URL = process.env.RELAY_URL || 'ws://rybicky-cloud.fly.dev/';
const FPS = parseInt(process.env.FPS || '10');
const INTERVAL_MS = 1000 / FPS;

console.log(`[Mock] Připojuji se k: ${RELAY_URL}`);

const ws = new WebSocket(RELAY_URL);

ws.on('open', () => {
    console.log('[Mock] Připojeno k relay serveru!');

    // Identifikace (volitelné, server to zatím nevyžaduje pro binární stream)
    ws.send(JSON.stringify({ type: 'esp32', role: 'mock-camera' }));

    // Funkce pro simulaci snímku (barevný obdélník jako JPEG)
    // Protože nemáme reálnou kameru, vytvoříme jednoduchý "obraz" v paměti
    // Nebo budeme jen posílat "ping-pong" dat, pokud nemáme JPEG soubor.

    setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            // vytvoříme dummy buffer (v reálu by zde byl JPEG frame)
            // Pro vizuální test v prohlížeči by bylo lepší mít reálný JPEG.
            // Posíláme malý buffer jako placeholder.
            const dummyFrame = Buffer.alloc(100, Math.random() * 255);
            ws.send(dummyFrame);
            // console.log('[Mock] Snímek odeslán');
        }
    }, INTERVAL_MS);
});

ws.on('message', (data) => {
    console.log(`[Mock] Přijat příkaz: ${data}`);
});

ws.on('error', (err) => {
    console.error(`[Mock] Chyba: ${err.message}`);
});

ws.on('close', () => {
    console.log('[Mock] Odpojeno.');
    process.exit(1);
});
