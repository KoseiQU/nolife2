// interior_layout.js — 居室内装テンプレートの「配置ロジック」(THREE非依存の純関数)。
// props.js(3D生成)と build_assert(Node検証)の双方から同じ座標計算を共有するために
// メッシュ生成から切り離してある。ここを直せば実行時とビルド検証が同時に追随する。
//
// レイアウト(玄関=廊下側 u=0、外壁側 u=uLen):
//   u0付近: シューズケース → 水回りブロック(トイレ/バス/洗面) → 家電列(洗濯機・冷蔵庫・
//   電子レンジ台) → クローゼット → 洋室(デスク+チェア / 外壁側にベッド / 壁上部にエアコン)
// 部屋の向き(door.facing)で左右反転。玄関=廊下側・ベッド=外壁側は不変。
//
// 玄関→リビング一本道(2026-07-06 FB①・DESIGN §5):
//   通路は「幅方向(v)の片側1レーン」を玄関(u=0)から洋室(livingU0)まで確保する。
//   全家具の足元AABBはこの通路矩形(u,v)と交差してはならない=residentialLayout内でアサート。

export const FLOOR_H = 2.9;
export const CORRIDOR_V = 0.95;      // 通路レーンの幅(≥0.9m 要件を満たす)
export const CORRIDOR_MARGIN = 0.05; // 家具は通路レーンから最低これだけ離す
// P16②: 壁厚(walls.js GEOM.WALL_T=0.12。循環回避のためTHREE非依存のこのファイルには
// 値だけをハードコピーする)。壁ボックスは room.rect の境界(v=0 / v=vLen)を中心に
// ±WALL_T/2 で張られるため、家具を壁際に寄せる際はこの半厚みぶんは必ず離さないと
// 家具が壁の中へ数cmめり込む(=同じ深度でメッシュが重なりzファイティング=粗いノイズ状
// ピクセルブロックの明滅を起こす。FB②で報告された「冷蔵庫の面が乱れる」の真因)。
const WALL_T = 0.12;
// P16②: 扉面(木目)を外殻(パネル)の前面からこれだけ手前へ離す。旧実装は前面差が
// 数mm(水回り5mm・クローゼット0mm=完全一致)しかなく、視距離1〜2mではGPUの深度バッファ
// 精度で区別できずzファイティングを起こしていた(同上の症状の別発生源)。
const FACE_STANDOFF = 0.03; // 3cm。視距離1〜2mで安全にz分離できる余裕を確保

