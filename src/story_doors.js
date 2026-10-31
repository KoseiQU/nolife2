// story_doors.js — P3b-4: 進行解放の5室(room.story)の「怖い扉」(DESIGN §2.3)。
//  見た目だけ。当たり・扉の状態・管理人の AI には触れない(扉は施錠のまま)。
//  - 共有テクスチャ 2 枚(tools/blood_textures.py が自作の手続きで描く): blood_albedo.webp(色＋アルファ=厚み。アルファを凹凸にも使う)・
//    blood_rough.webp(粗さ。濡れ=低い→懐中電灯でぬめって光る/乾き=高い)。要素の矩形は blood_atlas.json
//  - デカール面: 扉板・枠・周りの壁・床に、要素ごとの格子(約 2.5cm)の板ポリを置く。格子の頂点ごとに階の GLB(結合済みの静的メッシュ)へ
//    レイを飛ばして下の面に貼り付け(枠の段差もなぞる)、下の面のライトマップ(uv1)を CPU で読んだ値を頂点属性 lmIrr に入れる。
//    → 材質はライトマップの代わりに lmIrr を間接光に足す＝下の面と同じ明るさ(暗い所で浮かない)。ライトマップの再ベイクは不要
//  - ノブ: レバーと座を一回り大きな箱で包み、血のアトラスの濃い所を貼る(ノブに付いた血)
//  - 近づいた時の演出(見た目だけ・音なし): 部屋ごとに1本「生乾きの垂れ」があり、扉の前 2.2m に初めて入ると数秒かけて下へ伸びる
//  - 部屋ごとの配分は RECIPES(105=床の引きずりが主、221=飛沫と垂れ、220=手形だらけ、312=扉の下から染み出す、705=上から垂れる・高い手形)
import * as THREE from 'three';

const FACING = { W: [-1, 0], E: [1, 0], N: [0, -1], S: [0, 1] };
const GRID = 0.025;          // 格子の目(m)
const LIFT = 0.0016;         // 面から浮かせる量(m)
const SKIP_MATS = /^(M_Handle|M_Closer|M_Glass|M_WireGlass|MX_|N2_)/;
const KNOB = { t: 0.345, y: 0.968 };   // build_floor.build_door: レバーの軸 = 扉板の戸先から 0.07、高さ 0.95+框
const LIVE_RADIUS = 2.2, LIVE_TIME = 7.5;

let atlasP = null;
let baseMat = null;
const liveMats = new Map();  // roomId → 材質(伸びた量を階の読み直しでも保つ)
export const storyDecor = new Map();   // roomId → { level, verts, tris, live }(テスト・確認用)

