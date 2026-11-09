# 08–09/11/2026 — Sesión de personas, panel con entrada y parches de las imágenes: arranque de la Etapa 4

**Contexto.** Con la Etapa 3 entregada el 05/11, la Etapa 4 arrancó por el bloque 1 del plan (`docs/04 §8`): la sesión de personas,
usuarios y roles por sitio diseñada en `docs/20`. Se construyó en dos tramos, cada uno con una revisión independiente de tres lentes
(seguridad; concordancia entre documentación, código, configuración e informe; privacidad y licencias) antes de commitear, y se desplegó en
el servidor de prueba de la institución.

**Backend (commit `da71f83`).** Migración 22 (clave temporal con vencimiento en `usuario`, baja lógica en `usuario_sitio`, tablas `sesion` y
`acceso`, esta última hypertable con retención de 90 días); módulo de sesión con cookie `__Host-sesion` con estado en la base (identificador
aleatorio de 32 bytes, solo su hash en la base; 30 minutos sin actividad u 8 horas), claves con scrypt (N = 2¹⁷, dos cálculos a la vez),
bloqueos por usuario e IP, cabecera `X-Pedido: panel` contra CSRF; guardia central con la matriz de `docs/20 §6`, donde un recurso de otro
sitio responde 404; usuarios con clave temporal; canal en vivo por sesión, revalidado en cada latido. La revisión encontró 49 hallazgos, uno
alto: un administrador de un sitio podía desactivar o asignar clave temporal a una persona que también administraba otro sitio; corregido
(los datos de la cuenta solo los toca quien administra todos sus sitios). Todo quedó aplicado o asumido con registro en `docs/20 §10`
(R1–R21). Pruebas: 445 unitarias y 124 comprobaciones de humo (paso 4b del verificador).

**Panel (commit `5ebe2ba`).** Pantalla de entrada, cambio obligatorio de la clave temporal, salida y «cerrar en todos lados», pantalla de
usuarios con la guía de perfiles generada desde la misma matriz de permisos que usa el backend, componentes reutilizables (botón con etiqueta
y ayuda accesible por ratón y teclado, tooltip, aviso), cliente HTTP único (cabecera anti-CSRF en lo que escribe; 401, 403, 409 y 429
tratados en un solo lugar; descargas con sesión por `fetch`, nunca por enlace directo) y semilla con personas de demostración. La revisión
encontró 23 hallazgos, aplicados. Pruebas: 165 del panel y 118 de extremo a extremo en Chromium y Firefox a 390 y 1 280 px (paso 4c nuevo),
que atraparon cinco defectos invisibles para las unitarias, entre ellos claves temporales guardadas con un salto de línea con las que nadie
podía entrar. Decisión del 08/11: la clave temporal vale 2 horas por defecto, configurable por el operador (`CLAVE_TEMPORAL_HORAS`).

**Parches (commit `c6aa96e`).** El escáner de imágenes marcó vulnerabilidades con parche publicado en las cuatro imágenes; se aplicaron en
los Dockerfile y en el compose (huellas nuevas de Mosquitto, nginx y Node; paquetes corregidos por `apk` y `apt`) hasta dejar el escaneo en
OK; lo que no tiene parche publicado quedó documentado como residuo en `docs/11 §4` y `docs/16 §12`.

**Servidor de prueba (09/11).** Migración 22 y permisos del rol aplicados, imágenes reconstruidas y escaneadas en OK, primer administrador
creado con la clave por cabecera y **clave retirada del servidor** (`docs/20 §4`): desde entonces la cabecera responde 503 y solo entran
personas con sesión; el panel con entrada opera por la red privada de administración. Queda pendiente un certificado público para el
nombre de esa red (`docs/11 §4`), para que un teléfono sin la CA propia instalada no avise de conexión no privada.

**Lecciones.** (1) Una batería de humo que bloquea su propia dirección por intentos fallidos no se puede repetir en 15 minutos: ahora cada
corrida sale desde otra dirección del bucle local. (2) Las pruebas en navegador real encuentran lo que las unitarias no ven. (3) Lo que el
diseño promete («no un tercer rol», «IP truncada», «bajo el techo de memoria») se contrasta con lo que el código guarda y con lo que se mide,
fila por fila: tres de esas promesas resultaron imprecisas y se corrigieron en el documento o en el código.
