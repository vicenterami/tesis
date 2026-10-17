# Backend (NestJS)

Recibe las tramas del broker, las pasa por el pipeline y expone la API. Diseño en `docs/10`.

## Estructura

```
src/
├── main.ts                    # arranque; escucha en HTTP_INTERFAZ:HTTP_PUERTO (127.0.0.1:3000 en desarrollo)
├── app.module.ts              # módulo raíz: junta los demás
├── db/db.module.ts            # pool de conexiones a TimescaleDB (SQL directo, driver pg)
├── broker/broker.service.ts   # conexión MQTT como usuario "backend"; reparte tramas
├── supervision/               # M4: barrido periódico → condición "sin_comunicacion" (filtro 6)
├── alertas/                   # M6: umbrales con histéresis → condición "umbral" (filtro 5)
├── recepcion/
│   ├── recepcion.service.ts   # M1+M2: orquesta los seis filtros y la cuarentena
│   ├── lectura.ts             # la unidad que viaja por el pipeline: {magnitud, valor, unidad, tiempo}
│   ├── tiempo.ts              # plausibilidad de la marca de tiempo del emisor (filtro 4, docs/13 regla 7)
│   ├── unidades.ts            # conversiones a la unidad canónica (filtro 4)
│   ├── adaptadores/           # filtro 2: senml (nativo, RFC 8428), plano (número o JSON simple), chirpstack y milesight (LoRaWAN, punto 47)
│   └── *.spec.ts              # pruebas unitarias de las funciones puras (jest)
├── consulta/                  # M5: API de solo lectura (dispositivos, canales, condiciones, cuarentena)
├── tiempo-real/               # TT-39: canal SSE hacia el panel (GET /eventos) y bus de eventos en memoria
├── alta/                      # HU-11: POST /dispositivos, DELETE /dispositivos/:id y POST /dispositivos/:id/credencial (guardia X-Clave-Admin, validación, transacción + cliente del broker, scrypt)
├── broker/dynsec*.ts          # administración del plugin Dynamic Security por $CONTROL (identidad backend-admin, conexión propia); recibe los contadores $SYS
├── broker/metricas*.ts        # cola del broker vigilada: muestra por minuto en metrica_broker y condición del sistema broker_descarte (docs/10 §8.4 punto 43)
├── retencion/                 # borra lo vencido de medicion, trama, cuarentena y metrica_broker por la función acotada fn_retencion_drop_chunks (migración 14)
├── openapi.ts                 # contrato OpenAPI generado desde los decoradores; /docs
└── salud/salud.controller.ts  # GET /salud: base, cola del broker (descartes, condición abierta) y aprovisionamiento en curso
panel/                         # el panel (Svelte + Vite; docs/19): paquete del mismo workspace de pnpm
├── index.html, src/main.ts    # entrada (sin scripts en línea: la CSP del backend los prohíbe)
├── src/App.svelte             # ruteo por fragmento (#/ inventario, #/dispositivos/<id> ficha) y estado del servicio
├── src/Inventario.svelte      # P2: inventario con semáforo, conteos, filtros y canal en vivo
├── src/Ficha.svelte           # P3: identidad, canales, gráfico que sigue en vivo, condiciones, rechazadas
├── src/Grafico.svelte         # el gráfico uPlot (promedio del histórico y lectura actual en series aparte)
├── src/app.css                # estilos propios, sin biblioteca de componentes
├── public/avisos-de-terceros.txt  # avisos MIT de svelte y uPlot, servidos con el build
├── src/lib/                   # estado visual, cliente HTTP, canal en vivo con reconexión, datos del gráfico, antirrebote y lotes, tiempo
├── src/**/*.test.ts           # pruebas (vitest; las de pantalla, por el DOM con jsdom)
└── vite.config.ts             # base /panel/, reenvío al backend en desarrollo, build sin .map
```

## Panel (docs/19)

El backend lo sirve compilado en `/panel` (`main.ts`, `useStaticAssets`); la imagen lo compila en su etapa de build. En desarrollo:

```
pnpm --filter panel dev        # Vite en http://127.0.0.1:5173/panel/, reenvía la API y /eventos al backend (3000) sin cambiar el Host
pnpm --filter panel verificar  # svelte-check + vitest + vite build (también lo corre `pnpm verificar` desde aquí)
bash ../pruebas/panel-desarrollo.sh   # con la pila arriba: el reenvío conserva el Host y no retiene el canal; el build servido lleva la CSP
```

## Verificación automática (TT-03)

```bash
pnpm verificar        # = pnpm typecheck && pnpm lint && pnpm test  (≈ 5 s, sin base ni broker)
```

