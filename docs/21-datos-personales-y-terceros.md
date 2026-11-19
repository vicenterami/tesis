# 21 · Datos personales y terceros (inventario; diseño antes del código; Etapa 4)

> Decidido el 08/11/2026 en el plan de la Etapa 4, versión 2 (`docs/04 §8`, bloque B1). Este documento dice **qué datos de personas
> guarda el sistema, dónde, para qué, por cuánto tiempo y quién accede a ellos**, de qué **terceros** depende, qué guarda el
> **navegador** y qué **permisos** pide, y fija la base de las páginas de privacidad y de términos (RF-53, RF-54) y de los derechos de
> la persona, entre ellos la baja por anonimización (RF-55, `docs/20 §11`). Manda este documento: la página de privacidad del panel se
> genera desde él (§7), no se escribe aparte (regla de concordancia). Lo legal queda **por verificar con la normativa vigente**: aquí
> no se cita ninguna ley por su número mientras no se haya leído en su fuente oficial (la misma regla de `docs/10 §9.5`).

## 1. Principios
- **Mínimo necesario.** De una persona se guarda lo que exigen su cuenta, la seguridad del acceso y la auditoría de lo que hizo;
  nada para perfilarla. Las mediciones de los sensores son ambientales y no identifican personas; si un sitio instalara sensores que
  sí lo hagan (presencia, ubicación de personas), este inventario se amplía antes de recibir sus datos.
- **Cada plazo lo aplica la base, no una promesa.** Las retenciones las ejecuta `RetencionService` con `drop_chunks` o una función
  del dueño (`docs/20 §2`); un plazo que aún no tiene quien lo aplique se escribe como «por decidir», no como hecho.
- **Sin terceros en el camino de los datos** (RNF-20): ni el navegador ni el servidor envían datos de personas ni mediciones a otro.
- **Lo que se muestra sale de aquí.** La página de privacidad, la de términos y la ayuda de «Mi cuenta» citan este inventario.

