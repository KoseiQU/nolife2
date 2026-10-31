# enemy_p1b.py — P1b(管理人の確定像 07)の質感向上。enemy_build.py から final=True の候補にだけ呼ばれる。
#
# 方針: Cycles の手続き的シェーダで「肌・服の細部」を作り、それを UV のテクスチャ(色・粗さ・法線)へ焼く。
#   → レンダもゲーム(リアルタイム)も同じ焼き込みテクスチャを使う(手続き的な見た目がレンダだけの嘘にならない)。
#   ① 肌: ENHANCED_SSS(皮下散乱)は維持。毛穴・シミ・老人斑・額のしわ・無精ひげ・まぶた縁の赤み/湿り・
#         T字部の脂の鏡面ムラを焼いて、SSS グループの色/粗さ/法線へ差し込む。目は角膜の光沢層(コート)
#   ② 髪: MakeHuman の板ポリ髪は使わない。頭皮(scalp)から毛をヘアカーブで生やす(白髪まじり・帽子の下は省く)。
#         眉・まつ毛も MakeHuman のカードを型紙にしてカーブで生やす。書き出し用に細い帯メッシュ(透過テクスチャ)へ変換
#   ③ 服: つなぎを間引き(三角形予算)、重ならない UV を新設し、元テクスチャ＋関節の皺(手続き的な彫り込み)＋
#         膝/肘/袖口/裾のすれ＋胸ポケット下の油染み＋布目を焼く。ロゴを消した跡の平坦さは皺と布目で埋まる
#   ④ 帽子: 芯のある制帽を自作(張りのあるクラウン・硬く平滑なつば・鉢巻・帽章・ステッチ)
# 座標: すべてレスト(A ポーズ)で作る。Blender の前 = -Y、キャラ左 = +X、上 = +Z、単位 m。

import bpy, bmesh, math, os, random
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

LOG = print
TEX_OUT = ''
CID = '07'


def init(log, tex_out, cid):
    global LOG, TEX_OUT, CID
    LOG, TEX_OUT, CID = log, tex_out, cid


# ---------------------------------------------------------------------------
# 共通: レスト形状・頂点属性・焼き込み
# ---------------------------------------------------------------------------
def rest_mesh_arrays(obj):
    """モディファイア無し(形状キーは反映)の頂点位置と法線(ワールド)。頂点番号は元メッシュと一致。"""
    saved = [(m, m.show_viewport) for m in obj.modifiers]
    for m, _ in saved:
        m.show_viewport = False
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = ev.to_mesh()
    n = len(me.vertices)
    co = np.empty(n * 3, np.float32); me.vertices.foreach_get('co', co)
    nr = np.empty(n * 3, np.float32); me.vertices.foreach_get('normal', nr)
    ev.to_mesh_clear()
    for m, v in saved:
        m.show_viewport = v
    mw = np.array(obj.matrix_world, np.float32)
    co = co.reshape(-1, 3) @ mw[:3, :3].T + mw[:3, 3]
    nr = nr.reshape(-1, 3) @ mw[:3, :3].T
    nr /= np.maximum(np.linalg.norm(nr, axis=1, keepdims=True), 1e-9)
    return co, nr


def set_point_attr(obj, name, values):
    me = obj.data
    if name in me.attributes:
        me.attributes.remove(me.attributes[name])
    a = me.attributes.new(name, 'FLOAT', 'POINT')
    a.data.foreach_set('value', np.asarray(values, np.float32).ravel())


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def bone_head(rig, name):
    return np.array(rig.matrix_world @ rig.data.bones[name].head_local, np.float32)


def bone_tail(rig, name):
    return np.array(rig.matrix_world @ rig.data.bones[name].tail_local, np.float32)


def group_mask(obj, name):
    vg = obj.vertex_groups.get(name)
    out = np.zeros(len(obj.data.vertices), np.float32)
    if vg is None:
        return out
    gi = vg.index
    for v in obj.data.vertices:
        for g in v.groups:
            if g.group == gi:
                out[v.index] = g.weight
    return out


class N:
    """ノードを書きやすくする小道具。"""
    def __init__(self, mat):
        self.nt = mat.node_tree
        self.x = -1600

    def new(self, kind, **inputs):
        n = self.nt.nodes.new(kind)
        n.location = (self.x, 0); self.x += 40
        for k, v in inputs.items():
            if hasattr(n, k) and not isinstance(getattr(n, k), bpy.types.bpy_prop_collection) and k not in n.inputs:
                setattr(n, k, v)
            else:
                self.set(n.inputs[k], v)
        return n

    def set(self, sock, v):
        if isinstance(v, bpy.types.NodeSocket):
            self.nt.links.new(v, sock)
        else:
            sock.default_value = v

    def link(self, a, b):
        self.nt.links.new(a, b)

    def math(self, op, a, b=0.0, c=0.0, clamp=False):
        n = self.nt.nodes.new('ShaderNodeMath'); n.operation = op; n.use_clamp = clamp
        self.set(n.inputs[0], a); self.set(n.inputs[1], b)
        if len(n.inputs) > 2:
            self.set(n.inputs[2], c)
        return n.outputs[0]

    def mix(self, a, b, fac, blend='MIX'):
        n = self.nt.nodes.new('ShaderNodeMix'); n.data_type = 'RGBA'; n.blend_type = blend
        self.set(n.inputs['Factor'], fac); self.set(n.inputs[6], a); self.set(n.inputs[7], b)
        return n.outputs[2]

    def fmix(self, a, b, fac):
        n = self.nt.nodes.new('ShaderNodeMix'); n.data_type = 'FLOAT'
        self.set(n.inputs['Factor'], fac); self.set(n.inputs[2], a); self.set(n.inputs[3], b)
        return n.outputs[0]

    def attr(self, name):
        n = self.nt.nodes.new('ShaderNodeAttribute'); n.attribute_name = name; n.attribute_type = 'GEOMETRY'
        return n.outputs['Fac']

    def ramp(self, x, lo, hi):
        """x を [lo,hi] で 0..1 に(滑らか)。"""
        n = self.nt.nodes.new('ShaderNodeMapRange'); n.interpolation_type = 'SMOOTHSTEP'
        self.set(n.inputs['Value'], x); n.inputs['From Min'].default_value = lo; n.inputs['From Max'].default_value = hi
        return n.outputs['Result']

    def img(self, image, uv=None, non_color=False):
        n = self.nt.nodes.new('ShaderNodeTexImage'); n.image = image
        if non_color:
            image.colorspace_settings.name = 'Non-Color'
        if uv:
            u = self.nt.nodes.new('ShaderNodeUVMap'); u.uv_map = uv
            self.link(u.outputs['UV'], n.inputs['Vector'])
        return n

    def obj_coord(self):
        return self.nt.nodes.new('ShaderNodeTexCoord').outputs['Object']

    def noise(self, vec, scale, detail=2.0, rough=0.5, w=None):
        n = self.nt.nodes.new('ShaderNodeTexNoise'); n.noise_dimensions = '3D'
        self.set(n.inputs['Vector'], vec); n.inputs['Scale'].default_value = scale
        n.inputs['Detail'].default_value = detail; n.inputs['Roughness'].default_value = rough
        return n.outputs['Fac']

    def voronoi(self, vec, scale, rnd=1.0, feature='F1'):
        n = self.nt.nodes.new('ShaderNodeTexVoronoi'); n.feature = feature
        self.set(n.inputs['Vector'], vec); n.inputs['Scale'].default_value = scale
        n.inputs['Randomness'].default_value = rnd
        return n.outputs['Distance']

    def bump(self, height, strength, distance, normal=None):
        n = self.nt.nodes.new('ShaderNodeBump')
        self.set(n.inputs['Height'], height); n.inputs['Strength'].default_value = strength
        n.inputs['Distance'].default_value = distance
        if normal is not None:
            self.set(n.inputs['Normal'], normal)
        return n.outputs['Normal']


def new_image(name, size, non_color=False, alpha=False, float_buffer=False):
    img = bpy.data.images.get(name)
    if img:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, size, size, alpha=alpha, float_buffer=float_buffer)
    img.colorspace_settings.name = 'Non-Color' if non_color else 'sRGB'
    return img


def save_image(img, path):
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    img.filepath = path


def bake(obj, uv_name, outputs, size, tag, margin=8):
    """outputs = {'albedo': socket(Color), 'rough': socket(Float), 'normal': socket(Normal)}。
    obj の全マテリアルを一時的に焼き込み用に差し替え、UV `uv_name` の画像へ焼く。戻り値 {key: Image}。
    outputs の各ソケットは「焼き込み用マテリアル」(bake_mat) の中のもの。"""
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'; prefs.get_devices()
        for d in prefs.devices:
            d.use = (d.type == 'METAL')
        scene.cycles.device = 'GPU'
    except Exception as e:  # noqa: BLE001
        LOG(f'bake: GPU 設定失敗 → CPU {e}')
    scene.cycles.samples = 4
    scene.cycles.use_denoising = False
    mat = outputs['_mat']
    nt = mat.node_tree
    out_node = next(n for n in nt.nodes if n.bl_idname == 'ShaderNodeOutputMaterial')
    saved = [s.material for s in obj.material_slots]
    for s in obj.material_slots:
        s.material = mat
    sub = [(m, m.show_render) for m in obj.modifiers if m.type == 'SUBSURF']
    for m, _ in sub:
        m.show_render = False
    obj.data.uv_layers.active = obj.data.uv_layers[uv_name]
    for o in scene.objects:
        o.select_set(False)
    obj.hide_render = False
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    res = {}
    for key in ('albedo', 'rough', 'metal', 'normal', 'height'):
        if key not in outputs:
            continue
        img = new_image(f'{CID}_{tag}_{key}', size, non_color=(key != 'albedo'), float_buffer=(key == 'height'))
        tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = img
        for n in nt.nodes:
            n.select = False
        tn.select = True; nt.nodes.active = tn
        for l in list(out_node.inputs['Surface'].links):
            nt.links.remove(l)
        if key == 'normal':
            b = nt.nodes.new('ShaderNodeBsdfPrincipled')
            nt.links.new(outputs['normal'], b.inputs['Normal'])
            nt.links.new(b.outputs['BSDF'], out_node.inputs['Surface'])
            bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT', margin=margin, use_clear=True,
                                target='IMAGE_TEXTURES', uv_layer=uv_name)
            nt.nodes.remove(b)
        else:
            e = nt.nodes.new('ShaderNodeEmission')
            src = outputs[key]
            nt.links.new(src, e.inputs['Color'])
            nt.links.new(e.outputs['Emission'], out_node.inputs['Surface'])
            bpy.ops.object.bake(type='EMIT', margin=margin, use_clear=True, target='IMAGE_TEXTURES', uv_layer=uv_name)
            nt.nodes.remove(e)
        nt.nodes.remove(tn)
        if key != 'height':
            save_image(img, os.path.join(TEX_OUT, f'{CID}_{tag}_{key}.png'))
        res[key] = img
    for s, m in zip(obj.material_slots, saved):
        s.material = m
    for m, v in sub:
        m.show_render = v
    LOG(f'bake {obj.name} [{",".join(res)}] {size}px')
    return res


def meters_per_uv(obj, uv_name, face_mask=None):
    """UV 1 単位あたりの実寸(m)。face_mask の面だけで平均(顔など注目部位の密度に合わせる)。"""
    me = obj.data
    co, _ = rest_mesh_arrays(obj)
    uv = np.empty(len(me.loops) * 2, np.float32); me.uv_layers[uv_name].data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
    tris, loops = tri_arrays(obj)
    a3 = 0.5 * np.linalg.norm(np.cross(co[tris[:, 1]] - co[tris[:, 0]], co[tris[:, 2]] - co[tris[:, 0]]), axis=1)
    u = uv[loops]
    a2 = 0.5 * np.abs((u[:, 1, 0] - u[:, 0, 0]) * (u[:, 2, 1] - u[:, 0, 1]) - (u[:, 2, 0] - u[:, 0, 0]) * (u[:, 1, 1] - u[:, 0, 1]))
    sel = np.ones(len(tris), bool) if face_mask is None else face_mask[tris].min(1) > 0.5
    return float(np.sqrt(a3[sel].sum() / max(a2[sel].sum(), 1e-12)))


def height_to_normal(himg, m_per_uv, path, name, strength=1.0):
    """高さ(m)の画像 → タンジェント空間法線(OpenGL, PNG)。UV の u=接線, v=従接線とみなす近似。"""
    w, h = himg.size
    a = np.empty(w * h * 4, np.float32); himg.pixels.foreach_get(a)
    H = a.reshape(h, w, 4)[..., 0].astype(np.float64)
    texel = m_per_uv / w
    gx = (np.roll(H, -1, 1) - np.roll(H, 1, 1)) / (2 * texel)
    gy = (np.roll(H, -1, 0) - np.roll(H, 1, 0)) / (2 * texel)
    nx, ny, nz = -gx * strength, -gy * strength, np.ones_like(H)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    out = np.stack([nx / ln * 0.5 + 0.5, ny / ln * 0.5 + 0.5, nz / ln * 0.5 + 0.5, np.ones_like(H)], -1).astype(np.float32)
    im = bpy.data.images.new(name, w, h, alpha=False)
    im.colorspace_settings.name = 'Non-Color'
    im.pixels.foreach_set(out.ravel())
    save_image(im, path)
    return im


def blend_normals(base_img, detail_img, path, name):
    """2 枚の接空間法線を合成(whiteout)。"""
    w, h = base_img.size
    A = np.empty(w * h * 4, np.float32); base_img.pixels.foreach_get(A); A = A.reshape(h, w, 4)
    B = np.empty(w * h * 4, np.float32); detail_img.pixels.foreach_get(B); B = B.reshape(h, w, 4)
    a = A[..., :3] * 2 - 1; b = B[..., :3] * 2 - 1
    n = np.stack([a[..., 0] + b[..., 0], a[..., 1] + b[..., 1], a[..., 2] * b[..., 2]], -1)
    n /= np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-9)
    out = np.concatenate([n * 0.5 + 0.5, np.ones((h, w, 1), np.float32)], -1).astype(np.float32)
    im = bpy.data.images.new(name, w, h, alpha=False)
    im.colorspace_settings.name = 'Non-Color'
    im.pixels.foreach_set(out.ravel())
    save_image(im, path)
    return im


