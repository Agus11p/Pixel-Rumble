import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * La clave anonima es publica por diseno y viaja en el bundle.
 * La SERVICE ROLE KEY no aparece en ningun lado del frontend: lo que protege
 * los datos son RLS y las funciones RPC, no el secreto de una clave.
 */
export const isSupabaseConfigured = Boolean(url && anonKey);

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!client) {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase no esta configurado: falta .env.local');
    }
    client = createClient(url!, anonKey!, {
      auth: { persistSession: true, autoRefreshToken: true },
      realtime: { params: { eventsPerSecond: 30 } },
    });
  }
  return client;
}
