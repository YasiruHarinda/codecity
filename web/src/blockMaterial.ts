import { Color, MeshStandardMaterial } from "three";

/**
 * Material for flat city blocks (districts and sidewalk lots): the top uses the normal colour
 * (per instance, or the material's own), the sides use a separate curb colour.
 * Same trick as the building windows: the shader looks at which face of the box it is drawing.
 */
export function createBlockMaterial(roughness: number): { material: MeshStandardMaterial; sideColor: Color } {
  const sideColor = new Color();
  const material = new MeshStandardMaterial({ roughness });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSideColor = { value: sideColor };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vBoxNormal;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvBoxNormal = normal;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uSideColor;\nvarying vec3 vBoxNormal;")
      .replace(
        "#include <color_fragment>",
        // Faces that don't point up are the sides: paint them as concrete curbs.
        "#include <color_fragment>\nif (abs(vBoxNormal.y) < 0.5) diffuseColor.rgb = uSideColor;",
      );
  };

  return { material, sideColor };
}
