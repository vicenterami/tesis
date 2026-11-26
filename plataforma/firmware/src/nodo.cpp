// Fase 2 del nodo de prueba (TT-32; diseño en docs/17 §6.2, escrito antes que este código). Cada PERIODO_S lee el módulo de aire
// (BME280, I2C), la sonda de suelo (DS18B20, 1-Wire) y el sensor capacitivo de humedad de suelo (ADC) y publica UN pack SenML por
// MQTT sobre TLS con QoS 1, con la credencial del alta. La CA vive en include/secretos.h, que git ignora (plantilla:
// include/secretos.h.ejemplo). La red, el servidor, el sitio, el identificador y la credencial se cargan por USB desde el panel o con
// herramientas/cargar-equipo.py y quedan en la memoria no volátil (docs/17 §6.4; protocolo en include/protocolo.h); las macros de
// secretos.h, si existen, son los valores por omisión. Nunca imprime ni responde la clave del equipo ni la de la red, la MAC ni la IP.
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
#include <esp_task_wdt.h>
#include <math.h>
#include <string.h>
#include <Preferences.h>
#include <nvs_flash.h>
#include <esp_random.h>
#include "protocolo.h"
// Los secretos de esta placa: include/secretos.h, o el archivo que nombre el entorno (nodo-s3: secretos-s3.h, otra identidad).
#ifdef SECRETOS_ARCHIVO
#include SECRETOS_ARCHIVO
#else
#include "secretos.h"
#endif

// Pines de la NodeMCU ESP-32S (docs/17 §4.4) salvo que el entorno los defina (nodo-s3: en el ESP32-S3 no existen el 22 ni el 34).
#ifndef NODO_PIN_SDA
#define NODO_PIN_SDA 21
#endif
#ifndef NODO_PIN_SCL
#define NODO_PIN_SCL 22
#endif
#ifndef NODO_PIN_1WIRE
#define NODO_PIN_1WIRE 4
#endif
#ifndef NODO_PIN_SUELO
#define NODO_PIN_SUELO 34
#endif
static constexpr int PIN_SDA = NODO_PIN_SDA, PIN_SCL = NODO_PIN_SCL, PIN_1WIRE = NODO_PIN_1WIRE, PIN_SUELO = NODO_PIN_SUELO;
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
static constexpr uint32_t VIGIA_S = 120;             // watchdog de la tarea del loop: el doble del peor bloqueo de una vuelta
                                                     // (Wi-Fi 20 + NTP 10 + TLS 10 + 10 + MQTT 5 + 5 ≈ 60 s); un cuelgue reinicia el nodo
static constexpr size_t BUFER_SERIE = 1024;          // recepción: una orden (≤ 512 bytes) no se pierde durante el saludo TLS (hasta 10 s)
static constexpr uint32_t AVISO_SIN_CONFIG_MS = 30000;
static const char *FIRMWARE = "nodo";
static const char *FIRMWARE_VERSION = "2.1.0";       // 2.0.0: configuración por el puerto serie (docs/17 §6.4); 2.1.0: protocolo 2 (arranque)
#ifndef NTP_SERVIDOR
#define NTP_SERVIDOR "pool.ntp.org"
#endif

// La configuración vigente: la guardada (origen «memoria»), o la compilada si secretos.h trae las macros («compilado»), o ninguna.
static protocolo::Config cfg;
static bool configurado = false;
static const char *origen = "ninguno";
static Preferences preferencias;
static const char *ESPACIO_NVS = "plataforma", *CLAVE_NVS = "config", *CLAVE_ARRANQUES = "arranques";
// Lo que `estado` responde: qué pasó con la red y el broker en el último intento.
static const char *estadoWifi = "sin_conexion";
static const char *ultimoError = "ninguno";
// El número de este arranque (protocolo 2): cambia en cada inicio. Tras `configurar`, quien carga espera un `hola` con otro número: así
// nunca toma por buena la respuesta del equipo que todavía corre con lo anterior (corrección del 25/11/2026).
static uint32_t arranque = 0;

