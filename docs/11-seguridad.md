# Seguridad en capas (defensa en profundidad)

> **Sustenta:** RNF-08, RNF-09, RNF-10, RF-40–RF-42 · Etapa 2 (diseño) y su verificación.
> Principio: **ninguna capa es la única barrera**. Un sensor defectuoso o malicioso, un error
> humano o un servicio comprometido deben quedar contenidos por la capa siguiente.
> Versión: 8 de septiembre de 2026. Cada control marcado ✅ fue probado en el despliegue local.

---

## 1. Modelo de amenazas (qué puede salir mal)

| # | Amenaza | Ejemplo concreto | Capa que la contiene |
|---|---|---|---|
| A1 | **Dispositivo malicioso o mal programado** | Un nodo publica en el tópico de otro, inunda el broker, envía valores absurdos | Autenticación + ACL por dispositivo; validación por rango; límites de recursos |
| A2 | **Acceso externo no autorizado** | Alguien en la red local o en Internet se conecta al broker o a la base | Sin anónimos; puertos no publicados; TLS en producción |
| A3 | **Servicio comprometido** | Una vulnerabilidad en el broker permite ejecutar código | Contenedor sin escalada de privilegios; usuario no root; red interna aislada |
| A4 | **Error del operador** | `docker compose down -v` borra los volúmenes con todo el dato | Respaldos automáticos; comandos destructivos con confirmación |
| A5 | **Fuga de secretos** | Una contraseña termina en el repositorio o en un log | `.gitignore` para secretos; solo hashes en base y broker; plantilla `.env.example` |
| A6 | **Agotamiento de recursos** | Un bug o un ataque consume toda la memoria del servidor | Techo de memoria/CPU por contenedor; el anfitrión sobrevive |

## 2. Las capas, de afuera hacia adentro

```
 Internet / red local
 ─────────────────────────────────────────────────────────────
 [1] Red      · solo 443 / 8883 / 1700-udp publicados; en desarrollo 1883 SOLO en 127.0.0.1
 [2] TLS      · cifrado obligatorio en producción (proxy); credenciales nunca en claro por la red
 [3] Identidad· broker sin anónimos; usuario MQTT = id físico del dispositivo; hash en passwd
 [4] ACL      · patrón %u: cada dispositivo escribe SOLO bajo su propio id; backend lee todo
 [5] Pipeline · autenticar → analizar → validar (rango/unidad) → cuarentena; nada crudo a las series
 [6] Datos    · base sin puerto expuesto; una credencial por servicio; mínimos privilegios
 [7] Contenedor· no-new-privileges; usuario no root; imágenes con versión fijada; límites de recursos
 [8] Operación· respaldos; comandos destructivos protegidos; secretos fuera del repo
 ─────────────────────────────────────────────────────────────
```

## 3. Controles implementados y verificados

| Capa | Control | Dónde | Verificación |
|---|---|---|---|
| 1 | Broker publicado solo en `127.0.0.1` en desarrollo | `docker-compose.yml` | ✅ `docker compose ps` muestra `127.0.0.1:1883` |
| 1 | Base de datos sin `ports` | `docker-compose.yml` | ✅ solo `5432/tcp` interno |
| 3 | `allow_anonymous false` | `mosquitto.conf` | ✅ publicación anónima → *not authorised* |
| 3 | Contraseñas con hash (`mosquitto_passwd`) | `passwd` (no versionado) | ✅ clave incorrecta → rechazada |
| 4 | ACL por patrón `%u` | `acl` | ✅ dev-0001 publicando como dev-0002 → descartado; el backend no lo recibe |
| 5 | Catálogo de magnitudes con rango físico | `01-esquema.sql` | ✅ 5 magnitudes con `rango_min/max` (el filtro 3 las usará) |
| 5 | Índice único: una sola condición abierta por tipo | `01-esquema.sql` | ✅ definido |
| 7 | `security_opt: no-new-privileges` | `docker-compose.yml` | ✅ ambos servicios |
| 7 | Imágenes con versión exacta (no `latest`) | `docker-compose.yml` | ✅ `2.24.0-pg16`, `2.0.22` |
| 7 | Límites de memoria y CPU | `docker-compose.yml` | ✅ 768 MB / 256 MB; consumo real ≈ 31 MB + 3 MB |
| 8 | Secretos ignorados por git | `.gitignore` | ✅ `git status` no muestra `.env` ni `passwd` |

## 4. Controles pendientes (por tanda)

| Capa | Control | Cuándo |
|---|---|---|
| 2 | Proxy con TLS (Caddy) en 443 y 8883; retirar 1883 | Al desplegar en servidor |
| 3 | Credenciales por dispositivo generadas por la plataforma (flujo de alta, docs/10 §3) | Backend |
| 4 | ACL dinámica: el backend agrega/revoca usuarios del broker al dar de alta/baja | Backend |
| 5 | Filtros 1–4 del pipeline con cuarentena | Backend |
| 6 | Un rol de base de datos para el backend **sin** permiso de `DROP`/`TRUNCATE` | Backend |
| 7 | Sistema de archivos de solo lectura + `tmpfs` donde el servicio lo tolere | Endurecimiento |
| 7 | Escaneo de vulnerabilidades de imágenes (`docker scout` o Trivy) antes de cada entrega | Etapa 3 |
| 8 | Respaldo diario automático de la base (`pg_dump` a un volumen aparte) + prueba de restauración | Antes de datos reales |
| 8 | Límite de conexiones y de tamaño de mensaje en el broker (`max_connections`, `message_size_limit`) | Endurecimiento |

