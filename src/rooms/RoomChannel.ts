import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';

interface Handlers {
  /** Algo cambio en la sala o en sus jugadores: hay que releer. */
  onChange: () => void;
  /** Conjunto de user_id conectados ahora mismo. */
  onPresence: (connected: Set<string>) => void;
}

/**
 * Canal de tiempo real de una sala.
 *
 * Dos mecanismos con roles distintos:
 *  - postgres_changes: la base avisa cuando cambia la sala o sus jugadores.
 *    La lista del lobby sale siempre de la base, nunca de un estado local que
 *    cada cliente mantiene por su cuenta (asi no hay dos lobbies distintos).
 *  - presence: quien esta conectado AHORA. La base no lo sabe; presence si.
 *
 * En F4 este mismo canal suma broadcast para inputs y snapshots.
 */
export class RoomChannel {
  private channel: RealtimeChannel | null = null;

  constructor(
    private readonly roomId: string,
    private readonly userId: string,
    private readonly handlers: Handlers,
  ) {}

  async subscribe(): Promise<void> {
    const sb = supabase();
    const channel = sb.channel(`room:${this.roomId}`, {
      config: { presence: { key: this.userId } },
    });
    this.channel = channel;

    channel
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'room_players', filter: `room_id=eq.${this.roomId}` },
        () => this.handlers.onChange(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${this.roomId}` },
        () => this.handlers.onChange(),
      )
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        this.handlers.onPresence(new Set(Object.keys(state)));
      });

    await new Promise<void>((resolve, reject) => {
      channel.subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          void channel.track({ at: Date.now() });
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          reject(err ?? new Error(`No se pudo abrir el canal: ${status}`));
        }
      });
    });
  }

  async unsubscribe(): Promise<void> {
    if (!this.channel) return;
    await this.channel.unsubscribe();
    await supabase().removeChannel(this.channel);
    this.channel = null;
  }
}
