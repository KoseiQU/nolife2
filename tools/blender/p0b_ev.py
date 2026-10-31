# p0b_ev.py — P0b: EVホールを実物写真(DESIGN §2.1/§2.2)準拠で作る。build_scene.py から呼ぶ。
#
# 局所座標: EV扉の正面に立つ人から見て u=右(+)、d=奥行き(扉面=0、シャフト側が+)、y=床からの高さ。
# アルコーブ(walls.js の elevatorBlocks で当たりも掘ってある)の奥に三方枠・中央開き2枚扉(左右別メッシュ)、
# 右の袖壁に呼びボタンパネル、シャフト内にカゴ内部、ホールに下がり梁・電球色ダウンライト・非常口サイン。

import math
import bpy
import n2tex

# 寸法(m)
EV_OPEN_W = 0.80      # 扉の有効幅(2枚合計)
EV_OPEN_H = 2.10
FRAME_W = 0.08        # 三方枠の見付け(DESIGN §2.2: ≈8〜10cm)
FRAME_HEAD_TOP = 2.17 # 枠の上端(=アルコーブの垂れ壁の下端)
DOOR_D0 = 0.30        # 扉板の表面(アルコーブ奥の面 0.27 より 3cm 奥)
DOOR_T = 0.03
WIN_W, WIN_Y0, WIN_Y1, WIN_SHIFT = 0.20, 0.98, 1.83, 0.015   # 窓: 幅・下端・上端・中央寄せ
PANEL_W, DISP_H, PLATE_H, DISP_TOP = 0.09, 0.22, 0.32, 1.75
PANEL_GAP = 0.17      # 三方枠の外縁から呼びパネル左端まで(写真 ≈15〜20cm)
LEAF_STEP = 0.03      # 片寄せ2枚扉の前後の段差(右=手前・左=奥)
LEAF_LAP = 0.02       # 合わせ目での重なり
BEAM_H = 0.25
EV_PARAMS = dict(open_w=EV_OPEN_W, open_h=EV_OPEN_H)

FACE = {'N': ((0, 1), (-1, 0)), 'S': ((0, -1), (1, 0)), 'E': ((-1, 0), (0, -1)), 'W': ((1, 0), (0, 1))}  # forward, right


def orient(f, n_game):
    """面 f の法線をゲーム座標の向き n_game に揃える(回り順に依存しない)。"""
    nb = (n_game[0], -n_game[2], n_game[1])      # g2b
    f.normal_update()
    if f.normal.x * nb[0] + f.normal.y * nb[1] + f.normal.z * nb[2] < 0:
        f.normal_flip()
    return f


