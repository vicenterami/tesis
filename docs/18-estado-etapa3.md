# Estado de la Etapa 3 — actualizado al 15 de octubre de 2026

> Entrega: **viernes 30 de octubre de 2026**. Se actualiza al cerrar cada bloque de trabajo. Las tareas, sus horas y su
> etapa salen de `docs/04` (manda el backlog); la rúbrica, de `referencias/materiales-curso.md`; cada estado, de la
> evidencia que se cita al lado. El cierre de la Etapa 2 quedó en `docs/12`.
> Leyenda: ✅ hecho y verificado · 🟢 avanzado · 🟡 parcial · ⬜ pendiente · 🎯 núcleo del backlog.

## 1. Qué evalúa la Etapa 3 y cómo vamos

| Criterio de la rúbrica | Peso | Estado | Evidencia y lo que falta |
|---|---|---|---|
| Retroalimentación | 20 % | 🟡 | Al 15/10 no hay observaciones escritas del profesor guía sobre la entrega del 2/10; se le pedirán en una reunión presencial la semana del 20/10. Sí se incorporó la entrevista del 5/10 (`bitacora/2026-10-05-entrevista-academico-geologia.md`) en las decisiones del 6 y del 8/10 (`docs/10 §8.4`). Falta: recibir e incorporar la retroalimentación de la Etapa 2. |
| Mejoras | 15 % | 🟢 | Decisiones de diseño del 6, 7 y 8/10 (`docs/10 §8.4`); proxy TLS (`docs/16 §9`); dependencias e imágenes sin vulnerabilidades altas o críticas corregibles (`docs/16 §12`). |
| 50 % de la implementación | 10 % | 🟡 | Núcleo: 19 de 34 elementos hechos (90 de 168 h, 54 %) y 10 parciales (56 h: HU-01, HU-02, HU-08, HU-19, HU-20, HU-21, TT-12, TT-22, TT-32 y TT-33). Todo el backlog: 30 de 65 (124 de 285 h, 44 %) y 18 parciales (87 h). Cifras calculadas desde las filas de `docs/04`, con los estados de `docs/12 §3`, de §2 y de la Etapa 1 (al final de §2). |
| Pruebas iniciales | 30 % | 🟢 | `docs/16`: emulador, carga (59,7 tramas/s sin pérdida), carreras, TLS, capacidad y picos, caídas con carga, dependencias e imágenes, LoRaWAN por pasarela en el banco (`docs/16 §31–§34`); 268 pruebas unitarias del backend y 44 del panel. Falta: la matriz formal del contrato de trama (TT-27) y el broker de producción en las caídas (`docs/16 §11`). |
| Validación preliminar | 10 % | 🟡 | Sensor físico de extremo a extremo (TT-32): todas las piezas llegaron el 13/10 y la placa se reconoció e identificó el 14/10 (`docs/17 §3`); falta la fase 1, cablear los sensores y publicar hasta el panel; guía de manejo seguro escrita (`docs/17 §4`). |
| Documentación | 15 % | 🟡 | Documentos en concordancia (guardián `plataforma/pruebas/verificar-todo.sh`). El 15/10 el informe ganó el capítulo «Implementación y pruebas iniciales» y el anexo con el detalle de las pruebas (TT-36); falta incorporar la retroalimentación de la Etapa 2 y la revisión de entrega. |

## 2. Tareas de la Etapa 3: 16 elementos, 86 h (tras el corte del 08/10 y los adelantos del 12/10, §3)

**Hechos: 8 (41 h) · parciales: 8 (45 h) · pendientes: 0 (0 h).**

