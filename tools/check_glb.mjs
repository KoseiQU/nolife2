// check_glb.mjs — build/p0.glb の機械テスト(Node・THREE 非依存。GLB を自前でパース)。
//  1) GLB がパースでき、全メッシュの全プリミティブに TEXCOORD_1(第2UV)がある
//  2) 頂点数・三角形数・テクスチャ寸法(1枚 4096px 以下)・合計サイズを出力
//  3) TEXCOORD_1 が [0,1] に収まる(ライトマップアトラス)
//  4) データ↔見た目の整合: GLB の壁(Wall_XX)の各「見えている面」と、building.json→walls.js→
//     p0_region の衝突箱の対応面との差(面の位置・面の端・高さ)が ±5cm 以内
//  5) 扉板が walls.js の扉ブロッカ箱(閉扉の当たり)の中に収まる(±5cm)
//  6) manifest の全メッシュが GLB に存在し、lightmap PNG が存在する
// 実行: node tools/check_glb.mjs [build/p0.glb]   失敗時は非0終了。

import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { floorWallBoxes, GEOM } from '../src/walls.js';
import { selectRegionBoxes } from '../src/p0_region.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const glbPath = process.argv.slice(2).find((a) => !a.startsWith('--')) || join(ROOT, 'build', 'p0.glb');
const TOL = 0.05;
let failures = 0;
const fail = (m) => { failures++; console.error('FAIL:', m); };

// ---------------- GLB パース ----------------
const buf = readFileSync(glbPath);
if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
const jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
const binStart = 20 + jsonLen + 8;
const bin = buf.subarray(binStart, binStart + buf.readUInt32LE(20 + jsonLen));

const COMP = { 5120: [Int8Array, 1], 5121: [Uint8Array, 1], 5122: [Int16Array, 2], 5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5126: [Float32Array, 4] };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
function readAccessor(i) {
  const a = gltf.accessors[i];
  const bv = gltf.bufferViews[a.bufferView];
  const [T, size] = COMP[a.componentType];
  const n = NCOMP[a.type];
  const stride = bv.byteStride || size * n;
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const out = new Float64Array(a.count * n);
  const dv = new DataView(bin.buffer, bin.byteOffset);
  for (let k = 0; k < a.count; k++) {
    for (let c = 0; c < n; c++) {
      const off = base + k * stride + c * size;
      let v;
      switch (a.componentType) {
        case 5126: v = dv.getFloat32(off, true); break;
        case 5125: v = dv.getUint32(off, true); break;
        case 5123: v = dv.getUint16(off, true); break;
        case 5121: v = dv.getUint8(off); break;
        default: throw new Error('unsupported component ' + a.componentType);
      }
      out[k * n + c] = v;
    }
  }
  return { data: out, n, count: a.count, min: a.min, max: a.max };
}

