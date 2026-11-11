# 20 · Sesión, usuarios, roles y permisos (diseño antes del código; Etapa 4)

> Borrador del 12/10/2026 para decidir sobre texto antes de programar (regla de concordancia: manda el diseño documentado).
> Cubre M7 (sesión del panel), HU-18, RF-41 (aislamiento entre sitios), RF-43 (autenticar usuarios), RF-44 (dos roles), RF-46
> (bitácora de accesos) y la vista pública por enlace (`docs/10 §8.4` punto 6). Lo que ya estaba decidido se cita; lo que faltaba
> decidir (hash, cabecera anti-CSRF, destino de la clave de administrador, clave temporal, tiempos de sesión, retención de accesos,
> flujos por usuario) quedó decidido el 12/10/2026 y aparece con su fecha.
>
> **Estado al 08/11/2026: implementado en el backend** (bloque 1 de la Etapa 4: sesión, usuarios, roles por sitio y guardia central;
> migración 22, `backend/src/sesion/`), y **en el panel** el mismo día (pantalla P10: entrar, clave temporal, salir, usuarios; `docs/19 §4`).
> Lo hecho, lo decidido al implementar y lo que falta (la vista pública por enlace) están en la §10.
>
> **Decidido el 08/11/2026 (plan de la Etapa 4, versión 2, `docs/04 §8`; diseño, código en la iteración 0):** los **cinco perfiles**
> (§2, §5 y §6, que cambian: «exportar» pasa a administrador de sitio e investigador), la **baja de la cuenta por anonimización** (§11)
> y la **aceptación de los términos de uso** (§12). Lo que el código hace hoy sigue siendo lo de la §10 (dos roles); donde el diseño ya
> dice otra cosa, se marca.

## 1. Lo ya decidido que aquí se respeta
| Decisión | Dónde | Consecuencia |
|---|---|---|
| Cookie `HttpOnly; Secure; SameSite=Lax`; el panel lo sirve el backend (mismo origen); `Secure` no atado a `NODE_ENV` | `docs/11 §4` | Ningún script lee la sesión; sin CORS; el proxy pone TLS |
| Roles por sitio con un guardia central: la identidad y el alcance salen de la sesión y entran al `WHERE` de cada consulta | `docs/10 §8.4` punto 36 | Una sola función decide; ninguna ruta confía en lo que manda el cliente |
| Dos roles: administrador del sitio y usuario de consulta (desde el 08/11/2026, cinco perfiles: §2) | RF-44; `usuario_sitio.rol` ya existe (migración 01) | Un usuario puede tener roles distintos en sitios distintos |
| Vista pública por enlace con token, no un tercer rol | `docs/10 §8.4` punto 6 | Solo lectura agregada, sin cuenta |
| Clave de administrador por cabecera hasta la sesión | `docs/10 §8.4` punto 41 | Crea el primer usuario y se retira |
| Bloqueo optimista en lo editable; cada cambio deja un `evento` con quién | `docs/10 §8.4` punto 28 | El «quién» sale de la sesión |
| Matriz de acceso ruta × rol escrita antes del código, convertida en casos de humo | `docs/11 §4` | §6 de este documento |

## 2. Modelo de datos
- `usuario` (existe): `id`, `nombre`, `email` (único; es el nombre de inicio de sesión), `hash_password`, `creado_en`. Se agregan
  `activo` (baja lógica sin borrar su rastro), `clave_temporal` (debe cambiarla al entrar), `actualizado_en` (disparador).
  ✅ Migración 22: `activo` y `actualizado_en` ya existían (migración 05); se suman `clave_temporal` y `clave_temporal_vence_en` (las dos
  o ninguna) y un `CHECK` que guarda el email en minúsculas.
- `usuario_sitio` (existe): `(usuario_id, sitio_id, rol)`. ✅ Migración 22: `activo` (decidido al implementar, 08/11/2026): quitarle un
  sitio a una persona es una baja lógica; la aplicación no tiene `DELETE` en ninguna tabla (migración 14) y así sigue.
- **Cinco perfiles (decidido el 08/11/2026; diseño, código en la iteración 0).** Roles fijos, con la matriz de permisos en el código
  (`permitir()`, §5), no editables por pantalla: un rol a medida exigiría una interfaz de permisos y su propia prueba, sin un caso que lo
  pida. Por sitio, en `usuario_sitio.rol`: **administrador** (de sitio: todo en su sitio, también sus usuarios, enlaces públicos y
  exportar), **investigador** (consulta completa de su sitio, exportación y preferencias propias), **operador** (técnico: alta,
  configuración y mantenimiento de los dispositivos y pasarelas de su sitio; sin usuarios ni exportación) y **consulta** (solo lectura).
  Una migración nueva (prevista para la iteración 0) amplía el `CHECK` de `ck_usuario_sitio_rol` a esos cuatro valores; `administrador`
  conserva su nombre y su significado (de sitio), así las filas y las pruebas de hoy siguen valiendo sin migrar datos. Global, el
  **administrador del sistema** (usuarios, sitios, límites, estado del sistema y auditoría de todos los sitios): es el alcance que hoy
  solo tiene el usuario del sistema de la clave por cabecera (`todos` en `UsuarioSesion`), dado a una persona. Cómo se guarda queda por
  fijar al escribir esa migración; se prefiere una columna de `usuario` (`administrador_sistema`) antes que una fila por sitio, que no
  alcanzaría a los sitios creados después. El **invitado** no es un perfil: es la vista pública por enlace, sin cuenta (§7).
