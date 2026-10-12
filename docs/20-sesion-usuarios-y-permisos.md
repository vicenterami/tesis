# 20 · Sesión, usuarios, roles y permisos (diseño antes del código; Etapa 4)

> Borrador del 12/10/2026 para decidir sobre texto antes de programar (regla de concordancia: manda el diseño documentado).
> Cubre M7 (sesión del panel), HU-18, RF-41 (aislamiento entre sitios), RF-43 (autenticar usuarios), RF-44 (dos roles), RF-46
> (bitácora de accesos) y la vista pública por enlace (`docs/10 §8.4` punto 6). Lo que ya estaba decidido se cita; lo que falta
> decidir va marcado **[por decidir]** y tiene su opción recomendada.

## 1. Lo ya decidido que aquí se respeta
| Decisión | Dónde | Consecuencia |
|---|---|---|
| Cookie `HttpOnly; Secure; SameSite=Lax`; el panel lo sirve el backend (mismo origen); `Secure` no atado a `NODE_ENV` | `docs/11 §4` | Ningún script lee la sesión; sin CORS; el proxy pone TLS |
| Roles por sitio con un guardia central: la identidad y el alcance salen de la sesión y entran al `WHERE` de cada consulta | `docs/10 §8.4` punto 36 | Una sola función decide; ninguna ruta confía en lo que manda el cliente |
| Dos roles: administrador del sitio y usuario de consulta | RF-44; `usuario_sitio.rol` ya existe (migración 01) | Un usuario puede tener roles distintos en sitios distintos |
| Vista pública por enlace con token, no un tercer rol | `docs/10 §8.4` punto 6 | Solo lectura agregada, sin cuenta |
| Clave de administrador por cabecera hasta la sesión | `docs/10 §8.4` punto 41 | Crea el primer usuario y se retira |
| Bloqueo optimista en lo editable; cada cambio deja un `evento` con quién | `docs/10 §8.4` punto 28 | El «quién» sale de la sesión |
| Matriz de acceso ruta × rol escrita antes del código, convertida en casos de humo | `docs/11 §4` | §6 de este documento |

## 2. Modelo de datos
- `usuario` (existe): `id`, `nombre`, `email` (único; es el nombre de inicio de sesión), `hash_password`, `creado_en`. Se agregan
  `activo` (baja lógica sin borrar su rastro), `clave_temporal` (debe cambiarla al entrar), `actualizado_en` (disparador).
- `usuario_sitio` (existe): `(usuario_id, sitio_id, rol)`.
- `sesion` (nueva): `id` (hash SHA-256 del identificador aleatorio que viaja en la cookie: la base nunca guarda lo que
  autentica), `usuario_id`, `creada_en`, `ultima_actividad`, `expira_en`, `revocada_en`, `ip`, `agente` (acotado a 200
  caracteres). Índice por `usuario_id` y por `expira_en` (limpieza).
- `acceso` (nueva, RF-46): `instante`, `usuario_id` (nulo si el usuario no existe), `email_intentado` (acotado), `ip`, `resultado`
  (`ok`, `clave_incorrecta`, `bloqueado`, `inactivo`, `cierre`), `sesion_id`. Hypertable con retención (`RetencionService`,
  90 días **[por decidir]**).
- `enlace_publico` (nueva): `id`, `sitio_id`, `token_hash`, `magnitudes` (lista), `intervalo` (de la lista cerrada), `creado_por`,
  `expira_en`, `revocado_en`.

## 3. Sesión: una cookie opaca con estado en el servidor
- **Qué viaja:** una cookie `sesion` con 32 bytes aleatorios en base64url; en la base queda su hash. Sin JWT: con un solo
  servidor (RNF-14) no hay nada que ganar firmando, y una sesión en la base se **revoca de verdad** al cerrar (en diseños con un
  token corto y otro largo, cerrar sesión suele dejar vivo el largo si su `path` no llega a la ruta de cierre).
