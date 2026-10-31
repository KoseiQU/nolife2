# enemy_render.py — 管理人候補を Cycles でレンダする(1体1枚)。
#
#   portrait : 候補の .blend を開いて、中立照明(グレー背景・ソフトボックス3灯)でバストアップ 1200×1600
#     Blender -b build/enemy/NN_xxx.blend -P tools/blender/enemy_render.py -- --mode portrait --out docs/enemy-candidates/NN_portrait.jpg
#   insitu   : P0b の廊下(build/p0_baked.blend)に候補を追加読み込みし、常夜灯＋低い位置の懐中電灯で全身 1920×1080
#     Blender -b build/p0_baked.blend -P tools/blender/enemy_render.py -- --mode insitu --enemy build/enemy/NN_xxx.blend --out ...
#   peephole : insitu と同じ廊下で、顔の 0.6m 手前(覗き穴の高さ 1.50m)から見上げる顔アップ。光は腰の高さから
#   threequarter: 全身を斜め45°から、中立照明(グレーのホリ)
#   sheet    : portrait を横に並べた一覧 --inputs a.jpg,b.jpg,... --out docs/enemy-candidates/00_overview.jpg
#   compare  : 前後比較 --inputs 前の廊下,後の廊下,前の顔,後の顔 --out .../compare_before_after.jpg
#   共通: [--samples N] [--device GPU|CPU] [--exposure EV]
# 6体とも同じカメラ・同じ照明(このファイルの定数)で撮る。JPEG は 2MB 以下になるまで品質を下げる。

import bpy, math, os, sys, time
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
from n2common import parse_args, log  # noqa: E402

ARGS = parse_args({'far': False, 'labels': '', 'face': False, 'grin': False, 'strips': False, 'orbit': '', 'inputs': '', 'debug_lights': False, 'side': False, 'mode': 'portrait', 'out': '', 'enemy': '', 'samples': '', 'device': 'GPU', 'exposure': ''})
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
    elif ARGS.get('face'):   # 調整用: 顔の正面 0.5m(目と口が入る)
        e = (rig.matrix_world @ rig.pose.bones['eye.L'].head + rig.matrix_world @ rig.pose.bones['eye.R'].head) / 2
        fc = e + Vector((0, -0.02, -0.035))
        cam.location = fc + Vector((0.0, -0.5, 0.0))
        look_at(cam, fc)
    elif ARGS.get('orbit'):   # 調整用: 頭のまわりを回って寄る(度。90=キャラの左)
        a = math.radians(float(ARGS['orbit']))
        hc = Vector((h0.x, h0.y, (h0.z + h1.z) / 2))
        cam.location = hc + Vector((math.sin(a), -math.cos(a), 0.05)) * 0.9
        look_at(cam, hc)
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


def threequarter():
    """全身・斜め45°(キャラの左前)・中立照明。服の皺と帽子の形の確認用(1200×1600)。"""
    scene = bpy.context.scene
    setup_cycles(scene, int(ARGS['samples'] or 256))
    scene.render.resolution_x, scene.render.resolution_y = 1200, 1600
    scene.view_settings.exposure = float(ARGS['exposure'] or PORTRAIT_EXPOSURE)
    rig = enemy_root(scene)
    mn, mx = world_bbox([o for o in rig.children if o.type == 'MESH' and not o.hide_render])
    c = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mx.z / 2 + 0.02))
    cam = bpy.data.objects.new('N2_Cam', bpy.data.cameras.new('N2_Cam'))
    scene.collection.objects.link(cam); scene.camera = cam
    cam.data.lens = 50; cam.data.sensor_fit = 'VERTICAL'; cam.data.sensor_height = 24
    dist = (mx.z * 1.12) / 2 / math.tan(math.atan(12 / 50))
    d = Vector((math.sin(math.radians(45)), -math.cos(math.radians(45)), 0))
    cam.location = c + d * dist + Vector((0, 0, 0.15))
    look_at(cam, c)
    bpy.ops.mesh.primitive_plane_add(size=30, location=(c.x, c.y, 0))
    fl = bpy.context.object
    bpy.ops.mesh.primitive_plane_add(size=30, location=(c.x - d.x * 3, c.y - d.y * 3, 5))
    bg = bpy.context.object; bg.rotation_euler = (math.radians(90), 0, math.radians(45))
    mat = bpy.data.materials.new('N2_Backdrop')
    b = mat.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.09, 0.09, 0.09, 1); b.inputs['Roughness'].default_value = 0.9
    fl.data.materials.append(mat); bg.data.materials.append(mat)
    w = bpy.data.worlds.new('N2_PortraitWorld'); scene.world = w
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.02, 0.02, 0.02, 1)
    add_area(scene, 'N2_Key', c + Vector((-2.2, -3.2, 2.2)), c + Vector((0, 0, 0.3)), 2.5, 240, (1.0, 1.0, 1.0))
    add_area(scene, 'N2_Fill', c + Vector((3.2, -2.0, 0.6)), c, 3.0, 60, (0.93, 0.96, 1.0))
    add_area(scene, 'N2_Rim', c + Vector((1.2, 2.8, 2.4)), c + Vector((0, 0, 0.4)), 1.6, 140, (1.0, 1.0, 1.0))
    return scene


