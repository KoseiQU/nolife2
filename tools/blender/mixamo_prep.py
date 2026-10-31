# mixamo_prep.py — Mixamo に上げる「リグ取得用の軽量メッシュ」と、リグ移植先の「本番メッシュ .blend」を作る。
#
# 実行: Blender -b --factory-startup -P tools/blender/mixamo_prep.py -- [--src build/enemy/07_kanrinin_final.fbx]
# 入力: 本番 FBX(1 メッシュ・13 素材・形状キー grin/attack・テクスチャ埋め込み。enemy_build.py --id 07 の出力)
# 出力(build/enemy/):
#   07_prod_mesh.blend   … 本番の 1 メッシュ(形状キー・素材・テクスチャを同梱)。mixamo_merge.py の移植先
#   07_mixamo.obj        … テクスチャ・素材・形状キーなし、三角形化、Y-up、m、A ポーズ、足元 z=0
#   07_mixamo_lite.fbx   … 同じ形、素材 1 個・テクスチャ埋め込みなし・形状キーなし(FBX バイナリ 7.4)。目標 ≤5MB
#   07_mixamo_prep.json  … 頂点数など(OBJ は UV 継ぎ目で頂点が分かれるので、本番との対応は最近傍頂点で取る前提)
# 背景: Mixamo のプレビュー変換(Verold)が、本番 FBX(4096 テクスチャ×13 素材・21MB)で内部エラーになったため。

import bpy, bmesh, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
from n2common import parse_args, log  # noqa: E402

ARGS = parse_args({'src': 'build/enemy/07_kanrinin_final.fbx', 'out_dir': 'build/enemy'})
OUT = os.path.join(ROOT, ARGS['out_dir'])


def main():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.import_scene.fbx(filepath=os.path.join(ROOT, ARGS['src']))
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    assert len(meshes) == 1, [o.name for o in meshes]
    prod = meshes[0]
    keys = [k.name for k in prod.data.shape_keys.key_blocks] if prod.data.shape_keys else []
    assert 'grin' in keys and 'attack' in keys, keys
    with bpy.context.temp_override(selected_objects=[prod], selected_editable_objects=[prod], active_object=prod):
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    zmin = min(v.co.z for v in prod.data.vertices)
    assert abs(zmin) < 0.01, f'足元が z=0 でない: {zmin}'
    # 本番メッシュの .blend(移植先)
    bpy.ops.file.pack_all()
    prod_blend = os.path.join(OUT, '07_prod_mesh.blend')
    bpy.ops.wm.save_as_mainfile(filepath=prod_blend, compress=True)
    prod.data.calc_loop_triangles()
    info = dict(src=ARGS['src'], prod_blend=os.path.basename(prod_blend), prod_name=prod.name,
                prod_verts=len(prod.data.vertices), prod_tris=len(prod.data.loop_triangles),
                prod_mats=len(prod.material_slots), prod_keys=keys)
    # 軽量版: 形状キー・素材・テクスチャを外し、三角形化
    lite = prod.copy(); lite.data = prod.data.copy(); lite.name = 'N2E_07_mixamo'; lite.data.name = 'N2E_07_mixamo'
    bpy.context.scene.collection.objects.link(lite)
    prod.hide_set(True); prod.hide_render = True
    lite.shape_key_clear()
    lite.data.materials.clear()
    m = bpy.data.materials.new('N2E_07_plain')
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.5, 0.5, 0.5, 1)
    lite.data.materials.append(m)
    for p in lite.data.polygons:
        p.material_index = 0
    for ca in list(lite.data.color_attributes):
        lite.data.color_attributes.remove(ca)
    while len(lite.data.uv_layers) > 1:
        lite.data.uv_layers.remove(lite.data.uv_layers[-1])
    bm = bmesh.new(); bm.from_mesh(lite.data)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(lite.data); bm.free()
    for o in bpy.context.scene.objects:
        o.select_set(o is lite)
    bpy.context.view_layer.objects.active = lite
    obj = os.path.join(OUT, '07_mixamo.obj')
    bpy.ops.wm.obj_export(filepath=obj, export_selected_objects=True, export_triangulated_mesh=True,
                          export_materials=False, export_uv=True, export_normals=True, apply_modifiers=True,
                          forward_axis='NEGATIVE_Z', up_axis='Y', global_scale=1.0)
    fbx = os.path.join(OUT, '07_mixamo_lite.fbx')
    bpy.ops.export_scene.fbx(filepath=fbx, use_selection=True, object_types={'MESH'}, use_mesh_modifiers=True,
                             mesh_smooth_type='FACE', add_leaf_bones=False, path_mode='STRIP', embed_textures=False,
                             bake_anim=False)
    # OBJ の頂点数(位置 v と、UV 継ぎ目で分かれる v/vt の組)
    nv = nvt = 0; pairs = set()
    with open(obj) as f:
        for line in f:
            if line.startswith('v '):
                nv += 1
            elif line.startswith('vt '):
                nvt += 1
            elif line.startswith('f '):
                for t in line.split()[1:]:
                    a = t.split('/')
                    pairs.add((a[0], a[1] if len(a) > 1 else ''))
    lite.data.calc_loop_triangles()
    raw = open(fbx, 'rb').read()
    info.update(obj=os.path.basename(obj), obj_mb=round(os.path.getsize(obj) / 1e6, 2), obj_v=nv, obj_vt=nvt,
                obj_v_vt_pairs=len(pairs), lite_fbx=os.path.basename(fbx), lite_mb=round(len(raw) / 1e6, 2),
                lite_verts=len(lite.data.vertices), lite_tris=len(lite.data.loop_triangles), lite_mats=len(lite.data.materials),
                lite_fbx_strings={k.decode(): raw.count(k) for k in (b'BlendShape', b'Deformer', b'Texture', b'Video', b'LimbNode')})
    json.dump(info, open(os.path.join(OUT, '07_mixamo_prep.json'), 'w'), indent=1, ensure_ascii=False)
    log(f'prep: prod {info["prod_verts"]} v / {info["prod_tris"]} tris / {info["prod_mats"]} mats / keys {keys}')
    log(f'prep: obj {nv} v ({len(pairs)} v/vt pairs, {info["obj_mb"]} MB), lite fbx {info["lite_mb"]} MB '
        f'{info["lite_fbx_strings"]}')
    assert info['lite_mb'] <= 5.0, f'lite FBX が 5MB を超えた: {info["lite_mb"]}'


if __name__ == '__main__':
    main()
