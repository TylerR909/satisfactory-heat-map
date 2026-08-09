import path from "node:path";
import { fileURLToPath } from "node:url";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import wasm from "vite-plugin-wasm";
import { wasmPackWatch } from "./src/lib/wasm/vite-wasm-pack-watch";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    // vite-plugin-wasm: ESM load of wasm-pack bundler output (no top-level-await needed for
    // modern wasm-bindgen glue that imports .wasm synchronously via the plugin).
    wasm(),
    wasmPackWatch("crates/engine"),
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
        name: "Satisfactory Heatmap",
        short_name: "SF Heatmap",
        description:
          'Answers "Where to build" in Satisfactory. Raw rates or product targets → best factory sites. For v1.2.',
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
        // Include .wasm so the offline shell can load the scoring engine.
        globPatterns: ["**/*.{js,css,html,ico,svg,png,json,wasm}"],
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
  server: {
    open: true,
  },
  worker: {
    format: "es",
    plugins: () => [wasm()],
  },
  optimizeDeps: {
    exclude: ["sf_engine"],
  },
});
