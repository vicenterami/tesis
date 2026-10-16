# Reglas de manejo del tiempo y las zonas horarias

> Regla de diseño transversal (base de datos, pipeline, API, panel, exportaciones). Chile alterna
> entre UTC−4 (invierno) y UTC−3 (verano) y la fecha del cambio la fija el gobierno cada año; otros
> países tienen reglas distintas. Un sistema que mezcle horas locales con UTC produce mediciones
> "movidas", días con horas de menos y filtros que pierden o duplican datos. Este documento fija cómo
> se evita, y cada regla marcada ✅ tiene una prueba reproducible en `plataforma/db/pruebas/` o
> `plataforma/pruebas/`. Versión 2 — 9 de septiembre de 2026.

---

## 1. Tres cosas distintas que la gente llama «fecha»

Casi todos los errores de fechas nacen de tratar como una sola cosa a tres cosas diferentes.

| Familia | Qué representa | Ejemplo en esta plataforma | ¿Tiene zona? | Tipo en PostgreSQL | Cómo viaja en la API |
|---|---|---|---|---|---|
| **Instante** | Un punto exacto de la línea del tiempo | `medicion.tiempo`, `visto_por_ultima_vez`, `abierta_en`, `recibido_en` | Sí: el mismo instante es 14:32 en Santiago y 17:32 en UTC | `timestamptz` | ISO 8601 UTC con `Z`: `2026-09-09T03:07:44.504Z` |
| **Día calendario** | Una fecha sin hora | «el reporte del 7 de septiembre», un rango de consulta «del 1 al 15» | **No**: el 7 es el 7 en Santiago, en Madrid y en Tokio | `date` | texto `YYYY-MM-DD`, nunca convertido a instante |
| **Hora de pared** | Una hora del reloj sin zona | «horario de silencio de alertas 22:00–07:00» (si existiera) | No, y por eso es ambigua | `timestamp` sin zona **solo** con comentario explícito en el DDL | `YYYY-MM-DDTHH:mm` sin `Z` |

**El tipo de la columna declara la familia.** Hoy la plataforma solo tiene instantes (todas las
columnas de tiempo son `timestamptz`; prueba ✅ *guardia*). Convención de nombres para el futuro:
`_en`/`tiempo` = instante · `_dia`/`fecha_` = día calendario · `_local` = hora de pared (excepcional).

El error clásico es guardar un día calendario como instante: «el 15» se convierte en «el 15 a las
00:00 UTC», que visto desde Chile es **el 14 a las 20:00 o 21:00**. Como el error aparece siempre
(no solo de noche), en Chile se nota rápido; en Europa (UTC+1/+2) el mismo error solo se ve de
madrugada y sobrevive años.

## 2. Las reglas

