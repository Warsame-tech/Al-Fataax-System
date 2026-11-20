import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The website runs on its own port; in development /api goes to the Faatix API (the contact / demo form).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: { "/api": "http://localhost:5000" }
  }
});
