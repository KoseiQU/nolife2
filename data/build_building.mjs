// build_building.mjs — DESIGN.md §4 の階別インベントリと §2 の実物確定コア位置から
// data/building.json を生成する Node スクリプト。
// 座標系: x=東, z=南, y=上, 単位メートル。原点=西棟北西角(1F基準)。
// 使い方: node data/build_building.mjs
//
// このスクリプトが唯一の建物データの真実。building.json は手書きしない。
// 壁ボックス生成は src/walls.js を level.js と共用し、生成時に全階の
// flood-fill閉じ込めテスト(外周漏れ検査)を assert する。
//
// === P7/P10 コア改修(DESIGN §2「EV＋階段の位置 2026-07-05 実物確定/再確認」に準拠) ===
//  - EVホール = L字の入隅(交差点)の小ホール。縦廊下(西棟中廊下)の南端 ∩ 横廊下(南棟)の西端。
//      北=縦廊下 / 東=横廊下 / 南=EV(扉北向き) / 西=外階段の鉄扉(扉東向き・EVホールの西壁=EVのすぐ隣)
//  - P10(2026-07-05再確認): 鉄扉はEVホールの西壁(x=6.0・EV扉から約1m)に直接付く。
//      旧P7時点の「x=0まで6m歩く袋小路」は廃止。ホールに立つと南=EV扉・西=鉄扉が同時に見える。
//  - 主階段は「外階段」化: 鉄扉のすぐ西(x=3.4..6.0)の屋外踊り場に鉄骨ジグザグ階段が付く。
//      屋外部分は build_building では extLanding として footprint に加え(屋外の歩行可能領域)、
//      level.js が鉄骨踊り場+折返し階段+手すりを手続き生成する。
//  - 8Fには外階段の鉄扉が存在しない(§2「あるはずの扉が無い」)。北階段(屋内・1〜3F)は存続。
//  - 号室配置は図面が正(§2 v4.1 訂正)。東列は北→南に降順(410が北端)。「410を出るとEVが
//    真正面」は縦廊下南端突き当たりにEVがある構図の意味で、410がEV隣接という意味ではない。

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { floorWallBoxes } from '../src/walls.js';
import { unitInterior, commonInterior, balconyOf } from '../src/interior_layout.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- 幾何パラメータ ----
const ROOM_W = 2.9;   // 居室間口
const ROOM_D = 6.0;   // 居室奥行
const CORR_W = 1.8;   // 廊下幅
const FLOOR_H = 2.9;  // 階高
const CEIL_H = 2.4;   // 天井高

// ---- 西棟(南北方向・中廊下) ----
// 西列居室 x=0..6.0 / 中廊下(縦廊下) x=6.0..7.8 / 東列居室 x=7.8..13.8
const WEST_CORR_X0 = ROOM_D;                  // 6.0
const WEST_CORR_X1 = ROOM_D + CORR_W;         // 7.8
const EAST_COL_X0 = WEST_CORR_X1;             // 7.8
const WEST_WING_X1 = 2 * ROOM_D + CORR_W;     // 13.8
const WEST_ROOMS_MAX = 7;
const WEST_WING_Z1 = WEST_ROOMS_MAX * ROOM_W; // 20.3 (西棟南端。居室は南端そろえ)
const VCORR_CX = (WEST_CORR_X0 + WEST_CORR_X1) / 2; // 6.9 縦廊下中心

// ---- 南棟(東西方向・片廊下。廊下北・居室南面) ----
const SOUTH_CORR_Z0 = WEST_WING_Z1;               // 20.3
const SOUTH_CORR_Z1 = SOUTH_CORR_Z0 + CORR_W;     // 22.1
const SOUTH_ROOM_Z0 = SOUTH_CORR_Z1;              // 22.1
const SOUTH_ROOM_Z1 = SOUTH_ROOM_Z0 + ROOM_D;     // 28.1
const HCORR_CZ = (SOUTH_CORR_Z0 + SOUTH_CORR_Z1) / 2; // 21.2 横廊下中心

// ---- コア = L字入隅のEVホール(実物確定・全階同一座標) ----
// EVホール = 縦廊下 ∩ 横廊下 の交差セル: x=6.0..7.8, z=20.3..22.1。
//   北=縦廊下 / 東=横廊下(南棟へ続く) / 西=鉄扉(ホール西壁・EVのすぐ隣) / 南=EVシャフト。
// EVシャフト: ホールの南、縦廊下軸上。x=6.0..7.8(幅1.8), z=22.1..24.0(奥行1.9)。扉北=ホール側。
const EV_RECT = [WEST_CORR_X0, SOUTH_ROOM_Z0, CORR_W, 1.9]; // [6.0, 22.1, 1.8, 1.9]
const EV_DOOR = [VCORR_CX, SOUTH_ROOM_Z0];                  // [6.9, 22.1] facing N(ホール側)

// P10(§2 2026-07-05再確認): 鉄扉=EVの「すぐ隣」。EVホールの西壁(x=6.0・EV扉から約1m)に
// 東向きの鉄扉を付け、旧来の「x=0まで6m歩く袋小路」を廃止する。ホールに立つと
// 南=EV扉・西=鉄扉が同時に視界に入る(実物写真準拠)。
const EXT_DOOR_POS = [WEST_CORR_X0, HCORR_CZ];              // [6.0, 21.2] facing E(ホール西壁)

// 主階段(外階段)の room 矩形は「屋外の鉄骨踊り場」= 鉄扉のすぐ西(x=3.4..6.0)に置く。
// 西面のまま(建物の外)・鉄扉の目の前。旧・袋小路領域(x=0..6, z=20.3..22.1の屋内廊下)は
// footprintから削除し、屋外の踊り場のみを歩行可能領域として残す。
// P11②: 踊り場の窮屈さ解消。旧 2.6×1.8m → 3.4×2.8m へ拡大(屋外なので居室と干渉しない)。
//   東辺は EVホール西壁(x=6.0)に接する制約(assert b2)を維持 → x0 = 6.0 - 3.4 = 2.6。
//   北辺は建物の横廊下ライン(z=20.3)に flush、深さ2.8mは南へ延ばす(z=20.3..23.1。
//   x=2.6..6.0 の屋外空間でEVシャフト(x≥6.0)・南棟居室(x≥7.8)と重ならない)。
const EXT_LANDING_W = 3.4;
// P3a(図面照合): 外階段の箱は図面で EV の西 x≈2.6..6.0、z≈20.3..24.8(角が欠けた矩形)。旧 2.8m は踊り場だけ
// だったので、折返し階段(2レーン)と中間踊り場まで含む 4.5m に延ばす。屋外の歩ける床は北端の踊り場(1.45m)だけで、
// 階段の上り下りは src/stairs.js の移動(STAIR_GEOM)が担う。
const EXT_LANDING_D = 4.5;
const MST_RECT = [WEST_CORR_X0 - EXT_LANDING_W, SOUTH_CORR_Z0, EXT_LANDING_W, EXT_LANDING_D]; // [2.6, 20.3, 3.4, 2.8]
const MST_DOOR = [...EXT_DOOR_POS]; // 鉄扉 = 主階段の「入口」(nav/stairFronts はこの door.pos を使う)

// ---- 南棟居室・東ブロックの開始x(縦廊下の東=7.8から。EVホールと重ならない) ----
const SOUTH_ROOM_X0 = EAST_COL_X0; // 7.8

// ---- 東ブロック(南棟の東半分の北側。居室北面・南側廊下接続) ----
const EAST_BLK_Z0 = SOUTH_CORR_Z0 - ROOM_D;  // 14.3
// P3a(図面照合 2026-10-31): 図面 1〜6F では東ブロック(222-220 / 419-417 等)は南棟の東半分の真北に載り、
// 西端は南棟の4室目の西端より約0.8m東(図面 2-3F: 南棟西端から 150px ≒ 3.27室)。東端は南棟東端より約0.8m東に出る。
// 旧データは南棟の東端のさらに東(x=25.2〜)に置いていた(廊下が約9m長すぎた)。
const EAST_BLK_X0 = EAST_COL_X0 + 3 * ROOM_W + 0.8;  // 17.3

// ---- 北階段(P3a-2 2026-11-01 ユーザー訂正: 屋外の鉄骨階段・2F/3F→1F の地面) ----
// 2F・3F: 縦廊下の北端の東壁(213/313 の北)に鉄扉 → 屋外の通路(213/313 の北、x=7.8..13.8)→ 西棟の東の外にある
// 鉄骨の折返し階段(x=13.8..19.4。主外階段と同じ部品)。下は 1F の地面(建物の北東の屋外。建物へ戻る入口はない)。
// 1F の屋内からは北階段へつながらない(旧 1F の扉は撤去。その位置は地下への階段=BST)。
const NST_GALLERY = [EAST_COL_X0, 0, WEST_WING_X1 - EAST_COL_X0, ROOM_W];   // 2F・3F の屋外通路 [7.8, 0, 6.0, 2.9]
const NST_RECT = [WEST_WING_X1, 0, 5.6, ROOM_W];                               // 鉄骨階段の箱 [13.8, 0, 5.6, 2.9]
const NST_DOOR = [EAST_COL_X0, 0.725];  // 鉄扉(縦廊下の東壁・北端。旧北階段の扉と同じ位置)
// ---- 地下への階段(P3a-2 異世界要素: 1F 食堂奥の図面の階段記号の位置=旧北階段の 1F) ----
// 屋内の折返し階段で 1 層下り、踊り場(階キー 'B1')の西壁に施錠された鉄扉(開かない。地下の中身は P5)。
const BST_RECT = [EAST_COL_X0, 0, 6.0, ROOM_W];   // [7.8, 0, 6.0, 2.9]
const BST_OPEN = [EAST_COL_X0, 1.45];             // 北の通路(縦廊下の延長)からの開口(扉なし)
const BST_DOOR = [EAST_COL_X0, 1.45];             // 地下の踊り場の施錠扉(西壁)

// =========================================================================
// 階別インベントリ (DESIGN.md §4 の表 = 図面が正)
// §2 v4.1 訂正: 号室配置は図面どおり。東列は北→南に降順(配列先頭=北端)。
//   例 4F東列: [410,409,408,407,406] → 410 が北端(初期P1と同じ)。
//   「410を出るとEVが真正面」は「縦廊下の南端突き当たりにEVがあり廊下のどこからでも
//    正面に見える」という構図の意味であって、410がEV隣接という意味ではない。
// =========================================================================
const INVENTORY = {
  1: {
    westWest: ['101', '102', '103'],
    westEast: ['106', '105', '104'],
    south: [],          // 共用部(シアター・メール・エントランス・管理室)
    east: ['109', '108', '107'],
  },
  2: {
    westWest: ['201', '202', '203', '204', '205', '206', '207'],
    westEast: ['213', '212', '211', '210', '209', '208'],
    south: ['214', '215', '216', '217', '218', '219'],
    east: ['222', '221', '220'],
  },
  3: {
    westWest: ['301', '302', '303', '304', '305', '306', '307'],
    westEast: ['313', '312', '311', '310', '309', '308'],
    south: ['314', '315', '316', '317', '318', '319'],
    east: ['322', '321', '320'],
  },
  4: {
    westWest: ['401', '402', '403', '404', '405'],
    westEast: ['410', '409', '408', '407', '406'], // 410が北端(図面どおり)
    south: ['411', '412', '413', '414', '415', '416'],
    east: ['419', '418', '417'],
  },
  5: {
    westWest: ['501', '502', '503', '504'],
    westEast: ['508', '507', '506', '505'],
    south: ['509', '510', '511', '512', '513', '514'],
    east: ['516', '515'],
  },
  6: {
    westWest: ['601', '602'],
    westEast: ['604', '603'],
    south: ['605', '606', '607', '608', '609'],
    east: ['611', '610'],
  },
  7: {
    westWest: [],
    westEast: [],
    south: ['701', '702', '703', '704', '705'], // 図面確定
    east: [],
  },
};

