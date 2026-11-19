import { describe, expect, it } from 'vitest';
import { BadRequestException, HttpException, PayloadTooLargeException } from '@nestjs/common';
import {
  Catalogos, FilaEntrada, MAX_FILAS_LOTE, RespuestasPorLlave, TasaPorPersona, canonico, filasDelCuerpo, destinoDe, huellaDelPlan, llaveDeReintento, masCercana, modoLote, respuestaLote,
  totales, validarLote,
} from './lote.js';

// Alta por lote (docs/19 §4, F2 y bloque N; docs/10 §8.4 puntos 65 iv y 67): el plan por fila con la misma validación del alta de a uno;
// `n` del cliente; avisos que no bloquean; la huella del plan; un id_fisico ya dado de alta es «existe» con su id. Catálogos falsos: sin base.
const S1 = '00000000-0000-4000-8000-000000000001';
const S2 = '00000000-0000-4000-8000-000000000002';
const Z1 = '00000000-0000-4000-8000-0000000000a1';
const P1 = '00000000-0000-4000-8000-0000000000c1';
const cat: Catalogos = {
  zonas: [
    { id: Z1, nombre: 'Laboratorio', sitio_id: S1, sitio_codigo: 'uct', sitio_nombre: 'Campus' },
    { id: '00000000-0000-4000-8000-0000000000a2', nombre: 'Patio', sitio_id: S1, sitio_codigo: 'uct', sitio_nombre: 'Campus' },
    { id: '00000000-0000-4000-8000-0000000000b1', nombre: 'Patio', sitio_id: S2, sitio_codigo: 'otro', sitio_nombre: 'Otro sitio' },
  ],
  magnitudes: new Map([
    ['temperatura', { nombre: 'Temperatura', unidad: 'Cel' }], ['humedad', { nombre: 'Humedad relativa', unidad: '%RH' }],
    ['bateria', { nombre: 'Nivel de batería', unidad: '%EL' }], ['presion', { nombre: 'Presión atmosférica', unidad: 'hPa' }],
  ]),
  pasarelas: [{ id: P1, id_fisico: 'ug65-campus', sitio_id: S1, activo: true, formato: 'milesight' }],
  existentes: new Map([['nodo-viejo', { id: '00000000-0000-4000-8000-0000000000d1', estado: 'baja' }]]),
  idsDePasarela: new Set(['ug65-campus']),
  ajenos: new Set(['nodo-de-otro', 'pasarela-de-otro']),
};
const fila = (x: Record<string, unknown> = {}, n = 2): FilaEntrada =>
  ({ n, id_fisico: 'nodo-01', nombre: 'Nodo 1', zona: 'Laboratorio', via: 'mqtt', formato: '', intervalo_esperado_s: '60', canales: 'temperatura:Cel | humedad', pasarela: '', ...x });
const numeradas = (xs: Record<string, unknown>[]): FilaEntrada[] => xs.map((x, i) => fila(x, i + 2));

