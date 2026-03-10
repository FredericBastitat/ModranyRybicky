# ESP32-CAM Web Control Panel

Kompletní řešení pro vzdálený video stream a ovládání pohybu (motorů) přes internet.

## Architektura
`[ESP32-CAM] ──WS──► [Oracle VM Relay] ◄──HTTP/POST── [Vercel Next.js] ◄── [Browser]`

## Komponenty

### 1. Firmware (`/firmware`)
- Arduino kód pro ESP32-CAM (AI Thinker).
- Připojuje se jako WebSocket klient k relay serveru.
- Posílá JPEG snímky a přijímá JSON příkazy pro motory.
- **Piny:** Motor IN1-4 (GPIO 12, 13, 14, 15).

### 2. Relay Server (`/relay`)
- Node.js server běžící na Oracle Cloud (nebo jiném VPS s veřejnou IP).
- Drží WebSocket spojení s ESP32.
- Poskytuje MJPEG stream na `/stream`.
- Přeposílá POST požadavky z webu na ESP32.

### 3. Web Dashboard (`/web`)
- Next.js 14 aplikace (App Router).
- Moderní tmavý design s Tailwind CSS.
- Přímé napojení na MJPEG stream pro minimální latenci.

## Rychlý start

### Oracle VM (Relay)
```bash
cd relay
npm install
node server.js
```
Otevřete port **8080** v security listu Oracle Cloudu!

### ESP32-CAM (Firmware)
1. Otevřete `firmware/esp32cam.ino` v Arduino IDE.
2. Nastavte `WIFI_SSID`, `WIFI_PASS` a `RELAY_HOST` (IP vašeho Oracle VM).
3. Nahrajte do ESP32-CAM.

### Vercel (Frontend)
1. Nahrajte složku `web` na GitHub.
2. Připojte k Vercelu.
3. Nastavte Environment Variables:
   - `ORACLE_RELAY_URL=http://vase-ip:8080`
   - `NEXT_PUBLIC_STREAM_URL=http://vase-ip:8080/stream`

## Autor
Vytvořeno pomocí Antigravity AI.
