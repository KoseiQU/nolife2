// title_samples.js — P6b-E1: タイトル画面のサンプル 4 案(DESIGN §3.11 #1)を、ゲーム内の本物の 3D(外観・管理人の attack・血飛沫・廊下・覗き穴)で撮る撮影ハーネス。
//  実装ではない(タイトル画面そのものは選択後に title.js へ)。静止画 1920×1080 の JPEG(品質 0.9)を返す。
//  使い方(ブラウザ。ビューポート 1920×1080 を明示): http://127.0.0.1:8011/index.html?noai&notutorial を開き、コンソールで
//    const m = await import('./tools/title_samples.js?v=' + Date.now());
//    const r = await m.shoot(window.__N2, 'A');   // r.jpeg = dataURL、r.stats = 輝度の統計(中間調 40〜120 の割合など)
//  撮った後はページを読み直す(露出・霧・ポスト・管理人の状態を片付けはするが、物語の状態までは戻さない)。
//  各案の座標・露出・クリップのフレームは SAMPLES と docs/p6b-e1/NOTES.md。

import { levelY } from '../src/world.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TITLE = { name: 'NOLIFE', font: '"Hiragino Mincho ProN", "Yu Mincho", "YuMincho", serif', spacing: 0.62, color: '#a9a196' };   // title.js と同じ明朝・字間・色

// ------------------------------------------------------------ 共通
async function prepare(N) {
  N.paused = true;
  if (N.title && N.title.active) N.title.click();
  N.ai.setDormant(false);
  N.ai.setState('SCRIPTED', { force: true });
  N.player.setFlashlight(false);
  N.movie.end();
  N.movie.blood.clear();
}

async function goTo(N, level, x, z, yaw = 0, pitch = 0) {
  await N.teleport(level, x, z, yaw, pitch);
  for (let i = 0; i < 400 && !N.world.isReady(level); i++) { N.pump(1 / 60, 1, false); await sleep(50); }
  N.pump(1 / 60, 90, false);   // 外の見た目の寄せ(0.4 秒)・扉・環境の初期化
}

// 管理人を演出体として置き、クリップの time で止める(timeScale 0)。face: { grin, attack }
function poseEnemy(N, level, x, z, yaw, { clip = 'look_idle', time = 0, face = {}, light = false, lean = 0, faceFill = 0, underLight = 0 } = {}) {
  const ai = N.ai, e = N.enemyObj;
  if (ai.level !== level) ai.setLevel(level);
  ai.setState('SCRIPTED', { force: true });
  ai.concealed = false; ai.transit = false;
  e.place(x, z, yaw);
  e.setFlashlight(light);
  e.aimPoint = null; e.speed = 0;
  const a = e.play(clip, { fade: 0, restart: true });
  a.time = time; a.timeScale = 0;
  for (const k of ['grin', 'attack']) e.setFace(k, face[k] || 0, true);
  e.lean = lean; e.faceFill = faceFill; e.underLight = underLight;
}

// カメラを (x, y, z) に置いて (tx, ty, tz) を見る。fov は度
function aim(N, x, y, z, tx, ty, tz, fov = 50, roll = 0) {
  const cam = N.camera;
  cam.position.set(x, y, z);
  cam.up.set(0, 1, 0);
  cam.lookAt(tx, ty, tz);
  if (roll) cam.rotateZ(roll);
  cam.fov = fov; cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
}

// 1 フレームだけ進めて(アニメの姿勢・霧・扉)カメラを上書きして描く。描いた直後に canvas を 2D へ写す
// 首と頭をカメラの方へ k の割合だけ向ける(クリップの姿勢の後に足す。撮影用。首と頭で半分ずつ)
function headToCamera(N, k) {
  const T = N.THREE, e = N.enemyObj, cam = N.camera.position;
  const neck = e.model.getObjectByName('mixamorigNeck');
  for (const b of [neck, e.bones.head]) {
    if (!b) continue;
    b.updateWorldMatrix(true, false);
    const wq = b.getWorldQuaternion(new T.Quaternion()), wp = b.getWorldPosition(new T.Vector3());
    const cur = new T.Vector3(0, 0, 1).applyQuaternion(wq).normalize();   // Mixamo の骨は +Z が顔の前
    const want = cam.clone().sub(wp).normalize();
    const d = new T.Quaternion().setFromUnitVectors(cur, want);
    d.slerp(new T.Quaternion(), 1 - k * 0.5);
    const nw = d.multiply(wq);
    const pq = b.parent.getWorldQuaternion(new T.Quaternion()).invert();
    b.quaternion.copy(pq.multiply(nw));
    b.updateMatrixWorld(true);
  }
  e.root.updateMatrixWorld(true);
}

