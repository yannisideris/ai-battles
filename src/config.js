// Game-wide tuning. Distances in world units (a unit is ~1 tall), times in seconds.
export const MAP_W = 48;   // x: -24 .. 24
export const MAP_H = 66;   // z: -33 .. 33 (skeletons spawn north / negative z, humans south)

export const STATS = {
  soldier: { hp: 120, speed: 2.5, range: 1.15, dmg: [6, 9],   cooldown: 1.5, windup: 0.33, shield: 0.30, scale: 1.0 },
  archer:  { hp: 72, speed: 2.7, range: 10,   minRange: 1.6, dmg: [5, 7], cooldown: 2.4, windup: 0.70, shield: 0,  scale: 1.0, longShot: 7.5,
             bashRange: 1.15, bashDmg: [2, 4], bashCooldown: 1.3 },   // weak close-quarters hit with the bow / a knife
  captain: { hp: 200, speed: 2.5, range: 1.25, dmg: [10, 14], cooldown: 1.6, windup: 0.33, shield: 0.35, scale: 1.15 },
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
  skeleton: { name: "Skeletons", color: 0xe46aa8, spawnZ: -27, facing: 0, archerRate: 0.98 },   // archerRate: tiny balance trim (0.95 overshot in 80 sims)
};

export const QUALITY = {
  low:    { pixelRatio: 0.75, shadows: false, shadowSize: 512,  maxFps: 45, outline: false },
  medium: { pixelRatio: 1.0,  shadows: true,  shadowSize: 1024, maxFps: 60, outline: true },
  high:   { pixelRatio: 1.5,  shadows: true,  shadowSize: 2048, maxFps: 60, outline: true },
};

export const MODEL_FILES = {
  human:    { captain: "assets/models/human_captain.glb",    soldier: "assets/models/human_soldier.glb",    archer: "assets/models/human_archer.glb" },
  skeleton: { captain: "assets/models/skeleton_captain.glb", soldier: "assets/models/skeleton_soldier.glb", archer: "assets/models/skeleton_archer.glb" },
};
