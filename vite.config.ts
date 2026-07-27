import path from "node:path";
import { fileURLToPath } from "node:url";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    // Partial options — plugin typings require full babel PluginOptions; runtime accepts this.
    babel({
      include: /\.[jt]sx?$/,
      presets: [reactCompilerPreset()],
      // biome-ignore lint/suspicious/noExplicitAny: rolldown babel PluginOptions is over-strict
    } as any),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "Satisfactory Factory Heatmap",
        short_name: "SF Heatmap",
        description: "Find ideal factory locations from raw demand or a target product.",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "favicon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        // Do not precache the basemap pyramid (hundreds of WebPs); runtime TileLayer is enough.
        globPatterns: ["**/*.{js,css,html,ico,svg,png,json}"],
        globIgnores: ["**/map/**"],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "src"),
    },
  },
  worker: {
    format: "es",
  },
});