describe('validarLote: el plan por fila', () => {
  it('RF-41: un id_fisico de un dispositivo o pasarela de otro sitio se rechaza sin id, sin estado, sin «existe» y sin interpretada', () => {
    const r = validarLote(numeradas([{ id_fisico: 'nodo-de-otro' }, { id_fisico: 'pasarela-de-otro' }, { id_fisico: 'nodo-viejo' }]), cat);
    expect(r.informe.slice(0, 2).map((f) => [f.resultado, f.motivo, f.id, f.interpretada, f.avisos])).toEqual([
      ['rechazada', 'ese identificador ya está en uso en la plataforma: elige otro', null, null, []], ['rechazada', 'ese identificador ya está en uso en la plataforma: elige otro', null, null, []],
    ]);
    expect(r.informe[2]).toMatchObject({ resultado: 'existe', id: '00000000-0000-4000-8000-0000000000d1', interpretada: null }); // el propio sí dice su id
    // Plantada: sin el conjunto de ajenos, el de otro sitio (si estuviera en `existentes`, como antes) devolvería su id.
    const antes = validarLote([fila({ id_fisico: 'nodo-de-otro' })], { ...cat, ajenos: new Set(), existentes: new Map([['nodo-de-otro', { id: 'x', estado: 'activo' }]]) });
    expect(antes.informe[0]).toMatchObject({ resultado: 'existe', id: 'x' });
  });
  it('una fila buena es «valida» con su `interpretada` (lo que se creará), lo que se completó por omisión y el `n` del cliente tal cual', () => {
    const r = validarLote([fila({}, 7)], cat);
    expect(r.informe[0]).toMatchObject({ n: 7, id_fisico: 'nodo-01', resultado: 'valida', motivo: null, motivos: [], id: null, credencial: null, topico: null, por_defecto: ['formato'] });
    expect(r.informe[0]?.interpretada).toEqual({
      id_fisico: 'nodo-01', nombre: 'Nodo 1', sitio: 'uct', zona: 'Laboratorio', zona_id: Z1, via: 'mqtt', formato: 'senml', intervalo_esperado_s: 60,
      canales: [{ magnitud: 'temperatura', nombre: 'Temperatura', unidad: 'Cel' }, { magnitud: 'humedad', nombre: 'Humedad relativa', unidad: '%RH' }],
      pasarela: null, pasarela_id: null, decodificador: null, topico: 'sitio/uct/dispositivo/nodo-01/<magnitud>',
    });
    expect(r.altas[0]).toMatchObject({ n: 7, formato: 'senml', sitio_codigo: 'uct', alta: { zona_id: Z1, intervalo_esperado_s: 60 } });
    expect(validarLote([fila({ via: '' })], cat).informe[0]?.por_defecto).toEqual(['via', 'formato']);
  });
  it('los motivos van por campo y `motivo` es su unión (mismas reglas que el alta de a uno)', () => {
    const r = validarLote(numeradas([
      {},
      { id_fisico: 'nodo_2' }, // forma del id_fisico
      { id_fisico: 'nodo-03', canales: 'viento:m/s' }, // magnitud fuera del catálogo
      { id_fisico: 'nodo-04', canales: 'temperatura:K' }, // unidad que no es la canónica
      { id_fisico: 'nodo-05', zona: 'Patio' }, // nombre de zona en dos sitios
      { id_fisico: 'nodo-06', zona: 'Bodega' }, // zona inexistente (o de un sitio ajeno: lo mismo)
      { id_fisico: 'nodo-07', intervalo_esperado_s: '2' },
      { id_fisico: 'nodo-01' }, // repetida en el archivo
    ]), cat);
    expect(r.informe.map((f) => f.resultado)).toEqual(['valida', 'rechazada', 'rechazada', 'rechazada', 'rechazada', 'rechazada', 'rechazada', 'rechazada']);
    expect(r.informe.slice(1).map((f) => f.motivos.map((m) => m.campo))).toEqual([['id_fisico'], ['canales'], ['canales'], ['zona'], ['zona'], ['intervalo_esperado_s'], ['id_fisico']]);
    expect(r.informe[1]?.motivo).toMatch(/el identificador «nodo_2» solo admite minúsculas, dígitos y guiones/);
    expect(r.informe[2]?.motivo).toBe('magnitud desconocida «viento»: las del catálogo son bateria, humedad, presion, temperatura');
    expect(r.informe[3]?.motivo).toBe('temperatura va en °C: «K» es otra unidad y no se convierte');
    expect(r.informe[4]?.motivo).toMatch(/hay una zona «Patio» en más de un sitio: escribe su UUID/);
    expect(r.informe[5]?.motivo).toMatch(/la zona «Bodega» no existe en tus sitios/);
    expect(r.informe[6]?.motivo).toBe('cada cuánto reporta va de 5 a 86 400 segundos: 2 es muy poco');
    expect(r.informe[7]?.motivo).toBe('el identificador se repite en el archivo: ya está en la fila 2');
    for (const f of r.informe) expect(f.motivo).toBe(f.motivos.length === 0 ? null : f.motivos.map((m) => m.texto).join('; '));
    expect(r.informe.slice(1).every((f) => f.interpretada === null)).toBe(true);
    expect(r.altas).toHaveLength(1);
  });
  it('avisos (no bloquean): mayúsculas, unidad omitida, formato de un nodo lorawan igual al de su pasarela, nombre repetido; la zona por su nombre ya no es aviso (S3)', () => {
    const r = validarLote(numeradas([
      { id_fisico: 'Nodo-A1', nombre: 'Patio norte' },
      { id_fisico: 'nodo-a2', nombre: 'patio norte', zona: Z1, canales: 'temperatura:Cel' },
      { id_fisico: '0101010101010101', via: 'lorawan', formato: 'milesight', pasarela: 'ug65-campus', canales: 'temperatura:Cel' },
    ]), cat);
    expect(r.informe.map((f) => f.resultado)).toEqual(['valida', 'valida', 'valida']);
    expect(r.informe[0]?.avisos).toEqual([
      { campo: 'id_fisico', texto: 'el identificador venía con mayúsculas: se guardará como «nodo-a1»' },
      { campo: 'nombre', texto: 'el nombre se repite en la fila 3' },
      { campo: 'canales', texto: 'humedad sin unidad: se usa % de humedad' },
    ]);
    expect(r.informe[1]?.avisos).toEqual([{ campo: 'nombre', texto: 'el nombre se repite en la fila 2' }]);
    expect(r.informe[2]?.avisos).toEqual([{ campo: 'formato', texto: 'el formato se ignora: un equipo LoRaWAN usa el de su pasarela (Milesight)' }]);
    // La zona escrita por su nombre se dice una vez, con su sitio por su NOMBRE y cuántas filas; la escrita por su UUID, no.
    expect(r.zonas).toEqual([{ zona: 'Laboratorio', sitio: 'Campus', filas: 2 }]);
    expect(r.informe[2]?.interpretada).toMatchObject({ formato: 'milesight', pasarela: 'ug65-campus', pasarela_id: P1, topico: 'sitio/uct/pasarela/ug65-campus/0101010101010101/<evento>' });
    expect(totales(r.informe)).toMatchObject({ validas: 3, con_aviso: 3 });
  });
  it('invariante: validas + existentes + rechazadas = leidas; solo las que entran traen avisos, así que con_aviso cuenta lo mismo que la línea «N filas que se crean traen avisos» (S3)', () => {
    const r = validarLote(numeradas([{}, { id_fisico: 'nodo-viejo' }, { id_fisico: 'X_1' }, { id_fisico: 'Nodo-02', zona: 'Bodega' }, { id_fisico: 'nodo-03' }]), cat);
    const t = totales(r.informe);
    expect(t).toEqual({ leidas: 5, validas: 2, existentes: 1, rechazadas: 2, con_aviso: 2 });
    expect(t.validas + t.existentes + t.rechazadas).toBe(t.leidas);
    // «Nodo-02» venía con mayúsculas y la unidad de humedad omitida, pero no entra: sin avisos sin sentido («se guardará como…»).
    expect(r.informe[3]).toMatchObject({ resultado: 'rechazada', avisos: [] });
    expect(r.informe[2]).toMatchObject({ resultado: 'rechazada', avisos: [] });
    expect(t.con_aviso).toBe(r.informe.filter((f) => f.resultado === 'valida' && f.avisos.length > 0).length);
  });
  it('un id_fisico que ya existe (aunque esté de baja) es «existe» con su id: reactivarlo es de su ficha, no se duplica', () => {
    const r = validarLote([fila({ id_fisico: 'nodo-viejo' })], cat);
    expect(r.informe[0]).toMatchObject({ resultado: 'existe', id: '00000000-0000-4000-8000-0000000000d1' });
    expect(r.informe[0]?.motivo).toMatch(/reactivarlo desde su ficha/);
    expect(totales(r.informe).existentes).toBe(1);
  });
  it('lorawan: la pasarela por su id_fisico, del mismo sitio; el nodo hereda su formato; la columna decodificador se admite', () => {
    const r = validarLote([fila({ id_fisico: '0101010101010101', via: 'lorawan', pasarela: 'ug65-campus', decodificador: 'campus-heltec-v3-v1' })], cat);
    expect(r.informe[0]?.resultado).toBe('valida');
    expect(r.altas[0]).toMatchObject({ formato: 'milesight', alta: { decodificador: 'campus-heltec-v3-v1' } });
    expect(validarLote([fila({ decodificador: 'campus-heltec-v3-v1' })], cat).informe[0]?.motivos).toEqual([{ campo: 'decodificador', texto: 'el decodificador solo va en un equipo LoRaWAN: deja esa celda vacía' }]);
    expect(validarLote([fila({ id_fisico: 'ug65-campus' })], cat).informe[0]?.motivo).toMatch(/ya lo usa una pasarela/);
  });
  it('zonas y pasarelas se recorren una vez por petición, no una por fila (los recorridos no crecen con las filas)', () => {
    const contar = (filas: number): number => {
      let recorridos = 0;
      const vigilar = <T extends object>(xs: readonly T[]): readonly T[] => new Proxy(xs, {
        get(o, k, r) {
          if (k === 'filter' || k === 'find' || k === 'map' || k === 'some' || k === Symbol.iterator) recorridos++;
          return Reflect.get(o, k, r) as unknown;
        },
      });
      const c = { ...cat, zonas: vigilar(cat.zonas), pasarelas: vigilar(cat.pasarelas) };
      validarLote(Array.from({ length: filas }, (_, i) => fila({ id_fisico: `nodo-${i}`, via: 'lorawan', pasarela: 'ug65-campus', canales: 'temperatura' }, i + 2)), c);
      return recorridos;
    };
    expect(contar(500)).toBe(contar(1));
  });
  it('canales con «|» y con «;» dan el mismo plan', () => {
    const a = validarLote([fila({ canales: 'temperatura:Cel | humedad:%RH' })], cat);
    const b = validarLote([fila({ canales: 'temperatura:Cel;humedad:%RH' })], cat);
    expect(a.informe[0]?.interpretada).toEqual(b.informe[0]?.interpretada);
  });
});

