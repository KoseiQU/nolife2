# room_textures.py — P3b: 居室の内装・バルコニーの実行時テクスチャ(すべて自作。numpy/PIL で描く)。make_textures.py から呼ぶ。
#   flooring_{albedo,normal,roughness}.jpg … 洋室のフローリング(明るい木目の板。1.2m 角でタイル可能)
#   room_palette.png / .json             … 布・樹脂・紙などの色見本 8×8(1マス 64px、わずかな織り目/ムラ)。家具・小物の面はこの1枚の色を UV で選ぶ
#   room_appliances.png / .json          … 家電と設備の正面(洗濯機・冷蔵庫・電子レンジ・エアコン・室外機・排水口・スイッチ・インターホン・
#                                          分電盤・洗面台・シューズケース・浴室の折戸・ロッカー・モニター・ノートPC・時計・キーボックス)
#   room_prints.png / .json              … 架空のポスター 6 種(図柄のみ・文字なし)・掲示板・本の背・書類・カレンダー・監視モニター・段ボール
#   実在の製品・ブランド・ロゴ・文字は描かない。JSON の UV は Blender の規約(左下原点)。
import json, math, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

PAL = {
    # interior_layout.js の PALETTE と同じキー(カーテン・寝具・ラグ・洗濯物)
    'beige': '#c7b597', 'navy': '#2c3850', 'gray': '#6c7075', 'olive': '#5b6847', 'wine': '#6a2d34', 'lightblue': '#8aaec6',
    'white': '#e6e2da', 'brown': '#8f6845', 'teal': '#38574f', 'oldgray': '#8d8a80', 'blue': '#6b7d97', 'sage': '#a4ae9b',
    'terracotta': '#ad6656', 'charcoal': '#3a3e48', 'lavender': '#887aa0', 'rust': '#80473a', 'green': '#405848',
    # 家具・小物
    'appliance': '#e2e0da', 'black': '#121214', 'darkgray': '#2b2c2f', 'midgray': '#77787b', 'lightgray': '#b9bbbd',
    'cardboard': '#a27d55', 'tape': '#c4ae84', 'mattress': '#d3cdbf', 'trashbag': '#c1c5c7', 'wooddark': '#4b3626',
    'woodlight': '#b59772', 'ceramic': '#e7e4dc', 'vaseblue': '#3a5a76', 'can': '#a7aaae', 'canred': '#93302b',
    'plant': '#3c5a30', 'pot': '#86573a', 'paper': '#ebe8df', 'book1': '#7a2f2a', 'book2': '#2f4a6a', 'book3': '#c7a24a',
    'book4': '#3d5b46', 'yellow': '#c4a33e', 'red': '#962d2a', 'sofa': '#463c35', 'steel': '#8a8e93', 'locker': '#9aa1a4',
    'officedesk': '#b7b4ab', 'chair': '#2e3033', 'orange': '#c06a2c', 'cream': '#d9cfb8', 'denim': '#3d5270', 'pink': '#b98a90',
    'khaki': '#9b9070', 'partition': '#c9cbc8', 'frost': '#c4d0d2', 'railwhite': '#cfd0cd', 'counter': '#9fa3a6', 'tray': '#7d5a3a',
}
FABRIC = {'beige', 'navy', 'gray', 'olive', 'wine', 'lightblue', 'white', 'brown', 'teal', 'oldgray', 'blue', 'sage', 'terracotta',
          'charcoal', 'lavender', 'rust', 'green', 'mattress', 'sofa', 'cream', 'denim', 'pink', 'khaki'}


def hex2rgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)], np.float32)


def run(save, n2tex, normal_from_height, OUT):
    _rail_bars(save)
    _flooring(save, n2tex, normal_from_height)
    _palette(save, n2tex, OUT)
    _appliances(save, OUT)
    _prints(save, OUT)


