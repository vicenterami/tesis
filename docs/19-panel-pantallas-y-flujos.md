# 19 · Panel: pantallas y flujos (diseño antes del código)

> Decidido el 12/10/2026: el panel se diseña aquí antes de programarlo, con la misma regla que el resto del sistema
> (`docs/10 §8.4`: manda el diseño documentado; el código lo sigue). Este documento fija **qué pantallas existen, qué muestra y
> qué permite cada una, con qué datos reales se alimenta y en qué tramo entra**. No fija colores ni tipografías. Cuando una
> pantalla exija una ruta de la API que hoy no existe, se dice y se marca como propuesta: el contrato lo fija el `openapi.json`
> al implementarse (`docs/10 §5`). Sin términos de la lista vetada del profesor guía.
>
> **08/11/2026 (plan de la Etapa 4, versión 2, `docs/04 §8`):** se suman las reglas transversales de botones, tablas, paginación,
> renderizado optimista y avisos (§6), las pantallas P11 «Legal y acerca de», P12 «Estado del sistema» y P13 «Preferencias» (§3 y §4),
> los cinco perfiles en P10 (`docs/20 §6`) y el rediseño de P1 con una comparativa previa de referentes y de normas (§4).
>
> **16/11/2026 (bloque O, §4):** se diseña P9 «Vista pública por enlace» (RF-62, HU-32, dentro del núcleo): solo promedios, con vencimiento, revocación y un mínimo de dispositivos por valor.

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

## 2. Vocabulario visual: el estado de un dispositivo en cinco valores
La referencia observada en una nube comercial (cuatro estados con conteo visible, la misma leyenda en la lista y en el resumen)
es exactamente lo que piden RF-30, RF-47 y RF-48. Se adopta como **regla de presentación**, calculada en el servidor (en SQL, para filtrar y paginar, desde el 11/11/2026) y en el panel (para actualizar en vivo) a partir de
campos que la API ya devuelve (`estado`, `visto_por_ultima_vez`, `intervalo_esperado_s`, `en_servicio_desde`, `espera_hasta`, `condiciones_abiertas` y el `tipo` de cada condición abierta).
**Quinto valor desde el 18/11/2026: «Esperando primera trama».** Hasta entonces un dispositivo dado de alta que nunca envió una trama se
mostraba «Normal» y no alarmaba nunca: el supervisor compara contra la última trama, que no existía (en el servidor de prueba, dos equipos
así figuraban «Normal» con entrega 0 %). Desde esa fecha espera su primera trama un plazo que fija cada sitio (`sitio.espera_primera_trama_h`,
de 1 a 2 160 horas, 168 por omisión: un alta masiva suele ir días antes de instalar los equipos) contado desde que **entró en servicio**
(`dispositivo.en_servicio_desde`: el alta, y cada vuelta a `activo` desde `mantenimiento`; migración 26); vencido el plazo, pasa a «Sin señal»
y el supervisor abre la condición de falta de comunicación como a cualquier otro (RF-24; `docs/10 §4`).

| Estado visual | Regla (en este orden; la primera que aplica manda) | Qué significa para quien mira |
|---|---|---|
| **Inactivo** | `estado` es `mantenimiento` o `baja` | Nadie espera datos de él; no genera alertas (RF-22) |
| **Sin señal** | hay una condición `sin_comunicacion` abierta | El supervisor lo dio por callado (RF-24) |
| **Esperando primera trama** | nunca envió una trama y aún no vence `en_servicio_desde` + la espera del sitio (`espera_hasta`) | Recién dado de alta o vuelto a servicio: todavía no se le exige reportar |
| **Sin señal** | nunca envió una trama y ya venció `espera_hasta`; o ya envió, y el más reciente entre su última trama y `en_servicio_desde` es anterior a 2 × su intervalo esperado (`en_linea` falso) | Dejó de reportar más allá de su intervalo esperado, o nunca reportó dentro del plazo (RF-24) |
| **Alerta** | hay una condición abierta de tipo `umbral`, `bateria`, `manipulacion`, `tope_superado` (manda más de lo que cabe en su hora, `docs/10 §8.4` punto 53) o `reloj_desviado` («Reloj de pasarela desviado»: los datos siguen entrando, pero fechados por la recepción, `docs/10 §8.4` punto 54) | Reporta, pero algo está fuera de lo normal |
| **Normal** | ninguna de las anteriores | Reporta a tiempo y dentro de rango |

Los bordes: el plazo vence en el instante `espera_hasta` exacto (desde ahí, «Sin señal»); una trama vista exactamente 2 × intervalo atrás
todavía está en línea. `en_linea` lo trae la API, pero el panel lo recalcula con la misma regla (el más reciente entre `visto` y
`en_servicio_desde`, dentro de 2 × intervalo esperado) para que cambie con cada `visto` del canal en vivo y con el paso del tiempo sin volver
a pedir el inventario; sin ninguna trama todavía es nulo (ni en línea ni fuera de línea) y manda la espera. Contar desde
`en_servicio_desde` evita la falsa alarma de quien vuelve de mantenimiento con su última trama vieja: se le da otra vez un intervalo
completo, como a uno recién instalado. `espera_hasta` lo calcula la API (`en_servicio_desde` + la espera del sitio) y es nulo si el
equipo ya envió alguna trama. Cambiar un equipo de zona o de sitio **no** reinicia su plazo: cuenta desde que entró en servicio, no desde dónde
está, así que mudarlo no le da más tiempo ni se lo quita (el plazo que rige es el del sitio donde esté en ese momento). Pasar un equipo a
mantenimiento cierra las condiciones que tuviera abiertas, de cualquier tipo, con su evento (`por: mantenimiento`) y su aviso en vivo, y
mientras siga en mantenimiento no se le abre ninguna, aunque envíe tramas (el barrido cierra las que ya existían): quien está inactivo no genera alertas (RF-22) y el resumen no puede contar una falta de
comunicación con cero equipos en «Sin señal». Quien espera **no es supervisado todavía**: no cuenta en la salud del sitio (§4, B2) ni en «Ahora», su
entrega es nula («—», no «0 %») y va en el orden de atención después de Normal y antes de Inactivo (no requiere acción).

El estado nunca se comunica solo por color: lleva su palabra al lado (accesibilidad, y porque los colores se imprimen mal); «Esperando
primera trama» lleva además un icono de reloj y un tono informativo (el de la píldora de navegación, `--pildora`), distinto del gris de
Inactivo, sin colores nuevos. La función que lo calcula es una sola, con prueba unitaria por cada fila de la tabla y por el orden entre
filas; desde el 18/11/2026 las dos implementaciones (la del servidor, en TypeScript y en SQL, y la del panel) se prueban con **la misma
tabla de casos**, un archivo del panel que leen las tres (`panel/src/lib/estado-visual-casos.json`).

## 3. Mapa de pantallas
| # | Pantalla | Qué muestra | Acciones | Datos (ruta real o propuesta) | Requisitos | Cuándo |
|---|---|---|---|---|---|---|
| P1 | **Resumen del sitio (tablero)** | En tres pestañas desde el 13/11/2026 (§4, bloque L): **Resumen** (conteo por estado visual, salud del sitio, «Ahora» por magnitud y por dispositivo, «Requiere atención» y condiciones abiertas por tipo), **Tendencias** (una gráfica por magnitud) y **Red** (tramas recibidas y rechazadas, y entrega por dispositivo); rediseñado en la Etapa 4 después de una comparativa de referentes y de WCAG 2.2 (§4). El estado del servicio pasó a «Legal y acerca de» (L1d) | Ir a cada lista filtrada; cambiar de pestaña y, en Tendencias y Red, de rango; pausar; abrir P3b desde una magnitud | `GET /sitios`, `GET /sitios/{id}/resumen`, `GET /sitios/{id}/ahora`, `GET /sitios/{id}/historico` (Etapa 4), diseños del 11/11/2026 (§4 tablero v2) y del 13/11/2026 (bloque L) | RF-30, HU-15, HU-16, HU-07, TT-44 | Etapa 4 (`docs/04`); los conteos por estado ya aparecen en P2 desde la Etapa 3; diseñado el 11/11/2026 y el 13/11/2026, iteración 1 |
| P2 | **Inventario** | Tabla: estado visual, nombre, identificador físico, vía, zona, última trama (hace cuánto), condiciones abiertas; filtros por estado, sitio (si hay más de uno), zona y vía con conteo | Abrir la ficha; filtrar; buscar por nombre o identificador | `GET /dispositivos` y `GET /condiciones?abiertas=true&limite=500` (el tipo de cada condición abierta decide el estado, §2; desde el 11/11/2026 la API filtra, ordena y pagina, y el panel recalcula en vivo) | Semáforo y tabla: RF-47, RF-48, HU-10, HU-19. Filtros y búsqueda: RF-51, HU-20 (adelantada a la Etapa 3 el 12/10) | Etapa 3, tramo 2 |
| P3 | **Ficha del dispositivo** | Identidad (nombre, identificador, vía, formato, zona, sitio, intervalo esperado, desde cuándo); estado visual (si espera su primera trama, desde cuándo y cuándo pasaría a «Sin señal», §2); por canal: última lectura con unidad y, si el canal tiene calibración, su porcentaje (`docs/10 §8.4` punto 51), y reglas de umbral; gráfico histórico por canal (rango elegible; la agregación la fija el rango) que sigue en vivo; condiciones abiertas y cerradas del dispositivo; sus tramas rechazadas | Cambiar canal y rango (el intervalo lo fija cada rango); pausar el vivo; ir a configurar (P6) o a mudar (Etapa 4) | `GET /dispositivos/{id}`, `GET /canales/{id}/historico?desde&hasta&intervalo`, `GET /eventos?dispositivo=`, `GET /condiciones?dispositivo=&abiertas=true&limite=500` (todas las abiertas) más `?dispositivo=&limite=50` (las recientes), `GET /cuarentena?dispositivo=&limite=20` | RF-33, RF-49 (identidad, condiciones y serie; su «historial de eventos» queda con la Etapa 4), HU-21 (adelantada a la Etapa 3 el 12/10, con sus 7 h); el rango a medida por fechas es HU-07 (Etapa 4) | Etapa 3, tramo 3 |
| P3b | **Comparar dispositivos** (`#/comparar`; incremento 2) | La misma magnitud de 2 a 6 dispositivos en un gráfico de historia (promedios por cubo; misma ventana y resolución que P3) y, debajo, la tabla en tiempo real con la última lectura, hace cuánto y el estado de cada uno; selector de magnitud; entradas desde las casillas de P2 y el enlace de P3 | Abrir la ficha de cada dispositivo; volver al inventario con las casillas marcadas | `GET /dispositivos/{id}` por dispositivo, `GET /canales/{id}/historico`, `GET /condiciones?abiertas`, `GET /eventos` | — | — |
| P4 | **Condiciones** | Lista con tipo, dispositivo, magnitud y umbral, abierta en, duración; filtro abiertas / todas; al cerrarse, el resumen del episodio, y el reconocimiento con su clasificación (`docs/10 §8.4` punto 49) | Abrir la ficha del dispositivo | `GET /condiciones?abiertas&limite` | HU-05, RF-24 | Etapa 4 (lista sobre lo que la API ya devuelve) |
| P5 | **Cuarentena** | Últimas tramas rechazadas: cuándo, por qué (`no_registrado`, `dado_de_baja`, `malformada`, `invalida`), detalle, dispositivo si se conoce, la trama cruda plegada | Copiar la trama; ir al alta si el motivo es `no_registrado` | `GET /cuarentena?limite` | RF-11 a RF-13 | Etapa 4 (lista sobre lo que la API ya devuelve) |
| P6 | **Configurar dispositivo y canales** | Nombre, estado (activo / mantenimiento), intervalo esperado, zona; por canal, etiqueta, umbral alto, umbral bajo, histéresis y retardo de activación | Guardar con bloqueo optimista; validación en vivo (bajo < alto, histéresis dentro de la banda, rango de la magnitud) | `PATCH /dispositivos/{id}`, `PUT /canales/{id}/reglas` (Etapa 4), fijadas el 11/11/2026 (§4 tablero v2, E) | HU-06, HU-13, RF-14, punto 28 | Etapa 4, iteración 1 (exige sesión) |
| P7 | **Alta de dispositivo** (asistente) | Paso 1 identidad y zona; paso 2 vía y formato (y pasarela si LoRaWAN); paso 3 canales y magnitudes; paso 4 credencial según la vía, mostrada una sola vez; paso 5 «esperando la primera trama» en vivo | Crear; copiar la credencial y el tópico; subir un CSV, validarlo y crear las filas válidas (el alta masiva: §4, bloques N y, desde el 19/11/2026, S); dar de alta un emisor detectado | `POST /dispositivos` (API hecha el 12/10, HU-11, `docs/16 §20`); `POST /dispositivos/lote?modo=validar\|crear` y `GET /cuarentena/detectados` (Etapa 4), fijadas el 11/11/2026 (§4 tablero v2, F) | RF-50, HU-11, HU-22, punto 25 | API: Etapa 3; pantalla, lote y detectados: Etapa 4, iteración 1 |
| P8 | **Exportar** (el sitio, diseñada el 19/11/2026, §4 bloque R) | Dispositivo (hoy) o sitio (Etapa 4), rango, formato (CSV, XLSX, JSON); tamaño estimado antes de descargar | Descargar | Hecho el 12/10 por dispositivo: `GET /dispositivos/{id}/exportar?formato=csv\|json&desde&hasta` (flujo por tandas; CSV estándar con coma y punto decimal para R, Python y QGIS). Por sitio (bloque R): `GET /sitios/{id}/exportar?formato=csv\|xlsx\|json` con mediciones, tramas y eventos, y `GET /sitios/{id}/exportar/estimacion` | RF-34, HU-08 (adelantada a la Etapa 3 el 12/10) | API: Etapa 3; pantalla, XLSX y por sitio: Etapa 4 |
| P9 | **Vista pública por enlace** (diseñada el 16/11/2026, §4 bloque O; ✅ base, backend, proxy y las dos pantallas, 17/11/2026, `docs/16 §79` y §80) | Para quien visita sin cuenta: solo los promedios de las magnitudes que un administrador publicó (del sitio y, si lo eligió, de cada zona), nunca el mínimo ni el máximo; un valor sale oculto si lo aportan menos de k dispositivos. Para el administrador, «Publicar una vista» con vista previa y la lista de enlaces | Visitante: cambiar la ventana y pausar la actualización. Administrador: crear (con vencimiento), renovar y revocar | `GET /publico` (token en la cabecera `X-Enlace-Publico`) y `POST /sitios/{id}/enlaces/vista-previa`; crear y listar, `GET`/`POST /sitios/{id}/enlaces`, renovar, `POST /sitios/{id}/enlaces/{enlace}/renovar`, revocar, `DELETE /sitios/{id}/enlaces/{enlace}`, y el tope de enlaces y el k del sitio, `GET`/`PUT /sitios/{id}/enlaces/tope` y `GET`/`PUT /sitios/{id}/enlaces/minimo`, fijadas en el OpenAPI el 17/11/2026 (§4, O); desde el 18/11/2026 el k y el tope se cambian en P15 «Ajustes del sitio» (§4, Q) | RF-62, HU-32, punto 6 | Etapa 4, iteración 1 |
| P10 | **Sesión y usuarios** | Entrar, cambio de la clave temporal, salir; quién soy en la cabecera; usuarios de mis sitios, su perfil por sitio y la guía de perfiles (cinco desde el 08/11/2026, diseño: `docs/20 §6`) | Entrar, cambiar la clave, salir o cerrar en todos lados; dar de alta (clave temporal una vez), activar y desactivar, asignar una temporal, cambiar el rol | `POST /sesion`, `GET /sesion`, `DELETE /sesion`, `POST /sesion/clave`, `GET /usuarios`, `POST /usuarios`, `PATCH /usuarios/{id}` (`docs/20`) | RF-43, RF-44, HU-18 | Etapa 4; hecha el 08/11/2026 (§4) |
| P11 | **Legal y acerca de** (Etapa 4) | Privacidad (generada desde `docs/21`), términos de uso con su versión, avisos de terceros, versión y commit, aviso AGPL; soporte: contacto del responsable y formulario | Leer; aceptar los términos (obligatorio al primer ingreso y al cambiar la versión); enviar un mensaje de soporte | `GET /terminos`, `POST /terminos/aceptar`, `GET /privacidad`, `GET /acerca` (versión y commit solo con sesión), `POST /soporte` y `GET /soporte` (Etapa 4); los avisos de terceros, un archivo generado al cambiar dependencias | RF-53, RF-54, RF-61, HU-27, HU-31 | Iteración 0; hecha el 11/11/2026 |
| P12 | **Estado del sistema** (solo administrador del sistema; Etapa 4) | Recursos por contenedor en el tiempo (memoria frente a su techo, CPU), errores agrupados por huella, último respaldo y su antigüedad, condiciones del sistema abiertas; límites de los servicios | Ver el detalle de un error; ajustar un límite con bloqueo optimista | `GET /salud` y rutas nuevas sobre `metrica_recurso`, `error_sistema` y los límites (Etapa 4; `docs/10 §8.4` puntos 60 y 61) | RF-59, RF-60, RNF-19, HU-30 | Iteración 1 |
| P13 | **Preferencias** (mi cuenta; Etapa 4) | Unidades de visualización (°C o °F; mm, m o km), zona horaria propia o la del sitio, vistas guardadas; mis datos y mis sesiones abiertas (por decidir: sin fila en el backlog) y la versión de términos aceptada; darme de baja | Guardar; exportar mis datos de cuenta; cerrar una sesión; darme de baja (con la clave actual) | `GET`/`PUT /preferencias`, `GET /sesiones`, `DELETE /sesiones/{id}` (Etapa 4), fijadas el 11/11/2026 (§4 tablero v2, H); la baja, `docs/20 §11` | RF-55, RF-56, HU-28, HU-29 | Iteración 1 (la baja, en la 0) |
| P14 | **Actividad** (administrador de sitio en sus sitios; el del sistema en todos; diseñada el 11/11/2026) | Lo que hicieron las personas en el sitio (eventos con quién, de `evento.usuario_id`) y sus entradas, salidas y bloqueos (`acceso`), con filtros por persona, tipo y rango, en texto para personas | Filtrar; abrir la ficha del dispositivo o la persona | `GET /sitios/{id}/actividad?desde&hasta&tipo&usuario&cursor` (Etapa 4) (§4 tablero v2, G) | RF-46, HU-11, HU-26 | Iteración 1 |
| P15 | **Ajustes del sitio** (diseñada el 18/11/2026, §4 bloque Q; quien tiene la acción `ajustes` o `enlaces` en el sitio: administrador del sitio y del sistema) | Lo que rige a todo el sitio, en dos secciones: **Primera trama** (el plazo en horas, de 1 a 2 160, con su equivalencia en días; qué pasa al vencer y por qué existe el plazo) y **Vista pública** (el mínimo de dispositivos por valor, k, y el tope de enlaces vivos) | Cambiar el plazo, el k (bajarlo se confirma) y el tope, cada uno con su «Guardar» y su bloqueo optimista; elegir sitio si se administra más de uno | `GET`/`PUT /sitios/{id}/espera-primera-trama`, `GET`/`PUT /sitios/{id}/enlaces/minimo` y `GET`/`PUT /sitios/{id}/enlaces/tope` (las tres ya existen; no se agrega ninguna ruta) | RF-62, HU-32, §2 (estado «Esperando primera trama») | Etapa 4, iteración 1 |
| P16 | **Catálogo** (diseñada el 20/11/2026, §4 bloque T; solo el administrador del sistema, acción `sistema`) | **Magnitudes** (nombre, código, unidad, rango válido, umbral sugerido, alias y en cuántos canales se usa) y **Recetas de decodificación** (largo, campos y en cuántos equipos se usa) | Crear y editar una magnitud (achicar el rango se confirma si afecta mediciones); crear una receta, probarla con bytes sin guardar y reemplazar una por otra; en P6, «Usar el sugerido» | `GET /magnitudes` (ampliada) y, nuevas, `POST /magnitudes`, `PATCH /magnitudes/{codigo}`, `GET /magnitudes/{codigo}/impacto`, `GET`/`POST /recetas-decodificacion`, `POST /recetas-decodificacion/probar` y `POST /recetas-decodificacion/{codigo}/reemplazar` (Etapa 4), con sus perfiles en `docs/20 §6` | TT-12, RF-11, RF-14 | Etapa 4, iteración 1 |

Lo que **no** se construye, y por qué: mapa (ningún requisito lo pide; el caso de uso tiene decenas de dispositivos, no cientos
dispersos), informes programados y disparadores con varias condiciones (más que el umbral con histéresis decidido; candidatos
para después de la Etapa 4 si sobra tiempo), compartir dispositivos entre cuentas (lo cubren los roles por sitio).

## 4. Las pantallas en detalle, en el orden en que se construyen
**P2 Inventario con semáforo (tramo 2, Etapa 3; es HU-19).** Es la pantalla de entrada mientras no exista P1. Arriba, una ficha por estado visual (cinco desde el 18/11/2026, §2) con el conteo por estado
visual, que al pulsarlas filtran la tabla (misma leyenda que en P1 y P3). Columnas: estado visual, nombre, identificador físico,
vía, zona, última trama como «hace 3 min» con la hora exacta al pasar el cursor, condiciones abiertas. Orden por defecto: los
que requieren atención primero (Sin señal, Alerta, luego Normal, luego Esperando primera trama, luego Inactivo), y dentro de cada grupo por nombre. Filtros
por zona y vía con conteo y búsqueda por texto: HU-20, en el mismo tramo (adelantada el 12/10). **Varios sitios (16/10):** si el
inventario trae más de uno, aparece el filtro por sitio y la columna Sitio; la zona se elige dentro del sitio elegido. Se filtra por
el código del sitio (único) y el id de la zona, nunca por el nombre: dos sedes pueden tener una zona con el mismo nombre. Con un solo
sitio, ni el filtro ni la columna se muestran (no informan nada). Vacío: «Sin dispositivos registrados» con la referencia al alta por API (`docs/10
§3` y §8.4 punto 25). Esta pantalla es la que comprueba el reenvío de Vite en desarrollo (`docs/11 §4`): una petición real a la API y una al
canal en vivo, y se mira en el backend que el `Host` llegue con el puerto del servidor de desarrollo y que los eventos no se
retengan.

**P3 Ficha (tramo 3, Etapa 3; es HU-21, adelantada el 12/10).** Cabecera con nombre, estado visual y los datos de identidad en dos columnas (una en móvil). Después,
una tarjeta por canal: magnitud, última lectura con unidad y hace cuánto, reglas de umbral si existen. Una tarjeta se marca **«callado»**
(la palabra y un borde, nunca solo color) cuando el dispositivo está en línea pero ese canal no tiene lectura dentro de 2 × su intervalo
esperado, la misma tolerancia de `en_linea`: el equipo reporta, pero esa magnitud no llega (sensor desconectado o lecturas que la
validación manda a cuarentena; en la corrida de 24 h la presión calló 3 h 30 min con el equipo en «Normal», `docs/16 §53`). La
cabecera suma «N canal(es) callado(s)». Es regla de presentación, como §2: no abre condición ni cambia el estado visual del
dispositivo; volverla alerta exige una condición en la base. Debajo, el gráfico del
canal elegido: rango (última hora, 24 h, 7 días, 30 días; el rango a medida por fechas es HU-07: su formulario existe desde el 15/11/2026, D1b, y está probado en navegador real desde el 16/11/2026, `docs/16 §75`), cada uno con un intervalo de
agregación fijo de la lista cerrada de la API (1 minuto, 15 minutos, 1 hora, 6 horas);
el panel pide el histórico y abre el canal en vivo filtrado por dispositivo; cada `medicion` nueva del canal visible se añade al
final sin volver a pedir el histórico; cada `visto` actualiza «hace cuánto»; cada `condicion` actualiza la lista de condiciones y el
estado visual. Si el gráfico muestra un intervalo agregado (por ejemplo, promedios por hora), el punto en vivo se dibuja aparte,
como «lectura actual», para no mezclar un valor crudo con promedios. Botón «pausar en vivo». Al final, condiciones del
dispositivo (abiertas arriba) y sus tramas rechazadas.

**Incremento 1 de P2 y P3 (decidido el 21/10/2026 y diseñado el 22/10; antes del código, como manda la regla de concordancia).**
Qué lo motiva: la prueba de campo del 20/10 (`docs/16 §45`) dejó un gráfico de 1 h vacío con «última medición hace 4 d», un intervalo real de
17 s frente a 180 s declarados y un reloj de pasarela que nadie vio hasta mirar la base. Antes de diseñar se comparó, con citas de la
documentación oficial (registro de evidencia del proyecto, 30 filas), qué hacen ThingsBoard CE, OpenRemote, Magistrala y Milesight IoT Cloud
en tres problemas: **(a)** ThingsBoard declara que el rango cambiado en vista se pierde al recargar y que el guardado exige editar el tablero;
las otras tres no declaran persistencia ni indicador de «en vivo» (Magistrala sí muestra una señal en el widget en vivo). **(b)** Ninguna
declara aviso, marcador ni ampliación automática cuando el dato cae fuera del rango mostrado; ThingsBoard lo trata como falla a diagnosticar
(«la ventana no cubre el período con datos»). **(c)** ThingsBoard marca inactividad tras 600 s por defecto, ajustable por dispositivo, y
guarda la última actividad; Milesight cuenta la desconexión en múltiplos (3) del intervalo de reporte configurado; ninguna de las cuatro
declara intervalo observado ni desvío de reloj. Lo que se toma, lo que no y lo que es propio:
1. **La vista vive en la URL y se restaura.** `#/dispositivos/<id>?canal=<uuid>&rango=24h` y `#/?estado=alerta&sitio=&zona=&via=&q=`: al
   cargar o al cambiar el fragmento, el panel lee esos parámetros; al cambiar canal, rango o filtros, los escribe con `replaceState` (sin
   ensuciar el historial del navegador). Un enlace compartido abre la misma vista; «atrás» vuelve a la pantalla anterior. **Una pantalla
   nunca escribe su vista sobre una navegación que el panel aún no procesó** (corregido el 13/11/2026): si la URL del navegador ya
   cambió —la persona eligió otro destino y la carga de la pantalla anterior terminó justo después—, esa escritura se descarta; antes
   reemplazaba la URL nueva y la persona se quedaba donde estaba. Se toma el
   problema que ThingsBoard reconoce (se pierde al recargar) y se resuelve sin cuentas ni tableros editables, que son de la Etapa 4. No se
   toma «guardar como predeterminado»: exige sesión.
2. **Un rango sin datos lo dice y lleva al dato.** Si el histórico del rango está vacío y el canal tiene última medición, el gráfico muestra
   «Sin mediciones en este rango; la última es de hace N (fecha y hora en la zona del sitio)» y un botón «Ver la última medición» que elige
   el menor rango de la lista cerrada que la contiene; si es anterior a 30 días, dice que el panel no la dibuja y remite a Exportar. **No**
   se amplía el rango solo (ninguna referencia lo hace y cambiaría el gráfico sin que la persona lo pida).
3. **Intervalo observado junto al esperado.** `GET /dispositivos/{id}` entrega `intervalo_observado_s`: la mediana de las diferencias entre
   las últimas 20 filas de `trama` del dispositivo (instantes distintos de `recibido_en`; esa tabla tiene el índice por dispositivo y recepción), nulo con menos de 3 o sin tramas retenidas (`RETENCION_TRAMA_DIAS`, 30 días por defecto). P3 lo muestra en
   la cabecera, «reporta cada ≈ 17 s (esperado 3 min)»: las duraciones se escriben para personas (segundos hasta 2 min, minutos hasta 1 h, horas después), y avisa en texto cuando el observado es menor que la mitad o mayor que el doble del
   esperado: «más seguido / más lento de lo declarado: revisa el intervalo esperado» (P6, Etapa 4; hoy por API). La alarma de silencio
   sigue usando solo el esperado (`docs/10 §4.1` y §4.3): el observado informa, no decide. Es terreno propio: ninguna referencia lo declara.
4. **Reloj de pasarela desviado, en palabras.** La condición `reloj_desviado` (`docs/10 §8.4` punto 54) aparece como alerta (en P3 un aviso bajo la cabecera; en P2 una línea bajo el estado de la fila)
   «Reloj de pasarela desviado: las mediciones se fechan al llegar», con el hace cuánto; al cerrarse sola, desaparece sin recargar. Propio.
5. **«En vivo» con prueba.** Junto a «en vivo: conectado», P3 muestra «última lectura hace N s» del canal visible; si pasan más de dos
   intervalos esperados sin lectura con el canal conectado, el texto pasa a «conectado, sin lecturas» (el canal vive, el nodo calla). Toma
   la señal explícita de Magistrala y la hace verificable.
Pruebas (§6): por el DOM, ida y vuelta URL ↔ estado en P2 y P3, el texto y el botón del rango vacío, el intervalo con sus dos avisos, la alerta
del reloj; en el backend, unitaria del contrato y de las piezas de la consulta (OpenAPI regenerado); la mediana se contrasta en la base, porque las unitarias corren sin ella. Lo que no entra en este incremento: filtros guardados por
persona, rango a medida (HU-07: su formulario llegó el 15/11/2026, D1b; probado en navegador real el 16/11/2026, `docs/16 §75`) y la administración de pasarelas (incremento 3).

