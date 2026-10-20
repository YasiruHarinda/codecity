import { Color } from "three";
import type { CityData, FileNode, FolderNode } from "../../shared/types";
import { ARC_COLORS, type Arc } from "./arcs";
import type { ColorMode } from "./colors";
import { buildDependencyIndex, NO_DEPENDENCIES, type DependencyIndex } from "./dependencies";
import { buildingHeight } from "./layout/sizes";
import { loadCityFromFile, loadCityFromUrl } from "./loadCity";
import { Timeline, withDeletedFiles } from "./timeline";
import { collectFiles } from "./tree";
import { renderLegend } from "./ui/legend";
import { DetailsPanel } from "./ui/panel";
import { SearchBox } from "./ui/search";
import { CityViewer } from "./viewer";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const viewer = new CityViewer($("app"));
const repoName = $("repo-name");
const stats = $("stats");
const tooltip = $("tooltip");
const legend = $("legend");
const modeButtons = document.querySelectorAll<HTMLButtonElement>("#color-modes button");
const showAllDeps = $<HTMLInputElement>("show-all-deps");
const depsLabel = $("deps-label");
const cyclesSummary = $("cycles-summary");
const timelineBar = $("timeline");
const playButton = $<HTMLButtonElement>("play");
const timeSlider = $<HTMLInputElement>("time-slider");
const timeLabel = $("time-label");

let city: CityData | null = null;
/** Only set when the city was scanned with --history. */
let timeline: Timeline | null = null;
let frame = 0;
/** Files that existed in the past but not any more ("ghost" buildings). */
let deletedPaths = new Set<string>();
let playTimer: number | undefined;
let filesByPath = new Map<string, FileNode>();
let dependencies: DependencyIndex = NO_DEPENDENCIES;
let selectedFile: FileNode | null = null;
let colorMode: ColorMode = "churn";

const panel = new DetailsPanel(
  $("panel"),
  () => selectFile(null),
  (file) => flyToFile(file),
  (file) => {
    selectFile(file);
    flyToFile(file);
  },
);
const search = new SearchBox($("search"), $("search-results"), (file) => {
  selectFile(file);
  flyToFile(file);
});

// ---------- Loading ----------

function show(data: CityData): void {
  city = data;
  const files = collectFiles(data.root);
  filesByPath = new Map(files.map((file) => [file.path, file]));
  dependencies = buildDependencyIndex(data);
  selectedFile = null;
  stopPlaying();

  // With history, lay out every file that ever existed, so buildings keep their place over time.
  const { layoutCity, deleted } = withDeletedFiles(data);
  deletedPaths = deleted;
  renderLegend(legend, viewer.showCity(data, colorMode, layoutCity));
  search.setFiles(files);
  panel.hide();

  timeline = data.history ? new Timeline(data, data.history) : null;
  timelineBar.hidden = !timeline;
  if (timeline) {
    timeSlider.max = String(timeline.nowIndex);
    goToFrame(timeline.nowIndex, false); // start at "now": hides the deleted files
  }
  updateArcs();

  repoName.textContent = data.repoName;
  const commits = data.git ? ` · ${data.git.totalCommits} commits` : "";
  stats.textContent = `${data.root.fileCount} files · ${data.root.loc.toLocaleString()} LOC${commits}`;
  stats.classList.remove("error");
  depsLabel.textContent = `Show all dependencies (${dependencies.edges.length})`;
  cyclesSummary.hidden = dependencies.cycleCount === 0;
  cyclesSummary.textContent = `⚠ ${dependencies.cycleCount} circular dependenc${dependencies.cycleCount === 1 ? "y" : "ies"}`;
}

function showError(error: unknown): void {
  stats.textContent = error instanceof Error ? error.message : String(error);
  stats.classList.add("error");
}

// Pick a city with ?city=name.json (files in /samples are served at the site root).
const cityUrl = new URLSearchParams(location.search).get("city") ?? "orderflow.json";
loadCityFromUrl(cityUrl).then(show).catch(showError);

const fileInput = $<HTMLInputElement>("file-input");
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) loadCityFromFile(file).then(show).catch(showError);
});

window.addEventListener("dragover", (event) => event.preventDefault());
window.addEventListener("drop", (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files[0];
  if (file) loadCityFromFile(file).then(show).catch(showError);
});