// ------------------------------------------------------------------ 部屋ごとの配分(扉の正面から見た座標)
//  縦の面 's:v': x = 扉の中心から右(m)、y = 床から(m)。扉板は x ±0.415・y 0.02〜2.0、枠は |x| 0.45〜0.49・上 2.04〜2.08
//  床 's:f': x = 右、d = 扉の面から廊下側へ(m)。drag = 引きずり痕 from→to([x, d])。
//  c = アトラスの要素、sc = 実寸に掛ける倍率、rot = 反時計回り(度)、flip = 左右反転、op = 不透明度、tint = 色の掛け算、
//  live = 近づくと伸びる垂れ。K = ノブ側(+1 = 右)
const DARK = [0.62, 0.55, 0.5];      // 汚れ(黒ずんだ茶)
const RECIPES = {
  // 1F: 床の引きずりが主。廊下の奥から斜めに扉の下へ、敷居に溜まる。扉は下半分だけ(引きずられながら掴んだ指・引っかき)、上は不気味にきれい
  '105': (K) => [
    { s: 'drag', from: [-K * 3.2, 1.3], to: [-K * 1.6, 1.0], w: 0.46, op: 0.9 },
    { s: 'drag', from: [-K * 1.95, 1.08], to: [-K * 0.05, -0.04], w: 0.56 },
    { s: 'drag', from: [-K * 1.2, 0.75], to: [K * 0.1, -0.04], w: 0.3, op: 0.7 },
    { s: 'f', c: 'seep', x: K * 0.02, d: 0.106, sc: 0.85, op: 0.9 },
    { s: 'f', c: 'drops', x: -K * 1.1, d: 1.5, rot: 80 + 10 * K, sc: 1.3 },
    { s: 'f', c: 'drops', x: -K * 2.4, d: 0.6, rot: 95, sc: 1.2, flip: true },
    { s: 'f', c: 'hand_b', x: -K * 0.7, d: 0.42, sc: 1.0, rot: 200 },            // 床に突いた手
    { s: 'f', c: 'spatter', x: K * 0.35, d: 0.32, sc: 0.85, rot: 40 },
    { s: 'v', c: 'smear', x: -K * 0.15, y: 0.3, sc: 1.4, rot: 15, flip: K < 0 },
    { s: 'v', c: 'hand_c', x: -K * 0.2, y: 0.66, sc: 1.0, rot: -8 * K },
    { s: 'v', c: 'hand_c', x: K * 0.05, y: 0.82, sc: 1.05, rot: 4 * K, flip: true },
    { s: 'v', c: 'hand_drag_a', x: K * 0.16, y: 0.48, sc: 1.0, rot: 6 * K, flip: K > 0 },
    { s: 'v', c: 'hand_drag_b', x: -K * 0.08, y: 0.42, sc: 0.95, rot: -10 * K },
    { s: 'v', c: 'hand_b', x: -K * 0.5, y: 0.4, sc: 1.0, rot: 70 * K },          // 枠を掴んだ(横向き)
    { s: 'v', c: 'hand_a', x: -K * 0.62, y: 0.2, sc: 0.95, rot: 100 * K, op: 0.85 },
    { s: 'v', c: 'spatter', x: -K * 0.75, y: 0.3, sc: 0.9, rot: 150 },
    { s: 'v', c: 'smear', x: K * 0.3, y: 0.98, sc: 0.75, rot: 160, tint: DARK },
    { s: 'v', c: 'live_drip', x: K * 0.02, y: 0.72, sc: 1.2, live: true },
  ],
  // 2F: 頭の高さで飛び散った(壁と扉に大きな飛沫)から何本も垂れる。手形は少なめ。床に飛沫と短い引きずり
  '221': (K) => [
    { s: 'drag', from: [-K * 1.0, 1.35], to: [-K * 0.15, -0.04], w: 0.4, op: 0.7 },
    { s: 'f', c: 'spatter', x: -K * 0.5, d: 0.35, sc: 1.4, rot: 200 },
    { s: 'f', c: 'spatter', x: K * 0.45, d: 0.6, sc: 1.0, rot: 20, flip: true },
    { s: 'f', c: 'drops', x: K * 0.4, d: 0.85, rot: -30, sc: 1.1 },
    { s: 'v', c: 'spatter', x: -K * 0.75, y: 1.55, sc: 1.8, rot: 10 },
    { s: 'v', c: 'spatter', x: -K * 0.1, y: 1.45, sc: 1.5, rot: 120, flip: true },
    { s: 'v', c: 'spatter', x: K * 0.35, y: 1.62, sc: 1.1, rot: 250 },
    { s: 'v', c: 'drips_a', x: -K * 0.78, y: 1.2, sc: 1.4 },
    { s: 'v', c: 'drips_b', x: -K * 0.12, y: 1.12, sc: 1.5, flip: true },
    { s: 'v', c: 'drips_a', x: K * 0.22, y: 1.3, sc: 1.2, flip: true },
    { s: 'v', c: 'drips_b', x: K * 0.62, y: 1.32, sc: 1.1 },
    { s: 'v', c: 'hand_drag_b', x: -K * 0.62, y: 1.25, sc: 1.0, rot: 8 },        // 壁に手を突いてずり落ちた
    { s: 'v', c: 'hand_a', x: K * 0.14, y: 1.0, sc: 1.0, rot: -12 * K, flip: K < 0 },
    { s: 'v', c: 'hand_b', x: K * 0.58, y: 0.98, sc: 1.0, rot: 5 },
    { s: 'v', c: 'smear', x: -K * 0.2, y: 0.35, sc: 1.2, rot: 30, op: 0.8 },
    { s: 'v', c: 'smear', x: K * 0.32, y: 0.95, sc: 0.75, rot: 200, tint: DARK },
    { s: 'v', c: 'live_drip', x: K * 0.13, y: 1.02, sc: 1.2, live: true },
  ],
  // 2F: 手形だらけ(扉板・枠・壁、高さもばらばら、重なる・逆さ・ずり落ちる)。床は点々だけ
  '220': (K) => {
    const H = ['hand_a', 'hand_b', 'hand_a', 'hand_drag_a', 'hand_b', 'hand_c', 'hand_a', 'hand_drag_b'];
    const out = [
      { s: 'f', c: 'drops', x: -K * 0.3, d: 0.55, rot: 15, sc: 1.1 },
      { s: 'f', c: 'drops', x: K * 0.75, d: 0.9, rot: 120, sc: 1.0, flip: true },
      { s: 'f', c: 'hand_a', x: K * 0.2, d: 0.35, sc: 1.0, rot: 170, op: 0.8 },
      { s: 'f', c: 'hand_b', x: -K * 0.35, d: 0.25, sc: 1.0, rot: 200, flip: true, op: 0.8 },
    ];
    // 決まった並び(乱数なし)。[x, y, 回転, 倍率, 種類の番号]。ノブの周り(掴もうとした)と扉の下・戸先側に群がり、上の方と壁はまばら
    const spots = [
      [0.3, 1.05, -20, 1.05, 1], [0.2, 0.92, 15, 1.0, 4], [0.36, 0.82, 80, 0.95, 0], [0.12, 1.18, -5, 1.1, 3], [0.28, 1.3, 30, 0.9, 4],
      [-0.05, 0.98, 160, 1.0, 0], [-0.22, 0.62, -15, 1.1, 3], [-0.32, 0.4, 20, 0.95, 5], [0.05, 0.42, 190, 1.0, 2], [-0.12, 0.2, 95, 0.9, 1],
      [0.25, 0.3, -35, 1.0, 5], [-0.28, 1.4, 8, 1.05, 7], [0.02, 1.62, 175, 0.85, 2], [-0.18, 1.85, -12, 0.9, 0],
      [-0.58, 1.3, 12, 1.0, 7], [-0.62, 0.75, -70, 0.95, 4], [-0.85, 1.05, 25, 0.9, 0], [-0.55, 0.3, 100, 1.0, 1],
      [0.6, 1.0, 10, 1.05, 3], [0.66, 0.55, -95, 1.0, 5], [0.85, 1.3, -20, 0.85, 4], [0.55, 1.75, 185, 0.9, 6],
    ];
    spots.forEach(([x, y, r, sc, k], i) => out.push({ s: 'v', c: H[k], x: K * x, y, sc, rot: r, flip: i % 3 === 1, op: 0.78 + 0.22 * ((i * 3) % 4) / 3 }));
    out.push({ s: 'v', c: 'smear', x: K * 0.36, y: 1.02, sc: 0.8, rot: 190 });
    out.push({ s: 'v', c: 'smear', x: -K * 0.1, y: 0.75, sc: 1.5, rot: 60, flip: true, op: 0.7 });
    out.push({ s: 'v', c: 'live_drip', x: K * 0.06, y: 1.0, sc: 1.2, live: true });
    return out;
  },
  // 3F: 扉の下から廊下へ大きく染み出した溜まり(濡れて光る)。扉板の裾は吸い上がって真っ黒、ずり落ちた跡、溜まりから点々が廊下の先へ
  '312': (K) => [
    // 溜まりの上辺(まっすぐな線)は扉板の下(d = -0.03)に隠す: d = 高さ/2 - 0.03
    { s: 'f', c: 'seep', x: K * 0.02, d: 0.226, sc: 1.6 },
    { s: 'f', c: 'drops', x: -K * 1.0, d: 1.0, rot: 70, sc: 1.3 },
    { s: 'f', c: 'drops', x: -K * 1.45, d: 1.2, rot: 80, sc: 1.3, flip: true },
    { s: 'f', c: 'drops', x: -K * 2.1, d: 1.3, rot: 92, sc: 1.2 },
    { s: 'f', c: 'drops', x: -K * 2.75, d: 1.25, rot: 98, sc: 1.1, flip: true },
    { s: 'v', c: 'spatter', x: K * 0.2, y: 0.08, sc: 0.8, rot: 270, op: 0.8 },
    { s: 'v', c: 'hand_drag_b', x: -K * 0.05, y: 0.66, sc: 1.05, rot: 3 },
    { s: 'v', c: 'hand_c', x: K * 0.22, y: 0.52, sc: 1.0, rot: -10 * K },
    { s: 'v', c: 'smear', x: K * 0.15, y: 0.3, sc: 1.3, rot: 100 },
    { s: 'v', c: 'hand_c', x: -K * 0.55, y: 0.35, sc: 1.0, rot: 80 * K },
    { s: 'v', c: 'smear', x: K * 0.3, y: 0.96, sc: 0.65, rot: 170, tint: DARK },
    { s: 'v', c: 'live_drip', x: K * 0.22, y: 0.62, sc: 1.2, live: true },
  ],
  // 7F: 扉の上(垂れ壁)から扉板へ何本も垂れてくる。届かない高さの逆さの手形、壁に大きく拭った跡、ノブ側から来た引きずり
  '705': (K) => [
    { s: 'drag', from: [K * 2.4, 1.25], to: [K * 0.6, 0.6], w: 0.48, op: 0.85 },
    { s: 'drag', from: [K * 0.9, 0.78], to: [K * 0.05, -0.04], w: 0.54 },
    { s: 'f', c: 'seep', x: 0, d: 0.106, sc: 0.85, op: 0.7 },
    { s: 'f', c: 'drops', x: K * 1.5, d: 0.45, rot: -80, sc: 1.2 },
    { s: 'v', c: 'drips_a', x: -K * 0.1, y: 2.15, sc: 1.7 },
    { s: 'v', c: 'drips_b', x: K * 0.24, y: 2.12, sc: 1.6, flip: true },
    { s: 'v', c: 'drips_a', x: -K * 0.4, y: 2.18, sc: 1.3, flip: true },
    { s: 'v', c: 'drips_b', x: K * 0.62, y: 2.2, sc: 1.2 },
    { s: 'v', c: 'drips_a', x: -K * 0.72, y: 2.22, sc: 1.1 },
    { s: 'v', c: 'hand_a', x: K * 0.1, y: 1.86, sc: 1.05, rot: 172, flip: true },
    { s: 'v', c: 'hand_a', x: -K * 0.25, y: 1.95, sc: 1.0, rot: 188 },
    { s: 'v', c: 'hand_drag_b', x: -K * 0.16, y: 1.12, sc: 1.05, rot: -4 },
    { s: 'v', c: 'hand_drag_a', x: K * 0.22, y: 1.25, sc: 1.0, rot: 6, flip: true },
    { s: 'v', c: 'smear', x: -K * 0.85, y: 1.3, sc: 2.0, rot: -20, flip: K > 0 },
    { s: 'v', c: 'smear', x: -K * 0.95, y: 0.8, sc: 1.6, rot: 10, flip: K > 0, op: 0.8 },
    { s: 'v', c: 'spatter', x: K * 0.85, y: 1.62, sc: 1.4, rot: 60 },
    { s: 'v', c: 'hand_b', x: K * 0.36, y: 0.95, sc: 0.95, rot: 100 * K },
    { s: 'v', c: 'smear', x: K * 0.3, y: 0.9, sc: 0.75, rot: 180, tint: DARK },
    { s: 'v', c: 'live_drip', x: -K * 0.32, y: 1.88, sc: 1.4, live: true },
  ],
};
// ノブの汚れの量(箱の面に貼るアトラスの範囲。seep の内側=べったり / 縁=まだら)
const KNOB_COAT = { '105': 0.55, '221': 0.6, '220': 1.0, '312': 0.35, '705': 0.85 };

