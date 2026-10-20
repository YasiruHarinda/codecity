import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from "three";
import type { Theme } from "./cityMeshes";

/** Colours and sun/moon for each theme. The horizon colour is also used for the fog. */
export const SKY_THEMES = {
  day: {
    zenith: "#5d8fd6", // straight up
    horizon: "#dbe7f2", // pale near the ground, like a real sky
    ground: "#8ba06e", // below the horizon (seen in reflections)
    sun: "#fff3d6",
    sunDirection: new Vector3(0.7, 0.75, 0.3).normalize(),
    stars: 0,
  },
  night: {
    zenith: "#03060f",
    horizon: "#1a2440", // a faint glow along the horizon
    ground: "#0c120e",
    sun: "#b9c7e6", // the moon
    sunDirection: new Vector3(-0.6, 0.3, -0.75).normalize(), // low, behind the city from the start view
    stars: 1,
  },
};

/**
 * A sky dome: a huge sphere seen from the inside. For every pixel the shader takes the direction
 * you're looking in and works out a colour:
 *   - height above the horizon → blend from the horizon colour up to the zenith colour
 *   - angle to the sun → a sharp disc plus a soft glow around it
 *   - at night, stars: the sky is cut into tiny cells and a hash lights up a few of them
 *
 * @param showGround true for the reflection sky: below the horizon it shows the ground colour, so
 *   shiny surfaces reflect grass. The visible sky uses the horizon colour there instead, so the far
 *   edge of the world melts into the fog with no visible seam.
 */
export function createSky(radius: number, showGround: boolean): { mesh: Mesh; setTheme: (theme: Theme) => void } {
  const uniforms = {
    uZenith: { value: new Color() },
    uHorizon: { value: new Color() },
    uGround: { value: new Color() },
    uSunColor: { value: new Color() },
    uSunDirection: { value: new Vector3() },
    uStars: { value: 0 },
    uSunSize: { value: 1 },
    uSunBrightness: { value: 1 },
  };

  const material = new ShaderMaterial({
    uniforms,
    side: BackSide, // we're inside the sphere
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vDirection;
      void main() {
        vDirection = position; // the sphere is centred on the camera, so a point's position is a direction
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith, uHorizon, uGround, uSunColor, uSunDirection;
      uniform float uStars, uSunSize, uSunBrightness;
      varying vec3 vDirection;

      float hash(vec3 p) {
        p = fract(p * 0.3183099 + 0.1);
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }

      void main() {
        vec3 direction = normalize(vDirection);
        float height = direction.y; // -1 straight down .. 0 horizon .. 1 straight up

        // Gradient: horizon → zenith above, horizon → ground below.
        vec3 color = height > 0.0
          ? mix(uHorizon, uZenith, pow(height, 0.5))
          : mix(uHorizon, uGround, pow(-height, 0.4));

        // Sun (or moon): a sharp disc, a glow, and a wide haze. cos(angle) to the power of a big number
        // is only bright very close to the sun; a small power spreads out.
        float toSun = max(dot(direction, uSunDirection), 0.0);
        color += uSunColor * uSunBrightness
          * (pow(toSun, 2000.0 / uSunSize) * 3.0 + pow(toSun, 60.0) * 0.3 + pow(toSun, 6.0) * 0.08);

        // Stars, only above the horizon and fading out near it. The sky is cut into tiny cells
        // (finer = smaller stars); a hash lights about 1 in 700, each with its own brightness.
        if (uStars > 0.0 && height > 0.0) {
          vec3 cell = floor(direction * 700.0);
          float star = step(0.9986, hash(cell)) * (0.3 + 0.7 * hash(cell + 17.0));
          color += vec3(star) * smoothstep(0.0, 0.25, height) * 0.9 * uStars;
        }

        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }`,
  });

  const mesh = new Mesh(new SphereGeometry(radius, 32, 16), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1; // drawn first, behind everything

  return {
    mesh,
    setTheme(theme) {
      const colors = SKY_THEMES[theme];
      uniforms.uZenith.value.set(colors.zenith);
      uniforms.uHorizon.value.set(colors.horizon);
      uniforms.uGround.value.set(showGround ? colors.ground : colors.horizon);
      uniforms.uSunColor.value.set(colors.sun);
      uniforms.uSunDirection.value.copy(colors.sunDirection);
      uniforms.uStars.value = colors.stars;
      // The moon: a smaller disc than the sun, and much dimmer (or bloom turns it into a floodlight).
      uniforms.uSunSize.value = theme === "night" ? 0.35 : 1;
      uniforms.uSunBrightness.value = theme === "night" ? 0.45 : 1;
    },
  };
}
