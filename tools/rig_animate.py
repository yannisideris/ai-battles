"""Blender headless: turn a raw image-to-3D GLB into a game-ready rigged + animated chibi unit.

Steps: import -> join -> merge -> decimate -> normalize (height 1, feet at 0, facing -Y)
       -> downscale textures -> build armature -> region-based skin weights -> keyframed actions
       -> export GLB (+ optional preview renders of key poses, CPU Cycles).

Usage:
  blender -b --factory-startup -P rig_animate.py -- <in.glb> <out.glb> <facing_deg> <kind> [render_prefix]
    facing_deg: rotation about Z (degrees) that makes the model face -Y (Blender front)
    kind: soldier | archer | captain
"""
import sys, math, bpy, bmesh
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, DST, FACING, KIND = argv[0], argv[1], float(argv[2]), argv[3]
RENDER = argv[4] if len(argv) > 4 else None
TARGET_TRIS = 12000
TEX_SIZE = 1024
FPS = 30

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = FPS
bpy.ops.import_scene.gltf(filepath=SRC)

# ---------------------------------------------------------------- mesh cleanup
meshes = [o for o in scene.objects if o.type == "MESH"]
for o in scene.objects:
    o.select_set(o in meshes)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
body = bpy.context.view_layer.objects.active
# drop any empties/parents the importer created
bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
for o in list(scene.objects):
    if o is not body:
        bpy.data.objects.remove(o, do_unlink=True)
body.name = "Body"
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

bm = bmesh.new(); bm.from_mesh(body.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
bm.to_mesh(body.data); bm.free()
LONG = KIND in ("spearman", "staff")   # a weapon that sticks out above the head / down to the ground (spear, staff)
def decimate():
    tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
    if tris > TARGET_TRIS:
        m = body.modifiers.new("dec", "DECIMATE"); m.ratio = TARGET_TRIS / tris; m.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier="dec")
if not LONG:   # long weapons are cut free of the body first (after normalising), then decimated
    decimate()