## 2. Inventario de datos personales (al 17/11/2026)
| Dato | Dónde | Para qué | Cuánto tiempo | Quién accede |
|---|---|---|---|---|
| Nombre | `usuario.nombre` (1–80 caracteres) | Identificar a la persona en el panel, en la lista de usuarios y en la auditoría | Mientras exista la cuenta; con la baja, un marcador derivado del id (`docs/20 §11`) | La persona; los administradores de sus sitios; el administrador del sistema |
| Correo | `usuario.email` (único, en minúsculas: es el nombre de inicio de sesión) | Iniciar sesión; contacto del administrador | Ídem | Ídem |
| Hash de la clave | `usuario.hash_password` (`scrypt`; nunca la clave) | Verificar la clave al entrar | Mientras exista la cuenta; con la baja, se anula | Nadie por la API: solo el backend lo compara |
| Sitios y roles | `usuario_sitio` (baja lógica con `activo`) | Decidir qué ve y qué hace (`docs/20 §6`) | Mientras exista la cuenta | La persona; los administradores de esos sitios |
| Baja de la cuenta: cuándo, quién y por qué | `usuario.desactivado_en`, `usuario.desactivado_por`, `usuario.motivo_baja` (migración 24) | Saber por qué una cuenta no entra y poder reactivarla | Mientras siga inactiva; al reactivarla se limpian y el motivo queda en el evento del cambio | Los administradores de sus sitios; el administrador del sistema |
| Motivo de baja (texto libre: la pantalla pide escribirlo sin nombres ni datos personales) | En `usuario` (`motivo_baja`) y en `evento` (`detalle.motivo` de los `usuario_cambio` de esa cuenta) | Saber por qué se dio de baja una cuenta | Se anula con la baja de la cuenta (anonimización, `fn_anonimizar_usuario`) | Los administradores de sus sitios; el administrador del sistema |
| Dirección IP **completa** y agente del navegador (hasta 200 caracteres) | `sesion` | Reconocer y revocar sesiones; distinguir atacantes dentro de una misma red | 90 días (`fn_limpiar_sesiones`, con el plazo de `RETENCION_ACCESO_DIAS`) | El administrador del sistema; la persona, sus propias sesiones (`GET /sesiones` (Etapa 4), con el origen truncado; completas en «Exportar mis datos») |
| Dirección IP completa, correo intentado (solo si tiene forma de correo) y resultado | `acceso` (RF-46) | Seguridad: intentos fallidos, bloqueos, cierres | 90 días (`RETENCION_ACCESO_DIAS`, mínimo 7); el correo intentado se anula antes, con la baja de la cuenta | El administrador del sistema, todo; los administradores de sitio, las entradas, salidas y bloqueos de las personas con membresía activa en su sitio, sin la dirección IP ni el correo (P14, decidido el 11/11/2026) |
| Usuario, ruta, código y **origen truncado** (/24 en IPv4, /48 en IPv6) | `auditoria` (`docs/10 §8.4` punto 43; por construir en la iteración 0) | Saber quién hizo qué y cuándo (RF-23, RF-46) | 90 días | Los administradores, solo de sus sitios |
| Dirección IP completa | Registros del proxy (un JSON por línea, en los registros de Docker) | Diagnóstico y límite de tasa | Hasta que la rotación por tamaño los pisa (5 archivos de 10 MB por servicio, `docs/11 §4`): depende del tráfico, no de un plazo. **Por decidir en la iteración 1** (B4): truncar la dirección o fijar un plazo | Quien opera el servidor |
| Dirección IP truncada a /24; nunca correos ni nombres | Registros de la aplicación | Diagnóstico | Ídem (rotación por tamaño) | Quien opera el servidor |
| Aceptación de los términos (versión e instante) | `usuario.terminos_version_aceptada` y `usuario.terminos_aceptados_en` (migración 24) | Demostrar qué versión aceptó y cuándo (§7) | Mientras exista la cuenta; se conserva tras la baja, ya sin nombre ni correo | La persona; el administrador del sistema |
| Quién hizo el cambio (la persona que dio de alta, configuró, calibró, rotó o dio de baja) | `evento.usuario_id` (migración 23; nulo = el sistema) | Saber quién hizo qué sobre cada equipo (HU-11; «registrado por N» en la ficha) | La de `evento`, que hoy no se borra; tras la baja de la cuenta queda el marcador anonimizado de `docs/20 §11`, no el nombre | El nombre lo ven solo los administradores de ese sitio y el administrador del sistema (`GET /dispositivos/{id}/eventos`); los demás perfiles reciben `usuario: null` (decidido el 11/11/2026) |
| Preferencias (unidades de visualización, zona horaria, tema, notificaciones, vistas guardadas) | `preferencia` (migración 24) | Mostrar los datos como la persona eligió | Hasta la baja por anonimización (una cuenta solo desactivada los conserva) | La persona |
| Mensajes de soporte (texto, cuenta que lo envía, instante) | `mensaje_soporte` (migración 24; RF-61) | Atender la consulta | Hasta la baja por anonimización (una cuenta solo desactivada los conserva) | La persona; el administrador del sistema |
| Dirección IP completa de quien visita la vista pública por enlace | Registros del proxy, como la de cualquier petición. El contador `enlace_publico_acceso` (migración 25) guarda solo enlace, día y cuenta: **ninguna dirección** ni identificador de quien visita; la ruta `GET /publico` no entra en `auditoria`; la pantalla del visitante no usa cookies ni carga nada de terceros (`docs/19 §4`, O, punto 9; ✅ 17/11/2026) | Contar cuántas veces se vio un enlace; el límite de tasa y el diagnóstico (el registro del proxy) | El contador, 90 días (`fn_limpiar_accesos_publicos`); el registro del proxy, con la misma rotación por tamaño que el resto de sus registros | El administrador de sitio ve el conteo de su enlace; quien opera el servidor, los registros |
| Título, descripción, nombre del sitio y nombres de zona publicados en un enlace (texto libre; el título hasta 80 caracteres y la descripción hasta 300) | `enlace_publico.titulo`, `enlace_publico.descripcion` y `enlace_publico.zonas` (los nombres de zona fijados al publicar; migración 25), y `sitio.nombre` | Decirle al visitante qué está viendo | Título, descripción y nombres de zona: hasta `retencion_dias` después de que el enlace deja de valer (90 días por omisión, de 31 a 365, lo elige el administrador del sitio al publicar); después se anonimizan (`fn_anonimizar_enlaces_publicos`) y la fila queda para la actividad. El nombre del sitio, mientras exista el sitio | **Cualquiera que tenga el enlace**, sin cuenta, mientras el enlace valga. La pantalla de publicar avisa junto a esos campos: «Este texto lo verá cualquiera con el enlace: sin nombres de personas ni datos personales», y que el nombre del sitio y los de zona también se verán (✅ 17/11/2026) |
| Quién creó y quién revocó cada enlace, y cuándo; quién fijó los ajustes del sitio (el tope de enlaces y el mínimo de dispositivos de la vista pública, y el plazo de espera de la primera trama) | `enlace_publico.creado_por`, `creado_en`, `revocado_por` y `revocado_en` (migración 25) y los eventos `enlace_creado`, `enlace_renovado`, `enlace_revocado`, `enlace_tope`, `enlace_minimo` y `espera_primera_trama` | Saber quién publicó o cambió qué y cuándo (RF-46) | La de `evento`, que hoy no se borra; tras la baja de la cuenta queda el marcador anonimizado de `docs/20 §11` | Los administradores del sitio (en la lista de enlaces y en la actividad del sitio, P14) y el administrador del sistema |
| Todo lo anterior | Respaldos de la base (`docs/10 §9.5`) | Recuperar ante la pérdida del disco o un borrado | 30 días (retención de los respaldos). El volcado (`.dump.age`) y el archivo de credenciales del broker (`.json.age`) se cifran con `age` para las claves públicas de `RESPALDO_DESTINATARIOS`; el despliegue de `docs/14 §7` lo exige (`RESPALDO_EXIGIR_CIFRADO=1`: sin clave, no se escribe respaldo). Sin esa variable el guion respalda en claro. La base en uso, en el disco del servidor, **no** está cifrada (`docs/14 §7.1`, paso 1) y la huella y las sumas del respaldo quedan en claro (`docs/10 §9.5`; ✅ 17/11/2026, `docs/16 §78`) | Quien tiene acceso al servidor ve los archivos pero no puede leerlos; los abre solo quien opera la plataforma, con una de las claves privadas (operador y emergencia), que se guardan fuera del servidor |

