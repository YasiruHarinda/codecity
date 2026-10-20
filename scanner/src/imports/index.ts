/**
 * Import detection, in two steps:
 *
 *   1. parse   — read ONE file's text and pull out raw facts (`parseImports`).
 *                These are the only functions that read source code, so they can later be
 *                swapped for a real parser like Tree-sitter without touching anything else.
 *   2. resolve — once every file is parsed, match the facts to files in the repo (`resolveImports`).
 */
import { parseCSharp, resolveCSharp, type CSharpFacts } from "./csharp";
import { parseJsImports, resolveJsImport } from "./javascript";
import { createPythonResolver, parsePythonImports, type PythonImport } from "./python";

export type ImportFacts =
  | { kind: "js"; specifiers: string[] }
  | { kind: "python"; imports: PythonImport[] }
  | { kind: "csharp"; facts: CSharpFacts };

const JS_LANGUAGES = new Set(["TypeScript", "JavaScript", "Vue", "Svelte"]);

/** Step 1. Returns null for languages we don't parse imports for. */
export function parseImports(language: string, source: string): ImportFacts | null {
  if (JS_LANGUAGES.has(language)) return { kind: "js", specifiers: parseJsImports(source) };
  if (language === "Python") return { kind: "python", imports: parsePythonImports(source) };
  if (language === "C#") return { kind: "csharp", facts: parseCSharp(source) };
  return null;
}

/**
 * Step 2. Turns everyone's raw facts into real dependencies.
 * @param factsByFile parsed facts for every file whose language we support
 * @param allFiles    every source file in the city (imports can only point to these)
 * @returns file → sorted repo files it depends on
 */
export function resolveImports(factsByFile: Map<string, ImportFacts>, allFiles: string[]): Map<string, string[]> {
  const fileSet = new Set(allFiles);
  const resolvePython = createPythonResolver(allFiles.filter((file) => file.endsWith(".py")));
  const csharpFacts = new Map<string, CSharpFacts>();
  const result = new Map<string, Set<string>>();

  for (const [file, facts] of factsByFile) {
    const targets = new Set<string>();
    result.set(file, targets);

    if (facts.kind === "js") {
      for (const specifier of facts.specifiers) {
        const target = resolveJsImport(file, specifier, fileSet);
        if (target) targets.add(target);
      }
    } else if (facts.kind === "python") {
      for (const imp of facts.imports) resolvePython(file, imp).forEach((target) => targets.add(target));
    } else {
      csharpFacts.set(file, facts.facts); // C# needs every file's facts at once, done below
    }
  }

  for (const [file, targets] of resolveCSharp(csharpFacts)) {
    targets.forEach((target) => result.get(file)!.add(target));
  }

  const sorted = new Map<string, string[]>();
  for (const [file, targets] of result) {
    targets.delete(file); // a file "importing itself" via a re-export isn't interesting here
    sorted.set(file, [...targets].sort());
  }
  return sorted;
}

export { findCycles } from "./cycles";
