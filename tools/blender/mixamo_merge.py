# mixamo_merge.py — Mixamo のリグ済み FBX(スキン付き 1 本)＋スキンなしアニメ FBX 群を、本番の 1 メッシュ
#   (形状キー grin/attack・13 素材)へ移して GLB を書き出す。ハンマーは右手ボーンに付ける位置を計算して記録する。
#
# 実行: Blender -b --factory-startup -P tools/blender/mixamo_merge.py -- --rigged <スキン付き FBX>
#        [--anims <dir または a.fbx,b.fbx>] [--prod build/enemy/07_prod_mesh.blend] [--out build/enemy/07_rigged.glb]
#        [--hammer build/enemy/hammer.glb] [--keep_idle] [--report docs/enemy-candidates/p2a/check.json]
# 出力: <out>(GLB: メッシュ＋アーマチュア＋形状キー＋アクション)、<out の拡張子なし>_meta.json(ハンマーのオフセット等)、
#       <out の拡張子なし>.blend(レンダ用: ハンマーを右手に付けた状態)、チェック結果 JSON
# 手順:
#   1) 本番メッシュを読み込み、三角形化(形状キーの層も一緒に分割)
#   2) スキン付き FBX を読み込み、レストのワールド座標で本番と形を照合。Mixamo の FBX は中身が cm 扱いで 100 分の 1 に
#      読まれることがあるので、ずれていればアーマチュア側の拡大・平行移動で本番に合わせる(アニメの移動量も一緒に拡大される)
#   3) 本番の各頂点に Mixamo 側の最近傍 4 頂点の重みを距離逆数で移し、1 頂点 4 本までに正規化
#      (形状キー付きメッシュには Data Transfer を適用できないので Python で直接書く = 頂点・最近傍と同等)
#   4) 本番メッシュをアーマチュアの子にして Armature モディファイア。Mixamo 側メッシュは消す
#   5) スキンなしアニメ FBX を読み、骨名(mixamorig:)を照合(違えば ":" 以降で対応付け)、アクション名=ファイル名
#   6) ハンマー: 右手の掌(握り)に原点、柄(+Y)は小指側→人差し指側、頭(+X)は指先方向。RightHand ボーン空間の
#      オフセットを meta に記録し、.blend ではボーンの子にする(GLB には入れない)
#   7) テクスチャを縮める(肌 4096・他 2048)→ GLB 書き出し(スキン・形状キー・アクションを NLA から)
#   8) 検証: 再読込で三角形数・形状キー 2 本・アクション数・各長さ>0 / 重みなし 0 / RightHand / 帽子と髪の追従 /
#      服の貫通 / GLB のノード階層から計算したハンマー位置が Blender と一致

import bpy, bmesh, glob, json, math, os, struct, sys
import numpy as np
from mathutils import Vector, Matrix, Quaternion
from mathutils.kdtree import KDTree
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
from n2common import parse_args, log  # noqa: E402

ARGS = parse_args({'rigged': '', 'prod': 'build/enemy/07_prod_mesh.blend', 'out': 'build/enemy/07_rigged.glb',
                   'anims': '', 'prod_name': 'N2E_07_kanrinin', 'hammer': 'build/enemy/hammer.glb', 'keep_idle': False,
                   'report': '', 'skin_tex': '4096', 'other_tex': '2048'})
P = lambda p: p if os.path.isabs(p) else os.path.join(ROOT, p)   # noqa: E731
MAX_INF = 4
HAND = 'mixamorig:RightHand'
results = []


def rec(name, ok, value, limit):
    results.append(dict(check=name, ok=bool(ok), value=value, limit=limit))
    log(f'{"OK " if ok else "NG "} {name}: {value} (基準 {limit})')


def world_verts(o):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = o.evaluated_get(dg); me = ev.to_mesh()
    n = len(me.vertices)
    co = np.empty(n * 3, np.float32); me.vertices.foreach_get('co', co)
    nr = np.empty(n * 3, np.float32); me.vertices.foreach_get('normal', nr)
    polys = [tuple(p.vertices) for p in me.polygons]; mats = [p.material_index for p in me.polygons]
    ev.to_mesh_clear()
    mw = np.array(o.matrix_world, np.float64)
    w = co.reshape(-1, 3) @ mw[:3, :3].T + mw[:3, 3]
    wn = nr.reshape(-1, 3) @ mw[:3, :3].T
    wn /= np.maximum(np.linalg.norm(wn, axis=1, keepdims=True), 1e-9)
    return w, wn, polys, mats


