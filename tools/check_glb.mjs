// check_glb.mjs — P3a: 全階の GLB(build/floor_N.glb)の機械テスト(Node・THREE 非依存。GLB を自前でパース)。
//  各階で:
//   1) GLB がパースでき、全プリミティブに TEXCOORD_1(ライトマップ UV)があり [0,1] に収まる。テクスチャは埋め込まない(images 無し)
//   2) manifest のライトマップ・材質テクスチャが存在し、1枚 2048px 以下(法線は 1024 以下)
//   3) 壁ボックスと GLB の当たりのズレ(両方向):
//      a) GLB の壁の見えている鉛直面は、walls.js の衝突箱の面の上にある(面の位置・端 ±5cm、高さは床から天井/階高/扉上)
//      b) 屋内の空気の縁を 0.25m おきに外へ探り、当たる衝突箱の面に GLB の壁の面がある(見えない壁が無い)
//   4) 外周の閉じ: 当たり(扉は閉、階段の段の手前の当たり込み)を 0.3m 格子で塗り、外周の外へ漏れない(屋上B も)
//   5) 扉: 居室の扉板の数 = その階の号室数(図面のインベントリ)。扉板は衝突箱(閉扉)の中(±5cm)。号室プレート付き
//   6) EV と外階段の全階接続: 各階に EV 扉2枚・カゴの行き先ボタン・外階段の鉄扉と段(上の階の踊り場の高さまで)。
//      7F の段は屋上B の高さまで。1〜3F に北階段(P3a-2: 屋外の鉄骨。2F・3F に鉄扉、1F は地面)。
//   7) P3a-2: 1F に地下への階段(段が B1 の床まで下りる・B1 の施錠扉)。B1 の当たりが閉じている
//   8) P3b: 入れる部屋(内装の壁の面が部屋の矩形の内側の面にある・家具・クローゼットの折戸/ロッカーの扉・掃き出し窓の障子)、
//      バルコニー(床・手すり・隔て板)、4F の屋上A。2枚目のライトマップ(部屋の組)が存在し 2048px 以下
//   9) P3c: 外観・外環境 build/exterior.glb(ノードの顔ぶれ・ライトマップの UV なし・テクスチャ非埋め込み・階の帯の高さと「建物の中に面が無い」・
//      外構の当たりの箱ごとに見た目がある・敷地の中の地形は外構の面の下・木の配置ファイルの件数と敷地の中に木が無い・灯りの点いた窓は施錠の空室)
//  最後に追加アセットの合計(GLB＋ライトマップ2種＋build/tex＋外観)を表示し、35MB(DESIGN §2.3、2026-11-01 に 25→35MB)を超えたら失敗。
// 実行: node tools/check_glb.mjs [--floor 4] [--verbose]   失敗時は非0終了。

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { floorWallBoxes, GEOM } from '../src/walls.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOL = 0.05;
const args = process.argv.slice(2);
const onlyFloor = args.includes('--floor') ? +args[args.indexOf('--floor') + 1] : null;
const verbose = args.includes('--verbose');
const building = JSON.parse(readFileSync(join(ROOT, 'data', 'building.json'), 'utf8'));
const EXPECT_UNITS = { 1: 9, 2: 22, 3: 22, 4: 19, 5: 16, 6: 11, 7: 5 };   // 図面のインベントリ(build_building.mjs と同じ)
let failures = 0;
const fail = (m) => { failures++; console.error('FAIL:', m); };

// ---------------------------------------------------------------- GLB
function parseGLB(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8;
  const bin = buf.subarray(binStart, binStart + buf.readUInt32LE(20 + jsonLen));
  return { gltf, bin, size: buf.length };
}
const COMP = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function readAccessor(g, i) {
  const { gltf, bin } = g;
  const a = gltf.accessors[i];
  const bv = gltf.bufferViews[a.bufferView];
  const size = COMP[a.componentType], n = NCOMP[a.type];
  const stride = bv.byteStride || size * n;
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const out = new Float64Array(a.count * n);
  const dv = new DataView(bin.buffer, bin.byteOffset);
  for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) {
    const off = base + k * stride + c * size;
    out[k * n + c] = a.componentType === 5126 ? dv.getFloat32(off, true) : a.componentType === 5125 ? dv.getUint32(off, true) : a.componentType === 5123 ? dv.getUint16(off, true) : dv.getUint8(off);
  }
  return out;
}
function mat4FromTRS(node) {
  if (node.matrix) return node.matrix.slice();
  const [tx, ty, tz] = node.translation || [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale || [1, 1, 1];
  const xx = qx * qx, yy = qy * qy, zz = qz * qz, xy = qx * qy, xz = qx * qz, yz = qy * qz, wx = qw * qx, wy = qw * qy, wz = qw * qz;
  return [(1 - 2 * (yy + zz)) * sx, 2 * (xy + wz) * sx, 2 * (xz - wy) * sx, 0, 2 * (xy - wz) * sy, (1 - 2 * (xx + zz)) * sy, 2 * (yz + wx) * sy, 0,
    2 * (xz + wy) * sz, 2 * (yz - wx) * sz, (1 - 2 * (xx + yy)) * sz, 0, tx, ty, tz, 1];
}
function mul(a, b) { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; }
const xf = (m, x, y, z) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
function nodeTris(g, world, i) {
  const out = [];
  const visit = (j) => {
    const node = g.gltf.nodes[j];
    const m = world.get(j);
    if (node.mesh !== undefined) for (const p of g.gltf.meshes[node.mesh].primitives) {
      const pos = readAccessor(g, p.attributes.POSITION);
      const idx = p.indices !== undefined ? readAccessor(g, p.indices) : Array.from({ length: pos.length / 3 }, (_, k) => k);
      const P = (k) => xf(m, pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
      for (let t = 0; t < idx.length; t += 3) out.push({ v: [P(idx[t]), P(idx[t + 1]), P(idx[t + 2])], mat: p.material });
    }
    for (const c of node.children || []) visit(c);
  };
  visit(i);
  return out;
}
const triNormal = (t) => { const [a, b, c] = t; const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]; const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; const L = Math.hypot(...n) || 1; return n.map((x) => x / L); };
function imageSize(bytes) {
  if (bytes[0] === 0x89) return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  if (bytes.toString('ascii', 0, 4) === 'RIFF') {   // WebP
    const fmt = bytes.toString('ascii', 12, 16);
    if (fmt === 'VP8 ') return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
    if (fmt === 'VP8L') { const b = bytes.readUInt32LE(21); return [(b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1]; }
    if (fmt === 'VP8X') return [1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3)];
  }
  let o = 2;
  while (o < bytes.length) {
    if (bytes[o] !== 0xff) { o++; continue; }
    const mk = bytes[o + 1], len = bytes.readUInt16BE(o + 2);
    if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) return [bytes.readUInt16BE(o + 7), bytes.readUInt16BE(o + 5)];
    o += 2 + len;
  }
  return [0, 0];
}

