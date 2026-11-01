// watcher.js — P5a: 窓越しの管理人(DESIGN §3.8 F)。
//  ときどき、廊下端の窓(P3c-2 で透明化)や入れる部屋の掃き出し窓の外に、駐車場・敷地に立ってこちらを見上げる管理人が見える。
//  襲ってこない「見えるだけ」の演出体(本体とは別のメッシュのインスタンス。AI も当たりも持たない)。本体が別の階にいる時だけ。
//  - 出る: 監督役が「緊張」でなく、管理人が追跡・警戒していない時、10 分に 1〜2 回。プレイヤーが窓の室内側の近く(廊下端の窓 10m・部屋の中)にいて、
//          窓から外の立ち位置が見通せ(レイキャスト。窓ガラス以外に遮るものがない)、立ち位置がまだ視野に入っていない時に置く(目の前に湧かない)
//  - 消える: 3 秒以上見続ける/見た後に視線を外す(視野から外れたら、戻した時にはもういない)/見られないまま 60 秒/窓から離れた
// 立ち位置の明るさは、本体と同じシェーダ注入の光(enemy.js patchEnemyMaterial)を自前の uniform で持つ(近くの照明柱・建物の窓明かり)。

import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { levelY, FACING_N } from './world.js';
import { patchEnemyMaterial, makeEnemyLightUniforms, MAX_LAMPS } from './enemy.js';

export const WATCHER = {
  every: [300, 600],        // 出現の間隔(秒)＝10 分に 1〜2 回
  first: [240, 420],        // 開始から最初の出現まで
  retry: 20,                // 条件が合わず置けなかった時、次に試すまで
  checkEvery: 0.5,
  seeTime: 3.0,             // 見続けたら消える
  minSeen: 0.25,            // これだけ見たら「見た」(以後、視線を外すと消える)
  timeout: 60,              // 見られないままこれだけ経ったら消える
  dist: [7, 45],            // 窓から立ち位置(頭)までの距離
  outDot: 0.35,             // 窓の外向きと立ち位置の方向(水平)の内積の下限
  corrWinDist: 10,          // 廊下端の窓からこの距離まで(室内側)
  eyeBack: 0.35,            // 見通しの判定に使う目の位置(窓の室内側)
  ndc: 0.85,                // 画面の中央この範囲に頭が入っていれば「見ている」
  lookUpMax: 0.55,          // 首を反らせて見上げる角度の上限(rad)
  lamp: { color: 0xffcf98, intensity: 5.0, range: 8.0, height: 3.6 },   // 立ち位置を照らす光(近くの照明柱。無ければ建物側の窓明かり)
  hemi: { sky: 0x1a2232, ground: 0x0c0a08, intensity: 0.03 },
};

// 外の立ち位置(敷地 'G' の地面 y=0)。building.site の歩ける矩形の中・照明柱の近く
export const WATCH_SPOTS = [
  { id: 'park_n', x: 32.6, y: 0, z: 8.4 },         // 駐車場(照明柱 0 の灯りの溜まり)
  { id: 'park_stall', x: 34.0, y: 0, z: 5.8 },     // 駐車場の空いた区画に立つ
  { id: 'park_far', x: 34.2, y: 0, z: 10.9 },      // 駐車場の北の空き区画
  { id: 'east_fence', x: 36.6, y: 0, z: 21.0 },    // 東の柵の手前
  { id: 'east_fence_n', x: 37.0, y: 0, z: 15.2 },  // 東の柵の手前(北寄り)
  { id: 'east_fence_s', x: 37.0, y: 0, z: 27.4 },  // 東の柵の手前(南寄り)
  { id: 'east_yard', x: 31.4, y: 0, z: 19.8 },     // 東の通路(照明柱 1)
  { id: 'east_pool', x: 34.9, y: 0, z: 19.2 },     // 照明柱 1 の灯りの溜まりの東の縁(上の階の廊下端の窓から見下ろせる)
  { id: 'east_pool_s', x: 35.1, y: 0, z: 23.8 },   // 同じく南寄り
  { id: 'east_s', x: 31.0, y: 0, z: 28.4 },        // 東の通路の南(照明柱 2)
  { id: 'front_w', x: 10.6, y: 0, z: 31.8 },       // 正面のアプローチ西(照明柱 4)
  { id: 'front_e', x: 23.4, y: 0, z: 32.0 },       // 正面のアプローチ東(照明柱 5)
  { id: 'north_yard', x: 23.6, y: 0, z: 11.8 },    // 北側の外構(ゴミ置場・駐輪場の手前)
  { id: 'north_rack', x: 17.2, y: 0, z: 11.6 },    // 北側の外構(駐輪場の脇)
  { id: 'west_stair', x: -1.2, y: 0, z: 21.6 },    // 外階段の西(植え込みの脇)
];

