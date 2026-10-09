import { Injectable } from '@nestjs/common';
import { Observable, Subject, filter } from 'rxjs';

// TT-39 · Bus de eventos en memoria para el canal de tiempo real del panel (docs/10 §5, patrón B: el navegador
// habla solo con el backend). Lo alimentan el pipeline y los servicios de condiciones DESPUÉS de persistir: un
// evento nunca anuncia algo que la base no tiene. Un solo proceso de backend (docs/10 §9): si algún día hay varios,
// el bus pasa a la base (LISTEN/NOTIFY) sin cambiar a quien lo usa.
export type EventoPanel =
  | { tipo: 'medicion'; dispositivo_id: string; canal_id: string; valor: number; unidad: string; tiempo: string }
  | { tipo: 'visto'; dispositivo_id: string; tiempo: string }
  | { tipo: 'condicion'; dispositivo_id: string; condicion: 'umbral' | 'sin_comunicacion'; estado: 'abierta' | 'cerrada' };

export interface FiltroEventos {
  dispositivo?: string;
  canal?: string;
}

@Injectable()
export class EventosService {
  private readonly bus = new Subject<EventoPanel>();

  publicar(evento: EventoPanel): void {
    this.bus.next(evento);
  }

  // Sin filtro, todo; con dispositivo, solo los suyos; con canal, solo las mediciones de ese canal.
  flujo(f: FiltroEventos = {}): Observable<EventoPanel> {
    return this.bus.pipe(
      filter((e) => !f.dispositivo || e.dispositivo_id === f.dispositivo),
      filter((e) => !f.canal || (e.tipo === 'medicion' && e.canal_id === f.canal)),
    );
  }
}
