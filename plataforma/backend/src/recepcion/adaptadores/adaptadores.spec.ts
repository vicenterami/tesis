import { TramaMalformada } from './adaptador';
import { PlanoAdaptador } from './plano.adaptador';
import { SenmlAdaptador } from './senml.adaptador';
import { ContextoTrama } from '../lectura';

const ctx = (cuerpo: string, magnitud = 'temperatura'): ContextoTrama => ({
  topico: `sitio/uct/dispositivo/dev-0001/${magnitud}`, idFisico: 'dev-0001', magnitudTopico: magnitud, carga: Buffer.from(cuerpo, 'utf8'),
});

describe('SenmlAdaptador (contrato nativo, RFC 8428)', () => {
  const a = new SenmlAdaptador();
  it('reconoce un pack (arreglo JSON) y no un objeto ni un número', () => {
    expect(a.reconoce(ctx('[{"n":"temperatura","v":1}]'))).toBe(true);
    expect(a.reconoce(ctx('{"v":1}'))).toBe(false);
    expect(a.reconoce(ctx('21.5'))).toBe(false);
  });
  it('hereda bn/bt/bu y produce varias lecturas de un pack', () => {
    const l = a.analizar(ctx('[{"bn":"dev-0001","bt":1757300000,"bu":"Cel","n":"temperatura","v":22.1},{"n":"humedad","u":"%RH","v":55,"t":10}]'));
    expect(l).toHaveLength(2);
    expect(l[0]).toMatchObject({ magnitud: 'temperatura', valor: 22.1, unidad: 'Cel' });
    expect(l[0].tiempo?.toISOString()).toBe(new Date(1757300000 * 1000).toISOString());
    expect(l[1]).toMatchObject({ magnitud: 'humedad', valor: 55, unidad: '%RH' });
    expect(l[1].tiempo?.getTime()).toBe((1757300000 + 10) * 1000); // t relativo a bt
  });
  it('sin nombre en el registro, la magnitud sale del tópico', () => {
    expect(a.analizar(ctx('[{"v":3}]', 'humedad'))[0].magnitud).toBe('humedad');
  });
  it('rechaza JSON inválido, pack vacío y valores no numéricos', () => {
    expect(() => a.analizar(ctx('[{'))).toThrow(TramaMalformada);
    expect(() => a.analizar(ctx('[]'))).toThrow(TramaMalformada);
    expect(() => a.analizar(ctx('[{"n":"temperatura","v":"alto"}]'))).toThrow(TramaMalformada);
  });
});

describe('PlanoAdaptador (número a secas o JSON simple)', () => {
  const a = new PlanoAdaptador();
  it('reconoce un número o un objeto, no un arreglo ni texto', () => {
    expect(a.reconoce(ctx('21.5'))).toBe(true);
    expect(a.reconoce(ctx('-3'))).toBe(true);
    expect(a.reconoce(ctx('{"v":1}'))).toBe(true);
    expect(a.reconoce(ctx('[1]'))).toBe(false);
    expect(a.reconoce(ctx('abc'))).toBe(false);
  });
  it('número a secas → una lectura con la magnitud del tópico y sin unidad', () => {
    expect(a.analizar(ctx('21.5'))).toEqual([{ magnitud: 'temperatura', valor: 21.5 }]);
  });
  it('objeto con nombres tolerantes; tiempo en segundos o milisegundos', () => {
    const [seg] = a.analizar(ctx('{"valor":20,"unidad":"Cel","tiempo":1757300000}'));
    expect(seg).toMatchObject({ valor: 20, unidad: 'Cel' });
    expect(seg.tiempo?.getTime()).toBe(1757300000 * 1000);
    const [ms] = a.analizar(ctx('{"v":20,"u":"K","ts":1757300000000}'));
    expect(ms.tiempo?.getTime()).toBe(1757300000000);
  });
  it('sin valor numérico → malformada', () => {
    expect(() => a.analizar(ctx('{"u":"Cel"}'))).toThrow(TramaMalformada);
    expect(() => a.analizar(ctx('{"v":"alto"}'))).toThrow(TramaMalformada);
  });
});
