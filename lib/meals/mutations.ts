/**
 * lib/meals/mutations.ts
 *
 * Client-side Supabase mutations for meal rows + storage objects.
 * All functions run in the browser; they accept an already-initialized
 * SupabaseClient so callers can share the singleton from getSupabaseBrowserClient().
 *
 * Safety note on delete order:
 *   Storage is deleted BEFORE the row. If storage deletion fails (for any
 *   reason other than "already gone"), we throw before touching the row.
 *   This is preferable to the reverse: a row-first strategy risks leaving
 *   orphaned storage objects that can never be cleaned up.
 *
 * Multi-photo (Wave 1): a meal may have 1+ photos in `meal_photos`. We
 * gather every path (including the legacy `meals.image_path` cover, in case
 * it isn't mirrored to meal_photos) and remove them all in one storage call.
 * The meal row is deleted last; meal_photos rows cascade via FK.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Category, MealRow } from "@/lib/supabase/types";

// ── deleteMeal ────────────────────────────────────────────────────────────────

/**
 * Deletes a meal and every storage object it references. Accepts the meal id
 * (mandatory) and optionally a hint about the cover `image_path` — for legacy
 * meals that didn't get a meal_photos backfill row, the cover hint is the
 * only path we'd find.
 */
export async function deleteMeal(
  supabase: SupabaseClient,
  meal: Pick<MealRow, "id"> & { image_path?: string | null }
): Promise<void> {
  // 1. Gather every storage path attached to this meal.
  const paths = new Set<string>();
  if (meal.image_path) paths.add(meal.image_path);

  const { data: photoRows, error: photoQueryError } = await supabase
    .from("meal_photos")
    .select("image_path")
    .eq("meal_id", meal.id);

  if (photoQueryError) {
    // Not fatal — fall back to whatever we already have from the cover hint.
    // Worst case: a few photo objects orphan in storage (recoverable manually).
    console.warn(
      "[deleteMeal] failed to enumerate meal_photos:",
      photoQueryError.message
    );
  } else if (photoRows) {
    for (const row of photoRows as { image_path: string }[]) {
      if (row.image_path) paths.add(row.image_path);
    }
  }

  // 2. Delete the storage objects (best-effort: not-found = already gone).
  if (paths.size > 0) {
    const { error: storageError } = await supabase.storage
      .from("meal-photos")
      .remove(Array.from(paths));

    if (storageError) {
      const msg = storageError.message?.toLowerCase() ?? "";
      const isNotFound =
        msg.includes("not found") ||
        msg.includes("does not exist") ||
        msg.includes("key not found");

      if (!isNotFound) {
        throw new Error(
          `Could not delete photos: ${storageError.message ?? "unknown storage error"}`
        );
      }
    }
  }

  // 3. Delete the row. meal_photos rows cascade via FK on delete.
  const { error: rowError } = await supabase
    .from("meals")
    .delete()
    .eq("id", meal.id);

  if (rowError) {
    throw new Error(
      `Could not delete meal record: ${rowError.message ?? "unknown database error"}`
    );
  }
}

// ── updateMealCategory ────────────────────────────────────────────────────────

export async function updateMealCategory(
  supabase: SupabaseClient,
  mealId: string,
  newCategory: Category
): Promise<MealRow> {
  const { data, error } = await supabase
    .from("meals")
    .update({ category: newCategory })
    .eq("id", mealId)
    .select()
    .single();

  if (error) {
    throw new Error(
      `Could not update meal category: ${error.message ?? "unknown database error"}`
    );
  }

  return data as MealRow;
}