| Ítem | Tarea | h | Estado | Evidencia o lo que falta |
|---|---|---|---|---|
| HU-02 🎯 | Eventos LoRaWAN en la plataforma | 6 | 🟡 | Diseño: ruta B con tópico propio de la pasarela y adaptador de su JSON (`docs/10 §8.4` puntos 3 y 24). Hecho el 08/10: la entidad `pasarela` en la base y la comparación del sitio del tópico para los dispositivos (migración 11, `docs/16 §13`). **Hecho en el banco el 15/10** (`docs/10 §8.4` punto 47; formato declarado, adaptadores, filtro 1 de pasarela, pasarelas por API y su rol, `docs/16 §27–§31`; falta la prueba en terreno): adaptadores `chirpstack` y `milesight`, tópico de pasarela, `/pasarelas` por API con rol propio y `banco.sh lorawan` con el JSON de las fuentes oficiales (el emulador TT-28 no publica LoRaWAN todavía); falta además asociar RSSI y SNR al evento (criterio de `docs/04`, con HU-15); horas: 6 (HU-02) + 4 (adaptador «milesight»). Para la Etapa 4: el mapa de claves pasa al catálogo (`magnitud.alias`). |
| HU-03 🎯 | Publicar eventos en MQTT | 4 | ✅ | `docs/12 §3`; el emulador y el banco publican por MQTT (`docs/16 §2`). |
| TT-17 🎯 | Pipeline de seis filtros con cuarentena | 6 | ✅ | `docs/12 §3` (seis filtros verificados). |
| HU-05 🎯 | Condiciones abiertas por dispositivo | 7 | ✅ | Una condición abierta por regla (migración 02), `GET /condiciones`, pruebas de carrera (`docs/16 §4`). |
| TT-18 🎯 | Marcas de tiempo de nodos sin reloj confiable | 2 | ✅ | `docs/12 §3`. |
| HU-10 🎯 | Inventario con estado y vía de envío | 5 | ✅ | `GET /dispositivos` con la vía y el formato (migración 11), la vista del panel (P2, 12/10) y, desde el alta por API (HU-11, 12/10), la vía y el formato declarados al registrar. |
| HU-11 🎯 | Registrar un dispositivo desde la plataforma | 5 | ✅ | Alta por API hecha el 12/10: `POST /dispositivos` con clave de administrador, credencial mostrada una vez y cliente creado en el plugin del broker, todo o nada (`docs/16 §20`); baja y rotación de la credencial por la misma API el 13/10 (`docs/16 §21`). El criterio «quién lo registró» (RF-23) llega con la sesión (HU-18): hoy el evento guarda el instante y el origen (API con clave de administrador). La pantalla (P7) es HU-22, Etapa 4. |
| HU-14 🎯 | Detectar que un dispositivo dejó de reportar | 7 | ✅ | Filtro 6 (`supervision.service.ts`), intervalo esperado por dispositivo (migración 10), medición en `docs/16 §5`. |
| TT-39 | Canal de tiempo real (SSE) | 4 | 🟡 | Hecho el 09/10 en el backend: `GET /eventos` con mediciones, señales de vida y condiciones, cada una ya guardada (`docs/10 §5`, `docs/16 §14`). En esta etapa, sin sesión y solo en la red local, como la API. 12/10: lista de nombres de host contra el *DNS rebinding* en el backend y en el proxy (`docs/10 §8.4` punto 40). Falta: la sesión, que llega con HU-18 (Etapa 4). |
| HU-19 🎯 | Panel de salud con semáforo | 9 | 🟡 | Tramo 2 hecho el 12/10: pantalla P2 (`docs/19`) con el estado visual en cuatro valores, conteos, tabla y actualización por el canal en vivo; servida por el backend en `/panel` y comprobada con el servidor de Vite real (`docs/16 §16`). Falta: verla con el sensor físico y la demostración. |
| HU-20 🎯 | Inventario filtrable por sitio, zona, estado y vía | 7 | 🟡 | Adelantada de la Etapa 4 el 12/10 (§3). Tramo 2: filtro por estado (fichas), zona, vía y búsqueda, en el panel; falta el filtro por sitio (un solo sitio hoy) y la prueba con varios. |
| HU-08 🎯 | Exportar los datos en CSV, XLSX y JSON | 4 | 🟡 | Adelantada de la Etapa 4 el 12/10 (§3). CSV estándar y JSON por dispositivo y rango, en flujo por tandas (`GET /dispositivos/{id}/exportar`, `docs/16 §19`); XLSX y la exportación por sitio con rol, en la Etapa 4 con la sesión. |
| HU-21 🎯 | Ficha del dispositivo: condiciones, historial y serie | 7 | 🟡 | Adelantada de la Etapa 4 el 12/10 (§3). Tramo 3 hecho el 12/10: pantalla P3 (`docs/19`) con identidad, tarjetas por canal, gráfico uPlot del histórico agregado que sigue en vivo, condiciones y tramas rechazadas del dispositivo (`docs/16 §17`). Falta: el rango a medida por fechas (HU-07, Etapa 4) y una prueba con navegador real. |
| TT-28 🎯 | Emulador de nodos | 5 | ✅ | `docs/16 §2`. |
| TT-32 🎯 | Sensor físico de extremo a extremo | 3 | 🟡 | Las piezas llegaron el 13/10 y la placa se reconoció e identificó el 14/10 (fase 0, `docs/17 §3`). Falta la fase 1: cablear los sensores y publicar por MQTT con TLS hasta el panel. |
| TT-36 | Informe de pruebas y validación preliminar | 5 | 🟡 | `docs/16` y, desde el 15/10, el capítulo 5 del informe con el anexo de pruebas; falta la versión de entrega (retroalimentación de la Etapa 2; sensor físico y prueba en terreno si llegan a tiempo). |


