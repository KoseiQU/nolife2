# mixamo_merge.py — Mixamo から戻ったリグ済み FBX の「骨＋頂点ウェイト(＋アニメ)」を、本番の 1 メッシュ
#   (形状キー grin/attack・13 素材)へ移して GLB を書き出す。
#
# 実行: Blender -b --factory-startup -P tools/blender/mixamo_merge.py -- --rigged <Mixamo の FBX>
#        [--prod build/enemy/07_prod_mesh.blend] [--out build/enemy/07_rigged.glb] [--anims a.fbx,b.fbx]
# 前提: Mixamo に上げたのは 07_mixamo_lite.fbx(または 07_mixamo.obj)= 本番と同じ形。Mixamo は cm・Y-up で返し、
#   メッシュ名を変え、UV 継ぎ目で頂点を分けることがあるので、本番との対応は「ワールド座標の最近傍頂点」で取る。
# 手順:
#   1) 本番メッシュ(07_prod_mesh.blend)を読み込む
#   2) リグ済み FBX を読み込み、アーマチュアをレストにして、Mixamo 側メッシュのワールド座標(m)を得る
#      (読み込み時の単位変換・回転はオブジェクト変換に入るので、ワールド座標で扱えば cm/Y-up の差は消える)
#   3) 形が合っているか確認(高さ・中心の差)。ずれていれば本番側を平行移動・等倍で合わせる
#   4) 本番の各頂点に、Mixamo 側の最近傍 4 頂点の重みを距離逆数で混ぜて移す(= Data Transfer の頂点・最近傍と同等。
#      形状キーを持つメッシュには Data Transfer モディファイアを適用できないので Python で直接書く)
#   5) 重みを正規化(1 頂点 4 本まで)→ 本番メッシュをアーマチュアの子にして Armature モディファイア
#   6) Mixamo 側のメッシュを消し、GLB を書き出す(スキン・形状キー・アニメ)
#   7) 検証: 本番の全頂点が骨に重み>0 / mixamorig:RightHand がある / GLB 再読込で三角形数・形状キー 2 本・アニメ数が一致
#   --anims: 追加のアニメ FBX(Mixamo の "Without Skin")を読み、同じ骨名のアクションとして足す

import bpy, bmesh, json, os, sys
import numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
from n2common import parse_args, log  # noqa: E402

ARGS = parse_args({'rigged': '', 'prod': 'build/enemy/07_prod_mesh.blend', 'out': 'build/enemy/07_rigged.glb',
                   'anims': '', 'prod_name': 'N2E_07_kanrinin'})
P = lambda p: p if os.path.isabs(p) else os.path.join(ROOT, p)   # noqa: E731
MAX_INF = 4
results = []


def rec(name, ok, value, limit):
    results.append(dict(check=name, ok=bool(ok), value=value, limit=limit))
    log(f'{"OK " if ok else "NG "} {name}: {value} (基準 {limit})')


def world_verts(o):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = o.evaluated_get(dg); me = ev.to_mesh()
    n = len(me.vertices)
    co = np.empty(n * 3, np.float32); me.vertices.foreach_get('co', co)
    ev.to_mesh_clear()
    mw = np.array(o.matrix_world, np.float64)
    return co.reshape(-1, 3) @ mw[:3, :3].T + mw[:3, 3]