# ---------------------------------------------------------------------------
# ① 肌
# ---------------------------------------------------------------------------
def face_frame(rig):
    eL, eR = bone_head(rig, 'eye.L'), bone_head(rig, 'eye.R')
    ec = (eL + eR) / 2
    return dict(eL=eL, eR=eR, ec=ec, eye_z=float(ec[2]), head=bone_head(rig, 'head'),
                head_top=bone_tail(rig, 'head'), jaw=bone_head(rig, 'jaw'))


def skin_masks(body, rig, eyes_obj):
    co, nr = rest_mesh_arrays(body)
    F = face_frame(rig)
    x, y, z = co[:, 0], co[:, 1], co[:, 2]
    ez, ec = F['eye_z'], F['ec']
    head = (group_mask(body, 'head') + group_mask(body, 'jaw')) * (group_mask(body, 'body') > 0.5)
    front = smoothstep(-0.2, -0.75, nr[:, 1])                        # 前向きの面
    face = (z > ez - 0.14) * (z < ez + 0.12) * smoothstep(ec[1] + 0.03, ec[1] - 0.03, y)
    # T字部: 額の中央と鼻筋
    fore = smoothstep(ez + 0.015, ez + 0.035, z) * smoothstep(ez + 0.10, ez + 0.07, z) * smoothstep(0.065, 0.03, np.abs(x))
    nose = smoothstep(ez + 0.01, ez - 0.005, z) * smoothstep(ez - 0.075, ez - 0.055, z) * smoothstep(0.03, 0.012, np.abs(x))
    nose_br = smoothstep(ez + 0.02, ez + 0.0, z) * smoothstep(ez - 0.02, ez - 0.0, z) * smoothstep(0.016, 0.006, np.abs(x))
    tz = np.clip(np.maximum(fore, np.maximum(nose, nose_br)) * front * face, 0, 1)
    # 無精ひげ: 頬の下〜あご〜上唇〜あご下。唇は除外
    lips = group_mask(body, 'lips')
    below = smoothstep(ez - 0.05, ez - 0.075, z)
    above_neck = smoothstep(ez - 0.20, ez - 0.16, z)
    side = smoothstep(ec[1] + 0.06, ec[1] + 0.02, y)                 # 耳より前
    stub = np.clip(below * above_neck * side * (1 - smoothstep(0.2, 0.6, lips)) * (head > 0.05), 0, 1)
    # まぶた縁: 眼球表面から 0〜4mm
    eco, _ = rest_mesh_arrays(eyes_obj)
    bvh = BVHTree.FromPolygons([tuple(v) for v in eco], [tuple(p.vertices) for p in eyes_obj.data.polygons])
    d = np.full(len(co), 1.0, np.float32)
    near = np.where(np.linalg.norm(co - ec, axis=1) < 0.08)[0]
    for i in near:
        hit = bvh.find_nearest(Vector(co[i]))
        if hit[0] is not None:
            d[i] = hit[3]
    rim = smoothstep(0.0035, 0.0012, d)
    under = smoothstep(ez - 0.005, ez - 0.012, z) * smoothstep(ez - 0.045, ez - 0.03, z) * \
        smoothstep(0.065, 0.045, np.abs(np.abs(x) - abs(F['eL'][0]) + 0.045)) * front * face
    # 老人斑の出やすい所: 額・こめかみ・頬骨・手の甲
    hands = np.zeros(len(co), np.float32)
    for g in ('wrist.L', 'wrist.R', 'metacarpal1.L', 'metacarpal2.L', 'metacarpal3.L', 'metacarpal4.L',
              'metacarpal1.R', 'metacarpal2.R', 'metacarpal3.R', 'metacarpal4.R'):
        hands = np.maximum(hands, group_mask(body, g))
    spots = np.clip(np.maximum(face * smoothstep(ez - 0.06, ez - 0.02, z) * (head > 0.05), hands), 0, 1)
    Cc = np.array([0.0, ec[1] + 0.075, ez + 0.02], np.float32)
    q = co - Cc
    scalp = smoothstep(-0.006, 0.004, z - ez - hairline_z(np.degrees(np.arctan2(q[:, 0], -q[:, 1])))) * \
        (head > 0.3) * (group_mask(body, 'ears') < 0.05)
    set_point_attr(body, 'n2_scalp', scalp)
    # くぼみ(凹面): 近傍の平均位置が法線の内側にあるほど凹。眼窩・頬のこけ・こめかみの影に使う
    me_ = body.data
    ev_ = np.empty(len(me_.edges) * 2, np.int32); me_.edges.foreach_get('vertices', ev_); ev_ = ev_.reshape(-1, 2)
    acc = np.zeros_like(co); cnt = np.zeros(len(co), np.float32); el = np.zeros(len(co), np.float32)
    for a_, b_ in ((0, 1), (1, 0)):
        np.add.at(acc, ev_[:, a_], co[ev_[:, b_]]); np.add.at(cnt, ev_[:, a_], 1)
        np.add.at(el, ev_[:, a_], np.linalg.norm(co[ev_[:, 0]] - co[ev_[:, 1]], axis=1))
    lap = acc / np.maximum(cnt, 1)[:, None] - co
    cav = (lap * nr).sum(1) / np.maximum(el / np.maximum(cnt, 1), 1e-5)
    for _ in range(3):
        sm = np.zeros(len(co), np.float32)
        np.add.at(sm, ev_[:, 0], cav[ev_[:, 1]]); np.add.at(sm, ev_[:, 1], cav[ev_[:, 0]])
        cav = 0.5 * cav + 0.5 * sm / np.maximum(cnt, 1)
    cav = np.clip(cav / 0.12, 0, 1) * (head > 0.05)
    # 手: 甲(A ポーズで上を向く面)・関節(指の付け根と第2関節)
    hand = np.zeros(len(co), np.float32)
    for g in body.vertex_groups:
        if g.name.startswith(('wrist', 'metacarpal', 'finger')):
            hand = np.maximum(hand, group_mask(body, g.name))
    hand *= (group_mask(body, 'body') > 0.5)
    back = hand * smoothstep(0.0, 0.35, nr[:, 2])
    knuck = np.zeros(len(co), np.float32)
    for side_ in ('L', 'R'):
        for f in range(1, 6):
            for k in (1, 2):
                bn = f'finger{f}-{k}.{side_}'
                if bn in rig.data.bones:
                    knuck = np.maximum(knuck, smoothstep(0.014, 0.004, np.linalg.norm(co - bone_head(rig, bn), axis=1)))
    knuck *= hand
    # 首筋の腱(胸鎖乳突筋): 耳の後ろ → 胸骨の上
    tend = np.zeros(len(co), np.float32)
    hh_, n1 = bone_head(rig, 'head'), bone_head(rig, 'neck01')
    for sx in (1, -1):
        a_ = np.array([sx * 0.048, hh_[1] + 0.015, hh_[2] - 0.005], np.float32)
        b_ = np.array([sx * 0.014, n1[1] - 0.045, n1[2] + 0.01], np.float32)
        a_ = co[np.argmin(np.linalg.norm(co - a_, axis=1))]; b_ = co[np.argmin(np.linalg.norm(co - b_, axis=1))]
        t_, d_ = seg_param(co, a_, b_)
        tend = np.maximum(tend, np.exp(-(d_ / 0.008) ** 2) * (t_ > 0.05) * (t_ < 0.95))
    # 口角の内側(大きく口を開けると表に出る、MakeHuman の肌テクスチャの赤い粘膜部分)
    lipm = group_mask(body, 'lips') > 0.3
    corner = np.zeros(len(co), np.float32)
    if lipm.any():
        lp_ = co[lipm]
        for sgn in (1, -1):
            cpt = lp_[np.argmax(lp_[:, 0] * sgn)]
            corner = np.maximum(corner, smoothstep(0.012, 0.004, np.linalg.norm(co - cpt, axis=1)))
    set_point_attr(body, 'n2_corner', corner)
    for name_, v_ in (('n2_cav', cav), ('n2_hand', hand), ('n2_handback', back), ('n2_knuck', knuck), ('n2_tendon', tend)):
        set_point_attr(body, name_, v_)
    forehead = np.clip(smoothstep(ez + 0.03, ez + 0.045, z) * smoothstep(ez + 0.095, ez + 0.075, z) *
                       smoothstep(0.075, 0.045, np.abs(x)) * front * face, 0, 1)
    for name, v in (('n2_fore', forehead), ('n2_tzone', tz), ('n2_stubble', stub), ('n2_rim', rim), ('n2_under', under),
                    ('n2_spots', spots), ('n2_lips', lips), ('n2_face', face * (head > 0.05))):
        set_point_attr(body, name, v)
    LOG(f'skin masks: tzone {int((tz > 0.5).sum())} stubble {int((stub > 0.5).sum())} rim {int((rim > 0.5).sum())} verts')
    return F


def skin_group(body):
    m = body.material_slots[0].material
    return m, next(n for n in m.node_tree.nodes if n.bl_idname == 'ShaderNodeGroup')


def upgrade_skin(body, rig, eyes_obj, size=4096):
    F = skin_masks(body, rig, eyes_obj)
    m, grp = skin_group(body)
    src_img = next(n.image for n in grp.node_tree.nodes if n.bl_idname == 'ShaderNodeTexImage' and n.name == 'DiffuseTexture')
    bm = bpy.data.materials.new(f'N2_{CID}_SkinBake')
    n = N(bm)
    oc = n.obj_coord()
    base = n.img(src_img, 'UVMap').outputs['Color']
    tz, stub, rim, under, spots, lips = (n.attr(a) for a in ('n2_tzone', 'n2_stubble', 'n2_rim', 'n2_under', 'n2_spots', 'n2_lips'))
    # --- 色 ---
    mott = n.noise(oc, 180.0, 3.0, 0.6)                                   # 細かいまだら(血管・色むら)
    col = n.mix(base, n.mix(base, (0.70, 0.58, 0.54, 1), 1.0, 'MULTIPLY'), n.math('MULTIPLY', n.math('SUBTRACT', mott, 0.5), 0.35, clamp=True))
    # 老人斑(数 mm〜1cm の茶色いシミ、密度は低周波ノイズで偏らせる)
    sp_v = n.voronoi(oc, 70.0, 1.0)
    sp_d = n.noise(oc, 9.0, 2.0, 0.5)
    sp = n.math('MULTIPLY', n.ramp(sp_v, 0.22, 0.10), n.ramp(sp_d, 0.52, 0.62))
    sp = n.math('MULTIPLY', sp, spots)
    col = n.mix(col, (0.42, 0.30, 0.22, 1), n.math('MULTIPLY', sp, 0.55))
    # 小さいシミ・ほくろ
    sp2 = n.math('MULTIPLY', n.ramp(n.voronoi(oc, 260.0, 1.0), 0.12, 0.05), n.ramp(n.noise(oc, 25.0), 0.55, 0.65))
    col = n.mix(col, (0.36, 0.25, 0.19, 1), n.math('MULTIPLY', n.math('MULTIPLY', sp2, spots), 0.5))
    # 目の下のくすみ
    col = n.mix(col, n.mix(col, (0.55, 0.45, 0.50, 1), 1.0, 'MULTIPLY'), n.math('MULTIPLY', under, 0.55))
    # まぶた縁の赤み(粘膜寄り)
    col = n.mix(col, (0.60, 0.36, 0.34, 1), n.math('MULTIPLY', rim, 0.28))
    # 無精ひげ: 1mm 弱の点(白黒まじり)＋剃り跡の青黒い影
    dots = n.ramp(n.voronoi(oc, 2200.0, 1.0), 0.28, 0.12)
    salt = n.ramp(n.noise(oc, 900.0, 0.0), 0.5, 0.56)
    hair_col = n.mix((0.07, 0.065, 0.06, 1), (0.42, 0.41, 0.39, 1), salt)
    stub_d = n.math('MULTIPLY', stub, n.ramp(n.noise(oc, 30.0, 2.0), 0.35, 0.55))
    col = n.mix(col, n.mix(col, (0.55, 0.56, 0.60, 1), 1.0, 'MULTIPLY'), n.math('MULTIPLY', stub, 0.55))
    col = n.mix(col, hair_col, n.math('MULTIPLY', dots, n.math('MULTIPLY', stub_d, 0.6)))
    # 髪の生える所の地肌: MakeHuman の描き込み(茶色の短髪)を消し、灰色がかった地肌＋毛根の点に
    scalp = n.attr('n2_scalp')
    sc_col = n.mix(n.mix(col, (0.36, 0.33, 0.31, 1), 0.7), (0.14, 0.13, 0.12, 1), n.math('MULTIPLY', dots, 0.6))
    col = n.mix(col, sc_col, n.math('MULTIPLY', scalp, 0.85))
    # 口角の内側の赤い描き込みを肌色に(attack で口を大きく開けると見えるため)
    col = n.mix(col, n.mix(col, (0.56, 0.45, 0.40, 1), 0.85), n.attr('n2_corner'))
    # 彫りの影: 眼窩・こけた頬・こめかみのくぼみを少し暗く紫がかった色に
    cav = n.attr('n2_cav')
    col = n.mix(col, n.mix(col, (0.62, 0.52, 0.52, 1), 1.0, 'MULTIPLY'), n.math('MULTIPLY', cav, 0.7))
    # 手: 甲の血管(青紫の筋)・関節の赤み・しみを顔と同じ老け具合に
    handb, knk = n.attr('n2_handback'), n.attr('n2_knuck')
    rid = n.math('SUBTRACT', 1.0, n.math('ABSOLUTE', n.math('SUBTRACT', n.math('MULTIPLY', n.noise(oc, 38.0, 2.0, 0.5), 2.0), 1.0)))
    vein = n.math('MULTIPLY', n.ramp(rid, 0.90, 0.985), handb)
    col = n.mix(col, n.mix(col, (0.55, 0.58, 0.78, 1), 1.0, 'MULTIPLY'), n.math('MULTIPLY', vein, 0.55))
    col = n.mix(col, n.mix(col, (0.95, 0.70, 0.66, 1), 1.0, 'MULTIPLY'), n.math('MULTIPLY', knk, 0.65))
    col = n.mix(col, n.mix(col, (0.86, 0.80, 0.70, 1), 1.0, 'MULTIPLY'), n.math('MULTIPLY', n.attr('n2_hand'), 0.6))
    # --- 粗さ: 基本 0.52、T字部は脂でムラに光る、まぶた縁は濡れ、唇はやや艶 ---
    oil = n.math('MULTIPLY', tz, n.ramp(n.noise(oc, 40.0, 3.0), 0.35, 0.65))
    rough = n.fmix(0.58, 0.30, oil)
    rough = n.fmix(rough, 0.12, rim)
    rough = n.fmix(rough, 0.50, lips)
    rough = n.fmix(rough, 0.60, n.math('MULTIPLY', stub, 0.7))
    rough = n.math('ADD', rough, n.math('MULTIPLY', n.math('SUBTRACT', n.noise(oc, 300.0), 0.5), 0.08))
    # --- 高さ(m): 毛穴・肌理・額の横じわ・シミの盛り上がり・ひげの点 → 後で法線へ ---
    pores = n.voronoi(oc, 1800.0, 1.0)
    hgt = n.math('MULTIPLY', n.ramp(pores, 0.0, 0.30), 0.00010)                      # 毛穴 0.1mm
    hgt = n.math('ADD', hgt, n.math('MULTIPLY', n.noise(oc, 700.0, 4.0, 0.6), 0.00006))
    # 額の横じわ: 間隔 1cm 前後の細い線、途切れ途切れに(額だけ)
    wav = n.new('ShaderNodeTexWave', wave_type='BANDS', bands_direction='Z', wave_profile='SIN')
    n.link(oc, wav.inputs['Vector']); wav.inputs['Scale'].default_value = 26.0
    wav.inputs['Distortion'].default_value = 1.2; wav.inputs['Detail'].default_value = 1.0
    line = n.ramp(wav.outputs['Fac'], 0.80, 0.98)
    brk = n.ramp(n.noise(oc, 60.0, 1.0), 0.40, 0.55)
    hgt = n.math('SUBTRACT', hgt, n.math('MULTIPLY', n.math('MULTIPLY', line, n.math('MULTIPLY', n.attr('n2_fore'), brk)), 0.00035))
    hgt = n.math('ADD', hgt, n.math('MULTIPLY', sp, 0.00004))
    hgt = n.math('ADD', hgt, n.math('MULTIPLY', n.math('MULTIPLY', dots, stub_d), 0.00006))
    hgt = n.math('ADD', hgt, n.math('MULTIPLY', vein, 0.0006))                       # 手の甲の血管
    hgt = n.math('ADD', hgt, n.math('MULTIPLY', n.attr('n2_tendon'), 0.0018))         # 首筋の腱
    knw = n.new('ShaderNodeTexWave', wave_type='BANDS', bands_direction='Z')
    n.link(oc, knw.inputs['Vector']); knw.inputs['Scale'].default_value = 40.0; knw.inputs['Distortion'].default_value = 3.0
    hgt = n.math('SUBTRACT', hgt, n.math('MULTIPLY', n.math('MULTIPLY', n.ramp(knw.outputs['Fac'], 0.7, 0.95), knk), 0.0004))
    out = bake(body, 'UVMap', {'_mat': bm, 'albedo': col, 'rough': rough, 'height': hgt}, size, 'skin')
    mpu = meters_per_uv(body, 'UVMap', np.asarray(group_mask(body, 'head') > 0.5, np.float32))
    out['normal'] = height_to_normal(out['height'], mpu, os.path.join(TEX_OUT, f'{CID}_skin_normal.png'), f'{CID}_skin_normal')
    LOG(f'skin normal from height: {mpu:.3f} m/uv')
    # SSS グループへ差し込み: 色=焼いた色、粗さ=焼いた粗さ、法線=焼いた法線(手続きの毛穴 bump は 0 に)
    g = grp.node_tree
    dif = g.nodes['DiffuseTexture']; dif.image = out['albedo']
    pbsdf = next(x for x in g.nodes if x.bl_idname == 'ShaderNodeBsdfPrincipled')
    rt = g.nodes.new('ShaderNodeTexImage'); rt.image = out['rough']; rt.name = 'N2_Rough'
    g.links.new(rt.outputs['Color'], pbsdf.inputs['Roughness'])
    nt_ = g.nodes.new('ShaderNodeTexImage'); nt_.image = out['normal']; nt_.name = 'N2_Normal'
    nm = g.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = 1.0
    g.links.new(nt_.outputs['Color'], nm.inputs['Color'])
    bumpn = pbsdf.inputs['Normal'].links[0].from_node if pbsdf.inputs['Normal'].links else None
    if bumpn is not None and bumpn.bl_idname == 'ShaderNodeBump':
        bumpn.inputs['Strength'].default_value = 0.0
        g.links.new(nm.outputs['Normal'], bumpn.inputs['Normal'])
    else:
        g.links.new(nm.outputs['Normal'], pbsdf.inputs['Normal'])
    if 'Pore strength' in grp.inputs:
        grp.inputs['Pore strength'].default_value = 0.0
    if 'Clearcoat' in grp.inputs:
        grp.inputs['Clearcoat'].default_value = 0.0      # 全体の薄い膜はやめ、艶は T 字部の粗さで出す
    m['n2_albedo'] = out['albedo'].name
    m['n2_rough'] = out['rough'].name
    m['n2_normal'] = out['normal'].name
    return F


