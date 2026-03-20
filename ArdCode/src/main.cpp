#include "Arduino.h"
#include "esp_camera.h"
#include "WiFi.h"
#include <WebSocketsClient.h>

// ── WiFi KONFIGURACE ──────────────────────────────────────────
#define WIFI_SSID "Rokle"
#define WIFI_PASS "Centrum-17"

// ── RELAY SERVER (FLY.IO) ─────────────────────────────────────
const char* ws_host = "rybicky-cloud.fly.dev";
const int ws_port = 443; // Fly.io vynucuje HTTPS/WSS

WebSocketsClient webSocket;
bool ws_connected = false;

// ── AI-Thinker pin mapa ───────────────────────────
#define PWDN_GPIO_NUM  32
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM   0
#define SIOD_GPIO_NUM  26
#define SIOC_GPIO_NUM  27
#define Y9_GPIO_NUM    35
#define Y8_GPIO_NUM    34
#define Y7_GPIO_NUM    39
#define Y6_GPIO_NUM    36
#define Y5_GPIO_NUM    21
#define Y4_GPIO_NUM    19
#define Y3_GPIO_NUM    18
#define Y2_GPIO_NUM     5
#define VSYNC_GPIO_NUM 25
#define HREF_GPIO_NUM  23
#define PCLK_GPIO_NUM  22

// ── WebSocket Eventy ───────────────────────────
void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch(type) {
    case WStype_DISCONNECTED:
      Serial.println("[WS] Odpojeno");
      ws_connected = false;
      break;
    case WStype_CONNECTED:
      Serial.printf("[WS] Připojeno k: %s\n", payload);
      ws_connected = true;
      // Volitelně pošli identifikační zprávu
      webSocket.sendTXT("{\"type\":\"esp32\",\"role\":\"camera\"}");
      break;
    case WStype_TEXT:
      Serial.printf("[WS] Přijat text: %s\n", payload);
      // Zde lze zpracovat příkazy pro motory
      break;
    case WStype_BIN:
      // Server nám binární data posílat nebude, ale pro jistotu
      break;
    case WStype_ERROR:
      Serial.println("[WS] Chyba!");
      break;
  }
}

// ── Setup ─────────────────────────────────────────
void setup() {
  Serial.begin(115200);

  // Konfigurace kamery
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer   = LEDC_TIMER_0;
  config.pin_d0       = Y2_GPIO_NUM;
  config.pin_d1       = Y3_GPIO_NUM;
  config.pin_d2       = Y4_GPIO_NUM;
  config.pin_d3       = Y5_GPIO_NUM;
  config.pin_d4       = Y6_GPIO_NUM;
  config.pin_d5       = Y7_GPIO_NUM;
  config.pin_d6       = Y8_GPIO_NUM;
  config.pin_d7       = Y9_GPIO_NUM;
  config.pin_xclk     = XCLK_GPIO_NUM;
  config.pin_pclk     = PCLK_GPIO_NUM;
  config.pin_vsync    = VSYNC_GPIO_NUM;
  config.pin_href     = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn     = PWDN_GPIO_NUM;
  config.pin_reset    = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  
  // Nastavení pro stabilitu a rozlišení
  config.frame_size   = FRAMESIZE_QVGA;  // 320x240 pro začátek
  config.jpeg_quality = 12;
  config.fb_count     = 1;
  config.fb_location  = CAMERA_FB_IN_DRAM;

  if (esp_camera_init(&config) != ESP_OK) {
    Serial.println("Camera init FAILED");
    return;
  }
  Serial.println("Camera OK");

  // WiFi
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("Connecting WiFi");
  while (WiFi.status() != WL_CONNECTED) { 
    delay(500); 
    Serial.print("."); 
  }
  Serial.println("\nWiFi OK, IP: " + WiFi.localIP().toString());

  // WebSocket
  webSocket.begin(ws_host, ws_port, "/");
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000); // Zkus znovu po 5s při výpadku
}

unsigned long lastFrameTime = 0;
const int frameInterval = 500; // 0.5 sec = 2 FPS (šetrné k datům Fly.io)

void loop() {
  webSocket.loop();

  if (ws_connected && (millis() - lastFrameTime > frameInterval)) {
    camera_fb_t *fb = esp_camera_fb_get();
    if (fb) {
      // Odeslání binárních dat (JPEG snímku)
      webSocket.sendBIN(fb->buf, fb->len);
      esp_camera_fb_return(fb);
      lastFrameTime = millis();
    } else {
      Serial.println("Focení selhalo!");
    }
  }
}