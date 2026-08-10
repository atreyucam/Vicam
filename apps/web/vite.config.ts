import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";
import { pwaManifest } from "./pwaManifest";

export default defineConfig({
  resolve: {
    alias: {
      "@vicam/contracts/client": fileURLToPath(
        new URL("../../packages/contracts/src/client.ts", import.meta.url),
      ),
      "@vicam/contracts": fileURLToPath(
        new URL("../../packages/contracts/dist/index.js", import.meta.url),
      ),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      injectRegister: false,
      registerType: "prompt",
      manifest: pwaManifest,
      workbox: {
        cleanupOutdatedCaches: true,
        globIgnores: ["runtime/config.js"],
        importScripts: ["/push-handler.js"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api(?:\/|$)/],
        runtimeCaching: [],
      },
    }),
  ],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}", "tests/unit/**/*.test.ts"],
    setupFiles: ["./src/test/setup.ts"],
  },
});
