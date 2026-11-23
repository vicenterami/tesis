// Mapa «clave del JSON decodificado → magnitud del catálogo» (docs/10 §8.4 puntos 47 y 69 v). Las claves las decide un decodificador que
// este sistema no administra: el códec de la pasarela Milesight o el decodificador del perfil en ChirpStack. Desde el bloque 3 de TT-12
// (23/11/2026) el mapa vive en la tabla magnitud_alias (migración 27), que lo administra quien administra el catálogo: la recepción lo lee
// con cada trama, en la misma consulta que busca el nodo (sin memoria: un alias nuevo vale desde la trama siguiente en todas las
// instancias), y el adaptador recibe el resolvedor en el contexto de la trama. Las 8 claves sembradas salen de la guía oficial del códec de
// Milesight (temperature, humidity, battery), de sus decodificadores oficiales (https://github.com/Milesight-IoT/SensorDecoders, GPL-3.0:
// solo leídos, nunca copiados) y de sinónimos en español para decodificadores propios.
// Los valores se esperan en la unidad canónica de su magnitud; la unidad viaja igual con la lectura para que el filtro 4 la verifique.

export interface DestinoClave {
  magnitud: string; // código del catálogo `magnitud`
  unidad: string; // unidad en que llega el valor (la canónica de esa magnitud)
}

export type ResolverClave = (clave: string) => DestinoClave | undefined;

// Las claves se guardan en minúsculas (CHECK de magnitud_alias) y se buscan en minúsculas; una propiedad heredada («toString») no es clave.
export function resolverDesde(alias: Readonly<Record<string, DestinoClave>> | null | undefined): ResolverClave {
  const mapa = alias ?? {};
  return (clave) => {
    const k = clave.toLowerCase();
    return Object.prototype.hasOwnProperty.call(mapa, k) ? mapa[k] : undefined;
  };
}
export const SIN_ALIAS: ResolverClave = resolverDesde(null);