function renderFrame(N, cam, { headTo = 0 } = {}) {
  N.pump(1 / 60, 1, false);
  aim(N, ...cam);
  const e = N.enemyObj;
  e.update(0, N.camera);   // 敵だけの光(常夜灯・顔の補助光)をこのカメラで
  if (headTo > 0) headToCamera(N, headTo);
  N.enemyObj.root.visible = !N.ai.concealed;
  N.render();
  const c = document.createElement('canvas'); c.width = 1920; c.height = 1080;
  c.getContext('2d').drawImage(N.renderer.domElement, 0, 0, 1920, 1080);
  return c;
}

// 画面の血(attack_movie.js の BloodOverlay と同じ描き方を、その実体のメソッドを借りて別の 2D キャンバスに描く)
function bloodPainter(N, g, w, h, seed = 7) {
  const proto = Object.getPrototypeOf(N.movie.blood);
  const B = Object.create(proto);
  Object.assign(B, { g, w, h, pending: [], drips: [], rand: mulberry(seed), pass: { enabled: true }, tex: {} });
  return B;
}

// タイトル文字(title.js の明朝・字間)。size は px、(cx, cy) は文字列の中心
function drawTitle(g, cx, cy, size, { alpha = 1, color = TITLE.color, glow = 0 } = {}) {
  g.save();
  g.font = `400 ${size}px ${TITLE.font}`;
  g.letterSpacing = `${(TITLE.spacing * size).toFixed(1)}px`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.globalAlpha = alpha;
  if (glow > 0) { g.shadowColor = 'rgba(0,0,0,0.85)'; g.shadowBlur = glow; }
  g.fillStyle = color;
  // 字間は末尾にも付くので、title.js の padding-left と同じく左へ半分ずらして中央に置く
  g.fillText(TITLE.name, cx + TITLE.spacing * size / 2, cy);
  g.restore();
  g.save();
  g.font = `400 ${size}px ${TITLE.font}`; g.letterSpacing = `${(TITLE.spacing * size).toFixed(1)}px`;
  const m = g.measureText(TITLE.name);
  g.restore();
  const wv = m.width - TITLE.spacing * size;
  return { x0: cx - wv / 2, x1: cx + wv / 2, top: cy - size * 0.36, bottom: cy + size * 0.36, size };
}

// 輝度の統計(sRGB 表示値の Rec.709 輝度)。mid = 40〜120 の割合、black = 8 未満の割合
function stats(c, box = null) {
  const g = c.getContext('2d');
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let s = 0, mid = 0, blk = 0, hi = 0; const n = c.width * c.height;
  for (let i = 0; i < d.length; i += 4) {
    const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    s += y; if (y >= 40 && y <= 120) mid++; if (y < 8) blk++; if (y > 200) hi++;
  }
  const r = { mean: +(s / n).toFixed(1), mid: +(mid / n).toFixed(3), black: +(blk / n).toFixed(3), high: +(hi / n).toFixed(4) };
  if (box) {   // 文字の箱の中の明るい画素(文字)と周りの差
    const [x0, y0, x1, y1] = box.map(Math.round);
    const dd = g.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    const ys = []; for (let i = 0; i < dd.length; i += 4) ys.push(0.2126 * dd[i] + 0.7152 * dd[i + 1] + 0.0722 * dd[i + 2]);
    ys.sort((a, b) => a - b);
    r.textBox = { p10: +ys[(ys.length * 0.1) | 0].toFixed(1), p50: +ys[(ys.length * 0.5) | 0].toFixed(1), p97: +ys[(ys.length * 0.97) | 0].toFixed(1) };
  }
  return r;
}

