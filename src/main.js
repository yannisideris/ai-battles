import * as THREE from "three";
import { QUALITY, ROSTER, TEAM, STATS, DIFFICULTY } from "./config.js";
import { World } from "./world.js";
import { loadUnitModels } from "./assets.js";
import { Unit, rint, angDiff, HEAVY_CHARGE } from "./unit.js";
import { Input } from "./input.js";
import { General, Brain, ORDERS } from "./ai.js";
import { LINES, UI } from "./lines.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
// ?test=20 -> auto-stop rendering after 20 s (safety for unattended checks); ?auto=1 -> start immediately
const TEST_SECONDS = Number(params.get("test")) || 0;
// ?spectate=1 -> the AI also plays your character and the camera follows the fighting (for testing / watching)
const SPECTATE = !!params.get("spectate");
// ?sim=20 -> run 20 battles headless (no rendering, no sound) and report who wins; for balance checks
const SIM = Number(params.get("sim")) || 0;

class Game {
  constructor() {
    this.canvas = $("view");
    this.input = new Input();
    this.settings = { side: "human", role: "captain", lang: "el", quality: "medium", difficulty: "normal" };
    for (const k of ["side", "role", "quality", "lang", "difficulty"]) if (params.get(k)) this.settings[k] = params.get(k);   // e.g. ?role=soldier for quick tests
    this.running = false;
    try { speechSynthesis.getVoices(); speechSynthesis.addEventListener("voiceschanged", () => speechSynthesis.getVoices()); } catch {}   // start loading the voice list early
    this.setupMenu();
  }

  setupMenu() {
    for (const b of document.querySelectorAll("#menu button[data-side],#menu button[data-lang],#menu button[data-difficulty]")) {
      const k = Object.keys(b.dataset)[0];
      b.onclick = () => {
        document.querySelectorAll(`#menu button[data-${k}]`).forEach((x) => x.classList.remove("sel"));
        b.classList.add("sel"); this.settings[k] = b.dataset[k];
      };
    }
    $("start").onclick = () => this.start();
    $("again").onclick = () => { $("end").classList.add("hidden"); $("menu").classList.remove("hidden"); };
    if (params.get("auto")) setTimeout(() => this.start(), 50);
    this.menuPad();
  }

  // gamepad (and arrow keys) on the menus: up/down picks a row, left/right picks the option, A / Start / Enter confirms
  menuPad() {
    const rows = [...document.querySelectorAll("#menu .row")];
    let row = 0, prev = {}, held = 0;
    const mark = () => {
      rows.forEach((r, i) => r.classList.toggle("rowfocus", i === row));
      $("start").classList.toggle("padfocus", row === rows.length);
    };
    const move = (dr, dc) => {
      document.body.classList.add("padnav");
      if (dr) { row = (row + dr + rows.length + 1) % (rows.length + 1); mark(); }
      if (dc && row < rows.length) {
        const bs = [...rows[row].querySelectorAll("button")], i = bs.findIndex((b) => b.classList.contains("sel"));
        bs[Math.max(0, Math.min(bs.length - 1, i + dc))].click();
      }
    };
    addEventListener("mousemove", () => document.body.classList.remove("padnav"));
    const confirm = () => {
      document.body.classList.add("padnav");
      if (!$("end").classList.contains("hidden")) $("again").click();
      else if (!$("menu").classList.contains("hidden")) { if (row === rows.length) $("start").click(); else { row = rows.length; mark(); } }
    };
    const menuOpen = () => !$("menu").classList.contains("hidden") || !$("end").classList.contains("hidden");
    addEventListener("keydown", (e) => {
      if (!menuOpen()) return;
      const k = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
      if (k && !$("menu").classList.contains("hidden")) { move(...k); e.preventDefault(); }
      if (e.key === "Enter" || e.key === " ") { confirm(); e.preventDefault(); }
    });
    const poll = () => {
      requestAnimationFrame(poll);
      if (!menuOpen()) { prev = {}; return; }
      const p = [...(navigator.getGamepads ? navigator.getGamepads() : [])].find(Boolean);
      if (!p) return;
      const ax = p.axes[0] || 0, ay = p.axes[1] || 0, btn = (i) => !!(p.buttons[i] && p.buttons[i].pressed);
      const now = { up: btn(12) || ay < -0.6, down: btn(13) || ay > 0.6, left: btn(14) || ax < -0.6, right: btn(15) || ax > 0.6, ok: btn(0) || btn(9) };
      const edge = (k) => now[k] && !prev[k];
      // holding a direction repeats slowly
      const anyDir = now.up || now.down || now.left || now.right;
      held = anyDir ? held + 1 : 0;
      const rep = held > 24 && held % 10 === 0;
      if (!$("menu").classList.contains("hidden")) {
        if (edge("up") || (rep && now.up)) move(-1, 0);
        if (edge("down") || (rep && now.down)) move(1, 0);
        if (edge("left") || (rep && now.left)) move(0, -1);
        if (edge("right") || (rep && now.right)) move(0, 1);
      }
      if (edge("ok")) confirm();
      prev = now;
    };
    mark(); poll();
  }

