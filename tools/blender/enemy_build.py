# enemy_build.py — 管理人候補1体を MPFB2 で生成し、.blend(ポーズ付き・テクスチャ同梱)と
#   Mixamo 用 FBX(Aポーズ・メッシュのみ・テクスチャ埋め込み)を書き出す。
#
# 実行(1体ずつ別プロセス。MPFB の素材名が体ごとに衝突しないように):
#   BLENDER_USER_RESOURCES=build/blender_user Blender -b --factory-startup -P tools/blender/enemy_build.py -- --id 01
#   [--out_dir build/enemy] [--no_fbx]
# 前提: tools/blender/enemy_setup.py で MPFB とアセットパックが build/blender_user に入っていること。
# 定義は enemy_defs.py。生成の流れ:
#   human_info(体型・肌・髪・眉・服・リグ)→ MPFB deserialize → 表情ユニット → 服の再フィット
#   → 色替え(テクスチャを numpy で灰色化して色を乗せる。柄・しわは残す) → 袖落とし等の簡易加工
#   → 自作小物(腕章・名札) → 立ちポーズ → 保存

import bpy, bmesh, addon_utils, json, math, os, sys
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
from n2common import parse_args, log  # noqa: E402
import enemy_defs  # noqa: E402

ARGS = parse_args({'id': '01', 'out_dir': 'build/enemy', 'no_fbx': False})
MPFB = 'bl_ext.user_default.mpfb'
CJK_FONT = os.path.join(os.path.dirname(bpy.app.binary_path), '..', 'Resources',
                        f'{bpy.app.version[0]}.{bpy.app.version[1]}', 'datafiles', 'fonts', 'Noto Sans CJK Regular.woff2')

addon_utils.enable(MPFB, default_set=True)
from bl_ext.user_default.mpfb.services import HumanService, TargetService, LocationService  # noqa: E402

C = enemy_defs.BY_ID[ARGS['id']]
OUT = os.path.join(ROOT, ARGS['out_dir'])
TEX_OUT = os.path.join(OUT, 'tex')
os.makedirs(TEX_OUT, exist_ok=True)


# ---------------------------------------------------------------------------
# 生成
# ---------------------------------------------------------------------------
def make_human():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    hi = HumanService._create_default_human_info_dict()
    hi['name'] = 'N2E_' + C['id']
    hi['phenotype'].update({k: v for k, v in C['phenotype'].items() if k != 'race'})
    hi['phenotype']['race'] = dict(C['phenotype']['race'])
    hi['targets'] = [dict(target=k, value=v) for k, v in C['targets'].items()]
    hi['rig'] = 'default'
    hi['eyes'] = 'high-poly.mhclo'
    hi['eyebrows'] = C['eyebrows'] + '.mhclo'
    hi['eyelashes'] = C['eyelashes'] + '.mhclo'
    hi['hair'] = (C['hair'] + '.mhclo') if C['hair'] else ''
    if C.get('teeth'):
        hi['teeth'] = C['teeth'] + '.mhclo'
    if C.get('tongue'):
        hi['tongue'] = C['tongue'] + '.mhclo'
    hi['clothes'] = [c + '.mhclo' for c in C['clothes']]
    hi['skin_mhmat'] = C['skin'] + '.mhmat'
    hi['skin_material_type'] = 'ENHANCED_SSS'
    hi['eyes_material_type'] = 'MAKESKIN'
    st = HumanService.get_default_deserialization_settings()
    st['subdiv_levels'] = 1
    body = HumanService.deserialize_from_dict(hi, st)
    rig = body.parent
    assert rig and rig.type == 'ARMATURE', 'リグが付いていない'
    return body, rig


def apply_expressions(body):
    """表情ユニット(asian 版)を形状キーとして足し、服・眉・眼鏡などを再フィットする。"""
    if not C['expr']:
        return
    units = os.path.join(LocationService.get_mpfb_data('targets'), 'expression', 'units', 'asian')
    for name, v in C['expr'].items():
        p = os.path.join(units, name + '.target.gz')
        assert os.path.exists(p), p
        TargetService.load_target(body, p, weight=v, name='n2expr-' + name)
    HumanService.refit(body)


def asset_objects(rig):
    """アセット名(mhclo basename) → オブジェクト。"""
    out = {}
    for o in rig.children:
        if o.type == 'MESH':
            out[o.name.split('.', 1)[1] if '.' in o.name else o.name] = o
    return out


# ---------------------------------------------------------------------------
# 色替え
# ---------------------------------------------------------------------------
def _hsv(rgb):
    mx = rgb.max(-1); mn = rgb.min(-1); d = mx - mn
    s = np.where(mx > 1e-6, d / np.maximum(mx, 1e-6), 0.0)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    h = np.zeros_like(mx)
    dd = np.maximum(d, 1e-6)
    h = np.where(mx == r, ((g - b) / dd) % 6, h)
    h = np.where(mx == g, (b - r) / dd + 2, h)
    h = np.where(mx == b, (r - g) / dd + 4, h)
    h = np.where(d < 1e-6, 0, h) * 60.0
    return h, s, mx


def _dilate(m, r):
    out = m.copy()
    for ax in (0, 1):
        acc = out.copy()
        for k in range(1, r + 1):
            acc |= np.roll(out, k, axis=ax) | np.roll(out, -k, axis=ax)
        out = acc
    return out


def white_patch_mask(lum, thr, r=7):
    """白いワッペン・文字・反射帯の領域(白の閉包)。文字の隙間も含めて塗りつぶすため膨張→収縮。"""
    m = lum > thr
    m = _dilate(m, r)
    m = ~_dilate(~m, r)
    return _dilate(m, 2)


