# mixamo_dummy.py — 通しテスト用の「Mixamo から戻ってきた風」のリグ済み FBX を自作する(本物が無い段階の代用)。
#
# 実行: Blender -b --factory-startup -P tools/blender/mixamo_dummy.py -- [--out build/enemy/_dummy_mixamo_rigged.fbx]
# 作るもの: 07_mixamo_lite.fbx のメッシュ ＋ Mixamo 規約の骨 65 本(mixamorig:Hips 以下、指先・頭頂・つま先の末端骨を含む)
#   ＋ 最寄りの骨に重み 1 の頂点ウェイト ＋ 短いアニメ 1 本(腰と右腕が動く)。
#   Mixamo の書き出しに似せて、オブジェクトは X 軸 90° 回転・スケール 0.01(中身は cm)、メッシュ名も変える。
# 骨の位置は 07 の .blend(MPFB の default リグ、レスト)から対応付けて取る。

import bpy, json, math, os, sys
import numpy as np
from mathutils import Vector, Matrix
from mathutils.kdtree import KDTree

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
from n2common import parse_args, log  # noqa: E402

ARGS = parse_args({'lite': 'build/enemy/07_mixamo_lite.fbx', 'rig_blend': 'build/enemy/07_kanrinin_final.blend',
                   'out': 'build/enemy/_dummy_mixamo_rigged.fbx'})

FINGERS = [('Thumb', 1), ('Index', 2), ('Middle', 3), ('Ring', 4), ('Pinky', 5)]


def mpfb_rest_bones():
    with bpy.data.libraries.load(os.path.join(ROOT, ARGS['rig_blend']), link=False) as (src, dst):
        dst.objects = [n for n in src.objects if n.startswith('N2E_07') and '.' not in n]
    rig = next(o for o in dst.objects if o and o.type == 'ARMATURE')
    out = {b.name: (rig.matrix_world @ b.head_local, rig.matrix_world @ b.tail_local) for b in rig.data.bones}
    bpy.data.objects.remove(rig)
    return out


def mixamo_layout(B):
    """Mixamo の骨名 → (head, tail, parent)。"""
    H = lambda n: B[n][0].copy()
    T = lambda n: B[n][1].copy()
    L = {}
    L['Hips'] = (H('spine05'), H('spine04'), None)
    L['Spine'] = (H('spine04'), H('spine03'), 'Hips')
    L['Spine1'] = (H('spine03'), H('spine02'), 'Spine')
    L['Spine2'] = (H('spine02'), T('spine01'), 'Spine1')
    L['Neck'] = (H('neck01'), H('head'), 'Spine2')
    L['Head'] = (H('head'), T('head'), 'Neck')
    L['HeadTop_End'] = (T('head'), T('head') + Vector((0, 0, 0.05)), 'Head')
    for side, s in (('Left', 'L'), ('Right', 'R')):
        L[f'{side}Shoulder'] = (H(f'clavicle.{s}'), T(f'clavicle.{s}'), 'Spine2')
        L[f'{side}Arm'] = (H(f'upperarm01.{s}'), H(f'lowerarm01.{s}'), f'{side}Shoulder')
        L[f'{side}ForeArm'] = (H(f'lowerarm01.{s}'), H(f'wrist.{s}'), f'{side}Arm')
        L[f'{side}Hand'] = (H(f'wrist.{s}'), H(f'finger3-1.{s}'), f'{side}ForeArm')
        for fn, fi in FINGERS:
            par = f'{side}Hand'
            for k in (1, 2, 3):
                b = f'finger{fi}-{k}.{s}'
                L[f'{side}Hand{fn}{k}'] = (H(b), T(b), par)
                par = f'{side}Hand{fn}{k}'
            t3 = T(f'finger{fi}-3.{s}'); d = (T(f'finger{fi}-3.{s}') - H(f'finger{fi}-3.{s}')).normalized()
            L[f'{side}Hand{fn}4'] = (t3, t3 + d * 0.01, par)
        L[f'{side}UpLeg'] = (H(f'upperleg01.{s}'), H(f'lowerleg01.{s}'), 'Hips')
        L[f'{side}Leg'] = (H(f'lowerleg01.{s}'), H(f'foot.{s}'), f'{side}UpLeg')
        L[f'{side}Foot'] = (H(f'foot.{s}'), T(f'foot.{s}'), f'{side}Leg')
        L[f'{side}ToeBase'] = (T(f'foot.{s}'), T(f'foot.{s}') + Vector((0, -0.05, 0)), f'{side}Foot')
        L[f'{side}Toe_End'] = (T(f'foot.{s}') + Vector((0, -0.05, 0)), T(f'foot.{s}') + Vector((0, -0.08, 0)), f'{side}ToeBase')
    return {'mixamorig:' + k: (h, t, ('mixamorig:' + p) if p else None) for k, (h, t, p) in L.items()}


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-12)))
    return (p - (a + ab * t)).length


