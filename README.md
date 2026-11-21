# AI Battles

A small real-time 3D battle in the browser: humans against skeletons, 16 against 16, in a randomly generated village.
You are the captain — fight in the front line and give orders to your army. If you fall, you take over one of your soldiers.

- **Sides:** Humans or Skeletons · **Language:** Ελληνικά / English · **Difficulty:** Easy / Normal / Hard
- **Keyboard:** arrow keys move · Space attack (tap = quick strike, hold = heavy blow) · 1–5 orders
- **Gamepad (Xbox):** left stick move · A attack (hold for a heavy blow) · D-pad orders · Start pause

Plain HTML + JavaScript with [Three.js](https://threejs.org) (WebGL). No build step, no server code.
The units are 3D models generated locally (Hunyuan3D) from the original 2D unit art, then rigged and animated with Blender scripts (`tools/`).
The enemy captain's lines use the browser's built-in speech voices.

Run locally: `python tools/devserver.py 8642` and open http://localhost:8642
