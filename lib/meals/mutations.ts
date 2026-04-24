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
 *   an orphaned storage object that can never be cleaned up.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Category, MealRow } from "@/lib/supabase/types";

// ── deleteMeal ────────────────────────────────────────────────────────────────

export async function deleteMeal(
  supabase: SupabaseClient,
  meal: Pick<MealRow, "id" | "image_path">
): Promise<void> {
  // 1. Delete storage object first (safer — see module docstring).
  const { error: storageError } = await supabase.storage
    .from("meal-photos")
    .remove([meal.image_path]);

  if (storageError) {
    // "Not found" errors mean the object is already gone — safe to continue.
    // We match on the message text because Supabase Storage doesn't expose
    // typed error codes for this specific condition.
    const isNotFound =
      storageError.message?.toLowerCase().includes("not found") ||
      storageError.message?.toLowerCase().includes("does not exist") ||
      storageError.message?.toLowerCase().includes("key not found");

    if (!isNotFound) {
      throw new Error(
        `Could not delete photo: ${storageError.message ?? "unknown storage error"}`
      );
    }
    // else: already gone — continue to row deletion
  }

  // 2. Delete the row.
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