export class Watcher {
  // ctx: { scene, camera, enemy(Enemy: 読み込み済み), world, building, ai, getLevel(), isBusy(), enabled }
  constructor(ctx) {
    Object.assign(this, ctx);
    this.time = 0;
    this.nextAt = rand(...WATCHER.first);
    this.checkT = 0;
    this.active = null;                // { spot, win, seenT, seenOnce, outT, t }
    this.events = [];
    this.memo = new Map();             // `${winKey}|${spotId}` → 見通せるか(静的なので 1 回だけ調べる)
    this.windows = this._collectWindows();
    this.ray = new THREE.Raycaster();
    this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3();
    this._built = false;
  }

  log(ev, extra = {}) { this.events.push({ t: +this.time.toFixed(2), ev, ...extra }); if (this.events.length > 100) this.events.shift(); }

  // 窓の一覧: 廊下端の窓(facing = 室内側)と入れる部屋の掃き出し窓(facing = 外側)
  _collectWindows() {
    const out = [];
    for (const f of this.building.floors) {
      if (f.level > 7) continue;
      const y0 = levelY(f.level);
      for (const [i, w] of f.shell.windows.entries()) {
        const nin = FACING_N[w.facing];
        out.push({ key: `c${f.level}_${i}`, kind: 'corr', level: f.level, x: w.pos[0], z: w.pos[1], out: [-nin[0], -nin[1]], w: w.w, y0: y0 + w.sill, y1: y0 + w.sill + w.h });
      }
      for (const r of f.rooms) {
        if (!(r.door && r.door.enterable && r.window)) continue;
        const wn = r.window, o = FACING_N[wn.facing];
        out.push({ key: `r${r.id}`, kind: 'room', room: r, level: f.level, x: wn.pos[0], z: wn.pos[1], out: o, w: wn.width, y0: y0 + 0.02, y1: y0 + 0.02 + wn.h });
      }
    }
    return out;
  }

  // プレイヤーがその窓の室内側の近くにいるか
  _atWindow(w, p, lv) {
    if (w.level !== lv) return false;
    if (w.kind === 'corr') {
      const dx = p.x - w.x, dz = p.z - w.z;
      return -(dx * w.out[0] + dz * w.out[1]) > 0 && Math.hypot(dx, dz) < WATCHER.corrWinDist;
    }
    const [rx, rz, rw, rd] = w.room.rect;
    return p.x > rx && p.x < rx + rw && p.z > rz && p.z < rz + rd;
  }

