import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// PWA settings are owned by the PWA step (manifest, icons, workbox). Keep /api out of the service worker.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      // Cloudflare Access protects the site: the manifest request must carry the Access cookie.
      useCredentials: true,
      includeAssets: ["favicon.svg", "apple-touch-icon-180x180.png"],
      manifest: {
        name: "Workout OS",
        short_name: "Gym",
        description: "Consistency first training log.",
        theme_color: "#04261E",
        background_color: "#04261E",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        icons: [],
      },
      workbox: {
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/cdn-cgi\//],
        globPatterns: ["**/*.{js,css,html,svg,png,woff2,webmanifest}"],
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8787" },
  },
  build: { target: "es2022", sourcemap: true },
});
