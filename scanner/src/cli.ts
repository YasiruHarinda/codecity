#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import type { FileNode, FolderNode } from "../../shared/types";
import { scanRepo } from "./scan";

function collectFiles(folder: FolderNode): FileNode[] {
  return folder.children.flatMap((child) => (child.type === "file" ? [child] : collectFiles(child)));
}

const DEFAULT_HISTORY_POINTS = 30;

const program = new Command();

program
  .name("codecity")
  .description("Turn a code repository into a 3D city")
  .version("0.1.0");

program
  .command("scan")
  .description("Scan a repository and write city.json")
  .argument("<repo-path>", "folder to scan")
  .option("-o, --output <file>", "where to write the JSON", "city.json")
  .option("--history [points]", `also sample git history for the timeline (default ${DEFAULT_HISTORY_POINTS} points)`)
  .action(async (repoPath: string, options: { output: string; history?: boolean | string }) => {
    const startTime = performance.now();

    let historyPoints: number | undefined;
    if (options.history) {
      historyPoints = options.history === true ? DEFAULT_HISTORY_POINTS : Number(options.history);
      if (!Number.isInteger(historyPoints) || historyPoints < 2) {
        throw new Error("--history needs a whole number of points, 2 or more");
      }
    }

    const city = await scanRepo(repoPath, { historyPoints });

    const outputPath = path.resolve(options.output);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    // Indented JSON is nice to read, but history puts one number per line and gets huge — so
    // with history the file is written compact.
    await fs.writeFile(outputPath, city.history ? JSON.stringify(city) : JSON.stringify(city, null, 2));

    const seconds = ((performance.now() - startTime) / 1000).toFixed(2);
    console.log(`Scanned "${city.repoName}" (file list from ${city.fileSource})`);
    console.log(`  ${city.root.fileCount} files, ${city.root.loc} lines of code`);
    if (city.git) {
      const from = city.git.firstCommitDate.slice(0, 10);
      const to = city.git.lastCommitDate.slice(0, 10);
      const authors = city.git.authorCount === 1 ? "author" : "authors";
      console.log(`  ${city.git.totalCommits} commits by ${city.git.authorCount} ${authors} (${from} → ${to})`);
    } else {
      console.log("  No git history found — git stats skipped");
    }
    const files = collectFiles(city.root);
    const edges = files.reduce((sum, file) => sum + (file.imports?.length ?? 0), 0);
    const parsed = files.filter((file) => file.imports).length;
    const cycles = city.cycles?.length ?? 0;
    console.log(`  ${edges} dependencies between ${parsed} parsed files, ${cycles} circular group${cycles === 1 ? "" : "s"}`);
    if (city.history) {
      const { snapshots, files: everFiles } = city.history;
      const from = snapshots[0].date.slice(0, 10);
      const to = snapshots[snapshots.length - 1].date.slice(0, 10);
      console.log(`  History: ${snapshots.length} snapshots (${from} → ${to}), ${everFiles.length} files ever existed`);
    } else if (historyPoints) {
      console.log("  History: no git history found — timeline skipped");
    }
    console.log(`  Wrote ${outputPath} in ${seconds}s`);
  });

program.parseAsync().catch((error: Error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
