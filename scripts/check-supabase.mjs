#!/usr/bin/env node
/**
 * Verificación end-to-end del backend de salas.
 *
 * Simula dos jugadores reales contra el Supabase configurado en .env.local y
 * comprueba las reglas que no se pueden testear sin base: códigos de sala,
 * capacidad, colores únicos, RLS y transferencia de host.
 *
 * Crea datos de verdad y los borra al terminar.
 *
 *   npm run check:supabase
 */
import { readFileSync, existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const results = [];
let failed = 0;

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ok  ' : ' FALLA'}  ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) failed++;
}

function loadEnv() {
  if (!existsSync('.env.local')) {
    console.error('\nNo existe .env.local. Copiá .env.example y completá los datos.\n');
    process.exit(1);
  }
  const env = {};
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

/** Un cliente independiente = un jugador distinto (sesión propia, sin disco). */
async function newPlayer(url, key, label) {
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInAnonymously();
  if (error) {
    console.error(`\nNo se pudo crear la sesión anónima de ${label}: ${error.message}`);
    console.error('Revisá que "Anonymous sign-ins" esté activado en Authentication → Providers.\n');
    process.exit(1);
  }
  return { client, id: data.user.id, label };
}

async function main() {
  const env = loadEnv();
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_ANON_KEY;

  if (!url || !key || url.includes('TU-PROYECTO')) {
    console.error('\n.env.local existe pero falta completar URL o clave anon.\n');
    process.exit(1);
  }

  console.log(`\nPIXEL RUMBLE — verificación de backend\n${url}\n`);

  const a = await newPlayer(url, key, 'A');
  const b = await newPlayer(url, key, 'B');
  check('sesión anónima de dos jugadores distintos', a.id !== b.id);

  // --- crear sala ----------------------------------------------------------
  const { data: created, error: createErr } = await a.client.rpc('create_room', {
    p_name: 'ANFITRION',
    p_password: null,
    p_map: 'TEST_MAP',
    p_target: 2000,
    p_seconds: 60,
  });
  if (createErr) {
    check('crear sala', false, createErr.message);
    console.error(
      '\n¿Ejecutaste todas las migraciones de supabase/migrations/ en el editor SQL?\n',
    );
    process.exit(1);
  }
  const room = created[0];
  check('crear sala', Boolean(room?.room_id));
  check(
    'código de 4 caracteres sin ambiguos',
    /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/.test(room.code),
    room.code,
  );

  // --- mapa de la sala -------------------------------------------------------
  const { data: roomRow } = await a.client
    .from('rooms')
    .select('map_id')
    .eq('id', room.room_id)
    .maybeSingle();
  check('la sala guarda el mapId elegido al crearla', roomRow?.map_id === 'TEST_MAP');

  const { data: defaultRoom } = await a.client.rpc('create_room', {
    p_name: 'ANFITRION2',
    p_password: null,
  });
  const { data: defaultRow } = await a.client
    .from('rooms')
    .select('map_id')
    .eq('id', defaultRoom[0].room_id)
    .maybeSingle();
  check(
    'sin elegir mapa explicitamente, cae en ASCENSO por defecto',
    defaultRow?.map_id === 'ASCENSO',
  );
  await a.client.rpc('leave_room', { p_room: defaultRoom[0].room_id });

  // --- unirse --------------------------------------------------------------
  const { data: joined, error: joinErr } = await b.client.rpc('join_room', {
    p_code: room.code.toLowerCase(), // en minúscula a propósito: debe normalizar
    p_name: 'INVITADO',
    p_password: null,
  });
  check('unirse con el código', !joinErr, joinErr?.message ?? '');
  check('el segundo entra como jugador', joined?.[0]?.role === 'player');
  check('recibe un color libre distinto', joined?.[0]?.color === 1, `color ${joined?.[0]?.color}`);

  const { error: badCodeErr } = await b.client.rpc('join_room', {
    p_code: 'ZZZZ',
    p_name: 'X',
    p_password: null,
  });
  check('un código inexistente se rechaza', badCodeErr?.message?.includes('ROOM_NOT_FOUND'));

  // --- colores -------------------------------------------------------------
  const { error: takenErr } = await b.client.rpc('set_color', {
    p_room: room.room_id,
    p_color: 0,
  });
  check('no se puede tomar un color ocupado', takenErr?.message?.includes('COLOR_TAKEN'));

  const { error: freeErr } = await b.client.rpc('set_color', {
    p_room: room.room_id,
    p_color: 4,
  });
  check('sí se puede tomar un color libre', !freeErr, freeErr?.message ?? '');

  // --- lectura y RLS -------------------------------------------------------
  const { data: players } = await b.client
    .from('room_players')
    .select('user_id, name, color, role')
    .eq('room_id', room.room_id);
  check('un miembro ve a los dos jugadores', players?.length === 2, `${players?.length ?? 0}`);

  const { error: insertErr } = await b.client.from('room_players').insert({
    room_id: room.room_id,
    user_id: b.id,
    name: 'HACK',
    color: 7,
  });
  check('RLS bloquea escribir directo en la tabla', Boolean(insertErr));

  const outsider = await newPlayer(url, key, 'C');
  const { data: leaked } = await outsider.client
    .from('rooms')
    .select('id, code')
    .eq('id', room.room_id);
  check('quien no es miembro no ve la sala', (leaked?.length ?? 0) === 0);

  // --- configuración -------------------------------------------------------
  const { error: notHostErr } = await b.client.rpc('set_config', {
    p_room: room.room_id,
    p_target: 3000,
    p_seconds: 90,
  });
  check('solo el host cambia la configuración', notHostErr?.message?.includes('NOT_HOST'));

  const { error: hostCfgErr } = await a.client.rpc('set_config', {
    p_room: room.room_id,
    p_target: 1000,
    p_seconds: 45,
  });
  check('el host sí puede cambiarla', !hostCfgErr, hostCfgErr?.message ?? '');

  // --- mapa: solo el host, solo en el lobby (§4) -----------------------------
  const { error: notHostMapErr } = await b.client.rpc('set_map', {
    p_room: room.room_id,
    p_map: 'ASCENSO',
  });
  check('solo el host cambia el mapa', notHostMapErr?.message?.includes('NOT_HOST'));

  const { error: hostMapErr } = await a.client.rpc('set_map', {
    p_room: room.room_id,
    p_map: 'ASCENSO',
  });
  check('el host sí puede cambiar el mapa', !hostMapErr, hostMapErr?.message ?? '');

  const { data: afterMap } = await a.client
    .from('rooms')
    .select('map_id')
    .eq('id', room.room_id)
    .maybeSingle();
  check('el cambio de mapa quedo guardado', afterMap?.map_id === 'ASCENSO');

  // --- control de partida (F4) --------------------------------------------
  const { error: notHostStart } = await b.client.rpc('start_match', { p_room: room.room_id });
  check('solo el host empieza la partida', notHostStart?.message?.includes('NOT_HOST'));

  const { error: startErr } = await a.client.rpc('start_match', { p_room: room.room_id });
  check('el host empieza la partida', !startErr, startErr?.message ?? '');

  const { data: inMatch } = await b.client
    .from('rooms')
    .select('status')
    .eq('id', room.room_id)
    .maybeSingle();
  check('la sala queda marcada en partida', inMatch?.status === 'in_match');

  // El mapa queda bloqueado una vez arrancada la partida (§4).
  const { error: mapLockedErr } = await a.client.rpc('set_map', {
    p_room: room.room_id,
    p_map: 'TEST_MAP',
  });
  check(
    'el mapa no se puede cambiar con la partida en curso',
    mapLockedErr?.message?.includes('NOT_HOST'), // status ya no es 'lobby' -> mismo not found/NOT_HOST
  );

  // Quien llega con la carrera empezada mira desde afuera (seccion 10).
  const late = await newPlayer(url, key, 'D');
  const { data: lateJoin } = await late.client.rpc('join_room', {
    p_code: room.code,
    p_name: 'TARDE',
    p_password: null,
  });
  check('quien llega tarde entra como espectador', lateJoin?.[0]?.role === 'spectator');

  const { error: colorErr } = await b.client.rpc('set_color', {
    p_room: room.room_id,
    p_color: 6,
  });
  check(
    'con la partida en curso no se cambia de color',
    colorErr?.message?.includes('MATCH_IN_PROGRESS'),
  );

  // Entre rondas, el que esperaba entra a jugar (seccion 10).
  const { error: notHostPromote } = await b.client.rpc('promote_spectators', {
    p_room: room.room_id,
  });
  check('solo el host promueve espectadores', notHostPromote?.message?.includes('NOT_HOST'));

  const { data: promoted, error: promoteErr } = await a.client.rpc('promote_spectators', {
    p_room: room.room_id,
  });
  check('el espectador pasa a jugador entre rondas', promoted === 1, promoteErr?.message ?? '');

  const { data: promotedRow } = await a.client
    .from('room_players')
    .select('role, color')
    .eq('room_id', room.room_id)
    .eq('user_id', late.id)
    .maybeSingle();
  check('y recibe un color libre', promotedRow?.role === 'player' && promotedRow.color >= 0);

  const { error: endErr } = await a.client.rpc('end_match', { p_room: room.room_id });
  check('el host vuelve al lobby', !endErr, endErr?.message ?? '');

  await late.client.rpc('leave_room', { p_room: room.room_id });

  // --- transferencia de host ----------------------------------------------
  await a.client.rpc('leave_room', { p_room: room.room_id });
  const { data: afterLeave } = await b.client
    .from('rooms')
    .select('host_id, target_points, round_seconds')
    .eq('id', room.room_id)
    .maybeSingle();
  check('la sala sobrevive a que se vaya el host', Boolean(afterLeave));
  check('el host pasa al siguiente jugador', afterLeave?.host_id === b.id);
  check(
    'la configuración se mantiene',
    afterLeave?.target_points === 1000 && afterLeave?.round_seconds === 45,
  );

  // --- limpieza ------------------------------------------------------------
  await b.client.rpc('leave_room', { p_room: room.room_id });
  const { data: gone } = await b.client.from('rooms').select('id').eq('id', room.room_id);
  check('la sala vacía se borra sola', (gone?.length ?? 0) === 0);

  console.log(
    `\n${results.length - failed}/${results.length} comprobaciones pasaron.` +
      (failed ? '  Revisá las que dicen FALLA.\n' : '  El backend está listo.\n'),
  );
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('\nError inesperado:', e.message, '\n');
  process.exit(1);
});