// =========================================================================
// P3b: 入れる部屋(DESIGN §2「約30室」・§2.3)。選定は docs/p3b/NOTES.md の表。各階 3〜5 室(角部屋・東ブロック・南棟・7F を含め
// 向きと階が偏らないように)。410(自室)と 401(屋上A から回れる)は必須。1F は食堂・シアター・管理室も(内装つき)。
// 残りは施錠扉のまま(開かないが実在感のある扉)。全居室にバルコニー(入れない部屋のバルコニーは外から見える形だけ)。
// =========================================================================
export const ENTERABLE = {
  1: ['103', '104', '109', 'OFFICE'],
  2: ['201', '210', '216', '222'],
  3: ['305', '313', '319', '321'],
  4: ['401', '404', '410', '413', '418'],
  5: ['501', '506', '511', '516'],
  6: ['602', '603', '607', '610'],
  7: ['701', '703', '705'],
};
// 屋上A(DESIGN §2.3): 3F 棟の屋根(4F 床レベル)。401/410 の北側＋3F の西列のバルコニーの上(図面 4F の薄い外形)。
// 410・401 のバルコニー北端の室外機を踏み台に乗り越える(解放フラグ roofA。P5 で条件を決める)。
// P3b-2: 410 の台はコンクリートの踏み台 → 室外機(隔て板の手前に背を付け、正面=吹き出しをバルコニー側へ。乗る→越える→降りる)。
//  step = 室外機の矩形 [x0,z0,x1,z1](当たり・見た目・乗る位置)、stepTop = 天板の高さ(床から)、over = 越えた先/戻る先の立ち位置
const ROOF_A = {
  rects: [[-1.0, 0, 8.8, 5.8], [7.8, 2.9, 7.0, 2.9]],    // 西(401 の北・縦廊下の北・3F 西列のバルコニーの上)と東(410 の北)
  gates: [
    { id: 'gate410', room: '410', rect: [13.8, 5.74, 1.0, 0.12], side: 'balcony', step: [13.93, 5.9, 14.71, 6.2], stepTop: 0.6, stepFront: '+z', over: { from: [14.3, 6.78], to: [14.3, 5.3] } },
    { id: 'gate401', room: '401', rect: [-1.0, 5.74, 1.0, 0.12], side: 'balcony', step: [-0.92, 6.0, -0.12, 6.36], stepTop: 0.55, over: { from: [-0.5, 6.75], to: [-0.5, 5.3] } },
  ],
  // 屋上の室外機(4F の北の外壁際。台座込み)と通気管。当たり(高さ h)と見た目(build_rooms.build_roof_a)が同じ数値を使う
  obstacles: [
    { id: 'ra_ac0', rect: [1.16, 5.34, 0.9, 0.4], h: 0.62 },
    { id: 'ra_ac1', rect: [2.36, 5.34, 0.9, 0.4], h: 0.62 },
    { id: 'ra_ac2', rect: [9.36, 5.34, 0.9, 0.4], h: 0.62 },
    { id: 'ra_vent', rect: [4.38, 1.18, 0.19, 0.19], h: 0.95 },
  ],
};

// =========================================================================
// 居室生成
// =========================================================================

// 西棟西列: x=0..6。南端(z=20.3)そろえで北へ。番号は北→南(配列先頭=北)。
function westWestRooms(ids) {
  const n = ids.length;
  if (n === 0) return [];
  const z0 = WEST_WING_Z1 - n * ROOM_W;
  return ids.map((id, i) => {
    const z = z0 + i * ROOM_W;
    return {
      id, kind: 'unit',
      rect: [0, z, ROOM_D, ROOM_W],
      door: { pos: [WEST_CORR_X0, z + ROOM_W / 2], facing: 'E', locked: true },
    };
  });
}

// 西棟東列: x=7.8..13.8。番号は北→南(配列先頭=北端=410)。図面どおり(§2 v4.1)。
function westEastRooms(ids) {
  const n = ids.length;
  if (n === 0) return [];
  const z0 = WEST_WING_Z1 - n * ROOM_W;
  return ids.map((id, i) => {
    const z = z0 + i * ROOM_W;
    return {
      id, kind: 'unit',
      rect: [EAST_COL_X0, z, ROOM_D, ROOM_W],
      door: { pos: [WEST_CORR_X1, z + ROOM_W / 2], facing: 'W', locked: true },
    };
  });
}

// 南棟: 居室南面。縦廊下の東 x=7.8 から西→東。
function southRooms(ids) {
  return ids.map((id, i) => {
    const x = SOUTH_ROOM_X0 + i * ROOM_W;
    return {
      id, kind: 'unit',
      rect: [x, SOUTH_ROOM_Z0, ROOM_W, ROOM_D],
      door: { pos: [x + ROOM_W / 2, SOUTH_CORR_Z1], facing: 'N', locked: true },
    };
  });
}

// 南棟居室の東端x(南棟0室の階は6室ぶんで代用=面一の東ブロック接続)
function southRoomsX1(southCount) {
  return SOUTH_ROOM_X0 + (southCount > 0 ? southCount : 6) * ROOM_W;
}

// 東ブロック: 南棟の東半分の北側(P3a 図面照合)。西→東。5F/6F は西の2室ぶんだけ(東の1室ぶんは屋根)。
function eastRooms(ids) {
  const xStart = EAST_BLK_X0;
  return ids.map((id, i) => {
    const x = xStart + i * ROOM_W;
    return {
      id, kind: 'unit',
      rect: [x, EAST_BLK_Z0, ROOM_W, ROOM_D],
      door: { pos: [x + ROOM_W / 2, SOUTH_CORR_Z0], facing: 'S', locked: true },
    };
  });
}

// 縦動線(EV・外階段・北階段)
function coreRooms(level) {
  const rooms = [];
  // EVシャフト(全階同一座標・閉扉)。扉は北=EVホール側。
  rooms.push({
    id: `EV${level}`, kind: 'elevator',
    rect: [...EV_RECT],
    door: { pos: [...EV_DOOR], facing: 'N', locked: true },
  });
  // 外階段(1〜7F。8Fには鉄扉が無い=§2)。鉄扉=EVホール西壁の東向き(EVのすぐ隣)。
  //  - room矩形は屋外の踊り場(鉄扉のすぐ西=x=3.4..6.0)。扉板は EXT_DOOR_POS の
  //    東向き鉄扉(steel・operable)。
  //  - connects で吹き抜け相当(level.js が屋外の折返し階段を上階へ生成)。
  if (level <= 7) {
    rooms.push({
      id: `MST${level}`, kind: 'stair', external: true,
      rect: [...MST_RECT],
      door: { pos: [...MST_DOOR], facing: 'E', locked: false, steel: true, operable: true },
      connects: level < 7 ? [level, level + 1] : [level],
    });
  }
  // 北階段(P3a-2: 屋外の鉄骨階段)。2F・3F は鉄扉(縦廊下側=西)→屋外通路→階段。1F は地面だけ(部屋も扉も無い)
  if (level === 2 || level === 3) {
    rooms.push({
      id: `NST${level}`, kind: 'stair', external: true,
      rect: [NST_GALLERY[0], 0, NST_GALLERY[2] + NST_RECT[2], ROOM_W],   // 通路＋階段の箱(外周の当たり)
      door: { pos: [...NST_DOOR], facing: 'W', locked: false, steel: true, operable: true },
      connects: level < 3 ? [level - 1, level, level + 1] : [level - 1, level],
    });
  }
  // 地下への階段(1F)。北の通路から扉なしの開口で入る
  if (level === 1) {
    rooms.push({
      id: 'BST', kind: 'stair',
      rect: [...BST_RECT],
      openings: [{ side: 'W', pos: [...BST_OPEN], width: 1.3 }],
    });
  }
  return rooms;
}

// 1F 南面の共用部の区切り(x)。P3a 図面照合(1F 図面の縮尺 ≈15.2px/m・縦廊下東端=7.8m 基準)
const C1F = {
  theater: [EAST_COL_X0, 14.0],   // シアタールーム(図面 305→400px)
  mail: [14.0, 15.6],             // メールコーナー・宅配BOX(図面 400→425px)
  lobby: [15.6, 19.6],            // ロビー/風除室(図面 425→485px。「正面玄関」の矢印 455px が中央)
  office: [19.6, 22.0],           // 管理室(図面 485→515px)
  windbreakZ: SOUTH_ROOM_Z0 + 3.2, // ロビーと風除室の境(内側の自動ドア)。風除室の奥行 2.8m
  autoDoorW: 1.8,                 // 自動ドアの開口(ガラス2枚)
  mailOpen: [1.4, 2.0],           // メールコーナーの口(風除室の北端からの中心位置, 幅)
};