static WiFiClientSecure tls;
static MQTTClient mqtt(TAM_PACK);                    // el tope por defecto de la biblioteca (128) no alcanza para el pack
static OneWire bus(PIN_1WIRE);
static DallasTemperature sondas(&bus);
static Adafruit_BME280 bme;
static uint8_t bmeDir = 0;                           // 0x76 o 0x77 una vez iniciado; 0 = sin BME280 (se busca cada ciclo)
static uint8_t crudoAnterior[8];
static bool hayCrudoAnterior = false;
// Registros del BME280 (hoja de Bosch BST-BME280-DS001-24, §4 y §5): identificador, control de medición y datos crudos en ráfaga.
static constexpr uint8_t BME_ID = 0x60, BME_REG_ID = 0xD0, BME_REG_CTRL_HUM = 0xF2, BME_REG_CTRL_MEAS = 0xF4, BME_REG_DATOS = 0xF7;
static constexpr uint8_t BME_MODO_NORMAL = 0x03;     // mode[1:0] = 11; tras un reinicio del sensor vale 00 (reposo, sin medir)
static char topico[160];
static uint32_t ciclo = 0, publicados = 0, fallidos = 0;
static uint32_t proximoCicloMs = 0, proximoIntentoMs = 0, esperaReintentoMs = 5000;

// «Con hora» solo cuando SNTP avisó que sincronizó (su callback): el reloj del sistema puede sobrevivir a un reinicio por software sin
// volver a sincronizar, y «una fecha posterior a 2000» no bastaría para asegurar que la marca bt es real.
static volatile bool horaNtp = false;
static void alSincronizar(struct timeval *) { horaNtp = true; }
static bool horaPuesta() { return horaNtp && time(nullptr) >= HORA_MINIMA; }

static void atenderSerie();
// Las esperas de Wi-Fi y NTP siguen atendiendo la serie: una orden que llega mientras tanto no espera a la vuelta siguiente.
static void esperarAtendiendo(uint32_t ms) {
  const uint32_t inicio = millis();
  while (millis() - inicio < ms) { atenderSerie(); delay(20); }
}

static bool conectarWifi() {
  if (WiFi.status() == WL_CONNECTED) { estadoWifi = "conectado"; return true; }
  Serial.print("Wi-Fi: conectando");
  estadoWifi = "conectando";
  WiFi.mode(WIFI_STA);
  WiFi.begin(cfg.red, cfg.claveRed[0] != '\0' ? cfg.claveRed : nullptr);  // sin clave: red abierta
  const uint32_t inicio = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - inicio < ESPERA_WIFI_MS) { esperarAtendiendo(500); Serial.print('.'); }
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println(" sin conexión (¿nombre o clave de la red?)");
    estadoWifi = "sin_conexion";
    ultimoError = "wifi";
    return false;
  }
  Serial.printf(" conectado (señal %d dBm)\n", WiFi.RSSI());
  estadoWifi = "conectado";
  return true;
}

static void pedirHora() {
  configTime(0, 0, NTP_SERVIDOR);  // UTC; el núcleo sigue sincronizando en segundo plano
  const uint32_t inicio = millis();
  while (!horaPuesta() && millis() - inicio < ESPERA_NTP_MS) esperarAtendiendo(200);
  Serial.println(horaPuesta() ? "NTP: hora puesta (los packs llevarán bt)" : "NTP: sin hora todavía (los packs irán sin bt: el backend usa la hora de recepción)");
}

