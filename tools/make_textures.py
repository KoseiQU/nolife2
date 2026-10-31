# make_textures.py — P3a: 実行時に使うテクスチャ一式を build/tex/ に作る(システムの python3 + PIL + numpy)。
#   1) CC0 の実写スキャン(assets/textures/*、2048px)を実行時サイズへ縮小して JPEG 化(GLB には埋め込まない)
#   2) 自作の手続きテクスチャ(tools/blender/n2tex.py の numpy 描画＋ここで描くもの)を PNG/JPEG で保存
#   3) 号室プレートのアトラス(全 104 室)と UV 表 room_plates.json
# 実行: python3 -I tools/make_textures.py   (何度実行しても同じ結果。既存ファイルは上書き)
# 文字は Blender 同梱の Inter(SIL OFL 1.1)で描く。
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'blender'))
import n2tex  # noqa: E402  (bpy を使わない numpy 関数だけを呼ぶ)

OUT = os.path.join(ROOT, 'build', 'tex')
SRC = os.path.join(ROOT, 'assets', 'textures')
FONT = '/Applications/Blender.app/Contents/Resources/5.2/datafiles/fonts/Inter.woff2'
os.makedirs(OUT, exist_ok=True)
made = []


def save(name, arr_or_img, q=86, size=None):
    im = arr_or_img if isinstance(arr_or_img, Image.Image) else Image.fromarray((np.clip(arr_or_img, 0, 1) * 255 + 0.5).astype(np.uint8))
    if size and im.size != (size, size) and im.size[0] == im.size[1]:
        im = im.resize((size, size), Image.LANCZOS)
    path = os.path.join(OUT, name)
    if name.endswith('.jpg'):
        im.convert('RGB').save(path, quality=q, subsampling=0 if q >= 90 else 2, optimize=True)
    else:
        im.save(path, optimize=True)
    made.append((name, im.size, os.path.getsize(path)))


def src(dirname, f, size, q=86):
    im = Image.open(os.path.join(SRC, dirname, f)).convert('RGB')
    return im.resize((size, size), Image.LANCZOS)


def normal_from_height(h, k):
    gy, gx = np.gradient(h.astype(np.float32))
    nx, ny, nz = -gx * k, gy * k, np.ones_like(h, np.float32)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / l * 0.5 + 0.5, ny / l * 0.5 + 0.5, nz / l * 0.5 + 0.5], axis=2)


def noise(n, cells_amp, seed):
    return n2tex._noise(n, n, seed, cells_amp)


# ---------------------------------------------------------------- 1) CC0 スキャンの縮小
for d, maps in (('wall_cloth', ('albedo', 'normal', 'roughness')), ('ceiling_tile', ('albedo', 'normal', 'roughness')),
                ('door_wood', ('albedo', 'normal', 'roughness'))):
    for m in maps:
        size = 512 if m == 'roughness' else 1024
        save(f'{d}_{m}.jpg', src(d, m + '.jpg', size), q=90 if m == 'normal' else 85)

# ---------------------------------------------------------------- 2) 自作(既存 n2tex)
alb, nrm, rgh = n2tex.floor_sheet()
save('floor_sheet_albedo.jpg', alb, q=88)
save('floor_sheet_normal.jpg', nrm, q=90)
save('floor_sheet_roughness.jpg', np.repeat(rgh[..., None], 3, 2), size=512)
save('wire_glass.png', n2tex.wire_glass())
save('ev_plate.png', n2tex.ev_plate())
save('car_stone.jpg', n2tex.car_stone(), q=88)
save('exit_sign_sq.png', n2tex.exit_sign_square())


