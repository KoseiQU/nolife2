// spaces.js — 物語の別空間(DESIGN §3.8 I の異世界 4 空間)の共通の仕組み。P5b-2a で空間ごとのモジュールに分割した。
//  階キー 'X105'・'X312'・'X705'・'XB1'(world.js SPACE_KEYS)。B1 と同じく別の階キーで切り分け、建物の当たり・ベイクに影響しない。
//  ここに残すのは「入口/戻る/表示/当たり」の共通部分と、空間ごとのモジュール(src/spaces/<key>.js)への振り分けだけ。
//
//  モジュールの形(空間ごとに独立して差し替えられる):
//    export const DEF = { origin: [x, z], host: { level, door }, entry: [u, v, yaw], exit: [u, v], slots: { name: [u, y, v] } }
//      origin = 局所座標の原点(世界の x・z)。u = x − origin.x、v = z − origin.z。slots の名前(memo・key・desk・ambush・hook)は story.js が使う
//    export function build(ctx)        メッシュ(ctx.group に足す)・当たり(ctx.cols に push)・敵の照明(ctx.lamps に [x, y, z])
//    export function update(dt, ctx)   異世界の演出(その空間にプレイヤーがいる間だけ毎フレーム)
//    export function dispose(ctx)      作った物を片付ける(ctx.group の中身・ctx.cols)
//   任意: enter(ctx)(入った時。状態を作り直す)・leave(ctx)(出た時)・exits(ctx)(戻る口 [{ x, z, n, auto, reach, depth, half, onLeave }]。無ければ DEF.exit)・
//         target(ctx, look)(画面ガイドの対象。story.target が使う)・respawn(ctx)(この空間で死んだ時の戻り先。無ければ物語の段の開始位置)・
//         canPick(ctx, slot, cam)(物を拾える位置か)・entryPoint(ctx)(入った所の上書き)・slotPos(ctx, slot)(動く置き場所)・
//         nav(ctx, fx, fz, tx, tz)(管理人の経路 [{x, z}])・debug(ctx)(テスト用の操作)
//  ctx(空間ごとに 1 つ): { key, def, mod, scene, world, building, group, cols, lamps, state, ...共有(camera・player・ai・enemy・audio・hud・story・kill・getLevel) }
//  story.js が使うのは SPACE_DEFS[k].entry/exit/back/at(slot) と Spaces.show()/lampsFor()/exits()/target() だけ。
//  見た目は実行時のメッシュ(ベイクなし)。

import * as THREE from 'three';
import { SPACE_Y } from './world.js';
import * as X105 from './spaces/x105.js';
import * as X312 from './spaces/x312.js';
import * as X705 from './spaces/x705.js';
import * as XB1 from './spaces/xb1.js';

export const SPACE_MODULES = { X105, X312, X705, XB1 };

// 世界座標の定義(story.js の pickups の位置などで読み込み時に使う)
export const SPACE_DEFS = {};
for (const [key, M] of Object.entries(SPACE_MODULES)) {
  const L = M.DEF;
  const [ox, oz] = L.origin;
  const S = { ...L, key, y: SPACE_Y };
  S.entry = { x: ox + L.entry[0], z: oz + L.entry[1], yaw: L.entry[2] };   // 入った所
  S.exit = { x: ox + L.exit[0], z: oz + L.exit[1] };                      // 入口の扉(既定の戻る口)
  S.at = (slot) => { const [u, y, v] = S.slots[slot]; return new THREE.Vector3(ox + u, SPACE_Y + y, oz + v); };
  SPACE_DEFS[key] = S;
}

