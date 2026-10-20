import { defineConfig } from "vite";

export default defineConfig({
  // Serve the example city.json files from /samples at the site root,
  // so http://localhost:5173/orderflow.json just works.
  publicDir: "../samples",
});