  async start() {
    $("menu").classList.add("hidden");
    this.q = QUALITY[this.settings.quality];
    this.diff = DIFFICULTY[this.settings.difficulty] || DIFFICULTY.normal;
    this.ui = UI[this.settings.lang];
    $("help").textContent = this.ui.help;
    this.spoke = { foe: -99, ally: -99 }; this.recent = {}; this.said = {}; this.ended = false;
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: this.settings.quality !== "low", powerPreference: "default" });
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    }
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.q.pixelRatio));
    this.renderer.shadowMap.enabled = this.q.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8fc3d9);
    this.scene.fog = new THREE.Fog(0x8fc3d9, 30, 60);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 120);
    this.scene.add(new THREE.HemisphereLight(0xdff3ff, 0x5a6b3a, 1.4));
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
    this.sun.castShadow = this.q.shadows;
    this.sun.shadow.mapSize.set(this.q.shadowSize, this.q.shadowSize);
    Object.assign(this.sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 60 });
    this.sun.shadow.bias = -0.0008;
    this.scene.add(this.sun, this.sun.target);
    this.world = new World(this.scene, this.q);
    await loadUnitModels(this.q);
    this.spawnArmies();
    this.arrows = [];
    this.time = 0; this.pending = []; this.lastHitTime = 0;
    this.generals = { human: new General(this, "human"), skeleton: new General(this, "skeleton") };
    this.setupOrders();
    this.targetRing = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.52, 28), new THREE.MeshBasicMaterial({ color: 0xff4444, transparent: true, opacity: 0.85, depthWrite: false }));
    this.targetRing.rotation.x = -Math.PI / 2; this.targetRing.position.y = 0.03; this.scene.add(this.targetRing);
    // "this is you": a small golden chevron bobbing above the player's head
    this.marker = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.28, 4), new THREE.MeshBasicMaterial({ color: 0xffcf33, depthTest: false, transparent: true, opacity: 0.95 }));
    this.marker.rotation.x = Math.PI; this.marker.renderOrder = 20; this.scene.add(this.marker);
    this.camPos = this.player.pos.clone().add(this.camOffset());
    addEventListener("resize", () => this.resize()); this.resize();
    this.running = true; this.last = performance.now(); this.acc = 0; this.frames = 0; this.fpsT = 0;
    this.startedAt = performance.now();
    if (SIM) { this.runSims(SIM); return; }
    this.speak("foe", "start", { priority: true });
    this.pending.push({ at: 3.2, fn: () => this.speak("ally", "start", { priority: true }) });
    requestAnimationFrame((t) => this.loop(t));
  }

  // headless balance check: AI vs AI, fixed 20 Hz steps, nothing drawn
  async runSims(n) {
    this.muted = true; this.running = false;
    const res = { human: 0, skeleton: 0, unfinished: 0 }, details = [];
    const blank = () => ({ meleeHits: 0, meleeDmg: 0, rangedHits: 0, rangedDmg: 0, blocked: 0, bashDmg: 0, shots: 0 });
    this.stats = { human: blank(), skeleton: blank() };
    for (let i = 0; i < n; i++) {
      if (i > 0) {
        for (const c of [...this.scene.children]) if (c !== this.sun && c !== this.sun.target && !c.isLight) this.scene.remove(c);
        this.world = new World(this.scene, this.q);
        this.spawnArmies(); this.arrows = []; this.time = 0; this.pending = []; this.ended = false; this.lastHitTime = 0; this.winner = null; this.lastKillerTeam = null;
        this.generals = { human: new General(this, "human"), skeleton: new General(this, "skeleton") };
      }
      this.player.setPlayer(false);
      let lull = null;
      while (!this.ended && this.time < 1500) {
        this.step(0.05);   // battles always end; the cap only guards against bugs
        // diagnostics: remember the first long lull (2 min without a single blow) and who was where
        if (!lull && this.time - this.lastHitTime > 120) {
          const d = (team) => this.alive(team).map((u) => `${u.type[0]}${Math.round(u.pos.x)},${Math.round(u.pos.z)} hp${u.hp} g${u.brain.goal ? Math.round(u.brain.goal.x) + "," + Math.round(u.brain.goal.z) : "-"}`).join(" | ");
          lull = `LULL@${Math.round(this.time)}s endgame=${this.endgame} H[${d("human")}] S[${d("skeleton")}]`;
        }
      }
      if (lull) details.push(lull);
      const h = this.alive("human").length, s = this.alive("skeleton").length;
      const w = !this.ended ? "unfinished" : this.winner;
      res[w]++; details.push(`${w}(${h}-${s}, ${Math.round(this.time)}s)`);
      if (w === "unfinished") {   // stalemate diagnostics
        const desc = (team) => this.alive(team).map((u) => `${u.type[0]}${Math.round(u.pos.x)},${Math.round(u.pos.z)} m${Math.round(u.morale)} hp${u.hp}${u.brain.regrouping ? " R" : ""}${u.brain.engaged ? " E" : ""}`).join(" | ");
        details.push(`  [H plan ${this.generals.human.plan.stance}/${this.generals.human.plan.note}] ${desc("human")}`);
        details.push(`  [S plan ${this.generals.skeleton.plan.stance}/${this.generals.skeleton.plan.note}] ${desc("skeleton")}`);
      }
      $("general-line").textContent = `SIM ${i + 1}/${n}: humans ${res.human} · skeletons ${res.skeleton} · unfinished ${res.unfinished}`;
      await new Promise((r) => setTimeout(r, 0));
    }
    console.log("[SIM] result", JSON.stringify(res), details.join(" "));
    window.__simResult = { res, details, stats: this.stats };
  }

  spawnArmies() {
    if (this.units) for (const u of this.units) this.scene.remove(u.root);
    this.units = [];
    for (const team of ["human", "skeleton"]) {
      const dir = Math.sign(TEAM[team].spawnZ);
      for (const [type, x, dz] of ROSTER) {
        const u = new Unit(this, team, type, x + (Math.random() - 0.5) * 0.4, TEAM[team].spawnZ + dir * dz);
        u.brain = new Brain(u);
        this.units.push(u);
      }
    }
    for (const u of this.units) if (u.team !== this.settings.side) { u.maxHp = u.hp = Math.round(u.s.hp * this.diff.hp); }
    const mine = this.units.filter((u) => u.team === this.settings.side && u.type === this.settings.role);
    this.player = mine[Math.floor(mine.length / 2)];
    this.player.setPlayer(!SPECTATE);
  }

  // ---------------------------------------------------------------- helpers used by units / AI
  alive(team) { return this.units.filter((u) => u.alive && u.team === team); }
  enemyOf(team) { return team === "human" ? "skeleton" : "human"; }
  spawnZ(team) { return TEAM[team].spawnZ; }
  enemyCaptain() { return this.units.find((u) => u.team !== this.settings.side && u.type === "captain" && u.alive); }

  applyHit(att, t, dmg, ranged = false) {
    // archers wear no armour and carry no shield: a sword that reaches them hurts a lot more
    if (!ranged && t.type === "archer" && att.type !== "archer") dmg = Math.round(dmg * 1.75);
    if (att.team !== this.settings.side) dmg = Math.max(1, Math.round(dmg * this.diff.dmg));   // difficulty
    this.lastHitTime = this.time;
    const killed = t.alive && t.hp <= dmg;
    const dealt = t.takeHit(att, dmg, ranged);
    if (this.stats) {   // balance diagnostics (sim mode only)
      const st = this.stats[att.team];
      st[ranged ? "rangedHits" : "meleeHits"]++; st[ranged ? "rangedDmg" : "meleeDmg"] += dealt;
      if (!dealt && !ranged) st.blocked++;
      if (att.type === "archer" && !ranged) st.bashDmg += dealt;
    }
    if (dealt) this.sfx(ranged ? "arrowhit" : att.isPlayer ? "bigHit" : "hit");
    // arcade feedback when the player is involved (purely visual, the numbers don't change)
    if (dealt && att.isPlayer) {
      this.popup(t, killed ? `KO!` : `${dealt}`, killed ? "ko" : "dealt");
      this.hitStop = killed || att.heavyHit ? 0.12 : 0.06; this.shake = Math.max(this.shake || 0, killed || att.heavyHit ? 0.24 : 0.12);
    }
    if (dealt && t.isPlayer) { this.popup(t, `-${dealt}`, "taken"); this.shake = Math.max(this.shake || 0, 0.18); }
    // the enemy captain complains when badly hurt (once at half, once near death)
    if (dealt && t.alive && t.type === "captain" && t.team !== this.settings.side) {
      const f = t.hpFrac();
      if (f < 0.5 && !this.said.hurt1) { this.said.hurt1 = true; this.speak("foe", "hurt", { priority: true }); }
      else if (f < 0.22 && !this.said.hurt2) { this.said.hurt2 = true; this.speak("foe", "hurt", { priority: true }); }
    }
  }
  onBlock(att, t) {
    if (att.isPlayer || t.isPlayer) { this.popup(t, "BLOCK", "block"); this.shake = Math.max(this.shake || 0, 0.06); }
  }
  // floating combat text above a unit
  popup(u, text, kind) {
    if (this.muted) return;
    const p = u.pos.clone(); p.y = 1.35 * u.s.scale; p.project(this.camera);
    const el = document.createElement("div"); el.className = `pop ${kind}`; el.textContent = text;
    el.style.left = `${(p.x + 1) / 2 * innerWidth + (Math.random() - 0.5) * 24}px`; el.style.top = `${(1 - p.y) / 2 * innerHeight}px`;
    $("bubbles").appendChild(el); setTimeout(() => el.remove(), 900);
  }
  onDeath(u, killer) {
    this.sfx("death");
    if (killer) this.lastKillerTeam = killer.team;
    this.deathLines(u, killer);
    for (const a of this.alive(u.team)) if (a.dist(u) < 7) a.morale -= 12 / a.trait.bravery;
    if (u.type === "captain") {
      for (const a of this.alive(u.team)) a.morale -= 35;
      for (const a of this.alive(this.enemyOf(u.team))) a.morale = Math.min(100, a.morale + 25);
    }
    if (u.isPlayer) this.takeOver(u);
    this.checkEnd();
  }
  checkEnd() {
    // last side standing wins; no draws, no early "rout" ending
    for (const team of ["human", "skeleton"]) {
      const a = this.alive(team);
      const routed = false;
      if (!a.length) {
        if (this.ended) return;
        // both sides wiped out in the same moment: whoever struck the last blow wins
        const loser = this.alive(this.enemyOf(team)).length ? team : this.enemyOf(this.lastKillerTeam || this.enemyOf(team));
        const won = loser !== this.settings.side;
        this.winner = this.enemyOf(loser);
        if (won) { this.speak("ally", "win", { priority: true, force: true }); this.speak("foe", "lose", { priority: true, force: true }); }
        else this.speak("foe", "win", { priority: true, force: true });
        // winners jump for joy for a few seconds before the result screen
        for (const u of this.alive(this.winner)) { u.celebrating = true; u.play(u.variant("cheer2", "cheer"), 0.2, 0.9 + Math.random() * 0.25); }
        setTimeout(() => this.finish(won, routed), 3000);
        this.ended = true; return;
      }
    }
  }
  finish(won, routed) {
    if (!this.running) return;
    this.running = false;
    this.renderer.render(this.scene, this.camera);
    $("end-title").textContent = won ? this.ui.victory : this.ui.defeat;
    $("again").textContent = this.settings.lang === "el" ? "Ξανά" : "Again";
    $("end-sub").textContent = won ? (routed ? this.ui.enemyRouted : this.ui.enemyWiped) : (routed ? this.ui.youRouted : this.ui.youWiped);
    $("end").classList.remove("hidden");
  }

  // one shared arrow model (shaft + head + team-coloured fletching), cloned per shot
  arrowModel(team) {
    this.arrowProto ??= {};
    if (!this.arrowProto[team]) {
      const g = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.6, 5), new THREE.MeshBasicMaterial({ color: 0xeadcc0 }));
      shaft.rotation.x = Math.PI / 2;
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.11, 5), new THREE.MeshBasicMaterial({ color: 0xf2f2ee }));
      head.rotation.x = Math.PI / 2; head.position.z = 0.35;
      const fl = new THREE.MeshBasicMaterial({ color: new THREE.Color(TEAM[team].color).lerp(new THREE.Color(0xffffff), 0.45), side: THREE.DoubleSide });
      for (const r of [0, Math.PI / 2]) {
        const f = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.12), fl);
        f.position.z = -0.26; f.rotation.set(Math.PI / 2, r, 0); g.add(f);
      }
      g.add(shaft, head);
      this.arrowProto[team] = g;
    }
    return this.arrowProto[team].clone();
  }
  fireArrow(from, to) {
    if (this.stats) this.stats[from.team].shots++;
    const lead = Math.min(0.6, from.dist(to) / 13);
    const tx = to.pos.x + to.vel.x * lead, tz = to.pos.z + to.vel.z * lead;
    const mesh = this.arrowModel(from.team);
    this.scene.add(mesh);
    // faint white streak behind the arrow so it reads at game distance
    const trailGeo = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 8 }, () => from.pos.clone().setY(0.9)));
    const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0xfff8e8, transparent: true, opacity: 0.25 }));
    this.scene.add(trail);
    const d = Math.hypot(tx - from.pos.x, tz - from.pos.z);
    this.arrows.push({ mesh, trail, hist: [], from, to, sx: from.pos.x, sz: from.pos.z, tx, tz, t: 0, dur: d / 12 + 0.08, h: 0.6 + d * 0.09, d, stuck: 0 });
    this.sfx("bow");
  }
  updateArrows(dt) {
    for (const a of this.arrows) {
      if (a.stuck) {
        a.stuck -= dt;
        a.trail.visible = false;
        if (a.stuck <= 0) { this.scene.remove(a.mesh, a.trail); a.trail.geometry.dispose(); a.dead = true; }
        continue;
      }
      a.t += dt / a.dur;
      const k = Math.min(1, a.t), x = a.sx + (a.tx - a.sx) * k, z = a.sz + (a.tz - a.sz) * k, y = 0.9 + Math.sin(k * Math.PI) * a.h - k * 0.35;
      const prev = a.mesh.position.clone();
      a.mesh.position.set(x, y, z);
      if (a.t > dt / a.dur) a.mesh.lookAt(prev.lerp(a.mesh.position, 2));
      a.hist.unshift(a.mesh.position.clone()); if (a.hist.length > 8) a.hist.pop();
      const pos = a.trail.geometry.attributes.position;
      for (let i = 0; i < 8; i++) { const p = a.hist[Math.min(i, a.hist.length - 1)]; pos.setXYZ(i, p.x, p.y, p.z); }
      pos.needsUpdate = true;
      if (k < 0.97 && this.world.blocksArrow(x, z) && y < 2.4) { this.scene.remove(a.mesh, a.trail); a.trail.geometry.dispose(); a.dead = true; continue; }   // hit a wall / tree: gone
      if (k >= 1) {
        const t = a.to;
        if (t.alive && Math.hypot(t.pos.x - x, t.pos.z - z) < 0.55) {
          let dmg = rint(STATS.archer.dmg); if (a.d > STATS.archer.longShot) dmg = Math.max(1, dmg - 2);
          this.applyHit(a.from, t, dmg, true); this.scene.remove(a.mesh, a.trail); a.trail.geometry.dispose(); a.dead = true;
        } else { this.scene.remove(a.mesh, a.trail); a.trail.geometry.dispose(); a.dead = true; }       // missed: gone, nothing left on the ground
      }
    }
    this.arrows = this.arrows.filter((a) => !a.dead);
  }

  // ---------------------------------------------------------------- player
  camOffset() { return new THREE.Vector3(0, 11, this.settings.side === "human" ? 8.5 : -8.5); }
  // (the player's swings no longer step or slide towards the target: you hit what is within sword's length)
  applyLunge() {}
  playerControl(inp) {
    const p = this.player, v = new THREE.Vector3();
    if (!p.alive) return v;
    // screen-relative movement: "up" = away from the camera
    const fwd = new THREE.Vector3(); this.camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    v.addScaledVector(right, inp.mx).addScaledVector(fwd, -inp.mz).multiplyScalar(p.s.speed);
    const foes = this.alive(this.enemyOf(p.team));
    // target selection
    if (!p.target || !p.target.alive || p.dist(p.target) > 16) p.target = this.autoTarget(p, foes);
    if (inp.cycleTarget && foes.length) {
      const sorted = foes.filter((f) => p.dist(f) < 16).sort((a, b) => p.dist(a) - p.dist(b));
      const i = sorted.indexOf(p.target); p.target = sorted[(i + 1) % sorted.length] || p.target;
    }
    if (p.type === "archer") { const t = this.archerPick(p, foes); if (t) p.target = t; }
    if (inp.click) {
      const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(inp.click.x / innerWidth * 2 - 1, -(inp.click.y / innerHeight) * 2 + 1);
      ray.setFromCamera(ndc, this.camera);
      const hit = ray.intersectObject(this.world.ground)[0];
      if (hit) { let best = null, bd = 1.4; for (const f of foes) { const d = Math.hypot(f.pos.x - hit.point.x, f.pos.z - hit.point.z); if (d < bd) { bd = d; best = f; } }
        if (best) { p.target = best; if (inp.click.button === 0) inp.attack = true; } }
    }
    // heavy blow (melee): keep the attack button held after a swing -> the sword goes up and is held (charging);
    // release once it is ready (~0.45 s, a click tells you) -> a heavy, shield-breaking blow. Release early -> nothing.
    if (p.type !== "archer") {
      this.holdT = inp.attackHeld ? (this.holdT || 0) + this.lastDt : 0;
      // still holding ~0.15 s after the press: that was not a tap - drop the quick swing before it lands and go
      // straight into the raised-sword stance (no quick swing animation in front of the heavy blow)
      // fresh press: tap (released early) -> the chop speeds up and lands; held past 0.15 s -> heavy stance
      if (p.freshPending) {
        if (!inp.attackHeld) {
          p.freshPending = false;
          const a = p.current, k = 2.2; if (a) a.timeScale = k;
          p.attackTimer = Math.max(0.03, (0.35 - (a ? a.time : 0)) / k);
          if (p.pendingLunge) { this.applyLunge(p, p.pendingLunge.dir, p.pendingLunge.step); p.pendingLunge = null; }
        } else if (this.holdT > 0.15) {
          p.freshPending = false; p.attackTimer = 0; this.heldTarget = p.pendingTarget; p.pendingTarget = null; p.cooldown = 0;
          this.chargeFromTap = true; p.startCharge();
        }
      }
      if (inp.attackHeld && !p.charging && !p.heavy && this.holdT > 0.15 && p.quick && p.attackTimer > 0 && !p.freshPending) {
        p.attackTimer = 0; p.pendingTarget = null; p.cooldown = 0; this.chargeFromTap = true; p.startCharge();
      }
      if (inp.attackHeld && !p.charging && this.holdT > 0.32 && p.attackTimer <= 0 && !p.heavy) { this.chargeFromTap = false; p.startCharge(); }
      // aim assist for blows released from the raised stance: the best enemy in front within a short step
      const aimBest = () => {
        let best = null, bs = -1e9;
        for (const f of foes) {
          const d = p.dist(f); if (d > p.meleeReach(f) + 1.4) continue;
          const ang = Math.abs(angDiff(Math.atan2(f.pos.x - p.pos.x, f.pos.z - p.pos.z), p.facing));
          const sc = -d - ang * 0.9; if (sc > bs) { bs = sc; best = f; }
        }
        return best;
      };
      if (p.charging) {
        p.chargeT += this.lastDt;
        if (!p.chargeReady && p.chargeT >= HEAVY_CHARGE) { p.chargeReady = true; this.sfx("draw"); }
        if (!inp.attackHeld) {
          if (!p.chargeReady) {
            if (p.current === p.actions.attack) {
              // let go before it was ready: the sword still comes down, as a normal (weaker) blow, from where it is now
              const tgt = (this.chargeFromTap && this.heldTarget && this.heldTarget.alive ? this.heldTarget : null) || aimBest();
              p.charging = false; this.chargeFromTap = false;
              const a = p.actions.attack, k = 2.2; a.paused = false; a.timeScale = k;
              if (tgt) p.faceTo(tgt.pos.x, tgt.pos.z, true);
              p.quick = true; p.pendingTarget = tgt; p.attackTimer = Math.max(0.03, (0.35 - a.time) / k);
              p.cooldown = p.s.cooldown * 0.5;
              if (p.pendingLunge) { this.applyLunge(p, p.pendingLunge.dir, p.pendingLunge.step); p.pendingLunge = null; }
              return v;
            }
            p.cancelCharge();
            if (this.chargeFromTap) { p.cooldown = 0; this.chargeFromTap = false; this.attackBuffer = 0.28; return v; }
          } else {
            p.releaseHeavy(aimBest()); this.chargeFromTap = false; p.pendingLunge = null;
          }
        }
        this.attackBuffer = 0;
        return v;   // no quick swings while charging (orders still need a free hand: none while the sword is up)
      }
    }
    // input buffer: a press is remembered for a moment, so mashing during a swing still lands the next one
    if (inp.attack) this.attackBuffer = 0.28;
    else this.attackBuffer = Math.max(0, (this.attackBuffer || 0) - this.lastDt);
    if (this.attackBuffer > 0 && p.cooldown <= 0 && p.attackTimer <= 0) {
      let t = p.target;
      if (p.type !== "archer" || (t && p.dist(t) <= p.s.bashRange + t.radius)) {
        // aim assist: the closest enemy roughly in front of you within a short step
        let best = null, bs = -1e9;
        for (const f of foes) {
          const d = p.dist(f); if (d > p.meleeReach(f) + 1.3) continue;
          const ang = Math.abs(angDiff(Math.atan2(f.pos.x - p.pos.x, f.pos.z - p.pos.z), p.facing));
          const s = -d - ang * 0.9 + (f === p.target ? 0.6 : 0); if (s > bs) { bs = s; best = f; }
        }
        if (best) { t = best; p.target = best; }
        // turn towards a target just out of reach (no step-in: out of reach is out of reach)
        if (t && p.dist(t) < p.meleeReach(t) + 1.3) p.faceTo(t.pos.x, t.pos.z, true);
      }
      // archer: fire while holding a direction -> shoot the enemy that way (takes priority). Nobody that way
      // (e.g. you are running away and they are behind you) -> the automatic pick, as before.
      if (p.type === "archer" && v.lengthSq() > 0.01) { const aimed = this.archerAim(p, foes, Math.atan2(v.x, v.z)); if (aimed) { t = aimed; p.target = aimed; } }
      const started = p.startAttack(t); p.reachBonus = 0;
      if (started) this.attackBuffer = 0;
      else if (p.type !== "archer" && this.time - (p.lastSwingT ?? -9) > 1.0) { p.freshWhiff(); this.attackBuffer = 0; }   // nothing in reach: same smooth rise (it may become a heavy blow)
      else if (p.type !== "archer") {   // whiff: swing at the air anyway, it should never feel unresponsive
        p.play(p.variant("attack", "attack2", "attack2", "attack3"), 0.06, 1.15); p.cooldown = 0.5; this.sfx("swing"); this.attackBuffer = 0;
      } else if (inp.attack && t) this.say(!this.world.lineClear(p.pos.x, p.pos.z, t.pos.x, t.pos.z) ? this.ui.noLos : p.dist(t) < p.s.minRange ? this.ui.tooClose : this.ui.outOfRange, 1.2);
    }
    if (inp.order !== null && p.type === "captain") this.issueOrder(inp.order);
    return v;
  }
  // archer auto-aim: the enemy you are facing that is in range with a clear shot; keep the current one while it stays valid
  // the enemy in the held direction (within ~70 degrees) that the archer can actually hit; null if none
  archerAim(p, foes, dirAng) {
    let best = null, bs = 1e9;
    for (const f of foes) {
      const d = p.dist(f);
      if (d < p.s.minRange || d > p.s.range || !this.world.lineClear(p.pos.x, p.pos.z, f.pos.x, f.pos.z)) continue;
      const a = Math.abs(angDiff(Math.atan2(f.pos.x - p.pos.x, f.pos.z - p.pos.z), dirAng));
      if (a > 1.2) continue;
      const sc = a * 3 + d * 0.1; if (sc < bs) { bs = sc; best = f; }
    }
    return best;
  }
  archerPick(p, foes) {
    const ok = (f) => { const d = p.dist(f); return d >= p.s.minRange && d <= p.s.range && this.world.lineClear(p.pos.x, p.pos.z, f.pos.x, f.pos.z); };
    const ang = (f) => Math.abs(angDiff(Math.atan2(f.pos.x - p.pos.x, f.pos.z - p.pos.z), p.facing));
    const cur = p.target;
    if (cur && cur.alive && ok(cur) && ang(cur) < 1.1) return cur;
    let best = null, bs = -1e9;
    for (const f of foes) { if (!ok(f)) continue; const s = -ang(f) * 3 - p.dist(f) * 0.12; if (s > bs) { bs = s; best = f; } }
    return best;
  }
  autoTarget(p, foes) {
    let best = null, bs = -1e9;
    for (const f of foes) { const d = p.dist(f); const ang = Math.abs(angDiff(Math.atan2(f.pos.x - p.pos.x, f.pos.z - p.pos.z), p.facing));
      const s = -d - ang * 2; if (s > bs) { bs = s; best = f; } }
    return best;
  }

  // the player fell: continue as a random soldier, or an archer if no soldier is left
  takeOver(dead) {
    dead.setPlayer(false);
    const mine = this.alive(dead.team);
    const pool = mine.filter((x) => x.type === "soldier" || x.type === "archer");   // anyone, at random
    if (!pool.length || SPECTATE || this.muted) return;
    const next = pool[Math.floor(Math.random() * pool.length)];
    this.player = next; next.setPlayer(true); next.order = null; next.target = null;
    this.setupOrders();
    this.popup(next, this.ui.takeOver[next.type], "block");
  }
  setupOrders() {
    const bar = $("orders"); bar.innerHTML = "";
    const isCap = this.player && this.player.type === "captain";
    bar.classList.toggle("hidden", !isCap);
    if (!isCap) return;
    ORDERS.forEach((o, i) => { const b = document.createElement("button"); b.textContent = `${i + 1}. ${this.ui.orders[i]}`; b.onclick = () => this.issueOrder(i); bar.appendChild(b); });
  }
  issueOrder(i) {
    const o = ORDERS[i].key, p = this.player;
    [...$("orders").children].forEach((b, j) => b.classList.toggle("active", j === i));
    this.sfx("horn");
    p.react("rally");
    this.speak("ally", o, { priority: true });
    const map = {
      attack: { stance: "advance", protect: false },
      hold: { stance: "hold", protect: false },
      focus: { stance: "advance", focus: p.target ? p.target.id : null, protect: false },
      fallback: { stance: "fallback", protect: true },
      protect: { stance: "hold", protect: true },
    };
    for (const a of this.alive(p.team)) {
      if (a === p) continue;
      // orders travel by voice: farther units hear later; scared or undisciplined ones may ignore it
      const delay = 0.3 + a.dist(p) * 0.09 + Math.random() * 0.4;
      const obeys = a.morale > 15 && Math.random() < 0.55 + a.trait.discipline * 0.45 + this.diff.obey;
      this.pending.push({ at: this.time + delay, fn: () => { if (!a.alive) return; if (obeys) a.order = { ...map[o] }; else this.bubbleAt(a, "...", 1); } });
    }
  }

  // ---------------------------------------------------------------- loop
  resize() {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
  }
  loop(now) {
    if (!this.running) return;
    if (TEST_SECONDS && now - this.startedAt > TEST_SECONDS * 1000) { this.running = false; console.log("[AIB] test time limit reached, rendering stopped"); return; }
    requestAnimationFrame((t) => this.loop(t));
    const minDt = 1000 / this.q.maxFps;
    if (now - this.last < minDt - 1) return;
    let dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    // hit-stop: the world almost freezes for a split second when the player lands a blow
    if (this.hitStop > 0) { this.hitStop -= dt; dt *= 0.08; }
    this.step(dt);
    this.renderer.render(this.scene, this.camera);
    this.frames++; this.fpsT += dt;
    if (this.fpsT > 1) { $("fps").textContent = `${Math.round(this.frames / this.fpsT)} fps`; this.frames = 0; this.fpsT = 0; }
  }
  step(dt) {
    this.time += dt; this.lastDt = dt;
    const inp = this.input.poll();
    for (const p of this.pending.filter((x) => x.at <= this.time)) p.fn();
    this.pending = this.pending.filter((x) => x.at > this.time);
    // endgame: few units left (or a long lull) -> everyone hunts, nobody flees (see ai.js)
    { const h = this.alive("human").length, k = this.alive("skeleton").length;
      this.endgame = Math.min(h, k) <= 2 || h + k <= 6 || (this.time - this.lastHitTime > 30 && this.time > 40); }
    if (!this.ended) { this.generals.human.update(dt); this.generals.skeleton.update(dt); }
    // alternate the update order every frame so neither side always reacts last
    this.flip = !this.flip;
    for (const u of this.flip ? this.units : [...this.units].reverse()) {
      let desired;
      if (u.isPlayer) desired = this.playerControl(inp);
      else desired = this.ended ? new THREE.Vector3() : u.brain.update(dt, this.generals[u.team]);
      u.update(dt, desired);
    }
    this.updateArrows(dt);
    // camera follow
    const focus = SPECTATE ? this.battleCentre() : this.player.alive ? this.player.pos : (this.alive(this.settings.side)[0] || this.player).pos;
    const want = focus.clone().add(this.camOffset());
    this.camPos.lerp(want, Math.min(1, dt * (SPECTATE ? 4 : 9)));   // locked on the player
    if (this.marker) {
      this.marker.visible = this.player.alive && !SPECTATE;
      this.marker.position.set(this.player.pos.x, 1.6 * this.player.s.scale + Math.sin(this.time * 4) * 0.08, this.player.pos.z);
      this.marker.rotation.y += dt * 2;
    }
    this.camera.position.copy(this.camPos); this.camera.lookAt(this.camPos.clone().sub(this.camOffset()).add(new THREE.Vector3(0, 0.5, 0)));
    if (this.shake > 0) {   // screen shake, decays fast
      this.shake = Math.max(0, this.shake - Math.max(dt, 1 / 60) * 1.2);
      this.camera.position.x += (Math.random() - 0.5) * this.shake; this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.6;
    }
    this.sun.position.set(focus.x + 8, 18, focus.z + 6); this.sun.target.position.copy(focus);
    // target marker
    const t = this.player.target;
    this.targetRing.visible = !!(t && t.alive && this.player.alive);
    if (this.targetRing.visible) this.targetRing.position.set(t.pos.x, 0.03, t.pos.z);
    this.updateHud();
    this.updateBubbles(dt);
    this.situationLines(dt);
  }
  battleCentre() {
    // midpoint of the closest pair of enemies, smoothed
    let best = null, bd = 1e9;
    for (const a of this.alive("human")) for (const b of this.alive("skeleton")) { const d = a.dist(b); if (d < bd) { bd = d; best = [a, b]; } }
    let p;
    if (best && bd < 12) p = new THREE.Vector3((best[0].pos.x + best[1].pos.x) / 2, 0, (best[0].pos.z + best[1].pos.z) / 2);
    else { // armies still apart: follow the front of our own army
      const mine = this.alive(this.settings.side);
      p = mine.length ? mine.reduce((v, u) => v.add(u.pos), new THREE.Vector3()).divideScalar(mine.length) : this.player.pos.clone();
      if (best) p.lerp(best[0].team === this.settings.side ? best[0].pos : best[1].pos, 0.6);
    }
    this.specFocus = this.specFocus ? this.specFocus.lerp(p, 0.05) : p;
    return this.specFocus;
  }
  updateHud() {
    for (const team of ["human", "skeleton"]) {
      const a = this.alive(team);
      $(`count-${team}`).textContent = a.length;
      $(`morale-${team}`).style.width = `${a.length ? a.reduce((s, u) => s + Math.max(0, u.morale), 0) / a.length : 0}%`;
    }
    const s = Math.floor(this.time); $("clock").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    $("general-line").textContent = "";
    this.updateEdgeArrow();
  }
  // when only a few enemies are left, a red arrow at the screen edge points to one of them (always the same one)
  updateEdgeArrow() {
    const el = $("edge-arrow"), foes = this.alive(this.enemyOf(this.settings.side));
    if (!this.player.alive || this.ended || foes.length === 0 || foes.length > 3) { el.classList.add("hidden"); return; }
    if (!this.trackFoe || !this.trackFoe.alive) this.trackFoe = foes.sort((a, b) => this.player.dist(a) - this.player.dist(b))[0];
    const p = this.trackFoe.pos.clone(); p.y = 0.8; p.project(this.camera);
    const sx = (p.x + 1) / 2 * innerWidth, sy = (1 - p.y) / 2 * innerHeight, m = 40;
    const onScreen = p.z < 1 && sx > m && sx < innerWidth - m && sy > m && sy < innerHeight - m;
    if (onScreen) { el.classList.add("hidden"); return; }
    // direction from the screen centre to the enemy (flip if it is behind the camera)
    let dx = sx - innerWidth / 2, dy = sy - innerHeight / 2; if (p.z > 1) { dx = -dx; dy = -dy; }
    const k = Math.min((innerWidth / 2 - m) / Math.abs(dx || 1e-6), (innerHeight / 2 - m) / Math.abs(dy || 1e-6));
    el.style.left = `${innerWidth / 2 + dx * k}px`; el.style.top = `${innerHeight / 2 + dy * k}px`;
    el.style.transform = `translate(-50%, -50%) rotate(${Math.atan2(dy, dx)}rad)`;
    el.classList.remove("hidden");
  }

  // ---------------------------------------------------------------- captains' lines
  // who: "foe" = enemy captain (spoken + bubble), "ally" = player's captain (bubble only)
  speak(who, event, { priority = false, force = false } = {}) {
    if (this.muted || (this.ended && !force)) return false;
    const team = who === "foe" ? this.enemyOf(this.settings.side) : this.settings.side;
    const cap = this.alive(team).find((u) => u.type === "captain");
    if (!cap) return false;
    // the enemy captain should feel like an occasional voice, not a commentator
    const gap = who === "foe" ? 16 : 6, hardGap = who === "foe" ? 6 : 3;
    const since = this.time - this.spoke[who];
    if (!force && (since < hardGap || (!priority && since < gap))) return false;
    const pool = LINES[this.settings.lang]?.[team]?.[who]?.[event];
    if (!pool || !pool.length) return false;
    const key = `${team}.${who}.${event}`, recent = (this.recent[key] ??= []);
    const fresh = pool.filter((l) => !recent.includes(l));
    const text = pick(fresh.length ? fresh : pool);
    recent.push(text); if (recent.length > Math.min(4, pool.length - 1)) recent.shift();
    this.spoke[who] = this.time;
    const secs = 2.2 + text.length * 0.045;
    for (const b of this.bubbles ?? []) if (b.u === cap) b.until = -1;   // replace a bubble the captain still shows
    this.bubbleAt(cap, text, secs);
    if (who === "foe") this.voice(text, team);
    return true;
  }
  voice(text, team) {
    try {
      const el = this.settings.lang === "el";
      // one fixed male voice per language for the whole session: online voices can blink out of the list for a moment
      // (network) - then we must NOT fall back to whatever is first (that was a female voice). Prefer the natural
      // male voices, never a known female one, and keep the first good pick.
      this.voicePick ??= {};
      const key = el ? "el" : "en";
      const voices = speechSynthesis.getVoices();
      // Edge natural voices first, then the male voices other browsers ship (Chrome, macOS / iOS)
      const want = el ? ["Νέστορας", "Nestoras", "Stefanos", "Nikos"]
                      : ["Ryan", "Thomas", "Guy", "Christopher", "Eric", "Google UK English Male", "Daniel", "Arthur", "Oliver", "Alex", "Fred", "David", "Mark"];
      const female = /athina|αθην|zira|aria|jenny|sonia|libby|hazel|susan|emma|michelle|ana|maisie|clara|natasha/i;
      const inLang = voices.filter((x) => x.lang.toLowerCase().startsWith(key) && !female.test(x.name));
      const better = want.map((n) => inLang.find((x) => x.name.includes(n))).find(Boolean);
      const cur = this.voicePick[key];
      // upgrade to a better-ranked voice if it appears (e.g. Νέστορας loads after Stefanos), never downgrade
      const rank = (vv) => vv ? want.findIndex((n) => vv.name.includes(n)) : 99;
      if (better && (!cur || rank(better) < rank(cur))) this.voicePick[key] = better;
      const picked = this.voicePick[key];
      const v = picked ? voices.find((x) => x.name === picked.name) : better;   // the chosen voice blinked out: stay silent, don't switch voice

      if (!v) return;   // no suitable voice right now: the speech bubble still shows, we just stay silent
      const s = new SpeechSynthesisUtterance(text);
      s.lang = el ? "el-GR" : "en-GB"; if (v) s.voice = v;
      s.pitch = team === "skeleton" ? 0.35 : 1.0; s.rate = team === "skeleton" ? 0.9 : 1.02; s.volume = 0.9;
      speechSynthesis.cancel(); speechSynthesis.speak(s);
    } catch {}
  }
  // plan changes of either general -> the matching captain says something
  onPlanChange(team, plan, prev) {
    const ev = plan.flank && !prev.flank && plan.stance === "advance" ? "flank" : plan.stance !== prev.stance ? plan.stance : null;
    if (!ev) return;
    if (team !== this.settings.side) { if (Math.random() < 0.4) this.speak("foe", ev); }
    else if (this.settings.role !== "captain") this.speak("ally", { advance: "attack", hold: "hold", fallback: "fallback", flank: "attack" }[ev]);
  }
  deathLines(u, killer) {
    const mine = this.settings.side;
    if (u.team === mine) {
      if (u.type === "captain") this.speak("foe", "killedYourCaptain", { priority: true });
      else if (Math.random() < 0.18) this.speak("foe", "kill");
      else if (Math.random() < 0.35) this.speak("ally", "allyDown");
    } else {
      if (u.type === "captain") { this.speak("ally", "enemyCaptainDown", { priority: true }); return; }
      if (killer && killer.isPlayer && Math.random() < 0.3) this.speak("foe", "playerKill");
      else if (Math.random() < 0.12) this.speak("foe", "lossAlly");
      else if (Math.random() < 0.2) this.speak("ally", "enemyDown");
    }
  }
  // periodic checks: idle chatter, who is winning, the player walking up to the enemy captain
  situationLines(dt) {
    if (this.ended || this.muted) return;
    this.sitT = (this.sitT || 0) - dt; if (this.sitT > 0) return; this.sitT = 1;
    const mine = this.alive(this.settings.side).length, theirs = this.alive(this.enemyOf(this.settings.side)).length;
    const r = theirs / Math.max(1, mine);
    const again = (k, secs) => this.time - (this.said[k] ?? -999) > secs;
    if (r >= 1.6 && again("gloat", 70) && this.speak("foe", "gloat")) this.said.gloat = this.time;
    if (r <= 0.6 && again("desperate", 70) && this.speak("foe", "desperate")) this.said.desperate = this.time;
    if (r >= 1.6 && again("losing", 30) && this.speak("ally", "losing")) this.said.losing = this.time;
    const cap = this.enemyCaptain();
    if (cap && this.player.alive && this.player.dist(cap) < 4 && again("duel", 60) && this.speak("foe", "duel", { priority: true })) this.said.duel = this.time;
    if (this.time - this.spoke.foe > (this.nextIdle ??= 45 + Math.random() * 30)) { this.nextIdle = 45 + Math.random() * 30; this.speak("foe", "idle"); }
  }

  // ---------------------------------------------------------------- speech bubbles + voice
  bubbleAt(u, text, secs) { if (this.muted) return; (this.bubbles ??= []).push({ u, text, until: this.time + secs, el: null }); }
  say(text, secs) { this.bubbleAt(this.player, text, secs); }
  updateBubbles() {
    const host = $("bubbles");
    for (const b of this.bubbles ?? []) {
      if (!b.el) { b.el = document.createElement("div"); b.el.className = "bubble"; b.el.textContent = b.text; host.appendChild(b.el); }
      const p = b.u.pos.clone(); p.y = 1.6; p.project(this.camera);
      b.el.style.left = `${(p.x + 1) / 2 * innerWidth}px`; b.el.style.top = `${(1 - p.y) / 2 * innerHeight}px`;
      if (this.time > b.until) { b.el.remove(); b.dead = true; }
    }
    if (this.bubbles) this.bubbles = this.bubbles.filter((b) => !b.dead);
  }

  // ---------------------------------------------------------------- sound (tiny synth, no files)
  sfx(type) {
    if (this.muted) return;
    try {
      const ctx = (this.ac ??= new AudioContext()), t = ctx.currentTime, g = ctx.createGain(); g.connect(ctx.destination);
      const noise = (dur, vol, f) => { const b = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate), d = b.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
        const s = ctx.createBufferSource(); s.buffer = b; const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = f;
        s.connect(bp); bp.connect(g); g.gain.setValueAtTime(vol, t); s.start(); };
      const tone = (f0, f1, dur, vol, wave = "sawtooth") => { const o = ctx.createOscillator(); o.type = wave; o.frequency.setValueAtTime(f0, t);
        o.frequency.exponentialRampToValueAtTime(f1, t + dur); o.connect(g); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); o.start(); o.stop(t + dur); };
      if (type === "swing") noise(0.15, 0.08, 1800);
      else if (type === "bigHit") { noise(0.22, 0.26, 700); tone(160, 60, 0.18, 0.08, "square"); }
      else if (type === "hit") noise(0.18, 0.18, 900);
      else if (type === "block") tone(900, 600, 0.12, 0.08, "square");
      else if (type === "bow") tone(220, 60, 0.25, 0.06);
      else if (type === "draw") tone(120, 180, 0.4, 0.02, "triangle");
      else if (type === "arrowhit") noise(0.1, 0.12, 1400);
      else if (type === "death") tone(200, 50, 0.6, 0.06, "triangle");
      else if (type === "horn") tone(180, 200, 0.6, 0.06, "sawtooth");
    } catch {}
  }
}

function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

window.__game = new Game();   // handle for debugging from the console