// ---------- Selecting ----------

function selectFile(file: FileNode | null): void {
  selectedFile = file;
  viewer.select(file?.path ?? null);
  if (file) {
    const toFiles = (paths: string[]) => paths.map((path) => filesByPath.get(path)).filter((f): f is FileNode => !!f);
    const cycle = dependencies.cycleOf(file.path);
    let note: string | undefined;
    if (deletedPaths.has(file.path)) note = "Deleted — this file only exists in the past.";
    else if (timeline && !atNow()) {
      const loc = timeline.locAt(frame, file.path);
      note = `On ${timeline.frames[frame].label}: ${loc === null ? "not created yet" : `${loc.toLocaleString()} lines`}`;
    }
    panel.showFile(
      file,
      {
        parsed: file.imports !== undefined,
        imports: toFiles(dependencies.importsOf(file.path)),
        importers: toFiles(dependencies.importersOf(file.path)),
        cycle: cycle ? toFiles(cycle.filter((path) => path !== file.path)) : null,
      },
      note,
    );
  } else {
    panel.hide();
  }
  updateArcs();
}

function selectFolder(folder: FolderNode): void {
  selectFile(null);
  panel.showFolder(folder, city?.repoName ?? "");
}

function flyToFile(file: FileNode): void {
  viewer.flyTo(file.path);
}

// ---------- Dependency arcs ----------

const arcColors = {
  imports: new Color(ARC_COLORS.imports),
  importers: new Color(ARC_COLORS.importers),
  cycle: new Color(ARC_COLORS.cycle),
  all: new Color(ARC_COLORS.all),
};

/** An arc from importer to imported file. Red if this edge is part of a cycle. */
function arc(from: string, to: string, color: Color): Arc | null {
  const start = viewer.roofOf(from);
  const end = viewer.roofOf(to);
  if (!start || !end) return null;
  return { from: start, to: end, color: dependencies.isCycleEdge(from, to) ? arcColors.cycle : color };
}

/**
 * By default only the selected building's arcs are drawn, to keep the city readable.
 * "Show all" adds every dependency underneath, thin and faint.
 */
function updateArcs(): void {
  // Imports describe today's code, so arcs are only drawn at "now".
  if (!atNow()) {
    viewer.setArcs([]);
    return;
  }
  const notNull = (a: Arc | null): a is Arc => a !== null;
  const layers = [];

  if (showAllDeps.checked) {
    const all = dependencies.edges.map(([from, to]) => arc(from, to, arcColors.all)).filter(notNull);
    // Cycles get their own bold layer on top, so they don't get lost among hundreds of faint arcs.
    const isCycle = (a: Arc) => a.color === arcColors.cycle;
    // Fewer pieces per curve here: on a big repo this layer can hold tens of thousands of arcs.
    layers.push({ arcs: all.filter((a) => !isCycle(a)), style: { width: 1.5, opacity: 0.45 }, segments: 12 });
    layers.push({ arcs: all.filter(isCycle), style: { width: 3, opacity: 1 } });
  }

  if (selectedFile) {
    const path = selectedFile.path;
    const selected = [
      ...dependencies.importsOf(path).map((target) => arc(path, target, arcColors.imports)),
      ...dependencies.importersOf(path).map((source) => arc(source, path, arcColors.importers)),
    ].filter(notNull);
    layers.push({ arcs: selected, style: { width: 3, opacity: 1 } });
  }

  viewer.setArcs(layers);
}

showAllDeps.addEventListener("change", updateArcs);

// ---------- Time-travel ----------

function atNow(): boolean {
  return !timeline || frame === timeline.nowIndex;
}

/** Shows the city as it was at a timeline frame; buildings animate to their sizes at that time. */
function goToFrame(index: number, animate: boolean): void {
  if (!timeline) return;
  frame = index;
  timeSlider.value = String(index);

  const { label, commit } = timeline.frames[index];
  const commitText = document.createElement("small");
  commitText.textContent = commit ? ` ${commit.slice(0, 7)}` : "";
  timeLabel.replaceChildren(label, commitText);

  viewer.setFileHeights((file) => {
    const loc = timeline!.locAt(frame, file.path);
    return loc === null ? 0 : buildingHeight(loc);
  }, animate);

  updateArcs();
  if (selectedFile) selectFile(selectedFile); // refresh the panel's "On <date>" note
}

