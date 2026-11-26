import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PuertoSimulado, TIEMPOS_PRUEBA, type OpcionesEquipo } from './serie-simulado';
import {
  PREFIJO, TEXTO_CAMPO, cargarEnEquipo, interpretarLinea, lineaDeOrden, serieDelNavegador, sitioDeTopico, textoDeFalla, validarDatos,
  type CodigoFalla, type DatosCarga, type PasoCarga,
} from './serie';

// «Cargar en el equipo» (docs/19 §4, Z): el protocolo serie contra un equipo simulado que contesta como el firmware. Claves falsas.
const DATOS: DatosCarga = {
  red: 'red-de-prueba', clave_red: 'clave-de-red-falsa', servidor: 'servidor.ejemplo', puerto: 8883, sitio: 'uct', id: 'nodo-0001', clave: 'clave-falsa-de-prueba-0000000001',
};
async function cargar(o: OpcionesEquipo = {}, datos: DatosCarga = DATOS, senal?: AbortSignal, confirmarReemplazo?: (actual: string) => Promise<boolean>) {
  const p = new PuertoSimulado(o);
  const pasos: PasoCarga[] = [];
  const r = await cargarEnEquipo(p, datos, (x) => pasos.push(x), { tiempos: TIEMPOS_PRUEBA, senal, confirmarReemplazo });
  return { p, pasos, r };
}

describe('validarDatos: las reglas del firmware (include/protocolo.h), el mismo orden', () => {
  it('lo válido pasa, también una red abierta (clave vacía), una red con tilde y una credencial base64', () => {
    expect(validarDatos(DATOS)).toBeNull();
    expect(validarDatos({ ...DATOS, clave_red: '' })).toBeNull();
    expect(validarDatos({ ...DATOS, red: 'Café' })).toBeNull();
    expect(validarDatos({ ...DATOS, clave: 'abc+/=0123456789' })).toBeNull();
  });
  it.each([
    ['red', { red: '' }], ['red', { red: 'x'.repeat(33) }], ['red', { red: 'ñ'.repeat(17) }], // 34 bytes en UTF-8
    ['clave_red', { clave_red: 'corta12' }], ['clave_red', { clave_red: 'x'.repeat(64) }], ['clave_red', { clave_red: 'clave-con-ñ-0' }],
    ['servidor', { servidor: '' }], ['servidor', { servidor: '-malo' }], ['servidor', { servidor: 'con espacio' }], ['servidor', { servidor: 'a/b' }],
    ['puerto', { puerto: 0 }], ['puerto', { puerto: 65_536 }], ['puerto', { puerto: 88.3 }], ['puerto', { puerto: Number.NaN }],
    ['sitio', { sitio: 'u' }], ['sitio', { sitio: 'UCT' }], ['id', { id: 'no' }], ['id', { id: 'Nodo-1' }],
    ['clave', { clave: 'corta' }], ['clave', { clave: 'con espacio 000000000' }], ['clave', { clave: 'k'.repeat(129) }],
  ] as const)('rechaza «%s» con %j', (campo, cambio) => {
    expect(validarDatos({ ...DATOS, ...cambio })).toBe(campo);
  });
});

// Los mismos casos que prueban el firmware (prueba-protocolo.cpp) y el guion (prueba_cargar_equipo.py): las tres reglas rechazan lo mismo.
describe('validarDatos con los casos compartidos (plataforma/firmware/herramientas/casos-validacion.txt)', () => {
  const BASE = { red: 'red-de-prueba', clave_red: 'clave-de-red-falsa', servidor: 'servidor.ejemplo', puerto: 8883, sitio: 'uct', id: 'nodo-0001', clave: 'clave-falsa-de-prueba-sin-valor' };
  const casos = readFileSync(new URL('../../../../firmware/herramientas/casos-validacion.txt', import.meta.url), 'utf8').split('\n')
    .filter((l) => l !== '' && !l.startsWith('#')).map((l) => l.split('\t') as [string, string]);
  it('hay casos (el archivo se leyó)', () => expect(casos.length).toBeGreaterThanOrEqual(25));
  it.each(casos)('%s ← %s', (campo, fragmento) => {
    const datos = { ...BASE, ...(JSON.parse(`{${fragmento}}`) as Partial<DatosCarga>) };
    expect(validarDatos(datos)).toBe(campo === 'ninguno' ? null : campo);
  });
});

describe('interpretarLinea y lineaDeOrden', () => {
  it('solo las líneas con el prefijo son respuestas; el registro y lo que no se entiende, no', () => {
    expect(interpretarLinea(`${PREFIJO}{"ok":true,"orden":"hola"}\r`)).toEqual({ ok: true, orden: 'hola' });
    expect(interpretarLinea('MQTT: conectado con TLS y la credencial del alta')).toBeNull();
    expect(interpretarLinea(`${PREFIJO}no es json`)).toBeNull();
    expect(interpretarLinea(`${PREFIJO}[1,2]`)).toBeNull();
    expect(interpretarLinea(`${PREFIJO}{"orden":"hola"}`)).toBeNull(); // sin `ok`
  });
  it('una orden es una línea JSON terminada en salto de línea', () => {
    expect(lineaDeOrden({ orden: 'hola' })).toBe('{"orden":"hola"}\n');
  });
});

