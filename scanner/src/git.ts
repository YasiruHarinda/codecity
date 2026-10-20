import { spawn } from "node:child_process";
import readline from "node:readline";
import type { AuthorStats, FileGitStats, RepoGitSummary } from "../../shared/types";

// Invisible ASCII control characters, so they can never clash with a real author name.
const COMMIT_MARKER = "\x1e"; // "record separator": starts each commit header line
const FIELD_SEPARATOR = "\x1f"; // "unit separator": between author and date

/**
 * The single git command that reads the whole history.
 *   core.quotepath=off  print non-ASCII file names as-is instead of "\303\251" escapes
 *   --numstat           list "added  deleted  path" for every file a commit changed
 *   --no-renames        a rename shows as delete + add (keeps parsing simple)
 *   --relative          paths relative to the folder we run in (works for sub-folders)
 *   --format            our own header line per commit: marker, author name, ISO date
 *                       (%x1e / %x1f are git's way of writing those control characters)
 */
const GIT_LOG_ARGS = [
  "-c",
  "core.quotepath=off",
  "log",
  "--numstat",
  "--no-renames",
  "--relative",
  "--format=%x1e%aN%x1f%aI",
];

export interface GitHistory {
  summary: RepoGitSummary;
  /** Keyed by file path (forward slashes, relative to the scanned folder). */
  files: Map<string, FileGitStats>;
}

/** Running totals for one file while we read the log. */
interface FileTally {
  commits: number;
  commitsByAuthor: Map<string, number>;
  firstTime: number;
  lastTime: number;
}

/**
 * Reads `git log --numstat` output one line at a time and adds up stats per file.
 * Kept separate from running git so it can be unit-tested with fake log text.
 */
export class GitLogParser {
  private tallies = new Map<string, FileTally>();
  private authors = new Set<string>();
  private totalCommits = 0;
  private firstTime = Infinity;
  private lastTime = -Infinity;
  // The commit whose file lines we are currently reading.
  private current: { author: string; time: number } | null = null;

  feed(line: string): void {
    if (line.startsWith(COMMIT_MARKER)) {
      const [author, date] = line.slice(1).split(FIELD_SEPARATOR);
      // Compare dates as numbers: ISO strings with different time zones don't sort correctly as text.
      const time = Date.parse(date);
      this.current = { author, time };
      this.totalCommits++;
      this.authors.add(author);
      this.firstTime = Math.min(this.firstTime, time);
      this.lastTime = Math.max(this.lastTime, time);
      return;
    }

    // A numstat line: "12<TAB>3<TAB>src/app.ts" (binary files show "-<TAB>-<TAB>path").
    const parts = line.split("\t");
    if (!this.current || parts.length < 3) return; // blank line or something unexpected
    const filePath = parts.slice(2).join("\t");

    let tally = this.tallies.get(filePath);
    if (!tally) {
      tally = { commits: 0, commitsByAuthor: new Map(), firstTime: Infinity, lastTime: -Infinity };
      this.tallies.set(filePath, tally);
    }
    const { author, time } = this.current;
    tally.commits++;
    tally.commitsByAuthor.set(author, (tally.commitsByAuthor.get(author) ?? 0) + 1);
    tally.firstTime = Math.min(tally.firstTime, time);
    tally.lastTime = Math.max(tally.lastTime, time);
  }

  /** Returns the finished stats, or null if the log had no commits. */
  result(): GitHistory | null {
    if (this.totalCommits === 0) return null;

    const files = new Map<string, FileGitStats>();
    for (const [filePath, tally] of this.tallies) {
      files.set(filePath, {
        commits: tally.commits,
        authorCount: tally.commitsByAuthor.size,
        topAuthors: topAuthors(tally.commitsByAuthor, 3),
        firstCommitDate: new Date(tally.firstTime).toISOString(),
        lastCommitDate: new Date(tally.lastTime).toISOString(),
      });
    }

    return {
      summary: {
        totalCommits: this.totalCommits,
        authorCount: this.authors.size,
        firstCommitDate: new Date(this.firstTime).toISOString(),
        lastCommitDate: new Date(this.lastTime).toISOString(),
      },
      files,
    };
  }
}

/** The `count` authors with the most commits (ties broken by name, so output is stable). */
function topAuthors(commitsByAuthor: Map<string, number>, count: number): AuthorStats[] {
  return [...commitsByAuthor]
    .map(([name, commits]) => ({ name, commits }))
    .sort((a, b) => b.commits - a.commits || a.name.localeCompare(b.name))
    .slice(0, count);
}

/**
 * Runs git log in a folder and returns its history.
 * Returns null — never throws — if git isn't installed, it's not a repo, or there are no commits.
 */
export async function readGitHistory(rootDir: string): Promise<GitHistory | null> {
  const child = spawn("git", GIT_LOG_ARGS, { cwd: rootDir, stdio: ["ignore", "pipe", "ignore"] });
  const exitCode = new Promise<number | null>((resolve) => {
    child.on("error", () => resolve(null)); // e.g. git not installed
    child.on("close", resolve);
  });

  // Stream the output line by line instead of loading a possibly huge log into memory.
  const parser = new GitLogParser();
  try {
    for await (const line of readline.createInterface({ input: child.stdout, crlfDelay: Infinity })) {
      parser.feed(line);
    }
  } catch {
    // The stream broke (git crashed or failed to start); the exit code check below handles it.
  }

  return (await exitCode) === 0 ? parser.result() : null;
}
