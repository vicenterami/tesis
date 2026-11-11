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

## 2. Inventario de datos personales (al 11/11/2026)
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
| Todo lo anterior | Respaldos de la base (`docs/10 §9.5`) | Recuperar ante la pérdida del disco o un borrado | 30 días (retención de los respaldos); cifrados en reposo desde la iteración 1 | Quien opera el servidor, con la clave del cifrado fuera de él |

**Lo que no se guarda.** Ninguna clave (solo su hash; la temporal se muestra una vez); ningún identificador de sesión (solo su
hash); ningún correo ni nombre en los registros de la aplicación; en los errores del backend (`error_sistema`) y del navegador
(`POST /errores-panel` (Etapa 4)), ni nombre, ni correo, ni dirección IP, ni el cuerpo de la petición, ni el valor de una cookie
(RNF-19): se guardan el código, el mensaje acotado, la ruta sin parámetros de consulta, la versión y el identificador de la petición.
La prueba que lo demuestra planta un error cuyo mensaje lleva un correo y comprueba que la fila guardada no lo tiene.

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
quién los ve (la tabla de §2, en palabras); terceros (§3); cookies y almacenamiento (§4); permisos (§5); derechos y cómo ejercerlos
(§8); versión y fecha del texto.

**Cómo se genera (✅ 11/11/2026, `GET /privacidad` (Etapa 4)).** La tabla de §2 está copiada, fila por fila, en
`plataforma/backend/src/legal/inventario.ts`, y la prueba `legal.spec.ts` la compara celda por celda con este documento: cambiar §2 sin
copiar la fila hace fallar `pnpm test` (regla de concordancia). §3, §4, §5 y §8 van resumidos en `legal/privacidad.ts`, cada uno con su
número para ir a la fuente. El responsable y su contacto (§6) salen de `RESPONSABLE_NOMBRE` y `RESPONSABLE_CONTACTO` (`.env.example`, sin
valores); sin ellos, la página lo dice. Los términos viven en `legal/terminos.ts` con `TERMINOS_VERSION` y su fecha. Los avisos de terceros
los escribe `plataforma/backend/generar-avisos-terceros.sh` desde `pnpm licenses list --prod --json` en `panel/public/avisos-de-terceros.txt`
(un guion que se corre al cambiar dependencias, no un paso de la imagen), y el guardián (paso 2r2) falla si una dependencia de producción no
tiene su aviso; por cada licencia distinta de MIT el archivo trae además su texto completo (y el NOTICE si existe). «Acerca de» (`GET /acerca`
(Etapa 4)) da siempre la licencia, su aviso y el enlace al código fuente (`CODIGO_FUENTE_URL`; el `.env.example` trae el del repositorio
público del proyecto; sin él, «pídelo al responsable (Soporte)»), y solo con sesión la versión del `package.json` y el commit de la imagen
(`pila.sh encender` lo pasa como `--build-arg COMMIT`; corrección del 11/11/2026: la versión exacta no se publica a cualquiera).

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
cuánto tiempo y quién accede) y después en el código; la página de privacidad se regenera desde este inventario. Candidato a guardián:
un paso que falle si el panel usa `localStorage`, `sessionStorage` o `document.cookie`, o si carga un recurso de otro origen.
