-- GLB binaries are published through GitHub Releases and served by GitHub Pages.
-- Supabase keeps only metadata and the public Pages URL. Existing Storage rows remain readable.
alter table public.free_roam_avatars add column if not exists asset_url text;
alter table public.free_roam_maps add column if not exists asset_url text;
alter table public.free_roam_avatars alter column storage_path drop not null;
alter table public.free_roam_maps alter column storage_path drop not null;

alter table public.free_roam_avatars drop constraint if exists free_roam_avatars_file_size_check;
alter table public.free_roam_avatars add constraint free_roam_avatars_file_size_check
  check (file_size > 0 and file_size <= 52428800);
alter table public.free_roam_maps drop constraint if exists free_roam_maps_file_size_check;
alter table public.free_roam_maps add constraint free_roam_maps_file_size_check
  check (file_size > 0 and file_size <= 524288000);

alter table public.free_roam_avatars drop constraint if exists free_roam_avatars_source_check;
alter table public.free_roam_avatars add constraint free_roam_avatars_source_check check (
  (storage_path is not null and asset_url is null) or
  (storage_path is null and asset_url ~* '^https://gattomorto24[.]github[.]io/fantascuola/Free-Roam/release-assets/[A-Za-z0-9._-]+[.]glb$')
);
alter table public.free_roam_maps drop constraint if exists free_roam_maps_source_check;
alter table public.free_roam_maps add constraint free_roam_maps_source_check check (
  (storage_path is not null and asset_url is null) or
  (storage_path is null and asset_url ~* '^https://gattomorto24[.]github[.]io/fantascuola/Free-Roam/release-assets/[A-Za-z0-9._-]+[.]glb$')
);

-- Public GitHub assets can be shown to guests sharing the same Free Roam world.
create policy "free roam public avatars readable by guests"
  on public.free_roam_avatars for select to anon using (asset_url is not null);
create policy "free roam public maps readable by guests"
  on public.free_roam_maps for select to anon using (asset_url is not null);
create policy "free roam active map readable by guests"
  on public.free_roam_settings for select to anon using (true);
grant select on public.free_roam_avatars, public.free_roam_maps, public.free_roam_settings to anon;

drop policy if exists "free roam avatar owner can insert" on public.free_roam_avatars;
create policy "free roam avatar owner can insert"
  on public.free_roam_avatars for insert to authenticated
  with check (owner_id = auth.uid() and (
    (storage_path is not null and storage_path like auth.uid()::text || '/%' and asset_url is null) or
    (storage_path is null and asset_url is not null)
  ));
drop policy if exists "free roam avatar owner can update" on public.free_roam_avatars;
create policy "free roam avatar owner can update"
  on public.free_roam_avatars for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and (
    (storage_path is not null and storage_path like auth.uid()::text || '/%' and asset_url is null) or
    (storage_path is null and asset_url is not null)
  ));
