# 2D art → game-ready 3D characters (local, free)

Notes from AI Battles v2 (Nov 2026). Reusable for other projects.

## Local tools (the focus: unlimited, free, good enough to ship)

| Tool | Quality (our chibi units) | Speed / load (RTX 5060 Ti 16 GB) | Notes |
|---|---|---|---|
| **Hunyuan3D 2.1 in Wan2GP** | **Best.** Faithful shapes + colours, readable emblems (best of 3 seeds) | ~2.5 min per model at 384; peak ~7 GB VRAM, ~73 °C | **Default choice.** Unload Gemma/LM Studio first. Weights ~4–5 GB. |
| TripoSG 1.5B in Wan2GP | Shape only, no colour. **Geometry is the sharpest of all** (clay renders: crisp skull face, ribs, belt, even a sculpted shield emblem) | ~18 s per model, ~4.7 GB VRAM | Weights 1.8 GB. Outputs 1.3–1.5 M tris (32+ MB). Only colour route is Hunyuan "Texture a Mesh" (see below), which painted it worse than Hunyuan's own models. |
| TRELLIS.2 4B in Wan2GP | **Failed with our images**: always a flat "picture card" (thickness ~0.002) instead of a 3D figure | ~40 s per model, ~4.3 GB VRAM | Tried: transparent PNG, white-background PNG, pipelines "1024 Cascade" and "512". Probably a bug in this Wan2GP build (v18.20); retry after a Wan2GP update. Weights ~4–5 GB. |

**Combo test (TripoSG shape + Hunyuan "Texture a Mesh"):** TripoSG mesh decimated to 200k tris (4.8 MB, fits the
upload), textured by Hunyuan with the 2D art (~1.5 min). Proportions/pose closer to the 2D art, but the paint landed
worse: smeared shield emblem, stray patches. **Verdict: plain Hunyuan wins** (texture is what you see in game).

**TRELLIS.2 and TripoSG weights were deleted on 2026-11-20 (~13 GB freed in total, incl. dinov3_vitl16 used only by TRELLIS).**
Wan2GP re-downloads them automatically if selected again. Tip: before deleting weights, press "Unload models" (Alt+U)
in Wan2GP, otherwise Windows keeps the files locked.

Wan2GP's 3D menu also has **AnimateAnyMesh** (animate an existing mesh), **PartCrafter** (one mesh per part) and
**TripoSplat** (Gaussian splats): not tested.

Note on judging shapes: compare in **clay** (`tools/clay_render.py`, full resolution, one grey material, key + rim light).
Untextured meshes rendered after decimation look far blobbier than they are; that misled our first TripoSG verdict.

## Online tools (only for reference)

- Tripo Studio: best detail, but the free plan **blocks exporting new models**, and free outputs are non-commercial (CC BY 4.0).
- Hunyuan3D 2.1 on Hugging Face: same model as local, but ~1 free model per day without an account.

## Wan2GP – Hunyuan3D 2.1 settings

Wan2GP: `C:\Wan2GP`, UI at http://localhost:7861, model family icon = cube → "Hunyuan3D 2.1 PBR 3B + 2B",
Mode "Shape + PBR Texture", background removal on. Outputs land in `C:\Wan2GP-Models\outputs` (`.glb` + preview `.png`).
First use downloads ~4–5 GB of weights (one time).

| Setting | Default | Options | Finding |
|---|---|---|---|
| Mesh Resolution | 256 (Standard) | 196 / 256 / 384 / 512 | **Use 384.** Same-seed test (256 vs 384 vs 512): emblems almost identical; 384 cleans up small geometry bumps a little; 512 adds nothing visible. Time: 2:11 → 2:25 → 2:27 per model. |
| Texture Views | 8 views @ 768 px | 6 @ 512 / 8 @ 768 / 9 @ 768 | **Use 9 @ 768** (tested together with 384; negligible extra time). |
| Texture Size | 2048 | 1024 / 2048 / 4096 | 2048 is enough: the game downsizes to 1024, detail is limited by the 768 px views. |
| Max Faces | 40000 | 0–1,000,000 | **Raise it (e.g. 1,000,000).** Same seed 1234 @ 512: at 40k the surfaces are lumpy/noisy; at 1M they are smooth and the face is clearer (2:27 → 2:59, 44 MB file). Worth it even though we decimate to 12k later: a clean source decimates cleaner. Emblems are texture, so they don't change. |
| Steps / CFG / Texture guidance | 30 / 5 / 3 | | defaults used |
| Seed | 1234 | -1 = random | Use "Number of Images" = 3 with seed -1 to get variants, pick the best. |

**Main finding: the seed matters far more than any setting.** With the same seed, 256/384/512 give the same
emblem flaws; with new seeds the flaws disappear. Recipe: 384–512 + 9 views + Max Faces 1,000,000, "Number of Images" = 3, seed -1,
then compare close-ups (face, shield, back/belt, side) and keep the best. Peak VRAM ~7 GB.
In our test: skeleton soldier variant 2 and human soldier variant 1 were clearly best (clean emblems, clean backs).

Known weak spots: small painted emblems on shields (skull, sword) come out muddy; occasional geometry bumps
(e.g. back of a belt/sheath). Fixes: more variants; or project the emblem from the original 2D art onto the shield in Blender.

## Blender post-processing (headless, Blender 5.2)

- `tools/inspect_decimate.py` – stats + decimate + 4-angle preview renders (CPU Cycles, GPU-safe).
- `tools/rig_animate.py <in.glb> <out.glb> <facing_deg> <kind> [render_prefix]` – decimate to 12k tris,
  normalize (height 1, feet at 0, facing -Y), metallic off, textures → 1024, region-based skinning on a simple chibi rig
  (hips, chest, head, thigh/shin L/R, arm L/R), 8 clips: idle, walk, attack, block, shoot, hit, death, cheer.
  - glTF imports use quaternions: set `rotation_mode = "XYZ"` before rotating (bug we hit).
  - Key every bone in every action, or poses leak between clips.
  - Archers from these models hold the bow in the RIGHT hand (`kind=archer` mirrors the shoot clip).
- Result: ~0.8–0.9 MB per unit GLB.
