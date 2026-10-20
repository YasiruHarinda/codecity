import path from "node:path";
import { stripPythonComments } from "./strip";

export interface PythonImport {
  /** "a.b" for absolute imports, "." / "..pkg" for relative ones. */
  module: string;
  /** For `from module import x, y`: ["x", "y"]. Empty for `import module`. */
  names: string[];
}

const IMPORT_LINE = /^[ \t]*import[ \t]+(.+)$/gm;
const FROM_LINE = /^[ \t]*from[ \t]+(\.+[\w.]*|[\w.]+)[ \t]+import[ \t]+(.+)$/gm;

/** Finds every `import x` and `from x import y` in a Python file. */
export function parsePythonImports(source: string): PythonImport[] {
  let code = stripPythonComments(source);
  // Join lines that continue onto the next one, so every import fits on one line:
  //   backslash at end of line, or a list in parentheses: from x import (\n a,\n b\n)
  code = code.replace(/\\\n/g, " ").replace(/\(([^)]*)\)/g, (_, inside: string) => inside.replace(/\n/g, " "));

  const imports: PythonImport[] = [];
  for (const [, list] of code.matchAll(IMPORT_LINE)) {
    // import a.b, c as d  →  "a.b", "c"
    for (const part of list.split(",")) {
      const module = part.trim().split(/\s+/)[0];
      if (/^[\w.]+$/.test(module)) imports.push({ module, names: [] });
    }
  }
  for (const [, module, list] of code.matchAll(FROM_LINE)) {
    // from x import a, b as c  →  names "a", "b"   (a "*" import names nothing specific)
    const names = list
      .split(",")
      .map((part) => part.trim().split(/\s+/)[0])
      .filter((name) => /^\w+$/.test(name));
    imports.push({ module, names });
  }
  return imports;
}

/**
 * Builds a resolver for Python imports in this repo.
 *
 * Every .py file gets a dotted module name from its path:
 *   "pkg/sub/mod.py" → "pkg.sub.mod",   "pkg/sub/__init__.py" → "pkg.sub"
 * Code often lives under a folder like "src/" that isn't part of the module name, so an absolute
 * import also matches a module whose name ENDS with it ("src.pkg.mod" for "pkg.mod").
 */
export function createPythonResolver(pythonFiles: string[]) {
  const fileByModule = new Map<string, string>();
  // Module names grouped by their last part, so suffix lookups don't scan every module.
  const modulesByLastPart = new Map<string, string[]>();

  for (const file of pythonFiles) {
    const withoutExt = file.slice(0, -".py".length);
    const parts = withoutExt.split("/");
    if (parts[parts.length - 1] === "__init__") parts.pop();
    const module = parts.join(".");
    if (!module) continue;
    fileByModule.set(module, file);
    const last = parts[parts.length - 1];
    modulesByLastPart.set(last, [...(modulesByLastPart.get(last) ?? []), module]);
  }

  function findAbsolute(importer: string, module: string): string | null {
    const exact = fileByModule.get(module);
    if (exact) return exact;
    const last = module.slice(module.lastIndexOf(".") + 1);
    const matches = (modulesByLastPart.get(last) ?? []).filter((name) => name.endsWith("." + module));
    if (matches.length === 0) return null;
    // Several matches (e.g. two projects in one repo): take the one closest to the importer.
    matches.sort((a, b) => sharedPrefix(importer, fileByModule.get(b)!) - sharedPrefix(importer, fileByModule.get(a)!));
    return fileByModule.get(matches[0])!;
  }

  /** Turns "..pkg" (relative to the importer) into an absolute dotted name. */
  function absoluteName(importer: string, module: string): string {
    const dots = module.length - module.replace(/^\.+/, "").length;
    let folder = path.posix.dirname(importer);
    // One dot = this package (the importer's folder), each extra dot = one folder up.
    for (let i = 1; i < dots; i++) folder = path.posix.dirname(folder);
    const rest = module.slice(dots);
    const prefix = folder === "." ? "" : folder.split("/").join(".");
    return [prefix, rest].filter(Boolean).join(".");
  }

  /** All repo files one import points to (`from pkg import a, b` can point to several). */
  return function resolve(importer: string, imp: PythonImport): string[] {
    const relative = imp.module.startsWith(".");
    const base = relative ? absoluteName(importer, imp.module) : imp.module;
    const find = (name: string) => (relative ? (fileByModule.get(name) ?? null) : findAbsolute(importer, name));

    const results: string[] = [];
    // `from pkg import mod` may import a sub-module (pkg/mod.py) rather than a name inside pkg.
    let usedPackage = imp.names.length === 0;
    for (const name of imp.names) {
      const subModule = find(base ? `${base}.${name}` : name);
      if (subModule) results.push(subModule);
      else usedPackage = true;
    }
    if (usedPackage && base) {
      const packageFile = find(base);
      if (packageFile) results.push(packageFile);
    }
    return results;
  };
}

/** How many leading characters two paths share — a rough "how close are they" measure. */
function sharedPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return i;
}