// ------------------------------------------------------------------ 材質
function makeMaterial(world, reveal) {
  const map = world.texture('build/tex/blood_albedo.webp', true);
  const rough = world.texture('build/tex/blood_rough.webp', false);
  for (const t of [map, rough]) { t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true; }
  const m = new THREE.MeshStandardMaterial({
    name: 'N2_Blood', map, roughnessMap: rough, roughness: 1, metalness: 0, bumpMap: map, bumpScale: 0.5,
    transparent: true, depthWrite: false, vertexColors: true,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
  });
  // 濡れた所(粗さが低い)だけがはっきり映り込むよう、共通の環境を「鏡面反射だけ」に弱く使う(拡散は lmIrr が担う)
  m.envMap = world.envTex; m.envMapIntensity = 0.05;
  m.userData.reveal = reveal;   // 生乾きの垂れの伸び(静的な面は 9 = 全部見える)
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uReveal = reveal;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 lmIrr;\nattribute float reveal;\nvarying vec3 vLmIrr;\nvarying float vReveal;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvLmIrr = lmIrr;\nvReveal = reveal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLmIrr;\nvarying float vReveal;\nuniform float uReveal;')
      .replace('#include <bumpmap_pars_fragment>', THREE.ShaderChunk.bumpmap_pars_fragment.replaceAll('vBumpMapUv ).x', 'vBumpMapUv ).a')
        .replaceAll('dSTdx ).x', 'dSTdx ).a').replaceAll('dSTdy ).x', 'dSTdy ).a'))
      .replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\ndiffuseColor.a *= 1.0 - smoothstep( uReveal - 0.04, uReveal, vReveal );')
      .replace('#include <lights_fragment_maps>', 'irradiance += vLmIrr;\n' +
        THREE.ShaderChunk.lights_fragment_maps.replace('iblIrradiance += getIBLIrradiance( geometryNormal );', ''));
  };
  m.customProgramCacheKey = () => 'n2Blood';
  return m;
}

