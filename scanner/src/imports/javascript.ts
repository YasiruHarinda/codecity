import path from "node:path";
import { stripCStyleComments } from "./strip";

// import x from "a" · import { a, b } from "a" · import * as x from "a" · import type { T } from "a" · import "a"
const IMPORT_FROM = /\bimport\s+(?:type\s+)?(?:[\w$*{}\s,]+?\s+from\s+)?["']([^"'\n]+)["']/g;
// export * from "a" · export { a } from "a" · export type { T } from "a"
const EXPORT_FROM = /\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s+from\s+["']([^"'\n]+)["']/g;
// require("a") · import("a")
const CALL = /\b(?:require|import)\s*\(\s*["']([^"'\n]+)["']\s*\)/g;

/** Finds every module path a JS/TS file imports, e.g. ["./utils", "react"]. */
export function parseJsImports(source: string): string[] {
  const code = stripCStyleComments(source);
  const specifiers = new Set<string>();
  for (const pattern of [IMPORT_FROM, EXPORT_FROM, CALL]) {
    for (const match of code.matchAll(pattern)) specifiers.add(match[1]);
  }
  return [...specifiers];
}

/** Extensions to try when an import leaves it out: `./utils` might be utils.ts, utils.tsx, ... */
const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte", ".json"];

/**
 * Turns an import specifier into a file path in the repo, or null if it's an
 * external package (like "react") or points to a file we don't have.
 *
 * @param importer path of the file doing the import, e.g. "src/app/main.ts"
 * @param files    every file in the repo
 */
export function resolveJsImport(importer: string, specifier: string, files: Set<string>): string | null {
  const spec = specifier.split("?")[0]; // drop Vite-style queries like "./icon.svg?raw"
  let base: string;

  if (spec === "." || spec === ".." || spec.startsWith("./") || spec.startsWith("../")) {
    base = path.posix.join(path.posix.dirname(importer), spec);
  } else if (spec.startsWith("@/") || spec.startsWith("~/")) {
    // A common path alias meaning "the src folder". Real projects define this in tsconfig/vite config;
    // we guess: the nearest "src" folder above the importer, or else the top-level one.
    base = path.posix.join(nearestSrcFolder(importer), spec.slice(2));
  } else {
    return null; // a package from node_modules — not part of the repo
  }

  if (base.startsWith("..")) return null; // points outside the repo

  const candidates = [base, ...EXTENSIONS.map((ext) => base + ext), ...EXTENSIONS.map((ext) => `${base}/index${ext}`)];
  // TypeScript ESM style: `import "./x.js"` where the file on disk is x.ts.
  const jsExtension = /\.(m|c)?jsx?$/.exec(base);
  if (jsExtension) {
    const withoutExt = base.slice(0, -jsExtension[0].length);
    candidates.push(...[".ts", ".tsx", ".mts", ".cts"].map((ext) => withoutExt + ext));
  }

  return candidates.find((candidate) => files.has(candidate)) ?? null;
}

function nearestSrcFolder(importer: string): string {
  const parts = importer.split("/");
  const index = parts.lastIndexOf("src", parts.length - 2);
  return index >= 0 ? parts.slice(0, index + 1).join("/") : "src";
}
