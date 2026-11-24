// Two AI layers:
//  - General: squad-level plan (stance, focus target, flank) re-evaluated every few seconds, plus a moving
//    "anchor" that the army marches with in formation. A Gemma general (later) will write the same plan object.
//  - Brain: per-unit utility AI that turns the plan into movement and attacks, 4x per second.
//
// Movement behaviours:
//  * Formation march: soldiers in a front line, captain behind them, archers in a back line. Units keep their
//    slot until an enemy comes close, so armies arrive as lines instead of a blob.
//  * Surround: melee attackers of the same target spread around it instead of piling into one spot.
//  * Flank: when the general flanks, 2-3 soldiers swing wide (past houses if needed) and hit from the side.
//  * Archers prefer shooting spots next to cover (houses/trees/rocks) and kite away from melee.
//  * Wounded, frightened units fall back to their captain to regroup, then return to the fight.
import * as THREE from "three";
import { TEAM } from "./config.js";

export const ORDERS = [
  { key: "attack", label: "Attack" },      // charge: hit harder, guard less, chase anything near
  { key: "hold", label: "Hold" },          // stand your ground: better blocks, steadier, fight only what comes
  { key: "follow", label: "With me" },     // the units near the captain stick to him and fight where he fights
  { key: "protect", label: "Protect me" }, // everyone closes in and goes for whoever threatens the captain
  { key: "split", label: "Split up" },     // the soldiers go round the enemy's flanks (both sides if there is room)
];

const ANCHOR_SPEED = 1.7;      // formation march speed (units are faster, so they can keep their slots)

export class General {
  constructor(game, team) {
    this.game = game; this.team = team;
    this.plan = { stance: "advance", focus: null, flank: null, protect: false, note: "" };
    this.timer = 1;
    const mine = game.alive(team);
    this.anchor = centroid(mine);
    this.flankers = new Set();
    this.slots = new Map();      // unit -> {x, z}
    this.order = null;           // stable left-to-right order of units in the formation
  }

  // the direction the army faces (towards the enemy) and its right-hand vector
  axes() {
    const foes = this.game.alive(this.game.enemyOf(this.team));
    const f = foes.length ? centroid(foes) : { x: this.anchor.x, z: -Math.sign(this.game.spawnZ(this.team)) * 30 };
    const dir = new THREE.Vector2(f.x - this.anchor.x, f.z - this.anchor.z);
    if (dir.lengthSq() < 0.01) dir.set(0, -Math.sign(this.game.spawnZ(this.team)));
    dir.normalize();
    return { dir, right: new THREE.Vector2(-dir.y, dir.x), foeCentre: f };
  }

  update(dt) {
    const g = this.game, mine = g.alive(this.team), foes = g.alive(g.enemyOf(this.team));
    if (!mine.length) return;
    this.moveAnchor(dt, mine, foes);
    this.timer -= dt;
    if (this.timer <= 0) { this.timer = 3; this.decide(mine, foes); }
    this.computeSlots(mine);
  }

  moveAnchor(dt, mine, foes) {
    const g = this.game, { dir } = this.axes();
    // a player captain IS the anchor: the army forms up around them
    const pc = mine.find((u) => u.isPlayer && u.captain);
    if (pc) { this.anchor.x = pc.pos.x + dir.x * 1.6; this.anchor.z = pc.pos.z + dir.y * 1.6; return; }
    const front = foes.length ? Math.min(...foes.map((f) => Math.hypot(f.pos.x - this.anchor.x, f.pos.z - this.anchor.z))) : 99;
    let v = 0;
    if (this.plan.stance === "advance" && front > 3) v = ANCHOR_SPEED;
    if (this.plan.stance === "fallback") v = -ANCHOR_SPEED * 0.8;
    // never run the formation away from its own stragglers
    const c = centroid(mine), lag = Math.hypot(c.x - this.anchor.x, c.z - this.anchor.z);
    if (v > 0 && lag > 4) v *= 0.3;
    this.anchor.x += dir.x * v * dt; this.anchor.z += dir.y * v * dt;
    const lim = g.spawnZ(this.team);
    if (Math.abs(this.anchor.z) > Math.abs(lim) + 2) this.anchor.z = lim + Math.sign(lim) * 2;
  }

  computeSlots(mine) {
    const { dir, right } = this.axes(), w = this.game.world;
    const soldiers = mine.filter((u) => u.line && !this.flankers.has(u));
    const archers = mine.filter((u) => !u.captain && !u.line);   // back line: archers, mages, support
    // stable ordering: sort by position along the right-hand axis once, then keep it
    const along = (u) => (u.pos.x - this.anchor.x) * right.x + (u.pos.z - this.anchor.z) * right.y;
    if (!this.order || this.order.some((u) => !u.alive) || this.order.length !== soldiers.length + archers.length) {
      this.order = [...soldiers.sort((a, b) => along(a) - along(b)), ...archers.sort((a, b) => along(a) - along(b))];
    }
    const place = (u, side, back) => {
      let x = this.anchor.x + right.x * side - dir.x * back, z = this.anchor.z + right.y * side - dir.y * back;
      if (!w.walkable(x, z)) { const [cx, cz] = w.toCell(x, z), n = w.nearestFree(cx, cz); if (n) [x, z] = w.cellCenter(...n); }
      this.slots.set(u, { x, z });
    };
    const sol = this.order.filter((u) => u.line), arc = this.order.filter((u) => !u.line);
    sol.forEach((u, i) => place(u, (i - (sol.length - 1) / 2) * 1.35 * (sol.length > 8 ? 0.9 : 1), 0));
    arc.forEach((u, i) => place(u, (i - (arc.length - 1) / 2) * 1.7, 3.2));
    // the commander behind the middle; heroes (other captains) behind the line to either side
    const caps = mine.filter((u) => u.captain), cap = lead(mine);
    if (cap) place(cap, 0, cap.ranged ? 2.6 : 1.6);
    caps.filter((u) => u !== cap).forEach((u, i) => place(u, (i % 2 ? 1 : -1) * (2.6 + Math.floor(i / 2) * 2.2), u.ranged ? 2.6 : 1.2));
  }

