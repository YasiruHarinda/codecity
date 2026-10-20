import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promisify } from "node:util";
import type { HistoryData, HistoryFile, HistorySnapshot } from "../../shared/types";
import { detectLanguage } from "./languages";
import { countLoc, isBinary } from "./loc";
import { isInSkippedFolder } from "./walk";

const execFileAsync = promisify(execFile);

/** Same limit as the normal scan: bigger files are generated or data, not code. */
const MAX_FILE_BYTES = 1024 * 1024;

export interface CommitPoint {
  hash: string;
  /** Milliseconds since 1970. */
  time: number;
}

/**
 * Samples the repo at `points` moments in its history, without checking anything out.
 *   1. `git log --first-parent` → the main line of commits, oldest first
 *   2. pick commits at evenly spaced moments in time
 *   3. for each: `git ls-tree` lists its files, `git cat-file --batch` reads their contents
 * Returns null if there's no git history.
 */
export async function readHistory(rootDir: string, points: number): Promise<HistoryData | null> {
  let commits: CommitPoint[];
  try {
    const { stdout } = await execFileAsync("git", ["log", "--first-parent", "--reverse", "--format=%H %cI"], {
      cwd: rootDir,
      maxBuffer: 256 * 1024 * 1024,
    });
    commits = stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, date] = line.split(" ");
        return { hash, time: Date.parse(date) };
      });
  } catch {
    return null; // not a git repo, or no commits yet
  }
  if (commits.length === 0) return null;

  const files: HistoryFile[] = [];
  const fileIndex = new Map<string, number>();
  // Lines of code per blob. A blob ID is a hash of the content, so the same ID always means
  // the same content — each unique blob is read and counted only once across all snapshots.
  const locByBlob = new Map<string, number | null>();
  const reader = new GitBlobReader(rootDir);
  const snapshots: HistorySnapshot[] = [];

  // List every sampled commit's files at the same time — each git process has a startup cost,
  // so running them side by side is much faster than one after another.
  const sampled = sampleCommits(commits, points);
  const trees = await Promise.all(sampled.map((commit) => listTree(rootDir, commit.hash)));

  try {
    for (const [index, commit] of sampled.entries()) {
      const entries = trees[index].filter(
        (entry) => entry.size <= MAX_FILE_BYTES && !isInSkippedFolder(entry.path) && detectLanguage(entry.path),
      );

      // Ask for all new blobs at once; git answers them one after another through the same pipe.
      const newBlobs = [...new Set(entries.map((entry) => entry.blob).filter((blob) => !locByBlob.has(blob)))];
      await Promise.all(
        newBlobs.map(async (blob) => {
          const content = await reader.read(blob);
          locByBlob.set(blob, content && !isBinary(content) ? countLoc(content.toString("utf8")) : null);
        }),
      );

      const snapshot: HistorySnapshot = {
        commit: commit.hash,
        date: new Date(commit.time).toISOString(),
        fileIds: [],
        loc: [],
      };
      for (const entry of entries) {
        const loc = locByBlob.get(entry.blob);
        if (loc === null || loc === undefined) continue; // binary
        let id = fileIndex.get(entry.path);
        if (id === undefined) {
          id = files.length;
          fileIndex.set(entry.path, id);
          files.push({ path: entry.path, language: detectLanguage(entry.path)!, bytes: entry.size });
        }
        files[id].bytes = entry.size; // keep the latest size
        snapshot.fileIds.push(id);
        snapshot.loc.push(loc);
      }
      snapshots.push(snapshot);
    }
  } finally {
    await reader.close();
  }

  return { files, snapshots };
}

/**
 * Picks up to `points` commits, spread evenly over time from the first commit to the last.
 * For each moment we take the last commit made at or before it. The newest commit is always included.
 * @param commits oldest first
 */
