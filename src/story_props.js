// story_props.js — P5b-1: 物語の小物(すべて実行時の自作メッシュ。ベイクしない＝懐中電灯と共通の環境光で見る)。
//  鍵(札付き。拾える物は弱い光沢＋細い光の筋がゆっくり瞬く)・メモ・管理室のキーボックス(扉付き・部屋番号の札のフック)・
//  風除室の鍵スイッチ・410 の隔て板の南京錠・黒い車の開いた扉。文字は架空(部屋番号・「玄関」「車」・手書きのメモ)だけ。
import * as THREE from 'three';

let ENV = null;
export function setPropEnv(env) { ENV = env; }
const brass = () => new THREE.MeshStandardMaterial({ color: 0xc9a85a, metalness: 1.0, roughness: 0.32, envMap: ENV, envMapIntensity: 0.12 });
const steel = (c = 0xa9acae, r = 0.38) => new THREE.MeshStandardMaterial({ color: c, metalness: 1.0, roughness: r, envMap: ENV, envMapIntensity: 0.1 });
// 塗装・樹脂は環境光(IBL)を使わない(露出 4.5 の夜では共通の環境の拡散が明るすぎて白く光る。金属だけ弱い映り込み＝P3 の metalEnv と同じ考え)
const paint = (c, r = 0.6) => new THREE.MeshStandardMaterial({ color: c, metalness: 0.0, roughness: r });

// ---------------------------------------------------------------- 文字の板(キャンバス)
export function textTexture(text, { w = 128, h = 80, bg = '#e8e2d2', fg = '#1e1a16', font = 'bold 44px "Hiragino Sans", sans-serif', hand = false, lines = null } = {}) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = font;
  const ls = lines || [text];
  ls.forEach((t, i) => {
    g.save();
    g.translate(w / 2, h / 2 + (i - (ls.length - 1) / 2) * (parseInt(font.match(/(\d+)px/)[1], 10) * 1.25));
    if (hand) g.rotate((i % 2 ? 1 : -1) * 0.04);
    g.fillText(t, 0, 0);
    g.restore();
  });
  if (hand) {   // 紙の汚れ・折り目
    g.strokeStyle = 'rgba(0,0,0,0.08)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(w * 0.5, 0); g.lineTo(w * 0.52, h); g.stroke();
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// 細い光の筋(加算の十字の板。ゆっくり瞬く)
let glintTex = null;
function glintTexture() {
  if (glintTex) return glintTex;
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 6);
  gr.addColorStop(0, 'rgba(255,248,225,1)'); gr.addColorStop(1, 'rgba(255,240,200,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  for (const [x0, y0, x1, y1] of [[2, 32, 62, 32], [32, 8, 32, 56]]) {
    const lg = g.createLinearGradient(x0, y0, x1, y1);
    lg.addColorStop(0, 'rgba(255,240,200,0)'); lg.addColorStop(0.5, 'rgba(255,246,220,0.9)'); lg.addColorStop(1, 'rgba(255,240,200,0)');
    g.strokeStyle = lg; g.lineWidth = 1.4; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  }
  glintTex = new THREE.CanvasTexture(cv); glintTex.colorSpace = THREE.SRGBColorSpace;
  return glintTex;
}
export function makeGlint(size = 0.07) {
  const m = new THREE.SpriteMaterial({ map: glintTexture(), color: 0xffffff, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const s = new THREE.Sprite(m); s.scale.set(size, size, 1); s.name = 'Glint';
  s.userData.phase = Math.random() * 6.28;
  return s;
}
// 瞬き: 4 秒周期で 0.6 秒だけ筋が光る(暗い所で見つけられる程度)
export function updateGlint(s, t) {
  const k = ((t + s.userData.phase) % 4.0) / 4.0;
  const pulse = k < 0.15 ? Math.sin(k / 0.15 * Math.PI) : 0;
  s.material.opacity = 0.18 + 0.55 * pulse;
}

// ---------------------------------------------------------------- 鍵(札付き)。原点 = 鍵の重心の下(床・机に置く時の接地点)。長さ方向 = +x
export function makeKey(label, { tagColor = '#e6dcc4', small = false } = {}) {
  const g = new THREE.Group(); g.name = 'Key_' + label;
  const M = brass();
  const s = small ? 0.75 : 1.0;
  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.011 * s, 0.0042 * s, 8, 18), M); bow.rotation.x = Math.PI / 2; bow.position.set(-0.022 * s, 0.003, 0);
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.042 * s, 0.0032, 0.0055 * s), M); shaft.position.set(0.012 * s, 0.002, 0);
  const tip = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.0032, 0.004 * s), M); tip.position.set(0.034 * s, 0.002, 0);
  g.add(bow, shaft, tip);
  for (const [x, w] of [[0.016, 0.004], [0.024, 0.005], [0.03, 0.003]]) { const t = new THREE.Mesh(new THREE.BoxGeometry(w * s, 0.0032, 0.0045 * s), M); t.position.set(x * s, 0.002, 0.0048 * s); g.add(t); }
  // 札(紐の輪＋文字の板)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.006, 0.0009, 6, 12), steel()); ring.rotation.x = Math.PI / 2; ring.position.set(-0.035 * s, 0.002, 0);
  const tagM = new THREE.MeshStandardMaterial({ map: textTexture(label, { w: 128, h: 72, bg: tagColor, font: `bold ${label.length > 3 ? 30 : 46}px "Hiragino Sans", sans-serif` }), roughness: 0.75 });
  const tag = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.0015, 0.022), [paint(0xcfc6b0), paint(0xcfc6b0), tagM, paint(0xcfc6b0), paint(0xcfc6b0), paint(0xcfc6b0)]);
  tag.position.set(-0.058 * s, 0.0008, 0.004); tag.rotation.y = 0.35;
  g.add(ring, tag);
  for (const o of g.children) { o.castShadow = true; o.receiveShadow = true; }
  const gl = makeGlint(0.08); gl.position.set(0.0, 0.012, 0); g.add(gl);
  g.userData.glint = gl;
  return g;
}
// 吊るした鍵(キーボックス・地下のフック): 縦向き
export function hangKey(k) { k.rotation.set(0, 0, Math.PI / 2 + 0.05); return k; }

