// walls.js — 壁ボックス生成の共通モジュール(純粋関数・Three.js非依存)。
// level.js(描画+衝突) と data/build_building.mjs(閉じ込めflood-fillテスト) の
// 両方がこのロジックを使う。テストと実描画が必ず同じ壁データを見る。
//
// box: { cx, cz, w, d, kind }
//   kind 'wall'      … 通常壁(部屋壁/外周壁/フィラー)
//   kind 'solid'     … 塊(EVシャフト。全面が衝突)
//   kind 'perimDoor' … 外周開口を塞ぐ扉(1F玄関オートロック。P1では常閉・衝突あり)
//   kind 'door'      … 施錠室のドアブロッカ(roomId付き)。閉扉=衝突。
//                      描画はlevel.jsのドア板が担うため、このボックスは衝突とテスト専用。
//                      flood-fillは「ドア閉状態では廊下側だけ到達可能」を検証することになる
//                      (8Fの封印扉も同様に塞がる)。プレイヤー自室(410)のドアだけは
//                      level.jsが実行時に開閉可能化する(開いている間はこのAABBを無効化)

export const GEOM = { FLOOR_H: 2.9, CEIL_H: 2.4, WALL_T: 0.12, DOOR_W: 0.9 };
const T = GEOM.WALL_T;

// 区間[lo,hi]から gaps[{center,width}] を引いた区間リスト
function cutIntervals(lo, hi, gaps) {
  let ivs = [[lo, hi]];
  for (const g of gaps) {
    const gl = g.center - g.width / 2, gh = g.center + g.width / 2;
    const next = [];
    for (const [a, b] of ivs) {
      if (gh <= a || gl >= b) { next.push([a, b]); continue; }
      if (gl > a) next.push([a, gl]);
      if (gh < b) next.push([gh, b]);
    }
    ivs = next;
  }
  return ivs.filter(([a, b]) => b - a > 0.02);
}

// 水平壁(z固定)。ext>0 なら両端を延長(外周の角の隙間埋め)
function hWall(boxes, lo, hi, z, gaps, ext = 0) {
  for (const [a, b] of cutIntervals(lo, hi, gaps)) {
    boxes.push({ cx: (a + b) / 2, cz: z, w: b - a + 2 * ext, d: T, kind: 'wall' });
  }
}
// 垂直壁(x固定)
function vWall(boxes, lo, hi, x, gaps, ext = 0) {
  for (const [a, b] of cutIntervals(lo, hi, gaps)) {
    boxes.push({ cx: x, cz: (a + b) / 2, w: T, d: b - a + 2 * ext, kind: 'wall' });
  }
}

// 部屋の指定面のギャップ(ドア開口 + 追加開口)
function sideGaps(room, side) {
  const gaps = [];
  const horiz = side === 'N' || side === 'S';
  if (room.door && room.door.facing === side) {
    gaps.push({ center: horiz ? room.door.pos[0] : room.door.pos[1], width: GEOM.DOOR_W });
  }
  for (const o of room.openings || []) {
    if (o.side === side) {
      gaps.push({ center: horiz ? o.pos[0] : o.pos[1], width: o.width || GEOM.DOOR_W });
    }
  }
  return gaps;
}

// 部屋の4壁
function roomWallBoxes(room, boxes) {
  const [x, z, w, d] = room.rect;
  hWall(boxes, x, x + w, z, sideGaps(room, 'N'));
  hWall(boxes, x, x + w, z + d, sideGaps(room, 'S'));
  vWall(boxes, z, z + d, x, sideGaps(room, 'W'));
  vWall(boxes, z, z + d, x + w, sideGaps(room, 'E'));
}

