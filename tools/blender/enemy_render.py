# enemy_render.py — 管理人候補を Cycles でレンダする(1体1枚)。
#
#   portrait : 候補の .blend を開いて、中立照明(グレー背景・ソフトボックス3灯)でバストアップ 1200×1600
#     Blender -b build/enemy/NN_xxx.blend -P tools/blender/enemy_render.py -- --mode portrait --out docs/enemy-candidates/NN_portrait.jpg
#   insitu   : P0b の廊下(build/p0_baked.blend)に候補を追加読み込みし、常夜灯＋低い位置の懐中電灯で全身 1920×1080
#     Blender -b build/p0_baked.blend -P tools/blender/enemy_render.py -- --mode insitu --enemy build/enemy/NN_xxx.blend --out ...
#   sheet    : portrait を横に並べた一覧 --inputs a.jpg,b.jpg,... --out docs/enemy-candidates/00_overview.jpg
#   共通: [--samples N] [--device GPU|CPU] [--exposure EV]
# 6体とも同じカメラ・同じ照明(このファイルの定数)で撮る。JPEG は 2MB 以下になるまで品質を下げる。

import bpy, math, os, sys, time
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
from n2common import parse_args, log  # noqa: E402

ARGS = parse_args({'inputs': '', 'debug_lights': False, 'side': False, 'mode': 'portrait', 'out': '', 'enemy': '', 'samples': '', 'device': 'GPU', 'exposure': ''})
MODE = ARGS['mode']

# --- 廊下(P0b)での立ち位置とカメラ。Blender 座標 = (x, -z, y)(build_scene.py と同じ)。床 z=8.7 ---
FLOOR_Z = 8.7
ENEMY_XY = (6.92, -13.25)          # 常夜灯 NightLight_0 (y=-12.8) のすぐ奥。顔に斜め上から常夜灯が落ちる
CAM_XY = (6.80, -10.05)            # 3.2m 手前。目線 1.62m(player.js PLAYER.height)
EYE_H = 1.62
GAME_VFOV = 68.0                   # main.js の PerspectiveCamera(68)
INSITU_EXPOSURE = 0.9
PORTRAIT_EXPOSURE = 0.35


def setup_cycles(scene, samples):
    scene.render.engine = 'CYCLES'
    dev = 'CPU'
    if ARGS['device'] == 'GPU':
        try:
            prefs = bpy.context.preferences.addons['cycles'].preferences
            prefs.compute_device_type = 'METAL'
            prefs.get_devices()
            n = 0
            for d in prefs.devices:
                d.use = (d.type == 'METAL'); n += d.use
            if n:
                scene.cycles.device = 'GPU'; dev = 'GPU-METAL'
        except Exception as e:  # noqa: BLE001
            log(f'GPU 設定失敗 → CPU: {e}')
    if dev == 'CPU':
        scene.cycles.device = 'CPU'
    c = scene.cycles
    c.samples = samples
    c.use_adaptive_sampling = True
    c.adaptive_threshold = 0.01
    c.use_denoising = True
    c.denoiser = 'OPENIMAGEDENOISE'
    c.max_bounces = 12
    c.diffuse_bounces = 4
    c.glossy_bounces = 3
    c.transmission_bounces = 4
    c.transparent_max_bounces = 32          # 髪・眉・まつ毛のアルファカード
    c.sample_clamp_indirect = 6.0
    c.caustics_reflective = False
    c.caustics_refractive = False
    scene.view_settings.view_transform = 'AgX'
    try:
        scene.view_settings.look = 'AgX - Medium Contrast'
    except Exception:  # noqa: BLE001
        pass
    scene.render.image_settings.file_format = 'PNG'
    return dev


def enemy_root(scene):
    rigs = [o for o in scene.objects if o.type == 'ARMATURE' and 'n2_candidate' in o]
    assert rigs, '候補のリグが見つからない'
    return rigs[0]


def body_of(rig):
    return next(o for o in rig.children if o.name.endswith('.body'))


