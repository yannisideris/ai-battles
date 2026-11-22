// Game-wide tuning. Distances in world units (a unit is ~1 tall), times in seconds.
export const MAP_W = 48;   // x: -24 .. 24
export const MAP_H = 66;   // z: -33 .. 33 (skeletons spawn north / negative z, humans south)

export const STATS = {
  soldier: { hp: 120, speed: 2.5, range: 1.15, dmg: [6, 9],   cooldown: 1.5, windup: 0.33, shield: 0.30, scale: 1.0 },
  archer:  { hp: 72, speed: 2.7, range: 10,   minRange: 1.6, dmg: [5, 7], cooldown: 2.4, windup: 0.70, shield: 0,  scale: 1.0, longShot: 7.5,
             bashRange: 1.15, bashDmg: [2, 4], bashCooldown: 1.3 },   // weak close-quarters hit with the bow / a knife
  captain: { hp: 200, speed: 2.5, range: 1.25, dmg: [10, 14], cooldown: 1.6, windup: 0.33, shield: 0.35, scale: 1.15 },
  // ---- campaign roles (same numbers for both sides, only the look differs; see docs/campaign.md)
  // spearman: long reach, braced against anyone running at him (brace), weak when hit from the side/back (flankTaken)
  spearman: { hp: 110, speed: 2.4, range: 1.75, dmg: [6, 9], cooldown: 1.7, windup: 0.4, shield: 0.12, scale: 1.0, brace: 1.6, flankTaken: 1.35 },
  // brute: lots of life, slow, no shield, every swing also catches a second enemy next to the target (cleave)
  brute: { hp: 230, speed: 2.05, range: 1.4, dmg: [10, 14], cooldown: 2.1, windup: 0.5, shield: 0, scale: 1.25, cleave: 0.7 },
  // shieldbearer: tower shield - blocks most blows and arrows from the front, slow, weak blows
  shieldbearer: { hp: 160, speed: 2.1, range: 1.1, dmg: [3, 5], cooldown: 1.6, windup: 0.33, shield: 0.55, arrowBlock: 0.8, scale: 1.0 },
  // support: cleric heals + steadies the units around him; necromancer raises the fallen (ability every N s)
  support: { hp: 85, speed: 2.4, range: 1.1, dmg: [3, 5], cooldown: 1.6, windup: 0.35, shield: 0, scale: 1.0, ability: 11, auraR: 4.0, heal: 8, raiseHp: 0.45, raiseEvery: 14 },
  // battle mage: slow area blast that breaks up tight formations, very little life
  mage: { hp: 55, speed: 2.4, range: 9, minRange: 2.4, dmg: [13, 19], cooldown: 5.5, windup: 1.0, shield: 0, scale: 1.0, ranged: "magic", splash: 1.9, soft: true,
          bashRange: 1.1, bashDmg: [2, 4], bashCooldown: 1.4, longShot: 99 },
  // scout: very fast, hunts archers / mages / healers, little life
  scout: { hp: 72, speed: 3.7, range: 1.05, dmg: [5, 8], cooldown: 1.0, windup: 0.25, shield: 0, scale: 1.0, hunter: 6, engage: 12 },
  // monster (elite, 1 per battle): huge, slow, the slam throws units around it
  monster: { hp: 460, speed: 1.8, range: 1.75, dmg: [16, 22], cooldown: 2.8, windup: 0.6, shield: 0, scale: 1.25, slam: 2.0, knock: 2.2 },
  // the two extra captains: a ranged one (human ranger / skeleton lich) and a heavy one (paladin / death knight)
  captain_ranged: { hp: 170, speed: 2.6, range: 10, minRange: 1.6, dmg: [8, 11], cooldown: 2.2, windup: 0.7, shield: 0, scale: 1.15, ranged: "arrow", longShot: 7.5, captain: true,
                    bashRange: 1.2, bashDmg: [5, 8], bashCooldown: 1.2 },
  captain_heavy: { hp: 230, speed: 2.3, range: 1.35, dmg: [12, 16], cooldown: 1.8, windup: 0.4, shield: 0.25, scale: 1.15, captain: true, cleave: 0.5 },
};
STATS.archer.ranged = "arrow"; STATS.archer.soft = true; STATS.captain.captain = true;

