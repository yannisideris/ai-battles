// Procedural village battlefield: ground, houses, trees, fences, rocks + a navigation grid.
import * as THREE from "three";
import { MAP_W, MAP_H } from "./config.js";

export const CELL = 1;                       // nav grid cell size
const GW = MAP_W / CELL, GH = MAP_H / CELL;
// cell flags
export const FREE = 0, BLOCK = 1, FENCE = 2;  // BLOCK stops movement + arrows, FENCE stops movement only

function rng(seed) { // mulberry32
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export function toonGradient() {
  const data = new Uint8Array([90, 170, 255]);
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.needsUpdate = true;
  return tex;
}

export class World {
  constructor(scene, quality, seed = (Math.random() * 1e9) | 0) {
    this.scene = scene; this.q = quality; this.rand = rng(seed);
    this.grid = new Uint8Array(GW * GH);
    this.group = new THREE.Group(); scene.add(this.group);
    this.grad = toonGradient();
    this.mat = (c) => new THREE.MeshToonMaterial({ color: c, gradientMap: this.grad });
    this.buildGround();
    this.buildVillage();
  }

  // ---------- grid helpers
  toCell(x, z) { return [Math.floor((x + MAP_W / 2) / CELL), Math.floor((z + MAP_H / 2) / CELL)]; }
  cellCenter(cx, cz) { return [cx * CELL - MAP_W / 2 + CELL / 2, cz * CELL - MAP_H / 2 + CELL / 2]; }
  inGrid(cx, cz) { return cx >= 0 && cz >= 0 && cx < GW && cz < GH; }
  get(cx, cz) { return this.inGrid(cx, cz) ? this.grid[cz * GW + cx] : BLOCK; }
  set(cx, cz, v) { if (this.inGrid(cx, cz)) this.grid[cz * GW + cx] = v; }
  walkable(x, z) { const [cx, cz] = this.toCell(x, z); return this.get(cx, cz) === FREE; }
  // push a circle (x, z, r) out of any blocked cell it overlaps; returns the corrected [x, z]
  pushOut(x, z, r) {
    const [cx, cz] = this.toCell(x, z);
    for (let pass = 0; pass < 2; pass++) {
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        if (this.get(cx + dx, cz + dz) === FREE) continue;
        const [mx, mz] = this.cellCenter(cx + dx, cz + dz), h = CELL / 2;
        const qx = Math.max(mx - h, Math.min(x, mx + h)), qz = Math.max(mz - h, Math.min(z, mz + h));
        const ox = x - qx, oz = z - qz, d = Math.hypot(ox, oz);
        if (d >= r) continue;
        if (d > 1e-5) { x += ox / d * (r - d); z += oz / d * (r - d); }
        else { // centre is inside the cell: leave by the nearest edge
          const ex = [mx - h - r - x, mx + h + r - x], ez = [mz - h - r - z, mz + h + r - z];
          const bx = Math.abs(ex[0]) < Math.abs(ex[1]) ? ex[0] : ex[1], bz = Math.abs(ez[0]) < Math.abs(ez[1]) ? ez[0] : ez[1];
          if (Math.abs(bx) < Math.abs(bz)) x += bx; else z += bz;
        }
      }
    }
    return [x, z];
  }
  blocksArrow(x, z) { const [cx, cz] = this.toCell(x, z); return this.get(cx, cz) === BLOCK; }
  markRect(x0, z0, x1, z1, v) {
    const [a, b] = this.toCell(x0, z0), [c, d] = this.toCell(x1, z1);
    for (let i = a; i <= c; i++) for (let j = b; j <= d; j++) this.set(i, j, v);
  }
  areaFree(x0, z0, x1, z1) {
    const [a, b] = this.toCell(x0, z0), [c, d] = this.toCell(x1, z1);
    for (let i = a - 1; i <= c + 1; i++) for (let j = b - 1; j <= d + 1; j++) if (this.get(i, j) !== FREE) return false;
    return true;
  }

  // line of sight for arrows (fences don't block)
  lineClear(ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / (CELL * 0.35));
    for (let i = 1; i < n; i++) { const t = i / n; if (this.blocksArrow(ax + (bx - ax) * t, az + (bz - az) * t)) return false; }
    return true;
  }

  // ---------- A* on the grid (8-neighbour, no corner cutting)
  isFence(x, z) { const [cx, cz] = this.toCell(x, z); return this.get(cx, cz) === FENCE; }
  // passFence: also step over fences, and return the raw cell centres (used to hop a unit out of a fenced-in pocket)
  findPath(sx, sz, tx, tz, maxIter = 2500, passFence = false) {
    const ok = (c) => c === FREE || (passFence && c === FENCE);
    let [scx, scz] = this.toCell(sx, sz); let [tcx, tcz] = this.toCell(tx, tz);
    if (this.get(tcx, tcz) !== FREE) { const n = this.nearestFree(tcx, tcz); if (!n) return null; [tcx, tcz] = n; }
    const key = (x, z) => z * GW + x, start = key(scx, scz), goal = key(tcx, tcz);
    if (start === goal) return [[tx, tz]];
    const g = new Map([[start, 0]]), came = new Map(), open = [[start, 0]], closed = new Set();
    const h = (k) => { const x = k % GW, z = (k / GW) | 0; const dx = Math.abs(x - tcx), dz = Math.abs(z - tcz); return Math.max(dx, dz) + 0.41 * Math.min(dx, dz); };
    let it = 0;
    while (open.length && it++ < maxIter) {
      let bi = 0; for (let i = 1; i < open.length; i++) if (open[i][1] < open[bi][1]) bi = i;
      const [cur] = open.splice(bi, 1)[0];
      if (cur === goal) break;
      if (closed.has(cur)) continue; closed.add(cur);
      const cx = cur % GW, cz = (cur / GW) | 0;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz;
        if (!ok(this.get(nx, nz)) && key(nx, nz) !== start) continue;
        if (dx && dz && (!ok(this.get(cx + dx, cz)) || !ok(this.get(cx, cz + dz)))) continue;
        const nk = key(nx, nz), ng = g.get(cur) + (dx && dz ? 1.414 : 1);
        if (ng < (g.get(nk) ?? Infinity)) { g.set(nk, ng); came.set(nk, cur); open.push([nk, ng + h(nk)]); }
      }
    }
    if (!came.has(goal)) return null;
    const cells = []; for (let k = goal; k !== start; k = came.get(k)) cells.push(k);
    cells.reverse();
    const pts = cells.map((k) => this.cellCenter(k % GW, (k / GW) | 0));
    if (passFence) return [[sx, sz], ...pts];
    pts[pts.length - 1] = [tx, tz];
    return this.smooth(sx, sz, pts);
  }
  nearestFree(cx, cz) {
    for (let r = 1; r < 6; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++)
      if (this.get(cx + dx, cz + dz) === FREE) return [cx + dx, cz + dz];
    return null;
  }
  walkLineClear(ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / 0.3);
    for (let i = 1; i <= n; i++) { const t = i / n; const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      for (const [ox, oz] of [[0.28, 0], [-0.28, 0], [0, 0.28], [0, -0.28]]) if (!this.walkable(x + ox, z + oz)) return false; }
    return true;
  }
  smooth(sx, sz, pts) { // string pulling
    const out = []; let ax = sx, az = sz, i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      while (j > i && !this.walkLineClear(ax, az, pts[j][0], pts[j][1])) j--;
      out.push(pts[j]); [ax, az] = pts[j]; i = j + 1;
    }
    return out;
  }

  // ---------- visuals
  buildGround() {
    const geo = new THREE.PlaneGeometry(MAP_W + 30, MAP_H + 30, 70, 86);
    geo.rotateX(-Math.PI / 2);
    const col = new THREE.Color(), cols = [], pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const n = Math.sin(x * 0.35) * Math.cos(z * 0.3) * 0.5 + Math.sin(x * 1.3 + z * 0.9) * 0.25 + this.rand() * 0.25;
      const edge = Math.max(Math.abs(x) - MAP_W / 2, Math.abs(z) - MAP_H / 2, 0);
      col.setHSL(0.27 + n * 0.02, 0.5 - Math.min(edge, 8) * 0.03, 0.42 + n * 0.05 - Math.min(edge, 8) * 0.02);
      cols.push(col.r, col.g, col.b);
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
    const ground = new THREE.Mesh(geo, new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: this.grad }));
    ground.receiveShadow = true; ground.name = "ground";
    this.group.add(ground); this.ground = ground;
    // dirt road through the village
    const road = new THREE.Mesh(new THREE.PlaneGeometry(3.2, MAP_H + 30), new THREE.MeshToonMaterial({ color: 0xb59a6a, gradientMap: this.grad }));
    road.rotation.x = -Math.PI / 2; road.position.set(this.rand() * 6 - 3, 0.01, 0); road.receiveShadow = true;
    this.group.add(road);
    // map border (invisible walls in the grid, low stone line visually)
    for (let cx = 0; cx < GW; cx++) { this.set(cx, 0, BLOCK); this.set(cx, GH - 1, BLOCK); }
    for (let cz = 0; cz < GH; cz++) { this.set(0, cz, BLOCK); this.set(GW - 1, cz, BLOCK); }
  }

  buildVillage() {
    const r = this.rand, zMin = -MAP_H / 2 + 9, zMax = MAP_H / 2 - 9; // keep spawn zones open
    this.houses = [];
    let tries = 0;
    while (this.houses.length < 7 && tries++ < 400) {
      const w = 3 + Math.floor(r() * 2), d = 3 + Math.floor(r() * 2);
      const x = (r() - 0.5) * (MAP_W - 10), z = zMin + r() * (zMax - zMin);
      if (!this.areaFree(x - w / 2 - 1, z - d / 2 - 1, x + w / 2 + 1, z + d / 2 + 1)) continue;
      this.addHouse(x, z, w, d, r() < 0.5 ? 0 : Math.PI / 2);
    }
    // fences near houses
    for (const h of this.houses) {
      for (let k = 0; k < 2; k++) {
        const horiz = r() < 0.5, len = 3 + Math.floor(r() * 3), side = r() < 0.5 ? -1 : 1;
        const fx = horiz ? h.x - len / 2 : h.x + side * (h.w / 2 + 2), fz = horiz ? h.z + side * (h.d / 2 + 2) : h.z - len / 2;
        if (this.areaFree(fx - 0.1, fz - 0.1, fx + (horiz ? len : 0.1), fz + (horiz ? 0.1 : len))) this.addFence(fx, fz, len, horiz);
      }
    }
    // trees in clusters + a few rocks
    const clusters = 8;
    for (let c = 0; c < clusters; c++) {
      const cx = (r() - 0.5) * (MAP_W - 6), cz = zMin + r() * (zMax - zMin);
      const n = 2 + Math.floor(r() * 4);
      for (let i = 0; i < n; i++) {
        const x = cx + (r() - 0.5) * 5, z = cz + (r() - 0.5) * 5;
        if (this.areaFree(x - 0.4, z - 0.4, x + 0.4, z + 0.4)) this.addTree(x, z);
      }
    }
    for (let i = 0; i < 9; i++) {
      const x = (r() - 0.5) * (MAP_W - 4), z = (r() - 0.5) * (MAP_H - 6);
      if (this.areaFree(x - 0.4, z - 0.4, x + 0.4, z + 0.4)) this.addRock(x, z);
    }
  }

  addHouse(x, z, w, d, rot) {
    if (rot) [w, d] = [d, w];
    const g = new THREE.Group(); g.position.set(x, 0, z);
    const wallH = 1.6;
    const walls = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), this.mat(0xefe3c8));
    walls.position.y = wallH / 2;
    const roofGeo = new THREE.CylinderGeometry(0.01, 1, 1, 4, 1, false, Math.PI / 4);
    const roof = new THREE.Mesh(roofGeo, this.mat(0xd9653b));
    roof.scale.set(w * 0.78, 1.3, d * 0.78); roof.position.y = wallH + 0.65;
    const beams = new THREE.Mesh(new THREE.BoxGeometry(w + 0.05, 0.12, d + 0.05), this.mat(0x6b4426)); beams.position.y = wallH - 0.05;
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.95, 0.06), this.mat(0x7a4b28)); door.position.set(0, 0.48, d / 2 + 0.02);
    const chim = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.0, 0.35), this.mat(0x9a9188)); chim.position.set(w * 0.25, wallH + 0.9, -d * 0.15);
    for (const m of [walls, roof, beams, door, chim]) { m.castShadow = this.q.shadows; m.receiveShadow = true; g.add(m); }
    this.group.add(g);
    this.markRect(x - w / 2 + 0.05, z - d / 2 + 0.05, x + w / 2 - 0.05, z + d / 2 - 0.05, BLOCK);
    this.houses.push({ x, z, w, d });
  }
  addFence(x, z, len, horiz) {
    const g = new THREE.Group(), m = this.mat(0x8b5a2b);
    for (let i = 0; i <= len; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.7, 0.12), m);
      p.position.set(horiz ? x + i : x, 0.35, horiz ? z : z + i); p.castShadow = this.q.shadows; g.add(p);
    }
    for (const y of [0.25, 0.52]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(horiz ? len : 0.07, 0.08, horiz ? 0.07 : len), m);
      rail.position.set(horiz ? x + len / 2 : x, y, horiz ? z : z + len / 2); rail.castShadow = this.q.shadows; g.add(rail);
    }
    this.group.add(g);
    this.markRect(x, z, horiz ? x + len : x, horiz ? z : z + len, FENCE);
  }
  addTree(x, z) {
    const g = new THREE.Group(); g.position.set(x, 0, z);
    const s = 0.8 + this.rand() * 0.5;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * s, 0.18 * s, 1.1 * s, 6), this.mat(0x7a5230));
    trunk.position.y = 0.55 * s; g.add(trunk);
    const leafCol = new THREE.Color().setHSL(0.28 + this.rand() * 0.06, 0.55, 0.32 + this.rand() * 0.08);
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(new THREE.IcosahedronGeometry((0.65 - i * 0.12) * s, 0), this.mat(leafCol));
      b.position.set((this.rand() - 0.5) * 0.3, (1.25 + i * 0.45) * s, (this.rand() - 0.5) * 0.3);
      b.rotation.set(this.rand(), this.rand(), this.rand()); g.add(b);
    }
    g.traverse((o) => { if (o.isMesh) { o.castShadow = this.q.shadows; o.receiveShadow = true; } });
    this.group.add(g);
    this.markRect(x - 0.2, z - 0.2, x + 0.2, z + 0.2, BLOCK);
  }
  addRock(x, z) {
    const s = 0.35 + this.rand() * 0.3;
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), this.mat(0x8d9099));
    m.position.set(x, s * 0.5, z); m.scale.y = 0.6; m.rotation.y = this.rand() * 6;
    m.castShadow = this.q.shadows; m.receiveShadow = true; this.group.add(m);
    this.markRect(x - s * 0.5, z - s * 0.5, x + s * 0.5, z + s * 0.5, BLOCK);
  }
}