  _build() {
    if (this._built) return;
    this._built = true;
    const src = this.enemy.model;
    const root = SkeletonUtils.clone(src);
    root.traverse((o) => { if (o.name === 'EnemyFlashlight') o.removeFromParent(); });
    const drop = [];
    root.traverse((o) => { if (o.isLight) drop.push(o); });
    for (const o of drop) o.removeFromParent();
    this.uniforms = makeEnemyLightUniforms();
    const matMap = new Map();
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false;
      const conv = (m) => {
        if (matMap.has(m)) return matMap.get(m);
        const c = m.clone();
        c.userData = { ...m.userData, n2EnemyPatched: false };
        c.fog = false;                       // 屋内の濃い霧(0.05)を窓の外の人影に掛けない
        patchEnemyMaterial(c, this.uniforms);
        matMap.set(m, c);
        return c;
      };
      o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
      if (o.morphTargetInfluences) o.morphTargetInfluences.fill(0);
    });
    this.root = new THREE.Group(); this.root.name = 'WatcherApparition';
    this.root.add(root);
    this.model = root;
    this.neck = root.getObjectByName('mixamorigNeck');
    this.head = root.getObjectByName('mixamorigHead');
    this.mixer = new THREE.AnimationMixer(root);
    const clip = this.enemy.clips.look_idle;
    if (clip) { const a = this.mixer.clipAction(clip); a.play(); a.timeScale = 0.22; }
    this.root.visible = false;
    this.scene.add(this.root);
  }

  // 窓の前に立った目の位置(窓の室内側 eyeBack・目線 1.62m。窓に寄って外を見下ろす人の目)
  _eye(w) { return new THREE.Vector3(w.x - w.out[0] * WATCHER.eyeBack, levelY(w.level) + 1.62, w.z - w.out[1] * WATCHER.eyeBack); }
  // 窓 → 立ち位置が見通せるか: 窓の前の目から頭と胴への線が窓の開口を通り、窓ガラス・透明な物・人影以外に遮られない(結果は覚えておく)
  _clear(w, s) {
    const key = w.key + '|' + s.id;
    if (this.memo.has(key)) return this.memo.get(key);
    const from = this._eye(w);
    let ok = this._throughWindow(w, from, new THREE.Vector3(s.x, s.y + 1.55, s.z)) && this._throughWindow(w, from, new THREE.Vector3(s.x, s.y + 1.0, s.z));
    if (!ok) { this.memo.set(key, false); this.log('blocked', { win: w.key, spot: s.id, by: 'window_frame' }); return false; }
    const objs = [];
    this.scene.traverseVisible((o) => {
      if (o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && !(o.material && (o.material.transparent || o.material.isShaderMaterial))) objs.push(o);
    });
    for (const yOff of [1.55, 1.0]) {
      const to = new THREE.Vector3(s.x, s.y + yOff, s.z);
      const dir = to.clone().sub(from); const len = dir.length(); dir.normalize();
      this.ray.set(from, dir); this.ray.far = len - 0.3; this.ray.near = 0.05;
      const hit = this.ray.intersectObjects(objs, false).find((h) => !/Glass|Mirror|Window|Bars/i.test(h.object.material.name || ''));   // 格子の手すり(MX_Bars)は透けて見える
      if (hit) { ok = false; this.log('blocked', { win: w.key, spot: s.id, by: hit.object.name || hit.object.material.name, at: +hit.distance.toFixed(1) }); break; }
    }
    this.memo.set(key, ok);
    return ok;
  }

  _inView(pos, margin = WATCHER.ndc) {
    const v = this._v.copy(pos).project(this.camera);
    return v.z < 1 && v.z > -1 && Math.abs(v.x) < margin && Math.abs(v.y) < margin;
  }
  _headPos(s) { return this._v2.set(s.x, s.y + 1.62, s.z); }

  // 置ける窓と立ち位置を探す。force = 立ち位置の id(テスト・デバッグ: 間隔と監督役を無視)
  _tryPlace(force = null) {
    const lv = this.getLevel();
    const p = this.camera.position;
    const pf = { x: p.x, z: p.z };
    for (const w of this.windows) {
      if (!this._atWindow(w, pf, lv)) continue;
      const wy = (w.y0 + w.y1) / 2;
      for (const s of WATCH_SPOTS) {
        if (force && s.id !== force) continue;
        const dx = s.x - w.x, dz = s.z - w.z, dh = Math.hypot(dx, dz);
        if (dh < 1e-3 || (dx * w.out[0] + dz * w.out[1]) / dh < WATCHER.outDot) continue;
        const d3 = Math.hypot(dh, s.y + 1.6 - wy);
        if (d3 < WATCHER.dist[0] || d3 > WATCHER.dist[1]) continue;
        if (!force && this._inView(this._headPos(s), 1.05)) continue;   // 目の前に湧かせない
        if (!this._clear(w, s)) continue;
        this._show(s, w);
        return true;
      }
    }
    return false;
  }

  _show(s, w) {
    this._build();
    this.active = { spot: s, win: w, seenT: 0, seenOnce: false, outT: 0, t: 0, away: 0 };
    this.root.position.set(s.x, s.y, s.z);
    this.root.rotation.set(0, Math.atan2(w.x - s.x, w.z - s.z), 0);
    this.root.visible = true;
    // 立ち位置を照らす光: 近くの照明柱(敷地)、無ければ建物側から
    const poles = (this.building.site && this.building.site.poles) || [];
    let best = null, bd = 9;
    for (const [px, pz] of poles) { const d = Math.hypot(px - s.x, pz - s.z); if (d < bd) { bd = d; best = [px, pz]; } }
    const L = WATCHER.lamp;
    this.lampWorld = best ? new THREE.Vector3(best[0], s.y + L.height, best[1]) : new THREE.Vector3(s.x + (w.x - s.x) * 0.15, s.y + L.height, s.z + (w.z - s.z) * 0.15);
    this.log('show', { spot: s.id, win: w.key });
  }

  hide(why) {
    if (!this.active) return;
    this.log('hide', { why, spot: this.active.spot.id, seen: +this.active.seenT.toFixed(2) });
    this.active = null;
    if (this.root) this.root.visible = false;
    this.nextAt = this.time + rand(...WATCHER.every);
  }

  force(spotId = null) { this.nextAt = this.time; return this._tryPlace(spotId || null) || this._tryPlace(null); }

  update(dt) {
    this.time += dt;
    if (!this.enabled) return;
    const A = this.active;
    if (A) {
      A.t += dt;
      const lv = this.getLevel();
      const p = this.camera.position;
      const head = this._headPos(A.spot);
      const atWin = this._atWindow(A.win, { x: p.x, z: p.z }, lv);
      const inView = atWin && this._inView(head) && this._throughWindow(A.win, p, head);
      if (inView) { A.seenT += dt; A.away = 0; if (A.seenT >= WATCHER.minSeen) A.seenOnce = true; }
      else A.away += dt;
      if (A.seenT >= WATCHER.seeTime) { this.hide('stared'); return; }
      if (A.seenOnce && !inView && A.away > 0.12) { this.hide('looked_away'); return; }
      if (!A.seenOnce && (A.t > WATCHER.timeout || (!atWin && A.away > 4 && !this._inView(head, 1.1)))) { this.hide(A.t > WATCHER.timeout ? 'timeout' : 'left'); return; }
      if (this.isBusy()) { this.hide('busy'); return; }
      this._animate(dt);
      return;
    }
    if (this.time < this.nextAt) return;
    this.checkT -= dt;
    if (this.checkT > 0) return;
    this.checkT = WATCHER.checkEvery;
    const ai = this.ai;
    const away = ai.transit || ai.level !== this.getLevel();
    const calm = ai.phase() !== 'tense' && !['CHASE', 'ALERT', 'ATTACK', 'EVAMBUSH', 'SCOPE', 'LOCKER'].includes(ai.state);
    if (!away || !calm || this.isBusy() || typeof this.getLevel() !== 'number') return;
    if (!this._tryPlace()) { this.nextAt = this.time + WATCHER.retry; }
  }

  // 視線(カメラ → 頭)がその窓の開口を通るか(部屋の窓はプレイヤーがバルコニーにいれば通さなくてよい)
  _throughWindow(w, cam, head) {
    const nx = w.out[0], nz = w.out[1];
    const dc = (cam.x - w.x) * nx + (cam.z - w.z) * nz, dh = (head.x - w.x) * nx + (head.z - w.z) * nz;
    if (dc >= -0.05) return w.kind === 'room';          // 窓の外(バルコニー)から見ている
    if (dh <= 0) return false;
    const k = -dc / (dh - dc);
    const x = cam.x + (head.x - cam.x) * k, y = cam.y + (head.y - cam.y) * k, z = cam.z + (head.z - cam.z) * k;
    const along = (x - w.x) * (nz !== 0 ? 1 : 0) + (z - w.z) * (nz !== 0 ? 0 : 1);
    return Math.abs(along) <= w.w / 2 + 0.05 && y >= w.y0 - 0.05 && y <= w.y1 + 0.05;
  }

  _animate(dt) {
    const s = this.active.spot;
    this.mixer.update(dt);
    // 体ごとこちらを向き、首を反らせて見上げる
    const cam = this.camera.position;
    this.root.rotation.y = Math.atan2(cam.x - s.x, cam.z - s.z);
    this.root.updateMatrixWorld(true);
    if (this.neck && this.head) {
      const hp = this.head.getWorldPosition(new THREE.Vector3());
      const up = THREE.MathUtils.clamp(Math.atan2(cam.y - hp.y, Math.hypot(cam.x - hp.x, cam.z - hp.z)), 0, WATCHER.lookUpMax);
      const f = new THREE.Vector3(Math.sin(this.root.rotation.y), 0, Math.cos(this.root.rotation.y));
      const right = new THREE.Vector3(f.z, 0, -f.x).normalize();
      for (const [bone, k] of [[this.neck, 0.55], [this.head, 0.45]]) {
        const rWorld = new THREE.Quaternion().setFromAxisAngle(right, -up * k);
        const pWorld = bone.parent.getWorldQuaternion(new THREE.Quaternion());
        bone.quaternion.copy(pWorld.clone().invert().multiply(rWorld).multiply(pWorld).multiply(bone.quaternion));
        bone.updateMatrixWorld(true);
      }
    }
    // 光(ビュー空間)
    const u = this.uniforms, view = this.camera.matrixWorldInverse, L = WATCHER.lamp;
    u.n2LampPos.value[0].copy(this.lampWorld).applyMatrix4(view);
    u.n2LampColor.value[0].set(L.color).multiplyScalar(L.intensity);
    u.n2LampRange.value[0] = L.range;
    for (let i = 1; i < MAX_LAMPS; i++) { u.n2LampColor.value[i].setScalar(0); u.n2LampRange.value[i] = 1; }
    u.n2UpView.value.set(0, 1, 0).transformDirection(view);
    u.n2HemiSky.value.set(WATCHER.hemi.sky).multiplyScalar(WATCHER.hemi.intensity * 10);
    u.n2HemiGround.value.set(WATCHER.hemi.ground).multiplyScalar(WATCHER.hemi.intensity * 10);
  }

  stats() {
    const A = this.active;
    return { active: A ? { spot: A.spot.id, win: A.win.key, seenT: +A.seenT.toFixed(2), seenOnce: A.seenOnce, t: +A.t.toFixed(1) } : null, nextIn: +(this.nextAt - this.time).toFixed(1), visible: !!(this.root && this.root.visible) };
  }
}

