# Auditoría del guardián de concordancia — 27 de septiembre de 2026

- **Sesión de trabajo individual;** pregunta de partida: ¿el guardián detecta de verdad lo que dice
  detectar, o solo sale en verde?

## 1. Método
Una violación por paso, plantada de a una y revertida con respaldo y `cmp` (byte a byte). Las que
exigen un servicio caído se simularon con una copia del script apuntando a un servicio inexistente, sin
detener nada real.

## 2. Resultado antes de corregir: 12 violaciones, 4 pasaban en verde

| Violación plantada | Antes | Después |
|---|---|---|
| Base de datos inalcanzable | **verde** (pasos 1, 2 y 2b buscaban «FALLA» en una salida vacía; 2b imprimía «dice  entidades») | falla en 1, 2 y 2b |
| Backend apagado | **«TODO EN CONCORDANCIA»** con la API sin probar | «incompleto», salida 2 |
| Migración 08 nueva sin aplicar | solo la detectaba el conteo en prosa (2g) | además, el paso 2 exige una comprobación por migración |
| Variable leída con otro nombre de objeto o comillas dobles | **verde** | falla en 2d |
| Término vetado, mención prohibida, número de entidades, ruta inexistente, ER alterado, conteo de migraciones, orden de filtros, nombre vetado | fallaban | siguen fallando |

Tras corregir: las 14 violaciones (dos nuevas) fallan donde deben; la línea base sigue en verde con 57
comprobaciones. Se agregó la comprobación de la migración 01 (`medicion` es hypertable), que no tenía.

## 3. Hallazgos laterales, corregidos en la documentación
- **Cola del broker:** Mosquitto guarda 1000 mensajes por cliente por defecto y descarta en silencio los
  siguientes. `docs/10` decía «nada se pierde»; ahora da el número (~83 min con la demo) y deja el ajuste
  como pendiente.
- **Disparadores:** son diez, no nueve: se suma `sitio_zona_horaria_valida`. La compresión no es un
  disparador sino un trabajo del planificador de TimescaleDB, cada 12 h.
- **Telemetría de TimescaleDB:** un trabajo diario envía estadísticas de uso al fabricante. Queda como
  decisión en `docs/11 §4`.
- **Proxy:** tres lugares daban Caddy por decidido (figura de despliegue, costos, seguridad); la decisión
  sigue abierta en `docs/10 §8`, y la comparación irá al anexo C.

## 4. Cierre: las figuras contra lo aprendido en el día
Revisadas las seis figuras renderizadas (contenedores, red, despliegue, alta, pipeline, tiempo real)
contra el código y el contrato. Coherentes con el estado real: ningún proxy dado por decidido; WebSocket
como opción por defecto, declarada así en `docs/10 §5`. Dos ajustes en la fuente (`docs/10`):
- Tiempo real: la ruta del histórico mostraba `?bucket=15m`; el parámetro real es `intervalo` y `desde`
  es ISO 8601. El guardián compara rutas, no parámetros: se vio leyendo la figura.
- Alta: `POST /dispositivos` es de la Etapa 3 y la figura no lo decía; ahora lo dice, y el guardián 2h
  revisa también las rutas dentro de las figuras (antes, solo la prosa).
