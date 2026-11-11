# Estado de la Etapa 3 — actualizado al 11 de noviembre de 2026

> Entrega: **jueves 5 de noviembre de 2026** (plazo ampliado por el profesor guía; fecha del calendario del curso: viernes 30 de octubre). Se actualiza al cerrar cada bloque de trabajo. Las tareas, sus horas y su
> etapa salen de `docs/04` (manda el backlog); la rúbrica, de `referencias/materiales-curso.md`; cada estado, de la
> evidencia que se cita al lado. El cierre de la Etapa 2 quedó en `docs/12`.
> Leyenda: ✅ hecho y verificado · 🟢 avanzado · 🟡 parcial · ⬜ pendiente · 🎯 núcleo del backlog.

## 1. Qué evalúa la Etapa 3 y cómo vamos

| Criterio de la rúbrica | Peso | Estado | Evidencia y lo que falta |
|---|---|---|---|
| Retroalimentación | 20 % | 🟡 | Al 04/11 no hay observaciones escritas del profesor guía sobre la entrega del 2/10; los avances se presentaron el 28/10 (`bitacora/2026-10-28-presentacion-temuco.md`) y sus observaciones se incorporan al llegar. Sí se incorporaron las entrevistas del 5/10 (`bitacora/2026-10-05-entrevista-academico-geologia.md`; decisiones del 6 y del 8/10, `docs/10 §8.4`) y del 25/10 (`bitacora/2026-10-25-entrevista-operador-red.md`; alta masiva al plan de la Etapa 4). El 05/11, en la presentación conjunta con los tesistas de los profesores Mario Villanueva y Luis Alberto Caro, la única pregunta (cómo dar de alta una flota completa; si cada usuario configurará sus dispositivos) tiene respuesta en el plan de la Etapa 4: sesión con usuarios y roles por sitio (hecha el 08/11/2026, `docs/20 §10`) y alta masiva por archivo (iteración 1 del plan de la Etapa 4, versión 2, del 08/11/2026; antes, iteración 2; `docs/04 §8`). Falta: recibir e incorporar la retroalimentación de la Etapa 2. |
| Mejoras | 15 % | 🟢 | Decisiones de diseño del 6, 7 y 8/10 (`docs/10 §8.4`); proxy TLS (`docs/16 §9`); dependencias e imágenes sin vulnerabilidades altas o críticas corregibles (`docs/16 §12`). |
| 50 % de la implementación | 10 % | ✅ | Superado: al cierre de la Etapa 3 (05/11) el núcleo iba en 75 % y todo el backlog en 57 %. Al 11/11/2026, con TT-21 y TT-47 cerradas y las 13 filas nuevas de la Etapa 4 (`docs/04 §8`, 60 h que bajan el porcentaje del backlog entero sin que se haya deshecho nada): Núcleo: 26 de 34 elementos hechos (131 de 168 h, 78 %) y 4 parciales (20 h: HU-02, HU-08, TT-12 y TT-22). Todo el backlog: 40 de 79 (174 de 347 h, 50 %) y 12 parciales (51 h). Cifras calculadas desde las filas de `docs/04`, con los estados de `docs/12 §3`, de §2 y de la Etapa 1 (al final de §2). |
| Pruebas iniciales | 30 % | 🟢 | `docs/16`: emulador, carga (59,7 tramas/s sin pérdida), carreras, TLS, capacidad y picos, caídas con carga, dependencias e imágenes, LoRaWAN por pasarela en el banco (`docs/16 §31–§34`); 552 pruebas unitarias del backend en 53 archivos (357 al 04/11, 445 al 10/11, 486 al 11/11 con el tablero v2, 513 tras su corrección, `docs/16 §61`, y 541 con la cuenta y los perfiles, `docs/16 §63`) y 297 del panel. Falta: la matriz formal del contrato de trama (TT-27) y el broker de producción en las caídas (`docs/16 §11`). |
| Validación preliminar | 10 % | ✅ | Sensor físico de extremo a extremo (TT-32): todas las piezas llegaron el 13/10, la placa se reconoció el 14/10 y la fase 1 se cerró el 19/10 con los tres sensores verificados (`docs/16 §43`) y la fase 2 publicó 24 h hasta el panel, sin pérdidas, el 23 y 24/10 (`docs/16 §53`); guía de manejo seguro escrita (`docs/17 §4`). **Validación en terreno hecha el 20/10: red LoRaWAN real del campus publicando en el sistema (`docs/16 §45`).** El capítulo de pruebas que la presenta (TT-36, §2) va en la versión de entrega del 05/11; la validación en el servidor de referencia es de la Etapa 4 (OE5). |
| Documentación | 15 % | ✅ | Documentos en concordancia (guardián `plataforma/pruebas/verificar-todo.sh`). El 15/10 el informe ganó el capítulo «Implementación y pruebas iniciales» y el anexo con el detalle de las pruebas (TT-36); revisión de entrega hecha el 04/11/2026 en tres frentes (seguridad, concordancia, privacidad; 40 hallazgos verificados, 30 aplicados y el resto anotado) y una segunda pasada que corroboró informe y láminas contra la evidencia y contra el sistema en ejecución; versión de entrega del 05/11 (informe de 30 páginas de cuerpo y láminas). La retroalimentación de la Etapa 2 se incorpora al llegar. |

