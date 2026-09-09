# Reglas de manejo del tiempo y las zonas horarias

> Regla de diseño transversal (pipeline, base de datos, API, panel). Chile alterna entre UTC−4
> (invierno) y UTC−3 (verano), y la fecha del cambio la fija el gobierno cada año; otros países
> tienen reglas distintas. Un sistema que mezcle horas locales con UTC produce mediciones
> "movidas" y filtros por día que pierden o duplican horas. Versión: 9 de septiembre de 2026.

## Las reglas

| # | Regla | Dónde se aplica |
|---|---|---|
| 1 | **Se almacena siempre en UTC.** Toda columna de tiempo es `timestamptz`; nunca `timestamp` sin zona | `01-esquema.sql` (ya cumplido) |
| 2 | **La marca de tiempo del emisor se interpreta como instante absoluto** (segundos Unix en SenML). Los nodos no manejan zonas horarias: no deben hacerlo | filtro 4 |
| 3 | **Cada sitio declara su zona horaria** (nombre IANA, p. ej. `America/Santiago`), nunca un desfase fijo como «−3»: el nombre incluye las reglas de horario de verano | `sitio.zona_horaria` (migración 03) |
| 4 | **Los filtros por día, semana o mes se resuelven en la zona del sitio, dentro de la base de datos**, no restando horas en el código. «El lunes 7» son las 00:00–24:00 *de Santiago*, que en UTC empiezan a las 03:00 o 04:00 según la época | API de consulta: `time_bucket(intervalo, tiempo, zona)` y `date_trunc('day', tiempo AT TIME ZONE zona)` |
| 5 | **La API entrega instantes en UTC con formato ISO 8601 y sufijo `Z`** (`2026-09-09T03:07:56Z`). Nunca una hora local sin zona | controladores |
| 6 | **El panel convierte a la zona del sitio para mostrar**, con la zona que la API le informa, no con la del navegador del usuario: un administrador viajando debe ver la hora *del sitio* | panel (Svelte) |
| 7 | **No se aceptan tiempos futuros** del emisor (reloj mal puesto → hora de recepción) | filtro 4 (ya cumplido) |
| 8 | **Los rangos de consulta son semiabiertos** `[desde, hasta)`: evita contar dos veces el instante frontera | API |

## Por qué la regla 4 es la que más importa

Con datos en UTC y un usuario en Santiago que pide «las mediciones del 7 de septiembre»:

```
Santiago (UTC−4, invierno): 07-09 00:00 → 07-09 24:00  ==  UTC 07-09 04:00 → 08-09 04:00
Santiago (UTC−3, verano):   07-09 00:00 → 07-09 24:00  ==  UTC 07-09 03:00 → 08-09 03:00
```

Si el código restara «3 horas» a mano, en invierno el día quedaría corrido una hora y una medición de
las 23:30 caería en el día equivocado. Delegar el cálculo a PostgreSQL con el nombre de la zona
resuelve ambos casos y el propio día del cambio de hora (que tiene 23 o 25 horas).

Ejemplo de la consulta correcta para el histórico agregado por hora en la zona del sitio:

```sql
SELECT time_bucket('1 hour', m.tiempo, s.zona_horaria) AS intervalo, avg(m.valor)
  FROM medicion m
  JOIN canal c ON c.id = m.canal_id
  JOIN dispositivo d ON d.id = c.dispositivo_id
  JOIN zona z ON z.id = d.zona_id
  JOIN sitio s ON s.id = z.sitio_id
 WHERE m.canal_id = $1 AND m.tiempo >= $2 AND m.tiempo < $3
 GROUP BY intervalo ORDER BY intervalo;
```

## Verificación prevista (Etapa 3)

Prueba automatizada con mediciones a las 23:30 y 00:30 hora de Santiago en un día de invierno y otro
de verano: el filtro «por día» debe asignarlas al día correcto en ambos casos.