// TLS a la IP del proxy verificando el nombre «proxy» del certificado con la CA propia; después, MQTT sobre esa misma conexión
// (skip = true: la biblioteca no abre otra). Por qué el nombre y no la IP: docs/17 §6.2.
static bool conectarBroker() {
  IPAddress ip;
  if (!ip.fromString(cfg.servidor) && WiFi.hostByName(cfg.servidor, ip) != 1) {
    Serial.println("MQTT: no se resolvió la dirección del proxy");
    ultimoError = "dns";
    return false;
  }
  tls.stop();
  tls.setTimeout(10);           // segundos para el socket (el constructor pone 30 s)
  tls.setHandshakeTimeout(10);  // segundos para el saludo TLS (el constructor pone 120 s): un servidor que acepta TCP y calla no bloquea 2 min
  if (!tls.connect(ip, cfg.puerto, NOMBRE_DEL_SERVIDOR, CA_PEM, nullptr, nullptr)) {
    char detalle[96];
    tls.lastError(detalle, sizeof(detalle));
    Serial.printf("TLS: falló (%s)\n", detalle);
    ultimoError = "tls";
    return false;
  }
  mqtt.begin(ip, cfg.puerto, tls);
  mqtt.setOptions(MQTT_KEEPALIVE_S, true, MQTT_TIMEOUT_MS);
  if (!mqtt.connect(cfg.id, cfg.id, cfg.clave, true)) {
    const int codigo = static_cast<int>(mqtt.returnCode());
    Serial.printf("MQTT: CONNECT rechazado (error %d, código %d: 4 o 5 = credencial o usuario)\n", static_cast<int>(mqtt.lastError()), codigo);
    // lwmqtt: 4 = usuario o clave incorrectos, 5 = no autorizado (MQTT 3.1.1, §3.2.2.3)
    ultimoError = codigo == 4 || codigo == 5 ? "credencial" : "broker";
    tls.stop();
    return false;
  }
  Serial.println("MQTT: conectado con TLS y la credencial del alta");
  ultimoError = "ninguno";
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

// Lectura directa por I2C, con resultado: la biblioteca no informa errores de bus (con el bus caído devuelve números finitos y falsos).
static bool leerRegistros(uint8_t dir, uint8_t reg, uint8_t *buf, uint8_t n) {
  Wire.beginTransmission(dir);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(dir, n) != n) return false;
  for (uint8_t i = 0; i < n; i++) buf[i] = Wire.read();
  return true;
}

static bool responde(uint8_t dir) {
  uint8_t id = 0;
  return leerRegistros(dir, BME_REG_ID, &id, 1) && id == BME_ID;
}

// begin() solo para el sensor que nunca se inició, y solo tras ver su identificador: su espera de calibración no tiene tope y no
// termina si el bus cae a mitad de camino (docs/17 §6.2). Un sensor ya iniciado se reconfigura con setSampling(), sin esperas.
static bool iniciarBme() {
  for (const uint8_t dir : {static_cast<uint8_t>(0x76), static_cast<uint8_t>(0x77)}) {
    if (responde(dir) && bme.begin(dir, &Wire)) { bmeDir = dir; hayCrudoAnterior = false; return true; }
  }
  return false;
}

static void reconfigurarBme() {
  bme.setSampling();  // los valores por defecto de begin(): modo normal, ×16, sin filtro
  hayCrudoAnterior = false;
}

// Las tres magnitudes del aire, o false (con el motivo por serie) si el sensor no responde, perdió la configuración o está congelado.
static bool leerAire(float &t, float &h, float &p) {
  if (!bmeDir && !iniciarBme()) { Serial.print("aire: sin BME280, omitido · "); return false; }
  uint8_t ctrl = 0, crudo[sizeof(crudoAnterior)];
  if (!responde(bmeDir)) { Serial.print("aire: el BME280 no responde por I2C, omitido · "); return false; }
  if (!leerRegistros(bmeDir, BME_REG_CTRL_MEAS, &ctrl, 1) || !leerRegistros(bmeDir, BME_REG_DATOS, crudo, sizeof(crudo))) {
    Serial.print("aire: falló la lectura I2C del BME280, omitido · ");
    return false;
  }
  if ((ctrl & 0x03) != BME_MODO_NORMAL) {
    Serial.printf("aire: el BME280 perdió su configuración (ctrl_meas 0x%02X), se reconfigura y se omite · ", ctrl);
    reconfigurarBme();
    return false;
  }
  if (hayCrudoAnterior && memcmp(crudo, crudoAnterior, sizeof(crudo)) == 0) {
    Serial.print("aire: bytes crudos iguales a los del ciclo anterior (sensor congelado), se reconfigura y se omite · ");
    reconfigurarBme();
    return false;
  }
  memcpy(crudoAnterior, crudo, sizeof(crudo));
  hayCrudoAnterior = true;
  t = bme.readTemperature();
  h = bme.readHumidity();
  p = bme.readPressure() / 100.0F;
  if (!responde(bmeDir)) { Serial.print("aire: el bus I2C falló durante la lectura, omitido · "); return false; }
  if (!(isfinite(t) && isfinite(h) && isfinite(p))) { Serial.print("aire: lectura inválida, omitida · "); return false; }
  return true;
}

