# 19 · Panel: pantallas y flujos (diseño antes del código)

> Decidido el 12/10/2026: el panel se diseña aquí antes de programarlo, con la misma regla que el resto del sistema
> (`docs/10 §8.4`: manda el diseño documentado; el código lo sigue). Este documento fija **qué pantallas existen, qué muestra y
> qué permite cada una, con qué datos reales se alimenta y en qué tramo entra**. No fija colores ni tipografías. Cuando una
> pantalla exija una ruta de la API que hoy no existe, se dice y se marca como propuesta: el contrato lo fija el `openapi.json`
> al implementarse (`docs/10 §5`). Sin términos de la lista vetada del profesor guía.

## 1. Lo que ya está decidido y aquí se respeta
| Decisión | Dónde | Consecuencia para el panel |
|---|---|---|
| Svelte + Vite, sin SvelteKit; gráficos con uPlot; el panel vive en `plataforma/backend/panel/` y lo sirve el backend en `/panel` | `docs/07`, `docs/10 §8.4` | Una sola aplicación de página única; rutas por fragmento (`/#/…`) para no chocar con la API; sin servidor propio |
| Tiempo real por SSE (`GET /eventos`), histórico agregado por la base (`time_bucket`) | `docs/10 §5` | El panel pide pocos puntos y añade los nuevos al final; nunca pide «todas las mediciones» |
| Sin sesión en la Etapa 3 (red local); sesión, roles por sitio y vista pública por enlace en la Etapa 4 | `docs/11 §4`, `docs/10 §8.4` puntos 6 y 36 | En la Etapa 3 el panel no pregunta quién eres; todo lo que escribe (configurar, dar de alta) espera a la sesión, salvo lo que ya se decidió hacer por API |
| Panel configurable con bloqueo optimista (umbrales, histéresis, intervalo esperado, estado, nombre); 409 si alguien cambió la fila entretanto | `docs/10 §8.4` punto 28 | Cada formulario lleva el `actualizado_en` que leyó; el 409 se muestra como «alguien lo cambió, recarga» |
| La vía de envío, el formato y la pasarela se declaran al dar de alta; la credencial depende de la vía | `docs/10 §8.4` punto 25 | El alta es un asistente por pasos, no un formulario plano |
| Exportación en CSV, XLSX y JSON; vista pública de solo lectura por enlace | `docs/10 §8.4` puntos 37 y 6; RF-34 | Dos pantallas de la Etapa 4 con su ruta propia |
| Mudar un dispositivo conserva el historial de ubicaciones | `docs/10 §8.4` punto 39 | La mudanza es una acción de la ficha, en la Etapa 4 |
| Toda hora se muestra en la zona del sitio, con el instante UTC disponible | `docs/13` | Cada hora visible lleva el UTC al pasar el cursor; la zona se lee de `zona_horaria` |
| Utilizable desde un navegador móvil | RF-52 | Una columna en pantallas angostas; tablas con desplazamiento horizontal; gráficos al ancho disponible |

## 2. Vocabulario visual: el estado de un dispositivo en cuatro valores
La referencia observada en una nube comercial (cuatro estados con conteo visible, la misma leyenda en la lista y en el resumen)
es exactamente lo que piden RF-30, RF-47 y RF-48. Se adopta como **regla de presentación**, calculada en el panel a partir de
campos que la API ya devuelve (`estado`, `en_linea`, `condiciones_abiertas` y el `tipo` de cada condición abierta). No cambia
el modelo de datos.

| Estado visual | Regla (en este orden; la primera que aplica manda) | Qué significa para quien mira |
|---|---|---|
| **Inactivo** | `estado` es `mantenimiento` o `baja` | Nadie espera datos de él; no genera alertas (RF-22) |
| **Sin señal** | hay una condición `sin_comunicacion` abierta, o `en_linea` es falso | Dejó de reportar más allá de su intervalo esperado (RF-24) |
| **Alerta** | hay una condición abierta de tipo `umbral`, `bateria` o `manipulacion` | Reporta, pero algo está fuera de lo normal |
| **Normal** | ninguna de las anteriores | Reporta a tiempo y dentro de rango |

`en_linea` lo trae la API, pero el panel lo recalcula con la misma regla (visto dentro de 2 × intervalo esperado) para que cambie
con cada `visto` del canal en vivo y con el paso del tiempo sin repedir el inventario; sin ninguna trama todavía es nulo y el
dispositivo se muestra **Normal** hasta la primera.

El estado nunca se comunica solo por color: lleva su palabra al lado (accesibilidad, y porque los colores se imprimen mal). La
función que lo calcula es una sola, con prueba unitaria por cada fila de la tabla y por el orden entre filas.

