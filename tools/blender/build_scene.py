# build_scene.py — building.json から P0 区間(4F 縦廊下)を生成して .blend に保存する。
#
# 実行: Blender -b --factory-startup -P tools/blender/build_scene.py -- [--out build/p0_scene.blend]
#
# 座標: building.json は x=東, z=南, y=上(three.js と同じ)。Blender は Z-up なので
#   Blender(bx, by, bz) = (x, -z, y) で置き、glTF 書き出し(+Y up)で (x, y, z) に戻る。
# 壁は data/building.json → walls.js と同じ規則(本ファイルの floor_wall_boxes が Python 移植)で作り、
#   src/p0_region.json の「空気領域(air)」に接する箱だけを選んで切り詰める。衝突は JS 側が
#   同じ walls.js から作るので、見た目と当たりのズレは tools/check_glb.mjs が数値で検査する。
# UV: 第1UV "UVMap" = 実寸(m)/素材の実寸 の平面投影(タイル)。第2UV "Lightmap" = 全メッシュ共通の
#   ライトマップアトラス(smart_project で一括展開＝テクセル密度が全体で揃う)。

import bpy, bmesh, json, math, os, sys
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
from n2common import parse_args, log  # noqa: E402
import p0b_ev  # noqa: E402
import n2tex  # noqa: E402

ARGS = parse_args({'out': 'build/p0_scene.blend'})
BUILDING = json.load(open(os.path.join(ROOT, 'data', 'building.json')))
REGION = json.load(open(os.path.join(ROOT, 'src', 'p0_region.json')))

GEO = BUILDING['meta']['geom']
FLOOR_H = GEO['floorH']        # 2.9
CEIL_H = GEO['ceilH']          # 2.4
WALL_T = 0.12                  # walls.js GEOM.WALL_T
DOOR_W = 0.9                   # walls.js GEOM.DOOR_W
DOOR_H = 2.0                   # 前作 level.js DOOR_H(扉板の高さ)
HEAD_H = 0.04                  # 扉枠の上枠
JAMB = 0.035                   # 扉枠の縦枠(壁厚の内側を覆う)
SILL_H = 0.015                 # 沓摺り
LEAF_T = 0.04                  # 扉板の厚み
EV_ALCOVE_W = 1.0              # walls.js GEOM.EV_ALCOVE_W(EV扉のアルコーブ)
EV_ALCOVE_D = 0.27             # walls.js GEOM.EV_ALCOVE_D
EV_OPEN_SHIFT = 0.2            # walls.js GEOM.EV_OPEN_SHIFT(開口を正面から見て左へ)
LEVEL = REGION['level']
BASE_Y = (LEVEL - 1) * FLOOR_H  # 4F 床 = 8.7
FLOOR = next(f for f in BUILDING['floors'] if f['level'] == LEVEL)
NIGHT_LIGHT_SPACING = 6.5      # 前作 level.js と同じ間引き間隔
TEX_DIR = os.path.join(ROOT, 'assets', 'textures')


# ---------------------------------------------------------------------------
# walls.js の Python 移植(floorWallBoxes)。box = dict(cx, cz, w, d, kind[, roomId])
# ---------------------------------------------------------------------------
def cut_intervals(lo, hi, gaps):
    ivs = [(lo, hi)]
    for g in gaps:
        gl, gh = g[0] - g[1] / 2, g[0] + g[1] / 2
        nxt = []
        for a, b in ivs:
            if gh <= a or gl >= b:
                nxt.append((a, b)); continue
            if gl > a: nxt.append((a, gl))
            if gh < b: nxt.append((gh, b))
        ivs = nxt
    return [(a, b) for a, b in ivs if b - a > 0.02]

def h_wall(boxes, lo, hi, z, gaps, ext=0.0):
    for a, b in cut_intervals(lo, hi, gaps):
        boxes.append(dict(cx=(a + b) / 2, cz=z, w=b - a + 2 * ext, d=WALL_T, kind='wall'))

def v_wall(boxes, lo, hi, x, gaps, ext=0.0):
    for a, b in cut_intervals(lo, hi, gaps):
        boxes.append(dict(cx=x, cz=(a + b) / 2, w=WALL_T, d=b - a + 2 * ext, kind='wall'))

def side_gaps(room, side):
    gaps = []
    horiz = side in ('N', 'S')
    door = room.get('door')
    if door and door['facing'] == side:
        gaps.append((door['pos'][0] if horiz else door['pos'][1], DOOR_W))
    for o in room.get('openings', []):
        if o['side'] == side:
            gaps.append((o['pos'][0] if horiz else o['pos'][1], o.get('width', DOOR_W)))
    return gaps

def ev_opening_center(room):
    """walls.js evOpeningCenter の移植。"""
    px, pz = room['door']['pos']
    k = EV_OPEN_SHIFT
    return {'N': (px + k, pz), 'S': (px - k, pz), 'W': (px, pz - k)}.get(room['door']['facing'], (px, pz + k))


def elevator_blocks(room):
    """walls.js elevatorBlocks の移植: EV塊の扉面にアルコーブを掘る(奥 evBack + 左右 evSide)。"""
    x, z, w, d = room['rect']
    def box(x0, z0, x1, z1, part):
        return dict(cx=(x0 + x1) / 2, cz=(z0 + z1) / 2, w=x1 - x0, d=z1 - z0, kind='solid', part=part, roomId=room['id'])
    if not room.get('door'):
        return [box(x, z, x + w, z + d, 'evBack')]
    AW, AD = EV_ALCOVE_W, EV_ALCOVE_D
    px, pz = ev_opening_center(room)
    f = room['door']['facing']
    if f == 'N':
        return [box(x, z + AD, x + w, z + d, 'evBack'), box(x, z, px - AW / 2, z + AD, 'evSide'), box(px + AW / 2, z, x + w, z + AD, 'evSide')]
    if f == 'S':
        return [box(x, z, x + w, z + d - AD, 'evBack'), box(x, z + d - AD, px - AW / 2, z + d, 'evSide'), box(px + AW / 2, z + d - AD, x + w, z + d, 'evSide')]
    if f == 'W':
        return [box(x + AD, z, x + w, z + d, 'evBack'), box(x, z, x + AD, pz - AW / 2, 'evSide'), box(x, pz + AW / 2, x + AD, z + d, 'evSide')]
    return [box(x, z, x + w - AD, z + d, 'evBack'), box(x + w - AD, z, x + w, pz - AW / 2, 'evSide'), box(x + w - AD, pz + AW / 2, x + w, z + d, 'evSide')]