// unit roles by job (used by the AI and the formation)
export const LINE_TYPES = ["soldier", "spearman", "brute", "shieldbearer", "scout", "monster"];   // the melee front line
export const BACK_TYPES = ["archer", "mage", "support"];                                         // the back line
export const CAPTAIN_TYPES = ["captain", "captain_ranged", "captain_heavy"];

// a formation for any list of unit types: front line, captain behind it, back line (x, distance behind the front)
export function formation(types) {
  const front = types.filter((t) => LINE_TYPES.includes(t)), back = types.filter((t) => BACK_TYPES.includes(t));
  const caps = types.filter((t) => CAPTAIN_TYPES.includes(t));
  const out = [];
  caps.forEach((t, i) => out.push([t, (i - (caps.length - 1) / 2) * 1.6, 1.6]));
  front.forEach((t, i) => out.push([t, (i - (front.length - 1) / 2) * 1.6, 0]));
  back.forEach((t, i) => out.push([t, (i - (back.length - 1) / 2) * 1.8, 3 + (i % 2) * 0.4]));
  return out;
}
// skirmish armies: "classic" is the v1.0 line-up (unchanged), "mixed" uses every role
export const ARMIES = {
  mixed: ["captain", "shieldbearer", "spearman", "soldier", "brute", "monster", "soldier", "spearman", "shieldbearer", "scout",
          "archer", "archer", "mage", "support", "archer", "archer"],
};

// 16 vs 16: 1 captain, 8 soldiers, 7 archers.
export const ROSTER = [
  ["captain", 0, 1.6],
  ...[-5.6, -4, -2.4, -0.8, 0.8, 2.4, 4, 5.6].map((x) => ["soldier", x, 0]),
  ...[-5.4, -3.6, -1.8, 0, 1.8, 3.6, 5.4].map((x, i) => ["archer", x, 3 + (i % 2) * 0.4]),
];

// enemy behaviour per difficulty (only the AI side opposite the player is affected)
export const DIFFICULTY = {
  easy:   { dmg: 0.9,  hp: 0.95, think: 0.35, flank: false, focus: 2, huntCaptain: 0,   obey: 0.1 },
  normal: { dmg: 1.0,  hp: 1.0,  think: 0.25, flank: true,  focus: 4, huntCaptain: 1,   obey: 0 },
  hard:   { dmg: 1.12, hp: 1.15, think: 0.15, flank: true,  focus: 7, huntCaptain: 3.5, obey: -0.1 },
};

export const TEAM = {
  human:    { name: "Humans",    color: 0x3fa7c9, spawnZ: 27,  facing: Math.PI },
  skeleton: { name: "Skeletons", color: 0xe46aa8, spawnZ: -27, facing: 0, archerRate: 1.0 },   // archerRate: balance trim knob (0.98 was needed before the obstacle-collision change, not after)
};

export const QUALITY = {
  low:    { pixelRatio: 0.75, shadows: false, shadowSize: 512,  maxFps: 45, outline: false },
  medium: { pixelRatio: 1.0,  shadows: true,  shadowSize: 1024, maxFps: 60, outline: true },
  high:   { pixelRatio: 1.5,  shadows: true,  shadowSize: 2048, maxFps: 60, outline: true },
};

const M = (n) => `assets/models/${n}.glb`;
export const MODEL_FILES = {
  human: {
    captain: M("human_captain"), soldier: M("human_soldier"), archer: M("human_archer"),
    spearman: M("human_spearman"), brute: M("human_brute"), shieldbearer: M("human_shieldbearer"), support: M("human_cleric"),
    mage: M("human_mage"), scout: M("human_scout"), monster: M("human_golem"),
    captain_ranged: M("human_ranger_captain"), captain_heavy: M("human_paladin_captain"),
  },
  skeleton: {
    captain: M("skeleton_captain"), soldier: M("skeleton_soldier"), archer: M("skeleton_archer"),
    spearman: M("skeleton_spearman"), brute: M("skeleton_brute"), shieldbearer: M("skeleton_shieldbearer"), support: M("skeleton_necromancer"),
    mage: M("skeleton_mage"), scout: M("skeleton_ghoul"), monster: M("skeleton_colossus"),
    captain_ranged: M("skeleton_lich_captain"), captain_heavy: M("skeleton_deathknight_captain"),
  },
};