def recolor_pixels(px, rules, erase_out=None):
    rgb = px[..., :3].copy()
    alpha = px[..., 3]
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    vis = alpha > 0.3
    for rule in rules:
        mask_spec, tint, amount, keep = rule[:4]
        clamp = rule[4] if len(rule) > 4 else (0.0, 99.0)
        erase = white_patch_mask(lum, clamp[2]) if len(clamp) > 2 else None
        if mask_spec is None:
            m = np.ones_like(lum)
        elif mask_spec[0] == 'hue':
            _, center, width, min_s = mask_spec
            h, s, _v = _hsv(rgb)
            dh = np.abs(((h - center) + 180) % 360 - 180)
            m = np.clip(1 - (dh - width / 2) / 12, 0, 1) * np.clip((s - min_s) / 0.05, 0, 1)
        elif mask_spec[0] == 'lum_below':
            m = np.clip((mask_spec[1] - lum) / 0.08 + 0.5, 0, 1)
        else:
            raise ValueError(mask_spec)
        sel = vis & (m > 0.01)
        ref = float(np.median(lum[sel & ~erase])) if erase is not None and (sel & ~erase).any() else \
            (float(np.median(lum[sel])) if sel.any() else 0.5)
        rel = np.clip(lum / max(ref, 1e-3), clamp[0], clamp[1])
        if erase is not None:
            rel = np.where(erase, 1.0, rel)
            if erase_out is not None:
                erase_out.append(erase)
        shade = 1 + (rel - 1) * keep                      # 濃淡を keep だけ残す
        new = np.clip(np.array(tint, np.float32)[None, None, :] * shade[..., None], 0, 1)
        k = (m * amount)[..., None]
        rgb = rgb * (1 - k) + new * k
        lum = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    out = px.copy()
    out[..., :3] = rgb
    return out


def is_color_tex(node):
    if node.bl_idname != 'ShaderNodeTexImage' or not node.image:
        return False
    n = node.image.name.lower()
    if any(k in n for k in ('normal', '_nm', 'bump', '_ao', 'ao.', 'rough', 'spec', 'sss')):
        return False
    return node.image.colorspace_settings.name != 'Non-Color'


def image_to_np(img):
    w, h = img.size
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    return px.reshape(h, w, 4)


def np_to_image(arr, name, path):
    h, w = arr.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=True)
    img.pixels.foreach_set(arr.ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    img.filepath = path
    return img


def recolor_object(obj, rules, tag):
    done = 0
    for slot in obj.material_slots:
        m = slot.material
        if not m or not m.node_tree:
            continue
        for node in m.node_tree.nodes:
            if is_color_tex(node):
                src = node.image
                erased = []
                arr = recolor_pixels(image_to_np(src), rules, erased)
                path = os.path.join(TEX_OUT, f'{C["id"]}_{tag}.png')
                node.image = np_to_image(arr, f'{C["id"]}_{tag}', path)
                if erased:   # 白消しした領域(ロゴ等)。P1b で法線マップ側の凹凸も消すのに使う
                    m = np.any(erased, axis=0).astype(np.float32)
                    mk = np.stack([m, m, m, np.ones_like(m)], -1)
                    obj['n2_erase_mask'] = np_to_image(mk, f'{C["id"]}_{tag}_erase',
                                                       os.path.join(TEX_OUT, f'{C["id"]}_{tag}_erase.png')).name
                done += 1
    log(f'recolor {obj.name}: {done} tex')


def tune_skin(body):
    sat, val = C['skin_tint']
    m = body.material_slots[0].material
    grp = next(n for n in m.node_tree.nodes if n.bl_idname == 'ShaderNodeGroup')
    nt = grp.node_tree
    for n in nt.nodes:
        if n.bl_idname == 'ShaderNodeTexImage' and n.name == 'DiffuseTexture':
            arr = image_to_np(n.image)
            rgb = arr[..., :3]
            lum = (rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32))[..., None]
            rgb = (lum + (rgb - lum) * sat) * val
            # 黄ばみ(わずかに緑黄へ)= 血色の悪さ
            rgb = rgb * np.array([0.97, 0.985, 0.93], np.float32)
            arr[..., :3] = np.clip(rgb, 0, 1)
            n.image = np_to_image(arr, f'{C["id"]}_skin', os.path.join(TEX_OUT, f'{C["id"]}_skin.png'))
    if 'Roughness' in grp.inputs:
        grp.inputs['Roughness'].default_value = C['skin_rough']
    if 'colorMixInStrength' in grp.inputs:
        grp.inputs['colorMixInStrength'].default_value = 0.0   # 赤みの上乗せを切る(青白く)


def flatten_material(obj):
    """法線マップ・AO を外す(元アセットのロゴやワッペンが凹凸として残るのを消す)。"""
    for slot in obj.material_slots:
        m = slot.material
        for n in m.node_tree.nodes:
            if n.bl_idname == 'ShaderNodeNormalMap':
                n.inputs['Strength'].default_value = 0.0
            if n.bl_idname == 'ShaderNodeTexImage' and n.image and any(k in n.image.name.lower() for k in ('_ao', 'normal')):
                for l in list(n.outputs['Color'].links):
                    m.node_tree.links.remove(l)
    log(f'flatten {obj.name}')


# ---------------------------------------------------------------------------
# 簡易加工
# ---------------------------------------------------------------------------
ARM_BONES = ('upperarm', 'lowerarm', 'wrist', 'hand', 'finger', 'metacarpal')


