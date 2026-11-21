// A single fighter: model + animation state + combat state. Movement/decisions come from AI or the player.
import * as THREE from "three";
import { STATS, TEAM } from "./config.js";
import { spawnModel } from "./assets.js";
export const HEAVY_CHARGE = 1.45;   // seconds in the raised stance before the heavy blow is ready (~1.6 s from the press)
const PLAYER_CAPTAIN_DMG = 1.5;   // the player captain's sword (on top of full-damage quick swings)

let nextId = 1;
const ONE_SHOT = new Set(["attack", "attack2", "attack3", "shoot", "shoot_turn", "hit", "cheer", "idle_look", "idle_tap", "laugh", "rally"]);
const CLAMP = new Set(["death", "death_fwd", "death_back", "block"]);
const BUSY = new Set(["attack", "attack2", "attack3", "shoot", "shoot_turn", "hit", "laugh", "rally", "cheer"]);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export class Unit {
  constructor(game, team, type, x, z) {
    this.game = game; this.team = team; this.type = type;
    this.id = `${team[0]}${nextId++}`;
    this.s = STATS[type];
    this.hp = this.maxHp = this.s.hp;
    this.alive = true;
    this.pos = new THREE.Vector3(x, 0, z);
    this.vel = new THREE.Vector3();
    this.facing = TEAM[team].facing;
    this.radius = 0.32 * this.s.scale;
    this.cooldown = Math.random() * 0.5;
    this.attackTimer = 0;        // >0 while a swing/draw is in progress
    this.pendingTarget = null;
    this.target = null;
    this.blocking = 0;
    this.morale = 100;
    this.isPlayer = false;
    // personality: makes two soldiers of the same type behave differently
    this.trait = { bravery: 0.6 + Math.random() * 0.8, aggression: 0.6 + Math.random() * 0.8, discipline: 0.5 + Math.random() * 0.5 };
    this.order = null;           // set by the general / player captain
    this.path = null; this.pathT = 0;

    const { scene, clips } = spawnModel(team, type);
    // own copy of the toon materials, so a hit flash only lights up this unit
    this.mats = [];
    scene.traverse((o) => { if (o.isMesh && o.material && o.material.isMeshToonMaterial) { o.material = o.material.clone(); this.mats.push(o.material); } });
    this.flash = 0; this.lunge = 0; this.lungeDir = new THREE.Vector3();
    this.root = new THREE.Group();
    scene.scale.setScalar(this.s.scale);
    this.root.add(scene);
    this.root.position.copy(this.pos);
    game.scene.add(this.root);
    this.mixer = new THREE.AnimationMixer(scene);
    this.actions = {};
    for (const c of clips) {
      const a = this.mixer.clipAction(c);
      if (ONE_SHOT.has(c.name) || CLAMP.has(c.name)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      this.actions[c.name] = a;
    }
    this.current = null;
    this.play("idle");
    this.mixer.addEventListener("finished", (e) => { if (e.action === this.current && this.alive && e.action !== this.actions.block) this.current = null; });

    // ground ring (team colour, brighter for the player) + hp bar
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.42, 24), new THREE.MeshBasicMaterial({ color: TEAM[team].color, transparent: true, opacity: 0.55, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; this.root.add(ring); this.ring = ring;
    this.hpBar = makeBar(); this.hpBar.position.y = 1.25 * this.s.scale; this.root.add(this.hpBar);
  }

  play(name, fade = 0.15, timeScale = 1) {
    const a = this.actions[name]; if (!a) return;
    if (this.current === a && !ONE_SHOT.has(name)) { a.timeScale = timeScale; return; }
    // fade out EVERY other clip that still has weight: finished one-shots stay clamped on their last frame,
    // and if they are left at full weight they blend into (and shrink) every later swing
    let fadingOthers = false;
    for (const o of Object.values(this.actions)) {
      if (o !== a && o.enabled && o.isScheduled()) { o.fadeOut(fade); fadingOthers = true; }
    }
    a.reset(); a.timeScale = timeScale; a.enabled = true;
    a.setEffectiveWeight(1);
    if (fadingOthers) a.fadeIn(fade);
    a.play(); this.current = a;
  }
  busy() { return !!this.current && BUSY.has(this.current.getClip().name) && this.current.isRunning(); }
  // a random variant among the clips this model actually has
  variant(...names) { const have = names.filter((n) => this.actions[n]); return have.length ? pick(have) : names[0]; }
  // short "flavour" animations: kill reactions, captain rally, etc. Never interrupts an attack or a death.
  react(name) {
    if (!this.alive || !this.actions[name] || (this.busy() && this.current.getClip().name !== "idle_look")) return;
    this.play(name, 0.12);
  }

  // player archer: after a shot the base ring turns brown and a yellow arc fills it back up; full ring = ready to shoot
  updateReloadRing(k) {
    if (!this.cdArc) {
      this.cdArc = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xf1c40f, transparent: true, opacity: 0.95, depthWrite: false }));
      this.cdArc.rotation.x = -Math.PI / 2; this.cdArc.position.y = 0.025; this.root.add(this.cdArc); this.cdArcK = -1;
    }
    if (k >= 1) { this.cdArc.visible = false; this.ring.material.color.set(0xf1c40f); this.ring.material.opacity = 0.95; return; }
    this.ring.material.color.set(0x7a4a24); this.ring.material.opacity = 0.9;
    if (Math.abs(k - this.cdArcK) > 0.015) {
      this.cdArc.geometry.dispose();
      this.cdArc.geometry = new THREE.RingGeometry(0.34, 0.42, 40, 1, Math.PI / 2, Math.max(0.001, k * Math.PI * 2));
      this.cdArcK = k;
    }
    this.cdArc.rotation.z = -this.facing + (this.game.settings.side === "human" ? 0 : Math.PI);   // fill always starts at the top of the screen
    this.cdArc.visible = true;
  }
  setPlayer(on) {
    this.isPlayer = on;
    if (!on && this.cdArc) this.cdArc.visible = false;
    this.ring.material.color.set(on ? 0xf1c40f : TEAM[this.team].color);
    this.ring.material.opacity = on ? 0.95 : 0.55;
  }

  hpFrac() { return this.hp / this.maxHp; }
  dist(o) { return Math.hypot(o.pos.x - this.pos.x, o.pos.z - this.pos.z); }

  // ----- combat
  // sword reach, centre to centre. The player's own unit must really be at sword's length (~0.5 m between the
  // bodies) - AI units keep their longer, balance-tested reach.
  meleeReach(t) {
    return this.isPlayer && this.type !== "archer" ? this.radius + t.radius + 0.55 : this.s.range + t.radius;
  }
  // archer's bow-bash reach. The player's archer has no dead zone: anything too close to shoot gets bashed
  // (AI archers keep their tested reach)
  bashReach(t) {
    const r = this.s.bashRange + t.radius;
    return this.isPlayer ? Math.max(r, this.s.minRange + 0.05) : r;
  }
  // the player's melee: squarely facing the enemy when you pressed -> a slightly better blow; swinging at someone
  // off to the side or behind -> a weaker one. Tuned to average out (~2/3 of blows squared up = no net change).
  aimMult() {
    if (!this.isPlayer || this.type === "archer") return 1;
    const a = this.aimTurn ?? 0;
    return a < 0.6 ? 1.06 : a < 1.4 ? 0.94 : 0.82;
  }
  canAttack(t) {
    if (!t || !t.alive || this.cooldown > 0 || this.attackTimer > 0) return false;
    const d = this.dist(t);
    if (this.type === "archer") {
      if (d <= this.bashReach(t)) return true;                                 // too close to shoot: bash
      return d >= this.s.minRange && d <= this.s.range && this.game.world.lineClear(this.pos.x, this.pos.z, t.pos.x, t.pos.z);
    }
    return d <= this.meleeReach(t) + (this.reachBonus || 0);   // reachBonus: the player's step-in still to come
  }
  startAttack(t) {
    if (!this.canAttack(t)) return false;
    // how far we have to swing round to face the target (decides the archer's shot animation)
    const turn = Math.abs(angDiff(Math.atan2(t.pos.x - this.pos.x, t.pos.z - this.pos.z), this.facing));
    this.pendingTarget = t; this.attackTimer = this.s.windup; this.cooldown = this.s.cooldown * (0.9 + Math.random() * 0.2) / (this.type === "archer" ? (TEAM[this.team].archerRate ?? 1) : 1);
    // arcade feel for the player's melee: twice as many swings, half damage each -> same damage per second
    this.quick = this.isPlayer && this.type !== "archer";
    if (this.quick) { this.cooldown *= 0.5; this.attackTimer = this.s.windup * 0.6; }   // ~0.2 s from press to impact
    // the player's archer turns round to the target quickly but visibly (you see him spin and draw); everyone else snaps
    this.faceTo(t.pos.x, t.pos.z, !(this.isPlayer && this.type === "archer"));
    this.quick = this.isPlayer && this.type !== "archer";
    this.bashing = this.type === "archer" && this.dist(t) <= this.bashReach(t);
    if (this.bashing) { this.attackTimer = 0.3; this.cooldown = this.s.bashCooldown; this.play(this.variant("attack", "attack3"), 0.08, 1.2); this.game.sfx("swing"); }
    else if (this.type === "archer") {
      // target in front: the crisp, decisive shot; swinging round to the side / behind: the softer original one
      this.play(turn > 1.05 && this.actions.shoot_turn ? "shoot_turn" : "shoot", 0.1); this.game.sfx("draw"); this.cooldownMax = this.cooldown;
    }
    else {
      // the player's first swing after a pause is always the overhead chop: its opening IS the sword going up behind
      // the shoulder, so if the button turns out to be held, it flows straight into the heavy-blow stance.
      // Swings in a row (mashing) keep the variety.
      const fresh = this.quick && this.game.time - (this.lastSwingT ?? -9) > 1.0;
      if (this.quick) this.lastSwingT = this.game.time;
      if (fresh) {
        // undecided press: raise the sword at normal speed while we find out if it is a tap or a hold
        // (main.js decides: release -> the chop speeds up and lands; keep holding -> it rises on into the heavy stance)
        this.play("attack", 0.05, 1.0); this.freshPending = true; this.attackTimer = 0.6;
      } else {
        this.play(this.variant("attack", "attack2", "attack2", "attack3"), this.quick ? 0.05 : 0.08, this.quick ? 1.5 : 1.0);
        if (this.quick && this.current) this.current.time = 0.06;   // player: skip the first sliver of the wind-up -> snappier
      }
      this.game.sfx("swing");
    }
    return true;
  }
  // player pressed attack with nobody in reach: start the same undecided rise as a real swing (tap -> air swing,
  // hold -> heavy stance), so the sword only ever goes back first
  freshWhiff() {
    this.quick = true; this.heavy = false; this.bashing = false; this.pendingTarget = null;
    this.attackTimer = 0.6; this.cooldown = this.s.cooldown * 0.5; this.lastSwingT = this.game.time;
    this.play("attack", 0.05, 1.0); this.freshPending = true; this.game.sfx("swing");
  }
  // ---- player's heavy blow: hold the attack button -> raise the sword and hold it (charging) -> release
  startCharge() {
    if (this.charging || this.type === "archer" || !this.actions.attack) return;
    this.charging = true; this.chargeT = 0; this.chargeReady = false;
    const a = this.actions.attack;
    // already rising in the chop: keep rising smoothly and stop at the top (see update)
    if (this.current === a && a.time <= 0.34) { a.timeScale = 1.0; if (a.time >= 0.28) a.paused = true; return; }
    this.play("attack", 0.12, 1);
    a.time = 0.28; a.paused = true;    // the wind-up apex: blade back over the shoulder
  }
  cancelCharge() {
    if (!this.charging) return;
    this.charging = false; this.chargeReady = false;
    if (this.actions.attack) this.actions.attack.paused = false;
    this.play("idle", 0.15);
  }
  releaseHeavy(t) {
    // from the held pose straight into the strike: no second wind-up, the blow lands ~0.15 s after release
    this.charging = false; this.chargeReady = false;
    const a = this.actions.attack; a.paused = false; a.timeScale = 1.35;
    this.heavy = true; this.quick = false; this.bashing = false;
    this.pendingTarget = t && t.alive ? t : null; this.attackTimer = 0.15; this.cooldown = 0.55;
    if (t) this.faceTo(t.pos.x, t.pos.z, true);
    // (no step into it: the blow lands on whoever is within sword's length)
    this.game.sfx("swing");
  }
  resolveAttack() {
    if (this.heavy) {
      this.heavy = false;
      const t = this.pendingTarget; this.pendingTarget = null;
      if (!t || !t.alive || !this.alive || this.dist(t) > this.meleeReach(t) + 0.3) return;
      const dmg = Math.round(rint(this.s.dmg) * (this.type === "captain" ? 2 * PLAYER_CAPTAIN_DMG : 1.6) * this.aimMult());   // soldiers: a milder heavy blow
      this.heavyHit = true; const dealt = this.game.applyHit(this, t, dmg); this.heavyHit = false;
      // knock the target back half a metre (if there is room)
      const dx = t.pos.x - this.pos.x, dz = t.pos.z - this.pos.z, d = Math.hypot(dx, dz) || 1;
      if (t.alive && this.game.world.walkable(t.pos.x + dx / d * 0.55, t.pos.z + dz / d * 0.55)) { t.pos.x += dx / d * 0.55; t.pos.z += dz / d * 0.55; }
      this.game.onHeavy?.(this, t);
      return;
    }
    const t = this.pendingTarget; this.pendingTarget = null;
    if (!t || !t.alive || !this.alive) return;
    if (this.bashing) {
      if (this.dist(t) <= this.bashReach(t) + 0.35) this.game.applyHit(this, t, rint(this.s.bashDmg));
      return;
    }
    if (this.type === "archer") { this.game.fireArrow(this, t); return; }
    if (this.dist(t) > this.meleeReach(t) + (this.isPlayer ? 0.2 : 0.35)) return; // target stepped away
    const dmg = Math.round(rint(this.s.dmg) * (this.order?.charge ? 1.05 : 1));   // charging: a bit harder blows
    // the player's quick swings: full damage at twice the rate, and the captain hits harder still - the hero should
    // feel like one, but a lone charge into a crowd still ends badly (they all hit back, and they hunt the player)
    this.game.applyHit(this, t, this.quick ? Math.round(dmg * (this.type === "captain" ? PLAYER_CAPTAIN_DMG : 1) * this.aimMult()) : dmg);
  }
  takeHit(attacker, dmg, ranged) {
    if (!this.alive) return 0;
    // shield block: only when facing the attacker
    if (this.s.shield && !ranged && !attacker.heavyHit && !this.charging) {   // (no guard while your sword is raised)   // a heavy blow smashes through the guard
      const ang = Math.atan2(attacker.pos.x - this.pos.x, attacker.pos.z - this.pos.z);
      if (Math.abs(angDiff(ang, this.facing)) < 1.0 && Math.random() < (this.s.shield + (this.blocking > 0 ? 0.35 : 0) + (this.order?.hold ? 0.25 : 0)) * (this.order?.charge ? 0.5 : 1) * (attacker.isPlayer ? 0.5 : 1)) {
        this.play("block", 0.05); this.blocking = 0.35; this.game.sfx("block"); this.game.onBlock(attacker, this); return 0;
      }
    }
    if (this.order?.charge) dmg = Math.round(dmg * 1.15);   // charging: exposed, guard down
    this.hp -= dmg;
    this.morale -= dmg * 0.8 / this.trait.bravery * (this.order?.hold ? 0.5 : 1);   // holding the line steadies the nerves
    this.flash = 0.16;
    if (this.hp <= 0) {
      this.die(attacker);
      // the killer sometimes celebrates: skeletons cackle, humans raise their weapon
      if (attacker.alive && !attacker.isPlayer && Math.random() < 0.35) setTimeout(() => attacker.react(attacker.team === "skeleton" ? "laugh" : "cheer"), 250);
      return dmg;
    }
    if (!this.busy() && !this.charging && !this.heavy) this.play("hit", 0.05);
    return dmg;
  }
  die(killer) {
    this.alive = false; this.hp = 0;
    this.play(this.variant("death", "death_fwd", "death_back"), 0.1);
    this.ring.visible = false; this.hpBar.visible = false;
    this.game.onDeath(this, killer);
  }

  faceTo(x, z, snap = false) {
    const want = Math.atan2(x - this.pos.x, z - this.pos.z);
    this.wantFacing = want;            // always: otherwise the old heading (e.g. where you were running) pulls you back round
    if (snap) this.facing = want;
  }

  // desired velocity (set by controller) -> integrate with collisions
  // a short hop over a low fence (used when a unit got shoved into a fenced-in pocket)
  startHop(x, z) {
    this.hop = { fx: this.pos.x, fz: this.pos.z, tx: x, tz: z, t: 0 }; this.game.hops = (this.game.hops || 0) + 1;
    this.faceTo(x, z, true);
    if (this.actions.cheer2) this.play("cheer2", 0.05, 1.4);   // legs tuck + arms up: reads as a jump
  }
  update(dt, desired) {
    this.mixer.update(dt);
    if (this.charging && this.current === this.actions.attack && !this.actions.attack.paused && this.actions.attack.time >= 0.28) this.actions.attack.paused = true;
    if (this.hop && this.alive) {
      const h = this.hop; h.t = Math.min(1, h.t + dt / 0.42);
      this.pos.x = h.fx + (h.tx - h.fx) * h.t; this.pos.z = h.fz + (h.tz - h.fz) * h.t;
      this.root.position.set(this.pos.x, Math.sin(Math.PI * h.t) * 0.55, this.pos.z);
      this.root.rotation.y = this.facing;
      if (h.t >= 1) { this.hop = null; this.root.position.y = 0; this.vel.set(0, 0, 0); this.play("idle", 0.1); }
      return;
    }
    // white hit-flash (fades in ~0.16 s)
    if (this.flash > 0 || this.flashOn) {
      this.flash = Math.max(0, this.flash - dt);
      const k = this.flash / 0.16 * 0.85;
      for (const m of this.mats) m.emissive.setRGB(k, k, k);
      this.flashOn = this.flash > 0;
    }
    if (!this.alive) {
      this.deadT = (this.deadT || 0) + dt;
      if (this.deadT > 1.3 && !this.fading) {
        this.fading = true;
        for (const m of this.mats) { m.transparent = true; m.color.multiplyScalar(0.55); }
        this.root.traverse((o) => {
          if (o.isMesh) o.castShadow = false;    // a fading body must not keep a solid shadow
          if (o.isMesh && o.material && o.material.side === THREE.BackSide) o.visible = false;   // drop the outline
        });
      }
      if (this.fading) {
        // fade out where it lies (no sinking into the ground)
        const k = Math.min(1, (this.deadT - 1.3) / 2.8);
        for (const m of this.mats) m.opacity = 1 - k * k * (3 - 2 * k);
        if (k >= 1) this.root.visible = false;
      }
      return;
    }
    this.cooldown -= dt; this.blocking -= dt;
    if (this.attackTimer > 0) { this.attackTimer -= dt; if (this.attackTimer <= 0) this.resolveAttack(); }
    // the player keeps more mobility while swinging (arcade feel); AI units plant their feet
    const slow = this.charging ? 0.5 : this.attackTimer > 0 || this.busy() ? (this.isPlayer ? 0.55 : 0.25) : 1;
    const v = desired.clone().multiplyScalar(slow);

    // separation from other units
    for (const o of this.game.units) {
      if (o === this || !o.alive) continue;
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z, d = Math.hypot(dx, dz), min = this.radius + o.radius;
      if (d < min && d > 1e-4) { const push = (min - d) / min * 3.2; v.x += dx / d * push; v.z += dz / d * push; }
    }
    this.vel.lerp(v, Math.min(1, dt * (this.isPlayer ? 20 : 10)));   // snappier control for the player
    const nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt, w = this.game.world, r = this.radius * 0.8;
    // move, then resolve against the real obstacle outlines (sliding along walls happens naturally)
    this.pos.x = nx; this.pos.z = nz;
    // short step into the swing: applied straight to the position so it covers exactly the planned distance
    if (this.lunge > 0) {
      const k = Math.min(dt, this.lunge); this.lunge -= dt;
      this.pos.addScaledVector(this.lungeDir, (this.lungeSpeed ?? 4.2) * k);
      if (this.lunge <= 0) this.lungeSpeed = null;
    }
    // hard collision: never stand inside another living unit (each side of a pair resolves half the overlap)
    for (const o of this.game.units) {
      if (o === this || !o.alive) continue;
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z, d = Math.hypot(dx, dz), min = (this.radius + o.radius) * 0.92;
      if (d < min) {
        const ux = d > 1e-4 ? dx / d : Math.cos(this.id.length), uz = d > 1e-4 ? dz / d : Math.sin(this.id.length);
        const push = (min - d) * (o.team === this.team ? 0.5 : 0.65);
        const px = this.pos.x + ux * push, pz = this.pos.z + uz * push;
        this.pos.x = px; this.pos.z = pz;   // (walls are resolved right below)
      }
    }
    // solid obstacles: the body (radius + a small margin for shield / shoulders) stays out of their real outlines
    [this.pos.x, this.pos.z] = w.collide(this.pos.x, this.pos.z, this.radius + 0.06);
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (speed > 0.3 && !(this.attackTimer > 0) && !(this.type === "archer" && !this.isPlayer && this.busy())) this.wantFacing = Math.atan2(this.vel.x, this.vel.z);
    if (this.wantFacing !== undefined) this.facing += angDiff(this.wantFacing, this.facing) * Math.min(1, dt * (this.isPlayer ? 18 : 10));
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.facing;
    const holdingBlock = this.current === this.actions.block && this.blocking > 0;
    const curName = this.current ? this.current.getClip().name : "";
    const flavourRunning = (curName === "idle_look" || curName === "idle_tap") && this.current.isRunning();
    if (speed > 0.35) this.idleT = 0; else this.idleT = (this.idleT ?? 0) + dt;
    if (this.celebrating || this.charging || this.heavy) { /* keep cheering / hold the raised sword / finish the heavy blow */ }
    else if (!this.busy() && !holdingBlock) {
      if (speed > 0.35) this.play("walk", 0.2, Math.max(0.7, speed / 2.4));
      else if (this.morale < 28 && !this.isPlayer && this.actions.fear) this.play("fear", 0.3);
      else if (flavourRunning) { /* let the idle flourish finish */ }
      else if (this.idleT > (this.idleWait ??= 5 + Math.random() * 7) && !this.ended) {
        this.idleT = 0; this.idleWait = 6 + Math.random() * 8;
        this.play(this.variant("idle_look", "idle_tap"), 0.25);
      } else this.play("idle", 0.25);
    }
    // reload ring: the player's archer only (the heavy sword blow has no ring - you hear when it is ready)
    if (this.isPlayer && this.type === "archer") this.updateReloadRing(this.cooldown > 0 && this.cooldownMax ? Math.min(1, 1 - this.cooldown / this.cooldownMax) : 1);
    // hp bar faces camera, flash on hit
    const f = this.hpFrac(), fill = this.hpBar.userData.fill;
    fill.scale.x = Math.max(0.001, f); fill.position.x = -(1 - f) * 0.31;
    this.hpBar.quaternion.copy(this.game.camera.quaternion).premultiply(this.root.quaternion.clone().invert());
  }
}

function makeBar() {
  const g = new THREE.Group();
  // health left = deep muted green (always the same colour); the lost part = very dark brown.
  // (all three opaque: a transparent outline is drawn last and would darken the bar on top of it)
  const edge = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.11), new THREE.MeshBasicMaterial({ color: 0x0c0c0c, depthTest: false, toneMapped: false }));
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.075), new THREE.MeshBasicMaterial({ color: 0x3a2414, depthTest: false, toneMapped: false }));
  const fg = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.075), new THREE.MeshBasicMaterial({ color: 0x2f6e3a, depthTest: false, toneMapped: false }));
  bg.position.z = 0.001; fg.position.z = 0.002; edge.renderOrder = 10; bg.renderOrder = 11; fg.renderOrder = 12;
  g.add(edge, bg, fg); g.userData.fill = fg; return g;
}
export function rint([a, b]) { return a + Math.floor(Math.random() * (b - a + 1)); }
export function angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }
