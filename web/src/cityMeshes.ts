import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from "three";
import type { FileNode, FolderNode } from "../../shared/types";
import { createBuildingMaterial, type BuildingUniforms } from "./buildingMaterial";
import type { ColorScale } from "./colors";
import { createLabel } from "./labels";
import { createBlockMaterial } from "./blockMaterial";
import { placeLamps } from "./layout/lamps";
import { placeParks } from "./layout/parks";
import type { CityLayout, RoadLine } from "./layout/types";

// A 1×1×1 box, moved up by half its height so its bottom sits at y = 0 instead of the middle.
// Every building and platform is this box, stretched per instance.
export const boxGeometry = new BoxGeometry(1, 1, 1);
boxGeometry.translate(0, 0.5, 0);

// Road paint only ever shows its top, so a flat square facing up (2 triangles) is enough — a box would be 12.
const dashGeometry = new PlaneGeometry(1, 1);
dashGeometry.rotateX(-Math.PI / 2);

const HEIGHT_ANIMATION_MS = 700;
/** Road paint: dash length, gap between dashes, line width, and how far above the asphalt it floats. */
const DASH_LENGTH = 0.35;
const DASH_GAP = 0.35;
const DASH_WIDTH = 0.06;
const DASH_LIFT = 0.01;

/** Grass sits a hair above the sidewalk (like the road paint) so the two don't flicker. */
const GRASS_LIFT = 0.008;
/** Street lamps: pole height, size of the pool of light on the road, and its lift above the paint. */
const LAMP_HEIGHT = 0.55;
const LIGHT_POOL_SIZE = 1.3;
const POOL_LIFT = 0.015;

/** A soft round spot, bright in the middle and fading to nothing — the shape of a lamp's light. */
function lightPoolTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255, 255, 255, 0.55)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

const STREET_COLORS = {
  day: {
    curb: "#b9b4a8",
    sidewalk: "#d6d1c4",
    sidewalkSide: "#a9a497",
    paint: "#f3f0e4",
    grass: "#86a861",
    trunk: "#6b4f3a",
    leaves: "#ffffff",
    lampHead: "#8a8f96",
  },
  night: {
    curb: "#3a3e47",
    sidewalk: "#4a4d55",
    sidewalkSide: "#33363d",
    paint: "#8d8a7b",
    grass: "#25331f",
    trunk: "#2b231c",
    leaves: "#4d5a66",
    lampHead: "#ffe2a8",
  },
};

// A low-poly tree, 1 unit = normal size: a thin trunk, and a 20-sided ball on top as the crown.
// Both are moved up so the tree stands on y = 0. The trunk has no end caps (nobody sees them): 10 triangles.
const trunkGeometry = new CylinderGeometry(0.035, 0.05, 0.3, 5, 1, true);
trunkGeometry.translate(0, 0.15, 0);
const crownGeometry = new IcosahedronGeometry(0.24, 0);
crownGeometry.translate(0, 0.45, 0);
/** Each label is its own texture; past a few hundred they cost a lot of GPU memory, so only the biggest districts get one. */
const MAX_LABELS = 200;
/** Extra glow for the hovered / selected building. */
const HOVER_GLOW = 0.5;
const SELECTED_GLOW = 0.6;

export type Theme = "day" | "night";

/** Where one building is right now (its height can be mid-animation). */
export interface BuildingBox {
  x: number;
  z: number;
  baseY: number;
  width: number;
  height: number;
  visible: boolean;
}

/**
 * All the meshes for one city.
 *
 * Buildings and platforms are each ONE InstancedMesh: a single draw call that draws the same box
 * thousands of times, each copy ("instance") with its own matrix (position + size) and colour.
 * That's what keeps 10,000+ buildings at 60 fps — separate meshes would be 10,000 draw calls.
 */