def floor_wall_boxes(floor):
    boxes = []
    for room in floor['rooms']:
        x, z, w, d = room['rect']
        if room['kind'] == 'elevator':
            boxes.extend(elevator_blocks(room)); continue
        h_wall(boxes, x, x + w, z, side_gaps(room, 'N'))
        h_wall(boxes, x, x + w, z + d, side_gaps(room, 'S'))
        v_wall(boxes, z, z + d, x, side_gaps(room, 'W'))
        v_wall(boxes, z, z + d, x + w, side_gaps(room, 'E'))
    rects = floor.get('footprint', [])
    opens = floor.get('perimOpenings', [])
    D, T = 0.02, WALL_T
    for i, (rx, rz, rw, rd) in enumerate(rects):
        def cov_h(zs):
            return [(ox + ow / 2, ow) for j, (ox, oz, ow, od) in enumerate(rects)
                    if j != i and oz - 1e-9 <= zs <= oz + od + 1e-9]
        def cov_v(xs):
            return [(oz + od / 2, od) for j, (ox, oz, ow, od) in enumerate(rects)
                    if j != i and ox - 1e-9 <= xs <= ox + ow + 1e-9]
        def op_h(zc, f):
            return [(o['pos'][0], o['width']) for o in opens if o['facing'] == f and abs(o['pos'][1] - zc) < 0.05]
        def op_v(xc, f):
            return [(o['pos'][1], o['width']) for o in opens if o['facing'] == f and abs(o['pos'][0] - xc) < 0.05]
        h_wall(boxes, rx, rx + rw, rz - T / 2, cov_h(rz - D) + op_h(rz, 'N'), T / 2)
        h_wall(boxes, rx, rx + rw, rz + rd + T / 2, cov_h(rz + rd + D) + op_h(rz + rd, 'S'), T / 2)
        v_wall(boxes, rz, rz + rd, rx - T / 2, cov_v(rx - D) + op_v(rx, 'W'), T / 2)
        v_wall(boxes, rz, rz + rd, rx + rw + T / 2, cov_v(rx + rw + D) + op_v(rx + rw, 'E'), T / 2)
    for ax, az, bx, bz in floor.get('fillWalls', []):
        if abs(az - bz) < 1e-6:
            boxes.append(dict(cx=(ax + bx) / 2, cz=az, w=abs(bx - ax), d=T, kind='wall'))
        else:
            boxes.append(dict(cx=ax, cz=(az + bz) / 2, w=T, d=abs(bz - az), kind='wall'))
    return boxes


# ---------------------------------------------------------------------------
# P0 区間の選択(src/p0_region.js と同じ規則)
# ---------------------------------------------------------------------------
AIR = [r['rect'] for r in REGION['air']]
PAD = REGION['clipPad']

def rect_minmax(r):
    return r[0], r[1], r[0] + r[2], r[1] + r[3]

def box_minmax(b):
    return b['cx'] - b['w'] / 2, b['cz'] - b['d'] / 2, b['cx'] + b['w'] / 2, b['cz'] + b['d'] / 2

def select_region_boxes(boxes):
    """空気領域(PAD膨張)との接触面積が minContactArea 超の壁/塊を選び、接触部の外接箱に切り詰める。"""
    out, seen = [], set()
    for b in boxes:
        if b['kind'] not in ('wall', 'solid'):
            continue
        bx0, bz0, bx1, bz1 = box_minmax(b)
        area, ux0, uz0, ux1, uz1 = 0.0, 1e9, 1e9, -1e9, -1e9
        for r in AIR:
            ax0, az0, ax1, az1 = rect_minmax(r)
            ix0, iz0 = max(bx0, ax0 - PAD), max(bz0, az0 - PAD)
            ix1, iz1 = min(bx1, ax1 + PAD), min(bz1, az1 + PAD)
            if ix1 - ix0 <= 1e-9 or iz1 - iz0 <= 1e-9:
                continue
            area += (ix1 - ix0) * (iz1 - iz0)
            ux0, uz0, ux1, uz1 = min(ux0, ix0), min(uz0, iz0), max(ux1, ix1), max(uz1, iz1)
        if area <= REGION['minContactArea']:
            continue
        key = (round(ux0, 4), round(uz0, 4), round(ux1, 4), round(uz1, 4))
        if key in seen:      # 隣室同士の共有壁(同一箱の重複)を1枚に
            continue
        seen.add(key)
        out.append(dict(min=(ux0, uz0), max=(ux1, uz1), kind=b['kind'], part=b.get('part'), roomId=b.get('roomId')))
    return out

def in_air(x, z, y=None):
    if y is not None and not (BASE_Y + 0.001 < y < BASE_Y + CEIL_H - 0.001):
        return False
    for r in AIR:
        x0, z0, x1, z1 = rect_minmax(r)
        if x0 - 1e-6 <= x <= x1 + 1e-6 and z0 - 1e-6 <= z <= z1 + 1e-6:
            return True
    return False

