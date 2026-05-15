-- =============================================================================
-- Run me ONCE in the Supabase SQL Editor.
-- This applies migrations 0002, 0003, 0004, 0005 in order.
-- All four are idempotent — safe to re-run if anything goes wrong.
-- Open: https://supabase.com/dashboard/project/ezoxgviyduobyidqiklv/sql/new
-- =============================================================================



-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║ 0002_multi_photo.sql
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- =============================================================================
-- DietLens: Multi-photo per meal
-- Adds: meal_photos child table (one row per photo, many per meal).
-- Backfills: existing meals.image_path -> meal_photos position 0.
-- Relaxes: meals.image_path becomes nullable (writes shift to meal_photos).
-- Idempotent: safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: meal_photos
-- One row per photo. Cascaded delete with the parent meal.
-- ---------------------------------------------------------------------------
create table if not exists public.meal_photos (
  id          uuid        primary key default gen_random_uuid(),
  meal_id     uuid        not null
                            references public.meals (id)
                            on delete cascade,
  image_path  text        not null,
  -- Storage path within the meal-photos bucket, e.g. "<user_id>/<ts>-<suffix>.jpg"
  position    int         not null default 0,
  -- 0-based order within the meal; carousel renders in ascending order.
  created_at  timestamptz not null default now()
);

-- Index: fetch a meal's photos in carousel order
create index if not exists meal_photos_meal_pos_idx
  on public.meal_photos (meal_id, position);

-- RLS: enable
alter table public.meal_photos enable row level security;

-- Policy: owner-only (joined through meals).
-- Note: Wave 3 (follows) replaces this with a follower-read variant.
drop policy if exists meal_photos_owner on public.meal_photos;
create policy meal_photos_owner
  on public.meal_photos
  for all
  using (
    exists (
      select 1
      from public.meals m
      where m.id = meal_photos.meal_id
        and m.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.meals m
      where m.id = meal_photos.meal_id
        and m.user_id = auth.uid()
    )
  );


-- ---------------------------------------------------------------------------
-- Backfill: copy meals.image_path -> meal_photos.position=0
-- Only meals that don't already have a photo row are seeded (idempotent).
-- ---------------------------------------------------------------------------
insert into public.meal_photos (meal_id, image_path, position)
select m.id, m.image_path, 0
from public.meals m
where m.image_path is not null
  and not exists (
    select 1 from public.meal_photos p where p.meal_id = m.id
  );


-- ---------------------------------------------------------------------------
-- Relax: meals.image_path becomes nullable.
-- New writes go to meal_photos; meals.image_path stays for back-compat reads
-- until the legacy column is dropped in a later migration.
-- ---------------------------------------------------------------------------
alter table public.meals alter column image_path drop not null;

-- =============================================================================
-- END OF MIGRATION
-- Verification:
--   select count(*) from public.meal_photos;
--      -- should equal count(*) from meals where image_path is not null (after first run)
--   select m.id, count(p.*) as photo_count
--     from public.meals m
--     left join public.meal_photos p on p.meal_id = m.id
--    group by m.id
--    order by photo_count desc
--    limit 10;
-- =============================================================================


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║ 0003_profiles.sql
-- ╚═══════════════════════════════════════════════════════════════════════╝

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


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║ 0004_follows.sql
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- =============================================================================
-- DietLens: Asymmetric follow graph (Wave 3)
--
-- A follow is a directed edge: follower_id -> followee_id.
-- Following someone grants visibility into their meals + meal_photos and
-- ability to fetch their photo objects from storage. The relationship is
-- NOT mutual; both sides must follow each other to see each other's meals.
--
-- The meals + meal_photos + storage RLS policies installed by 0001/0002 are
-- rewritten here to add the follower-read path while preserving owner-only
-- writes. The original "for all" combined policies are split into separate
-- read / write policies so the new visibility rule attaches cleanly to
-- SELECT alone.
--
-- Idempotent: safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: follows
-- ---------------------------------------------------------------------------
create table if not exists public.follows (
  follower_id uuid        not null
                            references auth.users (id)
                            on delete cascade,
  followee_id uuid        not null
                            references auth.users (id)
                            on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  -- Prevent self-follow at the schema level; the UI also gates on this.
  constraint follows_no_self check (follower_id <> followee_id)
);

-- Index: list a user's followers fast (Wave 5 profile counts + list).
create index if not exists follows_followee_idx
  on public.follows (followee_id);

-- RLS: enable
alter table public.follows enable row level security;

