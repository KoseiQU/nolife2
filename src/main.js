// main.js — P0 縦切り: Blender でベイクした 4F 廊下(build/p0.glb + ライトマップ)を歩く。
// 見た目は GLB、当たりは building.json(walls.js)+ src/p0_region.json の塞ぎ。
// 光: ベイク済みライトマップ(常夜灯・非常口・窓のGI)+ リアルタイムは懐中電灯(SpotLight+影)だけ。
// ポスト: GTAO(弱) → bloom(ごく弱・閾値高) → OutputPass(ACES+sRGB) → 粒子+ビネット。

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { Player } from './player.js';
import { buildCollisions } from './p0_region.js';
import { GEOM } from './walls.js';
import { Enemy } from './enemy.js';
import { EnemyAI } from './enemy_ai.js';
import { EnemyAudio } from './enemy_audio.js';
import { Peephole } from './peephole.js';
import { AttackMovie } from './attack_movie.js';

const PARAMS = new URLSearchParams(location.search);

// 見た目の調整値(目視で決める。DESIGN §3.2「やり過ぎない」)
export const LOOK = {
  exposure: 4.5,        // ACES 前の露出
  lightmapGain: 1.2,    // ライトマップ強度への追加倍率(1 = Cycles と同じ物理量)。P2c: 消灯時の常夜灯・窓明かりを少し持ち上げる(§3.2.1)
  // P2c(§3.2.1「消灯時でも輪郭が見える下限」): ごく弱い環境光の床(半球光。空=月明かりの青灰、床=暖色の照り返し)。
  // ライトマップがほぼ 0 の室内(410)でも、壁・扉・人影の輪郭が分かる程度。敵の材質にも効く(人影のシルエット)
  ambientFloor: 0.12,
  ambientSky: 0x8a96b0,
  ambientGround: 0x2a2420,
  fogDensity: 0.05,
  fogColor: 0x020305,
  aoIntensity: 0.55,    // GTAO の混ぜ具合(ベイクに既に AO が入っているので弱め)
  bloomStrength: 0.22,
  bloomRadius: 0.55,
  bloomThreshold: 1.6,  // HDR 値。灯具・非常口サインの発光面だけが越える
  grain: 0.045,
  vignette: 0.42,
  maxRenderPixels: 1920 * 1080,   // Retina でもこの画素数を上限に描く(60fps 目標)
  // 発光面の見た目だけの倍率(ベイク側の光量は Blender の値のまま)。窓は面で見ると白飛びするので抑える
  emissiveScale: { M_Window: 0.15, M_LampCover: 1.0, M_ExitSign: 1.0, M_Button: 1.0, M_CarCeiling: 0.0,  // カゴ照明=待機中は消灯
    M_ExitSignSq: 0.22, M_WireGlassOut: 0.15, M_EVDisplay: 0.6 },   // 近くで見る発光面は白飛びしない程度に
  // 金属とガラスだけに弱い環境反射(ライトマップは拡散だけなので、無いと SUS が真っ黒に見える)
  metalEnv: 0.08,
  glassEnv: 0.06,
};

const errBox = document.getElementById('err');
const showErr = (e) => { errBox.textContent += String(e && e.stack || e) + '\n'; console.error(e); };
window.addEventListener('error', (e) => showErr(e.error || e.message));