describe('serieDelNavegador: solo con Web Serial y en contexto seguro', () => {
  const serial = { requestPort: async () => new PuertoSimulado() };
  it('con `serial` y en contexto seguro → la API; sin `serial` o sin contexto seguro → null', () => {
    expect(serieDelNavegador({ serial }, true)).toBe(serial);
    expect(serieDelNavegador({}, true)).toBeNull();
    expect(serieDelNavegador({ serial }, false)).toBeNull();
    expect(serieDelNavegador(undefined, true)).toBeNull();
  });
});

describe('sitioDeTopico', () => {
  it('el sitio del tópico de un equipo MQTT; lo demás, null', () => {
    expect(sitioDeTopico('sitio/uct/dispositivo/nodo-0001/<magnitud>')).toBe('uct');
    expect(sitioDeTopico('POST /recepcion/nodo-0001')).toBeNull();
    expect(sitioDeTopico('por su pasarela ug65')).toBeNull();
    expect(sitioDeTopico(null)).toBeNull();
  });
});

describe('cargarEnEquipo contra un equipo simulado', () => {
  it('saluda, carga, espera el reinicio y sigue el estado: cargada → red → broker; baja DTR y RTS y cierra el puerto', async () => {
    const { p, pasos, r } = await cargar();
    expect(r).toEqual({ cargada: true, red: true, broker: true, falla: null, sinSeguimiento: false });
    expect(pasos).toEqual(['cargada', 'red', 'broker']);
    expect(p.recibidas.filter((o) => o.orden === 'configurar')).toEqual([{ orden: 'configurar', ...DATOS }]);
    expect(p.recibidas[0]).toEqual({ orden: 'hola' }); // primero saluda: no le manda nada a un equipo que no conoce
    expect(p.senales).toEqual([{ dataTerminalReady: false, requestToSend: false }]);
    expect(p.abierto).toBe(false);
    expect(p.olvidado).toBe(true); // suelta el permiso del puerto al terminar
  });
  it('recargar el MISMO identificador con una red que no conecta termina en falla, nunca en «el broker la aceptó» (la sesión vieja no cuenta)', async () => {
    const { pasos, r } = await cargar({ config: { id: DATOS.id }, conectado: true, sinRed: true, ventanaVieja: 60 });
    expect(r).toMatchObject({ cargada: true, red: false, broker: false, falla: { codigo: 'wifi' } });
    expect(pasos).toEqual(['cargada']);
  });
  it('ya cargado con OTRO identificador: sin confirmar no se manda nada; con la confirmación, se reemplaza', async () => {
    const sin = await cargar({ config: { id: 'nodo-0009' } });
    expect(sin.r.falla).toEqual({ codigo: 'reemplazo', actual: 'nodo-0009' });
    expect(sin.p.recibidas.some((x) => x.orden === 'configurar')).toBe(false);
    expect(textoDeFalla(sin.r.falla!)).toBe('No se cargó nada: el equipo sigue cargado como nodo-0009.');
    const pedidas: string[] = [];
    const no = await cargar({ config: { id: 'nodo-0009' } }, DATOS, undefined, async (x) => { pedidas.push(x); return false; });
    expect(no.r.falla?.codigo).toBe('reemplazo');
    expect(no.p.recibidas.some((x) => x.orden === 'configurar')).toBe(false);
    const si = await cargar({ config: { id: 'nodo-0009' } }, DATOS, undefined, async (x) => { pedidas.push(x); return true; });
    expect(si.r).toMatchObject({ cargada: true, broker: true, falla: null });
    expect(pedidas).toEqual(['nodo-0009', 'nodo-0009']);
  });
  it('nuestro firmware de otra versión del protocolo (o sin `arranque`) se dice como tal y no recibe la carga', async () => {
    for (const o of [{ protocolo: 1 }, { sinArranque: true }] as OpcionesEquipo[]) {
      const { p, r } = await cargar(o);
      expect(r.falla?.codigo).toBe('otra_version');
      expect(p.recibidas.some((x) => x.orden === 'configurar')).toBe(false);
    }
    expect(textoDeFalla({ codigo: 'otra_version', protocolo: 1 })).toContain('de otra versión (protocolo 1; este panel habla el 2)');
  });
  it('un equipo que no drena lo que recibe no cuelga la carga: la escritura tiene plazo y el puerto se cierra', async () => {
    const { p, r } = await cargar({ escrituraTrabada: true });
    expect(r.falla?.codigo).toBe('no_responde');
    expect(p.abierto).toBe(false);
  });
  it('un equipo que tarda en contestar (reiniciándose al abrir el puerto) se espera, repitiendo `hola`', async () => {
    const { p, r } = await cargar({ holaTrasIntentos: 3 });
    expect(r.broker).toBe(true);
    expect(p.recibidas.slice(0, 3).map((o) => o.orden)).toEqual(['hola', 'hola', 'hola']);
  });
  it.each<[string, OpcionesEquipo, CodigoFalla, Partial<{ cargada: boolean; red: boolean }>]>([
    ['un equipo mudo', { mudo: true }, 'no_responde', { cargada: false }],
    ['otro firmware', { firmware: 'otro' }, 'otro_firmware', { cargada: false }],
    ['el broker rechaza la credencial', { errorBroker: 'credencial' }, 'credencial', { cargada: true, red: true }],
    ['el certificado no es de esta instalación', { errorBroker: 'tls' }, 'tls', { cargada: true, red: true }],
    ['la red no aparece', { sinRed: true }, 'wifi', { cargada: true, red: false }],
    ['vuelve con lo anterior', { noGuarda: true }, 'otro_id', { cargada: true }],
    ['otro programa tiene el puerto', { abrirFalla: true }, 'puerto', { cargada: false }],
  ])('%s → %s', async (_que, o, codigo, esperado) => {
    const { p, r } = await cargar(o);
    expect(r.falla).toEqual({ codigo });
    expect(r).toMatchObject(esperado);
    expect(p.abierto).toBe(false);
    if (codigo === 'no_responde' || codigo === 'otro_firmware') expect(p.recibidas.some((x) => x.orden === 'configurar')).toBe(false);
  });
  it('un error de forma sin orden (un trozo viejo en el búfer del equipo) no se toma por la respuesta a `hola`: se repite y carga', async () => {
    const { p, r } = await cargar({ basuraInicial: true });
    expect(r).toMatchObject({ cargada: true, broker: true, falla: null });
    expect(p.recibidas[0]).toEqual({ orden: 'hola' }); // el primero se perdió en la basura; el que cuenta es el siguiente
  });
  it('el cable se desconecta al llegar `configurar`: no confirmó, nada se da por cargado y el puerto queda cerrado', async () => {
    const { p, pasos, r } = await cargar({ cortaEnConfigurar: true });
    expect(r).toMatchObject({ cargada: false, falla: { codigo: 'no_confirmo' } });
    expect(pasos).toEqual([]);
    expect(p.abierto).toBe(false);
  });
  it('el equipo rechaza un campo: no guardó nada y se dice cuál, sin su valor', async () => {
    const { r } = await cargar({ rechaza: 'clave' });
    expect(r).toMatchObject({ cargada: false, falla: { codigo: 'rechazado', campo: 'clave' } });
    expect(textoDeFalla(r.falla!)).toBe(`No se cargó nada: revisa ${TEXTO_CAMPO.clave}.`);
  });
  it('un campo rechazado que no es de los datos (p. ej. «toString», de un equipo que contesta basura) no se nombra: «no guardó»', async () => {
    const { r } = await cargar({ rechaza: 'toString' });
    expect(r).toMatchObject({ cargada: false, falla: { codigo: 'no_guardo' } });
    expect(textoDeFalla(r.falla!)).not.toMatch(/function|native/);
  });
  it('un dato que no cumple su regla no abre el puerto', async () => {
    const { p, r } = await cargar({}, { ...DATOS, servidor: 'con espacio' });
    expect(r.falla).toEqual({ codigo: 'datos', campo: 'servidor' });
    expect(p.aperturas).toBe(0);
  });
  it('USB nativo: el puerto se cierra al reiniciar → cargada, sin seguimiento (lo que sigue lo dice la primera trama)', async () => {
    const { r, pasos } = await cargar({ cierraAlReiniciar: true });
    expect(r).toEqual({ cargada: true, red: false, broker: false, falla: null, sinSeguimiento: true });
    expect(pasos).toEqual(['cargada']);
  });
  it('detenerla (la persona sale de la pantalla) cierra el puerto y dice «cancelado»', async () => {
    const c = new AbortController();
    const p = new PuertoSimulado({ mudo: true });
    const promesa = cargarEnEquipo(p, DATOS, () => {}, { tiempos: { ...TIEMPOS_PRUEBA, esperaSaludo: 5_000 }, senal: c.signal });
    setTimeout(() => c.abort(), 30);
    const r = await promesa;
    expect(r.falla).toEqual({ codigo: 'cancelado' });
    expect(p.abierto).toBe(false);
  });
  it('ningún texto de falla lleva un valor de los datos (solo el nombre del campo)', () => {
    const codigos: CodigoFalla[] = ['datos', 'puerto', 'no_responde', 'otro_firmware', 'rechazado', 'no_guardo', 'no_confirmo', 'otro_id', 'wifi', 'dns', 'tls', 'credencial', 'broker', 'sin_conexion', 'cancelado'];
    for (const codigo of codigos) {
      for (const campo of Object.keys(TEXTO_CAMPO) as (keyof DatosCarga)[]) {
        const t = textoDeFalla({ codigo, campo });
        expect(t.length).toBeGreaterThan(10);
        for (const v of [DATOS.clave, DATOS.clave_red, DATOS.red]) expect(t).not.toContain(v);
      }
    }
  });
});