def strip_sleeves(obj):
    """腕のボーンが主ウェイトの頂点を落とす = 袖なし(ベスト)化。"""
    groups = {g.index: g.name for g in obj.vertex_groups}
    bm = bmesh.new(); bm.from_mesh(obj.data)
    dl = bm.verts.layers.deform.active
    kill = []
    for v in bm.verts:
        w = v[dl]
        if not w:
            continue
        gi, gw = max(w.items(), key=lambda kv: kv[1])
        name = groups.get(gi, '')
        arm = sum(wt for g, wt in w.items() if groups.get(g, '').startswith(ARM_BONES))
        if name.startswith(ARM_BONES) and arm > 0.5:   # 腕が主ウェイトの頂点だけ(胸の外側は腕ウェイトが混ざるので残す)
            kill.append(v)
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    bm.to_mesh(obj.data); bm.free()
    log(f'strip sleeves {obj.name}: -{len(kill)} verts')


def make_vest(rig, shirt, color, tag='vest'):
    """シャツを複製して袖・襟を落とし、前を V 字に開けて外へ膨らませた「ベスト」を作る。
    (MakeHuman の公開アセットにベストが無いための代用。生地は単色＋細かい凹凸)"""
    v = shirt.copy(); v.data = shirt.data.copy(); v.name = f'N2E_{C["id"]}.{tag}'
    for md in list(v.modifiers):
        if md.type not in ('ARMATURE', 'SUBSURF'):
            v.modifiers.remove(md)
    bpy.context.scene.collection.objects.link(v)
    strip_sleeves(v)
    neck = rig.matrix_world @ rig.data.bones['neck01'].head_local
    vz = (rig.matrix_world @ rig.data.bones['spine01'].head_local).z - 0.06   # V の底(みぞおち)
    k = 0.075 / max(neck.z - vz, 0.05)                                          # 首元で片側 7.5cm 開く
    bm = bmesh.new(); bm.from_mesh(v.data)
    kill = []
    for vt in bm.verts:
        p = v.matrix_world @ vt.co
        if p.z > neck.z - 0.035:
            kill.append(vt); continue
        if p.y < neck.y - 0.02 and p.z > vz and abs(p.x) < (p.z - vz) * k + 0.004:
            kill.append(vt)
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    bm.to_mesh(v.data); bm.free()
    md = v.modifiers.new('N2_Push', 'DISPLACE'); md.strength = 0.011; md.mid_level = 0.0
    sol = v.modifiers.new('N2_Thick', 'SOLIDIFY'); sol.thickness = 0.004; sol.offset = 1.0
    m = bpy.data.materials.new(f'N2E_{C["id"]}_{tag}')
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1); b.inputs['Roughness'].default_value = 0.85
    nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 900.0
    bp = nt.nodes.new('ShaderNodeBump'); bp.inputs['Strength'].default_value = 0.15
    nt.links.new(nz.outputs['Fac'], bp.inputs['Height']); nt.links.new(bp.outputs['Normal'], b.inputs['Normal'])
    v.data.materials.clear(); v.data.materials.append(m)
    log(f'vest from {shirt.name}: -{len(kill)} verts')
    return v


def strip_hem(obj, keep_above):
    """ロングカーディガンの裾を腰下で切る(事務員の普通丈に)。"""
    bm = bmesh.new(); bm.from_mesh(obj.data)
    kill = [v for v in bm.verts if (obj.matrix_world @ v.co).z < keep_above]
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    bm.to_mesh(obj.data); bm.free()
    log(f'strip hem {obj.name}: -{len(kill)} verts (z<{keep_above:.2f})')