**Lo que no se guarda.** Ninguna clave (solo su hash; la temporal se muestra una vez); ningún identificador de sesión (solo su
hash); ningún correo ni nombre en los registros de la aplicación; en los errores del backend (`error_sistema`) y del navegador
(`POST /errores-panel` (Etapa 4)), ni nombre, ni correo, ni dirección IP, ni el cuerpo de la petición, ni el valor de una cookie
(RNF-19): se guardan el código, el mensaje acotado, la ruta sin parámetros de consulta, la versión y el identificador de la petición.
La prueba que lo demuestra planta un error cuyo mensaje lleva un correo y comprueba que la fila guardada no lo tiene.

Las tres filas de la vista pública por enlace se sumaron el 17/11/2026, con la migración 25 (privacidad, versión 2).

### 2.1 Lo que lee la persona (texto de la página de privacidad)
La tabla de §2 es la **trazabilidad interna**: nombres de tablas, columnas y funciones, variables, secciones, fichas y etapas. No viaja a
la pantalla. Esta tabla dice lo mismo **para quien lee**: qué dato, dónde, para qué, cuánto tiempo y quién lo ve, en lenguaje llano y en
presente; lo que aún no existe se dice «todavía no disponible», sin jerga. Una fila por cada fila de §2, en el mismo orden. Es la que
copia `plataforma/backend/src/legal/inventario.ts` y la que muestra la página (§7). Cambiar un dato de §2 obliga a revisar su fila aquí.
Una frase de esta tabla no cita un archivo, una función, una variable de entorno, una ruta de la API, una ficha ni una etapa: la prueba
`legal.spec.ts` lo comprueba. **Toda actualización de este texto sube la versión de la
página y su fecha** (decidido el 18/11/2026), también una corrección de redacción: no depende de acordarse, lo exige una prueba y un paso
del verificador (§7, «Historial de versiones»). La reescritura del 18/11/2026 es la versión 3.

