// check_enemy.mjs — 管理人 GLB(build/enemy/07_rigged.glb)の機械テスト(Node・THREE 非依存。GLB を自前でパース)。
//  1) アクション 14 本(名前一致・各長さ > 0)
//  2) 形状キー 2 本(grin / attack)が全プリミティブにある
//  3) スキンの骨 65 本、mixamorig:RightHand / LeftHand / Hips / Head / 両足 が存在
//  4) door_open_in の Hips 位置トラックが前へ動く(ルートモーション ≈ 1.79m)、他はその場(< 0.1m)
//  5) hammer.glb がパースでき、メッシュ 1 つ
// 実行: node tools/check_enemy.mjs [build/enemy/07_rigged.glb]   失敗時は非0終了。

import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const glbPath = process.argv[2] || join(ROOT, 'build', 'enemy', '07_rigged.glb');
const hammerPath = join(ROOT, 'build', 'enemy', 'hammer.glb');
let failures = 0;
const fail = (m) => { failures++; console.error('FAIL:', m); };
const ok = (m) => console.log('ok  ', m);

function parseGLB(p) {
  if (!existsSync(p)) throw new Error('missing ' + p);
  const buf = readFileSync(p);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB: ' + p);
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8;
  const bin = buf.subarray(binStart, binStart + buf.readUInt32LE(20 + jsonLen));
  return { gltf, bin, size: statSync(p).size };
}
function readFloats(gltf, bin, i) {
  const a = gltf.accessors[i];
  if (a.componentType !== 5126) throw new Error('expected float accessor');
  const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  const bv = gltf.bufferViews[a.bufferView];
  const stride = bv.byteStride || 4 * n;
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const dv = new DataView(bin.buffer, bin.byteOffset);
  const out = new Float32Array(a.count * n);
  for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = dv.getFloat32(base + k * stride + c * 4, true);
  return { data: out, n, count: a.count };
}

const { gltf, bin, size } = parseGLB(glbPath);
console.log(`${glbPath.replace(ROOT + '/', '')}: ${(size / 1e6).toFixed(1)} MB`);

// 1) アクション
const EXPECT = ['walk_standard', 'walk_oldman', 'walk_hurried', 'walk_careful', 'walk_brutal', 'run_intent', 'look_idle', 'look_nervous',
  'door_open_in', 'turn_left', 'turn_right', 'react_surprised', 'attack_downward', 'attack_bash'];
const anims = gltf.animations || [];
const names = anims.map((a) => a.name);
if (anims.length !== 14) fail(`actions: ${anims.length} (expected 14)`); else ok('actions: 14');
for (const n of EXPECT) if (!names.includes(n)) fail('missing action ' + n);
const durations = {};
for (const a of anims) {
  let d = 0;
  for (const s of a.samplers) { const acc = gltf.accessors[s.input]; d = Math.max(d, acc.max ? acc.max[0] : 0); }
  durations[a.name] = +d.toFixed(3);
  if (!(d > 0)) fail(`action ${a.name} has zero length`);
}
ok('durations(s): ' + JSON.stringify(durations));

// 2) 形状キー
const mesh = gltf.meshes.find((m) => (m.extras && m.extras.targetNames) || m.primitives.some((p) => p.targets));
const tn = mesh && mesh.extras && mesh.extras.targetNames;
if (!tn || tn.length !== 2 || !tn.includes('grin') || !tn.includes('attack')) fail('shape keys: ' + JSON.stringify(tn));
else ok('shape keys: ' + tn.join(', '));
const primsWithout = mesh ? mesh.primitives.filter((p) => !p.targets || p.targets.length !== 2).length : -1;
if (primsWithout !== 0) fail(`primitives without 2 morph targets: ${primsWithout}`); else ok(`all ${mesh.primitives.length} primitives carry 2 morph targets`);

// 3) 骨
const skin = (gltf.skins || [])[0];
const joints = skin ? skin.joints.map((j) => gltf.nodes[j].name) : [];
if (joints.length !== 65) fail(`bones: ${joints.length} (expected 65)`); else ok('bones: 65');
for (const b of ['mixamorig:RightHand', 'mixamorig:LeftHand', 'mixamorig:Hips', 'mixamorig:Head', 'mixamorig:LeftFoot', 'mixamorig:RightFoot']) {
  if (!joints.includes(b)) fail('missing bone ' + b);
}
ok('bones present: RightHand, LeftHand, Hips, Head, LeftFoot, RightFoot');

// 4) ルートモーション(Hips の位置トラック。骨格ローカル +Y = 前)
const hipsIdx = gltf.nodes.findIndex((n) => n.name === 'mixamorig:Hips');
const travel = {};
for (const a of anims) {
  const ch = a.channels.find((c) => c.target.node === hipsIdx && c.target.path === 'translation');
  if (!ch) { travel[a.name] = 0; continue; }
  const v = readFloats(gltf, bin, a.samplers[ch.sampler].output);
  const y0 = v.data[1], y1 = v.data[(v.count - 1) * 3 + 1];
  travel[a.name] = +(y1 - y0).toFixed(3);
}
if (Math.abs(travel.door_open_in - 1.79) > 0.05) fail(`door_open_in root travel ${travel.door_open_in} (expected ≈1.79)`); else ok(`door_open_in root travel: ${travel.door_open_in} m`);
const drifting = Object.entries(travel).filter(([k, v]) => k !== 'door_open_in' && Math.abs(v) > 0.1);
if (drifting.length) fail('in-place actions drift: ' + JSON.stringify(drifting)); else ok('other 13 actions in place (|travel| <= 0.1 m)');

// 5) ハンマー
try {
  const h = parseGLB(hammerPath);
  if (h.gltf.meshes.length !== 1) fail('hammer meshes: ' + h.gltf.meshes.length); else ok(`hammer.glb: 1 mesh (${(h.size / 1e6).toFixed(1)} MB)`);
} catch (e) { fail(String(e.message || e)); }

if (failures) { console.error(`check_enemy: ${failures} failure(s)`); process.exit(1); }
console.log('check_enemy: OK');
