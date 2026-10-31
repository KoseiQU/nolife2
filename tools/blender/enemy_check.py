# enemy_check.py — P1b の機械チェック(確定像 07)。失敗があれば非0終了。
#
# 実行: Blender -b build/enemy/07_kanrinin_final.blend -P tools/blender/enemy_check.py -- [--out docs/enemy-candidates/p1b/check.json]
#  1) 身長 1.80±0.02m(レスト・素の体。帽子・髪は含めない)
#  2) 三角形数 ≤ 60k(FBX を読み直して数える。髪の帯を含む)
#  3) テクスチャ ≤ 4096px(.blend で書き出し対象が使う画像と、FBX に埋め込まれた画像の両方)
#  4) FBX 再読込: メッシュごとの頂点数・素材数が書き出し時の記録(*_export.json)と一致
#  5) 突き抜け: ポーズ後の肌の頂点が、つなぎ・帽子の外に出ていない(肌の法線の内向きに 15mm 以内で
#     衣服の面に当たり、その面が肌と同じ向き = 衣服が肌の内側にある、を「突き抜け」と数える)= 0
#  6) 眼球: 虹彩テクスチャ(彩度のある画素)の平均が灰白でない(暗く・色がある)
#  7) 帽子: つばの下端が目の中心より上(正面の目線)。さらに正面(3.2m/目の高さ)と覗き穴(0.6m/1.50m)から
#     目の中心へのレイが帽子に遮られない
#  8) 帽子のクラウンの高さ(下の帯の上端〜天井)≤ 60mm
#  9) ハンマー: 三角形 ≤3k・全長 0.38〜0.42m・テクスチャ ≤2048・原点=握り・hammer.fbx/.glb が読み直せる
# 10) FBX の体に形状キー grin があり、値 1 で口まわりが ≥8mm 動く

import bpy, json, math, os, sys
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
from n2common import parse_args, log  # noqa: E402

ARGS = parse_args({'out': 'docs/enemy-candidates/p1b/check.json'})
results = []


def rec(name, ok, value, limit):
    results.append(dict(check=name, ok=bool(ok), value=value, limit=limit))
    log(f'{"OK " if ok else "NG "} {name}: {value} (基準 {limit})')


rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE' and 'n2_candidate' in o)
cid = rig['n2_candidate']
body = next(o for o in rig.children if o.name.endswith('.body'))
blend_dir = os.path.dirname(bpy.data.filepath)
name = os.path.splitext(os.path.basename(bpy.data.filepath))[0]
export = json.load(open(os.path.join(blend_dir, name + '_export.json')))

# 1) 身長
rig.data.pose_position = 'REST'
saved = [(m, m.show_viewport) for m in body.modifiers
         if m.type == 'SUBSURF' or (m.type == 'MASK' and m.vertex_group != 'body')]   # 補助形状の隠しは残す
for m, _ in saved:
    m.show_viewport = False
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()
me = body.evaluated_get(dg).to_mesh()
zs = np.array([(body.matrix_world @ v.co).z for v in me.vertices])
height = float(zs.max() - zs.min())
body.evaluated_get(dg).to_mesh_clear()
for m, v in saved:
    m.show_viewport = v
rec('身長(m)', abs(height - 1.80) <= 0.02, round(height, 3), '1.80±0.02')

# 3a) .blend 側のテクスチャ
exp_objs = [o for o in rig.children if o.type == 'MESH' and not o.get('n2_no_export')]
imgs = set()
for o in exp_objs:
    for s in o.material_slots:
        if not s.material:
            continue
        stack = [s.material.node_tree]
        while stack:
            nt = stack.pop()
            for n in nt.nodes:
                if n.bl_idname == 'ShaderNodeTexImage' and n.image:
                    imgs.add(n.image)
                if n.bl_idname == 'ShaderNodeGroup' and n.node_tree:
                    stack.append(n.node_tree)
big = max(max(i.size) for i in imgs)
rec('テクスチャ最大(.blend, px)', big <= 4096, int(big), '≤4096')

# 5) 突き抜け(ポーズ後)
rig.data.pose_position = 'POSE'
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()


def eval_world(o):
    ev = o.evaluated_get(dg)
    m = ev.to_mesh()
    co = [o.matrix_world @ v.co for v in m.vertices]
    nr = [(o.matrix_world.to_3x3() @ v.normal).normalized() for v in m.vertices]
    polys = [tuple(p.vertices) for p in m.polygons]
    mats = [p.material_index for p in m.polygons]
    ev.to_mesh_clear()
    return co, nr, polys, mats