def import_fbx(path):
    b_o, b_a = set(bpy.data.objects), set(bpy.data.actions)
    bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=False)
    return [o for o in bpy.data.objects if o not in b_o], [a for a in bpy.data.actions if a not in b_a]


def action_fcurves(act):
    if hasattr(act, 'fcurves') and act.fcurves is not None and len(getattr(act, 'fcurves', [])):
        return list(act.fcurves)
    out = []
    for layer in getattr(act, 'layers', []):
        for strip in layer.strips:
            for cb in getattr(strip, 'channelbags', []):
                out += list(cb.fcurves)
    return out


def bone_of(path):
    return path.split('"')[1] if path.startswith('pose.bones["') else None


GRIP_DEG = dict(Index=(50, 75, 50), Middle=(55, 80, 50), Ring=(60, 80, 50), Pinky=(65, 80, 50), Thumb=(15, 30, 25))


def apply_grip(arm, acts, palm_n_world):
    """右手の指をハンマーを握る形に固定する(全アクションの右手指の回転キーを定数で上書き)。
    曲げ軸は「骨の向き × 掌の法線」(指先を掌側へ倒す向き)を骨ローカルへ写したもの。"""
    pn = (arm.matrix_world.to_3x3().inverted() @ palm_n_world).normalized()
    pose = {}
    for f, degs in GRIP_DEG.items():
        for j, d in enumerate(degs, 1):
            b = arm.data.bones.get(f'mixamorig:RightHand{f}{j}')
            if b is None:
                continue
            m3 = b.matrix_local.to_3x3()
            ydir = (m3 @ Vector((0, 1, 0))).normalized()
            ax = (m3.inverted() @ ydir.cross(pn)).normalized()
            pose[b.name] = Quaternion(ax, math.radians(d))
    for act in acts:
        bags = [cb for layer in getattr(act, 'layers', []) for st in layer.strips for cb in getattr(st, 'channelbags', [])]
        f0, f1 = act.frame_range
        for bag in bags:
            for bn, q in pose.items():
                dp = f'pose.bones["{bn}"].rotation_quaternion'
                for fc in [fc for fc in bag.fcurves if fc.data_path == dp]:
                    bag.fcurves.remove(fc)
                for i in range(4):
                    fc = bag.fcurves.new(dp, index=i)
                    fc.group = bag.groups.get(bn) or bag.groups.new(bn)
                    for fr in (f0, f1):
                        fc.keyframe_points.insert(fr, q[i]).interpolation = 'CONSTANT'
    for bn in pose:
        arm.pose.bones[bn].rotation_mode = 'QUATERNION'
    return len(pose)