// ---------------------------------------------------------------- メモ(床に落ちた紙)
export function makeMemo(lines, { w = 0.15, h = 0.105 } = {}) {
  const t = textTexture('', { w: 256, h: 180, bg: '#ece6d6', fg: '#262019', font: `${lines.length > 1 ? 30 : 64}px "Hiragino Maru Gothic ProN", "Hiragino Sans", sans-serif`, hand: true, lines });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, side: THREE.DoubleSide }));
  m.receiveShadow = true;
  const g = new THREE.Group(); g.name = 'Memo'; g.add(m);
  m.position.y = 0.0025;
  const gl = makeGlint(0.06); gl.position.y = 0.01; g.add(gl); g.userData.glint = gl;
  return g;
}

// ---------------------------------------------------------------- 管理室のキーボックス(壁掛けの鋼板の箱・左に蝶番の扉・札付きのフック 2 段 × 5)
// 原点 = 箱の背面の中心(壁の面)。+z = 箱の正面(部屋側)。ラベルの順に左上から
export const KEYBOX_LABELS = ['105', '220', '312', '705', 'B1', '玄関', '車', '', '', ''];
export function makeKeybox() {
  const W = 0.62, H = 0.62, D = 0.085, t = 0.006;
  const g = new THREE.Group(); g.name = 'Keybox';
  const body = paint(0x6b7073, 0.55), inner = paint(0x3c4043, 0.8);
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
  add(new THREE.BoxGeometry(W, H, t), inner, 0, 0, t / 2);                                   // 背板
  add(new THREE.BoxGeometry(t, H, D), body, -W / 2 + t / 2, 0, D / 2);                       // 側板
  add(new THREE.BoxGeometry(t, H, D), body, W / 2 - t / 2, 0, D / 2);
  add(new THREE.BoxGeometry(W, t, D), body, 0, H / 2 - t / 2, D / 2);
  add(new THREE.BoxGeometry(W, t, D), body, 0, -H / 2 + t / 2, D / 2);
  const hooks = {};
  KEYBOX_LABELS.forEach((lab, i) => {
    const col = i % 5, row = Math.floor(i / 5);
    const x = -W / 2 + 0.07 + col * 0.12, y = H / 2 - 0.12 - row * 0.27;
    const tagM = new THREE.MeshStandardMaterial({ map: textTexture(lab || ' ', { w: 128, h: 64, bg: lab ? '#e9e4d6' : '#d8d3c4', font: `bold ${lab.length > 2 ? 34 : 44}px "Hiragino Sans", sans-serif` }), roughness: 0.7 });
    const tag = add(new THREE.PlaneGeometry(0.07, 0.035), tagM, x, y + 0.035, t + 0.001);
    void tag;
    const hk = add(new THREE.CylinderGeometry(0.0028, 0.0028, 0.04, 8).rotateX(Math.PI / 2), steel(), x, y, t + 0.02);
    hk.castShadow = false;
    hooks[lab || ('_' + i)] = new THREE.Vector3(x, y - 0.004, t + 0.034);
  });
  // 扉(左の蝶番。原点 = 蝶番の線)
  const pivot = new THREE.Group(); pivot.position.set(-W / 2, 0, D); g.add(pivot);
  const doorM = paint(0x72777a, 0.5);
  const door = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.008), doorM); door.position.set(W / 2, 0, 0.004); door.castShadow = true; door.receiveShadow = true; pivot.add(door);
  const lock = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.012, 16).rotateX(Math.PI / 2), steel(0xc8c2b0, 0.3)); lock.position.set(W - 0.04, 0, 0.012); pivot.add(lock);
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.008, 0.002), paint(0x111111)); slot.position.set(W - 0.04, 0, 0.0185); pivot.add(slot);
  const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.04), new THREE.MeshStandardMaterial({ map: textTexture('KEY', { w: 160, h: 40, bg: '#2a2d30', fg: '#c9c4b6', font: 'bold 26px sans-serif' }), roughness: 0.6 }));
  lab.position.set(W / 2, 0.24, 0.0085); pivot.add(lab);
  g.userData = { pivot, hooks, W, H, D };
  return g;
}

