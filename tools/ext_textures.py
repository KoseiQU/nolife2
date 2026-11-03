# ext_textures.py — P3c: 外観・外環境の実行時テクスチャ(すべて自作の手続き描画。写真・既存素材は使わない)。
#   build/tex/ext_sky.webp      2048×1024  曇った夜空(正距円筒)。雲・南西の月の暈・東南東の街明かりの照り返し。値は ×SKY_K で保存(実行時に backgroundIntensity=1/SKY_K)
#   build/tex/ext_trees.webp    1024×512   RGBA 針葉樹(杉・檜)のシルエット 4 種(中景のビルボード)。アルファ=形
#   build/tex/ext_city.webp     2048×256   RGBA 遠くのビル群の夜景(谷の向こう)。RGB=灯りの色、A=建物と地面の覆い
#   build/tex/ext_ground.jpg    1024       林床(落ち葉・苔・土。地形)
#   build/tex/ext_grass.jpg     512        植え込み・草地
#   build/tex/ext_pavers.jpg    1024       アプローチの舗装(コンクリート平板)
#   build/tex/ext_fence.png     256        メッシュフェンス(溶接金網)。アルファ=針金
#   build/tex/ext_textures.json            ↑の座標の取り決め(月・街の方位など。build_exterior.py と src/exterior.js が読む)
# 実行: python3 tools/ext_textures.py   (乱数の種は固定。何度実行しても同じ結果。numpy が要るので -I は付けない)
import json, math, os
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'build', 'tex')
rng = np.random.default_rng(20261102)

# 方位(ゲーム座標: x=東, z=南。az = atan2(z, x)。0=東, 90°=南, 180°=西)
MOON_AZ = math.radians(135.0)     # 南西(P3b のベイクの月明かり N2_Moon と同じ向き)
MOON_EL = math.radians(36.0)
CITY_AZ = (math.radians(-12.0), math.radians(40.0))   # 東南東の谷の向こう
SKY_K = 16.0