**Pasadas a la Etapa 4 el 08/10** (§3): HU-06 Umbrales por dispositivo (4 h, 🟡); HU-12 Agrupar por sitio y zona (3 h,
🟡); HU-15 Calidad del enlace (4 h, ⬜); HU-17 Batería baja (3 h, ⬜); HU-18 Sesión y roles (3 h, ⬜).

**Adelantados de la Etapa 4:** TT-20 (autenticación de la recepción) ✅ (`docs/12 §3`); TT-29 (carga) ✅ preliminar
(`docs/16 §5`); TT-22 (TLS) 🟡: MQTT por el proxy, probado en el banco (`docs/16 §9`), y el canal en vivo por HTTPS (`docs/16 §14`); TT-30 (recuperación) 🟡: falta el
broker de producción (`docs/16 §11`); HU-04 (adaptador de otro formato) 🟡: adaptador plano, se cierra con la trama real
(`docs/12 §3`). **Pendiente de la Etapa 2:** HU-01 🟡: la recepción por MQTT funciona; la recepción por HTTP (RF-01) no
está construida. **Etapa 1:** TT-34 (documento de la etapa) ✅, entregado el 4/09; TT-33 (entrevistas) 🟡: una, el 5/10
(`bitacora/2026-10-05-entrevista-academico-geologia.md`), falta consolidar; TT-38 (bitácora) 🟡: continua hasta la Etapa 4.

## 3. ¿Cabe lo que falta? — medición y corte (decidido el 08/10)

Con las 18 tareas originales (85 h) quedaban 37 h pendientes y 17 h parciales frente a unas 45 h disponibles entre el 9 y el
30 de octubre (unas 15 h por semana, restricción RE-01, `docs/04 §6.2`): no cabía. **Corte decidido por el estudiante el
08/10:** quedan en la Etapa 3 el núcleo (salvo HU-15, que necesita tráfico de radio real), TT-39 (el panel necesita su canal)
y TT-36 (es el entregable). Pasan a la Etapa 4 HU-15, HU-17, HU-18 (con M7) y las interfaces de HU-06 y HU-12. Lo que falta
de la Etapa 3 son ahora 37 h según las filas (algo menos, porque HU-10 y TT-36 ya están empezadas), con unas 8 h de margen. La
recepción por HTTP (RF-01) entra en esta etapa solo si sobra tiempo; si no, en la Etapa 4. Las filas de `docs/04` y del anexo del backlog
ya dicen la etapa nueva (paso 2v del guardián).

**Adelantos decididos por el estudiante el 12/10:** HU-20 y HU-21 (7 h cada una) pasan de la Etapa 4 a la 3, para que el panel
muestre, además del semáforo (HU-19), el inventario filtrable y la ficha con gráfico (`docs/19`); y HU-08 (4 h), porque la
exportación es lo que el Académico/Investigador en Ingeniería Civil Geológica entrevistado llamó «no negociable» (CSV y JSON ahora; XLSX con la sesión). Lo que falta de la
Etapa 3 son ahora 45 h según las filas (9 pendientes y 36 parciales al cierre del 12/10, §2; al 15/10, §2 da 8 parciales y ninguno pendiente) frente a unas 38 h disponibles hasta el 30/10 (15 h por semana): **no
cabe todo, y se sabe**. Orden fijado: TT-36 (el entregable), HU-19 y HU-11, después HU-21 y HU-20; lo que no esté hecho el 27/10
vuelve a la Etapa 4 con su registro aquí y en `docs/04`.

## 4. Lo que frena hoy

- La retroalimentación de la Etapa 2 todavía no llega; las consultas al profesor guía están listas para la reunión presencial de la semana del 20/10.
- El sensor físico (TT-32) ya tiene su equipo: falta cablear los sensores y publicar hasta el panel (fase 1).
- La recepción LoRaWAN en terreno (HU-02) necesita una pasarela que alcance el servidor (`docs/10 §8.4` punto 24); mientras
  tanto se prueba en el banco con el JSON exacto de las fuentes oficiales (`banco.sh lorawan`, `docs/16 §31`); la prueba en la misma red que la pasarela del campus está acordada para el martes 20/10 con el compañero a cargo; su pasarela es una UG65 con servidor embebido y dos nodos reportando cada 60 s, y el adaptador se ajusta antes a la forma real de su mensaje (`docs/10 §8.4` punto 47, nota del 15/10).

## 5. Lo que falta del núcleo y lo que viene después (16/10/2026)

El estado de cada elemento manda en §1 y §2; esta lista ordena lo que falta. El guardián (paso 2w5) comprueba que cada elemento
siga sin terminar y que sus horas sean las de `docs/04`: un elemento que se cierra se quita de aquí en el mismo cambio.