**Incremento 2 de P3 y P2: leyenda sin sorpresas, cambio de rango sin pantalla en blanco, hora del sitio, resolución elegible y
comparación entre nodos (diseñado el 22/10/2026, antes del código, como manda la regla de concordancia).** Qué lo motiva: al revisar la
ficha con los datos reales del 20/10, un clic en «promedio» o en «lectura actual» de la leyenda ocultaba esa serie (uPlot lo hace por
defecto al pulsar una leyenda) y se leía como pérdida de datos; un rango sin datos dejaba el gráfico vacío sin decir por qué (lo resolvió
el incremento 1); ninguna pantalla decía en qué zona horaria ni qué hora era en el sitio (`docs/13` regla 6 lo pide y estaba pendiente); y
los nodos solo se veían de a uno. Referentes (registro de evidencia del proyecto, fuera del repositorio; fuentes oficiales leídas el 22/10/2026:
https://thingsboard.io/docs/user-guide/time-window/ · https://www.absmach.eu/docs/magistrala/user-guide/dashboards/widgets/ ·
https://support.milesight-iot.com/support/solutions/articles/73000603114-milesight-iot-cloud-faq): ThingsBoard y Magistrala separan «tiempo real» de
«historia» (P-TB-04, P-MG-03); Milesight deja elegir el rango del eje X con el eje Y fijo (P-MS-03); ninguna de las cuatro declara comparación
de dispositivos en un gráfico ni aviso por la zona del navegador (no declarado, que no es lo mismo que inexistente).
1. **La leyenda informa, no apaga.** *(Desde L4c, 13/11/2026: ya no se dibuja la tabla de leyenda de uPlot; el valor de cada serie bajo
   el cursor lo da la etiqueta flotante y los nombres, una leyenda fija sin controles. La regla sigue igual: nada se apaga con un clic.)*
   Las filas de la leyenda de uPlot dejan de recibir eventos de puntero: el clic no oculta ninguna serie,
   y la leyenda sigue mostrando el valor de cada serie bajo el cursor. Si algún día hace falta ocultar una serie, será un control propio con
   estado visible, nunca un clic silencioso. Prueba con navegador: clic en «promedio» y en «lectura actual» → el número de puntos no cambia
   (desde L4c, el clic es sobre la leyenda fija, que no tiene ningún control, y el valor bajo el cursor se lee en la etiqueta flotante).
2. **Cambiar rango, canal o resolución nunca deja el gráfico en blanco sin decirlo.** Mientras llega el histórico nuevo, el gráfico conserva
   la serie anterior y el texto de puntos dice «cargando…» (el grupo de botones queda marcado ocupado); con respuesta, la reemplaza; con error,
   conserva la anterior, muestra el error con un botón «Reintentar» y no toca la URL; con rango vacío, muestra el mensaje del incremento 1 y
   un gráfico sin puntos pero con el eje de tiempo de la ventana pedida, para que se vea *qué* ventana está vacía. Ninguno de estos clics
   cambia de pantalla: la URL sigue siendo la de la ficha. Prueba con navegador: cada botón de rango, «Ver la última medición», cada resolución
   y cada tarjeta de canal; tras cada clic, la ficha sigue siendo la misma (`location.hash`), y el gráfico tiene puntos o el mensaje de rango
   vacío, nunca ninguno de los dos.
3. **Hora del sitio y aviso de zona (cierra la regla 6 de `docs/13`).** Bajo la cabecera de P3: «Hora en el sitio: 22/10/2026 21:58:07 ·
   America/Santiago (UTC−03:00)», con segundos y al día cada segundo; el desfase se calcula del nombre IANA al instante actual (cambia con el
   horario de verano) y nunca se escribe fijo. Si la zona del navegador es otra: «Tu navegador está en Europe/Madrid (UTC+02:00); todas las
   horas de esta pantalla van en la zona del sitio». En P2, con una sola zona entre los dispositivos listados, la misma línea; con varias, «N
   zonas horarias: cada fila va en la de su sitio» (la hora exacta por fila ya está al pasar el cursor). Prueba: unitaria del desfase (zona e
   instante → «UTC−03:00», «UTC+02:00», y una fecha de invierno y otra de verano de Chile); con navegador, el contexto de Playwright fijado en
   otra zona muestra el aviso y, fijado en la del sitio, no. Con una zona propia elegida en P13 (desde el 20/11/2026) rige la regla de H: las horas van en ella y este aviso se reemplaza por «Hora en tu zona».
4. **Resolución elegible, con el costo medido antes de ofrecerla.** Junto a los rangos, un selector «resolución»: «auto» (la fija de cada
   rango, la de hoy) y las de la lista cerrada de la API (1 min, 5 min, 15 min, 1 h, 6 h, 1 día) que den entre 2 y 2 500 puntos para el rango
   elegido (30 días admite desde 1 h; 7 días desde 5 min; 24 h desde 1 min). La resolución va en la URL (`&res=5m`) solo cuando no es «auto»;
   el texto bajo los botones dice «N puntos, promedio por X». El servidor rechaza con 400, antes de consultar, una petición a
   `GET /canales/{id}/historico` que produciría más de 5 000 cubos (ventana ÷ intervalo) o que abarque más de 366 días (el tope de cubos acota la respuesta, no las filas
   leídas): el panel nunca la arma, pero la API es pública.
   Medición (`docs/16 §52`, en el banco, con una serie sembrada de 30 días a una lectura cada 10 s): para cada rango × resolución ofrecida,
   tiempo de respuesta (mediana de 10 peticiones), filas leídas (`EXPLAIN (ANALYZE, BUFFERS)`) y bytes de la respuesta; el «antes» son las
   cuatro combinaciones fijas de hoy. La tabla debe responder cuánto cuesta la resolución más fina de cada rango frente a la fija. Los
   agregados materializados por tarea quedan como mejora aparte, también medida (los continuos de TimescaleDB no existen en la edición
   Apache, `docs/10 §8.4` punto 11): hoy toda resolución lee las filas crudas.
5. **Comparar nodos: la misma magnitud de varios dispositivos en un gráfico (P3b).** Pantalla
   `#/comparar?dispositivos=<uuid>,<uuid>&magnitud=temperatura&rango=24h[&res=5m]` (de 2 a 6 dispositivos). Entradas: en P2, una casilla
   «comparar» por fila y el botón «Comparar (N)», activo con 2 a 6 marcadas; en P3, el enlace «Comparar con otros dispositivos», que abre P3b
   con este dispositivo marcado y la magnitud del canal visible. Arriba, el selector de magnitud (las que tienen los dispositivos marcados; por
   defecto la más común) y los mismos rango y resolución de P3. El gráfico dibuja una serie por dispositivo (su canal de esa magnitud; paleta
   fija de 6 colores distinguibles) alineadas por cubo de tiempo (las peticiones comparten ventana e intervalo; donde un dispositivo no tiene
   cubo, hueco), con la unidad de la primera serie en el eje; un dispositivo sin canal de esa magnitud o con otra unidad aparece en la lista
   como «sin canal de X» o «unidad distinta (K): no se dibuja», nunca se omite en silencio. Debajo, la tabla en vivo: dispositivo · última
   lectura · hace cuánto · estado visual, con el canal `GET /eventos` sin filtro y filtrado en el cliente por el conjunto marcado (una sola
   conexión, no una por dispositivo: el proxy acota las conexiones a ese canal). El gráfico de P3b es **historia** (se vuelve a pedir al cambiar rango,
   resolución o magnitud y con el botón «Actualizar»; en vivo no se le agregan puntos crudos: P3 ya separa promedio de lectura actual, y seis
   series crudas más confundirían) y la tabla es el **tiempo real**: la separación que ThingsBoard y Magistrala declaran (P-TB-04, P-MG-03), hecha
   explícita en pantalla. Vacíos: con menos de 2 dispositivos, «Marca al menos dos dispositivos en el inventario»; sin ningún canal de la
   magnitud, «Ninguno de los marcados mide X»; en el selector, una magnitud que
   ninguno mide se lista como «X (ninguno la mide)»; un dispositivo dado de baja mientras se mira, «ya no existe»; un rango sin cubos en
   todos los dibujados, «Ninguno de los dibujados tiene mediciones de X en este rango». Prueba con navegador: dos emulados del banco con temperatura → dos series con puntos y la
   leyenda con los dos nombres; el cambio de rango conserva la pantalla; una trama MQTT de uno de ellos actualiza su fila sin recargar.
6. **Lo que el rango ya sabe, dicho.** Bajo el gráfico de P3: «en este rango: mín · máx · promedio de los puntos dibujados» (calculado en el
   cliente sobre los promedios recibidos: es un promedio de promedios y así se nombra) y el enlace «Descargar CSV de este rango» a
   `GET /dispositivos/{id}/exportar` con la ventana visible (la pantalla P8 sigue en la Etapa 4; un enlace no es la pantalla).
Pruebas (§6): las de navegador se suman al recorrido de `banco.sh navegador` (el mismo arranque de Firefox); por el DOM y funciones puras:
resoluciones admisibles por rango, desfase de zona, alineación de series y lectura y escritura de la URL de P3b. Lo que no entra: rango a
medida por fechas (HU-07: hecho el formulario el 15/11/2026, D1b, y probado en navegador real el 16/11/2026, `docs/16 §75`), tableros guardados por persona, y una serie en miniatura por fila en P2 (una petición por fila: se mide antes).
**Hecho el 22/10/2026 (`docs/16 §52`).** Medido en el banco con la serie de 30 días a una lectura cada 10 s: toda resolución de un rango lee
las mismas filas crudas salvo dos o tres por el borde del cubo (≈ 8 600 en 24 h, 60 500 en 7 días y 259 200 en 30 días; la tabla exacta
está en `docs/16 §52`), así que la resolución más fina cuesta poco más en tiempo
que la fija (24 h cada minuto, 9,4 ms frente a 6,7 ms; 7 días cada 5 min, 52 ms frente a 41 ms; 30 días cada hora, lo mismo que cada 6 h
dentro del ruido) y de 5 a 12 veces más en bytes (como mucho 42 KB): se ofrecen todas las que el diseño admite. Decisiones dentro del
diseño: el eje de tiempo de P3 y P3b muestra siempre la ventana pedida (también con puntos, no solo vacía; se amplía si un cubo empieza
antes o una lectura en vivo llega después); con error, los botones quedan en lo pedido y la URL en lo dibujado; las casillas de P2 se
recuerdan mientras dura la sesión del navegador (así el enlace de P3 y el vacío de P3b llevan a P2 con ese dispositivo ya marcado); a igual
cuenta, la magnitud por defecto de P3b es la primera por nombre; un dispositivo tiene como mucho un canal por magnitud (restricción única
de `canal`), así que «su canal de esa magnitud» es uno solo.

**P10 Sesión y usuarios (Etapa 4; hecha el 08/11/2026, sobre el backend de `docs/20`).** Qué hace y cómo, en el orden en que la
persona lo encuentra:
1. **Entrar.** Al cargar, el panel pregunta `GET /sesion`. Sin sesión, la pantalla «Entrar»: correo y clave con `autocomplete="username"` y
   `"current-password"` (los gestores de claves los reconocen), botón con estado «Entrando…», y «¿Olvidaste tu clave?» desplegable: «Pídele
   una clave temporal al administrador de tu sitio» (sin correo saliente, `docs/20 §4`). Cualquier rechazo de credenciales muestra el MISMO
   texto («Correo o clave incorrectos…»), sea usuario inexistente, inactivo o clave mala, como responde el servidor; un 429 dice cuántos
   segundos esperar. Ninguna pantalla de datos (ni su canal en vivo) existe antes de entrar.
2. **Clave temporal.** Si la sesión trae `clave_temporal`, la pantalla «Elige tu clave» es obligatoria (el servidor responde 403 a todo lo
   demás): las reglas de `docs/20 §4` se leen ANTES de escribir, se comprueban mientras se escribe con los mismos números del servidor (la
   lista de claves comunes la revisa solo el servidor, y sus motivos se muestran tal cual), la nueva se escribe dos veces
   (`autocomplete="new-password"`) y la temporal que la persona acaba de usar no se pide otra vez (vive solo en memoria). La misma pantalla,
   no obligatoria, se abre desde «Cambiar la clave» en la cabecera.
3. **Dentro.** La cabecera dice quién soy: nombre y cada sitio con su rol («Campus (administrador)»), y ofrece «Cambiar la clave», «Salir»
   y «Cerrar en todos lados» (`DELETE /sesion?todas=true`). El menú muestra «Usuarios» solo a quien administra algún sitio.
4. **Renovar y vencer** (`docs/20 §3`). Mientras la persona mueve el ratón, toca o teclea, un `GET /sesion` como mucho cada 5 minutos; una
   pantalla sin nadie delante no renueva y vence a los 30 min. Un 401 en cualquier petición (también en una descarga o al caer el canal en
   vivo, que el servidor cierra cuando la sesión vence) guarda la ruta, desmonta las pantallas (sus `EventSource` se cierran) y muestra
   «Entrar» con «Tu sesión venció o se cerró: entra de nuevo para seguir donde estabas»; al entrar, vuelve a esa ruta y reabre el canal.
5. **Usuarios** (`#/usuarios`, solo administradores, solo sus sitios). Una mini guía «Qué puede hacer cada perfil» y el tooltip del selector
   de rol salen de la matriz de permisos del servidor (`GET /sesion` → `permisos`, que es `PERMISOS` de `sesion/permisos.ts`) con un
   diccionario de frases por acción (`panel/src/lib/ayudas.ts`): la ayuda no puede decir otra cosa que el permiso real. La lista muestra
   nombre, correo, el rol en cada uno de mis sitios (un selector por sitio con los cuatro perfiles de sitio: consulta, investigación,
   operación técnica y administrador, o sin acceso), si ya no está en mis sitios, activo o inactivo y la temporal pendiente. El alta
   (nombre, correo, sitio, rol; y, solo para el administrador del sistema, la casilla del perfil global, con los sitios de `GET /sitios`)
   muestra la clave temporal **una sola vez**, con «Copiar» y el aviso de que no se vuelve a ver; «Ya la entregué: ocultar» la borra de la
   página. Un correo de una cuenta inactiva (409 `reactivable`) ofrece «Reactivar» en vez de crear otra. «Desactivar» pide el **motivo**
   (1–300, con el aviso «sin nombres ni datos personales»: queda en el registro de cambios) antes de enviar; «Activar» reactiva con una
   clave temporal nueva, que se muestra una vez (la de antes no vuelve; correcciones del 11/11/2026). Todo cambio lleva el
   `actualizado_en` leído: un 409 muestra «Alguien lo cambió entretanto: recarga» con el botón «Recargar», y el selector vuelve a lo
   leído (nunca pisa). Los botones que no aplican dicen por qué al lado («no puedes desactivarte a ti mismo», «actívalo primero», «es
   administrador del sistema: solo otro administrador del sistema cambia su cuenta»).
6. **Exportar según el rol.** En la ficha, «Descargar CSV de este rango» queda desactivado para quien es de consulta en el sitio del
   dispositivo, con el motivo escrito al lado («exportar exige el perfil de administrador o de investigador en este sitio»); la decisión sigue siendo del servidor.
Decidido al implementar (08/11/2026), en lo que el diseño no fijaba: la ruta guardada vive en memoria (el fragmento ya sobrevive a una
recarga) y «Salir» la descarta y deja el panel en el inventario (quien entre después en ese navegador no hereda la pantalla de la
anterior); «Entrar» no tiene fragmento propio (es un estado del panel, así la ruta pedida queda intacta); al primer cierre del canal en vivo
por el servidor se pregunta `GET /sesion` (los reintentos siguientes no preguntan, para que un canal rechazado en bucle no mantenga viva la
sesión de una pantalla sola); el usuario del sistema (la clave por cabecera, que usan guiones y pruebas) entra a las pantallas sin
«Salir» ni «Usuarios».

**P4 Condiciones y P5 Cuarentena (Etapa 4).** Dos listas con filtro y paginación por `limite`; cada fila lleva a la ficha. En
P5 la trama cruda va plegada (es texto largo) con un botón de copiar.

**P1 Resumen (Etapa 4).** Se arma con lo que ya devuelven las rutas: los conteos por estado visual salen de `GET
/dispositivos` (en la Etapa 3 los calcula el panel; cuando haya cientos de dispositivos, una ruta de resumen en el servidor, que
hoy no hace falta). El estado del servicio muestra `GET /salud` y si el canal en vivo está conectado; desde el 20/11/2026 esa ruta responde solo `estado` a quien no administra el sistema, y la línea de «Legal y acerca de» agrega base y tablas únicamente si vienen.

**P1 rediseñado: tablero y gráficas, con una comparativa antes (Etapa 4, iteración 1; TT-44).** Antes de dibujarlo, una comparativa
escrita de cómo resuelven el tablero ThingsBoard CE, OpenRemote, Magistrala y Milesight IoT Cloud (zoom y rango, varias series, agregados,
lectura en pantallas angostas) y de lo que pide WCAG 2.2 (contraste, foco visible, tamaño de los objetivos táctiles, información que no
depende solo del color), **cada afirmación con su cita de la fuente oficial**; lo que una fuente no declara se escribe «no declarado», no
como ausencia (la misma regla del incremento 1). Con eso: el tablero del sitio (los conteos de §2, condiciones abiertas, salud del
sitio de HU-16) y gráficas que admiten zoom por arrastre y vuelta atrás, varias series con su leyenda informativa (incremento 2, punto 1),
agregados con su nombre («promedio por hora») y un ancho que se adapta del teléfono al escritorio; probado en teléfono con capturas.
**Comparativa hecha el 11/11/2026: `docs/22`** (siete referentes, incluido Grafana, que dibuja con uPlot como este panel; 31 filas
verificadas y los siete criterios de WCAG 2.2 citados entonces —trece desde el bloque L del 13/11/2026—; ISO 9241 sin texto abierto, no se cita). Lo que sostiene: portada fija con conteos y
salud; zoom por arrastre con doble clic y botón para volver; preajustes hacia atrás más rango a medida, en la URL; el agregado con su
nombre escrito; 320 px sin desplazamiento en dos dimensiones, objetivos de 24 px y contraste 4,5:1. El diseño que lo aplica es el bloque
«Tablero v2» de esta sección.

**P11 Legal y acerca de (Etapa 4, iteración 0; HU-27, HU-31).** ✅ panel, 11/11/2026 (`docs/16 §64`; los textos llegan del servidor y se muestran como texto, nunca como HTML; el formulario de soporte, solo con sesión). ✅ backend, 11/11/2026 (`GET /terminos`, `POST /terminos/aceptar`, `GET /privacidad`, `GET /acerca`, `POST`/`GET /soporte` (Etapa 4); `docs/20 §10` R27, R30 y R31). Un enlace «Legal y acerca de» al pie de toda pantalla, también antes de
entrar. Cuatro apartados: **Privacidad**, generada desde el inventario de `docs/21` (§7 de ese documento) con el responsable y el contacto
que configuró el administrador del sistema; **Términos de uso**, con su versión y fecha; **Acerca de**, con la versión, el commit, el aviso
de la licencia AGPL y los avisos de terceros generados en la compilación; y **Soporte**: el contacto y un formulario de texto (sin
adjuntos) que se guarda en la base para el administrador del sistema, con límite de tasa. **Aceptación:** con la sesión restringida
(`docs/20 §12`), la pantalla «Términos de uso» muestra el texto completo, un botón «Acepto los términos (versión N)» y «Salir»; sin
aceptar no se ve ningún dato.

**P12 Estado del sistema (Etapa 4, iteración 1; solo el administrador del sistema; HU-30).** Arriba, lo que exige atención: condiciones
del sistema abiertas (`broker_descarte`, `error_repetido`, `memoria_alta`, `respaldo_atrasado`) y la antigüedad del último respaldo. Debajo,
por servicio, la memoria frente a su techo y la CPU en el tiempo (de `metrica_recurso`, `docs/10 §8.4` punto 61), y la suma de memoria
frente al límite de RNF-17; los errores agrupados por huella con su conteo y la última vez (de `error_sistema`, punto 60), sin datos
personales; y los **límites de los servicios** que hoy viven en el `.env` y pasan a configurarse aquí (primero la vigencia de la clave
temporal, `docs/20 §4`), cada uno con su rango válido, su valor por defecto y bloqueo optimista.

**P13 Preferencias (Etapa 4, iteración 1; HU-29, HU-28).** ✅ panel, 11/11/2026; la zona horaria propia se aplica a las horas visibles desde el 20/11/2026 (regla completa tras este párrafo). Unidades de visualización (temperatura en °C o °F; longitudes en mm, m o km):
la base guarda siempre la unidad estándar del catálogo y la conversión ocurre solo al mostrar, con la unidad escrita al lado de cada
valor; zona horaria: la del sitio (por defecto, `docs/13`) o la propia, dicha en la cabecera como hoy el aviso de zona (incremento 2,
punto 3); vistas guardadas (filtros de P2, rango y resolución de P3), guardadas en la base y no en el navegador (`docs/21 §4`). En «Mi
cuenta»: nombre, correo, sitios y perfiles, sesiones abiertas (con «cerrar»), versión de términos aceptada, exportar mis datos de cuenta y
«Darme de baja», que explica qué se borra y qué queda (`docs/20 §11`) y pide la clave actual.

**Zona horaria propia: qué rige dónde (definido el 20/11/2026).** Con «la del sitio» (el valor por defecto) nada cambia. Con una zona IANA propia
distinta de la del sitio: (1) **toda hora que el panel muestra** —texto, hora exacta al pasar el cursor, eje y etiqueta de las gráficas y su
tabla alternativa, fechas de las listas, «desde las HH:MM» de una pausa— va en la zona propia, y el instante UTC de la hora exacta sigue al
lado; las horas que dicen UTC (las sesiones abiertas de P13) siguen en UTC; (2) lo que la persona **escribe** y lo que se **pide a la API**
sigue en la zona del sitio: los campos «Desde» y «Hasta» (rango a medida de P3 y filtro de la actividad) se interpretan como hora del sitio, los días de la
exportación (P8) son días completos del sitio, y la ayuda de cada campo ya lo dice («En la hora del sitio»); así el mismo rango en la URL
significa lo mismo para todas las personas de un sitio, y un día exportado no cambia de contenido según quién lo pida; (3) el aviso de
zona (incremento 2, punto 3) pasa a decir «Hora en tu zona: … · Europe/Madrid (UTC+02:00)» y, debajo, «Elegiste ver las horas en Europe/Madrid
en lugar de la del sitio (America/Santiago, UTC−03:00); las fechas que escribes en un filtro o una exportación siguen en la zona del sitio» (con
varias zonas en la lista, «…en lugar de la de cada sitio»), y deja de avisar por la zona del navegador, porque la persona ya eligió; si la
propia es igual a la del sitio, todo queda como sin preferencia; en la actividad del sitio, la línea de los filtros dice que los campos van en
la zona del sitio y la lista en la tuya; (4) una zona que el navegador no conoce vale como «la del sitio»; (5) se aplica en un solo lugar
(`lib/tiempo.ts`, que lee `lib/zona-propia.svelte.ts`, fijada desde la sesión y las preferencias en `App.svelte`) y al guardarla en P13 las horas
visibles cambian al instante; (6) la vista pública por enlace (P9) no tiene sesión y siempre va en la hora del sitio. En «Usuarios» (pantalla global, sin zona de
sitio) el vencimiento de una clave temporal va en la zona propia y, sin ella, en UTC escrito («8 de noviembre de 2026, 16:00 UTC»); ya no en
la del navegador. Prueba: unitaria (zona propia, sin ella,
zona inválida, escritura en la del sitio y un cambio de hora de Madrid), del aviso y de la ficha con la sesión.

**Tablero v2 y experiencia de uso (diseñado el 11/11/2026, antes del código, como manda la regla de concordancia; iteración 1 del plan
v2, `docs/04 §8`).** Qué lo motiva: la presentación del 05/11 dejó claro que lo que se evalúa es lo que se ve y se opera (`docs/18 §1`):
el panel de la Etapa 3 es un inventario y una ficha, sin tablero del sitio, sin nada que la persona configure y con tablas que en un
teléfono se desplazan de lado. Este diseño cubre el bloque B2 completo —tablero, gráficas, inventario, ficha, umbrales, alta masiva,
actividad y preferencias— y fija el contrato de la API que cada pantalla necesita (I), para construir backend y panel por separado contra
el mismo contrato. Referentes y normas: la comparativa de «P1 rediseñado» (arriba), ampliada el 11/11/2026 a doce criterios y siete
referentes, y las reglas de visualización de §6 (colores validados, un solo eje, leyenda siempre que haya más de una serie).

**A. Armazón y sistema visual (toda pantalla).**
1. **Cabecera y navegación.** *(Desde el 13/11/2026 la navegación se rediseña en L1: barra lateral que se contrae a iconos, el mismo menú como cajón bajo 1 000 px y la línea de servicio fuera de la cabecera; lo que sigue describe lo construido el 11/11.)* ✅ panel, 11/11/2026 (sin «en vivo» en la cabecera: cada pantalla conserva el suyo; Condiciones, Cuarentena y Estado del sistema se nombran sin enlace hasta tener pantalla; Actividad, «Dar de alta» y Preferencias tienen enlace desde el mismo día). Arriba: el nombre del sistema, el selector de sitio (solo si la persona tiene más de uno; el sitio vive
   en la URL `?sitio=` y la última elección se guarda en las preferencias, lo que llega con P13) y el menú principal: Tablero · Inventario · Condiciones ·
   Cuarentena · Actividad (administrador de sitio) · Usuarios (administrador de sitio) · Estado del sistema (administrador del sistema).
   A la derecha: «en vivo», quién soy y el menú de cuenta (Preferencias, Cambiar la clave, Salir, Cerrar en todos lados). Bajo 700 px el
   menú se pliega tras un botón «Menú» con texto (nunca solo un icono). El pie «Legal y acerca de» (P11) va en todas las pantallas. La
   pantalla de llegada tras entrar es el tablero (P1), no el inventario.
2. **Tokens de diseño en `app.css`** ✅ panel, 11/11/2026; y ningún color escrito suelto en un componente: superficie y superficie elevada, texto primario y
   secundario, borde, acento (`#0b3954`, el de hoy), los estados de §2 (los cuatro de entonces: todos entre 6,6:1 y 8:1 de contraste, medidos el
   11/11/2026), los seis colores de series (punto 3), espaciado en pasos de 4 px (4, 8, 12, 16, 24, 32), escala tipográfica (0,8 · 0,9 ·
   1 · 1,15 · 1,4 · 2 rem, `system-ui`: la CSP no admite fuentes externas), números tabulares (`font-variant-numeric: tabular-nums`) en
   tarjetas y tablas, radios de 6 y 10 px, sombra suave solo en tarjetas elevadas y el foco visible de 3 px que ya existe. **Tema claro y
   oscuro:** por `prefers-color-scheme` y por la preferencia de la persona (P13; `data-theme` en `<html>` manda sobre el sistema
   operativo); el oscuro redefine los tokens, nunca los componentes.
3. **Colores de las gráficas, validados antes del código.** ✅ panel, 11/11/2026. Series categóricas (varias series en un gráfico: P3b y los canales de un
   dispositivo): la paleta de Okabe e Ito en este orden fijo —azul `#0072b2`, naranja `#d55e00`, verde `#009e73`, amarillo `#e69f00`,
   rosa `#cc79a7`, celeste `#56b4e9`— pasa las seis comprobaciones del método de visualización sobre fondo claro (banda de luminosidad,
   croma, separación para daltonismo entre vecinas ΔE ≥ 9,6, separación normal ≥ 20, contraste), con una obligación: amarillo, rosa y
   celeste quedan bajo 3:1 frente al fondo, así que toda gráfica con varias series lleva leyenda con nombres y la tabla de valores al lado
   (P3b ya la tiene; desde L4c la leyenda es la fija de nombres y la tabla, «Ver los datos»). Sobre fondo oscuro, los mismos seis matices re-escalonados: `#2a86c7`, `#d55e00`, `#009e73`, `#c98500`, `#c26a9b`,
   `#1f8fc9` (pasan las seis; la pareja rosa–celeste queda en 7,6 para daltonismo, admisible solo con leyenda y tabla, que se exigen
   igual). El orden es parte de la validación: cambiarlo exige volver a validar. En la ficha, «promedio» pasa al azul de la paleta y
   «lectura actual» al naranja: el azul oscuro y el rojo de hoy no pasan (luminosidad y croma fuera de banda). Nunca dos ejes verticales
   en un gráfico: dos magnitudes distintas son dos gráficos alineados en el tiempo. Series de estado (los colores de §2) nunca se
   reutilizan como series de datos. **Excepción explícita a WCAG 1.4.11 (decidido al implementar, 11/11/2026):** medidos contra la
   superficie del gráfico del tema claro (`#ffffff`), amarillo `#e69f00` da 2,25:1, celeste `#56b4e9` 2,31:1 y rosa `#cc79a7` 3,06:1; el
   rosa sí llega a 3:1, así que la excepción cubre solo amarillo y celeste, y se acepta porque toda gráfica con varias series lleva leyenda
   con nombres y la tabla «Ver los datos» de cada gráfico (el texto alternativo de `Grafico.svelte`). La prueba de contraste
   (`lib/tema.test.ts`) fija 2,2:1 para las series y 3:1 para todo lo demás, y comprueba que solo esas dos quedan bajo 3:1; en el tema
   oscuro las seis superan 4:1. Los colores no cambian: el orden está validado.
4. **Un valor, un estado.** ✅ panel, 11/11/2026 (tablero). Cada número visible nace de un único estado derivado; nunca un bloque se recalcula al escribir y otro al
   pulsar un botón (el defecto típico de «dos valores que no calzan» en una demostración). Lo que depende de un dato nuevo se actualiza
   junto o se marca «cargando».
5. **Teléfono (RF-52; WCAG 2.2, 1.4.10 y 2.5.8).** *(El alto de los gráficos y el gesto táctil, en L4g; el menú como cajón, en L1c.)* ✅ panel, 11/11/2026 (inventario en tarjetas y menú plegado; las capturas, en el paso 4c). Sin desplazamiento horizontal de la página desde 320 px: las tablas del inventario,
   las condiciones, la cuarentena y la actividad se vuelven listas de tarjetas bajo 700 px (una tarjeta por fila con lo esencial a la
   vista y el resto plegado); objetivos táctiles de 24 × 24 px CSS como mínimo y de 44 px en los botones principales; los gráficos al
   ancho disponible con la leyenda debajo. Capturas reproducibles a 390 y 1 280 px (paso 4c del guardián).

**B. P1 Tablero del sitio (HU-16, RF-30, HU-15, HU-07; TT-44).** Lo primero que se ve al entrar. De arriba abajo:
1. **Una sola fila de filtros** *(desde L2: la fila del rango va en las pestañas Tendencias y Red; el Resumen no la lleva)* ✅ panel, 11/11/2026 (el sitio, en la cabecera) (regla de los tableros de monitoreo: los filtros arriba y alcanzan a todo lo que está debajo): sitio (si
   hay varios), rango temporal (última hora, 24 h, 7 días, 30 días y **a medida**, con fecha y hora de inicio y fin: HU-07) y el aviso de
   zona horaria. El rango va en la URL (`#/?sitio=&rango=7d`, o `&desde=&hasta=` en ISO), como toda vista.
2. **Fila de indicadores** *(desde L2a, la ficha entera es el enlace y «Tramas» va en la misma franja)* ✅ panel, 11/11/2026; ✅ backend, 11/11/2026 (los estados de §2 más el total; «en línea», en la tarjeta de salud) (tarjetas de valor, no gráficos de una barra): Dispositivos (total) · Normal · Alerta · Sin señal ·
   Esperando primera trama (desde el 18/11/2026) · Inactivos (todos suman el total; «en línea» va en la tarjeta de salud), cada una un botón que abre el inventario filtrado (como hoy las fichas de conteo); **Salud del sitio** = en línea ÷ (total
   − inactivos − los que esperan su primera trama, que aún no se supervisan: §2), en porcentaje con un medidor de una sola rampa y en texto («14 de 16 reportan»), que es el indicador agregado de RF-30;
   condiciones abiertas por tipo (barras horizontales ordenadas, un solo matiz) y las tramas del rango, recibidas y rechazadas. Todo sale
   de una sola respuesta, `GET /sitios/{id}/resumen` (Etapa 4), y cambia en vivo con los eventos del canal (F3) sin repedir el resumen por cada
   evento (antirrebote de §6).
3. **«Requiere atención»:** ✅ panel, 11/11/2026; hasta diez dispositivos en Sin señal o Alerta, en el orden de atención de P2, con hace cuánto y la
   condición; enlace a cada ficha y «ver todos» (P2 ordenado por atención, sin filtro de estado: el inventario filtra por un solo estado y aquí
   conviven dos; decidido al implementar, 11/11/2026).
4. **Gráficas del sitio** *(desde L2 y L4: en las pestañas Tendencias y Red, vivas y con etiqueta flotante)* ✅ panel, 11/11/2026; ✅ backend, 11/11/2026 (uPlot, cursor sincronizado entre ellas): (a) **tramas por cubo** del rango, recibidas y rechazadas como barras
   apiladas (dos colores de la paleta, leyenda); (b) **una gráfica por magnitud que el sitio mide** (hasta seis; las demás, en una
   lista): el promedio del sitio por cubo *(desde el bloque M, 14/11/2026: el promedio de los dispositivos, cada uno con su lectura
   propia o vigente, y no el de todas las lecturas)* con la banda mín–máx del mismo matiz al 15 % y cuántos dispositivos aportan («promedio de 9
   dispositivos»; desde M3, «Promedio de los dispositivos que reportan, cada 15 minutos (hasta 9)», con el número de la respuesta; un canal
   por dispositivo y magnitud, así que el conteo de canales es el de dispositivos), de `GET /sitios/{id}/historico` (Etapa 4); un clic abre P3b con esa magnitud y hasta seis dispositivos del sitio; la resolución
   la fija el rango, como en P3; (c) **entrega por dispositivo** (HU-15, calidad del enlace): tramas recibidas en el rango ÷ esperadas
   (ventana ÷ intervalo esperado), barras horizontales de peor a mejor (hasta diez; «ver todos» en P2, columna Entrega); quien tiene
   canales de señal (RSSI, SNR) los muestra en su ficha como cualquier canal. No se inventa una calidad sin datos.
5. **Vacíos con camino:** ✅ panel, 11/11/2026; un sitio sin dispositivos muestra «Da de alta el primero» (P7) y «Alta masiva por archivo» (los enlaces llegan con P7); un rango sin
   tramas lo dice y ofrece «últimos 30 días».

**C. P2 Inventario v2 (RF-47, RF-51, RF-57, TT-42).** ✅ panel, 11/11/2026; ✅ backend, 11/11/2026 (el SQL del estado visual, en el backend). Lo de hoy sigue; cambia: (1) **el servidor filtra y pagina**
(`GET /dispositivos?sitio&zona&via&estado&q&limite&desplazamiento`, total en la cabecera `X-Total` para no cambiar la forma de la
respuesta), 50 por página con «1–50 de 132»; el estado visual lo calcula también el servidor, con la regla de §2 escrita en SQL (inactivo
si el estado administrativo no es activo; sin señal si hay `sin_comunicacion` abierta o no está en línea; alerta si hay otra condición
abierta; normal), y la prueba de §2 comprueba fila por fila que el servidor y `estadoVisual()` del panel dicen lo mismo (el panel conserva
su función para recalcular en vivo sin repedir la página); (2) columna **Entrega** (%, de B4c), ordenable; (3) **tarjetas en teléfono**
(A5); (4) «Marcar los visibles» para comparar, con el tope de seis; (5) las fichas de conteo y los filtros con conteo siguen, ahora del
servidor.

**D. P3 Ficha v2 y gráficas (HU-07, RF-33, RF-49).**
1. **Zoom por arrastre que refina.** ✅ panel, 11/11/2026. Arrastrar sobre el gráfico acota el rango (uPlot lo trae); el panel pide el histórico de esa ventana
   con la resolución más fina admisible (entre 2 y 2 500 puntos, la regla de hoy) y la dibuja; «Volver» (botón con texto) deshace el
   último zoom y el doble clic vuelve al rango completo. La ventana acotada va a la URL como `desde` y `hasta` (ISO), que es también la
   forma del **rango a medida** por fecha y hora (HU-07): un solo mecanismo. Mientras la ventana no termina en «ahora», el vivo no agrega
   puntos (es historia) y la cabecera dice «rango fijo · Volver a ahora».
   **D1b. Elegir las fechas en la ficha (HU-07; decidido y hecho el 15/11/2026).** ✅ panel, 15/11/2026. Junto a los rangos y «Volver», un botón «A medida» abre el mismo
   formulario del tablero (B1), un solo componente para las dos pantallas: «Desde» y «Hasta» (fecha y hora) escritos en la hora del
   sitio, con la ayuda «En la hora del sitio (zona); hasta 366 días» y el error ligados a los dos campos. La regla es una sola función:
   el fin debe ser posterior al inicio y el ancho, de 366 días como mucho (el tope del servidor); si no, se dice el motivo junto a los
   campos y no se pide nada. Una ventana buena es una `fija` más: va a la URL como `desde` y `hasta`, la gráfica y el «Historial de
   eventos del rango» (D5) piden esa misma ventana, el vivo no agrega puntos y la cabecera dice «rango fijo · Volver a ahora». La
   resolución es la que el tablero da a ese ancho (la del menor rango de la lista que lo contiene: 1 min, 15 min, 1 h, 6 h, y 1 día más
   allá de 30 días), siempre de la lista cerrada de la API; el zoom por arrastre sigue refinando con la más fina admisible.
2. **Varias series sin dos ejes.** ✅ panel, 11/11/2026; ✅ backend, 11/11/2026. Botón «Todos los canales»: una gráfica pequeña por canal (misma ventana, cursor sincronizado, un eje
   cada una) en una fila que se envuelve; se pide todo de una vez con `GET /dispositivos/{id}/historico` (Etapa 4), no un pedido por canal. P3b
   (comparar dispositivos) sigue como está.
3. **Agregados con su nombre y su banda.** ✅ panel, 11/11/2026; ✅ backend, 11/11/2026. El histórico trae, por cubo, promedio, mínimo y máximo (campos nuevos, compatibles); el gráfico
   dibuja el promedio y, con «mostrar mín–máx», la banda del mismo matiz al 15 %; el texto bajo los botones sigue diciendo «N puntos,
   promedio por X».
4. **Umbrales y condiciones dibujados.** ✅ panel, 11/11/2026. En el gráfico del canal, líneas horizontales con etiqueta para el umbral alto y el bajo («alto
   30 °C») y la banda de histéresis sombreada; las condiciones de ese canal dentro de la ventana, como franjas verticales (de `abierta_en`
   a `cerrada_en` o hasta ahora) con su tipo al pasar el cursor. Así se ve por qué sonó una alerta.
5. **Historial de eventos del dispositivo en el rango** ✅ panel, 11/11/2026; ✅ backend, 11/11/2026 (HU-07): lista por cursor, `GET /dispositivos/{id}/eventos?desde&hasta` (Etapa 4), con
   quién lo hizo cuando hubo persona (HU-11, G1), con su nombre y, al lado, su correo (20/11/2026, G; dos cuentas con el mismo nombre se distinguen por él).
6. **Tramas rechazadas agrupadas:** ✅ panel, 11/11/2026; filas iguales (mismo motivo y detalle) se muestran una vez con «× N» y la última fecha; paginación por
   cursor. Hoy la ficha lista veinte filas idénticas.
7. **Unidades para personas:** ✅ panel, 11/11/2026; los códigos de unidad de SenML se muestran con su símbolo («Cel» → «°C», «%RH», «hPa», «dBm», «V») desde
   una sola tabla del panel y, según la preferencia (°C o °F; mm, m o km), la conversión ocurre solo al mostrar, con la unidad escrita al
   lado (P13; la base no cambia). Sin preferencia no se convierte nada: se muestra la unidad del catálogo; y la conversión de longitud aplica
   solo a magnitudes de longitud, distancia o nivel, nunca a una precipitación en mm (decidido al implementar, 11/11/2026).

**E. P6 Configurar (HU-06, HU-13, RF-14; F2).** ✅ backend, 11/11/2026 (rutas, validación en el servidor, bloqueo optimista, evento con la persona y retardo de activación en el filtro alertar; las notificaciones, no). ✅ panel, 11/11/2026 (P6 en `#/dispositivos/<id>/configurar` y las notificaciones en pantalla y del navegador; `docs/16 §64`). Decidido al implementar (11/11/2026): los umbrales se escriben en la unidad en que se guardan (la del catálogo, escrita al lado), no en la de la preferencia, para no sumar un redondeo a cada guardado; el rango físico de la magnitud lo comprueba solo el servidor (la ficha no lo trae) y su 400 se escribe junto al campo; las notificaciones comparten con el tablero, el inventario y la comparación UNA conexión al canal sin filtro por pestaña (`abrirCanalCompartido`), porque el proxy acota las conexiones a ese canal. Desde la ficha, para operador técnico, administrador de sitio y del sistema. Del
dispositivo: nombre, estado (activo / mantenimiento), intervalo esperado y zona (mudar dentro del sitio); por canal: etiqueta, umbral
alto, umbral bajo, histéresis y **retardo de activación** en segundos (0 por defecto; RF-14: la condición se abre cuando la medición lleva
al menos ese tiempo fuera de la banda, y la histéresis la cierra). Validación en una sola función compartida con el servidor (bajo < alto;
histéresis menor que la mitad de la banda; valores dentro del rango físico de la magnitud; retardo entre 0 y 86 400). Guardar con bloqueo
optimista (`actualizado_en`; 409 → «alguien lo cambió a las 10:42: recarga», sin pisar), nunca optimista en pantalla (regla de §6).
Rutas (Etapa 4): `PATCH /dispositivos/{id}` y `PUT /canales/{id}/reglas` (reemplaza las reglas del canal). Cada guardado deja un `evento` con la
persona (G1). **Notificaciones en pantalla (HU-24, HU-25):** una condición que se abre en un sitio de la persona aparece como aviso
agrupado por dispositivo (`aria-live`) en cualquier pantalla; en P13 cada persona elige para qué tipos quiere además la **notificación
del navegador** (permiso pedido al activarla, `docs/21 §5`), con un cuerpo genérico («N condiciones nuevas en» el sitio; el detalle, en
la pantalla). En teléfono se ven 2 avisos y el resto queda plegado en «y N más», para no tapar el campo con el foco (WCAG 2.4.11;
corrección del 11/11/2026). No hay correo saliente (`docs/20 §4`): un canal saliente por sitio
(webhook) queda diseñado para la iteración 2. Desde el 20/11/2026 (bloque T, punto 8), el editor de reglas suma «Usar el sugerido»: llena una regla con el umbral sugerido de la
magnitud, sin guardar.

**F. P7 Alta: asistente, alta masiva y bandeja de detectados (HU-22, RF-50; decididas el 25/10/2026).**
1. **Asistente** ✅ panel, 11/11/2026 (`#/alta`; sin la receta de decodificación —antes «perfil de decodificación», migración 17—, que sigue por API) de cinco pasos (§3): identidad y zona; vía y formato (pasarela si LoRaWAN; receta de decodificación si la hay); canales
   y magnitudes del catálogo; credencial mostrada una sola vez con «Copiar» y el tópico; «esperando la primera trama» en vivo. Un
   identificador que ya existe inactivo ofrece reactivarlo (409 con la ficha), no crea un duplicado. Construido así (11/11/2026): cada
   paso con su encabezado «Paso N de 5», que recibe el foco al cambiar de paso, y los errores del paso 1 ligados a cada campo; la magnitud
   se escribe por su **código** del catálogo (el selector del catálogo queda pendiente); la hora de la primera trama va en la zona del
   sitio, o en la zona propia de P13 si la hay (regla en P13); un identificador que ya existe responde 409 y remite al inventario (la
   reactivación desde el asistente queda pendiente).
2. **Alta masiva por archivo:** ✅ backend, 11/11/2026; ✅ panel, 11/11/2026 (`#/alta?modo=lote`). **Reemplazado por el bloque N el
   15/11/2026** (vista previa con el plan por fila y creación todo o nada en una petición; lo que rige está allí y en `docs/11 §4`). Lo
   histórico, en una frase: hasta entonces el panel validaba completo y creaba en tandas de 50, con «creadas N de M» y «Reintentar las
   restantes» (la última de 10 tandas recibía 429), y las rechazadas no bloqueaban a las válidas. Lo que sigue igual: el CSV se lee en el
   navegador; las credenciales no se dibujan: se descargan una vez y «Ya las guardé: olvidarlas» las saca de la memoria; «Descargar
   rechazadas» agrega la columna `motivo`, que el lector ignora al volver a subir.
3. **Bandeja de detectados (Etapa 4):** ✅ backend, 11/11/2026; ✅ panel, 11/11/2026 (`#/alta?modo=detectados`); `GET /cuarentena/detectados?sitio` agrupa las tramas rechazadas por `no_registrado` de los últimos 7 días
   por emisor (identificador o tópico), con cuántas y la última; cada fila lleva al asistente con el identificador ya escrito. Es la
   forma de dar de alta «lo que ya está hablando».

**G. Actividad y quién lo hizo (P14, nueva; HU-11, RF-46, HU-26).** ✅ backend, 11/11/2026 (`docs/20 §10` R29).
1. ✅ backend, 11/11/2026 (columna y su uso en las escrituras; usuarios, aún con su detalle). `evento` gana `usuario_id` (nulo para lo que hace el sistema): toda escritura con sesión lo deja (alta, baja, mantenimiento,
   umbrales, calibración, credenciales, usuarios), y `GET /dispositivos/{id}` y la ficha muestran «registrado por N». «Registrado por N» solo
   para administradores: el nombre lo reciben el administrador de ese sitio y el del sistema; los demás perfiles, `usuario: null`
   (`docs/21 §2`; decidido el 11/11/2026). **Desde el 20/11/2026** la persona viaja como `{ id, nombre, correo }` y el panel escribe el nombre y,
   al lado y en texto secundario, el correo (un solo ayudante, `Persona.svelte`, en la ficha, en «Actividad» y en los enlaces públicos): dos cuentas con el mismo
   nombre ya no se ven iguales. Una cuenta anonimizada muestra solo su marcador, sin correo. No amplía quién ve el correo (`docs/21 §2`: los mismos que ven el nombre).
2. **P14 Actividad** ✅ panel, 11/11/2026 (el menú, según la acción `auditoria` de la matriz del servidor; la persona y el tipo del filtro salen de `GET /usuarios` y de los tipos recibidos) (`#/actividad`; administrador de sitio en sus sitios, administrador del sistema en todos): una lista por cursor que
   mezcla `evento` (con persona y dispositivo) y `acceso` (entradas, salidas y bloqueos de las personas de esos sitios), con filtros por
   persona (cada opción, «Nombre — correo», para distinguir homónimos), tipo y rango, el «Quién» con nombre y correo (20/11/2026), y texto para personas («cambió los umbrales de Humedad del invernadero»); de
   `GET /sitios/{id}/actividad?desde&hasta&tipo&usuario&cursor` (Etapa 4). La auditoría por petición HTTP de `docs/10 §8.4` punto 43 sigue
   siendo de la monitorización (B4) y no se muestra aquí.

**H. P13 Preferencias y mi cuenta (HU-29, RF-56; HU-28).** ✅ panel, 11/11/2026 (`#/preferencias`; los guardados van en fila, nunca dos `PUT` en vuelo, y uno rechazado devuelve solo lo que él cambió; la sesión actual no se cierra desde la lista, para eso está «Salir»; las vistas guardadas se toman de la última vista de datos abierta; decidido al implementar). ✅ backend, 11/11/2026 (además `GET /cuenta/exportar` y `POST /cuenta/baja` (Etapa 4); `docs/20 §10` R26 y R28). Tabla `preferencia` (una fila por persona: unidad de temperatura, unidad de
longitud, zona horaria «la del sitio» o una IANA, tema, tipos de condición con notificación del navegador, vistas guardadas con nombre
—filtros de P2, rango y resolución de P3— y `actualizado_en`); `GET` y `PUT /preferencias` propias (Etapa 4), con bloqueo optimista; se aplican al
cargar la sesión (`GET /sesion` las trae) y el panel las guarda de forma optimista (reversible). **Mi cuenta:** nombre, correo, sitios y
perfiles, **sesiones abiertas** (Etapa 4) con `GET /sesiones` (creada, última actividad, navegador acotado, origen truncado; «cerrar» con
`DELETE /sesiones/{id}` (Etapa 4); decidido aquí porque la fila faltaba en el backlog y cuesta una tarde), versión de términos aceptada, «Exportar
mis datos» (JSON por `descargar`) y «Darme de baja» (`docs/20 §11`).

**I. Contrato de la API que este diseño fija** (rutas nuevas o cambiadas; el código por perfil, en `docs/20 §6`). ✅ backend, 11/11/2026: todas (`/sitios/{id}/actividad`, `/preferencias` y `/sesiones`, el mismo día: `docs/16 §63`; `/sitios/{id}/ahora`, el 13/11/2026: `docs/16 §66`); medido en `docs/16 §61`.
| Ruta | Qué devuelve o hace | Quién |
|---|---|---|
| `GET /sitios` | mis sitios con código, nombre, zona horaria, zonas y mi perfil en cada uno (el administrador del sistema, todos) | con sesión (Etapa 4) |
| `GET /sitios/{id}/resumen?desde&hasta[&intervalo]` | conteos por estado visual, condiciones abiertas por tipo, tramas recibidas y rechazadas por cubo (resolución del rango, o `intervalo` de la lista cerrada; la respuesta la declara en `ventana.intervalo` y el panel rotula con eso; los cubos sin datos no se emiten: no son 0), entrega de los 50 dispositivos con peor entrega en el rango pedido y cuántos activos hay, magnitudes medidas con cuántos canales, «requiere atención» | consulta o más (Etapa 4) |
| `GET /sitios/{id}/ahora?limite&tendencia` (L6, 13/11/2026) | lo que se mide ahora: cuántos reportan y cuántos están sin señal, el promedio, mínimo y máximo por magnitud de la última lectura vigente de cada canal, y hasta 60 tarjetas (24 por defecto) de los que reportan, alerta primero, con hasta tres canales y su última lectura; con `tendencia=si`, 24 promedios por hora por canal (si su cálculo no alcanza el tiempo o el cupo, `tendencia: false`) | consulta o más (Etapa 4) |
| `GET /sitios/{id}/historico?magnitud&desde&hasta&intervalo` | por cubo: promedio, mínimo, máximo, lecturas y n de todos los canales de esa magnitud del sitio (desde el bloque M: promedio y banda **entre dispositivos**, cada uno con su lectura propia o vigente; `n`, los que aportan); 5 000 cubos y **31 días** (lee todos los canales de la magnitud: 30 días de 120 canales cada 300 s tardan ≈ 1,1 s, `docs/16 §61`; más largo, por canal o exportación) y, desde M5, 5 s de tiempo máximo de la consulta (si no, 503) | consulta o más (Etapa 4) |
| `GET /canales/{id}/historico` | además del promedio, mínimo y máximo por cubo (campos nuevos) | como hoy |
| `GET /dispositivos/{id}/historico?desde&hasta&intervalo` | todos los canales del dispositivo en una respuesta, alineados por cubo | consulta o más (Etapa 4) |
| `GET /dispositivos` | filtros `sitio, zona, via, estado, q` (`sitio` y `zona` son ids; el panel traduce el código de su URL con `GET /sitios`), `orden` (`nombre` por defecto, `entrega` de peor a mejor con los nulos al final, o `atencion`: sin señal, alerta, normal, esperando, inactivo y dentro por nombre) y paginación `limite, desplazamiento`; `estado_visual` y `entrega` (sobre las últimas 24 h; nulo si el dispositivo no está activo, si espera su primera trama o si en la ventana no cabe una trama esperada completa; 0 % si esperaba y no llegó nada) por fila; total en `X-Total` | como hoy |
| `GET /dispositivos/{id}/eventos?desde&hasta&cursor` · `GET /condiciones` · `GET /cuarentena` · `GET /sitios/{id}/actividad` | keyset (`docs/10 §8.4` punto 58): el cursor de la página siguiente en la cabecera `X-Siguiente`; el cuerpo sigue siendo la lista; `GET /condiciones` admite además `desde` y `hasta` (las franjas del gráfico de la ficha; con 500 filas el panel avisa que muestra las más recientes) | según la ruta (Etapa 4) |
| `GET /cuarentena/detectados?sitio` | emisores no registrados de los últimos 7 días: identificador o tópico, cuántas tramas, última | administrador de sitio hoy; operador técnico cuando exista el perfil (Etapa 4) |
| `PATCH /dispositivos/{id}` | nombre, estado, intervalo esperado, zona y, en un nodo lorawan, la receta de decodificación (TT-12, 23/11/2026); `actualizado_en` obligatorio; 409 si cambió | la acción `configurar`: operador técnico, administrador del sitio y del sistema (`docs/20 §6`) |
| `PUT /canales/{id}/reglas` | reemplaza las reglas del canal (alto, bajo, histéresis, retardo); `actualizado_en`; 409 | administrador de sitio hoy; operador técnico cuando exista el perfil (Etapa 4) |
| `POST /dispositivos/lote?modo=validar\|crear` | informe fila por fila; en `crear`, las credenciales una sola vez; desde el bloque N, el plan por fila con su huella, y en `crear` la huella y `Idempotency-Key`, todo o nada (409 `plan_cambio` o `lote_en_curso`) | administrador de sitio hoy; operador técnico cuando exista el perfil (Etapa 4) |
| `GET /dispositivos/lote/plantilla` (bloque N) | columnas del lote (nombre, obligatoria, tope, ayuda, ejemplo), `max_filas`, `max_bytes` y separadores | operador técnico y administradores (la acción «escribir») |
| `GET /magnitudes` (bloque N) | el catálogo: código, nombre y unidad canónica | con sesión |
| `GET /preferencias` · `PUT /preferencias` | las propias; bloqueo optimista | con sesión (Etapa 4) |
| `GET /sesiones` · `DELETE /sesiones/{id}` | las propias | con sesión (Etapa 4) |
Compatibilidad: ninguna respuesta cambia de forma (los totales y los cursores van en cabeceras; los campos nuevos se suman); el OpenAPI se
regenera y el paso 4b del guardián suma una fila por ruta y perfil. **Campos** (los nombres son los de las columnas, como en todo el
panel; el OpenAPI generado es la fuente una vez construido): `/sitios` → `id, codigo, nombre, zona_horaria, rol, zonas[{id, nombre}]`;
`/sitios/{id}/resumen` → `sitio, ventana{desde, hasta, intervalo}, dispositivos{total, normal, alerta, sin_senal, esperando, inactivo}, salud{reportan,
supervisados, porcentaje}, condiciones_abiertas[{tipo, n}], tramas{recibidas, rechazadas, cubos[{tiempo, recibidas, rechazadas}]},
atencion[{id, nombre, estado_visual, visto_por_ultima_vez, tipos}], magnitudes[{codigo, nombre, unidad, canales}], entrega[{id, nombre,
recibidas, esperadas, porcentaje}]` (los 50 peores), `total_activos`; `/sitios/{id}/ahora` → `reportan, sin_senal, por_magnitud[{codigo,
nombre, unidad, salud, canales, promedio, minimo, maximo}], dispositivos[{id, nombre, zona, estado_visual, visto_por_ultima_vez,
intervalo_esperado_s, canales_total, canales[{id, magnitud, magnitud_nombre, unidad, salud, ultima{valor, tiempo, porcentaje}|null,
chispa?}]}], tendencia, chispa?{desde, intervalo, puntos}` (las `chispa`, solo con `tendencia: true`; L6); `/sitios/{id}/historico` → la forma de `Historico` más `minimos, maximos, n` y `magnitud, unidad`;
`/canales/{id}/historico` → `minimos, maximos` además de lo de hoy; `/dispositivos/{id}/historico` → `tiempos, canales[{id, magnitud,
magnitud_nombre, unidad, valores, minimos, maximos, muestras}]`; cada fila de `/dispositivos` suma `estado_visual` y `entrega`;
`/dispositivos/{id}/eventos` → `id, tipo, detalle, ocurrido_en, usuario{id, nombre, correo}|null`; `/cuarentena/detectados` → `sitio_codigo, emisor, topico,
tramas, ultima` (una fila por sitio y emisor); `PATCH /dispositivos/{id}` (Etapa 4) recibe `actualizado_en` y los campos que cambian, y responde la ficha o 409 con el
`actualizado_en` vigente; `PUT /canales/{id}/reglas` (Etapa 4) recibe `actualizado_en, etiqueta, reglas[{id?, umbral_alto, umbral_bajo, histeresis,
retardo_s}]` (con `id`, cambia esa regla; sin `id`, una nueva; las que no vienen se quitan: decidido el 11/11/2026); `POST /dispositivos/lote` (Etapa 4) recibe `filas[{id_fisico, nombre, zona, via, formato, intervalo_esperado_s, canales, pasarela}]`
(el panel convierte el CSV) y responde `validas, rechazadas, existentes, filas[{n, id_fisico, resultado, motivo, id, credencial, topico}]`
con `resultado` en `valida | creada | rechazada | existe`; `/preferencias` → `unidad_temperatura (C|F), unidad_longitud (mm|m|km),
zona_horaria (sitio|IANA), tema (sistema|claro|oscuro), notificar[tipos], vistas[{nombre, pantalla, parametros}], sitio_predeterminado,
actualizado_en`, con `parametros` un objeto texto → texto en el panel y en el servidor (la ruta del panel que abre la vista va en `ruta`,
`{ruta: '/inventario?estado=alerta'}`; corrección del 11/11/2026: el panel la mandaba como texto y el servidor rechazaba toda vista);
`/sesiones` → `id, creada_en, ultima_actividad, agente, origen, actual`; `/sitios/{id}/actividad?desde&hasta&tipo&usuario&cursor&limite` →
`id, instante, clase (evento|acceso), tipo, texto, usuario{id, nombre, correo}|null, dispositivo{id, nombre}|null` (`correo` nulo en una cuenta anonimizada); cada fila de `/condiciones`
suma `sitio` (el nombre: el cuerpo genérico de la notificación del navegador).

**J. Pruebas y medición (antes de dar por hecho).** Por el DOM: cada pantalla en los dos sentidos (lo que debe verse y lo que debe
frenarse); las conversiones de unidad con casos de ida y vuelta; el estado visual del servidor frente al del panel; la validación de
reglas compartida. Con navegador real (paso 4c, Chromium y Firefox, 390 y 1 280 px): los indicadores suman el inventario; un zoom cambia
la resolución y la URL; un rango a medida se comparte por enlace; cambiar °C a °F cambia la tarjeta y no la base; un 409 en P6 con dos
pestañas; un lote con filas rechazadas crea solo las válidas; un detectado llega al asistente con el identificador; las tarjetas en
teléfono sin desplazamiento horizontal. En `docs/16`: tiempo del resumen y del histórico del sitio con la serie de 30 días del banco
(como §52), tiempo del lote de 500 filas y el tamaño del paquete del panel antes y después (el tablero no debe duplicarlo).

**K. Orden de construcción (iteración 1).** Primero el contrato (I) en el backend con sus humos y, a la vez, el armazón, los tokens y
las gráficas del panel contra ese contrato; después P6, P7, P13 y P14; al final el teléfono con capturas y la medición. Lo que no
alcance se declara con este diseño escrito, nunca a medias.

**L. Tablero v3: armazón lateral, pestañas, «Ahora» y gráficas vivas (diseñado el 13/11/2026, antes del código, y revisado el mismo día).**
Qué lo motiva: con la semilla completa cargada, el tablero v2 mide 3 957 px de alto a 1 280 px y 6 254 px a 390 px (más de siete
pantallas de teléfono); sus gráficas no cambian mientras se miran (solo los indicadores se repiden en vivo); no hay ninguna vista de
**lo que se mide en este momento**, que es la pregunta con la que llega quien abre el sistema; cada gráfica repite su título tres veces
y trae la tabla de leyenda que uPlot dibuja por defecto; y el menú es una fila de enlaces de texto con dos entradas sin pantalla. Este
bloque cambia A1, A5, B1, B2 y B4 y acota la regla de botones de §6 (punto 1e, con su precisión en RF-58); lo demás de A a K sigue.
Una revisión del diseño, antes de construir, quitó lo que costaba más de lo que daba: una barra inferior fija en teléfono (puede tapar
el foco, choca con el teclado en pantalla y deja casi sin contenido en apaisado), guardar en la cuenta si el menú está contraído (pedía
una migración por un dato que es de cada pantalla, no de la persona), las gráficas vivas en 7 y 30 días (repetían consultas de un
segundo para mover un cubo de seis horas) y volver a pedir datos por cada trama recibida.
1. **Armazón (cambia A1).** ✅ panel, 13/11/2026 (`docs/16 §67`; decidido al implementar: la marca corta es «IoT · Registro y monitoreo»
   y el nombre completo del sistema queda como título de la página para el lector de pantalla; el cajón se anuncia como diálogo modal y deja
   inerte lo que está detrás; «Saltar al contenido» lleva el foco a mano, porque un enlace a `#contenido` cambiaría la ruta del panel; un
   fallo del servicio se dice con un aviso al cargar, y una pantalla que no se pudo descargar (carga a pedido, punto 7) también).
   (a) *Desde 1 000 px:* **barra lateral** a la izquierda con la marca corta del sistema y el menú, cada
   entrada con icono y texto: Tablero, Inventario, Actividad, Usuarios y Dar de alta (según el perfil, como hoy) y, abajo, «Legal y
   acerca de». Una pantalla entra al menú cuando existe: se quitan las entradas «(próximamente)». (b) **Se contrae a solo iconos**
   (56 px) con el botón «Menú» de la barra superior; al abrir la página está expandida desde 1 280 px y contraída entre 1 000 y
   1 279 px. El estado vale mientras la página sigue abierta: no se guarda en la cuenta ni en el navegador (`docs/21` no cambia).
   (c) *Bajo 1 000 px* el mismo menú se abre como un **cajón** sobre el contenido con el botón «Menú» (reemplaza al menú plegado de
   hoy): se cierra con Escape, al elegir un destino, al tocar fuera o con su botón «Cerrar menú» (el último del cajón; agregado tras
   la revisión del 13/11/2026: sin él, quien usa un lector de pantalla táctil, sin tecla Escape, solo podía cerrarlo eligiendo un
   destino); mientras está abierto el foco no sale de él —si quedó fuera, en el cuerpo de la página, Tab lo devuelve al cajón, y
   «Saltar al contenido» queda inerte como lo demás— y, al cerrarlo,
   vuelve al botón. No hay barra fija abajo. (d) **Barra superior:** «Menú», el sitio (selector si la persona tiene más de uno; el
   nombre si no), el botón de tema (punto 5) y el menú de cuenta de hoy. El estado del canal en vivo sigue en cada pantalla, como
   decidió A1. La línea «servicio: ok, base conectada, N tablas» sale de la cabecera: describe la instalación y no ayuda a quien mira
   datos; pasa a «Legal y acerca de» (con sesión), y si el servicio falla se dice con un aviso. (e) **Solo icono, en un único
   lugar.** Los enlaces de la barra lateral contraída son los únicos controles sin texto visible: cada uno lleva como nombre accesible
   el texto de su entrada y lo muestra como ayuda al pasar el puntero o al enfocar (WCAG 2.2, 1.1.1 y 4.1.2; la ayuda es la de
   `Tooltip.svelte`, que debe cumplir 1.4.13: se quita con Escape, admite el puntero encima y dura mientras hay foco; corregido al
   implementar: Escape la quitaba solo con el foco dentro y salir del control la ocultaba antes de que el puntero llegara a ella, así que
   ahora escucha Escape en el documento mientras se ve y espera 150 ms antes de irse). Los botones
   siguen la regla de §6 —texto obligatorio—, también «Menú» y el de tema; RF-58 se precisa con esta única excepción. Los destinos
   miden 44 px. (f) **Iconos propios:** un solo componente con trazos SVG dibujados para este proyecto (sin biblioteca de terceros ni
   fuente de iconos: la CSP no admite recursos externos y no se suma una licencia), en una cuadrícula de 24 px y dibujados a 20 px
   (botones) y 22 px (menú), con `currentColor` y ocultos al lector
   de pantalla (el nombre es el del control). (g) Un enlace «Saltar al contenido» es lo primero que recibe el foco (2.4.1) y el orden
   del foco es barra superior, menú y contenido (2.4.3).
2. **El tablero en tres pestañas (cambia B1 y B2, y reordena B3 y B4).** ✅ panel, 13/11/2026 (decidido al implementar: la ficha de salud
   lleva al inventario del sitio y «Tramas (24 h)» a la pestaña Red con 24 horas; el resumen pide sus 24 horas con cubos de una hora, porque
   no los dibuja; el rango de Tendencias y Red se recuerda en memoria al pasar por el Resumen; Tendencias ordena las magnitudes de la más
   extendida a la menos, así con más de seis se dibujan las seis que más dispositivos miden; en teléfono, «Requiere atención» y «Ahora» se
   recortan con CSS a cinco y ocho, con su «ver todos»). Son enlaces con la vista en la URL
   (`#/?sitio=&ver=tendencias|red&rango=`; sin `ver`, el resumen), así el botón atrás del navegador vuelve a la anterior y una
   pestaña se comparte por enlace. **Resumen** es el presente: la franja de indicadores, «Ahora» (punto 3), «Requiere atención» y
   las condiciones abiertas por tipo; **no lleva selector de rango**, porque nada de lo que muestra depende de él (las tramas son las
   de las últimas 24 horas, y así se rotulan). **Tendencias** (una gráfica por magnitud, B4b) y **Red** (las tramas por cubo, B4a, y
   la entrega por dispositivo, B4c) llevan la fila del rango (B1). Solo se pide lo de la pestaña abierta: al entrar, el resumen y
   «Ahora» (dos pedidos; hoy son siete). (a) **Franja de indicadores:** fichas compactas —Dispositivos, Normal, Alerta, Sin señal,
   Esperando primera trama (desde el 18/11/2026), Inactivos, Tramas (24 h) y Salud del sitio—; el enlace de cada ficha es su rótulo con su cifra («Sin señal: 5») y su área activa
   cubre la ficha entera; ya no hay un «Ver en el inventario» por ficha; «Tramas» lleva a la pestaña Red. En teléfono, tres por fila
   y la salud a lo ancho. (b) Un nombre largo ocupa una línea con puntos suspensivos y se lee entero en la ayuda; nunca parte la
   fila. (c) Las barras ordenadas (condiciones por tipo, entrega) usan el tamaño de texto del cuerpo y **todas las pistas de una lista miden lo
   mismo**, tenga cada fila el valor que tenga escrito al lado: una barra se compara con las demás (corregido tras mirar las capturas del
   13/11/2026: con una columna de valor por fila, «0 % (0 de 17.399)» acortaba su pista y un 88 % se dibujaba más largo que un 90 %). (d) En teléfono, «Requiere
   atención» muestra cinco y «Ahora» ocho, con su «ver todos».
3. **«Ahora»: lo que se mide en este momento.** ✅ panel, 13/11/2026 (decidido al implementar: las fichas por magnitud no se recalculan en
   vivo —el panel no tiene todas las lecturas del sitio, solo las de las tarjetas— y se ponen al día con la próxima lectura de «Ahora»: un
   aviso `condicion`, «Reanudar» o una reconexión; la cifra lleva 0, 1 o 2 decimales según su tamaño; el nombre de la magnitud de cada cifra nunca se recorta —si no cabe, ocupa dos
   líneas: un número sin su nombre no dice nada—; la línea de tendencia se corta en los
   cubos sin lecturas). (a) **Por magnitud:** una ficha por cada magnitud que el sitio mide, con el
   promedio, el mínimo y el máximo de la última lectura de los dispositivos que están reportando y cuántos aportan («Temperatura
   17,2 °C · entre 11,8 y 21,4 · 9 dispositivos»). Es lo que busca quien solo consulta, y lo que podrá reutilizar la vista pública
   por enlace, que solo admite agregados (`docs/20 §7`). (b) **Por dispositivo:** una tarjeta por dispositivo **que está
   reportando** (estado Normal o Alerta, §2), primero los que tienen una alerta y después por zona y nombre, hasta 24 (con más,
   «Ver los N en el inventario»). Los que están sin señal no se repiten aquí —ya están en «Requiere atención», y una línea lo dice
   (*5 sin señal, en «Requiere atención»*, que en la pestaña queda debajo)—: así nunca se muestra en grande, como si fuera de ahora, un valor de hace semanas. Cada tarjeta: nombre,
   zona, estado, hace cuánto reportó y **hasta tres canales** con su último valor en grande y su unidad para personas (D7): primero
   las magnitudes de lo que se mide y al final las de salud del equipo (batería y señal: los códigos `bateria`, `tension` y `rssi` del
   catálogo `magnitud`, definidos en un solo lugar del backend, `MAGNITUDES_SALUD` de `consulta/tablero.ts`; una magnitud de salud nueva se
   agrega allí y aquí a la vez; dentro de cada grupo, por código, como la ficha); con más de tres, «+N»; un canal cuya
   última lectura tiene más de dos intervalos esperados se atenúa y dice su antigüedad. Junto a cada valor, una **línea de
   tendencia** de las últimas 24 horas (24 promedios por hora, en un trazo SVG decorativo: el dato es el número). El enlace es el
   nombre del dispositivo, con el área activa extendida a la tarjeta (§6: la tarjeta entera no es el nombre de un enlace). (c) **En
   vivo, sin pedir por cada trama.** Cada trama produce un aviso `medicion` por lectura y un `visto`: los dos se aplican en el panel
   —el valor, su hora y «hace cuánto»—, como ya hace la ficha, y **ninguno pide nada al servidor**; lo dibujado se pone al día como
   mucho una vez por segundo por tarjeta, con un resalte breve (ninguno si la persona pidió menos movimiento,
   `prefers-reduced-motion`). Solo un aviso `condicion` de un dispositivo del sitio repide «Ahora» y el resumen (antirrebote de §6),
   y mientras llegan tramas el resumen se repide, además, una vez por minuto (los conteos de tramas). Para saber qué avisos son del
   sitio, cada aviso trae su `sitio_id` (campo nuevo): hoy el panel lo deduce de las listas del resumen, que traen como mucho 60
   dispositivos. La tendencia se pide una vez al cargar y no se repide en vivo. Los cambios en vivo no se anuncian al lector de
   pantalla uno por uno (serían ruido): las condiciones nuevas ya tienen su aviso (E).
4. **Gráficas (cambia B4 y A5, y completa D).** ✅ panel, 13/11/2026 (decidido al implementar: el eje vertical mide lo que sus números,
   para que en un teléfono el área de dibujo gane ancho; el alto es 280 px, y 200 px cuando el gráfico mide menos de 560 px). (a) **Vivas donde sirve:** con el rango «última hora» o «24 horas», las gráficas de
   Tendencias y de Red se repiden solas mientras llegan avisos de dispositivos del sitio: como mucho una vez cada sexta parte del
   cubo y nunca fuera de 5 a 60 s (con cubos de un minuto, cada 10 s; de 15 minutos, cada 60 s), sin dos pedidos en vuelo y solo con
   la pestaña del navegador visible; la ventana avanza de cubo en cubo (su inicio se alinea al cubo, para que los promedios ya
   dibujados no cambien) y se lee «actualizado hace N s». Con 7 o 30 días no se actualizan solas —el último cubo, de una o seis
   horas, casi no cambia y cada pedido lee el rango entero (`docs/16 §61`)—: hay un botón «Actualizar». Con un rango fijo es
   historia, como hoy. La base sigue siendo la fuente: el panel no recalcula promedios con lo que llega. **«Pausar»**, en la fila
   del tablero, detiene toda actualización automática (WCAG 2.2, 2.2.2) y «Reanudar» vuelve a pedir una vez lo que se muestra, como
   al reconectar (F4). **Toda es toda** (precisado tras la revisión del 13/11/2026): un refresco que ya estaba programado o en vuelo
   al pausar no llega a dibujarse, los «hace N s» dejan de avanzar y la fila dice desde cuándo («en pausa desde las 14:05:09», hora
   del sitio), para que nadie lea como actual una pantalla detenida. Y un refresco automático nunca pisa lo que la persona pidió:
   cambiar de rango olvida el refresco pendiente, que no corre fuera de «última hora» y «24 horas»; la ficha, que hoy descarta lo que llega en pausa y no lo repone, se corrige igual. (b) **Un título por
   gráfica,** el de su sección: el lienzo no repite el nombre (lo conserva como nombre accesible y como título de la tabla «Ver los
   datos»). (c) **Etiqueta flotante en vez de la tabla de leyenda:** uPlot no la trae; es un complemento propio sobre su gancho del
   cursor. Aparece solo en el gráfico que está bajo el puntero (los demás, sincronizados, muestran la línea del cursor), junto al
   punto, con la hora y el valor de cada serie con su unidad, sin salirse del gráfico; se quita al salir, con Escape o al desplazar
   la página. En pantallas táctiles, un toque la muestra y un toque fuera la quita; si en la prueba con navegador real no resulta
   fiable, en táctil queda una línea de leyenda compacta con los valores del punto tocado, y aquí se anota cuál quedó. **Quedó la etiqueta**
   (13/11/2026, probado en Chromium con pantalla táctil): uPlot no mueve su cursor con el dedo, así que el toque (al levantar el dedo,
   para que arrastrar siga desplazando la página) lleva el cursor al punto tocado y la etiqueta aparece ahí; tocar fuera o desplazar la quita. Nadie
   depende de ella: los mismos valores están en «Ver los datos». **Sus cifras llevan los decimales que distinguen dos valores de lo
   dibujado** y todas los mismos como mucho: uno si el recorrido de la gráfica es de 11 °C («19,4 °C», no «19,396 °C»), dos si es de
   1,5 hPa, nunca más de los tres que guarda la API; el resumen del rango de la ficha (D) sigue la misma regla, y el valor exacto queda
   en «Ver los datos» y en el CSV. Con más de una serie hay, además, una leyenda fija de nombres con
   su color (A3). (d) Los bordes de la banda mín–máx no dibujan puntos; la serie principal los dibuja solo con 30 puntos o menos.
   (e) Las gráficas de conteo (tramas) tienen eje de enteros. (f) Una magnitud sin datos en el rango no dibuja ejes vacíos: se
   nombra en una línea («Sin datos en este rango: …»). (g) **Alto según la pantalla:** 280 px en escritorio y entre 180 y 240 px en
   teléfono. El zoom por arrastre es del puntero; en una pantalla táctil arrastrar desplaza la página (uPlot no escucha gestos
   táctiles) y el rango se cambia con los botones y «A medida».
5. **Tema con un botón.** ✅ panel, 13/11/2026 (el único escritor de preferencias es `lib/escritor-preferencias.ts`: P13 y este botón
   guardan por su fila). En la barra superior (dentro del cajón, en teléfono), un botón con icono y texto —«Tema oscuro» o «Tema
   claro»: lo que hará— alterna entre los dos: se aplica al instante (`data-theme`) y, con sesión, guarda la preferencia `tema` por
   la misma fila de guardado de P13 (un solo escritor de preferencias en el panel: nunca dos `PUT` en vuelo ni un 409 contra uno
   mismo); si el servidor lo rechaza, vuelve y lo dice —vuelve solo lo que ese guardado cambió y nadie cambió después—. Si el rechazo
   es un 409 (la misma persona guardó antes desde otra pestaña u otro equipo), el panel relee las preferencias vigentes antes de
   decirlo, y el intento siguiente ya no choca (precisado tras la revisión del 13/11/2026: sin releer, cada guardado posterior
   repetía el 409 hasta recargar la página). Partiendo de «sistema», el primer toque pasa al contrario del tema que se
   está viendo; volver a «sistema» se hace en P13, que conserva las tres opciones. Sin sesión el botón vale para esa visita.
6. **Contrato que este bloque agrega (I).** ✅ backend, 13/11/2026 (`consulta/tablero.service.ts`; `docs/10 §8.4` punto 65 viii; medido en
   `docs/16 §66`). `GET /sitios/{id}/ahora?limite&tendencia` (Etapa 4) —consulta o más; otro sitio, 404; `limite` de
   1 a 60, 24 por defecto (fuera de eso, 400); `tendencia=si` suma las líneas de tendencia (cualquier otro valor o ausente: no)— → `reportan` y `sin_senal` (cuántos dispositivos hay en cada
   caso), `por_magnitud[{codigo, nombre, unidad, salud, canales, promedio, minimo, maximo}]` (sobre la última lectura de cada canal de los
   que reportan, solo si tiene menos de dos intervalos esperados del dispositivo; `canales`, cuántos aportan; `salud` y el orden —las de
   salud del equipo al final— se sumaron al implementar, 13/11/2026, para que el panel las ordene como las tarjetas sin repetir la lista) y `dispositivos[{id, nombre, zona, estado_visual, visto_por_ultima_vez, intervalo_esperado_s, canales_total,
   canales[{id, magnitud, magnitud_nombre, unidad, salud, ultima{valor, tiempo, porcentaje}|null, chispa[número|null]}]}]` (hasta
   tres canales por dispositivo, en el orden del punto 3b; `chispa`, solo con `tendencia: true`), `tendencia` (siempre: `true` si la
   tendencia está en la respuesta; `false` si no se pidió o si se omitió, ver abajo) y, con `tendencia: true`, `chispa{desde, intervalo,
   puntos}`: 24 cubos de una hora que terminan en la hora en curso (el último, parcial), alineados a la hora UTC (es una tendencia
   sin eje, no una serie para leer valores); un cubo sin lecturas es `null`, no 0. El estado visual sale de la misma regla en SQL
   que el inventario (C); por esa regla, un dispositivo activo que aún no envía nada espera su primera trama (desde el 18/11/2026; antes se mostraba Normal y
   aparecía aquí con sus canales en `null`) y no está entre los que reportan. Cada petición hace como mucho tres consultas, tenga el sitio
   uno o dos mil dispositivos (corrección del 13/11/2026, medida en `docs/16 §66`): la primera calcula **en la base** el agregado por
   magnitud, así que al proceso no viajan los canales de todo el sitio; la segunda trae solo los canales de los dispositivos de la página
   (ninguna si la página está vacía); la tercera, la tendencia, solo si se pidió y hay canales que mostrar. **La tendencia tiene dos topes**
   (13/11/2026, `docs/11 §4`): 2 s de tiempo máximo de sentencia, en una conexión propia, y como mucho dos cálculos a la vez en el proceso.
   Si no alcanza, la respuesta sale igual, con `tendencia: false` y sin ninguna `chispa`: no es un error, y el panel dibuja las tarjetas
   sin la línea. Los avisos `medicion`, `visto` y `condicion` del canal en vivo suman `sitio_id` (✅ backend, 13/11/2026: sale del mapa de
   sitios con que el servidor ya filtra el canal; es `null` solo para quien alcanza a todos los sitios, si el dispositivo es tan nuevo que
   el servidor aún no lo conoce: hasta la siguiente recarga del mapa, que pide el mismo aviso o el latido siguiente del flujo —cada 25 s—,
   con el tope de una recarga cada 5 s). Desde el 13/11/2026 el latido también pone al día el mapa para un dispositivo que cambia de sitio:
   sale con el sitio nuevo a más tardar un latido después, sin que nadie abra otro flujo. `/preferencias` no cambia.
7. **Pruebas y medición (J), con umbral.** ✅ panel, 13/11/2026 (`docs/16 §67`: lo de abajo, con la falla plantada de cada prueba nueva;
   la pestaña Resumen mide 2 119 px a 390 × 844 con la semilla completa recién cargada —cinco tarjetas de «Ahora»; menos cuando la semilla
   envejece y casi nadie reporta—; al entrar, dos pedidos; el paquete inicial bajó de 257 489 B a
   154 463 B con la carga a pedido de las pantallas). Por el DOM: el enlace de una ficha de indicador se llama por su rótulo y su cifra; el
   menú contraído conserva los nombres accesibles y el cajón devuelve el foco a «Menú»; una ráfaga de avisos `medicion` y `visto`
   cambia las tarjetas **sin ningún pedido**, y con tramas continuas hay como mucho un pedido de resumen por minuto; «Reanudar»
   vuelve a pedir una vez (tablero y ficha); el tema alterna y vuelve si el guardado falla; una magnitud sin datos no dibuja lienzo;
   la etiqueta flotante aparece y se quita con Escape. Con navegador real (paso 4c, 390 × 844 y 1 280 px, los dos temas, con la
   semilla completa): la pestaña Resumen no mide más de tres pantallas de alto a 390 px (2 532 px; hoy el tablero mide 6 254);
   ninguna pestaña se desplaza a lo ancho; el cajón se abre, navega y se cierra con el teclado. En `docs/16`: pedidos al entrar (de
   siete a dos); `GET /sitios/{id}/ahora` (Etapa 4) sin tendencia no tarda más que `…/resumen` en la misma medición con 120 fuentes (`§61`), y
   con tendencia se mide con tramas cada 60 s y cada 5 s (si con 60 s tarda más del doble que el resumen, la tendencia sale del
   diseño y se anota; medido el 13/11/2026 en `docs/16 §66`: sin tendencia, 6 ms frente a 28–200 ms del resumen; con ella y 60 s,
   25 ms frente a 195 ms: se queda; con 5 s, 392 ms, anotado); y el paquete inicial del panel no crece más de 10 % sobre el de `§64`, para lo cual las pantallas pasan a
   cargarse a pedido.

**M. El promedio del sitio es el de sus dispositivos (cambia B4b y la fila de `…/historico` del contrato; diseñado el 14/11/2026, antes del código).**
✅ backend y panel, 14/11/2026 (la consulta, `SQL_HISTORICO_SITIO` de `consulta/tablero.ts`; `docs/10 §8.4` punto 66; probado y medido en `docs/16 §68`).
Al mirar las gráficas de Tendencias con la semilla completa, salen con dientes de sierra y la banda con púas cada hora. No es el dibujo:
es el cálculo. `GET /sitios/{id}/historico` (Etapa 4) promedia **todas las lecturas** que caen en cada tramo de tiempo. Medido el 13/11/2026 en la
pila de desarrollo (sitio `uct`, temperatura, tramos de 15 minutos):

| Tramo | Dispositivos que aportan | Lecturas | Promedio de lecturas (lo que se dibuja) | Promedio de dispositivos | Mínimo–máximo |
|---|---|---|---|---|---|
| 1 | 3 | 6 | 12,92 | 14,03 | 11,8–17,6 |
| 2 | 1 | 5 | 11,65 | 11,65 | 11,6–11,7 |
| 3 | 1 | 5 | 11,52 | 11,52 | 11,5–11,6 |
| 4 | 1 | 5 | 11,42 | 11,42 | 11,4–11,5 |
| 5 | 3 | 4 | 13,49 | 14,20 | 11,4–19,0 |

Son dos defectos: **el conjunto cambia de tramo en tramo** (quien reporta cada hora entra en uno de cada cuatro; en los otros tres «el
sitio» es un solo equipo, y el rótulo dice «promedio de 9 dispositivos») y **pesa más quien más reporta** (en el tramo 5, 13,49 frente a
14,20; con un equipo cada 5 s junto a uno por hora, el promedio «del sitio» sería el del primero).
1. **Definición.** En cada tramo, cada dispositivo que mide la magnitud aporta **un** valor: el promedio de sus lecturas del tramo o, si
   no reportó en él, **su última lectura mientras siga vigente**: la misma regla de «Ahora» (L3; `consulta/tablero.ts`), dos intervalos
   esperados del dispositivo, evaluada al empezar el tramo. El punto del sitio es el promedio de esos aportes —cada dispositivo pesa lo
   mismo, reporte cada 5 s o cada hora—; la banda, el mínimo y el máximo entre dispositivos (de sus lecturas del tramo, o su lectura
   vigente); `n`, cuántos aportan; `muestras`, las lecturas reales del tramo (las vigentes no cuentan). Un tramo sin ningún aporte no
   tiene punto. Para los primeros tramos se busca la última lectura de cada canal anterior a la ventana, hasta dos intervalos
   esperados atrás. La historia de un dispositivo dado de baja sigue contando en los tramos en que reportaba, como hoy. *Decidido al
   implementar (14/11/2026):* «dos intervalos atrás» se cuenta desde el inicio del primer tramo, que es donde se evalúa la vigencia (el
   primer tramo empieza antes de `desde` cuando la ventana no está alineada); y la regla se escribe una sola vez, `sqlLecturaVigente` de
   `consulta/tablero.ts`, que «Ahora» evalúa con el reloj de la base y el histórico al empezar cada tramo.
2. **Por qué así y no con tramos más largos.** Alargar el tramo hasta el intervalo esperado más lento también iguala el conjunto, pero
   con un equipo que reporta cada hora la gráfica de «24 horas» bajaría a 24 puntos y la de «última hora» a uno. Tomar de cada serie
   su última muestra vigente es lo que hace un sistema de monitoreo al agregar series que no coinciden en el tiempo: Prometheus toma
   «the newest sample that is less than the lookback period ago» (documentación de consultas, sección *Staleness*, consultada el
   13/11/2026); allá la vigencia es una ventana fija y aquí, dos intervalos esperados de cada dispositivo. No se inventa un dato: se
   sigue mostrando el último que el dispositivo dio, y solo mientras el sistema aún lo considera reportando.
3. **Lo que se ve.** El rótulo de cada gráfica dice lo que es: «Promedio de los dispositivos que reportan, cada 15 minutos (hasta 9)»,
   donde el número es el de los que aportan en algún tramo de la ventana. La etiqueta flotante suma una fila con cuántos aportan en ese
   punto («aportan: 3 dispositivos») y «Ver los datos», una columna con lo mismo: cuando un equipo calla, el número baja y se ve.
   *Decidido al implementar:* el número del rótulo es `dispositivos` de la respuesta (los que aportan en algún tramo, también con solo la
   lectura anterior a la ventana), no el conteo de canales del resumen; la fila «aportan» va sin muestra de color (no es una serie); la
   ficha y la comparación, que usan el mismo gráfico, no la tienen.
4. **Sin jerga en pantalla.** «Cubo» es palabra del diseño y del código, no de la persona: los rótulos visibles dicen «cada 15 minutos»
   («Tramas cada 15 minutos»; en P3b, «Historia: promedios por intervalo de tiempo»). *Decidido al implementar:* con un intervalo de uno,
   sin el número («cada hora», «cada minuto», «cada día»); y la ayuda de «Mostrar mín–máx» de la ficha, que decía «de cada cubo», dice
   «de cada intervalo».
5. **Contrato.** `GET /sitios/{id}/historico` (Etapa 4) conserva su forma (`tiempos, valores, minimos, maximos, muestras, n` y `dispositivos`) y sus
   topes; cambia lo que significan `valores` (promedio de dispositivos), `minimos` y `maximos` (entre dispositivos) y `n` (los que
   aportan, con lectura propia o vigente). La consulta lleva un tiempo máximo: si lo excede, la ruta responde 503 con el consejo («prueba con un rango más corto o más tarde»)
   y el panel muestra ese consejo con «Reintentar» (precisado tras la revisión del 14/11/2026: el panel decía «el servicio está saturado»
   ante todo 503; ahora, si la respuesta trae su motivo, muestra el motivo). Como mucho dos de estas consultas corren a la vez en el proceso
   —el grupo tiene cinco conexiones y las comparte con la recepción, y la pestaña pide hasta seis magnitudes juntas—: las demás esperan su
   turno en fila y, con doce en espera, la ruta responde 503 (agregado tras la misma revisión). Las demás rutas no cambian (el histórico de un canal y el de un dispositivo siguen igual).
   *Decidido al implementar:* 5 s (unas cuatro veces y media lo más lento medido en M6, 1,09 s), en una conexión propia con
   `SET statement_timeout` y `RESET` al soltarla, como la tendencia de «Ahora»; si ni el `RESET` se puede (la conexión se cortó), la
   conexión se suelta con el error y el grupo la destruye en vez de reusarla con el tope puesto. La tendencia de «Ahora» pasó a usar el
   mismo mecanismo: antes la devolvía al grupo aunque el `RESET` hubiera fallado.
6. **Costo, con umbral.** El trabajo crece con canales × tramos. Se mide antes y después en el mismo banco, con 120 y con 2 000
   dispositivos y los cuatro rangos: la consulta nueva se acepta si no tarda más de **1,5 veces** lo que tarda hoy la misma petición
   (hoy, 30 días de 120 canales cada 300 s ≈ 1,1 s, `docs/16 §61`); si la versión en SQL no cumple, se mide la que arrastra la lectura
   vigente en el backend con la misma definición, y aquí se anota cuál quedó y por qué. **Medido el 14/11/2026 (`docs/16 §68`); quedó
   la versión en SQL.** Mismo banco y mismos datos, la imagen anterior y la nueva sobre la misma base, 30 días sembrados: con 120
   dispositivos cada 300 s, 1 hora 6,1 → 12,2 ms (2,0 veces), 24 horas 30,5 → 34,1 ms (1,1), 7 días 181 → 143 ms (0,8) y 30 días 817 →
   553 ms (0,7); con 2 000 cada 3 600 s, 14,4 → 65,2 ms (4,5), 52,5 → 162,5 ms (3,1), 313 → 521 ms (1,7) y 1 251 → 1 088 ms (0,9). **El
   umbral de 1,5 veces se cumple en 4 de las 8 mediciones:** no en la última hora (las dos flotas) ni en 24 horas y 7 días con 2 000
   equipos que reportan cada hora. No es la forma de escribirla sino la definición: la consulta anterior trabaja por lectura y la nueva
   por dispositivo y tramo, y cuando los equipos reportan una vez por tramo o menos, hay tantos aportes como lecturas o más (2 000 cada
   hora en tramos de un minuto: 2 000 lecturas en la hora, 120 000 aportes). La variante que arrastra en el proceso, con la misma
   definición (la base devuelve lo propio por tramo y los tramos de arrastre, y el proceso los expande), se midió en la base, sin contar
   el viaje ni el trabajo del proceso: 27–36 ms en 1 hora, 157–159 ms en 24 horas, 523–531 ms en 7 días y 1,07–1,08 s en 30 días, frente a
   45–49, 168–169, 492–497 ms y 1,08 s de la de SQL en las mismas condiciones (dos corridas de cada una; la de SQL antes de un último
   ajuste que no cambia sus respuestas, `docs/16 §68`). Ahorra la expansión del arrastre
   en las ventanas cortas, pero tampoco cumple el umbral: lo caro es agregar cada dispositivo por tramo, que las dos hacen en la base.
   Quedó la de SQL: una consulta, la regla con una sola casa y ningún segundo cálculo en el proceso. Todas las cifras siguen bajo los 3 s
   de RNF-04. **Decidido el 14/11/2026: se acepta ese costo y se corrige el criterio.** El umbral relativo estaba mal planteado: sobre tiempos de 6 a 50 ms, «1,5 veces» mide diferencias que nadie percibe (12 ms frente a 6) y no dice si la pantalla responde. El criterio que queda es absoluto y sale del uso: (a) ninguna petición pasa de los 3 s que RNF-04 fija para el historial de 30 días de un dispositivo, tomados aquí como tope (la más lenta medida, 1 088 ms); (b) en los rangos vivos, el refresco completo de la pestaña —seis magnitudes— no ocupa más de la décima parte de su período, para que diez personas mirando el mismo sitio a la vez no pasen del período entero: con 2 000 dispositivos, 6 × 65,2 ms = 0,39 s de los 10 s de «última hora» (3,9 %) y 6 × 162,5 ms = 0,98 s de los 60 s de «24 horas» (1,6 %). El agregado por hora en la base queda como salida si un sitio real supera esas cifras, la misma salida que quedó anotada para la tendencia de «Ahora» (`docs/16 §66`); no se construye ahora.
7. **Pruebas.** Con datos sembrados a propósito —un dispositivo cada 3 minutos y dos cada hora, como en la tabla—: en los cinco tramos
   aportan tres y el promedio no salta; un dispositivo que deja de reportar aporta hasta dos intervalos esperados y después `n` baja;
   uno que reporta cada 5 s no arrastra el promedio; el primer tramo usa la lectura anterior a la ventana; un tramo sin aportes no tiene
   punto. Cada prueba, con su falla plantada. En navegador real: la gráfica de temperatura del sitio de la semilla, antes y después.
   ✅ 14/11/2026: los cinco casos, contra la base y el backend del banco (`banco.sh historico`, 7 comprobaciones; con la imagen anterior,
   6 en rojo); sin base, la regla, el tiempo máximo y su 503 (`historico-sitio.spec.ts`); en el panel, el rótulo, la fila «aportan» y la
   columna de «Ver los datos». Las fallas plantadas y las capturas, en `docs/16 §68`.

**N. P7 v2: la vista previa del alta masiva (cambia F2, la fila de `POST /dispositivos/lote` del contrato, `docs/10 §8.4` punto 65 iv, la fila del alta masiva de `docs/11 §4` y la matriz de `docs/20 §6`; diseñado el 15/11/2026, antes del código, y revisado el mismo día: 16 objeciones, todas atendidas en este texto).**
✅ backend, 15/11/2026 (la primera parte del punto 12: contrato, plan por fila, `n`, huella, plantilla, magnitudes, topes, todo o nada y
reintento, con sus pruebas; `alta/lote.ts`, `alta/alta.controller.ts` y `alta/magnitudes.controller.ts`; `docs/10 §8.4` punto 67; probado y
medido en `docs/16 §71`). El panel de hoy quedó adaptado al contrato sin rediseñarse (`n` contando las filas vacías, columnas y límites
leídos de la plantilla, una sola petición con la huella y la llave, los 409 por su `codigo`); la pantalla de tres pasos (7), los lectores
(6), las descargas (9) y el XLSX quedan para el bloque siguiente. ✅ panel, 16/11/2026: los lectores (6, sin el XLSX), la pantalla de tres pasos
(7) y las descargas (9); `docs/16 §76`. ✅ panel, 19/11/2026: el lector de XLSX (6); `docs/16 §91`.
El alta masiva de F2 (11/11/2026) valida bien y explica poco. Lo que se observa en el código y en la pantalla de hoy:

| Hoy | Por qué no alcanza |
|---|---|
| El informe trae por fila una palabra (`valida`, `rechazada`, `existe`) y **un** motivo en una sola cadena | No dice qué se va a crear: en qué sitio cayó la zona, qué formato heredó de la pasarela, qué quedó por omisión (`via` = `mqtt`, `formato` = `senml`) |
| 500 filas son 1 validación y 10 tandas de 50: 11 peticiones con un tope de 10 por minuto | La última tanda recibe 429 (F2 lo declara). La razón de las tandas era el resumen `scrypt` (≈ 70 s por 500); desde el 13/11/2026 las 500 se crean en 0,10 s por HTTP y 0,40 s por MQTT (`docs/16 §65`, medido en el equipo de desarrollo y sin proxy) |
| El archivo se lee y se escribe con coma | Una planilla configurada en español lo abre en una sola columna; lo que se descarga para corregir no se puede corregir ahí |
| El tope de filas, las columnas y la tanda están escritos en el backend (`alta/lote.ts`) y otra vez en el panel (`lib/lote.ts`) | Ya se contradicen: el panel exige cuatro columnas y el servidor cinco (`intervalo_esperado_s`), así que un archivo sin esa columna pasa la lectura y se rechaza fila por fila |
| El número de fila lo pone el servidor contando lo que recibe, y el panel quita antes las filas vacías | Con una fila vacía en medio, cada número posterior apunta a otra fila de la planilla |
| Solo CSV por archivo | Quien tiene la lista en una planilla debe exportarla antes; no se puede pegar |

1. **Una sola función decide, y decide dos veces.** `validarLote` ya llama a la validación del alta de a uno (`validarAlta`): eso se
   conserva. La vista previa y la creación usan esa misma función, y la creación **vuelve a calcular** con lo que hay en la base en ese
   momento: la vista previa queda vieja en cuanto se muestra.
2. **El plan por fila (contrato).** ✅ backend, 15/11/2026 (la huella, SHA-256 de `[n, interpretada]` de las filas que entran, en JSON con
   las claves ordenadas: así la creación, que recibe solo esas filas, da la misma; decidido al implementar). `POST /dispositivos/lote?modo=validar|crear` responde `{leidas, validas, existentes, rechazadas,
   con_aviso, huella, filas}` y cada fila trae: `n`, `id_fisico`, `resultado` (`valida`, `creada`, `existe`, `rechazada`; no cambian),
   `interpretada` (lo que se creará, o `null` si no entra: identificador ya normalizado, nombre, sitio y zona por su nombre, vía, formato
   resuelto, intervalo, canales con nombre y unidad canónica, pasarela, receta de decodificación y el tópico en que publicará),
   `por_defecto` (los campos que la persona dejó vacíos y el servidor completó), `avisos` y `motivos` (listas de `{campo, texto}`), `id`
   (el creado en `crear`, y el del dispositivo que ya existe en las filas `existe`, también en `validar`), y `credencial` y `topico` solo
   en `crear`. Los campos nuevos **se suman**: `motivo` se conserva como la unión de `motivos`
   (`docs/10 §8.4` punto 65 i: ninguna respuesta cambia de forma). **`n` lo manda el cliente** en cada fila (la fila del origen: en un
   CSV o un pegado, la línea contando las vacías, con la cabecera en la 1; en JSON, la posición más 1); el servidor exige que sea un
   entero, único y creciente, y lo devuelve tal cual. `huella` es un resumen de las `interpretada` de las filas que entran, con su `n`, en
   orden: identifica el plan que la persona vio. Solo columnas de la plantilla: una que no lo es responde 400 con la fila (revisión del
   15/11/2026; antes era un motivo de la fila). Invariante con prueba: `validas + existentes + rechazadas = leidas`; `con_aviso` es transversal.
3. **Avisos: lo que entra, pero la persona debe ver.** ✅ backend, 15/11/2026 (los cinco; la línea sobre la tabla es del panel). No bloquean. El identificador venía con mayúsculas y se guardará en minúsculas;
   la unidad se omitió y se asume la canónica; la zona se resolvió por nombre (se dice en qué sitio); el formato declarado en un nodo
   LoRaWAN coincide con el de su pasarela y se ignora; el nombre se repite en otra fila del archivo. El aviso se marca en la fila y
   cuenta en la tarjeta «Con aviso»; no fuerza la fila en otros filtros. Si hay válidas con aviso, una línea sobre la tabla lo dice
   («N filas que se crean traen avisos: ver») y lleva a ese filtro. ✅ panel, 16/11/2026 (la línea, con el botón «Ver las filas con aviso»).
   Cambia con S3 (19/11/2026): la zona resuelta por su nombre deja de ser aviso (se dice una vez sobre la lista) y solo las filas que entran
   traen avisos, así que la línea y la tarjeta cuentan lo mismo.
4. **Los límites y la plantilla tienen una sola casa.** ✅ backend, 15/11/2026 (las dos rutas; el panel de hoy ya lee la plantilla). `GET /dispositivos/lote/plantilla` publica las
   columnas (nombre, si es obligatoria, tope de caracteres, ayuda y ejemplo), `max_filas`, `max_bytes` y los separadores admitidos; la
   lee quien puede usar la ruta del lote (la acción «escribir» de `docs/20 §6`: operador técnico y administradores). El panel no guarda
   copia: de ahí salen el texto «máximo…», la comprobación antes de enviar, la plantilla que se descarga y la lista
   de columnas obligatorias. `GET /magnitudes` publica el catálogo (código, nombre y unidad canónica) a cualquier sesión: no
   es de ningún sitio; lo usan la ayuda de `canales`, la vista previa y el selector del asistente (F1). La plantilla y `COLUMNAS_LOTE`
   suman la columna opcional `decodificador`, que `validarAlta` ya admite y el lote hoy rechaza como columna no admitida.
5. **Topes por columna, y el del cuerpo calculado desde ellos.** ✅ backend y proxy, 15/11/2026. Cada columna tiene su tope, el de
   `validarAlta` donde existe (identificador 63, nombre 80, magnitud 40, hasta 20 canales) y 80 donde no; dentro de `canales`, la unidad
   tiene 16 caracteres, así que la celda `canales` mide 1 197 (20 × «magnitud:unidad» y « | » entre ellos). Una celda que pasa su tope,
   que no es texto ni número, que trae un carácter de control o un sustituto UTF-16 suelto, o que en una columna de códigos (todas salvo
   `nombre` y `zona`) trae algo que no es ASCII imprimible, `"` o `\`, responde 400 con la fila (revisión del 15/11/2026: con solo el NUL
   prohibido, el «peor caso» se podía superar). `max_bytes` es el peor caso de lo que se **acepta** con `max_filas` filas y todas las
   columnas en su tope, en el JSON tal como lo escribe `JSON.stringify` (el del panel; un cuerpo con sangría, números con relleno o escapes innecesarios pesa más y recibe 413), medido en bytes UTF-8 por una prueba, no estimado, que además intenta superarlo con cada carácter admisible:
   1 147 087 bytes; el tope, 1 147 904 (`MAX_BYTES_LOTE`, 1 121 KiB), el mismo en el lector de JSON, la plantilla y el `location` del lote
   en el proxy (`docs/11 §4`). Los 512 KiB de antes no alcanzaban para 500 filas llenas.
6. **Entradas, y un solo camino desde ahí.** Archivo CSV (separador `;`, `,` o tabulador, detectado en la cabecera fuera de comillas;
   con o sin BOM), **pegado desde la planilla** (el portapapeles llega separado por tabuladores: mismo lector) y JSON (una lista de
   objetos con las mismas columnas). Las tres terminan en la misma lista `filas`. Si el origen trae una sola columna, la pantalla avisa
   del separador **antes** de enviar; una fila con más o con menos celdas que la cabecera no se envía: «la fila N trae X celdas y la
   cabecera Y» (hoy las que sobran se pierden en silencio). Cambia con S1 (19/11/2026): esa fila no se envía y queda «No entra» con su
   motivo, pero ya no rechaza el archivo entero. Dentro de `canales` el separador documentado pasa a ser `|`
   (`temperatura:Cel | humedad:%RH`), porque `;` es ahora el de columnas; el servidor admite `|` y `;` siempre, y el ejemplo que se
   descarga deja de traer `;` sin comillas. ✅ la parte del servidor, 15/11/2026 (`canales` con `|` y `;`; la columna `decodificador`).
   ✅ panel, 16/11/2026, sin el XLSX (`lib/lote.ts`: `leerCsv` para el archivo y lo pegado, `leerJson`, `leerOrigen` como entrada única de la pantalla).
   Decidido al implementar (16/11/2026): el separador es el que más veces aparece en la cabecera, fuera de comillas, entre los de
   `separadores.columnas` de la plantilla, así que «una sola columna» solo se avisa cuando la cabecera no trae ninguno (por ejemplo, separada con
   `|`); un JSON que no es una lista de objetos o trae una celda que no es texto ni número usa el caso `celda_invalida` (con su propio texto), y
   una lista vacía, `archivo_vacio`; `fila` y `motivo` se ignoran en la cabecera.
   **XLSX (decidido el 15/11/2026: lector propio, sin dependencia nueva; cambia el control de `docs/11 §4`, que pedía una biblioteca
   auditada, y allí se anota el porqué).** Se descarga solo al elegir un `.xlsx` y lee textos y números de la primera hoja. Como abre
   un archivo que puede venir de un tercero, sus límites van escritos: solo se leen `xl/workbook.xml`, sus relaciones,
   `xl/sharedStrings.xml` y la hoja que de ahí resulte; un tope de bytes **descomprimidos**, contado mientras se descomprime (no el
   que declara la cabecera del zip), por entrada y en total; un máximo de entradas y de cadenas compartidas; un XML con `<!DOCTYPE`
   se rechaza; la lectura se detiene en `max_filas + 1`. La columna sale del atributo `r` de la celda (las vacías no aparecen) y la
   fila, del de la fila. Un identificador que llega como número se rechaza («escríbelo como texto»: la planilla ya pudo redondearlo)
   y una celda con formato de fecha, también. Antes de construirlo se comprueba en una fuente primaria en qué navegadores existe
   `DecompressionStream('deflate-raw')`; donde no exista, la pantalla ofrece pegar.
   ✅ panel, 19/11/2026 (`lib/xlsx-lector.ts`, que no importa nada y se carga con `import()` desde `leerArchivoLote` de `lib/lote.ts`, el
   único punto de entrada de un archivo elegido; `docs/16 §91`). La fuente primaria (browser-compat-data de MDN, la entrada
   `DecompressionStream.deflate-raw`): Chrome 103, Edge 103 (espejo de Chrome), Firefox 113 y Safari 16.4; el objetivo de compilación del
   panel (el de Vite 8.3.6: `chrome111`, `edge111`, `firefox114`, `safari16.4`) ya los incluye, así que pegar queda para un navegador más
   viejo y para cuando el lector no se pudo descargar. Decidido al construir (19/11/2026): (1) además de lo nombrado se lee la tabla de
   estilos, solo sus `numFmts` y `cellXfs`: sin ella no se sabe qué celda tiene formato de fecha (ECMA-376 Parte 1, §18.8.30 y §18.8.10; los
   formatos implícitos de fecha y hora salen de sus cuatro tablas, la de todos los idiomas, «zh-tw and zh-cn», «ja-jp and ko-kr» y «th-th», y
   un id que no está en ellas no se toma por fecha); el
   libro tiene que estar en `xl/workbook.xml` con su tipo de contenido de libro, y las cadenas, los estilos y la hoja se ubican por las
   relaciones del libro sin salir de `xl/` (una ruta con `..`, hacia otra parte del paquete o externa lo hace ilegible); un `.ods` y un `.xlsb`
   se nombran. (2) «La primera hoja» es la primera **visible** en el orden de `<sheets>`: una oculta delante se salta y, si es un gráfico, se
   dice. (3) Los topes: 8 MiB descomprimidos por parte y 16 MiB en total (500 filas con cada celda en su tope y cada carácter escrito
   `&amp;` ocupan menos de 5 MB, lo mide una prueba), 1 000 partes en el zip y 50 000 cadenas compartidas. La hoja se lee mientras se
   descomprime y se corta al juntar la cabecera y `max_filas` + 1 filas con datos: el aviso dice «trae más de 500 filas», porque no se sabe
   cuántas son. La pantalla dice los topes en su unidad (10^6 bytes, como el tope del archivo): 8,4 MB y 16,8 MB. Al terminar una parte, su
   tamaño y su CRC-32 deben ser los del directorio del zip; una parte cifrada, con otra compresión que
   deflate o repetida con el mismo nombre lo hace ilegible; ZIP64 se lee. (4) Se rechaza toda declaración `<!…`, no solo `<!DOCTYPE`, y toda
   entidad que no es una de las cinco de XML ni una referencia numérica a un carácter que XML admite. Una etiqueta de más de 16 KiB lo hace
   ilegible y los atributos se leen en una sola pasada, con su forma `nombre="valor"` (lo que no la tiene, mal formado); el texto se entrega
   a medida que llega y una marca sin cerrar recuerda hasta dónde se buscó su cierre; la forma de un número y la de un formato de fecha se
   miran sin retroceso (corrección del mismo día, tras una revisión independiente: una etiqueta de 300 000 caracteres, en un libro de menos
   de 5 kB, tardaba 70 s en leerse). (5) La regla de cada celda: el número
   en un identificador se rechaza en `id_fisico` y en `pasarela`, las dos columnas que identifican algo; la fecha, en toda columna (por su
   estilo o por el tipo `d`); un valor lógico es «no es texto ni número», como en el JSON; un error de la planilla («#DIV/0!») y una fórmula
   sin resultado guardado se dicen con su remedio. Cada uno deja fuera solo su fila (S1). Un número que desborda («1e400») hace ilegible el
   libro. Un número va como lo muestra una planilla en
   español: coma decimal, sin separador de miles y con 15 cifras significativas como mucho, la precisión de Excel, así la suma que la
   planilla guardó como `0.30000000000000004` se lee «0,3» y no se inventan decimales. Un dato en una columna sin cabecera deja fuera su
   fila con «la fila trae «sobra» en la columna H, que no tiene cabecera»: en un libro no hay separador que culpar. (6) Los casos de N8b: el
   de S9 (`libro_excel`) se reemplaza por `libro_ilegible` y `libro_grande` («Elegir otro archivo»), y `libro_sin_lector` («Pegar las
   celdas», que lleva al campo de pegar, con un `Boton` nuevo en `ACCIONES_LOTE`); un archivo con la firma del contenedor del Office antiguo
   (un `.xls`, o un `.xlsx` protegido con contraseña, que Excel guarda dentro de él) es `libro_ilegible` con esa razón. Lo que no empieza con
   la firma de un zip se lee como hasta ahora, como texto UTF-8. (7) Peso medido: 11 423 bytes y 5 014 con gzip; no se pide en la primera
   carga ni al abrir el alta masiva, sí al elegir un libro (el e2e lo comprueba en cada navegador y ancho).
7. **La pantalla (`#/alta?modo=lote`), en tres pasos.** (i) *Origen:* elegir archivo o pegar, con la plantilla para descargar y los
   límites leídos de la API. (ii) *Revisión:* cinco tarjetas que son botones de filtro (`aria-pressed`) —«Leídas», «Se crean», «Ya
   existen», «No entran», «Con aviso»— y una tabla con «Fila», «Identificador», «Qué pasa» y «Detalle»; «Qué pasa» es una frase («Se
   crea en Zona norte (sitio uct)», «Ya existe: no se toca», «Ya existe, dado de baja: se reactiva desde su ficha», «No entra: zona
   vacía») con icono y texto, nunca solo color. Al abrir una
   fila se ve lo interpretado campo por campo, con la marca «por omisión» donde corresponde, los avisos y los motivos junto al campo
   que los causa. Si hay filas que no entran, la revisión abre con ese filtro. Abajo: «Volver» (conserva el origen; desactivado, con su motivo, mientras se crea), «Descargar las que
   no entran (CSV)» y «Crear N dispositivos», que se desactiva mientras su petición está en vuelo. La tabla dibuja de a 100 filas
   («Mostrar 100 más»); en teléfono cada fila es una tarjeta.
   (iii) *Resultado:* cuántos se crearon y las credenciales, que se descargan una sola vez como hoy.
   ✅ panel, 16/11/2026 (`AltaLote.svelte`, con `lib/revision.ts`; el asistente y los detectados siguen en `Alta.svelte`; las cinco tarjetas son el botón común con su cifra, `Boton` y su propiedad `cifra`, no un botón aparte). Decidido al implementar
   (16/11/2026): el botón del primer paso se llama «Revisar las filas»; «Ya existe» dice, si la fila está en otro estado, «Ya existe, dado de baja»
   o «Ya existe, en <estado>: se reactiva desde su ficha»; la fila con avisos suma a «Qué pasa» una marca «Con N aviso(s)»; el icono de cada frase es
   propio (se sumaron `existe` y `aviso` a `Icono.svelte`); la columna «Detalle» lleva el resumen de lo que se crea y el botón que abre el detalle;
   en el paso 3, «Dar de alta otro lote» y «Ir al inventario» esperan a que se descarguen las credenciales (con su motivo escrito al lado), una línea
   dice que el archivo de credenciales es para cargarlo en los equipos o abrirlo con un editor de texto, porque una planilla puede alterar las que
   empiezan con «-», y un enlace del panel (el menú) pide confirmar mientras haya credenciales sin descargar; cerrar o recargar la pestaña
   pide confirmar también mientras la creación está en vuelo. El botón «atrás» y la barra de direcciones cambian el fragmento sin pasar por un
   clic y no se pueden detener desde la pantalla: ahí solo vale el aviso. Cambiar de origen cancela la revisión en vuelo y descarta su respuesta;
   elegir de nuevo el mismo archivo, ya corregido, lo lee otra vez.
8. **Confirmar es una petición, todo o nada (decidido el 15/11/2026).** ✅ backend, 15/11/2026 (la llave viaja en la cabecera
   `Idempotency-Key`, de 16 a 128 caracteres; la misma llave con otro cuerpo responde 422 `llave_reutilizada`; decidido al implementar).
   `modo=crear` recibe las filas que la persona confirmó, la
   `huella` del plan que vio y una llave de reintento, y las crea en una transacción. Vuelve a calcular, y si el plan ya no es el
   mismo —una fila dejó de ser válida, **o sigue siendo válida pero crearía otra cosa** (cambió el formato de su pasarela, la zona
   resuelve a otro sitio)— responde 409 con `codigo: plan_cambio` y el plan nuevo, y **no crea ninguna**: la pantalla vuelve a la
   revisión con el aviso «cambió desde que lo revisaste». El 409 de «otra creación en curso» lleva `codigo: lote_en_curso`; el
   choque de identificador que solo ve la base (otra petición lo creó entre la validación y la inserción), una pasarela que dejó de
   estar activa (se bloquean en modo compartido dentro de la transacción) o un formato de pasarela que cambió deshacen todo, recalculan
   y responden también `plan_cambio` con su plan. **Todo o nada al pie de la letra** (revisión del 15/11/2026): en `crear`, una fila
   que no entra o que ya existe también es `plan_cambio`, aunque la huella coincida; el panel solo manda las válidas. Si el COMMIT
   responde con error, se mira si los dispositivos quedaron: si quedaron, el lote está creado; si no, se deshace en el broker; si no se
   puede saber, 503 `codigo: lote_incierto` con el remedio (revisar el inventario y rotar la credencial de los que aparezcan), sin tocar el
   broker: si el lote no quedó, sus usuarios del broker quedan sin dispositivo y el registro del backend los lista para que el
   administrador los borre (repetir la creación no los limpia). Antes de preguntar, la conexión del COMMIT se destruye y se espera a que
   termine su proceso en la base; se buscan los `id` del INSERT de este lote, y deben estar todos. **Si la respuesta se pierde** (las credenciales viajan una sola vez), el panel repite la
   petición con la misma llave y el servidor devuelve la misma respuesta: la guarda dos minutos en la memoria del proceso y después la
   borra (vale con una instancia, como «una creación a la vez»: `docs/11 §4`). Solo se guarda lo que creó algo, con topes de 200
   entradas, 3 por persona y 16 MiB; el reintento tiene su propio cupo de 10 por minuto y exige que la persona conserve «escribir» en los
   sitios de lo creado (revisión del 15/11/2026). Se repite solo cuando no se sabe qué pasó: sin respuesta o un 5xx sin `codigo` (un 500 del servidor también: pudo crear y fallar después; ofrecer una creación
   nueva con otra llave devolvería las filas como «ya existe» y las credenciales no se recuperan). Si tras tres intentos no hay respuesta, la pantalla lo dice con el remedio. Desaparecen las tandas, «creadas N de M», «Reintentar
   las restantes» y la constante `TANDA_CLIENTE_LOTE`; un alta de 500 son dos peticiones, y cada «Volver» y nueva revisión cuenta en
   el tope de 10 por minuto.
**8b. Qué puede fallar en el alta masiva, por qué, qué ve la persona y qué puede hacer (diseñado y hecho el 15/11/2026, en la
revisión del bloque).** ✅ panel y backend, 15/11/2026 (la traducción única es `explicarError` y la lectura `leerOrigen` (sobre `leerCsv` y `leerJson`), de
`panel/src/lib/lote.ts`; los mensajes y las acciones, en `TEXTO_DE` y `ACCION_DE`, y una prueba falla si un caso se queda sin ellos;
`docs/16 §71`). Todo error se muestra en un aviso con `role="alert"` que recibe el foco (también los de lectura del origen), con el botón del remedio; el archivo leído
**se conserva** en todos los casos (también si la sesión vence: queda en la memoria de la pestaña y se retoma al volver de «Entrar»).
Lo que se puede ver al leer el archivo se ve antes de enviar, con la fila y la columna, usando la plantilla del servidor (tope y
`texto_libre` de cada columna); el servidor sigue siendo la guarda real. Los botones: «Elegir otro archivo» (lleva al campo del
archivo), «Descargar la plantilla», «Volver a revisar» (lleva a la tabla de la revisión), «Reintentar» (vuelve a validar o a crear),
«Ir al inventario» e «Iniciar sesión».

| Qué pasó | Por qué | Qué ve en pantalla | Qué puede hacer |
|---|---|---|---|
| El archivo está vacío | No trae ni la cabecera | «El archivo está vacío.» | Elegir otro archivo |
| Trae solo la cabecera | No hay filas de datos | «El archivo trae la cabecera pero ninguna fila de datos.» | Elegir otro archivo |
| La cabecera tiene una sola columna | Entre las columnas no hay ninguno de los separadores que se leen: `;`, `,` o tabulador (texto ajustado el 16/11/2026: desde que el separador se detecta, un archivo con `;` ya no cae aquí) | «La cabecera tiene una sola columna («…»): no hay «;», «,» ni tabulador entre las columnas. Descarga la plantilla y copia tus datos en ella.» | Descargar la plantilla |
| Una columna no es de la plantilla | La cabecera trae un nombre que el sistema no conoce | «La columna «color» no es de la plantilla. Las columnas son: id_fisico, nombre, zona, via, formato, intervalo_esperado_s, canales, pasarela, decodificador.» | Descargar la plantilla |
| Falta una columna obligatoria | La cabecera no la trae | «Falta la columna obligatoria «zona».» | Descargar la plantilla |
| Una columna está repetida | La cabecera la trae dos veces (en un JSON, dos claves que solo difieren en mayúsculas) | «La columna «nombre» está repetida en la cabecera.» | Descargar la plantilla |
| Una fila trae más o menos celdas que la cabecera | Una coma de más o de menos en esa fila | «La fila 7 trae 9 celdas y la cabecera 8.» (cambia con S1, 19/11/2026: ya no es un error del archivo; esa fila «No entra» con «la fila trae 1 celda más que la cabecera («sobra»): ¿un separador de más dentro de una celda?» y las demás se revisan) | Elegir otro archivo (desde S1: «Descargar las que no entran», corregirla y volver a subirla) |
| Demasiadas filas | Pasa el máximo de la plantilla (500) | «El archivo trae 501 filas y el máximo es 500: divídelo en partes de 500 o menos.» (si lo dice el servidor: «el lote trae 501 filas y el máximo es 500: divídelo.») | Elegir otro archivo |
| El archivo pesa demasiado | Pasa `max_bytes` de la plantilla | «El archivo pesa 1,6 MB y el máximo es 1,1 MB: divídelo en partes más chicas.» (si lo dice el servidor: «cuerpo de más de 1147904 bytes.») | Elegir otro archivo |
| Una celda pasa su tope, trae un carácter que no se admite o no es texto (cambia con S1, 19/11/2026: solo la comilla sin cerrar, el texto pegado a una comilla de cierre y el JSON que no es una lista de objetos siguen rechazando el archivo; lo demás deja fuera su fila, «No entra», con «Identificador: trae «ó», que no se admite: …», «Nombre: tiene 81 caracteres y el máximo es 80» o «Nombre: no es texto ni número», las mismas palabras que usa el servidor) | El tope de la columna, un salto de línea o tabulador dentro de la celda, o un carácter que no es ASCII en una columna de códigos | «Fila 2, columna «nombre»: tiene 81 caracteres y el máximo es 80.» · «Fila 2, columna «id_fisico»: solo admite letras sin acento, dígitos y signos ASCII, sin comillas dobles ni barra invertida («…»).» · «Fila 2, columna «nombre»: trae un carácter que no se admite (un salto de línea, un tabulador u otro carácter de control).» · «Fila 2: comilla sin cerrar.» · «Fila 2: hay texto pegado a una comilla de cierre; separa las celdas con «;».» · del JSON: «El JSON no se puede leer: debe ser una lista de objetos con las columnas de la plantilla.» · «El JSON debe ser una lista de objetos con las columnas de la plantilla.» · «Fila 1, columna «nombre»: no es texto ni número.» · «Fila 1, columna «id_fisico»: el número no se puede leer tal como está escrito; escríbelo entre comillas.» | Elegir otro archivo |
| El servidor rechazó el archivo (lo que la pantalla no alcanzó a ver) | Una regla del servidor (`codigo: cuerpo_invalido`) | «El servidor rechazó el archivo. Corrígelo y vuelve a elegirlo.» y la lista de sus motivos, con la fila (cambia con S1 y S4, 19/11/2026: «fila 8, Nombre: trae un salto de línea, un tabulador u otro carácter de control, que no se admite», las palabras del panel) | Elegir otro archivo |
| El libro no se puede leer (reemplaza el aviso de S9, «Es un libro de Excel. Guárdalo como CSV…», desde que el lector existe: 19/11/2026) | Está dañado, no es un `.xlsx` (un `.ods`, un `.xlsb`, un `.xls` antiguo), está protegido con contraseña, trae un `<!DOCTYPE>`, una etiqueta de más de 16 KiB, una relación que sale del libro o le falta su primera hoja (`libro_ilegible`) | «El libro no se puede leer: está incompleto o dañado. Guárdalo de nuevo desde tu planilla (como .xlsx o como CSV) o copia las celdas y pégalas aquí.» (la razón cambia según el caso) | Elegir otro archivo |
| El libro es demasiado grande para leerlo (19/11/2026) | Una parte pasa los 8 MiB al abrirla (8,4 MB), todas juntas los 16 MiB (16,8 MB), trae más de 1 000 partes o más de 50 000 textos distintos (`libro_grande`) | «El libro es demasiado grande para leerlo: una de sus partes ocupa más de 8,4 MB al abrirla. Guárdalo de nuevo solo con la hoja de los dispositivos, o copia las celdas y pégalas aquí.» | Elegir otro archivo |
| El navegador no puede abrir el libro (19/11/2026) | No trae `DecompressionStream('deflate-raw')`, o el lector no se pudo descargar (`libro_sin_lector`) | «Este navegador no puede abrir libros de Excel: copia las celdas en tu planilla y pégalas aquí, o guarda el libro como CSV.» | Pegar las celdas (lleva al campo de pegar) |
| Filas que no entran en la revisión | La validación de cada fila | La fila «Rechazada» con su motivo por campo (como hoy; desde S1, 19/11/2026, también las mal formadas, que no se envían) | Descargar rechazadas |
| La sesión venció | Pasó el tiempo de inactividad o de vida de la sesión | «Tu sesión venció. Entra de nuevo: el archivo leído se conserva en esta pestaña y lo vuelves a validar antes de crear.» Al volver de «Entrar»: «Tu sesión había vencido. El archivo leído se conservó: valídalo de nuevo antes de crear.» | Iniciar sesión; al volver, Reintentar |
| No tiene permiso | Su perfil no da de alta | «Tu perfil no permite dar de alta dispositivos (lo hacen el operador técnico y los administradores). No se creó ninguno.» | Ir al inventario |
| Hay otra creación en curso | El servidor crea un lote a la vez | «Hay otra alta por lote en curso en el servidor. Espera a que termine y reintenta; no se creó ninguno.» | Reintentar |
| El plan cambió desde la revisión | Algo cambió en la base entre validar y crear | «Cambió algo desde que lo revisaste y no se creó ninguno. La revisión ya muestra lo de ahora; míralo y vuelve a crear.» y la lista de lo que cambió: «Fila 12 (nodo-12): se crea → ya existe: ya está dado de alta», «Fila 30 (nodo-30): se crea → no entra: la pasarela ug65 está dada de baja», «Fila 31 (nodo-31): sigue entrando, pero cambió formato milesight → chirpstack» | Volver a revisar (con el plan nuevo ya cargado) |
| Demasiadas peticiones en un minuto | 10 validaciones o creaciones por minuto por persona | «Hiciste demasiadas validaciones o creaciones en un minuto. Espera 37 s y reintenta.» (los segundos los da el servidor) | Reintentar |
| No llegó la respuesta y no se sabe si se creó | La conexión se cortó o el servidor respondió un 5xx sin `codigo` tras tres intentos con la misma llave, o un 409 llegó en un reintento (la primera petición pudo crear y perder su respuesta) | «No llegó la respuesta de la creación y no se sabe si se crearon. Revisa el inventario: las filas que al validar de nuevo salgan «ya existe» se crearon, y sus credenciales no se pueden recuperar: rota la credencial de cada una desde su ficha.» | Ir al inventario |
| Sin respuesta al validar | La conexión se cortó; validar no crea nada | «No hubo respuesta del servidor. Validar no crea nada: reintenta cuando vuelva la conexión.» | Reintentar |
| No se creó nada porque el broker o la base no respondieron | Falló antes de abrir la transacción o se deshizo (`codigo: nada_creado`) | «No se creó ninguno: el servidor no logró hablar con el broker o con la base de datos. Reintenta en un momento.» | Reintentar |
| El servidor no pudo confirmar | El COMMIT respondió con error y no se pudo saber si se aplicó (`codigo: lote_incierto`) | «El servidor no pudo confirmar si se crearon. Revisa el inventario: los que aparezcan quedaron creados y necesitan rotar su credencial desde su ficha; si no aparecen, avisa al administrador del servidor.» | Ir al inventario |
| La llave ya se usó con otro contenido | El reintento llevaba una llave de otra creación (`codigo: llave_reutilizada`) | «Esta creación se cruzó con una anterior de otro contenido y no se creó nada con ella. Vuelve a revisar y crea de nuevo.» | Volver a revisar |
| Otro error | Lo que no calza en los anteriores | «No se pudo completar. Reintenta en un momento.» y los motivos del servidor, si los hay | Reintentar |

9. **Lo que se descarga.** Plantilla y «las que no entran» van con `;`, BOM y CRLF, con las columnas de la plantilla en su orden más
   `fila` y `motivo`, que el lector ignora al volver a subir. Contra la inyección de fórmulas (OWASP, «CSV Injection») se antepone un
   apóstrofo a toda celda que empiece con `=`, `+`, `-`, `@`, tabulador, retorno o salto de línea, o con sus variantes de ancho
   completo (`＝`, `＋`, `－`, `＠`); la única excepción es una celda que **entera** sea un número (`-5`, `+3,2`). El lector quita ese
   apóstrofo inicial cuando lo sigue uno de esos caracteres, para que lo descargado y vuelto a subir sin tocar dé el mismo plan. El
   apóstrofo es solo para deshacer lo que la descarga agregó: un valor escrito a mano que empieza con `=` se guarda tal cual, y toda descarga lo
   neutraliza al salir (y uno que ya traiga el apóstrofo se lee sin él, igual que el de la descarga). Una comilla sin cerrar o texto pegado a una
   comilla de cierre se dicen con su fila. El nombre de «las que no entran» sale del del origen, solo con letras, dígitos, espacio, `_`, `.` y `-`.
   El archivo de credenciales no cambia: es para máquinas (el identificador también va tal cual). Cambia con S (19/11/2026): su cuarta
   columna es `destino`, a dónde envía cada equipo según su vía (el bloque S, «Decidido al implementar», 12). ✅ panel, 16/11/2026 (`celda`, `csvPlantilla`, `csvRechazadas`; la plantilla no lleva `fila`
   ni `motivo`, que son solo de «las que no entran»).
10. **Lo que no cambia, y lo que cambia en otros documentos.** ✅ 15/11/2026, salvo lo del XLSX en `docs/11 §4`, que va con el lector (✅ 19/11/2026). No cambia lo que no se revela de otros sitios (RF-41: un
    identificador ajeno sigue siendo «no disponible», sin `interpretada`; desde S5, 19/11/2026, «ese identificador ya está en uso en la plataforma: elige otro»), los 10 lotes por minuto por persona, una creación a la vez
    y las credenciales una sola vez. Cambian junto con el código de este bloque, porque describen lo que rige: `docs/10 §8.4` punto 65 iv y la fila del alta masiva
    de `docs/11 §4` («las rechazadas no bloquean a las válidas» pasa a «las que no entran no se envían; si al confirmar el plan
    cambió, 409 y nada»; el tope del cuerpo; el XLSX), y `docs/20 §6` suma las dos rutas nuevas.
11. **Pruebas y medición (antes de dar por hecho).** ✅ lo del servidor, 15/11/2026 (`docs/16 §71`); lo del panel por el DOM, 16/11/2026 (lectores,
    descargas y pantalla, cada prueba con su defecto plantado: `docs/16 §76`); lo del navegador, escrito (`e2e/lote.mjs`, que lanza
    `banco.sh lote-navegador`, a 1 280 y 390 px) corrido el 16/11/2026: 24 de 24 comprobaciones en Firefox y en Chromium (`docs/16 §76`); faltan los umbrales de tiempo. «Vista previa = creación»: crear y comparar el informe con lo anunciado, fila por
    fila. El 409 de `plan_cambio` se prueba con un cambio que la base **no** impide (desactivar la pasarela o cambiarle el formato
    entre validar y crear): un identificador duplicado lo frenaría la restricción única aunque faltara la segunda validación, y la
    prueba pasaría con el defecto puesto. El límite, **en el límite**: 500 filas con cada columna en su tope caben en el cuerpo, y 501
    es 413. Un CSV con una fila vacía en medio: cada `n` es el de la planilla. La vista previa de 500 filas cuenta sus consultas
    (catálogos una vez; ninguna por fila). Reintento con la misma llave: misma respuesta, ningún dispositivo de más. Fórmulas:
    `-1+cmd|…` y `＝1+2` salen neutralizadas, `-5` intacto, y el archivo descargado, vuelto a subir sin tocar, da el mismo plan. Un
    pegado desde una planilla, un CSV con `;` y otro con `,`, y una fila con una celda de más. XLSX: uno real con una celda
    numérica, y tres hostiles (relación de compresión enorme, una hoja de un millón de filas, un XML con `<!DOCTYPE`) (✅ 19/11/2026, con
    libros de LibreOffice y de la exportación por sitio, y el umbral de peso medido: `docs/16 §91`). En navegador
    real: las tres pantallas a 1 280 y 390 px y el foco al cambiar de paso. Umbrales: el primer dibujo de la revisión de 500 filas y
    cada «Mostrar 100 más», bajo 1 s a 390 px; el lector de XLSX no suma más de 10 kB comprimidos y no entra en la primera carga.
    Medidas en `docs/16`: validar y crear 500 por cada vía, con el proxy delante.
12. **Orden.** Contrato y backend (plan por fila, `n`, huella, plantilla, magnitudes, topes, todo o nada y reintento) con sus pruebas;
    después el panel (lector, revisión, descargas); al final el lector de XLSX, que no bloquea lo anterior, y la revisión por capturas.

**O. P9 Vista pública por enlace: lo que ve quien visita sin cuenta (cambia `docs/20 §7`, la fila P9 de §3 y de §7, y `docs/10 §8.4` punto 6; diseñado el 16/11/2026, antes del código, y revisado el mismo día: 15 objeciones, todas atendidas en este texto).**
✅ base, backend y proxy, 17/11/2026 (migración 25, `backend/src/publico/`, la zona `publico` de `proxy/nginx.conf`; probado en `docs/16 §79`); ✅ las dos
pantallas, el mismo día (`panel/src/Publico.svelte` y `Publicar.svelte`, con su recorrido en navegador real; `docs/16 §80`); la medición del
punto 13 (120 y 2 000 equipos, el peso de la pantalla), pendiente. Lo decidido al implementar va al final del bloque, después del punto 14.
Quien pidió esta vista (entrevista del 05/10) quiere una vista de lectura para estudiantes, **sin datos crudos**. La regla que ordena
todo el bloque: **el visitante ve solo promedios de lo que un administrador decidió publicar, la regla que protege a cada equipo se
aplica cada vez que se sirve y no solo al publicar, y nada más responde a ese enlace.**

1. **Qué se publica.** Un administrador de sitio publica una **vista**: un sitio, una lista de magnitudes del catálogo, una ventana
   máxima (24 horas, 7 días o 30 días) y, si lo elige, el **desglose por zona** con la lista de zonas **fijada al publicar**. La vista
   muestra, por magnitud, el **promedio** de ahora y su tendencia: el promedio del sitio, que es el de sus dispositivos (bloque M), y con
   el desglose lo mismo por cada zona publicada, con el nombre que la zona tenía al publicar. **No se publican el mínimo ni el máximo**:
   en el histórico del sitio son la lectura real de un equipo (`consulta/tablero.ts`, `min(x.valor)` y `max(x.valor)`), y eso es un dato
   crudo. **Nunca** viajan: tramas, lecturas sueltas, extremos, identificadores físicos, nombres de dispositivos o de pasarelas,
   coordenadas, condiciones, eventos, personas, ni exportación.
2. **Un valor se publica solo si lo aportan al menos k dispositivos, y eso se comprueba al servir.** **k es del sitio, no del enlace**
   (decidido el 17/11/2026, tras la tercera revisión): todos los enlaces de un sitio ocultan lo mismo. Si cada enlace tuviera su k,
   combinar enlaces con k, magnitudes o ventanas distintas despejaría promedios de menos de k (una zona oculta en uno y publicada en otro,
   restada de un total). k lo fija el administrador del sitio (`GET`/`PUT /sitios/{id}/enlaces/minimo`, con su evento en la actividad), de 1
   a 20; mientras no lo fije rige `PUBLICO_MINIMO_DISPOSITIVOS` (3), y al servir nunca baja del piso del despliegue
   (`PUBLICO_MINIMO_DISPOSITIVOS_PISO`, 1: una instancia puede prohibir publicar equipos solos). **Bajar el valor por omisión es
   responsabilidad del operador** (revisión final del 17/11/2026): rige en todo sitio que no fijó el suyo, y ese cambio no deja evento en
   su actividad; por eso, si es menor que 3, el backend lo dice en el registro cada vez que arranca. Al bajarlo, la respuesta avisa que «afecta a
   todos los enlaces públicos de este sitio» y lo que un visitante podría deducir; con 1, el promedio es la lectura de ese equipo. Cada tramo
   de cada serie (del sitio y de cada zona) y cada valor de «ahora» sale **sin valor** cuando lo aportan menos de k dispositivos: un equipo
   que se da de baja o calla después de publicar no deja al descubierto a los que quedan. **Lo oculto y lo que no tiene datos se ven
   igual**, tramo a tramo (un hueco): si se distinguieran, cada hueco «oculto» diría cuándo reportó un equipo solo. La vista lleva el aviso
   «algunos tramos se ocultan para proteger a equipos individuales» siempre que k sea mayor que 1, haya o no algo oculto ahora: depende
   solo de la configuración (segunda revisión del 17/11/2026; si dependiera de lo oculto en la ventana, su cambio delataría cuándo reporta
   un grupo chico). **Que lo oculto no se despeje por resta:** con el k del sitio, una zona con entre 1 y k−1 equipos se oculta en todo
   enlace, y el total del sitio de un tramo (y el de «ahora») se publica solo si los equipos de esas zonas —todas las del sitio, publicadas
   o no— suman 0 o al menos k. Así cualquier combinación de lo publicado, en uno o en varios enlaces, son grupos de k o más equipos: zonas
   grandes enteras o la unión de las chicas. (Lo que se probó antes y no alcanzaba, en `docs/16 §79`: «exactamente una zona publicada
   oculta», que dejaba despejar una zona no publicada o dos ocultas; y el menor k de los enlaces del sitio, que no cubría enlaces con
   magnitudes o ventanas distintas.) El conteo de cada zona se calcula en la consulta y nunca viaja: la vista dice «promedio de k o más
   dispositivos». La respuesta guardada lleva el k del sitio en su clave: cambiarlo rige en la petición siguiente, en todas las instancias.
   **Cada lectura cuenta en la zona donde estaba el equipo cuando se tomó** (decidido el 17/11/2026, tras la tercera revisión): una tabla
   `dispositivo_zona` guarda en qué zona estuvo cada dispositivo y desde cuándo, la llena un disparador al crearlo y al cambiarle la zona
   (o el sitio, que va con la zona) a la hora del reloj, y la aplicación no la escribe; las estadías de un equipo no se solapan, y la
   historia no se borra en cascada con el dispositivo o la zona. Mover un equipo no cambia el pasado de ninguna zona ni del total: si
   las lecturas siguieran a la zona actual, comparar la serie de antes y la de después despejaría al equipo movido (en su zona de origen,
   en la de destino o en el total: 10·T_antes − 9·T_después = D). En el tramo del cambio el equipo aporta una sola vez, en la zona
   de **origen** (revisión final del 17/11/2026; sus lecturas de ese tramo posteriores al cambio no cuentan, y entra a la de destino desde
   el tramo siguiente): contarlo en las dos inflaría el conteo, y dos equipos pasarían por tres frente a k = 3; y si contara en la de
   destino, el tramo en curso de la zona de origen, ya servido, cambiaría y comparar su valor de antes y el de después despejaría al
   equipo (4·Z₁ − 3·Z₂). Cada equipo aporta a lo más una vez por tramo, y el total es la unión de las zonas, que es lo que la regla de la
   resta necesita. **La misma población en la serie y en
   «ahora»**: las dos promedian los dispositivos con lectura vigente (la regla del bloque M) en la zona donde se tomó, sin mirar su estado
   visual; si «ahora» dejara fuera a un equipo en mantenimiento y la serie no, la diferencia entre las dos despejaría su lectura.
   **Riesgo aceptado y dicho: la diferenciación en el tiempo y entre ventanas.** Si de un tramo al siguiente, de «ahora» al último tramo
   o de una ventana a otra el conjunto que aporta pasa de k+1 a k equipos, comparar los dos promedios publicados acota la lectura del que
   salió o entró. No se mitiga redondeando (la vista dejaría de coincidir con el histórico del sitio, que es su definición): lo acotan k y
   que la vista solo publica promedios. Una zona creada después de publicar no aparece, y una renombrada conserva el nombre publicado,
   hasta que el administrador publique de nuevo.
3. **El administrador ve antes exactamente lo que verá el visitante.** La pantalla «Publicar una vista» (en la configuración del sitio)
   dibuja la vista con los datos reales mientras se eligen las magnitudes y el desglose. Usa la ruta de vista previa
   (`POST /sitios/{id}/enlaces/vista-previa`, con la acción `enlaces`), que arma la respuesta con **la misma función** que
   `GET /publico`, incluida la regla de k del sitio: lo que hoy saldría oculto se ve como lo verá el visitante, un hueco con el aviso de
   la magnitud. Muestra el nombre del sitio y los de zona tal como saldrán, y los avisos de lo que un visitante podría deducir. Al crear, el enlace se muestra **una sola vez**, con «Copiar».
4. **El enlace, su vencimiento y su renovación.** Un token aleatorio de 32 bytes (como el de la sesión, `docs/20 §3`); la base guarda
   su resumen SHA-256, nunca el token, con índice único. Tablas (`docs/20 §2`): `enlace_publico` —sitio, magnitudes, ventana máxima,
   zonas publicadas (identificador y nombre publicado), título (hasta 80 caracteres) y descripción (hasta 300) públicos (k es del sitio,
   punto 2), quién lo
   creó y cuándo, **cuándo vence** (obligatorio), cuándo se revocó y por quién— y `enlace_publico_acceso` (enlace, día, cuenta). **Todo
   enlace vence:** al crearlo se elige 7, 30, 90 o 180 días (una actividad, un mes, un trimestre, un semestre; 30 por omisión); el
   máximo es un parámetro del despliegue (`PUBLICO_VENCIMIENTO_MAX_DIAS`, 180 por omisión; cuando exista la pantalla de límites del
   administrador del sistema, P12, hoy solo diseñada, pasará a ella). **Renovar** fija el vencimiento en hoy más el plazo elegido, **sin
   cambiar el token** (el enlace ya compartido sigue sirviendo), y avisa si con eso lo acorta. Se renueva un enlace vigente o uno vencido
   hace **30 días o menos**; pasado ese plazo, o un año desde su creación, se crea otro. **Riesgo aceptado y dicho:** renovar un vencido
   vuelve a servir una dirección que ya circuló; por eso tiene plazo, y por eso existe revocar, que no se deshace. Un sitio admite hasta
   un tope de enlaces (`PUBLICO_MAX_ENLACES_POR_SITIO`; es un tope de administración, no de seguridad: una lista que una persona puede
   revisar; **decidido el 17/11/2026:** lo fija el administrador del sitio y cuentan solo los enlaces vivos, al final del bloque). Crear, renovar y revocar generan los eventos `enlace_creado`, `enlace_renovado` y `enlace_revocado`, con el sitio en
   su detalle, y la actividad del sitio (P14) los muestra con quién y cuándo.
5. **El token no queda en ningún registro, tampoco en los del propio panel.** La dirección que se comparte lleva el token en el
   fragmento (`…/panel/#/v/<token>`): el navegador no envía el fragmento al servidor ni lo pone en la cabecera de procedencia. El panel
   pide los datos a `GET /publico` con el token en la cabecera `X-Enlace-Publico`, no en la ruta ni en la consulta: el proxy y
   el backend no registran cabeceras. En el panel, la ruta `#/v/` se resuelve **antes de montar la aplicación**: no pide la sesión ni la
   salud, no lee preferencias y no pasa por la pantalla «Entrar»; nunca cuenta como «última vista» ni se puede guardar como vista, y el
   informe de errores del panel la escribe como `#/v/…`. **Límite declarado:** la dirección completa queda donde quede cualquier
   dirección compartida: el historial y la sincronización del navegador de quien visita, la mensajería donde se pegó, el portapapeles.
   Por eso todo enlace vence y se puede revocar.
6. **Lo que responde y lo que no.** `GET /publico` recibe el token y una ventana **de la lista cerrada** (24 h, 7 d o 30 d,
   hasta la máxima del enlace; nunca fechas libres) y devuelve título, descripción, el nombre del sitio (el campo `sitio`), las
   magnitudes con su nombre y unidad, k, las series de promedios —del sitio y de cada zona publicada— y la hora del último dato. El
   intervalo de cada ventana lo deriva el servidor con la misma función del tablero (`intervaloParaRango`), así que ninguna ventana
   pasa el tope de tramos. Un token inexistente, vencido, revocado o con forma inválida recibe **la misma respuesta 404**. **La vigencia
   se comprueba en cada petición** contra la fila (una lectura por índice): revocar corta de inmediato en todas las instancias. Con ese
   token **ninguna otra ruta** cambia: la guardia central no lee esa cabecera; solo la lee el controlador de `GET /publico`, que está
   fuera de la matriz de `docs/20 §6`. Crear, listar, renovar, revocar y la vista previa exigen sesión y la acción `enlaces`.
7. **Que mil visitantes no sean mil consultas, ni le quiten el tablero a quien tiene sesión.** El backend guarda **solo los datos**,
   por enlace y ventana, 60 segundos en la memoria del proceso, acotada en cantidad y en bytes (60 segundos es el período más corto con
   que reporta un equipo del campus: más fresco no dice nada nuevo). Mientras una respuesta se rehace, las demás peticiones del mismo
   enlace y ventana **esperan ese resultado** en vez de consultar. El desglose se calcula en una consulta agrupada por zona, no en una
   por zona. Lo público tiene **su propio cupo** de consultas, separado del de las tendencias del tablero, con el mismo tiempo máximo (y la
   vista previa del administrador, otro, decidido el 17/11/2026: la visita no la deja sin respuesta). El
   proxy limita por dirección las peticiones a `/publico` en una zona propia (`publico`: 5 por segundo con ráfaga de 60, para que un
   curso de 50 personas detrás de una misma dirección cargue la página a la vez y después refresque una vez por minuto; `docs/11 §4`),
   y responde su 429 en JSON. No hay límite por enlace: cualquiera que lo tenga podría agotarlo y dejar sin vista a los demás, y la
   respuesta guardada ya protege la base. La vista se refresca sola cada 60 segundos; no abre el canal en vivo.
8. **Los accesos se cuentan sin escribir en cada visita y sin direcciones.** Un acceso es **una carga de la pantalla**, no cada
   refresco. Se cuentan en memoria y se vuelcan una vez por minuto a `enlace_publico_acceso`, por día en la zona horaria del sitio; las
   filas de más de 90 días se borran. `GET /publico` no entra en la auditoría de operaciones (`docs/10 §8.4` punto 43): no hay persona
   a quien atribuirla y una pantalla de sala serían 1 440 filas al día. El registro del proxy guarda la dirección de quien visita, como
   la de cualquier petición (`docs/21`). **Límite declarado:** cualquiera con el enlace puede inflar el contador pidiendo como si cargara
   la pantalla; es un indicador de uso para quien administra, no una cifra de seguridad, y el límite de tasa del proxy lo acota.
9. **La pantalla del visitante.** Sin el armazón del panel: título, sitio, «actualizado hace…», una tarjeta por magnitud con el
   promedio de ahora, su unidad y «promedio de k o más dispositivos»; debajo, las gráficas de tendencia con el selector de ventana y, si
   hay desglose, una fila por zona con su valor; lo oculto se ve como un hueco, igual que un tramo sin datos, y la tarjeta de una
   magnitud lleva el aviso «algunos tramos se ocultan para proteger a equipos individuales» siempre que k > 1 (`protegido`, punto 2: no depende de
   los datos, para no delatar cuándo reporta un grupo chico). Tema claro y oscuro; se lee completa a
   390 px sin desplazamiento lateral; cada gráfica tiene su tabla de datos alternativa. Botón **«Pausar actualización»** (WCAG 2.2.2); al
   refrescar solo se anuncia el cambio de hora, sin mover el foco. Al pie, una línea fija: «Vista pública de solo lectura · promedios
   del sitio». Si el enlace no vale: «Este enlace ya no está disponible. Pídele uno nuevo a quien te lo compartió.» La respuesta va sin
   caché compartida y sin cookies; todo `/panel/` lleva `X-Robots-Tag: noindex`; la pantalla no carga nada de terceros (`docs/21`).
10. **Administrar los enlaces.** En la configuración del sitio, una lista (por omisión, solo los enlaces vivos; los muertos, con «ver
    todos»: decidido el 17/11/2026): título, qué publica (magnitudes, ventana, zonas), creado
    por, vence el…, accesos de los últimos 7 días y estado (vigente, vence pronto, vencido, revocado), con «Renovar» y «Revocar», cada
    uno con su confirmación. El formulario avisa junto al título y la descripción: «Este texto lo verá cualquiera con el enlace: sin
    nombres de personas ni datos personales»; y junto a la elección de zonas, que el nombre del sitio y el de cada zona publicada también
    los verá cualquiera con el enlace (revisión del 17/11/2026: son texto libre y pueden traer el nombre de una persona). El token no se
    puede volver a ver: si se perdió, se crea otro enlace.
11. **Qué puede fallar y qué ve cada persona** (la regla del bloque N: qué pasó, por qué, qué texto se ve y qué se puede hacer).

    | Qué pasó | Quién lo ve | Texto | Qué puede hacer |
    |---|---|---|---|
    | El enlace no existe, venció, se revocó o está mal copiado | Visitante | «Este enlace ya no está disponible. Pídele uno nuevo a quien te lo compartió.» | Nada más: un solo mensaje, a propósito |
    | Demasiadas visitas desde la misma dirección (429) | Visitante | «Hay muchas visitas en este momento. La página se actualizará sola en un minuto.» | Esperar; se reintenta sola |
    | El servicio está ocupado o la consulta pasó el tiempo máximo (503) | Visitante | «Los datos están tardando. La página volverá a intentarlo en un minuto.» | Esperar; se conserva lo último mostrado |
    | Un valor lo aportan menos de k dispositivos | Visitante y administrador | Un hueco, como un tramo sin datos, y una vez por magnitud: «Algunos tramos se ocultan para proteger a equipos individuales.» | Administrador: quitar esa magnitud o zona, o bajar el k del sitio a sabiendas (afecta a todos sus enlaces; hasta el mínimo de la instancia) |
    | No se eligió ninguna magnitud | Administrador | «Elige al menos una magnitud para publicar.» | Elegir |
    | Una magnitud no tiene datos en la ventana | Administrador | «Sin datos de «…» en esta ventana: el visitante verá la tarjeta vacía.» | Publicar igual o quitarla |
    | El sitio llegó a su tope de enlaces vivos | Administrador | «Este sitio ya tiene N enlaces. Revoca uno para crear otro.» (N, el tope del sitio) | Ir a la lista o subir el tope (hasta el techo de la instancia) |
    | Renovar acorta el vencimiento | Administrador | «Vencía el …; con este plazo vencerá antes, el …» | Confirmar o elegir otro plazo |
    | Se intenta renovar un enlace revocado, vencido hace más de 30 días o con más de un año | Administrador | «Este enlace ya no se puede renovar. Crea uno nuevo.» | Crear |
    | La sesión venció o falta el permiso | Administrador | Los mensajes de sesión del panel (P10, punto 4, en esta misma §4; el cliente HTTP, en §6) | Entrar de nuevo |

12. **Frente a los referentes** (fuentes oficiales, leídas el 11/11/2026). Publicar un tablero sin cuenta es común: ThingsBoard CE
    («Make the dashboard public to allow access without authentication.», thingsboard.io/docs/user-guide/dashboards/), Grafana
    («Anyone with the URL can access the dashboard.», grafana.com/docs/grafana/latest/dashboards/share-dashboards-panels/shared-dashboards/),
    Magistrala («Anyone with the link can view the dashboard — no login required.», absmach.eu/docs/magistrala/user-guide/dashboards/dashboards/)
    y Ubidots («a URL to share a dashboard or a widget … without the need to logging in», help.ubidots.com/en/articles/901285).
    OpenRemote lo condiciona a marcar antes los activos y atributos como públicos («this requires assets to be set as 'public' and
    attributes as 'public read'», docs.openremote.io/docs/user-guide/manager-ui/) y Milesight IoT Cloud deja fijar permiso y fecha de
    vencimiento del enlace («Set Permission and Expiry Date of this link.», support.milesight-iot.com/support/solutions/articles/73000514201-how-to-create-diagrams-on-dashboard-of-milesight-iot-cloud). Este
    diseño toma lo segundo y lo tercero —se publica una selección explícita y todo enlace vence—. Dónde viaja el token, si se publican
    solo agregados y con qué mínimo de equipos: **no declarado** en esas páginas (revisadas en las direcciones citadas); aquí se define
    y se prueba.
13. **Pruebas y medición (antes de dar por hecho).** Aislamiento: para cada ruta del OpenAPI, la respuesta con un `X-Enlace-Publico`
    válido es idéntica, en código y cuerpo, a la respuesta sin él (falla plantada: una ruta que lea la cabecera). La respuesta pública
    no contiene ningún identificador físico, nombre de dispositivo, coordenada, mínimo ni máximo de la base de prueba (se busca cada
    uno en el cuerpo). La regla de k: una zona de 3 equipos a la que se le da de baja uno **deja de publicar su valor** sin tocar el
    enlace, y el total del sitio se oculta en ese tramo mientras los equipos ocultos del sitio sumen entre 1 y k−1; ni una zona no
    publicada, ni dos zonas ocultas, ni dos enlaces del mismo sitio dejan despejar lo oculto por resta; una zona creada después no aparece. Vencido, revocado, inexistente y mal formado
    dan respuestas idénticas byte a byte. Renovar: un vencido hace 29 días vuelve a servir con el mismo token; uno de 31 días, uno
    revocado y uno de más de un año se rechazan; el vencimiento nunca pasa el máximo. Revocar corta en la petición siguiente **con la
    respuesta aún guardada** (falla plantada: mirar la respuesta guardada antes de validar). Cien visitas simultáneas con la respuesta
    vencida hacen **una** consulta de datos, y la validación del enlace es una lectura por índice cada una. Con el cupo público lleno,
    la pestaña Tendencias de una persona con sesión sigue respondiendo. El token no aparece en los registros del proxy ni del backend
    tras una visita, ni en `preferencia.vistas`, ni en el informe de errores del panel. La vista previa del administrador y la vista del
    visitante dan los mismos números. En navegador real: la pantalla del visitante y la de publicar, a 1 280 y 390 px, con y sin datos,
    con y sin zonas, con un valor oculto. Cada prueba con su falla plantada. Medidas en `docs/16`: tiempo de la vista con 120 y 2 000
    dispositivos, con 6 magnitudes y 5 zonas, antes de fijar el cupo público; y el peso de la pantalla pública.
14. **Orden.** Migración y backend (crear, listar, renovar, revocar, vista previa, `GET /publico`, la regla de k, respuesta guardada
    con espera compartida, cupo propio, contador, eventos y su rama en la actividad) con sus pruebas; la zona de tasa del proxy;
    después la pantalla del visitante y la de publicar; al final la revisión por capturas.

**Decidido al implementar (17/11/2026), en lo que el bloque no fijaba** (base, backend y proxy; el contrato completo, en el OpenAPI):
- **Rutas.** Listar y crear, `GET`/`POST /sitios/{id}/enlaces`; la vista previa, `POST /sitios/{id}/enlaces/vista-previa`; renovar,
  `POST /sitios/{id}/enlaces/{enlace}/renovar` con `plazo_dias`; revocar, `DELETE /sitios/{id}/enlaces/{enlace}` (la fila queda, revocada).
  Las que escriben, en la zona `administracion` del proxy, como el resto de la administración. El orden de los códigos es el de las demás
  rutas que escriben (`docs/20 §10`): 401, 403 sin la acción en ningún sitio (antes de mirar el cuerpo), 400, y el sitio, 404 o 403.
- **La respuesta de `GET /publico`** (y de la vista previa, la misma): `titulo, descripcion, sitio, zona_horaria, minimo_dispositivos,
  ventana, ventanas, intervalo, desde, hasta, ultimo_dato, tiempos` y, por magnitud, `codigo, nombre, unidad, ahora` (número o null),
  `serie` (un número o null por tramo), `protegido` (true si k > 1: el aviso del punto 2, que depende solo de la configuración) y
  `zonas[{nombre, ahora, serie}]`. Las zonas viajan por su nombre publicado, sin su identificador. `ultimo_dato` es el inicio del tramo de
  la lectura más reciente de los «ahora» del sitio que se publican (segunda revisión del 17/11/2026: la hora exacta diría cuándo reportó
  un equipo); un valor oculto no la delata.
- **Un sitio inactivo** responde la misma 404 que un enlace que no vale; **revocar uno ya revocado**, 409.
- **Un cálculo que pasa el tiempo máximo** también se guarda, como fallo, 60 s por enlace y ventana: mientras tanto esas peticiones reciben
  503 sin consultar (revisión del 17/11/2026: si no, un enlace de una vista pesada pedido cada segundo ocuparía el cupo sin fin).
- **La base protege el registro del enlace** (migración 25, disparador `trg_enlace_publico_tiempos`): una revocación no se deshace, y
  `creado_en`, `renovado_en` y `revocado_en` no pueden quedar en el futuro (comparado con la hora del reloj y unos segundos de margen, no
  con la del inicio de la transacción, para que renovar y revocar a la vez no choquen; tercera revisión del 17/11/2026); al insertar,
  `creado_en` es la hora de la transacción, y una revocación nueva se fecha en el último minuto (segunda revisión). Un enlace revocado o
  anonimizado no cambia su vencimiento ni su renovación, y uno anonimizado no se sirve aunque no haya vencido. La aplicación inserta solo
  en las columnas que escribe.
- **Título y descripción** usan la regla de texto de la recepción (`recepcion/texto.ts`): nada invisible ni de control (`\p{C}`), ningún
  separador salvo el espacio común (`\p{Z}`) y ninguno de los rellenos que se ven en blanco; la descripción admite además el salto de
  línea. El título lleva al menos una letra o un número, y ninguno admite más de tres marcas combinantes seguidas (tercera revisión del
  17/11/2026: harían que lo que se lee no sea lo que está escrito).

**Decidido el 17/11/2026** (por la persona; la regla que ordena estas decisiones: **la protección por omisión es de la plataforma y la
decisión de bajarla es del administrador del sitio**, que la toma sabiendo y deja su rastro en la actividad; lo que el administrador puede
ajustar, lo ajusta él, dentro de los límites de la instancia):
- **El administrador decide y la plataforma avisa.** La vista previa y la respuesta de crear traen `avisos`: lo que un visitante podría
  deducir de lo que se va a publicar, en palabras (el k del sitio bajo el de omisión; «la zona X tiene 1 equipo: con k = 1 su lectura sale
  tal cual»; una zona que hoy saldrá sin valor; el total que saldrá sin valor; «combinando el total del sitio con las zonas publicadas se
  puede deducir el promedio de las no publicadas»). La pantalla los muestra antes de publicar. Se calculan con los equipos de hoy de cada
  zona **por magnitud**, como la regla, los mismos que cuenta la vista (con una lectura vigente de esa magnitud, en la zona donde se tomó;
  revisión final del 17/11/2026: la unión de las magnitudes contaría 3 en una zona con 3 equipos de temperatura y 1 de humedad); con más
  de una magnitud con datos, cada aviso dice de cuál es. Son un aviso, no la regla, que se aplica tramo a tramo. El evento `enlace_creado` registra el k del sitio que rige y cuántos avisos se mostraron.
- **k es del sitio** (tercera revisión; punto 2): lo lee (`GET /sitios/{id}/enlaces/minimo`: el que rige, si está fijado, el de omisión,
  el piso y el máximo) y lo fija su administrador con `PUT /sitios/{id}/enlaces/minimo`, de 1 a 20 (sin bajar del
  piso de la instancia al servir), con el evento `enlace_minimo` en la actividad; la respuesta trae `avisos`: «afecta a todos los enlaces
  públicos de este sitio» y lo que un visitante podría deducir con ese k en todo el sitio. Subirlo nunca expone; bajarlo es decisión del
  administrador, que la toma sabiendo. Los enlaces ya no llevan k. **La migración deja el k de cada sitio sin fijar** (rige el de omisión;
  revisión final del 17/11/2026: copiar el menor de los enlaces existentes podía tomar el de uno vencido o muerto y publicar hacia atrás
  sin rastro; si un sitio necesita uno más bajo, lo baja su administrador y queda su evento). En una base con la versión anterior, que sí
  lo copiaba, un k que nadie fijó y menor que 3 vuelve a sin fijar; uno mayor se conserva, porque oculta más. La columna del enlace queda
  sin uso (no se borra: la migración es aditiva y conserva lo que se eligió antes).
- **La historia de zonas** (`dispositivo_zona`, punto 2) empieza con la migración: cada dispositivo entra con su zona actual desde
  siempre, porque un cambio de zona anterior no quedó guardado; uno que ya tenía marcado su último cambio (la versión anterior de la
  migración) entra desde esa hora, y sus lecturas de antes siguen sin contar en ninguna zona, como hasta entonces.
- **El tope de enlaces por sitio lo fija su administrador** (`GET`/`PUT /sitios/{id}/enlaces/tope`, con un evento `enlace_tope` en la
  actividad), de 1 al techo de la instancia (`PUBLICO_MAX_ENLACES_TECHO`, 200 por omisión); sin fijarlo rige
  `PUBLICO_MAX_ENLACES_POR_SITIO`, 50. **Cuentan solo los enlaces vivos**: no revocados y vigentes o aún renovables; uno revocado o
  vencido hace más de 30 días (o de más de un año) ya no vuelve y no ocupa lugar. El 409 `tope_enlaces` dice el número del sitio. Bajar el
  tope no revoca nada: impide crear otro hasta que haya lugar. Con el techo, la memoria sigue acotada igual: la respuesta guardada tiene
  topes propios (300 entradas y 8 MiB) que no dependen de cuántos enlaces haya; más enlaces solo significan más cálculos, que limita el cupo.
- **La lista muestra por omisión solo los vivos**; `?incluir=todos` suma los muertos. Las filas no se borran: la actividad conserva el rastro.
- **Retención del texto de los enlaces muertos:** pasados `retencion_dias` desde que el enlace dejó de valer (venció o se revocó, lo que
  pasó primero), título, descripción y nombres de zona se anonimizan (`fn_anonimizar_enlaces_publicos`, desde la retención; queda
  `anonimizado_en`); el plazo lo elige el administrador al publicar, 90 días por omisión, de 31 (más que los 30 en que aún se puede renovar)
  a 365. La actividad sigue nombrando el enlace, ya como «Enlace retirado».
- **La vista previa tiene su propio cupo**, separado del de las visitas.
- **La página de privacidad sube a la versión 2**, porque cambian los datos que se guardan (el inventario de `docs/21 §2` suma la vista
  pública). Los términos de uso no cambian de versión: su texto no cambió. **Regla general (decidida el 18/11/2026, `docs/21 §7`):** toda
  actualización del texto de privacidad que viaja a la pantalla, también una corrección de redacción, sube la versión en 1 y pone la fecha del
  cambio; vale igual para los términos. La reescritura para personas del 18/11/2026 es la versión 3 y la del 20/11/2026 (homónimos), la 4. No depende de acordarse: la huella del
  texto debe coincidir con la última fila de un historial en `docs/21 §7`, lo comprueba `legal.spec.ts` y el paso 2w7 del verificador impide
  reescribir filas ya publicadas. El panel muestra «Versión N, del …» con la versión y la fecha que sirve la API (`Legal.svelte`).
- **Una carga de la pantalla** (punto 8) la marca el panel con `?carga=si` en su primera petición; los refrescos no la llevan.
- **k:** es del sitio (punto 2), de 1 a 20. Al servir rige el mayor entre el k del sitio y el piso vigente: si el operador sube el piso,
  todos los sitios lo cumplen. Los parámetros del despliegue se validan al arrancar (un valor inválido lo detiene);
  `PUBLICO_VENCIMIENTO_MAX_DIAS` va de 7 a 180.
- **Renovar:** un plazo que acorta el vencimiento responde 409 `codigo: acorta` con las dos fechas, salvo que venga `acortar: true`: el
  aviso del punto 4 lo confirma el servidor, no solo la pantalla. «Vence pronto», siete días o menos.
- **Topes:** hasta 12 magnitudes y 20 zonas por enlace (los mismos CHECK de la migración 25). El tope de enlaces, con un candado por sitio
  para dos altas simultáneas (lo que cuenta, al final del bloque).
- **Cupo y respuesta guardada** (punto 7, provisorios hasta la medición del punto 13): una consulta pública a la vez y veinte en fila (con
  la fila llena, 503), con el tiempo máximo del histórico del sitio (5 s) **para el cálculo entero**, no por sentencia (segunda revisión del
  17/11/2026: las tres consultas corren en una transacción de solo lectura y cada una recibe lo que queda del plazo), y la espera en la
  fila del cupo también tiene ese tope (si no, 503); el plazo se mide desde antes de pedir el cupo y lo vigila también el proceso, no solo
  la base: una conexión que no responde se suelta con error y destruida, y no deja tomados ni el cupo ni la fila (tercera revisión del
  17/11/2026), y el `ROLLBACK` tras un error también tiene tope; no conseguir conexión por otra causa (la base caída) no es una consulta
  lenta: queda en el registro, no se guarda como fallo y responde como error (revisión final); hasta 300 respuestas y 8 MiB guardadas. La vista previa, una a la vez y cinco en
  fila, en su propio cupo, y no guarda nada.
- **El desglose** se calcula con `SQL_PUBLICO_SERIES` (`consulta/tablero.ts`): la definición del bloque M agrupada por magnitud y zona en
  una sola consulta; la prueba de integración compara su total del sitio con `GET /sitios/{id}/historico` sobre los mismos datos.

**Decidido al implementar las pantallas (17/11/2026)**, en lo que el bloque no fijaba o no se podía hacer tal cual (`docs/16 §80`):
- **Dónde vive «Publicar una vista».** Los puntos 3 y 10 la ponen «en la configuración del sitio», pero el panel no tiene esa pantalla. Vive
  en `#/publicar?sitio=<código>`, con la entrada «Vista pública» en el menú para quien tiene la acción `enlaces` en algún sitio (o es
  administrador del sistema), y un selector de sitio si administra más de uno. Cuando exista una configuración del sitio, la entrada se muda
  allí sin cambiar la pantalla. (18/11/2026: existe P15 «Ajustes del sitio», bloque Q, con el plazo de la primera trama, el k y el
  tope; la entrada «Publicar una vista» no se mudó: sigue en su ruta y en el menú.)
- **La vista previa se pide al cambiar magnitudes, zonas o ventanas**, una sola vez tras una pausa de 400 ms; el título y la descripción se
  dibujan desde el formulario, recortados como los devuelve el servidor. Pedirla en cada tecla gastaría el cupo de la vista previa y la
  zona de administración del proxy (11 de 30 `POST` seguidos pasan; `docs/16 §79`). **«Publicar» espera esa vista previa** (revisión del
  mismo día): se desactiva, con el motivo «Espera la vista previa…» (o «La vista previa no se pudo cargar…»), mientras la pausa corre, la
  vista previa está en vuelo o falló, o fue de otra selección (se guarda la firma de magnitudes, zonas y ventana máxima que la produjo); los
  avisos solo se muestran si son de la selección actual. Sin esto se podía publicar sin haber visto los avisos de lo que se publica (punto
  3). Al cambiar de sitio o al empezar a crear, la vista previa en vuelo y su pausa se cancelan; un enlace creado mientras se cambió de sitio
  no muestra su dirección en la pantalla del otro (queda en la lista del suyo). Sin vista previa no se publica (hasta el 18/11/2026 tampoco
  mientras se guardaba el k del sitio, que entonces se cambiaba en esta pantalla; ver «Dónde se cambian el k y el tope»). Mientras se publica, el selector de sitio se desactiva con su motivo; el menú o «Atrás»
  pueden cambiar de sitio igual, y entonces vale lo anterior. Guardar el k o el tope con la petición en vuelo y cambiar de sitio no escribe
  la respuesta del anterior en el nuevo (hoy en P15, bloque Q); el cambio de sitio olvida además, en «Publicar», los avisos, «Copiada» y la ventana de la vista previa.
- **El catálogo de magnitudes tiene su propio aviso** (corrección del 18/11/2026): si `GET /magnitudes` falla, el aviso va junto a las magnitudes («No se pudo cargar el catálogo de magnitudes. …») con su «Reintentar», que vuelve a pedir el catálogo y no la vista previa; mientras falte, «Publicar» queda desactivado con el motivo «El catálogo de magnitudes no se pudo cargar: reintenta antes de publicar.». El aviso de la vista previa queda solo para la vista previa.
- **Dónde se cambian el k y el tope** (decidido el 18/11/2026; hasta ese día vivían al pie de «Publicar una vista»): en P15 «Ajustes del
  sitio» (bloque Q), sección «Vista pública», con el mismo comportamiento que se describe en este punto y en el siguiente. «Publicar una
  vista» conserva solo una línea de lectura («Mínimo de dispositivos por valor publicado: 3 · Tope de enlaces vivos: 50») y, para quien tiene
  la acción `enlaces`, el enlace «Cambiar en Ajustes del sitio». Ya no hay un `PUT` del k en vuelo dentro de «Publicar»: desaparece la espera
  «Espera a que se guarde el mínimo del sitio…». La vista previa la calcula siempre el servidor con el k de ese momento; la línea de lectura
  muestra el k y el tope de cuando se abrió «Publicar».
- **Bajar el k del sitio se confirma en la pantalla antes del `PUT`** (en P15, desde el 18/11/2026), con «afecta a todos los enlaces públicos de este sitio» y lo que un
  visitante podría deducir con ese k; después se muestran los avisos que trae la respuesta. Subirlo no pide confirmar (nunca expone).
  **Con bloqueo optimista** (revisión del mismo día): el `PUT /sitios/{id}/enlaces/minimo` lleva `anterior`, el k que la pantalla leyó; si
  otra persona lo cambió entretanto, el servidor responde 409 `minimo_cambio` con el que rige y no cambia nada (si no, bajar de 5 a 4
  creyendo que regía 3 no pedía confirmar). La pantalla relee y, si lo pedido baja el k de ahora, pide confirmar otra vez; una
  confirmación abierta se cierra si al releer cambió el k. `anterior` es opcional en el contrato: sin él, el cambio es como antes.
- **La dirección se muestra una sola vez y entera** (con el token en el fragmento), con «Copiar» y «Ya la guardé: ocultar»; el token no se
  muestra aparte: es la parte final de la dirección. Al salir de la pantalla también se olvida, y cuando la página entra a la caché de ida y
  vuelta del navegador (`pagehide` con `persisted`), para que «Atrás» no la devuelva (no en todo `pagehide`: en un teléfono, pasar a otra
  aplicación para pegarla también lo dispara); va con `translate="no"` (un traductor del navegador no la manda a
  otro servicio). La dirección se arma con el nombre con que entró quien publica: si es local (localhost, loopback, una red privada o la de
  direcciones compartidas, una IPv4 mapeada en IPv6, un nombre de una sola etiqueta o uno `.local`, `.lan`, `.internal` o `.home.arpa`),
  se avisa al lado: «Esta dirección usa el nombre con que entraste; para compartirla, entra
  por el nombre público del servidor.»
- **Lo que quien visita lee cuando no hay respuesta:** sin red, «No hay conexión con el servicio. La página volverá a intentarlo en un
  minuto.»; cualquier otro error del servidor, el texto del 503 (se conserva lo último mostrado). Un 429 del proxy o la falta de red no
  llegan al backend: la siguiente petición todavía lleva `carga=si`.
- **La unidad, con su símbolo para personas** (`lib/unidades.ts`: «Cel» → «°C»), sin convertir: quien visita no tiene preferencias. El tema
  es el del sistema operativo y un botón lo cambia solo para esa visita (no se guarda nada en el navegador).
- **La pantalla del visitante es un paquete propio**, cargado a pedido por `main.ts` antes de montar nada: la aplicación con sesión no se
  monta ni pide nada. Su código sigue en el paquete inicial (bloque L, P4) y el visitante lo descarga sin ejecutarlo; el peso real de la
  pantalla pública es parte de la medición del punto 13. Si el fragmento pasa de una a otra (del panel a un `#/v/…` o al revés, o a otro
  token), la página se recarga: ninguna hereda nada de la otra. `main.ts` y el ruteo de la aplicación usan la misma regla (`esRutaPublica`):
  `#/v?x` no es la vista pública en ninguno. La petición a `GET /publico` no sigue redirecciones (`redirect: 'error'`).
- **El informe de errores del panel no existe todavía** (`POST /errores-panel` (ruta prevista); `docs/10 §8.4` punto 60, TT-45): hoy ninguna
  parte del panel escribe la dirección en un registro ni en la consola; `sinToken` (`lib/publico.ts`) deja `#/v/…` y es la que debe usar
  ese informe cuando exista. El recorrido en navegador comprueba que el token no aparece en la consola.
- **La gráfica de cada magnitud lleva el total del sitio y cada zona publicada**, con los colores de la paleta en orden (con más de cinco
  zonas se repiten: el nombre de cada línea está en la leyenda fija y en «Ver los datos»).
- **La lista de enlaces va en tarjetas a todo ancho** (no en tabla): cada una con título, qué publica, quién la creó (nombre y correo, desde el 20/11/2026: para distinguir homónimos), cuándo vence o se
  revocó (y quién la revocó, igual), visitas de los últimos 7 días y estado; renovar abre el plazo (30 días por omisión) y su confirmación junto a la tarjeta. El
  formulario empieza con la ventana máxima de 7 días y el vencimiento de 30.

**P. Esperando primera trama (decidido el 18/11/2026; la regla, en §2).** Lo que cambia, en el orden en que se construye:
1. **Modelo (`docs/08`, migración 26):** `dispositivo.en_servicio_desde` (nace con el alta, también la masiva; vuelve a «ahora» cada vez que
   el equipo pasa de `mantenimiento` a `activo`, en la misma transacción que el cambio de P6; las filas que ya existían, su `creado_en`) y
   `sitio.espera_primera_trama_h` (de 1 a 2 160, 168 por omisión).
2. **API.** Cada fila de `GET /dispositivos` y la ficha `GET /dispositivos/{id}` suman `en_servicio_desde` y `espera_hasta` (nulo si ya envió
   alguna trama); `en_linea` cuenta desde el más reciente entre la última trama y `en_servicio_desde`; `estado` del filtro admite `esperando`;
   el resumen del sitio suma `dispositivos.esperando`. El plazo del sitio se lee con `GET /sitios/{id}/espera-primera-trama` (cualquier
   perfil del sitio: `espera_primera_trama_h`, `por_omision`, `minimo`, `maximo`) y se fija con `PUT` del mismo camino, con el mecanismo del
   k de la vista pública (bloque O): el valor nuevo y, si se manda, `anterior` (el que se leyó); si ya no es el que rige, 409
   `codigo: espera_cambio` con el vigente, sin cambiar nada. Lo fija quien administra el sitio (la acción `ajustes`, `docs/20 §6`) y deja el
   evento `espera_primera_trama` con quién, el valor y el anterior, que la actividad del sitio (P14) muestra en palabras. **Acortarlo puede
   abrir muchas alarmas de golpe** (decidido el 18/11/2026, tras la revisión del bloque): `GET …/espera-primera-trama?propuesto=<h>` (mismos
   permisos y aislamiento que el `GET`; `propuesto` se valida como el `PUT`, entero de 1 a 2 160, y si no, 400) suma `afectados`, cuántos
   equipos **activos** del sitio que nunca enviaron una trama hoy están dentro de su plazo (`en_servicio_desde` + el plazo actual, aún en
   el futuro) y con el propuesto quedarían vencidos (`en_servicio_desde` + el propuesto, ya pasado o ahora); la regla del plazo es la misma
   del estado visual (`SQL_ESPERA_HASTA`), sin duplicarla. Sin `propuesto` la respuesta no cambia. Quien ya venció, ya figura «Sin señal» por una condición de falta
   de comunicación abierta (puede estar dentro del plazo tras alargarlo, hasta el barrido siguiente), está en mantenimiento, dado de baja o es
   de otro sitio no cuenta. Cambiarlo rige en
   el barrido siguiente: alargarlo devuelve a «Esperando» a quien había vencido (el supervisor cierra su condición) y acortarlo la abre.
3. **Panel.** El estado nuevo en las fichas de conteo y el filtro de P2, en la franja de P1 y en P3b, con su palabra, su icono y su tono
   (§2). La ficha (P3) de un equipo que espera dice «Esperando primera trama desde el ‹fecha y hora› (pasa a «Sin señal» el ‹fecha y
   hora›)», en la zona del sitio con el UTC al pasar el cursor, como toda hora (§1); si ya venció sin ninguna trama, «Nunca envió una trama:
   el plazo de su primera trama venció el ‹fecha y hora›». Su entrega es «—».
4. **Dónde se cambia el plazo en el panel: decidido el 18/11/2026, una pantalla propia, P15 «Ajustes del sitio» (bloque Q).** Los tres
   ajustes que rigen a todo un sitio (el plazo de la primera trama, el k y el tope de enlaces de la vista pública) viven juntos allí; el k y
   el tope se mudaron desde «Publicar una vista» (P9). Antes de esa decisión el plazo solo se cambiaba por la API, como se hizo con la
   configuración antes de P6.
5. **Pruebas.** La misma tabla de casos para las tres implementaciones de §2; contra una base real con la migración aplicada
   (`plataforma/pruebas/espera-integracion.sh`): la migración sobre datos y repetida, el `CHECK` del plazo, el supervisor (abre al vencer,
   no antes, no dos veces, no al volver de mantenimiento, cierra con la primera trama y al alargar el plazo), la entrega nula y la API con
   sus permisos.

**Q. P15 Ajustes del sitio (decidido el 18/11/2026, antes del código; RF-62, HU-32 y el estado «Esperando primera trama», §2).** Una
pantalla para lo que rige a todo un sitio y no es de un equipo. Hasta el 18/11/2026 el plazo de la primera trama solo se cambiaba por la
API, y el k y el tope de enlaces vivos vivían al pie de «Publicar una vista» (bloque O, punto «Dónde se cambian el k y el tope»).
1. **Ruta y menú.** `#/sitio/ajustes?sitio=<código>`, con el mismo patrón que `#/publicar?sitio=<código>`: el código del sitio (sin él,
   el primero de los que la persona puede ajustar); un código con forma inválida se ignora. La entrada «Ajustes del sitio» del menú (icono
   propio, dos reglas con su deslizador) aparece a quien tiene la acción `ajustes` o `enlaces` en algún sitio (o es administrador del
   sistema); hoy las dos acciones las tienen los mismos perfiles (administrador del sitio y del sistema, `docs/20 §6`). Quien llega sin
   ninguna ve «Tu rol no cambia ajustes en ningún sitio: los cambia quien administra el tuyo» con el enlace al tablero. La ruta nunca es
   «última vista» (la de P13 se toma solo del tablero, el inventario y la ficha). Con más de un sitio, un selector de sitio como el de
   «Publicar»; con uno, su nombre.
2. **Sección «Primera trama»** (con la acción `ajustes` en ese sitio). Un campo numérico «Horas de espera, de 1 a 2160» y, a su lado, su
   equivalencia en días («168 horas son 7 días»; con horas que no son días justos, un decimal con coma; menos de 24, «menos de un día»). Dos
   textos llanos: **qué pasa al vencer** («Si un equipo no envía ninguna trama en ese plazo, contado desde que entró en servicio, pasa a «Sin señal»
   y se abre la alarma de falta de comunicación») y **por qué existe** («Un alta masiva suele hacerse días antes de instalar los equipos: el
   plazo evita que figuren sin señal mientras tanto»), más que el cambio rige en la revisión siguiente del sistema (alargarlo devuelve a
   «Esperando primera trama» a quien había vencido; acortarlo puede abrir la alarma). **Acortarlo se confirma antes si afecta a alguien:** al
   pulsar «Guardar el plazo» con un plazo menor que el que rige, la pantalla pide `GET …?propuesto=H`; con `afectados` mayor que 0 muestra «Con
   este plazo, N equipos que esperan su primera trama pasarán a «Sin señal» y abrirán su alarma de falta de comunicación en la revisión
   siguiente del sistema. ¿Guardar igual?» con «Guardar igual» y «Cancelar», y no manda el `PUT` hasta que se confirma; con 0, guarda
   directo; lo que se guarda es exactamente el valor que se consultó (el campo se bloquea mientras se consulta, una respuesta que llega con el
   campo ya distinto se descarta, y pulsar «Guardar» de nuevo cierra cualquier confirmación abierta antes de preguntar otra vez); si la consulta falla, se dice y no se guarda (la pregunta no se salta). Alargarlo nunca pregunta. Es un aviso, no una garantía:
   el conteo puede cambiar entre la pregunta y el guardado (llegan tramas, entran equipos); el `PUT` sigue yendo con `anterior`. «Guardar el plazo» manda `PUT` con `anterior`, el que
   la pantalla leyó (bloqueo optimista): si otra persona lo cambió, el 409 `espera_cambio` relee, deja el valor pedido en el campo y dice
   el valor nuevo que puso la otra persona («Alguien cambió el plazo… ahora es de N h»), sin guardar nada; guardar el mismo valor que
   rige no manda ninguna petición (el botón queda desactivado con el motivo «es el que ya rige»). Un valor fuera de rango o no entero
   tampoco se manda: el motivo se escribe junto al botón. Al guardar, el aviso de éxito dice el plazo y sus días.
3. **Sección «Vista pública»** (con la acción `enlaces` en ese sitio): el k y el tope, con **exactamente** el comportamiento del bloque O
   (puntos «Bajar el k…» y «El tope…»), mudado sin cambios: la confirmación al bajar el k con «afecta a todos los enlaces públicos de este
   sitio» y lo deducible; los avisos de la respuesta; el 409 `minimo_cambio` con relectura (y la confirmación otra vez si lo pedido baja
   el k de ahora); la protección de cambiar de sitio mientras hay una petición o una relectura en vuelo (la respuesta del sitio anterior
   no se escribe en el nuevo); el tope con sus errores y el aviso de que bajarlo no revoca nada. Cada ajuste es un componente con su
   propia carga y su propia cancelación (el 17/11/2026 compartir la cancelación hizo que el catálogo cancelara los ajustes).
4. **«Publicar una vista» queda solo con lo suyo.** Donde estaban el k y el tope, una línea de lectura con los valores reales y, para quien
   tiene la acción `enlaces` en el sitio, el enlace «Cambiar en Ajustes del sitio» (lleva a `#/sitio/ajustes?sitio=<código>`). La vista
   previa y sus avisos no cambian. Consecuencia: ya no hay un guardado del k en vuelo dentro de «Publicar», así que desaparece su espera.
5. **Accesibilidad y forma.** Cada campo con su etiqueta; los avisos con el componente `Aviso`; todo botón es `Boton`; sin desplazamiento
   horizontal a 390 y a 1 280 px.
6. **Decidido al diseñar** (el diseño anterior no lo fijaba): (a) la pantalla es P15, el siguiente número libre de §3; (b) cada sección se
   muestra por su acción, no por el perfil: si algún día `ajustes` y `enlaces` se reparten entre perfiles distintos, cada uno ve solo lo suyo;
   (c) los tres ajustes se guardan por separado, cada uno con su botón (cambiar uno no guarda los otros); (d) acortar el plazo pide confirmar solo
   si hay equipos afectados (punto 2); alargarlo, nunca.
7. **Pruebas.** Por el DOM, las del k y el tope se mudaron desde «Publicar» sin perder ninguna (`docs/16 §86`), más las del plazo (guardar,
   rango, 409 con relectura, mismo valor sin petición, sin la acción no se muestra), las del menú (con cualquiera de las dos acciones,
   oculto sin ninguna) y las de «Publicar» (la línea de lectura y el enlace); con navegador real, el paso del k de
   `panel/e2e/publico.mjs` pasa por esta pantalla y una visita comprueba los tres controles a 390 y 1 280 px.

**R. P8 Exportar un sitio (HU-08, RF-34, RF-31, RF-41; diseñado el 19/11/2026, antes del código).** Hoy se exportan las mediciones de un
dispositivo (`GET /dispositivos/{id}/exportar`, 12/10/2026), y eso no cambia salvo la protección contra fórmulas (punto 2). Lo que falta para
cerrar HU-08, en el orden en que se construye:
1. **Qué se exporta.** ✅ backend, 19/11/2026 (`consulta.service.ts`: `medicionesSitio`, `tramasSitio`, `eventosSitio`; revisado cada escritor de
   `evento` con equipo: ningún `detalle` lleva nombre, correo ni id de persona). Los criterios de HU-08 usan «eventos» en dos sentidos y se cubren los dos: las **tramas aceptadas** con el mensaje
   original (RF-31 llama «evento aceptado» al mensaje y «su interpretación» a las mediciones) y los **eventos del ciclo de vida** (alta,
   baja, mantenimiento, condiciones: los de `GET /eventos`, RF-33). Tres conjuntos del rango [desde, hasta), de todos los dispositivos del
   sitio en cualquier estado (un equipo no cambia de sitio, solo de zona dentro del mismo, `configuracion.service.ts`: el sitio actual basta
   para RF-41):
   - **mediciones**: `tiempo_utc, id_fisico, magnitud, valor, unidad, canal_id` (las columnas de la exportación por dispositivo más `id_fisico`);
   - **tramas**: `recibido_en_utc, id_fisico, topico, adaptador, bytes, sha256, payload_base64`: el contenido exacto en base64 y su huella
     SHA-256 calculada en la base, para que cualquiera compruebe que llegó íntegro;
   - **eventos**: `ocurrido_en_utc, id_fisico, tipo, detalle_json`.
   Nada de personas en el archivo (`docs/21`, minimización): quién hizo cada cambio se queda en «Actividad» (P14). Antes de construir se
   revisa que `evento.detalle` no lleve datos de personas en ningún tipo; si alguno los lleva, ese dato se omite. Las tramas se guardan
   `RETENCION_TRAMA_DIAS` (30 por omisión): del rango salen las que existan, y el archivo lo dice. La cuarentena no se exporta (es lo
   rechazado, no un dato aceptado del sitio). Los instantes van como texto exacto de la base (UTC, microsegundos), igual que hoy.
2. **Ruta y formatos.** ✅ backend, 19/11/2026 (`sitios.controller.ts`, `exportar-sitio.ts`; `celdaCsv` reversible en `exportar.ts`, también para la
   exportación por dispositivo). `GET /sitios/{id}/exportar?formato=csv|xlsx|json&desde&hasta` (por omisión `csv` y los últimos 30 días; el mismo
   rango razonable de hoy). Acción `exportar` sobre el sitio: 401 sin sesión, 403 a consulta y operador técnico, 200 a investigador y
   administradores, 404 a otro sitio o a uno inexistente (`docs/20 §6`). Respuesta en flujo con `Content-Disposition: attachment`,
   `Cache-Control: no-store` y nombre `sitio_<código>_<desde>_<hasta>.<extensión>`, saneado como hoy.
   - **csv** → un `.zip` con `mediciones.csv`, `tramas.csv`, `eventos.csv` (el CSV estándar de hoy: coma, punto decimal, UTF-8, CRLF) y
     `LEEME.txt`: sitio, rango, hora de generación, versión del formato (`exportacion-sitio/1`), qué es cada columna, la retención de las
     tramas, la regla del apóstrofo y **cuántas filas trae cada archivo** (se escribe al final: una descarga cortada se nota).
   - **xlsx** → un libro con las hojas «Acerca de» (lo mismo que `LEEME.txt`; primera pestaña, escrita al final), «Mediciones», «Tramas» y
     «Eventos», con la primera fila fija; además del instante exacto como texto, una columna con la fecha nativa de planilla (UTC,
     milisegundos, formato `yyyy-mm-dd hh:mm:ss.000`) para graficar sin convertir.
   - **json** → un objeto `{formato, sitio: {codigo, nombre}, desde, hasta, generado_en, mediciones: […], tramas: […], eventos: […],
     conteos: {…}}`, con `conteos` al final por la misma razón; `detalle` va como objeto, no como texto.
   **Protección contra fórmulas reversible** (CSV; el XLSX escribe texto que la planilla nunca evalúa): se antepone un apóstrofo a todo texto
   que, después de cero o más apóstrofos, empiece con `=`, `+`, `-`, `@`, tabulador, retorno, salto de línea o sus formas de ancho completo
   (el conjunto de `panel/src/lib/lote.ts`); para reimportar, a un texto que empieza con apóstrofos seguidos de uno de esos caracteres se le
   quita uno. Así la protección no pierde nada: hoy `celdaCsv` antepone el apóstrofo y no hay cómo saber si ya estaba (un `payload_base64`
   puede empezar con `+`). La exportación por dispositivo pasa a la misma regla, porque comparte `celdaCsv`.
3. **Escala.** ✅ backend y proxy, 19/11/2026 (`cupo-exportaciones.ts`, `descarga.ts`, la `location` de las dos exportaciones en `proxy/nginx.conf`;
   planes en `docs/16 §89`). Una conexión propia por descarga, 30 s de tope por consulta, contrapresión (`drain`) y corte si el cliente se va, como hoy.
   Las consultas van por canal (mediciones) y por dispositivo (tramas y eventos), con paginación por clave dentro de cada uno, para que
   cada tanda use los índices que ya existen (`medicion (canal_id, tiempo)`, `trama (dispositivo_id, recibido_en)`, `evento (dispositivo_id,
   ocurrido_en, id)`) y el costo crezca con los datos del sitio y no con los de toda la instalación; el plan se mide en el banco antes de
   afirmarlo (`docs/16`). El orden de salida queda por dispositivo, magnitud y tiempo. El cupo de 2 exportaciones simultáneas por proceso
   pasa a ser uno solo para las dos rutas (429 a la tercera). El proxy deja pasar estas descargas sin guardarlas en su disco (`location`
   propia con `proxy_buffering off` y los mismos topes de tasa).
4. **XLSX con código propio, sin dependencia nueva** ✅ backend, 19/11/2026 (`zip.ts`, `xlsx.ts`; las fuentes, comprobadas y guardadas con su huella
   antes del código: `docs/16 §89`) (el mismo criterio que el lector del 15/11/2026, bloque N punto 6; cambia el
   control de `docs/11 §4`). Un zip en flujo sobre `node:zlib` (deflate y `crc32`, presente en Node 22), con descriptor de datos tras cada
   entrada, y las hojas como XML con texto en línea (`inlineStr`, sin tabla de cadenas compartidas: cada fila se escribe y se olvida).
   Límites, de la fuente oficial (Microsoft, «Excel specifications and limits», descargada el 19/11/2026): «1,048,576 rows by 16,384
   columns» por hoja y «32,767 characters» por celda. Por eso: (a) una hoja que llega a 1 048 575 filas de datos sigue en «Mediciones (2)»,
   y así; (b) la carga de una trama (hasta 64 KiB, el tope del broker y del receptor HTTP: 87 384 caracteres en base64) se parte en hasta
   tres columnas `payload_base64`, `payload_base64_2` y `payload_base64_3` de 32 000 caracteres como mucho, que se concatenan para
   reimportar; (c) los caracteres de control que XML no admite se escriben con el escape de la norma (`_xHHHH_`) y un `_xHHHH_` literal se
   protege, sin pérdida. Sin ZIP64: ninguna entrada pasa de 1 GiB sin comprimir (se parte como en (a), también los CSV: `mediciones-2.csv`)
   y el total se corta con error antes de 4 GiB. Antes de construir se comprueban en las fuentes primarias (la especificación ZIP de PKWARE
   y ECMA-376) el descriptor de datos y el escape, y se guardan con su huella.
5. **Estimación antes de descargar.** ✅ backend, 19/11/2026 (bytes por fila medidos en `docs/16 §89`). `GET /sitios/{id}/exportar/estimacion?desde&hasta` (mismos permisos): cuántas mediciones, tramas y
   eventos trae el rango, contadas con tope (como mucho 1 000 000 por conjunto: el conteo nunca recorre más; por encima, «más de
   1 000 000»), los bytes aproximados por formato (filas × bytes por fila medidos en el banco) y desde cuándo hay tramas.
6. **Pantalla P8** ✅ panel, 19/11/2026 (`Exportar.svelte`, con `lib/exportar.ts`; `docs/16 §89`, apartado del panel) (`#/exportar?sitio=<código>`; entrada «Exportar datos» del menú para quien tiene la acción `exportar` en algún sitio; con
   más de un sitio, el selector de «Publicar»). Tres decisiones en una columna: **rango** (Últimas 24 horas, Últimos 7 días, Últimos 30
   días, Todo el historial —desde el año 2000—, o Entre fechas: días completos en la zona horaria del sitio, `docs/13`); **formato**, con
   una línea de para qué sirve cada uno («CSV: para R, Python o QGIS; tres archivos en un .zip», «XLSX: para Excel o LibreOffice; una hoja
   por tipo de dato», «JSON: para programas»); y la **estimación**, que se pide al cambiar el rango (una a la vez; la anterior se cancela)
   y dice, por ejemplo, «≈ 45 210 mediciones, 9 044 tramas y 37 eventos; unos 1,2 MB», con la línea de la retención («Las tramas originales
   se guardan 30 días: de este rango, solo desde el 20/10/2026»). «Descargar» usa `descargar()` (§6), con «Cancelar» mientras baja; por
   sobre 250 MB estimados pide confirmar («Tu navegador arma el archivo en memoria: con un rango menor es más seguro»). El aviso de éxito
   dice el nombre y el tamaño. `nombreDeArchivo` del panel admite `.zip` y `.xlsx` además de `.csv` y `.json`. La ficha (P3) conserva sus
   dos botones de CSV y suma el enlace «Exportar todo el sitio». Sin desplazamiento horizontal a 390 y a 1 280 px.
7. **Reimportar sin pérdida** (criterio 4 de HU-08). ✅ backend, 19/11/2026 (`pruebas/exportar-integracion.sh`, 0 diferencias en los tres
   formatos; la apertura en Excel o Google Sheets y en LibreOffice con la pantalla sigue siendo del estudiante). No se construye una importación: se demuestra que el archivo trae todo, exacto.
   Una prueba de integración por formato exporta un sitio de prueba con casos límite (instantes con microsegundos; valores negativos,
   `1e-7` y el mayor `double`; una unidad con coma y comillas; una trama que no es UTF-8 y otra de 64 KiB; un texto que empieza con `=`,
   otro con `'=` y otro con apóstrofo solo; un `detalle` con tildes y emoji), lee el archivo con un lector escrito en la prueba (no con el
   código que lo escribe) y lo compara fila a fila con la base: **0 diferencias**, y cada `sha256` coincide con el de su carga. Con otro
   sitio sembrado con marcas propias, ninguna aparece en el archivo (RF-41). La apertura en LibreOffice Calc y en Excel (o Google Sheets) la
   hace el estudiante con su salida esperada: se abre sin «reparar», con cuatro hojas y la fecha como fecha.
8. **Pruebas.** ✅ lo del backend, 19/11/2026 (unitarias, `sesion-smoke`, cupo, corte y banco: `docs/16 §89`); ✅ panel, 19/11/2026: lo del DOM
   (`Exportar.test.ts` y `lib/exportar.test.ts`) y el navegador real (`pruebas/panel-exportar-e2e.sh` con `panel/e2e/exportar.mjs`), `docs/16 §89`.
   Unitarias del zip (lo escrito se lee con `inflateRaw` y el CRC coincide), del escape, de los números, del apóstrofo
   reversible, del corte de la carga (0, 31 999, 32 000, 32 001 y 87 384 caracteres) y del paso a la hoja siguiente (con el tope reducido en
   la prueba); la matriz de permisos de las dos rutas en `sesion-smoke`; el cupo compartido (429); el corte cuando el cliente se va; por el
   DOM, P8 (rango, estimación cancelable, confirmación sobre 250 MB, oculta sin la acción, nombre del archivo); con navegador real, las tres
   descargas a 390 y a 1 280 px; y en el banco, el tiempo y la memoria de exportar 1 000 000 de mediciones (`docs/16`).
9. **Decidido al diseñar** (19/11/2026): (a) un archivo por descarga con los tres conjuntos (el CSV, en un zip); (b) nada de personas en el
   archivo; (c) la exportación por dispositivo sigue igual salvo el apóstrofo reversible; (d) la descarga del panel sigue siendo la de §6,
   con la estimación y la confirmación; (e) las horas de HU-08 en el backlog no cambian (4): el esfuerzo real queda en la bitácora.

**Decidido al implementar (19/11/2026)**, en lo que el bloque no fijaba (backend y proxy; el contrato completo, en el OpenAPI; `docs/16 §89`):
(a) **Eventos:** solo los de un equipo del sitio (`evento.dispositivo_id`); los del sitio sin equipo (el plazo de la primera trama, los
enlaces públicos) no entran: son ajustes del sitio, no el ciclo de vida de un equipo. `evento.usuario_id` no sale nunca.
(b) **Orden:** equipos por `id_fisico`; dentro, canales por código de magnitud; tramas y eventos por (instante, id), que desempata los
iguales. (c) **Tandas:** 10 000 filas en mediciones y eventos; 250 en tramas (una pesa hasta 64 KiB). (d) **JSON:** suma
`retencion_tramas_dias` después de `generado_en`, para que los tres formatos digan la retención; `valor` no finito sale `null`, como el
vacío del CSV. (e) **CSV partido:** `mediciones-2.csv`, `-3`…, cada uno con su cabecera; `LEEME.txt` dice las filas de cada archivo y el
total, en pares «campo: valor» con CRLF, los mismos que la hoja «Acerca de». (f) **XLSX:** la fecha de planilla es la columna `fecha_utc`,
justo después del instante en texto, con los milisegundos **truncados** (como un `Date`); espacios de nombres de la clase Transitional
(ECMA-376 Parte 4), que leen todas las planillas; cabecera en negrita; celdas sin referencia `r` (es opcional; la fila sí la lleva); el
retorno de carro va como `&#13;` (un lector XML lo convertiría en salto); un `_` seguido de `x` y cuatro dígitos hexadecimales se protege
con `_x005F_` aunque no lo cierre un `_`, porque el `_` de un escape siguiente lo cerraría (la norma escribe la protección del literal para
`bstr`, §22.4.2.4, y aquí se aplica igual); un texto de más de 32 767 caracteres o una carga de más de 96 000 en base64 cortan la
descarga con el motivo, en vez de recortar en silencio (con los topes de hoy no ocurre). (g) **Zip:** deflate nivel 6, descriptor con su
firma, nombres ASCII (sin el bit 11), hora MS-DOS de la generación, tope de 1 000 entradas y del total en 4 GiB − 64 MiB. (h) **Códigos:**
404 o 403 del sitio, después 400 del formato y del rango, y al final 429 del cupo. El 429 de las tres rutas (las dos exportaciones y la
estimación) lleva `codigo: exportaciones_en_curso` y dice «hay 2 exportaciones o estimaciones en curso; inténtalo en un momento» (revisión
del mismo día). Si la exportación falla antes de enviar nada (la primera consulta), 503 en JSON, sin `Content-Disposition`; a mitad, se
corta la conexión. `Content-Type`: `application/zip`, el de SpreadsheetML o `application/json; charset=utf-8`. (i) **Estimación:** `{desde,
hasta, tope_conteo, mediciones{filas, supera_tope}, tramas{filas, supera_tope, desde}, eventos{…}, retencion_tramas_dias,
bytes_aproximados{csv, xlsx, json}}`, en una conexión propia con 10 s por consulta (contar 1 000 000 tarda ≈ 0,5 s; si los pasa, 503) y
**con el mismo cupo** que las exportaciones (revisión del mismo día): el pool tiene 5 conexiones y lo comparte la recepción, y cancelar la
estimación en el panel (la anterior, al cambiar el rango) **no cancela la consulta en la base**, que sigue con su conexión tomada; sin
cupo, unas cuantas estimaciones seguidas y dos exportaciones agotaban el pool. Con el cupo, entre exportaciones y estimaciones se toman a
lo más 2 y quedan 3 para la recepción. (j) **Corte:** la escritura espera `drain` o el cierre del cliente, lo que llegue primero, y falla
si el cliente se fue (`descarga.ts`); la exportación por dispositivo usa la misma (antes miraba `res.destroyed` en su bucle). Los primeros
64 KiB (las cabeceras del zip o del libro, o la del CSV) se retienen hasta después de la primera consulta, para poder responder el 503.
Un cliente prestado que la base corta vuelve al pool con su error (`release(err)`) y pg-pool lo descarta. (k) **Proxy:** `proxy_buffering off` ya regía para todo el servidor (por el canal en vivo); la
`location` de las exportaciones lo deja escrito para ellas, y la estimación sigue en «location /».

**Decidido al implementar la pantalla (19/11/2026)**, en lo que el punto 6 no fijaba (`docs/16 §89`, apartado del panel):
(a) **Menú:** «Exportar datos» va justo después de «Inventario», con las pantallas de datos (es lo que el investigador usa además del tablero y
el inventario); icono propio, una flecha que baja a una bandeja. Sin la acción en ningún sitio, la ruta dice quién exporta **según la matriz de
la sesión** («los exportan los perfiles de administrador e investigación»), no con un texto fijo. (b) **Rango:** por omisión «Últimos 30 días»,
el mismo del servidor; no va en la URL (solo el sitio). «Entre fechas» abre con la última semana hasta hoy en el sitio, y el último día es
como mucho hoy en el sitio (el servidor admite `hasta` hasta un día en el futuro: el fin de hoy cabe); un sitio al este de UTC que pide desde
el 1/1/2000 se acota al piso del servidor. Los rangos relativos se calculan al pulsar «Descargar» («las últimas 24 horas» son las de ese
momento, no las de cuando se estimó). (c) **Estimación:** se pide 300 ms después del último cambio de sitio, rango o días (escribir una fecha
no es una petición por tecla; cancelar en el panel no cancela la consulta en la base, que además ocupa un lugar del cupo de exportaciones del
servidor); cada cambio cancela al instante la que estaba en vuelo, y se descarta la respuesta cuya clave (sitio y rango; los relativos no
cambian de clave al correr el reloj) ya no es la elegida; cambiar el formato no pide otra (trae los tres tamaños). Ante el 429 del cupo, un
solo reintento solo a los 1,5 s; si vuelve el 429 («No se pudo estimar ahora: hay otras exportaciones en curso…») o llega un 503 («…la base
no respondió a tiempo…»), un aviso en llano con «Reintentar», sin más intentos solos; un cambio de sitio o de rango anula el reintento
pendiente. El texto va
con el formato elegido («unos 1,2 MB en CSV»); con más filas que el tope, «más de» en el conteo y en el tamaño, sin «≈»; sin filas, lo dice y
que se elija un rango más amplio (bajar el archivo vacío sigue permitido). (d) **Retención:** «este rango las trae todas», «de este rango, solo
desde el DD/MM/AAAA» (fecha del sitio) o «este rango no trae ninguna»; el corte lleva 5 minutos de margen, porque «Últimos 30 días» con 30
días de retención empieza justo en el corte y la respuesta llega instantes después (la primera corrida con navegador real decía «solo desde
hoy»). (e) **Confirmación:** sobre 250 000 000 bytes (los MB de mil, como el alta masiva) en el formato elegido **o** con algún conjunto
sobre el tope del conteo (el tamaño es entonces solo un mínimo: «más de 13,7 MB, sin saber cuánto más»); «Descargar igual» y «Cancelar»;
cambiar el rango o el formato la cierra. Sin estimación, «Descargar» queda desactivado con su motivo (sin ella no se sabe si pasa de
250 MB): «espera a que se calcule el tamaño» mientras se cuenta o se reintenta, «no se pudo calcular el tamaño: reinténtalo arriba» si falló;
al llegar la estimación por «Reintentar», se activa. (f) **Descarga:** mientras baja, el rango, el formato y el sitio quedan desactivados; cambiar de sitio por el menú o «Atrás», o
salir de la pantalla, la corta. El aviso de éxito («Descargado <nombre> (13,7 MB).») se quita al cambiar el sitio o el rango. El 429 del cupo
se reconoce por su `codigo` (`exportaciones_en_curso`, en las tres rutas), nunca por el texto del mensaje, que puede cambiar; el cuerpo
entero ya llegaba a la pantalla en `ErrorApi.cuerpo`. Otro 429 (el del proxy) usa el aviso de siempre. El 503 (la exportación falló antes de
enviar nada) dice que no pudo empezar porque la base no respondió y que no se guardó ningún archivo. La ficha usa los mismos avisos en sus dos
descargas de CSV, que comparten el cupo. Un corte a mitad del cuerpo dice
que no se guardó nada (el archivo se arma en memoria antes de entregarlo: nunca queda uno a medias). «Descargar» y «Cancelar» van sin
ayuda emergente: bajo 700 px la ayuda se fija al pie de la pantalla y tapaba el propio botón cuando quedaba abajo (lo encontró Firefox a 390 px;
el `Tooltip` común tiene ese caso con cualquier botón al pie, queda anotado). (g) **Ficha:** el enlace «Exportar todo el sitio» va bajo el de
«Configurar», con la misma regla de quién exporta que la pantalla (incluido el administrador del sistema). (h) **Guía de perfiles:** la frase de
`exportar` pasa a «exporta sus datos (mediciones, tramas y eventos)». (i) **Corrección de `instanteDesdeLocal`** (`lib/tiempo.ts`, también la
usa el rango a medida del tablero y la ficha): en las zonas al oeste de UTC, la hora que no existe por el cambio de hora caía una hora antes
(el 00:00 del 6/9/2026 en Santiago daba las 23:00 del 5/9: un rango que terminaba el 5/9 perdía su última hora y uno que empezaba el 6/9 sumaba esa hora); ahora cae en la siguiente válida,
como decía su comentario, y una hora repetida sigue siendo la primera vez.


**S. P7 v3: el alta masiva sin fricción (diseñado el 19/11/2026, antes del código; cambia los puntos 3 y 8b del bloque N).** Lo motiva un
recorrido en navegador real del mismo día (Chromium y Firefox, a 390 y 1 280 px; un archivo de 500 filas válidas y otro de 60 con errores
variados, lo mismo pegado desde una planilla y en JSON). La velocidad sobra: la revisión de 500 filas se dibuja en menos de 0,16 s aun con la
CPU cuatro veces más lenta, cada «Mostrar 100 más» en menos de 0,1 s, la vista previa responde en el servidor en 10 a 32 ms; sin
desplazamiento horizontal ni errores de JavaScript, y los tres orígenes dan el mismo plan. Lo que falta es quitar fricción, en este orden:
✅ 19/11/2026, los once puntos, en el backend y en el panel (`docs/16 §90`; lo que el diseño no fijaba, al final del bloque).
1. **Una fila mal formada no frena a las demás** (cambia la tabla 8b, decidido el 19/11/2026). Una fila con más o menos celdas que la
   cabecera, con un carácter que no se admite o más larga que el tope de su columna pasa a ser «No entra» con su motivo, entra al CSV de
   las que no entran y las demás se revisan como siempre. El archivo entero se rechaza solo cuando no se puede leer: vacío, sin filas,
   cabecera sin separador, columnas desconocidas u obligatorias que faltan, tamaño o más filas que el tope. La guarda real sigue siendo
   el servidor: una fila mal formada que llegara igual se rechaza allí con el mismo motivo.
2. **Unidades con su escritura común** (decidido el 19/11/2026). En `canales`, la unidad de un canal se acepta escrita como la del
   catálogo o con una escritura común de la MISMA unidad: «°C», «ºC», «C» o «degC» para `Cel`; «%» para la unidad porcentual de la
   magnitud (`%RH`, `%EL`…). Se guarda la del catálogo y la revisión lo dice como aviso («°C se leyó como Cel»). La tabla de escrituras
   vive una sola vez en el servidor y la usa el alta por lote, por la API y por el panel (el alta de a uno no recibe unidad: la fija el
   catálogo por la magnitud); el panel no la repite. No convierte valores ni
   acepta una unidad distinta (°F para temperatura sigue sin entrar). Aceptar otra unidad y convertirla al recibir, y las unidades de
   visualización por magnitud, quedan fuera del catálogo editable de TT-12 (bloque T; `docs/10 §8.4` punto 69, xi), como trabajo futuro;
   mostrar una medición en °F ya lo hace la preferencia de cada persona (H).
3. **Avisos que distinguen** (cambia el punto 3 del bloque N). Una zona escrita por su nombre que calza con una sola zona de los sitios de
   la persona deja de ser aviso: la revisión lo dice una vez sobre la lista («Zona «Norte» → sitio «Campus»: 500 filas»). Los avisos se
   calculan solo para las filas que entran, y la línea de arriba y la tarjeta «Con aviso» cuentan lo mismo.
4. **Las palabras de la persona.** Los textos de los motivos y avisos los escribe el servidor en palabras llanas (el `campo` queda para
   las máquinas): «el identificador se repite en el archivo» y no «id_fisico repetido»; «cada cuánto reporta» y no «intervalo_esperado_s»,
   y distingue la celda vacía de la mal escrita; «pasarela», «canal 2»; la vía y el formato con su nombre («MQTT», «SenML»); las unidades
   como se leen («°C», «% de humedad»); el sitio por su nombre y no por su código. Los motivos que el panel detecta al leer usan las mismas
   palabras. Una prueba falla si un texto que ve la persona trae un nombre de columna o de variable.
5. **Cada motivo con su remedio.** «Ese identificador ya está en uso en la plataforma: elige otro» (sin decir dónde: RF-41);
   «magnitud desconocida «temperatur»: ¿quisiste decir «temperatura»?» (la más cercana del catálogo, solo si hay una sola a poca
   distancia); «Ya existe» se muestra en ámbar, no con la cruz roja, con el botón «Abrir su ficha» cuando el equipo es de un sitio de la
   persona.
6. **En el teléfono, nada tapa nada.** La ayuda emergente, que bajo 700 px va fija al pie de la pantalla, ya no intercepta toques ni
   clics (en todo el panel) y las tres ayudas esenciales de la revisión se escriben visibles. El resumen y los botones («Volver» y «Crear
   N dispositivos») se repiten sobre la lista, para no tener que bajar por 100 tarjetas; bajo «No entran», visible: «Corrígelas y vuelve a
   subirlas».
7. **«Atrás» no pierde las credenciales.** Mientras no se descarguen, viven en la memoria del módulo (nunca en el almacenamiento del
   navegador ni en la dirección); volver a `#/alta?modo=lote` reabre el paso 3 con ellas. Se borran al confirmar «Ya las guardé», al
   cerrar la sesión o al vencer; siguen sin dibujarse en pantalla.
8. **El foco no se pierde.** Tras el último «Mostrar 100 más», al texto «Se ven N de N»; tras «Ya las guardé», al párrafo que lo confirma.
9. **Un .xlsx se reconoce.** Un archivo que empieza con la firma de un zip («PK» y los bytes 3 y 4) se reconoce como libro de Excel: «Es un
   libro de Excel. Guárdalo como CSV (Archivo → Guardar como) o copia las celdas y pégalas aquí». El lector propio (bloque N, punto 6) va en
   el bloque siguiente. ✅ 19/11/2026: el lector ya está y el reconocimiento por la firma pasó a ser el camino normal (`leerArchivoLote`):
   un libro se lee, y ese aviso dejó su lugar a los tres casos del libro en la tabla de N8b.
10. **Leer un archivo nuevo descarta el anterior:** «Revisar las filas» se desactiva hasta terminar de leerlo.
11. **Pruebas.** El archivo de 60 casos del recorrido queda como catálogo fijo de escenarios; por el DOM, cada punto; con navegador real,
    el recorrido en dos navegadores a 390 y 1 280 px, que crea por HTTP y borra al salir lo que creó (0 filas; hasta este bloque, el e2e
    del lote dejaba dos equipos en el banco), con los umbrales medidos: la revisión de 500 filas bajo 1 s a 390 px y cada «Mostrar 100 más» bajo 0,3 s.

**Decidido al implementar (19/11/2026).** (1) Las filas mal formadas las detecta el panel al leer (`lib/lote.ts`, `comprobar` y
`motivoDeCelda`): no se envían, la revisión las suma al plan del servidor en el orden del origen y, si ninguna fila está bien formada, abre
sin preguntarle al servidor. Siguen rechazando el archivo entero, porque impiden leer lo que viene después, la comilla sin cerrar, el texto
pegado a una comilla de cierre y el JSON que no es una lista de objetos. En el JSON, una celda que no es texto ni número, o un número que
perdió su escritura, deja fuera solo su fila. El motivo de una fila con celdas de más o de menos dice cuántas y cuáles sobran («la fila trae
1 celda más que la cabecera («sobra»): ¿un separador de más dentro de una celda?»). En «las que no entran» esa fila sale alineada a la
cabecera, con lo que sobra escrito en el motivo; vuelta a subir sin tocar, ya no está mal formada y la revisa el servidor. Las demás
vuelven con el mismo motivo. El paso 1 dice «N filas leídas. K están mal escritas y no entran: la revisión dice por qué.». El caso
`celdas_de_mas_o_de_menos` dejó la lista de errores del archivo. El servidor dice lo mismo con la fila delante («fila 8, Nombre: …»), y una
prueba del panel compara el bloque de sus textos con el del servidor, letra por letra. El motivo de un carácter que no se admite nombra lo
que la columna sí admite («…, y también «°» y «º»» en `canales`), y el de una celda larga dice cómo se contó («tiene 1198 caracteres,
contando como dos cada «°», y el máximo es 1197»). Un `canales` que solo trae separadores («|», «;») dice «faltan los canales», como el
vacío. El borrador guarda quién lo leyó: si la sesión vence y entra otra persona en la misma pestaña, al abrir el alta masiva se descarta
entero (archivo, filas, aviso y credenciales); si vuelve la misma, lo retoma (corrección del mismo día). (2) La tabla de escrituras vive en `alta/unidades.ts`. El alta de a uno no recibe
unidad (la fija el catálogo por la magnitud), así que la usa `leerCanales`, que es el alta por lote por la API y por el panel. Como «°C»
no es ASCII, `canales` admite «°» y «º» (la plantilla lo publica en `simbolos`). La familia Celsius se lee sin distinguir mayúsculas
(«cel», «degc», «°c», «c»), porque ninguna es otra unidad; las demás unidades, tal cual. En las columnas de códigos el tope se cuenta en bytes
UTF-8: un «°» vale dos, así el peor caso del cuerpo, el tope de 1 121 KiB, el proxy y la plantilla no cambian (probado en el límite). El
aviso dice «temperatura: °C se leyó como Cel (°C)», el único texto que nombra la unidad del catálogo, porque eso es lo que dice. Otra unidad:
«temperatura va en °C: «°F» es otra unidad y no se convierte». (3) La respuesta suma `zonas_por_nombre` (`zona`, `sitio` por su nombre y
`filas`), solo de las filas que entran, y la pantalla lo dice en una lista sobre la tabla. (4) `validarAlta` conserva sus textos, que son
los de la API del alta de a uno, para máquinas; el lote los dice en palabras de la persona (`enPalabras`), y una prueba recorre cada regla y
falla si un texto trae un nombre de columna o de variable, el código de una vía o de un formato, o «%RH». La plantilla publica el `rotulo`
de cada columna, que usan el detalle y los motivos del panel. Cada fila que entra trae `legible` (`donde`, `resumen` y `campos`, como se
leen), aditivo y fuera de la huella. El nombre del sitio sale de la misma consulta de los catálogos. (5) La magnitud más cercana es la de
menor distancia de edición, con dos ediciones o menos y sin empate; si no hay una, el motivo lista las del catálogo. «Abrir su ficha» va en
la fila, junto a «Ya existe», cuando el plan trae su `id`, que solo trae para los equipos de los sitios de la persona (RF-41). (6) La ayuda
emergente deja pasar toques y clics solo con pantalla táctil (`(max-width: 700px) and (hover: none)`), donde va fija al pie. Con ratón,
en cualquier ancho (también una ventana angosta, donde va fija al pie), sigue admitiendo el puntero encima (WCAG 2.2, 1.4.13). El e2e
emula a 390 px un teléfono táctil (`hasTouch` e `isMobile`): Chromium y Firefox dan `hover: none`, y lo comprueba en cada corrida. A 390 px
con ratón y a 1 280 px, la ayuda recibe el puntero. (Corrección del mismo día: la primera versión lo quitaba por ancho, y en una ventana
angosta con ratón no se cumplía 1.4.13.) «Volver», «Descargar las que no entran» y «Crear» ya no tienen ayuda emergente: lo esencial se escribe en una
línea bajo los botones de arriba y en el párrafo de «No entran», al que pasó el botón de la descarga. Los botones se repiten siempre, sobre
la lista y debajo de ella, con el resumen «60 leídas: 44 se crean, 1 ya existe y 15 no entran.». (7) La memoria va en
`lib/lote-memoria.ts`, aparte, para que `App.svelte` la borre al cerrar la sesión (junto con el archivo leído) sin cargar el alta masiva
en la primera carga. Se borra también con un 401 y al salir de la pantalla con las credenciales ya descargadas. Como salir ya no las pierde,
el aviso del menú dice «Quedan en esta pestaña hasta que cierres la sesión o la pestaña: vuelve al alta masiva para descargarlas». (8) «Se
ven N de N» y el párrafo de las credenciales olvidadas reciben el foco con `tabindex="-1"`, sin ser parte del recorrido con Tab. (9) La
firma se mira en `leerOrigen`, antes que nada, con el caso `libro_excel` y el botón «Elegir otro archivo». Desde el 19/11/2026 la mira `leerArchivoLote` y un libro se lee (bloque N, punto 6). (10) Al elegir un archivo, el
anterior se descarta en el acto: la pantalla dice «Leyendo …», y «Revisar las filas» queda desactivado con su motivo («se está leyendo el
archivo»). Cancelar la ventana de elegir archivo conserva el anterior y no corta una revisión en vuelo. (11) El catálogo vive en `panel/e2e/datos/lote-escenarios.csv`, con
lo esperado de cada escenario, los totales y las zonas en `lote-escenarios.json`. «xprefijo» se reemplaza por el prefijo de cada corrida.
Lo usan la prueba del panel, una del backend (`alta/lote-escenarios.spec.ts`) y el e2e. El e2e pasó del banco a la pila de desarrollo
(`pruebas/panel-lote-e2e.sh`, en el paso 4c del guardián): sitios y personas de descarte, crea por HTTP, borra todo al salir y falla si
queda una fila. `banco.sh lote-navegador` se quitó. Los umbrales se exigen a 390 y a 1 280 px. (12) El archivo de credenciales cambia
su cuarta columna: `topico` pasa a `destino`, a dónde envía cada equipo según su vía. MQTT, su tópico
(`sitio/<código>/dispositivo/<id_fisico>/<magnitud>`); HTTP, `POST /recepcion/{id_fisico}`; LoRaWAN, «por su pasarela <id_fisico de la
pasarela>», con la credencial vacía. Lo calcula el servidor (`destinoDe`, de lo interpretado) y cada fila creada lo trae en `destino`,
aditivo; `topico` no cambia. Hasta este bloque, la columna `topico` quedaba vacía en un equipo HTTP o LoRaWAN.

**T. P16 Catálogo: magnitudes y recetas de decodificación (TT-12, RF-11, RF-14; diseñado el 20/11/2026, antes del código, y construido el 23/11/2026, `docs/16 §100`; solo el
administrador del sistema).** Hasta este bloque el catálogo de magnitudes solo se leía (el selector del alta, la ayuda del lote) y se
cambiaba por migración; los alias de claves y la decodificación de los nodos LoRaWAN vivían en el código. Las reglas y su porqué están en
`docs/10 §8.4` punto 69 y el esquema en `docs/08 §8`; aquí, solo lo que ve y hace la persona. «Receta de decodificación» es lo que antes
se llamaba «perfil de decodificación»: en el panel, «perfil» ya nombra los roles de las personas (P10).
1. **Ruta y menú.** `#/catalogo?seccion=magnitudes|recetas` (sin `seccion`, magnitudes; un valor desconocido se ignora). La entrada
   «Catálogo» del menú, junto a «Estado del sistema», aparece solo al administrador del sistema (la acción `sistema`, `docs/20 §6`). Quien
   llega sin serlo ve «El catálogo lo administra quien administra el sistema. Las magnitudes que existen se eligen al dar de alta un
   equipo.» con el enlace al tablero. La ruta nunca es «última vista». Dos secciones con su pestaña: **Magnitudes** y **Recetas de
   decodificación**.
2. **Magnitudes: la lista.** Una fila por magnitud (tarjetas bajo 700 px), por nombre: nombre y código; la unidad como se lee («°C») con
   su símbolo SenML al pasar el cursor; el rango («de −40 a 85 °C»); el umbral sugerido («alto 30 °C · histéresis 0,5» o «sin
   sugerido»); los alias («temperature, temperatura») y en cuántos canales se usa («en 14 canales»; el conteo, que abarca todos los
   sitios, solo lo entrega la API con la acción `sistema`, la misma que abre esta pantalla: `docs/20 §6`). Arriba, «Crear magnitud». Cada fila,
   «Editar». Sin magnitudes (solo en una base sin sembrar): «El catálogo está vacío: crea la primera magnitud».
3. **Editar una magnitud.** Un formulario con: **Nombre**; **Código** y **Unidad** como texto de lectura, con el motivo escrito («No
   cambian: los citan los canales, las reglas y las mediciones guardadas»); **Rango válido** (mínimo y máximo); **Umbral sugerido**
   (alto, bajo e histéresis, todos opcionales, con la línea «Se ofrece al configurar un canal de esta magnitud; no crea alertas solo»); y
   **Alias** (cada uno con «Quitar», y un campo «Agregar alias» con la regla a la vista: «minúsculas, números, «_», «.» y «-», hasta 64»).
   La validación en vivo usa las reglas del servidor (bajo < alto; histéresis menor que la mitad de la banda; los sugeridos dentro del
   rango; mínimo < máximo; un alias con la forma y fuera de la lista de reservados, `docs/08 §8`); el servidor decide. «Guardar» manda el
   `actualizado_en` leído (bloqueo optimista) y no se activa si nada cambió («no hay cambios»).
   **Achicar el rango se confirma antes si afecta mediciones** (como acortar el plazo, bloque Q, punto 2): si el mínimo sube o el máximo
   baja, al pulsar «Guardar» la pantalla pide el impacto del rango propuesto y, si alguna medición de los últimos 7 días habría quedado
   fuera, muestra «Con este rango, N mediciones de los últimos 7 días, de K canales, habrían quedado fuera y habrían ido a cuarentena. Lo
   ya guardado no cambia; rige desde la próxima trama. ¿Guardar igual?» con «Guardar igual» y «Cancelar»; con 0, guarda directo. Se
   guarda exactamente el rango consultado (los campos se bloquean mientras se consulta; una respuesta que llega con los campos ya
   distintos se descarta); si la consulta falla, se dice y no se guarda. Ampliar el rango nunca pregunta.
   **Errores, en palabras:** el rango que deja fuera algo existente es 409 con la lista: «El rango nuevo deja fuera: la regla del canal
   «Sala 3 · Temperatura» (alto 90 °C); la calibración del canal «Parcela 2 · Humedad del suelo»…» (diez a la vista y «y N más»), cada una
   con el enlace a su ficha, y nada se guarda; otro cambio entretanto, 409 con relectura y lo escrito conservado («Alguien cambió esta
   magnitud a las 10:42: revisa los valores nuevos y vuelve a guardar»); un alias que ya existe, «La clave «temp» ya es alias de
   «Temperatura del suelo»: una clave apunta a una sola magnitud»; un alias reservado, «deveui lo usa la pasarela para otra cosa: no puede
   ser alias». Al guardar: «Guardado. Rige desde la próxima trama.»
4. **Crear una magnitud.** Código (con su forma a la vista: «minúsculas, números y «_», empieza con letra; no se podrá cambiar»),
   nombre, unidad (un selector de la lista cerrada, que el panel lee de `GET /magnitudes/unidades`, cada una como se lee y su símbolo: «°C (Cel)»; «no se podrá cambiar») y rango (los
   dos extremos, obligatorios: el filtro 3 los usa y la base los exigirá, `docs/08 §8`); el umbral sugerido y los alias, opcionales, como al editar. Un código que
   ya existe: «Ya hay una magnitud con ese código». No hay «Borrar»: en este corte no se borra ninguna magnitud (`docs/10 §8.4` punto 69,
   ii), y la pantalla lo dice en la ayuda de la sección.
5. **Recetas: la lista.** Una fila por receta: código y nombre; el largo («10 bytes»); los campos en una línea legible («temperatura:
   entero de 16 bits con signo en el byte 5, ÷ 100 · humedad: …»); en cuántos equipos se usa («en 2 equipos»). Acciones: «Crear receta»,
   «Crear a partir de esta» (abre el formulario con sus campos y el código con «-v2» al final) y, si está en uso, «Reemplazar por…». Sin
   recetas: «No hay recetas. Una receta traduce los bytes de un equipo LoRaWAN cuya pasarela entrega la trama sin decodificar».
6. **Crear una receta.** Código (forma a la vista), nombre y **largo exacto en bytes** (1 a 255). Debajo, los campos (de 1 a 32; «Agregar
   campo», «Quitar»): magnitud (selector del catálogo, cada una a lo más una vez), byte de inicio (el primero es el 0), tipo (con nombre
   legible y una línea de ayuda por tipo: «i16be: entero de 2 bytes con signo; orden de bytes: el más significativo primero»; «u16le:
   entero de 2 bytes sin signo; orden de bytes: el menos significativo primero»; «u8: un byte, de 0 a 255»), «sumar antes» (de −1 000 000
   a 1 000 000), «multiplicar por» y «dividir por» (enteros de 1 a 1 000 000), con la fórmula escrita al lado y al día: «valor = (crudo +
   200) × 1 ÷ 100», y bajo ella qué es el crudo: «crudo: el número entero que se lee en esos bytes, antes de la fórmula». En vivo: un
   campo que no cabe en el largo («la trama tiene 10 bytes, del 0 al 9: el campo 3 empieza en el byte 9 y ocupa 2, así que se sale»), una
   magnitud repetida, cero campos. Arriba del botón de crear,
   siempre visible: «Una receta no se edita después de creada: para corregirla, crea otra y usa «Reemplazar por»».
   **Probar sin guardar.** Un campo «Bytes de prueba» y un selector **Hexadecimal | Base64** (no se adivina: «deadbeef» es válido en los
   dos). El hexadecimal admite espacios entre bytes. «Probar» manda la receta tal como está escrita y los bytes; no guarda nada. Resultado:
   una tabla magnitud · valor · unidad («temperatura 18,16 °C»), o el motivo en palabras («se esperaban 10 bytes y llegaron 9»; «eso no es
   hexadecimal: «zz» en la posición 3»). Si después se cambia la receta o los bytes, el resultado anterior se tacha con «la receta cambió:
   vuelve a probar» (nunca queda a la vista un resultado de otra receta). Probar no es obligatorio para crear, pero el botón de crear
   recuerda «sin probar» mientras no haya un resultado al día.
7. **Reemplazar por.** Desde una receta en uso: un selector con las demás recetas y la confirmación «N equipos pasan de
   «campus-heltec-v3-v1» a «campus-heltec-v3-v2». Las tramas ya guardadas no cambian; las siguientes se decodifican con la nueva.»
   con «Reemplazar» y «Cancelar». Todo o nada: si falla, ningún equipo cambia y se dice por qué. Al terminar: «N equipos usan ahora
   «…-v2». La receta anterior queda sin uso y se conserva». No hay «Borrar» ni «Editar» (punto 69, vii).
8. **«Usar el sugerido» en P6 (cambia el bloque E).** En el editor de reglas de un canal cuya magnitud tiene umbral sugerido, un botón
   «Usar el sugerido (alto 30 °C · histéresis 0,5)» llena una regla nueva con esos valores **sin guardar**: la persona los revisa y
   guarda como siempre, con su bloqueo optimista y su evento. Con las 4 reglas del canal ya puestas, el botón se desactiva con su motivo
   («el canal ya tiene 4 reglas»); sin sugerido, no aparece. Los sugeridos salen del catálogo, que P6 ya puede leer con cualquier sesión;
   P6 no cambia de permisos. El alta (P7) no crea reglas: los canales nuevos nacen sin reglas, como hoy.
9. **Accesibilidad y forma.** Cada campo con su etiqueta; los avisos con el componente `Aviso`; todo botón es `Boton`; los errores junto
   a su campo y repetidos en un resumen arriba del formulario; sin desplazamiento horizontal a 390 y a 1 280 px; ningún texto para la
   persona trae un nombre de columna o de variable (como en el bloque S, punto 4), salvo los códigos, que son lo que se escribe.
10. **Decidido al diseñar:** (a) la pantalla es P16, el siguiente número libre de §3; (b) el selector hexadecimal/base64 en vez de
    adivinar; (c) «Crear a partir de esta» como el camino corto para la `-v2`; (d) una magnitud nueva lleva siempre los dos extremos del rango (la base también lo exigirá con la migración prevista, `docs/08 §8`). **Si el tiempo aprieta**, la pantalla puede limitarse a las magnitudes y a probar y crear una receta; «Reemplazar por»
    queda entonces solo en la API.
11. **Pruebas.** Por el DOM: el menú (visible solo con la acción `sistema`) y el texto para quien no la tiene; cada sección vacía y con
    datos; la confirmación al achicar el rango (con N > 0, con 0, la consulta que falla, la respuesta vieja descartada), el 409 con la
    lista y el de relectura; un alias repetido y uno reservado; probar con la captura real (02 00 00 00 8f 07 18 19 98 af → 18,16 °C,
    65,52 % y 3,75 V) en hexadecimal y en base64, y el resultado tachado al cambiar la receta; «Reemplazar por» con su confirmación; en P6,
    «Usar el sugerido» llena sin guardar y se desactiva con 4 reglas. Con navegador real, en dos navegadores a 390 y 1 280 px: crear una
    magnitud, crear y probar una receta, y el sugerido en P6.

## 5. Flujos
**F1 · Alta y primera trama.** Ya está dibujado en el diagrama de secuencia del alta (`docs/10`, figura del informe): el
administrador crea el dispositivo (API en la Etapa 3), recibe la credencial una sola vez, configura el nodo, y el panel
muestra «esperando la primera trama» hasta que llega un `visto` por el canal en vivo. Desde el 18/11/2026 ese texto es también su estado
visual en P1, P2 y P3 (§2), con el plazo del sitio: si la primera trama no llega antes de `espera_hasta`, pasa a «Sin señal» y el supervisor
abre la condición de falta de comunicación, con el detalle `nunca_reporto` en su evento.

**F2 · Cambiar un umbral con conflicto (Etapa 4).** 1) El administrador abre P6; el panel guarda el `actualizado_en` que leyó.
2) Edita umbral alto y bajo; la validación vive en la misma función que usa el guardado. 3) Guarda: `PUT` con el
`actualizado_en`. 4) Si otra persona cambió la regla entretanto, 409: el panel muestra «alguien la cambió a las 10:42; recarga
para ver el valor nuevo» y no pisa nada. 5) Si guardó, la regla rige desde la trama siguiente; una condición abierta se
reevalúa con esa trama (punto 28); la auditoría deja un `evento`.