// ---------------------------------------------------------------- 当たり(world.js と同じ箱)
const levelY = (k) => (k === 'RB' ? 7 : k === 'B1' ? -1 : k - 1) * GEOM.FLOOR_H;
function collisionBoxes(floor, key) {
  const bs = floorWallBoxes(floor).map((b) => ({ minX: b.cx - b.w / 2, maxX: b.cx + b.w / 2, minZ: b.cz - b.d / 2, maxZ: b.cz + b.d / 2, kind: b.kind, roomId: b.roomId || null, part: b.part }));
  if (floor.shell) for (const c of floor.shell.caps) { const minX = c.normal === 'W' ? c.x : c.x - 0.12; bs.push({ minX, maxX: minX + 0.12, minZ: c.z0, maxZ: c.z1, kind: 'cap' }); }
  for (const st of building.stairs) if (st.stops.includes(key)) { const [x, z, w, d] = st.geom.guard; bs.push({ minX: x, maxX: x + w, minZ: z, maxZ: z + d, kind: 'stairguard' }); }
  return bs;
}

// ---------------------------------------------------------------- 1階ぶん
function checkFloor(N) {
  const floor = building.floors.find((f) => f.level === N);
  const glbPath = join(ROOT, 'build', `floor_${N}.glb`);
  const manPath = join(ROOT, 'build', `floor_${N}_manifest.json`);
  if (!existsSync(glbPath) || !existsSync(manPath)) { fail(`F${N}: GLB/manifest がない`); return null; }
  const g = parseGLB(glbPath);
  const man = JSON.parse(readFileSync(manPath, 'utf8'));
  const base = levelY(N);
  const world = new Map();
  const walk = (i, parent) => { const m = mul(parent, mat4FromTRS(g.gltf.nodes[i])); world.set(i, m); for (const c of g.gltf.nodes[i].children || []) walk(c, m); };
  for (const r of g.gltf.scenes[g.gltf.scene || 0].nodes) walk(r, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const R = { floor: N, glbMB: +(g.size / 1e6).toFixed(2) };

  // 1) UV2・埋め込み
  let prims = 0, tris = 0, missing = 0, uvOut = 0;
  for (const node of g.gltf.nodes) {
    if (node.mesh === undefined) continue;
    for (const p of g.gltf.meshes[node.mesh].primitives) {
      prims++;
      tris += (p.indices !== undefined ? g.gltf.accessors[p.indices].count : g.gltf.accessors[p.attributes.POSITION].count) / 3;
      if (p.attributes.TEXCOORD_1 === undefined) { missing++; continue; }
      const uv = readAccessor(g, p.attributes.TEXCOORD_1);
      for (const v of uv) if (v < -1e-4 || v > 1 + 1e-4) { uvOut++; break; }
    }
  }
  if (missing) fail(`F${N}: TEXCOORD_1 のないプリミティブ ${missing}`);
  if (uvOut) fail(`F${N}: TEXCOORD_1 が [0,1] 外 ${uvOut}`);
  if ((g.gltf.images || []).length) fail(`F${N}: GLB にテクスチャが埋め込まれている(${g.gltf.images.length})`);
  Object.assign(R, { prims, tris });

  // 2) ライトマップ・材質テクスチャ
  const lm = join(ROOT, 'build', man.lightmap.file);
  if (!existsSync(lm)) fail(`F${N}: ライトマップがない ${man.lightmap.file}`);
  else {
    const [w, h] = imageSize(readFileSync(lm));
    if (w > 2048 || h > 2048) fail(`F${N}: ライトマップが 2048px 超`);
    R.lightmap = `${w}x${h} ${(statSync(lm).size / 1e6).toFixed(2)}MB`;
  }
  for (const [mname, def] of Object.entries(man.materials || {})) {
    for (const k of ['map', 'normalMap', 'roughnessMap', 'emissiveMap']) {
      if (!def[k]) continue;
      const p = join(ROOT, def[k]);
      if (!existsSync(p)) { fail(`F${N}: ${mname}.${k} のファイルがない ${def[k]}`); continue; }
      const [w, h] = imageSize(readFileSync(p));
      if (w > 2048 || h > 2048 || (k === 'normalMap' && (w > 1024 || h > 1024))) fail(`F${N}: ${def[k]} が大きすぎる ${w}x${h}`);
    }
  }
  const nodeNames = new Set(g.gltf.nodes.map((n) => n.name));
  for (const name of Object.keys(man.meshes)) if (!nodeNames.has(name)) fail(`F${N}: manifest のメッシュが GLB にない ${name}`);
  // 8) P3b: 2枚目のライトマップ(部屋の組)
  if (man.lightmap2) {
    const lm2 = join(ROOT, 'build', man.lightmap2.file);
    if (!existsSync(lm2)) fail(`F${N}: 部屋の組のライトマップがない ${man.lightmap2.file}`);
    else {
      const [w, h] = imageSize(readFileSync(lm2));
      if (w > 2048 || h > 2048) fail(`F${N}: 部屋の組のライトマップが 2048px 超`);
      R.lightmap2 = `${w}x${h} ${(statSync(lm2).size / 1e6).toFixed(2)}MB`;
    }
  } else fail(`F${N}: 部屋の組のライトマップ(lightmap2)が manifest に無い`);
  // 8) P3b: 入れる部屋の内装とバルコニー(動かないメッシュは export.py が組×種類ごとに1つへまとめる: ノード名 J<組>_<種類>)
  {
    const enter = floor.rooms.filter((r) => r.door && r.door.enterable);
    const kindNodes = (k) => g.gltf.nodes.map((n, i) => [n, i]).filter(([n]) => n.extras && n.extras.n2_kind === k && n.mesh !== undefined);
    const kindTrisIn = (k, [x0, z0, w, d]) => kindNodes(k).some(([, i]) => nodeTris(g, world, i).some((t) => { const cx = (t.v[0][0] + t.v[1][0] + t.v[2][0]) / 3, cz = (t.v[0][2] + t.v[1][2] + t.v[2][2]) / 3; return cx > x0 && cx < x0 + w && cz > z0 && cz < z0 + d; }));
    const need8 = [];
    for (const r of enter) {
      if (r.kind === 'unit') need8.push(`ClosetDoor_L_${r.id}`, `ClosetDoorIn_R_${r.id}`, `WinSash_${r.id}`);
      if (r.id === 'OFFICE') need8.push('LockerDoor_OFFICE');
    }
    for (const nm of need8) if (!nodeNames.has(nm)) fail(`F${N}: ${nm} がない`);
    for (const r of enter.concat(floor.rooms.filter((rr) => rr.id === 'DINING' || rr.id === 'THEATER'))) {
      if (!kindTrisIn('furn', r.rect)) fail(`F${N}: ${r.id} に家具がない`);
      if ((r.kind === 'unit' || r.id === 'OFFICE') && !kindTrisIn('roomwall', r.rect)) fail(`F${N}: ${r.id} に内装の壁がない`);
      if (r.kind === 'unit' && !kindTrisIn('decor', r.rect)) fail(`F${N}: ${r.id} に小物がない`);
    }
    for (const r of floor.rooms.filter((rr) => rr.balcony)) {
      const [bx, bz, bw, bd] = r.balcony.rect;
      if (!kindTrisIn('balcony', [bx + 0.05, bz + 0.05, bw - 0.1, bd - 0.1])) { fail(`F${N}: ${r.id} のバルコニーの床がない`); break; }
    }
    if (floor.rooms.some((r) => r.balcony)) for (const k of ['balrail', 'partition', 'facade']) if (!kindNodes(k).length) fail(`F${N}: バルコニーの ${k} がない`);
    if (N === 4) for (const k of ['roofA', 'parapet']) if (!kindNodes(k).length) fail(`F4: 屋上A の ${k} がない`);
    // 内装の壁の面(n2_kind roomwall)は部屋の矩形の内側の面(線 ± 壁厚/2)にある(±2cm)・床から天井まで
    let rmMax = 0, rmFaces = 0;
    const walled = enter.filter((r) => r.kind === 'unit' || r.id === 'OFFICE');
    for (const [, i] of kindNodes('roomwall')) {
      for (const t of nodeTris(g, world, i)) {
        const nr = triNormal(t.v);
        let axis = null;
        if (Math.abs(nr[0]) > 0.99) axis = 'x'; else if (Math.abs(nr[2]) > 0.99) axis = 'z'; else continue;
        const ys = t.v.map((p) => p[1]);
        if (Math.max(...ys) - Math.min(...ys) < 0.1) continue;   // 幅木の上面など
        const cx = (t.v[0][0] + t.v[1][0] + t.v[2][0]) / 3, cz = (t.v[0][2] + t.v[1][2] + t.v[2][2]) / 3;
        // P5b-1: 隣り合う入れる部屋(221/220・601/602 など)では、隣の部屋の壁の面も ±0.2m に入るので、いちばん近い部屋の面で測る
        const cands = walled.filter((rr) => cx > rr.rect[0] - 0.2 && cx < rr.rect[0] + rr.rect[2] + 0.2 && cz > rr.rect[1] - 0.2 && cz < rr.rect[1] + rr.rect[3] + 0.2);
        if (!cands.length) continue;   // 管理室の受付の小窓の見込みなど(部屋の外側)
        const pl = t.v[0][axis === 'x' ? 0 : 2];
        const t2 = GEOM.WALL_T / 2;
        const devOf = (rr) => { const [x, z, w, d] = rr.rect; const planes = { x: [x + t2, x + w - t2], z: [z + t2, z + d - t2] }; return Math.min(...planes[axis].map((q) => Math.abs(q - pl))); };
        const r = cands.reduce((a, b) => (devOf(b) < devOf(a) ? b : a));
        const dev = devOf(r);   // 幅木の前面(1.2cm 出る)も許容内
        if (dev > 0.15) continue;   // 部屋の外の見込み
        rmMax = Math.max(rmMax, dev); rmFaces++;
        if (dev > 0.02) { fail(`F${N}: ${r.id} の内装の壁の面が部屋の矩形の内側の面からずれている(${axis}=${pl.toFixed(3)})`); break; }
        if (Math.min(...ys) < base - 1e-3 || Math.max(...ys) > base + GEOM.CEIL_H + 1e-3) { fail(`F${N}: ${r.id} の内装の壁が床〜天井の外`); break; }
      }
    }
    R.roomWallFaces = rmFaces; R.roomWallMaxCm = +(rmMax * 100).toFixed(2);
    R.rooms = enter.length;
  }

  // 3a) 壁の面 → 衝突箱
  const boxes = collisionBoxes(floor, N).filter((b) => b.kind === 'wall' || b.kind === 'solid');
  const faces = [];   // { axis:'x'|'z', sgn, plane, lo, hi, y0, y1, node }
  const wallNodes = g.gltf.nodes.map((n, i) => [n, i]).filter(([n]) => n.extras && n.extras.n2_kind === 'wall');
  for (const [n, i] of wallNodes) {
    const ts = nodeTris(g, world, i);
    const groups = new Map();
    for (const t of ts) {
      const nr = triNormal(t.v);
      let axis = null, sgn = 0;
      if (Math.abs(nr[0]) > 0.99) { axis = 'x'; sgn = Math.sign(nr[0]); } else if (Math.abs(nr[2]) > 0.99) { axis = 'z'; sgn = Math.sign(nr[2]); } else continue;
      const ai = axis === 'x' ? 0 : 2, ti = axis === 'x' ? 2 : 0;
      const plane = t.v[0][ai];
      const key = `${axis}${sgn}:${plane.toFixed(3)}:${t.mat}`;
      const gr = groups.get(key) || { axis, sgn, plane, lo: 1e9, hi: -1e9, y0: 1e9, y1: -1e9, node: n.name };
      for (const v of t.v) { gr.lo = Math.min(gr.lo, v[ti]); gr.hi = Math.max(gr.hi, v[ti]); gr.y0 = Math.min(gr.y0, v[1]); gr.y1 = Math.max(gr.y1, v[1]); }
      groups.set(key, gr);
    }
    for (const gr of groups.values()) if (gr.y1 - gr.y0 > 0.5) faces.push(gr);   // 幅木などの低い面を除く
  }
  let maxDiff = 0, worst = '';
  const okHeights = [GEOM.CEIL_H, GEOM.FLOOR_H, 2.04];
  for (const f of faces) {
    const on = boxes.filter((b) => {
      const v = f.axis === 'x' ? (f.sgn > 0 ? b.maxX : b.minX) : (f.sgn > 0 ? b.maxZ : b.minZ);
      return Math.abs(v - f.plane) <= TOL;
    }).map((b) => (f.axis === 'x' ? [b.minZ, b.maxZ] : [b.minX, b.maxX])).sort((a, b) => a[0] - b[0]);
    // 面の区間 [lo,hi] が衝突箱の面の和で覆われているか(隙間 ±5cm まで)
    let cur = f.lo + TOL, ok = on.length > 0;
    for (const [a, b] of on) { if (a > cur + 0.01) break; cur = Math.max(cur, b); }
    if (cur < f.hi - TOL) ok = false;
    const dy0 = Math.abs(f.y0 - base);
    const dy1 = Math.min(...okHeights.map((h) => Math.abs(f.y1 - (base + h))));
    const d = ok ? Math.max(dy0, dy1) : 1;
    if (d > maxDiff) { maxDiff = d; worst = `${f.node} ${f.axis}${f.sgn > 0 ? '+' : '-'}@${f.plane.toFixed(2)} [${f.lo.toFixed(2)},${f.hi.toFixed(2)}]`; }
    if (d > TOL && verbose) console.log("DBG", JSON.stringify(on), f.lo, f.hi, cur);
    if (d > TOL) fail(`F${N}: 壁の面が当たりとずれている ${f.node} ${f.axis}${f.sgn > 0 ? '+' : '-'}=${f.plane.toFixed(3)} [${f.lo.toFixed(2)},${f.hi.toFixed(2)}] y[${f.y0.toFixed(2)},${f.y1.toFixed(2)}]`);
  }
  R.wallFaces = faces.length;
  R.faceVsBoxMaxCm = +(maxDiff * 100).toFixed(2);

  // 3b) 屋内の空気の縁 → GLB の壁の面(見えない壁が無い)
  const indoor = new Set(['corridor', 'hall', 'lobby', 'theater', 'room', 'room410', 'stair', 'well', 'alcove']);
  const allCols = collisionBoxes(floor, N);
  let probes = 0, holes = 0;
  const holeEx = [];
  for (const a of floor.shell.air) {
    if (!indoor.has(a.kind) || (a.kind === 'well' && a.outdoor)) continue;
    const [x0, z0, w, d] = a.rect;
    const edges = [['x', -1, x0, z0, z0 + d], ['x', 1, x0 + w, z0, z0 + d], ['z', -1, z0, x0, x0 + w], ['z', 1, z0 + d, x0, x0 + w]];
    for (const [axis, sgn, plane, lo, hi] of edges) {
      for (let s = lo + 0.15; s < hi - 0.1; s += 0.25) {
        const px = axis === 'x' ? plane - sgn * 0.02 : s, pz = axis === 'x' ? s : plane - sgn * 0.02;
        // 外へ 0.2m 探る
        // 外へ探って当たる箱のうち、空気側に一番近い面(T 字の取り合いでは手前の壁の面が見える面)
        let hit = null, best = null;
        for (const b of allCols) {
          if (!['wall', 'solid', 'cap'].includes(b.kind)) continue;
          const qx = axis === "x" ? plane + sgn * 0.03 : px, qz = axis === "z" ? plane + sgn * 0.03 : pz;
          if (!(qx >= b.minX - 1e-6 && qx <= b.maxX + 1e-6 && qz >= b.minZ - 1e-6 && qz <= b.maxZ + 1e-6)) continue;
          const fp = axis === 'x' ? (sgn > 0 ? b.minX : b.maxX) : (sgn > 0 ? b.minZ : b.maxZ);
          const score = -sgn * fp;   // 空気側(-sgn 方向)へ出ている面ほど大きい
          if (best === null || score > best) { best = score; hit = b; }
        }
        if (!hit) continue;
        if (allCols.some((b) => (b.kind === 'door' || b.kind === 'evdoor' || b.kind === 'perimDoor') && px >= b.minX - 0.2 && px <= b.maxX + 0.2 && pz >= b.minZ - 0.2 && pz <= b.maxZ + 0.2)) continue;
        if (hit.kind === 'cap') continue;     // 410 の闇の板(Void_Caps)
        probes++;
        const facePlane = axis === 'x' ? (sgn > 0 ? hit.minX : hit.maxX) : (sgn > 0 ? hit.minZ : hit.maxZ);
        const found = faces.some((f) => f.axis === axis && f.sgn === -sgn && Math.abs(f.plane - facePlane) <= TOL && s >= f.lo - TOL && s <= f.hi + TOL);
        if (!found && verbose) console.log('HOLE', a.id, axis, sgn, s.toFixed(2), 'facePlane', facePlane, hit.kind, JSON.stringify(faces.filter((f) => f.axis === axis && Math.abs(f.plane - facePlane) < 0.2).map((f) => [f.sgn, +f.plane.toFixed(3), +f.lo.toFixed(2), +f.hi.toFixed(2), f.node])));
        if (!found) { holes++; if (holeEx.length < 5) holeEx.push(`${a.id} ${axis}${sgn > 0 ? '+' : '-'}${plane.toFixed(2)} @${s.toFixed(2)}`); }
      }
    }
  }
  // EV の扉の面・ガラスの面(風除室)は壁ノードではないので、そこに当たる探りは除外済み/許容
  const glassOk = holeEx.filter((h) => !/^(lobby|windbreak) /.test(h));
  R.edgeProbes = probes;
  R.invisibleWallProbes = holes;
  if (holes && glassOk.length) fail(`F${N}: 当たりはあるのに壁の面が無い ${holes}/${probes} 例=${JSON.stringify(glassOk)}`);

  // 10) P3c-2: 廊下端の窓 = 外壁の開口＋透明ガラス。窓の中心(横桟の上下)を壁・外の塊・屋上A の外壁の面が塞いでいない、ガラスの面(corrglass)と外の枠(corrwinout)がある、旧い発光板(M_Window・MX_WinOut)が無い
  {
    const FACE = { W: [-1, 0], E: [1, 0], N: [0, -1], S: [0, 1] };
    const matName = (k) => ((g.gltf.materials || [])[k] || {}).name || '';
    const nodesOf = (pred) => g.gltf.nodes.map((n, i) => [n, i]).filter(([n]) => n.mesh !== undefined && pred(n.extras || {}, n));
    const blockers = nodesOf((e) => ['wall', 'massing', 'facade'].includes(e.n2_kind)).flatMap(([, i]) => nodeTris(g, world, i));
    const glassT = nodesOf((e) => e.n2_kind === 'corrglass').flatMap(([, i]) => nodeTris(g, world, i));
    const outT = nodesOf((e) => e.n2_kind === 'corrwinout').flatMap(([, i]) => nodeTris(g, world, i));
    const inTri = (p, t, ai) => {   // (a, y) の 2D で点が三角形の中か
      const P = t.map((v) => [v[ai], v[1]]);
      const sgn = (a, b, c) => (a[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (a[1] - c[1]);
      const d1 = sgn(p, P[0], P[1]), d2 = sgn(p, P[1], P[2]), d3 = sgn(p, P[2], P[0]);
      return !((d1 < -1e-9 || d2 < -1e-9 || d3 < -1e-9) && (d1 > 1e-9 || d2 > 1e-9 || d3 > 1e-9));
    };
    const old = (g.gltf.materials || []).filter((m) => m.name === 'M_Window' || m.name === 'MX_WinOut').map((m) => m.name);
    if (old.length) fail(`F${N}: 廊下端の窓の旧い発光板の材質が残っている ${old}`);
    const winRes = [];
    for (const w of floor.shell.windows) {
      const [x, z] = w.pos, nin = FACE[w.facing];
      const horiz = nin[1] !== 0, ai = horiz ? 0 : 2, pi = horiz ? 2 : 0;
      const c = horiz ? x : z, pl = horiz ? z : x;
      const y0 = base + w.sill, y1 = y0 + w.h;
      let blocked = 0;
      for (const yy of [y0 + w.h * 0.27, y0 + w.h * 0.75]) {
        for (const t of blockers) {
          const nr = triNormal(t.v);
          if (Math.abs(nr[pi]) < 0.99) continue;
          if (Math.abs(t.v[0][pi] - pl) > 0.16) continue;
          if (inTri([c, yy], t.v, ai)) blocked++;
        }
      }
      const near = (ts) => ts.filter((t) => { const cx = (t.v[0][ai] + t.v[1][ai] + t.v[2][ai]) / 3, cy = (t.v[0][1] + t.v[1][1] + t.v[2][1]) / 3, cp = (t.v[0][pi] + t.v[1][pi] + t.v[2][pi]) / 3;
        return Math.abs(cx - c) < w.w / 2 + 0.12 && cy > y0 - 0.1 && cy < y1 + 0.1 && Math.abs(cp - pl) < 0.2; }).length;
      const gl = near(glassT), ot = near(outT);
      if (blocked) fail(`F${N}: 廊下端の窓 ${w.facing}@${x},${z} の開口が壁の面で塞がっている(${blocked})`);
      if (gl < 2) fail(`F${N}: 廊下端の窓 ${w.facing}@${x},${z} にガラスの面が無い`);
      if (ot < 12) fail(`F${N}: 廊下端の窓 ${w.facing}@${x},${z} に外の枠・水切りが無い`);
      winRes.push(`${w.facing}@${x.toFixed(1)},${z.toFixed(1)}:${blocked ? 'BLOCKED' : 'open'}/g${gl}/f${ot}`);
    }
    R.corrWindows = winRes.join(' ');
  }

  // 4) 外周の閉じ(flood-fill)
  const flood = (fl, key, start) => {
    const cols = collisionBoxes(fl, key).filter((b) => b.kind !== 'stairguard' || true);
    const rects = fl.footprint;
    let mnx = 1e9, mnz = 1e9, mxx = -1e9, mxz = -1e9;
    for (const [x, z, w, d] of rects) { mnx = Math.min(mnx, x); mnz = Math.min(mnz, z); mxx = Math.max(mxx, x + w); mxz = Math.max(mxz, z + d); }
    mnx -= 1.5; mnz -= 1.5; mxx += 1.5; mxz += 1.5;
    const cs = 0.3, infl = 0.15, nx = Math.ceil((mxx - mnx) / cs), nz = Math.ceil((mxz - mnz) / cs);
    const st = new Int8Array(nx * nz);
    const C = (i, j) => [mnx + (i + 0.5) * cs, mnz + (j + 0.5) * cs];
    const open = (i, j) => {
      if (i < 0 || j < 0 || i >= nx || j >= nz) return false;
      const k = j * nx + i;
      if (!st[k]) { const [px, pz] = C(i, j); st[k] = cols.some((b) => px >= b.minX - infl && px <= b.maxX + infl && pz >= b.minZ - infl && pz <= b.maxZ + infl) ? 2 : 1; }
      return st[k] === 1;
    };
    const si = Math.floor((start[0] - mnx) / cs), sj = Math.floor((start[1] - mnz) / cs);
    if (!open(si, sj)) return { reached: 0, leaks: -1 };
    const q = [[si, sj]]; st[sj * nx + si] = 3;
    let reached = 0, leaks = 0;
    while (q.length) {
      const [i, j] = q.pop(); reached++;
      const [px, pz] = C(i, j);
      if (!rects.some(([x, z, w, d]) => px >= x && px <= x + w && pz >= z && pz <= z + d)) leaks++;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (open(i + di, j + dj)) { st[(j + dj) * nx + i + di] = 3; q.push([i + di, j + dj]); }
    }
    return { reached, leaks };
  };
  const ff = flood(floor, N, [6.9, 21.2]);
  R.flood = ff;
  if (ff.reached === 0 || ff.leaks) fail(`F${N}: 外周が閉じていない(到達 ${ff.reached}・漏れ ${ff.leaks})`);
  if (N === 7) {
    const rb = flood({ ...building.roofB, rooms: [] }, 'RB', [4.3, 21.0]);
    R.floodRoofB = rb;
    if (rb.reached === 0 || rb.leaks) fail(`屋上B の外周が閉じていない(到達 ${rb.reached}・漏れ ${rb.leaks})`);
  }

  // 5) 扉
  const units = floor.rooms.filter((r) => r.kind === 'unit').map((r) => r.id);
  const leafNodes = g.gltf.nodes.map((n, i) => [n, i]).filter(([n]) => /^DoorLeaf_/.test(n.name));
  const unitLeaves = leafNodes.filter(([n]) => units.includes(n.name.slice(9)));
  R.unitDoors = unitLeaves.length;
  if (unitLeaves.length !== EXPECT_UNITS[N] || units.length !== EXPECT_UNITS[N]) fail(`F${N}: 居室の扉 ${unitLeaves.length} / データ ${units.length} / 図面 ${EXPECT_UNITS[N]}`);
  const plateMat = g.gltf.materials.findIndex((m) => m.name === 'M_RoomPlate');
  let plates = 0;
  for (const [, i] of unitLeaves) if (nodeTris(g, world, i).some((t) => t.mat === plateMat)) plates++;
  R.plates = plates;
  if (plates !== unitLeaves.length) fail(`F${N}: 号室プレートの無い扉 ${unitLeaves.length - plates}`);
  const doorBoxes = floorWallBoxes(floor).filter((b) => b.kind === 'door');
  let doorMax = 0;
  for (const [n, i] of leafNodes) {
    const rid = n.name.slice(9);
    const b = (rid === 'B1DOOR' ? floorWallBoxes(building.basement) : doorBoxes).find((d) => d.kind === 'door' && d.roomId === rid);   // B1 の扉は地下の当たり
    if (!b) { fail(`F${N}: 扉ブロッカなし ${rid}`); continue; }
    const ts = nodeTris(g, world, i).map((t) => t.v).filter((t) => Math.abs(t[0][1] - t[1][1]) > 1.0 || Math.abs(t[0][1] - t[2][1]) > 1.0);
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (const t of ts) for (const p of t) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); }
    const ex = Math.max(0, b.cx - b.w / 2 - mn[0], mx[0] - (b.cx + b.w / 2));
    const ez = Math.max(0, b.cz - b.d / 2 - mn[2], mx[2] - (b.cz + b.d / 2));
    doorMax = Math.max(doorMax, ex, ez);
    if (Math.max(ex, ez) > TOL) fail(`F${N}: 扉板 ${rid} が当たり箱からはみ出す ${Math.max(ex, ez).toFixed(3)}m`);
  }
  R.doorLeafOverflowCm = +(doorMax * 100).toFixed(2);

  // 6) EV・外階段・北階段
  const need = [`EVDoor_L_EV${N}`, `EVDoor_R_EV${N}`, `EVCallPanel_EV${N}`, `EVCar_EV${N}`, `EVCarPanel_EV${N}`, `DoorLeaf_MST${N}`, 'ExtStair_deck'];
  if (N <= 3) need.push('NorthStair_deck', 'NorthStair_rail');
  if (N === 2 || N === 3) need.push(`DoorLeaf_NST${N}`, 'Gallery_parapet');
  if (N === 1) need.push('NorthGround', 'BStair_steps', 'BStair_walls', 'DoorLeaf_B1DOOR', 'AutoDoor_L_ENTRANCE', 'GlassInner_glass', 'GlassOuter_glass', 'Porch');
  if (N === 1 && nodeNames.has('DoorLeaf_NST1')) fail('F1: 北階段の扉が 1F に残っている');
  if (N === 7) need.push('Roof_floor', 'Roof_parapet');
  for (const nm of need) if (!nodeNames.has(nm)) fail(`F${N}: ${nm} がない`);
  if ((man.evButtons || []).length !== 7) fail(`F${N}: カゴの行き先ボタンが 7 個でない`);
  const deckY = (name) => { const i = g.gltf.nodes.findIndex((n) => n.name === name); if (i < 0) return null; const ys = nodeTris(g, world, i).flatMap((t) => t.v.map((p) => p[1])); return [Math.min(...ys), Math.max(...ys)]; };
  const ext = deckY('ExtStair_deck');
  const topY = base + GEOM.FLOOR_H * (N === 7 ? 1 : 1);
  if (ext && ext[1] < topY - 0.25) fail(`F${N}: 外階段の段が上の踊り場の高さ(${topY.toFixed(2)})まで届かない(最高 ${ext[1].toFixed(2)})`);
  R.extStairY = ext && ext.map((v) => +v.toFixed(2));
  if (N <= 2) {
    const ns = deckY('NorthStair_deck');
    if (!ns || ns[1] < base + GEOM.FLOOR_H - 0.25) fail(`F${N}: 北階段の段が上の階まで届かない`);
  }
  if (N === 1) {
    const bs = deckY('BStair_steps');
    R.basementStairY = bs && bs.map((v) => +v.toFixed(2));
    if (!bs || bs[0] > base - GEOM.FLOOR_H + 0.05 || bs[1] < base - 0.25) fail(`F1: 地下への段が B1 の床から 1F まで届かない ${JSON.stringify(bs)}`);
    const b1 = flood({ ...building.basement }, 'B1', building.basement.spawn);
    R.floodB1 = b1;
    if (b1.reached === 0 || b1.leaks) fail(`B1 の外周が閉じていない(到達 ${b1.reached}・漏れ ${b1.leaks})`);
    // 地下の扉は施錠(当たりに扉のブロッカがある)
    if (!floorWallBoxes(building.basement).some((b) => b.kind === 'door' && b.roomId === 'B1DOOR')) fail('B1 の施錠扉の当たりがない');
  }
  return R;
}

// ---------------------------------------------------------------- データ側の全階接続
const main = building.stairs.find((s) => s.id === 'main');
if (JSON.stringify(main.stops) !== JSON.stringify([1, 2, 3, 4, 5, 6, 7, 'RB'])) fail('外階段の stops が 1〜7F＋屋上B でない');
const north = building.stairs.find((s) => s.id === 'north');
if (JSON.stringify(north.stops) !== JSON.stringify([1, 2, 3])) fail('北階段の stops が 1〜3F でない');
const basement = building.stairs.find((s) => s.id === 'basement');
if (!basement || JSON.stringify(basement.stops) !== JSON.stringify(['B1', 1])) fail('地下への階段の stops が B1→1F でない');
for (let lv = 1; lv <= 7; lv++) {
  const f = building.floors.find((ff) => ff.level === lv);
  if (!f.rooms.some((r) => r.kind === 'elevator')) fail(`F${lv}: EV がない`);
  if (!f.rooms.some((r) => r.id === 'MST' + lv && r.door.steel)) fail(`F${lv}: 外階段の鉄扉がない`);
}

const rows = [];
for (let N = 1; N <= 7; N++) {
  if (onlyFloor && N !== onlyFloor) continue;
  const r = checkFloor(N);
  if (r) rows.push(r);
}
for (const r of rows) {
  console.log(`F${r.floor}: GLB ${r.glbMB}MB tris ${r.tris} prims ${r.prims} | lightmap ${r.lightmap} + rooms ${r.lightmap2} (${r.rooms} rooms, wall faces ${r.roomWallFaces} max ${r.roomWallMaxCm}cm) | wall faces ${r.wallFaces} max ${r.faceVsBoxMaxCm}cm | edge probes ${r.edgeProbes} (no-face ${r.invisibleWallProbes}) | flood ${r.flood.reached}${r.floodRoofB ? ' RB ' + r.floodRoofB.reached : ''} | unit doors ${r.unitDoors} plates ${r.plates} leafOverflow ${r.doorLeafOverflowCm}cm | ext stair y ${JSON.stringify(r.extStairY)} | corr windows ${r.corrWindows}`);
}

// ---------------------------------------------------------------- 9) P3c: 外観・外環境(build/exterior.glb ＋ manifest ＋ 木の配置)
function checkExterior() {
  const glbPath = join(ROOT, 'build', 'exterior.glb'), manPath = join(ROOT, 'build', 'exterior_manifest.json');
  if (!existsSync(glbPath) || !existsSync(manPath)) { fail('外観: build/exterior.glb / exterior_manifest.json がない'); return null; }
  const g = parseGLB(glbPath);
  const man = JSON.parse(readFileSync(manPath, 'utf8'));
  const FH = GEOM.FLOOR_H;
  const R = { glbMB: +(g.size / 1e6).toFixed(2) };
  if ((g.gltf.images || []).length) fail(`外観: GLB にテクスチャが埋め込まれている(${g.gltf.images.length})`);
  const world = new Map();
  const walk = (i, parent) => { const m = mul(parent, mat4FromTRS(g.gltf.nodes[i])); world.set(i, m); for (const c of g.gltf.nodes[i].children || []) walk(c, m); };
  for (const r of g.gltf.scenes[g.gltf.scene || 0].nodes) walk(r, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const byName = new Map(g.gltf.nodes.map((n, i) => [n.name, i]));
  const want = { ExtAlways: 'extalways', Site: 'site', Terrain: 'terrain', TreeProto_0: 'treeproto', TreeProto_1: 'treeproto', Billboard: 'billboard',
    Ridge_0: 'ridge', Ridge_1: 'ridge', Ridge_2: 'ridge', City: 'city' };
  for (let L = 1; L <= 7; L++) want['ExtBand_' + L] = 'extband';
  for (const [name, kind] of Object.entries(want)) {
    const i = byName.get(name);
    if (i === undefined) { fail(`外観: ノード ${name} がない`); continue; }
    const ex = g.gltf.nodes[i].extras || {};
    if (ex.n2_kind !== kind) fail(`外観: ${name} の n2_kind が ${kind} でない(${ex.n2_kind})`);
  }
  // 全プリミティブ: 法線あり・ライトマップの UV(TEXCOORD_1)なし(ベイクしない)
  let prims = 0, tris = 0, lm = 0, nonorm = 0;
  for (const node of g.gltf.nodes) {
    if (node.mesh === undefined) continue;
    for (const p of g.gltf.meshes[node.mesh].primitives) {
      prims++; tris += (p.indices !== undefined ? g.gltf.accessors[p.indices].count : g.gltf.accessors[p.attributes.POSITION].count) / 3;
      if (p.attributes.TEXCOORD_1 !== undefined) lm++;
      if (p.attributes.NORMAL === undefined) nonorm++;
    }
  }
  if (lm) fail(`外観: ライトマップの UV が残っている(${lm})`);
  if (nonorm) fail(`外観: 法線のないプリミティブ ${nonorm}`);
  Object.assign(R, { prims, tris });
  // 材質の実行時テクスチャ(≤2048、法線 ≤1024)
  for (const [mname, def] of Object.entries(man.materials || {})) {
    for (const k of ['map', 'normalMap', 'roughnessMap', 'emissiveMap']) {
      if (!def[k]) continue;
      const p = join(ROOT, def[k]);
      if (!existsSync(p)) { fail(`外観: ${mname}.${k} のファイルがない ${def[k]}`); continue; }
      const [w, h] = imageSize(readFileSync(p));
      if (w > 2048 || h > 2048 || (k === 'normalMap' && (w > 1024 || h > 1024))) fail(`外観: ${def[k]} が大きすぎる ${w}x${h}`);
    }
  }
  if (!existsSync(join(ROOT, 'build', 'tex', 'ext_sky.webp'))) fail('外観: 夜空 build/tex/ext_sky.webp がない');
  else { const [w, h] = imageSize(readFileSync(join(ROOT, 'build', 'tex', 'ext_sky.webp'))); if (w > 2048 || h > 2048) fail('外観: 夜空が 2048px 超'); }
  // 階の帯: 高さがその階の範囲(バルコニーの見付け・屋根のパラペット・屋上Bの機械室を含む)、建物の中(壁の内側)に面が無い
  const site = building.site;
  const bandY = {}, inside = {};
  for (let L = 1; L <= 7; L++) {
    const i = byName.get('ExtBand_' + L);
    if (i === undefined) continue;
    const f = building.floors.find((ff) => ff.level === L);
    const ts = nodeTris(g, world, i);
    let y0 = Infinity, y1 = -Infinity, bad = 0;
    // 建物の中 = 部屋・廊下の矩形(バルコニー・階段の箱・屋上A を除く)を 0.45m 内側へ縮めたもの。屋根(その階の天井より上)と 1F の風除室の奥の灯りは除く
    const skip = new Set();
    for (const r of f.rooms) if (r.kind === 'stair' || r.kind === 'elevator') skip.add(JSON.stringify(r.rect));
    const rects = f.rooms.filter((r) => !skip.has(JSON.stringify(r.rect)) && r.id !== 'ENTRANCE' && r.id !== 'LOBBY').map((r) => r.rect);
    const depthMats = new Set((g.gltf.materials || []).map((m, k) => (/^XE_Corr(Depth|Lamp)/.test(m.name) ? k : -1)).filter((k) => k >= 0));   // P3c-2: 廊下端の窓の奥の箱(意図して建物の中)
    for (const t of ts) {
      for (const v of t.v) { y0 = Math.min(y0, v[1]); y1 = Math.max(y1, v[1]); }
      if (depthMats.has(t.mat)) continue;
      const cx = (t.v[0][0] + t.v[1][0] + t.v[2][0]) / 3, cy = (t.v[0][1] + t.v[1][1] + t.v[2][1]) / 3, cz = (t.v[0][2] + t.v[1][2] + t.v[2][2]) / 3;
      if (cy > L * FH - 0.25 || cy < (L - 1) * FH + 0.05) continue;
      if (rects.some(([x, z, w, d]) => cx > x + 0.45 && cx < x + w - 0.45 && cz > z + 0.45 && cz < z + d - 0.45)) bad++;
    }
    bandY[L] = [+y0.toFixed(2), +y1.toFixed(2)];
    inside[L] = bad;
    const top = L * FH + (L === 7 ? 3.3 : 1.35);
    if (y0 < (L - 1) * FH - 0.65 || y1 > top) fail(`外観: ExtBand_${L} の高さ ${y0.toFixed(2)}..${y1.toFixed(2)} が階の範囲外`);
    if (bad) fail(`外観: ExtBand_${L} に建物の中の面が ${bad} ある`);
  }
  Object.assign(R, { bandY, bandInsideFaces: inside });
  // 外構: 当たりの箱(車・ラック・ゴミ置場・柱・植え込み・照明柱)ごとに見た目の面がある
  {
    const ts = nodeTris(g, world, byName.get('Site'));
    const miss = [];
    for (const o of site.obstacles) {
      const [x, z, w, d] = o.rect;
      const hit = ts.some((t) => t.v.some((v) => v[0] >= x - 0.05 && v[0] <= x + w + 0.05 && v[2] >= z - 0.05 && v[2] <= z + d + 0.05 && v[1] > 0.1));
      if (!hit && !o.id.startsWith('porch_col') && !o.id.startsWith('pilotis')) miss.push(o.id);
    }
    if (miss.length) fail(`外観: 当たりの箱に見た目が無い ${miss.join(',')}`);
    R.siteObstacles = site.obstacles.length - miss.length + '/' + site.obstacles.length;
    // 2F の張り出しの下の柱は ExtAlways、庇の柱は 1F の GLB
  }
  // 地形: 敷地の中は外構の面の下(≤ −0.03)
  {
    const ts = nodeTris(g, world, byName.get('Terrain'));
    const B = site.bounds;
    let hi = -Infinity, n = 0;
    for (const t of ts) for (const v of t.v) if (v[0] > B.W + 0.2 && v[0] < B.E - 0.2 && v[2] > B.N + 0.2 && v[2] < B.S - 0.2) { hi = Math.max(hi, v[1]); n++; }
    if (hi > -0.03) fail(`外観: 敷地の中の地形が外構より高い(${hi.toFixed(3)})`);
    R.terrainInSite = { verts: n, maxY: +hi.toFixed(3) };
  }
  // 木の配置(build/exterior_instances.bin): 件数が manifest と一致、敷地の中に木が無い
  {
    const p = join(ROOT, 'build', man.instances);
    if (!existsSync(p)) fail('外観: 木の配置ファイルがない');
    else {
      const b = readFileSync(p);
      const nN = b.readUInt32LE(4), nB = b.readUInt32LE(8);
      if (b.toString('ascii', 0, 4) !== 'N2TI' || nN !== man.trees.near || nB !== man.trees.billboards || b.length !== 12 + nN * 14 + nB * 12) fail('外観: 木の配置ファイルの件数・大きさが合わない');
      const B = site.bounds;
      let inSite = 0;
      for (let i = 0; i < nN; i++) {
        const x = b.readInt16LE(12 + i * 14) / 10, z = b.readInt16LE(12 + i * 14 + 4) / 10;
        if (x > B.W - 1.0 && x < B.E + 1.0 && z > B.N - 1.0 && z < B.S + 1.0) inSite++;
      }
      if (inSite) fail(`外観: 敷地の中に木が ${inSite} 本`);
      R.trees = { near: nN, billboards: nB, inSite };
    }
  }
  // 灯りの点いた窓: 施錠の空室(入れる部屋・物語の部屋ではない)
  {
    const all = new Map();
    for (const f of building.floors) for (const r of f.rooms) all.set(r.id, r);
    const bad = (man.litWindows || []).filter((w) => { const r = all.get(w.room); return !r || r.kind !== 'unit' || r.door.enterable || r.story; });
    if ((man.litWindows || []).length < 4) fail('外観: 灯りの点いた窓が 4 室未満');
    if (bad.length) fail(`外観: 灯りの点いた窓が入れる部屋・物語の部屋 ${bad.map((w) => w.room)}`);
    R.litWindows = (man.litWindows || []).map((w) => w.room);
  }
  return R;
}
const ext = onlyFloor ? null : checkExterior();
if (ext) console.log(`EXT: GLB ${ext.glbMB}MB tris ${ext.tris} prims ${ext.prims} | bands y ${JSON.stringify(ext.bandY)} inside-faces ${JSON.stringify(ext.bandInsideFaces)} | site obstacles ${ext.siteObstacles} | terrain in site ${JSON.stringify(ext.terrainInSite)} | trees ${JSON.stringify(ext.trees)} | lit ${ext.litWindows}`);

// ---------------------------------------------------------------- 容量
let total = 0;
const parts = {};
const add = (k, p) => { if (existsSync(p)) { const s = statSync(p).size; total += s; parts[k] = (parts[k] || 0) + s; } };
for (let N = 1; N <= 7; N++) {
  add('glb', join(ROOT, 'build', `floor_${N}.glb`));
  add('lightmap', join(ROOT, 'build', `floor_${N}_lightmap.webp`));
  add('roomsLightmap', join(ROOT, 'build', `floor_${N}_rooms_lightmap.webp`));
  add('manifest', join(ROOT, 'build', `floor_${N}_manifest.json`));
}
for (const f of readdirSync(join(ROOT, 'build', 'tex'))) add('textures', join(ROOT, 'build', 'tex', f));
for (const f of ['exterior.glb', 'exterior_manifest.json', 'exterior_instances.bin']) add('exterior', join(ROOT, 'build', f));   // P3c
console.log(`assets: total ${(total / 1e6).toFixed(2)} MB = ` + Object.entries(parts).map(([k, v]) => `${k} ${(v / 1e6).toFixed(2)}`).join(' / ') + ' (上限 35MB)');
if (total > 35e6) fail(`追加アセットが 35MB を超えた: ${(total / 1e6).toFixed(2)} MB`);
if (verbose) console.log(JSON.stringify(rows, null, 1));
if (failures) { console.error(`check_glb: ${failures} 件失敗`); process.exit(1); }
console.log('check_glb: OK');
