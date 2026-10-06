# Entrevista — Académico/Investigador en Ingeniería Civil Geológica — 5 de octubre de 2026

- **Modalidad:** cuestionario por correo electrónico (10 preguntas, enviadas el 29/09/2026 a un contacto referido
  por el profesor guía; respuesta recibida el 05/10/2026) · **Autorización de cita:** sí, anonimizada; el
  entrevistado pide identificarse únicamente como «Académico/Investigador en Ingeniería Civil Geológica».
- **Contexto declarado:** responde «desde la parte teórica, sin tener aún los sensores». Es un caso de uso
  planificado, no una instalación en operación.

## Inventario declarado
- **Magnitudes:** concentración de radón (Bq/m³) e hidrógeno geológico (ppm) como principales; presión
  atmosférica, temperatura del suelo y del aire, y humedad del suelo como variables de corrección obligatorias.
- **Dispositivos:** equipos de grado científico para radón (menciona SARAD y RAD7) y sondas de gases en pozo
  para hidrógeno. **No son dispositivos de un fabricante de plataformas IoT.**
- **Cantidad y ubicación:** 5 a 10 sensores en fase piloto; la mayoría en estaciones de terreno a la intemperie
  (fallas geológicas, áreas geotérmicas, pozos); solo 1 o 2 en el campus, para calibración, pruebas de
  transmisión y docencia.
- **Transporte:** Wi-Fi o cable «no es viable»; celular (LTE-M/NB-IoT) si hay cobertura, o LoRaWAN hacia un
  gateway central.
- **Uso:** investigación (modelamiento geológico, riesgos, recursos) y docencia (talleres, laboratorios de
  terreno, trabajos de título).

## Citas textuales
- «Para el análisis científico, el registro del historial (series de tiempo) es lo verdaderamente valioso.»
- «tener acceso a los datos en tiempo real (o con actualizaciones cada un par de horas) es crucial a nivel
  operativo para asegurar que el equipo no ha sido vandalizado, tiene batería y está transmitiendo
  correctamente, evitando viajes inútiles a terreno. Los miraría al menos un par de veces por semana.»
- «Si el sensor deja de reportar (caída del sistema o pérdida de energía), un correo electrónico automático es
  la mejor vía para coordinar una visita de mantenimiento.»
- «Si un valor se sale de rango, basta con que quede registrado y marcado en la plataforma, a menos que el
  salto sea tan anómalo que sugiera un evento geológico importante.»
- «Es absolutamente crítico y no negociable. Las plataformas de los sensores sirven para visualización rápida,
  pero el procesamiento estadístico y geoespacial requiere exportar la data cruda (en .CSV o .XLSX) para
  trabajarla en software especializado como Python, R, MATLAB o sistemas de información geográfica (QGIS/ArcGIS).»
- «Deberían tener acceso completo los investigadores principales del proyecto y los tesistas involucrados.
  Podría habilitarse una vista de lectura o un "dashboard" público simplificado para los estudiantes de
  pregrado en sus cursos. No deberían ser públicos los datos crudos antes de su publicación científica.»
- «Sí, sin duda. Probar el sistema de recolección y telemetría en condiciones reales de terreno sería un
  excelente avance para el proyecto.»

## Incidentes relatados
Ninguno: el proyecto aún no tiene sensores instalados. El riesgo que describe es futuro y operativo: viajes a
terreno inútiles por equipos vandalizados, sin batería o sin transmitir.

## Requerimientos que valida o refuta
| Cita o hecho | Causa | Requerimiento |
|---|---|---|
| Equipos científicos de distintos fabricantes, no de una plataforma IoT | C1, C2 | RF-04 (adaptadores por formato), RNF-12 — **valida** |
| «exportar la data cruda (.CSV o .XLSX)… absolutamente crítico y no negociable» | C3 | RF-34 (exportar CSV y JSON) — **valida y amplía**: pide XLSX; la exportación pasa a ser la función de mayor valor para el investigador |
| «el registro del historial (series de tiempo) es lo verdaderamente valioso» | C3, C5 | RF-33 (historial), RNF-04 — **valida**; el histórico pesa más que el tiempo real |
| «actualizaciones cada un par de horas» bastan a nivel operativo; mira los datos «un par de veces por semana» | — | TT-39 (canal de tiempo real) — **relativiza**: el tiempo real no es prioritario para este usuario |
| Correo automático si el sensor deja de reportar | C5 | RF-24 (detección de silencio), RF-36 y RF-37 (notificación y destinatarios) — **valida** |
| Valor fuera de rango: «basta con que quede registrado y marcado», salvo salto anómalo | C5 | RF-12, RF-13 (condiciones y eventos por umbral), RF-36 (notificar solo severidad configurada) — **valida** el diseño de severidades |
| Saber si el equipo «tiene batería y está transmitiendo» | C5 | RF-28 (batería), RF-47 y RF-48 (estado por dispositivo) — **valida** |
| Investigadores y tesistas con acceso completo; vista de lectura para estudiantes; datos crudos no públicos | C4 | RF-41, RF-43, RF-44 (dos roles) — **valida y amplía**: pide un tercer nivel, vista pública de solo lectura sin datos crudos |
| Terreno sin Wi-Fi: celular o LoRaWAN a un gateway | C2 | RF-02 (rama LoRaWAN), RNF-10 (solo conexiones salientes) — **valida**; agrega el transporte celular como caso a contemplar |
| 5 a 10 sensores, lecturas espaciadas | — | RNF-01 (50 eventos/s) — **no lo exige**; el volumen real es muy inferior |

## Requerimientos nuevos (candidatos [ENT], a incorporar en `docs/02` en la Etapa 3)
1. Magnitudes de gases: radón (Bq/m³) e hidrógeno (ppm); temperatura y humedad **del suelo** como magnitudes
   distintas de las del aire. SenML registra Bq, ppm, Pa, hPa, Cel y %RH; **Bq/m³ no está en el registro IANA**
   (consultado el 05/10/2026): decidir cómo expresarla (unidad propia declarada o Bq con el volumen fijo).
2. Exportación también en XLSX (hoy RF-34 dice CSV y JSON).
3. Vista pública de solo lectura, simplificada, sin datos crudos (tercer rol o enlace público por dashboard).
4. Condición «manipulación» (vandalismo): el modelo de datos ya la contempla como tipo de condición; falta el
   requerimiento que la pida y la fuente del dato (acelerómetro o apertura de caja del equipo).
5. Transporte celular (LTE-M/NB-IoT) como alternativa a LoRaWAN para estaciones sin gateway.

## Contactos derivados (solo roles)
Ninguno nuevo. El entrevistado se ofrece a probar el sistema «en condiciones reales de terreno»: candidato a
usuario de la validación de la Etapa 4 (OE5).

## Cómo entra (docs/03 §4)
Fuente `[ENT]` habilitada para los requerimientos de la tabla; `docs/02` §1.1 y `docs/01` se actualizan en la
Etapa 3; el informe de la Etapa 3 deja de decir «sin respuesta» en §3.1, §5.4 y la conclusión.