def upgrade_eyes(eyes_obj):
    """角膜の光沢層: 眼球の素材をコート付きの低粗さにし、白目をわずかに充血・黄ばませる(焼かずに素材だけ)。"""
    for s in eyes_obj.material_slots:
        m = s.material
        b = next((x for x in m.node_tree.nodes if x.bl_idname == 'ShaderNodeBsdfPrincipled'), None)
        if not b:
            continue
        b.inputs['Roughness'].default_value = 0.05
        b.inputs['Coat Weight'].default_value = 1.0
        b.inputs['Coat Roughness'].default_value = 0.0
        b.inputs['Coat IOR'].default_value = 1.376
        b.inputs['Specular IOR Level'].default_value = 0.6
        m['n2_rough_value'] = 0.05
        # 白目: 真っ白は暗所で光って見えるので、黄ばんだ灰白に(老人の白目)。虹彩はそのまま
        tx = next((x for x in m.node_tree.nodes if x.bl_idname == 'ShaderNodeTexImage' and x.image), None)
        if tx:
            img = tx.image; w, h = img.size
            a = np.empty(w * h * 4, np.float32); img.pixels.foreach_get(a); a = a.reshape(h, w, 4)
            rgb = a[..., :3]; mx = rgb.max(-1); mn = rgb.min(-1)
            sat = np.where(mx > 1e-4, (mx - mn) / np.maximum(mx, 1e-4), 0)
            scl = ((sat < 0.18) & (mx > 0.45))[..., None]
            a[..., :3] = np.where(scl, rgb * np.array([0.80, 0.75, 0.66], np.float32), rgb)
            img.pixels.foreach_set(a.ravel()); save_image(img, os.path.join(TEX_OUT, f'{CID}_iris.png'))
    LOG('eyes: wet coat')



# ---------------------------------------------------------------------------
# ② 髪・眉・まつ毛(ヘアカーブ)＋書き出し用の帯メッシュ
# ---------------------------------------------------------------------------
HAIRLINE = [  # (方位角 度: 0=正面, 90=横, 180=後ろ, 生え際の高さ: 目の高さ基準 m)
    (0, 0.078), (20, 0.076), (38, 0.085), (55, 0.050), (68, -0.005), (78, -0.035), (88, -0.005),
    (100, 0.012), (118, 0.010), (135, -0.040), (155, -0.085), (180, -0.095)]


def hairline_z(az_deg):
    a = np.abs(az_deg)
    xs = [p[0] for p in HAIRLINE]; ys = [p[1] for p in HAIRLINE]
    return np.interp(a, xs, ys)


def sample_on_faces(co, faces, weights, count, rng):
    """面積×重みに比例して面上の点をサンプリング。faces=三角形の頂点番号 (n,3)。戻り: 点・面番号・重心座標。"""
    a, b, c = co[faces[:, 0]], co[faces[:, 1]], co[faces[:, 2]]
    area = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1) * weights
    p = area / area.sum()
    fi = rng.choice(len(faces), size=count, p=p)
    r1, r2 = rng.random(count), rng.random(count)
    s = np.sqrt(r1)
    w0, w1, w2 = 1 - s, s * (1 - r2), s * r2
    pts = a[fi] * w0[:, None] + b[fi] * w1[:, None] + c[fi] * w2[:, None]
    return pts, fi, np.stack([w0, w1, w2], 1)


def tri_arrays(obj):
    me = obj.data
    me.calc_loop_triangles()
    tris = np.empty(len(me.loop_triangles) * 3, np.int32)
    me.loop_triangles.foreach_get('vertices', tris)
    loops = np.empty(len(me.loop_triangles) * 3, np.int32)
    me.loop_triangles.foreach_get('loops', loops)
    return tris.reshape(-1, 3), loops.reshape(-1, 3)


def grow(roots, normals, comb, lengths, npts, rng, lie=0.75, curl=0.0, jitter=0.15):
    """根元から毛を伸ばす。初めは法線寄り、すぐに comb(面に沿った流れ)へ寝る。戻り (n, npts, 3)。"""
    n = len(roots)
    out = np.zeros((n, npts, 3), np.float32)
    out[:, 0] = roots
    p = roots.copy()
    seg = lengths / (npts - 1)
    for k in range(1, npts):
        t = k / (npts - 1)
        w = min(1.0, lie * (0.6 + t))
        d = normals * (1 - w) + comb * w
        d += rng.normal(0, jitter, (n, 3)).astype(np.float32) * 0.5
        if curl:
            d += normals * (-curl * t)
        d /= np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-9)
        p = p + d * seg[:, None]
        out[:, k] = p
    return out


def tangent_flow(normals, flow):
    f = flow - normals * (normals * flow).sum(1, keepdims=True)
    return f / np.maximum(np.linalg.norm(f, axis=1, keepdims=True), 1e-9)


def make_curves_object(name, strands, radius_root, radius_tip, rig, mat, attrs=None):
    n, k, _ = strands.shape
    cv = bpy.data.hair_curves.new(name)
    cv.add_curves([k] * n)
    cv.attributes['position'].data.foreach_set('vector', strands.reshape(-1).astype(np.float32))
    rad = cv.attributes.get('radius') or cv.attributes.new('radius', 'FLOAT', 'POINT')
    r = np.tile(np.linspace(radius_root, radius_tip, k, dtype=np.float32), n)
    rad.data.foreach_set('value', r)
    for an, av in (attrs or {}).items():
        at = cv.attributes.new(an, 'FLOAT', 'CURVE')
        at.data.foreach_set('value', np.asarray(av, np.float32))
    cv.materials.append(mat)
    obj = bpy.data.objects.new(name, cv)
    bpy.context.scene.collection.objects.link(obj)
    # 頭の骨に親子付け(ワールド位置を保つ)
    obj.parent = rig; obj.parent_type = 'BONE'; obj.parent_bone = 'head'
    bpy.context.view_layer.update()
    pb = rig.pose.bones['head']
    obj.matrix_parent_inverse = (rig.matrix_world @ pb.matrix @ Matrix.Translation((0, pb.length, 0))).inverted()
    obj['n2_no_export'] = True
    return obj


def hair_material(name, white_ratio, dark=(0.025, 0.023, 0.021), white=(0.62, 0.61, 0.58)):
    """白髪まじり: 毛ごとの属性 n2_white(0/1)で黒っぽい毛と白い毛を混ぜる(色指定の Principled Hair)。"""
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    for x in list(nt.nodes):
        if x.bl_idname != 'ShaderNodeOutputMaterial':
            nt.nodes.remove(x)
    out = next(x for x in nt.nodes if x.bl_idname == 'ShaderNodeOutputMaterial')
    h = nt.nodes.new('ShaderNodeBsdfHairPrincipled')
    h.parametrization = 'COLOR'
    info = nt.nodes.new('ShaderNodeHairInfo')
    ra = nt.nodes.new('ShaderNodeAttribute'); ra.attribute_name = 'n2_white'; ra.attribute_type = 'GEOMETRY'
    mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'
    mx.inputs[6].default_value = (*dark, 1); mx.inputs[7].default_value = (*white, 1)
    nt.links.new(ra.outputs['Fac'], mx.inputs['Factor'])
    nt.links.new(mx.outputs[2], h.inputs['Color'])
    h.inputs['Roughness'].default_value = 0.40
    h.inputs['Radial Roughness'].default_value = 0.5
    for k, v in (('Random Color', 0.15), ('Random Roughness', 0.2)):
        if k in h.inputs:
            h.inputs[k].default_value = v
    nt.links.new(info.outputs['Random'], h.inputs['Random'])
    nt.links.new(h.outputs['BSDF'], out.inputs['Surface'])
    return m


def strand_texture(path, n_strands=14, seed=3, white_ratio=0.5, w=256, h=1024):
    """帯メッシュ用の毛束テクスチャ(RGBA)。縦に毛が並び、先が細く透ける。"""
    rng = np.random.default_rng(seed)
    img = np.zeros((h, w, 4), np.float32)
    ys = np.arange(h)[:, None]
    xs = np.arange(w)[None, :]
    for i in range(n_strands * 3):
        x0 = rng.uniform(8, w - 8)
        bend = rng.uniform(-14, 14)
        width = rng.uniform(1.2, 2.6)
        length = rng.uniform(0.75, 1.0)
        white = rng.random() < white_ratio
        col = np.array([0.80, 0.79, 0.76]) * rng.uniform(0.85, 1.05) if white else np.array([0.10, 0.095, 0.09]) * rng.uniform(0.8, 1.4)
        t = ys / h                                     # 0=根元(下) 1=先
        cx = x0 + bend * t ** 2
        wd = width * (1 - 0.7 * t)
        a = np.clip(1 - np.abs(xs - cx) / np.maximum(wd, 0.4), 0, 1) * (t < length) * np.clip((length - t) / 0.15, 0, 1)
        a = a.astype(np.float32)
        img[..., :3] = img[..., :3] * (1 - a[..., None]) + col * a[..., None]
        img[..., 3] = np.maximum(img[..., 3], a)
    im = bpy.data.images.new(os.path.splitext(os.path.basename(path))[0], w, h, alpha=True)
    im.pixels.foreach_set(img.ravel())
    save_image(im, path)
    return im


