alter table public.studenti
  add column if not exists banner_url text,
  add column if not exists banner_position text default '50% 50%';
