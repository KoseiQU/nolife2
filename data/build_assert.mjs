// build_assert.mjs — P3b: 居室の内装・バルコニーの回帰防止アサート(Node・THREE 非依存)。違反があれば非0終了。
//  1) 全 104 室で unitInterior(図面 room_plan_1K 準拠のテンプレート)が通る(玄関→洋室→窓の通路に足元の家具が無い。4 方向の向き・鏡像すべて)
//  2) building.json の入れる部屋: 内装・当たり・窓・隠れ場所(クローゼット/ロッカー)・落ちる物がある。当たりが通路と交差しない(JSON から再検査)
//  3) 全居室にバルコニー(奥行 1.0m・外壁側・1〜3F は乳白ガラス、4F 以上は格子)。入れる部屋のバルコニーは footprint(歩ける)
//  4) 屋上A(4F): 410 と 401 のバルコニーの北端に乗り越えの隔て板(gate)
//  5) P3b-2: 410 は図面の鏡像(玄関から奥を見て右=洗濯機・洗面・冷蔵庫・クローゼット・デスク、左=トイレ・バス・ベッド・シューズケース)。
//     入れる居室の扉の振り(内開き 1.75rad・蝶番は低い側)に当たりが入らない。乗り越えの台(室外機)は隔て板の手前で、窓の開く側からの通り道を塞がない
// 実行: node data/build_assert.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { unitInterior } from '../src/interior_layout.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const building = JSON.parse(readFileSync(join(__dirname, 'building.json'), 'utf8'));

let failures = 0, units = 0, enterable = 0, balconies = 0;
const fail = (m) => { failures++; console.error('ASSERT FAIL:', m); };
const overlap = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

