import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  worker: { format: "es" },
  build: { target: "es2022", sourcemap: true },
  // the studio's gallery API (server/server.js) answers on 5320
  server: { host: "127.0.0.1", port: 5317, strictPort: true, allowedHosts: true, proxy: { "/api": "http://127.0.0.1:5320" } },
  preview: { host: "127.0.0.1", port: 5318, strictPort: true, allowedHosts: true },
});
