# build_exterior.py — P3c: 外観と外環境を1本の GLB(build/exterior.glb)に書き出す。ベイクしない(実行時の月明かり＋発光面)。
#
# 実行: Blender -b --factory-startup -P tools/blender/build_exterior.py -- [--out build/exterior.glb] [--manifest build/exterior_manifest.json]
#        先に tools/build.sh で階の GLB(build/floor_N.glb)、python3 tools/ext_textures.py で build/tex/ext_* を作っておく。
#
# 中身(ノード名 → 実行時 src/exterior.js の扱い):
#   ExtBand_1..7  外観の「階の帯」。その階の GLB(build/floor_N.glb)から外から見える部品(バルコニー・窓・カーテン・外階段・屋根・庇・
#                 自分の階の外壁の塊)を取り出して1つにまとめたもの(P3a/P3b の見た目そのまま。ライトマップの UV は捨てる)。
#                 実行時は「その階の GLB が scene に出ていない時だけ」見せる(出ている時は本物の階が同じ物を描く)。
#                 入れる部屋の窓の奥には、内装の代わりにカーテン(UNIT_VARIANTS の色)か闇の面を足す。1F は風除室の奥の灯り。
#   ExtAlways     常に見せる外観: EV の南面の赤橙の縦パネル・カーテン越しに灯りの点いた窓(施錠の空室の数室)・廊下の端の窓の灯り・
#                 2F の張り出しの下の天井と柱(どの階の GLB も描かない所)
#   Site          1F 東側の外構(図面 floorplan_1F): 駐車場(白線・車止め・車)・駐輪場・ゴミ置場・バイク置場・アプローチの舗装・植え込み・
#                 照明柱・柵/擁壁/生垣・閉じた門・下りていく車路。当たりは building.json の site(階キー 'G')が同じ数値
#   Terrain       地形(放射状の格子。敷地は平ら、北と西は山へ上がり、東南東は谷へ下る)
#   TreeProto_0/1 近景の針葉樹(低ポリ。実行時に InstancedMesh)。配置は build/exterior_instances.bin
#   Billboard     中景の木(十字の板。ext_trees.webp の 4 種)。配置は同じ .bin
#   Ridge_0..2    遠景の山並みのシルエット(カメラに付いて動く円筒の帯。稜線の木のギザギザは頂点)
#   City          谷の向こうの街の夜景の帯(ext_city.webp)。Ridge_0 の切れ目(東南東)から見える
# 座標はゲーム座標(x=東, z=南, y=上)で考え、MeshBuilder が Blender 座標へ直す。

import bpy, bmesh, json, math, os, sys, random, struct
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
from n2common import parse_args, log  # noqa: E402

ARGS = parse_args({'out': 'build/exterior.glb', 'manifest': 'build/exterior_manifest.json', 'inst': 'build/exterior_instances.bin', 'blend': ''})
_argv = sys.argv
sys.argv = [_argv[0], '--', '--level', '1']      # build_floor を部品箱として読む(1F の文脈。build() は呼ばない)
import build_floor as C  # noqa: E402
import build_rooms as BR  # noqa: E402
sys.argv = _argv

BUILDING = C.BUILDING
SITE = BUILDING['site']
FLOORS = {f['level']: f for f in BUILDING['floors'] if f['level'] <= 7}
FH = C.FLOOR_H
T = C.WALL_T
TEXMETA = json.load(open(os.path.join(C.TEX, 'ext_textures.json')))
RNG = random.Random(20261103)
CEN = (18.0, 15.75)                    # 地形・木の配置の中心(敷地の中ほど)
G = lambda x, y, z: (x, y, z)


# ---------------------------------------------------------------- 準備
def wipe():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for me in list(bpy.data.meshes):
        bpy.data.meshes.remove(me)


def materials():
    C.build_materials()            # M_*・MR_*・MX_*(階の GLB と同じ名前・同じ実行時テクスチャの対応)
    BR.init(C)
    pm, tex, tf = C.pbr_material, C.tex, C.tex_files
    MT = C.MAT_TEX
    pm('XE_Ground', files={'albedo': tex('ext_ground.jpg')}, size=4.0, rough=1.0); MT['XE_Ground']['tint'] = [0.42, 0.46, 0.4]   # 林床(木の下は暗い)
    pm('XE_Grass', files={'albedo': tex('ext_grass.jpg')}, size=1.5, rough=1.0)
    pm('XE_Pavers', files={'albedo': tex('ext_pavers.jpg')}, size=1.2, rough=0.8)
    pm('XE_Asphalt', files=tf('paving', rough=False), size=3.0, rough=0.85); MT['XE_Asphalt']['tint'] = [0.85, 0.85, 0.86]
    pm('XE_Concrete', files=tf('concrete', rough=False), size=2.0, rough=0.9)
    pm('XE_Curb', files=tf('concrete', rough=False), size=1.0, rough=0.9); MT['XE_Curb']['tint'] = [1.15, 1.15, 1.12]
    pm('XE_Line', base=(0.62, 0.62, 0.6), rough=0.7)
    pm('XE_Fence', files={'albedo': tex('ext_fence.png')}, size=1.0, rough=0.6, metal=0.3)
    pm('XE_Steel', base=(0.09, 0.1, 0.1), rough=0.5, metal=0.6)
    pm('XE_Galv', base=(0.42, 0.43, 0.43), rough=0.45, metal=0.7)
    pm('XE_Shrub', files={'albedo': tex('ext_grass.jpg')}, size=0.8, rough=0.95); MT['XE_Shrub']['tint'] = [0.7, 0.75, 0.7]
    pm('XE_Soil', files={'albedo': tex('ext_ground.jpg')}, size=1.5, rough=1.0); MT['XE_Soil']['tint'] = [0.7, 0.65, 0.6]
    for i, c in enumerate(SITE['cars']):
        pm(f'XE_Car{i}', base=tuple(c['color']), rough=0.3, metal=0.5)
    pm('XE_CarGlass', base=(0.012, 0.014, 0.016), rough=0.06)
    pm('XE_Tire', base=(0.018, 0.018, 0.018), rough=0.9)
    pm('XE_CarLamp', base=(0.35, 0.33, 0.3), rough=0.2)
    pm('XE_CarTail', base=(0.25, 0.02, 0.02), rough=0.25)
    pm('XE_Lamp', base=(0.9, 0.85, 0.75), rough=0.3, emit=(1.0, 0.8, 0.55), emit_strength=6.0)
    pm('XE_RedPanel', base=(0.50, 0.105, 0.042), rough=0.62)
    pm('XE_WinGlow', base=(0.0, 0.0, 0.0), rough=1.0, emit_tex=C.load_img(tex('room_palette.png'), False), emit_strength=1.0)
    pm('XE_CorrGlow', base=(0.02, 0.02, 0.02), rough=0.3, emit=(1.0, 0.84, 0.62), emit_strength=1.0)
    pm('XE_LobbyGlow', base=(0.02, 0.02, 0.02), rough=0.3, emit=(1.0, 0.9, 0.76), emit_strength=1.0)
    pm('XE_Soffit', files=tf('concrete', rough=False), size=2.0, rough=0.9); MT['XE_Soffit']['tint'] = [0.9, 0.9, 0.88]
    pm('XE_Bark', base=(0.09, 0.075, 0.062), rough=0.95)
    pm('XE_Needle', base=(0.07, 0.105, 0.075), rough=0.9)
    pm('XE_Billboard', files={'albedo': tex('ext_trees.webp')}, size=1.0, rough=0.9)
    pm('XE_City', files={'albedo': tex('ext_city.webp')}, size=1.0, rough=1.0)
    for i in range(3):
        pm(f'XE_Ridge{i}', base=(0.01, 0.012, 0.014), rough=1.0)
    pm('XE_Bin', base=(0.05, 0.12, 0.08), rough=0.6)
    pm('XE_BinLid', base=(0.04, 0.06, 0.12), rough=0.6)
    pm('XE_Seat', base=(0.02, 0.02, 0.02), rough=0.6)


def link_mat(mat_name):
    return C.MATS[mat_name]