// Bloque S (docs/19 §4): las unidades con su escritura común, los avisos que distinguen, las palabras de la persona y cada motivo con su
// remedio. Cada prueba cae con su defecto plantado (docs/16).
describe('bloque S: unidades, avisos, palabras y remedios', () => {
  it('S2: «°C», «ºC», «C» y «degC» se leen como Cel y «%» como la unidad porcentual de la magnitud; se guarda la del catálogo, con aviso, y el plan es el mismo', () => {
    const r = validarLote(numeradas([
      { id_fisico: 'nodo-01', canales: 'temperatura:°C | humedad:%' }, { id_fisico: 'nodo-02', canales: 'temperatura:ºC' }, { id_fisico: 'nodo-03', canales: 'temperatura:C' },
      { id_fisico: 'nodo-04', canales: 'temperatura:degC | bateria:%' }, { id_fisico: 'nodo-05', canales: 'temperatura:Cel | humedad:%RH' },
    ]), cat);
    expect(r.informe.map((f) => f.resultado)).toEqual(['valida', 'valida', 'valida', 'valida', 'valida']);
    expect(r.informe[0]?.avisos.filter((a) => a.campo === 'canales').map((a) => a.texto)).toEqual(['temperatura: °C se leyó como Cel (°C)', 'humedad: % se leyó como %RH (% de humedad)']);
    expect(r.informe[3]?.interpretada?.canales.map((k) => k.unidad)).toEqual(['Cel', '%EL']);
    expect(r.informe[4]?.avisos.filter((a) => a.campo === 'canales')).toEqual([]); // la del catálogo, sin aviso
    // Lo que se creará no depende de cómo se escribió la unidad: la misma `interpretada` (y la misma huella) que con la del catálogo.
    expect(r.informe[0]?.interpretada?.canales).toEqual(r.informe[4]?.interpretada?.canales);
  });
  it('S2: la familia Celsius se lee sin distinguir mayúsculas («cel», «degc», «°c», «c»), con su aviso; las demás unidades, tal cual', () => {
    const r = validarLote(numeradas(['cel', 'degc', '°c', 'c', 'CEL', 'DegC'].map((u, i) => ({ id_fisico: `nodo-1${i}`, nombre: `N${i}`, canales: `temperatura:${u}` }))), cat);
    expect(r.informe.map((f) => [f.resultado, f.avisos.find((a) => a.campo === 'canales')?.texto])).toEqual(
      ['cel', 'degc', '°c', 'c', 'CEL', 'DegC'].map((u) => ['valida', `temperatura: ${u} se leyó como Cel (°C)`]));
    expect(r.informe.every((f) => f.interpretada?.canales[0]?.unidad === 'Cel')).toBe(true);
    expect(validarLote([fila({ canales: 'humedad:%rh' })], cat).informe[0]?.motivo).toBe('humedad va en % de humedad: «%rh» es otra unidad y no se convierte');
  });
  it('un `canales` que solo trae separadores dice que faltan los canales, no «la fila no entra»', () => {
    for (const c of ['|', ' | ; ', ';']) expect([c, validarLote([fila({ canales: c })], cat).informe[0]?.motivos]).toEqual([c, [{ campo: 'canales', texto: 'faltan los canales: escribe «magnitud:unidad», como «temperatura:°C | humedad:%»' }]]);
  });
  it('destino: a dónde envía según la vía (MQTT, su tópico; HTTP, POST /recepcion/<id>; LoRaWAN, por su pasarela)', () => {
    const r = validarLote(numeradas([{ via: 'mqtt' }, { id_fisico: 'nodo-02', nombre: 'Dos', via: 'http' }, { id_fisico: '0101010101010101', nombre: 'Tres', via: 'lorawan', pasarela: 'ug65-campus', canales: 'temperatura' }]), cat);
    expect(r.informe.map((f) => destinoDe(f.interpretada!))).toEqual(['sitio/uct/dispositivo/nodo-01/<magnitud>', 'POST /recepcion/nodo-02', 'por su pasarela ug65-campus']);
  });
  it('S2: otra unidad no entra ni se convierte («°F», «K»; «%» para una magnitud que no es porcentual), con su remedio', () => {
    const r = validarLote(numeradas([{ canales: 'temperatura:°F' }, { id_fisico: 'nodo-02', canales: 'temperatura:K' }, { id_fisico: 'nodo-03', canales: 'presion:%' }]), cat);
    expect(r.informe.map((f) => f.motivo)).toEqual([
      'temperatura va en °C: «°F» es otra unidad y no se convierte', 'temperatura va en °C: «K» es otra unidad y no se convierte', 'presion va en hPa: «%» es otra unidad y no se convierte',
    ]);
  });
  it('S3: la zona por su nombre no es aviso por fila: se dice una vez, por zona, con el nombre del sitio y solo de las filas que entran', () => {
    const muchas = Array.from({ length: 30 }, (_, i) => ({ id_fisico: `nodo-${i + 10}`, nombre: `Nodo ${i + 10}`, zona: i % 3 === 0 ? 'patio' : 'Laboratorio', canales: 'temperatura:Cel' }));
    const r = validarLote(numeradas([...muchas, { id_fisico: 'nodo-99', nombre: 'Otro', zona: 'Laboratorio', intervalo_esperado_s: '1' }, { id_fisico: 'nodo-98', nombre: 'Por UUID', zona: Z1, canales: 'temperatura:Cel' }]),
      { ...cat, zonas: cat.zonas.filter((z) => z.sitio_id === S1) });
    expect(r.informe.filter((f) => f.avisos.some((a) => a.campo === 'zona'))).toEqual([]);
    expect(r.zonas).toEqual([{ zona: 'Patio', sitio: 'Campus', filas: 10 }, { zona: 'Laboratorio', sitio: 'Campus', filas: 20 }]);
    expect(respuestaLote(r.informe, r.zonas)).toMatchObject({ con_aviso: 0, zonas_por_nombre: r.zonas });
  });
  // Las palabras de la persona (S4): ningún texto que ve la persona trae un nombre de columna o de variable (`id_fisico`, `canales[1]`), el
  // código de una vía o de un formato en vez de su nombre, ni una unidad escrita como código (%RH en vez de «% de humedad»).
  const JERGA = /\b[a-z]+_[a-z_]+\b|\[\d+\]|\b(mqtt|http|lorawan|senml|milesight|chirpstack)\b|%RH|%EL|\buuid\b|\bpasarela_id\b/;
  const textosQueSeVen = (r: ReturnType<typeof validarLote>): string[] => r.informe.flatMap((f) => [
    ...f.motivos.map((m) => m.texto), ...f.avisos.map((a) => a.texto), ...(f.legible === null ? [] : [f.legible.donde, f.legible.resumen, ...Object.entries(f.legible.campos).filter(([k]) => k !== 'topico' && k !== 'id_fisico').map(([, v]) => v)]),
  ]);
  it('S4: cada regla del alta de a uno y del lote se dice en palabras llanas, sin nombres de columna ni de variable (el campo queda para las máquinas)', () => {
    const r = validarLote(numeradas([
      { id_fisico: '' }, { id_fisico: 'ab' }, { id_fisico: '-nodo' }, { id_fisico: 'backend' }, { id_fisico: 'nodo-05', nombre: '' }, { id_fisico: 'nodo-06', via: 'zigbee' },
      { id_fisico: 'nodo-07', formato: 'xml' }, { id_fisico: 'nodo-08', via: 'lorawan' }, { id_fisico: 'nodo-09', pasarela: 'ug65-campus' },
      { id_fisico: 'nodo-10', via: 'lorawan', pasarela: 'no-existe' }, { id_fisico: 'nodo-11', via: 'lorawan', pasarela: 'ug65-campus', decodificador: 'otro' },
      { id_fisico: 'nodo-12', decodificador: 'campus-heltec-v3-v1' }, { id_fisico: 'nodo-13', intervalo_esperado_s: '' }, { id_fisico: 'nodo-14', intervalo_esperado_s: '60,5' },
      { id_fisico: 'nodo-15', intervalo_esperado_s: '100000' }, { id_fisico: 'nodo-16', canales: '' }, { id_fisico: 'nodo-17', canales: 'temperatura:Cel | temperatura:Cel' },
      { id_fisico: 'nodo-18', canales: Array.from({ length: 21 }, () => 'temperatura').join(' | ') }, { id_fisico: 'nodo-19', canales: ':Cel' },
      { id_fisico: 'nodo-20', zona: '' }, { id_fisico: 'nodo-21', via: 'lorawan', pasarela: 'ug65-campus', formato: 'chirpstack' }, { id_fisico: 'ug65-campus' },
      { id_fisico: 'nodo-de-otro' }, { id_fisico: 'nodo-23' }, { id_fisico: 'nodo-23' }, { id_fisico: 'Nodo-24', via: 'lorawan', pasarela: 'ug65-campus', formato: 'milesight', canales: 'temperatura | humedad:%' },
    ]), cat, ['reservado-extra']);
    // La única excepción, por diseño (S2): el aviso «… se leyó como %RH (% de humedad)» nombra la unidad del catálogo, que es lo que dice.
    const textos = textosQueSeVen(r).filter((t) => !/ se leyó como /.test(t));
    expect(textos.length).toBeGreaterThan(30);
    expect(textos.filter((t) => JERGA.test(t))).toEqual([]);
    // «Cada cuánto reporta» distingue la celda vacía, la mal escrita y la fuera de rango.
    expect([13, 14, 15].map((i) => r.informe[i - 1]?.motivo)).toEqual([
      'falta cada cuánto reporta: un número entero de segundos, de 5 a 86 400',
      'cada cuánto reporta va en segundos enteros, sin decimales, letras ni signos: «60,5» no se puede leer',
      'cada cuánto reporta va de 5 a 86 400 segundos: 100000 es demasiado',
    ]);
    expect(r.informe[16]?.motivo).toBe('el canal 2 repite la magnitud «temperatura»');
    expect(r.informe[7]?.motivo).toBe('falta la pasarela: un equipo LoRaWAN la necesita (su identificador)');
    expect(r.informe[9]?.motivo).toBe('la pasarela «no-existe» no existe en tus sitios'); // sin repetir lo mismo con la palabra «UUID»
    // El campo sigue nombrando la columna, para las máquinas (la pantalla pone cada motivo junto a su campo).
    expect(r.informe[13]?.motivos.map((m) => m.campo)).toEqual(['intervalo_esperado_s']);
    expect(r.informe[7]?.motivos.map((m) => m.campo)).toEqual(['pasarela']);
  });
  it('S4: lo que se creará también se lee en palabras: el sitio por su nombre, la vía y el formato por su nombre, el intervalo y las unidades como se leen', () => {
    const r = validarLote([fila({ via: '', canales: 'temperatura:°C | humedad', intervalo_esperado_s: '300' })], cat);
    expect(r.informe[0]?.legible).toEqual({
      donde: 'Laboratorio (sitio Campus)',
      resumen: 'MQTT, SenML, cada 5 min: temperatura (°C), humedad (% de humedad)',
      campos: {
        id_fisico: 'nodo-01', nombre: 'Nodo 1', zona: 'Laboratorio (sitio Campus)', via: 'MQTT', formato: 'SenML', intervalo_esperado_s: 'cada 5 min',
        canales: 'temperatura en °C | humedad en % de humedad', pasarela: '', decodificador: '', topico: 'sitio/uct/dispositivo/nodo-01/<magnitud>',
      },
    });
    expect(r.informe[0]?.interpretada?.sitio).toBe('uct'); // la huella sigue sobre `interpretada`, con el código
    expect(validarLote([fila({ id_fisico: 'X_1' })], cat).informe[0]?.legible).toBeNull();
  });
  it('S5: cada motivo con su remedio: el identificador ajeno sin decir dónde, la magnitud mal escrita con la más cercana (si hay una sola)', () => {
    const r = validarLote(numeradas([
      { canales: 'temperatur:Cel' }, { id_fisico: 'nodo-02', canales: 'humeda' }, { id_fisico: 'nodo-03', canales: 'xyz' }, { id_fisico: 'nodo-de-otro' },
    ]), { ...cat, magnitudes: new Map([...cat.magnitudes, ['temperatura_suelo', { nombre: 'Temperatura del suelo', unidad: 'Cel' }]]) });
    expect(r.informe.map((f) => f.motivo)).toEqual([
      'magnitud desconocida «temperatur»: ¿quisiste decir «temperatura»?',
      'magnitud desconocida «humeda»: ¿quisiste decir «humedad»?',
      'magnitud desconocida «xyz»: las del catálogo son bateria, humedad, presion, temperatura, temperatura_suelo',
      'ese identificador ya está en uso en la plataforma: elige otro',
    ]);
    // Dos a la misma distancia: no se adivina.
    expect(masCercana('abcd', ['abce', 'abcf'])).toBeNull();
    expect(masCercana('temp', ['temperatura'])).toBeNull(); // demasiado lejos
  });
});

