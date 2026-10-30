# bake.py — p0_scene.blend の全メッシュを Cycles で1枚のライトマップアトラスにベイクする。
#
# 実行: Blender -b build/p0_scene.blend -P tools/blender/bake.py -- [--size 2048] [--samples 1024]
#        [--device GPU|CPU] [--no_denoise] [--out build/p0_lightmap.png] [--blend_out build/p0_baked.blend]
#
# ベイク内容: DIFFUSE の Direct+Indirect(色なし)= 「面に届く光」。three.js 側で
#   出射 = albedo/π × (lightmap × lightMapIntensity) になるので、intensity = π × scale で Cycles と一致する。
# 保存形式: PNG 8bit は暗部の階調が足りないため、linear 値を scale で割って sRGB 曲線で符号化し、
#   ±0.5LSB のディザを掛けて保存する(three 側は colorSpace=SRGB として読み、GPU で linear に戻る)。
# デノイズ: ベイクには Cycles のデノイザが掛からないので、空シーンのコンポジタで OIDN(Denoise ノード)を通す。

import bpy, json, os, sys, time
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
from n2common import parse_args, log  # noqa: E402

ARGS = parse_args({'size': '2048', 'samples': '1024', 'device': 'GPU',
                   'out': 'build/p0_lightmap.png', 'blend_out': 'build/p0_baked.blend'})
SIZE = int(ARGS['size'])
SAMPLES = int(ARGS['samples'])
IMG_NAME = 'P0_Lightmap'


def setup_device(scene, want):
    scene.render.engine = 'CYCLES'
    if want == 'GPU':
        prefs = bpy.context.preferences.addons['cycles'].preferences
        try:
            prefs.compute_device_type = 'METAL'
            prefs.get_devices()
            n = 0
            for d in prefs.devices:
                d.use = (d.type == 'METAL')
                n += d.use
            if n == 0:
                raise RuntimeError('Metal デバイスなし')
            scene.cycles.device = 'GPU'
            log(f'device: GPU (METAL) {[d.name for d in prefs.devices if d.use]}')
            return 'GPU-METAL'
        except Exception as e:  # noqa: BLE001
            log(f'GPU 設定失敗 → CPU: {e}')
    scene.cycles.device = 'CPU'
    log('device: CPU')
    return 'CPU'


def prepare(scene):
    meshes = [o for o in scene.objects if o.type == 'MESH']
    img = bpy.data.images.get(IMG_NAME) or bpy.data.images.new(IMG_NAME, SIZE, SIZE, alpha=False, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'
    saved_normal = {}
    mats = {m for o in meshes for m in o.data.materials if m}
    for m in mats:
        nt = m.node_tree
        node = nt.nodes.new('ShaderNodeTexImage')
        node.name = 'N2_BakeTarget'
        node.image = img
        node.location = (-1200, -600)
        for n in nt.nodes:
            n.select = False
        node.select = True
        nt.nodes.active = node
        nm = nt.nodes.get('N2_NormalMap')
        if nm:   # ライトマップは幾何法線で焼く(細部は実行時の法線マップ+懐中電灯が担う)
            saved_normal[m.name] = nm.inputs['Strength'].default_value
            nm.inputs['Strength'].default_value = 0.0
    # オブジェクト毎のベイクは1個ごとに数秒の準備コストが掛かる(102個で数分)。
    # → 拡散板(照明に寄与させない設定のもの)以外を複製して1つに結合した「代理」を焼き、元は render から隠す。
    #   第2UV(Lightmap)は全メッシュ共通のアトラスなので、代理に焼いても結果は同じ画像になる。
    src = [o for o in meshes if o.get('n2_kind') != 'lampcover']
    for o in scene.objects:
        o.select_set(False)
    copies = []
    for o in src:
        c = o.copy(); c.data = o.data.copy(); c.name = 'N2_BakeProxy_' + o.name
        scene.collection.objects.link(c)
        copies.append(c)
    with bpy.context.temp_override(active_object=copies[0], object=copies[0],
                                   selected_objects=copies, selected_editable_objects=copies):
        bpy.ops.object.join()
    proxy = copies[0]
    proxy.name = 'N2_BakeProxy'
    hidden = []
    for o in src:
        hidden.append((o, o.hide_render)); o.hide_render = True
    proxy.data.uv_layers.active = proxy.data.uv_layers['Lightmap']
    for o in scene.objects:
        o.select_set(False)
    proxy.select_set(True)
    bpy.context.view_layer.objects.active = proxy
    meshes = (proxy, hidden)
    return img, meshes, mats, saved_normal


def cleanup(mats, saved_normal, proxy_hidden):
    for m in mats:
        nt = m.node_tree
        n = nt.nodes.get('N2_BakeTarget')
        if n:
            nt.nodes.remove(n)
        nm = nt.nodes.get('N2_NormalMap')
        if nm and m.name in saved_normal:
            nm.inputs['Strength'].default_value = saved_normal[m.name]
    proxy, hidden = proxy_hidden
    me = proxy.data
    bpy.data.objects.remove(proxy, do_unlink=True)
    bpy.data.meshes.remove(me)
    for o, h in hidden:
        o.hide_render = h


def do_bake(scene):
    scene.cycles.samples = SAMPLES
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 8
    scene.cycles.diffuse_bounces = 6
    scene.cycles.glossy_bounces = 2
    scene.cycles.sample_clamp_indirect = 8.0   # 蛍(ホタル)抑制
    b = scene.render.bake
    b.use_pass_direct = True
    b.use_pass_indirect = True
    b.use_pass_color = False
    b.margin = 16
    b.margin_type = 'EXTEND'
    b.target = 'IMAGE_TEXTURES'
    b.use_clear = True
    b.use_selected_to_active = False
    scene.cycles.bake_type = 'DIFFUSE'
    t0 = time.time()
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, margin=16,
                        use_clear=True, target='IMAGE_TEXTURES')
    return time.time() - t0