// 1F共用部(図面: 西棟北端に厨房+食堂、南棟南面は西からシアター/メール/ロビー・風除室/管理室)
function commonAreas1F() {
  const rooms = [];
  // 厨房: 西棟最北西側
  rooms.push({
    id: 'KITCHEN', kind: 'office',
    rect: [0, 0, ROOM_D, 4.35],
    door: { pos: [ROOM_D, 2.175], facing: 'E', locked: true },
  });
  // 食堂: 西棟の幅いっぱい(厨房の南〜居室101/104の北)。
  // 南扉=縦廊下の突き当たり、北開口=北階段方面の通路。
  // P10(DESIGN §2「食堂の出入口にも開閉式のドア」): 主開口(南扉)にだけ開閉式ドアを付ける
  // (common=施錠なし・常時operable・見た目は共用ドア=号室プレートなし)。北開口(通路)は現状維持。
  rooms.push({
    id: 'DINING', kind: 'dining',
    rect: [0, 4.35, WEST_WING_X1, 11.6 - 4.35],
    door: { pos: [VCORR_CX, 11.6], facing: 'S', locked: false, common: true },
    openings: [{ side: 'N', pos: [VCORR_CX, 4.35], width: 1.2 }],
  });
  // 南棟南面(西→東)。P3a(図面照合 2026-10-31・写真 entrance_*/mailboxes_1F/lobby_1F_corridor):
  //   シアター(EVの東隣・幅≈6.2m) → メールコーナー(幅≈1.6mの細長い室。風除室の西側に口を開け、西壁に集合ポスト・宅配BOX)
  //   → ロビー(廊下に大きく開いた石目タイルのホール) → 風除室(ロビーの南。内側=北の自動ドア・外側=南の正面玄関の自動ドア。
  //   どちらも透明ガラス2枚が左右反対方向へ開く) → 管理室(幅≈2.4m。風除室の東壁に受付の小窓)。管理室の東は屋外(図面の柱列)。
  //   旧データは4等分(各4.35m)で、メールコーナーが廊下に扉を持っていた。
  rooms.push({
    id: 'THEATER', kind: 'multi',
    rect: [C1F.theater[0], SOUTH_ROOM_Z0, C1F.theater[1] - C1F.theater[0], ROOM_D],
    door: { pos: [C1F.theater[0] + 1.2, SOUTH_CORR_Z1], facing: 'N', locked: false, common: true },
  });
  rooms.push({
    id: 'MAILBOX', kind: 'lobby',
    rect: [C1F.mail[0], SOUTH_ROOM_Z0, C1F.mail[1] - C1F.mail[0], ROOM_D],
    openings: [{ side: 'E', pos: [C1F.mail[1], C1F.windbreakZ + C1F.mailOpen[0]], width: C1F.mailOpen[1] }],
  });
  rooms.push({
    id: 'LOBBY', kind: 'lobby',
    rect: [C1F.lobby[0], SOUTH_ROOM_Z0, C1F.lobby[1] - C1F.lobby[0], C1F.windbreakZ - SOUTH_ROOM_Z0],
    openings: [
      { side: 'N', pos: [(C1F.lobby[0] + C1F.lobby[1]) / 2, SOUTH_ROOM_Z0], width: C1F.lobby[1] - C1F.lobby[0] - 0.4 },
      { side: 'S', pos: [(C1F.lobby[0] + C1F.lobby[1]) / 2, C1F.windbreakZ], width: C1F.autoDoorW },
    ],
  });
  // ENTRANCE = 風除室。内側の自動ドア(北・door)と外側の正面玄関(南・perimOpenings のガラス扉。夜間は閉じたまま)
  rooms.push({
    id: 'ENTRANCE', kind: 'lobby',
    rect: [C1F.lobby[0], C1F.windbreakZ, C1F.lobby[1] - C1F.lobby[0], SOUTH_ROOM_Z1 - C1F.windbreakZ],
    door: { pos: [(C1F.lobby[0] + C1F.lobby[1]) / 2, C1F.windbreakZ], facing: 'N', locked: false, glass: true, common: true, auto: true, width: C1F.autoDoorW },
    openings: [
      { side: 'S', pos: [(C1F.lobby[0] + C1F.lobby[1]) / 2, SOUTH_ROOM_Z1], width: C1F.autoDoorW, glass: true },
      { side: 'W', pos: [C1F.mail[1], C1F.windbreakZ + C1F.mailOpen[0]], width: C1F.mailOpen[1] },
    ],
  });
  rooms.push({
    id: 'OFFICE', kind: 'office',
    rect: [C1F.office[0], SOUTH_ROOM_Z0, C1F.office[1] - C1F.office[0], ROOM_D],
    door: { pos: [(C1F.office[0] + C1F.office[1]) / 2, SOUTH_CORR_Z1], facing: 'N', locked: true },
  });
  return rooms;
}

// 西棟の北端z(セットバック)。1Fは厨房/食堂が最北まで。null=西棟なし(7F)
function westZ0Of(level, inv) {
  if (level === 1) return 0;
  const n = Math.max(inv.westWest.length, inv.westEast.length);
  return n > 0 ? WEST_WING_Z1 - n * ROOM_W : null;
}

// 廊下パス(中心線・navGraph用)。西端=EVホール前(縦廊下との交差点)。
function corridorPath(level, inv, scEnd) {
  const cz = HCORR_CZ;      // 21.2
  const cx = VCORR_CX;      // 6.9
  if (level >= 7) {
    // 南棟のみ。EVホール前(交差点)→南棟東端
    return { type: 'single', width: CORR_W, path: [[cx, cz], [scEnd - 0.5, cz]] };
  }
  const westZ0 = level === 1 ? 11.6 : westZ0Of(level, inv);
  // 縦廊下(西棟北端→交差点) + 横廊下(交差点=EVホール。西壁に鉄扉が隣接するため
  // 鉄扉前の折返しはホール内の一点で足りる。旧・袋小路 x=0.9 の迂回は廃止)
  return {
    type: 'center', width: CORR_W,
    path: [[cx, westZ0 + 0.5], [cx, cz], [WEST_CORR_X0 + 0.2, cz], [cx, cz], [scEnd - 0.5, cz]],
  };
}


// =========================================================================
// P3a: 階の外殻(shell)と階段の形
//  見た目(Blender: tools/blender/build_floor.py)と当たり・移動(src/world.js・stairs.js)が同じ定義を読む。
//  air      … 歩ける(または見える)空気の矩形。重ならない。kind で床・壁・天井の仕上げが決まる
//             corridor/hall=廊下(長尺シート・クロス壁・平天井) / lobby=石目タイル / theater=暗いカーペット /
//             room=共用室 / alcove=EV扉の凹み / outdoor=外階段の踊り場(屋外) / well=階段の吹き抜け(床なし・壁は階高いっぱい)
//             stair=屋内階段の踊り場(壁は階高いっぱい)
//  caps     … 部屋の途中で見た目を切る闇の板(410 の玄関の先。P0 と同じ)
//  windows  … 夜空の窓(発光面) / lights … 灯具 / exits … 非常口サイン
// =========================================================================
const STAIR_RISE = FLOOR_H / 2;          // 1.45(折返し階段の1折れ分)
const STAIR_TREADS = 7;                  // 踏面 7(蹴上げ 8 段 × 0.181m)
const STAIR_TREAD = 0.26;
// 外階段(西外壁の鉄骨ジグザグ)。流れは南北(z)。西レーン=上り(踊り場→中間踊り場)、東レーン=下り(鉄扉の正面。写真 outer_stairs_2)
const MST_GEOM = (() => {
  const [x, z, w, d] = MST_RECT;
  const s0 = z + 1.45;                       // 階の踊り場(屋外の床)の南端 = 段の始まり
  const s1 = s0 + STAIR_TREADS * STAIR_TREAD;  // 段の終わり = 中間踊り場の北端
  return {
    axis: 'z', landing: [x, z, w, s0 - z], mid: [x, s1, w, z + d - s1], s0, s1,
    lanes: { up: [x, x + 1.6], down: [x + w - 1.6, x + w] },
    guard: [x, s0 + 0.3, w, z + d - s0 - 0.3],     // 階の床の高さで階段側へ踏み出さない当たり
    mouthDepth: 0.6,                               // 段の手前のこの奥行に入って進むと上り下り
  };
})();
// 北階段(P3a-2: 屋外の鉄骨・1〜3F)。流れは東西(x)。西端が階の踊り場(2F・3F は屋外通路から入る、1F は地面)。
// 北レーン=下り、南レーン=上り
const stairGeomX = ([x, z, w, d]) => {
  const s0 = x + 1.6, s1 = s0 + STAIR_TREADS * STAIR_TREAD;
  return {
    axis: 'x', landing: [x, z, s0 - x, d], mid: [s1, z, x + w - s1, d], s0, s1,
    lanes: { up: [z + 1.55, z + d - 0.1], down: [z + 0.1, z + 1.35] },
    guard: [s0 + 0.3, z, x + w - s0 - 0.3, d],
    mouthDepth: 0.6,
  };
};
const NST_GEOM = stairGeomX(NST_RECT);
// 地下への階段(屋内・1F→B1)。北の通路から西端の踊り場に入り、北レーンを下る(B1 には南レーンで着く)
const BST_GEOM = stairGeomX(BST_RECT);

// 階の隠れ場所(管理人の潜伏 LURK)。4F は P0 の 4 か所(src/enemy_ai.js の HIDE_SPOTS と同一)を先頭に保つ
// P3b: 410 は内装が入ったので「奥の角」は玄関の先の廊下(トイレの扉の前・暗がり)に。各階 1 つ、入れる空室の奥にも潜む
const ROOM_LURK = { 1: '104', 2: '222', 3: '305', 5: '511', 6: '610', 7: '703' };
function hideSpotsFor(level, zTop, scEnd, rooms = []) {
  const spots = [];
  if (level === 4) {
    spots.push({ id: 'r410_back', area: 'R', room: '410', x: 9.4, z: 7.5, faceTo: [7.8, 7.25] });
    spots.push({ id: 'r410_door_shadow', area: 'R', room: '410', x: 8.16, z: 6.2, faceTo: [8.7, 7.6] });
    spots.push({ id: 'corridor_north', area: 'C', x: 6.32, z: 6.2, faceTo: [6.9, 9.5] });
    spots.push({ id: 'ev_blind', area: 'C', x: 8.38, z: 21.72, faceTo: [6.9, 21.2] });
  } else {
    if (zTop !== null) spots.push({ id: `L${level}_corr_north`, area: 'C', x: 6.32, z: zTop + 0.4, faceTo: [6.9, zTop + 3.7] });
    spots.push({ id: `L${level}_ev_blind`, area: 'C', x: 8.38, z: 21.72, faceTo: [6.9, 21.2] });
  }
  spots.push({ id: `L${level}_corr_east`, area: 'C', x: scEnd - 0.4, z: 20.72, faceTo: [scEnd - 4.0, 21.2] });
  const lr = rooms.find((r) => r.id === ROOM_LURK[level]);
  if (lr && lr.interior) {
    const [x, z] = lr.interior.points.living;
    const [ex, ez] = lr.interior.points.entry;
    spots.push({ id: `L${level}_room_${lr.id}`, area: 'R', room: lr.id, x, z, faceTo: [ex, ez] });
  }
  if (level === 1) {
    spots.push({ id: 'L1_dining_corner', area: 'C', x: 5.85, z: 5.3, faceTo: [6.9, 11.0] });   // P3b: 配膳カウンターの端(通路の角)
    spots.push({ id: 'L1_theater_back', area: 'C', x: 9.4, z: 27.4, faceTo: [9.0, 22.6] });     // P3b: スクリーンの脇(通路の奥)
  }
  return spots.map((h) => ({ ...h, level }));
}

