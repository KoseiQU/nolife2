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
//      7F の段は屋上B の高さまで。1〜3F に北階段
//  最後に追加アセットの合計(GLB＋ライトマップ＋build/tex)を表示し、25MB を超えたら失敗。
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
const levelY = (k) => (k === 'RB' ? 7 : k - 1) * GEOM.FLOOR_H;
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
    const b = doorBoxes.find((d) => d.roomId === rid);
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
  if (N <= 3) need.push(`DoorLeaf_NST${N}`, N < 3 ? 'NorthStair_steps' : 'NorthStair_rail');
  if (N === 7) need.push('Roof_floor', 'Roof_parapet');
  for (const nm of need) if (!nodeNames.has(nm)) fail(`F${N}: ${nm} がない`);
  if ((man.evButtons || []).length !== 7) fail(`F${N}: カゴの行き先ボタンが 7 個でない`);
  const deckY = (name) => { const i = g.gltf.nodes.findIndex((n) => n.name === name); if (i < 0) return null; const ys = nodeTris(g, world, i).flatMap((t) => t.v.map((p) => p[1])); return [Math.min(...ys), Math.max(...ys)]; };
  const ext = deckY('ExtStair_deck');
  const topY = base + GEOM.FLOOR_H * (N === 7 ? 1 : 1);
  if (ext && ext[1] < topY - 0.25) fail(`F${N}: 外階段の段が上の踊り場の高さ(${topY.toFixed(2)})まで届かない(最高 ${ext[1].toFixed(2)})`);
  R.extStairY = ext && ext.map((v) => +v.toFixed(2));
  if (N <= 2) {
    const ns = deckY('NorthStair_steps');
    if (ns && ns[1] < base + GEOM.FLOOR_H - 0.25) fail(`F${N}: 北階段の段が上の階まで届かない`);
  }
  return R;
}

// ---------------------------------------------------------------- データ側の全階接続
const main = building.stairs.find((s) => s.id === 'main');
if (JSON.stringify(main.stops) !== JSON.stringify([1, 2, 3, 4, 5, 6, 7, 'RB'])) fail('外階段の stops が 1〜7F＋屋上B でない');
const north = building.stairs.find((s) => s.id === 'north');
if (JSON.stringify(north.stops) !== JSON.stringify([1, 2, 3])) fail('北階段の stops が 1〜3F でない');
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
  console.log(`F${r.floor}: GLB ${r.glbMB}MB tris ${r.tris} prims ${r.prims} | lightmap ${r.lightmap} | wall faces ${r.wallFaces} max ${r.faceVsBoxMaxCm}cm | edge probes ${r.edgeProbes} (no-face ${r.invisibleWallProbes}) | flood ${r.flood.reached}${r.floodRoofB ? ' RB ' + r.floodRoofB.reached : ''} | unit doors ${r.unitDoors} plates ${r.plates} leafOverflow ${r.doorLeafOverflowCm}cm | ext stair y ${JSON.stringify(r.extStairY)}`);
}

// ---------------------------------------------------------------- 容量
let total = 0;
const parts = {};
const add = (k, p) => { if (existsSync(p)) { const s = statSync(p).size; total += s; parts[k] = (parts[k] || 0) + s; } };
for (let N = 1; N <= 7; N++) {
  add('glb', join(ROOT, 'build', `floor_${N}.glb`));
  add('lightmap', join(ROOT, 'build', `floor_${N}_lightmap.webp`));
  add('manifest', join(ROOT, 'build', `floor_${N}_manifest.json`));
}
for (const f of readdirSync(join(ROOT, 'build', 'tex'))) add('textures', join(ROOT, 'build', 'tex', f));
console.log(`assets: total ${(total / 1e6).toFixed(2)} MB = ` + Object.entries(parts).map(([k, v]) => `${k} ${(v / 1e6).toFixed(2)}`).join(' / ') + ' (上限 25MB)');
if (total > 25e6) fail(`追加アセットが 25MB を超えた: ${(total / 1e6).toFixed(2)} MB`);
if (verbose) console.log(JSON.stringify(rows, null, 1));
if (failures) { console.error(`check_glb: ${failures} 件失敗`); process.exit(1); }
console.log('check_glb: OK');
