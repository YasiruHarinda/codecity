import { promises as fs } from "node:fs";
import path from "node:path";
import type { CityData, FileNode } from "../../shared/types";
import { readGitHistory } from "./git";
import { readHistory } from "./history";
import { findCycles, parseImports, resolveImports, type ImportFacts } from "./imports";
import { detectLanguage } from "./languages";
import { countLoc, isBinary } from "./loc";
import { buildTree } from "./tree";
import { listFiles } from "./walk";

/** Files bigger than this are almost always generated or data, not hand-written code. */
const MAX_FILE_BYTES = 1024 * 1024;

/** How many files we read at the same time. Too many at once can hit the OS open-file limit. */
const READ_CONCURRENCY = 64;

export interface ScanOptions {
  /** Also sample this many points in git history (for the time-travel timeline). */
  historyPoints?: number;
}

/** Scans a folder and returns the data for city.json. */
export async function scanRepo(repoPath: string, options: ScanOptions = {}): Promise<CityData> {
  const rootDir = path.resolve(repoPath);
  const stat = await fs.stat(rootDir).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error(`Not a folder: ${rootDir}`);
  }

  // Start reading git history now; it runs while we read the files below.
  const historyPromise = readGitHistory(rootDir);
  const snapshotsPromise = options.historyPoints ? readHistory(rootDir, options.historyPoints) : null;

  const { files, source } = await listFiles(rootDir);
  const sourceFiles = files.filter((file) => detectLanguage(file) !== null);

  const scanned = await mapWithLimit(sourceFiles, READ_CONCURRENCY, (file) => scanFile(rootDir, file));
  const kept = scanned.filter((result): result is ScannedFile => result !== null);
  const fileNodes = kept.map((result) => result.node);

  // Imports: every file was parsed while it was read; now match the imports to repo files.
  const factsByFile = new Map<string, ImportFacts>();
  for (const { node, imports } of kept) if (imports) factsByFile.set(node.path, imports);
  const dependencies = resolveImports(
    factsByFile,
    fileNodes.map((node) => node.path),
  );
  for (const node of fileNodes) {
    const imports = dependencies.get(node.path);
    if (imports) node.imports = imports;
  }

  const history = await historyPromise;
  if (history) {
    for (const node of fileNodes) {
      const stats = history.files.get(node.path);
      if (stats) node.git = stats;
    }
  }

  const repoName = path.basename(rootDir);
  const city: CityData = {
    version: 1,
    repoName,
    scannedAt: new Date().toISOString(),
    fileSource: source,
    git: history?.summary ?? null,
    cycles: findCycles(dependencies),
    root: buildTree(fileNodes, repoName),
  };
  const snapshots = await snapshotsPromise;
  if (snapshots) city.history = snapshots;
  return city;
}

interface ScannedFile {
  node: FileNode;
  /** Raw import facts (resolved later, once every file is known). Null if the language isn't supported. */
  imports: ImportFacts | null;
}

/** Reads one file and measures it. Returns null if the file should be left out. */
async function scanFile(rootDir: string, relativePath: string): Promise<ScannedFile | null> {
  const absolutePath = path.join(rootDir, relativePath);

  // git can list files that were deleted from disk but not yet committed — skip those.
  const stat = await fs.stat(absolutePath).catch(() => null);
  if (!stat?.isFile() || stat.size > MAX_FILE_BYTES) return null;

  const content = await fs.readFile(absolutePath);
  if (isBinary(content)) return null;

  const text = content.toString("utf8");
  const language = detectLanguage(relativePath)!;
  return {
    node: {
      type: "file",
      name: path.posix.basename(relativePath),
      path: relativePath,
      language,
      loc: countLoc(text),
      bytes: stat.size,
    },
    imports: parseImports(language, text),
  };
}

/**
 * Like `Promise.all(items.map(fn))`, but runs at most `limit` calls at once.
 * Starts `limit` workers; each one keeps taking the next item until none are left.
 */
async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await fn(items[index]);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}
