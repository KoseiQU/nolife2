// power.js — P6b-F1(DESIGN §3.12 #4・#1): 建物の灯りの一斉制御(停電・消え掛かり・タイトルのちらつき)。
//  灯りの描かれ方(docs/p6b-f1/NOTES.md §1 の実測): 階の見た目は「ベイク済みライトマップ(常夜灯・ダウンライト・壁付け灯・窓の空の光が 1 枚に焼き込み済み)」
//  ＋「発光面(灯具のカバー M_LampCover・M_Downlight・M_BracketCover・非常口 M_ExitSignSq…)」＋「環境光の床(半球光 0.12 = 月明かり)」＋懐中電灯。
//  階の GLB は材質ごとに 1 つのメッシュへ結合されている(world._merge)ので、灯具 1 灯だけを材質の値で消すことはできない。
//  → 一斉に落とす最小の手段: 階の材質の シェーダに 1 か所だけ掛け算を足す(onBeforeCompile。プログラムは全材質で共通 = 再コンパイルは読み込み時の 1 回だけ)。
//     ・ライトマップの寄与: lights_fragment_begin〜end の間で irradiance に加わった分(= ライトマップ)だけに uN2Lm[階] を掛ける(環境光・懐中電灯はそのまま)。
//       金属・ガラスの映り込み(共通の環境マップ)も同じ区間で max(倍率, 0.2) を掛ける(真っ暗な中でノブだけ光らないように)
//     ・発光面: totalEmissiveRadiance に uN2Em[階] を掛ける(窓の空・EV の表示/ボタン/カゴの天井・玄関の外の街路は掛けない = KEEP)
//     ・階はワールドの高さから決める(uniform の配列 8 個 = B1・1F〜7F。屋上B は 7F)。値は JS で毎フレーム書くだけ(uniform は全材質で共有)
//     ・1 灯のちらつき: 位置 uN2Dim(xyz・強さ w)からの距離で、ライトマップ(半径 4m)と発光面(半径 0.9m)を局所的に落とす
//  管理人だけに効く光(enemy.js の常夜灯・非常口の光)と外観の灯り(カーテン越しの窓・外から見える廊下の常夜灯・ロビー)も同じ倍率で落とす。
//  時計は 1 つ(階に依存しない)。main が step の中で update(dt) を呼ぶ。タイトルは manual で直接値を入れる(時計は進めない)。

import * as THREE from 'three';
import { GEOM } from './walls.js';

export const POWER = {
  flicker: { every: [60, 180], dur: [2, 4], radiusLm: 4.0, radiusEm: 0.9 },
  blackout: { every: [240, 480], dur: [45, 75], lm: 0.03, ambient: 0.5, stutter: 0.42, stagger: 0.3 },   // ambient = 環境光の床(月明かりの下限)の倍率
  postpone: 10,          // 起こせない時(異空間・死亡演出など)は、この秒数だけ後で試し直す
  scanEvery: 2.0,        // 後から足される材質(怖い扉の血のデカール)を探す間隔
  // 消さない発光面: 窓(夜空)・EV の表示/ボタン/カゴの天井(EV は動く)・正面玄関の外の暗い街路
  keep: new Set(['M_Window', 'MX_WinOut', 'M_WireGlassOut', 'M_EVDisplay', 'M_EVCarDisplay', 'M_Button', 'M_CarCeiling', 'M_Backdrop', 'MX_CorrGlass', 'MX_WinGlass']),
  // 消え掛かりの対象(天井の常夜灯・ダウンライト)
  lampMats: new Set(['M_LampCover', 'M_Downlight']),
  // 外観で落とす灯り(カーテン越しの窓・外から見える廊下の常夜灯と奥の明るい廊下・ロビーの明かり・壁付け灯)
  extOff: new Set(['XE_WinGlow', 'XE_CorrLamp', 'XE_CorrDepthLit', 'XE_LobbyGlow', 'M_LampCover', 'M_Downlight', 'M_BracketCover', 'M_ExitSignSq']),
};
// 戻る時の点滅(各階、点き始めからの秒: [始め, 終わり] の間は点く)。この後は点いたまま
const BLINK_BACK = [[0.0, 0.07], [0.16, 0.22], [0.4, 9e9]];
const BLINK_DUR = 0.4;
// 消える時のつっかえ(全階同時。[始め, 終わり] の間はまだ点いている)
const STUTTER = [[0.0, 0.06], [0.11, 0.16], [0.27, 0.3]];