export class CityMeshes {
  readonly group = new Group();
  readonly buildings: InstancedMesh;
  readonly platforms: InstancedMesh;
  readonly lots: InstancedMesh;
  private dashes: InstancedMesh;
  private grass: InstancedMesh;
  private trunks: InstancedMesh;
  private crowns: InstancedMesh;
  private lampPoles: InstancedMesh;
  private lampHeads: InstancedMesh;
  private lightPools: InstancedMesh;
  /** files[i] is drawn by building instance i; folders[i] by platform i; lotFolders[i] by lot i. */
  readonly files: FileNode[];
  readonly folders: FolderNode[];
  readonly lotFolders: FolderNode[];
  private curbColor: Color;
  private sidewalkSideColor: Color;

  private indexByPath = new Map<string, number>();
  private x: Float32Array;
  private z: Float32Array;
  private baseY: Float32Array;
  private width: Float32Array;
  /** Current heights; 0 = hidden (the file doesn't exist at the chosen moment). */
  private heights: Float32Array;
  private levels: number[];
  private buildingUniforms: BuildingUniforms;
  /** Per-instance glow, read by the patched shader (see buildingMaterial.ts). */
  private glow: InstancedBufferAttribute;
  /** The theme's glow per building (night: hot files glow). Hover/selection glow is added on top. */
  private themeGlow: Float32Array;
  private hovered = -1;
  private selected = -1;
  private heightAnimation: { startTime: number; from: Float32Array; to: Float32Array } | null = null;
  private matrix = new Matrix4();

