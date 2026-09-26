-- Consenti le presenze dal lunedì al sabato e salta solo la domenica nella streak.
create or replace function public.autogestione_player_registra(p_stato text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_studente uuid;
  v_giorno date := (now() at time zone 'Europe/Rome')::date;
  v_ora time := (now() at time zone 'Europe/Rome')::time;
  v_streak integer := 1;
  v_punti numeric;
begin
  select studente_id into v_studente from account_profiles where user_id = auth.uid();
  if v_studente is null then raise exception 'Collega prima un player al tuo account.'; end if;
  if not (select attiva from autogestione_impostazioni where id = true) then raise exception 'Autogestione non attiva.'; end if;
  if extract(isodow from v_giorno) = 7 then raise exception 'La domenica non si registra la presenza.'; end if;
  if v_ora >= time '14:00' then raise exception 'La presenza va registrata entro le 14:00.'; end if;
  if p_stato not in ('presente', 'assente') then raise exception 'Stato presenza non valido.'; end if;
  if exists (select 1 from autogestione_presenze where studente_id = v_studente and giorno = v_giorno) then raise exception 'Hai già registrato la presenza di oggi.'; end if;

  if p_stato = 'assente' then
    v_punti := -1;
  else
    with recursive consecutivi as (
      select v_giorno as giorno
      union all
      select case when extract(isodow from c.giorno) = 1 then (c.giorno - 2)::date else (c.giorno - 1)::date end
      from consecutivi c
      join autogestione_presenze p on p.studente_id = v_studente
        and p.giorno = case when extract(isodow from c.giorno) = 1 then (c.giorno - 2)::date else (c.giorno - 1)::date end
        and p.stato = 'presente' and p.fonte = 'player'
    ) select count(*) into v_streak from consecutivi;
    v_punti := case when v_streak >= 30 then 3 when v_streak >= 7 then 2 else 1 end;
  end if;

  insert into autogestione_presenze (studente_id, giorno, stato, fonte, punti)
  values (v_studente, v_giorno, p_stato, 'player', v_punti);
  insert into bonus_malus (studente_id, motivo, punti)
  values (v_studente, case when p_stato = 'presente' then 'Autogestione · Presenza registrata' else 'Autogestione · Assenza registrata spontaneamente' end, v_punti);
  return jsonb_build_object('punti', v_punti, 'streak', v_streak);
end;
$$;

create or replace function public.autogestione_manager_registra(p_studente uuid, p_stato text, p_punti numeric default null)
returns void language plpgsql security definer set search_path = public
as $$
declare v_giorno date := (now() at time zone 'Europe/Rome')::date; v_punti numeric;
begin
  if not public.is_autogestione_manager() then raise exception 'Operazione riservata ai manager.'; end if;
  if extract(isodow from v_giorno) = 7 then raise exception 'La domenica non si registra la presenza.'; end if;
  if p_stato not in ('presente', 'assente', 'falsata') then raise exception 'Stato presenza non valido.'; end if;
  if exists (select 1 from autogestione_presenze where studente_id = p_studente and giorno = v_giorno) then raise exception 'La presenza di oggi è già stata registrata.'; end if;
  v_punti := coalesce(p_punti, case p_stato when 'assente' then -3 when 'falsata' then -5 else 0 end);
  insert into autogestione_presenze (studente_id, giorno, stato, fonte, punti)
  values (p_studente, v_giorno, p_stato, 'manager', v_punti);
  insert into bonus_malus (studente_id, motivo, punti)
  values (p_studente, case p_stato when 'presente' then 'Autogestione · Presenza registrata dal manager' when 'assente' then 'Autogestione · Assenza registrata dal manager' else 'Falsata la presenza' end, v_punti);
end;
$$;
