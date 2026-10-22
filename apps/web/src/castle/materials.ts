import * as THREE from "three";

/** One app-owned local hatch texture; no network resource, no unbounded per-project cache.
 * Per-room texture transforms are cloned and disposed by CoverageHatch on unmount. */
let hatch: THREE.CanvasTexture | null = null;
export function hatchTexture(): THREE.CanvasTexture {
  if (hatch) return hatch;
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const ctx = c.getContext("2d")!; ctx.clearRect(0, 0, 64, 64);
  ctx.strokeStyle = "rgba(230,232,236,0.95)"; ctx.lineWidth = 4;
  for (let i = -64; i < 128; i += 16) { ctx.beginPath(); ctx.moveTo(i, 64); ctx.lineTo(i + 64, 0); ctx.stroke(); }
  hatch = new THREE.CanvasTexture(c); hatch.wrapS = hatch.wrapT = THREE.RepeatWrapping;
  hatch.colorSpace = THREE.SRGBColorSpace; return hatch;
}
