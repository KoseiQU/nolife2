# build_floor.py — P3a: building.json の1階ぶん(floor.shell)を外殻として生成し .blend に保存する。
#
# 実行: Blender -b --factory-startup -P tools/blender/build_floor.py -- --level 4 [--out build/floor_4_scene.blend]
#
# P0 の build_scene.py(4F の1区間)を全階・全区間に広げたもの。規則は同じ:
#   - 壁は data/building.json → walls.js と同じ箱(本ファイルの floor_wall_boxes が Python 移植)から、
#     floor.shell.air(歩ける/見える空気の矩形)に接する箱だけを選んで接触部へ切り詰め、空気に面した面だけ張る。
#     衝突は JS 側が同じ walls.js から作るので、見た目と当たりのズレは tools/check_glb.mjs が数値で検査する。
#   - 第1UV "UVMap" = 実寸平面投影(タイル)、第2UV "Lightmap" = 階ごとに1枚のアトラス(smart_project で一括)。
#   - テクスチャは build/tex/(tools/make_textures.py)を参照するが GLB には埋め込まない(export.py が NONE で書き出し、
#     材質→テクスチャの対応は manifest.materials に書く)。
# 7F は屋上B(building.roofB: 7F の上の屋根)も同じ .blend に含める(DESIGN §2.3 追記)。

import bpy, bmesh, json, math, os, sys
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
from n2common import parse_args, log  # noqa: E402
import p0b_ev  # noqa: E402
import n2tex  # noqa: E402
import build_rooms  # noqa: E402  (P3b: 入れる部屋の内装・バルコニー・屋上A・外の塊)

ARGS = parse_args({'level': '4', 'out': ''})
LEVEL = int(ARGS['level'])
OUT = ARGS['out'] or f'build/floor_{LEVEL}_scene.blend'
BUILDING = json.load(open(os.path.join(ROOT, 'data', 'building.json')))
FLOOR = next(f for f in BUILDING['floors'] if f['level'] == LEVEL)
SHELL = FLOOR['shell']
GEO = BUILDING['meta']['geom']
FLOOR_H = GEO['floorH']        # 2.9
CEIL_H = GEO['ceilH']          # 2.4
WALL_T = 0.12
DOOR_W = 0.9
DOOR_H = 2.0
HEAD_H = 0.04
JAMB = 0.035
SILL_H = 0.015
LEAF_T = 0.04
EV_ALCOVE_W = 1.0
EV_ALCOVE_D = 0.27
EV_OPEN_SHIFT = 0.2
BASE_Y = (LEVEL - 1) * FLOOR_H
NIGHT_LIGHT_SPACING = 6.5
TEX = os.path.join(ROOT, 'build', 'tex')
HALL_RECT = SHELL['hall']
REGION = {'air': SHELL['air']}
STAIRS = {s['id']: s for s in BUILDING['stairs']}
ROOFB = BUILDING['roofB'] if LEVEL == 7 else None
BASEMENT = BUILDING.get('basement') if LEVEL == 1 else None   # P3a-2: 地下の踊り場(B1)は 1F の GLB に含める
MAX_LEVEL = 7
PLATES = json.load(open(os.path.join(TEX, 'room_plates.json')))
CAR_PANEL = json.load(open(os.path.join(TEX, 'ev_car_panel.json')))

INDOOR_KINDS = {'corridor', 'hall', 'alcove', 'lobby', 'theater', 'room', 'room410'}
FULL_H_KINDS = {'stair', 'well', 'outdoor', 'roof', 'gallery', 'ground'}
B1_HEAD = 2.7    # 地下の踊り場の天井(1F の床スラブの下面 = B1 床 + 2.7)


# ---------------------------------------------------------------------------
# 空気のゾーン(床の高さ・見える高さ付き)
# ---------------------------------------------------------------------------
def make_zones():
    zs = []
    for a in SHELL['air']:
        h = FLOOR_H if a['kind'] in FULL_H_KINDS else a.get('ceil', CEIL_H)   # P5b-3: シアターは天井 2.8m(air.ceil)
        zs.append(dict(a, y0=BASE_Y, y1=BASE_Y + h, set='floor', outdoor=a['kind'] == 'outdoor' or a.get('outdoor', False)))
    if BASEMENT:
        for a in BASEMENT['air']:
            y = BASEMENT['y']
            h = B1_HEAD if a['kind'] == 'room' else (BASE_Y - y + CEIL_H)
            zs.append(dict(a, y0=y, y1=y + h, set='base', outdoor=False))
    if ROOFB:
        for a in ROOFB['air']:
            y = ROOFB['y']
            h = FLOOR_H if a['kind'] in ('well', 'outdoor') else 2.0
            zs.append(dict(a, y0=y, y1=y + h, set='roof', outdoor=True))
    return zs

ZONES = make_zones()


def zone_at(x, z, y=None, sets=('floor', 'roof')):
    for zn in ZONES:
        if zn['set'] not in sets:
            continue
        x0, z0, w, d = zn['rect']
        if x0 - 1e-6 <= x <= x0 + w + 1e-6 and z0 - 1e-6 <= z <= z0 + d + 1e-6:
            if y is None or zn['y0'] + 0.001 < y < zn['y1'] - 0.001:
                return zn
    return None


def in_air(x, z, y=None):
    """p0b_ev 互換: 床の高さの空気(屋内・屋外)に入っているか。"""
    return zone_at(x, z, y, sets=('floor',)) is not None


def in_footprint(x, z, rects, skip=None):
    for r in rects:
        if skip is not None and r == skip:
            continue
        x0, z0, w, d = r
        if x0 + 1e-6 < x < x0 + w - 1e-6 and z0 + 1e-6 < z < z0 + d - 1e-6:
            return True
    return False


# ---------------------------------------------------------------------------
# walls.js の Python 移植(floorWallBoxes。P3a の door.width 対応込み)
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

def door_width(room):
    return (room.get('door') or {}).get('width') or DOOR_W

def side_gaps(room, side):
    gaps = []
    horiz = side in ('N', 'S')
    door = room.get('door')
    if door and door['facing'] == side:
        gaps.append((door['pos'][0] if horiz else door['pos'][1], door_width(room)))
    for o in room.get('openings', []):
        if o['side'] == side:
            gaps.append((o['pos'][0] if horiz else o['pos'][1], o.get('width', DOOR_W)))
    return gaps

def ev_opening_center(room):
    px, pz = room['door']['pos']
    k = EV_OPEN_SHIFT
    return {'N': (px + k, pz), 'S': (px - k, pz), 'W': (px, pz - k)}.get(room['door']['facing'], (px, pz + k))

def elevator_blocks(room):
    x, z, w, d = room['rect']
    def box(x0, z0, x1, z1, part):
        return dict(cx=(x0 + x1) / 2, cz=(z0 + z1) / 2, w=x1 - x0, d=z1 - z0, kind='solid', part=part, roomId=room['id'])
    AW, AD = EV_ALCOVE_W, EV_ALCOVE_D
    px, pz = ev_opening_center(room)
    return [box(x, z + AD, x + w, z + d, 'evBack'), box(x, z, px - AW / 2, z + AD, 'evSide'), box(px + AW / 2, z, x + w, z + AD, 'evSide')]

def floor_wall_boxes(floor):
    boxes = []
    for room in floor.get('rooms', []):
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
            return [(ox + ow / 2, ow) for j, (ox, oz, ow, od) in enumerate(rects) if j != i and oz - 1e-9 <= zs <= oz + od + 1e-9]
        def cov_v(xs):
            return [(oz + od / 2, od) for j, (ox, oz, ow, od) in enumerate(rects) if j != i and ox - 1e-9 <= xs <= ox + ow + 1e-9]
        def op_h(zc, f):
            return [(o['pos'][0], o['width']) for o in opens if o['facing'] == f and abs(o['pos'][1] - zc) < 0.05]
        def op_v(xc, f):
            return [(o['pos'][1], o['width']) for o in opens if o['facing'] == f and abs(o['pos'][0] - xc) < 0.05]
        h_wall(boxes, rx, rx + rw, rz - T / 2, cov_h(rz - D) + op_h(rz, 'N'), T / 2)
        h_wall(boxes, rx, rx + rw, rz + rd + T / 2, cov_h(rz + rd + D) + op_h(rz + rd, 'S'), T / 2)
        v_wall(boxes, rz, rz + rd, rx - T / 2, cov_v(rx - D) + op_v(rx, 'W'), T / 2)
        v_wall(boxes, rz, rz + rd, rx + rw + T / 2, cov_v(rx + rw + D) + op_v(rx + rw, 'E'), T / 2)
    for o in opens:
        horiz = o['facing'] in ('N', 'S')
        boxes.append(dict(cx=o['pos'][0], cz=o['pos'][1], w=o['width'] if horiz else T, d=T if horiz else o['width'], kind='perimDoor'))
    # P3b: フィラー壁(4F の縦廊下の北端 = 屋上A との境)。walls.js fillWallBoxes と同じ
    for (ax, az, bx, bz) in floor.get('fillWalls', []):
        if abs(az - bz) < 1e-6:
            boxes.append(dict(cx=(ax + bx) / 2, cz=az, w=abs(bx - ax), d=T, kind='wall'))
        else:
            boxes.append(dict(cx=ax, cz=(az + bz) / 2, w=T, d=abs(bz - az), kind='wall'))
    return boxes


def merge_collinear(boxes):
    """同じ線上で重なる/接する壁箱を1本へ(面の重なり=Zファイトを防ぐ)。'solid' はそのまま。"""
    groups, out = {}, []
    for b in boxes:
        if b['kind'] != 'wall':
            out.append(b); continue
        if abs(b['d'] - WALL_T) < 1e-6 and b['w'] > b['d']:
            key = ('h', round(b['cz'], 4)); lo, hi = b['cx'] - b['w'] / 2, b['cx'] + b['w'] / 2
        else:
            key = ('v', round(b['cx'], 4)); lo, hi = b['cz'] - b['d'] / 2, b['cz'] + b['d'] / 2
        groups.setdefault(key, []).append((lo, hi))
    for (o, c), ivs in groups.items():
        ivs.sort()
        cur = list(ivs[0])
        merged = []
        for lo, hi in ivs[1:]:
            if lo <= cur[1] + 1e-4:
                cur[1] = max(cur[1], hi)
            else:
                merged.append(cur); cur = [lo, hi]
        merged.append(cur)
        for lo, hi in merged:
            if o == 'h':
                out.append(dict(cx=(lo + hi) / 2, cz=c, w=hi - lo, d=WALL_T, kind='wall'))
            else:
                out.append(dict(cx=c, cz=(lo + hi) / 2, w=WALL_T, d=hi - lo, kind='wall'))
    return out


def box_minmax(b):
    return b['cx'] - b['w'] / 2, b['cz'] - b['d'] / 2, b['cx'] + b['w'] / 2, b['cz'] + b['d'] / 2

PAD = 0.07

def select_boxes(boxes, zones, min_area=0.008):
    """空気(PAD 膨張)との接触面積が min_area 超の壁/塊を選び、接触部の外接箱に切り詰める(P0 と同じ規則)。"""
    out, seen = [], set()
    for b in boxes:
        if b['kind'] not in ('wall', 'solid'):
            continue
        bx0, bz0, bx1, bz1 = box_minmax(b)
        area, ux0, uz0, ux1, uz1 = 0.0, 1e9, 1e9, -1e9, -1e9
        for zn in zones:
            ax0, az0, w, d = zn['rect']; ax1, az1 = ax0 + w, az0 + d
            ix0, iz0 = max(bx0, ax0 - PAD), max(bz0, az0 - PAD)
            ix1, iz1 = min(bx1, ax1 + PAD), min(bz1, az1 + PAD)
            if ix1 - ix0 <= 1e-9 or iz1 - iz0 <= 1e-9:
                continue
            area += (ix1 - ix0) * (iz1 - iz0)
            ux0, uz0, ux1, uz1 = min(ux0, ix0), min(uz0, iz0), max(ux1, ix1), max(uz1, iz1)
        if area <= min_area:
            continue
        key = (round(ux0, 4), round(uz0, 4), round(ux1, 4), round(uz1, 4))
        if key in seen:
            continue
        seen.add(key)
        out.append(dict(min=(ux0, uz0), max=(ux1, uz1), kind=b['kind'], part=b.get('part'), roomId=b.get('roomId')))
    return out


# ---------------------------------------------------------------------------
# メッシュ生成ヘルパ(build_scene.py と同じ。ゲーム座標で書き Blender 座標へ)
# ---------------------------------------------------------------------------
def g2b(x, y, z):
    return Vector((x, -z, y))

MATS = {}
TEX_SIZE = {}
MAT_TEX = {}      # 材質名 → 実行時テクスチャ(manifest.materials)
BAKE_ONLY = []    # ベイクの遮蔽にだけ使い、書き出さないオブジェクト


class MeshBuilder:
    def __init__(self, name, origin=(0.0, 0.0, 0.0)):
        self.name = name
        self.origin = origin
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
        ox, oy, oz = self.origin
        vs = [self.bm.verts.new(g2b(p[0] - ox, p[1] - oy, p[2] - oz)) for p in pts]
        f = self.bm.faces.new(vs)
        f.material_index = self._mi(mat)
        size, rot = TEX_SIZE.get(mat, (1.0, False))
        nx, ny, nz = normal
        for loop, p in zip(f.loops, pts):
            x, y, z = p
            if abs(ny) > 0.5:
                u, v = x, -z if ny > 0 else z
            else:
                rx, rz = nz, -nx
                u, v = x * rx + z * rz, y
            if rot:
                u, v = v, u
            loop[self.uv].uv = (u / size, v / size)
        return f

    def poly(self, pts, normal, mat):
        """任意の凸多角形(法線は向きを強制)。"""
        f = self.quad(pts, normal, mat)
        orient(f, normal)
        return f

    def box(self, mn, mx, mat, keep=None, mats=None):
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

    def finish(self, collection, props=None, bake_only=False):
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
        if bake_only:
            ob['n2_bake_only'] = 1
            BAKE_ONLY.append(ob)
        return ob


def orient(f, n_game):
    nb = (n_game[0], -n_game[2], n_game[1])
    f.normal_update()
    if f.normal.x * nb[0] + f.normal.y * nb[1] + f.normal.z * nb[2] < 0:
        f.normal_flip()
    return f


def set_uv(f, mb, uvs):
    for loop, uv in zip(f.loops, uvs):
        loop[mb.uv].uv = uv


# ---------------------------------------------------------------------------
# マテリアル(テクスチャは build/tex の実行時ファイル)
# ---------------------------------------------------------------------------
def rel(path):
    return os.path.relpath(path, ROOT).replace(os.sep, '/')

def tex(name):
    return os.path.join(TEX, name)

def load_img(path, non_color):
    img = bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = 'Non-Color' if non_color else 'sRGB'
    return img

