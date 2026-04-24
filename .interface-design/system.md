# DietLens — Design System

Source of truth for Sprints 2 & 3. Tokens live in `/styles/tokens.css`.
Read this before writing any UI. Every component decision must trace back here.

---

## 1. Intent

**Who is this human.**
Someone mid-meal. Phone in one hand, food (or chopsticks, or a fork, or a child's hand) in the other. They are not in a quiet office — they are in a kitchen at 7am, a restaurant at 9pm, a gym locker after a deadlift set, or in bed with late-night dal. They open DietLens 3–6 times a day and spend about 10 seconds per visit. The app is never the thing they're doing; it's the thing *between* what they're doing and their memory of it.

**What must they accomplish.**
1. **Pocket this meal** — snap, tag category, done. Friction budget: ≤3 taps, ≤10 seconds.
2. **Glance at today** — "did I actually eat breakfast?" answered in under 2 seconds.
3. **Occasionally revisit** — open Albums and browse "what did dinner look like in March?"

The active verb is **pocket**, not "log" and not "track." Logging is accounting. Pocketing is what you do with a receipt before the wind takes it.

**How should it feel.**
Like wiping your mouth with a napkin. Done before you thought about doing it.
Closer qualities: a **contact sheet in a darkroom** — warm-dim, amber-lit, photos are the only bright things in the frame. Or a **diner at 6am** — steel counter, one warm bulb, everything is quiet, the photo of the plate is what you remember.

NOT: clean, modern, sleek, minimal, productive, dashboard-y, gamified, trackable. Those words describe other apps.

---

## 2. Domain Exploration — the food/capture/memory world

Not features — territory. Five-plus concepts this product's world contains:

1. **Contact sheet / darkroom.** Strips of photos under amber safelight; images appear one at a time as the chemistry develops. Timestamps scribbled on the edge in grease pencil.
2. **Receipt roll.** Thermal paper curling out of a till. Warm cream, never pure white. Times printed down the side. A physical log you shove in a pocket and find again months later.
3. **Seasoned cast iron.** A black pan that's actually warm-black, not cold. Built up over years. The character is in the patina, not the sheen.
4. **Polaroid in a glovebox.** Faded edge, thumbprint on the border, category written on the white strip at the bottom. Kept, not curated.
5. **Kitchen at 6am.** One warm overhead bulb, steel counter, everything else still dark. The light source is small and yellow.
6. **Spice tin with tape label.** Matte tin, hand-torn masking tape, "jeera" written in Sharpie. Stacked. Functional and affectionate at once.
7. **Menu chalkboard.** Flat black board, white chalk, smudges where something was erased. Typography that's hand-made, slightly uneven, readable because someone cared.

These set the emotional register before any pixel. The interface should feel borrowed from this world, not imposed on it.

---

## 3. Color World — colors that naturally exist here

Five-plus colors FROM the domain, not applied TO it. These are what you'd see if you walked into the space.

| Color | Hex | One-word vibe | Role |
|---|---|---|---|
| **Cast-iron** | `#0E0B0A` | seasoned | Canvas bg — warmer than `#000`, pan left on low heat |
| **Stove-black** | `#151211` | deeper | Elevation +1 — deeper in the pan |
| **Ember-black** | `#1C1816` | glowing | Elevation +2 — coals underneath |
| **Skillet-edge** | `#262220` | worn | Elevation +3 — handle of the pan |
| **Crema** | `#E8C79A` | golden | Primary text / highlight — espresso foam |
| **Thermal-paper** | `#F2EBDD` | warm | Secondary text — fresh receipt, never white |
| **Chalk-dust** | `#9A948A` | ghosted | Tertiary text — erased chalk on a menu board |
| **Smoke** | `#615B53` | faded | Muted / disabled — old dried herb |
| **Safelight** | `#E07B3A` | protective | Brand / FAB ring — darkroom amber-orange |
| **Safelight-warm** | `#F39457` | hovered | Brand hover — lamp flared |
| **Smoked-brick** | `#7E3324` | charred | Destructive — dried tomato on a ladle |
| **Honey-dark** | `#B8862A` | cured | Warning — aged honey |
| **Scorched-green** | `#5B7051` | blanched | Success — charred scallion tip (cold accent, rare) |

Deliberate: the palette has **one cold color** (scorched-green), used sparingly for success. Every other token carries warmth. Food photography needs a warm envelope — cold neutrals make food look refrigerated.

---

## 4. Signature Element

**The masking-tape category label.**

Every meal card displays its category (Breakfast, Lunch, Dinner, Snack, Mid-Morning, Post-Workout) not as a rounded pill chip, not as a text tag — as a **strip of masking tape** stuck to the top-left corner of the photograph:

- Thermal-paper cream background (`#F2EBDD`)
- Soft inner shadow at the edges (tape has thickness)
- Category written in Fraunces at `font-opsz: 9` + `SOFT: 100` + `weight: 500`, cast-iron ink
- Rotated **0.8°** — never perfectly square. Human hands don't stick tape straight.
- 2px radius corners — tape tears don't round, but 2px keeps it from looking digitally sharp

The tape sticks on insert with a 180ms ease-shutter. Six categories, six tape positions (slight angle variance per category so the Albums grid doesn't feel robotic).

**Secondary signatures that reinforce it:**
- **Shutter FAB.** Bottom-center (not bottom-right — thumb reach when the other hand is occupied). 64px. A crema ring around a cast-iron center. On press, the ring pulses inward 380ms like a camera shutter closing. No plus icon — the ring IS the shutter.
- **Chalked timestamp.** Inside each photo, bottom-right corner, time written in Fraunces at 11px, 50% crema — like it was chalked onto the print.

The signature test: point to these three things — tape label, shutter ring, chalked timestamp. Each is locatable on the interface.

---

## 5. Defaults Rejected

Three clichés the lazy version of this app would ship, and what replaces each.

**1. Pure `#000` canvas + `#222` borders (Vercel-core verbatim).**
Replaced with **cast-iron `#0E0B0A`** canvas and borders made of **crema at 6–10% alpha** (`rgba(232, 199, 154, 0.08)`). The PRD's intent — dark, minimal, confident — is preserved. The temperature is corrected. Cold engineering-grey makes food look like a morgue photo. Warm black makes it look like dinner.

**2. Rounded meal cards with a metadata row (image top, title + kcal + time in a tidy grid below).**
Replaced with **photo-forward contact-sheet strips.** 4:5 image fills the card edge-to-edge, 10px radius (Polaroid), tape-label top-left, chalked-timestamp bottom-right — both overlaid on the photo. No metadata row. No title. No calorie count (the PRD doesn't ask for it, and a user mid-bite doesn't want it). The photo is the memory; everything else is chrome.

**3. Circular brand-colored FAB plus icon in bottom-right.**
Replaced with the **shutter button** described above: bottom-center, crema ring, no icon, shutter-close animation on press. Bottom-right is a right-handed-desktop convention that fails a thumb holding a phone with one hand while chopsticks are in the other. Bottom-center respects both hands.

---

## 6. Depth Strategy — Surface Tints

**Chosen:** surface tints (progressive warm lightness shifts), NOT shadows, NOT borders-only, NOT layered shadows.

**Why this fits the intent:**
- Shadows on dark backgrounds disappear — the hint doesn't register.
- Borders-only fragments a photo-forward UI; hard edges compete with the photographs.
- Layered shadows read as corporate/SaaS — wrong register entirely.
- **Surface tints** mirror how things look in low kitchen light: you perceive layered objects by the way warm light falls on each plane, not by outlines. You see the *edge of the pan* because it reflects more lamp than the *bottom of the pan* — not because someone drew a line.

Scale (see tokens): cast-iron → stove-black (+2% lightness, +1 warmth) → ember-black → skillet-edge. Four steps, each ~2–4% brighter. Dropdowns/popovers sit one elevation above their trigger. Inputs sit one step *darker* than their container (inputs are inset — they receive content, like a bowl you pour into).

Borders are used sparingly for **functional structure** (focus rings, masking-tape edge indication, Albums grid separation) and always rendered as **crema-at-low-alpha** so they read as warm grain, not cold lines.

---

## 7. Typography

**Display / UI text:** **Fraunces** — variable font, used with `opsz` (optical size) and `SOFT` axes.
- Headlines / greeting / category labels: `opsz: 144`, `SOFT: 100`, weight 500
- Meal counts / album titles: `opsz: 24`, `SOFT: 50`, weight 500
- Chalked timestamps: `opsz: 11`, `SOFT: 100`, weight 400, `font-feature-settings: "tnum"`

**Why Fraunces, not Inter/Geist:** A food archive is closer to a journal than a dashboard. Fraunces has a literal *softness* axis — you can dial warmth into the letterforms. Every cookbook ever printed uses a serif. Every handwritten menu chalkboard uses something with character. Inter says "we shipped a SaaS." Fraunces says "someone cared."

**Workhorse body / microcopy:** **Inter Tight** at 13–14px.
- Button labels, form fields, toast messages, menu items. Anything that must remain legible in a dim restaurant at arm's length. The single concession to legibility over character, scoped tightly.

**Tabular numerals:** **JetBrains Mono** with `"tnum"` — used ONLY where numbers must align (time strips in Albums sort view). Not for UI labels.

Letter-spacing:
- `--tracking-tight: -0.02em` — Fraunces headlines
- `--tracking-wide: 0.06em` — small-caps category tags

---

## 8. Spacing — 4px base

Base unit: **4px**. Scale named after what each gap looks like in a kitchen:

| Token | Value | Use |
|---|---|---|
| `--space-crumb` | 4px | icon-to-label gaps |
| `--space-bite` | 8px | chip padding, micro-gaps |
| `--space-sip` | 12px | within a card |
| `--space-plate` | 16px | card padding |
| `--space-tray` | 20px | card-to-card in feed |
| `--space-counter` | 24px | section padding |
| `--space-shelf` | 32px | between sections |
| `--space-room` | 40px | major breaks |
| `--space-kitchen` | 56px | empty-state generous air |
| `--space-hall` | 72px | hero spacing |

Minimum hit target 44px — thumb on a phone in poor lighting.

---

## 9. Border Radius

| Token | Value | Use |
|---|---|---|
| `--radius-tape` | 2px | masking-tape labels, tiny chips |
| `--radius-knob` | 6px | inputs, buttons |
| `--radius-polaroid` | 10px | meal cards, album tiles |
| `--radius-shutter` | 9999px | FAB ring only |

No rounded-xl (16px+) anywhere. Tight radii read diner/darkroom; generous radii read Stripe/fintech.

---

## 10. Motion

- `--dur-fast`: 140ms — button press, tape peel/stick, focus ring
- `--dur-normal`: 220ms — card entry into feed, route transitions
- `--dur-slow`: 380ms — shutter ring pulse, empty-state fade, Album gallery open
- `--ease-out`: `cubic-bezier(0.2, 0.8, 0.2, 1)` — default deceleration
- `--ease-in-out`: `cubic-bezier(0.4, 0, 0.2, 1)` — bidirectional
- `--ease-shutter`: `cubic-bezier(0.4, 0, 0.15, 1)` — mechanical close (the signature easing)

Principles:
- No springs, no bounces. Shutters don't bounce.
- New meal cards enter from the top as if a Polaroid is being handed down — translate-Y from -8px to 0 with fade-in, 220ms, ease-shutter.
- Tape labels stick on with opacity + 0.8° rotation-from-0 over 180ms ease-shutter.
- Respect `prefers-reduced-motion`: collapse durations to 0, keep opacity transitions.

---

## 11. Mandate Checks (passed before writing these files)

**Swap test.** If Fraunces were swapped for Inter, the meal feed would lose its journal register and become a Notion gallery clone. If surface tints were swapped for `#111/#1a/#22` generic dark-mode grays, the app would stop feeling like kitchen light and become GitHub dark. If masking-tape labels were swapped for rounded pills, the signature evaporates and DietLens becomes MyFitnessPal. The swaps matter — real choices were made.

**Squint test (conceptual).** Cast-iron canvas + crema-at-8% borders + photos as the only saturated elements → the hierarchy reads photos first (high contrast against dark bg), then crema typography, then chalk-dust secondary, then muted smoke. Nothing jumps. Nothing harsh. The tape labels and FAB are the only intentional spots of reflection.

**Signature test.** Three concrete, locatable elements:
1. Masking-tape category label (every meal card, every album cover)
2. Shutter ring FAB (bottom-center, every screen)
3. Chalked timestamp (every photo overlay)

**Token test.** A fresh reader of `tokens.css` will see `--crema`, `--cast-iron`, `--safelight`, `--thermal-paper`, `--chalk-dust`, `--smoked-brick`, `--scorched-green`, `--shutter-ring`, `--space-plate`, `--space-bite`, `--radius-polaroid`, `--radius-tape`, `--ease-shutter`. They cannot mistake this for a SaaS admin panel. They can guess: food, photography, memory, kitchen, archive.

---

## 12. Notes for Wave 2 (component integration)

- `app/globals.css` should `@import "./..styles/tokens.css"` (or equivalent) at the top of the file, before `@import "tailwindcss"`. Tokens are consumed via `var(--token-name)`, not as Tailwind theme extensions (simpler for a two-screen PWA).
- Fonts: load Fraunces variable (opsz + SOFT), Inter Tight, JetBrains Mono via `next/font` in `app/layout.tsx`. Assign to CSS variables `--font-fraunces`, `--font-inter`, `--font-mono`.
- Light mode exists only as a fallback for users who force light at the OS level; it is NOT a parity mode. Colors shift to a warm-paper palette (thermal-paper canvas, smoke text, safelight brand) but the dark experience is the canonical one.
- The masking-tape label is the first component to build in Sprint 2 — it proves the signature is real, not narrative.
- The shutter FAB is the second. Do not substitute a Material FAB.