## 2. Tareas de la Etapa 3: 17 elementos, 88 h (tras el corte del 08/10 y los adelantos del 12/10, §3)

**Hechos: 13 (69 h) · parciales: 4 (19 h) · pendientes: 0 (0 h).**

| Ítem | Tarea | h | Estado | Evidencia o lo que falta |
|---|---|---|---|---|
| HU-02 🎯 | Eventos LoRaWAN en la plataforma | 6 | 🟡 | Diseño: ruta B con tópico propio de la pasarela y adaptador de su JSON (`docs/10 §8.4` puntos 3 y 24). Hecho el 08/10: la entidad `pasarela` en la base y la comparación del sitio del tópico para los dispositivos (migración 11, `docs/16 §13`). **Hecho en el banco el 15/10** (`docs/10 §8.4` punto 47; formato declarado, adaptadores, filtro 1 de pasarela, pasarelas por API y su rol, `docs/16 §27–§31`; falta la prueba en terreno): adaptadores `chirpstack` y `milesight`, tópico de pasarela, `/pasarelas` por API con rol propio y `banco.sh lorawan` con el JSON de las fuentes oficiales (el emulador TT-28 no publica LoRaWAN todavía); falta además asociar RSSI y SNR al evento (criterio de `docs/04`, con HU-15); horas: 6 (HU-02) + 4 (adaptador «milesight»). Para la Etapa 4: el mapa de claves pasa al catálogo (`magnitud.alias`). **20/10: probada en terreno con la pasarela real y dos nodos de punta a punta (`docs/16 §45`); faltan la ruta C y el reporte HTTPS de la pasarela (variante prevista de la vía 2, antes «vía 4»).** |
| HU-03 🎯 | Publicar eventos en MQTT | 4 | ✅ | `docs/12 §3`; el emulador y el banco publican por MQTT (`docs/16 §2`). |
| TT-17 🎯 | Pipeline de seis filtros con cuarentena | 6 | ✅ | `docs/12 §3` (seis filtros verificados). |
| HU-05 🎯 | Condiciones abiertas por dispositivo | 7 | ✅ | Una condición abierta por regla (migración 02), `GET /condiciones`, pruebas de carrera (`docs/16 §4`). |
| TT-18 🎯 | Marcas de tiempo de nodos sin reloj confiable | 2 | ✅ | `docs/12 §3`. |
| HU-10 🎯 | Inventario con estado y vía de envío | 5 | ✅ | `GET /dispositivos` con la vía y el formato (migración 11), la vista del panel (P2, 12/10) y, desde el alta por API (HU-11, 12/10), la vía y el formato declarados al registrar. |
| HU-11 🎯 | Registrar un dispositivo desde la plataforma | 5 | ✅ | Alta por API hecha el 12/10: `POST /dispositivos` con clave de administrador, credencial mostrada una vez y cliente creado en el plugin del broker, todo o nada (`docs/16 §20`); baja y rotación de la credencial por la misma API el 13/10 (`docs/16 §21`). El criterio «quién lo registró» (RF-23) llega con la sesión (HU-18): hoy el evento guarda el instante y el origen (API con clave de administrador). La pantalla (P7) es HU-22, Etapa 4. |
| HU-14 🎯 | Detectar que un dispositivo dejó de reportar | 7 | ✅ | Filtro 6 (`supervision.service.ts`), intervalo esperado por dispositivo (migración 10), medición en `docs/16 §5`. |
| TT-39 | Canal de tiempo real (SSE) | 4 | 🟡 | Hecho el 09/10 en el backend: `GET /eventos` con mediciones, señales de vida y condiciones, cada una ya guardada (`docs/10 §5`, `docs/16 §14`). En esta etapa, sin sesión y solo en la red local, como la API. 12/10: lista de nombres de host contra el *DNS rebinding* en el backend y en el proxy (`docs/10 §8.4` punto 40). Falta: la sesión, que llega con HU-18 (Etapa 4). |
| HU-19 🎯 | Panel de salud con semáforo | 9 | ✅ | Cerrada el 24/10, criterio por criterio: conteos, estado visual en cuatro valores (`docs/19 §2`), última comunicación y cambios por el canal en vivo sin recargar (`docs/16 §16`); con el sensor físico 24 h (`docs/16 §53`); en un teléfono sin desplazamiento horizontal, RF-52, medido en dos navegadores a 320–414 px (`docs/16 §54`). La demostración no es criterio de aceptación. |
| HU-20 🎯 | Inventario filtrable por sitio, zona, estado y vía | 7 | ✅ | Adelantada de la Etapa 4 el 12/10 (§3). Tramo 2: filtro por estado (fichas), zona, vía y búsqueda, en el panel; **16/10:** filtro por sitio y columna Sitio cuando hay más de uno, zona elegida dentro del sitio, por código e id (dos sedes con una zona del mismo nombre no se confunden: prueba plantada y una comprobación a mano contra la base del banco; `docs/16 §40`). |
| HU-08 🎯 | Exportar los datos en CSV, XLSX y JSON | 4 | 🟡 | Adelantada de la Etapa 4 el 12/10 (§3). CSV estándar y JSON por dispositivo y rango, en flujo por tandas (`GET /dispositivos/{id}/exportar`, `docs/16 §19`); XLSX y la exportación por sitio con rol, en la Etapa 4 con la sesión. |
| HU-21 🎯 | Ficha del dispositivo: condiciones, historial y serie | 7 | ✅ | Adelantada de la Etapa 4 el 12/10 (§3). Tramo 3 hecho el 12/10: pantalla P3 (`docs/19`) con identidad, tarjetas por canal, gráfico uPlot del histórico agregado que sigue en vivo, condiciones y tramas rechazadas del dispositivo (`docs/16 §17`). **Prueba con navegador real hecha el 16/10** (`banco.sh navegador`: Firefox con Playwright, puntos del gráfico contra `/historico`, vivo sin recargar, caída y vuelta; `docs/16 §39`) y el % calibrado (`docs/16 §38`). El rango a medida por fechas es HU-07 (Etapa 4). |
| TT-28 🎯 | Emulador de nodos | 5 | ✅ | `docs/16 §2`. |
| TT-32 🎯 | Sensor físico de extremo a extremo | 3 | ✅ | Hecho el 24/10: el nodo propio publicó 24 h por MQTT con TLS hasta el panel, 1 440 de 1 440 tramas, consultables por la API con su valor, unidad y marca (`docs/16 §53`). Antes: fase 0 el 14/10 (`docs/17 §3`), fase 1 el 19/10 con los tres sensores y el suelo calibrado (`docs/16 §43`) y el contrato en el banco (`docs/16 §44`). |
| TT-36 | Informe de pruebas y validación preliminar | 5 | 🟡 | `docs/16` y, desde el 15/10, el capítulo 5 del informe con el anexo de pruebas; parcial al 28/10 (faltaba la versión de entrega); la versión de entrega del 05/11 lo cierra y pasa a hecho en el estado de la Etapa 4. |
| TT-41 | Diseño del despliegue en Kubernetes | 2 | ✅ | Hecho el 22/10: `docs/14 §6` (equivalencias Compose → k3s, estado por pieza, opción B con suscripciones compartidas y respaldos); la implementación espera un clúster (M7). |