function rand(a, b) { return a + (b - a) * Math.random(); }

// ================================================================ P5b-2b: 窓の内側から見下ろす管理人(DESIGN §3.8 H 第7段 = §3.8 F の逆)
//  第7段で敷地・駐車場に出て建物を見上げると、灯りの点いた窓(外観の lit 8 室のうち駐車場から見える 409)の内側に、こちらを見下ろす管理人が立っている。
//  襲ってこない見えるだけの演出体(Watcher と同じ作り = 本体とは別のメッシュのインスタンス。AI・当たりなし・本体の位置とは無関係)。
//  - 出る: 第7段・敷地の駐車場のあたりにいて、窓がまだ視野に入っていない時(目の前に湧かない)。1 回だけ(見られないまま離れたら、また出られる)
//  - 消える: 近づく(窓から水平 near m)/ 見続ける(seeTime 秒)/ 見た後に視線を外す / 敷地から離れる
//  - 窓の奥のカーテンの発光面(外観 GLB)の手前に立たせる。外から見て分からない程度に前後を薄く(奥行き flat 倍)して、ガラスと発光面の間に収める
//  - ?test では自動で出さない(enabled = false)。force() で出せる(第7段・敷地にいる時だけ)
export const INSIDE_WATCHER = {
  // build/exterior_manifest.json の litWindows の 409(4F・東向き。発光面の中心 x 13.756・z 10.52)。駐車場から見える唯一の上の階の灯りの窓
  win: { room: '409', level: 4, x: 13.756, z: 10.52, out: [1, 0], w: 1.6 },
  stand: 0.075,             // 発光面から外へ(m)
  flat: 0.32,               // 前後の厚みの倍率
  area: { x0: 26.0, x1: 38.5, z0: -3.5, z1: 14.0 },   // 駐車場のあたり(敷地 'G')
  near: 11.0,               // 窓から水平にこの距離まで近づいたら消える
  seeTime: 3.5, minSeen: 0.3, ndc: 0.9,
  lookDownMax: 0.75,
  back: { color: 0xffcf9a, intensity: 2.6, range: 3.2 },   // 背後の部屋の灯り(逆光)
  front: { color: 0xffd9b0, intensity: 0.35, range: 3.0 }, // カーテンの照り返し(顔がかろうじて見える)
};

