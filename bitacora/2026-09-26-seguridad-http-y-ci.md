# Revisión de seguridad HTTP, CORS y CI contra el código real — 26 de septiembre de 2026

- **Sesión de trabajo individual;** registro de lo medido y de la propuesta. Lo que se adopta se
  decide después de esta bitácora, y primero en `docs/11` y `docs/10`, recién después en el código
  (regla de concordancia).

## 1. Qué se hizo

Se aplicó al backend local una guía propia de revisión de seguridad HTTP de solo lectura
(cabeceras, versiones expuestas, CORS, acceso sin sesión, *source maps*), escrita fuera de este
proyecto, y se contrastaron sus otros temas —CSP y WebSocket, sesión y matriz de acceso, Redis y
colas, referencias dentro de JSON, runtime de las acciones del CI, escenarios de prueba listos—
contra `main.ts`, las dependencias, `docs/10 §6`, `docs/11` y el flujo de CI. Todo lo afirmado
abajo se midió con `curl` contra `127.0.0.1:3000` o se leyó en el archivo; lo que es conocimiento
general se marca como tal.

## 2. Lo medido

| Revisión | Resultado en el backend de hoy | Lectura |
|---|---|---|
| Cabeceras de seguridad (HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy) | **0 de 6** en `/`, `/docs` y `/dispositivos` | Esperado: no hay `helmet` ni proxy todavía. HSTS solo tiene sentido detrás de TLS |
| Versión expuesta | `X-Powered-By: Express` en todas las rutas | Revela la pila. Una línea lo quita |
| Acceso sin sesión a `/dispositivos` | **200** con el inventario (nombres de sitio y zona) | Coherente con el diseño: la API de consulta es de solo lectura y **M7 (sesión y roles) es de la Etapa 4**. Pero es una brecha declarada que hoy **no aparece** en la lista de despliegue de `docs/11 §8`: no se puede publicar 443 hacia la API mientras no exija credencial |
| CORS | Sin `Access-Control-Allow-Origin` para ningún origen | Seguro por omisión: un navegador en otro origen no puede leer la API. Como el panel lo servirá el propio backend (mismo origen, `docs/10 §6`), en producción **no hace falta CORS**; en desarrollo (Vite en otro puerto) sí, con lista blanca |
| Cuerpo ante un origen ajeno | 200 con los datos, sin rastro de pila ni SQL | No filtra internos; el 200 es la ausencia de sesión, no un problema de CORS |
| *Source maps* y *service worker* | No hay *front* aún | Aplicará al panel (Vite genera `.map`: no publicarlos) |
| `/docs` (Swagger UI) | Tres `<script>` de mismo origen y **tres bloques en línea** | Una CSP estricta rompe `/docs`. Decidir si `/docs` se sirve en producción: el contrato ya está versionado en el repositorio |
| Referencias dentro de JSON sin clave foránea | `evento.detalle` guarda solo valores (`valor`, `unidad`, `silencio_s`, `tipo`); ningún id de otra tabla | No aplica hoy. La regla ya existe en `docs/08 §6` («JSON solo para fotos, nunca datos de dominio consultables») |
| Redis | El backend no usa Redis; solo ChirpStack trae el suyo | La regla `noeviction` ya es el pendiente de ChirpStack. Si algún día un limitador de tasa o una sesión fuera a Redis, esa regla aplica; mientras tanto, evitar Redis en el backend |
| Escenarios de prueba listos | Los datos de prueba (`dev-0001`, sitio, zona, canal, regla) son `INSERT` manuales en el README del backend | No hay semilla con el resultado esperado en la cabecera ni foto (`pg_dump`) restaurable. Cada ensayo se arma a mano |

## 3. CI, por lo que dice GitHub (no por lo que uno cree)

- La última corrida (commit `f852b06`, 23/09) terminó en verde **con una anotación**: «Node.js 20 is
  deprecated. The following actions target Node.js 20 but are being forced to run on Node.js 24:
  pnpm/action-setup@v4». Leída por la API de GitHub (`check-runs` → `annotations`).
- Runtime que declara cada acción en su `action.yml`, leído en el tag: `actions/checkout@v5` →
  node24; `actions/setup-node@v5` → node24; `pnpm/action-setup@v4` → **node20**. La versión mayor
  vigente de esa acción es la 6 (v5.0.0: «updated the action to use Node.js 24»; v6.0.0: soporte de
  pnpm 11, que es el que usa el proyecto).