def doorway_contains(x, z, doors):
    for dd in doors:
        (x0, z0), (x1, z1) = dd['gap_min'], dd['gap_max']
        if x0 - 1e-6 <= x <= x1 + 1e-6 and z0 - 1e-6 <= z <= z1 + 1e-6:
            return True
    return False


# ---------------------------------------------------------------------------
# メッシュ生成ヘルパ(ゲーム座標で書き、Blender座標へ変換)
# ---------------------------------------------------------------------------
def g2b(x, y, z):
    return Vector((x, -z, y))

MATS = {}
TEX_SIZE = {}  # material name -> (texture physical size m, rotate90)

class MeshBuilder:
    """複数の箱/面を1オブジェクトにまとめる。面ごとに材質と第1UV(実寸平面投影)を付ける。"""
    def __init__(self, name, origin=(0.0, 0.0, 0.0)):
        self.name = name
        self.origin = origin  # game coords
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new('UVMap')
        self.mat_index = {}
        self.mat_list = []

    def _mi(self, mat):
        if mat not in self.mat_index:
            self.mat_index[mat] = len(self.mat_list)
            self.mat_list.append(mat)
        return self.mat_index[mat]

    def quad(self, pts, normal, mat):
        """pts: ゲーム座標4点(反時計回り=normal 側から見て)。"""
        ox, oy, oz = self.origin
        vs = [self.bm.verts.new(g2b(p[0] - ox, p[1] - oy, p[2] - oz)) for p in pts]
        f = self.bm.faces.new(vs)
        f.material_index = self._mi(mat)
        size, rot = TEX_SIZE.get(mat, (1.0, False))
        nx, ny, nz = normal
        for loop, p in zip(f.loops, pts):
            x, y, z = p
            if abs(ny) > 0.5:          # 床/天井
                u, v = x, -z if ny > 0 else z
            else:                      # 鉛直面: 見る人の右方向 = up × n
                rx, rz = nz, -nx       # cross((0,1,0),(nx,0,nz)) = (nz, 0, -nx)
                u, v = x * rx + z * rz, y
            if rot:
                u, v = v, u
            loop[self.uv].uv = (u / size, v / size)
        return f

    def box(self, mn, mx, mat, keep=None, mats=None):
        """軸平行の箱。keep(face_key, center, normal)->bool で面を間引く。mats で面別材質。"""
        x0, y0, z0 = mn; x1, y1, z1 = mx
        faces = {
            '+x': ([(x1, y0, z1), (x1, y0, z0), (x1, y1, z0), (x1, y1, z1)], (1, 0, 0)),
            '-x': ([(x0, y0, z0), (x0, y0, z1), (x0, y1, z1), (x0, y1, z0)], (-1, 0, 0)),
            '+z': ([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], (0, 0, 1)),
            '-z': ([(x1, y0, z0), (x0, y0, z0), (x0, y1, z0), (x1, y1, z0)], (0, 0, -1)),
            '+y': ([(x0, y1, z1), (x1, y1, z1), (x1, y1, z0), (x0, y1, z0)], (0, 1, 0)),
            '-y': ([(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], (0, -1, 0)),
        }
        made = 0
        for key, (pts, n) in faces.items():
            c = tuple(sum(p[i] for p in pts) / 4 for i in range(3))
            if keep is not None and not keep(key, c, n):
                continue
            self.quad(pts, n, (mats or {}).get(key, mat))
            made += 1
        return made

    def finish(self, collection, props=None):
        if len(self.bm.faces) == 0:
            self.bm.free(); return None
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-5)
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mat_list:
            me.materials.append(MATS[m])
        ob = bpy.data.objects.new(self.name, me)
        ob.location = g2b(*self.origin)
        collection.objects.link(ob)
        for k, v in (props or {}).items():
            ob[k] = v
        return ob


# ---------------------------------------------------------------------------
# マテリアル
# ---------------------------------------------------------------------------
def load_img(path, non_color):
    img = bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = 'Non-Color' if non_color else 'sRGB'
    return img

