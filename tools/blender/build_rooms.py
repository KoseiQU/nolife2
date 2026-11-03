# build_rooms.py — P3b: 入れる部屋の内装・全居室のバルコニー・屋上A・外の塊(マス)。build_floor.py から呼ぶ(ctx = build_floor モジュール)。
#
#  データは data/building.json(src/interior_layout.js が作った room.interior / room.balcony / room.window、floor.roofA / gates)。
#  ここで作るものは全部「部屋の組」(n2_lm=2): 階ごとの2枚目のライトマップ(floor_N_rooms_lightmap)に焼く。材質名は MR_ で始める
#  (実行時 world.js が MR_ の材質に2枚目のライトマップを貼る)。MX_ の材質はライトマップを使わない(ガラス・動く障子・細い格子・外の塊)。
#  動くもの: 掃き出し窓の障子(n2_kind 'winsash')、クローゼットの折戸(n2_kind 'closetdoor')、ロッカーの扉(n2_kind 'lockerdoor')。
#  座標は build_floor と同じゲーム座標(x=東, z=南, y=上)。

import json, math, os
import bpy

C = None          # build_floor モジュール
PALUV = APPUV = PRTUV = WRKUV = None
ROOMS_PROPS = {'n2_lm': 2}
WIN_H = 2.0
FACING = {'E': (1, 0), 'W': (-1, 0), 'S': (0, 1), 'N': (0, -1)}
KEY_OF = {'E': '+x', 'W': '-x', 'S': '+z', 'N': '-z'}
CURTAIN_STATES = {}


def init(ctx):
    global C, PALUV, APPUV, PRTUV, WRKUV
    C = ctx
    PALUV = json.load(open(os.path.join(ctx.TEX, 'room_palette.json')))
    APPUV = json.load(open(os.path.join(ctx.TEX, 'room_appliances.json')))
    PRTUV = json.load(open(os.path.join(ctx.TEX, 'room_prints.json')))
    WRKUV = json.load(open(os.path.join(ctx.TEX, 'room_wreck.json')))   # P5b-1: 220 の壁の文字・引っかき傷・写真


# ---------------------------------------------------------------- 材質
def build_materials(ctx):
    pm, tf, tex, img = ctx.pbr_material, ctx.tex_files, ctx.tex, ctx.load_img
    MT = ctx.MAT_TEX
    pm('MR_Wall', files=tf('wall_cloth'), size=1.0, rough=0.85); MT['MR_Wall']['tint'] = [1.02, 1.02, 0.99]
    pm('MR_Ceil', files=tf('wall_cloth'), size=1.6, rough=0.9); MT['MR_Ceil']['tint'] = [1.04, 1.04, 1.02]
    pm('MR_Floor', files=tf('flooring'), size=1.2, rough=0.5)
    pm('MR_FloorZ', files=tf('flooring'), size=1.2, rot=True, rough=0.5)
    pm('MR_Genkan', files=tf('stone_floor'), size=0.6, rough=0.5); MT['MR_Genkan']['tint'] = [0.42, 0.42, 0.44]
    pm('MR_Base', base=(0.30, 0.285, 0.27), rough=0.5)
    pm('MR_WoodLight', files=tf('door_wood'), size=1.0, rot=True, rough=0.5); MT['MR_WoodLight']['tint'] = [1.3, 1.25, 1.15]
    pm('MR_DeskWood', files=tf('door_wood'), size=1.0, rough=0.5); MT['MR_DeskWood']['tint'] = [1.1, 1.02, 0.92]
    for name, rough in (('MR_Pal', 0.85), ('MR_PalGloss', 0.35)):
        pm(name, base=(1, 1, 1), rough=rough)
        ctx._set_base_tex(ctx.MATS[name], img(tex('room_palette.png'), False))
    pm('MR_Appl', base=(1, 1, 1), rough=0.4)
    ctx._set_base_tex(ctx.MATS['MR_Appl'], img(tex('room_appliances.png'), False))
    pm('MR_Print', base=(1, 1, 1), rough=0.7)
    ctx._set_base_tex(ctx.MATS['MR_Print'], img(tex('room_prints.png'), False))
    pm('MR_Wreck', base=(1, 1, 1), rough=0.85)                       # P5b-1: 220 の壁の文字・引っかき傷(地は壁のクロス)・写真
    ctx._set_base_tex(ctx.MATS['MR_Wreck'], img(tex('room_wreck.jpg'), False))
    pm('MR_Mirror', base=(0.9, 0.9, 0.9), rough=0.03, metal=1.0)
    pm('MR_Metal', base=(0.62, 0.62, 0.61), rough=0.35, metal=1.0)
    pm('MR_Facade', files=tf('concrete', rough=False), size=2.0, rough=0.85); MT['MR_Facade']['tint'] = [1.3, 1.3, 1.27]
    pm('MR_BalFloor', files=tf('floor_sheet'), size=1.0, rough=0.7, normal_strength=0.4); MT['MR_BalFloor']['tint'] = [0.55, 0.56, 0.55]
    pm('MR_Concrete', files=tf('concrete', rough=False), size=2.0, rough=0.9)
    pm('MR_Roof', base=(0.29, 0.32, 0.30), rough=0.85)
    pm('MR_Frost', base=(0.74, 0.81, 0.83), rough=0.22)
    pm('MR_Partition', base=(0.55, 0.56, 0.55), rough=0.5)
    pm('MR_Rail', base=(0.78, 0.78, 0.76), rough=0.35, metal=0.4)
    pm('MR_Alu', base=(0.42, 0.43, 0.42), rough=0.45, metal=0.0)       # アルミの枠(つや消しの塗装に近い見え方)
    pm('MR_OfficeFloor', files=tf('floor_sheet'), size=1.0, rough=0.6, normal_strength=0.5); MT['MR_OfficeFloor']['tint'] = [0.86, 0.87, 0.85]
    pm('MR_OfficeCeil', files=tf('ceiling_tile'), size=3.0, rough=0.9)
    _furniture_materials(ctx)
    # ライトマップなし(動く・透明・細い・遠景)
    pm('MX_Alu', base=(0.42, 0.43, 0.42), rough=0.45, metal=0.0)
    pm('MX_WinGlass', base=(0.55, 0.62, 0.66), rough=0.05, alpha=0.16)
    pm('MX_Bars', files={'albedo': tex('rail_bars.png')}, size=1.1, rough=0.4, metal=0.5)   # 実行時はアルファテスト・両面(world.js)
    pm('MX_Mass', files=tf('concrete', rough=False), size=2.0, rough=0.9); MT['MX_Mass']['tint'] = [0.95, 0.95, 0.93]
    pm('MX_WinOut', base=(0.03, 0.035, 0.04), rough=0.2, emit=(0.45, 0.55, 0.85), emit_strength=0.35)
    pm('MX_Void', base=(0.0, 0.0, 0.0), rough=1.0)
    pm('MX_SecMon', base=(0.2, 0.2, 0.2), rough=0.2, emit_tex=img(tex('room_prints.png'), False), emit_strength=0.6)
    pm('MX_Ground', files=tf('paving', rough=False), size=2.0, rough=0.9)


# ---------------------------------------------------------------- P6b-E2: 居室の家具の質感(DESIGN §3.11 #2)
#  木部(机の天板・ベッドのフレーム/脚/頭の板・シューズケースの天板・壁の棚板) = ニス仕上げ: 木目の albedo(door_wood)は従来のまま、
#    粗さ = furn_wood_roughness(0.31〜0.39、木目の濃い筋ほど粗い)・法線は木目を弱めに(0.35。ニスが導管を埋める)・クリアコート 0.4(粗さ 0.18)
#  金属脚(机の脚・椅子の支柱・倒れた椅子の脚) = roughness 0.35・metal 1.0(椅子の十字の台座は樹脂のまま)
#  シーツ・布団・枕・マットレス = 布: 平織りの albedo(無彩色)× 色ごとの tint・法線に織りの凹凸・roughness 0.85・sheen 0.3(sheenColorFactor)
#  形(面の数・並び)は従来と同じ(色見本の面を同じ面のまま材質だけ替える)→ 部屋の組のライトマップ UV は変わらず、再ベイク不要
#  食堂・管理室・シアターの什器と玄関の框は従来の MR_DeskWood のまま(対象外)
VARNISH_WOOD = ('MR_VarnishWood', 'MR_VarnishWoodLight')
CLOTH_KEYS = ('white', 'mattress', 'blue', 'charcoal', 'terracotta', 'sage', 'beige', 'lavender', 'navy', 'gray', 'olive', 'wine',
              'lightblue', 'brown', 'teal', 'oldgray', 'rust', 'green', 'cream', 'denim', 'pink', 'khaki')
CLOTH_SIZE = 0.40        # tools/room_textures.py の CLOTH_SIZE と同じ(織りの1枚 = 0.25m 角)
CLOTH_USED = set()


def _bsdf(m):
    return m.node_tree.nodes.get('Principled BSDF')


def _srgb2lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _img_mean_lin(path, rect=None):
    """画像(sRGB)の矩形(Blender の UV 0..1)の全画素の平均を線形で(間引くと 8px 周期の織りと位相がそろって偏る)。"""
    import numpy as np
    im = bpy.data.images.load(path, check_existing=False)
    w, h = im.size
    px = np.empty(w * h * 4, np.float32)
    im.pixels.foreach_get(px)
    bpy.data.images.remove(im)
    px = px.reshape(h, w, 4)[..., :3]
    u0, v0, u1, v1 = rect or (0, 0, 1, 1)
    x0, x1 = int(u0 * w), max(int(u0 * w) + 1, int(u1 * w))
    y0, y1 = int(v0 * h), max(int(v0 * h) + 1, int(v1 * h))
    c = px[y0:y1, x0:x1].reshape(-1, 3).astype(np.float64)
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return [float(v) for v in c.mean(0)]


def _furniture_materials(ctx):
    pm, tf, tex = ctx.pbr_material, ctx.tex_files, ctx.tex
    MT = ctx.MAT_TEX
    wood = {'albedo': tex('door_wood_albedo.jpg'), 'normal': tex('door_wood_normal.jpg'), 'roughness': tex('furn_wood_roughness.jpg')}
    for name, tint in (('MR_VarnishWood', [1.1, 1.02, 0.92]), ('MR_VarnishWoodLight', [1.3, 1.25, 1.15])):
        m = pm(name, files=wood, size=1.0, rough=0.35, normal_strength=0.35)
        MT[name]['tint'] = tint
        b = _bsdf(m)
        b.inputs['Coat Weight'].default_value = 0.4
        b.inputs['Coat Roughness'].default_value = 0.18
    # 金属は実行時に共通の環境(明るいスタジオ)を metalEnv で映すので、地の色(F0)が明るいと暗い部屋で脚が光って見える
    #  → 黒い焼付の鋼管に近い暗い F0。懐中電灯の当たる面だけ鈍く光る
    pm('MR_LegMetal', base=(0.10, 0.10, 0.105), rough=0.35, metal=1.0)    # 机の脚(黒い鋼管)
    pm('MR_SteelMetal', base=(0.22, 0.22, 0.225), rough=0.35, metal=1.0)  # 椅子の支柱・倒れた椅子の脚(鋼のガス圧支柱)
    base = _img_mean_lin(tex('cloth_weave_albedo.jpg'))
    pal = json.load(open(os.path.join(ctx.TEX, 'room_palette.json')))   # init() より先に呼ばれるので自前で読む
    for k in CLOTH_KEYS:
        if k not in pal:
            continue
        name = 'MR_Cloth_' + k
        m = pm(name, files={'albedo': tex('cloth_weave_albedo.jpg'), 'normal': tex('cloth_weave_normal.jpg')}, size=CLOTH_SIZE, rough=0.85,
               normal_strength=0.8)
        cell = _img_mean_lin(tex('room_palette.png'), pal[k])
        MT[name]['tint'] = [round(cell[c] / max(base[c], 1e-4), 4) for c in range(3)]
        b = _bsdf(m)
        # sheen 0.3 = sheenColorFactor の最大成分を 0.3 にした布の色(白い sheen だと濃い色の布が白っぽく褪せて見える)
        mx = max(max(cell), 1e-4)
        b.inputs['Sheen Weight'].default_value = 1.0
        b.inputs['Sheen Tint'].default_value = (0.3 * cell[0] / mx, 0.3 * cell[1] / mx, 0.3 * cell[2] / mx, 1.0)
        b.inputs['Sheen Roughness'].default_value = 0.6


def cloth(key):
    """寝具の色見本キー → 布の材質(無ければ None = 従来の色見本)。"""
    if key in CLOTH_KEYS and key in PALUV:
        CLOTH_USED.add(key)
        return 'MR_Cloth_' + key
    return None


