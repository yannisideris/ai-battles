// The campaign overmap, drawn like an old map: a coast and the sea along the bottom, a mountain range along the top,
// one river running from the mountains through the river battles down to the sea, forests as dark masses, fields
// round the villages, hills as the classic map symbol, winding roads between the nodes, a frame and a compass rose.
// Every campaign gets a new random map; the drawing is seeded from it, so the same campaign always looks the same.
export function drawMap(cv, s, reachable, rng) {
  if (!cv) return;
  const W = cv.clientWidth, H = cv.clientHeight, dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  const c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const r = rng((s.seed ^ 0x5eed) >>> 0), nodes = s.map.cols.flat(), byId = new Map(nodes.map((n) => [n.id, n]));
  const P = (n) => [(n.x / 100) * W, (n.y / 100) * H], U = Math.min(W / 100, H / 50);   // U: one map "unit" in px
  const visited = new Set(s.visited), open = new Set(reachable.map((n) => n.id));
  const ph = [r() * 9, r() * 9, r() * 9];
  const wave = (x, a) => Math.sin(x * 0.021 + ph[0]) * a + Math.sin(x * 0.057 + ph[1]) * a * 0.45 + Math.sin(x * 0.13 + ph[2]) * a * 0.2;
  const nearNode = (x, y, d) => nodes.some((n) => { const [a, b] = P(n); return Math.hypot(a - x, b - y) < d; });

  // ---- land
  c.fillStyle = "#a9bf78"; c.fillRect(0, 0, W, H);
  for (let i = 0; i < 90; i++) {   // soft large-scale colour (meadows, drier ground)
    const g = r();
    c.fillStyle = g < 0.4 ? "rgba(120,160,80,0.25)" : g < 0.75 ? "rgba(190,195,120,0.22)" : "rgba(90,125,70,0.2)";
    c.beginPath(); c.ellipse(r() * W, r() * H, (5 + r() * 14) * U, (3 + r() * 7) * U, r() * 3, 0, 7); c.fill();
  }

  // ---- the sea along the bottom (below every node)
  const lowest = Math.max(...nodes.map((n) => P(n)[1]));
  const coastY = (x) => Math.max(lowest + 5 * U, H * 0.84) + wave(x, 1.8 * U);
  c.beginPath(); c.moveTo(0, H);
  for (let x = 0; x <= W; x += 4) c.lineTo(x, coastY(x));
  c.lineTo(W, H); c.closePath();
  c.fillStyle = "#e3d6a2"; c.fill();                                   // beach
  c.save(); c.translate(0, 1.2 * U);
  c.beginPath(); c.moveTo(0, H); for (let x = 0; x <= W; x += 4) c.lineTo(x, coastY(x)); c.lineTo(W, H); c.closePath();
  const sea = c.createLinearGradient(0, H * 0.88, 0, H); sea.addColorStop(0, "#7fb2c9"); sea.addColorStop(1, "#4f86a6");
  c.fillStyle = sea; c.fill(); c.strokeStyle = "rgba(255,255,255,0.55)"; c.lineWidth = 1; c.stroke();
  c.restore();
  c.strokeStyle = "rgba(255,255,255,0.45)"; c.lineWidth = 1;   // little waves
  for (let i = 0; i < 26; i++) {
    const x = r() * W, y = coastY(x) + (2.5 + r() * 4) * U; if (y > H - U) continue;
    c.beginPath(); c.arc(x, y, 0.9 * U, Math.PI * 1.15, Math.PI * 1.85); c.arc(x + 1.6 * U, y, 0.9 * U, Math.PI * 1.15, Math.PI * 1.85); c.stroke();
  }

  // ---- mountains along the top (and a few ranges where there is room)
  const peaks = [];
  for (let x = -2 * U; x < W + 2 * U; x += (2.6 + r() * 2.2) * U) {
    const y = (2.5 + r() * 4) * U + wave(x, 1.2 * U);
    if (!nearNode(x, y + 3 * U, 8 * U)) peaks.push([x, y, (2.2 + r() * 1.6) * U]);
  }
  for (let i = 0; i < 40; i++) {
    const x = r() * W, y = (10 + r() * 22) * U;
    if (!nearNode(x, y, 12 * U) && y < coastY(x) - 8 * U && r() < 0.35) for (let k = 0; k < 3; k++) peaks.push([x + (k - 1) * 2.4 * U, y + (k % 2) * 1.2 * U, (1.6 + r()) * U]);
  }
  peaks.sort((a, b) => a[1] - b[1]).forEach(([x, y, sz]) => mountain(c, x, y, sz, sz > 2.9 * U));

  // ---- one river: from the mountains, through the river battles (left to right), down to the sea
  const rivers = nodes.filter((n) => n.terrain === "river" && n.kind !== "camp" && n.kind !== "castle").sort((a, b) => a.x - b.x);
  const pts = [];
  const rx0 = rivers.length ? P(rivers[0])[0] - 6 * U : (0.3 + r() * 0.4) * W;
  pts.push([rx0, 6 * U]);
  for (const n of rivers) { const [x, y] = P(n); pts.push([x + (r() - 0.5) * 3 * U, y + (r() - 0.5) * 2 * U]); }
  const last = pts[pts.length - 1]; pts.push([last[0] + (r() - 0.5) * 8 * U, coastY(last[0]) + 2 * U]);
  const riverPath = () => {
    c.beginPath(); c.moveTo(...pts[0]);
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      c.quadraticCurveTo(x0 + (my - y0) * 0.3, y0 + (x1 - x0) * 0.15, mx, my); c.quadraticCurveTo(x1 - (y1 - my) * 0.3, y1 - (x1 - x0) * 0.15, x1, y1);
    }
  };
  c.lineCap = "round"; c.lineJoin = "round";
  riverPath(); c.strokeStyle = "#3f6f8c"; c.lineWidth = 2.4 * U; c.stroke();
  riverPath(); c.strokeStyle = "#78aecb"; c.lineWidth = 1.6 * U; c.stroke();

  // ---- forests: dark masses of tree tops round the forest battles, and a few more in the empty land
  const forest = (x, y, rad, n) => {
    const tops = [];
    for (let i = 0; i < n; i++) { const a = r() * 6.283, d = Math.sqrt(r()) * rad; tops.push([x + Math.cos(a) * d * 1.3, y + Math.sin(a) * d * 0.8, (0.9 + r() * 0.5) * U]); }
    c.fillStyle = "#3d6a33";
    for (const [tx, ty, ts] of tops) { c.beginPath(); c.arc(tx, ty + ts * 0.3, ts * 1.25, 0, 7); c.fill(); }
    tops.sort((a, b) => a[1] - b[1]).forEach(([tx, ty, ts]) => {
      c.fillStyle = "#4f8a40"; c.strokeStyle = "#2a4a24"; c.lineWidth = 1; c.beginPath(); c.arc(tx, ty, ts, 0, 7); c.fill(); c.stroke();
      c.fillStyle = "rgba(190,230,140,0.35)"; c.beginPath(); c.arc(tx - ts * 0.3, ty - ts * 0.35, ts * 0.4, 0, 7); c.fill();
    });
  };
  for (let i = 0; i < 9; i++) {
    const x = r() * W, y = (12 + r() * 30) * U;
    if (!nearNode(x, y, 11 * U) && y < coastY(x) - 6 * U) forest(x, y, (3 + r() * 3) * U, 14 + Math.floor(r() * 10));
  }

  // ---- roads: winding dirt tracks (walked ones worn light, the ones you can take now marked in gold)
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
    road(A, B, walked ? { edge: "#5a4126", fill: "#f0e0b4", w: 1.3 * U } : { edge: "rgba(90,65,38,0.75)", fill: "#c8aa74", w: 1.0 * U });
  }
  for (const [a, b] of s.map.edges) if (a === s.pos && open.has(b)) road(byId.get(a), byId.get(b), { fill: "#f1c40f", w: 0.45 * U, dash: [1.2 * U, 1.1 * U] });

  // ---- each battlefield's own look, drawn back to front
  const items = [];
  for (const n of nodes) {
    const [x, y] = P(n), spot = (rad, lo = 3.5) => { const a = r() * 6.283, d = (lo + r() * rad) * U; return [x + Math.cos(a) * d, y + Math.sin(a) * d * 0.7]; };
    const add = (fn, k = 1, rad = 4, lo) => { for (let i = 0; i < k; i++) { const [a, b] = spot(rad, lo); items.push([b, () => fn(a, b)]); } };
    if (n.hills) for (let i = 0; i < n.hills * 2 + 1; i++) { const [a, b] = spot(4, 3); items.push([b - 99, () => hillSym(c, a, b, (1.6 + r() * 0.8) * U)]); }
    if (n.kind === "castle") { items.push([y + 99, () => castle(c, x, y - 2 * U, 3.2 * U)]); continue; }
    if (n.kind === "camp") { add((a, b) => tent(c, a, b, 1.5 * U), 3, 3); continue; }
    const k = n.terrain;
    if (k === "forest") items.push([y - 999, () => forest(x, y, 6 * U, 26)]);
    else if (k === "village") { items.push([y - 999, () => fields(c, x, y, U, r)]); add((a, b) => house(c, a, b, (1.3 + r() * 0.4) * U, r), 5, 3, 2.5); }
    else if (k === "graveyard") { add((a, b) => tomb(c, a, b, 0.9 * U), 8, 3.5); add((a, b) => deadTree(c, a, b, 1.8 * U), 2, 4); }
    else if (k === "ruins") add((a, b) => wall(c, a, b, (1.2 + r()) * U, r), 5, 4);
    else if (k === "open") add((a, b) => tuft(c, a, b, 0.9 * U), 12, 5);
    else if (k === "river") { add((a, b) => tree(c, a, b, (0.9 + r() * 0.4) * U, r), 4, 5); items.push([y, () => bridge(c, x, y, 1.5 * U)]); }
    else if (k === "hills") add((a, b) => tree(c, a, b, (0.9 + r() * 0.4) * U, r), 3, 5);
  }
  items.sort((p, q) => p[0] - q[0]).forEach(([, f]) => f());

  // ---- frame and compass rose
  compass(c, W - 7 * U, H - 6.5 * U, 3.6 * U);
  c.strokeStyle = "#5a4126"; c.lineWidth = 3; c.strokeRect(1.5, 1.5, W - 3, H - 3);
  c.strokeStyle = "rgba(90,65,38,0.55)"; c.lineWidth = 1; c.strokeRect(5, 5, W - 10, H - 10);
}

