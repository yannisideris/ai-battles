import * as THREE from "three";
import { QUALITY, ROSTER, TEAM, STATS, DIFFICULTY, ARMIES, formation } from "./config.js";
import { World } from "./world.js";
import { loadUnitModels } from "./assets.js";
import { Unit, rint, angDiff, HEAVY_CHARGE } from "./unit.js";
import { Input } from "./input.js";
import { General, Brain, ORDERS } from "./ai.js";
import { LINES, UI } from "./lines.js";
import { Campaign } from "./campaign.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
// ?test=20 -> auto-stop rendering after 20 s (safety for unattended checks); ?auto=1 -> start immediately
const TEST_SECONDS = Number(params.get("test")) || 0;
// ?spectate=1 -> the AI also plays your character and the camera follows the fighting (for testing / watching)
const SPECTATE = !!params.get("spectate");
// ?sim=20 -> run 20 battles headless (no rendering, no sound) and report who wins; for balance checks
const SIM = Number(params.get("sim")) || 0;
// ?campsim=10 -> play 10 whole campaigns headless with a simple player (dev: economy / difficulty check)
const CAMPSIM = Number(params.get("campsim")) || 0;
const THEMESIM = Number(params.get("themesim")) || 0;   // dev: each enemy theme vs a typical army of the same worth
// ?gallery=attack -> dev only: every unit model of both sides in two rows on an empty field, looping that clip
// (&team=human|skeleton for one row up close)
const GALLERY = params.get("gallery");
// dev only: ?terrain=hills (&hills=1|2) puts a skirmish / sim on a campaign battlefield
const DEV_TERRAIN = params.get("terrain"), DEV_HILLS = params.get("hills") != null ? Number(params.get("hills")) : undefined;
const GALLERY_TYPES = ["captain", "captain_ranged", "captain_heavy", "soldier", "spearman", "brute", "shieldbearer", "scout", "monster", "archer", "mage", "support"];

class Game {
  constructor() {
    this.canvas = $("view");
    this.input = new Input();
    this.settings = { side: "human", role: "captain", lang: "el", quality: "medium", difficulty: "normal", army: "classic", captain: "captain", budget: "random" };
    for (const k of ["side", "role", "quality", "lang", "difficulty", "army", "captain"]) if (params.get(k)) this.settings[k] = params.get(k);   // e.g. ?role=soldier for quick tests
    this.running = false;
    try { speechSynthesis.getVoices(); speechSynthesis.addEventListener("voiceschanged", () => speechSynthesis.getVoices()); } catch {}   // start loading the voice list early
    this.setupMenu();
    this.campaign = new Campaign(this);
    $("campaign").onclick = () => this.campaign.openMenu();
  }

  setupMenu() {
    for (const b of document.querySelectorAll("#menu button[data-side],#menu button[data-lang],#menu button[data-difficulty],#menu button[data-army],#menu button[data-captain],#menu button[data-budget]")) {
      const k = Object.keys(b.dataset)[0];
      b.onclick = () => {
        document.querySelectorAll(`#menu button[data-${k}]`).forEach((x) => x.classList.remove("sel"));
        b.classList.add("sel"); this.settings[k] = b.dataset[k];
        if (k === "side") this.captainLabels();
      };
      if (b.dataset[Object.keys(b.dataset)[0]] === this.settings[Object.keys(b.dataset)[0]]) {
        document.querySelectorAll(`#menu button[data-${Object.keys(b.dataset)[0]}]`).forEach((x) => x.classList.remove("sel")); b.classList.add("sel");
      }
    }
    this.captainLabels();
    $("start").onclick = () => this.campaign.skirmishShop();
    $("again").onclick = () => { $("end").classList.add("hidden"); $("menu").classList.remove("hidden"); };
    $("replay").onclick = () => {
      if (!this.lastSkirmish) return;
      $("end").classList.add("hidden"); this.campaignBattle = JSON.parse(JSON.stringify(this.lastSkirmish)); this.settings.role = "captain"; this.start();
    };
    if (params.get("auto")) setTimeout(() => this.start(), 50);
    this.menuPad();
  }

