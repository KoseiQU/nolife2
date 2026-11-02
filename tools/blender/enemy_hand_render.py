# enemy_hand_render.py — 管理人の手元のアップを一覧 1 枚に描く(P5b-5「手の形」の目視監査用)。
#
#   Blender -b build/enemy/07_rigged.blend --factory-startup -P tools/blender/enemy_hand_render.py -- \
#     --hand Right|Left [--shots "rest;look_idle:mid;walk_standard:mid;door_open_in:0.6;attack_downward:peak_hand"] \
#     [--views palm,back,front,side] [--tile 360] [--samples 24] [--live] [--before] --out docs/p5b5-screens/hand_right.jpg
#
#   行=shots(アクション:フレーム。mid=中間、0〜1 の小数=長さの割合、peak_hand=右手が最も高い瞬間、整数=フレーム番号、
#        rest=アニメなし(A ポーズの腕に指の固定ポーズだけ))、列=views(palm=掌側・back=甲側・front=指先側・side=人差し指側)。
#   カメラは手の骨に追従する正射影(幅 26cm)。手より手前の体はクリップで切る。右手にはゲームと同じ向きのハンマー、
#   左手には enemy.js と同じ寸法の懐中電灯の代役(握りの点で本体を握る。ゲームでは向きだけ進行方向に合わせる)。
#   --live  : mixamo_merge.py の HAND_POSE をその場で計算して焼き直す(角度の調整用。.blend は保存しない)
#   --before: 指の固定ポーズを使わず Mixamo のまま(修正前の比較用。--live と併用しない)

import bpy, math, os, sys, time
import numpy as np
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
from n2common import parse_args, log  # noqa: E402

ARGS = parse_args({'hand': 'Right', 'shots': 'rest;look_idle:mid;walk_standard:mid;door_open_in:0.6;attack_downward:peak_hand',
                   'views': 'palm,back,front,side', 'tile': '360', 'samples': '24', 'live': False, 'before': False, 'out': ''})
import mixamo_merge as mm  # noqa: E402  (ARGS は mm 側でも読まれるが既定値のまま)

SIDE = ARGS['hand']
TILE = int(ARGS['tile'])
D = 0.6                     # カメラ距離
SCALE = 0.26                # 正射影の幅(m)


def setup(scene):
    scene.render.engine = 'CYCLES'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'; prefs.get_devices()
        for d in prefs.devices:
            d.use = (d.type == 'METAL')
        scene.cycles.device = 'GPU'
    except Exception as e:  # noqa: BLE001
        log(f'GPU 設定失敗 → CPU: {e}')
    c = scene.cycles
    c.samples = int(ARGS['samples']); c.use_denoising = True; c.denoiser = 'OPENIMAGEDENOISE'
    c.max_bounces = 6; c.transparent_max_bounces = 24
    scene.view_settings.view_transform = 'AgX'
    scene.render.resolution_x = scene.render.resolution_y = TILE
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = 'PNG'
    w = bpy.data.worlds.new('N2_hand_world'); scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (0.32, 0.33, 0.35, 1); bg.inputs['Strength'].default_value = 0.9
    cam = bpy.data.objects.new('N2_hand_cam', bpy.data.cameras.new('N2_hand_cam'))
    scene.collection.objects.link(cam); scene.camera = cam
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = SCALE
    cam.data.clip_start = D - 0.14; cam.data.clip_end = D + 0.4
    sun = bpy.data.objects.new('N2_hand_sun', bpy.data.lights.new('N2_hand_sun', 'SUN'))
    sun.data.energy = 3.0; sun.data.angle = math.radians(25)
    scene.collection.objects.link(sun)
    return cam, sun


def flashlight_proxy(scene):
    mat = bpy.data.materials.new('N2_flash_proxy'); mat.use_nodes = True
    b = mat.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (0.03, 0.03, 0.035, 1); b.inputs['Metallic'].default_value = 0.85
    b.inputs['Roughness'].default_value = 0.42
    objs = []
    for name, r1, r2, ln, zc in (('body', 0.016, 0.016, 0.15, -0.04), ('head', 0.024, 0.018, 0.045, 0.055)):
        me = bpy.data.meshes.new('N2_flash_' + name)
        import bmesh
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=20, radius1=r2, radius2=r1, depth=ln)   # -Z 側 r2・+Z 側 r1
        bm.to_mesh(me); bm.free()
        o = bpy.data.objects.new('N2_flash_' + name, me); o.data.materials.append(mat)
        o['zc'] = zc
        scene.collection.objects.link(o); objs.append(o)
    return objs


def set_action(arm, act, frame):
    arm.animation_data.action = act
    if act is not None and hasattr(arm.animation_data, 'action_slot') and getattr(act, 'slots', None) and len(act.slots):
        arm.animation_data.action_slot = act.slots[0]
    bpy.context.scene.frame_set(int(frame))
    bpy.context.view_layer.update()


def pick_frame(arm, act, spec):
    f0, f1 = int(act.frame_range[0]), int(act.frame_range[1])
    if spec in ('', 'mid'):
        return (f0 + f1) // 2
    if spec == 'peak_hand':
        best, f = -1e9, f0
        for k in range(f0, f1 + 1):
            set_action(arm, act, k)
            z = (arm.matrix_world @ arm.pose.bones['mixamorig:RightHand'].head).z
            if z > best:
                best, f = z, k
        return f
    if '.' in spec:
        return int(round(f0 + (f1 - f0) * float(spec)))
    return int(spec)