// ノードのワールド行列(TRS)。列優先 4x4
function mat4FromTRS(node) {
  if (node.matrix) return node.matrix.slice();
  const [tx, ty, tz] = node.translation || [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale || [1, 1, 1];
  const xx = qx * qx, yy = qy * qy, zz = qz * qz, xy = qx * qy, xz = qx * qz, yz = qy * qz, wx = qw * qx, wy = qw * qy, wz = qw * qz;
  return [
    (1 - 2 * (yy + zz)) * sx, 2 * (xy + wz) * sx, 2 * (xz - wy) * sx, 0,
    2 * (xy - wz) * sy, (1 - 2 * (xx + zz)) * sy, 2 * (yz + wx) * sy, 0,
    2 * (xz + wy) * sz, 2 * (yz - wx) * sz, (1 - 2 * (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
const xf = (m, x, y, z) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];

const nodeWorld = new Map();
function walk(i, parent) {
  const m = mul(parent, mat4FromTRS(gltf.nodes[i]));
  nodeWorld.set(i, m);
  for (const c of gltf.nodes[i].children || []) walk(c, m);
}
const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
for (const r of gltf.scenes[gltf.scene || 0].nodes) walk(r, I4);

// ---------------- 1-3: UV2・頂点数・UV範囲 ----------------
let verts = 0, tris = 0, prims = 0, missing = 0, uv1Out = 0;
const meshNodes = [];
for (const [i, node] of gltf.nodes.entries()) {
  if (node.mesh === undefined) continue;
  meshNodes.push(i);
  for (const p of gltf.meshes[node.mesh].primitives) {
    prims++;
    const pos = gltf.accessors[p.attributes.POSITION];
    verts += pos.count;
    tris += p.indices !== undefined ? gltf.accessors[p.indices].count / 3 : pos.count / 3;
    if (p.attributes.TEXCOORD_1 === undefined) { missing++; fail(`TEXCOORD_1 なし: node ${node.name}`); continue; }
    const uv = readAccessor(p.attributes.TEXCOORD_1);
    for (let k = 0; k < uv.data.length; k++) if (uv.data[k] < -1e-4 || uv.data[k] > 1 + 1e-4) { uv1Out++; break; }
  }
}
if (uv1Out) fail(`TEXCOORD_1 が [0,1] 外のプリミティブ: ${uv1Out}`);
console.log(`GLB: ${(statSync(glbPath).size / 1e6).toFixed(1)} MB, mesh nodes ${meshNodes.length}, primitives ${prims}, vertices ${verts}, triangles ${tris}, materials ${gltf.materials.length}`);
console.log(`TEXCOORD_1: ${prims - missing}/${prims} primitives`);

// テクスチャ寸法(PNG/JPEG ヘッダから)
function imageSize(bytes, mime) {
  if (mime === 'image/png') return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  let o = 2;
  while (o < bytes.length) {
    if (bytes[o] !== 0xff) { o++; continue; }
    const mk = bytes[o + 1];
    const len = bytes.readUInt16BE(o + 2);
    if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) return [bytes.readUInt16BE(o + 7), bytes.readUInt16BE(o + 5)];
    o += 2 + len;
  }
  return [0, 0];
}
let texBytes = 0;
for (const img of gltf.images || []) {
  const bv = gltf.bufferViews[img.bufferView];
  const bytes = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
  const [w, h] = imageSize(Buffer.from(bytes), img.mimeType);
  texBytes += bv.byteLength;
  console.log(`  texture ${img.name}: ${w}x${h} ${img.mimeType} ${(bv.byteLength / 1e6).toFixed(2)} MB`);
  if (w > 4096 || h > 4096) fail(`テクスチャが 4096px 超: ${img.name}`);
}
const manifest = JSON.parse(readFileSync(join(ROOT, 'build', 'p0_manifest.json'), 'utf8'));
const lmPath = join(ROOT, 'build', manifest.lightmap.file);
if (!existsSync(lmPath)) fail('lightmap PNG がない');
else {
  const lb = readFileSync(lmPath);
  const [w, h] = imageSize(lb, 'image/png');
  console.log(`  lightmap ${manifest.lightmap.file}: ${w}x${h} ${(lb.length / 1e6).toFixed(2)} MB (encoding ${manifest.lightmap.encoding}, intensity ${manifest.lightmap.intensity.toFixed(4)})`);
  if (w > 4096 || h > 4096) fail('lightmap が 4096px 超');
  texBytes += lb.length;
}
console.log(`textures total: ${(texBytes / 1e6).toFixed(1)} MB`);
const nodeNames = new Set(gltf.nodes.map((n) => n.name));
for (const name of Object.keys(manifest.meshes)) if (!nodeNames.has(name)) fail(`manifest のメッシュが GLB にない: ${name}`);

// ---------------- 4: 壁の面 ↔ 衝突箱 ----------------
const building = JSON.parse(readFileSync(join(ROOT, 'data', 'building.json'), 'utf8'));
const region = JSON.parse(readFileSync(join(ROOT, 'src', 'p0_region.json'), 'utf8'));
const floor = building.floors.find((f) => f.level === region.level);
const baseY = (region.level - 1) * GEOM.FLOOR_H;
const allBoxes = floorWallBoxes(floor);
const expected = selectRegionBoxes(allBoxes, region);

// ノード(+子)の三角形をワールド座標で集める
function nodeTriangles(i) {
  const out = [];
  const visit = (j) => {
    const node = gltf.nodes[j];
    const m = nodeWorld.get(j);
    if (node.mesh !== undefined) {
      for (const p of gltf.meshes[node.mesh].primitives) {
        const pos = readAccessor(p.attributes.POSITION);
        const idx = p.indices !== undefined ? readAccessor(p.indices).data : Array.from({ length: pos.count }, (_, k) => k);
        const P = (k) => xf(m, pos.data[k * 3], pos.data[k * 3 + 1], pos.data[k * 3 + 2]);
        for (let t = 0; t < idx.length; t += 3) out.push([P(idx[t]), P(idx[t + 1]), P(idx[t + 2])]);
      }
    }
    for (const c of node.children || []) visit(c);
  };
  visit(i);
  return out;
}
function aabb(tris) {
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const t of tris) for (const p of t) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], p[a]); mx[a] = Math.max(mx[a], p[a]); }
  return { mn, mx };
}
const wallNodes = gltf.nodes.map((n, i) => [n, i]).filter(([n]) => /^Wall_\d+$/.test(n.name));
if (wallNodes.length !== expected.length) fail(`壁の数が不一致: GLB ${wallNodes.length} / データ ${expected.length}`);
let maxDiff = 0, worst = '';
const used = new Set();
const rows = [];
for (const [n, i] of wallNodes) {
  const tris = nodeTriangles(i);
  const bb = aabb(tris);
  // 最も重なる期待箱を対応付け
  let best = null, bestOv = -1;
  for (const [k, e] of expected.entries()) {
    const ox = Math.min(bb.mx[0], e.maxX) - Math.max(bb.mn[0], e.minX);
    const oz = Math.min(bb.mx[2], e.maxZ) - Math.max(bb.mn[2], e.minZ);
    const ov = Math.max(0, ox + 0.01) * Math.max(0, oz + 0.01);
    if (ov > bestOv) { bestOv = ov; best = k; }
  }
  const e = expected[best];
  used.add(best);
  // 見えている鉛直面ごとに: 面の位置(法線軸)・面の端(接線軸)・高さ を比較
  const diffs = [];
  const dirs = [['+x', 0, 1, e.maxX, 2, e.minZ, e.maxZ], ['-x', 0, -1, e.minX, 2, e.minZ, e.maxZ],
    ['+z', 2, 1, e.maxZ, 0, e.minX, e.maxX], ['-z', 2, -1, e.minZ, 0, e.minX, e.maxX]];
  for (const [label, ax, sgn, faceVal, tax, tmin, tmax] of dirs) {
    const fs = tris.filter((t) => {
      const u = [0, 1, 2].map((a) => t[1][a] - t[0][a]), v = [0, 1, 2].map((a) => t[2][a] - t[0][a]);
      const nrm = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const L = Math.hypot(...nrm) || 1;
      return nrm[ax] / L * sgn > 0.99;
    });
    if (!fs.length) continue;
    const fb = aabb(fs);
    const plane = (fb.mn[ax] + fb.mx[ax]) / 2;
    const d = {
      face: label,
      plane: Math.abs(plane - faceVal),
      edge0: Math.abs(fb.mn[tax] - tmin),
      edge1: Math.abs(fb.mx[tax] - tmax),
      y0: Math.abs(fb.mn[1] - baseY),
      y1: Math.abs(fb.mx[1] - (baseY + GEOM.CEIL_H)),
    };
    diffs.push(d);
  }
  const m = Math.max(0, ...diffs.flatMap((d) => [d.plane, d.edge0, d.edge1, d.y0, d.y1]));
  if (m > maxDiff) { maxDiff = m; worst = n.name; }
  rows.push({ name: n.name, faces: diffs.map((d) => d.face).join(''), maxDiff: m,
    data: `x[${e.minX.toFixed(3)},${e.maxX.toFixed(3)}] z[${e.minZ.toFixed(3)},${e.maxZ.toFixed(3)}]`,
    glb: `x[${bb.mn[0].toFixed(3)},${bb.mx[0].toFixed(3)}] z[${bb.mn[2].toFixed(3)},${bb.mx[2].toFixed(3)}] y[${bb.mn[1].toFixed(3)},${bb.mx[1].toFixed(3)}]` });
  if (m > TOL) fail(`壁 ${n.name} の面がデータとずれている: ${m.toFixed(4)} m`);
}
if (used.size !== expected.length) fail(`対応の付かないデータ壁: ${expected.length - used.size}`);
if (process.argv.includes('--verbose')) console.table(rows);
console.log(`walls: ${wallNodes.length} (data ${expected.length}), visible-face vs collision-box max diff = ${(maxDiff * 100).toFixed(2)} cm (${worst}) [tol ±${TOL * 100} cm]`);

