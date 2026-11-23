// Procedural village battlefield: ground, houses, trees, fences, rocks + a navigation grid.
import * as THREE from "three";
import { MAP_W, MAP_H } from "./config.js";

export const CELL = 1;                       // nav grid cell size
const GW = MAP_W / CELL, GH = MAP_H / CELL;
// cell flags
export const FREE = 0, BLOCK = 1, FENCE = 2, WATER = 3, CLIFF = 4;  // BLOCK stops movement + arrows, FENCE/WATER/CLIFF stop movement only (no hopping over water / cliffs)
const ROCK = new THREE.Color(0x8c7f6a);
const smooth01 = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

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
  constructor(scene, quality, seed = (Math.random() * 1e9) | 0, terrain = "village", opts = {}) {
    this.scene = scene; this.q = quality; this.rand = rng(seed); this.terrain = terrain;
    this.grid = new Uint8Array(GW * GH);
    // exact obstacle outlines for body collision (the 1 m grid stays for path finding and arrow line-of-sight)
    this.shapes = [];
    this.group = new THREE.Group(); scene.add(this.group);
    this.grad = toonGradient();
    this.mat = (c) => new THREE.MeshToonMaterial({ color: c, gradientMap: this.grad });
    // hills: only some battlefields (never the skirmish village): always on "hills", sometimes on open / forest / ruins
    this.hills = [];
    const nHills = opts.hills ?? (terrain === "hills" ? 2 : 0);   // the campaign map decides (and shows it in advance)
    if (nHills && terrain !== "village") this.makeHills(nHills);
    this.buildGround();
    if (this.hills.length) this.markCliffs();
    if (terrain === "village") this.buildVillage();
    else if (terrain !== "empty") this.buildTerrain(terrain);
  }

  // ---------- height (hills). 0 everywhere on flat battlefields.
  // A hill: a flat top (wobbly ellipse) with gentle slopes on some sides and a steep cliff on others.
  height(x, z) {
    let best = 0;
    for (const h of this.hills) {
      const dx = x - h.x, dz = z - h.z;
      if (Math.abs(dx) > h.reach || Math.abs(dz) > h.reach) continue;
      const lx = dx * h.cos + dz * h.sin, lz = -dx * h.sin + dz * h.cos, a = Math.atan2(lz, lx);
      const wob = 1 + 0.12 * Math.sin(3 * a + h.ph) + 0.06 * Math.sin(5 * a + h.ph * 2);
      const rho = Math.hypot(lx / (h.rx * wob), lz / (h.rz * wob));
      if (rho <= 1) { best = Math.max(best, h.h); continue; }
      const sw = h.gentle + (h.steep - h.gentle) * this.cliffness(h, a), t = (rho - 1) / sw;
      if (t < 1) best = Math.max(best, h.h * (1 - smooth01(t)));
    }
    return best;
  }
  cliffness(h, a) {   // 0 = gentle slope, 1 = cliff, smooth across ~15 degrees at the ends of each cliff arc
    let c = 0;
    for (const [c0, c1] of h.cliffs) {
      let d = a - c0; while (d < 0) d += Math.PI * 2; while (d > Math.PI * 2) d -= Math.PI * 2;
      const span = c1 - c0, e = 0.26;
      if (d <= span) c = Math.max(c, Math.min(smooth01(d / e), smooth01((span - d) / e)));
    }
    return c;
  }
  hillMesh(h, mat) {
    // tight bounds: where this hill actually rises
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let x = h.x - h.reach; x <= h.x + h.reach; x += 0.5) for (let z = h.z - h.reach; z <= h.z + h.reach; z += 0.5)
      if (this.height(x, z) > 0.002) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    x0 -= 0.75; x1 += 0.75; z0 -= 0.75; z1 += 0.75;
    const st = 0.25, nx = Math.ceil((x1 - x0) / st) + 1, nz = Math.ceil((z1 - z0) / st) + 1;
    const posA = new Float32Array(nx * nz * 3), colA = new Float32Array(nx * nz * 3), ys = new Float32Array(nx * nz), col = new THREE.Color();
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, x = x0 + i * st, z = z0 + j * st, y = this.height(x, z);
      ys[k] = y; posA.set([x, y + 0.012, z], k * 3);
      this.groundColor(x, z, y, col); colA.set([col.r, col.g, col.b], k * 3);
    }
    const idx = [];
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      if (Math.max(ys[a], ys[b], ys[c], ys[d]) < 0.002) continue;   // flat: the ground below shows
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(posA, 3)); geo.setAttribute("color", new THREE.BufferAttribute(colA, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; m.castShadow = false;   // (self-shadow striped the cliff faces)
    return m;
  }
  makeHills(n) {
    const r = this.rand;
    for (let i = 0, tries = 0; i < n && tries < 50; tries++) {
      // in the middle band of the field (not on the spawn lines), left / right of the centre when there are two
      const x = n === 2 ? (i ? 1 : -1) * (6 + r() * 7) : (r() - 0.5) * 18, z = (r() - 0.5) * 20;
      const rx = 3.6 + r() * 2.6, rz = 2.8 + r() * 2, hh = 1.5 + r() * 0.8, rot = r() * Math.PI;
      if (this.hills.some((o) => Math.hypot(o.x - x, o.z - z) < o.rx + rx + 5)) continue;
      const cliffs = [], k = 1 + (r() < 0.5 ? 1 : 0);
      for (let j = 0; j < k; j++) { const c0 = r() * Math.PI * 2; cliffs.push([c0, c0 + 1.1 + r() * 1.0]); }
      // gentle: slope band ~ as wide as the hill is high x2.5 (normalised to the radius); steep: a near-vertical drop
      const gentle = (hh * 2.6) / Math.min(rx, rz), steep = 0.18;
      this.hills.push({ x, z, rx, rz, h: hh, cos: Math.cos(rot), sin: Math.sin(rot), ph: r() * 6, cliffs, gentle, steep,
        reach: Math.max(rx, rz) * 1.25 * (1 + gentle) + 1 });
      i++;
    }
  }
  // the steep parts become CLIFF cells: path finding goes round them, bodies cannot cross
  markCliffs() {
    for (let cx = 1; cx < GW - 1; cx++) for (let cz = 1; cz < GH - 1; cz++) {
      const [x, z] = this.cellCenter(cx, cz), q = 0.5;
      const g = Math.max(Math.abs(this.height(x + q, z) - this.height(x - q, z)), Math.abs(this.height(x, z + q) - this.height(x, z - q)),
        Math.abs(this.height(x + q, z + q) - this.height(x - q, z - q)) * 0.71, Math.abs(this.height(x + q, z - q) - this.height(x - q, z + q)) * 0.71);
      if (g > 0.85 && this.get(cx, cz) === FREE) this.set(cx, cz, CLIFF);
    }
  }
  // the top of a hill (for the AI): its centre, radius and height
  hillTops() { return this.hills.map((h) => ({ x: h.x, z: h.z, r: Math.min(h.rx, h.rz) * 0.8, h: h.h })); }
  // keep a body off cliff cells (the outlines in `shapes` do not include them)
  pushOffCliffs(x, z, r) {
    if (!this.hills.length) return [x, z];
    const [cx, cz] = this.toCell(x, z);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (this.get(cx + dx, cz + dz) !== CLIFF) continue;
      const [mx, mz] = this.cellCenter(cx + dx, cz + dz), hh = CELL / 2;
      const qx = Math.max(mx - hh, Math.min(x, mx + hh)), qz = Math.max(mz - hh, Math.min(z, mz + hh));
      const ox = x - qx, oz = z - qz, d = Math.hypot(ox, oz);
      if (d >= r) continue;
      if (d > 1e-5) { x += ox / d * (r - d); z += oz / d * (r - d); }
      else { const [px, pz] = this.pushOut(x, z, r); x = px; z = pz; }
    }
    return [x, z];
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
  // body collision against the real outlines (trunks, rocks, thin fences, house walls) + the map edge
  collide(x, z, r) {
    for (let pass = 0; pass < 2; pass++) {
      for (const o of this.shapes) {
        if (o.c) {
          const dx = x - o.x, dz = z - o.z, d = Math.hypot(dx, dz), min = o.r + r;
          if (d >= min) continue;
          if (d > 1e-5) { x = o.x + dx / d * min; z = o.z + dz / d * min; } else x = o.x + min;
        } else {
          if (Math.abs(x - o.x) > o.hw + r || Math.abs(z - o.z) > o.hd + r) continue;
          const qx = Math.max(o.x - o.hw, Math.min(x, o.x + o.hw)), qz = Math.max(o.z - o.hd, Math.min(z, o.z + o.hd));
          const ox = x - qx, oz = z - qz, d = Math.hypot(ox, oz);
          if (d >= r) continue;
          if (d > 1e-5) { x += ox / d * (r - d); z += oz / d * (r - d); }
          else {   // centre inside the box: leave by the nearest side
            const ex = [o.x - o.hw - r - x, o.x + o.hw + r - x], ez = [o.z - o.hd - r - z, o.z + o.hd + r - z];
            const bx = Math.abs(ex[0]) < Math.abs(ex[1]) ? ex[0] : ex[1], bz = Math.abs(ez[0]) < Math.abs(ez[1]) ? ez[0] : ez[1];
            if (Math.abs(bx) < Math.abs(bz)) x += bx; else z += bz;
          }
        }
      }
    }
    const lx = MAP_W / 2 - CELL - r, lz = MAP_H / 2 - CELL - r;   // the border cells are solid
    return [Math.max(-lx, Math.min(lx, x)), Math.max(-lz, Math.min(lz, z))];
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
  // grass colour at a point (shared by the flat ground and the hill meshes, so they meet without a seam)
  groundColor(x, z, y, col) {
    const hsh = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453, rn = hsh - Math.floor(hsh);
    const n = Math.sin(x * 0.35) * Math.cos(z * 0.3) * 0.5 + Math.sin(x * 1.3 + z * 0.9) * 0.25 + rn * 0.25;
    const edge = Math.max(Math.abs(x) - MAP_W / 2, Math.abs(z) - MAP_H / 2, 0);
    col.setHSL(0.27 + n * 0.02, 0.5 - Math.min(edge, 8) * 0.03, 0.42 + n * 0.05 - Math.min(edge, 8) * 0.02);
    if (y > 0.01) {
      const q = 0.35, g = Math.max(Math.abs(this.height(x + q, z) - this.height(x - q, z)), Math.abs(this.height(x, z + q) - this.height(x, z - q))) / (2 * q);
      col.offsetHSL(0, 0, Math.min(0.05, y * 0.025));                    // sunlit tops a touch lighter
      col.lerp(ROCK, smooth01((g - 1.1) / 1.4) * 0.85);                  // bare rock only on the really steep faces
      col.offsetHSL(0, 0, -smooth01((g - 0.4) / 0.9) * 0.04);            // slopes a shade darker
    }
    return col;
  }
  buildGround() {
    const hilly = this.hills.length > 0;
    const geo = new THREE.PlaneGeometry(MAP_W + 30, MAP_H + 30, 70, 86);
    geo.rotateX(-Math.PI / 2);
    const col = new THREE.Color(), cols = [], pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) { this.groundColor(pos.getX(i), pos.getZ(i), 0, col); cols.push(col.r, col.g, col.b); }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
    const gmat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: this.grad });
    const ground = new THREE.Mesh(geo, gmat);
    ground.receiveShadow = true; ground.name = "ground";
    this.group.add(ground); this.ground = ground;
    // each hill: its own fine mesh (0.25 m) laid over the flat ground - crisp cliff edges, and the rest stays light
    for (const h of this.hills) this.group.add(this.hillMesh(h, gmat));
    // dirt road through the village (not where hills would cut it into jagged pieces)
    const road = new THREE.Mesh(new THREE.PlaneGeometry(3.2, MAP_H + 30), new THREE.MeshToonMaterial({ color: 0xb59a6a, gradientMap: this.grad })); road.visible = !hilly;
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

  // campaign battlefields (the skirmish always uses the village)
  //  forest: thick woods, few clear shots · river: water across the middle, two bridges (a narrow crossing)
  //  open: open fields (archers' ground) · graveyard: rows of graves, dusk · ruins: broken walls for cover
  buildTerrain(kind) {
    const r = this.rand, zMin = -MAP_H / 2 + 9, zMax = MAP_H / 2 - 9;
    this.houses = [];
    const trees = (clusters, size) => {
      for (let c = 0; c < clusters; c++) {
        const cx = (r() - 0.5) * (MAP_W - 6), cz = zMin + r() * (zMax - zMin);
        const n = 2 + Math.floor(r() * size);
        for (let i = 0; i < n; i++) {
          const x = cx + (r() - 0.5) * 6, z = cz + (r() - 0.5) * 6;
          if (this.areaFree(x - 0.4, z - 0.4, x + 0.4, z + 0.4)) this.addTree(x, z);
        }
      }
    };
    const rocks = (n) => { for (let i = 0; i < n; i++) { const x = (r() - 0.5) * (MAP_W - 4), z = (r() - 0.5) * (MAP_H - 20); if (this.areaFree(x - 0.4, z - 0.4, x + 0.4, z + 0.4)) this.addRock(x, z); } };
    if (kind === "forest") { trees(22, 7); rocks(6); }
    else if (kind === "hills") { trees(6, 3); rocks(8); }
    else if (kind === "open") { trees(2, 2); rocks(5); }
    else if (kind === "river") {
      const b1 = -12 + r() * 8, b2 = 4 + r() * 8;   // two bridges
      const water = new THREE.Mesh(new THREE.PlaneGeometry(MAP_W + 30, 3.4), new THREE.MeshToonMaterial({ color: 0x3f86b8, gradientMap: this.grad }));
      water.rotation.x = -Math.PI / 2; water.position.set(0, 0.02, 0); this.group.add(water);
      for (const bx of [b1, b2]) {
        const deck = new THREE.Mesh(new THREE.BoxGeometry(3, 0.12, 4.2), this.mat(0x8b5a2b)); deck.position.set(bx, 0.07, 0); deck.receiveShadow = true; this.group.add(deck);
        for (const s of [-1, 1]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.45, 4.2), this.mat(0x6b4426)); rail.position.set(bx + s * 1.5, 0.3, 0); rail.castShadow = this.q.shadows; this.group.add(rail); }
      }
      for (let cx = 1; cx < GW - 1; cx++) {
        const [x] = this.cellCenter(cx, 0);
        if (Math.abs(x - b1) < 1.4 || Math.abs(x - b2) < 1.4) continue;
        for (const z of [-1.2, -0.3, 0.6, 1.4]) { const [, cz] = this.toCell(x, z); this.set(cx, cz, WATER); }
      }
      // water stops bodies (not arrows): one long box per stretch between the bridges
      const lo = Math.min(b1, b2), hi = Math.max(b1, b2), edges = [[-MAP_W / 2, lo - 1.5], [lo + 1.5, hi - 1.5], [hi + 1.5, MAP_W / 2]];
      for (const [a, b] of edges) if (b > a) this.shapes.push({ x: (a + b) / 2, z: 0, hw: (b - a) / 2, hd: 1.6 });
      trees(8, 4); rocks(5);
    } else if (kind === "graveyard") {
      const m = this.mat(0x9a9aa2), dark = this.mat(0x6e6a64);
      for (let gx = -4; gx <= 4; gx++) for (let gz = -3; gz <= 3; gz++) {
        if (r() < 0.35) continue;
        const x = gx * 2.6 + (r() - 0.5) * 0.6, z = gz * 3.2 + (r() - 0.5) * 0.6;
        if (!this.areaFree(x - 0.3, z - 0.2, x + 0.3, z + 0.2)) continue;
        const stone = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7 + r() * 0.3, 0.16), r() < 0.5 ? m : dark);
        stone.position.set(x, 0.38, z); stone.rotation.y = (r() - 0.5) * 0.3; stone.castShadow = this.q.shadows; this.group.add(stone);
        this.markRect(x - 0.25, z - 0.05, x + 0.25, z + 0.05, FENCE);   // knee-high: stops bodies, not arrows
        this.shapes.push({ x, z, hw: 0.3, hd: 0.1 });
      }
      trees(4, 2); rocks(4);
    } else if (kind === "ruins") {
      for (let i = 0, tries = 0; i < 12 && tries < 300; tries++) {
        const horiz = r() < 0.5, len = 2 + Math.floor(r() * 4), x = (r() - 0.5) * (MAP_W - 10), z = zMin + 2 + r() * (zMax - zMin - 4);
        const w = horiz ? len : 0.6, d = horiz ? 0.6 : len;
        if (!this.areaFree(x - w / 2 - 1, z - d / 2 - 1, x + w / 2 + 1, z + d / 2 + 1)) continue;
        const h = 0.9 + r() * 1.0;
        const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h + 0.6, d), this.mat(0xb3aa98)); wall.position.set(x, (h + 0.6) / 2 - 0.6 + this.height(x, z), z);
        wall.castShadow = this.q.shadows; wall.receiveShadow = true; this.group.add(wall);
        this.markRect(x - w / 2 + 0.05, z - d / 2 + 0.05, x + w / 2 - 0.05, z + d / 2 - 0.05, BLOCK);
        this.shapes.push({ x, z, hw: w / 2 + 0.03, hd: d / 2 + 0.03 }); i++;
      }
      trees(5, 3); rocks(10);
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
    this.shapes.push({ x, z, hw: w / 2 + 0.03, hd: d / 2 + 0.03 });
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
    this.shapes.push(horiz ? { x: x + len / 2, z, hw: len / 2 + 0.07, hd: 0.07 } : { x, z: z + len / 2, hw: 0.07, hd: len / 2 + 0.07 });
  }
  addTree(x, z) {
    const g = new THREE.Group(); g.position.set(x, this.height(x, z) - 0.05, z);
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
    this.shapes.push({ c: true, x, z, r: 0.2 * s });   // the trunk (leaves are above head height)
  }
  addRock(x, z) {
    const s = 0.35 + this.rand() * 0.3;
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), this.mat(0x8d9099));
    m.position.set(x, s * 0.5 + this.height(x, z) - 0.05, z); m.scale.y = 0.6; m.rotation.y = this.rand() * 6;
    m.castShadow = this.q.shadows; m.receiveShadow = true; this.group.add(m);
    this.markRect(x - s * 0.5, z - s * 0.5, x + s * 0.5, z + s * 0.5, BLOCK);
    this.shapes.push({ c: true, x, z, r: s * 0.8 });
  }
}
