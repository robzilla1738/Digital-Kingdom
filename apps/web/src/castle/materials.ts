import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Shared materials and cached geometry for the procedural castle kit. Everything is created once and
 * reused so the scene stays within a small draw-call and memory budget (no textures are downloaded).
 */
let cache: ReturnType<typeof create> | null = null;
let contrastCache: ReturnType<typeof create> | null = null;

function std(color: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.94, metalness: 0, ...o });
}

/**
 * A restrained, matte palette: warm-grey stone, slate roofs, dark unlit windows. Emissive light is
 * reserved for evidence state (see windowLit), so a glow always means something.
 */
function create(highContrast: boolean) {
  return {
    stone: std(highContrast ? "#c9c6bf" : "#aaa59c"),
    stoneLight: std(highContrast ? "#e3e0d8" : "#bfbab0"),
    stoneDark: std(highContrast ? "#7d7a74" : "#7a766f"),
    trim: std("#7b766e"),
    // curtain walls sit back visually so the buildings (the assets) read first
    wall: std(highContrast ? "#9d9a94" : "#77736c"),
    wallTop: std(highContrast ? "#b5b2ab" : "#858179"),
    roof: std(highContrast ? "#2b3a52" : "#4a5566", { roughness: 0.82 }),
    roofWarm: std("#6e5a4e", { roughness: 0.85 }),
    roofTeal: std("#4a6062", { roughness: 0.82 }),
    wood: std("#4a3d33"),
    metal: std("#6f757d", { metalness: 0.5, roughness: 0.5 }),
    door: std("#24201d"),
    window: std("#2a3039", { roughness: 0.35 }),
    forgeGlow: std("#8a4a2a", { emissive: new THREE.Color("#c2551f"), emissiveIntensity: 0.45 }),
    portal: new THREE.MeshStandardMaterial({ color: "#6b8ca3", emissive: new THREE.Color("#3d6f92"), emissiveIntensity: 0.35, transparent: true, opacity: 0.5, side: THREE.DoubleSide, roughness: 0.6 }),
    glass: new THREE.MeshStandardMaterial({ color: "#7d95ab", roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.8 }),
    banner: std("#6b3a3d", { side: THREE.DoubleSide }),
    bannerBlue: std("#3a4766", { side: THREE.DoubleSide }),
    grass: std(highContrast ? "#141619" : "#111418", { roughness: 1 }),
    courtyard: std(highContrast ? "#2c2f33" : "#3a3d41", { roughness: 1 }),
    water: new THREE.MeshStandardMaterial({ color: "#1a2731", roughness: 0.2, metalness: 0.25 }),
    proxy: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  };
}

const litCache = new Map<string, THREE.MeshStandardMaterial>();
/** Windows lit in an evidence-state colour: the only emissive accent on a building. */
export function windowLit(color: string): THREE.MeshStandardMaterial {
  let m = litCache.get(color);
  if (!m) { m = std(color, { emissive: new THREE.Color(color), emissiveIntensity: 0.9, roughness: 0.4 }); litCache.set(color, m); }
  return m;
}

/** Soft radial "contact shadow" texture used as cheap ambient occlusion under every building. */
let aoTex: THREE.CanvasTexture | null = null;
export function aoTexture(): THREE.CanvasTexture {
  if (aoTex) return aoTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 64);
  g.addColorStop(0, "rgba(0,0,0,0.75)");
  g.addColorStop(0.45, "rgba(0,0,0,0.42)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  aoTex = new THREE.CanvasTexture(c);
  aoTex.colorSpace = THREE.SRGBColorSpace;
  return aoTex;
}

/** Soft radial glow (white, tinted by material colour) for evidence-state halos on the ground. */
let glowTex: THREE.CanvasTexture | null = null;
export function glowTexture(): THREE.CanvasTexture {
  if (glowTex) return glowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,0.0)");
  g.addColorStop(0.42, "rgba(255,255,255,0.0)");
  g.addColorStop(0.55, "rgba(255,255,255,0.55)");
  g.addColorStop(0.62, "rgba(255,255,255,0.28)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
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
  ctx.strokeStyle = "rgba(230,232,236,0.95)";
  ctx.lineWidth = 4;
  for (let i = -64; i < 128; i += 16) { ctx.beginPath(); ctx.moveTo(i, 64); ctx.lineTo(i + 64, 0); ctx.stroke(); }
  hatchTex = new THREE.CanvasTexture(c);
  hatchTex.wrapS = hatchTex.wrapT = THREE.RepeatWrapping;
  hatchTex.colorSpace = THREE.SRGBColorSpace;
  return hatchTex;
}
