// interior_layout.js — P3b: 入れる部屋の内装の配置(THREE 非依存の純関数。data/build_building.mjs が呼んで building.json に書く)。
//  見た目(Blender: tools/blender/build_rooms.py)と当たり・仕掛け(src/world.js・room_props.js・enemy_ai.js)が同じ数値を読む。
//
//  居室(1K)は ref/photos/room_plan_1K.png(DESIGN §2.3)に忠実:
//    玄関土間→シューズケース(反対側) / 片側(A): 洗濯機・洗面台・冷蔵庫＋電子レンジ・折戸クローゼット・デスク＋チェア・柱
//    反対側(B): トイレ(扉)・バス(扉) / 奥: 洋室にベッド(B 側の壁沿い・外壁寄り)・エアコン(外壁の上部)
//    外壁: 掃き出し窓(引き違い。開く側=A 寄りの半分)＋カーテン → バルコニー(奥行 1.0m)
//  局所座標: u = 玄関の壁(扉の面)から外壁へ(0..6.0)、v = 部屋の幅(0..2.9、世界の x か z の増える向き)。
//  A 側 = v の小さい側。扉の面(facing)で左右反転する: W/S 向きの部屋は図面と同じ向き、E/N 向きは鏡像。
//  玄関→洋室の通路1本(前作のアサートを移植): 扉の中心(v=1.45)から幅 0.95 を玄関から洋室の入口(u=3.5)まで、
//  そこから窓の開く側(幅 0.8)まで、足元の家具が一切入らないことを生成時に検査する(違反は throw)。

export const FLOOR_H = 2.9;
export const CEIL_H = 2.4;
export const WALL_T = 0.12;
export const PASSAGE_W = 0.95;
export const LIVING_U0 = 3.5;        // 洋室の入口(これより奥が洋室)
const WIN = { v0: 1.02, v1: 2.62, split: 1.82, h: 2.0 };   // 掃き出し窓(v の範囲、開く側 = v0..split)

// ---------------------------------------------------------------- 局所(u,v) → 世界(x,z)
export function roomFrame(room) {
  const [rx, rz, rw, rd] = room.rect;
  const facing = room.door.facing;                  // 扉の外向き(廊下側)
  const alongX = facing === 'E' || facing === 'W';  // u が x 方向
  const uLen = alongX ? rw : rd, vLen = alongX ? rd : rw;
  const doorHigh = facing === 'E' || facing === 'S';
  const uO = alongX ? rx : rz, vO = alongX ? rz : rx;
  const wu = (u) => uO + (doorHigh ? uLen - u : u);
  const wv = (v) => vO + v;
  const pt = (u, v) => (alongX ? [wu(u), wv(v)] : [wv(v), wu(u)]);
  const rect = (u0, u1, v0, v1) => {
    const a = pt(u0, v0), b = pt(u1, v1);
    return [r4(Math.min(a[0], b[0])), r4(Math.min(a[1], b[1])), r4(Math.max(a[0], b[0])), r4(Math.max(a[1], b[1]))];
  };
  const dirU = doorHigh ? -1 : 1;
  // 局所の向き('+u'…)→ 世界の向き N/S/E/W
  const face = (d) => {
    const s = d[0] === '+' ? 1 : -1;
    if (d[1] === 'u') { const g = s * dirU; return alongX ? (g > 0 ? 'E' : 'W') : (g > 0 ? 'S' : 'N'); }
    return alongX ? (s > 0 ? 'S' : 'N') : (s > 0 ? 'E' : 'W');
  };
  return { room, uLen, vLen, alongX, doorHigh, pt, rect, face, wu, wv, outward: face('+u') };
}
const r4 = (v) => Math.round(v * 1e4) / 1e4;
export const FACING_YAW = { E: -Math.PI / 2, W: Math.PI / 2, S: Math.PI, N: 0 };   // カメラがその向きを見る yaw
export const FACING_VEC = { E: [1, 0], W: [-1, 0], S: [0, 1], N: [0, -1] };