// 1室分の内装レイアウトを算出して返す(純関数)。
// 戻り値: { roomId, level, boxes:[{matKey,w,h,d,cx,cy,cz}], collisions:[AABB],
//           bedSpot:{x,z,level,facing}, deskSpot:{x,z,y,level} }
// 通路交差が起きた場合はここで throw する(実行時起動 or build_assert で回帰検知)。
export function residentialLayout(room, baseY) {
  const [rx, rz, rw, rd] = room.rect;
  const facing = (room.door && room.door.facing) || 'E';
  const level = Math.round(baseY / FLOOR_H) + 1;
  const alongX = (facing === 'E' || facing === 'W'); // ドア軸(u)がx方向か
  // u=玄関→外壁 軸, v=部屋の幅 軸。door側(廊下側)を u=0 とする。
  const uLen = alongX ? rw : rd;   // 玄関〜外壁の距離
  const vLen = alongX ? rd : rw;   // 部屋の幅
  const uOrigin = alongX ? rx : rz;
  const vOrigin = alongX ? rz : rx;
  // E=ドアが東(+x)=廊下は+x側 → 玄関 u=uLen側。W=玄関 u=0側。同様に S/N。
  const doorHigh = (facing === 'E' || facing === 'S'); // 玄関が高座標(u=uLen)側
  const U = (u) => uOrigin + (doorHigh ? (uLen - u) : u);
  const V = (v) => vOrigin + v;
  const vMid = vLen / 2;

  const boxes = [];
  const collisions = [];
  let bedSpot = null, deskSpot = null;

  // --- 玄関→リビング一本道(通路レーン)。玄関ドアは間口(v)の中央に付く(building.json)ので、
  //     通路は「ドアのv位置を中心に幅CORRIDOR_V」で確保する。玄関(u=0)から洋室(livingU0)まで。 ---
  const doorV = vLen / 2;                  // ドアは間口中央(=door.pos が rect 中心)
  const corrHalf = CORRIDOR_V / 2;
  const corrV0 = doorV - corrHalf, corrV1 = doorV + corrHalf; // 通路レーンのv範囲
  const livingU0 = uLen - 2.2;             // これより奥(外壁側)が洋室ゾーン=通路の終端
  const corridorRect = { u0: 0, u1: livingU0, v0: corrV0, v1: corrV1 };
  // 通路の両脇に家具を寄せる壁際レーン(v方向)。低v側 / 高v側の中心。
  const loLaneMax = corrV0 - CORRIDOR_MARGIN;   // 低v側の家具はここより下(壁 v=0 まで)
  const hiLaneMin = corrV1 + CORRIDOR_MARGIN;   // 高v側の家具はここより上(壁 v=vLen まで)
  const roomFurnAABBs = []; // [{u0,u1,v0,v1,label}] (u,v)空間の家具AABB(通路アサート用)

  const addBox = (matKey, w, h, d, cx, cy, cz) => boxes.push({ matKey, w, h, d, cx, cy, cz });
  const addAABB = (cx, cz, w, d, y0, h) =>
    collisions.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, y0, y1: y0 + h });

  // (u,v)矩形→ワールド。solid=trueで衝突AABB+通路検証AABBを登録。
  const put = (matKey, uc, vc, h, uw, vw, hc, solid = false, label = '') => {
    const wx = alongX ? uw : vw, wz = alongX ? vw : uw;
    const cx = alongX ? U(uc) : V(vc);
    const cz = alongX ? V(vc) : U(uc);
    addBox(matKey, wx, h, wz, cx, baseY + hc, cz);
    if (solid) {
      addAABB(cx, cz, alongX ? uw : vw, alongX ? vw : uw, baseY, h);
      roomFurnAABBs.push({ u0: uc - uw / 2, u1: uc + uw / 2, v0: vc - vw / 2, v1: vc + vw / 2, label });
    }
  };
  // P16②: putWallFlush — 壁にぴったり寄せる「外殻」用。footprint/AABB(通路交差アサート・
  // 衝突判定)は従来どおり full thickness(vcFull,thkFull)で登録し、見た目メッシュだけを
  // visualFn(thkFull) が返す { vc, thk } に差し替えて描画する(壁へのめり込み=zファイティング
  // を防ぐが、通路の安全マージンには一切影響しない)。
  const putWallFlush = (matKey, uc, vcFull, h, uw, thkFull, hc, visualFn, solid = false, label = '') => {
    const { vc: vcVis, thk: thkVis } = visualFn(thkFull);
    const wx = alongX ? uw : thkVis, wz = alongX ? thkVis : uw;
    const cx = alongX ? U(uc) : V(vcVis);
    const cz = alongX ? V(vcVis) : U(uc);
    addBox(matKey, wx, h, wz, cx, baseY + hc, cz);
    if (solid) {
      const cxFull = alongX ? U(uc) : V(vcFull), czFull = alongX ? V(vcFull) : U(uc);
      addAABB(cxFull, czFull, alongX ? uw : thkFull, alongX ? thkFull : uw, baseY, h);
      roomFurnAABBs.push({ u0: uc - uw / 2, u1: uc + uw / 2, v0: vcFull - thkFull / 2, v1: vcFull + thkFull / 2, label });
    }
  };
  // 壁際レーンの家具中心v。厚みthkの家具を、指定側(hi/lo)の壁にぴったり寄せる。
  // (このvc自体は従来どおり=通路交差アサートが使うfootprint/AABBは一切変更しない。)
  const hiVc = (thk) => vLen - thk / 2 - 0.02;    // 高v側の壁際(vLen 壁)
  const loVc = (thk) => thk / 2 + 0.02;           // 低v側の壁際(v=0 壁)
  const hiThkMax = vLen - hiLaneMin;              // 高v側レーンに収まる最大厚み
  const loThkMax = loLaneMax;                     // 低v側レーンに収まる最大厚み
  // P16②: 壁際に置く「外殻」の見た目メッシュだけを壁からWALL_T/2まで後退させるヘルパー。
  // 通路側の縁(footprint/AABBが使う辺)は一切動かさない=通路交差アサートに影響しない。
  // 壁ボックスは room.rect 境界(v=0/v=vLen)を中心に±WALL_T/2で張られるため、旧実装の
  // 0.02mマージンでは壁の中へ数cmめり込み、そこでzファイティング(粗いノイズ状ピクセルの
  // 明滅)が起きていた(FB②「冷蔵庫の面が乱れる」の真因)。戻り値は見た目描画専用の
  // { vc, thk } — solid判定・footprint登録には元のthk/vcをそのまま使うこと。
  const wallGap = Math.max(0, WALL_T / 2 - 0.02); // 旧マージン(0.02)との不足分
  const hiVisual = (thk) => {
    const t = Math.max(0.05, thk - wallGap);
    return { vc: vLen - t / 2 - 0.02 - wallGap, thk: t };
  };
  const loVisual = (thk) => {
    const t = Math.max(0.05, thk - wallGap);
    return { vc: t / 2 + 0.02 + wallGap, thk: t };
  };

  // --- 玄関: シューズケース(低v側の壁際・玄関直後) ---
  {
    const thk = Math.min(0.4, loThkMax);
    putWallFlush('wood', 0.32, loVc(thk), 0.9, 0.4, thk, 0.45, loVisual, true, 'shoe');
  }

  // --- 水回りブロック(玄関の先・高v側の壁沿いに一列)。バス/トイレ/洗面を u方向に連ねる。 ---
  {
    const thk = Math.min(0.9, hiThkMax); // 高v側レーン厚(通路を侵さない)
    const vc = hiVc(thk);
    const wetU0 = 0.62, wetU1 = 2.35, wetW = wetU1 - wetU0, wetUc = (wetU0 + wetU1) / 2;
    // 個室群の外殻: 壁側はWALL_T/2まで後退(zファイト防止)・通路側の縁とfootprint/AABBは不変。
    putWallFlush('panel', wetUc, vc, 2.1, wetW, thk, 1.05, hiVisual, true, 'wet');
    put('panel', wetU0 + wetW / 3, vc, 2.0, 0.04, thk * 0.94, 1.0);       // 間仕切り(3室を暗示)
    put('panel', wetU0 + wetW * 2 / 3, vc, 2.0, 0.04, thk * 0.94, 1.0);
    // 通路側の木ドア面: 外殻の前面(vc - thk/2)からしっかり手前へ離す(旧実装は前面差が
    // 5mm しかなく、視距離1〜2mではzファイティング=粗いノイズブロックの原因になっていた)。
    put('wood', wetUc, vc - thk / 2 - FACE_STANDOFF / 2, 1.9, wetW * 0.9, 0.05, 0.95);
  }

  // --- 家電列(洗濯機→冷蔵庫→レンジ台)。玄関の反対=低v側の壁沿いに一列。 ---
  // P16②: 各家電はsolid=falseの視覚専用ボックス(衝突/通路判定はaddAABB+roomFurnAABBsが
  // 別途担う)。loVisual()で壁側だけ後退させ、通路側の並び位置(apV基準の見た目)は
  // ほぼそのまま保つ(壁にめり込んで起きていたzファイティング=FB②の真因を解消)。
  {
    const thk = Math.min(0.6, loThkMax), apV = loVc(thk);
    const washV = loVisual(thk * 0.9), fridgeV = loVisual(thk), rangeV = loVisual(thk * 0.85), mwV = loVisual(thk * 0.7);
    put('panel', 1.0, washV.vc, 0.85, 0.55, washV.thk, 0.42);   // 洗濯機
    put('metal', 1.7, fridgeV.vc, 1.7, 0.6, fridgeV.thk, 0.85); // 冷蔵庫
    put('wood', 2.35, rangeV.vc, 0.8, 0.5, rangeV.thk, 0.4);    // レンジ台
    put('panel', 2.35, mwV.vc, 0.28, 0.42, mwV.thk, 0.92);      // 電子レンジ
    addAABB(alongX ? U(1.7) : V(apV), alongX ? V(apV) : U(1.7), alongX ? 2.1 : thk, alongX ? thk : 2.1, baseY, 1.7);
    roomFurnAABBs.push({ u0: 0.7, u1: 2.65, v0: apV - thk / 2, v1: apV + thk / 2, label: 'appliances' });
  }

  // --- クローゼット(水回りの奥・高v側の壁沿い) ---
  {
    const thk = Math.min(0.55, hiThkMax), clV = hiVc(thk), clU = 3.15;
    putWallFlush('panel', clU, clV, 2.0, 1.1, thk, 1.0, hiVisual, true, 'closet');
    // 扉面(木目)。外殻前面(clV - thk/2)からFACE_STANDOFFぶん手前に浮かせる(z-fight対策)。
    put('wood', clU, clV - thk / 2 - FACE_STANDOFF / 2, 1.9, 1.0, 0.04, 0.95);
  }

  // --- 洋室: デスク+チェア(洋室ゾーン・低v側の壁沿い) ---
  const deskThk = 0.5, deskVc = loVc(deskThk), deskUc = livingU0 + 0.55;
  put('wood', deskUc, deskVc, 0.04, 0.9, deskThk, 0.72);      // 天板
  put('wood', deskUc, deskVc, 0.72, 0.86, 0.04, 0.36);        // 脚代わりの側板
  put('fabric', deskUc, deskVc + deskThk / 2 + 0.28, 0.5, 0.42, 0.42, 0.25); // チェア座面(洋室ゾーン)
  put('fabric', deskUc, deskVc + 0.06, 0.5, 0.42, 0.04, 0.55);// チェア背
  deskSpot = {
    x: alongX ? U(deskUc) : V(deskVc),
    z: alongX ? V(deskVc) : U(deskUc),
    y: baseY + 0.74, level,
  };

  // --- ベッド(洋室ゾーン・外壁側・幅中央寄り)。ベッド下は隠れ用に空ける ---
  const bedUc = uLen - 1.05, bedVc = vMid;
  put('dark', bedUc, bedVc, 0.28, 1.9, 1.0, 0.14);   // フレーム(低く=下に潜れる)
  put('dark', bedUc, bedVc, 0.35, 0.06, 1.0, 0.34);  // ヘッドボード寄りの脚枠(外壁側)
  put('fabric', bedUc, bedVc, 0.16, 1.85, 0.95, 0.5);// マットレス(高さ0.42〜0.58)
  put('panel', bedUc + 0.75, bedVc, 0.32, 0.35, 0.5, 0.62); // 枕
  {
    const cx = alongX ? U(bedUc) : V(bedVc);
    const cz = alongX ? V(bedVc) : U(bedUc);
    const bw = alongX ? 1.9 : 1.0, bd = alongX ? 1.0 : 1.9;
    // ベッド下は空けるため、AABBはマットレスの高さ帯だけ(下に潜れる)
    collisions.push({ minX: cx - bw / 2, maxX: cx + bw / 2, minZ: cz - bd / 2, maxZ: cz + bd / 2, y0: baseY + 0.42, y1: baseY + 0.62 });
    bedSpot = { x: cx, z: cz, level, facing };
    roomFurnAABBs.push({ u0: bedUc - 0.95, u1: bedUc + 0.95, v0: bedVc - 0.5, v1: bedVc + 0.5, label: 'bed' });
  }

  // --- エアコン(外壁側・壁上部。足元に無いので通路検証対象外) ---
  put('ac', uLen - 0.25, vMid, 0.32, 0.18, 0.9, 2.2);

  // === 生成時アサート: 全家具AABBが玄関→リビング通路(ドア中央から幅CORRIDOR_V)と交差しないこと ===
  for (const a of roomFurnAABBs) {
    const overlap = a.u0 < corridorRect.u1 && a.u1 > corridorRect.u0 &&
                    a.v0 < corridorRect.v1 && a.v1 > corridorRect.v0;
    if (overlap) {
      throw new Error(
        `[residentialLayout] 居室${room.id}: 家具「${a.label}」が玄関→リビング通路` +
        `(u:0..${corridorRect.u1.toFixed(2)}, v:${corrV0.toFixed(2)}..${corrV1.toFixed(2)}) に侵入 ` +
        `(家具 u:${a.u0.toFixed(2)}..${a.u1.toFixed(2)}, v:${a.v0.toFixed(2)}..${a.v1.toFixed(2)})`,
      );
    }
  }

  return { roomId: room.id, level, boxes, collisions, bedSpot, deskSpot };
}