## 3. Mapa de pantallas
| # | Pantalla | Qué muestra | Acciones | Datos (ruta real o propuesta) | Requisitos | Cuándo |
|---|---|---|---|---|---|---|
| P1 | **Resumen del sitio** | Conteo por estado visual (los cuatro), condiciones abiertas, últimas tramas rechazadas, estado del servicio | Ir a cada lista filtrada | `GET /dispositivos`, `GET /condiciones?abiertas=true`, `GET /cuarentena?limite=5`, `GET /salud` | RF-30, HU-16 | Etapa 4 (`docs/04`); los conteos por estado ya aparecen en P2 desde la Etapa 3 |
| P2 | **Inventario** | Tabla: estado visual, nombre, identificador físico, vía, zona, última trama (hace cuánto), condiciones abiertas; filtros por estado, zona y vía con conteo | Abrir la ficha; filtrar; buscar por nombre o identificador | `GET /dispositivos` y `GET /condiciones?abiertas=true&limite=500` (el tipo de cada condición abierta decide el estado, §2; filtra el panel: hoy la API no filtra) | Semáforo y tabla: RF-47, RF-48, HU-10, HU-19. Filtros y búsqueda: RF-51, HU-20 (adelantada a la Etapa 3 el 12/10) | Etapa 3, tramo 2 |
| P3 | **Ficha del dispositivo** | Identidad (nombre, identificador, vía, formato, zona, sitio, intervalo esperado, desde cuándo); estado visual; por canal: última lectura con unidad y reglas de umbral; gráfico histórico por canal (rango y agregación elegibles) que sigue en vivo; condiciones abiertas y cerradas del dispositivo; sus tramas rechazadas | Cambiar canal, rango e intervalo; pausar el vivo; ir a configurar (P6) o a mudar (Etapa 4) | `GET /dispositivos/{id}`, `GET /canales/{id}/historico?desde&hasta&intervalo`, `GET /eventos?dispositivo=`, `GET /condiciones`, `GET /cuarentena` | RF-33, RF-49, HU-21 (adelantada a la Etapa 3 el 12/10, con sus 7 h); el rango a medida por fechas es HU-07 (Etapa 4) | Etapa 3, tramo 3 |
| P4 | **Condiciones** | Lista con tipo, dispositivo, magnitud y umbral, abierta en, duración; filtro abiertas / todas | Abrir la ficha del dispositivo | `GET /condiciones?abiertas&limite` | HU-05, RF-24 | Etapa 4 (lista sobre lo que la API ya devuelve) |
| P5 | **Cuarentena** | Últimas tramas rechazadas: cuándo, por qué (`no_registrado`, `dado_de_baja`, `malformada`, `invalida`), detalle, dispositivo si se conoce, la trama cruda plegada | Copiar la trama; ir al alta si el motivo es `no_registrado` | `GET /cuarentena?limite` | RF-11 a RF-13 | Etapa 4 (lista sobre lo que la API ya devuelve) |
| P6 | **Configurar dispositivo y canales** | Nombre, estado (activo / mantenimiento), intervalo esperado; por canal, umbral alto, umbral bajo, histéresis | Guardar con bloqueo optimista; validación en vivo (bajo < alto, histéresis dentro de la banda, rango de la magnitud) | **Propuesta:** `PATCH /dispositivos/{id}`, `PUT /canales/{id}/reglas` | HU-06, HU-13, punto 28 | Etapa 4 (exige sesión) |
| P7 | **Alta de dispositivo** (asistente) | Paso 1 identidad y zona; paso 2 vía y formato (y pasarela si LoRaWAN); paso 3 canales y magnitudes; paso 4 credencial según la vía, mostrada una sola vez; paso 5 «esperando la primera trama» en vivo | Crear; copiar la credencial y el tópico | **Propuesta:** `POST /dispositivos` (la API en la Etapa 3, HU-11; la pantalla en la 4, HU-22) | RF-50, HU-11, HU-22, punto 25 | API: Etapa 3; pantalla: Etapa 4 |
| P8 | **Exportar** | Sitio, rango, magnitudes, formato (CSV, XLSX, JSON); tamaño estimado antes de descargar | Descargar | **Propuesta:** `GET /sitios/{id}/exportar?formato&desde&hasta` | RF-34, HU-08 | Etapa 4 |
| P9 | **Vista pública por enlace** | Solo lo que el administrador eligió: magnitudes agregadas, sin trama cruda ni identificadores | Ninguna | **Propuesta:** `GET /publico/{token}` | punto 6 | Etapa 4 |
| P10 | **Sesión y usuarios** | Entrar, salir; usuarios del sitio y su rol | Administrar | **Propuesta:** `POST /sesion` y rutas de usuario | RF-43, RF-44, HU-18 | Etapa 4 |