class Local:
    """扉位置 pos・向き facing・床高 base から、局所(u,y,d)→ゲーム座標(x,y,z)。"""
    def __init__(self, pos, facing, base):
        self.px, self.pz = pos
        (self.fx, self.fz), (self.rx, self.rz) = FACE[facing]
        self.base = base

    def w(self, u, y, d):
        return (self.px + self.rx * u + self.fx * d, self.base + y, self.pz + self.rz * u + self.fz * d)

    def box(self, mb, u0, u1, y0, y1, d0, d1, mat, keep=None):
        a, b = self.w(u0, y0, d0), self.w(u1, y1, d1)
        mn = tuple(min(a[i], b[i]) for i in range(3)); mx = tuple(max(a[i], b[i]) for i in range(3))
        return mb.box(mn, mx, mat, keep=keep)

    def quad_facing_viewer(self, mb, u0, u1, y0, y1, d, mat, uv01=False):
        """見る人(扉の正面)の方を向く面。uv01=True で UV を 0..1(画像を面全体に貼る)。"""
        pts = [self.w(u0, y0, d), self.w(u1, y0, d), self.w(u1, y1, d), self.w(u0, y1, d)]
        f = orient(mb.quad(pts, (-self.fx, 0, -self.fz), mat), (-self.fx, 0, -self.fz))
        if uv01:
            for loop, uv in zip(f.loops, [(0, 0), (1, 0), (1, 1), (0, 1)]):
                loop[mb.uv].uv = uv
        return f

    def quad_away(self, mb, u0, u1, y0, y1, d, mat):
        """奥(シャフト側)を向く面(カゴの前壁の内側など)。"""
        pts = [self.w(u1, y0, d), self.w(u0, y0, d), self.w(u0, y1, d), self.w(u1, y1, d)]
        return orient(mb.quad(pts, (self.fx, 0, self.fz), mat), (self.fx, 0, self.fz))

    def quad_side(self, mb, u, y0, y1, d0, d1, sign, mat):
        """u=一定の側面。sign=+1 で +u(右)向き、-1 で左向き。"""
        pts = [self.w(u, y0, d0), self.w(u, y0, d1), self.w(u, y1, d1), self.w(u, y1, d0)]
        n = (self.rx * sign, 0, self.rz * sign)
        return orient(mb.quad(pts, n, mat), n)

    def quad_h(self, mb, u0, u1, d0, d1, y, up, mat):
        """水平面(床=up True / 天井=up False)。"""
        if up:
            pts = [self.w(u0, y, d0), self.w(u1, y, d0), self.w(u1, y, d1), self.w(u0, y, d1)]
        else:
            pts = [self.w(u0, y, d1), self.w(u1, y, d1), self.w(u1, y, d0), self.w(u0, y, d0)]
        n = (0, 1 if up else -1, 0)
        return orient(mb.quad(pts, n, mat), n)


def framed_panel(L, mb, u0, u1, y0, y1, d0, d1, hole, mat):
    """窓穴のある板(穴 = (hu0,hu1,hy0,hy1))。穴の周り4枚の箱で作る(穴の内側の見込み面も出る)。"""
    hu0, hu1, hy0, hy1 = hole
    L.box(mb, u0, u1, y0, hy0, d0, d1, mat)
    L.box(mb, u0, u1, hy1, y1, d0, d1, mat)
    L.box(mb, u0, hu0, hy0, hy1, d0, d1, mat)
    L.box(mb, hu1, u1, hy0, hy1, d0, d1, mat)


def ev_local(ctx, dd):
    """EVの局所座標。原点 = 開口の中心(door.pos から正面に立つ人の左へ EV_OPEN_SHIFT。walls.js と同じ)。"""
    room = dd['room']
    return Local(ctx.ev_opening_center(room), dd['facing'], ctx.BASE_Y)