- `sesion` (nueva): `id` (hash SHA-256 del identificador aleatorio que viaja en la cookie: la base nunca guarda lo que
  autentica), `usuario_id`, `creada_en`, `ultima_actividad`, `expira_en`, `revocada_en`, `ip`, `agente` (acotado a 200
  caracteres). Índice por `usuario_id` y por `expira_en` (limpieza). ✅ Migración 22; la limpieza la hace una función del dueño
  (`fn_limpiar_sesiones`, como `fn_retencion_drop_chunks`) que `RetencionService` llama con el plazo de `acceso`.
- `acceso` (nueva, RF-46): `instante`, `usuario_id` (nulo si el usuario no existe), `email_intentado` (acotado), `ip`, `resultado`
  (`ok`, `clave_incorrecta`, `bloqueado`, `inactivo`, `cierre`), `sesion_id`. Hypertable con retención (`RetencionService`,
  **90 días**, la misma que la auditoría de operaciones de `docs/10 §8.4` punto 43; decidido el 12/10/2026). ✅ Migración 22
  (`RETENCION_ACCESO_DIAS`, mínimo 7). Sin clave foránea a `sesion`: los fallidos no tienen sesión y las vencidas se limpian antes.
- **Qué se guarda de cada persona y por cuánto tiempo (revisión del 08/11/2026):** nombre y correo mientras la cuenta exista (al darse
  de baja se anonimizan, §11); el hash scrypt de la clave (nunca la clave); en `sesion` y `acceso`, la dirección IP **completa** y el
  `User-Agent` acotado a 200 caracteres, **90 días** (`fn_limpiar_sesiones` y la retención de `acceso`): son un registro de seguridad que
  debe distinguir atacantes dentro de una misma red y permitir a la persona reconocer sus sesiones; la auditoría de operaciones
  (`docs/10 §8.4` punto 43) trunca el origen a /24 porque su fin es de uso, no de seguridad. `email_intentado` se guarda solo si tiene forma
  de correo (una clave pegada en el campo equivocado no queda en la base). A los registros de la aplicación la IP va truncada a /24 y nunca
  van correos ni nombres. El inventario completo de datos personales y de terceros está en `docs/21` (08/11/2026).
- `enlace_publico` (nueva): `id`, `sitio_id`, `token_hash`, `magnitudes` (lista), `intervalo` (de la lista cerrada), `creado_por`,
  `expira_en`, `revocado_en`.

## 3. Sesión: una cookie opaca con estado en el servidor
- **Qué viaja:** una cookie `__Host-sesion` (nombre con prefijo desde el 08/11/2026, §10) con 32 bytes aleatorios en base64url; en la base queda su hash. Sin JWT: con un solo
  servidor (RNF-14) no hay nada que ganar firmando, y una sesión en la base se **revoca de verdad** al cerrar (en diseños con un
  token corto y otro largo, cerrar sesión suele dejar vivo el largo si su `path` no llega a la ruta de cierre).
- **Vida (decidido el 12/10/2026):** se renueva con cada petición (`ultima_actividad`); vence a los **30 minutos sin actividad** y a
  las **8 horas** desde que se creó, lo que ocurra primero. Son los topes que recomienda la hoja de sesiones de OWASP (inactividad de
  15 a 30 minutos para aplicaciones de riesgo bajo; absoluto «between 4 and 8 hours»): una jornada de trabajo exige entrar una vez.
  El panel renueva solo mientras la persona interactúa (un `GET /sesion` liviano (hecho el 08/11/2026), como mucho cada 5 minutos, al mover el ratón o
  teclear); una pantalla fija sin nadie delante vence, y para una pantalla de sala está la vista pública por enlace (§7). Al vencer,
  401 y el panel vuelve al inicio de sesión guardando la ruta. El identificador de sesión (32 bytes, 256 bits de entropía; OWASP
  exige al menos 64) se **regenera** al iniciar sesión y al cambiar la clave, nunca se reutiliza uno anterior.
- **Flags:** `HttpOnly; Secure; SameSite=Lax; Path=/`. `Secure` siempre; en desarrollo el panel va por `http://127.0.0.1` y el
  navegador acepta `Secure` en `localhost`/loopback **(verificar en el tramo que lo implemente: Chrome y Firefox lo tratan como
  contexto seguro; si uno no, variable explícita `HTTP_COOKIE_SEGURA=no` solo en desarrollo, nunca derivada de `NODE_ENV`)**.
  ✅ Verificado el 08/11/2026 en `http://127.0.0.1:3000` con Chromium 156 y Firefox 157 sin interfaz: los dos guardan la cookie `Secure`
  y la devuelven (`docs/16 §58`). No hizo falta la variable: `Secure` va siempre.
  **Prefijo `__Host-` (revisión del 08/11/2026):** el nombre es `__Host-sesion`; el navegador solo acepta una cookie con ese prefijo si
  trae `Secure`, `Path=/` y ningún `Domain`, así que ni un subdominio ni una respuesta en claro pueden fijarla o pisarla. Comprobado el
  mismo día en `http://127.0.0.1:3000`, con la pila real, en Chromium 156 y Firefox 157: `POST /sesion` 200, la guardan
  (`secure`, `httpOnly`, `sameSite: Lax`, `path: /`) y `GET /sesion` 200 con ella; `document.cookie` vacío. Una `__Host-` sin `Secure`
  o con otro `Path` la descartan los dos (servidor mínimo de prueba). curl 8.18 también la guarda y la devuelve en loopback.
