-- Autogestione: presenze giornaliere gestite dai player, con verifica dei manager.
create table if not exists public.autogestione_impostazioni (
  id boolean primary key default true check (id),
  attiva boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

insert into public.autogestione_impostazioni (id, attiva)
values (true, false)
on conflict (id) do nothing;

create table if not exists public.autogestione_presenze (
  id uuid primary key default gen_random_uuid(),
  studente_id uuid not null references public.studenti(id) on delete cascade,
  giorno date not null,
  stato text not null check (stato in ('presente', 'assente', 'falsata')),
  fonte text not null check (fonte in ('player', 'manager')),
  dichiarata_da uuid not null default auth.uid(),
  punti numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (studente_id, giorno)
);

alter table public.autogestione_impostazioni enable row level security;
alter table public.autogestione_presenze enable row level security;

create or replace function public.is_autogestione_manager()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select is_premium from account_profiles where user_id = auth.uid()), false);
$$;

create policy "authenticated users can read autogestione settings"
  on public.autogestione_impostazioni for select to authenticated using (true);
create policy "managers update autogestione settings"
  on public.autogestione_impostazioni for update to authenticated
  using (public.is_autogestione_manager()) with check (public.is_autogestione_manager());

create policy "players read their attendance and managers read all"
  on public.autogestione_presenze for select to authenticated
  using (
    public.is_autogestione_manager()
    or studente_id = (select studente_id from account_profiles where user_id = auth.uid())
  );

create or replace function public.autogestione_set_attiva(p_attiva boolean)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_autogestione_manager() then raise exception 'Operazione riservata ai manager.'; end if;
  update autogestione_impostazioni
     set attiva = p_attiva, updated_at = now(), updated_by = auth.uid()
   where id = true;
end;
$$;

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
  if extract(isodow from v_giorno) > 5 then raise exception 'La presenza si registra solo nei giorni di scuola.'; end if;
  if v_ora >= time '14:00' then raise exception 'La presenza va registrata entro le 14:00.'; end if;
  if p_stato not in ('presente', 'assente') then raise exception 'Stato presenza non valido.'; end if;
  if exists (select 1 from autogestione_presenze where studente_id = v_studente and giorno = v_giorno) then raise exception 'Hai già registrato la presenza di oggi.'; end if;

  if p_stato = 'assente' then
    v_punti := -1;
  else
    with recursive consecutivi as (
      select v_giorno as giorno
      union all
      select case when extract(isodow from c.giorno) = 1 then (c.giorno - 3)::date else (c.giorno - 1)::date end
      from consecutivi c
      join autogestione_presenze p on p.studente_id = v_studente
        and p.giorno = case when extract(isodow from c.giorno) = 1 then (c.giorno - 3)::date else (c.giorno - 1)::date end
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
  if p_stato not in ('presente', 'assente', 'falsata') then raise exception 'Stato presenza non valido.'; end if;
  if exists (select 1 from autogestione_presenze where studente_id = p_studente and giorno = v_giorno) then raise exception 'La presenza di oggi è già stata registrata.'; end if;
  v_punti := coalesce(p_punti, case p_stato when 'assente' then -3 when 'falsata' then -5 else 0 end);
  insert into autogestione_presenze (studente_id, giorno, stato, fonte, punti)
  values (p_studente, v_giorno, p_stato, 'manager', v_punti);
  insert into bonus_malus (studente_id, motivo, punti)
  values (p_studente, case p_stato when 'presente' then 'Autogestione · Presenza registrata dal manager' when 'assente' then 'Autogestione · Assenza registrata dal manager' else 'Falsata la presenza' end, v_punti);
end;
$$;

grant execute on function public.autogestione_set_attiva(boolean) to authenticated;
grant execute on function public.autogestione_player_registra(text) to authenticated;
grant execute on function public.autogestione_manager_registra(uuid, text, numeric) to authenticated;
