# Firmware del nodo de prueba (ESP32)

Nodo propio para probar el sistema con hardware real (TT-32): ESP32 con BME280 (aire), DS18B20 (temperatura del suelo) y un sensor
capacitivo de humedad de suelo. Piezas, seguridad y pines: `docs/17`. Diseño por fases: `docs/17 §6`.

| Entorno | Qué hace | Estado |
|---|---|---|
| `diagnostico` | Fase 1: identifica el módulo de aire (registro `0xD0`), lee la sonda y el suelo por el puerto serie, sin Wi-Fi | Listo |
| (fase 2) | Wi-Fi, TLS con la CA propia, MQTT y SenML hacia la plataforma | Por diseñar en `docs/17 §6` |

Requiere PlatformIO Core 6.2.0; las versiones de la plataforma y de cada biblioteca están fijadas en `platformio.ini`.

```
pio run -e diagnostico -t upload && pio device monitor
```

Los datos de la red Wi-Fi y la credencial del dispositivo (fase 2) irán en `include/secretos.h`, que git ignora.