for (const f of building.floors) {
  if (f.level >= 8) continue;
  for (const r of f.rooms) {
    if (r.kind !== 'unit') continue;
    units++;
    try { unitInterior(r); } catch (e) { fail(e.message); }
    try { unitInterior(r, { mirror: true }); } catch (e) { fail('(鏡像) ' + e.message); }
    // 3) バルコニー
    const b = r.balcony;
    if (!b) { fail(`${r.id}: バルコニーが無い`); continue; }
    balconies++;
    const depth = b.axis === 'z' ? b.rect[2] : b.rect[3];
    if (Math.abs(depth - 1.0) > 1e-6) fail(`${r.id}: バルコニーの奥行 ${depth}`);
    if (b.rail !== (f.level <= 3 ? 'glass' : 'grid')) fail(`${r.id}: 手すりの種類 ${b.rail}`);
    const opp = { E: 'W', W: 'E', N: 'S', S: 'N' };
    if (b.facing !== opp[r.door.facing]) fail(`${r.id}: バルコニーが外壁側でない(${b.facing})`);
  }
  for (const r of f.rooms) {
    if (!(r.door && r.door.enterable)) continue;
    enterable++;
    const it = r.interior;
    if (!it || !it.items.length || !it.solids.length) { fail(`${r.id}: 内装が無い`); continue; }
    if (r.kind === 'unit') {
      if (!r.window || !r.window.operable) fail(`${r.id}: 掃き出し窓が無い`);
      if (!f.footprint.some((q) => JSON.stringify(q) === JSON.stringify(r.balcony.rect))) fail(`${r.id}: バルコニーが歩けない(footprint に無い)`);
      if (!it.hide) fail(`${r.id}: 隠れ場所(クローゼット)が無い`);
      if (!it.fallables.length) fail(`${r.id}: 落ちる物が無い`);
      for (const p of it.passage) for (const s of it.solids) if (overlap(p.rect, s)) fail(`${r.id}: 当たり ${JSON.stringify(s)} が通路 ${JSON.stringify(p.rect)} に入っている`);
    }
  }
  // 5) 扉の振り: 蝶番 = 扉の低い側の端＋枠(0.035)、扉板 0.83m が閉(沿う軸の +)から部屋の内側へ 1.75rad 回る範囲に当たりが無い
  for (const r of f.rooms) {
    if (r.kind !== 'unit' || !(r.door && r.door.enterable) || !r.interior) continue;
    const fv = { E: [1, 0], W: [-1, 0], S: [0, 1], N: [0, -1] }[r.door.facing];
    const horiz = r.door.facing === 'N' || r.door.facing === 'S';
    const W = r.door.width || 0.9, leaf = W - 0.07;
    const hx = horiz ? r.door.pos[0] - W / 2 + 0.035 : r.door.pos[0] - fv[0] * 0.06;
    const hz = horiz ? r.door.pos[1] - fv[1] * 0.06 : r.door.pos[1] - W / 2 + 0.035;
    const d0 = horiz ? [1, 0] : [0, 1], rd = [-fv[0], -fv[1]];
    let hit = null;
    for (let a = 0; a <= 1.75 + 1e-6 && !hit; a += 0.05) {
      const dx = Math.cos(a) * d0[0] + Math.sin(a) * rd[0], dz = Math.cos(a) * d0[1] + Math.sin(a) * rd[1];
      for (let t = 0.05; t <= leaf && !hit; t += 0.05) {
        const px = hx + dx * t, pz = hz + dz * t;
        const s = r.interior.solids.find((q) => px > q[0] - 0.02 && px < q[2] + 0.02 && pz > q[1] - 0.02 && pz < q[3] + 0.02);
        if (s) hit = s;
      }
    }
    if (hit) fail(`${r.id}: 扉の振りに当たり ${JSON.stringify(hit)} が入っている`);
  }
  if (f.level === 4) {
    // 410 の鏡像: 玄関(西の扉)から東を見て右 = 南(+z)
    const r410 = f.rooms.find((r) => r.id === '410');
    const zc = r410.rect[1] + r410.rect[3] / 2;
    const at = (k) => { const it = r410.interior.items.find((i) => i.k === k); return (it.b[1] + it.b[3]) / 2; };
    const right = ['washer', 'vanity', 'fridge', 'closet', 'desk'], left = ['shoecase', 'toilet', 'bath', 'bed'];
    for (const k of right) if (!(at(k) > zc)) fail(`410: ${k} が右側(南)に無い`);
    for (const k of left) if (!(at(k) < zc)) fail(`410: ${k} が左側(北)に無い`);
    if (!((r410.window.open[0] + r410.window.open[1]) / 2 > zc)) fail('410: 掃き出し窓の開く側が右側(南)に無い');
    for (const g of f.gates || []) {
      const r = f.rooms.find((rr) => rr.id === g.room);
      const [bx, bz, bw, bd] = r.balcony.rect;
      const [s0, t0, s1, t1] = g.step;
      if (!(s0 >= bx && s1 <= bx + bw && t0 >= bz && t1 <= bz + bd)) fail(`${g.id}: 台がバルコニーの外`);
      if (!(t0 - (g.rect[1] + g.rect[3]) < 0.2)) fail(`${g.id}: 台が隔て板の手前に無い`);
      if (!(g.stepTop >= 0.4 && g.stepTop <= 0.7)) fail(`${g.id}: 台の高さ ${g.stepTop}`);
      if (r.balcony.ac) fail(`${g.id}: 踏み台の室外機の他に室外機がある(1台だけ)`);
      // 台の前(0.6m)〜窓の開く側の範囲までの通り道(幅 0.6 = 体の直径＋余裕)に当たりが無い
      const lane = [bx + 0.2, t1, bx + 0.8, Math.max(r.window.open[1], t1 + 0.6)];
      const obst = [...(r.balcony.ac ? [r.balcony.ac] : [])];
      for (const o of obst) if (overlap(lane, o)) fail(`${g.id}: 台への通り道を ${JSON.stringify(o)} が塞いでいる`);
    }
  }
  if (f.level === 4) {
    const gs = (f.gates || []).map((g) => g.room).sort().join(',');
    if (gs !== '401,410') fail(`4F: 屋上A の乗り越えの隔て板 ${gs}`);
    if (!f.roofA || f.roofA.rects.length !== 2) fail('4F: 屋上A が無い');
  }
}
if (units !== 104) fail(`居室数 ${units}`);
if (balconies !== 104) fail(`バルコニー ${balconies}/104`);
if (failures) { console.error(`\n内装アサート: ${failures} 件 NG`); process.exit(1); }
console.log(`内装アサート OK: テンプレート 104 室(4 方向・鏡像も)・扉の振り・入れる部屋 ${enterable} 室(内装・窓・隠れ場所・落ちる物・通路)・バルコニー ${balconies} 室・屋上A の隔て板 2`);
