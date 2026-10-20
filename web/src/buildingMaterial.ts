import { MeshStandardMaterial } from "three";

/** Window grid size in world units: one window every WINDOW_SPACING along a wall, one floor every FLOOR_HEIGHT. */
const WINDOW_SPACING = "0.5";
const FLOOR_HEIGHT = "0.55";

/** Things the city changes at runtime, shared with the shader. */
export interface BuildingUniforms {
  /** 0 = day, 1 = night (lit windows). */
  night: { value: number };
}

/**
 * The material every building uses: Three's standard (physically based) material,
 * with its shader patched in three places:
 *
 *   1. per-instance `glow` (hover, selection, night-time hot spots) — added as emitted light
 *   2. procedural windows: each pixel on a wall works out whether it's glass or wall from its
 *      position on the building, so windows cost no extra objects at all
 *   3. at night, some windows light up (which ones is decided by a hash, so it never flickers)
 *
 * The wall keeps the data colour (churn / language / age); windows are darkened glass.
 */
export function createBuildingMaterial(): { material: MeshStandardMaterial; uniforms: BuildingUniforms } {
  const uniforms: BuildingUniforms = { night: { value: 0 } };
  const material = new MeshStandardMaterial({ roughness: 0.75 });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = uniforms.night;

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
        attribute float glow;
        varying float vGlow;
        varying vec3 vCityPos;        // this point's position in the city
        varying vec3 vBuildingBase;   // centre of the building's base
        varying vec3 vBoxNormal;      // which face of the box: (0,1,0) = roof, otherwise a wall
        flat varying float vBuildingId;`,
      )
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `#include <begin_vertex>
        vGlow = glow;
        vBoxNormal = normal;
        // instanceMatrix places this copy of the box: its 4th column is the building's base position.
        vCityPos = (instanceMatrix * vec4(transformed, 1.0)).xyz;
        vBuildingBase = instanceMatrix[3].xyz;
        vBuildingId = float(gl_InstanceID);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
        uniform float uNight;
        varying float vGlow;
        varying vec3 vCityPos;
        varying vec3 vBuildingBase;
        varying vec3 vBoxNormal;
        flat varying float vBuildingId;
        float windowAmount = 0.0;   // 0 = wall, 1 = glass
        float windowLit = 0.0;      // 1 = this window has its light on
        vec3 wallColor;

        // Turns a 3D number into a pseudo-random value in 0..1 — same input, same output.
        float hash(vec3 p) {
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }`,
      )
      .replace(
        "#include <color_fragment>",
        /* glsl */ `#include <color_fragment>
        wallColor = diffuseColor.rgb; // the data colour (instance colour)

        if (abs(vBoxNormal.y) < 0.5) {
          // A wall. Position along it (across) and up the building, in world units.
          float across = abs(vBoxNormal.x) > 0.5 ? vCityPos.z - vBuildingBase.z : vCityPos.x - vBuildingBase.x;
          float up = vCityPos.y - vBuildingBase.y;
          vec2 cell = vec2(across / ${WINDOW_SPACING}, up / ${FLOOR_HEIGHT});

          // Inside each cell: the middle part is glass, the border is wall.
          vec2 inCell = fract(cell);
          vec2 inside = step(vec2(0.22, 0.3), inCell) * step(inCell, vec2(0.78, 0.8));
          float pattern = inside.x * inside.y;

          // When cells are smaller than a few pixels the pattern would shimmer, so fade it into
          // its average (about 30% glass). fwidth = how much 'cell' changes from one pixel to the next.
          vec2 cellsPerPixel = fwidth(cell);
          float detail = 1.0 - smoothstep(0.2, 0.45, max(cellsPerPixel.x, cellsPerPixel.y));
          windowAmount = mix(0.3, pattern, detail);

          // About a quarter of the windows have their light on (only visible at night).
          windowLit = step(0.75, hash(vec3(floor(cell), vBuildingId))) * windowAmount;

          // Glass: a dark, slightly blue version of the wall colour.
          vec3 glass = wallColor * 0.22 + vec3(0.04, 0.06, 0.09);
          diffuseColor.rgb = mix(wallColor, glass, windowAmount);
        } else {
          // Roof: a bit darker than the walls.
          diffuseColor.rgb *= 0.8;
        }`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        /* glsl */ `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.2, windowAmount); // glass is shiny`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        /* glsl */ `#include <emissivemap_fragment>
        totalEmissiveRadiance += wallColor * vGlow;
        // Dim enough that the hot (high-churn) buildings still stand out above the window lights.
        totalEmissiveRadiance += vec3(1.0, 0.78, 0.45) * windowLit * uNight * 0.45;`,
      );
  };

  return { material, uniforms };
}