SEGS = {1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'bcfg', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg'}
LED = (0.62, 0.86, 1.0)


def _arrow(img, ax, ay, s, up, color, r=1.5):
    """細い線の矢印(▲/▼ の向き)。s=半分の長さ"""
    yy, xx = n2tex._grid(*img.shape[:2])
    d = 1 if up else -1
    m = n2tex._seg(xx, yy, ax, ay - s * d, ax, ay + s * d, r)
    m |= n2tex._seg(xx, yy, ax, ay - s * d, ax - s * 0.66, ay - s * d * 0.33, r)
    m |= n2tex._seg(xx, yy, ax, ay - s * d, ax + s * 0.66, ay - s * d * 0.33, r)
    img[m] = color


def ev_display_atlas():
    """P3b-A: 呼びパネルの階数表示(青白LED)。8列(1..8階)×3段(矢印なし/▲/▼)のアトラス(1マス 96×234)。
    実行時に elevator.js がテクスチャの offset/repeat をカゴの現在地へずらす(全階の表示が同じ1枚を見る)。"""
    rows = []
    for arrow in (0, 1, 2):
        cells = []
        for n in range(1, 9):
            img = np.zeros((234, 96, 3), np.float32); img[:] = (0.012, 0.012, 0.016)
            if arrow == 1: _arrow(img, 48, 234 * 0.18, 9, True, LED)
            if arrow == 2: _arrow(img, 48, 234 * 0.55, 9, False, LED)
            n2tex.seven_seg(img, 48 - 0.55 * 34 / 2, 234 * 0.27, 34, LED, SEGS[n])
            cells.append(img)
        rows.append(np.concatenate(cells, axis=1))
    return np.concatenate(rows, axis=0)


def ev_car_display_atlas():
    """P3b-A: カゴの操作盤の階数表示(盤の上の黒い窓 176×80 に重ねる面)。8列×3段(矢印なし/▲/▼)、1マス 176×80。"""
    rows = []
    for arrow in (0, 1, 2):
        cells = []
        for n in range(1, 9):
            img = np.zeros((80, 176, 3), np.float32); img[:] = (0.010, 0.011, 0.014)
            if arrow: _arrow(img, 176 * 0.30, 40, 13, arrow == 1, LED, r=2.0)
            n2tex.seven_seg(img, 176 * 0.50, 40 - 22, 44, LED, SEGS[n])
            cells.append(img)
        rows.append(np.concatenate(cells, axis=1))
    return np.concatenate(rows, axis=0)


save('ev_car_display.png', ev_car_display_atlas())
save('ev_display.png', ev_display_atlas())


def ev_car_panel():
    """カゴ内の操作盤(ヘアラインSUS 256×640): 上=階数表示窓、行き先ボタン 1〜7(2列)、開・閉。座標は ev_car_panel.json。"""
    W, H = 256, 640
    rng = np.random.default_rng(5)
    streak = np.convolve(rng.random(W), np.ones(3) / 3, mode='same')[None, :]
    base = 0.52 + 0.09 * (streak - 0.5) + 0.03 * (rng.random((H, W)) - 0.5)
    im = Image.fromarray((np.clip(np.repeat(base[..., None], 3, 2) * [1, 1, 0.98], 0, 1) * 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    f = ImageFont.truetype(FONT, 30)
    d.rectangle([40, 30, 216, 110], fill=(8, 9, 12))
    btn = {}
    order = [7, 6, 5, 4, 3, 2, 1]
    for i, n in enumerate(order):
        col = 0 if i % 2 == 0 else 1
        row = i // 2
        cx, cy = (88 if col == 0 else 168), 170 + row * 74
        if n == 1:
            cx = 88
        d.ellipse([cx - 26, cy - 26, cx + 26, cy + 26], fill=(70, 70, 70))
        d.ellipse([cx - 21, cy - 21, cx + 21, cy + 21], fill=(178, 178, 175))
        d.text((cx, cy + 1), str(n), font=f, fill=(25, 25, 28), anchor='mm')
        btn[n] = (cx / W, cy / H)
    for j, (lab, cx) in enumerate((('<|>', 88), ('>|<', 168))):
        cy = 170 + 4 * 74 + 20
        d.ellipse([cx - 26, cy - 26, cx + 26, cy + 26], fill=(70, 70, 70))
        d.ellipse([cx - 21, cy - 21, cx + 21, cy + 21], fill=(178, 178, 175))
        d.text((cx, cy), lab, font=ImageFont.truetype(FONT, 18), fill=(25, 25, 28), anchor='mm')
    save('ev_car_panel.png', im)
    with open(os.path.join(OUT, 'ev_car_panel.json'), 'w') as fp:
        json.dump({'size': [W, H], 'buttons': {str(k): v for k, v in btn.items()}}, fp)


ev_car_panel()


def exit_sign_wide():
    """build_scene.py make_exit_sign_image と同じ図(避難口・横長)。"""
    W, H = 768, 256
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    img = np.zeros((H, W, 3), np.float32); img[:] = (0.02, 0.42, 0.16)
    white = (xx >= 470) & (xx <= 640) & (yy >= 30) & (yy <= 226)
    white &= ~((xx >= 486) & (xx <= 624) & (yy >= 46) & (yy <= 226))
    def seg(ax, ay, bx, by, r):
        vx, vy = bx - ax, by - ay
        t = np.clip(((xx - ax) * vx + (yy - ay) * vy) / (vx * vx + vy * vy), 0, 1)
        return (xx - (ax + t * vx)) ** 2 + (yy - (ay + t * vy)) ** 2 <= r * r
    white |= (xx - 330) ** 2 + (yy - 62) ** 2 <= 22 ** 2
    white |= seg(318, 92, 290, 160, 17) | seg(312, 105, 360, 128, 11) | seg(360, 128, 392, 104, 10)
    white |= seg(310, 105, 268, 120, 11) | seg(268, 120, 246, 146, 10) | seg(290, 160, 338, 186, 13) | seg(338, 186, 352, 230, 12)
    white |= seg(290, 160, 258, 196, 13) | seg(258, 196, 214, 206, 12)
    white |= seg(60, 200, 170, 200, 9) | seg(60, 200, 92, 176, 8) | seg(60, 200, 92, 224, 8)
    img[white] = (0.95, 0.97, 0.95)
    return img


save('exit_sign.png', exit_sign_wide())

# ---------------------------------------------------------------- 2b) 自作(P3a で追加)
def stone_tile(n=1024, tiles=2, seed=31, base=0.47, joint=0.012, contrast=1.0):
    """石目タイル(600角。1枚=1.2m=2×2枚): 灰色の雲状の濃淡・細い筋・薄い目地。写真 lobby_1F_corridor / entrance_*"""
    a = noise(n, ((4, 1.0), (12, 0.7), (40, 0.45), (160, 0.3)), seed)
    vein = n2tex._noise_aniso(n, n, 9, 5, seed + 1)
    speck = np.random.default_rng(seed + 3).random((n, n)).astype(np.float32) - 0.5
    v = base + 0.10 * contrast * (a - 0.5) - 0.035 * contrast * np.exp(-((vein - 0.5) / 0.012) ** 2) + 0.025 * speck
    rng = np.random.default_rng(seed + 2)
    per = rng.random((tiles, tiles)) * 0.06 - 0.03            # 1枚ごとのわずかな色差
    yy, xx = n2tex._grid(n, n)
    ti, tj = (yy * tiles // n).astype(int), (xx * tiles // n).astype(int)
    v = v + per[ti, tj]
    s = n / tiles
    jx = np.minimum(xx % s, s - (xx % s)); jy = np.minimum(yy % s, s - (yy % s))
    jw = joint * n / 1.2 * tiles / 2
    g = np.clip(1.0 - np.minimum(jx, jy) / max(jw, 0.5), 0, 1)
    v = v * (1 - 0.35 * g)
    alb = np.stack([v, v * 0.995, v * 0.985], 2)
    h = a * 0.4 - g * 1.0
    return alb, normal_from_height(h, 1.6)


# P3a-2(風除室の質の差し戻し): 床=明るい灰の石目(雲状の濃淡＋白い筋)＋粗さマップ(0.22〜0.42)。
# 壁=濃灰の大判タイル(細かい粒の御影石調・目地)。写真 entrance_* / lobby_1F_corridor
def stone_floor2(n=1024, tiles=2, seed=31):
    a = noise(n, ((3, 1.0), (9, 0.8), (27, 0.5), (90, 0.35), (300, 0.25)), seed)
    v1 = n2tex._noise_aniso(n, n, 7, 3, seed + 1); v2 = n2tex._noise_aniso(n, n, 3, 9, seed + 5)
    vein = np.exp(-((v1 - 0.5) / 0.010) ** 2) * 0.7 + np.exp(-((v2 - 0.47) / 0.007) ** 2) * 0.5
    speck = np.random.default_rng(seed + 3).random((n, n)).astype(np.float32) - 0.5
    v = 0.55 + 0.12 * (a - 0.5) + 0.016 * vein + 0.02 * speck
    rng = np.random.default_rng(seed + 2)
    per = rng.random((tiles, tiles)) * 0.07 - 0.035
    yy, xx = n2tex._grid(n, n)
    ti, tj = (yy * tiles // n).astype(int), (xx * tiles // n).astype(int)
    v = v + per[ti, tj]
    s_ = n / tiles
    jx = np.minimum(xx % s_, s_ - (xx % s_)); jy = np.minimum(yy % s_, s_ - (yy % s_))
    g = np.clip(1.0 - np.minimum(jx, jy) / 2.2, 0, 1)
    v = v * (1 - 0.45 * g)
    alb = np.stack([v, v * 0.993, v * 0.982], 2)
    rough = 0.30 + 0.09 * (noise(n, ((5, 1.0), (40, 0.5)), seed + 9) - 0.5) + 0.25 * g - 0.04 * vein
    h = a * 0.25 - g * 1.0
    return alb, normal_from_height(h, 1.4), np.clip(rough, 0.18, 0.6)


def stone_wall2(n=1024, tiles=2, seed=41):
    a = noise(n, ((4, 1.0), (16, 0.6), (64, 0.4)), seed)
    rng = np.random.default_rng(seed + 3)
    grain = rng.random((n, n)).astype(np.float32)
    grain = np.asarray(Image.fromarray((grain * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7)), np.float32) / 255.0
    dots = (rng.random((n, n)) > 0.985).astype(np.float32) * 0.6 - (rng.random((n, n)) > 0.99).astype(np.float32) * 0.4
    v = 0.27 + 0.04 * (a - 0.5) + 0.07 * (grain - 0.5) + 0.03 * dots
    per = rng.random((tiles, tiles)) * 0.03 - 0.015
    yy, xx = n2tex._grid(n, n)
    ti, tj = (yy * tiles // n).astype(int), (xx * tiles // n).astype(int)
    v = v + per[ti, tj]
    s_ = n / tiles
    jx = np.minimum(xx % s_, s_ - (xx % s_)); jy = np.minimum(yy % s_, s_ - (yy % s_))
    g = np.clip(1.0 - np.minimum(jx, jy) / 1.8, 0, 1)
    v = v * (1 - 0.5 * g)
    alb = np.stack([v * 0.99, v, v * 1.0], 2)
    h = grain * 0.25 + a * 0.2 - g * 1.0
    return alb, normal_from_height(h, 1.5)


alb, nrm, rgh = stone_floor2()
save('stone_floor_albedo.jpg', alb, q=88)
save('stone_floor_normal.jpg', nrm, q=88, size=512)
save('stone_floor_roughness.jpg', np.repeat(rgh[..., None], 3, 2), q=86, size=512)
alb, nrm = stone_wall2()
save('stone_wall_albedo.jpg', alb, q=86)
save('stone_wall_normal.jpg', nrm, q=88, size=512)


def hairline(n=512, seed=81):
    """ヘアラインのステンレスの粗さ(縦の細い筋。0.14〜0.36)。横に使う材質は UV を入れ替えて貼る。"""
    rng = np.random.default_rng(seed)
    cols = rng.random(n).astype(np.float32)
    cols = np.convolve(np.concatenate([cols[-3:], cols, cols[:3]]), np.ones(3) / 3, 'same')[3:-3]
    fine = rng.random(n).astype(np.float32)
    streak = 0.65 * cols[None, :] + 0.35 * fine[None, :]
    along = n2tex._noise_aniso(n, n, 4, 64, seed + 1)   # 筋に沿ったゆるい揺らぎ
    r = 0.22 + 0.10 * (streak - 0.5) + 0.05 * (along - 0.5)
    return np.repeat(np.clip(r, 0.12, 0.4)[..., None], 3, 2)


save('hairline_roughness.jpg', hairline(), q=88)


def glass_smudge(n=512, seed=91):
    """透明ガラスの粗さ(ほぼ鏡面 0.02。指紋・拭き跡のにじみ・埃)。1枚=1m。"""
    rng = np.random.default_rng(seed)
    blob = noise(n, ((3, 1.0), (7, 0.6), (18, 0.3)), seed)
    smear = np.clip((blob - 0.58) * 3.0, 0, 1) ** 1.5
    wipe = n2tex._noise_aniso(n, n, 40, 3, seed + 2)
    wipe = np.clip((wipe - 0.62) * 4.0, 0, 1) * np.clip((noise(n, ((4, 1.0),), seed + 4) - 0.45) * 3, 0, 1)
    dust = (rng.random((n, n)) > 0.997).astype(np.float32)
    prints = np.zeros((n, n), np.float32)
    yy, xx = n2tex._grid(n, n)
    for _ in range(14):      # 指紋(小さな楕円の渦)
        cx, cy, r = rng.random() * n, rng.random() * n, 7 + rng.random() * 6
        d = np.sqrt(((xx - cx) / r) ** 2 + ((yy - cy) / (r * 1.3)) ** 2)
        prints += np.clip(1 - d, 0, 1) * (0.5 + 0.5 * np.sin(d * 18.0))
    r_ = 0.025 + 0.12 * smear + 0.08 * wipe + 0.10 * np.clip(prints, 0, 1) + 0.12 * dust
    return np.repeat(np.clip(r_, 0.02, 0.35)[..., None], 3, 2)


save('glass_smudge.jpg', glass_smudge(), q=88)


def paving(n=512, seed=95):
    """正面玄関の外の暗い舗装(アスファルト)。1枚=2m。"""
    a = noise(n, ((6, 1.0), (40, 0.6), (200, 0.6)), seed)
    rng = np.random.default_rng(seed)
    grit = rng.random((n, n)).astype(np.float32)
    v = 0.075 + 0.02 * (a - 0.5) + 0.035 * (grit - 0.5)
    alb = np.stack([v, v, v * 1.02], 2)
    return alb, normal_from_height(grit * 0.6 + a * 0.4, 2.0)


alb, nrm = paving()
save('paving_albedo.jpg', alb, q=84)
save('paving_normal.jpg', nrm, q=86)


def intercom(W=256, H=512):
    """オートロックの操作盤(ヘアラインの板・黒い液晶・テンキー)。写真 entrance_windbreak の右手前の盤。"""
    im = Image.new('RGB', (W, H), (150, 151, 150))
    d = ImageDraw.Draw(im)
    rng = np.random.default_rng(7)
    for x in range(W):
        c = int(144 + rng.random() * 14)
        d.line([(x, 0), (x, H)], fill=(c, c, c - 1))
    d.rectangle([2, 2, W - 3, H - 3], outline=(110, 110, 110), width=2)
    d.rectangle([40, 40, W - 40, 190], fill=(10, 14, 22), outline=(60, 60, 64), width=3)
    d.rectangle([52, 52, W - 52, 178], fill=(28, 56, 110))
    d.rectangle([60, 64, W - 60, 74], fill=(110, 150, 210))
    for r in range(4):
        for c in range(3):
            x0, y0 = 58 + c * 48, 230 + r * 50
            d.rectangle([x0, y0, x0 + 38, y0 + 36], fill=(60, 62, 66), outline=(40, 40, 42))
    d.ellipse([W / 2 - 20, 440, W / 2 + 20, 480], fill=(40, 40, 44), outline=(90, 90, 90), width=2)
    save('intercom.png', im)


intercom()


def carpet(n=512, seed=51):
    a = noise(n, ((8, 1.0), (64, 0.6), (256, 0.8)), seed)
    v = 0.13 + 0.05 * (a - 0.5)
    alb = np.stack([v * 0.95, v * 0.97, v * 1.08], 2)
    return alb, normal_from_height(a, 3.0)


alb, nrm = carpet()
save('carpet_albedo.jpg', alb, q=86)
save('carpet_normal.jpg', nrm, q=88)


def diamond_plate(n=512, cells=8, seed=61):
    """縞鋼板(写真 outer_stairs_2): 菱形の細長い突起が交互の向きで並ぶ。1枚=0.3m。"""
    yy, xx = n2tex._grid(n, n)
    s = n / cells
    cx = (xx % s) / s - 0.5; cy = (yy % s) / s - 0.5
    ci = (xx // s).astype(int); cj = (yy // s).astype(int)
    alt = ((ci + cj) % 2 == 0)
    u = np.where(alt, (cx + cy), (cx - cy)) / 1.414
    w = np.where(alt, (cx - cy), (cx + cy)) / 1.414
    bump = np.clip(1.0 - (np.abs(u) / 0.36) ** 2 - (np.abs(w) / 0.07) ** 2, 0, 1) ** 0.5
    a = noise(n, ((6, 1.0), (48, 0.5)), seed)
    v = 0.40 + 0.06 * (a - 0.5) + 0.05 * bump
    alb = np.stack([v, v * 0.99, v * 0.97], 2)
    return alb, normal_from_height(bump * 3.0 + a * 0.3, 2.0)


alb, nrm = diamond_plate()
save('diamond_albedo.jpg', alb, q=86)
save('diamond_normal.jpg', nrm, q=88)


def concrete(n=1024, seed=71):
    a = noise(n, ((5, 1.0), (20, 0.6), (80, 0.4), (320, 0.35)), seed)
    rng = np.random.default_rng(seed)
    pores = (rng.random((n, n)) > 0.996).astype(np.float32)
    pores = np.asarray(Image.fromarray((pores * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3))) / 255.0
    v = 0.46 + 0.07 * (a - 0.5) - 0.12 * pores
    alb = np.stack([v, v * 0.995, v * 0.98], 2)
    return alb, normal_from_height(a * 0.5 - pores * 0.6, 1.5)


alb, nrm = concrete()
save('concrete_albedo.jpg', alb, q=84)
save('concrete_normal.jpg', nrm, q=86, size=512)


def mailbox_wall(W=2048, H=780):
    """集合ポスト＋宅配BOX(写真 mailboxes_1F.jpg)。幅 4.6m × 高さ 1.75m の面に UV 0..1 で貼る。
    左端=操作盤(液晶・ボタン)の列、上段=小扉(ダイヤル錠・号室札)8段×12列、下段=宅配BOX の大扉(黒い番号札・緑の LED)。
    P3a-2: 解像度を上げ、扉の隙間・ダイヤル錠の凹凸を法線マップ(mailbox_normal.jpg)に。"""
    im = Image.new('RGB', (W, H), (176, 175, 170))
    hm = Image.new('L', (W, H), 128)
    d = ImageDraw.Draw(im); dh = ImageDraw.Draw(hm)
    rng = np.random.default_rng(13)
    face, gap, edge = (184, 183, 178), (70, 70, 68), (150, 149, 145)
    x0, x1, y0, y1 = 6, W - 6, 6, int(H * 0.70)
    px1 = x0 + 230                                   # 操作盤の列
    d.rectangle([x0, y0, px1 - 4, H - 6], fill=face, outline=gap, width=2)
    dh.rectangle([x0, y0, px1 - 4, H - 6], fill=150)
    d.rectangle([x0 + 40, y0 + 150, x0 + 180, y0 + 250], fill=(20, 24, 30), outline=(90, 90, 90), width=4)   # 液晶
    d.rectangle([x0 + 50, y0 + 160, x0 + 170, y0 + 240], fill=(54, 66, 78))
    d.rectangle([x0 + 50, y0 + 40, x0 + 190, y0 + 110], fill=(236, 236, 232), outline=(120, 120, 120))         # 注意書き
    for i in range(5):
        d.line([(x0 + 60, y0 + 55 + i * 11), (x0 + 175, y0 + 55 + i * 11)], fill=(120, 140, 170), width=3)
    for i, yy in enumerate((y0 + 60, y0 + 330, y0 + 470, y0 + 610)):
        d.rectangle([x0 + 8, yy, x0 + 30, yy + 34], fill=(18, 18, 20))
        d.ellipse([x0 + 14, yy + 10, x0 + 24, yy + 22], fill=(70, 240, 120))
    cols, rows = 12, 8
    cw, ch = (x1 - px1) / cols, (y1 - y0) / rows
    for c in range(cols):
        for r in range(rows):
            ax, ay = px1 + c * cw, y0 + r * ch
            box = [ax + 3, ay + 3, ax + cw - 3, ay + ch - 3]
            sh = int(rng.integers(-4, 5))
            d.rectangle(box, fill=(face[0] + sh, face[1] + sh, face[2] + sh), outline=gap, width=3)
            dh.rectangle(box, fill=160); dh.rectangle([ax, ay, ax + cw, ay + 3], fill=40); dh.rectangle([ax, ay, ax + 3, ay + ch], fill=40)
            cx_, cy_ = ax + 22, ay + ch / 2
            d.ellipse([cx_ - 11, cy_ - 11, cx_ + 11, cy_ + 11], fill=(214, 214, 212), outline=(80, 80, 80), width=2)   # ダイヤル錠
            for k in range(10):
                t = k / 10 * 6.283
                d.line([(cx_ + 6 * np.cos(t), cy_ + 6 * np.sin(t)), (cx_ + 10 * np.cos(t), cy_ + 10 * np.sin(t))], fill=(60, 60, 60), width=1)
            dh.ellipse([cx_ - 11, cy_ - 11, cx_ + 11, cy_ + 11], fill=230)
            d.rectangle([ax + cw - 46, cy_ - 7, ax + cw - 12, cy_ + 6], fill=(32, 32, 34))                  # 号室札
    by0 = y1 + 4
    lc = 9
    lw = (x1 - px1) / lc
    for c in range(lc):
        ax = px1 + c * lw
        box = [ax + 3, by0, ax + lw - 3, H - 8]
        d.rectangle(box, fill=(178, 177, 172), outline=gap, width=3)
        dh.rectangle(box, fill=150); dh.rectangle([ax, by0, ax + 3, H], fill=40)
        d.rectangle([ax + 14, by0 + 40, ax + 40, by0 + 72], fill=(20, 20, 22))
        d.text((ax + 27, by0 + 56), str(15 + c), fill=(220, 220, 220), anchor='mm')
        if c % 3 != 1:
            d.ellipse([ax + 18, by0 + 14, ax + 28, by0 + 24], fill=(60, 230, 110))
    im = im.filter(ImageFilter.SMOOTH)
    save('mailbox.jpg', im, q=88)
    h = np.asarray(hm.filter(ImageFilter.GaussianBlur(1.2)), np.float32) / 255.0
    nm = Image.fromarray((np.clip(normal_from_height(h, 6.0), 0, 1) * 255 + 0.5).astype(np.uint8)).resize((1024, 390), Image.LANCZOS)
    save('mailbox_normal.jpg', nm, q=88)   # 法線は 1024px 以下(check_glb)


mailbox_wall()


def room_plates():
    """号室プレート(濃いブロンズ地に淡い数字)。全居室を 8 列 × 16 行(1マス 128×64)のアトラスへ。UV は room_plates.json。"""
    b = json.load(open(os.path.join(ROOT, 'data', 'building.json')))
    ids = sorted(r['id'] for f in b['floors'] if f['level'] <= 7 for r in f['rooms'] if r['kind'] == 'unit')
    W, H, cw, ch = 1024, 1024, 128, 64
    im = Image.new('RGB', (W, H), (40, 34, 28))
    d = ImageDraw.Draw(im)
    f = ImageFont.truetype(FONT, 40)
    uv = {}
    for i, rid in enumerate(ids):
        c, r = i % 8, i // 8
        x, y = c * cw, r * ch
        d.rectangle([x, y, x + cw - 1, y + ch - 1], fill=(46, 38, 30))
        d.rectangle([x + 3, y + 3, x + cw - 4, y + ch - 4], outline=(92, 78, 60), width=2)
        d.text((x + cw / 2, y + ch / 2 + 1), rid, font=f, fill=(222, 214, 196), anchor='mm')
        # glTF/three の UV(左上原点、v は下向き)ではなく Blender の UV(左下原点)で書く
        uv[rid] = [x / W, 1 - (y + ch) / H, (x + cw) / W, 1 - y / H]
    save('room_plates.png', im)
    with open(os.path.join(OUT, 'room_plates.json'), 'w') as fp:
        json.dump(uv, fp, indent=0)
    return len(ids)


n = room_plates()
# P3b: 居室の内装・バルコニーのテクスチャ(tools/room_textures.py)
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import room_textures  # noqa: E402
room_textures.run(save, n2tex, normal_from_height, OUT)
tot = sum(m[2] for m in made)
for name, size, b in made:
    print(f'  {name:28s} {size[0]}x{size[1]}  {b / 1024:7.1f} KB')
print(f'make_textures: {len(made)} files, {tot / 1e6:.2f} MB, room plates {n}')