- **Cierre (hecho el 08/11/2026):** `DELETE /sesion` marca `revocada_en` y borra la cookie; «cerrar en todos lados» revoca todas las del usuario.
- **El canal en vivo** (`GET /eventos`) exige la misma cookie: `EventSource` la manda solo al mismo origen. Con sesión, el canal
  filtra por los sitios del usuario y el tope de flujos pasa a ser **por usuario** (**5**, decidido el 12/10/2026: cinco pestañas
  abiertas de una misma persona; el tope global de 50 se mantiene).
- **Descargas** (exportación): con sesión en la base no hay «token corto vencido»: un enlace normal a `/dispositivos/{id}/exportar`
  funciona mientras la sesión viva; si venció, el backend responde 401 y el panel muestra el inicio de sesión. No viaja ningún
  token en la URL. (Decidido al implementar, 08/11/2026, §10: para que «el panel muestra el inicio de sesión» se cumpla, el panel
  descarga por `fetch` con la sesión y un Blob, no con un enlace directo: un enlace abría el JSON del 401 en una pestaña. La ruta y
  la regla de no llevar token en la URL no cambian.)

## 4. Claves y bloqueos
- **Hash:** `scrypt` de `node:crypto` (N = 2¹⁷, r = 8, p = 1, 64 bytes, sal de 16 bytes por usuario), comparación de tiempo
  constante. **Decidido el 12/10/2026: `scrypt`** sin dependencias (frente a `argon2id`, que exige un paquete con binario nativo y un
  script de instalación, prohibidos por `ignore-scripts`). La función ya existe en `backend/src/alta/credenciales.ts` (la usa la
  credencial de los dispositivos con N = 2¹⁵); para personas, N = 2¹⁷ y se documenta el costo medido (objetivo: 100–300 ms por
  verificación en el servidor de referencia).
- **Reglas de la clave:** mínimo 12 caracteres, sin máximo bajo (hasta 128), sin exigir símbolos; se rechaza si aparece en una
  lista corta de claves comunes incluida en el repositorio. Una clave nueva no puede ser igual a la anterior ni al propio correo (decidido al implementar, 08/11/2026).
- **Intentos fallidos:** por usuario, 5 en 15 minutos → bloqueo de 1 minuto, después 5, después 15 (creciente); por IP, 50 en
  15 minutos → 429. El mensaje al cliente es el mismo para usuario inexistente, clave mala y usuario inactivo («credenciales
  no válidas»), y la respuesta tarda lo mismo (se calcula el hash aunque el usuario no exista). Todo intento va a `acceso` (los
  rechazados por un bloqueo, una vez por correo, dirección y ventana de 15 minutos: §10, R6).
- **La dirección del cliente detrás del proxy:** sale de `X-Forwarded-For` solo cuando la petición trae el secreto del proxy
  (`PROXY_SECRETO`, `recepcion/http/direccion.ts`); sin él se usa la del socket, que detrás de un proxy es la del proxy y volvería global el
  bloqueo por IP. La capa del proxy exige el secreto (compose) y en desarrollo sin proxy la del socket es la del cliente (revisión del 08/11/2026).
- **Primer administrador (hecho el 08/11/2026):** `POST /usuarios` con la clave de administrador del punto 41 solo mientras no exista ningún usuario
  administrador; después esa ruta exige sesión de administrador y la variable **se retira** del `.env` (decidido el 12/10/2026:
  no queda como llave de emergencia; si se pierde el último administrador, se crea otro desde la terminal del servidor, que ya
  equivale a root).
- **Olvidé mi clave (hecho el 08/11/2026: «Asignar clave temporal» en P10):** sin correo saliente en la Etapa 4, el administrador del sitio asigna una clave temporal (se muestra una
  vez, como la credencial de un dispositivo) y el usuario debe cambiarla al entrar; la temporal vence a las
  **2 h por defecto, configurable de 1 a 72 h** con `CLAVE_TEMPORAL_HORAS` (decidido el 08/11/2026; reemplaza las 24 h fijas del
  12/10/2026); si vence antes de entregarla, el administrador emite otra. Un valor inválido detiene el arranque (`arranque.ts`,
  `horasClaveTemporal`); la vigencia se prueba con reloj simulado y se corrobora con el instante guardado, y el panel muestra la hora de
  vencimiento que devuelve el servidor (`clave_temporal_vence_en`), nunca un plazo propio.
- **Alta de usuarios:** solo un administrador; sin registro abierto. Un usuario se desactiva, no se borra (su rastro en
  `evento` y `acceso` lo necesita); al darse de baja, se anonimiza (§11).

## 5. El guardia central
- Un middleware lee la cookie, busca la sesión viva, renueva `ultima_actividad` y deja en la petición `usuario` y sus
  `sitios: Map<sitio_id, rol>`. Sin sesión → 401 con un cuerpo fijo. Las rutas públicas (`/salud`, `/panel/*`, `/publico/*`, `POST /sesion` y `POST /recepcion/{idFisico}`, que lleva su propia credencial por dispositivo) no
  pasan por él.
