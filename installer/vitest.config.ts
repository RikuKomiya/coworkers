import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

// Pure modules only, in Node: vite.config.ts would boot the Worker.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@coworkers": fileURLToPath(new URL("../src/lib", import.meta.url)),
    },
  },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
})
