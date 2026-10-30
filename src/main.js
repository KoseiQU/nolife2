// main.js — P0 縦切り: Blender でベイクした 4F 廊下(build/p0.glb + ライトマップ)を歩く。
// 見た目は GLB、当たりは building.json(walls.js)+ src/p0_region.json の塞ぎ。
// 光: ベイク済みライトマップ(常夜灯・非常口・窓のGI)+ リアルタイムは懐中電灯(SpotLight+影)だけ。
// ポスト: GTAO(弱) → bloom(ごく弱・閾値高) → OutputPass(ACES+sRGB) → 粒子+ビネット。

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
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

// 見た目の調整値(目視で決める。DESIGN §3.2「やり過ぎない」)
export const LOOK = {
  exposure: 4.5,        // ACES 前の露出
  lightmapGain: 1.0,    // ライトマップ強度への追加倍率(1 = Cycles と同じ物理量)
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
  emissiveScale: { M_Window: 0.15, M_LampCover: 1.0, M_ExitSign: 1.0, M_Button: 1.0 },
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
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.info.autoReset = false;   // composer の全パス合計を1フレーム分として数える(render() 冒頭でリセット)
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.FogExp2(LOOK.fogColor, LOOK.fogDensity);
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
  const isDoor = (o) => { for (let p = o; p; p = p.parent) if (p.userData && p.userData.n2_kind === 'door') return true; return false; };
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
  if (best.operable) best.target = best.target > 0 ? 0 : best.openAngle;
  else best.rattle = 0.25;   // 施錠: ノブだけ鳴る(音は後フェーズ)。ごく小さく揺らす
  return best.roomId;
}
function updateDoors(dt) {
  for (const d of doors) {
    if (d.operable) {
      const delta = d.target - d.angle;
      if (Math.abs(delta) > 1e-4) {
        // 開け始めは重く、途中で滑らかに(ドアクローザー感)
        const k = 0.35 + 0.65 * Math.min(1, Math.abs(d.angle) / 0.4);
        d.angle += Math.sign(delta) * Math.min(Math.abs(delta), DOOR_SPEED * k * dt);
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
player.onUse = useNearestDoor;
player.setPose(region.spawn.x, region.spawn.z, region.spawn.yaw, -0.03);
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
  updateDoors(dt);
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