- Una sola función `permitir(usuario, accion, sitio_id)` con la tabla de permisos de la §6; toda ruta la llama antes de tocar
  la base. El `sitio_id` lo resuelve el servidor a partir del recurso pedido (el dispositivo, el canal), nunca del cuerpo.
- **Un recurso de otro sitio responde 404, no 403**: no se revela que existe (RF-41). El 403 queda para «es tu sitio pero tu
  rol no puede».
- **CSRF:** `SameSite=Lax` cubre las navegaciones; además, toda ruta que escribe exige la cabecera `X-Pedido: panel`, que un
  formulario de otro sitio no puede poner y el cliente HTTP del panel pone siempre (decidido el 12/10/2026: **sí**; hoy ese papel
  lo cumple `X-Clave-Admin` en la única ruta que escribe).
- La clave de administrador del punto 41 pasa por el mismo guardia como un «usuario del sistema» con rol de administrador en
  todos los sitios, hasta que se retira.
- **Perfiles: el frontend oculta, el backend decide (08/11/2026).** Cada perfil es una fila de la tabla de `permitir()`; el panel recibe
  la misma tabla en `GET /sesion` (`permisos`, §10) y solo oculta o desactiva lo que el perfil no puede, con el motivo escrito. Cada celda
  de la §6 es un caso de humo con una sesión por perfil (paso 4b del guardián).
- **Membresía frente a cuenta (08/11/2026; amplía R1 de la §10).** La **membresía** es el rol de una persona en un sitio y si está
  activa allí; la **cuenta** es lo que vale en todos sus sitios: nombre, `activo`, clave temporal, baja. Un administrador de sitio edita
  solo la membresía en sus sitios de una cuenta que también pertenece a otro sitio; la cuenta la cambia el administrador del sistema o
  quien administra todos los sitios activos de esa persona. Un administrador de sitio no puede dar el perfil de administrador del sistema
  ni crear sitios.

## 6. Matriz de acceso (ruta × perfil → código esperado). Se convierte en casos de humo con una sesión por perfil
Ampliada el 08/11/2026 a los cinco perfiles (§2). **Vigente en el código** (paso 4b del guardián, `docs/16 §58`): las columnas «Sin
sesión», «Consulta», «Administrador de sitio» y «Otro sitio», con «exportar» solo para el administrador; las columnas «Investigador»,
«Operador técnico» y «Administrador del sistema», el cambio de «exportar» y las filas de rutas nuevas son **diseño** y entran con la
migración prevista de la iteración 0. Cada celda dice qué responde la ruta a esa persona en **su** sitio; «Otro sitio» es la misma
persona pidiendo un recurso de un sitio donde no tiene membresía (el administrador del sistema no tiene «otro sitio»: alcanza a todos).

| Ruta | Sin sesión | Consulta | Investigador | Operador técnico | Administrador de sitio | Administrador del sistema | Otro sitio |
|---|---|---|---|---|---|---|---|
| `GET /salud`, los archivos del panel bajo `/panel/`, la vista pública `/publico/{token}` (Etapa 4) | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| `POST /sesion` (pública), `GET /sesion`, `DELETE /sesion`, `POST /sesion/clave` (las tres valen con clave temporal) | 200 / 401 | 200 | 200 | 200 | 200 | 200 | — |
| `GET /dispositivos`, `GET /dispositivos/{id}`, `GET /canales/{id}/historico`, `GET /condiciones`, `GET /cuarentena`, `GET /pasarelas`, `GET /eventos` | 401 | 200 (solo sus sitios en la lista; filtro por sitio en el `WHERE`) | 200 | 200 | 200 | 200 (todos los sitios) | 404 |
| `GET /dispositivos/{id}/exportar` (datos crudos, no públicos: punto 6) | 401 | 403 | 200 | 403 | 200 | 200 | 404 |
| `POST /dispositivos`, `POST /dispositivos/{id}/credencial`, `PATCH /canales/{id}` (calibración), `POST /pasarelas`, `POST /pasarelas/{id}/credencial` | 401 | 403 | 403 | 200 / 409 | 200 / 409 | 200 / 409 | 404 |
| `DELETE /dispositivos/{id}`, `DELETE /pasarelas/{id}` (baja: el equipo deja de recibir datos) | 401 | 403 | 403 | 403 | 200 / 409 | 200 / 409 | 404 |
| Configurar un dispositivo, sus reglas de umbral y su estado (mantenimiento), y mudarlo (Etapa 4, rutas por fijar en el OpenAPI) | 401 | 403 | 403 | 200 / 409 | 200 / 409 | 200 / 409 | 404 |
| `GET /sitios` (Etapa 4: los sitios de la persona, con su perfil en cada uno) | 401 | 200 | 200 | 200 | 200 | 200 (todos los sitios) | — |
| `GET /sitios/{id}/resumen`, `GET /sitios/{id}/historico`, `GET /dispositivos/{id}/historico`, `GET /dispositivos/{id}/eventos` (Etapa 4; en los eventos, el nombre de quien hizo el cambio solo para los administradores: `docs/21 §2`) | 401 | 200 | 200 | 200 | 200 | 200 | 404 |
| `POST /dispositivos/lote` y `GET /cuarentena/detectados` (Etapa 4; hoy «escribir»: administrador de sitio; con los cinco perfiles, también operador técnico; en el lote, una zona o un identificador de otro sitio no se revelan) | 401 | 403 | 403 | 200 | 200 | 200 | 404 |
| `GET /usuarios`, `POST /usuarios`, `PATCH /usuarios/{id}` | 401 | 403 | 403 | 403 | 200 (las membresías de sus sitios; la cuenta de quien también está en otro sitio: 403, §5) | 200 (todas las cuentas) | 404 |
| Enlaces públicos de un sitio (Etapa 4) | 401 | 403 | 403 | 403 | 200 | 200 | 404 |
| Auditoría de un sitio (Etapa 4) | 401 | 403 | 403 | 403 | 200 | 200 | 404 |
| Estado del sistema, límites de los servicios, sitios y auditoría de todos los sitios (Etapa 4) | 401 | 403 | 403 | 403 | 403 | 200 | — |
| Lo propio de cada persona: preferencias, aceptar los términos, darse de baja, enviar un mensaje de soporte (Etapa 4) | 401 | 200 | 200 | 200 | 200 | 200 (la baja, 409 si es el último administrador del sistema: §11) | — |

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

