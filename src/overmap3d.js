// The campaign overmap as a small 3D diorama in the battles' own low-poly toon look: a board with a coast and the
// sea along the front, mountains along the back, one river down to the sea, forests, villages, hills, the enemy
// castle, dirt roads between the nodes - and your leader as a little miniature that walks from node to node.
// Seeded from the campaign, so the same campaign always looks the same. Renders at ~30 fps only while visible.
import * as THREE from "three";
import { toonGradient } from "./world.js";
import { loadUnitModels, spawnModel } from "./assets.js";

const BW = 42, BD = 21;                                  // board size (world units)
const S = (n) => [(n.x - 50) * (BW / 100), (n.y - 50) * (BD / 100)];   // node -> board x, z
const smooth = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

export class MapDiorama {
  constructor(canvas, s, reachable, rng, quality, leaderType) {
    this.canvas = canvas; this.s = s; this.r = rng((s.seed ^ 0xd10) >>> 0);
    this.nodes = s.map.cols.flat(); this.byId = new Map(this.nodes.map((n) => [n.id, n]));
    this.reach = new Set(reachable.map((n) => n.id)); this.visited = new Set(s.visited);
    const w = canvas.clientWidth || 600, h = canvas.clientHeight || 300;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); this.renderer.setSize(w, h, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = quality.shadows; this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene = new THREE.Scene(); this.grad = toonGradient();
    this.camera = new THREE.PerspectiveCamera(30, w / h, 1, 200);
    this.camera.position.set(0, 36, 17); this.camera.lookAt(0, 0, 0.6);
    this.scene.add(new THREE.HemisphereLight(0xdff3ff, 0x5a6b3a, 1.5));
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.3); sun.position.set(-14, 26, 12); sun.castShadow = quality.shadows;
    sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 14, bottom: -14, near: 1, far: 80 }); sun.shadow.bias = -0.001;
    this.scene.add(sun);
    this.build();
    this.placePawn(leaderType, quality);
    this.last = performance.now();
    const loop = (now) => {
      if (!this.canvas.isConnected) { this.dispose(); return; }
      this.raf = requestAnimationFrame(loop);
      if (now - this.last < 33) return;
      const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
      this.update(dt); this.renderer.render(this.scene, this.camera); this.onFrame?.();
    };
    this.raf = requestAnimationFrame(loop);
  }
  mat(c) { return new THREE.MeshToonMaterial({ color: c, gradientMap: this.grad }); }

  // ---------------------------------------------------------------- the land
  build() {
    const r = this.r, nodes = this.nodes;
    const zs = nodes.map((n) => S(n)[1]);
    this.coast0 = Math.max(Math.max(...zs) + 1.7, BD / 2 - 3.4);
    const ph = [r() * 9, r() * 9, r() * 9];
    this.coast = (x) => this.coast0 + Math.sin(x * 0.35 + ph[0]) * 0.5 + Math.sin(x * 0.9 + ph[1]) * 0.2;
    this.back = -BD / 2 + 2.2;
    // the river: from the mountains, through the river battles (left to right), down to the sea
    const riv = nodes.filter((n) => n.terrain === "river" && n.kind !== "camp" && n.kind !== "castle").sort((a, b) => a.x - b.x).map(S);
    const x0 = riv.length ? riv[0][0] - 2.5 : (r() - 0.5) * 20;
    const pts = [[x0, this.back - 1], ...riv.map(([x, z]) => [x + (r() - 0.5) * 0.8, z + (r() - 0.5) * 0.6])];
    const lx = pts[pts.length - 1][0] + (r() - 0.5) * 4; pts.push([lx, this.coast(lx) + 1.5]);
    this.river = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, "catmullrom", 0.5).getSpacedPoints(160);
    // hills round the nodes that have them (the battle's high ground), a few more in the empty land
    this.bumps = [];
    for (const n of nodes) if (n.hills) {
      const [x, z] = S(n);
      for (let i = 0; i < n.hills + 1; i++) this.bumps.push([x + (r() - 0.5) * 3.2, z - 0.6 + (r() - 0.5) * 1.6, 0.9 + r() * 0.5, 0.45 + r() * 0.25]);
    }
    for (let i = 0; i < 10; i++) { const x = (r() - 0.5) * BW * 0.9, z = this.back + 2 + r() * 10; if (!this.nearNode(x, z, 2.6)) this.bumps.push([x, z, 1.2 + r(), 0.4 + r() * 0.4]); }

    // ground (with the sea floor and the river bed carved in)
    const geo = new THREE.PlaneGeometry(BW, BD, 168, 84); geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, cols = [], col = new THREE.Color();
    const sand = new THREE.Color(0xe3d29a), grass = new THREE.Color(0x8fbf5c), dry = new THREE.Color(0xb9c27a), rock = new THREE.Color(0x9a9282);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), y = this.height(x, z); pos.setY(i, y);
      const n = Math.sin(x * 0.7) * Math.cos(z * 0.9) * 0.5 + Math.sin(x * 2.1 + z * 1.7) * 0.5;
      col.copy(grass).lerp(dry, 0.3 + n * 0.25);
      const dc = this.coast(x) - z, dr = this.riverDist(x, z);
      if (dc < 0.9) col.lerp(sand, smooth((0.9 - dc) / 0.6));
      if (dr < 0.55) col.lerp(sand, smooth((0.55 - dr) / 0.3) * 0.6);
      if (y > 0.9) col.lerp(rock, smooth((y - 0.9) / 0.8));
      cols.push(col.r, col.g, col.b);
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3)); geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: this.grad }));
    ground.receiveShadow = true; this.scene.add(ground);
    // the board's earth sides (a diorama on the table)
    const base = new THREE.Mesh(new THREE.BoxGeometry(BW, 1.6, BD), this.mat(0x6b4f33)); base.position.y = -0.85; this.scene.add(base);
    // water: one sheet; the ground above it hides it except in the sea and the river bed
    const water = new THREE.Mesh(new THREE.PlaneGeometry(BW, BD), new THREE.MeshToonMaterial({ color: 0x4f97c4, gradientMap: this.grad, transparent: true, opacity: 0.92 }));
    water.rotation.x = -Math.PI / 2; water.position.y = 0.1; this.scene.add(water);

    // mountains along the back
    const peak = this.mat(0x9a9282), snow = this.mat(0xf4f2ea);
    for (let x = -BW / 2 + 0.8; x < BW / 2; x += 1.3 + r() * 1.4) {
      const z = this.back - 0.6 + (r() - 0.5) * 1.6, hgt = 1.6 + r() * 1.8, rad = 1.0 + r() * 0.7;
      if (this.nearNode(x, z, 2.2)) continue;
      const m = new THREE.Mesh(new THREE.ConeGeometry(rad, hgt, 5), peak); m.position.set(x, this.height(x, z) + hgt / 2 - 0.1, z); m.rotation.y = r() * 3;
      m.castShadow = true; this.scene.add(m);
      if (hgt > 2.5) { const c = new THREE.Mesh(new THREE.ConeGeometry(rad * 0.38, hgt * 0.38, 5), snow); c.position.set(x, m.position.y + hgt * 0.31, z); c.rotation.y = m.rotation.y; this.scene.add(c); }
    }
    // trees: forests round the forest battles + a few woods in the empty land (instanced: cheap)
    const trees = [];
    const wood = (x, z, rad, k) => { for (let i = 0; i < k; i++) { const a = r() * 6.283, d = Math.sqrt(r()) * rad; const tx = x + Math.cos(a) * d * 1.3, tz = z + Math.sin(a) * d * 0.8; if (this.okSpot(tx, tz, 0.55)) trees.push([tx, tz, 0.75 + r() * 0.5]); } };
    for (const n of nodes) {
      const [x, z] = S(n);
      if (n.terrain === "forest" && n.kind !== "castle" && n.kind !== "camp") wood(x, z, 2.2, 34);
      else if (n.kind !== "castle") wood(x, z, 2.4, n.terrain === "open" ? 1 : 4);
    }
    for (let i = 0; i < 7; i++) { const x = (r() - 0.5) * BW * 0.9, z = this.back + 1.5 + r() * (this.coast0 - this.back - 3); if (!this.nearNode(x, z, 3)) wood(x, z, 1.6 + r() * 1.4, 14); }
    this.addTrees(trees);
    // what each battle looks like
    for (const n of nodes) {
      const [x, z] = S(n), spot = (rad, lo = 0.9) => { for (let k = 0; k < 12; k++) { const a = r() * 6.283, d = lo + r() * rad, px = x + Math.cos(a) * d * 1.2, pz = z + Math.sin(a) * d * 0.8; if (this.okSpot(px, pz, 0.6)) return [px, pz]; } return null; };
      if (n.kind === "castle") { this.castle(x, z); continue; }
      if (n.kind === "camp") { for (let i = 0; i < 3; i++) { const p = spot(1.1); if (p) this.tent(...p); } continue; }
      if (n.terrain === "village") for (let i = 0; i < 5; i++) { const p = spot(1.4); if (p) this.house(...p); }
      if (n.terrain === "graveyard") for (let i = 0; i < 9; i++) { const p = spot(1.3); if (p) this.tomb(...p); }
      if (n.terrain === "ruins") for (let i = 0; i < 6; i++) { const p = spot(1.5); if (p) this.ruin(...p); }
      if (n.terrain === "river") this.bridge(x, z);
    }
    // roads (walked: light; the ones you can take now: gold)
    for (const [a, b] of this.s.map.edges) {
      const A = this.byId.get(a), B = this.byId.get(b), walked = this.visited.has(a) && this.visited.has(b), live = a === this.s.pos && this.reach.has(b);
      this.road(A, B, walked ? 0xf0e0b4 : live ? 0xf1c40f : 0xb08a58, live ? 0.3 : 0.24, live ? 0.045 : 0.03);
    }
  }
  nearNode(x, z, d) { return this.nodes.some((n) => { const [a, b] = S(n); return Math.hypot(a - x, b - z) < d; }); }
  okSpot(x, z, clear) { return z < this.coast(x) - 0.6 && this.riverDist(x, z) > 0.55 && !this.nearNode(x, z, clear) && Math.abs(x) < BW / 2 - 0.5 && z > -BD / 2 + 0.5; }
  riverDist(x, z) { let d = 1e9; for (const p of this.river) d = Math.min(d, (p.x - x) ** 2 + (p.z - z) ** 2); return Math.sqrt(d); }
  height(x, z) {
    let y = 0.3 + Math.sin(x * 0.5) * Math.cos(z * 0.6) * 0.05;
    for (const [bx, bz, br, bh] of this.bumps) { const d = Math.hypot((x - bx) / br, (z - bz) / (br * 0.75)); if (d < 1.6) y += bh * Math.exp(-d * d * 1.6); }
    if (z < this.back + 1.5) y += smooth((this.back + 1.5 - z) / 2.5) * 0.9;                          // rising to the mountains
    const dr = this.riverDist(x, z); if (dr < 0.5) y = Math.min(y, 0.02 + (y - 0.02) * smooth(dr / 0.5));   // river bed
    const dc = z - this.coast(x); if (dc > -0.3) y = Math.min(y, 0.3 - smooth((dc + 0.3) / 0.9) * 0.55);    // beach into the sea
    return y;
  }
  addTrees(list) {
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.07, 0.35, 5), this.mat(0x7a5230), list.length);
    const leaves = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.28, 0), new THREE.MeshToonMaterial({ gradientMap: this.grad }), list.length * 2);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    list.forEach(([x, z, s], i) => {
      const y = this.height(x, z);
      trunk.setMatrixAt(i, m.compose(new THREE.Vector3(x, y + 0.17 * s, z), q, new THREE.Vector3(s, s, s)));
      for (let k = 0; k < 2; k++) {
        q.setFromEuler(new THREE.Euler(this.r(), this.r(), this.r()));
        leaves.setMatrixAt(i * 2 + k, m.compose(new THREE.Vector3(x + (k - 0.5) * 0.06, y + (0.45 + k * 0.2) * s, z), q, new THREE.Vector3(s * (1 - k * 0.25), s * (1 - k * 0.25), s * (1 - k * 0.25))));
        leaves.setColorAt(i * 2 + k, c.setHSL(0.27 + this.r() * 0.06, 0.5, 0.3 + this.r() * 0.08));
        q.identity();
      }
    });
    trunk.castShadow = leaves.castShadow = true;
    this.scene.add(trunk, leaves);
  }
  put(mesh, x, z, dy = 0) { mesh.position.set(x, this.height(x, z) + dy, z); mesh.castShadow = true; mesh.receiveShadow = true; this.scene.add(mesh); return mesh; }
  house(x, z) {
    const g = new THREE.Group(), w = 0.42 + this.r() * 0.2;
    const walls = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, 0.34), this.mat(0xefe3c8)); walls.position.y = 0.15;
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 1, 1, 4, 1, false, Math.PI / 4), this.mat(this.r() < 0.5 ? 0xd9653b : 0xa0612f));
    roof.scale.set(w * 0.78, 0.26, 0.34 * 0.78); roof.position.y = 0.43;
    g.add(walls, roof); g.rotation.y = this.r() * 3; g.traverse((o) => { o.castShadow = true; });
    this.put(g, x, z);
  }
  tent(x, z) { const t = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.42, 4), this.mat(0xf0e6cc)); t.rotation.y = this.r(); this.put(t, x, z, 0.2); }
  tomb(x, z) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, 0.05), this.mat(this.r() < 0.5 ? 0x9a9aa2 : 0x6e6a64)); t.rotation.y = (this.r() - 0.5) * 0.6; this.put(t, x, z, 0.08); }
  ruin(x, z) { const h = 0.15 + this.r() * 0.25, t = new THREE.Mesh(new THREE.BoxGeometry(0.4 + this.r() * 0.4, h, 0.09), this.mat(0xb3aa98)); t.rotation.y = this.r() * 3; this.put(t, x, z, h / 2 - 0.02); }
  bridge(x, z) {
    // across the river where it passes this node (lying along the road direction is not needed at this scale)
    let best = this.river[0]; for (const p of this.river) if ((p.x - x) ** 2 + (p.z - z) ** 2 < (best.x - x) ** 2 + (best.z - z) ** 2) best = p;
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 1.2), this.mat(0x8b5a2b)); b.position.set(best.x, 0.3, best.z); b.castShadow = true; this.scene.add(b);
  }
  castle(x, z) {
    const g = new THREE.Group(), stone = this.mat(0xa9a296);
    const keep = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 1.0), stone); keep.position.y = 0.4; g.add(keep);
    for (const [tx, tz] of [[-0.75, -0.55], [0.75, -0.55], [-0.75, 0.55], [0.75, 0.55]]) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 1.25, 8), stone); t.position.set(tx, 0.62, tz); g.add(t);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.4, 8), this.mat(0x8a3a2a)); cap.position.set(tx, 1.45, tz); g.add(cap);
    }
    const flag = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.02), this.mat(0xc0392b)); flag.position.set(-0.6, 1.85, -0.55); g.add(flag);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.5), this.mat(0x3a3630)); pole.position.set(-0.75, 1.7, -0.55); g.add(pole);
    g.traverse((o) => { o.castShadow = true; }); this.put(g, x, z - 0.4);
  }
  road(A, B, color, w, lift) {
    const [x1, z1] = S(A), [x2, z2] = S(B), mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
    const k = ((A.id * 7 + B.id * 13) % 11) / 11 - 0.5, nx = -(z2 - z1), nz = x2 - x1, l = Math.hypot(nx, nz) || 1;
    const curve = new THREE.QuadraticBezierCurve(new THREE.Vector2(x1, z1), new THREE.Vector2(mx + (nx / l) * k * 2.2, mz + (nz / l) * k * 2.2), new THREE.Vector2(x2, z2));
    const pts = curve.getSpacedPoints(30), verts = [], idx = [];
    pts.forEach((p, i) => {
      const q = pts[Math.min(i + 1, pts.length - 1)], o = pts[Math.max(i - 1, 0)], dx = q.x - o.x, dz = q.y - o.y, d = Math.hypot(dx, dz) || 1;
      const sx = (-dz / d) * w / 2, sz = (dx / d) * w / 2;
      for (const sgn of [-1, 1]) { const x = p.x + sx * sgn, z = p.y + sz * sgn; verts.push(x, Math.max(this.height(x, z), 0.12) + lift, z); }
      if (i) { const b = (i - 1) * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    });
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, this.mat(color)); m.receiveShadow = true; this.scene.add(m);
    (this.roads ??= new Map()).set(`${A.id}-${B.id}`, curve);
  }

  // ---------------------------------------------------------------- the pawn: your leader, a little miniature
  async placePawn(type, quality) {
    const team = this.s.side;
    try { await loadUnitModels(quality, [[team, type]]); } catch { return; }
    if (this.disposed) return;
    const { scene, clips } = spawnModel(team, type);
    scene.scale.setScalar(2.1); scene.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.mixer = new THREE.AnimationMixer(scene); this.clips = clips;
    this.actions = Object.fromEntries(clips.map((c) => [c.name, this.mixer.clipAction(c)]));
    this.actions.idle?.play();
    const [x, z] = S(this.byId.get(this.s.pos));
    this.pawn = scene; this.pawnAt(x, z); scene.rotation.y = Math.PI / 2; this.scene.add(scene);
  }
  pawnAt(x, z) { this.pawn.position.set(x, this.height(x, z), z); }
  // walk along the road to a node, then call done
  moveTo(node, done) {
    const curve = this.roads?.get(`${this.s.pos}-${node.id}`);
    if (!this.pawn || !curve) { setTimeout(done, 300); return; }
    this.walk = { curve, t: 0, done };
    this.actions.idle?.fadeOut(0.15); this.actions.walk?.reset().fadeIn(0.15).play();
  }
  update(dt) {
    this.mixer?.update(dt);
    if (this.walk && this.pawn) {
      const w = this.walk; w.t = Math.min(1, w.t + dt / 1.6);
      const p = w.curve.getPointAt(w.t), q = w.curve.getPointAt(Math.min(1, w.t + 0.02));
      this.pawnAt(p.x, p.y); if (q.distanceTo(p) > 1e-4) this.pawn.rotation.y = Math.atan2(q.x - p.x, q.y - p.y);
      if (w.t >= 1) { this.walk = null; setTimeout(w.done, 250); }
    }
  }
  // where a node is on screen (for the HTML node buttons laid over the canvas)
  screenPos(n) {
    const [x, z] = S(n), v = new THREE.Vector3(x, this.height(x, z) + 0.15, z).project(this.camera);
    return [(v.x + 1) / 2 * this.canvas.clientWidth, (1 - v.y) / 2 * this.canvas.clientHeight];
  }
  dispose() {
    if (this.disposed) return; this.disposed = true; cancelAnimationFrame(this.raf);
    this.scene.traverse((o) => { o.geometry?.dispose?.(); });
    this.renderer.dispose(); this.renderer.forceContextLoss?.();
  }
}
