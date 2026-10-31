# blood_textures.py — P3b-4: 進行解放の5室の「怖い扉」の血痕アトラス(すべて自作の手続き描画。写真は使わない)。
#   build/tex/blood_albedo.webp  1024×1024 RGBA … 色(乾いた暗赤〜黒褐色)＋アルファ(厚み)。実行時はアルファを凹凸(bumpMap)にも使う
#   build/tex/blood_rough.webp    512×512  灰   … 粗さ(濡れ=0.15 前後で懐中電灯がぬめって光る / 乾き=0.85 前後)
#   build/tex/blood_atlas.json                  … 要素ごとの矩形(px、左上原点)と実寸(mm)。src/story_doors.js が読む
# 要素: 手形(きれい・部分・指先の引っかき)・指の筋つき手形 2・拭った跡・垂れ 2・飛沫・扉の下から染み出す溜まり・床の点々・
#       生乾きの1本の垂れ(近づくと伸びる演出用)・廊下の引きずり痕。文字・記号・実在の表記は描かない
# 実行: python3 tools/blood_textures.py   (乱数の種は固定。何度実行しても同じ結果)
import json, math, os
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'build', 'tex')
N = 1024          # 出力の一辺
SS = 2            # 縮小前の倍率(縁の滑らかさ)
rng = np.random.default_rng(20261101)

T = np.zeros((N * SS, N * SS), np.float32)     # 厚み(0..1+)
WET = np.zeros((N * SS, N * SS), np.float32)   # 濡れ(0..1)
CELLS = {}


# ------------------------------------------------------------------ 道具
def vnoise(h, w, cy, cx=None):
    """値ノイズ(格子 cy×cx px を双三次で補間)。0..1"""
    cx = cy if cx is None else cx
    gh, gw = int(h / cy) + 4, int(w / cx) + 4
    g = rng.random((gh, gw)).astype(np.float32)
    im = Image.fromarray(g).resize((int(gw * cx), int(gh * cy)), Image.BICUBIC)
    a = np.asarray(im, np.float32)
    oy, ox = int(rng.integers(0, max(1, int(cy)))), int(rng.integers(0, max(1, int(cx))))
    return np.clip(a[oy:oy + h, ox:ox + w], 0, 1)


def fbm(h, w, cell, octaves=4, aniso=1.0):
    s, amp, tot = np.zeros((h, w), np.float32), 1.0, 0.0
    c = float(cell)
    for _ in range(octaves):
        s += amp * vnoise(h, w, max(2.0, c), max(2.0, c * aniso))
        tot += amp
        amp *= 0.5
        c /= 2.0
    return s / tot


def box_blur(a, r, axis):
    if r < 1:
        return a
    pad = [(0, 0), (0, 0)]
    pad[axis] = (r + 1, r)
    c = np.cumsum(np.pad(a, pad, mode='edge'), axis=axis, dtype=np.float64)
    n = a.shape[axis]
    hi = np.take(c, np.arange(2 * r + 1, 2 * r + 1 + n), axis=axis)
    lo = np.take(c, np.arange(0, n), axis=axis)
    return ((hi - lo) / (2 * r + 1)).astype(np.float32)


def blur(a, sigma):
    r = max(1, int(round(sigma * 0.85)))
    for _ in range(3):
        a = box_blur(box_blur(a, r, 0), r, 1)
    return a


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


