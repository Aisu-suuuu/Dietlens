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
