// Campaign: a random overmap of battles to the enemy castle, an army that carries over (veterans, coins, shop),
// one autosave (after the shop) and a retry from the map after a defeat. Decisions in docs/campaign.md. The battle itself is the normal Game, started with
// game.campaignBattle = { armies, terrain, spawn, kind, defendT }.
import { CAPTAIN_TYPES, QUALITY, STATS, ROSTER } from "./config.js";
import { unitPortraits, UnitPreview } from "./assets.js";
import { drawMap } from "./overmap.js";
import { MapDiorama } from "./overmap3d.js";

export const PRICE = { soldier: 20, archer: 25, spearman: 25, shieldbearer: 30, scout: 25, brute: 45, mage: 45, support: 50, monster: 120,
  captain: 100, captain_ranged: 100, captain_heavy: 110 };
const SHOP = ["soldier", "archer", "spearman", "shieldbearer", "scout", "brute", "mage", "support", "monster", "captain", "captain_ranged", "captain_heavy"];
export const MAX_FIELD = 16, MAX_CAPTAINS = 3;
const KEY = (s) => `aib.campaign.${s}`;
const COLS = 8;              // 0 = your camp, 1..6 battles, 7 = the enemy castle
const TERRAINS = ["village", "forest", "open", "river", "graveyard", "ruins", "hills"];
// enemy armies have a CORE (a mass of one or two kinds, the look we like) and a few specials around it
const THEMES = {
  shieldwall: { core: ["soldier", "soldier", "shieldbearer"], extra: ["archer", "spearman", "support"] },
  arrows: { core: ["archer"], extra: ["soldier", "shieldbearer", "mage"] },
  spears: { core: ["spearman"], extra: ["archer", "soldier", "brute"] },
  magic: { core: ["mage", "archer", "archer"], extra: ["soldier", "shieldbearer", "support"] },
  horde: { core: ["brute", "scout", "soldier"], extra: ["monster", "archer"] },
  legion: { core: ["soldier"], extra: ["archer", "spearman", "brute", "mage", "support", "scout", "shieldbearer", "monster"] },
  mixed: { core: [], extra: ["soldier", "archer", "spearman", "shieldbearer", "scout", "brute", "mage", "support", "monster"] },
};
const LIMIT = { monster: 1, support: 2, mage: 3 };