  // the captain choice names the side's own captains
  captainLabels() {
    const names = this.settings.side === "skeleton" ? ["Skeleton", "Lich", "Death Knight"] : ["Knight", "Ranger", "Paladin"];
    document.querySelectorAll("#menu button[data-captain]").forEach((b, i) => { b.textContent = names[i]; });
  }
  // gamepad (and arrow keys) on the menus: up/down picks a row, left/right picks the option, A / Start / Enter confirms
  menuPad() {
    const rows = [...document.querySelectorAll("#menu .row")];
    let row = 0, prev = {}, held = 0;
    const mark = () => {
      rows.forEach((r, i) => r.classList.toggle("rowfocus", i === row));
      $("start").classList.toggle("padfocus", row === rows.length);
      $("campaign").classList.toggle("padfocus", row === rows.length + 1);
    };
    const move = (dr, dc) => {
      document.body.classList.add("padnav");
      if (dr) { row = (row + dr + rows.length + 2) % (rows.length + 2); mark(); }
      if (dc && row < rows.length) {
        const bs = [...rows[row].querySelectorAll("button")], i = bs.findIndex((b) => b.classList.contains("sel"));
        bs[Math.max(0, Math.min(bs.length - 1, i + dc))].click();
      }
    };
    addEventListener("mousemove", () => document.body.classList.remove("padnav"));
    const confirm = () => {
      document.body.classList.add("padnav");
      if (!$("end").classList.contains("hidden")) $("again").click();
      else if (!$("menu").classList.contains("hidden")) { if (row === rows.length) $("start").click(); else if (row === rows.length + 1) $("campaign").click(); else { row = rows.length; mark(); } }
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
    // nothing said in the last battle carries over (bubbles are timed on the battle clock, which starts again at 0)
    for (const b of this.bubbles ?? []) b.el?.remove();
    this.bubbles = []; try { speechSynthesis.cancel(); } catch {}
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
    this.world = new World(this.scene, this.q, this.campaignBattle?.seed, GALLERY ? "empty" : this.campaignBattle?.terrain ?? DEV_TERRAIN ?? undefined, { hills: this.campaignBattle?.hills ?? DEV_HILLS, castle: this.campaignBattle?.castleSide });
    // a battlefield's own light (the graveyard at dusk)
    const mood = this.world.mood;
    if (mood) {
      this.scene.background.setHex(mood.sky); this.scene.fog.color.setHex(mood.fog);
      this.sun.color.setHex(mood.sun); this.sun.intensity = mood.sunI;
      this.scene.children.find((c) => c.isHemisphereLight)?.intensity !== undefined && (this.scene.children.find((c) => c.isHemisphereLight).intensity = mood.hemi);
    }
    this.armySpec = this.campaignBattle ? this.campaignBattle.armies : this.skirmishArmies();
    if (GALLERY) { const all = GALLERY_TYPES.map((type) => ({ type })); this.armySpec = { human: all, skeleton: all }; }
    await loadUnitModels(this.q, Object.entries(this.armySpec).flatMap(([team, list]) => list.map((e) => [team, e.type])));
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
    this.input.pressed.clear(); this.paused = false; this.orderMenu = null; $("paused").classList.add("hidden");
    this.startedAt = performance.now();
    if (SIM) { this.runSims(SIM); return; }
    if (CAMPSIM) { this.muted = true; this.running = false; this.player.setPlayer(false); this.campaign.simulate(CAMPSIM); return; }
    if (THEMESIM) { this.muted = true; this.running = false; this.player.setPlayer(false); this.campaign.themeSim(THEMESIM); return; }
    if (GALLERY) { this.gallery(GALLERY); return; }
    this.speak("foe", "start", { priority: true });
    this.pending.push({ at: 3.2, fn: () => this.speak("ally", "start", { priority: true }) });
    requestAnimationFrame((t) => this.loop(t));
  }

  // dev: all models in rows, looping one clip (falls back to idle where a model lacks it)
  gallery(clip) {
    this.muted = true; $("orders").classList.add("hidden");
    const only = params.get("team"), n = GALLERY_TYPES.length;
    for (const u of this.units) {
      const k = GALLERY_TYPES.indexOf(u.type), row = u.team === "human" ? 0 : 1;
      u.root.visible = !only || only === u.team;
      // one team: two rows of six (fits a narrow window); both teams: one long row each
      if (only) u.pos.set(((k % 6) - 2.5) * 1.3, 0, k < 6 ? -1.3 : 1.3); else u.pos.set((k - (n - 1) / 2) * 1.5, 0, row ? -1.4 : 1.4);
      u.facing = 0;
      u.root.position.copy(u.pos); u.root.rotation.y = 0.5; u.hpBar.visible = false; u.ring.visible = false;
      const a = u.actions[clip] || u.actions.idle;
      for (const o of Object.values(u.actions)) o.stop();
      a.reset(); a.setLoop(THREE.LoopRepeat, Infinity); a.clampWhenFinished = false; a.play();
    }
    const half = params.get("half");   // &half=0|1: only the first / second six types, closer
    if (half != null) for (const u of this.units) { const k = GALLERY_TYPES.indexOf(u.type); if ((k < 6) !== (half === "0")) u.root.visible = false; else u.root.position.x = u.pos.x = ((k % 6) - 2.5) * 1.5; }
    const far = half != null ? 0.5 : 1;
    if (only) this.camera.position.set(0, 4.5, 9 + 6 * Math.max(0, 1.2 - innerWidth / innerHeight));
    else this.camera.position.set(0, 6 * far + 1, 18 * far); this.camera.lookAt(0, 0.6, 0);
    this.marker.visible = false; this.targetRing.visible = false;
    $("general-line").textContent = `gallery: ${clip}`;
    const loop = (now) => {
      if (TEST_SECONDS && now - this.startedAt > TEST_SECONDS * 1000) return;
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
      for (const u of this.units) u.mixer.update(dt);
      this.renderer.render(this.scene, this.camera);
    };
    requestAnimationFrame(loop);
  }
  // headless balance check: AI vs AI, fixed 20 Hz steps, nothing drawn
  // one campaign battle, headless (for ?campsim): returns { won, alive (roster ids), time }
  async runCampaignBattle(cb) {
    this.campaignBattle = cb; this.armySpec = cb.armies;
    for (const c of [...this.scene.children]) if (c !== this.sun && c !== this.sun.target && !c.isLight) this.scene.remove(c);
    this.world = new World(this.scene, this.q, undefined, cb.terrain, { hills: cb.hills, castle: cb.castleSide });
    await loadUnitModels(this.q, Object.entries(cb.armies).flatMap(([team, list]) => list.map((e) => [team, e.type])));
    this.spawnArmies(); this.arrows = []; this.time = 0; this.pending = []; this.ended = false; this.lastHitTime = 0; this.winner = null; this.lastKillerTeam = null;
    this.generals = { human: new General(this, "human"), skeleton: new General(this, "skeleton") };
    this.player.setPlayer(false);
    for (let i = 0; !this.ended && this.time < 1500; i++) { this.step(0.05); if (i % 400 === 399) await new Promise((r) => setTimeout(r, 0)); }
    const won = this.ended && this.winner === this.settings.side;
    const alive = this.alive(this.settings.side).map((u) => u.entry?.id).filter((x) => x != null);
    this.campaignBattle = null;
    return { won, alive, time: this.time };
  }
  async runSims(n) {
    this.muted = true; this.running = false;
    const res = { human: 0, skeleton: 0, unfinished: 0 }, details = [];
    const blank = () => ({ meleeHits: 0, meleeDmg: 0, rangedHits: 0, rangedDmg: 0, blocked: 0, bashDmg: 0, shots: 0 });
    this.stats = { human: blank(), skeleton: blank() };
    for (let i = 0; i < n; i++) {
      if (i > 0) {
        for (const c of [...this.scene.children]) if (c !== this.sun && c !== this.sun.target && !c.isLight) this.scene.remove(c);
        this.world = new World(this.scene, this.q, undefined, DEV_TERRAIN ?? undefined, { hills: DEV_HILLS });
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

  // skirmish line-up: "classic" = the v1.0 armies (unchanged); "mixed" = every role. The player picks their captain,
  // the enemy captain is random in a mixed battle.
  skirmishArmies() {
    const out = {};
    for (const team of ["human", "skeleton"]) {
      const mine = team === this.settings.side;
      let types;
      if (this.settings.army === "mixed") {
        types = [...ARMIES.mixed];
        types[0] = mine ? this.settings.captain : pick(["captain", "captain_ranged", "captain_heavy"]);
      } else {
        types = ROSTER.map((r) => r[0]);
        if (mine && this.settings.captain !== "captain") types[0] = this.settings.captain;
      }
      out[team] = types.map((type) => ({ type }));
    }
    return out;
  }
  spawnArmies() {
    if (this.units) for (const u of this.units) this.scene.remove(u.root);
    this.units = [];
    const spec = this.armySpec;
    for (const team of ["human", "skeleton"]) {
      const dir = Math.sign(TEAM[team].spawnZ);
      const list = spec[team], types = list.map((e) => e.type);
      // the classic army keeps its exact v1.0 spawn spots
      const classic = types.length === ROSTER.length && types.every((t, i) => t === ROSTER[i][0] || (i === 0 && STATS[t].captain));
      const spots = classic ? ROSTER.map((r, i) => [types[i], r[1], r[2]]) : formation(types);
      const used = new Set();
      for (const [type, x, dz] of spots) {
        const i = list.findIndex((e, j) => e.type === type && !used.has(j)); used.add(i);
        const e = list[i] || { type };
        const sp = this.campaignBattle?.spawn?.[team];
        // campaign spawn override: the line runs across the facing direction, dz = distance behind the front
        const sx = sp ? sp.x + x * Math.cos(sp.facing) - dz * Math.sin(sp.facing) : x;
        const sz = sp ? sp.z - x * Math.sin(sp.facing) - dz * Math.cos(sp.facing) : TEAM[team].spawnZ + dir * dz;
        const u = new Unit(this, team, type, sx + (Math.random() - 0.5) * 0.4, sz);
        if (sp) u.facing = sp.facing;
        if (e.vet) { u.vet = e.vet; u.maxHp = u.hp = Math.round(u.s.hp * (1 + 0.1 * e.vet)); u.dmgMul = 1 + 0.08 * e.vet; u.morale = 100; u.trait.bravery += 0.15 * e.vet; }
        if (e.hpMul) { u.maxHp = u.hp = Math.round(u.maxHp * e.hpMul); }
        u.entry = e;      // campaign: links the unit back to the army roster
        u.brain = new Brain(u);
        this.units.push(u);
      }
    }
    for (const u of this.units) if (u.team !== this.settings.side) { u.maxHp = u.hp = Math.round(u.maxHp * this.diff.hp); }
    const side = this.settings.side, all = this.units.filter((u) => u.team === side);
    if (this.campaignBattle) this.player = all.find((u) => u.entry?.lead);   // the leader you picked in the camp
    else {
      const role = this.settings.role === "captain" ? (u) => u.captain : (u) => u.type === this.settings.role;
      const mine = all.filter(role);
      this.player = mine[Math.floor(mine.length / 2)];
    }
    if (!this.player) {   // no captain in your army: you fight on as one of the others (random kind first)
      const kinds = [...new Set(all.map((u) => u.type))], kind = kinds[Math.floor(Math.random() * kinds.length)];
      const pool = all.filter((u) => u.type === kind); this.player = pool[Math.floor(Math.random() * pool.length)];
    }
    // one commander per side (gives orders, the big morale aura); any other captains are heroes
    for (const team of ["human", "skeleton"]) {
      const caps = this.units.filter((u) => u.team === team && u.captain);
      const cmd = team === side && this.player.captain ? this.player : caps[0];
      if (cmd) cmd.commander = true;
    }
    this.player.setPlayer(!SPECTATE);
  }

  // ---------------------------------------------------------------- helpers used by units / AI
  alive(team) { return this.units.filter((u) => u.alive && u.team === team); }
  enemyOf(team) { return team === "human" ? "skeleton" : "human"; }
  spawnZ(team) { return TEAM[team].spawnZ; }
  enemyCaptain() { return this.units.find((u) => u.team !== this.settings.side && u.captain && u.alive); }

  applyHit(att, t, dmg, ranged = false) {
    // archers wear no armour and carry no shield: a sword that reaches them hurts a lot more
    if (!ranged && t.soft && !att.ranged) dmg = Math.round(dmg * 1.75);
    if (att.dmgMul !== 1) dmg = Math.round(dmg * att.dmgMul);   // veterans
    // high ground: a blow struck from clearly higher up (charging down a slope) lands harder
    if (!ranged && (att.groundY || 0) - (t.groundY || 0) > 0.4) dmg = Math.round(dmg * 1.15);
    if (att.team !== this.settings.side) dmg = Math.max(1, Math.round(dmg * this.diff.dmg));   // difficulty
    this.lastHitTime = this.time;
    const killed = t.alive && t.hp <= dmg;
    const dealt = t.takeHit(att, dmg, ranged);
    if (this.stats) {   // balance diagnostics (sim mode only)
      const st = this.stats[att.team];
      st[ranged ? "rangedHits" : "meleeHits"]++; st[ranged ? "rangedDmg" : "meleeDmg"] += dealt;
      if (!dealt && !ranged) st.blocked++;
      if (att.ranged && !ranged) st.bashDmg += dealt;
    }
    if (dealt) this.sfx(ranged ? "arrowhit" : att.isPlayer ? "bigHit" : "hit");
    // arcade feedback when the player is involved (purely visual, the numbers don't change)
    if (dealt && att.isPlayer) {
      this.popup(t, killed ? `KO!` : `${dealt}`, killed ? "ko" : "dealt");
      this.hitStop = killed || att.heavyHit ? 0.12 : 0.06; this.shake = Math.max(this.shake || 0, killed || att.heavyHit ? 0.24 : 0.12);
    }
    if (dealt && t.isPlayer) { this.popup(t, `-${dealt}`, "taken"); this.shake = Math.max(this.shake || 0, 0.18); }
    // the enemy captain complains when badly hurt (once at half, once near death)
    if (dealt && t.alive && t.captain && t.team !== this.settings.side) {
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
    const p = u.pos.clone(); p.y = (u.groundY || 0) + 1.35 * u.s.scale; p.project(this.camera);
    const el = document.createElement("div"); el.className = `pop ${kind}`; el.textContent = text;
    el.style.left = `${(p.x + 1) / 2 * innerWidth + (Math.random() - 0.5) * 24}px`; el.style.top = `${(1 - p.y) / 2 * innerHeight}px`;
    $("bubbles").appendChild(el); setTimeout(() => el.remove(), 900);
  }
  onDeath(u, killer) {
    this.sfx("death");
    if (killer) this.lastKillerTeam = killer.team;
    this.deathLines(u, killer);
    for (const a of this.alive(u.team)) if (a.dist(u) < 7) a.morale -= 12 / a.trait.bravery;
    if (u.captain) {   // the commander's fall shakes everyone; a hero's less
      const big = u.commander;
      for (const a of this.alive(u.team)) a.morale -= big ? 35 : 15;
      for (const a of this.alive(this.enemyOf(u.team))) a.morale = Math.min(100, a.morale + (big ? 25 : 10));
      if (big) {
        u.commander = false;
        // an AI side: the next captain takes command (the player's side: see takeOver)
        if (!u.isPlayer) { const next = this.alive(u.team).find((a) => a.captain); if (next) next.commander = true; }
      }
    }
    if (u.isPlayer) this.takeOver(u);
    this.checkEnd();
  }
  checkEnd() {
    // last side standing wins; no draws, no early "rout" ending
    for (const team of ["human", "skeleton"]) {
      const a = this.alive(team);
      if (!a.length) {
        if (this.ended) return;
        // both sides wiped out in the same moment: whoever struck the last blow wins
        const loser = this.alive(this.enemyOf(team)).length ? team : this.enemyOf(this.lastKillerTeam || this.enemyOf(team));
        this.endBattle(this.enemyOf(loser)); return;
      }
    }
  }
  endBattle(winner) {
    if (this.ended) return;
    const won = winner === this.settings.side, routed = false;
    this.winner = winner;
    if (won) { this.speak("ally", "win", { priority: true, force: true }); this.speak("foe", "lose", { priority: true, force: true }); }
    else this.speak("foe", "win", { priority: true, force: true });
    // winners jump for joy for a few seconds before the result screen
    for (const u of this.alive(this.winner)) { u.celebrating = true; u.play(u.variant("cheer2", "cheer"), 0.2, 0.9 + Math.random() * 0.25); }
    // the defenders who held out: the enemy stops where it is
    if (won && this.campaignBattle?.kind === "defend") for (const u of this.alive(this.enemyOf(winner))) { u.target = null; }
    setTimeout(() => this.finish(won, routed), this.muted ? 0 : 3000);
    this.ended = true;
  }
  finish(won, routed) {
    if (!this.running) return;
    this.running = false;
    this.renderer.render(this.scene, this.camera);
    if (this.campaignBattle && this.campaignBattle.kind !== "skirmish") {
      const alive = this.alive(this.settings.side).map((u) => u.entry?.id).filter((x) => x != null);
      this.campaign.afterBattle(won, { alive, time: this.time });
      return;
    }
    $("end-title").textContent = won ? this.ui.victory : this.ui.defeat;
    $("again").textContent = this.settings.lang === "el" ? "Ξανά" : "Again";
    // "Battle!": the same battle again (same armies, same battlefield)
    this.lastSkirmish = this.campaignBattle?.kind === "skirmish" ? JSON.parse(JSON.stringify(this.campaignBattle)) : null;
    $("replay").textContent = this.settings.lang === "el" ? "Ξανά η ίδια μάχη" : "Replay battle";
    $("replay").classList.toggle("hidden", !this.lastSkirmish);
    $("end-sub").textContent = won ? (routed ? this.ui.enemyRouted : this.ui.enemyWiped) : (routed ? this.ui.youRouted : this.ui.youWiped);
    $("end").classList.remove("hidden");
  }

  // monster slam: everyone (both sides) close to the point of impact is thrown back and stunned; enemies are hurt
  slam(att, t) {
    const cx = att.pos.x + Math.sin(att.facing) * 1.0, cz = att.pos.z + Math.cos(att.facing) * 1.0;
    this.pulse(cx, cz, att.s.slam, 0xd8c8a0, 0.4); this.shake = Math.max(this.shake || 0, 0.15);
    for (const u of this.units) {
      if (!u.alive || u === att || u.type === "monster") continue;
      const d = Math.hypot(u.pos.x - cx, u.pos.z - cz); if (d > att.s.slam + u.radius) continue;
      if (u.team !== att.team && u !== t) this.applyHit(att, u, Math.round(rint(att.s.dmg) * 0.45));
      if (u.team !== att.team || d < 0.8) u.knockBack(att.pos.x, att.pos.z, att.s.knock * (u.team === att.team ? 0.4 : 1) * (1 - 0.4 * d / att.s.slam));
    }
  }
  // cleric: heals and steadies the wounded around him · necromancer: raises a fallen comrade nearby
  supportAbility(u) {
    const s = u.s, allies = this.alive(u.team);
    if (u.team === "human") {
      const hurt = allies.filter((a) => a !== u && a.dist(u) < s.auraR && a.hp < a.maxHp * 0.9);
      if (!hurt.length && u.hp >= u.maxHp * 0.9) { u.abilityCd = 1; return; }
      u.play(u.actions.heal ? "heal" : "cheer", 0.12); this.sfx("heal"); this.pulse(u.pos.x, u.pos.z, s.auraR, 0xffe27a, 0.7, u.actions.heal ? 0.75 : 0);   // (staff planted at 0.8 s)
      for (const a of [...hurt, u]) { const h = Math.min(a.maxHp - a.hp, s.heal); a.hp += h; a.morale = Math.min(100, a.morale + 10); if (this.stats) this.stats[u.team].healed = (this.stats[u.team].healed || 0) + h; }
      u.abilityCd = s.ability;
    } else {
      const dead = this.units.filter((d) => !d.alive && d.team === u.team && !d.captain && d.type !== "monster" && !d.raised && (d.deadT ?? 0) < 12 && d.dist(u) < s.auraR + 1.5)
        .sort((a, b) => a.dist(u) - b.dist(u))[0];
      if (!dead) { u.abilityCd = 1; return; }
      u.play(u.actions.raise ? "raise" : "cheer", 0.12); this.sfx("raise"); this.pulse(dead.pos.x, dead.pos.z, 1.4, 0x9dff5a, 0.8, u.actions.raise ? 0.5 : 0);   // (as the hand comes up)
      dead.revive(s.raiseHp); u.abilityCd = s.raiseEvery;
      if (this.stats) this.stats[u.team].raised = (this.stats[u.team].raised || 0) + 1;
    }
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
  // a glowing ball of fire (humans) / green fire (skeletons)
  orbModel(team, big) {
    const col = team === "human" ? 0xff7a1a : 0x5dff6a;
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.SphereGeometry(big ? 0.2 : 0.13, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff3c0 })));
    g.add(new THREE.Mesh(new THREE.SphereGeometry(big ? 0.32 : 0.2, 10, 8), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55, depthWrite: false })));
    return g;
  }
  // a short flash on the ground: an expanding ring (blast, heal, raise)
  pulse(x, z, r, color, dur = 0.5, delay = 0) {   // delay: wait for the moment in the animation
    if (this.muted) return;
    const m = new THREE.Mesh(new THREE.RingGeometry(0.75, 1, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, this.world.height(x, z) + 0.06, z); this.scene.add(m);
    m.visible = delay <= 0; (this.fx ??= []).push({ m, t: -delay, dur, r });
  }
  updateFx(dt) {
    for (const f of this.fx ?? []) {
      f.t += dt; if (f.t < 0) continue; f.m.visible = true; const k = Math.min(1, f.t / f.dur);
      f.m.scale.setScalar(0.2 + f.r * (0.2 + 0.8 * Math.sqrt(k))); f.m.material.opacity = 0.85 * (1 - k);
      if (k >= 1) { this.scene.remove(f.m); f.m.geometry.dispose(); f.m.material.dispose(); f.dead = true; }
    }
    if (this.fx) this.fx = this.fx.filter((f) => !f.dead);
  }
  fireArrow(from, to) {
    if (this.stats) this.stats[from.team].shots++;
    const magic = from.ranged === "magic" || (from.captain && from.team === "skeleton");   // the lich throws green fire
    const lead = magic ? 0 : Math.min(0.6, from.dist(to) / 13);
    // a spell lands where it was aimed when the cast started (slow: a quick unit can step out of it)
    const aim = from.ranged === "magic" && from.target0 ? from.target0 : to.pos;
    const tx = aim.x + to.vel.x * lead, tz = aim.z + to.vel.z * lead;
    const mesh = magic ? this.orbModel(from.team, from.ranged === "magic") : this.arrowModel(from.team);
    this.scene.add(mesh);
    // faint white streak behind the arrow so it reads at game distance
    const trailGeo = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 8 }, () => from.pos.clone().setY((from.groundY || 0) + 0.9)));
    const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0xfff8e8, transparent: true, opacity: 0.25 }));
    this.scene.add(trail);
    const d = Math.hypot(tx - from.pos.x, tz - from.pos.z);
    const speed = from.ranged === "magic" ? 7.5 : magic ? 10 : 12;
    this.arrows.push({ mesh, trail, hist: [], from, to, sx: from.pos.x, sz: from.pos.z, tx, tz, t: 0, dur: d / speed + 0.08, h: (magic ? 0.4 : 0.6) + d * (from.ranged === "magic" ? 0.16 : 0.09), d, stuck: 0,
      blast: from.ranged === "magic" ? from.s.splash : 0, magic });
    this.sfx(magic ? "magic" : "bow");
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
      const k = Math.min(1, a.t), x = a.sx + (a.tx - a.sx) * k, z = a.sz + (a.tz - a.sz) * k;
      a.h0 ??= this.world.height(a.sx, a.sz); a.h1 ??= this.world.height(a.tx, a.tz);
      const y = a.h0 + (a.h1 - a.h0) * k + 0.9 + Math.sin(k * Math.PI) * a.h - k * 0.35;
      const prev = a.mesh.position.clone();
      a.mesh.position.set(x, y, z);
      if (a.t > dt / a.dur) a.mesh.lookAt(prev.lerp(a.mesh.position, 2));
      a.hist.unshift(a.mesh.position.clone()); if (a.hist.length > 8) a.hist.pop();
      const pos = a.trail.geometry.attributes.position;
      for (let i = 0; i < 8; i++) { const p = a.hist[Math.min(i, a.hist.length - 1)]; pos.setXYZ(i, p.x, p.y, p.z); }
      pos.needsUpdate = true;
      if (k < 0.97 && !a.blast && this.world.blocksArrow(x, z) && y - this.world.height(x, z) < 2.4) { this.scene.remove(a.mesh, a.trail); a.trail.geometry.dispose(); a.dead = true; continue; }   // hit a wall / tree: gone
      if (k >= 1 && a.blast) {   // the mage's blast: hurts every enemy around the point it lands on (less at the edge)
        this.pulse(x, z, a.blast, a.from.team === "human" ? 0xff8a2a : 0x6dff6a, 0.45); this.sfx("blast");
        for (const f of this.alive(this.enemyOf(a.from.team))) {
          const fd = Math.hypot(f.pos.x - x, f.pos.z - z); if (fd > a.blast + f.radius) continue;
          this.applyHit(a.from, f, Math.max(1, Math.round(rint(a.from.s.dmg) * (1 - 0.5 * Math.min(1, fd / a.blast)))), true);
        }
        this.scene.remove(a.mesh, a.trail); a.trail.geometry.dispose(); a.dead = true; continue;
      }
      if (k >= 1) {
        const t = a.to;
        if (t.alive && Math.hypot(t.pos.x - x, t.pos.z - z) < 0.55) {
          const st = a.from.s.ranged ? a.from.s : STATS.archer;
          let dmg = rint(st.dmg); if (a.d > (st.longShot ?? 99)) dmg = Math.max(1, dmg - 2);
          if (a.magic) this.pulse(x, z, 0.6, 0x6dff6a, 0.3);
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
    // pause (Esc closes an open order menu first)
    // captain's order menu: Enter / RB opens, left-right picks, Enter / A confirms, Esc / B / RB closes
    if (p.captain) {
      const bar = [...$("orders").children];
      const mark = () => bar.forEach((b, j) => b.classList.toggle("focus", !!this.orderMenu && j === this.orderMenu.sel));
      if (!this.orderMenu && inp.menuOpen) {
        this.orderMenu = { sel: Math.max(0, bar.findIndex((b) => b.classList.contains("active"))) }; mark();
        return v;
      }
      if (this.orderMenu) {
        const n = bar.length;
        if (inp.menuLeft) this.orderMenu.sel = (this.orderMenu.sel + n - 1) % n;
        if (inp.menuRight) this.orderMenu.sel = (this.orderMenu.sel + 1) % n;
        if (inp.menuConfirm || inp.menuA) { const i = this.orderMenu.sel; this.orderMenu = null; mark(); this.issueOrder(i); }
        else if (inp.menuCancel || inp.menuOpen) { this.orderMenu = null; mark(); }
        else mark();
        this.holdT = 0; this.attackBuffer = 0;
        return v;   // standing still while choosing (the arrows / stick are busy picking)
      }
    } else this.orderMenu = null;
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
    if (p.ranged) { const t = this.archerPick(p, foes); if (t) p.target = t; }
    if (inp.click) {
      const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(inp.click.x / innerWidth * 2 - 1, -(inp.click.y / innerHeight) * 2 + 1);
      ray.setFromCamera(ndc, this.camera);
      const hit = ray.intersectObject(this.world.ground)[0];
      if (hit) { let best = null, bd = 1.4; for (const f of foes) { const d = Math.hypot(f.pos.x - hit.point.x, f.pos.z - hit.point.z); if (d < bd) { bd = d; best = f; } }
        if (best) { p.target = best; if (inp.click.button === 0) inp.attack = true; } }
    }
    // heavy blow (melee): keep the attack button held after a swing -> the sword goes up and is held (charging);
    // release once it is ready (~0.45 s, a click tells you) -> a heavy, shield-breaking blow. Release early -> nothing.
    if (!p.ranged) {
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
              p.aimTurn = tgt ? Math.abs(angDiff(Math.atan2(tgt.pos.x - p.pos.x, tgt.pos.z - p.pos.z), p.facing)) : 0;
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
            const hb = aimBest(); p.aimTurn = hb ? Math.abs(angDiff(Math.atan2(hb.pos.x - p.pos.x, hb.pos.z - p.pos.z), p.facing)) : 0;
            p.releaseHeavy(hb); this.chargeFromTap = false; p.pendingLunge = null;
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
      // archer: someone breathing down your neck (too close to shoot) -> turn round and smack him with the bow
      if (p.ranged) {
        const close = foes.filter((f) => p.dist(f) <= p.bashReach(f)).sort((a, b) => p.dist(a) - p.dist(b))[0];
        if (close) { t = close; p.target = close; }
      }
      if (!p.ranged) {
        // aim assist: the closest enemy roughly in front of you within a short step
        let best = null, bs = -1e9;
        for (const f of foes) {
          const d = p.dist(f); if (d > p.meleeReach(f) + 1.3) continue;
          const ang = Math.abs(angDiff(Math.atan2(f.pos.x - p.pos.x, f.pos.z - p.pos.z), p.facing));
          const s = -d - ang * 0.9 + (f === p.target ? 0.6 : 0); if (s > bs) { bs = s; best = f; }
        }
        if (best) { t = best; p.target = best; }
        // how well were YOU facing him when you pressed (before the auto-turn) -> slightly better / worse blow
        p.aimTurn = t ? Math.abs(angDiff(Math.atan2(t.pos.x - p.pos.x, t.pos.z - p.pos.z), p.facing)) : 0;
        // turn towards a target just out of reach (no step-in: out of reach is out of reach)
        if (t && p.dist(t) < p.meleeReach(t) + 1.3) p.faceTo(t.pos.x, t.pos.z, true);
      }
      // archer: fire while holding a direction -> shoot the enemy that way (takes priority). Nobody that way
      // (e.g. you are running away and they are behind you) -> the automatic pick, as before.
      if (p.ranged && Math.hypot(inp.mx, inp.mz) > 0.3) { const aimed = this.archerAim(p, foes, inp.mx, -inp.mz); if (aimed) { t = aimed; p.target = aimed; } }
      const started = p.startAttack(t); p.reachBonus = 0;
      if (started) this.attackBuffer = 0;
      else if (!p.ranged && this.time - (p.lastSwingT ?? -9) > 1.0) { p.freshWhiff(); this.attackBuffer = 0; }   // nothing in reach: same smooth rise (it may become a heavy blow)
      else if (!p.ranged) {   // whiff: swing at the air anyway, it should never feel unresponsive
        p.play(p.variant("attack", "attack2", "attack2", "attack3"), 0.06, 1.15); p.cooldown = 0.5; this.sfx("swing"); this.attackBuffer = 0;
      } else if (inp.attack && t) this.say(!this.world.lineClear(p.pos.x, p.pos.z, t.pos.x, t.pos.z) ? this.ui.noLos : p.dist(t) < p.s.minRange ? this.ui.tooClose : this.ui.outOfRange, 1.2);
    }
    return v;
  }
  // archer auto-aim: the enemy you are facing that is in range with a clear shot; keep the current one while it stays valid
  // the enemy in the held direction that the archer can actually hit; null if none.
  // Works the way it LOOKS on screen: directions are measured in screen space (the camera looks down at an
  // angle, so distances "up" the screen are foreshortened), and a direction means the whole side of the screen
  // (+-85 deg) - "left" also catches an enemy up-left or down-left - preferring whoever is closer to that
  // direction and closer to you.
  archerAim(p, foes, sx, sy) {
    const fwd = new THREE.Vector3(); this.camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
    const right = { x: -fwd.z, z: fwd.x }, tilt = 0.79;   // ~sin(camera pitch): on-screen squash of "up"
    const want = Math.atan2(sx, sy);
    let best = null, bs = 1e9;
    for (const f of foes) {
      const d = p.dist(f);
      if (d < p.s.minRange || d > p.s.range || !this.world.lineClear(p.pos.x, p.pos.z, f.pos.x, f.pos.z)) continue;
      const dx = f.pos.x - p.pos.x, dz = f.pos.z - p.pos.z;
      const ex = dx * right.x + dz * right.z, ey = (dx * fwd.x + dz * fwd.z) * tilt;   // enemy offset as seen on screen
      const a = Math.abs(angDiff(Math.atan2(ex, ey), want));
      if (a > 1.48) continue;
      const sc = a * 1.0 + d * 0.3; if (sc < bs) { bs = sc; best = f; }   // ~1 rad of angle = ~3 m of distance
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
    // another captain (hero) first: he becomes the commander, orders and all.
    // Otherwise random by KIND of unit, then one of that kind: a lone golem is as likely as the whole archer line
    const kinds = [...new Set(mine.map((x) => x.type))];
    if (!kinds.length || SPECTATE || this.muted) return;
    const caps = mine.filter((x) => x.captain);
    let next;
    if (caps.length) { next = caps[Math.floor(Math.random() * caps.length)]; for (const x of mine) x.commander = false; next.commander = true; }
    else {
      const kind = kinds[Math.floor(Math.random() * kinds.length)], pool = mine.filter((x) => x.type === kind);
      next = pool[Math.floor(Math.random() * pool.length)];
    }
    this.player = next; next.setPlayer(true); next.order = null; next.target = null;
    this.setupOrders();
    this.popup(next, this.ui.takeOver[next.type === "support" ? `support_${next.team}` : next.type] || this.ui.takeOver[next.ranged ? "archer" : "soldier"], "block");
  }
  setupOrders() {
    const bar = $("orders"); bar.innerHTML = "";
    const isCap = this.player && this.player.captain;
    bar.classList.toggle("hidden", !isCap);
    if (!isCap) return;
    ORDERS.forEach((o, i) => { const b = document.createElement("button"); b.textContent = this.ui.orders[i]; b.onclick = () => this.issueOrder(i); bar.appendChild(b); });
  }
  issueOrder(i) {
    const o = ORDERS[i].key, p = this.player;
    [...$("orders").children].forEach((b, j) => b.classList.toggle("active", j === i));
    this.sfx("horn");
    p.react("rally");
    this.speak("ally", o, { priority: true });
    const map = {
      attack: { stance: "advance", protect: false, charge: true },              // hit harder, guard less, chase
      hold: { stance: "hold", protect: false, hold: true },                     // + holdAt = where they stand
      follow: { stance: "advance", protect: false, follow: true },              // only the ones near the captain
      protect: { stance: "hold", protect: true, guard: true },
      split: { stance: "advance", protect: false, split: true },
    };
    // a short, visible "yes sir": raise the weapon / brace the shield
    const ack = { attack: "cheer", hold: "block", follow: "cheer", protect: "block", split: "cheer" }[o];
    // SPLIT UP: decide the wings now. Room on both sides of the enemy -> a pincer (left half / right half of the
    // line); only one side open -> everybody goes round that side.
    const wing = new Map();
    if (o === "split") {
      const gen = this.generals[p.team], { right } = gen.axes(), open = gen.flankOpenness();
      const sol = this.alive(p.team).filter((a) => a !== p && a.line)
        .sort((a, b) => (a.pos.x * right.x + a.pos.z * right.y) - (b.pos.x * right.x + b.pos.z * right.y));
      // a lane counts as usable when ~80% of it is clear; both usable -> pincer, one -> all round that side,
      // neither -> split anyway but toward the better one (the wide swing gives up by itself if it gets stuck)
      const both = open.left >= 0.8 && open.right >= 0.8;
      const only = open.left >= open.right ? -1 : 1;
      sol.forEach((a, i) => wing.set(a, both ? (i < sol.length / 2 ? -1 : 1) : only));
      this.lastSplit = both ? "pincer" : only < 0 ? "left" : "right";
    }
    const FOLLOW_R = 7;   // "the ones around me right now"
    for (const a of this.alive(p.team)) {
      if (a === p) continue;
      if (o === "follow" && a.dist(p) > FOLLOW_R) continue;   // the rest carry on with what they were doing
      // orders travel by voice: farther units hear later; scared or undisciplined ones may ignore it
      const delay = 0.3 + a.dist(p) * 0.09 + Math.random() * 0.4;
      const obeys = a.morale > 15 && Math.random() < (o === "follow" ? 0.9 : 0.55 + a.trait.discipline * 0.45 + this.diff.obey);
      this.pending.push({ at: this.time + delay, fn: () => {
        if (!a.alive) return;
        if (!obeys) { this.bubbleAt(a, "...", 1); return; }
        a.order = { ...map[o] };
        if (o === "split") { if (wing.has(a)) a.order.side = wing.get(a); else a.order = { stance: "advance", protect: false }; a.brain.splitReached = false; a.brain.splitT = 0; }
        if (o === "hold") a.order.holdAt = { x: a.pos.x, z: a.pos.z };
        if (o === "follow" || o === "protect") a.faceTo(p.pos.x, p.pos.z);
        a.react(a.line && a.s.shield ? ack : "cheer");   // archers have no shield: they raise the bow
      } });
    }
  }

  setPaused(on) {
    this.paused = on;
    $("paused-title").textContent = this.settings.lang === "el" ? "Παύση" : "Paused";
    $("paused").classList.toggle("hidden", !on);
    if (on) try { speechSynthesis.pause(); } catch {} else try { speechSynthesis.resume(); } catch {}
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
    if (this.paused) {   // Esc / Start toggles; the world stands still
      const pin = this.input.poll();
      if (pin.pause || pin.startBtn) this.setPaused(false);
      return;
    }
    // hit-stop: the world almost freezes for a split second when the player lands a blow
    if (this.hitStop > 0) { this.hitStop -= dt; dt *= 0.08; }
    this.step(dt);
    this.renderer.render(this.scene, this.camera);
    this.frames++; this.fpsT += dt;
    if (this.fpsT > 1) { $("fps").textContent = `${Math.round(this.frames / this.fpsT)} fps`; this.frames = 0; this.fpsT = 0; }
  }
  step(dt) {
    this.time += dt; this.lastDt = dt;
    // campaign defence: hold out until the time is up
    const cb = this.campaignBattle;
    if (cb?.kind === "defend" && !this.ended && this.time >= cb.defendT && this.alive(this.settings.side).length) this.endBattle(this.settings.side);
    const inp = this.input.poll();
    // pause: Esc / Start / View, any time during a battle (Esc closes an open order selection first)
    if (!SIM && !this.ended && inp.pause && !(this.orderMenu && inp.menuCancel && !inp.startBtn)) { this.setPaused(true); return; }
    for (const p of this.pending.filter((x) => x.at <= this.time)) p.fn();
    this.pending = this.pending.filter((x) => x.at > this.time);
    // endgame: few units left (or a long lull) -> everyone hunts, nobody flees (see ai.js)
    { const h = this.alive("human").length, k = this.alive("skeleton").length;
      this.endgame = Math.min(h, k) <= 2 || h + k <= 6 || (this.time - this.lastHitTime > 30 && this.time > (this.world.terrain === "castle" ? 75 : 40)); }   // (the castle: a longer walk to the walls)
    if (!this.ended) { this.generals.human.update(dt); this.generals.skeleton.update(dt); }
    // alternate the update order every frame so neither side always reacts last
    this.flip = !this.flip;
    for (const u of this.flip ? this.units : [...this.units].reverse()) {
      let desired;
      if (u.isPlayer) {
        desired = this.playerControl(inp);
        // a player cleric / necromancer: the aura works by itself (heal / raise when ready)
        if (u.s.ability && u.abilityCd <= 0 && !u.busy() && !this.ended) this.supportAbility(u);
      }
      else desired = this.ended ? new THREE.Vector3() : u.brain.update(dt, this.generals[u.team]);
      u.update(dt, desired);
    }
    this.updateArrows(dt);
    this.updateFx(dt);
    // camera follow
    const focus = SPECTATE ? this.battleCentre() : this.player.alive ? this.player.pos : (this.alive(this.settings.side)[0] || this.player).pos;
    const want = focus.clone().add(this.camOffset()); want.y += this.world.height(focus.x, focus.z);   // up on a hill, the camera goes up too
    this.camPos.lerp(want, Math.min(1, dt * (SPECTATE ? 4 : 9)));   // locked on the player
    if (this.marker) {
      this.marker.visible = this.player.alive && !SPECTATE;
      this.marker.position.set(this.player.pos.x, (this.player.groundY || 0) + 1.6 * this.player.s.scale + Math.sin(this.time * 4) * 0.08, this.player.pos.z);
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
    if (this.targetRing.visible) this.targetRing.position.set(t.pos.x, (t.groundY || 0) + 0.03, t.pos.z);
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
    const cbd = this.campaignBattle?.kind === "defend" ? this.campaignBattle.defendT : 0;
    const s = cbd ? Math.max(0, Math.ceil(cbd - this.time)) : Math.floor(this.time); $("clock").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    $("general-line").textContent = "";
    this.updateEdgeArrow();
  }
  // when only a few enemies are left, a red arrow at the screen edge points to one of them (always the same one)
  updateEdgeArrow() {
    const el = $("edge-arrow"), foes = this.alive(this.enemyOf(this.settings.side));
    if (!this.player.alive || this.ended || foes.length === 0 || foes.length > 3) { el.classList.add("hidden"); return; }
    // the arrow sticks to one enemy (no flicker between two), but switches when another one is clearly closer now
    const closest = foes.sort((a, b) => this.player.dist(a) - this.player.dist(b))[0];
    if (!this.trackFoe || !this.trackFoe.alive || this.player.dist(closest) < this.player.dist(this.trackFoe) - 1.5) this.trackFoe = closest;
    const p = this.trackFoe.pos.clone(); p.y = (this.trackFoe.groundY || 0) + 0.8; p.project(this.camera);
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
    const cap = this.alive(team).find((u) => u.captain);
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
      if (u.captain) this.speak("foe", "killedYourCaptain", { priority: true });
      else if (Math.random() < 0.18) this.speak("foe", "kill");
      else if (Math.random() < 0.35) this.speak("ally", "allyDown");
    } else {
      if (u.captain) { this.speak("ally", "enemyCaptainDown", { priority: true }); return; }
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
      const p = b.u.pos.clone(); p.y = (b.u.groundY || 0) + 1.6; p.project(this.camera);
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
      else if (type === "magic") tone(300, 700, 0.35, 0.03, "triangle");
      else if (type === "blast") { noise(0.4, 0.3, 300); tone(90, 40, 0.35, 0.08, "square"); }
      else if (type === "heal") tone(520, 880, 0.5, 0.03, "sine");
      else if (type === "raise") tone(110, 70, 0.7, 0.05, "sawtooth");
      else if (type === "horn") tone(180, 200, 0.6, 0.06, "sawtooth");
    } catch {}
  }
}

function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

window.__game = new Game();   // handle for debugging from the console