def build_materials(ctx):
    root = ctx.ROOT
    pm = ctx.pbr_material
    # EV扉: つや消しの灰ベージュ塗装 / 三方枠: 同系の少し濃い灰
    pm('M_EVDoor', base=(0.19, 0.185, 0.175), rough=0.6)
    pm('M_EVFrame', base=(0.12, 0.115, 0.105), rough=0.55)
    pm('M_SUS', base=(0.58, 0.58, 0.57), rough=0.45, metal=1.0)
    pm('M_Sill', base=(0.50, 0.50, 0.49), rough=0.6, metal=1.0)           # 敷居(踏まれて曇ったSUS)          # ヘアラインSUS(敷居・パネル枠・手すり)
    wire = n2tex.save_png(bpy, root, 'wire_glass', n2tex.wire_glass())
    pm('M_WireGlass', size=0.30, rough=0.08, emit_tex=None, base=(1, 1, 1))
    _set_base_tex(ctx.MATS['M_WireGlass'], wire)
    pm('M_WireGlassOut', size=0.30, rough=0.08, base=(1, 1, 1), emit=(0.30, 0.38, 0.55), emit_strength=0.03)
    _set_base_tex(ctx.MATS['M_WireGlassOut'], wire)
    disp = n2tex.save_png(bpy, root, 'ev_display', n2tex.ev_display())
    pm('M_EVDisplay', rough=0.05, emit_tex=disp, emit_strength=2.5)
    plate = n2tex.save_png(bpy, root, 'ev_plate', n2tex.ev_plate())
    pm('M_EVPlate', rough=0.35, metal=0.6, base=(1, 1, 1))
    _set_base_tex(ctx.MATS['M_EVPlate'], plate)
    stone = n2tex.save_png(bpy, root, 'car_stone', n2tex.car_stone())
    pm('M_CarStone', size=0.8, rough=0.35, base=(1, 1, 1))
    _set_base_tex(ctx.MATS['M_CarStone'], stone)
    pm('M_CarBeige', base=(0.50, 0.43, 0.33), rough=0.5)
    pm('M_CarFloor', base=(0.10, 0.13, 0.17), rough=0.55)
    pm('M_Mirror', base=(0.9, 0.9, 0.9), rough=0.03, metal=1.0)
    pm('M_CarCeiling', base=(0.85, 0.85, 0.82), rough=0.4, emit=(1.0, 0.97, 0.92), emit_strength=3.0)  # 待機中は消灯(three で 0 倍)
    pm('M_SteelDoorP', base=(0.31, 0.30, 0.27), rough=0.55)              # 外階段の鉄扉(灰ベージュ塗装)
    pm('M_SteelFrameP', base=(0.24, 0.23, 0.20), rough=0.5)
    pm('M_Closer', base=(0.30, 0.30, 0.29), rough=0.4)                    # ドアクローザー(銀灰の塗装)
    pm('M_DownlightTrim', base=(0.8, 0.8, 0.78), rough=0.45)
    pm('M_Downlight', base=(1, 1, 1), rough=0.4, emit=(1.0, 0.80, 0.60), emit_strength=8.0)    # 電球色(約3000K)
    sign = n2tex.save_png(bpy, root, 'exit_sign_sq', n2tex.exit_sign_square())
    pm('M_ExitSignSq', rough=0.4, emit_tex=sign, emit_strength=2.2)


def _set_base_tex(mat, img):
    nt = mat.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    uvn = next(n for n in nt.nodes if n.type == 'UVMAP')
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = img; t.location = (-600, 300)
    nt.links.new(uvn.outputs['UV'], t.inputs['Vector'])
    nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])


def ev_back_face_with_opening(ctx, mb, wall, dd):
    """アルコーブ奥の塊(evBack)の扉側の面を、扉の開口を抜いて張る(後で扉が開いた時にカゴが見えるように)。"""
    L = ev_local(ctx, dd)
    d = ctx.EV_ALCOVE_D
    half = EV_OPEN_W / 2
    # 塊の扉側の面の u 範囲(切り詰め後の箱から)
    (x0, z0), (x1, z1) = wall['min'], wall['max']
    us = []
    for x, z in ((x0, z0), (x1, z1)):
        us.append((x - L.px) * L.rx + (z - L.pz) * L.rz)
    ua, ub = min(us), max(us)
    H = ctx.CEIL_H
    L.quad_facing_viewer(mb, ua, -half, 0, H, d, 'M_Wall')
    L.quad_facing_viewer(mb, half, ub, 0, H, d, 'M_Wall')
    L.quad_facing_viewer(mb, -half, half, EV_OPEN_H, H, d, 'M_Wall')


