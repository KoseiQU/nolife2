#!/usr/bin/env python3
"""fetch_textures.py — P0用のCC0 PBRテクスチャ(2K)を取得して assets/textures/<name>/ に保存する。

出力ファイル名は素材ごとに共通: albedo.jpg / normal.jpg(OpenGL形式) / roughness.jpg / ao.jpg(あれば)
既に albedo.jpg がある素材はスキップ(--force で再取得)。取得元は assets/LICENSES.md に記録済み。
実行: python3 -I tools/fetch_textures.py [--force]
"""
import io, json, os, sys, urllib.request, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DST = os.path.join(ROOT, 'assets', 'textures')
UA = {'User-Agent': 'nolife2-asset-fetch/1.0'}

# name: (source, asset id)
TEXTURES = {
    'wall_cloth':   ('ambientcg', 'Wallpaper001A'),    # クロス壁紙(ウッドチップ調の白いビニルクロス相当)
    'ceiling_tile': ('ambientcg', 'OfficeCeiling001'), # 岩綿吸音板調の天井材
    'floor_sheet':  ('polyhaven', 'terrazzo_tiles'),   # 細かい斑の長尺シート床の代用
    'door_wood':    ('polyhaven', 'teak_veneer'),      # 木目化粧板の扉
}

def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()

def save(path, data):
    with open(path, 'wb') as f:
        f.write(data)

def fetch_polyhaven(asset, out):
    files = json.loads(get(f'https://api.polyhaven.com/files/{asset}'))
    m = {'albedo.jpg': 'Diffuse', 'normal.jpg': 'nor_gl', 'roughness.jpg': 'Rough', 'ao.jpg': 'AO'}
    for fn, key in m.items():
        ent = files.get(key, {}).get('2k', {}).get('jpg')
        if not ent:
            print(f'  ({asset}: {key} なし)'); continue
        save(os.path.join(out, fn), get(ent['url']))
        print(f'  {fn} <- {ent["url"]}')

def fetch_ambientcg(asset, out):
    url = f'https://ambientcg.com/get?file={asset}_2K-JPG.zip'
    z = zipfile.ZipFile(io.BytesIO(get(url)))
    m = {'_Color.jpg': 'albedo.jpg', '_NormalGL.jpg': 'normal.jpg',
         '_Roughness.jpg': 'roughness.jpg', '_AmbientOcclusion.jpg': 'ao.jpg'}
    for member in z.namelist():
        for suf, fn in m.items():
            if member.endswith(suf) and '/' not in member:   # 自分で決めた名前で書くので展開パスは使わない
                save(os.path.join(out, fn), z.read(member))
                print(f'  {fn} <- {url} :: {member}')

def main():
    force = '--force' in sys.argv
    for name, (src, asset) in TEXTURES.items():
        out = os.path.join(DST, name)
        os.makedirs(out, exist_ok=True)
        if os.path.exists(os.path.join(out, 'albedo.jpg')) and not force:
            print(f'skip {name} (取得済み)'); continue
        print(f'{name}: {src} {asset}')
        (fetch_polyhaven if src == 'polyhaven' else fetch_ambientcg)(asset, out)

if __name__ == '__main__':
    main()