# ---------------------------------------------------------------------------
# 自作小物(腕章・名札)。文字は Blender 同梱の Noto Sans CJK を平面に描いてテクスチャ化
# ---------------------------------------------------------------------------
def render_label(lines, size_px, bg, fg, path):
    """lines=[(文字, 相対高さ, y中心)]。正射影カメラで文字を撮って PNG にする(Workbench・フラット)。"""
    W, H = size_px
    sc = bpy.data.scenes.new('N2_Label')
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'FLAT'
    sc.display.shading.color_type = 'MATERIAL'
    sc.render.resolution_x, sc.render.resolution_y = W, H
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'Standard'
    sc.render.image_settings.file_format = 'PNG'
    sc.world = bpy.data.worlds.new('N2_LabelWorld')
    sc.world.color = bg
    aspect = W / H
    cam = bpy.data.objects.new('N2_LabelCam', bpy.data.cameras.new('N2_LabelCam'))
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = max(aspect, 1.0) * 1.0
    cam.location = (0, 0, 5); sc.collection.objects.link(cam); sc.camera = cam
    bgm = bpy.data.materials.new('N2_LabelBg'); bgm.diffuse_color = (*bg, 1)
    me = bpy.data.meshes.new('N2_LabelBgMesh')
    hw, hh = (aspect / 2, 0.5) if aspect >= 1 else (0.5, 0.5 / aspect)
    me.from_pydata([(-hw, -hh, 0), (hw, -hh, 0), (hw, hh, 0), (-hw, hh, 0)], [], [(0, 1, 2, 3)])
    pl = bpy.data.objects.new('N2_LabelBg', me); pl.data.materials.append(bgm); sc.collection.objects.link(pl)
    font = bpy.data.fonts.load(os.path.abspath(CJK_FONT), check_existing=True)
    fgm = bpy.data.materials.new('N2_LabelFg'); fgm.diffuse_color = (*fg, 1)
    for text, rel_h, yc in lines:
        cu = bpy.data.curves.new('N2_LabelTxt', 'FONT')
        cu.body = text; cu.font = font; cu.align_x = 'CENTER'; cu.align_y = 'CENTER'
        cu.size = rel_h * 2 * hh * 1.45   # フォントの size は字面より大きい枠なので補正
        t = bpy.data.objects.new('N2_LabelTxt', cu); t.location = (0, yc * 2 * hh, 0.01)
        t.data.materials.append(fgm); sc.collection.objects.link(t)
    sc.render.filepath = path
    bpy.ops.render.render(scene=sc.name, write_still=True)
    for o in list(sc.collection.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.scenes.remove(sc)
    return bpy.data.images.load(path, check_existing=False)


def simple_mat(name, img=None, color=(0.5, 0.5, 0.5), rough=0.7, metal=0.0):
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if img:
        tx = nt.nodes.new('ShaderNodeTexImage'); tx.image = img
        nt.links.new(tx.outputs['Color'], bsdf.inputs['Base Color'])
    else:
        bsdf.inputs['Base Color'].default_value = (*color, 1)
    return m


def bind_to_bone(obj, rig, bone):
    obj.parent = rig
    vg = obj.vertex_groups.new(name=bone)
    vg.add(list(range(len(obj.data.vertices))), 1.0, 'REPLACE')
    md = obj.modifiers.new('Armature', 'ARMATURE'); md.object = rig


def make_armband(rig, sleeve_objs, text='管理', colors=((0.85, 0.72, 0.10), (0.65, 0.05, 0.04)), tag='armband'):
    """左上腕(キャラ左 = +X)に腕章。袖メッシュの断面から半径を取ってリング状に巻く。"""
    bone = rig.data.bones['upperarm02.L']
    a = rig.matrix_world @ bone.head_local; b = rig.matrix_world @ bone.tail_local
    up = rig.matrix_world @ rig.data.bones['upperarm01.L'].head_local
    axis = (b - a).normalized()
    center = up.lerp(b, 0.42)   # 肩から肘までの上寄り
    pts = []
    dg = bpy.context.evaluated_depsgraph_get()
    for so in sleeve_objs:
        gi = {g.name: g.index for g in so.vertex_groups}
        arm_g = {gi[n] for n in ('upperarm01.L', 'upperarm02.L') if n in gi}
        ev = so.evaluated_get(dg); me = ev.to_mesh()
        for v in me.vertices:
            if sum(g.weight for g in so.data.vertices[v.index].groups if g.group in arm_g) < 0.5 \
                    if v.index < len(so.data.vertices) else True:
                continue
            p = so.matrix_world @ v.co
            t = (p - center).dot(axis)
            if abs(t) < 0.04:
                pts.append(((p - center) - axis * t).length)
        ev.to_mesh_clear()
    pts.sort()
    radius = (pts[int(len(pts) * 0.95)] if len(pts) > 10 else 0.06) + 0.006
    seg, hgt = 32, 0.085
    # 軸に直交する基底
    ref = Vector((0, -1, 0)) if abs(axis.y) < 0.9 else Vector((1, 0, 0))
    u = (ref - axis * ref.dot(axis)).normalized(); w = axis.cross(u)
    verts, faces, uvs = [], [], []
    for i in range(seg + 1):
        ang = 2 * math.pi * i / seg
        d = u * math.cos(ang) + w * math.sin(ang)
        for j, t in enumerate((-hgt / 2, hgt / 2)):
            verts.append(center + axis * t + d * radius)
    for i in range(seg):
        a0, a1, b0, b1 = 2 * i, 2 * i + 1, 2 * (i + 1), 2 * (i + 1) + 1
        faces.append((a0, b0, b1, a1))
    me = bpy.data.meshes.new('N2E_' + tag)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    uvl = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index
            i, j = divmod(vi, 2)
            uvl.data[li].uv = (1.0 - i / seg, 1.0 - j)   # 外から見て左→右に読める向き / v は肩側が 1
    me.update()
    obj = bpy.data.objects.new(f'N2E_{C["id"]}.{tag}', me)
    bpy.context.scene.collection.objects.link(obj)
    sol = obj.modifiers.new('Solidify', 'SOLIDIFY'); sol.thickness = 0.0025; sol.offset = 1.0
    bind_to_bone(obj, rig, 'upperarm02.L')
    # 前(-Y)寄り外側(+X)に文字が来るよう、1周を 2 文字ぶん×2面で敷く
    lab_h = max(96, int(1024 * hgt / (math.pi * radius)))   # 半周ぶんの幅に対して字が縦長にならない縦横比
    img = render_label([(text, 0.62, -0.05)], (1024, lab_h), colors[0], colors[1],
                       os.path.join(TEX_OUT, f'{C["id"]}_{tag}.png'))
    m = simple_mat(f'N2E_{C["id"]}_{tag}', img, rough=0.85)
    tx = next(n for n in m.node_tree.nodes if n.bl_idname == 'ShaderNodeTexImage')
    mp = m.node_tree.nodes.new('ShaderNodeMapping'); tc = m.node_tree.nodes.new('ShaderNodeTexCoord')
    mp.inputs['Scale'].default_value = (2.0, 1.0, 1.0)
    mp.inputs['Location'].default_value = (0.5, 0.0, 0.0)    # 文字の中心を腕の正面(と背面)へ
    m.node_tree.links.new(tc.outputs['UV'], mp.inputs['Vector']); m.node_tree.links.new(mp.outputs['Vector'], tx.inputs['Vector'])
    obj.data.materials.append(m)
    log(f'armband r={radius:.3f}')
    return obj


def make_nametag(rig, cloth_objs, kind='nametag'):
    """左胸(キャラ左 = +X、前 = -Y)に名札。服の表面へ正面からレイを当てて貼る。"""
    chest_z = (rig.matrix_world @ rig.data.bones['head'].tail_local).z * 0.745
    x = 0.095
    dg = bpy.context.evaluated_depsgraph_get()
    best = None
    for o in cloth_objs:
        ev = o.evaluated_get(dg)
        mi = o.matrix_world.inverted()
        org = mi @ Vector((x, -1.0, chest_z)); dr = (mi.to_3x3() @ Vector((0, 1, 0))).normalized()
        ok, loc, nrm, _ = ev.ray_cast(org, dr)
        if ok:
            wl = o.matrix_world @ loc
            if best is None or wl.y < best[0].y:
                best = (wl, (o.matrix_world.to_3x3() @ nrm).normalized())
    assert best, '名札を貼る面が見つからない'
    loc, nrm = best
    if nrm.y > 0:
        nrm = -nrm
    w, h, t = (0.075, 0.026, 0.0025) if kind == 'nametag' else (0.050, 0.030, 0.003)
    me = bpy.data.meshes.new('N2E_' + kind)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * w, v.co.y * t, v.co.z * h))
    bm.to_mesh(me); bm.free()
    uvl = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uvl.data[li].uv = (co.x / w + 0.5, co.z / h + 0.5) if poly.normal.y < -0.5 else (0.02, 0.02)
    obj = bpy.data.objects.new(f'N2E_{C["id"]}.{kind}', me)
    bpy.context.scene.collection.objects.link(obj)
    # 名札の -Y 面を服の法線に合わせる(少しだけ前に浮かす)
    rot = Vector((0, -1, 0)).rotation_difference(nrm).to_matrix().to_4x4()
    obj.matrix_world = Matrix.Translation(loc + nrm * (t / 2 + 0.002)) @ rot
    bpy.context.view_layer.update()
    obj.data.transform(obj.matrix_world); obj.matrix_world = Matrix.Identity(4)
    bind_to_bone(obj, rig, 'spine01')
    if kind == 'nametag':
        img = render_label([('管理事務所', 0.20, 0.27), ('佐 伯', 0.48, -0.12)], (768, 266),
                           (0.92, 0.92, 0.88), (0.08, 0.08, 0.10), os.path.join(TEX_OUT, f'{C["id"]}_nametag.png'))
        obj.data.materials.append(simple_mat(f'N2E_{C["id"]}_nametag', img, rough=0.25))
    else:   # 古い制服の徽章: くすんだ真鍮の板に「管理」
        img = render_label([('管理', 0.55, -0.02)], (500, 300),
                           (0.55, 0.42, 0.20), (0.16, 0.11, 0.05), os.path.join(TEX_OUT, f'{C["id"]}_badge.png'))
        obj.data.materials.append(simple_mat(f'N2E_{C["id"]}_badge', img, rough=0.45, metal=0.85))
    log(f'{kind} at {tuple(round(c, 3) for c in loc)}')
    return obj


