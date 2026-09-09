# Arranque de la Etapa 2 — martes 8 de septiembre de 2026

- **Contexto:** Etapa 1 entregada el 4/09. Sin retroalimentación aún del profesor guía; se avanza
  en el diseño (fase *Design* de PPDIOO) sin esperar.
- **Sesión de trabajo individual;** registro de decisiones, no de la jornada.

## 1. Decisiones tomadas

| # | Decisión | Por qué | Dónde queda |
|---|---|---|---|
| 1 | El navegador habla **solo con el backend** (patrón B); nunca con el broker | No exponer el broker a Internet ni poner credenciales MQTT en JavaScript; el pipeline es el único camino de los datos | `docs/07` §2 |
| 2 | Modelo de datos con **13 entidades**; la medición cuelga de un **canal** (dispositivo + magnitud), no del dispositivo | Un nodo mide varias magnitudes; el canal es la unidad real de una serie de tiempo y mapea 1:1 con el tópico MQTT | `docs/08` |
| 3 | Catálogo `magnitud` con unidad canónica y **rango físico** | Da al filtro 3 un criterio objetivo para enviar a cuarentena | `docs/08`, `01-esquema.sql` |
| 4 | **Docker (contenedores), no máquinas virtuales**; instalado por `apt`, no snap | Fracción del consumo de una VM; snap confina mal los *bind mounts* | `docs/09` §3 |
| 5 | Las pruebas de rendimiento corren en un **entorno acotado** (límites de Docker o VPS modesto), no en el equipo de desarrollo | El equipo de desarrollo no representa al servidor ni a la red del usuario final | `docs/09` §1 |
| 6 | Banco de comparación con ThingsBoard CE: **mismo hardware, mismo flujo, mismas métricas, protocolo escrito antes** de medir | Imparcialidad y reproducibilidad; se reportan también los resultados desfavorables | `docs/09` §2 |
| 7 | **ChirpStack comparte el servidor PostgreSQL** (base y rol propios) en vez de traer otro | ~100 MB menos de memoria (RNF-17) y un solo respaldo; Redis sí es propio | `docs/10` §6 |
| 8 | Imágenes con **versión exacta**, `no-new-privileges`, broker en `127.0.0.1` durante el desarrollo | Reproducibilidad; contención ante un servicio comprometido; nada de la red local alcanza el broker | `docker-compose.yml`, `docs/11` |
| 9 | Credenciales **generadas por `openssl rand`**, nunca elegidas a mano; las de prueba se eliminan antes de conectar dispositivos reales | Una clave elegida por una persona es adivinable | `docs/11` §7 |
| 10 | `passwd` del broker con dueño `mosquitto` (uid 1883) y permisos **0640** | Verificado empíricamente: con dueño root el broker no arranca; 0640 es lo más restrictivo que funciona y no lo lee ningún otro usuario | `docs/11` §7 |

## 2. Verificaciones realizadas en el despliegue local

- Esquema aplicado: 13 tablas, `medicion` es hypertable, 5 magnitudes.
- Broker: publicación anónima → rechazada; clave incorrecta → rechazada; publicación legítima →
  aceptada; **suplantación entre dispositivos → descartada por la ACL** (comprobado desde el receptor).
- Rotación completa de credenciales (base, sonda, backend, dispositivo de prueba): las claves
  anteriores dejan de funcionar; las nuevas funcionan; el healthcheck sigue sano.
- Consumo en reposo: TimescaleDB ≈ 31 MB, Mosquitto ≈ 3 MB.

## 3. Pendientes que deja la sesión

- [ ] Acordar con el compañero: tópico exacto, campos de su JSON, sensores y magnitudes, fecha de
      primeras tramas (necesario para el adaptador del filtro 2).
- [ ] Esqueleto del backend (NestJS): conexión a la base y al broker; filtro 1.
- [ ] Llevar los diagramas Mermaid de `docs/08` y `docs/10` a TikZ para el informe de la Etapa 2.
- [ ] Entrevistas con partes interesadas (brecha declarada en la Etapa 1).