**Pasadas a la Etapa 4 el 08/10** (§3): HU-06 Umbrales por dispositivo (4 h, 🟡); HU-12 Agrupar por sitio y zona (3 h,
🟡); HU-15 Calidad del enlace (4 h, ⬜); HU-17 Batería baja (3 h, ⬜); HU-18 Sesión y roles (3 h, ✅: backend y pantalla hechos el 08/11).

**Cerrados en la Etapa 4:** TT-21 🎯 (aislamiento entre sitios) ✅ el 08/11/2026: el alcance por sitio entra al `WHERE` de cada consulta
(`docs/20 §5`) y el paso 4b del guardián prueba la matriz con dos sitios: otro sitio responde 404, igual que un recurso inexistente, también
en la exportación y en el canal en vivo (`docs/16 §58`). TT-47 (backend en ES modules) ✅ el 11/11/2026: `"type": "module"`, `nodenext` y
pruebas con vitest, con el guardián completo antes y después (`docs/10 §8.4` punto 63, `docs/16 §60`).

**Adelantados de la Etapa 4:** TT-20 (autenticación de la recepción) ✅ (`docs/12 §3`); TT-29 (carga) ✅ preliminar
(`docs/16 §5`); TT-22 (TLS) 🟡: MQTT por el proxy, probado en el banco (`docs/16 §9`), y el canal en vivo por HTTPS (`docs/16 §14`); TT-30 (recuperación) 🟡: falta el
broker de producción (`docs/16 §11`); HU-04 (adaptador de otro formato) 🟡: adaptador plano, se cierra con la trama real
(`docs/12 §3`). **Pendiente de la Etapa 2, cerrado el 16/10:** HU-01 ✅: a la recepción por MQTT se suma la recepción por HTTP (RF-01),
con los mismos filtros, token del alta y topes medidos (`docs/10 §8.4` punto 52, `docs/16 §41`). **Etapa 1:** TT-34 (documento de la etapa) ✅, entregado el 4/09; TT-33 (entrevistas) ✅: dos, el 5/10
(`bitacora/2026-10-05-entrevista-academico-geologia.md`) y el 25/10 (`bitacora/2026-10-25-entrevista-operador-red.md`), con la fuente `[ENT]` marcada en `docs/02`; TT-38 (bitácora) 🟡: continua hasta la Etapa 4.