export class InsideWatcher extends Watcher {
  // ctx: Watcher と同じ(scene・camera・enemy・world・building・ai・getLevel・isBusy)。allowed(第7段)は story が毎フレーム入れる
  constructor(ctx) {
    super(ctx);
    this.allowed = false;
    this.done = false;
  }
  _winHead() { const W = INSIDE_WATCHER.win; return new THREE.Vector3(W.x + W.out[0] * INSIDE_WATCHER.stand, levelY(W.level) + 1.6, W.z + W.out[1] * INSIDE_WATCHER.stand); }
  _inArea(p) { const A = INSIDE_WATCHER.area; return this.getLevel() === 'G' && p.x > A.x0 && p.x < A.x1 && p.z > A.z0 && p.z < A.z1; }
  _nearDist(p) { const W = INSIDE_WATCHER.win; return Math.hypot(p.x - W.x, p.z - W.z); }
  _showInside() {
    this._build();
    const W = INSIDE_WATCHER.win, I = INSIDE_WATCHER;
    this.model.scale.set(1, 1, I.flat);
    const x = W.x + W.out[0] * I.stand, z = W.z + W.out[1] * I.stand, y = levelY(W.level);
    this.root.position.set(x, y, z);
    this.root.rotation.set(0, Math.atan2(W.out[0], W.out[1]), 0);
    this.root.visible = true;
    this.active = { spot: { id: 'win' + W.room, x, y, z }, win: W, seenT: 0, seenOnce: false, t: 0, away: 0 };
    this.lampWorld = new THREE.Vector3(x - W.out[0] * 1.2, y + 2.2, z - W.out[1] * 1.2);
    this.frontWorld = new THREE.Vector3(x + W.out[0] * 0.6, y + 1.3, z + W.out[1] * 0.6);
    this.log('show', { spot: 'win' + W.room });
    return true;
  }
  hide(why) {
    if (!this.active) return;
    this.log('hide', { why, seen: +this.active.seenT.toFixed(2) });
    if (this.active.seenOnce || why === 'near') this.done = true;
    this.active = null;
    if (this.root) this.root.visible = false;
  }
  // テスト・デバッグ: 第7段・駐車場にいる時だけ(見ているかは問わない)
  force() { if (this.active) return true; if (!this.allowed || !this._inArea(this.camera.position)) return false; return this._showInside(); }
  update(dt) {
    this.time += dt;
    const p = this.camera.position;
    const A = this.active;
    if (A) {
      A.t += dt;
      const head = this._winHead();
      if (this.getLevel() !== 'G') { this.hide('left'); return; }
      if (this._nearDist(p) < INSIDE_WATCHER.near) { this.hide('near'); return; }
      const inView = this._inView(head, INSIDE_WATCHER.ndc);
      if (inView) { A.seenT += dt; A.away = 0; if (A.seenT >= INSIDE_WATCHER.minSeen) A.seenOnce = true; } else A.away += dt;
      if (A.seenT >= INSIDE_WATCHER.seeTime) { this.hide('stared'); return; }
      if (A.seenOnce && !inView && A.away > 0.15) { this.hide('looked_away'); return; }
      if (this.isBusy()) { this.hide('busy'); return; }
      this._animateInside(dt);
      return;
    }
    if (!this.enabled || !this.allowed || this.done) return;
    this.checkT -= dt;
    if (this.checkT > 0) return;
    this.checkT = WATCHER.checkEvery;
    if (!this._inArea(p) || this.isBusy() || this._nearDist(p) < INSIDE_WATCHER.near + 1.5) return;
    if (this._inView(this._winHead(), 1.1)) return;   // 目の前に湧かせない
    this._showInside();
  }
  _animateInside(dt) {
    const W = INSIDE_WATCHER.win, I = INSIDE_WATCHER;
    this.mixer.update(dt);
    const cam = this.camera.position, s = this.active.spot;
    // 体は窓の外向きのまま、少しだけプレイヤーの方へ(±0.45 rad)。首を前へ倒して見下ろす
    const base = Math.atan2(W.out[0], W.out[1]);
    let dy = Math.atan2(cam.x - s.x, cam.z - s.z) - base; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    this.root.rotation.y = base + THREE.MathUtils.clamp(dy, -0.45, 0.45);
    this.root.updateMatrixWorld(true);
    if (this.neck && this.head) {
      const hp = this.head.getWorldPosition(new THREE.Vector3());
      const down = THREE.MathUtils.clamp(Math.atan2(hp.y - cam.y, Math.hypot(cam.x - hp.x, cam.z - hp.z)), 0, I.lookDownMax);
      const f = new THREE.Vector3(Math.sin(this.root.rotation.y), 0, Math.cos(this.root.rotation.y));
      const right = new THREE.Vector3(f.z, 0, -f.x).normalize();
      for (const [bone, k] of [[this.neck, 0.55], [this.head, 0.45]]) {
        const rWorld = new THREE.Quaternion().setFromAxisAngle(right, down * k);
        const pWorld = bone.parent.getWorldQuaternion(new THREE.Quaternion());
        bone.quaternion.copy(pWorld.clone().invert().multiply(rWorld).multiply(pWorld).multiply(bone.quaternion));
        bone.updateMatrixWorld(true);
      }
    }
    const u = this.uniforms, view = this.camera.matrixWorldInverse;
    u.n2LampPos.value[0].copy(this.lampWorld).applyMatrix4(view);
    u.n2LampColor.value[0].set(I.back.color).multiplyScalar(I.back.intensity); u.n2LampRange.value[0] = I.back.range;
    u.n2LampPos.value[1].copy(this.frontWorld).applyMatrix4(view);
    u.n2LampColor.value[1].set(I.front.color).multiplyScalar(I.front.intensity); u.n2LampRange.value[1] = I.front.range;
    for (let i = 2; i < MAX_LAMPS; i++) { u.n2LampColor.value[i].setScalar(0); u.n2LampRange.value[i] = 1; }
    u.n2UpView.value.set(0, 1, 0).transformDirection(view);
    u.n2HemiSky.value.set(WATCHER.hemi.sky).multiplyScalar(WATCHER.hemi.intensity * 10);
    u.n2HemiGround.value.set(WATCHER.hemi.ground).multiplyScalar(WATCHER.hemi.intensity * 10);
  }
  stats() { const A = this.active; return { active: A ? { seenT: +A.seenT.toFixed(2), seenOnce: A.seenOnce, t: +A.t.toFixed(1) } : null, visible: !!(this.root && this.root.visible), done: this.done, allowed: this.allowed }; }
}
