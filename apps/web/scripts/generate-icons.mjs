#!/usr/bin/env node
/**
 * App icons for the home screen PWA, drawn to match public/favicon.svg: night background with a soft volt
 * glow, white bar, volt plates.
 *
 *   node apps/web/scripts/generate-icons.mjs
 *
 * Writes into apps/web/public/:
 *   pwa-64x64.png              favicon fallback (plain favicon artwork, small sizes stay crisp)
 *   favicon.ico                48 px, for browsers that ask for /favicon.ico
 *   pwa-192x192.png            manifest icon, purpose "any" (rounded, transparent corners)
 *   pwa-512x512.png            manifest icon, purpose "any"
 *   maskable-icon-512x512.png  manifest icon, purpose "maskable" (full bleed, artwork in the 80% safe zone)
 *   apple-touch-icon-180x180.png  iOS home screen (full bleed, iOS rounds the corners itself)
 *
 * Uses sharp (rsvg) and sharp-ico, both installed with @vite-pwa/assets-generator. Deterministic output.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import ico from "sharp-ico";

const here = dirname(fileURLToPath(import.meta.url));
const pub = join(here, "..", "public");

const NIGHT = "#0a0a0c";
const GLOW = "#1b2208";
const FG = "#f5f5f7";
const VOLT = "#c9f73a";
const VOLT_DIM = "#86a626";

/** A soft volt glow from the top left, the same light as the app's hero card. */
function glow() {
  return `<radialGradient id="glow" cx="0.2" cy="0.1" r="0.95"><stop offset="0" stop-color="${GLOW}"/><stop offset="1" stop-color="${NIGHT}"/></radialGradient>`;
}

/** The barbell: white bar, volt plates. The favicon scaled ×8. */
function artwork() {
  const bar = `<rect x="72" y="224" width="368" height="64" rx="20" fill="${FG}"/>`;
  const inner = `<rect x="124" y="136" width="60" height="240" rx="20" fill="${VOLT}"/><rect x="328" y="136" width="60" height="240" rx="20" fill="${VOLT}"/>`;
  const outer = `<rect x="88" y="176" width="28" height="160" rx="12" fill="${VOLT_DIM}"/><rect x="396" y="176" width="28" height="160" rx="12" fill="${VOLT_DIM}"/>`;
  return `${bar}${outer}${inner}`;
}

/**
 * kind "square": full bleed (apple touch, maskable). kind "rounded": rounded tile with transparent corners.
 * scale shrinks the artwork around the centre (maskable safe zone).
 */
function iconSvg({ kind, scale = 1 }) {
  const t = scale === 1 ? "" : ` transform="translate(256 256) scale(${scale}) translate(-256 -256)"`;
  const clip = kind === "rounded" ? `<clipPath id="tile"><rect width="512" height="512" rx="112"/></clipPath>` : "";
  const open = kind === "rounded" ? `<g clip-path="url(#tile)">` : "<g>";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<defs>${clip}${glow()}</defs>
${open}
<rect width="512" height="512" fill="${NIGHT}"/>
<rect width="512" height="512" fill="url(#glow)"/>
<g${t}>${artwork()}</g>
</g>
</svg>`;
}

async function png(svg, size, file) {
  const out = join(pub, file);
  await sharp(Buffer.from(svg), { density: 72 * (size / 512) * 4 })
    .resize(size, size)
    .png({ compressionLevel: 9, palette: false })
    .toFile(out);
  console.log(`  ${file}`);
}

const favicon = await readFile(join(pub, "favicon.svg"));

console.log("Writing icons to apps/web/public:");
await png(iconSvg({ kind: "rounded" }), 192, "pwa-192x192.png");
await png(iconSvg({ kind: "rounded" }), 512, "pwa-512x512.png");
// Maskable: launchers crop to a circle or squircle inside 80%. Artwork stays inside that.
await png(iconSvg({ kind: "square", scale: 0.78 }), 512, "maskable-icon-512x512.png");
// iOS: opaque, full bleed. iOS applies its own corner mask.
await png(iconSvg({ kind: "square", scale: 0.9 }), 180, "apple-touch-icon-180x180.png");
// Small sizes: the plain favicon reads better than the glow.
await sharp(favicon, { density: 72 * 4 }).resize(64, 64).png({ compressionLevel: 9 }).toFile(join(pub, "pwa-64x64.png"));
console.log("  pwa-64x64.png");
const ico48 = await sharp(favicon, { density: 72 * 4 }).resize(48, 48).png().toBuffer();
await writeFile(join(pub, "favicon.ico"), ico.encode([ico48]));
console.log("  favicon.ico");
// Keep the source drawing next to the PNGs for reference and future tweaks.
await writeFile(join(pub, "icon.svg"), iconSvg({ kind: "rounded" }));
console.log("  icon.svg");