# ---------------------------------------------------------------- フローリング
def _flooring(save, n2tex, normal_from_height):
    N = 1024                           # 1.2m 角
    m = N / 1.2
    rng = np.random.default_rng(31)
    alb = np.zeros((N, N, 3), np.float32)
    hgt = np.ones((N, N), np.float32)
    rgh = np.zeros((N, N), np.float32)
    plank_w = int(round(0.15 * m))     # 8 枚
    base = hex2rgb('#a98663')
    grain = n2tex._noise_aniso(N, N, 160, 6, 7)          # 板の流れ(横)に沿った筋
    fine = n2tex._noise_aniso(N, N, 640, 24, 9)
    blot = n2tex._noise(N, N, 11, ((6, 1.0), (24, 0.4)))
    for r in range(N // plank_w):
        y0, y1 = r * plank_w, (r + 1) * plank_w
        x = -int(rng.random() * 0.6 * m)
        while x < N:
            L = int((0.55 + rng.random() * 0.65) * m)
            xa, xb = max(0, x), min(N, x + L)
            tint = base * (0.86 + 0.22 * rng.random()) * np.array([1.0, 0.98 + 0.03 * rng.random(), 0.95 + 0.06 * rng.random()], np.float32)
            g = grain[y0:y1, xa:xb] * 0.6 + fine[y0:y1, xa:xb] * 0.4
            alb[y0:y1, xa:xb] = tint * (0.82 + 0.3 * g[..., None]) * (0.94 + 0.12 * blot[y0:y1, xa:xb, None])
            rgh[y0:y1, xa:xb] = 0.42 + 0.12 * rng.random() + 0.1 * g
            if 0 < x < N:
                hgt[y0:y1, max(0, x - 1):min(N, x + 2)] = 0.0       # 端の継ぎ目
            x += L
        hgt[y0:y0 + 2, :] = 0.0                                       # 板の長辺の継ぎ目
    seam = hgt < 0.5
    alb[seam] *= 0.55
    rgh[seam] = 0.75
    save('flooring_albedo.jpg', np.clip(alb, 0, 1), q=88)
    h = np.asarray(Image.fromarray((hgt * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0)), np.float32) / 255.0
    nm = Image.fromarray((np.clip(normal_from_height(h, 4.0), 0, 1) * 255 + 0.5).astype(np.uint8))
    save('flooring_normal.jpg', nm, q=90)
    save('flooring_roughness.jpg', np.repeat(np.clip(rgh, 0, 1)[..., None], 3, 2), size=512)


# ---------------------------------------------------------------- 色見本
def _palette(save, n2tex, OUT):
    S, C = 256, 32
    im = np.zeros((S, S, 3), np.float32)
    uv = {}
    weave = n2tex._noise(C, C, 3, ((8, 1.0), (32, 0.6)))
    yy, xx = np.mgrid[0:C, 0:C]
    cross = (0.5 + 0.5 * np.sin(xx * math.pi / 2) * np.sin(yy * math.pi / 2)).astype(np.float32)
    keys = list(PAL.keys())
    assert len(keys) <= 64, len(keys)
    for i, k in enumerate(keys):
        cx, cy = (i % 8) * C, (i // 8) * C
        col = hex2rgb(PAL[k])
        if k in FABRIC:
            v = 0.9 + 0.08 * weave + 0.05 * cross
        else:
            v = 0.95 + 0.05 * weave
        im[cy:cy + C, cx:cx + C] = col * v[..., None]
        uv[k] = [(cx + 5) / S, 1 - (cy + C - 5) / S, (cx + C - 5) / S, 1 - (cy + 5) / S]
    save('room_palette.png', np.clip(im, 0, 1))
    with open(os.path.join(OUT, 'room_palette.json'), 'w') as fp:
        json.dump(uv, fp)


# ---------------------------------------------------------------- 家電・設備の正面
APPL = {   # key: (x, y, w, h) 画像座標(左上原点)
    'washer': (0, 0, 256, 320), 'fridge': (256, 0, 224, 448), 'micro': (480, 0, 288, 176), 'acout': (480, 176, 352, 256),
    'drain': (832, 176, 128, 128), 'switch': (960, 176, 64, 128), 'acin': (0, 448, 512, 128), 'vanity': (0, 576, 256, 224),
    'shoecase': (256, 576, 256, 224), 'bathdoor': (512, 432, 192, 512), 'breaker': (704, 432, 160, 224), 'intercom': (864, 432, 128, 192),
    'locker': (704, 656, 160, 368), 'monitor': (0, 800, 256, 160), 'laptop': (256, 800, 256, 160), 'clock': (864, 624, 160, 160),
    'keybox': (864, 784, 160, 224),
}


def _uvjson(table, W, H, OUT, name):
    uv = {k: [x / W, 1 - (y + h) / H, (x + w) / W, 1 - y / H] for k, (x, y, w, h) in table.items()}
    with open(os.path.join(OUT, name), 'w') as fp:
        json.dump(uv, fp)


def _appliances(save, OUT):
    W = H = 1024
    im = Image.new('RGB', (W, H), (200, 200, 198))
    d = ImageDraw.Draw(im)
    def R(k): return APPL[k]
    def panel(k, fill, edge=None):
        x, y, w, h = R(k)
        d.rectangle([x, y, x + w - 1, y + h - 1], fill=fill)
        if edge: d.rectangle([x + 2, y + 2, x + w - 3, y + h - 3], outline=edge, width=3)
        return x, y, w, h
    # 洗濯機: 白い前面・丸い扉(暗い窓と灰の縁)・上の操作帯とつまみ
    x, y, w, h = panel('washer', (226, 225, 220), (190, 190, 186))
    d.rectangle([x + 10, y + 12, x + w - 10, y + 58], fill=(205, 206, 204))
    d.ellipse([x + w - 70, y + 18, x + w - 30, y + 54], fill=(170, 172, 174), outline=(120, 122, 124), width=3)
    for i in range(4): d.rectangle([x + 22 + i * 26, y + 30, x + 38 + i * 26, y + 40], fill=(110, 140, 170) if i == 1 else (150, 152, 154))
    cx, cy, r = x + w // 2, y + 190, 92
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(150, 152, 155), outline=(110, 112, 115), width=4)
    d.ellipse([cx - r + 18, cy - r + 18, cx + r - 18, cy + r - 18], fill=(28, 32, 38))
    d.ellipse([cx - r + 30, cy - r + 26, cx - 10, cy - 20], fill=(52, 58, 66))
    # 冷蔵庫: 上が冷凍室(扉の分かれ目)・縦の取っ手の溝
    x, y, w, h = panel('fridge', (228, 227, 222), (196, 196, 192))
    sy = y + int(h * 0.36)
    d.line([x + 4, sy, x + w - 4, sy], fill=(150, 150, 148), width=4)
    d.rectangle([x + w - 26, y + 30, x + w - 18, sy - 20], fill=(178, 178, 175))
    d.rectangle([x + w - 26, sy + 20, x + w - 18, sy + 150], fill=(178, 178, 175))
    # 電子レンジ: 暗い窓・右の操作部
    x, y, w, h = panel('micro', (214, 213, 208), (170, 170, 166))
    d.rectangle([x + 14, y + 16, x + int(w * 0.66), y + h - 16], fill=(22, 24, 26), outline=(120, 120, 118), width=4)
    for i in range(5): d.rectangle([x + int(w * 0.74), y + 26 + i * 26, x + w - 18, y + 40 + i * 26], fill=(150, 152, 152))
    # 室外機: 灰の箱・左に丸いファン(同心円と羽根)・右に格子
    x, y, w, h = panel('acout', (176, 178, 174), (140, 142, 140))
    cx, cy, r = x + 130, y + h // 2, 108
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(46, 48, 50))
    for rr in range(r, 10, -14): d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=(132, 134, 132), width=3)
    for a in range(0, 360, 30):
        d.line([cx, cy, cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a))], fill=(120, 122, 120), width=3)
    for i in range(14): d.line([x + 262, y + 20 + i * 16, x + w - 20, y + 20 + i * 16], fill=(140, 142, 140), width=4)
    # 排水口の格子
    x, y, w, h = panel('drain', (40, 41, 42))
    for i in range(8): d.rectangle([x + 10, y + 12 + i * 14, x + w - 10, y + 18 + i * 14], fill=(80, 82, 82))
    # スイッチ
    x, y, w, h = panel('switch', (232, 230, 224), (200, 198, 192))
    d.rectangle([x + 14, y + 22, x + w - 14, y + 60], fill=(244, 242, 236), outline=(190, 188, 182), width=2)
    d.rectangle([x + 14, y + 68, x + w - 14, y + 106], fill=(244, 242, 236), outline=(190, 188, 182), width=2)
    # エアコン(室内機): 白い本体・下の吹出口・小さな表示灯
    x, y, w, h = panel('acin', (232, 231, 226), (205, 204, 200))
    d.rectangle([x + 10, y + h - 40, x + w - 10, y + h - 12], fill=(60, 62, 64))
    for i in range(18): d.line([x + 14 + i * 27, y + h - 38, x + 14 + i * 27, y + h - 14], fill=(100, 102, 104), width=2)
    d.ellipse([x + w - 60, y + 30, x + w - 52, y + 38], fill=(80, 170, 110))
    # 洗面台の下の扉
    x, y, w, h = panel('vanity', (228, 226, 220), (190, 188, 182))
    d.line([x + w // 2, y + 8, x + w // 2, y + h - 8], fill=(170, 168, 162), width=3)
    for hx in (x + w // 2 - 22, x + w // 2 + 14): d.rectangle([hx, y + 30, hx + 8, y + 80], fill=(150, 150, 148))
    # シューズケース(明るい木目調の扉2枚)
    x, y, w, h = panel('shoecase', (176, 150, 116), (140, 116, 88))
    d.line([x + w // 2, y + 6, x + w // 2, y + h - 6], fill=(120, 98, 72), width=3)
    for i in range(0, w, 7): d.line([x + i, y, x + i + 3, y + h], fill=(168, 142, 108), width=1)
    for hx in (x + w // 2 - 18, x + w // 2 + 10): d.rectangle([hx, y + 20, hx + 8, y + 60], fill=(90, 86, 80))
    # 浴室の折戸(白い枠・縦長の乳白パネル2枚)
    x, y, w, h = panel('bathdoor', (232, 232, 228), (200, 200, 196))
    for px in (x + 18, x + w // 2 + 8):
        d.rectangle([px, y + 24, px + w // 2 - 26, y + h - 60], fill=(206, 212, 214), outline=(186, 188, 186), width=3)
    d.line([x + w // 2, y + 4, x + w // 2, y + h - 4], fill=(170, 170, 168), width=4)
    # 分電盤
    x, y, w, h = panel('breaker', (222, 220, 214), (180, 178, 172))
    d.rectangle([x + 16, y + 20, x + w - 16, y + h - 30], outline=(170, 168, 162), width=3)
    d.rectangle([x + w // 2 - 20, y + h - 26, x + w // 2 + 20, y + h - 18], fill=(150, 150, 146))
    # インターホン(室内の親機)
    x, y, w, h = panel('intercom', (236, 234, 228), (200, 198, 192))
    d.rectangle([x + 16, y + 20, x + w - 16, y + 92], fill=(28, 30, 34))
    for i in range(3): d.ellipse([x + 22 + i * 30, y + 112, x + 42 + i * 30, y + 132], fill=(190, 188, 182))
    for i in range(5): d.line([x + 30, y + 152 + i * 6, x + w - 30, y + 152 + i * 6], fill=(170, 168, 162), width=2)
    # ロッカー(縦長・スチール・上下の通気スリット・取っ手)
    x, y, w, h = panel('locker', (152, 160, 164), (118, 124, 128))
    for i in range(6): d.rectangle([x + 40, y + 28 + i * 12, x + w - 40, y + 34 + i * 12], fill=(40, 42, 44))
    for i in range(6): d.rectangle([x + 40, y + h - 100 + i * 12, x + w - 40, y + h - 94 + i * 12], fill=(40, 42, 44))
    d.rectangle([x + w - 34, y + h // 2 - 30, x + w - 24, y + h // 2 + 30], fill=(70, 72, 74))
    # モニター(消えた画面)・ノートPC(キーボード面)
    x, y, w, h = panel('monitor', (14, 15, 17), (36, 36, 38))
    d.rectangle([x + 10, y + 10, x + w - 10, y + h - 10], fill=(8, 9, 11))
    x, y, w, h = panel('laptop', (58, 60, 64))
    for r_ in range(5):
        for c_ in range(12): d.rectangle([x + 14 + c_ * 19, y + 16 + r_ * 20, x + 28 + c_ * 19, y + 30 + r_ * 20], fill=(28, 29, 31))
    d.rectangle([x + 90, y + 122, x + 166, y + 150], fill=(70, 72, 76))
    # 時計(白い文字盤・目盛り・針)
    x, y, w, h = panel('clock', (40, 40, 42))
    cx, cy, r = x + w // 2, y + h // 2, 74
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(232, 230, 222), outline=(70, 70, 72), width=5)
    for a in range(0, 360, 30):
        ca, sa = math.cos(math.radians(a)), math.sin(math.radians(a))
        d.line([cx + ca * (r - 14), cy + sa * (r - 14), cx + ca * (r - 4), cy + sa * (r - 4)], fill=(40, 40, 42), width=4)
    d.line([cx, cy, cx + 30, cy - 34], fill=(30, 30, 32), width=6)        # 3時ごろ…(深夜 3 時の手前)
    d.line([cx, cy, cx + 2, cy - 60], fill=(30, 30, 32), width=4)
    # キーボックス(鍵の掛かったフック列)
    x, y, w, h = panel('keybox', (120, 124, 126), (90, 92, 94))
    for r_ in range(5):
        for c_ in range(4):
            kx, ky = x + 26 + c_ * 32, y + 30 + r_ * 38
            d.ellipse([kx - 4, ky - 4, kx + 4, ky + 4], fill=(60, 60, 60))
            if (r_ * 4 + c_) % 3: d.rectangle([kx - 3, ky + 4, kx + 3, ky + 24], fill=(170, 150, 90))
    save('room_appliances.png', im.filter(ImageFilter.SMOOTH))
    _uvjson(APPL, W, H, OUT, 'room_appliances.json')


# ---------------------------------------------------------------- 架空のポスター・紙もの
PRINTS = {
    'p1': (0, 0, 256, 352), 'p2': (256, 0, 256, 352), 'p3': (512, 0, 256, 352), 'p4': (768, 0, 256, 352),
    'p5': (0, 352, 256, 352), 'p6': (256, 352, 256, 352), 'notice': (512, 352, 512, 288), 'spines': (0, 704, 512, 128),
    'papers': (512, 640, 256, 192), 'calendar': (768, 640, 256, 192), 'secmon': (512, 832, 256, 192), 'tvoff': (768, 832, 256, 192),
    'boxside': (0, 832, 512, 192),
}


def _prints(save, OUT):
    W = H = 1024
    im = Image.new('RGB', (W, H), (40, 40, 40))
    d = ImageDraw.Draw(im)
    rng = np.random.default_rng(77)
    def R(k): return PRINTS[k]
    # ポスター(抽象の図柄のみ。文字・ロゴ・実在の作品は描かない)
    x, y, w, h = R('p1'); d.rectangle([x, y, x + w - 1, y + h - 1], fill=(222, 214, 196))
    for i in range(7): d.ellipse([x + 40 + i * 12, y + 60 + i * 20, x + 216 - i * 12, y + 236 - i * 4], outline=(60 + i * 20, 80, 120 - i * 8), width=6)
    x, y, w, h = R('p2'); d.rectangle([x, y, x + w - 1, y + h - 1], fill=(28, 34, 48))
    for i in range(9): d.rectangle([x + 20, y + 30 + i * 32, x + 30 + int(rng.random() * 200), y + 44 + i * 32], fill=(200, 120 + i * 10, 60))
    x, y, w, h = R('p3'); d.rectangle([x, y, x + w - 1, y + h - 1], fill=(186, 60, 48))
    d.polygon([(x + 30, y + h - 40), (x + w // 2, y + 50), (x + w - 30, y + h - 40)], fill=(236, 226, 200))
    d.ellipse([x + w // 2 - 30, y + 150, x + w // 2 + 30, y + 210], fill=(30, 30, 34))
    x, y, w, h = R('p4'); d.rectangle([x, y, x + w - 1, y + h - 1], fill=(206, 214, 200))
    for i in range(12):
        c = (int(rng.random() * 120 + 60), int(rng.random() * 100 + 80), int(rng.random() * 120 + 60))
        rx, ry = x + int(rng.random() * 200), y + int(rng.random() * 300)
        d.rectangle([rx, ry, rx + 40, ry + 40], fill=c)
    x, y, w, h = R('p5'); d.rectangle([x, y, x + w - 1, y + h - 1], fill=(14, 16, 22))
    for i in range(160):
        sx, sy = x + int(rng.random() * w), y + int(rng.random() * h * 0.7)
        d.point((sx, sy), fill=(220, 220, 230))
    d.rectangle([x, y + int(h * 0.72), x + w - 1, y + h - 1], fill=(40, 52, 40))
    d.ellipse([x + 150, y + 40, x + 210, y + 100], fill=(230, 226, 200))
    x, y, w, h = R('p6'); d.rectangle([x, y, x + w - 1, y + h - 1], fill=(236, 200, 70))
    for i in range(6): d.line([x, y + 40 + i * 50, x + w, y + 10 + i * 50], fill=(30, 30, 30), width=12)
    # 掲示板(コルク地に色の違う紙が数枚＋画鋲。文字は罫線の灰色の線だけ)
    x, y, w, h = R('notice'); d.rectangle([x, y, x + w - 1, y + h - 1], fill=(150, 112, 74))
    d.rectangle([x, y, x + w - 1, y + h - 1], outline=(90, 70, 50), width=10)
    for (px, py, pw, ph, c) in ((30, 30, 140, 180, (236, 234, 226)), (190, 40, 120, 150, (232, 222, 170)), (330, 26, 150, 110, (210, 226, 236)), (330, 150, 140, 110, (236, 234, 226))):
        d.rectangle([x + px, y + py, x + px + pw, y + py + ph], fill=c)
        for j in range(4, ph // 14): d.line([x + px + 12, y + py + j * 14, x + px + pw - 14 - (j % 3) * 18, y + py + j * 14], fill=(150, 150, 150), width=2)
        d.ellipse([x + px + pw // 2 - 5, y + py + 4, x + px + pw // 2 + 5, y + py + 14], fill=(180, 40, 40))
    # 本の背(色の帯と細い線。文字なし)
    x, y, w, h = R('spines')
    cx = x
    while cx < x + w:
        bw = int(10 + rng.random() * 22)
        c = tuple(int(v) for v in (rng.random() * 150 + 40, rng.random() * 130 + 40, rng.random() * 130 + 40))
        d.rectangle([cx, y, cx + bw, y + h - 1], fill=c)
        d.line([cx + 2, y + 20, cx + bw - 2, y + 20], fill=tuple(min(255, v + 60) for v in c), width=2)
        d.line([cx + 2, y + h - 24, cx + bw - 2, y + h - 24], fill=tuple(min(255, v + 60) for v in c), width=2)
        cx += bw + 1
    # 書類(白い紙に灰色の行)
    x, y, w, h = R('papers'); d.rectangle([x, y, x + w - 1, y + h - 1], fill=(236, 234, 226))
    for j in range(2, 12): d.line([x + 18, y + j * 15, x + w - 20 - (j % 4) * 22, y + j * 15], fill=(150, 150, 150), width=3)
    # カレンダー(月の表の格子。数字の代わりに点)
    x, y, w, h = R('calendar'); d.rectangle([x, y, x + w - 1, y + h - 1], fill=(240, 238, 232))
    d.rectangle([x, y, x + w - 1, y + 36], fill=(60, 90, 120))
    for r_ in range(5):
        for c_ in range(7):
            d.rectangle([x + 10 + c_ * 34, y + 46 + r_ * 28, x + 40 + c_ * 34, y + 70 + r_ * 28], outline=(200, 198, 192), width=1)
            d.ellipse([x + 16 + c_ * 34, y + 50 + r_ * 28, x + 22 + c_ * 34, y + 56 + r_ * 28], fill=(170, 60, 60) if c_ == 0 else (110, 110, 110))
    # 監視モニター(廊下の映像のような暗い灰色の4分割)
    x, y, w, h = R('secmon'); d.rectangle([x, y, x + w - 1, y + h - 1], fill=(10, 12, 12))
    for qx in (0, 1):
        for qy in (0, 1):
            ax, ay = x + 8 + qx * 122, y + 8 + qy * 90
            d.rectangle([ax, ay, ax + 116, ay + 84], fill=(40, 46, 44))
            d.polygon([(ax + 20, ay + 84), (ax + 50, ay + 30), (ax + 66, ay + 30), (ax + 96, ay + 84)], fill=(66, 74, 70))
    x, y, w, h = R('tvoff'); d.rectangle([x, y, x + w - 1, y + h - 1], fill=(6, 7, 8))
    # 段ボール(クラフト色・ガムテープ)
    x, y, w, h = R('boxside'); d.rectangle([x, y, x + w - 1, y + h - 1], fill=(164, 126, 86))
    for i in range(0, w, 6): d.line([x + i, y, x + i, y + h], fill=(156, 120, 82), width=1)
    d.rectangle([x, y, x + w - 1, y + 26], fill=(196, 176, 132))
    save('room_prints.png', im)
    _uvjson(PRINTS, W, H, OUT, 'room_prints.json')


# ---------------------------------------------------------------- バルコニーの格子(上層): 1.1m に 10 本の縦桟。アルファ付き(実行時はアルファテスト)
def _rail_bars(save):
    W, H = 256, 16
    im = np.zeros((H, W, 4), np.float32)
    for i in range(10):
        cx = (i + 0.5) * W / 10
        for x in range(W):
            d = abs(x + 0.5 - cx)
            if d <= 2.6:
                shade = 0.62 + 0.3 * (1 - d / 2.6)
                im[:, x, :3] = shade
                im[:, x, 3] = 1.0
    save('rail_bars.png', Image.fromarray((np.clip(im, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA'))