- **Vida:** se renueva con cada petición (`ultima_actividad`); vence a las **12 h sin actividad** y a los **7 días** desde que se
  creó, lo que ocurra primero **[por decidir: cifras]**. Al vencer, 401 y el panel vuelve al inicio de sesión guardando la ruta.
- **Flags:** `HttpOnly; Secure; SameSite=Lax; Path=/`. `Secure` siempre; en desarrollo el panel va por `http://127.0.0.1` y el
  navegador acepta `Secure` en `localhost`/loopback **(verificar en el tramo que lo implemente: Chrome y Firefox lo tratan como
  contexto seguro; si uno no, variable explícita `HTTP_COOKIE_SEGURA=no` solo en desarrollo, nunca derivada de `NODE_ENV`)**.
- **Cierre (Etapa 4):** `DELETE /sesion` marca `revocada_en` y borra la cookie; «cerrar en todos lados» revoca todas las del usuario.
- **El canal en vivo** (`GET /eventos`) exige la misma cookie: `EventSource` la manda solo al mismo origen. Con sesión, el canal
  filtra por los sitios del usuario y el tope de flujos pasa a ser **por usuario** (5 **[por decidir]**).
- **Descargas** (exportación): con sesión en la base no hay «token corto vencido»: un enlace normal a `/dispositivos/{id}/exportar`
  funciona mientras la sesión viva; si venció, el backend responde 401 y el panel muestra el inicio de sesión. No viaja ningún
  token en la URL.

## 4. Claves y bloqueos
- **Hash:** `scrypt` de `node:crypto` (N = 2¹⁷, r = 8, p = 1, 64 bytes, sal de 16 bytes por usuario), comparación de tiempo
  constante. **[por decidir (a)]:** `scrypt` sin dependencias frente a `argon2id`, que exige un paquete con binario nativo y un
  script de instalación (hoy todos están prohibidos por `ignore-scripts`). Recomendado: `scrypt`; se documenta el costo medido
  (objetivo: 100–300 ms por verificación en el servidor de referencia).
- **Reglas de la clave:** mínimo 12 caracteres, sin máximo bajo (hasta 128), sin exigir símbolos; se rechaza si aparece en una
  lista corta de claves comunes incluida en el repositorio. Una clave nueva no puede ser igual a la anterior.
- **Intentos fallidos:** por usuario, 5 en 15 minutos → bloqueo de 1 minuto, después 5, después 15 (creciente); por IP, 50 en
  15 minutos → 429. El mensaje al cliente es el mismo para usuario inexistente, clave mala y usuario inactivo («credenciales
  no válidas»), y la respuesta tarda lo mismo (se calcula el hash aunque el usuario no exista). Todo intento va a `acceso`.
- **Primer administrador (Etapa 4):** `POST /usuarios` con la clave de administrador del punto 41 solo mientras no exista ningún usuario
  administrador; después esa ruta exige sesión de administrador y la variable se retira del `.env` **[por decidir (c): ¿o
  queda como «llave de emergencia» rotada y guardada fuera del servidor?]**.
- **Olvidé mi clave:** sin correo saliente en la Etapa 4, el administrador del sitio asigna una clave temporal (se muestra una
  vez, como la credencial de un dispositivo) y el usuario debe cambiarla al entrar **[por decidir (d)]**.
- **Alta de usuarios:** solo un administrador; sin registro abierto. Un usuario se desactiva, no se borra (su rastro en
  `evento` y `acceso` lo necesita).

## 5. El guardia central
- Un middleware lee la cookie, busca la sesión viva, renueva `ultima_actividad` y deja en la petición `usuario` y sus
  `sitios: Map<sitio_id, rol>`. Sin sesión → 401 con un cuerpo fijo. Las rutas públicas (`/salud`, `/panel/*`, `/publico/*`) no
  pasan por él.
