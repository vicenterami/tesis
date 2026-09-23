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
│   ├── adaptadores/           # filtro 2: senml (nativo, RFC 8428) y plano (número o JSON simple)
│   └── *.spec.ts              # pruebas unitarias de las funciones puras (jest)
├── consulta/                  # M5: API de solo lectura (dispositivos, canales, condiciones, cuarentena)
├── openapi.ts                 # contrato OpenAPI generado desde los decoradores; /docs
└── salud/salud.controller.ts  # GET /salud
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
# desde plataforma/
docker compose exec mosquitto mosquitto_pub -u dev-0001 -P '<clave>' -t sitio/uct/dispositivo/dev-0001/temperatura -m 21.5
docker compose exec timescaledb psql -U plataforma -d plataforma -c "SELECT topico, motivo, recibido_en FROM cuarentena ORDER BY recibido_en DESC LIMIT 3;"
```

→ fila con motivo `desconocido`: el broker aceptó la credencial, pero la plataforma no tiene ese
dispositivo **dado de alta**. Regístralo y vuelve a publicar:

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

Con el canal declarado, publica estos casos y observa el log del backend y la tabla `medicion`:

| Cuerpo publicado en `…/dev-0001/temperatura` | Adaptador | Resultado |
|---|---|---|
| `21.5` | plano | guardada: 21,5 Cel |
| `[{"bn":"dev-0001","n":"temperatura","u":"Cel","v":22.1}]` | senml | guardada: 22,1 Cel |
| `{"v":300,"u":"K"}` | plano | guardada **convertida**: 26,85 Cel |
| `500` | plano | cuarentena `invalida` · fuera de rango (−40…85) |
| `abc` | ninguno | cuarentena `malformada` |
| `{"v":20,"u":"furlongs"}` | plano | cuarentena `invalida` · unidad no convertible |
| en `…/dev-0001/presion`: `1013` | plano | cuarentena `invalida` · canal no declarado |

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

Pendientes del pipeline: adaptador de ChirpStack; notificación de condiciones al panel (WebSocket) y por correo.

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
| `GET /condiciones?abiertas=true|false&limite` | condiciones con `duracion_s`, dispositivo y regla | sin `abiertas`: todas |
| `GET /cuarentena?limite` | últimas tramas rechazadas con motivo y carga (200 caracteres) | diagnóstico |

```bash
curl -s http://127.0.0.1:3000/dispositivos | python3 -m json.tool
curl -s "http://127.0.0.1:3000/canales/<canal_id>/historico?intervalo=1%20hour" | python3 -m json.tool
curl -s "http://127.0.0.1:3000/condiciones?abiertas=true"
```

Entradas inválidas responden `400` con el motivo (UUID mal formado, fecha no ISO, intervalo fuera
de la lista, límite fuera de rango). El intervalo es una **lista cerrada**: nunca se interpola texto
libre en SQL.

## Reglas del proyecto en este código

- Dependencias con **versión exacta** (`save-exact`), sin `^`.
- **`ignore-scripts=true`**: ninguna dependencia ejecuta código al instalarse.
- Secretos solo por variables de entorno; nunca en el código ni en el repositorio.
- SQL parametrizado siempre (`$1, $2…`): sin concatenar cadenas → sin inyección SQL. Cast explícito
  cuando el parámetro no se compara directo con una columna (`$1::int`).
- Errores de restricción de la base (`23505` unicidad, `23503` FK) se traducen a un `4xx` con mensaje
  para la persona; un `5xx` es un defecto nuestro, no del usuario (aplica desde M3).
- Nunca `SELECT *` sobre `usuario` ni `credencial`: columnas explícitas, el hash no sale de la base.
