# Plataforma — despliegue y código

Directorio de implementación. Todo corre en contenedores Docker (decisión y razones en
`docs/09` §3; vista de despliegue en `docs/10` §6).

## Estructura

```
plataforma/
├── docker-compose.yml        # servicios, volúmenes, límites de recursos (forma de PRODUCCIÓN: sin puertos)
├── docker-compose.override.yml # SOLO desarrollo: publica 5432 y 1883 en 127.0.0.1 (Compose lo carga solo)
├── backend/                  # NestJS: recepción, pipeline, API (ver backend/README.md)
├── .env.example              # variables de entorno (copiar a .env; .env NO se versiona)
├── db/init/01-esquema.sql    # modelo de datos (docs/08) — se aplica solo al primer arranque
├── mosquitto/config/
│   ├── mosquitto.conf        # broker sin anónimos, con contraseñas y ACL
│   ├── acl                   # cada dispositivo publica solo en su tópico
│   └── passwd                # (generado, NO se versiona)
└── herramientas/             # utilidades históricas (Contact ID, fase previa)
```

## Puesta en marcha (desarrollo local)

```bash
cd plataforma
cp .env.example .env                 # editar las claves
openssl rand -base64 24              # generar una clave por variable

# Contraseñas MQTT (crea el archivo passwd con hash; una línea por usuario)
docker run --rm -v "$PWD/mosquitto/config:/c" eclipse-mosquitto:2.0.22 \
  mosquitto_passwd -c -b /c/passwd sonda   'LA_CLAVE_DE_MQTT_SONDA_CLAVE'
docker run --rm -v "$PWD/mosquitto/config:/c" eclipse-mosquitto:2.0.22 \
  mosquitto_passwd    -b /c/passwd backend 'OTRA_CLAVE'
# El archivo queda propiedad de root; el broker corre como uid 1883 y debe poder leerlo:
docker run --rm -v "$PWD/mosquitto/config:/c" eclipse-mosquitto:2.0.22 \
  sh -c 'chown 1883:1883 /c/passwd && chmod 0640 /c/passwd'

docker compose up -d                 # descarga imágenes, crea red, volúmenes y arranca
docker compose ps                    # estado y healthchecks
docker compose logs -f timescaledb   # ver el esquema aplicándose la primera vez
docker stats                         # memoria y CPU reales por contenedor
```

Probar la base de datos:

```bash
docker compose exec timescaledb psql -U plataforma -d plataforma -c "\dt"
docker compose exec timescaledb psql -U plataforma -d plataforma \
  -c "SELECT hypertable_name FROM timescaledb_information.hypertables;"
```

Probar el broker (publicar como un dispositivo de prueba requiere crearle usuario en `passwd`):

```bash
docker compose exec mosquitto mosquitto_sub -u backend -P 'OTRA_CLAVE' -t 'sitio/#' -v
```

## Conceptos de Docker que aparecen aquí

| Término | Qué es | Dónde se ve |
|---|---|---|
| **Imagen** | Plantilla inmutable con el software instalado (como un ISO) | `image: eclipse-mosquitto:2.0` |
| **Contenedor** | Una imagen en ejecución, aislada | cada bloque bajo `services:` |
| **Volumen** | Disco persistente gestionado por Docker; sobrevive al contenedor | `datos-timescale`, `datos-mosquitto` |
| **Bind mount** | Carpeta del anfitrión montada dentro del contenedor | `./db/init:/docker-entrypoint-initdb.d` |
| **Red** | Compose crea una red interna; los servicios se ven por nombre | el backend usará `timescaledb:5432` |
| **Puerto publicado** | Lo único visible desde fuera del contenedor | `127.0.0.1:1883:1883` en el *override* — solo este equipo, solo desarrollo |
| **Override** | Segundo archivo Compose que se superpone al base; el servidor no lo lleva | `docker-compose.override.yml` |
| **Healthcheck** | Comando periódico que dice si el servicio está sano | `pg_isready`, `mosquitto_sub $SYS` |
| **Límite de recursos** | Techo de memoria/CPU del contenedor | `deploy.resources.limits` |
| **Política de reinicio** | Qué hacer si el proceso muere o el servidor reinicia | `restart: unless-stopped` |

## Seguridad

Capas, amenazas y controles verificados: `docs/11-seguridad.md`.

## Próximas tandas

1. ~~Esqueleto del backend~~ hecho: filtro 1 + cuarentena. Siguen los filtros 2–6.
2. Contenedor del backend en el Compose (imagen propia, multi-etapa con el panel estático).
3. ChirpStack (base aparte en el mismo PostgreSQL + Redis propio) cuando exista el gateway.
4. Proxy inverso con TLS (Caddy) para 443 y 8883; retirar el puerto 1883 publicado.
