// spaces.js — P5b-1: 物語の別空間(DESIGN §3.8 I の異世界 4 空間)の「仮の小部屋」。
//  階キー 'X105'・'X312'・'X705'・'XB1'(world.js SPACE_KEYS)。B1 と同じく別の階キーで切り分け、建物の当たり・ベイクに影響しない。
//  今は 1K と同じ寸法(幅 2.9m × 奥行 6.0m)の空の部屋に、入口の扉(戻る)と物語の物(鍵・メモ・机・フック)の置き場所があるだけ。
//  P5b-2 の差し替え口: SPACE_DEFS の 1 行(origin・rect・entry・exit・物の置き場所 slots)と build(key) の見た目を空間ごとに作り替える。
//  story.js は enterSpace(id)/leaveSpace() と def(key).slots だけを使う(中身の形には依存しない)。
//  見た目は実行時のメッシュ(ベイクなし)。明かりは天井の裸電球 1 灯(PointLight・影なし)＋懐中電灯＋共通の環境光。

import * as THREE from 'three';
import { SPACE_Y, SPACE_HOST } from './world.js';

const W = 2.9, D = 6.0, H = 2.4;
// origin = 部屋の北西の角(建物から遠く離す)。入口は北の壁の中央、奥は南
export const SPACE_DEFS = {
  X105: { origin: [300, 0], host: { level: 1, door: '105' }, wall: 0x6f716e, floor: 0x3b3a37, ceil: 0x8a8b88, bulb: 0xffe2b8,
    slots: { memo: [0.75, 0.0, 0.85] } },                                  // メモ(入口=出口の脇の床)
  X312: { origin: [330, 0], host: { level: 3, door: '312' }, wall: 0x4f6f78, floor: 0x2e4850, ceil: 0x6d8a90, bulb: 0xbfe6ff,
    slots: { key: [1.45, 0.0, 5.2] } },                                    // 105 の鍵(奥の床)
  X705: { origin: [360, 0], host: { level: 7, door: '705' }, wall: 0x7a6650, floor: 0x5a4632, ceil: 0x8c7a66, bulb: 0xffcf96,
    slots: { desk: [2.35, 0.0, 3.0], key: [2.4, 0.76, 3.0], ambush: [1.45, 0.0, 5.4] } },   // 机(東の壁際の中ほど)・地下の鉄扉の鍵・管理人が現れる所(奥)
  XB1: { origin: [390, 0], host: { level: 'B1', door: 'B1DOOR' }, wall: 0xb9b8b0, floor: 0x585a57, ceil: 0x9a9a94, bulb: 0xeaf2ff,
    slots: { hook: [1.45, 1.45, 5.96], key: [1.45, 1.32, 5.92] } },          // 車のキー(奥の壁のフック)
};

export class Spaces {
  // ctx: { scene, world, building }
  constructor(ctx) {
    Object.assign(this, ctx);
    this.groups = new Map();
    this.shown = null;
    for (const key of Object.keys(SPACE_DEFS)) {
      const S = SPACE_DEFS[key];
      const [ox, oz] = S.origin;
      S.key = key;
      S.rect = [ox, oz, W, D];
      S.y = SPACE_Y;
      S.entry = { x: ox + W / 2, z: oz + 0.75, yaw: Math.PI };            // 入った所(入口の扉の内側・奥=南を向く)
      S.exit = { x: ox + W / 2, z: oz + 0.02 };                            // 入口の扉(E で戻る)
      S.at = (slot) => { const [u, y, v] = S.slots[slot]; return new THREE.Vector3(ox + u, SPACE_Y + y, oz + v); };
      // 戻る先: 入口の扉のある階の扉の前(廊下側 0.9m・扉に背を向ける)
      const d = this.world.doorById.get(S.host.door);
      const n = { W: [-1, 0], E: [1, 0], N: [0, -1], S: [0, 1] }[d.facing];
      const out = S.host.door === 'B1DOOR' ? -1 : 1;   // 地下の鉄扉は踊り場(扉の外向きと逆)へ戻る
      S.back = { level: S.host.level, x: d.pos[0] + n[0] * 0.9 * out, z: d.pos[1] + n[1] * 0.9 * out, yaw: Math.atan2(-n[0] * out, -n[1] * out) };
      S.door = d;
      this.world.cols.get(key).push(...this._collisions(S));
    }
    void SPACE_HOST;
  }

  def(key) { return SPACE_DEFS[key] || null; }

  _collisions(S) {
    const [x, z] = S.origin, t = 0.2, y0 = SPACE_Y, y1 = SPACE_Y + H;
    const b = (minX, minZ, maxX, maxZ, kind = 'wall') => ({ minX, maxX, minZ, maxZ, y0, y1, kind, roomId: S.key, disabled: false });
    const out = [b(x - t, z - t, x + W + t, z), b(x - t, z + D, x + W + t, z + D + t), b(x - t, z, x, z + D), b(x + W, z, x + W + t, z + D)];
    if (S.slots.desk) { const [u, , v] = S.slots.desk; out.push(Object.assign(b(x + u - 0.3, z + v - 0.6, x + u + 0.55, z + v + 0.6, 'furn'), { y1: y0 + 0.74 })); }
    return out;
  }

