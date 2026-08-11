import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Served from /firewatch, not from the root.
 *
 * `base` rewrites every emitted asset URL — without it the built index.html asks
 * for /assets/index-*.js, which under a subpath is a 404 and a blank page. It
 * pairs with the router basename in App.jsx; both have to agree, so both read
 * this one value.
 */
export const BASE = "/firewatch";

export default defineConfig({
  base: BASE,
  plugins: [react(), tailwindcss()],
});