| # | Regla | Dónde se aplica | Prueba |
|---|---|---|---|
| 1 | **Se almacena en UTC.** Toda columna de instante es `timestamptz`; nunca `timestamp` sin zona | `01-esquema.sql` | ✅ guardia SQL |
| 2 | **La marca de tiempo del emisor es un instante absoluto** (segundos Unix en SenML). Los nodos no manejan zonas y no deben hacerlo | filtro 4 | ✅ pruebas unitarias `tiempo.spec.ts` |
| 3 | **Cada sitio declara su zona horaria con nombre IANA** (`America/Santiago`), nunca un desfase fijo como «−3»: el nombre incluye las reglas de verano/invierno. Un desfase fijo se rompe dos veces al año | `sitio.zona_horaria` (migración 03), disparador que rechaza nombres inválidos | ✅ `-03` rechazado |
| 4 | **Toda pregunta de "día" se responde dentro de la base, en la zona del sitio**: `time_bucket(intervalo, tiempo, zona)`, `(tiempo AT TIME ZONE zona)::date`. Nunca `CURRENT_DATE`, `now()::date`, `::date` ni `date_trunc` sobre un instante sin pasar por la zona | API de consulta | ✅ 23:30 del 4-sep cae en el 4, no en el 5 |
| 5 | **La API entrega instantes en ISO 8601 UTC con `Z`**, también los que viajan dentro de JSON armado en SQL (`json_agg`, `json_build_object`), que por defecto emiten `+00:00`: se pasan por `iso_utc()` (migración 04). Un solo formato para una sola cosa | controladores, `consulta.service` | ✅ prueba de humo «termina en Z» |
| 6 | **El panel convierte a la zona del sitio al pintar**, con la zona que la API le informa, no con la del navegador: quien mire el panel desde otro país ve la hora del sitio, y el panel muestra un aviso cuando la zona del navegador difiere | panel (Svelte) | 🟡 hecho en P2 y P3 el 12/10 (`horaLocal`, `tzDate` con la zona del sitio); falta el aviso cuando la zona del navegador es otra |
| 7 | **La marca del emisor se acepta solo si es plausible** (y la hora de recepción, cuando reemplaza a la marca, la pone la base con `clock_timestamp()` en microsegundos: dos tramas procesadas en el mismo milisegundo no deben colisionar): sin marca, anterior al año 2000 (reloj sin inicializar) o más de 2 minutos en el futuro → hora de recepción; hasta 2 minutos de adelanto se respeta la marca (deriva normal, y conservarla mantiene el espaciado real entre lecturas del nodo); **una marca antigua pero posterior a 2000 se respeta**: un nodo que acumuló lecturas sin cobertura y las envía después reporta tiempos legítimamente viejos | filtro 4, `tiempoPlausible` | ✅ pruebas unitarias `tiempo.spec.ts` |
| 8 | **Los rangos de consulta son semiabiertos** `[desde, hasta)`: el instante frontera cuenta una vez | API | ✅ |
| 9 | **El proceso del backend corre en UTC siempre** (`process.env.TZ = 'UTC'` antes de cualquier import; `ENV TZ=UTC` en la imagen), sin depender de la zona del sistema que lo aloje. Vale también para cualquier tarea programada: el barrido de supervisión y los futuros reportes diarios | `main.ts`, imagen Docker | ✅ |
| 10 | **Un reporte "diario" o "mensual" se define en la zona del sitio**, no en UTC: «el informe de ayer» es el día de ayer en Santiago | tareas programadas (futuras) | ⬜ |
| 11 | **Las exportaciones (CSV/JSON) llevan el instante en ISO UTC con `Z` y, si se agrega una columna legible, la hora en la zona del sitio con su nombre**. Nunca una hora local sin decir de qué zona; nunca construir fechas de hoja de cálculo desde la época sin cuidado (muestran componentes UTC) | RF-exportación (futuro) | ⬜ |
| 12 | **Ninguna operación con `Date` en JavaScript decide un "día"**: `new Date('2026-09-15')` es medianoche UTC; `new Date('2026-09-15T00:00')` es hora local; `toISOString()` sobre un día lo corre. Los días se calculan en SQL en la zona del sitio o se comparan como texto `YYYY-MM-DD` | revisión de código | señales de alarma §5 |
| 13 | **Al cambiar el tipo de una columna de fecha, el código debe funcionar con el tipo viejo y el nuevo**, la migración se aplica junto con el despliegue, y se sigue el dato completo: quién lo escribe, quién lo lee, quién lo pinta (`grep` por el nombre de la columna) | migraciones | método §6 |
| 14 | **La conversión de zona va del lado del parámetro, nunca envolviendo la columna**: `tiempo >= $1` con `$1` ya convertido (o `($1::date)::timestamp AT TIME ZONE zona`) usa el índice; `date(tiempo AT TIME ZONE zona) = $1` fuerza recorrer toda la tabla. Un índice funcional solo con un `EXPLAIN ANALYZE` que lo justifique | `consulta.service` (histórico) | ✅ `tiempo >= $2 AND tiempo < $3` |
| 15 | **«Cada N días» se compara por día calendario en la zona del sitio, no por intervalo de horas**: un proceso a hora fija deriva con el cambio de hora y un día de 23 h se salta | tareas programadas (futuras) | ⬜ |
| 16 | **Validar antes de formatear**: `Intl.DateTimeFormat.format` y `toISOString` lanzan con una fecha inválida, y dentro de una transacción tumban el lote entero; `Number.isNaN(d.getTime())` primero | filtro 4 (`tiempoPlausible` ya lo hace), exportaciones | ✅ prueba «fecha inválida» |
| 17 | **La hora de una trama LoRaWAN la pone el servidor de red, no el nodo** (15/10/2026; `docs/10 §8.4` punto 47): el evento `up` de ChirpStack trae `time` en RFC 3339 con zona → es la marca del emisor para la regla 7, con `origen_tiempo = pasarela`; el uplink de la pasarela Milesight sin códec trae `time` **sin zona** en el ejemplo oficial de la guía, **pero la UG65 del campus lo publica con zona** (`"time": "…Z"` en UTC y `gatewayTime` con `-03:00`, captura del 15/10/2026): la marca se acepta cuando trae zona, como la de ChirpStack, y se descarta cuando no la trae (ejemplo oficial: `"time": "2025-04-12T02:56:19"`, https://www.milesight.com/docs/en/mini-gateway/application-guide/uplink-data.html) y con códec el `time` del objeto LoRa no es hora civil («means the time to receive packet after packet forwarder program starts», https://support.milesight-iot.com/support/solutions/articles/73000600064-how-to-use-payload-codec-on-milesight-gateway; ambas consultadas el 15/10/2026) → las dos horas de Milesight se descartan y rige la hora de recepción hasta verificar en terreno qué zona usa la pasarela: una hora sin zona no se adivina (medido el 15/10: Node interpreta `2025-04-12T02:56:19` en la zona del proceso, 06:56 UTC en un equipo en Chile y 02:56 UTC en uno en UTC) | filtro 2 (adaptadores `chirpstack` y `milesight`), filtro 4 | ✅ pruebas unitarias en `lorawan.spec.ts` y banco (`docs/16 §28` y §31) |

## 3. Por qué la regla 4 es la que más importa

Con datos en UTC y un usuario en Santiago que pide «las mediciones del 7 de septiembre»:

```
Santiago (UTC−4, invierno): 07-09 00:00 → 07-09 24:00  ==  UTC 07-09 04:00 → 08-09 04:00
Santiago (UTC−3, verano):   07-09 00:00 → 07-09 24:00  ==  UTC 07-09 03:00 → 08-09 03:00
```

Si el código restara «3 horas» a mano, en invierno el día quedaría corrido una hora y una medición
de las 23:30 caería en el día equivocado. Delegar el cálculo a PostgreSQL con el **nombre** de la
zona resuelve ambos casos y también el día del cambio de hora. Verificado en la base:

| Caso | Resultado |
|---|---|
| Inicio del día en Santiago, abril (UTC−4) | `04:00Z` |
| Inicio del día en Santiago, septiembre (UTC−3) | `03:00Z` |
| Domingo 6-sep-2026, día del salto 00:00 → 01:00 | el día dura **23 h**; su bucket empieza a las `04:00Z` (01:00 local, el primer instante que existe) y el siguiente a las `03:00Z` |
| Medición a las 23:30 del 4-sep (Santiago) | pertenece al **4** con la zona; `::date` sin zona diría el **5** |
| Mes de agosto 2026 en Santiago | empieza el 1 a las `04:00Z` |
| Un sitio en Madrid (UTC+2) con el mismo código | su día empieza a las `22:00Z` de la víspera |

Ese último caso es la prueba de que el modelo es **multi-sitio y multi-país sin un solo `if`**: la
zona es un dato del sitio, no una constante del programa.

Consulta de referencia para el histórico agregado en la zona del sitio:

```sql
SELECT time_bucket($4::interval, m.tiempo, s.zona_horaria) AS intervalo, avg(m.valor)
  FROM medicion m
  JOIN canal c ON c.id = m.canal_id JOIN dispositivo d ON d.id = c.dispositivo_id
  JOIN zona z ON z.id = d.zona_id   JOIN sitio s ON s.id = z.sitio_id
 WHERE m.canal_id = $1 AND m.tiempo >= $2 AND m.tiempo < $3
 GROUP BY intervalo ORDER BY intervalo;
```

## 4. Lo específico de una plataforma de sensores

A diferencia de un sistema de gestión, aquí **quien pone la hora es una máquina**, y eso agrega casos
propios:

| Situación real | Qué hace la plataforma | Por qué |
|---|---|---|
| Nodo sin reloj (ESP32 recién encendido, sin NTP) | Marca ausente → hora de recepción | La hora de llegada es la mejor estimación disponible |
| Reloj sin inicializar (reporta 1970 o 2000) | Marca descartada → hora de recepción | Un instante antes del año 2000 no puede ser una medición real de este sistema |
| Reloj adelantado unos segundos | Se respeta la marca hasta 2 min de adelanto | La deriva de relojes baratos es normal; aplanar esas marcas a la hora de llegada distorsionaría el espaciado de la serie |
| Reloj adelantado horas o días | Marca descartada → hora de recepción | Un tiempo futuro nunca es válido para una medición ya recibida |
| Nodo que estuvo sin cobertura y envía su cola de lecturas acumuladas | **Se respetan** las marcas antiguas | Son mediciones reales de cuando ocurrieron; aplanarlas a la hora de llegada destruiría la serie |
| Un nodo envía hora local «sin zona» como texto | Adaptador: se trata como malformada salvo que el adaptador de ese formato declare la zona del dispositivo | Una hora de pared no es un instante; adivinarla corrompe |
| Marcas en milisegundos en vez de segundos | El adaptador plano detecta `> 1e12` y divide por 1000 | Error frecuente de firmware; se documenta y se acepta |
| Segundos intercalares, años bisiestos | Nada especial: `timestamptz` los maneja | — |
| El día del cambio de hora tiene 23 o 25 horas | Los promedios diarios se calculan sobre las **muestras reales** del bucket (la API entrega `muestras`), nunca dividiendo por 24 | Un reporte que divide por 24 da mal dos días al año |
| La hora repetida al retrasar el reloj | Ninguna clave incluye hora local: `uuid` + `timestamptz` | Con hora local habría dos lecturas «a la misma hora» |
| Zona del dispositivo ≠ zona del dato | La zona se resuelve **al recibir**, una sola vez, y se conserva la trama cruda en cuarentena si hizo falta rechazarla | Dejarlo para el reporte obliga a adivinar después |

**Hora de recepción (decidido e implementado el 06/10/2026, migración 08; `docs/10 §8.4` punto 12).** Cada fila de
`medicion` guarda `recibido_en` (llegada al backend, la toma el pipeline al empezar; el broker no marca la hora) y
`origen_tiempo` con dominio cerrado: `dispositivo` o `pasarela` (lo declara el adaptador cuando la marca es
plausible) o `recepcion` (la regla 7 la descartó; entonces `tiempo` lo pone la base con `clock_timestamp()`). La deriva
del reloj se mide como `recibido_en − tiempo` por dispositivo, solo en filas con origen distinto de `recepcion`.
El **motivo** del descarte (sin marca, antes del 2000, en el futuro) no se guarda por fila: queda en la regla y se
agrega como columna solo si la vista de salud (RF-47) llega a necesitarlo. Las filas anteriores a la 08 quedan con
ambas columnas en NULL (origen desconocido, nunca inventado); la restricción rige para toda fila nueva.

## 5. Señales de alarma en una revisión de código

Cualquiera de estas en un cambio exige justificación escrita:

- `CURRENT_DATE`, `now()::date`, `::date` o `date_trunc(` sobre un `timestamptz` **sin** `AT TIME ZONE` / zona en `time_bucket`.
- Un desfase escrito a mano: `- interval '3 hours'`, `-3`, `-4`, `+ 180`.
- `new Date('YYYY-MM-DD')`, `toISOString()` sobre algo que representa un día, `getDate()/getHours()` para decidir fechas.
- Una `Z` literal pegada con `to_char` sobre un `timestamp` **sin** zona (la `Z` mentiría).
- Una columna `timestamp without time zone` nueva sin comentario que diga «hora de pared elegida por una persona».
- Formatear un instante como texto sin zona y volver a parsearlo (`new Date(texto)`): crea un instante corrido.
- `toISOString().slice(0, 10)` para obtener «el día»: es el día en UTC, no el del sitio.
- `getFullYear() / getMonth() / getDate()` para recortar un día: usan la zona del **proceso** (UTC en el servidor); el código parece trabajar en días y no lo hace.
- `Intl.DateTimeFormat(...).format(new Date('basura'))` **lanza** `RangeError`: una fila corrupta puede tumbar un lote entero; toda fecha externa se valida antes de formatearse.
- Confiar en lo que muestra el cliente gráfico de base de datos: fija su propia zona de sesión; la zona del servidor se verifica desde el mismo driver que usa la aplicación.

## 6. Método para tocar una columna de fecha (aprendido de casos reales de la industria)

1. Clasificar la columna: ¿instante, día o hora de pared? Si no puedes decir «hora de pared elegida
   por una persona» con convicción, es un instante.
2. Seguir el dato completo con `grep` por el **nombre de la columna**: quién lo escribe (`INSERT`/`UPDATE`),
   quién lo lee (`new Date(`, `toISOString`, `getTime`), quién lo pinta.
3. Al cambiar qué devuelve una función de fechas, `grep` de **todos** sus llamadores: uno que la use
   para otra familia se rompe en silencio.
4. Código compatible con el tipo viejo y el nuevo → migración numerada → despliegue. Nunca una
   migración sola ni un despliegue solo.
5. Verificar con fechas de **ambos** desfases (un día de abril y uno de septiembre) y con el día
   del cambio de hora. `tsc` limpio no prueba nada de esto.

## 7. Pruebas reproducibles

| Prueba | Archivo | Cómo se corre |
|---|---|---|
| Buckets por día/mes en la zona, día de 23 h, otras zonas, `iso_utc`, guardias de tipo | `plataforma/db/pruebas/zonas-horarias.sql` | `docker compose exec -T timescaledb psql -U plataforma -d plataforma < db/pruebas/zonas-horarias.sql` |
| API: formato `Z` en todas las fechas (incluidas las de JSON en SQL), buckets a medianoche del sitio, validaciones | `plataforma/pruebas/api-smoke.sh` | `bash pruebas/api-smoke.sh` con el backend arriba |
| Filtro 4: marcas ausentes, en 1970, futuras, en milisegundos | casos manuales del README del backend; automatizar en Etapa 3 (TT-27) | — |

**Cómo se prueba (la parte que casi nadie hace).** A la hora en que uno programa, las dos
interpretaciones suelen dar lo mismo: mirar un dato del mediodía no descarta nada. Dos formas de
hacer que difieran: (a) **elegir el dato**: registros cuyo instante caiga entre las 00:00 y las 03:00 UTC,
donde el día local y el día UTC no coinciden; (b) **mover al observador**: en las herramientas de
desarrollo del navegador, panel *Sensors*, fijar una zona de desfase positivo (Tokio) y **recargar**;
casi cualquier instante de la tarde cae al día siguiente. La predicción única que se verifica: **los
instantes se mueven de día; los días calendario y los buckets del sitio no se mueven nunca**.

**Cómo se escribe una guardia que sirva.** Una guardia que nunca dispara es peor que ninguna: da un
OK falso. Por eso toda guardia de este repositorio se prueba en los dos sentidos —**plantando una
violación** y viendo que la detecta, y comprobando que no marca lo correcto—, y si no puede evaluarse
(pila caída, archivo ausente) **falla, no pasa**.

**Bordes obligatorios** en toda prueba de fechas: un instante entre las 00:00 y las 03:00 UTC; el
día 15 y el último día del mes a las 21:00 hora del sitio (cruzan el día y el mes en UTC); el domingo
del cambio de hora en ambos sentidos.

Previsto para la Etapa 3: prueba automatizada que inserte mediciones a las 23:30 y 00:30 hora de
Santiago en un día de invierno y otro de verano y compruebe que el filtro «por día» las asigna al día
correcto en ambos casos; y plantar una columna `timestamp` sin zona para verificar que la guardia de
tipos la rechaza.
