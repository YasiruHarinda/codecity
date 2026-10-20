import type { CityData } from "../../shared/types";
import { collectFiles } from "./tree";

/** Fast lookups over the city's import graph. */
export interface DependencyIndex {
  /** Every dependency as [importer, imported]. */
  edges: [string, string][];
  /** Files this file imports. */
  importsOf(path: string): string[];
  /** Files that import this file. */
  importersOf(path: string): string[];
  /** The circular group this file belongs to, if any. */
  cycleOf(path: string): string[] | undefined;
  /** True if both ends are in the same circular group — this edge is part of a cycle. */
  isCycleEdge(from: string, to: string): boolean;
  cycleCount: number;
}

/** Index for "no city loaded yet". */
export const NO_DEPENDENCIES = buildDependencyIndex({
  version: 1,
  repoName: "",
  scannedAt: "",
  fileSource: "filesystem",
  git: null,
  root: { type: "folder", name: "", path: "", loc: 0, fileCount: 0, children: [] },
});

export function buildDependencyIndex(city: CityData): DependencyIndex {
  const imports = new Map<string, string[]>();
  const importers = new Map<string, string[]>();
  const edges: [string, string][] = [];

  for (const file of collectFiles(city.root)) {
    for (const target of file.imports ?? []) {
      edges.push([file.path, target]);
      imports.set(file.path, [...(imports.get(file.path) ?? []), target]);
      importers.set(target, [...(importers.get(target) ?? []), file.path]);
    }
  }

  const cycles = city.cycles ?? [];
  const cycleByFile = new Map<string, string[]>();
  for (const cycle of cycles) for (const path of cycle) cycleByFile.set(path, cycle);

  return {
    edges,
    importsOf: (path) => imports.get(path) ?? [],
    importersOf: (path) => importers.get(path) ?? [],
    cycleOf: (path) => cycleByFile.get(path),
    isCycleEdge: (from, to) => {
      const cycle = cycleByFile.get(from);
      return cycle !== undefined && cycle === cycleByFile.get(to);
    },
    cycleCount: cycles.length,
  };
}
