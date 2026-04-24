"use client";

import { useEffect, useState } from "react";
import { useAnonSession } from "@/lib/auth/anon-session";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { CATEGORIES, type Category } from "@/lib/supabase/types";
import { AlbumTile } from "@/components/album-tile";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface AlbumSummary {
  category: Category;
  count: number;
  latestImagePath: string | null;
}

// ---------------------------------------------------------------------------
// Default (zero-state) summaries — shown while session is loading or on error
// ---------------------------------------------------------------------------
const ZERO_ALBUMS: AlbumSummary[] = CATEGORIES.map((c) => ({
  category: c,
  count: 0,
  latestImagePath: null,
}));

// ---------------------------------------------------------------------------
// AlbumsPage
// ---------------------------------------------------------------------------
export default function AlbumsPage() {
  const { session } = useAnonSession();
  const [albums, setAlbums] = useState<AlbumSummary[] | null>(null);

  useEffect(() => {
    if (!session) return;

    /*
      Fetch all meals for this device/user in one round-trip, then group
      client-side. For the MVP (a few hundred rows max per anon user) this is
      simpler than a DB view or RPC. Add an rpc("album_summaries") call later
      if the row count grows meaningfully.

      Order DESC so rows[0] for each category is the most recent photo.
    */
    const supabase = getSupabaseBrowserClient();

    supabase
      .from("meals")
      .select("id, category, image_path, created_at")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error || !data) {
          // Graceful fallback: show zero-state rather than error screen
          setAlbums(ZERO_ALBUMS);
          return;
        }

        const summaries: AlbumSummary[] = CATEGORIES.map((cat) => {
          const rows = data.filter((r) => r.category === cat);
          return {
            category: cat,
            count: rows.length,
            latestImagePath: rows[0]?.image_path ?? null,
          };
        });

        setAlbums(summaries);
      });
  }, [session]);

  // Show zero-state skeleton while loading — tiles render with empty slots
  const displayAlbums = albums ?? ZERO_ALBUMS;

  return (
    <div
      style={{
        paddingLeft: "var(--space-counter)",   // 24px
        paddingRight: "var(--space-counter)",  // 24px
        paddingTop: "var(--space-room)",       // 40px
      }}
    >
      {/* ── Archive header ──────────────────────────────────────
          Feels like a hand-labeled divider in a filing drawer.
          Not a dashboard title — an archivist's marking.
      ──────────────────────────────────────────────────────────── */}
      <header
        style={{
          marginBottom: "var(--space-shelf)",  // 32px to grid
        }}
      >
        {/* Drawer label line — a thin warm-grain rule above the title */}
        <div
          aria-hidden="true"
          style={{
            height: "1px",
            background: "var(--border-crumb)",
            marginBottom: "var(--space-bite)",  // 8px
            width: "40px",
          }}
        />

        <h1
          style={{
            fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
            fontVariationSettings: '"opsz" 144, "SOFT" 100, "wght" 500',
            fontSize: "clamp(28px, 8vw, 36px)",
            letterSpacing: "var(--tracking-tight)",
            lineHeight: 1.1,
            color: "var(--fg-crema)",
            margin: 0,
          }}
        >
          Albums
        </h1>

        <p
          style={{
            color: "var(--fg-smoke)",
            fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
            fontVariationSettings: '"opsz" 24, "SOFT" 100, "wght" 400',
            fontSize: "13px",
            marginTop: "var(--space-crumb)",    // 4px — tight under the title
            marginBottom: 0,
            letterSpacing: "0.01em",
          }}
        >
          Every meal, filed by the hand.
        </p>
      </header>

      {/* ── Contact-sheet grid ──────────────────────────────────
          2 columns, portrait tiles — a drawer of filed photos,
          not a dashboard of cards. Tiles carry slight rotation
          (applied inside AlbumTile) to reinforce the hand-placed feel.
      ──────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: "var(--space-tray)",    // 20px — card-to-card gap
          paddingBottom: "var(--space-room)",  // 40px breathing room above nav
        }}
      >
        {displayAlbums.map((album) => (
          <AlbumTile key={album.category} {...album} />
        ))}
      </div>

      {/* ── Footer filing note ──────────────────────────────────
          A subtle archivist's note: total meal count across categories.
          Only shown once albums are loaded (not zero-state).
      ──────────────────────────────────────────────────────────── */}
      {albums !== null && (
        <footer
          style={{
            textAlign: "center",
            paddingBottom: "var(--space-shelf)",
            paddingTop: "var(--space-crumb)",
          }}
        >
          <span
            style={{
              color: "var(--fg-smoke)",
              fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
              fontVariationSettings: '"opsz" 11, "SOFT" 100, "wght" 400',
              fontFeatureSettings: '"tnum"',
              fontSize: "11px",
              letterSpacing: "0.04em",
              userSelect: "none",
            }}
          >
            {(() => {
              const total = albums.reduce((sum, a) => sum + a.count, 0);
              if (total === 0) return "No meals filed yet.";
              if (total === 1) return "1 meal in the archive.";
              return `${total} meals in the archive.`;
            })()}
          </span>
        </footer>
      )}
    </div>
  );
}