## 3. ¿Cabe lo que falta? — medición y corte (decidido el 08/10)

Con las 18 tareas originales (85 h) quedaban 37 h pendientes y 17 h parciales frente a unas 45 h disponibles entre el 9 y el
30 de octubre (unas 15 h por semana, restricción RE-01, `docs/04 §6.2`): no cabía. **Corte decidido por el estudiante el
08/10:** quedan en la Etapa 3 el núcleo (salvo HU-15, que necesita tráfico de radio real), TT-39 (el panel necesita su canal)
y TT-36 (es el entregable). Pasan a la Etapa 4 HU-15, HU-17, HU-18 (con M7) y las interfaces de HU-06 y HU-12. Lo que falta
de la Etapa 3 son ahora 37 h según las filas (algo menos, porque HU-10 y TT-36 ya están empezadas), con unas 8 h de margen. La
recepción por HTTP (RF-01) entra en esta etapa solo si sobra tiempo; si no, en la Etapa 4 (entró: el 16/10, §2). Las filas de `docs/04` y del anexo del backlog
ya dicen la etapa nueva (paso 2v del guardián).

**Adelantos decididos por el estudiante el 12/10:** HU-20 y HU-21 (7 h cada una) pasan de la Etapa 4 a la 3, para que el panel
muestre, además del semáforo (HU-19), el inventario filtrable y la ficha con gráfico (`docs/19`); y HU-08 (4 h), porque la
exportación es lo que el Académico/Investigador en Ingeniería Civil Geológica entrevistado llamó «no negociable» (CSV y JSON ahora; XLSX con la sesión). Lo que falta de la
Etapa 3 son ahora 45 h según las filas (9 pendientes y 36 parciales al cierre del 12/10, §2; al 15/10, §2 da 8 parciales y ninguno pendiente) frente a unas 38 h disponibles hasta el 30/10 (15 h por semana): **no
cabe todo, y se sabe**. Orden fijado: TT-36 (el entregable), HU-19 y HU-11, después HU-21 y HU-20; lo que no esté hecho el 27/10
vuelve a la Etapa 4 con su registro aquí y en `docs/04`.