- Los otros defectos típicos de un flujo heredado se revisaron y no están: `pull_request` sin
  `types:` incluye `synchronize` por defecto (conocimiento general, verificable en la documentación
  de GitHub); `cancel-in-progress` solo en PR; `timeout-minutes` presente; ninguna condición literal
  siempre verdadera.

## 4. Propuesta: qué se adopta ya, qué va a la Etapa 3 y qué se descarta

### Adoptar ya (bajo costo, no cambia el diseño; primero el texto, después el código)

| # | Qué | Por qué ahora | Verificación |
|---|---|---|---|
| A1 | Subir `pnpm/action-setup` de v4 a v6 en `.github/workflows/verificar.yml` | GitHub ya está forzando el runtime; la anotación aparece en cada corrida | La anotación desaparece en la corrida siguiente, leída por la API, y el resto de anotaciones sigue igual |
| A2 | Quitar `X-Powered-By` | Revela la pila sin ningún beneficio; una línea | `curl -sI` sin la cabecera; caso nuevo en `api-smoke.sh` |
| A3 | Cabeceras base con `helmet` (8.3.0, publicada en julio: cumple la regla de 24 h) en el backend, **sin HSTS** hasta que exista el proxy TLS, y con una decisión explícita sobre `/docs` (no servirlo en producción, o CSP relajada solo ahí) | Cierra 5 de las 6 cabeceras medidas en 0/6; el panel futuro heredará la política | `revisar-seguridad-http.sh` pasa de 0/6 a 5/6 (HSTS queda para el proxy); `/docs` sigue abriendo en desarrollo; `pnpm audit` sin avisos; fila nueva en `docs/11 §3` |
| A4 | Una línea en la lista de despliegue de `docs/11 §8`: «no publicar 443 hacia la API mientras no exija credencial (M7)» | La brecha existe por diseño, pero la lista que se lee antes de desplegar no la nombra | Texto |

### Etapa 3 (necesitan una decisión de diseño escrita antes del código)

| # | Qué | Dónde se decide |
|---|---|---|
| E1 | CORS solo en desarrollo, con lista blanca exacta y rechazo silencioso (`cb(null, false)`, nunca un `Error` que termine en 500 y en el registro de errores); en producción, mismo origen y sin CORS | `docs/10 §6`, `docs/11` |
| E2 | Sesión del panel (HU-18, RF-43): cookie `HttpOnly; Secure; SameSite=Lax` con el panel en el mismo origen, `Secure` **no** atado a `NODE_ENV`; JWT dentro de esa cookie es compatible, nunca en `localStorage`. Con eso no hay CORS con credenciales y el CSRF queda contenido por `SameSite` | `docs/11` antes de M7 |
| E3 | Matriz de acceso `ruta × rol → código` escrita **antes** de implementar M7, a partir de RF-41 (aislamiento entre sitios: pedir el dispositivo de otro sitio debe dar 403 o 404, nunca los datos) y RF-43; se convierte en casos de `api-smoke.sh` con un usuario de prueba por rol | `docs/11`; TT-21 |
| E4 | CSP definitiva cuando exista el panel: `script-src 'self'`, `connect-src 'self' wss:`; primero en modo `Report-Only`; y una lista escrita de los flujos que la ejercitan (gráficos, exportación, canal en vivo) para repetirla en cada cambio. Probar con el panel **servido por el backend o la imagen real**, no por el servidor de desarrollo de Vite, que no aplica ninguna cabecera | TT-39 y la tarea del panel |
| E5 | Limitador de tasa (RNF-19 propuesto) sin Redis: en memoria en el backend o en el proxy | pendiente ya registrado |
| E6 | Semilla de demostración con el resultado esperado en la cabecera (`plataforma/db/semillas/demo.sql`) y foto restaurable (`pg_dump -Fc`), con subcomandos `recrear` / `demo` | Sirve al ensayo del guion (`docs/15`); si hay tiempo antes del martes, adelantarla |

### Descartado o ya cubierto

- Orquestación (Kubernetes, Karpenter, *spot*): no aplica a un servidor con Docker Compose; el
  informe ya descarta un orquestador a esta escala.
- Reglas de base de datos de la guía (parámetros con cast, `search_path`, `EXPLAIN`, preflight con
  el mismo `SELECT` antes y después): ya están en `docs/08 §6`.
