-- The active map and its public Hugging Face URL must be readable by guests.
drop policy if exists "free roam active map readable by guests" on public.free_roam_settings;
create policy "free roam active map readable by guests"
  on public.free_roam_settings for select to anon using (true);

drop policy if exists "free roam Hugging Face maps readable by guests" on public.free_roam_maps;
create policy "free roam Hugging Face maps readable by guests"
  on public.free_roam_maps for select to anon
  using (metadata->>'source' = 'huggingface-bucket'
    and metadata->>'asset_url' ~ '^https://huggingface[.]co/buckets/');

grant select on public.free_roam_settings, public.free_roam_maps to anon;