def pbr_material(name, tex=None, size=1.0, rot=False, base=(0.8, 0.8, 0.8), rough=0.6,
                 metal=0.0, emit=None, emit_strength=0.0, emit_tex=None, normal_strength=1.0, files=None, alpha=None):
    """build_scene.pbr_material と同じ。files={albedo,roughness,normal}(任意の部分集合)を build/tex から。"""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*base, 1.0)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'UVMap'; uvn.location = (-900, 0)
    rec = {}
    files = files or {}
    if 'albedo' in files:
        a = nt.nodes.new('ShaderNodeTexImage'); a.image = load_img(files['albedo'], False)
        nt.links.new(uvn.outputs['UV'], a.inputs['Vector']); nt.links.new(a.outputs['Color'], bsdf.inputs['Base Color'])
        rec['map'] = rel(files['albedo'])
    if 'roughness' in files:
        r = nt.nodes.new('ShaderNodeTexImage'); r.image = load_img(files['roughness'], True)
        nt.links.new(uvn.outputs['UV'], r.inputs['Vector']); nt.links.new(r.outputs['Color'], bsdf.inputs['Roughness'])
        rec['roughnessMap'] = rel(files['roughness'])
    if 'normal' in files:
        n = nt.nodes.new('ShaderNodeTexImage'); n.image = load_img(files['normal'], True)
        nt.links.new(uvn.outputs['UV'], n.inputs['Vector'])
        nm = nt.nodes.new('ShaderNodeNormalMap'); nm.uv_map = 'UVMap'; nm.name = 'N2_NormalMap'
        nm.inputs['Strength'].default_value = normal_strength
        nt.links.new(n.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
        rec['normalMap'] = rel(files['normal']); rec['normalScale'] = normal_strength
    if emit is not None:
        bsdf.inputs['Emission Color'].default_value = (*emit, 1.0)
        bsdf.inputs['Emission Strength'].default_value = emit_strength
    if emit_tex is not None:
        e = nt.nodes.new('ShaderNodeTexImage'); e.image = emit_tex
        nt.links.new(uvn.outputs['UV'], e.inputs['Vector'])
        nt.links.new(e.outputs['Color'], bsdf.inputs['Emission Color'])
        nt.links.new(e.outputs['Color'], bsdf.inputs['Base Color'])
        bsdf.inputs['Emission Strength'].default_value = emit_strength
        rec['map'] = rec['emissiveMap'] = rel(bpy.path.abspath(emit_tex.filepath))
    if alpha is not None:
        bsdf.inputs['Alpha'].default_value = alpha
        rec['opacity'] = alpha
    MATS[name] = m
    TEX_SIZE[name] = (size, rot)
    if rec:
        MAT_TEX[name] = rec
    return m


def _set_base_tex(mat, img):
    nt = mat.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    uvn = next(n for n in nt.nodes if n.type == 'UVMAP')
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = img
    nt.links.new(uvn.outputs['UV'], t.inputs['Vector'])
    nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
    MAT_TEX.setdefault(mat.name, {})['map'] = rel(bpy.path.abspath(img.filepath))


def tex_files(prefix, normal=True, rough=True):
    f = {'albedo': tex(f'{prefix}_albedo.jpg')}
    if normal: f['normal'] = tex(f'{prefix}_normal.jpg')
    if rough: f['roughness'] = tex(f'{prefix}_roughness.jpg')
    return f


# p0b_ev が n2tex.save_png で作る画像は、実行時テクスチャ(build/tex)を読む形に差し替える
_P0B_TEX = {'wire_glass': 'wire_glass.png', 'ev_display': 'ev_display.png', 'ev_plate': 'ev_plate.png',
            'car_stone': 'car_stone.jpg', 'exit_sign_sq': 'exit_sign_sq.png'}
def _load_runtime_png(bpy_, root, name, arr):
    img = bpy.data.images.load(tex(_P0B_TEX[name]), check_existing=True)
    img.colorspace_settings.name = 'sRGB'
    return img
n2tex.save_png = _load_runtime_png


def build_materials():
    pbr_material('M_Wall', files=tex_files('wall_cloth'), size=1.0, rough=0.85)
    pbr_material('M_Ceiling', files=tex_files('ceiling_tile'), size=3.0, rough=0.9)
    pbr_material('M_Floor', files=tex_files('floor_sheet'), size=1.0, rough=0.7, normal_strength=0.6)
    pbr_material('M_DoorWood', files=tex_files('door_wood'), size=1.0, rot=True, rough=0.5)
    pbr_material('M_Frame', base=(0.11, 0.10, 0.09), rough=0.45)
    pbr_material('M_Baseboard', base=(0.035, 0.035, 0.035), rough=0.55)
    pbr_material('M_Handle', base=(0.75, 0.74, 0.72), rough=0.28, metal=1.0)
    pbr_material('M_SteelDoor', base=(0.33, 0.34, 0.35), rough=0.5)
    pbr_material('M_Stainless', base=(0.55, 0.55, 0.55), rough=0.5, metal=1.0)
    pbr_material('M_Plastic', base=(0.72, 0.72, 0.70), rough=0.5)
    pbr_material('M_Void', base=(0.0, 0.0, 0.0), rough=1.0)
    pbr_material('M_LampCover', base=(0.9, 0.92, 0.95), rough=0.4, emit=(0.74, 0.84, 1.0), emit_strength=6.0)
    pbr_material('M_ExitSign', size=1.0, rough=0.4, emit_tex=load_img(tex('exit_sign.png'), False), emit_strength=3.0)
    pbr_material('M_Window', base=(0.05, 0.06, 0.08), rough=0.2, emit=(0.45, 0.55, 0.85), emit_strength=0.35)
    pbr_material('M_Button', base=(0.1, 0.1, 0.1), rough=0.4, emit=(1.0, 0.55, 0.15), emit_strength=1.5)
    p0b_ev.build_materials(sys.modules[__name__])
    # P3a で追加
    pbr_material('M_Stone', files=tex_files('stone_floor', rough=True), size=1.2, rough=0.32, normal_strength=0.5)
    pbr_material('M_StoneWall', files=tex_files('stone_wall', rough=False), size=1.2, rough=0.55, normal_strength=0.5)
    pbr_material('M_Carpet', files=tex_files('carpet', rough=False), size=1.0, rough=0.95)
    pbr_material('M_DarkWall', base=(0.075, 0.075, 0.08), rough=0.85)
    pbr_material('M_DarkCeil', base=(0.24, 0.225, 0.21), rough=0.7)
    pbr_material('M_ExtWall', files=tex_files('concrete', rough=False), size=2.0, rough=0.9)
    pbr_material('M_PaintWall', base=(0.58, 0.58, 0.56), rough=0.8)
    pbr_material('M_Deck', files=tex_files('diamond', rough=False), size=0.3, rough=0.5, metal=0.5)
    pbr_material('M_SteelStruct', base=(0.27, 0.27, 0.26), rough=0.6)
    pbr_material('M_Rail', base=(0.36, 0.36, 0.35), rough=0.45, metal=0.3)
    pbr_material('M_RoofSheet', base=(0.30, 0.32, 0.30), rough=0.85)
    # P3a-2: 透明ガラス(実行時は MeshPhysicalMaterial に置換: world.js)。粗さ=指紋・汚れのマップ。小口=薄い青緑
    pbr_material('M_GlassClear', base=(0.85, 0.9, 0.92), rough=0.03, alpha=0.12, files={'roughness': tex('glass_smudge.jpg')})
    pbr_material('M_GlassEdge', base=(0.30, 0.52, 0.45), rough=0.12)
    pbr_material('M_HairV', base=(0.64, 0.64, 0.62), rough=0.25, metal=1.0, files={'roughness': tex('hairline_roughness.jpg')}, size=0.5)
    pbr_material('M_HairH', base=(0.64, 0.64, 0.62), rough=0.25, metal=1.0, files={'roughness': tex('hairline_roughness.jpg')}, size=0.5, rot=True)
    pbr_material('M_Sensor', base=(0.015, 0.015, 0.017), rough=0.18)
    pbr_material('M_Decal', base=(0.55, 0.56, 0.56), rough=0.5)
    pbr_material('M_OfficeDark', base=(0.01, 0.011, 0.012), rough=0.6, emit=(0.5, 0.6, 0.75), emit_strength=0.02)
    pbr_material('M_Paper', base=(0.85, 0.85, 0.82), rough=0.8)
    pbr_material('M_Intercom', base=(1, 1, 1), rough=0.35, metal=0.3)
    _set_base_tex(MATS['M_Intercom'], load_img(tex('intercom.png'), False))
    pbr_material('M_Paving', files=tex_files('paving', rough=False), size=2.0, rough=0.9)
    pbr_material('M_GalleryFloor', files=tex_files('concrete', rough=False), size=1.6, rough=0.85)
    pbr_material('M_BracketDim', base=(0.95, 0.9, 0.8), rough=0.4, emit=(1.0, 0.72, 0.45), emit_strength=0.7)
    # 地下へ下る壁・床(館内と同じ仕上げ。実行時に少し暗く湿った色へ: manifest の tint)
    pbr_material('M_WallDamp', files=tex_files('wall_cloth'), size=1.0, rough=0.8)
    MAT_TEX['M_WallDamp']['tint'] = [0.62, 0.64, 0.61]
    pbr_material('M_FloorDamp', files=tex_files('floor_sheet'), size=1.0, rough=0.55, normal_strength=0.6)
    MAT_TEX['M_FloorDamp']['tint'] = [0.58, 0.6, 0.58]
    pbr_material('M_Backdrop', base=(0.0, 0.0, 0.0), rough=1.0, emit=(0.12, 0.16, 0.26), emit_strength=0.6)
    pbr_material('M_Mailbox', base=(1, 1, 1), rough=0.42, metal=0.15, files={'normal': tex('mailbox_normal.jpg')}, normal_strength=0.8)
    _set_base_tex(MATS['M_Mailbox'], load_img(tex('mailbox.jpg'), False))
    pbr_material('M_RoomPlate', base=(1, 1, 1), rough=0.35, metal=0.4)
    _set_base_tex(MATS['M_RoomPlate'], load_img(tex('room_plates.png'), False))
    pbr_material('M_CarPanel', base=(1, 1, 1), rough=0.35, metal=0.6)
    _set_base_tex(MATS['M_CarPanel'], load_img(tex('ev_car_panel.png'), False))
    pbr_material('M_Screen', base=(0.55, 0.55, 0.55), rough=0.9)
    pbr_material('M_BracketCover', base=(0.95, 0.9, 0.8), rough=0.4, emit=(1.0, 0.78, 0.52), emit_strength=6.0)
    pbr_material('M_Machine', base=(0.40, 0.41, 0.40), rough=0.6)
    # P3b-A: カゴの操作盤の階数表示(8列×3段のアトラス。実行時にカゴの現在地のマスへずらす)
    pbr_material('M_EVCarDisplay', rough=0.05, emit_tex=load_img(tex('ev_car_display.png'), False), emit_strength=2.5)
    # P3c-2: 廊下端の窓(外が見えるガラス)。枠の外側・見込み = アルミ(ライトマップなし・実行時の月明かり)、ガラス = 1枚の面(実行時は両面の半透明＋映り込み＋汚れの粗さ)
    pbr_material('MX_CorrAlu', base=(0.40, 0.41, 0.40), rough=0.42, metal=0.0)
    pbr_material('MX_CorrGlass', base=(0.55, 0.62, 0.66), rough=0.05, alpha=0.14, files={'roughness': tex('glass_smudge.jpg')})
    # P5b-3: シアターの鉄枠のガラス扉(黒に近い暗いグレーのスチール。半つやの焼付塗装)・段床の段鼻(アルミの見切り)・足元灯
    pbr_material('M_SteelDark', base=(0.05, 0.052, 0.056), rough=0.42, metal=0.3)
    pbr_material('M_StepLight', base=(0.9, 0.85, 0.75), rough=0.4, emit=(1.0, 0.74, 0.45), emit_strength=2.2)
    build_rooms.build_materials(sys.modules[__name__])   # P3b: MR_*(部屋の組のライトマップ)・MX_*(ライトマップなし)
    # p0b の材質の実行時テクスチャ(n2tex.save_png を差し替え済みなので画像は build/tex を指す)
    for n in ('M_WireGlass', 'M_WireGlassOut', 'M_EVDisplay', 'M_EVPlate', 'M_CarStone', 'M_ExitSignSq'):
        m = MATS[n]
        for node in m.node_tree.nodes:
            if node.type == 'TEX_IMAGE' and node.image:
                MAT_TEX.setdefault(n, {})['map'] = rel(bpy.path.abspath(node.image.filepath))
                if n in ('M_EVDisplay', 'M_ExitSignSq'):
                    MAT_TEX[n]['emissiveMap'] = MAT_TEX[n]['map']


# 空気の種類 → 床・壁・天井の材質
def wall_mat(kind):
    return {'lobby': 'M_StoneWall', 'theater': 'M_DarkWall', 'stair': 'M_PaintWall', 'well': 'M_PaintWall',
            'outdoor': 'M_ExtWall', 'roof': 'M_ExtWall'}.get(kind, 'M_Wall')

def floor_mat(kind):
    return {'lobby': 'M_Stone', 'theater': 'M_Carpet', 'stair': 'M_Floor', 'gallery': 'M_GalleryFloor'}.get(kind, 'M_Floor')

def ceil_mat(kind):
    return {'lobby': 'M_DarkCeil', 'theater': 'M_DarkCeil'}.get(kind, 'M_Ceiling')


# ---------------------------------------------------------------------------
# 扉
# ---------------------------------------------------------------------------
FACING_OUT = {'N': (0, -1), 'S': (0, 1), 'E': (1, 0), 'W': (-1, 0)}

def floor_doors():
    out = []
    ops = set(SHELL['operable'])
    for room in FLOOR['rooms']:
        dr = room.get('door')
        if not dr:
            continue
        px, pz = dr['pos']
        horiz = dr['facing'] in ('N', 'S')
        dw = door_width(room)
        if horiz:
            gmin, gmax = (px - dw / 2, pz - WALL_T / 2), (px + dw / 2, pz + WALL_T / 2)
        else:
            gmin, gmax = (px - WALL_T / 2, pz - dw / 2), (px + WALL_T / 2, pz + dw / 2)
        fx, fz = FACING_OUT[dr['facing']]
        outside = in_air(px + fx * 0.1, pz + fz * 0.1)
        inside = in_air(px - fx * 0.1, pz - fz * 0.1)
        if not (outside or inside):
            continue
        out.append(dict(room=room, id=room['id'], kind=room['kind'], pos=(px, pz), facing=dr['facing'], width=dw,
                        horiz=horiz, gap_min=gmin, gap_max=gmax, steel=bool(dr.get('steel')), glass=bool(dr.get('glass')),
                        auto=bool(dr.get('auto')), common=bool(dr.get('common')), unit=room['kind'] == 'unit',
                        operable=room['id'] in ops, inside_visible=bool(inside) or bool(dr.get('enterable'))))
    return out


def doorway_contains(x, z, doors):
    for dd in doors:
        (x0, z0), (x1, z1) = dd['gap_min'], dd['gap_max']
        if x0 - 1e-6 <= x <= x1 + 1e-6 and z0 - 1e-6 <= z <= z1 + 1e-6:
            return True
    return False


def build_door(dd, col, base_y=None, zsets=('floor',)):
    """扉枠+垂れ壁+扉板(ヒンジ原点)。P0 build_scene.build_door を全種類へ(居室=号室プレート・覗き穴、施錠扉は室内側の面なし)。
    P3a-2: base_y/zsets で地下の踊り場(B1)の扉にも使う。dd['solid'] = 窓なしの鉄扉"""
    px, pz = dd['pos']
    (gx0, gz0), (gx1, gz1) = dd['gap_min'], dd['gap_max']
    y0 = BASE_Y if base_y is None else base_y
    facing = dd['facing']
    fx, fz = FACING_OUT[facing]
    rid = dd['id']
    if dd['kind'] == 'elevator':
        info = p0b_ev.build_elevator(sys.modules[__name__], dd, col)
        fix_ev_display(rid)
        build_car_panel(dd)
        return info
    if dd['auto']:
        return build_auto_door(dd, col, operable=True)
    fr = MeshBuilder(f'DoorFrame_{rid}')
    glazed = dd['room']['door'].get('glazed')   # P5b-3: 'sus' = ステンレス枠のガラス扉(食堂)、'steel' = 鉄枠のガラス扉(シアターの 2 枚)
    FM = 'M_SteelFrameP' if dd['steel'] else 'M_SteelDark' if glazed == 'steel' else 'M_HairV' if glazed == 'sus' else 'M_Frame'
    lin = MeshBuilder(f'Lintel_{rid}')
    # 屋上B(7F の屋根の上の空気)は扉の高さの判定に入れない(7F の居室の扉の垂れ壁が屋根を突き抜けた)
    zin = zone_at(px - fx * 0.2, pz - fz * 0.2, sets=zsets)
    top_in = (zin['y1'] - y0) if zin else CEIL_H
    zout = zone_at(px + fx * 0.2, pz + fz * 0.2, sets=zsets)
    top_out = (zout['y1'] - y0) if zout else CEIL_H
    top = max(top_in, top_out)
    # P5b-3: 両側の天井の高さが違う扉(シアターの内扉: 前室 2.4m / 室内 2.8m)は垂れ壁を低い天井で 2 段に分ける
    #  (1 枚の面だと面の中心が低い側の天井より上になり、低い側の面が張られなかった)
    lin_ys = [DOOR_H + HEAD_H] + ([min(top_in, top_out)] if abs(top_in - top_out) > 1e-3 else []) + [top]
    for ya, yb in zip(lin_ys[:-1], lin_ys[1:]):
        lin.box((gx0, y0 + ya, gz0), (gx1, y0 + yb, gz1), 'M_WallDamp' if base_y is not None else 'M_Wall',
                keep=lambda k, c, n: k != '+y' and zone_at(c[0] + n[0] * 0.03, c[2] + n[2] * 0.03, c[1] + n[1] * 0.03, sets=zsets) is not None)
    # 垂れ壁の材質を面ごとの空気に合わせる
    lin_ob = lin.finish(col, {'n2_kind': 'lintel', 'n2_room': rid})
    if lin_ob and base_y is None:
        retint_by_zone(lin_ob)
    if dd['horiz']:
        fr.box((gx0, y0, gz0), (gx0 + JAMB, y0 + DOOR_H, gz1), FM)
        fr.box((gx1 - JAMB, y0, gz0), (gx1, y0 + DOOR_H, gz1), FM)
    else:
        fr.box((gx0, y0, gz0), (gx1, y0 + DOOR_H, gz0 + JAMB), FM)
        fr.box((gx0, y0, gz1 - JAMB), (gx1, y0 + DOOR_H, gz1), FM)
    fr.box((gx0, y0 + DOOR_H, gz0), (gx1, y0 + DOOR_H + HEAD_H, gz1), FM)
    fr.box((gx0, y0, gz0), (gx1, y0 + SILL_H, gz1), 'M_SUS' if dd['steel'] or glazed else FM)
    t, cw = 0.012, 0.04
    sides = [1] + ([-1] if dd['inside_visible'] else [])
    for side in sides:
        sx, sz = fx * side, fz * side
        if dd['horiz']:
            zf = gz1 if sz > 0 else gz0
            zz = (zf, zf + t) if sz > 0 else (zf - t, zf)
            fr.box((gx0 - cw, y0, zz[0]), (gx0, y0 + DOOR_H + HEAD_H + cw, zz[1]), FM)
            fr.box((gx1, y0, zz[0]), (gx1 + cw, y0 + DOOR_H + HEAD_H + cw, zz[1]), FM)
            fr.box((gx0, y0 + DOOR_H + HEAD_H, zz[0]), (gx1, y0 + DOOR_H + HEAD_H + cw, zz[1]), FM)
        else:
            xf = gx1 if sx > 0 else gx0
            xx = (xf, xf + t) if sx > 0 else (xf - t, xf)
            fr.box((xx[0], y0, gz0 - cw), (xx[1], y0 + DOOR_H + HEAD_H + cw, gz0), FM)
            fr.box((xx[0], y0, gz1), (xx[1], y0 + DOOR_H + HEAD_H + cw, gz1 + cw), FM)
            fr.box((xx[0], y0 + DOOR_H + HEAD_H, gz0), (xx[1], y0 + DOOR_H + HEAD_H + cw, gz1), FM)
    fr.finish(col, {'n2_kind': 'doorframe', 'n2_room': rid})

    leaf_w = dd['width'] - 2 * JAMB
    leaf_h = DOOR_H - SILL_H - 0.005
    ly0 = y0 + SILL_H + 0.003
    room_dir = (-fx, -fz)
    if dd['horiz']:
        zc = pz + room_dir[1] * 0.02
        hinge = (px - dd['width'] / 2 + JAMB, ly0, zc + room_dir[1] * LEAF_T / 2)
        lmin, lmax = (hinge[0], ly0, zc - LEAF_T / 2), (hinge[0] + leaf_w, ly0 + leaf_h, zc + LEAF_T / 2)
    else:
        xc = px + room_dir[0] * 0.02
        hinge = (xc + room_dir[0] * LEAF_T / 2, ly0, pz - dd['width'] / 2 + JAMB)
        lmin, lmax = (xc - LEAF_T / 2, ly0, hinge[2]), (xc + LEAF_T / 2, ly0 + leaf_h, hinge[2] + leaf_w)
    leaf = MeshBuilder(f'DoorLeaf_{rid}', origin=hinge)
    leaf_mat = 'M_SteelDoorP' if dd['steel'] else 'M_DoorWood'
    # 施錠扉(中が作られていない部屋)は室内側の面を張らない(ライトマップの節約)
    room_face = {('+z' if room_dir[1] > 0 else '-z') if dd['horiz'] else ('+x' if room_dir[0] > 0 else '-x')}
    lkeep = None if dd['inside_visible'] else (lambda k, c, n: k not in room_face)
    if dd['steel'] and not dd['horiz'] and dd.get('solid'):
        # 窓なしの鉄扉(地下の踊り場): 扉板＋ドアクローザー(踊り場側=部屋側)
        leaf.box(lmin, lmax, leaf_mat, keep=lkeep)
        face_ = lmax[0] if room_dir[0] > 0 else lmin[0]
        sx_ = 1 if room_dir[0] > 0 else -1
        xx_ = (face_, face_ + 0.055) if sx_ > 0 else (face_ - 0.055, face_)
        leaf.box((min(xx_), ly0 + leaf_h - 0.11, lmin[2] + 0.05), (max(xx_), ly0 + leaf_h - 0.05, lmin[2] + 0.33), 'M_Closer')
    elif dd['steel'] and not dd['horiz']:
        wz_c = lmin[2] + leaf_w * 0.45
        wz0, wz1 = wz_c - 0.065, wz_c + 0.065
        wy0, wy1 = ly0 + 0.30, ly0 + 1.80
        leaf.box(lmin, (lmax[0], wy0, lmax[2]), leaf_mat, keep=lkeep)
        leaf.box((lmin[0], wy1, lmin[2]), lmax, leaf_mat, keep=lkeep)
        leaf.box((lmin[0], wy0, lmin[2]), (lmax[0], wy1, wz0), leaf_mat, keep=lkeep)
        leaf.box((lmin[0], wy0, wz1), (lmax[0], wy1, lmax[2]), leaf_mat, keep=lkeep)
        xc_ = (lmin[0] + lmax[0]) / 2
        leaf.box((xc_ - 0.003, wy0, wz0), (xc_ + 0.003, wy1, wz1), 'M_WireGlassOut')
        # ドアクローザーは扉が部屋(階段)側へ開くので、廊下の反対=階段室側… 写真では廊下(ホール)側に付く
        face_ = lmax[0] if fx > 0 else lmin[0]
        xx_ = (face_, face_ + 0.055) if fx > 0 else (face_ - 0.055, face_)
        leaf.box((xx_[0], ly0 + leaf_h - 0.11, lmin[2] + 0.05), (xx_[1], ly0 + leaf_h - 0.05, lmin[2] + 0.33), 'M_Closer')
        xa_ = (face_, face_ + 0.03) if fx > 0 else (face_ - 0.03, face_)
        leaf.box((xa_[0], ly0 + leaf_h - 0.05, lmin[2] + 0.28), (xa_[1], ly0 + leaf_h - 0.02, lmin[2] + 0.46), 'M_Closer')
    elif glazed:
        glass_leaf(leaf, dd, glazed, lmin, lmax, hinge, col)
    else:
        leaf.box(lmin, lmax, leaf_mat, keep=lkeep)
    hy = ly0 + 0.95
    for side in (sides if not glazed else []):   # ガラス扉の取っ手は glass_leaf が付ける
        sx, sz = fx * side, fz * side
        if dd['horiz']:
            face = (lmax[2] if sz > 0 else lmin[2])
            hx = lmax[0] - 0.07
            leaf.box((hx - 0.03, hy - 0.06, face if sz > 0 else face - 0.012), (hx + 0.03, hy + 0.06, face + 0.012 if sz > 0 else face), 'M_Handle')
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
        if side == 1 and dd['unit']:
            # ドアスコープ(廊下側・高さ1.45m・中央)と号室プレート(目の高さの上。アトラスの UV)
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
            plate_on_leaf(leaf, dd, lmin, lmax, rid)
    if dd['horiz']:
        sign = 1.0 if room_dir[1] < 0 else -1.0
    else:
        sign = 1.0 if room_dir[0] > 0 else -1.0
    props = {'n2_kind': 'door', 'n2_room': rid, 'n2_operable': 1 if dd['operable'] else 0,
             'n2_open_sign': sign, 'n2_open_angle': 1.75 if dd['operable'] else 0.0}
    leaf_ob = leaf.finish(col, props)
    if glazed and GLASS_PENDING:
        # ガラス(MX_CorrGlass の 1 枚の面)は扉板の子(一緒に回る)。種類 corrglass = ベイクせず光も遮らない・ライトマップなし
        gl_mb = GLASS_PENDING.pop()
        gl_ob = gl_mb.finish(col, {'n2_kind': 'corrglass', 'n2_lm': 0, 'n2_room': rid})
        if gl_ob and leaf_ob:
            gl_ob.parent = leaf_ob
            gl_ob.matrix_parent_inverse = Matrix.Translation(g2b(*hinge)).inverted()
    return dict(id=rid, kind=dd['kind'], hinge=hinge, operable=dd['operable'], sign=sign)


GLASS_PENDING = []


def glass_leaf(leaf, dd, glazed, lmin, lmax, hinge, col):
    """P5b-3: 枠＋透明ガラスの扉板(横向きの扉 = N/S 向きのみ)。
    glazed='sus'  : 食堂。ヘアラインのステンレス枠(縦框 6cm・吊元 5cm・上框 7cm・下框 16cm)＋レバーハンドル(両面)。
    glazed='steel': シアターの 2 枚。暗いスチール枠(縦框 9cm・上框 10cm・下は 26cm の蹴板)＋縦長の押し手(両面、ステンレスの丸棒)。
    ガラスは 1 枚の面(MX_CorrGlass。実行時は廊下端の窓と同じ両面の半透明＋映り込み＋汚れの粗さ)を扉板の厚みの中央に。"""
    assert dd['horiz'], 'glass_leaf: 横向きの扉のみ'
    x0, y0_, z0 = lmin; x1, y1_, z1 = lmax
    zc = (z0 + z1) / 2
    hinge_left = hinge[0] <= (x0 + x1) / 2 + 1e-6      # 吊元 = x0 側
    if glazed == 'steel':
        FMAT, st_h, st_l, top_w, bot_w, t = 'M_SteelDark', 0.09, 0.09, 0.10, 0.26, LEAF_T + 0.01
    else:
        FMAT, st_h, st_l, top_w, bot_w, t = 'M_HairV', 0.05, 0.06, 0.07, 0.16, LEAF_T
    za, zb = zc - t / 2, zc + t / 2
    sl, sr = (st_h, st_l) if hinge_left else (st_l, st_h)
    leaf.box((x0, y0_, za), (x0 + sl, y1_, zb), FMAT)                              # 左の縦框
    leaf.box((x1 - sr, y0_, za), (x1, y1_, zb), FMAT)                              # 右の縦框
    leaf.box((x0 + sl, y1_ - top_w, za), (x1 - sr, y1_, zb), 'M_HairH' if glazed == 'sus' else FMAT)   # 上框
    leaf.box((x0 + sl, y0_, za), (x1 - sr, y0_ + bot_w, zb), 'M_HairH' if glazed == 'sus' else FMAT)   # 下框(鉄扉は蹴板)
    # ガラスの押縁(枠の内側の見切り。両面に 1.5cm)
    gx0, gx1, gy0, gy1 = x0 + sl, x1 - sr, y0_ + bot_w, y1_ - top_w
    bead = 0.015
    for sg in (1, -1):
        zf = zc + sg * t / 2
        zz = (zf, zf + sg * 0.008)
        bz0, bz1 = min(zz), max(zz)
        for (a0, a1, b0, b1) in ((gx0, gx0 + bead, gy0, gy1), (gx1 - bead, gx1, gy0, gy1), (gx0, gx1, gy0, gy0 + bead), (gx0, gx1, gy1 - bead, gy1)):
            leaf.box((a0, b0, bz0), (a1, b1, bz1), FMAT, keep=lambda k, c, n: k not in ('+z', '-z') or (k == ('+z' if sg > 0 else '-z')))
    # 見込み(枠の内側の小口)
    leaf.quad([(gx0, gy0, za), (gx0, gy0, zb), (gx0, gy1, zb), (gx0, gy1, za)], (1, 0, 0), FMAT)
    leaf.quad([(gx1, gy0, zb), (gx1, gy0, za), (gx1, gy1, za), (gx1, gy1, zb)], (-1, 0, 0), FMAT)
    leaf.quad([(gx0, gy1, za), (gx1, gy1, za), (gx1, gy1, zb), (gx0, gy1, zb)], (0, -1, 0), FMAT)
    leaf.quad([(gx0, gy0, zb), (gx1, gy0, zb), (gx1, gy0, za), (gx0, gy0, za)], (0, 1, 0), FMAT)
    # 取っ手(戸先の縦框。両面)
    xl = x1 - sr / 2 if hinge_left else x0 + sl / 2
    for sg in (1, -1):
        zf = zc + sg * t / 2
        if glazed == 'steel':
            # 縦長の押し手(丸棒 φ25 相当の角材・長さ 0.9m)と上下の脚
            zb0 = zf + sg * 0.055
            zz = sorted((zb0, zb0 + sg * 0.025))
            leaf.box((xl - 0.0125, y0_ + 0.62, zz[0]), (xl + 0.0125, y0_ + 1.52, zz[1]), 'M_Handle')
            for yy in (0.70, 1.44):
                zl = sorted((zf, zb0))
                leaf.box((xl - 0.01, y0_ + yy - 0.01, zl[0]), (xl + 0.01, y0_ + yy + 0.01, zl[1]), 'M_Handle')
        else:
            hy = y0_ + 0.95
            hx = xl
            zz = sorted((zf, zf + sg * 0.012))
            leaf.box((hx - 0.022, hy - 0.06, zz[0]), (hx + 0.022, hy + 0.06, zz[1]), 'M_Handle')
            zz = sorted((zf + sg * 0.012, zf + sg * 0.06))
            leaf.box((hx - 0.012, hy - 0.012, zz[0]), (hx + 0.012, hy + 0.012, zz[1]), 'M_Handle')
            zl = sorted((zf + sg * 0.045, zf + sg * 0.07))
            dx = -1 if hinge_left else 1                                         # レバーは吊元の方へ伸びる
            xa, xb = sorted((hx, hx + dx * 0.13))
            leaf.box((xa, hy - 0.011, zl[0]), (xb, hy + 0.011, zl[1]), 'M_Handle')
    # ガラス(1 枚の面。両面は実行時の DoubleSide)
    gm = MeshBuilder(f'DoorGlass_{dd["id"]}', origin=hinge)
    q = gm.quad([(gx0, gy0, zc), (gx1, gy0, zc), (gx1, gy1, zc), (gx0, gy1, zc)], (0, 0, 1), 'MX_CorrGlass')
    orient(q, (0, 0, 1))
    GLASS_PENDING.append(gm)


def plate_on_leaf(leaf, dd, lmin, lmax, rid):
    """号室プレート(13×6.5cm)を扉板の廊下側・高さ 1.62m に。UV はアトラス(room_plates.json)。"""
    if rid not in PLATES:
        return
    u0, v0, u1, v1 = PLATES[rid]
    fx, fz = FACING_OUT[dd['facing']]
    y0, y1 = BASE_Y + 1.585, BASE_Y + 1.65
    hw = 0.065
    if dd['horiz']:
        face = (lmax[2] + 0.004) if fz > 0 else (lmin[2] - 0.004)
        cx = (lmin[0] + lmax[0]) / 2
        # 見る人の右 = up × n。n=(0,0,fz) → right = (fz, 0, 0)
        r = (fz, 0)
        pts = [(cx - r[0] * hw, y0, face), (cx + r[0] * hw, y0, face), (cx + r[0] * hw, y1, face), (cx - r[0] * hw, y1, face)]
    else:
        face = (lmax[0] + 0.004) if fx > 0 else (lmin[0] - 0.004)
        cz = (lmin[2] + lmax[2]) / 2
        r = (0, -fx)
        pts = [(face, y0, cz - r[1] * hw), (face, y0, cz + r[1] * hw), (face, y1, cz + r[1] * hw), (face, y1, cz - r[1] * hw)]
    f = leaf.quad(pts, (fx, 0, fz), 'M_RoomPlate')
    orient(f, (fx, 0, fz))
    set_uv(f, leaf, [(u0, v0), (u1, v0), (u1, v1), (u0, v1)])


def retint_by_zone(ob):
    """オブジェクトの各面の材質を、面の外側の空気の種類(ロビー=石・シアター=暗い壁…)に合わせる。"""
    me = ob.data
    names = [m.name for m in me.materials]
    if 'M_Wall' not in names:
        return
    mw = ob.matrix_world
    for poly in me.polygons:
        if me.materials[poly.material_index].name != 'M_Wall':
            continue
        c = mw @ poly.center
        n = (mw.to_3x3() @ poly.normal).normalized()
        gx, gy, gz = c.x + n.x * 0.03, c.z + n.z * 0.03, -(c.y + n.y * 0.03)
        zn = zone_at(gx, gz, gy, sets=('floor',))
        if not zn:
            continue
        want = wall_mat(zn['kind'])
        if want == 'M_Wall':
            continue
        if want not in names:
            me.materials.append(MATS[want]); names.append(want)
        poly.material_index = names.index(want)


# ---------------------------------------------------------------------------
# 風除室の透明ガラス(P3a-2 差し戻し「安っぽい」→ 写真 entrance_outside/windbreak の質)
#  ガラスは厚み 12mm の板: 表裏 = M_GlassClear(実行時は物理材質・ベイク対象外)、小口 = M_GlassEdge(薄い青緑)。
#  金物はヘアラインのステンレス(縦材 M_HairV・横材 M_HairH)。視認用の小さな四角いシール(M_Decal)を腰の高さに。
# ---------------------------------------------------------------------------
GLASS_T = 0.012
AUTO_H = 2.27         # 自動ドア・固定ガラスの上端(その上は天井までヘアラインの無目＝駆動ボックス)


def glass_slab(gl, ed, x0, x1, y0, y1, zc, t=GLASS_T):
    """z = zc を中心にした厚み t のガラス板。表裏は gl(M_GlassClear)、小口は ed(M_GlassEdge)へ。"""
    gl.box((x0, y0, zc - t / 2), (x1, y1, zc + t / 2), 'M_GlassClear', keep=lambda k, c, n: k in ('+z', '-z'))
    ed.box((x0, y0, zc - t / 2), (x1, y1, zc + t / 2), 'M_GlassEdge', keep=lambda k, c, n: k not in ('+z', '-z'))


def glass_decals(mb, xs, y, zc, t=GLASS_T, s=0.045):
    """ガラスの両面の視認シール(小さな正方形)。"""
    for x in xs:
        for sg in (1, -1):
            z = zc + sg * (t / 2 + 0.0006)
            orient(mb.quad([(x - s / 2, y, z), (x + s / 2, y, z), (x + s / 2, y + s, z), (x - s / 2, y + s, z)], (0, 0, sg), 'M_Decal'), (0, 0, sg))


def build_auto_door(dd, col, operable):
    """風除室の自動ドア(DESIGN §2.3: 透明ガラス2枚が左右反対方向へ開く)。
    扉板 = ガラス＋上下のヘアラインの框＋縦の細い框(左右別メッシュ。固定ガラスより 7.5cm 手前の面を滑る)。
    開口の上は天井までヘアラインの駆動ボックス、その下面中央に黒いセンサー(両面)。床に下部レール。"""
    px, pz = dd['pos']
    w = dd['width']
    rid = dd['id']
    y0 = BASE_Y
    H = AUTO_H
    lz = pz - 0.045                    # 扉板の面(固定ガラスは pz + 0.03)
    fr = MeshBuilder(f'AutoDoorFrame_{rid}')
    # 下部レール(床に埋めたガイド。扉板の走る範囲)
    fr.box((px - w + 0.02, y0, lz - 0.03), (px + w - 0.02, y0 + 0.004, lz + 0.03), 'M_HairH', keep=lambda k, c, n: k != '-y')
    # センサー(駆動ボックスの下、開口の中央・両面)と駆動ボックスのカバーの継ぎ目
    for sg in (1, -1):
        zf = pz + (0.09 if sg > 0 else -0.07)
        za, zb = sorted((zf, zf + sg * 0.03))
        fr.box((px - 0.13, y0 + H - 0.05, za), (px + 0.13, y0 + H, zb), 'M_Sensor', keep=lambda k, c, n: k != '+y')
        fr.box((px - 0.035, y0 + H - 0.058, min(za, zb) + 0.004), (px + 0.035, y0 + H - 0.05, max(za, zb) - 0.004), 'M_Decal', keep=lambda k, c, n: k == '-y')
    fr.finish(col, {'n2_kind': 'autoframe', 'n2_room': rid})
    for side, sgn in (('L', -1), ('R', 1)):
        mb = MeshBuilder(f'AutoDoor_{side}_{rid}')
        xa, xb = (px - w / 2, px) if sgn < 0 else (px, px + w / 2)
        xa += 0.006; xb -= 0.006
        st_w = 0.028
        # ガラス(縦框の間)
        gx0, gx1 = xa + st_w, xb - st_w
        mb.box((gx0, y0 + 0.07, lz - GLASS_T / 2), (gx1, y0 + H - 0.07, lz + GLASS_T / 2), 'M_GlassClear', keep=lambda k, c, n: k in ('+z', '-z'))
        mb.box((gx0, y0 + 0.07, lz - GLASS_T / 2), (gx1, y0 + H - 0.07, lz + GLASS_T / 2), 'M_GlassEdge', keep=lambda k, c, n: k in ('+y', '-y'))
        # 上下の框(ヘアライン横)・左右の縦框(ヘアライン縦)
        mb.box((xa, y0 + 0.012, lz - 0.016), (xb, y0 + 0.075, lz + 0.016), 'M_HairH')
        mb.box((xa, y0 + H - 0.075, lz - 0.016), (xb, y0 + H - 0.006, lz + 0.016), 'M_HairH')
        mb.box((xa, y0 + 0.075, lz - 0.014), (xa + st_w, y0 + H - 0.075, lz + 0.014), 'M_HairV')
        mb.box((xb - st_w, y0 + 0.075, lz - 0.014), (xb, y0 + H - 0.075, lz + 0.014), 'M_HairV')
        glass_decals(mb, [(gx0 + gx1) / 2 - 0.2, (gx0 + gx1) / 2 + 0.2], y0 + 0.95, lz)
        mb.finish(col, {'n2_kind': 'autodoor', 'n2_room': rid, 'n2_side': side, 'n2_slide': [float(sgn), 0.0, 0.0],
                        'n2_slide_dist': w / 2 - 0.03, 'n2_operable': 1 if operable else 0})
    return dict(id=rid, kind='auto', operable=operable)


def build_glass_line(x0, x1, z, door_x0, door_x1, col, name):
    """風除室の内外のガラスの線(x0..x1): 開口(door_x0..door_x1)の左右に固定ガラス、端と開口の脇にヘアラインの方立、
    下に沓摺(ヘアライン)、上は全幅のヘアラインの無目(駆動ボックスを兼ねる。天井まで)。"""
    y0 = BASE_Y
    fz = z + 0.03                      # 固定ガラスの面
    fr = MeshBuilder(name + '_frame'); gl = MeshBuilder(name + '_glass'); ed = MeshBuilder(name + '_edge'); dc = MeshBuilder(name + '_decal')
    # 無目(駆動ボックス)。全幅・天井まで。下面の継ぎ目
    fr.box((x0, y0 + AUTO_H, z - 0.07), (x1, y0 + CEIL_H, z + 0.09), 'M_HairH', keep=lambda k, c, n: k != '+y')
    fr.box((x0, y0 + AUTO_H - 0.004, z - 0.002), (x1, y0 + AUTO_H, z + 0.002), 'M_Sensor', keep=lambda k, c, n: k == '-y')
    for xa, xb in ((x0, door_x0), (door_x1, x1)):
        if xb - xa < 0.1:
            continue
        # 方立(端と開口の脇)
        fr.box((xa, y0, fz - 0.04), (xa + 0.05, y0 + AUTO_H, fz + 0.04), 'M_HairV')
        fr.box((xb - 0.05, y0, fz - 0.04), (xb, y0 + AUTO_H, fz + 0.04), 'M_HairV')
        # 沓摺(下の溝形)
        fr.box((xa + 0.05, y0, fz - 0.035), (xb - 0.05, y0 + 0.055, fz + 0.035), 'M_HairH', keep=lambda k, c, n: k != '-y')
        ga, gb = xa + 0.05, xb - 0.05
        glass_slab(gl, ed, ga, gb, y0 + 0.055, y0 + AUTO_H, fz)
        n = max(1, round((gb - ga) / 0.45))
        glass_decals(dc, [ga + (gb - ga) * (i + 0.5) / n for i in range(n)], y0 + 0.95, fz)
    fr.finish(col, {'n2_kind': 'glassframe'})
    gl.finish(col, {'n2_kind': 'glass'})
    ed.finish(col, {'n2_kind': 'glassedge'})
    dc.finish(col, {'n2_kind': 'decal'})


# ---------------------------------------------------------------------------
# EV(p0b_ev を使う)＋階数表示のアトラス・カゴの行き先ボタン
# ---------------------------------------------------------------------------
EV_BUTTONS = []

def fix_ev_display(rid):
    """P3b-A: 呼びパネルの階数表示の UV は 0..1 のまま(アトラス ev_display.png の1マス分)。
    どのマス(階・矢印)を出すかは実行時に elevator.js がテクスチャの repeat/offset で決める(カゴの現在地に追従)。"""
    return


def build_car_panel(dd):
    """カゴの左袖の操作盤(p0b の SUS 箱)の室内側の面に行き先ボタンの板。ボタンの世界座標を manifest へ。"""
    L = p0b_ev.Local(dd['pos'], dd['facing'], BASE_Y)
    cu, d0 = 0.78, 0.42
    u = -cu + 0.0125
    pd0, pd1, py0, py1 = d0 + 0.08, d0 + 0.28, 0.86, 1.56
    mb = MeshBuilder(f'EVCarPanel_{dd["id"]}')
    f = L.quad_side(mb, u, py0, py1, pd0, pd1, +1, 'M_CarPanel')
    # 見る人(左袖の壁を向く)の右 = 奥(+d)。テクスチャの u は奥へ増える(P3a 監査: 扉側へ増やしていて数字が鏡文字だった)
    uvs = []
    for loop in f.loops:
        co = loop.vert.co   # Blender 座標(x, -z, y)
        gx, gy, gz = co.x, co.z, -co.y
        dd_ = (gx - L.px) * L.fx + (gz - L.pz) * L.fz
        yy = gy - BASE_Y
        uvs.append(((dd_ - pd0) / (pd1 - pd0), (yy - py0) / (py1 - py0)))
    set_uv(f, mb, uvs)
    mb.finish(bpy.data.collections['P3a'], {'n2_kind': 'evcarpanel', 'n2_room': dd['id']})
    # P3b-A: 盤の上の黒い窓(テクスチャの 40..216 × 30..110 px)に階数表示の面を重ねる(アトラス ev_car_display.png)
    W_, H_ = CAR_PANEL['size']
    tu0, tu1 = 40 / W_, 216 / W_
    tv0, tv1 = 1 - 110 / H_, 1 - 30 / H_
    dmb = MeshBuilder(f'EVCarDisplay_{dd["id"]}')
    qd0, qd1 = pd0 + tu0 * (pd1 - pd0), pd0 + tu1 * (pd1 - pd0)
    qy0, qy1 = py0 + tv0 * (py1 - py0), py0 + tv1 * (py1 - py0)
    f2 = L.quad_side(dmb, u + 0.0015, qy0, qy1, qd0, qd1, +1, 'M_EVCarDisplay')
    uv2 = []
    for loop in f2.loops:
        co = loop.vert.co
        gx, gy, gz = co.x, co.z, -co.y
        dd_ = (gx - L.px) * L.fx + (gz - L.pz) * L.fz
        uv2.append(((dd_ - qd0) / (qd1 - qd0), (gy - BASE_Y - qy0) / (qy1 - qy0)))
    set_uv(f2, dmb, uv2)
    dmb.finish(bpy.data.collections['P3a'], {'n2_kind': 'evdisplay', 'n2_room': dd['id']})
    for k, (tu, tv) in CAR_PANEL['buttons'].items():
        d_ = pd0 + tu * (pd1 - pd0)
        y_ = py1 - tv * (py1 - py0)
        EV_BUTTONS.append(dict(floor=int(k), pos=[round(v, 4) for v in L.w(u + 0.005, y_, d_)]))


# ---------------------------------------------------------------------------
# 灯具・窓・非常口
# ---------------------------------------------------------------------------
def night_light_positions():
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
    # 同じ点(往復のパス)を除く
    uniq = []
    for p in out:
        if all(math.hypot(p[0] - q[0], p[1] - q[1]) > 1.0 for q in uniq):
            uniq.append(p)
    return uniq


def no_bake_emitter(ob):
    for k in ('visible_diffuse', 'visible_glossy', 'visible_transmission', 'visible_volume_scatter', 'visible_shadow'):
        setattr(ob, k, False)


def build_night_light(i, x, z, col):
    y = BASE_Y + CEIL_H
    hs, hh = 0.13, 0.035
    h = MeshBuilder(f'Lamp_{i}_housing')
    h.box((x - hs, y - hh, z - hs), (x + hs, y, z + hs), 'M_Plastic', keep=lambda k, c, n: k != '+y' and k != '-y')
    h.finish(col, {'n2_kind': 'lamp'})
    cv = MeshBuilder(f'Lamp_{i}_cover')
    s = hs - 0.015
    cv.quad([(x - s, y - hh - 0.002, z - s), (x + s, y - hh - 0.002, z - s), (x + s, y - hh - 0.002, z + s), (x - s, y - hh - 0.002, z + s)], (0, -1, 0), 'M_LampCover')
    cv.box((x - hs, y - hh, z - hs), (x + hs, y - hh + 0.001, z + hs), 'M_Plastic', keep=lambda k, c, n: k == '+y')
    no_bake_emitter(cv.finish(col, {'n2_kind': 'lampcover', 'n2_lamp': i}))
    ld = bpy.data.lights.new(f'NightLight_{i}', 'AREA')
    ld.shape = 'SQUARE'; ld.size = 2 * s
    ld.energy = float(ARGS.get('lamp_w', 1.6))
    ld.color = (0.74, 0.84, 1.0)
    lo = bpy.data.objects.new(f'NightLight_{i}', ld)
    lo.location = g2b(x, y - hh - 0.006, z)
    col.objects.link(lo)


def build_downlight(name, x, z, col, energy=1.4, y=None):
    y = (BASE_Y + CEIL_H - 0.002) if y is None else y
    trim = MeshBuilder(name + '_trim'); disc = MeshBuilder(name + '_lens')
    n = 20
    ro = [(x + 0.068 * math.cos(2 * math.pi * i / n), y, z + 0.068 * math.sin(2 * math.pi * i / n)) for i in range(n)]
    ri = [(x + 0.05 * math.cos(2 * math.pi * i / n), y - 0.001, z + 0.05 * math.sin(2 * math.pi * i / n)) for i in range(n)]
    for i in range(n):
        j = (i + 1) % n
        trim.quad([ro[i], ro[j], ri[j], ri[i]], (0, -1, 0), 'M_DownlightTrim')
    disc.quad(ri, (0, -1, 0), 'M_Downlight')
    for mbx in (trim, disc):
        for face in mbx.bm.faces:
            orient(face, (0, -1, 0))
    trim.finish(col, {'n2_kind': 'downlight'})
    no_bake_emitter(disc.finish(col, {'n2_kind': 'lampcover'}))
    ld = bpy.data.lights.new(name, 'AREA')
    ld.shape = 'DISK'; ld.size = 0.10; ld.energy = energy; ld.color = (1.0, 0.80, 0.60)
    lo = bpy.data.objects.new(name, ld)
    lo.location = g2b(x, y - 0.004, z)
    col.objects.link(lo)
    return (x, z)


def build_bracket(name, x, z, y, facing, col, energy=9.0, light_only=False):
    """屋外・階段室の壁付け灯(ブラケット)。facing=灯具が向く方向(壁から離れる向き)。"""
    nx, nz = FACING_OUT[{'N': 'N', 'S': 'S', 'E': 'E', 'W': 'W'}[facing]]
    if not light_only:
        mb = MeshBuilder(name + '_body'); cv = MeshBuilder(name + '_cover')
        w, h, dp = 0.11, 0.17, 0.09
        ax, az = (x, z)
        if nx != 0:
            x0, x1 = sorted((ax, ax + nx * dp)); z0, z1 = az - w / 2, az + w / 2
        else:
            z0, z1 = sorted((az, az + nz * dp)); x0, x1 = ax - w / 2, ax + w / 2
        mb.box((x0, y - h / 2, z0), (x1, y - h / 2 + 0.02, z1), 'M_SteelStruct')
        mb.box((x0, y + h / 2 - 0.02, z0), (x1, y + h / 2, z1), 'M_SteelStruct')
        mb.finish(bpy.data.collections['P3a'], {'n2_kind': 'bracket'})
        cv.box((x0 + 0.004, y - h / 2 + 0.02, z0 + 0.004), (x1 - 0.004, y + h / 2 - 0.02, z1 - 0.004), 'M_BracketCover',
               keep=lambda k, c, n: (n[0] * -nx + n[2] * -nz) < 0.5)
        no_bake_emitter(cv.finish(bpy.data.collections['P3a'], {'n2_kind': 'lampcover'}))
    ld = bpy.data.lights.new(name, 'POINT')
    ld.shadow_soft_size = 0.05; ld.energy = energy; ld.color = (1.0, 0.76, 0.50)
    lo = bpy.data.objects.new(name, ld)
    lo.location = g2b(x + nx * 0.06, y, z + nz * 0.06)
    col.objects.link(lo)
    return [x + nx * 0.06, y, z + nz * 0.06]


# ---------------------------------------------------------------------------
# 廊下端の窓(P3c-2: 外が見えるガラス。DESIGN §2.3)
#  外壁に本当の開口を抜く: 壁の室内の面(build の壁の面)と外の塊(build_rooms.build_massing)の両方に shell.windows の寸法の穴。
#  室内側 = ステンレスの額縁(見込み 5cm・ライトマップあり)、壁の厚みの中 = アルミの枠の見込み、ガラスの面 = 障子の框＋横桟 1 本、
#  外側 = 枠の見付け・水切り(外側の物は MX_* = ライトマップなし・実行時の月明かり＝外観と同じ見え方。外観の帯にも入る)。
#  ガラスは 1 枚の面(MX_CorrGlass、両面・ベイクせず光も遮らない)。開口の外に弱い青白い面光源(夜空・月の明かりが差す。ベイクだけ)
# ---------------------------------------------------------------------------
CW_CASE_W, CW_CASE_D = 0.04, 0.05     # 額縁の見付け・室内への出
CW_SASH = 0.03                        # 障子の框の見付け
CW_TRIM_W, CW_TRIM_E = 0.035, 0.02    # 外の枠の見付け・外への出
CW_SILL_E = 0.06                      # 水切りの外への出


def corr_window_geom(w, floor=None, base_y=None):
    """shell.windows の1つ → 開口の幾何。inner = 壁の室内の面、outer = 外壁(外の塊・屋上A の外壁)の面。
    s = 室内への向きの符号(沿う軸と直交する座標で)。d = inner から室内へ測った距離(外は負)。"""
    floor = floor or FLOOR
    base_y = BASE_Y if base_y is None else base_y
    x, z = w['pos']
    nx, nz = FACING_OUT[w['facing']]          # 室内側への法線
    horiz = nz != 0                           # 壁が z 一定の面(x に沿う)
    c, pl = (x, z) if horiz else (z, x)
    s = nz if horiz else nx
    hw = w['w'] / 2
    inner = pl
    for b in floor_wall_boxes(floor):
        if b['kind'] not in ('wall', 'solid'):
            continue
        bx0, bz0, bx1, bz1 = box_minmax(b)
        la0, la1, p0, p1 = (bx0, bx1, bz0, bz1) if horiz else (bz0, bz1, bx0, bx1)
        if la1 < c - hw + 0.01 or la0 > c + hw - 0.01 or not (p0 - 0.01 <= pl <= p1 + 0.01):
            continue
        inner = max(inner, p1) if s > 0 else min(inner, p0)
    fill = any((abs(az - bz) < 1e-6 and horiz and abs(az - pl) < 0.01 and min(ax, bx) - 0.01 <= c <= max(ax, bx) + 0.01) or
               (abs(ax - bx) < 1e-6 and not horiz and abs(ax - pl) < 0.01 and min(az, bz) - 0.01 <= c <= max(az, bz) + 0.01)
               for (ax, az, bx, bz) in floor.get('fillWalls', []))
    outer = pl - s * (WALL_T / 2 if fill else 0.03)   # 屋上A に面する 4F の北(フィラー壁の外の面)／外周(外の塊は外周の線の 3cm 外)
    y0 = base_y + w['sill']
    return dict(horiz=horiz, s=s, c=c, a0=c - hw, a1=c + hw, y0=y0, y1=y0 + w['h'], inner=inner, outer=outer,
                D=abs(inner - outer), pl=pl, nin=(nx, nz))


def _cw_pt(g, a, y, d):
    q = g['inner'] + g['s'] * d
    return (a, y, q) if g['horiz'] else (q, y, a)


def _cw_box(mb, g, a0, a1, y0, y1, d0, d1, mat, skip=()):
    """沿う軸 a・高さ y・室内への距離 d で指定する箱。skip = 張らない面('in'=室内向き, 'out'=外向き, 'a-','a+','y-','y+')。"""
    p0, p1 = _cw_pt(g, a0, y0, d0), _cw_pt(g, a1, y1, d1)
    mn = tuple(min(p0[k], p1[k]) for k in range(3)); mx = tuple(max(p0[k], p1[k]) for k in range(3))
    ax_ = 'x' if g['horiz'] else 'z'
    nk = 'z' if g['horiz'] else 'x'
    sin = ('+' if g['s'] > 0 else '-') + nk
    sout = ('-' if g['s'] > 0 else '+') + nk
    names = {'in': sin, 'out': sout, 'a-': '-' + ax_, 'a+': '+' + ax_, 'y-': '-y', 'y+': '+y'}
    kill = {names[k] for k in skip}
    mb.box(mn, mx, mat, keep=lambda k, c_, n_: k not in kill)


def _cw_quad(mb, g, pts_adw, n_adw, mat):
    """(a, y, d) の点列と法線(沿う軸 a・y・室内 d の成分)で面を張る。"""
    pts = [_cw_pt(g, a, y, d) for (a, y, d) in pts_adw]
    na, ny, nd = n_adw
    n = (na, ny, nd * g['s']) if g['horiz'] else (nd * g['s'], ny, na)
    return orient(mb.quad(pts, n, mat), n)


def build_window(w, i, col):
    g = corr_window_geom(w)
    A0, A1, Y0, Y1, D = g['a0'], g['a1'], g['y0'], g['y1'], g['D']
    f, cd = CW_CASE_W, CW_CASE_D
    # 室内側の額縁(ステンレス・ライトマップあり)。壁に付く背面は張らない
    fr = MeshBuilder(f'Window_{i}_frame')
    _cw_box(fr, g, A0 - f, A0, Y0 - f, Y1 + f, 0, cd, 'M_Stainless', skip=('out',))
    _cw_box(fr, g, A1, A1 + f, Y0 - f, Y1 + f, 0, cd, 'M_Stainless', skip=('out',))
    _cw_box(fr, g, A0, A1, Y1, Y1 + f, 0, cd, 'M_Stainless', skip=('out', 'a-', 'a+'))
    _cw_box(fr, g, A0 - f - 0.02, A1 + f + 0.02, Y0 - f, Y0, 0, cd + 0.02, 'M_Stainless', skip=('out',))   # 下枠(額縁の膳板)
    fr.finish(col, {'n2_kind': 'window'})
    # 壁の厚みの中(アルミの枠の見込み)・障子の框と横桟・外の枠・水切り(MX_CorrAlu: ライトマップなし。外観の帯にも入る)
    ot = MeshBuilder(f'Window_{i}_out')
    dg = -min(0.015, D / 2)                  # ガラスの面
    _cw_quad(ot, g, [(A0, Y0, 0), (A0, Y0, -D), (A0, Y1, -D), (A0, Y1, 0)], (1, 0, 0), 'MX_CorrAlu')
    _cw_quad(ot, g, [(A1, Y0, 0), (A1, Y0, -D), (A1, Y1, -D), (A1, Y1, 0)], (-1, 0, 0), 'MX_CorrAlu')
    _cw_quad(ot, g, [(A0, Y1, 0), (A1, Y1, 0), (A1, Y1, -D), (A0, Y1, -D)], (0, -1, 0), 'MX_CorrAlu')
    _cw_quad(ot, g, [(A0, Y0, 0), (A1, Y0, 0), (A1, Y0, -D), (A0, Y0, -D)], (0, 1, 0), 'MX_CorrAlu')
    sw, st = CW_SASH, 0.0175
    _cw_box(ot, g, A0, A0 + sw, Y0, Y1, dg - st, dg + st, 'MX_CorrAlu', skip=('a-', 'y-', 'y+'))
    _cw_box(ot, g, A1 - sw, A1, Y0, Y1, dg - st, dg + st, 'MX_CorrAlu', skip=('a+', 'y-', 'y+'))
    _cw_box(ot, g, A0 + sw, A1 - sw, Y1 - sw, Y1, dg - st, dg + st, 'MX_CorrAlu', skip=('a-', 'a+', 'y+'))
    _cw_box(ot, g, A0 + sw, A1 - sw, Y0, Y0 + sw + 0.012, dg - st, dg + st, 'MX_CorrAlu', skip=('a-', 'a+', 'y-'))
    ym = (Y0 + Y1) / 2
    _cw_box(ot, g, A0 + sw, A1 - sw, ym - 0.014, ym + 0.014, dg - st, dg + st, 'MX_CorrAlu', skip=('a-', 'a+'))   # 横桟
    e, tw = CW_TRIM_E, CW_TRIM_W
    _cw_box(ot, g, A0 - tw, A0, Y0, Y1 + tw, -D - e, -D, 'MX_CorrAlu', skip=('in',))
    _cw_box(ot, g, A1, A1 + tw, Y0, Y1 + tw, -D - e, -D, 'MX_CorrAlu', skip=('in',))
    _cw_box(ot, g, A0, A1, Y1, Y1 + tw, -D - e, -D, 'MX_CorrAlu', skip=('in', 'a-', 'a+'))
    # 水切り(下枠の外。少し外へ出して下に垂れの小口)
    _cw_box(ot, g, A0 - tw - 0.02, A1 + tw + 0.02, Y0 - 0.022, Y0, -D - CW_SILL_E, -D, 'MX_CorrAlu', skip=('in',))
    _cw_box(ot, g, A0 - tw - 0.02, A1 + tw + 0.02, Y0 - 0.04, Y0 - 0.022, -D - CW_SILL_E, -D - CW_SILL_E + 0.008, 'MX_CorrAlu', skip=('in', 'y+'))
    ot.finish(col, {'n2_kind': 'corrwinout', 'n2_lm': 0})
    # ガラス(1枚・両面は実行時の材質)。ベイク対象外(bake.CLEAR_KINDS)
    gl = MeshBuilder(f'Window_{i}_glass')
    _cw_quad(gl, g, [(A0 + sw, Y0 + sw, dg), (A1 - sw, Y0 + sw, dg), (A1 - sw, Y1 - sw, dg), (A0 + sw, Y1 - sw, dg)], (0, 0, 1), 'MX_CorrGlass')
    gl.finish(col, {'n2_kind': 'corrglass', 'n2_lm': 0})
    # 開口から差す夜空・月の明かり(ベイクだけ。開口の外に室内向きの弱い青白い面光源)
    nx, nz = g['nin']
    ld = bpy.data.lights.new(f'WinSky_{i}', 'AREA')
    ld.shape = 'RECTANGLE'; ld.size = A1 - A0; ld.size_y = Y1 - Y0
    ld.energy = float(ARGS.get('win_sky', 0.8)); ld.color = (0.62, 0.72, 1.0)
    lo = bpy.data.objects.new(f'WinSky_{i}', ld)
    lo.location = g2b(*_cw_pt(g, (A0 + A1) / 2, (Y0 + Y1) / 2, -D - 0.05))
    lo.rotation_mode = 'QUATERNION'
    dir_b = Vector((nx, -nz, 0.0))
    lo.rotation_quaternion = dir_b.to_track_quat('-Z', 'Y')
    col.objects.link(lo)
    return [w['pos'][0] + nx * 0.2, Y0 + w['h'] / 2, w['pos'][1] + nz * 0.2]


def window_holes_on_face(windows, axis, plane, nsgn):
    """壁の面(axis='x' なら x=plane の面、法線の符号 nsgn)に開ける窓の穴 [(a0, a1, y0, y1)]。
    面が開口の室内の面〜外の面の間にある時だけ(重なった壁の箱の奥の面にも開ける)。"""
    out = []
    for g in windows:
        if (axis == 'z') != g['horiz']:
            continue
        lo, hi = min(g['inner'], g['outer']) - 0.005, max(g['inner'], g['outer']) + 0.005
        if lo <= plane <= hi:
            out.append((g['a0'], g['a1'], g['y0'], g['y1']))
    return out


def build_exit_sign(i, x, z, nrm, col, above=2.06):
    """非常口サイン(内照式・正方形)。(x,z)=扉の中心(壁の芯)、nrm=サインが向く方向。壁の面から出す。"""
    nx, nz = nrm
    B = BASE_Y
    w2, y0s, y1s, t = 0.16, B + above, B + above + 0.30, 0.07
    body = MeshBuilder(f'ExitSign_{i}_body'); face = MeshBuilder(f'ExitSign_{i}_face')
    wf = WALL_T / 2
    if nx != 0:
        sx = x + nx * wf
        xa, xb = sorted((sx, sx + nx * t))
        body.box((xa, y0s, z - w2), (xb, y1s, z + w2), 'M_Plastic', keep=lambda k, c, n: n[0] * nx < 0.5)
        xs = sx + nx * (t + 0.001)
        pts = [(xs, y0s + 0.012, z - w2 + 0.012), (xs, y0s + 0.012, z + w2 - 0.012), (xs, y1s - 0.012, z + w2 - 0.012), (xs, y1s - 0.012, z - w2 + 0.012)]
        fq = orient(face.quad(pts, (nx, 0, 0), 'M_ExitSignSq'), (nx, 0, 0))
        rgt = (0, -nx)   # 見る人の右(z 方向の符号)
        uvs = [((0 if rgt[1] > 0 else 1), 0), ((1 if rgt[1] > 0 else 0), 0), ((1 if rgt[1] > 0 else 0), 1), ((0 if rgt[1] > 0 else 1), 1)]
    else:
        sz = z + nz * wf
        za, zb = sorted((sz, sz + nz * t))
        body.box((x - w2, y0s, za), (x + w2, y1s, zb), 'M_Plastic', keep=lambda k, c, n: n[2] * nz < 0.5)
        zs = sz + nz * (t + 0.001)
        pts = [(x - w2 + 0.012, y0s + 0.012, zs), (x + w2 - 0.012, y0s + 0.012, zs), (x + w2 - 0.012, y1s - 0.012, zs), (x - w2 + 0.012, y1s - 0.012, zs)]
        fq = orient(face.quad(pts, (0, 0, nz), 'M_ExitSignSq'), (0, 0, nz))
        rgt = (nz, 0)
        uvs = [((0 if rgt[0] > 0 else 1), 0), ((1 if rgt[0] > 0 else 0), 0), ((1 if rgt[0] > 0 else 0), 1), ((0 if rgt[0] > 0 else 1), 1)]
    # 頂点順に合わせて UV を割り当て(面の頂点のゲーム座標から計算)
    lp = []
    for loop in fq.loops:
        co = loop.vert.co
        gx, gy, gz = co.x, co.z, -co.y
        along = (gx * rgt[0] + gz * rgt[1])
        lp.append((along, gy))
    amin = min(a for a, _ in lp); amax = max(a for a, _ in lp)
    set_uv(fq, face, [((a - amin) / (amax - amin), 1.0 if yy > (y0s + y1s) / 2 else 0.0) for a, yy in lp])
    body.finish(col, {'n2_kind': 'exitsign'})
    face.finish(col, {'n2_kind': 'exitsign_face'})
    return [x + nx * 0.2, (y0s + y1s) / 2, z + nz * 0.2]


# ---------------------------------------------------------------------------
# 手すり(縦格子)
# ---------------------------------------------------------------------------
def railing(mb, a, b, h=1.1, spacing=0.12, bar=0.018, mat='M_Rail'):
    """a=(x,y,z), b=(x,y,z) の線(床の高さ)に沿った縦格子の手すり。傾斜(階段)も可。"""
    ax, ay, az = a; bx, by, bz = b
    L = math.hypot(bx - ax, bz - az)
    if L < 0.05:
        return
    n = max(1, int(L / spacing))
    hb = bar / 2
    for i in range(n + 1):
        t = i / n
        x, y, z = ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t
        mb.box((x - hb, y + 0.04, z - hb), (x + hb, y + h - 0.02, z + hb), mat, keep=lambda k, c, nn: k not in ('+y', '-y'))
    # 笠木と下桟(傾斜は 4 点の帯で)
    for (yy, th) in ((h, 0.045), (0.06, 0.03)):
        ux, uz = (bx - ax) / L, (bz - az) / L
        px, pz = -uz * th / 2, ux * th / 2
        p = [(ax + px, ay + yy, az + pz), (bx + px, by + yy, bz + pz), (bx - px, by + yy, bz - pz), (ax - px, ay + yy, az - pz)]
        top = [(q[0], q[1] + 0.008, q[2]) for q in p]
        mb.poly(top, (0, 1, 0), mat)
        mb.poly(p, (0, -1, 0), mat)
        for (q0, q1) in ((p[0], p[1]), (p[3], p[2])):
            side = [q0, q1, (q1[0], q1[1] + 0.008, q1[2]), (q0[0], q0[1] + 0.008, q0[2])]
            sn = (px / (th / 2), 0, pz / (th / 2)) if q0 is p[0] else (-px / (th / 2), 0, -pz / (th / 2))
            mb.poly(side, sn, mat)


# ---------------------------------------------------------------------------
# 階段(外階段=鉄骨・縞鋼板 / 北階段=屋内)
# ---------------------------------------------------------------------------
def stair_world(st, s, c, y):
    """階段の局所(流れ方向 s・横方向 c)→ ゲーム(x, y, z)。"""
    return (s, y, c) if st['geom']['axis'] == 'x' else (c, y, s)


def stair_box(mb, st, s0, s1, c0, c1, y0, y1, mat, keep=None):
    a = stair_world(st, min(s0, s1), min(c0, c1), y0)
    b = stair_world(st, max(s0, s1), max(c0, c1), y1)
    mb.box((min(a[0], b[0]), y0, min(a[2], b[2])), (max(a[0], b[0]), y1, max(a[2], b[2])), mat, keep=keep)


def build_flight(mb, st, lane, s_from, s_to, y_from, mat_tread, mat_str):
    """1折れ分(踏面 treads 枚)。s_from(高さ y_from)から s_to(高さ y_from+rise)へ。"""
    g = st['geom']
    n = g['treads']; rise = g['rise']; h = rise / (n + 1)
    c0, c1 = lane
    ds = (s_to - s_from) / n
    for i in range(1, n + 1):
        sa = s_from + ds * (i - 1); sb = s_from + ds * i
        ytop = y_from + h * i
        stair_box(mb, st, sa, sb, c0 + 0.02, c1 - 0.02, ytop - 0.035, ytop, mat_tread)
    # ささら桁(側板・両側)
    for c in (c0, c1):
        p0 = stair_world(st, s_from, c, y_from - 0.28); p1 = stair_world(st, s_to, c, y_from + rise - 0.28)
        p2 = stair_world(st, s_to, c, y_from + rise + 0.02); p3 = stair_world(st, s_from, c, y_from + 0.02)
        nrm = (0, 0, 1) if g['axis'] == 'x' else (1, 0, 0)
        mb.poly([p0, p1, p2, p3], nrm, mat_str)
        mb.poly([p3, p2, p1, p0], (-nrm[0], 0, -nrm[2]), mat_str)
        # 桁の下端(見上げ)
        q0 = stair_world(st, s_from, c - 0.006, y_from - 0.28); q1 = stair_world(st, s_to, c - 0.006, y_from + rise - 0.28)
        q2 = stair_world(st, s_to, c + 0.006, y_from + rise - 0.28); q3 = stair_world(st, s_from, c + 0.006, y_from - 0.28)
        mb.poly([q0, q1, q2, q3], (0, -1, 0), mat_str)


def build_external_stair(col):
    """外階段(main)の、この階の踊り場から1つ上の踊り場までの鉄骨。7F は屋上B の踊り場まで。屋上B の踊り場も 7F に含める。"""
    st = STAIRS['main']; g = st['geom']
    x0, z0, w, d = st['pos'] + st['size']
    lx0, lz0, lw, ld = g['landing']
    mx0, mz0, mw, md = g['mid']
    up, dn = g['lanes']['up'], g['lanes']['down']
    rise = g['rise']
    mb = MeshBuilder('ExtStair_steel'); dk = MeshBuilder('ExtStair_deck'); rl = MeshBuilder('ExtStair_rail')
    levels = [(LEVEL, BASE_Y)]
    if LEVEL == MAX_LEVEL and ROOFB:
        levels.append(('RB', ROOFB['y']))
    for lvkey, by in levels:
        # 踊り場(縞鋼板の床・下面は鉄)
        dk.box((lx0, by - 0.04, lz0), (lx0 + lw, by, lz0 + ld), 'M_Deck', keep=lambda k, c, n: k == '+y')
        mb.box((lx0, by - 0.20, lz0), (lx0 + lw, by - 0.04, lz0 + ld), 'M_SteelStruct', keep=lambda k, c, n: k != '+y')
        # 踊り場の外側の手すり(西 x=2.6、建物の無い北側)
        railing(rl, (lx0 + 0.03, by, lz0 + 0.03), (lx0 + 0.03, by, lz0 + ld), h=1.1)
        behind_n = in_footprint(lx0 + lw / 2, lz0 - 0.3, FLOOR['footprint'], skip=[x0, z0, w, d]) and lvkey != 'RB'
        if not behind_n:
            railing(rl, (lx0 + 0.03, by, lz0 + 0.03), (lx0 + lw, by, lz0 + 0.03), h=1.1)
    top = LEVEL == MAX_LEVEL and not ROOFB
    if not top:
        # 上り: 西レーン(踊り場→中間踊り場)、続けて東レーン(中間踊り場→上の階の踊り場)
        build_flight(dk, st, up, lz0 + ld, mz0, BASE_Y, 'M_Deck', 'M_SteelStruct')
        dk.box((mx0, BASE_Y + rise - 0.04, mz0), (mx0 + mw, BASE_Y + rise, mz0 + md), 'M_Deck', keep=lambda k, c, n: k == '+y')
        mb.box((mx0, BASE_Y + rise - 0.20, mz0), (mx0 + mw, BASE_Y + rise - 0.04, mz0 + md), 'M_SteelStruct', keep=lambda k, c, n: k != '+y')
        build_flight(dk, st, dn, mz0, lz0 + ld, BASE_Y + rise, 'M_Deck', 'M_SteelStruct')
        # 手すり: 上りの外側(西)・中間踊り場の外周・2本のレーンの間
        yb = BASE_Y
        railing(rl, (up[0] + 0.03, yb + 0.18, lz0 + ld), (up[0] + 0.03, yb + rise + 0.18, mz0), h=0.95)
        railing(rl, (mx0 + 0.03, yb + rise, mz0), (mx0 + 0.03, yb + rise, mz0 + md - 0.03), h=1.1)
        railing(rl, (mx0 + 0.03, yb + rise, mz0 + md - 0.03), (mx0 + mw, yb + rise, mz0 + md - 0.03), h=1.1)
        if not in_footprint(mx0 + mw + 0.3, mz0 + md - 0.2, FLOOR['footprint']):
            railing(rl, (mx0 + mw - 0.03, yb + rise, mz0 + md - 0.4), (mx0 + mw - 0.03, yb + rise, mz0 + md - 0.03), h=1.1)
        cmid = (up[1] + dn[0]) / 2
        railing(rl, (cmid, yb + 0.18, lz0 + ld), (cmid, yb + rise + 0.18, mz0), h=0.95)
        railing(rl, (cmid, yb + 2 * rise + 0.18, lz0 + ld), (cmid, yb + rise + 0.18, mz0), h=0.95)
    if LEVEL == 1:
        # 地上: 東レーンの下(下り口)は地面。門扉代わりの低い手すりで塞ぐ(外構は P3c)
        dk.box((x0, -0.02, lz0 + ld), (x0 + w, 0.0, z0 + d), 'M_ExtWall', keep=lambda k, c, n: k == '+y')
        railing(rl, (dn[0], 0.0, lz0 + ld + 0.3), (dn[1], 0.0, lz0 + ld + 0.3), h=1.1)
    # 柱(H形鋼の代わりに角柱)。階高いっぱい
    ytop = BASE_Y + FLOOR_H + (FLOOR_H if (LEVEL == MAX_LEVEL and ROOFB) else 0)
    for (cx, cz) in ((x0 + 0.08, z0 + 0.08), (x0 + 0.08, z0 + d - 0.08), (x0 + w - 0.08, z0 + d - 0.08)):
        mb.box((cx - 0.075, BASE_Y - 0.2, cz - 0.075), (cx + 0.075, ytop, cz + 0.075), 'M_SteelStruct', keep=lambda k, c, n: k not in ('+y', '-y'))
    mb.finish(col, {'n2_kind': 'stair_steel'})
    dk.finish(col, {'n2_kind': 'stair_deck'})
    rl.finish(col, {'n2_kind': 'rail'})
    # ベイク専用の遮蔽: 上の階の踊り場の床(この階の踊り場の天井になる)
    if LEVEL < MAX_LEVEL or ROOFB:
        oc = MeshBuilder('Occ_upper_landing')
        yy = BASE_Y + FLOOR_H
        oc.box((lx0, yy - 0.20, lz0), (lx0 + lw, yy, lz0 + ld), 'M_SteelStruct')
        oc.finish(col, {'n2_kind': 'occluder'}, bake_only=True)


def build_north_stair(col):
    """北階段(P3a-2: 屋外の鉄骨。主外階段と同じ部品=縞鋼板・角柱・縦格子・壁付け灯)。流れは東西(x)。
    この階の踊り場→上りレーン(南)→中間踊り場→下りレーン(北)→上の階の踊り場まで。1F の踊り場は地面(暗い舗装)、
    3F(最上階)は上りレーンの先が吹き抜け(縁に手すり)。2F・3F は鉄扉の外の屋外通路(build_gallery)。"""
    st = STAIRS['north']; g = st['geom']
    x0, z0, w, d = st['pos'] + st['size']
    lx0, lz0, lw, ld = g['landing']
    mx0, mz0, mw, md = g['mid']
    up, dn = g['lanes']['up'], g['lanes']['down']
    rise = g['rise']; s0, s1 = g['s0'], g['s1']
    lo, hi = st['levels']
    y = BASE_Y
    mb = MeshBuilder('NorthStair_steel'); dk = MeshBuilder('NorthStair_deck'); rl = MeshBuilder('NorthStair_rail')
    if LEVEL == lo:
        # 地面(暗い舗装)。歩けるのは踊り場の下だけ(周りは低い柵と闇)
        gr = MeshBuilder('NorthGround')
        orient(gr.quad([(x0, y, z0 + d), (x0 + w, y, z0 + d), (x0 + w, y, z0), (x0, y, z0)], (0, 1, 0), 'M_Paving'), (0, 1, 0))   # P3c: 箱の範囲だけ(周りは敷地の外構)
        gr.finish(col, {'n2_kind': 'ground'})
        railing(rl, (x0 + 0.05, y, z0 + 0.03), (s0 + 0.3, y, z0 + 0.03), h=0.9, spacing=0.15)
        railing(rl, (x0 + 0.05, y, z0 + d - 0.03), (s0 + 0.3, y, z0 + d - 0.03), h=0.9, spacing=0.15)
        railing(rl, (s0 + 0.3, y, dn[0]), (s0 + 0.3, y, dn[1]), h=0.9, spacing=0.15)     # 下りレーンの下(頭上に段)
    else:
        dk.box((lx0, y - 0.04, lz0), (lx0 + lw, y, lz0 + ld), 'M_Deck', keep=lambda k, c, n: k == '+y')
        mb.box((lx0, y - 0.20, lz0), (lx0 + lw, y - 0.04, lz0 + ld), 'M_SteelStruct', keep=lambda k, c, n: k != '+y')
        railing(rl, (lx0, y, lz0 + 0.03), (lx0 + lw, y, lz0 + 0.03), h=1.1)
        railing(rl, (lx0, y, lz0 + ld - 0.03), (lx0 + lw, y, lz0 + ld - 0.03), h=1.1)
    if LEVEL < hi:
        build_flight(dk, st, up, s0, s1, y, 'M_Deck', 'M_SteelStruct')
        dk.box((mx0, y + rise - 0.04, mz0), (mx0 + mw, y + rise, mz0 + md), 'M_Deck', keep=lambda k, c, n: k == '+y')
        mb.box((mx0, y + rise - 0.20, mz0), (mx0 + mw, y + rise - 0.04, mz0 + md), 'M_SteelStruct', keep=lambda k, c, n: k != '+y')
        build_flight(dk, st, dn, s1, s0, y + rise, 'M_Deck', 'M_SteelStruct')
        # 手すり: 上り(南)の外側・下り(北)の外側・中間踊り場の外周・2本のレーンの間
        railing(rl, (s0, y + 0.18, up[1] + 0.06), (s1, y + rise + 0.18, up[1] + 0.06), h=0.95)
        railing(rl, (s0, y + 2 * rise + 0.18, dn[0] - 0.06), (s1, y + rise + 0.18, dn[0] - 0.06), h=0.95)
        railing(rl, (mx0, y + rise, mz0 + 0.03), (mx0 + mw - 0.03, y + rise, mz0 + 0.03), h=1.1)
        railing(rl, (mx0 + mw - 0.03, y + rise, mz0 + 0.03), (mx0 + mw - 0.03, y + rise, mz0 + md - 0.03), h=1.1)
        railing(rl, (mx0, y + rise, mz0 + md - 0.03), (mx0 + mw - 0.03, y + rise, mz0 + md - 0.03), h=1.1)
        cmid = (dn[1] + up[0]) / 2
        railing(rl, (s0, y + 0.18, cmid), (s1, y + rise + 0.18, cmid), h=0.95)
        railing(rl, (s0, y + 2 * rise + 0.18, cmid), (s1, y + rise + 0.18, cmid), h=0.95)
        # ベイク専用の遮蔽: 上の階の踊り場の床
        oc = MeshBuilder('Occ_north_upper')
        oc.box((lx0, y + FLOOR_H - 0.20, lz0), (lx0 + lw, y + FLOOR_H, lz0 + ld), 'M_SteelStruct')
        oc.finish(col, {'n2_kind': 'occluder'}, bake_only=True)
    else:
        railing(rl, (s0, y, up[0] - 0.05), (s0, y, up[1] + 0.06), h=1.1)
    # 柱(角柱): 箱の東の2隅と踊り場の東の2隅。この階の床から上の階の床まで(最上階は手すりの高さまで)
    ytop = y + (FLOOR_H if LEVEL < hi else 1.15)
    ybot = y - (0.0 if LEVEL == lo else 0.2)
    for (cx, cz) in ((x0 + w - 0.08, z0 + 0.08), (x0 + w - 0.08, z0 + d - 0.08), (s0, z0 + 0.06), (s0, z0 + d - 0.06)):
        mb.box((cx - 0.06, ybot, cz - 0.06), (cx + 0.06, ytop, cz + 0.06), 'M_SteelStruct', keep=lambda k, c, n: k not in ('+y', '-y'))
    mb.finish(col, {'n2_kind': 'stair_steel'})
    dk.finish(col, {'n2_kind': 'stair_deck'})
    rl.finish(col, {'n2_kind': 'rail'})


def build_gallery(col):
    """北階段へ出る屋外通路(2F・3F: 鉄扉の外、213/313 の北)。北側はコンクリートの腰壁(手すり壁)、
    2F は上(3F の通路の床スラブ)の下面を天井に。"""
    a = next((a for a in SHELL['air'] if a['id'] == 'nst_gallery'), None)
    if not a:
        return
    gx0, gz0, gw, gd = a['rect']
    y = BASE_Y
    pm = MeshBuilder('Gallery_parapet')
    pm.box((gx0 + 0.06, y - 0.25, gz0 - 0.12), (gx0 + gw, y + 1.1, gz0 + 0.06), 'M_ExtWall', keep=lambda k, c, n: k != '-y' and k != '+x')
    pm.box((gx0 + 0.06, y + 1.1, gz0 - 0.10), (gx0 + gw, y + 1.13, gz0 + 0.05), 'M_SteelStruct', keep=lambda k, c, n: k != '-y')   # 笠木
    if LEVEL < STAIRS['north']['levels'][1]:
        orient(pm.quad([(gx0, y + FLOOR_H - 0.2, gz0), (gx0 + gw, y + FLOOR_H - 0.2, gz0), (gx0 + gw, y + FLOOR_H - 0.2, gz0 + gd), (gx0, y + FLOOR_H - 0.2, gz0 + gd)], (0, -1, 0), 'M_ExtWall'), (0, -1, 0))
    pm.finish(col, {'n2_kind': 'parapet'})


B1_LIGHTS = []

def build_basement_stair(col):
    """地下への階段(P3a-2 異世界要素): 1F 食堂奥の踊り場から1層下りて、地下の踊り場(B1)の西壁に施錠された鉄扉。
    館内と同じ仕上げ(クロス・長尺シート)だが、下るほど灯りが減る(中間踊り場に弱い壁付け灯、B1 は消えかけの小さな灯りだけ)。
    1F の床から上(踊り場・吹き抜けの 1F 部分)は通常の壁の生成(zone 'room'/'bwell')。ここは 1F の床より下。"""
    st = STAIRS['basement']; g = st['geom']
    x0, z0, w, d = st['pos'] + st['size']
    s0, s1 = g['s0'], g['s1']; rise = g['rise']
    up, dn = g['lanes']['up'], g['lanes']['down']
    mx0, mz0, mw, md = g['mid']
    yb = BASEMENT['y']
    T2 = WALL_T / 2
    ix0, ix1, iz0, iz1 = x0 + T2, x0 + w - T2, z0 + T2, z0 + d - T2
    wl = MeshBuilder('BStair_walls'); fl = MeshBuilder('BStair_floor'); sp = MeshBuilder('BStair_steps'); rl = MeshBuilder('BStair_rail')
    room = BASEMENT['rooms'][0]
    dz = room['door']['pos'][1]
    dh = DOOR_W / 2
    yt = BASE_Y                      # 1F の床(この上は 1F の壁)
    yc = yb + B1_HEAD                # B1 の天井(1F の踊り場の床スラブの下面)
    W = 'M_WallDamp'
    def q(pts, n, mat, mbx=wl):
        orient(mbx.quad(pts, n, mat), n)
    q([(ix0, yb, iz0), (ix1, yb, iz0), (ix1, yt, iz0), (ix0, yt, iz0)], (0, 0, 1), W)          # 北
    q([(ix1, yb, iz1), (ix0, yb, iz1), (ix0, yt, iz1), (ix1, yt, iz1)], (0, 0, -1), W)         # 南
    q([(ix1, yb, iz0), (ix1, yb, iz1), (ix1, yt, iz1), (ix1, yt, iz0)], (-1, 0, 0), W)         # 東
    q([(ix0, yb, iz0), (ix0, yb, dz - dh), (ix0, yt, dz - dh), (ix0, yt, iz0)], (1, 0, 0), W)  # 西(扉の左右と上)
    q([(ix0, yb, dz + dh), (ix0, yb, iz1), (ix0, yt, iz1), (ix0, yt, dz + dh)], (1, 0, 0), W)
    q([(ix0, yc, dz - dh), (ix0, yc, dz + dh), (ix0, yt, dz + dh), (ix0, yt, dz - dh)], (1, 0, 0), W)
    # 幅木(B1 の踊り場)
    for (a_, b_) in ((iz0, dz - dh), (dz + dh, iz1)):
        wl.box((ix0, yb, a_), (ix0 + 0.012, yb + 0.06, b_), 'M_Baseboard', keep=lambda k, c, n: k in ('+x', '+y'))
    wl.box((ix0, yb, iz0), (s0, yb + 0.06, iz0 + 0.012), 'M_Baseboard', keep=lambda k, c, n: k in ('+z', '+y'))
    wl.box((ix0, yb, iz1 - 0.012), (s0, yb + 0.06, iz1), 'M_Baseboard', keep=lambda k, c, n: k in ('-z', '+y'))
    # B1 の踊り場の床・天井(1F の踊り場のスラブの下面)・スラブの見付け
    q([(ix0, yb, iz1), (s0, yb, iz1), (s0, yb, iz0), (ix0, yb, iz0)], (0, 1, 0), 'M_FloorDamp', fl)
    q([(ix0, yc, iz0), (s0, yc, iz0), (s0, yc, iz1), (ix0, yc, iz1)], (0, -1, 0), 'M_PaintWall', fl)
    q([(s0, yc, iz0), (s0, yc, iz1), (s0, yt, iz1), (s0, yt, iz0)], (1, 0, 0), 'M_PaintWall', fl)
    # 下りレーン(北)の下は物入れの壁で塞ぐ(B1 から段の裏が見えないように)。レーンの間は背骨の壁
    cm0, cm1 = dn[1], up[0]
    q([(s0, yb, iz0), (s0, yb, cm1), (s0, yc, cm1), (s0, yc, iz0)], (-1, 0, 0), W)
    q([(s0, yb, cm1), (s1, yb, cm1), (s1, yb + rise, cm1), (s0, yt, cm1)], (0, 0, 1), W)       # 背骨の南面(上りレーン側)
    q([(s0, yt, cm0), (s1, yb + rise, cm0), (s1, yb + rise, cm1), (s0, yt, cm1)], (0, 1, 0), 'M_PaintWall')   # 背骨の上面(下りの段の脇)
    # 中間踊り場(床と下のスラブ)
    q([(mx0, yb + rise, iz1), (ix1, yb + rise, iz1), (ix1, yb + rise, iz0), (mx0, yb + rise, iz0)], (0, 1, 0), 'M_Floor', fl)
    q([(mx0, yb + rise - 0.2, iz0), (mx0, yb + rise - 0.2, iz1), (mx0, yb + rise, iz1), (mx0, yb + rise, iz0)], (-1, 0, 0), 'M_PaintWall', fl)
    # 段(蹴上げの閉じた段。上りレーン=B1→中間、下りレーン=中間→1F)
    def solid_flight(c0, c1, s_from, s_to, y_from, mat, floor_y):
        n = g['treads']; h = rise / (n + 1); ds = (s_to - s_from) / n
        for i in range(1, n + 1):
            sa, sb = s_from + ds * (i - 1), s_from + ds * i
            ytop = y_from + h * i
            stair_box(sp, st, sa, sb, c0, c1, (floor_y if floor_y is not None else ytop - h - 0.15), ytop, mat,
                      keep=lambda k, c, nn: k in ('+y', '+x', '-x'))
            # 段鼻のノンスリップ(暗い帯。段の縁が見分けられるように)
            sg = 1 if ds > 0 else -1
            stair_box(sp, st, sa, sa + sg * 0.045, c0 + 0.02, c1 - 0.02, ytop, ytop + 0.004, 'M_Baseboard',
                      keep=lambda k, c, nn: k in ('+y', '+x', '-x'))
    solid_flight(cm1, iz1, s0, s1, yb, 'M_FloorDamp', yb)
    solid_flight(iz0, cm0, s1, s0, yb + rise, 'M_Floor', None)
    # 手すり: 1F の踊り場の縁(上りレーンの吹き抜け)・下りの段の脇(背骨の上)・上りの段の壁の手すり
    railing(rl, (s0, yt, up[0]), (s0, yt, iz1 - 0.02), h=1.1, mat='M_Stainless')
    railing(rl, (s0, yt + 0.02, (cm0 + cm1) / 2), (s1, yb + rise + 0.02, (cm0 + cm1) / 2), h=0.9, mat='M_Stainless')
    railing(rl, (s0, yb + 0.18, iz1 - 0.06), (s1, yb + rise + 0.18, iz1 - 0.06), h=0.85, spacing=0.9, bar=0.016, mat='M_Stainless')
    for mbx, kind in ((wl, 'bstair_wall'), (fl, 'bstair_floor'), (sp, 'stair_deck'), (rl, 'rail')):
        mbx.finish(col, {'n2_kind': kind})
    # 施錠された鉄扉(窓なし。開かない)
    door = room['door']
    px, pz = door['pos']
    dd = dict(room=room, id=room['id'], kind='stair', pos=(px, pz), facing=door['facing'], width=DOOR_W, horiz=False,
              gap_min=(px - WALL_T / 2, pz - DOOR_W / 2), gap_max=(px + WALL_T / 2, pz + DOOR_W / 2), steel=True, glass=False,
              auto=False, common=False, unit=False, operable=False, inside_visible=True, solid=True)
    build_door(dd, col, base_y=yb, zsets=('base',))
    # 灯り: 中間踊り場の東壁に弱い壁付け灯、B1 は扉の脇に消えかけの小さな灯り(下るほど暗い)
    B1_LIGHTS.append(build_bracket('BStairMid', ix1, (iz0 + iz1) / 2, yb + rise + 1.95, 'W', col, energy=1.4))
    nb = build_bracket('BStairB1', ix0, dz + dh + 0.35, yb + 2.3, 'E', col, energy=0.22)
    for o in bpy.data.objects:
        if o.name.startswith('BStairB1_cover'):
            o.data.materials[0] = MATS['M_BracketDim']
    B1_LIGHTS.append(nb)


# ---------------------------------------------------------------------------
# 屋上B(7F のみ)
# ---------------------------------------------------------------------------
def build_roof(col):
    R = ROOFB
    y = R['y']
    boxes = floor_wall_boxes({'rooms': [], 'footprint': R['footprint']})
    roof_zones = [z for z in ZONES if z['set'] == 'roof']
    sel = select_boxes(merge_collinear(boxes), roof_zones)
    par = MeshBuilder('Roof_parapet'); rl = MeshBuilder('Roof_rail'); fl = MeshBuilder('Roof_floor'); ob = MeshBuilder('Roof_boxes')
    st = STAIRS['main']
    mst = st['pos'] + st['size']
    for w in sel:
        (x0, z0), (x1, z1) = w['min'], w['max']
        # パラペット: 屋根に面する箱は腰壁(0.75m)＋上に手すり、踊り場・吹き抜けに面するなら手すりだけ
        cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
        zn = None
        for (dx, dz) in ((0.2, 0), (-0.2, 0), (0, 0.2), (0, -0.2)):
            zz = zone_at(cx + dx, cz + dz, y + 0.5, sets=('roof',))
            if zz:
                zn = zz; break
        if zn is None:
            continue
        if zn['kind'] == 'roof':
            par.box((x0, y, z0), (x1, y + R['parapetH'], z1), 'M_ExtWall', keep=lambda k, c, n: k != '-y',
                    mats={'+y': 'M_ExtWall'})
            ln = (x1 - x0) >= (z1 - z0)
            if ln:
                railing(rl, (x0, y + R['parapetH'] - 0.04, cz), (x1, y + R['parapetH'] - 0.04, cz), h=R['railH'] - R['parapetH'] + 0.05, spacing=0.3, bar=0.02)
            else:
                railing(rl, (cx, y + R['parapetH'] - 0.04, z0), (cx, y + R['parapetH'] - 0.04, z1), h=R['railH'] - R['parapetH'] + 0.05, spacing=0.3, bar=0.02)
    # 屋根面(防水シート)
    for a in R['air']:
        if a['kind'] != 'roof':
            continue
        x0, z0, w, d = a['rect']
        fl.quad([(x0, y, z0 + d), (x0 + w, y, z0 + d), (x0 + w, y, z0), (x0, y, z0)], (0, 1, 0), 'M_RoofSheet')
    # 機械室・受水槽・点検口・室外機
    for o in R['obstacles']:
        x0, z0, w, d = o['rect']
        mat = 'M_Machine' if o['id'].startswith('ac_') else 'M_ExtWall'
        ob.box((x0, y, z0), (x0 + w, y + o['h'], z0 + d), mat, keep=lambda k, c, n: k != '-y')
        if o['id'].startswith('ac_'):
            # 室外機のファン(暗い円の代わりの四角い格子面)
            ob.box((x0 + 0.1, y + 0.12, z0 - 0.005), (x0 + w - 0.25, y + 0.62, z0), 'M_Frame', keep=lambda k, c, n: k == '-z')
    for mbx, kind in ((par, 'parapet'), (rl, 'rail'), (fl, 'roof'), (ob, 'roofbox')):
        mbx.finish(col, {'n2_kind': kind})
    # 機械室の扉の上と受水槽の脇の灯り(屋上の灯具は2つだけ。月明かりは P3c)
    tank = next(o for o in R['obstacles'] if o['id'] == 'water_tank')
    build_bracket('RoofLight2', tank['rect'][0] - 0.0, tank['rect'][1] + tank['rect'][3] / 2, y + 1.7, 'W', col, energy=8.0)
    return build_bracket('RoofLight', 6.0 + 1.8 + 0.0, 23.0, y + 2.2, 'E', col, energy=10.0)


# ---------------------------------------------------------------------------
# 1F の追加(集合ポスト・受付窓・外の背景・シアターのスクリーン)
# ---------------------------------------------------------------------------
def build_1f_extras(col):
    mb = MeshBuilder('Mailboxes'); mf = MeshBuilder('Mailboxes_trim')
    for p in FLOOR.get('props', []):
        if p['kind'] != 'mailboxes':
            continue
        x, _, z = p['pos']; dp, h, wd = p['size']
        x0, x1, z0, z1 = x + 0.06, x + 0.06 + dp, z, z + wd
        mb.box((x0, BASE_Y, z0), (x1, BASE_Y + h, z1), 'M_Stainless', keep=lambda k, c, n: k not in ('+x', '-x', '-y'))
        f = mb.quad([(x1, BASE_Y + 0.06, z1), (x1, BASE_Y + 0.06, z0), (x1, BASE_Y + h, z0), (x1, BASE_Y + h, z1)], (1, 0, 0), 'M_Mailbox')
        orient(f, (1, 0, 0))
        set_uv(f, mb, [(0, 0), (1, 0), (1, 1), (0, 1)])
        # P3a-2: 台座(巾木)と前面の見切り(ヘアライン)、床の点検口(ステンレスの枠。写真 mailboxes_1F)
        mf.box((x1 - 0.04, BASE_Y, z0), (x1 + 0.01, BASE_Y + 0.06, z1), 'M_Baseboard', keep=lambda k, c, n: k != '-y')
        mf.box((x1, BASE_Y + h - 0.012, z0), (x1 + 0.012, BASE_Y + h + 0.01, z1), 'M_HairH', keep=lambda k, c, n: k != '-y')
        hx0, hx1, hz0, hz1 = x1 + 0.25, x1 + 1.0, z0 + 1.2, z0 + 2.4
        for (ax, az, bx, bz) in ((hx0, hz0, hx1, hz0 + 0.02), (hx0, hz1 - 0.02, hx1, hz1), (hx0, hz0, hx0 + 0.02, hz1), (hx1 - 0.02, hz0, hx1, hz1),
                                 (hx0, (hz0 + hz1) / 2 - 0.01, hx1, (hz0 + hz1) / 2 + 0.01)):
            mf.box((ax, BASE_Y, az), (bx, BASE_Y + 0.003, bz), 'M_HairH', keep=lambda k, c, n: k == '+y')
    mb.finish(col, {'n2_kind': 'mailboxes'})
    mf.finish(col, {'n2_kind': 'mailtrim'})
    rooms = {r['id']: r for r in FLOOR['rooms']}
    ent = rooms.get('ENTRANCE'); th = rooms.get('THEATER')
    if ent:
        ex0, ez0, ew, ed = ent['rect']
        # 管理室の受付の小窓(風除室の東壁): ヘアラインの額縁が壁から出て、奥に暗い事務室、表にガラス、下に受け台と書類
        rw = MeshBuilder('OfficeWindow'); og = MeshBuilder('OfficeWindow_glass'); oe = MeshBuilder('OfficeWindow_edge')
        xw = ex0 + ew - 0.06
        zc = ez0 + ed / 2
        wy0, wy1, hz = BASE_Y + 0.98, BASE_Y + 1.48, 0.36
        fd = 0.07                                   # 額縁の出
        for (za, zb, ya, yb) in ((zc - hz - 0.035, zc - hz, wy0 - 0.035, wy1 + 0.035), (zc + hz, zc + hz + 0.035, wy0 - 0.035, wy1 + 0.035),
                                 (zc - hz, zc + hz, wy1, wy1 + 0.035), (zc - hz, zc + hz, wy0 - 0.035, wy0)):
            rw.box((xw - fd, ya, za), (xw, yb, zb), 'M_HairV' if (zb - za) < 0.1 else 'M_HairH', keep=lambda k, c, n: k != '+x')
        office = rooms.get('OFFICE')
        if not (office and office['door'].get('enterable')):   # P3b: 管理室に入れる時は奥の闇の面を作らない(管理室の内装が見える)
            q = rw.quad([(xw - 0.004, wy0, zc + hz), (xw - 0.004, wy0, zc - hz), (xw - 0.004, wy1, zc - hz), (xw - 0.004, wy1, zc + hz)], (-1, 0, 0), 'M_OfficeDark')
            orient(q, (-1, 0, 0))
        for (za, zb) in ((zc - hz, zc + hz),):
            for yy in (wy0, wy1):   # 額縁の内側(見込み)
                rw.quad([(xw - fd, yy, za), (xw, yy, za), (xw, yy, zb), (xw - fd, yy, zb)], (0, 1 if yy == wy0 else -1, 0), 'M_HairH')
            for zz, sg in ((za, 1), (zb, -1)):
                orient(rw.quad([(xw - fd, wy0, zz), (xw, wy0, zz), (xw, wy1, zz), (xw - fd, wy1, zz)], (0, 0, sg), 'M_HairV'), (0, 0, sg))
        og.box((xw - fd + 0.012, wy0, zc - hz), (xw - fd + 0.012 + GLASS_T, wy1, zc + hz), 'M_GlassClear', keep=lambda k, c, n: k in ('+x', '-x'))
        oe.box((xw - fd + 0.012, wy0, zc - hz), (xw - fd + 0.012 + GLASS_T, wy1, zc + hz), 'M_GlassEdge', keep=lambda k, c, n: k not in ('+x', '-x'))
        # 受け台(ヘアライン)と書類
        rw.box((xw - 0.26, wy0 - 0.075, zc - hz - 0.04), (xw - fd, wy0 - 0.045, zc + hz + 0.04), 'M_HairH')
        rw.box((xw - 0.22, wy0 - 0.045, zc - 0.18), (xw - 0.12, wy0 - 0.043, zc - 0.03), 'M_Paper', keep=lambda k, c, n: k == '+y')
        rw.finish(col, {'n2_kind': 'officewindow'})
        og.finish(col, {'n2_kind': 'glass'})
        oe.finish(col, {'n2_kind': 'glassedge'})
        # オートロックの操作盤(風除室の西壁、内側のガラスの脇。写真 entrance_windbreak の右手前)
        ic = MeshBuilder('Intercom')
        xi = ex0 + 0.06
        icz0, icz1 = ez0 + 0.09, ez0 + 0.33
        ic.box((xi, BASE_Y + 1.05, icz0), (xi + 0.022, BASE_Y + 1.53, icz1), 'M_HairV', keep=lambda k, c, n: k not in ('+x', '-x'))
        f = ic.quad([(xi + 0.022, BASE_Y + 1.05, icz1), (xi + 0.022, BASE_Y + 1.05, icz0), (xi + 0.022, BASE_Y + 1.53, icz0), (xi + 0.022, BASE_Y + 1.53, icz1)], (1, 0, 0), 'M_Intercom')
        orient(f, (1, 0, 0))
        set_uv(f, ic, [(0, 0), (1, 0), (1, 1), (0, 1)])
        ic.finish(col, {'n2_kind': 'intercom'})
        # 外側の自動ドア・内外のガラスの線。P3c: 外側も近づくと開き、エントランス前(敷地 'G')へ出られる
        dw = ent['door']['width']
        out = dict(id='ENTRANCE_OUT', pos=(ex0 + ew / 2, ez0 + ed), width=FLOOR['perimOpenings'][0]['width'])
        build_auto_door(out, col, operable=True)
        for zline, nm in ((ez0, 'Inner'), (ez0 + ed, 'Outer')):
            build_glass_line(ex0 + 0.06, ex0 + ew - 0.06, zline, ex0 + ew / 2 - dw / 2, ex0 + ew / 2 + dw / 2, col, f'Glass{nm}')
        build_porch(ex0, ez0 + ed, ew, col)
    if th:
        tx0, tz0, tw, td = th['rect']
        # P5b-3(DESIGN §2 ④): スクリーンは北の壁(入口側)。前室(北西の角)の東に寄せる(x 10.8〜13.4、幅 2.6m・高さ 1.55m)。
        #  黒い額(ベルベット調の縁)を壁から 2cm 出して、その手前に幕面
        sc = MeshBuilder('TheaterScreen'); sf = MeshBuilder('TheaterScreen_frame')
        zs = tz0 + WALL_T / 2 + 0.03
        sx0, sx1, sy0, sy1 = 10.8, 13.4, BASE_Y + 0.72, BASE_Y + 2.27
        sf.box((sx0 - 0.06, sy0 - 0.06, tz0 + WALL_T / 2), (sx1 + 0.06, sy1 + 0.06, zs - 0.002), 'M_Sensor', keep=lambda k, c, n: k != '-z')
        q = sc.quad([(sx1, sy0, zs), (sx0, sy0, zs), (sx0, sy1, zs), (sx1, sy1, zs)], (0, 0, 1), 'M_Screen')
        orient(q, (0, 0, 1))
        sc.finish(col, {'n2_kind': 'screen'}); sf.finish(col, {'n2_kind': 'screen'})
        # 段床(南): 段ごとに暗いカーペットの箱(上面と蹴上げ・西の側面)、段鼻にアルミの見切り、西の側面の足元に小さな足元灯
        tb = MeshBuilder('TheaterTiers'); tn = MeshBuilder('TheaterTiers_nosing'); tl = MeshBuilder('TheaterTiers_lights')
        xin1 = tx0 + tw - WALL_T / 2                      # 東の壁の室内の面
        zin1 = tz0 + td - WALL_T / 2                      # 南の壁の室内の面
        prev_h = 0.0
        for t in th.get('tiers', []):
            ax, az, aw, ad = t['rect']
            h = t['h']
            x0_, x1_, z0_, z1_ = ax, min(ax + aw, xin1), az, min(az + ad, zin1)
            # 上面・蹴上げ(北の面: 前の段の高さから上)・西の側面(床から)
            tb.box((x0_, BASE_Y + prev_h, z0_), (x1_, BASE_Y + h, z1_), 'M_Carpet', keep=lambda k, c, n: k in ('+y', '-z'))
            tb.box((x0_, BASE_Y, z0_), (x1_, BASE_Y + h, z1_), 'M_Carpet', keep=lambda k, c, n: k == '-x')
            # 段鼻(アルミの見切り 3cm)
            tn.box((x0_, BASE_Y + h - 0.012, z0_ - 0.004), (x1_, BASE_Y + h + 0.003, z0_ + 0.03), 'M_HairH', keep=lambda k, c, n: k in ('+y', '-z', '-x'))
            # 足元灯(西の側面、蹴上げの近く)
            fz0 = z0_ + 0.12
            tl.box((x0_ - 0.004, BASE_Y + h - 0.12, fz0), (x0_, BASE_Y + h - 0.08, fz0 + 0.1), 'M_StepLight', keep=lambda k, c, n: k == '-x')
            prev_h = h
        tb.finish(col, {'n2_kind': 'tiers'}); tn.finish(col, {'n2_kind': 'tiers'}); tl.finish(col, {'n2_kind': 'lampcover'})


PORCH_LIGHTS = []
PORCH_CH = 2.55     # P3c: 庇の下面の高さ(上端 2.70 = 2F のバルコニーの見付けの下端)

def build_porch(ex0, zf, ew, col):
    """正面玄関の外: 庇の下の石の床・庇の天井(ダウンライト2灯)・左右の外壁(石)。
    P3c: その先の舗装・植え込みは敷地(tools/blender/build_exterior.py の外構)が作る。外側の自動ドアは開く(敷地 'G' へ出られる)。
    庇は 2F の南面のバルコニーの床(見付けの下端 = 2F 床 − 0.2)に重ならない高さ(上端 2.70)。"""
    y = BASE_Y
    pm = MeshBuilder('Porch')
    zo = zf + 0.12                                   # 外周の壁の外面
    px0, px1, pz1 = ex0 - 1.6, ex0 + ew + 1.6, zo + 2.0
    ch = PORCH_CH
    orient(pm.quad([(px0, y, pz1), (px1, y, pz1), (px1, y, zo), (px0, y, zo)], (0, 1, 0), 'M_Stone'), (0, 1, 0))
    pm.box((px0, y + ch, zo), (px1, y + ch + 0.15, pz1), 'M_ExtWall', mats={'-y': 'M_DarkCeil'}, keep=lambda k, c, n: k != '+y' and k != '-z')
    # 正面のガラスの線の左右の外壁(石)
    for xa, xb in ((px0, ex0), (ex0 + ew, px1)):
        orient(pm.quad([(xa, y, zo), (xb, y, zo), (xb, y + ch, zo), (xa, y + ch, zo)], (0, 0, 1), 'M_StoneWall'), (0, 0, 1))
    # ガラスの線の上(無目の上〜庇)は外壁
    orient(pm.quad([(ex0, y + CEIL_H, zo - 0.08), (ex0 + ew, y + CEIL_H, zo - 0.08), (ex0 + ew, y + ch, zo - 0.08), (ex0, y + ch, zo - 0.08)], (0, 0, 1), 'M_StoneWall'), (0, 0, 1))
    # 庇の端の柱(左右)
    for xc in (px0 + 0.2, px1 - 0.2):
        pm.box((xc - 0.15, y, pz1 - 0.35), (xc + 0.15, y + ch, pz1 - 0.05), 'M_StoneWall', keep=lambda k, c, n: k not in ('+y', '-y'))
    pm.finish(col, {'n2_kind': 'porch'})
    for i, xx in enumerate((ex0 + ew / 2 - 1.0, ex0 + ew / 2 + 1.0)):
        PORCH_LIGHTS.append(build_downlight(f'PorchLight_{i}', xx, zo + 1.0, col, energy=5.0, y=y + ch - 0.002))


# ---------------------------------------------------------------------------
# 生成
# ---------------------------------------------------------------------------
def build():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    scene = bpy.context.scene
    col = bpy.data.collections.new('P3a')
    scene.collection.children.link(col)
    build_materials()

    doors = floor_doors()
    log(f'L{LEVEL}: doors {len(doors)}')
    floor_zones = [z for z in ZONES if z['set'] == 'floor']
    raw = floor_wall_boxes(FLOOR)
    walls = select_boxes(merge_collinear(raw), floor_zones)
    log(f'wall boxes selected: {len(walls)}')
    y0 = BASE_Y
    stair_rect = STAIRS['main']['pos'] + STAIRS['main']['size']
    ent = next((r for r in FLOOR['rooms'] if r['id'] == 'ENTRANCE'), None)
    glass_lines = []
    if ent:
        ex0, ez0, ew, ed = ent['rect']
        glass_lines = [ez0, ez0 + ed]

    def face_zone(c, n):
        sx, sy, sz = c[0] + n[0] * 0.03, c[1], c[2] + n[2] * 0.03
        return zone_at(sx, sz, sy, sets=('floor',))

    win_geoms = [corr_window_geom(w_) for w_ in SHELL['windows']]   # P3c-2: 廊下端の窓の開口
    wall_rows = []
    for i, w in enumerate(walls):
        (x0, z0), (x1, z1) = w['min'], w['max']
        mb = MeshBuilder(f'Wall_{i:03d}')
        ev = next((d for d in doors if d['kind'] == 'elevator' and d['id'] == w.get('roomId')), None)
        is_glass = ent and (x1 - x0) > (z1 - z0) and any(abs((z0 + z1) / 2 - gz) < 0.1 for gz in glass_lines) \
            and ent['rect'][0] - 0.1 <= (x0 + x1) / 2 <= ent['rect'][0] + ent['rect'][2] + 0.1
        if is_glass:
            continue   # 風除室の内外のガラス面(build_1f_extras の固定ガラス)
        faces = (('+x', (1, 0, 0)), ('-x', (-1, 0, 0)), ('+z', (0, 0, 1)), ('-z', (0, 0, -1)))
        n_faces = 0
        skip_key = None
        if ev and w.get('part') == 'evBack':
            fwd = p0b_ev.FACE[ev['facing']][0]          # シャフトの奥への向き。扉の面(開口付き)は p0b が張る
            skip_key = {(0, 1): '-z', (0, -1): '+z', (1, 0): '-x', (-1, 0): '+x'}[tuple(fwd)]
        for key, n in faces:
            if key == skip_key:
                continue
            if key[1] == 'x':
                fx_ = x1 if key[0] == '+' else x0
                seg_lo, seg_hi = z0, z1
            else:
                fz_ = z1 if key[0] == '+' else z0
                seg_lo, seg_hi = x0, x1
            # 面を 0.25m ごとに分けて、空気の種類と(屋外なら)建物の壁か手すりかを判定
            L = seg_hi - seg_lo
            nseg = max(1, int(math.ceil(L / 0.25)))
            runs = []
            for k in range(nseg):
                a = seg_lo + L * k / nseg; b = seg_lo + L * (k + 1) / nseg
                m_ = (a + b) / 2
                c = (fx_, y0 + 1.0, m_) if key[1] == 'x' else (m_, y0 + 1.0, fz_)
                zn = face_zone(c, n)
                if zn is None:
                    if doorway_contains(c[0] + n[0] * 0.03, c[2] + n[2] * 0.03, doors):
                        runs.append((a, b, 'door', CEIL_H)); continue
                    runs.append((a, b, None, 0)); continue
                h = zn['y1'] - BASE_Y
                mat = wall_mat(zn['kind'])
                if zn['outdoor']:
                    th = (x1 - x0) if key[1] == 'x' else (z1 - z0)
                    bc = (c[0] - n[0] * (th + 0.08), c[2] - n[2] * (th + 0.08))
                    if not in_footprint(bc[0], bc[1], FLOOR['footprint'], skip=stair_rect):
                        runs.append((a, b, None, 0)); continue   # 建物の無い側=手すり(階段の生成側で作る)
                    mat = 'M_ExtWall'
                runs.append((a, b, mat, h))
            # 同じ材質・高さの連続区間をまとめて面にする
            merged = []
            for r in runs:
                if merged and merged[-1][2] == r[2] and abs(merged[-1][3] - r[3]) < 1e-6:
                    merged[-1] = (merged[-1][0], r[1], r[2], r[3])
                else:
                    merged.append(r)
            holes = window_holes_on_face(win_geoms, key[1], fx_ if key[1] == 'x' else fz_, 1 if key[0] == '+' else -1)   # P3c-2
            for a, b, mat, h in merged:
                if mat is None:
                    continue
                if mat == 'door':
                    mat, h = 'M_Wall', DOOR_H + HEAD_H
                # P3c-2: 廊下端の窓の開口を抜く(穴の左右・下・上の面に分ける)
                pieces = [(a, b, y0, y0 + h)]
                for (ha, hb, hy0, hy1) in holes:
                    nxt = []
                    for (pa, pb, py0, py1) in pieces:
                        if hb <= pa or ha >= pb or hy1 <= py0 or hy0 >= py1:
                            nxt.append((pa, pb, py0, py1)); continue
                        ia, ib = max(pa, ha), min(pb, hb)
                        nxt += [(pa, ia, py0, py1), (ib, pb, py0, py1), (ia, ib, py0, max(py0, hy0)), (ia, ib, min(py1, hy1), py1)]
                    pieces = [q for q in nxt if q[1] - q[0] > 1e-4 and q[3] - q[2] > 1e-4]
                for (pa, pb, ya, yb) in pieces:
                    if key[1] == 'x':
                        pts = [(fx_, ya, pb), (fx_, ya, pa), (fx_, yb, pa), (fx_, yb, pb)] if key[0] == '+' else [(fx_, ya, pa), (fx_, ya, pb), (fx_, yb, pb), (fx_, yb, pa)]
                    else:
                        pts = [(pa, ya, fz_), (pb, ya, fz_), (pb, yb, fz_), (pa, yb, fz_)] if key[0] == '+' else [(pb, ya, fz_), (pa, ya, fz_), (pa, yb, fz_), (pb, yb, fz_)]
                    orient(mb.quad(pts, n, mat), n)
                n_faces += 1
                # 幅木(屋内の長い面)
                if mat in ('M_Wall', 'M_StoneWall', 'M_DarkWall', 'M_PaintWall') and (b - a) > 0.2 and w['kind'] != 'solid':
                    t, hh = 0.012, 0.06
                    if key[1] == 'x':
                        xa, xb = (fx_, fx_ + t) if key[0] == '+' else (fx_ - t, fx_)
                        mb.box((xa, y0, a), (xb, y0 + hh, b), 'M_Baseboard', keep=lambda k, c, nn: nn == n or k == '+y')
                    else:
                        za, zb = (fz_, fz_ + t) if key[0] == '+' else (fz_ - t, fz_)
                        mb.box((a, y0, za), (b, y0 + hh, zb), 'M_Baseboard', keep=lambda k, c, nn: nn == n or k == '+y')
        if ev and w.get('part') == 'evBack':
            p0b_ev.ev_back_face_with_opening(sys.modules[__name__], mb, w, ev)
        ob = mb.finish(col, {'n2_kind': 'wall', 'n2_box': json.dumps([x0, z0, x1, z1])})
        wall_rows.append((i, n_faces))

    # --- 床・天井(空気ごと) ---
    fl = MeshBuilder('Floor'); ce = MeshBuilder('Ceiling')
    for zn in floor_zones:
        x0, z0, w, d = zn['rect']; x1, z1 = x0 + w, z0 + d
        k = zn['kind']
        if k in ('well', 'outdoor', 'ground'):
            continue        # 外階段の床と吹き抜けは階段の生成側
        if k != 'bwell':    # 地下への階段の吹き抜け(1F の部分)は床なし・天井あり
            fl.quad([(x0, y0, z1), (x1, y0, z1), (x1, y0, z0), (x0, y0, z0)], (0, 1, 0), floor_mat(k))
        if k != 'stair' and not zn['outdoor']:
            yc = zn['y1'] if zn.get('ceil') else y0 + CEIL_H
            ce.quad([(x0, yc, z0), (x1, yc, z0), (x1, yc, z1), (x0, yc, z1)], (0, -1, 0), ceil_mat(k))
    fl.finish(col, {'n2_kind': 'floor'}); ce.finish(col, {'n2_kind': 'ceiling'})

    cap = MeshBuilder('Void_Caps')
    for c in SHELL['caps']:
        x = c['x']
        cap.quad([(x, y0, c['z0']), (x, y0, c['z1']), (x, y0 + CEIL_H, c['z1']), (x, y0 + CEIL_H, c['z0'])], (-1, 0, 0), 'M_Void')
    cap.finish(col, {'n2_kind': 'void'})

    door_info = [build_door(dd, col) for dd in doors]

    lamps = [p for p in night_light_positions() if zone_at(p[0], p[1], y0 + 1.0, sets=('floor',)) and zone_at(p[0], p[1], y0 + 1.0)['kind'] in INDOOR_KINDS]
    for i, (lx, lz) in enumerate(lamps):
        build_night_light(i, lx, lz, col)
    p0b_ev.build_hall(sys.modules[__name__], col, doors, door_info)
    windows = [build_window(w, i, col) for i, w in enumerate(SHELL['windows'])]
    downs, brackets = [], []
    for i, l in enumerate(SHELL['lights']):
        if l['kind'] == 'down':
            downs.append(build_downlight(f'Down_{i}', l['pos'][0], l['pos'][1], col, energy=l.get('energy', 1.8)))
        elif l['kind'] == 'bracket':
            brackets.append(build_bracket(f'Bracket_{i}', l['pos'][0], l['pos'][1], BASE_Y + l['y'], l['facing'], col))
    # 隣の階の外階段・北階段の灯り(ベイクにだけ効く。階段の上下で明るさが繋がるように)
    for dl in (-1, 1):
        lv = LEVEL + dl
        if 1 <= lv <= MAX_LEVEL:
            by = (lv - 1) * FLOOR_H
            build_bracket(f'BracketAdj_{lv}', 6.0 - 0.06, 20.6, by + 2.3, 'W', col, light_only=True)
            if lv <= 3 and LEVEL <= 3:
                for l_ in next(f for f in BUILDING['floors'] if f['level'] == lv)['shell']['lights']:
                    if l_['kind'] == 'bracket' and l_['pos'][1] < 3.0:   # 北階段の壁付け灯
                        build_bracket(f'BracketAdjN_{lv}', l_['pos'][0], l_['pos'][1], by + l_['y'], l_['facing'], col, light_only=True)
    exits = []
    rooms = {r['id']: r for r in FLOOR['rooms']}
    for i, e in enumerate(SHELL['exits']):
        r = rooms[e['room']]
        fx, fz = FACING_OUT[r['door']['facing']]
        nrm = (-fx, -fz) if e.get('inside') else (fx, fz)
        exits.append(build_exit_sign(i, r['door']['pos'][0], r['door']['pos'][1], nrm, col))
    build_external_stair(col)
    if LEVEL <= STAIRS['north']['levels'][1]:
        build_north_stair(col)
        build_gallery(col)
    if LEVEL == 1:
        build_1f_extras(col)
    if BASEMENT:
        build_basement_stair(col)
    roof_light = build_roof(col) if ROOFB else None
    rooms_meta = build_rooms.build_all(sys.modules[__name__], col)   # P3b

    world = bpy.data.worlds.new('N2_Night')
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    sky = float(ARGS.get('sky', 0.03))
    bg.inputs['Color'].default_value = (0.55, 0.65, 1.0, 1)     # 曇った夜空の弱い青(屋外の踊り場・屋上にだけ届く)
    bg.inputs['Strength'].default_value = sky
    scene.world = world
    # P3b: 薄い月明かり(南西の上から)。部屋の組(2枚目のライトマップ)のベイクにだけ効かせる(bake.py が外殻のベイク中は消す)
    md = bpy.data.lights.new('N2_Moon', 'SUN')
    md.energy = float(ARGS.get('moon', 0.05)); md.color = (0.72, 0.8, 1.0); md.angle = math.radians(2.0)
    mo = bpy.data.objects.new('N2_Moon', md)
    mo.rotation_mode = 'QUATERNION'
    mo.rotation_quaternion = Vector((0.45, 0.55, -0.7)).normalized().to_track_quat('-Z', 'Y')
    mo['n2_moon'] = 1
    col.objects.link(mo)

    meta = dict(level=LEVEL, baseY=BASE_Y, ceilH=CEIL_H, doors=door_info, lamps=lamps, walls=len(walls),
                windows=windows, downlights=downs, brackets=brackets + ([roof_light] if roof_light else []) + rooms_meta['roomLights'], exits=exits,
                evButtons=EV_BUTTONS, materials=MAT_TEX, rooms=rooms_meta['rooms'])
    if LEVEL == 1:
        ent = next((r for r in FLOOR['rooms'] if r['id'] == 'ENTRANCE'), None)
        if ent:
            ex0, ez0, ew, ed = ent['rect']
            # P3a-2: 風除室の静的環境(world.js がキューブカメラで1回だけ描いて PMREM)。材質ごとの映り込みの強さ
            meta['envProbe'] = dict(pos=[ex0 + ew / 2, BASE_Y + 1.35, ez0 + ed / 2], size=256,
                                    intensity={'M_GlassClear': 1.0, 'M_GlassEdge': 0.7, 'M_HairV': 1.0, 'M_HairH': 1.0, 'M_Sensor': 1.0,
                                               'M_Stainless': 0.8, 'M_Stone': 1.0, 'M_StoneWall': 0.4, 'M_Mailbox': 0.25, 'M_Intercom': 0.4})
    scene['n2_meta'] = json.dumps(meta)
    return col


NO_LIGHTMAP_KINDS = {'glass', 'glassedge', 'decal', 'corrglass'}   # P3a-2: 透明ガラスはベイクしない(ライトマップの UV は 0 に潰す)


def lm_group(o):
    """ライトマップの組: 1 = 外殻(floor_N_lightmap)・2 = 部屋の組(P3b: floor_N_rooms_lightmap)・0 = 使わない。"""
    if o.get('n2_kind') in NO_LIGHTMAP_KINDS:
        return 0
    g = o.get('n2_lm')
    return 1 if g is None else int(g)


def lightmap_uvs(col):
    flat = [o for o in col.objects if o.type == 'MESH' and not o.get('n2_bake_only') and lm_group(o) == 0]
    for o in flat:
        uvl = o.data.uv_layers.new(name='Lightmap')
        uvl.data.foreach_set('uv', [0.0] * (2 * len(uvl.data)))
        o.data.uv_layers.active = o.data.uv_layers['UVMap']
    vl = bpy.context.view_layer
    for grp in (1, 2):
        meshes = [o for o in col.objects if o.type == 'MESH' and not o.get('n2_bake_only') and lm_group(o) == grp]
        if not meshes:
            continue
        for o in meshes:
            uvl = o.data.uv_layers.new(name='Lightmap')
            o.data.uv_layers.active = uvl
        vl.update()
        for o in bpy.context.scene.objects:
            o.select_set(False)
        for o in meshes:
            o.select_set(True)
        vl.objects.active = meshes[0]
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
        bpy.ops.uv.pack_islands(rotate=True, margin_method='FRACTION', margin=float(ARGS.get('uv_margin', 0.003)))
        bpy.ops.object.mode_set(mode='OBJECT')
        for o in meshes:
            # 詰め込みの丸めで [0,1] をわずかにはみ出すことがある(P3b: 7F の呼びパネルで 1.002)→ 内側へ寄せる
            lm = o.data.uv_layers['Lightmap'].data
            buf = [0.0] * (2 * len(lm))
            lm.foreach_get('uv', buf)
            lm.foreach_set('uv', [min(0.9995, max(0.0005, v)) for v in buf])
            o.data.uv_layers.active = o.data.uv_layers['UVMap']
            o.data.uv_layers['UVMap'].active_render = True
        log(f'lightmap UV group {grp}: {len(meshes)} meshes packed')


if __name__ == '__main__':
    col = build()
    lightmap_uvs(col)
    out = os.path.join(ROOT, OUT)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=out, compress=True)
    nm = sum(1 for o in col.objects if o.type == 'MESH')
    log(f'saved {out} ({nm} meshes)')