def build_elevator(ctx, dd, col):
    MB = ctx.MeshBuilder
    L = ev_local(ctx, dd)
    AD, AW = ctx.EV_ALCOVE_D, ctx.EV_ALCOVE_W
    half = EV_OPEN_W / 2
    rid = dd['id']

    # アルコーブ上の垂れ壁(枠の上〜天井)
    lin = MB(f'EVAlcoveLintel_{rid}')
    L.box(lin, -AW / 2, AW / 2, FRAME_HEAD_TOP, ctx.CEIL_H, 0.0, AD, 'M_Wall',
          keep=lambda k, c, n: k != '+y' and ctx.in_air(c[0] + n[0] * 0.03, c[2] + n[2] * 0.03, c[1] + n[1] * 0.03))
    lin.finish(col, {'n2_kind': 'lintel', 'n2_room': rid})

    # 三方枠(アルコーブ奥の面から 2cm 出て、開口の見込みをシャフト側 0.42 まで覆う)
    fr = MB(f'EVFrame_{rid}')
    L.box(fr, -half - FRAME_W, -half, 0, FRAME_HEAD_TOP, AD - 0.02, 0.42, 'M_EVFrame')
    L.box(fr, half, half + FRAME_W, 0, FRAME_HEAD_TOP, AD - 0.02, 0.42, 'M_EVFrame')
    L.box(fr, -half - FRAME_W, half + FRAME_W, EV_OPEN_H, FRAME_HEAD_TOP, AD - 0.02, 0.42, 'M_EVFrame')
    fr.finish(col, {'n2_kind': 'evframe', 'n2_room': rid})

    # 敷居(ヘアラインSUS)
    sill = MB(f'EVSill_{rid}')
    L.box(sill, -half - FRAME_W, half + FRAME_W, 0, 0.008, AD - 0.06, 0.42, 'M_Sill')
    sill.finish(col, {'n2_kind': 'evsill', 'n2_room': rid})

    # 片寄せ2枚扉(2速式・DESIGN §2.2): 閉じると合わせ目は開口のほぼ中央、右の扉が手前・左が奥で前後に重なる。
    # 開くときは2枚とも左(呼びパネルの反対側)へ退避: 奥の左扉が half、手前の右扉はその2倍動く(2速)。
    left_dir = [-L.rx, 0.0, -L.rz]
    leaves = (('L', -half, LEAF_LAP / 2, DOOR_D0 + LEAF_STEP, half),          # 奥・遅い扉
              ('R', -LEAF_LAP / 2, half, DOOR_D0, 2 * half))                  # 手前・速い扉
    for side, u0, u1, d0, dist in leaves:
        mb = MB(f'EVDoor_{side}_{rid}')
        c = (u0 + u1) / 2 + (WIN_SHIFT if side == 'L' else -WIN_SHIFT)
        hu0, hu1 = c - WIN_W / 2, c + WIN_W / 2
        framed_panel(L, mb, u0, u1, 0.006, EV_OPEN_H, d0, d0 + DOOR_T, (hu0, hu1, WIN_Y0, WIN_Y1), 'M_EVDoor')
        L.box(mb, hu0, hu1, WIN_Y0, WIN_Y1, d0 + DOOR_T / 2 - 0.003, d0 + DOOR_T / 2 + 0.003, 'M_WireGlass')
        mb.finish(col, {'n2_kind': 'evdoor', 'n2_room': rid, 'n2_side': side, 'n2_layer': 'front' if side == 'R' else 'back',
                        'n2_slide': left_dir, 'n2_slide_dist': dist})

    # 呼びボタンパネル(右の袖壁・廊下側の面)。上段=黒艶の階数表示、下段=ヘアラインSUS
    pu = half + FRAME_W + PANEL_GAP + PANEL_W / 2    # 三方枠のすぐ右
    pb = MB(f'EVCallPanel_{rid}')
    L.box(pb, pu - PANEL_W / 2, pu + PANEL_W / 2, DISP_TOP - DISP_H - PLATE_H, DISP_TOP, -0.010, 0.0, 'M_SUS',
          keep=lambda k, c, n: (n[0] * -L.fx + n[2] * -L.fz) < 0.5)    # 正面は下の2枚の画像面
    pb.finish(col, {'n2_kind': 'evpanel', 'n2_room': rid})
    pd = MB(f'EVCallDisplay_{rid}')
    L.quad_facing_viewer(pd, pu - PANEL_W / 2, pu + PANEL_W / 2, DISP_TOP - DISP_H, DISP_TOP, -0.0102, 'M_EVDisplay', uv01=True)
    pd.finish(col, {'n2_kind': 'evdisplay', 'n2_room': rid})
    pp = MB(f'EVCallPlate_{rid}')
    L.quad_facing_viewer(pp, pu - PANEL_W / 2, pu + PANEL_W / 2, DISP_TOP - DISP_H - PLATE_H, DISP_TOP - DISP_H, -0.0102, 'M_EVPlate', uv01=True)
    pp.finish(col, {'n2_kind': 'evplate', 'n2_room': rid})

    Lcar = Local(dd['pos'], dd['facing'], ctx.BASE_Y)    # カゴはシャフトの中心に(開口だけ左へ寄っている)
    build_car(ctx, Lcar, rid, col, hole_c=-ctx.EV_OPEN_SHIFT)
    return dict(id=rid, kind='elevator', panelU=pu)