// ---------------- 5: 扉板 ⊆ 扉ブロッカ ----------------
let doorMax = 0;
const doorBoxes = allBoxes.filter((b) => b.kind === 'door');
for (const [n, i] of gltf.nodes.map((n, i) => [n, i]).filter(([n]) => /^DoorLeaf_/.test(n.name))) {
  const rid = n.name.slice('DoorLeaf_'.length);
  const b = doorBoxes.find((d) => d.roomId === rid);
  if (!b) { fail(`扉ブロッカなし: ${rid}`); continue; }
  // 扉板本体(ハンドル等の突起を除く)= 一番大きいプリミティブの AABB を使う
  const tris = nodeTriangles(i);
  const bb = aabb(tris.filter((t) => Math.abs(t[0][1] - t[1][1]) > 1.0 || Math.abs(t[0][1] - t[2][1]) > 1.0));
  const ex = Math.max(0, b.cx - b.w / 2 - bb.mn[0], bb.mx[0] - (b.cx + b.w / 2));
  const ez = Math.max(0, b.cz - b.d / 2 - bb.mn[2], bb.mx[2] - (b.cz + b.d / 2));
  doorMax = Math.max(doorMax, ex, ez);
  if (Math.max(ex, ez) > TOL) fail(`扉板 ${rid} が当たり箱からはみ出す: ${Math.max(ex, ez).toFixed(3)} m`);
}
console.log(`door leaves inside door blockers: max overflow ${(doorMax * 100).toFixed(2)} cm`);

if (failures) { console.error(`check_glb: ${failures} 件失敗`); process.exit(1); }
console.log('check_glb: OK');