**F3 · Silencio, condición y mantenimiento.** 1) Un dispositivo deja de reportar; el supervisor abre `sin_comunicacion` tras
dos intervalos esperados. 2) El canal en vivo emite `condicion`; en P2 el dispositivo sube al grupo «Sin señal» y en P1 cambia
el conteo, sin recargar. 3) El administrador lo revisa en terreno y lo marca «en mantenimiento» (P6, Etapa 4; hasta entonces,
por SQL o API): pasa a «Inactivo» y no genera alertas (RF-22). 4) Al volver a `activo`, `en_servicio_desde` pasa a ese instante (§2): el siguiente barrido cierra la condición
que quedó abierta de antes (el equipo vuelve a tener un intervalo completo, sin falsa alarma) y, con la primera trama, el estado vuelve a
«Normal»; si no reporta dentro de 2 × su intervalo, el supervisor la abre de nuevo.

**F4 · El canal en vivo se cae.** `EventSource` reintenta solo ante un corte de red, no ante un 503 (cupo lleno) ni un 403.
El panel envuelve el canal: si recibe 503 o 403, o si pasan 60 s sin latido (el backend manda uno cada 25 s), cierra y vuelve
a abrir con espera de 1, 2, 4… hasta 30 s (la espera vuelve a 1 s con el primer latido o evento recibido, no al abrir la conexión: un
servidor que acepta y cierra enseguida no provoca una recarga por segundo; corrección del 11/11/2026), y muestra «en vivo: reconectando» en la cabecera. Al reconectar, repite todo lo
que la pantalla muestra (inventario y condiciones en P2; ficha, condiciones, rechazadas e histórico del rango visible en P3),
porque pudo perder eventos mientras estuvo caído: el canal no guarda cola.

