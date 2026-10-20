import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from "three";
import type { Rect } from "./layout/types";

// Shared 1×1 plane, stretched per label with `scale`.
const planeGeometry = new PlaneGeometry(1, 1);

const CANVAS_HEIGHT = 64;
const MAX_CANVAS_WIDTH = 1024;

/**
 * Creates a flat text label lying on the ground inside `rect`, at height `y`.
 * The text is drawn on a <canvas>, which becomes the texture of a plane.
 * Painted like a street name: white text with a dark outline, on the asphalt.
 */
export function createLabel(text: string, rect: Rect, y: number): Mesh {
  // Text is drawn at a fixed pixel height, so very long strips are capped and the label
  // gets shorter instead of stretching the letters.
  const height = rect.h * 0.7;
  const canvasWidth = Math.min(MAX_CANVAS_WIDTH, Math.round((CANVAS_HEIGHT * rect.w) / height));
  const width = (canvasWidth / CANVAS_HEIGHT) * height;

  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = CANVAS_HEIGHT;
  const context = canvas.getContext("2d")!;
  context.font = "600 40px system-ui, sans-serif";
  context.textBaseline = "middle";
  const shown = fitText(context, text, canvasWidth - 12);
  context.lineJoin = "round";
  context.lineWidth = 6;
  context.strokeStyle = "rgba(20, 24, 30, 0.6)";
  context.strokeText(shown, 6, CANVAS_HEIGHT / 2);
  context.fillStyle = "#eeebe0";
  context.fillText(shown, 6, CANVAS_HEIGHT / 2);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4; // keeps text sharper when seen at a low angle

  const material = new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
  const mesh = new Mesh(planeGeometry, material);
  mesh.scale.set(width, height, 1);
  mesh.rotation.x = -Math.PI / 2; // lay flat, text reads from the front (+z)
  // Left-aligned in the strip, a hair above the platform so it doesn't flicker into it.
  mesh.position.set(rect.x + width / 2, y + 0.02, rect.y + rect.h / 2);
  return mesh;
}

/** Shortens text with "…" until it fits in `maxWidth` pixels. */
function fitText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (context.measureText(text).width <= maxWidth) return text;
  let shortened = text;
  while (shortened.length > 1 && context.measureText(shortened + "…").width > maxWidth) {
    shortened = shortened.slice(0, -1);
  }
  return shortened + "…";
}