  constructor(layout: CityLayout, repoName: string) {
    // --- Districts (folders): asphalt blocks with concrete curbs, one instanced mesh ---
    const districts = layout.districts;
    this.folders = districts.map((d) => d.folder);
    this.levels = districts.map((d) => d.level);
    const asphalt = createBlockMaterial(0.95);
    this.curbColor = asphalt.sideColor;
    this.platforms = new InstancedMesh(boxGeometry, asphalt.material, districts.length);
    districts.forEach((district, i) => {
      const { x, y, w, h } = district.rect;
      this.setMatrix(this.platforms, i, x + w / 2, district.baseY, y + h / 2, w, district.thickness, h);
    });
    this.platforms.receiveShadow = true;
    this.group.add(this.platforms);

    // --- Lots: the sidewalk slab under each folder's own files ---
    this.lotFolders = layout.lots.map((lot) => lot.folder);
    const sidewalk = createBlockMaterial(0.9);
    this.sidewalkSideColor = sidewalk.sideColor;
    this.lots = new InstancedMesh(boxGeometry, sidewalk.material, layout.lots.length);
    layout.lots.forEach((lot, i) => {
      const { x, y, w, h } = lot.rect;
      this.setMatrix(this.lots, i, x + w / 2, lot.baseY, y + h / 2, w, lot.thickness, h);
    });
    this.lots.castShadow = true;
    this.lots.receiveShadow = true;
    this.group.add(this.lots);

    // --- Road markings: dashed centre lines, each dash a tiny flat box ---
    const dashes = roadDashes(layout.roads);
    this.dashes = new InstancedMesh(dashGeometry, new MeshStandardMaterial({ roughness: 0.6 }), Math.max(1, dashes.length));
    this.dashes.count = dashes.length;
    // Lifted a hair above the asphalt, so the two surfaces don't flicker into each other.
    dashes.forEach((d, i) => this.setMatrix(this.dashes, i, d.x, d.y + DASH_LIFT, d.z, d.sx, 1, d.sz));
    this.dashes.receiveShadow = true;
    this.group.add(this.dashes);

    // --- Parks: grass tiles and trees on the free space (see layout/parks.ts) ---
    const parks = placeParks(layout);
    this.grass = new InstancedMesh(dashGeometry, new MeshStandardMaterial({ roughness: 1 }), Math.max(1, parks.grass.length));
    this.grass.count = parks.grass.length;
    parks.grass.forEach((g, i) => this.setMatrix(this.grass, i, g.x, g.y + GRASS_LIFT, g.z, g.size, 1, g.size));
    this.grass.receiveShadow = true;
    this.group.add(this.grass);

    const treeCount = Math.max(1, parks.trees.length);
    this.trunks = new InstancedMesh(trunkGeometry, new MeshStandardMaterial({ roughness: 1 }), treeCount);
    // flatShading: each face gets one flat colour — the faceted, low-poly look.
    this.crowns = new InstancedMesh(crownGeometry, new MeshStandardMaterial({ roughness: 0.9, flatShading: true }), treeCount);
    this.trunks.count = this.crowns.count = parks.trees.length;
    parks.trees.forEach((tree, i) => {
      this.setMatrix(this.trunks, i, tree.x, tree.y, tree.z, tree.scale, tree.scale, tree.scale);
      this.setMatrix(this.crowns, i, tree.x, tree.y, tree.z, tree.scale, tree.scale, tree.scale);
      // A different shade of green per tree.
      this.crowns.setColorAt(i, new Color().setHSL(0.25 + tree.tint * 0.09, 0.45, 0.3 + tree.tint * 0.12));
    });
    for (const mesh of [this.trunks, this.crowns]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }

    // --- Street lamps: pole + head, and at night a pool of light on the road below ---
    const lamps = placeLamps(layout);
    const lampCount = Math.max(1, lamps.length);
    this.lampPoles = new InstancedMesh(boxGeometry, new MeshStandardMaterial({ color: "#3d4148", roughness: 0.6 }), lampCount);
    // MeshBasicMaterial ignores lighting: it's simply the colour you give it — right for a light bulb.
    this.lampHeads = new InstancedMesh(boxGeometry, new MeshBasicMaterial(), lampCount);
    this.lightPools = new InstancedMesh(
      dashGeometry,
      // Additive blending ADDS this colour to what's already drawn underneath — it brightens the road
      // like real light would, instead of covering it with a picture.
      new MeshBasicMaterial({ map: lightPoolTexture(), color: "#ffcf87", transparent: true, depthWrite: false, blending: AdditiveBlending }),
      lampCount,
    );
    this.lampPoles.count = this.lampHeads.count = this.lightPools.count = lamps.length;
    lamps.forEach((lamp, i) => {
      this.setMatrix(this.lampPoles, i, lamp.x, lamp.y, lamp.z, 0.025, LAMP_HEIGHT, 0.025);
      this.setMatrix(this.lampHeads, i, lamp.x, lamp.y + LAMP_HEIGHT, lamp.z, 0.08, 0.03, 0.08);
      this.setMatrix(this.lightPools, i, lamp.x, lamp.y + POOL_LIFT, lamp.z, LIGHT_POOL_SIZE, 1, LIGHT_POOL_SIZE);
    });
    this.lampPoles.castShadow = true;
    this.group.add(this.lampPoles, this.lampHeads, this.lightPools);

    // Labels for the biggest districts only.
    const labelled = districts
      .filter((d) => d.label)
      .sort((a, b) => b.label!.w - a.label!.w)
      .slice(0, MAX_LABELS);
    for (const district of labelled) {
      const name = district.level === 0 ? repoName : district.folder.name;
      this.group.add(createLabel(name, district.label!, district.baseY + district.thickness));
    }

    // --- Buildings (files): one instanced mesh ---
    const count = layout.buildings.length;
    this.files = layout.buildings.map((b) => b.file);
    this.x = Float32Array.from(layout.buildings, (b) => b.x);
    this.z = Float32Array.from(layout.buildings, (b) => b.z);
    this.baseY = Float32Array.from(layout.buildings, (b) => b.baseY);
    this.width = Float32Array.from(layout.buildings, (b) => b.width);
    this.heights = Float32Array.from(layout.buildings, (b) => b.height);
    this.files.forEach((file, i) => this.indexByPath.set(file.path, i));

    // The buildings get their own copy of the box, because they carry the extra "glow" attribute.
    const geometry = boxGeometry.clone();
    this.glow = new InstancedBufferAttribute(new Float32Array(count), 1);
    geometry.setAttribute("glow", this.glow);
    this.themeGlow = new Float32Array(count);

    const { material, uniforms } = createBuildingMaterial();
    this.buildingUniforms = uniforms;
    this.buildings = new InstancedMesh(geometry, material, count);
    this.buildings.castShadow = true;
    this.buildings.receiveShadow = true;
    // Heights change during time-travel, so the precomputed bounds would go stale; the city is
    // almost always on screen anyway, so just skip the "is it off-screen?" test.
    this.buildings.frustumCulled = false;
    for (let i = 0; i < count; i++) this.updateBuildingMatrix(i);
    this.group.add(this.buildings);
  }

