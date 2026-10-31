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
                   'lightmap': 'build/p0_lightmap.png', 'images': 'AUTO', 'lightmap2': ''})


def lm_group(o):
    if o.get('n2_kind') in ('glass', 'glassedge', 'decal'):
        return 0
    g = o.get('n2_lm')
    return 1 if g is None else int(g)


DYNAMIC_KINDS = ('closetdoor', 'lockerdoor')


def join_static_rooms(scene):
    """P3b: 部屋の組(n2_lm 2)とライトマップなし(n2_lm 0)の動かないメッシュを、組×種類(n2_kind)ごとに1つへまとめる。
    実行時は材質ごとに結合するので見た目は同じ。GLB の JSON(ノード・アクセサの数)が減る(1階あたり約 0.2MB)。"""
    groups = {}
    for o in list(scene.objects):
        if o.type != 'MESH' or o.get('n2_bake_only') or 'n2_lm' not in o.keys():   # P3b の部屋の作り(n2_lm 付き)だけ。P3a の外殻はそのまま
            continue
        g = lm_group(o)
        if g == 1:
            continue
        k = o.get('n2_kind', '')
        if k in DYNAMIC_KINDS or (k == 'winsash' and o.get('n2_operable')) or o.parent or o.children:
            continue
        groups.setdefault((g, k), []).append(o)
    n0 = n1 = 0
    for (g, k), objs in groups.items():
        n0 += len(objs); n1 += 1
        if len(objs) < 2:
            continue
        for o in scene.objects:
            o.select_set(False)
        with bpy.context.temp_override(active_object=objs[0], object=objs[0], selected_objects=objs, selected_editable_objects=objs):
            bpy.ops.object.join()
        j = objs[0]
        j.name = f'J{g}_{k}'
        for key in list(j.keys()):
            if key.startswith('n2_'):
                del j[key]
        j['n2_kind'] = k
        j['n2_lm'] = g
    log(f'joined static room meshes: {n0} -> {n1}')


def main():
    scene = bpy.context.scene
    join_static_rooms(scene)
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
    # P3b: 部屋の組(n2_lm=2)は2枚目のライトマップ。材質名 MR_* が2枚目(world.js)、MX_* はライトマップなし
    rb = bake.get('rooms')
    lm2 = os.path.basename(ARGS['lightmap2']) if ARGS['lightmap2'] and rb else None
    def mesh_lm(o):
        g = lm_group(o)
        if g == 2 and lm2:
            return dict(lightmap=lm2, intensity=rb['lightMapIntensity'], kind=o.get('n2_kind', ''))
        if g == 0:
            return dict(lightmap=None, intensity=0, kind=o.get('n2_kind', ''))
        return dict(lightmap=lm, intensity=bake['lightMapIntensity'], kind=o.get('n2_kind', ''))
    manifest = dict(
        version=1,
        glb=os.path.basename(out),
        lightmap=dict(file=lm, channel=1, encoding=bake['encoding'], scale=bake['scale'],
                      intensity=bake['lightMapIntensity'], size=bake['size']),
        **({'lightmap2': dict(file=lm2, channel=1, encoding=rb['encoding'], scale=rb['scale'], intensity=rb['lightMapIntensity'],
                              size=rb['size'], materialPrefix='MR_')} if lm2 else {}),
        bake=bake,
        meshes={o.name: mesh_lm(o) for o in meshes},
        level=meta.get('level'), baseY=meta.get('baseY'), ceilH=meta.get('ceilH'),
        doors=meta.get('doors', []), lamps=meta.get('lamps', []),
    )
    # P3a(build_floor.py): 窓・灯具・非常口・カゴのボタン・材質→実行時テクスチャの対応
    for k in ('windows', 'downlights', 'brackets', 'exits', 'evButtons', 'materials', 'walls', 'envProbe', 'rooms'):
        if k in meta:
            manifest[k] = meta[k]
    with open(os.path.join(ROOT, ARGS['manifest']), 'w') as f:
        json.dump(manifest, f, indent=1, ensure_ascii=False)
    log(f'manifest: {len(manifest["meshes"])} meshes')


if __name__ == '__main__':
    main()
