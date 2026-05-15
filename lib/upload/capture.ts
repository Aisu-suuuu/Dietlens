/**
 * capture.ts — end-to-end meal capture pipeline (multi-photo, Wave 1)
 *
 * compress N files in parallel → branch on connectivity:
 *   - ONLINE: upload all to Supabase Storage in parallel → insert one meals
 *             row (with image_path = photos[0].image_path as cover) →
 *             insert N meal_photos rows in a single batch.
 *   - OFFLINE: stash all compressed blobs in IndexedDB, dispatch optimistic
 *              event; sync drains them later.
 *
 * Order is preserved everywhere — files[0] is always the cover photo and
 * position 0 in meal_photos.
 *
 * This module is browser-only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { compressImage } from "@/lib/image/compress";
import type { Category, MealPhotoRow } from "@/lib/supabase/types";
import {
  enqueueMeal,
  generateLocalId,
} from "@/lib/offline/queue";
import { syncQueue } from "@/lib/offline/sync";

// ── Types ────────────────────────────────────────────────────────────────────

export interface CaptureOptions {
  /**
   * One or more image files to log under a single meal. Order is preserved;
   * files[0] becomes the cover and the first carousel slide.
   */
  files: File[];
  category: Category;
  userId: string;
  supabase: SupabaseClient;
}

