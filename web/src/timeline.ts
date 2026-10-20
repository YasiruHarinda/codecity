import type { CityData, FileNode, FolderNode, HistoryData } from "../../shared/types";
import { collectFiles } from "./tree";

/** One stop on the timeline slider. */
export interface TimelineFrame {
  /** Short text for the slider label, e.g. "12 Mar 2026". */
  label: string;
  /** Commit at this point, or null for "now" (the files on disk right now). */
  commit: string | null;
}

/**
 * The city at different moments: every history snapshot, plus "now" at the end.
 * Answers "how many lines did this file have at frame N?" (null = it didn't exist then).
 */
export class Timeline {
  readonly frames: TimelineFrame[];
  /** Index of the last frame, "now". */
  readonly nowIndex: number;
  private currentLoc: Map<string, number>;
  private snapshotLoc: Map<string, number>[] = [];

  constructor(
    city: CityData,
    private history: HistoryData,
  ) {
    this.currentLoc = new Map(collectFiles(city.root).map((file) => [file.path, file.loc]));
    this.frames = [
      ...history.snapshots.map((snapshot) => ({
        label: new Date(snapshot.date).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }),
        commit: snapshot.commit,
      })),
      { label: "Now", commit: null },
    ];
    this.nowIndex = this.frames.length - 1;
  }

  /** Lines of code of a file at a frame, or null if the file didn't exist then. */
  locAt(frame: number, path: string): number | null {
    if (frame >= this.nowIndex) return this.currentLoc.get(path) ?? null;
    return this.snapshot(frame).get(path) ?? null;
  }

  /** Snapshot as path → LOC, built the first time it's needed. */
  private snapshot(frame: number): Map<string, number> {
    let map = this.snapshotLoc[frame];
    if (!map) {
      const { fileIds, loc } = this.history.snapshots[frame];
      map = new Map(fileIds.map((id, i) => [this.history.files[id].path, loc[i]]));
      this.snapshotLoc[frame] = map;
    }
    return map;
  }
}

/**
 * For a stable layout over time, the city is laid out with EVERY file that ever existed.
 * Files that have been deleted since become "ghost" buildings: they only show up in the past.
 *
 * Returns a copy of the city (the original is not changed) with the ghost files added to their
 * folders, and the set of ghost paths. Folder totals (loc, fileCount) still describe today.
 */
export function withDeletedFiles(city: CityData): { layoutCity: CityData; deleted: Set<string> } {
  const deleted = new Set<string>();
  if (!city.history) return { layoutCity: city, deleted };

  const root = structuredClone(city.root);
  const existing = new Set(collectFiles(root).map((file) => file.path));

  for (const old of city.history.files) {
    if (existing.has(old.path)) continue;
    deleted.add(old.path);
    const parts = old.path.split("/");
    const ghost: FileNode = {
      type: "file",
      name: parts[parts.length - 1],
      path: old.path,
      language: old.language,
      loc: 0,
      bytes: old.bytes,
    };
    folderFor(root, parts.slice(0, -1)).children.push(ghost);
  }

  return { layoutCity: { ...city, root }, deleted };
}

/** Finds (or creates) the folder at a path below `root`. */
function folderFor(root: FolderNode, parts: string[]): FolderNode {
  let folder = root;
  for (let i = 0; i < parts.length; i++) {
    let child = folder.children.find((c): c is FolderNode => c.type === "folder" && c.name === parts[i]);
    if (!child) {
      child = { type: "folder", name: parts[i], path: parts.slice(0, i + 1).join("/"), loc: 0, fileCount: 0, children: [] };
      folder.children.push(child);
    }
    folder = child;
  }
  return folder;
}
