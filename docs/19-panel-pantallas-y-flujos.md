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
es exactamente lo que piden RF-30, RF-47 y RF-48. Se adopta como **regla de presentación**, calculada en el servidor (en SQL, para filtrar y paginar, desde el 11/11/2026) y en el panel (para actualizar en vivo) a partir de
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
| P1 | **Resumen del sitio (tablero)** | En tres pestañas desde el 13/11/2026 (§4, bloque L): **Resumen** (conteo por estado visual, salud del sitio, «Ahora» por magnitud y por dispositivo, «Requiere atención» y condiciones abiertas por tipo), **Tendencias** (una gráfica por magnitud) y **Red** (tramas recibidas y rechazadas, y entrega por dispositivo); rediseñado en la Etapa 4 después de una comparativa de referentes y de WCAG 2.2 (§4). El estado del servicio pasó a «Legal y acerca de» (L1d) | Ir a cada lista filtrada; cambiar de pestaña y, en Tendencias y Red, de rango; pausar; abrir P3b desde una magnitud | `GET /sitios`, `GET /sitios/{id}/resumen`, `GET /sitios/{id}/ahora`, `GET /sitios/{id}/historico` (Etapa 4), diseños del 11/11/2026 (§4 tablero v2) y del 13/11/2026 (bloque L) | RF-30, HU-15, HU-16, HU-07, TT-44 | Etapa 4 (`docs/04`); los conteos por estado ya aparecen en P2 desde la Etapa 3; diseñado el 11/11/2026 y el 13/11/2026, iteración 1 |
| P2 | **Inventario** | Tabla: estado visual, nombre, identificador físico, vía, zona, última trama (hace cuánto), condiciones abiertas; filtros por estado, sitio (si hay más de uno), zona y vía con conteo | Abrir la ficha; filtrar; buscar por nombre o identificador | `GET /dispositivos` y `GET /condiciones?abiertas=true&limite=500` (el tipo de cada condición abierta decide el estado, §2; desde el 11/11/2026 la API filtra, ordena y pagina, y el panel recalcula en vivo) | Semáforo y tabla: RF-47, RF-48, HU-10, HU-19. Filtros y búsqueda: RF-51, HU-20 (adelantada a la Etapa 3 el 12/10) | Etapa 3, tramo 2 |
| P3 | **Ficha del dispositivo** | Identidad (nombre, identificador, vía, formato, zona, sitio, intervalo esperado, desde cuándo); estado visual; por canal: última lectura con unidad y, si el canal tiene calibración, su porcentaje (`docs/10 §8.4` punto 51), y reglas de umbral; gráfico histórico por canal (rango elegible; la agregación la fija el rango) que sigue en vivo; condiciones abiertas y cerradas del dispositivo; sus tramas rechazadas | Cambiar canal y rango (el intervalo lo fija cada rango); pausar el vivo; ir a configurar (P6) o a mudar (Etapa 4) | `GET /dispositivos/{id}`, `GET /canales/{id}/historico?desde&hasta&intervalo`, `GET /eventos?dispositivo=`, `GET /condiciones?dispositivo=&abiertas=true&limite=500` (todas las abiertas) más `?dispositivo=&limite=50` (las recientes), `GET /cuarentena?dispositivo=&limite=20` | RF-33, RF-49 (identidad, condiciones y serie; su «historial de eventos» queda con la Etapa 4), HU-21 (adelantada a la Etapa 3 el 12/10, con sus 7 h); el rango a medida por fechas es HU-07 (Etapa 4) | Etapa 3, tramo 3 |
| P3b | **Comparar dispositivos** (`#/comparar`; incremento 2) | La misma magnitud de 2 a 6 dispositivos en un gráfico de historia (promedios por cubo; misma ventana y resolución que P3) y, debajo, la tabla en tiempo real con la última lectura, hace cuánto y el estado de cada uno; selector de magnitud; entradas desde las casillas de P2 y el enlace de P3 | Abrir la ficha de cada dispositivo; volver al inventario con las casillas marcadas | `GET /dispositivos/{id}` por dispositivo, `GET /canales/{id}/historico`, `GET /condiciones?abiertas`, `GET /eventos` | — | — |
| P4 | **Condiciones** | Lista con tipo, dispositivo, magnitud y umbral, abierta en, duración; filtro abiertas / todas; al cerrarse, el resumen del episodio, y el reconocimiento con su clasificación (`docs/10 §8.4` punto 49) | Abrir la ficha del dispositivo | `GET /condiciones?abiertas&limite` | HU-05, RF-24 | Etapa 4 (lista sobre lo que la API ya devuelve) |
| P5 | **Cuarentena** | Últimas tramas rechazadas: cuándo, por qué (`no_registrado`, `dado_de_baja`, `malformada`, `invalida`), detalle, dispositivo si se conoce, la trama cruda plegada | Copiar la trama; ir al alta si el motivo es `no_registrado` | `GET /cuarentena?limite` | RF-11 a RF-13 | Etapa 4 (lista sobre lo que la API ya devuelve) |
| P6 | **Configurar dispositivo y canales** | Nombre, estado (activo / mantenimiento), intervalo esperado, zona; por canal, etiqueta, umbral alto, umbral bajo, histéresis y retardo de activación | Guardar con bloqueo optimista; validación en vivo (bajo < alto, histéresis dentro de la banda, rango de la magnitud) | `PATCH /dispositivos/{id}`, `PUT /canales/{id}/reglas` (Etapa 4), fijadas el 11/11/2026 (§4 tablero v2, E) | HU-06, HU-13, RF-14, punto 28 | Etapa 4, iteración 1 (exige sesión) |
| P7 | **Alta de dispositivo** (asistente) | Paso 1 identidad y zona; paso 2 vía y formato (y pasarela si LoRaWAN); paso 3 canales y magnitudes; paso 4 credencial según la vía, mostrada una sola vez; paso 5 «esperando la primera trama» en vivo | Crear; copiar la credencial y el tópico; subir un CSV, validarlo y crear las filas válidas; dar de alta un emisor detectado | `POST /dispositivos` (API hecha el 12/10, HU-11, `docs/16 §20`); `POST /dispositivos/lote?modo=validar\|crear` y `GET /cuarentena/detectados` (Etapa 4), fijadas el 11/11/2026 (§4 tablero v2, F) | RF-50, HU-11, HU-22, punto 25 | API: Etapa 3; pantalla, lote y detectados: Etapa 4, iteración 1 |
| P8 | **Exportar** | Dispositivo (hoy) o sitio (Etapa 4), rango, formato (CSV, XLSX, JSON); tamaño estimado antes de descargar | Descargar | Hecho el 12/10 por dispositivo: `GET /dispositivos/{id}/exportar?formato=csv\|json&desde&hasta` (flujo por tandas; CSV estándar con coma y punto decimal para R, Python y QGIS). **Propuesta** para la Etapa 4: `GET /sitios/{id}/exportar` con rol y XLSX | RF-34, HU-08 (adelantada a la Etapa 3 el 12/10) | API: Etapa 3; pantalla, XLSX y por sitio: Etapa 4 |
| P9 | **Vista pública por enlace** | Solo lo que el administrador eligió: magnitudes agregadas, sin trama cruda ni identificadores | Ninguna | **Propuesta:** `GET /publico/{token}` | punto 6 | Etapa 4 |
| P10 | **Sesión y usuarios** | Entrar, cambio de la clave temporal, salir; quién soy en la cabecera; usuarios de mis sitios, su perfil por sitio y la guía de perfiles (cinco desde el 08/11/2026, diseño: `docs/20 §6`) | Entrar, cambiar la clave, salir o cerrar en todos lados; dar de alta (clave temporal una vez), activar y desactivar, asignar una temporal, cambiar el rol | `POST /sesion`, `GET /sesion`, `DELETE /sesion`, `POST /sesion/clave`, `GET /usuarios`, `POST /usuarios`, `PATCH /usuarios/{id}` (`docs/20`) | RF-43, RF-44, HU-18 | Etapa 4; hecha el 08/11/2026 (§4) |
| P11 | **Legal y acerca de** (Etapa 4) | Privacidad (generada desde `docs/21`), términos de uso con su versión, avisos de terceros, versión y commit, aviso AGPL; soporte: contacto del responsable y formulario | Leer; aceptar los términos (obligatorio al primer ingreso y al cambiar la versión); enviar un mensaje de soporte | `GET /terminos`, `POST /terminos/aceptar`, `GET /privacidad`, `GET /acerca` (versión y commit solo con sesión), `POST /soporte` y `GET /soporte` (Etapa 4); los avisos de terceros, un archivo generado al cambiar dependencias | RF-53, RF-54, RF-61, HU-27, HU-31 | Iteración 0; hecha el 11/11/2026 |
| P12 | **Estado del sistema** (solo administrador del sistema; Etapa 4) | Recursos por contenedor en el tiempo (memoria frente a su techo, CPU), errores agrupados por huella, último respaldo y su antigüedad, condiciones del sistema abiertas; límites de los servicios | Ver el detalle de un error; ajustar un límite con bloqueo optimista | `GET /salud` y rutas nuevas sobre `metrica_recurso`, `error_sistema` y los límites (Etapa 4; `docs/10 §8.4` puntos 60 y 61) | RF-59, RF-60, RNF-19, HU-30 | Iteración 1 |
| P13 | **Preferencias** (mi cuenta; Etapa 4) | Unidades de visualización (°C o °F; mm, m o km), zona horaria propia o la del sitio, vistas guardadas; mis datos y mis sesiones abiertas (por decidir: sin fila en el backlog) y la versión de términos aceptada; darme de baja | Guardar; exportar mis datos de cuenta; cerrar una sesión; darme de baja (con la clave actual) | `GET`/`PUT /preferencias`, `GET /sesiones`, `DELETE /sesiones/{id}` (Etapa 4), fijadas el 11/11/2026 (§4 tablero v2, H); la baja, `docs/20 §11` | RF-55, RF-56, HU-28, HU-29 | Iteración 1 (la baja, en la 0) |
| P14 | **Actividad** (administrador de sitio en sus sitios; el del sistema en todos; diseñada el 11/11/2026) | Lo que hicieron las personas en el sitio (eventos con quién, de `evento.usuario_id`) y sus entradas, salidas y bloqueos (`acceso`), con filtros por persona, tipo y rango, en texto para personas | Filtrar; abrir la ficha del dispositivo o la persona | `GET /sitios/{id}/actividad?desde&hasta&tipo&usuario&cursor` (Etapa 4) (§4 tablero v2, G) | RF-46, HU-11, HU-26 | Iteración 1 |

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
hoy no hace falta). El estado del servicio muestra `GET /salud` y si el canal en vivo está conectado.

