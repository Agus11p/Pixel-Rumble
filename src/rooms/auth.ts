import { supabase } from './supabase';

/**
 * Autenticacion anonima.
 *
 * La sesion se guarda en localStorage, asi que el user.id sobrevive a un F5 o
 * a que se corte el wifi. Eso es lo que permite volver a entrar a la sala
 * conservando color y puntos.
 */
export async function ensureSession(): Promise<string> {
  const sb = supabase();

  const { data } = await sb.auth.getSession();
  if (data.session?.user) return data.session.user.id;

  const { data: signed, error } = await sb.auth.signInAnonymously();
  if (error || !signed.user) {
    throw new Error(`No se pudo iniciar sesion anonima: ${error?.message ?? 'desconocido'}`);
  }
  return signed.user.id;
}
