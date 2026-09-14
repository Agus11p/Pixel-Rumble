import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../rooms/supabase';
import type { NetMessage } from './protocol';

/**
 * Lo unico que la partida necesita de la red: suscribirse, mandar y cortar.
 *
 * Existe como interfaz para poder correr partidas enteras en los tests con una
 * red simulada en memoria, sin Supabase, y reproducir bugs de sincronizacion
 * de forma determinista.
 */
export interface MatchTransport {
  subscribe(onMessage: (msg: NetMessage) => void): Promise<void>;
  send(msg: NetMessage): void;
  unsubscribe(): Promise<void>;
}

/**
 * Canal de broadcast de la partida sobre Supabase Realtime.
 *
 * Va aparte del canal del lobby a proposito: el lobby escucha cambios de la
 * base de datos y la partida manda eventos efimeros. Comparten la conexion.
 *
 * `self: false` evita que nos devuelvan nuestros propios mensajes: el emisor ya
 * aplico su input localmente.
 */
export class MatchChannel implements MatchTransport {
  private channel: RealtimeChannel | null = null;

  constructor(private readonly roomId: string) {}

  async subscribe(onMessage: (msg: NetMessage) => void): Promise<void> {
    const client = supabase();
    const topic = `match:${this.roomId}`;

    // realtime-js reutiliza el canal si ya hay uno con el mismo nombre, y si ese
    // canal sigue abierto `subscribe()` no hace nada y NUNCA avisa. Pasa al
    // volver a entrar a una partida (o con el doble montaje de React en
    // desarrollo) mientras el canal anterior todavia se esta cerrando: la
    // sesion nueva quedaba colgada esperando una confirmacion que no llega.
    // Por eso, antes de abrir, se cierra del todo cualquier canal previo.
    const stale = client.getChannels().find((c) => c.topic === `realtime:${topic}`);
    if (stale) await client.removeChannel(stale);

    const channel = client.channel(topic, {
      config: { broadcast: { self: false, ack: false } },
    });
    this.channel = channel;

    channel.on('broadcast', { event: 'm' }, ({ payload }) => {
      // Si esta sesion ya se cerro, no debe tocar el estado de la siguiente.
      if (this.channel !== channel) return;
      onMessage(payload as NetMessage);
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('No se pudo conectar a la partida (tiempo agotado)')),
        15000,
      );
      channel.subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timeout);
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(timeout);
          reject(err ?? new Error(`canal de partida: ${status}`));
        }
      });
    });
  }

  send(msg: NetMessage): void {
    // Si el canal todavia no esta listo se pierde el mensaje; es aceptable,
    // porque todo lo importante se reenvia (fases, keyframes) o se reconstruye.
    void this.channel?.send({ type: 'broadcast', event: 'm', payload: msg });
  }

  async unsubscribe(): Promise<void> {
    const ch = this.channel;
    this.channel = null;
    if (ch) await supabase().removeChannel(ch);
  }
}