def strips_from_strands(name, strands, normals, width, rig, image, bone='head', rough=0.45):
    """毛(ポリライン)→ 面に沿って寝た細い帯(四角の連なり)。UV: u=幅, v=根元0→先1。"""
    n, k, _ = strands.shape
    verts, faces, uvs = [], [], []
    for i in range(n):
        s = strands[i]
        nrm = normals[i]
        base = len(verts)
        for j in range(k):
            d = s[min(j + 1, k - 1)] - s[max(j - 1, 0)]
            side = np.cross(d, nrm); side /= max(np.linalg.norm(side), 1e-9)
            w = width * (1 - 0.6 * j / (k - 1))
            verts += [tuple(s[j] - side * w / 2), tuple(s[j] + side * w / 2)]
        for j in range(k - 1):
            a = base + 2 * j
            faces.append((a, a + 1, a + 3, a + 2))
            uvs.append([(0, j / (k - 1)), (1, j / (k - 1)), (1, (j + 1) / (k - 1)), (0, (j + 1) / (k - 1))])
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    uvl = me.uv_layers.new(name='UVMap')
    flat = [uv for f in uvs for uv in f]
    uvl.data.foreach_set('uv', np.array(flat, np.float32).ravel())
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = rig
    vg = obj.vertex_groups.new(name=bone); vg.add(list(range(len(verts))), 1.0, 'REPLACE')
    md = obj.modifiers.new('Armature', 'ARMATURE'); md.object = rig
    m = bpy.data.materials.new(name + '_mat')
    b = m.node_tree.nodes['Principled BSDF']
    tx = m.node_tree.nodes.new('ShaderNodeTexImage'); tx.image = image
    m.node_tree.links.new(tx.outputs['Color'], b.inputs['Base Color'])
    m.node_tree.links.new(tx.outputs['Alpha'], b.inputs['Alpha'])
    b.inputs['Roughness'].default_value = rough
    m.surface_render_method = 'BLENDED' if hasattr(m, 'surface_render_method') else None
    m['n2_albedo'] = image.name
    m['n2_alpha'] = True
    me.materials.append(m)
    obj.hide_render = True          # レンダはヘアカーブ、書き出しは帯
    obj['n2_export_only'] = True
    return obj


def make_hair(body, rig, F, cap_plane, rng):
    co, nr = rest_mesh_arrays(body)
    tris, _ = tri_arrays(body)
    headw = np.maximum.reduce([group_mask(body, 'head'), group_mask(body, 'neck03'), group_mask(body, 'neck02'),
                               group_mask(body, 'neck01')]) * (group_mask(body, 'body') > 0.5)
    ears = group_mask(body, 'ears')
    ec = F['ec']
    C = np.array([0.0, ec[1] + 0.075, F['eye_z'] + 0.02], np.float32)
    d = co - C
    az = np.degrees(np.arctan2(d[:, 0], -d[:, 1]))
    rel = co[:, 2] - F['eye_z']
    vw = (rel > hairline_z(az)).astype(np.float32) * (headw > 0.3) * (ears < 0.05)
    # 帽子の中(鉢巻より上)は生やさない(帽子を突き抜けるため)。縁の 1.5cm 下までは短く残す
    pn, pd = cap_plane
    above = co @ pn - pd
    vw *= (above < -0.004)
    fw = vw[tris].max(1)
    count = 40000
    pts, fi, bc = sample_on_faces(co, tris, fw, count * 2, rng)
    # 点ごとに厳密に判定(生え際・帽子の中・耳)して滑らかな境界にする
    q = pts - C
    ok = (pts[:, 2] - F['eye_z'] > hairline_z(np.degrees(np.arctan2(q[:, 0], -q[:, 1])))) & (pts @ pn - pd < -0.002)
    ok &= (ears[tris[fi]] * bc).sum(1) < 0.02
    idx = np.where(ok)[0][:count]
    pts, fi, bc = pts[idx], fi[idx], bc[idx]
    count = len(pts)
    nrm = (nr[tris[fi]] * bc[:, :, None]).sum(1)
    nrm /= np.linalg.norm(nrm, axis=1, keepdims=True)
    pd_ = pts - C
    paz = np.degrees(np.arctan2(pd_[:, 0], -pd_[:, 1]))
    # 流れ: 横は後ろ下へ、もみあげは真下、後ろは下へ
    flow = np.zeros_like(pts); flow[:, 2] = -1.0
    flow[:, 1] = np.where(np.abs(paz) < 80, 0.15, 0.55)
    flow = tangent_flow(nrm, flow)
    near_cap = np.clip((pts @ pn - pd + 0.02) / 0.016, 0, 1)        # 帽子の縁の近くは寝かせて短く
    L = rng.uniform(0.009, 0.014, count).astype(np.float32) * (1 - 0.4 * near_cap)
    L *= np.where(np.abs(paz) > 120, 1.15, 1.0)
    roots = pts + nrm * 0.0004
    strands = grow(roots, nrm, flow, L, 5, rng, lie=0.85, jitter=0.12)
    white = (rng.random(count) < 0.42).astype(np.float32)
    hm = hair_material(f'N2_{CID}_HairMat', 0.55)
    hair = make_curves_object(f'N2E_{CID}.hair', strands, 0.00004, 0.00002, rig, hm, {'n2_white': white})
    LOG(f'hair: {count} strands (curves)')
    # 書き出し用の帯: 9 本に 1 本を束(幅 3mm)にする
    sel = np.arange(0, count, 11)
    tex = strand_texture(os.path.join(TEX_OUT, f'{CID}_hair_strip.png'), seed=11, white_ratio=0.55)
    strip = strips_from_strands(f'N2E_{CID}.hair_strips', grow(roots[sel], nrm[sel], flow[sel], L[sel] * 1.1, 3, rng, lie=0.9, jitter=0.05),
                                nrm[sel], 0.003, rig, tex)
    return hair, strip


def card_hairs(card, image, rig, count, rng, length, flow_fn, white_ratio, alpha_min=0.35):
    """MakeHuman の眉カード上で、テクスチャの毛がある所(α)にだけ根元を置く。"""
    co, nr = rest_mesh_arrays(card)
    tris, loops = tri_arrays(card)
    uv = np.empty(len(card.data.loops) * 2, np.float32); card.data.uv_layers.active.data.foreach_get('uv', uv)
    uv = uv.reshape(-1, 2)
    w, h = image.size
    px = np.empty(w * h * 4, np.float32); image.pixels.foreach_get(px); px = px.reshape(h, w, 4)
    pts, fi, bc = sample_on_faces(co, tris, np.ones(len(tris), np.float32), count * 6, rng)
    puv = (uv[loops[fi]] * bc[:, :, None]).sum(1)
    al = px[np.clip((puv[:, 1] * h).astype(int), 0, h - 1), np.clip((puv[:, 0] * w).astype(int), 0, w - 1), 3]
    keep = np.where(al > alpha_min)[0][:count]
    pts, fi = pts[keep], fi[keep]
    nrm = (nr[tris[fi]] * bc[keep][:, :, None]).sum(1); nrm /= np.linalg.norm(nrm, axis=1, keepdims=True)
    flow = tangent_flow(nrm, flow_fn(pts))
    L = length * rng.uniform(0.7, 1.15, len(pts)).astype(np.float32)
    return pts, nrm, flow, L


def make_brows_lashes(objs, rig, F, rng):
    brow = objs[[k for k in objs if k.startswith('eyebrow')][0]]
    lash = objs[[k for k in objs if k.startswith('eyelashes')][0]]
    bimg = next(n.image for n in brow.material_slots[0].material.node_tree.nodes if n.bl_idname == 'ShaderNodeTexImage')
    ec = F['ec']
    def bflow(p):   # 眉頭は上向き、眉尻は外側へ
        side = np.sign(p[:, 0])[:, None]
        t = np.clip((np.abs(p[:, 0]) - 0.012) / 0.05, 0, 1)[:, None]
        f = np.concatenate([side * (0.2 + 0.8 * t), np.zeros_like(t), 0.9 * (1 - t) + 0.15], 1)
        return f.astype(np.float32)
    pts, nrm, flow, L = card_hairs(brow, bimg, rig, 900, rng, 0.0085, bflow, 0.4)
    bs = grow(pts + nrm * 0.0003, nrm, flow, L, 4, rng, lie=0.9, jitter=0.18)
    bw = (rng.random(len(pts)) < 0.4).astype(np.float32)
    bm = hair_material(f'N2_{CID}_BrowMat', 0.4)
    brows = make_curves_object(f'N2E_{CID}.brows', bs, 0.00005, 0.00002, rig, bm, {'n2_white': bw})
    # まつ毛: カードの頂点を「眼球に近い列=根元」「遠い列=先」に分けて、根元の線に沿って生やす
    co, _ = rest_mesh_arrays(lash)
    import bmesh as _bm
    bmh = _bm.new(); bmh.from_mesh(lash.data)
    seen, islands = set(), []
    for v in bmh.verts:
        if v.index in seen:
            continue
        st, comp = [v], []
        while st:
            x = st.pop()
            if x.index in seen:
                continue
            seen.add(x.index); comp.append(x.index)
            st += [e.other_vert(x) for e in x.link_edges]
        islands.append(np.array(comp))
    bmh.free()
    ls_all = []
    for isl in islands:
        p = co[isl]
        eye = F['eL'] if p[:, 0].mean() > 0 else F['eR']
        dist = np.linalg.norm(p - eye, axis=1)
        upper = p[:, 2].mean() > eye[2]
        roots = p[dist < dist.min() + 0.0012]; tips = p[dist > dist.max() - 0.0012]
        roots = roots[np.argsort(roots[:, 0])]; tips = tips[np.argsort(tips[:, 0])]
        m = 70 if upper else 24
        s = np.sort(rng.random(m))
        def along(arr, s):
            seg = np.linalg.norm(np.diff(arr, axis=0), axis=1); cum = np.concatenate([[0], np.cumsum(seg)]); cum /= cum[-1]
            return np.stack([np.interp(s, cum, arr[:, i]) for i in range(3)], 1)
        r = along(roots, s); t = along(tips, s)
        k = 4
        st = np.zeros((m, k, 3), np.float32)
        lenf = rng.uniform(0.75, 1.0, m)[:, None] * (0.55 if not upper else 1.0)
        for j in range(k):
            u = j / (k - 1)
            pnt = r + (t - r) * (u * lenf)
            pnt[:, 2] += (0.0012 if upper else -0.0006) * (u ** 2)     # 先が反る
            st[:, j] = pnt
        ls_all.append(st)
    ls = np.concatenate(ls_all)
    lm = hair_material(f'N2_{CID}_LashMat', 0.1, dark=(0.012, 0.011, 0.010))
    lashes = make_curves_object(f'N2E_{CID}.lashes', ls, 0.000045, 0.000015, rig, lm,
                                {'n2_white': (rng.random(len(ls)) < 0.1).astype(np.float32)})
    LOG(f'brows: {len(bs)} strands, lashes: {len(ls)} strands')
    # 書き出し用の帯
    btex = strand_texture(os.path.join(TEX_OUT, f'{CID}_brow_strip.png'), n_strands=6, seed=5, white_ratio=0.4, w=128, h=256)
    bsel = np.arange(0, len(bs), 3)
    bstrip = strips_from_strands(f'N2E_{CID}.brow_strips', bs[bsel], nrm[bsel], 0.0016, rig, btex)
    ltex = strand_texture(os.path.join(TEX_OUT, f'{CID}_lash_strip.png'), n_strands=5, seed=7, white_ratio=0.05, w=128, h=256)
    lnorm = np.tile(np.array([[0, -1, 0]], np.float32), (len(ls), 1))
    lsel = np.arange(0, len(ls), 2)
    lstrip = strips_from_strands(f'N2E_{CID}.lash_strips', ls[lsel], lnorm[lsel], 0.0012, rig, ltex)
    for o in (brow, lash):        # MakeHuman のカードは型紙として使い終わり。描画も書き出しもしない
        o.hide_render = True; o.hide_viewport = True; o['n2_no_export'] = True
    return [brows, lashes], [bstrip, lstrip]


# ---------------------------------------------------------------------------
# ④ 制帽(自作): 芯のある円筒形のクラウン＋平らな天井＋硬いつば＋鉢巻＋帽章。テクスチャは numpy で描く
# ---------------------------------------------------------------------------
def cap_plane_from_head(body, F, fz_off=0.046, bz_off=0.014):
    co, _ = rest_mesh_arrays(body)
    headw = group_mask(body, 'head') * (group_mask(body, 'body') > 0.5) * (group_mask(body, 'ears') < 0.05)
    hv = co[headw > 0.3]
    ez = F['eye_z']
    fz, bz = ez + fz_off, ez + bz_off                     # 帽子の縁: 額の前と後頭部の高さ
    fy = hv[(np.abs(hv[:, 0]) < 0.02) & (np.abs(hv[:, 2] - fz) < 0.01)][:, 1].min()
    by = hv[(np.abs(hv[:, 0]) < 0.02) & (np.abs(hv[:, 2] - bz) < 0.01)][:, 1].max()
    Fp = np.array([0, fy, fz], np.float32); Bp = np.array([0, by, bz], np.float32)
    nrm = np.cross(np.array([1, 0, 0], np.float32), Bp - Fp)
    nrm /= np.linalg.norm(nrm)
    if nrm[2] < 0:
        nrm = -nrm
    return nrm, float(nrm @ Fp), hv, Fp, Bp


