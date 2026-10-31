// main.js — P3a 全館の外殻: 1F〜7F(＋屋上B)を階ごとのベイク済み GLB(build/floor_N.glb + ライトマップ)で歩く。
// 見た目は GLB(居る階 ±1 だけ読み込み: world.js)、当たりは building.json(walls.js)を全階ぶん常駐。
// 階の移動: EV(elevator.js)と外階段・北階段(stairs.js)。開始は 4F の 410 の前(P0 と同じ)。
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
import { GEOM } from './walls.js';
import { World, levelY, glbLevel, FACING_N, LEVELS } from './world.js';
import { Stairs } from './stairs.js';
import { Elevator, EV } from './elevator.js';
import { Enemy } from './enemy.js';
import { EnemyAI } from './enemy_ai.js';
import { EnemyAudio } from './enemy_audio.js';
import { Peephole } from './peephole.js';
import { AttackMovie } from './attack_movie.js';
import { Hud } from './hud.js';
import { HUD_TEXT } from './hud_text.js';

const PARAMS = new URLSearchParams(location.search);
// 見学モード(?tour): 建物だけを見て回る。管理人を出さない(scene から外す・AI と声/足音を止める)、扉は全部開けられる
// (契約で「開かない」と決まっている地下の鉄扉は除く)、死亡・襲撃ムービーなし。?tour&floor=N(1〜7・RB・B1)で開始階を指定
const TOUR = PARAMS.has('tour');

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
    M_ExitSignSq: 0.22, M_WireGlassOut: 0.15, M_EVDisplay: 0.6, M_EVCarDisplay: 0.6,   // 近くで見る発光面は白飛びしない程度に
    M_Backdrop: 0.3, M_BracketCover: 0.5 },                         // P3a: 正面玄関の外の暗い街路・屋外の壁付け灯
  // 金属とガラスだけに弱い環境反射(ライトマップは拡散だけなので、無いと SUS が真っ黒に見える)
  metalEnv: 0.08,
  glassEnv: 0.06,
  // P3a-2: 風除室の透明ガラス(MeshPhysicalMaterial)。粗さは指紋・汚れのマップ(build/tex/glass_smudge)が掛かる
  glass: { roughness: 1.0, transmission: 1.0, thickness: 0.012, tint: 0xa8d8c8, tintDistance: 0.35 },
  probeGain: 1.0,     // 風除室の静的環境(キューブカメラ)の映り込みの倍率(材質ごとの値は manifest.envProbe.intensity)
  // 透過(transmission)の背景を描く解像度。1 だと風除室を見ている間 GPU が約 +8ms(内蔵ブラウザの計測)、0.5 で約 +2〜3ms
  transmissionScale: 0.5,
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
renderer.transmissionResolutionScale = LOOK.transmissionScale;   // P3a-2: 風除室の物理ガラス
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
const manifests = {};
await Promise.all(LEVELS.map(async (lv) => { manifests[lv] = await getJSON(`./build/floor_${lv}_manifest.json`); }));
const pmrem = new THREE.PMREMGenerator(renderer);
const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const world = new World({ scene, renderer, building, manifests, envTex, look: LOOK, tour: TOUR });
let playerLevel = region.level;          // 階のキー(1..7 / 'RB')。開始は 4F
const floorY = levelY(region.level);     // 4F(410・覗き穴・チェックポイントの階)
world.setVisible([glbLevel(playerLevel)]);
await world.focus(playerLevel);
const collisions = world.collisions(4);  // 4F の当たり(P0 互換の参照。プレイヤーの今の階は world.collisions(playerLevel))
const manifest = manifests[4];
const seenMats = { forEach: (fn) => { for (const rec of world.floors.values()) for (const m of rec.mats) fn(m); } };

