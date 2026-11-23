// The painted campaign overmap: land, winding dirt roads between the nodes, and around each node the look of its
// battlefield (forest, village, river, graveyard, ruins, open field; tents at your camp, the castle at the end).
// Every campaign gets a new random map; the drawing is seeded from it, so the same campaign always looks the same.
export function drawMap(cv, s, reachable, rng) {
  if (!cv) return;
  const W = cv.clientWidth, H = cv.clientHeight, dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  const c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const r = rng((s.seed ^ 0x5eed) >>> 0), nodes = s.map.cols.flat(), byId = new Map(nodes.map((n) => [n.id, n]));
  const P = (n) => [(n.x / 100) * W, (n.y / 100) * H], U = Math.min(W / 100, H / 50);   // U: one map "unit" in px
  const visited = new Set(s.visited), open = new Set(reachable.map((n) => n.id));

  // land: grass with lighter / darker patches, darker edges
  c.fillStyle = "#6f9a4e"; c.fillRect(0, 0, W, H);
  for (let i = 0; i < 70; i++) {
    c.fillStyle = r() < 0.5 ? "rgba(140,180,90,0.22)" : "rgba(50,85,40,0.2)";
    c.beginPath(); c.ellipse(r() * W, r() * H, (4 + r() * 10) * U, (2 + r() * 6) * U, r() * 3, 0, 7); c.fill();
  }
  const vg = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
  vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(20,30,10,0.55)"); c.fillStyle = vg; c.fillRect(0, 0, W, H);

  // the ground under each battlefield
  const ground = { forest: "rgba(30,70,30,0.6)", village: "rgba(180,160,95,0.5)", open: "rgba(200,205,110,0.5)", river: "rgba(90,140,80,0.4)",
    graveyard: "rgba(75,65,90,0.6)", ruins: "rgba(135,128,112,0.55)" };
  for (const n of nodes) {
    const [x, y] = P(n), g = n.kind === "castle" ? "rgba(110,105,100,0.6)" : n.kind === "camp" ? "rgba(180,160,95,0.45)" : ground[n.terrain];
    const gr = c.createRadialGradient(x, y, 0, x, y, 9 * U); gr.addColorStop(0, g); gr.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = gr; c.beginPath(); c.arc(x, y, 9 * U, 0, 7); c.fill();
  }
  // rivers run through their node
  for (const n of nodes.filter((n) => n.terrain === "river" && n.kind !== "castle" && n.kind !== "camp")) {
    const [x, y] = P(n), tilt = (r() - 0.5) * 6 * U;
    c.lineCap = "round"; c.beginPath();
    c.moveTo(x - tilt - 2 * U, y - 15 * U); c.bezierCurveTo(x + 5 * U, y - 6 * U, x - 5 * U, y + 5 * U, x + tilt, y + 15 * U);
    c.strokeStyle = "#3f7fb5"; c.lineWidth = 2.6 * U; c.stroke();
    c.strokeStyle = "rgba(170,215,240,0.6)"; c.lineWidth = 0.6 * U; c.stroke();
  }
  // roads: winding dirt tracks; the ones you walked are worn light, the ones you can take now are marked in gold
  const road = (a, b, st) => {
    const [x1, y1] = P(a), [x2, y2] = P(b), mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const k = ((a.id * 7 + b.id * 13) % 11) / 11 - 0.5, nx = -(y2 - y1), ny = x2 - x1, l = Math.hypot(nx, ny) || 1;
    const cx = mx + (nx / l) * k * 7 * U, cy = my + (ny / l) * k * 7 * U;
    c.beginPath(); c.moveTo(x1, y1); c.quadraticCurveTo(cx, cy, x2, y2);
    c.lineCap = "round"; c.setLineDash(st.dash || []);
    if (st.edge) { c.strokeStyle = st.edge; c.lineWidth = st.w + 1.5; c.stroke(); }
    c.strokeStyle = st.fill; c.lineWidth = st.w; c.stroke();
    c.setLineDash([]);
  };
  for (const [a, b] of s.map.edges) {
    const A = byId.get(a), B = byId.get(b), walked = visited.has(a) && visited.has(b);
    road(A, B, walked ? { edge: "#4a3520", fill: "#ecd9a8", w: 1.4 * U } : { edge: "rgba(70,50,30,0.7)", fill: "#b99a68", w: 1.1 * U });
  }
  for (const [a, b] of s.map.edges) if (a === s.pos && open.has(b)) road(byId.get(a), byId.get(b), { fill: "#f1c40f", w: 0.45 * U, dash: [1.2 * U, 1.1 * U] });

  // filler: little woods and rocks where nothing else is (a map, not a diagram)
  const nearNode = (x, y, d) => nodes.some((n) => { const [a, b] = P(n); return Math.hypot(a - x, b - y) < d; });
  for (let i = 0; i < 55; i++) {
    const x = r() * W, y = r() * H; if (nearNode(x, y, 11 * U)) continue;
    if (r() < 0.75) tree(c, x, y, (0.9 + r() * 0.6) * U, r); else rock(c, x, y, (0.7 + r() * 0.6) * U);
  }
  // each battlefield's own look, drawn back to front
  const items = [];
  for (const n of nodes) {
    const [x, y] = P(n), spot = (rad) => { const a = r() * 6.283, d = (3.5 + r() * rad) * U; return [x + Math.cos(a) * d, y + Math.sin(a) * d * 0.7]; };
    const add = (fn, n2 = 1, rad = 4) => { for (let i = 0; i < n2; i++) { const [a, b] = spot(rad); items.push([b, () => fn(a, b)]); } };
    if (n.kind === "castle") { items.push([y + 99, () => castle(c, x, y - 2 * U, 3.2 * U)]); continue; }
    if (n.kind === "camp") { add((a, b) => tent(c, a, b, 1.5 * U), 3, 3); continue; }
    const k = n.terrain;
    if (k === "forest") add((a, b) => tree(c, a, b, (1.1 + r() * 0.7) * U, r), 16, 5);
    else if (k === "village") add((a, b) => house(c, a, b, (1.3 + r() * 0.5) * U, r), 6, 4);
    else if (k === "graveyard") { add((a, b) => tomb(c, a, b, 0.9 * U), 9, 4); add((a, b) => deadTree(c, a, b, 2 * U), 2, 4); }
    else if (k === "ruins") add((a, b) => wall(c, a, b, (1.3 + r()) * U, r), 6, 4);
    else if (k === "open") add((a, b) => tuft(c, a, b, 0.9 * U), 14, 5);
    else if (k === "river") { add((a, b) => tree(c, a, b, (1 + r() * 0.5) * U, r), 5, 5); items.push([y, () => bridge(c, x, y, 1.5 * U)]); }
  }
  items.sort((p, q) => p[0] - q[0]).forEach(([, f]) => f());
}

