import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Forward API calls to the Node.js server during development.
    proxy: {
      "/api": "http://localhost:5000",
      "/uploads": "http://localhost:5000",
      "/files": "http://localhost:5000"
    }
  }
});
