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

// The new skeleton models (Pixal3D) came out darker and more saturated in the cloth than the three original ones
// (deep magenta instead of pink). Measured on the textures: originals ~ hue 338, saturation 0.69, value 0.64.
// This pulls only the pink/magenta/red cloth pixels of a model towards those numbers (bone, metal, wood untouched).
const SKEL_TARGET = { hue: 338, sat: 0.69, val: 0.64 };
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
function clothWeight(h, s, v) {   // 0..1: how much this pixel is "team cloth"
  const sw = Math.min(1, Math.max(0, (s - 0.25) / 0.15)), vw = Math.min(1, Math.max(0, (v - 0.1) / 0.1));
  const hw = Math.min(1, Math.max(0, (60 - hueDist(h, 335)) / 15));   // within ~45 deg of magenta, soft edge
  return sw * vw * hw;
}
function softenSkeletonCloth(root) {
  root.traverse((o) => {
    const map = o.isMesh && o.material?.map; if (!map?.image || map.userData.softened) return;
    const img = map.image, W = img.width, H = img.height;
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const cx = cv.getContext("2d", { willReadFrequently: true }); cx.drawImage(img, 0, 0);
    const id = cx.getImageData(0, 0, W, H), d = id.data;
    // this model's own cloth average (weighted)
    let n = 0, hs = 0, hc = 0, S = 0, V = 0;
    for (let i = 0; i < d.length; i += 16) {
      const [h, s, v] = rgb2hsv(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255), w = clothWeight(h, s, v); if (!w) continue;
      n += w; hs += w * Math.sin(h * Math.PI / 180); hc += w * Math.cos(h * Math.PI / 180); S += w * s; V += w * v;
    }
    if (n < 50) return;
    let mh = Math.atan2(hs, hc) * 180 / Math.PI; if (mh < 0) mh += 360;
    const sK = SKEL_TARGET.sat / (S / n), vK = SKEL_TARGET.val / (V / n);
    let dh = SKEL_TARGET.hue - mh; if (dh > 180) dh -= 360; if (dh < -180) dh += 360;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255, [h, s, v] = rgb2hsv(r, g, b), w = clothWeight(h, s, v);
      if (!w) continue;
      const [nr, ng, nb] = hsv2rgb((h + dh * 0.6 + 360) % 360, Math.min(1, s * sK), Math.min(1, v * vK));
      d[i] = 255 * (r + (nr - r) * w); d[i + 1] = 255 * (g + (ng - g) * w); d[i + 2] = 255 * (b + (nb - b) * w);
    }
    cx.putImageData(id, 0, 0);
    const tex = new THREE.CanvasTexture(cv);
    for (const k of ["flipY", "wrapS", "wrapT", "colorSpace", "channel", "minFilter", "magFilter"]) tex[k] = map[k];
    tex.userData.softened = true; tex.needsUpdate = true;
    o.material.map = tex;
  });
}
// ?skelcolor=raw shows the models exactly as they came out of Pixal3D (for comparison)
const SOFTEN = new URLSearchParams(location.search).get("skelcolor") !== "raw";

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
    if (gltf && SOFTEN && team === "skeleton" && !SKEL_ORIGINALS.includes(type) && !swap) softenSkeletonCloth(gltf.scene);
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
