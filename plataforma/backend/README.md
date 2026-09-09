# Backend (NestJS)

Recibe las tramas del broker, las pasa por el pipeline y expone la API. Diseño en `docs/10`.

## Estructura

```
src/
├── main.ts                    # arranque; escucha en 127.0.0.1:3000 en desarrollo
├── app.module.ts              # módulo raíz: junta los demás
├── db/db.module.ts            # pool de conexiones a TimescaleDB (SQL directo, driver pg)
├── broker/broker.service.ts   # conexión MQTT como usuario "backend"; reparte tramas
├── recepcion/recepcion.service.ts  # M1+M2: filtro 1 (autenticar) y cuarentena
└── salud/salud.controller.ts  # GET /salud
```

## Ejecutar en desarrollo

Requiere la pila de Docker arriba (`docker compose up -d` en `plataforma/`), Node 22 y pnpm.

```bash
cd plataforma/backend
pnpm install          # dependencias; NO ejecuta scripts de terceros (.npmrc: ignore-scripts)
pnpm start:dev        # arranca y recompila al guardar
curl -s http://127.0.0.1:3000/salud
```

El backend lee `plataforma/.env` (el mismo del Compose): `DB_*` y `MQTT_BACKEND_CLAVE`.

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

→ el log del backend dice `aceptada: dev-0001/temperatura` y `dispositivo.visto_por_ultima_vez`
se actualiza. Los filtros 2–6 llegan en las próximas tandas.

## Reglas del proyecto en este código

- Dependencias con **versión exacta** (`save-exact`), sin `^`.
- **`ignore-scripts=true`**: ninguna dependencia ejecuta código al instalarse.
- Secretos solo por variables de entorno; nunca en el código ni en el repositorio.
- SQL parametrizado siempre (`$1, $2…`): sin concatenar cadenas → sin inyección SQL.