- Una sola función `permitir(usuario, accion, sitio_id)` con la tabla de permisos de la §6; toda ruta la llama antes de tocar
  la base. El `sitio_id` lo resuelve el servidor a partir del recurso pedido (el dispositivo, el canal), nunca del cuerpo.
- **Un recurso de otro sitio responde 404, no 403**: no se revela que existe (RF-41). El 403 queda para «es tu sitio pero tu
  rol no puede».
- **CSRF:** `SameSite=Lax` cubre las navegaciones; además, toda ruta que escribe exige la cabecera `X-Pedido: panel`, que un
  formulario de otro sitio no puede poner y el cliente HTTP del panel pone siempre **[por decidir (b): sí/no]**.
- La clave de administrador del punto 41 pasa por el mismo guardia como un «usuario del sistema» con rol de administrador en
  todos los sitios, hasta que se retira.

## 6. Matriz de acceso (ruta × rol → código esperado). Se convierte en casos de humo con una sesión por rol
| Ruta | Sin sesión | Consulta (su sitio) | Administrador (su sitio) | Otro sitio |
|---|---|---|---|---|
| `GET /salud`, los archivos del panel bajo `/panel/`, `/publico/{token}` (Etapa 4) | 200 | 200 | 200 | 200 |
| `POST /sesion`, `DELETE /sesion` (Etapa 4) | 200 / 401 | 200 | 200 | — |
| `GET /dispositivos`, `GET /dispositivos/{id}`, `GET /canales/{id}/historico`, `GET /condiciones`, `GET /cuarentena`, `GET /eventos` | 401 | 200 (solo sus sitios en la lista; filtro por sitio en el `WHERE`) | 200 | 404 |
| `GET /dispositivos/{id}/exportar` | 401 | 403 (exportar exige administrador: punto 6, datos crudos no públicos) | 200 | 404 |
| `POST /dispositivos` (Etapa 3), `PATCH /dispositivos/{id}`, `PUT /canales/{id}/reglas`, mudanza (Etapa 4) | 401 | 403 | 200 / 409 | 404 |
| `POST /usuarios`, `PATCH /usuarios/{id}`, enlaces públicos (Etapa 4) | 401 | 403 | 200 | 404 |

## 7. Vista pública por enlace
- Un administrador crea el enlace eligiendo sitio, magnitudes e intervalo de agregación; el token (32 bytes) se muestra una vez
  y la base guarda su hash. `GET /publico/{token}` (Etapa 4) devuelve solo agregados de esas magnitudes; nunca trama cruda, identificadores
  físicos ni exportación. Caduca y se revoca desde el panel. Límite de tasa en el proxy para esa ruta (`docs/11 §4`).

## 8. Pruebas que lo demuestran (antes de dar por hecho)
- La matriz de la §6 completa, con una sesión por rol y un recurso de otro sitio: cada celda es un caso.
- Cookie con sus tres flags, leída con `curl -D -`; `Secure` presente también en desarrollo.
- Cerrar sesión deja la sesión revocada en la base y el identificador viejo responde 401 en la siguiente petición.
- 6 claves malas seguidas → la sexta responde «bloqueado» aunque sea la correcta, y `acceso` tiene las 6 filas.
- Usuario inexistente y clave mala responden lo mismo y tardan lo mismo (medido: diferencia menor que la varianza).
- Un recurso de otro sitio → 404 en cada ruta, con la misma forma que un recurso inexistente.
- El canal en vivo sin cookie → 401; con sesión de consulta, solo eventos de sus sitios (prueba con dos sitios).
- Carrera: dos inicios de sesión simultáneos del mismo usuario crean dos sesiones válidas e independientes.

## 9. Fuera de alcance (y por qué)
Inicio de sesión con terceros (universidad, Google): exige acuerdos y correo saliente; registro abierto: no hay caso de uso;
autenticación de dos factores: candidata para después de la Etapa 4, cuando haya correo o aplicación de códigos.