def build_car(ctx, L, rid, col, hole_c=0.0):
    """カゴ内部(扉は閉のまま。GLB に含めるだけ)。"""
    MB = ctx.MeshBuilder
    half = EV_OPEN_W / 2
    cu, d0, d1, H, WAIST = 0.78, 0.42, 1.80, 2.30, 1.55
    c = MB(f'EVCar_{rid}')
    L.quad_h(c, -cu, cu, d0, d1, 0.0, True, 'M_CarFloor')
    L.quad_h(c, -cu, cu, d0, d1, H, False, 'M_CarBeige')
    for (y0, y1, m) in ((0.0, WAIST, 'M_CarStone'), (WAIST, H, 'M_CarBeige')):
        L.quad_facing_viewer(c, -cu, cu, y0, y1, d1, m)                 # 奥の壁
        L.quad_side(c, -cu, y0, y1, d0, d1, +1, m)                       # 左壁(右向き)
        L.quad_side(c, cu, y0, y1, d0, d1, -1, m)                        # 右壁(左向き)
        # 前壁の内側(開口を抜く)
        L.quad_away(c, -cu, hole_c - half, y0, y1, d0, m)
        L.quad_away(c, hole_c + half, cu, y0, y1, d0, m)
        if y1 > EV_OPEN_H:
            L.quad_away(c, hole_c - half, hole_c + half, max(y0, EV_OPEN_H), y1, d0, m)
    c.finish(col, {'n2_kind': 'evcar', 'n2_room': rid})
    det = MB(f'EVCarDetail_{rid}')
    # 手すり(ステンレス)左右と奥
    hy = 0.85
    L.box(det, -cu + 0.04, -cu + 0.07, hy - 0.015, hy + 0.015, d0 + 0.25, d1 - 0.08, 'M_SUS')
    L.box(det, cu - 0.07, cu - 0.04, hy - 0.015, hy + 0.015, d0 + 0.25, d1 - 0.08, 'M_SUS')
    L.box(det, -cu + 0.08, cu - 0.08, hy - 0.015, hy + 0.015, d1 - 0.07, d1 - 0.04, 'M_SUS')
    # 鏡(奥)
    L.quad_facing_viewer(det, -0.36, 0.36, 0.95, 2.05, d1 - 0.004, 'M_Mirror')
    # 操作盤(左袖・前寄り)
    L.box(det, -cu, -cu + 0.012, 0.75, 1.62, d0 + 0.05, d0 + 0.30, 'M_SUS')
    det.finish(col, {'n2_kind': 'evcar_detail', 'n2_room': rid})
    # 天井の乳白パネル(面光源)。待機中=消灯の想定: ベイクには寄与させない(three 側も発光 0 倍)
    cl = MB(f'EVCarLight_{rid}')
    L.quad_h(cl, -0.62, 0.62, d0 + 0.12, d1 - 0.12, H - 0.01, False, 'M_CarCeiling')
    ob = cl.finish(col, {'n2_kind': 'lampcover', 'n2_room': rid, 'n2_off': 1})
    for k in ('visible_diffuse', 'visible_glossy', 'visible_transmission', 'visible_volume_scatter', 'visible_shadow'):
        setattr(ob, k, False)
    return ob