// ---------------------------------------------------------------- doors
// 扉の状態は world が全階ぶん持つ(GLB の扉板は読み込まれた時に結び付く)。ここはプレイヤーの階の扉だけを相手にする
const doors = world.doors;
const doorsHere = () => doors.filter((d) => d.level === playerLevel && d.collision);
function useNearestDoor() {
  const p = player.object.position;
  const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
  let best = null, bestD = 1.9;
  for (const d of doorsHere()) {
    const c = d.collision;
    const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
    const dx = cx - p.x, dz = cz - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist > bestD) continue;
    if ((dx * fwd.x + dz * fwd.z) / Math.max(dist, 1e-3) < 0.35) continue; // 見ている方の扉
    best = d; bestD = dist;
  }
  lastUseLocked = false;
  if (!best) return null;
  if (best.kind === 'auto') return best.roomId;                     // 自動ドアは近づけば開く
  if (best.operable && !(best.locked && best.target === 0)) {
    best.target = best.target > 0 ? 0 : best.openAngle;
    best.speedMul = 1;
    if (ai) ai.noise((best.collision.minX + best.collision.maxX) / 2, (best.collision.minZ + best.collision.maxZ) / 2, 9.0);   // 扉の開閉音(聴覚 9m)
  } else {
    best.rattle = 0.25; lastUseLocked = true;   // 施錠: ノブだけ鳴る。ごく小さく揺らす
    if (best.node) best.node.rotation.y = best.sign * 0.004;
    // P3a-2: 開かない扉はガチャ音(地下の鉄扉など)
    enemyAudio.play('rattle', new THREE.Vector3((best.collision.minX + best.collision.maxX) / 2, levelY(playerLevel) + 1.0, (best.collision.minZ + best.collision.maxZ) / 2), 0.8);
  }
  return best.roomId;
}
let lastUseLocked = false;
// E を押した(短押しが確定した)時: EV の呼びボタン/カゴの行き先ボタン、それ以外は扉
function useAndReport() {
  const t = hud.target;
  if (t && t.kind === 'ev') {
    const r = elevator.call(playerLevel);
    hud.onUse(null);
    hud.flash(r === 'open' ? HUD_TEXT.ev.opened : HUD_TEXT.ev.called);
    return null;
  }
  if (t && t.kind === 'evbutton') { elevator.select(t.floor); hud.flash(HUD_TEXT.ev.selected(t.floor)); return null; }
  const r = useNearestDoor();
  hud.onUse({ locked: lastUseLocked });
  return r;
}
function nearestOperableDoor(maxD = 1.6) {
  const p = player.object.position;
  let best = null, bd = maxD;
  for (const d of doorsHere()) {
    if (!d.operable || d.kind === 'auto') continue;
    const c = d.collision;
    const dist = Math.hypot((c.minX + c.maxX) / 2 - p.x, (c.minZ + c.maxZ) / 2 - p.z);
    if (dist < bd) { bd = dist; best = d; }
  }
  return best;
}
// 扉 API(AI・デバッグ用)。roomId は全館で一意
const doorApi = {
  get: (id) => world.doorById.get(String(id)) || null,
  isOpen: (id) => { const d = doorApi.get(id); return !!(d && d.collision && d.collision.disabled); },
  open: (id, speed = 1) => { const d = doorApi.get(id); if (d && d.operable && d.kind !== 'auto') { d.target = d.openAngle; d.speedMul = speed; } },
  close: (id, speed = 1) => { const d = doorApi.get(id); if (d && d.operable && d.kind !== 'auto') { d.target = 0; d.speedMul = speed; } },
  setLocked: (id, v) => { const d = doorApi.get(id); if (d) d.locked = !!v; },
};
function updateDoors(dt) {
  world.updateDoors(dt, [
    { level: playerLevel, x: player.pos.x, z: player.pos.z },
    ...(ai && !ai.transit && !TOUR ? [{ level: ai.level, x: enemy.pos.x, z: enemy.pos.z }] : []),
  ]);
  for (const d of doors) if (!d.operable && d.rattle <= 0 && d.node) d.node.rotation.y = 0;
}

// ---------------------------------------------------------------- player
const player = new Player(camera, renderer.domElement, { collisions: world.collisions(playerLevel), floorY: levelY(playerLevel) });
player.onUse = onUseKey;
player.setPose(region.spawn.x, region.spawn.z, region.spawn.yaw, -0.03);

