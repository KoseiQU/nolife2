// stairs.js — P3a: 外階段(main)と北階段(north)の上り下り。
//  踊り場の「段の口」(上りレーン/下りレーンの手前 mouthDepth)に入って段の方へ進む(W)と、段に沿って
//  カメラが1層ぶん移動する(踊り場→1折れ目→中間踊り場→2折れ目→上/下の踊り場)。移動中はマウスで見回せる。
//  形は building.stairs[].geom(build_building.mjs が書く。Blender の段と同じ数値)。
//  外階段は 7F の上で屋上B('RB')まで続く(stops の並び)。
//  P3a-2: 北階段は屋外の鉄骨(2F・3F の鉄扉→屋外通路→階段、下は 1F の地面)。地下への階段(basement)は 1F→'B1'。

import * as THREE from 'three';
import { levelY } from './world.js';

export const STAIRS = {
  speed: 1.25,         // m/s(段に沿った3D距離)。上りは少し遅く
  downSpeed: 1.45,
  eye: 1.62,
  forwardDot: 0.25,    // 段の方を向いている判定(視線の水平成分と流れの向き)
};

// 局所(流れ s・横 c)→ (x, z)
const W = (st, s, c) => (st.geom.axis === 'x' ? [s, c] : [c, s]);

// stop(階キー)の位置 i から1つ上への経路(世界座標の点列)
function upPath(st, i) {
  const g = st.geom;
  const b = levelY(st.stops[i]);
  const cu = (g.lanes.up[0] + g.lanes.up[1]) / 2, cd = (g.lanes.down[0] + g.lanes.down[1]) / 2;
  const landing0 = g.axis === 'x' ? g.landing[0] : g.landing[1];
  const mid0 = g.axis === 'x' ? g.mid[0] : g.mid[1], midLen = g.axis === 'x' ? g.mid[2] : g.mid[3];
  const sm = mid0 + Math.min(0.7, midLen / 2);
  const pts = [
    [cu, g.s0 - 0.25, b], [cu, g.s0, b], [cu, g.s1, b + g.rise], [cu, sm, b + g.rise],
    [cd, sm, b + g.rise], [cd, g.s1, b + g.rise], [cd, g.s0, b + 2 * g.rise], [cd, g.s0 - 0.45, b + 2 * g.rise],
  ];
  void landing0;
  return pts.map(([c, s, y]) => { const [x, z] = W(st, s, c); return new THREE.Vector3(x, y, z); });
}

export class Stairs {
  // ctx: { building, player, camera, getLevel(), onStart(fromKey, toKey), onArrive(toKey, yaw) }
  constructor(ctx) {
    Object.assign(this, ctx);
    this.list = this.building.stairs;
    this.active = null;     // { st, path, seg, t, toKey, dirSign }
    this.armed = true;      // 到着直後は、口から出るか W を離すまで再び上り下りしない
  }

  get busy() { return !!this.active; }

  // プレイヤーがいる段の口: { st, dir:'up'|'down', toKey } | null
  mouth(px, pz, key) {
    for (const st of this.list) {
      const i = st.stops.indexOf(key);
      if (i < 0) continue;
      const g = st.geom;
      const s = g.axis === 'x' ? px : pz, c = g.axis === 'x' ? pz : px;
      if (s < g.s0 - g.mouthDepth || s > g.s0 + 0.35) continue;
      const [x0, z0, w, d] = st.pos.concat(st.size);
      if (px < x0 - 0.05 || px > x0 + w + 0.05 || pz < z0 - 0.05 || pz > z0 + d + 0.05) continue;
      if (c >= g.lanes.up[0] && c <= g.lanes.up[1] && i + 1 < st.stops.length) return { st, dir: 'up', toKey: st.stops[i + 1], i };
      if (c >= g.lanes.down[0] && c <= g.lanes.down[1] && i - 1 >= 0) return { st, dir: 'down', toKey: st.stops[i - 1], i };
    }
    return null;
  }

