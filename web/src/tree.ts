import type { FileNode, FolderNode } from "../../shared/types";

/** Every file in the tree, in path order. */
export function collectFiles(folder: FolderNode): FileNode[] {
  const files: FileNode[] = [];
  for (const child of folder.children) {
    if (child.type === "folder") files.push(...collectFiles(child));
    else files.push(child);
  }
  return files;
}
