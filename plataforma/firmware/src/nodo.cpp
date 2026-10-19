// Fase 2 del nodo de prueba (TT-32; diseño en docs/17 §6.2, escrito antes que este código). Cada PERIODO_S lee el módulo de aire
// (BME280, I2C), la sonda de suelo (DS18B20, 1-Wire) y el sensor capacitivo de humedad de suelo (ADC) y publica UN pack SenML por
// MQTT sobre TLS con QoS 1, con la credencial del alta. Los secretos (red, credencial, dirección del proxy, CA) viven en
// include/secretos.h, que git ignora; la plantilla es include/secretos.h.ejemplo. Nunca imprime la clave, la MAC ni la IP.
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <MQTT.h>
#include <Wire.h>
#include <Adafruit_BME280.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <time.h>
#include <esp_sntp.h>
#include <math.h>
#include "secretos.h"

static constexpr int PIN_SDA = 21, PIN_SCL = 22, PIN_1WIRE = 4, PIN_SUELO = 34;  // docs/17 §4.4
static constexpr uint32_t PERIODO_S = 60;             // docs/10 §8.4 punto 51; el mismo intervalo_esperado_s del alta
static constexpr uint32_t ESPERA_WIFI_MS = 20000;
static constexpr uint32_t ESPERA_NTP_MS = 10000;
static constexpr time_t HORA_MINIMA = 946684800;     // 2000-01-01 UTC: antes de eso el reloj no está puesto (docs/13 regla 7)
static constexpr int MQTT_KEEPALIVE_S = 60;
static constexpr int MQTT_TIMEOUT_MS = 5000;         // espera del PUBACK (QoS 1) y de la respuesta al CONNECT
static constexpr float DS18B20_ARRANQUE_C = 85.0F;   // valor de arranque de la sonda, antes de su primera conversión (hoja de Maxim)
static const char *NOMBRE_DEL_SERVIDOR = "proxy";    // entrada DNS del SAN del certificado del proxy (proxy/ca-desarrollo.sh)
static constexpr uint32_t SUELO_MINIMO_MV = 100;    // un sensor sin alimentación da 0 V; por debajo de 150 mV el ADC tampoco es preciso
static constexpr size_t TAM_PACK = 512;              // el pack de seis registros mide ≈ 260 bytes (263 medidos en el banco)

static WiFiClientSecure tls;
static MQTTClient mqtt(TAM_PACK);                    // el tope por defecto de la biblioteca (128) no alcanza para el pack
static OneWire bus(PIN_1WIRE);
static DallasTemperature sondas(&bus);
static Adafruit_BME280 bme;
static bool hayBme = false;
static char topico[160];
static uint32_t ciclo = 0, publicados = 0, fallidos = 0;
static uint32_t proximoCicloMs = 0, proximoIntentoMs = 0, esperaReintentoMs = 5000;

// «Con hora» solo cuando SNTP avisó que sincronizó (su callback): el reloj del sistema puede sobrevivir a un reinicio por software sin
// volver a sincronizar, y «una fecha posterior a 2000» no bastaría para asegurar que la marca bt es real.
static volatile bool horaNtp = false;
static void alSincronizar(struct timeval *) { horaNtp = true; }
static bool horaPuesta() { return horaNtp && time(nullptr) >= HORA_MINIMA; }

static bool conectarWifi() {
  if (WiFi.status() == WL_CONNECTED) return true;
  Serial.print("Wi-Fi: conectando");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_CLAVE);
  const uint32_t inicio = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - inicio < ESPERA_WIFI_MS) { delay(500); Serial.print('.'); }
  if (WiFi.status() != WL_CONNECTED) { Serial.println(" sin conexión (¿nombre o clave de la red?)"); return false; }
  Serial.printf(" conectado (señal %d dBm)\n", WiFi.RSSI());
  return true;
}

static void pedirHora() {
  configTime(0, 0, NTP_SERVIDOR);  // UTC; el núcleo sigue sincronizando en segundo plano
  const uint32_t inicio = millis();
  while (!horaPuesta() && millis() - inicio < ESPERA_NTP_MS) delay(200);
  Serial.println(horaPuesta() ? "NTP: hora puesta (los packs llevarán bt)" : "NTP: sin hora todavía (los packs irán sin bt: el backend usa la hora de recepción)");
}