// ---------------------------------------------------------------- シェーダの差し込み(全材質で共有する uniform)
export const POWER_U = {
  uN2Lm: { value: new Array(8).fill(1) },
  uN2Em: { value: new Array(8).fill(1) },
  uN2Dim: { value: new THREE.Vector4(0, -1e4, 0, 0) },
  uN2DimR: { value: new THREE.Vector2(POWER.flicker.radiusLm, POWER.flicker.radiusEm) },
};
const FH = GEOM.FLOOR_H;
const COMMON = `
uniform float uN2Lm[8]; uniform float uN2Em[8]; uniform vec4 uN2Dim; uniform vec2 uN2DimR;
varying vec3 vN2W;
int n2Floor() { return int(clamp(floor((vN2W.y + 0.3) / ${FH.toFixed(4)}) + 1.0, 0.0, 7.0)); }
float n2Near(float r) { float d = distance(vN2W, uN2Dim.xyz); return uN2Dim.w * (1.0 - smoothstep(r * 0.45, r, d)); }
float n2LmGain() { return uN2Lm[n2Floor()] * (1.0 - 0.92 * n2Near(uN2DimR.x)); }
float n2EmGain() { return uN2Em[n2Floor()] * (1.0 - n2Near(uN2DimR.y)); }
float n2EnvGain() { return max(uN2Lm[n2Floor()], 0.2) * (1.0 - 0.8 * n2Near(uN2DimR.x)); }
`;

// 材質に onBeforeCompile の差し込みを足す(既存の差し込みは前に残す。プログラムのキーは差し込みの並びから作る)
export function addPatch(m, key, fn) {
  const P = m.userData.n2Patches || (m.userData.n2Patches = []);
  if (P.some((p) => p.key === key)) return;
  if (!P.length && m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) {
    const prev = m.onBeforeCompile;
    const pk = m.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey ? m.customProgramCacheKey() : prev.toString();
    P.push({ key: 'pre:' + pk, fn: prev });
  }
  P.push({ key, fn });
  m.onBeforeCompile = (sh, r) => { for (const p of P) p.fn.call(m, sh, r); };
  m.customProgramCacheKey = () => P.map((p) => p.key).join('|');
  m.needsUpdate = true;
}

// 灯りの倍率を材質に差し込む。keep = 発光面は消さない(ライトマップの倍率だけ)
export function powerPatch(m, keep = POWER.keep.has(m.name)) {
  if (!m || !m.isMeshStandardMaterial || m.userData.n2Power) return false;
  const emis = !keep && ((m.emissive && m.emissive.r + m.emissive.g + m.emissive.b > 0) || !!m.emissiveMap);
  if (!m.lightMap && !emis && !/Blood/.test(m.name)) return false;
  m.userData.n2Power = keep ? 'keep' : 'all';
  addPatch(m, emis ? 'n2pw' : 'n2pwk', (sh) => {
    Object.assign(sh.uniforms, POWER_U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vN2W;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvN2W = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    let fs = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + COMMON)
      .replace('#include <lights_fragment_begin>', '#include <lights_fragment_begin>\nvec3 n2IrrPre = irradiance;\n#if defined( RE_IndirectSpecular )\nvec3 n2RadPre = radiance;\n#endif')
      .replace('#include <lights_fragment_end>', 'irradiance = n2IrrPre + (irradiance - n2IrrPre) * n2LmGain();\n#if defined( RE_IndirectSpecular )\nradiance = n2RadPre + (radiance - n2RadPre) * n2EnvGain();\n#endif\n#include <lights_fragment_end>');
    if (emis) fs = fs.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= n2EmGain();');
    sh.fragmentShader = fs;
  });
  return true;
}

// 発光体の位置(結合済みメッシュの頂点を 0.7m の格子でまとめた中心)。消え掛かりの対象と、テストの「変わった発光体の数」
export function emitterCenters(root, names = POWER.lampMats) {
  const out = [];
  root.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh || !names.has(o.material.name)) return;
    const p = o.geometry.attributes.position, cells = new Map();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
      let c = null;
      for (const q of cells.values()) if (Math.abs(q.s[0] / q.n - v.x) < 0.7 && Math.abs(q.s[2] / q.n - v.z) < 0.7 && Math.abs(q.s[1] / q.n - v.y) < 0.7) { c = q; break; }
      if (!c) { c = { s: [0, 0, 0], n: 0 }; cells.set(cells.size, c); }
      c.s[0] += v.x; c.s[1] += v.y; c.s[2] += v.z; c.n++;
    }
    for (const c of cells.values()) out.push({ x: c.s[0] / c.n, y: c.s[1] / c.n, z: c.s[2] / c.n, mat: o.material.name });
  });
  return out;
}