// Al arrancar, antes de iniciarlo: cómo quedó el sensor (un reinicio del ESP32 no reinicia el BME280, que sigue alimentado).
static void informarBmePrevio() {
  for (const uint8_t dir : {static_cast<uint8_t>(0x76), static_cast<uint8_t>(0x77)}) {
    uint8_t id = 0, ctrl[4] = {0};
    if (!leerRegistros(dir, BME_REG_ID, &id, 1)) continue;
    const bool hay = leerRegistros(dir, BME_REG_CTRL_HUM, ctrl, sizeof(ctrl));
    Serial.printf("aire: antes de iniciar, 0x%02X responde id=0x%02X", dir, id);
    if (hay) Serial.printf(" ctrl_hum=0x%02X status=0x%02X ctrl_meas=0x%02X config=0x%02X", ctrl[0], ctrl[1], ctrl[2], ctrl[3]);
    Serial.println();
  }
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
      ? agregar(pack, largo, "{\"bn\":\"%s\",", cfg.id) && (!horaPuesta() || agregar(pack, largo, "\"bt\":%ld,", static_cast<long>(time(nullptr))))
      : agregar(pack, largo, ",{");
    char cuerpo[64];
    snprintf(cuerpo, sizeof(cuerpo), valorFmt, v);
    cabe = cabe && agregar(pack, largo, "\"n\":\"%s\",\"u\":\"%s\",\"v\":%s}", n, u, cuerpo);
    if (cabe) registros++; else largo = antes;
  };
  float t, h, p;
  if (leerAire(t, h, p)) {
    registro("temperatura", "Cel", "%.2f", t);
    registro("humedad", "%RH", "%.1f", h);
    registro("presion", "hPa", "%.2f", p);
  }
  sondas.requestTemperatures();
  const float tSuelo = sondas.getTempCByIndex(0);
  if (tSuelo != DEVICE_DISCONNECTED_C && tSuelo != DS18B20_ARRANQUE_C) registro("temperatura_suelo", "Cel", "%.2f", tSuelo);
  else Serial.print("sonda: sin lectura válida, omitida · ");
#ifdef SIN_SUELO  // placa sin el sensor de suelo cableado (nodo-s3): un pin al aire daría milivoltios al azar, no una medición
  Serial.print("suelo: sin sensor en esta placa, omitido · ");
#else
  uint32_t suma = 0;
  for (int i = 0; i < 16; i++) suma += analogReadMilliVolts(PIN_SUELO);
  const uint32_t mv = suma / 16;
  if (mv >= SUELO_MINIMO_MV) registro("humedad_suelo", "V", "%.3f", mv / 1000.0);  // en V, no mV (docs/10 §8.4 punto 51)
  else Serial.print("suelo: por debajo de 100 mV (sin alimentación o desconectado), omitido · ");
#endif
  if (WiFi.status() == WL_CONNECTED) registro("rssi", "dBm", "%.0f", static_cast<double>(WiFi.RSSI()));
  if (!agregar(pack, largo, "]")) return 0;
  return registros;
}

// ── Configuración y puerto serie (docs/17 §6.4; protocolo en include/protocolo.h y docs/19 §4, bloque Z) ────────────────────────────
// Los valores compilados, si secretos.h trae las macros: lo que funcionaba antes de la carga por USB sigue funcionando igual.
static void cargarCompilada() {
#if defined(WIFI_SSID) && defined(MQTT_HOST) && defined(SITIO) && defined(DISPOSITIVO_ID) && defined(DISPOSITIVO_CLAVE)
#ifndef WIFI_CLAVE
#define WIFI_CLAVE ""
#endif
#ifndef MQTT_PUERTO
#define MQTT_PUERTO 8883
#endif
  cfg.version = protocolo::VERSION_REGISTRO;
  cfg.puerto = MQTT_PUERTO;
  snprintf(cfg.red, sizeof(cfg.red), "%s", WIFI_SSID);
  snprintf(cfg.claveRed, sizeof(cfg.claveRed), "%s", WIFI_CLAVE);
  snprintf(cfg.servidor, sizeof(cfg.servidor), "%s", MQTT_HOST);
  snprintf(cfg.sitio, sizeof(cfg.sitio), "%s", SITIO);
  snprintf(cfg.id, sizeof(cfg.id), "%s", DISPOSITIVO_ID);
  snprintf(cfg.clave, sizeof(cfg.clave), "%s", DISPOSITIVO_CLAVE);
  configurado = true;
  origen = "compilado";
#endif
}