## 5. Operación segura: reglas para no destruir el propio trabajo

**Comandos que borran datos** (conocerlos es la primera defensa):

| Comando | Qué destruye | Regla |
|---|---|---|
| `docker compose down -v` | **Los volúmenes: toda la base de datos** | Nunca sin respaldo previo. `down` sin `-v` es seguro: solo detiene contenedores |
| `docker volume prune` / `docker system prune -a --volumes` | Todos los volúmenes no usados | Nunca en el servidor de producción |
| `docker compose up` tras editar `01-esquema.sql` | Nada: el esquema **solo corre la primera vez** | Los cambios de esquema van por migraciones, no editando este archivo |
| `git push --force` | Historial remoto | Solo con respaldo y decisión explícita |
| `rm -rf` sobre carpetas del proyecto | Trabajo no commiteado | Commitear antes de operaciones de limpieza |

**Hábitos:**

1. `docker compose down` **sin** `-v` para detener. Los datos siguen en los volúmenes.
2. Antes de cualquier operación con `-v`, `prune` o `--force`: respaldo (`pg_dump`) y verificar
   que el respaldo abre.
3. Un `.env` por entorno; **nunca** copiar el de producción al portátil ni al revés.
4. Los secretos se **rotan**, no se recuperan: si una clave se filtró, se genera otra.
5. Leer `git status` y `git diff` antes de cada `add`: es el último filtro antes del repositorio.

## 6. Por qué Docker "sin confinamiento" sigue siendo seguro aquí

La instalación por `apt` (frente a snap) no confina al **motor** de Docker, pero cada **contenedor**
sí está aislado: espacios de nombres propios de procesos, red y sistema de archivos, más las
restricciones de la capa 7. Lo que hay que cuidar es lo que se le **entrega** al contenedor: aquí
solo se montan `db/init` y `mosquitto/config` en modo lectura y los volúmenes de datos; jamás la raíz
del sistema ni el socket de Docker. Un dispositivo malicioso solo puede hablar con el broker, y el
broker solo puede escribir en su propio volumen.

## 7. Gestión de credenciales

**Dónde viven** (nunca en el repositorio):

| Credencial | Archivo | Formato | Quién la usa |
|---|---|---|---|
| Clave de la base de datos | `plataforma/.env` | texto (solo legible por el operador, permisos 600) | TimescaleDB al crearse; el backend |
| Claves MQTT de `sonda` y `backend` | `plataforma/.env` (en claro) **y** `mosquitto/config/passwd` (hash) | el broker compara el hash; el healthcheck y el backend leen el `.env` | broker, healthcheck, backend |
| Claves MQTT de dispositivos | solo `mosquitto/config/passwd` (hash) | el secreto en claro vive únicamente en el firmware del dispositivo | broker |

**Permisos de `passwd`:** dueño `mosquitto` (uid 1883, el usuario con el que corre el broker) y modo
**0640**. Verificado empíricamente (Mosquitto 2.0.22): con dueño `root` el broker **no arranca** —
lee el archivo *después* de soltar privilegios—; con 0644 arranca pero advierte que es legible por
todos. 0640/uid 1883 es la combinación más restrictiva que funciona: solo el broker (y root) lo leen;
el operador necesita `sudo` para verlo, lo cual es deseable. La herramienta `mosquitto_passwd` emite
una advertencia contraria ("owner is not root") porque corre como root: se ignora, manda el broker.

`sonda` es el usuario interno con el que el *healthcheck* pregunta al broker si está vivo; solo puede
leer `$SYS/#` (estadísticas). No es un dispositivo.

**Cómo se generan.** Las claves reales se producen con un generador criptográfico
(`openssl rand -base64 24` → 192 bits de entropía), nunca las elige una persona ni un asistente.
El archivo `passwd` guarda **hashes PBKDF2-SHA512** (prefijo `$7$` en Mosquitto 2.x) con sal
aleatoria por entrada: aunque alguien lea el archivo, no obtiene la clave; y dos usuarios con la misma
clave tienen hashes distintos.

**Cómo se rotan** (una credencial se rota, nunca se "recupera"):

1. Generar la clave nueva con `openssl rand -base64 24`.
2. Si es de `sonda`/`backend`: actualizar `.env` **y** recrear su línea en `passwd`
   (`mosquitto_passwd -b`). Si es de un dispositivo: solo `passwd` y el firmware.
3. `docker compose restart mosquitto` (relee `passwd`); si cambió el `.env`, `docker compose up -d`
   para que el healthcheck tome la clave nueva.
4. Las credenciales de prueba (`dev-*`) se eliminan antes de conectar dispositivos reales.

**Qué NO es respaldo de credenciales:** el repositorio. Git respalda código y configuración; los
secretos y los datos se respaldan aparte (`pg_dump` cifrado, gestor de contraseñas).