## 10. Implementación (08/11/2026)
**Hecho en el backend** (`backend/src/sesion/`, migración 22, OpenAPI regenerado): `POST /sesion`, `GET /sesion`, `DELETE /sesion`
(con `?todas=true`, «cerrar en todos lados»), `POST /sesion/clave`, `GET /usuarios`, `POST /usuarios` y `PATCH /usuarios/{id}`; el guardia
central global; `permitir` con la matriz de la §6; la consulta, el alta, las pasarelas, la calibración y el canal en vivo con el alcance
por sitio; la bitácora `acceso`; los bloqueos; el tope de 5 flujos por usuario. Pruebas: unitarias de cada pieza (hash, reglas de la
clave, bloqueos, turnos, `permitir`, cookie, vencimientos con reloj simulado, guardia, cuerpos) y la §8 completa como paso 4b del
guardián (`plataforma/pruebas/sesion-smoke.sh`), con el costo medido en `docs/16 §58`.

**Decidido al implementar (08/11/2026)**, en lo que el diseño no fijaba (lo más simple y seguro):
- **Clave por cabecera y CSRF.** `X-Clave-Admin`, si viene, manda (una mala es 401 aunque haya cookie) y no exige `X-Pedido`: ella
  misma es una cabecera que un formulario de otro sitio no puede poner. `POST /sesion` también exige `X-Pedido: panel` (sin ella, un
  formulario ajeno podría hacer entrar a la víctima con la cuenta de quien ataca).
- **La clave por cabecera gestiona usuarios solo mientras no exista ningún administrador activo** (`GET /usuarios`, `POST /usuarios` y
  `PATCH /usuarios/{id}`; después, 403; la lista, desde la revisión del 08/11/2026, punto R10), y lo que crea debe ser administrador de al menos un sitio. Dos «primeros» a la vez se ordenan con un candado de la base.
- **Alta de usuarios con clave temporal.** `POST /usuarios` no recibe clave: genera una temporal (24 caracteres aleatorios, vence a las
  `CLAVE_TEMPORAL_HORAS`: 2 h por defecto, 1–72; §4), la muestra una vez y la persona la cambia al entrar. Con clave temporal, la sesión solo sirve para `GET /sesion`, `DELETE /sesion`
  y `POST /sesion/clave`; lo demás responde 403. Una temporal vencida responde como una clave mala y queda en `acceso` como
  `clave_incorrecta` (el dominio de `resultado` no cambia).
- **Quién ve a quién.** Un administrador ve a quien está o estuvo en alguno de sus sitios (`en_mis_sitios` dice cuál de las dos), y solo
  puede dar o quitar sus propios sitios; otro usuario o un sitio ajeno, 404. La cuenta (nombre, activo, clave temporal) la cambia solo si
  administra todos los sitios activos de esa persona (punto R1). Nadie se desactiva a sí mismo, y ningún cambio puede dejar la plataforma sin
  administradores activos (409). `PATCH /usuarios/{id}` lleva bloqueo optimista con `actualizado_en`, como la calibración (punto 28).
  Desactivar o asignar una clave temporal corta las sesiones de esa persona.
- **Orden de los códigos en las rutas que escriben.** Sin sesión, 401; sin rol de administrador en ningún sitio, 403 antes de mirar el
  cuerpo o el recurso (no revela nada); después, el sitio del recurso: 404 si no existe o es de otro sitio, 403 si es suyo y su rol no
  puede. En el alta (`POST /dispositivos`) el recurso es la zona, y en `POST /pasarelas`, el sitio del cuerpo: una zona o un sitio de
  otro, 404 como uno inexistente.
- **Bloqueos.** En memoria (un solo proceso), con la clave del bloqueo por usuario en el EMAIL escrito: un email inexistente se bloquea
  igual, así el bloqueo no revela qué cuentas existen. La respuesta al bloqueado es 429 «bloqueado…» con los segundos que faltan; un
  intento bloqueado no calcula el hash, y deja su fila «bloqueado» una sola vez por correo, dirección y ventana (R6). Cuentan como fallo la clave mala, el usuario inexistente y el inactivo; el nivel vuelve a cero
  tras un inicio correcto o 15 minutos sin fallos.