// La guardada manda sobre la compilada; un registro de otro tamaño o de otra versión no se usa (se trata como si no hubiera).
static void cargarConfig() {
  memset(&cfg, 0, sizeof(cfg));
  configurado = false;
  origen = "ninguno";
  preferencias.begin(ESPACIO_NVS, false);
  // Contador de arranques en la NVS; si no se pudo guardar, un número al azar (lo que importa es que no repita el anterior).
  arranque = preferencias.getUInt(CLAVE_ARRANQUES, 0) + 1;
  if (preferencias.putUInt(CLAVE_ARRANQUES, arranque) != sizeof(uint32_t)) arranque = esp_random() | 0x80000000u;
  if (preferencias.getBytesLength(CLAVE_NVS) == sizeof(protocolo::Config)) {
    protocolo::Config leida;
    const bool ok = preferencias.getBytes(CLAVE_NVS, &leida, sizeof(leida)) == sizeof(leida) && leida.version == protocolo::VERSION_REGISTRO;
    if (ok) {
      cfg = leida;
      cfg.red[sizeof(cfg.red) - 1] = cfg.claveRed[sizeof(cfg.claveRed) - 1] = cfg.servidor[sizeof(cfg.servidor) - 1] = '\0';
      cfg.sitio[sizeof(cfg.sitio) - 1] = cfg.id[sizeof(cfg.id) - 1] = cfg.clave[sizeof(cfg.clave) - 1] = '\0';
      configurado = true;
      origen = "memoria";
    }
    protocolo::borrarSeguro(&leida, sizeof(leida));
    if (ok) return;
  }
  cargarCompilada();
}

// Una respuesta: una línea con el prefijo, para que el panel y el guion la separen del registro normal.
static void responder(const char *json) {
  Serial.print(protocolo::PREFIJO);
  Serial.println(json);
}
static void responderError(const char *orden, const char *error, const char *campo = nullptr) {
  char o[40], r[160];
  protocolo::textoJson(o, sizeof(o), orden);
  if (campo != nullptr) snprintf(r, sizeof(r), "{\"ok\":false,\"orden\":%s,\"error\":\"%s\",\"campo\":\"%s\"}", o, error, campo);
  else snprintf(r, sizeof(r), "{\"ok\":false,\"orden\":%s,\"error\":\"%s\"}", o, error);
  responder(r);
}
// Tras aceptar `configurar` o `borrar`: no se atiende ninguna orden más. Se vacía la salida (la respuesta sale por el cable) y se reinicia
// en el acto, sin volver al loop (antes, 300 ms después desde el loop: en ese lapso el equipo seguía contestando `hola` y `estado` con la
// configuración vieja, y quien cargaba podía tomarlos por la nueva).
static void reiniciarYa(protocolo::Orden &o) {
  protocolo::borrarSeguro(&o, sizeof(o));
  Serial.println("reinicio: arranca con la configuración nueva");
  Serial.flush();
  delay(20);
  ESP.restart();
}

