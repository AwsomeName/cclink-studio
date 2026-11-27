"""Make an editable, open-top polygon tray from the re-read child .blend."""
import FreeCAD as App
import Part
import json
import math
import traceback
from pathlib import Path

def run(root):
    job = json.loads((root / "job.json").read_text())
    measured = json.loads((root / "geometry.json").read_text())
    points = measured["points"]
    height = measured["heightMm"]
    wall, floor = job["wallMm"], job["floorMm"]
    if floor >= height:
        raise ValueError("底厚必须小于外高")
    V = App.Vector
    doc = App.newDocument("Housing")
    dims = doc.addObject("Spreadsheet::Sheet", "Dimensions")
    for i, (name, value) in enumerate([("Wall",wall),("Floor",floor),("Height",height)],1):
        cell = "B"+str(i)
        dims.set("A"+str(i),name)
        dims.set(cell,str(value)+" mm")
        dims.setAlias(cell,name)
    outline = doc.addObject("Sketcher::SketchObject","Outline")
    n = len(points)
    for i,p in enumerate(points):
        outline.addGeometry(Part.LineSegment(V(*p,0),V(*points[(i+1)%n],0)),False)
    def extrude(name, base):
        obj = doc.addObject("Part::Extrusion",name)
        obj.Base = base
        obj.Dir = V(0,0,1)
        obj.Solid = True
        obj.setExpression("LengthFwd","Dimensions.Height")
        return obj
    outer = extrude("Outer",outline)
    inset = doc.addObject("Part::Offset2D","InsideProfile")
    inset.Source = outline
    inset.Join = "Intersection"
    inset.setExpression("Value","-Dimensions.Wall")
    cavity = extrude("Cavity",inset)
    cavity.setExpression("Placement.Base.z","Dimensions.Floor")
    shell = doc.addObject("Part::Cut","OpenHousing")
    shell.Base, shell.Tool = outer, cavity
    doc.recompute()

    def check(shape, thickness):
        if shape.isNull() or len(shape.Solids)!=1 or not shape.isValid() or not shape.isClosed():
            raise ValueError("没有得到单个封闭有效底壳，请检查轮廓、壁厚和底厚")
        shape.check(True)
        # Independently intersect the inward-offset infinite edge lines at every corner.
        normals = []
        for i,p in enumerate(points):
            q = points[(i+1)%n]
            dx,dy=q[0]-p[0],q[1]-p[1]
            length=math.hypot(dx,dy)
            normals.append((-dy/length,dx/length))
        inner=[]
        for i,(x,y) in enumerate(points):
            a,b=normals[i-1],normals[i]
            scale=thickness/(1+a[0]*b[0]+a[1]*b[1])
            inner.append([x+scale*(a[0]+b[0]),y+scale*(a[1]+b[1])])
        for q in inner:
            for p,(nx,ny) in zip(points,normals):
                if (q[0]-p[0])*nx+(q[1]-p[1])*ny < thickness-0.001:
                    raise ValueError("壁厚使内轮廓消失或边界交叉")
        want=[V(*p,z) for poly,zs in ((points,(0,height)),(inner,(floor,height))) for z in zs for p in poly]
        got=[v.Point for v in shape.Vertexes]
        if len(got)!=len(want) or any(min((v-w).Length for v in got)>0.005 for w in want):
            raise ValueError("回读后的外形、内腔或底面偏差超过 0.005 mm")
        def area(poly):
            return abs(sum(p[0]*poly[(i+1)%n][1]-p[1]*poly[(i+1)%n][0] for i,p in enumerate(poly)))/2
        volume=area(points)*height-area(inner)*(height-floor)
        if not math.isclose(shape.Volume,volume,rel_tol=1e-7,abs_tol=0.001):
            raise ValueError("开口底壳体积与实测轮廓不符")
        return {"outerWidthMm":shape.BoundBox.XLength,"innerWidthMm":max(q[0] for q in inner)-min(q[0] for q in inner),
                "heightMm":shape.BoundBox.ZLength,"volumeMm3":shape.Volume}
    check(shell.Shape,wall)
    for obj in [outline,inset,cavity,outer]:
        obj.Visibility=False
    doc.recompute()
    doc.saveAs(str(root/"housing.FCStd"))
    App.closeDocument(doc.Name)
    doc=App.openDocument(str(root/"housing.FCStd"))
    dims=doc.getObject("Dimensions")
    shell=doc.getObject("OpenHousing")
    # Prove a reopened native document actually reacts to a wall edit.
    dims.set("B1",str(wall/2)+" mm")
    doc.recompute()
    changed=check(shell.Shape,wall/2)
    dims.set("B1",str(wall)+" mm")
    doc.recompute()
    check(shell.Shape,wall)
    shell.Shape.exportStep(str(root/"housing.step"))
    result=check(Part.read(str(root/"housing.step")),wall)
    result.update({"backend":".".join(App.Version()[:3]),"solidCount":1,"wallMm":wall,"floorMm":floor,
                   "testWallMm":wall/2,"testInnerWidthMm":changed["innerWidthMm"]})
    (root/"checked.json").write_text(json.dumps(result))
    App.closeDocument(doc.Name)

try:
    run(Path(__studio_job_dir__))
except Exception as error:
    (Path(__studio_job_dir__)/"failure.txt").write_text(str(error) or traceback.format_exc()[-1000:])