// ---------------------------------------------------------------- enemy (P2b)
// 常夜灯(manifest.lamps)・非常口サイン・窓の位置に「敵だけに効く」弱い光を置く(enemy.js のシェーダ注入)。階ごと
function lampDefsFor(lv) {
  const man = manifests[glbLevel(lv)];
  const y = levelY(lv);
  if (lv === 'RB') return { lamps: [], exitLamps: [], windowLamps: (man.brackets || []).slice(-1) };
  return {
    lamps: man.lamps || [],
    exitLamps: [[6.06 + 0.1, y + 2.15, 21.2], ...(man.exits || [])],     // 外階段の鉄扉の上の非常口サイン＋その他のサイン
    windowLamps: [...(man.windows || []), ...(man.downlights || []).map(([x, z]) => [x, y + 2.3, z])],
  };
}
const enemy = new Enemy(scene, { floorY, collisions, ...lampDefsFor(4) });
await enemy.load();
// 扉の情報(AI の立ち位置): 廊下側の法線とノブの向き(扉板はヒンジ=pos−幅/2 側から伸びるので、ノブは + 側)
const doorInfo = [];
for (const f of building.floors) {
  if (f.level > 7) continue;
  for (const r of f.rooms) {
    if (!r.door) continue;
    const n = FACING_N[r.door.facing];
    const knob = (r.door.facing === 'N' || r.door.facing === 'S') ? [1, 0] : [0, 1];
    doorInfo.push({ roomId: r.id, level: f.level, pos: [...r.door.pos], normal: n, knob });
  }
}
const enemyAudio = new EnemyAudio(camera, enemy);
// 見学モードでは管理人の声(ハミング)を鳴らさない(扉のガチャ音だけ使う)
const resumeAudio = TOUR ? () => { if (enemyAudio.ctx.state !== 'running') enemyAudio.ctx.resume(); } : () => enemyAudio.resume();
window.addEventListener('pointerdown', resumeAudio);
window.addEventListener('keydown', resumeAudio);
const CHECKPOINT = { x: 8.75, z: 7.3, yaw: Math.PI / 2 };   // 410 の入口(室内、扉を向く)
const ENEMY_HOME = { x: 6.9, z: 20.6, yaw: Math.PI };       // 復帰時の管理人(EV ホール、北を向く)
const ai = new EnemyAI({ enemy, audio: enemyAudio, player, world, building, getPlayerLevel: () => playerLevel, doors: doorApi, doorInfo,
  onLevel: (lv) => enemy.setLevel(levelY(lv), world.collisions(lv), lampDefsFor(lv)),
  onKill: () => { movie.hit(); startDeath(); },
  onAttackStart: () => { if (peephole.active) { peephole.forced = false; peephole.set(false); } pendingE = null; movie.start(); },
  // P2d: スコープ演出の入出力(覗いているか／扉が開く瞬間に覗き穴視点を閉じる／レンズ位置)
  isPeeking: () => peephole.active,
  onScopeOpen: () => { peephole.forced = false; peephole.set(false); pendingE = null; },
  getLens: () => lens,
  lensEyeY: 1.48 });
// P2c: 襲撃ムービー(固定カメラ・顔の補助光・血飛沫)。血の合成は最終段(粒子の後)
const movie = new AttackMovie({ camera, player, enemy, scene, audio: enemyAudio });
composer.addPass(movie.pass);
if (TOUR) { ai.setState('SCRIPTED'); enemy.root.removeFromParent(); }
else if (PARAMS.has('noai')) ai.setState('SCRIPTED');
else ai.reset(ENEMY_HOME.x, ENEMY_HOME.z, ENEMY_HOME.yaw);