def world_bbox(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    mn = Vector((1e9, 1e9, 1e9)); mx = -mn
    for o in objs:
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        for v in me.vertices:
            p = o.matrix_world @ v.co
            mn = Vector(map(min, mn, p)); mx = Vector(map(max, mx, p))
        ev.to_mesh_clear()
    return mn, mx


def head_point(rig):
    pb = rig.pose.bones['head']
    return rig.matrix_world @ pb.head, rig.matrix_world @ pb.tail


def look_at(obj, target):
    d = (Vector(target) - obj.location).normalized()
    obj.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def add_area(scene, name, loc, target, size, power, color=(1, 1, 1), size_y=None):
    ld = bpy.data.lights.new(name, 'AREA')
    ld.energy = power; ld.color = color
    if size_y:
        ld.shape = 'RECTANGLE'; ld.size = size; ld.size_y = size_y
    else:
        ld.size = size
    o = bpy.data.objects.new(name, ld); scene.collection.objects.link(o)
    o.location = loc; look_at(o, target)
    return o


def save_jpeg(scene, out):
    """PNG で描いてから JPEG に。2MB を超えたら品質を下げる。"""
    tmp = out[:-4] + '_tmp.png'
    scene.render.filepath = tmp
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    secs = time.time() - t0
    img = bpy.data.images.load(tmp)
    q = 92
    while True:
        scene.render.image_settings.file_format = 'JPEG'
        scene.render.image_settings.quality = q
        img.save_render(out, scene=scene)
        sz = os.path.getsize(out)
        if sz <= 1_950_000 or q <= 60:
            break
        q -= 6
    os.remove(tmp)
    log(f'saved {out} ({sz / 1e6:.2f} MB q={q}) render {secs:.1f}s')
    return secs


# ---------------------------------------------------------------------------
def portrait():
    scene = bpy.context.scene
    setup_cycles(scene, int(ARGS['samples'] or 256))
    scene.render.resolution_x, scene.render.resolution_y = 1200, 1600
    scene.render.resolution_percentage = 100
    scene.view_settings.exposure = float(ARGS['exposure'] or PORTRAIT_EXPOSURE)
    rig = enemy_root(scene)
    meshes = [o for o in rig.children if o.type == 'MESH']
    mn, mx = world_bbox([o for o in meshes])
    h0, h1 = head_point(rig)
    top = mx.z
    # 頭頂の少し上〜胸の中ほどまで(0.62m)を縦に収める
    frame_h = 0.62
    cz = top + 0.06 - frame_h / 2
    cam = bpy.data.objects.new('N2_Cam', bpy.data.cameras.new('N2_Cam'))
    scene.collection.objects.link(cam); scene.camera = cam
    cam.data.lens = 85; cam.data.sensor_fit = 'VERTICAL'; cam.data.sensor_height = 24
    vfov = 2 * math.atan(12 / 85)
    dist = frame_h / 2 / math.tan(vfov / 2)
    face_y = mn.y   # 体の前面
    cam.location = (h0.x, h0.y - dist - 0.05, cz + 0.02)
    if ARGS.get('side'):   # 調整用: 真横(キャラの右側)から全身
        cam.location = (h0.x - 6.0, h0.y, 0.95); cam.data.lens = 50
        look_at(cam, (h0.x, h0.y, 0.95))
    else:
        look_at(cam, (h0.x, h0.y, cz))
    # 背景: 無地の中間グレー(曲面ホリ)
    bpy.ops.mesh.primitive_plane_add(size=8, location=(h0.x, h0.y + 1.2, cz))
    bg = bpy.context.object; bg.rotation_euler = (math.radians(90), 0, 0)
    mat = bpy.data.materials.new('N2_Backdrop')
    b = mat.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.09, 0.09, 0.09, 1); b.inputs['Roughness'].default_value = 0.9
    bg.data.materials.append(mat)
    w = bpy.data.worlds.new('N2_PortraitWorld'); scene.world = w
    w.color = (0.02, 0.02, 0.02)
    if w.node_tree:
        w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.02, 0.02, 0.02, 1)
    face = Vector((h0.x, h0.y - 0.08, h0.z + 0.06))
    # キー(左前上・ソフトボックス)/フィル(右前・弱)/リム(後ろ上)
    add_area(scene, 'N2_Key', face + Vector((-1.1, -1.4, 0.75)), face, 1.2, 60, (1.0, 1.0, 1.0))
    add_area(scene, 'N2_Fill', face + Vector((1.4, -1.2, 0.1)), face, 1.6, 14, (0.93, 0.96, 1.0))
    add_area(scene, 'N2_Rim', face + Vector((0.6, 1.2, 0.9)), face, 0.8, 35, (1.0, 1.0, 1.0))
    return scene