def insitu(peephole=False):
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
        if o is not None and o.type in ('ARMATURE', 'MESH', 'CURVES'):
            col.objects.link(o)
    rig = enemy_root(scene)
    ey = CAM_XY[1] - 8.0 if ARGS.get('far') else ENEMY_XY[1]      # --far: 8m 先(遠目のシルエット確認)
    rig.location = (ENEMY_XY[0], ey, FLOOR_Z)
    rig.rotation_euler = (0, 0, math.radians(180))   # MPFB の正面(-Y)をカメラ(+Y 側)へ
    bpy.context.view_layer.update()
    cam = bpy.data.objects.new('N2_Cam', bpy.data.cameras.new('N2_Cam'))
    scene.collection.objects.link(cam); scene.camera = cam
    cam.data.sensor_fit = 'VERTICAL'; cam.data.sensor_height = 24
    cam.data.lens = 12 / math.tan(math.radians(GAME_VFOV) / 2)
    cam.data.clip_start = 0.05
    cam.location = (CAM_XY[0], CAM_XY[1], FLOOR_Z + EYE_H)
    look_at(cam, (ENEMY_XY[0], ey, FLOOR_Z + 1.25))
    if peephole:
        # 覗き穴: 顔の 0.6m 手前、扉の覗き穴の高さ(1.50m)から見上げる。光は腰の高さ(1.0m)から上へ
        h0, h1 = head_point(rig)
        face = (h0 + h1) / 2 + Vector((0, 0.06, -0.02))
        cam.location = (face.x, face.y + 0.6, FLOOR_Z + 1.50)
        cam.data.lens = 12 / math.tan(math.radians(40) / 2)
        look_at(cam, face)
        bpy.context.view_layer.update()
        ld = bpy.data.lights.new('N2_Peep_Flash', 'SPOT')
        ld.energy = 3.0; ld.color = (1.0, 0.93, 0.87); ld.spot_size = math.radians(50); ld.spot_blend = 0.6
        ld.shadow_soft_size = 0.012
        o = bpy.data.objects.new('N2_Peep_Flash', ld); scene.collection.objects.link(o)
        o.location = (face.x + 0.10, face.y + 0.50, FLOOR_Z + 1.0)
        look_at(o, face)
        return scene
    # 懐中電灯: 腰の高さ(床から約1.05m)の右手に下げて持ち、敵の胸へ向ける = DESIGN §3.4「下からの照らし」
    bpy.context.view_layer.update()   # matrix_world を確定させてから手元の位置を出す
    fl_loc = cam.matrix_world @ Vector((0.16, -0.55, -0.15))
    target = Vector((ENEMY_XY[0], ey, FLOOR_Z + 1.15))
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


def text_tile(text, w, h, path):
    """見出し文字の画像(黒地に白)。Blender 同梱の Noto Sans CJK を Workbench で撮る。"""
    font_path = os.path.join(os.path.dirname(bpy.app.binary_path), '..', 'Resources',
                             f'{bpy.app.version[0]}.{bpy.app.version[1]}', 'datafiles', 'fonts', 'Noto Sans CJK Regular.woff2')
    sc = bpy.data.scenes.new('N2_Text')
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'FLAT'; sc.display.shading.color_type = 'MATERIAL'
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.view_settings.view_transform = 'Standard'
    sc.world = bpy.data.worlds.new('N2_TextWorld'); sc.world.color = (0, 0, 0)
    cam = bpy.data.objects.new('N2_TextCam', bpy.data.cameras.new('N2_TextCam'))
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = w / h
    cam.location = (0, 0, 5); sc.collection.objects.link(cam); sc.camera = cam
    cu = bpy.data.curves.new('N2_Txt', 'FONT'); cu.body = text
    cu.font = bpy.data.fonts.load(os.path.abspath(font_path), check_existing=True)
    cu.align_x = 'CENTER'; cu.align_y = 'CENTER'; cu.size = 0.55
    m = bpy.data.materials.new('N2_TxtMat'); m.diffuse_color = (0.9, 0.9, 0.9, 1)
    t = bpy.data.objects.new('N2_Txt', cu); t.data.materials.append(m); sc.collection.objects.link(t)
    sc.render.filepath = path; sc.render.image_settings.file_format = 'PNG'
    bpy.ops.render.render(scene=sc.name, write_still=True)
    bpy.data.scenes.remove(sc)
    im = bpy.data.images.load(path)
    import numpy as np
    a = np.empty(w * h * 4, np.float32); im.pixels.foreach_get(a)
    os.remove(path)
    return a.reshape(h, w, 4)


