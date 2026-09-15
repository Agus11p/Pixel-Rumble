-- =============================================================================
-- PIXEL RUMBLE - seleccion de mapa
--
-- La sala pasa a guardar que mapa se juega (`map_id`). Es la fuente de verdad
-- unica: todos los clientes resuelven el mismo id contra su propio registry
-- local (`core/maps/registry.ts`), asi que nunca hace falta mandar la
-- geometria del mapa por red.
--
-- A proposito NO hay una lista fija de ids validos en SQL (nada de
-- `check (map_id in (...))`): agregar un mapa nuevo es trabajo del cliente
-- (una definicion + un registro), no deberia requerir otra migracion. Se
-- valida solamente que no llegue vacio ni absurdamente largo.
-- =============================================================================

alter table public.rooms
  add column if not exists map_id text not null default 'ASCENSO'
  check (char_length(map_id) between 1 and 40);

create or replace function public.create_room(
  p_name     text,
  p_password text default null,
  p_map      text default 'ASCENSO',
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

  insert into public.rooms (code, password_hash, host_id, map_id, target_points, round_seconds)
  values (
    v_code,
    case when p_password is null or p_password = '' then null
         else crypt(p_password, gen_salt('bf')) end,
    v_uid,
    coalesce(nullif(trim(p_map), ''), 'ASCENSO'),
    p_target,
    p_seconds
  )
  returning id into v_id;

  insert into public.room_players (room_id, user_id, name, color, role)
  values (v_id, v_uid, p_name, 0, 'player');

  return query select v_id, v_code;
end;
$fn$;

-- Separado de set_config a proposito: es una decision de otra naturaleza
-- (que se juega, no cuanto dura) y asi no hay que tocar el llamado existente
-- de rondas/tiempo cada vez que cambia el selector de mapa.
create or replace function public.set_map(p_room uuid, p_map text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_map is null or char_length(trim(p_map)) = 0 then
    raise exception 'INVALID_MAP';
  end if;

  update public.rooms r
     set map_id = trim(p_map),
         last_activity_at = now()
   where r.id = p_room and r.host_id = auth.uid() and r.status = 'lobby';

  if not found then
    raise exception 'NOT_HOST';
  end if;
end;
$fn$;
