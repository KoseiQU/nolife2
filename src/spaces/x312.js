// spaces/x312.js — 別空間 X312「312 無限の自室」(DESIGN §3.8 I の 312 の行・D③・H 第3段)。P5b-4(プールから作り直し)。
//  312 の扉を開けると中は「自分の部屋 410」と同じ 1K(玄関→廊下→洋室)。洋室の奥、本来は掃き出し窓がある所に扉(居室と同じ木扉)があり、開けるとまた 410。
//  行きは 5 部屋(R1〜R5)で少しずつ変わる: R1 = 410 と同じ / R2 = 床に本と服・机のコップが 2 つ / R3 = ポスターが白い紙・時計が止まる・カーテンが閉まる /
//   R4 = ベッドに誰かが寝ていた跡(くぼみ・乱れた布団)・クローゼットが半開き / R5 = 灯りが消えている(懐中電灯だけ)・机に 105 の鍵・ベッド脇に管理人が座ってこちらを見ている。
//  鍵を取ると戻り: ①伸びる(戻りは 7 部屋 B1〜B7)②歪み(戻りの部屋は家具が鏡像。通ってきた扉は、閉めて目を離すと窓際の別の位置に移っている)
//   ③管理人(戻りの各部屋で扉に近づく: 座る → 立つ → 戸口に立つ。最後は戸口の脇。襲わない)。B7 の玄関の扉 = 312 の扉 → 3F の廊下。
//  死なない空間(水・息・潜水は廃止)。鍵の後にもう一度入ると 1 部屋だけの普通の 410 の複製(奥の扉は開かない)。
//
//  作り: 410 の内装は 4F の GLB(build/floor_4.glb)から 410 の矩形の三角形だけを抜き出した「型」(居室と同じ形・同じテクスチャ)。
//   部屋の実体は SLOTS 個だけ持ち(プレイヤーのいる部屋とその前後)、扉を閉めた後ろの部屋は別の部屋に作り直す(105 の区画の継ぎ足しと同じ考え)。
//   光は three.js のライトを足さず、材質のシェーダの中で部屋ごとの天井灯を計算(ライトマップの代わり。R5 は消灯)＋懐中電灯。
//  座標: 型の局所 (tu, h, tz) = 410 の (x − 7.8, y − 8.7, z − 5.8)。tu = 玄関の壁(0)→ 窓の壁(6)、tz = 部屋の幅(0..2.9)。
//   部屋 rec の世界座標 = (rec.x0 + tu, SPACE_Y + h, rec.mirror ? rec.zBase − tz : rec.zBase + tz)。行きは +x へ、戻りは −x へ並ぶ。
//  P6b(§3.9 #4): 合成の効果音(open/close/key/lookup)は無音(ログだけ残す)。行きの扉の番号札はカウントダウン 4・3・2・1・0
//   (R1→R2 = 4 … R4→R5 = 1、R5 の奥の開かない扉 = 0)。戻りの扉は札なし。札は玄関の札と同じアトラス(build/tex/room_plates.png)の数字を切り出して作る。

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SPACE_Y } from '../world.js';
import { actx, burst } from './gb.js';

const OX = 330, OZ = 0;
const TPL = { glb: './build/floor_4.glb', pal: './build/tex/room_palette.json', room: '410', x: 7.8, y: 8.7, z: 5.8, level: 4,
  plates: './build/tex/room_plates.png', platesUV: './build/tex/room_plates.json', plateMat: 'M_RoomPlate' };
// 調整値(docs/p5b4/NOTES.md)
export const X312 = {
  pitch: 6.0,                 // 部屋の並び(玄関の壁から次の玄関の壁まで)
  fwd: 5, back: 7,            // 行き 5 部屋・戻り 7 部屋
  slots: 3,                   // 部屋の実体の数(今の部屋と前後)
  door: { c: 1.45, half: 0.415, open: 1.45, speed: 2.6, slam: 7.0, reach: 1.5, gap: 0.45, h: 2.04 },   // 扉(中心 tz・板の半幅・開く角・速さ rad/s)
  shiftTz: 1.95,              // ②歪み: 戻りの部屋の「通ってきた扉」が移る先(窓際の椅子の前)
  lamp: { on: 1.0, ret: 0.78, pos: [4.6, 2.30, 1.45] },   // 天井灯(R1〜R4・戻り)
  key: [4.42, 0.735, 2.48],   // 105 の鍵(R5 の机の上 = 410 の points.desk)
  enterAt: 0.3,               // 部屋の境目から何 m 入ったら「その部屋にいる」
  fog: [0x050404, 0.035],
  // 管理人の位置(型の局所 tu, tz・姿勢)。行きの R5 と戻りの B1〜B7。戻りは玄関の扉(tu 0)へ近づいていく
  spots: {
    R5: { pose: 'sit', tu: 5.0, tz: 0.80 },
    B1: { pose: 'sit', tu: 4.55, tz: 0.80 }, B2: { pose: 'sit', tu: 3.85, tz: 0.80 },
    B3: { pose: 'stand', tu: 3.70, tz: 1.17 }, B4: { pose: 'stand', tu: 3.05, tz: 1.18 }, B5: { pose: 'stand', tu: 2.25, tz: 1.18 },
    B6: { pose: 'stand', tu: 1.35, tz: 1.18 }, B7: { pose: 'stand', tu: 0.42, tz: 2.20 },
  },
  sit: { drop: 0.40, thigh: 1.5, knee: -1.55, spine: 0.14, arm: 0.6, fore: 0.45 },   // 座る姿勢(骨の回転 rad・腰を下げる m)
  look: { down: 0.55, cone: 0.32, range: 7.0, rate: 2.2 },   // 懐中電灯を当てると顔を上げる
};
const DR = X312.door;

export const DEF = {
  origin: [OX, OZ], host: { level: 3, door: '312' },
  entry: [0.75, DR.c, -Math.PI / 2],          // R1 の玄関の内側・奥(+x)を向く
  exit: [0.06, DR.c],
  slots: { key: [X312.pitch * (X312.fwd - 1) + X312.key[0], X312.key[1], X312.key[2]] },   // R5 の机
};
const X = (u) => OX + u, Z = (v) => OZ + v;

// ================================================================ 部屋の記録(行き・戻り・鍵の後の 1 部屋)
//  entry/exit = 入ってくる側/出ていく側('genkan' = 玄関の扉、'window' = 窓の扉)。farTz = 窓の扉の中心(型の tz)
function fwdRec(n) {
  return { id: 'R' + n, kind: 'R', n, x0: OX + X312.pitch * (n - 1), zBase: OZ, mirror: false, entry: 'genkan', exit: 'window', farTz: DR.c,
    v: { extras: n >= 2, poster: n >= 3 ? 'blank' : 'orig', clock: n >= 3 ? 'stop' : 'run', curtain: n >= 3 ? 'closed' : 'orig', bed: n >= 4 ? 'messy' : 'orig', closet: n >= 4 ? 0.5 : 0, lamp: n >= 5 ? 0 : X312.lamp.on } };
}
function backRec(j, r5) {
  return { id: 'B' + j, kind: 'B', n: j, x0: r5.x0 - X312.pitch * j, zBase: OZ + 2.9, mirror: true, entry: 'window', exit: 'genkan', farTz: DR.c, shifted: false,
    v: { extras: true, poster: 'blank', clock: 'stop', curtain: 'around', bed: 'messy', closet: 0.5, lamp: X312.lamp.ret } };
}
function plainRec() {
  return { id: 'P1', kind: 'P', n: 1, x0: OX, zBase: OZ, mirror: false, entry: 'genkan', exit: 'window', farTz: DR.c,
    v: { extras: false, poster: 'orig', clock: 'run', curtain: 'orig', bed: 'orig', closet: 0, lamp: X312.lamp.on } };
}
// 型の局所 → 世界
const wx = (rec, tu) => rec.x0 + tu;
const wz = (rec, tz) => (rec.mirror ? rec.zBase - tz : rec.zBase + tz);
const toLocal = (rec, x, z) => ({ tu: x - rec.x0, tz: rec.mirror ? rec.zBase - z : z - rec.zBase });