function liveMaterial(world, roomId) {
  if (!liveMats.has(roomId)) {
    const m = makeMaterial(world, { value: 0.1 });
    liveMats.set(roomId, { mat: m, t: 0, started: false });
  }
  return liveMats.get(roomId);
}

// ------------------------------------------------------------------ ライトマップの読み出し(CPU)
class LightmapReader {
  constructor() { this.cache = new Map(); }
  data(tex) {
    if (this.cache.has(tex)) return this.cache.get(tex);
    let d = null;
    const img = tex.image;
    if (img && img.width) {
      const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(img.width, img.height) : Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
      const g = cv.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      d = { px: g.getImageData(0, 0, img.width, img.height).data, w: img.width, h: img.height, srgb: tex.colorSpace === THREE.SRGBColorSpace };
    }
    this.cache.set(tex, d);
    return d;
  }
  // 双線形で読み、線形の放射照度(×強度)を返す
  sample(mat, u, v, out) {
    out[0] = out[1] = out[2] = 0;
    const tex = mat.lightMap;
    if (!tex) return out;
    const d = this.data(tex);
    if (!d) return out;
    const x = Math.min(Math.max(u * d.w - 0.5, 0), d.w - 1.001), y = Math.min(Math.max(v * d.h - 0.5, 0), d.h - 1.001);
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const k = mat.lightMapIntensity;
    for (let c = 0; c < 3; c++) {
      const p = (yy, xx) => { const s = d.px[(yy * d.w + xx) * 4 + c] / 255; return d.srgb ? srgbToLinear(s) : s; };
      const a = p(y0, x0) * (1 - fx) + p(y0, x0 + 1) * fx;
      const b = p(y0 + 1, x0) * (1 - fx) + p(y0 + 1, x0 + 1) * fx;
      out[c] = (a * (1 - fy) + b * fy) * k;
    }
    return out;
  }
}
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

