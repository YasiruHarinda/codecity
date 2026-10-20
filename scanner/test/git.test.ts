import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GitLogParser, readGitHistory } from "../src/git";

/** Builds a fake commit header line the same way our --format does. */
const header = (author: string, date: string) => `\x1e${author}\x1f${date}`;

function parse(lines: string[]) {
  const parser = new GitLogParser();
  lines.forEach((line) => parser.feed(line));
  return parser.result();
}

describe("GitLogParser", () => {
  // git log prints newest commits first.
  const history = parse([
    header("Alice", "2026-03-01T10:00:00+05:30"),
    "",
    "5\t1\tsrc/app.ts",
    "-\t-\tlogo.png",
    header("Bob", "2026-02-01T10:00:00Z"),
    "",
    "2\t2\tsrc/app.ts",
    header("Alice", "2026-01-01T10:00:00Z"),
    "",
    "10\t0\tsrc/app.ts",
    "3\t0\tsrc/util.ts",
    header("Carol", "2025-12-01T10:00:00Z"), // a merge commit: header only, no files
  ]);

  it("counts commits per file", () => {
    expect(history!.files.get("src/app.ts")!.commits).toBe(3);
    expect(history!.files.get("src/util.ts")!.commits).toBe(1);
  });

  it("includes binary files (shown as '-' in numstat)", () => {
    expect(history!.files.get("logo.png")!.commits).toBe(1);
  });

  it("ranks top authors by commit count", () => {
    const app = history!.files.get("src/app.ts")!;
    expect(app.authorCount).toBe(2);
    expect(app.topAuthors).toEqual([
      { name: "Alice", commits: 2 },
      { name: "Bob", commits: 1 },
    ]);
  });

  it("finds first and last commit dates, converted to UTC", () => {
    const app = history!.files.get("src/app.ts")!;
    expect(app.firstCommitDate).toBe("2026-01-01T10:00:00.000Z");
    expect(app.lastCommitDate).toBe("2026-03-01T04:30:00.000Z"); // 10:00 at +05:30 = 04:30 UTC
  });

  it("summarises the whole repo, including commits with no files", () => {
    expect(history!.summary).toEqual({
      totalCommits: 4,
      authorCount: 3,
      firstCommitDate: "2025-12-01T10:00:00.000Z",
      lastCommitDate: "2026-03-01T04:30:00.000Z",
    });
  });

  it("returns null when there are no commits", () => {
    expect(parse([])).toBeNull();
  });
});

describe("readGitHistory", () => {
  const tempDirs: string[] = [];
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function makeDir(): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), "codecity-git-"));
    tempDirs.push(dir);
    return dir;
  }

  /** Makes a commit with a fixed author and date, without touching the user's git config. */
  function commit(dir: string, author: string, date: string, message: string) {
    execFileSync("git", ["-c", "core.autocrlf=false", "add", "-A"], { cwd: dir });
    execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-q", "-m", message], {
      cwd: dir,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: author,
        GIT_AUTHOR_EMAIL: `${author}@example.com`,
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_NAME: author,
        GIT_COMMITTER_EMAIL: `${author}@example.com`,
        GIT_COMMITTER_DATE: date,
      },
    });
  }

  it("reads a real repo's history", async () => {
    const dir = makeDir();
    execFileSync("git", ["init", "-q"], { cwd: dir });
    writeFileSync(path.join(dir, "a.ts"), "one\n");
    commit(dir, "Alice", "2026-01-01T00:00:00Z", "first");
    writeFileSync(path.join(dir, "a.ts"), "one\ntwo\n");
    writeFileSync(path.join(dir, "b.ts"), "x\n");
    commit(dir, "Bob", "2026-02-01T00:00:00Z", "second");

    const history = await readGitHistory(dir);
    expect(history!.summary.totalCommits).toBe(2);
    expect(history!.files.get("a.ts")!.commits).toBe(2);
    expect(history!.files.get("b.ts")!.topAuthors).toEqual([{ name: "Bob", commits: 1 }]);
  });

  it("returns null for a repo with no commits yet", async () => {
    const dir = makeDir();
    execFileSync("git", ["init", "-q"], { cwd: dir });
    expect(await readGitHistory(dir)).toBeNull();
  });

  it("returns null for a folder that is not a git repo", async () => {
    expect(await readGitHistory(makeDir())).toBeNull();
  });
});
