-- =============================================================================
-- PIXEL RUMBLE - esquema inicial (salas y jugadores)
--
-- Principio de seguridad: el cliente NUNCA escribe directo en estas tablas.
-- Todo pasa por funciones RPC SECURITY DEFINER, que son el unico lugar donde
-- se deciden cosas criticas: codigo de sala, contrasena, capacidad, color y
-- transferencia de host. RLS deja leer solo a los miembros de la sala.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ------------------------------------------------- compatibilidad previa --
-- Si en el proyecto ya existen tablas con estos nombres pero con otra
-- estructura (una prueba anterior, una plantilla, otro experimento), el
-- "create table if not exists" las dejaria intactas y todo lo demas fallaria.
-- Se detecta y se rehacen. Son tablas de PIXEL RUMBLE: no hay datos que perder.

do $do$
declare
  v_ok boolean := true;
begin
  if to_regclass('public.room_players') is not null then
    v_ok := v_ok and exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'room_players'
         and column_name = 'color' and data_type = 'integer'
    );
  end if;

  if to_regclass('public.rooms') is not null then
    v_ok := v_ok and exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'rooms'
         and column_name = 'round_seconds' and data_type = 'integer'
    );
  end if;

  if not v_ok then
    raise notice 'Habia tablas previas con otra estructura: se recrean.';
    drop table if exists public.room_players cascade;
    drop table if exists public.rooms cascade;
  end if;
end
$do$;

-- ------------------------------------------------------------------- tablas --

create table if not exists public.rooms (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  password_hash    text,
  host_id          uuid not null,
  rounds           int  not null default 5  check (rounds in (3, 5, 7, 10)),
  round_seconds    int  not null default 60 check (round_seconds in (30, 45, 60, 90)),
  status           text not null default 'lobby' check (status in ('lobby', 'in_match')),
  -- Snapshot de la partida en curso. Lo usa la migracion de host (F4).
  state            jsonb,
  host_seen_at     timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);

create table if not exists public.room_players (
  room_id    uuid not null references public.rooms(id) on delete cascade,
  user_id    uuid not null,
  name       text not null check (char_length(name) between 1 and 16),
  -- -1 = espectador sin color asignado.
  color      int  not null default -1 check (color between -1 and 8),
  role       text not null default 'player' check (role in ('player', 'spectator')),
  join_order bigserial,
  score      int  not null default 0,
  connected  boolean not null default true,
  joined_at  timestamptz not null default now(),
  primary key (room_id, user_id)
);

-- Dos jugadores activos no pueden compartir color (seccion 5). Lo garantiza el
-- indice, no el cliente: aunque dos personas toquen el mismo color en el mismo
-- milisegundo, solo una escritura entra.
create unique index if not exists room_players_color_unique
  on public.room_players (room_id, color)
  where color >= 0;

create index if not exists room_players_room_idx on public.room_players (room_id, join_order);

-- --------------------------------------------------------------------- RLS ---

alter table public.rooms enable row level security;
alter table public.room_players enable row level security;