def build_hall(ctx, col, doors, ev_info):
    """EVホール周辺: 下がり梁・電球色ダウンライト・非常口サイン(鉄扉の上の梁に取付)。"""
    MB = ctx.MeshBuilder
    B = ctx.BASE_Y; H = ctx.CEIL_H
    stair = next((d for d in doors if d['kind'] == 'stair'), None)
    ev = next((d for d in doors if d['kind'] == 'elevator'), None)
    beam = MB('HallBeams')
    nokeep = lambda k, c, n: k != '+y'
    # 廊下→ホールの境に横断する下がり梁(廊下の両壁の間)
    junction = next(a['rect'] for a in ctx.REGION['air'] if a['id'] == 'junction')
    jz = junction[1]
    beam.box((6.06, B + H - BEAM_H, jz - 0.15), (7.74, B + H, jz + 0.15), 'M_Wall', keep=nokeep)
    # 鉄扉の壁に沿った下がり梁(非常口サインの取付面)
    if stair:
        sx = stair['gap_max'][0] if stair['facing'] == 'E' else stair['gap_min'][0]
        beam.box((sx, B + H - BEAM_H, jz), (sx + 0.20, B + H, junction[1] + junction[3]), 'M_Wall', keep=nokeep)
    beam.finish(col, {'n2_kind': 'beam'})

    # 電球色の丸ダウンライト(Ø10cm)1灯: ホール中央・EVの手前
    cx, cz = (ev['pos'][0], (jz + ev['pos'][1]) / 2) if ev else (6.9, 21.2)
    trim = MB('Downlight_trim'); disc = MB('Downlight_lens')
    y = B + H - 0.002
    n = 20
    ring_o = [(cx + 0.068 * math.cos(2 * math.pi * i / n), y, cz + 0.068 * math.sin(2 * math.pi * i / n)) for i in range(n)]
    ring_i = [(cx + 0.05 * math.cos(2 * math.pi * i / n), y - 0.001, cz + 0.05 * math.sin(2 * math.pi * i / n)) for i in range(n)]
    for i in range(n):
        j = (i + 1) % n
        trim.quad([ring_o[i], ring_o[j], ring_i[j], ring_i[i]], (0, -1, 0), 'M_DownlightTrim')
    disc.quad(ring_i, (0, -1, 0), 'M_Downlight')
    for mbx in (trim, disc):
        for face in mbx.bm.faces:
            orient(face, (0, -1, 0))
    trim.finish(col, {'n2_kind': 'downlight'})
    lens = disc.finish(col, {'n2_kind': 'lampcover'})
    for k in ('visible_diffuse', 'visible_glossy', 'visible_transmission', 'visible_volume_scatter', 'visible_shadow'):
        setattr(lens, k, False)
    ld = bpy.data.lights.new('Downlight_hall', 'AREA')
    ld.shape = 'DISK'; ld.size = 0.10
    ld.energy = float(ctx.ARGS.get('downlight_w', 1.4))
    ld.color = (1.0, 0.80, 0.60)
    lo = bpy.data.objects.new('Downlight_hall', ld)
    lo.location = ctx.g2b(cx, y - 0.004, cz)
    col.objects.link(lo)

    # 非常口サイン(内照式・ほぼ正方形)を鉄扉の上の梁の面に
    if stair:
        sx = stair['gap_max'][0] + 0.20 if stair['facing'] == 'E' else stair['gap_min'][0] - 0.20
        pz = stair['pos'][1]
        w2, y0s, y1s, t = 0.16, B + 2.04, B + 2.34, 0.07
        body = MB('ExitSign_body'); face = MB('ExitSign_face')
        body.box((sx, y0s, pz - w2), (sx + t, y1s, pz + w2), 'M_Plastic', keep=lambda k, c, n: k != '+x')
        xs = sx + t + 0.001
        fpts = [(xs, y0s + 0.012, pz + w2 - 0.012), (xs, y0s + 0.012, pz - w2 + 0.012),
                (xs, y1s - 0.012, pz - w2 + 0.012), (xs, y1s - 0.012, pz + w2 - 0.012)]
        fq = orient(face.quad(fpts, (1, 0, 0), 'M_ExitSignSq'), (1, 0, 0))
        for loop, uv in zip(fq.loops, [(0, 0), (1, 0), (1, 1), (0, 1)]):
            loop[face.uv].uv = uv
        body.finish(col, {'n2_kind': 'exitsign'})
        face.finish(col, {'n2_kind': 'exitsign_face'})