| Capa | Herramienta | Qué atrapa |
|---|---|---|
| Tipos | `tsc --noEmit` (`strict`) | usos incorrectos entre módulos; `null` no tratado |
| Estilo y errores latentes | ESLint 10 + typescript-eslint `recommendedTypeChecked` | promesas sin `await` (`no-floating-promises`), variables sin uso, `async` mal colocado |
| Comportamiento | jest + ts-jest sobre las funciones **puras** del pipeline | reglas de tiempo, conversión de unidades, adaptadores SenML y plano |

Las pruebas unitarias viven junto al código (`*.spec.ts`) y no tocan base ni broker: cada caso
documenta una regla (p. ej. «marca anterior al año 2000 → hora de recepción»). Lo que sí depende
de la pila (esquema, migraciones, API) lo cubre `plataforma/pruebas/verificar-todo.sh`.

## Ejecutar en desarrollo

Requiere la pila de Docker arriba (`docker compose up -d` en `plataforma/`), Node 22 y pnpm.

```bash
cd plataforma/backend
pnpm install          # dependencias; NO ejecuta scripts de terceros (.npmrc: ignore-scripts)
pnpm start:dev        # arranca y recompila al guardar
curl -s http://127.0.0.1:3000/salud
```

El backend lee `plataforma/.env` (el mismo del Compose): `DB_*` y `MQTT_BACKEND_CLAVE`. Opcional:
`MQTT_CLIENT_ID` (por defecto `backend`). La sesión MQTT es **persistente**: si el backend cae, el broker
guarda los mensajes QoS 1 y los entrega al volver; una segunda instancia con el mismo id desconecta a la
primera (deliberado: el pipeline corre en un solo proceso). Detalle en `docs/10 §4.1`.

## Probar el filtro 1

Con el backend corriendo, publica como un dispositivo de prueba **no registrado**:

```bash
# desde plataforma/ (la clave de dev-0001 se crea con `bash pruebas/broker-cliente.sh dev-0001`)
bash pruebas/publicar.sh temperatura 21.5          # pide la clave oculta si CLAVE_DEV no está exportada
docker compose exec timescaledb psql -U plataforma -d plataforma -c "SELECT topico, motivo, recibido_en FROM cuarentena ORDER BY recibido_en DESC LIMIT 3;"
```

→ fila con motivo `no_registrado`: el broker aceptó la credencial, pero la plataforma no tiene ese
dispositivo **dado de alta**. Regístralo y vuelve a publicar (atajo: `bash plataforma/pruebas/semilla-demo.sh`
hace todos los `INSERT` de esta página de una vez, de forma idempotente, y verifica que quedaron):

```sql
INSERT INTO sitio (id, nombre) VALUES ('00000000-0000-0000-0000-000000000001', 'Campus Dr. Luis Rivas del Canto') ON CONFLICT DO NOTHING;
INSERT INTO zona (id, sitio_id, nombre) VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Laboratorio') ON CONFLICT DO NOTHING;
INSERT INTO dispositivo (zona_id, id_fisico, nombre) VALUES ('00000000-0000-0000-0000-000000000002', 'dev-0001', 'Nodo de prueba 1');
```

→ el backend registra `visto_por_ultima_vez`, pero **aún no guarda la medición**: el filtro 3 exige
que el dispositivo tenga el **canal** declarado. Decláralo:

```sql
INSERT INTO canal (dispositivo_id, magnitud_codigo)
  SELECT id, 'temperatura' FROM dispositivo WHERE id_fisico = 'dev-0001';
```

## Probar los filtros 2–4

Con el canal declarado, publica estos casos y observa el log del backend y la tabla `medicion`. El filtro 2 usa el
formato que el dispositivo declaró al darse de alta (`dev-0001`: `senml`, el valor por defecto; `docs/10 §8.4` punto 47):
no prueba adaptadores al azar.

| Cuerpo publicado en `…/dev-0001/temperatura` | Adaptador | Resultado |
|---|---|---|
| `[{"bn":"dev-0001","n":"temperatura","u":"Cel","v":22.1}]` | senml | guardada: 22,1 Cel |
| `[{"n":"temperatura","u":"K","v":300}]` | senml | guardada **convertida**: 26,85 Cel |
| `[{"n":"temperatura","v":500}]` | senml | cuarentena `invalida` · fuera de rango (−40…85) |
| `[{"n":"temperatura","u":"furlongs","v":20}]` | senml | cuarentena `invalida` · unidad no convertible |
| `abc` | senml | cuarentena `malformada` · «formato declarado senml: la trama no tiene esa forma» |
| `21.5` | senml | cuarentena `malformada` · el número suelto es del formato `plano`, que `dev-0001` no declaró |
| en `…/dev-0001/presion`: `[{"n":"presion","v":1013}]` | senml | cuarentena `invalida` · canal no declarado |

