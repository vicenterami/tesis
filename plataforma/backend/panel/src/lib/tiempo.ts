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