def insitu():
    scene = bpy.context.scene
    setup_cycles(scene, int(ARGS['samples'] or 512))
    scene.render.resolution_x, scene.render.resolution_y = 1920, 1080
    scene.render.resolution_percentage = 100
    scene.view_settings.exposure = float(ARGS['exposure'] or INSITU_EXPOSURE)
    path = os.path.join(ROOT, ARGS['enemy'])
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.objects = list(src.objects)
    col = bpy.data.collections.new('N2_Enemy'); scene.collection.children.link(col)
    for o in dst.objects:
        if o is not None and o.type in ('ARMATURE', 'MESH'):
            col.objects.link(o)
    rig = enemy_root(scene)
    rig.location = (ENEMY_XY[0], ENEMY_XY[1], FLOOR_Z)
    rig.rotation_euler = (0, 0, math.radians(180))   # MPFB の正面(-Y)をカメラ(+Y 側)へ
    bpy.context.view_layer.update()
    cam = bpy.data.objects.new('N2_Cam', bpy.data.cameras.new('N2_Cam'))
    scene.collection.objects.link(cam); scene.camera = cam
    cam.data.sensor_fit = 'VERTICAL'; cam.data.sensor_height = 24
    cam.data.lens = 12 / math.tan(math.radians(GAME_VFOV) / 2)
    cam.data.clip_start = 0.05
    cam.location = (CAM_XY[0], CAM_XY[1], FLOOR_Z + EYE_H)
    look_at(cam, (ENEMY_XY[0], ENEMY_XY[1], FLOOR_Z + 1.25))
    # 懐中電灯: 腰の高さ(床から約1.05m)の右手に下げて持ち、敵の胸へ向ける = DESIGN §3.4「下からの照らし」
    bpy.context.view_layer.update()   # matrix_world を確定させてから手元の位置を出す
    fl_loc = cam.matrix_world @ Vector((0.16, -0.55, -0.15))
    target = Vector((ENEMY_XY[0], ENEMY_XY[1], FLOOR_Z + 1.15))
    for name, size, blend, power in (('N2_Flash_Wide', 82, 0.45, 3.0), ('N2_Flash_Core', 22, 0.6, 12.0)):
        ld = bpy.data.lights.new(name, 'SPOT')
        ld.energy = power; ld.color = (1.0, 0.93, 0.87)
        ld.spot_size = math.radians(size); ld.spot_blend = blend
        ld.shadow_soft_size = 0.012
        o = bpy.data.objects.new(name, ld); scene.collection.objects.link(o)
        o.location = fl_loc; look_at(o, target)
    return scene


def sheet():
    """候補の portrait を横に並べた一覧(番号は README の表と同じ並び)。"""
    import numpy as np
    files = ARGS['inputs'].split(',')
    tiles = []
    for f in files:
        im = bpy.data.images.load(os.path.join(ROOT, f))
        im.scale(im.size[0] // 3, im.size[1] // 3)
        a = np.empty(im.size[0] * im.size[1] * 4, np.float32); im.pixels.foreach_get(a)
        tiles.append(a.reshape(im.size[1], im.size[0], 4))
    h, w = tiles[0].shape[:2]
    gap = 8
    canvas = np.zeros((h, len(tiles) * w + (len(tiles) - 1) * gap, 4), np.float32); canvas[..., 3] = 1
    for i, t in enumerate(tiles):
        canvas[:, i * (w + gap): i * (w + gap) + w] = t
    out = bpy.data.images.new('N2_Sheet', canvas.shape[1], canvas.shape[0])
    out.pixels.foreach_set(canvas.ravel())
    path = os.path.join(ROOT, ARGS['out'])
    out.filepath_raw = path; out.file_format = 'JPEG'
    bpy.context.scene.render.image_settings.quality = 88
    out.save()
    log(f'saved {path} ({os.path.getsize(path) / 1e6:.2f} MB)')


def main():
    if MODE == 'sheet':
        return sheet()
    out = os.path.join(ROOT, ARGS['out'])
    os.makedirs(os.path.dirname(out), exist_ok=True)
    scene = portrait() if MODE == 'portrait' else insitu()
    if ARGS.get('debug_lights'):
        for o in scene.objects:
            if o.type == 'LIGHT': print('LIGHT', o.name, o.data.type, o.data.energy, tuple(round(v, 2) for v in o.matrix_world.translation), o.hide_render)
        return
    save_jpeg(scene, out)


if __name__ == '__main__':
    main()
