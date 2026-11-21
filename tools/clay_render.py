"""Blender headless: geometry-only ("clay") renders of a GLB at full resolution, to compare shapes fairly.

Usage: blender -b --factory-startup -P clay_render.py -- <in.glb> <out_prefix> [facing_deg]
Writes <out_prefix>_front.png, _side.png, _back.png, _face.png (close-up of the upper body).
"""
import sys, math, bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
src, prefix = argv[0], argv[1]
facing = float(argv[2]) if len(argv) > 2 else 0.0

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
clay = bpy.data.materials.new("clay"); clay.use_nodes = True
bsdf = clay.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (0.72, 0.70, 0.68, 1); bsdf.inputs["Roughness"].default_value = 0.55
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
for o in meshes:
    o.data.materials.clear(); o.data.materials.append(clay)
    o.rotation_mode = "XYZ"
pivot = bpy.data.objects.new("pivot", None); bpy.context.scene.collection.objects.link(pivot)
for o in meshes:
    o.parent = pivot
pivot.rotation_euler = (0, 0, math.radians(facing))
bpy.context.view_layer.update()

pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
center, size = (mn + mx) / 2, max(mx - mn)

sc = bpy.context.scene
sc.render.engine = "CYCLES"; sc.cycles.device = "CPU"; sc.cycles.samples = 24
sc.render.resolution_x = sc.render.resolution_y = 900
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.32, 0.34, 0.38, 1)
key = bpy.data.objects.new("key", bpy.data.lights.new("key", "SUN")); key.data.energy = 3.5
key.rotation_euler = (math.radians(55), 0, math.radians(-35)); sc.collection.objects.link(key)
rim = bpy.data.objects.new("rim", bpy.data.lights.new("rim", "SUN")); rim.data.energy = 1.5
rim.rotation_euler = (math.radians(60), 0, math.radians(150)); sc.collection.objects.link(rim)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = "ORTHO"

def shot(name, ang, scale, look_z):
    a = math.radians(ang)
    tgt = Vector((center.x, center.y, look_z))
    cam.location = tgt + Vector((math.sin(a) * size * 3, -math.cos(a) * size * 3, size * 0.25))
    cam.rotation_euler = (tgt - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.ortho_scale = scale
    sc.render.filepath = f"{prefix}_{name}.png"
    bpy.ops.render.render(write_still=True)

h = mx.z - mn.z
shot("front", 0, size * 1.15, center.z)
shot("side", 90, size * 1.15, center.z)
shot("back", 180, size * 1.15, center.z)
shot("face", 15, h * 0.55, mn.z + h * 0.68)
print("TRIS", sum(len(p.vertices) - 2 for o in meshes for p in o.data.polygons))
