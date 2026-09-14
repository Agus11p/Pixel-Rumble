-- =============================================================================
-- PIXEL RUMBLE - partida a puntos
--
-- La partida ya no dura una cantidad fija de rondas: gana el primero que llega
-- al limite de puntos (2000 por defecto). La columna `rounds` queda sin uso.
-- =============================================================================

alter table public.rooms
  add column if not exists target_points int not null default 2000
  check (target_points in (1000, 2000, 3000));

-- Cambian los parametros, asi que se reemplazan las funciones enteras.
drop function if exists public.create_room(text, text, int, int);
drop function if exists public.set_config(uuid, int, int);

create function public.create_room(
  p_name     text,
  p_password text default null,
  p_target   int  default 2000,
  p_seconds  int  default 60
)
returns table (room_id uuid, code text)
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_uid  uuid := auth.uid();
  v_code text;
  v_id   uuid;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  for i in 1..12 loop
    v_code := public.generate_room_code();
    exit when not exists (select 1 from public.rooms r where r.code = v_code);
    v_code := null;
  end loop;
  if v_code is null then
    raise exception 'CODE_EXHAUSTED';
  end if;

  insert into public.rooms (code, password_hash, host_id, target_points, round_seconds)
  values (
    v_code,
    case when p_password is null or p_password = '' then null
         else crypt(p_password, gen_salt('bf')) end,
    v_uid,
    p_target,
    p_seconds
  )
  returning id into v_id;

  insert into public.room_players (room_id, user_id, name, color, role)
  values (v_id, v_uid, p_name, 0, 'player');

  return query select v_id, v_code;
end;
$fn$;

create function public.set_config(p_room uuid, p_target int, p_seconds int)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  update public.rooms r
     set target_points = p_target,
         round_seconds = p_seconds,
         last_activity_at = now()
   where r.id = p_room and r.host_id = auth.uid() and r.status = 'lobby';

  if not found then
    raise exception 'NOT_HOST';
  end if;
end;
$fn$;
