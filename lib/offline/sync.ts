/**
 * sync.ts — Drains the offline meals queue to Supabase.
 *
 * Behavior contract:
 *   - Reads queue FIFO (oldest createdAt first).
 *   - For each entry: upload blob → insert `meals` row.
 *     - Upload success + DB insert failure: keep the entry (with attempts++)
 *       and DELETE the orphaned storage object so the next retry can try
 *       again from scratch with a fresh path. Keeping both the queue entry
 *       AND the orphan would mean the next upload hits a "path exists"
 *       conflict, because the storage RLS policy disallows upsert.
 *     - Upload failure: keep the entry (with attempts++). Stop the whole
 *       sync — one failure almost always means the network is down again,
 *       and hammering it wastes battery + risks rate limits on the free tier.
 *   - On success: removeFromQueue + dispatch `"meal:synced"` so the dashboard
 *     can swap the optimistic MealRow for the server-authoritative one.
 *   - Retry cap: any entry with `attempts >= MAX_ATTEMPTS` whose last attempt
 *     was < COOLDOWN_MS ago is skipped. This yields a "permanent queue"
 *     (dead-letter) the user can retry manually by coming back later — the
 *     cooldown lets a persistent failure breathe before we try again at all.
 *
 * Re-entrancy: a module-level Promise acts as a mutex. If a second caller
 * comes in while a drain is running (e.g. online event + visibilitychange
 * both firing in quick succession), it awaits the existing run instead of
 * starting a parallel one. Serial upload is a design requirement — see the
 * task spec under "FIFO sync".
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Category } from "@/lib/supabase/types";
import {
  listQueue,
  removeFromQueue,
  updateQueueEntry,
  type QueuedMeal,
} from "@/lib/offline/queue";
import { generateImagePath } from "@/lib/upload/capture";

// ── Tuning knobs ─────────────────────────────────────────────────────────────

/** Max sync attempts before the entry is considered "permanently queued". */
const MAX_ATTEMPTS = 5;

/**
 * How long to wait after a failed attempt before we're willing to try the
 * entry again within the same MAX_ATTEMPTS budget. 30 seconds is long enough
 * to rule out a transient network blip without stranding the user forever.
 */
const COOLDOWN_MS = 30_000;

// ── Result shape ─────────────────────────────────────────────────────────────

export interface SyncResult {
  /** Entries that made it fully to the server (and left the queue) */
  synced: number;
  /** Entries that failed this run (still in queue, attempts bumped) */
  failed: number;
  /** Total entries still in the queue after this run */
  remaining: number;
}

// ── Mutex ────────────────────────────────────────────────────────────────────

let _inflight: Promise<SyncResult> | null = null;

/**
 * Drains the offline queue to Supabase. Safe to call opportunistically —
 * if a sync is already running, the second call simply awaits its result.
 */
export function syncQueue(supabase: SupabaseClient): Promise<SyncResult> {
  if (_inflight) return _inflight;

  _inflight = runSync(supabase).finally(() => {
    _inflight = null;
  });

  return _inflight;
}

async function runSync(supabase: SupabaseClient): Promise<SyncResult> {
  let synced = 0;
  let failed = 0;

  // If we're offline, don't even touch IndexedDB — saves a disk read and
  // prevents a spurious "failed" bump on a known-down network.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    const remaining = (await listQueue()).length;
    return { synced, failed, remaining };
  }

  const queue = await listQueue();

  for (const entry of queue) {
    // Dead-letter guard: if we've already hit the cap and the last attempt
    // was recent, skip. If enough time has passed, we give it one more go —
    // the user may have fixed something (e.g. re-auth, reconnect) and
    // expects the queue to try again.
    if (entry.attempts >= MAX_ATTEMPTS) {
      const last = entry.lastAttemptAt ? Date.parse(entry.lastAttemptAt) : 0;
      if (Date.now() - last < COOLDOWN_MS) {
        continue;
      }
    }

    const outcome = await syncOne(supabase, entry);

    if (outcome === "success") {
      synced++;
      continue;
    }

    // Any failure bumps attempts + stops the drain. The stop matters: a 401
    // or a dropped connection will recur on entry N+1 anyway, and we'd
    // rather surface one retry in the banner than burn through all of them.
    failed++;
    await updateQueueEntry(entry.localId, {
      attempts: entry.attempts + 1,
      lastAttemptAt: new Date().toISOString(),
    }).catch(() => {
      // If even the update fails (e.g. DB evicted), there's nothing useful
      // to do — next sync will just re-read the stale entry.
    });

    break;
  }

  const remaining = (await listQueue()).length;
  return { synced, failed, remaining };
}

// ── Per-entry drain ──────────────────────────────────────────────────────────

type SyncOutcome = "success" | "upload-failed" | "insert-failed";

async function syncOne(
  supabase: SupabaseClient,
  entry: QueuedMeal
): Promise<SyncOutcome> {
  // Generate a fresh storage path on each attempt. Retrying with the same
  // path would collide with an earlier partial upload (upsert is disabled
  // by the RLS policy on `meal-photos`), and paths are cheap.
  const imagePath = generateImagePath(entry.userId);

  // ── Upload blob ─────────────────────────────────────────────────────────────
  const { error: uploadError } = await supabase.storage
    .from("meal-photos")
    .upload(imagePath, entry.blob, {
      contentType: "image/jpeg",
      upsert: false,
    });

  if (uploadError) {
    return "upload-failed";
  }

  // ── Insert row ──────────────────────────────────────────────────────────────
  // If this fails (RLS mismatch, column rename, etc.) we clean up the orphan
  // storage object so a retry from the top isn't blocked by a stale upload.
  const { data: inserted, error: insertError } = await supabase
    .from("meals")
    .insert({
      user_id: entry.userId,
      image_path: imagePath,
      category: entry.category,
      // Preserve the user's local capture time — otherwise every meal synced
      // after a long offline gap would collapse to "right now" in the feed.
      created_at: entry.createdAt,
    })
    .select("id, image_path, category, created_at")
    .single();

  if (insertError || !inserted) {
    await supabase.storage
      .from("meal-photos")
      .remove([imagePath])
      .catch(() => {
        // Best-effort cleanup; the orphan is acceptable vs. a hard failure here.
      });
    return "insert-failed";
  }

  // ── Success path ────────────────────────────────────────────────────────────
  // Only now — after the DB has the row — do we drop the queue entry. If the
  // tab dies between the insert and this delete, the worst case is one extra
  // row gets inserted on next sync, which is recoverable (the user can
  // delete the dupe from MealActions).
  await removeFromQueue(entry.localId);

  // Broadcast so the dashboard + album views can swap the optimistic card.
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<{ localId: string; mealId: string; path: string; createdAt: string; category: Category }>(
        "meal:synced",
        {
          detail: {
            localId: entry.localId,
            mealId: inserted.id as string,
            path: inserted.image_path as string,
            createdAt: inserted.created_at as string,
            category: inserted.category as Category,
          },
        }
      )
    );
  }

  return "success";
}
