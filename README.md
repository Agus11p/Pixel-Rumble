# PIXEL RUMBLE

Juego web 2D multijugador: carrera de obstáculos por rondas donde los propios
jugadores van agregando los obstáculos. Pensado desde el principio para
funcionar igual de bien en PC que en teléfono horizontal.

## Estado del desarrollo

| Fase | Qué incluye | Estado |
| --- | --- | --- |
| F0 | Proyecto, canvas virtual 480×270, loop fijo a 60 Hz | ✅ |
| F1 | Física determinista, mapa de una pantalla, muerte, meta, reinicio | ✅ |
| F2 | Capa de input, controles táctiles, aviso de orientación | ✅ |
| F3 | Supabase, auth anónima, salas por código, lobby, transferencia de host | ✅ |
| F4 | Netcode con rollback, reloj sincronizado, countdown, carrera online | ✅ |
| F5 | Rondas, resultados, puntuación, fin de partida | ✅ |
| F6 | Chaos Box, selección y colocación de objetos persistentes | ✅ |
| F7 | Pulido visual, sprites, partículas, sonido | pendiente |

El MVP está jugable de punta a punta: crear sala, invitar por código, elegir
objetos, construir el mapa entre todos y competir hasta que alguien llega al
límite de puntos (2000 por defecto).

## Requisitos

- Node 20 o superior (probado con Node 25)
- Una cuenta de Supabase (solo para el modo online)

## Correr en local

```bash
npm install
npm run dev
```

- PC: http://localhost:5173
- Teléfono en la misma red: usá la URL `Network` que imprime Vite

Sin configurar Supabase el juego arranca igual: el menú ofrece **PRUEBA LOCAL**,
que es el prototipo jugable de un jugador.

### Controles

| | PC | Teléfono |
| --- | --- | --- |
| Mover | `←` `→` o `A` `D` | botones ◀ ▶ (abajo izquierda) |
| Saltar | `ESPACIO`, `W`, `↑` | botón ▲ (abajo derecha) |
| Reiniciar | `R` | botón ⟳ (arriba derecha) |
| Debug | `` ` `` | — |

`?touch=1` en la URL fuerza los controles táctiles en PC para probar el layout.

## Configurar Supabase

1. Creá un proyecto en [supabase.com](https://supabase.com).
2. **Authentication → Providers → Anonymous**: activalo. Sin esto el juego no
   puede crear sesiones y el menú online no funciona.
3. **SQL Editor**: ejecutá las migraciones de `supabase/migrations/` en orden
   (`0001_init.sql` a `0004_target_points.sql`). Crean las tablas, las
   políticas RLS, las funciones RPC y habilitan Realtime.
4. **Settings → API**: copiá la URL del proyecto y la clave `anon` a un archivo
   `.env.local` en la raíz (podés partir de `.env.example`):

```
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=tu-clave-anon-publica
```

5. Verificá que todo quedó bien:

```bash
npm run check:supabase
```

Simula dos jugadores reales contra tu proyecto y comprueba códigos de sala,
colores únicos, RLS y transferencia de host. Crea datos de verdad y los borra al
terminar. Si pasa, el backend está listo.

6. Reiniciá `npm run dev`.

> La clave `anon` es pública por diseño y viaja en el bundle del navegador. Lo
> que protege los datos son las políticas RLS y las funciones RPC, no el secreto
> de la clave. La **service role key nunca** va en el frontend ni en el repo.

## Desplegar en Vercel

1. Subí el repositorio a GitHub e importalo en Vercel.
2. Vercel detecta Vite solo. Si hace falta configurarlo a mano:
   - Build Command: `npm run build`
   - Output Directory: `dist`
3. En **Settings → Environment Variables** agregá `VITE_SUPABASE_URL` y
   `VITE_SUPABASE_ANON_KEY` (las mismas de `.env.local`) para Production y
   Preview. Vite las inyecta en tiempo de build, así que después de cambiarlas
   hay que volver a desplegar.
4. En Supabase, agregá el dominio de Vercel en **Authentication → URL
   Configuration** (Site URL y Redirect URLs).

No hace falta ningún servidor propio: el frontend es estático y toda la parte
online la resuelven Supabase Auth, Postgres y Realtime.

## Scripts

```bash
npm run dev        # servidor de desarrollo
npm run build      # typecheck + build de producción
npm run preview    # sirve el build
npm test           # suite de tests
npm run typecheck  # solo TypeScript
npm run check:supabase  # verifica el backend real (necesita .env.local)
```

## Estructura

```
src/
  core/       lógica pura del juego: física, simulación, mapa, objetos,
              Chaos Box y puntuación. No importa DOM, ni red, ni React.
  game/       runtime del cliente: loop, render con PixiJS, HUD
  input/      abstracción de input (teclado y táctil dan el mismo InputState)
  net/        netcode: protocolo, reloj común, rollback, sesión de partida
  rooms/      Supabase: auth, salas, colores, realtime, elección de host
  ui/         pantallas en React (título, crear, unirse, lobby, partida)
  store/      estado de navegación
supabase/
  migrations/ esquema SQL, RLS y funciones RPC
tests/        física, circuito, rollback, puntuación, objetos, salas y UI
```

Dos reglas que sostienen el resto:

- **`core/` no conoce el mundo exterior.** La simulación es una función
  determinista `step(world, input)`. Por eso se puede testear en Node, y por eso
  el multijugador va a poder re-simular ticks para corregir lo que llegue tarde.
- **El cliente nunca escribe directo en la base.** Todo pasa por funciones RPC,
  que son el único lugar donde se deciden el código de sala, la contraseña, la
  capacidad, el color y quién es el host.