  // 見た目(最初に入る時に作る)
  _build(key) {
    const S = SPACE_DEFS[key];
    const [x, z] = S.origin, y = SPACE_Y;
    const g = new THREE.Group(); g.name = 'Space_' + key;
    const mat = (c, r = 0.9) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0 });
    const wallM = mat(S.wall), floorM = mat(S.floor, 0.7), ceilM = mat(S.ceil);
    const plane = (w, h, m, px, py, pz, rx, ry) => { const o = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); o.position.set(px, py, pz); o.rotation.set(rx, ry, 0); o.receiveShadow = true; g.add(o); return o; };
    plane(W, D, floorM, x + W / 2, y, z + D / 2, -Math.PI / 2, 0);
    plane(W, D, ceilM, x + W / 2, y + H, z + D / 2, Math.PI / 2, 0);
    plane(D, H, wallM, x, y + H / 2, z + D / 2, 0, Math.PI / 2);
    plane(D, H, wallM, x + W, y + H / 2, z + D / 2, 0, -Math.PI / 2);
    plane(W, H, wallM, x + W / 2, y + H / 2, z + D, 0, Math.PI);
    plane(W, H, wallM, x + W / 2, y + H / 2, z, 0, 0);
    // 幅木
    const base = mat(0x2a2826, 0.6);
    for (const [bx, bz, bw, bd] of [[x, z, W, 0.012], [x, z + D - 0.012, W, 0.012], [x, z, 0.012, D], [x + W - 0.012, z, 0.012, D]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.07, bd), base); m.position.set(bx + bw / 2, y + 0.035, bz + bd / 2); g.add(m);
    }
    // 入口の扉(北の壁。内側から見た木の扉と枠。閉じている＝E で戻る)
    const wood = mat(0x5b3b26, 0.55), frame = mat(0x3a2a20, 0.6), metal = new THREE.MeshStandardMaterial({ color: 0xb8b2a6, roughness: 0.3, metalness: 1.0 });
    const dx = x + W / 2;
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.83, 2.0, 0.04), wood); leaf.position.set(dx, y + 1.0, z + 0.03); g.add(leaf);
    for (const [fx, fw] of [[dx - 0.45, 0.06], [dx + 0.45, 0.06]]) { const f = new THREE.Mesh(new THREE.BoxGeometry(fw, 2.06, 0.07), frame); f.position.set(fx, y + 1.03, z + 0.035); g.add(f); }
    { const f = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.06, 0.07), frame); f.position.set(dx, y + 2.06, z + 0.035); g.add(f); }
    { const k = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.022, 0.05), metal); k.position.set(dx + 0.3, y + 0.96, z + 0.07); g.add(k); }
    // 机(X705)
    if (S.slots.desk) {
      const [u, , v] = S.slots.desk;
      const dm = mat(0x6e5236, 0.5);
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.04, 1.2), dm); top.position.set(x + u + 0.125, y + 0.72, z + v); g.add(top);
      for (const [lx, lz] of [[-0.25, -0.55], [0.5, -0.55], [-0.25, 0.55], [0.5, 0.55]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.7, 0.05), dm); l.position.set(x + u + lx, y + 0.35, z + v + lz); g.add(l); }
    }
    // フック(XB1)
    if (S.slots.hook) {
      const [u, hy, v] = S.slots.hook;
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.015), mat(0x8c8a84, 0.5)); plate.position.set(x + u, y + hy, z + v - 0.0075); g.add(plate);
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.05, 8).rotateX(Math.PI / 2), metal); pin.position.set(x + u, y + hy - 0.02, z + v - 0.04); g.add(pin);
    }
    // 天井の裸電球(弱い・影なし)
    const bulb = new THREE.PointLight(S.bulb, 0.55, 7.5, 2); bulb.position.set(x + W / 2, y + H - 0.25, z + D * 0.55); bulb.castShadow = false; g.add(bulb);
    const bm = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(S.bulb).multiplyScalar(1.6) })); bm.position.copy(bulb.position); g.add(bm);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.22, 6), base); cord.position.set(bulb.position.x, y + H - 0.11, bulb.position.z); g.add(cord);
    g.visible = false;
    this.scene.add(g);
    this.groups.set(key, g);
    return g;
  }

  // 今いる空間だけ見せる(null で全部隠す)
  show(key) {
    if (key && !this.groups.has(key)) this._build(key);
    for (const [k, g] of this.groups) g.visible = k === key;
    this.shown = key || null;
  }
  // 敵の照明(enemy.js の lampDefs の windowLamps と同じ形)
  lampsFor(key) {
    const S = SPACE_DEFS[key];
    if (!S) return [];
    return [[S.origin[0] + W / 2, SPACE_Y + H - 0.25, S.origin[1] + D * 0.55]];
  }
}
