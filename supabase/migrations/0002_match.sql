-- =============================================================================
-- PIXEL RUMBLE - control de partida (F4)
--
-- El estado "hay carrera en curso" vive en la base y no en un mensaje suelto:
-- asi todos los clientes entran y salen de la partida por el mismo camino, y
-- quien llegue tarde ve que la sala esta jugando y entra como espectador.
-- =============================================================================

create or replace function public.start_match(p_room uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_players int;
begin
  select count(*) into v_players
    from public.room_players p
   where p.room_id = p_room and p.role = 'player';

  if v_players < 2 then
    raise exception 'NEED_MORE_PLAYERS';
  end if;

  update public.rooms r
     set status = 'in_match', last_activity_at = now()
   where r.id = p_room and r.host_id = auth.uid() and r.status = 'lobby';

  if not found then
    raise exception 'NOT_HOST';
  end if;
end;
$fn$;

create or replace function public.end_match(p_room uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  update public.rooms r
     set status = 'lobby', state = null, last_activity_at = now()
   where r.id = p_room and r.host_id = auth.uid();

  if not found then
    raise exception 'NOT_HOST';
  end if;
end;
$fn$;
