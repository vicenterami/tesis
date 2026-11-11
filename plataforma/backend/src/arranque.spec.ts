import { describe, expect, it } from 'vitest';
import {
  claveApp, AvisosAcotados, claveAdmin, horasClaveTemporal, claveOpcional, HOSTS_LOCALES, hostsPermitidos, interfazDeEscucha, nombreDeHost, rechazoDeHost, registrosEnJson, rutaSinCache, servirDocumentacion } from './arranque.js';

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
  it('un valor sin forma de nombre (inyección en la plantilla de nginx, PROXY_NOMBRE con «;» o llaves) → el arranque falla', () => {
    for (const v of ['a.example;', 'a.example{', 'a.example/x', 'usuario@a.example']) expect(() => hostsPermitidos(v)).toThrow('HTTP_HOSTS');
  });
  it('IPv6 entre corchetes → se acepta', () => expect(hostsPermitidos('[::1]').has('[::1]')).toBe(true));
});

describe('AvisosAcotados: un WARN por motivo y por minuto, con el conteo de los callados', () => {
  it('la primera vez se registra; dentro de la ventana se calla; pasada la ventana vuelve con el conteo', () => {
    const a = new AvisosAcotados(60_000);
    expect(a.registrar('Host x', 0)).toBe('Host x');
    expect(a.registrar('Host x', 1_000)).toBeNull();
    expect(a.registrar('Host x', 59_999)).toBeNull();
    expect(a.registrar('Host x', 60_000)).toBe('Host x (y 2 más en el último minuto)');
    expect(a.registrar('Host x', 120_000)).toBe('Host x');
  });
  it('motivos distintos no se tapan entre sí', () => {
    const a = new AvisosAcotados(60_000);
    expect(a.registrar('Host x', 0)).toBe('Host x');
    expect(a.registrar('Host y', 0)).toBe('Host y');
  });
  it('más de 1 000 motivos distintos (un atacante que varía el nombre) → se olvida todo, nunca crece sin cota', () => {
    const a = new AvisosAcotados(60_000);
    for (let i = 0; i < 1000; i++) a.registrar(`Host ${i}`, 0);
    expect(a.registrar('Host 0', 1)).toBeNull();
    expect(a.registrar('Host nuevo', 2)).toBe('Host nuevo'); // el 1 001.º vacía el mapa…
    expect(a.registrar('Host 0', 3)).toBe('Host 0'); // …y «Host 0» vuelve a registrarse
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

describe('claveAdmin (docs/10 §8.4 punto 41): ausente = 503 en las rutas que escriben; corta = no arranca', () => {
  it('ausente, vacía o solo espacios → undefined (las rutas responden 503, nunca quedan abiertas)', () => {
    for (const v of [undefined, '', '   ']) expect(claveAdmin(v)).toBeUndefined();
  });
  it('23 caracteres → el arranque falla con el largo en el mensaje', () => expect(() => claveAdmin('a'.repeat(23))).toThrow('23 caracteres'));
  it('24 o más → se acepta, sin espacios alrededor', () => expect(claveAdmin(' ' + 'a'.repeat(24) + ' ')).toBe('a'.repeat(24)));
  it('la clave del administrador del broker sigue la misma política, con su nombre en el mensaje', () => {
    expect(() => claveOpcional('MQTT_ADMIN_CLAVE', 'corta')).toThrow('MQTT_ADMIN_CLAVE tiene 5 caracteres');
    expect(claveOpcional('MQTT_ADMIN_CLAVE', undefined)).toBeUndefined();
  });
});

describe('claveApp (DB_APP_CLAVE, migración 14): obligatoria y de 24 caracteres o más (la del ejemplo es más corta)', () => {
  it('ausente, vacía, corta o «CAMBIAR_ESTA_CLAVE» → el backend no arranca, con el remedio en el mensaje; válida → se usa', () => {
    expect(() => claveApp(undefined)).toThrow(/base-rol-app\.sh/);
    expect(() => claveApp('  ')).toThrow(/DB_APP_CLAVE vacía/);
    expect(() => claveApp('corta')).toThrow(/24 o más/);
    expect(() => claveApp('CAMBIAR_ESTA_CLAVE')).toThrow(/24 o más/); // el valor de ejemplo del .env.example
    expect(claveApp('x'.repeat(32))).toBe('x'.repeat(32));
  });
});


describe('rutaSinCache (revisión del 08/11/2026): Cache-Control: no-store en toda la API, salvo el panel y /docs', () => {
  it('rutas de la API → sí, también con mayúsculas o sin barra final', () => {
    for (const r of ['/usuarios', '/sesion', '/dispositivos/x/exportar', '/salud', '/eventos', '/', '/panelito', '/documentos']) expect(rutaSinCache(r)).toBe(true);
  });
  it('archivos del panel y la documentación → no (el navegador puede guardarlos)', () => {
    for (const r of ['/panel', '/panel/', '/panel/assets/app.js', '/PANEL/index.html', '/docs', '/docs/swagger-ui.css']) expect(rutaSinCache(r)).toBe(false);
  });
});

describe('horasClaveTemporal (docs/20 §4): la vigencia de la clave temporal, 1–72 h, 2 por defecto', () => {
  it('sin variable → 2 h', () => expect(horasClaveTemporal(undefined)).toBe(2));
  it('un entero entre 1 y 72 se respeta (también con espacios)', () => {
    expect(horasClaveTemporal('1')).toBe(1);
    expect(horasClaveTemporal(' 24 ')).toBe(24);
    expect(horasClaveTemporal('72')).toBe(72);
  });
  it('0, 73, texto, vacío, decimal o con unidad → el arranque se detiene con un mensaje que dice qué se espera', () => {
    for (const malo of ['0', '73', 'dos', '', ' ', '1.5', '-2', '2h', '1e1']) expect(() => horasClaveTemporal(malo)).toThrow(/^CLAVE_TEMPORAL_HORAS=".*" no es válido: se espera un entero de horas entre 1 y 72 \(por defecto 2\)$/);
  });
});
