#include "Arduino.h"
#include "esp_camera.h"
#include "WiFi.h"
#include <HTTPClient.h>

// ── WiFi KONFIGURACE ──────────────────────────────────────────
#define WIFI_SSID "Rokle"
#define WIFI_PASS "Centrum-17"

// ── RELAY SERVER (FLY.IO) ─────────────────────────────────────
const char* RELAY_URL = "https://rybicky-cloud.fly.dev/upload-frame";
const char* AUTH_TOKEN = "zmen-me-prosim";

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
  config.xclk_freq_hz = 10000000;
  config.pixel_format = PIXFORMAT_JPEG;
  
  config.frame_size   = FRAMESIZE_QVGA;  // 320x240
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
}

unsigned long lastFrameTime = 0;
const int frameInterval = 500; // 2 FPS
int frameCount = 0;

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Reconnecting...");
    WiFi.reconnect();
    delay(3000);
    return;
  }

  if (millis() - lastFrameTime < frameInterval) {
    delay(10);
    return;
  }

  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("[CAM] Snimek selhal!");
    delay(500);
    return;
  }

  HTTPClient http;
  http.begin(RELAY_URL);
  http.addHeader("Content-Type", "image/jpeg");
  http.addHeader("X-Api-Key", AUTH_TOKEN);
  http.setTimeout(5000);

  int httpCode = http.POST(fb->buf, fb->len);
  esp_camera_fb_return(fb);
  
  frameCount++;
  if (httpCode == 200) {
    if (frameCount % 20 == 0) {
      Serial.printf("[OK] Frame #%d odeslan (%d bytes)\n", frameCount, fb->len);
    }
  } else {
    Serial.printf("[ERR] HTTP %d pri odesilani frame #%d\n", httpCode, frameCount);
  }
  
  http.end();
  lastFrameTime = millis();
}