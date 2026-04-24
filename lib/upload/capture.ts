/**
 * capture.ts — end-to-end meal capture pipeline
 *
 * compress → (online) generate path → upload to Supabase Storage → insert meals row
 *         → (offline) enqueue blob in IndexedDB, dispatch optimistic event,
 *           let the offline sync bootstrap drain it later.
 *
 * This module is browser-only. All functions must be called from client
 * components or event handlers (never server code).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { compressImage } from "@/lib/image/compress";
import type { Category } from "@/lib/supabase/types";
import {
  enqueueMeal,
  generateLocalId,
} from "@/lib/offline/queue";
import { syncQueue } from "@/lib/offline/sync";

// ── Types ────────────────────────────────────────────────────────────────────

export interface CaptureOptions {
  file: File;
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
  imagePath: string;
  category: Category;
  createdAt: string;
  /**
   * True when this result is backed only by the local IndexedDB queue
   * (offline capture). The dashboard uses this flag to render a "Queued"
   * badge and to know that the card should be swapped out when the
   * corresponding `meal:synced` event fires.
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
 *   2. Branch on `navigator.onLine`:
 *      - ONLINE: upload → insert → return server result.
 *      - OFFLINE: enqueue blob + metadata in IndexedDB, return an
 *                 optimistic result carrying the localId as mealId and
 *                 `pending: true`. The dashboard will render this as a
 *                 card with the "Queued" badge until sync fires
 *                 `meal:synced`.
 *   3. Either branch opportunistically kicks off `syncQueue(...)` at the
 *      end. When online, this is a cheap no-op if the queue is empty; when
 *      offline, `syncQueue` returns immediately without touching the
 *      network.
 *
 * Throws with a human-readable message on any step failure in the ONLINE
 * path. The OFFLINE path only throws if compression or IDB write fails —
 * a network error after going offline can't happen because we don't hit
 * the network at all.
 *
 * HEIC files are rejected by compressImage before any network or IDB call.
 */
export async function captureAndUploadMeal(
  opts: CaptureOptions
): Promise<CaptureResult> {
  const { file, category, userId, supabase } = opts;

  // ── Step 1: Compress ──────────────────────────────────────────────────────
  // Always compress — the offline path stores the compressed JPEG so the
  // user's device isn't carrying 12MB originals around. compressImage
  // throws for HEIC/HEIF files with a user-facing message and cleans up the
  // object URL it creates internally via finally{}.
  const { blob } = await compressImage(file, {
    maxDimension: 1600,
    targetKB: 300,
    mimeType: "image/jpeg",
  });

  // ── Step 2: Branch on connectivity ────────────────────────────────────────
  // We check navigator.onLine at the call site (after compression) rather
  // than at the start of the function. Compression takes ~500ms for a
  // typical photo; if the user went offline during that window we want to
  // pick up on it rather than trying an upload that's guaranteed to fail.
  const isOffline = typeof navigator !== "undefined" && navigator.onLine === false;

  if (isOffline) {
    return captureOffline({ blob, category, userId, supabase });
  }

  return captureOnline({ blob, category, userId, supabase });
}

// ── Online branch ─────────────────────────────────────────────────────────────

interface BranchOpts {
  blob: Blob;
  category: Category;
  userId: string;
  supabase: SupabaseClient;
}

async function captureOnline(opts: BranchOpts): Promise<CaptureResult> {
  const { blob, category, userId, supabase } = opts;

  const imagePath = generateImagePath(userId);

  // Upload compressed JPEG
  const { error: uploadError } = await supabase.storage
    .from("meal-photos")
    .upload(imagePath, blob, {
      contentType: "image/jpeg",
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`upload failed: ${uploadError.message}`);
  }

  // Insert the meals row
  const { data: inserted, error: insertError } = await supabase
    .from("meals")
    .insert({ user_id: userId, image_path: imagePath, category })
    .select("id, image_path, category, created_at")
    .single();

  if (insertError) {
    // Row insert failed — remove the orphaned storage object so we don't
    // accumulate unreferenced blobs. Best-effort; ignore cleanup error.
    await supabase.storage.from("meal-photos").remove([imagePath]).catch(() => {
      // intentionally silent — the cleanup is best-effort
    });
    throw new Error(`db insert failed: ${insertError.message}`);
  }

  if (!inserted) {
    throw new Error("db insert returned no data");
  }

  // Opportunistic drain of any older queued meals. Cheap no-op if empty.
  // Runs after our own success so the user's freshly-logged card lands
  // first and THEN any stragglers follow — preserves the rough sense of
  // newest-first ordering on the dashboard.
  void syncQueue(supabase);

  return {
    mealId: inserted.id as string,
    imagePath: inserted.image_path as string,
    category: inserted.category as Category,
    createdAt: inserted.created_at as string,
  };
}

// ── Offline branch ────────────────────────────────────────────────────────────

async function captureOffline(opts: BranchOpts): Promise<CaptureResult> {
  const { blob, category, userId, supabase } = opts;

  const localId = generateLocalId();
  const createdAt = new Date().toISOString();

  await enqueueMeal({
    localId,
    userId,
    category,
    blob,
    createdAt,
  });

  // The imagePath field is populated with a sentinel because no real storage
  // path exists yet — sync will mint one at upload time. Consumers that
  // respect `pending: true` MUST NOT try to resolve this against Supabase
  // storage. MealCard handles this by rendering the blob-backed preview
  // via the image_path sentinel instead of a signed URL.
  //
  // We prefix with "queued:" so any accidental signed-URL call fails fast
  // rather than succeeds against an unrelated object.
  const imagePath = `queued:${localId}`;

  // Opportunistic sync — covers the rare case where the user was marked
  // offline by navigator.onLine but the network actually came back by the
  // time we got here. Cheap no-op otherwise (syncQueue checks onLine
  // itself before doing any work).
  void syncQueue(supabase);

  return {
    mealId: localId,
    imagePath,
    category,
    createdAt,
    pending: true,
  };
}