def cap_texture(size=1024):
    """紺の綾織り＋ステッチ(クラウン上下・天井の縁・つばの平行ステッチ)。色・高さ(→法線)・粗さを返す。"""
    rng = np.random.default_rng(21)
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size
    twill = 0.5 + 0.5 * np.sin((xx + yy) * size * np.pi * 0.9)          # 斜めの綾目
    fiber = rng.normal(0, 1, (size, size)).astype(np.float32)
    k = 3
    for _ in range(2):   # 軽くぼかした繊維ムラ
        fiber = (np.roll(fiber, 1, 0) + np.roll(fiber, -1, 0) + np.roll(fiber, 1, 1) + np.roll(fiber, -1, 1) + fiber) / 5
    h = 0.08 * twill + 0.06 * fiber
    stitch = np.zeros_like(xx)
    def stitch_row(mask_line, along):
        dash = (np.sin(along * np.pi * 2) > -0.2).astype(np.float32)
        return mask_line * dash
    def line(coord, c, w):
        return np.clip(1 - np.abs(coord - c) / w, 0, 1)
    # クラウン側面 v∈[0,0.36]: 上端と下端に 1 本ずつ、前の縦の縫い目 2 本
    side = (yy < 0.36)
    stitch += side * stitch_row(line(yy, 0.010, 0.0016), xx * 260)
    for k6 in range(6):    # 6 枚はぎの縫い目(頂点で集まる)
        stitch += side * stitch_row(line(xx, (k6 + 0.5) / 6, 0.0013), yy * 260)
    # 天井 [0,0.5]x[0.5,1]: 縁から少し内側に円のステッチ
    cx, cy = 0.25, 0.75
    rr = np.hypot(xx - cx, yy - cy)
    topm = (xx < 0.5) & (yy > 0.5)
    ang = np.arctan2(yy - cy, xx - cx)
    stitch += topm * stitch_row(line(rr, 0.225, 0.0015), ang * 60)
    # つば [0.5,1]x[0.5,1]: v は根元→先。先端に沿って 4 本の平行ステッチ
    brim = (xx > 0.5) & (yy > 0.5)
    for vv in (0.93, 0.95, 0.965, 0.98):
        stitch += brim * stitch_row(line(yy, vv, 0.0014), xx * 300)
    # 鉢巻 v∈[0.37,0.45]: 上下に 1 本ずつ
    band = (yy > 0.37) & (yy < 0.45)
    stitch += band * stitch_row(line(yy, 0.376, 0.0012) + line(yy, 0.444, 0.0012), xx * 300)
    stitch = np.clip(stitch, 0, 1)
    h = h - 0.9 * stitch
    navy = np.array([0.105, 0.125, 0.215], np.float32)   # sRGB(つなぎの紺に合わせる)
    col = navy[None, None, :] * (0.94 + 0.08 * twill[..., None] + 0.05 * fiber[..., None])
    col = col * (1 - 0.35 * stitch[..., None])                          # 糸の溝は暗く
    # 縁の帯は同じ紺(色を変えない)
    # 使い込み: クラウン上端の縁・つばの先が擦れて色が抜け、全体に薄いくすみ
    edge_wear = np.zeros_like(xx)
    edge_wear += side * np.clip(1 - np.abs(yy - 0.355) / 0.012, 0, 1)
    edge_wear += topm * np.clip(1 - np.abs(rr - 0.235) / 0.02, 0, 1)
    edge_wear += brim * np.clip((yy - 0.95) / 0.05, 0, 1)
    blot = rng.normal(0, 1, (size // 16, size // 16)).astype(np.float32)
    blot = np.kron(blot, np.ones((16, 16), np.float32))
    for _ in range(6):
        blot = (np.roll(blot, 3, 0) + np.roll(blot, -3, 0) + np.roll(blot, 3, 1) + np.roll(blot, -3, 1) + blot) / 5
    ew = np.clip(edge_wear * (0.5 + 0.8 * np.clip(blot, 0, 1)), 0, 1)
    col = col * (1 - 0.35 * ew[..., None]) + np.array([0.30, 0.32, 0.38], np.float32) * 0.35 * ew[..., None]
    col = col * (0.96 + 0.06 * np.clip(blot, -1, 1)[..., None])
    rough = np.full_like(xx, 0.74); rough[brim] = 0.58; rough[band] = 0.62
    rough += 0.04 * fiber
    # 高さ→法線(タンジェント空間、OpenGL)
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    s_ = 1.5
    nx, ny, nz = -gx * s_, -gy * s_, np.ones_like(h)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    nmap = np.stack([nx / ln * 0.5 + 0.5, ny / ln * 0.5 + 0.5, nz / ln * 0.5 + 0.5], -1)
    def mk(name, arr3, non_color):
        a4 = np.concatenate([arr3, np.ones(arr3.shape[:2] + (1,), np.float32)], -1)
        im = bpy.data.images.new(name, size, size, alpha=False)
        im.colorspace_settings.name = 'Non-Color' if non_color else 'sRGB'
        im.pixels.foreach_set(np.clip(a4, 0, 1).astype(np.float32).ravel())
        save_image(im, os.path.join(TEX_OUT, name + '.png'))
        return im
    lin2srgb = lambda c: np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.clip(c, 0, 1), 1 / 2.4) - 0.055)
    return (mk(f'{CID}_cap_albedo', col, False),
            mk(f'{CID}_cap_normal', nmap, True),
            mk(f'{CID}_cap_rough', np.repeat(rough[..., None], 3, -1), True))


CAP_BAND = 0.006          # 縁: 同色の細いステッチ帯(高さ 6mm、ほぼ面一)
CAP_TOP_GAP = 0.0055      # 頭頂から天井(外面)までのすき間(機械チェックは ≤10mm)