// ---------------------------------------------------------------- peephole (P2b)
const door410 = world.doorById.get('410');
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
// 4F を解放して読み直したら、室内側のドアスコープを新しい扉板へ付け直す
world.onFloorReady = (lv, rec) => {
  if (lv === 4 && door410.node && (!doorScope || doorScope.parent !== door410.node)) buildDoorScopeInside();
  if (lv === glbLevel(playerLevel)) hud.evPanel = rec.panel;
};

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
let pendingE = null;   // E の長押し判定 {t, held}
function canPeep() {
  const p = player.object.position;
  if (playerLevel !== 4 || door410.angle > 0.03) return false;
  if (!(p.x > 7.86 && p.z > 5.8 && p.z < 8.7)) return false;   // 410 の室内
  const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
  const dx = lens.x - p.x, dz = lens.z - p.z, dist = Math.hypot(dx, dz);
  return dist < 1.2 && (dx * fwd.x + dz * fwd.z) / dist > 0.5;   // P2c: 1.2m 以内で扉に正対(ヒント表示と同じ条件)
}
function onUseKey() {
  if (canPeep()) { pendingE = { t: 0, held: false }; return null; }   // 短押し=扉、長押し=覗き穴(離した時に決まる)
  return useAndReport();
}
player.onKey = (code) => {
  if (code === 'KeyH') hud.showControls();
  if (death) return;
  // カゴの中: 数字キーで行き先(1〜7)
  const dm = /^Digit([1-7])$/.exec(code);
  if (dm && elevator.inCar(player.pos.x, player.pos.z, playerLevel)) { const n = +dm[1]; elevator.select(n); hud.flash(HUD_TEXT.ev.selected(n)); }
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
      if (pendingE.held) peephole.set(false); else useAndReport();
      pendingE = null;
    }
  }
  if (peephole.active && !pendingE && !player.keys.has('KeyP') && !peephole.forced) peephole.set(false);
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  peephole.update(size.x, size.y);
}

// ---------------------------------------------------------------- death / checkpoint (P2b)
const overlay = document.createElement('div');
overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;background:#000;opacity:0;display:flex;align-items:center;justify-content:center;';
const flash = document.createElement('div');
flash.style.cssText = 'position:fixed;inset:0;pointer-events:none;background:#8a0000;opacity:0;mix-blend-mode:normal;';
const caption = document.createElement('div');
caption.innerHTML = `<div>${HUD_TEXT.death.title}</div><div style="margin-top:22px;font:400 13px/1 -apple-system,'Hiragino Sans',sans-serif;letter-spacing:.25em;color:#7d776f">${HUD_TEXT.death.sub}</div>`;
caption.style.cssText = 'color:#b9b2a8;font:500 22px/1 "Hiragino Mincho ProN","Yu Mincho",serif;letter-spacing:.5em;opacity:0;transition:none;text-align:center;';
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
    if (playerLevel !== 4) setPlayerLevel(4);
    player.setPose(CHECKPOINT.x, CHECKPOINT.z, CHECKPOINT.yaw, 0);
    player.frozen = false;
    ai.reset(ENEMY_HOME.x, ENEMY_HOME.z, ENEMY_HOME.yaw);
    deathCount++;
  }
  if (t >= respawnAt + DEATH.fadeIn) { death = null; overlay.style.opacity = '0'; flash.style.opacity = '0'; caption.style.opacity = '0'; }
}
let deathCount = 0;
renderer.domElement.addEventListener('click', () => { if (!player.isLocked()) player.lock(); });
// P2e: 画面ガイド
const hud = new Hud({
  camera, player, doors: doorsHere(), lens, evPanel: world.floors.get(4).panel, canPeep, inRoom410: () => playerLevel === 4 && player.pos.x > 7.86 && player.pos.z > 5.8 && player.pos.z < 8.7,
  extraTarget: () => extraTarget(),
  peepKey: () => (peephole.active ? (pendingE && pendingE.held ? 'E' : player.keys.has('KeyP') ? 'P' : 'E') : null),
  isMovie: () => movie.active, isDead: () => !!death,
});
player.controls.addEventListener('lock', () => { document.body.classList.add('locked'); hud.setPointer(true); });
player.controls.addEventListener('unlock', () => { document.body.classList.remove('locked'); hud.setPointer(false); });
resize();

