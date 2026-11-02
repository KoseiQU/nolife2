# enemy_body_render.py — 管理人の全身を、アクションの代表フレームごとに 1 枚ずつ描く(P5b-5b ハンマーの向きの目視監査用)。
#
#   Blender -b build/enemy/07_rigged.blend --factory-startup -P tools/blender/enemy_body_render.py -- \
#     --shots "walk_standard:mid;look_idle:minlat;attack_downward:peak_hand;door_open_in:0.35" \
#     [--view diag|front|side] [--w 300] [--h 450] [--engine eevee|cycles] [--samples 32] [--frames_json f.json] \
#     --outdir <dir> [--prefix after]
#
#   shots: アクション:フレーム。mid=中間、0〜1 の小数=長さの割合、peak_hand=右手が最も高い瞬間、
#          minlat=ハンマーの頭が最も左(正中寄り)に来る瞬間(補正前の .blend で選ぶ)、整数=フレーム番号。
#   --frames_json: 選んだフレームを書き出す/読み込む(補正前で選んだフレームを補正後でもそのまま使うため。あれば読む)。
#   view: diag=体の右前 35°(ハンマーの側)、front=正面、side=右真横。カメラは骨盤に合わせて体の向きに追従する。
#   出力: <outdir>/<prefix>_<i>_<action>@<frame>.png(1 ショット 1 枚)。左手には懐中電灯の代役(enemy.js と同じ寸法)。

import bpy, json, math, os, sys
import numpy as np
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
from n2common import parse_args, log  # noqa: E402

ARGS = parse_args({'shots': 'walk_standard:mid', 'view': 'diag', 'w': '300', 'h': '450', 'engine': 'eevee',
                   'samples': '32', 'frames_json': '', 'outdir': '', 'prefix': 'shot'})
import mixamo_merge as mm  # noqa: E402

AZ = {'diag': 35.0, 'front': 0.0, 'side': 90.0}


def setup(scene):
    if ARGS['engine'] == 'cycles':
        scene.render.engine = 'CYCLES'
        try:
            prefs = bpy.context.preferences.addons['cycles'].preferences
            prefs.compute_device_type = 'METAL'; prefs.get_devices()
            for d in prefs.devices:
                d.use = (d.type == 'METAL')
            scene.cycles.device = 'GPU'
        except Exception as e:  # noqa: BLE001
            log(f'GPU 設定失敗 → CPU: {e}')
        scene.cycles.samples = int(ARGS['samples']); scene.cycles.use_denoising = True
    else:
        scene.render.engine = 'BLENDER_EEVEE'
        try:
            scene.eevee.taa_render_samples = int(ARGS['samples'])
        except Exception:  # noqa: BLE001
            pass
    scene.view_settings.view_transform = 'AgX'
    scene.render.resolution_x = int(ARGS['w']); scene.render.resolution_y = int(ARGS['h'])
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = 'PNG'
    w = bpy.data.worlds.new('N2_body_world'); scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (0.30, 0.31, 0.33, 1); bg.inputs['Strength'].default_value = 1.0
    cam = bpy.data.objects.new('N2_body_cam', bpy.data.cameras.new('N2_body_cam'))
    scene.collection.objects.link(cam); scene.camera = cam
    cam.data.lens = 50
    sun = bpy.data.objects.new('N2_body_sun', bpy.data.lights.new('N2_body_sun', 'SUN'))
    sun.data.energy = 3.0; sun.data.angle = math.radians(20)
    scene.collection.objects.link(sun)
    me = bpy.data.meshes.new('N2_floor'); me.from_pydata([(-6, -6, 0), (6, -6, 0), (6, 6, 0), (-6, 6, 0)], [], [(0, 1, 2, 3)])
    fl = bpy.data.objects.new('N2_floor', me); scene.collection.objects.link(fl)
    m = bpy.data.materials.new('N2_floor'); m.use_nodes = True
    m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (0.22, 0.22, 0.23, 1)
    me.materials.append(m)
    return cam, sun


def flashlight_proxy(scene):
    import bmesh
    mat = bpy.data.materials.new('N2_flash_proxy'); mat.use_nodes = True
    b = mat.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (0.03, 0.03, 0.035, 1); b.inputs['Metallic'].default_value = 0.85
    b.inputs['Roughness'].default_value = 0.42
    objs = []
    for name, r1, r2, ln, zc in (('body', 0.016, 0.016, 0.15, -0.04), ('head', 0.024, 0.018, 0.045, 0.055)):
        me = bpy.data.meshes.new('N2_flash_' + name)
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=20, radius1=r2, radius2=r1, depth=ln)
        bm.to_mesh(me); bm.free()
        o = bpy.data.objects.new('N2_flash_' + name, me); o.data.materials.append(mat)
        o['zc'] = zc
        scene.collection.objects.link(o); objs.append(o)
    return objs


