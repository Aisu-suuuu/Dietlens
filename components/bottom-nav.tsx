"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Today" },
  { href: "/albums", label: "Albums" },
] as const;

/**
 * BottomNav — two-item persistent navigation.
 * Fixed to the bottom of the viewport; respects iOS safe area.
 * Active state is driven by usePathname().
 * All colors come from design tokens via Tailwind theme keys
 * (bg-bg, text-fg, text-fg-muted, border-border) — no hardcoded hex.
 */
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 inset-x-0 border-t border-border bg-bg/90 backdrop-blur-sm z-40"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="flex" role="list">
        {ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                className={[
                  "flex items-center justify-center",
                  "min-h-[44px] py-3",
                  "text-sm tracking-wide font-body",
                  "transition-colors duration-150",
                  active ? "text-fg" : "text-fg-muted hover:text-fg",
                ].join(" ")}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