def make_cap(body, rig, F):
    """P1 の 04 の帽子: 頭蓋に沿ったドーム型クラウン(6 枚はぎ)＋前だけの湾曲したつば。
    天井は平らにしない・側面も垂直にしない(=頭の包絡そのもの＋ゆとり)。縁は額の眉上 4cm。"""
    nrm, dpl, hv, Fp, Bp = cap_plane_from_head(body, F, 0.040, 0.008)
    h = hv @ nrm - dpl
    up = Vector(nrm)
    fwd = Vector((0, -1, 0)); fwd = (fwd - up * fwd.dot(up)).normalized()
    side = fwd.cross(up).normalized()
    above = hv[h > -0.002]
    ring = hv[(h > -0.004) & (h < 0.02)]
    cen = Vector(((ring[:, 0].max() + ring[:, 0].min()) / 2, (ring[:, 1].max() + ring[:, 1].min()) / 2, 0))
    cen.z = (dpl - nrm[0] * cen.x - nrm[1] * cen.y) / nrm[2]   # 鉛直に動かして平面上へ
    rel = above - np.array(cen)
    lx = rel @ np.array(side); ly = rel @ np.array(fwd); lz = rel @ nrm
    az_v = np.arctan2(lx, ly)
    rad_v = np.hypot(lx, ly)
    NA = 64
    azs = np.linspace(-np.pi, np.pi, NA, endpoint=False)
    head_top = float(lz.max())
    top = head_top + CAP_TOP_GAP
    NR = 12
    # 高さは上ほど細かく(ドームの丸みを出す)
    hs = np.sin(np.linspace(0, np.pi / 2, NR + 1)[:-1]) * top     # 最上段は頭頂の手前(最後は中心の 1 点で閉じる)
    # 各高さ・方位の頭の半径(その高さ以上の最大)＋ゆとり = 頭蓋に密着するドーム
    R = np.zeros((NR, NA))
    for j, hh in enumerate(hs):
        selh = lz >= hh - 0.004
        for i, a in enumerate(azs):
            dd = np.abs((az_v - a + np.pi) % (2 * np.pi) - np.pi)
            sel = selh & (dd < np.radians(10))
            R[j, i] = rad_v[sel].max() if sel.any() else 0.0
    for j in range(NR - 2, -1, -1):
        R[j] = np.maximum(R[j], R[j + 1])
    for _ in range(4):
        R = np.maximum(R, (np.roll(R, 1, 1) + np.roll(R, -1, 1) + 2 * R) / 4)
    R += 0.0075
    # 上部は楕円のドームで滑らかに閉じる(頭の包絡より内側には入れない=密着しつつ尖り・ねじれを出さない)
    j0 = int(NR * 0.45)
    h0 = hs[j0]
    for j in range(j0 + 1, NR):
        t = (hs[j] - h0) / max(top - h0, 1e-6)
        R[j] = np.maximum(R[j0] * np.sqrt(max(1 - t * t, 0.0)), R[j])
    for _ in range(2):
        R[j0:] = np.maximum(R[j0:], (np.roll(R[j0:], 1, 1) + np.roll(R[j0:], -1, 1) + 2 * R[j0:]) / 4)
    r_side = R[0].copy()
    verts, faces, uvs, mats = [], [], [], []
    def P(a_idx, r, hh):
        a = azs[a_idx % NA]
        return Vector(cen) + side * (math.sin(a) * r) + fwd * (math.cos(a) * r) + up * hh
    rows = []
    for j, hh in enumerate(hs):
        rows.append([len(verts) + i for i in range(NA)])
        for i in range(NA):
            verts.append(P(i, R[j, i], hh))
    for j in range(NR - 1):
        for i in range(NA):
            a, b = rows[j][i], rows[j][(i + 1) % NA]
            c, d = rows[j + 1][(i + 1) % NA], rows[j + 1][i]
            faces.append((a, b, c, d)); mats.append(0)
            u0, u1 = i / NA, (i + 1) / NA
            v0, v1 = 0.36 * j / (NR - 1), 0.36 * (j + 1) / (NR - 1)
            uvs.append([(u0, v0), (u1, v0), (u1, v1), (u0, v1)])
    cidx = len(verts); verts.append(Vector(cen) + up * top)
    for i in range(NA):
        a, b = rows[-1][i], rows[-1][(i + 1) % NA]
        faces.append((a, b, cidx)); mats.append(0)
        uvs.append([(i / NA, 0.36), ((i + 1) / NA, 0.36), ((i + 0.5) / NA, 0.36)])
    # 縁: 同色の細いステッチ帯(6mm、0.6mm だけ浮かす)
    b0 = [len(verts) + i for i in range(NA)]
    for i in range(NA):
        verts.append(P(i, R[0, i] + 0.0006, -0.001))
    b1 = [len(verts) + i for i in range(NA)]
    for i in range(NA):
        verts.append(P(i, np.interp(CAP_BAND, hs, R[:, i]) + 0.0006, CAP_BAND))
    for i in range(NA):
        faces.append((b0[i], b0[(i + 1) % NA], b1[(i + 1) % NA], b1[i])); mats.append(1)
        uvs.append([(i / NA, 0.37), ((i + 1) / NA, 0.37), ((i + 1) / NA, 0.45), (i / NA, 0.45)])
    # つば: 前だけ ±50°、幅(出) 6.5cm。横から見て弧(先へ行くほど下がる)＋ 左右の端も下がる
    BA = np.radians(50)
    NB, NS = 33, 6
    brim_rows = []
    for si in range(NS):
        s_ = si / (NS - 1)
        row = []
        for bi in range(NB):
            a = -BA + 2 * BA * bi / (NB - 1)
            L = 0.065 * max(0.0, math.cos(a / BA * math.pi / 2)) ** 0.7
            i_f = (a + np.pi) / (2 * np.pi) * NA
            r0 = np.interp(i_f, np.arange(NA + 1), np.append(r_side, r_side[0])) - 0.002 + 0.0042 * min(1.0, s_ * 4)
            base = Vector(cen) + side * (math.sin(a) * r0) + fwd * (math.cos(a) * r0)
            out = (side * math.sin(a) + fwd * math.cos(a)).normalized()
            dist = L * s_
            p = base + up * (0.002 * (1 - min(1.0, s_ * 4))) + out * dist - up * (math.tan(math.radians(3)) * dist + 2.6 * dist * dist + 0.010 * (a / BA) ** 2 * s_)
            row.append(len(verts)); verts.append(p)
        brim_rows.append(row)
    for si in range(NS - 1):
        for bi in range(NB - 1):
            a, b = brim_rows[si][bi], brim_rows[si][bi + 1]
            c, d = brim_rows[si + 1][bi + 1], brim_rows[si + 1][bi]
            faces.append((a, b, c, d)); mats.append(2)
            u0, u1 = 0.5 + 0.5 * bi / (NB - 1), 0.5 + 0.5 * (bi + 1) / (NB - 1)
            v0, v1 = 0.5 + 0.5 * si / (NS - 1), 0.5 + 0.5 * (si + 1) / (NS - 1)
            uvs.append([(u0, v0), (u1, v0), (u1, v1), (u0, v1)])
    me = bpy.data.meshes.new(f'N2E_{CID}_cap')
    me.from_pydata([tuple(v) for v in verts], [], faces)
    uvl = me.uv_layers.new(name='UVMap')
    for poly, fu in zip(me.polygons, uvs):
        for li, uv in zip(poly.loop_indices, fu):
            uvl.data[li].uv = uv
    for poly, mi in zip(me.polygons, mats):
        poly.material_index = mi
    # 厚み(bmesh solidify): クラウンと鉢巻 2.5mm、つば 4mm は別々に
    bm = bmesh.new(); bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    brim_f = [f for f in bm.faces if f.material_index == 2]
    rest_f = [f for f in bm.faces if f.material_index != 2]
    bmesh.ops.solidify(bm, geom=brim_f, thickness=0.004)
    bmesh.ops.solidify(bm, geom=rest_f, thickness=0.0025)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    for p_ in me.polygons:
        p_.use_smooth = True
    obj = bpy.data.objects.new(f'N2E_{CID}.cap', me)
    bpy.context.scene.collection.objects.link(obj)
    # 素材
    alb, nmi, rgh = cap_texture()
    def capmat(name, rough_override=None, darker=1.0):
        m = bpy.data.materials.new(name)
        nt = m.node_tree; b = nt.nodes['Principled BSDF']
        t1 = nt.nodes.new('ShaderNodeTexImage'); t1.image = alb
        t2 = nt.nodes.new('ShaderNodeTexImage'); t2.image = nmi
        t3 = nt.nodes.new('ShaderNodeTexImage'); t3.image = rgh
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(t1.outputs['Color'], b.inputs['Base Color'])
        nt.links.new(t2.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
        nt.links.new(t3.outputs['Color'], b.inputs['Roughness'])
        b.inputs['Sheen Weight'].default_value = 0.05; b.inputs['Sheen Roughness'].default_value = 0.5
        m['n2_albedo'] = alb.name; m['n2_normal'] = nmi.name; m['n2_rough'] = rgh.name
        return m
    mc = capmat(f'N2E_{CID}_cap_crown')
    me.materials.append(mc)        # クラウン・鉢巻・つばは同じアトラス(UV で描き分け)。素材は部位ごとに分けて残す
    for part in ('band', 'brim'):
        mm = mc.copy(); mm.name = f'N2E_{CID}_cap_{part}'; me.materials.append(mm)
    for o in (obj,):
        o.parent = rig
        vg = o.vertex_groups.new(name='head'); vg.add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')
        md = o.modifiers.new('Armature', 'ARMATURE'); md.object = rig
        sd = o.modifiers.new('Subdivision', 'SUBSURF'); sd.levels = 0; sd.render_levels = 1
    obj['n2_cap_up'] = [float(v) for v in up]; obj['n2_cap_d'] = float(dpl)
    obj['n2_cap_head_top'] = head_top
    LOG(f'cap: dome r={r_side.min():.3f}..{r_side.max():.3f} 縁〜天井={top * 1000:.0f}mm '
        f'(頭頂+{(top - head_top) * 1000:.1f}mm) faces={len(me.polygons)}')
    return obj, None, (np.array(up), float(dpl))


# ---------------------------------------------------------------------------
# ③ つなぎ: 間引き → 重ならない UV → 皺・すれ・油染み・布目を焼く
# ---------------------------------------------------------------------------
def apply_modifier_first(obj, md):
    with bpy.context.temp_override(object=obj, active_object=obj, selected_objects=[obj]):
        bpy.ops.object.modifier_move_to_index(modifier=md.name, index=0)
        bpy.ops.object.modifier_apply(modifier=md.name)


def smart_uv(obj, name, margin=0.004):
    uvl = obj.data.uv_layers.new(name=name)
    obj.data.uv_layers.active = uvl
    for o in bpy.context.scene.objects:
        o.select_set(False)
    obj.hide_viewport = False
    obj.select_set(True); bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=margin, area_weight=0.0, scale_to_bounds=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    return uvl


def seg_param(p, a, b):
    ab = b - a
    t = np.clip(((p - a) @ ab) / max(ab @ ab, 1e-9), 0, 1)
    d = np.linalg.norm(p - (a + t[:, None] * ab), axis=1)
    return t, d


def coverall_masks(obj, rig):
    co, nr = rest_mesh_arrays(obj)
    bh = lambda n: bone_head(rig, n)
    fold_w = np.zeros(len(co), np.float32); fold_t = np.zeros(len(co), np.float32)
    best = np.full(len(co), 9.0, np.float32)
    wear = np.zeros(len(co), np.float32)
    for side in ('L', 'R'):
        chains = [  # 関節 → 関節(腕・脚)。t は鎖に沿った実寸 m
            ([bh(f'upperarm01.{side}'), bh(f'lowerarm01.{side}'), bh(f'wrist.{side}')],
             [bh(f'lowerarm01.{side}')], bh(f'wrist.{side}')),
            ([bh(f'upperleg01.{side}'), bh(f'lowerleg01.{side}'), bh(f'foot.{side}')],
             [bh(f'lowerleg01.{side}'), bh(f'upperleg01.{side}')], bh(f'foot.{side}')),
        ]
        for pts_, joints, end in chains:
            off = 0.0
            for a, b in zip(pts_[:-1], pts_[1:]):
                t, d = seg_param(co, a, b)
                L = float(np.linalg.norm(b - a))
                sel = d < best
                best[sel] = d[sel]; fold_t[sel] = off + t[sel] * L
                off += L
            for j in joints:   # 関節のまわりは強く(肘・膝・股)
                dj = np.linalg.norm(co - j, axis=1)
                fold_w = np.maximum(fold_w, smoothstep(0.13, 0.03, dj))
                wear = np.maximum(wear, smoothstep(0.075, 0.02, dj) * smoothstep(-0.2, -0.6, nr[:, 1] if j is pts_[1] and 'arm' else nr[:, 1]))
            de = np.linalg.norm(co - end, axis=1)       # 袖口・裾: たまり皺＋すれ
            fold_w = np.maximum(fold_w, smoothstep(0.14, 0.04, de))
            wear = np.maximum(wear, smoothstep(0.07, 0.035, de))
    # 肘は後ろ側、膝は前側がすれる
    elbow_back = np.zeros(len(co), np.float32)
    for side in ('L', 'R'):
        dj = np.linalg.norm(co - bh(f'lowerarm01.{side}'), axis=1)
        elbow_back = np.maximum(elbow_back, smoothstep(0.07, 0.02, dj))
    knee_front = np.zeros(len(co), np.float32)
    for side in ('L', 'R'):
        dj = np.linalg.norm(co - bh(f'lowerleg01.{side}'), axis=1)
        knee_front = np.maximum(knee_front, smoothstep(0.09, 0.03, dj) * smoothstep(-0.1, -0.6, nr[:, 1]))
    wear = np.clip(np.maximum(wear * 0.6, np.maximum(elbow_back, knee_front)), 0, 1)
    # 胸ポケット(キャラ右 = -X)の下の油染み: 縦に長い楕円＋垂れ
    chest = bh('spine01')
    cx, cz = -0.090, chest[2] - 0.085
    front = smoothstep(-0.3, -0.7, nr[:, 1])
    st = np.exp(-(((co[:, 0] - cx) / 0.030) ** 2 + ((co[:, 2] - cz) / 0.045) ** 2)) * front
    drip = np.exp(-(((co[:, 0] - cx - 0.012) / 0.010) ** 2)) * smoothstep(cz - 0.13, cz - 0.03, co[:, 2]) * smoothstep(cz + 0.0, cz - 0.03, co[:, 2]) * front
    stain = np.clip(np.maximum(st, drip * 0.8), 0, 1)
    wz = bh('spine04')[2]
    waist = smoothstep(0.07, 0.0, np.abs(co[:, 2] - wz))
    fold_t = np.where(waist > fold_w, co[:, 2], fold_t)       # 腰は縦方向の座標で横皺
    for name, v in (('n2_fold_w', fold_w), ('n2_fold_t', fold_t), ('n2_wear', wear), ('n2_stain', stain), ('n2_waist', waist)):
        set_point_attr(obj, name, v)
    LOG(f'coverall masks: wear {int((wear > 0.5).sum())} stain {int((stain > 0.3).sum())} verts')


def upgrade_coverall(obj, rig, size=4096, target_tris=12500):
    me = obj.data
    me.calc_loop_triangles()
    ntri = len(me.loop_triangles)
    # ファスナー・襟・ポケットの縁など細い造形は間引きから守る(重み 1 の頂点は崩さない)
    co, nr = rest_mesh_arrays(obj)
    chest = bone_head(rig, 'spine01'); neck = bone_head(rig, 'neck01')
    keep = np.zeros(len(co), np.float32)
    keep = np.maximum(keep, smoothstep(0.035, 0.015, np.abs(co[:, 0])) * smoothstep(-0.2, -0.6, nr[:, 1]))   # 前のファスナー
    keep = np.maximum(keep, smoothstep(0.10, 0.04, np.linalg.norm(co - neck, axis=1)))                       # 襟
    vg = obj.vertex_groups.new(name='N2_Keep')
    for i in np.where(keep > 0.05)[0]:
        vg.add([int(i)], float(keep[i]), 'REPLACE')
    md = obj.modifiers.new('N2_Decimate', 'DECIMATE'); md.ratio = min(1.0, target_tris / ntri)
    md.vertex_group = 'N2_Keep'; md.invert_vertex_group = True; md.vertex_group_factor = 6.0
    apply_modifier_first(obj, md)
    obj.vertex_groups.remove(obj.vertex_groups['N2_Keep'])
    me.calc_loop_triangles()
    LOG(f'coverall decimate: {ntri} -> {len(me.loop_triangles)} tris')
    smart_uv(obj, 'N2Bake')
    coverall_masks(obj, rig)
    src = obj.material_slots[0].material
    nodes = src.node_tree.nodes
    alb = next(n.image for n in nodes if n.bl_idname == 'ShaderNodeTexImage' and n.image and n.image.name.startswith(CID))
    nimg = next((n.image for n in nodes if n.bl_idname == 'ShaderNodeTexImage' and n.image and 'normal' in n.image.name.lower()), None)
    erase = bpy.data.images.get(obj.get('n2_erase_mask', '')) if obj.get('n2_erase_mask') else None
    bm = bpy.data.materials.new(f'N2_{CID}_CovBake')
    n = N(bm)
    oc = n.obj_coord()
    col = n.img(alb, 'UVMap').outputs['Color']
    wear, stain, fw, ft = (n.attr(a) for a in ('n2_wear', 'n2_stain', 'n2_fold_w', 'n2_fold_t'))
    fiber = n.noise(oc, 900.0, 3.0, 0.7)
    col = n.mix(col, n.mix(col, (0.9, 0.9, 0.9, 1), 1.0, 'MULTIPLY'), n.math('MULTIPLY', n.math('SUBTRACT', fiber, 0.5), 0.6, clamp=True))
    # すれ: 繊維が毛羽立って白っぽく(まだらに)
    wn = n.ramp(n.noise(oc, 120.0, 4.0, 0.7), 0.35, 0.7)
    wfac = n.math('MULTIPLY', wear, n.math('MULTIPLY', wn, 0.45))
    worn = n.mix(n.mix(col, (0.38, 0.41, 0.50, 1), 0.35), (0.8, 0.8, 0.8, 1), n.math('MULTIPLY', fiber, 0.10))
    col = n.mix(col, worn, wfac)
    # 油染み: 輪郭がにじんだ濃い茶黒、中はムラ
    sn = n.ramp(n.noise(oc, 35.0, 3.0, 0.6), 0.30, 0.62)
    sfac = n.math('MULTIPLY', n.ramp(stain, 0.15, 0.55), sn)
    col = n.mix(col, n.mix(col, (0.22, 0.20, 0.15, 1), 1.0, 'MULTIPLY'), n.math('MULTIPLY', sfac, 0.9))
    # 上を向いた面(肩・ポケットの蓋)は日焼けで色あせ、下向き・脇は濃い
    up_ = n.new('ShaderNodeSeparateXYZ'); n.link(n.new('ShaderNodeNewGeometry').outputs['Normal'], up_.inputs['Vector'])
    col = n.mix(col, n.mix(col, (0.62, 0.66, 0.72, 1), 0.25), n.math('MULTIPLY', n.ramp(up_.outputs['Z'], 0.4, 0.95), 0.3))
    # 全体の汚れ(低周波で少し暗く)
    dirt = n.ramp(n.noise(oc, 6.0, 2.0), 0.45, 0.75)
    col = n.mix(col, n.mix(col, (0.80, 0.78, 0.74, 1), 1.0, 'MULTIPLY'), n.math('MULTIPLY', dirt, 0.6))
    rough = n.fmix(0.82, 0.92, wfac)
    rough = n.fmix(rough, 0.62, sfac)
    rough = n.math('ADD', rough, n.math('MULTIPLY', n.math('SUBTRACT', fiber, 0.5), 0.06))
    # 元の法線(ロゴを消した所は平らに)
    if nimg:
        nt_ = n.img(nimg, 'UVMap', non_color=True)
        nm = n.new('ShaderNodeNormalMap'); nm.uv_map = 'UVMap'
        n.link(nt_.outputs['Color'], nm.inputs['Color'])
        if erase:
            er = n.img(erase, 'UVMap', non_color=True)
            n.link(n.math('SUBTRACT', 1.0, er.outputs['Color']), nm.inputs['Strength'])
        nrm_src = nm.outputs['Normal']
    else:
        nrm_src = n.new('ShaderNodeNewGeometry').outputs['Normal']
    # 高さ(m): 関節の圧縮皺(肢の軸に沿った縞を揺らす)＋全体のたるみ＋布目
    dist = n.noise(oc, 14.0, 2.0, 0.5)
    # 皺: 肢の軸に沿った座標を主にしたノイズの「稜線」= 本数が少なく、幅・向き・深さが不規則な折れ皺
    sep = n.new('ShaderNodeSeparateXYZ'); n.link(oc, sep.inputs['Vector'])
    cv = n.new('ShaderNodeCombineXYZ')
    n.link(n.math('MULTIPLY', ft, 16.0), cv.inputs['X'])
    n.link(n.math('MULTIPLY', sep.outputs['X'], 4.0), cv.inputs['Y'])
    n.link(n.math('MULTIPLY', sep.outputs['Y'], 4.0), cv.inputs['Z'])
    fnz = n.noise(cv.outputs['Vector'], 1.0, 1.0, 0.5)
    ridge = n.ramp(n.math('SUBTRACT', 1.0, n.math('ABSOLUTE', n.math('SUBTRACT', n.math('MULTIPLY', fnz, 2.0), 1.0))), 0.80, 0.97)
    brk = n.ramp(n.noise(oc, 9.0, 1.0), 0.30, 0.70)                 # 皺ごとの深さのばらつき(浅い所は消える)
    hgt = n.math('MULTIPLY', ridge, n.math('MULTIPLY', n.math('MULTIPLY', fw, brk), 0.0020))
    hgt = n.math('ADD', hgt, n.math('MULTIPLY', n.noise(oc, 4.0, 1.0, 0.4), 0.0008))
    # 縦のたるみ皺(肩から落ちる布): Z 方向に引き伸ばしたノイズ
    st_ = n.new('ShaderNodeMapping'); n.link(oc, st_.inputs['Vector']); st_.inputs['Scale'].default_value = (1.0, 1.0, 0.08)
    drape = n.noise(st_.outputs['Vector'], 22.0, 2.0, 0.5)
    hgt = n.math('ADD', hgt, n.math('MULTIPLY', n.ramp(drape, 0.3, 0.7), 0.0009))
    # 腰まわり(ベルト位置)の横皺
    hgt = n.math('ADD', hgt, n.math('MULTIPLY', n.math('MULTIPLY', n.math('MULTIPLY', ridge, brk), n.attr('n2_waist')), 0.0012))
    hgt = n.math('ADD', hgt, n.math('MULTIPLY', fiber, 0.00004))
    out = bake(obj, 'N2Bake', {'_mat': bm, 'albedo': col, 'rough': rough, 'normal': nrm_src, 'height': hgt}, size, 'coverall')
    mpu = meters_per_uv(obj, 'N2Bake')
    hn = height_to_normal(out['height'], mpu, os.path.join(TEX_OUT, f'{CID}_coverall_wrinkle.png'), f'{CID}_coverall_wrinkle', 1.0)
    nfin = blend_normals(out['normal'], hn, os.path.join(TEX_OUT, f'{CID}_coverall_normal_final.png'), f'{CID}_coverall_normal_final')
    # 最終素材(UV は N2Bake を唯一の UV にする)
    m = bpy.data.materials.new(f'N2E_{CID}_coverall')
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    t1 = nt.nodes.new('ShaderNodeTexImage'); t1.image = out['albedo']
    t2 = nt.nodes.new('ShaderNodeTexImage'); t2.image = nfin; nfin.colorspace_settings.name = 'Non-Color'
    t3 = nt.nodes.new('ShaderNodeTexImage'); t3.image = out['rough']
    nmn = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(t1.outputs['Color'], b.inputs['Base Color'])
    nt.links.new(t2.outputs['Color'], nmn.inputs['Color']); nt.links.new(nmn.outputs['Normal'], b.inputs['Normal'])
    nt.links.new(t3.outputs['Color'], b.inputs['Roughness'])
    b.inputs['Sheen Weight'].default_value = 0.04; b.inputs['Sheen Roughness'].default_value = 0.5
    m['n2_albedo'] = out['albedo'].name; m['n2_normal'] = nfin.name; m['n2_rough'] = out['rough'].name
    obj.material_slots[0].material = m
    me.uv_layers.remove(me.uv_layers['UVMap'])
    me.uv_layers['N2Bake'].name = 'UVMap'
    me.uv_layers.active = me.uv_layers['UVMap']
    me.uv_layers['UVMap'].active_render = True


def upgrade_armband(obj):
    """腕章: 縁の縫い糸(破線)・生地の目・少しのくすみ。法線も描いて縫い付け感を出す。"""
    m = obj.material_slots[0].material
    tx = next(x for x in m.node_tree.nodes if x.bl_idname == 'ShaderNodeTexImage')
    img = tx.image
    w, h = img.size
    a = np.empty(w * h * 4, np.float32); img.pixels.foreach_get(a); a = a.reshape(h, w, 4)
    rng = np.random.default_rng(5)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    v = yy / h
    weave = 0.5 + 0.25 * np.sin(xx * 1.7) * np.sin(yy * 1.7)
    noise = rng.normal(0, 1, (h, w)).astype(np.float32)
    for _ in range(3):
        noise = (np.roll(noise, 1, 0) + np.roll(noise, -1, 0) + np.roll(noise, 1, 1) + np.roll(noise, -1, 1) + noise) / 5
    dash = (np.sin(xx / w * 2 * np.pi * 70) > -0.1).astype(np.float32)
    stitch = np.zeros_like(v)
    for vv in (0.10, 0.90):
        stitch = np.maximum(stitch, np.clip(1 - np.abs(v - vv) / 0.012, 0, 1) * dash)
    edge = np.maximum(np.clip(1 - v / 0.04, 0, 1), np.clip(1 - (1 - v) / 0.04, 0, 1))
    rgb = a[..., :3] * (0.93 + 0.06 * weave[..., None] + 0.05 * noise[..., None])
    rgb = rgb * (1 - 0.25 * edge[..., None])                                # 縁は折り返しで少し暗い
    thread = np.array([0.55, 0.45, 0.12], np.float32)
    rgb = rgb * (1 - stitch[..., None]) + thread * stitch[..., None]
    rgb *= np.array([0.95, 0.92, 0.85], np.float32)                         # 日焼け・くすみ
    a[..., :3] = np.clip(rgb, 0, 1)
    img.pixels.foreach_set(a.ravel()); save_image(img, img.filepath_raw or os.path.join(TEX_OUT, f'{CID}_armband.png'))
    H = 0.4 * weave + 0.3 * noise - 1.2 * stitch + 0.6 * edge
    gx = (np.roll(H, -1, 1) - np.roll(H, 1, 1)) * 0.5; gy = (np.roll(H, -1, 0) - np.roll(H, 1, 0)) * 0.5
    nx, ny, nz = -gx * 1.2, -gy * 1.2, np.ones_like(H); ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    nm = np.stack([nx / ln * .5 + .5, ny / ln * .5 + .5, nz / ln * .5 + .5, np.ones_like(H)], -1).astype(np.float32)
    nimg = bpy.data.images.new(f'{CID}_armband_normal', w, h, alpha=False); nimg.colorspace_settings.name = 'Non-Color'
    nimg.pixels.foreach_set(nm.ravel()); save_image(nimg, os.path.join(TEX_OUT, f'{CID}_armband_normal.png'))
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    t2 = nt.nodes.new('ShaderNodeTexImage'); t2.image = nimg
    if tx.inputs['Vector'].links:
        nt.links.new(tx.inputs['Vector'].links[0].from_socket, t2.inputs['Vector'])
    nmn = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(t2.outputs['Color'], nmn.inputs['Color'])
    nt.links.new(nmn.outputs['Normal'], b.inputs['Normal'])
    b.inputs['Roughness'].default_value = 0.85
    m['n2_albedo'] = img.name; m['n2_normal'] = nimg.name
    # 少し浮かせて波打たせる(縫い付けた布の張り)
    d = obj.modifiers.new('N2_Lift', 'DISPLACE')
    tex = bpy.data.textures.new(f'{CID}_armband_wave', 'CLOUDS'); tex.noise_scale = 0.02
    d.texture = tex; d.texture_coords = 'OBJECT'; d.strength = 0.0018; d.mid_level = 0.3
    obj.modifiers.move(len(obj.modifiers) - 1, 0)
    LOG('armband: stitched')


# ---------------------------------------------------------------------------
# 表情 2 状態: 無表情(基本形) と 不気味な笑い(シェイプキー grin)
# ---------------------------------------------------------------------------
def age_mouth(objs):
    """口の中: 歯を黄ばませて歯間を暗く、歯茎・舌は血色を落とす(笑うと見えるため)。"""
    for key, mul in (('teeth_base', (0.80, 0.73, 0.58)), ('tongue01', (0.62, 0.50, 0.50))):
        o = objs.get(key)
        if not o:
            continue
        for sl in o.material_slots:
            for nd in sl.material.node_tree.nodes:
                if nd.bl_idname == 'ShaderNodeTexImage' and nd.image:
                    im = nd.image; w, h = im.size
                    a = np.empty(w * h * 4, np.float32); im.pixels.foreach_get(a); a = a.reshape(h, w, 4)
                    rgb = a[..., :3]
                    red = (rgb[..., 0] > rgb[..., 1] * 1.25)[..., None]          # 歯茎(赤い所)
                    out = rgb * np.array(mul, np.float32)
                    out = np.where(red, rgb * np.array([0.55, 0.40, 0.40], np.float32), out)
                    a[..., :3] = np.clip(out, 0, 1)
                    im2 = bpy.data.images.new(f'{CID}_{key}', w, h, alpha=True); im2.pixels.foreach_set(a.ravel())
                    save_image(im2, os.path.join(TEX_OUT, f'{CID}_{key}.png'))
                    nd.image = im2
            b = next((x for x in sl.material.node_tree.nodes if x.bl_idname == 'ShaderNodeBsdfPrincipled'), None)
            if b:
                b.inputs['Roughness'].default_value = 0.35
    t = objs.get('teeth_base')
    if t:   # 歯は 7k 三角形あるので、口の中で見える程度まで間引く(三角形予算 60k)
        md = t.modifiers.new('N2_Decimate', 'DECIMATE'); md.ratio = 0.3
        apply_modifier_first(t, md)
    LOG('mouth: teeth yellowed, gums dulled, teeth decimated')


def make_grin(body, units, key='grin'):
    from bl_ext.user_default.mpfb.services import TargetService, LocationService
    d = os.path.join(LocationService.get_mpfb_data('targets'), 'expression', 'units', 'asian')
    kb = body.data.shape_keys.key_blocks
    basis = body.data.shape_keys.reference_key
    n = len(body.data.vertices)
    b = np.empty(n * 3, np.float32); basis.data.foreach_get('co', b)
    delta = np.zeros(n * 3, np.float32)
    for name, w in units.items():
        p = os.path.join(d, name + '.target.gz')
        assert os.path.exists(p), p
        k = TargetService.load_target(body, p, weight=0.0, name='n2tmp-' + name)
        k = kb['n2tmp-' + name] if not isinstance(k, bpy.types.ShapeKey) else k
        c = np.empty(n * 3, np.float32); k.data.foreach_get('co', c)
        delta += (c - b) * w
        body.shape_key_remove(k)
    if key == 'attack':    # 口角まわりは移動量を周囲と均す(大きく開けると口の内側の面が外へめくれるため)
        co3 = b.reshape(-1, 3); d3 = delta.reshape(-1, 3)
        lipm = group_mask(body, 'lips') > 0.3
        if lipm.any():
            lp_ = co3[lipm]
            cm = np.zeros(n, np.float32)
            for sgn in (1, -1):
                cpt = lp_[np.argmax(lp_[:, 0] * sgn)]
                cm = np.maximum(cm, smoothstep(0.020, 0.008, np.linalg.norm(co3 - cpt, axis=1)))
            ev = np.empty(len(body.data.edges) * 2, np.int32); body.data.edges.foreach_get('vertices', ev); ev = ev.reshape(-1, 2)
            cnt = np.zeros(n, np.float32); np.add.at(cnt, ev[:, 0], 1); np.add.at(cnt, ev[:, 1], 1)
            for _ in range(25):
                acc = np.zeros_like(d3); np.add.at(acc, ev[:, 0], d3[ev[:, 1]]); np.add.at(acc, ev[:, 1], d3[ev[:, 0]])
                avg = acc / np.maximum(cnt, 1)[:, None]
                d3 = d3 + (avg - d3) * cm[:, None] * 0.8
            delta = d3.ravel()
    g = body.shape_key_add(name=key, from_mix=False)
    g.relative_key = basis
    g.data.foreach_set('co', b + delta)
    g.value = 0.0; g.slider_max = 1.0
    mv = np.linalg.norm(delta.reshape(-1, 3), axis=1)
    LOG(f'{key}: {len(units)} units, max move {mv.max() * 1000:.1f} mm')
    return g


def jaw_follow(body, teeth, tongue, key='attack'):
    """顎を開くキーに、下の歯と舌を剛体で追従させる(顎の頂点の動きから回転・平行移動を推定 = Kabsch)。"""
    co, dl = grin_deltas(body, key)
    jw = group_mask(body, 'jaw') * (group_mask(body, 'body') > 0.5)
    sel = jw > 0.5
    P = co[sel]; Q = P + dl[sel]
    pc, qc = P.mean(0), Q.mean(0)
    U, _, Vt = np.linalg.svd((P - pc).T @ (Q - qc))
    D = np.diag([1, 1, np.sign(np.linalg.det(Vt.T @ U.T))])
    Rm = Vt.T @ D @ U.T
    ang = math.degrees(math.acos(max(-1.0, min(1.0, (np.trace(Rm) - 1) / 2))))
    def move(pts):
        return (pts - pc) @ Rm.T + qc
    for o, part in ((teeth, 'lower'), (tongue, 'all')):
        if o is None:
            continue
        me = o.data
        pts = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get('co', pts); pts = pts.reshape(-1, 3)
        mw = np.array(o.matrix_world, np.float32)
        wp = pts @ mw[:3, :3].T + mw[:3, 3]
        nw = move(wp)
        if part == 'lower':     # 下の歯だけ: MakeHuman の歯は下顎側が 'jaw' の重みを持つので、その重みで動かす
            w = group_mask(o, 'jaw')
            nw = wp + (nw - wp) * w[:, None]
        inv = np.linalg.inv(mw)
        lp = nw @ inv[:3, :3].T + inv[:3, 3]
        if not me.shape_keys:
            o.shape_key_add(name='Basis', from_mix=False)
        k = o.shape_key_add(name=key, from_mix=False)
        k.data.foreach_set('co', lp.astype(np.float32).ravel()); k.value = 0.0
    LOG(f'{key}: jaw {ang:.1f}° → lower teeth / tongue follow')


def grin_deltas(body, key='grin'):
    """体の各頂点の表情キー(grin / attack)の移動量(レストのワールド座標)。"""
    k = body.data.shape_keys.key_blocks[key]
    k.value = 0.0; a, _ = rest_mesh_arrays(body)
    k.value = 1.0; b, _ = rest_mesh_arrays(body)
    k.value = 0.0
    return a, b - a


def transfer_grin(body, meshes, curves, key='grin'):
    """眉・まつ毛(帯メッシュとヘアカーブ)を、近くの肌の動きに合わせて grin に追従させる。"""
    from mathutils.kdtree import KDTree
    co, dl = grin_deltas(body, key)
    sel = np.where(np.linalg.norm(dl, axis=1) > 1e-6)[0]
    kd = KDTree(len(sel))
    for j, i in enumerate(sel):
        kd.insert(Vector(co[i]), j)
    kd.balance()
    def field(points):
        out = np.zeros_like(points)
        for i, p in enumerate(points):
            hits = kd.find_n(Vector(p), 4)
            w = np.array([1.0 / max(h[2], 1e-4) for h in hits]); w /= w.sum()
            out[i] = sum(wi * dl[sel[h[1]]] for wi, h in zip(w, hits))
        return out
    for m in meshes:
        me = m.data
        pts = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get('co', pts); pts = pts.reshape(-1, 3)
        d = field(pts)
        if not me.shape_keys:
            m.shape_key_add(name='Basis', from_mix=False)
        k = m.shape_key_add(name=key, from_mix=False)
        k.data.foreach_set('co', (pts + d).ravel())
        k.value = 0.0
    for c in curves:
        pos = np.empty(len(c.data.points) * 3, np.float32)
        c.data.attributes['position'].data.foreach_get('vector', pos)
        d = field(pos.reshape(-1, 3))
        at = c.data.attributes.new('n2_' + key, 'FLOAT_VECTOR', 'POINT')
        at.data.foreach_set('vector', d.astype(np.float32).ravel())
    LOG(f'{key} transfer: {len(meshes)} meshes, {len(curves)} curves')


# ---------------------------------------------------------------------------
# 凶器: ハンマー(自作。全長 40cm、頭 10.5cm の八角の鉄、柄は木で手元に黒テープ)
#   原点 = 握り位置、+Y = 柄の先 → 頭の向き、+X = 頭の長さ方向。書き出しは別ファイル(07 本体の FBX に混ぜない)
# ---------------------------------------------------------------------------
HAM_TOTAL = 0.400
HAM_GRIP = 0.075          # 握りの中心(柄尻から)
HAM_HEAD_LEN = 0.105


def _ring(bm, y, rx, rz, seg, x0=0.0):
    return [bm.verts.new((x0 + rx * math.cos(2 * math.pi * i / seg), y, rz * math.sin(2 * math.pi * i / seg))) for i in range(seg)]


def _bridge(bm, r0, r1):
    n = len(r0)
    return [bm.faces.new((r0[i], r0[(i + 1) % n], r1[(i + 1) % n], r1[i])) for i in range(n)]


def make_hammer():
    bm = bmesh.new()
    part = bm.verts.layers.float.new('n2_part')       # 0=木, 1=鉄, 2=テープ
    SEG = 16
    head_y = HAM_TOTAL - 0.0245                       # 頭の中心(柄尻基準)。頭の上端が全長 40cm
    # 柄: 楕円断面、柄尻はふくらむ、頭の手前で細る
    prof = [(0.000, 0.0150, 0.0110), (0.006, 0.0165, 0.0122), (0.018, 0.0155, 0.0114), (0.060, 0.0150, 0.0110),
            (0.140, 0.0156, 0.0114), (0.220, 0.0150, 0.0110), (0.300, 0.0132, 0.0098), (head_y - 0.02, 0.0120, 0.0090),
            (HAM_TOTAL - 0.001, 0.0108, 0.0082)]
    rings = [_ring(bm, y, rx, rz, SEG) for y, rx, rz in prof]
    for r0, r1 in zip(rings[:-1], rings[1:]):
        _bridge(bm, r0, r1)
    for r in (rings[0], rings[-1]):
        c = bm.verts.new((0, r[0].co.y, 0))
        for i in range(SEG):
            bm.faces.new((r[i], r[(i + 1) % SEG], c) if r is rings[-1] else (r[(i + 1) % SEG], r[i], c))
    # テープ(手元 15cm、柄より 1.2mm 太い)
    tprof = [(0.012, 0.0164, 0.0123), (0.020, 0.0162, 0.0122)] + [(0.02 + 0.13 * k / 6, 0.0152 - 0.001 * k / 6, 0.0114 - 0.0008 * k / 6) for k in range(1, 7)] + [(0.158, 0.0141, 0.0105)]
    trings = [_ring(bm, y, rx, rz, SEG) for y, rx, rz in tprof]
    tv = set(v for r in trings for v in r)
    for r0, r1 in zip(trings[:-1], trings[1:]):
        _bridge(bm, r0, r1)
    # 頭: 角材のような太い鉄塊(X 方向に長さ 10.5cm、断面 4.5×4.5cm の面取り四角)。両端の打面は少し広がる
    hw = 0.0225; ch = 0.30                            # 半幅・面取り率
    def sq_ring(x, s):
        pts = [(1, 1 - ch), (1 - ch, 1), (-(1 - ch), 1), (-1, 1 - ch), (-1, -(1 - ch)), (-(1 - ch), -1), (1 - ch, -1), (1, -(1 - ch))]
        return [bm.verts.new((x, head_y + hw * s * py, hw * s * pz)) for py, pz in pts]
    L2 = HAM_HEAD_LEN / 2
    hr = [sq_ring(-L2, 0.90), sq_ring(-L2 + 0.004, 1.06), sq_ring(-L2 + 0.014, 1.0), sq_ring(-0.010, 0.97),
          sq_ring(0.010, 0.97), sq_ring(L2 - 0.014, 1.0), sq_ring(L2 - 0.004, 1.06), sq_ring(L2, 0.90)]
    OCT = 8
    hv = set(v for r in hr for v in r)
    for r0, r1 in zip(hr[:-1], hr[1:]):
        _bridge(bm, r0, r1)
    for r, flip in ((hr[0], True), (hr[-1], False)):
        c = bm.verts.new((r[0].co.x + (-0.0015 if flip else 0.0015), head_y, 0))   # 打面はわずかに膨らむ
        hv.add(c)
        for i in range(OCT):
            bm.faces.new((r[(i + 1) % OCT], r[i], c) if flip else (r[i], r[(i + 1) % OCT], c))
    for v in bm.verts:
        v[part] = 1.0 if v in hv else (2.0 if v in tv else 0.0)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for v in bm.verts:
        v.co.y -= HAM_GRIP                            # 原点 = 握り
    me = bpy.data.meshes.new('N2_hammer')
    bm.to_mesh(me); bm.free()
    for p_ in me.polygons:
        p_.use_smooth = True
    # 点の属性(Attribute ノード用)
    obj = bpy.data.objects.new('N2E_hammer', me)
    bpy.context.scene.collection.objects.link(obj)
    smart_uv(obj, 'UVMap', margin=0.01)
    me.uv_layers.active = me.uv_layers['UVMap']
    # 焼き込み素材
    bmat = bpy.data.materials.new('N2_HammerBake')
    n = N(bmat)
    oc = n.obj_coord()
    pt = n.attr('n2_part')
    steel = n.ramp(pt, 0.5, 0.6); tape = n.ramp(pt, 1.5, 1.6); wood = n.math('MULTIPLY', n.math('SUBTRACT', 1.0, steel), n.math('SUBTRACT', 1.0, tape))
    # 木: 縦の木目、手垢と頭の近くの汚れ
    grain = n.new('ShaderNodeTexWave', wave_type='BANDS', bands_direction='X')
    n.link(oc, grain.inputs['Vector']); grain.inputs['Scale'].default_value = 60.0; grain.inputs['Distortion'].default_value = 9.0
    grain.inputs['Detail'].default_value = 3.0
    wcol = n.mix((0.065, 0.038, 0.020, 1), (0.035, 0.021, 0.012, 1), n.math('MULTIPLY', grain.outputs['Fac'], 0.8))   # 暗い焦げ茶(使い込んだ木)
    wcol = n.mix(wcol, (0.12, 0.09, 0.06, 1), n.math('MULTIPLY', n.ramp(n.noise(oc, 25.0, 3.0), 0.5, 0.8), 0.5))
    # 鉄: 暗い地金に錆(縁と面取りに寄る)・打撃面は擦れて明るい
    rust_n = n.ramp(n.noise(oc, 45.0, 4.0, 0.6), 0.42, 0.62)
    rust_b = n.ramp(n.voronoi(oc, 90.0, 1.0), 0.35, 0.15)
    rust = n.math('MAXIMUM', rust_n, n.math('MULTIPLY', rust_b, 0.6), clamp=True)
    scol = n.mix((0.045, 0.045, 0.048, 1), n.mix((0.42, 0.19, 0.07, 1), (0.25, 0.10, 0.04, 1), n.noise(oc, 120.0)), n.math('MULTIPLY', rust, 0.55))   # 黒皮の鉄＋錆
    sep = n.new('ShaderNodeSeparateXYZ'); n.link(oc, sep.inputs['Vector'])
    face = n.ramp(n.math('ABSOLUTE', sep.outputs['X']), L2 - 0.0035, L2 - 0.0005)
    scol = n.mix(scol, (0.26, 0.26, 0.27, 1), n.math('MULTIPLY', face, 0.6))
    # テープ: 黒、巻きの段(らせん)、端が少しめくれ汚れる
    tcol = n.mix((0.025, 0.025, 0.028, 1), (0.06, 0.06, 0.065, 1), n.ramp(n.noise(oc, 200.0), 0.4, 0.7))
    col = n.mix(n.mix(wcol, scol, steel), tcol, tape)
    rough = n.fmix(n.fmix(0.62, n.fmix(0.38, 0.85, rust), steel), 0.55, tape)
    rough = n.fmix(rough, 0.25, n.math('MULTIPLY', face, steel))
    metal = n.math('MULTIPLY', steel, n.math('SUBTRACT', 1.0, n.math('MULTIPLY', rust, 0.95)))
    # 高さ: 打痕(鉄)・木目の溝・テープの巻き段
    dents = n.math('MULTIPLY', n.ramp(n.voronoi(oc, 160.0, 1.0), 0.18, 0.0), -0.0005)
    hgt = n.math('MULTIPLY', dents, steel)
    hgt = n.math('ADD', hgt, n.math('MULTIPLY', n.math('MULTIPLY', rust_n, 0.00015), steel))
    hgt = n.math('ADD', hgt, n.math('MULTIPLY', n.math('MULTIPLY', grain.outputs['Fac'], 0.00012), wood))
    wrap = n.new('ShaderNodeTexWave', wave_type='BANDS', bands_direction='Y', wave_profile='SAW')
    n.link(oc, wrap.inputs['Vector']); wrap.inputs['Scale'].default_value = 8.0; wrap.inputs['Distortion'].default_value = 0.5
    hgt = n.math('ADD', hgt, n.math('MULTIPLY', n.math('MULTIPLY', wrap.outputs['Fac'], 0.0003), tape))
    me.materials.append(bmat)
    out = bake(obj, 'UVMap', {'_mat': bmat, 'albedo': col, 'rough': rough, 'metal': metal, 'height': hgt}, 2048, 'hammer', margin=6)
    mpu = meters_per_uv(obj, 'UVMap')
    out['normal'] = height_to_normal(out['height'], mpu, os.path.join(TEX_OUT, 'hammer_normal.png'), 'hammer_normal')
    m = bpy.data.materials.new('N2_hammer')
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    t1 = nt.nodes.new('ShaderNodeTexImage'); t1.image = out['albedo']
    t2 = nt.nodes.new('ShaderNodeTexImage'); t2.image = out['normal']
    t3 = nt.nodes.new('ShaderNodeTexImage'); t3.image = out['rough']
    t4 = nt.nodes.new('ShaderNodeTexImage'); t4.image = out['metal']
    nmn = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(t1.outputs['Color'], b.inputs['Base Color'])
    nt.links.new(t2.outputs['Color'], nmn.inputs['Color']); nt.links.new(nmn.outputs['Normal'], b.inputs['Normal'])
    nt.links.new(t3.outputs['Color'], b.inputs['Roughness'])
    nt.links.new(t4.outputs['Color'], b.inputs['Metallic'])
    me.materials.clear(); me.materials.append(m)
    obj['n2_no_export'] = True      # 07 本体の FBX には入れない
    me.calc_loop_triangles()
    LOG(f'hammer: {len(me.loop_triangles)} tris, total {HAM_TOTAL * 100:.0f}cm, head {HAM_HEAD_LEN * 100:.1f}cm')
    return obj


def export_hammer(obj, out_dir):
    """hammer.fbx / hammer.glb を書き出す(原点 = 握り、+Y = 柄の先→頭)。"""
    for o in bpy.context.scene.objects:
        o.select_set(o is obj)
    bpy.context.view_layer.objects.active = obj
    fbx = os.path.join(out_dir, 'hammer.fbx')
    bpy.ops.export_scene.fbx(filepath=fbx, use_selection=True, object_types={'MESH'}, use_mesh_modifiers=True,
                             mesh_smooth_type='FACE', path_mode='COPY', embed_textures=True, bake_anim=False,
                             axis_forward='-Z', axis_up='Y')
    glb = os.path.join(out_dir, 'hammer.glb')
    bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True, export_yup=False,
                              export_apply=True, export_animations=False)
    LOG(f'hammer export: {os.path.getsize(fbx) / 1e6:.1f}MB fbx, {os.path.getsize(glb) / 1e6:.1f}MB glb')


