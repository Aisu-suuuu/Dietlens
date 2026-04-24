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
   * Storage object path within the `meal-photos` bucket.
   * Format: "<user_id>/<timestamp>.jpg"
   * NOT a URL — use supabase.storage.from('meal-photos').createSignedUrl() to get one.
   */
  image_path: string;
  /** Meal time category */
  category: Category;
  /** ISO 8601 timestamp — default now() */
  created_at: string;
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