// ---------------------------------------------------------------- 風除室の鍵スイッチ(ステンレスの小箱・鍵穴・表示灯)。原点 = 背面の中心、+z = 正面
export function makeKeySwitch() {
  const g = new THREE.Group(); g.name = 'KeySwitch';
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.04), steel(0xb7b9ba, 0.28)); box.position.z = 0.02; g.add(box);
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.01, 20).rotateX(Math.PI / 2), steel(0xd0c9b6, 0.25)); cyl.position.set(0, -0.02, 0.044); g.add(cyl);
  const slit = new THREE.Mesh(new THREE.BoxGeometry(0.0022, 0.014, 0.002), paint(0x0a0a0a)); slit.position.set(0, -0.02, 0.0495); g.add(slit);
  const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.008, 16), new THREE.MeshBasicMaterial({ color: 0x7a1a12 })); lamp.position.set(0, 0.045, 0.0405); g.add(lamp);
  for (const o of g.children) { o.castShadow = true; o.receiveShadow = true; }
  g.userData = { lamp, slit };
  return g;
}
export function setKeySwitchOn(g, on) { g.userData.lamp.material.color.set(on ? 0x2fb860 : 0x7a1a12); g.userData.slit.rotation.z = on ? Math.PI / 2 : 0; }

// ---------------------------------------------------------------- 南京錠(隔て板の縁に掛ける)。原点 = 掛け金の上端
export function makePadlock() {
  const g = new THREE.Group(); g.name = 'Padlock';
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.042, 0.02), brass()); body.position.y = -0.04; g.add(body);
  const sh = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.0035, 8, 16, Math.PI), steel(0xc2c4c6, 0.25)); sh.position.y = -0.019; g.add(sh);
  const hasp = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.004), steel(0x8a8c8e, 0.4)); hasp.position.set(0, -0.01, -0.012); g.add(hasp);
  for (const o of g.children) { o.castShadow = true; o.receiveShadow = true; }
  return g;
}

// ---------------------------------------------------------------- 黒い車の開いた運転席の扉(低ポリの車の横に開いた板＋窓の枠)。原点 = 蝶番
export function makeCarDoor() {
  const g = new THREE.Group(); g.name = 'CarDoorOpen';
  const p = paint(0x0d0e10, 0.35);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.62, 0.05), p); panel.position.set(-0.5, 0.62, 0); g.add(panel);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.04), p); frame.position.set(-0.47, 1.25, 0); g.add(frame);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.32), new THREE.MeshStandardMaterial({ color: 0x0a0c0e, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.45, envMap: ENV, envMapIntensity: 0.08 }));
  glass.position.set(-0.47, 1.08, 0); g.add(glass);
  // 扉の内張り(開いた扉の内側の面。灰色の樹脂・取っ手・ポケット)
  for (const zz of [0.03, -0.03]) {
    const inner = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.5, 0.01), paint(0x5c5852, 0.8)); inner.position.set(-0.5, 0.64, zz); g.add(inner);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.05), paint(0x3a3835, 0.7)); arm.position.set(-0.55, 0.78, zz * 1.8); g.add(arm);
  }
  for (const o of g.children) { o.castShadow = true; o.receiveShadow = true; }
  return g;
}