# ---------------------------------------------------------------- 幾何の道具
def box_faces(mn, mx):
    x0, y0, z0 = mn; x1, y1, z1 = mx
    return {
        '+x': ([(x1, y0, z1), (x1, y0, z0), (x1, y1, z0), (x1, y1, z1)], (1, 0, 0)),
        '-x': ([(x0, y0, z0), (x0, y0, z1), (x0, y1, z1), (x0, y1, z0)], (-1, 0, 0)),
        '+z': ([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], (0, 0, 1)),
        '-z': ([(x1, y0, z0), (x0, y0, z0), (x0, y1, z0), (x1, y1, z0)], (0, 0, -1)),
        '+y': ([(x0, y1, z1), (x1, y1, z1), (x1, y1, z0), (x0, y1, z0)], (0, 1, 0)),
        '-y': ([(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], (0, -1, 0)),
    }


def uv_rect(r, inset=0.0):
    u0, v0, u1, v1 = r
    du, dv = (u1 - u0) * inset, (v1 - v0) * inset
    return [(u0 + du, v0 + dv), (u1 - du, v0 + dv), (u1 - du, v1 - dv), (u0 + du, v1 - dv)]


class B:
    """MeshBuilder の薄い包み: 色見本(palette)・アトラス(appliances/prints)の面を張る。"""
    def __init__(self, name):
        self.mb = C.MeshBuilder(name)
        self.name = name

    def box(self, mn, mx, mat, keep=None, mats=None):
        mn, mx = _mm(mn, mx)
        return self.mb.box(mn, mx, mat, keep=keep, mats=mats)

    def pbox(self, mn, mx, key, gloss=False, keep=None, front=None, front_uv=None, front_mat=None, cull=(), tile=None):
        """全面を色見本 key で。front=('+x'…) の面だけアトラス(front_mat, front_uv)に。
        P6b-E2: tile = 材質名を渡すと色見本の代わりにその材質(世界座標の UV)で張る。面の数・並びは同じ(ライトマップの UV を変えない)。
        容量のため、床から 0.95m より低い箱の底面(下から見えない)と天井に接する上面は張らない。cull = 張らない面(壁に付く背面など)。"""
        mn, mx = _mm(mn, mx)
        if keep is None:
            low = mn[1] - C.BASE_Y < 0.95
            top = mx[1] - C.BASE_Y > C.CEIL_H - 0.01
            keep = lambda k, c, n: not ((k == '-y' and low) or (k == '+y' and top) or k in cull)
        mat = 'MR_PalGloss' if gloss else 'MR_Pal'
        for k, (pts, n) in box_faces(mn, mx).items():
            c = tuple(sum(p[i] for p in pts) / 4 for i in range(3))
            if keep is not None and not keep(k, c, n):
                continue
            if front is not None and k == front and front_uv is not None:
                f = self.mb.quad(pts, n, front_mat)
                C.set_uv(f, self.mb, uv_rect(front_uv))
            elif tile is not None:
                self.mb.quad(pts, n, tile)
            else:
                f = self.mb.quad(pts, n, mat)
                C.set_uv(f, self.mb, uv_rect(PALUV[key]))

    def ibox(self, mn, mx, mat, keep=None):
        """内向きの面の箱(中から見る: クローゼットの内側など)。keep の key は内向きの法線の向き(例: 左の側面 = '+x')。"""
        mn, mx = _mm(mn, mx)
        flip = {'+x': '-x', '-x': '+x', '+z': '-z', '-z': '+z', '+y': '-y', '-y': '+y'}
        for k, (pts, n) in box_faces(mn, mx).items():
            ki = flip[k]
            ni = (-n[0], -n[1], -n[2])
            c = tuple(sum(p[i] for p in pts) / 4 for i in range(3))
            if keep is not None and not keep(ki, c, ni):
                continue
            self.quad(list(reversed(pts)), ni, mat)

    def pquad(self, pts, n, key, gloss=False):
        f = C.orient(self.mb.quad(pts, n, 'MR_PalGloss' if gloss else 'MR_Pal'), n)
        C.set_uv(f, self.mb, _uv_by_order(f, self.mb, pts, uv_rect(PALUV[key])))
        return f

    def aquad(self, pts, n, mat, rect):
        """アトラスの面(pts は 左下・右下・右上・左上 の順=外から見て正立)。"""
        f = self.mb.quad(pts, n, mat)
        C.set_uv(f, self.mb, uv_rect(rect))
        return f

    def quad(self, pts, n, mat):
        return C.orient(self.mb.quad(pts, n, mat), n)

    def finish(self, col, props=None):
        p = dict(ROOMS_PROPS); p.update(props or {})
        return self.mb.finish(col, p)


def _uv_by_order(f, mb, pts, uvs):
    return uvs


def _mm(a, b):
    return (min(a[0], b[0]), min(a[1], b[1]), min(a[2], b[2])), (max(a[0], b[0]), max(a[1], b[1]), max(a[2], b[2]))


def front_pts(mn, mx, face):
    """箱の face 面の4点(外から見て 左下・右下・右上・左上)。"""
    return box_faces(mn, mx)[face][0]


class IL:
    """家具の局所座標: a = 正面から見て左端から右へ、d = 正面の面から奥へ、y = 家具の床から上。"""
    def __init__(self, it, base):
        x0, z0, x1, z1 = it['b']
        F = FACING[it['f']]
        R = (F[1], -F[0])
        self.F, self.R, self.f = F, R, it['f']
        ox = (x1 if F[0] > 0 else x0) if F[0] != 0 else (x0 if R[0] > 0 else x1)
        oz = (z1 if F[1] > 0 else z0) if F[1] != 0 else (z0 if R[1] > 0 else z1)
        self.o = (ox, oz)
        self.W = (x1 - x0) if F[0] == 0 else (z1 - z0)
        self.D = (z1 - z0) if F[0] == 0 else (x1 - x0)
        self.base = base + it['y'][0]
        self.H = it['y'][1] - it['y'][0]
        self.front = KEY_OF[it['f']]

    def w(self, a, y, d):
        return (self.o[0] + self.R[0] * a - self.F[0] * d, self.base + y, self.o[1] + self.R[1] * a - self.F[1] * d)

    def mm(self, a0, a1, y0, y1, d0, d1):
        return _mm(self.w(a0, y0, d0), self.w(a1, y1, d1))

    def box(self, b, a0, a1, y0, y1, d0, d1, mat, keep=None):
        mn, mx = self.mm(a0, a1, y0, y1, d0, d1)
        return b.box(mn, mx, mat, keep=keep)

    def ibox(self, b, a0, a1, y0, y1, d0, d1, mat, keep=None):
        mn, mx = self.mm(a0, a1, y0, y1, d0, d1)
        b.ibox(mn, mx, mat, keep=keep)

    def back_key(self):
        """正面と反対(奥)の向きのキー。"""
        return {'+x': '-x', '-x': '+x', '+z': '-z', '-z': '+z'}[self.front]

    def pbox(self, b, a0, a1, y0, y1, d0, d1, key, gloss=False, keep=None, atlas=None, atlas_mat='MR_Appl', back=False, tile=None):
        mn, mx = self.mm(a0, a1, y0, y1, d0, d1)
        b.pbox(mn, mx, key, gloss=gloss, keep=keep, front=self.front if atlas else None, front_uv=atlas, front_mat=atlas_mat,
               cull=(self.back_key(),) if back else (), tile=tile)


# ---------------------------------------------------------------- 壁の面(穴あき)
def wall_with_holes(b, axis, plane, lo, hi, y0, y1, n, holes, mat, base=None):
    """鉛直の壁の面(axis='x': x=plane の面、z が lo..hi / axis='z': z=plane、x が lo..hi)。holes=[(a,b,hy0,hy1)] は穴(下端 hy0〜上端 hy1)。"""
    def q(a, c, ya, yb):
        if c - a < 1e-4 or yb - ya < 1e-4:
            return
        if axis == 'x':
            pts = [(plane, ya, a), (plane, ya, c), (plane, yb, c), (plane, yb, a)]
        else:
            pts = [(a, ya, plane), (c, ya, plane), (c, yb, plane), (a, yb, plane)]
        b.quad(pts, n, mat)
    hs = sorted(holes)
    cur = lo
    for (a, c, hy0, hy1) in hs:
        a, c = max(lo, a), min(hi, c)
        q(cur, a, y0, y1)
        q(a, c, y0, hy0)
        q(a, c, hy1, y1)
        cur = c
    q(cur, hi, y0, y1)
    if base:   # 幅木(穴の下=開口部は除く)
        t, hh = 0.012, 0.06
        cur = lo
        segs = []
        for (a, c, hy0, hy1) in hs:
            if hy0 < 0.05:
                segs.append((cur, a)); cur = c
        segs.append((cur, hi))
        for (a, c) in segs:
            if c - a < 0.05:
                continue
            if axis == 'x':
                xa, xb = (plane, plane + t * n[0])
                b.box((min(xa, xb), y0, a), (max(xa, xb), y0 + hh, c), base, keep=lambda k, cc, nn: nn == n or k == '+y')
            else:
                za, zb = (plane, plane + t * n[2])
                b.box((a, y0, min(za, zb)), (c, y0 + hh, max(za, zb)), base, keep=lambda k, cc, nn: nn == n or k == '+y')


# ---------------------------------------------------------------- 居室の箱(壁・床・天井・扉と窓の穴)
def room_shell(room, col, floor_mat=None, ceil_mat='MR_Ceil', genkan=True):
    T2 = C.WALL_T / 2
    x, z, w, d = room['rect']
    ix0, ix1, iz0, iz1 = x + T2, x + w - T2, z + T2, z + d - T2
    y0, y1 = C.BASE_Y, C.BASE_Y + C.CEIL_H
    b = B(f'Room_{room["id"]}_shell')
    door = room['door']
    dw = (door.get('width') or C.DOOR_W) / 2
    holes = {'N': [], 'S': [], 'W': [], 'E': []}
    holes[door['facing']].append((door['pos'][0 if door['facing'] in 'NS' else 1] - dw, door['pos'][0 if door['facing'] in 'NS' else 1] + dw, 0.0, C.DOOR_H + C.HEAD_H))
    win = room.get('window')
    if win:
        holes[win['facing']].append((win['pos'][0 if win['facing'] in 'NS' else 1] - win['width'] / 2, win['pos'][0 if win['facing'] in 'NS' else 1] + win['width'] / 2, 0.0, WIN_H))
    for (h, ox, oz) in room.get('_extraHoles', []):
        holes[h].append((ox, oz[0], oz[1], oz[2]))
    yb = (0.0, C.CEIL_H)
    wall_with_holes(b, 'z', iz0, ix0, ix1, y0, y1, (0, 0, 1), [(a, c, y0 + hy0, y0 + hy1) for a, c, hy0, hy1 in holes['N']], 'MR_Wall', base='MR_Base')
    wall_with_holes(b, 'z', iz1, ix0, ix1, y0, y1, (0, 0, -1), [(a, c, y0 + hy0, y0 + hy1) for a, c, hy0, hy1 in holes['S']], 'MR_Wall', base='MR_Base')
    wall_with_holes(b, 'x', ix0, iz0, iz1, y0, y1, (1, 0, 0), [(a, c, y0 + hy0, y0 + hy1) for a, c, hy0, hy1 in holes['W']], 'MR_Wall', base='MR_Base')
    wall_with_holes(b, 'x', ix1, iz0, iz1, y0, y1, (-1, 0, 0), [(a, c, y0 + hy0, y0 + hy1) for a, c, hy0, hy1 in holes['E']], 'MR_Wall', base='MR_Base')
    # 開口の見込み(壁の厚み)。扉は build_floor の枠が覆う。窓はアルミ枠が覆う(下の窓の作りで)
    b.quad([(ix0, y1, iz0), (ix1, y1, iz0), (ix1, y1, iz1), (ix0, y1, iz1)], (0, -1, 0), ceil_mat)
    fl = floor_mat or ('MR_Floor' if door['facing'] in 'EW' else 'MR_FloorZ')
    gk = None
    if genkan and room.get('interior'):
        gk = next((i for i in room['interior']['items'] if i['k'] == 'genkan'), None)
    if gk:
        gx0, gz0, gx1, gz1 = gk['b']
        # 土間(玄関)と洋室の床。床は土間を除いた矩形(土間は扉の辺に接する帯)
        if door['facing'] == 'W': rest = (gx1, iz0, ix1, iz1)
        elif door['facing'] == 'E': rest = (ix0, iz0, gx0, iz1)
        elif door['facing'] == 'N': rest = (ix0, gz1, ix1, iz1)
        else: rest = (ix0, iz0, ix1, gz0)
        ga = (max(ix0, gx0), max(iz0, gz0), min(ix1, gx1), min(iz1, gz1))
        b.quad([(ga[0], y0 + 0.0, ga[3]), (ga[2], y0, ga[3]), (ga[2], y0, ga[1]), (ga[0], y0, ga[1])], (0, 1, 0), 'MR_Genkan')
        b.quad([(rest[0], y0, rest[3]), (rest[2], y0, rest[3]), (rest[2], y0, rest[1]), (rest[0], y0, rest[1])], (0, 1, 0), fl)
        # 框(土間と床の境の木の見切り)
        if door['facing'] in 'EW':
            xk = rest[0] if door['facing'] == 'W' else rest[2]
            b.box((xk - 0.02, y0, iz0), (xk + 0.02, y0 + 0.012, iz1), 'MR_DeskWood', keep=lambda k, c, n: k != '-y')
        else:
            zk = rest[1] if door['facing'] == 'N' else rest[3]
            b.box((ix0, y0, zk - 0.02), (ix1, y0 + 0.012, zk + 0.02), 'MR_DeskWood', keep=lambda k, c, n: k != '-y')
    else:
        b.quad([(ix0, y0, iz1), (ix1, y0, iz1), (ix1, y0, iz0), (ix0, y0, iz0)], (0, 1, 0), fl)
    b.finish(col, {'n2_kind': 'roomwall', 'n2_room': room['id']})


# ---------------------------------------------------------------- 掃き出し窓(枠・障子・ガラス)
def window_unit(room, col, operable, curtain_key=None):
    """外壁の掃き出し窓。枠(静的・アルミ)と2枚の障子。operable なら開く側の障子を別ノード(n2_kind 'winsash')にする。
    入れない部屋は閉じた障子の奥にカーテンの面と闇。"""
    win = room['window'] if room.get('window') else room['_window']
    ax = win['axis']                   # 窓が沿う軸
    fx, fz = FACING[win['facing']]     # 外向き
    line = win['line']
    y0 = C.BASE_Y
    lo, hi = win['pos'][0 if ax == 'x' else 1] - win['width'] / 2, win['pos'][0 if ax == 'x' else 1] + win['width'] / 2
    T2 = C.WALL_T / 2
    # 枠の見込み(壁の厚みの内側)。壁の芯 line から室内側・外側へ T2
    def P(a, y, n):   # a=沿う軸、n=外向きの距離(壁の芯から)
        return (a, y, line + n * fz) if ax == 'x' else (line + n * fx, y, a)
    fr = B(f'Win_{room["id"]}_frame')
    fw = 0.045
    for (a0, a1, ya, yb) in ((lo, lo + fw, 0, WIN_H), (hi - fw, hi, 0, WIN_H), (lo, hi, WIN_H - fw, WIN_H), (lo, hi, 0, 0.035)):
        fr.box(P(a0, y0 + ya, -T2), P(a1, y0 + yb, T2), 'MR_Alu')
    fr.finish(col, {'n2_kind': 'winframe', 'n2_room': room['id']})
    # 障子: 開く側(open)は室内側のレール、はめ殺し(fix)は外側のレール
    def sash(name, a0, a1, off, props):
        s = B(name)
        sw = 0.035
        for (b0, b1, ya, yb) in ((a0, a0 + sw, 0.035, WIN_H - fw), (a1 - sw, a1, 0.035, WIN_H - fw), (a0, a1, WIN_H - fw - sw, WIN_H - fw), (a0, a1, 0.035, 0.035 + 0.06)):
            s.box(P(b0, y0 + ya, off - 0.017), P(b1, y0 + yb, off + 0.017), 'MX_Alu')
        g = P(a0 + sw, y0 + 0.095, off), P(a1 - sw, y0 + WIN_H - fw - sw, off)
        mn, mx = _mm(g[0], g[1])
        n = (fx, 0, fz)
        if ax == 'x':
            pts = [(mn[0], mn[1], mn[2]), (mx[0], mn[1], mn[2]), (mx[0], mx[1], mn[2]), (mn[0], mx[1], mn[2])]
        else:
            pts = [(mn[0], mn[1], mn[2]), (mn[0], mn[1], mx[2]), (mn[0], mx[1], mx[2]), (mn[0], mx[1], mn[2])]
        s.quad(pts, n, 'MX_WinGlass')
        s.quad(list(reversed(pts)), (-fx, 0, -fz), 'MX_WinGlass')
        p = dict(props); p['n2_lm'] = 0
        return s.mb.finish(col, p)
    o0, o1 = win['open']
    f0, f1 = win['fix']
    sgn = 1.0 if (f0 + f1) / 2 > (o0 + o1) / 2 else -1.0
    slide = [sgn, 0.0, 0.0] if ax == 'x' else [0.0, 0.0, sgn]
    if operable:
        sash(f'WinFix_{room["id"]}', f0, f1, 0.02, {'n2_kind': 'winsash', 'n2_room': room['id'], 'n2_operable': 0})
        sash(f'WinSash_{room["id"]}', o0, o1, -0.02, {'n2_kind': 'winsash', 'n2_room': room['id'], 'n2_operable': 1,
                                                       'n2_slide': slide, 'n2_slide_dist': round((o1 - o0) - 0.06, 3)})
    else:
        # 入れない部屋(外から見るだけ): 召し合わせの縦框とガラス1枚(外向き)だけ
        s_ = B(f'WinFix_{room["id"]}')
        mid = (o1 + f0) / 2
        s_.box(P(mid - 0.02, y0 + 0.035, 0.0), P(mid + 0.02, y0 + WIN_H - fw, 0.04), 'MX_Alu')
        g0, g1 = P(lo + fw, y0 + 0.035, 0.03), P(hi - fw, y0 + WIN_H - fw, 0.03)
        mn, mx = _mm(g0, g1)
        if ax == 'x':
            pts = [(mn[0], mn[1], mn[2]), (mx[0], mn[1], mn[2]), (mx[0], mx[1], mn[2]), (mn[0], mx[1], mn[2])]
        else:
            pts = [(mn[0], mn[1], mn[2]), (mn[0], mn[1], mx[2]), (mn[0], mx[1], mx[2]), (mn[0], mx[1], mn[2])]
        s_.quad(pts, (fx, 0, fz), 'MX_WinGlass')
        s_.mb.finish(col, {'n2_kind': 'winsash', 'n2_room': room['id'], 'n2_operable': 0, 'n2_lm': 0})
    if not operable:
        # 入れない部屋: 窓の奥 6cm にカーテンの面(閉)、その奥は闇(壁の中を見せない)
        cb = B(f'Win_{room["id"]}_curtain')
        key = curtain_key or 'oldgray'
        n_in = (-fx, 0, -fz)
        for (k_, off, mat) in ((key, -T2 + 0.005, 'pal'), (None, -T2 - 0.03, 'void')):
            a0p, a1p = lo + 0.03, hi - 0.03
            if ax == 'x':
                pts = [(a1p if fz > 0 else a0p, y0 + 0.03, line + off * fz), (a0p if fz > 0 else a1p, y0 + 0.03, line + off * fz),
                       (a0p if fz > 0 else a1p, y0 + WIN_H - 0.03, line + off * fz), (a1p if fz > 0 else a0p, y0 + WIN_H - 0.03, line + off * fz)]
            else:
                pts = [(line + off * fx, y0 + 0.03, a0p if fx > 0 else a1p), (line + off * fx, y0 + 0.03, a1p if fx > 0 else a0p),
                       (line + off * fx, y0 + WIN_H - 0.03, a1p if fx > 0 else a0p), (line + off * fx, y0 + WIN_H - 0.03, a0p if fx > 0 else a1p)]
            if mat == 'pal':
                cb.pquad(pts, (fx, 0, fz), key)
            else:
                cb.quad(pts, (fx, 0, fz), 'MX_Void')
        cb.finish(col, {'n2_kind': 'wincurtain', 'n2_room': room['id']})


# ---------------------------------------------------------------- 家具(居室)
def _bed(b, it, base, var):
    L = IL(it, base)
    W, D = L.W, L.D
    L.box(b, 0.0, W, 0.08, 0.30, 0.0, D, 'MR_VarnishWood', keep=lambda k, c, n: k != '-y')            # フレーム(P6b-E2: ニスの木部)
    for (a, d) in ((0.04, 0.06), (W - 0.08, 0.06), (0.04, D - 0.1), (W - 0.08, D - 0.1)):
        L.box(b, a, a + 0.04, 0.0, 0.08, d, d + 0.04, 'MR_VarnishWood', keep=lambda k, c, n: k not in ('+y', '-y'))
    L.box(b, 0.0, W, 0.0, 0.78, 0.0, 0.04, 'MR_VarnishWood')                                             # 頭の板(外壁側)
    L.pbox(b, 0.03, W - 0.03, 0.30, 0.50, 0.05, D - 0.03, 'mattress', keep=lambda k, c, n: k != '-y', tile=cloth('mattress'))
    bed = var.get('bedding')
    if bed:
        made = var.get('type') == 'tidy'
        if made:
            L.pbox(b, 0.0, W, 0.48, 0.58, 0.55, D - 0.02, bed, keep=lambda k, c, n: k != '-y', tile=cloth(bed))
            L.pbox(b, 0.12, W - 0.12, 0.5, 0.63, 0.1, 0.45, 'white', keep=lambda k, c, n: k != '-y', tile=cloth('white'))
        else:
            L.pbox(b, 0.02, W - 0.05, 0.48, 0.60, 0.9, D - 0.1, bed, keep=lambda k, c, n: k != '-y', tile=cloth(bed))
            L.pbox(b, 0.1, W - 0.2, 0.55, 0.70, 0.75, 1.3, bed, keep=lambda k, c, n: k != '-y', tile=cloth(bed))      # めくれた掛け布団の山
            L.pbox(b, 0.18, W - 0.1, 0.5, 0.64, 0.08, 0.42, 'white', keep=lambda k, c, n: k != '-y', tile=cloth('white'))
    else:
        L.pbox(b, 0.03, W - 0.03, 0.50, 0.505, 0.05, D - 0.03, 'trashbag', gloss=True, keep=lambda k, c, n: k == '+y')   # 空室: ビニールを掛けたマットレス


def _wetroom(b, it, base, kind, room):
    """トイレ・浴室の箱(外側の壁と扉だけ。中は作らない)。正面 = 通路側。"""
    L = IL(it, base)
    W, D, H = L.W, L.D, L.H
    keep_front_sides = lambda k, c, n: k not in ('+y', '-y')
    # 正面の壁(扉の穴)と左右の側面
    if kind == 'toilet':
        dw, da = 0.62, (W - 0.62) / 2
    else:
        dw, da = 0.72, 0.28
    # 正面の壁: 扉の左・右・上
    for (a0, a1, y0_, y1_) in ((0, da, 0, H), (da + dw, W, 0, H), (da, da + dw, 2.0, H)):
        if a1 - a0 > 1e-3 and y1_ - y0_ > 1e-3:
            mn, mx = L.mm(a0, a1, y0_, y1_, 0.0, 0.06)
            b.box(mn, mx, 'MR_Wall', keep=lambda k, c, n, F=L.front: k == F or (k in ('+x', '-x', '+z', '-z') and False))
    # 側面(箱の両端。隣が壁や別の箱でも見える側だけで十分だが単純に両方)
    for a in (0.0, W):
        mn, mx = L.mm(a - 0.001, a + 0.001, 0, H, 0.0, D)
        side = '+x' if (L.R[0] * (1 if a > 0 else -1)) > 0 else ('-x' if L.R[0] != 0 else None)
        if L.R[0] == 0:
            side = '+z' if (L.R[1] * (1 if a > 0 else -1)) > 0 else '-z'
        b.box(mn, mx, 'MR_Wall', keep=lambda k, c, n, s=side: k == s)
    # 扉の見込み(壁の厚み)と扉
    mn, mx = L.mm(da, da + dw, 0, 2.0, 0.02, 0.05)
    if kind == 'toilet':
        b.box(mn, mx, 'MR_WoodLight', keep=lambda k, c, n, F=L.front: k == F)
        hx = da + dw - 0.08
        L.box(b, hx - 0.012, hx + 0.012, 0.93, 0.97, -0.05, 0.02, 'MR_Metal')
        L.box(b, hx - 0.11, hx + 0.012, 0.94, 0.96, -0.06, -0.04, 'MR_Metal')
        L.pbox(b, da + dw / 2 - 0.03, da + dw / 2 + 0.03, 1.5, 1.56, -0.004, 0.02, 'black')           # 表示錠(小窓)
    else:
        f = b.aquad(front_pts(mn, mx, L.front), (L.F[0], 0, L.F[1]), 'MR_Appl', APPUV['bathdoor'])
    # 扉の枠
    for (a0, a1, y0_, y1_) in ((da - 0.03, da, 0, 2.03), (da + dw, da + dw + 0.03, 0, 2.03), (da - 0.03, da + dw + 0.03, 2.0, 2.04)):
        L.pbox(b, a0, a1, y0_, y1_, -0.012, 0.06, 'white')


def _closet(col, it, base, room):
    """折戸のクローゼット(扉は4枚＝左右2組の折戸。各組の外側の板が枠に蝶番、内側の板はその子で逆に折れる)。中は棚・パイプ・服。"""
    L = IL(it, base)
    W, D, H = L.W, L.D, L.H
    b = B(f'Closet_{room}_body')
    # 枠(見付け)と上の垂れ壁
    L.pbox(b, -0.03, 0.0, 0, 2.04, -0.01, 0.04, 'white')
    L.pbox(b, W, W + 0.03, 0, 2.04, -0.01, 0.04, 'white')
    L.pbox(b, -0.03, W + 0.03, 2.0, 2.04, -0.01, 0.04, 'white')
    L.box(b, 0.0, W, 2.04, H, 0.0, 0.03, 'MR_Wall', keep=lambda k, c, n, F=L.front: k == F)
    # 外側の側面(部屋から見える箱の左右。天井まで)
    L.box(b, -0.03, W + 0.03, 0.0, H, 0.0, D, 'MR_Wall', keep=lambda k, c, n, F=L.front, Bk=L.back_key(): k not in (F, Bk, '+y', '-y'))
    # 中(内向きの面): 側面・奥(部屋の壁の手前)・天井。床・棚・パイプ・服
    # 内向きの面: 開口(正面)の面は内向きの法線が back_key の向きなので除く。床(内向き +y)は下で張る
    L.ibox(b, 0.0, W, 0.0, 2.0, 0.03, D - 0.001, 'MR_Wall', keep=lambda k, c, n, Bk=L.back_key(): k not in (Bk, '+y'))
    L.box(b, 0.0, W, 0.0, 0.002, 0.03, D, 'MR_Floor' if L.f in 'NS' else 'MR_FloorZ', keep=lambda k, c, n: k == '+y')
    L.pbox(b, 0.02, W - 0.02, 1.72, 1.74, 0.2, D - 0.02, 'white')                                  # 枕棚
    L.box(b, 0.02, W - 0.02, 1.64, 1.66, D - 0.32, D - 0.3, 'MR_Metal')                           # パイプ
    for i, a in enumerate((0.06, 0.13, 0.2, 0.71, 0.78, 0.85)):    # 掛かった服(中央=覗く隙間の前は空ける)
        if a > W - 0.05:
            continue
        key = ('navy', 'gray', 'beige', 'charcoal', 'denim', 'white')[i % 6]
        L.pbox(b, a, a + 0.05, 0.85, 1.62, D - 0.55, D - 0.08, key)
    L.pbox(b, 0.08, 0.4, 1.74, 1.9, 0.25, D - 0.1, 'cardboard')                                    # 棚の箱
    b.finish(col, {'n2_kind': 'closet', 'n2_room': room})
    # 折戸: 左右の組。外側の板(枠の蝶番)→ 内側の板(子)。閉じると中央に 1.5cm の隙間
    gap = 0.015
    pw = (W - gap) / 4
    for side, sgn in (('L', 1), ('R', -1)):
        hinge_a = 0.0 if side == 'L' else W
        a_out0, a_out1 = (0.0, pw) if side == 'L' else (W - pw, W)
        a_in0, a_in1 = (pw, 2 * pw) if side == 'L' else (W - 2 * pw, W - pw)
        hx, hy, hz = L.w(hinge_a, 0.0, 0.035)
        outer = C.MeshBuilder(f'ClosetDoor_{side}_{room}', origin=(hx, hy, hz))
        ob = B.__new__(B); ob.mb = outer; ob.name = outer.name
        L.pbox(ob, a_out0 + 0.002, a_out1 - 0.002, 0.02, 1.99, 0.005, 0.035, 'cream', keep=lambda k, c, n: True)
        mid_a = a_out1 if side == 'L' else a_out0
        mx_, my_, mz_ = L.w(mid_a, 0.0, 0.035)
        inner = C.MeshBuilder(f'ClosetDoorIn_{side}_{room}', origin=(mx_, my_, mz_))
        ib = B.__new__(B); ib.mb = inner; ib.name = inner.name
        L.pbox(ib, a_in0 + 0.002, a_in1 - 0.002, 0.02, 1.99, 0.005, 0.035, 'cream', keep=lambda k, c, n: True)
        for yy in (0.5, 1.2):   # 折戸の鏡板の溝(細い影の線)
            L.pbox(ib, a_in0 + 0.03, a_in1 - 0.03, yy, yy + 0.008, -0.001, 0.005, 'lightgray', keep=lambda k, c, n: True)
        ka = a_in1 - 0.05 if side == 'L' else a_in0 + 0.03
        L.box(ib, ka, ka + 0.02, 0.85, 1.15, -0.012, 0.005, 'MR_Metal')                            # 取っ手
        oo = outer.finish(col, dict(ROOMS_PROPS, n2_kind='closetdoor', n2_room=room, n2_side=side, n2_sign=sgn, n2_part='outer'))
        io = inner.finish(col, dict(ROOMS_PROPS, n2_kind='closetdoor', n2_room=room, n2_side=side, n2_sign=sgn, n2_part='inner'))
        if oo and io:
            # 子の位置は親(外側の板の蝶番)からの相対に直す(matrix_world は作った直後は未更新なので使わない)
            io.parent = oo
            io.location = io.location - oo.location


def _locker(col, it, base, room):
    """縦長ロッカー(管理室)。扉は片開き(右に蝶番)の別ノード。閉じた扉と枠の間に 1.2cm の隙間。"""
    L = IL(it, base)
    W, D, H = L.W, L.D, L.H
    b = B(f'Locker_{room}_body')
    L.pbox(b, 0.0, W, 0.0, H, 0.03, D, 'locker', keep=lambda k, c, n, F=L.front: k != F)
    L.pbox(b, 0.0, 0.03, 0.0, H, 0.0, 0.03, 'locker'); L.pbox(b, W - 0.03, W, 0.0, H, 0.0, 0.03, 'locker')
    L.pbox(b, 0.0, W, H - 0.04, H, 0.0, 0.03, 'locker'); L.pbox(b, 0.0, W, 0.0, 0.05, 0.0, 0.03, 'locker')
    L.ibox(b, 0.03, W - 0.03, 0.05, H - 0.04, 0.03, D - 0.002, 'MR_Partition', keep=lambda k, c, n, Bk=L.back_key(): k != Bk)   # 内側(側板・背板・天板・底板)
    L.pbox(b, 0.04, W - 0.04, 1.55, 1.57, 0.06, D - 0.03, 'steel')
    L.pbox(b, 0.1, 0.16, 0.6, 1.5, D - 0.2, D - 0.05, 'navy')       # 掛かった作業着(1着)
    b.finish(col, {'n2_kind': 'locker', 'n2_room': room})
    hx, hy, hz = L.w(W - 0.03, 0.0, 0.012)
    d = C.MeshBuilder(f'LockerDoor_{room}', origin=(hx, hy, hz))
    db = B.__new__(B); db.mb = d; db.name = d.name
    mn, mx = L.mm(0.042, W - 0.03, 0.05, H - 0.04, 0.0, 0.022)
    db.pbox(mn, mx, 'locker', front=L.front, front_uv=APPUV['locker'], front_mat='MR_Appl')
    d.finish(col, dict(ROOMS_PROPS, n2_kind='lockerdoor', n2_room=room, n2_sign=-1))


def _burst_locker(col, it, base, room):
    """P5b-1b: 管理人が出てくる奥の窓際の縦長スチールロッカー(221・6F の罠 3 室)。管理室のロッカーと同じ作り。
    扉は柱の側(it['hinge'] = 'L'/'R' = 正面から見て左/右)に蝶番の片開きの別ノード(n2_kind 'lockerdoor'・n2_part 'burst')。
    中は空(管理人が立つ。枕棚・作業着なし)。閉じた扉と枠の間に 1.2cm の隙間。"""
    L = IL(it, base)
    W, D, H = L.W, L.D, L.H
    b = B(f'BurstLocker_{room}_body')
    L.pbox(b, 0.0, W, 0.0, H, 0.03, D, 'locker', keep=lambda k, c, n, F=L.front: k != F)
    L.pbox(b, 0.0, 0.03, 0.0, H, 0.0, 0.03, 'locker'); L.pbox(b, W - 0.03, W, 0.0, H, 0.0, 0.03, 'locker')
    L.pbox(b, 0.0, W, H - 0.04, H, 0.0, 0.03, 'locker'); L.pbox(b, 0.0, W, 0.0, 0.05, 0.0, 0.03, 'locker')
    L.ibox(b, 0.03, W - 0.03, 0.05, H - 0.04, 0.03, D - 0.002, 'MR_Partition', keep=lambda k, c, n, Bk=L.back_key(): k != Bk)   # 内側(側板・背板・天板・底板)
    L.pbox(b, 0.0, W, H, H + 0.006, 0.0, D, 'darkgray', keep=lambda k, c, n: k == '+y')   # 天板の上の埃っぽい面
    b.finish(col, {'n2_kind': 'locker', 'n2_room': room})
    left = it.get('hinge', 'R') == 'L'
    ha = 0.03 if left else W - 0.03
    hx, hy, hz = L.w(ha, 0.0, 0.012)
    d = C.MeshBuilder(f'BurstLockerDoor_{room}', origin=(hx, hy, hz))
    db = B.__new__(B); db.mb = d; db.name = d.name
    a0, a1 = (0.03, W - 0.042) if left else (0.042, W - 0.03)
    mn, mx = L.mm(a0, a1, 0.05, H - 0.04, 0.0, 0.022)
    db.pbox(mn, mx, 'locker', front=L.front, front_uv=APPUV['locker'], front_mat='MR_Appl')
    d.finish(col, dict(ROOMS_PROPS, n2_kind='lockerdoor', n2_room=room, n2_part='burst', n2_sign=1 if left else -1))


def _rot_about(pts, n, deg):
    """4 点を中心のまわりに法線 n の軸で deg 度回す(巻きの向きは変わらない)。"""
    c = [sum(p[i] for p in pts) / 4 for i in range(3)]
    t = math.radians(deg)
    ct, st = math.cos(t), math.sin(t)
    out = []
    for p in pts:
        v = [p[i] - c[i] for i in range(3)]
        cr = (n[1] * v[2] - n[2] * v[1], n[2] * v[0] - n[0] * v[2], n[0] * v[1] - n[1] * v[0])
        dt = n[0] * v[0] + n[1] * v[1] + n[2] * v[2]
        out.append(tuple(c[i] + v[i] * ct + cr[i] * st + n[i] * dt * (1 - ct) for i in range(3)))
    return out


def _floor_sheet(b, cx, cz, y, w, h, deg, mat, rect):
    """床に平たく置いた紙・写真(上面 1 枚)。"""
    pts = box_faces((cx - w / 2, y, cz - h / 2), (cx + w / 2, y, cz + h / 2))['+y'][0]
    b.aquad(_rot_about(pts, (0, 1, 0), deg), (0, 1, 0), mat, rect)


def build_unit_items(room, col):
    it_all = room['interior']['items']
    var = room['interior']['variant']
    rid = room['id']
    base = C.BASE_Y
    b = B(f'Room_{rid}_furn')
    for it in it_all:
        k = it['k']
        L = IL(it, base) if k not in ('genkan', 'ceilinglight') else None
        if k == 'washer':
            W, D = L.W, L.D
            L.pbox(b, 0, W, 0, 0.07, 0, D, 'appliance', gloss=True, back=True)                          # 防水パン
            L.pbox(b, 0.04, W - 0.04, 0.07, 0.95, 0.03, D - 0.02, 'appliance', gloss=True, atlas=APPUV['washer'], back=True)
            L.pbox(b, W / 2 - 0.02, W / 2 + 0.02, 1.12, 1.2, D - 0.08, D, 'steel', gloss=True)          # 蛇口
        elif k == 'vanity':
            W, D = L.W, L.D
            L.pbox(b, 0, W, 0, 0.8, 0.02, D, 'appliance', atlas=APPUV['vanity'], back=True)
            L.pbox(b, -0.01, W + 0.01, 0.8, 0.85, 0.0, D, 'ceramic', gloss=True)
            L.pbox(b, W / 2 - 0.2, W / 2 + 0.2, 0.851, 0.853, 0.1, D - 0.12, 'lightgray', gloss=True, keep=lambda kk, c, n: kk == '+y')   # 洗面ボウル
            L.pbox(b, W / 2 - 0.02, W / 2 + 0.02, 0.85, 1.05, D - 0.1, D - 0.05, 'steel', gloss=True)
            L.pbox(b, 0.02, W - 0.02, 1.1, 1.85, D - 0.15, D, 'appliance', gloss=True, back=True)      # 鏡の収納
            mn, mx = L.mm(0.06, W - 0.06, 1.15, 1.8, D - 0.151, D - 0.15)
            b.box(mn, mx, 'MR_Mirror', keep=lambda kk, c, n, F=L.front: kk == F)
        elif k == 'fridge':
            W, D = L.W, L.D
            L.pbox(b, 0.04, W - 0.04, 0, 1.08, 0.02, D - 0.02, 'appliance', gloss=True, atlas=APPUV['fridge'], back=True)
            L.pbox(b, 0.0, W, 1.08, 1.1, 0.0, D, 'steel')                                                # レンジ台の棚
            L.pbox(b, 0.03, W - 0.03, 1.1, 1.38, 0.05, D - 0.06, 'lightgray', gloss=True, atlas=APPUV['micro'], back=True)
        elif k == 'closet':
            _closet(col, it, base, rid)
        elif k == 'burstlocker':
            _burst_locker(col, it, base, rid)
        elif k == 'desk':
            W, D = L.W, L.D
            L.box(b, 0, W, 0.69, 0.72, 0, D, 'MR_VarnishWood')                                          # 天板(P6b-E2: ニス)
            for a in (0.02, W - 0.05):
                L.pbox(b, a, a + 0.03, 0.0, 0.69, 0.02, D - 0.02, 'darkgray', tile='MR_LegMetal')         # 脚(P6b-E2: 金属)
            L.pbox(b, 0.05, W - 0.05, 0.3, 0.66, D - 0.03, D - 0.01, 'darkgray')
        elif k == 'chair':
            W, D = L.W, L.D
            L.pbox(b, 0.02, W - 0.02, 0.42, 0.49, 0.04, D - 0.04, 'chair')
            L.pbox(b, 0.04, W - 0.04, 0.52, 0.88, D - 0.07, D - 0.02, 'chair')
            L.pbox(b, W / 2 - 0.025, W / 2 + 0.025, 0.06, 0.42, D / 2 - 0.025, D / 2 + 0.025, 'steel', gloss=True, tile='MR_SteelMetal')
            L.pbox(b, 0.02, W - 0.02, 0.03, 0.06, D / 2 - 0.03, D / 2 + 0.03, 'darkgray')                # 十字の台座(樹脂のまま。金属にすると 312 の複製で環境 0.25 を映して白く浮く)
            L.pbox(b, W / 2 - 0.03, W / 2 + 0.03, 0.03, 0.06, 0.04, D - 0.04, 'darkgray')
        elif k == 'chairfallen':
            # P5b-1(220): 横倒しの椅子。椅子の「上」= a(0→0.88)、横幅 = y(0.44)、前後 = d(0.38)
            L.pbox(b, 0.42, 0.49, 0.02, 0.42, 0.0, 0.36, 'chair')               # 座面(縦になった)
            L.pbox(b, 0.52, 0.88, 0.04, 0.40, 0.32, 0.37, 'chair')              # 背もたれ(床に寝た)
            for yy in (0.03, 0.37):
                for dd in (0.02, 0.31):
                    L.pbox(b, 0.0, 0.42, yy, yy + 0.03, dd, dd + 0.03, 'steel', gloss=True, tile='MR_SteelMetal')   # 脚(横向き)
        elif k == 'pillar':
            mn, mx = L.mm(0, L.W, 0, L.H, 0, L.D)
            b.box(mn, mx, 'MR_Wall', keep=lambda kk, c, n, Bk=L.back_key(): kk not in ('+y', '-y', Bk))
        elif k == 'ac':
            L.pbox(b, 0.0, L.W, 0.0, L.H, 0.0, L.D - 0.005, 'appliance', gloss=True, atlas=APPUV['acin'], back=True)
        elif k == 'shoecase':
            L.pbox(b, 0, L.W, 0, 0.93, 0.0, L.D, 'woodlight', atlas=APPUV['shoecase'], back=True)
            L.box(b, -0.01, L.W + 0.01, 0.93, 0.95, -0.01, L.D, 'MR_VarnishWood')                         # 天板(P6b-E2: ニス)
        elif k in ('toilet', 'bath'):
            _wetroom(b, it, base, k, rid)
        elif k == 'bed':
            _bed(b, it, base, var)
        elif k == 'ceilinglight':
            x0, z0, x1, z1 = it['b']
            cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
            y = base + C.CEIL_H
            b.pbox((cx - 0.26, y - 0.07, cz - 0.26), (cx + 0.26, y, cz + 0.26), 'ceramic', gloss=True, keep=lambda kk, c, n: kk != '+y')
        elif k in ('switch', 'intercom', 'breaker'):
            L.pbox(b, 0, L.W, 0, L.H, 0, L.D, 'appliance', atlas=APPUV[k])
    b.finish(col, {'n2_kind': 'furn', 'n2_room': rid})


def build_unit_decor(room, col):
    rid = room['id']
    base = C.BASE_Y
    b = B(f'Room_{rid}_decor')
    var = room['interior']['variant']
    for it in room['interior']['decor']:
        k = it['k']
        L = IL(it, base)
        W, D, H = L.W, L.D, L.H
        c = it.get('c')
        if k == 'curtain':
            _curtain(b, it, base, room)
        elif k == 'curtainrail':
            L.pbox(b, 0, W, 0, H, 0, D, 'steel', gloss=True)
        elif k == 'hangers':
            for i in range(4):
                a = 0.05 + i * (W - 0.1) / 3.5
                key = (c, 'white', 'denim', 'gray')[i % 4]
                L.pbox(b, a, a + 0.12, H - 0.75 + (i % 2) * 0.12, H - 0.06, 0.02, 0.06, key)
                L.pbox(b, a + 0.05, a + 0.07, H - 0.06, H, 0.03, 0.05, 'steel')
        elif k == 'laptop':
            L.pbox(b, 0, W, 0, 0.02, 0.0, D, 'darkgray', gloss=True, atlas=APPUV['laptop'])
            L.pbox(b, 0, W, 0.02, H, D - 0.02, D, 'darkgray', gloss=True, keep=lambda kk, cc, n: True)
            mn, mx = L.mm(0.02, W - 0.02, 0.04, H - 0.02, D - 0.021, D - 0.02)
            b.aquad(front_pts(mn, mx, L.front), (L.F[0], 0, L.F[1]), 'MR_Appl', APPUV['monitor'])
        elif k == 'monitor':
            L.pbox(b, W / 2 - 0.1, W / 2 + 0.1, 0, 0.02, D / 2 - 0.08, D / 2 + 0.08, 'black')
            L.pbox(b, W / 2 - 0.02, W / 2 + 0.02, 0.02, 0.14, D / 2 - 0.01, D / 2 + 0.03, 'black')
            L.pbox(b, 0, W, 0.12, H, D / 2 - 0.03, D / 2, 'black', gloss=True, atlas=APPUV['monitor'])
        elif k == 'lamp':
            L.pbox(b, 0, W, 0, 0.02, 0, D, 'darkgray')
            L.pbox(b, W / 2 - 0.01, W / 2 + 0.01, 0.02, H - 0.08, D / 2 - 0.01, D / 2 + 0.01, 'steel', gloss=True)
            L.pbox(b, 0.0, W, H - 0.08, H, 0.0, D, 'darkgray', gloss=True)
        elif k == 'cup':
            L.pbox(b, 0, W, 0, H, 0, D, 'ceramic', gloss=True)
        elif k == 'papers':
            mn, mx = L.mm(0, W, 0, H, 0, D)
            f = b.aquad(box_faces(mn, mx)['+y'][0], (0, 1, 0), 'MR_Print', PRTUV['papers'])
            L.pbox(b, 0, W, 0, H - 0.001, 0, D, 'paper', keep=lambda kk, cc, n: kk not in ('+y', '-y'))
        elif k == 'plant':
            L.pbox(b, 0.02, W - 0.02, 0, 0.1, 0.02, D - 0.02, 'pot')
            L.pbox(b, 0.0, W, 0.1, H, 0.0, D, 'plant')
        elif k == 'books':
            for i in range(4):
                L.pbox(b, 0.01 * (i % 2), W - 0.01 * ((i + 1) % 2), i * H / 4, (i + 1) * H / 4 - 0.004, 0.0, D, ('book1', 'book2', 'book3', 'book4')[i])
        elif k == 'cans':
            for i in range(3):
                a = 0.02 + i * 0.055
                L.pbox(b, a, a + 0.05, 0, 0.12 if i != 1 else 0.05, 0.02 + (i % 2) * 0.05, 0.07 + (i % 2) * 0.05, 'can', gloss=True)
        elif k == 'snack':
            L.pbox(b, 0, W, 0, H, 0, D, 'orange', gloss=True)
        elif k == 'shelf':
            L.pbox(b, 0, W, 0, 0.02, 0, D, 'woodlight', tile='MR_VarnishWoodLight')                        # 棚板(P6b-E2: ニス)
            for a in (0.04, W - 0.06):
                L.pbox(b, a, a + 0.02, -0.12, 0.0, D - 0.04, D, 'steel')
            n = it.get('books', 5)
            a = 0.05
            for i in range(n):
                bw = 0.035 + 0.01 * (i % 3)
                L.pbox(b, a, a + bw, 0.02, 0.2 + 0.03 * (i % 2), 0.02, D - 0.02, ('book1', 'book2', 'book3', 'book4', 'paper')[i % 5])
                a += bw + 0.004
        elif k in ('bag',):
            L.pbox(b, 0.02, W - 0.02, 0, H, 0.04, D - 0.02, 'charcoal')
            L.pbox(b, 0.08, W - 0.08, H * 0.4, H * 0.75, 0.0, 0.05, 'darkgray')
        elif k == 'box':
            mn, mx = L.mm(0, W, 0, H, 0, D)
            b.pbox(mn, mx, 'cardboard', front=L.front, front_uv=PRTUV['boxside'], front_mat='MR_Print')
            L.pbox(b, W / 2 - 0.03, W / 2 + 0.03, H, H + 0.002, 0, D, 'tape', keep=lambda kk, cc, n: kk == '+y')
        elif k == 'basket':
            L.pbox(b, 0, W, 0, H, 0, D, 'lightgray', keep=lambda kk, cc, n: kk != '+y')
            L.pbox(b, 0.03, W - 0.03, H - 0.06, H - 0.02, 0.03, D - 0.03, var.get('bedding') or 'white', keep=lambda kk, cc, n: kk == '+y')
        elif k == 'trash':
            L.pbox(b, 0.02, W - 0.02, 0, H, 0.02, D - 0.02, 'trashbag', gloss=True)
        elif k == 'clothes':
            L.pbox(b, 0.0, W, 0, H * 0.5, 0.0, D, c or 'charcoal')
            L.pbox(b, 0.1, W - 0.15, H * 0.5, H, 0.1, D - 0.1, 'denim')
        elif k == 'rug':
            L.pbox(b, 0, W, 0, H, 0, D, c, keep=lambda kk, cc, n: kk != '-y')
        elif k == 'poster':
            mn, mx = L.mm(0, W, 0, H, 0, D)
            b.aquad(front_pts(mn, mx, L.front), (L.F[0], 0, L.F[1]), 'MR_Print', PRTUV[it['p']])
        elif k == 'clock':
            mn, mx = L.mm(0, W, 0, H, 0, D)
            b.aquad(front_pts(mn, mx, L.front), (L.F[0], 0, L.F[1]), 'MR_Appl', APPUV['clock'])
        elif k == 'shoes':
            for i, (a, d) in enumerate(((0.05, 0.05), (0.18, 0.05), (0.32, 0.3), (0.45, 0.32))):
                if a + 0.1 > W:
                    continue
                L.pbox(b, a, a + 0.1, 0, 0.08, d, d + 0.26, ('black', 'black', 'white', 'white')[i])
        elif k == 'umbrella':
            L.pbox(b, 0, W, 0, H, 0, D, 'navy')
        # ---- P5b-1: 220(前作の痕跡の部屋) ----
        elif k == 'wreckmark':
            mn, mx = L.mm(0, W, 0, H, 0, D)
            b.aquad(front_pts(mn, mx, L.front), (L.F[0], 0, L.F[1]), 'MR_Wreck', WRKUV[it['cell']])
        elif k == 'photo':
            mn, mx = L.mm(0, W, 0, H, 0, D)
            n = (L.F[0], 0, L.F[1])
            b.aquad(_rot_about(front_pts(mn, mx, L.front), n, it.get('rot', 0)), n, 'MR_Wreck', WRKUV[it['cell']])
        elif k == 'photofloor':
            x0, z0, x1, z1 = it['b']
            _floor_sheet(b, (x0 + x1) / 2, (z0 + z1) / 2, base + 0.0125, 0.2, 0.15, it.get('rot', 0), 'MR_Wreck', WRKUV[it['cell']])
        elif k == 'papersfloor':
            import random
            rr = random.Random(it.get('seed', 1))
            x0, z0, x1, z1 = it['b']
            for i in range(it.get('n', 20)):
                cx, cz = x0 + 0.12 + rr.random() * (x1 - x0 - 0.24), z0 + 0.12 + rr.random() * (z1 - z0 - 0.24)
                w, h = (0.21, 0.297) if rr.random() < 0.5 else (0.297, 0.21)
                _floor_sheet(b, cx, cz, base + 0.0095 + i * 0.0004, w, h, rr.uniform(-180, 180), 'MR_Print', PRTUV['papers'])
        elif k == 'booksfloor':
            for i, (a, d, key) in enumerate(((0.02, 0.02, 'book1'), (0.2, 0.1, 'book2'), (0.33, 0.0, 'book4'))):
                if a + 0.16 > W:
                    continue
                L.pbox(b, a, a + 0.16, 0, 0.03, d, min(D, d + 0.22), key)
    b.finish(col, {'n2_kind': 'decor', 'n2_room': rid})


def _curtain(b, it, base, room):
    """ひだのあるカーテン(ジグザグの帯)。state: open=両脇に寄せる / half=開く側だけ寄せる / closed=中央に隙間。窓の前(室内側)。"""
    L = IL(it, base)
    W, H = L.W, L.H
    key = it['c']
    st = it['state']
    o0, o1 = it['open']   # 窓の開く側の v の範囲 → 局所 a に直す
    # IL の a は正面(室内向き '-u')から見て左→右。v と a の向きの対応を点で確かめる
    def a_of(world_pt):
        x, z = world_pt
        return (x - L.o[0]) * L.R[0] + (z - L.o[1]) * L.R[1]
    if st == 'open':
        panels = [(0.0, 0.32), (W - 0.32, W)]
    elif st == 'closed':
        panels = [(0.0, W / 2 - 0.04), (W / 2 + 0.04, W)]
    else:
        # 窓の開く側の範囲(世界)を局所 a に
        F = room['window']
        lo_w, hi_w = F['open']
        if F['axis'] == 'z':
            aa = sorted([a_of((L.o[0], lo_w)), a_of((L.o[0], hi_w))])
        else:
            aa = sorted([a_of((lo_w, L.o[1])), a_of((hi_w, L.o[1]))])
        # 開く側を空け、残りを閉じる(開く側の寄せた分は端にまとめる)
        if aa[0] < W / 2:
            panels = [(0.0, 0.28), (aa[1] + 0.02, W)]
        else:
            panels = [(0.0, aa[0] - 0.02), (W - 0.28, W)]
    if it.get('clearOpen'):
        # P5b-1b: 奥のロッカーの部屋。寄せたひだが窓の開く側(バルコニーへの出入り)に掛からないよう、開く側に重なる板を除く(closed は従来どおり)
        F2 = room['window']
        lo2, hi2 = F2['open']
        ab = sorted([a_of((L.o[0], lo2)), a_of((L.o[0], hi2))]) if F2['axis'] == 'z' else sorted([a_of((lo2, L.o[1])), a_of((hi2, L.o[1]))])
        if st != 'closed':
            panels = [(a0, a1) for (a0, a1) in panels if a1 <= ab[0] + 0.01 or a0 >= ab[1] - 0.01]
    for (a0, a1) in panels:
        if a1 - a0 < 0.05:
            continue
        n = max(2, int((a1 - a0) / 0.07))
        pts = []
        for i in range(n + 1):
            a = a0 + (a1 - a0) * i / n
            d = 0.0 if i % 2 == 0 else 0.05
            pts.append((a, d))
        for i in range(n):
            (aa0, d0), (aa1, d1) = pts[i], pts[i + 1]
            p0 = L.w(aa0, 0.0, d0); p1 = L.w(aa1, 0.0, d1); p2 = L.w(aa1, H, d1); p3 = L.w(aa0, H, d0)
            nx_, nz_ = -(p1[2] - p0[2]), (p1[0] - p0[0])
            ln = math.hypot(nx_, nz_) or 1
            nrm = (nx_ / ln, 0, nz_ / ln)
            if nrm[0] * L.F[0] + nrm[2] * L.F[1] < 0:
                nrm = (-nrm[0], 0, -nrm[2])
            b.pquad([p0, p1, p2, p3], nrm, key)
            b.pquad([p1, p0, p3, p2], (-nrm[0], 0, -nrm[2]), key)


# ---------------------------------------------------------------- 共用室の家具(食堂・シアター・管理室)
def build_common(room, col):
    rid = room['id']
    base = C.BASE_Y
    b = B(f'Room_{rid}_furn')
    for it in room['interior']['items'] + room['interior']['decor']:
        k = it['k']
        L = IL(it, base)
        W, D, H = L.W, L.D, L.H
        if k == 'dtable':
            L.box(b, 0, W, 0.67, 0.70, 0, D, 'MR_DeskWood')
            for (a, d) in ((0.05, 0.05), (W - 0.09, 0.05), (0.05, D - 0.09), (W - 0.09, D - 0.09)):
                L.pbox(b, a, a + 0.04, 0, 0.67, d, d + 0.04, 'steel', gloss=True)
        elif k == 'dchair':
            L.pbox(b, 0.02, W - 0.02, 0.42, 0.46, 0.02, D - 0.04, 'woodlight')
            L.pbox(b, 0.03, W - 0.03, 0.55, 0.82, D - 0.05, D - 0.02, 'woodlight')
            for (a, d) in ((0.03, 0.03), (W - 0.06, 0.03), (0.03, D - 0.06), (W - 0.06, D - 0.06)):
                L.pbox(b, a, a + 0.025, 0, 0.42, d, d + 0.025, 'steel', gloss=True)
        elif k == 'counter':
            L.pbox(b, 0, W, 0, 0.86, 0.04, D, 'counter', gloss=True)
            L.pbox(b, -0.02, W + 0.02, 0.86, 0.9, 0, D, 'steel', gloss=True)
        elif k == 'shutter':
            L.pbox(b, 0, W, 0, H, 0, D, 'lightgray', gloss=True)
            for i in range(int(H / 0.08)):
                L.pbox(b, 0, W, i * 0.08, i * 0.08 + 0.01, -0.004, 0.0, 'midgray')
        elif k == 'trays':
            for i in range(6):
                L.pbox(b, 0, W, i * 0.022, i * 0.022 + 0.018, 0, D, 'tray', gloss=True)
        elif k == 'dispenser':
            L.pbox(b, 0, W, 0, 0.8, 0, D, 'lightgray', gloss=True)
            L.pbox(b, 0.02, W - 0.02, 0.8, H, 0.02, D - 0.02, 'appliance', gloss=True)
            L.pbox(b, W / 2 - 0.05, W / 2 + 0.05, 0.92, 0.98, -0.04, 0.0, 'black')
        elif k == 'trayrack':
            for i in range(5):
                L.pbox(b, 0, W, i * 0.3 + 0.05, i * 0.3 + 0.07, 0, D, 'steel', gloss=True)
            for a in (0.0, W - 0.03):
                L.pbox(b, a, a + 0.03, 0, H, 0, 0.03, 'steel', gloss=True); L.pbox(b, a, a + 0.03, 0, H, D - 0.03, D, 'steel', gloss=True)
        elif k == 'bin':
            L.pbox(b, 0, W, 0, H, 0, D, 'midgray', gloss=True)
        elif k == 'board':
            mn, mx = L.mm(0, W, 0, H, 0, D)
            b.aquad(front_pts(mn, mx, L.front), (L.F[0], 0, L.F[1]), 'MR_Print', PRTUV['notice'])
        elif k == 'tv':
            L.pbox(b, 0, W, 0, H, 0, D, 'black', gloss=True, atlas=PRTUV['tvoff'], atlas_mat='MR_Print')
        elif k == 'clock':
            mn, mx = L.mm(0, W, 0, H, 0, D)
            b.aquad(front_pts(mn, mx, L.front), (L.F[0], 0, L.F[1]), 'MR_Appl', APPUV['clock'])
        elif k == 'vaseflower':
            L.pbox(b, 0.03, W - 0.03, 0, 0.16, 0.03, D - 0.03, 'ceramic', gloss=True)
            L.pbox(b, 0.0, W, 0.16, H, 0.0, D, 'plant')
        elif k == 'sofa':
            L.pbox(b, 0, W, 0, 0.42, 0.05, D, 'sofa')
            L.pbox(b, 0, W, 0.42, H, D - 0.2, D, 'sofa')
            for a in (0.0, W - 0.18):
                L.pbox(b, a, a + 0.18, 0.42, 0.62, 0.05, D - 0.2, 'sofa')
            for i in range(3):
                L.pbox(b, 0.2 + i * (W - 0.4) / 3 + 0.01, 0.2 + (i + 1) * (W - 0.4) / 3 - 0.01, 0.42, 0.5, 0.06, D - 0.22, 'sofa')
        elif k == 'speaker':
            L.pbox(b, 0, W, 0, H, 0, D, 'black')
            L.pbox(b, 0.08, W - 0.08, 0.55, 0.85, -0.005, 0.0, 'darkgray')
        elif k == 'projector':
            L.pbox(b, 0, W, 0, 0.12, 0, D, 'appliance', gloss=True)
            L.pbox(b, W / 2 - 0.02, W / 2 + 0.02, 0.12, H, D / 2 - 0.02, D / 2 + 0.02, 'black')
        elif k == 'cushion':   # P5b-3: シアターの段床の座布団
            L.pbox(b, 0.0, W, 0.0, H, 0.0, D, 'sofa')
        elif k == 'lowtable':
            L.box(b, 0, W, H - 0.03, H, 0, D, 'MR_DeskWood')
            L.pbox(b, 0.05, W - 0.05, 0, H - 0.03, 0.05, D - 0.05, 'wooddark')
        elif k == 'odesk':
            L.pbox(b, 0, W, 0.69, 0.72, 0, D, 'officedesk')
            L.pbox(b, 0.02, W - 0.02, 0, 0.69, D - 0.02, D, 'steel')
            L.pbox(b, 0.02, 0.45, 0.0, 0.69, 0.02, D - 0.02, 'steel')
            L.pbox(b, W - 0.03, W - 0.01, 0, 0.69, 0.02, D - 0.02, 'steel')
        elif k == 'ochair':
            L.pbox(b, 0.02, W - 0.02, 0.44, 0.52, 0.04, D - 0.04, 'chair')
            L.pbox(b, 0.04, W - 0.04, 0.55, H, D - 0.07, D - 0.02, 'chair')
            L.pbox(b, W / 2 - 0.025, W / 2 + 0.025, 0.06, 0.44, D / 2 - 0.025, D / 2 + 0.025, 'steel', gloss=True)
            L.pbox(b, 0.02, W - 0.02, 0.03, 0.06, D / 2 - 0.03, D / 2 + 0.03, 'darkgray')
        elif k == 'monitors':
            for i in range(2):
                a0 = i * W / 2 + 0.01
                L.pbox(b, a0, a0 + W / 2 - 0.02, 0.12, H, D - 0.06, D - 0.02, 'black', gloss=True)
                mn, mx = L.mm(a0 + 0.015, a0 + W / 2 - 0.035, 0.14, H - 0.02, D - 0.061, D - 0.06)
                sm = B(f'SecMon_{rid}_{i}')
                f = sm.mb.quad(front_pts(mn, mx, L.front), (L.F[0], 0, L.F[1]), 'MX_SecMon')
                C.set_uv(f, sm.mb, uv_rect(PRTUV['secmon']))
                ob = sm.mb.finish(col, dict(ROOMS_PROPS, n2_kind='secmon', n2_room=rid, n2_lm=0))
                L.pbox(b, a0 + W / 4 - 0.03, a0 + W / 4 + 0.01, 0.0, 0.12, D - 0.08, D - 0.04, 'black')
        elif k == 'phone':
            L.pbox(b, 0, W, 0, H, 0, D, 'appliance', gloss=True)
        elif k == 'binders':
            for i in range(6):
                a = i * W / 6
                L.pbox(b, a + 0.004, a + W / 6 - 0.004, 0, H, 0, D, ('navy', 'book4', 'book1', 'navy', 'gray', 'book2')[i])
        elif k == 'oshelf':
            for i in range(5):
                L.pbox(b, 0, W, i * 0.44 + 0.02, i * 0.44 + 0.04, 0, D, 'steel')
                if i < 4:
                    for j in range(8):
                        aa = 0.04 + j * (W - 0.08) / 8
                        L.pbox(b, aa, aa + (W - 0.08) / 8 - 0.008, i * 0.44 + 0.04, i * 0.44 + 0.34, 0.06, D - 0.04, ('navy', 'book4', 'gray', 'book1', 'paper')[(i + j) % 5])
            for a in (0.0, W - 0.03):
                L.pbox(b, a, a + 0.03, 0, H, 0, 0.03, 'steel'); L.pbox(b, a, a + 0.03, 0, H, D - 0.03, D, 'steel')
        elif k == 'keybox':
            L.pbox(b, 0, W, 0, H, 0, D, 'steel', atlas=APPUV['keybox'])
        elif k == 'safe':
            L.pbox(b, 0, W, 0, H, 0, D, 'darkgray', gloss=True)
        elif k == 'locker':
            _locker(col, it, base, rid)
        elif k == 'calendar':
            mn, mx = L.mm(0, W, 0, H, 0, D)
            b.aquad(front_pts(mn, mx, L.front), (L.F[0], 0, L.F[1]), 'MR_Print', PRTUV['calendar'])
        elif k == 'extinguisher':
            L.pbox(b, 0.03, W - 0.03, 0, H, 0.03, D - 0.03, 'red', gloss=True)
    b.finish(col, {'n2_kind': 'furn', 'n2_room': rid})


# ---------------------------------------------------------------- バルコニー(全居室)
def build_balconies(col):
    rooms = [r for r in C.FLOOR['rooms'] if r.get('balcony')]
    y = C.BASE_Y
    T2 = C.WALL_T / 2
    fl = B('Bal_floor'); rl = B('Bal_rail'); pt = B('Bal_part'); fa = B('Bal_facade'); ac = B('Bal_ac')
    bars = C.MeshBuilder('Bal_bars')
    bars_b = B.__new__(B); bars_b.mb = bars; bars_b.name = 'Bal_bars'
    rects = {r['id']: r['balcony']['rect'] for r in rooms}
    gates = {g['room']: g for g in C.FLOOR.get('gates', [])}
    for r in rooms:
        bal = r['balcony']
        x0, z0, w, d = bal['rect']
        x1, z1 = x0 + w, z0 + d
        fx, fz = FACING[bal['facing']]
        ax = bal['axis']                     # バルコニーが沿う軸('z' = 東西の外壁)
        enter = bool(r['door'].get('enterable'))
        # 床(上面)と先端の見付け(下の階の天井裏まで)
        fl.quad([(x0, y, z1), (x1, y, z1), (x1, y, z0), (x0, y, z0)], (0, 1, 0), 'MR_BalFloor')
        # 外縁(手すり側)の線
        if bal['facing'] == 'E': ex, ez0, ez1 = x1, z0, z1
        elif bal['facing'] == 'W': ex, ez0, ez1 = x0, z0, z1
        elif bal['facing'] == 'S': ex, ez0, ez1 = z1, x0, x1
        else: ex, ez0, ez1 = z0, x0, x1
        # 先端の立ち上がり(床から 0.1m)と見付け(床の下 0.2m)
        if ax == 'z':
            mn, mx = ((ex - 0.12, y - 0.2, z0), (ex, y + 0.1, z1)) if fx > 0 else ((ex, y - 0.2, z0), (ex + 0.12, y + 0.1, z1))
        else:
            mn, mx = ((x0, y - 0.2, ex - 0.12), (x1, y + 0.1, ex)) if fz > 0 else ((x0, y - 0.2, ex), (x1, y + 0.1, ex + 0.12))
        fl.box(mn, mx, 'MR_Concrete', keep=lambda k, c, n: k != '-y')
        # 天井(上の階のスラブの下面)と、その先端の見付け
        ys = y + C.FLOOR_H - 0.2
        fl.quad([(x0, ys, z0), (x1, ys, z0), (x1, ys, z1), (x0, ys, z1)], (0, -1, 0), 'MR_Concrete')
        if ax == 'z':
            mn, mx = ((ex - 0.12, ys, z0), (ex, ys + 0.2, z1)) if fx > 0 else ((ex, ys, z0), (ex + 0.12, ys + 0.2, z1))
        else:
            mn, mx = ((x0, ys, ex - 0.12), (x1, ys + 0.2, ex)) if fz > 0 else ((x0, ys, ex), (x1, ys + 0.2, ex + 0.12))
        fl.box(mn, mx, 'MR_Concrete', keep=lambda k, c, n: k in ('+x', '-x', '+z', '-z') and (n[0] * fx + n[2] * fz) > 0.5)
        # 手すり(外縁から 0.06 内側)
        rl_off = 0.08
        def L2(a, yy, off):   # a = 沿う軸の位置、off = 外縁から内側への距離
            return (ex - fx * off, yy, a) if ax == 'z' else (a, yy, ex - fz * off)
        lo, hi = (z0, z1) if ax == 'z' else (x0, x1)
        if bal['rail'] == 'glass':
            # 乳白ガラスのパネル(低層)。縦の支柱と笠木
            mn, mx = _mm(L2(lo + 0.05, y + 0.12, rl_off - 0.006), L2(hi - 0.05, y + 1.0, rl_off + 0.006))
            rl.box(mn, mx, 'MR_Frost')
            for a in (lo + 0.03, (lo + hi) / 2, hi - 0.03):
                mn, mx = _mm(L2(a - 0.02, y + 0.1, rl_off - 0.025), L2(a + 0.02, y + 1.08, rl_off + 0.025))
                rl.box(mn, mx, 'MR_Rail')
        else:
            # 格子(上層)。縦桟は細いのでライトマップなし(MX_Bars)
            mn, mx = _mm(L2(lo + 0.03, y + 0.1, rl_off - 0.02), L2(hi - 0.03, y + 0.14, rl_off + 0.02))
            rl.box(mn, mx, 'MR_Rail')
            # 縦桟は透過テクスチャの面1枚(両面・アルファテスト。rail_bars.png は 1.1m に 10 本)
            p0, p1 = L2(lo + 0.04, y + 0.14, rl_off), L2(hi - 0.04, y + 1.04, rl_off)
            if ax == 'z':
                pts = [(p0[0], p0[1], p0[2]), (p0[0], p0[1], p1[2]), (p0[0], p1[1], p1[2]), (p0[0], p1[1], p0[2])]
            else:
                pts = [(p0[0], p0[1], p0[2]), (p1[0], p0[1], p0[2]), (p1[0], p1[1], p0[2]), (p0[0], p1[1], p0[2])]
            C.orient(bars.quad(pts, (fx, 0, fz), 'MX_Bars'), (fx, 0, fz))
        mn, mx = _mm(L2(lo + 0.02, y + 1.04, rl_off - 0.035), L2(hi - 0.02, y + 1.1, rl_off + 0.035))
        rl.box(mn, mx, 'MR_Rail')
        # 隔て板(両端。隣のバルコニーと共有する端は「高い側」の部屋だけが作る)。gate=屋上A へ乗り越える台つき
        for end, a in (('lo', lo), ('hi', hi)):
            shared = False
            if end == 'lo':
                for o in rooms:
                    if o is r or o['balcony']['facing'] != bal['facing']:
                        continue
                    ob = o['balcony']['rect']
                    ohi = ob[1] + ob[3] if ax == 'z' else ob[0] + ob[2]
                    olin = ob[0] if ax == 'z' else ob[1]
                    mylin = x0 if ax == 'z' else z0
                    if abs(ohi - lo) < 1e-3 and abs(olin - mylin) < 1e-3:
                        shared = True
            if shared:
                continue
            sg = 1 if end == 'lo' else -1
            p0 = a + sg * 0.0
            mn, mx = _mm(L2(p0 - 0.015 if end == 'hi' else p0, y + 0.08, 0.04), L2(p0 + 0.015 if end == 'lo' else p0, y + 1.85, 0.96))
            pt.box(mn, mx, 'MR_Partition')
            mn, mx = _mm(L2(p0 - 0.03 if end == 'hi' else p0, y, 0.02), L2(p0 + 0.03 if end == 'lo' else p0, y + 1.9, 0.06))
            pt.box(mn, mx, 'MR_Rail')
        g = gates.get(r['id'])
        if g:
            sx0, sz0, sx1, sz1 = g['step']
            if g.get('stepFront'):
                # P3b-2(410): 隔て板の手前に背を付けた室外機(正面=吹き出しをバルコニー側へ)=よじ登る台。防振ゴムの脚2本の上に本体、天板の高さ = stepTop
                top = y + g.get('stepTop', 0.6)
                fk = g['stepFront']
                for (fa0, fa1) in ((sx0 + 0.06, sx0 + 0.16), (sx1 - 0.16, sx1 - 0.06)):
                    ac.pbox((fa0, y, sz0 + 0.02), (fa1, y + 0.06, sz1 - 0.02), 'darkgray', keep=lambda k, c, n: k not in ('+y', '-y'))
                ac.pbox((sx0, y + 0.06, sz0), (sx1, top, sz1), 'lightgray', front=fk, front_uv=APPUV['acout'], front_mat='MR_Appl')
                # 冷媒管の化粧カバー(本体の外壁側の側面から外壁へ。床から 0.3m の高さで外壁に入る)
                hx0 = sx0 - 0.07 if fx > 0 else sx1
                ac.pbox((min(hx0, hx0 + 0.07), y + 0.22, sz0 + 0.08), (max(hx0, hx0 + 0.07), y + 0.36, sz0 + 0.18), 'lightgray')
            else:
                mn, mx = (sx0, y, sz0), (sx1, y + 0.55, sz1)
                ac.pbox(mn, mx, 'lightgray', front='+x' if fx > 0 else '-x', front_uv=APPUV['acout'], front_mat='MR_Appl')   # 室外機=踏み台
        # 室外機(高い側の端・外壁際。データ balcony.ac = 当たりと同じ矩形)。410 は北端の踏み台を兼ねる(上で作った。P3b-3: 401 は gate なし＝通常の室外機)
        if bal.get('ac'):
            a_ = bal['ac']
            mn, mx = (a_[0], y + 0.05, a_[1]), (a_[2], y + 0.6, a_[3])
            fk = ('+x' if fx > 0 else '-x') if ax == 'z' else ('+z' if fz > 0 else '-z')
            ac.pbox(mn, mx, 'lightgray', front=fk, front_uv=APPUV['acout'], front_mat='MR_Appl')
        # 排水口(低い側の外縁の角)
        dpos = L2(lo + 0.18, y + 0.003, 0.2)
        mn, mx = _mm((dpos[0] - 0.08, y, dpos[2] - 0.08), (dpos[0] + 0.08, y + 0.004, dpos[2] + 0.08))
        ac.pbox(mn, mx, 'darkgray', keep=lambda k, c, n: k == '+y', front='+y', front_uv=APPUV['drain'], front_mat='MR_Appl')
        # 物干し(洗濯物をバルコニーに干す部屋)
        var = (r.get('interior') or {}).get('variant') or {}
        if var.get('laundry') == 'balcony':
            pa, pb = (lo + hi) / 2 - 0.2, hi - 0.25
            mn, mx = _mm(L2(pa, ys - 0.45, 0.32), L2(pb, ys - 0.42, 0.35))
            rl.box(mn, mx, 'MR_Rail')
            for a in (pa + 0.05, pb - 0.05):
                mn, mx = _mm(L2(a - 0.01, ys - 0.45, 0.33), L2(a + 0.01, ys, 0.34))
                rl.box(mn, mx, 'MR_Rail')
            for i in range(5):
                a = pa + 0.1 + i * (pb - pa - 0.2) / 4.5
                key = ('white', var.get('bedding') or 'gray', 'denim', 'gray', 'beige')[i % 5]
                mn, mx = _mm(L2(a, ys - 1.15 + (i % 2) * 0.15, 0.32), L2(a + 0.16, ys - 0.48, 0.36))
                rl.pbox(mn, mx, key)
        # 外壁の面(部屋の外側。窓の穴を抜く)
        line = r['window']['line'] if r.get('window') else _outer_line(r)
        hole = None
        win = r.get('window') or _make_window(r)
        r['_window'] = win
        wc = win['pos'][1] if ax == 'z' else win['pos'][0]
        hole = (wc - win['width'] / 2, wc + win['width'] / 2, y, y + WIN_H)
        pl = line + (fx if ax == 'z' else fz) * T2
        n = (fx, 0, fz)
        wall_with_holes(fa, 'x' if ax == 'z' else 'z', pl, lo, hi, y, ys, n, [hole], 'MR_Facade')
        # 窓の見込み(外側)
        window_unit(r, col, operable=enter, curtain_key=None if enter else _locked_curtain(r))
    for mbx, kind in ((fl, 'balcony'), (rl, 'balrail'), (pt, 'partition'), (fa, 'facade'), (ac, 'balac')):
        mbx.finish(col, {'n2_kind': kind})
    if len(bars.bm.faces):
        bars.finish(col, {'n2_kind': 'bars', 'n2_lm': 0})
    else:
        bars.bm.free()


def _outer_line(r):
    x, z, w, d = r['rect']
    f = r['balcony']['facing']
    return {'E': x + w, 'W': x, 'S': z + d, 'N': z}[f]


def _make_window(r):
    """入れない部屋の窓(見た目だけ)。interior_layout.js と同じ位置: 外壁の v 1.02..2.62(開く側 1.02..1.82)。"""
    x, z, w, d = r['rect']
    facing = r['door']['facing']
    alongX = facing in 'EW'
    vO = z if alongX else x
    f = r['balcony']['facing']
    line = _outer_line(r)
    a0, a1, sp = vO + 1.02, vO + 2.62, vO + 1.82
    pos = [line, (a0 + a1) / 2] if alongX else [(a0 + a1) / 2, line]
    return {'pos': pos, 'facing': f, 'width': 1.6, 'axis': 'z' if alongX else 'x', 'open': [a0, sp], 'fix': [sp - 0.04, a1], 'line': line}


LOCKED_CURTAINS = ['beige', 'oldgray', 'navy', 'gray', 'white', 'brown', 'lightblue', 'olive', 'cream', 'khaki', 'teal', 'wine']


def _locked_curtain(r):
    return LOCKED_CURTAINS[sum(ord(c) for c in r['id']) % len(LOCKED_CURTAINS)]


# ---------------------------------------------------------------- 屋上A(4F)
def build_roof_a(col):
    RA = C.FLOOR.get('roofA')
    if not RA:
        return []
    y = C.BASE_Y
    fl = B('RoofA_floor'); par = B('RoofA_parapet'); ob = B('RoofA_boxes'); fa = B('RoofA_facade')
    for (x0, z0, w, d) in RA['rects']:
        fl.quad([(x0, y, z0 + d), (x0 + w, y, z0 + d), (x0 + w, y, z0), (x0, y, z0)], (0, 1, 0), 'MR_Roof')
    # パラペット: 外周の当たり(walls.js の外周の壁=屋根の縁の外側 0.12)の上に腰壁＋笠木。屋根に面する側だけ
    boxes = C.floor_wall_boxes({'rooms': [], 'footprint': C.FLOOR['footprint']})
    rz = [dict(rect=r, kind='roofA', y0=y, y1=y + 2.0, set='room') for r in RA['rects']]
    for bx in boxes:
        if bx['kind'] != 'wall':
            continue
        x0, z0, x1, z1 = bx['cx'] - bx['w'] / 2, bx['cz'] - bx['d'] / 2, bx['cx'] + bx['w'] / 2, bx['cz'] + bx['d'] / 2
        touch = False
        for (ax0, az0, aw, ad) in RA['rects']:
            if x0 < ax0 + aw + 0.02 and x1 > ax0 - 0.02 and z0 < az0 + ad + 0.02 and z1 > az0 - 0.02:
                # 屋根の縁に沿う箱だけ(屋根の内側へ食い込む方向で接している)
                if (abs(x1 - ax0) < 0.02 or abs(x0 - (ax0 + aw)) < 0.02) and z1 > az0 + 0.01 and z0 < az0 + ad - 0.01:
                    touch = True
                if (abs(z1 - az0) < 0.02 or abs(z0 - (az0 + ad)) < 0.02) and x1 > ax0 + 0.01 and x0 < ax0 + aw - 0.01:
                    touch = True
        if not touch:
            continue
        # バルコニー(401/410)や建物の壁に沿う箱は除く(屋根の外へ面する縁だけ)
        cxm, czm = (x0 + x1) / 2, (z0 + z1) / 2
        if any(rr['balcony']['rect'][0] - 0.01 <= cxm <= rr['balcony']['rect'][0] + rr['balcony']['rect'][2] + 0.01 and
               rr['balcony']['rect'][1] - 0.01 <= czm <= rr['balcony']['rect'][1] + rr['balcony']['rect'][3] + 0.01
               for rr in C.FLOOR['rooms'] if rr.get('balcony') and rr['door'].get('enterable')):
            continue
        par.box((x0, y - 0.1, z0), (x1, y + RA['parapetH'], z1), 'MR_Concrete', keep=lambda k, c, n: k != '-y')
        par.box((x0 - 0.01, y + RA['parapetH'], z0 - 0.01), (x1 + 0.01, y + RA['parapetH'] + 0.03, z1 + 0.01), 'MR_Rail', keep=lambda k, c, n: k != '-y')
    # 屋上の物: 室外機3台(4F の壁際)・ベントの管・ルーフドレン
    for i, xa in enumerate((1.2, 2.4, 9.4)):
        za = 5.8 - 0.06 - 0.36
        ob.pbox((xa, y + 0.05, za), (xa + 0.82, y + 0.62, za + 0.32), 'lightgray', front='-z', front_uv=APPUV['acout'], front_mat='MR_Appl')
        ob.box((xa - 0.04, y, za - 0.04), (xa + 0.86, y + 0.05, za + 0.36), 'MR_Concrete', keep=lambda k, c, n: k != '-y')
    ob.pbox((4.4, y, 1.2), (4.55, y + 0.9, 1.35), 'midgray', gloss=True)
    ob.pbox((4.38, y + 0.9, 1.18), (4.57, y + 0.95, 1.37), 'darkgray')
    ob.pbox((-0.6, y, 0.3), (-0.3, y + 0.005, 0.6), 'darkgray', keep=lambda k, c, n: k == '+y', front='+y', front_uv=APPUV['drain'], front_mat='MR_Appl')
    # 4F の北の外壁(屋上に面する。縦廊下の北端の窓は外から灯りが透ける)と、その上の 4F の屋根のパラペット
    zf = 5.8 - 0.06
    yt = y + C.FLOOR_H
    win = next((w for w in C.SHELL['windows'] if abs(w['pos'][1] - 5.8) < 0.01), None)
    holes = []
    if win:
        holes.append((win['pos'][0] - win['w'] / 2, win['pos'][0] + win['w'] / 2, y + win['sill'], y + win['sill'] + win['h']))
    wall_with_holes(fa, 'z', zf, 0.0, 13.8, y, yt, (0, 0, -1), holes, 'MR_Facade')
    out = []
    # P3c-2: 窓そのもの(枠・ガラス・水切り)は build_floor.build_window が開口に作る(旧: 外側に貼った発光板 MX_WinOut は廃止)
    # 4F の屋根(401/410 の上 = 5F の床レベル)のパラペット(屋上A から見上げる縁)
    fa.box((-0.12, yt - 0.2, 5.8 - 0.12), (13.92, yt + 0.85, 5.8), 'MR_Concrete', keep=lambda k, c, n: k in ('-z', '+y'))
    fa.box((-0.13, yt + 0.85, 5.8 - 0.13), (13.93, yt + 0.88, 5.8 + 0.01), 'MR_Rail', keep=lambda k, c, n: k in ('-z', '+y'))
    for mbx, kind in ((fl, 'roofA'), (par, 'parapet'), (ob, 'roofbox'), (fa, 'facade')):
        mbx.finish(col, {'n2_kind': kind})
    # 屋上を照らすのは外壁の壁付け灯1つ(弱い)。月明かりは空(world)から
    out.append(C.build_bracket('RoofALight', 10.6, zf, y + 2.2, 'N', col, energy=3.0))
    for o in bpy.data.objects:
        if o.name.startswith('RoofALight_'):
            o['n2_lm'] = 2
    return out


# ---------------------------------------------------------------- 外の塊(マス)
def _building_rects(fl):
    """その階の建物の塊(部屋・廊下・EV)の矩形。外階段・北階段・バルコニー・屋上A は除く。"""
    skip = set()
    for r in fl['rooms']:
        if r['kind'] == 'stair':
            skip.add(tuple(r['rect']))
        if r.get('balcony'):
            skip.add(tuple(r['balcony']['rect']))
    for rr in (fl.get('roofA') or {}).get('rects', []):
        skip.add(tuple(rr))
    st = {s['id']: s for s in C.BUILDING['stairs']}
    for k in ('main', 'north'):
        s = st[k]
        skip.add(tuple(s['pos'] + s['size']))
    return [r for r in fl['footprint'] if tuple(r) not in skip]


def _outline(rects):
    """矩形群の外周の辺 [(axis, plane, lo, hi, outward)]。"""
    out = []
    def covered(px, pz, skip):
        return any(x - 1e-6 <= px <= x + w + 1e-6 and z - 1e-6 <= pz <= z + d + 1e-6 for j, (x, z, w, d) in enumerate(rects) if j != skip)
    for i, (x, z, w, d) in enumerate(rects):
        for (axis, plane, lo, hi, ox, oz) in (('z', z, x, x + w, 0, -1), ('z', z + d, x, x + w, 0, 1), ('x', x, z, z + d, -1, 0), ('x', x + w, z, z + d, 1, 0)):
            n = max(1, int((hi - lo) / 0.1))
            run = None
            for k in range(n):
                a, b = lo + (hi - lo) * k / n, lo + (hi - lo) * (k + 1) / n
                m = (a + b) / 2
                px, pz = (m, plane + oz * 0.03) if axis == 'z' else (plane + ox * 0.03, m)
                exp = not covered(px, pz, i)
                if exp:
                    run = [run[0], b] if run else [a, b]
                elif run:
                    out.append((axis, plane, run[0], run[1], (ox, oz))); run = None
            if run:
                out.append((axis, plane, run[0], run[1], (ox, oz)))
    return out


def build_massing(col):
    """この階の GLB に「他の階の外壁の塊」(ライトマップなし、外周の線から 3cm 内側)を入れる。上下1階は実物の GLB が見えるので除く。
    自分の階はバルコニーの奥(部屋の外壁)を除いた外壁(建物の端・廊下の端・EV)を入れる。屋上や外から見上げ/見下ろした時に建物が欠けない。"""
    ms = C.MeshBuilder('Massing')
    mb = B.__new__(B); mb.mb = ms; mb.name = 'Massing'
    floors = {f['level']: f for f in C.BUILDING['floors'] if f['level'] <= 7}
    N = C.LEVEL
    for L in range(1, 8):
        if L in (N - 1, N + 1):
            continue
        fl = floors[L]
        rects = _building_rects(fl)
        yb, yt = (L - 1) * C.FLOOR_H, L * C.FLOOR_H
        bal = [r['balcony']['rect'] for r in fl['rooms'] if r.get('balcony')]
        for (axis, plane, lo, hi, (ox, oz)) in _outline(rects):
            segs = [(lo, hi)]
            if L == N:
                # バルコニーの奥は除く(部屋の外壁はバルコニーの作りが描く)
                for (bx, bz, bw, bd) in bal:
                    if axis == 'x' and abs((bx if ox > 0 else bx + bw) - plane) < 0.02:
                        segs = _cut(segs, bz, bz + bd)
                    if axis == 'z' and abs((bz if oz > 0 else bz + bd) - plane) < 0.02:
                        segs = _cut(segs, bx, bx + bw)
                if L == 4 and axis == 'z' and abs(plane - 5.8) < 0.01 and oz < 0:
                    segs = _cut(segs, -1.0, 14.8)      # 屋上A に面する北の外壁は屋上A の作りが描く
            if L in (2, 3) and axis == 'z' and oz < 0:
                # P3c: 北階段へ出る屋外通路(2F・3F の鉄扉の外)の北は開いている(腰壁は build_gallery)。塊で塞がない(通路から壁に見えていた)
                gal = next((a for a in fl['shell']['air'] if a['id'] == 'nst_gallery'), None)
                if gal and abs(plane - gal['rect'][1]) < 0.01:
                    segs = _cut(segs, gal['rect'][0], gal['rect'][0] + gal['rect'][2])
            if L == 1 and axis == 'z' and oz > 0:
                # P3c: 正面玄関(風除室の外側のガラスの線)は抜く(左右と上は庇の作り＝石の外壁が描く。敷地から玄関が見える)
                ent = next((r for r in fl['rooms'] if r['id'] == 'ENTRANCE'), None)
                if ent and abs(plane - (ent['rect'][1] + ent['rect'][3])) < 0.01:
                    segs = _cut(segs, ent['rect'][0], ent['rect'][0] + ent['rect'][2])
            p = plane + (ox if axis == 'x' else oz) * 0.03
            if L == N:
                # P3c-2: 廊下端の窓の開口(壁の室内の面と同じ穴)。他の階の塊(外観が読めるまでの仮)は塞いだまま
                wins = [C.corr_window_geom(w) for w in C.SHELL['windows']]
                wins = [g for g in wins if g['horiz'] == (axis == 'z') and abs(g['pl'] - plane) < 0.02
                        and (g['nin'][0] == -ox and g['nin'][1] == -oz)]
            else:
                wins = []
            for (a, b) in segs:
                if b - a < 0.05:
                    continue
                hs = [(g['a0'], g['a1'], g['y0'], g['y1']) for g in wins if g['a0'] < b and g['a1'] > a]
                if hs:
                    wall_with_holes(mb, axis, p, a, b, yb, yt, (ox, 0, oz), hs, 'MX_Mass')
                    continue
                if axis == 'x':
                    pts = [(p, yb, b), (p, yb, a), (p, yt, a), (p, yt, b)] if ox > 0 else [(p, yb, a), (p, yb, b), (p, yt, b), (p, yt, a)]
                else:
                    pts = [(a, yb, p), (b, yb, p), (b, yt, p), (a, yt, p)] if oz > 0 else [(b, yb, p), (a, yb, p), (a, yt, p), (b, yt, p)]
                mb.quad(pts, (ox, 0, oz), 'MX_Mass')
        # この階の屋上(上の階が無い部分)の屋根面とパラペット(上下1階の範囲外なら塊として)
        if L != N:
            up = (_building_rects(floors[L + 1]) + [list(r) for r in (floors[L + 1].get('roofA') or {}).get('rects', [])]) if L < 7 else []
            for (x, z, w, d) in rects:
                for (cx0, cz0, cx1, cz1) in _uncovered_cells(x, z, w, d, up):
                    mb.quad([(cx0, yt + 0.0, cz1), (cx1, yt, cz1), (cx1, yt, cz0), (cx0, yt, cz0)], (0, 1, 0), 'MX_Mass')
    if N != 1:
        g = 30.0
        mb.quad([(-g, -0.05, 28.1 + g), (26 + g, -0.05, 28.1 + g), (26 + g, -0.05, -g), (-g, -0.05, -g)], (0, 1, 0), 'MX_Ground')
    if len(ms.bm.faces):
        ms.finish(col, {'n2_kind': 'massing', 'n2_lm': 0})
    else:
        ms.bm.free()


def _cut(segs, a, b):
    out = []
    for (s0, s1) in segs:
        if b <= s0 or a >= s1:
            out.append((s0, s1)); continue
        if a > s0: out.append((s0, a))
        if b < s1: out.append((b, s1))
    return out


def _uncovered_cells(x, z, w, d, up, cell=0.5):
    """矩形のうち上の階の矩形に覆われない部分(0.5m のます目で近似し、横に連続するものをまとめる)。"""
    out = []
    nx_, nz_ = max(1, round(w / cell)), max(1, round(d / cell))
    cw, cd = w / nx_, d / nz_
    for j in range(nz_):
        run = None
        for i in range(nx_):
            cx, cz = x + (i + 0.5) * cw, z + (j + 0.5) * cd
            cov = any(ux - 1e-6 <= cx <= ux + uw + 1e-6 and uz - 1e-6 <= cz <= uz + ud + 1e-6 for (ux, uz, uw, ud) in up)
            if not cov:
                run = [run[0], i] if run else [i, i]
            elif run:
                out.append((x + run[0] * cw, z + j * cd, x + (run[1] + 1) * cw, z + (j + 1) * cd)); run = None
        if run:
            out.append((x + run[0] * cw, z + j * cd, x + (run[1] + 1) * cw, z + (j + 1) * cd))
    return out


# ---------------------------------------------------------------- 入口
def build_all(ctx, col):
    init(ctx)
    meta = {'rooms': [], 'roomLights': []}
    for r in C.FLOOR['rooms']:
        if not (r.get('door') and r['door'].get('enterable')):
            continue
        it = r.get('interior')
        if r['kind'] == 'unit':
            room_shell(r, col)
            build_unit_items(r, col)
            build_unit_decor(r, col)
            meta['rooms'].append(r['id'])
        elif r['id'] == 'OFFICE':
            # 受付の小窓(風除室の東壁 = 管理室の西壁)の穴と見込み。build_floor.build_1f_extras の小窓と同じ寸法
            ent = next(e for e in C.FLOOR['rooms'] if e['id'] == 'ENTRANCE')
            ex0, ez0, ew, ed = ent['rect']
            zc, hz, wy0, wy1 = ez0 + ed / 2, 0.36 + 0.035, 0.98 - 0.035, 1.48 + 0.035
            r['_extraHoles'] = [('W', zc - hz, (zc + hz, wy0, wy1))]
            room_shell(r, col, floor_mat='MR_OfficeFloor', ceil_mat='MR_OfficeCeil', genkan=False)
            rv = B('Room_OFFICE_reveal')
            xa, xb = ex0 + ew - 0.06, r['rect'][0] + C.WALL_T / 2
            yb_, yt_ = C.BASE_Y + wy0, C.BASE_Y + wy1
            rv.quad([(xa, yt_, zc - hz), (xb, yt_, zc - hz), (xb, yt_, zc + hz), (xa, yt_, zc + hz)], (0, -1, 0), 'MR_Wall')
            rv.quad([(xa, yb_, zc + hz), (xb, yb_, zc + hz), (xb, yb_, zc - hz), (xa, yb_, zc - hz)], (0, 1, 0), 'MR_Wall')
            rv.quad([(xa, yb_, zc - hz), (xb, yb_, zc - hz), (xb, yt_, zc - hz), (xa, yt_, zc - hz)], (0, 0, 1), 'MR_Wall')
            rv.quad([(xb, yb_, zc + hz), (xa, yb_, zc + hz), (xa, yt_, zc + hz), (xb, yt_, zc + hz)], (0, 0, -1), 'MR_Wall')
            rv.box((xb, yb_ - 0.02, zc - hz - 0.02), (xb + 0.025, yb_ + 0.005, zc + hz + 0.02), 'MR_DeskWood', keep=lambda k, c, n: k != '-y')
            rv.finish(col, {'n2_kind': 'roomwall', 'n2_room': 'OFFICE'})
            build_common(r, col)
            meta['rooms'].append(r['id'])
    for r in C.FLOOR['rooms']:
        if r['id'] in ('DINING', 'THEATER') and r.get('interior'):
            build_common(r, col)
            meta['rooms'].append(r['id'])
    build_balconies(col)
    meta['roomLights'] += build_roof_a(col)
    build_own_roofs(col)
    build_massing(col)
    return meta


def build_own_roofs(col):
    """この階の屋根(上の階が無い部分。上の階の床レベル)の屋根面と縁のパラペット。7F は屋上B(build_floor.build_roof)なので除く。
    4F の北の縁(屋上A から見上げる縁)は build_roof_a が作る。"""
    N = C.LEVEL
    if N >= 7:
        return
    floors = {f['level']: f for f in C.BUILDING['floors'] if f['level'] <= 7}
    rects = _building_rects(floors[N])
    up = _building_rects(floors[N + 1]) + [list(r) for r in (floors[N + 1].get('roofA') or {}).get('rects', [])]   # 屋上A は 4F の作り
    yt = N * C.FLOOR_H
    rb = B('OwnRoof')
    cells = []
    for (x, z, w, d) in rects:
        for c in _uncovered_cells(x, z, w, d, up):
            cells.append(c)
            cx0, cz0, cx1, cz1 = c
            rb.quad([(cx0, yt, cz1), (cx1, yt, cz1), (cx1, yt, cz0), (cx0, yt, cz0)], (0, 1, 0), 'MR_Roof')
    if not cells:
        rb.mb.bm.free(); return
    def in_cells(px, pz):
        return any(a - 1e-4 <= px <= c_ + 1e-4 and b_ - 1e-4 <= pz <= d_ + 1e-4 for (a, b_, c_, d_) in cells)
    for (axis, plane, lo, hi, (ox, oz)) in _outline(rects):
        n = max(1, int((hi - lo) / 0.25))
        run = None
        segs = []
        for k in range(n):
            a, b = lo + (hi - lo) * k / n, lo + (hi - lo) * (k + 1) / n
            m = (a + b) / 2
            px, pz = (m, plane - oz * 0.05) if axis == 'z' else (plane - ox * 0.05, m)
            if in_cells(px, pz):
                run = [run[0], b] if run else [a, b]
            elif run:
                segs.append(run); run = None
        if run:
            segs.append(run)
        for (a, b) in segs:
            if N == 4 and axis == 'z' and abs(plane - 5.8) < 0.01 and oz < 0:
                continue
            if axis == 'x':
                x0, x1 = (plane, plane + 0.15) if ox > 0 else (plane - 0.15, plane)
                rb.box((x0, yt - 0.2, a), (x1, yt + 0.85, b), 'MR_Concrete', keep=lambda k, c, n: k != '-y')
            else:
                z0, z1 = (plane, plane + 0.15) if oz > 0 else (plane - 0.15, plane)
                rb.box((a, yt - 0.2, z0), (b, yt + 0.85, z1), 'MR_Concrete', keep=lambda k, c, n: k != '-y')
    rb.finish(col, {'n2_kind': 'roof'})
