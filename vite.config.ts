import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const commit = (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7) || "local";
const built = new Date().toISOString().slice(0, 16).replace("T", " ");

export default defineConfig({
  plugins: [react()],
  define: { __BUILD__: JSON.stringify(`${built} UTC, ${commit}`) },
  server: { port: 5180, strictPort: true },
});