// 屋上B(DESIGN §2.3 2026-10-31 追記): 7F の外階段をさらに1層上がった最上階の屋根(7F床＋階高)。屋外のまま出る。
// 当たりは walls.js をそのまま使える「疑似階」(key 'RB')として持つ: footprint の外周=パラペット、obstacles=機械室などの箱。
// 見た目は 7F の GLB に含める(build_floor.py)。
function buildRoofB(f7) {
  const fp = f7.footprint.filter((r) => !(r[0] === MST_RECT[0] && r[1] === MST_RECT[1]));   // 7F の屋内(廊下・EV・南棟)
  const xs = fp.map((r) => r[0] + r[2]);
  const xEnd = Math.max(...xs);
  const obstacles = [
    { id: 'ev_machine', rect: [WEST_CORR_X0, SOUTH_ROOM_Z0, CORR_W, EV_RECT[3]], h: 2.6 },     // EV 機械室(シャフトの上)
    { id: 'water_tank', rect: [xEnd - 2.6, SOUTH_ROOM_Z0 + 2.4, 2.0, 2.2], h: 1.9 },          // 受水槽の箱
    { id: 'hatch', rect: [12.4, SOUTH_ROOM_Z0 + 1.2, 0.9, 0.9], h: 0.55 },                    // 点検口
  ];
  for (let i = 0; i < 5; i++) obstacles.push({ id: `ac_${i}`, rect: [9.2 + i * 2.2, SOUTH_ROOM_Z1 - 0.62, 0.85, 0.36], h: 0.72 });   // 室外機(南のパラペット沿い)
  const air = [
    { id: 'landing', rect: [...MST_GEOM.landing], kind: 'outdoor' },
    { id: 'mst_well', rect: [MST_RECT[0], MST_GEOM.s0, MST_RECT[2], MST_RECT[1] + MST_RECT[3] - MST_GEOM.s0], kind: 'well', outdoor: true },
    ...fp.filter((r) => !(r[0] === EV_RECT[0] && r[1] === EV_RECT[1])).map((r, i) => ({ id: `roof_${i}`, rect: [...r], kind: 'roof' })),
  ];
  for (const o of obstacles) o.rect = o.rect.map((v) => +v.toFixed(4));
  return {
    key: 'RB', baseLevel: 7, y: +(7 * FLOOR_H).toFixed(4), parapetH: 0.75, railH: 1.1,
    footprint: [...fp, [...MST_RECT]], rooms: [], fillWalls: [], obstacles, air,
    spawn: [WEST_CORR_X0 + 1.2, HCORR_CZ],
  };
}

// 地下の踊り場(P3a-2): 階キー 'B1'(1F 床 − 階高)。当たりは walls.js をそのまま使える「疑似階」。
// 部屋 = 階段の箱そのもの(4 壁の内面が 1F の BST と同じ)。西壁の鉄扉は施錠(開かない・P5 で中身を決める)。
// 見た目は 1F の GLB に含める(build_floor.py build_basement_stair)。
function buildBasement() {
  return {
    key: 'B1', baseLevel: 1, y: -FLOOR_H,
    footprint: [[...BST_RECT]],
    rooms: [{ id: 'B1DOOR', kind: 'stair', rect: [...BST_RECT], door: { pos: [...BST_DOOR], facing: 'W', locked: true, steel: true, sealed: true } }],
    fillWalls: [], obstacles: [],
    air: [
      { id: 'b1_landing', rect: [...BST_GEOM.landing], kind: 'room' },
      { id: 'b1_well', rect: [BST_GEOM.s0, BST_RECT[1], BST_RECT[0] + BST_RECT[2] - BST_GEOM.s0, BST_RECT[3]], kind: 'bwell' },
    ],
    spawn: [EAST_COL_X0 + 1.0, 2.2],
  };
}

function shellFor(level, inv, scEnd, rooms) {
  const zTop = level === 1 ? 11.6 : (level <= 6 ? westZ0Of(level, inv) : null);
  const air = [];
  const A = (id, rect, kind, extra = {}) => air.push({ id, rect: rect.map((v) => +v.toFixed(4)), kind, ...extra });
  if (zTop !== null) A('corridor', [WEST_CORR_X0, zTop, CORR_W, WEST_WING_Z1 - zTop], 'corridor');
  A('hall', [WEST_CORR_X0, SOUTH_CORR_Z0, CORR_W, CORR_W], 'hall');
  if (level === 1) {
    A('corridor_h1', [EAST_COL_X0, SOUTH_CORR_Z0, C1F.mail[0] - EAST_COL_X0, CORR_W], 'corridor');
    A('lobby_front', [C1F.mail[0], SOUTH_CORR_Z0, C1F.office[0] - C1F.mail[0], CORR_W], 'lobby');
    A('corridor_h2', [C1F.office[0], SOUTH_CORR_Z0, scEnd - C1F.office[0], CORR_W], 'corridor');
  } else {
    A('corridor_h', [EAST_COL_X0, SOUTH_CORR_Z0, scEnd - EAST_COL_X0, CORR_W], 'corridor');
  }
  const ev = rooms.find((r) => r.kind === 'elevator');
  const evCx = ev.door.pos[0] + 0.2;   // walls.js evOpeningCenter(facing N: +x へ EV_OPEN_SHIFT)
  A('ev_alcove', [evCx - 0.5, SOUTH_ROOM_Z0, 1.0, 0.27], 'alcove');
  A('landing', MST_GEOM.landing, 'outdoor');
  A('mst_well', [MST_RECT[0], MST_GEOM.s0, MST_RECT[2], MST_RECT[1] + MST_RECT[3] - MST_GEOM.s0], 'well', { outdoor: true });
  if (level <= 3) {
    // 北階段(屋外の鉄骨)。2F・3F は鉄扉の外に屋外通路(gallery)。1F は地面(ground)
    if (level >= 2) A('nst_gallery', NST_GALLERY, 'gallery', { outdoor: true });
    A('nst_landing', NST_GEOM.landing, level === 1 ? 'ground' : 'outdoor', { outdoor: true });
    A('nst_well', [NST_GEOM.s0, NST_RECT[1], NST_RECT[0] + NST_RECT[2] - NST_GEOM.s0, NST_RECT[3]], 'well', { outdoor: true });
  }
  if (level === 1) {
    A('dining', [0, 4.35, WEST_WING_X1, 11.6 - 4.35], 'room');
    A('north_passage', [WEST_CORR_X0, 0, CORR_W, 4.35], 'corridor');
    A('north_nook', [EAST_COL_X0, BST_RECT[3], WEST_WING_X1 - EAST_COL_X0, 4.35 - BST_RECT[3]], 'corridor');
    // 地下への階段(1F の部分): 踊り場は館内と同じ仕上げ、下り口から先は床なし(bwell。天井は 1F の天井高)
    A('bst_landing', BST_GEOM.landing, 'room');
    A('bst_well', [BST_GEOM.s0, BST_RECT[1], BST_RECT[0] + BST_RECT[2] - BST_GEOM.s0, BST_RECT[3]], 'bwell');
    A('theater', [C1F.theater[0], SOUTH_ROOM_Z0, C1F.theater[1] - C1F.theater[0], ROOM_D], 'theater');
    A('mail', [C1F.mail[0], SOUTH_ROOM_Z0, C1F.mail[1] - C1F.mail[0], ROOM_D], 'lobby');
    A('lobby', [C1F.lobby[0], SOUTH_ROOM_Z0, C1F.lobby[1] - C1F.lobby[0], C1F.windbreakZ - SOUTH_ROOM_Z0], 'lobby');
    A('windbreak', [C1F.lobby[0], C1F.windbreakZ, C1F.lobby[1] - C1F.lobby[0], SOUTH_ROOM_Z1 - C1F.windbreakZ], 'lobby');
  }
  const caps = [];   // P3b: 410 の闇の板は撤去(居室の内装を作った)
  // P3b: 入れる部屋・バルコニー・屋上A の空気(Blender の build_rooms.py が内装・外装を作る。外殻の壁の生成とは別の組)
  const roomAir = [];
  for (const r of rooms) {
    if (!(r.door && r.door.enterable)) continue;
    if (r.kind === 'unit' || r.id === 'OFFICE') roomAir.push({ id: r.id, rect: r.rect.map((v) => +v.toFixed(4)), kind: 'unit' });
    if (r.balcony) roomAir.push({ id: 'bal_' + r.id, rect: [...r.balcony.rect], kind: 'balcony', outdoor: true });
  }
  if (level === 4) ROOF_A.rects.forEach((rr, i) => roomAir.push({ id: 'roofA_' + i, rect: [...rr], kind: 'roofA', outdoor: true }));
  // 窓(夜空の発光面)。pos=壁面上の中心、facing=室内側への法線
  const windows = [];
  if (zTop !== null && level !== 1) windows.push({ pos: [VCORR_CX, zTop], facing: 'S', w: 0.75, h: 0.9, sill: 1.15 });
  windows.push({ pos: [scEnd, HCORR_CZ], facing: 'W', w: 0.75, h: 0.9, sill: 1.15 });
  if (level === 1) for (const z of [5.6, 8.0, 10.4]) windows.push({ pos: [0, z], facing: 'E', w: 1.5, h: 1.3, sill: 0.85 });
  // 灯具(廊下の常夜灯は corridor.path から Blender 側で 6.5m おきに置く=P0 と同じ。ここはそれ以外)
  const lights = [];
  lights.push({ kind: 'bracket', pos: [WEST_CORR_X0 - 0.06, SOUTH_CORR_Z0 + 0.3], y: 2.3, facing: 'W' });   // 外階段の踊り場(鉄扉の脇の壁)
  // 北階段(屋外): 2F・3F は通路の 213/313 の北壁、1F は地面の脇の建物の東壁に壁付け灯
  if (level === 2 || level === 3) lights.push({ kind: 'bracket', pos: [WEST_WING_X1 - 0.9, ROOM_W - 0.06], y: 2.3, facing: 'N' });
  if (level === 1) {
    lights.push({ kind: 'bracket', pos: [WEST_WING_X1 + 0.06, 1.45], y: 2.3, facing: 'E' });
    lights.push({ kind: 'down', pos: [EAST_COL_X0 + 0.8, 1.45] });   // 地下への階段の踊り場(1F)
  }
  if (level === 1) {
    // P3a-2: 風除室は2列×2(写真 entrance_windbreak・entrance_outside)、ロビーは2灯、メールコーナー2灯、ロビー前の廊下2灯
    // 夜でも明るい(写真は夜の撮影): ロビー・風除室・メールコーナーの灯具は廊下の常夜灯より強い
    for (const [x, z] of [[16.6, 23.4], [18.6, 23.4], [16.5, 26.0], [18.7, 26.0], [16.5, 27.5], [18.7, 27.5], [14.8, 24.2], [14.8, 26.9]]) lights.push({ kind: 'down', pos: [x, z], energy: 4.5 });
    for (const [x, z] of [[15.8, 21.2], [18.4, 21.2]]) lights.push({ kind: 'down', pos: [x, z] });
  }
  // 非常口サイン(鉄扉・防火扉・共用室の出口の上。屋内側)
  const exits = [];
  for (const r of rooms) {
    if (!r.door) continue;
    if (r.door.steel && r.id.startsWith('NST')) exits.push({ room: r.id, pos: [...r.door.pos], facing: 'E' });   // 縦廊下側から見る
  }
  if (level === 1) {
    exits.push({ room: 'DINING', pos: [VCORR_CX, 11.6], facing: 'N', inside: true });
    exits.push({ room: 'THEATER', pos: [C1F.theater[0] + 1.2, SOUTH_ROOM_Z0], facing: 'S', inside: true });
  }
  // ゲーム内で開閉できる扉(それ以外の扉は施錠のまま開かない)
  const operable = rooms.filter((r) => r.door && (r.door.steel || r.door.common || r.door.enterable)).map((r) => r.id);
  return {
    zTop, air, caps, windows, lights, exits, operable, roomAir,
    hideSpots: hideSpotsFor(level, zTop, scEnd, rooms),
    hall: [WEST_CORR_X0, SOUTH_CORR_Z0, CORR_W, CORR_W],
  };
}

