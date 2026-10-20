import { Color } from "three";
import type { FileNode } from "../../shared/types";

export type ColorMode = "churn" | "language" | "age";

/** What the legend should show for the current colour mode. */
export type Legend =
  | { kind: "gradient"; title: string; stops: string[]; minLabel: string; maxLabel: string; note?: string }
  | { kind: "swatches"; title: string; items: { label: string; color: string; count: number }[] };

/** A colour mode applied to one city: a colour for every file, plus the matching legend. */
export interface ColorScale {
  colorFor(file: FileNode): Color;
  legend: Legend;
}

const NO_DATA_COLOR = new Color("#8a8f98");
const NO_GIT_NOTE = "Grey = no git history";

export function createColorScale(mode: ColorMode, files: FileNode[]): ColorScale {
  switch (mode) {
    case "churn":
      return churnScale(files);
    case "language":
      return languageScale(files);
    case "age":
      return ageScale(files);
  }
}

// ---------- Churn: how many commits touched the file ----------

/** Heat map: hue 0.62 (blue) → 0 (red), passing cyan, green and yellow. */
function heat(t: number): Color {
  return new Color().setHSL(0.62 * (1 - t), 0.75, 0.5);
}

function churnScale(files: FileNode[]): ColorScale {
  const maxCommits = Math.max(0, ...files.map((f) => f.git?.commits ?? 0));
  return {
    colorFor(file) {
      if (!file.git) return NO_DATA_COLOR;
      // Log scale, so one extremely busy file doesn't make everything else look blue.
      // A file in git always has at least 1 commit, and log(1) = 0 → pure blue.
      const t = maxCommits <= 1 ? 0 : Math.log(file.git.commits) / Math.log(maxCommits);
      return heat(t);
    },
    legend: {
      kind: "gradient",
      title: "Churn (commits)",
      stops: sampleStops(heat),
      minLabel: "1",
      maxLabel: String(Math.max(1, maxCommits)),
      note: files.some((f) => !f.git) ? NO_GIT_NOTE : undefined,
    },
  };
}

// ---------- Age: when the file was last changed ----------

/** Old = dark purple, recent = bright orange. */
function ageColor(t: number): Color {
  return new Color().setHSL(0.75 - 0.67 * t, 0.65, 0.35 + 0.2 * t);
}

function ageScale(files: FileNode[]): ColorScale {
  const times = files.filter((f) => f.git).map((f) => Date.parse(f.git!.lastCommitDate));
  const oldest = Math.min(...times);
  const newest = Math.max(...times);
  const dateLabel = (time: number) => (Number.isFinite(time) ? new Date(time).toLocaleDateString() : "–");

  return {
    colorFor(file) {
      if (!file.git) return NO_DATA_COLOR;
      const time = Date.parse(file.git.lastCommitDate);
      const t = newest === oldest ? 1 : (time - oldest) / (newest - oldest);
      return ageColor(t);
    },
    legend: {
      kind: "gradient",
      title: "Last modified",
      stops: sampleStops(ageColor),
      minLabel: dateLabel(oldest),
      maxLabel: dateLabel(newest),
      note: files.some((f) => !f.git) ? NO_GIT_NOTE : undefined,
    },
  };
}

// ---------- Language ----------

/** GitHub-style colours for common languages. Others get a colour derived from their name. */
const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Python: "#3572a5",
  "C#": "#178600",
  Java: "#b07219",
  Kotlin: "#a97bff",
  Go: "#00add8",
  Rust: "#dea584",
  C: "#555555",
  "C++": "#f34b7d",
  Ruby: "#701516",
  PHP: "#4f5d95",
  Swift: "#f05138",
  HTML: "#e34c26",
  CSS: "#663399",
  SCSS: "#c6538c",
  Vue: "#41b883",
  JSON: "#9aa0a6",
  YAML: "#cb171e",
  XML: "#0060ac",
  Markdown: "#083fa1",
  Shell: "#89e051",
  PowerShell: "#012456",
  SQL: "#e38c00",
  Terraform: "#7b42bc",
  Dockerfile: "#384d54",
};

export function languageColor(language: string): Color {
  const known = LANGUAGE_COLORS[language];
  if (known) return new Color(known);
  // Turn the name into a number (a simple hash), then into a hue — same name, same colour, every time.
  let hash = 0;
  for (const char of language) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return new Color().setHSL((hash % 360) / 360, 0.55, 0.5);
}

function languageScale(files: FileNode[]): ColorScale {
  const counts = new Map<string, number>();
  for (const file of files) counts.set(file.language, (counts.get(file.language) ?? 0) + 1);

  const items = [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label, count]) => ({ label, count, color: `#${languageColor(label).getHexString()}` }));

  return {
    colorFor: (file) => languageColor(file.language),
    legend: { kind: "swatches", title: "Language", items },
  };
}

/** Five CSS colours along a scale, for drawing the legend's gradient bar. */
function sampleStops(scale: (t: number) => Color): string[] {
  return [0, 0.25, 0.5, 0.75, 1].map((t) => `#${scale(t).getHexString()}`);
}
