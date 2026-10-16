// Mapa «clave del JSON decodificado → magnitud del catálogo» (docs/10 §8.4 punto 47). Las claves las decide un decodificador que
// este sistema no administra: el códec de la pasarela Milesight o el decodificador del perfil en ChirpStack. Hoy el mapa vive aquí;
// cuando el panel administre el catálogo de magnitudes (Etapa 4), pasa a la columna `magnitud.alias`, sembrada desde esta misma
// lista, y `resolverClave` lee de la base. Los adaptadores reciben el resolvedor y nunca la lista: así ese cambio no los toca.
// Los valores se esperan en la unidad canónica de su magnitud; la unidad viaja igual con la lectura para que el filtro 4 la verifique.

export interface DestinoClave {
  magnitud: string; // código del catálogo `magnitud`
  unidad: string; // unidad en que llega el valor (la canónica de esa magnitud)
}

// Claves en minúsculas. Fuentes: el ejemplo de la guía oficial del códec de Milesight (temperature, humidity, battery:
// https://support.milesight-iot.com/support/solutions/articles/73000600064-how-to-use-payload-codec-on-milesight-gateway) y los
// decodificadores oficiales (https://github.com/Milesight-IoT/SensorDecoders, GPL-3.0: solo leídos, nunca copiados). Qué claves trae el
// `object` de ChirpStack lo decide el decodificador de cada perfil: no declarado hasta ver una trama real. Sinónimos en español para
// decodificadores propios.
export const CLAVES: Readonly<Record<string, DestinoClave>> = {
  temperature: { magnitud: 'temperatura', unidad: 'Cel' },
  temperatura: { magnitud: 'temperatura', unidad: 'Cel' },
  humidity: { magnitud: 'humedad', unidad: '%RH' },
  humedad: { magnitud: 'humedad', unidad: '%RH' },
  battery: { magnitud: 'bateria', unidad: '%EL' },
  bateria: { magnitud: 'bateria', unidad: '%EL' },
  pressure: { magnitud: 'presion', unidad: 'hPa' },
  presion: { magnitud: 'presion', unidad: 'hPa' },
};

export type ResolverClave = (clave: string) => DestinoClave | undefined;

// Token de inyección: el módulo de recepción entrega esta implementación; en la Etapa 4, una que lea `magnitud.alias`.
export const RESOLVER_CLAVE = Symbol('RESOLVER_CLAVE');

export const resolverClave: ResolverClave = (clave) =>
  Object.prototype.hasOwnProperty.call(CLAVES, clave.toLowerCase()) ? CLAVES[clave.toLowerCase()] : undefined;