  decide(mine, foes) {
    if (!foes.length) return;
    const power = (us) => us.reduce((s, u) => s + u.hp * (u.ranged ? 1.2 : 1) * (0.5 + u.morale / 200), 0);
    const ratio = power(mine) / Math.max(1, power(foes));
    const captain = lead(mine);
    const avgMorale = mine.reduce((s, u) => s + u.morale, 0) / mine.length;
    // focus the weakest valuable enemy that many of us can reach
    let best = null, bestScore = -1e9;
    for (const f of foes) {
      const near = mine.filter((u) => u.dist(f) < 9).length;
      const score = (1 - f.hpFrac()) * 6 + (f.captain ? 4 : f.ranged || f.type === "support" ? 2 : 0) + near * 0.8 - centroidDist(mine, f) * 0.15;
      if (score > bestScore) { bestScore = score; best = f; }
    }
    const plan = { focus: best ? best.id : null, flank: null, protect: false };
    if (avgMorale < 30 || ratio < 0.45) { plan.stance = "fallback"; plan.protect = !!captain; plan.note = "Falling back to regroup"; }
    else if (ratio < 0.85 && captain && captain.hpFrac() < 0.6) { plan.stance = "hold"; plan.protect = true; plan.note = "Guarding their captain"; }
    else if (ratio > 1.1 || (this.plan.flank && ratio > 0.9)) {
      plan.stance = "advance";
      plan.flank = this.plan.flank || this.pickFlankSide();
      plan.note = `Advancing, flanking ${plan.flank}`;
    } else { plan.stance = Math.random() < 0.65 ? "advance" : "hold"; plan.note = plan.stance === "hold" ? "Holding the line" : "Advancing in formation"; }
    // stalemate breaker: nobody has struck anyone for a while -> whoever is not losing goes in
    const quiet = this.game.time - (this.game.lastHitTime ?? 0);
    if (plan.stance === "hold" && quiet > 20 && ratio >= 0.9) { plan.stance = "advance"; plan.note = "Losing patience: advancing"; }
    if (plan.stance === "fallback" && quiet > 25 && avgMorale > 35) { plan.stance = "advance"; plan.protect = false; plan.note = "Regrouped: attacking again"; }
    // the castle: its defenders hold the courtyard behind their walls and let the attackers come through the gate or
    // the breach (unless they are falling apart). The endgame below still sends everyone out at the very end.
    const w = this.game.world;
    if (w.terrain === "castle" && Math.sign(TEAM[this.team].spawnZ) === (w.castleSide ?? -1) && plan.stance !== "fallback") {
      plan.stance = "hold"; plan.flank = null; plan.note = "Holding the walls";
    }
    // endgame: with only a few units left nobody holds or retreats any more - find them and finish it
    if (this.game.endgame) { plan.stance = "advance"; plan.protect = false; plan.flank = null; plan.note = "Hunting the last ones"; }
    if (this.team !== this.game.settings.side && !this.game.diff.flank) { plan.flank = null; if (plan.note && plan.note.includes("flank")) plan.note = "Advancing"; }
    // (re)assign flankers: 2-3 soldiers from the chosen wing
    if (plan.flank) {
      for (const u of [...this.flankers]) if (!u.alive) this.flankers.delete(u);
      if (this.flankers.size < 2) {
        const sol = (this.order || []).filter((u) => u.line && u.type !== "monster" && u.alive && !u.isPlayer);
        const wing = plan.flank === "left" ? sol.slice(0, 3) : sol.slice(-3).reverse();
        for (const u of wing) { if (this.flankers.size >= 2 + (Math.random() < 0.4 ? 1 : 0)) break; this.flankers.add(u); }
        this.order = null;
      }
    } else if (this.flankers.size) { this.flankers.clear(); this.order = null; }
    // an AI captain raises the sword when the army's plan changes
    if (captain && !captain.isPlayer && (plan.stance !== this.plan.stance || plan.flank !== this.plan.flank)) captain.react("rally");
    this.game.onPlanChange?.(this.team, plan, this.plan);
    this.plan = plan;
  }

  pickFlankSide() {
    // prefer the side with more open ground around the enemy
    const { right, foeCentre } = this.axes(), w = this.game.world;
    const open = (s) => { let n = 0; for (let k = 3; k <= 9; k += 2) if (w.walkable(foeCentre.x + right.x * s * k, foeCentre.z + right.y * s * k)) n++; return n; };
    const l = open(-1), r = open(1);
    return l === r ? (Math.random() < 0.5 ? "left" : "right") : l > r ? "left" : "right";
  }

