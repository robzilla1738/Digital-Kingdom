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

/** Dusk sky with a soft vignette, drawn as the scene background so the canvas stays opaque (a transparent
 * canvas must be re-blended with the page on every frame, which is costly on software renderers). */
let sky: THREE.CanvasTexture | null = null;
export function skyTexture(): THREE.CanvasTexture {
  if (sky) return sky;
  const c = document.createElement("canvas"); c.width = 256; c.height = 256;
  const ctx = c.getContext("2d")!;
  const base = ctx.createRadialGradient(128, -40, 10, 128, -40, 340);
  base.addColorStop(0, "#2b3a52"); base.addColorStop(0.45, "#18212f"); base.addColorStop(1, "#0d1118");
  ctx.fillStyle = base; ctx.fillRect(0, 0, 256, 256);
  const vignette = ctx.createRadialGradient(128, 115, 70, 128, 115, 190);
  vignette.addColorStop(0, "rgba(5,7,11,0)"); vignette.addColorStop(1, "rgba(5,7,11,0.55)");
  ctx.fillStyle = vignette; ctx.fillRect(0, 0, 256, 256);
  sky = new THREE.CanvasTexture(c); sky.colorSpace = THREE.SRGBColorSpace; return sky;
}

/** Procedural surface detail, computed in world space so the shared UV-less geometry, its digests and
 * its triangle counts stay unchanged. Deterministic and status-independent: it only modulates the baked
 * vertex colour (masonry courses, roof slates, flagstones, grass and rock strata), never hue by state. Fades out with
 * screen-space derivatives so distant views stay calm instead of shimmering. */
export type SurfaceKind = "masonry" | "slate" | "paving" | "lawn";
const SURFACE_COMMON = /* glsl */ `
varying vec3 vDkWorld; varying vec3 vDkNormal;
/* Arithmetic hash (no sin): far cheaper on software rasterisers, and stable across GPUs. */
float dkHash(vec2 p) { vec3 q = fract(p.xyx * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float dkNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(dkHash(i), dkHash(i + vec2(1, 0)), f.x), mix(dkHash(i + vec2(0, 1)), dkHash(i + vec2(1, 1)), f.x), f.y); }
/* Running-bond blocks: x = per-block tone in [0,1), y = joint mask (1 inside a block, 0 on mortar). */
vec2 dkBond(vec2 uv, vec2 size, float joint) { float row = floor(uv.y / size.y); vec2 q = vec2(uv.x / size.x + mod(row, 2.0) * 0.5, uv.y / size.y);
  vec2 cell = floor(q), f = fract(q), w = fwidth(q) + 1e-4, j = joint / size;
  float inside = smoothstep(j.x, j.x + w.x, f.x) * smoothstep(j.x, j.x + w.x, 1.0 - f.x) * smoothstep(j.y, j.y + w.y, f.y) * smoothstep(j.y, j.y + w.y, 1.0 - f.y);
  float fade = clamp(1.6 - 3.0 * max(w.x * size.x / size.y, w.y), 0.0, 1.0);
  return vec2(dkHash(cell), mix(1.0, inside, fade)); }
`;
const SURFACE_BODY: Record<SurfaceKind, string> = {
  masonry: `{ vec3 n = abs(normalize(vDkNormal)); float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
    float stone = smoothstep(0.22, 0.42, lum);
    vec2 uv = n.y > 0.7 ? vDkWorld.xz : vec2(n.x > n.z ? vDkWorld.z : vDkWorld.x, vDkWorld.y);
    vec2 b = n.y > 0.7 ? dkBond(uv, vec2(0.42, 0.3), 0.018) : dkBond(uv, vec2(0.36, 0.165), 0.014);
    float grain = dkNoise(vDkWorld.xz * 3.1 + vDkWorld.y * 2.3);
    float weather = smoothstep(0.55, 0.0, vDkWorld.y) * (0.55 + 0.45 * grain);
    vec3 c = diffuseColor.rgb * (0.9 + 0.17 * b.x) * mix(0.7, 1.0, b.y) * (0.94 + 0.12 * grain);
    c = mix(c, c * vec3(0.78, 0.8, 0.72), weather * 0.45);
    diffuseColor.rgb = mix(diffuseColor.rgb * (0.95 + 0.1 * grain), c, stone); }`,
  slate: `{ vec3 n = normalize(vDkNormal); vec2 uv = vec2(abs(n.x) > abs(n.z) ? vDkWorld.z : vDkWorld.x, vDkWorld.y * 1.6);
    vec2 b = dkBond(uv, vec2(0.2, 0.12), 0.012);
    diffuseColor.rgb *= (0.86 + 0.24 * b.x) * mix(0.62, 1.0, b.y); }`,
  paving: `{ vec2 b = dkBond(vDkWorld.xz, vec2(0.55, 0.42), 0.02); float grain = dkNoise(vDkWorld.xz * 2.7);
    diffuseColor.rgb *= (0.88 + 0.2 * b.x) * mix(0.72, 1.0, b.y) * (0.93 + 0.14 * grain); }`,
  lawn: `{ vec3 n = normalize(vDkNormal); float top = smoothstep(0.55, 0.75, n.y);
    float patches = dkNoise(vDkWorld.xz * 0.35), clumps = dkNoise(vDkWorld.xz * 2.2 + 11.0);
    vec3 grass = diffuseColor.rgb * (0.72 + 0.5 * patches) * (0.86 + 0.24 * clumps);
    grass = mix(grass, grass * vec3(1.18, 1.1, 0.74), smoothstep(0.6, 0.88, patches) * 0.7);
    grass = mix(grass, grass * vec3(0.8, 0.92, 0.86), smoothstep(0.45, 0.2, clumps) * 0.5);
    float strata = dkHash(vec2(floor(vDkWorld.y * 9.0), floor((vDkWorld.x + vDkWorld.z) * 1.4)));
    diffuseColor.rgb = mix(diffuseColor.rgb * (0.78 + 0.36 * strata), grass, top); }`,
};
const ROUGHNESS_BODY: Partial<Record<SurfaceKind, string>> = {
  slate: `roughnessFactor = clamp(roughnessFactor - 0.12 * dkHash(floor(vDkWorld.xy * 8.0)), 0.0, 1.0);`,
};
export function applySurface<M extends THREE.MeshStandardMaterial>(material: M, kind: SurfaceKind): M {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vDkWorld; varying vec3 vDkNormal;`)
      .replace("#include <project_vertex>", `#include <project_vertex>\nvDkWorld = (modelMatrix * vec4(transformed, 1.0)).xyz; vDkNormal = normalize(mat3(modelMatrix) * objectNormal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${SURFACE_COMMON}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${SURFACE_BODY[kind]}`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\n${ROUGHNESS_BODY[kind] ?? ""}`);
  };
  // The default key is onBeforeCompile's source text, which is identical for every kind; callers may override it.
  material.customProgramCacheKey = () => `dk-surface-v2:${kind}`;
  return material;
}