// =========================================================================
// フロア生成
// =========================================================================
function buildFloor(level) {
  const inv = INVENTORY[level];
  const rooms = [];
  rooms.push(...westWestRooms(inv.westWest));
  rooms.push(...westEastRooms(inv.westEast));
  rooms.push(...southRooms(inv.south));
  rooms.push(...eastRooms(inv.east));
  if (level === 1) rooms.push(...commonAreas1F());
  rooms.push(...coreRooms(level));
  // P3b: バルコニー(全居室)・入れる部屋(扉を開閉可能に・内装・掃き出し窓)
  const enter = new Set(ENTERABLE[level] || []);
  for (const r of rooms) {
    if (r.kind === 'unit') {
      const gate = ROOF_A.gates.find((g) => g.room === r.id && level === 4);
      r.balcony = balconyOf(r, level, gate ? { lo: 'gate' } : {});
    }
    if (r.id === 'DINING' || r.id === 'THEATER') { r.interior = commonInterior(r); continue; }   // 共用扉のまま、家具だけ
    if (!enter.has(r.id)) continue;
    r.door.locked = false;
    r.door.enterable = true;
    if (r.kind === 'unit') {
      r.interior = unitInterior(r);
      r.window = { ...r.interior.window, operable: true };
    } else {
      r.interior = commonInterior(r);
    }
  }

  const southN = inv.south.length;
  const eastN = inv.east.length;
  const srEnd = southRoomsX1(southN);
  const ebX1 = eastN > 0 ? EAST_BLK_X0 + eastN * ROOM_W : 0;
  // 横廊下の東端: 南棟(居室帯)と東ブロックの東端の大きい方。1F は南の共用部帯が短い(管理室まで)ので東ブロックで決まる
  const scEnd = Math.max(level === 1 ? 0 : srEnd, ebX1);

  // フットプリント(セットバック込み)。外周壁はこの矩形群の露出辺に張られる。
  const footprint = [];
  const westZ0 = westZ0Of(level, inv);
  if (level <= 6 && westZ0 !== null) {
    footprint.push([0, westZ0, WEST_WING_X1, WEST_WING_Z1 - westZ0]); // 西棟
  }
  // 横廊下(西端=EVホール西壁=鉄扉〜東端)。P10: 旧・袋小路(x=0..6, z=20.3..22.1の
  // 屋内廊下)はフットプリントから削除(鉄扉がEVホール隣接になったため不要)。
  footprint.push([WEST_CORR_X0, SOUTH_CORR_Z0, scEnd - WEST_CORR_X0, CORR_W]);
  footprint.push([WEST_CORR_X0, SOUTH_ROOM_Z0, EV_RECT[2], EV_RECT[3]]); // EVシャフト下床(x6.0..7.8)
  if (southN > 0) {
    footprint.push([SOUTH_ROOM_X0, SOUTH_ROOM_Z0, srEnd - SOUTH_ROOM_X0, ROOM_D]); // 南棟居室帯
  }
  // 1F: 共用部の帯(シアター/メール/エントランス/管理室)。southN=0のためここで明示push。
  // これが欠けると廊下南縁の外周壁が全面に立ち、各共用ドアの真後ろが塞がれて
  // 「開くのに通れない自動ドア」(行き止まり)になる(2026-07-05 プレイ報告のバグ)。
  if (level === 1) {
    footprint.push([SOUTH_ROOM_X0, SOUTH_ROOM_Z0, C1F.office[1] - SOUTH_ROOM_X0, ROOM_D]);   // P3a: 管理室の東端まで
  }
  if (eastN > 0) {
    footprint.push([EAST_BLK_X0, EAST_BLK_Z0, eastN * ROOM_W, ROOM_D]); // 東ブロック
  }
  // 屋外の外階段踊り場(西外壁の外側 x<0)。屋外の歩行可能領域(§2)。
  footprint.push([...MST_RECT]);
  // P3a-2: 北階段の鉄骨の箱(西棟の東の外)。1F はその地面(建物の北東の屋外。建物へ戻る入口はない)
  if (level <= 3) footprint.push([...NST_RECT]);

  // フィラー壁: 無し(EVは縦廊下軸上に配置し隙間が出ない)。
  const fillWalls = [];
  // P3b: 入れる部屋のバルコニーは歩ける(外周の壁=手すり・隔て板の当たり)。4F は屋上A も(縦廊下の北端は窓の壁で塞ぐ)
  const gates = [];
  for (const r of rooms) if (r.balcony && r.door && r.door.enterable) footprint.push([...r.balcony.rect]);
  if (level === 4) {
    for (const rr of ROOF_A.rects) footprint.push([...rr]);
    fillWalls.push([WEST_CORR_X0, 5.8, WEST_CORR_X1, 5.8]);
    for (const g of ROOF_A.gates) gates.push({ ...g, rect: [...g.rect] });
  }
  // バルコニーが建物の他の床(廊下など)に接する辺は、外周の壁が「覆われた」扱いで消えるので、隔て板の位置に壁を足す
  // (例: 104・603 のバルコニーの南端と横廊下)。壁の芯はバルコニー側へ半厚(廊下側の面が外周の壁の面と揃う)
  for (const r of rooms) {
    if (!(r.balcony && r.door && r.door.enterable)) continue;
    const [bx, bz, bw, bd] = r.balcony.rect;
    const facadeSide = { E: 'W', W: 'E', S: 'N', N: 'S' }[r.balcony.facing];
    const edges = [['N', bx, bz, bx + bw, bz, 0, -1], ['S', bx, bz + bd, bx + bw, bz + bd, 0, 1], ['W', bx, bz, bx, bz + bd, -1, 0], ['E', bx + bw, bz, bx + bw, bz + bd, 1, 0]];
    for (const [side, ax, az, ex, ez, ox, oz] of edges) {
      if (side === facadeSide) continue;
      const horiz = az === ez;
      const L = horiz ? ex - ax : ez - az;
      const n = Math.max(1, Math.round(L / 0.1));
      let run = null;
      const flush = () => {
        if (!run) return;
        const [a, b] = run; run = null;
        if (b - a < 0.15) return;
        const gHit = gates.some((g) => { const [gx, gz, gw, gd] = g.rect; return horiz ? (Math.abs(gz + gd / 2 - az) < 0.1 && a < gx + gw && b > gx) : (Math.abs(gx + gw / 2 - ax) < 0.1 && a < gz + gd && b > gz); });
        if (gHit) return;
        const T2 = 0.06;
        if (horiz) fillWalls.push([+a.toFixed(4), +(az - oz * T2).toFixed(4), +b.toFixed(4), +(az - oz * T2).toFixed(4)]);
        else fillWalls.push([+(ax - ox * T2).toFixed(4), +a.toFixed(4), +(ax - ox * T2).toFixed(4), +b.toFixed(4)]);
      };
      for (let i = 0; i < n; i++) {
        const t0 = (horiz ? ax : az) + (L * i) / n, t1 = (horiz ? ax : az) + (L * (i + 1)) / n, m = (t0 + t1) / 2;
        const px = horiz ? m : ax + ox * 0.03, pz = horiz ? az + oz * 0.03 : m;
        const hit = footprint.some((q) => q !== r.balcony.rect && !(q[0] === bx && q[1] === bz && q[2] === bw && q[3] === bd) && px > q[0] && px < q[0] + q[2] && pz > q[1] && pz < q[1] + q[3]);
        if (hit) run = run ? [run[0], t1] : [t0, t1]; else flush();
      }
      flush();
    }
  }

  // 1F: 玄関開口(南向き)。P12: 風除室の外側自動ガラス引き戸(glass:true)。
  // walls.js の perimeterBoxes は floor.perimOpenings(この配列)を見て外周の
  // perimDoorブロッカを作るため、room.openings側だけでなくこちらにもglassを立てる。
  const perimOpenings = [];
  if (level === 1) {
    perimOpenings.push({
      pos: [(C1F.lobby[0] + C1F.lobby[1]) / 2, SOUTH_ROOM_Z1], width: C1F.autoDoorW, facing: 'S', glass: true,
    });
  }

  // props(P1では最小限)。宅配ボックスはメールコーナー前(x基準を新レイアウトへ)。
  const props = [];
  if (level === 1) {
    // 集合ポスト・宅配BOX はメールコーナーの西壁(写真 mailboxes_1F.jpg)。見た目は build_floor.py が作る
    props.push({ kind: 'mailboxes', pos: [C1F.mail[0], 0, SOUTH_ROOM_Z0 + 0.6], size: [0.42, 1.75, 4.6], rot: 0 });
    props.push({ kind: 'camera', pos: [SOUTH_ROOM_X0, CEIL_H - 0.2, SOUTH_CORR_Z0 + 0.2], rot: 0 });
  }

  // 追補1改訂2 EV-305: 220号室(2F東ブロック・北面)だけドアの見た目が違う(染み+手形)。
  // level.js の doorMesh が room.bloodStain を見てテクスチャ変種を選ぶ(phantomSealedと同じ方式)。
  if (level === 2) {
    const r220 = rooms.find((r) => r.id === '220');
    if (r220) r220.bloodStain = true;
  }

  return {
    level,
    corridor: corridorPath(level, inv, scEnd),
    rooms,
    footprint,
    fillWalls,
    ...(gates.length ? { gates } : {}),
    ...(level === 4 ? { roofA: { rects: ROOF_A.rects.map((r) => [...r]), obstacles: ROOF_A.obstacles.map((o) => ({ ...o, rect: [...o.rect] })), y: +(3 * FLOOR_H).toFixed(4), parapetH: 0.85, railH: 1.1 } } : {}),
    ...(perimOpenings.length ? { perimOpenings } : {}),
    props,
    shell: shellFor(level, inv, scEnd, rooms),
  };
}

