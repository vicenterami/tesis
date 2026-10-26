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
| **Alerta** | hay una condición abierta de tipo `umbral`, `bateria`, `manipulacion`, `tope_superado` (manda más de lo que cabe en su hora, `docs/10 §8.4` punto 53) o `reloj_desviado` («Reloj de pasarela desviado»: los datos siguen entrando, pero fechados por la recepción, `docs/10 §8.4` punto 54) | Reporta, pero algo está fuera de lo normal |
| **Normal** | ninguna de las anteriores | Reporta a tiempo y dentro de rango |

`en_linea` lo trae la API, pero el panel lo recalcula con la misma regla (visto dentro de 2 × intervalo esperado) para que cambie
con cada `visto` del canal en vivo y con el paso del tiempo sin volver a pedir el inventario; sin ninguna trama todavía es nulo y el
dispositivo se muestra **Normal** hasta la primera.

El estado nunca se comunica solo por color: lleva su palabra al lado (accesibilidad, y porque los colores se imprimen mal). La
función que lo calcula es una sola, con prueba unitaria por cada fila de la tabla y por el orden entre filas.

## 3. Mapa de pantallas
| # | Pantalla | Qué muestra | Acciones | Datos (ruta real o propuesta) | Requisitos | Cuándo |
|---|---|---|---|---|---|---|
| P1 | **Resumen del sitio** | Conteo por estado visual (los cuatro), condiciones abiertas, últimas tramas rechazadas, estado del servicio | Ir a cada lista filtrada | `GET /dispositivos`, `GET /condiciones?abiertas=true`, `GET /cuarentena?limite=5`, `GET /salud` | RF-30, HU-16 | Etapa 4 (`docs/04`); los conteos por estado ya aparecen en P2 desde la Etapa 3 |
| P2 | **Inventario** | Tabla: estado visual, nombre, identificador físico, vía, zona, última trama (hace cuánto), condiciones abiertas; filtros por estado, sitio (si hay más de uno), zona y vía con conteo | Abrir la ficha; filtrar; buscar por nombre o identificador | `GET /dispositivos` y `GET /condiciones?abiertas=true&limite=500` (el tipo de cada condición abierta decide el estado, §2; filtra el panel: hoy la API no filtra) | Semáforo y tabla: RF-47, RF-48, HU-10, HU-19. Filtros y búsqueda: RF-51, HU-20 (adelantada a la Etapa 3 el 12/10) | Etapa 3, tramo 2 |
| P3 | **Ficha del dispositivo** | Identidad (nombre, identificador, vía, formato, zona, sitio, intervalo esperado, desde cuándo); estado visual; por canal: última lectura con unidad y, si el canal tiene calibración, su porcentaje (`docs/10 §8.4` punto 51), y reglas de umbral; gráfico histórico por canal (rango elegible; la agregación la fija el rango) que sigue en vivo; condiciones abiertas y cerradas del dispositivo; sus tramas rechazadas | Cambiar canal y rango (el intervalo lo fija cada rango); pausar el vivo; ir a configurar (P6) o a mudar (Etapa 4) | `GET /dispositivos/{id}`, `GET /canales/{id}/historico?desde&hasta&intervalo`, `GET /eventos?dispositivo=`, `GET /condiciones?dispositivo=&abiertas=true&limite=500` (todas las abiertas) más `?dispositivo=&limite=50` (las recientes), `GET /cuarentena?dispositivo=&limite=20` | RF-33, RF-49 (identidad, condiciones y serie; su «historial de eventos» queda con la Etapa 4), HU-21 (adelantada a la Etapa 3 el 12/10, con sus 7 h); el rango a medida por fechas es HU-07 (Etapa 4) | Etapa 3, tramo 3 |
| P3b | **Comparar dispositivos** (`#/comparar`; incremento 2) | La misma magnitud de 2 a 6 dispositivos en un gráfico de historia (promedios por cubo; misma ventana y resolución que P3) y, debajo, la tabla en tiempo real con la última lectura, hace cuánto y el estado de cada uno; selector de magnitud; entradas desde las casillas de P2 y el enlace de P3 | Abrir la ficha de cada dispositivo; volver al inventario con las casillas marcadas | `GET /dispositivos/{id}` por dispositivo, `GET /canales/{id}/historico`, `GET /condiciones?abiertas`, `GET /eventos` | — | — |
| P4 | **Condiciones** | Lista con tipo, dispositivo, magnitud y umbral, abierta en, duración; filtro abiertas / todas; al cerrarse, el resumen del episodio, y el reconocimiento con su clasificación (`docs/10 §8.4` punto 49) | Abrir la ficha del dispositivo | `GET /condiciones?abiertas&limite` | HU-05, RF-24 | Etapa 4 (lista sobre lo que la API ya devuelve) |
| P5 | **Cuarentena** | Últimas tramas rechazadas: cuándo, por qué (`no_registrado`, `dado_de_baja`, `malformada`, `invalida`), detalle, dispositivo si se conoce, la trama cruda plegada | Copiar la trama; ir al alta si el motivo es `no_registrado` | `GET /cuarentena?limite` | RF-11 a RF-13 | Etapa 4 (lista sobre lo que la API ya devuelve) |
| P6 | **Configurar dispositivo y canales** | Nombre, estado (activo / mantenimiento), intervalo esperado; por canal, umbral alto, umbral bajo, histéresis | Guardar con bloqueo optimista; validación en vivo (bajo < alto, histéresis dentro de la banda, rango de la magnitud) | **Propuesta:** `PATCH /dispositivos/{id}`, `PUT /canales/{id}/reglas` | HU-06, HU-13, punto 28 | Etapa 4 (exige sesión) |
| P7 | **Alta de dispositivo** (asistente) | Paso 1 identidad y zona; paso 2 vía y formato (y pasarela si LoRaWAN); paso 3 canales y magnitudes; paso 4 credencial según la vía, mostrada una sola vez; paso 5 «esperando la primera trama» en vivo | Crear; copiar la credencial y el tópico | `POST /dispositivos` (API hecha el 12/10, HU-11, `docs/16 §20`; la pantalla en la Etapa 4, HU-22) | RF-50, HU-11, HU-22, punto 25 | API: Etapa 3; pantalla: Etapa 4 |
| P8 | **Exportar** | Dispositivo (hoy) o sitio (Etapa 4), rango, formato (CSV, XLSX, JSON); tamaño estimado antes de descargar | Descargar | Hecho el 12/10 por dispositivo: `GET /dispositivos/{id}/exportar?formato=csv\|json&desde&hasta` (flujo por tandas; CSV estándar con coma y punto decimal para R, Python y QGIS). **Propuesta** para la Etapa 4: `GET /sitios/{id}/exportar` con rol y XLSX | RF-34, HU-08 (adelantada a la Etapa 3 el 12/10) | API: Etapa 3; pantalla, XLSX y por sitio: Etapa 4 |
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
canal elegido: rango (última hora, 24 h, 7 días, 30 días; el rango a medida por fechas es HU-07, Etapa 4), cada uno con un intervalo de
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
   ensuciar el historial del navegador). Un enlace compartido abre la misma vista; «atrás» vuelve a la pantalla anterior. Se toma el
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
persona, rango a medida (HU-07) y la administración de pasarelas (incremento 3).

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
1. **La leyenda informa, no apaga.** Las filas de la leyenda de uPlot dejan de recibir eventos de puntero: el clic no oculta ninguna serie,
   y la leyenda sigue mostrando el valor de cada serie bajo el cursor. Si algún día hace falta ocultar una serie, será un control propio con
   estado visible, nunca un clic silencioso. Prueba con navegador: clic en «promedio» y en «lectura actual» → el número de puntos no cambia y
   ninguna fila de la leyenda queda marcada como apagada.
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
   otra zona muestra el aviso y, fijado en la del sitio, no.
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
medida por fechas (HU-07), tableros guardados por persona, y una serie en miniatura por fila en P2 (una petición por fila: se mide antes).
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
a abrir con espera de 1, 2, 4… hasta 30 s, y muestra «en vivo: reconectando» en la cabecera. Al reconectar, repite todo lo
que la pantalla muestra (inventario y condiciones en P2; ficha, condiciones, rechazadas e histórico del rango visible en P3),
porque pudo perder eventos mientras estuvo caído: el canal no guarda cola.

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
- **Un solo cliente HTTP** en el panel, que añade el prefijo de la API, interpreta los códigos y expone el 409 como tal.
- **Nada se repite por cada evento:** un aviso de condición pide la lista con antirrebote (una consulta por segundo como mucho,
  nunca dos en vuelo) y las lecturas en vivo se aplican por lotes (un redibujo cada 250 ms como mucho). Un dispositivo que
  oscila o un emisor malicioso no multiplican consultas a la base ni redibujos. La ficha descarta eventos de otro dispositivo
  aunque el canal venga filtrado.
