import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backend = "http://localhost:3000";

// api.ts uses relative paths, so proxy them to the Express backend.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/products": backend,
      "/cart": backend,
      "/order": backend,
      "/orders": backend,
      "/users": backend,
    },
  },
});