// ---------------------------------------------------------------- 部屋ごとのばらつき(DESIGN 3b-1「同じに見えないように」)
// type: tidy(片付いている) / lived(普通の生活) / messy(散らかった) / vacant(空室=家具だけ)
// curtain: 色(null=カーテンなし) / curtainState: open(両脇に寄せる)・half(開く側だけ開けて残りは閉)・closed(隙間だけ)
// laundry: rail(カーテンレールに洗濯物)・rack(室内の物干しは通路を塞ぐので置かない→窓際の壁にハンガー)・balcony(物干し竿)
// desk: 机の上 / floor: 床の物 / poster: 壁の架空のポスター(図柄のみ・文字なし)
export const UNIT_VARIANTS = {
  103: { type: 'lived', curtain: 'beige', curtainState: 'half', bedding: 'blue', rug: 'gray', laundry: 'rail', desk: ['laptop', 'cup', 'papers'], floor: ['bag'], poster: null, fall: ['vase', 'books'] },
  104: { type: 'vacant', curtain: null, curtainState: 'open', bedding: null, rug: null, laundry: null, desk: [], floor: ['box'], poster: null, fall: ['cans'] },
  109: { type: 'messy', curtain: 'olive', curtainState: 'closed', bedding: 'charcoal', rug: 'rust', laundry: 'balcony', desk: ['monitor', 'cans', 'snack', 'papers'], floor: ['clothes', 'trash', 'box', 'books'], poster: 'p3', fall: ['cans', 'mug'] },
  201: { type: 'tidy', curtain: 'white', curtainState: 'open', bedding: 'white', rug: 'beige', laundry: null, desk: ['laptop', 'lamp', 'plant'], floor: [], poster: 'p1', fall: ['vase', 'books'] },
  210: { type: 'messy', curtain: 'navy', curtainState: 'half', bedding: 'charcoal', rug: null, laundry: 'rail', desk: ['monitor', 'cans', 'books', 'snack'], floor: ['clothes', 'clothes2', 'bag', 'trash'], poster: 'p5', fall: ['cans', 'books'] },
  216: { type: 'lived', curtain: 'wine', curtainState: 'half', bedding: 'terracotta', rug: 'gray', laundry: 'balcony', desk: ['laptop', 'lamp', 'cup'], floor: ['basket'], poster: 'p2', fall: ['vase', 'mug'] },
  222: { type: 'vacant', curtain: 'oldgray', curtainState: 'closed', bedding: null, rug: null, laundry: null, desk: [], floor: ['box', 'box2'], poster: null, fall: ['bottle'] },
  305: { type: 'lived', curtain: 'lightblue', curtainState: 'open', bedding: 'sage', rug: 'green', laundry: 'rail', desk: ['laptop', 'books', 'cup'], floor: ['bag'], poster: 'p4', fall: ['books', 'cans'] },
  313: { type: 'tidy', curtain: 'gray', curtainState: 'half', bedding: 'beige', rug: 'beige', laundry: null, desk: ['monitor', 'lamp', 'plant'], floor: [], poster: null, fall: ['vase', 'mug'] },
  319: { type: 'messy', curtain: 'brown', curtainState: 'closed', bedding: 'blue', rug: 'rust', laundry: 'rail', desk: ['laptop', 'cans', 'snack', 'papers'], floor: ['clothes', 'box', 'books', 'trash'], poster: 'p6', fall: ['cans', 'books'] },
  321: { type: 'lived', curtain: 'teal', curtainState: 'half', bedding: 'lavender', rug: null, laundry: 'balcony', desk: ['laptop', 'lamp', 'cup'], floor: ['basket', 'bag'], poster: 'p2', fall: ['mug', 'vase'] },
  401: { type: 'lived', curtain: 'olive', curtainState: 'half', bedding: 'sage', rug: 'gray', laundry: 'balcony', desk: ['laptop', 'books', 'cup'], floor: ['bag'], poster: 'p3', fall: ['books', 'cans'] },
  404: { type: 'vacant', curtain: null, curtainState: 'open', bedding: null, rug: null, laundry: null, desk: [], floor: ['box'], poster: null, fall: ['cans'] },
  410: { type: 'lived', curtain: 'navy', curtainState: 'half', bedding: 'blue', rug: 'beige', laundry: 'rail', desk: ['laptop', 'lamp', 'cup', 'papers'], floor: ['bag'], poster: 'p1', fall: ['vase', 'books'] },
  413: { type: 'messy', curtain: 'wine', curtainState: 'closed', bedding: 'charcoal', rug: 'rust', laundry: 'rail', desk: ['monitor', 'cans', 'snack', 'books'], floor: ['clothes', 'clothes2', 'trash', 'box'], poster: 'p5', fall: ['cans', 'mug'] },
  418: { type: 'tidy', curtain: 'beige', curtainState: 'open', bedding: 'white', rug: 'green', laundry: null, desk: ['laptop', 'plant', 'lamp'], floor: [], poster: 'p4', fall: ['vase', 'books'] },
  501: { type: 'messy', curtain: 'gray', curtainState: 'half', bedding: 'terracotta', rug: null, laundry: 'rail', desk: ['laptop', 'cans', 'papers', 'snack'], floor: ['clothes', 'books', 'bag'], poster: 'p6', fall: ['cans', 'books'] },
  506: { type: 'tidy', curtain: 'lightblue', curtainState: 'open', bedding: 'white', rug: 'beige', laundry: null, desk: ['monitor', 'lamp', 'plant'], floor: [], poster: null, fall: ['vase', 'mug'] },
  511: { type: 'vacant', curtain: 'oldgray', curtainState: 'half', bedding: null, rug: null, laundry: null, desk: [], floor: ['box'], poster: null, fall: ['bottle'] },
  516: { type: 'lived', curtain: 'teal', curtainState: 'half', bedding: 'lavender', rug: 'gray', laundry: 'balcony', desk: ['laptop', 'cup', 'books'], floor: ['basket'], poster: 'p2', fall: ['mug', 'books'] },
  602: { type: 'tidy', curtain: 'white', curtainState: 'open', bedding: 'sage', rug: 'green', laundry: null, desk: ['laptop', 'lamp'], floor: [], poster: 'p1', fall: ['vase', 'books'] },
  603: { type: 'lived', curtain: 'brown', curtainState: 'half', bedding: 'beige', rug: 'rust', laundry: 'rail', desk: ['monitor', 'cup', 'papers'], floor: ['bag'], poster: 'p3', fall: ['cans', 'mug'] },
  607: { type: 'messy', curtain: 'navy', curtainState: 'closed', bedding: 'blue', rug: null, laundry: 'rail', desk: ['laptop', 'cans', 'books', 'snack'], floor: ['clothes', 'trash', 'box'], poster: 'p6', fall: ['cans', 'books'] },
  610: { type: 'vacant', curtain: null, curtainState: 'open', bedding: null, rug: null, laundry: null, desk: [], floor: ['box', 'box2'], poster: null, fall: ['cans'] },
  701: { type: 'lived', curtain: 'wine', curtainState: 'half', bedding: 'charcoal', rug: 'gray', laundry: 'balcony', desk: ['laptop', 'lamp', 'cup'], floor: ['bag'], poster: 'p4', fall: ['vase', 'mug'] },
  703: { type: 'tidy', curtain: 'beige', curtainState: 'open', bedding: 'white', rug: 'beige', laundry: null, desk: ['monitor', 'plant', 'lamp'], floor: [], poster: 'p5', fall: ['books', 'vase'] },
  705: { type: 'messy', curtain: 'olive', curtainState: 'half', bedding: 'terracotta', rug: 'rust', laundry: 'rail', desk: ['laptop', 'cans', 'snack', 'papers'], floor: ['clothes', 'clothes2', 'box', 'trash'], poster: 'p2', fall: ['cans', 'books'] },
};
// 色(build_rooms.py のパレットのキー。値はガンマ補正前の sRGB 16 進)
export const PALETTE = {
  beige: '#c7b597', navy: '#2c3850', gray: '#6c7075', olive: '#5b6847', wine: '#6a2d34', lightblue: '#8aaec6', white: '#e6e2da',
  brown: '#8f6845', teal: '#38574f', oldgray: '#8d8a80', blue: '#6b7d97', sage: '#a4ae9b', terracotta: '#ad6656', charcoal: '#3a3e48',
  lavender: '#887aa0', rust: '#80473a', green: '#405848',
};