- **Hash.** Como mucho dos cálculos de `scrypt` de personas a la vez (128 MiB cada uno; medido el 08/11/2026, `docs/16 §59`: con dos inicios
  de sesión simultáneos el contenedor del backend llega a **315–321 MiB** (dos corridas), desde 57–64 MiB en reposo, frente al techo de 512 MiB); los
  demás esperan en orden y, con 20 esperando, 503. Además, como mucho 2 en curso o en cola por dirección (punto R8).
- **Renovación.** El guardia escribe `ultima_actividad` como mucho una vez por minuto; la inactividad efectiva queda entre 29 y 30 min.
- **Canal en vivo.** El sitio de cada dispositivo se tiene en memoria (se recarga al abrir un flujo con sesión y ante un dispositivo
  desconocido, en los dos casos como mucho cada 5 s: punto R11); la sesión se revalida en cada latido (punto R2); el evento de un dispositivo que aún no está en el mapa no se le muestra a nadie con alcance acotado.
  Los eventos del sistema (cola del broker) llegan solo a quien administra algún sitio. El usuario del sistema cuenta como uno en el tope
  de 5 flujos.
- **Cuarentena por sitio.** Una trama se atribuye al sitio de su dispositivo y, si no se identificó, al sitio cuyo código va en el tópico.
- **Cookie.** Sin `Max-Age`: cookie de sesión del navegador; los vencimientos los aplica el servidor. Nombre `__Host-sesion` (punto R15).

**Revisión de seguridad del bloque (decidido al implementar, 08/11/2026).** Una revisión independiente del código encontró 21 puntos;
lo que se decidió en cada uno (R = número del hallazgo). Cada corrección tiene una prueba que falla sin ella (`docs/16 §58`).
- **R1 · Escalada entre sitios por `PATCH /usuarios/{id}`.** Antes bastaba compartir un sitio: el administrador de A podía desactivar o
  asignar una clave temporal (y así entrar como ella) a quien además administra B. Ahora los campos de la **cuenta** (`nombre`, `activo`,
  `clave_temporal`) los cambia el usuario del sistema (mientras rija) o un administrador cuyo alcance cubre **todos** los sitios activos
  de la persona; si tiene alguno fuera, 403 «la cuenta pertenece también a otros sitios: pídelo a un administrador del sistema» (403 y no
  404: la persona sí aparece en su lista por el sitio en común). Los **roles**, solo en sitios propios. La lista sigue mostrando a quien
  ya no está en ninguno de mis sitios pero estuvo, marcado con `en_mis_sitios: false`, para poder devolverle el sitio: a esa persona solo
  se le puede devolver un sitio propio; tocar su cuenta, 403. (El encargo decía «el EXISTS de PATCH filtra los sitios activos» y a la vez
  «la lista muestra a quien estuvo para devolverle el sitio»: filtrado al pie de la letra, `PATCH` respondía 404 a esa persona y el sitio
  no se podía devolver. Se resolvió así: sitios activos para la cuenta, también los inactivos para devolver un rol. Confirmado el 08/11/2026.)
- **R2 · El canal en vivo no revalidaba la sesión.** En cada latido (25 s) relee la sesión del flujo **sin renovar la actividad** (un flujo
  abierto no es una persona delante: renovar en cada latido dejaría viva para siempre la sesión de una pantalla sola); si ya no vale
  (cerrada, vencida, revocada, usuario inactivo o con clave temporal) o la base no responde, el flujo se cierra; si cambiaron los sitios,
  rige el alcance nuevo. No aplica al usuario del sistema. El latido no sale de ninguna variable de entorno; las pruebas lo acortan
  asignándolo en el controlador.
- **R3 · Carrera del último administrador.** Todo cambio que toca `activo`, `clave_temporal` o roles toma `pg_advisory_xact_lock(hashtext('administradores'))`
  antes de leer la fila y de contar administradores; `POST /usuarios` toma el mismo (antes usaba otro, `primer_administrador`).
- **R4 · Ventana entre comprobar el bloqueo y verificar la clave.** Tras verificar, se vuelve a mirar el bloqueo por usuario y por
  dirección: si ya rige, 429 aunque la clave sea correcta (y queda «bloqueado» en `acceso`). Igual en `POST /sesion/clave`.
- **R5 · El bloqueo por correo permite bloquear a otra persona a propósito.** Se asume (decisión del 12/10/2026); riesgo y alternativa en `docs/11 §4`.
- **R6 · Un INSERT en `acceso` por cada 429.** La fila «bloqueado» va una vez por (correo, dirección) y ventana de 15 min; el contador
  vive en memoria dentro de los bloqueos, con el mismo tope que el resto.
- **R7 · El inicio de sesión no tenía el límite estricto del proxy.** `POST /sesion`, `POST /sesion/clave`, `POST /usuarios` y
  `PATCH /usuarios/{id}` entran en la zona `administracion` de nginx (5 r/s, ráfaga 10, por dirección; `docs/11 §3`).
- **R8 · Saturación del hash.** Como mucho 2 cálculos de una misma dirección en curso o en cola; el tercero, 429 sin encolarse. Un 503 por
  la cola llena cuenta como fallo de esa dirección (suma a su bloqueo; no al de ningún usuario).
- **R9 · El 409 de `POST /usuarios` («ya existe un usuario con ese email») revela qué correos tienen cuenta.** Se asume: solo lo ve un
  administrador, que es un rol de confianza y ya puede listar a las personas de sus sitios.
