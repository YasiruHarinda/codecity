import path from "node:path";
import type { FileNode, FolderNode, TreeNode } from "../../shared/types";

/**
 * Turns a flat list of files into a folder tree.
 *
 *   ["src/a.ts", "src/lib/b.ts"]   →   root
 *                                       └─ src
 *                                           ├─ lib
 *                                           │   └─ b.ts
 *                                           └─ a.ts
 *
 * Each folder's loc and fileCount are the totals of everything inside it.
 */
export function buildTree(files: FileNode[], rootName: string): FolderNode {
  const root = createFolder(rootName, "");
  // Remember every folder by its path so we never create the same one twice.
  const foldersByPath = new Map<string, FolderNode>([["", root]]);

  // Returns the folder for a path, creating it (and its missing parents) if needed — like `mkdir -p`.
  function getFolder(folderPath: string): FolderNode {
    const existing = foldersByPath.get(folderPath);
    if (existing) return existing;

    const parentPath = path.posix.dirname(folderPath);
    const parent = getFolder(parentPath === "." ? "" : parentPath);
    const folder = createFolder(path.posix.basename(folderPath), folderPath);
    parent.children.push(folder);
    foldersByPath.set(folderPath, folder);
    return folder;
  }

  for (const file of files) {
    const folderPath = path.posix.dirname(file.path);
    getFolder(folderPath === "." ? "" : folderPath).children.push(file);
  }

  finalize(root);
  return root;
}

function createFolder(name: string, folderPath: string): FolderNode {
  return { type: "folder", name, path: folderPath, loc: 0, fileCount: 0, children: [] };
}

/** Sorts children and adds up totals, from the deepest folders upward. */
function finalize(folder: FolderNode): void {
  folder.loc = 0;
  folder.fileCount = 0;

  for (const child of folder.children) {
    if (child.type === "folder") {
      finalize(child);
      folder.fileCount += child.fileCount;
    } else {
      folder.fileCount += 1;
    }
    folder.loc += child.loc;
  }

  folder.children.sort(compareNodes);
}

/** Folders before files, then alphabetical. */
function compareNodes(a: TreeNode, b: TreeNode): number {
  if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
  return a.name.localeCompare(b.name);
}