// =========================================================================
// 8F(幻の階＝ロの字回廊の異世界。2026-07-06 台本追補3で全面改訂)。
// L字の他階と違い、閉じた矩形の回廊(ロの字)。中央に島=複製管理人室が浮き、
// 全周を幅1.8mの回廊が一周する。回廊の外周にはプレートなしの封印扉(開かない・
// 衝突あり)が並ぶ。EVは回廊の南辺に面し、xz座標は全階同一(EV_RECT)を維持。
// 外階段の鉄扉は無い(§2「あるはずの扉が無い」)。
//
// 座標設計(EV_RECT[6.0,22.1,1.8,1.9]・EV扉[6.9,22.1]facing N を固定点にする):
//  - 回廊の南辺 = 他階の横廊下と同じ z=SOUTH_CORR_Z0..SOUTH_CORR_Z1(20.3..22.1)。
//    EVはこの南辺の南側(z=22.1..24.0)に接し、扉が北向きに南辺回廊へ開く(全階と同一)。
//  - 回廊は幅CORR_W(1.8)の矩形リング。外周 x=LOOP_X0..LOOP_X1, z=LOOP_Z0..LOOP_Z1。
//  - 中央の島(複製管理人室)= リングの内側。全周を回廊が囲む。島への開口は北辺の1箇所のみ。
// =========================================================================
const LOOP_X0 = 2.0;                       // 回廊 外周西端
const LOOP_X1 = 14.6;                       // 回廊 外周東端(幅12.6m)
const LOOP_Z1 = SOUTH_CORR_Z1;              // 22.1 = 回廊 外周南端(EV南辺=他階横廊下と一致)
const LOOP_Z0 = 12.5;                       // 回廊 外周北端(奥行9.6m)
// 島(中央の複製管理人室)= リングの内側(外周から回廊幅ぶん内側)。
const ISLAND_X0 = LOOP_X0 + CORR_W;         // 3.8
const ISLAND_X1 = LOOP_X1 - CORR_W;         // 12.8
const ISLAND_Z0 = LOOP_Z0 + CORR_W;         // 14.3
const ISLAND_Z1 = LOOP_Z1 - CORR_W;         // 20.3
const ISLAND_CX = (ISLAND_X0 + ISLAND_X1) / 2; // 8.3
const ISLAND_CZ = (ISLAND_Z0 + ISLAND_Z1) / 2; // 17.3
// 回廊中心線(navGraph=ロの字の周回路)。南辺→西辺→北辺→東辺→南辺で一周。
const RING_S = LOOP_Z1 - CORR_W / 2;        // 南辺中心 z=21.2(=HCORR_CZ)
const RING_N = LOOP_Z0 + CORR_W / 2;        // 北辺中心 z=13.4
const RING_W = LOOP_X0 + CORR_W / 2;        // 西辺中心 x=2.9
const RING_E = LOOP_X1 - CORR_W / 2;        // 東辺中心 x=13.7
// EV前(南辺・EV扉の真北)。周回の起点。
const RING_EV_X = VCORR_CX;                 // 6.9(EV扉x)

function buildPhantom8F() {
  const rooms = [];

  // ---- 中央の島 = 複製管理人室(1F OFFICE の複製。level.js の buildDuplicateOffice が
  //      点呼簿・防犯モニター・黒い窓を載せる)。島への開口は北辺の1箇所のみ。 ----
  // DUPLICATE_OFFICE_ROOM は events.js/main.js が '806' を参照するため id は '806' を維持。
  rooms.push({
    id: '806', kind: 'office', island: true,
    rect: [ISLAND_X0, ISLAND_Z0, ISLAND_X1 - ISLAND_X0, ISLAND_Z1 - ISLAND_Z0],
    // 島の北面に唯一の開口(扉)。回廊北辺へ facing N。施錠(=main.jsが起動時にoperable化し開放)。
    door: { pos: [ISLAND_CX, ISLAND_Z0], facing: 'N', locked: true },
  });

  // ---- 外周の封印扉(プレートなし・開かない・衝突あり)。回廊の外周壁に埋め込む。
  //      室矩形は外周壁の外側(footprint外)に薄く置く=歩けない/flood-fillに載らない。
  //      扉は回廊側(内向き)へ facing。phantomSealed で level.js がプレート無し木目にする。 ----
  const SEAL_D = 0.5;   // 封印室の見かけ奥行(外周壁の外側の薄い凹み)
  // 封印室id: 806は島(複製管理人室)に予約済みのため 801〜805,807 を使う。
  // 3桁数字idにすることで level.js の doorMesh が phantomSealed=プレートなし木目扱いにできる。
  const SEAL_IDS = ['801', '802', '803', '804', '805', '807'];
  let sealIdx = 0;
  const addSeal = (x, z, facing) => {
    // 扉位置=外周壁ライン上(x,z)。扉は facing の向きで回廊へ開く。
    // 室矩形は回廊の反対側(=建物の外)へ SEAL_D 張り出す薄い凹み(歩けない・footprint外)。
    //  facing N: 回廊は北(小z)側 → 室は南(大z)側 z..z+SEAL_D
    //  facing S: 回廊は南(大z)側 → 室は北(小z)側 z-SEAL_D..z
    //  facing E: 回廊は東(大x)側 → 室は西(小x)側 x-SEAL_D..x
    //  facing W: 回廊は西(小x)側 → 室は東(大x)側 x..x+SEAL_D
    let rect;
    if (facing === 'N') rect = [x - ROOM_W / 2, z, ROOM_W, SEAL_D];
    else if (facing === 'S') rect = [x - ROOM_W / 2, z - SEAL_D, ROOM_W, SEAL_D];
    else if (facing === 'E') rect = [x - SEAL_D, z - ROOM_W / 2, SEAL_D, ROOM_W];
    else rect = [x, z - ROOM_W / 2, SEAL_D, ROOM_W]; // W
    rooms.push({
      id: SEAL_IDS[sealIdx++], kind: 'unit', phantomSealed: true,
      rect, door: { pos: [x, z], facing, locked: true },
    });
  };
  // 南辺の外周壁(z=LOOP_Z1)。EV開口(x=6.0..7.8)は避ける。封印扉は facing N(回廊北向き)。
  addSeal(LOOP_X0 + 1.6, LOOP_Z1, 'N');
  addSeal(LOOP_X1 - 1.6, LOOP_Z1, 'N');
  // 北辺の外周壁(z=LOOP_Z0)。封印扉は facing S(回廊南向き)。
  addSeal(LOOP_X0 + 2.4, LOOP_Z0, 'S');
  addSeal(LOOP_X1 - 2.4, LOOP_Z0, 'S');
  // 西辺の外周壁(x=LOOP_X0)。封印扉は facing E(回廊東向き)。
  addSeal(LOOP_X0, (LOOP_Z0 + LOOP_Z1) / 2, 'E');
  // 東辺の外周壁(x=LOOP_X1)。封印扉は facing W(回廊西向き)。
  addSeal(LOOP_X1, (LOOP_Z0 + LOOP_Z1) / 2, 'W');

  // ---- EV(全階同一座標・閉扉。南辺回廊へ北向きに開く) ----
  rooms.push({
    id: 'EV8', kind: 'elevator',
    rect: [...EV_RECT],
    door: { pos: [...EV_DOOR], facing: 'N', locked: true },
  });

  // ---- 回廊のフットプリント(ロの字リング=4辺の帯)+ 島の内側 + EVシャフト下床 ----
  const footprint = [
    // 南辺(EV南辺=他階横廊下と同一ライン z=20.3..22.1)
    [LOOP_X0, LOOP_Z1 - CORR_W, LOOP_X1 - LOOP_X0, CORR_W],
    // 北辺
    [LOOP_X0, LOOP_Z0, LOOP_X1 - LOOP_X0, CORR_W],
    // 西辺
    [LOOP_X0, LOOP_Z0, CORR_W, LOOP_Z1 - LOOP_Z0],
    // 東辺
    [LOOP_X1 - CORR_W, LOOP_Z0, CORR_W, LOOP_Z1 - LOOP_Z0],
    // 中央の島の内側(複製管理人室。回廊から北辺開口1つで入る歩行可能領域)
    [ISLAND_X0, ISLAND_Z0, ISLAND_X1 - ISLAND_X0, ISLAND_Z1 - ISLAND_Z0],
    // EVシャフト下床(x6.0..7.8, z22.1..24.0)
    [WEST_CORR_X0, SOUTH_ROOM_Z0, EV_RECT[2], EV_RECT[3]],
  ];

  // ---- 回廊の周回パス(navGraph=ロの字。loop:true で最後→最初を閉じる)。 ----
  // 南辺EV前を起点に、時計回り(南→西→北→東)で角を打つ。角ノードで両方向へ繋がる。
  const path = [
    [RING_EV_X, RING_S],   // 0: 南辺・EV前(起点)
    [RING_W, RING_S],      // 1: 南西角
    [RING_W, RING_N],      // 2: 北西角
    [ISLAND_CX, RING_N],   // 3: 北辺・島開口前(office扉が最寄り)
    [RING_E, RING_N],      // 4: 北東角
    [RING_E, RING_S],      // 5: 南東角
  ];

  return {
    level: 8,
    phantom: true,
    corridor: { type: 'loop', width: CORR_W, path, loop: true },
    rooms,
    footprint,
    fillWalls: [],
    props: [],
  };
}

// =========================================================================
// ナビグラフ(A*用)
// =========================================================================
function buildNavGraph(floors) {
  const nodes = [];
  const edges = [];
  const nodeIndex = new Map();

  function addNode(id, level, pos) {
    if (nodeIndex.has(id)) return id;
    nodeIndex.set(id, nodes.length);
    nodes.push({ id, level, pos });
    return id;
  }
  function addEdge(a, b, kind) { edges.push({ a, b, kind }); }

  for (const f of floors) {
    const lv = f.level;
    const p = f.corridor.path;
    const corrIds = [];
    p.forEach((pt, i) => {
      const id = addNode(`${lv}:c${i}`, lv, pt);
      corrIds.push(id);
      if (i > 0) addEdge(corrIds[i - 1], corrIds[i], 'corridor');
    });
    // ロの字回廊(loop:true・8F)は最後の点→最初の点を閉じて一周させる。
    // これで A* は EV前から時計回り/反時計回りどちらでも島を一周できる。
    if (f.corridor.loop && corrIds.length > 2) {
      addEdge(corrIds[corrIds.length - 1], corrIds[0], 'corridor');
    }
    for (const r of f.rooms) {
      if (!r.door) continue;
      const id = addNode(`${lv}:d${r.id}`, lv, r.door.pos);
      let best = corrIds[0], bd = Infinity;
      for (const cid of corrIds) {
        const cn = nodes[nodeIndex.get(cid)];
        const dx = cn.pos[0] - r.door.pos[0];
        const dz = cn.pos[1] - r.door.pos[1];
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = cid; }
      }
      addEdge(id, best, 'corridor');
    }
  }
  // 縦動線エッジ(論理接続)。stair エッジ=外階段(屋外経由。CHASEで「何者か」も使える)。
  for (let lv = 1; lv < 7; lv++) {
    addEdge(`${lv}:dEV${lv}`, `${lv + 1}:dEV${lv + 1}`, 'elevator');
    addEdge(`${lv}:dMST${lv}`, `${lv + 1}:dMST${lv + 1}`, 'stair');
  }
  addEdge('7:dEV7', '8:dEV8', 'elevator'); // 幻の8FへはEVのみ(外階段は8Fに無い)
  addEdge('2:dNST2', '3:dNST3', 'stair');   // P3a-2: 北階段は屋外(1F は地面だけで扉が無い)

  return { nodes, edges };
}

