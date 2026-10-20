import { Color, QuadraticBezierCurve3, Vector3 } from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";

/** One dependency to draw: from the importing building's roof to the imported building's roof. */
export interface Arc {
  from: Vector3;
  to: Vector3;
  color: Color;
}

export interface ArcStyle {
  /** Line width in screen pixels. */
  width: number;
  opacity: number;
}

/** Arc colours, shared by the 3D arcs, the panel and the legend. */
export const ARC_COLORS = {
  imports: "#ff8a00", // what the selected file imports
  importers: "#00a3a3", // what imports the selected file
  cycle: "#e53935", // part of a circular dependency
  all: "#5b6b8c", // every other dependency, when "show all" is on
};

const WHITE = new Color("white");

/**
 * Draws arcs as curved lines over the city, all in one object (one draw call).
 *
 * Each arc is a quadratic Bézier curve: it starts at `from`, ends at `to`, and is pulled up
 * toward a control point above the middle, so it bows over the buildings in between.
 * The colour starts pale and gets stronger toward the imported file, showing direction.
 *
 * Uses Three's "fat lines" (LineSegments2): normal WebGL lines are always 1 pixel wide.
 *
 * @param segments straight pieces per curve — more looks smoother but costs more
 *                 (use fewer when drawing thousands of arcs at once)
 */
export function createArcs(arcs: Arc[], style: ArcStyle, segments = 24): LineSegments2 {
  const SEGMENTS = segments;
  const positions: number[] = [];
  const colors: number[] = [];

  for (const arc of arcs) {
    const distance = arc.from.distanceTo(arc.to);
    const control = new Vector3(
      (arc.from.x + arc.to.x) / 2,
      Math.max(arc.from.y, arc.to.y) + 4 + distance * 0.35, // longer arcs fly higher
      (arc.from.z + arc.to.z) / 2,
    );
    const points = new QuadraticBezierCurve3(arc.from, control, arc.to).getPoints(SEGMENTS);
    const pale = arc.color.clone().lerp(WHITE, 0.6);
    const { r, g, b } = arc.color;

    for (let i = 0; i < SEGMENTS; i++) {
      // A "segments" line takes pairs of points: (start, end), (start, end), ...
      const p = points[i];
      const q = points[i + 1];
      positions.push(p.x, p.y, p.z, q.x, q.y, q.z);
      // Colour at each end: blend from pale to full colour along the curve.
      // (Plain maths, no new Color objects — this runs hundreds of thousands of times for "show all".)
      const t0 = i / SEGMENTS;
      const t1 = (i + 1) / SEGMENTS;
      colors.push(
        pale.r + (r - pale.r) * t0, pale.g + (g - pale.g) * t0, pale.b + (b - pale.b) * t0,
        pale.r + (r - pale.r) * t1, pale.g + (g - pale.g) * t1, pale.b + (b - pale.b) * t1,
      );
    }
  }

  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions);
  geometry.setColors(colors);
  const material = new LineMaterial({
    vertexColors: true,
    linewidth: style.width,
    transparent: style.opacity < 1,
    opacity: style.opacity,
  });
  return new LineSegments2(geometry, material);
}