const T = {
  el: {
    yourArmy: "Ο στρατός σου", sell: "Επιστροφή", back2: "Πίσω", train: "Εκπαίδευση: +1 ★",
    title: "Εκστρατεία", newC: "Νέα εκστρατεία", contC: "Συνέχεια", sure: "Σίγουρα; Νέος χάρτης", lost: "Ήττα",
    lostSub: "Ο στρατός σου γυρίζει στον χάρτη, όπως ήταν πριν ξεκινήσει για τη μάχη.", toMap: "Στον χάρτη", load: "Φόρτωση", back: "Πίσω", empty: "κενή", auto: "Αυτόματη",
    slot: (s) => (s === "auto" ? "Αυτόματη" : `Θέση ${s}`), save: "Αποθήκευση", saved: "Αποθηκεύτηκε", menu: "Μενού",
    fight: "Μάχη!", army: "Στρατός", cont: "Συνέχεια", coins: "νομίσματα", battle: "μάχη",
    kinds: { normal: "Μάχη", ambush: "Ενέδρα", defend: "Υπεράσπιση", elite: "Ισχυρός εχθρός", castle: "Το κάστρο" },
    kindHelp: { normal: "", ambush: "ξεκινάς κυκλωμένος από το πλάι", defend: (t) => `κράτα ${mmss(t)} ή νίκησέ τους`, elite: "δυσκολότερη, καλύτερη αμοιβή", castle: "η τελική μάχη" },
    terr: { village: "χωριό", forest: "δάσος", open: "ανοιχτός κάμπος", river: "ποτάμι", graveyard: "νεκροταφείο", ruins: "ερείπια", hills: "λόφοι" }, hill: "με λόφο",
    themes: { shieldwall: "τείχος ασπίδων", arrows: "βροχή βελών", spears: "λόγχες", magic: "μαγεία", horde: "ορδή", legion: "λεγεώνα", mixed: "λίγο απ' όλα" },
    power: ["εύκολη", "ισάξια", "δύσκολη", "πολύ δύσκολη"], enemies: "εχθροί", reward: "αμοιβή",
    pick: "Διάλεξε τον επόμενο κόμβο", inField: "στη μάχη", reserve: "εφεδρεία", lead: "Αρχηγός", makeLead: "Αρχηγός",
    shop: "Αγορά", roster: "Ο στρατός σου", fieldMax: `έως ${MAX_FIELD} στη μάχη`, capMax: `έως ${MAX_CAPTAINS} αρχηγοί`,
    won: "Νίκη!", fallen: "Έπεσαν", promoted: "Βετεράνοι", earned: "Κέρδη", survivors: "επιζώντες", fast: "γρήγορη νίκη",
    over: "Τέλος εκστρατείας", overSub: (n) => `Η ήττα είναι τελική. Νίκες: ${n}`, again: "Ξαναπροσπάθησε",
    victory: "Το κάστρο έπεσε!", victorySub: (n) => `Η εκστρατεία κερδήθηκε σε ${n} μάχες.`, noField: "Βάλε τουλάχιστον μία μονάδα στη μάχη",
    names: {
      human: { soldier: "Στρατιώτης", archer: "Τοξότης", spearman: "Λογχοφόρος", shieldbearer: "Ασπιδοφόρος", scout: "Ανιχνευτής", brute: "Βαρύς πολεμιστής",
        mage: "Μάγος", support: "Κληρικός", monster: "Γκόλεμ", captain: "Ιππότης", captain_ranged: "Αρχηγός-τοξότης", captain_heavy: "Παλαδίνος" },
      skeleton: { soldier: "Σκελετός", archer: "Τοξότης", spearman: "Λογχοφόρος", shieldbearer: "Ασπιδοφόρος", scout: "Γκουλ", brute: "Γίγαντας",
        mage: "Σκοτεινός μάγος", support: "Νεκρομάντης", monster: "Κολοσσός", captain: "Σκελετός-αρχηγός", captain_ranged: "Λιτς", captain_heavy: "Μαύρος ιππότης" },
    },
  },
  en: {
    yourArmy: "Your army", sell: "Refund", back2: "Back", train: "Training: +1 ★",
    title: "Campaign", newC: "New campaign", contC: "Continue", sure: "Sure? New map", lost: "Defeat",
    lostSub: "Your army goes back to the map, as it was before it set off for the battle.", toMap: "To the map", load: "Load", back: "Back", empty: "empty", auto: "Auto",
    slot: (s) => (s === "auto" ? "Autosave" : `Slot ${s}`), save: "Save", saved: "Saved", menu: "Menu",
    fight: "Battle!", army: "Army", cont: "Continue", coins: "coins", battle: "battle",
    kinds: { normal: "Battle", ambush: "Ambush", defend: "Defence", elite: "Strong enemy", castle: "The castle" },
    kindHelp: { normal: "", ambush: "you start flanked", defend: (t) => `hold ${mmss(t)} or beat them`, elite: "harder, better reward", castle: "the final battle" },
    terr: { village: "village", forest: "forest", open: "open field", river: "river", graveyard: "graveyard", ruins: "ruins", hills: "hills" }, hill: "with a hill",
    themes: { shieldwall: "shield wall", arrows: "rain of arrows", spears: "spears", magic: "magic", horde: "horde", legion: "legion", mixed: "a bit of everything" },
    power: ["easy", "even", "hard", "very hard"], enemies: "enemies", reward: "reward",
    pick: "Pick the next node", inField: "in battle", reserve: "reserve", lead: "Leader", makeLead: "Leader",
    shop: "Buy", roster: "Your army", fieldMax: `up to ${MAX_FIELD} in battle`, capMax: `up to ${MAX_CAPTAINS} captains`,
    won: "Victory!", fallen: "Fallen", promoted: "Veterans", earned: "Earned", survivors: "survivors", fast: "quick win",
    over: "Campaign over", overSub: (n) => `Defeat is final. Battles won: ${n}`, again: "Try again",
    victory: "The castle has fallen!", victorySub: (n) => `Campaign won in ${n} battles.`, noField: "Put at least one unit in the battle",
    names: {
      human: { soldier: "Soldier", archer: "Archer", spearman: "Spearman", shieldbearer: "Shieldbearer", scout: "Scout", brute: "Brute",
        mage: "Mage", support: "Cleric", monster: "Golem", captain: "Knight", captain_ranged: "Ranger", captain_heavy: "Paladin" },
      skeleton: { soldier: "Skeleton", archer: "Archer", spearman: "Spearman", shieldbearer: "Shieldbearer", scout: "Ghoul", brute: "Giant",
        mage: "Dark mage", support: "Necromancer", monster: "Colossus", captain: "Skeleton captain", captain_ranged: "Lich", captain_heavy: "Death Knight" },
    },
  },
};
const mmss = (t) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
const ROLE = {
  el: { soldier: "ο κορμός της γραμμής· ασπίδα, σταθερός", archer: "βέλη από μακριά· χωρίς πανοπλία", spearman: "μακριά λόγχη· σταματά όποιον ορμάει, αδύναμος στο πλάι",
    shieldbearer: "τεράστια ασπίδα· σταματά βέλη από μπροστά", scout: "πολύ γρήγορος· κυνηγά τοξότες και μάγους", brute: "πολλή ζωή· χτυπά δύο μαζί",
    mage: "έκρηξη σε περιοχή· πολύ λίγη ζωή", support: { human: "θεραπεύει και εμψυχώνει όσους είναι γύρω", skeleton: "σηκώνει ξανά τους πεσμένους" },
    monster: "τεράστιο· πετά τους εχθρούς γύρω του · 1 ανά μάχη", captain: "αρχηγός· διαταγές, εμψυχώνει", captain_ranged: "αρχηγός που ρίχνει από μακριά", captain_heavy: "βαρύς αρχηγός· χτυπά δύο μαζί" },
  en: { soldier: "the core of the line; shield, steady", archer: "arrows from afar; no armour", spearman: "long spear; stops chargers, weak on the flank",
    shieldbearer: "huge shield; stops arrows from the front", scout: "very fast; hunts archers and mages", brute: "lots of life; hits two at once",
    mage: "area blast; very little life", support: { human: "heals and steadies those around him", skeleton: "raises the fallen" },
    monster: "huge; throws enemies around it · 1 per battle", captain: "leader; orders, morale", captain_ranged: "a leader who shoots", captain_heavy: "heavy leader; hits two at once" },
};
const ICON = { camp: "⛺", normal: "⚔", ambush: "🗡", defend: "🛡", elite: "💀", castle: "🏰" };

