# n2tex.py — 自作の小物テクスチャ(numpy で描く。CC0 扱い・assets/LICENSES.md に「自作」と記載)。
# すべて表示用 sRGB 値(0..1)の HxWx3 配列で描き、save_png で build/tex_<name>.png に保存して bpy 画像を返す。

import os
import numpy as np


def _grid(h, w):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    return yy, xx


def _seg(xx, yy, ax, ay, bx, by, r):
    vx, vy = bx - ax, by - ay
    t = np.clip(((xx - ax) * vx + (yy - ay) * vy) / (vx * vx + vy * vy + 1e-9), 0, 1)
    return (xx - (ax + t * vx)) ** 2 + (yy - (ay + t * vy)) ** 2 <= r * r


def _noise(h, w, seed, octaves=((8, 1.0), (32, 0.5), (128, 0.25))):
    """値ノイズの重ね合わせ(0..1)。"""
    rng = np.random.default_rng(seed)
    out = np.zeros((h, w), np.float32)
    tot = 0.0
    for cells, amp in octaves:
        g = rng.random((cells + 1, cells + 1)).astype(np.float32)
        g[-1, :] = g[0, :]; g[:, -1] = g[:, 0]      # タイル可能に
        ys = np.linspace(0, cells, h, endpoint=False); xs = np.linspace(0, cells, w, endpoint=False)
        y0 = ys.astype(int); x0 = xs.astype(int)
        fy = (ys - y0)[:, None]; fx = (xs - x0)[None, :]
        fy = fy * fy * (3 - 2 * fy); fx = fx * fx * (3 - 2 * fx)
        a = g[y0][:, x0]; b = g[y0][:, x0 + 1]; c = g[y0 + 1][:, x0]; d = g[y0 + 1][:, x0 + 1]
        out += amp * (a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy)
        tot += amp
    return out / tot


def wire_glass(n=256, cells=12):
    """網入りガラス(菱形ワイヤー)。暗いガラス地に細い金属線。タイル可能。"""
    yy, xx = _grid(n, n)
    s = n / cells
    def line(v):
        d = np.abs(((v / s) + 0.5) % 1.0 - 0.5) * s
        return np.clip(1.4 - d, 0, 1)
    w = np.maximum(line(xx + yy), line(xx - yy))
    img = np.zeros((n, n, 3), np.float32)
    img[:] = (0.035, 0.04, 0.045)
    img += w[..., None] * (np.array([0.50, 0.50, 0.48], np.float32) - img)
    return img


def seven_seg(img, x, y, h, color, digit_segments):
    """7セグ数字を描く。(x,y)=左上、h=高さ(px)。digit_segments は 'abcdefg' の部分集合。"""
    H, W, _ = img.shape
    yy, xx = _grid(H, W)
    w = h * 0.55; t = h * 0.11
    segs = {
        'a': (x + t, y, x + w - t, y), 'b': (x + w, y + t, x + w, y + h / 2 - t),
        'c': (x + w, y + h / 2 + t, x + w, y + h - t), 'd': (x + t, y + h, x + w - t, y + h),
        'e': (x, y + h / 2 + t, x, y + h - t), 'f': (x, y + t, x, y + h / 2 - t),
        'g': (x + t, y + h / 2, x + w - t, y + h / 2),
    }
    m = np.zeros((H, W), bool)
    for k in digit_segments:
        m |= _seg(xx, yy, *segs[k], t / 2)
    img[m] = color


def ev_display(w=96, h=234):
    """呼びパネル上段: 黒い艶面の階数表示。青白LEDで「4」と上向き矢印(小)。"""
    img = np.zeros((h, w, 3), np.float32)
    img[:] = (0.012, 0.012, 0.016)
    led = (0.62, 0.86, 1.0)
    yy, xx = _grid(h, w)
    # 上向き矢印(小・薄く)
    ax, ay = w * 0.5, h * 0.20
    m = _seg(xx, yy, ax, ay - 9, ax, ay + 9, 1.4) | _seg(xx, yy, ax, ay - 9, ax - 6, ay - 3, 1.4) | _seg(xx, yy, ax, ay - 9, ax + 6, ay - 3, 1.4)
    img[m] = np.array(led) * 0.45
    seven_seg(img, w * 0.5 - 0.55 * 34 / 2, h * 0.30, 34, led, 'bcfg')   # 「4」
    return img


