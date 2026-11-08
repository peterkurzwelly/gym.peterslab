#!/usr/bin/env node
/**
 * App icons for the home screen PWA, drawn to match public/favicon.svg: ink background, paper bar,
 * orange plates, plus a faint drafting grid, a sheet frame and a dimension line for the drawing-sheet feel.
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

const INK = "#04261E";
const PAPER = "#F2EDD5";
const ORANGE = "#F26716";
const LINE = "#1D4D3F";
const GRID = "#0C3428";
const FAINT = "#7F8D7F";

/** Drafting grid over the whole canvas: minor every 32, major every 128. */
function grid() {
  const minor = [];
  const major = [];
  for (let v = 32; v < 512; v += 32) {
    const target = v % 128 === 0 ? major : minor;
    target.push(`M${v} 0V512M0 ${v}H512`);
  }
  return `<path d="${minor.join("")}" stroke="${GRID}" stroke-width="2"/><path d="${major.join("")}" stroke="${LINE}" stroke-width="2"/>`;
}

/** The barbell, the favicon scaled ×8, with a dimension line under it. */
function artwork() {
  const bar = `<rect x="80" y="216" width="352" height="80" rx="16" fill="${PAPER}"/>`;
  const plates = `<rect x="112" y="144" width="56" height="224" rx="16" fill="${ORANGE}"/><rect x="344" y="144" width="56" height="224" rx="16" fill="${ORANGE}"/>`;
  // Dimension line between the plate centres: extension lines, architectural ticks, the line itself.
  const y = 412;
  const dim = [
    `<path d="M140 384V${y + 18}M372 384V${y + 18}" stroke="${FAINT}" stroke-width="4" stroke-linecap="round"/>`,
    `<path d="M140 ${y}H372" stroke="${FAINT}" stroke-width="4" stroke-linecap="round"/>`,
    `<path d="M128 ${y + 12}L152 ${y - 12}M360 ${y + 12}L384 ${y - 12}" stroke="${PAPER}" stroke-width="5" stroke-linecap="round"/>`,
  ].join("");
  // Centre line behind the bar, dash dot like a drawing's axis.
  const axis = `<path d="M256 92V444" stroke="${FAINT}" stroke-opacity="0.8" stroke-width="3" stroke-linecap="round" stroke-dasharray="22 10 3 10"/>`;
  return `${axis}${bar}${plates}${dim}`;
}

/** Sheet frame with corner registration marks. */
function frame(inset) {
  const a = inset;
  const b = 512 - inset;
  const m = 20;
  const marks = [
    `M${a} ${a + m}V${a}H${a + m}`,
    `M${b - m} ${a}H${b}V${a + m}`,
    `M${a} ${b - m}V${b}H${a + m}`,
    `M${b - m} ${b}H${b}V${b - m}`,
  ].join("");
  return `<rect x="${a}" y="${a}" width="${b - a}" height="${b - a}" fill="none" stroke="${LINE}" stroke-width="3"/><path d="${marks}" fill="none" stroke="${PAPER}" stroke-opacity="0.55" stroke-width="5" stroke-linecap="square"/>`;
}

/**
 * kind "square": full bleed (apple touch, maskable). kind "rounded": rounded tile with transparent corners.
 * scale shrinks the artwork around the centre (maskable safe zone).
 */
function iconSvg({ kind, scale = 1, inset = 36 }) {
  const t = scale === 1 ? "" : ` transform="translate(256 256) scale(${scale}) translate(-256 -256)"`;
  const clip = kind === "rounded" ? `<clipPath id="tile"><rect width="512" height="512" rx="112"/></clipPath>` : "";
  const open = kind === "rounded" ? `<g clip-path="url(#tile)">` : "<g>";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<defs>${clip}</defs>
${open}
<rect width="512" height="512" fill="${INK}"/>
${grid()}
${kind === "square" ? frame(inset) : ""}
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
// Maskable: launchers crop to a circle or squircle inside 80%. Artwork stays inside that, frame dropped.
await png(iconSvg({ kind: "square", scale: 0.78, inset: -10 }), 512, "maskable-icon-512x512.png");
// iOS: opaque, full bleed. iOS applies its own corner mask.
await png(iconSvg({ kind: "square", scale: 0.9 }), 180, "apple-touch-icon-180x180.png");
// Small sizes: the plain favicon reads better than the drawing details.
await sharp(favicon, { density: 72 * 4 }).resize(64, 64).png({ compressionLevel: 9 }).toFile(join(pub, "pwa-64x64.png"));
console.log("  pwa-64x64.png");
const ico48 = await sharp(favicon, { density: 72 * 4 }).resize(48, 48).png().toBuffer();
await writeFile(join(pub, "favicon.ico"), ico.encode([ico48]));
console.log("  favicon.ico");
// Keep the source drawing next to the PNGs for reference and future tweaks.
await writeFile(join(pub, "icon.svg"), iconSvg({ kind: "rounded" }));
console.log("  icon.svg");
