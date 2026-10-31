#!/usr/bin/env python3
"""enemy_setup.py — P1(敵候補)用に MPFB2 と MakeHuman アセットパックを取得・検証・導入する。

実行: python3 -I tools/blender/enemy_setup.py [--force]
  1) 公式配布元から取得して build/enemy_cache/ に置く(取得済みならスキップ)。SHA-256 を下の表と照合
     - MPFB 2.0.18 : extensions.blender.org(Blender 公式拡張リポジトリ。URL 自体が SHA-256 を含む)
     - アセットパック: files.makehumancommunity.org(MakeHuman 公式。2026-10-31 取得時のハッシュで固定)
  2) Blender をプロジェクト専用のユーザーフォルダ(BLENDER_USER_RESOURCES=build/blender_user)で起動して
     拡張をインストール(利用者の普段の Blender 設定には触れない)
  3) アセットパックを MPFB のユーザーデータへ展開(zip-slip を検査)
  4) enemy_defs.py が使う全アセットのライセンスをパックのメタデータで確認(CC0 / CC-BY 以外があれば失敗)
ダウンロード物は展開先と別のフォルダに置き、展開物の中のコードは実行しない。
"""
import hashlib, json, os, subprocess, sys, urllib.request, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
CACHE = os.path.join(ROOT, 'build', 'enemy_cache')
USER = os.path.join(ROOT, 'build', 'blender_user')
MPFB_DATA = os.path.join(USER, 'extensions', '.user', 'user_default', 'mpfb', 'data')
BLENDER = os.environ.get('BLENDER', '/Applications/Blender.app/Contents/MacOS/Blender')
UA = {'User-Agent': 'nolife2-asset-fetch/1.0'}

MPFB = ('add-on-mpfb-v2.0.18.zip',
        'https://extensions.blender.org/download/sha256:c075b3e9b94b8e5556a5f03f4653602d02ea306de08126e8f55ed6dee28a2dad/add-on-mpfb-v2.0.18.zip',
        'c075b3e9b94b8e5556a5f03f4653602d02ea306de08126e8f55ed6dee28a2dad')
AP = 'https://files.makehumancommunity.org/asset_packs/'
PACKS = [
    ('makehuman_system_assets_cc0.zip', AP + 'makehuman_system_assets/makehuman_system_assets_cc0.zip',
     'b542127a8e25547c7c29c19f2d1d2adb9a664c80396ecd694095dbc8028a0107'),
    ('suits03_cc-by.zip', AP + 'suits03/suits03_cc-by.zip', '74ace28794d27186a3f3ee26058f16906fe3c46f9f7e35a9ac7f622cd5e821eb'),
    ('shirts02_ccby.zip', AP + 'shirts02/shirts02_ccby.zip', 'd711ca9f73212de855257ac08422e1e0ccb802e5231315c2a360d0fcfea5033e'),
    ('pants01_cc0.zip', AP + 'pants01/pants01_cc0.zip', 'e4e0ec60db34f279be291a83cfd7b342a7c5cf09bb7676682a5f39f4f6ac4ad9'),
    ('pants02_ccby.zip', AP + 'pants02/pants02_ccby.zip', '9dbcd65e03ab100977079b6960e91c334bed92e948aeda5423f11997a133904a'),
    ('shoes02_ccby.zip', AP + 'shoes02/shoes02_ccby.zip', '1b544d87dd8b3d3a9c8317e4f059be456491be979cbc9984fc53f403046f5061'),
    ('hats03_cc-by.zip', AP + 'hats03/hats03_cc-by.zip', '2702d58fa04e57235881551c45adcda36a6eafde8043c2695375bc0b4b79f550'),
    ('glasses01_cc0.zip', AP + 'glasses01/glasses01_cc0.zip', 'f215c58e09e31b7ee568c814067cb47704cee6da1f6fc01cffb8e9fca37bafdd'),
]


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def fetch(name, url, digest, sub=''):
    d = os.path.join(CACHE, sub)
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, name)
    if not os.path.exists(path) or '--force' in sys.argv:
        print(f'  get {url}')
        tmp = path + '.part'
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=600) as r, open(tmp, 'wb') as f:
            while True:
                b = r.read(1 << 20)
                if not b:
                    break
                f.write(b)
        os.replace(tmp, path)
    got = sha256(path)
    if got != digest:
        raise SystemExit(f'SHA-256 不一致: {name}\n  期待 {digest}\n  実際 {got}')
    print(f'  ok  {name} ({os.path.getsize(path) / 1e6:.0f} MB) sha256={digest[:16]}…')
    return path


def install_extension(zip_path):
    if os.path.isdir(os.path.join(USER, 'extensions', 'user_default', 'mpfb')) and '--force' not in sys.argv:
        print('  MPFB はインストール済み'); return
    env = dict(os.environ, BLENDER_USER_RESOURCES=USER)
    r = subprocess.run([BLENDER, '-b', '--factory-startup', '--command', 'extension', 'install-file',
                        '-r', 'user_default', '-e', zip_path], env=env, capture_output=True, text=True)
    print('  ' + (r.stdout.strip().splitlines() or ['?'])[0])
    if r.returncode != 0 or 'Installed' not in r.stdout:
        raise SystemExit(r.stdout + r.stderr)


def extract(zip_path):
    root = os.path.realpath(MPFB_DATA)
    with zipfile.ZipFile(zip_path) as z:
        for n in z.namelist():
            dst = os.path.realpath(os.path.join(root, n))
            if not dst.startswith(root + os.sep) and dst != root:
                raise SystemExit(f'zip の中に展開先の外を指すパス: {n}')
        z.extractall(root)


def check_licenses():
    sys.path.insert(0, HERE)
    import enemy_defs  # noqa: E402  (データのみのモジュール)
    meta = {}
    for f in os.listdir(os.path.join(MPFB_DATA, 'packs')):
        if f.endswith('.json'):
            for k, v in json.load(open(os.path.join(MPFB_DATA, 'packs', f))).items():
                meta[k] = (v.get('license', '?'), v.get('author', '?'), f[:-5])
    used = set()
    for c in enemy_defs.CANDIDATES:
        used |= set(c['clothes']) | {c['eyebrows'], c['eyelashes'], c['skin']} | ({c['hair']} if c['hair'] else set())
    used |= {'high-poly'}
    bad = []
    for a in sorted(used):
        lic, author, pack = meta.get(a, ('?', '?', '?'))
        if a == 'high-poly' or pack == 'makehuman_system_assets':
            lic = lic if lic != '?' else 'CC0'
        print(f'  {a:40s} {lic:6s} {author:16s} [{pack}]')
        if lic not in ('CC0', 'CC-BY'):
            bad.append(a)
    if bad:
        raise SystemExit(f'ライセンス不明/非許可のアセット: {bad}')


def main():
    print('== 1/4 MPFB 拡張(Blender 公式拡張リポジトリ)')
    z = fetch(*MPFB)
    print('== 2/4 アセットパック(MakeHuman 公式)')
    packs = [fetch(*p, sub='packs') for p in PACKS]
    print('== 3/4 導入(build/blender_user = このプロジェクト専用の Blender ユーザーフォルダ)')
    install_extension(z)
    os.makedirs(MPFB_DATA, exist_ok=True)
    for p in packs:
        extract(p)
    print(f'  {len(packs)} パックを展開 → {os.path.relpath(MPFB_DATA, ROOT)}')
    print('== 4/4 使用アセットのライセンス確認')
    check_licenses()


if __name__ == '__main__':
    main()