garments = [o for o in rig.children if o.type == 'MESH' and (o.name.endswith('coveralls_1') or o.name.endswith('.cap'))]
bco, bnr, _, _ = eval_world(body)
pen = {}
for g in garments:
    gco, _, gpol, _ = eval_world(g)
    bvh = BVHTree.FromPolygons(gco, gpol)
    cnt = 0
    for p, n in zip(bco, bnr):
        hit = bvh.ray_cast(p - n * 0.0005, -n, 0.015)
        if hit[0] is not None and hit[1].dot(n) > 0.3:
            cnt += 1
    pen[g.name.split('.')[-1]] = cnt
rec('肌の突き抜け(頂点数)', sum(pen.values()) == 0, pen, '0')

# 6) 虹彩
eyes = next(o for o in rig.children if o.name.endswith('high-poly'))
eimg = next(n.image for n in eyes.material_slots[0].material.node_tree.nodes if n.bl_idname == 'ShaderNodeTexImage' and n.image)
w, h = eimg.size
px = np.empty(w * h * 4, np.float32); eimg.pixels.foreach_get(px); px = px.reshape(-1, 4)[:, :3]
mx, mn = px.max(1), px.min(1)
sat = np.where(mx > 1e-4, (mx - mn) / np.maximum(mx, 1e-4), 0)
iris = px[sat > 0.40]   # 虹彩(焦げ茶)は彩度が高い。白目・背景(黄ばんだ灰白)は 0.3 未満
mean = iris.mean(0) if len(iris) else np.array([1, 1, 1])
lum = float(mean @ np.array([0.2126, 0.7152, 0.0722]))
msat = float((mean.max() - mean.min()) / max(mean.max(), 1e-4))
rec('虹彩の平均色(灰白でない)', lum < 0.35 and msat > 0.2 and len(iris) > 0.02 * len(px),
    dict(rgb=[round(float(c), 3) for c in mean], lum=round(lum, 3), sat=round(msat, 2), share=round(len(iris) / len(px), 3)),
    '輝度<0.35・彩度>0.2')

# 7) 帽子のつば
cap = next(o for o in rig.children if o.name.endswith('.cap'))
cco, _, cpol, cmat = eval_world(cap)
brim_v = {v for p, mi in zip(cpol, cmat) if mi == 2 for v in p}
eyeL = rig.matrix_world @ rig.pose.bones['eye.L'].head
eyeR = rig.matrix_world @ rig.pose.bones['eye.R'].head
eye_z = (eyeL.z + eyeR.z) / 2
front = [cco[i] for i in brim_v if abs(cco[i].x - rig.matrix_world.translation.x) < 0.09 and cco[i].y < eyeL.y]
low = min(p.z for p in front)
rec('つば下端 − 目の中心(m)', low > eye_z, round(low - eye_z, 4), '> 0')
bvh = BVHTree.FromPolygons(cco, cpol)
blocked = []
for label, dist, hgt in (('正面3.2m', 3.2, eye_z), ('廊下の目線1.62m', 3.2, 1.62), ('覗き穴0.6m', 0.6, 1.50)):
    for e in (eyeL, eyeR):
        cam = Vector((e.x, e.y - dist, hgt))
        d = e - cam
        hit = bvh.ray_cast(cam, d.normalized(), d.length - 0.01)
        if hit[0] is not None:
            blocked.append(label)
rec('目へのレイが帽子に遮られない', not blocked, blocked or 'なし', 'なし')

# 8) 帽子のクラウンの高さ(下の帯の上端〜天井、レスト)
rig.data.pose_position = 'REST'; bpy.context.view_layer.update(); dg = bpy.context.evaluated_depsgraph_get()
upv = np.array(cap['n2_cap_up']); dpl = cap['n2_cap_d']; band = cap['n2_cap_band']
crco, _, _, _ = eval_world(cap)
hmax = max(float(np.dot(np.array(p), upv)) - dpl for p in crco)
rec('帽子クラウンの高さ(帯上端〜天井, mm)', hmax - band <= 0.060, round((hmax - band) * 1000, 1), '≤60')
rig.data.pose_position = 'POSE'; bpy.context.view_layer.update(); dg = bpy.context.evaluated_depsgraph_get()

# 9) ハンマー(別ファイル)
ham = bpy.data.objects.get(rig.get('n2_hammer', ''))
if ham is None:
    rec('ハンマー', False, 'なし', 'あり')