| Dato | Dónde se guarda | Para qué | Cuánto tiempo | Quién lo ve |
|---|---|---|---|---|
| Nombre | En tu cuenta (de 1 a 80 caracteres) | Identificarte en el panel, en la lista de usuarios y en el registro de actividad | Mientras exista tu cuenta; si se da de baja, se reemplaza por un marcador que no te identifica | Tú; los administradores de tus sitios; el administrador del sistema |
| Correo | En tu cuenta (único, en minúsculas: es tu nombre para iniciar sesión) | Iniciar sesión; que el administrador pueda contactarte | Lo mismo que el nombre | Lo mismo que el nombre |
| Clave (guardada de forma irreversible) | En tu cuenta: nunca se guarda la clave misma, solo una versión que no se puede deshacer | Comprobar tu clave al entrar | Mientras exista tu cuenta; con la baja, se borra | Nadie: solo el servidor la compara al entrar |
| Sitios y perfiles | En tu cuenta, con el perfil que tienes en cada sitio | Decidir qué ves y qué puedes hacer | Mientras exista tu cuenta | Tú; los administradores de esos sitios |
| Baja de la cuenta: cuándo, quién y por qué | En tu cuenta | Saber por qué una cuenta no entra y poder reactivarla | Mientras siga inactiva; al reactivarla se borran y el motivo queda en el registro de ese cambio | Los administradores de sus sitios; el administrador del sistema |
| Motivo de baja (texto libre: la pantalla pide escribirlo sin nombres ni datos personales) | En tu cuenta y en el registro de actividad de esa cuenta | Saber por qué se dio de baja una cuenta | Se borra cuando la cuenta se da de baja por completo (se anonimiza) | Los administradores de sus sitios; el administrador del sistema |
| Dirección IP **completa** y navegador (hasta 200 caracteres) | En el registro de sesiones | Reconocer y cerrar sesiones; distinguir ataques dentro de una misma red | 90 días; quien opera el servidor puede fijar otro plazo | El administrador del sistema; tú, tus propias sesiones (en «Mi cuenta», con la dirección acortada; completas en «Exportar mis datos») |
| Dirección IP completa, correo intentado (solo si tiene forma de correo) y resultado | En el registro de accesos | Seguridad: intentos fallidos, bloqueos y cierres de sesión | 90 días (quien opera el servidor puede fijar otro plazo, no menor de 7); el correo intentado se borra antes, con la baja de la cuenta | El administrador del sistema, todo; los administradores de sitio, solo las entradas, salidas y bloqueos de las personas que hoy pertenecen a su sitio, sin la dirección IP ni el correo |
| Usuario, ruta, código y **origen acortado** (la red, sin la parte que identifica al equipo) | Registro de auditoría de la aplicación: todavía no disponible | Saber quién hizo qué y cuándo | Todavía no se guarda; cuando exista, 90 días | Cuando exista, los administradores, solo de sus sitios |
| Dirección IP completa | En los registros del servidor de entrada, un renglón por petición | Diagnóstico y límite de peticiones | Hasta que los registros nuevos reemplazan a los viejos (5 archivos de 10 MB por servicio): depende del tráfico, no de un plazo fijo; todavía no se acorta la dirección | Quien opera el servidor |
| Dirección IP acortada a la red (sin la parte que identifica al equipo); nunca correos ni nombres | En los registros de la aplicación | Diagnóstico | Igual que el anterior (los registros nuevos reemplazan a los viejos) | Quien opera el servidor |
| Aceptación de los términos (versión e instante) | En tu cuenta | Demostrar qué versión aceptaste y cuándo | Mientras exista tu cuenta; se conserva tras la baja, ya sin nombre ni correo | Tú; el administrador del sistema |
| Quién hizo el cambio (la persona que dio de alta, configuró, calibró, rotó o dio de baja un equipo) | En el registro de cambios de cada equipo | Saber quién hizo qué sobre cada equipo («registrado por» en su ficha) | Sin plazo: hoy ese registro no se borra; tras la baja de la cuenta queda un marcador anonimizado, no el nombre | El nombre lo ven solo los administradores de ese sitio y el administrador del sistema; los demás perfiles no ven quién fue |
| Preferencias (unidades de visualización, zona horaria, tema, notificaciones, vistas guardadas) | En tu cuenta | Mostrar los datos como elegiste | Hasta la baja por anonimización (una cuenta solo desactivada las conserva) | Tú |
| Mensajes de soporte (texto, cuenta que lo envía, instante) | En el servicio de soporte | Atender la consulta | Hasta la baja por anonimización (una cuenta solo desactivada los conserva) | Tú; el administrador del sistema |
| Dirección IP completa de quien visita la vista pública por enlace | En los registros del servidor de entrada, como la de cualquier petición. El contador de visitas de cada enlace guarda solo el enlace, el día y la cuenta: ninguna dirección ni identificador de quien visita. La pantalla del visitante no usa cookies ni carga nada de terceros | Contar cuántas veces se vio un enlace; limitar peticiones y diagnosticar | El contador, 90 días; el registro del servidor de entrada, con la misma rotación que el resto de sus registros | El administrador de sitio ve el conteo de su enlace; quien opera el servidor, los registros |
| Título, descripción, nombre del sitio y nombres de zona publicados en un enlace (texto libre; el título hasta 80 caracteres y la descripción hasta 300) | En el enlace publicado y en el sitio | Decirle al visitante qué está viendo | Título, descripción y nombres de zona: hasta el plazo que elige el administrador del sitio al publicar (90 días por omisión, de 31 a 365) después de que el enlace deja de valer; después se borran y queda solo el registro de que el enlace existió. El nombre del sitio, mientras exista el sitio | **Cualquiera que tenga el enlace**, sin cuenta, mientras el enlace valga. Al publicar, la pantalla avisa junto a esos campos: «Este texto lo verá cualquiera con el enlace: sin nombres de personas ni datos personales», y que el nombre del sitio y los de zona también se verán |
| Quién creó y quién revocó cada enlace, y cuándo; quién fijó los ajustes del sitio (el tope de enlaces y el mínimo de dispositivos de la vista pública, y el plazo de espera de la primera trama) | En el registro de cada enlace y en el registro de cambios del sitio | Saber quién publicó o cambió qué y cuándo | Sin plazo: hoy el registro no se borra; tras la baja de la cuenta queda un marcador anonimizado | Los administradores del sitio (en la lista de enlaces y en la actividad del sitio) y el administrador del sistema |
| Todo lo anterior | En los respaldos de la base de datos | Recuperar ante la pérdida del disco o un borrado | 30 días. Los respaldos se guardan cifrados cuando quien opera la plataforma sigue la instalación documentada, que lo exige; la base en uso, en el disco del servidor, no está cifrada | Con los respaldos cifrados, quien tiene acceso al servidor ve los archivos pero no puede leerlos; solo puede abrirlos quien opera la plataforma, con una clave que se guarda fuera del servidor |

