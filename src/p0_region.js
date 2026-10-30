// p0_region.js — P0 区間(src/p0_region.json)の選択規則。THREE 非依存の純関数。
// tools/blender/build_scene.py の select_region_boxes と同じ規則(見た目と当たりが同じ箱を見る)。
// ゲーム(main.js)と機械テスト(tools/check_glb.mjs)の両方が使う。

import { floorWallBoxes, GEOM } from './walls.js';

const rectMinMax = (r) => [r[0], r[1], r[0] + r[2], r[1] + r[3]];
const boxMinMax = (b) => [b.cx - b.w / 2, b.cz - b.d / 2, b.cx + b.w / 2, b.cz + b.d / 2];

// 空気領域(PAD膨張)との接触面積が minContactArea 超の壁/塊を選び、接触部の外接箱に切り詰める。
export function selectRegionBoxes(boxes, region) {
  const pad = region.clipPad;
  const out = [];
  const seen = new Set();
  for (const b of boxes) {
    if (b.kind !== 'wall' && b.kind !== 'solid') continue;
    const [bx0, bz0, bx1, bz1] = boxMinMax(b);
    let area = 0, ux0 = 1e9, uz0 = 1e9, ux1 = -1e9, uz1 = -1e9;
    for (const a of region.air) {
      const [ax0, az0, ax1, az1] = rectMinMax(a.rect);
      const ix0 = Math.max(bx0, ax0 - pad), iz0 = Math.max(bz0, az0 - pad);
      const ix1 = Math.min(bx1, ax1 + pad), iz1 = Math.min(bz1, az1 + pad);
      if (ix1 - ix0 <= 1e-9 || iz1 - iz0 <= 1e-9) continue;
      area += (ix1 - ix0) * (iz1 - iz0);
      ux0 = Math.min(ux0, ix0); uz0 = Math.min(uz0, iz0);
      ux1 = Math.max(ux1, ix1); uz1 = Math.max(uz1, iz1);
    }
    if (area <= region.minContactArea) continue;
    const key = [ux0, uz0, ux1, uz1].map((v) => v.toFixed(4)).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ minX: ux0, minZ: uz0, maxX: ux1, maxZ: uz1, kind: b.kind, src: b });
  }
  return out;
}

export function inAir(region, x, z) {
  for (const a of region.air) {
    const [x0, z0, x1, z1] = rectMinMax(a.rect);
    if (x >= x0 - 1e-6 && x <= x1 + 1e-6 && z >= z0 - 1e-6 && z <= z1 + 1e-6) return true;
  }
  return false;
}

// 衝突AABB: その階の walls.js 全箱(=データが真実) + P0 の塞ぎ(曲がり角の先/扉の向こう)。
// 形は前作 player.js の collisions と同じ {minX,maxX,minZ,maxZ,y0,y1,kind,roomId}。
export function buildCollisions(building, region) {
  const floor = building.floors.find((f) => f.level === region.level);
  const baseY = (region.level - 1) * GEOM.FLOOR_H;
  const y0 = baseY, y1 = baseY + GEOM.CEIL_H;
  const cols = floorWallBoxes(floor).map((b) => {
    const [minX, minZ, maxX, maxZ] = boxMinMax(b);
    return { minX, maxX, minZ, maxZ, y0, y1, kind: b.kind, roomId: b.roomId || null, disabled: false };
  });
  const t = region.capThickness;
  for (const c of region.caps) {
    // 塞ぎ板は空気側(normal方向)に面を持つ。箱は面の裏側へ厚み t
    const minX = c.normal === 'W' ? c.x : c.x - t;
    cols.push({ minX, maxX: minX + t, minZ: c.z0, maxZ: c.z1, y0, y1, kind: 'cap', roomId: null, disabled: false });
  }
  return { collisions: cols, floor, baseY };
}