// ================================================================ 型(4F の GLB から 410 を抜き出す)
//  parts: static(常に)・poster・curtain・bedding・cup(複製用)。door: 玄関の扉の板(蝶番の局所)・枠。closet: 折戸(外の板と内の板の蝶番)
async function loadTemplate(ctx) {
  const [gltf, pal, plates] = await Promise.all([new GLTFLoader().loadAsync(TPL.glb), fetch(TPL.pal).then((r) => r.json()), loadPlates().catch(() => null)]);
  const root = gltf.scene; root.updateMatrixWorld(true);
  const floor = ctx.building.floors.find((f) => f.level === TPL.level);
  const room = floor.rooms.find((r) => r.id === TPL.room);
  const IT = [...room.interior.items, ...room.interior.decor];
  const boxOf = (k) => { const it = IT.find((q) => q.k === k); return it ? { x0: it.b[0], z0: it.b[1], x1: it.b[2], z1: it.b[3], y0: it.y[0], y1: it.y[1] } : null; };
  const inBox = (b, p, m = 0.012) => b && p.x > b.x0 - m && p.x < b.x1 + m && p.z > b.z0 - m && p.z < b.z1 + m && p.y - TPL.y > b.y0 - m && p.y - TPL.y < b.y1 + m;
  const B = { poster: boxOf('poster'), bed: boxOf('bed'), cup: boxOf('cup'), ac: boxOf('ac'), clock: boxOf('clock'), curtain: boxOf('curtain') };
  // パレットの JSON は Blender の UV(v が上向き)。glTF の UV は v を反転している
  const cell = (k) => { const c = pal[k]; return [(c[0] + c[2]) / 2, 1 - (c[1] + c[3]) / 2]; };
  const inCell = (k, u, v) => { const c = pal[k]; v = 1 - v; return c && u >= c[0] - 1e-3 && u <= c[2] + 1e-3 && v >= c[1] - 1e-3 && v <= c[3] + 1e-3; };
  const bedKeys = [room.interior.variant.bedding || 'blue', 'white'];
  const parts = { static: new Map(), poster: new Map(), curtain: new Map(), bedding: new Map(), cup: new Map() };
  const mats = new Map();
  const put = (part, mat, P, N, UV) => {
    if (!parts[part].has(mat.name)) parts[part].set(mat.name, { p: [], n: [], uv: [] });
    const a = parts[part].get(mat.name);
    for (let k = 0; k < 3; k++) { a.p.push(P[k].x - TPL.x, P[k].y - TPL.y, P[k].z - TPL.z); a.n.push(N[k].x, N[k].y, N[k].z); a.uv.push(UV[k].x, UV[k].y); }
    if (!mats.has(mat.name)) mats.set(mat.name, mat);
  };
  // 三角形ごとに(世界座標で)回す
  const eachTri = (o, fn) => {
    const g = o.geometry, pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv, idx = g.index;
    const nm = new THREE.Matrix3().getNormalMatrix(o.matrixWorld);
    const cnt = idx ? idx.count : pos.count;
    for (let t = 0; t < cnt; t += 3) {
      const P = [], N = [], UV = [];
      for (let k = 0; k < 3; k++) {
        const i = idx ? idx.getX(t + k) : t + k;
        P.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld));
        N.push(new THREE.Vector3().fromBufferAttribute(nor, i).applyMatrix3(nm).normalize());
        UV.push(uv ? new THREE.Vector2().fromBufferAttribute(uv, i) : new THREE.Vector2());
      }
      fn(P, N, UV);
    }
  };
  const groupOf = (o) => { for (let p = o; p; p = p.parent) if (/^J\d_/.test(p.name)) return p.name.replace(/^J\d_/, ''); return null; };
  root.traverse((o) => {
    if (!o.isMesh) return;
    const grp = groupOf(o), mat = o.material;
    if (!grp || !['closet', 'decor', 'furn', 'roomwall', 'wincurtain'].includes(grp)) return;
    if (!mat.name.startsWith('MR_') || mat.name === 'MR_Alu') return;
    eachTri(o, (P, N, UV) => {
      const c = P[0].clone().add(P[1]).add(P[2]).multiplyScalar(1 / 3);
      if (!(c.x > TPL.x + 0.02 && c.x < TPL.x + 5.98 && c.z > TPL.z + 0.02 && c.z < TPL.z + 2.88 && c.y > TPL.y - 0.01 && c.y < TPL.y + 2.42)) return;
      const tu = c.x - TPL.x;
      // 窓の壁(内側の面と幅木)は自前で作り直す(窓の代わりに扉)
      if (tu > 5.9 && Math.abs(N[0].x) > 0.9 && (mat.name === 'MR_Wall' || mat.name === 'MR_Base') && grp === 'roomwall') return;
      if (tu > 5.88 && mat.name === 'MR_Base') return;
      if (mat.name === 'MR_Pal' && inBox(B.curtain, c, 0.05)) { put('curtain', mat, P, N, UV); return; }
      if (mat.name === 'MR_Print' && inBox(B.poster, c)) { put('poster', mat, P, N, UV); return; }
      if (mat.name === 'MR_Pal' && inBox({ ...B.bed, y1: 0.9 }, c, 0.08) && bedKeys.some((k) => inCell(k, UV[0].x, UV[0].y))) { put('bedding', mat, P, N, UV); return; }
      if (inBox(B.ac, c, 0.02)) for (const p of P) p.y += 0.1;   // エアコンは扉の枠と重ならないよう 10cm 上へ(天井まで)
      if (mat.name === 'MR_PalGloss' && inBox(B.cup, c)) put('cup', mat, P, N, UV);
      put('static', mat, P, N, UV);
    });
  });
  // 玄関の扉(板は蝶番の局所・枠と上の壁は型の局所)
  const door = { leaf: new Map(), frame: new Map(), pivot: null };
  const leafNode = root.getObjectByName('DoorLeaf_' + TPL.room);
  const piv = new THREE.Vector3().setFromMatrixPosition(leafNode.matrixWorld);
  door.pivot = [piv.x - TPL.x, piv.y - TPL.y, piv.z - TPL.z];
  const inv = new THREE.Matrix4().copy(leafNode.matrixWorld).invert();
  const local = (map, o, M, off) => eachTri(o, (P, N, UV) => {
    const name = o.material.name;
    if (!map.has(name)) map.set(name, { p: [], n: [], uv: [] });
    const a = map.get(name);
    const nm = M ? new THREE.Matrix3().getNormalMatrix(M) : null;
    for (let k = 0; k < 3; k++) {
      const q = M ? P[k].clone().applyMatrix4(M) : P[k].clone().sub(off);
      const n = nm ? N[k].clone().applyMatrix3(nm).normalize() : N[k];
      a.p.push(q.x, q.y, q.z); a.n.push(n.x, n.y, n.z); a.uv.push(UV[k].x, UV[k].y);
    }
    if (!mats.has(name)) mats.set(name, o.material);
  });
  leafNode.traverse((o) => { if (o.isMesh) local(door.leaf, o, inv, null); });
  const off = new THREE.Vector3(TPL.x, TPL.y, TPL.z);
  for (const nm of ['DoorFrame_' + TPL.room, 'Lintel_' + TPL.room]) root.getObjectByName(nm).traverse((o) => { if (o.isMesh) local(door.frame, o, null, off); });
  // クローゼットの折戸(外の板 = ClosetDoor_*、子の内の板 = ClosetDoorIn_*)
  const closet = [];
  for (const side of ['L', 'R']) {
    const outer = root.getObjectByName(`ClosetDoor_${side}_${TPL.room}`), inner = root.getObjectByName(`ClosetDoorIn_${side}_${TPL.room}`);
    const op = new THREE.Vector3().setFromMatrixPosition(outer.matrixWorld);
    const oi = new THREE.Matrix4().copy(outer.matrixWorld).invert();
    const ii = new THREE.Matrix4().copy(inner.matrixWorld).invert();
    const ip = new THREE.Vector3().setFromMatrixPosition(inner.matrixWorld).applyMatrix4(oi);
    const og = new Map(), ig = new Map();
    local(og, outer, oi, null);   // 外の板のメッシュだけ(子は別)
    inner.traverse((o) => { if (o.isMesh) local(ig, o, ii, null); });
    // 開く向き: 外の板の中心が部屋の側(−tz。クローゼットの正面は北 = −z)へ出る回転を正に(rooms.js _closetSigns と同じ)
    const bb = new THREE.Box3(); outer.geometry.computeBoundingBox(); bb.copy(outer.geometry.boundingBox).applyMatrix4(outer.matrixWorld);
    const ctr = bb.getCenter(new THREE.Vector3());
    const rx = ctr.x - op.x, rz = ctr.z - op.z;
    const sign = (rz * 0 - rx * -1) >= 0 ? 1 : -1;
    closet.push({ side, pivot: [op.x - TPL.x, op.y - TPL.y, op.z - TPL.z], ipivot: [ip.x, ip.y, ip.z], outer: og, inner: ig, sign });
  }
  // 当たり(家具)・壁の当たりは build で
  const solids = room.interior.solids.map((s) => [s[0] - TPL.x, s[1] - TPL.z, s[2] - TPL.x, s[3] - TPL.z, s[4], s[5]]);
  return { parts, door, closet, mats, solids, cell, pal, plates, B: Object.fromEntries(Object.entries(B).map(([k, b]) => [k, b && { tu0: b.x0 - TPL.x, tu1: b.x1 - TPL.x, tz0: b.z0 - TPL.z, tz1: b.z1 - TPL.z, h0: b.y0, h1: b.y1 }])) };
}
// P6b #4: 号室プレートのアトラス(make_textures.py の room_plates。1 マス 128×64・Inter の数字)と UV 表(Blender の UV = v 上向き)
async function loadPlates() {
  const [uv, blob] = await Promise.all([fetch(TPL.platesUV).then((r) => r.json()), fetch(TPL.plates).then((r) => r.blob())]);
  const img = await createImageBitmap(blob);
  return { uv, img };
}
// アトラスのマス id の画素の矩形
function plateCell(P, id) {
  const c = P.uv[id]; if (!c) return null;
  const W = P.img.width, H = P.img.height;
  return { x: Math.round(c[0] * W), y: Math.round((1 - c[3]) * H), w: Math.round((c[2] - c[0]) * W), h: Math.round((c[3] - c[1]) * H) };
}
// 札の画像(label = '4' など)。410 のマスを地にして、文字の部分を地の色で消し、数字の字形(410・312 の札から切り出す)を中央に置く
function plateCanvas(P, label) {
  const base = plateCell(P, TPL.room);
  const cv = document.createElement('canvas'); cv.width = base.w; cv.height = base.h;
  const g = cv.getContext('2d', { willReadFrequently: true });
  if (P.uv[label]) { const c = plateCell(P, label); g.drawImage(P.img, c.x, c.y, c.w, c.h, 0, 0, cv.width, cv.height); return cv; }   // 号室そのもの(312)
  g.drawImage(P.img, base.x, base.y, base.w, base.h, 0, 0, base.w, base.h);
  const bg = g.getImageData(8, base.h >> 1, 1, 1).data;
  g.fillStyle = `rgb(${bg[0]},${bg[1]},${bg[2]})`;
  g.fillRect(6, 6, base.w - 12, base.h - 12);
  const glyphs = plateGlyphs(P);
  let x = 0; const parts = [...label].map((ch) => glyphs[ch]).filter(Boolean);
  const tw = parts.reduce((a, q) => a + q.w, 0) + Math.max(0, parts.length - 1) * 3;
  x = Math.round((base.w - tw) / 2);
  for (const q of parts) { g.drawImage(q.cv, x, q.y); x += q.w + 3; }
  return cv;
}
// 数字の字形: 410 と 312 の札の中の明るい画素の列のかたまり(左から順に 1 文字)
function plateGlyphs(P) {
  if (P.glyphs) return P.glyphs;
  const out = {};
  for (const id of ['410', '312']) {
    const c = plateCell(P, id); if (!c) continue;
    const cv = document.createElement('canvas'); cv.width = c.w; cv.height = c.h;
    const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(P.img, c.x, c.y, c.w, c.h, 0, 0, c.w, c.h);
    const D = g.getImageData(0, 0, c.w, c.h).data;
    const lit = (x, y) => { const i = (y * c.w + x) * 4; return D[i] + D[i + 1] + D[i + 2] > 3 * 120; };
    const m = 6, cols = [];
    for (let x = m; x < c.w - m; x++) { let on = false; for (let y = m; y < c.h - m && !on; y++) on = lit(x, y); cols.push(on); }
    const runs = []; let st = -1;
    cols.forEach((on, i) => { if (on && st < 0) st = i; if (!on && st >= 0) { runs.push([st + m, i + m]); st = -1; } });
    if (st >= 0) runs.push([st + m, cols.length + m]);
    if (runs.length !== id.length) continue;
    runs.forEach(([x0, x1], k) => {
      let y0 = c.h, y1 = 0;
      for (let y = m; y < c.h - m; y++) for (let x = x0; x < x1; x++) if (lit(x, y)) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      const pad = 1, gx = Math.max(0, x0 - pad), gw = Math.min(c.w, x1 + pad) - gx, gy = Math.max(0, y0 - pad), gh = Math.min(c.h, y1 + 1 + pad) - gy;
      const gc = document.createElement('canvas'); gc.width = gw; gc.height = gh;
      gc.getContext('2d').drawImage(cv, gx, gy, gw, gh, 0, 0, gw, gh);
      if (!out[id[k]]) out[id[k]] = { cv: gc, w: gw, y: gy };
    });
  }
  return (P.glyphs = out);
}