**F5 · Exportar (Etapa 4).** Elegir sitio, rango, magnitudes y formato; el panel muestra cuántas filas serán antes de
descargar; la descarga exige el perfil de administrador de sitio o de investigador (desde el 08/11/2026, `docs/20 §6`; hasta entonces,
administrador); la vista pública nunca ofrece exportar (punto 6).

## 6. Reglas transversales
- **Errores con acción:** cada código tiene un texto y un siguiente paso (400 «revisa el filtro», 404 «ya no existe, vuelve
  al inventario», 409 «recarga», 421 y 503 «el servicio no está disponible desde esta dirección / está saturado; reintentando»).
- **Vacíos con camino:** ninguna lista queda en blanco; dice qué significa estar vacía y qué hacer.
- **Sin scripts en línea** ni recursos externos: la CSP del backend (`docs/11`) prohíbe ambos; fuentes y estilos van en el
  paquete del panel. Los `.map` no se publican.
- **Pruebas por el DOM, en los dos sentidos**: lo que debe mostrarse se lee del DOM (textos, conteos, filas), lo que debe
  frenarse se comprueba que no aparece; y una prueba de que el estado visual de cada fila coincide con la función de la §2.
  Corren sobre el código fuente en jsdom; el build que sirve el backend se comprueba aparte con `pruebas/panel-desarrollo.sh`
  (cabeceras, CSP, paquete con hash, sin `.map`). **Con navegador real** (desde el 16/10/2026, `docs/16 §39`): `banco.sh navegador`
  abre el build que sirve el banco en Firefox con Playwright (dependencia de desarrollo del panel, versión fijada) y recorre P3 según
  la fila de §7: los puntos del gráfico contra `/historico`, una trama publicada por MQTT que aparece sin recargar y la caída del
  backend («reconectando» y, al volver, la lectura publicada durante la caída); desde el incremento 2 recorre también la leyenda, cada rango y
  resolución, el rango vacío, el aviso de zona (con el contexto del navegador en otra zona) y P3b desde P2 (`docs/16 §52`); deja capturas para
  mirarlas. El navegador se elige con `NAVEGADOR=firefox` (por defecto) o `NAVEGADOR=chromium`. jsdom no dibuja: lo
  que solo se ve en pantalla (formatos, textos del gráfico) se revisa en esa captura.