# ---------------------------------------------------------------- 地形の高さ
def _smooth(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


_PH = [RNG.uniform(0, 6.283) for _ in range(16)]


def _noise(x, z, s):
    v = 0.0
    for k, (f, a) in enumerate(((0.011, 1.0), (0.023, 0.55), (0.051, 0.3), (0.0047, 1.6), (0.097, 0.14))):
        v += a * math.sin(x * f * s + _PH[k]) * math.cos(z * f * 1.13 * s + _PH[k + 5]) + a * 0.5 * math.sin((x + z) * f * 0.71 * s + _PH[k + 10])
    return v


def valley_w(ang):
    """谷(東南東)の重み 0..1。"""
    c = math.radians(14.0)
    d = math.atan2(math.sin(ang - c), math.cos(ang - c))
    return math.exp(-(d / 1.05) ** 2)


B = SITE['bounds']


def H(x, z):
    """地形の高さ(m)。敷地の中は −0.06(外構の面の下)。"""
    W_, S_, E_, N_ = B['W'], B['S'], B['E'], B['N']
    if W_ - 0.3 <= x <= E_ + 0.3 and N_ - 0.3 <= z <= S_ + 0.3:
        return -0.06
    on, os_, ow, oe = max(0, N_ - z), max(0, z - S_), max(0, W_ - x), max(0, x - E_)
    near = (2.9 * _smooth(0.8, 2.6, on) + 0.48 * max(0.0, on - 2.6)                       # 北: 擁壁の上から山へ
            - (0.55 * min(os_, 28.0) + 0.2 * max(0.0, os_ - 28.0))                           # 南: 下りの斜面
            + (0.6 * _smooth(0.6, 3.0, ow) + 0.3 * max(0.0, ow - 3.0))                       # 西: 生垣の外から上がる
            - (0.85 * min(oe, 26.0) + 0.3 * max(0.0, oe - 26.0)))                            # 東: 駐車場の先は急な下り(谷が見える)
    dx, dz = x - CEN[0], z - CEN[1]
    r = math.hypot(dx, dz)
    ang = math.atan2(dz, dx)
    v = valley_w(ang)
    mount = 0.42 * r * (1.0 - 0.45 * _smooth(500.0, 1400.0, r)) * (1.0 - v)
    vall = -118.0 * _smooth(0.0, 760.0, r) ** 0.75 * v
    far = mount + vall
    wf = _smooth(70.0, 320.0, r)
    n = _noise(x, z, 1.0) * (1.2 + 0.035 * r) * _smooth(25.0, 90.0, r)
    return near * (1 - wf) + far * wf + n


# ---------------------------------------------------------------- 階の GLB から外観の帯を取り出す
WHOLE = {'balac', 'bars', 'balcony', 'partition', 'balrail', 'facade', 'winframe', 'winsash', 'wincurtain', 'winout',
         'stair_steel', 'roof', 'roofbox', 'roofA', 'parapet', 'porch', 'ground', 'autodoor', 'autoframe', 'glassframe',
         'glass', 'glassedge', 'decal'}
FILTERED = {'stair_deck', 'rail', 'lampcover', 'bracket', 'wall', 'lintel', 'massing', 'floor'}


def building_rects(L):
    return BR._building_rects(FLOORS[L])


def in_rects(x, z, rects, s=0.04):
    for (rx, rz, rw, rd) in rects:
        if rx + s < x < rx + rw - s and rz + s < z < rz + rd - s:
            return True
    return False


def extract_band(L, col):
    path = os.path.join(ROOT, 'build', f'floor_{L}.glb')
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    rects = building_rects(L)
    y0 = (L - 1) * FH
    keep = []
    for o in new:
        if o.type != 'MESH':
            continue
        k = o.get('n2_kind', '')
        if k not in WHOLE and k not in FILTERED:
            continue
        if k == 'winsash' and o.parent is not None:
            continue
        keep.append(o)
    for o in new:
        if o not in keep:
            continue
        # 材質を build_floor の材質(同じ名前)に寄せる
        for slot in o.material_slots:
            if slot.material:
                base = slot.material.name.split('.')[0]
                if base in C.MATS:
                    slot.material = C.MATS[base]
    out = []
    for o in keep:
        if o.data.users > 1:
            o.data = o.data.copy()
        o.parent = None
        mw = o.matrix_world.copy()
        o.data.transform(mw)
        o.matrix_world = Matrix.Identity(4)
        me = o.data
        while len(me.uv_layers) > 1:
            me.uv_layers.remove(me.uv_layers[-1])
        k = o.get('n2_kind', '')
        if k in FILTERED:
            mats = [s.material.name if s.material else '' for s in o.material_slots]
            bm = bmesh.new(); bm.from_mesh(me)
            kill = []
            for f in bm.faces:
                c = f.calc_center_median()
                gx, gy, gz = c.x, c.z, -c.y
                ny = f.normal.z
                mat = mats[f.material_index] if f.material_index < len(mats) else ''
                ok = True
                if k == 'massing':
                    ok = abs(ny) < 0.3 and y0 + 0.01 < gy < y0 + FH - 0.01 and mat == 'MX_Mass'
                elif k in ('wall', 'lintel'):
                    ok = mat == 'M_ExtWall' and not in_rects(gx, gz, rects, 0.0)
                elif k == 'floor':
                    ok = mat == 'M_GalleryFloor'
                else:   # stair_deck・rail・lampcover・bracket: 建物の中(屋内)の物を除く。地下も除く
                    ok = (not in_rects(gx, gz, rects, 0.02)) and gy > -0.05
                if not ok:
                    kill.append(f)
            bmesh.ops.delete(bm, geom=kill, context='FACES')
            bm.to_mesh(me); bm.free()
        if len(me.polygons):
            out.append(o)
    for o in new:
        if o not in out:
            bpy.data.objects.remove(o, do_unlink=True)
    for o in out:
        for c_ in list(o.users_collection):
            c_.objects.unlink(o)
        col.objects.link(o)
    return out


def join(objs, name, props):
    objs = [o for o in objs if o and o.type == 'MESH' and len(o.data.polygons)]
    if not objs:
        return None
    for o in bpy.context.scene.objects:
        o.select_set(False)
    if len(objs) > 1:
        with bpy.context.temp_override(active_object=objs[0], object=objs[0], selected_objects=objs, selected_editable_objects=objs):
            bpy.ops.object.join()
    j = objs[0]
    j.name = name
    j.data.name = name
    for key in list(j.keys()):
        del j[key]
    for k, v in props.items():
        j[k] = v
    return j


# ---------------------------------------------------------------- 帯の追加物(入れる部屋の窓の奥・風除室の奥の灯り)
def enterable_backing(L, col):
    """入れる部屋の掃き出し窓の奥(内装は帯に入れない): カーテンの状態どおりにカーテンの面か闇の面(施錠の部屋の作りと同じ位置)。"""
    b = BR.B(f'Backing_{L}')
    C.BASE_Y = (L - 1) * FH
    for r in FLOORS[L]['rooms']:
        if not (r.get('door') and r['door'].get('enterable') and r.get('window')):
            continue
        win = r['window']
        ax = win['axis']
        fx, fz = BR.FACING[win['facing']]
        line = win['line']
        y0 = C.BASE_Y
        lo, hi = win['pos'][0 if ax == 'x' else 1] - win['width'] / 2, win['pos'][0 if ax == 'x' else 1] + win['width'] / 2
        var = (r.get('interior') or {}).get('variant') or {}
        key, st = var.get('curtain'), var.get('curtainState')
        o0, o1 = win['open']
        spans = []
        if key and st == 'closed':
            spans = [(lo, hi, key)]
        elif key and st == 'half':
            spans = [(min(o0, o1), max(o0, o1), None)]
            rest = (max(o0, o1), hi) if min(o0, o1) - lo < 0.2 else (lo, min(o0, o1))
            spans.append((rest[0], rest[1], key))
        else:
            spans = [(lo, hi, None)]
        off = -T / 2 - 0.25        # 窓の奥 25cm(障子・枠より奥)
        for (a0, a1, k) in spans:
            a0p, a1p = a0 + 0.02, a1 - 0.02
            if a1p - a0p < 0.05:
                continue
            if ax == 'x':
                pts = [(a1p if fz > 0 else a0p, y0 + 0.03, line + off * fz), (a0p if fz > 0 else a1p, y0 + 0.03, line + off * fz),
                       (a0p if fz > 0 else a1p, y0 + BR.WIN_H - 0.03, line + off * fz), (a1p if fz > 0 else a0p, y0 + BR.WIN_H - 0.03, line + off * fz)]
            else:
                pts = [(line + off * fx, y0 + 0.03, a0p if fx > 0 else a1p), (line + off * fx, y0 + 0.03, a1p if fx > 0 else a0p),
                       (line + off * fx, y0 + BR.WIN_H - 0.03, a1p if fx > 0 else a0p), (line + off * fx, y0 + BR.WIN_H - 0.03, a0p if fx > 0 else a1p)]
            if k:
                b.pquad(pts, (fx, 0, fz), k)
            else:
                b.quad(pts, (fx, 0, fz), 'MX_Void')
    return b.mb.finish(col, {})


def lobby_glow(col):
    """1F が scene に無い時の風除室の奥(内側のガラスの線)の灯り。外側のガラス越しに明るく見える。"""
    ent = next(r for r in FLOORS[1]['rooms'] if r['id'] == 'ENTRANCE')
    ex0, ez0, ew, ed = ent['rect']
    mb = C.MeshBuilder('LobbyGlow')
    C.orient(mb.quad([(ex0, 0.0, ez0 + 0.02), (ex0 + ew, 0.0, ez0 + 0.02), (ex0 + ew, C.CEIL_H, ez0 + 0.02), (ex0, C.CEIL_H, ez0 + 0.02)], (0, 0, 1), 'XE_LobbyGlow'), (0, 0, 1))
    # 風除室の床・天井・左右の壁(暗い面。灯りの手前の奥行き)
    C.orient(mb.quad([(ex0, 0.002, ez0 + ed), (ex0 + ew, 0.002, ez0 + ed), (ex0 + ew, 0.002, ez0), (ex0, 0.002, ez0)], (0, 1, 0), 'M_Stone'), (0, 1, 0))
    C.orient(mb.quad([(ex0, C.CEIL_H, ez0), (ex0 + ew, C.CEIL_H, ez0), (ex0 + ew, C.CEIL_H, ez0 + ed), (ex0, C.CEIL_H, ez0 + ed)], (0, -1, 0), 'M_DarkCeil'), (0, -1, 0))
    for xx, sg in ((ex0 + 0.06, 1), (ex0 + ew - 0.06, -1)):
        C.orient(mb.quad([(xx, 0, ez0), (xx, 0, ez0 + ed), (xx, C.CEIL_H, ez0 + ed), (xx, C.CEIL_H, ez0)], (sg, 0, 0), 'M_StoneWall'), (sg, 0, 0))
    return mb.finish(col, {})


# ---------------------------------------------------------------- 常に見せる外観
LIT = []


def pick_lit_windows():
    """カーテン越しに灯りの点いた窓: 施錠の空室(入れる部屋・物語の部屋は除く)から、見える向きが偏らないよう数室。"""
    cand = {}
    for L, f in FLOORS.items():
        for r in f['rooms']:
            if r['kind'] != 'unit' or not r.get('balcony') or r['door'].get('enterable') or r.get('story'):
                continue
            cand.setdefault(r['balcony']['facing'], []).append(r)
    want = {'S': 3, 'W': 2, 'E': 2, 'N': 1}
    out = []
    for fc, n in want.items():
        lst = sorted(cand.get(fc, []), key=lambda r: r['id'])
        rr = random.Random(77 + ord(fc))
        rr.shuffle(lst)
        out += lst[:n]
    return out


def build_always(col):
    mb = C.MeshBuilder('ExtAlways')
    b = BR.B('ExtAlways_glow')
    # 赤橙の縦パネル(EV の南面。地面から EV 機械室の上まで)
    ev = BUILDING['elevator']
    x0, z0 = ev['shaft']; w, d = ev['size']
    zf = z0 + d + T + 0.004
    ytop = BUILDING['roofB']['y'] + 2.6 + 0.25
    C.orient(mb.quad([(x0, 0.0, zf), (x0 + w, 0.0, zf), (x0 + w, ytop, zf), (x0, ytop, zf)], (0, 0, 1), 'XE_RedPanel'), (0, 0, 1))
    mb.box((x0 - 0.02, ytop - 0.02, zf - 0.25), (x0 + w + 0.02, ytop + 0.06, zf + 0.04), 'XE_RedPanel', keep=lambda k, c, n: k != '-z')
    # 灯りの点いた窓(施錠の部屋のカーテンの面の 1cm 手前に発光面。色=その部屋のカーテン)
    for r in pick_lit_windows():
        L = next(l for l, f in FLOORS.items() if r in f['rooms'])
        win = BR._make_window(r)
        ax = win['axis']; fx, fz = BR.FACING[win['facing']]; line = win['line']
        y0 = (L - 1) * FH
        lo, hi = win['pos'][0 if ax == 'x' else 1] - win['width'] / 2, win['pos'][0 if ax == 'x' else 1] + win['width'] / 2
        off = -T / 2 + 0.016
        a0p, a1p = lo + 0.03, hi - 0.03
        if ax == 'x':
            pts = [(a1p if fz > 0 else a0p, y0 + 0.03, line + off * fz), (a0p if fz > 0 else a1p, y0 + 0.03, line + off * fz),
                   (a0p if fz > 0 else a1p, y0 + BR.WIN_H - 0.03, line + off * fz), (a1p if fz > 0 else a0p, y0 + BR.WIN_H - 0.03, line + off * fz)]
        else:
            pts = [(line + off * fx, y0 + 0.03, a0p if fx > 0 else a1p), (line + off * fx, y0 + 0.03, a1p if fx > 0 else a0p),
                   (line + off * fx, y0 + BR.WIN_H - 0.03, a1p if fx > 0 else a0p), (line + off * fx, y0 + BR.WIN_H - 0.03, a0p if fx > 0 else a1p)]
        key = BR._locked_curtain(r)
        f = C.orient(b.mb.quad(pts, (fx, 0, fz), 'XE_WinGlow'), (fx, 0, fz))
        C.set_uv(f, b.mb, BR.uv_rect(BR.PALUV[key]))
        cx = sum(p[0] for p in pts) / 4; cz = sum(p[2] for p in pts) / 4
        LIT.append(dict(room=r['id'], level=L, curtain=key, pos=[round(cx + fx * 0.3, 3), round(y0 + 1.1, 3), round(cz + fz * 0.3, 3)], facing=win['facing']))
    # 廊下の端の窓(P3a の窓の外側に、常夜灯の点いた廊下の弱い灯り)
    for L, f in FLOORS.items():
        y0 = (L - 1) * FH
        for wdef in f['shell']['windows']:
            x, z = wdef['pos']
            nx, nz = C.FACING_OUT[wdef['facing']]            # 室内側への法線
            ox, oz = -nx, -nz
            ya, yb = y0 + wdef['sill'], y0 + wdef['sill'] + wdef['h']
            hw = wdef['w'] / 2
            if oz != 0:
                zz = z + oz * 0.045
                pts = [(x - hw, ya, zz), (x + hw, ya, zz), (x + hw, yb, zz), (x - hw, yb, zz)]
            else:
                xx = x + ox * 0.045
                pts = [(xx, ya, z - hw), (xx, ya, z + hw), (xx, yb, z + hw), (xx, yb, z - hw)]
            C.orient(mb.quad(pts, (ox, 0, oz), 'XE_CorrGlow'), (ox, 0, oz))
            # 枠
            if oz != 0:
                mb.box((x - hw - 0.04, ya - 0.04, zz - 0.01), (x + hw + 0.04, ya, zz + oz * 0.06), 'M_Stainless')
            else:
                mb.box((min(xx, xx + ox * 0.06), ya - 0.04, z - hw - 0.04), (max(xx, xx + ox * 0.06), ya, z + hw + 0.04), 'M_Stainless')
    # 2F の張り出しの下(管理室の東。1F の外): 天井(2F の床スラブの下面)・スラブの小口・柱
    xa, xb = 22.0 + T, 25.2
    za, zb = 22.1 + T, 28.1
    ys = FH - 0.2
    C.orient(mb.quad([(xa, ys, za), (xb, ys, za), (xb, ys, zb), (xa, ys, zb)], (0, -1, 0), 'XE_Soffit'), (0, -1, 0))
    mb.box((xb, ys, za), (xb + 0.12, FH + 0.02, zb), 'XE_Soffit', keep=lambda k, c, n: k == '+x' or k == '-y')
    for o in SITE['obstacles']:
        if o['kind'] == 'column' and o['id'].startswith('pilotis'):
            x, z, w_, d_ = o['rect']
            mb.box((x, 0, z), (x + w_, ys, z + d_), 'XE_Concrete', keep=lambda k, c, n: k not in ('+y', '-y'))
    a = mb.finish(col, {})
    g = b.mb.finish(col, {})
    return [a, g]


# ---------------------------------------------------------------- 外構(1F 東側・アプローチ)
def rect_sub(r, holes):
    """矩形 r=(x0,z0,x1,z1) から holes を引いた矩形の並び。"""
    out = [r]
    for h in holes:
        nxt = []
        for (a0, b0, a1, b1) in out:
            h0, k0, h1, k1 = h
            if h1 <= a0 or h0 >= a1 or k1 <= b0 or k0 >= b1:
                nxt.append((a0, b0, a1, b1)); continue
            if b0 < k0: nxt.append((a0, b0, a1, k0))
            if k1 < b1: nxt.append((a0, k1, a1, b1))
            m0, m1 = max(b0, k0), min(b1, k1)
            if a0 < h0: nxt.append((a0, m0, h0, m1))
            if h1 < a1: nxt.append((h1, m0, a1, m1))
        out = [q for q in nxt if q[2] - q[0] > 1e-3 and q[3] - q[1] > 1e-3]
    return out


def flat(mb, r, y, mat):
    x0, z0, x1, z1 = r
    C.orient(mb.quad([(x0, y, z1), (x1, y, z1), (x1, y, z0), (x0, y, z0)], (0, 1, 0), mat), (0, 1, 0))


def cyl(mb, cx, cz, r, y0, y1, mat, n=8, caps=True):
    for i in range(n):
        a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
        p0 = (cx + r * math.cos(a0), cz + r * math.sin(a0)); p1 = (cx + r * math.cos(a1), cz + r * math.sin(a1))
        nm = ((math.cos(a0) + math.cos(a1)) / 2, 0, (math.sin(a0) + math.sin(a1)) / 2)
        C.orient(mb.quad([(p1[0], y0, p1[1]), (p0[0], y0, p0[1]), (p0[0], y1, p0[1]), (p1[0], y1, p1[1])], nm, mat), nm)
    if caps:
        pts = [(cx + r * math.cos(2 * math.pi * i / n), y1, cz + r * math.sin(2 * math.pi * i / n)) for i in range(n)]
        mb.poly(pts, (0, 1, 0), mat)


def wheel(mb, cx, cy, cz, r, w, axis, mat, n=10):
    """円盤の車輪(axis = 車軸の向き 'x' か 'z')。"""
    ring = []
    for i in range(n):
        a = 2 * math.pi * i / n
        ring.append((math.cos(a) * r, math.sin(a) * r))
    for side in (-1, 1):
        if axis == 'z':
            pts = [(cx + u, cy + v, cz + side * w / 2) for (u, v) in ring]
            mb.poly(pts if side > 0 else list(reversed(pts)), (0, 0, side), mat)
        else:
            pts = [(cx + side * w / 2, cy + v, cz + u) for (u, v) in ring]
            mb.poly(pts, (side, 0, 0), mat)
    for i in range(n):
        (u0, v0), (u1, v1) = ring[i], ring[(i + 1) % n]
        if axis == 'z':
            q = [(cx + u0, cy + v0, cz - w / 2), (cx + u1, cy + v1, cz - w / 2), (cx + u1, cy + v1, cz + w / 2), (cx + u0, cy + v0, cz + w / 2)]
            nm = ((u0 + u1) / 2, (v0 + v1) / 2, 0)
        else:
            q = [(cx - w / 2, cy + v0, cz + u0), (cx - w / 2, cy + v1, cz + u1), (cx + w / 2, cy + v1, cz + u1), (cx + w / 2, cy + v0, cz + u0)]
            nm = (0, (v0 + v1) / 2, (u0 + u1) / 2)
        C.orient(mb.quad(q, nm, mat), nm)


def build_site(col):
    mb = C.MeshBuilder('Site')
    fp = SITE['footprint']
    obs = {o['id']: o for o in SITE['obstacles']}
    porch = (14.0, 28.22, 21.2, 30.22)
    beds = [o for o in SITE['obstacles'] if o['kind'] == 'bed']
    bed_r = [(o['rect'][0], o['rect'][1], o['rect'][0] + o['rect'][2], o['rect'][1] + o['rect'][3]) for o in beds]
    # --- 地面(舗装): S・W1〜W3 = 平板、P = コンクリート、E・N・N2 = アスファルト ---
    kinds = ['pavers', 'pavers', 'pavers', 'pavers', 'pavers', 'concrete', 'asphalt', 'asphalt', 'asphalt']
    mats = {'pavers': 'XE_Pavers', 'concrete': 'XE_Concrete', 'asphalt': 'XE_Asphalt'}
    garbage = obs['garbage']['rect']
    gr = (garbage[0], garbage[1], garbage[0] + garbage[2], garbage[1] + garbage[3])
    for i, (x, z, w, d) in enumerate(fp):
        r = (x, z, x + w, z + d)
        holes = [porch] + bed_r
        for q in rect_sub(r, holes):
            flat(mb, q, 0.0, mats[kinds[i]])
    # アプローチと車路の境の縁石(S の東端 x=26.12 は E と同じ高さなので線だけ)
    # --- 植え込み: 縁石・土・低木 ---
    for o in beds:
        x0, z0, w, d = o['rect']; x1, z1 = x0 + w, z0 + d
        cw = 0.1
        for (a, b_, c_, d_) in ((x0, z0, x1, z0 + cw), (x0, z1 - cw, x1, z1), (x0, z0, x0 + cw, z1), (x1 - cw, z0, x1, z1)):
            mb.box((a, 0, b_), (c_, 0.15, d_), 'XE_Curb', keep=lambda k, c, n: k != '-y')
        flat(mb, (x0 + cw, z0 + cw, x1 - cw, z1 - cw), 0.12, 'XE_Soil')
        n = max(2, int(max(w, d) / 0.75))
        for i in range(n):
            t = (i + 0.5) / n
            cx = x0 + w * t if w >= d else x0 + w / 2 + RNG.uniform(-0.1, 0.1)
            cz = z0 + d / 2 + RNG.uniform(-0.1, 0.1) if w >= d else z0 + d * t
            rr = min(w, d) * 0.42 * RNG.uniform(0.8, 1.05)
            hh = o['h'] * RNG.uniform(0.75, 1.0)
            shrub(mb, cx, cz, rr, hh)
    # --- 駐車場: 白線・車止め・車 ---
    P = SITE['parking']
    for i in range(P['n'] + 1):
        z = P['z0'] + i * P['stall']
        flat(mb, (P['x0'], z - 0.05, P['x1'], z + 0.05), 0.004, 'XE_Line')
    flat(mb, (P['x1'] - 0.1, P['z0'], P['x1'], P['z0'] + P['n'] * P['stall']), 0.004, 'XE_Line')
    for i in range(P['n']):
        zc = P['z0'] + (i + 0.5) * P['stall']
        for sg in (-1, 1):
            mb.box((P['stopX'], 0, zc + sg * 0.45 - 0.35), (P['stopX'] + 0.15, 0.12, zc + sg * 0.45 + 0.35), 'XE_Curb', keep=lambda k, c, n: k != '-y')
    for i, c in enumerate(SITE['cars']):
        car(mb, c, f'XE_Car{i}')
    # バイク置場の白線とバイク
    for bk in SITE['bikes']:
        x0, x1, z0, z1 = bk['x0'], bk['x1'], bk['z0'], bk['z1']
        for (a, b_, c_, d_) in ((x0, z0, x1, z0 + 0.08), (x0, z1 - 0.08, x1, z1), (x0, z0, x0 + 0.08, z1), (x1 - 0.08, z0, x1, z1)):
            flat(mb, (a, b_, c_, d_), 0.004, 'XE_Line')
    mo = obs['motorbike']['rect']
    motorbike(mb, mo)
    # --- 駐輪場: 屋根つきのラックと自転車 ---
    for rk in SITE['racks']:
        rack(mb, rk)
    # --- ゴミ置場 ---
    garbage_box(mb, gr)
    # --- 照明柱 ---
    for (x, z) in SITE['poles']:
        pole(mb, x, z)
    # --- 境: 柵・擁壁・生垣・門 ---
    boundary(mb)
    # --- 下りていく車路(門の外。地形に沿う) ---
    road(mb)
    return mb.finish(col, {})


def shrub(mb, cx, cz, r, h):
    """低木(低ポリの丸い塊)。"""
    n = 7
    rings = [(0.12, 0.85), (0.45, 1.0), (0.8, 0.7), (1.0, 0.0)]
    prev = None
    for (fy, fr) in rings:
        ring = [(cx + r * fr * math.cos(2 * math.pi * (i + 0.5 * fy) / n) * RNG.uniform(0.9, 1.1), 0.12 + h * fy, cz + r * fr * math.sin(2 * math.pi * (i + 0.5 * fy) / n) * RNG.uniform(0.9, 1.1)) for i in range(n)]
        if prev is not None:
            for i in range(n):
                a, b_ = prev[i], prev[(i + 1) % n]
                c_, d_ = ring[(i + 1) % n], ring[i]
                nm = ((a[0] + b_[0]) / 2 - cx, 0.3, (a[2] + b_[2]) / 2 - cz)
                f = mb.quad([a, b_, c_, d_], nm, 'XE_Shrub')
                C.orient(f, nm)
        prev = ring


def car(mb, c, mat):
    x0, z0, w, d = c['rect']
    x1, z1 = x0 + w, z0 + d
    L = w; Wd = d; Hh = c['h']
    # 車体(下)・キャビン(上、ガラス)・車輪・灯火(頭=東)
    yb, ym = 0.28, 0.28 + (Hh - 0.28) * 0.48
    mb.box((x0 + 0.05, yb, z0), (x1, ym, z1), mat, keep=lambda k, c_, n: k != '-y')
    ca = c.get('cabin', 0.55)
    cx0, cx1 = x0 + L * (0.18 if ca < 0.6 else 0.06), x0 + L * (0.18 + ca if ca < 0.6 else 0.06 + ca + 0.1)
    cx1 = min(cx1, x1 - 0.5)
    mb.box((cx0, ym, z0 + 0.08), (cx1, Hh, z1 - 0.08), mat, mats={'+z': 'XE_CarGlass', '-z': 'XE_CarGlass', '+x': 'XE_CarGlass', '-x': 'XE_CarGlass'}, keep=lambda k, c_, n: k != '-y')
    for (wx, wz) in ((x0 + 0.75, z0 + 0.12), (x0 + 0.75, z1 - 0.12), (x1 - 0.8, z0 + 0.12), (x1 - 0.8, z1 - 0.12)):
        wheel(mb, wx, 0.3, wz, 0.3, 0.2, 'z', 'XE_Tire')
    for zz in (z0 + 0.15, z1 - 0.45):
        mb.box((x1, ym - 0.18, zz), (x1 + 0.01, ym - 0.06, zz + 0.3), 'XE_CarLamp', keep=lambda k, c_, n: k == '+x')
        mb.box((x0 + 0.04, ym - 0.16, zz), (x0 + 0.05, ym - 0.06, zz + 0.3), 'XE_CarTail', keep=lambda k, c_, n: k == '-x')


def motorbike(mb, r):
    x0, z0, w, d = r
    cx = x0 + w / 2
    wheel(mb, cx, 0.3, z0 + 0.35, 0.3, 0.1, 'x', 'XE_Tire')
    wheel(mb, cx, 0.3, z0 + d - 0.35, 0.3, 0.1, 'x', 'XE_Tire')
    mb.box((cx - 0.16, 0.35, z0 + 0.45), (cx + 0.16, 0.75, z0 + d - 0.5), 'XE_Car2')
    mb.box((cx - 0.14, 0.75, z0 + 0.6), (cx + 0.14, 0.86, z0 + 1.2), 'XE_Seat')
    mb.box((cx - 0.35, 0.95, z0 + d - 0.42), (cx + 0.35, 0.98, z0 + d - 0.38), 'XE_Steel')


def bicycle(mb, cx, cz):
    """自転車(東西向き。車輪2・フレーム・ハンドル・サドル)。"""
    for dx in (-0.55, 0.55):
        wheel(mb, cx + dx, 0.34, cz, 0.33, 0.04, 'z', 'XE_Tire', n=10)
    mb.box((cx - 0.55, 0.32, cz - 0.015), (cx + 0.3, 0.36, cz + 0.015), 'XE_Steel')
    mb.box((cx - 0.15, 0.36, cz - 0.015), (cx - 0.11, 0.86, cz + 0.015), 'XE_Steel')
    mb.box((cx - 0.13, 0.78, cz - 0.015), (cx + 0.42, 0.82, cz + 0.015), 'XE_Steel')
    mb.box((cx + 0.4, 0.34, cz - 0.015), (cx + 0.44, 1.0, cz + 0.015), 'XE_Steel')
    mb.box((cx + 0.4, 0.98, cz - 0.28), (cx + 0.44, 1.02, cz + 0.28), 'XE_Steel')
    mb.box((cx - 0.24, 0.86, cz - 0.07), (cx - 0.02, 0.92, cz + 0.07), 'XE_Seat')
    mb.box((cx + 0.46, 0.75, cz - 0.17), (cx + 0.78, 0.98, cz + 0.17), 'XE_Galv', keep=lambda k, c, n: k != '+y')   # 前かご


def rack(mb, rk):
    x0, x1, z0, z1 = rk['x0'], rk['x1'], rk['z0'], rk['z1']
    yr = 2.15
    # 屋根(片流れ)と柱
    mb.box((x0 - 0.1, yr, z0 - 0.1), (x1 + 0.1, yr + 0.05, z1 + 0.1), 'XE_Galv')
    for (px, pz) in ((x0 + 0.1, z0 + 0.1), (x0 + 0.1, z1 - 0.1), (x0 + 0.1, (z0 + z1) / 2)):
        mb.box((px - 0.04, 0, pz - 0.04), (px + 0.04, yr, pz + 0.04), 'XE_Galv', keep=lambda k, c, n: k not in ('+y', '-y'))
    mb.box((x0 + 0.06, 0.2, z0 + 0.1), (x0 + 0.14, 0.28, z1 - 0.1), 'XE_Galv')
    n = int((z1 - z0 - 0.3) / 0.62)
    for i in range(n):
        if RNG.random() < 0.3:
            continue
        cz = z0 + 0.35 + i * 0.62
        bicycle(mb, (x0 + x1) / 2 + RNG.uniform(-0.15, 0.15), cz)


def garbage_box(mb, r):
    x0, z0, x1, z1 = r
    h = 1.9; t = 0.15
    for (a, b_, c_, d_) in ((x0, z0, x1, z0 + t), (x0, z0, x0 + t, z1), (x1 - t, z0, x1, z1)):
        mb.box((a, 0, b_), (c_, h, d_), 'XE_Concrete', keep=lambda k, c, n: k != '-y')
    mb.box((x0 - 0.1, h + 0.1, z0 - 0.1), (x1 + 0.1, h + 0.16, z1 + 0.1), 'XE_Galv')
    for (px) in (x0 + t, (x0 + x1) / 2, x1 - t):
        mb.box((px - 0.04, 0, z1 - 0.06), (px + 0.04, h + 0.1, z1 + 0.02), 'XE_Steel', keep=lambda k, c, n: k not in ('+y', '-y'))
    for (a, b_) in ((x0 + t, (x0 + x1) / 2), ((x0 + x1) / 2, x1 - t)):
        q = [(a + 0.04, 0.05, z1 - 0.02), (b_ - 0.04, 0.05, z1 - 0.02), (b_ - 0.04, h, z1 - 0.02), (a + 0.04, h, z1 - 0.02)]
        C.orient(mb.quad(q, (0, 0, 1), 'XE_Fence'), (0, 0, 1))
    for i in range(4):
        bx = x0 + 0.4 + i * 1.15
        mb.box((bx, 0, z0 + 0.3), (bx + 0.8, 0.95, z0 + 1.2), 'XE_Bin', keep=lambda k, c, n: k != '-y')
        mb.box((bx - 0.02, 0.95, z0 + 0.28), (bx + 0.82, 1.0, z0 + 1.22), 'XE_BinLid', keep=lambda k, c, n: k != '-y')


POLE_LIGHTS = []


def pole(mb, x, z):
    h = 3.6
    cyl(mb, x, z, 0.06, 0, h, 'XE_Steel', n=8, caps=True)
    mb.box((x - 0.04, h - 0.05, z - 0.04), (x + 0.04, h, z + 0.45), 'XE_Steel')
    mb.box((x - 0.14, h - 0.12, z + 0.3), (x + 0.14, h + 0.02, z + 0.7), 'XE_Steel', keep=lambda k, c, n: k != '-y')
    C.orient(mb.quad([(x - 0.12, h - 0.121, z + 0.32), (x + 0.12, h - 0.121, z + 0.32), (x + 0.12, h - 0.121, z + 0.68), (x - 0.12, h - 0.121, z + 0.68)], (0, -1, 0), 'XE_Lamp'), (0, -1, 0))
    POLE_LIGHTS.append([x, h - 0.15, z + 0.5])


BOUNDARY = []


def boundary(mb):
    """敷地の外周を 0.5m ごとに見て、建物の外壁(柵なし)・擁壁(北)・生垣(西)・門(南東)・柵(他)に分ける。"""
    rects = SITE['footprint']
    f1 = FLOORS[1]
    blds = list(f1['footprint']) + [r['balcony']['rect'] for r in f1['rooms'] if r.get('balcony')]
    gate = SITE['gate']
    segs = BR._outline(rects)
    for (axis, plane, lo, hi, (ox, oz)) in segs:
        n = max(1, int(round((hi - lo) / 0.5)))
        runs = []
        for k in range(n):
            a, b_ = lo + (hi - lo) * k / n, lo + (hi - lo) * (k + 1) / n
            m = (a + b_) / 2
            px, pz = (m, plane + oz * 0.35) if axis == 'z' else (plane + ox * 0.35, m)
            kind = 'fence'
            if any(bx - 0.05 <= px <= bx + bw + 0.05 and bz - 0.05 <= pz <= bz + bd + 0.05 for (bx, bz, bw, bd) in blds):
                kind = None
            elif axis == 'z' and oz < 0 and abs(plane - B['N']) < 0.01:
                kind = 'wall'
            elif (axis == 'x' and ox < 0 and abs(plane - B['W']) < 0.01) or (axis == 'z' and oz < 0 and pz > 19.0 and px < 0.5):
                kind = 'hedge'
            elif axis == 'z' and oz > 0 and abs(plane - B['S']) < 0.01 and gate['x0'] <= m <= gate['x1']:
                kind = 'gate'
            if runs and runs[-1][2] == kind:
                runs[-1][1] = b_
            else:
                runs.append([a, b_, kind])
        for (a, b_, kind) in runs:
            if kind is None:
                continue
            BOUNDARY.append(dict(kind=kind, axis=axis, plane=plane, lo=a, hi=b_, out=[ox, oz]))
            pl = plane + (ox if axis == 'x' else oz) * T / 2       # 当たりの壁の芯
            def P(u, y, o=0.0):
                return (u, y, pl + o * oz) if axis == 'z' else (pl + o * ox, y, u)
            def box_along(u0, u1, y0, y1, o0, o1, mat, keep=None):
                p0, p1 = P(u0, y0, o0), P(u1, y1, o1)
                mb.box((min(p0[0], p1[0]), y0, min(p0[2], p1[2])), (max(p0[0], p1[0]), y1, max(p0[2], p1[2])), mat, keep=keep)
            nrm = (ox, 0, oz)
            if kind == 'wall':
                box_along(a, b_, -0.1, 2.85, -0.06, 0.3, 'XE_Concrete', keep=lambda k, c, n: k != '-y')
                box_along(a, b_, 2.85, 2.95, -0.1, 0.32, 'XE_Curb', keep=lambda k, c, n: k != '-y')
            elif kind == 'hedge':
                box_along(a, b_, 0, 0.18, -0.08, 0.08, 'XE_Curb', keep=lambda k, c, n: k != '-y')
                m_ = int((b_ - a) / 0.7) + 1
                for i in range(m_):
                    u = a + (b_ - a) * (i + 0.5) / m_
                    q = P(u, 0, 0.35)
                    shrub(mb, q[0], q[2], 0.55, 1.35)
            elif kind in ('fence', 'gate'):
                box_along(a, b_, -0.05, 0.3, -0.08, 0.08, 'XE_Curb', keep=lambda k, c, n: k != '-y')
                if kind == 'fence':
                    q0, q1 = P(a, 0.3, 0.0), P(b_, 1.5, 0.0)
                    if axis == 'z':
                        pts = [(a, 0.3, q0[2]), (b_, 0.3, q0[2]), (b_, 1.5, q0[2]), (a, 1.5, q0[2])]
                    else:
                        pts = [(q0[0], 0.3, a), (q0[0], 0.3, b_), (q0[0], 1.5, b_), (q0[0], 1.5, a)]
                    C.orient(mb.quad(pts, nrm, 'XE_Fence'), nrm)
                    m_ = int((b_ - a) / 2.0) + 1
                    for i in range(m_ + 1):
                        u = a + (b_ - a) * i / m_
                        box_along(u - 0.03, u + 0.03, 0.3, 1.55, -0.03, 0.03, 'XE_Steel', keep=lambda k, c, n: k != '-y')
                    box_along(a, b_, 1.5, 1.54, -0.025, 0.025, 'XE_Steel')
                else:
                    # 閉じた門(左右の門柱と横に渡したバー2本＝車路の出口。夜間は閉じている)
                    for u in (a, b_):
                        box_along(u - 0.12, u + 0.12, 0.0, 1.3, -0.12, 0.12, 'XE_Concrete', keep=lambda k, c, n: k != '-y')
                    for yy in (0.55, 1.0):
                        box_along(a + 0.12, b_ - 0.12, yy, yy + 0.07, -0.03, 0.03, 'XE_Galv')
                    for i in range(1, 8):
                        u = a + (b_ - a) * i / 8
                        box_along(u - 0.02, u + 0.02, 0.4, 1.07, -0.02, 0.02, 'XE_Galv')


ROAD = [(34.5, 34.5), (35.2, 44.0), (38.5, 55.0), (46.0, 66.0), (58.0, 75.5), (74.0, 82.0), (95.0, 86.0), (120.0, 88.0), (150.0, 92.0), (180.0, 99.0)]


def road_pts(step=2.0):
    pts = []
    for i in range(len(ROAD) - 1):
        (x0, z0), (x1, z1) = ROAD[i], ROAD[i + 1]
        L = math.hypot(x1 - x0, z1 - z0)
        n = max(1, int(L / step))
        for k in range(n):
            t = k / n
            pts.append((x0 + (x1 - x0) * t, z0 + (z1 - z0) * t))
    pts.append(ROAD[-1])
    return pts


def near_road(x, z, d):
    for i in range(len(ROAD) - 1):
        (x0, z0), (x1, z1) = ROAD[i], ROAD[i + 1]
        vx, vz = x1 - x0, z1 - z0
        L2 = vx * vx + vz * vz
        t = max(0.0, min(1.0, ((x - x0) * vx + (z - z0) * vz) / L2))
        if math.hypot(x - (x0 + vx * t), z - (z0 + vz * t)) < d:
            return True
    return False


def road(mb):
    pts = road_pts()
    hw = 2.6
    prev = None
    for i, (x, z) in enumerate(pts):
        if i + 1 < len(pts):
            tx, tz = pts[i + 1][0] - x, pts[i + 1][1] - z
        else:
            tx, tz = x - pts[i - 1][0], z - pts[i - 1][1]
        L = math.hypot(tx, tz) or 1
        nx, nz = -tz / L, tx / L
        l = (x + nx * hw, z + nz * hw); r = (x - nx * hw, z - nz * hw)
        yl = max(H(*l), H(x, z) - 0.6) + 0.07 if z > B['S'] + 0.5 else 0.0
        yr = max(H(*r), H(x, z) - 0.6) + 0.07 if z > B['S'] + 0.5 else 0.0
        cur = ((l[0], yl, l[1]), (r[0], yr, r[1]))
        if prev is not None:
            q = [prev[1], prev[0], cur[0], cur[1]]
            f = mb.quad(q, (0, 1, 0), 'XE_Asphalt')
            C.orient(f, (0, 1, 0))
        prev = cur


# ---------------------------------------------------------------- 地形
TERRAIN = dict(center=list(CEN), rings=0, segs=144, rMax=1420.0)


def build_terrain(col):
    me = bpy.data.meshes.new('Terrain')
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    radii = [0.0]
    r = 1.5
    while r < 62:
        radii.append(r); r += 1.5
    while r < TERRAIN['rMax']:
        radii.append(r); r *= 1.075
    radii.append(TERRAIN['rMax'])
    S = TERRAIN['segs']
    TERRAIN['rings'] = len(radii)
    verts = []
    for i, rr in enumerate(radii):
        row = []
        for j in range(S if rr > 0 else 1):
            a = 2 * math.pi * j / S
            x, z = CEN[0] + rr * math.cos(a), CEN[1] + rr * math.sin(a)
            y = H(x, z)
            row.append((bm.verts.new(C.g2b(x, y, z)), x, z))
        verts.append(row)
    size = 4.0
    def face(vs):
        try:
            f = bm.faces.new([v[0] for v in vs])
        except ValueError:
            return
        for loop, v in zip(f.loops, vs):
            loop[uv].uv = (v[1] / size, -v[2] / size)
        f.smooth = True
    for j in range(S):
        face([verts[0][0], verts[1][j], verts[1][(j + 1) % S]])
    for i in range(1, len(radii) - 1):
        for j in range(S):
            face([verts[i][j], verts[i + 1][j], verts[i + 1][(j + 1) % S], verts[i][(j + 1) % S]])
    bm.normal_update()
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    bm.to_mesh(me); bm.free()
    me.materials.append(C.MATS['XE_Ground'])
    ob = bpy.data.objects.new('Terrain', me)
    col.objects.link(ob)
    return ob


# ---------------------------------------------------------------- 木(近景の低ポリ・中景のビルボード)と配置
def tree_proto(col, name, tiers, trunk_h=0.3):
    """高さ 1 に正規化した針葉樹。tiers = [(下端, 上端, 半径)]。"""
    mb = C.MeshBuilder(name)
    n = 7
    cyl(mb, 0, 0, 0.022, 0, trunk_h + 0.05, 'XE_Bark', n=5, caps=False)
    for (y0, y1, r) in tiers:
        ring = [(r * math.cos(2 * math.pi * i / n), y0, r * math.sin(2 * math.pi * i / n)) for i in range(n)]
        tip = (0.0, y1, 0.0)
        for i in range(n):
            a, b_ = ring[i], ring[(i + 1) % n]
            nm = ((a[0] + b_[0]) / 2, r * 0.6, (a[2] + b_[2]) / 2)
            f = mb.bm.faces.new([mb.bm.verts.new(C.g2b(*a)), mb.bm.verts.new(C.g2b(*b_)), mb.bm.verts.new(C.g2b(*tip))])
            f.material_index = mb._mi('XE_Needle')
            C.orient(f, nm)
        mb.poly(list(reversed(ring)), (0, -1, 0), 'XE_Needle')
    return mb.finish(col, {})


def billboard_proto(col):
    mb = C.MeshBuilder('Billboard')
    w = 0.5
    for (dx, dz) in ((1, 0), (0, 1)):
        pts = [(-dx * w / 2, 0, -dz * w / 2), (dx * w / 2, 0, dz * w / 2), (dx * w / 2, 1, dz * w / 2), (-dx * w / 2, 1, -dz * w / 2)]
        f = mb.quad(pts, (-dz, 0, dx), 'XE_Billboard')
        C.orient(f, (-dz, 0, dx))
        C.set_uv(f, mb, [(0, 0), (1, 0), (1, 1), (0, 1)])
    return mb.finish(col, {})


def in_site_exclusion(x, z, m):
    return B['W'] - m <= x <= B['E'] + m and B['N'] - m <= z <= B['S'] + m


def place_trees():
    near, bb = [], []
    # 近景: 4.2m の揺らいだ格子、中心から 150m まで
    s = 4.2
    R1 = 150.0
    k = int(R1 / s) + 2
    for i in range(-k, k + 1):
        for j in range(-k, k + 1):
            x = CEN[0] + i * s + RNG.uniform(-1.6, 1.6)
            z = CEN[1] + j * s + RNG.uniform(-1.6, 1.6)
            r = math.hypot(x - CEN[0], z - CEN[1])
            if r > R1 or in_site_exclusion(x, z, 2.2):
                continue
            if near_road(x, z, 5.5):
                continue
            oe = x - B['E']
            if oe > 0 and oe < 11 and B['N'] - 4 < z < B['S'] + 6:    # 駐車場の東の急斜面の上は空ける(谷が見える)
                continue
            hgt = RNG.uniform(14.0, 24.0)
            if 0 < oe < 40 and B['N'] - 10 < z < B['S'] + 10:
                hgt *= 0.62 + 0.38 * (oe / 40.0)
            ow = B['W'] - x
            if 0 < ow < 22 and z > B['N'] - 6:                          # 西(屋上A の南西の眺め)も敷地の際は低い木
                hgt *= 0.55 + 0.45 * (ow / 22.0)
            y = H(x, z) - 0.3
            near.append((x, y, z, hgt, RNG.uniform(0, 6.283), RNG.randrange(2), RNG.uniform(0.75, 1.15)))
    # 中景: 140m〜1200m、間隔は遠いほど広く
    r = 140.0
    while r < 1200.0:
        sp = 10.5 + 0.0075 * (r - 140.0)
        n = int(2 * math.pi * r / sp)
        a0 = RNG.uniform(0, 6.283)
        for i in range(n):
            a = a0 + 2 * math.pi * (i + RNG.uniform(-0.35, 0.35)) / n
            rr = r + RNG.uniform(-sp * 0.45, sp * 0.45)
            x, z = CEN[0] + rr * math.cos(a), CEN[1] + rr * math.sin(a)
            if near_road(x, z, 7):
                continue
            hgt = RNG.uniform(16.0, 26.0)
            y = H(x, z) - 0.8
            bb.append((x, y, z, hgt, RNG.randrange(4), RNG.uniform(0.7, 1.2)))
        r += sp
    return near, bb


def write_instances(near, bb):
    path = os.path.join(ROOT, ARGS['inst'])
    with open(path, 'wb') as f:
        f.write(struct.pack('<4sII', b'N2TI', len(near), len(bb)))
        for (x, y, z, h, rot, v, t) in near:
            f.write(struct.pack('<7h', int(round(x * 10)), int(round(y * 10)), int(round(z * 10)), int(round(h * 100)), int(round(rot * 1000)), v, int(round(t * 1000))))
        for (x, y, z, h, v, t) in bb:
            f.write(struct.pack('<6h', int(round(x * 10)), int(round(y * 10)), int(round(z * 10)), int(round(h * 100)), v, int(round(t * 1000))))
    return path


# ---------------------------------------------------------------- 遠景(山並み・街)
RIDGES = [dict(R=1250.0, haze=0.45, base=40.0, amp=70.0), dict(R=1750.0, haze=0.68, base=150.0, amp=150.0), dict(R=2400.0, haze=0.84, base=260.0, amp=200.0)]
CITY = dict(R=1480.0, az0=TEXMETA['cityAzDeg'][0], az1=TEXMETA['cityAzDeg'][1], y0=-122.0, y1=-22.0)


def ridge_profile(i, a):
    rd = RIDGES[i]
    c0, c1 = math.radians(CITY['az0']), math.radians(CITY['az1'])
    cc, hw = (c0 + c1) / 2, (c1 - c0) / 2
    d = abs(math.atan2(math.sin(a - cc), math.cos(a - cc)))
    notch = 1.0 - _smooth(hw * 0.75, hw * 1.35, d)
    def sn(f, ph):
        return math.sin(a * f + ph)
    base = rd['base'] + rd['amp'] * (0.55 * sn(3, 1.1 + i) + 0.3 * sn(7, 2.3 * i) + 0.15 * sn(13, 0.7 + i))
    jag = 4.0 * (sn(180, i) + 0.6 * sn(411, 2 * i)) + RNG.uniform(-3.0, 3.0)
    if i == 0:
        # 地形の縁(r 1250〜1420)より高く(縁を隠す)
        hm = max(H(CEN[0] + rr * math.cos(a), CEN[1] + rr * math.sin(a)) for rr in (1250.0, 1330.0, 1420.0))
        base = max(base, hm + 25.0)
        return base * (1 - notch) + (-150.0) * notch + jag * (1 - notch)
    if i == 1:
        low = -30.0 + 45.0 * (0.5 + 0.5 * sn(9, 0.3))
        return base * (1 - notch) + low * notch + jag
    return base + jag


def build_ridges(col):
    out = []
    N = 720
    for i, rd in enumerate(RIDGES):
        me = bpy.data.meshes.new(f'Ridge_{i}')
        bm = bmesh.new()
        uv = bm.loops.layers.uv.new('UVMap')
        top, bot = [], []
        for j in range(N):
            a = 2 * math.pi * j / N
            y = ridge_profile(i, a)
            x, z = rd['R'] * math.cos(a), rd['R'] * math.sin(a)
            top.append(bm.verts.new(C.g2b(x, y, z))); bot.append(bm.verts.new(C.g2b(x, -520.0, z)))
        for j in range(N):
            k = (j + 1) % N
            f = bm.faces.new([bot[j], bot[k], top[k], top[j]])
            for loop, (u, v) in zip(f.loops, ((j / N, 0), ((j + 1) / N, 0), ((j + 1) / N, 1), (j / N, 1))):
                loop[uv].uv = (u, v)
        bm.normal_update()
        for f in bm.faces:   # 内向き(中心=カメラを向く)
            c = f.calc_center_median()
            if f.normal.x * c.x + f.normal.y * c.y > 0:
                f.normal_flip()
        bm.to_mesh(me); bm.free()
        me.materials.append(C.MATS[f'XE_Ridge{i}'])
        ob = bpy.data.objects.new(f'Ridge_{i}', me)
        col.objects.link(ob)
        out.append(ob)
    # 街の帯
    me = bpy.data.meshes.new('City')
    bm = bmesh.new(); uv = bm.loops.layers.uv.new('UVMap')
    n = 160
    a0, a1 = math.radians(CITY['az0']), math.radians(CITY['az1'])
    rows = []
    for j in range(n + 1):
        a = a0 + (a1 - a0) * j / n
        x, z = CITY['R'] * math.cos(a), CITY['R'] * math.sin(a)
        rows.append((bm.verts.new(C.g2b(x, CITY['y0'], z)), bm.verts.new(C.g2b(x, CITY['y1'], z)), j / n))
    for j in range(n):
        (b0, t0, u0), (b1, t1, u1) = rows[j], rows[j + 1]
        f = bm.faces.new([b0, b1, t1, t0])
        for loop, uvv in zip(f.loops, ((u0, 0), (u1, 0), (u1, 1), (u0, 1))):
            loop[uv].uv = uvv
    bm.normal_update()
    for f in bm.faces:
        c = f.calc_center_median()
        if f.normal.x * c.x + f.normal.y * c.y > 0:
            f.normal_flip()
    bm.to_mesh(me); bm.free()
    me.materials.append(C.MATS['XE_City'])
    ob = bpy.data.objects.new('City', me)
    col.objects.link(ob)
    out.append(ob)
    return out


# ---------------------------------------------------------------- 書き出し
def export(objs, col):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    out = os.path.join(ROOT, ARGS['out'])
    rna = bpy.ops.export_scene.gltf.get_rna_type()
    props = {p.identifier for p in rna.properties}
    kw = dict(filepath=out, export_format='GLB', export_texcoords=True, export_normals=True,
              export_materials='EXPORT', export_yup=True, export_apply=False, export_extras=True,
              export_lights=False, export_cameras=False, export_image_format='NONE', use_selection=True)
    kw = {k: v for k, v in kw.items() if k in props or k == 'filepath'}
    bpy.ops.export_scene.gltf(**kw)
    log(f'exported {out} ({os.path.getsize(out) / 1e6:.2f} MB)')
    return out


def main():
    wipe()
    materials()
    col = bpy.data.collections.new('EXT')
    bpy.context.scene.collection.children.link(col)
    tmp = bpy.data.collections.new('TMP')
    bpy.context.scene.collection.children.link(tmp)
    nodes = []
    bands = {}
    for L in range(1, 8):
        parts = extract_band(L, tmp)
        parts.append(enterable_backing(L, tmp))
        if L == 1:
            parts.append(lobby_glow(tmp))
        j = join(parts, f'ExtBand_{L}', {'n2_kind': 'extband', 'n2_band': L})
        bands[L] = dict(tris=sum(len(p.vertices) - 2 for p in j.data.polygons))
        for c_ in list(j.users_collection):
            c_.objects.unlink(j)
        col.objects.link(j)
        nodes.append(j)
        log(f'band {L}: {bands[L]["tris"]} tris')
    C.BASE_Y = 0.0
    al = join(build_always(tmp), 'ExtAlways', {'n2_kind': 'extalways'})
    for c_ in list(al.users_collection):
        c_.objects.unlink(al)
    col.objects.link(al); nodes.append(al)
    site = build_site(col)
    site['n2_kind'] = 'site'; nodes.append(site)
    ter = build_terrain(col)
    ter['n2_kind'] = 'terrain'; nodes.append(ter)
    p0 = tree_proto(col, 'TreeProto_0', [(0.20, 0.50, 0.125), (0.38, 0.68, 0.105), (0.55, 0.84, 0.08), (0.71, 1.0, 0.055)])
    p1 = tree_proto(col, 'TreeProto_1', [(0.24, 0.56, 0.15), (0.45, 0.76, 0.12), (0.64, 0.92, 0.085), (0.8, 1.0, 0.05)], trunk_h=0.35)
    for p in (p0, p1):
        p['n2_kind'] = 'treeproto'; nodes.append(p)
    bbp = billboard_proto(col); bbp['n2_kind'] = 'billboard'; nodes.append(bbp)
    for o in build_ridges(col):
        o['n2_kind'] = 'city' if o.name == 'City' else 'ridge'
        nodes.append(o)
    near, bb = place_trees()
    inst = write_instances(near, bb)
    log(f'trees: near {len(near)} / billboards {len(bb)} → {os.path.getsize(inst) / 1e3:.0f} KB')
    for o in tmp.objects:
        bpy.data.objects.remove(o, do_unlink=True)
    out = export(nodes, col)
    used = set()
    for o in nodes:
        for s in o.material_slots:
            if s.material:
                used.add(s.material.name)
    manifest = dict(
        version=1, glb=os.path.basename(out), instances=os.path.basename(ARGS['inst']),
        materials={k: v for k, v in C.MAT_TEX.items() if k in used},
        bands={str(L): dict(y0=(L - 1) * FH, y1=L * FH, **v) for L, v in bands.items()},
        litWindows=LIT, poleLights=POLE_LIGHTS,
        porchLights=[[17.6 - 1.0, C.PORCH_CH - 0.01, 29.22], [17.6 + 1.0, C.PORCH_CH - 0.01, 29.22]],
        pilotisLight=[23.6, FH - 0.2, 25.2],
        terrain=TERRAIN, ridges=[dict(R=r['R'], haze=r['haze']) for r in RIDGES], city=CITY,
        moon=dict(azDeg=TEXMETA['moonAzDeg'], elDeg=TEXMETA['moonElDeg']), skyK=TEXMETA['skyK'],
        trees=dict(near=len(near), billboards=len(bb), nearFields='x10,y10,z10,h100,rot1000,variant,tint1000', bbFields='x10,y10,z10,h100,variant,tint1000'),
        boundary=BOUNDARY, road=ROAD,
    )
    with open(os.path.join(ROOT, ARGS['manifest']), 'w') as f:
        json.dump(manifest, f, indent=1, ensure_ascii=False)
    log(f'manifest: {len(manifest["materials"])} materials, lit windows {[w["room"] for w in LIT]}')
    if ARGS['blend']:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, ARGS['blend']), compress=True)


if __name__ == '__main__':
    main()
