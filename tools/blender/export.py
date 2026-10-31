# export.py — ベイク済み .blend を GLB に書き出し、ライトマップの対応表(manifest)を併出力する。
#
# 実行: Blender -b build/p0_baked.blend -P tools/blender/export.py -- [--out build/p0.glb]
#        [--manifest build/p0_manifest.json]
# GLB: TEXCOORD_0 = UVMap(タイル), TEXCOORD_1 = Lightmap(アトラス)。glTF にはライトマップの枠が無いので
#   manifest に「メッシュ(ノード)名 → ライトマップPNG・強度」と扉/常夜灯などのメタ情報を書く。

import bpy, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
from n2common import parse_args, log  # noqa: E402

ARGS = parse_args({'out': 'build/p0.glb', 'manifest': 'build/p0_manifest.json', 'info': 'build/p0_bake_info.json',
                   'lightmap': 'build/p0_lightmap.png', 'images': 'AUTO'})


def main():
    scene = bpy.context.scene
    # P3a: ベイク専用の遮蔽は書き出さない(選択だけを書き出す)
    meshes = [o for o in scene.objects if o.type == 'MESH' and not o.get('n2_bake_only')]
    for o in scene.objects:
        o.select_set(False)
    for o in meshes:
        o.select_set(True)
    for o in meshes:   # 第2UVの順序を保証(0=UVMap, 1=Lightmap)
        names = [l.name for l in o.data.uv_layers]
        assert names[:2] == ['UVMap', 'Lightmap'], (o.name, names)
        o.data.uv_layers.active = o.data.uv_layers['UVMap']
    out = os.path.join(ROOT, ARGS['out'])
    rna = bpy.ops.export_scene.gltf.get_rna_type()
    props = {p.identifier for p in rna.properties}
    kw = dict(filepath=out, export_format='GLB', export_texcoords=True, export_normals=True,
              export_materials='EXPORT', export_yup=True, export_apply=False, export_extras=True,
              export_lights=False, export_cameras=False, export_image_format=ARGS['images'], use_selection=True)
    kw = {k: v for k, v in kw.items() if k in props or k == 'filepath'}
    bpy.ops.export_scene.gltf(**kw)
    log(f'exported {out} ({os.path.getsize(out) / 1e6:.1f} MB)')

    bake = json.load(open(os.path.join(ROOT, ARGS['info'])))
    meta = json.loads(scene.get('n2_meta', '{}'))
    lm = os.path.basename(ARGS['lightmap'])
    manifest = dict(
        version=1,
        glb=os.path.basename(out),
        lightmap=dict(file=lm, channel=1, encoding=bake['encoding'], scale=bake['scale'],
                      intensity=bake['lightMapIntensity'], size=bake['size']),
        bake=bake,
        meshes={o.name: dict(lightmap=lm, intensity=bake['lightMapIntensity'], kind=o.get('n2_kind', ''))
                for o in meshes},
        level=meta.get('level'), baseY=meta.get('baseY'), ceilH=meta.get('ceilH'),
        doors=meta.get('doors', []), lamps=meta.get('lamps', []),
    )
    # P3a(build_floor.py): 窓・灯具・非常口・カゴのボタン・材質→実行時テクスチャの対応
    for k in ('windows', 'downlights', 'brackets', 'exits', 'evButtons', 'materials', 'walls'):
        if k in meta:
            manifest[k] = meta[k]
    with open(os.path.join(ROOT, ARGS['manifest']), 'w') as f:
        json.dump(manifest, f, indent=1, ensure_ascii=False)
    log(f'manifest: {len(manifest["meshes"])} meshes')


if __name__ == '__main__':
    main()