function tree(c, x, y, s, r) {
  c.fillStyle = "rgba(0,0,0,0.25)"; c.beginPath(); c.ellipse(x + s * 0.4, y + s * 0.5, s, s * 0.5, 0, 0, 7); c.fill();
  c.fillStyle = "#5a3d22"; c.fillRect(x - s * 0.15, y - s * 0.2, s * 0.3, s * 0.7);
  c.fillStyle = r() < 0.5 ? "#2f6b2a" : "#3c7d33"; c.strokeStyle = "#1c3d18"; c.lineWidth = Math.max(1, s * 0.12);
  c.beginPath(); c.arc(x, y - s * 0.6, s, 0, 7); c.fill(); c.stroke();
  c.fillStyle = "rgba(160,210,120,0.35)"; c.beginPath(); c.arc(x - s * 0.3, y - s * 0.9, s * 0.4, 0, 7); c.fill();
}
function deadTree(c, x, y, s) {
  c.strokeStyle = "#2b2230"; c.lineWidth = Math.max(1, s * 0.16); c.lineCap = "round"; c.beginPath();
  c.moveTo(x, y); c.lineTo(x, y - s); c.moveTo(x, y - s * 0.6); c.lineTo(x - s * 0.5, y - s * 1.1); c.moveTo(x, y - s * 0.8); c.lineTo(x + s * 0.45, y - s * 1.2); c.stroke();
}
function rock(c, x, y, s) { c.fillStyle = "#8a8a80"; c.strokeStyle = "#3d3d38"; c.lineWidth = 1; c.beginPath(); c.ellipse(x, y, s, s * 0.65, 0.3, 0, 7); c.fill(); c.stroke(); }
function house(c, x, y, s, r) {
  c.fillStyle = "rgba(0,0,0,0.25)"; c.fillRect(x - s * 0.5, y + s * 0.5, s * 1.4, s * 0.25);
  c.fillStyle = "#d9c7a0"; c.strokeStyle = "#3b2a1a"; c.lineWidth = 1;
  c.fillRect(x - s * 0.6, y - s * 0.3, s * 1.2, s * 0.8); c.strokeRect(x - s * 0.6, y - s * 0.3, s * 1.2, s * 0.8);
  c.fillStyle = r() < 0.5 ? "#a8452f" : "#8a5a2b";
  c.beginPath(); c.moveTo(x - s * 0.8, y - s * 0.3); c.lineTo(x, y - s); c.lineTo(x + s * 0.8, y - s * 0.3); c.closePath(); c.fill(); c.stroke();
}
function tomb(c, x, y, s) {
  c.fillStyle = "#b9b4be"; c.strokeStyle = "#2b2730"; c.lineWidth = 1;
  c.beginPath(); c.moveTo(x - s * 0.4, y + s * 0.4); c.lineTo(x - s * 0.4, y - s * 0.3); c.arc(x, y - s * 0.3, s * 0.4, Math.PI, 0); c.lineTo(x + s * 0.4, y + s * 0.4); c.closePath(); c.fill(); c.stroke();
}
function wall(c, x, y, s, r) {
  c.fillStyle = "#9c968a"; c.strokeStyle = "#45413a"; c.lineWidth = 1;
  const h = s * (0.4 + r() * 0.6); c.fillRect(x - s * 0.7, y - h, s * 1.4, h); c.strokeRect(x - s * 0.7, y - h, s * 1.4, h);
  c.beginPath(); c.moveTo(x - s * 0.7, y - h * 0.5); c.lineTo(x + s * 0.7, y - h * 0.5); c.stroke();
  rock(c, x + s, y + s * 0.2, s * 0.25);
}
function tuft(c, x, y, s) {
  c.strokeStyle = "#d6cf72"; c.lineWidth = 1; c.beginPath();
  for (const d of [-0.4, 0, 0.4]) { c.moveTo(x + d * s, y); c.lineTo(x + d * s * 1.8, y - s); }
  c.stroke();
}
function tent(c, x, y, s) {
  c.fillStyle = "#e8dcc0"; c.strokeStyle = "#4a3a24"; c.lineWidth = 1;
  c.beginPath(); c.moveTo(x - s, y + s * 0.4); c.lineTo(x, y - s * 0.8); c.lineTo(x + s, y + s * 0.4); c.closePath(); c.fill(); c.stroke();
  c.beginPath(); c.moveTo(x, y - s * 0.8); c.lineTo(x, y + s * 0.4); c.stroke();
}
function bridge(c, x, y, s) {
  c.fillStyle = "#8a6238"; c.strokeStyle = "#3b2a1a"; c.lineWidth = 1;
  c.fillRect(x - s * 1.3, y - s * 0.45, s * 2.6, s * 0.9); c.strokeRect(x - s * 1.3, y - s * 0.45, s * 2.6, s * 0.9);
}
function castle(c, x, y, s) {
  c.fillStyle = "rgba(0,0,0,0.3)"; c.fillRect(x - s * 1.4, y + s * 0.9, s * 3, s * 0.4);
  c.fillStyle = "#9b958c"; c.strokeStyle = "#3a3630"; c.lineWidth = 1.2;
  const block = (bx, by, w, h) => {
    c.fillRect(bx, by, w, h); c.strokeRect(bx, by, w, h);
    const cw = w / 5; for (let i = 0; i < 3; i++) { c.fillRect(bx + i * 2 * cw, by - cw, cw, cw); c.strokeRect(bx + i * 2 * cw, by - cw, cw, cw); }
  };
  block(x - s * 1.1, y - s * 0.2, s * 2.2, s * 1.1);
  block(x - s * 1.5, y - s * 0.9, s * 0.7, s * 1.8); block(x + s * 0.8, y - s * 0.9, s * 0.7, s * 1.8);
  c.fillStyle = "#3a2a20"; c.beginPath(); c.arc(x, y + s * 0.9, s * 0.35, Math.PI, 0); c.fill();
  c.strokeStyle = "#3a3630"; c.beginPath(); c.moveTo(x - s * 1.15, y - s * 1.1); c.lineTo(x - s * 1.15, y - s * 1.7); c.stroke();
  c.fillStyle = "#c0392b"; c.beginPath(); c.moveTo(x - s * 1.15, y - s * 1.7); c.lineTo(x - s * 0.6, y - s * 1.55); c.lineTo(x - s * 1.15, y - s * 1.4); c.fill();
}