  // how passable each flank LANE is: the strip ~6-10 m to that side, from our line all the way up to the enemy
  // (houses, fences, trees and the map edge along the way count against it). 0..1 per side.
  flankOpenness() {
    const { right, dir, foeCentre } = this.axes(), w = this.game.world, a = this.anchor;
    const depth = Math.max(4, (foeCentre.x - a.x) * dir.x + (foeCentre.z - a.z) * dir.y);
    const lane = (s) => {
      let ok = 0, n = 0;
      for (let t = 0; t <= 1.001; t += 0.125) for (const k of [6, 8, 10]) {
        const x = foeCentre.x - dir.x * depth * (1 - t) + right.x * s * k, z = foeCentre.z - dir.y * depth * (1 - t) + right.y * s * k;
        n++; if (w.walkable(x, z) && Math.abs(x) < 22.5 && Math.abs(z) < 31.5) ok++;
      }
      return ok / n;
    };
    return { left: lane(-1), right: lane(1) };
  }
  flankPoint(u) {
    // a waypoint wide on the flank, level with the enemy, then the flankers turn in
    const { right, foeCentre } = this.axes();
    const s = this.plan.flank === "left" ? -1 : 1;
    return { x: foeCentre.x + right.x * s * 7, z: foeCentre.z + right.y * s * 7 };
  }
}

function angDiffA(a, b) { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }
// who leads a side: the commander (the player's captain, or the first AI captain); otherwise any captain left
export function lead(list) { return list.find((u) => u.commander && u.alive) || list.find((u) => u.captain && u.alive) || null; }
const HERO_R = 2.5;   // a hero steadies only the units right beside him
function centroid(units) {
  if (!units.length) return { x: 0, z: 0 };
  let x = 0, z = 0; for (const u of units) { x += u.pos.x; z += u.pos.z; }
  return { x: x / units.length, z: z / units.length };
}
function centroidDist(units, f) { const c = centroid(units); return Math.hypot(c.x - f.pos.x, c.z - f.pos.z); }

export class Brain {
  constructor(unit) { this.u = unit; this.think = Math.random() * 0.25; this.goal = null; this.engaged = false; this.regrouping = false; this.flankReached = false; }

  // returns the desired velocity for this frame
  update(dt, general) {
    const u = this.u, desired = new THREE.Vector3();
    if (!u.alive) return desired;
    this.think -= dt;
    // order from a player captain overrides the general's plan (if it reached this unit)
    const plan = u.order ? { ...general.plan, ...u.order } : general.plan;
    if (u.s.ability && u.abilityCd <= 0 && !u.busy() && !u.game.ended) u.game.supportAbility(u);   // heal / raise when ready
    if (this.think <= 0) { this.think = u.team !== u.game.settings.side ? u.game.diff.think : 0.25; this.decide(plan, general); }
    const t = u.target;
    if (t && t.alive && u.canAttack(t) && plan.stance !== "fallback" && !this.regrouping) u.startAttack(t);
    else if (u.cooldown <= 0 && u.attackTimer <= 0) {
      // opportunity strike: our chosen target is out of reach but an enemy is right next to us -> hit it
      // (also while regrouping / falling back: you still defend yourself)
      let adj = null, ad = 1e9;
      for (const f of u.game.alive(u.game.enemyOf(u.team))) {
        const d = u.dist(f);
        if (d < ad && d <= (u.ranged ? u.s.bashRange : u.s.range) + f.radius) { ad = d; adj = f; }
      }
      if (adj && u.startAttack(adj) && !this.regrouping && plan.stance !== "fallback") u.target = adj;
    }
    if (this.goal) {
      const dx = this.goal.x - u.pos.x, dz = this.goal.z - u.pos.z, d = Math.hypot(dx, dz);
      if (d > (this.goal.tol ?? 0.2)) {
        const step = this.followPath(this.goal.x, this.goal.z, dt);
        // ease into the slot instead of overshooting
        const k = Math.min(1, d / 1.2);
        desired.set(step.x, 0, step.z).multiplyScalar(u.s.speed * (this.goal.run ?? 1) * Math.max(0.35, k));
      }
    }
    // keep facing whoever we are swinging at / drawing on (archers shoot out to 10 m, and must never turn away mid-draw)
    const aim = u.attackTimer > 0 && u.pendingTarget?.alive ? u.pendingTarget : t;
    const faceR = u.ranged ? u.s.range + 1.5 : 6;
    if (aim && aim.alive && (u.dist(aim) < faceR || u.attackTimer > 0 || u.busy())) u.faceTo(aim.pos.x, aim.pos.z);
    else if (!this.engaged && this.goal && !desired.lengthSq()) {
      const { dir } = general.axes(); u.wantFacing = Math.atan2(dir.x, dir.y);   // stand facing the enemy
    }
    return desired;
  }