  // ---------- Colours and glow ----------

  /** Colours every building using a colour scale (churn, language, age...). */
  paint(scale: ColorScale): void {
    this.files.forEach((file, i) => this.buildings.setColorAt(i, scale.colorFor(file)));
    this.buildings.instanceColor!.needsUpdate = true;
  }

  /** Street colours and building glow for day or night. */
  setTheme(theme: Theme): void {
    const colors = STREET_COLORS[theme];
    this.levels.forEach((level, i) => this.platforms.setColorAt(i, asphaltColor(level, theme)));
    this.platforms.instanceColor!.needsUpdate = true;
    this.curbColor.set(colors.curb);
    (this.lots.material as MeshStandardMaterial).color.set(colors.sidewalk);
    this.sidewalkSideColor.set(colors.sidewalkSide);
    (this.dashes.material as MeshStandardMaterial).color.set(colors.paint);
    (this.grass.material as MeshStandardMaterial).color.set(colors.grass);
    (this.trunks.material as MeshStandardMaterial).color.set(colors.trunk);
    // Crowns have a green per tree (instance colour); the material colour darkens them all at night.
    (this.crowns.material as MeshStandardMaterial).color.set(colors.leaves);
    // Lamps: grey by day; at night the heads glow (bright enough for bloom) and light pools appear.
    (this.lampHeads.material as MeshBasicMaterial).color.set(colors.lampHead);
    this.lightPools.visible = theme === "night";
    this.buildingUniforms.night.value = theme === "night" ? 1 : 0; // lit windows

    // At night, files with lots of commits glow (and bloom picks that up). By day nothing glows.
    const maxCommits = Math.max(1, ...this.files.map((f) => f.git?.commits ?? 0));
    this.files.forEach((file, i) => {
      if (theme === "day" || !file.git || maxCommits <= 1) {
        this.themeGlow[i] = 0;
        return;
      }
      const t = Math.log(file.git.commits) / Math.log(maxCommits); // same scale as churn colours
      this.themeGlow[i] = t < 0.5 ? 0 : ((t - 0.5) / 0.5) ** 2 * 1.6;
    });
    this.refreshGlow();
  }

  setHovered(index: number): void {
    this.hovered = index;
    this.refreshGlow();
  }

  setSelected(index: number): void {
    this.selected = index;
    this.refreshGlow();
  }

  private refreshGlow(): void {
    const glow = this.glow.array as Float32Array;
    glow.set(this.themeGlow);
    if (this.hovered >= 0) glow[this.hovered] = Math.max(glow[this.hovered], HOVER_GLOW);
    if (this.selected >= 0) glow[this.selected] = Math.max(glow[this.selected], SELECTED_GLOW);
    this.glow.needsUpdate = true;
  }

  // ---------- Lookups ----------

  indexOf(path: string): number {
    return this.indexByPath.get(path) ?? -1;
  }

  buildingBox(index: number): BuildingBox {
    const height = this.heights[index];
    return {
      x: this.x[index],
      z: this.z[index],
      baseY: this.baseY[index],
      width: this.width[index],
      height,
      visible: height > 0.01,
    };
  }

  // ---------- Heights (time-travel) ----------

  /**
   * Gives every building a new height (0 = the file doesn't exist at this moment, so hide it).
   * With `animate`, buildings grow/shrink there smoothly over the next frames (see `animate`).
   */
  setHeights(heightOf: (file: FileNode) => number, animate: boolean): void {
    const targets = Float32Array.from(this.files, heightOf);
    if (!animate) {
      this.heightAnimation = null;
      this.heights.set(targets);
      this.updateAllBuildings();
      return;
    }
    this.heightAnimation = { startTime: performance.now(), from: this.heights.slice(), to: targets };
  }