// =========================================================================
// flood-fill閉じ込めテスト
// 壁AABB(walls.js=描画と同一ロジック)に対し 0.3m格子でBFSし、
// 到達セルが全てフットプリント内に収まることを検証(外周漏れ検査)。
// 屋外の外階段踊り場は footprint(extLanding)に含めるため「歩行可能」だが、
// そこから地上や虚空へ漏れないことを同じ検査で保証する。
// =========================================================================
function floodFillCheck(floor, start) {
  const boxes = floorWallBoxes(floor);
  const infl = 0.15;  // セル半径ぶんの膨張
  const cs = 0.3;     // 格子ピッチ
  const rects = floor.footprint;

  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const [x, z, w, d] of rects) {
    minX = Math.min(minX, x); minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x + w); maxZ = Math.max(maxZ, z + d);
  }
  minX -= 1.5; minZ -= 1.5; maxX += 1.5; maxZ += 1.5; // 漏れ検出マージン

  const nx = Math.ceil((maxX - minX) / cs);
  const nz = Math.ceil((maxZ - minZ) / cs);
  const state = new Int8Array(nx * nz); // 0=未判定 1=開 2=塞 3=訪問済
  const cellC = (i, j) => [minX + (i + 0.5) * cs, minZ + (j + 0.5) * cs];

  function open(i, j) {
    if (i < 0 || j < 0 || i >= nx || j >= nz) return false;
    const k = j * nx + i;
    if (state[k] === 0) {
      const [px, pz] = cellC(i, j);
      let blocked = false;
      for (const b of boxes) {
        if (px >= b.cx - b.w / 2 - infl && px <= b.cx + b.w / 2 + infl &&
            pz >= b.cz - b.d / 2 - infl && pz <= b.cz + b.d / 2 + infl) {
          blocked = true; break;
        }
      }
      state[k] = blocked ? 2 : 1;
    }
    return state[k] === 1;
  }

  const si = Math.floor((start[0] - minX) / cs);
  const sj = Math.floor((start[1] - minZ) / cs);
  if (!open(si, sj)) {
    throw new Error(`ASSERT失敗: F${floor.level} flood開始セル(${start})が塞がっている`);
  }
  const inside = (px, pz) =>
    rects.some(([x, z, w, d]) => px >= x && px <= x + w && pz >= z && pz <= z + d);

  const q = [[si, sj]];
  state[sj * nx + si] = 3;
  let reached = 0;
  const leaks = [];
  while (q.length) {
    const [i, j] = q.pop();
    reached++;
    const [px, pz] = cellC(i, j);
    if (!inside(px, pz)) leaks.push([+px.toFixed(2), +pz.toFixed(2)]);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj;
      if (open(ni, nj)) { state[nj * nx + ni] = 3; q.push([ni, nj]); }
    }
  }
  if (leaks.length) {
    throw new Error(
      `ASSERT失敗: F${floor.level} 外周漏れ ${leaks.length}セル 例=${JSON.stringify(leaks.slice(0, 5))}`
    );
  }
  return reached;
}

// =========================================================================
// 検算5(追補3): 8F ロの字回廊が「一周ぐるりと繋がっている」ことの機械検証。
// =========================================================================
function loopAssert8F(phantom, navGraph) {
  // ---- (a) navGraph 回廊ノードの環が閉じているか ----
  // 8Fの回廊ノード(id 8:c*)とその corridor エッジだけで隣接リストを作る。
  const corrNodes = navGraph.nodes.filter((n) => n.level === 8 && /^8:c\d+$/.test(n.id));
  if (corrNodes.length < 4) throw new Error('ASSERT失敗: 8F回廊ノードが少なすぎる(ロの字未生成)');
  const corrSet = new Set(corrNodes.map((n) => n.id));
  const adj = new Map(corrNodes.map((n) => [n.id, []]));
  for (const e of navGraph.edges) {
    if (e.kind !== 'corridor') continue;
    if (corrSet.has(e.a) && corrSet.has(e.b)) { adj.get(e.a).push(e.b); adj.get(e.b).push(e.a); }
  }
  // 環の条件: すべての回廊ノードの次数が2(単純閉路)であること。
  for (const id of corrSet) {
    const deg = new Set(adj.get(id)).size; // 重複エッジを除いた実次数
    if (deg !== 2) throw new Error(`ASSERT失敗: 8F回廊ノード${id}の次数が${deg}(ロの字の環=全ノード次数2でない)`);
  }
  // EV前(南辺の起点 8:c0)から、隣接2方向それぞれへ一周を辿る。両方向とも全ノードを
  // 巡って起点へ戻り、到達集合が一致すること(=時計回りも反時計回りも同じ環)。
  const startId = '8:c0';
  if (!corrSet.has(startId)) throw new Error('ASSERT失敗: 8F回廊の起点 8:c0 が無い');
  const walkRing = (first) => {
    const visited = [startId];
    let prev = startId, cur = first;
    while (cur !== startId) {
      visited.push(cur);
      const nexts = adj.get(cur).filter((x) => x !== prev);
      if (nexts.length !== 1) return null; // 分岐=単純閉路でない
      prev = cur; cur = nexts[0];
      if (visited.length > corrSet.size + 1) return null; // 無限ループ保険
    }
    return visited;
  };
  const [dirA, dirB] = [...new Set(adj.get(startId))];
  const ringA = walkRing(dirA);
  const ringB = walkRing(dirB);
  if (!ringA || !ringB) throw new Error('ASSERT失敗: 8F回廊が単純閉路になっていない(EV前から一周できない)');
  const setA = new Set(ringA), setB = new Set(ringB);
  if (setA.size !== corrSet.size || setB.size !== corrSet.size) {
    throw new Error('ASSERT失敗: 8F回廊 一方向の一周が全ノードを巡らない(環が閉じていない)');
  }
  for (const id of setA) if (!setB.has(id)) throw new Error('ASSERT失敗: 8F回廊 時計回りと反時計回りの到達集合が不一致');

  // ---- (b) 中央の島の内部へは「1つの開口」からのみ入れる ----
  // flood-fill格子で、島内部セルと回廊セルの境界を跨ぐ辺(=通過できる開口)を数え、
  // 連結した開口が1箇所(北辺・office扉)だけであることを検証する。
  // 島(806)の扉は台本上「開いている一室」= 起動時にmain.jsがopenする(施錠ドアブロッカは
  // 実行時に無効化される)ため、この検証では 806 の扉ブロッカを開扉扱いで除外する。
  const island0 = phantom.rooms.find((r) => r.island);
  const boxes = floorWallBoxes(phantom).filter((b) => !(b.kind === 'door' && b.roomId === island0.id));
  const infl = 0.15, cs = 0.3;
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const [x, z, w, d] of phantom.footprint) {
    minX = Math.min(minX, x); minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x + w); maxZ = Math.max(maxZ, z + d);
  }
  minX -= 1; minZ -= 1; maxX += 1; maxZ += 1;
  const nx = Math.ceil((maxX - minX) / cs), nz = Math.ceil((maxZ - minZ) / cs);
  const cellC = (i, j) => [minX + (i + 0.5) * cs, minZ + (j + 0.5) * cs];
  const blocked = (px, pz) => boxes.some((b) =>
    px >= b.cx - b.w / 2 - infl && px <= b.cx + b.w / 2 + infl &&
    pz >= b.cz - b.d / 2 - infl && pz <= b.cz + b.d / 2 + infl);
  const island = phantom.rooms.find((r) => r.island);
  const [irx, irz, irw, ird] = island.rect;
  const inIsland = (px, pz) => px > irx + 0.05 && px < irx + irw - 0.05 && pz > irz + 0.05 && pz < irz + ird - 0.05;
  // 開口セル = 「回廊側(非島)で開いている」×「隣が島内側で開いている」対を数え、
  // 開口の連結成分の数を求める(1=1箇所のみ入れる)。
  const openings = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const [px, pz] = cellC(i, j);
      if (blocked(px, pz) || inIsland(px, pz)) continue; // 回廊側の空きセルのみ
      // 4近傍に「島内側の空きセル」があれば、その境界が開口
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const [qx, qz] = cellC(i + di, j + dj);
        if (i + di < 0 || j + dj < 0 || i + di >= nx || j + dj >= nz) continue;
        if (!blocked(qx, qz) && inIsland(qx, qz)) { openings.push([i, j]); break; }
      }
    }
  }
  if (!openings.length) throw new Error('ASSERT失敗: 8F 中央の島への開口が0(点呼簿の部屋に入れない)');
  // 開口セルの連結成分数(隣接=8近傍)を数える。1つ=単一開口。
  const okey = (i, j) => i * 100000 + j;
  const oset = new Set(openings.map(([i, j]) => okey(i, j)));
  const seen = new Set();
  let comps = 0;
  for (const [i0, j0] of openings) {
    if (seen.has(okey(i0, j0))) continue;
    comps++;
    const st = [[i0, j0]];
    seen.add(okey(i0, j0));
    while (st.length) {
      const [i, j] = st.pop();
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        if (!di && !dj) continue;
        const k = okey(i + di, j + dj);
        if (oset.has(k) && !seen.has(k)) { seen.add(k); st.push([i + di, j + dj]); }
      }
    }
  }
  if (comps !== 1) throw new Error(`ASSERT失敗: 8F 島への開口が${comps}箇所(期待1箇所=北辺office扉のみ)`);
  return { ringNodes: corrSet.size, islandOpenings: comps };
}