// ---------------------------------------------------------------- 階の移動(P3a)
// 階を移る: 当たり・床の高さ・読み込み(±1)・画面ガイドの対象を差し替える。dy を渡すと足元の位置を保ったまま上下へ
function setPlayerLevel(key, { dy = null } = {}) {
  const prev = playerLevel;
  playerLevel = key;
  player.setWorld({ collisions: world.collisions(key), floorY: levelY(key) });
  if (dy !== null) player.placeAt(player.pos.x, levelY(key), player.pos.z);
  world.focus(key);
  hud.doors = doorsHere();
  const rec = world.floors.get(glbLevel(key));
  hud.evPanel = rec && rec.panel ? rec.panel : null;
  levelLog.push({ from: prev, to: key, t: +simTime.toFixed(2) });
  updateVisibility();
}
const levelLog = [];
const elevator = new Elevator({ building, world, player, camera, listener: enemyAudio.listener, getLevel: () => playerLevel,
  setLevel: (key, o) => setPlayerLevel(key, o) });
elevator.onRideStart = (to) => world.focus(to);     // 行き先(±1)を先に読み始める(到着は読み終わってから)
ai.elevator = elevator;                              // P3b-A: 管理人も同じカゴで移動する(階数表示が動く)
elevator.attach(scene);
const stairs = new Stairs({ building, player, camera, getLevel: () => playerLevel,
  onStart: (from, to) => { world.focus(to); updateVisibility(); },
  onArrive: (to) => { setPlayerLevel(to); } });
// 見せる階: ふだんは今の階だけ。外階段・北階段の区画にいる時と上り下りの最中は上下の階も(吹き抜けで見えるので)
function updateVisibility() {
  const c = glbLevel(playerLevel);
  const open = stairs.busy || !!stairs.inStairArea(player.pos.x, player.pos.z);
  world.setVisible(open ? [c - 1, c, c + 1] : [c]);
}
// 画面ガイドの追加対象: カゴの行き先ボタン/階段の口
function extraTarget() {
  const b = elevator.buttonAt(camera, playerLevel);
  if (b) return { kind: 'evbutton', floor: b.floor, items: [HUD_TEXT.ev.button(b.floor)] };
  if (elevator.facingPanel(camera, playerLevel)) return { kind: 'evpanel', items: [HUD_TEXT.ev.panel] };
  const m = stairs.hint;
  if (m && !stairs.busy) return { kind: 'stair', items: [m.toKey === 'RB' ? HUD_TEXT.stair.roof : m.toKey === 'B1' ? HUD_TEXT.stair.basement : m.dir === 'up' ? HUD_TEXT.stair.up : HUD_TEXT.stair.down] };
  return null;
}

