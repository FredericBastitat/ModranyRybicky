/*
 * ESP32-CAM Relay Client Firmware
 * ─────────────────────────────────────────────────────────────────
 * Funkce:
 *  - Připojení na WiFi
 *  - WebSocket klient → Oracle VM relay server
 *  - Proudový JPEG stream (binary WebSocket frames)
 *  - Příjem motor příkazů přes WebSocket (JSON text)
 *  - Ovládání motoru přes L298N / L9110S driver
 *
 * Knihovny (Arduino Library Manager):
 *  - esp32-camera      (součást esp32 core)
 *  - arduinoWebSockets (Markus Sattler)
 *  - ArduinoJson       (Benoit Blanchon)
 *
 * Board: "AI Thinker ESP32-CAM" v Arduino IDE
 */

#include "esp_camera.h"
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

// ═══════════════════════════════════════════════════════════════
//  KONFIGURACE – ZMĚNIT PŘED NAHRÁNÍM
// ═══════════════════════════════════════════════════════════════
const char* WIFI_SSID  = "VASE_WIFI_SSID";
const char* WIFI_PASS  = "VASE_WIFI_HESLO";
const char* RELAY_HOST = "ORACLE_VM_IP";   // např. "123.456.789.0"
const int   RELAY_PORT = 8080;

// ═══════════════════════════════════════════════════════════════
//  PINY KAMERY – AI Thinker ESP32-CAM pinout
// ═══════════════════════════════════════════════════════════════
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

// ═══════════════════════════════════════════════════════════════
//  PINY MOTORU – L298N nebo L9110S
//  ⚠️  GPIO 12,13,14,15 jsou volné na AI Thinker desce
//  ⚠️  GPIO 12 musí být LOW při bootu (jinak bootloop)!
// ═══════════════════════════════════════════════════════════════
#define MOTOR_IN1  12   // Motor A – vstup 1
#define MOTOR_IN2  13   // Motor A – vstup 2
#define MOTOR_IN3  14   // Motor B – vstup 1
#define MOTOR_IN4  15   // Motor B – vstup 2

// ═══════════════════════════════════════════════════════════════
//  TIMING
// ═══════════════════════════════════════════════════════════════
#define FRAME_INTERVAL_MS  100    // ~10 FPS
#define WS_RECONNECT_MS   5000   // pokus o reconnect každých 5s

// ═══════════════════════════════════════════════════════════════
//  GLOBÁLNÍ PROMĚNNÉ
// ═══════════════════════════════════════════════════════════════
WebSocketsClient ws;
unsigned long lastFrameTime = 0;
bool wsConnected = false;

// ═══════════════════════════════════════════════════════════════
//  MOTOR – FUNKCE
// ═══════════════════════════════════════════════════════════════
void motorSetup() {
  pinMode(MOTOR_IN1, OUTPUT);
  pinMode(MOTOR_IN2, OUTPUT);
  pinMode(MOTOR_IN3, OUTPUT);
  pinMode(MOTOR_IN4, OUTPUT);
  motorStop();
}

void motorStop() {
  digitalWrite(MOTOR_IN1, LOW);
  digitalWrite(MOTOR_IN2, LOW);
  digitalWrite(MOTOR_IN3, LOW);
  digitalWrite(MOTOR_IN4, LOW);
}

void motorForward() {
  digitalWrite(MOTOR_IN1, HIGH);
  digitalWrite(MOTOR_IN2, LOW);
  digitalWrite(MOTOR_IN3, HIGH);
  digitalWrite(MOTOR_IN4, LOW);
}

void motorBackward() {
  digitalWrite(MOTOR_IN1, LOW);
  digitalWrite(MOTOR_IN2, HIGH);
  digitalWrite(MOTOR_IN3, LOW);
  digitalWrite(MOTOR_IN4, HIGH);
}

void motorLeft() {
  // Levotočivé otočení – levý motor dozadu, pravý dopředu
  digitalWrite(MOTOR_IN1, LOW);
  digitalWrite(MOTOR_IN2, HIGH);
  digitalWrite(MOTOR_IN3, HIGH);
  digitalWrite(MOTOR_IN4, LOW);
}

void motorRight() {
  // Pravotočivé otočení – levý motor dopředu, pravý dozadu
  digitalWrite(MOTOR_IN1, HIGH);
  digitalWrite(MOTOR_IN2, LOW);
  digitalWrite(MOTOR_IN3, LOW);
  digitalWrite(MOTOR_IN4, HIGH);
}

void handleMotorCommand(const String& payload) {
  StaticJsonDocument<64> doc;
  DeserializationError err = deserializeJson(doc, payload);
  if (err) {
    Serial.printf("[Motor] JSON parse error: %s\n", err.c_str());
    return;
  }

  const char* dir = doc["dir"];
  if (!dir) return;

  Serial.printf("[Motor] Příkaz: %s\n", dir);

  if      (strcmp(dir, "forward")  == 0) motorForward();
  else if (strcmp(dir, "backward") == 0) motorBackward();
  else if (strcmp(dir, "left")     == 0) motorLeft();
  else if (strcmp(dir, "right")    == 0) motorRight();
  else if (strcmp(dir, "stop")     == 0) motorStop();
  else Serial.printf("[Motor] Neznámý příkaz: %s\n", dir);
}