// =========================================================================
// メイン
// =========================================================================
function build() {
  const floors = [];
  for (let lv = 1; lv <= 7; lv++) floors.push(buildFloor(lv));
  const phantom = buildPhantom8F();
  const allFloors = [...floors, phantom];

  const navGraph = buildNavGraph(allFloors);
  const roofB = buildRoofB(floors.find((f) => f.level === 7));

  const building = {
    meta: {
      name: 'サンクレスト学生会館',
      floors: 7,
      phantomFloor: 8,
      unit: 'm',
      geom: { roomW: ROOM_W, roomD: ROOM_D, corridorW: CORR_W, floorH: FLOOR_H, ceilH: CEIL_H },
      origin: '西棟北西角(1F基準)',
      axes: { x: 'east', z: 'south', y: 'up' },
    },
    floors: allFloors,
    elevator: {
      shaft: [EV_RECT[0], EV_RECT[1]],
      size: [EV_RECT[2], EV_RECT[3]],
      stops: [1, 2, 3, 4, 5, 6, 7, 8],
    },
    stairs: [
      // main = 外階段(西外壁の鉄骨ジグザグ・1〜7F)。posは屋外踊り場の原点。
      // levels: 鉄扉のある階。stops: 外階段で行ける高さの並び(7F の上は屋上B 'RB'。屋外のまま出る)
      { id: 'main', room: 'MST', external: true, pos: [MST_RECT[0], MST_RECT[1]], size: [MST_RECT[2], MST_RECT[3]], door: [...EXT_DOOR_POS], levels: [1, 7],
        stops: [1, 2, 3, 4, 5, 6, 7, 'RB'],
        geom: { ...MST_GEOM, rise: STAIR_RISE, treads: STAIR_TREADS, tread: STAIR_TREAD } },
      // north = 北階段(P3a-2: 屋外の鉄骨。2F・3F の鉄扉→屋外通路→階段、下は 1F の地面)。area = 上下の階を見せる範囲(通路込み)
      { id: 'north', room: 'NST', external: true, pos: [NST_RECT[0], NST_RECT[1]], size: [NST_RECT[2], NST_RECT[3]], door: [...NST_DOOR], levels: [1, 3],
        area: [NST_GALLERY[0], NST_GALLERY[1], NST_GALLERY[2] + NST_RECT[2], NST_RECT[3]],
        stops: [1, 2, 3],
        geom: { ...NST_GEOM, rise: STAIR_RISE, treads: STAIR_TREADS, tread: STAIR_TREAD } },
      // basement = 地下への階段(P3a-2 異世界要素)。1F 食堂奥→B1(踊り場と施錠された鉄扉だけ)
      { id: 'basement', room: 'BST', pos: [BST_RECT[0], BST_RECT[1]], size: [BST_RECT[2], BST_RECT[3]], levels: ['B1', 1],
        stops: ['B1', 1],
        geom: { ...BST_GEOM, rise: STAIR_RISE, treads: STAIR_TREADS, tread: STAIR_TREAD } },
    ],
    navGraph,
    roofB,
    basement: buildBasement(),
  };

  // ---- 検算1: 居室数 ----
  let unitTotal = 0;
  const perFloor = {};
  for (const f of floors) {
    const n = f.rooms.filter((r) => r.kind === 'unit').length;
    perFloor[f.level] = n;
    unitTotal += n;
  }
  const phantomUnits = phantom.rooms.filter((r) => r.kind === 'unit' && !r.phantomSealed).length;
  const expected = { 1: 9, 2: 22, 3: 22, 4: 19, 5: 16, 6: 11, 7: 5 };
  for (const [lv, n] of Object.entries(expected)) {
    if (perFloor[lv] !== n) throw new Error(`ASSERT失敗: ${lv}F 居室数 ${perFloor[lv]} (期待 ${n})`);
  }
  if (unitTotal !== 104) throw new Error(`ASSERT失敗: 全居室合計 ${unitTotal} (期待 104)`);
  if (phantomUnits !== 0) throw new Error(`ASSERT失敗: 8F実居室 ${phantomUnits} (期待 0)`);

  // ---- 検算2: 部屋矩形の重なり(全階。屋外階段=x<0 は屋内居室と交わらない) ----
  for (const f of allFloors) {
    const rs = f.rooms;
    for (let i = 0; i < rs.length; i++) {
      for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i].rect, c = rs[j].rect;
        const ox = Math.min(a[0] + a[2], c[0] + c[2]) - Math.max(a[0], c[0]);
        const oz = Math.min(a[1] + a[3], c[1] + c[3]) - Math.max(a[1], c[1]);
        if (ox > 0.05 && oz > 0.05) {
          throw new Error(`ASSERT失敗: F${f.level} 部屋重なり ${rs[i].id}×${rs[j].id}`);
        }
      }
    }
  }

  // ---- 検算3: コア座標の全階一致(EV=1〜8F, 外階段=1〜7F) ----
  const evRef = JSON.stringify(EV_RECT);
  const mstRef = JSON.stringify(MST_RECT);
  for (const f of allFloors) {
    const ev = f.rooms.find((r) => r.kind === 'elevator');
    if (!ev || JSON.stringify(ev.rect) !== evRef) {
      throw new Error(`ASSERT失敗: F${f.level} EVシャフト座標が不一致`);
    }
    if (f.level <= 7) {
      const mst = f.rooms.find((r) => r.id === 'MST' + f.level);
      if (!mst || JSON.stringify(mst.rect) !== mstRef) {
        throw new Error(`ASSERT失敗: F${f.level} 外階段座標が不一致`);
      }
    }
  }

  // ---- 検算3b(P7新規): 新レイアウトの整合 ----
  // (a) EVシャフトが全階同一(検算3で担保済み)かつ EV扉が北向き=EVホール側。
  for (const f of allFloors) {
    const ev = f.rooms.find((r) => r.kind === 'elevator');
    if (!ev.door || ev.door.facing !== 'N') {
      throw new Error(`ASSERT失敗: F${f.level} EV扉が北向き(ホール側)でない`);
    }
  }
  // (b) 外階段の鉄扉は 1〜7F のみに存在し、8Fには存在しない(§2)。
  for (const f of allFloors) {
    const mst = f.rooms.find((r) => r.id === 'MST' + f.level);
    if (f.level <= 7) {
      if (!mst || !mst.external || !mst.door.steel) {
        throw new Error(`ASSERT失敗: F${f.level} 外階段(鉄扉)が無い`);
      }
    } else if (mst) {
      throw new Error(`ASSERT失敗: F8 に外階段の鉄扉が存在してはならない(§2)`);
    }
  }
  // (b2) P10: 鉄扉はEVホールの西壁(x=6.0)に隣接する(EVのすぐ隣・袋小路の解消)。
  //      EV扉(北向き)とのz中心が一致し、鉄扉のx座標がEVシャフトの西端と一致すること。
  for (const f of allFloors) {
    if (f.level > 7) continue;
    const mst = f.rooms.find((r) => r.id === 'MST' + f.level);
    const ev = f.rooms.find((r) => r.kind === 'elevator');
    if (mst.door.pos[0] !== ev.rect[0]) {
      throw new Error(`ASSERT失敗: F${f.level} 鉄扉のxがEVホール西壁(EVシャフト西端)と不一致`);
    }
    if (Math.abs(mst.door.pos[1] - HCORR_CZ) > 1e-6) {
      throw new Error(`ASSERT失敗: F${f.level} 鉄扉のzが横廊下中心と不一致`);
    }
    // 踊り場はホールの西=鉄扉と同じx(3.4..6.0)に隣接していること(袋小路が残っていないか)
    if (Math.abs(mst.rect[0] + mst.rect[2] - ev.rect[0]) > 1e-6) {
      throw new Error(`ASSERT失敗: F${f.level} 外階段踊り場がEVホール西壁に隣接していない`);
    }
  }
  // (b3) 追補1改訂2: 220号室(2F東ブロック・北面)が悲鳴部屋(bloodStain)であること。
  //      512号室は通常の施錠室に戻っていること(bloodStain残骸がないこと)。
  {
    const f2 = allFloors.find((f) => f.level === 2);
    const r220 = f2.rooms.find((r) => r.id === '220');
    if (!r220 || !r220.bloodStain) {
      throw new Error('ASSERT失敗: 220号室がbloodStain(悲鳴部屋)になっていない');
    }
    const f5 = allFloors.find((f) => f.level === 5);
    const r512 = f5.rooms.find((r) => r.id === '512');
    if (!r512 || r512.bloodStain) {
      throw new Error('ASSERT失敗: 512号室に悲鳴部屋の残骸(bloodStain)が残っている');
    }
  }
  // (c) §2 v4.1: 410 は東列の「北端」(図面どおり。EV隣接ではない)。
  //     4F東列 [410,...,406] の先頭=410 が最も z が小さい(=最も北)であること。
  const f4 = allFloors.find((f) => f.level === 4);
  const r410 = f4.rooms.find((r) => r.id === '410');
  const eastZs = INVENTORY[4].westEast.map((id) => f4.rooms.find((r) => r.id === id).rect[1]);
  const minEastZ = Math.min(...eastZs);
  if (Math.abs(r410.rect[1] - minEastZ) > 1e-6) {
    throw new Error(`ASSERT失敗: 410が東列の北端でない(410 z=${r410.rect[1]} / 東列最小z=${minEastZ})`);
  }
  // (d) 各階の東列は北→南に降順(配列先頭=北端=最小z)。図面どおりの並び。
  for (const [lv, inv] of Object.entries(INVENTORY)) {
    if (inv.westEast.length < 2) continue;
    const f = allFloors.find((ff) => ff.level === +lv);
    const first = f.rooms.find((r) => r.id === inv.westEast[0]);
    const last = f.rooms.find((r) => r.id === inv.westEast[inv.westEast.length - 1]);
    if (!(first.rect[1] < last.rect[1])) {
      throw new Error(`ASSERT失敗: ${lv}F 東列の先頭(${inv.westEast[0]})が北端でない`);
    }
  }

  // ---- 検算4: flood-fill閉じ込めテスト(全階) ----
  const reachedPerFloor = {};
  for (const f of allFloors) {
    // 開始点: EVホール前(縦廊下と横廊下の交差点=6.9,21.2)。全階で歩行可能。
    const start = [VCORR_CX, HCORR_CZ];
    reachedPerFloor[f.level] = floodFillCheck(f, start);
  }

  // ---- 検算5(追補3新規): 8F ロの字回廊が一周繋がっていることの機械検証 ----
  //  (a) navGraphの回廊ノードだけで、EV前から時計回り・反時計回りの両方向へ一周でき、
  //      同じ到達集合になる(=ロの字の環が閉じている)。
  //  (b) 中央の島(複製管理人室)の内部へは、回廊から「1つの開口」だけで入れる
  //      (flood-fillの格子で、島内部⇔回廊 の通過セルが北辺開口の1箇所のみ)。
  const loopInfo = loopAssert8F(phantom, navGraph);
  // ---- 検算7(P3a-2): 地下の踊り場が閉じている(施錠扉の向こうへ出られない)・北階段は 1F に扉が無い ----
  reachedPerFloor.B1 = floodFillCheck({ level: 'B1', ...building.basement }, [EAST_COL_X0 + 1.0, 2.2]);
  {
    const f1 = floors.find((f) => f.level === 1);
    if (f1.rooms.some((r) => r.id.startsWith('NST'))) throw new Error('ASSERT失敗: 1F に北階段の部屋(扉)が残っている');
    if (!f1.rooms.some((r) => r.id === 'BST')) throw new Error('ASSERT失敗: 1F に地下への階段が無い');
    for (const lv of [2, 3]) {
      const r = floors.find((f) => f.level === lv).rooms.find((rr) => rr.id === 'NST' + lv);
      if (!r || !r.door.steel || !r.external) throw new Error(`ASSERT失敗: ${lv}F の北階段の鉄扉が無い`);
    }
  }
  // ---- 検算6(P3a): 屋上B の外周が閉じている(踊り場から屋根へ出られ、外へは落ちない) ----
  reachedPerFloor.RB = floodFillCheck({ level: 'RB', ...roofB, rooms: [] }, [MST_RECT[0] + 1.7, SOUTH_CORR_Z0 + 0.7]);
  {
    const roofCell = [14.0, SOUTH_ROOM_Z0 + 3.0];
    const inside = roofB.footprint.some(([x, z, w, d]) => roofCell[0] > x && roofCell[0] < x + w && roofCell[1] > z && roofCell[1] < z + d);
    if (!inside) throw new Error('ASSERT失敗: 屋上Bの屋根面が footprint に無い');
  }

  const out = join(__dirname, 'building.json');
  writeFileSync(out, JSON.stringify(building, null, 2));

  console.log('building.json 生成完了:', out);
  console.log('階別居室数:', perFloor, '合計', unitTotal);
  console.log('8F 封印扉数:', phantom.rooms.filter((r) => r.phantomSealed).length, '/ 実居室', phantomUnits);
  console.log('410 位置:', r410.rect, '(東列北端・図面どおり)');
  console.log('flood-fill到達セル数(全て外周内):', reachedPerFloor);
  console.log('navGraph:', navGraph.nodes.length, 'nodes,', navGraph.edges.length, 'edges');
  console.log('8F ロの字回廊:', loopInfo.ringNodes, '周回ノード / 島開口', loopInfo.islandOpenings, '箇所(単一)');
  console.log('ASSERT 全通過 ✓ (居室数 / 重なり / コア座標 / 新レイアウト整合 / 閉じ込め / 8Fロの字一周)');
}

build();