  /** Moves a running height animation forward. Call once per frame. */
  animate(time: number): void {
    const animation = this.heightAnimation;
    if (!animation) return;
    const progress = Math.min(1, (time - animation.startTime) / HEIGHT_ANIMATION_MS);
    const eased = 1 - (1 - progress) ** 3; // ease-out: fast start, gentle landing
    for (let i = 0; i < this.heights.length; i++) {
      this.heights[i] = animation.from[i] + (animation.to[i] - animation.from[i]) * eased;
    }
    this.updateAllBuildings();
    if (progress === 1) this.heightAnimation = null;
  }

  private updateAllBuildings(): void {
    for (let i = 0; i < this.heights.length; i++) this.updateBuildingMatrix(i);
    // Picking checks a bounding sphere first, so keep it in step with the new heights.
    this.buildings.computeBoundingSphere();
  }

  private updateBuildingMatrix(i: number): void {
    const height = this.heights[i];
    if (height > 0.01) {
      this.setMatrix(this.buildings, i, this.x[i], this.baseY[i], this.z[i], this.width[i], height, this.width[i]);
    } else {
      // Hidden: shrink to an invisible speck. (Exactly 0 would make a matrix Three can't invert.)
      this.setMatrix(this.buildings, i, this.x[i], this.baseY[i], this.z[i], 1e-5, 1e-5, 1e-5);
    }
  }

  private setMatrix(mesh: InstancedMesh, i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number) {
    // Reuse the same vectors: during an animation this runs 10,000+ times per frame.
    this.matrix.compose(POSITION.set(x, y, z), IDENTITY, SCALE.set(sx, sy, sz));
    mesh.setMatrixAt(i, this.matrix);
    mesh.instanceMatrix.needsUpdate = true;
  }

  /** Frees GPU memory (geometry, materials, label textures) for a city we no longer show. */
  dispose(): void {
    this.buildings.geometry.dispose(); // the clone with the glow attribute
    this.buildings.dispose();
    this.platforms.dispose();
    this.lots.dispose();
    this.dashes.dispose();
    this.grass.dispose();
    this.trunks.dispose();
    this.crowns.dispose();
    this.lampPoles.dispose();
    this.lampHeads.dispose();
    this.lightPools.dispose();
    this.group.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const material = object.material as MeshStandardMaterial | MeshBasicMaterial;
      material.map?.dispose();
      material.dispose();
    });
  }
}

const IDENTITY = new Quaternion();
const POSITION = new Vector3();
const SCALE = new Vector3();

/** Asphalt that gets a little lighter the deeper a folder is nested, so nesting still shows. */
function asphaltColor(level: number, theme: Theme): Color {
  return theme === "day"
    ? new Color().setHSL(0.6, 0.06, Math.min(0.42, 0.24 + level * 0.035))
    : new Color().setHSL(0.62, 0.12, Math.min(0.2, 0.08 + level * 0.02));
}

/**
 * Splits every road centre line into dashes: a short painted piece, then a gap, and so on.
 * Each dash is returned as a box position and size (sx along x, sz along z).
 */
function roadDashes(roads: RoadLine[]): { x: number; y: number; z: number; sx: number; sz: number }[] {
  const dashes: { x: number; y: number; z: number; sx: number; sz: number }[] = [];
  const period = DASH_LENGTH + DASH_GAP;
  for (const road of roads) {
    const alongX = road.z1 === road.z2;
    const length = alongX ? Math.abs(road.x2 - road.x1) : Math.abs(road.z2 - road.z1);
    const count = Math.floor(length / period);
    if (count === 0) continue;
    // Centre the dashes on the line, so both ends have the same leftover gap.
    const start = (length - count * period + DASH_GAP) / 2 + DASH_LENGTH / 2;
    for (let i = 0; i < count; i++) {
      const along = start + i * period;
      dashes.push(
        alongX
          ? { x: Math.min(road.x1, road.x2) + along, y: road.y, z: road.z1, sx: DASH_LENGTH, sz: DASH_WIDTH }
          : { x: road.x1, y: road.y, z: Math.min(road.z1, road.z2) + along, sx: DASH_WIDTH, sz: DASH_LENGTH },
      );
    }
  }
  return dashes;
}