def main():
    assert ARGS['rigged'], '--rigged <Mixamo のスキン付き FBX> を指定'
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    # 1) 本番メッシュ
    with bpy.data.libraries.load(P(ARGS['prod']), link=False) as (src, dst):
        dst.objects = [ARGS['prod_name']]
    prod = dst.objects[0]
    bpy.context.scene.collection.objects.link(prod)
    prod.hide_set(False); prod.hide_render = False
    keys = [k.name for k in prod.data.shape_keys.key_blocks] if prod.data.shape_keys else []
    bm = bmesh.new(); bm.from_mesh(prod.data)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3])
    bm.to_mesh(prod.data); bm.free()
    prod_tris = len(prod.data.polygons)
    mat_names = [s.material.name if s.material else '' for s in prod.material_slots]
    # 透過は髪・眉・まつ毛の帯だけ。他(特に靴: 元テクスチャのαが FBX 経由で効いて半透明の白になる)は不透明に
    for sl in prod.material_slots:
        m = sl.material
        if m is None or 'strips' in m.name:
            continue
        b = next((n for n in m.node_tree.nodes if n.bl_idname == 'ShaderNodeBsdfPrincipled'), None)
        if b and b.inputs['Alpha'].links:
            for l in list(b.inputs['Alpha'].links):
                m.node_tree.links.remove(l)
            b.inputs['Alpha'].default_value = 1.0
        if hasattr(m, 'surface_render_method'):
            m.surface_render_method = 'DITHERED'
        if hasattr(m, 'blend_method'):
            try:
                m.blend_method = 'OPAQUE'
            except Exception:  # noqa: BLE001
                pass
    # 2) スキン付き FBX
    new, skin_acts = import_fbx(P(ARGS['rigged']))
    arms = [o for o in new if o.type == 'ARMATURE']
    assert len(arms) == 1, f'アーマチュアが 1 つでない: {[o.name for o in arms]}'
    arm = arms[0]
    arm.name = 'N2E_07_rig'; arm.data.name = 'N2E_07_rig'
    mxm = [o for o in new if o.type == 'MESH' and len(o.vertex_groups) > 0]
    assert mxm, 'リグ済みメッシュ(頂点グループ付き)が無い'
    arm.data.pose_position = 'REST'
    if arm.animation_data:
        arm.animation_data.action = None
    bpy.context.view_layer.update()
    S = np.concatenate([world_verts(o)[0] for o in mxm])
    D = world_verts(prod)[0]
    h_s, h_d = np.ptp(S[:, 2]), np.ptp(D[:, 2])
    k = h_s / h_d
    if abs(k - 1) > 0.01:      # Mixamo 側が 1/100 などで読まれた → アーマチュアを拡大して本番に合わせる
        arm.scale = tuple(v / k for v in arm.scale)
        bpy.context.view_layer.update()
        S = np.concatenate([world_verts(o)[0] for o in mxm])
    off = (D.max(0) + D.min(0)) / 2 - (S.max(0) + S.min(0)) / 2
    if np.linalg.norm(off) > 0.002:
        arm.location = Vector(arm.location) + Vector(off)
        bpy.context.view_layer.update()
        S = np.concatenate([world_verts(o)[0] for o in mxm])
    rec('形の照合(読込時の高さ比・補正後の中心ずれ m)', np.linalg.norm((D.max(0) + D.min(0)) / 2 - (S.max(0) + S.min(0)) / 2) < 0.005,
        dict(height_ratio=round(float(k), 5), arm_scale=round(arm.scale[0], 5), offset=[round(float(v), 4) for v in off]), '中心ずれ <5mm')
    Wsrc = []
    for o in mxm:
        gi = {g.index: g.name for g in o.vertex_groups}
        for v in o.data.vertices:
            Wsrc.append({gi[g.group]: g.weight for g in v.groups if g.weight > 0 and gi[g.group] in arm.data.bones})
    # 3) 重みの移植
    kd = KDTree(len(S))
    for i, p in enumerate(S):
        kd.insert(Vector(p), i)
    kd.balance()
    prod.vertex_groups.clear()
    groups, far = {}, 0
    for vi, p in enumerate(D):
        hits = kd.find_n(Vector(p), 4)
        far += hits[0][2] > 0.02
        acc = {}
        for co, idx, dist in hits:
            w = 1.0 / max(dist, 1e-5)
            for bn, bw in Wsrc[idx].items():
                acc[bn] = acc.get(bn, 0.0) + bw * w
        top = sorted(acc.items(), key=lambda kv: -kv[1])[:MAX_INF]
        tot = sum(w for _, w in top)
        for bn, w in top:
            if tot <= 0:
                break
            g = groups.get(bn) or prod.vertex_groups.new(name=bn)
            groups[bn] = g
            g.add([vi], w / tot, 'REPLACE')
    rec('最近傍が 2cm より遠い本番頂点', far == 0, int(far), '0')
    # 4) アーマチュアの子へ
    mw = prod.matrix_world.copy()
    prod.parent = arm
    prod.matrix_parent_inverse = arm.matrix_world.inverted()
    prod.matrix_world = mw
    for md in list(prod.modifiers):
        prod.modifiers.remove(md)
    am = prod.modifiers.new('Armature', 'ARMATURE'); am.object = arm
    for o in new:
        if o is not arm:
            bpy.data.objects.remove(o, do_unlink=True)
    nz = sum(1 for v in prod.data.vertices if sum(g.weight for g in v.groups) <= 0)
    rec('重みなし頂点', nz == 0, f'{nz} / {len(prod.data.vertices)}', '0')
    rec('mixamorig:RightHand がある', HAND in arm.data.bones, len(arm.data.bones), 'あり')
    # 5) アニメ
    files = []
    if ARGS['anims']:
        a = P(ARGS['anims'])
        files = sorted(glob.glob(os.path.join(a, '*.fbx'))) if os.path.isdir(a) else [P(x) for x in ARGS['anims'].split(',') if x]
    files = [f for f in files if os.path.abspath(f) != os.path.abspath(P(ARGS['rigged']))]
    acts = []
    if ARGS['keep_idle'] and skin_acts:
        skin_acts[0].name = os.path.splitext(os.path.basename(ARGS['rigged']))[0].replace('_skin', '')
        acts.append(skin_acts[0])
    else:
        for a in skin_acts:
            bpy.data.actions.remove(a)
    bonenames = set(arm.data.bones.keys())
    mism_total = {}
    for f in files:
        objs, nacts = import_fbx(f)
        assert nacts, f'アクションが無い: {f}'
        act = nacts[0]
        name = os.path.splitext(os.path.basename(f))[0]
        act.name = name
        act.use_fake_user = True
        miss = set()
        for fc in action_fcurves(act):
            b = bone_of(fc.data_path)
            if b and b not in bonenames:
                alt = 'mixamorig:' + b.split(':')[-1]
                if alt in bonenames:
                    fc.data_path = fc.data_path.replace(f'"{b}"', f'"{alt}"')
                else:
                    miss.add(b)
        if miss:
            mism_total[name] = sorted(miss)
        for a in nacts[1:]:
            bpy.data.actions.remove(a)
        for o in objs:
            d = o.data
            bpy.data.objects.remove(o, do_unlink=True)
            if d is not None and getattr(d, 'users', 1) == 0:
                (bpy.data.armatures if isinstance(d, bpy.types.Armature) else bpy.data.meshes).remove(d)
        acts.append(act)
    rec('アニメの骨名が全て一致(mixamorig:)', not mism_total, mism_total or '全一致', '不一致なし')
    arm.animation_data_create()
    arm.animation_data.action = None
    for act in acts:
        tr = arm.animation_data.nla_tracks.new(); tr.name = act.name
        st = tr.strips.new(act.name, int(act.frame_range[0]), act)
        if hasattr(st, 'action_slot') and getattr(act, 'slots', None) and len(act.slots):
            st.action_slot = act.slots[0]
        tr.mute = True
    arm['n2_actions'] = [a.name for a in acts]
    # 6) ハンマー(右手)
    meta = dict(units='m', up='+Y (glTF)', glb=os.path.basename(P(ARGS['out'])), mesh_node=prod.name, armature_node=arm.name,
                actions={a.name: dict(frames=[int(a.frame_range[0]), int(a.frame_range[1])], fps=30,
                                      seconds=round((a.frame_range[1] - a.frame_range[0]) / 30, 3)) for a in acts},
                shape_keys=[k_ for k_ in keys if k_ != 'Basis'])
    hammer = None
    if ARGS['hammer'] and os.path.exists(P(ARGS['hammer'])):
        b_o = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=P(ARGS['hammer']))
        hobjs = [o for o in bpy.data.objects if o not in b_o]
        hammer = next(o for o in hobjs if o.type == 'MESH')
        for o in hobjs:
            if o is not hammer:
                bpy.data.objects.remove(o, do_unlink=True)
        hammer.parent = None
        hammer.matrix_world = Matrix.Identity(4)
        hammer.name = 'N2E_hammer'
        arm.data.pose_position = 'REST'; bpy.context.view_layer.update()
        H = lambda n: arm.matrix_world @ arm.data.bones[n].head_local
        hand, mid, idx, pin = H(HAND), H('mixamorig:RightHandMiddle1'), H('mixamorig:RightHandIndex1'), H('mixamorig:RightHandPinky1')
        across = (idx - pin).normalized()                 # 小指の付け根 → 人差し指の付け根
        fdir = (mid - hand).normalized()                  # 指先方向
        palm_n = across.cross(fdir).normalized()
        if palm_n.z > 0:                                  # A ポーズでは掌は下(-Z)を向く
            palm_n = -palm_n
        grip = hand.lerp(mid, 0.75) + palm_n * 0.025      # 掌の中央から指の内側へ = 握った拳の中
        ydir = -across                                    # 実測: 拳の親指・人差し指側が上に来る持ち方では、頭はこちら側
        xdir = (fdir - ydir * fdir.dot(ydir)).normalized()
        zdir = xdir.cross(ydir)
        Mh = Matrix((xdir, ydir, zdir)).transposed().to_4x4(); Mh.translation = grip
        bone_rest = arm.matrix_world @ arm.data.bones[HAND].matrix_local
        off_m = bone_rest.inverted() @ Mh                 # .blend 用(GLB 用のオフセットは書き出し後に GLB の骨階層から出す)
        hammer.parent = arm; hammer.parent_type = 'BONE'; hammer.parent_bone = HAND
        bpy.context.view_layer.update()
        L = arm.data.bones[HAND].length
        hammer.matrix_parent_inverse = Matrix.Identity(4)
        hammer.matrix_basis = Matrix.Translation((0, -L, 0)) @ off_m
        bpy.context.view_layer.update()
        err = (hammer.matrix_world.translation - Mh.translation).length
        rec('ハンマー: ボーンの子にした位置の誤差(m)', err < 1e-4, round(err, 7), '<0.0001')
        hammer['n2_no_export'] = True
        ng = apply_grip(arm, acts, palm_n)
        rec('右手の指を握り形に固定(骨数)', ng == 15, ng, '15')
    arm['n2_candidate'] = '07'
    arm.data.pose_position = 'POSE'
    # 7) テクスチャを縮めて GLB
    for img in bpy.data.images:
        if img.size[0] == 0:
            continue
        lim = int(ARGS['skin_tex']) if 'skin' in img.name.lower() else int(ARGS['other_tex'])
        if max(img.size) > lim:
            k_ = lim / max(img.size)
            img.scale(int(img.size[0] * k_), int(img.size[1] * k_))
    for o in bpy.context.scene.objects:
        o.select_set(o in (arm, prod))
    bpy.context.view_layer.objects.active = arm
    out = P(ARGS['out'])
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_skins=True,
                              export_morph=True, export_animations=True, export_animation_mode='ACTIONS',
                              export_anim_slide_to_zero=True, export_apply=False, export_yup=True,
                              export_image_format='AUTO', export_def_bones=False)
    mb = os.path.getsize(out) / 1e6
    rec('GLB サイズ(MB)', mb <= 40, round(mb, 1), '≤40')
    # レンダ用 .blend(ハンマー付き。アクションは NLA のミュートで保持)
    bpy.ops.file.pack_all()
    blend = os.path.splitext(out)[0] + '.blend'
    bpy.ops.wm.save_as_mainfile(filepath=blend, compress=True)
    # 8a) 追従と貫通(.blend 側)
    follow_checks(arm, prod, mat_names, acts)
    # 8b) GLB のノード階層からハンマー位置を再計算(Three.js と同じ計算)
    if hammer is not None:
        glb_hammer_offset(out, Mh, meta)
    # 8c) 再読込
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    a_before = set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=out)
    gm = [o for o in bpy.data.objects if o.type == 'MESH' and (o.vertex_groups or any(m.type == 'ARMATURE' for m in o.modifiers))]
    tris = 0
    for o in gm:
        o.data.calc_loop_triangles(); tris += len(o.data.loop_triangles)
    gkeys = sorted({kb.name for o in gm if o.data.shape_keys for kb in o.data.shape_keys.key_blocks})
    gacts = [a for a in bpy.data.actions if a not in a_before]
    rec('GLB 再読込: 三角形数', tris == prod_tris, tris, prod_tris)
    rec('GLB 再読込: シェイプキー grin・attack', all(x in gkeys for x in ('grin', 'attack')), gkeys, 'grin, attack')
    rec('GLB 再読込: アクション数', len(gacts) == len(acts), len(gacts), len(acts))
    rec('GLB 再読込: 各アクションの長さ>0', all(a.frame_range[1] > a.frame_range[0] for a in gacts),
        {a.name.split('.')[0]: round(a.frame_range[1] - a.frame_range[0], 1) for a in gacts}, '>0')
    anames = sorted(a_.get('name', '') for a_ in glb_nodes(out).get('animations', []))   # GLB 内の名前(読込側の .001 付番を避ける)
    rec('GLB のアニメ名=ファイル名', anames == sorted(x.name for x in acts), anames, 'ファイル名(拡張子なし)')
    rec('GLB 再読込: RightHand', any(o.type == 'ARMATURE' and HAND in o.data.bones for o in bpy.data.objects),
        sum(len(o.data.bones) for o in bpy.data.objects if o.type == 'ARMATURE'), 'あり')
    meta['tris'] = prod_tris
    meta['root_motion_m'] = glb_root_motion(out)   # Hips の移動量(始→終, Hips 親=N2E_07_rig 空間)。0 でないものはルートモーション入り
    meta['nodes'] = sorted(n.get('name', '') for n in glb_nodes(out)['nodes'] if not n.get('name', '').startswith('mixamorig:'))  # GLB の実ノード(骨以外)
    with open(os.path.splitext(out)[0] + '_meta.json', 'w') as f:
        json.dump(meta, f, indent=1, ensure_ascii=False)
    rep = P(ARGS['report']) if ARGS['report'] else os.path.splitext(out)[0] + '_report.json'
    os.makedirs(os.path.dirname(rep), exist_ok=True)
    json.dump(dict(rigged=os.path.basename(ARGS['rigged']), out=os.path.basename(out), mb=round(mb, 2), keys=keys,
                   results=results), open(rep, 'w'), indent=1, ensure_ascii=False)
    ng = [r for r in results if not r['ok']]
    log(f'merge: {len(results) - len(ng)}/{len(results)} 通過 → {out} ({mb:.1f} MB)')
    sys.exit(1 if ng else 0)