def main():
    assert ARGS['rigged'], '--rigged <Mixamo のリグ済み FBX> を指定'
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    # 1) 本番メッシュ
    with bpy.data.libraries.load(P(ARGS['prod']), link=False) as (src, dst):
        dst.objects = [ARGS['prod_name']]
    prod = dst.objects[0]
    bpy.context.scene.collection.objects.link(prod)
    prod.hide_set(False); prod.hide_render = False
    keys = [k.name for k in prod.data.shape_keys.key_blocks] if prod.data.shape_keys else []
    # 先に三角形化(形状キーの層も bmesh で一緒に分割される)= GLB 書き出し後と三角形数を厳密に比べられる
    bm = bmesh.new(); bm.from_mesh(prod.data)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3])
    bm.to_mesh(prod.data); bm.free()
    prod_tris = len(prod.data.polygons)
    # 2) リグ済み FBX
    before = set(bpy.data.objects); acts_before = set(bpy.data.actions)
    bpy.ops.import_scene.fbx(filepath=P(ARGS['rigged']), automatic_bone_orientation=False)
    new = [o for o in bpy.data.objects if o not in before]
    arms = [o for o in new if o.type == 'ARMATURE']
    assert len(arms) == 1, f'アーマチュアが 1 つでない: {[o.name for o in arms]}'
    arm = arms[0]
    mxm = [o for o in new if o.type == 'MESH' and len(o.vertex_groups) > 0]
    assert mxm, 'リグ済みメッシュ(頂点グループ付き)が無い'
    src_acts = [a for a in bpy.data.actions if a not in acts_before]
    for f in [x for x in ARGS['anims'].split(',') if x]:
        b4 = set(bpy.data.objects); a4 = set(bpy.data.actions)
        bpy.ops.import_scene.fbx(filepath=P(f), automatic_bone_orientation=False)
        for a in bpy.data.actions:
            if a not in a4:
                a.name = os.path.splitext(os.path.basename(f))[0]; a.use_fake_user = True
                src_acts.append(a)
        for o in bpy.data.objects:
            if o not in b4:
                bpy.data.objects.remove(o, do_unlink=True)
    arm.data.pose_position = 'REST'
    bpy.context.view_layer.update()
    # 3) 形の照合(ワールド m)
    S = np.concatenate([world_verts(o) for o in mxm])
    Wsrc = []
    for o in mxm:
        gi = {g.index: g.name for g in o.vertex_groups}
        for v in o.data.vertices:
            Wsrc.append({gi[g.group]: g.weight for g in v.groups if g.weight > 0 and gi[g.group] in arm.data.bones})
    D = world_verts(prod)
    h_s, h_d = S[:, 2].max() - S[:, 2].min(), D[:, 2].max() - D[:, 2].min()
    c_s, c_d = (S.max(0) + S.min(0)) / 2, (D.max(0) + D.min(0)) / 2
    k = h_s / h_d
    off = c_s - c_d * k
    if abs(k - 1) > 0.01 or np.linalg.norm(off) > 0.01:
        log(f'形のずれを補正: scale {k:.4f}, offset {np.round(off, 4).tolist()}')
        prod.scale = (prod.scale[0] * k, prod.scale[1] * k, prod.scale[2] * k)
        prod.location = Vector(prod.location) * k + Vector(off)
        bpy.context.view_layer.update()
        D = world_verts(prod)
    rec('形の照合(高さの比・中心のずれ m)', abs(k - 1) < 0.05, (round(float(k), 4), round(float(np.linalg.norm(off)), 4)), '比 0.95〜1.05')
    # 4) 最近傍 4 頂点の重みを距離逆数で混ぜる
    kd = KDTree(len(S))
    for i, p in enumerate(S):
        kd.insert(Vector(p), i)
    kd.balance()
    prod.vertex_groups.clear()
    groups = {}
    far = 0
    for vi, p in enumerate(D):
        hits = kd.find_n(Vector(p), 4)
        if hits[0][2] > 0.02:
            far += 1
        acc = {}
        for co, idx, dist in hits:
            w = 1.0 / max(dist, 1e-5)
            for bn, bw in Wsrc[idx].items():
                acc[bn] = acc.get(bn, 0.0) + bw * w
        top = sorted(acc.items(), key=lambda kv: -kv[1])[:MAX_INF]
        tot = sum(w for _, w in top)
        if tot <= 0:
            continue
        for bn, w in top:
            g = groups.get(bn) or prod.vertex_groups.new(name=bn)
            groups[bn] = g
            g.add([vi], w / tot, 'REPLACE')
    rec('最近傍が 2cm より遠い本番頂点', far == 0, far, '0')
    # 5) アーマチュアへ
    mw = prod.matrix_world.copy()
    prod.parent = arm
    prod.matrix_parent_inverse = arm.matrix_world.inverted()
    prod.matrix_world = mw
    for md in list(prod.modifiers):
        prod.modifiers.remove(md)
    am = prod.modifiers.new('Armature', 'ARMATURE'); am.object = arm
    # 6) Mixamo 側メッシュを消して書き出し
    for o in mxm + [o for o in new if o.type not in ('ARMATURE',) and o not in mxm]:
        bpy.data.objects.remove(o, do_unlink=True)
    arm.data.pose_position = 'POSE'
    if src_acts:
        arm.animation_data_create()
        arm.animation_data.action = src_acts[0]
        for a in src_acts[1:]:   # 2 本目以降は NLA に積んで書き出し対象にする
            tr = arm.animation_data.nla_tracks.new(); tr.name = a.name
            tr.strips.new(a.name, int(a.frame_range[0]), a)
    # 検証(書き出し前)
    nz = 0
    for v in prod.data.vertices:
        if sum(g.weight for g in v.groups) <= 0:
            nz += 1
    rec('本番の全頂点が骨に重み>0', nz == 0, f'重みなし {nz} / {len(prod.data.vertices)}', '0')
    rec('mixamorig:RightHand がある', 'mixamorig:RightHand' in arm.data.bones, len(arm.data.bones), 'あり')
    for o in bpy.context.scene.objects:
        o.select_set(o in (arm, prod))
    bpy.context.view_layer.objects.active = arm
    out = P(ARGS['out'])
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_skins=True,
                              export_morph=True, export_animations=bool(src_acts), export_apply=False,
                              export_yup=True)
    # 7) 再読込で照合
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    a_before = set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=out)
    # glTF 読み込みは骨の表示用に Icosphere を作るので、スキン付きのメッシュだけ数える
    gm = [o for o in bpy.data.objects if o.type == 'MESH' and (o.vertex_groups or any(m.type == 'ARMATURE' for m in o.modifiers))]
    tris = 0
    for o in gm:
        o.data.calc_loop_triangles(); tris += len(o.data.loop_triangles)
    gkeys = sorted({kb.name for o in gm if o.data.shape_keys for kb in o.data.shape_keys.key_blocks})
    gacts = [a for a in bpy.data.actions if a not in a_before]
    rec('GLB 再読込: 三角形数', tris == prod_tris, tris, prod_tris)
    rec('GLB 再読込: シェイプキー grin・attack', all(x in gkeys for x in ('grin', 'attack')), gkeys, 'grin, attack')
    rec('GLB 再読込: アニメ数', len(gacts) == len(src_acts), len(gacts), len(src_acts))
    rec('GLB 再読込: 骨', any(o.type == 'ARMATURE' and 'mixamorig:RightHand' in o.data.bones for o in bpy.data.objects),
        sum(len(o.data.bones) for o in bpy.data.objects if o.type == 'ARMATURE'), '65 前後・RightHand あり')
    rep = os.path.splitext(out)[0] + '_report.json'
    json.dump(dict(rigged=ARGS['rigged'], prod=ARGS['prod'], out=os.path.basename(out),
                   mb=round(os.path.getsize(out) / 1e6, 2), keys=keys, results=results), open(rep, 'w'), indent=1, ensure_ascii=False)
    ng = [r for r in results if not r['ok']]
    log(f'merge: {len(results) - len(ng)}/{len(results)} 通過 → {out} ({os.path.getsize(out) / 1e6:.1f} MB)')
    sys.exit(1 if ng else 0)


if __name__ == '__main__':
    main()