class Cell:
    """アトラスの1区画。座標は mm(左上原点、x 右・y 下)"""

    def __init__(self, name, x, y, w, h, mmpp):
        self.name, self.x, self.y, self.w, self.h, self.mmpp = name, x, y, w, h, mmpp
        self.H, self.W = h * SS, w * SS
        self.t = np.zeros((self.H, self.W), np.float32)
        self.wet = np.zeros((self.H, self.W), np.float32)
        ys, xs = np.mgrid[0:self.H, 0:self.W].astype(np.float32)
        self.X = (xs + 0.5) / SS * mmpp
        self.Y = (ys + 0.5) / SS * mmpp
        self.wmm, self.hmm = w * mmpp, h * mmpp
        CELLS[name] = {'rect': [x, y, w, h], 'mm': [round(self.wmm, 1), round(self.hmm, 1)]}

    def px(self, mm):
        return mm / self.mmpp * SS

    def noise(self, cell_mm, octaves=4, aniso=1.0):
        return fbm(self.H, self.W, max(2.0, self.px(cell_mm)), octaves, aniso)

    def add(self, t, wet=None, mode='screen'):
        t = np.clip(t, 0, 1.5)
        if mode == 'max':
            self.t = np.maximum(self.t, t)
        else:   # 重ね塗り(足すほど濃いが 1 を少し越える程度で飽和)
            self.t = self.t + t * (1 - np.clip(self.t, 0, 1) * 0.6)
        if wet is not None:
            self.wet = np.maximum(self.wet, wet)

    def stamp(self, cx, cy, rx, ry=None, ang=0.0, th=1.0, wet=0.0, soft=0.6):
        """楕円を1つ(窓の中だけ計算)。soft = 縁のぼかし(mm)"""
        ry = rx if ry is None else ry
        R = max(rx, ry) + soft * 2 + 1
        i0, i1 = int(max(0, self.px(cy - R))), int(min(self.H, self.px(cy + R) + 1))
        j0, j1 = int(max(0, self.px(cx - R))), int(min(self.W, self.px(cx + R) + 1))
        if i0 >= i1 or j0 >= j1:
            return
        X, Y = self.X[i0:i1, j0:j1] - cx, self.Y[i0:i1, j0:j1] - cy
        c, s = math.cos(ang), math.sin(ang)
        u, v = (c * X + s * Y) / max(rx, 1e-3), (-s * X + c * Y) / max(ry, 1e-3)
        d = (np.sqrt(u * u + v * v) - 1) * min(rx, ry)
        m = np.clip(0.5 - d / max(soft, 0.05), 0, 1)
        sl = (slice(i0, i1), slice(j0, j1))
        self.t[sl] = np.maximum(self.t[sl], m * th)
        if wet > 0:
            self.wet[sl] = np.maximum(self.wet[sl], m * wet)

    def ragged(self, cell_mm=2.5, amt=0.22):
        """縁をぎざぎざに(薄い所ほど削れる)"""
        n = self.noise(cell_mm, 3)
        self.t = np.clip(self.t - amt * n * (1 - smooth(0.35, 0.9, self.t)), 0, 1.5)

    def commit(self):
        sl = (slice(self.y * SS, (self.y + self.h) * SS), slice(self.x * SS, (self.x + self.w) * SS))
        fade = np.ones((self.H, self.W), np.float32)   # 区画の縁 3px は必ず透明(隣の要素が滲まない)
        e = 3 * SS
        fade[:e, :] = 0; fade[-e:, :] = 0; fade[:, :e] = 0; fade[:, -e:] = 0
        T[sl] = np.maximum(T[sl], self.t * fade)
        WET[sl] = np.maximum(WET[sl], self.wet * fade)


def polyline_dist(X, Y, pts):
    d = np.full(X.shape, 1e9, np.float32)
    for (ax, ay), (bx, by) in zip(pts[:-1], pts[1:]):
        vx, vy = bx - ax, by - ay
        L2 = vx * vx + vy * vy + 1e-9
        t = np.clip(((X - ax) * vx + (Y - ay) * vy) / L2, 0, 1)
        d = np.minimum(d, np.hypot(X - ax - t * vx, Y - ay - t * vy))
    return d