- **Fechas, horas y textos para personas:** horas en formato de 24 h y meses en español en ejes, leyendas y tablas, siempre en la zona
  del sitio (regla 6 de `docs/13`); ningún código interno a la vista (`sin_comunicacion` se muestra «Sin comunicación»). Lo encontró la
  primera prueba con navegador real: el gráfico mostraba «9:30pm» y «Time» (los valores por defecto de uPlot, en inglés).
- **Un solo cliente HTTP** en el panel (`panel/src/lib/api.ts`), que añade el prefijo de la API, interpreta los códigos y expone el 409 como
  tal. Desde la sesión (08/11/2026): manda la cookie del mismo origen; pone `X-Pedido: panel` en toda petición que escribe (y en ninguna
  otra); resuelve una sola vez lo que vale para toda la aplicación: 401 → «Entrar» guardando la ruta, 403 por clave temporal → cambio
  obligatorio, 409 → «alguien lo cambió, recarga», 429 → los segundos que trae el cuerpo (`reintentar_en_s`), sin red → «sin conexión».
  **Gana la última:** una recarga o un cambio de pantalla o de filtro cancela la petición anterior (`AbortController`); una cancelación
  nunca se muestra como error.
- **Descargas por `fetch` y Blob, en un solo ayudante** (`descargar`, decidido al implementar el 08/11/2026). Exportar no es un `<a href>`
  a la API ni lleva un token en la URL: con la sesión vencida, un enlace directo abría el JSON del 401 en una pestaña. El ayudante pide
  con la sesión, pasa por el manejo central (401 → «Entrar») y, con 200, arma el archivo en memoria y lo entrega con un enlace creado en
  memoria (nunca insertado en la página), con el nombre que trae `Content-Disposition`.