def lin2srgb(x):
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def srgb2lin(x):
    x = np.asarray(x, np.float32) / 255.0
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def tile_noise(n, cell, r=None):
    """n×n の繰り返せる値ノイズ(格子 cell px、双三次)。0..1。r = 乱数(既定は共通の rng)"""
    g = max(1, n // cell)
    a = (r or rng).random((g, g)).astype(np.float32)
    ap = np.pad(a, 3, mode='wrap')
    im = Image.fromarray(ap).resize(((g + 6) * cell, (g + 6) * cell), Image.BICUBIC)
    b = np.asarray(im, np.float32)[3 * cell:3 * cell + n, 3 * cell:3 * cell + n]
    return np.clip(b, 0, 1)


def tile_fbm(n, cell, octaves=5, gain=0.5, r=None):
    s = np.zeros((n, n), np.float32); amp = 1.0; tot = 0.0; c = cell
    for _ in range(octaves):
        s += amp * tile_noise(n, max(2, int(c)), r); tot += amp; amp *= gain; c /= 2
    return s / tot


def sample_wrap(tex, u, v):
    """繰り返しテクスチャを実数座標(px)で双線形に引く。"""
    n0, n1 = tex.shape
    x0 = np.floor(u).astype(np.int64); y0 = np.floor(v).astype(np.int64)
    fx = (u - x0).astype(np.float32); fy = (v - y0).astype(np.float32)
    x0 %= n1; y0 %= n0; x1 = (x0 + 1) % n1; y1 = (y0 + 1) % n0
    return (tex[y0, x0] * (1 - fx) * (1 - fy) + tex[y0, x1] * fx * (1 - fy) + tex[y1, x0] * (1 - fx) * fy + tex[y1, x1] * fx * fy)


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------ 夜空(正距円筒)
def make_sky():
    W, H = 2048, 1024
    u = (np.arange(W) + 0.5) / W
    v = (np.arange(H) + 0.5) / H
    U, V = np.meshgrid(u, v)
    th = (U - 0.5) * 2 * math.pi            # three.js equirectUv: u = atan(z,x)/2π + 0.5
    el = (0.5 - V) * math.pi                # 画像の上 = 天頂(flipY=true で読む)
    dx, dy, dz = np.cos(el) * np.cos(th), np.sin(el), np.cos(el) * np.sin(th)
    zen = np.array([0.0011, 0.0013, 0.0019]); hor = np.array([0.0036, 0.0040, 0.0051])
    t = np.exp(-np.maximum(el, 0) / 0.32)[..., None]
    base = zen + (hor - zen) * t
    # 雲: 雲底の平面に投影した fbm(地平線へ向かって潰れる)
    cl = tile_fbm(1024, 256, 6)
    cl2 = tile_fbm(1024, 64, 4)
    s = 1.0 / (np.maximum(dy, 0.015) + 0.05)
    px, pz = dx * s * 120.0, dz * s * 120.0
    c = sample_wrap(cl, px, pz) * 0.75 + sample_wrap(cl2, px * 1.7 + 300, pz * 1.7) * 0.25
    c = smooth(0.32, 0.78, c)
    c = np.where(el > -0.02, c, 0.6)
    L = base * (0.72 + 0.56 * c[..., None])
    # 月(南西の空。薄い雲越しの暈と、雲の切れ目でうっすら見える円盤)
    md = np.array([math.cos(MOON_EL) * math.cos(MOON_AZ), math.sin(MOON_EL), math.cos(MOON_EL) * math.sin(MOON_AZ)])
    ca = np.clip(dx * md[0] + dy * md[1] + dz * md[2], -1, 1)
    a = np.arccos(ca)
    halo = 0.0105 * np.exp(-(a / 0.11) ** 2) + 0.0042 * np.exp(-a / 0.38)
    halo = halo * (0.5 + 0.75 * c)
    disk = smooth(0.0125, 0.0085, a) * 0.11 * (1.0 - 0.75 * c)
    L += (halo + disk)[..., None] * np.array([0.78, 0.84, 1.0])
    # 東南東の街明かりの照り返し(雲の下面がうっすら橙に)
    c0, c1 = CITY_AZ
    cc = (c0 + c1) / 2; hw = (c1 - c0) / 2
    dth = np.angle(np.exp(1j * (th - cc)))
    w = np.exp(-(dth / (hw * 0.95)) ** 2) * np.exp(-np.maximum(el, 0) / 0.11)
    L += (w * (0.55 + 0.7 * c))[..., None] * np.array([0.0072, 0.0049, 0.0028])
    # 地平線より下(地形に隠れる。念のため暗い霞)
    below = el < 0
    L = np.where(below[..., None], (hor * 0.55)[None, None, :] * np.exp(el / 0.25)[..., None] + L * 0.0 + (w * 0.5 * np.exp(el / 0.06))[..., None] * np.array([0.0072, 0.0049, 0.0028]), L)
    img = lin2srgb(L * SKY_K) * 255 + (rng.random((H, W, 1)) - 0.5) * 0.9
    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(os.path.join(OUT, 'ext_sky.webp'), quality=88, method=6)


# ------------------------------------------------------------------ 針葉樹のシルエット(中景のビルボード)
def make_trees():
    """杉・檜の林のシルエット。細い円錐の芯に、垂れた枝の塊(楕円)を不規則に重ねる。"""
    SS = 2
    W, H = 256 * SS, 512 * SS
    atlas = np.zeros((512, 1024, 4), np.float32)
    Y, X = np.mgrid[0:H, 0:W].astype(np.float32)
    for vi in range(4):
        A = np.zeros((H, W), np.float32)
        S = np.zeros((H, W), np.float32)          # 明るさ(塊の上ほど明るい)
        cx = W / 2 + rng.uniform(-5, 5) * SS
        top = int((6 + vi * 5) * SS)
        base = int(H * rng.uniform(0.86, 0.9))
        wmax = rng.uniform(62, 82) * SS
        def wof(y):
            t = np.clip((y - top) / (base - top), 0, 1)
            return wmax * (0.06 + 0.94 * t ** 0.85)
        # 芯(細い円錐)
        core = np.abs(X - cx) < wof(Y) * 0.42
        core &= (Y > top) & (Y < base)
        A[core] = 1; S[core] = 0.35
        # 枝の塊
        n = int(rng.integers(70, 95))
        for k in range(n):
            y = top + (base - top) * (rng.random() ** 0.8)
            w = wof(y)
            side = rng.choice([-1, 1])
            x = cx + side * w * rng.uniform(0.15, 0.78)
            rx = w * rng.uniform(0.28, 0.5); ry = rx * rng.uniform(0.32, 0.55)
            yy = y + ry * 0.3
            m = ((X - x) / rx) ** 2 + ((Y - yy) / ry) ** 2 < 1
            m &= (Y - yy) > -ry * 0.55 + 0.25 * np.abs(X - x) * (0.4)   # 上側を平らに(垂れた枝)
            A[m] = 1
            S[m] = np.maximum(S[m], np.clip(0.55 + 0.45 * (1 - (Y[m] - (yy - ry)) / (2 * ry)), 0, 1))
        # 幹(根元)
        tw = 4 * SS
        tr = (np.abs(X - cx) < tw) & (Y >= base - 12 * SS) & (Y < H - 2 * SS)
        A[tr] = 1
        nse = np.asarray(Image.fromarray(rng.random((H // 2, W // 2)).astype(np.float32)).resize((W, H), Image.BILINEAR))
        k = (0.5 + 0.6 * S) * (0.8 + 0.4 * nse)
        g = np.stack([26 * k + 6, 40 * k + 8, 33 * k + 7], -1)
        g[tr] = np.array([44, 36, 30]) * (0.8 + 0.3 * nse[tr])[:, None]
        sub = np.zeros((H, W, 4), np.float32); sub[..., :3] = g; sub[..., 3] = A * 255
        small = np.asarray(Image.fromarray(sub.astype(np.uint8)).resize((256, 512), Image.LANCZOS), np.float32)
        atlas[:, vi * 256:(vi + 1) * 256] = small
    # 透明部の色を平均の葉の色で埋める(ミップマップで縁が黒ずまない)
    m = atlas[..., 3] > 127
    mean = atlas[m][:, :3].mean(0)
    atlas[~m, :3] = mean
    Image.fromarray(np.clip(atlas, 0, 255).astype(np.uint8)).save(os.path.join(OUT, 'ext_trees.webp'), quality=90, method=6)


# ------------------------------------------------------------------ 遠くのビル群
def make_city():
    W, H = 2048, 256
    HR = 142                                  # 地平線(平野の奥の線)の行
    rgb = np.zeros((H, W, 3), np.float32)     # 灯りの色(0..1、実行時に強さを掛ける)
    A = np.zeros((H, W), np.float32)
    A[HR:, :] = 1.0
    # 平野の街灯(奥ほど行が詰まる)。ナトリウム灯の橙と LED の白、幹線道路の連なり
    cxs = np.arange(W)
    dens = 0.5 + 0.5 * np.exp(-((cxs - 1080) / 620.0) ** 2)
    nrow = 46
    blocks = np.clip((np.asarray(Image.fromarray(rng.random((1, W // 24)).astype(np.float32)).resize((W, 1), Image.BICUBIC))[0] - 0.35) * 2.2, 0, 1)
    for k in range(nrow):
        y = int(HR + 1 + (H - HR - 2) * (k / nrow) ** 1.9)
        p = 0.03 + 0.06 * (1 - k / nrow)
        hit = rng.random(W) < p * dens * blocks
        col = np.where(rng.random(W)[:, None] < 0.6, np.array([1.0, 0.56, 0.22]), np.array([0.86, 0.9, 1.0]))
        br = 0.35 + 0.65 * rng.random(W)
        rgb[y, hit] = np.maximum(rgb[y, hit], (col * br[:, None])[hit])
    for r in range(5):   # 幹線道路(点の連なり)
        y = int(HR + 4 + (H - HR - 8) * ((r + 0.5) / 5) ** 1.7)
        x0 = int(rng.integers(0, W - 520)); x1 = x0 + int(rng.integers(120, 520))
        xs = np.arange(x0, x1, rng.integers(2, 4))
        rgb[y, xs] = np.maximum(rgb[y, xs], np.array([1.0, 0.62, 0.3]) * 0.8)
    # ビル(中心の都心ほど高く密に)
    x = 0
    blds = []
    while x < W:
        cen = 0.35 + 0.65 * math.exp(-((x - 1080) / 520.0) ** 2)
        w = int(rng.integers(5, 16) + 14 * rng.random() * cen)
        h = int(4 + rng.gamma(1.6, 6.0) * (0.4 + 1.6 * cen) + (rng.random() < 0.08 * cen) * rng.integers(30, 60))
        h = min(h, 112)
        if rng.random() < 0.85 - 0.5 * (1 - cen):
            blds.append((x, w, h))
        x += w + int(rng.integers(0, 4) * (1.5 - cen))
    for (x0, w, h) in sorted(blds, key=lambda b: -b[2]):   # 高いものから描いて手前(低い)で上書き
        y0 = HR - h
        A[y0:HR, x0:x0 + w] = 1.0
        rgb[y0:HR, x0:x0 + w] = 0
        p = rng.uniform(0.12, 0.45)
        warm = rng.random() < 0.55
        for yy in range(y0 + 1, HR - 1, 2):
            for xx in range(x0 + 1, min(W, x0 + w - 1), 2):
                if rng.random() < p:
                    c = np.array([1.0, 0.8, 0.55]) if (warm if rng.random() < 0.85 else not warm) else np.array([0.85, 0.92, 1.0])
                    rgb[yy, xx] = c * (0.45 + 0.55 * rng.random())
        if h > 34 and rng.random() < 0.8:    # 航空障害灯(赤。実行時に点滅)
            for xx in (x0, x0 + w - 1):
                if 0 <= xx < W:
                    rgb[y0, xx] = np.array([1.0, 0.04, 0.02])
    rgba = np.zeros((H, W, 4), np.uint8)
    rgba[..., :3] = np.clip(lin2srgb(rgb) * 255, 0, 255).astype(np.uint8)
    rgba[..., 3] = (A * 255).astype(np.uint8)
    Image.fromarray(rgba).save(os.path.join(OUT, 'ext_city.webp'), lossless=True, method=6)
    return HR


# ------------------------------------------------------------------ 地面の素材
def save_jpg(arr, name, q=85):
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).save(os.path.join(OUT, name), quality=q, optimize=True)


def make_ground():
    n = 1024
    f = tile_fbm(n, 256, 6)
    f2 = tile_fbm(n, 32, 3)
    speck = tile_noise(n, 4)
    base = np.stack([52 + 30 * f, 47 + 26 * f, 34 + 16 * f], -1)
    moss = np.stack([34 + 0 * f, 52 + 0 * f, 30 + 0 * f], -1)
    m = smooth(0.55, 0.75, f2)[..., None]
    img = base * (1 - m) + moss * m
    img *= (0.82 + 0.36 * speck)[..., None]
    needles = (tile_noise(n, 2) > 0.86)[..., None]
    img = np.where(needles, img * 1.35 + np.array([12, 6, 0]), img)
    save_jpg(img, 'ext_ground.jpg', 82)
    n = 512
    f = tile_fbm(n, 128, 5); s = tile_noise(n, 3)
    img = np.stack([30 + 18 * f, 50 + 26 * f, 28 + 12 * f], -1) * (0.7 + 0.6 * s)[..., None]
    save_jpg(img, 'ext_grass.jpg', 82)


def make_pavers():
    """アプローチのコンクリート平板(300×300mm、1 タイル = 1.2m = 1024px)。目地は暗い。"""
    n = 1024
    pv = n // 4
    img = np.zeros((n, n, 3), np.float32)
    f = tile_fbm(n, 64, 4)
    s = tile_noise(n, 2)
    for j in range(4):
        for i in range(4):
            tone = rng.normal(0, 7)
            img[j * pv:(j + 1) * pv, i * pv:(i + 1) * pv] = np.array([150, 147, 140]) + tone
    img *= (0.88 + 0.2 * f + 0.06 * (s - 0.5))[..., None]
    g = 4
    for k in range(4):
        img[k * pv:k * pv + g, :] *= 0.45
        img[:, k * pv:k * pv + g] *= 0.45
    save_jpg(img, 'ext_pavers.jpg', 84)


def make_fence():
    """メッシュフェンス(溶接金網: 縦線 5cm・横線 15cm、上下に折り返しの二重線)。256px = 1m。"""
    n = 256
    a = np.zeros((n, n), np.float32)
    for x in range(0, n, 13):
        a[:, x:x + 2] = 1
    for y in range(0, n, 38):
        a[y:y + 2, :] = 1
    a[20:24, :] = 1; a[n - 24:n - 20, :] = 1
    rgba = np.zeros((n, n, 4), np.uint8)
    rgba[..., :3] = np.array([64, 76, 66], np.uint8)
    rgba[..., 3] = (a * 255).astype(np.uint8)
    Image.fromarray(rgba).save(os.path.join(OUT, 'ext_fence.png'), optimize=True)


# ================================================================== P6b-F2: 外観の磨き直し(DESIGN §3.12 #3 F2)。すべて自作の手続き描画
#   build/tex/ext_tile_albedo.jpg   1024  外壁のタイル(二丁掛 227×60mm・目地 6mm・馬踏み)＋雨だれの縦筋。1 枚 = 幅 2.82m × 1 階分(2.9m)。
#                                         画像の上 = 階の上端(スラブの下)。雨だれは上端から垂れて下へ薄れる
#   build/tex/ext_tile_normal.jpg   1024  目地(凹み)とタイルの面のわずかなうねり
#   build/tex/ext_tile_rough.jpg    512   タイル 0.55・目地 0.85・雨だれ +0.15
#   build/tex/ext_asphalt_albedo.jpg 1024 濡れたアスファルト(黒い結合材＋骨材の粒)。1 枚 = 4m
#   build/tex/ext_asphalt_normal.jpg 1024 骨材の凹凸
#   build/tex/ext_asphalt_rough.jpg  512  粗さ 0.3 前後(水の膜の濃い所 0.15〜乾きかけ 0.45)
#   build/tex/ext_wet.webp          1024  RGBA 敷地の地面に重ねる濡れの膜(敷地全体に 1 枚。UV は wetBox)。A = 水たまり(下の地面の拡散を消す)、
#                                         RGB = 映り込みの発光(空の暗い映り込み＋照明柱・ポーチ・張り出しの下の灯りの映り込み)。値は「発光 ÷ A」で保存(実行時は 発光×A が足される)
#   build/tex/ext_partition_albedo.jpg 512 バルコニーの隔て板(塗装したケイ酸カルシウム板)。1 枚 = 1.2m
#   build/tex/ext_partition_normal.jpg 512 板の微細な凹凸
#   build/tex/ext_glass_sheen.webp  256   RGBA 窓ガラスの映り込みの膜(窓 1 枚 = 1 枚。A = 映り込みの濃さ、RGB = 暗い空の映り込み)
WET_S = 1.0          # 濡れの膜の発光の強さ(GLB の emissive の強さ。実行時は emissive を (1,1,1) にするので 1 に固定)
GLASS_S = 1.0        # ガラスの膜の発光の強さ(同上)
TILE_W, TILE_H = 2.82, 2.9


def _nrm_from_height(h, k):
    gy, gx = np.gradient(h.astype(np.float32))
    nx, ny, nz = -gx * k, gy * k, np.ones_like(h, np.float32)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / l * 0.5 + 0.5, ny / l * 0.5 + 0.5, nz / l * 0.5 + 0.5], axis=2) * 255


def _save_atomic(img, name, **kw):
    """一時ファイルに書いてから置き換える(別のサーバーが同時に読んでいても壊れたファイルを返さない)。"""
    path = os.path.join(OUT, name)
    ext = os.path.splitext(name)[1]
    tmp = path + '.tmp' + ext
    img.save(tmp, **kw)
    os.replace(tmp, path)


def _jpg(arr, name, q=85):
    _save_atomic(Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)), name, quality=q, optimize=True)


def make_tile_wall(r):
    n = 1024
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    px_m = n / TILE_W                       # 横 1m の px
    py_m = n / TILE_H
    cols, rows = 12, 44                     # 12 枚 × 44 段 = 235mm × 65.9mm のピッチ
    pw, ph = n / cols, n / rows
    row = np.floor(yy / ph)
    xs = xx + (row % 2) * pw / 2            # 馬踏み(段ごとに半枚ずらす)
    col = np.floor(xs / pw) % cols
    fx = (xs % pw); fy = (yy % ph)
    jw = 0.006 * px_m; jh = 0.006 * py_m    # 目地 6mm
    # 目地からの距離(px)→ 0(目地)..1(タイル面)。縁は 1.2px の面取り
    dx = np.minimum(fx, pw - fx) - jw / 2
    dy = np.minimum(fy, ph - fy) - jh / 2
    d = np.minimum(dx, dy)
    face = np.clip(d / 1.2, 0, 1)
    joint = 1.0 - np.clip(d + 0.5, 0, 1)
    # タイルごとの色むら(焼きむら)
    tid = (row * 131 + col * 17) % 997
    tone = (np.sin(tid * 12.9898) * 43758.5453) % 1.0
    tone2 = (np.sin(tid * 78.233) * 12543.123) % 1.0
    fine = tile_noise(n, 3, r) - 0.5
    mott = tile_fbm(n, 128, 4, r=r) - 0.5
    base = np.array([158.0, 153.0, 144.0])              # 灰色がかったベージュ(sRGB。写真の躯体の色を夜の明るさに)
    alb = base[None, None, :] * (1.0 + 0.045 * (tone[..., None] - 0.5) + 0.02 * (tone2[..., None] - 0.5) * np.array([1.0, 0.6, -0.6])[None, None, :]
                                 + 0.03 * fine[..., None] + 0.05 * mott[..., None])
    grout = np.array([136.0, 133.0, 126.0])
    alb = alb * (1 - joint[..., None]) + grout[None, None, :] * joint[..., None] * (1 + 0.04 * fine[..., None])
    # 雨だれ: 上端(スラブ・水切りの下)から垂れる縦筋。横は繰り返す(x を周期で巻く)
    streak = np.zeros((n, n), np.float32)
    top_d = yy / py_m                                    # 上端からの距離(m)
    for i in range(22):
        x0 = r.uniform(0, n)
        w = r.uniform(0.010, 0.07) * px_m * (0.5 if i % 3 == 0 else 1.0)
        L = r.uniform(0.3, 2.2) * (0.5 if i % 2 else 1.0)
        k = r.uniform(0.04, 0.15) * (1.3 if w < 0.03 * px_m else 1.0)
        mer = r.uniform(0.0, 0.025) * px_m
        ph_ = r.uniform(0, 6.28)
        xc = x0 + mer * np.sin(top_d * r.uniform(2.0, 5.0) + ph_)
        dxw = np.abs(((xx - xc + n / 2) % n) - n / 2)
        prof = np.exp(-(dxw / w) ** 2)
        fade = np.clip(1.0 - top_d / L, 0, 1) ** 1.6
        brk = 0.7 + 0.6 * tile_noise(n, 16, r)                # 筋の途切れ
        streak += k * prof * fade * brk
    streak += 0.06 * np.exp(-top_d / 0.06) * (0.7 + 0.6 * tile_noise(n, 32, r))   # 上端の帯(スラブの小口からの汚れ)
    streak = np.clip(streak * (1.0 + 0.6 * joint), 0, 0.55)  # 目地に溜まる
    alb = alb * (1.0 - streak[..., None]) + np.array([40.0, 38.0, 34.0])[None, None, :] * streak[..., None] * 0.25
    _jpg(alb, 'ext_tile_albedo.jpg', 86)
    h = face * 1.0 + 0.05 * mott + 0.02 * fine
    _jpg(_nrm_from_height(h, 1.4), 'ext_tile_normal.jpg', 88)
    rgh = 0.55 + 0.30 * joint + 0.15 * np.clip(streak / 0.3, 0, 1) + 0.05 * fine
    _jpg(np.repeat((np.clip(rgh, 0, 1) * 255)[..., None], 3, 2)[::2, ::2], 'ext_tile_rough.jpg', 85)
    return float(np.mean(srgb2lin(np.clip(alb, 0, 255))))


def make_asphalt(r):
    n = 1024                                             # 1 枚 = 4m(3.9mm/px)
    f = tile_fbm(n, 256, 5, r=r)
    g1 = tile_noise(n, 2, r); g2 = tile_noise(n, 3, r); g3 = tile_noise(n, 5, r)
    stones = smooth(0.62, 0.80, g2 * 0.6 + g3 * 0.4)     # 骨材(6〜13mm の粒)
    sand = smooth(0.55, 0.9, g1)
    lin = 0.022 + 0.010 * (f - 0.5) + 0.050 * stones + 0.012 * sand
    lin = lin * (0.86 + 0.28 * tile_fbm(n, 64, 3, r=r))
    col = np.stack([lin * 0.98, lin * 1.0, lin * 1.04], -1)
    _jpg(lin2srgb(col) * 255, 'ext_asphalt_albedo.jpg', 84)
    h = 0.9 * stones + 0.25 * sand + 0.2 * f
    _jpg(_nrm_from_height(h, 2.2), 'ext_asphalt_normal.jpg', 84)
    film = tile_fbm(n, 192, 4, r=r)
    rgh = 0.37 + 0.14 * (smooth(0.35, 0.75, film) - 0.5) * 2 - 0.05 * stones
    rgh = np.clip(rgh, 0.14, 0.46)
    _jpg(np.repeat((rgh * 255)[..., None], 3, 2)[::2, ::2], 'ext_asphalt_rough.jpg', 85)
    return float(lin.mean()), float(rgh.mean())


def make_wet(r, site):
    """敷地の地面に重ねる濡れの膜(敷地全体に 1 枚)。"""
    fp = site['footprint']
    x0 = min(a[0] for a in fp) - 0.5; x1 = max(a[0] + a[2] for a in fp) + 0.5
    z0 = min(a[1] for a in fp) - 0.5; z1 = max(a[1] + a[3] for a in fp) + 0.5
    n = 1024
    X = x0 + (np.arange(n) + 0.5) / n * (x1 - x0)
    Z = z0 + (np.arange(n) + 0.5) / n * (z1 - z0)
    XX, ZZ = np.meshgrid(X, Z)                           # 画像の行 = z(南へ)、列 = x(東へ)
    pf = tile_fbm(n, 96, 5, r=r) * 0.7 + tile_fbm(n, 24, 3, r=r) * 0.3
    puddle = smooth(0.60, 0.63, pf)                      # 水たまり(面積の 2 割ほど)
    film = 0.55 + 0.45 * smooth(0.35, 0.6, pf)          # 水の膜の濃さ
    a = np.clip(0.07 * film + 0.32 * puddle, 0, 0.5)
    # 映り込み: 暗い空(地平線近くの曇り空 × 斜めから見たフレネル)＋灯りの映り込み
    sky = np.array([0.0024, 0.0028, 0.0036])            # 地平線近くの曇り空(0.004)× 目の高さから見たフレネル(0.4〜0.6)
    C = (0.3 * film + 0.8 * puddle)[..., None] * sky[None, None, :]
    lamps = [((x, z + 0.5), 1.0, 2.2, np.array([1.0, 0.78, 0.52])) for (x, z) in site['poles']]
    lamps += [((17.6 - 1.0, 29.6), 0.45, 1.8, np.array([1.0, 0.82, 0.6])), ((17.6 + 1.0, 29.6), 0.45, 1.8, np.array([1.0, 0.82, 0.6]))]
    for (lx, lz), amp, R, c in lamps:
        d2 = (XX - lx) ** 2 + (ZZ - lz) ** 2
        g = amp * (0.75 * np.exp(-d2 / (R * R)) + 0.25 * np.exp(-d2 / (0.45 * R) ** 2))
        C += (g * (0.014 * film + 0.06 * puddle))[..., None] * c[None, None, :]
    rgb = C / (WET_S * np.maximum(a, 0.02))[..., None]
    rgba = np.zeros((n, n, 4), np.float32)
    rgba[..., :3] = lin2srgb(rgb) * 255
    rgba[..., 3] = a * 255
    _save_atomic(Image.fromarray(np.clip(rgba + 0.5, 0, 255).astype(np.uint8), 'RGBA'), 'ext_wet.webp', quality=90, method=6)
    return dict(wetBox=[round(x0, 3), round(z0, 3), round(x1, 3), round(z1, 3)], wetS=WET_S)


def make_partition(r):
    n = 512                                              # 1 枚 = 1.2m
    f = tile_fbm(n, 128, 5, r=r); s = tile_noise(n, 2, r)
    yy = np.mgrid[0:n, 0:n][0].astype(np.float32) / n * 1.2   # 画像の上 = 上端
    base = np.array([168.0, 168.0, 163.0])
    alb = base[None, None, :] * (1.0 + 0.05 * (f[..., None] - 0.5) + 0.025 * (s[..., None] - 0.5))
    dirt = 0.16 * np.exp(-(1.2 - yy) / 0.12) + 0.05 * tile_fbm(n, 32, 3, r=r)  # 下端の汚れ・薄いむら
    alb = alb * (1 - dirt[..., None])
    _jpg(alb, 'ext_partition_albedo.jpg', 85)
    _jpg(_nrm_from_height(0.6 * f + 0.15 * s, 1.0), 'ext_partition_normal.jpg', 85)


def make_glass_sheen(r):
    n = 256
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32) / n
    f = tile_fbm(n, 64, 4, r=r)
    band = np.exp(-(((xx * 0.8 + (1 - yy) * 0.55) % 1.0 - 0.45) / 0.16) ** 2)   # 斜めの映り込みの帯
    a = 0.10 + 0.04 * (1 - yy) + 0.05 * band + 0.02 * (f - 0.5)      # ガラスの反射率(斜めから 1 割前後)= 奥(カーテン・闇)を消す割合
    C = (0.0007 + 0.0005 * (1 - yy) + 0.0009 * band + 0.0002 * (f - 0.5))[..., None] * np.array([0.82, 0.92, 1.08])[None, None, :]
    rgb = C / (GLASS_S * a)[..., None]
    rgba = np.zeros((n, n, 4), np.float32)
    rgba[..., :3] = lin2srgb(rgb) * 255
    rgba[..., 3] = np.clip(a, 0, 1) * 255
    _save_atomic(Image.fromarray(np.clip(rgba + 0.5, 0, 255).astype(np.uint8), 'RGBA'), 'ext_glass_sheen.webp', quality=92, method=6)


F2_FILES = ('ext_tile_albedo.jpg', 'ext_tile_normal.jpg', 'ext_tile_rough.jpg', 'ext_asphalt_albedo.jpg', 'ext_asphalt_normal.jpg',
            'ext_asphalt_rough.jpg', 'ext_wet.webp', 'ext_partition_albedo.jpg', 'ext_partition_normal.jpg', 'ext_glass_sheen.webp')


def make_f2():
    r = np.random.default_rng(20261104)                  # 既存のテクスチャの乱数列とは別(既存の出力は変えない)
    site = json.load(open(os.path.join(ROOT, 'data', 'building.json')))['site']
    tile_mean = make_tile_wall(r)
    asph = make_asphalt(r)
    meta = make_wet(r, site)
    make_partition(r)
    make_glass_sheen(r)
    meta.update(tileSize=[TILE_W, TILE_H], glassS=GLASS_S)
    print(f'F2: tile albedo lin mean {tile_mean:.3f} / asphalt albedo lin mean {asph[0]:.3f} rough {asph[1]:.2f}')
    return meta


if __name__ == '__main__':
    import sys
    os.makedirs(OUT, exist_ok=True)
    if '--f2' in sys.argv:                                # P6b-F2 の新しいテクスチャだけ(既存の ext_* は書き直さない)
        meta = json.load(open(os.path.join(OUT, 'ext_textures.json')))
        meta.update(make_f2())
        with open(os.path.join(OUT, 'ext_textures.json.tmp'), 'w') as fp:
            json.dump(meta, fp, indent=1)
        os.replace(os.path.join(OUT, 'ext_textures.json.tmp'), os.path.join(OUT, 'ext_textures.json'))
        for nm in F2_FILES:
            print(nm, os.path.getsize(os.path.join(OUT, nm)) // 1024, 'KB')
        sys.exit(0)
    make_sky()
    make_trees()
    hr = make_city()
    make_ground()
    make_pavers()
    make_fence()
    meta = dict(skyK=SKY_K, moonAzDeg=math.degrees(MOON_AZ), moonElDeg=math.degrees(MOON_EL),
                cityAzDeg=[math.degrees(CITY_AZ[0]), math.degrees(CITY_AZ[1])], cityHorizonRow=hr, cityRows=256,
                treeVariants=4)
    meta.update(make_f2())                               # P6b-F2
    with open(os.path.join(OUT, 'ext_textures.json'), 'w') as fp:
        json.dump(meta, fp, indent=1)
    for nm in ('ext_sky.webp', 'ext_trees.webp', 'ext_city.webp', 'ext_ground.jpg', 'ext_grass.jpg', 'ext_pavers.jpg', 'ext_fence.png') + F2_FILES:
        print(nm, os.path.getsize(os.path.join(OUT, nm)) // 1024, 'KB')