## 4. Lo que frena hoy

- La retroalimentación de la Etapa 2 todavía no llega; los avances se presentaron el 28/10 y las observaciones se incorporan al llegar.
- El sensor de aire del nodo propio (BME280) tiene un contacto I2C intermitente desde el 24/10 (`docs/16 §53`): el nodo omite esas tres magnitudes y sigue publicando suelo y señal; falta revisar su cableado.
- La recepción LoRaWAN en terreno (HU-02) necesita una pasarela que alcance el servidor (`docs/10 §8.4` punto 24); mientras
  tanto se prueba en el banco con el JSON exacto de las fuentes oficiales (`banco.sh lorawan`, `docs/16 §31`); la prueba en la misma red que la pasarela del campus se hizo el martes 20/10 con el operador de la red (`docs/16 §45`); su pasarela es una UG65 con servidor embebido y dos nodos reportando cada 60 s, y el adaptador se ajusta antes a la forma real de su mensaje (`docs/10 §8.4` punto 47, nota del 15/10).

## 5. Lo que falta del núcleo y lo que viene después (16/10/2026)

El estado de cada elemento manda en §1 y §2; esta lista ordena lo que falta. El guardián (paso 2w5) comprueba que cada elemento
siga sin terminar y que sus horas sean las de `docs/04`: un elemento que se cierra se quita de aquí en el mismo cambio.

**Núcleo (🎯): 8 elementos, 37 h.** Cuatro parciales y cuatro sin empezar, en el orden de trabajo de la Etapa 4 (plan del 08/11/2026; por decisión del 09/11 los cuatro del núcleo que quedaban en la iteración 2 van en la 1):

| Orden | Elemento | Horas | Estado | Qué falta |
|---|---|---|---|---|
| 1 | HU-07 Historial por rango de fechas | 4 | ⬜ | Todo |
| 2 | HU-15 Calidad del enlace | 4 | ⬜ | Todo; necesita tráfico LoRaWAN real (`rssi` y `snr` ya quedan en la trama cruda) |
| 3 | HU-16 Indicador de salud del sitio | 4 | ⬜ | Todo |
| 4 | HU-02 Eventos LoRaWAN | 6 | 🟡 | **Probada en terreno el 20/10** con la pasarela real del campus y dos nodos de punta a punta (`docs/16 §45`); el banco cubre lo demás (`docs/16 §31`, §36 y §37). Quedan la ruta C (ChirpStack) y la coexistencia con otro broker (reporte HTTPS de la pasarela, variante prevista de la vía 2; antes «vía 4») |
| 5 | HU-08 Exportar en CSV, XLSX y JSON | 4 | 🟡 | XLSX y la exportación por sitio con rol: necesita la sesión (HU-18) |
| 6 | TT-12 Catálogo de sensores y unidades | 6 | 🟡 | El catálogo editable con umbrales; con él, los alias de claves y los perfiles de decodificación (`docs/08 §8`) |
| 7 | TT-27 Pruebas del contrato de trama | 5 | ⬜ | La matriz formal (esquema, cuarentena, adaptadores) |
| 8 | TT-22 Cifrado del transporte | 4 | 🟡 | El broker de producción con certificado real (`docs/14`); desde el 03/11 un servidor de prueba en la red del campus opera con CA propia y TLS verificado en las dos vías (`docs/14 §7.4`, bitácora del 03–04/11); falta el certificado público |