def set_action(arm, act, frame):
    arm.animation_data.action = act
    if hasattr(arm.animation_data, 'action_slot') and getattr(act, 'slots', None) and len(act.slots):
        arm.animation_data.action_slot = act.slots[0]
    bpy.context.scene.frame_set(int(frame))
    bpy.context.view_layer.update()


def follow_checks(arm, prod, mat_names, acts):
    """帽子と髪が頭に追従するか(look_nervous の最大首振り)・服の貫通(walk_careful の中間)。"""
    byname = {a.name: a for a in acts}
    mats = np.array([p.material_index for p in prod.data.polygons])
    pv = [tuple(p.vertices) for p in prod.data.polygons]
    def verts_of(pred):
        s = set()
        for p, mi in zip(pv, mats):
            if pred(mat_names[mi]):
                s.update(p)
        return np.array(sorted(s))
    skin = verts_of(lambda n: n.endswith('.body_fbx'))
    cap = verts_of(lambda n: '_cap_' in n)
    hair = verts_of(lambda n: 'hair_strips' in n)
    arm.data.pose_position = 'REST'; arm.animation_data.action = None; bpy.context.view_layer.update()
    W0, N0, _, _ = world_verts(prod)
    top = skin[np.argmax(W0[skin, 2])]
    cap_near = cap[np.argmin(np.linalg.norm(W0[cap] - W0[top], axis=1))]
    nape = skin[np.argmin(np.abs(W0[skin, 2] - (W0[top, 2] - 0.15)) + np.abs(W0[skin, 0]) * 5 - W0[skin, 1] * 2)]
    hair_near = hair[np.argmin(np.linalg.norm(W0[hair] - W0[nape], axis=1))]
    d_cap0 = np.linalg.norm(W0[cap_near] - W0[top]); d_hair0 = np.linalg.norm(W0[hair_near] - W0[nape])
    arm.data.pose_position = 'POSE'
    if 'look_nervous' in byname:
        act = byname['look_nervous']
        hb = arm.pose.bones['mixamorig:Head']
        best, bf = -1, int(act.frame_range[0])
        for f in range(int(act.frame_range[0]), int(act.frame_range[1]) + 1, 2):
            set_action(arm, act, f)
            q = (arm.matrix_world @ hb.matrix).to_quaternion()
            arm.data.pose_position = 'REST'; bpy.context.view_layer.update()
            q0 = (arm.matrix_world @ hb.matrix).to_quaternion()
            arm.data.pose_position = 'POSE'; bpy.context.view_layer.update()
            ang = q0.rotation_difference(q).angle
            if ang > best:
                best, bf = ang, f
        set_action(arm, act, bf)
        W1 = world_verts(prod)[0]
        dc = np.linalg.norm(W1[cap_near] - W1[top]) - d_cap0
        dh = np.linalg.norm(W1[hair_near] - W1[nape]) - d_hair0
        rec('帽子の追従(look_nervous 最大首振り: 頭頂〜帽子内側の距離の変化 mm)', abs(dc) <= 0.005,
            dict(frame=bf, head_turn_deg=round(math.degrees(best), 1), cap=round(dc * 1000, 2), hair=round(dh * 1000, 2)), '±5')
        rec('髪の追従(同フレーム: うなじ〜髪の距離の変化 mm)', abs(dh) <= 0.005, round(dh * 1000, 2), '±5')
    if 'walk_careful' in byname:
        act = byname['walk_careful']
        fm = int((act.frame_range[0] + act.frame_range[1]) / 2)
        set_action(arm, act, fm)
        W, Nn, polys, pm = world_verts(prod)
        cov_faces = [p for p, mi in zip(polys, pm) if 'coverall' in mat_names[mi]]
        bvh = BVHTree.FromPolygons([Vector(v) for v in W], cov_faces)
        cnt = 0
        for i in skin:
            p, n = Vector(W[i]), Vector(Nn[i])
            hit = bvh.ray_cast(p - n * 0.0005, -n, 0.015)
            if hit[0] is not None and hit[1].dot(n) > 0.3:
                cnt += 1
        rec('服の貫通(walk_careful 中間フレーム: 服の外に出た肌の頂点)', cnt == 0, dict(frame=fm, verts=cnt), '0')
    arm.animation_data.action = None


