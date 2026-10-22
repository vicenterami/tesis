// Toda hora se muestra en la zona del sitio y lleva el instante UTC al lado (docs/13, docs/19 §1).

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
export function horaLocal(iso: string, zona: string): string {
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
export function fechaHora(iso: string, zona: string): string {
  // Fecha y hora por separado: el conector entre las dos («, » o « a las ») cambia entre versiones de ICU y de navegador.
  const fecha = new Date(iso);
  const dia = new Intl.DateTimeFormat('es-CL', { timeZone: zona, day: 'numeric', month: 'long', year: 'numeric' }).format(fecha);
  const hora = new Intl.DateTimeFormat('es-CL', { timeZone: zona, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(fecha);
  return `${dia}, ${hora}`;
}

// «hace 42 s» mientras sea reciente (la señal de «en vivo» de la ficha, docs/19 §4 punto 5); después, como haceCuanto.
export function haceSegundos(iso: string, ahora: Date): string {
  const s = Math.max(0, Math.floor((ahora.getTime() - Date.parse(iso)) / 1000));
  return s < 120 ? `hace ${s} s` : haceCuanto(iso, ahora);
}