- Referencias dentro de JSON sin clave foránea: no hay ninguna; la regla ya existe.
- Cookies y banderas de sesión hoy: no hay sesión (E2).

## 5. Ejecutado el mismo día (grupo «adoptar ya» y la semilla), en el orden de la regla de concordancia

Primero el texto (`docs/11 §3, §4, §8`, `docs/10 §6`, `.env.example`, override de desarrollo,
`docs/15 §0`), después el código, al final la medición:

| # | Hecho | Medido |
|---|---|---|
| A1 | `pnpm/action-setup` v4 → v6 en el workflow | Se confirma en la corrida siguiente: la anotación de node20 debe desaparecer (`gh api …/check-runs/<id>/annotations`) |
| A2 + A3 | `helmet` 8.3.0 en `main.ts` sin HSTS; `Permissions-Policy` a mano (helmet no lo emite); `X-Powered-By` fuera | Revisión de solo lectura sobre la imagen reconstruida: **5/6** en `/`, `/docs` y `/dispositivos` (antes 0/6), sin versión expuesta; 7 casos nuevos en `api-smoke.sh`, todos en verde; `pnpm audit` sin avisos |
| A3 | `/docs` solo con `HTTP_DOCS=si` (`servirDocumentacion`, 6 pruebas unitarias: ausente, vacío, `no`, `true`/`1`, `si`, ` SI `); CSP con `'unsafe-inline'` **solo** bajo `/docs` | En el contenedor (override con `si`): `/docs` 200 y su CSP dice `script-src 'self' 'unsafe-inline'`; `/dispositivos` conserva `script-src 'self'`. Fuera de Docker con `HTTP_DOCS=no` en el puerto 3001: `/docs` y `/docs/openapi.json` → **404**, `/salud` → 200, sin el aviso de arranque. La primera corrida de esa prueba respondió 200 porque `dist/` era del 23/09: recompilar antes de probar, tal como dice la regla |
| A4 | Dos líneas nuevas en la lista de despliegue (`docs/11 §8`): la API no se publica en 443 sin credencial (M7); `HTTP_DOCS` ausente en el servidor | Texto |
| E6 | `plataforma/db/semillas/demo.sql` (idempotente, resultado esperado en la cabecera) + `plataforma/pruebas/semilla-demo.sh` que la aplica y comprueba cinco hechos | Corrida normal: 5/5; segunda corrida: igual (idempotente); con `SEMILLA_DISPOSITIVO=dev-9999` plantado: 3 fallas y salida 1, como debe |

| — | **Registros en JSON** (pedido el 27/09): `LOG_FORMATO=json` en el compose base, un evento por línea con nivel, contexto y mensaje, sin códigos de color (antes, cada línea del contenedor traía secuencias de color que ensuciaban archivos y `grep`); `plataforma/pruebas/pila.sh` para encender, seguir, buscar y resumir los registros, con copia en `privado/logs/` | Línea cruda verificada como JSON, cero secuencias de color; `buscar broker` encuentra las tres líneas reales; los cinco contadores de `resumen` calzan con ocho líneas sintéticas idénticas a los mensajes del código; `logs` deja un archivo filtrable con `jq`. El primer intento de `encender` falló porque el script se llamaba a sí mismo por ruta relativa después de cambiar de carpeta: corregido con la ruta absoluta y vuelto a probar |
| — | **Dos backends a la vez se echan del broker.** La prueba de `HTTP_DOCS=no` en el puerto 3001 levantó un segundo backend con el mismo `MQTT_CLIENT_ID`: el contenedor quedó 2 s fuera del broker y se reconectó solo. El guion (`docs/15 §0`) levantaba la pila completa y después pedía `pnpm start:dev`, es decir, dos backends. Reescrito: el camino normal es todo en Docker; el modo con recarga exige detener antes el backend del contenedor. Regla en `docs/10 §6` | Texto; la razón está en el propio protocolo (identificador de cliente duplicado) |

Pruebas unitarias: 40 → 49. Guardián completo: 54 pasos en verde, con `HTTP_DOCS` detectada y
declarada (paso 2d). Lo de la Etapa 3 (E1–E5) quedó escrito en `docs/11 §4` como decisión de diseño
pendiente, no como código.

## 6. Lo que no se afirma

Que Caddy ponga HSTS por sí solo no se verificó en su documentación: por eso A3 deja HSTS fuera del
backend y se decide en una sola capa cuando el proxy exista, midiendo con `curl -I` a través de él.