// TLS a la IP del proxy verificando el nombre «proxy» del certificado con la CA propia; después, MQTT sobre esa misma conexión
// (skip = true: la biblioteca no abre otra). Por qué el nombre y no la IP: docs/17 §6.2.
static bool conectarBroker() {
  IPAddress ip;
  if (!ip.fromString(MQTT_HOST) && WiFi.hostByName(MQTT_HOST, ip) != 1) { Serial.println("MQTT: no se resolvió la dirección del proxy"); return false; }
  tls.stop();
  tls.setTimeout(10);           // segundos para el socket (el constructor pone 30 s)
  tls.setHandshakeTimeout(10);  // segundos para el saludo TLS (el constructor pone 120 s): un servidor que acepta TCP y calla no bloquea 2 min
  if (!tls.connect(ip, MQTT_PUERTO, NOMBRE_DEL_SERVIDOR, CA_PEM, nullptr, nullptr)) {
    char detalle[96];
    tls.lastError(detalle, sizeof(detalle));
    Serial.printf("TLS: falló (%s)\n", detalle);
    return false;
  }
  mqtt.begin(ip, MQTT_PUERTO, tls);
  mqtt.setOptions(MQTT_KEEPALIVE_S, true, MQTT_TIMEOUT_MS);
  if (!mqtt.connect(DISPOSITIVO_ID, DISPOSITIVO_ID, DISPOSITIVO_CLAVE, true)) {
    Serial.printf("MQTT: CONNECT rechazado (error %d, código %d: 4 o 5 = credencial o usuario)\n", static_cast<int>(mqtt.lastError()), static_cast<int>(mqtt.returnCode()));
    tls.stop();
    return false;
  }
  Serial.println("MQTT: conectado con TLS y la credencial del alta");
  return true;
}

static bool asegurarConexion() {
  if (mqtt.connected()) return true;
  if (millis() < proximoIntentoMs) return false;
  const bool ok = conectarWifi() && (horaPuesta() || (pedirHora(), true)) && conectarBroker();
  if (ok) { esperaReintentoMs = 5000; return true; }
  proximoIntentoMs = millis() + esperaReintentoMs;
  Serial.printf("reintento en %lu s\n", static_cast<unsigned long>(esperaReintentoMs / 1000));
  esperaReintentoMs = esperaReintentoMs < 60000 ? esperaReintentoMs * 2 : 60000;  // 5, 10, 20, 40, 60, 60…
  return false;
}

// Agrega texto al pack; devuelve false si no cabe (el pack se descarta entero: nunca un JSON cortado).
static bool agregar(char *pack, size_t &largo, const char *fmt, ...) {
  va_list args;
  va_start(args, fmt);
  const int n = vsnprintf(pack + largo, TAM_PACK - largo, fmt, args);
  va_end(args);
  if (n < 0 || largo + static_cast<size_t>(n) >= TAM_PACK) return false;
  largo += static_cast<size_t>(n);
  return true;
}

