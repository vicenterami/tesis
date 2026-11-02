# Seguridad en capas (defensa en profundidad)

> **Sustenta:** RNF-08, RNF-09, RNF-10, RF-40–RF-42 · Etapa 2 (diseño) y su verificación.
> Principio: **ninguna capa es la única barrera**. Un sensor defectuoso o malicioso, un error
> humano o un servicio comprometido deben quedar contenidos por la capa siguiente.
> Versión: 23 de septiembre de 2026. Cada control marcado ✅ fue probado en el despliegue local.

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
| A7 | **Suplantación de *gateway* LoRaWAN** | El protocolo *Semtech UDP Packet Forwarder* no autentica: cualquiera con el EUI (público) puede enviar UDP al puerto 1700 haciéndose pasar por un *gateway* | Desde el 01/11/2026 la ruta A no usa ese protocolo: la pasarela entra con *Basics Station* por WebSocket sobre TLS, autenticada por token o certificado de cliente (`docs/10 §8.4` punto 56), y el 1700/udp no se publica. El filtro 1 del pipeline autentica cada dispositivo de todos modos, contra el registro, no contra lo que diga el *gateway*. (Hasta el 01/11 la mitigación era el límite de tasa en el proxy y activar el 1700/udp solo en una red local.) |
| A8 | **Backend con permisos de administración del broker** (desde la decisión de credenciales, `docs/10 §8.4` punto 26) | Quien compromete el backend crea o cambia clientes y ACL del broker y suplanta a cualquier dispositivo o pasarela | Identidad de administración distinta de la de lectura, con ACL solo sobre `$CONTROL/#`; archivo del plugin con modo 0600, en el volumen de datos y dentro del respaldo (§7) |
| A9 | **Pasarela comprometida (ruta B)** | Publica con su credencial lecturas falsas por muchos dispositivos a la vez | La pasarela publica solo bajo su tópico (`sitio/<s>/pasarela/<id>/…`, ACL con `%u`) y el filtro 1 toma su identidad del tópico y solo acepta los nodos asociados a ella en el alta (`docs/10 §8.4` puntos 24 y 47): no puede hacerse pasar por un dispositivo de otra vía, y un sitio ajeno o un identificador ya usado se rechazan; revocar su credencial corta a todos de una vez; lo rechazado queda en la cuarentena |

## 2. Las capas, de afuera hacia adentro