// ---------------------------------------------------------------- 地下への階段の湿った音(P3a-2・仮音: WebAudio 合成の水滴＋残響)
// 地下への階段の区画(1F の踊り場)では遠く小さく、B1 では近く。録音素材は P4 で差し替え
const DRIP = { t: 2.0, bus: null, count: 0 };
function updateDrips(dt) {
  const bs = building.stairs.find((s) => s.id === 'basement');
  const [x0, z0, w, d] = bs.pos.concat(bs.size);
  const p = player.pos;
  const near = playerLevel === 'B1' || (playerLevel === 1 && p.x > x0 - 1.5 && p.x < x0 + w && p.z > z0 - 0.5 && p.z < z0 + d + 1.5);
  if (!near) { DRIP.t = Math.min(DRIP.t, 1.0); return; }
  DRIP.t -= dt;
  if (DRIP.t > 0) return;
  DRIP.t = 1.4 + Math.random() * 3.2;
  const ctx = enemyAudio.ctx;
  if (ctx.state !== 'running') return;
  if (!DRIP.bus) {
    const dry = ctx.createGain(); dry.gain.value = 1;
    const delay = ctx.createDelay(1.0); delay.delayTime.value = 0.23;
    const fb = ctx.createGain(); fb.gain.value = 0.42;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
    dry.connect(ctx.destination); dry.connect(delay); delay.connect(lp); lp.connect(fb); fb.connect(delay); lp.connect(ctx.destination);
    DRIP.bus = dry;
  }
  const now = ctx.currentTime, vol = playerLevel === 'B1' ? 0.2 : 0.06;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.setValueAtTime(1300 + Math.random() * 700, now);
  o.frequency.exponentialRampToValueAtTime(420, now + 0.08);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(vol, now + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
  o.connect(g); g.connect(DRIP.bus); o.start(now); o.stop(now + 0.16);
  DRIP.count++;
}

// ---------------------------------------------------------------- loop
const frameTimes = []; // [timestamp, frameMs, cpuMs]
let last = performance.now();
let simTime = 0;
function step(dt) {
  simTime += dt;
  player.update(dt);
  stairs.update(dt);
  updatePeepInput(dt);
  camera.updateMatrixWorld();
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  if (!TOUR) {
    ai.update(dt);
    enemy.update(dt, camera);
    movie.update(dt);
  }
  updateDoors(dt);
  elevator.update(dt);
  enemy.root.visible = !TOUR && ai.level === playerLevel && !ai.transit;
  updateVisibility();
  if (!TOUR) enemyAudio.update(dt);
  updateDrips(dt);
  updateDeath(dt);
  hud.update(dt);
  grainPass.uniforms.time.value = simTime;
}
const _bufSize = new THREE.Vector2();
function render() {
  // 覗き穴の円形マスクは描画バッファの縦横比で決まる(スクリーンショット等で解像度を変えても楕円にならないよう毎回合わせる)
  renderer.getDrawingBufferSize(_bufSize);
  peephole.pass.uniforms.aspect.value = _bufSize.x / _bufSize.y;
  renderer.info.reset(); composer.render();
}
function frame(now) {
  const dt = (now - last) / 1000; last = now;
  const t0 = performance.now();
  if (!window.__n2 || !window.__n2.paused) step(Math.min(dt, 0.1));   // paused: 監査スクリプトが pump で進める間、本物のループを止める
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
  THREE, scene, camera, renderer, player, composer, doors, manifest, manifests, LOOK, building, world, elevator, stairs,
  get collisions() { return world.collisions(playerLevel); },   // プレイヤーの今の階の当たり(P0 のテストは 4F)
  get level() { return playerLevel; },
  levelLog,
  setLevel(key) { setPlayerLevel(key); return world.focus(key); },
  // 階・位置へ直接移る(テスト・スクショ用)。読み込み完了の Promise を返す
  teleport(key, x, z, yaw = 0, pitch = 0) { setPlayerLevel(key); player.setPose(x, z, yaw, pitch); updateVisibility(); return world.focus(key); },
  enemyObj: enemy, ai, enemyAudio, peepholeObj: peephole, doorApi, lens, CHECKPOINT, ENEMY_HOME,
  movie, ambientFloor, get doorScope() { return doorScope; }, hud, hudState: () => hud.state(),
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
  setLightmapGain(g) { seenMats.forEach((m) => { m.lightMapIntensity = manifest.lightmap.intensity * g; }); },
};
window.__n2.tour = TOUR;
window.__N2 = window.__n2;
// 見学モード: 小さな表示と開始階(EV ホール前。屋上B・地下はその階の出入口の前)
if (TOUR) {
  const tag = document.createElement('div');
  tag.id = 'tourTag';
  tag.textContent = '見学モード';
  tag.style.cssText = 'position:fixed;right:12px;top:10px;z-index:8;pointer-events:none;color:#b9b2a8;opacity:.55;font:500 11px/1 -apple-system,"Hiragino Sans",sans-serif;letter-spacing:.2em;';
  document.body.appendChild(tag);
  const fl = PARAMS.get('floor');
  if (fl) {
    const key = fl === 'RB' || fl === 'B1' ? fl : Math.min(7, Math.max(1, parseInt(fl, 10) || 4));
    if (key === 'RB') await window.__n2.teleport('RB', ...building.roofB.spawn, -Math.PI / 2);
    else if (key === 'B1') await window.__n2.teleport('B1', ...building.basement.spawn, Math.PI / 2);
    else await window.__n2.teleport(key, 6.9, 20.7, Math.PI);   // EV ホール前で EV を向く
  }
}
if (PARAMS.get('test') === 'enemy') import('../tools/test_enemy.js').then((m) => m.run(window.__N2)).catch(showErr);
if (PARAMS.get('test') === 'building') import('../tools/test_building.js').then((m) => m.run(window.__N2)).catch(showErr);