- **Rendimiento:** el histórico llega agregado (en resolución «auto», entre 60 y 170 puntos según el rango; con una resolución elegida, hasta 2 500); uPlot dibuja; el vivo añade al final; en P2 la tabla se
  recalcula solo con los eventos recibidos, no repidiendo el inventario cada vez.

## 7. Trazabilidad y prueba de cada pantalla
| Pantalla | Requisitos | Entra en | Cómo se prueba |
|---|---|---|---|
| P2 Inventario con semáforo y filtros | RF-47, RF-48, RF-51, HU-10, HU-19, HU-20 | Tramo 2 (Etapa 3) | Semilla conocida → conteos y filas en el DOM; un dispositivo en mantenimiento aparece «Inactivo»; filtro por vía reduce la tabla; el reenvío de Vite conserva el `Host` y no retiene el canal (`pruebas/panel-desarrollo.sh`, `docs/16 §16`); varios sitios: dos sitios con una zona del mismo nombre, el filtro por sitio y la zona dentro del sitio (16/10); RF-52 en `banco.sh navegador`: la página no se desplaza a lo ancho a 320, 375 ni 414 px, en Firefox y en Chromium (`docs/16 §54`) |
| P3 Ficha | RF-33, RF-49, HU-21 | Tramo 3 (Etapa 3); prueba con navegador real el 16/10 | `banco.sh navegador` (Firefox con Playwright): los puntos del gráfico (texto y `data-puntos`) son los de `/historico`; una trama publicada por MQTT aparece en su tarjeta sin recargar; con el backend detenido se ve «reconectando», se publica una lectura durante la caída y, al volver, la tarjeta la muestra, la página repite el histórico (se ve la petición) y el canal vuelve a «conectado»; sin errores de JavaScript; la captura revisa lo que se dibuja en el lienzo (eje en 24 h); RF-52 en `banco.sh navegador`: la página no se desplaza a lo ancho a 320, 375 ni 414 px, en Firefox y en Chromium (`docs/16 §54`) |
| P2 y P3, incremento 1: vista en la URL, rango vacío, intervalo observado, reloj de pasarela, «en vivo» con prueba | RF-33, RF-47, RF-49, HU-20, HU-21 | Etapa 3 (22/10/2026) | `docs/16 §50`: 23 pruebas nuevas del panel por el DOM y de funciones puras (ida y vuelta URL ↔ estado en P2 y P3 con valor inválido y `hashchange` externo, texto y botón del rango vacío y su ausencia con puntos, el intervalo con sus dos avisos y el nulo, la alerta del reloj que aparece y se va sin recargar, «conectado, sin lecturas») y 4 del backend (contrato de `intervalo_observado_s`, `openapi.json` regenerado); la mediana, contrastada en la base de desarrollo; el paquete servido, con `pruebas/panel-desarrollo.sh` |
| P3 y P2, incremento 2: leyenda informativa, cambio de rango sin blanco, hora del sitio, resolución elegible, comparación entre nodos (P3b), resumen y CSV del rango | RF-33, RF-34, RF-47, RF-49, HU-20, HU-21 | Etapa 3 (22/10/2026) | `docs/16 §52`: con navegador real (29 comprobaciones en Firefox y en Chromium; contra el build anterior, 9 fallan), los clics de leyenda, rango, resolución, «Ver la última medición» y canal dejan la ficha en su URL con puntos o con el mensaje de vacío; el aviso de zona con el contexto del navegador en otra zona; P3b con dos emulados; por el DOM y funciones puras (26 pruebas nuevas del panel): resoluciones por rango, desfase, alineación, URL de P3b; 2 del backend (tope de 5 000 cubos); medición rango × resolución antes y después |
| P4 Condiciones, P5 Cuarentena | HU-05, RF-11 a RF-13, RF-24 | Etapa 4 | Trama fuera de rango → fila en P4 en vivo; trama de un desconocido → fila en P5 con motivo `no_registrado` |
| P1 Resumen | RF-30, HU-16 | Etapa 4 | Los cuatro conteos suman el total del inventario; cambian en vivo con F3 |
| P8 Exportar (API) | RF-34, HU-08 | Etapa 3 (12/10): 6 pruebas de las funciones puras y 7 casos de humo; la pantalla, el XLSX y la exportación por sitio, en la Etapa 4 |
| P6, P7, P9, P10 | HU-06, HU-11, HU-13, HU-18, HU-22; RF-43, RF-44, RF-50 | Etapa 4 |

La etapa de cada pantalla es la de su historia en `docs/04`; mover una historia de etapa se decide con sus horas y se cambia
primero allí (y en `docs/18`), nunca aquí. Matriz de acceso ruta × rol (`docs/11 §4`) y las pruebas de 409 con dos ediciones simultáneas |