def attach_hammer(rig, obj):
    """ポーズ後に右手へ握らせる(柄は手から斜め前下へ垂れ、頭は斜め前を向く)。"""
    bpy.context.view_layer.update()
    pb = lambda n: rig.matrix_world @ rig.pose.bones[n].head
    palm = (pb('metacarpal2.R') + pb('metacarpal3.R') + pb('finger2-1.R') + pb('finger3-1.R') + pb('finger4-1.R')) / 5
    knuck = (pb('finger2-1.R') + pb('finger3-1.R') + pb('finger4-1.R') + pb('finger5-1.R')) / 4
    wrist = pb('wrist.R')
    down = (knuck - wrist).normalized()
    inward = Vector((1, 0, 0))                      # 右手の掌は体側(+X)を向く
    grip = palm + inward * 0.012 + down * 0.012
    ydir = Vector((-0.42, -0.35, -1.0)).normalized()  # 柄の先(頭)は外側・斜め前下へ(脚から離して遠目でも形が抜ける)
    xdir = Vector((1.0, -0.3, 0.0)); xdir = (xdir - ydir * xdir.dot(ydir)).normalized()   # 頭は左右向き(正面から T 字に見える)
    zdir = xdir.cross(ydir)
    M = Matrix((xdir, ydir, zdir)).transposed().to_4x4()
    M.translation = grip
    obj.matrix_world = M
    bpy.context.view_layer.update()
    mw = obj.matrix_world.copy()
    obj.parent = rig; obj.parent_type = 'BONE'; obj.parent_bone = 'wrist.R'
    bpy.context.view_layer.update()
    pbw = rig.pose.bones['wrist.R']
    obj.matrix_parent_inverse = (rig.matrix_world @ pbw.matrix @ Matrix.Translation((0, pbw.length, 0))).inverted()
    obj.matrix_basis = Matrix.Identity(4)
    obj.matrix_world = mw
    LOG('hammer: in right hand')