def pick_frame(arm, act, spec, hp):
    f0, f1 = int(act.frame_range[0]), int(act.frame_range[1])
    if spec in ('', 'mid'):
        return (f0 + f1) // 2
    if spec in ('peak_hand', 'minlat'):
        best, f = None, f0
        for k in range(f0, f1 + 1):
            mm.set_action(arm, act, k)
            if spec == 'peak_hand':
                v = -(arm.matrix_world @ arm.pose.bones['mixamorig:RightHand'].head).z
            else:
                v = mm.hammer_metrics(mm.hammer_frame_state(arm, hp['Right'], hp['Left']))['head_lat']
            if best is None or v < best:
                best, f = v, k
        return f
    if '.' in spec:
        return int(round(f0 + (f1 - f0) * float(spec)))
    return int(spec)


def main():
    scene = bpy.context.scene
    arm = next(o for o in scene.objects if o.type == 'ARMATURE' and 'n2_candidate' in o)
    arm.data.pose_position = 'REST'; bpy.context.view_layer.update()
    hp = {sd: mm.hand_pose(arm, sd, mm.HAND_POSE[sd]) for sd in ('Right', 'Left')}
    arm.data.pose_position = 'POSE'
    fl_grip = Vector(arm.get('n2_flash_grip', (0, 0, 0))); fl_axis = Vector(arm.get('n2_flash_axis', (0, 1, 0)))
    cam, sun = setup(scene)
    proxy = flashlight_proxy(scene)
    acts = {a.name: a for a in bpy.data.actions}
    fj = ARGS['frames_json']
    chosen = json.load(open(fj)) if fj and os.path.exists(fj) else {}
    outdir = ARGS['outdir'] if os.path.isabs(ARGS['outdir']) else os.path.join(ROOT, ARGS['outdir'])
    os.makedirs(outdir, exist_ok=True)
    shots = [s for s in ARGS['shots'].split(';') if s]
    for i, shot in enumerate(shots):
        name, _, spec = shot.partition(':')
        act = acts[name]
        f = chosen.get(shot) or pick_frame(arm, act, spec, hp)
        chosen[shot] = f
        mm.set_action(arm, act, f)
        st = mm.hammer_frame_state(arm, hp['Right'], hp['Left'])
        pl = arm.matrix_world @ arm.pose.bones['mixamorig:LeftHand'].matrix
        g = pl @ fl_grip; ax = (pl.to_3x3().normalized() @ fl_axis).normalized()
        rot = ax.to_track_quat('Z', 'Y').to_matrix().to_4x4()
        for o in proxy:
            o.matrix_world = Matrix.Translation(g + ax * (0.06 + o['zc'])) @ rot
        R, F = st['R'], st['F']
        az = math.radians(AZ[ARGS['view']])
        dirv = (F * math.cos(az) + R * math.sin(az)).normalized()
        tgt = Vector((st['mid'].x, st['mid'].y, 0.92))
        pos = tgt + dirv * 3.0 + Vector((0, 0, 0.10))
        fwd = (tgt - pos).normalized()
        zc = -fwd; xc = Vector((0, 0, 1)).cross(zc).normalized(); yc = zc.cross(xc)
        cam.matrix_world = Matrix((xc, yc, zc)).transposed().to_4x4(); cam.location = pos
        ld = (dirv + Vector((0, 0, 1.2)) - R * 0.5).normalized()
        sun.matrix_world = (-ld).to_track_quat('-Z', 'Y').to_matrix().to_4x4()
        m = mm.hammer_metrics(st)
        out = os.path.join(outdir, f'{ARGS["prefix"]}_{i:02d}_{name}@{f}.png')
        scene.render.filepath = out
        bpy.ops.render.render(write_still=True)
        log(f'{shot} → frame {f}: head_lat {m["head_lat"]:+.3f} left_gap {m["left_gap"]:.3f} sup {m["sup"]:+.0f} dev {m["dev"]:+.0f} '
            f'd(右,前,上) {tuple(round(v, 2) for v in m["d_body"])} → {os.path.basename(out)}')
    if fj:
        json.dump(chosen, open(fj, 'w'), indent=1)


main()
