# ESP32-CAM Web Control Panel

Kompletní řešení pro vzdálený video stream a ovládání pohybu (motorů) přes internet s důrazem na bezpečnost a limity Fly.io Free Tier.

## Architektura
`[ESP32-CAM] ──WS──► [Fly.io Relay] ◄──HTTP/POST── [Next.js (Vercel)] ◄── [Browser]`

## Komponenty

### 1. Firmware (`/firmware`)
- Arduino kód pro ESP32-CAM (AI Thinker).
- Připojuje se jako WebSocket klient k Fly.io relay serveru na portu 80.
- Posílá JPEG snímky a přijímá JSON příkazy pro motory.
- **Piny:** Motor IN1-4 (GPIO 12, 13, 14, 15).

### 2. Relay Server (`/esp32-relay`)
- Node.js server optimalizovaný pro **Fly.io**.
- **Pojistky:** Sleduje bandwidth, omezuje FPS a počet diváků pro ochranu free tieru.
- **Bezpečnost:** Chráněno pomocí `AUTH_TOKEN`.
- Poskytuje MJPEG stream a interaktivní Dashboard se statistikami.

### 3. Web Dashboard (`/web`)
- Next.js 14 aplikace (App Router).
- Moderní tmavý design, skleněné efekty a plynulé animace.
- Detailní monitorování stavu streamu a cloudu přímo v UI.

## Rychlý start

### Fly.io (Relay)
1. Nainstalujte `flyctl`.
2. Ve složce `esp32-relay` spusťte:
   ```bash
   fly launch  # Vyberte jméno a region (fra)
   fly secrets set AUTH_TOKEN="vase_heslo"
   fly deploy
   ```

### ESP32-CAM (Firmware)
1. Otevřete `firmware/esp32cam.ino` v Arduino IDE.
2. Nastavte `WIFI_SSID`, `WIFI_PASS` a `RELAY_HOST` (vase-app.fly.dev).
3. Nastavte `RELAY_PORT = 80`.
4. Nahrajte do ESP32-CAM.

### Vercel (Frontend)
1. Nastavte Environment Variables:
   - `ORACLE_RELAY_URL=https://vase-app.fly.dev`
   - `NEXT_PUBLIC_STREAM_URL=https://vase-app.fly.dev/stream`
   - `RELAY_AUTH_TOKEN=vase_heslo`
   - `NEXT_PUBLIC_STREAM_TOKEN=vase_heslo`

## Autor
Vytvořeno pomocí Antigravity AI.