En la Etapa 4, el orden lo fija el plan de la versión 2 (`docs/04 §8`, 08/11/2026): HU-07, HU-15 y HU-16 en la iteración 0; HU-02, HU-08,
TT-12, TT-27 y el certificado público de TT-22 en la 2, con su falta declarada en el informe si no alcanza. (HU-21, HU-20 y HU-01 se
cerraron el 16/10: `docs/16 §39`, §40 y §41; HU-19, el 24/10; TT-21, el 08/11.)

**Fuera del núcleo, también comprometido**, cada uno con diseño antes del código:

| Tema | Dónde está decidido o pedido | Estado |
|---|---|---|
| Canal en vivo por WebSocket en vez de SSE | `docs/10 §8.4` punto 46 | Diseño; sin código |
| Sesión, usuarios y roles | HU-18, `docs/20` | Backend y pantalla P10 hechos el 08/11/2026 (migración 22, guardia central, pasos 4b y 4c del guardián; `docs/19 §4`); los cinco perfiles, la baja con motivo, los términos de uso y la cuenta propia (preferencias, sesiones, exportar y baja por anonimización), el 11/11/2026 (migración 24; P11, P13 y P14; `docs/20 §10` a §12) |
| Vista pública de solo lectura por enlace (quien solo mira, sin cuenta) | `docs/10 §8.4` punto 6, pantalla P9 de `docs/19`, `docs/20 §7` | Diseño |
| Pantallas para investigadores (exportación, series) y para quien solo observa | Entrevista del 5/10; `docs/19` | Parte hecha (P2, P3, exportación); el resto con la sesión |
| Configuración por el usuario (umbrales, destinatarios de avisos) | HU-06, HU-25 | Umbrales: P6 hecha el 11/11/2026 (`PATCH /dispositivos/{id}` y `PUT /canales/{id}/reglas`; `docs/19 §4`, E); destinatarios: solo la notificación del navegador por persona (P13); el canal saliente por sitio, sin código |
| Envío HTTP desde la pasarela a un servidor propio | `docs/10 §8.4` punto 47 | Meta, cuando haya servidor |
| Cargas masivas (alta de muchos dispositivos de una vez) y bandeja de detectados | Entrevista del 25/10; bloque B2 de `docs/04 §8` (decidido el 25/10) | Iteración 1 del plan de la Etapa 4, versión 2 (08/11/2026); controles en `docs/11 §4` |
| Registros técnicos que no se pierden al recrear un contenedor, y catálogo de errores | `docs/11 §4` (rotación hecha) | Por diseñar |
| Tope por emisor y tope de lecturas por trama | `docs/10 §8.4` punto 53, `docs/11 §3` | Hecho el 17/10: presupuesto de lecturas por hora y cuota de cuarentena en las tres entradas, con contadores persistentes (migración 19) y condición `tope_superado` (`docs/16 §42`) |
| Procesamiento en paralelo con comparación atómica del contador de trama | `docs/10 §4.1` | Por diseñar; hoy se procesa de a uno |

## 6. Cómo se mantiene

Al cerrar cada bloque: se actualiza el estado de §2 con su evidencia y se recalculan las cifras de §1 y §3 desde las filas
de `docs/04`, sin sumar a mano.
