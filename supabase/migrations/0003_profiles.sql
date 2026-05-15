-- =============================================================================
-- DietLens: Profiles (Wave 2 — optional email upgrade)
-- One profile row per auth.users id. Created automatically by trigger so
-- anonymous + email users are both rendered uniformly in the UI.
-- Idempotent: safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: profiles
-- 1:1 with auth.users. Cascades on delete so a wiped user takes their
-- profile with them.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid        primary key
                              references auth.users (id)
                              on delete cascade,
  display_name  text,
  -- Optional human-readable name. Null until the user fills it in on
  -- /profile. Anonymous users start with a null display_name and a SVG
  -- monogram fallback (Wave 5).
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS: world-readable, self-writable
--
-- Profiles are world-readable so any user can show another user's display
-- name on a follower/following list (Wave 3) without a server-side join
-- through auth.users. They're only writable by the owner.
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists profiles_world_read on public.profiles;
create policy profiles_world_read
  on public.profiles
  for select
  using (true);

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update
  on public.profiles
  for update
  using       (auth.uid() = id)
  with check  (auth.uid() = id);

-- We intentionally don't expose an INSERT policy — rows are created by the
-- trigger below using security definer privileges. That keeps the only
-- writable path (UPDATE) gated by ownership.

-- ---------------------------------------------------------------------------
-- Trigger: auto-create a profile row on every new auth.users insert
-- Runs as security definer so it can write into public.profiles even though
-- the new user's session hasn't fully attached yet. Idempotent on conflict
-- so re-running the migration doesn't error.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, null)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Backfill: existing users (anon and otherwise) get a profile row
-- ---------------------------------------------------------------------------
insert into public.profiles (id, display_name)
select u.id, null
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);

-- =============================================================================
-- END OF MIGRATION
-- Verification:
--   select count(*) from public.profiles;
--      -- should equal count(*) from auth.users immediately after run
--   select tgname from pg_trigger where tgrelid = 'auth.users'::regclass;
--      -- should include on_auth_user_created
-- =============================================================================