```
 Internet / red local
 ─────────────────────────────────────────────────────────────
 [1] Red      · solo 443 / 8883 publicados; en desarrollo 1883 SOLO en 127.0.0.1;
              el backend escucha en 127.0.0.1 fuera de Docker y solo en la red interna dentro del contenedor
 [2] TLS      · cifrado obligatorio en producción (proxy); credenciales nunca en claro por la red
 [3] Identidad· broker sin anónimos; usuario MQTT = id físico del dispositivo; hash en el plugin del broker
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
| 1 | Broker y base publicados solo en `127.0.0.1`, y solo en desarrollo (el archivo base no publica puertos) | `docker-compose.override.yml` | ✅ `docker compose ps` muestra `127.0.0.1:1883` |
| 1 | Base de datos sin `ports` en la forma de producción | `docker-compose.yml` | ✅ el archivo base no la publica |
| 3 | `allow_anonymous false` | `mosquitto.conf` | ✅ publicación anónima → *not authorised* |
| 2 | TLS 1.2+ en el proxy (443 y 8883), HSTS, nada en claro hacia fuera | `proxy/nginx.conf` | ✅ `banco.sh proxy` (07/10): HTTPS → backend, MQTT sobre TLS → medición; sin la CA el cliente rechaza; sin TLS el 8883 rechaza |
| 3 | Credenciales del broker con hash (PBKDF2-SHA512 con sal) en el plugin Dynamic Security, en el volumen de datos (dueño 1883, modo 600; guardián 2i) | archivo del plugin (no versionado; lo crea `pruebas/broker-inicializar.sh`) | ✅ clave incorrecta → *not authorised*; usuario sin clave → rechazado aunque haya anónimos (contenedor desechable, 12/10; `docs/16 §20`) |
| 4 | ACL por rol del plugin: `dispositivo` publica solo en `sitio/+/dispositivo/%u/+`; `recepcion` (backend) solo recibe `sitio/#`; `sonda` solo `$SYS/#`; `pasarela` publica solo bajo `sitio/+/pasarela/%u/#`, salvo en su subárbol de comandos, al que solo se suscribe; los cuatro con negaciones explícitas (otro tópico, `$CONTROL`, cualquier suscripción) y el acceso por defecto del plugin en deny | roles del plugin (`pruebas/lib-dynsec.sh`) | ✅ `banco.sh alta` (12/10): con su credencial, publicar como otro dispositivo → `RC:135`; el usuario `backend` no publica; un anónimo no da órdenes al plugin; laboratorio en `docs/16 §18`; `banco.sh lorawan` (15/10): la pasarela no publica en el árbol de otra ni en sus comandos (`RC:135`) |
| 5 | Catálogo de magnitudes con rango físico | `01-esquema.sql` | ✅ 7 magnitudes con `rango_min/max`, que el filtro 3 usa |
| 5 | Índice único: una sola condición abierta por tipo | `01-esquema.sql` | ✅ definido |
| 7 | `security_opt: no-new-privileges` | `docker-compose.yml` y `proxy/compose.proxy.yml` | ✅ todos los servicios (paso 2n del guardián) |
| 7 | Imágenes con versión exacta y fijadas por digest (no `latest`) | `docker-compose.yml` y los `Dockerfile` | ✅ base `2.30.2-pg16-oss`, broker `2.1.2-alpine`, backend `node:22.23.4-trixie-slim` (parche de seguridad de Node del 21/10/2026, aplicado el 22/10), proxy `nginx:1.30.6-alpine` (parche de nginx del 22/10/2026; 08/10/2026: etiqueta legible + `@sha256`, paso 2u del guardián, que también revisa los guiones; Dependabot propone las actualizaciones con 7 días de espera, `.github/dependabot.yml`, y sus PR de imágenes se prueban en local antes de fusionar, porque el CI no construye imágenes; Trivy y mermaid-cli, fijados en sus guiones, Dependabot no los ve y se revisan a mano cada mes; escaneo en `docs/16 §12`) |
| 7 | Límites de memoria y CPU | `docker-compose.yml` | ✅ 768 / 256 / 512 MB (base, broker, backend); verificado con `docker inspect` que el techo se aplica al contenedor (23/09: 536 870 912 bytes para el backend); consumo real en reposo ≈ 26 + 1,5 + 56 MB |
| 8 | Secretos ignorados por git | `.gitignore` | ✅ `git status` no muestra `.env`; el archivo del plugin del broker vive en un volumen, fuera del árbol |
| 5 | Filtro 1 (autenticar) + cuarentena en el backend | `backend/src/recepcion` | ✅ dispositivo con credencial válida pero **no registrado** → cuarentena `no_registrado`; registrado → aceptado |
| 5 | Texto que llega de afuera (claves de un JSON, el DevEUI del cuerpo, segmentos del tópico) recortado y sin caracteres invisibles o de control antes de ir al registro o al detalle de la cuarentena (el tópico crudo queda en su columna como evidencia); el DevEUI del cuerpo se compara solo si es ASCII (letras, dígitos y guion) | `backend/src/recepcion/texto.ts`, `adaptadores/lorawan.ts` | ✅ pruebas unitarias con saltos de línea, inversión de dirección, espacios invisibles y el signo Kelvin (15/10) |
| 5 | Filtros 2–5 (analizar, validar, normalizar, alertar) y 6 (supervisar) | `backend/src/recepcion`, `alertas`, `supervision` | ✅ 357 pruebas unitarias automáticas en el CI: arranque (interfaz de escucha, `/docs` apagada por defecto, formato de registros), filtro 1 (no registrado, baja), tópico fuera del patrón, filtro 2 (malformada, cuerpo vacío), filtro 3 (canal no declarado, unidad no convertible, fuera de rango), filtro 5 (histéresis: abre a 35, nada a 29, cierra a 27), filtro 6 (vivo aunque haya cuarentena; barrido que no tumba el proceso). Además la tabla manual del README del backend |
| 7 | Dependencias sin scripts de instalación (`ignore-scripts`, `allowBuilds: false`), versiones exactas | `backend/.npmrc`, `pnpm-workspace.yaml` | ✅ `pnpm ignored-builds` lista 4 paquetes con scripts bloqueados explícitamente (`@nestjs/core`, `@scarf/scarf`, `unrs-resolver` y, de forma preventiva desde el 23/10/2026, `@parcel/watcher`, que aún no está en el lockfile: llega con la actualización de jest que propone Dependabot); lockfile pasa políticas de cadena de suministro |
| 2 | **Cabeceras de seguridad HTTP** en el backend (`helmet` 8.3.0): `Content-Security-Policy` con `default-src 'self'`, `X-Frame-Options`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` (cámara, micrófono y ubicación negados). **Sin HSTS a propósito**: solo tiene sentido detrás de TLS y lo pone una sola capa cuando exista el proxy; ponerlo en dos lugares es tener dos fuentes del mismo hecho. `X-Powered-By` retirado: revelaba la pila sin beneficio (26/09/2026) | `backend/src/main.ts` | ✅ revisión de solo lectura con `curl -I`: 5 de 6 cabeceras en `/`, `/docs` y `/dispositivos` (la sexta es HSTS); sin `X-Powered-By`; casos en `api-smoke.sh` |
| 2 | **Documentación interactiva `/docs` (Swagger UI) apagada por defecto**: se sirve solo con `HTTP_DOCS=si` (desarrollo: `.env` y override de Compose). Ausente, vacía o cualquier otro valor = apagada: un servidor que olvide la variable queda cerrado, no abierto. Motivo: en Internet, Swagger UI enumera las rutas y necesita scripts en línea; el contrato que se cita es el `openapi.json` versionado (TT-13). Cuando está activa, solo en `/docs` la CSP permite `'unsafe-inline'` en scripts; el resto de la API mantiene la CSP estricta | `arranque.ts` (`servirDocumentacion`), `main.ts`, `.env.example` | ✅ pruebas unitarias del valor (ausente, vacío, `no`, `si`, ` SI `); `curl` a `/docs` sin la variable → 404; con ella → 200 y CSP propia |
| 7 | Acciones del CI fijadas por SHA y al día: `checkout` v7.0.1, `setup-node` v7.0.0, `pnpm/action-setup` v6.1.0 (fusionadas el 12/10/2026 desde las propuestas del robot de dependencias, con el SHA comprobado contra el tag de cada acción por la API de GitHub); el `action.yml` de cada una se leyó en su tag, no de memoria | `.github/workflows/verificar.yml`, `.github/dependabot.yml` | ✅ las cuatro corridas siguientes en verde; la anotación «Node.js 20 is deprecated» del 23/09 desapareció con el runtime node24 |
| 2 | **Canal de tiempo real (TT-39, SSE): lo que rige en la Etapa 3**, sin sesión y solo en la red local, como la API (§8). Se rechaza (403) la petición que el navegador marca como de otro sitio: `Sec-Fetch-Site` distinto de `same-origin` o `none` (W3C, *Fetch Metadata*; cubre una imagen o un `fetch` «no-cors» de otro sitio, que no mandan `Origin`) o un `Origin` de otro host o puerto. CORS ya impide que esa página lea el flujo (el backend no emite `Access-Control-Allow-Origin`); el control evita además que lo abra y ocupe cupo. **No cubre** el *DNS rebinding* (lo cubre la lista de nombres de host de la fila siguiente) ni a un cliente que no es un navegador. El filtro por dispositivo o canal es comodidad, no autorización: sin sesión, el canal difunde los eventos de todos los dispositivos, igual que la API (la autorización por canal llega con M7, §4). Filtros solo UUID (400). El tope de 50 flujos abiertos (503) es una cota de recursos compartida, no una defensa: un cliente de la red puede agotarla (el límite por IP queda pendiente en el proxy, §4). Un cliente que deja de leer acumula sus eventos en la memoria del backend: detrás del proxy, nginx lo corta tras 60 s sin poder enviarle nada (`send_timeout`, valor por defecto), y sin proxy el backend se publica solo en 127.0.0.1 (desarrollo). El proxy no retiene la respuesta (`proxy_buffering off`, `X-Accel-Buffering: no`) y reenvía el `Host` con su puerto; al apagar se cortan solo las conexiones del canal (una petición normal en curso termina) | `backend/src/tiempo-real/`, `proxy/nginx.conf` | ✅ 22 pruebas en `eventos.spec.ts` (las del bloque «GET /eventos por HTTP» abren HTTP real en 127.0.0.1), cada protección probada a mano plantando su violación (09/10); casos en `api-smoke.sh`; el camino por el proxy, en `docs/16 §14` |
| 2–3 | **Panel servido por el backend bajo `/panel`** (`docs/19`, tramo 2, 12/10/2026): mismo origen que la API, sin CORS en ningún ambiente; corre bajo la misma CSP estricta del backend (`default-src 'self'`): el `index.html` que genera Vite no trae scripts en línea, los paquetes llevan hash en el nombre y **no se publican `.map`**. Como Vite quita los comentarios del código, los avisos de copyright que exige la licencia MIT de `svelte` y `uPlot` viajan en `/panel/avisos-de-terceros.txt` (`panel/public/`), dentro del mismo build (12/10). En desarrollo, el servidor de Vite reenvía las rutas de la API y el canal al backend **sin cambiar el `Host`** (`changeOrigin` en falso), así el control de origen del canal y la lista de hosts actúan igual que en producción. Lo que falta sigue en §4 (CSP con `connect-src` explícito cuando existan todos los flujos) | `backend/panel/vite.config.ts`, `backend/src/main.ts` (`useStaticAssets`), `backend/Dockerfile`, `.dockerignore` | ✅ `pruebas/panel-desarrollo.sh` con el servidor de Vite real y el build servido por el backend: Origin propio por el 5173 → 200 y otro → 403 (el Host llega intacto), Host ajeno → 421, primer byte del canal en menos de 5 s y latido a los 25 s (sin búfer), Vite terminado al salir (el 5173 queda libre), `/panel/` con CSP, paquete con hash 200, `.map` 404, sin scripts en línea; 43 pruebas del panel al cierre del tramo 3 (vitest, 11 por el DOM: 4 del inventario, 7 de la ficha) |
| 3 | **Exportación en CSV y JSON** (`GET /dispositivos/{id}/exportar`, RF-34, 12/10/2026): solo lectura, sin sesión hasta M7 como el resto de la API (red local); en flujo por tandas, nunca el rango entero en memoria; cada celda de texto del CSV con coma, comillas o salto de línea va entrecomillada y una que empieza con `=`, `+`, `-`, `@`, tabulador o retorno se protege con apóstrofo, en toda columna de texto (inyección de fórmulas al abrir el archivo en una planilla; la única columna numérica sale como número o vacía); nombre del archivo saneado; `Cache-Control: no-store`; rango acotado, como mucho 2 exportaciones simultáneas (429), 30 s por consulta en una conexión propia, contrapresión por `drain`, corte de la conexión si falla a mitad de flujo | `backend/src/consulta/exportar.ts`, `dispositivos.controller.ts`, `consulta.service.ts` | ✅ 8 pruebas en `exportar.spec.ts`; 7 casos en `api-smoke.sh`, incluido el instante con microsegundos (`docs/16 §19`) |
| 2 | **Lista de nombres de host permitidos, contra el *DNS rebinding*** (API y canal; `docs/10 §8.4` punto 40, 12/10/2026): el backend acepta `localhost`, `127.0.0.1` y los nombres de `HTTP_HOSTS`; cualquier otro `Host` (el de una página que hace que su nombre resuelva a 127.0.0.1, un subdominio que termina en `localhost`, uno ilegible, ninguno) recibe 421 antes de llegar a una ruta, con el motivo en el registro, un WARN por motivo y por minuto con el conteo de los callados (`AvisosAcotados`; también en el canal en vivo). Se compara el nombre, no el puerto. Un valor de `HTTP_HOSTS` sin forma de nombre detiene el arranque (y, por `depends_on`, el del proxy): es la guarda contra un `PROXY_NOMBRE` con `;` o llaves, que nginx pegaría en su plantilla sin validar. El proxy atiende solo `PROXY_NOMBRE` (`server_name` explícito): otro nombre en el SNI, o una conexión por IP sin SNI, reciben el saludo TLS rechazado (`ssl_reject_handshake`) en 443; el SNI propio con otro `Host`, 421 de nginx sin llegar al backend; en 80, conexión cerrada (444). Su chequeo de salud pide por el nombre con `--resolve`. Lo que no cubre: un cliente que no es un navegador manda el `Host` que quiera; eso lo cubre la sesión (§4) | `arranque.ts` (`hostsPermitidos`, `nombreDeHost`, `rechazoDeHost`), `main.ts`, `proxy/nginx.conf` (plantilla), `proxy/compose.proxy.yml`, `docker-compose.yml`, `.env.example` | ✅ 37 pruebas en `arranque.spec.ts` (19 nuevas: lista y su validación, forma del `Host`, rechazo, avisos acotados; con el rechazo anulado fallan 3); `api-smoke.sh`: 6 casos (ajeno, subdominio, otro puerto, 127.0.0.1, mayúsculas, ilegible); `banco.sh proxy`: nombre ajeno por SNI, por `Host` y por IP, y el puerto 80 (`docs/16 §15`); guardián 2m renderiza la plantilla y exige el `server_name` en 443 y 80 |
| 2–4 | **Clave de administrador por cabecera en las rutas que escriben** (`POST /dispositivos`, `DELETE /dispositivos/{id}` y `POST /dispositivos/{id}/credencial`; `docs/10 §8.4` punto 41, 12/10/2026): `X-Clave-Admin` comparada en tiempo constante (sobre hashes, así ni el largo se filtra por el reloj) con `HTTP_CLAVE_ADMIN` del `.env`: 24 caracteres o más (más corta, el backend no arranca; ausente, 503 y nunca abierta); ausente, repetida o distinta → 401 con el mismo mensaje y un aviso acotado en el registro; la guardia corre antes de la validación del cuerpo. Una cabecera propia que el navegador no pone solo: una página de otro sitio no puede disparar la petición sin una verificación previa de CORS que este backend no concede (CSRF, `docs/20`) | `backend/src/alta/clave-admin.guard.ts`, `arranque.ts` | ✅ 5 pruebas en `clave-admin.guard.spec.ts` (incluida la cabecera repetida tal como la une Node: «, ») y 4 en `arranque.spec.ts`; humo: sin cabecera, con otra y repetida → 401 o 503; `banco.sh alta`: 401 ×2, 400 ×2, 409, 201 |
| 2–4 | **Recepción por HTTP** (`POST /recepcion/{id_fisico}`, RF-01, HU-01; `docs/10 §8.4` punto 52, 16/10/2026): token por dispositivo en `Authorization: Bearer` contra su huella `scrypt` (comparación en tiempo constante y una huella calculada igual si el dispositivo no existe); 401 único sin revelar el motivo; topes por el costo medido de `scrypt` (65 ms): caché de verificaciones (sin `scrypt` para un token ya verificado contra la misma huella), 5 fallos en 60 s bloquean el par dirección + dispositivo 60 s, 50 fallos en 60 s bloquean las verificaciones desde la dirección, 2 verificaciones a la vez, una trama por segundo por dispositivo; 64 KiB como el broker. La dirección del cliente sale de `X-Forwarded-For` solo si la petición trae el secreto compartido del proxy en `X-Proxy-Secreto` (`PROXY_SECRETO`, comparación en tiempo constante); sin él, la del *socket* | `backend/src/recepcion/http/`, `proxy/nginx.conf`, `main.ts` | ✅ 16/10/2026; caché, par, tope grueso y secreto el 17/10 (`docs/16 §41` y §42) |
| 1–4 | **Tope por emisor en todas las vías** (`docs/10 §8.4` punto 53, 17/10/2026): presupuesto de lecturas por dispositivo y hora (`max(600, 10 × canales × ⌈3600/intervalo⌉)`), la trama que no cabe se rechaza entera (cuarentena `tope`, condición `tope_superado`); cuota de 60 tramas en cuarentena por dispositivo y hora, las demás solo se cuentan; contadores persistentes en `estado_dispositivo` (migración 19). Vías con tope: MQTT directo, MQTT por pasarela y HTTP; todas entran por `filtros2a6` (guardián 2z2) | `backend/src/recepcion/recepcion.service.ts`, `cuota.ts`, migración 19 | ✅ 17/10/2026 (`docs/16 §42`) |
| 2–4 | **Sin `NET_RAW` en ningún contenedor** (`cap_drop`; el backend suelta todas las capacidades: corre como `node`): suplantar una dirección dentro de la red de Docker exige esa capacidad, y ningún servicio la necesita | `docker-compose.yml`, `proxy/compose.proxy.yml` | ✅ 17/10/2026 (banco: los cuatro sanos) |
| 3–4 | **Alta por API, todo o nada** (`docs/10 §3`, HU-11, 12/10/2026): dispositivo, canales, hash de la credencial y evento en una transacción; el cliente del broker se crea dentro de ella, con su rol en un solo comando; sin respuesta del broker en 5 s, nada queda creado y se ordena borrar el cliente por si llegó a crearse (error ambiguo); un rechazo explícito del plugin no borra nada; si la base no confirma después, el cliente se borra; dos altas simultáneas del mismo identificador se serializan en la base (bloqueo por identificador, migración 11) y la segunda recibe 409; como mucho dos altas a la vez (429) e `idle_in_transaction_session_timeout` de 15 s, porque la espera al broker retiene una conexión del pool; un cliente huérfano en el broker da 409 con el remedio, sin corregirse solo; la administración se declara disponible solo después de suscribirse a las respuestas. La credencial (24 bytes aleatorios, base64url) se muestra una vez, con `Cache-Control: no-store`; la base guarda solo `scrypt` (N = 2¹⁵, r = 8, sal de 16 bytes) y ningún registro la escribe; los nombres del sistema (`backend`, `backend-admin`, `sonda`, `admin`) no pueden ser un dispositivo | `backend/src/alta/`, `broker/dynsec*.ts` | ✅ 13 pruebas en `alta.service.spec.ts`, 8 en `alta.dto.spec.ts`, 4 en `credenciales.spec.ts`, 6 en `dynsec.spec.ts`; `banco.sh alta`: 19 comprobaciones (`docs/16 §20`) |
| 2–4 | **Límite de tasa por dirección en el proxy** (22/10/2026): 443, `limit_req` general de 100 r/s con ráfaga 200 (el doble de las 50 tramas/s de RNF-01, que un NAT o una pasarela puede enviar por HTTP desde una sola dirección) y de administración de 5 r/s con ráfaga 10 para los métodos que escriben sobre `/dispositivos`, `/pasarelas` y `/canales` (alta, baja, rotación, calibración; frena también los intentos de adivinar `X-Clave-Admin`); exceso → 429 y registro; 8883, `limit_conn` de 100 sesiones por dirección (el doble de los 50 canales del caso de validación), la 101 se corta antes del apretón TLS; en HTTP, `limit_conn` de 100 peticiones en curso por dirección y de 20 flujos `/eventos` por dirección (revisión del 22/10: antes una dirección podía tomar los 50 flujos del backend). La zona de administración no distingue mayúsculas, como el enrutador de Express. La dirección 127.0.0.1 del propio contenedor (chequeo de salud) queda exenta. Fundamento de cada número en los comentarios de `nginx.conf` | `plataforma/proxy/nginx.conf` | ✅ 22/10/2026 (`banco.sh proxy` + `pruebas/banco/proxy-limites.sh`, 23/23 tras la revisión del mismo día y la calibración por API: se plantan también las mayúsculas, `/eventos` con sus variantes y el tope HTTP: se plantan la ráfaga sobre cada zona y las 101 sesiones, y se comprueba que pasan 50 tramas/s, las lecturas, la recepción, 100 sesiones y otra dirección; `docs/16 §47`) |

## 4. Controles pendientes (por tanda)

| Capa | Control | Cuándo |
|---|---|---|
| 1 | **Red privada de administración** (01/11/2026, `docs/10 §8.4` punto 55, `docs/14 §7`): SSH y los puertos de personas (443 y 80) se publican solo en la dirección de la red privada WireGuard del operador; la cuenta del servicio de coordinación con segundo factor; aprobación manual de cada equipo nuevo; la llave del servidor sin vencimiento automático (si vence, el servidor desaparece de la red sin aviso); WireGuard propio preparado para cuando la institución reenvíe un puerto UDP | Servidor de prueba (11/2026) |
| 8 | **Vigilante externo por latido** (01/11/2026, `docs/14 §7.2`): la URL del chequeo es un secreto de operación (quien la tenga puede silenciar la alarma o fingir que todo va bien): en un archivo con permisos 600 del usuario operador, fuera del repositorio y del guion; se regenera desde el servicio si se filtra; la cuenta del servicio con segundo factor; el canal de mensajería solo recibe avisos, nunca órdenes | Servidor de prueba (11/2026) |
| 2 | **Fechas de validez del certificado en el nodo ESP32** (19/10/2026): el TLS del núcleo Arduino-ESP32 compila mbedTLS sin `MBEDTLS_HAVE_TIME_DATE` y no revisa `notBefore`/`notAfter`, así que un certificado o una CA vencidos se aceptarían (`docs/17 §6.2`). Aceptado en desarrollo (CA propia, certificado de 398 días); antes de producción, un núcleo con esa opción activa o una comprobación propia de la fecha tras NTP | Etapa 4 |
| 2 | Proxy **nginx** (decidido el 06/10/2026, `docs/10 §8.4` punto 10) con TLS en 443 y 8883, variante A. **Capa implementada el 07/10** (`plataforma/proxy/`: TLS 1.2+, HSTS, registro JSON, resolución dinámica del nombre) y probada de punta a punta en el banco (`banco.sh proxy`). Falta: certificado del servidor (por decidir, `docs/10 §8.4` punto 22), y, en producción, no publicar el 1883 (hoy solo lo publica el override de desarrollo) | Etapa 3 (despliegue) |
| 1 | **Registros de Docker acotados**: `logging` `json-file` con `max-size 10m` y `max-file 5` en cada servicio, proxy incluido (techo 50 MB por servicio; sin límite, el chequeo de salud del broker sumaba ≈ 395 MB/año medidos). Guardián paso 2n | ✅ 07/10/2026 |
| 2 | ~~**Cola del broker acotada y vigilada:** `max_queued_messages`, `max_queued_bytes` y `autosave_interval` explícitos en `mosquitto.conf`, con alarma sobre el contador de descartes~~ → hecho el 13/10/2026: 10 000 mensajes, 20 MB, 300 s; muestra por minuto en `metrica_broker` y condición del sistema `broker_descarte` (`docs/10 §8.4` punto 43, migración 13; plantado en `banco.sh cola`) | ✅ |
| 2–4 | **Límite de tasa en dos capas:** en el proxy, por dirección, **hecho el 22/10/2026** (fila de §3: `limit_req` general y de administración, `limit_conn` en el 8883; incluye el límite estricto de 5 r/s con ráfaga 10 para `POST /dispositivos` y las demás rutas que escriben). **Queda** `@nestjs/throttler` en el backend, por usuario y ruta, que necesita la sesión: con M7. Los topes propios de la recepción por HTTP (`docs/10 §8.4` punto 52, 16 y 17/10) y el tope por emisor de todas las vías (punto 53, 17/10) rigen desde antes, más las cabeceras de `helmet` (§3) | Proxy ✅ 22/10/2026; backend, Etapa 3 con M7 |
| 2–4 | **Dos valores vigentes al rotar `PROXY_SECRETO` y `HTTP_CLAVE_ADMIN`** (22/10/2026, tabla de rotación de §7): aceptar el anterior durante una ventana, como ya hace el broker con `MQTT_ADMIN_CLAVE_ANTERIOR`, para que la rotación no corte ni siquiera segundos | Etapa 4 |
| 8 | **Telemetría de TimescaleDB:** la extensión trae un trabajo `policy_telemetry` que cada 24 h envía estadísticas de uso a su fabricante (visto en `timescaledb_information.jobs` el 27/09). Decidir si se apaga (`timescaledb.telemetry_level=off`) | Antes de datos reales |
| 2 | ~~Puerto 1700/udp hacia ChirpStack, con límite de tasa en el proxy~~ → **descartado el 01/11/2026** (`docs/10 §8.4` punto 56): la ruta A entra por 443 con *Basics Station* (WebSocket sobre TLS). Queda, para cuando ChirpStack se despliegue, la ruta del WebSocket en el proxy con autenticación de la pasarela por token o certificado de cliente (CA de pasarelas) | Cuando ChirpStack se despliegue (no antes) |
| 3 | ~~Credenciales por dispositivo generadas por la plataforma (flujo de alta, docs/10 §3)~~ → hecho el 12/10/2026 (`POST /dispositivos`, §3) | ✅ |
| 4 | ~~ACL dinámica: el backend agrega/revoca usuarios del broker al dar de alta/baja~~ → el alta, hecha el 12/10/2026 (plugin Dynamic Security, `docs/10 §8.4` punto 42); la baja y la rotación por API, con las mismas órdenes, el 13/10/2026 (`DELETE /dispositivos/{id}`, `POST /dispositivos/{id}/credencial`; `docs/10 §3`) | ✅ |
| 6 | ~~Un rol de base de datos para el backend **sin** permiso de `DROP`/`TRUNCATE`~~ → hecho el 13/10/2026: `plataforma_app`, SELECT en todo, INSERT en 11 tablas y UPDATE en 5 (migración 14, §9); desde la migración 16 también INSERT en `pasarela` y UPDATE solo de su columna `activo`, y desde la 21 UPDATE solo de `escala_cero` y `escala_cien` en `canal` (calibración por API) | ✅ |
| 5 | ~~`cuarentena.motivo` sin `CHECK`~~ → hecho el 23/09 (migración 07): dominio cerrado como `dispositivo.estado` y `condicion.tipo`, probado insertando un motivo inventado | ✅ |
| 1 | Backend en contenedor: escucha en la red interna (`HTTP_INTERFAZ=0.0.0.0`) **sin** `ports`; solo el proxy lo alcanza (`docs/10 §6`) | Dockerfile |
| 2–3 | Canal de tiempo real hacia el panel (TT-39; **SSE**, decidido el 06/10/2026, `docs/10 §8.4`), **lo que falta** (lo que ya rige está en §3): solo HTTPS vía proxy al publicarlo, con la misma cookie de sesión que la API (el navegador la envía sola en `EventSource`); autorización por canal antes de enviar el primer evento; ningún token en la URL; límite de flujos abiertos por usuario y de tasa. Al ser unidireccional, no hay mensajes entrantes que validar. Lo de OWASP para WebSocket (*WebSocket Security Cheat Sheet*) queda para el caso en que se agregue uno | Etapa 4, con M7 (HU-18) |
| 2 | ~~Lista de nombres de host permitidos, contra el *DNS rebinding* (API y canal)~~ → hecho el 12/10/2026: backend (421) y proxy (`server_name` + saludo TLS rechazado), §3 y `docs/10 §8.4` punto 40 | ✅ |
| 2–4 | **Clave de administrador por cabecera para las rutas que escriben, hasta la sesión** (`docs/10 §8.4` punto 41, decidido el 12/10/2026): `X-Clave-Admin` = `HTTP_CLAVE_ADMIN` del `.env` (la escribe la persona); ausente en el `.env` → 503 en esas rutas (cerrado por omisión); sin cabecera o distinta → 401 con aviso acotado; comparación de tiempo constante; se retira con M7. Primera ruta: `POST /dispositivos` (HU-11) | ✅ 12/10/2026: implementada, ver §3 |
| 2–4 | **Sesión del panel y control de acceso (M7, HU-18, RF-41, RF-43), decidido antes del código** (diseño completo en `docs/20`, borrador del 12/10/2026): cookie `HttpOnly; Secure; SameSite=Lax`, con el panel servido por el backend (mismo origen), `Secure` **no** atado a `NODE_ENV`; JWT dentro de esa cookie es compatible, nunca en `localStorage`. Con mismo origen no hace falta CORS en producción y el CSRF queda contenido por `SameSite`; en desarrollo, el servidor de Vite reenvía la API y el canal al backend (`server.proxy`), así que el navegador también ve un solo origen y no hace falta CORS en ningún entorno (ajuste del 09/10, con TT-39: antes decía CORS con lista blanca en desarrollo). Antes de implementar, una **matriz de acceso** `ruta × rol → código esperado` escrita desde RF-41 (pedir un dispositivo de otro sitio → 403 o 404, nunca los datos) y RF-43, con un usuario de prueba por rol; la matriz se convierte en casos de `api-smoke.sh` | Etapa 4, antes de M7 |
| 2 | **CSP definitiva ahora que existe el panel** (`script-src 'self'`, `connect-src 'self'`: el tiempo real va por SSE, sobre HTTP, y no necesita `wss:`): primero en `Content-Security-Policy-Report-Only`, con una lista escrita de los flujos que la ejercitan (gráficos, exportación, canal en vivo) que se repite en cada cambio. Probar con el panel servido por el backend o la imagen real: el servidor de desarrollo de Vite no aplica ninguna cabecera. Los `.map` de Vite no se publican | Etapa 3 (TT-39, panel) |
| 7 | Sistema de archivos de solo lectura + `tmpfs` donde el servicio lo tolere | Endurecimiento |
| 7 | **Análisis de dependencias (SCA):** `pnpm audit --audit-level=high` en el CI, sobre todo el árbol (también las herramientas de desarrollo: corren en el portátil y en el CI, y un compromiso ahí también es un compromiso). Estado al 23/09/2026: 22 avisos (10 altos), todos en dependencias transitivas de NestJS y su CLI (`multer`, `path-to-regexp`, `lodash`, `glob`, `picomatch`…); tipos, lint y pruebas estaban en verde, así que «verde» no incluía dependencias. Corrección aplicada el mismo día (probada antes en una copia): actualizar NestJS a 11.2.5 (no a 11.2.6, publicada ese día: pnpm 12 no instala versiones con menos de 24 h por defecto, `minimumReleaseAge`, y esa guardia no se salta) y la CLI a 11.0.24 baja a 7 avisos; tres *overrides* (`ajv ≥ 8.18`, `multer ≥ 2.3`, `picomatch ≥ 4.0.4`) dejan 0, con las 22 pruebas en verde. El paso queda en el CI para que no vuelva a pasar en silencio. **08/10/2026:** rojo sin cambio del lockfile por avisos publicados después del 27/09; corregido (cifras y avisos en `docs/16 §12`). Única excepción: GHSA-vfj7-8cjw-p6xm (`braces`, alto, solo de jest), declarada en `audit.ignore` de `plataforma/backend/pnpm-workspace.yaml`; el CI la muestra como advertencia amarilla, comprueba aparte que producción no tenga ningún aviso (ni siquiera exceptuado) y el guardián (paso 2q) falla el día que salga el parche o que GitHub retire el aviso. **26/10/2026:** GitHub la retiró el 23/10 (`withdrawn_at`); se quitó la excepción y la auditoría queda en cero sin excepciones (`docs/16 §56`) | ✅ 23/09/2026 · sin excepciones desde el 26/10/2026 |
| 7 | **Imágenes de contenedor:** escaneo con Trivy fijado por digest, desechable y sin acceso a Docker (`plataforma/pruebas/escanear-imagenes.sh`), antes de desplegar y al cambiar una imagen. Resultado del 08/10/2026 y lo que se corrigió: `docs/16 §12`. Residuo documentado: `gosu` en la imagen de la base (binario de Go precompilado que el arranque usa para bajar privilegios; no recibe datos de afuera) | ✅ 08/10/2026 · residuo documentado |
| 8 | **Escaneo de secretos** en el CI con la herramienta `gitleaks` (licencia MIT: https://github.com/gitleaks/gitleaks), ejecutada directamente con su imagen fijada por digest y **no** con la acción `gitleaks/gitleaks-action`, que desde la v2 dejó la licencia MIT por un acuerdo de licencia propio (https://github.com/gitleaks/gitleaks-action#license-change); además del `.gitignore` y del hook local: detecta una clave que se cuele en un commit antes de que el repo sea público. Al publicarlo, GitHub activa además su *secret scanning* por defecto. Mientras tanto, pasada manual del árbol y el historial antes de cada entrega (`docs/16 §55`) | Antes de publicar el repo |
| 5 | **Análisis estático (SAST)** del backend: reglas de seguridad de ESLint y, cuando el repo sea público, *code scanning* con CodeQL (GitHub lo habilita por defecto en repositorios públicos; en privados exige licencia) | Etapa 3 |
| 8 | Respaldo diario automático de la base (`pg_dump` a un volumen aparte) + prueba de restauración | Antes de datos reales |
| 2–5 | **Alta masiva por archivo y bandeja de detectados (`docs/04 §8`, bloque 2; revisión del 28/10/2026): controles que se diseñan antes del código.** Las credenciales generadas se muestran una sola vez, con `Cache-Control: no-store`, y ningún registro las escribe (como en el alta individual); el CSV de filas rechazadas lleva la misma protección contra inyección de fórmulas que `exportar.ts`; tope de tamaño y de filas en el proxy y en el backend; una carga a la vez por sitio (429 a la segunda); todo o nada por archivo, o una semántica parcial declarada en la respuesta; XLSX solo con una biblioteca auditada y con la antigüedad mínima. | Etapa 4, bloque 2, antes de escribir el código |
| 8 | ~~Tope de lecturas por trama en el adaptador~~ → hecho el 17/10/2026 como tope por emisor y por hora, en todas las vías (`docs/10 §8.4` punto 53; §3). El tope de tamaño **ya rige**: `max_packet_size 65536` (07/10, `docs/10 §8.4` punto 19; guardián paso 2l). **Quedan:** el límite de conexiones en el broker (`max_connections`, hoy sin fijar) y un tope de mensajes retenidos por emisor, que el broker guarda sin límite (`docs/10 §8.4` punto 50) | Endurecimiento |

## 5. Operación segura: reglas para no destruir el propio trabajo

**Antes de aceptar un cambio de código** (propio, de una biblioteca, de un ejemplo o de una herramienta),
cinco preguntas; si alguna no tiene respuesta, el cambio no entra:

| # | Pregunta | Dónde se responde en este proyecto |
|---|---|---|
| 1 | **Concurrencia:** ¿qué pasa si corre mientras otro está usando los datos? | Índice único `(canal_id, tiempo)` + `ON CONFLICT`; una condición abierta por tipo (`docs/08 §6`) |
| 2 | **Reejecución y fallo a medias:** ¿qué pasa si corre dos veces o se corta a la mitad? | Inserción idempotente; migraciones repetibles; entrega «al menos una vez» (`docs/10 §4.1`) |
| 3 | **Verificación:** ¿cómo sé que funcionó, más allá de que no dio error? | Guardianes que se prueban plantando la violación (`verificar-todo.sh`); un archivo generado se abre |
| 4 | **Entorno hostil:** ¿qué pasa si la base, la red o el broker no están? | Tabla de caídas de `docs/10 §4.1`; si cae la base: reintentos, sin confirmación y reconexión, el broker reenvía (decisión 4, 07/10; probado con cliente falso en `broker.service.spec.ts`) |
| 5 | **Comprensión:** ¿puedo explicar esta línea a otra persona sin releerla? | Los comentarios del backend explican el *porqué*; lo que no se entiende no se acepta |

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

**Pasarelas de terceros (22/10/2026).** Tras cualquier cambio en una pasarela Milesight (hora, red, aplicación), mirar el «Status» de su
aplicación MQTT: el 20/10, al corregir la hora de la UG65, su cliente cerró la sesión y no reconectó solo hasta guardar la aplicación de
nuevo (`docs/16 §45`). Del lado del sistema lo único visible es la alarma de silencio de sus nodos, que no es una falla propia; por eso
el laboratorio de campo termina siempre comprobando ese estado en la pasarela, no solo el inventario del panel.

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
| Claves MQTT de `sonda`, `backend` y `backend-admin` (24 caracteres o más) | `plataforma/.env` (en claro) **y** el archivo del plugin del broker (hash), en el volumen `datos-mosquitto` | `pruebas/broker-inicializar.sh` las copia del `.env` al plugin y comprueba que entran (repetirlo = rotar `backend` y `sonda`; la del administrador, con `MQTT_ADMIN_CLAVE_ANTERIOR`); el chequeo de salud y el backend leen el `.env` | broker, chequeo de salud, backend |
| Claves MQTT de dispositivos | el archivo del plugin (hash) y `credencial.hash` en la base (`scrypt`) | las crea el backend en el alta y las muestra una sola vez; el secreto en claro vive únicamente en el firmware | broker (autentica), backend (crea en el alta, rota y borra desde el 13/10) |
| Clave de administrador de la API (`HTTP_CLAVE_ADMIN`) | `plataforma/.env` | la cabecera `X-Clave-Admin` se compara en tiempo constante; 24 caracteres o más; se retira con la sesión (M7) | backend |

**Hecho el 12/10/2026** (`docs/10 §8.4` puntos 26, 41 y 42; laboratorio en `docs/16 §18`): las credenciales de **todos** los
usuarios del broker viven en el plugin Dynamic Security de Mosquitto 2.1.2 y el backend las administra por
`$CONTROL/dynamic-security/v1` (crea en el alta, borra en la baja y rota con `POST /dispositivos/{id}/credencial`, desde el 13/10/2026), sin reiniciar el
broker. La credencial depende de la vía (`docs/10 §8.4` punto 25): `mqtt`, usuario y clave; `http`, un token (la recepción por
HTTP llega después; el token ya queda registrado como hash); `lorawan`, ninguna propia (la autentica su pasarela). La identidad
que administra el broker (`backend-admin`, rol `admin` del plugin) es distinta de la que lee los datos (`backend`, rol
`recepcion`), con conexión propia y sesión limpia; una sola instancia del backend, como con `backend`. El archivo del plugin vive
en el volumen de datos con dueño 1883 y modo 600 y va dentro del respaldo (amenaza A8, §1). Sin ese archivo el broker no arranca,
a propósito.

**Pasarelas y servidores de red externos** (`docs/10 §8.4` punto 47; hecho y probado en el banco el 15/10/2026, `docs/16 §30–§31`): se registran por `POST /pasarelas`
con la misma guardia y el mismo todo-o-nada que un dispositivo, y reciben usuario (su identificador) y clave una sola vez. Su rol
`pasarela` publica solo bajo `sitio/+/pasarela/%u/#`, salvo en su propio subárbol de comandos, donde una negación de prioridad mayor
se lo impide (no puede mandarse órdenes a sí misma; `banco.sh lorawan`, RC:135), y **puede suscribirse solo a ese subárbol**
(`sitio/+/pasarela/%u/+/command/#`): la integración MQTT de ChirpStack se suscribe a su tópico de comandos aunque nunca se le mande
nada («This is the topic on which the MQTT subscribes for receiving (enqueue) commands»,
https://www.chirpstack.io/docs/chirpstack/configuration.html, consultada el 15/10/2026); cómo reacciona si se le niega no está
documentado, así que se le permite y queda por probar en terreno; todo lo demás, negado explícito. Baja y rotación con las mismas órdenes que un dispositivo; al dar de baja una pasarela, sus nodos quedan sin quien publique
por ellos y lo que llegue va a cuarentena. `GET /pasarelas`, como `GET /dispositivos`, es de lectura sin sesión hasta M7 y devuelve el
identificador de cada pasarela, que es también su usuario del broker: da nombres de usuario válidos, nunca sus claves (las protege su entropía:
24 bytes aleatorios; el broker no limita intentos y el proxy limita a 100 sesiones simultáneas por dirección en el 8883 (§3) y el broker no limita intentos); deja de ser público con
la sesión.

**Permisos del archivo del plugin:** dueño `mosquitto` (uid 1883) y modo **0600**: el plugin lo reescribe en cada cambio, así que
debe ser suyo. Con dueño `root` el plugin arranca con una configuración vacía y rechaza a todos, hasta al administrador
(observado el 12/10 en un contenedor desechable: «Not authorized» sin más pistas en el registro). El guardián (paso 2i) comprueba
dueño y modo, que `mosquitto.conf` ya no lea archivos de claves y que existan los roles y clientes del sistema, leyendo solo
nombres, nunca hashes.

`sonda` es el usuario interno con el que el *healthcheck* pregunta al broker si está vivo; solo puede
leer `$SYS/#` (estadísticas; rol `sonda`). No es un dispositivo.

**Cómo se generan.** Las claves del sistema se producen con un generador criptográfico (`openssl rand -base64 24` → 192 bits de
entropía) y las de los dispositivos las genera el backend (24 bytes aleatorios, base64url); nunca las inventa una persona: la del rol de la
aplicación (`DB_APP_CLAVE`) la genera `openssl` y la persona solo la pega en el `.env`. El plugin guarda **hashes PBKDF2-SHA512** con sal aleatoria por cliente (`encoded_password` en su archivo): aunque
alguien lea el archivo, no obtiene la clave, y dos clientes con la misma clave tienen hashes distintos. La base guarda, además,
`scrypt` del secreto de cada dispositivo (`credencial.hash`): es lo que verifica la vía HTTP (desde el 16/10, `docs/10 §8.4` punto 52) y lo que permite auditar sin tocar
el broker.

**Cómo se rotan** (una credencial se rota, nunca se «recupera»):

1. Generar la clave nueva con `openssl rand -base64 24`.
2. Si es de `sonda` o `backend`: actualizar `.env` y repetir `bash pruebas/broker-inicializar.sh`, que fija en el plugin la clave
   del `.env` y comprueba que entra; después `docker compose up -d` para que el chequeo de salud y el backend tomen la nueva. Si es
   de `backend-admin`: la vigente va a `MQTT_ADMIN_CLAVE_ANTERIOR` y la nueva a `MQTT_ADMIN_CLAVE`; el guion entra con la anterior,
   fija la nueva y avisa que se borre la anterior del `.env`. Si es la del rol de la aplicación (`DB_APP_CLAVE`): cambiarla en el
   `.env`, correr `bash plataforma/pruebas/base-rol-app.sh` (la fija en la base y prueba que entra) y reiniciar el backend.
3. Si es de un dispositivo: `bash pruebas/broker-cliente.sh <id>` (sin reiniciar nada: el plugin la aplica en el acto) y el
   firmware; por la API, `POST /dispositivos/{id}/credencial` (13/10/2026) devuelve la nueva una sola vez y deja sin efecto la anterior.
4. Las credenciales de prueba (`dev-*`) se eliminan con `--borrar` antes de conectar dispositivos reales.

**Calendario y procedimiento de rotación: antes, durante y después de producción (22/10/2026).** Rotar es un procedimiento, no una
promesa: cada secreto tiene un momento, un comando, una forma de probar que entró y un rastro. Lo que hoy corta el servicio unos segundos
queda dicho; lo que no corta, también.

| Secreto | Antes del primer despliegue | Periódica (en producción) | Ante un incidente | Cómo (sin inventar nada: los guiones de arriba) | ¿Corte? | Rastro |
|---|---|---|---|---|---|---|
| Credencial de cada dispositivo y pasarela (broker, hash en el plugin; `scrypt` en la base para la vía HTTP) | se borran las `dev-*` y se crean las reales en el alta | no se rota por calendario (reconfigurar un nodo en terreno cuesta más de lo que protege: 24 bytes aleatorios); sí al cambiar de dueño o de firmware | de inmediato: `POST /dispositivos/{id}/credencial` o `POST /pasarelas/{id}/credencial`; la anterior deja de valer en el acto | API (una sola vez por pantalla) o `broker-cliente.sh` | solo ese nodo, hasta que reciba la nueva | fila en `evento` con instante y origen (`docs/08`) |
| `backend` y `sonda` (broker) | sí, en el servidor, con `openssl rand -base64 24` | cada 6 meses | de inmediato | `.env` → `broker-inicializar.sh` (fija y comprueba) → `docker compose up -d` | segundos (el backend se recrea; el broker guarda la sesión persistente y entrega lo pendiente al volver: `docs/16 §11`) | bitácora de operación (fecha, quién, qué), nunca el valor |
| `backend-admin` (broker, rol `admin`) | sí | cada 6 meses | de inmediato | la vigente a `MQTT_ADMIN_CLAVE_ANTERIOR`, la nueva a `MQTT_ADMIN_CLAVE` → `broker-inicializar.sh` → borrar la anterior del `.env` | ninguno (el guion entra con la anterior y fija la nueva) | ídem |
| `DB_APP_CLAVE` (rol de la aplicación en la base) | sí | cada 6 meses | de inmediato | `.env` → `base-rol-app.sh` (fija y prueba) → reiniciar el backend | segundos | ídem |
| Clave del superusuario de la base (`DB_CLAVE` en el `.env`, que el compose pasa como `POSTGRES_PASSWORD`) | sí | anual | de inmediato | `ALTER ROLE … PASSWORD` dentro del contenedor y el `.env`; solo la usan migraciones y respaldos | ninguno (el backend no la usa) | ídem |
| `HTTP_CLAVE_ADMIN` (cabecera `X-Clave-Admin`) | sí | cada 3 meses, y se **retira** con la sesión (M7, RF-44) | de inmediato | `.env` → reiniciar el backend; quien la usa la recibe por un canal que no sea el chat | segundos | ídem |
| `PROXY_SECRETO` (cabecera `X-Proxy-Secreto`, `docs/10 §8.4` punto 52) | sí (el de desarrollo nunca viaja al servidor) | cada 6 meses | de inmediato | `.env` → `docker compose up -d --force-recreate proxy backend` (el mismo valor en los dos) | segundos; mientras difieren, el backend no cree en `X-Forwarded-For` y lo anota (acotado) | ídem |
| Certificado del servidor (443 y 8883) | se emite el real: ACME con renovación automática o CA institucional (`docs/10 §8.4` punto 22; en el servidor de prueba, la CA propia del servidor del punto 55) | **automática** cada 60–90 días con ACME; con CA institucional, según su vigencia | revocar y reemitir; reiniciar el proxy | el proxy recarga el certificado sin cortar sesiones (`nginx -s reload`) | ninguno con `reload`; las sesiones MQTT vivas siguen con el certificado con que saludaron | registro del proxy y bitácora |
| Raíz de confianza en los clientes (`ca.crt` en pasarelas; raíz en el firmware del nodo) | la CA propia es de desarrollo o del servidor de prueba (una CA distinta por entorno, `docs/10 §8.4` punto 55); en producción los clientes confían en la raíz pública (ACME) o en la institucional, instalada una vez | solo cuando cambia la CA (años), no en cada renovación del certificado: la raíz no cambia | si la CA se compromete: reemitir y reinstalar en cada pasarela y nodo | pasarela: TLS → CA File; nodo: nuevo firmware (`docs/17 §6.2`) | por cliente, hasta que reciba la raíz nueva | bitácora, con la lista de clientes actualizados |

Tres reglas que atraviesan la tabla: (1) **se rota, nunca se «recupera»**: ningún secreto se puede leer de vuelta; (2) **la prueba es parte de
la rotación**: cada guion comprueba que la credencial nueva entra antes de dar por hecho el cambio, y una rotación de dispositivo se verifica
viendo su siguiente trama en el inventario; (3) **el rastro no lleva el valor**: fecha, quién y qué, nunca la clave ni el hash. Lo que falta para
que ninguna rotación corte: aceptar dos valores de `PROXY_SECRETO` y de `HTTP_CLAVE_ADMIN` durante una ventana (como ya hace el broker con
`MQTT_ADMIN_CLAVE_ANTERIOR`); queda como mejora de la Etapa 4 (fila de §4).

**Por qué se muestra una sola vez, y qué pasa si se pierde.** La plataforma guarda solo el hash: la clave
no existe en ninguna parte del servidor, así que nadie puede «pedirla de nuevo», ni el usuario ni un
atacante. Si se pierde, se rota; el costo es operativo (reconfigurar el dispositivo), no de seguridad.
Quién puede rotar es el control que importa: hoy, solo quien tiene acceso a la terminal del servidor; desde
M7, un usuario con rol de administración y sesión iniciada (RF-44). Cómo decide el broker: al **conectarse**
un cliente, compara su clave con el hash del plugin; en cada **publicación** y **suscripción** consulta las ACL de su rol (§3, capa 4), y lo
no permitido se responde «no autorizado» (`RC:135` en MQTT 5) sin llegar a nadie.

**Cómo se tocan las credenciales sin romper nada (27/09 y 12/10/2026).** El broker monta su configuración en solo lectura y el
archivo del plugin vive en un volumen: nada se edita a mano. Para el sistema, `bash plataforma/pruebas/broker-inicializar.sh`
(repetible): crea el archivo sin broker, en un contenedor auxiliar que monta el volumen en `/c` y entra directo a la herramienta
(`--entrypoint`), nunca en `/mosquitto`: el arranque de la imagen, como root, hace `chown -R` sobre `/mosquitto` y el 27/09 le
cambió el dueño a los archivos del portátil. Para un dispositivo, `bash plataforma/pruebas/broker-cliente.sh <id>` (o
`--borrar <id>`): la clave se pega en un aviso oculto y entra al contenedor por la entrada estándar, nunca como argumento del
equipo (no queda en el historial ni en `ps`; dentro del contenedor `mosquitto_ctrl` la recibe por `-P`, como ya hace el chequeo de
salud con la sonda; quien tiene acceso al socket de Docker la ve con `docker top`, y ese acceso ya equivale a root del servidor:
riesgo aceptado), y el guion **verifica** el resultado: el dispositivo conecta con la clave nueva y su ACL lo frena en un tópico
ajeno (`RC:135`), con un identificador de cliente propio para no expulsar la sesión del dispositivo, sin que nada llegue al pipeline. Las dos herramientas comparten `pruebas/lib-dynsec.sh` con el banco,
que prueba la misma ACL (`docs/16 §20`).

**Qué NO es respaldo de credenciales:** el repositorio. Git respalda código y configuración; los
secretos y los datos se respaldan aparte (`pg_dump` cifrado, gestor de contraseñas).

**Reglas de manejo en el día a día** (aprendidas de práctica profesional, generalizadas):

- Un secreto **nunca se imprime**: en registros y diagnósticos se muestra el nombre de la variable y su
  largo (`MQTT_BACKEND_CLAVE: 44 caracteres`), jamás el valor. Tampoco los hashes.
- En tablas con credenciales (`usuario`, `credencial`) nunca `SELECT *`: columnas explícitas, para que
  el hash no viaje por accidente a un registro, una API o un chat.
- Variable de entorno nueva → se agrega a `.env.example` con comentario **y** se verifica al arrancar (guardián 2d de `pruebas/verificar-todo.sh`: compara lo que el código lee con lo declarado; corregido el 23/09/2026, faltaban 7 de 10)
  (`getOrThrow`): el fallo debe ser al inicio, con nombre, no a las 3 de la mañana.
- A un chat o a un ticket va el **filtro** (`grep`, `jq`), nunca el registro completo ni una captura de
  la pestaña Red del navegador (trae cookies y tokens).
- Antes de publicar cualquier cambio: `git diff --staged` buscando secretos, `.env` y reformateos ajenos.
- Todo lo que se pega en un servicio externo sale de la máquina: se aplica el mismo criterio que para
  publicarlo.

## 8. Lista de verificación antes de desplegar en un servidor

Lo que se hizo en desarrollo **no** se traslada tal cual. Antes del primer despliegue fuera del equipo
de desarrollo:

- [ ] **Rotar todas las credenciales** (base de datos, `sonda`, `backend`, dispositivos): las de
      desarrollo se consideran expuestas por definición. Generar nuevas en el servidor con
      `openssl rand`; nunca copiar el `.env` del portátil.
- [ ] **No copiar `docker-compose.override.yml`**: es el archivo que publica 5432 y 1883 en
      desarrollo. Sin él, el archivo base no publica ningún puerto (forma de producción).
- [ ] **Eliminar los usuarios y dispositivos de prueba** (`dev-*`) del plugin del broker (`broker-cliente.sh --borrar`) y de la base.
- [ ] Proxy TLS en 443 y 8883 antes de exponer nada a Internet (capa 2). En el `.env` del servidor: `PROXY_NOMBRE` con el
      nombre público (el del certificado; alimenta el `server_name` del proxy y la lista de `Host` del backend, §3) y
      `PROXY_IP_DISPOSITIVOS=0.0.0.0` para publicar 8883; `PROXY_IP_PERSONAS` queda en 127.0.0.1, o en la dirección de la red privada de administración (`docs/14 §7`), hasta M7 (12/10/2026:
      antes una sola variable publicaba los tres puertos y esta lista no se podía cumplir).
- [ ] **La API no se publica en 443 mientras no exija credencial** (M7, RF-43): hoy `/dispositivos`
      responde sin sesión por diseño (consulta de solo lectura), y eso es correcto en `127.0.0.1`,
      no en Internet. Hasta M7, el proxy expone solo 8883. **Servidor de prueba (01/11/2026):** 443 y 80 se publican
      solo en la dirección de la red privada de administración (`PROXY_IP_PERSONAS`): el panel es alcanzable para el operador sin
      estar en Internet (`docs/14 §7`).
- [ ] `HTTP_DOCS` ausente o distinto de `si` en el servidor: `/docs` apagada (se verifica con
      `curl -o /dev/null -w '%{http_code}' https://…/docs` → 404).
- [ ] Rol de base de datos del backend sin `DROP`/`TRUNCATE` (capa 6).
- [ ] Respaldo automático configurado (`pg_dump` diario, cifrado, copia fuera del servidor) y **una restauración
      probada** antes de recibir datos reales; RPO y RTO decididos con el usuario (`docs/10 §9.5`).
- [ ] Cortafuegos del servidor coordinado con Docker, documentado en §4: el cortafuegos del anfitrión (`ufw`, cadena `INPUT`) **no
      filtra** lo que Docker publica (va por `FORWARD`); el control de primer orden es **en qué dirección se publica cada puerto**
      (`PROXY_IP_*`) y el de segundo, la cadena `DOCKER-USER` (01/11/2026).
- [ ] **Construir con bases frescas, escanear y desplegar eso mismo:** `bash plataforma/pruebas/escanear-imagenes.sh`
      construye con `--pull --no-cache` y escanea: cero vulnerabilidades altas o críticas con corrección publicada; lo que
      no la tenga, anotado en §4 con su porqué. Enseguida, `docker compose up -d --build`, que reusa las capas recién
      escaneadas. El digest fija la base, pero la capa de parches (`apk upgrade`) se resuelve al construir: una imagen
      reconstruida otro día se vuelve a escanear. Lo construido aquí lleva la etiqueta neutra `local`: su versión vive solo
      en el `FROM` de su Dockerfile.
- [ ] **Si cambió la versión de TimescaleDB** y la base ya existe: respaldo del volumen con el contenedor detenido →
      levantar solo la base → `psql -X -c "ALTER EXTENSION timescaledb UPDATE;"` → los mismos conteos antes y después.
      El paso 2k del guardián compara la versión de la extensión con la de la imagen.
- [ ] `docker compose config` en el servidor para revisar la configuración efectiva final: cero
      `ports` salvo los del proxy.
- [ ] **Anfitrión endurecido antes de la plataforma** (01/11/2026, `docs/14 §7.1`): distribución con soporte vigente, parches de
      seguridad automáticos, SSH solo con llave y sin root, entrada denegada salvo SSH por la red privada, llave de despliegue de **solo
      lectura** para el repositorio (nunca la llave personal del operador en el servidor), y la plataforma vuelve sola tras un reinicio
      (probado dos veces).
- [ ] **Vigilante externo por latido probado** (§4, `docs/14 §7.2`): sin la prueba de que avisa, el aviso no existe.

## 9. Identidad, cifrado y mínimo privilegio por tramo (13/10/2026; regla en `docs/10 §8.4` punto 44)

R1: identidad propia y mínimo privilegio siempre. R2: TLS en todo tramo que sale del servidor. R3: sin TLS dentro de la red
interna de Docker, porque no sale del servidor (cambia a R2 si un componente se muda de máquina).

| Tramo | Identidad (R1) | Puede (y nada más) | Cifrado | Estado |
|---|---|---|---|---|
| Dispositivo → proxy 8883 → broker | usuario y clave propios por dispositivo | publicar en `sitio/+/dispositivo/<su usuario>/+` | TLS hasta el proxy (R2); interno en claro (R3) | ✅ |
| Pasarela o servidor de red externo → proxy 8883 → broker | usuario propio por pasarela (`POST /pasarelas`) | publicar bajo su propio árbol y suscribirse solo a su subárbol de comandos (rol `pasarela`, `docs/10 §8.4` punto 47) | TLS (R2) | ✅ 15/10: alta, rol y filtro 1 probados en el banco (`docs/16 §31`); TLS con una pasarela real, en terreno |
| Persona → proxy 443 → backend | hoy: clave de administrador solo en las rutas que escriben; con la sesión (M7), usuario y rol | lo que su rol permita (`docs/20`) | HTTPS (R2) | 🟡 lecturas sin sesión hasta M7 |
| Backend → broker (`backend`) | usuario propio | recibir `sitio/#`; nada más | interno (R3) | ✅ |
| Backend → broker (`backend-admin`) | usuario propio, conexión aparte | órdenes al plugin y leer `$SYS/#` (acotado el 13/10; antes leía todo) | interno (R3) | ✅ |
| Chequeo de salud → broker (`sonda`) | usuario propio | leer `$SYS/#` | interno (R3) | ✅ |
| Backend → base | `plataforma_app` (desde el 13/10, migración 14); el dueño solo para migraciones y semillas | leer, insertar y actualizar filas; la retención solo por `fn_retencion_drop_chunks` | interno (R3) | ✅ |
| Cualquiera → `GET /salud` (sin sesión) | ninguna | ver estado, cola del broker, descartes, clientes conectados y aprovisionamiento en curso | HTTPS (R2) | 🟡 aceptado hasta la sesión (M7): son conteos sin datos de personas ni de dispositivos; con M7 el detalle pasa a la vista de administrador y lo público queda en `estado` |
| Registros de los servicios | — | no viajan: Docker los guarda rotados en el disco del servidor (`docs/10 §6`) | no aplica | ✅ |
| Herramienta de análisis futura (Grafana, cuaderno) | rol de base de solo lectura | `SELECT` | TLS si está fuera del servidor (R2) | ⏳ Etapa 4 |

Al cambiar las ACL de un rol, el plugin desconecta a los clientes que lo usan para que reconecten con los permisos nuevos:
observado el 13/10 al acotar `admin` (el backend volvió a estar listo en 2 s, sin intervención).