describe('la huella del plan', () => {
  it('dos planes iguales, la misma; con solo las filas que entran (como manda la creación), la misma; otro formato u otra zona, otra', () => {
    const filas = numeradas([{}, { id_fisico: 'nodo-02' }, { id_fisico: 'X_3' }, { id_fisico: 'nodo-viejo' }]);
    const h = huellaDelPlan(validarLote(filas, cat).informe);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(huellaDelPlan(validarLote(filas, cat).informe)).toBe(h);
    expect(huellaDelPlan(validarLote(filas.slice(0, 2), cat).informe)).toBe(h);
    expect(huellaDelPlan(validarLote([{ ...filas[0], formato: 'plano' }, filas[1]], cat).informe)).not.toBe(h);
    expect(huellaDelPlan(validarLote([{ ...filas[0], zona: 'Patio' }, filas[1]], { ...cat, zonas: cat.zonas.filter((z) => z.sitio_id === S1) }).informe)).not.toBe(h);
    expect(huellaDelPlan(validarLote([{ ...filas[0], n: 9 }, filas[1]].sort((x, y) => x.n - y.n), cat).informe)).not.toBe(h); // otro n, otro plan
  });
  it('la forma canónica ordena las claves: el orden de construcción no cambia la huella', () => {
    expect(canonico({ b: 1, a: [{ d: null, c: 'x' }] })).toBe('{"a":[{"c":"x","d":null}],"b":1}');
  });
  it('respuestaLote suma la huella y los totales', () => {
    const r = respuestaLote(validarLote([fila()], cat).informe);
    expect(r).toMatchObject({ leidas: 1, validas: 1, existentes: 0, rechazadas: 0, con_aviso: 1, huella: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });
});

describe('forma del cuerpo, modo, llave y límite de tasa', () => {
  it('justo en el tope de filas pasa; una más es 413; vacío o sin `filas`, 400', () => {
    expect(filasDelCuerpo({ filas: Array.from({ length: MAX_FILAS_LOTE }, (_, i) => fila({}, i + 2)) }).filas).toHaveLength(MAX_FILAS_LOTE);
    expect(() => filasDelCuerpo({ filas: Array.from({ length: MAX_FILAS_LOTE + 1 }, () => ({})) })).toThrow(PayloadTooLargeException);
    for (const malo of [{}, { filas: [] }, [], null]) expect(() => filasDelCuerpo(malo)).toThrow(BadRequestException);
  });
  it('`n` del cliente: entero positivo, único y creciente; si no, 400 con la fila (su n, o su posición si n no sirve)', () => {
    const motivos = (c: unknown): string[] => {
      try {
        filasDelCuerpo(c);
        return [];
      } catch (e) {
        return ((e as BadRequestException).getResponse() as { message: string[] }).message;
      }
    };
    expect(filasDelCuerpo({ filas: [fila({}, 2), fila({ id_fisico: 'nodo-02' }, 5)] }).filas.map((f) => f.n)).toEqual([2, 5]);
    expect(motivos({ filas: [{ id_fisico: 'a' }] })).toEqual(['fila en la posición 1: n debe ser un entero positivo (la fila del origen)']);
    expect(motivos({ filas: [fila({}, 3), fila({}, 3)] })).toEqual(['fila 3: n debe ser mayor que el de la fila anterior (3): único y creciente']);
    expect(motivos({ filas: [fila({}, 4), fila({}, 2)] })).toEqual(['fila 2: n debe ser mayor que el de la fila anterior (4): único y creciente']);
    expect(motivos({ filas: [fila({}, 2.5)] })[0]).toMatch(/posición 1: n debe ser un entero/);
    expect(motivos({ filas: [fila({}, 2)], otra: 1 })).toEqual(['campo no admitido en el cuerpo: otra']);
  });
  it('en crear, la huella es obligatoria y con su forma; en validar, opcional', () => {
    expect(() => filasDelCuerpo({ filas: [fila()] }, 'crear')).toThrow(BadRequestException);
    expect(() => filasDelCuerpo({ filas: [fila()], huella: 'xyz' }, 'crear')).toThrow(BadRequestException);
    expect(filasDelCuerpo({ filas: [fila()], huella: 'a'.repeat(64) }, 'crear').huella).toBe('a'.repeat(64));
    expect(filasDelCuerpo({ filas: [fila()] }).huella).toBeNull();
  });
  it('modo: validar o crear; otra cosa, 400', () => {
    expect(modoLote('crear')).toBe('crear');
    expect(() => modoLote('borrar')).toThrow(BadRequestException);
  });
  it('llave de reintento: de 16 a 128 letras, dígitos, «-» o «_»; si no, 400', () => {
    expect(llaveDeReintento('3f2b1c8e-7d6a-4e5f-9a0b-1c2d3e4f5a6b')).toBe('3f2b1c8e-7d6a-4e5f-9a0b-1c2d3e4f5a6b');
    for (const mala of [undefined, '', 'corta', 'a'.repeat(129), 'con espacio 1234567890', ['a'.repeat(20)]]) expect(() => llaveDeReintento(mala)).toThrow(BadRequestException);
  });
  it('respuestas por llave: la misma llave y el mismo cuerpo devuelven lo guardado (con sus sitios); otro cuerpo, 422; vencen a los 2 minutos', () => {
    const r = new RespuestasPorLlave<string>(120_000, 10, 10, 1_000);
    r.guardar('ana', 'k', 'f1', 'respuesta', ['s1'], 10, 0);
    expect(r.tiene('ana', 'k', 1_000)).toBe(true);
    expect(r.buscar('ana', 'k', 'f1', 1_000)).toEqual({ respuesta: 'respuesta', sitios: ['s1'] });
    expect(r.buscar('bruno', 'k', 'f1', 1_000)).toBeUndefined(); // por persona
    const e = (() => { try { r.buscar('ana', 'k', 'f2', 1_000); } catch (x) { return x; } })();
    expect(e).toBeInstanceOf(HttpException);
    expect((e as HttpException).getStatus()).toBe(422);
    expect((e as HttpException).getResponse()).toMatchObject({ codigo: 'llave_reutilizada' });
    expect(r.buscar('ana', 'k', 'f1', 120_000)).toBeUndefined(); // vencida
    expect([r.tamano, r.bytes]).toEqual([0, 0]);
  });
  it('topes del almacén: entradas en total, por persona y bytes en total; la más antigua sale primero y una respuesta más grande que el tope no se guarda', () => {
    const porConteo = new RespuestasPorLlave<string>(120_000, 3, 10, 1_000_000);
    for (const k of ['a', 'b', 'c', 'd']) porConteo.guardar(k, 'k', 'f', k, [], 1, 0);
    expect([porConteo.tamano, porConteo.tiene('a', 'k', 1), porConteo.tiene('d', 'k', 1)]).toEqual([3, false, true]);
    const porPersona = new RespuestasPorLlave<string>(120_000, 100, 2, 1_000_000);
    for (const k of ['a', 'b', 'c']) porPersona.guardar('ana', k, 'f', k, [], 1, 0);
    porPersona.guardar('bruno', 'x', 'f', 'x', [], 1, 0);
    expect([porPersona.tamano, porPersona.tiene('ana', 'a', 1), porPersona.tiene('ana', 'c', 1), porPersona.tiene('bruno', 'x', 1)]).toEqual([3, false, true, true]);
    const porBytes = new RespuestasPorLlave<string>(120_000, 100, 100, 100);
    porBytes.guardar('ana', 'a', 'f', 'a', [], 60, 0);
    porBytes.guardar('bruno', 'b', 'f', 'b', [], 30, 0);
    porBytes.guardar('carla', 'c', 'f', 'c', [], 30, 0); // 60 + 30 + 30 > 100: sale la más antigua
    expect([porBytes.bytes, porBytes.tiene('ana', 'a', 1), porBytes.tiene('carla', 'c', 1)]).toEqual([60, false, true]);
    porBytes.guardar('dario', 'd', 'f', 'd', [], 101, 0); // más grande que el tope: no se guarda ni desaloja
    expect([porBytes.tiene('dario', 'd', 1), porBytes.bytes]).toEqual([false, 60]);
  });
  it('tasa: 10 por minuto por persona; la 11.ª no; otra persona sí; pasado el minuto, de nuevo', () => {
    const t = new TasaPorPersona(10, 60_000);
    for (let i = 0; i < 10; i++) expect(t.admitir('ana', 1_000)).toBe(true);
    expect(t.admitir('ana', 1_000)).toBe(false);
    expect(t.admitir('bruno', 1_000)).toBe(true);
    expect(t.admitir('ana', 61_001)).toBe(true);
  });
});
