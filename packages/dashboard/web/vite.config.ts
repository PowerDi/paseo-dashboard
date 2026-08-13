import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";

// In the Paseo monorepo, the relay package is at packages/relay/dist/e2ee.js
const relayE2eeDist = fileURLToPath(new URL("../../relay/dist/e2ee.js", import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@getpaseo/relay/e2ee": relayE2eeDist,
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
