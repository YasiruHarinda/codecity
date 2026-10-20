/// <reference types="node" />
import { defineConfig } from "vite";

export default defineConfig({
  // Where the site lives. Locally that's the root ("/"); on GitHub Pages it's "/<repo-name>/",
  // which the deploy workflow passes in as BASE_PATH. Vite puts it in front of every asset link.
  base: process.env.BASE_PATH ?? "/",
  // Serve the example city.json files from /samples at the site root,
  // so http://localhost:5173/orderflow.json just works.
  publicDir: "../samples",
});
