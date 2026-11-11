# 11/11/2026 — ES modules, diseño y construcción del tablero v2, cinco perfiles, cuenta y pantallas de operación

**Contexto.** Tras el plan v2 de la Etapa 4 (`docs/04 §8`) y la decisión de poner primero lo que la persona ve y opera, la jornada
cubrió cuatro bloques encadenados, cada uno con diseño escrito antes del código, revisión independiente en tres frentes (seguridad;
concordancia entre documentación, código, configuración e informe; privacidad y licencias) y verificador en verde antes de commitear.

**ES modules (commit `4652103`).** El backend pasó a ES modules (`"type": "module"`, `nodenext`, importaciones con extensión,
`import.meta.dirname`) y las pruebas unitarias de jest a vitest, con tsx para el emulador. Motivo: `@nestjs/config` 12 se publica
solo como ES module y bloqueaba el salto a NestJS 12. Hallazgo del bloque: en ES modules las importaciones se evalúan antes que el
cuerpo del archivo, así que la zona UTC del proceso pasó a un módulo propio importado primero. Las 445 pruebas siguieron iguales; el
lockfile bajó de 856 a 601 paquetes (`docs/16 §60`).

**Diseño y comparativa (commit `a50f5e5`).** `docs/22` compara siete referentes (ThingsBoard CE, Grafana, OpenRemote, Magistrala,
Milesight IoT Cloud, Ubidots y TagoIO) y las normas WCAG 2.2 con cita y URL, y `docs/19 §4` fija el tablero v2: armazón y tokens,
tema claro y oscuro, paleta de series validada con un método reproducible en los dos temas, tablero del sitio, inventario y ficha
renovados, configuración con retardo de activación, alta masiva y bandeja de detectados, actividad, preferencias y sesiones, y el
contrato de la API con sus campos (`docs/10 §8.4` punto 65).

**Backend y panel del tablero (mismo commit).** Migración 23; resumen e históricos del sitio y del dispositivo; inventario con
filtros, orden y paginación en el servidor y el estado visual calculado también en SQL; cursores y totales en cabeceras;
configuración con bloqueo optimista; alta masiva en una transacción; retardo de activación guardado en la base. En el panel, el
tablero con indicadores, salud, condiciones por tipo y una gráfica por magnitud; zoom por arrastre que refina la resolución; rango a
medida en la URL; umbrales y condiciones dibujados; tarjetas en teléfono; gráficas con nombre y tabla accesibles. Al medir con 120
fuentes y 30 días, un alta individual durante un lote de 500 tumbaba el proceso: el resumen de la credencial salió de la transacción y
el cliente de base ganó un oyente de error (`docs/16 §61` y `§62`). Quedó abierta la decisión del costo de scrypt en el lote (70 s por
500 credenciales).

**Cinco perfiles, cuenta y pantallas (tercer commit).** Migración 24 y matriz de cinco perfiles probada con una sesión por perfil;
preferencias, sesiones propias, exportación de los datos propios y baja por anonimización; términos con aceptación obligatoria; privacidad
generada desde el inventario de `docs/21`; «Acerca de» con el enlace al código que exige la AGPL; soporte; actividad del sitio. En el
panel, las pantallas de configurar, alta (asistente, archivo por tandas y detectados), preferencias y mi cuenta, actividad y legal, con
la prueba en navegador real en Chromium y Firefox a 390 y 1 280 px (`docs/16 §63` y `§64`).

**Revisiones del día.** Cuatro pasadas de tres frentes: 13 hallazgos en ES modules (7 aplicados), 28 en el panel, 45 en el backend y 40
en perfiles y pantallas, verificados uno por uno antes de corregir. Entre lo que no habría visto el verificador: el panel enviaba el
código del sitio donde la API espera el id; el tiempo de los cubos de tramas llegaba en segundos y se leía como texto; el lote revelaba
identificadores de dispositivos de otros sitios; dos rutas respondían 500 ante fechas imposibles; y un administrador de sitio podía
asignar una clave temporal al administrador del sistema si este tenía membresía en su sitio.

**Lecciones.** (1) Diseñar el contrato con nombres y formas exactas antes de construir backend y panel en paralelo evita casi todo;
lo que queda lo encuentra una revisión que lee los dos lados. (2) Una medición con datos realistas (120 fuentes, 30 días) encuentra
fallas que las pruebas unitarias no ven. (3) Cada bloque cerrado se congela en un parche y se commitea desde el índice, para que el
historial quede por bloque aunque el trabajo siguiente ya haya empezado.