async function getJSON(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = LOOK.exposure;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;   // r187 で PCFSoft は廃止(警告が毎フレーム出る)
renderer.info.autoReset = false;   // composer の全パス合計を1フレーム分として数える(render() 冒頭でリセット)
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.FogExp2(LOOK.fogColor, LOOK.fogDensity);
const ambientFloor = new THREE.HemisphereLight(LOOK.ambientSky, LOOK.ambientGround, LOOK.ambientFloor);
scene.add(ambientFloor);
const camera = new THREE.PerspectiveCamera(68, 16 / 9, 0.05, 60);
scene.add(camera);

// ---------------------------------------------------------------- post
// MSAA は composer の2枚のターゲット全部に掛かり、1080p で約9ms 食った(M4 実測)→ 切って SMAA を後段に置く
const rt = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, samples: 0 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const gtao = new GTAOPass(scene, camera, 16, 16);
gtao.output = GTAOPass.OUTPUT.Default;
gtao.blendIntensity = LOOK.aoIntensity;
gtao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.6, thickness: 1.2, scale: 1.0, samples: 12, distanceFallOff: 1.0 });
gtao.updatePdMaterial({ samples: 8 });
// GTAO は半解像度で計算して全解像度へ合成(全解像度だと 1080p で約5ms→半分で約1.5ms)
const gtaoSetSize = gtao.setSize.bind(gtao);
gtao.setSize = (w, h) => gtaoSetSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
composer.addPass(gtao);
const bloom = new UnrealBloomPass(new THREE.Vector2(16, 16), LOOK.bloomStrength, LOOK.bloomRadius, LOOK.bloomThreshold);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const smaa = new SMAAPass();
composer.addPass(smaa);
const grainPass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, grain: { value: LOOK.grain }, vignette: { value: LOOK.vignette } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time; uniform float grain; uniform float vignette; varying vec2 vUv;
    float hash(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      // ビネット(楕円・なだらか)
      vec2 d = (vUv - 0.5) * vec2(1.0, 0.82);
      float v = 1.0 - smoothstep(0.18, 0.85, length(d) * (1.0 + vignette));
      c.rgb *= mix(1.0, v, vignette * 1.6);
      // フィルム粒子: 暗部ほど目立つ(実写の高感度ノイズに寄せる)
      float n = hash(vUv * 1024.0 + fract(time * 13.37) * 97.0) - 0.5;
      float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb += n * grain * (1.15 - lum);
      gl_FragColor = c;
    }`,
});
composer.addPass(grainPass);

let renderSizeOverride = null;
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  let pr, cw, ch;
  if (renderSizeOverride) {
    [cw, ch] = renderSizeOverride; pr = 1;
    renderer.setPixelRatio(1);
    renderer.setSize(cw, ch, false);
  } else {
    pr = Math.min(window.devicePixelRatio || 1, Math.sqrt(LOOK.maxRenderPixels / (w * h)));
    pr = Math.max(0.5, pr);
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h);
    cw = Math.round(w * pr); ch = Math.round(h * pr);
  }
  camera.aspect = cw / ch;
  camera.updateProjectionMatrix();
  composer.setPixelRatio(renderSizeOverride ? 1 : pr);
  composer.setSize(renderSizeOverride ? cw : w, renderSizeOverride ? ch : h);
}
window.addEventListener('resize', resize);

// ---------------------------------------------------------------- load
const [building, region] = await Promise.all([getJSON('./data/building.json'), getJSON('./src/p0_region.json')]);
const manifest = await getJSON('./build/p0_manifest.json');
const { collisions } = buildCollisions(building, region);
const floorY = (region.level - 1) * GEOM.FLOOR_H;

const gltf = await new GLTFLoader().loadAsync('./build/' + manifest.glb);
const lightMap = await new THREE.TextureLoader().loadAsync('./build/' + manifest.lightmap.file);
lightMap.flipY = false;                       // glTF の UV 規約(左上原点)に合わせる
lightMap.channel = manifest.lightmap.channel; // = 1 → TEXCOORD_1(GLTFLoader は uv1 に載せる)
lightMap.colorSpace = manifest.lightmap.encoding === 'srgb' ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
lightMap.generateMipmaps = true;
lightMap.minFilter = THREE.LinearMipmapLinearFilter;
lightMap.magFilter = THREE.LinearFilter;

const maxAniso = renderer.capabilities.getMaxAnisotropy();
const pmrem = new THREE.PMREMGenerator(renderer);
const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const GLASS = new Set(['M_WireGlass', 'M_WireGlassOut', 'M_Window', 'M_EVDisplay']);
const seenMats = new Set();
const NO_SHADOW = new Set(['lampcover', 'exitsign_face', 'windowglass', 'void', 'evbutton']);
gltf.scene.traverse((o) => {
  if (!o.isMesh) return;
  const kind = (o.userData.n2_kind || o.parent?.userData.n2_kind || '');
  o.castShadow = !NO_SHADOW.has(kind);
  o.receiveShadow = true;
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  for (const m of mats) {
    if (seenMats.has(m)) continue;
    seenMats.add(m);
    m.lightMap = lightMap;
    m.lightMapIntensity = manifest.lightmap.intensity * LOOK.lightmapGain;
    for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap']) {
      if (m[k]) { m[k].anisotropy = maxAniso; m[k].needsUpdate = true; }
    }
    m.envMapIntensity = 0;
    if (m.metalness > 0.5 || GLASS.has(m.name)) {
      m.envMap = envTex;
      m.envMapIntensity = m.metalness > 0.5 ? LOOK.metalEnv : LOOK.glassEnv;
    }
    if (LOOK.emissiveScale[m.name] !== undefined) m.emissiveIntensity *= LOOK.emissiveScale[m.name];
    m.needsUpdate = true;
  }
});
scene.add(gltf.scene);
mergeStatic(gltf.scene);

// 静的メッシュ(扉板以外)を材質ごとに1つへ結合する。115 プリミティブ × (本描画+影+GTAO法線) で
// 1フレーム 400 ドローコール超になっていたため。扉板はヒンジ回転するので個別のまま残す。
function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const MOVABLE = new Set(['door', 'evdoor']);   // 扉板・EV扉(左右)は後で動かすので結合しない
  const isDoor = (o) => { for (let p = o; p; p = p.parent) if (p.userData && MOVABLE.has(p.userData.n2_kind)) return true; return false; };
  const groups = new Map();
  const victims = [];
  root.traverse((o) => {
    if (!o.isMesh || isDoor(o)) return;
    const key = o.material.uuid + (o.castShadow ? ':s' : ':n');
    if (!groups.has(key)) groups.set(key, { material: o.material, castShadow: o.castShadow, geoms: [] });
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'uv1'].includes(name)) g.deleteAttribute(name);
    groups.get(key).geoms.push(g);
    victims.push(o);
  });
  for (const o of victims) o.removeFromParent();
  for (const { material, castShadow, geoms } of groups.values()) {
    const merged = mergeGeometries(geoms.map((g) => (g.index ? g : g)), false);
    if (!merged) { console.warn('merge failed', material.name); continue; }
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = 'merged_' + material.name;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    root.add(mesh);
  }
}

// ---------------------------------------------------------------- doors
const doors = [];
gltf.scene.traverse((o) => {
  if (o.userData.n2_kind !== 'door') return;
  const roomId = String(o.userData.n2_room);
  doors.push({
    roomId, node: o,
    operable: !!o.userData.n2_operable,
    sign: o.userData.n2_open_sign || 1,
    openAngle: o.userData.n2_open_angle || 0,
    angle: 0, target: 0,
    locked: false,          // P2b: 内側から施錠(L)。管理人は鍵で開ける
    speedMul: 1,            // 管理人が押し開けるときは速い
    collision: collisions.find((c) => c.kind === 'door' && c.roomId === roomId) || null,
  });
});
const DOOR_SPEED = 2.4; // rad/s(前作3.4は速すぎた)
function useNearestDoor() {
  const p = player.object.position;
  const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
  let best = null, bestD = 1.9;
  for (const d of doors) {
    const c = d.collision;
    if (!c) continue;
    const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
    const dx = cx - p.x, dz = cz - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist > bestD) continue;
    if ((dx * fwd.x + dz * fwd.z) / Math.max(dist, 1e-3) < 0.35) continue; // 見ている方の扉
    best = d; bestD = dist;
  }
  if (!best) return null;
  if (best.operable && !(best.locked && best.target === 0)) {
    best.target = best.target > 0 ? 0 : best.openAngle;
    best.speedMul = 1;
    if (ai) ai.noise(best.node.position.x, best.node.position.z, 9.0);   // 扉の開閉音(聴覚 9m)
  } else best.rattle = 0.25;   // 施錠: ノブだけ鳴る。ごく小さく揺らす
  return best.roomId;
}
function nearestOperableDoor(maxD = 1.6) {
  const p = player.object.position;
  let best = null, bd = maxD;
  for (const d of doors) {
    if (!d.operable || !d.collision) continue;
    const c = d.collision;
    const dist = Math.hypot((c.minX + c.maxX) / 2 - p.x, (c.minZ + c.maxZ) / 2 - p.z);
    if (dist < bd) { bd = dist; best = d; }
  }
  return best;
}
// 扉 API(AI・デバッグ用)
const doorApi = {
  get: (id) => doors.find((d) => d.roomId === String(id)) || null,
  isOpen: (id) => { const d = doorApi.get(id); return !!(d && d.collision && d.collision.disabled); },
  open: (id, speed = 1) => { const d = doorApi.get(id); if (d && d.operable) { d.target = d.openAngle; d.speedMul = speed; } },
  close: (id, speed = 1) => { const d = doorApi.get(id); if (d && d.operable) { d.target = 0; d.speedMul = speed; } },
  setLocked: (id, v) => { const d = doorApi.get(id); if (d) d.locked = !!v; },
};
function updateDoors(dt) {
  for (const d of doors) {
    if (d.operable) {
      const delta = d.target - d.angle;
      if (Math.abs(delta) > 1e-4) {
        // 開け始めは重く、途中で滑らかに(ドアクローザー感)
        const k = 0.35 + 0.65 * Math.min(1, Math.abs(d.angle) / 0.4);
        d.angle += Math.sign(delta) * Math.min(Math.abs(delta), DOOR_SPEED * k * (d.speedMul || 1) * dt);
      }
      d.node.rotation.y = d.sign * d.angle;
      if (d.collision) d.collision.disabled = d.angle > 0.25;
    } else if (d.rattle > 0) {
      d.rattle -= dt;
      d.node.rotation.y = d.sign * Math.sin(d.rattle * 90) * 0.004 * (d.rattle / 0.25);
    }
  }
}

// ---------------------------------------------------------------- player
const player = new Player(camera, renderer.domElement, { collisions, floorY });
player.onUse = onUseKey;
player.setPose(region.spawn.x, region.spawn.z, region.spawn.yaw, -0.03);

// ---------------------------------------------------------------- enemy (P2b)
// 常夜灯(manifest.lamps)・非常口サイン・窓の位置に「敵だけに効く」弱い光を置く(enemy.js のシェーダ注入)
const mstDoor = doors.find((d) => d.roomId === 'MST4');
const enemy = new Enemy(scene, {
  floorY, collisions,
  lamps: manifest.lamps || [],
  exitLamps: mstDoor ? [[mstDoor.node.position.x + 0.1, floorY + 2.15, mstDoor.collision ? (mstDoor.collision.minZ + mstDoor.collision.maxZ) / 2 : 21.2]] : [],
  windowLamps: region.window ? [[region.window.x, floorY + region.window.sill + region.window.h / 2, region.window.z + 0.15]] : [],
});
await enemy.load();
// 扉の情報(AI の立ち位置): 廊下側の法線とノブの向き(manifest の蝶番位置から)
const FACING_N = { W: [-1, 0], E: [1, 0], N: [0, -1], S: [0, 1] };
const doorInfo = [];
for (const d of doors) {
  const room = building.floors.find((f) => f.level === region.level).rooms.find((r) => r.id === d.roomId);
  if (!room || !room.door) continue;
  const m = (manifest.doors || []).find((md) => md.id === d.roomId);
  const [px, pz] = room.door.pos;
  const n = FACING_N[room.door.facing];
  let knob = [-n[1], n[0]];
  if (m && m.hinge) { const hx = m.hinge[0], hz = m.hinge[2]; const s2 = Math.sign((px - hx) * knob[0] + (pz - hz) * knob[1]) || 1; knob = [knob[0] * s2, knob[1] * s2]; }
  doorInfo.push({ roomId: d.roomId, pos: [px, pz], normal: n, knob });
}
const enemyAudio = new EnemyAudio(camera, enemy);
const resumeAudio = () => enemyAudio.resume();
window.addEventListener('pointerdown', resumeAudio);
window.addEventListener('keydown', resumeAudio);
const CHECKPOINT = { x: 8.75, z: 7.3, yaw: Math.PI / 2 };   // 410 の入口(室内、扉を向く)
const ENEMY_HOME = { x: 6.9, z: 20.6, yaw: Math.PI };       // 復帰時の管理人(EV ホール、北を向く)
const ai = new EnemyAI({ enemy, audio: enemyAudio, player, collisions, doors: doorApi, doorInfo, floorY,
  onKill: () => { movie.hit(); startDeath(); },
  onAttackStart: () => { if (peephole.active) { peephole.forced = false; peephole.set(false); } pendingE = null; movie.start(); } });
// P2c: 襲撃ムービー(固定カメラ・顔の補助光・血飛沫)。血の合成は最終段(粒子の後)
const movie = new AttackMovie({ camera, player, enemy, scene, audio: enemyAudio });
composer.addPass(movie.pass);
if (PARAMS.has('noai')) ai.setState('SCRIPTED');
else ai.reset(ENEMY_HOME.x, ENEMY_HOME.z, ENEMY_HOME.yaw);

// ---------------------------------------------------------------- peephole (P2b)
const door410 = doors.find((d) => d.roomId === '410');
const lens = (() => {
  const c = door410.collision;
  const z = (c.minZ + c.maxZ) / 2;
  const rc = new THREE.Raycaster(new THREE.Vector3(c.minX - 0.4, floorY + 1.48, z), new THREE.Vector3(1, 0, 0), 0, 1);
  door410.node.updateMatrixWorld(true);
  const hit = rc.intersectObject(door410.node, true)[0];
  return { x: (hit ? hit.point.x : c.minX) - 0.015, z, yaw: Math.PI / 2 };
})();
const peephole = new Peephole({ camera, player, floorY, lens });
composer.insertPass(peephole.pass, composer.passes.indexOf(grainPass));
let doorScope = null;
buildDoorScopeInside();

// P2c: ドアスコープを室内側から見えるように(§3.4.1)。扉板の内面・目の高さに真鍮のリングとレンズ。
// 扉板(door410.node)の子にするので扉と一緒に回る。レンズには廊下側の光の点(小さな発光)と環境反射
function buildDoorScopeInside() {
  const c = door410.collision;
  const z = (c.minZ + c.maxZ) / 2;
  const rc = new THREE.Raycaster(new THREE.Vector3(c.maxX + 0.5, floorY + 1.48, z), new THREE.Vector3(-1, 0, 0), 0, 1);
  const hit = rc.intersectObject(door410.node, true)[0];
  const innerX = hit ? hit.point.x : c.maxX;
  const grp = new THREE.Group();
  grp.name = 'DoorScopeInside_410';
  const brass = new THREE.MeshStandardMaterial({ color: 0xb48a46, metalness: 1.0, roughness: 0.32, envMap: envTex, envMapIntensity: 0.55 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0165, 0.0048, 10, 28).rotateY(Math.PI / 2), brass);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.0125, 0.012, 20).rotateZ(Math.PI / 2), brass);
  barrel.position.x = 0.002;
  const dot = (() => {     // 廊下の常夜灯がレンズに映った点(少し上にずれた小さな光)
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const g = cv.getContext('2d');
    const gr = g.createRadialGradient(38, 24, 0, 38, 24, 14);
    gr.addColorStop(0, 'rgba(255,236,200,1)'); gr.addColorStop(0.35, 'rgba(255,214,160,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = '#000'; g.fillRect(0, 0, 64, 64); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const lensMat = new THREE.MeshStandardMaterial({ color: 0x07090c, roughness: 0.04, metalness: 0.0, envMap: envTex, envMapIntensity: 0.9,
    emissive: 0xffffff, emissiveMap: dot, emissiveIntensity: 0.9 });
  const lensMesh = new THREE.Mesh(new THREE.CircleGeometry(0.011, 24).rotateY(Math.PI / 2), lensMat);
  lensMesh.position.x = 0.0085;
  grp.add(ring, barrel, lensMesh);
  for (const m of [ring, barrel, lensMesh]) { m.castShadow = false; m.receiveShadow = true; }
  // 扉板ローカル(開閉角 0 のとき世界の向きと同じ。原点 = 蝶番)
  grp.position.set(innerX - door410.node.position.x + 0.004, floorY + 1.48 - door410.node.position.y, z - door410.node.position.z);
  door410.node.add(grp);
  doorScope = grp;
}
const peepHint = document.createElement('div');
peepHint.textContent = 'E長押し：覗く';
peepHint.style.cssText = 'position:fixed;left:0;right:0;bottom:12vh;text-align:center;color:#c9c2b6;font:13px/1.6 -apple-system,"Hiragino Sans",sans-serif;letter-spacing:.12em;opacity:0;transition:opacity .25s;pointer-events:none;text-shadow:0 0 6px #000;';
document.body.appendChild(peepHint);
let pendingE = null;   // E の長押し判定 {t, held}
function canPeep() {
  const p = player.object.position;
  if (door410.angle > 0.03) return false;
  if (!(p.x > 7.86 && p.z > 5.8 && p.z < 8.7)) return false;   // 410 の室内
  const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
  const dx = lens.x - p.x, dz = lens.z - p.z, dist = Math.hypot(dx, dz);
  return dist < 1.2 && (dx * fwd.x + dz * fwd.z) / dist > 0.5;   // P2c: 1.2m 以内で扉に正対(ヒント表示と同じ条件)
}
function onUseKey() {
  if (canPeep()) { pendingE = { t: 0, held: false }; return null; }   // 短押し=扉、長押し=覗き穴(離した時に決まる)
  return useNearestDoor();
}
player.onKey = (code) => {
  if (death) return;
  if (code === 'KeyL') {
    const d = nearestOperableDoor();
    if (d && d.angle < 0.02) {
      d.locked = !d.locked;
      enemyAudio.play('lock', new THREE.Vector3((d.collision.minX + d.collision.maxX) / 2, floorY + 1.0, (d.collision.minZ + d.collision.maxZ) / 2), 0.5);
      ai.noise(d.node.position.x, d.node.position.z, 5.0);
    }
  }
  if (code === 'KeyP' && canPeep()) peephole.set(true);
};
function updatePeepInput(dt) {
  if (pendingE) {
    if (player.keys.has('KeyE')) {
      pendingE.t += dt;
      if (!pendingE.held && pendingE.t >= 0.35) { pendingE.held = true; peephole.set(true); }
    } else {
      if (pendingE.held) peephole.set(false); else useNearestDoor();
      pendingE = null;
    }
  }
  if (peephole.active && !pendingE && !player.keys.has('KeyP') && !peephole.forced) peephole.set(false);
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  peephole.update(size.x, size.y);
  peepHint.style.opacity = (!peephole.active && !death && !movie.active && canPeep()) ? '1' : '0';
}

// ---------------------------------------------------------------- death / checkpoint (P2b)
const overlay = document.createElement('div');
overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;background:#000;opacity:0;display:flex;align-items:center;justify-content:center;';
const flash = document.createElement('div');
flash.style.cssText = 'position:fixed;inset:0;pointer-events:none;background:#8a0000;opacity:0;mix-blend-mode:normal;';
const caption = document.createElement('div');
caption.textContent = '見つかった';
caption.style.cssText = 'color:#b9b2a8;font:500 22px/1 "Hiragino Mincho ProN","Yu Mincho",serif;letter-spacing:.5em;opacity:0;transition:none;';
overlay.appendChild(caption);
document.body.append(flash, overlay);
let death = null;   // { t, respawned }
// P2c: ヒット(t=0)の後は血飛沫を見せてから暗転。ATTACK 開始から暗転完了まで ≈0.85+1.75 = 2.6 秒
const DEATH = { flash: 0.08, blackFrom: 1.1, toBlack: 1.75, hold: 3.0, fadeIn: 0.8 };
function startDeath() {
  if (death) return;
  death = { t: 0, respawned: false };
  if (peephole.active) { peephole.forced = false; peephole.set(false); }
  pendingE = null;
  player.frozen = true;
}
function updateDeath(dt) {
  if (!death) return;
  death.t += dt;
  const t = death.t;
  flash.style.opacity = String(t < DEATH.flash ? 0.35 : Math.max(0, 0.35 - (t - DEATH.flash) * 3));
  const respawnAt = DEATH.toBlack + DEATH.hold;
  let black;
  if (t < respawnAt) black = Math.min(1, Math.max(0, (t - DEATH.blackFrom) / (DEATH.toBlack - DEATH.blackFrom)));
  else black = Math.max(0, 1 - (t - respawnAt) / DEATH.fadeIn);
  overlay.style.opacity = String(black);
  caption.style.opacity = String(t > DEATH.toBlack && t < respawnAt ? Math.min(1, (t - DEATH.toBlack) * 2) : Math.max(0, 1 - (t - respawnAt) * 3));
  // (襲われた瞬間のカメラの沈み・傾きは襲撃ムービー側が行う)
  if (!death.respawned && t >= respawnAt) {
    death.respawned = true;
    door410.angle = 0; door410.target = 0; door410.locked = false; door410.speedMul = 1;
    if (door410.collision) door410.collision.disabled = false;
    movie.end();
    player.object.rotation.z = 0;
    player.crouch = false;
    player.setPose(CHECKPOINT.x, CHECKPOINT.z, CHECKPOINT.yaw, 0);
    player.frozen = false;
    ai.reset(ENEMY_HOME.x, ENEMY_HOME.z, ENEMY_HOME.yaw);
    deathCount++;
  }
  if (t >= respawnAt + DEATH.fadeIn) { death = null; overlay.style.opacity = '0'; flash.style.opacity = '0'; caption.style.opacity = '0'; }
}
let deathCount = 0;
renderer.domElement.addEventListener('click', () => { if (!player.isLocked()) player.lock(); });
player.controls.addEventListener('lock', () => document.body.classList.add('locked'));
player.controls.addEventListener('unlock', () => document.body.classList.remove('locked'));
resize();

// ---------------------------------------------------------------- loop
const frameTimes = []; // [timestamp, frameMs, cpuMs]
let last = performance.now();
let simTime = 0;
function step(dt) {
  simTime += dt;
  player.update(dt);
  updatePeepInput(dt);
  camera.updateMatrixWorld();
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  ai.update(dt);
  enemy.update(dt, camera);
  movie.update(dt);
  updateDoors(dt);
  enemyAudio.update(dt);
  updateDeath(dt);
  grainPass.uniforms.time.value = simTime;
}
function render() { renderer.info.reset(); composer.render(); }
function frame(now) {
  const dt = (now - last) / 1000; last = now;
  const t0 = performance.now();
  step(Math.min(dt, 0.1));
  render();
  const cpu = performance.now() - t0;
  frameTimes.push([now, dt * 1000, cpu]);
  while (frameTimes.length && now - frameTimes[0][0] > 1000) frameTimes.shift();
  requestAnimationFrame(frame);
}
// P2c: 襲撃ムービーの血(ShaderPass)と血煙(Points)のシェーダを先にコンパイルしておく(初回発動時の 50ms 級の引っかかり対策)
movie.pass.enabled = true; movie.mist.points.visible = true;
render();
movie.pass.enabled = false; movie.mist.points.visible = false;
requestAnimationFrame(frame);

// ---------------------------------------------------------------- debug hook
function stats() {
  const n = frameTimes.length;
  const avg = (i) => (n ? frameTimes.reduce((s, f) => s + f[i], 0) / n : 0);
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  return {
    frames: n,
    frameMsAvg: +avg(1).toFixed(2),
    fps: n ? +(1000 / avg(1)).toFixed(1) : 0,
    cpuMsAvg: +avg(2).toFixed(2),
    cpuMsMax: n ? +Math.max(...frameTimes.map((f) => f[2])).toFixed(2) : 0,
    drawingBuffer: [size.x, size.y],
    render: { ...renderer.info.render },
    memory: { ...renderer.info.memory },
    programs: renderer.info.programs?.length,
  };
}
window.__n2 = {
  THREE, scene, camera, renderer, player, composer, doors, collisions, manifest, LOOK,
  enemyObj: enemy, ai, enemyAudio, peepholeObj: peephole, doorApi, lens, CHECKPOINT, ENEMY_HOME,
  movie, ambientFloor, get doorScope() { return doorScope; }, peepHintVisible: () => peepHint.style.opacity === '1',
  // 手動ポンプ: 本物のループと同じ順(player → peephole入力 → AI → enemy(mixer) → doors → 音 → 死亡演出)で n 回進め、最後に1回描画
  pump(dt = 1 / 60, n = 1, render = true) { for (let i = 0; i < n; i++) step(dt); if (render) this.render(); return ai.stats(); },
  peephole(on) { peephole.forced = !!on; if (on) peephole.set(true); else peephole.set(false); return { active: peephole.active, fov: camera.fov, pos: camera.position.toArray() }; },
  deathState: () => (death ? { t: +death.t.toFixed(2), respawned: death.respawned } : null),
  deaths: () => deathCount,
  enemy: {
    place(x, z, yaw = 0) { enemy.place(x, z, yaw); return ai.stats(); },
    // opts: LURK のとき { spot: 隠れ場所 id, standNow: true でその場で潜伏 }
    setState(s, opts = {}) {
      if (s === 'ATTACK' || s === 'CHASE' || s === 'ALERT') ai.lastKnown = { x: player.pos.x, z: player.pos.z };
      ai.uninterruptible = false;
      ai.setState(s, { force: true, log: true, react: s === 'ALERT', ...opts });
      return ai.stats();
    },
    play(name) { ai.setState('SCRIPTED', { force: true }); enemy.play(name, { restart: true }); return name; },
    face(name, v) { enemy.setFace(name, v, true); return { ...enemy.face }; },
    goto(x, z) { ai.setState('SCRIPTED', { force: true, goto: { x, z } }); return ai.stats(); },
    flashlight(on) { enemy.setFlashlight(on); },
    stats() { return { ...ai.stats(), clipSpeed: enemy.clipSpeed, bounceDistance: enemy.bounceDistance, cutoff: enemyAudio.cutoff }; },
    events: () => ai.events,
  },
  passes: { gtao, bloom, smaa, grain: grainPass },
  stats,
  step, render,
  // カメラを直接置く(ヘッドレスではポインタロックが張れないため)。x,z は足元、yaw/pitch はラジアン
  setView(x, z, yaw, pitch = 0, crouch = false) { player.crouch = crouch; player.setPose(x, z, yaw, pitch); },
  setFlashlight(on) { player.setFlashlight(on); },
  openDoor(roomId, open = true) {
    const d = doors.find((dd) => dd.roomId === String(roomId));
    if (d && d.operable) { d.target = open ? d.openAngle : 0; }
    return !!d;
  },
  setRenderSize(w, h) { renderSizeOverride = w ? [w, h] : null; resize(); },
  setExposure(v) { renderer.toneMappingExposure = v; },
  setLightmapGain(g) { for (const m of seenMats) m.lightMapIntensity = manifest.lightmap.intensity * g; },
};
window.__N2 = window.__n2;
if (PARAMS.get('test') === 'enemy') import('../tools/test_enemy.js').then((m) => m.run(window.__N2)).catch(showErr);
