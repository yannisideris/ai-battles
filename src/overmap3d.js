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
    this.bayX = null;
    this.coast = (x) => this.coast0 + Math.sin(x * 0.35 + ph[0]) * 0.5 + Math.sin(x * 0.9 + ph[1]) * 0.2
      - (this.bayX == null ? 0 : 0.6 * Math.exp(-(((x - this.bayX) / 2.8) ** 2)));   // a gentle bay at the river mouth
    this.sandPh = [r() * 9, r() * 9, r() * 9];
    this.back = -BD / 2 + 2.2;
    // the river: a spring pond in the wood at the back, meanders through the river battles (left to right),
    // widening as it goes, and opens into a little estuary with sandbanks in a bay of the coast
    const riv = nodes.filter((n) => n.terrain === "river" && n.kind !== "camp" && n.kind !== "castle").sort((a, b) => a.x - b.x).map(S);
    const x0 = riv.length ? riv[0][0] - 2 + (r() - 0.5) * 2 : (r() - 0.5) * 20;
    const src = [x0, -BD / 2 + 1.4];
    const pts = [src, ...riv.map(([x, z]) => [x + (r() - 0.5) * 0.5, z + (r() - 0.5) * 0.4])];
    const lx = pts[pts.length - 1][0] + (r() - 0.5) * 4;
    this.bayX = lx; pts.push([lx, this.coast(lx) + 1.2]);
    const course = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, "centripetal").getSpacedPoints(260);
    // meanders: a sideways wave along the course, calm near the river battles (so it still passes their bridges)
    const near = (p) => Math.min(9, ...riv.map(([x, z]) => Math.hypot(p.x - x, p.z - z)));
    const mph = r() * 6, out = [];
    course.forEach((p, i) => {
      const q = course[Math.min(i + 1, course.length - 1)], o = course[Math.max(i - 1, 0)], dx = q.x - o.x, dz = q.z - o.z, d = Math.hypot(dx, dz) || 1;
      const t = i / (course.length - 1), calm = smooth((near(p) - 0.6) / 2) * smooth(t / 0.08) * smooth((1 - t) / 0.12);
      const a = Math.sin(t * 26 + mph) * 0.55 * calm + Math.sin(t * 61 + mph * 2) * 0.15 * calm;
      out.push(new THREE.Vector3(p.x - (dz / d) * a, 0, p.z + (dx / d) * a));
    });
    this.river = new THREE.CatmullRomCurve3(out, false, "centripetal").getSpacedPoints(240);
    this.src = src;
    // sandbanks in the mouth (a small delta)
    const m = this.river[this.river.length - 1], m2 = this.river[this.river.length - 12];
    const ax = m.x - m2.x, az = m.z - m2.z, al = Math.hypot(ax, az) || 1;
    this.banks = [];
    const R = this.river, ci = Math.max(1, R.findIndex((p) => p.z > this.coast(p.x) + 0.15));   // where the river meets the sea
    const c0 = R[ci], c1 = R[Math.min(R.length - 1, ci + 6)], cl = Math.hypot(c1.x - c0.x, c1.z - c0.z) || 1;
    this.islet = [c0.x - ((c1.x - c0.x) / cl) * 0.35, c0.z - ((c1.z - c0.z) / cl) * 0.35];   // just inside the mouth, mid-channel
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
    const sand = new THREE.Color(0xe3d29a), grass = new THREE.Color(0x8fbf5c), dry = new THREE.Color(0xb9c27a), rock = new THREE.Color(0x8f7458);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), y = this.height(x, z); pos.setY(i, y);
      const n = Math.sin(x * 0.7) * Math.cos(z * 0.9) * 0.5 + Math.sin(x * 2.1 + z * 1.7) * 0.5;
      col.copy(grass).lerp(dry, 0.3 + n * 0.25);
      const dc = this.coast(x) - z, [rd, rt] = this.riverInfo(x, z), rw = this.riverWidth(rt);
      if (dc < 0.66) col.lerp(sand, smooth((0.66 - dc) / 0.06));   // the beach: even width, a clean edge to the grass
      if (rd < rw + 0.35) col.lerp(sand, smooth((rw + 0.35 - rd) / 0.25) * (0.35 + 0.4 * rt));
      if (this.banks.some(([bx, bz, br]) => Math.hypot(x - bx, z - bz) < br)) col.copy(sand);
      if (z < this.back + 1.5) col.lerp(grass, 0.4).offsetHSL(0, 0, -0.03);   // greener, darker woodland at the back
      cols.push(col.r, col.g, col.b);
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3)); geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: this.grad }));
    ground.receiveShadow = true; this.scene.add(ground);
    // the tiny sandy islet in the river mouth
    if (this.islet) {
      const [ix, iz] = this.islet;
      const isle = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), this.mat(0xe3d29a));
      isle.scale.set(1.25, 0.32, 0.85); isle.rotation.y = r() * 3; isle.position.set(ix, 0.08, iz); isle.receiveShadow = true; this.scene.add(isle);
      const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), this.mat(0x8fbf5c));
      tuft.scale.set(1.3, 0.6, 1); tuft.position.set(ix + 0.04, 0.135, iz - 0.02); this.scene.add(tuft);
    }
    // the board's earth sides (a diorama on the table)
    const base = new THREE.Mesh(new THREE.BoxGeometry(BW, 1.6, BD), this.mat(0x6b4f33)); base.position.y = -0.85; this.scene.add(base);
    // water: one sheet; the ground above it hides it except in the sea and the river bed
    const water = new THREE.Mesh(new THREE.PlaneGeometry(BW, BD), new THREE.MeshToonMaterial({ color: 0x4f97c4, gradientMap: this.grad }));
    water.rotation.x = -Math.PI / 2; water.position.y = 0.1; this.scene.add(water);

    // the river battles sit on a bridge: build those first, square across the river at the node; the roads end at
    // its two ends and the node is its middle
    this.nodeBridge = new Map(); this.bridges = [];
    for (const n of nodes) {
      if (n.terrain !== "river" || n.kind === "camp" || n.kind === "castle") continue;
      const [x, z] = S(n);
      let bi = 0, bd = 1e9; this.river.forEach((rp, k) => { const dd = (rp.x - x) ** 2 + (rp.z - z) ** 2; if (dd < bd) { bd = dd; bi = k; } });
      const sp = this.span(bi), surf = (px, pz) => Math.max(this.height(px, pz), 0.12) + 0.03;
      this.bridge(sp.a[0], sp.a[1], sp.b[0], sp.b[1], surf(...sp.a), surf(...sp.b), 0.24);
      this.nodeBridge.set(n.id, sp); this.bridges.push(sp.c);
    }
    // roads (walked: light; the ones you can take now: gold)
    for (const [a, b] of this.s.map.edges) {
      const A = this.byId.get(a), B = this.byId.get(b), walked = this.visited.has(a) && this.visited.has(b), live = a === this.s.pos && this.reach.has(b);
      this.road(A, B, walked ? 0xf0e0b4 : live ? 0xf1c40f : 0xb08a58, live ? 0.3 : 0.24, live ? 0.045 : 0.03);
    }
    // trees: forests round the forest battles + a few woods in the empty land (instanced: cheap)
    const trees = [];
    const wood = (x, z, rad, k) => { for (let i = 0; i < k; i++) { const a = r() * 6.283, d = Math.sqrt(r()) * rad; const tx = x + Math.cos(a) * d * 1.3, tz = z + Math.sin(a) * d * 0.8; if (this.okSpot(tx, tz, 0.55)) trees.push([tx, tz, 0.75 + r() * 0.5]); } };
    for (const n of nodes) {
      const [x, z] = S(n);
      if (n.terrain === "forest" && n.kind !== "castle" && n.kind !== "camp") wood(x, z, 2.2, 34);
      else if (n.kind !== "castle") wood(x, z, 2.4, n.terrain === "open" ? 1 : 4);
    }
    for (let x = -BW / 2 + 0.6; x < BW / 2 - 0.4; x += 0.55) for (let k = 0; k < 2; k++) {   // the wood along the back edge
      const tx = x + (r() - 0.5) * 0.5, tz = -BD / 2 + 0.5 + r() * 1.6;
      if (!this.nearNode(tx, tz, 1.4) && !this.onRoad(tx, tz, 0.35) && this.riverDist(tx, tz) > 0.55 && Math.hypot(tx - this.src[0], tz - this.src[1]) > 1.1) trees.push([tx, tz, 0.8 + r() * 0.5]);
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
    }
  }
  nodePos(n) { const b = this.nodeBridge?.get(n.id); return b ? b.c : S(n); }
  // a bridge square across the river at river point bi, as long as the river is wide there
  span(bi) {
    const R = this.river, rp = R[bi], r0 = R[Math.max(0, bi - 2)], r1 = R[Math.min(R.length - 1, bi + 2)];
    const fx = r1.x - r0.x, fz = r1.z - r0.z, fl = Math.hypot(fx, fz) || 1, half = this.riverWidth(bi / (R.length - 1)) * 0.95 + 0.12;
    return { c: [rp.x, rp.z], a: [rp.x - (fz / fl) * half, rp.z + (fx / fl) * half], b: [rp.x + (fz / fl) * half, rp.z - (fx / fl) * half] };
  }
  nearNode(x, z, d) { return this.nodes.some((n) => { const [a, b] = S(n); return Math.hypot(a - x, b - z) < d; }); }
  onRoad(x, z, d) { return (this.roadPts || []).some((p) => (p.x - x) ** 2 + (p.y - z) ** 2 < d * d); }
  okSpot(x, z, clear) { return !this.onRoad(x, z, 0.55) && z < this.coast(x) - 0.6 && this.riverDist(x, z) > 0.55 && Math.hypot(x - this.src[0], z - this.src[1]) > 1.1 && !this.nearNode(x, z, clear) && Math.abs(x) < BW / 2 - 0.5 && z > -BD / 2 + 0.5; }
  riverInfo(x, z) {
    let d = 1e9, bi = 0; const R = this.river;
    for (let i = 0; i < R.length; i += 3) { const e = (R[i].x - x) ** 2 + (R[i].z - z) ** 2; if (e < d) { d = e; bi = i; } }
    for (let i = Math.max(0, bi - 3); i <= Math.min(R.length - 1, bi + 3); i++) { const e = (R[i].x - x) ** 2 + (R[i].z - z) ** 2; if (e < d) { d = e; bi = i; } }
    return [Math.sqrt(d), bi / (R.length - 1)];
  }
  riverWidth(t) { return 0.16 + 0.26 * t + 0.75 * smooth((t - 0.86) / 0.14); }   // thin at the spring, wide at the mouth
  riverDist(x, z) { const [d, t] = this.riverInfo(x, z); return d - this.riverWidth(t) + 0.3; }   // (~0 at the bank)
  height(x, z) {
    let y = 0.3 + Math.sin(x * 0.5) * Math.cos(z * 0.6) * 0.05;
    for (const [bx, bz, br, bh] of this.bumps) { const d = Math.hypot((x - bx) / br, (z - bz) / (br * 0.75)); if (d < 1.6) y += bh * Math.exp(-d * d * 1.6); }
    if (z < this.back + 1.5) y += smooth((this.back + 1.5 - z) / 2.5) * (0.35 + 0.2 * Math.sin(x * 0.6));   // gently rolling up at the back
    const [rd, rt] = this.riverInfo(x, z), rw = this.riverWidth(rt);
    if (rd < rw + 0.3) y = Math.min(y, 0.02 + (y - 0.02) * smooth((rd - rw * 0.55) / (rw * 0.45 + 0.3)));    // river bed
    const sd = Math.hypot(x - this.src[0], z - this.src[1]); if (sd < 0.95) y = Math.min(y, 0.02 + (y - 0.02) * smooth((sd - 0.45) / 0.5));   // the spring pond
    for (const [bx, bz, br] of this.banks) { const d = Math.hypot(x - bx, z - bz) / br; if (d < 1) y = Math.max(y, 0.16 * (1 - d * d)); }   // sandbanks
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
  // a little wooden bridge: planks on a gentle arch, posts and a handrail on both sides
  // a simple wooden bridge: one plank deck from (ax, az) to (bx, bz), lying along the road, its ends at the road's height
  bridge(ax, az, bx, bz, h0, h1, w) {
    const len = Math.hypot(bx - ax, bz - az);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(w + 0.08, 0.06, len), this.mat(0x8b5a2b));
    deck.position.set((ax + bx) / 2, (h0 + h1) / 2 + 0.02, (az + bz) / 2);
    deck.rotation.order = "YXZ"; deck.rotation.y = Math.atan2(bx - ax, bz - az); deck.rotation.x = -Math.atan2(h1 - h0, len);
    deck.castShadow = true; deck.receiveShadow = true; this.scene.add(deck);
  }



  castle(x, z) {
    const g = new THREE.Group(), stone = this.mat(0xa9a296);
    const keep = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 1.0), stone); keep.position.y = 0.4; g.add(keep);
    for (const [tx, tz] of [[-0.75, -0.55], [0.75, -0.55], [-0.75, 0.55], [0.75, 0.55]]) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 1.25, 8), stone); t.position.set(tx, 0.62, tz); g.add(t);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.4, 8), this.mat(0x84443a)); cap.position.set(tx, 1.45, tz); g.add(cap);   // red roofs, a touch duller than brick
    }
    const flag = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.02), this.mat(0xc0392b)); flag.position.set(-0.6, 1.85, -0.55); g.add(flag);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.5), this.mat(0x3a3630)); pole.position.set(-0.75, 1.7, -0.55); g.add(pole);
    g.traverse((o) => { o.castShadow = true; }); this.put(g, x, z - 0.4);
  }
  road(A, B, color, w, lift) {
    const end = (N, other) => {   // where the road meets node N: its bridge end on the road's side, or the node itself
      const b = this.nodeBridge.get(N.id); if (!b) return S(N);
      const [ox, oz] = this.nodePos(other);
      return Math.hypot(b.a[0] - ox, b.a[1] - oz) < Math.hypot(b.b[0] - ox, b.b[1] - oz) ? b.a : b.b;
    };
    const [x1, z1] = end(A, B), [x2, z2] = end(B, A), mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
    const k = ((A.id * 7 + B.id * 13) % 11) / 11 - 0.5, nx = -(z2 - z1), nz = x2 - x1, l = Math.hypot(nx, nz) || 1;
    const curve = new THREE.QuadraticBezierCurve(new THREE.Vector2(x1, z1), new THREE.Vector2(mx + (nx / l) * k * 2.2, mz + (nz / l) * k * 2.2), new THREE.Vector2(x2, z2));
    const pts = curve.getSpacedPoints(30), verts = [], idx = [];
    (this.roadPts ??= []).push(...pts);
    const surf = (x, z) => Math.max(this.height(x, z), 0.12) + lift;   // the road's surface height
    // the road is not laid on the water: it stops at the banks, where the bridge takes over
    const wet = pts.map((pt) => { const [rd, rt] = this.riverInfo(pt.x, pt.y); return rd < this.riverWidth(rt) * 0.9; });
    pts.forEach((p, i) => {
      const q = pts[Math.min(i + 1, pts.length - 1)], o = pts[Math.max(i - 1, 0)], dx = q.x - o.x, dz = q.y - o.y, d = Math.hypot(dx, dz) || 1;
      const sx = (-dz / d) * w / 2, sz = (dx / d) * w / 2;
      for (const sgn of [-1, 1]) { const x = p.x + sx * sgn, z = p.y + sz * sgn; verts.push(x, surf(x, z), z); }
      if (i && !wet[i] && !wet[i - 1]) { const b = (i - 1) * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    });
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, this.mat(color)); m.receiveShadow = true; this.scene.add(m);
    // the pawn walks the road plus the bridge to the node's middle where there is one
    const walk = new THREE.CurvePath(), PA = this.nodePos(A), PB = this.nodePos(B), V = (q) => new THREE.Vector2(q[0], q[1]);
    if (PA[0] !== x1 || PA[1] !== z1) walk.add(new THREE.LineCurve(V(PA), new THREE.Vector2(x1, z1)));
    walk.add(curve);
    if (PB[0] !== x2 || PB[1] !== z2) walk.add(new THREE.LineCurve(new THREE.Vector2(x2, z2), V(PB)));
    (this.roads ??= new Map()).set(`${A.id}-${B.id}`, walk);
    // one straight bridge per crossing, square across the river and only as long as the river is wide
    for (let i = 0; i < pts.length; i++) {
      if (!wet[i] || (i && wet[i - 1])) continue;
      let e = i; while (e + 1 < pts.length && wet[e + 1]) e++;
      const mid = pts[(i + e) >> 1];
      let bi = 0, bd = 1e9; this.river.forEach((rp, k) => { const dd = (rp.x - mid.x) ** 2 + (rp.z - mid.y) ** 2; if (dd < bd) { bd = dd; bi = k; } });
      const sp = this.span(bi); if (this.bridges.some(([bx, bz]) => Math.hypot(bx - sp.c[0], bz - sp.c[1]) < 1.1)) continue;
      this.bridges.push(sp.c);
      this.bridge(sp.a[0], sp.a[1], sp.b[0], sp.b[1], surf(...sp.a), surf(...sp.b), w);
    }
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
    const [x, z] = this.nodePos(this.byId.get(this.s.pos));
    this.pawn = scene; this.pawnAt(x, z); scene.rotation.y = Math.PI / 2; this.scene.add(scene);
  }
  pawnAt(x, z) { this.pawn.position.set(x, Math.max(this.height(x, z), this.onBridgeY(x, z)), z); }
  onBridgeY(x, z) { return (this.bridges || []).some(([bx, bz]) => Math.hypot(bx - x, bz - z) < 0.75) ? 0.3 : 0; }
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
    const [x, z] = this.nodePos(n), v = new THREE.Vector3(x, Math.max(this.height(x, z), 0.12) + 0.15, z).project(this.camera);
    return [(v.x + 1) / 2 * this.canvas.clientWidth, (1 - v.y) / 2 * this.canvas.clientHeight];
  }
  dispose() {
    if (this.disposed) return; this.disposed = true; cancelAnimationFrame(this.raf);
    this.scene.traverse((o) => { o.geometry?.dispose?.(); });
    this.renderer.dispose(); this.renderer.forceContextLoss?.();
  }
}
