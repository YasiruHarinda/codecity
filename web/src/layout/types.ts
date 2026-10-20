import type { FileNode, FolderNode } from "../../../shared/types";

/**
 * A rectangle on the ground, seen from above.
 * The layout works in 2D: its `y` becomes the `z` axis in the 3D scene.
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where and how big one building is. Pure numbers — no Three.js here. */
export interface Building {
  file: FileNode;
  /** Centre of the building's base on the ground. */
  x: number;
  z: number;
  /** Height of the platform the building stands on. */
  baseY: number;
  /** Footprint is square: width × width. */
  width: number;
  height: number;
}

/** A folder, drawn as a raised block of asphalt with streets on it. */
export interface District {
  folder: FolderNode;
  /** Nesting level: 0 for the repo root, 1 for its sub-folders, and so on. */
  level: number;
  /** The block itself (already shrunk to leave room for the streets around it). */
  rect: Rect;
  /** Bottom of the platform. */
  baseY: number;
  /** Platform thickness. */
  thickness: number;
  /** Strip along the front edge where the folder name goes (null if too small to read). */
  label: Rect | null;
}

/** A folder's own files stand together on one sidewalk slab: its "lot". */
export interface Lot {
  folder: FolderNode;
  rect: Rect;
  /** Bottom of the slab (the top of its district). */
  baseY: number;
  thickness: number;
}

/** A painted road centre line, from (x1, z1) to (x2, z2), at height y. Always straight along x or z. */
export interface RoadLine {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  y: number;
}

export interface CityLayout {
  buildings: Building[];
  districts: District[];
  lots: Lot[];
  roads: RoadLine[];
  /** Side length of the square area the city covers, centred on (0, 0). */
  size: number;
}