-- The acting user can INSERT/DELETE rows where they are the follower.
-- (i.e. you can follow / unfollow on your own behalf, never on someone
-- else's behalf.)
drop policy if exists follows_actor_insert on public.follows;
create policy follows_actor_insert
  on public.follows
  for insert
  with check (auth.uid() = follower_id);

drop policy if exists follows_actor_delete on public.follows;
create policy follows_actor_delete
  on public.follows
  for delete
  using (auth.uid() = follower_id);

-- SELECT: a user can see follow edges they're a party to (either side).
-- This is what powers "your followers" and "people you follow" lists.
drop policy if exists follows_visible on public.follows;
create policy follows_visible
  on public.follows
  for select
  using (auth.uid() in (follower_id, followee_id));


-- ---------------------------------------------------------------------------
-- Helper: is_following(target)
-- Returns true if auth.uid() currently follows the given user.
-- security definer so it bypasses follows RLS — we only want the boolean
-- answer, not to expose other users' rows.
-- ---------------------------------------------------------------------------
create or replace function public.is_following(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.follows
    where follower_id = auth.uid()
      and followee_id = target
  );
$$;


-- ---------------------------------------------------------------------------
-- meals RLS: rewrite for owner-or-follower visibility
--
-- Drop the legacy combined "meals_owner" policy and install split policies:
--   meals_select   — owner OR follower of owner
--   meals_insert   — owner-only
--   meals_update   — owner-only
--   meals_delete   — owner-only
-- ---------------------------------------------------------------------------
drop policy if exists meals_owner         on public.meals;
drop policy if exists meals_select        on public.meals;
drop policy if exists meals_insert        on public.meals;
drop policy if exists meals_update        on public.meals;
drop policy if exists meals_delete        on public.meals;

create policy meals_select
  on public.meals
  for select
  using (
    auth.uid() = user_id
    or public.is_following(user_id)
  );

create policy meals_insert
  on public.meals
  for insert
  with check (auth.uid() = user_id);

create policy meals_update
  on public.meals
  for update
  using       (auth.uid() = user_id)
  with check  (auth.uid() = user_id);

create policy meals_delete
  on public.meals
  for delete
  using (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- meal_photos RLS: mirror the meals visibility rule
-- ---------------------------------------------------------------------------
drop policy if exists meal_photos_owner   on public.meal_photos;
drop policy if exists meal_photos_select  on public.meal_photos;
drop policy if exists meal_photos_insert  on public.meal_photos;
drop policy if exists meal_photos_update  on public.meal_photos;
drop policy if exists meal_photos_delete  on public.meal_photos;

create policy meal_photos_select
  on public.meal_photos
  for select
  using (
    exists (
      select 1
      from public.meals m
      where m.id = meal_photos.meal_id
        and (m.user_id = auth.uid() or public.is_following(m.user_id))
    )
  );

create policy meal_photos_insert
  on public.meal_photos
  for insert
  with check (
    exists (
      select 1
      from public.meals m
      where m.id = meal_photos.meal_id
        and m.user_id = auth.uid()
    )
  );

create policy meal_photos_update
  on public.meal_photos
  for update
  using (
    exists (
      select 1
      from public.meals m
      where m.id = meal_photos.meal_id
        and m.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.meals m
      where m.id = meal_photos.meal_id
        and m.user_id = auth.uid()
    )
  );

create policy meal_photos_delete
  on public.meal_photos
  for delete
  using (
    exists (
      select 1
      from public.meals m
      where m.id = meal_photos.meal_id
        and m.user_id = auth.uid()
    )
  );


-- ---------------------------------------------------------------------------
-- storage: meal-photos bucket — add follower-read alongside owner-read
--
-- Path convention from 0001: "<user_id>/<filename>".
-- (storage.foldername(name))[1] is the owner's auth.uid().
-- The legacy meal_photos_select_owner policy already covered owner-read; we
-- replace it with a combined predicate so we don't end up with overlapping
-- SELECT policies (which Postgres ORs together but produces clutter).
-- ---------------------------------------------------------------------------
drop policy if exists "meal_photos_select_owner"      on storage.objects;
drop policy if exists "meal_photos_select_visible"    on storage.objects;

create policy "meal_photos_select_visible"
  on storage.objects
  for select
  using (
    bucket_id = 'meal-photos'
    and (
      auth.uid()::text = (storage.foldername(name))[1]
      or public.is_following( ((storage.foldername(name))[1])::uuid )
    )
  );

-- INSERT + DELETE policies from 0001 stay as-is (owner-only).

-- =============================================================================
-- END OF MIGRATION
-- Verification:
--   -- two users in different anon sessions:
--   select * from public.follows;                   -- 0 rows initially
--   -- as user A, after inserting a follow A -> B:
--   select public.is_following('<B_uuid>');         -- true
--   -- as user A, query B's meals:
--   select count(*) from public.meals where user_id = '<B_uuid>';
--                                                    -- > 0 once policy attaches
-- =============================================================================


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║ 0005_invites.sql
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- =============================================================================
-- DietLens: Email invites (Wave 4)
--
-- One row per "I'd like to invite this email" event. The token is the
-- random part of the magic-link redirect; when the invitee returns to
-- /auth/callback?invite=<token>&code=..., we look up this row, insert a
-- MUTUAL follow edge between inviter and the new user, and mark the row
-- accepted.
--
-- (Mutual on invite is the only place where mutuality is enforced — manual
-- follows via FollowButton remain strictly asymmetric per the locked
-- decision in the plan.)
--
-- Idempotent: safe to re-run.
-- =============================================================================

create table if not exists public.invites (
  token         text        primary key,
  inviter_id    uuid        not null
                              references auth.users (id)
                              on delete cascade,
  invitee_email text        not null,
  created_at    timestamptz not null default now(),
  accepted_at   timestamptz,
  accepted_by   uuid        references auth.users (id) on delete set null
);

-- Index: list of invites by inviter (for "you've invited 5 people" UI).
create index if not exists invites_inviter_idx
  on public.invites (inviter_id);

-- RLS: enable
alter table public.invites enable row level security;

-- The inviter can read + write rows where they are the inviter.
-- The acceptance path (inserting the mutual follow + marking accepted) runs
-- server-side under the service role and bypasses RLS — that's the only
-- path that touches another user's row, and it's gated by knowledge of the
-- token, which only the invitee receives via email.
drop policy if exists invites_inviter on public.invites;
create policy invites_inviter
  on public.invites
  for all
  using       (auth.uid() = inviter_id)
  with check  (auth.uid() = inviter_id);

-- =============================================================================
-- END OF MIGRATION
-- Verification:
--   -- as user A:
--   insert into public.invites (token, inviter_id, invitee_email)
--     values ('test-token-1', auth.uid(), 'friend@example.com');
--   select * from public.invites where inviter_id = auth.uid();   -- visible
--   -- as user B (different session): same select returns 0 rows.
-- =============================================================================