El formato `plano` (un número o `{"v":…,"u":…}`) se prueba con un dispositivo que lo declare en el alta (`"formato": "plano"`).

```bash
docker compose exec timescaledb psql -U plataforma -d plataforma -c "SELECT m.codigo, x.valor, x.unidad, x.tiempo FROM medicion x JOIN canal c ON c.id=x.canal_id JOIN magnitud m ON m.codigo=c.magnitud_codigo ORDER BY x.tiempo DESC LIMIT 5;"
```

## Probar los filtros 5 y 6

Regla de umbral (alto 30 Cel, histéresis 2) y un intervalo esperado corto para provocar el silencio:

```sql
INSERT INTO regla_umbral (canal_id, umbral_alto, histeresis)
  SELECT c.id, 30, 2 FROM canal c JOIN dispositivo d ON d.id = c.dispositivo_id
   WHERE d.id_fisico = 'dev-0001' AND c.magnitud_codigo = 'temperatura';
UPDATE dispositivo SET intervalo_esperado_s = 5 WHERE id_fisico = 'dev-0001';
```

| Acción | Log del backend | `condicion` |
|---|---|---|
| publicar `35` | `umbral alto cruzado (35 Cel) · condición abierta` | umbral ABIERTA |
| publicar `29` | (nada: 29 está entre 28 y 30, zona de histéresis) | umbral ABIERTA |
| publicar `27` | `valor de vuelta en rango · condición cerrada` | umbral cerrada |
| callar > 10 s y esperar el barrido (≤ 60 s) | `sin comunicación hace N s · condición abierta` | sin_comunicacion ABIERTA |
| publicar `25` | `comunicación restablecida · condición cerrada` | sin_comunicacion cerrada |

```bash
docker compose exec timescaledb psql -U plataforma -d plataforma -c "SELECT tipo, abierta_en, cerrada_en FROM condicion ORDER BY abierta_en DESC LIMIT 5; SELECT tipo, detalle, ocurrido_en FROM evento ORDER BY ocurrido_en DESC LIMIT 5;"
```

`SUPERVISION_INTERVALO_S` en el `.env` cambia la frecuencia del barrido (60 s por defecto).

Pendiente del pipeline: la notificación de condiciones por correo (al panel ya llegan por el canal en vivo, más abajo). Los adaptadores
«milesight» (ruta B) y «chirpstack» (ruta C) existen desde el 15/10/2026 y los prueba el banco (`banco.sh lorawan`).

## API de consulta (M5)

Solo lectura, sin autenticación aún (por eso escucha en 127.0.0.1). Fechas en ISO 8601 UTC (`Z`).

**Contrato OpenAPI (TT-13):** se genera desde los decoradores de los controladores, así que no puede
describir rutas que no existen. Con el backend corriendo, la documentación interactiva está en
`http://127.0.0.1:3000/docs` y el documento en `/docs/openapi.json`. `pnpm openapi` lo exporta a
`openapi.json` en esta carpeta (versionado: es el contrato que consumirá el panel).

