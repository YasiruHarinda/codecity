import path from "node:path";

/**
 * Maps a file extension to a language name.
 * Files whose extension is not listed here are not treated as source files
 * and are left out of the city.
 */
const LANGUAGES_BY_EXTENSION: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".mts": "TypeScript",
  ".cts": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".py": "Python",
  ".cs": "C#",
  ".java": "Java",
  ".kt": "Kotlin",
  ".go": "Go",
  ".rs": "Rust",
  ".c": "C",
  ".h": "C",
  ".cpp": "C++",
  ".cc": "C++",
  ".hpp": "C++",
  ".rb": "Ruby",
  ".php": "PHP",
  ".swift": "Swift",
  ".scala": "Scala",
  ".dart": "Dart",
  ".lua": "Lua",
  ".r": "R",
  ".sh": "Shell",
  ".ps1": "PowerShell",
  ".sql": "SQL",
  ".html": "HTML",
  ".css": "CSS",
  ".scss": "SCSS",
  ".vue": "Vue",
  ".svelte": "Svelte",
  ".json": "JSON",
  ".yaml": "YAML",
  ".yml": "YAML",
  ".xml": "XML",
  ".csproj": "XML",
  ".tf": "Terraform",
  ".md": "Markdown",
};

/** Files with no extension that are still code. */
const LANGUAGES_BY_FILENAME: Record<string, string> = {
  Dockerfile: "Dockerfile",
  Makefile: "Makefile",
};

/** Generated files that would make giant, meaningless buildings. */
const SKIPPED_FILENAMES = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml"]);

/**
 * Returns the language of a file, or null if it is not a source file we care about.
 * @param filePath a path with forward slashes, e.g. "src/app/main.ts"
 */
export function detectLanguage(filePath: string): string | null {
  const fileName = path.posix.basename(filePath);

  if (SKIPPED_FILENAMES.has(fileName)) return null;
  // Minified bundles are one huge line of generated code.
  if (fileName.endsWith(".min.js") || fileName.endsWith(".min.css")) return null;

  if (LANGUAGES_BY_FILENAME[fileName]) return LANGUAGES_BY_FILENAME[fileName];

  const extension = path.posix.extname(fileName).toLowerCase();
  return LANGUAGES_BY_EXTENSION[extension] ?? null;
}
