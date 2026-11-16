import { describe, expect, it, vi } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { AlertasService } from '../alertas/alertas.service.js';
import { BrokerService } from '../broker/broker.service.js';
import { SupervisionService } from '../supervision/supervision.service.js';
import { EventosService } from '../tiempo-real/eventos.service.js';
import { TramaMalformada } from './adaptadores/adaptador.js';
import { ChirpstackAdaptador } from './adaptadores/chirpstack.adaptador.js';
import { IdentidadNoVerificada } from './adaptadores/lorawan.js';
import { resolverClave } from './adaptadores/mapa-claves.js';
import { MilesightAdaptador } from './adaptadores/milesight.adaptador.js';
import { PlanoAdaptador } from './adaptadores/plano.adaptador.js';
import { SenmlAdaptador } from './adaptadores/senml.adaptador.js';
import { inicioDeVentana } from './cuota.js';
import { ContextoTrama, Lectura } from './lectura.js';
import { RecepcionService } from './recepcion.service.js';
import { tiempoPlausible } from './tiempo.js';
import { aCanonica } from './unidades.js';

// ── Matriz del contrato de trama (TT-27) ─────────────────────────────────────────────────────────────────────────────────────
// Una fila por regla del contrato: qué dice la fuente, qué resultado produce el sistema y qué prueba la cubre. Es la única fuente
// de la matriz: la sección que va a docs/16 se genera de esta tabla. Las pruebas de abajo son las de las reglas que no tenían
// prueba (C-NN en el nombre); las demás citan la prueba que ya existía, y el guardián del final comprueba que cada cita existe.
// Fuentes de la RFC: RFC 8428 (SenML), copia local del 16/10/2026. «hallazgo» marca una diferencia entre la fuente y el código
// que el perfil declara (ver docs/10 §4, filtro 2) o que sigue pendiente.
// Los ejemplos de RFC 8428 §5.1 (© IETF Trust) se reproducen textuales, cada uno con su sección, para probar la regla que ilustran.
type Grupo = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g';
interface Cubre { archivo: string; nombre: string }
interface Regla {
  id: string; grupo: Grupo; regla: string; fuente: string; esperado: string; cubre: Cubre[];
  motivo?: string; // grupo f: el motivo de cuarentena que provoca la regla
  adaptador?: string; tipo?: 'valida' | 'malformada'; // grupo g
}
const aqui = (id: string): Cubre => ({ archivo: 'contrato.spec.ts', nombre: id + ' ' });
const svc = (nombre: string): Cubre => ({ archivo: 'recepcion.service.spec.ts', nombre });
const adp = (nombre: string): Cubre => ({ archivo: 'adaptadores/adaptadores.spec.ts', nombre });
const lora = (nombre: string): Cubre => ({ archivo: 'adaptadores/lorawan.spec.ts', nombre });
const tmp = (nombre: string): Cubre => ({ archivo: 'tiempo.spec.ts', nombre });
const uni = (nombre: string): Cubre => ({ archivo: 'unidades.spec.ts', nombre });
const htp = (nombre: string): Cubre => ({ archivo: 'http/recepcion-http.controller.spec.ts', nombre });