  // 踊り場・階段の区画にいるか(隣の階の見た目を出す判定)。st.area があればそれ(北階段の屋外通路込み)
  inStairArea(px, pz) {
    for (const st of this.list) {
      const [x0, z0, w, d] = st.area || st.pos.concat(st.size);
      if (px > x0 - 0.3 && px < x0 + w + 0.3 && pz > z0 - 0.3 && pz < z0 + d + 0.3) return st.id;
    }
    return null;
  }

  // 毎フレーム(移動中でなければ口の判定)。moving=前進キー
  update(dt) {
    if (this.active) return this._advance(dt);
    const p = this.player.pos;
    const key = this.getLevel();
    const m = this.mouth(p.x, p.z, key);
    this.hint = m;
    if (!m || !this.player.keys.has('KeyW')) { this.armed = true; return; }
    if (this.player.frozen || !this.armed) return;
    const fwd = this.camera.getWorldDirection(new THREE.Vector3());
    const flow = m.st.geom.axis === 'x' ? fwd.x : fwd.z;
    if (flow < STAIRS.forwardDot) return;   // 段の方(+s)を向いて進む
    this.start(m);
  }

  // P5b-1b: 段の途中で死んだ・物語で移された時に上り下りを打ち切る(残ると復帰後も段の上へ引き戻され、着いた階へ移される)
  cancel() {
    if (!this.active) return false;
    this.active = null;
    this.armed = false;
    return true;
  }

  start(m) {
    const path = m.dir === 'up' ? upPath(m.st, m.i) : upPath(m.st, m.i - 1).reverse();
    path[0] = this.player.pos.clone();
    if (m.dir === 'down') path[0].y = levelY(m.st.stops[m.i]);
    this.active = { st: m.st, path, seg: 0, t: 0, toKey: m.toKey, dir: m.dir, from: this.getLevel() };
    this.player.frozen = true;
    if (this.onStart) this.onStart(this.active.from, m.toKey);
  }

  _advance(dt) {
    const a = this.active;
    let step = (a.dir === 'up' ? STAIRS.speed : STAIRS.downSpeed) * dt;
    while (step > 0 && a.seg < a.path.length - 1) {
      const p0 = a.path[a.seg], p1 = a.path[a.seg + 1];
      const L = p0.distanceTo(p1);
      const remain = L * (1 - a.t);
      if (step >= remain) { step -= remain; a.seg++; a.t = 0; } else { a.t += step / Math.max(L, 1e-6); step = 0; }
    }
    const done = a.seg >= a.path.length - 1;
    const p = done ? a.path[a.path.length - 1] : a.path[a.seg].clone().lerp(a.path[a.seg + 1], a.t);
    // 段の上下に合わせた小さな上下動
    const bob = done ? 0 : Math.sin(a.t * Math.PI * 4) * 0.012;
    this.player.placeAt(p.x, p.y, p.z, bob);
    // 視線を進む向きへゆっくり寄せる(折り返しで後ろを向いたまま上らないように)
    if (!done) {
      const q0 = a.path[a.seg], q1 = a.path[a.seg + 1];
      const hx = q1.x - q0.x, hz = q1.z - q0.z;
      if (Math.hypot(hx, hz) > 0.3) {
        const want = Math.atan2(-hx, -hz);
        const o = this.player.object;
        let dy = want - o.rotation.y;
        while (dy > Math.PI) dy -= 2 * Math.PI;
        while (dy < -Math.PI) dy += 2 * Math.PI;
        o.rotation.y += Math.sign(dy) * Math.min(Math.abs(dy), 2.6 * dt);
      }
    }
    if (done) {
      this.armed = false;
      this.active = null;
      this.player.frozen = false;
      if (this.onArrive) this.onArrive(a.toKey, a);
    }
    return true;
  }
}