// ------------------------------------------------------------------ 下の面(結合済みの静的メッシュの三角形を扉の周りだけ集める)
function collectTris(root, box) {
  const tris = [];
  root.updateMatrixWorld(true);
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh || o.userData.n2Blood) return;
    const m = o.material;
    if (Array.isArray(m) || m.transparent || SKIP_MATS.test(m.name || '')) return;
    const g = o.geometry, P = g.attributes.position, U1 = g.attributes.uv1 || null, idx = g.index;
    const n = idx ? idx.count : P.count;
    const mw = o.matrixWorld, ident = mw.equals(new THREE.Matrix4());
    for (let i = 0; i < n; i += 3) {
      const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2;
      va.fromBufferAttribute(P, a); vb.fromBufferAttribute(P, b); vc.fromBufferAttribute(P, c);
      if (!ident) { va.applyMatrix4(mw); vb.applyMatrix4(mw); vc.applyMatrix4(mw); }
      if (Math.max(va.x, vb.x, vc.x) < box.min.x || Math.min(va.x, vb.x, vc.x) > box.max.x) continue;
      if (Math.max(va.y, vb.y, vc.y) < box.min.y || Math.min(va.y, vb.y, vc.y) > box.max.y) continue;
      if (Math.max(va.z, vb.z, vc.z) < box.min.z || Math.min(va.z, vb.z, vc.z) > box.max.z) continue;
      tris.push({
        a: va.toArray(), b: vb.toArray(), c: vc.toArray(), mat: m, side: m.side,
        ua: U1 ? [U1.getX(a), U1.getY(a)] : null, ub: U1 ? [U1.getX(b), U1.getY(b)] : null, uc: U1 ? [U1.getX(c), U1.getY(c)] : null,
      });
    }
  });
  return tris;
}

