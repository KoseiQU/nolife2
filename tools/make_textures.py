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


def ev_display_atlas():
    """呼びパネルの階数表示(青白LED)。1..8 を横に並べたアトラス(1マス 96×234)。"""
    cells = []
    segs = {1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'bcfg', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg'}
    for n in range(1, 9):
        img = np.zeros((234, 96, 3), np.float32); img[:] = (0.012, 0.012, 0.016)
        led = (0.62, 0.86, 1.0)
        yy, xx = n2tex._grid(234, 96)
        ax, ay = 48, 234 * 0.20
        m = n2tex._seg(xx, yy, ax, ay - 9, ax, ay + 9, 1.4) | n2tex._seg(xx, yy, ax, ay - 9, ax - 6, ay - 3, 1.4) | n2tex._seg(xx, yy, ax, ay - 9, ax + 6, ay - 3, 1.4)
        img[m] = np.array(led) * 0.45
        n2tex.seven_seg(img, 48 - 0.55 * 34 / 2, 234 * 0.30, 34, led, segs[n])
        cells.append(img)
    return np.concatenate(cells, axis=1)


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


alb, nrm = stone_tile()
save('stone_floor_albedo.jpg', alb, q=86)
save('stone_floor_normal.jpg', nrm, q=88, size=512)
alb, nrm = stone_tile(seed=41, base=0.22, contrast=0.8)
save('stone_wall_albedo.jpg', alb, q=86)
save('stone_wall_normal.jpg', nrm, q=88, size=512)


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


def mailbox_wall(W=1024, H=400):
    """集合ポスト(上段: 小扉にダイヤル錠・号室窓)＋宅配BOX(下段: 大扉・緑のLED)。写真 mailboxes_1F.jpg の配置を簡略化。
    幅 4.6m × 高さ 1.75m の面に UV 0..1 で貼る。"""
    im = Image.new('RGB', (W, H), (150, 150, 146))
    d = ImageDraw.Draw(im)
    cols, rows = 16, 7
    x0, x1, y0, y1 = 8, W - 8, 10, int(H * 0.66)
    cw, ch = (x1 - x0) / cols, (y1 - y0) / rows
    for c in range(cols):
        for r in range(rows):
            ax, ay = x0 + c * cw, y0 + r * ch
            d.rectangle([ax + 1, ay + 1, ax + cw - 2, ay + ch - 2], fill=(168, 168, 164), outline=(110, 110, 106))
            d.ellipse([ax + 5, ay + ch / 2 - 5, ax + 15, ay + ch / 2 + 5], fill=(200, 200, 198), outline=(90, 90, 90))
            d.rectangle([ax + cw - 24, ay + ch / 2 - 4, ax + cw - 7, ay + ch / 2 + 3], fill=(40, 40, 42))
    by0 = y1 + 6
    for c in range(8):
        ax = x0 + c * (x1 - x0) / 8
        d.rectangle([ax + 2, by0, ax + (x1 - x0) / 8 - 3, H - 8], fill=(160, 160, 156), outline=(105, 105, 100))
        d.rectangle([ax + 10, by0 + 14, ax + 18, by0 + 26], fill=(30, 30, 32))
        d.ellipse([ax + 12, by0 + 17, ax + 16, by0 + 21], fill=(60, 230, 110))
    save('mailbox.jpg', im, q=86)


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
tot = sum(m[2] for m in made)
for name, size, b in made:
    print(f'  {name:28s} {size[0]}x{size[1]}  {b / 1024:7.1f} KB')
print(f'make_textures: {len(made)} files, {tot / 1e6:.2f} MB, room plates {n}')
