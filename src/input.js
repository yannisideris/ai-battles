// Keyboard (arrow keys) + Xbox-style gamepad. Deadzone 0.18 with rescale, like the Tank games.
const DEAD = 0.18;
function dz(v) { const a = Math.abs(v); return a <= DEAD ? 0 : Math.sign(v) * Math.min(1, (a - DEAD) / (1 - DEAD)); }

export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();        // edge-triggered this frame
    this.mouseClick = null;          // {x, y} in client px
    this.padPrev = [];
    this.rightStick = { x: 0, y: 0, flicked: false };
    addEventListener("keydown", (e) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Tab"].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener("keyup", (e) => this.keys.delete(e.code));
    addEventListener("blur", () => this.keys.clear());
    addEventListener("pointerdown", (e) => { if (e.target.id === "view") this.mouseClick = { x: e.clientX, y: e.clientY, button: e.button }; });
    addEventListener("contextmenu", (e) => { if (e.target.id === "view") e.preventDefault(); });
  }

  // call once per frame; returns a snapshot of the controls
  poll() {
    let mx = 0, mz = 0;
    if (this.keys.has("ArrowLeft")) mx -= 1;
    if (this.keys.has("ArrowRight")) mx += 1;
    if (this.keys.has("ArrowUp")) mz -= 1;
    if (this.keys.has("ArrowDown")) mz += 1;
    let attack = this.pressed.has("Space") || this.pressed.has("Enter");
    let attackHeld = this.keys.has("Space");
    let cycleTarget = this.pressed.has("Tab") ? 1 : 0;
    let order = null;
    for (const [code, o] of [["Digit1", 0], ["Digit2", 1], ["Digit3", 2], ["Digit4", 3], ["Digit5", 4]]) if (this.pressed.has(code)) order = o;
    let aim = null, pause = this.pressed.has("Escape");

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const lx = dz(p.axes[0] || 0), ly = dz(p.axes[1] || 0);
      if (Math.hypot(lx, ly) > Math.hypot(mx, mz) * 0.5) { mx = lx; mz = ly; }
      const rx = dz(p.axes[2] || 0), ry = dz(p.axes[3] || 0), mag = Math.hypot(rx, ry);
      if (mag > 0.55) aim = { x: rx, z: ry };            // right stick points at a target / button
      const btn = (i) => p.buttons[i] && p.buttons[i].pressed;
      const was = this.padPrev[p.index] || [];
      const edge = (i) => btn(i) && !was[i];
      if (edge(0)) attack = true;                          // A = the single action button
      if (btn(0)) attackHeld = true;
      if (edge(9)) pause = true;                           // Start
      // D-pad = captain orders (up/right/down/left) when playing the captain
      if (edge(12)) order = 0; if (edge(15)) order = 1; if (edge(13)) order = 2; if (edge(14)) order = 3;
      this.padPrev[p.index] = p.buttons.map((b) => b.pressed);
    }
    const len = Math.hypot(mx, mz); if (len > 1) { mx /= len; mz /= len; }
    const click = this.mouseClick; this.mouseClick = null;
    const snap = { mx, mz, attack, attackHeld, cycleTarget, aim, order, click, pause };
    this.pressed.clear();
    return snap;
  }
}
