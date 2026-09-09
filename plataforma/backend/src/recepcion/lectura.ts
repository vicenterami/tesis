// Una "lectura" es la unidad mínima que sale del filtro 2 (analizar) y viaja por el resto del
// pipeline: qué magnitud, qué valor, en qué unidad y cuándo. Todo adaptador, venga de donde venga
// la trama, debe producir exactamente esto. Así los filtros 3–6 no saben ni les importa el formato
// original: esa es la frontera que resuelve la causa C1 (formatos dispares).
export interface Lectura {
  magnitud: string;      // código del catálogo `magnitud` (p. ej. 'temperatura')
  valor: number;
  unidad?: string;       // símbolo declarado por el emisor; si falta, se asume la canónica
  tiempo?: Date;         // marca de tiempo del emisor; si falta, se usa la hora de recepción
}

export interface ContextoTrama {
  topico: string;
  idFisico: string;      // del tópico: sitio/<sitio>/dispositivo/<id_fisico>/<magnitud>
  magnitudTopico: string;
  carga: Buffer;
}
