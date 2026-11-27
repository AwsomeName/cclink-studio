"""Studio's bounded driver. Coordinates exchanged with the host are in millimetres."""
import bpy
import json
import sys
from pathlib import Path
from mathutils import Vector

root = Path(sys.argv[-1])
job = json.loads((root / "job.json").read_text())
n = len(job["points"])
height = job["heightMm"]


def vertices(points):
    return [(x / 1000, y / 1000, z / 1000) for z in (0, height) for x, y in points]


def faces():
    return [tuple(reversed(range(n))), tuple(range(n, 2*n))] + [
        (i, (i+1) % n, (i+1) % n+n, i+n) for i in range(n)
    ]


def read_outline(expected):
    objects = list(bpy.context.scene.objects)
    if len(objects) != 1 or objects[0].type != "MESH":
        raise ValueError("源文件必须只有本版的一个壳体")
    obj = objects[0].evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = obj.data
    actual = [obj.matrix_world @ v.co for v in mesh.vertices]
    wanted = vertices(expected)
    if len(actual) != len(wanted) or any((a-Vector(b)).length > 0.000001 for a,b in zip(actual,wanted)):
        raise ValueError("Blender 求值后的轮廓与所选版本相差超过 0.001 mm")
    if {tuple(p.vertices) for p in mesh.polygons} != set(faces()) or len(mesh.polygons) != n+2:
        raise ValueError("Blender 面拓扑已变化")
    return [[round(c*1000,5) for c in v] for v in actual]


if job["mode"] == "create":
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mesh = bpy.data.meshes.new("Outline")
    mesh.from_pydata(vertices(job["points"]), [], faces())
    mesh.update()
    body = bpy.data.objects.new("Housing", mesh)
    bpy.context.collection.objects.link(body)
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.length_unit = "MILLIMETERS"
else:
    bpy.ops.wm.open_mainfile(filepath=str(root / "source.blend"), use_scripts=False)
    before = read_outline(job["sourcePoints"])
    if job["mode"] == "revise":
        # Alter the two endpoints of one upright corner in the real parent mesh.
        j = job["target"]
        obj = list(bpy.context.scene.objects)[0]
        coords = vertices(job["points"])
        for k in (j, j+n):
            obj.data.vertices[k].co = coords[k]
        obj.data.update()

if job["mode"] != "inspect":
    bpy.ops.wm.save_as_mainfile(filepath=str(root / "shape.blend"))
    bpy.ops.wm.open_mainfile(filepath=str(root / "shape.blend"), use_scripts=False)

actual = read_outline(job["points"])
receipt = {"points": [v[:2] for v in actual[:n]], "heightMm": actual[n][2],
           "backend": bpy.app.version_string}
if job["mode"] == "revise":
    edge = job["lock"]
    fixed = [edge, (edge+1) % n, edge+n, (edge+1) % n+n]
    receipt["lockedFaceDeviationMm"] = max((Vector(actual[k])-Vector(before[k])).length for k in fixed)
    receipt["targetBeforeMm"] = before[j][:2]
    receipt["targetAfterMm"] = actual[j][:2]
if job["mode"] != "inspect":
    bpy.ops.export_scene.gltf(filepath=str(root / "shape.glb"), export_format="GLB")
(root / "geometry.json").write_text(json.dumps(receipt))
