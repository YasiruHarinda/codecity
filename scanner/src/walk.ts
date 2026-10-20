import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import ignore from "ignore";

const execFileAsync = promisify(execFile);

/** Folders we never scan, even if .gitignore forgets to list them. */
export const ALWAYS_SKIPPED_FOLDERS = new Set([
  "node_modules",
  ".git",
  "bin",
  "obj",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".venv",
  "venv",
  "__pycache__",
  ".idea",
  ".vs",
  ".vscode",
]);

export interface FileList {
  /** Paths relative to the scanned folder, with forward slashes, sorted. */
  files: string[];
  source: "git" | "filesystem";
}

/**
 * Lists every file in a folder that is not ignored.
 * Uses git when the folder is inside a git repo (most accurate), otherwise walks the disk.
 */
export async function listFiles(rootDir: string): Promise<FileList> {
  const fromGit = await listWithGit(rootDir);
  const files = fromGit ?? (await listWithFilesystem(rootDir));

  const kept = files.filter((file) => !isInSkippedFolder(file)).sort();
  return { files: kept, source: fromGit ? "git" : "filesystem" };
}

/** True if any folder in the path (not the file name itself) is always skipped. */
export function isInSkippedFolder(filePath: string): boolean {
  const folders = filePath.split("/").slice(0, -1);
  return folders.some((folder) => ALWAYS_SKIPPED_FOLDERS.has(folder));
}

/**
 * Asks git for the file list. Git already understands every .gitignore rule
 * (nested files, "!" negations, global excludes), so we don't have to.
 *
 *   --cached           files git tracks
 *   --others           new files git doesn't track yet...
 *   --exclude-standard ...minus the ones .gitignore says to ignore
 *   -z                 separate names with a zero byte, so odd file names are safe
 *
 * Returns null if this is not a git repo (or git isn't installed).
 */
async function listWithGit(rootDir: string): Promise<string[] | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: rootDir, maxBuffer: 256 * 1024 * 1024 },
    );
    return stdout.split("\0").filter((name) => name !== "");
  } catch {
    return null;
  }
}

/**
 * Fallback for folders that are not git repos: walk the disk ourselves.
 * Only the top-level .gitignore is respected here (nested ones are ignored).
 */
async function listWithFilesystem(rootDir: string): Promise<string[]> {
  const rules = ignore();
  try {
    rules.add(await fs.readFile(path.join(rootDir, ".gitignore"), "utf8"));
  } catch {
    // No .gitignore — nothing to add.
  }

  const found: string[] = [];

  async function walk(relativeDir: string): Promise<void> {
    const entries = await fs.readdir(path.join(rootDir, relativeDir), { withFileTypes: true });
    for (const entry of entries) {
      // Build JSON-style paths with forward slashes, even on Windows.
      const relativePath = relativeDir ? path.posix.join(relativeDir, entry.name) : entry.name;

      if (entry.isDirectory()) {
        // The trailing "/" tells the ignore library this is a folder (matters for rules like "logs/").
        if (ALWAYS_SKIPPED_FOLDERS.has(entry.name) || rules.ignores(relativePath + "/")) continue;
        await walk(relativePath);
      } else if (entry.isFile() && !rules.ignores(relativePath)) {
        // Symlinks are neither isDirectory() nor isFile() here, so they're skipped (avoids loops).
        found.push(relativePath);
      }
    }
  }

  await walk("");
  return found;
}