// 外周壁: floor.footprint(矩形群)の露出辺を検出して外側オフセットで壁を張る。
// 露出辺 = 辺のすぐ外側が他の矩形に覆われていない区間。
// 開口は floor.perimOpenings(1F玄関)のみ。開口には perimDoor ブロッカを置く。
function perimeterBoxes(floor, boxes) {
  const rects = floor.footprint || [];
  const opens = floor.perimOpenings || [];
  const D = 0.02; // 外側サンプル距離

  for (let i = 0; i < rects.length; i++) {
    const [rx, rz, rw, rd] = rects[i];

    // 指定線上のカバー区間(他矩形)を gaps として集める
    const coverGapsH = (zSample) => {
      const gaps = [];
      for (let j = 0; j < rects.length; j++) {
        if (j === i) continue;
        const [ox, oz, ow, od] = rects[j];
        if (zSample >= oz - 1e-9 && zSample <= oz + od + 1e-9) {
          gaps.push({ center: ox + ow / 2, width: ow });
        }
      }
      return gaps;
    };
    const coverGapsV = (xSample) => {
      const gaps = [];
      for (let j = 0; j < rects.length; j++) {
        if (j === i) continue;
        const [ox, oz, ow, od] = rects[j];
        if (xSample >= ox - 1e-9 && xSample <= ox + ow + 1e-9) {
          gaps.push({ center: oz + od / 2, width: od });
        }
      }
      return gaps;
    };
    // 玄関開口(向きと線一致で適用)
    const openGapsH = (zc, facing) => opens
      .filter((o) => o.facing === facing && Math.abs(o.pos[1] - zc) < 0.05)
      .map((o) => ({ center: o.pos[0], width: o.width }));
    const openGapsV = (xc, facing) => opens
      .filter((o) => o.facing === facing && Math.abs(o.pos[0] - xc) < 0.05)
      .map((o) => ({ center: o.pos[1], width: o.width }));

    // N辺(外側 -z) / S辺(+z) / W辺(-x) / E辺(+x)。壁は外側へ T/2 オフセット
    hWall(boxes, rx, rx + rw, rz - T / 2,
      [...coverGapsH(rz - D), ...openGapsH(rz, 'N')], T / 2);
    hWall(boxes, rx, rx + rw, rz + rd + T / 2,
      [...coverGapsH(rz + rd + D), ...openGapsH(rz + rd, 'S')], T / 2);
    vWall(boxes, rz, rz + rd, rx - T / 2,
      [...coverGapsV(rx - D), ...openGapsV(rx, 'W')], T / 2);
    vWall(boxes, rz, rz + rd, rx + rw + T / 2,
      [...coverGapsV(rx + rw + D), ...openGapsV(rx + rw, 'E')], T / 2);
  }

  // 開口を塞ぐ扉ブロッカ(P1では常閉。P5の脱出で開放予定)。
  // P12: glass:true(1Fエントランス外側ドア)は見た目をガラス扉化するためのフラグを
  // ボックスにも引き継ぐ(level.js側でメッシュ意匠の分岐に使う)。
  for (const op of opens) {
    const horiz = op.facing === 'N' || op.facing === 'S';
    boxes.push({
      cx: op.pos[0], cz: op.pos[1],
      w: horiz ? op.width : T, d: horiz ? T : op.width,
      kind: 'perimDoor',
      ...(op.glass ? { glass: true } : {}),
    });
  }
}

// フィラー壁(コア脇の隙間封鎖など)。線分 [ax,az,bx,bz] (軸平行)
function fillWallBoxes(floor, boxes) {
  for (const [ax, az, bx, bz] of floor.fillWalls || []) {
    if (Math.abs(az - bz) < 1e-6) {
      boxes.push({ cx: (ax + bx) / 2, cz: az, w: Math.abs(bx - ax), d: T, kind: 'wall' });
    } else {
      boxes.push({ cx: ax, cz: (az + bz) / 2, w: T, d: Math.abs(bz - az), kind: 'wall' });
    }
  }
}

// 施錠室のドアブロッカ(kind:'door', roomId付き)。
// 対象:
//   - door.locked === true の部屋(居室・管理室・厨房・8F封印扉)
//   - door.steel === true の外階段の鉄扉(P7)。locked:false だが「閉状態で衝突あり」の
//     可動扉として扱う(operable=Eで開閉可・開いている間はlevel.jsがAABBを無効化)。
//   - door.common === true の共用部開閉ドア(P10・食堂の出入口)。steelと同様
//     locked:false だが可動扉として扱う(施錠なし・常時operable・見た目だけ号室プレートなし)。
// EVシャフトは kind:'solid' の塊が既に全面を塞ぐため除外。
// その他の共用部(エントランス等)や屋内階段は locked:false/steel/common無しなので
// 生成されない(=開口のまま)。
function doorBlockerBoxes(floor, boxes) {
  for (const room of floor.rooms) {
    if (room.kind === 'elevator') continue;
    if (!room.door || !(room.door.locked || room.door.steel || room.door.common)) continue;
    const [px, pz] = room.door.pos;
    const horiz = room.door.facing === 'N' || room.door.facing === 'S';
    boxes.push({
      cx: px, cz: pz,
      w: horiz ? GEOM.DOOR_W : T,
      d: horiz ? T : GEOM.DOOR_W,
      kind: 'door',
      roomId: room.id,
    });
  }
}

// 1フロア分の壁ボックス一覧(描画・衝突・テスト共通のソース)
export function floorWallBoxes(floor) {
  const boxes = [];
  for (const room of floor.rooms) {
    if (room.kind === 'elevator') {
      // EVシャフトは塊(全面衝突・侵入不可)
      const [x, z, w, d] = room.rect;
      boxes.push({ cx: x + w / 2, cz: z + d / 2, w, d, kind: 'solid' });
      continue;
    }
    roomWallBoxes(room, boxes);
  }
  perimeterBoxes(floor, boxes);
  fillWallBoxes(floor, boxes);
  doorBlockerBoxes(floor, boxes);
  return boxes;
}
