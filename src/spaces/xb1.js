// spaces/xb1.js — 別空間 XB1(DESIGN §3.8 I 4 行目「地下 B1」)。§3.8 H 第10段
//  今は P5b-1 の「仮の小部屋」をそのまま移しただけ(spaces.js の分割。中身は P5b-2b で作る)。
//  1K と同じ寸法(幅 2.9m × 奥行 6.0m × 高さ 2.4m)の空の部屋。入口の扉(北の壁の中央・内側から見た木の扉と枠。E で戻る)と物語の物の置き場所。
//  明かりは天井の裸電球 1 灯(PointLight・影なし)＋懐中電灯＋共通の環境光。モジュールの形は src/spaces.js の冒頭。

import * as THREE from 'three';
import { SPACE_Y } from '../world.js';

const W = 2.9, D = 6.0, H = 2.4;
const LOOK = { wall: 0xb9b8b0, floor: 0x585a57, ceil: 0x9a9a94, bulb: 0xeaf2ff };
// origin = 部屋の北西の角(建物から遠く離す)。入口は北の壁の中央、奥は南
export const DEF = {
  origin: [390, 0], host: { level: 'B1', door: 'B1DOOR' },
  entry: [W / 2, 0.75, Math.PI],   // 入った所(入口の扉の内側・奥=南を向く)
  exit: [W / 2, 0.02],             // 入口の扉(E で戻る)
  slots: { hook: [1.45, 1.45, 5.96], key: [1.45, 1.32, 5.92] }           // 車のキー(奥の壁のフック),
};

export function build(ctx) {
  ctx.cols.push(..._collisions(ctx));
  _build(ctx);
  const [x, z] = DEF.origin;
  ctx.lamps.push([x + W / 2, SPACE_Y + H - 0.25, z + D * 0.55]);
}
export function update() {}
export function dispose(ctx) {
  for (const o of [...ctx.group.children]) { ctx.group.remove(o); o.traverse((m) => { if (m.geometry) m.geometry.dispose(); }); }
  ctx.cols.length = 0;
}

function _collisions(ctx) {
  const [x, z] = DEF.origin, t = 0.2, y0 = SPACE_Y, y1 = SPACE_Y + H;
  const b = (minX, minZ, maxX, maxZ, kind = 'wall') => ({ minX, maxX, minZ, maxZ, y0, y1, kind, roomId: ctx.key, disabled: false });
  const out = [b(x - t, z - t, x + W + t, z), b(x - t, z + D, x + W + t, z + D + t), b(x - t, z, x, z + D), b(x + W, z, x + W + t, z + D)];
  if (DEF.slots.desk) { const [u, , v] = DEF.slots.desk; out.push(Object.assign(b(x + u - 0.3, z + v - 0.6, x + u + 0.55, z + v + 0.6, 'furn'), { y1: y0 + 0.74 })); }
  return out;
}

function _build(ctx) {
  const S = DEF;
  const [x, z] = S.origin, y = SPACE_Y;
  const g = ctx.group;
  const mat = (c, r = 0.9) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0 });
  const wallM = mat(LOOK.wall), floorM = mat(LOOK.floor, 0.7), ceilM = mat(LOOK.ceil);
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
  const bulb = new THREE.PointLight(LOOK.bulb, 0.55, 7.5, 2); bulb.position.set(x + W / 2, y + H - 0.25, z + D * 0.55); bulb.castShadow = false; g.add(bulb);
  const bm = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(LOOK.bulb).multiplyScalar(1.6) })); bm.position.copy(bulb.position); g.add(bm);
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.22, 6), base); cord.position.set(bulb.position.x, y + H - 0.11, bulb.position.z); g.add(cord);
}