// ═══════════════════════════════════════════════════════════════
//  WEBSOCKET – CALLBACK
// ═══════════════════════════════════════════════════════════════
void onWebSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      wsConnected = true;
      Serial.printf("[WS] Připojeno na ws://%s:%d\n", RELAY_HOST, RELAY_PORT);
      // Identifikace jako ESP32 kamera
      ws.sendTXT("{\"type\":\"esp32\",\"role\":\"camera\"}");
      break;

    case WStype_DISCONNECTED:
      wsConnected = false;
      Serial.println("[WS] Odpojeno od relay serveru");
      motorStop(); // Bezpečnostní stop při ztrátě spojení
      break;

    case WStype_TEXT:
      // Příchozí JSON příkaz pro motor
      Serial.printf("[WS] Příkaz přijat: %s\n", (char*)payload);
      handleMotorCommand(String((char*)payload));
      break;

    case WStype_ERROR:
      Serial.println("[WS] Chyba WebSocket spojení");
      break;

    default:
      break;
  }
}

// ═══════════════════════════════════════════════════════════════
//  KAMERA – INICIALIZACE
// ═══════════════════════════════════════════════════════════════
bool cameraInit() {
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
  config.pin_sscb_sda = SIOD_GPIO_NUM;
  config.pin_sscb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn     = PWDN_GPIO_NUM;
  config.pin_reset    = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.grab_mode    = CAMERA_GRAB_LATEST;

  // Vyšší rozlišení pokud je dostatek PSRAM
  if (psramFound()) {
    config.frame_size   = FRAMESIZE_VGA;   // 640x480
    config.jpeg_quality = 12;              // 0-63, nižší = lepší kvalita
    config.fb_count     = 2;
  } else {
    config.frame_size   = FRAMESIZE_QVGA;  // 320x240
    config.jpeg_quality = 20;
    config.fb_count     = 1;
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("[CAM] Chyba inicializace: 0x%x\n", err);
    return false;
  }

  // Optimalizace senzoru
  sensor_t* s = esp_camera_sensor_get();
  s->set_framesize(s, FRAMESIZE_VGA);
  s->set_quality(s, 12);
  s->set_brightness(s, 0);
  s->set_contrast(s, 0);
  s->set_saturation(s, 0);
  s->set_whitebal(s, 1);
  s->set_awb_gain(s, 1);
  s->set_wb_mode(s, 0);

  Serial.println("[CAM] Kamera inicializována úspěšně");
  return true;
}

// ═══════════════════════════════════════════════════════════════
//  SETUP
// ═══════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  Serial.println("\n[ESP32-CAM] Startuje...");

  // Motor setup jako první – 12 musí být LOW při bootu
  motorSetup();

  // WiFi
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("[WiFi] Připojování");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.printf("\n[WiFi] Připojeno! IP: %s\n", WiFi.localIP().toString().c_str());

  // Kamera
  if (!cameraInit()) {
    Serial.println("[FATAL] Kamera selhala – restart za 5s");
    delay(5000);
    ESP.restart();
  }

  // WebSocket – automatický reconnect každých 5s
  ws.begin(RELAY_HOST, RELAY_PORT, "/");
  ws.onEvent(onWebSocketEvent);
  ws.setReconnectInterval(WS_RECONNECT_MS);
  ws.enableHeartbeat(15000, 3000, 2); // ping každých 15s

  Serial.printf("[WS] Připojuji na ws://%s:%d/\n", RELAY_HOST, RELAY_PORT);
}

// ═══════════════════════════════════════════════════════════════
//  HLAVNÍ SMYČKA
// ═══════════════════════════════════════════════════════════════
void loop() {
  ws.loop(); // WebSocket heartbeat a reconnect

  // WiFi watchdog
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Ztraceno – pokus o reconnect...");
    WiFi.reconnect();
    delay(5000);
    return;
  }

  // Odesílání video snímků
  if (wsConnected && (millis() - lastFrameTime >= FRAME_INTERVAL_MS)) {
    lastFrameTime = millis();

    camera_fb_t* fb = esp_camera_fb_get();
    if (!fb) {
      Serial.println("[CAM] Chyba sejmutí snímku");
      return;
    }

    // Odeslat JPEG jako binary WebSocket frame
    bool sent = ws.sendBIN(fb->buf, fb->len);
    if (!sent) {
      Serial.println("[WS] Chyba odeslání snímku");
    }

    esp_camera_fb_return(fb); // DŮLEŽITÉ: vrátit frame buffer!
  }
}