const MATRIZ: Regla[] = [
  // (a) Esquema SenML
  { id: 'C-01', grupo: 'a', regla: 'Un registro con n, u y v produce una lectura; el nombre se pasa a minúsculas', fuente: 'RFC 8428 §4.2; senml.adaptador.ts', esperado: 'aceptada: {magnitud en minúsculas, valor, unidad}', cubre: [aqui('C-01')] },
  { id: 'C-02', grupo: 'a', regla: 'bn no se antepone al nombre: n es el código de magnitud del catálogo y la magnitud es n tal cual (diferencia declarada, hallazgo H-3)', fuente: 'RFC 8428 §4.1 y §4.5.1 (ejemplo §5.1.2); senml.adaptador.ts, «(n ?? ctx.magnitudTopico).toLowerCase()»', esperado: 'aceptada: magnitud «voltage», no «urn:…:voltage» (la concatenación queda para el catálogo de alias)', cubre: [aqui('C-02')] },
  { id: 'C-03', grupo: 'a', regla: 'bt se hereda a los registros siguientes y t es relativo a bt', fuente: 'RFC 8428 §4.5.3 (ejemplo §5.1.2)', esperado: 'aceptada: tiempo = bt + t', cubre: [aqui('C-03'), adp('hereda bn/bt/bu')] },
  { id: 'C-04', grupo: 'a', regla: 'bu se hereda y la u del registro gana', fuente: 'RFC 8428 §4.1 y §4.5.2 (ejemplo §5.1.3)', esperado: 'aceptada: unidad del registro, si no la base', cubre: [aqui('C-04')] },
  { id: 'C-05', grupo: 'a', regla: 'bt persiste aunque cambie bn; un bt posterior reemplaza al anterior', fuente: 'RFC 8428 §4 (ejemplo §5.1.6)', esperado: 'aceptada: cada registro con la base vigente', cubre: [aqui('C-05')] },
  { id: 'C-06', grupo: 'a', regla: 'bver igual o menor que 10 (o ausente) se acepta', fuente: 'RFC 8428 §4.1 y §4.4 (ejemplo §5.1.2, bver 5)', esperado: 'aceptada', cubre: [aqui('C-06')] },
  { id: 'C-07', grupo: 'a', regla: 'bver mayor que la versión que se entiende (10), o que no sea un entero positivo, se rechaza en cualquier registro del pack (hallazgo H-4)', fuente: 'RFC 8428 §4.1 (entero positivo) y §4.4: «MUST NOT use this object»', esperado: 'rechazada: malformada «bver 11 no se entiende…» o «bver no es un entero positivo» (corregido el 15/11/2026: antes se aceptaba)', cubre: [aqui('C-07')] },
  { id: 'C-08', grupo: 'a', regla: 'Un campo que no se conoce se ignora', fuente: 'RFC 8428 §4.4: «MUST ignore fields they don\'t recognize»', esperado: 'aceptada: el campo no cambia la lectura', cubre: [aqui('C-08')] },
  { id: 'C-09', grupo: 'a', regla: 'Un campo desconocido cuya etiqueta termina en «_» es un error, también en un registro sin valor (hallazgo H-5)', fuente: 'RFC 8428 §4.4: «in which case an error MUST be generated»', esperado: 'rechazada: malformada «campo … desconocido y de los que no se pueden ignorar» (corregido el 15/11/2026: antes se ignoraba)', cubre: [aqui('C-09')] },
  { id: 'C-10', grupo: 'a', regla: 'v debe ser un número finito; cadena, nulo, booleano o desborde se rechazan', fuente: 'RFC 8428 §4.3 (tipo de v); senml.adaptador.ts, «typeof r.v !== \'number\' || !Number.isFinite(r.v)»', esperado: 'rechazada: malformada «v no numérico»', cubre: [aqui('C-10'), adp('rechaza JSON inválido, pack vacío y valores no numéricos')] },
  { id: 'C-11', grupo: 'a', regla: 'Los registros solo con vs, vb o vd se omiten: el sistema guarda solo valores numéricos', fuente: 'RFC 8428 §4.2 y §5.1.5; senml.adaptador.ts, «if (r.v === undefined) continue»', esperado: 'aceptada: solo la lectura numérica', cubre: [aqui('C-11')] },
  { id: 'C-97', grupo: 'a', regla: 'De punta a punta, bv + v es el valor que se guarda (y el rango físico se evalúa sobre esa suma)', fuente: 'RFC 8428 §4.5.4; docs/10 §4 (filtros 2 y 3)', esperado: 'bv 10, v 5 en Cel: se guarda 15; bv 80, v 10: 90 Cel fuera del rango, a cuarentena invalida', cubre: [aqui('C-97')] },
  { id: 'C-104', grupo: 'a', regla: 'bt, t, bu, n y u con un tipo equivocado (bt o t que no es un número finito; bu, n o u que no es texto) se rechazan, también en un registro sin valor', fuente: 'RFC 8428 §4.3, Tabla 1 (bt y t: número; bu: cadena); senml.adaptador.ts, revisarPerfil', esperado: 'rechazada: malformada «bt no numérico», «t no numérico» o «bu no es texto» (antes se ignoraban en silencio)', cubre: [aqui('C-104')] },
  { id: 'C-105', grupo: 'a', regla: 'Todos los registros de un pack tienen la misma versión: un bver distinto del vigente se rechaza (un registro sin bver cuenta como 10 hasta que un bver explícito fije la versión)', fuente: 'RFC 8428 §4.4: «All SenML Records in a Pack MUST have the same version number»', esperado: 'rechazada: malformada «bver 5 distinto del 10 del resto del pack…»; un solo bver en el primer registro, o el mismo repetido, se acepta', cubre: [aqui('C-105')] },
  { id: 'C-12', grupo: 'a', regla: 'Un registro con solo campos base (sin valor) no genera lectura', fuente: 'RFC 8428 §4 (ejemplo §5.1.7); senml.adaptador.ts, «if (r.v === undefined) continue»', esperado: 'aceptada: sin lectura para ese registro', cubre: [aqui('C-12')] },
  { id: 'C-13', grupo: 'a', regla: 'Un pack sin ninguna lectura numérica se rechaza', fuente: 'RFC 8428 §4.2 (el valor es obligatorio salvo con s); senml.adaptador.ts, «throw new TramaMalformada(\'pack sin valores\')»', esperado: 'rechazada: malformada «pack sin valores»', cubre: [aqui('C-13')] },
  { id: 'C-14', grupo: 'a', regla: 'bv se suma al v de su registro y de los siguientes hasta el próximo bv; sin v no hay lectura; los valores no numéricos no lo reciben; un bv no numérico o una suma que desborda se rechazan (hallazgo H-6)', fuente: 'RFC 8428 §4.1 y §4.5.4: «added together to get the value»', esperado: 'aceptada: valor = bv + v (bv 10, v 5 → 15); rechazada: malformada «bv no numérico» o «bv + v fuera del rango numérico» (corregido el 15/11/2026: antes se ignoraba bv)', cubre: [aqui('C-14')] },
  { id: 'C-15', grupo: 'a', regla: 'Un registro con más de un campo de valor (v, vs, vb, vd) se rechaza (hallazgo H-7)', fuente: 'RFC 8428 §4.2: «Exactly one Value field MUST appear»', esperado: 'rechazada: malformada «más de un campo de valor en un registro» (corregido el 15/11/2026: antes se aceptaba y valía v)', cubre: [aqui('C-15')] },
  { id: 'C-16', grupo: 'a', regla: 'Un n que no es cadena se rechaza como trama malformada (hallazgo H-1)', fuente: 'RFC 8428 §4.3 (n es cadena); adaptadores/adaptador.ts:13 («Lanza Error si el contenido es inválido»); recepcion.service.ts:232', esperado: 'rechazada, malformada «n no es texto» (corregido el 15/11/2026: antes lanzaba TypeError)', cubre: [aqui('C-16')] },
  { id: 'C-17', grupo: 'a', regla: 'Un elemento del pack que no es objeto se rechaza', fuente: 'RFC 8428 §5; senml.adaptador.ts, «throw new TramaMalformada(\'registro no es objeto\')»', esperado: 'rechazada: malformada «registro no es objeto»', cubre: [aqui('C-17')] },
  { id: 'C-18', grupo: 'a', regla: 'El adaptador SenML reconoce solo arreglos JSON', fuente: 'RFC 8428 §5: «The root JSON value consists of an array»', esperado: 'reconoce: arreglo sí; objeto o número no', cubre: [adp('reconoce un pack (arreglo JSON)')] },
  // (b) Tiempo
  { id: 'C-20', grupo: 'b', regla: 'Sin marca de tiempo rige la hora de recepción', fuente: 'docs/13 regla 7; RFC 8428 §4.5.3 (cero = «ahora»)', esperado: 'aceptada: tiempo de recepción, origen_tiempo recepcion', cubre: [tmp('sin marca → hora de recepción'), svc('sin marca del emisor → origen_tiempo "recepcion"')] },
  { id: 'C-21', grupo: 'b', regla: 'Un tiempo relativo (bt + t menor que 2^28) se resuelve como dice la RFC: negativo es «ahora» menos esos segundos; cero o positivo (futuro relativo) rige la hora de recepción; desde 2^28 es absoluto (hallazgo H-8)', fuente: 'RFC 8428 §4.5.3; docs/13 reglas 7 y 19', esperado: 't = −5: la hora de recepción menos 5 s (origen dispositivo); t = 0, 10 o 268435455: recepción; un pasado relativo anterior al año 2000: recepción (corregido el 15/11/2026: antes se perdía el desfase)', cubre: [aqui('C-21')] },
  { id: 'C-98', grupo: 'b', regla: 'De punta a punta, un tiempo relativo negativo se guarda como la hora de recepción menos esos segundos (origen dispositivo); uno cero o positivo, con la hora de recepción', fuente: 'RFC 8428 §4.5.3; docs/13 reglas 7 y 19', esperado: 't = −30: marca del emisor ≈ ahora − 30 s; t = 0: origen_tiempo recepcion (sin marca guardada)', cubre: [aqui('C-98')] },
  { id: 'C-102', grupo: 'b', regla: 'El «ahora» de los tiempos relativos es uno solo por trama: todos los registros de un pack comparten el mismo instante cuando falta recibidoEn', fuente: 'RFC 8428 §4.5.3 («relative to the current time»); senml.adaptador.ts, «const ahora»', esperado: 'tres registros con t = −10: tres marcas iguales y una sola lectura del reloj', cubre: [aqui('C-102')] },
  { id: 'C-103', grupo: 'b', regla: 'La hora de recepción que llega a la lectura es la que la vía tomó al entrar la trama, por MQTT y por HTTP, aunque la base tarde en responder', fuente: 'docs/10 §4 (filtro 2); recepcion.service.ts, procesar y procesarHttp', esperado: 'recibidoEn del adaptador y recibido_en de la medición son el instante de entrada; t = −5 se guarda como ese instante menos 5 s', cubre: [aqui('C-103')] },
  { id: 'C-22', grupo: 'b', regla: 'Una marca absoluta plausible se respeta, también la antigua posterior al año 2000 (cola sin cobertura)', fuente: 'docs/13 regla 7', esperado: 'aceptada: la marca del emisor, origen dispositivo', cubre: [tmp('marca antigua pero posterior a 2000'), svc('marca del emisor plausible')] },
  { id: 'C-23', grupo: 'b', regla: 'El umbral es el 1 de enero de 2000 UTC: anterior (incluido 1970) rige la recepción; esa fecha exacta se respeta', fuente: 'docs/13 regla 7; tiempo.ts:15', esperado: '1999-12-31T23:59:59Z y 1970: recepción; 2000-01-01T00:00:00Z: la marca', cubre: [aqui('C-23'), tmp('marca anterior al año 2000')] },
  { id: 'C-24', grupo: 'b', regla: 'Hasta 2 min de adelanto se respeta la marca; más, rige la recepción', fuente: 'docs/13 regla 7', esperado: '+120 s: la marca; +121 s o 2030: recepción', cubre: [tmp('adelanto de hasta 2 minutos'), tmp('más de 2 minutos en el futuro')] },
  { id: 'C-25', grupo: 'b', regla: 'En milisegundos: SenML usa segundos, así que una marca en ms cae en un futuro lejano y rige la recepción; el formato plano acepta ms (más de 1e12)', fuente: 'RFC 8428 §4.5.3 (segundos); docs/13 fila «Filtro 4: … en milisegundos»; plano.adaptador.ts:38', esperado: 'SenML en ms: recepción; plano en ms: la marca', cubre: [aqui('C-25'), adp('tiempo en segundos o milisegundos')] },
  { id: 'C-26', grupo: 'b', regla: 'Una marca imposible (desborde) no lanza: rige la recepción', fuente: 'docs/13 regla 16', esperado: 'aceptada: recepción', cubre: [aqui('C-26'), tmp('fecha inválida')] },
  { id: 'C-27', grupo: 'b', regla: 'Marca de pasarela a más de 10 min atrás (o 2 adelante): rige la recepción y se abre reloj_desviado', fuente: 'docs/13 regla 18', esperado: 'aceptada con tiempo de recepción; condición reloj_desviado', cubre: [tmp('pasarela justo 10 min atrás'), tmp('más de 2 min en el futuro'), svc('marca de pasarela 4 días atrasada')] },
  { id: 'C-28', grupo: 'b', regla: 'Marca de pasarela dentro de 10 min se respeta; la de un dispositivo, aunque tenga días, también', fuente: 'docs/13 reglas 7 y 18', esperado: 'aceptada con la marca; no abre reloj_desviado', cubre: [svc('marca de pasarela 9 min atrás'), svc('una marca de DISPOSITIVO 4 días atrás')] },
  { id: 'C-29', grupo: 'b', regla: 'La hora de una trama LoRaWAN es RFC 3339 con zona; sin zona no se adivina', fuente: 'docs/13 regla 17; lorawan.ts:46-49', esperado: 'con zona: marca de pasarela; sin zona: sin marca', cubre: [lora('una hora sin zona → sin marca'), lora('time sin zona → sin marca')] },
  { id: 'C-30', grupo: 'b', regla: 'origen_tiempo dice quién puso la marca: dispositivo, pasarela o recepcion', fuente: 'docs/10 §8.4 punto 12; docs/13 regla 7', esperado: 'columna origen_tiempo según el adaptador y la plausibilidad', cubre: [svc('marca del emisor plausible'), svc('sin marca del emisor → origen_tiempo "recepcion"')] },
  { id: 'C-31', grupo: 'b', regla: 'La misma lectura (canal más instante del emisor) dos veces cuenta una sola', fuente: 'docs/10 §4.1 (RF-10); recepcion.service.ts:324', esperado: 'duplicada: sin evento nuevo ni umbral', cubre: [svc('TT-39: lectura repetida')] },
  // (c) Unidades y magnitudes
  { id: 'C-32', grupo: 'c', regla: 'La unidad canónica o la ausencia de unidad deja el valor tal cual', fuente: 'lectura.ts: «si falta, se asume la canónica»; unidades.ts', esperado: 'aceptada: mismo valor', cubre: [uni('misma unidad o sin unidad')] },
  { id: 'C-33', grupo: 'c', regla: 'Alias convertibles: K, °F y F a Cel; Pa, kPa y bar a hPa; % a %RH o %EL; mV a V', fuente: 'unidades.ts; docs/10 §8.4 punto 51; RFC 8798 §3', esperado: 'aceptada: valor en la unidad canónica', cubre: [uni('Kelvin y Fahrenheit'), uni('presión: Pa, kPa y bar'), uni('porcentaje genérico'), uni('mV (unidad secundaria'), aqui('C-33')] },
  { id: 'C-100', grupo: 'c', regla: 'Un valor finito que deja de serlo al convertirse a la unidad canónica (1e306 bar son 1e309 hPa) se rechaza aunque el canal no tenga rango máximo', fuente: 'docs/10 §4.1 (la lectura imposible no se guarda); recepcion.service.ts, «Number.isFinite(convertido)»', esperado: 'rechazada: invalida «no cabe en un número finito al convertirlo a hPa»; lo que cabe (1e305 bar) se guarda', cubre: [aqui('C-100')] },
  { id: 'C-101', grupo: 'c', regla: 'Un -0 (en v, en bv o como resultado de una conversión) se guarda como 0', fuente: 'RFC 8428 §4.3 (v es un número JSON; la copia local de la RFC no dice nada del cero negativo); docs/10 §4.1; recepcion.service.ts, «convertido === 0 ? 0 : convertido»', esperado: 'aceptada: se guarda 0, nunca -0', cubre: [aqui('C-101')] },
  { id: 'C-34', grupo: 'c', regla: 'Una unidad que no se sabe convertir se rechaza', fuente: 'unidades.ts: «mejor rechazar que adivinar»; docs/10 filtro 3', esperado: 'rechazada: invalida «unidad X no convertible a Y»', cubre: [svc('filtro 3: unidad no convertible')] },
  { id: 'C-35', grupo: 'c', regla: 'No existe la conversión inversa ni entre magnitudes distintas', fuente: 'unidades.ts', esperado: 'sin conversión: la lectura se rechaza como en C-34', cubre: [uni('pareja desconocida'), uni('V a mV no se inventa')] },
  { id: 'C-36', grupo: 'c', regla: 'Una magnitud sin canal declarado se rechaza', fuente: 'docs/10 filtro 3; recepcion.service.ts:301', esperado: 'rechazada: invalida «canal no declarado»', cubre: [svc('filtro 3: canal no declarado')] },
  { id: 'C-37', grupo: 'c', regla: 'El rango físico se evalúa sobre el valor ya convertido y sus límites son inclusivos', fuente: 'docs/08 (magnitud.rango_min y rango_max); recepcion.service.ts:309', esperado: '85 °C se guarda; 85,01 °C y 360 K se rechazan: invalida «fuera del rango físico»', cubre: [aqui('C-37'), svc('filtro 3: valor fuera del rango físico')] },
  { id: 'C-38', grupo: 'c', regla: 'Cada clave del mapa de claves apunta a una magnitud del catálogo con su unidad canónica', fuente: 'docs/10 §8.4 punto 47; mapa-claves.ts', esperado: 'ninguna clave apunta a una magnitud inexistente', cubre: [lora('cada clave del mapa → una magnitud del catálogo')] },
  { id: 'C-39', grupo: 'c', regla: 'Todo destino de una conversión es una unidad canónica del catálogo', fuente: 'unidades.ts; docs/08 (magnitud.unidad_canonica)', esperado: 'ninguna conversión desemboca en una unidad que ninguna magnitud usa', cubre: [aqui('C-39')] },
  // (d) Tamaño y forma del sobre
  { id: 'C-40', grupo: 'd', regla: 'Un cuerpo vacío no lo reconoce ningún formato', fuente: 'docs/10 §4.1 (tabla de casos); recepcion.service.ts:223', esperado: 'rechazada: malformada «la trama no tiene esa forma»; el dispositivo se marca vivo', cubre: [svc('cuerpo vacío → ningún adaptador lo reconoce')] },
  { id: 'C-41', grupo: 'd', regla: 'Un JSON ilegible se rechaza', fuente: 'RFC 8428 §5; senml.adaptador.ts, «throw new TramaMalformada(\'JSON inválido\')»', esperado: 'rechazada: malformada «JSON inválido»', cubre: [aqui('C-41'), adp('rechaza JSON inválido, pack vacío y valores no numéricos')] },
  { id: 'C-42', grupo: 'd', regla: 'Si el formato declarado es SenML y el cuerpo no es una lista, se rechaza', fuente: 'RFC 8428 §5; docs/10 §8.4 punto 47', esperado: 'rechazada: malformada «formato declarado senml: la trama no tiene esa forma»', cubre: [aqui('C-42'), svc('plano a un dispositivo que declaró senml')] },
  { id: 'C-43', grupo: 'd', regla: 'Una lista vacía se rechaza', fuente: 'RFC 8428 §5; senml.adaptador.ts, «throw new TramaMalformada(\'pack SenML vacío\')»', esperado: 'rechazada: malformada «pack SenML vacío»', cubre: [aqui('C-43'), adp('rechaza JSON inválido, pack vacío y valores no numéricos')] },
  { id: 'C-44', grupo: 'd', regla: 'No hay un máximo de registros por pack: lo acota el presupuesto de lecturas por hora, y lo que no cabe se rechaza entero', fuente: 'docs/10 §8.4 punto 53', esperado: 'rechazada entera: cuarentena «tope»', cubre: [svc('la trama que no cabe en el presupuesto'), svc('el presupuesto sale del dispositivo')] },
  { id: 'C-45', grupo: 'd', regla: 'Una trama de más de 64 KiB no entra: el broker la corta (max_packet_size) y la vía HTTP responde 413', fuente: 'docs/10 §8.4 puntos 19 (b) y 52; mosquitto.conf; main.ts:41', esperado: 'MQTT: el broker no entrega; HTTP: 413', cubre: [aqui('C-45')] },
  { id: 'C-46', grupo: 'd', regla: 'El texto de afuera (claves, DevEUI, segmentos del tópico) va recortado y sin caracteres invisibles al detalle y al registro', fuente: 'texto.ts; lorawan.ts:15', esperado: 'detalle de cuarentena con «?» en lugar de los controles y recorte por caracteres', cubre: [lora('una clave larga o con saltos de línea'), lora('los espacios invisibles y los rellenos'), svc('los segmentos del tópico se limpian')] },
  { id: 'C-47', grupo: 'd', regla: 'Por HTTP, un tipo de contenido que no es JSON ni texto se rechaza antes del token', fuente: 'docs/10 §8.4 punto 52; recepcion-http.controller.ts:19', esperado: 'HTTP 415', cubre: [htp('el tipo de contenido se revisa antes que el token')] },
  { id: 'C-48', grupo: 'd', regla: 'Por HTTP, una trama malformada o sin lectura útil responde 422; si solo trae lecturas repetidas, 202', fuente: 'docs/10 §8.4 punto 52; recepcion-http.controller.ts:112', esperado: 'HTTP 422 con el detalle, o 202', cubre: [htp('malformada o sin ninguna lectura útil')] },
  { id: 'C-49', grupo: 'd', regla: 'El formato plano reconoce un número solo con la forma estricta -?dígitos[.dígitos]', fuente: 'plano.adaptador.ts:18 y :24', esperado: '«21.5» y «-3» sí; «1e3», «+5», «.5» y «0x10» no', cubre: [aqui('C-49'), adp('reconoce un número o un objeto')] },
  { id: 'C-94', grupo: 'd', regla: 'El nombre y la unidad de un registro SenML (texto del emisor) van recortados y sin caracteres de control al detalle de la cuarentena y al registro (hallazgo H-9)', fuente: 'texto.ts:1-4 («va al detalle de una cuarentena o al registro: recortado … sin nada invisible»); recepcion.service.ts:301 y :306', esperado: 'nombre de hasta 40 caracteres y unidad de hasta 32, sin caracteres de control (corregido el 15/11/2026: antes llegaban crudos)', cubre: [aqui('C-94')] },
  // (e) Identidad y tópico
  { id: 'C-50', grupo: 'e', regla: 'Un tópico fuera de los dos patrones se rechaza antes del filtro 1', fuente: 'docs/10 §4.1; recepcion.service.ts:120', esperado: 'rechazada: malformada; nadie se marca vivo', cubre: [svc('tópico fuera del patrón'), svc('una forma a medias')] },
  { id: 'C-51', grupo: 'e', regla: 'Un identificador sin alta se rechaza', fuente: 'docs/10 §4 filtro 1; docs/06 §3.2', esperado: 'rechazada: no_registrado; no se marca vivo', cubre: [svc('dispositivo no registrado'), aqui('C-65')] },
  { id: 'C-52', grupo: 'e', regla: 'Un dispositivo dado de baja se rechaza, atribuido a él', fuente: 'docs/10 §4.1; docs/06 §3.2', esperado: 'rechazada: dado_de_baja; no se marca vivo', cubre: [svc('dispositivo dado de baja'), svc('no registrado → sin dispositivo_id; dado de baja')] },
  { id: 'C-53', grupo: 'e', regla: 'El sitio del tópico debe ser el del alta', fuente: 'docs/10 §8.4 punto 24', esperado: 'rechazada: no_registrado «registrado en el sitio X, no en Y»', cubre: [svc('filtro 1: tópico con el sitio de otra sede')] },
  { id: 'C-54', grupo: 'e', regla: 'La identidad sale del tópico y la credencial, no del cuerpo: un bn de otro dispositivo no cambia a quién se atribuye (hallazgo H-2)', fuente: 'docs/10 §4 (perfil de SenML: «No identifica `bn`») y filtro 1 (el tópico y la credencial); docs/06 §3 («La identidad no viene dentro de la trama»); recepcion.service.ts, la consulta del filtro 1 recibe el identificador del tópico', esperado: 'aceptada y atribuida al dispositivo del tópico; ninguna consulta recibe el bn', cubre: [aqui('C-54')] },
  { id: 'C-55', grupo: 'e', regla: 'El nombre del registro gana; si falta, rige la magnitud del tópico', fuente: 'senml.adaptador.ts, «(n ?? ctx.magnitudTopico).toLowerCase()»; README del backend', esperado: 'magnitud del registro; sin n, la del tópico', cubre: [aqui('C-55'), adp('sin nombre en el registro, la magnitud sale del tópico')] },
  { id: 'C-56', grupo: 'e', regla: 'La magnitud del tópico se pasa a minúsculas', fuente: 'recepcion.service.ts:127', esperado: 'una trama en «…/Temperatura» usa el canal «temperatura»', cubre: [aqui('C-56')] },
  { id: 'C-57', grupo: 'e', regla: 'Una pasarela sin alta, inactiva o de otro sitio se rechaza, con cualquier evento', fuente: 'docs/10 §8.4 punto 47', esperado: 'rechazada: no_registrado; nadie se marca vivo', cubre: [svc('pasarela sin alta, inactiva o de otro sitio')] },
  { id: 'C-58', grupo: 'e', regla: 'El DevEUI del tópico, en minúsculas, debe ser un nodo asociado a esa pasarela', fuente: 'docs/10 §8.4 punto 47', esperado: 'sin asociación: no_registrado', cubre: [svc('DevEUI no asociado a esa pasarela'), svc('el DevEUI del tópico se busca en minúsculas')] },
  { id: 'C-59', grupo: 'e', regla: 'El DevEUI del cuerpo debe ser el del tópico', fuente: 'docs/10 §4.1 y §8.4 punto 47', esperado: 'rechazada: malformada; el nodo no se marca vivo', cubre: [svc('DevEUI del cuerpo distinto del tópico'), lora('DevEUI del cuerpo distinto del tópico')] },
  { id: 'C-60', grupo: 'e', regla: 'Un evento de pasarela que no es «up» se anota y termina', fuente: 'docs/10 §8.4 punto 47 y la tabla de casos del §4.1', esperado: 'sin cuarentena ni escritura en la base', cubre: [svc('un evento distinto de «up» (join)')] },
  { id: 'C-61', grupo: 'e', regla: 'El formato lo fija el alta y no se adivina; uno de pasarela solo entra por el tópico de pasarela y uno directo, por el suyo', fuente: 'docs/10 §8.4 punto 47', esperado: 'rechazada: malformada «no se recibe por este tópico» o «la trama no tiene esa forma»', cubre: [svc('SenML a un dispositivo que declaró plano'), svc('un formato de pasarela por el tópico de un dispositivo directo'), svc('un formato directo por el tópico de pasarela')] },
  { id: 'C-62', grupo: 'e', regla: 'La forma nativa device/<deveui>/event/up es equivalente a <deveui>/up', fuente: 'docs/10 §4.1 (tabla de casos); recepcion.service.ts:28', esperado: 'mismo filtro 1 y misma lectura', cubre: [svc('sufijo nativo device/<deveui>/event/up')] },
  { id: 'C-63', grupo: 'e', regla: 'Un DevEUI con caracteres que no son letras ASCII, dígitos ni guion no identifica al nodo', fuente: 'docs/10 §4.1 (tabla de casos); lorawan.ts:33', esperado: 'rechazada: malformada (IdentidadNoVerificada); el nodo no se marca vivo', cubre: [lora('un DevEUI del cuerpo con controles')] },
  { id: 'C-64', grupo: 'e', regla: 'Por HTTP, el identificador y el token deben tener su forma antes de consultar la base', fuente: 'docs/10 §8.4 punto 52', esperado: 'HTTP 401 sin consultar la base y sin contar para los bloqueos', cubre: [htp('token ausente, con otra forma o un id imposible'), htp('un token sin forma o un id imposible dan 401')] },
  // (f) Cuarentena: una fila por motivo de la lista cerrada
  { id: 'C-65', grupo: 'f', regla: 'no_registrado: identificador, pasarela, nodo o sitio sin alta', fuente: 'docs/08 §2 (cuarentena); migración 19 (ck_cuarentena_motivo)', esperado: 'fila de cuarentena con motivo no_registrado y detalle', cubre: [aqui('C-65')], motivo: 'no_registrado' },
  { id: 'C-66', grupo: 'f', regla: 'dado_de_baja: dispositivo dado de baja que sigue publicando (credencial viva)', fuente: 'docs/08 §2 (cuarentena); docs/10 §4.1', esperado: 'fila de cuarentena con motivo dado_de_baja y la pista de revocar la credencial', cubre: [aqui('C-66')], motivo: 'dado_de_baja' },
  { id: 'C-67', grupo: 'f', regla: 'malformada: el adaptador del formato declarado no entiende la trama (o el tópico no calza)', fuente: 'docs/08 §2 (cuarentena); docs/10 filtro 2', esperado: 'fila de cuarentena con motivo malformada; el dispositivo autenticado se marca vivo', cubre: [aqui('C-67')], motivo: 'malformada' },
  { id: 'C-96', grupo: 'f', regla: 'Cada regla estricta del perfil SenML termina en cuarentena malformada con su motivo, sin lecturas, y el mensaje se confirma', fuente: 'docs/10 §4.1 (la trama que no calza con el formato declarado); recepcion.service.ts, el catch del filtro 2', esperado: 'una fila malformada «formato declarado senml: <motivo>» por trama; el dispositivo se marca vivo; el procesamiento termina sin lanzar (el broker confirma)', cubre: [aqui('C-96')], motivo: 'malformada' },
  { id: 'C-68', grupo: 'f', regla: 'invalida: la lectura no pasa el filtro 3 (canal, unidad o rango)', fuente: 'docs/08 §2 (cuarentena); docs/10 filtro 3', esperado: 'fila de cuarentena con motivo invalida; las lecturas buenas de la misma trama se guardan', cubre: [aqui('C-68')], motivo: 'invalida' },
  { id: 'C-69', grupo: 'f', regla: 'tope: la trama no cabe en el presupuesto de lecturas de la hora', fuente: 'docs/10 §8.4 punto 53; migración 19', esperado: 'fila de cuarentena con motivo tope; la trama se rechaza entera', cubre: [aqui('C-69')], motivo: 'tope' },
  { id: 'C-70', grupo: 'f', regla: 'La lista de motivos del código es el dominio cerrado del CHECK de la base', fuente: 'docs/08 §6 (dominios cerrados); migración 19', esperado: 'el tipo Motivo y ck_cuarentena_motivo (última migración) tienen los mismos valores', cubre: [aqui('C-70')] },
  { id: 'C-71', grupo: 'f', regla: 'Una trama con varias lecturas malas deja una sola fila, con todos los porqués', fuente: 'recepcion.service.ts:293', esperado: 'una fila invalida con los motivos separados por «; »', cubre: [svc('dos lecturas inválidas en una trama')] },
  { id: 'C-72', grupo: 'f', regla: 'Una lectura buena y una mala de la misma trama: la buena se guarda y la mala va a cuarentena', fuente: 'recepcion.service.ts:293', esperado: 'una medición, una fila invalida y la trama cruda', cubre: [svc('una lectura buena y una mala')] },
  { id: 'C-73', grupo: 'f', regla: 'Con la cuota de cuarentena de la hora llena, la trama rechazada solo se cuenta', fuente: 'docs/10 §8.4 punto 53 (iii)', esperado: 'ninguna fila nueva; se suma a omitidas', cubre: [svc('cuota de cuarentena: con la cuota de la hora llena'), svc('lo que el filtro 1 rechaza tiene cuota en memoria')] },
  { id: 'C-74', grupo: 'f', regla: 'Una trama LoRaWAN que repite el fCnt de la última guardada se descarta sin cuarentena', fuente: 'docs/10 §4.1', esperado: 'sin lecturas ni fila de cuarentena; el nodo se marca vivo', cubre: [svc('el mismo fCnt que la última trama guardada')] },
  { id: 'C-75', grupo: 'f', regla: 'Un rechazo del filtro 2 o 3 marca vivo al dispositivo autenticado; uno del filtro 1 o sin identidad verificada, no', fuente: 'docs/10 §4 y §4.1', esperado: 'visto_por_ultima_vez solo para quien pasó el filtro 1', cubre: [svc('trama malformada de un dispositivo conocido'), svc('cuerpo sin DevEUI, JSON roto o sin la forma')] },
  { id: 'C-76', grupo: 'f', regla: 'La cuarentena guarda la trama cruda y atribuye el dispositivo cuando se sabe cuál es', fuente: 'docs/08 §4 (decisión de cuarentena)', esperado: 'payload_crudo y dispositivo_id (nulo si no hay alta)', cubre: [svc('no registrado → sin dispositivo_id')] },
  // (g) Adaptadores
  { id: 'C-77', grupo: 'g', adaptador: 'senml', tipo: 'valida', regla: 'SenML: un pack válido con varios registros produce varias lecturas', fuente: 'RFC 8428 §5; senml.adaptador.ts', esperado: 'una lectura por registro con valor', cubre: [adp('hereda bn/bt/bu y produce varias lecturas'), aqui('C-02')] },
  { id: 'C-78', grupo: 'g', adaptador: 'senml', tipo: 'malformada', regla: 'SenML: un pack malformado se rechaza', fuente: 'RFC 8428 §5; senml.adaptador.ts', esperado: 'rechazada: malformada', cubre: [adp('rechaza JSON inválido, pack vacío y valores no numéricos'), aqui('C-17')] },
  { id: 'C-79', grupo: 'g', adaptador: 'plano', tipo: 'valida', regla: 'Plano: un número solo (magnitud del tópico) o un objeto con v, u, t', fuente: 'plano.adaptador.ts', esperado: 'una lectura', cubre: [adp('número a secas → una lectura'), adp('objeto con nombres tolerantes')] },
  { id: 'C-80', grupo: 'g', adaptador: 'plano', tipo: 'valida', regla: 'Plano: cada sinónimo (valor, v, value; unidad, u, unit; tiempo, t, ts, time) se reconoce, y el primero de la lista gana', fuente: 'plano.adaptador.ts:34-38', esperado: 'la misma lectura con cualquiera de los nombres', cubre: [aqui('C-80')] },
  { id: 'C-81', grupo: 'g', adaptador: 'plano', tipo: 'malformada', regla: 'Plano: sin valor numérico o con JSON ilegible se rechaza', fuente: 'plano.adaptador.ts:32-35', esperado: 'rechazada: malformada', cubre: [adp('sin valor numérico → malformada'), aqui('C-81')] },
  { id: 'C-99', grupo: 'g', adaptador: 'plano', tipo: 'valida', regla: 'Las reglas del perfil (bver, «_», un solo valor, bv, tiempo relativo) son de SenML: plano y los de pasarela no las aplican', fuente: 'docs/10 §4 (filtro 2); plano.adaptador.ts y chirpstack.adaptador.ts', esperado: 'aceptadas: un objeto plano o un evento de ChirpStack con esos nombres de campo se leen como antes', cubre: [aqui('C-99')] },
  { id: 'C-95', grupo: 'g', adaptador: 'plano', tipo: 'malformada', regla: 'Plano: un número a secas que no cabe en un número finito (más de 308 cifras) se rechaza', fuente: 'docs/10 §4.1 (la trama que no calza va a cuarentena malformada); plano.adaptador.ts, «function finito»', esperado: 'rechazada: malformada «valor fuera del rango numérico» (corregido el 15/11/2026: antes se guardaba Infinity)', cubre: [aqui('C-95')] },
  { id: 'C-82', grupo: 'g', adaptador: 'chirpstack', tipo: 'valida', regla: 'ChirpStack: un evento up con object produce lecturas con la unidad canónica del mapa y la marca del servidor de red', fuente: 'docs/10 §8.4 punto 47; chirpstack.adaptador.ts', esperado: 'lecturas con tiempo RFC 3339', cubre: [lora('lecturas desde object, con la marca del servidor de red')] },
  { id: 'C-83', grupo: 'g', adaptador: 'chirpstack', tipo: 'malformada', regla: 'ChirpStack: sin deviceInfo no hay identidad; sin object ni perfil se rechaza diciendo qué falta', fuente: 'chirpstack.adaptador.ts:33-39', esperado: 'rechazada: IdentidadNoVerificada, o malformada con la instrucción', cubre: [aqui('C-83'), lora('sin object (el perfil no tiene decodificador)')] },
  { id: 'C-84', grupo: 'g', adaptador: 'chirpstack', tipo: 'valida', regla: 'ChirpStack: hereda devEui (verificado contra el tópico), time (origen pasarela) y fCnt (deduplicación)', fuente: 'docs/10 §4.1 y §8.4 punto 47', esperado: 'ctx.fcnt anotado; origen_tiempo pasarela', cubre: [lora('ChirpStack sin object y con perfil'), aqui('C-84')] },
  { id: 'C-85', grupo: 'g', adaptador: 'milesight', tipo: 'valida', regla: 'Milesight: con códec y Metadata, las claves decodificadas pasan por el mapa; los metadatos no son claves ignoradas', fuente: 'docs/10 §8.4 punto 47; milesight.adaptador.ts', esperado: 'lecturas sin marca de tiempo (rige la recepción)', cubre: [lora('lecturas de los valores decodificados')] },
  { id: 'C-86', grupo: 'g', adaptador: 'milesight', tipo: 'malformada', regla: 'Milesight: sin códec ni perfil, o sin Metadata, se rechaza diciendo qué activar', fuente: 'milesight.adaptador.ts:34-38', esperado: 'rechazada: malformada con la instrucción', cubre: [lora('sin códec (data en base64'), lora('con códec pero sin Metadata')] },
  { id: 'C-87', grupo: 'g', adaptador: 'milesight', tipo: 'valida', regla: 'Milesight: hereda fCnt cuando el decodificador lo deja', fuente: 'milesight.adaptador.ts:16-18', esperado: 'ctx.fcnt anotado; no cuenta como clave ignorada', cubre: [lora('con códec: si la trama trae fCnt')] },
  { id: 'C-88', grupo: 'g', adaptador: 'milesight', tipo: 'valida', regla: 'Perfil campus-heltec-v3-v1: 10 bytes de la trama sin códec → temperatura, humedad y tensión', fuente: 'docs/10 §8.4 punto 47; perfiles.ts', esperado: '18,16 °C, 65,52 %RH y 3,75 V con la marca del servidor de red', cubre: [lora('la captura con perfil')] },
  { id: 'C-89', grupo: 'g', adaptador: 'milesight', tipo: 'malformada', regla: 'Perfil: data que no es base64 estricto, que no mide 10 bytes o de un perfil desconocido se rechaza', fuente: 'perfiles.ts:21 y :39', esperado: 'rechazada: malformada', cubre: [lora('data que no es base64 estricto o no mide 10 bytes'), lora('un perfil que el código no conoce')] },
  { id: 'C-90', grupo: 'g', regla: 'La lista de perfiles del código es la del CHECK de la base y sus lecturas existen en el catálogo', fuente: 'docs/10 §8.4 punto 47; migración 17', esperado: 'PERFILES igual al dominio de ck_dispositivo_decodificador', cubre: [lora('PERFILES == el dominio de ck_dispositivo_decodificador')] },
  { id: 'C-91', grupo: 'g', regla: 'Mapa de claves: una clave desconocida se ignora y se anota; si no queda ninguna conocida, se rechaza', fuente: 'docs/10 §8.4 punto 47; lorawan.ts:60-85', esperado: 'ctx.ignoradas con las claves; sin ninguna conocida: malformada', cubre: [lora('una clave que no está en el mapa se ignora'), lora('resuelve sin distinguir mayúsculas')] },
  { id: 'C-92', grupo: 'g', regla: 'Mapa de claves: dos claves de la misma magnitud valen la primera; la otra se anota como repetida', fuente: 'lorawan.ts:77', esperado: 'una lectura; la segunda en ignoradas con «(repetida)»', cubre: [lora('dos claves que apuntan a la misma magnitud')] },
  { id: 'C-93', grupo: 'g', regla: 'Los adaptadores registrados son los de los formatos que admite la base (ck_dispositivo_formato) y el módulo', fuente: 'docs/10 §8.4 punto 47; migración 15; recepcion.module.ts', esperado: 'senml, plano, chirpstack y milesight en el servicio, el módulo, los archivos y el CHECK', cubre: [aqui('C-93')] },
];