# ---------------------------------------------------------------------------
# ポーズ(アーマチュア空間で骨頭まわりに回す。親→子の順に)
# ---------------------------------------------------------------------------
def rotate_bone(rig, name, axis, deg):
    pb = rig.pose.bones[name]
    bpy.context.view_layer.update()
    head = pb.head.copy()
    R = Matrix.Rotation(math.radians(deg), 4, Vector(axis))
    pb.matrix = Matrix.Translation(head) @ R @ Matrix.Translation(-head) @ pb.matrix
    bpy.context.view_layer.update()


def aim_bone(rig, name, direction):
    """骨(head→tail)の向きを direction(アーマチュア空間)へ、最小回転で向ける。子は追従する。"""
    pb = rig.pose.bones[name]
    bpy.context.view_layer.update()
    cur = (pb.tail - pb.head).normalized()
    q = cur.rotation_difference(Vector(direction).normalized())
    head = pb.head.copy()
    pb.matrix = Matrix.Translation(head) @ q.to_matrix().to_4x4() @ Matrix.Translation(-head) @ pb.matrix
    bpy.context.view_layer.update()


def apply_pose(rig):
    """前 = -Y、キャラ左 = +X。X軸まわり + で前傾(顎を引く)。"""
    p = C['pose']
    fwd = (1, 0, 0)
    for nm in ('spine04', 'spine03', 'spine02', 'spine01'):
        rotate_bone(rig, nm, fwd, p['slouch'] / 4)
    for nm in ('neck01', 'neck02'):
        rotate_bone(rig, nm, fwd, p['neck'] / 2)
    rotate_bone(rig, 'head', fwd, p['head_tilt'])
    if p['head_turn']:
        rotate_bone(rig, 'head', (0, 0, 1), p['head_turn'])
    if p['head_roll']:
        rotate_bone(rig, 'head', (0, 1, 0), p['head_roll'])
    for side, sgn in (('L', 1), ('R', -1)):   # 脚: A ポーズの開脚を閉じて、足を肩幅より狭く
        aim_bone(rig, f'upperleg01.{side}', (-sgn * 0.012, 0.0, -1.0))
        aim_bone(rig, f'lowerleg01.{side}', (sgn * 0.005, 0.03, -1.0))
    out = math.radians(p['arm_out'])
    bend = math.radians(p['elbow'])
    for side, sgn in (('L', 1), ('R', -1)):
        # 上腕: ほぼ真下、わずかに外・わずかに後ろ。前腕: 肘で前へ曲げる
        aim_bone(rig, f'upperarm01.{side}', (sgn * math.sin(out), 0.03, -math.cos(out)))
        aim_bone(rig, f'lowerarm01.{side}', (sgn * math.sin(out * 0.6), -math.sin(bend), -math.cos(bend)))
        lo = rig.pose.bones[f'lowerarm02.{side}']
        aim_bone(rig, f'wrist.{side}', (lo.tail - lo.head).normalized() + Vector((0, 0.05, 0)))
        grip = side == 'R' and p.get('grip_r')
        for f in range(2, 6):
            for k in (1, 2, 3):
                bn = f'finger{f}-{k}.{side}'
                if bn in rig.pose.bones:
                    # 握る手は指を深く曲げる(指の骨の軸まわり = 骨の X 軸)
                    if grip:
                        b_ = rig.pose.bones[bn]
                        bpy.context.view_layer.update()
                        rotate_bone(rig, bn, tuple(b_.matrix.to_3x3() @ Vector((1, 0, 0))), 38 + 14 * k)
                    else:
                        rotate_bone(rig, bn, fwd, -(8 + 5 * k))
        if grip:
            for k in (2, 3):
                bn = f'finger1-{k}.{side}'
                if bn in rig.pose.bones:
                    b_ = rig.pose.bones[bn]
                    bpy.context.view_layer.update()
                    rotate_bone(rig, bn, tuple(b_.matrix.to_3x3() @ Vector((1, 0, 0))), 30)
    # 視線: 頭を前傾させたぶん目を上げて、プレイヤーを見据える(上げすぎると瞼に隠れるので上限あり)
    up = min(p['slouch'] * 0.5 + p['neck'] + p['head_tilt'], 12) if 'eye_up' not in p else p['eye_up']
    for side in ('L', 'R'):
        rotate_bone(rig, f'eye.{side}', fwd, up)   # 眼球は実測で +X が「上」(頭とは逆)


