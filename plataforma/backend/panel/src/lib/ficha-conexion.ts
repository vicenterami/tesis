// La ficha de conexión de un equipo MQTT (docs/19 §4, bloque Z, punto 6): lo que un equipo de terceros necesita, campo por campo, para
// copiarlo a su propia herramienta, y el mismo contenido como texto plano para descargar. No imita el formato de ningún fabricante.

export interface CampoFicha {
  clave: 'servidor' | 'puerto' | 'usuario' | 'cliente' | 'credencial' | 'topico' | 'formato';
  rotulo: string;
  valor: string;
  copiar: string; // la etiqueta del botón «Copiar …»
  copiado: string; // y la que muestra tras copiar
}

export interface DatosFicha {
  servidor: string;
  usuario: string;
  credencial: string;
  topico: string;
  formato: string;
}

const FORMATOS: Readonly<Record<string, string>> = { senml: 'SenML (RFC 8428), JSON', plano: 'Plano (un número por mensaje)' };

export function camposDeFicha(d: DatosFicha): CampoFicha[] {
  return [
    { clave: 'servidor', rotulo: 'Servidor', valor: d.servidor, copiar: 'Copiar el servidor', copiado: 'Copiado' },
    { clave: 'puerto', rotulo: 'Puerto (MQTT sobre TLS)', valor: '8883', copiar: 'Copiar el puerto', copiado: 'Copiado' },
    { clave: 'usuario', rotulo: 'Usuario', valor: d.usuario, copiar: 'Copiar el usuario', copiado: 'Copiado' },
    // El broker exige que el identificador de cliente sea el usuario (docs/11 §7): se dice aparte porque muchas herramientas lo piden aparte.
    { clave: 'cliente', rotulo: 'Identificador de cliente', valor: d.usuario, copiar: 'Copiar el identificador de cliente', copiado: 'Copiado' },
    { clave: 'credencial', rotulo: 'Clave', valor: d.credencial, copiar: 'Copiar la credencial', copiado: 'Copiada' },
    { clave: 'topico', rotulo: 'Tópico', valor: d.topico, copiar: 'Copiar el tópico', copiado: 'Copiado' },
    { clave: 'formato', rotulo: 'Formato', valor: FORMATOS[d.formato] ?? d.formato, copiar: 'Copiar el formato', copiado: 'Copiado' },
  ];
}

// El archivo descargable: un campo por línea, con el aviso de que trae la clave.
export function textoDeFicha(campos: readonly CampoFicha[]): string {
  return [
    '# Ficha de conexión del equipo. TRAE LA CLAVE: guárdala en un lugar seguro y borra este archivo cuando el equipo esté cargado.',
    '# El certificado de la autoridad (CA) de esta instalación se pide al administrador.',
    ...campos.map((c) => `${c.rotulo}: ${c.valor}`),
    '',
  ].join('\n');
}