// ── Utilidades ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const DIR = import.meta.dirname;
const RAIZ_DB = join(DIR, '../../../db/init');
const sqlTodas = (): string => readdirSync(RAIZ_DB).filter((x) => x.endsWith('.sql')).sort().map((f) => readFileSync(join(RAIZ_DB, f), 'utf8')).join('\n');
const fuenteServicio = readFileSync(join(DIR, 'recepcion.service.ts'), 'utf8');
// Valores de la última definición de un CHECK `<nombre> CHECK (<columna> IN (...))` entre las migraciones, en orden.
function dominioDelCheck(sql: string, nombre: string): string[] {
  const defs = [...sql.matchAll(new RegExp(`ADD CONSTRAINT ${nombre}\\s+CHECK \\(\\s*\\w+ IN \\(([^)]*)\\)\\)`, 'g'))];
  expect(defs.length, `ninguna migración define ${nombre}`).toBeGreaterThanOrEqual(1);
  return [...defs[defs.length - 1][1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
}

const senml = new SenmlAdaptador();
const plano = new PlanoAdaptador();
const chirp = new ChirpstackAdaptador(resolverClave);
const mile = new MilesightAdaptador(resolverClave);
const DEVEUI = '0101010101010101'; // el del ejemplo oficial de ChirpStack (sintético)
const ctxDir = (cuerpo: string, magnitud = 'temperatura'): ContextoTrama => ({
  topico: `sitio/uct/dispositivo/dev-0001/${magnitud}`, idFisico: 'dev-0001', magnitudTopico: magnitud, carga: Buffer.from(cuerpo, 'utf8'),
});
const ctxPas = (cuerpo: object | string, deveui: string | undefined = DEVEUI): ContextoTrama => ({
  topico: `sitio/uct/pasarela/chirpstack-campus/${deveui ?? 'x'}/up`, idFisico: deveui ?? 'x', magnitudTopico: '',
  carga: Buffer.from(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo), 'utf8'), deveui,
});
const RECIBIDO = new Date('2026-11-15T12:00:00Z');
// La marca que acaba guardada: la misma función que usa la recepción real tras el adaptador.
const marcas = (ls: Lectura[], origen: 'dispositivo' | 'pasarela' = 'dispositivo'): Date[] => ls.map((l) => tiempoPlausible(l.tiempo, RECIBIDO, origen));

// ── Recepción real con la base simulada (la misma tubería que MQTT y HTTP) ──────────────────────────────────────────────────────
type Disp = { id: string; estado: string; sitio_codigo?: string; formato?: string; pasarela_id?: string | null; intervalo_esperado_s?: number; canales?: number;
  ventana_inicio?: Date | null; ventana_lecturas?: number };
type Canal = { unidad: string; min: number | null; max: number | null };
const CANALES: Record<string, Canal> = { temperatura: { unidad: 'Cel', min: -40, max: 85 }, humedad: { unidad: '%RH', min: 0, max: 100 } };
function armar(dispositivo: Disp | undefined, pasarela?: { id: string; activo: boolean; sitio_codigo: string }, extra: Record<string, Canal> = {}) {
  const query = vi.fn((sql: string, params?: unknown[]) => {
    if (sql.startsWith('SELECT d.id, d.estado, d.formato, d.pasarela_id, s.codigo AS sitio_codigo')) {
      const fila = { sitio_codigo: 'uct', formato: 'senml', pasarela_id: null, decodificador: null, ultimo_fcnt: null, intervalo_esperado_s: 60, canales: 2,
        ventana_inicio: null, ventana_lecturas: 0, ventana_cuarentena: 0, ventana_sobre_tope: 0, ventana_omitidas: 0, reloj_desviado: false, ...dispositivo };
      return Promise.resolve({ rows: dispositivo ? [fila] : [], rowCount: dispositivo ? 1 : 0 });
    }
    if (sql.startsWith('SELECT p.id, p.activo, s.codigo AS sitio_codigo FROM pasarela')) return Promise.resolve({ rows: pasarela ? [pasarela] : [], rowCount: pasarela ? 1 : 0 });
    if (sql.trimStart().startsWith('SELECT c.id, m.codigo AS magnitud')) {
      const c = { ...CANALES, ...extra }[String(params?.[1])];
      return Promise.resolve(c ? { rows: [{ id: 'k-' + String(params?.[1]), magnitud: params?.[1], unidad_canonica: c.unidad, rango_min: c.min, rango_max: c.max, escala_cero: null, escala_cien: null }], rowCount: 1 } : { rows: [], rowCount: 0 });
    }
    if (sql.trimStart().startsWith('INSERT INTO medicion')) return Promise.resolve({ rows: [{ tiempo: new Date('2026-11-15T12:00:00.123456Z') }], rowCount: 1 });
    if (sql.startsWith('INSERT INTO estado_dispositivo')) return Promise.resolve({ rows: [{ visto_por_ultima_vez: RECIBIDO }], rowCount: 1 });
    return Promise.resolve({ rows: [], rowCount: 1 });
  });
  const marcarVivo = vi.fn();
  const broker = { alRecibir: vi.fn() } as unknown as BrokerService;
  const alertas = { evaluar: vi.fn() } as unknown as AlertasService;
  const supervision = { marcarVivo, abrirTope: vi.fn(), cerrarTope: vi.fn(), abrirRelojDesviado: vi.fn(), cerrarRelojDesviado: vi.fn() } as unknown as SupervisionService;
  const servicio = new RecepcionService({ query } as unknown as Pool, broker, alertas, supervision, new EventosService(), senml, plano, chirp, mile);
  const filas = (prefijo: string): unknown[][] => query.mock.calls.filter(([sql]) => String(sql).trimStart().startsWith(prefijo)).map(([, p]) => (p ?? []));
  return {
    servicio, marcarVivo, query,
    cuarentenas: () => filas('INSERT INTO cuarentena').map((p) => ({ motivo: p[2] as string, detalle: p[4] as string, dispositivo: p[5] as string | null })),
    mediciones: () => filas('INSERT INTO medicion').map((p) => ({ canal: p[0] as string, tiempo: p[1] as Date | null, valor: p[2] as number, unidad: p[3] as string, origen: p[5] as string })),
    tramas: () => filas('INSERT INTO trama'),
  };
}
const TOP = 'sitio/uct/dispositivo/dev-0001/temperatura';
const UNA = '[{"n":"temperatura","u":"Cel","v":21.5}]';

// ── (a) Esquema SenML ────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('contrato (a): esquema SenML (RFC 8428)', () => {
  it('C-01 un registro con n, u y v produce una lectura; el nombre va en minúsculas', () => {
    expect(senml.analizar(ctxDir('[{"n":"Temperatura","u":"Cel","v":23.1}]'))).toEqual([{ magnitud: 'temperatura', valor: 23.1, unidad: 'Cel', tiempo: undefined }]);
  });
  it('C-02 bn no se antepone al nombre: con el ejemplo textual de RFC 8428 §5.1.2 la magnitud es «voltage», no «urn:dev:ow:…:voltage»', () => {
    // RFC 8428 §5.1.2 (Multiple Data Points), textual.
    const ls = senml.analizar(ctxDir('[{"bn":"urn:dev:ow:10e2073a01080063:","n":"voltage","u":"V","v":120.1},{"n":"current","u":"A","v":1.2}]'));
    expect(ls.map((l) => [l.magnitud, l.valor, l.unidad])).toEqual([['voltage', 120.1, 'V'], ['current', 1.2, 'A']]);
  });
  it('C-03 bt se hereda y t es relativo a bt: el ejemplo textual de RFC 8428 §5.1.2 (corriente cada segundo)', () => {
    // RFC 8428 §5.1.2, textual: «current at Tue Jun 8 18:01:16.001 UTC 2010 and at each second for the previous 5 seconds».
    const ls = senml.analizar(ctxDir(`[{"bn":"urn:dev:ow:10e2073a0108006:","bt":1.276020076001e+09,"bu":"A","bver":5,"n":"voltage","u":"V","v":120.1},
      {"n":"current","t":-5,"v":1.2},{"n":"current","t":-4,"v":1.3},{"n":"current","t":-3,"v":1.4},{"n":"current","t":-2,"v":1.5},{"n":"current","t":-1,"v":1.6},{"n":"current","v":1.7}]`));
    expect(ls).toHaveLength(7);
    const base = 1.276020076001e+09 * 1000;
    expect((ls[0].tiempo as Date).getTime()).toBeCloseTo(base, -1);
    [-5, -4, -3, -2, -1, 0].forEach((t, i) => expect((ls[i + 1].tiempo as Date).getTime()).toBeCloseTo(base + t * 1000, -1));
  });
  it('C-04 bu se hereda y la u del registro gana: el ejemplo textual de RFC 8428 §5.1.3', () => {
    // RFC 8428 §5.1.3 (primeros registros), textual.
    const ls = senml.analizar(ctxDir(`[{"bn":"urn:dev:ow:10e2073a01080063","bt":1.320067464e+09,"bu":"%RH","v":20},
      {"u":"lon","v":24.30621},{"u":"lat","v":60.07965},{"t":60,"v":20.3}]`, 'humedad'));
    expect(ls.map((l) => l.unidad)).toEqual(['%RH', 'lon', 'lat', '%RH']);
    expect(ls.map((l) => l.magnitud)).toEqual(['humedad', 'humedad', 'humedad', 'humedad']); // sin n: la del tópico
  });
  it('C-05 bt persiste aunque cambie bn (RFC 8428 §5.1.6, textual) y un bt posterior lo reemplaza', () => {
    // RFC 8428 §5.1.6 (Collection of Resources), textual: «the last record would use the Base Name from the 3rd record but the Base Time from the first».
    const ls = senml.analizar(ctxDir(`[{"bn":"2001:db8::2/","bt":1.320078429e+09,"n":"temperature","u":"Cel","v":25.2},{"n":"humidity","u":"%RH","v":30},
      {"bn":"2001:db8::1/","n":"temperature","u":"Cel","v":12.3},{"n":"humidity","u":"%RH","v":67}]`));
    expect(marcas(ls).map((d) => d.getTime())).toEqual([1320078429000, 1320078429000, 1320078429000, 1320078429000]);
    const dos = senml.analizar(ctxDir('[{"bt":1757300000,"n":"temperatura","v":1},{"bt":1757400000,"n":"temperatura","v":2},{"n":"temperatura","t":5,"v":3}]'));
    expect(dos.map((l) => (l.tiempo as Date).getTime() / 1000)).toEqual([1757300000, 1757400000, 1757400005]);
  });
  it('C-06 bver 10 (o ausente) se acepta', () => {
    expect(senml.analizar(ctxDir('[{"bver":10,"n":"temperatura","v":1}]'))).toHaveLength(1);
    expect(senml.analizar(ctxDir('[{"n":"temperatura","v":1}]'))).toHaveLength(1);
  });
  // Hallazgo H-4 (corregido): la RFC prohíbe usar un pack con bver mayor que el que se entiende.
  it('C-07 bver mayor que 10, o que no es un entero positivo, es malformada (RFC 8428 §4.1 y §4.4), en cualquier registro y aunque no traiga valor', () => {
    for (const pack of ['[{"bver":11,"n":"temperatura","v":1}]', '[{"n":"temperatura","v":1},{"bver":11,"n":"temperatura","v":2}]', '[{"bver":11,"n":"temperatura"}]', '[{"bver":1e300,"n":"temperatura","v":1}]']) {
      expect(() => senml.analizar(ctxDir(pack)), pack).toThrow(TramaMalformada);
    }
    expect(() => senml.analizar(ctxDir('[{"bver":11,"n":"temperatura","v":1}]'))).toThrow('bver 11 no se entiende (se entiende hasta 10)');
    for (const b of ['0', '-1', '10.5', '"10"', 'null', 'true', '[10]']) {
      expect(() => senml.analizar(ctxDir(`[{"bver":${b},"n":"temperatura","v":1}]`)), b).toThrow('bver no es un entero positivo');
    }
    for (const b of [1, 5, 10]) expect(senml.analizar(ctxDir(`[{"bver":${b},"n":"temperatura","v":1}]`)), String(b)).toHaveLength(1);
  });
  it('C-08 un campo desconocido se ignora y no cambia la lectura (RFC 8428 §4.4)', () => {
    expect(senml.analizar(ctxDir('[{"n":"temperatura","v":1,"campo_nuevo":"x","otro":{"a":1}}]'))).toEqual(senml.analizar(ctxDir('[{"n":"temperatura","v":1}]')));
  });
  // Hallazgo H-5 (corregido): RFC 8428 §4.4, «a label name that ends with "_" … an error MUST be generated».
  it('C-09 un campo desconocido con etiqueta terminada en «_» es malformada (RFC 8428 §4.4), también en un registro sin valor; sin «_» se ignora', () => {
    for (const campo of ['"campo_":1', '"x_":"a"', '"_":true', '"bn_":"x"', '"v_":1']) {
      expect(() => senml.analizar(ctxDir(`[{"n":"temperatura","v":1,${campo}}]`)), campo).toThrow(TramaMalformada);
    }
    expect(() => senml.analizar(ctxDir('[{"n":"temperatura","v":1,"campo_":1}]'))).toThrow('campo «campo_» desconocido y de los que no se pueden ignorar (termina en «_»)');
    expect(() => senml.analizar(ctxDir('[{"n":"temperatura","v":1},{"n":"humedad","campo_":1}]'))).toThrow(TramaMalformada);
    // La etiqueta es texto del emisor: va al detalle recortada y sin caracteres de control (texto.ts).
    expect(() => senml.analizar(ctxDir('[{"n":"temperatura","v":1,"a\\nb_":1}]'))).toThrow('campo «a?b_»');
    // Sin «_», o con «_» en medio, el campo se ignora (C-08), y las etiquetas que la RFC define no se confunden con extensiones.
    expect(senml.analizar(ctxDir('[{"n":"temperatura","v":1,"campo_nuevo":1,"a_b":2,"s":3,"ut":60,"bs":4}]'))).toHaveLength(1);
  });
  it('C-10 v solo admite un número finito: cadena, nulo, booleano o desborde (1e999) son malformada', () => {
    for (const v of ['"alto"', 'null', 'true', '1e999', '[1]', '{}']) {
      expect(() => senml.analizar(ctxDir(`[{"n":"temperatura","v":${v}}]`)), v).toThrow(TramaMalformada);
    }
    expect(senml.analizar(ctxDir('[{"n":"temperatura","v":0}]'))[0].valor).toBe(0);
    expect(senml.analizar(ctxDir('[{"n":"temperatura","v":-3.5e1}]'))[0].valor).toBe(-35);
  });
  it('C-11 los registros con vs, vb o vd se omiten: del ejemplo textual de RFC 8428 §5.1.5 solo queda la temperatura', () => {
    // RFC 8428 §5.1.5 (Multiple Data Types), textual.
    const ls = senml.analizar(ctxDir(`[{"bn":"urn:dev:ow:10e2073a01080063:","n":"temp","u":"Cel","v":23.1},{"n":"label","vs":"Machine Room"},
      {"n":"open","vb":false},{"n":"nfc-reader","vd":"aGkgCg"}]`));
    expect(ls.map((l) => [l.magnitud, l.valor])).toEqual([['temp', 23.1]]);
  });
  it('C-12 un registro con solo campos base no genera lectura: el ejemplo textual de RFC 8428 §5.1.7', () => {
    // RFC 8428 §5.1.7 (Setting an Actuator), textual.
    const ls = senml.analizar(ctxDir(`[{"bn":"urn:dev:ow:10e2073a01080063:"},{"n":"temp","u":"Cel","v":23.1},{"n":"heat","u":"/","v":1},{"n":"fan","u":"/","v":0}]`));
    expect(ls.map((l) => l.magnitud)).toEqual(['temp', 'heat', 'fan']);
  });
  it('C-13 un pack sin ninguna lectura numérica es malformada «pack sin valores»', () => {
    for (const pack of ['[{"bn":"dev-0001"}]', '[{"n":"temperatura","vs":"x"}]', '[{"n":"temperatura","vb":true}]', '[{"n":"temperatura","s":5}]']) {
      expect(() => senml.analizar(ctxDir(pack)), pack).toThrow('pack sin valores');
    }
  });
  // Hallazgo H-6 (corregido): RFC 8428 §4.5.4, «The Base Value and Value are added together».
  it('C-14 bv se suma a v y se hereda hasta el próximo bv; sin v no hay lectura; un bv no numérico o una suma que desborda es malformada', () => {
    const valores = (pack: string): number[] => senml.analizar(ctxDir(pack)).map((l) => l.valor);
    expect(valores('[{"bv":10,"n":"temperatura","v":5}]')).toEqual([15]);
    expect(valores('[{"bv":-10,"n":"temperatura","v":5}]')).toEqual([-5]);
    expect(valores('[{"bv":0.5,"n":"temperatura","v":0.25}]')).toEqual([0.75]);
    // Hereda a los registros siguientes y un bv posterior lo reemplaza (RFC 8428 §4: la base vale hasta que otro registro trae la suya).
    expect(valores('[{"bv":10,"n":"temperatura","v":5},{"n":"temperatura","v":6},{"bv":100,"n":"temperatura","v":1},{"n":"temperatura","v":2}]')).toEqual([15, 16, 101, 102]);
    // Un registro que solo trae bv no genera lectura (el perfil exige v), pero deja la base para los siguientes.
    expect(valores('[{"bv":10,"n":"temperatura"},{"n":"temperatura","v":5}]')).toEqual([15]);
    expect(() => senml.analizar(ctxDir('[{"bv":10,"n":"temperatura"}]'))).toThrow('pack sin valores');
    // bv solo se suma a v: los registros con vs, vb o vd siguen omitiéndose y no reciben la base.
    expect(valores('[{"bv":10,"n":"temperatura","v":1},{"n":"label","vs":"x"},{"n":"open","vb":true},{"n":"temperatura","v":2}]')).toEqual([11, 12]);
    for (const bv of ['"10"', 'null', 'true', '[1]', '{}', '1e999']) {
      expect(() => senml.analizar(ctxDir(`[{"bv":${bv},"n":"temperatura","v":1}]`)), bv).toThrow('bv no numérico');
    }
    expect(() => senml.analizar(ctxDir('[{"bv":1e308,"n":"temperatura","v":1e308}]'))).toThrow('bv + v fuera del rango numérico');
    expect(() => senml.analizar(ctxDir('[{"bv":1e308,"n":"temperatura","v":1e308}]'))).toThrow(TramaMalformada);
  });
  // Hallazgo H-7 (corregido): RFC 8428 §4.2, «Exactly one Value field MUST appear».
  it('C-15 un registro con más de un campo de valor (v, vs, vb, vd) es malformada; v con s (suma) no cuenta como dos valores', () => {
    for (const extra of ['"vs":"x"', '"vb":true', '"vd":"aGk"', '"vs":null']) {
      expect(() => senml.analizar(ctxDir(`[{"n":"temperatura","v":1,${extra}}]`)), extra).toThrow('más de un campo de valor en un registro (v, vs, vb, vd)');
    }
    expect(() => senml.analizar(ctxDir('[{"n":"temperatura","v":1},{"n":"x","vs":"a","vb":false}]'))).toThrow(TramaMalformada); // sin v, también
    expect(senml.analizar(ctxDir('[{"n":"temperatura","v":1,"s":5}]'))).toHaveLength(1);
    expect(senml.analizar(ctxDir('[{"n":"label","vs":"x"},{"n":"temperatura","v":1}]'))).toHaveLength(1); // un solo valor de texto: se omite (C-11)
  });
  // Hallazgo H-1 (defecto, corregido): senml.adaptador.ts hacía «(r.n ?? ctx.magnitudTopico).toLowerCase()»: con n numérico lanza TypeError, que no es
  // TramaMalformada; el servicio lo relanza (recepcion.service.ts:232) y el broker reintenta y reconecta (broker.service.ts:91-94).
  it('C-16 un n o un u que no es cadena se rechaza con TramaMalformada (antes lanzaba TypeError y el mensaje no se confirmaba al broker)', () => {
    for (const pack of ['[{"n":5,"v":1}]', '[{"n":{},"v":1}]', '[{"n":["temperatura"],"v":1}]', '[{"n":true,"v":1}]']) {
      expect(() => senml.analizar(ctxDir(pack)), pack).toThrow(TramaMalformada);
      expect(() => senml.analizar(ctxDir(pack)), pack).toThrow('n no es texto');
    }
    expect(() => senml.analizar(ctxDir('[{"n":"temperatura","u":7,"v":1}]'))).toThrow('u no es texto');
    expect(() => senml.analizar(ctxDir('[{"n":"temperatura","u":7,"v":1}]'))).toThrow(TramaMalformada);
  });
  it('C-17 un elemento del pack que no es objeto es malformada «registro no es objeto»', () => {
    for (const pack of ['[1]', '["a"]', '[null]', '[{"n":"temperatura","v":1},true]']) {
      expect(() => senml.analizar(ctxDir(pack)), pack).toThrow('registro no es objeto');
    }
  });
  it('C-104 bt, t, bu, n o u con un tipo equivocado es malformada, también en un registro sin valor (antes se ignoraban en silencio)', () => {
    for (const [campo, mensaje, malos] of [
      ['bt', 'bt no numérico', ['"1757300000"', 'null', 'true', '[1]', '{}', '1e999']],
      ['t', 't no numérico', ['"-5"', 'null', 'false', '[1]', '{}', '-1e999']],
      ['bu', 'bu no es texto', ['5', 'null', 'true', '["Cel"]', '{}']],
    ] as const) {
      for (const malo of malos) {
        expect(() => senml.analizar(ctxDir(`[{"${campo}":${malo},"n":"temperatura","v":1}]`)), `${campo} ${malo}`).toThrow(mensaje);
        expect(() => senml.analizar(ctxDir(`[{"n":"temperatura","v":1},{"${campo}":${malo}}]`)), `${campo} ${malo} sin valor`).toThrow(TramaMalformada);
      }
    }
    // n y u se revisan también en un registro sin valor: antes solo en el que traía v, y un u numérico suelto se ignoraba.
    expect(() => senml.analizar(ctxDir('[{"n":"temperatura","v":1},{"u":5}]'))).toThrow('u no es texto');
    expect(() => senml.analizar(ctxDir('[{"n":7},{"n":"temperatura","v":1}]'))).toThrow('n no es texto');
    // Lo legítimo pasa: un número (incluso enorme pero finito, que C-26 resuelve con la hora de recepción), 0, y un bu de texto (aunque vacío).
    expect(senml.analizar(ctxDir('[{"bt":1757300000,"bu":"Cel","t":-1,"n":"temperatura","v":1},{"bt":0,"t":0,"bu":"","n":"temperatura","v":2}]'))).toHaveLength(2);
    expect(senml.analizar(ctxDir('[{"bt":1e300,"n":"temperatura","v":1}]'))).toHaveLength(1);
  });
  it('C-105 un bver distinto del vigente en otro registro del pack es malformada (RFC 8428 §4.4); sin bver cuenta como 10 hasta que uno lo fije', () => {
    const distinto = (pack: string, vigente: number, nuevo: number): void => {
      expect(() => senml.analizar(ctxDir(pack)), pack).toThrow(`bver ${nuevo} distinto del ${vigente} del resto del pack (todos los registros tienen la misma versión)`);
      expect(() => senml.analizar(ctxDir(pack)), pack).toThrow(TramaMalformada);
    };
    distinto('[{"bver":10,"n":"temperatura","v":1},{"bver":5,"n":"temperatura","v":2}]', 10, 5);
    distinto('[{"bver":5,"n":"temperatura","v":1},{"bver":6,"n":"temperatura","v":2}]', 5, 6);
    distinto('[{"bver":5,"n":"temperatura"},{"n":"temperatura","v":1},{"bver":6}]', 5, 6); // aunque el registro no traiga valor
    distinto('[{"n":"temperatura","v":1},{"bver":5,"n":"temperatura","v":2}]', 10, 5); // el primero, sin bver, era versión 10
    // Lo legítimo: un bver solo en el primer registro (RFC §5.1.2 usa 5), el mismo repetido, o 10 explícito después de la versión por defecto.
    expect(senml.analizar(ctxDir('[{"bver":5,"n":"temperatura","v":1},{"n":"temperatura","v":2}]'))).toHaveLength(2);
    expect(senml.analizar(ctxDir('[{"bver":5,"n":"temperatura","v":1},{"bver":5,"n":"temperatura","v":2}]'))).toHaveLength(2);
    expect(senml.analizar(ctxDir('[{"n":"temperatura","v":1},{"bver":10,"n":"temperatura","v":2}]'))).toHaveLength(2);
  });
  it('C-97 de punta a punta, bv + v es el valor que se guarda, y el rango físico se evalúa sobre esa suma', async () => {
    const { servicio, mediciones, cuarentenas } = armar({ id: 'd1', estado: 'activo' });
    await servicio.procesar(TOP, Buffer.from('[{"bv":10,"n":"temperatura","u":"Cel","v":5},{"n":"temperatura","u":"Cel","v":6}]'));
    expect(mediciones().map((m) => m.valor)).toEqual([15, 16]); // sin bv se habría guardado 5 y 6
    expect(cuarentenas()).toEqual([]);
    await servicio.procesar(TOP, Buffer.from('[{"bv":80,"n":"temperatura","u":"Cel","v":10}]')); // 90 Cel: v solo estaría en rango, la suma no
    expect(mediciones()).toHaveLength(2);
    expect(cuarentenas().map((c) => [c.motivo, c.detalle])).toEqual([['invalida', 'temperatura: 90 Cel fuera del rango físico [-40, 85]']]);
  });
});