## 3. Terceros
**Hoy: ninguno en el camino de los datos de personas ni de las mediciones.**
- **Navegador.** El panel no carga scripts, fuentes, estilos, analítica ni SDK de terceros: todo va en su propio paquete, servido
  por el backend en el mismo origen. La política de contenido que rige (`helmet`, `main.ts`) trae `default-src 'self'` y, como `helmet` por defecto admite fuentes y estilos por https, hoy la garantía real es que el paquete del panel no referencia ningún recurso externo (la política definitiva de `docs/11 §4` cerrará `font-src` y `style-src`); trae además
  `script-src 'self'` (salvo la documentación interactiva bajo `/docs`, apagada por defecto y solo de desarrollo, que admite `'unsafe-inline'`); la definitiva, más estrecha, sigue pendiente en `docs/11 §4`. RNF-20 lo vuelve requisito.
- **Servidor.** Las dependencias son de código abierto y corren en el propio servidor (RNF-15; guardián, paso 2r); ninguna envía
  datos afuera. La telemetría de TimescaleDB está apagada y el guardián lo comprueba en la base (paso 2k). La de los paquetes de npm que
  la traen (Scarf, que llega con una dependencia de la documentación de la API) no corre: la imagen instala con `ignore-scripts` y además
  con `SCARF_ANALYTICS=false` en las dos etapas de instalación del `Dockerfile` (11/11/2026).
- **Operación, fuera del camino de los datos.** La red privada de administración usa un servicio de coordinación de terceros y el
  vigilante externo recibe un latido (`docs/10 §8.4` punto 55): reciben metadatos de operación (llaves públicas, el latido), nunca
  datos de personas ni mediciones.
- **Correo saliente:** no existe en la Etapa 4. Si las notificaciones (HU-24) llegan a usarlo, el proveedor se agrega a esta lista,
  con lo que recibe, **antes** del código.