function geoOf(a) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(a.p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(a.n, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(a.uv, 2));
  g.computeBoundingSphere();
  return g;
}

// ================================================================ 材質(居室と同じテクスチャ＋シェーダの中の天井灯)
const NS = 4;   // シェーダが知る部屋の数(実体 SLOTS ＋ 予備)
function patchLamp(m, U) {
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWP312;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vWP312 = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec4 uLamp[${NS}]; uniform vec4 uRect[${NS}]; uniform vec3 uLampCol;
        varying vec3 vWP312;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec3 nW312 = inverseTransformDirection(nonPerturbedNormal, viewMatrix);
        vec3 Pq = vWP312 + nW312 * 0.03;
        vec4 Lp312 = vec4(0.0); float dw312 = 9.0;
        for (int i = 0; i < ${NS}; i++) { vec4 R = uRect[i]; if (Pq.x > R.x && Pq.x < R.y && Pq.z > R.z && Pq.z < R.w) { Lp312 = uLamp[i]; dw312 = min(min(Pq.x - R.x, R.y - Pq.x), min(Pq.z - R.z, R.w - Pq.z)) - 0.06; } }
        // 天井灯のかさ(点いている時は光る)
        if (Lp312.w > 0.0) { vec3 dq = vWP312 - Lp312.xyz; if (length(dq.xz) < 0.27 && dq.y > -0.09) totalEmissiveRadiance += uLampCol * Lp312.w * 1.6; }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        if (Lp312.w > 0.0) {
          vec3 n = inverseTransformDirection(normal, viewMatrix);
          vec3 d = Lp312.xyz - vWP312; float r2 = dot(d, d); vec3 l = d * inversesqrt(r2);
          float em = 0.28 + 0.72 * clamp(l.y * 1.15, 0.0, 1.0);          // 下向きの乳白のかさ(真下が明るい)
          float nd = max(dot(n, l), 0.0);
          // 遠いほど・低いほど暗い(物陰の代わり)。ベイクの照り返しの代わりの弱い一様光
          float hy = vWP312.y - ${SPACE_Y.toFixed(1)};
          float occ = mix(0.55, 1.0, smoothstep(0.0, 1.2, hy));
          // GTAO の代わりの隅の陰(壁際の床・天井際ほど暗い。別空間は GTAO を切っている)
          occ *= mix(0.62, 1.0, smoothstep(0.0, 0.5, dw312 + min(hy, 2.4 - hy) * 0.5));
          vec3 irr = uLampCol * Lp312.w * (nd * em * 1.25 / (r2 * 0.55 + 0.45) * occ + 0.035 + 0.05 / (r2 * 0.3 + 1.0));
          reflectedLight.indirectDiffuse += diffuseColor.rgb * irr;
          vec3 V = normalize(cameraPosition - vWP312); vec3 hv = normalize(l + V);
          float gl = 1.0 - clamp(roughnessFactor, 0.0, 1.0);
          reflectedLight.indirectSpecular += uLampCol * Lp312.w * pow(max(dot(n, hv), 0.0), mix(6.0, 140.0, gl * gl)) * gl * 0.9 * em / (r2 * 0.4 + 0.6);
        }`);
  };
  m.customProgramCacheKey = () => 'n2_x312_room_v2' + (m.map ? 'm' : '') + (m.normalMap ? 'n' : '') + (m.roughnessMap ? 'r' : '') + (m.envMap ? 'e' : '');
}
function prepareMaterials(ctx, T, U) {
  const man = (ctx.world.manifests && ctx.world.manifests[TPL.level]) || {};
  const defs = man.materials || {};
  const out = new Map();
  for (const [name, src] of T.mats) {
    const m = src.clone();
    const def = defs[name];
    if (def) {
      if (def.map) { m.map = ctx.world.texture(def.map, true); m.color.setRGB(1, 1, 1); }
      if (def.tint) m.color.fromArray(def.tint);
      if (def.roughnessMap) { m.roughnessMap = ctx.world.texture(def.roughnessMap, false); m.roughness = 1; }
      if (def.normalMap) { m.normalMap = ctx.world.texture(def.normalMap, false); const s = def.normalScale ?? 1; m.normalScale.set(s, -s); }
    }
    m.lightMap = null; m.envMapIntensity = 0; m.emissiveMap = null; m.emissive.setRGB(0, 0, 0);
    if (name === 'MR_Mirror' || m.metalness > 0.5) { m.envMap = ctx.world.envTex || null; m.envMapIntensity = name === 'MR_Mirror' ? 0.02 : 0.25; }
    patchLamp(m, U);
    m.needsUpdate = true;
    out.set(name, m);
  }
  return out;
}

// ================================================================ 自前の形(窓の壁・カーテン・布団・床の物・秒針)
class PB {   // 位置・法線・UV の小さな組み立て(UV はパレットの 1 色 or 壁の 1m 張り)
  constructor() { this.p = []; this.n = []; this.uv = []; }
  tri(a, b, c, ua, ub, uc) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    for (const [v, u] of [[a, ua], [b, ub], [c, uc]]) { this.p.push(v.x, v.y, v.z); this.n.push(n.x, n.y, n.z); this.uv.push(u[0], u[1]); }
  }
  quad(a, b, c, d, uv) { this.tri(a, b, c, uv(a), uv(b), uv(c)); this.tri(a, c, d, uv(a), uv(c), uv(d)); }
  box(x0, y0, z0, x1, y1, z1, uv, rotY = 0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2) {
    const V = (x, y, z) => { const dx = x - cx, dz = z - cz, c = Math.cos(rotY), s = Math.sin(rotY); return new THREE.Vector3(cx + dx * c + dz * s, y, cz - dx * s + dz * c); };
    const f = [
      [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], [[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0]],
      [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
      [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]],
    ];
    for (const q of f) this.quad(V(...q[0]), V(...q[1]), V(...q[2]), V(...q[3]), uv);
  }
  // 高さの場(布団・シーツ・服)。at(a, c) → [tu, h, tz](a・c は 0..1)。法線は格子の頂点で平均(なめらか)
  grid(nu, nv, at, uv) {
    const P = []; for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) P.push(new THREE.Vector3(...at(i / nu, j / nv)));
    const N = P.map(() => new THREE.Vector3());
    const id = (i, j) => j * (nu + 1) + i;
    const tris = [];
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) tris.push([id(i, j), id(i, j + 1), id(i + 1, j + 1)], [id(i, j), id(i + 1, j + 1), id(i + 1, j)]);
    for (const [a, b, c] of tris) { const n = new THREE.Vector3().subVectors(P[b], P[a]).cross(new THREE.Vector3().subVectors(P[c], P[a])); N[a].add(n); N[b].add(n); N[c].add(n); }
    for (const n of N) n.normalize();
    for (const t of tris) for (const k of t) { this.p.push(P[k].x, P[k].y, P[k].z); this.n.push(N[k].x, N[k].y, N[k].z); this.uv.push(uv[0], uv[1]); }
  }
  geo() { return geoOf(this); }
}
const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
const vn = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return (hash(xi, yi) * (1 - u) + hash(xi + 1, yi) * u) * (1 - v) + (hash(xi, yi + 1) * (1 - u) + hash(xi + 1, yi + 1) * u) * v; };

// 窓の壁(扉の開口つき)。c = 扉の中心 tz
function windowWallGeo(c) {
  const b = new PB(), x = 5.94, H = 2.4, oh = DR.h, g0 = c - DR.gap, g1 = c + DR.gap;
  const uv = (p) => [p.z, p.y];
  const V = (y, z) => new THREE.Vector3(x, y, z);
  const rect = (z0, z1, y0, y1) => { if (z1 - z0 > 1e-3 && y1 - y0 > 1e-3) b.quad(V(y0, z1), V(y1, z1), V(y1, z0), V(y0, z0), uv); };
  rect(0.06, g0, 0, H); rect(g1, 2.84, 0, H); rect(g0, g1, oh, H);
  return b.geo();
}
function windowBaseGeo(c) {   // 窓の壁の幅木(扉の所は切る)
  const b = new PB(), x = 5.928, g0 = c - DR.gap - 0.04, g1 = c + DR.gap + 0.04;
  const uv = (p) => [p.z * 2, p.y * 2];
  const seg = (z0, z1) => { if (z1 - z0 < 0.01) return; b.box(x, 0, z0, 5.94, 0.06, z1, uv); };
  seg(0.06, g0); seg(g1, 2.84);
  return b.geo();
}
// カーテン(ひだのある帯)。panels = [[tz0, tz1], …]
function curtainGeo(T, panels, key = 'navy') {
  const b = new PB(), uv = T.cell(key);
  for (const [a0, a1] of panels) {
    if (a1 - a0 < 0.05) continue;
    const n = Math.max(2, Math.round((a1 - a0) / 0.07));
    const pts = [];
    for (let i = 0; i <= n; i++) { const z = a0 + (a1 - a0) * i / n; pts.push([5.83 + (i % 2 ? 0.03 : -0.03), z]); }
    for (let i = 0; i < n; i++) {
      const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
      const A = new THREE.Vector3(x0, 0.05, z0), Bv = new THREE.Vector3(x1, 0.05, z1), C = new THREE.Vector3(x1, 2.22, z1), D = new THREE.Vector3(x0, 2.22, z0);
      b.tri(A, Bv, C, uv, uv, uv); b.tri(A, C, D, uv, uv, uv);   // 部屋の側(−tu)が表
    }
  }
  return b.geo();
}
// 乱れた布団(R4〜): シーツの寝ていた跡のくぼみ・枕のくぼみ・めくれて丸まった掛け布団と床へ垂れた端
function messyBedGeo(T, bed) {
  const { tu0, tu1, tz0, tz1 } = bed;
  const sheet = new PB(), duvet = new PB();
  const W = T.cell('white'), BL = T.cell('blue');
  // シーツ(くぼみ: 枕から足もとへ細長く)
  sheet.grid(26, 10, (a, c) => {
    const tu = tu0 + 0.06 + (tu1 - tu0 - 0.1) * a, tz = tz0 + 0.06 + (tz1 - tz0 - 0.1) * c;
    const dent = 0.045 * Math.exp(-(((tu - (tu1 - 0.95)) / 0.62) ** 2) - (((tz - (tz0 + tz1) / 2 + 0.05) / 0.2) ** 2));
    const wr = 0.006 * Math.sin(tu * 23 + tz * 9) * vn(tu * 6, tz * 6);
    return [tu, 0.506 - dent + wr, tz];
  }, W);
  // 枕(頭のくぼみ)
  sheet.grid(10, 8, (a, c) => {
    const tu = tu1 - 0.48 + 0.36 * a, tz = tz0 + 0.2 + 0.56 * c;
    const e = Math.sin(Math.PI * a) * Math.sin(Math.PI * c);
    const dent = 0.05 * Math.exp(-(((a - 0.45) / 0.22) ** 2) - (((c - 0.5) / 0.25) ** 2));
    return [tu, 0.505 + 0.12 * Math.pow(e, 0.6) - dent, tz];
  }, W);
  // 掛け布団: 足もと側に丸まった山・端は垂れる・一角は床へ
  const du0 = tu0 - 0.04, du1 = tu0 + 1.2, dz0 = tz0 - 0.06, dz1 = tz1 + 0.07;
  duvet.grid(22, 16, (a, c) => {
    let tu = du0 + (du1 - du0) * a, tz = dz0 + (dz1 - dz0) * c;
    const edge = Math.min(a, 1 - a, c, 1 - c);
    const mound = 0.13 * Math.exp(-(((a - 0.82) / 0.13) ** 2)) * (0.75 + 0.25 * Math.sin(c * 7.0));
    let h = 0.56 + mound + 0.04 * (vn(tu * 5, tz * 5) - 0.5) + 0.015 * Math.sin(tu * 17 + tz * 4);
    if (edge < 0.06) h = 0.40 + 0.25 * edge / 0.06;
    // 床へ垂れた角(部屋の側・足もと)
    if (c > 0.9 && a < 0.45) { const k = (c - 0.9) / 0.1 * (1 - a / 0.45); h = Math.max(0.02, h - 0.5 * k); tz += 0.18 * k; }
    return [tu, h, tz];
  }, BL);
  return { sheet: sheet.geo(), duvet: duvet.geo() };
}
// 床の本と服(R2〜)
function extrasGeo(T) {
  const b = new PB();
  const books = [['book1', 4.16, 1.98, 0.0, 0.04, 0.2], ['book3', 4.18, 2.0, 0.04, 0.075, -0.15], ['book2', 4.15, 1.97, 0.075, 0.105, 0.35]];
  for (const [k, tu, tz, y0, y1, r] of books) { const c = T.cell(k); b.box(tu, y0, tz, tu + 0.24, y1, tz + 0.17, () => c, r); }
  { const c = T.cell('book4'); b.box(3.72, 0, 2.02, 3.92, 0.035, 2.17, () => c, 0.9); }   // 開いたまま伏せた本
  const g = b.geo();
  const cl = new PB();
  const cloth = (cx, cz, sx, sz, key, rot, seed) => {   // 脱ぎ捨てた服(平たく、縁が不揃いで、しわの筋がある)
    const c = T.cell(key);
    cl.grid(16, 12, (a, q) => {
      const ang = Math.atan2(q - 0.5, a - 0.5), rim = 0.42 + 0.12 * vn(Math.cos(ang) * 2 + seed, Math.sin(ang) * 2);
      const rr = Math.hypot(a - 0.5, q - 0.5) / rim;
      const x = (a - 0.5) * sx, z = (q - 0.5) * sz;
      const fold = 0.014 * Math.abs(Math.sin(a * 9 + q * 3 + seed)) + 0.01 * vn(a * 6 + seed, q * 6);
      const h = rr >= 1 ? 0.002 : 0.004 + (0.03 * (1 - rr * rr) + fold) * (rr < 1 ? 1 : 0);
      const xr = x * Math.cos(rot) - z * Math.sin(rot), zr = x * Math.sin(rot) + z * Math.cos(rot);
      return [cx + xr, h, cz + zr];
    }, c);
  };
  cloth(3.95, 1.24, 0.62, 0.42, 'charcoal', 0.3, 1.7);
  cloth(4.45, 1.2, 0.5, 0.34, 'denim', -0.5, 4.2);
  return { books: g, clothes: cl.geo() };
}
function blankPosterGeo(T) {   // ポスターの図柄が消えた白い紙(同じ大きさの薄い紙。縁の影で壁と見分けられるよう 4mm の厚み)
  const b = new PB(), c = T.cell('cream'), P = T.B.poster;
  b.box(P.tu0, P.h0, P.tz0, P.tu1, P.h1, P.tz0 + 0.004, () => c);
  return b.geo();
}
function handGeo() {   // 時計の秒針(型の局所。中心から上へ)
  const b = new PB(); const c = [0.5, 0.5];
  b.box(-0.003, -0.02, -0.0025, 0.003, 0.115, 0.0025, () => c);
  return b.geo();
}

// ================================================================ build
const SLOT_WALLS = 6;
export function build(ctx) {
  const st = ctx.state;
  st.U = {
    uLamp: { value: Array.from({ length: NS }, () => new THREE.Vector4()) },
    uRect: { value: Array.from({ length: NS }, () => new THREE.Vector4(1e9, -1e9, 1e9, -1e9)) },
    uLampCol: { value: new THREE.Color(1.0, 0.86, 0.66) },
  };
  st.ready = false; st.tplError = null;
  st.slots = []; st.doors = new Map(); st.doorPool = [];
  st.log = [];
  reset(ctx);
  st.tplPromise = loadTemplate(ctx).then((T) => { buildFromTemplate(ctx, T); st.ready = true; if (ctx.group.visible) applyPath(ctx); })
    .catch((e) => { st.tplError = String(e && e.stack || e); console.error('[x312] template', e); });
  ctx.group.visible = false;
}

function buildFromTemplate(ctx, T) {
  const st = ctx.state;
  st.T = T;
  const M = st.M = prepareMaterials(ctx, T, st.U);
  const pal = M.get('MR_Pal');
  const G = st.G = {};
  const mk = (map) => [...map].map(([name, a]) => ({ geo: geoOf(a), mat: M.get(name) }));
  G.static = mk(T.parts.static); G.poster = mk(T.parts.poster); G.curtain = mk(T.parts.curtain); G.bedding = mk(T.parts.bedding);
  G.cup = mk(T.parts.cup);
  G.blank = [{ geo: blankPosterGeo(T), mat: pal }];
  G.leaf = mk(T.door.leaf).filter((q) => q.mat && q.mat.name !== TPL.plateMat); G.frame = mk(T.door.frame);
  G.plate = platePart(ctx, T, M);   // P6b #4: 札は扉ごとに差し替える(410 の札の板の形・UV はマスの中の 0..1 に直す)
  G.closet = T.closet.map((c) => ({ ...c, outerG: mk(c.outer), innerG: mk(c.inner) }));
  const bed = T.B.bed;
  G.messy = messyBedGeo(T, bed);
  G.extras = extrasGeo(T);
  G.hand = handGeo();
  G.cache = new Map();   // 窓の壁・カーテンの形(扉の位置ごと)
  for (let i = 0; i < X312.slots; i++) st.slots.push(makeSlot(ctx, i));
}
function platePart(ctx, T, M) {
  const a = T.door.leaf.get(TPL.plateMat), base = M.get(TPL.plateMat);
  if (!a || !base || !T.plates || !T.plates.uv[TPL.room]) return null;
  const c = T.plates.uv[TPL.room];   // Blender の UV(v 上向き)→ glTF の UV は v = 1 − v
  const uv = [];
  for (let i = 0; i < a.uv.length; i += 2) uv.push((a.uv[i] - c[0]) / (c[2] - c[0]), (a.uv[i + 1] - (1 - c[3])) / (c[3] - c[1]));
  return { geo: geoOf({ p: a.p, n: a.n, uv }), base, mats: new Map() };
}
function plateMat(ctx, label) {
  const P = ctx.state.G.plate;
  if (!P.mats.has(label)) {
    const tex = new THREE.CanvasTexture(plateCanvas(ctx.state.T.plates, label));
    tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const m = P.base.clone(); m.map = tex; m.color.setRGB(1, 1, 1);
    patchLamp(m, ctx.state.U); m.needsUpdate = true;
    P.mats.set(label, m);
  }
  return P.mats.get(label);
}
// 扉の札の文字: 行きは 312(入口)・4・3・2・1・0(奥の開かない扉)。戻り・鍵の後の 1 部屋の奥は札なし(戻りは鏡像なので文字も裏返る)
function plateLabel(st, d) {
  if (d.rec && d.rec.mirror) return null;
  if (d.seam === 0 && d.exit) return '312';
  if (st.phase !== 'fwd') return null;
  if (d.seam >= 1 && d.seam <= X312.fwd) return String(X312.fwd - d.seam);
  return null;
}
function setPlate(ctx, d) {
  if (!d.plate) return;
  const label = plateLabel(ctx.state, d);
  d.plateLabel = label;
  d.plate.visible = !!label;
  if (label) d.plate.material = plateMat(ctx, label);
}
function cached(ctx, key, fn) { const C = ctx.state.G.cache; if (!C.has(key)) C.set(key, fn()); return C.get(key); }

function makeSlot(ctx, i) {
  const st = ctx.state, G = st.G, M = st.M, pal = M.get('MR_Pal');
  const grp = new THREE.Group(); grp.name = 'X312_room' + i; grp.visible = false;
  ctx.group.add(grp);
  const add = (geo, mat, parent = grp) => { const o = new THREE.Mesh(geo, mat); o.receiveShadow = true; o.castShadow = true; parent.add(o); return o; };   // 視錐台で間引く(見えない隣の部屋・影の描画を減らす)
  const s = { i, grp, rec: null };
  s.static = G.static.map((p) => add(p.geo, p.mat));
  s.poster = G.poster.map((p) => add(p.geo, p.mat));
  s.blank = G.blank.map((p) => add(p.geo, p.mat));
  s.curtain = G.curtain.map((p) => add(p.geo, p.mat));
  s.curtainP = add(new THREE.BufferGeometry(), pal);
  s.bedding = G.bedding.map((p) => add(p.geo, p.mat));
  s.messy = [add(G.messy.sheet, pal), add(G.messy.duvet, pal)];
  s.extras = new THREE.Group(); grp.add(s.extras);
  add(G.extras.books, pal, s.extras); add(G.extras.clothes, pal, s.extras);
  for (const p of G.cup) { const o = add(p.geo, p.mat, s.extras); o.position.set(0.56, 0, -0.06); }
  s.wall = add(new THREE.BufferGeometry(), M.get('MR_Wall'));
  s.base = add(new THREE.BufferGeometry(), M.get('MR_Base') || M.get('MR_Wall'));
  s.closet = G.closet.map((c) => {
    const o = new THREE.Group(); o.position.fromArray(c.pivot); grp.add(o);
    for (const p of c.outerG) add(p.geo, p.mat, o);
    const inner = new THREE.Group(); inner.position.fromArray(c.ipivot); o.add(inner);
    for (const p of c.innerG) add(p.geo, p.mat, inner);
    return { o, inner, sign: c.sign };
  });
  // 時計の秒針(時計の面の中心・面の少し手前)
  const ck = st.T.B.clock;
  s.hand = add(G.hand, M.get('MR_PalGloss') || pal);
  s.handBase = [(ck.tu0 + ck.tu1) / 2, (ck.h0 + ck.h1) / 2, ck.tz0 - 0.004];
  s.hand.position.fromArray(s.handBase);
  s.hand.material = handMat(ctx);
  // 当たり(壁 6 枚＋家具)
  s.cols = [];
  const n = SLOT_WALLS + st.T.solids.length;
  for (let k = 0; k < n; k++) { const c = { minX: 0, maxX: 0, minZ: 0, maxZ: 0, y0: SPACE_Y, y1: SPACE_Y + 2.4, kind: k < SLOT_WALLS ? 'wall' : 'furn', roomId: 'X312', disabled: true }; s.cols.push(c); ctx.cols.push(c); }
  return s;
}
function handMat(ctx) {
  const st = ctx.state;
  if (!st.handMat) { st.handMat = new THREE.MeshStandardMaterial({ color: 0x5a0d0b, roughness: 0.5 }); patchLamp(st.handMat, st.U); }
  return st.handMat;
}

// 部屋の実体を rec に合わせる(位置・鏡像・変化・当たり)
function assignSlot(ctx, s, rec) {
  const st = ctx.state;
  s.rec = rec; rec.slot = s.i;
  s.grp.visible = true;
  s.grp.position.set(rec.x0, SPACE_Y, rec.zBase);
  s.grp.scale.set(1, 1, rec.mirror ? -1 : 1);
  s.grp.updateMatrixWorld(true);
  const v = rec.v;
  for (const o of s.poster) o.visible = v.poster === 'orig';
  for (const o of s.blank) o.visible = v.poster !== 'orig';
  for (const o of s.curtain) o.visible = v.curtain === 'orig';
  s.curtainP.visible = v.curtain !== 'orig';
  if (v.curtain !== 'orig') {
    const c = rec.farTz, key = v.curtain + ':' + c.toFixed(2);
    s.curtainP.geometry = cached(ctx, 'cur:' + key, () => curtainGeo(st.T, v.curtain === 'closed' ? [[0.1, c - 0.06], [c + 0.06, 2.28]] : [[0.1, c - 0.48], [c + 0.48, 2.28]]));
  }
  for (const o of s.bedding) o.visible = v.bed === 'orig';
  for (const o of s.messy) o.visible = v.bed !== 'orig';
  s.extras.visible = !!v.extras;
  for (const c of s.closet) { c.o.rotation.y = c.sign * 1.5 * v.closet; c.inner.rotation.y = -c.sign * 2 * 1.5 * v.closet * 0.92; }
  s.wall.geometry = cached(ctx, 'wall:' + rec.farTz.toFixed(2), () => windowWallGeo(rec.farTz));
  s.base.geometry = cached(ctx, 'base:' + rec.farTz.toFixed(2), () => windowBaseGeo(rec.farTz));
  s.handT = 0;
  setSlotCols(ctx, s);
  setSlotLight(ctx, s);
  st.log.push({ t: +st.t.toFixed(2), ev: 'build', room: rec.id, slot: s.i, x0: rec.x0, zBase: +rec.zBase.toFixed(2) });
}
function freeSlot(ctx, s) {
  const st = ctx.state;
  if (s.rec) { st.log.push({ t: +st.t.toFixed(2), ev: 'free', room: s.rec.id, slot: s.i }); s.rec.slot = null; }
  s.rec = null; s.grp.visible = false;
  for (const c of s.cols) c.disabled = true;
  st.U.uRect.value[s.i].set(1e9, -1e9, 1e9, -1e9); st.U.uLamp.value[s.i].set(0, 0, 0, 0);
}
function setSlotLight(ctx, s) {
  const st = ctx.state, rec = s.rec, L = X312.lamp.pos;
  const z0 = wz(rec, 0), z1 = wz(rec, 2.9);
  st.U.uRect.value[s.i].set(rec.x0 - 0.001, rec.x0 + X312.pitch + 0.001, Math.min(z0, z1) - 0.001, Math.max(z0, z1) + 0.001);
  const k = rec.v.lamp * (rec.flicker ?? 1);
  st.U.uLamp.value[s.i].set(wx(rec, L[0]), SPACE_Y + L[1], wz(rec, L[2]), k);
}
// 型の局所の箱 → 世界の当たり
function setBox(c, rec, tu0, tz0, tu1, tz1, h0 = 0, h1 = 2.4) {
  const a = wz(rec, tz0), b = wz(rec, tz1);
  Object.assign(c, { minX: wx(rec, tu0), maxX: wx(rec, tu1), minZ: Math.min(a, b), maxZ: Math.max(a, b), y0: SPACE_Y + h0, y1: SPACE_Y + h1, disabled: false });
}
function setSlotCols(ctx, s) {
  const rec = s.rec, T = ctx.state.T, c = s.cols, f = rec.farTz;
  setBox(c[0], rec, -0.06, -0.06, 6.06, 0.06);            // 側の壁
  setBox(c[1], rec, -0.06, 2.84, 6.06, 2.96);
  setBox(c[2], rec, -0.06, 0.06, 0.06, DR.c - DR.half);    // 玄関の壁(扉の両脇)
  setBox(c[3], rec, -0.06, DR.c + DR.half, 0.06, 2.84);
  setBox(c[4], rec, 5.94, 0.06, 6.06, f - DR.half);         // 窓の壁(扉の両脇)
  setBox(c[5], rec, 5.94, f + DR.half, 6.06, 2.84);
  T.solids.forEach((q, k) => setBox(c[SLOT_WALLS + k], rec, q[0], q[1], q[2], q[3], q[4], q[5]));
}

// ================================================================ 扉(境目ごと。玄関の扉の板＝その部屋の型の位置)
//  door = { key, frameRec(扉の型を置く部屋の枠), locked, exit, angle, target, group, pivot, col }
function doorFrameOf(path, s) {
  // 境目 s = P[s−1] の出口と P[s] の入口の間
  const A = path[s - 1], Bq = path[s];
  if (Bq && Bq.entry === 'genkan') return { rec: Bq, key: 'G:' + Bq.id };
  if (A && A.exit === 'genkan') return { rec: A, key: 'G:' + A.id };
  const R = Bq || A;   // 窓の扉で向こうに部屋が無い(行きの R5 の奥・鍵の後の 1 部屋の奥)= 仮の次の部屋の玄関
  const v = { ...R, x0: R.x0 + X312.pitch, id: R.id + 'v' };
  return { rec: v, key: 'G:' + v.id, virtual: true };
}
function getDoor(ctx, key) {
  const st = ctx.state;
  if (st.doors.has(key)) return st.doors.get(key);
  let d = st.doorPool.find((q) => !q.key);
  if (!d) d = makeDoor(ctx);
  d.key = key; d.angle = 0; d.target = 0; d.group.visible = true;
  st.doors.set(key, d);
  return d;
}
function makeDoor(ctx) {
  const st = ctx.state, G = st.G;
  const group = new THREE.Group(); group.name = 'X312_door'; ctx.group.add(group);
  const add = (geo, mat, parent) => { const o = new THREE.Mesh(geo, mat); o.receiveShadow = true; o.castShadow = true; parent.add(o); return o; };   // 視錐台で間引く(見えない隣の部屋・影の描画を減らす)
  for (const p of G.frame) add(p.geo, p.mat, group);
  const pivot = new THREE.Group(); pivot.position.fromArray(st.T.door.pivot); group.add(pivot);
  for (const p of G.leaf) add(p.geo, p.mat, pivot);
  const plate = G.plate ? add(G.plate.geo, G.plate.base, pivot) : null;
  if (plate) { plate.castShadow = false; plate.visible = false; }
  const col = { minX: 0, maxX: 0, minZ: 0, maxZ: 0, y0: SPACE_Y, y1: SPACE_Y + 2.1, kind: 'door', roomId: 'X312', disabled: true };
  ctx.cols.push(col);
  const d = { key: null, group, pivot, col, angle: 0, target: 0, rec: null, plate, plateLabel: null };
  st.doorPool.push(d);
  return d;
}
function releaseDoor(ctx, d) {
  ctx.state.doors.delete(d.key);
  d.key = null; d.group.visible = false; d.col.disabled = true;
}
function placeDoor(d, info) {
  const rec = info.rec;
  d.rec = rec; d.virtual = !!info.virtual;
  d.group.position.set(rec.x0, SPACE_Y, rec.zBase);
  d.group.scale.set(1, 1, rec.mirror ? -1 : 1);
  d.x = rec.x0; d.z = wz(rec, DR.c);
  setBox(d.col, rec, -0.05, DR.c - DR.half - 0.02, 0.07, DR.c + DR.half + 0.02, 0, 2.1);
  d.col.disabled = Math.abs(d.angle) > 0.25;
}

// ================================================================ 状態
function reset(ctx) {
  const st = ctx.state;
  Object.assign(st, { t: 0, phase: 'fwd', path: [], idx: 0, keyTaken: false, keyBefore: false, mgr: null, mgrIdx: -1, look: 0, sitW: 0,
    maxIdx: 0, mgrLog: [], visited: [], clockSec: 0, rooms: [] });
  st.log = [];
}
function setPath(ctx, path, idx) {
  const st = ctx.state;
  st.path = path; st.idx = idx;
  path.forEach((r, i) => { r.i = i; });
}
export function enter(ctx) {
  const st = ctx.state;
  reset(ctx);
  const s = ctx.story;
  st.keyBefore = !!(s && s.taken && s.taken.has('k105'));
  if (st.keyBefore) { st.phase = 'plain'; setPath(ctx, [plainRec()], 0); }
  else setPath(ctx, Array.from({ length: X312.fwd }, (_, i) => fwdRec(i + 1)), 0);
  st.log.push({ t: 0, ev: 'enter', keyBefore: st.keyBefore });
  if (st.ready) applyPath(ctx, true);
}
// 実体と扉を今の path・idx に合わせる(force = すべて作り直す)
function applyPath(ctx, force = false) {
  const st = ctx.state;
  if (!st.ready) return;
  if (force) {
    for (const s of st.slots) freeSlot(ctx, s);
    for (const d of [...st.doors.values()]) releaseDoor(ctx, d);
  }
  ensureRooms(ctx, true);
}
// 必要な部屋(idx−1, idx, idx+1)を実体にする。余った実体は、つながる扉が閉じてから手放す
function ensureRooms(ctx, instant = false) {
  const st = ctx.state, P = st.path;
  const want = [st.idx, st.idx + 1, st.idx - 1].filter((i) => i >= 0 && i < P.length).map((i) => P[i]);
  // 要らない実体: 扉が閉じていれば手放す。開いていれば閉める
  for (const s of st.slots) {
    if (!s.rec || want.includes(s.rec)) continue;
    const ri = P.indexOf(s.rec);
    const doorsOf = ri < 0 ? [...st.doors.values()].filter((d) => d.owner && d.owner.includes(s.rec)) : [seamDoor(ctx, ri), seamDoor(ctx, ri + 1)].filter(Boolean);
    const open = doorsOf.filter((d) => Math.abs(d.angle) > 0.002);
    if (open.length && !instant) { for (const d of open) { d.target = 0; d.speed = DR.slam * 0.25; } continue; }
    for (const d of open) { d.angle = 0; d.target = 0; d.pivot.rotation.y = 0; }
    freeSlot(ctx, s);
  }
  for (const rec of want) {
    if (rec.slot != null && st.slots[rec.slot].rec === rec) continue;
    const s = st.slots.find((q) => !q.rec);
    if (!s) continue;   // 空きができるまで待つ(後ろの扉が閉まるまで)
    assignSlot(ctx, s, rec);
  }
  // 扉: 実体のある部屋の両側の境目
  const need = new Map();
  for (const s of st.slots) {
    if (!s.rec) continue;
    const ri = P.indexOf(s.rec);
    if (ri < 0) continue;
    for (const sd of [ri, ri + 1]) {
      const info = doorFrameOf(P, sd);
      const prev = need.get(info.key);
      if (prev) { prev.owner.push(s.rec); continue; }
      need.set(info.key, { ...info, seam: sd, owner: [s.rec] });
    }
  }
  for (const d of [...st.doors.values()]) if (!need.has(d.key) && Math.abs(d.angle) < 0.002) releaseDoor(ctx, d);
  for (const [key, info] of need) {
    const d = getDoor(ctx, key);
    d.seam = info.seam; d.owner = info.owner;
    d.exit = (info.seam === 0 && P[0].entry === 'genkan') || (info.seam === P.length && P[P.length - 1].exit === 'genkan');
    d.locked = !d.exit && (info.seam === 0 || info.seam === P.length);
    placeDoor(d, info);
    setPlate(ctx, d);
  }
}
function seamDoor(ctx, sd) {
  const st = ctx.state;
  if (sd < 0 || sd > st.path.length) return null;
  return st.doors.get(doorFrameOf(st.path, sd).key) || null;
}
const curRec = (st) => st.path[st.idx];

// ================================================================ 毎フレーム
export function update(dt, ctx) {
  const st = ctx.state;
  st.t += dt;
  if (ctx.scene.fog) { ctx.scene.fog.color.setHex(X312.fog[0]); ctx.scene.fog.density = X312.fog[1]; }
  if (!st.ready || !st.path.length) return;
  const pl = ctx.player, px = pl.pos.x, pz = pl.pos.z;
  // 今いる部屋(境目から 0.3m 入ったら)
  for (const i of [st.idx - 1, st.idx + 1]) {
    const r = st.path[i]; if (!r) continue;
    const L = toLocal(r, px, pz);
    if (L.tu > X312.enterAt && L.tu < X312.pitch - X312.enterAt && L.tz > -0.2 && L.tz < 3.1) {
      st.log.push({ t: +st.t.toFixed(2), ev: 'room', from: curRec(st).id, to: r.id });
      st.idx = i; st.maxIdx = Math.max(st.maxIdx, i);
      if (!st.visited.includes(r.id)) st.visited.push(r.id);
      break;
    }
  }
  if (!st.visited.includes(curRec(st).id)) st.visited.push(curRec(st).id);
  // 鍵(物語の pickups)を取ったら戻りへ
  const s = ctx.story;
  if (st.phase === 'fwd' && !st.keyBefore && s && s.taken && s.taken.has('k105')) startReturn(ctx);
  ensureRooms(ctx);
  // 扉の開閉
  for (const d of st.doors.values()) {
    if (d.angle !== d.target) {
      const sp = d.speed || DR.speed;
      d.angle += THREE.MathUtils.clamp(d.target - d.angle, -sp * dt, sp * dt);
      if (d.angle === d.target && d.target === 0 && d.closing) { d.closing = false; sfx(ctx, 'close'); }
    }
    d.pivot.rotation.y = d.angle;
    d.col.disabled = Math.abs(d.angle) > 0.25;
  }
  // ②歪み: 戻りの部屋で、通ってきた扉が閉じて見えていない時に、窓際の別の位置へ移す(後ろの部屋ごとずらす)
  if (st.phase === 'ret') shiftCheck(ctx);
  // 時計(R1・R2 は秒針が進む。R3〜 は止まって小刻みに震える)
  st.clockSec += dt;
  for (const sl of st.slots) {
    if (!sl.rec) continue;
    const run = sl.rec.v.clock === 'run';
    const a = run ? -Math.floor(st.clockSec) * Math.PI / 30 : -1.15 + (Math.sin(st.t * 31) > 0.6 ? 0.02 : 0);
    sl.hand.rotation.set(0, 0, a);
    // 戻りの部屋の灯りは時々ちらつく
    if (sl.rec.kind === 'B') { const f = (Math.sin(st.t * 13.1 + sl.rec.n) > 0.97 || Math.sin(st.t * 0.7 + sl.rec.n * 2.1) > 0.995) ? 0.35 : 1; if (f !== sl.rec.flicker) { sl.rec.flicker = f; setSlotLight(ctx, sl); } }
  }
  updateManager(dt, ctx);
  sound(ctx, dt);
}

function startReturn(ctx) {
  const st = ctx.state;
  st.keyTaken = true; st.phase = 'ret';
  const r5 = st.path[st.path.length - 1];
  st.log.push({ t: +st.t.toFixed(2), ev: 'key', room: curRec(st).id });
  // R5 は戻りの 0 番(入口 = 開かない窓の扉、出口 = 玄関の扉)。戻りは 7 部屋
  r5.entry = 'window'; r5.exit = 'genkan';
  const path = [r5, ...Array.from({ length: X312.back }, (_, j) => backRec(j + 1, r5))];
  setPath(ctx, path, 0);
  st.maxIdx = 0;
  // R5 の玄関の扉が開いていたら閉まる(後ろの R4 が戻りの B1 に変わる)
  const d = st.doors.get('G:' + r5.id);
  if (d && Math.abs(d.angle) > 0.002) { d.target = 0; d.speed = DR.slam; d.closing = true; st.log.push({ t: +st.t.toFixed(2), ev: 'slam' }); }
  sfx(ctx, 'key');
}

function inView(ctx, x, y, z, r = 0.6) {
  const cam = ctx.camera;
  cam.updateMatrixWorld();
  const m = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  const f = new THREE.Frustum().setFromProjectionMatrix(m);
  return f.intersectsSphere(new THREE.Sphere(new THREE.Vector3(x, y, z), r));
}
function shiftCheck(ctx) {
  const st = ctx.state, r = curRec(st);
  if (r.kind !== 'B' || r.shifted) return;
  const d = seamDoor(ctx, st.idx);   // 入ってきた扉(窓の扉)
  const prev = st.path[st.idx - 1];
  if (!d || !prev) return;
  const L = toLocal(r, ctx.player.pos.x, ctx.player.pos.z);
  // 通ってきた扉は、離れて見ていない間にひとりでに閉まる
  if (Math.abs(d.target) > 0.05 && L.tu < 5.94 - 2.0 && !inView(ctx, d.x, SPACE_Y + 1.0, d.z, 0.9)) {
    d.target = 0; d.speed = 1.3; d.closing = true; st.log.push({ t: +st.t.toFixed(2), ev: 'auto_close', door: d.key });
  }
  if (Math.abs(d.angle) > 0.002) return;
  if (L.tu > 4.6) return;   // 窓際から離れてから
  const yC = SPACE_Y + 1.1;
  if (inView(ctx, wx(r, 5.94), yC, wz(r, r.farTz), 1.1) || inView(ctx, wx(r, 5.94), yC, wz(r, X312.shiftTz), 1.1)) return;
  // 移す: この部屋の窓の扉の位置と、後ろの部屋(と扉)を同じだけずらす
  const old = wz(r, r.farTz);
  r.farTz = X312.shiftTz; r.shifted = true;
  const now = wz(r, r.farTz), dz = now - old;
  prev.zBase += dz;
  st.log.push({ t: +st.t.toFixed(2), ev: 'shift', room: r.id, dz: +dz.toFixed(2) });
  for (const s of st.slots) if (s.rec === r || s.rec === prev) assignSlot(ctx, s, s.rec);
  const info = doorFrameOf(st.path, st.idx);
  placeDoor(d, info);
  if (st.mgr && st.mgr.rec === prev) placeManager(ctx, prev, st.mgr.spot, true);
}

// ================================================================ 管理人(見ているだけ。SCRIPTED・襲わない)
function mgrSpotKey(rec) { return rec.kind === 'R' ? (rec.n === X312.fwd ? 'R5' : null) : rec.kind === 'B' ? 'B' + rec.n : null; }
function updateManager(dt, ctx) {
  const st = ctx.state, ai = ctx.ai;
  if (!ai || !(ctx.story && ctx.story.aiControl) || st.phase === 'plain') return;
  const P = st.path;
  // 置くべき部屋: 行き = R5(実体がある時)。戻り = mgrIdx(プレイヤーが横を抜けて見ていない時に次の部屋へ)
  if (st.phase === 'fwd') {
    const r5 = P[P.length - 1];
    if (r5.slot != null && (!st.mgr || st.mgr.rec !== r5)) placeManager(ctx, r5, 'R5');
  } else if (st.phase === 'ret') {
    if (st.mgrIdx < 0) st.mgrIdx = 0;
    const cur = P[st.mgrIdx], nxt = P[st.mgrIdx + 1];
    if (st.mgr && st.mgr.rec === cur && nxt && nxt.slot != null && st.idx >= st.mgrIdx) {
      const L = toLocal(cur, ctx.player.pos.x, ctx.player.pos.z);
      const sp = X312.spots[st.mgr.spot];
      const passed = st.idx > st.mgrIdx || L.tu < (st.mgrIdx === 0 ? 3.4 : sp.tu - 0.3);   // 横を抜けた(出口の扉 tu 0 の側へ。R5 は鍵の机の前から動かないよう、廊下に出てから)
      const e = ai.enemy.pos;
      const ns = X312.spots[mgrSpotKey(nxt)];
      const sd = seamDoor(ctx, st.mgrIdx + 1), shut = sd && Math.abs(sd.angle) < 0.002;
      if (passed && !inView(ctx, e.x, e.y + 0.9, e.z, 0.7) && (shut || !inView(ctx, wx(nxt, ns.tu), SPACE_Y + 0.9, wz(nxt, ns.tz), 0.7))) {
        st.mgrIdx++;
        placeManager(ctx, nxt, mgrSpotKey(nxt));
      }
    } else if (!st.mgr || (st.mgr.rec !== cur && cur.slot != null && !inView(ctx, wx(cur, X312.spots[mgrSpotKey(cur)].tu), SPACE_Y + 0.9, wz(cur, X312.spots[mgrSpotKey(cur)].tz), 0.7))) {
      placeManager(ctx, cur, mgrSpotKey(cur));
    }
  }
  if (!st.mgr || ai.level !== ctx.key || ai.state !== 'SCRIPTED') return;
  // 姿勢・向き・顔を上げる
  const e = ai.enemy, pl = ctx.player, cam = ctx.camera, L = X312.look;
  const sp = X312.spots[st.mgr.spot];
  e.speed = 0;
  if (sp.pose === 'stand') {
    const want = Math.atan2(pl.pos.x - e.pos.x, pl.pos.z - e.pos.z);
    let dy = want - e.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    e.yaw += THREE.MathUtils.clamp(dy, -1.2 * dt, 1.2 * dt);
    e.root.rotation.set(0, e.yaw, 0);
  }
  // 懐中電灯が当たっているか(光の円錐の中・届く距離)
  const head = new THREE.Vector3(); e.bones.head.getWorldPosition(head);
  const to = head.clone().sub(cam.position), dist = to.length();
  const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
  const lit = !!pl.flashlightOn && dist < L.range && to.normalize().dot(fwd) > Math.cos(L.cone);
  if (lit && st.look < 0.5 && !st.mgr.raised) { st.mgr.raised = true; st.log.push({ t: +st.t.toFixed(2), ev: 'mgr_look_up', room: st.mgr.rec.id }); sfx(ctx, 'lookup'); }
  if (!lit && st.look < 0.05) st.mgr.raised = false;
  st.look += THREE.MathUtils.clamp((lit ? 1 : 0) - st.look, -L.rate * 0.4 * dt, L.rate * dt);
  poseManager(ctx, sp.pose);
}
function placeManager(ctx, rec, spot, keepLook = false) {
  const st = ctx.state, ai = ctx.ai;
  const sp = X312.spots[spot];
  if (!sp) return;
  ai.uninterruptible = false;
  if (ai.state !== 'SCRIPTED') ai.setState('SCRIPTED', { force: true, log: true });
  if (ai.level !== ctx.key) ai.setLevel(ctx.key);
  ai.dormant = false; ai.concealed = false; ai.transit = false; ai.chaseOmni = false;
  const e = ai.enemy;
  const x = wx(rec, sp.tu), z = wz(rec, sp.tz);
  // 座っている時はベッドの反対側(部屋の中)を向く。立っている時はプレイヤーへ
  const fz = rec.mirror ? -1 : 1;
  const yaw = sp.pose === 'sit' ? Math.atan2(0, fz) : Math.atan2(ctx.player.pos.x - x, ctx.player.pos.z - z);
  e.place(x, z, yaw);
  e.setFlashlight(false);
  // 管理人の体の照明(敵専用ライト): この部屋の天井灯(点いている時)。廊下の常夜灯と同じ扱い
  if (e._lampDefs) { const Lm = e._lampDefs.lamps; Lm.length = 0; if (rec.v.lamp > 0) Lm.push([wx(rec, X312.lamp.pos[0]), wz(rec, X312.lamp.pos[2])], [wx(rec, 3.2), wz(rec, 1.7)], [wx(rec, 1.6), wz(rec, 1.5)]); e._buildLampWorld(); }   // 天井灯＋壁と床の照り返しの代わり
  e.setFace('grin', 0.2, true);
  e.play('look_idle', { fade: 0, timeScale: 1e-6, restart: true });   // 止まった姿勢。0 だとミキサーが骨を書かず、足した回転が積み重なる
  e.speed = 0;
  if (!keepLook) st.look = 0;
  st.mgr = { rec, spot, raised: false };
  const dDoor = Math.hypot(sp.tu - 0, sp.tz - DR.c);
  st.mgrLog.push({ t: +st.t.toFixed(2), room: rec.id, spot, pose: sp.pose, x: +x.toFixed(2), z: +z.toFixed(2), distToGenkanDoor: +dDoor.toFixed(2) });
  ai.log('watch_312', { room: rec.id, spot });
}
// 座る(骨を足す。ミキサーの後 = spaces.update は enemy.update の後)・頭(下を向く ↔ 懐中電灯で顔を上げてこちらを見る)
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _ax = new THREE.Vector3();
function boneRot(b, x, y = 0, z = 0) { if (!b) return; _q.setFromEuler(_e.set(x, y, z)); b.quaternion.multiply(_q); }
function poseManager(ctx, pose) {
  const st = ctx.state, e = ctx.ai.enemy, S = X312.sit, L = X312.look;
  const bone = (n) => (e._bc ||= {})[n] || (e._bc[n] = e.root.getObjectByName('mixamorig' + n));
  if (pose === 'sit') {
    e.root.position.y = e.floorY - S.drop;
    boneRot(bone('LeftUpLeg'), S.thigh, 0, 0); boneRot(bone('RightUpLeg'), S.thigh, 0, 0);
    boneRot(bone('LeftLeg'), S.knee, 0, 0); boneRot(bone('RightLeg'), S.knee, 0, 0);
    boneRot(bone('LeftFoot'), -0.15, 0, 0); boneRot(bone('RightFoot'), -0.15, 0, 0);
    boneRot(bone('Spine'), S.spine, 0, 0);
    boneRot(bone('LeftArm'), 0, 0, S.arm); boneRot(bone('RightArm'), 0, 0, -S.arm);
    boneRot(bone('LeftForeArm'), 0, 0, S.fore); boneRot(bone('RightForeArm'), 0, 0, -S.fore);
  } else e.root.position.y = e.floorY;
  // 頭: 下を向いている(look 0)→ こちらを見る(look 1)
  const h = bone('Head'), nk = bone('Neck');
  if (h) {
    e.root.updateMatrixWorld(true);
    const head = new THREE.Vector3(); h.getWorldPosition(head);
    const to = ctx.camera.position.clone().sub(head);
    const yawTo = Math.atan2(to.x, to.z);
    let dy = yawTo - e.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    dy = THREE.MathUtils.clamp(dy, -1.0, 1.0);
    const pitchTo = Math.atan2(to.y, Math.hypot(to.x, to.z));
    const k = st.look;
    const pitch = THREE.MathUtils.lerp(L.down, -pitchTo * 0.9, k);   // 正 = うつむく
    const yawH = dy * (0.35 + 0.65 * k);
    if (nk) boneRot(nk, pitch * 0.4, yawH * 0.4, 0);
    boneRot(h, pitch * 0.6, yawH * 0.6, 0);
  }
  st.sitW = pose === 'sit' ? 1 : 0;
}

// ================================================================ 物語とのつなぎ
export function exits(ctx) {
  const st = ctx.state, out = [];
  if (!st.ready || !st.path.length) return [{ x: X(DEF.exit[0]), z: Z(DEF.exit[1]), n: [1, 0], auto: true, reach: 1.3, depth: 0.45, half: 0.45, onLeave: () => onLeave(ctx) }];
  for (const d of st.doors.values()) {
    if (!d.exit) continue;
    out.push({ x: d.x + 0.06, z: d.z, n: [1, 0], auto: true, reach: 1.3, depth: 0.45, half: 0.45, onLeave: () => onLeave(ctx) });
  }
  return out;
}
function onLeave(ctx) {
  const st = ctx.state;
  st.log.push({ t: +st.t.toFixed(2), ev: 'leave', room: st.path.length ? curRec(st).id : null });
  if (st.mgr && ctx.ai && ctx.ai.level === ctx.key && ctx.story && ctx.story.onAIReset) ctx.story.onAIReset();
}
export function leave(ctx) {
  const st = ctx.state;
  stopSound(ctx);
  if (st.mgr && ctx.ai && ctx.ai.level === ctx.key) { ctx.ai.concealed = true; ctx.ai.enemy.root.position.y = ctx.ai.enemy.floorY; }
  st.mgr = null;
}
export function dispose(ctx) {
  const st = ctx.state;
  for (const o of [...ctx.group.children]) ctx.group.remove(o);
  if (st.G) { for (const k of ['static', 'poster', 'curtain', 'bedding', 'cup', 'blank', 'leaf', 'frame']) for (const p of st.G[k]) p.geo.dispose(); for (const g of st.G.cache.values()) g.dispose(); }
  if (st.M) for (const m of st.M.values()) m.dispose();
  ctx.cols.length = 0; ctx.lamps.length = 0;
}
// 空間の中の扉(開ける/閉める/開かない)。戻る口(出口の扉)は story の「戻る」
export function target(ctx, look) {
  const st = ctx.state;
  let best = null, bd = 1e9;
  for (const d of st.doors.values()) {
    if (d.exit) continue;
    const dd = look(d.x, d.z, DR.reach);
    if (dd >= 0 && dd < bd) { bd = dd; best = d; }
  }
  if (!best) return null;
  const d = best, open = Math.abs(d.target) > 0.05;
  return { d: bd, door: d.key, items: [open ? { key: 'E', text: '閉める' } : { key: 'E', text: '開ける' }], use: () => useDoor(ctx, d) };
}
function useDoor(ctx, d) {
  const st = ctx.state;
  if (d.locked) {
    if (ctx.hud) ctx.hud.flash('開かない');
    if (ctx.story && ctx.story._sfx) ctx.story._sfx('rattle');
    st.log.push({ t: +st.t.toFixed(2), ev: 'door_locked', door: d.key });
    return 'locked';
  }
  if (Math.abs(d.target) > 0.05) { d.target = 0; d.closing = true; }
  else { d.target = (ctx.player.pos.x < d.x ? 1 : -1) * DR.open; sfx(ctx, 'open'); }   // 向こうへ押して開ける
  d.speed = DR.speed;
  st.log.push({ t: +st.t.toFixed(2), ev: d.target ? 'door_open' : 'door_close', door: d.key });
  return 'door';
}
// 105 の鍵は R5 にいる時だけ拾える。R5 の実体が無い間は見えない所へ
export function canPick(ctx, slot) {
  const st = ctx.state;
  if (slot !== 'key') return true;
  return st.phase === 'fwd' && !!st.path.length && curRec(st).kind === 'R' && curRec(st).n === X312.fwd;
}
export function slotPos(ctx, slot) {
  const st = ctx.state;
  if (slot !== 'key') return null;
  const r5 = st.phase === 'fwd' ? st.path[st.path.length - 1] : null;
  if (!r5 || r5.slot == null) return new THREE.Vector3(X(0), SPACE_Y - 50, Z(0));
  return new THREE.Vector3(wx(r5, X312.key[0]), SPACE_Y + X312.key[1], wz(r5, X312.key[2]));
}

// ================================================================ 仮音(P4b で録音に差し替え。名前は docs/p5b4/NOTES.md)
//  x312_room_tone_loop_01: 部屋の空気(冷蔵庫の低いうなり)/ x312_clock_tick_01: 時計の秒(R1・R2 だけ)/ x312_door_open_01・x312_door_close_01: 奥の扉 /
//  x312_key_slam_01: 鍵を取ると玄関の扉が閉まる / x312_watcher_lookup_01: 管理人が顔を上げる
function sound(ctx, dt) {
  const st = ctx.state, c = actx(ctx); if (!c) return;
  if (!st.amb) {
    const out = ctx.audio.listener.getInput();
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 50;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 140;
    const g = c.createGain(); g.gain.value = 0; o.connect(lp); lp.connect(g); g.connect(out); o.start();
    st.amb = { o, g, tick: 0 };
  }
  const r = curRec(st);
  const want = r && r.v.lamp > 0 ? 0.018 : 0.007;
  st.amb.g.gain.value += (want - st.amb.g.gain.value) * Math.min(1, dt * 2);
  if (r && r.v.clock === 'run') {
    const sec = Math.floor(st.clockSec);
    if (sec !== st.amb.tick) { st.amb.tick = sec; burst(ctx, 0.025, 3200, 4, 0.025); }
  }
}
function stopSound(ctx) { const st = ctx.state; if (!st.amb) return; try { st.amb.o.stop(); } catch (e) { void e; } st.amb = null; }
// P6b #4(2026-11-03 ユーザー「312 の変な効果音」): 合成の効果音 open/close/key/lookup は鳴らさない。ログ(st.sfx)だけ残す。
//  鳴らした回数 st.sfxPlayed は 0 のまま(テストが見る。録音の音を足す時はここで bank を鳴らして数える)
function sfx(ctx, name) {
  const st = ctx.state; st.sfx = st.sfx || []; st.sfx.push(name); if (st.sfx.length > 60) st.sfx.shift();
  st.sfxPlayed = st.sfxPlayed || 0;
}

// ================================================================ テスト・スクショ用
export function debug(ctx) {
  const st = ctx.state;
  const roomInfo = (r) => r && ({ id: r.id, kind: r.kind, n: r.n, mirror: r.mirror, x0: r.x0, zBase: +r.zBase.toFixed(2), farTz: r.farTz, slot: r.slot, ...r.v });
  return {
    X312, st,
    ready: () => st.ready, error: () => st.tplError,
    state: () => ({
      ready: st.ready, phase: st.phase, idx: st.idx, sfx: (st.sfx || []).slice(), sfxPlayed: st.sfxPlayed || 0, room: roomInfo(curRec(st)), pathLen: st.path.length, maxIdx: st.maxIdx, visited: [...st.visited], keyTaken: st.keyTaken,
      slots: st.slots.map((s) => s.rec && s.rec.id), doors: [...st.doors.values()].map((d) => ({ key: d.key, seam: d.seam, x: +d.x.toFixed(2), z: +d.z.toFixed(2), angle: +d.angle.toFixed(2), locked: !!d.locked, exit: !!d.exit, plate: d.plate && d.plate.visible ? d.plateLabel : null })),
      mgr: st.mgr && { room: st.mgr.rec.id, spot: st.mgr.spot, pose: X312.spots[st.mgr.spot].pose, look: +st.look.toFixed(2) }, mgrLog: st.mgrLog.slice(), log: st.log.slice(-40),
    }),
    rooms: () => st.path.map(roomInfo),
    // 部屋 i へ移す(型の局所 tu, tz。テスト・スクショ・性能の計測用)。戻りでは管理人もその部屋の位置へ
    jump: (i, tu = 2.0, tz = DR.c, yaw = null) => {
      st.idx = i; st.maxIdx = Math.max(st.maxIdx, i);
      for (let k = 0; k <= i; k++) if (!st.visited.includes(st.path[k].id)) st.visited.push(st.path[k].id);
      applyPath(ctx, true);
      const r = st.path[i];
      const x = wx(r, tu), z = wz(r, tz);
      ctx.player.setPose(x, z, yaw ?? (r.entry === 'genkan' ? -Math.PI / 2 : Math.PI / 2), 0);
      if (st.phase === 'ret') { st.mgrIdx = i; st.mgr = null; }
      return { x, z };
    },
    cols: (i) => { const r = st.path[i]; return r && r.slot != null ? st.slots[r.slot].cols.map((c) => ({ ...c })) : null; },
    solids: () => st.T && st.T.solids,
    door: (seam) => seamDoor(ctx, seam),
    world: (rec, tu, tz) => ({ x: wx(rec, tu), z: wz(rec, tz) }),
    roomAt: (i) => st.path[i],
    cur: () => curRec(st),
    local: (x, z) => toLocal(curRec(st), x, z),
    // 部屋の中の物の数(見た目の変化の確認): 表示中の部品
    look: (i) => { const r = st.path[i]; const s = r && r.slot != null ? st.slots[r.slot] : null; if (!s) return null;
      return { extras: s.extras.visible, posterOrig: s.poster.some((o) => o.visible), blank: s.blank.some((o) => o.visible), curtainOrig: s.curtain.some((o) => o.visible), curtainProc: s.curtainP.visible,
        bedOrig: s.bedding.some((o) => o.visible), messy: s.messy.some((o) => o.visible), closet: +s.closet[0].o.rotation.y.toFixed(2), lamp: +st.U.uLamp.value[s.i].w.toFixed(2), hand: +s.hand.rotation.z.toFixed(3),
        meshes: (() => { let n = 0; s.grp.traverseVisible((o) => { if (o.isMesh) n++; }); return n; })() }; },
  };
}