**Núcleo (🎯): 15 elementos, 78 h.** Diez parciales y cinco sin empezar, en el orden de trabajo:

| Orden | Elemento | Horas | Estado | Qué falta |
|---|---|---|---|---|
| 1 | HU-02 Eventos LoRaWAN | 6 | 🟡 | La prueba en la misma red que la pasarela del campus (20/10); lo demás está probado en el banco (`docs/16 §31`, §36 y §37) |
| 2 | TT-32 Sensor físico de extremo a extremo | 3 | 🟡 | Fase 1 (diagnóstico de los sensores, firmware listo y compilado) y fase 2 (publicar por MQTT con TLS hasta el panel) (`docs/17 §6`) |
| 3 | HU-21 Ficha del dispositivo | 7 | 🟡 | Una prueba con navegador real; el rango a medida por fechas es HU-07 |
| 4 | HU-20 Inventario filtrable | 7 | 🟡 | El filtro por sitio y la prueba con varios sitios |
| 5 | HU-19 Panel de salud con semáforo | 9 | 🟡 | Verlo con el sensor físico y en la demostración |
| 6 | HU-01 SenML por MQTT o HTTP | 6 | 🟡 | La recepción por HTTP (RF-01), base también del envío HTTP desde la pasarela (`docs/10 §8.4` punto 47) |
| 7 | HU-08 Exportar en CSV, XLSX y JSON | 4 | 🟡 | XLSX y la exportación por sitio con rol: necesita la sesión (HU-18) |
| 8 | TT-22 Cifrado del transporte | 4 | 🟡 | El broker de producción con certificado real (`docs/14`) |
| 9 | TT-12 Catálogo de sensores y unidades | 6 | 🟡 | El catálogo editable con umbrales; con él, los alias de claves y los perfiles de decodificación (`docs/08 §8`) |
| 10 | TT-33 Entrevistas | 4 | 🟡 | Más entrevistas: hay una (5/10) |
| 11 | TT-21 Aislamiento entre sitios | 5 | ⬜ | Todo; necesita la sesión y los roles por sitio (`docs/20`) |
| 12 | TT-27 Pruebas del contrato de trama | 5 | ⬜ | La matriz formal (esquema, cuarentena, adaptadores) |
| 13 | HU-07 Historial por rango de fechas | 4 | ⬜ | Todo |
| 14 | HU-15 Calidad del enlace | 4 | ⬜ | Todo; necesita tráfico LoRaWAN real (`rssi` y `snr` ya quedan en la trama cruda) |
| 15 | HU-16 Indicador de salud del sitio | 4 | ⬜ | Todo |

Del 1 al 6 suman 38 h y hasta el 30/10 caben unas 30 junto con el informe: el 6 puede quedar en la Etapa 4 si el 1 al 5 se alargan.
Del 7 en adelante, Etapa 4.

**Fuera del núcleo, también comprometido**, cada uno con diseño antes del código:

| Tema | Dónde está decidido o pedido | Estado |
|---|---|---|
| Canal en vivo por WebSocket en vez de SSE | `docs/10 §8.4` punto 46 | Diseño; sin código |
| Sesión, usuarios y roles | HU-18, `docs/20` | Diseño; sin código |
| Vista pública de solo lectura por enlace (quien solo mira, sin cuenta) | `docs/10 §8.4` punto 6, pantalla P9 de `docs/19`, `docs/20 §7` | Diseño |
| Pantallas para investigadores (exportación, series) y para quien solo observa | Entrevista del 5/10; `docs/19` | Parte hecha (P2, P3, exportación); el resto con la sesión |
| Configuración por el usuario (umbrales, destinatarios de avisos) | HU-06, HU-25 | Sin código |
| Envío HTTP desde la pasarela a un servidor propio | `docs/10 §8.4` punto 47 | Meta, cuando haya servidor |
| Cargas masivas (alta de muchos dispositivos de una vez) | Sin elemento propio en el backlog | Se diseña y se agrega al backlog |
| Registros técnicos que no se pierden al recrear un contenedor, y catálogo de errores | `docs/11 §4` (rotación hecha) | Por diseñar |
| Tope por emisor y tope de lecturas por trama | `docs/10 §4.1`, `docs/11 §4` | Por diseñar |
| Procesamiento en paralelo con comparación atómica del contador de trama | `docs/10 §4.1` | Por diseñar; hoy se procesa de a uno |

## 6. Cómo se mantiene

Al cerrar cada bloque: se actualiza el estado de §2 con su evidencia y se recalculan las cifras de §1 y §3 desde las filas
de `docs/04`, sin sumar a mano.
