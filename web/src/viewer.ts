import {
  DirectionalLight,
  EdgesGeometry,
  Fog,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  type WebGLRenderTarget,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import type { CityData, FileNode, FolderNode } from "../../shared/types";
import { createArcs, type Arc, type ArcStyle } from "./arcs";
import { boxGeometry, CityMeshes, type Theme } from "./cityMeshes";
import { createColorScale, type ColorMode, type Legend } from "./colors";
import { createSky, SKY_THEMES } from "./sky";
import { treemapLayout } from "./layout/treemapLayout";
import { collectFiles } from "./tree";

/** Something in the city the mouse can point at. */
export type CityItem = { kind: "building"; index: number; file: FileNode } | { kind: "platform"; folder: FolderNode };

/** A camera move in progress (see flyTo). */
interface Flight {
  fromPosition: Vector3;
  toPosition: Vector3;
  fromTarget: Vector3;
  toTarget: Vector3;
  startTime: number;
}

const FLIGHT_DURATION_MS = 1000;

/**
 * Lights for each theme. Most of the soft "fill" light now comes from the sky itself (the
 * environment map), so the hemisphere light is only a small extra.
 */
const THEMES = {
  // The ground around the city is grass (the green belt's trees stand on it).
  day: { ground: "#8fa86f", skyLight: 0xffffff, groundLight: 0x8090a0, hemi: 0.55, environment: 0.75, sun: 0xfff1d8, sunPower: 2.6 },
  night: { ground: "#16211a", skyLight: 0x8aa0ff, groundLight: 0x101828, hemi: 0.25, environment: 0.35, sun: 0x9fb4ff, sunPower: 0.6 },
};

/**
 * Owns the Three.js scene: renderer, camera, lights, ground and the current city.
 * Also does picking (what's under the mouse), highlighting, camera flights, themes and screenshots.
 */
export class CityViewer {
  private scene = new Scene();
  private camera = new PerspectiveCamera(50, 1, 0.1, 5000);
  private renderer = new WebGLRenderer({ antialias: true });
  private controls: OrbitControls;
  private hemisphere = new HemisphereLight();
  private sun = new DirectionalLight();
  private ground: Mesh;
  private raycaster = new Raycaster();

  private city: CityMeshes | null = null;
  private cityData: CityData | null = null;
  private citySize = 10;
  private selectedIndex = -1;
  /** Dark box outline drawn around the selected building. */
  private selectionOutline = new LineSegments(
    new EdgesGeometry(boxGeometry),
    new LineBasicMaterial({ color: "#10161d" }),
  );
  private flight: Flight | null = null;
  private arcLayers: LineSegments2[] = [];

  private theme: Theme = "day";
  /** The sky dome around the camera. */
  private sky = createSky(1, false);
  /** A second sky, in its own little scene, used to make the reflection (environment) map. */
  private environmentSky = createSky(100, true);
  private environmentScene = new Scene();
  private pmrem: PMREMGenerator;
  private environmentMap: WebGLRenderTarget | null = null;
  /** Post-processing chain for bloom; only used at night. */
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;

  // Frame counting for the ?debug stats.
  private frames = 0;
  private fps = 0;
  private fpsSince = performance.now();

  constructor(private container: HTMLElement) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // sharp on HiDPI, capped for speed
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap; // softer shadow edges
    // Count draw calls for the whole frame ourselves: with bloom a frame is several render passes,
    // and the automatic counter would only show the last one.
    this.renderer.info.autoReset = false;
    container.appendChild(this.renderer.domElement);

    this.scene.add(this.hemisphere);
    // The "sun": comes from one direction and casts shadows.
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.scene.add(this.sun, this.sun.target);

    this.ground = new Mesh(new PlaneGeometry(1, 1), new MeshStandardMaterial());
    this.ground.rotation.x = -Math.PI / 2; // planes start upright; lay it flat
    this.ground.position.y = -0.01; // just under the root platform, so the two never flicker
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.selectionOutline.visible = false;
    this.scene.add(this.selectionOutline);

    this.scene.add(this.sky.mesh);
    this.environmentScene.add(this.environmentSky.mesh);
    // PMREM turns a scene into an environment map: blurred copies for rough surfaces, sharp ones
    // for shiny surfaces like glass.
    this.pmrem = new PMREMGenerator(this.renderer);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; // smooth "gliding" stop after you let go
    this.controls.maxPolarAngle = Math.PI / 2.05; // don't let the camera go under the ground
    // If the user grabs the camera mid-flight, let them have it.
    this.controls.addEventListener("start", () => (this.flight = null));

    // Bloom: render the scene to an image, make the brightest pixels bleed light, then output.
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new Vector2(1, 1), 0.6, 0.4, 0.7); // strength, radius, threshold
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.applyTheme();
    window.addEventListener("resize", () => this.resize());
    this.resize();

    // Runs about 60 times per second.
    this.renderer.setAnimationLoop((time) => {
      this.updateFlight(time);
      this.city?.animate(time);
      this.updateSelectionOutline();
      this.controls.update();
      // The sky dome travels with the camera, so you can never reach its edge.
      this.sky.mesh.position.copy(this.camera.position);
      this.renderer.info.reset();
      this.render();
      this.countFrame(time);
    });
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /**
   * @param data       the city as it is today (colours and legend are based on these files)
   * @param mode       colour mode
   * @param layoutData what to lay out — can include extra files, e.g. deleted ones for time-travel
   */
  showCity(data: CityData, mode: ColorMode, layoutData: CityData = data): Legend {
    if (this.city) {
      this.scene.remove(this.city.group);
      this.city.dispose();
    }
    this.selectedIndex = -1;
    this.setArcs([]);

    const layout = treemapLayout(layoutData);
    this.cityData = data;
    this.city = new CityMeshes(layout, data.repoName);
    this.city.setTheme(this.theme);
    this.scene.add(this.city.group);
    this.fitToCity(Math.max(layout.size, 10));
    return this.setColorMode(mode);
  }

  /** Recolours the buildings and returns the legend that matches the new colours. */
  setColorMode(mode: ColorMode): Legend {
    const scale = createColorScale(mode, this.cityData ? collectFiles(this.cityData.root) : []);
    this.city?.paint(scale);
    return scale.legend;
  }

  // ---------- Picking and highlighting ----------

  /**
   * Raycasting: what's under this screen position?
   * Shoots a ray from the camera through the mouse point and returns the nearest thing it hits.
   */
  pick(clientX: number, clientY: number): CityItem | null {
    const city = this.city;
    if (!city) return null;
    // Convert pixels to "normalised device coordinates": -1..+1 across, -1..+1 up (y is flipped).
    const bounds = this.canvas.getBoundingClientRect();
    const pointer = new Vector2(
      ((clientX - bounds.left) / bounds.width) * 2 - 1,
      -((clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(pointer, this.camera);
    // For an InstancedMesh, each hit says which copy (instanceId) was hit.
    for (const hit of this.raycaster.intersectObjects([city.buildings, city.platforms, city.lots], false)) {
      const index = hit.instanceId!;
      if (hit.object === city.platforms) return { kind: "platform", folder: city.folders[index] };
      if (hit.object === city.lots) return { kind: "platform", folder: city.lotFolders[index] };
      // Skip buildings hidden by the timeline (files that don't exist at the chosen time).
      if (city.buildingBox(index).visible) return { kind: "building", index, file: city.files[index] };
    }
    return null;
  }

  /** Makes a building glow while the mouse is over it (null = nothing hovered). */
  setHovered(item: CityItem | null): void {
    this.city?.setHovered(item?.kind === "building" ? item.index : -1);
  }

  /** Marks a building as selected: it glows and gets an outline (null = clear selection). */
  select(path: string | null): void {
    this.selectedIndex = path && this.city ? this.city.indexOf(path) : -1;
    this.city?.setSelected(this.selectedIndex);
    this.updateSelectionOutline();
  }

  /** Keeps the outline around the selected building, even while its height animates. */
  private updateSelectionOutline(): void {
    const box = this.selectedIndex >= 0 && this.city ? this.city.buildingBox(this.selectedIndex) : null;
    this.selectionOutline.visible = !!box?.visible;
    if (box) {
      this.selectionOutline.position.set(box.x, box.baseY, box.z);
      // A touch bigger than the building, so the lines aren't hidden inside its faces.
      this.selectionOutline.scale.set(box.width, box.height, box.width).multiplyScalar(1.04);
    }
  }

  // ---------- Buildings by path ----------

  hasBuilding(path: string): boolean {
    return (this.city?.indexOf(path) ?? -1) >= 0;
  }

  /** Centre of a building's roof — where its dependency arcs start and end. */
  roofOf(path: string): Vector3 | null {
    const index = this.city?.indexOf(path) ?? -1;
    if (index < 0) return null;
    const box = this.city!.buildingBox(index);
    return new Vector3(box.x, box.baseY + box.height, box.z);
  }

  /** Sets every building's height (0 hides it), optionally animating there. Used by the timeline. */
  setFileHeights(heightOf: (file: FileNode) => number, animate: boolean): void {
    this.city?.setHeights(heightOf, animate);
  }

  /** Replaces all drawn arcs. Each layer has its own style (e.g. faint "all", bold "selected"). */
  setArcs(layers: { arcs: Arc[]; style: ArcStyle; segments?: number }[]): void {
    for (const layer of this.arcLayers) {
      this.scene.remove(layer);
      layer.geometry.dispose();
      layer.material.dispose();
    }
    this.arcLayers = layers
      .filter((layer) => layer.arcs.length > 0)
      .map((layer) => createArcs(layer.arcs, layer.style, layer.segments));
    // Later layers draw on top of earlier ones (bold selected arcs over the faint "all" arcs).
    this.arcLayers.forEach((layer, index) => (layer.renderOrder = index + 1));
    if (this.arcLayers.length > 0) this.scene.add(...this.arcLayers);
  }

  // ---------- Camera ----------

  /** Smoothly moves the camera to look at a building, keeping roughly the current viewing angle. */
  flyTo(path: string): void {
    const index = this.city?.indexOf(path) ?? -1;
    if (index < 0) return;
    const box = this.city!.buildingBox(index);
    const center = new Vector3(box.x, box.baseY + box.height / 2, box.z);

    // Same direction we're looking from now, but not too flat, so we see the building from above.
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    direction.y = Math.max(direction.y, 0.6);
    direction.normalize();
    // Far enough back to see the building in its neighbourhood, not just a wall filling the screen.
    const distance = Math.max(30, box.height * 3);

    this.flight = {
      fromPosition: this.camera.position.clone(),
      toPosition: center.clone().addScaledVector(direction, distance),
      fromTarget: this.controls.target.clone(),
      toTarget: center,
      startTime: performance.now(),
    };
  }

  private updateFlight(time: number): void {
    if (!this.flight) return;
    const progress = Math.min(1, (time - this.flight.startTime) / FLIGHT_DURATION_MS);
    // Ease in-out (cubic): slow start, fast middle, slow finish.
    const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
    this.camera.position.lerpVectors(this.flight.fromPosition, this.flight.toPosition, eased);
    this.controls.target.lerpVectors(this.flight.fromTarget, this.flight.toTarget, eased);
    if (progress === 1) this.flight = null;
  }

  // ---------- Theme, rendering, screenshots ----------

  setTheme(theme: Theme): void {
    this.theme = theme;
    this.applyTheme();
    this.city?.setTheme(theme);
  }

  private applyTheme(): void {
    const colors = THEMES[this.theme];
    const sky = SKY_THEMES[this.theme];
    this.sky.setTheme(this.theme);
    // Fog fades far-away things into the horizon colour, so the world melts into the sky.
    // It starts beyond the city's near edge.
    this.scene.fog = new Fog(sky.horizon, this.citySize * 1.3, this.citySize * 4);
    (this.ground.material as MeshStandardMaterial).color.set(colors.ground);
    this.hemisphere.color.set(colors.skyLight);
    this.hemisphere.groundColor.set(colors.groundLight);
    this.hemisphere.intensity = colors.hemi;
    // The light comes from where the sky draws the sun (or the moon at night).
    this.sun.color.set(colors.sun);
    this.sun.intensity = colors.sunPower;
    this.sun.position.copy(sky.sunDirection).multiplyScalar(this.citySize * 1.5);

    // Reflections and soft sky light: render the sky into an environment map.
    this.environmentSky.setTheme(this.theme);
    this.environmentMap?.dispose();
    this.environmentMap = this.pmrem.fromScene(this.environmentScene);
    this.scene.environment = this.environmentMap.texture;
    this.scene.environmentIntensity = colors.environment;
  }

  private render(): void {
    // Bloom only at night: it costs extra GPU work, and by day nothing glows anyway.
    if (this.theme === "night") this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /** Renders the current view and returns it as a PNG. */
  screenshot(): Promise<Blob> {
    // Render right before reading the canvas: once the browser has shown a frame,
    // the drawing buffer may already be cleared.
    this.render();
    return new Promise((resolve, reject) =>
      this.canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Screenshot failed"))), "image/png"),
    );
  }

  /** Frames per second and GPU work per frame, for the ?debug overlay. */
  stats(): { fps: number; drawCalls: number; triangles: number } {
    const info = this.renderer.info.render;
    return { fps: this.fps, drawCalls: info.calls, triangles: info.triangles };
  }

  private countFrame(time: number): void {
    this.frames++;
    if (time - this.fpsSince >= 1000) {
      this.fps = Math.round((this.frames * 1000) / (time - this.fpsSince));
      this.frames = 0;
      this.fpsSince = time;
    }
  }

  /** Sizes the ground, sun shadows, fog and camera to match a city of the given width. */
  private fitToCity(size: number): void {
    this.citySize = size;
    // Big enough that its edge is always lost in the fog.
    this.ground.scale.set(size * 12, size * 12, 1);
    // The sky dome must sit inside the camera's far limit (camera.far is set below).
    this.sky.mesh.scale.setScalar(size * 8);

    // The sun's shadow camera only covers a box; make it just big enough for the city.
    const half = size * 0.75;
    const shadowCamera = this.sun.shadow.camera;
    shadowCamera.left = -half;
    shadowCamera.right = half;
    shadowCamera.top = half;
    shadowCamera.bottom = -half;
    shadowCamera.far = size * 4;
    shadowCamera.updateProjectionMatrix();
    // "Shadow acne": with one shadow-map pixel covering a patch of ground, flat surfaces partly
    // shadow themselves, showing as stripes. Testing a little way out along the surface normal
    // (about 1.5 shadow pixels) fixes it. The bigger the city, the bigger a shadow pixel.
    const shadowPixel = (2 * half) / this.sun.shadow.mapSize.x;
    this.sun.shadow.normalBias = shadowPixel * 1.5;
    this.applyTheme(); // fog distances and the sun's distance depend on the city size

    // Start looking down at the city from a corner.
    this.flight = null;
    this.camera.position.set(size * 0.9, size * 0.8, size * 0.9);
    this.camera.far = size * 10;
    this.camera.updateProjectionMatrix();
    this.controls.target.set(0, 0, 0);
    this.controls.maxDistance = size * 4;
    this.controls.update();
  }

  private resize(): void {
    const { clientWidth: width, clientHeight: height } = this.container;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
  }
}
