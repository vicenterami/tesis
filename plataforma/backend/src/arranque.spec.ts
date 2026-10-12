import { HOSTS_LOCALES, hostsPermitidos, interfazDeEscucha, nombreDeHost, rechazoDeHost, registrosEnJson, servirDocumentacion } from './arranque';

describe('registrosEnJson (docs/10 §6): JSON en contenedor, texto en desarrollo', () => {
  it('sin variable → texto', () => expect(registrosEnJson(undefined)).toBe(false));
  it('«texto» → texto', () => expect(registrosEnJson('texto')).toBe(false));
  it('« JSON » con espacios y mayúsculas → json', () => expect(registrosEnJson(' JSON ')).toBe(true));
});

describe('interfazDeEscucha (docs/10 §6): nunca abrir todas las interfaces por accidente', () => {
  it('sin variable → solo este equipo', () => expect(interfazDeEscucha(undefined)).toBe('127.0.0.1'));
  it('variable vacía → solo este equipo (un `??` habría devuelto "" y Node escucha en todas)', () =>
    expect(interfazDeEscucha('')).toBe('127.0.0.1'));
  it('solo espacios → solo este equipo', () => expect(interfazDeEscucha('  ')).toBe('127.0.0.1'));
  it('0.0.0.0 explícito (contenedor) → se respeta', () => expect(interfazDeEscucha('0.0.0.0')).toBe('0.0.0.0'));
});

describe('servirDocumentacion (docs/11 §3): /docs apagada salvo que se pida explícitamente', () => {
  it('sin variable → apagada', () => expect(servirDocumentacion(undefined)).toBe(false));
  it('variable vacía → apagada', () => expect(servirDocumentacion('')).toBe(false));
  it('«no» → apagada', () => expect(servirDocumentacion('no')).toBe(false));
  it('«true» o «1» → apagada (solo vale «si», para no aceptar valores que nadie escribió a propósito)', () => {
    expect(servirDocumentacion('true')).toBe(false);
    expect(servirDocumentacion('1')).toBe(false);
  });
  it('«si» → encendida', () => expect(servirDocumentacion('si')).toBe(true));
  it('« SI » con espacios y mayúsculas → encendida', () => expect(servirDocumentacion(' SI ')).toBe(true));
});

describe('hostsPermitidos (docs/11 §3, docs/10 §8.4 punto 40): los locales siempre; HTTP_HOSTS suma el nombre real', () => {
  it('sin variable o vacía → solo localhost y 127.0.0.1', () => {
    expect([...hostsPermitidos(undefined)]).toEqual([...HOSTS_LOCALES]);
    expect([...hostsPermitidos('')]).toEqual([...HOSTS_LOCALES]);
    expect([...hostsPermitidos(' , ')]).toEqual([...HOSTS_LOCALES]);
  });
  it('un nombre → se suma a los locales, en minúsculas', () =>
    expect(hostsPermitidos('Panel.Example').has('panel.example')).toBe(true));
  it('varios, separados por coma o espacio → todos', () => {
    const h = hostsPermitidos('a.example, b.example c.example');
    expect(h.size).toBe(HOSTS_LOCALES.length + 3);
    expect(h.has('c.example')).toBe(true);
  });
});

describe('nombreDeHost: el nombre del Host, sin puerto y en minúsculas; ilegible → undefined', () => {
  it('nombre con puerto, en mayúsculas → nombre en minúsculas', () => expect(nombreDeHost('LOCALHOST:3000')).toBe('localhost'));
  it('IPv4 con puerto → la IP', () => expect(nombreDeHost('127.0.0.1:3000')).toBe('127.0.0.1'));
  it('IPv6 entre corchetes con puerto → con corchetes', () => expect(nombreDeHost('[::1]:3000')).toBe('[::1]'));
  it('sin puerto → tal cual', () => expect(nombreDeHost('panel.example')).toBe('panel.example'));
  it('ausente, vacío o con cosas que no son un host (usuario@, barra, espacio) → undefined, no se intenta arreglar', () => {
    for (const h of [undefined, '', 'usuario@localhost', 'localhost/x', 'local host', 'localhost:3000:1']) {
      expect(nombreDeHost(h)).toBeUndefined();
    }
  });
});

describe('rechazoDeHost: solo pasan los nombres de la lista; el puerto no cuenta', () => {
  const lista = hostsPermitidos('panel.example');
  it('locales con y sin puerto → pasan', () => {
    for (const h of ['localhost', 'localhost:3000', '127.0.0.1:3000', 'LOCALHOST:5173']) expect(rechazoDeHost(h, lista)).toBeNull();
  });
  it('el nombre real con cualquier puerto → pasa', () => {
    expect(rechazoDeHost('panel.example', lista)).toBeNull();
    expect(rechazoDeHost('panel.example:8443', lista)).toBeNull();
  });
  it('DNS rebinding: el nombre de la página atacante, aunque apunte a 127.0.0.1 → se rechaza', () =>
    expect(rechazoDeHost('ataque.example:3000', lista)).toContain('ataque.example'));
  it('un subdominio o un prefijo del nombre permitido no es el nombre permitido', () => {
    expect(rechazoDeHost('localhost.ataque.example', lista)).not.toBeNull();
    expect(rechazoDeHost('panel.example.ataque.example', lista)).not.toBeNull();
    expect(rechazoDeHost('xpanel.example', lista)).not.toBeNull();
  });
  it('sin Host (HTTP/1.0) o ilegible → se rechaza', () => {
    expect(rechazoDeHost(undefined, lista)).toContain('ausente');
    expect(rechazoDeHost('usuario@localhost', lista)).toContain('ilegible');
  });
  it('el motivo va acotado: un Host de 500 caracteres no llena el registro', () =>
    expect(rechazoDeHost('a'.repeat(500) + '.example', lista)!.length).toBeLessThan(120));
});