# ---------------------------------------------------------------------------
def upgrade(C, body, rig, objs, extras):
    rng = np.random.default_rng(1967)
    eyes = objs['high-poly']
    age_mouth(objs)                       # 歯の間引きは形状キーを付ける前に
    if C.get('grin'):
        make_grin(body, C['grin'])
    if C.get('attack'):
        make_grin(body, C['attack'], 'attack')
        jaw_follow(body, objs.get('teeth_base'), objs.get('tongue01'), 'attack')
    F = upgrade_skin(body, rig, eyes)
    upgrade_eyes(eyes)
    upgrade_coverall(objs['elvs_male_coveralls_1'], rig)
    for e in extras:
        if e.name.endswith('.armband'):
            upgrade_armband(e)
    cap, emblem, plane = make_cap(body, rig, F)
    hair, hstrip = make_hair(body, rig, F, plane, rng)
    curves, strips = make_brows_lashes(objs, rig, F, rng)
    if C.get('grin'):
        transfer_grin(body, strips, curves)
    if C.get('attack'):
        transfer_grin(body, strips, curves, 'attack')
    if C.get('hammer'):
        h = make_hammer()
        export_hammer(h, os.path.dirname(TEX_OUT))
        rig['n2_hammer'] = h.name
    extras += [cap, hstrip] + strips
    rig['n2_cap_plane'] = [float(v) for v in plane[0]] + [float(plane[1])]
