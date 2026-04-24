/**
 * queue.ts — IndexedDB adapter for the offline meal capture queue.
 *
 * Stores compressed JPEG blobs + capture metadata so captures taken while
 * `navigator.onLine === false` can be drained to Supabase when connectivity
 * returns. Uses the native IndexedDB API — no `idb` wrapper — because the
 * footprint we need is tiny (one object store, six CRUD operations) and
 * shipping an extra dependency isn't worth the ergonomic win here.
 *
 * DB shape:
 *   name:    "dietlens"
 *   version: 1
 *   store:   "meals_queue"  (keyPath: "localId")
 *
 * FIFO order is maintained implicitly by `createdAt` (ISO timestamp assigned
 * at enqueue time). `listQueue()` sorts ascending on this field — do NOT rely
 * on IndexedDB cursor order, which is by keyPath (localId, a UUID) and thus
 * effectively random.
 *
 * Concurrency: a single memoized DB handle is reused across calls. The
 * `onversionchange` listener closes the handle gracefully if another tab
 * opens the DB with a higher version so we don't block an upgrade.
 */

import type { Category } from "@/lib/supabase/types";

// ── Types ────────────────────────────────────────────────────────────────────

export interface QueuedMeal {
  /** UUID — used as the optimistic MealRow.id before the server assigns one */
  localId: string;
  userId: string;
  category: Category;
  /** The compressed JPEG blob produced by `compressImage` */
  blob: Blob;
  /** ISO 8601 timestamp assigned when this entry was enqueued */
  createdAt: string;
  /** Number of sync attempts so far — used for retry cap */
  attempts: number;
  /** ISO timestamp of the most recent failed attempt (or null) */
  lastAttemptAt: string | null;
}

// ── Constants ────────────────────────────────────────────────────────────────

const DB_NAME = "dietlens";
const DB_VERSION = 1;
const STORE_NAME = "meals_queue";

/**
 * Prefix used to distinguish an optimistic localId from a real server UUID.
 * When swapping placeholder MealRows in the dashboard, consumers can check
 * `meal.id.startsWith(LOCAL_ID_PREFIX)` to decide whether a "Queued" badge
 * should be drawn. Kept in this module so the queue owns the invariant.
 */
export const LOCAL_ID_PREFIX = "local-";

/** Generates a unique localId with the canonical prefix. */
export function generateLocalId(): string {
  return `${LOCAL_ID_PREFIX}${crypto.randomUUID()}`;
}

// ── DB handle (memoized) ─────────────────────────────────────────────────────

let _dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Opens (or reuses) the dietlens IndexedDB connection.
 *
 * The returned promise is memoized so callers don't spin up multiple
 * concurrent open requests. If another tab triggers a version change, we
 * close our handle and clear the cache so the next call re-opens cleanly.
 */
export function initQueueDb(): Promise<IDBDatabase> {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") {
    return Promise.reject(
      new Error("IndexedDB is only available in browser environments")
    );
  }

  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        // keyPath "localId" makes get/put/delete keyless — the entry carries
        // its own id. An index on createdAt would speed up FIFO reads on
        // very large queues, but the realistic N is <100 so a full scan +
        // JS sort is simpler and avoids the index maintenance overhead.
        db.createObjectStore(STORE_NAME, { keyPath: "localId" });
      }
    };

    req.onsuccess = () => {
      const db = req.result;

      // If another tab upgrades the schema, close our handle so we don't
      // block them and drop the memoized promise so the next call re-opens.
      db.onversionchange = () => {
        db.close();
        _dbPromise = null;
      };

      // If the handle is closed for any other reason (e.g. browser storage
      // eviction on mobile), also drop the memo so we don't serve a dead
      // connection to the next caller.
      db.onclose = () => {
        _dbPromise = null;
      };

      resolve(db);
    };

    req.onerror = () => {
      _dbPromise = null;
      reject(
        req.error ??
          new Error("Failed to open IndexedDB — private browsing or storage full?")
      );
    };

    req.onblocked = () => {
      // Another tab holds an older version open. We don't reject here because
      // Chrome will fire onsuccess once the other tab closes; the user-visible
      // symptom is just a brief delay on first capture.
    };
  });

  return _dbPromise;
}

// ── CRUD helpers ─────────────────────────────────────────────────────────────

/**
 * Wraps an IDBRequest in a Promise. Kept local — the wrapper surface is small
 * enough that pulling in `idb` would be overkill.
 */
function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

/**
 * Adds a new meal to the queue. `attempts` starts at 0, `lastAttemptAt` at null.
 * Accepts the user-facing fields only so callers can't accidentally seed with
 * stale retry counters.
 */
export async function enqueueMeal(
  meal: Omit<QueuedMeal, "attempts" | "lastAttemptAt">
): Promise<void> {
  const db = await initQueueDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);

  const entry: QueuedMeal = {
    ...meal,
    attempts: 0,
    lastAttemptAt: null,
  };

  await requestToPromise(store.put(entry));
  await txComplete(tx);
}

/**
 * Returns all queued meals sorted FIFO (oldest first) by `createdAt`.
 * Sort is done in JS — see comment in initQueueDb() about why there's no
 * secondary index.
 */
export async function listQueue(): Promise<QueuedMeal[]> {
  const db = await initQueueDb();
  const tx = db.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);
  const all = await requestToPromise(store.getAll() as IDBRequest<QueuedMeal[]>);
  await txComplete(tx);
  return all.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Removes a meal from the queue by localId. Safe no-op if the entry is gone. */
export async function removeFromQueue(localId: string): Promise<void> {
  const db = await initQueueDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  await requestToPromise(store.delete(localId));
  await txComplete(tx);
}

/**
 * Partial-updates a queue entry. Used by the sync loop to bump `attempts`
 * and `lastAttemptAt` after a failure without rewriting the blob.
 *
 * If the entry no longer exists (e.g. deleted in a concurrent sync) this is
 * a no-op rather than an error — the caller would have nothing to do with it.
 */
export async function updateQueueEntry(
  localId: string,
  updates: Partial<QueuedMeal>
): Promise<void> {
  const db = await initQueueDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);

  const existing = await requestToPromise(
    store.get(localId) as IDBRequest<QueuedMeal | undefined>
  );
  if (!existing) {
    await txComplete(tx);
    return;
  }

  // Preserve the keyPath — spreading `updates` could theoretically overwrite
  // localId with undefined and break the put. Re-assert the localId last.
  const merged: QueuedMeal = { ...existing, ...updates, localId };
  await requestToPromise(store.put(merged));
  await txComplete(tx);
}

/** Total entries in the queue — used by the banner hook. */
export async function getQueueLength(): Promise<number> {
  const db = await initQueueDb();
  const tx = db.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);
  const count = await requestToPromise(store.count());
  await txComplete(tx);
  return count;
}

// ── Tx completion helper ─────────────────────────────────────────────────────

/**
 * Awaits the `complete`/`error`/`abort` event on an IDB transaction.
 * IDB doesn't give us a promise for transactions, and even successful
 * requests within a tx can still roll back if the tx itself errors. We
 * await this at the end of every helper so callers get a truthful resolve.
 */
function txComplete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}