# normalize: face -Y, height 1, feet on ground, centred
body.rotation_mode = "XYZ"   # glTF import uses quaternions; euler would be ignored otherwise
body.rotation_euler = (0, 0, math.radians(FACING))
bpy.ops.object.transform_apply(rotation=True)
vs = [body.matrix_world @ v.co for v in body.data.vertices]
mn = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
mx = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
TOP = mx.z
if LONG:
    # normalise on the BODY, not the spear: top of the head = highest point near the feet' centre line,
    # bottom = lowest point of the boots (the spear butt may reach lower)
    low = sorted(vs, key=lambda v: v.z)[:max(50, len(vs) // 30)]
    med = sorted(v.x for v in low)[len(low) // 2]
    wid = mx.x - mn.x
    boots = [v for v in low if abs(v.x - med) < wid * 0.2]
    mn.z = min(v.z for v in boots)
    TOP = max(v.z for v in vs if abs(v.x - med) < wid * 0.25)
    print("LONG WEAPON: body height", round(TOP - mn.z, 3), "of", round(mx.z - mn.z, 3))
s = 1.0 / (TOP - mn.z)
body.scale = (s, s, s)
bpy.ops.object.transform_apply(scale=True)
vs = [v.co.copy() for v in body.data.vertices]
# centre on the feet (lowest 6%) rather than the bbox, so a big shield doesn't shift the pivot
feet = [v for v in vs if v.z - mn.z * s < 0.06]
if LONG:   # leave the spear butt out of the feet centre
    _m = sorted(v.x for v in feet)[len(feet) // 2]
    feet = [v for v in feet if abs(v.x - _m) < 0.15]
cx = sum(v.x for v in feet) / len(feet); cy = sum(v.y for v in feet) / len(feet)
for v in body.data.vertices:
    v.co.x -= cx; v.co.y -= cy; v.co.z -= mn.z * s

SPEAR = None   # (base point, axis) of the spear line
if LONG:
    # Find the pole: tip = what sticks out above the head, butt = lowest part under the tip. Cut its faces free from
    # the body BEFORE decimating, otherwise the decimator bridges shaft and leg/helmet with long triangles that
    # stretch into "sails" as soon as the arm moves.
    me = body.data
    tip = [v.co.copy() for v in me.vertices if v.co.z > 1.0]
    t = sum(tip, Vector()) / max(1, len(tip))
    # the boots are on the inner side (towards x=0): keep the butt search narrow in x so they don't skew the line
    butt = [v.co.copy() for v in me.vertices if v.co.z < 0.15 and abs(v.co.x - t.x) < 0.08 and abs(v.co.y - t.y) < 0.09]
    if tip and butt:
        b = sum(butt, Vector()) / len(butt); axis = (t - b).normalized()
        for _ in range(2):   # refine: re-fit the line on shaft vertices near both ends
            def dl(co): p = co - b; return (p - axis * p.dot(axis)).length
            lo = [v.co.copy() for v in me.vertices if v.co.z < 0.3 and dl(v.co) < 0.03]
            hi = [v.co.copy() for v in me.vertices if 0.7 < v.co.z < 0.95 and dl(v.co) < 0.03]
            if lo and hi:
                b = sum(lo, Vector()) / len(lo); t2 = sum(hi, Vector()) / len(hi); axis = (t2 - b).normalized()
        SPEAR = (b, axis)
        def near(co, r=0.035):
            p = co - b; return (p - axis * p.dot(axis)).length < r and co.x < -0.08
        bm = bmesh.new(); bm.from_mesh(me)
        sp = {f for f in bm.faces if all(near(v.co) for v in f.verts)}
        cut = [e for e in bm.edges if len(e.link_faces) > 1 and len({f in sp for f in e.link_faces}) > 1]
        bmesh.ops.split_edges(bm, edges=cut)
        bm.to_mesh(me); bm.free()
        print("SPEAR_CUT faces", len(sp), "edges", len(cut), "tip", tuple(round(c, 3) for c in t), "butt", tuple(round(c, 3) for c in b))
    else:
        print("SPEAR: no tip/butt found", len(tip), len(butt))
    decimate()
vs = [v.co.copy() for v in body.data.vertices]

# materials: no metal shine, downscale textures
for mat in body.data.materials:
    if not mat or not mat.use_nodes:
        continue
    for n in mat.node_tree.nodes:
        if n.type == "BSDF_PRINCIPLED":
            for link in list(n.inputs["Metallic"].links):
                mat.node_tree.links.remove(link)
            n.inputs["Metallic"].default_value = 0.0
            n.inputs["Roughness"].default_value = max(0.6, n.inputs["Roughness"].default_value)
for img in bpy.data.images:
    if img.size[0] > TEX_SIZE:
        img.scale(TEX_SIZE, TEX_SIZE)

# ---------------------------------------------------------------- landmarks
H = 1.0
def band(z0, z1):
    return [v for v in vs if z0 <= v.z < z1]
leg_band = band(0.04, 0.18)
leg_xs = sorted(v.x for v in leg_band)
# robust hip half-width from the 10/90 percentile of leg vertices
hip_hw = max(0.08, (leg_xs[int(len(leg_xs) * 0.9)] - leg_xs[int(len(leg_xs) * 0.1)]) / 2)
leg_x = hip_hw * 0.55
feet_y = sorted(v.y for v in band(0.0, 0.05))
back_of_feet = feet_y[int(len(feet_y) * 0.9)] if feet_y else 0.08

Z_HIP, Z_KNEE, Z_CHEST, Z_NECK, Z_SHOULDER = 0.30, 0.15, 0.45, 0.56, 0.50
# front surface of the chest: anything clearly in front of it is a weapon / shield held in front of the body
_chest = sorted(v.y for v in vs if Z_HIP + 0.05 < v.z < Z_SHOULDER and abs(v.x) < hip_hw * 0.6)
FRONT_Y = _chest[int(len(_chest) * 0.08)] if _chest else -0.15
torso_hw = hip_hw * 1.05
head_hw = torso_hw * 1.6     # chibi heads are wide
SH_X = torso_hw + 0.02

# ---------------------------------------------------------------- armature
arm_data = bpy.data.armatures.new("Rig")
rig = bpy.data.objects.new("Rig", arm_data)
scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")
eb = arm_data.edit_bones
def bone(name, head, tail, parent=None):
    b = eb.new(name); b.head = Vector(head); b.tail = Vector(tail); b.roll = 0
    if parent: b.parent = eb[parent]; b.use_connect = False
    return b
bone("root", (0, 0, 0), (0, 0.15, 0))
bone("hips", (0, 0, Z_HIP), (0, 0, Z_CHEST), "root")
bone("chest", (0, 0, Z_CHEST), (0, 0, Z_NECK), "hips")
bone("head", (0, 0, Z_NECK), (0, 0, 1.0), "chest")
for side, sx in (("L", 1), ("R", -1)):
    bone(f"thigh.{side}", (sx * leg_x, 0, Z_HIP), (sx * leg_x, 0, Z_KNEE), "hips")
    bone(f"shin.{side}", (sx * leg_x, 0, Z_KNEE), (sx * leg_x, 0, 0.02), f"thigh.{side}")
    bone(f"arm.{side}", (sx * SH_X, 0, Z_SHOULDER), (sx * SH_X, 0, Z_HIP), "chest")
bpy.ops.object.mode_set(mode="OBJECT")

# ---------------------------------------------------------------- skin weights (region based)
groups = {n: body.vertex_groups.new(name=n) for n in
          ["hips", "chest", "head", "thigh.L", "thigh.R", "shin.L", "shin.R", "arm.L", "arm.R"]}
def smooth(t):
    t = max(0.0, min(1.0, t)); return t * t * (3 - 2 * t)
for v in body.data.vertices:
    p = v.co
    w = {}
    side = "L" if p.x > 0 else "R"
    lateral = abs(p.x)
    if p.z < Z_HIP + 0.03 and p.y <= back_of_feet + 0.02 and lateral < hip_hw * 1.6:
        # legs; blend into hips near the top
        k = smooth((p.z - Z_KNEE + 0.03) / 0.06)       # 0 = shin, 1 = thigh
        top = smooth((p.z - (Z_HIP - 0.04)) / 0.07)     # fade into hips
        w[f"shin.{side}"] = (1 - k) * (1 - top)
        w[f"thigh.{side}"] = k * (1 - top)
        w["hips"] = top
    elif (p.y < FRONT_Y - 0.05 and Z_HIP - 0.05 < p.z < Z_NECK + 0.15):
        # held out in front of the chest (blade or shield crossing the body): rigidly with that side's arm
        w[f"arm.{side}"] = 1.0
    elif (lateral > torso_hw and not (p.z > Z_NECK and lateral < head_hw and p.y > -0.15)
          # capes / cloaks: anything behind the back, or hanging low beside the legs, stays with the body
          and not (p.y > back_of_feet - 0.02 and lateral < torso_hw + 0.18)
          and not (p.z < Z_HIP and lateral < hip_hw * 1.9 and p.y > -0.05)):
        # arms + whatever they hold (sword, shield, bow). Blend into chest close to the shoulder.
        a = smooth((lateral - torso_hw) / 0.05)
        # only blend right at the shoulder; hand, hilt and blade move as one rigid piece (no bending sword)
        sh = math.dist((p.x, p.y, p.z), ((1 if side == "L" else -1) * SH_X, 0.0, Z_SHOULDER))
        if sh > 0.13: a = 1.0
        w[f"arm.{side}"] = a
        if a < 1: w["chest"] = 1 - a
    elif p.z >= Z_NECK - 0.02:
        h = smooth((p.z - (Z_NECK - 0.02)) / 0.05)
        w["head"] = h; w["chest"] = 1 - h
    else:
        c = smooth((p.z - Z_HIP) / (Z_CHEST - Z_HIP))
        w["chest"] = c; w["hips"] = 1 - c
    for g, val in w.items():
        if val > 0.001:
            groups[g].add([v.index], val, "REPLACE")

import os, heapq
# ---- weapon tips near the head: a blade (or shield rim) held up beside a wide chibi head falls inside the
# "head" region and got head weights, so it stayed behind and stretched into a grey fan when the arm moved.
# Fix by distance ALONG THE SURFACE: whatever is reached sooner from the hand (through the blade) than from the
# top of the head belongs to the arm. (Archers keep their original weights.)
if KIND != "archer" and not LONG:   # the spear has its own rigid fix below
    me = body.data
    adj = [[] for _ in me.vertices]
    for e in me.edges:
        i, j = e.vertices; L = (me.vertices[i].co - me.vertices[j].co).length
        adj[i].append((j, L)); adj[j].append((i, L))
    gidx = {g.index: n for n, g in groups.items()}
    def wmap(v): return {gidx[ge.group]: ge.weight for ge in v.groups if ge.group in gidx}
    dist = [1e9] * len(me.vertices); lab = [None] * len(me.vertices); pq = []
    for v in me.vertices:
        w = wmap(v)
        for side in ("L", "R"):
            if w.get(f"arm.{side}", 0) > 0.99 and v.co.z < Z_NECK: dist[v.index] = 0; lab[v.index] = f"arm.{side}"
        if v.co.z > 0.78 and abs(v.co.x) < 0.12: dist[v.index] = 0; lab[v.index] = "head"
    for i, d in enumerate(dist):
        if d == 0: heapq.heappush(pq, (0.0, i))
    while pq:
        d, i = heapq.heappop(pq)
        if d > dist[i]: continue
        for j, L in adj[i]:
            if d + L < dist[j]: dist[j] = d + L; lab[j] = lab[i]; heapq.heappush(pq, (d + L, j))
    moved = 0
    for v in me.vertices:
        w = wmap(v)
        if lab[v.index] and lab[v.index].startswith("arm") and w.get("head", 0) > 0 and abs(v.co.x) > torso_hw * 0.8:
            for g in ("head", "chest", "hips"): groups[g].remove([v.index])
            groups[lab[v.index]].add([v.index], 1.0, "REPLACE"); moved += 1
    print("WEAPON_TIP_FIX moved", moved)

if SPEAR:
    # the spear is now its own loose piece(s): every island lying along the spear line goes rigidly to the right arm
    b, axis = SPEAR; me = body.data
    par = list(range(len(me.vertices)))
    def find(i):
        while par[i] != i: par[i] = par[par[i]]; i = par[i]
        return i
    for e in me.edges:
        a, c = find(e.vertices[0]), find(e.vertices[1])
        if a != c: par[a] = c
    isl = {}
    for v in me.vertices: isl.setdefault(find(v.index), []).append(v)
    n = 0
    for vs_ in isl.values():
        def dl(co): p = co - b; return (p - axis * p.dot(axis)).length
        close = sum(1 for v in vs_ if dl(v.co) < 0.05)
        if close > 0.8 * len(vs_):
            for v in vs_:
                for g in groups.values(): g.remove([v.index])
                groups["arm.R"].add([v.index], 1.0, "REPLACE"); n += 1
    print("SPEAR_RIGID verts", n, "islands", len(isl))

if os.environ.get("DUMP_ARM"):
    gi = groups["arm.R"].index
    with open(os.environ["DUMP_ARM"], "w") as fh:
        fh.write(f"{SH_X} {Z_SHOULDER} {FRONT_Y} {torso_hw}" + chr(10))
        for v in body.data.vertices:
            for ge in v.groups:
                if ge.group == gi and ge.weight > 0.99: fh.write(f"{v.co.x:.4f} {v.co.y:.4f} {v.co.z:.4f}" + chr(10))
body.parent = rig
mod = body.modifiers.new("Armature", "ARMATURE"); mod.object = rig

# ---------------------------------------------------------------- animations
pb = rig.pose.bones
for b in pb:
    b.rotation_mode = "XYZ"
rig.animation_data_create()
R = math.radians

def make_action(name, length_s, keys, loop=True):
    """keys: {frame_fraction: {bone: (rx, ry, rz) degrees or ('loc', (x,y,z))}}"""
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    rig.animation_data.action = act
    n = max(2, round(length_s * FPS))
    for b in pb:
        b.rotation_euler = (0, 0, 0); b.location = (0, 0, 0)
    fracs = sorted(keys)
    if loop and 1.0 not in keys:
        keys[1.0] = keys[fracs[0]]; fracs.append(1.0)
    # key EVERY bone in every action so no pose leaks from one clip into another
    touched = {b.name for b in pb}
    for f in fracs:
        frame = 1 + round(f * (n - 1))
        for bname in touched:
            b = pb[bname]
            val = keys[f].get(bname, None)
            rot, loc = (0, 0, 0), (0, 0, 0)
            if isinstance(val, dict):
                rot = val.get("rot", (0, 0, 0)); loc = val.get("loc", (0, 0, 0))
            elif val is not None:
                rot = val
            b.rotation_euler = tuple(R(a) for a in rot)
            b.location = loc
            b.keyframe_insert("rotation_euler", frame=frame)
            b.keyframe_insert("location", frame=frame)
    return act

if os.environ.get("PROBE"):   # pose probe for checking rotation signs: 8 poses, one per 1/7 of the clip
    P = [(0,0,0),(-90,0,0),(90,0,0),(120,0,0),(90,60,0),(90,-60,0),(0,0,45),(0,0,-45)]
    make_action("probe", 7 / FPS * 7, {i / 7: {"arm.R": P[i]} for i in range(8)}, loop=False)
# Sign conventions (bones point down / up along Z, roll 0):
#   arm/leg X-rotation NEGATIVE swings the limb FORWARD (-Y), positive swings it back.
#   arm Z-rotation: raises sideways (L positive = outward? checked in previews).
make_action("idle", 2.0, {
    0.0: {"chest": (0, 0, 0), "head": (0, 0, 0), "hips": {"loc": (0, 0, 0)}, "arm.L": (0, 0, 0), "arm.R": (0, 0, 0)},
    0.5: {"chest": (3, 0, 0), "head": (-3, 0, 2), "hips": {"loc": (0, 0, -0.008)}, "arm.L": (-3, 0, 2), "arm.R": (3, 0, -2)},
})
make_action("walk", 0.8, {
    0.0: {"thigh.L": (-28, 0, 0), "thigh.R": (28, 0, 0), "shin.L": (0, 0, 0), "shin.R": (25, 0, 0),
          "arm.L": (20, 0, 0), "arm.R": (-20, 0, 0), "hips": {"loc": (0, 0, 0), "rot": (0, 0, 6)}, "chest": (-4, 0, -6)},
    0.25: {"thigh.L": (0, 0, 0), "thigh.R": (0, 0, 0), "shin.L": (10, 0, 0), "shin.R": (35, 0, 0),
           "arm.L": (0, 0, 0), "arm.R": (0, 0, 0), "hips": {"loc": (0, 0, 0.03), "rot": (0, 0, 0)}, "chest": (-4, 0, 0)},
    0.5: {"thigh.L": (28, 0, 0), "thigh.R": (-28, 0, 0), "shin.L": (25, 0, 0), "shin.R": (0, 0, 0),
          "arm.L": (-20, 0, 0), "arm.R": (20, 0, 0), "hips": {"loc": (0, 0, 0), "rot": (0, 0, -6)}, "chest": (-4, 0, 6)},
    0.75: {"thigh.L": (0, 0, 0), "thigh.R": (0, 0, 0), "shin.L": (35, 0, 0), "shin.R": (10, 0, 0),
           "arm.L": (0, 0, 0), "arm.R": (0, 0, 0), "hips": {"loc": (0, 0, 0.03), "rot": (0, 0, 0)}, "chest": (-4, 0, 0)},
})
make_action("attack", 0.62, {         # diagonal chop: whole body turns away (wind-up), then whips round with a step
    0.0:  {"root": {"rot": (0, 0, 0), "loc": (0, 0, 0)}, "arm.R": (0, 0, 0), "chest": (0, 0, 0), "head": (0, 0, 0)},
    0.36: {"root": {"rot": (0, 0, -40), "loc": (0, 0.04, 0)}, "arm.R": (-165, 0, -45), "chest": (8, 0, -10), "head": (0, 0, 15)},
    0.54: {"root": {"rot": (0, 0, 32), "loc": (0, -0.12, 0)}, "arm.R": (-55, 0, 60), "chest": (-14, 0, 10), "head": (0, 0, -8)},
    0.72: {"root": {"rot": (0, 0, 26), "loc": (0, -0.12, 0)}, "arm.R": (-40, 0, 55), "chest": (-10, 0, 8), "head": (0, 0, -5)},
    1.0:  {"root": {"rot": (0, 0, 0), "loc": (0, 0, 0)}, "arm.R": (0, 0, 0), "chest": (0, 0, 0), "head": (0, 0, 0)},
}, loop=False)
make_action("block", 0.4, {
    0.0: {"arm.L": (0, 0, 0), "chest": (0, 0, 0)},
    1.0: {"arm.L": (-70, 0, -25), "chest": (-6, 0, 15)},
}, loop=False)
# bow hand / draw hand; the generated archers hold the bow in the RIGHT hand
BOW, DRAW, TW = ("arm.R", "arm.L", -1) if KIND == "archer" else ("arm.L", "arm.R", 1)
def set_interp(act, frac, mode, length_s):
    """make the segment that starts at key `frac` LINEAR / CONSTANT (snappy) instead of the default eased BEZIER"""
    frame = 1 + round(frac * (max(2, round(length_s * FPS)) - 1))
    curves = list(getattr(act, "fcurves", []) or [])
    if not curves:   # Blender 4.4+ layered actions
        for layer in act.layers:
            for strip in layer.strips:
                for bag in strip.channelbags: curves += list(bag.fcurves)
    for fc in curves:
        for kp in fc.keyframe_points:
            if abs(kp.co.x - frame) < 0.5: kp.interpolation = mode

# shoot: a decisive shot read from above - snap the bow up and turn side-on, pull the string right back to the
# face, a still moment on aim, then a sharp release (string hand flies back, bow kicks) held for a beat.
# The arrow leaves at 0.70 (= archer windup 0.70 s), so the timing of the game does not change.
_shoot = {
    0.0:  {BOW: (0, 0, 0), DRAW: (0, 0, 0), "chest": (0, 0, 0), "head": (0, 0, 0)},
    0.10: {BOW: (-88, 0, 0), DRAW: (-88, 0, 0), "chest": (0, 0, 38 * TW), "head": (0, 0, -12 * TW)},        # bow up, side-on
    0.16: {BOW: (-93, 0, 0), DRAW: (-90, 0, 0), "chest": (0, 0, 41 * TW), "head": (0, 0, -14 * TW)},        # settle
    0.45: {BOW: (-92, 0, 0), DRAW: (-55, 0, -55 * TW), "chest": (-3, 0, 45 * TW), "head": (0, 0, -18 * TW)}, # full draw
    0.68: {BOW: (-92, 0, 0), DRAW: (-54, 0, -58 * TW), "chest": (-3, 0, 46 * TW), "head": (0, 0, -18 * TW)}, # aim
    0.73: {BOW: (-101, 0, 0), DRAW: (-72, 0, -88 * TW), "chest": (2, 0, 41 * TW), "head": (0, 0, -16 * TW)}, # release!
    0.86: {BOW: (-97, 0, 0), DRAW: (-74, 0, -82 * TW), "chest": (0, 0, 39 * TW), "head": (0, 0, -14 * TW)},  # follow-through
    1.0:  {BOW: (0, 0, 0), DRAW: (0, 0, 0), "chest": (0, 0, 0), "head": (0, 0, 0)},
}
_act = make_action("shoot", 1.0, _shoot, loop=False)
# the original, softer shot: used when the archer has to swing round to shoot (to the side / behind) -
# its gentler raise reads well together with the body turning
make_action("shoot_turn", 1.0, {
    0.0: {BOW: (0, 0, 0), DRAW: (0, 0, 0), "chest": (0, 0, 0)},
    0.3: {BOW: (-85, 0, 0), DRAW: (-85, 0, 0), "chest": (0, 0, 30 * TW)},              # raise bow, nock
    0.7: {BOW: (-90, 0, 0), DRAW: (-60, 0, -35 * TW), "chest": (0, 0, 35 * TW)},       # draw
    0.75: {BOW: (-90, 0, 0), DRAW: (-75, 0, 10 * TW), "chest": (-4, 0, 30 * TW)},      # release
    1.0: {BOW: (0, 0, 0), DRAW: (0, 0, 0), "chest": (0, 0, 0)},
}, loop=False)
set_interp(_act, 0.68, "LINEAR", 1.0)   # the release is a snap, not a glide
make_action("hit", 0.35, {
    0.0: {"chest": (0, 0, 0), "head": (0, 0, 0), "hips": {"loc": (0, 0, 0)}},
    0.3: {"chest": (14, 0, -6), "head": (12, 0, 0), "hips": {"loc": (0, 0.04, 0)}},
    1.0: {"chest": (0, 0, 0), "head": (0, 0, 0), "hips": {"loc": (0, 0, 0)}},
}, loop=False)
make_action("death", 1.0, {
    0.0: {"root": {"rot": (0, 0, 0), "loc": (0, 0, 0)}, "chest": (0, 0, 0), "arm.L": (0, 0, 0), "arm.R": (0, 0, 0),
          "thigh.L": (0, 0, 0), "thigh.R": (0, 0, 0)},
    0.25: {"root": {"rot": (0, 0, 0), "loc": (0, 0, 0)}, "chest": (20, 0, 0), "arm.L": (-30, 0, 20), "arm.R": (-30, 0, -20),
           "thigh.L": (-20, 0, 0), "thigh.R": (-10, 0, 0)},
    1.0: {"root": {"rot": (0, -82, 0), "loc": (0, 0, 0)}, "chest": (5, 0, 0), "arm.L": (-40, 0, 40), "arm.R": (-60, 0, -30),
          "thigh.L": (-15, 0, 0), "thigh.R": (-5, 0, 0)},
}, loop=False)
make_action("cheer", 1.0, {
    0.0: {"arm.R": (0, 0, 0), "hips": {"loc": (0, 0, 0)}},
    0.4: {"arm.R": (-170, 0, 0), "hips": {"loc": (0, 0, 0.05)}},
    0.7: {"arm.R": (-160, 0, 0), "hips": {"loc": (0, 0, 0)}},
})

# ---------------------------------------------------------------- variety clips (played now and then)
# root bone points along +Y with roll 0: local Z = world up, so root "loc" z = jump, root X-rotation tips forward(+)/back(-)
make_action("attack2", 0.62, {        # big horizontal sweep: coil right, spin left through the target
    0.0:  {"root": {"rot": (0, 0, 0), "loc": (0, 0, 0)}, "arm.R": (0, 0, 0), "chest": (0, 0, 0)},
    0.36: {"root": {"rot": (0, 0, -55), "loc": (0, 0.03, 0)}, "arm.R": (-80, 0, -90), "chest": (0, 0, -12)},
    0.55: {"root": {"rot": (0, 0, 50), "loc": (0, -0.1, 0)}, "arm.R": (-90, 0, 70), "chest": (-6, 0, 12)},
    0.74: {"root": {"rot": (0, 0, 42), "loc": (0, -0.1, 0)}, "arm.R": (-82, 0, 75), "chest": (-4, 0, 10)},
    1.0:  {"root": {"rot": (0, 0, 0), "loc": (0, 0, 0)}, "arm.R": (0, 0, 0), "chest": (0, 0, 0)},
}, loop=False)
make_action("attack3", 0.62, {        # lunge: rock back, then drive the whole body forward behind the blade
    0.0:  {"root": {"rot": (0, 0, 0), "loc": (0, 0, 0)}, "arm.R": (0, 0, 0), "chest": (0, 0, 0), "thigh.R": (0, 0, 0), "thigh.L": (0, 0, 0)},
    0.36: {"root": {"rot": (0, 0, -25), "loc": (0, 0.1, 0)}, "arm.R": (40, 0, -20), "chest": (10, 0, -8), "thigh.R": (15, 0, 0), "thigh.L": (-10, 0, 0)},
    0.54: {"root": {"rot": (0, 0, 12), "loc": (0, -0.2, 0)}, "arm.R": (-100, 0, 8), "chest": (-18, 0, 6), "thigh.R": (25, 0, 0), "thigh.L": (-40, 0, 0)},
    0.74: {"root": {"rot": (0, 0, 10), "loc": (0, -0.18, 0)}, "arm.R": (-95, 0, 5), "chest": (-14, 0, 5), "thigh.R": (20, 0, 0), "thigh.L": (-32, 0, 0)},
    1.0:  {"root": {"rot": (0, 0, 0), "loc": (0, 0, 0)}, "arm.R": (0, 0, 0), "chest": (0, 0, 0), "thigh.R": (0, 0, 0), "thigh.L": (0, 0, 0)},
}, loop=False)
# ---- sword swings (soldier/captain). The sword is held at shoulder height with the blade ABOVE the arm pivot, so
#   arm.R X+ tips the blade FORWARD/down, X- tips it back over the shoulder; with X~90, Y+ sweeps it outward,
#   Y- across the front of the body; Z- leans it outward. (Checked with the PROBE renders.)
#   Every swing: clear wind-up with a short hold (anticipation), a fast strike that ends with the blade
#   pointing at the enemy, a held follow-through, then recovery. Strike lands at ~50% (= unit windup 0.33 s).
if KIND not in ("archer", "brute"):   # brute: the axe hangs BELOW the hand, so the generic overhead clips fit
    for _n in ("attack", "attack2", "attack3"):
        if bpy.data.actions.get(_n): bpy.data.actions.remove(bpy.data.actions[_n])
    Z0 = {"root": {"rot": (0, 0, 0), "loc": (0, 0, 0)}, "arm.R": (0, 0, 0), "arm.L": (0, 0, 0), "chest": (0, 0, 0), "head": (0, 0, 0),
          "thigh.L": (0, 0, 0), "thigh.R": (0, 0, 0), "shin.L": (0, 0, 0), "shin.R": (0, 0, 0)}
    make_action("attack", 0.7, {      # overhead diagonal chop: blade back over the shoulder -> down across the front
        0.0: Z0,
        0.28: {"root": {"rot": (0, 0, -30), "loc": (0, 0.05, 0.01)}, "arm.R": (-80, 0, -25), "arm.L": (-20, 0, 15), "chest": (12, 0, -12), "head": (6, 0, 10), "thigh.R": (12, 0, 0)},
        0.40: {"root": {"rot": (0, 0, -34), "loc": (0, 0.06, 0.015)}, "arm.R": (-92, 0, -28), "arm.L": (-22, 0, 15), "chest": (14, 0, -14), "head": (6, 0, 10), "thigh.R": (14, 0, 0)},
        0.50: {"root": {"rot": (0, 0, 24), "loc": (0, -0.15, 0)}, "arm.R": (118, 0, 25), "arm.L": (10, 0, 10), "chest": (-24, 0, 12), "head": (-10, 0, -6), "thigh.L": (-35, 0, 0), "shin.L": (20, 0, 0), "thigh.R": (18, 0, 0)},
        0.70: {"root": {"rot": (0, 0, 28), "loc": (0, -0.16, 0)}, "arm.R": (128, 0, 30), "arm.L": (12, 0, 10), "chest": (-26, 0, 14), "head": (-10, 0, -6), "thigh.L": (-35, 0, 0), "shin.L": (20, 0, 0), "thigh.R": (18, 0, 0)},
        1.0: Z0,
    }, loop=False)
    make_action("attack2", 0.7, {     # horizontal sweep at chest height: coil outward, whip across the front
        0.0: Z0,
        0.28: {"root": {"rot": (0, 0, -45), "loc": (0, 0.04, 0)}, "arm.R": (80, 65, 0), "chest": (4, 0, -16), "head": (0, 0, 14), "thigh.R": (10, 0, 0)},
        0.40: {"root": {"rot": (0, 0, -50), "loc": (0, 0.05, 0)}, "arm.R": (82, 75, 0), "chest": (4, 0, -18), "head": (0, 0, 16), "thigh.R": (10, 0, 0)},
        0.52: {"root": {"rot": (0, 0, 42), "loc": (0, -0.12, 0)}, "arm.R": (88, -70, 0), "chest": (-10, 0, 16), "head": (0, 0, -10), "thigh.L": (-28, 0, 0), "shin.L": (15, 0, 0)},
        0.72: {"root": {"rot": (0, 0, 50), "loc": (0, -0.13, 0)}, "arm.R": (90, -88, 0), "chest": (-10, 0, 18), "head": (0, 0, -10), "thigh.L": (-28, 0, 0), "shin.L": (15, 0, 0)},
        1.0: Z0,
    }, loop=False)
    make_action("attack3", 0.7, {     # lunging thrust: pull the blade back, then drive it straight at the enemy
        0.0: Z0,
        0.28: {"root": {"rot": (0, 0, -22), "loc": (0, 0.10, 0)}, "arm.R": (-45, 0, -10), "chest": (12, 0, -10), "thigh.R": (18, 0, 0), "thigh.L": (-8, 0, 0)},
        0.40: {"root": {"rot": (0, 0, -25), "loc": (0, 0.12, 0)}, "arm.R": (-55, 0, -12), "chest": (14, 0, -10), "thigh.R": (20, 0, 0), "thigh.L": (-8, 0, 0)},
        0.50: {"root": {"rot": (0, 0, 12), "loc": (0, -0.26, 0)}, "arm.R": (100, 0, 10), "chest": (-24, 0, 8), "head": (-6, 0, 0), "thigh.L": (-50, 0, 0), "shin.L": (30, 0, 0), "thigh.R": (28, 0, 0)},
        0.70: {"root": {"rot": (0, 0, 12), "loc": (0, -0.27, 0)}, "arm.R": (104, 0, 10), "chest": (-25, 0, 8), "head": (-6, 0, 0), "thigh.L": (-50, 0, 0), "shin.L": (30, 0, 0), "thigh.R": (28, 0, 0)},
        1.0: Z0,
    }, loop=False)

def spear_clips():   # called after all generic clips, so these replace them
    # ---- spear: the pole runs parallel to the arm bone and the TIP is above the shoulder pivot, so
    #   arm.R X+ ~90 = spear level, pointing forward (hand slightly back) - the couched spear.
    for _n in ("attack", "attack2", "attack3"):
        if bpy.data.actions.get(_n): bpy.data.actions.remove(bpy.data.actions[_n])
    Z0 = {"root": {"rot": (0, 0, 0), "loc": (0, 0, 0)}, "arm.R": (0, 0, 0), "arm.L": (0, 0, 0), "chest": (0, 0, 0), "head": (0, 0, 0),
          "thigh.L": (0, 0, 0), "thigh.R": (0, 0, 0), "shin.L": (0, 0, 0), "shin.R": (0, 0, 0)}
    def thrust(pull, yaw, lunge, aim=(90, 0, 0)):
        return {
            0.0: Z0,
            0.28: {"root": {"rot": (0, 0, -yaw), "loc": (0, pull, 0)}, "arm.R": (80, 0, 0), "arm.L": (-25, 0, 10),
                   "chest": (10, 0, -10), "head": (-6, 0, 8), "thigh.R": (14, 0, 0)},
            0.40: {"root": {"rot": (0, 0, -yaw), "loc": (0, pull + 0.02, 0)}, "arm.R": (82, 0, 0), "arm.L": (-25, 0, 10),
                   "chest": (12, 0, -10), "head": (-6, 0, 8), "thigh.R": (16, 0, 0)},
            0.50: {"root": {"rot": (0, 0, yaw * 0.4), "loc": (0, -lunge, 0)}, "arm.R": aim, "arm.L": (-10, 0, 10),
                   "chest": (-18, 0, 6), "head": (-8, 0, 0), "thigh.L": (-45, 0, 0), "shin.L": (25, 0, 0), "thigh.R": (25, 0, 0)},
            0.70: {"root": {"rot": (0, 0, yaw * 0.4), "loc": (0, -lunge, 0)}, "arm.R": aim, "arm.L": (-10, 0, 10),
                   "chest": (-18, 0, 6), "head": (-8, 0, 0), "thigh.L": (-45, 0, 0), "shin.L": (25, 0, 0), "thigh.R": (25, 0, 0)},
            1.0: Z0,
        }
    make_action("attack", 0.7, thrust(0.08, 20, 0.22))                       # straight thrust with a step
    make_action("attack2", 0.7, thrust(0.05, 40, 0.15, (92, -20, 0)))        # thrust swept across the front
    make_action("attack3", 0.7, thrust(0.12, 10, 0.32, (84, 0, 0)))          # long lunge, slightly high
    if bpy.data.actions.get("idle_tap"): bpy.data.actions.remove(bpy.data.actions["idle_tap"])
    make_action("idle_tap", 1.4, {      # thump the spear butt on the ground twice
        0.0: {"arm.R": {"loc": (0, 0, 0)}}, 0.2: {"arm.R": {"loc": (0, -0.06, 0)}}, 0.3: {"arm.R": {"loc": (0, 0.01, 0)}},
        0.5: {"arm.R": {"loc": (0, -0.06, 0)}}, 0.6: {"arm.R": {"loc": (0, 0.01, 0)}}, 1.0: {"arm.R": {"loc": (0, 0, 0)}},
    }, loop=False)
    make_action("ready", 1.6, {         # braced, spear levelled at the enemy (fighting / hold)
        0.0: {"arm.R": (88, 0, 0), "arm.L": (-30, 0, 10), "chest": (-6, 0, 0), "thigh.L": (-20, 0, 0), "shin.L": (15, 0, 0), "thigh.R": (15, 0, 0), "hips": {"loc": (0, 0, -0.02)}},
        0.5: {"arm.R": (86, 0, 0), "arm.L": (-30, 0, 10), "chest": (-4, 0, 0), "thigh.L": (-20, 0, 0), "shin.L": (15, 0, 0), "thigh.R": (15, 0, 0), "hips": {"loc": (0, 0, -0.03)}},
    })

make_action("death_fwd", 1.0, {
    0.0: {"root": {"rot": (0, 0, 0)}, "chest": (0, 0, 0), "arm.L": (0, 0, 0), "arm.R": (0, 0, 0), "head": (0, 0, 0)},
    0.3: {"root": {"rot": (10, 0, 0)}, "chest": (-15, 0, 0), "arm.L": (25, 0, 10), "arm.R": (25, 0, -10), "head": (-10, 0, 0)},
    1.0: {"root": {"rot": (84, 0, 0)}, "chest": (8, 0, 0), "arm.L": (-150, 0, 30), "arm.R": (-150, 0, -30), "head": (-25, 0, 0)},
}, loop=False)
make_action("death_back", 1.0, {
    0.0: {"root": {"rot": (0, 0, 0)}, "chest": (0, 0, 0), "arm.L": (0, 0, 0), "arm.R": (0, 0, 0), "thigh.L": (0, 0, 0)},
    0.3: {"root": {"rot": (-8, 0, 0)}, "chest": (18, 0, 0), "arm.L": (-40, 0, 30), "arm.R": (-40, 0, -30), "thigh.L": (-25, 0, 0)},
    1.0: {"root": {"rot": (-84, 0, 0)}, "chest": (10, 0, 0), "arm.L": (-120, 0, 60), "arm.R": (-120, 0, -60), "thigh.L": (-30, 0, 0)},
}, loop=False)
make_action("idle_look", 2.6, {        # glance left and right
    0.0: {"head": (0, 0, 0), "chest": (0, 0, 0)},
    0.25: {"head": (0, 0, 40), "chest": (0, 0, 8)},
    0.5: {"head": (0, 0, 40), "chest": (0, 0, 8)},
    0.75: {"head": (-5, 0, -40), "chest": (0, 0, -8)},
    1.0: {"head": (0, 0, 0), "chest": (0, 0, 0)},
}, loop=False)
make_action("idle_tap", 1.4, {         # bang the weapon on the shield
    0.0: {"arm.R": (0, 0, 0), "arm.L": (0, 0, 0)},
    0.2: {"arm.R": (-60, 0, 25), "arm.L": (-35, 0, -25)},
    0.35: {"arm.R": (-50, 0, 45), "arm.L": (-35, 0, -25)},
    0.5: {"arm.R": (-60, 0, 25), "arm.L": (-35, 0, -25)},
    0.65: {"arm.R": (-50, 0, 45), "arm.L": (-35, 0, -25)},
    1.0: {"arm.R": (0, 0, 0), "arm.L": (0, 0, 0)},
}, loop=False)
make_action("laugh", 1.3, {            # skull thrown back, rattling
    0.0: {"head": (0, 0, 0), "chest": (0, 0, 0), "arm.L": (0, 0, 0)},
    0.15: {"head": (-28, 0, 6), "chest": (10, 0, 0), "arm.L": (-15, 0, -20)},
    0.3: {"head": (-24, 0, -6), "chest": (6, 0, 0)},
    0.45: {"head": (-28, 0, 6), "chest": (10, 0, 0)},
    0.6: {"head": (-24, 0, -6), "chest": (6, 0, 0)},
    0.75: {"head": (-28, 0, 6), "chest": (10, 0, 0)},
    1.0: {"head": (0, 0, 0), "chest": (0, 0, 0), "arm.L": (0, 0, 0)},
}, loop=False)
make_action("fear", 0.5, {             # cowering behind the shield, trembling (loop)
    0.0: {"chest": (22, 0, 2), "head": (18, 0, 0), "arm.L": (-75, 0, -30), "arm.R": (10, 0, 15), "thigh.L": (-15, 0, 0), "thigh.R": (-15, 0, 0), "shin.L": (30, 0, 0), "shin.R": (30, 0, 0)},
    0.5: {"chest": (24, 0, -2), "head": (20, 0, 3), "arm.L": (-78, 0, -28), "arm.R": (12, 0, 15), "thigh.L": (-15, 0, 0), "thigh.R": (-15, 0, 0), "shin.L": (30, 0, 0), "shin.R": (30, 0, 0)},
})
make_action("rally", 1.1, {            # raise the sword, then point forward
    0.0: {"arm.R": (0, 0, 0), "chest": (0, 0, 0), "head": (0, 0, 0)},
    0.3: {"arm.R": (-165, 0, -10), "chest": (-8, 0, 0), "head": (-12, 0, 0)},
    0.55: {"arm.R": (-160, 0, -10), "chest": (-8, 0, 0), "head": (-12, 0, 0)},
    0.75: {"arm.R": (-95, 0, 0), "chest": (-12, 0, 10), "head": (0, 0, 0)},
    1.0: {"arm.R": (0, 0, 0), "chest": (0, 0, 0), "head": (0, 0, 0)},
}, loop=False)
make_action("cheer2", 0.8, {           # jump for joy (loops at the end of a won battle)
    0.0: {"root": {"loc": (0, 0, 0)}, "arm.R": (-30, 0, 0), "arm.L": (-30, 0, 0), "thigh.L": (-20, 0, 0), "thigh.R": (-20, 0, 0), "shin.L": (35, 0, 0), "shin.R": (35, 0, 0)},
    0.4: {"root": {"loc": (0, 0, 0.18)}, "arm.R": (-170, 0, -15), "arm.L": (-160, 0, 15), "thigh.L": (0, 0, 0), "thigh.R": (0, 0, 0), "shin.L": (5, 0, 0), "shin.R": (5, 0, 0)},
})

# ---- sword users: "raise the sword" must LIFT the arm (bone loc), not rotate it -165 deg: the blade sits above the
#   shoulder pivot, so a big rotation points it at the ground. Arm bone local -Y = up. (Archers keep their clips.)
if KIND not in ("archer", "brute"):
    for _n in ("cheer", "rally", "cheer2"):
        if bpy.data.actions.get(_n): bpy.data.actions.remove(bpy.data.actions[_n])
    UP = lambda h, tilt=-15, out=-12: {"rot": (tilt, 0, out), "loc": (0, -h, 0)}
    make_action("cheer", 1.0, {         # sword thrust up to the sky, pumped twice
        0.0: {"arm.R": UP(0, 0, 0), "hips": {"loc": (0, 0, 0)}, "chest": (0, 0, 0), "head": (0, 0, 0)},
        0.22: {"arm.R": UP(0.15, -22), "hips": {"loc": (0, 0, 0.04)}, "chest": (6, 0, 0), "head": (10, 0, 0)},
        0.42: {"arm.R": UP(0.08, -8), "hips": {"loc": (0, 0, 0)}, "chest": (3, 0, 0), "head": (6, 0, 0)},
        0.62: {"arm.R": UP(0.16, -24), "hips": {"loc": (0, 0, 0.04)}, "chest": (6, 0, 0), "head": (10, 0, 0)},
        1.0: {"arm.R": UP(0, 0, 0), "hips": {"loc": (0, 0, 0)}, "chest": (0, 0, 0), "head": (0, 0, 0)},
    }, loop=False)
    make_action("rally", 1.1, {         # raise the sword high, then point it at the enemy
        0.0: {"arm.R": UP(0, 0, 0), "chest": (0, 0, 0), "head": (0, 0, 0)},
        0.28: {"arm.R": UP(0.16, -20), "chest": (6, 0, -6), "head": (10, 0, 0)},
        0.52: {"arm.R": UP(0.16, -24), "chest": (6, 0, -6), "head": (10, 0, 0)},
        0.72: {"arm.R": UP(0, 95, 5), "chest": (-12, 0, 8), "head": (-4, 0, 0), "root": {"loc": (0, -0.06, 0)}},
        0.88: {"arm.R": UP(0, 95, 5), "chest": (-12, 0, 8), "head": (-4, 0, 0), "root": {"loc": (0, -0.06, 0)}},
        1.0: {"arm.R": UP(0, 0, 0), "chest": (0, 0, 0), "head": (0, 0, 0)},
    }, loop=False)
    make_action("cheer2", 0.8, {        # jump for joy with the sword up (loops at the end of a won battle)
        0.0: {"root": {"loc": (0, 0, 0)}, "arm.R": UP(0.04, -5), "arm.L": (-15, 0, 0), "thigh.L": (-20, 0, 0), "thigh.R": (-20, 0, 0), "shin.L": (35, 0, 0), "shin.R": (35, 0, 0)},
        0.4: {"root": {"loc": (0, 0, 0.18)}, "arm.R": UP(0.17, -25), "arm.L": (-40, 0, 20), "thigh.L": (0, 0, 0), "thigh.R": (0, 0, 0), "shin.L": (5, 0, 0), "shin.R": (5, 0, 0)},
    })

if LONG:
    spear_clips()

rig.animation_data.action = None
for b in pb:
    b.rotation_euler = (0, 0, 0); b.location = (0, 0, 0)

# ---------------------------------------------------------------- export
for o in scene.objects:
    o.select_set(o in (rig, body))
bpy.ops.export_scene.gltf(filepath=DST, export_format="GLB", use_selection=True,
                          export_animation_mode="ACTIONS", export_force_sampling=True,
                          export_image_format="JPEG", export_jpeg_quality=88,
                          export_apply=False, export_skins=True, export_yup=True)
print("EXPORTED", DST, "tris", sum(len(p.vertices) - 2 for p in body.data.polygons),
      "hip_hw", round(hip_hw, 3), "back_of_feet", round(back_of_feet, 3))

# ---------------------------------------------------------------- preview renders
if RENDER:
    scene.render.engine = "CYCLES"; scene.cycles.device = "CPU"; scene.cycles.samples = 12
    scene.render.resolution_x = 384; scene.render.resolution_y = 384
    world = bpy.data.worlds.new("w"); scene.world = world; world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.35, 0.37, 0.4, 1)
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3; sun.rotation_euler = (R(50), 0, R(30)); scene.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); scene.collection.objects.link(cam); scene.camera = cam
    cam.data.type = "ORTHO"; cam.data.ortho_scale = 1.6
    # 3/4 front view from the character's right-front
    cam.location = Vector((-1.6, -2.4, 1.3))
    if len(argv) > 5 and argv[5] == "top":       # roughly the in-game camera: high, from the front
        cam.location = Vector((0, -2.0, 2.6))
    if len(argv) > 5 and argv[5] == "side":      # from the character's right: shows reach / weapon direction
        cam.location = Vector((-2.8, -0.4, 0.9))
    cam.rotation_euler = (Vector((0, 0, 0.45)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    shots = [("rest", None, 0), ("walk", "walk", 0.0), ("attack_up", "attack", 0.35), ("attack_hit", "attack", 0.55),
             ("block", "block", 1.0), ("shoot", "shoot", 0.7), ("death", "death", 1.0),
             ("attack2_up", "attack2", 0.35), ("attack2_hit", "attack2", 0.6), ("attack3_hit", "attack3", 0.55),
             ("death_fwd", "death_fwd", 1.0), ("death_back", "death_back", 1.0), ("idle_look", "idle_look", 0.3),
             ("idle_tap", "idle_tap", 0.35), ("laugh", "laugh", 0.15), ("fear", "fear", 0.0), ("rally", "rally", 0.35),
             ("rally_point", "rally", 0.75), ("cheer2", "cheer2", 0.5)]
    if bpy.data.actions.get("ready"): shots.append(("ready", "ready", 0.0))
    if len(argv) > 6:   # frame-by-frame sequence of one clip, e.g. "attack2"
        shots = [(f"{c}_{i}", c, i / 7) for c in argv[6].split(",") for i in range(8)]   # one or more clips, comma separated
        cam.data.ortho_scale = 1.3
    for label, act, frac in shots:
        a = bpy.data.actions.get(act) if act else None
        rig.animation_data.action = a
        if a:
            f0, f1 = a.frame_range
            scene.frame_set(int(round(f0 + frac * (f1 - f0))))
        else:
            for b in pb: b.rotation_euler = (0, 0, 0); b.location = (0, 0, 0)
            scene.frame_set(1)
        scene.render.filepath = f"{RENDER}_{label}.png"
        bpy.ops.render.render(write_still=True)
print("DONE")