- **R10 · `GET /usuarios` con la clave de administrador.** La misma regla que crear y cambiar: solo mientras no haya ningún administrador activo.
- **R11 · Recarga del mapa de sitios en cada apertura.** Como mucho una vez cada 5 s aunque se abran flujos en bucle, y recién después del
  control de origen y de los topes 429/503: un flujo rechazado no cuesta una consulta.
- **R12 · La clave temporal vencida seguía valiendo en una sesión ya abierta.** La sesión se carga con el vencimiento de la temporal y deja
  de valer cuando vence.
- **R13 · Correo intentado en `acceso`.** Resuelto antes, en la pasada de privacidad (solo se guarda si tiene forma de correo).
- **R14 · `Cache-Control: no-store` ruta por ruta.** Un solo middleware en `main.ts` lo pone en toda la API (todo salvo `/panel` y `/docs`).
  Se quitaron las repeticiones de las rutas de sesión y de usuarios; se dejaron, a propósito, las de las respuestas con una credencial
  de dispositivo o de pasarela y la exportación, que ya eran controles documentados y probados por el banco.
- **R15 · Nombre de la cookie.** `__Host-sesion` (§3; comprobado con los dos navegadores antes de cambiarlo).
- **R16 · Hash de relleno perezoso.** Se calcula al arrancar (`onModuleInit`): calculado con el primer correo inexistente, ese primer
  intento tardaba el doble y lo delataba.
- **R17 · El tope de memoria de los bloqueos no era duro.** Si tras podar sigue lleno (10 000 claves), un intento que traería una clave
  nueva recibe 429 (1 min). Llenarlo exige 10 000 correos o direcciones con fallos dentro de 15 min, cada uno con su scrypt.
- **R18 · Usuario del sistema compartido.** Un objeto nuevo, con su propio mapa, en cada petición.
- **R19 · Cuarentena atribuida por el texto del tópico.** Se asume: el `payload` de la cuarentena es texto no confiable y el panel lo
  muestra escapado; la atribución por el código de sitio del tópico sirve solo para mostrar esa cuarentena en el sitio cuyo código
  coincide, nunca para dar acceso a nada más.
- **R20 · Guion de humo: el hash iba como argumento de psql.** Ahora viaja dentro del SQL por la entrada estándar; el guion corre con `set +x`.
- **R21 · Guion de humo: limpieza silenciosa.** Si falla, imprime el error y los residuos por patrón (sitios `pa-`/`pb-`, usuarios y filas
  de `acceso` de `@ejemplo.invalid`) y cómo reintentar: `bash plataforma/pruebas/sesion-smoke.sh --limpiar SUFIJO`.

**Hecho en el panel (08/11/2026; `docs/19 §4`, P10; pruebas en `docs/16 §59`).** La pantalla «Entrar», el cambio obligatorio de la clave
temporal, quién soy en la cabecera, «Salir» y «Cerrar en todos lados», la renovación con interacción (§3), la vuelta a la ruta guardada tras
un 401 y la pantalla de usuarios (alta con la temporal mostrada una vez, activar y desactivar, temporal nueva, rol por sitio, con bloqueo
optimista). El cliente HTTP del panel pone `X-Pedido: panel` en todo lo que escribe y trata el 401, el 403 por clave temporal, el 409 y el
429 en un solo lugar. Decidido al implementar (08/11/2026), en lo que el diseño no fijaba:
- **La matriz en `GET /sesion`.** La respuesta trae `permisos` (rol → acciones), calculado de `PERMISOS` por `matrizPorRol()` (`permisos.ts`):
  el panel arma la guía de cada perfil y desactiva lo que el rol no permite con la misma tabla que decide; no hay un segundo texto que
  mantener. Se eligió ampliar `GET /sesion` antes que una ruta nueva: el panel ya la pide al cargar y al renovar, y la matriz no es secreta
  para quien tiene sesión.
- **`reintentar_en_s` también en el 429 de `POST /sesion/clave`**, como en el de `POST /sesion`: el panel dice cuántos segundos esperar.
- **Descargas por `fetch` y Blob** (§3, nota): un 401 en una exportación vuelve al inicio de sesión en vez de abrir el JSON del error.
- **El canal en vivo y la sesión.** Las pantallas (y sus `EventSource`) existen solo con sesión: al salir o al vencer se cierran, y al entrar
  se reabren. Cuando el servidor cierra el canal (R2: la sesión venció), el panel pregunta `GET /sesion` una vez para saber si fue eso.
- **Semilla de desarrollo.** `pruebas/semilla-demo.sh` crea un administrador y un usuario de consulta del sitio `uct` (`@ejemplo.invalid`)
  con claves temporales impresas una vez; desde entonces la base de desarrollo ya tiene un administrador, así que `sesion-smoke.sh` crea el
  suyo por SQL y omite la carrera del último administrador (lo dice al correr).

**Vigencia de la clave temporal (08/11/2026).** De 24 h fijas a `CLAVE_TEMPORAL_HORAS` (1–72 h, 2 por defecto; §4), leída y validada
al arrancar, declarada en `.env.example` y pasada por el compose (guardianes 2d y 2z). En la pantalla de administración de límites (plan de
la Etapa 4) este valor pasará a configurarse desde el panel.