export function sampleCommits(commits: CommitPoint[], points: number): CommitPoint[] {
  if (commits.length <= points) return commits;
  const first = commits[0].time;
  const last = commits[commits.length - 1].time;

  const picked: CommitPoint[] = [];
  let index = 0;
  for (let i = 0; i < points; i++) {
    const moment = first + ((last - first) * i) / (points - 1);
    // Move forward while the next commit is still at or before this moment.
    while (index + 1 < commits.length && commits[index + 1].time <= moment) index++;
    if (picked[picked.length - 1] !== commits[index]) picked.push(commits[index]);
  }
  if (picked[picked.length - 1] !== commits[commits.length - 1]) picked.push(commits[commits.length - 1]);
  return picked;
}

export interface TreeEntry {
  blob: string;
  size: number;
  path: string;
}

/**
 * Parses `git ls-tree -r -l -z` output. Each entry is
 *   "<mode> <type> <object id> <size, padded>\t<path>\0"
 * Only "blob" entries are files; "commit" entries are submodules and are skipped.
 */
export function parseLsTree(output: string): TreeEntry[] {
  const entries: TreeEntry[] = [];
  for (const record of output.split("\0")) {
    const tab = record.indexOf("\t");
    if (tab === -1) continue;
    const [, type, blob, size] = record.slice(0, tab).trim().split(/\s+/);
    if (type !== "blob") continue;
    entries.push({ blob, size: Number(size), path: record.slice(tab + 1) });
  }
  return entries;
}

/**
 * Lists every file in a commit. Run inside the scanned folder, git only lists files below it,
 * with paths relative to it — so scanning a sub-folder of a repo works too.
 */
async function listTree(rootDir: string, commit: string): Promise<TreeEntry[]> {
  const { stdout } = await execFileAsync("git", ["-c", "core.quotepath=off", "ls-tree", "-r", "-l", "-z", commit], {
    cwd: rootDir,
    maxBuffer: 256 * 1024 * 1024,
  });
  return parseLsTree(stdout);
}

/**
 * Reads file contents (blobs) from git through ONE long-running `git cat-file --batch` process,
 * instead of starting a `git show` process per file — thousands of times faster on big repos.
 *
 * We write "<blob id>\n"; git replies "<id> blob <size>\n<content>\n" (or "<id> missing\n").
 * Replies come back in the same order as requests, so a simple queue matches them up.
 */
class GitBlobReader {
  private process: ChildProcessWithoutNullStreams;
  private waiting: { resolve: (content: Buffer | null) => void; reject: (error: Error) => void }[] = [];
  private buffered: Buffer = Buffer.alloc(0);
  private exited: Promise<void>;

  constructor(cwd: string) {
    this.process = spawn("git", ["cat-file", "--batch"], { cwd });
    this.exited = new Promise((resolve) => this.process.on("close", () => resolve()));
    this.process.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
    this.process.stderr.resume(); // ignore, but keep it from filling up
    const failAll = (error: Error) => {
      for (const request of this.waiting.splice(0)) request.reject(error);
    };
    this.process.on("error", failAll);
    this.process.on("close", () => failAll(new Error("git cat-file stopped unexpectedly")));
  }

  read(blob: string): Promise<Buffer | null> {
    return new Promise((resolve, reject) => {
      this.waiting.push({ resolve, reject });
      this.process.stdin.write(blob + "\n");
    });
  }

  /** Tells git we're done and waits for it to exit (on Windows a running process locks its folder). */
  async close(): Promise<void> {
    this.process.stdin.end();
    await this.exited;
  }

  private onData(chunk: Buffer): void {
    this.buffered = this.buffered.length === 0 ? chunk : Buffer.concat([this.buffered, chunk]);

    // Take out as many complete replies as we have.
    while (true) {
      const newline = this.buffered.indexOf(10); // end of the header line
      if (newline === -1) return;
      const header = this.buffered.subarray(0, newline).toString().split(" ");

      if (header[1] === "missing") {
        this.buffered = this.buffered.subarray(newline + 1);
        this.waiting.shift()?.resolve(null);
        continue;
      }

      const size = Number(header[2]);
      const end = newline + 1 + size;
      if (this.buffered.length < end + 1) return; // content not fully arrived yet
      const content = this.buffered.subarray(newline + 1, end);
      this.buffered = this.buffered.subarray(end + 1); // +1 skips the newline after the content
      this.waiting.shift()?.resolve(content);
    }
  }
}