def pbr_material(name, tex=None, size=1.0, rot=False, base=(0.8, 0.8, 0.8), rough=0.6,
                 metal=0.0, emit=None, emit_strength=0.0, emit_tex=None, normal_strength=1.0, files=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*base, 1.0)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'UVMap'; uvn.location = (-900, 0)
    if tex or files:
        d = os.path.join(TEX_DIR, tex) if tex else ''
        files = files or {k: os.path.join(d, k + '.jpg') for k in ('albedo', 'roughness', 'normal')}
        a = nt.nodes.new('ShaderNodeTexImage'); a.image = load_img(files['albedo'], False)
        a.location = (-600, 300); nt.links.new(uvn.outputs['UV'], a.inputs['Vector'])
        nt.links.new(a.outputs['Color'], bsdf.inputs['Base Color'])
        r = nt.nodes.new('ShaderNodeTexImage'); r.image = load_img(files['roughness'], True)
        r.location = (-600, 0); nt.links.new(uvn.outputs['UV'], r.inputs['Vector'])
        nt.links.new(r.outputs['Color'], bsdf.inputs['Roughness'])
        n = nt.nodes.new('ShaderNodeTexImage'); n.image = load_img(files['normal'], True)
        n.location = (-600, -300); nt.links.new(uvn.outputs['UV'], n.inputs['Vector'])
        nm = nt.nodes.new('ShaderNodeNormalMap'); nm.location = (-300, -300); nm.uv_map = 'UVMap'
        nm.inputs['Strength'].default_value = normal_strength
        nm.name = 'N2_NormalMap'
        nt.links.new(n.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    if emit is not None:
        bsdf.inputs['Emission Color'].default_value = (*emit, 1.0)
        bsdf.inputs['Emission Strength'].default_value = emit_strength
    if emit_tex is not None:
        e = nt.nodes.new('ShaderNodeTexImage'); e.image = emit_tex; e.location = (-600, 600)
        nt.links.new(uvn.outputs['UV'], e.inputs['Vector'])
        nt.links.new(e.outputs['Color'], bsdf.inputs['Emission Color'])
        nt.links.new(e.outputs['Color'], bsdf.inputs['Base Color'])
        bsdf.inputs['Emission Strength'].default_value = emit_strength
    MATS[name] = m
    TEX_SIZE[name] = (size, rot)
    return m


def make_exit_sign_image():
    """避難口誘導灯の面(自作・CC0相当)。緑地に白抜きの扉と走る人。numpy で描いて PNG 保存。"""
    W, H = 768, 256
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    img = np.zeros((H, W, 3), np.float32)
    img[:] = (0.02, 0.42, 0.16)
    white = np.zeros((H, W), bool)
    # 扉(右側): 白い枠 + 中は緑
    dx0, dx1, dy0, dy1 = 470, 640, 30, 226
    white |= (xx >= dx0) & (xx <= dx1) & (yy >= dy0) & (yy <= dy1)
    inner = (xx >= dx0 + 16) & (xx <= dx1 - 16) & (yy >= dy0 + 16) & (yy <= dy1)
    white &= ~inner
    def seg(ax, ay, bx, by, r):
        vx, vy = bx - ax, by - ay
        t = np.clip(((xx - ax) * vx + (yy - ay) * vy) / (vx * vx + vy * vy), 0, 1)
        return (xx - (ax + t * vx)) ** 2 + (yy - (ay + t * vy)) ** 2 <= r * r
    # 走る人(扉へ向かって右向き)
    white |= (xx - 330) ** 2 + (yy - 62) ** 2 <= 22 ** 2           # 頭
    white |= seg(318, 92, 290, 160, 17)                          # 胴
    white |= seg(312, 105, 360, 128, 11) | seg(360, 128, 392, 104, 10)   # 前腕
    white |= seg(310, 105, 268, 120, 11) | seg(268, 120, 246, 146, 10)   # 後腕
    white |= seg(290, 160, 338, 186, 13) | seg(338, 186, 352, 230, 12)   # 前脚
    white |= seg(290, 160, 258, 196, 13) | seg(258, 196, 214, 206, 12)   # 後脚
    # 矢印(左下)
    white |= seg(60, 200, 170, 200, 9) | seg(60, 200, 92, 176, 8) | seg(60, 200, 92, 224, 8)
    img[white] = (0.95, 0.97, 0.95)
    rgba = np.concatenate([img[::-1], np.ones((H, W, 1), np.float32)], axis=2)  # Blenderは下から
    im = bpy.data.images.new('exit_sign', W, H, alpha=False)
    im.colorspace_settings.name = 'sRGB'
    # バイト画像の pixels は表示値(=sRGB符号化済み)をそのまま持つので変換せずに入れる
    im.pixels.foreach_set(rgba.ravel())
    path = os.path.join(ROOT, 'build', 'tex_exit_sign.png')
    im.filepath_raw = path
    im.file_format = 'PNG'
    im.save()
    im2 = bpy.data.images.load(path, check_existing=False)
    im2.colorspace_settings.name = 'sRGB'
    bpy.data.images.remove(im)
    return im2


def build_materials():
    pbr_material('M_Wall', 'wall_cloth', size=1.0, rough=0.85)
    pbr_material('M_Ceiling', 'ceiling_tile', size=3.0, rough=0.9)
    # 床: 淡いグレーのまだら模様の長尺シート(DESIGN §2.2・自作 n2tex.floor_sheet。1枚=1m角)
    alb, nrm, rgh = n2tex.floor_sheet()
    ff = {}
    for k, arr in (('albedo', alb), ('normal', nrm), ('roughness', np.repeat(rgh[..., None], 3, axis=2))):
        img = n2tex.save_png(bpy, ROOT, f'floor_{k}', arr)
        ff[k] = bpy.path.abspath(img.filepath)
        bpy.data.images.remove(img)
    pbr_material('M_Floor', files=ff, size=1.0, rough=0.7, normal_strength=0.6)
    pbr_material('M_DoorWood', 'door_wood', size=1.0, rot=True, rough=0.5)
    pbr_material('M_Frame', base=(0.11, 0.10, 0.09), rough=0.45)                 # 塗装スチール枠
    pbr_material('M_Baseboard', base=(0.035, 0.035, 0.035), rough=0.55)          # ソフト幅木
    pbr_material('M_Handle', base=(0.75, 0.74, 0.72), rough=0.28, metal=1.0)     # レバーハンドル
    pbr_material('M_SteelDoor', base=(0.33, 0.34, 0.35), rough=0.5)              # 階段室の鉄扉(塗装)
    pbr_material('M_Stainless', base=(0.55, 0.55, 0.55), rough=0.5, metal=1.0)   # EV扉(ヘアライン相当の粗さ)
    pbr_material('M_Plastic', base=(0.72, 0.72, 0.70), rough=0.5)                # 器具ハウジング
    pbr_material('M_Void', base=(0.0, 0.0, 0.0), rough=1.0)                      # 扉の向こう/曲がり角の闇
    pbr_material('M_LampCover', base=(0.9, 0.92, 0.95), rough=0.4,
                 emit=(0.74, 0.84, 1.0), emit_strength=6.0)                     # 常夜灯(寒色)の拡散板
    pbr_material('M_ExitSign', size=1.0, rough=0.4, emit_tex=make_exit_sign_image(),
                 emit_strength=3.0)
    pbr_material('M_Window', base=(0.05, 0.06, 0.08), rough=0.2,
                 emit=(0.45, 0.55, 0.85), emit_strength=0.35)                   # すりガラス越しの夜空
    pbr_material('M_Button', base=(0.1, 0.1, 0.1), rough=0.4,
                 emit=(1.0, 0.55, 0.15), emit_strength=1.5)
    p0b_ev.build_materials(sys.modules[__name__])


# ---------------------------------------------------------------------------
# 生成
# ---------------------------------------------------------------------------
def region_doors():
    """P0 区間に面した扉。gap は walls.js の扉開口(壁厚×扉幅)。"""
    out = []
    for room in FLOOR['rooms']:
        dr = room.get('door')
        if not dr:
            continue
        px, pz = dr['pos']
        horiz = dr['facing'] in ('N', 'S')
        if horiz:
            gmin, gmax = (px - DOOR_W / 2, pz - WALL_T / 2), (px + DOOR_W / 2, pz + WALL_T / 2)
        else:
            gmin, gmax = (px - WALL_T / 2, pz - DOOR_W / 2), (px + WALL_T / 2, pz + DOOR_W / 2)
        # 扉の両側のどちらかが空気領域に入っていれば対象
        fx, fz = {'N': (0, -1), 'S': (0, 1), 'E': (1, 0), 'W': (-1, 0)}[dr['facing']]
        outside = in_air(px + fx * 0.1, pz + fz * 0.1)
        inside = in_air(px - fx * 0.1, pz - fz * 0.1)
        if not (outside or inside):
            continue
        out.append(dict(room=room, id=room['id'], kind=room['kind'], pos=(px, pz), facing=dr['facing'],
                        horiz=horiz, gap_min=gmin, gap_max=gmax, steel=bool(dr.get('steel')),
                        operable=room['id'] in REGION['operableDoors']))
    return out


def build():
    # 既定シーンを空に
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    scene = bpy.context.scene
    col = bpy.data.collections.new('P0')
    scene.collection.children.link(col)
    build_materials()

    doors = region_doors()
    log(f'doors in region: {[d["id"] for d in doors]}')
    walls = select_region_boxes(floor_wall_boxes(FLOOR))
    log(f'wall boxes selected: {len(walls)}')

    y0, y1 = BASE_Y, BASE_Y + CEIL_H

    def visible(c, n):
        sx, sy, sz = c[0] + n[0] * 0.02, c[1] + n[1] * 0.02, c[2] + n[2] * 0.02
        return in_air(sx, sz, sy) or (BASE_Y < sy < BASE_Y + DOOR_H + HEAD_H and doorway_contains(sx, sz, doors))

    wall_meta = []
    # --- 壁(1箱=1オブジェクト。名前と元データの対応を check_glb が使う) ---
    for i, w in enumerate(walls):
        (x0, z0), (x1, z1) = w['min'], w['max']
        mb = MeshBuilder(f'Wall_{i:02d}')
        mat = 'M_Wall'   # EV の塊(solid)も廊下側は壁仕上げ。ステンレスは EV 扉だけ
        ev = next((d for d in doors if d['kind'] == 'elevator' and d['id'] == w.get('roomId')), None)
        if w.get('part') == 'evBack' and ev:
            # EV扉の面は開口を抜いて張る(扉・三方枠は p0b_ev が作る)
            fwd = p0b_ev.FACE[ev['facing']][0]
            back = (-fwd[0], 0, -fwd[1])
            n = mb.box((x0, y0, z0), (x1, y1, z1), mat,
                       keep=lambda k, c, nn: nn != back and visible(c, nn))
            p0b_ev.ev_back_face_with_opening(sys.modules[__name__], mb, w, ev)
        else:
            n = mb.box((x0, y0, z0), (x1, y1, z1), mat, keep=lambda k, c, nn: visible(c, nn))
        ob = mb.finish(col, {'n2_kind': 'wall', 'n2_box': json.dumps([x0, z0, x1, z1])})
        wall_meta.append((i, n))
        # 幅木: 空気に面する長い鉛直面に沿って
        bb = MeshBuilder(f'Baseboard_{i:02d}')
        for key, n_ in (('+x', (1, 0, 0)), ('-x', (-1, 0, 0)), ('+z', (0, 0, 1)), ('-z', (0, 0, -1))):
            if key[1] == 'x':
                fx = x1 if key[0] == '+' else x0
                length = z1 - z0
                c = (fx, y0 + 0.5, (z0 + z1) / 2)
            else:
                fz = z1 if key[0] == '+' else z0
                length = x1 - x0
                c = ((x0 + x1) / 2, y0 + 0.5, fz)
            if length < 0.2 or not visible(c, n_) or w['kind'] == 'solid':
                continue
            t, h = 0.012, 0.06
            if key == '+x':  bb.box((x1, y0, z0), (x1 + t, y0 + h, z1), 'M_Baseboard')
            if key == '-x':  bb.box((x0 - t, y0, z0), (x0, y0 + h, z1), 'M_Baseboard')
            if key == '+z':  bb.box((x0, y0, z1), (x1, y0 + h, z1 + t), 'M_Baseboard')
            if key == '-z':  bb.box((x0, y0, z0 - t), (x1, y0 + h, z0), 'M_Baseboard')
        bb.finish(col, {'n2_kind': 'baseboard'})

    # --- 床・天井(空気領域ごと) ---
    fl = MeshBuilder('Floor'); ce = MeshBuilder('Ceiling')
    for r in AIR:
        x0, z0, x1, z1 = rect_minmax(r)
        fl.quad([(x0, y0, z1), (x1, y0, z1), (x1, y0, z0), (x0, y0, z0)], (0, 1, 0), 'M_Floor')
        ce.quad([(x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)], (0, -1, 0), 'M_Ceiling')
    fl.finish(col, {'n2_kind': 'floor'}); ce.finish(col, {'n2_kind': 'ceiling'})

    # --- 塞ぎ(曲がり角の先/扉の向こう = 闇) ---
    cap = MeshBuilder('Void_Caps')
    for c in REGION['caps']:
        x = c['x']
        cap.quad([(x, y0, c['z0']), (x, y0, c['z1']), (x, y1, c['z1']), (x, y1, c['z0'])], (-1, 0, 0), 'M_Void')
    cap.finish(col, {'n2_kind': 'void'})

    # --- 扉 ---
    door_info = []
    for dd in doors:
        door_info.append(build_door(dd, col))

    # --- 常夜灯(前作の間引き配置: 廊下パスに沿って 6.5m 間隔) ---
    lamps = night_light_positions()
    lamps = [p for p in lamps if in_air(p[0], p[1])]
    log(f'night lights: {lamps}')
    for i, (lx, lz) in enumerate(lamps):
        build_night_light(i, lx, lz, col)

    # --- EVホール(下がり梁・ダウンライト・非常口サイン) / 窓 ---
    p0b_ev.build_hall(sys.modules[__name__], col, doors, door_info)
    build_window(col)

    # ワールド: 真っ黒(外光なし)
    world = bpy.data.worlds.new('N2_Night')
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (0, 0, 0, 1)
    bg.inputs['Strength'].default_value = 0.0
    scene.world = world

    scene['n2_meta'] = json.dumps(dict(level=LEVEL, baseY=BASE_Y, ceilH=CEIL_H, doors=door_info,
                                       lamps=lamps, walls=len(walls)))
    return col


def build_door(dd, col):
    """扉枠(縦枠・上枠・沓摺り・額縁)+上の垂れ壁+扉板(ヒンジ位置を原点)。"""
    px, pz = dd['pos']
    (gx0, gz0), (gx1, gz1) = dd['gap_min'], dd['gap_max']
    y0 = BASE_Y
    facing = dd['facing']
    fx, fz = {'N': (0, -1), 'S': (0, 1), 'E': (1, 0), 'W': (-1, 0)}[facing]  # 廊下側(扉の外)向き
    rid = dd['id']
    if dd['kind'] == 'elevator':
        return p0b_ev.build_elevator(sys.modules[__name__], dd, col)   # DESIGN §2.2(P0b)
    fr = MeshBuilder(f'DoorFrame_{rid}')
    FM = 'M_SteelFrameP' if dd['steel'] else 'M_Frame'

    # 上の垂れ壁(扉枠の上〜天井)
    lin = MeshBuilder(f'Lintel_{rid}')
    lin.box((gx0, y0 + DOOR_H + HEAD_H, gz0), (gx1, y0 + CEIL_H, gz1), 'M_Wall',
            keep=lambda k, c, n: k != '+y' and in_air(c[0] + n[0] * 0.03, c[2] + n[2] * 0.03, c[1] + n[1] * 0.03))
    lin.finish(col, {'n2_kind': 'lintel', 'n2_room': rid})

    # 枠: 開口(壁厚)の内側を覆う
    if dd['horiz']:
        fr.box((gx0, y0, gz0), (gx0 + JAMB, y0 + DOOR_H, gz1), FM)
        fr.box((gx1 - JAMB, y0, gz0), (gx1, y0 + DOOR_H, gz1), FM)
    else:
        fr.box((gx0, y0, gz0), (gx1, y0 + DOOR_H, gz0 + JAMB), FM)
        fr.box((gx0, y0, gz1 - JAMB), (gx1, y0 + DOOR_H, gz1), FM)
    fr.box((gx0, y0 + DOOR_H, gz0), (gx1, y0 + DOOR_H + HEAD_H, gz1), FM)
    fr.box((gx0, y0, gz0), (gx1, y0 + SILL_H, gz1), 'M_SUS' if dd['steel'] else FM)
    # 額縁(廊下側の壁面に少し出る)
    t, cw = 0.012, 0.04
    if dd['horiz']:
        zf = gz1 if fz > 0 else gz0
        zz = (zf, zf + t) if fz > 0 else (zf - t, zf)
        fr.box((gx0 - cw, y0, zz[0]), (gx0, y0 + DOOR_H + HEAD_H + cw, zz[1]), FM)
        fr.box((gx1, y0, zz[0]), (gx1 + cw, y0 + DOOR_H + HEAD_H + cw, zz[1]), FM)
        fr.box((gx0, y0 + DOOR_H + HEAD_H, zz[0]), (gx1, y0 + DOOR_H + HEAD_H + cw, zz[1]), FM)
    else:
        xf = gx1 if fx > 0 else gx0
        xx = (xf, xf + t) if fx > 0 else (xf - t, xf)
        fr.box((xx[0], y0, gz0 - cw), (xx[1], y0 + DOOR_H + HEAD_H + cw, gz0), FM)
        fr.box((xx[0], y0, gz1), (xx[1], y0 + DOOR_H + HEAD_H + cw, gz1 + cw), FM)
        fr.box((xx[0], y0 + DOOR_H + HEAD_H, gz0), (xx[1], y0 + DOOR_H + HEAD_H + cw, gz1), FM)
    fr.finish(col, {'n2_kind': 'doorframe', 'n2_room': rid})

    # 扉板: 部屋側寄りに置き、ヒンジ(前作と同じく pos - DOOR_W/2 側)を原点にする
    leaf_w = DOOR_W - 2 * JAMB
    leaf_h = DOOR_H - SILL_H - 0.005
    ly0 = y0 + SILL_H + 0.003
    room_dir = (-fx, -fz)  # 部屋の内側方向
    if dd['horiz']:
        zc = pz + room_dir[1] * 0.02     # 壁中心から部屋側へ2cm
        hinge = (px - DOOR_W / 2 + JAMB, ly0, zc + room_dir[1] * LEAF_T / 2)
        lmin, lmax = (hinge[0], ly0, zc - LEAF_T / 2), (hinge[0] + leaf_w, ly0 + leaf_h, zc + LEAF_T / 2)
    else:
        xc = px + room_dir[0] * 0.02
        hinge = (xc + room_dir[0] * LEAF_T / 2, ly0, pz - DOOR_W / 2 + JAMB)
        lmin, lmax = (xc - LEAF_T / 2, ly0, hinge[2]), (xc + LEAF_T / 2, ly0 + leaf_h, hinge[2] + leaf_w)
    leaf = MeshBuilder(f'DoorLeaf_{rid}', origin=hinge)
    leaf_mat = 'M_SteelDoorP' if dd['steel'] else 'M_DoorWood'
    if dd['steel'] and not dd['horiz']:
        # 外階段の鉄扉(写真 exit_door_steel.jpg): 縦長の網入りガラス窓・上部にドアクローザー
        wz_c = lmin[2] + leaf_w * 0.45            # ヒンジ側から45%(取手側から見て55%)
        wz0, wz1 = wz_c - 0.065, wz_c + 0.065
        wy0, wy1 = ly0 + 0.30, ly0 + 1.80
        leaf.box(lmin, (lmax[0], wy0, lmax[2]), leaf_mat)
        leaf.box((lmin[0], wy1, lmin[2]), lmax, leaf_mat)
        leaf.box((lmin[0], wy0, lmin[2]), (lmax[0], wy1, wz0), leaf_mat)
        leaf.box((lmin[0], wy0, wz1), (lmax[0], wy1, lmax[2]), leaf_mat)
        xc_ = (lmin[0] + lmax[0]) / 2
        leaf.box((xc_ - 0.003, wy0, wz0), (xc_ + 0.003, wy1, wz1), 'M_WireGlassOut')
        face_ = lmax[0] if fx > 0 else lmin[0]
        xx_ = (face_, face_ + 0.055) if fx > 0 else (face_ - 0.055, face_)
        leaf.box((xx_[0], ly0 + leaf_h - 0.11, lmin[2] + 0.05), (xx_[1], ly0 + leaf_h - 0.05, lmin[2] + 0.33), 'M_Closer')
        xa_ = (face_, face_ + 0.03) if fx > 0 else (face_ - 0.03, face_)
        leaf.box((xa_[0], ly0 + leaf_h - 0.05, lmin[2] + 0.28), (xa_[1], ly0 + leaf_h - 0.02, lmin[2] + 0.46), 'M_Closer')
    else:
        leaf.box(lmin, lmax, leaf_mat)
    # レバーハンドル(両面)・ドアスコープ(廊下側)・号室プレート(廊下側)
    hy = ly0 + 0.95
    for side in (1, -1):   # 1=廊下側, -1=部屋側
        sx, sz = fx * side, fz * side
        if dd['horiz']:
            face = (lmax[2] if sz > 0 else lmin[2])
            hx = lmax[0] - 0.07
            rose = ((hx - 0.03, hy - 0.06, face if sz > 0 else face - 0.012),
                    (hx + 0.03, hy + 0.06, face + 0.012 if sz > 0 else face))
            leaf.box(*rose, 'M_Handle')
            zz = (face + 0.012, face + 0.06) if sz > 0 else (face - 0.06, face - 0.012)
            leaf.box((hx - 0.012, hy - 0.012, min(zz)), (hx + 0.012, hy + 0.012, max(zz)), 'M_Handle')
            zl = (face + 0.045, face + 0.07) if sz > 0 else (face - 0.07, face - 0.045)
            leaf.box((hx - 0.13, hy - 0.011, min(zl)), (hx + 0.012, hy + 0.011, max(zl)), 'M_Handle')
        else:
            face = (lmax[0] if sx > 0 else lmin[0])
            hz = lmax[2] - 0.07
            rx = (face, face + 0.012) if sx > 0 else (face - 0.012, face)
            leaf.box((min(rx), hy - 0.06, hz - 0.03), (max(rx), hy + 0.06, hz + 0.03), 'M_Handle')
            xx = (face + 0.012, face + 0.06) if sx > 0 else (face - 0.06, face - 0.012)
            leaf.box((min(xx), hy - 0.012, hz - 0.012), (max(xx), hy + 0.012, hz + 0.012), 'M_Handle')
            xl = (face + 0.045, face + 0.07) if sx > 0 else (face - 0.07, face - 0.045)
            leaf.box((min(xl), hy - 0.011, hz - 0.13), (max(xl), hy + 0.011, hz + 0.012), 'M_Handle')
        if side == 1 and not dd['steel']:
            # ドアスコープ(覗き穴) 高さ1.45m・扉の中央
            if dd['horiz']:
                face = lmax[2] if fz > 0 else lmin[2]
                cx = (lmin[0] + lmax[0]) / 2
                zz = (face, face + 0.01) if fz > 0 else (face - 0.01, face)
                leaf.box((cx - 0.012, y0 + 1.44, min(zz)), (cx + 0.012, y0 + 1.464, max(zz)), 'M_Handle')
            else:
                face = lmax[0] if fx > 0 else lmin[0]
                cz = (lmin[2] + lmax[2]) / 2
                xx = (face, face + 0.01) if fx > 0 else (face - 0.01, face)
                leaf.box((min(xx), y0 + 1.44, cz - 0.012), (max(xx), y0 + 1.464, cz + 0.012), 'M_Handle')
    # 開く向き(部屋の内側へ)。three 側は node.rotation.y を 0→openAngle へ回す
    # 扉板はヒンジから +z(または +x)へ伸びる。部屋側へ振る角の符号:
    if dd['horiz']:
        sign = 1.0 if room_dir[1] < 0 else -1.0     # 扉板(+x方向)を -z へ振る = +回転
    else:
        sign = 1.0 if room_dir[0] > 0 else -1.0     # 扉板(+z方向)を +x へ振る = +回転
    props = {'n2_kind': 'door', 'n2_room': rid, 'n2_operable': 1 if dd['operable'] else 0,
             'n2_open_sign': sign, 'n2_open_angle': 1.75 if dd['operable'] else 0.0}
    leaf.finish(col, props)
    return dict(id=rid, kind=dd['kind'], hinge=hinge, operable=dd['operable'], sign=sign)


def night_light_positions():
    """前作 placeNightLights と同じ: 廊下パスに沿って NIGHT_LIGHT_SPACING ごと。"""
    path = FLOOR['corridor']['path']
    out, acc = [], 0.0
    for i in range(len(path) - 1):
        ax, az = path[i]; bx, bz = path[i + 1]
        seg = math.hypot(bx - ax, bz - az)
        if seg <= 0:
            continue
        t = (NIGHT_LIGHT_SPACING - acc) / seg
        while t <= 1:
            out.append((ax + (bx - ax) * t, az + (bz - az) * t))
            t += NIGHT_LIGHT_SPACING / seg
        acc = (acc + seg) % NIGHT_LIGHT_SPACING
    return out


def build_night_light(i, x, z, col):
    y = BASE_Y + CEIL_H
    hs, hh = 0.13, 0.035
    h = MeshBuilder(f'Lamp_{i}_housing')
    h.box((x - hs, y - hh, z - hs), (x + hs, y, z + hs), 'M_Plastic',
          keep=lambda k, c, n: k != '+y' and k != '-y')
    h.finish(col, {'n2_kind': 'lamp'})
    cv = MeshBuilder(f'Lamp_{i}_cover')
    s = hs - 0.015
    cv.quad([(x - s, y - hh - 0.002, z - s), (x + s, y - hh - 0.002, z - s),
             (x + s, y - hh - 0.002, z + s), (x - s, y - hh - 0.002, z + s)], (0, -1, 0), 'M_LampCover')
    cv.box((x - hs, y - hh, z - hs), (x + hs, y - hh + 0.001, z + hs), 'M_Plastic',
           keep=lambda k, c, n: k == '+y')  # 裏蓋(見えない)
    ob = cv.finish(col, {'n2_kind': 'lampcover', 'n2_lamp': i})
    # 拡散板メッシュ自体は照明に寄与させない(下のエリアライトが光源。二重計上を避ける)
    ob.visible_diffuse = False
    ob.visible_glossy = False
    ob.visible_transmission = False
    ob.visible_volume_scatter = False
    ob.visible_shadow = False
    # 光源: 小さなエリアライト(下向き)
    ld = bpy.data.lights.new(f'NightLight_{i}', 'AREA')
    ld.shape = 'SQUARE'
    ld.size = 2 * s
    ld.energy = float(ARGS.get('lamp_w', 1.6))
    ld.color = (0.74, 0.84, 1.0)
    lo = bpy.data.objects.new(f'NightLight_{i}', ld)
    lo.location = g2b(x, y - hh - 0.006, z)   # Area light は -Z(Blender)へ照らす = 下向き
    col.objects.link(lo)


def build_window(col):
    w = REGION.get('window')
    if not w:
        return
    x, z = w['x'], w['z']
    y0 = BASE_Y + w['sill']; y1 = y0 + w['h']
    hw = w['w'] / 2
    fr = MeshBuilder('Window_frame')
    f, t = 0.035, 0.03
    fr.box((x - hw - f, y0 - f, z), (x - hw, y1 + f, z + t), 'M_Stainless')
    fr.box((x + hw, y0 - f, z), (x + hw + f, y1 + f, z + t), 'M_Stainless')
    fr.box((x - hw, y1, z), (x + hw, y1 + f, z + t), 'M_Stainless')
    fr.box((x - hw, y0 - f, z), (x + hw, y0, z + t + 0.03), 'M_Stainless')
    fr.box((x - hw, (y0 + y1) / 2 - 0.012, z), (x + hw, (y0 + y1) / 2 + 0.012, z + 0.02), 'M_Stainless')  # 中桟
    fr.finish(col, {'n2_kind': 'window'})
    gl = MeshBuilder('Window_glass')
    zz = z + 0.005
    gl.quad([(x - hw, y0, zz), (x + hw, y0, zz), (x + hw, y1, zz), (x - hw, y1, zz)], (0, 0, 1), 'M_Window')
    gl.finish(col, {'n2_kind': 'windowglass'})


def lightmap_uvs(col):
    """全メッシュに第2UV 'Lightmap' を作り、まとめて smart_project(=1枚のアトラスに一括パック)。"""
    meshes = [o for o in col.objects if o.type == 'MESH']
    for o in meshes:
        uvl = o.data.uv_layers.new(name='Lightmap')
        o.data.uv_layers.active = uvl
    view_layer = bpy.context.view_layer
    view_layer.update()
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in meshes:
        o.select_set(True)
    view_layer.objects.active = meshes[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0,
                             area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(rotate=True, margin_method='FRACTION', margin=float(ARGS.get('uv_margin', 0.004)))
    bpy.ops.object.mode_set(mode='OBJECT')
    for o in meshes:
        o.data.uv_layers.active = o.data.uv_layers['UVMap']
        o.data.uv_layers['UVMap'].active_render = True
    log(f'lightmap UV: {len(meshes)} meshes packed')


if __name__ == '__main__':
    col = build()
    lightmap_uvs(col)
    out = os.path.join(ROOT, ARGS['out'])
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=out, compress=True)
    nm = sum(1 for o in col.objects if o.type == 'MESH')
    log(f'saved {out} ({nm} meshes)')
