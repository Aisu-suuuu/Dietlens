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