function mulberry(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const inSpans = (S, t) => S.some(([a, b]) => t >= a && t < b);
// 階キー → 配列の番号(0 = 地下 B1・1〜7 = 1F〜7F。屋上B = 7・敷地 = 1)
export const floorIndex = (k) => (typeof k === 'number' ? k : k === 'RB' ? 7 : k === 'B1' ? 0 : k === 'G' ? 1 : -1);

export class Power {
  // ctx: { world, exterior, enemy, ai, player, ambient(半球光), ambientBase, getLevel(), excluded() → 理由の文字列 | null(起こしてよい), hard() → 進行中の停電も打ち切る理由 | null, enabled, seed }
  constructor(ctx) {
    Object.assign(this, ctx);
    this.rand = mulberry(ctx.seed ?? ((Date.now() & 0xffff) + 17));
    this.t = 0;
    this.flick = null;      // { t, dur, spans:[[a,b,amt]], pos, floor }
    this.out = null;        // { t, dur }
    this.manual = null;     // タイトル: { lm:[8], em:[8], dim:[x,y,z,amt], enemyLamp }
    this.log = [];
    this.nextFlicker = this._roll(POWER.flicker.every);
    this.nextBlackout = this._roll(POWER.blackout.every);
    this._scanT = 0;
    this._ext = null;       // 外観の落とす材質 [{ m, base }]
    this._lm = new Array(8).fill(1); this._em = new Array(8).fill(1);
    this._dim = [0, -1e4, 0, 0];
  }

  _roll([a, b]) { return this.t + a + (b - a) * this.rand(); }
  _push(ev, extra = {}) { this.log.push({ t: +this.t.toFixed(2), ev, ...extra }); if (this.log.length > 200) this.log.shift(); }

  // ------------------------------------------------------------ 毎フレーム(main の step。タイトルの間は呼ばれない)
  update(dt) {
    this.t += dt;
    if ((this._scanT -= dt) <= 0) { this._scanT = POWER.scanEvery; this.scan(); }
    const hard = this.hard ? this.hard() : null;
    if (hard && (this.out || this.flick)) { this._push('cancel', { why: hard }); this.out = null; this.flick = null; }
    if (this.enabled && !hard) {
      const ex = this.excluded ? this.excluded() : null;
      if (this.t >= this.nextBlackout) {
        if (ex || this.out) { this.nextBlackout = this.t + POWER.postpone; this._push('postpone', { kind: 'blackout', why: ex || 'busy' }); }
        else this.startBlackout();
      }
      if (this.t >= this.nextFlicker) {
        if (ex || this.out || this.flick) { this.nextFlicker = this.t + POWER.postpone; this._push('postpone', { kind: 'flicker', why: ex || 'busy' }); }
        else this.startFlicker();
      }
    }
    if (this.out) { this.out.t += dt; if (this.out.t >= this.out.dur) { this._push('blackout_end', { dur: +this.out.dur.toFixed(2) }); this.out = null; } }
    if (this.flick) { this.flick.t += dt; if (this.flick.t >= this.flick.dur) { this._push('flicker_end'); this.flick = null; } }
    this.apply();
  }

  // ------------------------------------------------------------ 起こす(テスト・デバッグからも)
  startBlackout(dur = null) {
    const B = POWER.blackout;
    this.flick = null;
    this.out = { t: 0, dur: dur ?? B.dur[0] + (B.dur[1] - B.dur[0]) * this.rand() };
    this.nextBlackout = this._roll(B.every) + this.out.dur;   // 次は戻ってから 4〜8 分
    this._push('blackout', { dur: +this.out.dur.toFixed(2), level: this.getLevel() });
    return this.out.dur;
  }
  // 消え掛かり: プレイヤーの階の天井灯のうち、プレイヤーに一番近い 1 灯
  startFlicker(dur = null) {
    const F = POWER.flicker, lv = this.getLevel(), fi = floorIndex(lv);
    this.nextFlicker = this._roll(F.every);
    if (fi < 1) { this._push('flicker_skip', { why: 'level' }); return null; }
    const glb = fi === 0 ? 1 : fi;
    const em = this.emitters(glb);
    const p = this.player.pos;
    let best = null, bd = 1e9;
    for (const e of em) { const d = Math.hypot(e.x - p.x, e.z - p.z); if (d < bd) { bd = d; best = e; } }
    if (!best) { this._push('flicker_skip', { why: 'none' }); return null; }
    const d0 = dur ?? F.dur[0] + (F.dur[1] - F.dur[0]) * this.rand();
    // 明滅の列: 消える(深さ 0.75〜1)/戻る を短く繰り返し、途中で一度長めに暗くなって、最後は点いて終わる
    const spans = []; let t = 0.05 + 0.1 * this.rand();
    while (t < d0 - 0.25) {
      const off = 0.04 + (this.rand() < 0.25 ? 0.25 + 0.35 * this.rand() : 0.14 * this.rand());
      spans.push([t, Math.min(d0 - 0.2, t + off), 0.75 + 0.25 * this.rand()]);
      t += off + 0.04 + 0.22 * this.rand();
    }
    this.flick = { t: 0, dur: d0, spans, pos: [best.x, best.y, best.z], floor: glb, dist: +bd.toFixed(2) };
    this._push('flicker', { dur: +d0.toFixed(2), at: [+best.x.toFixed(2), +best.z.toFixed(2)], floor: glb, dist: +bd.toFixed(2) });
    return this.flick;
  }
  stop() { this.out = null; this.flick = null; this.apply(); }

  emitters(glb) {
    const rec = this.world.floors.get(glb);
    if (!rec || rec.state !== 'ready' || !rec.group) return [];
    if (!rec.emitters) rec.emitters = emitterCenters(rec.group);
    return rec.emitters;
  }

  // ------------------------------------------------------------ 今の倍率(階ごと)
  // 停電の時刻 τ・階 k(1..7)の点き具合(0 = 消えている、1 = 点いている)
  _onAt(k) {
    const o = this.out;
    if (!o) return 1;
    const B = POWER.blackout, tau = o.t;
    if (tau < B.stutter) return inSpans(STUTTER, tau) ? 1 : 0;
    const back0 = o.dur - (B.stagger * 6 + BLINK_DUR);
    const s = tau - (back0 + B.stagger * (Math.max(1, k) - 1));
    if (s < 0) return 0;
    return inSpans(BLINK_BACK, s) ? 1 : 0;
  }
  apply() {
    const lm = this._lm, em = this._em, B = POWER.blackout;
    let dim = this._dim;
    if (this.manual) {
      const M = this.manual;
      for (let i = 0; i < 8; i++) { lm[i] = M.lm ? M.lm[i] : 1; em[i] = M.em ? M.em[i] : 1; }
      dim = M.dim || [0, -1e4, 0, 0];
    } else {
      for (let i = 1; i < 8; i++) { const on = this._onAt(i); lm[i] = B.lm + (1 - B.lm) * on; em[i] = on; }
      lm[0] = lm[1]; em[0] = em[1];
      const f = this.flick;
      if (f) {
        const amt = f.spans.reduce((a, [s0, s1, k]) => (f.t >= s0 && f.t < s1 ? Math.max(a, k) : a), 0);
        dim = [f.pos[0], f.pos[1], f.pos[2], amt];
      } else dim = [0, -1e4, 0, 0];
    }
    this._dim = dim;
    // 環境光の床(半球光): 停電中はプレイヤーの階の点き具合で落とす(異空間・タイトルでは触らない)。変わった時だけ書く(チュートリアルの持ち上げを壊さない)
    if (this.ambient && this.ambientBase !== undefined) {
      const fi = floorIndex(this.getLevel());
      const k = this.manual || fi < 0 ? null : B.ambient + (1 - B.ambient) * this._onAt(fi === 0 ? 1 : fi);
      if (k !== null && k !== this._ambK) { this.ambient.intensity = this.ambientBase * k; this._ambK = k; }
    }
    const U = POWER_U;
    for (let i = 0; i < 8; i++) { U.uN2Lm.value[i] = lm[i]; U.uN2Em.value[i] = em[i]; }
    U.uN2Dim.value.set(dim[0], dim[1], dim[2], dim[3]);
    this._applyEnemy();
    this._applyExterior();
  }

  // 管理人だけに効く光: 常夜灯・非常口・(窓は残す)。ちらついている 1 灯は同じ割合で落とす
  _applyEnemy() {
    const e = this.enemy, ai = this.ai;
    if (!e || !e._lampAll) return;
    const fi = ai ? floorIndex(ai.level) : -1;
    const g = fi >= 0 ? this._em[fi] : 1;
    const m = this.manual && this.manual.enemyLamp !== undefined ? this.manual.enemyLamp : null;
    const d = this._dim;
    for (const l of e._lampAll) {
      if (!l._c0) { l._c0 = l.c.clone(); l._kind = l.c.b > l.c.r && l.c.b > l.c.g ? 'window' : 'lamp'; }   // 窓の光は青白い(常夜灯は暖色・非常口は緑 = どちらも消す)
      if (l._kind === 'window') continue;
      let k = m !== null ? m : g;   // タイトルは manual の値そのもの(消えている間も輪郭が僅かに残る値を入れる)
      if (d[3] > 0) { const dd = Math.hypot(l.p.x - d[0], l.p.y - d[1], l.p.z - d[2]); if (dd < 1.2) k *= 1 - d[3]; }
      l.c.copy(l._c0).multiplyScalar(k);
    }
  }

  // 外観(build/exterior.glb)の灯り: 全階の平均で落とす(外から見た建物の窓・廊下・ロビー)
  _applyExterior() {
    const X = this.exterior;
    if (!X || !X.ready) return;
    if (!this._ext) {
      this._ext = [];
      const seen = new Set();
      X.root.traverse((o) => {
        if (!o.isMesh) return;
        for (const m of [].concat(o.material)) if (POWER.extOff.has(m.name) && !seen.has(m)) { seen.add(m); this._ext.push({ m, base: m.emissiveIntensity }); }
      });
    }
    let s = 0; for (let i = 1; i < 8; i++) s += this._em[i];
    const g = s / 7;
    if (g === this._extG) return;
    this._extG = g;
    for (const x of this._ext) x.m.emissiveIntensity = x.base * g;
  }

  // 読み込み済みの階の材質に差し込む(怖い扉の血のデカールは後から足されるので定期的に探す)
  scan() {
    let n = 0;
    for (const rec of this.world.floors.values()) {
      if (rec.state !== 'ready' || !rec.group) continue;
      rec.group.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) if (!m.userData.n2Power && /Blood/.test(m.name) && powerPatch(m)) n++; });
    }
    return n;
  }

  // 階キーの今の発光の倍率(0..1)
  emAt(k) { const i = floorIndex(k); return i >= 0 ? this._em[i] : 1; }
  lmAt(k) { const i = floorIndex(k); return i >= 0 ? this._lm[i] : 1; }

  // ------------------------------------------------------------ 状態(テスト・デバッグ)
  // 階 glb の発光体ごとの、今の発光の倍率(CPU で同じ式)
  emitterFactors(glb) {
    const fi = glb, d = this._dim, R = POWER.flicker.radiusEm;
    return this.emitters(glb).map((e) => {
      const dd = Math.hypot(e.x - d[0], e.y - d[1], e.z - d[2]);
      const near = d[3] * (1 - THREE.MathUtils.smoothstep(dd, R * 0.45, R));
      return { x: +e.x.toFixed(2), z: +e.z.toFixed(2), mat: e.mat, k: +(this._em[fi] * (1 - near)).toFixed(3) };
    });
  }
  state() {
    return { t: +this.t.toFixed(2), enabled: !!this.enabled, manual: !!this.manual,
      blackout: this.out ? { t: +this.out.t.toFixed(2), dur: +this.out.dur.toFixed(2) } : null,
      flicker: this.flick ? { t: +this.flick.t.toFixed(2), dur: +this.flick.dur.toFixed(2), at: this.flick.pos.map((v) => +v.toFixed(2)), floor: this.flick.floor } : null,
      nextBlackout: +(this.nextBlackout - this.t).toFixed(1), nextFlicker: +(this.nextFlicker - this.t).toFixed(1),
      lm: this._lm.map((v) => +v.toFixed(3)), em: this._em.map((v) => +v.toFixed(3)), dim: this._dim.map((v) => +(+v).toFixed(2)) };
  }
}
