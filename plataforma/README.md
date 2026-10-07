# Plataforma — despliegue y código

Directorio de implementación. Todo corre en contenedores Docker (decisión y razones en
`docs/09` §3; vista de despliegue en `docs/10` §6).

## Estructura

```
plataforma/
├── docker-compose.yml        # servicios, volúmenes, límites de recursos (forma de PRODUCCIÓN: sin puertos)
├── docker-compose.override.yml # SOLO desarrollo: publica 5432 y 1883 en 127.0.0.1 (Compose lo carga solo)
├── backend/                  # NestJS: recepción, pipeline, API (ver backend/README.md)
├── proxy/                    # capa opcional nginx con TLS: compose.proxy.yml, nginx.conf, ca-desarrollo.sh (docs/10 §8.4 decisión 10)
├── .env.example              # variables de entorno (copiar a .env; .env NO se versiona)
├── db/pruebas/               # pruebas SQL de solo lectura (zonas horarias, guardias) y er-mermaid.sql (ER desde el esquema)
├── pruebas/api-smoke.sh      # prueba de humo de la API (OK/FALLA por caso)
├── db/init/                  # esquema y migraciones numeradas; en una instalación nueva corren todas
│   ├── 01-esquema.sql        #   en orden al primer arranque. En una base existente, cada archivo nuevo
│   └── 02…07-*.sql           #   se aplica a mano: docker compose exec -T timescaledb psql -U plataforma -d plataforma < db/init/NN-x.sql
└── mosquitto/config/
    ├── mosquitto.conf        # broker sin anónimos, con contraseñas y ACL
    ├── acl                   # cada dispositivo publica solo en su tópico
    └── passwd                # (generado, NO se versiona)
```

## Puesta en marcha (desarrollo local)

```bash
cd plataforma
cp .env.example .env                 # editar las claves
openssl rand -base64 24              # generar una clave por variable

# Contraseñas MQTT (crea el archivo passwd con hash; una línea por usuario). La clave se pega oculta
# (read -rs) y entra por la entrada estándar: no queda en el historial de la terminal ni en ps.
# -c CREA el archivo desde cero: solo para el primer usuario de una instalación nueva.
read -rs -p "clave de sonda (la de .env): " C && echo && printf '%s\n%s\n' "$C" "$C" | \
  docker run --rm -i -v "$PWD/mosquitto/config:/c" --entrypoint mosquitto_passwd eclipse-mosquitto:2.0.22 -c /c/passwd sonda
read -rs -p "clave de backend (la de .env): " C && echo && printf '%s\n%s\n' "$C" "$C" | \
  docker run --rm -i -v "$PWD/mosquitto/config:/c" --entrypoint mosquitto_passwd eclipse-mosquitto:2.0.22 /c/passwd backend
unset C
# El archivo queda propiedad de root; el broker corre como uid 1883 y debe poder leerlo:
docker run --rm -v "$PWD/mosquitto/config:/c" eclipse-mosquitto:2.0.22 \
  sh -c 'chown 1883:1883 /c/passwd && chmod 0640 /c/passwd'
# Siempre en /c, nunca en /mosquitto: el arranque de la imagen hace chown -R de /mosquitto (docs/11 §7).
# Claves de DISPOSITIVOS (dev-0001…): un solo comando, con la clave oculta y verificada:
#   bash pruebas/clave-dispositivo.sh dev-0001

docker compose up -d                 # descarga imágenes, construye el backend, crea red, volúmenes y arranca
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
read -rs -p "clave de backend: " C && echo && docker compose exec mosquitto mosquitto_sub -u backend -P "$C" -t 'sitio/#' -v; unset C
```

Probar el backend contenedorizado (`docker compose ps` debe mostrarlo `healthy`; el override publica su
puerto solo en `127.0.0.1`, igual que el resto):

```bash
curl http://127.0.0.1:3000/salud    # {"estado":"ok","base":"conectada","tablas":13}
# http://127.0.0.1:3000/docs en el navegador → contrato OpenAPI
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

## Pruebas semiautomáticas

**Banco de pruebas desechable** (`pruebas/banco/banco.sh`, `docs/16`): una segunda pila Compose (`banco`) con datos en RAM,
otros puertos y broker sin credenciales, para el emulador de nodos (`backend/src/emulador`, TT-28), la carga (TT-29) y las
pruebas de carrera y la capa TLS: `encender 120` · `carrera` · `correr --duracion 90 --dispositivos 120` · `proxy` · `apagar`.

```bash
bash pruebas/verificar-todo.sh     # TODO: guardias de esquema, migraciones aplicadas, diagramas = docs = base, API
bash pruebas/api-smoke.sh          # solo la API, con el backend corriendo
```
Una línea `OK`/`FALLA` por caso. Son de solo lectura: no publican en el broker ni escriben en la base.

## Seguridad

Capas, amenazas y controles verificados: `docs/11-seguridad.md`.

## Próximas tandas

1. ~~Esqueleto del backend y filtros 1 a 6~~ hechos.
2. ~~Contenedor del backend en el Compose~~ hecho (imagen propia multi-etapa); falta el panel estático.
3. ChirpStack (base aparte en el mismo PostgreSQL + Redis propio) cuando exista el gateway.
4. ~~Proxy inverso con TLS~~ capa nginx hecha (07/10, `proxy/`, probada en el banco con `banco.sh proxy`); falta el certificado real (ficha D-06), `limit_req` y no publicar el 1883 en producción.