def ev_plate(w=96, h=320, seed=3):
    """呼びパネル下段: ヘアラインのステンレス板に ▲▼ 丸ボタン2個・車椅子ピクト・低い位置に ▲▼ 2個。"""
    rng = np.random.default_rng(seed)
    streak = rng.random((1, w)).astype(np.float32)
    streak = np.convolve(streak[0], np.ones(3) / 3, mode='same')[None, :]
    base = 0.50 + 0.10 * (streak - 0.5) + 0.03 * (rng.random((h, w)).astype(np.float32) - 0.5)
    img = np.repeat(base[..., None], 3, axis=2) * np.array([1.0, 1.0, 0.98], np.float32)
    yy, xx = _grid(h, w)
    cx = w * 0.5
    r = w * 0.13
    def button(cy, up):
        d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
        img[(d <= r) & (d > r * 0.80)] = (0.22, 0.22, 0.22)          # 縁(影)
        img[d <= r * 0.80] = (0.70, 0.70, 0.69)                         # 押しボタン面
        s = r * 0.42
        if up:
            tri = (yy >= cy - s * 0.6) & (yy <= cy + s * 0.5) & (np.abs(xx - cx) <= (yy - (cy - s * 0.6)) * 0.62)
        else:
            tri = (yy <= cy + s * 0.6) & (yy >= cy - s * 0.5) & (np.abs(xx - cx) <= ((cy + s * 0.6) - yy) * 0.62)
        img[tri] = (0.12, 0.12, 0.12)
    for fy, up in ((0.19, True), (0.34, False), (0.70, True), (0.83, False)):
        button(h * fy, up)
    # 車椅子ピクト(青地に白)
    q = w * 0.12; cy = h * 0.53
    sq = (np.abs(xx - cx) <= q) & (np.abs(yy - cy) <= q)
    img[sq] = (0.10, 0.32, 0.78)
    wm = (((xx - cx + q * 0.15) ** 2 + (yy - cy - q * 0.3) ** 2 <= (q * 0.5) ** 2) &
          ((xx - cx + q * 0.15) ** 2 + (yy - cy - q * 0.3) ** 2 >= (q * 0.36) ** 2))
    wm |= (xx - cx + q * 0.05) ** 2 + (yy - cy + q * 0.62) ** 2 <= (q * 0.16) ** 2
    wm |= _seg(xx, yy, cx - q * 0.05, cy - q * 0.42, cx - q * 0.05, cy + q * 0.05, q * 0.09)
    wm |= _seg(xx, yy, cx - q * 0.05, cy + q * 0.05, cx + q * 0.45, cy + q * 0.05, q * 0.08)
    wm |= _seg(xx, yy, cx + q * 0.45, cy + q * 0.05, cx + q * 0.62, cy + q * 0.6, q * 0.08)
    img[sq & wm] = (0.95, 0.96, 0.98)
    return img


def car_stone(n=512, seed=11):
    """カゴ腰下の青灰色のまだら石目パネル。"""
    a = _noise(n, n, seed, ((6, 1.0), (24, 0.6), (96, 0.5), (256, 0.35)))
    rng = np.random.default_rng(seed + 1)
    speck = (rng.random((n, n)) > 0.985).astype(np.float32) * 0.18
    base = np.array([0.45, 0.50, 0.58], np.float32)
    v = (a - 0.5) * 0.42 + speck
    return np.clip(base[None, None, :] * (1.0 + v[..., None]), 0, 1)


def exit_sign_square(w=320, h=300):
    """避難口誘導灯(内照式・正方形に近い)。緑地・白い扉形・扉へ走り込む緑の人。"""
    yy, xx = _grid(h, w)
    green = np.array([0.0, 0.66, 0.36], np.float32)
    img = np.zeros((h, w, 3), np.float32); img[:] = green
    door = (xx >= w * 0.40) & (xx <= w * 0.92) & (yy >= h * 0.10) & (yy <= h * 0.92)
    img[door] = (0.96, 0.98, 0.97)
    m = (xx - w * 0.52) ** 2 + (yy - h * 0.20) ** 2 <= (h * 0.065) ** 2
    m |= _seg(xx, yy, w * 0.50, h * 0.30, w * 0.43, h * 0.56, h * 0.055)
    m |= _seg(xx, yy, w * 0.49, h * 0.34, w * 0.62, h * 0.43, h * 0.032) | _seg(xx, yy, w * 0.62, h * 0.43, w * 0.70, h * 0.36, h * 0.03)
    m |= _seg(xx, yy, w * 0.48, h * 0.34, w * 0.36, h * 0.42, h * 0.032) | _seg(xx, yy, w * 0.36, h * 0.42, w * 0.30, h * 0.50, h * 0.03)
    m |= _seg(xx, yy, w * 0.43, h * 0.56, w * 0.58, h * 0.66, h * 0.04) | _seg(xx, yy, w * 0.58, h * 0.66, w * 0.60, h * 0.84, h * 0.035)
    m |= _seg(xx, yy, w * 0.43, h * 0.56, w * 0.34, h * 0.72, h * 0.04) | _seg(xx, yy, w * 0.34, h * 0.72, w * 0.20, h * 0.75, h * 0.035)
    img[m] = green * 0.92
    return img


