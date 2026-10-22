import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Shared materials and cached geometry for the procedural castle kit. Everything is created once and
 * reused so the scene stays within a small draw-call and memory budget (no textures are downloaded).
 */
let cache: ReturnType<typeof create> | null = null;
let contrastCache: ReturnType<typeof create> | null = null;

function std(color: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0.02, ...o });
}

function create(highContrast: boolean) {
  return {
    stone: std(highContrast ? "#c9c6bf" : "#a29d92"),
    stoneLight: std(highContrast ? "#e3e0d8" : "#bcb6a8"),
    stoneDark: std(highContrast ? "#7d7a74" : "#77736b"),
    trim: std("#8c8578"),
    roof: std(highContrast ? "#2b3a52" : "#3d4b5f", { roughness: 0.8 }),
    roofWarm: std("#6b4a3a", { roughness: 0.85 }),
    roofTeal: std("#3e5d5a", { roughness: 0.8 }),
    wood: std("#5e4532"),
    metal: std("#8e96a1", { metalness: 0.65, roughness: 0.4 }),
    door: std("#2a211b"),
    window: std("#ffd27f", { emissive: new THREE.Color("#ffb347"), emissiveIntensity: 0.9, roughness: 0.5 }),
    forgeGlow: std("#ff8a3d", { emissive: new THREE.Color("#ff5a1f"), emissiveIntensity: 1.6 }),
    portal: new THREE.MeshStandardMaterial({ color: "#7fd8ff", emissive: new THREE.Color("#3fb4ff"), emissiveIntensity: 0.9, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    glass: new THREE.MeshStandardMaterial({ color: "#9fd4ff", emissive: new THREE.Color("#5aa9e6"), emissiveIntensity: 0.5, transparent: true, opacity: 0.75 }),
    banner: std("#8e3b3b", { side: THREE.DoubleSide }),
    bannerBlue: std("#35507a", { side: THREE.DoubleSide }),
    grass: std("#2c3a2f", { roughness: 1 }),
    courtyard: std("#4a4a46", { roughness: 1 }),
    water: new THREE.MeshStandardMaterial({ color: "#1f4a5e", roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.92 }),
    proxy: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  };
}

export type Materials = ReturnType<typeof create>;
export function materials(highContrast = false): Materials {
  if (highContrast) return (contrastCache ??= create(true));
  return (cache ??= create(false));
}

const geoCache = new Map<string, THREE.BufferGeometry>();

/** A crenellated parapet strip as ONE merged geometry (instead of one mesh per merlon). */
export function merlons(length: number, height = 0.32, depth = 0.34, spacing = 0.55): THREE.BufferGeometry {
  const key = `m:${length.toFixed(2)}:${height}:${depth}:${spacing}`;
  const hit = geoCache.get(key);
  if (hit) return hit;
  const n = Math.max(2, Math.floor(length / spacing));
  const step = length / n;
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i += 1) {
    if (i % 2) continue;
    const g = new THREE.BoxGeometry(step * 0.95, height, depth);
    g.translate(-length / 2 + step * (i + 0.5), height / 2, 0);
    parts.push(g);
  }
  const merged = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());
  geoCache.set(key, merged);
  return merged;
}

/** Hatched texture for "unknown / not assessed" coverage. Pattern, not just colour, carries the meaning. */
let hatchTex: THREE.CanvasTexture | null = null;
export function hatchTexture(): THREE.CanvasTexture {
  if (hatchTex) return hatchTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 64, 64);
  ctx.strokeStyle = "rgba(220,224,232,0.9)";
  ctx.lineWidth = 6;
  for (let i = -64; i < 128; i += 18) { ctx.beginPath(); ctx.moveTo(i, 64); ctx.lineTo(i + 64, 0); ctx.stroke(); }
  hatchTex = new THREE.CanvasTexture(c);
  hatchTex.wrapS = hatchTex.wrapT = THREE.RepeatWrapping;
  hatchTex.colorSpace = THREE.SRGBColorSpace;
  return hatchTex;
}
