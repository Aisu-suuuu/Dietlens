// ---------------------------------------------------------------------------
// Meal categories — must exactly match the SQL CHECK constraint in 0001_init.sql
// ---------------------------------------------------------------------------
export type Category =
  | "Breakfast"
  | "Post-Workout"
  | "Mid-Morning"
  | "Lunch"
  | "Snack"
  | "Dinner";

export const CATEGORIES: readonly Category[] = [
  "Breakfast",
  "Post-Workout",
  "Mid-Morning",
  "Lunch",
  "Snack",
  "Dinner",
] as const;

// ---------------------------------------------------------------------------
// public.meals row
// ---------------------------------------------------------------------------
export interface MealRow {
  /** UUID primary key — gen_random_uuid() */
  id: string;
  /** References auth.users(id) — anonymous user's UID */
  user_id: string;
  /**
   * Cover photo storage path within the `meal-photos` bucket. Always equals
   * the position-0 entry in `meal_photos`. Kept on the parent row so the
   * Albums grid can render a thumbnail without joining meal_photos.
   *
   * Nullable since the 0002_multi_photo migration; legacy single-photo
   * meals are backfilled into meal_photos and continue to populate this.
   * NOT a URL — use supabase.storage.from('meal-photos').createSignedUrl().
   */
  image_path: string | null;
  /** Meal time category */
  category: Category;
  /** ISO 8601 timestamp — default now() */
  created_at: string;
}

// ---------------------------------------------------------------------------
// public.meal_photos row — one per photo, many per meal (Wave 1)
// ---------------------------------------------------------------------------
export interface MealPhotoRow {
  /** UUID primary key */
  id: string;
  /** FK → meals.id, cascades on parent delete */
  meal_id: string;
  /** Storage path in the `meal-photos` bucket, same format as MealRow.image_path */
  image_path: string;
  /** 0-based carousel order. Position 0 is the cover. */
  position: number;
  /** ISO 8601 timestamp — default now() */
  created_at: string;
}

/**
 * Convenience composite — a meal with its photos eagerly loaded via the
 * Supabase nested-select syntax: `.select("*, photos:meal_photos(*)")`.
 * Photos arrive unsorted from PostgREST; consumers should sort by `position`.
 */
export interface MealWithPhotos extends MealRow {
  photos: MealPhotoRow[];
}

// ---------------------------------------------------------------------------
// public.push_subs row
// ---------------------------------------------------------------------------
export interface PushSubRow {
  /** Primary key — also references auth.users(id) */
  user_id: string;
  /** Web Push subscription endpoint URL */
  endpoint: string;
  /** P-256 DH public key (base64url) */
  p256dh: string;
  /** Web Push auth secret (base64url). Column is `auth_key` to avoid collision with pg's auth schema */
  auth_key: string;
  /** IANA timezone name e.g. 'Asia/Kolkata', 'America/New_York' */
  timezone: string;
  /** ISO 8601 timestamp — auto-stamped by set_updated_at() trigger */
  updated_at: string;
}
