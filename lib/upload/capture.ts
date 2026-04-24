/**
 * capture.ts — end-to-end meal capture pipeline
 *
 * compress → generate path → upload to Supabase Storage → insert meals row
 *
 * This module is browser-only. All functions must be called from client
 * components or event handlers (never server code).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { compressImage } from "@/lib/image/compress";
import type { Category } from "@/lib/supabase/types";

// ── Types ────────────────────────────────────────────────────────────────────

export interface CaptureOptions {
  file: File;
  category: Category;
  userId: string;
  supabase: SupabaseClient;
}

export interface CaptureResult {
  mealId: string;
  imagePath: string;
  category: Category;
  createdAt: string;
}

// ── Path generator ────────────────────────────────────────────────────────────

/**
 * Generates a storage path for an uploaded meal photo.
 *
 * The `userId` prefix is REQUIRED by the RLS storage policy
 * (`meal_photos_insert_owner` checks `(storage.foldername(name))[1] = auth.uid()`).
 *
 * Format: `<userId>/<timestamp>-<uuid>.jpg`
 *   - timestamp: Date.now() for rough chronological ordering in the bucket
 *   - uuid: crypto.randomUUID() to prevent any collision
 *   - always .jpg regardless of source mime — we compress to image/jpeg
 */
export function generateImagePath(userId: string, _mimeType?: string): string {
  const timestamp = Date.now();
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `${userId}/${timestamp}-${suffix}.jpg`;
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

/**
 * Full meal capture pipeline:
 *   1. Compress the file (max 1600px, target ~300KB)
 *   2. Generate a storage path with userId prefix (required for RLS)
 *   3. Upload compressed JPEG blob to the `meal-photos` bucket
 *   4. Insert a row into the `meals` table
 *   5. Return the new meal's id, path, category and created_at
 *
 * Throws with a human-readable message on any step failure.
 * HEIC files are rejected by compressImage before any network call.
 */
export async function captureAndUploadMeal(
  opts: CaptureOptions
): Promise<CaptureResult> {
  const { file, category, userId, supabase } = opts;

  // ── Step 1: Compress ────────────────────────────────────────────────────────
  // compressImage throws for HEIC/HEIF files with a user-facing message.
  // It also cleans up the object URL it creates internally via finally{}.
  const { blob } = await compressImage(file, {
    maxDimension: 1600,
    targetKB: 300,
    mimeType: "image/jpeg",
  });

  // ── Step 2: Path ─────────────────────────────────────────────────────────────
  const imagePath = generateImagePath(userId, file.type);

  // ── Step 3: Upload ───────────────────────────────────────────────────────────
  const { error: uploadError } = await supabase.storage
    .from("meal-photos")
    .upload(imagePath, blob, {
      contentType: "image/jpeg",
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`upload failed: ${uploadError.message}`);
  }

  // ── Step 4: Insert row ───────────────────────────────────────────────────────
  const { data: inserted, error: insertError } = await supabase
    .from("meals")
    .insert({ user_id: userId, image_path: imagePath, category })
    .select("id, image_path, category, created_at")
    .single();

  if (insertError) {
    // Row insert failed — attempt to clean up the orphaned storage object so
    // we don't accumulate unreferenced blobs. Best-effort; ignore cleanup error.
    await supabase.storage.from("meal-photos").remove([imagePath]).catch(() => {
      // intentionally silent — the cleanup is best-effort
    });
    throw new Error(`db insert failed: ${insertError.message}`);
  }

  if (!inserted) {
    throw new Error("db insert returned no data");
  }

  // ── Step 5: Return ───────────────────────────────────────────────────────────
  return {
    mealId: inserted.id as string,
    imagePath: inserted.image_path as string,
    category: inserted.category as Category,
    createdAt: inserted.created_at as string,
  };
}
