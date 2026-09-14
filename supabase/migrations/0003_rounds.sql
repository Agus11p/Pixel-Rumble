-- =============================================================================
-- PIXEL RUMBLE - rondas (F5)
--
-- Entre ronda y ronda, los que estaban mirando pasan a jugar si quedo lugar
-- (§10). Se resuelve en la base y no en el cliente porque hay que asignar
-- colores libres sin que dos espectadores se pisen.
-- =============================================================================

create or replace function public.promote_spectators(p_room uuid)
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_promoted int := 0;
  v_count    int;
  v_next     uuid;
  v_color    int;
begin
  if not exists (select 1 from public.rooms r where r.id = p_room and r.host_id = auth.uid()) then
    raise exception 'NOT_HOST';
  end if;

  loop
    select count(*) into v_count
      from public.room_players p
     where p.room_id = p_room and p.role = 'player';
    exit when v_count >= 4;

    -- El que espera hace mas tiempo entra primero.
    select p.user_id into v_next
      from public.room_players p
     where p.room_id = p_room and p.role = 'spectator'
     order by p.join_order
     limit 1;
    exit when v_next is null;

    select c into v_color
      from generate_series(0, 8) c
     where not exists (
       select 1 from public.room_players p
        where p.room_id = p_room and p.color = c
     )
     order by c
     limit 1;
    exit when v_color is null;

    update public.room_players p
       set role = 'player', color = v_color
     where p.room_id = p_room and p.user_id = v_next;

    v_promoted := v_promoted + 1;
  end loop;

  return v_promoted;
end;
$fn$;
