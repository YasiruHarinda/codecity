import { ARC_COLORS } from "../arcs";
import type { Legend } from "../colors";

/** How many languages to list before collapsing the rest into "+N more". */
const MAX_SWATCHES = 10;

/** Draws the legend box: what the colours mean, plus what sizes mean. */
export function renderLegend(root: HTMLElement, legend: Legend): void {
  const title = document.createElement("h3");
  title.textContent = legend.title;
  const parts: HTMLElement[] = [title];

  if (legend.kind === "gradient") {
    const bar = document.createElement("div");
    bar.className = "legend-bar";
    bar.style.background = `linear-gradient(to right, ${legend.stops.join(", ")})`;
    const labels = document.createElement("div");
    labels.className = "legend-labels";
    const min = document.createElement("span");
    min.textContent = legend.minLabel;
    const max = document.createElement("span");
    max.textContent = legend.maxLabel;
    labels.append(min, max);
    parts.push(bar, labels);
    if (legend.note) parts.push(note(legend.note));
  } else {
    const list = document.createElement("ul");
    list.className = "legend-swatches";
    for (const item of legend.items.slice(0, MAX_SWATCHES)) {
      const row = document.createElement("li");
      const swatch = document.createElement("i");
      swatch.style.background = item.color;
      const label = document.createElement("span");
      label.textContent = `${item.label} (${item.count})`;
      row.append(swatch, label);
      list.append(row);
    }
    parts.push(list);
    const hidden = legend.items.length - MAX_SWATCHES;
    if (hidden > 0) parts.push(note(`+${hidden} more`));
  }

  const sizes = document.createElement("p");
  sizes.className = "legend-sizes";
  sizes.textContent = "Height = lines of code · Width = file size (both log scale) · Blocks = folders, streets between them";
  parts.push(sizes, arcKey());

  root.replaceChildren(...parts);
}

/** "Arcs: — imports — imported by — cycle", each with a line in the arc's colour. */
function arcKey(): HTMLElement {
  const key = document.createElement("p");
  key.className = "legend-arcs";
  key.append("Arcs: ");
  const entries: [string, string][] = [
    ["imports", ARC_COLORS.imports],
    ["imported by", ARC_COLORS.importers],
    ["cycle", ARC_COLORS.cycle],
  ];
  for (const [label, color] of entries) {
    const line = document.createElement("i");
    line.style.background = color;
    key.append(line, label + " ");
  }
  return key;
}

function note(text: string): HTMLElement {
  const element = document.createElement("p");
  element.className = "legend-note";
  element.textContent = text;
  return element;
}