def glb_nodes(path):
    with open(path, 'rb') as f:
        data = f.read()
    ln = struct.unpack_from('<I', data, 12)[0]
    return json.loads(data[20:20 + ln])


def glb_root_motion(path):
    with open(path, 'rb') as f:
        b = f.read()
    ln = struct.unpack_from('<I', b, 12)[0]
    j = json.loads(b[20:20 + ln]); base = 20 + ln + 8
    hip = next(i for i, n in enumerate(j['nodes']) if n.get('name') == 'mixamorig:Hips')
    def acc(i):
        a = j['accessors'][i]; v = j['bufferViews'][a['bufferView']]
        off = base + v.get('byteOffset', 0) + a.get('byteOffset', 0)
        return struct.unpack_from('<3f', b, off), struct.unpack_from('<3f', b, off + (a['count'] - 1) * 12)
    out = {}
    for an in j.get('animations', []):
        for ch in an['channels']:
            if ch['target'].get('node') == hip and ch['target']['path'] == 'translation':
                v0, v1 = acc(an['samplers'][ch['sampler']]['output'])
                out[an['name']] = [round(v1[k] - v0[k], 3) for k in range(3)]
    return out


def trs(n):
    t = Vector(n.get('translation', [0, 0, 0])); r = n.get('rotation', [0, 0, 0, 1]); s = n.get('scale', [1, 1, 1])
    return Matrix.Translation(t) @ Quaternion((r[3], r[0], r[1], r[2])).to_matrix().to_4x4() @ Matrix.Diagonal((*s, 1))