// ── (b) Tiempo ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('contrato (b): marcas de tiempo (docs/13)', () => {
  it('C-21 un tiempo relativo (bt + t menor que 2^28, RFC 8428 §4.5.3): negativo es «ahora» menos esos segundos; cero o positivo, la hora de recepción', () => {
    const marca = (pack: string): Date => marcas(senml.analizar({ ...ctxDir(pack), recibidoEn: RECIBIDO }))[0];
    expect(marca('[{"n":"temperatura","t":-5,"v":1}]').getTime()).toBe(RECIBIDO.getTime() - 5_000);
    expect(marca('[{"n":"temperatura","t":-90.5,"v":1}]').getTime()).toBe(RECIBIDO.getTime() - 90_500);
    expect(marca('[{"bt":-10,"n":"temperatura","t":-5,"v":1}]').getTime()).toBe(RECIBIDO.getTime() - 15_000); // bt y t suman
    // Cero y positivo: la RFC los llama «ahora» y «futuro»; una medición ya hecha no está en el futuro, así que rige la recepción.
    for (const t of [0, 10, 268_435_455]) expect(marca(`[{"n":"temperatura","t":${t},"v":1}]`), `t=${t}`).toBe(RECIBIDO);
    // Un pasado relativo que cae antes del año 2000 (−1e9 s ≈ 1994) lo descarta la regla 7 como cualquier marca vieja.
    expect(marca('[{"n":"temperatura","t":-1000000000,"v":1}]')).toBe(RECIBIDO);
    expect(marca('[{"n":"temperatura","t":-1e300,"v":1}]')).toBe(RECIBIDO); // imposible: no lanza
    // Desde 2^28 es absoluto: la suma decide, no cada campo por separado (RFC §4.5.3, último párrafo).
    expect(marca('[{"bt":1757300000,"n":"temperatura","t":-5,"v":1}]').getTime()).toBe((1757300000 - 5) * 1000);
    expect(marca('[{"bt":268435456,"n":"temperatura","v":1}]')).toBe(RECIBIDO); // 1978: antes del año 2000
  });
  it('C-23 el umbral es el 1 de enero de 2000 UTC: 1999-12-31T23:59:59Z y 1970 → recepción; 2000-01-01T00:00:00Z → la marca', () => {
    const marca = (bt: number) => marcas(senml.analizar(ctxDir(`[{"bt":${bt},"n":"temperatura","v":1}]`)))[0];
    expect(marca(946684799)).toBe(RECIBIDO);
    expect(marca(1)).toBe(RECIBIDO); // 1970
    expect(marca(946684800).toISOString()).toBe('2000-01-01T00:00:00.000Z');
  });
  it('C-25 en milisegundos: SenML (segundos) lo toma por un futuro lejano y rige la recepción; plano reconoce los ms', () => {
    const ms = Date.parse('2026-11-15T11:59:00Z');
    expect(marcas(senml.analizar(ctxDir(`[{"bt":${ms},"n":"temperatura","v":1}]`)))[0]).toBe(RECIBIDO);
    expect(marcas(senml.analizar(ctxDir(`[{"bt":${ms / 1000},"n":"temperatura","v":1}]`)))[0].getTime()).toBe(ms);
    expect(marcas(plano.analizar(ctxDir(`{"v":1,"ts":${ms}}`)))[0].getTime()).toBe(ms);
    expect(marcas(plano.analizar(ctxDir(`{"v":1,"ts":${ms / 1000}}`)))[0].getTime()).toBe(ms);
  });
  it('C-26 una marca imposible (1e300 s) no lanza: rige la recepción', () => {
    expect(marcas(senml.analizar(ctxDir('[{"bt":1e300,"n":"temperatura","v":1}]')))[0]).toBe(RECIBIDO);
    expect(marcas(plano.analizar(ctxDir('{"v":1,"t":1e300}')))[0]).toBe(RECIBIDO);
  });
  it('C-98 de punta a punta, t = −30 se guarda como la hora de recepción menos 30 s (origen dispositivo); t = 0, con la hora de recepción', async () => {
    const { servicio, mediciones } = armar({ id: 'd1', estado: 'activo' });
    const antes = Date.now();
    await servicio.procesar(TOP, Buffer.from('[{"n":"temperatura","u":"Cel","t":-30,"v":1}]'));
    const despues = Date.now();
    await servicio.procesar(TOP, Buffer.from('[{"n":"temperatura","u":"Cel","t":0,"v":2}]'));
    const [rel, cero] = mediciones();
    expect(rel.origen).toBe('dispositivo');
    expect((rel.tiempo as Date).getTime()).toBeGreaterThanOrEqual(antes - 30_000);
    expect((rel.tiempo as Date).getTime()).toBeLessThanOrEqual(despues - 30_000);
    expect([cero.tiempo, cero.origen]).toEqual([null, 'recepcion']); // sin marca del emisor: la base pone la hora
  });
});