# ---------------------------------------------------------------------------
# Mixamo 用 FBX: レストポーズ(MakeHuman の A ポーズ)・メッシュのみ(骨は Mixamo が付ける)・
# マテリアルは「画像→Base Color(＋Alpha)」の単純な Principled に置き換え(FBX が拾える形)、
# テクスチャは 2048px 以下に縮めて埋め込む(1体 50MB 以下)。.blend の保存後に行い、再保存しない。
# ---------------------------------------------------------------------------
FBX_TEX_MAX = 2048


def color_image_of(mat):
    nodes = list(mat.node_tree.nodes)
    for n in nodes:
        if n.bl_idname == 'ShaderNodeGroup' and n.node_tree:
            nodes += list(n.node_tree.nodes)
    cands = [n.image for n in nodes if is_color_tex(n)]
    pref = [i for i in cands if 'diffuse' in i.name.lower() or i.name.startswith(C['id'])]
    return (pref or cands or [None])[0]


def export_image(img, tex_dir, has_alpha, max_px=None):
    w, h = img.size
    cp = img.copy()
    lim = max_px or FBX_TEX_MAX
    if max(w, h) > lim:
        k = lim / max(w, h)
        cp.scale(max(1, int(w * k)), max(1, int(h * k)))
    ext = 'png' if has_alpha else 'jpg'
    path = os.path.join(tex_dir, f'{bpy.path.clean_name(img.name)}.{ext}')
    cp.filepath_raw = path
    cp.file_format = 'PNG' if has_alpha else 'JPEG'
    if not has_alpha:
        bpy.context.scene.render.image_settings.quality = 88
    cp.save()
    out = bpy.data.images.load(path, check_existing=False)
    if img.colorspace_settings.name == 'Non-Color':
        out.colorspace_settings.name = 'Non-Color'
    return out


def fbx_material(m, tex_dir):
    """FBX が拾える単純な Principled(画像→色[＋α]、法線マップ、粗さ)へ置き換えた複製を作る。
    P1b の焼き込み素材はカスタムプロパティ n2_albedo / n2_normal / n2_rough / n2_alpha で画像を指定。"""
    final = C.get('final')
    if m.get('n2_albedo'):
        img = bpy.data.images[m['n2_albedo']]
        alpha = bool(m.get('n2_alpha'))
    else:
        img = color_image_of(m)
        pb0 = m.node_tree.nodes.get('Principled BSDF')
        alpha = bool(pb0 and pb0.inputs['Alpha'].links) and C['id'] + '_skin' != (img.name if img else '')
    nm = bpy.data.materials.new(m.name + '_fbx')
    nt = nm.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = float(m.get('n2_rough_value', 0.7))
    if img:
        ei = export_image(img, tex_dir, alpha, 4096 if final else None)
        tx = nt.nodes.new('ShaderNodeTexImage'); tx.image = ei
        nt.links.new(tx.outputs['Color'], b.inputs['Base Color'])
        if alpha:
            nt.links.new(tx.outputs['Alpha'], b.inputs['Alpha'])
    else:
        pb = m.node_tree.nodes.get('Principled BSDF')
        if pb:
            for k in ('Base Color', 'Metallic', 'Roughness'):
                b.inputs[k].default_value = pb.inputs[k].default_value
    if m.get('n2_normal'):
        ni = export_image(bpy.data.images[m['n2_normal']], tex_dir, False, 2048)
        ni.colorspace_settings.name = 'Non-Color'
        tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = ni
        nmn = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(tn.outputs['Color'], nmn.inputs['Color']); nt.links.new(nmn.outputs['Normal'], b.inputs['Normal'])
    if m.get('n2_rough'):
        ri = export_image(bpy.data.images[m['n2_rough']], tex_dir, False, 2048)
        ri.colorspace_settings.name = 'Non-Color'
        tr = nt.nodes.new('ShaderNodeTexImage'); tr.image = ri
        nt.links.new(tr.outputs['Color'], b.inputs['Roughness'])
    return nm


EXPR_KEYS = ('grin', 'attack')