-- Helper SECURITY DEFINER: evita la recursion infinita que se produce si una
-- politica sobre room_players consulta room_players.
create or replace function public.is_room_member(p_room uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $fn$
  select exists (
    select 1 from public.room_players
    where room_id = p_room and user_id = auth.uid()
  );
$fn$;

drop policy if exists rooms_select_members on public.rooms;
create policy rooms_select_members on public.rooms
  for select to authenticated
  using (public.is_room_member(id));

drop policy if exists room_players_select_members on public.room_players;
create policy room_players_select_members on public.room_players
  for select to authenticated
  using (public.is_room_member(room_id));

-- Sin politicas de insert/update/delete a proposito: se escribe solo por RPC.

-- -------------------------------------------------------------------- RPCs ---

-- Alfabeto sin caracteres ambiguos: sin I, L, O, 0, 1 (seccion 7).
create or replace function public.generate_room_code()
returns text
language plpgsql
as $fn$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  result text := '';
begin
  for i in 1..4 loop
    result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return result;
end;
$fn$;

create or replace function public.create_room(
  p_name     text,
  p_password text default null,
  p_rounds   int  default 5,
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

  -- Reintenta hasta encontrar un codigo libre (31^4 combinaciones).
  for i in 1..12 loop
    v_code := public.generate_room_code();
    exit when not exists (select 1 from public.rooms r where r.code = v_code);
    v_code := null;
  end loop;
  if v_code is null then
    raise exception 'CODE_EXHAUSTED';
  end if;

  insert into public.rooms (code, password_hash, host_id, rounds, round_seconds)
  values (
    v_code,
    case when p_password is null or p_password = '' then null
         else crypt(p_password, gen_salt('bf')) end,
    v_uid,
    p_rounds,
    p_seconds
  )
  returning id into v_id;

  insert into public.room_players (room_id, user_id, name, color, role)
  values (v_id, v_uid, p_name, 0, 'player');

  return query select v_id, v_code;
end;
$fn$;

create or replace function public.join_room(
  p_code     text,
  p_name     text,
  p_password text default null
)
returns table (room_id uuid, role text, color int)
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_room   public.rooms%rowtype;
  v_count  int;
  v_color  int;
  v_role   text;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into v_room from public.rooms r where r.code = upper(trim(p_code));
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  if v_room.password_hash is not null
     and (p_password is null
          or crypt(p_password, v_room.password_hash) <> v_room.password_hash) then
    raise exception 'BAD_PASSWORD';
  end if;

  -- Reconexion: el jugador ya pertenece a la sala, conserva color y puntos.
  if exists (select 1 from public.room_players p
             where p.room_id = v_room.id and p.user_id = v_uid) then
    update public.room_players p
       set name = p_name, connected = true
     where p.room_id = v_room.id and p.user_id = v_uid
    returning p.role, p.color into v_role, v_color;
    return query select v_room.id, v_role, v_color;
    return;
  end if;

  select count(*) into v_count
    from public.room_players p
   where p.room_id = v_room.id and p.role = 'player';

  -- Sala llena o partida en curso: entra como espectador (seccion 10).
  if v_count >= 4 or v_room.status = 'in_match' then
    v_role := 'spectator';
    v_color := -1;
  else
    v_role := 'player';
    select c into v_color
      from generate_series(0, 8) c
     where not exists (
       select 1 from public.room_players p
        where p.room_id = v_room.id and p.color = c
     )
     order by c
     limit 1;
    if v_color is null then
      v_role := 'spectator';
      v_color := -1;
    end if;
  end if;

  insert into public.room_players (room_id, user_id, name, color, role)
  values (v_room.id, v_uid, p_name, v_color, v_role);

  update public.rooms r set last_activity_at = now() where r.id = v_room.id;

  return query select v_room.id, v_role, v_color;
end;
$fn$;

create or replace function public.set_color(p_room uuid, p_color int)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.rooms r where r.id = p_room and r.status = 'lobby') then
    raise exception 'MATCH_IN_PROGRESS';
  end if;
  if p_color < 0 or p_color > 8 then
    raise exception 'INVALID_COLOR';
  end if;

  update public.room_players p
     set color = p_color
   where p.room_id = p_room and p.user_id = v_uid and p.role = 'player';

  if not found then
    raise exception 'NOT_A_PLAYER';
  end if;
exception
  when unique_violation then
    raise exception 'COLOR_TAKEN';
end;
$fn$;

create or replace function public.set_config(p_room uuid, p_rounds int, p_seconds int)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  update public.rooms r
     set rounds = p_rounds,
         round_seconds = p_seconds,
         last_activity_at = now()
   where r.id = p_room and r.host_id = auth.uid() and r.status = 'lobby';

  if not found then
    raise exception 'NOT_HOST';
  end if;
end;
$fn$;

-- El host late para que los demas puedan detectar su caida sin depender solo
-- de presence (seccion 8: la sala no se destruye, cambia de host).
create or replace function public.heartbeat_host(p_room uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  update public.rooms r
     set host_seen_at = now(), last_activity_at = now()
   where r.id = p_room and r.host_id = auth.uid();
end;
$fn$;

create or replace function public.leave_room(p_room uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid      uuid := auth.uid();
  v_was_host boolean;
  v_next     uuid;
begin
  select (r.host_id = v_uid) into v_was_host from public.rooms r where r.id = p_room;
  if not found then
    return;
  end if;

  delete from public.room_players p where p.room_id = p_room and p.user_id = v_uid;

  if not exists (select 1 from public.room_players p where p.room_id = p_room) then
    delete from public.rooms r where r.id = p_room;
    return;
  end if;

  if v_was_host then
    select p.user_id into v_next
      from public.room_players p
     where p.room_id = p_room
     order by p.join_order
     limit 1;
    update public.rooms r
       set host_id = v_next, host_seen_at = now()
     where r.id = p_room;
  end if;
end;
$fn$;

-- Reclamo de host tras una caida dura (el host se fue sin avisar).
-- Solo prospera si el host ya no es miembro o dejo de latir hace rato: aunque
-- varios clientes lo intenten a la vez, la sala termina con un unico host.
create or replace function public.claim_host(p_room uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid  uuid := auth.uid();
  v_room public.rooms%rowtype;
begin
  select * into v_room from public.rooms r where r.id = p_room for update;
  if not found then
    return false;
  end if;
  if v_room.host_id = v_uid then
    return true;
  end if;
  if not exists (select 1 from public.room_players p
                 where p.room_id = p_room and p.user_id = v_uid) then
    return false;
  end if;

  if exists (select 1 from public.room_players p
             where p.room_id = p_room and p.user_id = v_room.host_id)
     and v_room.host_seen_at > now() - interval '10 seconds' then
    return false;
  end if;

  update public.rooms r
     set host_id = v_uid, host_seen_at = now()
   where r.id = p_room;
  return true;
end;
$fn$;

-- Limpieza de salas abandonadas. Programar con pg_cron si hace falta.
create or replace function public.cleanup_stale_rooms()
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_deleted int;
begin
  delete from public.rooms r where r.last_activity_at < now() - interval '6 hours';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$fn$;

-- --------------------------------------------------------------- realtime ---
-- El lobby se sincroniza con postgres_changes: la base es la autoridad y no
-- hay que reimplementar la lista de jugadores a mano en cada cliente.

do $do$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  begin
    alter publication supabase_realtime add table public.rooms;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.room_players;
  exception when duplicate_object then null;
  end;
end;
$do$;
