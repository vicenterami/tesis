// Fase 1 del nodo de prueba (TT-32; docs/17 §6): ¿cada sensor responde y entrega valores creíbles? Solo puerto serie, sin Wi-Fi:
// si algo falla aquí es el sensor o su cableado, nunca la red. Pines de docs/17 §4.4: I2C en GPIO21/22, 1-Wire en GPIO4 (con 4,7 kΩ
// a 3V3), suelo en GPIO34 (ADC1, solo entrada). No imprime identificadores de hardware (la dirección ROM de la sonda es única, como
// una MAC): solo cuántas hay.
#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_BME280.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <WiFi.h>
#include <math.h>

static constexpr int PIN_SDA = 21;
static constexpr int PIN_SCL = 22;
static constexpr int PIN_1WIRE = 4;
static constexpr int PIN_SUELO = 34;
static constexpr uint8_t REG_ID = 0xD0;  // registro de identificación del chip: 0x60 BME280, 0x58 BMP280 (hojas de datos de Bosch)
// Rango efectivo del ADC con la atenuación máxima: 150 a 2450 mV, ±60 mV; por encima, la precisión empeora (ESP32 Series Datasheet
// v5.3, tabla de características del ADC). El sensor de suelo de referencia entrega de 0 a 3,0 V: si al aire supera 2450 mV, se avisa.
static constexpr uint32_t ADC_MAX_PRECISO_MV = 2450;
// Valor que el DS18B20 tiene al encender, antes de su primera conversión (hoja de Maxim, tabla de temperatura: 0550h = +85 °C).
static constexpr float DS18B20_ARRANQUE_C = 85.0F;

static OneWire bus(PIN_1WIRE);
static DallasTemperature sondas(&bus);
static Adafruit_BME280 bme;
static bool hayBme = false;
static const char *aireSinBme = "sin sensor de aire";  // cambia a «BMP280 (no mide humedad)» si se detecta uno

// Lee un registro de un dispositivo I2C; -1 si no responde.
static int leerRegistro(uint8_t dir, uint8_t reg) {
  Wire.beginTransmission(dir);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return -1;
  if (Wire.requestFrom(dir, static_cast<uint8_t>(1)) != 1) return -1;
  return Wire.read();
}

static void revisarI2c() {
  Serial.println("— I2C (SDA 21, SCL 22): barrido de direcciones");
  int encontrados = 0;
  for (uint8_t dir = 0x03; dir <= 0x77; dir++) {
    Wire.beginTransmission(dir);
    if (Wire.endTransmission() == 0) {
      encontrados++;
      Serial.printf("  responde 0x%02X\n", dir);
      if (dir == 0x76 || dir == 0x77) {
        const int id = leerRegistro(dir, REG_ID);
        if (id == 0x60) {
          Serial.printf("  0x%02X: registro 0xD0 = 0x60 → BME280 (mide presión, temperatura y humedad)\n", dir);
          hayBme = bme.begin(dir, &Wire);
          if (!hayBme) Serial.println("  FALLA la biblioteca no pudo iniciar el BME280");
        } else if (id == 0x58) {
          Serial.printf("  0x%02X: registro 0xD0 = 0x58 → BMP280 (NO mide humedad)\n", dir);
          aireSinBme = "BMP280 (no mide humedad; este diagnóstico solo lee el BME280)";
        } else {
          Serial.printf("  0x%02X: registro 0xD0 = 0x%02X → no es BME280 ni BMP280\n", dir, id);
        }
      }
    }
  }
  if (encontrados == 0) Serial.println("  FALLA nadie responde: revisar 3V3, GND, SDA y SCL (con el USB desconectado)");
}

void setup() {
  Serial.begin(115200);
  delay(1500);  // tiempo para abrir el monitor después de grabar
  WiFi.mode(WIFI_OFF);
  Serial.println("\n=== Diagnóstico de sensores (fase 1) ===");
  Wire.begin(PIN_SDA, PIN_SCL);
  revisarI2c();
  sondas.begin();
  sondas.setWaitForConversion(true);  // explícito: cada lectura espera su conversión (hasta 750 ms a 12 bits, hoja de Maxim)
  const uint8_t n = sondas.getDeviceCount();
  Serial.printf("— 1-Wire (GPIO4): %u sonda(s) DS18B20%s\n", n, n > 1 ? " (se lee solo la primera del bus)" : "");
  analogReadResolution(12);
  analogSetPinAttenuation(PIN_SUELO, ADC_11db);  // la atenuación de mayor rango; preciso hasta 2450 mV (ver ADC_MAX_PRECISO_MV)
  Serial.println("— Lecturas cada ~3 s: 2 s de pausa más la conversión de la sonda (suelo: anotar el valor al aire y con la punta en agua)");
}

void loop() {
  if (hayBme) {
    const float t = bme.readTemperature(), h = bme.readHumidity(), p = bme.readPressure() / 100.0F;
    if (isfinite(t) && isfinite(h) && isfinite(p)) Serial.printf("aire: %.2f °C · %.2f %%HR · %.2f hPa", t, h, p);
    else Serial.print("aire: lectura inválida (¿se soltó un cable del módulo?)");
  } else {
    Serial.printf("aire: %s", aireSinBme);
  }
  sondas.requestTemperatures();
  const float tSuelo = sondas.getTempCByIndex(0);
  if (tSuelo == DEVICE_DISCONNECTED_C) Serial.print(" | suelo: sin lectura válida (sonda ausente o error de CRC: ¿falta la resistencia de 4,7 kΩ a 3V3?)");
  else if (tSuelo == DS18B20_ARRANQUE_C) Serial.print(" | suelo: 85,00 °C: o el valor de arranque, sin conversión (¿alimentación débil?), o de verdad 85 °C");
  else Serial.printf(" | suelo: %.2f °C", tSuelo);
  uint32_t suma = 0;
  for (int i = 0; i < 16; i++) suma += analogReadMilliVolts(PIN_SUELO);
  const uint32_t mv = suma / 16;
  Serial.printf(" | humedad de suelo: %lu mV%s\n", static_cast<unsigned long>(mv), mv > ADC_MAX_PRECISO_MV ? " (sobre 2450 mV: fuera del rango preciso del ADC)" : "");
  delay(2000);
}