function stopPlaying(): void {
  clearInterval(playTimer);
  playTimer = undefined;
  playButton.textContent = "▶";
  playButton.setAttribute("aria-label", "Play");
}

playButton.addEventListener("click", () => {
  if (!timeline) return;
  if (playTimer !== undefined) {
    stopPlaying();
    return;
  }
  // From the end, start again at the beginning.
  if (atNow()) goToFrame(0, true);
  playButton.textContent = "❚❚";
  playButton.setAttribute("aria-label", "Pause");
  playTimer = window.setInterval(() => {
    if (atNow()) stopPlaying();
    else goToFrame(frame + 1, true);
  }, 900);
});

timeSlider.addEventListener("input", () => {
  stopPlaying();
  goToFrame(Number(timeSlider.value), true);
});

// ---------- Mouse: hover and click ----------

const canvas = viewer.canvas;

// The mouse can fire many move events per frame; picking checks every building, so do it
// at most once per frame, for the latest mouse position.
let lastMove: PointerEvent | null = null;
canvas.addEventListener("pointermove", (event) => {
  if (!lastMove) requestAnimationFrame(updateHover);
  lastMove = event;
});

function updateHover(): void {
  const event = lastMove!;
  lastMove = null;
  const item = viewer.pick(event.clientX, event.clientY);
  viewer.setHovered(item);

  if (item?.kind === "building") {
    // At a past moment, show the file's size back then.
    const loc = timeline ? timeline.locAt(frame, item.file.path) : item.file.loc;
    tooltip.textContent = `${item.file.name} · ${(loc ?? 0).toLocaleString()} LOC`;
  } else if (item?.kind === "platform") {
    tooltip.textContent = `${item.folder.name || city?.repoName}/ · ${item.folder.fileCount} files`;
  }
  tooltip.hidden = !item;
  // Just below-right of the cursor.
  tooltip.style.transform = `translate(${event.clientX + 14}px, ${event.clientY + 14}px)`;
  canvas.style.cursor = item ? "pointer" : "";
}

canvas.addEventListener("pointerleave", () => {
  viewer.setHovered(null);
  tooltip.hidden = true;
});

// A click is a press and release without moving much. Anything more is a camera drag.
let pressedAt: { x: number; y: number } | null = null;
canvas.addEventListener("pointerdown", (event) => (pressedAt = { x: event.clientX, y: event.clientY }));
canvas.addEventListener("pointerup", (event) => {
  if (!pressedAt || event.button !== 0) return;
  const moved = Math.hypot(event.clientX - pressedAt.x, event.clientY - pressedAt.y);
  pressedAt = null;
  if (moved > 5) return;

  const item = viewer.pick(event.clientX, event.clientY);
  if (item?.kind === "building") selectFile(item.file);
  else if (item?.kind === "platform") selectFolder(item.folder);
  else selectFile(null);
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && document.activeElement?.id !== "search") selectFile(null);
});

// ---------- Colour mode ----------

for (const button of modeButtons) {
  button.addEventListener("click", () => {
    colorMode = button.dataset.mode as ColorMode;
    for (const other of modeButtons) other.classList.toggle("active", other === button);
    renderLegend(legend, viewer.setColorMode(colorMode));
  });
}

// ---------- Theme and screenshot ----------

const themeButton = $<HTMLButtonElement>("theme");
themeButton.addEventListener("click", () => {
  const night = !document.body.classList.contains("night");
  document.body.classList.toggle("night", night);
  viewer.setTheme(night ? "night" : "day");
  themeButton.textContent = night ? "☀ Day" : "☾ Night";
});

$("screenshot").addEventListener("click", async () => {
  const blob = await viewer.screenshot();
  // Download it: make a temporary link to the image and "click" it.
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${city?.repoName ?? "codecity"}-city.png`;
  link.click();
  URL.revokeObjectURL(link.href);
});

// ---------- ?debug: frames per second and draw calls ----------

if (new URLSearchParams(location.search).has("debug")) {
  const debug = $("debug");
  debug.hidden = false;
  setInterval(() => {
    const { fps, drawCalls, triangles } = viewer.stats();
    debug.textContent = `${fps} fps · ${drawCalls} draw calls · ${triangles.toLocaleString()} triangles`;
  }, 500);
}
