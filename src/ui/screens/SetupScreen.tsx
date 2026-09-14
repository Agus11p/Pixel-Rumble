import type { JSX } from 'react';
/**
 * Estado vacio real (§45): si Supabase no esta configurado no se finge nada,
 * se dice exactamente que falta.
 */
export function SetupScreen(): JSX.Element {
  return (
    <div className="screen">
      <h2 className="screen-title-text">FALTA CONFIGURAR SUPABASE</h2>
      <p className="note">
        El modo online necesita un proyecto de Supabase. Creá un archivo
        <code> .env.local </code> en la raíz con:
      </p>
      <pre className="code-block">
        VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co{'\n'}
        VITE_SUPABASE_ANON_KEY=tu-clave-anon
      </pre>
      <p className="note">
        Después ejecutá <code>supabase/migrations/0001_init.sql</code> en el editor SQL del
        proyecto y reiniciá <code>npm run dev</code>.
      </p>
      <p className="note">Mientras tanto, PRUEBA LOCAL funciona sin conexión.</p>
    </div>
  );
}