// Möller–Trumbore。表側(レイに向いた面)だけ。最も近い当たり
function raycast(tris, o, d, maxT) {
  let best = null, bt = maxT;
  for (const T of tris) {
    const [ax, ay, az] = T.a;
    const e1x = T.b[0] - ax, e1y = T.b[1] - ay, e1z = T.b[2] - az;
    const e2x = T.c[0] - ax, e2y = T.c[1] - ay, e2z = T.c[2] - az;
    const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (T.side === THREE.DoubleSide ? Math.abs(det) < 1e-9 : (T.side === THREE.BackSide ? det > -1e-9 : det < 1e-9)) continue;
    const inv = 1 / det;
    const sx = o[0] - ax, sy = o[1] - ay, sz = o[2] - az;
    const u = (sx * px + sy * py + sz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (t > 1e-4 && t < bt) { bt = t; best = { t, tri: T, u, v }; }
  }
  if (!best) return null;
  const T = best.tri, w = 1 - best.u - best.v;
  const uv1 = T.ua ? [T.ua[0] * w + T.ub[0] * best.u + T.uc[0] * best.v, T.ua[1] * w + T.ub[1] * best.u + T.uc[1] * best.v] : null;
  return { t: best.t, mat: T.mat, uv1 };
}

// ------------------------------------------------------------------ 組み立て
class Builder {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.col = []; this.lm = []; this.rev = []; this.idx = []; this.n = 0; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 4));
    g.setAttribute('lmIrr', new THREE.Float32BufferAttribute(this.lm, 3));
    g.setAttribute('reveal', new THREE.Float32BufferAttribute(this.rev, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

export function decorateStoryDoors(world, level, rec) {
  const floor = world.building.floors.find((f) => f.level === level);
  if (!floor) return;
  const rooms = floor.rooms.filter((r) => r.story && r.door && RECIPES[r.id]);
  if (!rooms.length) return;
  if (!atlasP) atlasP = fetch('./build/tex/blood_atlas.json').then((r) => r.json());
  atlasP.then((atlas) => {
    if (rec.cancelled || world.floors.get(level) !== rec || !rec.group) return;
    if (!baseMat) baseMat = makeMaterial(world, { value: 9 });
    const reader = new LightmapReader();
    rooms.forEach((room, k) => setTimeout(() => {
      if (rec.cancelled || world.floors.get(level) !== rec || !rec.group) return;
      const t0 = performance.now();
      try { buildRoom(world, level, rec, room, atlas, reader); } catch (e) { console.error('story door', room.id, e); }
      const info = storyDecor.get(room.id);
      if (info) info.ms = +(performance.now() - t0).toFixed(1);
    }, 30 * k));
  });
}

function buildRoom(world, level, rec, room, atlas, reader) {
  const [px, pz] = room.door.pos;
  const y0 = (level - 1) * 2.9;
  const [nx, nz] = FACING[room.door.facing];
  const N = [nx, 0, nz], U = [0, 1, 0], R = [nz, 0, -nx];             // 廊下向き・上・(扉を見て)右
  const Tk = (room.door.facing === 'N' || room.door.facing === 'S') ? [1, 0, 0] : [0, 0, 1];   // ノブ側(build_floor の戸先)
  const K = Math.sign(Tk[0] * R[0] + Tk[2] * R[2]) || 1;
  const C = [px, y0, pz];
  const box = new THREE.Box3(new THREE.Vector3(px - 3.6, y0 - 0.3, pz - 3.6), new THREE.Vector3(px + 3.6, y0 + 2.8, pz + 3.6));
  const tris = collectTris(rec.group, box);
  const B = new Builder(), L = new Builder();
  const lmTmp = [0, 0, 0];
  const add3 = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
  const recipe = RECIPES[room.id](K);
  // 床 → 壁・扉の順(重なりは後が上)
  const order = [...recipe.filter((e) => e.s !== 'v'), ...recipe.filter((e) => e.s === 'v')];
  let liveInfo = null;
  const parts = [];   // 要素ごとの頂点数・ライトマップの明るさ(確認用)
  order.forEach((e, layer) => {
    const cell = atlas.cells[e.c || 'drag'];
    const [cx0, cy0, cw, ch] = cell.rect;
    const [S0, S1] = atlas.size;
    let center, ax, ay, w, h, dir, floorHit;
    if (e.s === 'drag') {
      const F = add3(add3(C, R, e.from[0]), N, e.from[1]), T = add3(add3(C, R, e.to[0]), N, e.to[1]);
      const dx = T[0] - F[0], dz = T[2] - F[2], len = Math.hypot(dx, dz);
      ax = [dx / len, 0, dz / len];
      ay = [-ax[2], 0, ax[0]];   // ax × up(上から見て裏返らない向き)
      center = [(F[0] + T[0]) / 2, y0, (F[2] + T[2]) / 2];
      w = len; h = e.w; dir = [0, -1, 0]; floorHit = true;
    } else {
      const sc = e.sc || 1;
      w = cell.mm[0] * sc / 1000; h = cell.mm[1] * sc / 1000;
      const r = THREE.MathUtils.degToRad(e.rot || 0), cr = Math.cos(r), sr = Math.sin(r);
      if (e.s === 'v') {
        center = add3(add3(C, R, e.x), U, e.y);
        ax = [cr * R[0] + sr * U[0], cr * R[1] + sr * U[1], cr * R[2] + sr * U[2]];
        ay = [sr * R[0] - cr * U[0], sr * R[1] - cr * U[1], sr * R[2] - cr * U[2]];
        dir = [-N[0], -N[1], -N[2]]; floorHit = false;
      } else {
        center = add3(add3(C, R, e.x), N, e.d);
        ax = [cr * R[0] - sr * N[0], 0, cr * R[2] - sr * N[2]];
        ay = [-ax[2], 0, ax[0]];
        dir = [0, -1, 0]; floorHit = true;
      }
      if (e.flip) ax = [-ax[0], -ax[1], -ax[2]];
    }
    const nu = Math.max(2, Math.ceil(w / GRID)), nv = Math.max(2, Math.ceil(h / GRID));
    // この要素の範囲(＋レイの長さ)に掛かる三角形だけを候補に(全部を総当たりすると 1 室 100ms を超える)
    const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (const su of [-0.5, 0.5]) for (const sv of [-0.5, 0.5]) {
      const P = add3(add3(center, ax, su * w), ay, sv * h);
      for (const Q of floorHit ? [[P[0], y0 + 0.45, P[2]], [P[0], y0 - 0.15, P[2]]] : [add3(P, N, 0.42), add3(P, N, -0.2)]) {
        for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], Q[k] - 0.01); hi[k] = Math.max(hi[k], Q[k] + 0.01); }
      }
    }
    const cand = tris.filter((T) => {
      for (let k = 0; k < 3; k++) {
        if (Math.max(T.a[k], T.b[k], T.c[k]) < lo[k] || Math.min(T.a[k], T.b[k], T.c[k]) > hi[k]) return false;
      }
      return true;
    });
    const tgt = e.live ? L : B;
    const base = tgt.n;
    const tint = e.tint || [1, 1, 1], op = e.op ?? 1;
    const depth = [];
    const lift = LIFT + layer * 0.00012;
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const u = i / nu, v = j / nv;
        const P = add3(add3(center, ax, (u - 0.5) * w), ay, (v - 0.5) * h);
        let o, hit, ok = false, pos = P;
        if (floorHit) {
          o = [P[0], y0 + 0.45, P[2]];
          hit = raycast(cand, o, dir, 0.6);
          if (hit) { const y = o[1] - hit.t; ok = Math.abs(y - y0) < 0.04; pos = [P[0], y + lift, P[2]]; }
        } else {
          o = add3(P, N, 0.42);
          hit = raycast(cand, o, dir, 0.62);
          if (hit) { const nn = 0.42 - hit.t; ok = nn > -0.12 && nn < 0.16; pos = add3(add3(P, N, nn), N, lift); }
        }
        depth.push(ok ? (hit.t) : NaN);
        if (ok && hit.uv1) reader.sample(hit.mat, hit.uv1[0], hit.uv1[1], lmTmp); else lmTmp[0] = lmTmp[1] = lmTmp[2] = 0;
        tgt.pos.push(...pos);
        tgt.nrm.push(-dir[0], -dir[1], -dir[2]);
        tgt.uv.push((cx0 + u * cw) / S0, (cy0 + v * ch) / S1);
        tgt.col.push(tint[0], tint[1], tint[2], op);
        tgt.lm.push(...lmTmp);
        tgt.rev.push(e.live ? v : 0);
        tgt.n++;
      }
    }
    const id = (i, j) => j * (nu + 1) + i;
    const good = (...k) => {
      const ds = k.map((q) => depth[q]);
      if (ds.some((x) => Number.isNaN(x))) return false;
      return Math.max(...ds) - Math.min(...ds) < 0.02;   // 枠の見付(1.2cm)はなぞる。扉板⇔枠の奥行き(7cm)は伸ばさず切る
    };
    // 表が -dir(見る側)を向く巻きに。格子の a→b→c の表は ax×ay の向きなので、それが -dir と逆なら入れ替える
    const cx = ax[1] * ay[2] - ax[2] * ay[1], cy = ax[2] * ay[0] - ax[0] * ay[2], cz = ax[0] * ay[1] - ax[1] * ay[0];
    const flip = cx * -dir[0] + cy * -dir[1] + cz * -dir[2] < 0;
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = id(i, j), b = id(i + 1, j), c = id(i + 1, j + 1), d = id(i, j + 1);
        const tri = (p, q, r) => { if (good(p, q, r)) tgt.idx.push(base + p, ...(flip ? [base + r, base + q] : [base + q, base + r])); };
        tri(a, b, c); tri(a, c, d);
      }
    }
    if (e.live) liveInfo = { x: center[0], z: center[2] };
    let lmMax = 0, lmSum = 0, hits = 0;
    for (let q = base; q < tgt.n; q++) { const v = tgt.lm[q * 3]; lmMax = Math.max(lmMax, v); lmSum += v; }
    for (const x of depth) if (!Number.isNaN(x)) hits++;
    parts.push({ c: e.c || 'drag', s: e.s, verts: tgt.n - base, hit: +(hits / depth.length).toFixed(2), lmMax: +lmMax.toFixed(3), lmAvg: +(lmSum / Math.max(1, tgt.n - base)).toFixed(3) });
  });
  // ノブ(レバー・座・軸)を包む箱
  {
    const lmK = [0, 0, 0];
    const kp = add3(add3(add3(C, Tk, KNOB.t - 0.08), U, KNOB.y), N, 0.42);
    const hit = raycast(tris, kp, [-N[0], 0, -N[2]], 0.62);
    if (hit && hit.uv1) reader.sample(hit.mat, hit.uv1[0], hit.uv1[1], lmK);
    const cov = KNOB_COAT[room.id] ?? 0.6;
    // 溜まり(seep)の縁をまたぐ範囲を貼る: べったりした所とまだらな所が混ざる。cov が大きいほど内側(べったり)寄り
    const cell = atlas.cells.seep.rect, S = atlas.size;
    const v0 = 0.05 + 0.5 * (1 - cov);
    const uvAt = (a, b) => [(cell[0] + cell[2] * (0.42 + 0.16 * a)) / S[0], (cell[1] + cell[3] * (v0 + 0.45 * b)) / S[1]];
    const g = 0.0022;
    const boxes = [   // [t0, t1, y0, y1, n0, n1](扉の局所: t = ノブ側の軸、n = 廊下向き)
      [KNOB.t - 0.13 - g, KNOB.t + 0.012 + g, KNOB.y - 0.011 - g, KNOB.y + 0.011 + g, 0.045 - g, 0.07 + g],
      [KNOB.t - 0.012 - g, KNOB.t + 0.012 + g, KNOB.y - 0.012 - g, KNOB.y + 0.012 + g, 0.012, 0.045],
      [KNOB.t - 0.03 - g, KNOB.t + 0.03 + g, KNOB.y - 0.06 - g, KNOB.y + 0.06 + g, 0.0, 0.012 + g],
    ];
    const P = (t, y, n) => add3(add3(add3(C, Tk, t), U, y), N, n);
    for (const [t0, t1, ya, yb, n0, n1] of boxes) {
      const faces = [   // 4隅(反時計回り=外向き)と法線
        [[P(t0, ya, n1), P(t1, ya, n1), P(t1, yb, n1), P(t0, yb, n1)], N],
        [[P(t0, yb, n0), P(t0, yb, n1), P(t1, yb, n1), P(t1, yb, n0)], U],
        [[P(t0, ya, n0), P(t1, ya, n0), P(t1, ya, n1), P(t0, ya, n1)], [0, -1, 0]],
        [[P(t1, ya, n0), P(t1, yb, n0), P(t1, yb, n1), P(t1, ya, n1)], Tk],
        [[P(t0, ya, n0), P(t0, ya, n1), P(t0, yb, n1), P(t0, yb, n0)], [-Tk[0], 0, -Tk[2]]],
      ];
      faces.forEach(([q, nrm], fi) => {
        const b0 = B.n;
        const st = [[0, 0], [1, 0], [1, 1], [0, 1]];
        const o = [(fi * 0.37) % 0.5, (fi * 0.23) % 0.5];
        q.forEach((p, k) => {
          B.pos.push(...p); B.nrm.push(...nrm);
          B.uv.push(...uvAt(o[0] + st[k][0] * 0.5, o[1] + st[k][1] * 0.5));
          B.col.push(0.85, 0.8, 0.8, 1); B.lm.push(...lmK); B.rev.push(0); B.n++;
        });
        // 外向きの巻き: (q1-q0)×(q2-q0) が nrm を向くように
        const e1 = [q[1][0] - q[0][0], q[1][1] - q[0][1], q[1][2] - q[0][2]], e2 = [q[2][0] - q[0][0], q[2][1] - q[0][1], q[2][2] - q[0][2]];
        const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const out = cr[0] * nrm[0] + cr[1] * nrm[1] + cr[2] * nrm[2] > 0;
        B.idx.push(...(out ? [b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3] : [b0, b0 + 2, b0 + 1, b0, b0 + 3, b0 + 2]));
      });
    }
  }
  const mesh = new THREE.Mesh(B.geometry(), baseMat);
  mesh.name = 'StoryDoorDecal_' + room.id;
  mesh.userData.n2Blood = true;
  mesh.castShadow = false; mesh.receiveShadow = true;
  mesh.renderOrder = 3;
  rec.group.add(mesh);
  let live = null;
  if (L.n) {
    const lm = liveMaterial(world, room.id);
    const lmesh = new THREE.Mesh(L.geometry(), lm.mat);
    lmesh.name = 'StoryDoorLiveDrip_' + room.id;
    lmesh.userData.n2Blood = true;
    lmesh.castShadow = false; lmesh.receiveShadow = true;
    lmesh.renderOrder = 4;
    rec.group.add(lmesh);
    live = { ...liveInfo, door: [px, pz] };
  }
  storyDecor.set(room.id, { level, verts: B.n + L.n, tris: (B.idx.length + L.idx.length) / 3, triangles: tris.length, live: !!live, door: [px, pz], parts });
}

