import { defineConfig } from "vite";

export default defineConfig({
  // Entry point for the demo page
  root: "demo",

  build: {
    // Output to project root dist/ (not demo/dist)
    outDir: "../dist",
    emptyOutDir: true,

    rollupOptions: {
      input: "demo/index.html",
    },
  },

  // Expose the src/ directory so demo imports can resolve ../src/index.ts
  resolve: {
    alias: {
      // Allow demo to import from "ananke-threejs-bridge" during development
      "@ananke-bridge": new URL("./src", import.meta.url).pathname,
    },
  },

  // Development server config
  server: {
    port: 5173,
    open: true,
  },
});
