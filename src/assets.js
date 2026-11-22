// Loads the rigged unit GLBs once, converts them to a shared toon look, and hands out clones.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { MODEL_FILES } from "./config.js";
import { toonGradient } from "./world.js";

const loader = new GLTFLoader();
const grad = toonGradient();
const templates = {};   // team -> type -> { scene, clips }

// Inverted-hull outline that works with skinning: push skinned vertices out along the skinned normal.
function outlineMaterial(width) {
  const m = new THREE.MeshBasicMaterial({ color: 0x1a1414, side: THREE.BackSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace("#include <project_vertex>",
      `transformed += normalize(objectNormal) * ${width.toFixed(4)};\n#include <project_vertex>`);
  };
  return m;
}

// The hull needs ONE normal per position: with split normals (hard edges such as a sword blade) the pushed-out
// faces separate and show up as black flaps that trail the weapon. Average the normals of coincident vertices.
function hullGeometry(src) {
  const g = src.clone(), pos = g.attributes.position, nrm = g.attributes.normal;
  if (!nrm) return g;
  const key = (i) => `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
  const sum = new Map(), v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const k = key(i); let acc = sum.get(k); if (!acc) sum.set(k, (acc = new THREE.Vector3()));
    acc.add(v.fromBufferAttribute(nrm, i));
  }
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) { const n = sum.get(key(i)).clone().normalize(); out.set([n.x, n.y, n.z], i * 3); }
  g.setAttribute("normal", new THREE.BufferAttribute(out, 3));
  return g;
}

function toToon(root, outline) {
  const extra = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const src = o.material;
    const toon = new THREE.MeshToonMaterial({ map: src.map || null, color: src.map ? 0xffffff : src.color, gradientMap: grad });
    if (toon.map) toon.map.colorSpace = THREE.SRGBColorSpace;
    o.material = toon; o.castShadow = true; o.receiveShadow = false;
    o.frustumCulled = false; // skinned bounds are unreliable when animated
    if (outline && o.isSkinnedMesh) {
      const hull = new THREE.SkinnedMesh(hullGeometry(o.geometry), outlineMaterial(0.012));
      hull.bind(o.skeleton, o.bindMatrix); hull.frustumCulled = false; hull.castShadow = false;
      extra.push([o.parent, hull, o]);
    }
  });
  for (const [parent, hull, src] of extra) { hull.position.copy(src.position); hull.quaternion.copy(src.quaternion); hull.scale.copy(src.scale); parent.add(hull); }
}

// The new skeleton models (Pixal3D) kept the drawings' deep magenta: more saturated than the original skeletons and
// with dark painted shadows in the cloth, where the originals are pastel pink with almost no dark shading.
// Fix on load: only the pink/magenta/red cloth pixels, matched to the original soldier + archer by their whole
// distribution (quantile mapping of saturation and brightness), not just the average - so the dark shadows open up
// too. Measured on the original textures (11 quantiles, 0%..100%):
const SKEL_TARGET = {
  S: [0.08, 0.125, 0.208, 0.359, 0.541, 0.656, 0.681, 0.719, 0.764, 0.804, 1],
  V: [0.122, 0.431, 0.525, 0.604, 0.675, 0.729, 0.769, 0.796, 0.812, 0.839, 0.973],
  hue: 338,
};
const SKEL_ORIGINALS = ["captain", "soldier", "archer"];
function rgb2hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0; if (d) { h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
  return [h, mx ? d / mx : 0, mx];
}
function hsv2rgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}
const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
const clamp01 = (x) => Math.min(1, Math.max(0, x));
function clothWeight(h, s, v, d) {   // 0..1: how much this pixel is "team cloth" (soft edges, so no seams)
  return clamp01((s - 0.08) / 0.08) * clamp01((v - 0.1) / 0.06) * clamp01((d - 0.03) / 0.03) * clamp01((60 - hueDist(h, 335)) / 15);
}
// value -> its rank (0..1) in the sorted samples, then -> the target's value at that rank
function quantileMap(sorted, target) {
  const n = sorted.length;
  return (x) => {
    let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < x) lo = m + 1; else hi = m; }
    const t = (lo / n) * 10, i = Math.min(9, Math.floor(t)), f = t - i;
    return target[i] + (target[i + 1] - target[i]) * f;
  };
}
function softenSkeletonCloth(root, k = 1) {   // k: 0 = untouched .. 1 = full match
  root.traverse((o) => {
    const map = o.isMesh && o.material?.map; if (!map?.image || map.userData.softened) return;
    const img = map.image, W = img.width, H = img.height;
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const cx = cv.getContext("2d", { willReadFrequently: true }); cx.drawImage(img, 0, 0);
    const id = cx.getImageData(0, 0, W, H), d = id.data;
    // this model's own cloth distribution
    const S = [], V = [];
    for (let i = 0; i < d.length; i += 16) {
      const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255, [h, s, v] = rgb2hsv(r, g, b);
      if (clothWeight(h, s, v, v - Math.min(r, g, b)) > 0.5) { S.push(s); V.push(v); }
    }
    if (S.length < 200) return;
    S.sort((x, y) => x - y); V.sort((x, y) => x - y);
    const mapS = quantileMap(S, SKEL_TARGET.S), mapV = quantileMap(V, SKEL_TARGET.V);
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255, [h, s, v] = rgb2hsv(r, g, b);
      const w = k * clothWeight(h, s, v, v - Math.min(r, g, b)); if (!w) continue;
      let dh = SKEL_TARGET.hue - h; if (dh > 180) dh -= 360; if (dh < -180) dh += 360;
      const [nr, ng, nb] = hsv2rgb((h + dh * 0.3 + 360) % 360, mapS(s), mapV(v));
      d[i] = 255 * (r + (nr - r) * w); d[i + 1] = 255 * (g + (ng - g) * w); d[i + 2] = 255 * (b + (nb - b) * w);
    }
    cx.putImageData(id, 0, 0);
    const tex = new THREE.CanvasTexture(cv);
    for (const k of ["flipY", "wrapS", "wrapT", "colorSpace", "channel", "minFilter", "magFilter"]) tex[k] = map[k];
    tex.userData.softened = true; tex.needsUpdate = true;
    o.material.map = tex;
  });
}
// Off by default: side by side, the user preferred the models' own deeper colours (more depth in the cloth).
// ?skelcolor=soft turns the correction on (kept for comparison).
const SOFTEN = new URLSearchParams(location.search).get("skelcolor") === "soft";
// Per-model exception: the coffin-shield bearer reads too deep next to the rest, so only it gets a partial correction.
// ?shieldsoft=0..1 overrides the strength (for comparing).
const SOFTEN_ONLY = { shieldbearer: Number(new URLSearchParams(location.search).get("shieldsoft") ?? 0.5) };

async function loadOne(url) {
  try { return await loader.loadAsync(url); } catch { return null; }
}

// loads the models of the given [team, type] pairs (default: everything) once; later calls reuse them
let loadedOutline = null;
export async function loadUnitModels(quality, needed = null, onProgress = () => {}) {
  if (loadedOutline !== quality.outline) { for (const k of Object.keys(templates)) delete templates[k]; loadedOutline = quality.outline; }
  const entries = [];
  for (const team of Object.keys(MODEL_FILES)) for (const type of Object.keys(MODEL_FILES[team])) {
    if (needed && !needed.some(([a, b]) => a === team && b === type)) continue;
    if (templates[team]?.[type] && !templates[team][type].fallback) continue;
    entries.push([team, type]);
  }
  let done = 0;
  await Promise.all(entries.map(async ([team, type]) => {
    // dev preview of new art: ?preview_human_soldier=human_spearman swaps in assets/models/human_spearman.glb
    const swap = new URLSearchParams(location.search).get(`preview_${team}_${type}`);
    const gltf = await loadOne(swap ? `assets/models/${swap.replace(/[^\w-]/g, "")}.glb` : MODEL_FILES[team][type]);
    templates[team] ??= {};
    if (gltf && team === "skeleton" && !SKEL_ORIGINALS.includes(type) && !swap) {
      const k = SOFTEN ? 1 : SOFTEN_ONLY[type] || 0;
      if (k > 0) softenSkeletonCloth(gltf.scene, Math.min(1, k));
    }
    if (gltf) { toToon(gltf.scene, quality.outline); templates[team][type] = { scene: gltf.scene, clips: gltf.animations }; }
    onProgress(++done / entries.length);
  }));
  // fall back to any loaded model of the same team (or any team) while art is missing
  const any = Object.values(templates).flatMap((t) => Object.values(t))[0];
  if (!any) throw new Error("No unit models could be loaded");
  for (const [team, type] of entries) {
    templates[team] ??= {};
    if (!templates[team][type]) templates[team][type] = { ...(Object.values(templates[team])[0] || any), fallback: true };
  }
}

export function spawnModel(team, type) {
  const t = templates[team][type];
  const scene = SkeletonUtils.clone(t.scene);
  return { scene, clips: t.clips };
}