def main():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    B = mpfb_rest_bones()
    lay = mixamo_layout(B)
    assert len(lay) == 65, len(lay)
    bpy.ops.import_scene.fbx(filepath=os.path.join(ROOT, ARGS['lite']))
    mesh = next(o for o in bpy.data.objects if o.type == 'MESH')
    mesh.name = 'Mesh'                                   # Mixamo は名前を変える
    arm_d = bpy.data.armatures.new('Armature')
    arm = bpy.data.objects.new('Armature', arm_d)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    for name, (h, t, p) in lay.items():
        eb = arm_d.edit_bones.new(name); eb.head = h; eb.tail = t
    for name, (h, t, p) in lay.items():
        if p:
            arm_d.edit_bones[name].parent = arm_d.edit_bones[p]
    bpy.ops.object.mode_set(mode='OBJECT')
    # 最寄りの骨(末端骨を除く)に重み 1
    deform = [n for n in lay if not n.endswith(('4', '_End'))]
    for n in deform:
        mesh.vertex_groups.new(name=n)
    segs = [(n, lay[n][0], lay[n][1]) for n in deform]
    for v in mesh.data.vertices:
        p = mesh.matrix_world @ v.co
        best = min(segs, key=lambda s: seg_dist(p, s[1], s[2]))
        mesh.vertex_groups[best[0]].add([v.index], 1.0, 'REPLACE')
    # Mixamo 風の変換: X 90°・スケール 0.01(見た目のワールド位置は同じ。中身は cm・Y-up 相当になる)
    arm.rotation_euler = (math.radians(90), 0, 0); arm.scale = (0.01, 0.01, 0.01)
    bpy.context.view_layer.update()
    inv = arm.matrix_world.inverted()
    arm_d.transform(inv)
    mesh.data.transform(inv @ mesh.matrix_world)
    mesh.parent = arm
    mesh.matrix_parent_inverse = Matrix.Identity(4)
    mesh.matrix_basis = Matrix.Identity(4)
    md = mesh.modifiers.new('Armature', 'ARMATURE'); md.object = arm
    # 短いアニメ(腰が少し沈み、右腕が上がる)
    arm.animation_data_create()
    act = bpy.data.actions.new('mixamo.com')
    arm.animation_data.action = act
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='POSE')
    for f, ang, dz in ((1, 0, 0), (15, -60, -5), (30, 0, 0)):
        pb = arm.pose.bones['mixamorig:RightArm']; pb.rotation_mode = 'XYZ'
        pb.rotation_euler = (math.radians(ang), 0, 0); pb.keyframe_insert('rotation_euler', frame=f)
        hp = arm.pose.bones['mixamorig:Hips']; hp.location = (0, dz, 0); hp.keyframe_insert('location', frame=f)
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.context.scene.frame_start, bpy.context.scene.frame_end = 1, 30
    for o in bpy.context.scene.objects:
        o.select_set(o in (arm, mesh))
    out = os.path.join(ROOT, ARGS['out'])
    bpy.ops.export_scene.fbx(filepath=out, use_selection=True, object_types={'ARMATURE', 'MESH'}, add_leaf_bones=False,
                             bake_anim=True, bake_anim_use_all_actions=True, bake_anim_use_nla_strips=False, path_mode='STRIP')
    log(f'dummy mixamo: {len(lay)} bones, {len(mesh.data.vertices)} verts → {out}')


if __name__ == '__main__':
    main()
