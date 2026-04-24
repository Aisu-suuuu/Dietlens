-- =============================================================================
-- DietLens: Initial database migration
-- Creates: meals, push_subs tables; RLS owner-only policies; storage bucket
-- policies for meal-photos; indexes; updated_at trigger.
-- Anonymous Sign-In is used for auth — every device gets a real auth.uid()
-- without a visible login screen. All RLS gates by auth.uid() = user_id.
-- Run this once in the Supabase SQL Editor on a fresh project.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";


-- ---------------------------------------------------------------------------
-- Helper: set_updated_at()
-- Trigger function that stamps updated_at = now() on any UPDATE.
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- Table: meals
-- One row per logged meal photo.
-- ---------------------------------------------------------------------------
create table if not exists public.meals (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null
                            references auth.users (id)
                            on delete cascade,
  image_path  text        not null,
  -- Storage path within the meal-photos bucket, e.g. "<user_id>/1714000000000.jpg"
  -- NOT a URL — generate signed URLs client-side via supabase.storage.from('meal-photos').createSignedUrl()
  category    text        not null
                            check (category in (
                              'Breakfast',
                              'Post-Workout',
                              'Mid-Morning',
                              'Lunch',
                              'Snack',
                              'Dinner'
                            )),
  created_at  timestamptz not null default now()
);

-- Index: dashboard sort (newest-first per user)
create index if not exists meals_user_created_idx
  on public.meals (user_id, created_at desc);

-- Index: album pages filter by category
create index if not exists meals_user_category_created_idx
  on public.meals (user_id, category, created_at desc);

-- RLS: enable row-level security
alter table public.meals enable row level security;

-- Policy: users may only see and modify their own rows
create policy meals_owner
  on public.meals
  for all
  using       (auth.uid() = user_id)
  with check  (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- Table: push_subs
-- Web Push subscriptions for meal-reminder notifications.
-- One row per user (user_id is the PK — upsert on re-subscribe).
-- ---------------------------------------------------------------------------
create table if not exists public.push_subs (
  user_id     uuid        primary key
                            references auth.users (id)
                            on delete cascade,
  endpoint    text        not null,
  p256dh      text        not null,
  -- auth_key: the Web Push auth secret.
  -- Renamed from "auth" to avoid collision with Postgres' built-in auth schema.
  auth_key    text        not null,
  timezone    text        not null,
  -- IANA timezone name, e.g. 'Asia/Kolkata', 'America/New_York'
  updated_at  timestamptz not null default now()
);

-- Trigger: auto-stamp updated_at on every UPDATE
create trigger push_subs_set_updated_at
  before update on public.push_subs
  for each row
  execute function public.set_updated_at();

-- RLS: enable row-level security
alter table public.push_subs enable row level security;

-- Policy: users may only see and modify their own subscription row
create policy push_subs_owner
  on public.push_subs
  for all
  using       (auth.uid() = user_id)
  with check  (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- Storage: meal-photos bucket policies
--
-- The bucket itself is created via the Supabase Dashboard (Storage > New bucket)
-- because the storage.buckets INSERT API requires service-role privileges.
-- These policies gate which objects users can read/write/delete within it.
--
-- Object naming convention enforced by policy:
--   {auth.uid()}/{anything}
-- e.g.  e3b0c442-98fc-1c14/1714000000000.jpg
--
-- NOTE: If you get "new row violates row-level security" on storage,
-- ensure the bucket name in the policy matches exactly: 'meal-photos'
-- ---------------------------------------------------------------------------

-- SELECT: users can read only their own objects
create policy "meal_photos_select_owner"
  on storage.objects
  for select
  using (
    bucket_id = 'meal-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- INSERT: users can upload only into their own prefix
create policy "meal_photos_insert_owner"
  on storage.objects
  for insert
  with check (
    bucket_id = 'meal-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- DELETE: users can delete only their own objects (needed for re-categorize + delete flows)
create policy "meal_photos_delete_owner"
  on storage.objects
  for delete
  using (
    bucket_id = 'meal-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- No UPDATE policy: we never mutate images in place; upload a new object instead.

-- =============================================================================
-- END OF MIGRATION
-- Verification queries (run separately to confirm success):
--   select * from public.meals;              -- should return 0 rows, no error
--   select * from public.push_subs;          -- should return 0 rows, no error
--   select tablename, rowsecurity
--     from pg_tables
--    where schemaname = 'public';            -- rowsecurity = true for both tables
--   select * from storage.buckets
--    where id = 'meal-photos';              -- should return 1 row after bucket creation
-- =============================================================================
