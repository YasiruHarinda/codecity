import type { FileNode, FolderNode } from "../../../shared/types";
import { formatBytes, formatDate } from "./format";

/** A file's dependencies, for the panel. */
export interface FileDependencies {
  /** False if we don't parse imports for this file's language. */
  parsed: boolean;
  imports: FileNode[];
  importers: FileNode[];
  /** Other files in the same circular group, if the file is in one. */
  cycle: FileNode[] | null;
}

/** Longer lists are cut off with "+N more". */
const MAX_LIST = 12;

/**
 * The side panel with details about the clicked building or district.
 * Everything is added with textContent (never innerHTML): file names come from someone
 * else's repo, and a name like "<img onerror=...>" must show as text, not run as code.
 */
export class DetailsPanel {
  private title: HTMLElement;
  private subtitle: HTMLElement;
  private body: HTMLElement;
  private flyButton: HTMLButtonElement;
  private current: FileNode | null = null;

  constructor(
    private root: HTMLElement,
    onClose: () => void,
    onFlyTo: (file: FileNode) => void,
    /** Called when a file name in a dependency list is clicked. */
    private onPickFile: (file: FileNode) => void,
  ) {
    this.title = root.querySelector(".panel-title")!;
    this.subtitle = root.querySelector(".panel-subtitle")!;
    this.body = root.querySelector(".panel-body")!;
    this.flyButton = root.querySelector(".panel-fly")!;
    root.querySelector(".panel-close")!.addEventListener("click", onClose);
    this.flyButton.addEventListener("click", () => this.current && onFlyTo(this.current));
  }

  /** @param note optional line shown at the top, e.g. "Deleted — exists only in the past" */
  showFile(file: FileNode, dependencies: FileDependencies, note?: string): void {
    this.current = file;
    this.title.textContent = file.name;
    this.subtitle.textContent = file.path;
    this.flyButton.hidden = false;

    const rows: [string, string][] = [
      ["Language", file.language],
      ["Lines of code", file.loc.toLocaleString()],
      ["Size", formatBytes(file.bytes)],
    ];
    const git = file.git;
    if (git) {
      rows.push(
        ["Commits", git.commits.toLocaleString()],
        ["Authors", git.authorCount.toLocaleString()],
        ["Created", formatDate(git.firstCommitDate)],
        ["Last modified", formatDate(git.lastCommitDate)],
      );
    } else {
      rows.push(["Git history", "none (not committed, or no git repo)"]);
    }

    const sections: HTMLElement[] = [];
    if (note) {
      const noteElement = document.createElement("p");
      noteElement.className = "panel-note";
      noteElement.textContent = note;
      sections.push(noteElement);
    }
    if (dependencies.cycle) {
      const warning = document.createElement("p");
      warning.className = "panel-cycle";
      warning.textContent = `⚠ Circular dependency with ${dependencies.cycle.length} other file${dependencies.cycle.length === 1 ? "" : "s"}`;
      sections.push(warning);
    }
    sections.push(table(rows));

    if (git && git.topAuthors.length > 0) {
      const heading = document.createElement("h3");
      heading.textContent = "Top authors";
      const list = document.createElement("ol");
      for (const author of git.topAuthors) {
        const item = document.createElement("li");
        item.textContent = `${author.name} — ${author.commits} commit${author.commits === 1 ? "" : "s"}`;
        list.append(item);
      }
      sections.push(heading, list);
    }

    if (dependencies.parsed) {
      if (dependencies.cycle) sections.push(...this.fileList("In the cycle with", dependencies.cycle, "cycle"));
      sections.push(...this.fileList("Imports", dependencies.imports, "imports"));
      sections.push(...this.fileList("Imported by", dependencies.importers, "importers"));
    } else if (dependencies.importers.length > 0) {
      // We can't read this language's imports, but other files may still import it (e.g. a .json file).
      sections.push(...this.fileList("Imported by", dependencies.importers, "importers"));
    }

    this.body.replaceChildren(...sections);
    this.root.hidden = false;
  }

  /** A heading with a count, then clickable file names (with a colour mark matching the arcs). */
  private fileList(title: string, files: FileNode[], kind: "imports" | "importers" | "cycle"): HTMLElement[] {
    const heading = document.createElement("h3");
    heading.textContent = `${title} (${files.length})`;
    if (files.length === 0) return [heading];

    const list = document.createElement("ul");
    list.className = `panel-files ${kind}`;
    for (const file of files.slice(0, MAX_LIST)) {
      const item = document.createElement("li");
      const link = document.createElement("button");
      link.textContent = file.name;
      link.title = file.path;
      link.addEventListener("click", () => this.onPickFile(file));
      item.append(link);
      list.append(item);
    }
    if (files.length > MAX_LIST) {
      const more = document.createElement("li");
      more.textContent = `+${files.length - MAX_LIST} more`;
      list.append(more);
    }
    return [heading, list];
  }

  showFolder(folder: FolderNode, repoName: string): void {
    this.current = null;
    this.title.textContent = `${folder.name || repoName}/`;
    this.subtitle.textContent = folder.path || "(repository root)";
    this.flyButton.hidden = true;

    const subFolders = folder.children.filter((child) => child.type === "folder").length;
    this.body.replaceChildren(
      table([
        ["Files (all levels)", folder.fileCount.toLocaleString()],
        ["Lines of code", folder.loc.toLocaleString()],
        ["Sub-folders", subFolders.toLocaleString()],
      ]),
    );
    this.root.hidden = false;
  }

  hide(): void {
    this.current = null;
    this.root.hidden = true;
  }
}

function table(rows: [string, string][]): HTMLTableElement {
  const element = document.createElement("table");
  for (const [label, value] of rows) {
    const row = element.insertRow();
    const th = document.createElement("th");
    th.textContent = label;
    const td = document.createElement("td");
    td.textContent = value;
    row.append(th, td);
  }
  return element;
}
