/**
 * Builds a large fake git repository for performance testing — offline, no downloads.
 *
 *   npm run make-test-repo -- <folder> [--files 10000] [--commits 30]
 *
 * The repo gets nested folders, TypeScript and Python files of very different sizes that import
 * each other, and a year of commits that add, edit and delete files. The same arguments always
 * produce the same repo (seeded random numbers), so timings can be compared between runs.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const outDir = args.find((arg) => !arg.startsWith("--"));
const option = (name: string, fallback: number) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? Number(args[index + 1]) : fallback;
};
const FILES = option("files", 10_000);
const COMMITS = option("commits", 30);

if (!outDir) {
  console.error("Usage: npm run make-test-repo -- <folder> [--files 10000] [--commits 30]");
  process.exit(1);
}
if (existsSync(outDir) && readdirSync(outDir).length > 0) {
  console.error(`${outDir} is not empty — pick a new folder.`);
  process.exit(1);
}

// Seeded random numbers (same seed → same repo).
let seed = 12345;
const random = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];

// --- Folders: a random tree, more shallow folders than deep ones ---
const folders = ["src", "src/core", "src/api", "src/ui", "lib", "services", "tests", "py/app", "py/tools"];
while (folders.length < Math.max(20, FILES / 16)) {
  const parent = pick(folders);
  if (parent.split("/").length < 6) folders.push(`${parent}/m${folders.length}`);
}

// --- Files ---
interface FakeFile {
  path: string;
  python: boolean;
  lines: number;
  imports: string[];
}
const files: FakeFile[] = [];
for (let i = 0; i < FILES; i++) {
  const folder = pick(folders);
  const python = folder.startsWith("py");
  // Most files are small, a few are huge (cubed random number).
  const lines = 5 + Math.floor(random() ** 3 * 1500);
  files.push({ path: `${folder}/f${i}.${python ? "py" : "ts"}`, python, lines, imports: [] });
}
for (const file of files) {
  const sameKind = files.filter((other) => other.python === file.python);
  const count = Math.floor(random() * 6);
  for (let i = 0; i < count; i++) file.imports.push(pick(sameKind).path);
}

function render(file: FakeFile, extraLines: number): string {
  const out: string[] = [];
  for (const target of file.imports) {
    if (target === file.path) continue;
    if (file.python) {
      out.push(`from ${target.replace(/\.py$/, "").replace(/\//g, ".")} import thing`);
    } else {
      let relative = path.posix.relative(path.posix.dirname(file.path), target).replace(/\.ts$/, "");
      if (!relative.startsWith(".")) relative = `./${relative}`;
      out.push(`import { thing } from "${relative}";`);
    }
  }
  for (let i = 0; i < file.lines + extraLines; i++) {
    out.push(file.python ? `def f${i}():\n    return ${i}` : `export function f${i}() { return ${i}; }`);
  }
  return out.join("\n") + "\n";
}

// --- History: a year of commits ---
mkdirSync(outDir, { recursive: true });
const git = (gitArgs: string[], env?: NodeJS.ProcessEnv) =>
  execFileSync("git", gitArgs, { cwd: outDir, env: { ...process.env, ...env }, stdio: "ignore" });
git(["init", "-q"]);

const start = Date.parse("2025-01-01T00:00:00Z");
const day = 86_400_000;
const live: FakeFile[] = [];
const growth = new Map<FakeFile, number>();
let nextFile = 0;

for (let c = 0; c < COMMITS; c++) {
  // First commit: 20% of the files. Then the rest arrive evenly.
  const target = c === 0 ? Math.floor(FILES * 0.2) : Math.floor(FILES * 0.2 + ((FILES * 0.8) * c) / (COMMITS - 1));
  const changed = new Set<FakeFile>();
  if (c > 0) {
    // Delete a few existing files (before adding new ones, so only files already on disk go).
    for (let i = 0; i < live.length * 0.002; i++) {
      const index = Math.floor(random() * live.length);
      rmSync(path.join(outDir, live[index].path));
      live.splice(index, 1);
    }
  }
  while (nextFile < Math.min(target, FILES)) {
    live.push(files[nextFile]);
    changed.add(files[nextFile++]);
  }
  if (c > 0) {
    // Edit about 3% of existing files (some files get edited again and again = high churn).
    for (let i = 0; i < live.length * 0.03; i++) {
      const file = random() < 0.5 ? live[Math.floor(random() * Math.min(200, live.length))] : pick(live);
      growth.set(file, (growth.get(file) ?? 0) + 1 + Math.floor(random() * 20));
      changed.add(file);
    }
  }
  for (const file of changed) {
    const fullPath = path.join(outDir, file.path);
    mkdirSync(path.dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, render(file, growth.get(file) ?? 0));
  }

  const date = new Date(start + (365 * day * c) / (COMMITS - 1)).toISOString();
  git(["-c", "core.autocrlf=false", "add", "-A"]);
  git(
    ["-c", "user.name=Generator", "-c", "user.email=gen@example.com", "-c", "commit.gpgsign=false", "commit", "-q", "-m", `commit ${c}`],
    { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  );
  process.stdout.write(`\rcommit ${c + 1}/${COMMITS} — ${live.length} files`);
}
console.log(`\nDone: ${outDir}`);