// ---------------------------------------------------------------- 居室(1K)
// 返り値: { items[], decor[], solids[], closet, window, fallables[], points{ entry, room, living }, passage{...} }
//  items: 据え付けの家具(Blender が kind ごとに作る)。b=[x0,z0,x1,z1](世界)、y=[y0,y1](床から)、f=正面の向き(N/S/E/W)
//  solids: 当たり [x0,z0,x1,z1,y0,y1,tall](tall=視線を遮る高さの物)
export function unitInterior(room) {
  const F = roomFrame(room);
  const V = UNIT_VARIANTS[room.id] || { type: 'tidy', curtain: 'beige', curtainState: 'open', bedding: 'white', rug: null, laundry: null, desk: [], floor: [], poster: null, fall: ['vase'] };
  const items = [], decor = [], solids = [], foot = [];
  const put = (k, u0, u1, v0, v1, y0, y1, f, solid, extra = {}) => {
    const it = { k, b: F.rect(u0, u1, v0, v1), y: [y0, y1], f: F.face(f), ...extra };
    items.push(it);
    if (solid) { solids.push([...it.b, y0, y1, solid === 2 ? 1 : 0]); foot.push({ k, u0, u1, v0, v1 }); }
    return it;
  };
  const deco = (k, u0, u1, v0, v1, y0, y1, f, extra = {}) => { const d = { k, b: F.rect(u0, u1, v0, v1), y: [y0, y1], f: F.face(f), ...extra }; decor.push(d); return d; };
  const floorDeco = (k, u0, u1, v0, v1, y1, f, extra = {}) => { foot.push({ k, u0, u1, v0, v1, decor: true }); return deco(k, u0, u1, v0, v1, 0, y1, f, extra); };
  const vac = V.type === 'vacant';
  // 床・土間・框(見た目だけ)
  items.push({ k: 'genkan', b: F.rect(0.06, 0.86, 0.06, 2.84), y: [0, 0.005], f: F.face('+u') });
  // --- A 側(v の小さい側) ---
  put('washer', 0.92, 1.56, 0.06, 0.70, 0, 0.95, '+v', 1);
  put('vanity', 1.62, 2.36, 0.06, 0.58, 0, 0.85, '+v', 1);
  put('fridge', 2.42, 2.98, 0.06, 0.66, 0, 1.45, '+v', 1);
  const closet = put('closet', 3.06, 4.02, 0.06, 0.68, 0, CEIL_H, '+v', 2);
  put('desk', 4.14, 5.16, 0.06, 0.62, 0, 0.72, '+v', 1, { empty: vac });
  put('chair', 4.62, 5.06, 0.64, 1.00, 0, 0.88, '-v', 1);
  put('pillar', 5.40, 5.94, 0.06, 0.48, 0, CEIL_H, '+v', 2);
  put('ac', 5.70, 5.94, 0.62, 1.42, 2.0, 2.3, '-u', 0);
  // --- B 側 ---
  put('shoecase', 0.10, 0.86, 2.44, 2.84, 0, 0.95, '-v', 1);
  put('toilet', 0.94, 1.90, 1.98, 2.84, 0, CEIL_H, '-v', 2);
  put('bath', 1.94, 3.46, 1.98, 2.84, 0, CEIL_H, '-v', 2);
  put('bed', 3.62, 5.62, 1.88, 2.84, 0, 0.55, '+u', 1, { bedding: V.bedding, made: V.type === 'tidy' });
  // --- 天井・壁の付属(見た目だけ) ---
  items.push({ k: 'ceilinglight', b: F.rect(4.3, 4.9, 1.15, 1.75), y: [CEIL_H - 0.09, CEIL_H], f: 'D' });
  items.push({ k: 'switch', b: F.rect(0.9, 0.98, 0.06, 0.075), y: [1.15, 1.27], f: F.face('+v') });   // 玄関の照明スイッチ(洗濯機の上の壁)
  items.push({ k: 'intercom', b: F.rect(0.36, 0.5, 0.06, 0.08), y: [1.3, 1.5], f: F.face('+v') });
  items.push({ k: 'breaker', b: F.rect(0.94, 1.26, 2.82, 2.84), y: [1.75, 2.1], f: F.face('-v') });  // トイレの壁の上(分電盤)
  // --- 掃き出し窓・カーテン ---
  const wa = F.pt(6.0, WIN.v0), wb = F.pt(6.0, WIN.v1), ws = F.pt(6.0, WIN.split);
  const along = F.alongX ? 1 : 0;   // 窓の壁に沿う世界の軸(0=x, 1=z)
  const window = {
    pos: [r4((wa[0] + wb[0]) / 2), r4((wa[1] + wb[1]) / 2)], facing: F.outward, width: r4(WIN.v1 - WIN.v0), h: WIN.h,
    axis: along === 1 ? 'z' : 'x',
    open: [r4(wa[along]), r4(ws[along])].sort((a, b) => a - b), fix: [r4(ws[along] - 0.04), r4(wb[along])].sort((a, b) => a - b),
    line: r4(F.alongX ? F.wu(6.0) : F.wu(6.0)),
  };
  if (V.curtain) {
    deco('curtain', 5.80, 5.86, 0.62, 2.80, 0.05, 2.22, '-u', { c: V.curtain, state: V.curtainState, open: [WIN.v0, WIN.split] });
  }
  deco('curtainrail', 5.84, 5.88, 0.6, 2.82, 2.22, 2.25, '-u');
  if (V.laundry === 'rail') deco('hangers', 5.70, 5.80, 1.95, 2.55, 1.35, 2.2, '-u', { c: V.bedding || 'gray' });
  // --- 机の上・床・壁 ---
  const dy = 0.72;
  for (const it of V.desk) {
    if (it === 'laptop') deco('laptop', 4.66, 5.0, 0.16, 0.42, dy, dy + 0.22, '+v');
    if (it === 'monitor') deco('monitor', 4.6, 5.1, 0.1, 0.3, dy, dy + 0.42, '+v');
    if (it === 'lamp') deco('lamp', 5.0, 5.12, 0.1, 0.22, dy, dy + 0.42, '+v');
    if (it === 'cup') deco('cup', 4.5, 4.58, 0.4, 0.48, dy, dy + 0.1, '+v');
    if (it === 'papers') deco('papers', 4.3, 4.6, 0.12, 0.34, dy, dy + 0.02, '+v');
    if (it === 'plant') deco('plant', 4.18, 4.3, 0.1, 0.22, dy, dy + 0.26, '+v');
    if (it === 'books') deco('books', 4.18, 4.4, 0.08, 0.26, dy, dy + 0.12, '+v');
    if (it === 'cans') deco('cans', 4.95, 5.12, 0.36, 0.5, dy, dy + 0.12, '+v');
    if (it === 'snack') deco('snack', 4.62, 4.84, 0.4, 0.56, dy, dy + 0.03, '+v');
  }
  if (!vac) deco('shelf', 4.18, 5.1, 0.06, 0.28, 1.36, 1.62, '+v', { books: V.type === 'messy' ? 7 : 5 });
  for (const it of V.floor) {
    // 床の物は通路(玄関→洋室→窓)に入れない(アサート対象)。机の下・ベッドの上・玄関の脇・ベッドと柱の間
    if (it === 'bag') floorDeco('bag', 4.2, 4.55, 0.1, 0.38, 0.4, '+v');                    // 机の下
    if (it === 'box') floorDeco('box', 4.9, 5.16, 0.08, 0.5, 0.36, '+v');                   // 机の下(右)
    if (it === 'box2') deco('box', 3.8, 4.4, 2.0, 2.5, 0.55, 1.0, '+v');                    // ベッドの上(空室の荷物)
    if (it === 'basket') floorDeco('basket', 5.20, 5.62, 0.52, 0.98, 0.32, '+v');           // 柱の前
    if (it === 'trash') floorDeco('trash', 0.14, 0.5, 0.1, 0.46, 0.55, '+v');               // 玄関の A 側(洗濯機の手前)
    if (it === 'clothes') deco('clothes', 4.0, 4.7, 2.0, 2.6, 0.5, 0.66, '+v', { c: V.bedding === 'charcoal' ? 'beige' : 'charcoal' });   // ベッドの上
    if (it === 'clothes2') floorDeco('clothes', 5.62, 5.92, 1.9, 2.5, 0.12, '+v', { c: 'navy' });   // ベッドの足元と窓の間
    if (it === 'books') floorDeco('books', 5.18, 5.38, 0.08, 0.3, 0.3, '+v');               // 机と柱の間の床
  }
  if (V.rug) deco('rug', 3.62, 5.3, 1.0, 1.86, 0, 0.008, '+u', { c: V.rug });
  if (V.poster) deco('poster', 4.1, 4.7, 2.83, 2.84, 1.2, 1.95, '-v', { p: V.poster });
  deco('clock', 4.5, 4.78, 0.06, 0.08, 1.85, 2.13, '+v');
  if (!vac) deco('shoes', 0.2, 0.75, 1.15, 1.75, 0, 0.1, '+u');
  if (V.type === 'messy') deco('umbrella', 0.14, 0.22, 2.3, 2.4, 0, 0.85, '-v');
  // --- 落ちる物(DESIGN §3.4.1 物音の障害物): 通路の脇に1つ・机の端に1つ。慎重に歩けば避けられる位置 ---
  const fallables = [];
  const addFall = (type, u, v, y, support) => {
    const [x, z] = F.pt(u, v);
    fallables.push({ id: `${room.id}_${type}_${fallables.length}`, room: room.id, type, x: r4(x), y, z: r4(z), support });
  };
  for (const t of V.fall || []) {
    if (t === 'vase') addFall('vase', 0.42, 2.48, 0.95, 'shoecase');          // 玄関のシューズケースの上・通路側の縁
    else if (t === 'cans') addFall('cans', 2.08, 0.82, 0, 'floor');           // 洗面台の前の床(通路の左端に寄ると当たる)
    else if (t === 'bottle') addFall('bottle', 2.7, 0.84, 0, 'floor');        // 冷蔵庫の前の床
    else if (t === 'books') addFall('books', 4.24, 0.55, 0.72, 'desk');       // 机の端(通路側の角)
    else if (t === 'mug') addFall('mug', 4.26, 0.56, 0.72, 'desk');
  }
  // --- 隠れ場所(クローゼット)・管理人の立ち位置 ---
  const [cx0, cz0, cx1, cz1] = closet.b;
  const fv = FACING_VEC[closet.f];
  const ccx = (cx0 + cx1) / 2, ccz = (cz0 + cz1) / 2;
  const doorPlane = F.pt(3.54, 0.68);
  const hide = {
    room: room.id, b: closet.b, f: closet.f,
    eye: [r4(doorPlane[0] - fv[0] * 0.16), r4(doorPlane[1] - fv[1] * 0.16)],    // 扉の隙間の 16cm 奥
    feet: [r4(ccx), r4(ccz)],
    out: F.pt(3.54, 1.25).map(r4),                                             // 出た時に立つ場所(通路)
    stand: F.pt(3.54, 1.42).map(r4),                                           // 管理人が立ち止まる所(扉の 0.74m 前)
    yaw: FACING_YAW[closet.f],
  };
  const points = { entry: F.pt(1.3, 1.45).map(r4), room: F.pt(2.7, 1.45).map(r4), living: F.pt(4.4, 1.45).map(r4), window: F.pt(5.6, 1.42).map(r4) };
  // === 生成時アサート: 通路(玄関→洋室入口、洋室→窓の開く側)に足元の物が無い ===
  const passage = [
    { u0: 0, u1: LIVING_U0, v0: 1.45 - PASSAGE_W / 2, v1: 1.45 + PASSAGE_W / 2 },
    { u0: LIVING_U0, u1: 5.94, v0: WIN.v0 + 0.02, v1: WIN.split + 0.02 },
  ];
  for (const a of foot) for (const p of passage) {
    if (a.u0 < p.u1 && a.u1 > p.u0 && a.v0 < p.v1 && a.v1 > p.v0) {
      throw new Error(`[unitInterior] ${room.id}: 「${a.k}」が通路(u ${p.u0}..${p.u1}, v ${p.v0.toFixed(3)}..${p.v1.toFixed(3)})に入っている (u ${a.u0}..${a.u1}, v ${a.v0}..${a.v1})`);
    }
  }
  // 落ちる物も通路の中には置かない(通路の外の縁)
  for (const fl of fallables) for (const p of passage) {
    const [u, v] = local(F, fl.x, fl.z);
    if (u > p.u0 && u < p.u1 && v > p.v0 && v < p.v1) throw new Error(`[unitInterior] ${room.id}: 落ちる物 ${fl.type} が通路の中`);
  }
  return {
    kind: 'unit', variant: { ...V }, items, decor, solids, fallables, hide, window, points,
    passage: passage.map((p) => ({ ...p, rect: F.rect(p.u0, p.u1, p.v0, p.v1) })),
  };
}