static void procesarLinea(char *linea, size_t n) {
  protocolo::Orden o;
  const protocolo::Lectura lectura = protocolo::leerOrden(linea, n, o);
  protocolo::borrarSeguro(linea, n);  // pudo traer la clave del equipo o la de la red
  if (lectura != protocolo::Lectura::ok) { responderError("", lectura == protocolo::Lectura::larga ? "larga" : "json"); return; }
  char r[320];
  if (strcmp(o.orden, "hola") == 0) {
    char id[80] = "";
    if (configurado) { char t[72]; protocolo::textoJson(t, sizeof(t), cfg.id); snprintf(id, sizeof(id), ",\"id\":%s", t); }
    snprintf(r, sizeof(r), "{\"ok\":true,\"orden\":\"hola\",\"firmware\":\"%s\",\"version\":\"%s\",\"protocolo\":%d,\"arranque\":%lu,\"configurado\":%s,\"origen\":\"%s\"%s}",
             FIRMWARE, FIRMWARE_VERSION, protocolo::VERSION_PROTOCOLO, static_cast<unsigned long>(arranque), configurado ? "true" : "false", origen, id);
    responder(r);
  } else if (strcmp(o.orden, "estado") == 0) {
    const char *wifi = !configurado ? "sin_configurar" : WiFi.status() == WL_CONNECTED ? "conectado" : estadoWifi;
    snprintf(r, sizeof(r), "{\"ok\":true,\"orden\":\"estado\",\"configurado\":%s,\"wifi\":\"%s\",\"broker\":\"%s\",\"ultimo_error\":\"%s\",\"publicados\":%lu,\"fallidos\":%lu}",
             configurado ? "true" : "false", wifi, configurado && mqtt.connected() ? "conectado" : "desconectado", ultimoError,
             static_cast<unsigned long>(publicados), static_cast<unsigned long>(fallidos));
    responder(r);
  } else if (strcmp(o.orden, "configurar") == 0) {
    const char *campo = protocolo::campoInvalido(o);
    if (campo != nullptr) {
      responderError("configurar", "campo", campo);
    } else {
      protocolo::Config nueva;
      protocolo::aConfig(o, nueva);
      const size_t escritos = preferencias.putBytes(CLAVE_NVS, &nueva, sizeof(nueva));  // un solo valor: todo o nada
      protocolo::borrarSeguro(&nueva, sizeof(nueva));
      if (escritos != sizeof(nueva)) {
        responderError("configurar", "guardar");
      } else {
        Serial.printf("configuración guardada para %s; se reinicia\n", o.id);
        responder("{\"ok\":true,\"orden\":\"configurar\",\"reinicia\":true}");
        reiniciarYa(o);
      }
    }
  } else if (strcmp(o.orden, "borrar") == 0) {
    // Borra la PARTICIÓN de datos entera: `remove` solo marca la entrada como borrada y los bytes quedarían en la flash (ESP-IDF, NVS:
    // «the old key-value pair is marked as erased»); nvs_flash_erase_partition «Erase all content of a specified NVS partition». Se
    // pierden también lo que guarda el núcleo (calibración de radio, que rehace al arrancar); el contador de arranques se vuelve a escribir (abajo).
    // Corrección del 25/11/2026: borrar desinicializa la partición («the partition has to be initialized again to be used», nvs_flash.h de
    // ESP-IDF 4.4.7, el del núcleo Arduino 2.0.17 de espressif32@7.1.3), así que se reinicializa antes de volver a abrirla, haya salido bien
    // o mal; y el contador de arranques se vuelve a escribir: sin él, dos `borrar` seguidos arrancaban los dos con el número 1 y quien carga
    // no distinguía el arranque nuevo del anterior.
    preferencias.end();
    const bool borrada = nvs_flash_erase_partition("nvs") == ESP_OK;
    nvs_flash_init_partition("nvs");
    const bool abierta = preferencias.begin(ESPACIO_NVS, false);
    if (borrada && abierta) preferencias.putUInt(CLAVE_ARRANQUES, arranque);
    Serial.println(borrada ? "memoria no volátil borrada entera; se reinicia" : "no se pudo borrar la memoria no volátil");
    if (!borrada) { responderError("borrar", "guardar"); }
    else { responder("{\"ok\":true,\"orden\":\"borrar\",\"reinicia\":true}"); reiniciarYa(o); }
  } else {
    responderError(o.orden, "orden");
  }
  protocolo::borrarSeguro(&o, sizeof(o));
}