describe('contrato (b): la hora de recepción de la trama', () => {
  it('C-102 el «ahora» de los tiempos relativos es uno solo por trama: sin recibidoEn, todos los registros comparten el instante', () => {
    const RealDate = Date;
    let relojes = 0; // cuántas veces se leyó el reloj («new Date()» sin argumentos)
    class RelojQueAvanza extends RealDate {
      constructor(...a: unknown[]) {
        super(...((a.length === 0 ? [RealDate.UTC(2026, 10, 16, 10, 0, ++relojes)] : a) as [number])); // cada lectura del reloj: un segundo después
      }
    }
    vi.stubGlobal('Date', RelojQueAvanza);
    try {
      const ls = senml.analizar(ctxDir('[{"n":"temperatura","t":-10,"v":1},{"n":"temperatura","t":-10,"v":2},{"n":"temperatura","t":-10,"v":3}]'));
      expect(ls.map((l) => (l.tiempo as Date).getTime())).toEqual(Array(3).fill(RealDate.UTC(2026, 10, 16, 9, 59, 51))); // la única lectura del reloj (10:00:01) menos 10 s
      expect(relojes).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('C-103 la hora de recepción que llega a la lectura es la de la entrada de la trama, por MQTT y por HTTP, aunque pase el tiempo hasta que responda la base', async () => {
    const T0 = new Date('2026-11-16T10:00:00.000Z');
    const T1 = new Date('2026-11-16T10:07:00.000Z'); // lo que tarda la base en responder, a propósito exagerado
    const cuerpo = Buffer.from('[{"n":"temperatura","u":"Cel","t":-5,"v":21}]');
    vi.useFakeTimers({ toFake: ['Date'] }); // solo el reloj: las promesas siguen su curso
    const espia = vi.spyOn(senml, 'analizar');
    try {
      for (const via of ['mqtt', 'http'] as const) {
        espia.mockClear();
        vi.setSystemTime(T0);
        const { servicio, query } = armar({ id: 'd1', estado: 'activo' });
        const trabajo = via === 'mqtt' ? servicio.procesar(TOP, cuerpo) : servicio.procesarHttp('dev-0001', cuerpo, undefined);
        vi.setSystemTime(T1); // la trama ya entró: el reloj sigue, pero la hora de recepción no se vuelve a leer
        await trabajo;
        const ctx = espia.mock.calls[0][0];
        expect(ctx.recibidoEn?.toISOString(), via).toBe(T0.toISOString());
        const insercion = query.mock.calls.find(([sql]) => String(sql).trimStart().startsWith('INSERT INTO medicion'));
        expect(insercion, via).toBeDefined();
        const [, p] = insercion as [string, unknown[]];
        expect((p[1] as Date).toISOString(), via).toBe(new Date(T0.getTime() - 5_000).toISOString()); // el relativo, contra la entrada
        expect((p[4] as Date).toISOString(), via).toBe(T0.toISOString()); // recibido_en
      }
    } finally {
      espia.mockRestore();
      vi.useRealTimers();
    }
  });
});

// ── (c) Unidades y magnitudes ────────────────────────────────────────────────────────────────────────────────────────────────
describe('contrato (c): unidades, rango y catálogo', () => {
  it('C-33 de punta a punta: 300 K se guarda como 26,85 Cel y 77 °F como 25 Cel y 55 % como 55 %RH', async () => {
    const { servicio, mediciones } = armar({ id: 'd1', estado: 'activo' });
    await servicio.procesar(TOP, Buffer.from('[{"n":"temperatura","u":"K","v":300},{"n":"temperatura","u":"°F","v":77}]'));
    await servicio.procesar(TOP, Buffer.from('[{"n":"humedad","u":"%","v":55}]'));
    expect(mediciones().map((m) => [m.unidad, Number(m.valor.toFixed(2))])).toEqual([['Cel', 26.85], ['Cel', 25], ['%RH', 55]]);
    expect(aCanonica(100, 'mV', 'V')).toBe(0.1);
  });
  it('C-37 el rango se evalúa sobre el valor convertido y sus límites son inclusivos', async () => {
    const { servicio, mediciones, cuarentenas } = armar({ id: 'd1', estado: 'activo' });
    for (const [u, v] of [['Cel', 85], ['Cel', -40], ['Cel', 85.01], ['Cel', -40.01], ['K', 360], ['K', 358.15]] as const) {
      await servicio.procesar(TOP, Buffer.from(`[{"n":"temperatura","u":"${u}","v":${v}}]`));
    }
    expect(mediciones().map((m) => Number(m.valor.toFixed(2)))).toEqual([85, -40, 85]); // 85, −40 y 358,15 K = 85 °C
    expect(cuarentenas().map((c) => c.motivo)).toEqual(['invalida', 'invalida', 'invalida']);
    expect(cuarentenas()[2].detalle).toMatch(/^temperatura: 86\.85\d* Cel fuera del rango físico \[-40, 85\]$/);
  });
  it('C-100 un valor finito que desborda al convertir (1e306 bar → 1e309 hPa) se rechaza aunque el canal no tenga rango máximo', async () => {
    const sinRango = { presion: { unidad: 'hPa', min: null, max: null } };
    const { servicio, mediciones, cuarentenas } = armar({ id: 'd1', estado: 'activo' }, undefined, sinRango);
    await servicio.procesar(TOP, Buffer.from('[{"n":"presion","u":"bar","v":1e306},{"n":"presion","u":"bar","v":-1e306},{"n":"presion","u":"bar","v":1e305},{"n":"presion","u":"bar","v":1.013}]'));
    expect(mediciones().map((m) => [m.unidad, Number(m.valor.toPrecision(10))])).toEqual([['hPa', 1e308], ['hPa', 1013]]); // 1e305 bar son 1e308 hPa: todavía cabe
    expect(Number.isFinite(1e306 * 1000)).toBe(false); // la premisa: ni la v ni la conversión desbordan por separado
    expect(cuarentenas().map((c) => [c.motivo, c.detalle])).toEqual([['invalida',
      'presion: 1e+306 bar no cabe en un número finito al convertirlo a hPa; presion: -1e+306 bar no cabe en un número finito al convertirlo a hPa']]);
  });
  it('C-101 un -0 (en v, en bv o tras convertir) se guarda como 0', async () => {
    const { servicio, mediciones, cuarentenas } = armar({ id: 'd1', estado: 'activo', formato: 'senml' }, undefined, { presion: { unidad: 'hPa', min: null, max: null } });
    await servicio.procesar(TOP, Buffer.from('[{"bv":-0,"n":"temperatura","u":"Cel","v":-0},{"n":"presion","u":"Pa","v":-0},{"bv":0,"n":"temperatura","u":"Cel","v":-0}]'));
    expect(cuarentenas()).toEqual([]);
    const valores = mediciones().map((m) => m.valor);
    expect(valores).toEqual([0, 0, 0]);
    expect(valores.filter((v) => Object.is(v, -0))).toEqual([]); // toEqual no distingue -0 de 0: Object.is sí
    expect(Object.is(-0 / 100, -0)).toBe(true); // la premisa: la conversión Pa → hPa de un -0 da -0
    const plano = armar({ id: 'd1', estado: 'activo', formato: 'plano' });
    await plano.servicio.procesar(TOP, Buffer.from('-0'));
    expect(plano.mediciones().map((m) => Object.is(m.valor, 0))).toEqual([true]);
  });
  it('C-39 todo destino de una conversión es una unidad canónica del catálogo sembrado en las migraciones', () => {
    const fuente = readFileSync(join(DIR, 'unidades.ts'), 'utf8');
    const destinos = new Set([...fuente.matchAll(/'[^'→]+→([^']+)':/g)].map((m) => m[1]));
    const canonicas = new Set<string>();
    for (const bloque of sqlTodas().match(/INSERT INTO magnitud[\s\S]*?;/g) ?? []) {
      for (const m of bloque.matchAll(/\(\s*'([a-z0-9_]+)',\s*'[^']*',\s*'([^']+)'/g)) canonicas.add(m[2]);
    }
    expect(destinos.size).toBeGreaterThanOrEqual(4); // si la expresión no leyó nada, esta prueba no probaría nada
    expect([...destinos].filter((d) => !canonicas.has(d))).toEqual([]);
  });
});

// ── (d) Tamaño y forma del sobre ────────────────────────────────────────────────────────────────────────────────────────────────
describe('contrato (d): forma y tamaño de la trama', () => {
  it('C-41 un JSON ilegible a un dispositivo SenML → malformada «JSON inválido», y el dispositivo se marca vivo', async () => {
    for (const cuerpo of ['[{', '[{"n":"temperatura","v":1},', '[{"n":"temperatura","v":NaN}]']) {
      const { servicio, cuarentenas, marcarVivo } = armar({ id: 'd1', estado: 'activo' });
      await servicio.procesar(TOP, Buffer.from(cuerpo));
      expect(cuarentenas().map((c) => [c.motivo, c.detalle]), cuerpo).toEqual([['malformada', 'formato declarado senml: JSON inválido']]);
      expect(marcarVivo).toHaveBeenCalledTimes(1);
    }
  });
  it('C-42 a un dispositivo SenML, un objeto, un número o un texto → malformada «la trama no tiene esa forma»', async () => {
    for (const cuerpo of ['{"v":1}', '21.5', 'hola', '"texto"']) {
      const { servicio, cuarentenas, mediciones } = armar({ id: 'd1', estado: 'activo' });
      await servicio.procesar(TOP, Buffer.from(cuerpo));
      expect(cuarentenas().map((c) => [c.motivo, c.detalle]), cuerpo).toEqual([['malformada', 'formato declarado senml: la trama no tiene esa forma']]);
      expect(mediciones()).toEqual([]);
    }
  });
  it('C-43 una lista vacía es malformada «pack SenML vacío» (no «pack sin valores», que es otra regla)', () => {
    expect(() => senml.analizar(ctxDir('[]'))).toThrow(TramaMalformada);
    expect(() => senml.analizar(ctxDir('[]'))).toThrow('pack SenML vacío');
  });
  it('C-45 el tope de 64 KiB: el broker (max_packet_size) y la vía HTTP (cuerpo crudo y 413) usan el mismo', () => {
    const conf = readFileSync(join(DIR, '../../../mosquitto/config/mosquitto.conf'), 'utf8');
    expect(/^\s*max_packet_size\s+65536\s*$/m.test(conf)).toBe(true);
    const main = readFileSync(join(DIR, '../main.ts'), 'utf8');
    expect(main).toContain("limit: 64 * 1024 })");
    expect(main).toMatch(/entity\.too\.large[\s\S]{0,80}status\(413\)/);
  });
  it('C-49 el formato plano solo reconoce un número con la forma -?dígitos[.dígitos]', () => {
    for (const ok of ['21.5', '-3', '0', '007']) expect(plano.reconoce(ctxDir(ok)), ok).toBe(true);
    for (const no of ['1e3', '+5', '.5', '5.', '0x10', '1,5', 'NaN', 'Infinity', '--1', '']) expect(plano.reconoce(ctxDir(no)), no).toBe(false);
  });
  // Hallazgo H-9: SenML pone r.n y r.u tal cual en `rechazos` (recepcion.service.ts:301 y :306), que va al detalle de la fila y a la
  // línea WARN del registro sin pasar por limpia(): un salto de línea en n o u parte la línea (verificado con la recepción real).
  it('C-94 el nombre y la unidad de un registro SenML salen del adaptador recortados y sin caracteres de control', () => {
    const [l] = senml.analizar(ctxDir(JSON.stringify([{ n: 'tempe\nratura WARN falso', u: 'Cel\r\n\u202e', v: 1 }])));
    expect(l.magnitud).toBe('tempe?ratura warn falso');
    expect(l.unidad).toBe('Cel???');
    const [largo] = senml.analizar(ctxDir(JSON.stringify([{ n: 'x'.repeat(500), u: 'y'.repeat(500), v: 1 }])));
    expect(largo.magnitud).toHaveLength(40);
    expect(largo.unidad).toHaveLength(32);
    // Lo legítimo no cambia: un código del catálogo y una unidad con símbolos.
    const [ok] = senml.analizar(ctxDir('[{"n":"Temperatura_Suelo","u":"%RH","v":1}]'));
    expect([ok.magnitud, ok.unidad]).toEqual(['temperatura_suelo', '%RH']);
  });
});

// ── (e) Identidad y tópico ───────────────────────────────────────────────────────────────────────────────────────────────────
describe('contrato (e): lo que la trama puede y no puede decir de quién es', () => {
  it('C-54 un bn que nombra a otro dispositivo no cambia la atribución: la lectura es del dispositivo del tópico (hallazgo H-2)', async () => {
    const { servicio, mediciones, cuarentenas, tramas, query } = armar({ id: 'd1', estado: 'activo' });
    await servicio.procesar(TOP, Buffer.from('[{"bn":"dev-9999","n":"temperatura","u":"Cel","v":21.5}]'));
    expect(cuarentenas()).toEqual([]);
    expect(mediciones().map((m) => m.canal)).toEqual(['k-temperatura']); // el canal que se consultó fue el de d1
    expect(tramas()).toHaveLength(1);
    // El doble de la base responde igual a cualquier parámetro, así que lo que prueba la atribución es lo que la consulta RECIBE: la del
    // filtro 1 lleva el identificador del tópico y de la credencial, y el del bn no aparece en ningún parámetro (salvo en el cuerpo crudo,
    // que se conserva tal cual como bytes: es un Buffer).
    const busquedas = query.mock.calls.filter(([sql]) => String(sql).startsWith('SELECT d.id, d.estado, d.formato'));
    expect(busquedas.map(([, p]) => p)).toEqual([['dev-0001']]);
    const textos = query.mock.calls.flatMap(([, p]) => (p ?? [])).filter((x) => !Buffer.isBuffer(x)).map((x) => JSON.stringify(x));
    expect(textos.length).toBeGreaterThan(0); // si no se recogió ningún parámetro, esta comprobación no probaría nada
    expect(textos.filter((x) => x.includes('dev-9999'))).toEqual([]);
  });
  it('C-55 el nombre del registro gana sobre la magnitud del tópico; sin nombre rige la del tópico', () => {
    expect(senml.analizar(ctxDir('[{"n":"humedad","v":1}]', 'temperatura'))[0].magnitud).toBe('humedad');
    expect(senml.analizar(ctxDir('[{"v":1}]', 'temperatura'))[0].magnitud).toBe('temperatura');
    expect(senml.analizar(ctxDir('[{"n":"","v":1}]', 'temperatura'))[0].magnitud).toBe(''); // un nombre vacío no es «sin nombre»: caerá en «canal no declarado»
  });
  it('C-56 la magnitud del tópico se pasa a minúsculas: «…/Temperatura» con un número solo usa el canal «temperatura»', async () => {
    const { servicio, mediciones, cuarentenas } = armar({ id: 'd1', estado: 'activo', formato: 'plano' });
    await servicio.procesar('sitio/uct/dispositivo/dev-0001/Temperatura', Buffer.from('21.5'));
    expect(cuarentenas()).toEqual([]);
    expect(mediciones().map((m) => m.canal)).toEqual(['k-temperatura']);
  });
});

// ── (f) Cuarentena: cada motivo de la lista cerrada ────────────────────────────────────────────────────────────────────────────
describe('contrato (f): los motivos de cuarentena', () => {
  const ACTIVO: Disp = { id: 'd1', estado: 'activo' };
  it('C-65 no_registrado: sin alta, de otro sitio, y pasarela o nodo sin asociar', async () => {
    const a = armar(undefined);
    await a.servicio.procesar(TOP, Buffer.from(UNA));
    const b = armar({ ...ACTIVO, sitio_codigo: 'otra-sede' });
    await b.servicio.procesar(TOP, Buffer.from(UNA));
    const c = armar({ ...ACTIVO, formato: 'chirpstack', pasarela_id: 'otra' }, { id: 'p1', activo: true, sitio_codigo: 'uct' });
    await c.servicio.procesar(`sitio/uct/pasarela/chirpstack-campus/${DEVEUI}/up`, Buffer.from('{}'));
    for (const x of [a, b, c]) expect(x.cuarentenas().map((q) => q.motivo)).toEqual(['no_registrado']);
    expect(a.mediciones().concat(b.mediciones(), c.mediciones())).toEqual([]);
    expect([a, b, c].map((x) => x.marcarVivo.mock.calls.length)).toEqual([0, 0, 0]);
  });
  it('C-66 dado_de_baja: el dispositivo queda identificado y el detalle pide revocar su credencial', async () => {
    const { servicio, cuarentenas, marcarVivo } = armar({ ...ACTIVO, estado: 'baja' });
    await servicio.procesar(TOP, Buffer.from(UNA));
    expect(cuarentenas()).toEqual([{ motivo: 'dado_de_baja', detalle: 'id_fisico=dev-0001: revocar su credencial en el broker', dispositivo: 'd1' }]);
    expect(marcarVivo).not.toHaveBeenCalled();
  });
  it('C-67 malformada: del tópico y de cada adaptador, y el dispositivo autenticado se marca vivo', async () => {
    const topico = armar(ACTIVO);
    await topico.servicio.procesar('sitio/uct/otra-cosa', Buffer.from(UNA));
    const cuerpo = armar(ACTIVO);
    await cuerpo.servicio.procesar(TOP, Buffer.from('[]'));
    expect(topico.cuarentenas().map((q) => q.motivo)).toEqual(['malformada']);
    expect(cuerpo.cuarentenas().map((q) => [q.motivo, q.detalle])).toEqual([['malformada', 'formato declarado senml: pack SenML vacío']]);
    expect(topico.marcarVivo).not.toHaveBeenCalled(); // sin identidad en el tópico no hay a quién marcar
    expect(cuerpo.marcarVivo).toHaveBeenCalledTimes(1);
  });
  it('C-68 invalida: canal no declarado, unidad no convertible y fuera de rango; la lectura buena de la misma trama se guarda', async () => {
    const { servicio, cuarentenas, mediciones } = armar(ACTIVO);
    await servicio.procesar(TOP, Buffer.from('[{"n":"temperatura","v":21},{"n":"presion","v":1013},{"n":"temperatura","u":"furlongs","v":1},{"n":"humedad","v":120}]'));
    expect(mediciones().map((m) => m.valor)).toEqual([21]);
    expect(cuarentenas()).toHaveLength(1);
    const { motivo, detalle } = cuarentenas()[0];
    expect(motivo).toBe('invalida');
    expect(detalle).toBe('presion: canal no declarado para este dispositivo; temperatura: unidad furlongs no convertible a Cel; humedad: 120 %RH fuera del rango físico [0, 100]');
  });
  it('C-69 tope: la trama que no cabe en el presupuesto de la hora se rechaza entera', async () => {
    const { servicio, cuarentenas, mediciones } = armar({ ...ACTIVO, intervalo_esperado_s: 3600, canales: 1, ventana_inicio: inicioDeVentana(new Date()), ventana_lecturas: 599 });
    await servicio.procesar(TOP, Buffer.from('[{"n":"temperatura","v":21},{"n":"temperatura","v":22}]'));
    expect(cuarentenas().map((q) => q.motivo)).toEqual(['tope']);
    expect(mediciones()).toEqual([]);
  });
  it('C-96 cada regla estricta del perfil SenML: cuarentena malformada con su motivo, ninguna lectura, el dispositivo vivo y el mensaje se confirma', async () => {
    const casos: [string, string][] = [
      ['[{"bver":11,"n":"temperatura","u":"Cel","v":21.5}]', 'bver 11 no se entiende (se entiende hasta 10)'],
      ['[{"bver":"10","n":"temperatura","u":"Cel","v":21.5}]', 'bver no es un entero positivo'],
      ['[{"n":"temperatura","u":"Cel","v":21.5,"vs":"x"}]', 'más de un campo de valor en un registro (v, vs, vb, vd)'],
      ['[{"n":"temperatura","u":"Cel","v":21.5,"extension_":1}]', 'campo «extension_» desconocido y de los que no se pueden ignorar (termina en «_»)'],
      ['[{"bv":"10","n":"temperatura","u":"Cel","v":21.5}]', 'bv no numérico'],
      ['[{"bv":1e308,"n":"temperatura","u":"Cel","v":1e308}]', 'bv + v fuera del rango numérico'],
      ['[{"bt":"1757300000","n":"temperatura","u":"Cel","v":21.5}]', 'bt no numérico'],
      ['[{"t":null,"n":"temperatura","u":"Cel","v":21.5}]', 't no numérico'],
      ['[{"bu":5,"n":"temperatura","v":21.5}]', 'bu no es texto'],
      ['[{"bver":10,"n":"temperatura","u":"Cel","v":21.5},{"bver":5,"n":"temperatura","u":"Cel","v":21.6}]', 'bver 5 distinto del 10 del resto del pack (todos los registros tienen la misma versión)'],
    ];
    for (const [cuerpo, motivo] of casos) {
      const { servicio, cuarentenas, mediciones, marcarVivo, tramas } = armar(ACTIVO);
      await expect(servicio.procesar(TOP, Buffer.from(cuerpo)), cuerpo).resolves.toBeUndefined(); // no lanza: el broker confirma el mensaje
      expect(cuarentenas().map((c) => [c.motivo, c.detalle, c.dispositivo]), cuerpo).toEqual([['malformada', `formato declarado senml: ${motivo}`, 'd1']]);
      expect(mediciones(), cuerpo).toEqual([]);
      expect(tramas(), cuerpo).toHaveLength(0); // sin lecturas no se guarda la trama aceptada
      expect(marcarVivo, cuerpo).toHaveBeenCalledTimes(1);
    }
  });
  it('C-70 la lista de motivos del código (type Motivo) es el dominio de ck_cuarentena_motivo en la última migración que lo define', () => {
    const tipo = /type Motivo = ([^;]+);/.exec(fuenteServicio);
    expect(tipo, 'recepcion.service.ts ya no declara type Motivo').not.toBeNull();
    const delCodigo = [...(tipo as RegExpExecArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    expect(delCodigo.length).toBeGreaterThanOrEqual(5);
    expect(delCodigo).toEqual(dominioDelCheck(sqlTodas(), 'ck_cuarentena_motivo'));
  });
});

// ── (g) Adaptadores ────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('contrato (g): adaptadores de formato', () => {
  it('C-80 plano: cada sinónimo del valor, de la unidad y del tiempo se reconoce, y el primero de la lista gana', () => {
    const ms = 1757300000;
    for (const v of ['valor', 'v', 'value']) {
      for (const u of ['unidad', 'u', 'unit']) {
        for (const t of ['tiempo', 't', 'ts', 'time']) {
          const [l] = plano.analizar(ctxDir(`{"${v}":20,"${u}":"Cel","${t}":${ms}}`));
          expect(l, `${v}/${u}/${t}`).toMatchObject({ magnitud: 'temperatura', valor: 20, unidad: 'Cel' });
          expect((l.tiempo as Date).getTime()).toBe(ms * 1000);
        }
      }
    }
    expect(plano.analizar(ctxDir('{"value":1,"v":2,"valor":3}'))[0].valor).toBe(3); // «valor» va primero
    expect(plano.analizar(ctxDir('{"v":1,"u":5}'))[0].unidad).toBeUndefined(); // una unidad que no es cadena se descarta
  });
  it('C-81 plano: sin valor numérico o con JSON ilegible es malformada', () => {
    for (const cuerpo of ['{"u":"Cel"}', '{"v":"21"}', '{"v":null}', '{"v":1e999}', '{"v":', '{}']) {
      expect(() => plano.analizar(ctxDir(cuerpo)), cuerpo).toThrow(TramaMalformada);
    }
  });
  it('C-95 plano: un número a secas de 309 cifras (Infinity para JavaScript) es malformada; uno de 308 cifras se acepta', () => {
    expect(() => plano.analizar(ctxDir('9'.repeat(309)))).toThrow(TramaMalformada);
    expect(() => plano.analizar(ctxDir(`-${'9'.repeat(309)}`))).toThrow('valor fuera del rango numérico');
    expect(Number.isFinite(plano.analizar(ctxDir('9'.repeat(308)))[0].valor)).toBe(true);
  });
  it('C-83 chirpstack: sin deviceInfo no hay identidad (IdentidadNoVerificada); sin devEui, igual; con otro devEui, igual', () => {
    expect(() => chirp.analizar(ctxPas({ object: { temperature: 1 } }))).toThrow(IdentidadNoVerificada);
    expect(() => chirp.analizar(ctxPas({ deviceInfo: {}, object: { temperature: 1 } }))).toThrow(IdentidadNoVerificada);
    expect(() => chirp.analizar(ctxPas({ deviceInfo: { devEui: 'ffffffffffffffff' }, object: { temperature: 1 } }))).toThrow(IdentidadNoVerificada);
    expect(() => chirp.analizar(ctxPas({ deviceInfo: { devEui: DEVEUI }, object: [1] }))).toThrow(TramaMalformada);
  });
  it('C-84 chirpstack: hereda devEui (sin distinguir mayúsculas), time con zona (origen pasarela) y fCnt', () => {
    const c = ctxPas({ time: '2022-07-18T09:34:15.775023242+00:00', fCnt: 7, deviceInfo: { devEui: DEVEUI.toUpperCase() }, object: { temperature: 21.5 } });
    const [l] = chirp.analizar(c);
    expect(l).toMatchObject({ magnitud: 'temperatura', valor: 21.5, unidad: 'Cel' });
    expect(l.tiempo?.toISOString()).toBe('2022-07-18T09:34:15.775Z');
    expect(chirp.origenTiempo).toBe('pasarela');
    expect(c.fcnt).toBe(7);
  });
  it('C-99 las reglas del perfil son de SenML: plano y chirpstack leen como antes un bver, un campo con «_» o dos valores', () => {
    const [p] = plano.analizar(ctxDir('{"v":1,"valor":2,"vs":"x","bver":99,"extension_":1,"bv":50}'));
    expect(p.valor).toBe(2); // «valor» gana; bv no se suma y bver no se mira
    const [c] = chirp.analizar(ctxPas({ deviceInfo: { devEui: DEVEUI }, bver: 99, extension_: 1, object: { temperature: 21.5, vs: 'x' } }));
    expect(c).toMatchObject({ magnitud: 'temperatura', valor: 21.5 });
  });
  it('C-93 los adaptadores registrados son los formatos del CHECK de la base, los del módulo y los archivos del directorio', () => {
    const { servicio } = armar(undefined);
    const registrados = [...(servicio as unknown as { adaptadores: Map<string, unknown> }).adaptadores.keys()].sort();
    expect(registrados).toEqual(['chirpstack', 'milesight', 'plano', 'senml']);
    expect(dominioDelCheck(sqlTodas(), 'ck_dispositivo_formato')).toEqual(registrados);
    const modulo = readFileSync(join(DIR, 'recepcion.module.ts'), 'utf8');
    const enElModulo = [...new Set([...modulo.matchAll(/(\w+)Adaptador\b/g)].map((m) => m[1].toLowerCase()))].sort();
    expect(enElModulo).toEqual(registrados);
    const archivos = readdirSync(join(DIR, 'adaptadores')).filter((f) => f.endsWith('.adaptador.ts')).map((f) => f.split('.')[0]).sort();
    expect(archivos).toEqual(registrados);
  });
});

// ── Guardián de cobertura ────────────────────────────────────────────────────────────────────────────────────────────────────
// Una regla nueva sin fila, o una fila cuya prueba se borró, rompe aquí. Los motivos y los adaptadores salen de su fuente (el tipo
// del servicio, el CHECK de la base, el registro del servicio), no de una lista copiada en esta prueba.
describe('contrato: guardián de cobertura de la matriz', () => {
  const propio = readFileSync(import.meta.filename, 'utf8');
  it('los identificadores son únicos y cada grupo tiene reglas', () => {
    const ids = MATRIZ.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((i) => /^C-\d{2,3}$/.test(i))).toBe(true);
    for (const g of ['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const) expect(MATRIZ.some((r) => r.grupo === g), `grupo ${g}`).toBe(true);
    expect(MATRIZ.every((r) => r.regla && r.fuente && r.esperado && r.cubre.length > 0)).toBe(true);
  });
  it('cada regla cita pruebas que existen: el archivo está y contiene el nombre citado', () => {
    const faltan: string[] = [];
    for (const r of MATRIZ) {
      for (const c of r.cubre) {
        const ruta = join(DIR, c.archivo);
        const texto = existsSync(ruta) ? readFileSync(ruta, 'utf8') : undefined;
        // Las pruebas nuevas se buscan como «it('C-NN » o «it.todo('C-NN »; las anteriores, por una parte de su título, en una línea que
        // abre una prueba (`it(`): un `describe` o un comentario con ese texto no cuentan.
        const hallada = texto !== undefined && (c.archivo === 'contrato.spec.ts'
          ? new RegExp(`\\bit(\\.todo)?\\('${c.nombre.trim()} `).test(texto)
          : texto.split('\n').some((l) => /^\s*it(\.todo)?\(/.test(l) && l.includes(c.nombre)));
        if (!hallada) faltan.push(`${r.id} → ${c.archivo}: «${c.nombre}»`);
      }
    }
    expect(faltan).toEqual([]);
  });
  it('cada prueba C-NN de este archivo tiene su fila en la matriz', () => {
    const enPruebas = [...propio.matchAll(/^\s*it(?:\.todo)?\('(C-\d{2,3}) /gm)].map((m) => m[1]);
    expect(enPruebas.length).toBeGreaterThanOrEqual(30);
    const enMatriz = new Set(MATRIZ.map((r) => r.id));
    expect(enPruebas.filter((i) => !enMatriz.has(i))).toEqual([]);
  });
  it('cada motivo de cuarentena (el tipo del servicio y el CHECK de la base) tiene al menos un caso del grupo f', () => {
    const tipo = /type Motivo = ([^;]+);/.exec(fuenteServicio);
    const motivos = [...((tipo as RegExpExecArray)[1]).matchAll(/'([^']+)'/g)].map((m) => m[1]);
    for (const m of new Set([...motivos, ...dominioDelCheck(sqlTodas(), 'ck_cuarentena_motivo')])) {
      expect(MATRIZ.filter((r) => r.grupo === 'f' && r.motivo === m).length, `motivo «${m}» sin caso`).toBeGreaterThanOrEqual(1);
    }
    // Y al revés: ninguna fila nombra un motivo que el código no tenga.
    expect(MATRIZ.filter((r) => r.motivo !== undefined && !motivos.includes(r.motivo))).toEqual([]);
  });
  it('cada adaptador registrado tiene en el grupo g un caso válido y uno malformado', () => {
    const { servicio } = armar(undefined);
    const registrados = [...(servicio as unknown as { adaptadores: Map<string, unknown> }).adaptadores.keys()];
    expect(registrados.length).toBeGreaterThanOrEqual(4);
    for (const nombre of registrados) {
      for (const tipo of ['valida', 'malformada'] as const) {
        expect(MATRIZ.filter((r) => r.grupo === 'g' && r.adaptador === nombre && r.tipo === tipo).length, `adaptador «${nombre}» sin caso ${tipo}`).toBeGreaterThanOrEqual(1);
      }
    }
  });
});