export class Spaces {
  // ctx: { scene, world, building } ＋ 任意の共有物(camera・player・ai・enemy・audio・hud・kill・getLevel)。story は後から spaces.share({ story })
  constructor(ctx) {
    Object.assign(this, ctx);
    this.shared = { ...ctx };
    this.ctxs = new Map();
    this.shown = null;
    for (const key of Object.keys(SPACE_DEFS)) {
      const S = SPACE_DEFS[key];
      // 戻る先: 入口の扉のある階の扉の前(廊下側 0.9m・扉に背を向ける)
      const d = this.world.doorById.get(S.host.door);
      const n = { W: [-1, 0], E: [1, 0], N: [0, -1], S: [0, 1] }[d.facing];
      const out = S.host.door === 'B1DOOR' ? -1 : 1;   // 地下の鉄扉は踊り場(扉の外向きと逆)へ戻る
      S.back = { level: S.host.level, x: d.pos[0] + n[0] * 0.9 * out, z: d.pos[1] + n[1] * 0.9 * out, yaw: Math.atan2(-n[0] * out, -n[1] * out) };
      S.door = d;
      const group = new THREE.Group(); group.name = 'Space_' + key; group.visible = false;
      this.scene.add(group);
      const c = Object.assign({}, this.shared, { key, def: S, mod: SPACE_MODULES[key], group, cols: this.world.cols.get(key), lamps: [], state: {} });
      this.ctxs.set(key, c);
      c.mod.build(c);
    }
  }

  // 後から共有物を足す(story は Spaces の後に作るので)
  share(o) { Object.assign(this.shared, o); for (const c of this.ctxs.values()) Object.assign(c, o); }
  def(key) { return SPACE_DEFS[key] || null; }
  ctx(key) { return this.ctxs.get(key) || null; }

  // 今いる空間だけ見せる(null で全部隠す)。空間が変わる時に leave/enter
  show(key) {
    key = key || null;
    const prev = this.shown;
    if (prev !== key) {
      const pc = prev && this.ctxs.get(prev);
      if (pc && pc.mod.leave) pc.mod.leave(pc);
    }
    for (const [k, c] of this.ctxs) c.group.visible = k === key;
    this.shown = key;
    if (prev !== key) {
      const c = key && this.ctxs.get(key);
      if (c && c.mod.enter) c.mod.enter(c);
    }
  }
  update(dt) {
    const c = this.shown && this.ctxs.get(this.shown);
    if (c && c.mod.update) c.mod.update(dt, c);
  }
  dispose(key) {
    const c = this.ctxs.get(key);
    if (!c) return;
    if (c.mod.dispose) c.mod.dispose(c);
  }
  // 敵の照明(enemy.js の lampDefs の windowLamps と同じ形)
  lampsFor(key) { const c = this.ctxs.get(key); return c ? c.lamps : []; }
  // 戻る口: [{ x, z, n(空間の内側への向き), auto(扉の前 depth・横 half まで歩くと出る), reach(E の距離), onLeave? }]
  exits(key) {
    const c = this.ctxs.get(key);
    if (!c) return [];
    if (c.mod.exits) return c.mod.exits(c);
    return [{ x: c.def.exit.x, z: c.def.exit.z, n: [0, 1], auto: true, reach: 1.3, depth: 0.45, half: 0.6 }];
  }
  // 画面ガイドの追加の対象(空間の中の扉など)。look(x, z, reach) は story.target の視線判定
  target(key, look) { const c = this.ctxs.get(key); return c && c.mod.target ? c.mod.target(c, look) : null; }
  // この空間で死んだ時の戻り先(null = 物語の段の開始位置)
  respawn(key) { const c = this.ctxs.get(key); return c && c.mod.respawn ? c.mod.respawn(c) : null; }
  canPick(key, slot, cam) { const c = this.ctxs.get(key); return c && c.mod.canPick ? c.mod.canPick(c, slot, cam) : true; }
  // 入った所(null = DEF.entry)。死んだ後のやり直しなどでモジュールが変える
  entry(key) { const c = this.ctxs.get(key); return c && c.mod.entryPoint ? c.mod.entryPoint(c) : null; }
  // 物の置き場所(動く空間ではモジュールが今の位置を返す。null = 動かない)
  slotPos(key, slot) { const c = this.ctxs.get(key); return c && c.mod.slotPos ? c.mod.slotPos(c, slot) : null; }
  // 管理人の経路(グラフの無い階 = 別空間の中。null ならまっすぐ)。enemy_ai の spaceNav から
  nav(key, fx, fz, tx, tz) { const c = this.ctxs.get(key); return c && c.mod.nav ? c.mod.nav(c, fx, fz, tx, tz) : null; }
  // テスト用の操作(モジュールの debug)
  debug(key) { const c = this.ctxs.get(key); return c && c.mod.debug ? c.mod.debug(c) : null; }
}