// Un registro por sensor que respondió; el primero lleva bn y, si hay hora, bt. Devuelve cuántos registros tiene.
static int armarPack(char *pack, size_t &largo) {
  int registros = 0;
  largo = 0;
  if (!agregar(pack, largo, "[")) return 0;
  auto registro = [&](const char *n, const char *u, const char *valorFmt, double v) {
    const size_t antes = largo;  // si el registro no cabe, el pack vuelve a como estaba (nunca un bn o un bt a medias)
    bool cabe = registros == 0
      ? agregar(pack, largo, "{\"bn\":\"%s\",", DISPOSITIVO_ID) && (!horaPuesta() || agregar(pack, largo, "\"bt\":%ld,", static_cast<long>(time(nullptr))))
      : agregar(pack, largo, ",{");
    char cuerpo[64];
    snprintf(cuerpo, sizeof(cuerpo), valorFmt, v);
    cabe = cabe && agregar(pack, largo, "\"n\":\"%s\",\"u\":\"%s\",\"v\":%s}", n, u, cuerpo);
    if (cabe) registros++; else largo = antes;
  };
  if (hayBme) {
    const float t = bme.readTemperature(), h = bme.readHumidity(), p = bme.readPressure() / 100.0F;
    if (isfinite(t) && isfinite(h) && isfinite(p)) {
      registro("temperatura", "Cel", "%.2f", t);
      registro("humedad", "%RH", "%.1f", h);
      registro("presion", "hPa", "%.2f", p);
    } else {
      Serial.print("aire: lectura inválida, omitida · ");
    }
  }
  sondas.requestTemperatures();
  const float tSuelo = sondas.getTempCByIndex(0);
  if (tSuelo != DEVICE_DISCONNECTED_C && tSuelo != DS18B20_ARRANQUE_C) registro("temperatura_suelo", "Cel", "%.2f", tSuelo);
  else Serial.print("sonda: sin lectura válida, omitida · ");
  uint32_t suma = 0;
  for (int i = 0; i < 16; i++) suma += analogReadMilliVolts(PIN_SUELO);
  const uint32_t mv = suma / 16;
  if (mv >= SUELO_MINIMO_MV) registro("humedad_suelo", "V", "%.3f", mv / 1000.0);  // en V, no mV (docs/10 §8.4 punto 51)
  else Serial.print("suelo: por debajo de 100 mV (sin alimentación o desconectado), omitido · ");
  if (WiFi.status() == WL_CONNECTED) registro("rssi", "dBm", "%.0f", static_cast<double>(WiFi.RSSI()));
  if (!agregar(pack, largo, "]")) return 0;
  return registros;
}

void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println("\n=== Nodo de prueba (fase 2): publica por MQTT sobre TLS ===");
  snprintf(topico, sizeof(topico), "sitio/%s/dispositivo/%s/temperatura", SITIO, DISPOSITIVO_ID);
  Serial.printf("dispositivo %s · tópico %s · cada %lu s · puerto %d\n", DISPOSITIVO_ID, topico, static_cast<unsigned long>(PERIODO_S), MQTT_PUERTO);
  Wire.begin(PIN_SDA, PIN_SCL);
  hayBme = bme.begin(0x76, &Wire) || bme.begin(0x77, &Wire);
  Serial.println(hayBme ? "aire: BME280 listo" : "aire: sin BME280 (se publica sin sus tres magnitudes)");
  sondas.begin();
  sondas.setWaitForConversion(true);
  Serial.printf("sonda: %u DS18B20\n", sondas.getDeviceCount());
  analogReadResolution(12);
  analogSetPinAttenuation(PIN_SUELO, ADC_11db);  // preciso de 150 a 2450 mV (docs/17 §6)
  tls.setCACert(CA_PEM);
  sntp_set_time_sync_notification_cb(alSincronizar);  // antes de configTime: así ninguna sincronización pasa sin aviso
  proximoCicloMs = millis();
}

void loop() {
  mqtt.loop();  // mantiene la sesión (keepalive) y atiende los acuses
  if (!asegurarConexion()) { delay(200); return; }
  if (static_cast<int32_t>(millis() - proximoCicloMs) < 0) { delay(50); return; }
  proximoCicloMs += PERIODO_S * 1000UL;
  // Tras un corte más largo que un periodo (Wi-Fi o broker caídos), los ciclos perdidos no se recuperan en ráfaga: se pierden, como
  // dice docs/17 §6.2 (sin cola), y el siguiente se agenda a un periodo desde ahora.
  if (static_cast<int32_t>(millis() - proximoCicloMs) >= 0) proximoCicloMs = millis() + PERIODO_S * 1000UL;
  ciclo++;
  static char pack[TAM_PACK];
  size_t largo = 0;
  const int registros = armarPack(pack, largo);
  if (registros == 0) { Serial.printf("ciclo %lu: ningún sensor respondió; no se publica\n", static_cast<unsigned long>(ciclo)); return; }
  const bool ok = mqtt.publish(topico, pack, false, 1);  // QoS 1: true solo tras el PUBACK del broker
  if (ok) publicados++; else fallidos++;
  Serial.printf("ciclo %lu · %d registro(s) · %u bytes · %s · %s\n%s\n", static_cast<unsigned long>(ciclo), registros, static_cast<unsigned>(largo),
                horaPuesta() ? "con bt" : "sin bt", ok ? "publicado (PUBACK)" : "FALLÓ la publicación (se reconecta)", pack);
  if (!ok) { mqtt.disconnect(); tls.stop(); }
}
