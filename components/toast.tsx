"use client";

/**
 * toast.tsx — minimal, on-brand toast primitive for DietLens
 *
 * Design intent:
 *   - Slides up from the bottom, positioned above the FAB + nav so it doesn't
 *     collide. bottom offset = safe-area + nav (56px) + FAB height (64px) + gap (16px).
 *   - Dark surface (--bg-skillet-edge), crema text, Fraunces for the category
 *     name embedded in the message, Inter Tight for supporting copy.
 *   - Auto-dismisses after `duration` ms (default 2000).
 *   - Single-instance: a new toast replaces the previous one immediately.
 *
 * Usage:
 *   // In layout.tsx (once, top-level):
 *   <ToastHost />
 *
 *   // From any client code:
 *   showToast({ message: "Logged to Breakfast", icon: "check" });
 */

import { useEffect, useState, useCallback } from "react";

// ── Event bus ─────────────────────────────────────────────────────────────────

export interface ToastEvt {
  message: string;
  icon?: "check" | "error";
  duration?: number;
}

// Module-scoped listener set — zero dependencies, no context/provider needed.
const listeners = new Set<(e: ToastEvt) => void>();

export function showToast(evt: ToastEvt): void {
  listeners.forEach((l) => l(evt));
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function CheckIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="8" cy="8" r="7.25" stroke="var(--scorched-green)" strokeWidth="1.5" />
      <path
        d="M4.5 8.25 L7 10.75 L11.5 5.75"
        stroke="var(--scorched-green)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="8" cy="8" r="7.25" stroke="var(--smoked-brick)" strokeWidth="1.5" />
      <path
        d="M8 4.5 L8 8.5"
        stroke="var(--smoked-brick)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="8" cy="11" r="0.75" fill="var(--smoked-brick)" />
    </svg>
  );
}

// ── ToastHost ─────────────────────────────────────────────────────────────────

interface ToastState {
  evt: ToastEvt;
  key: number;
}

export function ToastHost() {
  const [current, setCurrent] = useState<ToastState | null>(null);
  const [visible, setVisible] = useState(false);

  // Dismiss helper — always stable across renders
  const dismiss = useCallback(() => {
    setVisible(false);
    // Remove from DOM after the exit transition
    const t = setTimeout(() => setCurrent(null), 260);
    return t;
  }, []);

  useEffect(() => {
    let dismissTimer: ReturnType<typeof setTimeout> | null = null;

    function handleToast(evt: ToastEvt) {
      // Cancel any in-flight auto-dismiss before replacing
      if (dismissTimer !== null) clearTimeout(dismissTimer);

      const key = Date.now();
      setCurrent({ evt, key });
      // RAF to allow the new element to mount before triggering CSS transition
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });

      const duration = evt.duration ?? 2000;
      dismissTimer = setTimeout(() => {
        setVisible(false);
        dismissTimer = setTimeout(() => setCurrent(null), 260);
      }, duration);
    }

    listeners.add(handleToast);
    return () => {
      listeners.delete(handleToast);
      if (dismissTimer !== null) clearTimeout(dismissTimer);
    };
  }, [dismiss]);

  if (!current) return null;

  const { message, icon } = current.evt;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      key={current.key}
      style={{
        // Positioned above the FAB ring:
        //   safe-area + nav (56px) + FAB (64px) + gap (16px) = 136px baseline
        position: "fixed",
        bottom: "calc(env(safe-area-inset-bottom) + 56px + 64px + 16px)",
        left: "50%",
        transform: visible
          ? "translateX(-50%) translateY(0)"
          : "translateX(-50%) translateY(20px)",
        zIndex: 70,

        // Surface
        background: "var(--bg-skillet-edge)",
        border: "1px solid var(--border-ember)",
        borderRadius: "var(--radius-polaroid)",
        boxShadow: "0 4px 24px rgba(0,0,0,0.6)",

        // Layout
        display: "flex",
        alignItems: "center",
        gap: "var(--space-bite)",
        paddingInline: "var(--space-counter)",
        paddingBlock: "var(--space-sip)",
        maxWidth: "calc(100vw - 48px)",

        // Transition
        opacity: visible ? 1 : 0,
        transition: `
          opacity 220ms var(--ease-out),
          transform 220ms var(--ease-shutter)
        `,

        // Prevent user interaction from accidentally triggering beneath
        pointerEvents: "none",
        userSelect: "none",
      }}
    >
      {/* Icon */}
      {icon === "check" && <CheckIcon />}
      {icon === "error" && <ErrorIcon />}

      {/* Message text */}
      <span
        style={{
          fontFamily:
            "var(--font-inter-tight), ui-sans-serif, system-ui, sans-serif",
          fontSize: "13px",
          lineHeight: 1.45,
          color: "var(--fg-thermal-paper)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {message}
      </span>
    </div>
  );
}