Lo que **no** se construye, y por qué: mapa (ningún requisito lo pide; el caso de uso tiene decenas de dispositivos, no cientos
dispersos), informes programados y disparadores con varias condiciones (más que el umbral con histéresis decidido; candidatos
para después de la Etapa 4 si sobra tiempo), compartir dispositivos entre cuentas (lo cubren los roles por sitio).

## 4. Las pantallas en detalle, en el orden en que se construyen
**P2 Inventario con semáforo (tramo 2, Etapa 3; es HU-19).** Es la pantalla de entrada mientras no exista P1. Arriba, cuatro fichas con el conteo por estado
visual, que al pulsarlas filtran la tabla (misma leyenda que en P1 y P3). Columnas: estado visual, nombre, identificador físico,
vía, zona, última trama como «hace 3 min» con la hora exacta al pasar el cursor, condiciones abiertas. Orden por defecto: los
que requieren atención primero (Sin señal, Alerta, luego Normal, luego Inactivo), y dentro de cada grupo por nombre. Filtros
por zona y vía con conteo y búsqueda por texto: HU-20, en el mismo tramo (adelantada el 12/10). Vacío: «Sin dispositivos registrados» con la referencia al alta por API (`docs/10
§3` y §8.4 punto 25). Esta pantalla es la que comprueba el reenvío de Vite en desarrollo (`docs/11 §4`): una petición real a la API y una al
canal en vivo, y se mira en el backend que el `Host` llegue con el puerto del servidor de desarrollo y que los eventos no se
retengan.

**P3 Ficha (tramo 3, Etapa 3; es HU-21, adelantada el 12/10).** Cabecera con nombre, estado visual y los datos de identidad en dos columnas (una en móvil). Después,
una tarjeta por canal: magnitud, última lectura con unidad y hace cuánto, reglas de umbral si existen. Debajo, el gráfico del
canal elegido: rango (última hora, 24 h, 7 días, 30 días, a medida) e intervalo de agregación de la lista cerrada de la API;
el panel pide el histórico y abre el canal en vivo filtrado por dispositivo; cada `medicion` nueva del canal visible se añade al
final sin repedir el histórico; cada `visto` actualiza «hace cuánto»; cada `condicion` actualiza la lista de condiciones y el
estado visual. Si el gráfico muestra un intervalo agregado (por ejemplo, promedios por hora), el punto en vivo se dibuja aparte,
como «lectura actual», para no mezclar un valor crudo con promedios. Botón «pausar en vivo». Al final, condiciones del
dispositivo (abiertas arriba) y sus tramas rechazadas.

**P4 Condiciones y P5 Cuarentena (Etapa 4).** Dos listas con filtro y paginación por `limite`; cada fila lleva a la ficha. En
P5 la trama cruda va plegada (es texto largo) con un botón de copiar.

**P1 Resumen (Etapa 4).** Se arma con lo que ya devuelven las rutas: los conteos por estado visual salen de `GET
/dispositivos` (en la Etapa 3 los calcula el panel; cuando haya cientos de dispositivos, una ruta de resumen en el servidor, que
hoy no hace falta). El estado del servicio muestra `GET /salud` y si el canal en vivo está conectado.

## 5. Flujos
**F1 · Alta y primera trama.** Ya está dibujado en el diagrama de secuencia del alta (`docs/10`, figura del informe): el
administrador crea el dispositivo (API en la Etapa 3), recibe la credencial una sola vez, configura el nodo, y el panel
muestra «esperando la primera trama» hasta que llega un `visto` por el canal en vivo.

**F2 · Cambiar un umbral con conflicto (Etapa 4).** 1) El administrador abre P6; el panel guarda el `actualizado_en` que leyó.
2) Edita umbral alto y bajo; la validación vive en la misma función que usa el guardado. 3) Guarda: `PUT` con el
`actualizado_en`. 4) Si otra persona cambió la regla entretanto, 409: el panel muestra «alguien la cambió a las 10:42; recarga
para ver el valor nuevo» y no pisa nada. 5) Si guardó, la regla rige desde la trama siguiente; una condición abierta se
reevalúa con esa trama (punto 28); la auditoría deja un `evento`.