  decide(plan, general) {
    const u = this.u, g = u.game, foes = g.alive(g.enemyOf(u.team));
    if (!foes.length) { this.goal = null; return; }
    const allies = g.alive(u.team);
    const captain = lead(allies.filter((a) => a !== u));
    // morale aura: the commander steadies everyone near him; a hero (another captain) only those right beside him,
    // and less. They do not add up: the strongest one counts.
    let aura = 0;
    for (const a of allies) {
      if (!a.captain || a === u) continue;
      const d = u.dist(a);
      aura = Math.max(aura, a.commander ? (d < 5 ? 1 : 0) : d < HERO_R ? 0.25 + 0.35 * (1 - d / HERO_R) : 0);
    }
    if (aura) u.morale = Math.min(100, u.morale + 2.5 * aura * u.trait.discipline);
    // catching your breath: away from the enemy, morale slowly recovers (less without a captain)
    if (foes.every((f) => u.dist(f) > 10)) u.morale = Math.min(captain ? 100 : 60, u.morale + 0.45 * u.trait.discipline);

    // ---- target choice (utility)
    let best = null, bestScore = -1e9;
    for (const f of foes) {
      const d = u.dist(f);
      let s = -d * 1.0 + (1 - f.hpFrac()) * 5 * u.trait.aggression;
      const enemyAI = u.team !== g.settings.side;
      if (f.id === plan.focus) s += enemyAI ? g.diff.focus : 4;
      if (enemyAI && f.isPlayer) s += g.diff.huntCaptain;                  // harder enemies go for the player
      if (f.ranged && !u.ranged) s += 1.5;
      if (f.captain) s += 1.5;
      if (u.s.hunter && (f.soft || f.type === "support")) s += u.s.hunter;   // scouts hunt archers, mages and healers
      if (u.ranged === "magic") s += foes.filter((o) => o !== f && o.dist(f) < u.s.splash).length * 1.6;   // a blast wants a crowd
      if (u.ranged && !g.world.lineClear(u.pos.x, u.pos.z, f.pos.x, f.pos.z)) s -= 6;
      const crowd = allies.filter((a) => a !== u && a.target === f && !a.ranged).length;
      if (!u.ranged && crowd >= 3) s -= (crowd - 2) * 2.5;     // up to 3 can surround one target
      if (f === u.target) s += 1.2;                                        // stickiness
      if (!u.ranged && d < u.s.range + 1.2) s += 3;             // whoever is in your face comes first
      if (!u.ranged && d < 7) {
        // bodyguard: an enemy hacking at one of our archers or our captain gets dealt with first
        const victim = f.target;
        if (victim && victim.alive && victim.team === u.team && victim !== u && (victim.ranged || victim.captain || victim.type === "support")
            && f.dist(victim) < f.s.range + victim.radius + 0.5) s += 3.5;
        // backstab: a foe busy with someone else, turned away from us, can't get its shield round
        if (victim && victim !== u && f.alive && Math.abs(angDiffA(Math.atan2(u.pos.x - f.pos.x, u.pos.z - f.pos.z), f.facing)) > 1.4) s += 1.5;
      }
      if (s > bestScore) { bestScore = s; best = f; }
    }
    u.target = best;
    const nearest = Math.min(...foes.map((f) => u.dist(f)));

    // ---- regroup: badly hurt and scared -> back to the captain, return when morale recovers
    if (!u.isPlayer && !u.captain) {
      if (!this.regrouping && u.hpFrac() < 0.35 && u.morale < 45) this.regrouping = true;
      if (this.regrouping && (u.morale > 65 || !captain)) this.regrouping = false;
    }
    // last stand: the last one alive on its side stops running and fights to the end
    const lastStand = allies.length <= 1 || g.endgame;   // endgame: no more running away
    if (lastStand) this.regrouping = false;
    // line rotation: a badly hurt soldier pressed by two steps back behind a fresher comrade for a moment
    if (!lastStand && !u.isPlayer && u.line) {
      if (this.rotateUntil && g.time < this.rotateUntil && this.rotateGoal) { this.goal = this.rotateGoal; this.engaged = false; return; }
      const pressing = foes.filter((f) => !f.ranged && u.dist(f) < 2.2);
      if (u.hpFrac() < 0.25 && pressing.length >= 2 && (this.rotateBan ?? 0) < g.time) {
        const cover = allies.find((a) => a !== u && a.line && !a.isPlayer && a.hpFrac() > 0.6 && u.dist(a) < 4);
        if (cover) {
          const c = centroid(pressing), dx = u.pos.x - c.x, dz = u.pos.z - c.z, dd = Math.hypot(dx, dz) || 1;
          this.rotateGoal = { x: u.pos.x + dx / dd * 3, z: u.pos.z + dz / dd * 3, tol: 0.4, run: 1.1 };
          this.rotateUntil = g.time + 2.2; this.rotateBan = g.time + 12;   // once in a while, not a dance
          cover.target = pressing[0];
          this.goal = this.rotateGoal; this.engaged = false; return;
        }
      }
    }
    const ord = u.order || {};
    if (ord.charge) this.regrouping = false;   // a charge does not stop to lick its wounds
    const fleeing = !lastStand && u.morale < 22 * (1.4 - u.trait.bravery * 0.5) && !u.isPlayer;
    // falling back (not fleeing): now and then the shooters pull back onto a hill on our side instead of to the
    // captain. Decided once per retreat, so they do not keep changing their minds.
    const retreating = plan.stance === "fallback" && !lastStand && !fleeing && !this.regrouping;
    if (!retreating) this.retreatHill = undefined;
    else if (u.ranged && this.retreatHill === undefined) this.retreatHill = Math.random() < 0.4 ? this.retreatSpot(foes) : null;
    if (retreating && this.retreatHill) {
      const near = Math.hypot(u.pos.x - this.retreatHill.x, u.pos.z - this.retreatHill.z) < 1.0;
      this.goal = near ? null : { x: this.retreatHill.x, z: this.retreatHill.z, tol: 0.6, run: 1.1 };
      this.engaged = false; return;
    }
    if (this.regrouping || fleeing || (plan.stance === "fallback" && !lastStand)) {
      const { dir } = general.axes();
      const anchor = captain ? captain.pos : { x: u.pos.x, z: g.spawnZ(u.team) };
      this.goal = { x: anchor.x - dir.x * 1.8 + (Math.random() - 0.5), z: anchor.z - dir.y * 1.8 + (Math.random() - 0.5), tol: 1.2, run: 1.15 };
      this.engaged = false; return;
    }
    // ---- the player captain's orders
    const leader = captain && captain.isPlayer ? captain : null;
    const shootable = (f) => { const d = u.dist(f); return d >= u.s.minRange && d <= u.s.range && g.world.lineClear(u.pos.x, u.pos.z, f.pos.x, f.pos.z); };
    // HOLD: stay on your spot, fight only what comes to you (better blocks and nerves: see unit.takeHit)
    // nothing has happened anywhere for 30 s: "nobody is coming - we move on" (no endless standoffs)
    if (ord.hold && g.time - g.lastHitTime > 30) { u.order = null; return; }
    if (ord.hold && ord.holdAt) {
      const at = ord.holdAt;
      if (!u.line && !u.captain) {
        const t2 = u.ranged && foes.filter(shootable).sort((a, b) => u.dist(a) - u.dist(b))[0] || null;
        if (t2) u.target = t2;
        this.goal = { x: at.x, z: at.z, tol: 0.5 }; this.engaged = false; return;
      }
      // a short sally: anyone who comes within ~4.5 m of our spot gets met, then we walk back to the spot
      const near = foes.filter((f) => Math.hypot(f.pos.x - at.x, f.pos.z - at.z) < 4.5).sort((a, b) => u.dist(a) - u.dist(b));
      if (near.length) { u.target = near[0]; this.engaged = true; this.goal = u.dist(near[0]) <= u.s.range + near[0].radius ? null : this.surroundSpot(near[0], allies); return; }
      this.goal = { x: at.x, z: at.z, tol: 0.4 }; this.engaged = false; return;
    }
    // WITH ME: stick to the captain; fight whatever comes near him (or right next to you)
    if (ord.follow && leader) {
      const followers = allies.filter((a) => a.order && a.order.follow && a !== leader).sort((a, b) => (a.id < b.id ? -1 : 1));
      const k = Math.max(0, followers.indexOf(u)), fac = leader.facing;
      if (!u.line) {
        const t2 = u.ranged && foes.filter((f) => shootable(f) && f.dist(leader) < 7).sort((a, b) => a.dist(leader) - b.dist(leader))[0] || null;
        if (t2) u.target = t2;
        const arc = followers.filter((a) => !a.line), j = Math.max(0, arc.indexOf(u)), m = Math.max(1, arc.length);
        const ang = fac + Math.PI + (j - (m - 1) / 2) * 0.55;   // a line behind the captain
        this.goal = { x: leader.pos.x + Math.sin(ang) * 3.2, z: leader.pos.z + Math.cos(ang) * 3.2, tol: 0.6, run: 1.15 };
        this.engaged = false; return;
      }
      const threat = foes.filter((f) => f.dist(leader) < 3.6 || u.dist(f) < 1.8).sort((a, b) => u.dist(a) - u.dist(b))[0];
      if (threat) { u.target = threat; this.engaged = true; this.goal = this.surroundSpot(threat, allies); return; }
      const mel = followers.filter((a) => a.line), j = Math.max(0, mel.indexOf(u)), m = Math.max(1, mel.length);
      const ang = fac + Math.PI * 0.5 + (m > 1 ? (j / (m - 1)) * Math.PI : Math.PI / 2);   // a half ring round his back and sides
      const r = 1.6 + (j % 2) * 0.5;
      this.goal = { x: leader.pos.x + Math.sin(ang) * r, z: leader.pos.z + Math.cos(ang) * r, tol: 0.45, run: 1.2 };
      this.engaged = false; return;
    }
    // SPLIT UP: go wide round the enemy's flank (side chosen when the order was given), then turn in and attack
    if (ord.split && u.line) {
      if (!this.splitReached) {
        // open out sideways straight away (a ~9 m wide lane on that side), push forward along it until level with
        // the enemy, then turn in. Seen from above it reads as the line splitting and swinging round both sides.
        const { right, dir, foeCentre } = general.axes();
        const lat = (u.pos.x - foeCentre.x) * right.x + (u.pos.z - foeCentre.z) * right.y;
        const fwd = (u.pos.x - foeCentre.x) * dir.x + (u.pos.z - foeCentre.z) * dir.y;   // < 0: still in front of them
        const L = ord.side * 9, nf = Math.min(0, fwd + 6);
        let gx = foeCentre.x + right.x * L + dir.x * nf, gz = foeCentre.z + right.y * L + dir.y * nf;
        const lim = 23 - 1.5, limz = 32 - 1.5; gx = Math.max(-lim, Math.min(lim, gx)); gz = Math.max(-limz, Math.min(limz, gz));
        // ...or give up on the wide swing: lane blocked (houses, map edge), taking too long, or the endgame
        this.splitT = (this.splitT ?? 0) + 0.25;   // decide() runs every 0.25 s for the player's side
        const stuck = Math.hypot(gx - u.pos.x, gz - u.pos.z) < 1.5;
        if ((Math.abs(lat - L) < 2.5 && fwd > -3) || nearest < 2.5 || stuck || this.splitT > 18 || g.endgame) this.splitReached = true;
        else { this.goal = { x: gx, z: gz, tol: 0.8, run: 1.15 }; this.engaged = false; return; }
      }
      const t2 = foes.slice().sort((a, b) => u.dist(a) - u.dist(b))[0];
      u.target = t2; this.engaged = true; this.goal = this.surroundSpot(t2, allies); return;
    }
    // PROTECT ME: whoever threatens the captain gets everyone on him
    if (ord.guard && leader) {
      const threats = foes.filter((f) => f.dist(leader) < 4.5).sort((a, b) => a.dist(leader) - b.dist(leader));
      if (!u.line) {
        const t2 = u.ranged && threats.find(shootable);
        if (t2) u.target = t2;
        if (u.dist(leader) > 5) { this.goal = { x: leader.pos.x, z: leader.pos.z, tol: 4, run: 1.15 }; return; }
        return u.ranged ? this.archerGoal(u.target, plan, general) : this.supportGoal(general);
      }
      if (threats.length) { u.target = threats[0]; this.engaged = true; this.goal = this.surroundSpot(threats[0], allies); return; }
      if (u.dist(leader) > 2.6) { this.goal = { x: leader.pos.x, z: leader.pos.z, tol: 2.2, run: 1.15 }; return; }
      this.goal = null; return;
    }
    if (plan.protect && captain && u.line && u.dist(captain) > 3.5) {
      this.goal = { x: captain.pos.x, z: captain.pos.z, tol: 2.2 }; return;
    }
    if (u.ranged) return this.archerGoal(best, plan, general);
    if (u.type === "support") return this.supportGoal(general);
    // an AI captain who is badly hurt steps back behind the line while there is still a line to hide behind
    if (u.commander && !u.isPlayer && u.hpFrac() < 0.4 && allies.filter((x) => x.line).length > 3) {
      const { dir } = general.axes();
      this.goal = { x: general.anchor.x - dir.x * 4.5, z: general.anchor.z - dir.y * 4.5, tol: 0.8, run: 1.1 }; this.engaged = false; return;
    }

    // ---- melee: march in formation until the enemy is close, then engage
    // mop-up: with only a couple of enemies left (or no soldiers of our own) even a careful captain goes in
    const mopUp = foes.length <= 2 || !allies.some((a) => a.line);
    // castle defenders holding the courtyard: they dash out at whoever comes near the gate or the breach (a few metres
    // past the wall), and once nobody is close they go back to their places inside (the formation slots below)
    const sally = plan.stance === "hold" && g.world.terrain === "castle" && Math.sign(TEAM[u.team].spawnZ) === (g.world.castleSide ?? -1);
    const engageR = g.endgame ? 999 : mopUp ? 30 : ord.charge ? 14 : sally && !u.commander ? 11 : (u.s.engage ?? (u.commander ? 3.0 : 5.5));
    this.engaged = nearest < engageR || (this.engaged && nearest < (sally ? 13 : 9));
    const flanker = general.flankers.has(u);
    if (flanker && !this.flankReached && best && plan.flank) {
      const fp = general.flankPoint(u);
      if (Math.hypot(fp.x - u.pos.x, fp.z - u.pos.z) < 2 || nearest < 2.5) this.flankReached = true;
      else { this.goal = { ...fp, tol: 1, run: 1.15 }; return; }
    }
    if (!flanker) this.flankReached = false;
    if (!this.engaged && !flanker) {
      const slot = general.slots.get(u);
      if (slot) { this.goal = { ...slot, tol: 0.35 }; return; }
    }
    if (plan.stance === "hold" && !this.engaged && !flanker) { this.goal = null; return; }
    if (best) this.goal = this.surroundSpot(best, allies);
  }