def compare():
    """前後比較(左=P1 の 02 廊下 / 04 顔、右=P1b の 07 同条件)。--inputs a_insitu,b_insitu,a_portrait,b_portrait"""
    import numpy as np
    f = [os.path.join(ROOT, x) for x in ARGS['inputs'].split(',')]
    W, H = 1920, 1180
    canvas = np.zeros((H, W, 4), np.float32); canvas[..., 3] = 1
    def load(path, w, h):
        im = bpy.data.images.load(path); im.scale(w, h)
        a = np.empty(w * h * 4, np.float32); im.pixels.foreach_get(a)
        return a.reshape(h, w, 4)
    # 画像の行は下から。下段=顔(高さ 540)、上段=廊下(960×540)、最上段=見出し(100)
    top_y = 540
    canvas[top_y:top_y + 540, 0:956] = load(f[0], 956, 540)
    canvas[top_y:top_y + 540, 964:1920] = load(f[1], 956, 540)
    pw = 405
    canvas[0:540, 478 - pw // 2:478 - pw // 2 + pw] = load(f[2], pw, 540)
    canvas[0:540, 1442 - pw // 2:1442 - pw // 2 + pw] = load(f[3], pw, 540)
    tmp = os.path.join(ROOT, 'build', '_cmp_label.png')
    la, lb = (ARGS['labels'] or '前（P1: 02 の服 / 04 の顔）|後（P1b: 07 確定像）').split('|')
    canvas[1080:1180, 0:956] = text_tile(la, 956, 100, tmp)
    canvas[1080:1180, 964:1920] = text_tile(lb, 956, 100, tmp)
    out = bpy.data.images.new('N2_Cmp', W, H)
    out.pixels.foreach_set(canvas.ravel())
    path = os.path.join(ROOT, ARGS['out'])
    out.filepath_raw = path; out.file_format = 'JPEG'
    bpy.context.scene.render.image_settings.quality = 90
    out.save()
    log(f'saved {path} ({os.path.getsize(path) / 1e6:.2f} MB)')


def apply_grin(scene):
    """笑い顔: 体・眉/まつ毛の帯の grin を 1 に、ヘアカーブ(眉・まつ毛)は記録した移動量を足す。"""
    import numpy as np
    for o in scene.objects:
        if o.type == 'MESH' and o.data.shape_keys and 'grin' in o.data.shape_keys.key_blocks:
            o.data.shape_keys.key_blocks['grin'].value = 1.0
        if o.type == 'CURVES' and 'n2_grin' in o.data.attributes:
            n = len(o.data.points)
            p = np.empty(n * 3, np.float32); d = np.empty(n * 3, np.float32)
            o.data.attributes['position'].data.foreach_get('vector', p)
            o.data.attributes['n2_grin'].data.foreach_get('vector', d)
            o.data.attributes['position'].data.foreach_set('vector', p + d)


def show_export_hair(scene):
    """確認用: ヘアカーブを隠し、書き出し用の帯メッシュ(髪・眉・まつ毛)で描く = ゲームでの見え方。"""
    for o in scene.objects:
        if o.type == 'CURVES':
            o.hide_render = True
        if o.get('n2_export_only'):
            o.hide_render = False


def main():
    if MODE == 'sheet':
        return sheet()
    if MODE == 'compare':
        return compare()
    out = os.path.join(ROOT, ARGS['out'])
    os.makedirs(os.path.dirname(out), exist_ok=True)
    scene = {'portrait': portrait, 'insitu': insitu, 'peephole': lambda: insitu(True),
             'threequarter': threequarter}[MODE]()
    if ARGS.get('strips'):
        show_export_hair(scene)
    if ARGS.get('grin'):
        apply_grin(scene)
    if ARGS.get('debug_lights'):
        for o in scene.objects:
            if o.type == 'LIGHT': print('LIGHT', o.name, o.data.type, o.data.energy, tuple(round(v, 2) for v in o.matrix_world.translation), o.hide_render)
        return
    save_jpeg(scene, out)


if __name__ == '__main__':
    main()
