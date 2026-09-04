import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    // jsdom needed for component smoke tests; pure-logic tests work fine in jsdom too
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.js"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{js,jsx}"],
      exclude: ["src/**/*.test.{js,jsx}", "src/main.jsx", "src/test-setup.js", "src/assets/**"],
    },
  },
});