else:
    hm = ham.data; hm.calc_loop_triangles()
    ys = [v.co.y for v in hm.vertices]
    hlen = max(ys) - min(ys)
    himgs = [nd.image for s_ in ham.material_slots for nd in s_.material.node_tree.nodes if nd.bl_idname == 'ShaderNodeTexImage' and nd.image]
    rec('ハンマー三角形数', len(hm.loop_triangles) <= 3000, len(hm.loop_triangles), '≤3000')
    rec('ハンマー全長(m)', 0.38 <= hlen <= 0.42, round(hlen, 3), '0.38〜0.42')
    rec('ハンマーのテクスチャ最大(px)', max(max(i.size) for i in himgs) <= 2048, max(max(i.size) for i in himgs), '≤2048')
    rec('ハンマー原点=握り(柄尻が −Y 側 5〜10cm)', -0.10 <= min(ys) <= -0.05 and max(ys) > 0.3, round(min(ys), 3), '−0.10〜−0.05')
    for ext in ('fbx', 'glb'):
        pth = os.path.join(blend_dir, 'hammer.' + ext)
        b4 = set(bpy.data.objects)
        if ext == 'fbx':
            bpy.ops.import_scene.fbx(filepath=pth)
        else:
            bpy.ops.import_scene.gltf(filepath=pth)
        nw = [o for o in bpy.data.objects if o not in b4 and o.type == 'MESH']
        t_ = 0
        for o in nw:
            o.data.calc_loop_triangles(); t_ += len(o.data.loop_triangles)
        rec(f'hammer.{ext} 再読込(三角形数一致)', len(nw) == 1 and t_ == len(hm.loop_triangles), t_, len(hm.loop_triangles))
        for o in nw:
            bpy.data.objects.remove(o)

# 2) 4) FBX 再読込
fbx = os.path.join(blend_dir, export['fbx'])
before = set(bpy.data.objects)
bpy.ops.import_scene.fbx(filepath=fbx)
new = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
tris = 0
mism = []
for o in new:
    o.data.calc_loop_triangles()
    tris += len(o.data.loop_triangles)
    ref = export['meshes'].get(o.name) or export['meshes'].get(o.name.rsplit('.', 1)[0] if o.name[-4:-3] == '.' else o.name)
    if ref is None or ref['verts'] != len(o.data.vertices) or ref['mats'] != len(o.material_slots):
        mism.append((o.name, len(o.data.vertices), len(o.material_slots), ref))
rec('三角形数(FBX)', tris <= 60000, tris, '≤60000')
fbody = next((o for o in new if o.name.startswith(body.name.split('_src')[0].split('.body')[0] + '.body')), None)
gk = fbody.data.shape_keys.key_blocks.get('grin') if fbody is not None and fbody.data.shape_keys else None
if gk is None:
    rec('grin シェイプキー(FBX)', False, 'なし', 'あり・口角 ≥8mm')
else:
    ec_ = Vector(export['eye_center_rest'])
    bk = fbody.data.shape_keys.reference_key
    mw_ = fbody.matrix_world
    mv = 0.0
    for a_, b_ in zip(bk.data, gk.data):
        p_ = mw_ @ a_.co
        if ec_.z - 0.11 < p_.z < ec_.z - 0.04 and abs(p_.x - ec_.x) < 0.065 and p_.y < ec_.y + 0.03:
            mv = max(mv, ((mw_ @ b_.co) - p_).length)
    rec('grin シェイプキー(FBX): 口まわりの最大移動(mm)', mv >= 0.008, round(mv * 1000, 1), '≥8')
rec('FBX 再読込: メッシュ数', len(new) == len(export['meshes']), len(new), len(export['meshes']))
rec('FBX 再読込: 頂点数・素材数の一致', not mism, mism or '全一致', '全一致')
fimgs = {i for i in bpy.data.images if i.users and i.packed_file is not None or i.filepath.endswith(('.jpg', '.png'))}
fbig = max((max(i.size) for o in new for s in o.material_slots if s.material for n in s.material.node_tree.nodes
            if n.bl_idname == 'ShaderNodeTexImage' and n.image for i in [n.image]), default=0)
rec('テクスチャ最大(FBX, px)', 0 < fbig <= 4096, int(fbig), '≤4096')
rec('FBX サイズ(MB)', export['mb'] <= 50, export['mb'], '≤50')

out = os.path.join(ROOT, ARGS['out'])
os.makedirs(os.path.dirname(out), exist_ok=True)
json.dump(dict(candidate=cid, results=results), open(out, 'w'), indent=1, ensure_ascii=False)
ng = [r for r in results if not r['ok']]
log(f'{len(results) - len(ng)}/{len(results)} 通過 → {out}')
sys.exit(1 if ng else 0)