## 4. Cookies y almacenamiento del navegador
- **Una sola cookie:** `__Host-sesion` (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, sin `Max-Age`; `docs/20 §3`). Es
  estrictamente necesaria: sin ella no hay sesión. Por eso no se pide consentimiento para ella, se informa en la página de privacidad
  (criterio por verificar con la normativa vigente). No hay cookies de analítica, de publicidad ni de terceros.
- **Plazos de la sesión (texto de la página de privacidad):** vence a los **30 minutos sin actividad o a las 8 horas de abierta**, lo que
  ocurra primero (`INACTIVIDAD_MS` y `VIDA_ABSOLUTA_MS`, `sesion/cookie.ts`, constantes del código: no se configuran por instancia); la cookie
  se borra al salir o al cerrar el navegador (no lleva `Max-Age`). La página arma esas frases con esas constantes, así que no puede decir
  otra cosa que el código; si el plazo cambia, cambia el texto y, por §7, la versión.
- **Sin almacenamiento local:** el panel no usa `localStorage`, `sessionStorage` ni IndexedDB (búsqueda en el código del panel el
  08/11/2026); las casillas de «comparar» viven en memoria (`panel/src/lib/comparar.ts`). Las preferencias (iteración 1) se guardan en
  la base, no en el navegador: siguen a la persona entre equipos y no quedan en un equipo compartido.

## 5. Permisos del navegador
- **Solo uno se pide, y solo si la persona lo activa:** el de notificaciones. Toda respuesta lleva `Permissions-Policy: camera=(),
  microphone=(), geolocation=()` (`main.ts`). El botón «Copiar» solo escribe en el portapapeles tras un clic de la persona; nunca lo lee.
- **Notificaciones del navegador** (HU-24; ✅ panel, 11/11/2026): P13 pide el permiso al marcar la primera casilla de «Notificación del
  navegador», nunca al cargar la página; si se niega, el panel sigue avisando dentro de la página. La notificación lleva solo un cuerpo
  genérico («N condiciones nuevas en» el sitio), sin el dispositivo ni el tipo: la puede ver quien mire la pantalla bloqueada; el detalle
  está en el aviso dentro de la página (decidido el 11/11/2026).

## 6. Responsable y contacto
La organización que opera la instancia es la responsable de los datos. Su nombre y su contacto los configura el **administrador del
sistema** (iteración 0) y aparecen en la página de privacidad, en «Acerca de» y en soporte; mientras no estén configurados, el panel
lo dice en esas páginas en vez de mostrar un contacto inventado.

## 7. Base de la página de privacidad y de los términos
**Privacidad** (generada desde §2 a §6): quién es el responsable y cómo contactarlo; qué datos se guardan, para qué, cuánto tiempo y
quién los ve (la tabla de §2.1, que dice §2 en palabras); terceros (§3); cookies y almacenamiento (§4); permisos (§5); derechos y cómo ejercerlos
(§8); versión y fecha del texto.

**Cómo se genera (✅ 11/11/2026, `GET /privacidad` (Etapa 4); texto para personas desde el 18/11/2026).** La tabla de §2.1 (el texto
para personas; §2 es la trazabilidad y no viaja a la pantalla) está copiada, fila por fila, en `plataforma/backend/src/legal/inventario.ts`,
y la prueba `legal.spec.ts` la compara celda por celda con este documento: cambiar §2.1 sin copiar la fila hace fallar `pnpm test` (regla
de concordancia). La misma prueba exige que §2 y §2.1 tengan las mismas filas en el mismo orden, y que ni §2.1 ni los apartados de
`legal/privacidad.ts` traigan jerga interna (rutas de documentos, funciones, variables, fichas, etapas). §3, §4, §5 y §8 van resumidos
en `legal/privacidad.ts`, sin números de sección en la pantalla (aquí se rastrean por el orden: terceros, cookies, permisos, derechos). El responsable y su contacto (§6) salen de `RESPONSABLE_NOMBRE` y `RESPONSABLE_CONTACTO` (`.env.example`, sin
valores); sin ellos, la página lo dice. Los términos viven en `legal/terminos.ts` con `TERMINOS_VERSION` y su fecha. Los avisos de terceros
los escribe `plataforma/backend/generar-avisos-terceros.sh` desde `pnpm licenses list --prod --json` en `panel/public/avisos-de-terceros.txt`
(un guion que se corre al cambiar dependencias, no un paso de la imagen), y el guardián (paso 2r2) falla si una dependencia de producción no
tiene su aviso; por cada licencia distinta de MIT el archivo trae además su texto completo (y el NOTICE si existe). «Acerca de» (`GET /acerca`
(Etapa 4)) da siempre la licencia, su aviso y el enlace al código fuente (`CODIGO_FUENTE_URL`; el `.env.example` trae el del repositorio
público del proyecto; sin él, «pídelo al responsable (Soporte)»), y solo con sesión la versión del `package.json` y el commit de la imagen
(`pila.sh encender` lo pasa como `--build-arg COMMIT`; corrección del 11/11/2026: la versión exacta no se publica a cualquiera).