// 世界(x,z) → 局所(u,v)
export function local(F, x, z) {
  const a = F.alongX ? x : z, b = F.alongX ? z : x;
  const [rx, rz, rw, rd] = F.room.rect;
  const uO = F.alongX ? rx : rz, vO = F.alongX ? rz : rx;
  const u = F.doorHigh ? F.uLen - (a - uO) : a - uO;
  return [u, b - vO];
}

// ---------------------------------------------------------------- バルコニー(全居室)
// rect=[x,z,w,d]、facing=外向き、ends: 壁に沿う向きの低い側/高い側の端(partition=隔て板、gate=屋上Aへ乗り越える台つき)
export function balconyOf(room, level, gates = {}) {
  const F = roomFrame(room);
  const [rx, rz, rw, rd] = room.rect;
  const D = 1.0;
  let rect;
  switch (F.outward) {
    case 'E': rect = [rx + rw, rz, D, rd]; break;
    case 'W': rect = [rx - D, rz, D, rd]; break;
    case 'S': rect = [rx, rz + rd, rw, D]; break;
    default: rect = [rx, rz - D, rw, D];
  }
  // 室外機(高い側の端・外壁際。入れる部屋では当たり)。401 は北端の踊み台が室外機を兼ねる(屋上A の台)
  const axis = (F.outward === 'E' || F.outward === 'W') ? 'z' : 'x';
  const [bx, bz, bw, bd] = rect;
  const hi = axis === 'z' ? bz + bd : bx + bw;
  let ac = null;
  if (!(gates.lo === 'gate' && room.id === '401')) {
    const fsgn = (F.outward === 'E' || F.outward === 'S') ? 1 : -1;
    const facade = axis === 'z' ? (fsgn > 0 ? bx : bx + bw) : (fsgn > 0 ? bz : bz + bd);
    const a = [facade + fsgn * 0.06, facade + fsgn * 0.36].sort((p, q) => p - q);
    ac = axis === 'z' ? [a[0], hi - 0.95, a[1], hi - 0.15] : [hi - 0.95, a[0], hi - 0.15, a[1]];
    ac = ac.map(r4);
  }
  return {
    rect: rect.map(r4), facing: F.outward, axis,
    rail: level <= 3 ? 'glass' : 'grid', ends: { lo: gates.lo || 'partition', hi: gates.hi || 'partition' }, ac,
  };
}

