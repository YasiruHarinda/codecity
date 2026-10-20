import type { FileNode } from "../../../shared/types";

/**
 * Finds files matching a search, best matches first:
 *   exact file name  >  name starts with  >  name contains  >  path contains
 * Ties go to the shorter path (usually the more "central" file).
 */
export function searchFiles(files: FileNode[], query: string, limit = 8): FileNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const matches: { file: FileNode; rank: number }[] = [];
  for (const file of files) {
    const name = file.name.toLowerCase();
    let rank: number;
    if (name === q) rank = 0;
    else if (name.startsWith(q)) rank = 1;
    else if (name.includes(q)) rank = 2;
    else if (file.path.toLowerCase().includes(q)) rank = 3;
    else continue;
    matches.push({ file, rank });
  }

  return matches
    .sort((a, b) => a.rank - b.rank || a.file.path.length - b.file.path.length || a.file.path.localeCompare(b.file.path))
    .slice(0, limit)
    .map((match) => match.file);
}

/** The search box: type to see matches, arrow keys to move, Enter or click to pick. */
export class SearchBox {
  private files: FileNode[] = [];
  private results: FileNode[] = [];
  private active = 0;

  constructor(
    private input: HTMLInputElement,
    private list: HTMLUListElement,
    private onPick: (file: FileNode) => void,
  ) {
    input.addEventListener("input", () => this.update());
    input.addEventListener("keydown", (event) => this.onKey(event));
    input.addEventListener("blur", () => this.close());
    input.addEventListener("focus", () => this.update());
  }

  setFiles(files: FileNode[]): void {
    this.files = files;
    this.input.value = "";
    this.close();
  }

  private update(): void {
    this.results = searchFiles(this.files, this.input.value);
    this.active = 0;
    this.render();
  }

  private onKey(event: KeyboardEvent): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (this.results.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      this.active = (this.active + step + this.results.length) % this.results.length;
      this.render();
      event.preventDefault(); // stop the text cursor jumping to the start/end
    } else if (event.key === "Enter" && this.results[this.active]) {
      this.pick(this.results[this.active]);
    } else if (event.key === "Escape") {
      this.input.blur();
    }
  }

  private pick(file: FileNode): void {
    this.input.value = file.name;
    this.close();
    this.input.blur();
    this.onPick(file);
  }

  private close(): void {
    this.results = [];
    this.render();
  }

  private render(): void {
    this.list.replaceChildren(
      ...this.results.map((file, index) => {
        const item = document.createElement("li");
        item.classList.toggle("active", index === this.active);
        const name = document.createElement("strong");
        name.textContent = file.name;
        const path = document.createElement("span");
        path.textContent = file.path;
        item.append(name, path);
        // mousedown (not click) fires before the input's blur closes the list.
        item.addEventListener("mousedown", (event) => {
          event.preventDefault();
          this.pick(file);
        });
        return item;
      }),
    );
    this.list.hidden = this.results.length === 0;
  }
}
