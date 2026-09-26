-- Free Roam v0.2: private GLB storage, owner avatars, manager-only world maps.
create or replace function public.free_roam_is_manager()
returns boolean language sql stable security definer set search_path = public
as $$
  select coalesce((select is_premium from public.account_profiles where user_id = auth.uid()), false);
$$;

create table if not exists public.free_roam_avatars (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  name text not null check (char_length(name) between 1 and 40),
  storage_path text not null unique,
  file_size bigint not null check (file_size > 0 and file_size <= 15728640),
  created_at timestamptz not null default now(),
  check (storage_path like owner_id::text || '/%')
);

create table if not exists public.free_roam_maps (
  id uuid primary key default gen_random_uuid(),
  uploaded_by uuid not null default auth.uid(),
  name text not null check (char_length(name) between 1 and 80),
  file_name text not null,
  storage_path text not null unique,
  file_size bigint not null check (file_size > 0 and file_size <= 52428800),
  spawn jsonb not null default '[0,1,0]'::jsonb check (jsonb_typeof(spawn) = 'array' and jsonb_array_length(spawn) = 3),
  scale numeric not null default 1 check (scale > 0 and scale <= 100),
  rotation numeric not null default 0,
  enabled boolean not null default true,
  collision_model text,
  thumbnail text,
  version integer not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.free_roam_settings (
  id boolean primary key default true check (id),
  active_map_id uuid references public.free_roam_maps(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.free_roam_settings (id) values (true) on conflict (id) do nothing;

alter table public.free_roam_avatars enable row level security;
alter table public.free_roam_maps enable row level security;
alter table public.free_roam_settings enable row level security;

create policy "free roam avatars readable by signed in players"
  on public.free_roam_avatars for select to authenticated using (true);
create policy "free roam avatar owner can insert"
  on public.free_roam_avatars for insert to authenticated
  with check (owner_id = auth.uid() and storage_path like auth.uid()::text || '/%');
create policy "free roam avatar owner can update"
  on public.free_roam_avatars for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid() and storage_path like auth.uid()::text || '/%');
create policy "free roam avatar owner can delete"
  on public.free_roam_avatars for delete to authenticated using (owner_id = auth.uid());

create policy "free roam maps readable by signed in players"
  on public.free_roam_maps for select to authenticated using (true);
create policy "free roam managers can insert maps"
  on public.free_roam_maps for insert to authenticated
  with check (public.free_roam_is_manager() and uploaded_by = auth.uid());
create policy "free roam managers can update maps"
  on public.free_roam_maps for update to authenticated
  using (public.free_roam_is_manager()) with check (public.free_roam_is_manager());
create policy "free roam managers can delete maps"
  on public.free_roam_maps for delete to authenticated using (public.free_roam_is_manager());

create policy "free roam settings readable by signed in players"
  on public.free_roam_settings for select to authenticated using (true);
create policy "free roam managers can update settings"
  on public.free_roam_settings for update to authenticated
  using (public.free_roam_is_manager()) with check (public.free_roam_is_manager());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('free-roam-avatars', 'free-roam-avatars', false, 15728640, array['model/gltf-binary'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('free-roam-maps', 'free-roam-maps', false, 52428800, array['model/gltf-binary'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "free roam players can read avatar objects"
  on storage.objects for select to authenticated using (bucket_id = 'free-roam-avatars');
create policy "free roam players can upload own avatar objects"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'free-roam-avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "free roam players can delete own avatar objects"
  on storage.objects for delete to authenticated
  using (bucket_id = 'free-roam-avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "free roam players can read map objects"
  on storage.objects for select to authenticated using (bucket_id = 'free-roam-maps');
create policy "free roam managers can upload map objects"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'free-roam-maps' and public.free_roam_is_manager());
create policy "free roam managers can delete map objects"
  on storage.objects for delete to authenticated
  using (bucket_id = 'free-roam-maps' and public.free_roam_is_manager());

grant select, insert, update, delete on public.free_roam_avatars to authenticated;
grant select, insert, update, delete on public.free_roam_maps to authenticated;
grant select, update on public.free_roam_settings to authenticated;
grant execute on function public.free_roam_is_manager() to authenticated;

create or replace function public.free_roam_activate_map(p_map_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.free_roam_is_manager() then raise exception 'Operazione riservata ai manager.'; end if;
  if p_map_id is not null and not exists (select 1 from public.free_roam_maps where id = p_map_id and enabled) then
    raise exception 'Mappa non trovata o disattivata.';
  end if;
  update public.free_roam_settings
    set active_map_id = p_map_id, updated_at = now(), updated_by = auth.uid()
    where id = true;
end;
$$;
grant execute on function public.free_roam_activate_map(uuid) to authenticated;
