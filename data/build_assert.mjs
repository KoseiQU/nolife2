// build_assert.mjs — 居室内装テンプレートの回帰防止アサート(Node・THREE非依存)。
// building.json の全居室に対し residentialLayout を実行し、玄関→リビング一本道の
// 通路交差アサート(FB①)が全室で通ることを検証する。違反があれば非0終了する。
//
// 実行: node data/build_assert.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { residentialLayout, friendRoomProps, FLOOR_H } from '../src/interior_layout.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const building = JSON.parse(readFileSync(join(__dirname, 'building.json'), 'utf8'));

// main.js と同じ除外集合(日記4室/220は専用内装=テンプレ対象外)。410はテンプレ対象。
const INTERIOR_EXCLUDE = new Set(['205', '313', '507', '611', '220']);
// P18: 友達の部屋(私物プロップ差別化の対象5室)。main.jsのFRIEND_ROOMSと同一。
const FRIEND_ROOMS = new Set(['105', '212', '221', '312', '409']);

function findRoom(id) {
  for (const f of building.floors) {
    const r = f.rooms.find((rr) => rr.id === id);
    if (r) return { room: r, level: f.level };
  }
  return null;
}

let checked = 0, failures = 0;
for (const f of building.floors) {
  if (f.level >= 8) continue;
  for (const r of f.rooms) {
    if (!/^\d{3}$/.test(r.id)) continue;
    if (INTERIOR_EXCLUDE.has(r.id)) continue;
    try {
      const lay = residentialLayout(r, (f.level - 1) * FLOOR_H);
      checked++;
      // 追加検証: ベッド/机スポットが必ず算出されていること。
      if (!lay.bedSpot || !lay.deskSpot) {
        throw new Error(`居室${r.id}: bedSpot/deskSpot 未算出`);
      }
    } catch (e) {
      failures++;
      console.error('ASSERT FAIL:', e.message);
    }
  }
}

// P18: 友達5部屋の私物プロップ(通路交差・ベッド下隠れスポット侵入の回帰検証)。
let friendChecked = 0;
for (const rid of FRIEND_ROOMS) {
  const found = findRoom(rid);
  if (!found) { failures++; console.error('ASSERT FAIL:', `友達の部屋${rid}: building.jsonに見つからない`); continue; }
  try {
    friendRoomProps(found.room, (found.level - 1) * FLOOR_H);
    friendChecked++;
  } catch (e) {
    failures++;
    console.error('ASSERT FAIL:', e.message);
  }
}

if (failures > 0) {
  console.error(`\n居室内装アサート: ${failures}件で通路/隠れスポット侵入(NG)。checked=${checked} friendChecked=${friendChecked}`);
  process.exit(1);
}
console.log(`居室内装アサート OK: ${checked}室すべて玄関→リビング通路(幅≥0.9m)が確保されている`);
console.log(`友達の部屋 私物プロップアサート OK: ${friendChecked}室すべて通路/ベッド下隠れスポットと非交差`);