- **Componentes de botones y mensajes** (regla del 08/11/2026): todo botón nuevo es `Boton.svelte`, con **etiqueta de texto obligatoria**
  (ningún botón solo con icono: sin ella el componente falla en voz alta; la única excepción de solo icono, desde el 13/11/2026, son los
  enlaces de la barra lateral contraída, con su nombre accesible y su ayuda visible: §4, L1e; desde ese día `icono` agrega un icono propio
  ANTES del texto, nunca en su lugar); `ayuda` como tooltip (`Tooltip.svelte`) que aparece al pasar
  el ratón **y** al enfocar con el teclado, se va con Escape y se enlaza con `aria-describedby`; `cargando` (desactivado, `aria-busy`, la
  etiqueta en gerundio) y `motivoDesactivado`, que desactiva el botón y **escribe el motivo al lado** (un botón desactivado no recibe el
  foco ni el ratón en todos los navegadores: un tooltip no alcanzaría). Los mensajes son `Aviso.svelte` (éxito, error, conflicto, espera,
  información; error y conflicto como alerta, lo demás como estado), y un error de la API se convierte en aviso con una sola función
  (`lib/avisos.ts`). Migrados en este bloque: «Comparar (N)» (su `title` pasó a ayuda y motivo escrito), «Pausar»/«Reanudar», «Reintentar»,
  «Actualizar», «Ver la última medición» y las dos descargas de la ficha. Quedan como botones propios, a propósito: las fichas de conteo por
  estado del inventario (en el tablero son enlaces desde el bloque L) y las tarjetas de canal (botones con contenido rico y texto visible) y los botones de rango de `SelectorRango.svelte`. El paso 2y3
  del guardián falla si aparece `<button` en cualquier otro componente.