def save_png(bpy, root, name, arr):
    """表示用 sRGB 値の配列を build/tex_<name>.png に保存し、sRGB の bpy 画像として読み直して返す。"""
    h, w, _ = arr.shape
    rgba = np.concatenate([arr[::-1], np.ones((h, w, 1), np.float32)], axis=2)  # Blender は下の行から
    im = bpy.data.images.new('tmp_' + name, w, h, alpha=False)
    im.pixels.foreach_set(np.clip(rgba, 0, 1).astype(np.float32).ravel())
    path = os.path.join(root, 'build', f'tex_{name}.png')
    im.filepath_raw = path
    im.file_format = 'PNG'
    im.save()
    bpy.data.images.remove(im)
    img = bpy.data.images.load(path, check_existing=False)
    img.colorspace_settings.name = 'sRGB'
    return img


def _noise_aniso(h, w, cy, cx, seed):
    """タイル可能な値ノイズ(縦 cy × 横 cx セル)。cx<<cy で横長の筋、cy<<cx で縦長の筋。"""
    rng = np.random.default_rng(seed)
    g = rng.random((cy, cx)).astype(np.float32)
    ys = np.arange(h) * cy / h; xs = np.arange(w) * cx / w
    y0 = ys.astype(int); x0 = xs.astype(int)
    fy = (ys - y0)[:, None]; fx = (xs - x0)[None, :]
    fy = fy * fy * (3 - 2 * fy); fx = fx * fx * (3 - 2 * fx)
    y1 = (y0 + 1) % cy; x1 = (x0 + 1) % cx
    a = g[y0][:, x0]; b = g[y0][:, x1]; c = g[y1][:, x0]; d = g[y1][:, x1]
    return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy


def floor_sheet(n=1024, seed=21):
    """廊下の長尺シート(写真 corridor_to_ev_4F / ev_open_and_exit_door): 淡いグレー地に、
    細い掻き傷状の横筋・縦筋がまだらに入る柄。1枚 = 1.0m 角のタイル。
    戻り値: (albedo sRGB HxWx3, normal(OpenGL) HxWx3, roughness HxW)"""
    sel = _noise_aniso(n, n, 6, 6, seed) * 0.6 + _noise_aniso(n, n, 13, 13, seed + 1) * 0.4   # 横/縦どちらが優勢か
    patch = _noise_aniso(n, n, 10, 10, seed + 2) * 0.5 + _noise_aniso(n, n, 26, 26, seed + 3) * 0.5
    t = np.clip((sel - 0.5) * 5 + 0.5, 0, 1)
    def flecks(cy, cx, sd, thr):
        z = _noise_aniso(n, n, cy, cx, sd) - 0.5
        dark = np.clip((-z - thr) * 7.0, 0, 1)            # 暗い掻き傷(閾値でくっきり)
        light = np.clip((z - thr) * 5.0, 0, 1)
        return dark, light
    hd, hl = flecks(520, 34, seed + 4, 0.16)               # 横に短い細い傷(約3cm×2mm)
    vd, vl = flecks(34, 520, seed + 5, 0.16)
    hd2, _ = flecks(260, 16, seed + 6, 0.20)
    vd2, _ = flecks(16, 260, seed + 7, 0.20)
    mott = np.clip((patch - 0.5) * 2.4, -1, 1)
    amp = 0.45 + 0.55 * np.clip(mott + 0.4, 0, 1)          # 濃いまだらほど傷が密
    dark = (t * (hd + 0.6 * hd2) + (1 - t) * (vd + 0.6 * vd2)) + 0.45 * ((1 - t) * hd + t * vd)
    light = t * hl + (1 - t) * vl
    grain = np.random.default_rng(seed + 8).random((n, n)).astype(np.float32) - 0.5
    v = 0.63 + 0.03 * mott - 0.30 * np.clip(dark, 0, 1.2) * amp + 0.06 * light + 0.05 * grain
    v = np.clip(v, 0, 1)
    albedo = np.stack([v * 1.0, v * 0.975, v * 0.935], axis=2)
    strokes = light - dark
    height = strokes * 0.5 + grain * 0.2
    gy, gx = np.gradient(height)
    k = 2.0
    nx, ny = -gx * k, gy * k                               # OpenGL: +Y 上(画像は上が行0なので符号を反転)
    nz = np.ones_like(nx)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    normal = np.stack([nx / l * 0.5 + 0.5, ny / l * 0.5 + 0.5, nz / l * 0.5 + 0.5], axis=2)
    rough = np.clip(0.72 + 0.08 * mott + 0.06 * np.clip(dark, 0, 1), 0.4, 0.95)
    return albedo.astype(np.float32), normal.astype(np.float32), rough.astype(np.float32)