**Historial de versiones (decidido el 18/11/2026).** Toda actualización del texto que viaja a la pantalla sube su versión en 1 y pone la
fecha del cambio, sin excepción por erratas, y no depende de acordarse. Vale para la página de privacidad y, con el mismo mecanismo, para los
términos. Qué cuenta como «el texto»: lo que el servidor envía y **no depende de la instancia**. Para la privacidad, el inventario de §2.1, los
apartados de §3, §4 (con los plazos de la sesión, tomados de las constantes del código), §5 y §8 resumidos en `legal/privacidad.ts` y el aviso sin responsable; quedan fuera el responsable y su contacto (§6), la
versión y la fecha. Para los términos, todo su texto. La **huella** es el SHA-256 (64 hexadecimales) de una forma canónica de ese texto: JSON
con las claves de cada objeto en orden alfabético, los arreglos en su orden y las cadenas en Unicode NFC (`legal/huella.ts`). Cualquier cambio
de un carácter la cambia. Cada texto tiene su tabla; **la última fila es la versión vigente y las filas publicadas no se reescriben: las nuevas
se agregan al final.**
- Primera guardia, `legal.spec.ts` (`pnpm test`): la huella calculada hoy es la de la última fila; la versión y la fecha del código son las de
  esa fila; las versiones suben de uno en uno desde 1, las fechas no retroceden y ninguna huella se repite. Si el texto cambia sin más, la
  prueba dice qué hacer: subir la versión y la fecha en el código y agregar la fila.
- Segunda guardia, paso 2w7 del verificador: toda fila que ya exista en la versión publicada de este documento (`origin/main`; sin esa
  referencia, `HEAD`) debe estar idéntica aquí. Sin ella se podría «arreglar» la primera guardia cambiando la huella de la versión vigente sin
  subirla. Si la versión publicada aún no tiene la tabla, el historial es nuevo y el paso lo dice; sin git o sin referencia, se omite.
- Subir la versión de **privacidad** solo cambia lo que la página muestra («Versión N, del …»); no pide nada a nadie. Subir la de los
  **términos** obliga a todas las personas a aceptar de nuevo en su siguiente petición (`legal/terminos.ts`, `sesion/sesion.service.ts`).

#### Historial de la privacidad
| Versión | Fecha | Huella | Qué cambió |
|---|---|---|---|
| 1 | 11/11/2026 | — | Primera versión: inventario de datos, terceros, cookies, permisos y derechos. |
| 2 | 17/11/2026 | — | El inventario suma los datos de la vista pública por enlace. |
| 3 | 18/11/2026 | `a5bf99cc0cbcf98571e392442879221b0489eb78998beab7fbf482e9678b4d84` | Texto para personas (§2.1, sin jerga interna); la fila de los respaldos dice lo que hay y con su condición; el registro que falta se llama de auditoría; la sección de cookies dice los plazos de la sesión (tomados del código) y deja de repetirse en el panel; quién fija los ajustes del sitio incluye el plazo de espera de la primera trama. |

Las versiones 1 y 2 son anteriores al mecanismo: no tienen huella («—»), porque no se calculó con el texto de entonces.

#### Historial de los términos
| Versión | Fecha | Huella | Qué cambió |
|---|---|---|---|
| 1 | 11/11/2026 | `8e985704d16122f2fa1dbdfaa4040e1d7415c55669f0075cb5f6d047f88d0ca4` | Primera versión; su fila registra por primera vez la huella (18/11/2026), sin cambio de texto. |

