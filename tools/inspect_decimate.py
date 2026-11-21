"""Blender headless: import a Tripo GLB, report stats, decimate, render previews (CPU Cycles).

Usage:
  blender -b --factory-startup -P inspect_decimate.py -- <in.glb> <out.glb> <render_prefix> <target_tris>
"""
import sys, math, bpy, bmesh
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
src, dst, render_prefix, target = argv[0], argv[1], argv[2], int(argv[3])

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
def tri_count(objs):
    n = 0
    for o in objs:
        for p in o.data.polygons:
            n += len(p.vertices) - 2
    return n

print("MESH OBJECTS:", [(o.name, len(o.data.vertices)) for o in meshes])
print("MATERIALS:", [m.name for m in bpy.data.materials])
print("IMAGES:", [(i.name, tuple(i.size)) for i in bpy.data.images])
before = tri_count(meshes)
print("TRIS BEFORE:", before)

# Join into a single mesh
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
# apply transforms
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# Merge by distance first (Tripo meshes are often split per-triangle for UVs)
bm = bmesh.new(); bm.from_mesh(obj.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
bm.to_mesh(obj.data); bm.free()

ratio = min(1.0, target / max(1, tri_count([obj])))
mod = obj.modifiers.new("dec", "DECIMATE")
mod.ratio = ratio
mod.use_collapse_triangulate = True
bpy.ops.object.modifier_apply(modifier="dec")
after = tri_count([obj])
print("TRIS AFTER:", after, "ratio", ratio)

# bounds
bb = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
mn = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb)))
mx = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
print("BOUNDS MIN", tuple(round(c, 3) for c in mn), "MAX", tuple(round(c, 3) for c in mx))

bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", use_selection=False,
                          export_image_format="JPEG", export_jpeg_quality=85)

# Previews
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 16
scene.render.resolution_x = 512
scene.render.resolution_y = 512
scene.render.film_transparent = False
world = bpy.data.worlds.new("w"); scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.35, 0.37, 0.4, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 1.2
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 3; sun.rotation_euler = (math.radians(50), 0, math.radians(30))
scene.collection.objects.link(sun)

center = (mn + mx) / 2
size = max(mx - mn)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
scene.collection.objects.link(cam); scene.camera = cam
for name, ang in (("a0", 0), ("a90", 90), ("a180", 180), ("a270", 270)):
    a = math.radians(ang)
    # glTF imports with +Y up converted to Blender Z-up; character faces -Y typically
    cam.location = center + Vector((math.sin(a) * size * 2.2, -math.cos(a) * size * 2.2, size * 0.3))
    d = center - cam.location
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = f"{render_prefix}_{name}.png"
    bpy.ops.render.render(write_still=True)
print("DONE")