- **Tablas y formularios con la misma regla** (08/11/2026; TT-43, RF-58): cada columna con un encabezado de texto, y con ayuda cuando es
  una abreviatura o una unidad; la acción de una fila es un `Boton` con etiqueta, nunca la fila entera como enlace sin decirlo; cada campo
  con su `<label>` visible, la ayuda debajo enlazada con `aria-describedby` y el error del campo escrito junto a él, no solo arriba del
  formulario. La validación del panel es la misma función que usa el servidor cuando puede (como las reglas de la clave en P10).
- **Paginación** (08/11/2026; RF-57, `docs/10 §8.4` punto 58): en las listas por tiempo (cuarentena, condiciones, accesos, auditoría,
  eventos) los botones «Más recientes» y «Más antiguos», sin número de página porque con keyset no lo hay; en usuarios e inventario,
  páginas con total («1–50 de 132»). La posición va en la URL, como la vista (incremento 1, punto 1): «atrás» vuelve a la misma página.
  Ninguna lista que crece pide «todo».
- **Renderizado optimista, solo donde se puede deshacer** (08/11/2026): lo rápido y reversible (marcar para comparar, pausar el vivo,
  guardar una preferencia, reconocer una alerta) se muestra hecho al instante y, si el servidor lo rechaza, vuelve atrás con un aviso que
  dice por qué. **Nunca optimista:** lo que muestra un secreto una sola vez (credencial, clave temporal), lo que da de baja o borra, lo que
  cambia permisos y lo que puede chocar con otra persona (bloqueo optimista, 409): eso espera la respuesta con el botón en «cargando».