function mountain(c, x, y, s, snow) {
  c.lineJoin = "round"; c.lineWidth = 1;
  c.fillStyle = "#9a8f78"; c.strokeStyle = "#4a4236";
  c.beginPath(); c.moveTo(x - s * 1.2, y + s); c.lineTo(x, y - s); c.lineTo(x + s * 1.2, y + s); c.closePath(); c.fill(); c.stroke();
  c.fillStyle = "#6d6456"; c.beginPath(); c.moveTo(x, y - s); c.lineTo(x + s * 1.2, y + s); c.lineTo(x + s * 0.15, y + s); c.closePath(); c.fill();   // shaded side
  if (snow) {
    c.fillStyle = "#f4f1e8"; c.beginPath(); c.moveTo(x, y - s); c.lineTo(x - s * 0.36, y - s * 0.4); c.lineTo(x - s * 0.1, y - s * 0.5);
    c.lineTo(x + s * 0.05, y - s * 0.35); c.lineTo(x + s * 0.36, y - s * 0.4); c.closePath(); c.fill();
  }
}
// the classic map symbol for a hill: a rounded bump, lit from the left, hatched on the right
function hillSym(c, x, y, s) {
  c.fillStyle = "#b9c983"; c.strokeStyle = "#5c6b3a"; c.lineWidth = 1.2;
  c.beginPath(); c.moveTo(x - s * 1.3, y); c.bezierCurveTo(x - s * 0.9, y - s * 1.1, x + s * 0.9, y - s * 1.1, x + s * 1.3, y); c.fill(); c.stroke();
  c.strokeStyle = "rgba(70,85,40,0.6)"; c.lineWidth = 1;
  for (let i = 0; i < 4; i++) { const t = 0.2 + i * 0.18, hx = x + s * t * 1.1; c.beginPath(); c.moveTo(hx, y - s * (0.8 - t * 0.7)); c.lineTo(hx + s * 0.12, y - s * 0.05); c.stroke(); }
}
function fields(c, x, y, U, r) {
  const cols = ["#d8c873", "#c4cf7c", "#b5c76a", "#e0d08a"];
  for (let i = 0; i < 7; i++) {
    const a = r() * 6.283, d = (2 + r() * 4) * U, fx = x + Math.cos(a) * d * 1.2, fy = y + Math.sin(a) * d * 0.7;
    c.save(); c.translate(fx, fy); c.rotate((r() - 0.5) * 0.6);
    c.fillStyle = cols[i % 4]; c.strokeStyle = "rgba(110,95,50,0.6)"; c.lineWidth = 1;
    const w = (2.2 + r() * 1.6) * U, h = (1.4 + r()) * U; c.fillRect(-w / 2, -h / 2, w, h); c.strokeRect(-w / 2, -h / 2, w, h);
    c.strokeStyle = "rgba(120,100,50,0.35)"; for (let k = 1; k < 4; k++) { c.beginPath(); c.moveTo(-w / 2, -h / 2 + (h * k) / 4); c.lineTo(w / 2, -h / 2 + (h * k) / 4); c.stroke(); }
    c.restore();
  }
}
function compass(c, x, y, s) {
  c.save(); c.translate(x, y);
  c.fillStyle = "rgba(240,230,200,0.85)"; c.strokeStyle = "#5a4126"; c.lineWidth = 1;
  c.beginPath(); c.arc(0, 0, s * 0.62, 0, 7); c.fill(); c.stroke();
  for (let i = 0; i < 4; i++) {
    c.rotate(Math.PI / 2);
    c.fillStyle = i === 3 ? "#a8452f" : "#5a4126";
    c.beginPath(); c.moveTo(0, -s); c.lineTo(s * 0.18, 0); c.lineTo(-s * 0.18, 0); c.closePath(); c.fill();
  }
  c.fillStyle = "#5a4126"; c.font = `bold ${Math.round(s * 0.42)}px serif`; c.textAlign = "center"; c.fillText("N", 0, -s * 1.08);
  c.restore();
}
function tree(c, x, y, s, r) {
  c.fillStyle = "rgba(0,0,0,0.2)"; c.beginPath(); c.ellipse(x + s * 0.4, y + s * 0.5, s, s * 0.45, 0, 0, 7); c.fill();
  c.fillStyle = "#5a3d22"; c.fillRect(x - s * 0.15, y - s * 0.2, s * 0.3, s * 0.7);
  c.fillStyle = r() < 0.5 ? "#4f8a40" : "#5b9748"; c.strokeStyle = "#2a4a24"; c.lineWidth = 1;
  c.beginPath(); c.arc(x, y - s * 0.6, s, 0, 7); c.fill(); c.stroke();
}
function deadTree(c, x, y, s) {
  c.strokeStyle = "#3a3040"; c.lineWidth = Math.max(1, s * 0.16); c.lineCap = "round"; c.beginPath();
  c.moveTo(x, y); c.lineTo(x, y - s); c.moveTo(x, y - s * 0.6); c.lineTo(x - s * 0.5, y - s * 1.1); c.moveTo(x, y - s * 0.8); c.lineTo(x + s * 0.45, y - s * 1.2); c.stroke();
}
function rock(c, x, y, s) { c.fillStyle = "#9a958a"; c.strokeStyle = "#4a463e"; c.lineWidth = 1; c.beginPath(); c.ellipse(x, y, s, s * 0.65, 0.3, 0, 7); c.fill(); c.stroke(); }
function house(c, x, y, s, r) {
  c.fillStyle = "#e8dcbc"; c.strokeStyle = "#4a3520"; c.lineWidth = 1;
  c.fillRect(x - s * 0.6, y - s * 0.3, s * 1.2, s * 0.8); c.strokeRect(x - s * 0.6, y - s * 0.3, s * 1.2, s * 0.8);
  c.fillStyle = r() < 0.5 ? "#b5523a" : "#9a6a36";
  c.beginPath(); c.moveTo(x - s * 0.8, y - s * 0.3); c.lineTo(x, y - s); c.lineTo(x + s * 0.8, y - s * 0.3); c.closePath(); c.fill(); c.stroke();
}
function tomb(c, x, y, s) {
  c.fillStyle = "#c9c4cc"; c.strokeStyle = "#3a3540"; c.lineWidth = 1;
  c.beginPath(); c.moveTo(x - s * 0.4, y + s * 0.4); c.lineTo(x - s * 0.4, y - s * 0.3); c.arc(x, y - s * 0.3, s * 0.4, Math.PI, 0); c.lineTo(x + s * 0.4, y + s * 0.4); c.closePath(); c.fill(); c.stroke();
}
function wall(c, x, y, s, r) {
  c.fillStyle = "#b0a894"; c.strokeStyle = "#4a463e"; c.lineWidth = 1;
  const h = s * (0.4 + r() * 0.6); c.fillRect(x - s * 0.7, y - h, s * 1.4, h); c.strokeRect(x - s * 0.7, y - h, s * 1.4, h);
  rock(c, x + s, y + s * 0.2, s * 0.25);
}
function tuft(c, x, y, s) {
  c.strokeStyle = "#8f9a4a"; c.lineWidth = 1; c.beginPath();
  for (const d of [-0.4, 0, 0.4]) { c.moveTo(x + d * s, y); c.lineTo(x + d * s * 1.8, y - s); }
  c.stroke();
}
function tent(c, x, y, s) {
  c.fillStyle = "#f0e6cc"; c.strokeStyle = "#4a3a24"; c.lineWidth = 1;
  c.beginPath(); c.moveTo(x - s, y + s * 0.4); c.lineTo(x, y - s * 0.8); c.lineTo(x + s, y + s * 0.4); c.closePath(); c.fill(); c.stroke();
  c.beginPath(); c.moveTo(x, y - s * 0.8); c.lineTo(x, y + s * 0.4); c.stroke();
}
function bridge(c, x, y, s) {
  c.fillStyle = "#8a6238"; c.strokeStyle = "#3b2a1a"; c.lineWidth = 1;
  c.fillRect(x - s * 1.3, y - s * 0.45, s * 2.6, s * 0.9); c.strokeRect(x - s * 1.3, y - s * 0.45, s * 2.6, s * 0.9);
}
function castle(c, x, y, s) {
  c.fillStyle = "rgba(0,0,0,0.25)"; c.fillRect(x - s * 1.4, y + s * 0.9, s * 3, s * 0.4);
  c.fillStyle = "#a9a296"; c.strokeStyle = "#3a3630"; c.lineWidth = 1.2;
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
