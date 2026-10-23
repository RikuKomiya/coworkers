import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { cloudflare } from "@cloudflare/vite-plugin"
import agents from "agents/vite"

export default defineConfig({
  server: { port: 3100 },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // bdots' model catalog, so the installer offers the same models.
      "@bdots": fileURLToPath(new URL("../src/lib", import.meta.url)),
    },
  },
  plugins: [agents(), cloudflare(), tailwindcss(), react()],
})