// ---------------------------------------------------------------- 1F の共用室(食堂・シアター・管理室)
// 座標は世界(1F の床からの高さ)。食堂・シアターの床・壁・天井は外殻(P3a)のまま、家具だけ足す。管理室は内装ごと作る。
export function commonInterior(room) {
  const items = [], decor = [], solids = [], fallables = [];
  const R = (v) => r4(v);
  const put = (k, x0, z0, x1, z1, y0, y1, f, solid, extra = {}) => {
    const it = { k, b: [R(x0), R(z0), R(x1), R(z1)], y: [y0, y1], f, ...extra };
    items.push(it);
    if (solid) solids.push([...it.b, y0, y1, solid === 2 ? 1 : 0]);
    return it;
  };
  const deco = (k, x0, z0, x1, z1, y0, y1, f, extra = {}) => { const d = { k, b: [R(x0), R(z0), R(x1), R(z1)], y: [y0, y1], f, ...extra }; decor.push(d); return d; };
  const addFall = (type, x, y, z, support) => fallables.push({ id: `${room.id}_${type}_${fallables.length}`, room: room.id, type, x: R(x), y, z: R(z), support });
  let hide = null, points = null, passage = [];
  if (room.id === 'DINING') {
    // 4人掛けのテーブル 12 卓(中央の通路 x 6.0〜7.8 を空ける)・配膳カウンター(厨房の壁)・給茶機・下膳棚・掲示板・テレビ
    for (const x0 of [1.1, 3.5, 9.1, 11.5]) {
      for (const zc of [6.2, 8.15, 10.1]) {
        put('dtable', x0, zc - 0.375, x0 + 1.2, zc + 0.375, 0, 0.70, 'N', 1);
        for (const dx of [0.3, 0.9]) {
          put('dchair', x0 + dx - 0.21, zc - 0.83, x0 + dx + 0.21, zc - 0.41, 0, 0.82, 'S', 1);
          put('dchair', x0 + dx - 0.21, zc + 0.41, x0 + dx + 0.21, zc + 0.83, 0, 0.82, 'N', 1);
        }
      }
    }
    put('counter', 0.4, 4.41, 5.6, 4.95, 0, 0.9, 'S', 1);
    deco('shutter', 1.0, 4.41, 5.0, 4.43, 1.05, 2.0, 'S');           // 配膳口(閉じたシャッター)
    deco('trays', 4.6, 4.5, 5.4, 4.86, 0.9, 1.05, 'S');
    put('dispenser', 8.0, 4.41, 8.45, 4.86, 0, 1.35, 'S', 1);
    put('trayrack', 13.29, 6.9, 13.74, 7.7, 0, 1.5, 'W', 1);
    put('bin', 13.3, 8.0, 13.7, 8.4, 0, 0.75, 'W', 1);
    put('bin', 13.3, 8.45, 13.7, 8.85, 0, 0.75, 'W', 1);
    deco('board', 1.0, 11.52, 3.2, 11.54, 1.15, 2.0, 'N', { p: 'notice' });
    deco('tv', 13.66, 9.0, 13.74, 10.15, 1.55, 2.2, 'W');
    deco('clock', 6.75, 11.52, 7.05, 11.54, 2.06, 2.34, 'N');
    deco('vaseflower', 4.5, 8.05, 4.66, 8.25, 0.70, 0.98, 'N');   // (飾り。落ちる花瓶は別)
    addFall('vase', 4.62, 0.70, 6.2, 'table');                     // 通路側の卓の端(テーブルの端を通る時に触れると落ちる)
    addFall('cup', 9.16, 0.70, 10.1, 'table');
    points = { entry: [6.9, 11.0], room: [6.9, 8.0], living: [6.9, 6.0] };
  } else if (room.id === 'THEATER') {
    // スクリーン(既存・南の壁)に向いた 3 人掛けソファ 2 列・スピーカー・天井のプロジェクター
    put('sofa', 10.6, 24.05, 12.8, 24.9, 0, 0.82, 'S', 1);
    put('sofa', 10.6, 25.45, 12.8, 26.3, 0, 0.82, 'S', 1);
    put('speaker', 8.2, 27.6, 8.6, 28.0, 0, 1.0, 'N', 1);
    put('speaker', 13.2, 27.6, 13.6, 28.0, 0, 1.0, 'N', 1);
    deco('projector', 10.95, 23.1, 11.45, 23.5, 2.2, 2.4, 'S');
    put('lowtable', 11.0, 26.75, 12.4, 27.2, 0, 0.38, 'N', 1);
    addFall('cans', 10.42, 0, 25.0, 'floor');                      // ソファの端の床(通路の東の縁)
    points = { entry: [9.0, 22.8], room: [9.0, 25.0], living: [9.2, 26.8] };
  } else if (room.id === 'OFFICE') {
    // 管理室: 受付の小窓(西の壁)の下に机・椅子・監視モニター、東の壁に棚・キーボックス、南東に縦長ロッカー(隠れ場所)
    put('odesk', 19.66, 25.7, 20.31, 27.6, 0, 0.72, 'E', 1);
    put('ochair', 20.42, 26.45, 20.88, 26.95, 0, 0.95, 'W', 1);
    deco('monitors', 19.7, 25.85, 19.98, 26.35, 0.72, 1.2, 'E');
    deco('phone', 20.0, 27.2, 20.22, 27.42, 0.72, 0.8, 'E');
    deco('binders', 19.7, 27.0, 19.96, 27.55, 0.72, 1.0, 'E');
    put('oshelf', 21.5, 22.6, 21.94, 24.2, 0, 1.8, 'W', 2);
    deco('keybox', 21.88, 24.55, 21.94, 25.15, 1.2, 1.8, 'W');
    put('safe', 19.7, 27.62, 20.15, 28.0, 0, 0.55, 'E', 1);
    const lk = put('locker', 21.4, 26.9, 21.94, 27.5, 0, 1.85, 'W', 2);
    deco('calendar', 21.92, 25.6, 21.94, 26.1, 1.3, 1.9, 'W');
    deco('clock', 20.65, 22.18, 20.95, 22.2, 2.06, 2.34, 'S');
    deco('extinguisher', 21.7, 22.25, 21.9, 22.45, 0, 0.55, 'W');
    addFall('mug', 20.24, 0.72, 25.85, 'desk');
    addFall('binders', 21.46, 1.8, 23.0, 'shelf');
    hide = { room: room.id, b: lk.b, f: 'W', eye: [21.52, 27.2], feet: [21.67, 27.2], out: [20.95, 27.2], stand: [20.66, 27.2], yaw: FACING_YAW.W, locker: true };
    points = { entry: [20.8, 22.8], room: [20.9, 24.8], living: [20.9, 26.0] };
    passage = [{ rect: [20.4, 22.16, 21.4, 25.6] }];
    // 当たりが通路(扉→机の前)を塞がない
    for (const s of solids) {
      const p = passage[0].rect;
      if (s[0] < p[2] && s[2] > p[0] && s[1] < p[3] && s[3] > p[1]) throw new Error(`[commonInterior] OFFICE: 当たり ${JSON.stringify(s)} が通路に入っている`);
    }
  }
  return { kind: 'common', items, decor, solids, fallables, hide, points, passage };
}