function mulberry(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// 一時的に変える物を控えて戻す
function saveLook(N) {
  const s = N.scene, R = N.renderer;
  return { exposure: R.toneMappingExposure, fog: s.fog ? { c: s.fog.color.clone(), d: s.fog.density } : null, fov: N.camera.fov, ext: { ...N.LOOK.ext, fogColor: [...N.LOOK.ext.fogColor] },
    bloom: N.passes.bloom ? { s: N.passes.bloom.strength, r: N.passes.bloom.radius, t: N.passes.bloom.threshold } : null };
}
function restoreLook(N, s) {
  const R = N.renderer;
  R.toneMappingExposure = s.exposure;
  Object.assign(N.LOOK.ext, s.ext);
  if (N.exterior.ready && N.exterior._applyLook) N.exterior._applyLook();
  if (s.fog && N.scene.fog) { N.scene.fog.color.copy(s.fog.c); N.scene.fog.density = s.fog.d; }
  if (s.bloom) Object.assign(N.passes.bloom, { strength: s.bloom.s, radius: s.bloom.r, threshold: s.bloom.t });
  N.camera.fov = s.fov; N.camera.updateProjectionMatrix();
  N.movie.blood.clear();
  if (N.peepholeObj.active) N.peephole(false);
  if (N.exterior) N.exterior.force = null;
  const e = N.enemyObj; e.lean = 0; e.faceFill = 0; e.underLight = 0;
  for (const k of ['grin', 'attack']) e.setFace(k, 0, true);
}

export const SAMPLES = {};

// 文字の下端(列ごとの一番下の画素)を拾う: 血の垂れ・飛沫の起点
function letterBottoms(size, cx, cy, step = 3) {
  const c = document.createElement('canvas'); c.width = 1920; c.height = 1080;
  const g = c.getContext('2d');
  const box = drawTitle(g, cx, cy, size, { color: '#fff' });
  const x0 = Math.max(0, Math.floor(box.x0) - 4), x1 = Math.min(1920, Math.ceil(box.x1) + 4), y0 = Math.max(0, Math.floor(cy - size)), y1 = Math.min(1080, Math.ceil(cy + size));
  const d = g.getImageData(x0, y0, x1 - x0, y1 - y0).data, W = x1 - x0, out = [];
  for (let x = 0; x < W; x += step) {
    for (let y = y1 - y0 - 1; y >= 0; y--) if (d[(y * W + x) * 4 + 3] > 140) { out.push([x0 + x, y0 + y]); break; }
  }
  return { box, bottoms: out };
}

// 文字の下の縁から血を垂らす(BloodOverlay の筋の描き方)。picks: 起点の数、len: 長さ(px)
function dripFromLetters(B, bottoms, { picks = 7, len = [60, 260], w = [2.2, 4.5], seed = 3 } = {}) {
  const R = mulberry(seed);
  // 底の低い所(字画の下端)に寄せて選ぶ
  const maxY = Math.max(...bottoms.map((b) => b[1]));
  const low = bottoms.filter((b) => b[1] > maxY - 6);
  const pool = low.length > picks * 2 ? low : bottoms;
  const used = [];
  for (let i = 0; i < picks * 6 && used.length < picks; i++) {
    const b = pool[(R() * pool.length) | 0];
    if (used.some((u) => Math.abs(u[0] - b[0]) < 28)) continue;
    used.push(b);
    const ww = w[0] + R() * (w[1] - w[0]), L = len[0] + R() ** 1.5 * (len[1] - len[0]);
    const rgb = [78 + R() * 52 | 0, 8 + R() * 7 | 0, 8 + R() * 6 | 0];
    B._soft(b[0], b[1] + 1, ww * 1.9, ww * 1.4, 0, 0.85, rgb);   // 縁に溜まった滴
    B.drips.push({ x: b[0], y: b[1] + 1, y0: b[1] + 1, w: ww, v: 160 + R() * 160, len: L, t: 0, a: 0.85, rgb, wob: R() * 6 });
  }
  for (let i = 0; i < 120; i++) B.update(1 / 60);   // 2 秒ぶん垂らす(筋は 1.4 秒で止まる)
  // 筋の先の膨らみ(重さで溜まった滴)
  for (const d of B.drips) B._soft(d.x + Math.sin(d.y * 0.04 + d.wob) * 1.2, d.y, d.w * 1.6, d.w * 2.1, 0, d.a * 0.8, d.rgb);
  return used;
}

// 文字の下端に飛沫(斜め下から叩きつけたような点の群れ)
function spatterUnder(B, box, { n = 70, spread = 1.0, seed = 5 } = {}) {
  const R = mulberry(seed);
  const cx = (box.x0 + box.x1) / 2, w = box.x1 - box.x0;
  const s = 1920 / 960;
  for (let i = 0; i < 260; i++) {   // 霧吹き状の微粒
    const x = cx + (R() - 0.5) * w * 1.05 * spread, y = box.bottom + (R() ** 1.6) * box.size * 0.55 - box.size * 0.12;
    const rr = (0.35 + R() ** 3 * 1.4) * s;
    B._soft(x, y, rr, rr * (0.7 + R() * 0.3), R() * 3, 0.35 + R() * 0.45, B._rgb());
  }
  for (let i = 0; i < n; i++) {
    const u = R();
    const r = (0.8 + 11 * u ** 5) * s;
    const x = cx + (R() - 0.5) * w * 1.1 * spread, y = box.bottom - box.size * 0.18 + (R() ** 1.3) * box.size * 0.7;
    B._drop(x, y, r, -Math.PI / 2 + (R() - 0.5) * 1.6, R() < 0.3 ? 0.4 + R() * 1.1 : 0);
  }
  for (let i = 0; i < 90; i++) B.update(1 / 60);
}

function compose(base, fn) {
  const c = document.createElement('canvas'); c.width = 1920; c.height = 1080;
  const g = c.getContext('2d');
  g.drawImage(base, 0, 0);
  fn(g);
  return c;
}
function finish(c, box) {
  return { jpeg: c.toDataURL('image/jpeg', 0.9), stats: stats(c, box ? [box.x0, box.top, box.x1, box.bottom] : null) };
}

const yawTo = (x, z, tx, tz) => Math.atan2(tx - x, tz - z);   // 管理人の向き(0 = +Z)
const along = (cam, d) => { const [x, , z, tx, , tz] = cam; const L = Math.hypot(tx - x, tz - z); return [x + (tx - x) / L * d, z + (tz - z) / L * d]; };

// A: 夜の外観が霧の奥にうっすら、手前に管理人の黒いシルエットがハンマーを振りかぶり、文字の下端に血の飛沫
SAMPLES.A = async (N, o = {}) => {
  await N.loadExterior();
  const cam = o.cam || [35.4, 0.85, 32.4, 16.0, 9.5, 14.0, 50];   // 南東の門の内側の地面近くから北西の建物を見上げる
  await goTo(N, 'G', cam[0], cam[2], 0, 0);
  const X = N.LOOK.ext;
  X.fogDensity = o.fogD ?? 0.06; X.fogColor = o.fogC ?? [0.016, 0.018, 0.024];
  N.exterior._applyLook();
  N.pump(1 / 60, 60, false);
  const [ex, ez] = along(cam, o.dist ?? 2.3);
  const off = o.side ?? 1.0;   // 画面の左右にずらす(視線に直交)
  const L = Math.hypot(cam[3] - cam[0], cam[5] - cam[2]), px = -(cam[5] - cam[2]) / L, pz = (cam[3] - cam[0]) / L;
  const x = ex + px * off, z = ez + pz * off;
  poseEnemy(N, 'G', x, z, yawTo(x, z, cam[0], cam[2]) + (o.turn ?? 1.2), { clip: 'attack_downward', time: o.time ?? 0.66, face: { attack: 0.6 } });   // 右半身をこちらへ(ハンマーが空に抜ける)
  N.renderer.toneMappingExposure = o.exposure ?? 3.7;
  const base = renderFrame(N, cam);
  let box;
  const c = compose(base, (g) => {
    const lb = letterBottoms(o.size ?? 118, 960, o.ty ?? 858);
    box = drawTitle(g, 960, o.ty ?? 858, o.size ?? 118, { glow: 18 });
    const B = bloodPainter(N, g, 1920, 1080, 11);
    spatterUnder(B, box, { n: 80, seed: 5 });
    dripFromLetters(B, lb.bottoms, { picks: 3, len: [20, 70], w: [1.8, 3], seed: 9 });
  });
  return finish(c, box);
};

// B: 覗き穴越しの管理人の顔(grin→attack の見開き)に血の筋、文字は小さく中央下
SAMPLES.B = async (N, o = {}) => {
  if (N.exterior.ready) N.exterior.force = false;   // 屋内の撮影: 外観(外の殻)を出さない(前の案で読み込んだ外観が廊下の手前に被ることがある)
  await goTo(N, 4, 8.62, 7.25, Math.PI / 2, 0);
  const D = N.world.doorById.get('410'); D.angle = 0; D.target = 0;
  const ep = o.enemy || [7.1, 7.24];   // 410 の扉(x 7.8)の前 0.4m。頭が覗き穴の正面に来る位置
  poseEnemy(N, 4, ep[0], ep[1], Math.PI / 2 + (o.turn ?? 0), { clip: o.clip ?? 'walk_oldman', time: o.time ?? 0.3, face: { grin: o.grin ?? 0.5, attack: o.attack ?? 0.95 }, lean: o.lean ?? 0, underLight: o.under ?? 0.3 });
  N.player.setPose(8.62, 7.25, Math.PI / 2, 0);
  N.peephole(true);
  N.pump(1 / 60, 30, false);
  N.enemyObj.place(ep[0], ep[1], Math.PI / 2 + (o.turn ?? 0));   // 覗き穴を開ける間に AI が向きを変えることがあるので置き直す
  N.pump(1 / 60, 1, false);
  N.renderer.toneMappingExposure = o.exposure ?? 6.0;
  // 血の筋: 襲撃ムービーの画面の血(BloodOverlay 1280×720)に、顔の上から下へ数本
  const Bl = N.movie.blood;
  Bl.clear(); Bl.pass.enabled = true;
  const R = mulberry(21);
  if (o.splash) {   // 襲撃ムービーのヒットの飛沫そのもの(attack_movie の splash。位置は画面中央付近の乱数)
    Bl.splash();
    for (let i = 0; i < 100; i++) Bl.update(1 / 60);
  }
  // 顔の上の筋: 額の上で潰れた滴(衛星の微粒つき)から、太さ・速さの違う筋が垂れる
  for (const [x, y, len, w] of o.streaks || [[612, 205, 300, 2.8], [640, 180, 380, 4.0], [668, 230, 210, 2.2], [696, 196, 330, 3.2]]) {
    Bl._drop(x, y, w * 2.4, Math.PI / 2 + (R() - 0.5) * 0.6, 0);
    for (let k = 0; k < 6; k++) Bl._soft(x + (R() - 0.5) * w * 9, y + (R() - 0.5) * w * 6, 0.8 + R() * w * 0.5, 0.8 + R() * w * 0.4, R() * 3, 0.7, Bl._rgb());
    Bl.drips.push({ x, y: y + w, y0: y + w, w: w * (0.8 + R() * 0.3), v: 220 + R() * 160, len, t: 0, a: 0.85, rgb: Bl._rgb(), wob: R() * 6 });
  }
  for (let i = 0; i < 120; i++) Bl.update(1 / 60);
  for (const d of Bl.drips) Bl._soft(d.x + Math.sin(d.y * 0.04 + d.wob) * 1.2, d.y, d.w * 1.5, d.w * 2.0, 0, d.a * 0.8, d.rgb);   // 筋の先の溜まり
  Bl.tex.needsUpdate = true;
  N.pump(1 / 60, 1, false);
  N.enemyObj.update(0, N.camera);
  N.render();
  const base = document.createElement('canvas'); base.width = 1920; base.height = 1080;
  base.getContext('2d').drawImage(N.renderer.domElement, 0, 0, 1920, 1080);
  let box;
  const c = compose(base, (g) => { box = drawTitle(g, 960, o.ty ?? 940, o.size ?? 46, { glow: 10 }); });
  N.peephole(false);
  return finish(c, box);
};

// C: 廊下の奥から常夜灯を背に近づく管理人、文字に血が垂れる
SAMPLES.C = async (N, o = {}) => {
  const cam = o.cam || [6.9, levelY(4) + 1.75, 6.3, 6.9, levelY(4) + 1.6, 21, 46];   // 4F の廊下の北端から南(EV ホール)へ
  if (N.exterior.ready) N.exterior.force = false;   // 屋内の撮影(B と同じ)
  await goTo(N, 4, 6.9, 6.0, 0, 0);
  const ez = o.ez ?? 10.0;   // 常夜灯(z 12.8)の手前 = 逆光
  poseEnemy(N, 4, o.ex ?? 6.85, ez, Math.PI + (o.turn ?? -0.4), { clip: o.clip ?? 'walk_oldman', time: o.time ?? 0.9, face: { grin: o.grin ?? 0.8 }, faceFill: o.fill ?? 0 });
  N.renderer.toneMappingExposure = o.exposure ?? 4.3;
  const base = renderFrame(N, cam);
  let box;
  const ty = o.ty ?? 205, size = o.size ?? 104;
  const c = compose(base, (g) => {
    const lb = letterBottoms(size, 960, ty);
    box = drawTitle(g, 960, ty, size, { glow: 14 });
    const B = bloodPainter(N, g, 1920, 1080, 17);
    dripFromLetters(B, lb.bottoms, { picks: o.picks ?? 8, len: [50, 300], w: [2.0, 4.2], seed: 4 });
  });
  return finish(c, box);
};

// D: 倒れた低い視点から見上げる振り下ろし直前(ハンマー頭上・attack の顔)、背景に建物の窓明かり
//  管理人は南(倒れたプレイヤー)を向き、カメラはその右前の地面すれすれ(ハンマーを持つ右腕が建物を背に抜ける)
SAMPLES.D = async (N, o = {}) => {
  await N.loadExterior();
  const [ex, ez] = o.enemy || [14.0, 32.8];   // 南面の前庭。背に 2F の灯りの窓(12.5, 3.9)と照明柱(12.5, 31.2)
  const yaw = o.yaw ?? 0, az = o.az ?? -0.35, cd = o.cd ?? 1.1, ch = o.ch ?? 0.3;   // 南を向く管理人の右前・地面から 0.3m
  const cx = ex + Math.sin(yaw + az) * cd, cz = ez + Math.cos(yaw + az) * cd;
  await goTo(N, 'G', cx, cz, 0, 0);
  poseEnemy(N, 'G', ex, ez, yaw, { clip: 'attack_downward', time: o.time ?? 0.68, face: { attack: 1.0 }, faceFill: o.fill ?? 1.1 });
  N.pump(1 / 60, 1, false);
  const head = N.enemyObj.headWorld(), hp = N.enemyObj.hammer.getWorldPosition(new N.THREE.Vector3());
  const t = o.look || [(head.x + hp.x) / 2 + (o.lx ?? 0), Math.max(head.y, hp.y) + (o.up ?? 0.15), (head.z + hp.z) / 2 + (o.lz ?? 0)];
  const cam = [cx, ch, cz, ...t, o.fov ?? 60, o.roll ?? 0];
  N.renderer.toneMappingExposure = o.exposure ?? 3.4;
  const base = renderFrame(N, cam, { headTo: o.headTo ?? 1.0 });   // 倒れたこちらを見下ろす(顔をカメラへ)
  let box;
  const c = compose(base, (g) => { box = drawTitle(g, o.tx ?? 960, o.ty ?? 140, o.size ?? 84, { glow: 16 }); });
  return finish(c, box);
};

// 探索用: クリップの各時刻の右手(ハンマー)の高さ - 頭の高さ
export async function probeClip(N, clip = 'attack_downward', n = 24) {
  await prepare(N);
  const e = N.enemyObj, out = [];
  const dur = e.clips[clip].duration;
  for (let i = 0; i <= n; i++) {
    const t = dur * i / n;
    poseEnemy(N, N.level, 6.9, 14, 0, { clip, time: t });
    N.pump(1 / 60, 1, false);
    const hp = e.hammer.getWorldPosition(new N.THREE.Vector3()), head = e.headWorld();
    out.push({ t: +t.toFixed(3), hammerOverHead: +(hp.y - head.y).toFixed(3), fwd: +((hp.x - head.x) * Math.sin(e.yaw) + (hp.z - head.z) * Math.cos(e.yaw)).toFixed(3) });
  }
  return out;
}

export async function shoot(N, id, opts = {}) {
  const S = SAMPLES[id];
  if (!S) throw new Error('title_samples: 案 ' + id + ' が無い');
  await prepare(N);
  const saved = saveLook(N);
  try {
    const r = await S(N, opts);
    return r;
  } finally {
    restoreLook(N, saved);
  }
}

export { prepare, goTo, poseEnemy, aim, renderFrame, bloodPainter, drawTitle, stats, levelY };