| Endpoint | Devuelve | Notas |
|---|---|---|
| `GET /dispositivos` | inventario: estado, `en_linea`, última vista, canales, condiciones abiertas | `en_linea` = visto hace menos de 2 × intervalo esperado |
| `GET /dispositivos/:id` | ficha: canales con reglas y última medición, condiciones abiertas | 404 si no existe |
| `GET /canales/:id/historico?desde&hasta&intervalo` | `{tiempos[], valores[], muestras[]}` agregado con `time_bucket(…, zona_del_sitio)` | por defecto 24 h cada `15 minutes`; intervalos: 1 minute, 5 minutes, 15 minutes, 1 hour, 6 hours, 1 day; rango `[desde, hasta)` |
| `GET /condiciones?abiertas=true\|false&limite&dispositivo` | condiciones con `duracion_s`, dispositivo y regla | sin `abiertas`: todas; `dispositivo` (UUID): solo las suyas (12/10) |
| `GET /dispositivos/:id/exportar?formato=csv\|json&desde&hasta` | mediciones crudas del dispositivo en el rango, en flujo por tandas; CSV estándar (coma, punto decimal, UTF-8, CRLF) o JSON por fila | RF-34 (12/10); XLSX en la Etapa 4 |
| `GET /cuarentena?limite&dispositivo` | últimas tramas rechazadas con motivo y carga (200 caracteres) | diagnóstico |
| `POST /dispositivos` (cabecera `X-Clave-Admin`) | alta: dispositivo, canales, credencial (mostrada una vez) y cliente del broker, todo o nada | 201 con `conexion` (usuario, credencial, tópico, trama de ejemplo); 400 lista de motivos; 401; 409 existe; 502 el broker no aceptó; 503 sin clave o sin broker |
| `DELETE /dispositivos/:id` (cabecera `X-Clave-Admin`) | baja lógica: `estado = baja`, credenciales inactivas, condiciones abiertas cerradas, evento `baja`, cliente borrado del broker; todo o nada | 200; 404 si no existe; 409 si ya estaba de baja (13/10) |
| `POST /recepcion/:idFisico` (cabecera `Authorization: Bearer`) | recepción por HTTP (HU-01): 202 con el resumen, 401, 413, 415, 422, 429, 503 (`docs/10 §8.4` punto 52) | dispositivos de vía `http` |
| `GET /pasarelas`, `POST /pasarelas`, `DELETE /pasarelas/:id`, `POST /pasarelas/:id/credencial` (las que escriben, con `X-Clave-Admin`) | pasarelas LoRaWAN: inventario, alta con credencial del broker, baja y rotación (`docs/10 §8.4` punto 47) | 401 o 503 sin la clave |
| `GET /salud` | estado del backend, la base y el broker (cola, descartes, condición del sistema) | lo usa el `HEALTHCHECK` |
| `POST /dispositivos/:id/credencial` (cabecera `X-Clave-Admin`) | rotación: credencial nueva (mostrada una vez), la anterior inactiva, evento `rotacion`, `setClientPassword` en el broker; todo o nada | 201 con `conexion`; 409 de baja; 400 lorawan; si la respuesta no llega, repetir (13/10) |

```bash
curl -s http://127.0.0.1:3000/dispositivos | python3 -m json.tool
curl -s "http://127.0.0.1:3000/canales/<canal_id>/historico?intervalo=1%20hour" | python3 -m json.tool
curl -s "http://127.0.0.1:3000/condiciones?abiertas=true"
```

Entradas inválidas responden `400` con el motivo (UUID mal formado, fecha no ISO, intervalo fuera
de la lista, límite fuera de rango). El intervalo es una **lista cerrada**: nunca se interpola texto
libre en SQL.

## Canal de tiempo real (TT-39)

`GET /eventos` abre un flujo SSE (`text/event-stream`) que el panel lee con `EventSource`. Cada evento sale después de
quedar guardado: `medicion` (dispositivo, canal, valor, unidad, tiempo), `visto` (señal de vida) y `condicion` (umbral o
sin comunicación, abierta o cerrada); además, un `latido` cada 25 s. Filtros opcionales `?dispositivo=` o `?canal=`
(UUID). Rechaza la petición que el navegador marca como de otro sitio (`Sec-Fetch-Site` u `Origin`, 403) y, con 50
flujos abiertos, responde 503 (`docs/10 §5`).

```bash
curl -N http://127.0.0.1:3000/eventos
```

## Reglas del proyecto en este código

- Dependencias con **versión exacta** (`save-exact`), sin `^`.
- **`ignore-scripts=true`**: ninguna dependencia ejecuta código al instalarse.
- Secretos solo por variables de entorno; nunca en el código ni en el repositorio.
- SQL parametrizado siempre (`$1, $2…`): sin concatenar cadenas → sin inyección SQL. Cast explícito
  cuando el parámetro no se compara directo con una columna (`$1::int`).
- Errores de restricción de la base (`23505` unicidad, `23503` FK) se traducen a un `4xx` con mensaje
  para la persona; un `5xx` es un defecto nuestro, no del usuario (aplica desde M3).
- Nunca `SELECT *` sobre `usuario` ni `credencial`: columnas explícitas, el hash no sale de la base.

## Imagen del contenedor (`Dockerfile`)

*Multi-stage* (`docs/10 §6`): la etapa `build` usa Node con las herramientas de desarrollo para compilar (`pnpm build`); la
imagen final (`runtime`) parte de la misma base *slim*, lleva `dist/`, `panel/dist/` (el panel compilado por Vite en la misma
etapa de build, `docs/19`) y solo las dependencias de producción del backend (`--filter`: `svelte` no viaja), corre como
usuario sin privilegios (`node`) y expone un `HEALTHCHECK` contra `GET /salud`. El almacén de pnpm se borra explícitamente
tras instalar (`pnpm store prune` no basta: no borra lo que sigue referenciado).
