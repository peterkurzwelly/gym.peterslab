import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

/** "1.0.0 · 15bb0af · 2026-11-08 21:14 UTC", shown under Settings → About. */
function buildLabel(): string {
  let sha = "";
  try {
    sha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    /* not a git checkout */
  }
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  return [pkg.version, sha, `${stamp} UTC`].filter(Boolean).join(" · ");
}

// Icons: apps/web/scripts/generate-icons.mjs writes them into public/.
// Updates: registerType autoUpdate (skipWaiting + clientsClaim). index.html registers the service worker
// and reloads onto a new version only at an app open, never while Peter is tapping or a session is open
// (src/lib/updatePolicy.ts). Dexie is untouched.
// public/sw-guard.js runs inside the service worker first: HTML served for a missing .js/.css file is a
// 404 to the precache, so a deploy race cannot store index.html as the app's main chunk.
// public/_headers: CSP and friends for the static assets.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      // index.html imports virtual:pwa-register itself (reload timing), so no injected script.
      injectRegister: false,
      // The manifest request carries credentials (Cloudflare Access cookie when Access is on).
      useCredentials: true,
      includeAssets: ["favicon.svg", "favicon.ico", "pwa-64x64.png", "apple-touch-icon-180x180.png"],
      manifest: {
        id: "/",
        name: "Workout OS",
        short_name: "Gym",
        description: "Consistency first training log.",
        lang: "en",
        theme_color: "#04261E",
        background_color: "#04261E",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        categories: ["health", "fitness"],
        icons: [
          { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/cdn-cgi\//],
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2,webmanifest}"],
        // The exercise library and engine ship in the main chunk; keep it precached.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        importScripts: ["sw-guard.js"],
        clientsClaim: true,
        skipWaiting: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  define: {
    "import.meta.env.VITE_APP_BUILD": JSON.stringify(buildLabel()),
  },
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8787" },
  },
  build: { target: "es2022", sourcemap: false },
});