def main():
    scene = bpy.context.scene
    arm = next(o for o in scene.objects if o.type == 'ARMATURE' and 'n2_candidate' in o)
    hammer = bpy.data.objects.get('N2E_hammer')
    arm.data.pose_position = 'POSE'
    hp = {sd: mm.hand_pose(arm, sd, mm.HAND_POSE[sd]) for sd in ('Right', 'Left')}
    acts = {a.name: a for a in bpy.data.actions}
    if ARGS['live']:
        for sd in hp:
            mm.bake_hand_pose(arm, list(acts.values()), hp[sd]['pose'])
        if hammer is not None:
            _, off = mm.hammer_matrix(arm, arm.matrix_world @ hp['Right']['grip'])
            hammer.matrix_parent_inverse = Matrix.Identity(4); hammer.matrix_basis = off
        lrest = arm.data.bones['mixamorig:LeftHand'].matrix_local
        fl_grip = lrest.inverted() @ hp['Left']['grip']
        fl_axis = (lrest.to_3x3().inverted() @ hp['Left']['axis']).normalized()
        for sd in hp:
            log(f'{sd}: 角度 {hp[sd]["angles"]} 軸からの距離 cm {hp[sd]["radius"]} 隣の指 cm {hp[sd]["gaps"]}')
    else:
        fl_grip = Vector(arm.get('n2_flash_grip', (0, 0, 0))); fl_axis = Vector(arm.get('n2_flash_axis', (0, 1, 0)))
    cam, sun = setup(scene)
    proxy = flashlight_proxy(scene) if SIDE == 'Left' and not ARGS['before'] else []
    views = ARGS['views'].split(',')
    shots = [s for s in ARGS['shots'].split(';') if s]
    out = ARGS['out'] if os.path.isabs(ARGS['out']) else os.path.join(ROOT, ARGS['out'])
    os.makedirs(os.path.dirname(out), exist_ok=True)
    tmp = out[:-4] + '_tile.png'
    sheet = np.zeros((TILE * len(shots), TILE * len(views), 4), np.float32)
    bones = arm.data.bones
    nm = lambda s: f'mixamorig:{SIDE}{s}'   # noqa: E731
    x, y, n = hp[SIDE]['frame']
    Hr = bones[nm('Hand')].matrix_local
    center_rest = bones[nm('Hand')].head_local.lerp(hp[SIDE]['grip'], 0.55)
    t0 = time.time()
    for r, shot in enumerate(shots):
        name, _, fspec = shot.partition(':')
        if name == 'rest':
            set_action(arm, None, 1)
            for pb in arm.pose.bones:
                pb.rotation_mode = 'QUATERNION'; pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
            if not ARGS['before']:
                for sd in hp:
                    for bn, q in hp[sd]['pose'].items():
                        arm.pose.bones[bn].rotation_quaternion = q
            bpy.context.view_layer.update()
            label = 'rest'
        else:
            act = acts[name]
            f = pick_frame(arm, act, fspec)
            set_action(arm, act, f)
            label = f'{name}@{f}'
        pb = arm.pose.bones[nm('Hand')]
        T = arm.matrix_world @ pb.matrix @ Hr.inverted()          # レスト → 今のポーズ(アーマチュア空間 → ワールド)
        R3 = T.to_3x3().normalized()
        c = T @ center_rest
        xw, yw, nw = (R3 @ x).normalized(), (R3 @ y).normalized(), (R3 @ n).normalized()
        if proxy:
            pl = arm.matrix_world @ arm.pose.bones['mixamorig:LeftHand'].matrix
            g = pl @ fl_grip; ax = (pl.to_3x3().normalized() @ fl_axis).normalized()
            rot = ax.to_track_quat('Z', 'Y').to_matrix().to_4x4()
            for o in proxy:
                o.matrix_world = Matrix.Translation(g + ax * (0.06 + o['zc'])) @ rot
        for k, v in enumerate(views):
            fwd, up = {'palm': (-nw, yw), 'back': (nw, yw), 'front': (-yw, nw), 'side': (-xw, yw)}[v]
            cam.matrix_world = (Matrix.Translation(c - fwd * D) @ fwd.to_track_quat('-Z', 'Y').to_matrix().to_4x4())
            # up を合わせる(to_track_quat の up 軸は世界基準なので、手の軸に合わせ直す)
            zc = -fwd; xc = up.cross(zc).normalized(); yc = zc.cross(xc)
            cam.matrix_world = Matrix((xc, yc, zc)).transposed().to_4x4(); cam.location = c - fwd * D
            ld = (fwd + up * 0.6 + xc * 0.4).normalized()
            sun.matrix_world = ld.to_track_quat('-Z', 'Y').to_matrix().to_4x4()
            scene.render.filepath = tmp
            bpy.ops.render.render(write_still=True)
            img = bpy.data.images.load(tmp, check_existing=False)
            px = np.array(img.pixels[:], np.float32).reshape(TILE, TILE, 4)
            bpy.data.images.remove(img)
            row = len(shots) - 1 - r                            # pixels は下から
            sheet[row * TILE:(row + 1) * TILE, k * TILE:(k + 1) * TILE] = px
        log(f'{label}: {len(views)} 枚')
    # 区切り線
    for r in range(1, len(shots)):
        sheet[r * TILE - 1:r * TILE + 1, :, :3] = 0.08
    for k in range(1, len(views)):
        sheet[:, k * TILE - 1:k * TILE + 1, :3] = 0.08
    im = bpy.data.images.new('N2_sheet', TILE * len(views), TILE * len(shots), alpha=False)
    im.pixels = sheet.ravel()
    im.filepath_raw = out; im.file_format = 'JPEG'
    try:
        im.save(quality=88)          # 生の値のまま(タイルは表示変換済みなので save_render で二重に掛けない)
    except TypeError:
        im.save()
    os.remove(tmp)
    log(f'saved {out} ({os.path.getsize(out) / 1e6:.2f} MB) {time.time() - t0:.0f}s 行={shots} 列={views}')


main()
