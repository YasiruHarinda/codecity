/**
 * The schema of city.json — the contract between the scanner and the web app.
 *
 * The scanner writes this shape, the web app reads it. Later phases will add
 * optional fields (git stats, imports, history) without breaking old files.
 *
 * All paths use forward slashes ("src/app/main.ts") on every OS.
 */

/** A source file. Becomes one building in the city. */
export interface FileNode {
  type: "file";
  /** File name only, e.g. "main.ts". */
  name: string;
  /** Path relative to the repo root, e.g. "src/app/main.ts". */
  path: string;
  /** Human-readable language name, e.g. "TypeScript". */
  language: string;
  /** Lines of code (non-blank lines). */
  loc: number;
  /** File size in bytes. */
  bytes: number;
  /** History from git. Missing if there is no git repo or the file was never committed. */
  git?: FileGitStats;
  /**
   * Repo files this file depends on (its imports, resolved to paths). Sorted.
   * Missing for languages we don't parse imports for.
   */
  imports?: string[];
}

/** One author's share of a file's history. */
export interface AuthorStats {
  name: string;
  commits: number;
}

/** Git history of one file. Dates are ISO strings in UTC. */
export interface FileGitStats {
  /** Number of commits that changed this file ("churn"). */
  commits: number;
  /** Number of different people who changed it. */
  authorCount: number;
  /** Up to 3 authors with the most commits, most first. */
  topAuthors: AuthorStats[];
  firstCommitDate: string;
  lastCommitDate: string;
}

/** Git history of the whole repo. */
export interface RepoGitSummary {
  totalCommits: number;
  authorCount: number;
  firstCommitDate: string;
  lastCommitDate: string;
}

/** A folder. Becomes a district in the city. */
export interface FolderNode {
  type: "folder";
  name: string;
  /** Path relative to the repo root. The root folder has path "". */
  path: string;
  /** Total LOC of every file inside this folder (recursively). */
  loc: number;
  /** Total number of files inside this folder (recursively). */
  fileCount: number;
  /** Sub-folders first, then files, each sorted by name. */
  children: TreeNode[];
}

export type TreeNode = FileNode | FolderNode;

/** The whole city.json file. */
export interface CityData {
  version: 1;
  repoName: string;
  /** ISO timestamp of when the scan ran. */
  scannedAt: string;
  /** How the file list was found: from git, or by walking the disk. */
  fileSource: "git" | "filesystem";
  /** null when the folder has no git history. */
  git: RepoGitSummary | null;
  /**
   * Circular dependencies: each entry is a group of files that (directly or indirectly) all
   * import each other. Missing in city files made before dependencies were added.
   */
  cycles?: string[][];
  /** Snapshots of the repo at points in its git history (only with `scan --history`). */
  history?: HistoryData;
  root: FolderNode;
}

/**
 * The repo at several points in time. Stored compactly: every file that ever existed is listed
 * once in `files`, and snapshots refer to files by their index in that list.
 */
export interface HistoryData {
  files: HistoryFile[];
  /** Oldest first. */
  snapshots: HistorySnapshot[];
}

export interface HistoryFile {
  path: string;
  language: string;
  /** Size the last time the file was seen (used for the footprint of files deleted since). */
  bytes: number;
}

export interface HistorySnapshot {
  commit: string;
  /** Commit date, ISO string in UTC. */
  date: string;
  /** Files that existed at this commit, as indexes into HistoryData.files... */
  fileIds: number[];
  /** ...and their lines of code, in the same order. */
  loc: number[];
}
