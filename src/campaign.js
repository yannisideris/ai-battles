// Campaign: a random overmap of battles to the enemy castle, an army that carries over (veterans, coins, shop),
// save slots and game over. Decisions in docs/campaign.md. The battle itself is the normal Game, started with
// game.campaignBattle = { armies, terrain, spawn, kind, defendT }.
import { CAPTAIN_TYPES, QUALITY, STATS } from "./config.js";
import { unitPortraits, UnitPreview } from "./assets.js";
import { drawMap } from "./overmap.js";

export const PRICE = { soldier: 20, archer: 25, spearman: 25, shieldbearer: 30, scout: 25, brute: 45, mage: 45, support: 50, monster: 120,
  captain: 100, captain_ranged: 100, captain_heavy: 110 };
const SHOP = ["soldier", "archer", "spearman", "shieldbearer", "scout", "brute", "mage", "support", "monster", "captain", "captain_ranged", "captain_heavy"];
export const MAX_FIELD = 16, MAX_CAPTAINS = 3;
const SLOTS = ["auto", "1", "2", "3"];
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
    title: "Εκστρατεία", newC: "Νέα εκστρατεία", load: "Φόρτωση", back: "Πίσω", empty: "κενή", auto: "Αυτόματη",
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
    title: "Campaign", newC: "New campaign", load: "Load", back: "Back", empty: "empty", auto: "Auto",
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
    let kind = last ? "castle" : pickR(r, ["normal", "normal", "normal", "ambush", "defend", "elite"]);
    if (!last && n.col <= 3 && r() < 0.12) kind = "elite";
    let budget = (230 + n.col * 85) * (0.72 + r() * 0.65);
    if (kind === "elite") budget *= 1.5 + (n.col <= 3 ? 0.35 : 0);
    if (kind === "defend") budget *= 1.3;
    if (last) budget = (230 + n.col * 85) * 1.45;
    n.kind = kind;
    n.terrain = last ? "ruins" : pickR(r, TERRAINS);
    // high ground only on some battlefields: always on "hills", now and then on open / forest / ruins
    n.hills = n.terrain === "hills" ? 2 : ["open", "forest", "ruins"].includes(n.terrain) && r() < 0.35 ? 1 : 0;
    n.theme = last ? "legion" : pickR(r, Object.keys(THEMES));
    n.budget = Math.round(budget);
    n.army = enemyArmy(n.budget, r, last ? 3 : kind === "elite" && r() < 0.5 ? 2 : 1, n.theme);
    n.reward = Math.round((n.budget * 0.3 * (kind === "elite" ? 1.6 : 1) * (last ? 2 : 1)) / 5) * 5;
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

  openMenu() {
    const t = this.t;
    this.show(`<h1>${t.title}</h1>
      <button class="big" data-act="new">${t.newC}</button>
      <h3>${t.load}</h3><div class="slots">${this.slotButtons("load")}</div>
      <button data-act="menu">${t.back}</button>`);
    this.bind({ new: () => this.newCampaign(), menu: () => this.toMenu() });
  }
  slotButtons(act) {
    return SLOTS.map((s) => {
      const m = this.readSlot(s);
      if (act === "save" && s === "auto") return "";
      const info = m ? `${this.name(m.lead ? m.roster.find((e) => e.id === m.lead)?.type || "captain" : "soldier", m.side)} · ${m.won} ${this.t.battle} · ${m.coins} ${this.t.coins}` : this.t.empty;
      return `<button data-act="${act}" data-slot="${s}" ${act === "load" && !m ? "disabled" : ""}>${this.t.slot(s)} <small>${info}</small></button>`;
    }).join("");
  }
  readSlot(s) { try { return JSON.parse(localStorage.getItem(KEY(s))); } catch { return null; } }
  writeSlot(s) { try { localStorage.setItem(KEY(s), JSON.stringify(this.state)); return true; } catch { return false; } }

  newCampaign() {
    const g = this.game, side = g.settings.side, seed = (Math.random() * 2 ** 31) | 0;
    let nid = 1;
    const e = (type) => ({ id: nid++, type, vet: 0, field: true });
    const roster = [e(g.settings.captain || "captain"), ...Array.from({ length: 6 }, () => e("soldier")), ...Array.from({ length: 4 }, () => e("archer"))];
    this.state = { v: 1, seed, side, difficulty: g.settings.difficulty, coins: 80, won: 0, map: makeMap(seed), pos: 0, visited: [0],
      roster, nextId: nid, lead: roster[0].id };
    this.lastResult = null;
    this.mapScreen();
  }
  load(slot) {
    const s = this.readSlot(slot); if (!s) return;
    this.state = s; this.lastResult = null;
    this.game.settings.side = s.side; this.game.settings.difficulty = s.difficulty;
    this.mapScreen();
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
      return `<button class="node k-${n.kind} ${visited.has(n.id) ? "done" : ""} ${reach ? "reach" : ""}" style="left:${n.x}%;top:${n.y}%"
        ${reach ? `data-act="sel" data-id="${n.id}"` : "tabindex=-1 disabled"} title="${t.kinds[n.kind] || ""}">${ICON[n.kind]}</button>`;
    }).join("");
    const me = this.node(s.pos);
    this.show(`<div class="maphead"><span>${t.title} · ${s.won} ${this.t.battle} · <b>${s.coins}</b> ${t.coins}</span></div>
      <div id="map"><canvas id="mapcv"></canvas>${btns}
        <div id="pawn" class="pawn ${s.side}" style="left:${me.x}%;top:${me.y}%"></div></div>
      <div id="nodeinfo"></div>
      <div class="bar"><button class="big" data-act="go">${t.fight}</button><button data-act="army">${t.army}</button>
        <button data-act="save">${t.save}</button><button data-act="menu">${t.menu}</button></div>`);
    this.bind({ sel: (b) => { this.sel = Number(b.dataset.id); this.nodeInfo(); }, go: () => this.go(), army: () => this.campScreen(),
      save: () => this.saveScreen(), menu: () => this.toMenu() });
    this.nodeInfo();
    requestAnimationFrame(() => drawMap(document.getElementById("mapcv"), s, nx, rng));
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

  saveScreen() {
    const t = this.t;
    this.show(`<h1>${t.save}</h1><div class="slots">${this.slotButtons("save")}</div><button data-act="back">${t.back}</button>`);
    this.bind({ save: (b) => { this.writeSlot(b.dataset.slot); this.saveScreen(); this.flash(t.saved); }, back: () => this.mapScreen(this.sel) });
  }
  flash(text) { const d = document.createElement("div"); d.className = "flash"; d.textContent = text; this.body.appendChild(d); setTimeout(() => d.remove(), 1200); }

  // ---------------------------------------------------------------- the army: results, shop, who goes into battle
  campScreen() {
    const t = this.t, s = this.state, r = this.lastResult;
    const res = r ? `<div class="result"><h2>${t.won}</h2>
        ${t.earned}: <b>+${r.coins}</b> (${t.reward} ${r.base} · ${r.survivors} ${t.survivors} +${r.surv}${r.fast ? ` · ${t.fast} +${r.fast}` : ""})<br>
        ${r.promoted.length ? `${t.promoted}: ${r.promoted.map((e) => `${this.name(e.type)} ${"★".repeat(e.vet)}`).join(", ")}<br>` : ""}
        ${r.fallen.length ? `${t.fallen}: ${r.fallen.map((e) => this.name(e.type)).join(", ")}` : ""}</div>` : "";
    const nField = this.field().length, nCap = s.roster.filter((e) => isCap(e.type)).length;
    const rows = [...s.roster].sort((a, b) => (isCap(b.type) - isCap(a.type)) || a.type.localeCompare(b.type)).map((e) => `
      <div class="unit ${e.field ? "" : "res"}"><img class="ico" data-ico="${e.type}" alt=""><span class="nm">${this.name(e.type)} <span class="stars">${"★".repeat(e.vet || 0)}</span>${e.id === s.lead ? ` <b class="lead">${t.lead}</b>` : ""}</span>
        <button data-act="field" data-id="${e.id}">${e.field ? t.inField : t.reserve}</button>
        ${isCap(e.type) && e.id !== s.lead ? `<button data-act="lead" data-id="${e.id}">${t.makeLead}</button>` : ""}</div>`).join("");
    const shop = SHOP.map((type) => {
      const no = PRICE[type] > s.coins || (isCap(type) && nCap >= MAX_CAPTAINS);
      return `<button data-act="buy" data-type="${type}" ${no ? "disabled" : ""}><img class="ico" data-ico="${type}" alt="">${this.name(type)} <small>${PRICE[type]}</small></button>`;
    }).join("");
    this.show(`${res}<div class="maphead"><span><b>${s.coins}</b> ${t.coins}</span><span>${nField}/${MAX_FIELD} ${t.inField} · ${t.capMax}</span></div>
      <h3>${t.shop}</h3><div class="shopwrap"><div class="shop">${shop}</div>
        <div class="prev"><canvas id="unitprev"></canvas><div id="prevtxt"></div></div></div>
      <h3>${t.roster}</h3><div class="roster">${rows}</div>
      <button class="big" data-act="cont">${t.cont}</button>`);
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
      cont: () => { if (!this.field().length) { this.flash(t.noField); return; } this.lastResult = null; this.mapScreen(); },
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
    const pawn = document.getElementById("pawn");
    pawn.style.left = `${n.x}%`; pawn.style.top = `${n.y}%`;   // the pawn slides along the path (CSS transition)
    setTimeout(() => this.startBattle(n), 950);
  }
  startBattle(n) {
    const g = this.game, s = this.state, side = s.side, foe = this.enemy();
    this.fighting = n;
    const mine = this.field().map((e) => ({ type: e.type, vet: e.vet, id: e.id, lead: e.id === s.lead }));
    const armies = { [side]: mine, [foe]: n.army.map((e) => ({ ...e })) };
    let spawn = null;
    if (n.kind === "ambush") {
      // you are marching up the middle; they come at your flank from close by
      const z = 0.25 * (side === "human" ? 27 : -27), from = Math.random() < 0.5 ? -1 : 1;
      spawn = { [side]: { x: 0, z, facing: side === "human" ? Math.PI : 0 }, [foe]: { x: from * 15, z: z * 0.6, facing: from < 0 ? Math.PI / 2 : -Math.PI / 2 } };
    }
    g.campaignBattle = { armies, terrain: n.terrain, hills: n.hills || 0, spawn, kind: n.kind, defendT: n.defendT || 0 };
    g.settings.role = "captain";
    this.hide();
    g.start();
  }
  // called by Game.finish
  afterBattle(won, info) {
    const s = this.state, n = this.fighting; this.fighting = null;
    this.game.campaignBattle = null;
    if (!won) { this.gameOver(); return; }
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
    if (n.kind === "castle") { this.victory(); try { localStorage.removeItem(KEY("auto")); } catch {} return; }
    this.writeSlot("auto");
    this.campScreen();
  }
  gameOver() {
    const t = this.t;
    this.show(`<h1>${t.over}</h1><p>${t.overSub(this.state.won)}</p>
      <button class="big" data-act="again">${t.again}</button>
      <h3>${t.load}</h3><div class="slots">${this.slotButtons("load")}</div><button data-act="menu">${t.menu}</button>`);
    this.bind({ again: () => this.newCampaign(), menu: () => this.toMenu() });
  }
  victory() {
    const t = this.t;
    this.show(`<h1>${t.victory}</h1><p>${t.victorySub(this.state.won)}</p>
      <button class="big" data-act="again">${t.newC}</button><button data-act="menu">${t.menu}</button>`);
    this.bind({ again: () => this.newCampaign(), menu: () => this.toMenu() });
  }

  // ---------------------------------------------------------------- input: mouse, arrow keys, gamepad
  bind(acts) {
    this.acts = { ...acts, load: (b) => this.load(b.dataset.slot) };
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