**F3 · Silencio, condición y mantenimiento.** 1) Un dispositivo deja de reportar; el supervisor abre `sin_comunicacion` tras
dos intervalos esperados. 2) El canal en vivo emite `condicion`; en P2 el dispositivo sube al grupo «Sin señal» y en P1 cambia
el conteo, sin recargar. 3) El administrador lo revisa en terreno y lo marca «en mantenimiento» (P6, Etapa 4; hasta entonces,
por SQL o API): pasa a «Inactivo» y no genera alertas (RF-22). 4) Al volver a reportar como activo, el supervisor cierra la
condición y el estado vuelve a «Normal».

**F4 · El canal en vivo se cae.** `EventSource` reintenta solo ante un corte de red, no ante un 503 (cupo lleno) ni un 403.
El panel envuelve el canal: si recibe 503 o 403, o si pasan 60 s sin latido (el backend manda uno cada 25 s), cierra y vuelve
a abrir con espera de 1, 2, 4… hasta 30 s, y muestra «en vivo: reconectando» en la cabecera. Al reconectar, repide el
histórico del rango visible, porque pudo perder mediciones mientras estuvo caído: el canal no guarda cola.

**F5 · Exportar (Etapa 4).** Elegir sitio, rango, magnitudes y formato; el panel muestra cuántas filas serán antes de
descargar; la descarga exige rol de administrador; la vista pública nunca ofrece exportar (punto 6).

## 6. Reglas transversales
- **Errores con acción:** cada código tiene un texto y un siguiente paso (400 «revisa el filtro», 404 «ya no existe, vuelve
  al inventario», 409 «recarga», 421 y 503 «el servicio no está disponible desde esta dirección / está saturado; reintentando»).
- **Vacíos con camino:** ninguna lista queda en blanco; dice qué significa estar vacía y qué hacer.
- **Sin scripts en línea** ni recursos externos: la CSP del backend (`docs/11`) prohíbe ambos; fuentes y estilos van en el
  paquete del panel. Los `.map` no se publican.
- **Pruebas por el DOM, en los dos sentidos**: lo que debe mostrarse se lee del DOM (textos, conteos, filas), lo que debe
  frenarse se comprueba que no aparece; y una prueba de que el estado visual de cada fila coincide con la función de la §2.
  Corren sobre el código fuente en jsdom; el build que sirve el backend se comprueba aparte con `pruebas/panel-desarrollo.sh`
  (cabeceras, CSP, paquete con hash, sin `.map`); una prueba con navegador real no existe todavía (`docs/16`).
- **Un solo cliente HTTP** en el panel, que añade el prefijo de la API, interpreta los códigos y expone el 409 como tal.
- **Rendimiento:** el histórico llega agregado (cientos de puntos); uPlot dibuja; el vivo añade al final; en P2 la tabla se
  recalcula solo con los eventos recibidos, no repidiendo el inventario cada vez.

## 7. Trazabilidad y prueba de cada pantalla
| Pantalla | Requisitos | Entra en | Cómo se prueba |
|---|---|---|---|
| P2 Inventario con semáforo y filtros | RF-47, RF-48, RF-51, HU-10, HU-19, HU-20 | Tramo 2 (Etapa 3) | Semilla conocida → conteos y filas en el DOM; un dispositivo en mantenimiento aparece «Inactivo»; filtro por vía reduce la tabla; el reenvío de Vite conserva el `Host` y no retiene el canal (`pruebas/panel-desarrollo.sh`, `docs/16 §16`) |
| P3 Ficha | RF-33, RF-49, HU-21 | Tramo 3 (Etapa 3) | Histórico: los puntos del DOM coinciden con `/historico`; vivo: publicar una trama por MQTT y verla aparecer sin recargar; reconexión: apagar el backend 5 s y ver «reconectando» y luego la medición perdida tras repedir |
| P4 Condiciones, P5 Cuarentena | HU-05, RF-11 a RF-13, RF-24 | Etapa 4 | Trama fuera de rango → fila en P4 en vivo; trama de un desconocido → fila en P5 con motivo `no_registrado` |
| P1 Resumen | RF-30, HU-16 | Etapa 4 | Los cuatro conteos suman el total del inventario; cambian en vivo con F3 |
| P6 a P10 | HU-06, HU-08, HU-11, HU-13, HU-18, HU-22; RF-34, RF-43, RF-44, RF-50 | Etapa 4 |

La etapa de cada pantalla es la de su historia en `docs/04`; mover una historia de etapa se decide con sus horas y se cambia
primero allí (y en `docs/18`), nunca aquí. Matriz de acceso ruta × rol (`docs/11 §4`) y las pruebas de 409 con dos ediciones simultáneas |
