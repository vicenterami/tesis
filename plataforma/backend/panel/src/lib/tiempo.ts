// Toda hora se muestra en la zona del sitio y lleva el instante UTC al lado (docs/13, docs/19 §1); si la persona eligió una zona propia en
// sus preferencias (P13), las horas que se MUESTRAN van en esa (`zonaVista`). Lo que la persona escribe (`instanteDesdeLocal`) y los días
// que se piden a la API siguen en la zona del sitio.
import { zonaPropia } from './zona-propia.svelte';

// La zona en que se muestran las horas: la propia si la hay, si no la del sitio.
export const zonaVista = (zonaSitio: string): string => zonaPropia() ?? zonaSitio;
// ¿La persona ve las horas en una zona distinta de la del sitio? (con una propia igual a la del sitio, nada cambia)
export const veEnOtraZona = (zonaSitio: string): boolean => zonaVista(zonaSitio) !== zonaSitio;

// «hace 3 min», «hace 2 h», «hace 5 d»; null → «sin tramas aún». Nunca negativo: un reloj adelantado muestra «ahora».
export function haceCuanto(iso: string | null, ahora: Date): string {
  if (iso === null) return 'sin tramas aún';
  const s = Math.max(0, Math.floor((ahora.getTime() - Date.parse(iso)) / 1000));
  if (s < 60) return 'ahora';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86_400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86_400)} d`;
}

// Hora local del sitio (zona IANA) y, entre paréntesis, el instante UTC tal como lo guarda la base.
export function horaLocal(iso: string, zonaSitio: string): string {
  return horaEn(iso, zonaVista(zonaSitio));
}
// Igual, en la zona exacta que se pide (sin la preferencia): para lo que debe decir UTC, p. ej.
export function horaEn(iso: string, zona: string): string {
  const fecha = new Date(iso);
  const local = new Intl.DateTimeFormat('es-CL', { timeZone: zona, dateStyle: 'short', timeStyle: 'medium' }).format(fecha);
  return `${local} (${fecha.toISOString()} UTC)`;
}

// Una duración en segundos, para personas (docs/19 §6): «17 s», «3 min», «1,5 h». Hasta 2 min en segundos; hasta 1 h en minutos.
export function duracion(s: number): string {
  const f = (n: number): string => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 }).format(n);
  if (s < 120) return `${Math.round(s)} s`;
  if (s < 3600) return `${f(s / 60)} min`;
  return `${f(s / 3600)} h`;
}

// Fecha y hora en la zona del sitio, en palabras («20 de octubre de 2026, 14:05»), sin el UTC: el UTC va en el título (docs/13).
export function fechaHora(iso: string, zonaSitio: string): string {
  return fechaHoraEn(iso, zonaVista(zonaSitio));
}
// Igual, en la zona exacta que se pide (sin la preferencia).
export function fechaHoraEn(iso: string, zona: string): string {
  // Fecha y hora por separado: el conector entre las dos («, » o « a las ») cambia entre versiones de ICU y de navegador.
  const fecha = new Date(iso);
  const dia = new Intl.DateTimeFormat('es-CL', { timeZone: zona, day: 'numeric', month: 'long', year: 'numeric' }).format(fecha);
  const hora = new Intl.DateTimeFormat('es-CL', { timeZone: zona, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(fecha);
  return `${dia}, ${hora}`;
}

// Una fecha civil «AAAA-MM-DD» (la que sirve el servidor sin hora, p. ej. la de un texto legal) como «DD/MM/AAAA». No es un instante: no se
// convierte de zona (pasarla por `Date` la correría un día en husos al oeste de UTC). Si no tiene esa forma, se devuelve tal cual.
export function fechaCivil(f: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(f);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : f;
}

// «hace 42 s» mientras sea reciente (la señal de «en vivo» de la ficha, docs/19 §4 punto 5); después, como haceCuanto.
export function haceSegundos(iso: string, ahora: Date): string {
  const s = Math.max(0, Math.floor((ahora.getTime() - Date.parse(iso)) / 1000));
  return s < 120 ? `hace ${s} s` : haceCuanto(iso, ahora);
}

// Desfase de una zona IANA en un instante, «UTC−03:00» (docs/19 §4, incremento 2, punto 3; docs/13 regla 6). Se calcula al instante
// (cambia con el horario de verano), nunca se escribe fijo. `longOffset` da «GMT-03:00» (o «GMT» en cero); el navegador que no lo
// conoce lanza RangeError y se usa `short` («GMT-3»); si `short` trae una abreviatura («EDT»), se calcula de las partes de la fecha.
export function desfase(zona: string, instante: Date): string {
  const nombre = (estilo: 'longOffset' | 'short'): string =>
    new Intl.DateTimeFormat('en-US', { timeZone: zona, timeZoneName: estilo }).formatToParts(instante).find((p) => p.type === 'timeZoneName')?.value ?? '';
  let texto: string;
  try {
    texto = nombre('longOffset');
  } catch {
    texto = nombre('short');
  }
  let minutos: number;
  const m = /^(?:GMT|UTC)(?:([+-])(\d{1,2})(?::?(\d{2}))?)?$/.exec(texto);
  if (m) minutos = m[1] === undefined ? 0 : (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
  else {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', { timeZone: zona, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
        .formatToParts(instante).map((x) => [x.type, Number(x.value)]),
    );
    const enZona = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!);
    minutos = Math.round((enZona - Math.floor(instante.getTime() / 60_000) * 60_000) / 60_000);
  }
  const a = Math.abs(minutos);
  return `UTC${minutos < 0 ? '\u2212' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

// «22/10/2026 21:58:07» en la zona del sitio, 24 h y con segundos (la hora del sitio bajo la cabecera, punto 3).
export function relojSitio(zona: string, instante: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('es-CL', { timeZone: zona, hourCycle: 'h23', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(instante).map((x) => [x.type, x.value]),
  );
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second}`;
}

// La zona del navegador (o null si no la declara): la que se compara con la del sitio para avisar.
export function zonaDelNavegador(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}


// ── Rango a medida (HU-07; docs/19 §4, tablero v2, B1): `<input type="datetime-local">` escribe una hora SIN zona; se interpreta en la
// zona del sitio (docs/13 regla 6), nunca en la del navegador. Minutos de desfase de la zona en un instante (positivo al este de UTC).
function minutosDeDesfase(zona: string, instante: number): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: zona, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(new Date(instante)).map((x) => [x.type, Number(x.value)]),
  );
  const enZona = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  return Math.round((enZona - Math.floor(instante / 1000) * 1000) / 60_000);
}
// «2026-11-10T08:30» en la zona → el instante. Cerca de un cambio de hora rigen dos desfases: el de antes y el de después (ninguna zona se
// aparta más de 14 h de UTC, así que se miran 14 h antes y 14 h después). Sirve el que, aplicado, vuelve a dar esa hora en la zona. Una hora
// repetida (al atrasar el reloj) es la primera vez; una que no existe (al adelantarlo) cae en la siguiente válida, con el desfase de antes
// del salto: en Santiago, el 00:30 del día del cambio es la 01:30. Un texto inválido → null.
// Corrección del 19/11/2026 (la exportación por días del sitio, docs/19 §4, R): se probaba el desfase dos veces a partir de la misma hora
// tomada como UTC, y en las zonas al oeste de UTC la hora que no existe caía una hora ANTES (el 00:00 del cambio en Santiago daba las 23:00
// del día anterior: un día exportado de 00:00 a 00:00 perdía su última hora).
export function instanteDesdeLocal(texto: string, zona: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(texto);
  if (!m) return null;
  const comoUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
  if (Number.isNaN(comoUtc)) return null;
  const antes = minutosDeDesfase(zona, comoUtc - 14 * 3_600_000);
  const despues = minutosDeDesfase(zona, comoUtc + 14 * 3_600_000);
  const sirven = [antes, despues].filter((o) => minutosDeDesfase(zona, comoUtc - o * 60_000) === o);
  const o = sirven.length > 0 ? Math.max(...sirven) : Math.min(antes, despues);
  return new Date(comoUtc - o * 60_000);
}
// El instante → «2026-11-10T08:30» en la zona (el valor que el campo datetime-local muestra).
export function localDesdeInstante(instante: Date, zona: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: zona, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(instante).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