  // cleric / necromancer: stay a few metres behind our own melee line, near the hurt and the fallen, use the
  // ability when it is ready, and only fight what walks right up to us (the opportunity strike in update)
  supportGoal(general) {
    const u = this.u, g = u.game, allies = g.alive(u.team).filter((a) => a !== u);
    if (!u.alive) return;
    const foes = g.alive(g.enemyOf(u.team));
    const threat = foes.filter((f) => !f.ranged && u.dist(f) < 2.6).sort((a, b) => u.dist(a) - u.dist(b))[0];
    if (threat && !g.endgame) {   // step away from a melee attacker (it is no fighter)
      const dx = u.pos.x - threat.pos.x, dz = u.pos.z - threat.pos.z, d = Math.hypot(dx, dz) || 1;
      this.goal = { x: u.pos.x + dx / d * 2.5, z: u.pos.z + dz / d * 2.5, tol: 0.3, run: 1.1 }; this.engaged = false; return;
    }
    const mel = allies.filter((a) => a.line || a.captain);
    if (!mel.length) { const t = foes.sort((a, b) => u.dist(a) - u.dist(b))[0]; u.target = t; this.goal = t ? this.surroundSpot(t, allies) : null; return; }
    // the most wounded melee ally that is still in the fight, else the middle of the line
    const hurt = mel.filter((a) => a.hpFrac() < 0.8).sort((a, b) => a.hpFrac() - b.hpFrac())[0];
    const c = hurt ? hurt.pos : centroid(mel), { dir } = general.axes();
    this.goal = { x: c.x - dir.x * 2.6, z: c.z - dir.y * 2.6, tol: 1.0 };
    this.engaged = false;
  }