def export_copy(o):
    """書き出し用の複製: モディファイア(マスク・アーマチュア・細分化 0)を適用した形にし、形状キーは grin だけ残す。
    MPFB の体型ターゲット(形状キー)は基本形へ焼き込む。FBX が形状キーを落とさないよう、複製にはモディファイアを残さない。"""
    me = o.data
    keys = me.shape_keys.key_blocks if me.shape_keys else None
    if not keys:
        dg = bpy.context.evaluated_depsgraph_get()
        nm = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
        c = bpy.data.objects.new(o.name + '_x', nm)
        bpy.context.scene.collection.objects.link(c)
        c.matrix_world = o.matrix_world
        return c
    n = len(me.vertices)
    basis = me.shape_keys.reference_key
    b = np.empty(n * 3, np.float32); basis.data.foreach_get('co', b)
    mix = b.copy()
    expr = {}                                     # 表情キー(grin / attack)は残し、他は基本形へ焼く
    for k in keys:
        if k is basis:
            continue
        c = np.empty(n * 3, np.float32); k.data.foreach_get('co', c)
        if k.name in EXPR_KEYS:
            expr[k.name] = c - b
        else:
            mix += (c - b) * k.value
    nm = me.copy()
    c = bpy.data.objects.new(o.name + '_x', nm)
    bpy.context.scene.collection.objects.link(c)
    c.matrix_world = o.matrix_world
    c.shape_key_clear()
    nm.vertices.foreach_set('co', mix)
    # マスク(補助形状・服の下の削除グループ)を頂点削除で再現
    drop = np.zeros(n, bool)
    for md in o.modifiers:
        if md.type == 'MASK' and md.show_viewport and md.vertex_group in o.vertex_groups:
            gi = o.vertex_groups[md.vertex_group].index
            inn = np.zeros(n, bool)
            for v in me.vertices:
                for g in v.groups:
                    if g.group == gi and g.weight > 0.0:
                        inn[v.index] = True
            drop |= inn if md.invert_vertex_group else ~inn
    if expr:
        c.shape_key_add(name='Basis', from_mix=False)
        for kn in EXPR_KEYS:
            if kn in expr:
                gk = c.shape_key_add(name=kn, from_mix=False)
                gk.data.foreach_set('co', mix + expr[kn]); gk.value = 0.0
    if drop.any():
        bm = bmesh.new(); bm.from_mesh(nm)
        bm.verts.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[bm.verts[i] for i in np.where(drop)[0]], context='VERTS')
        bm.to_mesh(nm); bm.free()
    return c


def export_fbx(rig):
    tex_dir = os.path.join(OUT, 'fbx_tex', C['id'])
    os.makedirs(tex_dir, exist_ok=True)
    rig.data.pose_position = 'REST'
    bpy.context.view_layer.update()
    meshes = [o for o in rig.children if o.type == 'MESH' and not o.get('n2_no_export')]
    final = C.get('final')
    if final:   # 形状キー grin を FBX に乗せるため、モディファイアを適用した複製を書き出す
        src = meshes
        meshes = [export_copy(o) for o in src]
        for o, c in zip(src, meshes):      # 書き出し名は元の名前のまま(元は退避名へ)
            nm_ = o.name
            o.name = nm_ + '_src'
            c.name = nm_
    cache = {}
    for o in meshes:
        for slot in o.material_slots:
            m = slot.material
            if not m:
                continue
            if m.name not in cache:
                cache[m.name] = fbx_material(m, tex_dir)
            slot.material = cache[m.name]
    bpy.context.view_layer.update()
    extra = {}
    if final:   # Mixamo 用: 骨・モディファイア・頂点グループ・親子なしの 1 メッシュへ(形状キー grin / attack は保持)
        moving = 0
        for o in meshes:
            o.parent = None
            for md in list(o.modifiers):
                o.modifiers.remove(md)
            o.vertex_groups.clear()
            if o.data.shape_keys and 'attack' in o.data.shape_keys.key_blocks:
                b_ = o.data.shape_keys.reference_key; a_ = o.data.shape_keys.key_blocks['attack']
                n_ = len(o.data.vertices)
                bb = np.empty(n_ * 3, np.float32); b_.data.foreach_get('co', bb)
                aa = np.empty(n_ * 3, np.float32); a_.data.foreach_get('co', aa)
                moving += int((np.linalg.norm((aa - bb).reshape(-1, 3), axis=1) > 0.001).sum())
        with bpy.context.temp_override(selected_objects=meshes, selected_editable_objects=meshes):
            bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        body_c = next(o for o in meshes if o.name.endswith('.body'))
        with bpy.context.temp_override(active_object=body_c, object=body_c, selected_objects=meshes,
                                       selected_editable_objects=meshes):
            bpy.ops.object.join()
        body_c.name = f'N2E_{C["id"]}_kanrinin'
        body_c.data.name = body_c.name
        kb = body_c.data.shape_keys.key_blocks
        assert 'grin' in kb and 'attack' in kb, [k.name for k in kb]
        n_ = len(body_c.data.vertices)
        bb = np.empty(n_ * 3, np.float32); kb[0].data.foreach_get('co', bb)
        aa = np.empty(n_ * 3, np.float32); kb['attack'].data.foreach_get('co', aa)
        moving_after = int((np.linalg.norm((aa - bb).reshape(-1, 3), axis=1) > 0.001).sum())
        assert moving_after >= moving, f'結合で attack の動きが失われた: {moving} → {moving_after}'
        # 原点 = 足元の床: 最下点(靴底)を z=0 に揃える(形状キーも一緒に動く)
        zmin = float(bb.reshape(-1, 3)[:, 2].min())
        body_c.location.z -= zmin
        with bpy.context.temp_override(selected_objects=[body_c], selected_editable_objects=[body_c], active_object=body_c):
            bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        kb[0].data.foreach_get('co', bb)
        meshes = [body_c]
        zs = bb.reshape(-1, 3)[:, 2]
        extra = dict(attack_moving_verts=moving, attack_moving_after_join=moving_after, floor_shift=-zmin,
                     floor_z=float(zs.min()), top_z=float(zs.max()))
        log(f'mixamo: joined 1 mesh, keys {[k.name for k in kb]}, attack moving verts {moving} → {moving_after}')
    # 書き出す形(レスト・モディファイア適用後)の頂点数・三角形数・素材数を記録 → enemy_check.py が再読込と照合
    dg = bpy.context.evaluated_depsgraph_get()
    stats = {}
    for o in meshes:
        ev = o.evaluated_get(dg); me = ev.to_mesh(); me.calc_loop_triangles()
        stats[o.name] = dict(verts=len(me.vertices), tris=len(me.loop_triangles), mats=len(o.material_slots),
                             keys=[k.name for k in o.data.shape_keys.key_blocks] if o.data.shape_keys else [])
        ev.to_mesh_clear()
    for o in bpy.context.scene.objects:
        o.select_set(o in meshes)
    bpy.context.view_layer.objects.active = meshes[0]
    path = os.path.join(OUT, C['name'] + '.fbx')
    bpy.ops.export_scene.fbx(filepath=path, use_selection=True, object_types={'MESH'},
                             use_mesh_modifiers=not final, mesh_smooth_type='FACE', add_leaf_bones=False,
                             path_mode='COPY', embed_textures=True, bake_anim=False)
    mb = os.path.getsize(path) / 1e6
    if final:   # 予備: 形状キー(BlendShape Deformer)を完全に除いた版(Mixamo が形状キーで拒否する場合用)
        meshes[0].shape_key_clear()
        p2 = os.path.join(OUT, C['name'] + '_noshape.fbx')
        bpy.ops.export_scene.fbx(filepath=p2, use_selection=True, object_types={'MESH'},
                                 use_mesh_modifiers=False, mesh_smooth_type='FACE', add_leaf_bones=False,
                                 path_mode='COPY', embed_textures=True, bake_anim=False)
        raw = open(p2, 'rb').read()
        assert b'BlendShape' not in raw and b'Deformer' not in raw, '予備 FBX に BlendShape/Deformer が残っている'
        extra['noshape_fbx'] = os.path.basename(p2)
        log(f'fbx (noshape) {p2} ({os.path.getsize(p2) / 1e6:.1f} MB)')
    info = dict(fbx=os.path.basename(path), mb=round(mb, 2), meshes=stats, tris=sum(v['tris'] for v in stats.values()), **extra)
    if final:
        e = (rig.matrix_world @ rig.data.bones['eye.L'].head_local + rig.matrix_world @ rig.data.bones['eye.R'].head_local) / 2
        info['eye_center_rest'] = list(e)
    with open(os.path.join(OUT, C['name'] + '_export.json'), 'w') as f:
        json.dump(info, f, indent=1, ensure_ascii=False)
    log(f'fbx {path} ({mb:.1f} MB, {len(meshes)} meshes, {len(cache)} mats, {info["tris"]} tris)')
    assert mb <= 50, f'FBX が 50MB を超えた: {mb:.1f}MB'