export interface CaptureResult {
  /**
   * Online path: the server-assigned UUID from the `meals` table.
   * Offline path: the `localId` of the IndexedDB queue entry — NOT a
   * server id. Consumers should check `pending` to disambiguate.
   */
  mealId: string;
  /**
   * Cover photo path (same as photos[0].image_path online; "queued:<localId>"
   * sentinel offline). Lets AlbumTile thumbnails stay simple.
   */
  imagePath: string;
  category: Category;
  createdAt: string;
  /**
   * All photos for this meal, in carousel order. Online: real server rows.
   * Offline: synthetic rows backed by the IDB blobs (image_path holds
   * "queued:<localId>:<position>" sentinels).
   */
  photos: MealPhotoRow[];
  /**
   * True when this result is backed only by the local IndexedDB queue
   * (offline capture). MealCard uses this to know it should render the
   * blob-backed preview rather than try a signed URL.
   */
  pending?: boolean;
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
 *   - uuid: crypto.randomUUID() short suffix to prevent any collision
 *   - always .jpg regardless of source mime — we compress to image/jpeg
 */
export function generateImagePath(userId: string, _mimeType?: string): string {
  const timestamp = Date.now();
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `${userId}/${timestamp}-${suffix}.jpg`;
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

/**
 * Full meal capture pipeline. See module-level docstring for the flow.
 *
 * Throws on:
 *   - empty files array (caller bug)
 *   - compression failure (HEIC/HEIF — surfaced with user-facing message)
 *   - ONLINE: any upload error or DB insert error (with best-effort
 *     cleanup of partial uploads)
 *   - OFFLINE: IDB write failure
 */
export async function captureAndUploadMeal(
  opts: CaptureOptions
): Promise<CaptureResult> {
  const { files, category, userId, supabase } = opts;

  if (!files.length) {
    throw new Error("captureAndUploadMeal called with empty files array");
  }

  // ── Step 1: Compress all files in parallel ────────────────────────────────
  // We compress before deciding online/offline so a network blip mid-flow
  // still results in usable blobs. Promise.all rejects fast on the first
  // HEIC/HEIF — surface that as-is to the FAB.
  const compressed = await Promise.all(
    files.map((file) =>
      compressImage(file, {
        maxDimension: 1600,
        targetKB: 300,
        mimeType: "image/jpeg",
      })
    )
  );
  const blobs = compressed.map((c) => c.blob);

  // ── Step 2: Branch on connectivity ────────────────────────────────────────
  // Re-check onLine AFTER compression — a long compress run might span a
  // network state change.
  const isOffline = typeof navigator !== "undefined" && navigator.onLine === false;

  if (isOffline) {
    return captureOffline({ blobs, category, userId, supabase });
  }

  return captureOnline({ blobs, category, userId, supabase });
}

// ── Online branch ─────────────────────────────────────────────────────────────

interface BranchOpts {
  blobs: Blob[];
  category: Category;
  userId: string;
  supabase: SupabaseClient;
}

async function captureOnline(opts: BranchOpts): Promise<CaptureResult> {
  const { blobs, category, userId, supabase } = opts;

  // 1. Mint one storage path per blob.
  const imagePaths = blobs.map(() => generateImagePath(userId));

  // 2. Upload all blobs in parallel. Promise.all rejects fast on any failure,
  //    so we capture which uploads succeeded for cleanup on partial failure.
  const uploaded: string[] = [];
  try {
    await Promise.all(
      blobs.map(async (blob, i) => {
        const { error } = await supabase.storage
          .from("meal-photos")
          .upload(imagePaths[i], blob, {
            contentType: "image/jpeg",
            upsert: false,
          });
        if (error) {
          throw new Error(`upload failed: ${error.message}`);
        }
        uploaded.push(imagePaths[i]);
      })
    );
  } catch (err) {
    // Best-effort cleanup of any succeeded uploads so the bucket doesn't
    // accumulate orphans. Storage RLS allows the owner to delete.
    if (uploaded.length) {
      await supabase.storage.from("meal-photos").remove(uploaded).catch(() => {});
    }
    throw err;
  }

  // 3. Insert the parent meals row. image_path = cover for back-compat with
  //    the Albums grid thumbnail; nullable in schema but we always set it.
  const coverPath = imagePaths[0];
  const { data: inserted, error: insertError } = await supabase
    .from("meals")
    .insert({ user_id: userId, image_path: coverPath, category })
    .select("id, image_path, category, created_at")
    .single();

  if (insertError || !inserted) {
    await supabase.storage.from("meal-photos").remove(imagePaths).catch(() => {});
    throw new Error(`db insert failed: ${insertError?.message ?? "no data returned"}`);
  }

  const mealId = inserted.id as string;

  // 4. Insert the meal_photos rows in a single round-trip. Order preserved
  //    via the position field.
  const photoRows = imagePaths.map((path, position) => ({
    meal_id: mealId,
    image_path: path,
    position,
  }));

  const { data: photoData, error: photoError } = await supabase
    .from("meal_photos")
    .insert(photoRows)
    .select("id, meal_id, image_path, position, created_at");

  if (photoError || !photoData) {
    // Roll back: delete the meals row (cascade clears any meal_photos that
    // did land), then clean up storage.
    // Supabase query builders are PromiseLike, not Promise — `.catch` won't
    // type-check directly, so wrap in try/catch.
    try { await supabase.from("meals").delete().eq("id", mealId); } catch {}
    await supabase.storage.from("meal-photos").remove(imagePaths).catch(() => {});
    throw new Error(`meal_photos insert failed: ${photoError?.message ?? "no data returned"}`);
  }

  // Drain any older queued meals opportunistically.
  void syncQueue(supabase);

  return {
    mealId,
    imagePath: inserted.image_path as string,
    category: inserted.category as Category,
    createdAt: inserted.created_at as string,
    photos: (photoData as MealPhotoRow[])
      .slice()
      .sort((a, b) => a.position - b.position),
  };
}

// ── Offline branch ────────────────────────────────────────────────────────────

async function captureOffline(opts: BranchOpts): Promise<CaptureResult> {
  const { blobs, category, userId, supabase } = opts;

  const localId = generateLocalId();
  const createdAt = new Date().toISOString();

  await enqueueMeal({
    localId,
    userId,
    category,
    blobs,
    createdAt,
  });

  // Synthetic photo rows so the dashboard can render the carousel
  // immediately. image_path uses a "queued:<localId>:<position>" sentinel
  // so MealCard's signed-URL path fails fast if someone forgets to check
  // `pending` — MealCard handles the queued case by pulling blobs from IDB.
  const photos: MealPhotoRow[] = blobs.map((_, position) => ({
    id: `${localId}:${position}`,
    meal_id: localId,
    image_path: `queued:${localId}:${position}`,
    position,
    created_at: createdAt,
  }));

  // Opportunistic sync covers the rare case where the browser reported
  // offline but the network came back during compression.
  void syncQueue(supabase);

  return {
    mealId: localId,
    imagePath: photos[0].image_path,
    category,
    createdAt,
    photos,
    pending: true,
  };
}