// =========================================================================
// 友達の部屋(105/212/221/312/409)の私物プロップ配置(P18・追補2)。
// residentialLayout と同じ(u,v)座標系を再計算し、洋室ゾーンの壁際・既存家具の
// 上/横に「生活感の濃い私物」を1〜2点置く。THREE非依存の純関数=props.js(描画)と
// build_assert(通路交差の回帰検証)の双方が同じ座標を共有する。
//
// 戻り値: { roomId, level, boxes:[{matKey,w,h,d,cx,cy,cz, kind?}], hit? }
//   boxes は residentialLayout と同形式(props側でそのままMesh化)。105/409のみ hit
//   ({x,y,z,w,h,d,id,prompt})を返し「調べる」対象になる(events.js FRIEND-PROP-*)。
//   通路交差(corridorRect)・ベッド下隠れスポットへの侵入が起きた場合はここで throw する。
//
// matKey は INT_MAT(props.js)に無い私物色を props 側で解決するため、'clutter*' 等の
// 独自キーも許容する(props.js の PROP_MAT で受ける)。
export function friendRoomProps(room, baseY) {
  const [rx, rz, rw, rd] = room.rect;
  const facing = (room.door && room.door.facing) || 'E';
  const level = Math.round(baseY / FLOOR_H) + 1;
  const alongX = (facing === 'E' || facing === 'W');
  const uLen = alongX ? rw : rd;
  const vLen = alongX ? rd : rw;
  const uOrigin = alongX ? rx : rz;
  const vOrigin = alongX ? rz : rx;
  const doorHigh = (facing === 'E' || facing === 'S');
  const U = (u) => uOrigin + (doorHigh ? (uLen - u) : u);
  const V = (v) => vOrigin + v;
  const vMid = vLen / 2;

  // residentialLayout と同一の通路レーン・洋室ゾーン定義(座標を必ず一致させる)。
  const doorV = vLen / 2;
  const corrHalf = CORRIDOR_V / 2;
  const corrV0 = doorV - corrHalf, corrV1 = doorV + corrHalf;
  const livingU0 = uLen - 2.2;                 // 洋室ゾーン開始u
  const corridorRect = { u0: 0, u1: livingU0, v0: corrV0, v1: corrV1 };
  // ベッド下隠れスポット(residentialLayoutと同値): bedUc=uLen-1.05, 幅1.9/奥1.0。
  const bedUc = uLen - 1.05;
  const bedRect = { u0: bedUc - 0.95, u1: bedUc + 0.95, v0: vMid - 0.5, v1: vMid + 0.5 };
  // 洋室の低v側デスク帯(residentialLayout): deskUc=livingU0+0.55, deskThk=0.5, deskVc=loVc。
  const loVc = (thk) => thk / 2 + 0.02;

  const boxes = [];
  const propAABBs = []; // [{u0,u1,v0,v1,label}] 足元AABB(通路/ベッド交差検証用)
  let hit = null;       // 105/409の「調べる」当たり判定(events.js FRIEND-PROP-* が拾う)

  const add = (matKey, uc, vc, h, uw, vw, hc, kind) => {
    const wx = alongX ? uw : vw, wz = alongX ? vw : uw;
    const cx = alongX ? U(uc) : V(vc);
    const cz = alongX ? V(vc) : U(uc);
    boxes.push({ matKey, w: wx, h, d: wz, cx, cy: baseY + hc, cz, kind });
  };
  // 足元を占有する私物(床置き)のAABBを登録=通路/ベッド下交差検証の対象にする。
  const claim = (uc, vc, uw, vw, label) =>
    propAABBs.push({ u0: uc - uw / 2, u1: uc + uw / 2, v0: vc - vw / 2, v1: vc + vw / 2, label });
  // 「調べる」当たり判定を(u,v)からワールド座標で登録。
  const setHit = (uc, vc, hc, uw, vw, hh, hitId) => {
    const cx = alongX ? U(uc) : V(vc);
    const cz = alongX ? V(vc) : U(uc);
    hit = { x: cx, y: baseY + hc, z: cz, w: alongX ? uw : vw, h: hh, d: alongX ? vw : uw, id: hitId, prompt: '調べる' };
  };

  const id = room.id;
  const hiWall = (thk) => vLen - thk / 2 - 0.03;   // 高v側の壁際中心
  const loWall = (thk) => thk / 2 + 0.03;          // 低v側の壁際中心

  if (id === '105') {
    // ゲーム機: 小型TV+コンソール。低v側の壁際(デスク帯より玄関寄り、洋室ゾーンの手前端)。
    // デスクは deskUc=livingU0+0.55(低v壁際)なので、TVはそこより奥(外壁側)の低v壁際に置く。
    const uTV = livingU0 + 1.5;
    const tvThk = 0.32, tvVc = loWall(tvThk);
    add('cabinet', uTV, tvVc, 0.4, 0.7, tvThk, 0.2, 'tvstand');        // TV台
    add('screen', uTV, tvVc + 0.02, 0.42, 0.62, 0.05, 0.62, 'tv');      // TV画面(自照は色で表現)
    add('darkprop', uTV + 0.28, tvVc, 0.06, 0.24, 0.18, 0.44, 'console'); // コンソール本体
    // コード(細い暗い板)を台の足元に這わせる
    add('darkprop', uTV - 0.1, tvVc + 0.14, 0.01, 0.5, 0.02, 0.01, 'cord');
    claim(uTV, tvVc, 0.7, tvThk, 'gameconsole');
    setHit(uTV, tvVc, 0.5, 0.7, 0.6, 0.7, 'friend_prop_105');
  } else if (id === '212') {
    // ポスターの壁: 高v側の壁面に色付き矩形パネルを縦横に数枚(足元AABB不要=壁上)。
    const pu = [livingU0 + 0.5, livingU0 + 1.1, livingU0 + 0.8, livingU0 + 1.5];
    const ph = [1.35, 1.35, 1.85, 1.8];
    const cols = ['poster0', 'poster1', 'poster2', 'poster0'];
    const pThk = 0.02, pVc = vLen - pThk / 2 - 0.01;
    for (let i = 0; i < pu.length; i++) {
      add(cols[i], pu[i], pVc, 0.5 + (i % 2) * 0.12, 0.4 + (i % 2) * 0.08, pThk, ph[i], 'poster');
    }
    // ポスターは壁面(足元占有なし)なので通路/ベッド交差検証は不要。
  } else if (id === '221') {
    // マンガの山: 洋室ゾーンの低v壁際・外壁寄りに床置きスタックを2〜3山。
    const stacks = [
      { u: livingU0 + 0.9, hStack: 0.5, n: 6 },
      { u: livingU0 + 1.35, hStack: 0.34, n: 4 },
      { u: livingU0 + 1.15, hStack: 0.72, n: 9 },
    ];
    const stkThk = 0.2;
    for (let si = 0; si < stacks.length; si++) {
      const s = stacks[si];
      const vc = loWall(stkThk) + si * 0.02;
      for (let b = 0; b < s.n; b++) {
        const jitterV = (b % 2 ? 0.015 : -0.01);
        add(b % 3 === 0 ? 'book0' : b % 3 === 1 ? 'book1' : 'book2',
          s.u + (b % 2 ? 0.01 : -0.01), vc + jitterV, 0.035, 0.16, stkThk, 0.05 + b * 0.055, 'manga');
      }
      claim(s.u, vc, 0.2, stkThk, 'manga' + si);
    }
  } else if (id === '312') {
    // 干しっぱなしの洗濯物: 室内物干し竿+ぶら下がった布板。洋室ゾーン中央寄りだが
    // ベッド(vMid)を避け、低v側に寄せて竿を渡す。竿の足元は細いのでAABBは小さく。
    const uRack = livingU0 + 1.3;
    const rackThk = 0.5, rackVc = loWall(rackThk + 0.1);
    // 物干しスタンドの脚2本(低い)
    add('metalprop', uRack - 0.5, rackVc, 0.9, 0.04, 0.04, 0.45, 'rackleg');
    add('metalprop', uRack + 0.5, rackVc, 0.9, 0.04, 0.04, 0.45, 'rackleg');
    add('metalprop', uRack, rackVc, 0.04, 1.04, 0.04, 0.9, 'rackbar');  // 横棒
    // ぶら下がる布(板)4枚
    const clothU = [uRack - 0.36, uRack - 0.1, uRack + 0.16, uRack + 0.4];
    const clothCol = ['cloth0', 'cloth1', 'cloth0', 'cloth2'];
    for (let i = 0; i < clothU.length; i++) {
      add(clothCol[i], clothU[i], rackVc, 0.5, 0.02, 0.24, 0.62, 'cloth');
    }
    claim(uRack, rackVc, 1.1, rackThk, 'dryrack');
  } else if (id === '409') {
    // 散らかった机まわり: デスク上に空き缶・スナック袋・積まれた紙。デスク座標を再現。
    const deskUc = livingU0 + 0.55, deskThk = 0.5, deskVc = loVc(deskThk);
    const topY = 0.74; // デスク天板上面(residentialLayout: 天板hc=0.72,厚0.04 → 上面0.74)
    // 空き缶3本(倒れ/立ち)
    add('metalprop', deskUc - 0.28, deskVc - 0.05, 0.12, 0.05, 0.05, topY + 0.06, 'can');
    add('metalprop', deskUc - 0.12, deskVc + 0.08, 0.05, 0.12, 0.05, topY + 0.025, 'can'); // 倒れた缶
    add('metalprop', deskUc + 0.34, deskVc + 0.02, 0.12, 0.05, 0.05, topY + 0.06, 'can');
    // スナック袋(しわの寄った薄い板)
    add('snack', deskUc + 0.1, deskVc + 0.1, 0.03, 0.2, 0.14, topY + 0.02, 'snackbag');
    // 積まれた紙
    add('paperprop', deskUc - 0.05, deskVc - 0.12, 0.06, 0.22, 0.3, topY + 0.03, 'papers');
    // デスク自体は residentialLayout が既に置いており足元占有済み=通路検証済み。
    // 私物はすべて天板上(足元AABB不要)。念のためデスク帯に交差しないことは自明。
    setHit(deskUc, deskVc, topY + 0.15, 0.9, 0.5, 0.5, 'friend_prop_409');
  }

  // === 生成時アサート: 私物の足元AABBが (a)玄関→リビング通路 (b)ベッド下隠れスポット と
  //     交差しないこと(通路0.9m確保・隠れスポット確保の両方をここで保証) ===
  for (const a of propAABBs) {
    const hitsCorridor = a.u0 < corridorRect.u1 && a.u1 > corridorRect.u0 &&
                         a.v0 < corridorRect.v1 && a.v1 > corridorRect.v0;
    if (hitsCorridor) {
      throw new Error(
        `[friendRoomProps] 居室${id}: 私物「${a.label}」が玄関→リビング通路` +
        `(u:0..${corridorRect.u1.toFixed(2)}, v:${corrV0.toFixed(2)}..${corrV1.toFixed(2)}) に侵入 ` +
        `(私物 u:${a.u0.toFixed(2)}..${a.u1.toFixed(2)}, v:${a.v0.toFixed(2)}..${a.v1.toFixed(2)})`,
      );
    }
    const hitsBed = a.u0 < bedRect.u1 && a.u1 > bedRect.u0 &&
                    a.v0 < bedRect.v1 && a.v1 > bedRect.v0;
    if (hitsBed) {
      throw new Error(
        `[friendRoomProps] 居室${id}: 私物「${a.label}」がベッド下隠れスポット` +
        `(u:${bedRect.u0.toFixed(2)}..${bedRect.u1.toFixed(2)}, v:${bedRect.v0.toFixed(2)}..${bedRect.v1.toFixed(2)}) を塞ぐ ` +
        `(私物 u:${a.u0.toFixed(2)}..${a.u1.toFixed(2)}, v:${a.v0.toFixed(2)}..${a.v1.toFixed(2)})`,
      );
    }
  }

  return { roomId: id, level, boxes, hit };
}