def denoise(img):
    """空のシーンのコンポジタで OIDN を掛ける。失敗したら None。"""
    tmp = os.path.join(ROOT, 'build', '_denoise_tmp.exr')
    try:
        ds = bpy.data.scenes.new('N2_Denoise')
        ds.render.engine = 'BLENDER_WORKBENCH'
        ds.render.resolution_x = SIZE
        ds.render.resolution_y = SIZE
        ds.render.resolution_percentage = 100
        cam = bpy.data.objects.new('N2_DenoiseCam', bpy.data.cameras.new('N2_DenoiseCam'))
        ds.collection.objects.link(cam)
        ds.camera = cam
        tree = bpy.data.node_groups.new('N2_DenoiseTree', 'CompositorNodeTree')
        tree.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
        src = tree.nodes.new('CompositorNodeImage'); src.image = img
        den = tree.nodes.new('CompositorNodeDenoise')
        for k, v in (('prefilter', 'ACCURATE'), ('quality', 'HIGH'), ('use_hdr', True)):
            if hasattr(den, k):
                try: setattr(den, k, v)
                except Exception: pass  # noqa: E701
        # 5.x では一部の設定が入力ソケットになっている
        for sock in den.inputs:
            if sock.name.lower() in ('hdr',) and hasattr(sock, 'default_value'):
                sock.default_value = True
        outn = tree.nodes.new('NodeGroupOutput')
        tree.links.new(src.outputs['Image'], den.inputs['Image'])
        tree.links.new(den.outputs['Image'], outn.inputs[0])
        ds.compositing_node_group = tree
        ds.render.use_compositing = True
        ds.render.image_settings.file_format = 'OPEN_EXR'
        ds.render.image_settings.color_depth = '32'
        try:
            ds.view_settings.view_transform = 'Standard'
        except Exception:  # noqa: BLE001
            pass
        ds.render.filepath = tmp
        bpy.ops.render.render(scene=ds.name, write_still=True)
        res = bpy.data.images.load(tmp, check_existing=False)
        res.colorspace_settings.name = 'Non-Color'
        px = np.empty(SIZE * SIZE * 4, np.float32)
        res.pixels.foreach_get(px)
        bpy.data.images.remove(res)
        bpy.data.scenes.remove(ds)
        os.remove(tmp)
        return px.reshape(SIZE, SIZE, 4)
    except Exception as e:  # noqa: BLE001
        log(f'デノイズ失敗(素のベイクを使う): {e}')
        return None


def srgb_encode(x):
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def main():
    scene = bpy.context.scene
    dev = setup_device(scene, ARGS['device'])
    img, meshes, mats, saved_normal = prepare(scene)
    log(f'baking proxy ({len(meshes[1])} meshes joined) -> {SIZE}px, {SAMPLES} spp')
    try:
        secs = do_bake(scene)
    except Exception as e:  # noqa: BLE001
        if dev == 'CPU':
            raise
        log(f'GPU ベイク失敗 → CPU で再試行: {e}')
        dev = setup_device(scene, 'CPU')
        secs = do_bake(scene)
    log(f'bake done in {secs:.1f}s on {dev}')

    raw = np.empty(SIZE * SIZE * 4, np.float32)
    img.pixels.foreach_get(raw)
    raw = raw.reshape(SIZE, SIZE, 4)

    den = None if ARGS.get('no_denoise') else denoise(img)
    lin = (den if den is not None else raw)[..., :3]
    lin = np.maximum(lin, 0.0)
    lum = lin @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    nz = lum[lum > 1e-6]
    p50, p99, p999, mx = (float(np.percentile(nz, 50)), float(np.percentile(nz, 99)),
                          float(np.percentile(nz, 99.9)), float(nz.max())) if nz.size else (0, 0, 0, 0)
    # スケール = p99.7 ×1.25(窓ガラス直後の壁など「見えない所の外れ値」に引っ張られないように)
    scale = max(float(np.percentile(nz, 99.7)) * 1.25 if nz.size else 0.0, 1e-6)
    enc = srgb_encode(lin / scale)
    rng = np.random.default_rng(1234)
    enc = np.clip(enc + (rng.random(enc.shape, np.float32) - 0.5) / 255.0, 0, 1)
    rgba = np.concatenate([enc, np.ones((SIZE, SIZE, 1), np.float32)], axis=2)
    out = bpy.data.images.new('P0_Lightmap_PNG', SIZE, SIZE, alpha=False, float_buffer=False)
    out.colorspace_settings.name = 'Non-Color'
    out.pixels.foreach_set(rgba.ravel())
    png = os.path.join(ROOT, ARGS['out'])
    out.filepath_raw = png
    out.file_format = 'PNG'
    out.save()
    info = dict(size=SIZE, samples=SAMPLES, device=dev, bakeSeconds=round(secs, 1),
                denoised=den is not None, encoding='srgb', scale=scale,
                lightMapIntensity=float(np.pi * scale),
                lum=dict(p50=p50, p99=p99, p999=p999, max=mx),
                coverage=float((lum > 1e-6).mean()))
    with open(os.path.join(ROOT, 'build', 'p0_bake_info.json'), 'w') as f:
        json.dump(info, f, indent=2)
    log(f'saved {png}  scale={scale:.5f} p50={p50:.5f} p99={p99:.5f} max={mx:.4f} denoised={info["denoised"]}')

    cleanup(mats, saved_normal, meshes)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, ARGS['blend_out']), compress=True)


if __name__ == '__main__':
    main()
