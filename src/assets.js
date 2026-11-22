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
