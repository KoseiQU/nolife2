// build_assert.mjs — P3b: 居室の内装・バルコニーの回帰防止アサート(Node・THREE 非依存)。違反があれば非0終了。
//  1) 全 104 室で unitInterior(図面 room_plan_1K 準拠のテンプレート)が通る(玄関→洋室→窓の通路に足元の家具が無い。4 方向の向き・鏡像すべて)
//  2) building.json の入れる部屋: 内装・当たり・窓・隠れ場所(クローゼット/ロッカー)・落ちる物がある。当たりが通路と交差しない(JSON から再検査)
//  3) 全居室にバルコニー(奥行 1.0m・外壁側・1〜3F は乳白ガラス、4F 以上は格子)。入れる部屋のバルコニーは footprint(歩ける)
//  4) 屋上A(4F): 410 と 401 のバルコニーの北端に乗り越えの隔て板(gate)
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
  if (f.level === 4) {
    const gs = (f.gates || []).map((g) => g.room).sort().join(',');
    if (gs !== '401,410') fail(`4F: 屋上A の乗り越えの隔て板 ${gs}`);
    if (!f.roofA || f.roofA.rects.length !== 2) fail('4F: 屋上A が無い');
  }
}
if (units !== 104) fail(`居室数 ${units}`);
if (balconies !== 104) fail(`バルコニー ${balconies}/104`);
if (failures) { console.error(`\n内装アサート: ${failures} 件 NG`); process.exit(1); }
console.log(`内装アサート OK: テンプレート 104 室(4 方向)・入れる部屋 ${enterable} 室(内装・窓・隠れ場所・落ちる物・通路)・バルコニー ${balconies} 室・屋上A の隔て板 2`);