def bezier(p0, p1, p2, n=10):
    return [((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
             (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]) for t in np.linspace(0, 1, n)]


# ------------------------------------------------------------------ 手形
# 手の局所座標(mm): 掌の中心が原点、+y が指先の向き。親指は -x 側(右手の掌を壁に押し当てて正面から見た形)
FINGERS = [  # 付け根(x, y)・傾き(度、+ で外へ)・長さ・太さ(付け根/先)
    (-27, 38, -9, 70, 9.6, 8.4), (-9, 42, -2, 80, 10.0, 8.8), (9, 40, 5, 74, 9.6, 8.4), (26, 32, 15, 56, 8.2, 7.0)]
THUMB = (-33, -6, -50, 62, 11.5, 9.6)


def finger_geo(f, spread=0.0):
    bx, by, a, L, r0, r1 = f
    a = math.radians(a * (1 + spread))
    return (bx, by), (bx + L * math.sin(a), by + L * math.cos(a)), r0, r1, L


def hand(c, cx, cy, sc=1.0, rot=0.0, mirror=False, spread=0.0, fingers=(1, 1, 1, 1, 1), palm=1.0, th=0.9, wet=0.0,
         drag=None):
    """手形1つ。fingers = (人差し・中・薬・小・親) の押し付けの強さ(0 = 付かない)。palm = 掌の濃さ。
    drag = [(指の番号 0..4 と 'heel', 長さ mm), ...]: 指先(掌)から下へ引きずった筋"""
    dx, dy = c.X - cx, c.Y - cy
    cr, sr = math.cos(math.radians(rot)), math.sin(math.radians(rot))
    lx = (cr * dx + sr * dy) / sc
    ly = -(-sr * dx + cr * dy) / sc     # +y = 指先(画像では上)
    if mirror:
        lx = -lx
    warp = 3.4
    lx = lx + (c.noise(14, 3) - 0.5) * 2 * warp
    ly = ly + (c.noise(14, 3) - 0.5) * 2 * warp
    # 掌(角の丸い台形)
    hw = 42 - 9 * smooth(14, -46, ly) + 2 * smooth(20, 44, ly)
    qx, qy = np.abs(lx + 2 * smooth(0, -40, ly)) - (hw - 27), np.abs(ly + 2) - (46 - 27)
    sd_palm = np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - 27
    depth = -sd_palm
    dens_p = 1 - 0.58 * smooth(9, 22, depth)                       # 縁は濃く、くぼみは薄い
    dens_p = np.maximum(dens_p, smooth(-22, -42, ly))               # 手のひらの付け根(手首側のふくらみ)
    dens_p = np.maximum(dens_p, smooth(16, 4, np.hypot(lx + 24, ly + 18)) * 0.95)   # 親指の付け根
    for crease in (bezier((44, 20), (10, 30), (-20, 26)), bezier((-40, 8), (-5, 2), (32, -4)),
                   bezier((-36, 12), (-16, -12), (-12, -46))):
        dens_p *= 1 - 0.5 * np.exp(-(polyline_dist(lx, ly, crease) / 1.1) ** 2) * smooth(0.3, 0.6, c.noise(10, 2))
    m_palm = np.clip(0.5 - sd_palm / 0.9, 0, 1)
    tot = m_palm * dens_p * palm
    tips = []
    for k, f in enumerate(FINGERS + [THUMB]):
        if fingers[k] <= 0:
            continue
        (ax, ay), (bx, by), r0, r1, L = finger_geo(f, spread)
        vx, vy = bx - ax, by - ay
        tt = np.clip(((lx - ax) * vx + (ly - ay) * vy) / (vx * vx + vy * vy), 0, 1)
        d = np.hypot(lx - ax - tt * vx, ly - ay - tt * vy) - (r0 + (r1 - r0) * tt)
        m = np.clip(0.5 - d / 0.9, 0, 1)
        dens = 0.55 + 0.45 * smooth(0.55, 0.8, tt)                  # 指先の腹が一番濃い
        for tj in ((0.33, 0.64) if k < 4 else (0.5,)):              # 関節のしわ
            dens *= 1 - 0.55 * np.exp(-(((tt - tj) * L) / 1.3) ** 2)
        dens *= 1 - 0.3 * smooth(0.1, 0.0, tt) * (k < 4)          # 指の付け根のくびれ
        tot = np.maximum(tot, m * dens * fingers[k])
        tips.append((k, ax + vx * 0.86, ay + vy * 0.86, r1))
    skin = c.noise(0.7, 2)
    blot = c.noise(7, 3)
    tot = tot * (0.7 + 0.3 * skin) * np.clip(0.2 + 1.1 * blot, 0, 1)
    edge = (m_palm > 0) & (m_palm < 1)
    tot = tot + 0.18 * edge * palm
    c.add(tot * th, tot * wet if wet else None)
    # 引きずった筋(画像の下向き)
    if drag:
        def to_img(px_, py_):
            x_, y_ = (-px_ if mirror else px_) * sc, -py_ * sc
            return cx + cr * x_ - sr * y_, cy + sr * x_ + cr * y_
        for k, L in drag:
            if k == 'heel':
                hx, hy = to_img(0, -38)
                streak(c, hx, hy, L, 30 * sc, th * 0.7, lines=7)
                continue
            for (kk, tx, ty, r1) in tips:
                if kk == k:
                    sx, sy = to_img(tx, ty)
                    streak(c, sx, sy, L, r1 * sc * 0.95, th * 0.85, lines=2)


def streak(c, x0, y0, L, r, th, lines=2, wet=0.0, sway=1.0):
    """下へ引きずった筋(太さが細り、途中で途切れ、筋目が入る)"""
    old = c.t.copy()
    steps = max(4, int(L / 1.2))
    x = x0
    drift = rng.normal(0, 0.06) * sway
    for i in range(steps):
        t = i / steps
        x += drift + rng.normal(0, 0.18) * sway
        y = y0 + t * L
        rr = r * (1 - 0.55 * t) * (0.9 + 0.2 * rng.random())
        if t > 0.45 and rng.random() < 0.06 * t:
            continue
        c.stamp(x, y, rr, rr * 0.7, 0, th * (1 - 0.6 * t) * (0.8 + 0.2 * rng.random()), wet * (1 - t), soft=0.7)
    # 筋目(進む向きに沿った細い線)
    i0, i1 = int(max(0, c.px(y0 - r))), int(min(c.H, c.px(y0 + L + r)))
    j0, j1 = int(max(0, c.px(x0 - r * 2.5))), int(min(c.W, c.px(x0 + r * 2.5)))
    if i1 > i0 and j1 > j0:
        h_, w_ = i1 - i0, j1 - j0
        stri = 0.6 * vnoise(h_, w_, c.px(28), c.px(1.3)) + 0.4 * vnoise(h_, w_, c.px(70), c.px(3.5))
        n = fbm(h_, w_, c.px(6), 2)
        sl = (slice(i0, i1), slice(j0, j1))
        layer = c.t[sl] * np.clip(0.1 + 1.25 * stri * (0.6 + 0.5 * n), 0.05, 1.05)
        c.t[sl] = np.maximum(old[sl], layer)


# ------------------------------------------------------------------ 垂れ・飛沫・溜まり
def drip(c, x0, y0, L, w, th=0.75, wet_end=1.0, bead=True):
    x = x0
    steps = max(4, int(L / 0.8))
    for i in range(steps):
        t = i / steps
        x += rng.normal(0, 0.05)
        ww = w * (1 - 0.35 * t) * (0.92 + 0.16 * rng.random())
        c.stamp(x, y0 + t * L, ww, ww, 0, th * (0.75 + 0.25 * t), wet_end * (0.25 + 0.75 * t) ** 2, soft=0.5)
    if bead:
        c.stamp(x, y0 + L + w * 0.4, w * 1.25, w * 1.6, 0, 1.15, wet_end, soft=0.6)


def source_blob(c, x0, x1, y, h, th=0.9, wet=0.35):
    """垂れの元(不揃いな汚れの塊。大小の楕円を寄せ集め、まわりに小さな点)"""
    n = int((x1 - x0) / 6) + 4
    for _ in range(n):
        x = rng.uniform(x0, x1)
        k = 1 - abs((x - (x0 + x1) / 2) / max(1, (x1 - x0) / 2)) ** 2      # 中ほどが厚い
        r = h * rng.uniform(0.35, 1.0) * (0.5 + 0.7 * k)
        c.stamp(x, y + rng.normal(0, h * 0.35), r * rng.uniform(1.0, 2.2), r, rng.normal(0, 0.35), th * rng.uniform(0.6, 1.0), wet * rng.random(), soft=1.0)
    for _ in range(n):
        a = rng.uniform(0, 2 * math.pi)
        d = rng.uniform(0.6, 1.4)
        c.stamp((x0 + x1) / 2 + math.cos(a) * (x1 - x0) * 0.5 * d, y + math.sin(a) * h * 1.6 * d, rng.uniform(0.4, 1.6), None, 0, th * 0.8, 0, soft=0.4)


def drips_cell(c, n, seed_bias=0.0):
    """垂れの束: 上に不揃いな汚れの塊が2〜3個(高さも大きさもばらばら)、そこから長さの違う垂れ"""
    srcs = []
    x = c.wmm * rng.uniform(0.08, 0.2)
    while x < c.wmm * 0.8:
        w = rng.uniform(30, 75)
        y = rng.uniform(14, 48)
        srcs.append((x, min(c.wmm * 0.92, x + w), y))
        x += w + rng.uniform(4, 30)
    for (x0, x1, y) in srcs:
        source_blob(c, x0, x1, y, rng.uniform(5, 10), th=0.95, wet=0.3)
        for _ in range(max(1, int((x1 - x0) / 22 + rng.integers(0, 2)))):
            xx = rng.uniform(x0 + 4, x1 - 4)
            L = rng.uniform(0.15, 0.95) ** 0.8 * (c.hmm - y - 40)
            drip(c, xx + rng.normal(0, 1), y + rng.uniform(-2, 5), L, rng.uniform(1.5, 3.6), th=0.8, wet_end=rng.uniform(0.5, 1.0))
    c.ragged(1.6, 0.18)


def spatter(c, cx, cy, R0, n=160, dir_ang=None, cone=math.pi, th=1.0):
    # 中心の飛び散った塊
    for _ in range(26):
        a, d = rng.uniform(0, 2 * math.pi), abs(rng.normal(0, R0 * 0.45))
        c.stamp(cx + d * math.cos(a), cy + d * math.sin(a), R0 * rng.uniform(0.25, 0.55), None, 0, th, 0.45, soft=1.2)
    for _ in range(n):
        a = rng.uniform(0, 2 * math.pi) if dir_ang is None else dir_ang + rng.uniform(-cone, cone)
        d = R0 * (0.8 + rng.exponential(1.0) * 2.4)
        r = R0 * 0.2 * math.exp(-d / (R0 * 2.6)) * rng.lognormal(0, 0.45)
        r = max(r, 0.35)
        e = 1 + min(3.0, d / R0 * 0.45)
        px_, py_ = cx + d * math.cos(a), cy + d * math.sin(a)
        c.stamp(px_, py_, r * e, r, a, th * rng.uniform(0.7, 1.0), 0.5 if r > 2 else 0.0, soft=0.4)
        if rng.random() < 0.5:   # 尾(遠い側へ小さな点)
            c.stamp(px_ + math.cos(a) * r * e * 1.9, py_ + math.sin(a) * r * e * 1.9, r * 0.35, None, 0, th * 0.8, 0, soft=0.3)
        if r > 2.4 and rng.random() < 0.6:   # 大きい滴は重さで垂れる
            drip(c, px_, py_, rng.uniform(8, 55), r * 0.45, th=0.75, wet_end=0.8, bead=True)
    for _ in range(int(n * 1.6)):   # 霧のような細かい点
        a = rng.uniform(0, 2 * math.pi) if dir_ang is None else dir_ang + rng.uniform(-cone * 1.2, cone * 1.2)
        d = R0 * (1 + rng.exponential(1.0) * 3.2)
        c.stamp(cx + d * math.cos(a), cy + d * math.sin(a), rng.uniform(0.3, 0.8), None, 0, th * 0.8, 0, soft=0.25)


def seep(c):
    """扉の下(区画の上辺)から廊下側へ染み出した溜まり。中は濡れ、縁は乾いて黒い輪"""
    W_, H_ = c.wmm, c.hmm
    xs = c.X[0]
    lob = fbm(1, c.W, c.px(150), 3)[0]
    bump = np.exp(-((xs - W_ * 0.47) / (W_ * 0.3)) ** 2)
    ext = (35 + 120 * bump + 120 * lob ** 1.3) * smooth(0, W_ * 0.2, xs) ** 0.7 * smooth(W_, W_ * 0.8, xs) ** 0.7 + 8
    ext2d = np.broadcast_to(ext, c.X.shape)
    warp = (c.noise(14, 3) - 0.5) * 34
    d = c.Y + warp - ext2d          # < 0 が溜まりの内側
    inside = np.clip(0.5 - d / 1.4, 0, 1)
    ring = np.exp(-((d + 4) / 3.2) ** 2) * 0.45
    body = 0.85 + 0.15 * c.noise(20, 2)
    c.add(inside * body + ring * inside.clip(0.2, 1), np.clip(smooth(-6, -30, d), 0, 1) * (0.75 + 0.25 * c.noise(30, 2)))
    top = smooth(16, 2, c.Y) * smooth(0, W_ * 0.06, c.X) * smooth(W_, W_ * 0.94, c.X)   # 扉の下の隙間の線
    c.add(top * 0.9)
    for _ in range(40):   # 縁の外の点
        x = rng.uniform(W_ * 0.1, W_ * 0.9)
        e = ext[int(min(c.W - 1, c.px(x)))]
        c.stamp(x + rng.normal(0, 6), e + rng.exponential(18), rng.uniform(1.2, 5), None, 0, 0.9, 0.6, soft=0.8)
    c.ragged(3.0, 0.15)


def drag_trail(c):
    """廊下の引きずり痕(区画の x = 引きずった向き、右端 = 扉)。幅のある擦れと進む向きの筋"""
    W_, H_ = c.wmm, c.hmm
    u = c.X / W_
    mid = H_ * 0.5 + (fbm(1, c.W, c.px(500), 2)[0] - 0.5) * 50
    hw = (45 + 55 * smooth(0.0, 0.55, c.X[0] / W_)) * (0.85 + 0.3 * fbm(1, c.W, c.px(160), 2)[0])
    d = np.abs(c.Y - mid) - hw + (c.noise(18, 3) - 0.5) * 24
    band = np.clip(0.5 - d / 4.0, 0, 1) * smooth(1.0, 0.94, u + (c.noise(10, 2) - 0.5) * 0.05)   # 終わり(右端)も丸くぎざぎざに
    streaks = vnoise(c.H, c.W, c.px(2.2), c.px(260)) * 0.6 + vnoise(c.H, c.W, c.px(6), c.px(500)) * 0.4
    patch = smooth(0.42, 0.62, c.noise(60, 3, aniso=5.0) * 0.7 + u * 0.55)
    lift = 0.3 + 0.7 * smooth(0.0, 0.8, u)
    t = band * np.clip(0.15 + 1.05 * streaks, 0, 1.1) * patch * lift
    c.add(t, smooth(0.55, 0.9, u) * smooth(0.5, 0.75, c.noise(70, 2)) * band)
    for _ in range(70):   # 両脇の点(滴り)
        x = rng.uniform(0.05, 0.95) * W_
        side = 1 if rng.random() < 0.5 else -1
        k = int(min(c.W - 1, c.px(x)))
        y = mid[k] + side * (hw[k] + rng.exponential(25))
        if 4 < y < H_ - 4:
            c.stamp(x, y, rng.uniform(1.5, 5.0), None, 0, 0.9, 0.5 * (x / W_), soft=0.7)
    c.ragged(3.5, 0.18)


def smear(c):
    """拭った跡(弧を描く掌の擦れ)。乾いて薄い"""
    cx_, cy_ = c.wmm * 0.92, c.hmm * 1.02
    for k in range(34):
        off = rng.normal(0, 17)
        Rc = 165 + off
        a0 = math.radians(-172 + rng.normal(0, 5))
        a1 = math.radians(-104 + rng.normal(0, 6))
        r = rng.uniform(1.2, 4.5) * (1.3 if abs(off) < 10 else 0.8)
        th0 = rng.uniform(0.35, 0.95)
        n = int(abs(a1 - a0) * Rc / 1.1)
        for i in range(n):
            t = i / n
            if rng.random() < 0.04 + 0.25 * t * t:
                continue
            a = a0 + (a1 - a0) * t
            R = Rc + rng.normal(0, 0.25) + 6 * t * (1 if off > 0 else -1) * 0.3
            c.stamp(cx_ + R * math.cos(a), cy_ + R * math.sin(a), r * (1 - 0.5 * t), None, 0, th0 * (1 - 0.65 * t), 0, soft=0.6)
    c.t *= 0.55 + 0.6 * c.noise(14, 3)
    c.ragged(2.0, 0.15)


def floor_drops(c, x0, w):
    y = 14.0
    while y < c.hmm - 14:
        r = rng.uniform(2.5, 7.5)
        x = x0 + w * 0.5 + rng.normal(0, w * 0.15)
        c.stamp(x, y, r, r * rng.uniform(0.85, 1.1), rng.uniform(0, 3), 1.0, 0.7 * rng.random(), soft=0.6)
        for _ in range(int(r * 1.6)):   # 落ちた滴の王冠(縁のとげ)
            a = rng.uniform(0, 2 * math.pi)
            d = r * rng.uniform(1.0, 1.6)
            c.stamp(x + d * math.cos(a), y + d * math.sin(a), r * rng.uniform(0.12, 0.28), None, 0, 0.9, 0, soft=0.3)
        y += rng.uniform(16, 42)


# ------------------------------------------------------------------ 区画の配置と描画
def build():
    # 1 段目: 手形(1mm/px)
    c = Cell('hand_a', 0, 0, 256, 256, 1.0)         # はっきりした全体の手形(乾き)
    hand(c, 128, 140, 1.0, -6, th=0.95)
    c.ragged(1.4, 0.16); c.commit()
    c = Cell('hand_b', 256, 0, 256, 256, 1.0)       # 指の一部と掌の付け根だけ・横にずれた(濡れ)
    hand(c, 124, 138, 1.04, 14, fingers=(0.9, 1, 0.6, 0, 0.7), palm=0.75, th=1.0, wet=0.8)
    hand(c, 134, 146, 1.04, 18, fingers=(0.4, 0.5, 0.3, 0, 0), palm=0.35, th=0.55)   # 2度押し(ずれ)
    c.ragged(1.4, 0.18); c.commit()
    c = Cell('hand_c', 512, 0, 256, 256, 1.0)       # 指先だけ(引っかいた4本＋短い筋)
    for k, (x, y) in enumerate(((70, 64), (108, 50), (146, 54), (182, 72))):
        c.stamp(x, y, 8.5, 11.5, 0.1 * (k - 1.5), 0.85, 0.5, soft=1.6)
        streak(c, x, y, rng.uniform(70, 170), 8.5, 0.9, lines=2)
    c.t *= 0.5 + 0.7 * c.noise(6, 3)
    c.ragged(1.4, 0.16); c.commit()
    c = Cell('smear', 768, 0, 256, 256, 1.0)        # 拭った跡(ノブ周り・枠)
    smear(c); c.commit()
    # 2 段目: 指の筋つき手形(1mm/px、縦 384mm)・垂れ
    c = Cell('hand_drag_a', 0, 256, 256, 384, 1.0)  # 4本の指が長く下へ
    hand(c, 128, 112, 1.0, 4, spread=0.25, th=1.0, wet=0.6,
         drag=[(0, 180), (1, 250), (2, 215), (3, 140)])
    c.ragged(1.4, 0.16); c.commit()
    c = Cell('hand_drag_b', 256, 256, 256, 384, 1.0)   # 掌ごとずり落ちた(太い擦れ＋指の筋)
    hand(c, 124, 104, 1.02, -8, mirror=True, th=1.0, wet=0.3, drag=[('heel', 230), (1, 200), (2, 160), (0, 120)])
    c.ragged(1.4, 0.18); c.commit()
    c = Cell('drips_a', 512, 256, 256, 384, 1.0); drips_cell(c, 7); c.commit()
    c = Cell('drips_b', 768, 256, 256, 384, 1.0); drips_cell(c, 4); c.commit()
    # 3 段目: 飛沫(1.5mm/px)・染み出し(1.25mm/px)・床の点々・生乾きの垂れ
    c = Cell('spatter', 0, 640, 256, 256, 1.5)
    spatter(c, 192, 160, 26, n=170)
    c.ragged(1.5, 0.12); c.commit()
    c = Cell('seep', 256, 640, 640, 256, 1.25); seep(c); c.commit()
    c = Cell('drops', 896, 640, 64, 256, 1.0); floor_drops(c, 4, 56); c.commit()
    c = Cell('live_drip', 960, 640, 64, 256, 1.0)
    source_blob(c, 22, 42, 12, 4.5, th=1.0, wet=0.9)
    drip(c, 32, 13, 210, 3.3, th=0.9, wet_end=1.0)
    c.wet = np.maximum(c.wet, smooth(0.05, 0.4, c.t) * 0.85)
    c.commit()
    # 4 段目: 引きずり痕(2mm/px、2048mm × 256mm)
    c = Cell('drag', 0, 896, 1024, 128, 2.0); drag_trail(c); c.commit()


def finish():
    t = blur(T, 0.6)
    wet = blur(WET, 1.2)
    a = np.clip(t * 2.3, 0, 1) ** 0.8
    # 色(sRGB 0..1): 薄い所=赤茶、厚い所=黒褐色、濡れ=深い赤
    thin = np.array([108, 28, 20], np.float32) / 255
    mid = np.array([70, 11, 8], np.float32) / 255
    thick = np.array([32, 5, 4], np.float32) / 255
    wetc = np.array([50, 3, 5], np.float32) / 255
    k1 = smooth(0.05, 0.4, t)[..., None]
    k2 = smooth(0.4, 1.05, t)[..., None]
    col = thin * (1 - k1) + mid * k1
    col = col * (1 - k2) + thick * k2
    col = col * (1 - 0.55 * wet[..., None]) + wetc * 0.55 * wet[..., None]
    var = fbm(T.shape[0], T.shape[1], 60, 3)[..., None]
    col = col * (0.82 + 0.36 * var)
    col[a < 0.004] = thin * 0.8      # 透明な所の色(ミップで縁が黒ずまない)
    # 濡れ切った所だけ鋭く光る(0.1 前後=懐中電灯の小さな照り)。半乾きは粗いまま(広いぼんやりした照りで白っぽく見えない)
    rough = 0.9 - 0.8 * smooth(0.35, 0.85, np.clip(wet, 0, 1)) - 0.12 * smooth(0.5, 1.0, t) * (1 - wet)
    rough = rough + (fbm(T.shape[0], T.shape[1], 18, 2) - 0.5) * 0.08
    rough = np.where(a < 0.004, 0.9, rough)
    rgba = np.concatenate([col, a[..., None]], axis=2)
    img = Image.fromarray((np.clip(rgba, 0, 1) * 255 + 0.5).astype(np.uint8)).resize((N, N), Image.LANCZOS)
    p1 = os.path.join(OUT, 'blood_albedo.webp')
    img.save(p1, 'WEBP', quality=88, method=6)
    rimg = Image.fromarray((np.clip(rough, 0, 1) * 255 + 0.5).astype(np.uint8)).resize((N // 2, N // 2), Image.LANCZOS)
    p2 = os.path.join(OUT, 'blood_rough.webp')
    rimg.convert('RGB').save(p2, 'WEBP', quality=85, method=6)
    p3 = os.path.join(OUT, 'blood_atlas.json')
    with open(p3, 'w') as f:
        json.dump({'size': [N, N], 'cells': CELLS,
                   'note': 'rect = [x, y, w, h] px(左上原点・flipY=false の UV と同じ向き)、mm = 実寸。tools/blood_textures.py が生成'},
                  f, ensure_ascii=False, indent=1)
    for p in (p1, p2, p3):
        print(f'{os.path.basename(p)}: {os.path.getsize(p) / 1024:.1f} KB')
    print(f'total: {sum(os.path.getsize(p) for p in (p1, p2, p3)) / 1024:.1f} KB')


if __name__ == '__main__':
    build()
    finish()
