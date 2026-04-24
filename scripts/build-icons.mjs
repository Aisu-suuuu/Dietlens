/**
 * DietLens — build-icons.mjs
 * Reads public/logo.svg → writes all PWA icon variants + Next.js auto-detected icons
 * Run: node scripts/build-icons.mjs  (or: pnpm build-icons)
 *
 * Colors sourced from styles/tokens.css:
 *   Mark (dark stroke) : #0E0B0A  — --bg-cast-iron (cast-iron)
 *   Background (light) : #E8C79A  — --fg-crema (crema)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── Token-derived colors ──────────────────────────────────────────────────────
const CAST_IRON = '#0E0B0A';   // --bg-cast-iron  (darkest — used as mark stroke)
const CREMA     = '#E8C79A';   // --fg-crema      (golden crema — maskable + apple-touch bg)

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Parse a hex color string like #RRGGBB into { r, g, b } */
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/**
 * Re-color the SVG: replace currentColor strokes with `strokeColor`,
 * optionally wrap in a colored rectangle background.
 */
function prepareSvg(svgSource, strokeColor, bgColor = null, size = 512) {
  let svg = svgSource;

  // Replace currentColor with the target stroke color
  svg = svg.replace(/currentColor/g, strokeColor);

  if (bgColor) {
    // Inject a background rect as the very first child inside <svg>
    svg = svg.replace(
      /(<svg[^>]*>)/,
      `$1\n  <rect width="${size}" height="${size}" fill="${bgColor}" />`
    );
  }

  return svg;
}

/**
 * Given an SVG string + target size, rasterise via sharp and return a PNG Buffer.
 * For maskable icons the mark is scaled to ~78% of the canvas (safe area ≈ 80%).
 */
async function svgToPng(svgString, width, height) {
  return await sharp(Buffer.from(svgString))
    .resize(width, height)
    .png()
    .toBuffer();
}

/**
 * For maskable: render the SVG at reduced size (78% of canvas = 399px inside 512)
 * centered on a solid background.  The 80% safe area rule means the mark must
 * fit within the central 409px circle — 78% (≈ 399px) gives a comfortable margin.
 */
async function svgToMaskablePng(svgSource, canvasSize, strokeColor, bgColor) {
  const markSize = Math.round(canvasSize * 0.78); // 399px for 512 canvas

  // Step 1 — render the colored mark at reduced size (transparent bg)
  const coloredSvg = prepareSvg(svgSource, strokeColor, null, 512);
  const markBuf = await sharp(Buffer.from(coloredSvg))
    .resize(markSize, markSize)
    .png()
    .toBuffer();

  // Step 2 — composite onto a solid-color canvas
  const { r, g, b } = hexToRgb(bgColor);
  const offset = Math.round((canvasSize - markSize) / 2);

  return await sharp({
    create: {
      width:  canvasSize,
      height: canvasSize,
      channels: 4,
      background: { r, g, b, alpha: 1 },
    },
  })
    .composite([{ input: markBuf, top: offset, left: offset }])
    .png()
    .toBuffer();
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const svgPath = resolve(ROOT, 'public', 'logo.svg');
  const svgSource = readFileSync(svgPath, 'utf8');

  // Ensure output directories exist
  mkdirSync(resolve(ROOT, 'public', 'icons'), { recursive: true });
  mkdirSync(resolve(ROOT, 'app'), { recursive: true });

  console.log('Building DietLens icons from public/logo.svg …\n');

  // ── 1. icon-192.png — transparent bg, cast-iron stroke ─────────────────────
  {
    const svg = prepareSvg(svgSource, CAST_IRON, null);
    const buf = await svgToPng(svg, 192, 192);
    writeFileSync(resolve(ROOT, 'public', 'icons', 'icon-192.png'), buf);
    console.log('  ✓ public/icons/icon-192.png  (192×192, transparent)');
  }

  // ── 2. icon-512.png — transparent bg, cast-iron stroke ─────────────────────
  {
    const svg = prepareSvg(svgSource, CAST_IRON, null);
    const buf = await svgToPng(svg, 512, 512);
    writeFileSync(resolve(ROOT, 'public', 'icons', 'icon-512.png'), buf);
    console.log('  ✓ public/icons/icon-512.png  (512×512, transparent)');
  }

  // ── 3. maskable-512.png — crema bg, cast-iron mark, 78% safe area ──────────
  {
    const buf = await svgToMaskablePng(svgSource, 512, CAST_IRON, CREMA);
    writeFileSync(resolve(ROOT, 'public', 'icons', 'maskable-512.png'), buf);
    console.log('  ✓ public/icons/maskable-512.png  (512×512, crema bg, safe area ~78%)');
  }

  // ── 4. apple-touch-180.png — crema bg, cast-iron mark ──────────────────────
  {
    const buf = await svgToMaskablePng(svgSource, 180, CAST_IRON, CREMA);
    writeFileSync(resolve(ROOT, 'public', 'icons', 'apple-touch-180.png'), buf);
    console.log('  ✓ public/icons/apple-touch-180.png  (180×180, crema bg)');
  }

  // ── 5. app/icon.png — Next.js auto-detected, 512×512, transparent ──────────
  {
    const svg = prepareSvg(svgSource, CAST_IRON, null);
    const buf = await svgToPng(svg, 512, 512);
    writeFileSync(resolve(ROOT, 'app', 'icon.png'), buf);
    console.log('  ✓ app/icon.png  (512×512, transparent — Next.js auto-detected)');
  }

  // ── 6. app/apple-icon.png — Next.js auto-detected, 180×180, crema bg ───────
  {
    const buf = await svgToMaskablePng(svgSource, 180, CAST_IRON, CREMA);
    writeFileSync(resolve(ROOT, 'app', 'apple-icon.png'), buf);
    console.log('  ✓ app/apple-icon.png  (180×180, crema bg — Next.js auto-detected)');
  }

  // ── 7. app/favicon.ico — multi-size ICO via to-ico ──────────────────────────
  // to-ico accepts an array of PNG Buffers and assembles a proper multi-size ICO.
  {
    const toIco = (await import('to-ico')).default;

    const sizes = [16, 32, 48];
    const pngBuffers = await Promise.all(
      sizes.map(async (sz) => {
        const svg = prepareSvg(svgSource, CAST_IRON, null);
        return svgToPng(svg, sz, sz);
      })
    );

    const ico = await toIco(pngBuffers);
    writeFileSync(resolve(ROOT, 'app', 'favicon.ico'), ico);
    console.log('  ✓ app/favicon.ico  (multi-size: 16, 32, 48 — via to-ico)');
  }

  console.log('\nAll icons generated successfully.');
  console.log(`Colors used:\n  Mark   : ${CAST_IRON}  (--bg-cast-iron)\n  BG     : ${CREMA}  (--fg-crema)`);
}

main().catch((err) => {
  console.error('build-icons failed:', err);
  process.exit(1);
});