# ---------------------------------------------------------------------------
def main():
    log(f'candidate {C["id"]} {C["short"]}')
    body, rig = make_human()
    apply_expressions(body)
    objs = asset_objects(rig)
    log(f'assets: {sorted(objs)}')
    tune_skin(body)
    for asset, rules in C['recolor'].items():
        assert asset in objs, (asset, sorted(objs))
        recolor_object(objs[asset], rules, asset)
    for asset, dist in C.get('push', {}).items():   # 下の服の突き抜け対策: 外側の服を法線方向へ少し膨らませる
        md = objs[asset].modifiers.new('N2_Push', 'DISPLACE')
        md.strength = dist; md.mid_level = 0.0; md.direction = 'NORMAL'
    for asset in C.get('flat', []):
        flatten_material(objs[asset])
    for asset, how in C['strip'].items():
        if how == 'sleeves':
            strip_sleeves(objs[asset])
        elif how == 'hem':
            hip = rig.matrix_world @ rig.data.bones['spine05'].head_local
            strip_hem(objs[asset], hip.z - 0.20)
    # 虹彩: MakeHuman の brown は照明下で赤茶に見えるので、日本人らしい濃い焦げ茶へ
    eyes = objs.get('high-poly')
    if eyes:
        recolor_object(eyes, [(('hue', 20, 50, 0.18), (0.16, 0.10, 0.065), 0.85, 0.8)], 'iris')
    extras = []
    cloth = [objs[c] for c in C['clothes'] if c in objs and not c.startswith(('shoes', 'mindfront_shoes'))]
    for e in C['extras']:
        if e == 'armband':
            extras.append(make_armband(rig, cloth))
        elif e == 'armband_old':
            extras.append(make_armband(rig, cloth, text='管理', colors=((0.42, 0.40, 0.33), (0.10, 0.10, 0.12)), tag='armband'))
        elif e.startswith('vest:'):
            _, src, r, g, b = e.split(':')
            extras.append(make_vest(rig, objs[src], (float(r), float(g), float(b))))
        elif e in ('nametag', 'badge'):
            extras.append(make_nametag(rig, cloth, e))
    rig['n2_candidate'] = C['id']
    if C.get('final'):   # P1b: 質感向上(レストで焼く・生やす・作る)
        import enemy_p1b
        enemy_p1b.init(log, TEX_OUT, C['id'])
        enemy_p1b.upgrade(C, body, rig, objs, extras)
    # Aポーズ(レスト)の状態を記録してからポーズ
    apply_pose(rig)
    if C.get('final') and rig.get('n2_hammer'):
        enemy_p1b.attach_hammer(rig, bpy.data.objects[rig['n2_hammer']])
    bpy.context.view_layer.objects.active = rig
    os.makedirs(OUT, exist_ok=True)
    blend = os.path.join(OUT, C['name'] + '.blend')
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=blend, compress=True)
    log(f'saved {blend} ({os.path.getsize(blend) / 1e6:.1f} MB)')
    if not ARGS.get('no_fbx'):
        export_fbx(rig)


if __name__ == '__main__':
    main()
