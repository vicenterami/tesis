-- Esquema inicial de la plataforma. Materializa el modelo de datos de docs/08.
-- Se ejecuta automáticamente la primera vez que arranca el contenedor de TimescaleDB.
-- Trece entidades: doce tablas relacionales + una hypertable (medicion).

CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS pgcrypto;          -- gen_random_uuid()

-- ── Organización ────────────────────────────────────────────────────────────
CREATE TABLE sitio (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre      text NOT NULL,
    descripcion text,
    creado_en   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE zona (
    id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sitio_id uuid NOT NULL REFERENCES sitio(id) ON DELETE CASCADE,
    nombre   text NOT NULL,
    UNIQUE (sitio_id, nombre)
);

-- ── Catálogo de magnitudes: define unidad canónica y rango físico plausible ──
CREATE TABLE magnitud (
    codigo          text PRIMARY KEY,               -- 'temperatura', 'humedad', ...
    nombre          text NOT NULL,
    unidad_canonica text NOT NULL,                  -- símbolo SenML: 'Cel', '%RH', 'm', ...
    rango_min       double precision,
    rango_max       double precision
);

INSERT INTO magnitud (codigo, nombre, unidad_canonica, rango_min, rango_max) VALUES
    ('temperatura', 'Temperatura',       'Cel',  -40,  85),
    ('humedad',     'Humedad relativa',  '%RH',    0, 100),
    ('presion',     'Presión atmosférica','hPa', 800, 1100),
    ('bateria',     'Nivel de batería',  '%EL',    0, 100),
    ('rssi',        'Intensidad de señal','dBm', -150,   0);

-- ── Dispositivos y sus canales ──────────────────────────────────────────────
CREATE TABLE dispositivo (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    zona_id                uuid NOT NULL REFERENCES zona(id),
    id_fisico              text NOT NULL UNIQUE,    -- MAC / DevEUI: también es el usuario MQTT
    nombre                 text NOT NULL,
    estado                 text NOT NULL DEFAULT 'activo'
                           CHECK (estado IN ('activo', 'mantenimiento', 'baja')),
    intervalo_esperado_s   integer NOT NULL DEFAULT 300,
    visto_por_ultima_vez   timestamptz,
    creado_en              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE canal (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dispositivo_id  uuid NOT NULL REFERENCES dispositivo(id) ON DELETE CASCADE,
    magnitud_codigo text NOT NULL REFERENCES magnitud(codigo),
    etiqueta        text,
    UNIQUE (dispositivo_id, magnitud_codigo)
);

CREATE TABLE credencial (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dispositivo_id uuid NOT NULL REFERENCES dispositivo(id) ON DELETE CASCADE,
    hash           text NOT NULL,                   -- nunca el secreto en claro
    activa         boolean NOT NULL DEFAULT true,
    creada_en      timestamptz NOT NULL DEFAULT now()
);

-- ── Series de tiempo (hypertable) ───────────────────────────────────────────
CREATE TABLE medicion (
    canal_id uuid NOT NULL REFERENCES canal(id),
    tiempo   timestamptz NOT NULL,
    valor    double precision NOT NULL,
    unidad   text NOT NULL
);
SELECT create_hypertable('medicion', 'tiempo', chunk_time_interval => INTERVAL '7 days');
CREATE INDEX medicion_canal_tiempo_idx ON medicion (canal_id, tiempo DESC);

-- Sin compresión: es Timescale License y el sistema usa la edición Apache 2.0 (RNF-15; docs/10 §8.4
-- punto 11). La retención la hace una tarea del backend con drop_chunks, que sí es Apache.

-- ── Reglas, condiciones y eventos ───────────────────────────────────────────
CREATE TABLE regla_umbral (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    canal_id    uuid NOT NULL REFERENCES canal(id) ON DELETE CASCADE,
    umbral_alto double precision,
    umbral_bajo double precision,
    histeresis  double precision NOT NULL DEFAULT 0,
    CHECK (umbral_alto IS NOT NULL OR umbral_bajo IS NOT NULL)
);

CREATE TABLE condicion (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dispositivo_id uuid NOT NULL REFERENCES dispositivo(id) ON DELETE CASCADE,
    regla_id       uuid REFERENCES regla_umbral(id) ON DELETE SET NULL,
    tipo           text NOT NULL
                   CHECK (tipo IN ('sin_comunicacion', 'umbral', 'bateria', 'manipulacion')),
    abierta_en     timestamptz NOT NULL DEFAULT now(),
    cerrada_en     timestamptz
);
-- Solo puede haber UNA condición abierta por dispositivo y tipo.
CREATE UNIQUE INDEX condicion_abierta_unica
    ON condicion (dispositivo_id, tipo) WHERE cerrada_en IS NULL;

CREATE TABLE evento (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dispositivo_id uuid REFERENCES dispositivo(id) ON DELETE SET NULL,
    tipo           text NOT NULL,                   -- alta, baja, mantenimiento, condicion_abierta, ...
    detalle        jsonb,
    ocurrido_en    timestamptz NOT NULL DEFAULT now()
);

-- ── Cuarentena: tramas rechazadas, crudas, con su motivo ────────────────────
CREATE TABLE cuarentena (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    origen       text NOT NULL,                     -- 'mqtt' | 'http'
    topico       text,
    motivo       text NOT NULL,                     -- dominio cerrado: migraciones 07 y 09
    payload_crudo bytea NOT NULL,
    recibido_en  timestamptz NOT NULL DEFAULT now()
);

-- ── Usuarios y acceso por sitio (multi-tenencia) ────────────────────────────
CREATE TABLE usuario (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre        text NOT NULL,
    email         text NOT NULL UNIQUE,
    hash_password text NOT NULL,
    creado_en     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE usuario_sitio (
    usuario_id uuid NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
    sitio_id   uuid NOT NULL REFERENCES sitio(id)   ON DELETE CASCADE,
    rol        text NOT NULL CHECK (rol IN ('administrador', 'consulta')),
    PRIMARY KEY (usuario_id, sitio_id)
);