**Lo que falta** (no cambia el diseño): la vista pública por enlace (§7 y `enlace_publico`), `auditoria` con su middleware (`docs/10 §8.4`
punto 43), el «quién» en los eventos de alta, baja y calibración, y retirar `HTTP_CLAVE_ADMIN` del `.env` del servidor una vez creado el
primer administrador. El recorrido del banco con navegador (`banco.sh navegador`, `e2e/p3.mjs`) ya entra como usuario del sistema, con la
clave del banco por cabecera (`docs/16 §59`).

**Perfiles: decidido el 08/11/2026; estado: diseño, código en la iteración 0 (`docs/04 §8`; `docs/10 §8.4` punto 64).** Lo que cambia en
el código, en este orden: (1) la migración prevista amplía `ck_usuario_sitio_rol` a `administrador`, `investigador`, `operador` y
`consulta`, y agrega el alcance global del administrador del sistema (§2); (2) `ROLES` y `PERMISOS` de `permisos.ts` crecen con las
acciones que la §6 distingue (`leer`, `exportar`, `escribir`, `baja`, `usuarios`, `enlaces`, `auditoria`, `sistema`), y `exportar` pasa a
`administrador` e `investigador`; ninguna ruta compara perfiles por su cuenta: todas siguen llamando a `permitir()`; (3) el guardia carga el
alcance global en `todos`, como hoy para el usuario del sistema; (4) el panel no cambia de lógica: arma la guía de perfiles y desactiva
botones con la matriz que ya recibe en `GET /sesion`; el selector de rol de P10 ofrece los cuatro de sitio y, solo al administrador del
sistema, el global; (5) `sesion-smoke.sh` crea una sesión por perfil y recorre cada celda de la §6. **Plantado:** con `exportar` de vuelta
en solo `administrador`, el caso «investigador exporta → 200» debe fallar; con `escribir` abierto a `consulta`, el alta debe fallar.

## 11. Baja de la cuenta por anonimización (decidido el 08/11/2026; diseño, código en la iteración 0)
- **Qué es y por qué.** La persona se da de baja ella misma (RF-55), o la da de baja un administrador del sistema. Borrar la fila de
  `usuario` rompería `evento`, `acceso` y la auditoría, que la referencian; dejarla intacta conservaría datos personales sin un fin. Se
  conserva la fila, sin nada que identifique a nadie.
- **Qué se hace, en una sola transacción:** `nombre` pasa a un marcador derivado del id («Cuenta dada de baja · 3f2a», los primeros
  caracteres del uuid) y `email` a una dirección que no es de nadie, derivada del mismo id en un dominio reservado que no existe
  (`…@ejemplo.invalid`, como las personas de prueba), así se siguen cumpliendo `ck_usuario_email` y la unicidad; `hash_password` se reemplaza
  por un valor que ninguna clave verifica (la columna es `NOT NULL`); se revocan todas sus sesiones; `activo = false`; las membresías quedan
  inactivas; se borran sus preferencias, si existen (son de la iteración 1); y una columna nueva, `anonimizado_en`, guarda el instante (migración prevista, la misma de los
  perfiles). La acción queda en la auditoría con el id, nunca con el nombre de antes.
- **Qué queda, y por qué.** La fila con el id, enlazada desde `evento`, `acceso` y la auditoría, ya sin datos personales; `acceso` y las sesiones revocadas (`sesion`: IP y agente, hasta 90 días) guardan
  además la dirección IP y el correo intentado de sus intentos, que se borran solos a los 90 días (`docs/21 §2`). Los respaldos anteriores
  contienen los datos de antes hasta que vencen (30 días, `docs/10 §9.5`): se dice así en la página de privacidad.
- **Reglas.** Es irreversible: una cuenta anonimizada no se reactiva (la persona puede recibir una cuenta nueva). El **último administrador
  del sistema no puede darse de baja** (409), por la misma regla que impide dejar la plataforma sin administradores (R3, con el mismo
  candado). Pedirla exige la clave actual, como cambiarla: una sesión olvidada abierta no basta para borrar una cuenta.
- **Prueba (antes de darla por hecha):** después de la baja, ninguna columna de `usuario` contiene el nombre ni el correo de antes
  (consulta directa en la base); el correo de antes ya no entra; las filas de `evento` y `acceso` siguen enlazadas; el último administrador
  del sistema recibe 409.

## 12. Aceptación de los términos de uso (decidido el 08/11/2026; diseño, código en la iteración 0)
- **Qué se guarda.** La versión vigente de los términos es un valor de configuración; en `usuario`, la versión aceptada y el instante
  (columnas nuevas en la migración prevista). Qué dicen los términos y la página de privacidad, y de dónde salen, está en `docs/21 §7`.
- **Cómo se aplica.** Al entrar, si la versión aceptada no es la vigente, la sesión queda restringida como con una clave temporal (§10):
  solo sirve para leer las páginas legales, aceptar y salir; lo demás responde 403 con un motivo que el panel convierte en la pantalla
  «Términos de uso». Aceptar guarda versión e instante y deja una fila en la auditoría. Cambiar la versión obliga a todos a aceptar de
  nuevo en su siguiente petición. Una clave temporal pendiente va primero; la aceptación, después.
- **Prueba:** una sesión sin aceptar recibe 403 en una lectura y 200 en las páginas legales; aceptar la vuelve normal; subir la versión la
  vuelve a restringir.