// Sin bloquear: toma lo que ya llegó y procesa cada línea completa. Una línea de más de 512 bytes se descarta entera y responde «larga»;
// una a medias que se queda 2 s sin bytes (el cable se desconectó en medio de `configurar`) se borra sin responder (protocolo::Armador).
static protocolo::Armador armador = {};
static void atenderSerie() {
  // Solo vence si no hay bytes esperando: tras un saludo TLS que bloqueó 10 s, lo que espera en el búfer es el resto de esa misma línea.
  if (Serial.available() == 0 && armador.vencer(millis())) Serial.println("serie: una orden quedó a medias y se descartó");
  for (int disponibles = Serial.available(); disponibles > 0; disponibles--) {
    const int c = Serial.read();
    if (c < 0) break;
    const protocolo::Armador::Evento e = armador.poner(static_cast<unsigned char>(c), millis());
    if (e == protocolo::Armador::Evento::larga) responderError("", "larga");
    else if (e == protocolo::Armador::Evento::linea) { procesarLinea(armador.linea, armador.largo); armador.descartar(); }
  }
}

void setup() {
  Serial.setRxBufferSize(BUFER_SERIE);  // antes de begin: después no cambia
  Serial.begin(115200);
  delay(1500);
  // Antes de tocar el BME280: si begin() se cuelga (docs/17 §6.2), el watchdog reinicia. Con el watchdog ya iniciado por el núcleo,
  // esp_task_wdt_init solo cambia su tope (IDF 4.4, esp_task_wdt.h); el núcleo no vigila la tarea del loop, así que se suma aquí.
  esp_task_wdt_init(VIGIA_S, true);
  esp_task_wdt_add(nullptr);
  Serial.printf("\n=== Nodo de prueba (fase 2, firmware %s %s): publica por MQTT sobre TLS ===\n", FIRMWARE, FIRMWARE_VERSION);
  cargarConfig();
  if (configurado) {
    snprintf(topico, sizeof(topico), "sitio/%s/dispositivo/%s/temperatura", cfg.sitio, cfg.id);
    Serial.printf("dispositivo %s · tópico %s · cada %lu s · puerto %u · configuración: %s\n", cfg.id, topico, static_cast<unsigned long>(PERIODO_S),
                  static_cast<unsigned>(cfg.puerto), origen);
  } else {
    Serial.println("sin configurar: cárgalo desde el panel («Cargar en el equipo») o con herramientas/cargar-equipo.py");
  }
  Wire.begin(PIN_SDA, PIN_SCL);
  informarBmePrevio();
  Serial.println(iniciarBme() ? "aire: BME280 listo" : "aire: sin BME280 (se publica sin sus tres magnitudes y se busca cada ciclo)");
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
  esp_task_wdt_reset();
  atenderSerie();
  if (!configurado) {  // sin red ni credencial no hay nada que intentar: solo la serie, y el aviso cada 30 s
    static uint32_t ultimoAvisoMs = millis();
    if (millis() - ultimoAvisoMs >= AVISO_SIN_CONFIG_MS) {
      ultimoAvisoMs = millis();
      Serial.println("sin configurar: cárgalo desde el panel («Cargar en el equipo») o con herramientas/cargar-equipo.py");
    }
    delay(20);
    return;
  }
  mqtt.loop();  // mantiene la sesión (keepalive) y atiende los acuses
  if (!asegurarConexion()) { esperarAtendiendo(200); return; }
  if (static_cast<int32_t>(millis() - proximoCicloMs) < 0) { delay(50); return; }
  proximoCicloMs += PERIODO_S * 1000UL;
  // Tras un corte más largo que un periodo (Wi-Fi o broker caídos), los ciclos perdidos no se recuperan en ráfaga: se pierden, como
  // dice docs/17 §6.2 (sin cola), y el siguiente se agenda a un periodo desde ahora.
  if (static_cast<int32_t>(millis() - proximoCicloMs) >= 0) proximoCicloMs = millis() + PERIODO_S * 1000UL;
  ciclo++;
#ifdef PRUEBA_VIGIA  // solo en el entorno nodo-prueba-vigia (platformio.ini): cuelga la vuelta para ver actuar al watchdog
  if (ciclo == 2) { Serial.printf("PRUEBA_VIGIA: el loop se cuelga a propósito; el watchdog debe reiniciar en %lu s\n", static_cast<unsigned long>(VIGIA_S)); for (;;) delay(1000); }
#endif
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