  // spread attackers of the same target around it (front, sides, behind) instead of stacking
  surroundSpot(t, allies) {
    const u = this.u, w = u.game.world;
    const attackers = allies.filter((a) => a.target === t && !a.ranged).sort((a, b) => (a.id < b.id ? -1 : 1));
    const k = Math.max(0, attackers.indexOf(u)), n = Math.max(1, attackers.length);
    const reach = u.s.range + t.radius;
    if (u.dist(t) <= reach * 0.95) return { x: u.pos.x, z: u.pos.z, tol: 9 };      // in range: stand and fight
    const base = Math.atan2(u.pos.x - t.pos.x, u.pos.z - t.pos.z);
    const spread = n > 1 ? (k - (n - 1) / 2) * 1.1 : 0;
    for (const off of [0, 0.5, -0.5, 1, -1]) {
      const a = base + spread + off, r = reach * 0.8;
      const x = t.pos.x + Math.sin(a) * r, z = t.pos.z + Math.cos(a) * r;
      if (w.walkable(x, z)) return { x, z, tol: 0.25, run: 1.05 };
    }
    return { x: t.pos.x, z: t.pos.z, tol: reach * 0.8 };
  }

  // a spot on a hill top worth taking: close to us, not closer to the enemy than to us, no enemy on it, and near
  // enough to the fighting to shoot from. Each shooter gets its own spot on the top (spread round the middle).
  // Only when it makes sense right now: not with the fight already on us, and not walking away from a good shot.
  hillSpot(foes, t) {
    const u = this.u, w = u.game.world; if (!w.hills.length || !foes.length) return null;
    if (Math.min(...foes.map((f) => u.dist(f))) < 6) return null;                     // they are on us: no time to climb
    // where the action is right now: the enemy, and where the two lines meet (our melee vs theirs)
    const fc = centroid(foes), mine = u.game.alive(u.team).filter((a) => a.line);
    const mc = mine.length ? centroid(mine) : u.pos, clash = { x: (fc.x + mc.x) / 2, z: (fc.z + mc.z) / 2 };
    const reachTop = u.baseRange * 1.25;   // the range we would have up there
    let best = null, bestD = 1e9;
    for (const h of w.hillTops()) {
      const du = Math.hypot(u.pos.x - h.x, u.pos.z - h.z);
      const df = Math.min(...foes.map((f) => Math.hypot(f.pos.x - h.x, f.pos.z - h.z)));
      if (du > 16 || df < h.r + 1.5 || df < du * 0.8) continue;                       // too far / held / they get there first
      // strategic only if from the top we can shoot into the action (the fight is not somewhere else)
      if (Math.min(Math.hypot(fc.x - h.x, fc.z - h.z), Math.hypot(clash.x - h.x, clash.z - h.z)) > reachTop) continue;
      if (t && du > 5 && u.canAttack(t)) continue;                                      // already shooting: a long climb is a waste
      if (du < bestD) { bestD = du; best = h; }
    }
    if (!best) return null;
    let hash = 0; for (const ch of String(u.id)) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
    const ang = (hash % 360) * Math.PI / 180, rad = best.r * (0.25 + ((hash >>> 8) % 50) / 100);
    const x = best.x + Math.cos(ang) * rad, z = best.z + Math.sin(ang) * rad;
    return w.walkable(x, z) ? { x, z } : { x: best.x, z: best.z };
  }
  // a hill to fall back onto: nearer to us than to them, not held by them, not far
  retreatSpot(foes) {
    const u = this.u, w = u.game.world; if (!w.hills.length || !foes.length) return null;
    const opts = w.hillTops().filter((h) => {
      const du = Math.hypot(u.pos.x - h.x, u.pos.z - h.z), df = Math.min(...foes.map((f) => Math.hypot(f.pos.x - h.x, f.pos.z - h.z)));
      return du < 14 && df > h.r + 3 && df > du * 1.3;
    });
    if (!opts.length) return null;
    const h = opts[Math.floor(Math.random() * opts.length)], ang = Math.random() * Math.PI * 2, rad = h.r * (0.2 + Math.random() * 0.5);
    const x = h.x + Math.cos(ang) * rad, z = h.z + Math.sin(ang) * rad;
    return w.walkable(x, z) ? { x, z } : { x: h.x, z: h.z };
  }
  archerGoal(t, plan, general) {
    const u = this.u, g = u.game, w = g.world;
    if (!t) { this.goal = null; return; }
    const foes = g.alive(g.enemyOf(u.team));
    // an enemy archer right next to us: smack it (we can bash, it can only bash back)
    const brawler = foes.filter((f) => f.ranged && u.dist(f) <= u.s.bashRange + f.radius + 0.3)[0];
    if (brawler) { u.target = brawler; this.goal = null; return; }
    // kite away from anything that gets close (soldiers, captains, and archers that walked up to us)
    const threat = foes.filter((f) => u.dist(f) < (f.ranged ? 2.4 : 3.2)).sort((a, b) => u.dist(a) - u.dist(b))[0];
    const lastStand = g.alive(u.team).length <= 1 || g.endgame;
    if (threat && lastStand && u.dist(threat) <= u.s.bashRange + threat.radius + 0.6) { u.target = threat; this.goal = null; return; }   // cornered: fight
    if (threat && threat.ranged) { u.target = threat; this.goal = { x: threat.pos.x, z: threat.pos.z, tol: u.s.bashRange * 0.8 }; return; }
    // kiting budget: run for at most ~2.5 s, then stand and fight for a while (no endless chase in circles)
    const now = g.time;
    if (this.kiteStart != null && now - this.kiteStart > 2.5) { this.kiteBan = now + 6; this.kiteStart = null; }
    const mayKite = !(this.kiteBan && now < this.kiteBan);
    if (threat && mayKite && this.kiteStart == null) this.kiteStart = now;
    if (!threat) this.kiteStart = null;
    if (threat && !mayKite) {
      // done running: fight back - shoot if we can, otherwise make room for a shot or walk up and bash it
      u.target = threat;
      if (u.canAttack(threat)) { this.goal = null; return; }
      const td = u.dist(threat), tlos = w.lineClear(u.pos.x, u.pos.z, threat.pos.x, threat.pos.z);
      if (tlos && td < u.s.minRange + 0.3) {
        const dx = u.pos.x - threat.pos.x, dz = u.pos.z - threat.pos.z, dd = td || 1;
        this.goal = { x: u.pos.x + dx / dd * 1.5, z: u.pos.z + dz / dd * 1.5, tol: 0.3 };
      } else this.goal = { x: threat.pos.x, z: threat.pos.z, tol: u.s.bashRange * 0.8 };
      return;
    }
    if (threat && !(lastStand && foes.length <= 1)) {
      const dx = u.pos.x - threat.pos.x, dz = u.pos.z - threat.pos.z, d = Math.hypot(dx, dz) || 1;
      this.goal = { x: u.pos.x + dx / d * 3, z: u.pos.z + dz / d * 3, tol: 0.3, run: 1.15 }; return;
    }
    // HIGH GROUND: a hill top near us that the enemy does not hold (and we reach first) is the place to shoot from
    const top = plan.stance !== "fallback" && !g.endgame ? this.hillSpot(foes, t) : null;
    if (top) {
      const onTop = Math.hypot(u.pos.x - top.x, u.pos.z - top.z) < 1.0;
      this.goal = onTop ? null : { x: top.x, z: top.z, tol: 0.6 };
      this.settled = onTop; return;
    }
    const d = u.dist(t), los = w.lineClear(u.pos.x, u.pos.z, t.pos.x, t.pos.z);
    // far from the fight: walk with the formation (back line)
    if (d > u.s.range + 3 && !g.endgame) {
      const slot = general.slots.get(u);
      if (slot) { this.goal = { ...slot, tol: 0.4 }; return; }
    }
    if (los && d <= u.s.range * 0.92 && d >= u.s.minRange + 1 && (this.goal == null || this.settled)) { this.goal = null; this.settled = true; return; }
    this.settled = false;
    // pick a shooting spot ~70% of range away, with line of sight, preferring cover next to it
    const want = u.s.range * 0.78, ownMelee = g.alive(u.team).filter((a) => a.line);
    const frontLine = ownMelee.length ? centroid(ownMelee) : u.pos;
    let best = null, bestS = -1e9;
    for (let i = 0; i < 14; i++) {
      const a = Math.atan2(u.pos.x - t.pos.x, u.pos.z - t.pos.z) + (i - 7) * 0.2;
      const x = t.pos.x + Math.sin(a) * want, z = t.pos.z + Math.cos(a) * want;
      if (!w.walkable(x, z) || !w.lineClear(x, z, t.pos.x, t.pos.z)) continue;
      let s = -Math.hypot(x - u.pos.x, z - u.pos.z) * 0.6;
      // cover: something solid close by, roughly between us and the enemy
      for (const [ox, oz] of [[0.9, 0], [-0.9, 0], [0, 0.9], [0, -0.9], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) {
        if (w.blocksArrow(x + ox, z + oz)) { const toward = (ox * (t.pos.x - x) + oz * (t.pos.z - z)) > 0; s += toward ? 2.5 : 1; break; }
      }
      // stay behind our own melee line
      const ahead = Math.hypot(x - t.pos.x, z - t.pos.z) < Math.hypot(frontLine.x - t.pos.x, frontLine.z - t.pos.z) - 0.5;
      if (ahead) s -= 8;
      // never pick a spot in the middle of the enemy
      for (const f of foes) { const fd = Math.hypot(f.pos.x - x, f.pos.z - z); if (fd < 4) s -= (4 - fd) * 3; }
      if (s > bestS) { bestS = s; best = { x, z }; }
    }
    if (plan.stance === "hold" && !best) { this.goal = null; return; }
    // no good spot (map edge, houses in the way): walk in until we have a clear shot
    // (without line of sight keep walking until we get one - stopping "close enough" behind a rock was a deadlock)
    this.goal = best ? { ...best, tol: 0.4 } : { x: t.pos.x, z: t.pos.z, tol: los ? want : u.s.bashRange * 0.8 };
  }

  followPath(tx, tz, dt) {
    const u = this.u, w = u.game.world, g = u.game;
    // last-resort safety net: a long lull in the endgame -> head straight for the target and let the body
    // collision slide us round whatever is in the way (no grid path that might be failing)
    // (not at the castle: its wall runs across the whole field, straight ahead would just push into it)
    if (g.endgame && g.time - g.lastHitTime > 40 && w.terrain !== "castle") return norm(tx - u.pos.x, tz - u.pos.z);
    if (w.walkLineClear(u.pos.x, u.pos.z, tx, tz)) { this.path = null; return norm(tx - u.pos.x, tz - u.pos.z); }
    this.repath = (this.repath ?? 0) - dt;
    if (!this.path || this.repath <= 0 || Math.hypot(this.pathGoal[0] - tx, this.pathGoal[1] - tz) > 1.5) {
      this.path = w.findPath(u.pos.x, u.pos.z, tx, tz); this.pathGoal = [tx, tz]; this.repath = 1 + Math.random() * 0.5;
    }
    if (!this.path) {
      // no way there at all: we got shoved into a pocket behind a fence. After a few seconds, walk up to the
      // fence and hop over it (never over houses, trees or rocks).
      this.noPathT = (this.noPathT ?? 0) + dt;
      if (this.noPathT > 3 && !this.hopPlan) {
        const cells = w.findPath(u.pos.x, u.pos.z, tx, tz, 4000, true);
        if (cells) for (let i = 1; i < cells.length; i++) {
          if (w.isFence(...cells[i - 1]) && w.walkable(...cells[i])) { this.hopPlan = { near: cells[i - 1], land: cells[i] }; break; }
        }
        if (!this.hopPlan) this.noPathT = 0;
      }
      if (this.hopPlan) {
        const [nx, nz] = this.hopPlan.near;
        if (Math.hypot(nx - u.pos.x, nz - u.pos.z) < 1.3) { u.startHop(...this.hopPlan.land); this.hopPlan = null; this.noPathT = 0; this.path = null; return { x: 0, z: 0 }; }
        return norm(nx - u.pos.x, nz - u.pos.z);
      }
      return norm(tx - u.pos.x, tz - u.pos.z);
    }
    this.noPathT = 0; this.hopPlan = null;
    if (!this.path.length) return norm(tx - u.pos.x, tz - u.pos.z);
    const [px, pz] = this.path[0];
    if (Math.hypot(px - u.pos.x, pz - u.pos.z) < 0.35 && this.path.length > 1) this.path.shift();
    return norm(this.path[0][0] - u.pos.x, this.path[0][1] - u.pos.z);
  }
}

function norm(x, z) { const d = Math.hypot(x, z) || 1; return { x: x / d, z: z / d }; }