def glb_hammer_offset(path, Mh_blender, meta):
    """GLB のノード階層(レスト)で RightHand のワールド行列 M を求め、ハンマーの GLB 座標でのワールド行列から
    オフセット off = M⁻¹ · H を出す(Three.js の handBone.add(hammer) にそのまま使える値)。
    hammer.glb は export_yup=False(Blender 座標のまま)なので、ハンマー自身の軸は変換しない。"""
    js = glb_nodes(path)
    nodes = js['nodes']
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get('children', []):
            parent[c] = i
    idx = next(i for i, n in enumerate(nodes) if n.get('name') == HAND)
    M = Matrix.Identity(4); i = idx
    while i is not None:
        M = trs(nodes[i]) @ M
        i = parent.get(i)
    C = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))   # Blender(Z-up) → glTF(Y-up)
    H = C @ Mh_blender
    off = M.inverted() @ H
    t, q, sc = off.decompose()
    meta['hammer'] = dict(file='hammer.glb', parent_bone=HAND, position_m=[round(v, 6) for v in t],
                          quaternion_xyzw=[round(q.x, 6), round(q.y, 6), round(q.z, 6), round(q.w, 6)],
                          scale=[round(v, 4) for v in sc],
                          note='three.js: const h = (hammer.glb の scene); h.position.fromArray(position_m); '
                               'h.quaternion.fromArray(quaternion_xyzw); h.scale.fromArray(scale); handBone.add(h)。'
                               'ハンマーの原点=握り、+Y=柄尻→頭、+X=頭の長さ方向(hammer.glb は Z-up のまま書き出してある)')
    # 検算: オフセットを掛け直した握り位置が Blender と一致
    g = (M @ off).translation
    b = Mh_blender.translation
    err = (g - Vector((b.x, b.z, -b.y))).length
    rec('ハンマー: GLB の骨階層＋オフセットで再計算した握り位置と Blender の差(m)', err < 1e-4, round(err, 7), '<0.0001')
    rec('ハンマー: オフセットの拡大率が 1(GLB の単位 m)', max(abs(v - 1) for v in sc) < 0.01, [round(v, 4) for v in sc], '1')


if __name__ == '__main__':
    main()