// 近づいた時の演出(見た目だけ): 扉の前 LIVE_RADIUS に初めて入ると、生乾きの垂れが LIVE_TIME 秒かけて下へ伸びる
export function updateStoryDoors(dt, levelKey, x, z) {
  for (const [id, info] of storyDecor) {
    const lm = liveMats.get(id);
    if (!lm) continue;
    if (!lm.started && info.level === levelKey && Math.hypot(x - info.door[0], z - info.door[1]) < LIVE_RADIUS) lm.started = true;
    if (lm.started && lm.t < 1) {
      lm.t = Math.min(1, lm.t + dt / LIVE_TIME);
      const e = 1 - Math.pow(1 - lm.t, 2.2);       // 最初は速く、だんだん遅く
      lm.mat.userData.reveal.value = 0.1 + 0.95 * e;
    }
  }
}
// テスト・スクショ用: 伸びた量を直接決める(0..1)。null で全部を初期状態に
export function setLiveDrip(id, t) {
  for (const [rid, lm] of liveMats) {
    if (id !== null && rid !== id) continue;
    lm.t = t ?? 0; lm.started = t !== null && t > 0;
    lm.mat.userData.reveal.value = 0.1 + 0.95 * (1 - Math.pow(1 - lm.t, 2.2));
  }
}