**Qué es «texto legal» y qué es rótulo de la interfaz (frontera, 18/11/2026).** La regla de versión y fecha cubre la **privacidad** y los
**términos**; «Acerca de» (versión del programa, commit, aviso de la licencia, avisos de terceros) **no se versiona**. Dentro de la página de
privacidad es texto legal, y por tanto lo sirve el servidor y entra en la huella, todo lo que afirma qué se hace con los datos de la persona:
las celdas del inventario, los apartados (terceros, cookies y sus plazos, permisos, derechos), el aviso sin responsable y los títulos de esos
apartados. Es rótulo de la interfaz, y puede vivir en el panel sin versión: los nombres de los apartados de la pantalla («Privacidad»,
«Términos de uso», «Acerca de», «Soporte»), el encabezado del inventario («Qué datos se guardan») y los nombres de sus columnas («Dónde»,
«Cuánto tiempo», «Quién accede»), «Responsable de los datos», los mensajes de carga y de error, y el formulario de soporte. Si un rótulo
empezara a afirmar algo sobre los datos (un plazo, un destinatario), deja de ser rótulo: pasa al servidor. El panel no dibuja ningún párrafo
de privacidad propio (hasta el 18/11/2026 dibujaba el de las cookies, con sus plazos escritos a mano; ahora sale de la API).

**Términos de uso:** qué es el servicio y qué no garantiza (es un prototipo, sin compromiso de disponibilidad); la cuenta es personal
y la clave no se comparte; uso aceptable (no probar la seguridad sin autorización, no cargar datos de otros sin permiso); los datos de
un sitio pertenecen a la organización del sitio y se pueden exportar siempre (RF-34); licencia del código (AGPL-3.0-only,
`docs/10 §8.4` punto 33) y avisos de terceros (en «Acerca de»); versión y fecha.

**Cómo se aceptan** (RF-53): la versión vigente es un valor de configuración; `usuario` guarda la versión aceptada y el instante
(migración 24, ✅ 11/11/2026). Al entrar, si la versión aceptada no es la vigente, la pantalla de aceptación es obligatoria, como el
cambio de la clave temporal (`docs/20 §4`): la sesión solo sirve para leer las páginas legales, aceptar o salir. Cambiar la versión
obliga a todos a aceptar de nuevo.

**Acerca de:** versión y commit de la compilación, aviso de la licencia AGPL con el enlace al código fuente, y los avisos de terceros
generados desde `pnpm licenses` (los comprueba el verificador: ninguna dependencia de producción sin su aviso; cómo, arriba).

## 8. Derechos de la persona y cómo se cumplen
| Derecho | Cómo se cumple | Estado |
|---|---|---|
| Acceso | «Mi cuenta», en P13 (`docs/19 §4`), muestra nombre, correo, sitios y roles, sesiones abiertas y la versión de términos aceptada | ✅ panel, 11/11/2026 (P13) |
| Rectificación | El nombre, la propia persona en P13; hoy, el administrador (`docs/20 §10`). El correo, el administrador del sistema (es el nombre de inicio de sesión) | Parcial: por el administrador |
| Supresión | Baja por anonimización (`docs/20 §11`): se borran nombre, correo y hash; quedan filas enlazadas por el id, sin datos personales, para que la auditoría siga cuadrando. `acceso` y `sesion` se vacían a los 90 días; los respaldos, a los 30 | ✅ backend, 11/11/2026 (`POST /cuenta/baja` (Etapa 4)) |
| Portabilidad | Los datos de la cuenta, en JSON desde P13 (`GET /cuenta/exportar` (Etapa 4)); los del sitio, con la exportación según el perfil (RF-34) | ✅ backend, 11/11/2026 |
| Información y reclamo | Contacto del responsable (§6) y formulario de soporte (RF-61) | ✅ 11/11/2026 (P11: `POST /soporte` y el contacto configurado) |

## 9. Cómo se mantiene
Una tabla o columna nueva con datos de personas, un registro nuevo o un tercero nuevo se escribe **primero aquí** (con dónde, para qué,
cuánto tiempo y quién accede) y después en el código; la página de privacidad se regenera desde este inventario. Si cambia el texto que lee la persona (aunque sea una palabra), sube la versión y la fecha y se agrega su fila al historial de §7: sin eso
falla `pnpm test`. Candidato a guardián:
un paso que falle si el panel usa `localStorage`, `sessionStorage` o `document.cookie`, o si carga un recurso de otro origen.