**P1 rediseñado: tablero y gráficas, con una comparativa antes (Etapa 4, iteración 1; TT-44).** Antes de dibujarlo, una comparativa
escrita de cómo resuelven el tablero ThingsBoard CE, OpenRemote, Magistrala y Milesight IoT Cloud (zoom y rango, varias series, agregados,
lectura en pantallas angostas) y de lo que pide WCAG 2.2 (contraste, foco visible, tamaño de los objetivos táctiles, información que no
depende solo del color), **cada afirmación con su cita de la fuente oficial**; lo que una fuente no declara se escribe «no declarado», no
como ausencia (la misma regla del incremento 1). Con eso: el tablero del sitio (los cuatro conteos de §2, condiciones abiertas, salud del
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

**P13 Preferencias (Etapa 4, iteración 1; HU-29, HU-28).** ✅ panel, 11/11/2026 (salvo la zona horaria propia aplicada a las horas visibles: la preferencia se guarda y las pantallas siguen en la zona del sitio; pendiente). Unidades de visualización (temperatura en °C o °F; longitudes en mm, m o km):
la base guarda siempre la unidad estándar del catálogo y la conversión ocurre solo al mostrar, con la unidad escrita al lado de cada
valor; zona horaria: la del sitio (por defecto, `docs/13`) o la propia, dicha en la cabecera como hoy el aviso de zona (incremento 2,
punto 3); vistas guardadas (filtros de P2, rango y resolución de P3), guardadas en la base y no en el navegador (`docs/21 §4`). En «Mi
cuenta»: nombre, correo, sitios y perfiles, sesiones abiertas (con «cerrar»), versión de términos aceptada, exportar mis datos de cuenta y
«Darme de baja», que explica qué se borra y qué queda (`docs/20 §11`) y pide la clave actual.

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
   secundario, borde, acento (`#0b3954`, el de hoy), los cuatro estados (los de hoy: todos entre 6,6:1 y 8:1 de contraste, medidos el
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
   en un gráfico: dos magnitudes distintas son dos gráficos alineados en el tiempo. Series de estado (los cuatro colores de §2) nunca se
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
2. **Fila de indicadores** *(desde L2a, la ficha entera es el enlace y «Tramas» va en la misma franja)* ✅ panel, 11/11/2026; ✅ backend, 11/11/2026 (los cuatro estados de §2 más el total; «en línea», en la tarjeta de salud) (tarjetas de valor, no gráficos de una barra): Dispositivos (total) · Normal · Alerta · Sin señal ·
   Inactivos (los cuatro suman el total; «en línea» va en la tarjeta de salud), cada una un botón que abre el inventario filtrado (como hoy las fichas de conteo); **Salud del sitio** = en línea ÷ (total
   − inactivos), en porcentaje con un medidor de una sola rampa y en texto («14 de 16 reportan»), que es el indicador agregado de RF-30;
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
   quién lo hizo cuando hubo persona (HU-11, G1).
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
(webhook) queda diseñado para la iteración 2.

**F. P7 Alta: asistente, alta masiva y bandeja de detectados (HU-22, RF-50; decididas el 25/10/2026).**
1. **Asistente** ✅ panel, 11/11/2026 (`#/alta`; sin el perfil de decodificación, que sigue por API) de cinco pasos (§3): identidad y zona; vía y formato (pasarela si LoRaWAN; perfil de decodificación si lo hay); canales
   y magnitudes del catálogo; credencial mostrada una sola vez con «Copiar» y el tópico; «esperando la primera trama» en vivo. Un
   identificador que ya existe inactivo ofrece reactivarlo (409 con la ficha), no crea un duplicado. Construido así (11/11/2026): cada
   paso con su encabezado «Paso N de 5», que recibe el foco al cambiar de paso, y los errores del paso 1 ligados a cada campo; la magnitud
   se escribe por su **código** del catálogo (el selector del catálogo queda pendiente); la hora de la primera trama va en la zona del
   sitio (la **zona propia** de P13 se guarda y aún no se aplica); un identificador que ya existe responde 409 y remite al inventario (la
   reactivación desde el asistente queda pendiente).
2. **Alta masiva por archivo:** ✅ backend, 11/11/2026 (la ruta y su informe); ✅ panel, 11/11/2026 (`#/alta?modo=lote`: el CSV se lee en el navegador, `modo=validar` completo, `modo=crear` en tandas de 50 con «creadas N de M»; las credenciales no se dibujan: se descargan una vez y «Ya las guardé: olvidarlas» las saca de la memoria; «Descargar rechazadas» agrega la columna `motivo`, que el lector ignora al volver a subir; decidido al implementar). Límite que se cruza: 500 filas son una validación y 10 tandas, y el servidor admite 10 lotes por minuto por persona, así que la última tanda recibe 429 y queda como «Reintentar las restantes» con la espera escrita; un CSV con cabecera fija (`id_fisico, nombre, zona, via, formato, intervalo_esperado_s, canales,
   pasarela`; `canales` como `magnitud:unidad;magnitud:unidad`) de hasta 500 filas se envía a `POST /dispositivos/lote?modo=validar` (Etapa 4) y
   la pantalla muestra el informe fila por fila (válida / rechazada con motivo / ya existe) **antes** de crear nada; con «Crear las
   válidas», `modo=crear` inserta en una sola transacción (una sentencia para los dispositivos y otra para sus eventos, no N inserciones; el panel manda tandas de 50, `docs/16 §61`), devuelve el mismo informe con las credenciales
   de las creadas **una sola vez**, y la pantalla ofrece «Descargar credenciales (CSV)» por el ayudante `descargar` de §6 y «Descargar
   rechazadas» para corregir y volver a subir. Las filas rechazadas no bloquean a las válidas; el informe lo dice. Límite de tasa y de
   tamaño en `docs/11 §4`.
3. **Bandeja de detectados (Etapa 4):** ✅ backend, 11/11/2026; ✅ panel, 11/11/2026 (`#/alta?modo=detectados`); `GET /cuarentena/detectados?sitio` agrupa las tramas rechazadas por `no_registrado` de los últimos 7 días
   por emisor (identificador o tópico), con cuántas y la última; cada fila lleva al asistente con el identificador ya escrito. Es la
   forma de dar de alta «lo que ya está hablando».

**G. Actividad y quién lo hizo (P14, nueva; HU-11, RF-46, HU-26).** ✅ backend, 11/11/2026 (`docs/20 §10` R29).
1. ✅ backend, 11/11/2026 (columna y su uso en las escrituras; usuarios, aún con su detalle). `evento` gana `usuario_id` (nulo para lo que hace el sistema): toda escritura con sesión lo deja (alta, baja, mantenimiento,
   umbrales, calibración, credenciales, usuarios), y `GET /dispositivos/{id}` y la ficha muestran «registrado por N». «Registrado por N» solo
   para administradores: el nombre lo reciben el administrador de ese sitio y el del sistema; los demás perfiles, `usuario: null`
   (`docs/21 §2`; decidido el 11/11/2026).
2. **P14 Actividad** ✅ panel, 11/11/2026 (el menú, según la acción `auditoria` de la matriz del servidor; la persona y el tipo del filtro salen de `GET /usuarios` y de los tipos recibidos) (`#/actividad`; administrador de sitio en sus sitios, administrador del sistema en todos): una lista por cursor que
   mezcla `evento` (con persona y dispositivo) y `acceso` (entradas, salidas y bloqueos de las personas de esos sitios), con filtros por
   persona, tipo y rango, y texto para personas («cambió los umbrales de Humedad del invernadero»); de
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
| `GET /dispositivos` | filtros `sitio, zona, via, estado, q` (`sitio` y `zona` son ids; el panel traduce el código de su URL con `GET /sitios`), `orden` (`nombre` por defecto, `entrega` de peor a mejor con los nulos al final, o `atencion`: sin señal, alerta, normal, inactivo y dentro por nombre) y paginación `limite, desplazamiento`; `estado_visual` y `entrega` (sobre las últimas 24 h; nulo si el dispositivo no está activo o si en la ventana no cabe una trama esperada completa; 0 % si esperaba y no llegó nada) por fila; total en `X-Total` | como hoy |
| `GET /dispositivos/{id}/eventos?desde&hasta&cursor` · `GET /condiciones` · `GET /cuarentena` · `GET /sitios/{id}/actividad` | keyset (`docs/10 §8.4` punto 58): el cursor de la página siguiente en la cabecera `X-Siguiente`; el cuerpo sigue siendo la lista; `GET /condiciones` admite además `desde` y `hasta` (las franjas del gráfico de la ficha; con 500 filas el panel avisa que muestra las más recientes) | según la ruta (Etapa 4) |
| `GET /cuarentena/detectados?sitio` | emisores no registrados de los últimos 7 días: identificador o tópico, cuántas tramas, última | administrador de sitio hoy; operador técnico cuando exista el perfil (Etapa 4) |
| `PATCH /dispositivos/{id}` | nombre, estado, intervalo esperado, zona; `actualizado_en` obligatorio; 409 si cambió | administrador de sitio hoy; operador técnico cuando exista el perfil (Etapa 4) |
| `PUT /canales/{id}/reglas` | reemplaza las reglas del canal (alto, bajo, histéresis, retardo); `actualizado_en`; 409 | administrador de sitio hoy; operador técnico cuando exista el perfil (Etapa 4) |
| `POST /dispositivos/lote?modo=validar\|crear` | informe fila por fila; en `crear`, las credenciales una sola vez | administrador de sitio hoy; operador técnico cuando exista el perfil (Etapa 4) |
| `GET /preferencias` · `PUT /preferencias` | las propias; bloqueo optimista | con sesión (Etapa 4) |
| `GET /sesiones` · `DELETE /sesiones/{id}` | las propias | con sesión (Etapa 4) |
Compatibilidad: ninguna respuesta cambia de forma (los totales y los cursores van en cabeceras; los campos nuevos se suman); el OpenAPI se
regenera y el paso 4b del guardián suma una fila por ruta y perfil. **Campos** (los nombres son los de las columnas, como en todo el
panel; el OpenAPI generado es la fuente una vez construido): `/sitios` → `id, codigo, nombre, zona_horaria, rol, zonas[{id, nombre}]`;
`/sitios/{id}/resumen` → `sitio, ventana{desde, hasta, intervalo}, dispositivos{total, normal, alerta, sin_senal, inactivo}, salud{reportan,
supervisados, porcentaje}, condiciones_abiertas[{tipo, n}], tramas{recibidas, rechazadas, cubos[{tiempo, recibidas, rechazadas}]},
atencion[{id, nombre, estado_visual, visto_por_ultima_vez, tipos}], magnitudes[{codigo, nombre, unidad, canales}], entrega[{id, nombre,
recibidas, esperadas, porcentaje}]` (los 50 peores), `total_activos`; `/sitios/{id}/ahora` → `reportan, sin_senal, por_magnitud[{codigo,
nombre, unidad, salud, canales, promedio, minimo, maximo}], dispositivos[{id, nombre, zona, estado_visual, visto_por_ultima_vez,
intervalo_esperado_s, canales_total, canales[{id, magnitud, magnitud_nombre, unidad, salud, ultima{valor, tiempo, porcentaje}|null,
chispa?}]}], tendencia, chispa?{desde, intervalo, puntos}` (las `chispa`, solo con `tendencia: true`; L6); `/sitios/{id}/historico` → la forma de `Historico` más `minimos, maximos, n` y `magnitud, unidad`;
`/canales/{id}/historico` → `minimos, maximos` además de lo de hoy; `/dispositivos/{id}/historico` → `tiempos, canales[{id, magnitud,
magnitud_nombre, unidad, valores, minimos, maximos, muestras}]`; cada fila de `/dispositivos` suma `estado_visual` y `entrega`;
`/dispositivos/{id}/eventos` → `id, tipo, detalle, ocurrido_en, usuario{id, nombre}|null`; `/cuarentena/detectados` → `sitio_codigo, emisor, topico,
tramas, ultima` (una fila por sitio y emisor); `PATCH /dispositivos/{id}` (Etapa 4) recibe `actualizado_en` y los campos que cambian, y responde la ficha o 409 con el
`actualizado_en` vigente; `PUT /canales/{id}/reglas` (Etapa 4) recibe `actualizado_en, etiqueta, reglas[{id?, umbral_alto, umbral_bajo, histeresis,
retardo_s}]` (con `id`, cambia esa regla; sin `id`, una nueva; las que no vienen se quitan: decidido el 11/11/2026); `POST /dispositivos/lote` (Etapa 4) recibe `filas[{id_fisico, nombre, zona, via, formato, intervalo_esperado_s, canales, pasarela}]`
(el panel convierte el CSV) y responde `validas, rechazadas, existentes, filas[{n, id_fisico, resultado, motivo, id, credencial, topico}]`
con `resultado` en `valida | creada | rechazada | existe`; `/preferencias` → `unidad_temperatura (C|F), unidad_longitud (mm|m|km),
zona_horaria (sitio|IANA), tema (sistema|claro|oscuro), notificar[tipos], vistas[{nombre, pantalla, parametros}], sitio_predeterminado,
actualizado_en`, con `parametros` un objeto texto → texto en el panel y en el servidor (la ruta del panel que abre la vista va en `ruta`,
`{ruta: '/inventario?estado=alerta'}`; corrección del 11/11/2026: el panel la mandaba como texto y el servidor rechazaba toda vista);
`/sesiones` → `id, creada_en, ultima_actividad, agente, origen, actual`; `/sitios/{id}/actividad?desde&hasta&tipo&usuario&cursor&limite` →
`id, instante, clase (evento|acceso), tipo, texto, usuario{id, nombre}|null, dispositivo{id, nombre}|null`; cada fila de `/condiciones`
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
   Inactivos, Tramas (24 h) y Salud del sitio—; el enlace de cada ficha es su rótulo con su cifra («Sin señal: 5») y su área activa
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
   que el inventario (C); por esa regla, un dispositivo activo que aún no envía nada es Normal y aparece con sus canales en `null` y
   `visto_por_ultima_vez` nulo (es el «esperando la primera trama» de F1). Cada petición hace como mucho tres consultas, tenga el sitio
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
| P1 Resumen (tablero) | RF-30, HU-16, TT-44 | Etapa 4 (HU-16 en la iteración 0; el rediseño en la 1) | Los cuatro conteos suman el total del inventario; cambian en vivo con F3; la comparativa escrita con sus fuentes antes del código; zoom, rango y varias series con navegador real, a 390 y 1280 px |
| P8 Exportar (API) | RF-34, HU-08 | Etapa 3 (12/10): 6 pruebas de las funciones puras y 7 casos de humo; la pantalla, el XLSX y la exportación por sitio, en la Etapa 4 |
| P10 Sesión y usuarios | HU-18, RF-43, RF-44 (los cinco perfiles: HU-26, iteración 0) | Etapa 4 (08/11/2026) | `docs/16 §59`: por el DOM (vitest) el cliente HTTP (cabecera, 401, 403 temporal, 409, 429, sin red, gana la última, descarga por Blob), la guía de perfiles contra la matriz y contra las acciones del servidor, las reglas de la clave contra los números del servidor, los componentes y los flujos de entrar, cambiar, vencer, renovar y salir; con navegador real (paso 4c del guardián, `pruebas/panel-sesion-e2e.sh`) en Chromium y Firefox, a 390 y 1280 px |
| P11 Legal y acerca de | RF-53, RF-54, RF-61, HU-27, HU-31 | Etapa 4, iteración 0 | Sesión sin aceptar: 403 en una lectura y 200 en las páginas legales; aceptar la normaliza; subir la versión la restringe otra vez (`docs/20 §12`); ningún aviso de terceros falta frente a las dependencias de producción (verificador). Panel (`docs/16 §64`): por el DOM, privacidad, términos y acerca de como texto (un `<script>` del servidor queda como texto), soporte con su 429 en segundos, la pantalla de términos sin ningún dato ni canal hasta aceptar y el 403 `terminos_pendientes` de cualquier lectura que la abre; con navegador real, legal antes de entrar y la aceptación tras el primer ingreso |
| P12 Estado del sistema | RF-59, RF-60, RNF-19, HU-30 | Etapa 4, iteración 1 | Solo el administrador del sistema la ve (403 a los demás, `docs/20 §6`); un error plantado con un correo aparece agrupado y sin el correo; un servicio cerca de su techo abre `memoria_alta`; un límite cambiado con dos ediciones a la vez da 409 a la segunda |
| P13 Preferencias | RF-55, RF-56, HU-28, HU-29 | Etapa 4, iteración 1 (la baja, en la 0) | Una medición guardada en °C se muestra en °F con su unidad y la base no cambia; la zona propia cambia las horas visibles y el aviso; la baja deja `usuario` sin nombre ni correo (`docs/20 §11`). Panel (`docs/16 §64`): por el DOM, optimista y reversible (un 409 vuelve atrás con el aviso), el permiso de notificar pedido al marcar, sesiones, vistas y la baja con clave; con navegador real, °F en la ficha con la base en °C. Pendiente: la zona propia en las horas visibles |
| P1 Tablero v2 | RF-30, HU-07, HU-15, HU-16, TT-44 | Etapa 4, iteración 1 (diseñado el 11/11/2026) | Los indicadores suman el inventario y cambian en vivo con F3; el resumen y el histórico del sitio medidos con la serie de 30 días del banco (como `docs/16 §52`); zoom, rango a medida y varias series con navegador real a 390 y 1 280 px; colores de series validados antes del código (§4 tablero v2, A3) |
| P1 Tablero v3 (armazón, pestañas, «Ahora», gráficas vivas) | RF-30, RF-52, RF-58, HU-07, HU-15, HU-16, TT-44 | Etapa 4, iteración 1 (diseñado y construido el 13/11/2026) | `docs/16 §67`: por el DOM, dos pedidos al entrar, la franja con enlaces por rótulo y cifra, «Ahora» vivo sin pedir nada por cada trama, el resumen como mucho una vez por minuto, `sitio_id`, «Pausar»/«Reanudar» (tablero y ficha), refresco solo en 1 h y 24 h con la ventana alineada, puntos y eje de enteros, la etiqueta flotante, el menú contraído, el cajón y el tema por un solo escritor; con navegador real (paso 4c), el cajón con el teclado, el menú contraído con sus nombres, el tema que alterna y el alto de la pestaña Resumen a 390 × 844 con la semilla completa, sin desplazamiento horizontal en ninguna pestaña |
| P2 y P3 v2 | RF-33, RF-47, RF-49, RF-57, HU-07, TT-42 | Etapa 4, iteración 1 | El estado visual del servidor coincide con `estadoVisual()` fila por fila; paginación con total en la cabecera; un zoom cambia la resolución y la URL; banda mín–máx; umbrales y condiciones dibujados; tramas rechazadas agrupadas con «× N»; unidades según la preferencia con ida y vuelta exacta |
| P6 Configurar | HU-06, HU-13, RF-14 | Etapa 4, iteración 1 | Validación compartida (plantada: bajo ≥ alto falla en los dos lados); 409 con dos pestañas; retardo de activación: una medición fuera de banda menos tiempo que el retardo no abre condición, más tiempo sí; cada guardado deja un `evento` con la persona. Panel (`docs/16 §64`): los casos de la prueba del servidor repetidos contra la función del panel, el error junto al campo, «Guardando…», el 409 con la hora y «Recargar» sin pisar; con navegador real, la validación en vivo y el 409 con dos pestañas |
| P7 Alta, lote y detectados | HU-22, RF-50, HU-11 | Etapa 4, iteración 1 | Credencial una sola vez; `modo=validar` no crea nada; un lote con filas malas crea solo las válidas y el informe lo dice; tope de 500 filas y límite de tasa plantados; un emisor desconocido aparece en detectados y llega al asistente con su identificador. Panel (`docs/16 §64`): por el DOM, 121 válidas en tandas de 50 con la segunda fallando (se detiene con 50 y reintenta 71), 501 filas frenadas en el navegador, detectado → asistente; con navegador real, el asistente por HTTP y un lote de 2 válidas y 1 rechazada |
| P14 Actividad | RF-46, HU-11, HU-26 | Etapa 4, iteración 1 | Un umbral cambiado aparece con la persona que lo cambió; un administrador de un sitio no ve la actividad de otro (404); un cursor de otro sitio no trae nada. Panel (`docs/16 §64`): por el DOM, cursor, filtros en la URL, tarjetas en teléfono y nada para quien no administra; con navegador real, el umbral cambiado en P6 con quien lo cambió y sin correos |
| P9 Vista pública | punto 6 | Etapa 4, iteración 2 | Sin cuenta: solo las magnitudes agregadas elegidas; ninguna ruta cruda responde con el token |

La etapa de cada pantalla es la de su historia en `docs/04`; mover una historia de etapa se decide con sus horas y se cambia
primero allí (y en `docs/18`), nunca aquí. Matriz de acceso ruta × rol (`docs/11 §4`) y las pruebas de 409 con dos ediciones simultáneas |
