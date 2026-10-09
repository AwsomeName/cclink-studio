/**
 * Fixed FreeCAD adapter. Agent input is supplied only through a validated JSON request file;
 * no model-provided Python or shell text is ever interpolated into this script.
 */
export const FREECAD_SECTION_INSERT_SCRIPT = String.raw`
import hashlib
import json
import os
import re
import sys
import traceback

import FreeCAD as App
import Import
import Part


def file_hash(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def axis_coord(vector, axis):
    return {'X': vector.x, 'Y': vector.y, 'Z': vector.z}[axis]


def axis_min(box, axis):
    return {'X': box.XMin, 'Y': box.YMin, 'Z': box.ZMin}[axis]


def axis_max(box, axis):
    return {'X': box.XMax, 'Y': box.YMax, 'Z': box.ZMax}[axis]


def bounds(shape):
    box = shape.BoundBox
    return {
        'min': {'x': box.XMin, 'y': box.YMin, 'z': box.ZMin},
        'max': {'x': box.XMax, 'y': box.YMax, 'z': box.ZMax},
        'size': {'x': box.XLength, 'y': box.YLength, 'z': box.ZLength},
    }


def bop_status(shape):
    try:
        shape.check(True)
        return {
            'ok': True,
            'errorCount': 0,
            'errorTypes': [],
            'parserComplete': True,
            'unparsedLineCount': 0,
        }
    except Exception as exc:
        lines = [line.strip() for line in str(exc).splitlines() if line.strip()]
        header_ok = bool(lines) and lines[0] == 'BOP check found the following errors:'
        details = lines[1:] if header_ok else lines
        matches = [re.fullmatch(r'Error in [A-Za-z0-9_ ]+: BOPAlgo_([A-Za-z0-9_]+)', line) for line in details]
        unparsed_count = sum(1 for match in matches if match is None)
        error_types = sorted(set(match.group(1) for match in matches if match is not None))
        parser_complete = (
            type(exc).__name__ == 'ValueError'
            and header_ok
            and len(details) > 0
            and unparsed_count == 0
            and len(error_types) > 0
        )
        return {
            'ok': False,
            'errorCount': len(details),
            'errorTypes': error_types,
            'parserComplete': parser_complete,
            'exceptionType': type(exc).__name__,
            'unparsedLineCount': unparsed_count,
        }


def shape_evidence(shapes):
    if len(shapes) != 1:
        raise RuntimeError('expected exactly one STEP shape object, found %d' % len(shapes))
    shape = shapes[0]
    try:
        shape.check(False)
        basic_ok = True
    except Exception:
        basic_ok = False
    return shape, {
        'objectCount': len(shapes),
        'solidCount': len(shape.Solids),
        'faceCount': len(shape.Faces),
        'volume': shape.Volume,
        'closed': bool(shape.isClosed()),
        'valid': bool(shape.isValid()),
        'basicCheckOk': basic_ok,
        'bounds': bounds(shape),
        'bop': bop_status(shape),
    }


def load_step(path, name):
    doc = App.newDocument(name)
    Import.insert(path, doc.Name)
    doc.recompute()
    shapes = [obj.Shape for obj in doc.Objects if hasattr(obj, 'Shape') and not obj.Shape.isNull()]
    shape, evidence = shape_evidence(shapes)
    return doc, shape, evidence


def make_region(box, axis, start, end, margin):
    origin = App.Vector(box.XMin - margin, box.YMin - margin, box.ZMin - margin)
    lengths = {
        'X': box.XLength + 2 * margin,
        'Y': box.YLength + 2 * margin,
        'Z': box.ZLength + 2 * margin,
    }
    if axis == 'X':
        origin.x = start
    elif axis == 'Y':
        origin.y = start
    else:
        origin.z = start
    lengths[axis] = end - start
    return Part.makeBox(lengths['X'], lengths['Y'], lengths['Z'], origin)


def interface_faces(shape, axis, plane, tolerance=1e-5):
    result = []
    for face in shape.Faces:
        if face.Vertexes and all(
            abs(axis_coord(vertex.Point, axis) - plane) <= tolerance
            for vertex in face.Vertexes
        ):
            result.append(face)
    return result


def movement_vector(axis, signed_distance):
    if axis == 'X':
        return App.Vector(signed_distance, 0, 0)
    if axis == 'Y':
        return App.Vector(0, signed_distance, 0)
    return App.Vector(0, 0, signed_distance)


def expected_bounds(source_bounds, axis, signed_distance):
    result = json.loads(json.dumps(source_bounds))
    key = axis.lower()
    if signed_distance > 0:
        result['max'][key] += signed_distance
    else:
        result['min'][key] += signed_distance
    result['size'][key] += abs(signed_distance)
    return result


def split_source(source, axis, plane, signed_distance):
    box = source.BoundBox
    if not axis_min(box, axis) < plane < axis_max(box, axis):
        raise RuntimeError('split plane must be inside source bounds')
    margin = max(box.XLength, box.YLength, box.ZLength) + abs(signed_distance) + 10.0
    low = source.common(make_region(box, axis, axis_min(box, axis) - margin, plane, margin))
    high = source.common(make_region(box, axis, plane, axis_max(box, axis) + margin, margin))
    if len(low.Solids) != 1 or len(high.Solids) != 1:
        raise RuntimeError('split must produce exactly one solid on each side')
    fixed = low if signed_distance > 0 else high
    moving = high.copy() if signed_distance > 0 else low.copy()
    faces = interface_faces(fixed, axis, plane)
    if not faces:
        raise RuntimeError('split produced no planar interface face')
    return low, high, fixed, moving, faces


def fixed_region_evidence(source_fixed, output, source_box, axis, plane, signed_distance):
    margin = max(source_box.XLength, source_box.YLength, source_box.ZLength) + abs(signed_distance) + 10.0
    if signed_distance > 0:
        region = make_region(
            source_box,
            axis,
            axis_min(source_box, axis) - margin,
            plane,
            margin,
        )
    else:
        region = make_region(
            source_box,
            axis,
            plane,
            axis_max(source_box, axis) + margin,
            margin,
        )
    output_fixed = output.common(region).removeSplitter()
    common = source_fixed.common(output_fixed).removeSplitter()
    source_volume = source_fixed.Volume
    output_volume = output_fixed.Volume
    common_volume = common.Volume
    source_only = max(0.0, source_volume - common_volume)
    output_only = max(0.0, output_volume - common_volume)
    return {
        'sourceVolume': source_volume,
        'outputVolume': output_volume,
        'commonVolume': common_volume,
        'sourceOnlyVolume': source_only,
        'outputOnlyVolume': output_only,
        'symmetricDifferenceVolume': source_only + output_only,
        'sourceSolidCount': len(source_fixed.Solids),
        'outputSolidCount': len(output_fixed.Solids),
        'sourceClosed': bool(source_fixed.isClosed()),
        'outputClosed': bool(output_fixed.isClosed()),
        'sourceValid': bool(source_fixed.isValid()),
        'outputValid': bool(output_fixed.isValid()),
    }


def validate_request(request):
    if request.get('operation') != 'section-insert':
        raise RuntimeError('unsupported operation')
    axis = str(request.get('axis', '')).upper()
    if axis not in ('X', 'Y', 'Z'):
        raise RuntimeError('axis must be x, y or z')
    direction = request.get('direction')
    fixed_side = request.get('fixedSide')
    if direction == 'positive' and fixed_side != 'min':
        raise RuntimeError('positive direction requires fixedSide=min')
    if direction == 'negative' and fixed_side != 'max':
        raise RuntimeError('negative direction requires fixedSide=max')
    if direction not in ('positive', 'negative'):
        raise RuntimeError('direction must be positive or negative')
    distance = float(request.get('distanceMm'))
    if not 0.1 <= distance <= 10.0:
        raise RuntimeError('distanceMm must be between 0.1 and 10 mm')
    plane = float(request.get('splitPlane'))
    return axis, plane, distance if direction == 'positive' else -distance


def run(request):
    axis, plane, signed_distance = validate_request(request)
    input_path = request['inputPath']
    source_doc, source, source_evidence = load_step(input_path, 'CCLinkCadSource')
    output_doc = None
    validation_doc = None
    try:
        if source_evidence['solidCount'] != 1 or not source_evidence['closed'] or not source_evidence['valid'] or not source_evidence['basicCheckOk']:
            raise RuntimeError('source STEP is not one closed valid solid')
        low, high, fixed, moving, faces = split_source(source, axis, plane, signed_distance)
        split = {
            'lowSolidCount': len(low.Solids),
            'highSolidCount': len(high.Solids),
            'interfaceFaceCount': len(faces),
            'interfaceArea': sum(face.Area for face in faces),
        }
        predicted = expected_bounds(source_evidence['bounds'], axis, signed_distance)
        if request['mode'] == 'plan':
            return {
                'success': True,
                'mode': 'plan',
                'sourceHash': file_hash(input_path),
                'source': source_evidence,
                'split': split,
                'expectedBounds': predicted,
            }
        movement = movement_vector(axis, signed_distance)
        moving.translate(movement)
        bridges = [face.extrude(movement) for face in faces]
        if any(len(bridge.Solids) == 0 for bridge in bridges):
            raise RuntimeError('section extrusion did not produce a solid bridge')
        result = fixed
        for bridge in bridges:
            result = result.fuse(bridge)
        result = result.fuse(moving).removeSplitter()
        if len(result.Solids) != 1:
            raise RuntimeError('fused result must contain exactly one solid')
        output_path = request['outputPath']
        output_doc = App.newDocument('CCLinkCadOutput')
        feature = output_doc.addObject('Part::Feature', 'ModifiedStep')
        feature.Shape = result.Solids[0]
        output_doc.recompute()
        Import.export([feature], output_path)
        App.closeDocument(output_doc.Name)
        output_doc = None
        validation_doc, output, output_evidence = load_step(request['outputPath'], 'CCLinkCadValidation')
        fixed_region = fixed_region_evidence(
            fixed,
            output,
            source.BoundBox,
            axis,
            plane,
            signed_distance,
        )
        output_evidence['fileSize'] = os.path.getsize(request['outputPath'])
        return {
            'success': True,
            'mode': 'modify',
            'sourceHashAfter': file_hash(input_path),
            'source': source_evidence,
            'split': split,
            'expectedBounds': predicted,
            'fixedRegion': fixed_region,
            'output': output_evidence,
        }
    finally:
        if validation_doc is not None:
            App.closeDocument(validation_doc.Name)
        if output_doc is not None:
            App.closeDocument(output_doc.Name)
        App.closeDocument(source_doc.Name)


args = sys.argv[sys.argv.index('--pass') + 1:]
request_path = args[0]
result_path = args[1]
try:
    with open(request_path, 'r', encoding='utf-8') as request_file:
        request = json.load(request_file)
    result = run(request)
except Exception as exc:
    result = {
        'success': False,
        'error': str(exc),
        'traceback': traceback.format_exc(limit=6),
    }
with open(result_path, 'w', encoding='utf-8') as result_file:
    json.dump(result, result_file, sort_keys=True)
raise SystemExit(0 if result.get('success') else 2)
`.trim()