- **Toda descarga nueva** (XLSX, exportación por sitio, mis datos de cuenta, el CSV de filas rechazadas del alta masiva) usa el mismo
  ayudante `descargar` de la regla anterior: con la sesión, sin token en la URL y con el 401 llevando a «Entrar».
- **Avisos** (08/11/2026): todo mensaje es `Aviso.svelte`; los de éxito se van solos, los de error y conflicto quedan hasta cerrarlos;
  los cambios que llegan en vivo se anuncian con `aria-live` sin robar el foco. Las notificaciones en pantalla de una condición crítica
  (HU-24) se agrupan si llegan varias del mismo dispositivo (TT-23); las del navegador, solo si la persona las activa (`docs/21 §5`).
- **Nada se repite por cada evento:** un aviso de condición pide la lista con antirrebote (una consulta por segundo como mucho,
  nunca dos en vuelo) y las lecturas en vivo se aplican por lotes (un redibujo cada 250 ms como mucho; en la pestaña Resumen del tablero, una consulta
  cada 2 s y un redibujo por segundo, L3c). Un dispositivo que
  oscila o un emisor malicioso no multiplican consultas a la base ni redibujos. La ficha descarta eventos de otro dispositivo
  aunque el canal venga filtrado.
- **Rendimiento:** el histórico llega agregado (en resolución «auto», entre 60 y 170 puntos según el rango; con una resolución elegida, hasta 2 500); uPlot dibuja; el vivo añade al final; en P2 la tabla se
  recalcula solo con los eventos recibidos, no repidiendo el inventario cada vez.
- **Sistema visual, tema y teléfono** (11/11/2026): tokens en `app.css` sin colores sueltos en los componentes, tema claro y oscuro por
  preferencia, colores de series validados en los dos temas y tablas que se vuelven tarjetas bajo 700 px: puntos A2, A3 y A5 del tablero
  v2 (§4). **Un valor, un estado** (A4): ningún número visible nace de dos cálculos distintos.
- **Totales y cursores en cabeceras** (11/11/2026): la paginación con total manda `X-Total` y la paginación por cursor `X-Siguiente`; el
  cuerpo de cada lista sigue siendo la lista. Un campo nuevo se suma a la respuesta; ninguna respuesta cambia de forma (§4 tablero v2, I).

## 7. Trazabilidad y prueba de cada pantalla
| Pantalla | Requisitos | Entra en | Cómo se prueba |
|---|---|---|---|
| P2 Inventario con semáforo y filtros | RF-47, RF-48, RF-51, HU-10, HU-19, HU-20 | Tramo 2 (Etapa 3) | Semilla conocida → conteos y filas en el DOM; un dispositivo en mantenimiento aparece «Inactivo»; filtro por vía reduce la tabla; el reenvío de Vite conserva el `Host` y no retiene el canal (`pruebas/panel-desarrollo.sh`, `docs/16 §16`); varios sitios: dos sitios con una zona del mismo nombre, el filtro por sitio y la zona dentro del sitio (16/10); RF-52 en `banco.sh navegador`: la página no se desplaza a lo ancho a 320, 375 ni 414 px, en Firefox y en Chromium (`docs/16 §54`) |
| P3 Ficha | RF-33, RF-49, HU-21 | Tramo 3 (Etapa 3); prueba con navegador real el 16/10 | `banco.sh navegador` (Firefox con Playwright): los puntos del gráfico (texto y `data-puntos`) son los de `/historico`; una trama publicada por MQTT aparece en su tarjeta sin recargar; con el backend detenido se ve «reconectando», se publica una lectura durante la caída y, al volver, la tarjeta la muestra, la página repite el histórico (se ve la petición) y el canal vuelve a «conectado»; sin errores de JavaScript; la captura revisa lo que se dibuja en el lienzo (eje en 24 h); RF-52 en `banco.sh navegador`: la página no se desplaza a lo ancho a 320, 375 ni 414 px, en Firefox y en Chromium (`docs/16 §54`) |
| P2 y P3, incremento 1: vista en la URL, rango vacío, intervalo observado, reloj de pasarela, «en vivo» con prueba | RF-33, RF-47, RF-49, HU-20, HU-21 | Etapa 3 (22/10/2026) | `docs/16 §50`: 23 pruebas nuevas del panel por el DOM y de funciones puras (ida y vuelta URL ↔ estado en P2 y P3 con valor inválido y `hashchange` externo, texto y botón del rango vacío y su ausencia con puntos, el intervalo con sus dos avisos y el nulo, la alerta del reloj que aparece y se va sin recargar, «conectado, sin lecturas») y 4 del backend (contrato de `intervalo_observado_s`, `openapi.json` regenerado); la mediana, contrastada en la base de desarrollo; el paquete servido, con `pruebas/panel-desarrollo.sh` |
| P3 y P2, incremento 2: leyenda informativa, cambio de rango sin blanco, hora del sitio, resolución elegible, comparación entre nodos (P3b), resumen y CSV del rango | RF-33, RF-34, RF-47, RF-49, HU-20, HU-21 | Etapa 3 (22/10/2026) | `docs/16 §52`: con navegador real (29 comprobaciones en Firefox y en Chromium; contra el build anterior, 9 fallan), los clics de leyenda, rango, resolución, «Ver la última medición» y canal dejan la ficha en su URL con puntos o con el mensaje de vacío; el aviso de zona con el contexto del navegador en otra zona; P3b con dos emulados; por el DOM y funciones puras (26 pruebas nuevas del panel): resoluciones por rango, desfase, alineación, URL de P3b; 2 del backend (tope de 5 000 cubos); medición rango × resolución antes y después |
| P4 Condiciones, P5 Cuarentena | HU-05, RF-11 a RF-13, RF-24, RF-57, TT-42 | Etapa 4 | Trama fuera de rango → fila en P4 en vivo; trama de un desconocido → fila en P5 con motivo `no_registrado`; paginación: una fila nueva entre dos páginas no se repite ni se pierde (`docs/10 §8.4` punto 58) |
| P1 Resumen (tablero) | RF-30, HU-16, TT-44 | Etapa 4 (HU-16 en la iteración 0; el rediseño en la 1) | Los conteos por estado suman el total del inventario; cambian en vivo con F3; la comparativa escrita con sus fuentes antes del código; zoom, rango y varias series con navegador real, a 390 y 1280 px |
| P8 Exportar (API) | RF-34, HU-08 | Etapa 3 (12/10): 6 pruebas de las funciones puras y 7 casos de humo; la pantalla, el XLSX y la exportación por sitio, en la Etapa 4 | Funciones puras y humo de la API (`docs/16 §19`) |
| P8 Exportar un sitio (pantalla) | RF-34, RF-31, RF-41, HU-08 | Etapa 4, iteración 1 (diseñada el 19/11/2026, §4, R; backend y pantalla el mismo día) | Backend: `docs/16 §89` (unitarias, `exportar-integracion.sh` con 0 diferencias en los tres formatos, `sesion-smoke`, cupo, corte y banco). Panel (`docs/16 §89`, apartado del panel): por el DOM, 17 casos en `Exportar.test.ts` (estimación al abrir y por rango, tras una pausa y no por tecla, una a la vez con la anterior cancelada, la respuesta vieja de otro rango y de otro sitio descartada, el cupo lleno con un solo reintento y su aviso con «Reintentar», el 503, «Entre fechas» en la zona del sitio con sus errores junto a los campos, sin filas, la estimación que falla con «Reintentar», la descarga de los tres formatos con su nombre, la confirmación sobre 250 MB, «Cancelar», el 429 del cupo, sin red y el corte a mitad, salir de la pantalla y la ruta sin la acción; el 429 reconocido por su código, no por el texto), 15 de funciones puras en `lib/exportar.test.ts` (los cinco rangos, el cambio de hora, textos, retención, umbral y avisos), y el menú, la ruta, el enlace de la ficha, `nombreDeArchivo` con `.zip` y `.xlsx` y el `Accept` en `App`, `Ficha`, `vista` y `api`; con navegador real, `pruebas/panel-exportar-e2e.sh` (`e2e/exportar.mjs`): 76 de 76 en Chromium y Firefox a 390 y 1 280 px (de la ficha a la pantalla, la estimación de lo sembrado, los tres formatos con su nombre, el zip y el xlsx con la firma `PK\x03\x04`, el JSON con sus conteos, «Entre fechas» en la hora del sitio con el navegador en otra zona, sin desplazamiento horizontal). Pendiente: abrir los archivos en Excel o Google Sheets y en LibreOffice (punto 7) |
| P10 Sesión y usuarios | HU-18, RF-43, RF-44 (los cinco perfiles: HU-26, iteración 0) | Etapa 4 (08/11/2026) | `docs/16 §59`: por el DOM (vitest) el cliente HTTP (cabecera, 401, 403 temporal, 409, 429, sin red, gana la última, descarga por Blob), la guía de perfiles contra la matriz y contra las acciones del servidor, las reglas de la clave contra los números del servidor, los componentes y los flujos de entrar, cambiar, vencer, renovar y salir; con navegador real (paso 4c del guardián, `pruebas/panel-sesion-e2e.sh`) en Chromium y Firefox, a 390 y 1280 px |
| P11 Legal y acerca de | RF-53, RF-54, RF-61, HU-27, HU-31 | Etapa 4, iteración 0 | Sesión sin aceptar: 403 en una lectura y 200 en las páginas legales; aceptar la normaliza; subir la versión la restringe otra vez (`docs/20 §12`); ningún aviso de terceros falta frente a las dependencias de producción (verificador). Panel (`docs/16 §64`): por el DOM, privacidad, términos y acerca de como texto (un `<script>` del servidor queda como texto), soporte con su 429 en segundos, la pantalla de términos sin ningún dato ni canal hasta aceptar y el 403 `terminos_pendientes` de cualquier lectura que la abre; con navegador real, legal antes de entrar y la aceptación tras el primer ingreso |
| P12 Estado del sistema | RF-59, RF-60, RNF-19, HU-30 | Etapa 4, iteración 1 | Solo el administrador del sistema la ve (403 a los demás, `docs/20 §6`); un error plantado con un correo aparece agrupado y sin el correo; un servicio cerca de su techo abre `memoria_alta`; un límite cambiado con dos ediciones a la vez da 409 a la segunda |
| P13 Preferencias | RF-55, RF-56, HU-28, HU-29 | Etapa 4, iteración 1 (la baja, en la 0) | Una medición guardada en °C se muestra en °F con su unidad y la base no cambia; la zona propia cambia las horas visibles y el aviso; la baja deja `usuario` sin nombre ni correo (`docs/20 §11`). Panel (`docs/16 §64`): por el DOM, optimista y reversible (un 409 vuelve atrás con el aviso), el permiso de notificar pedido al marcar, sesiones, vistas y la baja con clave; con navegador real, °F en la ficha con la base en °C. Pendiente: la zona propia en las horas visibles |
| P1 Tablero v2 | RF-30, HU-07, HU-15, HU-16, TT-44 | Etapa 4, iteración 1 (diseñado el 11/11/2026) | Los indicadores suman el inventario y cambian en vivo con F3; el resumen y el histórico del sitio medidos con la serie de 30 días del banco (como `docs/16 §52`); zoom, rango a medida y varias series con navegador real a 390 y 1 280 px; colores de series validados antes del código (§4 tablero v2, A3) |
| P1 Tablero v3 (armazón, pestañas, «Ahora», gráficas vivas) | RF-30, RF-52, RF-58, HU-07, HU-15, HU-16, TT-44 | Etapa 4, iteración 1 (diseñado y construido el 13/11/2026) | `docs/16 §67`: por el DOM, dos pedidos al entrar, la franja con enlaces por rótulo y cifra, «Ahora» vivo sin pedir nada por cada trama, el resumen como mucho una vez por minuto, `sitio_id`, «Pausar»/«Reanudar» (tablero y ficha), refresco solo en 1 h y 24 h con la ventana alineada, puntos y eje de enteros, la etiqueta flotante, el menú contraído, el cajón y el tema por un solo escritor; con navegador real (paso 4c), el cajón con el teclado, el menú contraído con sus nombres, el tema que alterna y el alto de la pestaña Resumen a 390 × 844 con la semilla completa, sin desplazamiento horizontal en ninguna pestaña |
| P2 y P3 v2 | RF-33, RF-47, RF-49, RF-57, HU-07, TT-42 | Etapa 4, iteración 1 | El estado visual del servidor coincide con `estadoVisual()` fila por fila; paginación con total en la cabecera; un zoom cambia la resolución y la URL; banda mín–máx; umbrales y condiciones dibujados; tramas rechazadas agrupadas con «× N»; unidades según la preferencia con ida y vuelta exacta |
| P6 Configurar | HU-06, HU-13, RF-14 | Etapa 4, iteración 1 | Validación compartida (plantada: bajo ≥ alto falla en los dos lados); 409 con dos pestañas; retardo de activación: una medición fuera de banda menos tiempo que el retardo no abre condición, más tiempo sí; cada guardado deja un `evento` con la persona. Panel (`docs/16 §64`): los casos de la prueba del servidor repetidos contra la función del panel, el error junto al campo, «Guardando…», el 409 con la hora y «Recargar» sin pisar; con navegador real, la validación en vivo y el 409 con dos pestañas |
| P7 Alta, lote y detectados | HU-22, RF-50, HU-11 | Etapa 4, iteración 1 | Credencial una sola vez; `modo=validar` no crea nada; desde el bloque N (15/11/2026), crear es todo o nada: una fila que no entra o un plan que cambió es 409 `plan_cambio` y no se crea ninguna, y el reintento con la misma llave no duplica (`docs/16 §71`); tope de 500 filas, del cuerpo y límite de tasa plantados; un emisor desconocido aparece en detectados y llega al asistente con su identificador. Panel: por el DOM, 121 válidas en una petición, repetida con la misma llave tras un 502, y los 409 por su `codigo` (`docs/16 §71`; hasta el 15/11, tandas de 50: `docs/16 §64`), 501 filas frenadas en el navegador, detectado → asistente; desde el 16/11/2026, la vista previa en tres pasos (`docs/16 §76`): los tres orígenes dan las mismas filas, las fórmulas salen neutralizadas y lo descargado vuelve a subirse sin cambios, las cinco tarjetas cuentan lo que muestran, «Crear» se desactiva en vuelo; con navegador real, el asistente por HTTP y un lote de 2 válidas y 1 rechazada, y el recorrido de la vista previa a 1 280 y 390 px (`banco.sh lote-navegador`, corrido el 16/11/2026: 24 de 24 en Firefox y en Chromium; faltan los umbrales de tiempo); desde el 19/11/2026 (bloque S), `pruebas/panel-lote-e2e.sh` contra la pila de desarrollo, con el catálogo fijo de 60 escenarios, 500 filas con sus umbrales de tiempo, la creación por HTTP y 0 filas al salir (`docs/16 §90`) |
| P14 Actividad | RF-46, HU-11, HU-26 | Etapa 4, iteración 1 | Un umbral cambiado aparece con la persona que lo cambió; un administrador de un sitio no ve la actividad de otro (404); un cursor de otro sitio no trae nada. Panel (`docs/16 §64`): por el DOM, cursor, filtros en la URL, tarjetas en teléfono y nada para quien no administra; con navegador real, el umbral cambiado en P6 con quien lo cambió (el correo, solo dentro de `usuario{}`; el texto nunca lleva correos) |
| P2 y P3 con «Esperando primera trama» | RF-24, RF-30, HU-19, HU-14 | Etapa 4, iteración 1 (18/11/2026) | `docs/16 §85`: la regla del estado visual contra la base con la misma tabla de casos que el panel (24 casos, bordes incluidos); el supervisor abre a quien nunca reportó solo al vencer el plazo de su sitio, una vez aunque corran dos barridos, y no abre al volver de mantenimiento; pasar a mantenimiento cierra las condiciones abiertas con su evento; la primera trama cierra la condición; el inventario y la ficha lo muestran con su palabra y su entrega «—»; la guía de perfiles nombra `ajustes` (`bash plataforma/pruebas/espera-integracion.sh`) |
| P15 Ajustes del sitio | RF-62, HU-32, §2 (estado «Esperando primera trama») | Etapa 4, iteración 1 (decidida el 18/11/2026, §4, Q) | Sin cambios de ruta: el plazo, el k y el tope ya tienen sus pruebas de API (`docs/16 §85` y §79). Panel (`docs/16 §86`): por el DOM, el plazo con su bloqueo optimista y la relectura del 409, el mismo valor sin petición, el k y el tope mudados desde «Publicar» sin perder prueba alguna, el menú por acción y la línea de lectura de «Publicar»; con navegador real, el k bajado desde esta pantalla y una visita a 390 y 1 280 px |
| P16 Catálogo | TT-12, RF-11, RF-14 | Etapa 4, iteración 1 (diseñada el 20/11/2026, §4, T) | API: la receta sembrada da lo mismo que la decodificación actual (captura real y todos los valores de 8 y 16 bits) y las fallas plantadas de `docs/10 §8.4` punto 69 (xii). Panel: por el DOM, lo del punto 11 del bloque T; con navegador real, en dos navegadores a 390 y 1 280 px |
| P9 Vista pública | RF-62, HU-32, punto 6 | Etapa 4, iteración 1 (`docs/04 §8`, decisión del 13/11/2026; diseño del 16/11/2026 en §4, O) | Sin cuenta: solo los promedios elegidos, sin mínimo ni máximo, y un valor de menos de k dispositivos sale oculto; ninguna otra ruta cambia su respuesta con el token en la cabecera; vencido, revocado, inexistente y mal formado dan la misma respuesta; revocar corta con la respuesta guardada; la vista previa y la vista del visitante dan los mismos números; el token no queda en ningún registro; cada prueba con su falla plantada y, en navegador real, ambas pantallas a 1 280 y 390 px (§4, O, punto 13). Hecho el 17/11/2026: `docs/16 §79` (base, backend y proxy) y §80 (las pantallas: por el DOM y con `pruebas/panel-publico-e2e.sh`, paso 4c, en Chromium y Firefox); la medición, pendiente |

La etapa de cada pantalla es la de su historia en `docs/04`; mover una historia de etapa se decide con sus horas y se cambia
primero allí (y en `docs/18`), nunca aquí. Matriz de acceso ruta × rol (`docs/11 §4`) y las pruebas de 409 con dos ediciones simultáneas |