function rng(seed) {   // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pickR = (r, a) => a[Math.floor(r() * a.length)];
export const trainCost = (e) => Math.round((PRICE[e.type] * 0.5 * ((e.vet || 0) + 1)) / 5) * 5;
export const unitValue = (e) => PRICE[e.type] * (1 + 0.35 * (e.vet || 0));
const armyValue = (list) => list.reduce((s, e) => s + unitValue(e), 0);
const isCap = (t) => CAPTAIN_TYPES.includes(t);

// an enemy army worth about `budget` coins: captain(s), a core and a few specials; leftover money -> veterans
function enemyArmy(budget, r, captains, themeName) {
  const theme = THEMES[themeName], out = [];
  for (let i = 0; i < captains; i++) out.push({ type: pickR(r, CAPTAIN_TYPES), vet: Math.min(3, Math.floor(budget / 500)) });
  let left = budget - armyValue(out);
  const count = (t) => out.filter((e) => e.type === t).length;
  for (let guard = 0; guard < 80 && out.length < MAX_FIELD && left >= 20; guard++) {
    const pool = theme.core.length && r() < 0.72 ? theme.core : theme.extra;
    const t = pickR(r, pool);
    if (LIMIT[t] && count(t) >= LIMIT[t]) continue;
    if (t === "monster" && (budget < 480 || out.length < 7)) continue;   // the monster only in strong armies, never instead of a core
    if (PRICE[t] > left) { if (left < 30) break; continue; }
    out.push({ type: t, vet: 0 }); left -= PRICE[t];
  }
  // a full army with money to spare: veterans
  for (let guard = 0; guard < 60 && left > 8; guard++) {
    const e = pickR(r, out); if ((e.vet || 0) >= 3) continue;
    const c = PRICE[e.type] * 0.35; if (c > left) continue;
    e.vet = (e.vet || 0) + 1; left -= c;
  }
  return out;
}

// the random overmap: columns of 2-3 nodes, paths between neighbouring columns (they may cross)
function makeMap(seed) {
  const r = rng(seed), cols = [];
  let id = 0;
  for (let c = 0; c < COLS; c++) {
    const n = c === 0 || c === COLS - 1 ? 1 : 2 + (r() < 0.5 ? 1 : 0);
    const col = [];
    for (let i = 0; i < n; i++) {
      const y = n === 1 ? 45 : 17 + (52 * i) / (n - 1) + (r() - 0.5) * 10;   // (room for mountains above and the sea below)
      col.push({ id: id++, col: c, x: 5 + (90 * c) / (COLS - 1) + (r() - 0.5) * 4, y });
    }
    cols.push(col);
  }
  const edges = [];
  for (let c = 0; c < COLS - 1; c++) {
    const a = cols[c], b = cols[c + 1], has = new Set();
    const add = (i, j) => { const k = `${a[i].id}-${b[j].id}`; if (!has.has(k)) { has.add(k); edges.push([a[i].id, b[j].id]); } };
    a.forEach((_, i) => add(i, a.length === 1 ? Math.floor(r() * b.length) : Math.round((i * (b.length - 1)) / (a.length - 1))));
    b.forEach((_, j) => { if (![...has].some((k) => k.endsWith(`-${b[j].id}`))) add(Math.round((j * (a.length - 1)) / Math.max(1, b.length - 1)), j); });
    for (let i = 0; i < a.length; i++) if (r() < 0.45) add(i, Math.max(0, Math.min(b.length - 1, Math.round((i * (b.length - 1)) / Math.max(1, a.length - 1)) + (r() < 0.5 ? -1 : 1))));
  }
  // what each battle is: the strength rises toward the castle, with plenty of random - and now and then a strong
  // enemy early on (visible in advance: the old-school "sneak a hard fight for the loot")
  for (const col of cols) for (const n of col) {
    if (n.col === 0) { n.kind = "camp"; continue; }
    const last = n.col === COLS - 1;
    // no planned easy or hard roads: every battle's strength is just random around its step's level
    const kind = last ? "castle" : pickR(r, ["normal", "normal", "normal", "ambush", "defend"]);
    // plenty of random, but steadier in the first two columns (a bad roll there should not wall you in)
    // the strength climbs faster toward the end: reaching (and taking) the castle should be something exceptional
    const base = 230 + n.col * 85 + n.col * n.col * 10;
    let budget = base * (n.col <= 2 ? 0.62 + r() * 0.35 : 0.72 + r() * 0.65);   // (column 2 comes right after the bloody opening)
    if (kind === "defend") budget *= 1.2;
    if (last) budget = base * 1.4;
    n.kind = kind;
    n.terrain = last ? "ruins" : pickR(r, TERRAINS);
    // high ground only on some battlefields: always on "hills", now and then on open / forest / ruins
    n.hills = n.terrain === "hills" ? 2 : ["open", "forest", "ruins"].includes(n.terrain) && r() < 0.35 ? 1 : 0;
    n.theme = last ? "legion" : pickR(r, Object.keys(THEMES));
    n.budget = Math.round(budget);
    n.army = enemyArmy(n.budget, r, last ? 3 : budget > base * 1.2 && r() < 0.4 ? 2 : 1, n.theme);   // a strong roll may bring a second captain
    n.reward = Math.round((n.budget * 0.27 * (last ? 2 : 1)) / 5) * 5;
    if (kind === "defend") n.defendT = 120 + Math.round(r() * 2) * 30;
  }
  return { cols, edges };
}

export class Campaign {
  constructor(game) {
    this.game = game; this.el = document.getElementById("camp"); this.body = document.getElementById("camp-body");
    this.state = null; this.lastResult = null;
    this.setupPad();
  }
  get t() { return T[this.game.settings.lang] || T.el; }
  name(type, team = this.state?.side || this.game.settings.side) { return this.t.names[team][type] || type; }

  // ---------------------------------------------------------------- screens
  show(html) {
    document.getElementById("menu").classList.add("hidden"); document.getElementById("end").classList.add("hidden");
    this.el.classList.remove("hidden"); this.body.innerHTML = html; this.focus = 0;
    this.armed = false; this.shownAt = performance.now();   // the press that opened this screen must not also click in it
    this.markFocus();
  }
  hide() { this.el.classList.add("hidden"); }
  toMenu() { this.hide(); this.game.campaignBattle = null; document.getElementById("menu").classList.remove("hidden"); }

  // ---------------------------------------------------------------- the skirmish ("Battle!"): a budget, the shop, then the fight
  // The budget: small / large, or random by default (the player is not told which). The enemy gets about the same
  // budget and builds its army blind - it never sees what you bought.
  skirmishShop() {
    this.mode = "skirmish";
    const b = this.game.settings.budget || "random", rnd = (a, z) => Math.round((a + Math.random() * (z - a)) / 5) * 5;
    const coins = b === "low" ? rnd(300, 380) : b === "high" ? rnd(620, 760) : rnd(300, 760);
    this.state = { side: this.game.settings.side, coins, budget: coins, roster: [], nextId: 1, lead: null, won: 0 };
    this.lastResult = null; this.campScreen();
  }
  startSkirmish() {
    const g = this.game, s = this.state, side = s.side, foe = side === "human" ? "skeleton" : "human";
    const themes = Object.keys(THEMES), enemy = enemyArmy(Math.round(s.budget * (0.9 + Math.random() * 0.2)), Math.random, 1, themes[Math.floor(Math.random() * themes.length)]);
    const mine = this.field().map((e) => ({ type: e.type, vet: 0, id: e.id, lead: e.id === s.lead }));
    g.campaignBattle = { armies: { [side]: mine, [foe]: enemy }, terrain: "village", hills: 0, spawn: null, kind: "skirmish" };
    g.settings.role = "captain";
    this.hide(); g.start();
  }
  openMenu() {
    this.mode = "campaign";
    const t = this.t, m = this.readSave();
    const info = m ? ` <small>${this.name(m.roster.find((e) => e.id === m.lead)?.type || "soldier", m.side)} · ${m.won} ${t.battle} · ${m.coins} ${t.coins}</small>` : "";
    this.show(`<h1>${t.title}</h1>
      ${m ? `<button class="big" data-act="cont">${t.contC}${info}</button>` : ""}
      <button class="big ${m ? "camp" : ""}" data-act="new">${t.newC}</button>
      <button data-act="menu">${t.back}</button>`);
    this.bind({ cont: () => this.resume(), new: () => this.newCampaign(), menu: () => this.toMenu() });
  }
  // one autosave: written when a new campaign starts and whenever you close the army / shop screen
  readSave() { try { return JSON.parse(localStorage.getItem(KEY("auto"))); } catch { return null; } }
  save() { try { localStorage.setItem(KEY("auto"), JSON.stringify(this.state)); } catch {} }
  resume() {
    this.mode = "campaign";
    const s = this.readSave(); if (!s) { this.newCampaign(); return; }
    this.state = s; this.lastResult = null;
    this.game.settings.side = s.side; this.game.settings.difficulty = s.difficulty;
    if (!s.won) { this.openingBattle(); return; }   // not past the first battle yet: straight into it again
    this.mapScreen();
  }

  newCampaign() {
    this.mode = "campaign";
    this.state = this.makeState(); this.lastResult = null; this.save();
    this.openingBattle();
  }
  openingBattle() {
    const n = this.state.map.cols[1].find((x) => x.opening) || this.next()[0];
    this.show(""); this.startBattle(n);
  }
  makeState() {
    const g = this.game, side = g.settings.side, seed = (Math.random() * 2 ** 31) | 0;
    let nid = 1;
    const e = (type) => ({ id: nid++, type, vet: 0, field: true });
    // the classic army, as in the original game: captain, 8 soldiers, 7 archers
    const roster = ROSTER.map(([type], i) => e(i === 0 ? g.settings.captain || "captain" : type));
    const map = makeMap(seed);
    // the opening battle (first column): the original game's battle - classic armies in the village
    const open = map.cols[1][Math.floor(Math.random() * map.cols[1].length)];
    Object.assign(open, { kind: "normal", terrain: "village", hills: 0, theme: "legion", budget: 435, reward: 240,   // (the first win brings reinforcements: rebuild after a bloody opening)
      army: ROSTER.map(([type]) => ({ type, vet: 0 })), opening: true });
    // the first column is just the opening battle: the others go, and it opens onto the whole second column
    const gone = new Set(map.cols[1].filter((n) => n !== open).map((n) => n.id));
    map.cols[1] = [open]; open.y = 45;
    map.edges = map.edges.filter(([x, y]) => !gone.has(x) && !gone.has(y) && !(x === 0 && y !== open.id));
    if (!map.edges.some(([x, y]) => x === 0 && y === open.id)) map.edges.push([0, open.id]);
    for (const n of map.cols[2]) if (!map.edges.some(([x, y]) => x === open.id && y === n.id)) map.edges.push([open.id, n.id]);
    return { v: 1, seed, side, difficulty: g.settings.difficulty, coins: 0, won: 0, map, pos: 0, visited: [0],
      roster, nextId: nid, lead: roster[0].id };
  }
  node(id) { for (const c of this.state.map.cols) for (const n of c) if (n.id === id) return n; return null; }
  next() { return this.state.map.edges.filter(([a]) => a === this.state.pos).map(([, b]) => this.node(b)); }
  field() { return this.state.roster.filter((e) => e.field); }
  powerLabel(n) {
    const ratio = n.budget * (this.game.settings.difficulty === "hard" ? 1.15 : this.game.settings.difficulty === "easy" ? 0.9 : 1) / Math.max(1, armyValue(this.field()));
    const i = ratio < 0.75 ? 0 : ratio < 1.05 ? 1 : ratio < 1.4 ? 2 : 3;
    return `<b class="pw pw${i}">${this.t.power[i]}</b>`;
  }

  mapScreen(selected) {
    const t = this.t, s = this.state, nx = this.next();
    this.sel = selected ?? nx[0]?.id;
    const nodes = s.map.cols.flat(), visited = new Set(s.visited);
    const btns = nodes.map((n) => {
      const reach = nx.includes(n);
      return `<button data-nid="${n.id}" class="node k-${n.kind} ${n.id === s.pos ? "here" : ""} ${visited.has(n.id) ? "done" : ""} ${reach ? "reach" : ""}" style="left:${n.x}%;top:${n.y}%"
        ${reach ? `data-act="sel" data-id="${n.id}"` : "tabindex=-1 disabled"} title="${t.kinds[n.kind] || ""}">${ICON[n.kind]}</button>`;
    }).join("");
    const me = this.node(s.pos);
    this.show(`<div class="maphead"><span>${t.title} · ${s.won} ${this.t.battle} · <b>${s.coins}</b> ${t.coins}</span></div>
      <div id="map"><canvas id="mapcv"></canvas>${btns}
        <div id="pawn" class="pawn ${s.side}" style="left:${me.x}%;top:${me.y}%"></div></div>
      <div id="nodeinfo"></div>
      <div class="bar"><button class="big" data-act="go">${t.fight}</button><button data-act="army">${t.army}</button>
        <button data-act="restart">${t.newC}</button><button data-act="menu">${t.menu}</button></div>`);
    this.bind({ sel: (b) => { this.sel = Number(b.dataset.id); this.nodeInfo(); }, go: () => this.go(), army: () => this.campScreen(),
      restart: (b) => { if (b.dataset.sure) this.newCampaign(); else { b.dataset.sure = 1; b.textContent = t.sure; } }, menu: () => this.toMenu() });
    this.nodeInfo();
    // the map: the 3D diorama (?map=2d: the painted one, kept for comparing)
    const cv = document.getElementById("mapcv"), lead = s.roster.find((e) => e.id === s.lead)?.type || s.roster[0]?.type || "soldier";
    this.diorama = null;
    if (new URLSearchParams(location.search).get("map") === "2d") requestAnimationFrame(() => drawMap(cv, s, nx, rng));
    else {
      document.getElementById("pawn")?.remove();
      document.getElementById("map").classList.add("d3");
      try {
        const d = this.diorama = new MapDiorama(cv, s, nx, rng, QUALITY[this.game.settings.quality] || QUALITY.medium, lead);
        // the node buttons follow the board (they sit over the canvas, in screen space)
        const btns = [...document.querySelectorAll("#map .node")];
        d.onFrame = () => { for (const b of btns) { const [x, y] = d.screenPos(this.node(Number(b.dataset.nid))); b.style.left = `${x}px`; b.style.top = `${y}px`; } d.onFrame = null; };
      } catch (e) { console.warn("diorama", e); requestAnimationFrame(() => drawMap(cv, s, nx, rng)); }
    }
    // start with the focus on the battle button, so A / Enter just goes
    this.focus = this.buttons().findIndex((b) => b.dataset.act === "go"); this.markFocus();
  }
  nodeInfo() {
    const t = this.t, n = this.node(this.sel), box = document.getElementById("nodeinfo"); if (!box) return;
    document.querySelectorAll("#map .node").forEach((b) => b.classList.toggle("picked", Number(b.dataset.id) === this.sel));
    if (!n) { box.innerHTML = t.pick; return; }
    const help = typeof t.kindHelp[n.kind] === "function" ? t.kindHelp[n.kind](n.defendT) : t.kindHelp[n.kind];
    const caps = n.army.filter((e) => isCap(e.type)).map((e) => this.name(e.type, this.enemy())).join(", ");
    box.innerHTML = `<b>${ICON[n.kind]} ${t.kinds[n.kind]}</b> · ${t.terr[n.terrain]}${n.hills === 1 ? ` ${t.hill}` : ""}${help ? ` · <i>${help}</i>` : ""}<br>
      ${n.army.length} ${t.enemies} (${t.themes[n.theme]}) · ${caps} · ${this.powerLabel(n)} · ${t.reward} ~${n.reward}`;
  }
  enemy() { return this.state.side === "human" ? "skeleton" : "human"; }

  flash(text) { const d = document.createElement("div"); d.className = "flash"; d.textContent = text; this.body.appendChild(d); setTimeout(() => d.remove(), 1200); }

  // ---------------------------------------------------------------- the army: results, shop, who goes into battle
  campScreen() {
    const t = this.t, s = this.state, r = this.lastResult;
    const res = r ? `<div class="result"><h2>${t.won}</h2>
        ${t.earned}: <b>+${r.coins}</b> (${t.reward} ${r.base} · ${r.survivors} ${t.survivors} +${r.surv}${r.fast ? ` · ${t.fast} +${r.fast}` : ""})<br>
        ${r.promoted.length ? `${t.promoted}: ${r.promoted.map((e) => `${this.name(e.type)} ${"★".repeat(e.vet)}`).join(", ")}<br>` : ""}
        ${r.fallen.length ? `${t.fallen}: ${r.fallen.map((e) => this.name(e.type)).join(", ")}` : ""}</div>` : "";
    const nField = this.field().length, nCap = s.roster.filter((e) => isCap(e.type)).length;
    const sk = this.mode === "skirmish";
    const rows = [...s.roster].sort((a, b) => (isCap(b.type) - isCap(a.type)) || a.type.localeCompare(b.type)).map((e) => `
      <div class="unit ${e.field ? "" : "res"}"><img class="ico" data-ico="${e.type}" alt=""><span class="nm">${this.name(e.type)} <span class="stars">${"★".repeat(e.vet || 0)}</span>${e.id === s.lead ? ` <b class="lead">${t.lead}</b>` : ""}</span>
        <button data-act="field" data-id="${e.id}">${e.field ? t.inField : t.reserve}</button>
        ${isCap(e.type) && e.id !== s.lead ? `<button data-act="lead" data-id="${e.id}">${t.makeLead}</button>` : ""}
        ${!sk && (e.vet || 0) < 3 ? `<button data-act="train" data-id="${e.id}" title="${t.train}" ${trainCost(e) > s.coins ? "disabled" : ""}>★+ <small>${trainCost(e)}</small></button>` : ""}
        ${sk ? `<button data-act="sell" data-id="${e.id}" title="${t.sell}">✕</button>` : ""}</div>`).join("");
    const shop = SHOP.map((type) => {
      const no = PRICE[type] > s.coins || (isCap(type) && nCap >= MAX_CAPTAINS);
      return `<button data-act="buy" data-type="${type}" ${no ? "disabled" : ""}><img class="ico" data-ico="${type}" alt="">${this.name(type)} <small>${PRICE[type]}</small></button>`;
    }).join("");
    this.show(`${res}<div class="maphead"><span><b>${s.coins}</b> ${t.coins}</span><span>${nField}/${MAX_FIELD} ${t.inField} · ${t.capMax}</span></div>
      <h3>${t.shop}</h3><div class="shopwrap"><div class="shop">${shop}</div>
        <div class="prev"><canvas id="unitprev"></canvas><div id="prevtxt"></div></div></div>
      <h3>${sk ? t.yourArmy : t.roster}</h3><div class="roster">${rows}</div>
      <div class="bar"><button class="big" data-act="cont">${sk ? t.fight : t.cont}</button>${sk ? `<button data-act="menu">${t.back2}</button>` : ""}</div>`);
    this.bind({
      buy: (b) => {
        const type = b.dataset.type; if (PRICE[type] > s.coins) return;
        s.coins -= PRICE[type];
        const e = { id: s.nextId++, type, vet: 0, field: this.field().length < MAX_FIELD };
        s.roster.push(e); if (isCap(type) && !s.roster.some((x) => x.id === s.lead)) s.lead = e.id;
        this.campScreen();
      },
      field: (b) => {
        const e = s.roster.find((x) => x.id === Number(b.dataset.id));
        if (!e.field && this.field().length >= MAX_FIELD) return;
        e.field = !e.field; this.fixLead(); this.campScreen();
      },
      lead: (b) => { const e = s.roster.find((x) => x.id === Number(b.dataset.id)); s.lead = e.id; e.field = true; this.campScreen(); },
      cont: () => {
        if (!this.field().length) { this.flash(t.noField); return; }
        if (sk) { this.startSkirmish(); return; }
        this.lastResult = null; this.save(); this.mapScreen();
      },
      train: (b) => {
        const e = s.roster.find((x) => x.id === Number(b.dataset.id)), c = trainCost(e);
        if ((e.vet || 0) >= 3 || c > s.coins) return;
        s.coins -= c; e.vet = (e.vet || 0) + 1; this.campScreen();
      },
      sell: (b) => { const e = s.roster.find((x) => x.id === Number(b.dataset.id)); s.coins += PRICE[e.type]; s.roster = s.roster.filter((x) => x !== e); this.fixLead(); this.campScreen(); },
      menu: () => this.toMenu(),
    });
    this.fillIcons();
    // the big turning model of the unit you point at (mouse) or are on (pad / keys)
    const cv = document.getElementById("unitprev");
    if (cv) {
      try { this.preview = new UnitPreview(cv, QUALITY[this.game.settings.quality] || QUALITY.medium); } catch (e) { console.warn("preview", e); }
      for (const b of this.body.querySelectorAll("button")) b.addEventListener("mouseenter", () => this.previewFor(b));
      this.previewType(this.prevType || "soldier");
    }
  }
  previewFor(b) {
    const type = b.dataset.type || b.closest(".unit")?.querySelector("img[data-ico]")?.dataset.ico;
    if (type) this.previewType(type);
  }
  previewType(type) {
    this.prevType = type;
    const side = this.state.side, t = this.t, st = STATS[type], role = (ROLE[this.game.settings.lang] || ROLE.el)[type];
    this.preview?.show(side, type, st.scale > 1.2 ? 0.92 : 1);
    const box = document.getElementById("prevtxt");
    if (box) box.innerHTML = `<b>${this.name(type)}</b> <small>${PRICE[type]}</small><br><i>${typeof role === "object" ? role[side] : role}</i><br>
      <small>❤ ${st.hp} · ⚔ ${st.dmg[0]}-${st.dmg[1]}${st.ranged ? ` · 🎯 ${st.range}` : ""}</small>`;
  }
  // portraits from the real 3D models (rendered once, then cached)
  async fillIcons() {
    try {
      const icons = await unitPortraits(QUALITY[this.game.settings.quality] || QUALITY.medium, this.state.side, SHOP);
      for (const img of this.body.querySelectorAll("img[data-ico]")) if (icons[img.dataset.ico]) img.src = icons[img.dataset.ico];
    } catch (e) { console.warn("portraits", e); }
  }
  // the leader must be a captain in the battle; otherwise the next captain who is (or nobody: you fight without one)
  fixLead() {
    const s = this.state, cur = s.roster.find((e) => e.id === s.lead);
    if (cur && cur.field && isCap(cur.type)) return;
    s.lead = s.roster.find((e) => e.field && isCap(e.type))?.id ?? null;
  }

  // ---------------------------------------------------------------- battle
  go() {
    const n = this.node(this.sel); if (!n || !this.next().includes(n)) return;
    if (!this.field().length) { this.campScreen(); return; }
    if (this.going) return; this.going = true;
    const start = () => { this.going = false; this.startBattle(n); };
    if (this.diorama && !this.diorama.disposed) { this.diorama.moveTo(n, start); return; }   // the miniature walks the road
    const pawn = document.getElementById("pawn");
    if (pawn) { pawn.style.left = `${n.x}%`; pawn.style.top = `${n.y}%`; }   // (2d map) the pawn slides along the path
    setTimeout(start, 950);
  }
  startBattle(n) {
    const g = this.game, s = this.state, side = s.side, foe = this.enemy();
    this.fighting = n;
    g.campaignBattle = this.battleSpec(n);
    g.settings.role = "captain";
    this.hide();
    g.start();
  }
  battleSpec(n) {
    const s = this.state, side = s.side, foe = this.enemy();
    const mine = this.field().map((e) => ({ type: e.type, vet: e.vet, id: e.id, lead: e.id === s.lead }));
    const armies = { [side]: mine, [foe]: n.army.map((e) => ({ ...e })) };
    let spawn = null;
    if (n.kind === "ambush") {
      // you are marching up the middle; they come at your flank from close by
      const z = 0.25 * (side === "human" ? 27 : -27), from = Math.random() < 0.5 ? -1 : 1;
      spawn = { [side]: { x: 0, z, facing: side === "human" ? Math.PI : 0 }, [foe]: { x: from * 15, z: z * 0.6, facing: from < 0 ? Math.PI / 2 : -Math.PI / 2 } };
    }
    return { armies, terrain: n.terrain, hills: n.hills || 0, spawn, kind: n.kind, defendT: n.defendT || 0 };
  }
  // called by Game.finish
  afterBattle(won, info) {
    const n = this.fighting; this.fighting = null;
    this.game.campaignBattle = null;
    if (!won) { this.defeat(); return; }
    this.applyWin(n, info);
    if (n.kind === "castle") { this.victory(); try { localStorage.removeItem(KEY("auto")); } catch {} return; }
    this.campScreen();   // (saved when you close it)
  }
  // a won battle: veterans, the fallen, coins, the pawn moves on (shared by the game and the simulator)
  applyWin(n, info) {
    const s = this.state;
    const alive = new Set(info.alive), fallen = [], promoted = [];
    for (const e of this.field()) {
      if (alive.has(e.id)) { if ((e.vet || 0) < 3) { e.vet = (e.vet || 0) + 1; promoted.push(e); } }
      else fallen.push(e);
    }
    s.roster = s.roster.filter((e) => !fallen.includes(e));
    this.fixLead();
    const surv = alive.size * 2, fast = info.time < 150 ? Math.round(n.reward * 0.2) : 0;
    const coins = n.reward + surv + fast;
    s.coins += coins; s.won++; s.pos = n.id; s.visited.push(n.id);
    this.lastResult = { coins, base: n.reward, survivors: alive.size, surv, fast, fallen, promoted };
  }

  // ---------------------------------------------------------------- dev: whole campaigns played headless (?campsim=N)
  // A sensible player: keeps a core (soldiers + archers), adds a few specials, takes the easier road most of the
  // time (now and then a bold one), retries from the autosave after a defeat (gives up after 6 tries at one node).
  shopSim() {
    const s = this.state, has = (t) => s.roster.filter((e) => e.type === t).length;
    const want = () => {
      if (has("soldier") < 6) return "soldier";
      if (has("archer") < 4) return "archer";
      if (s.coins >= 160 && !has("monster")) return "monster";
      return ["spearman", "shieldbearer", "mage", "support", "brute", "archer", "soldier", "spearman"][s.won % 8];
    };
    for (let guard = 0; guard < 30; guard++) {
      const t = want(); if (PRICE[t] > s.coins || s.roster.length >= MAX_FIELD + 6) break;   // a reserve of up to 6
      s.coins -= PRICE[t]; s.roster.push({ id: s.nextId++, type: t, vet: 0, field: true });
    }
    for (let guard = 0; guard < 60; guard++) {
      const c = s.roster.filter((e) => (e.vet || 0) < 3).sort((x, y) => trainCost(x) - trainCost(y))[0];
      if (!c || trainCost(c) > s.coins) break;
      s.coins -= trainCost(c); c.vet = (c.vet || 0) + 1;
    }
    // the best 16 go into battle (captains, then by worth: veterans and specials first)
    const best = [...s.roster].sort((x, y) => (isCap(y.type) - isCap(x.type)) || unitValue(y) - unitValue(x)).slice(0, MAX_FIELD);
    s.roster.forEach((e) => { e.field = best.includes(e); }); this.fixLead();
  }
  pickSim(retry) {
    const nx = this.next(); if (!nx.length) return null;
    const ratio = (n) => n.budget / Math.max(1, armyValue(this.field()));
    const sorted = [...nx].sort((a, b) => ratio(a) - ratio(b));
    return Math.random() < 0.2 && !retry ? sorted[sorted.length - 1] : sorted[0];
  }
  async simulate(runs) {
    const out = [];
    for (let k = 0; k < runs; k++) {
      this.state = this.makeState(); this.shopSim();
      let saved = JSON.stringify(this.state), tries = 0, defeats = 0, log = [];
      for (let guard = 0; guard < 40; guard++) {
        const n = this.state.won ? this.pickSim(tries > 0) : this.state.map.cols[1][0]; if (!n) break;
        const r = await this.game.runCampaignBattle(this.battleSpec(n));
        if (!r.won) {
          defeats++; tries++; log.push(`L${n.col}${n.kind[0]}`);
          if (tries > 6) break;
          this.state = JSON.parse(saved); continue;
        }
        tries = 0; this.applyWin(n, r);
        log.push(`W${n.col}${n.kind[0]}(${this.field().length},${this.state.coins})`);
        if (n.kind === "castle") break;
        this.shopSim(); saved = JSON.stringify(this.state);
      }
      const won = this.state.won, castle = this.node(this.state.pos)?.kind === "castle";
      out.push({ castle, won, defeats, army: this.state.roster.length, coins: this.state.coins, log: log.join(" ") });
      document.getElementById("general-line").textContent = `CAMPSIM ${k + 1}/${runs}: castle ${out.filter((o) => o.castle).length}`;
    }
    window.__campSim = out; console.log("[CAMPSIM]", JSON.stringify(out));
    return out;
  }
  defeat() {
    const t = this.t;
    this.show(`<h1>${t.lost}</h1><p>${t.lostSub}</p>
      <button class="big" data-act="back">${t.toMap}</button><button data-act="again">${t.newC}</button>`);
    this.bind({ back: () => this.resume(), again: () => this.newCampaign() });
  }
  victory() {
    const t = this.t;
    this.show(`<h1>${t.victory}</h1><p>${t.victorySub(this.state.won)}</p>
      <button class="big" data-act="again">${t.newC}</button><button data-act="menu">${t.menu}</button>`);
    this.bind({ again: () => this.newCampaign(), menu: () => this.toMenu() });
  }

  // ---------------------------------------------------------------- input: mouse, arrow keys, gamepad
  bind(acts) {
    this.acts = acts;
    for (const b of this.body.querySelectorAll("button[data-act]")) b.onclick = () => this.acts[b.dataset.act]?.(b);
  }
  buttons() { return [...this.body.querySelectorAll("button:not([disabled])")]; }
  markFocus() {
    const bs = this.buttons(); if (!bs.length) return;
    this.focus = Math.max(0, Math.min(bs.length - 1, this.focus || 0));
    bs.forEach((b, i) => b.classList.toggle("padfocus", i === this.focus));
  }
  move(d) {
    document.body.classList.add("padnav");
    const bs = this.buttons(); if (!bs.length) return;
    this.focus = (this.focus + d + bs.length) % bs.length; this.markFocus();
    const b = bs[this.focus]; b.scrollIntoView?.({ block: "nearest" });
    if (b.dataset.act === "sel") { this.sel = Number(b.dataset.id); this.nodeInfo(); }
    if (this.preview && !this.preview.disposed) this.previewFor(b);
  }
  press() { const b = this.buttons()[this.focus]; if (b) b.click(); }
  setupPad() {
    const open = () => !this.el.classList.contains("hidden");
    addEventListener("keydown", (e) => {
      if (!open()) return;
      if (e.repeat || performance.now() - this.shownAt < 200) { e.preventDefault(); return; }
      const d = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[e.key];
      if (d) { this.move(d); e.preventDefault(); }
      if (e.key === "Enter" || e.key === " ") { document.body.classList.add("padnav"); this.press(); e.preventDefault(); }
    });
    let prev = {};
    const poll = () => {
      requestAnimationFrame(poll);
      if (!open()) { prev = {}; return; }
      const p = [...(navigator.getGamepads ? navigator.getGamepads() : [])].find(Boolean); if (!p) return;
      const ax = p.axes[0] || 0, ay = p.axes[1] || 0, btn = (i) => !!(p.buttons[i] && p.buttons[i].pressed);
      const now = { prev: btn(12) || btn(14) || ay < -0.6 || ax < -0.6, next: btn(13) || btn(15) || ay > 0.6 || ax > 0.6, ok: btn(0) || btn(9) };
      if (!this.armed) { if (!now.ok && !now.prev && !now.next) this.armed = true; prev = now; return; }
      if (now.prev && !prev.prev) this.move(-1);
      if (now.next && !prev.next) this.move(1);
      if (now.ok && !prev.ok) this.press();
      prev = now;
    };
    poll();
  }
}
