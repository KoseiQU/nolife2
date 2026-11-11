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
import { World, levelY, glbLevel, FACING_N, LEVELS, isSpace } from './world.js';
import { Stairs, arrival as stairsArrival } from './stairs.js';
import { Elevator, EV } from './elevator.js';
import { Enemy } from './enemy.js';
import { EnemyAI, hideOddsFrom } from './enemy_ai.js';
import { EnemyAudio } from './enemy_audio.js';
import { AudioBank } from './audio_bank.js';
import { Peephole, PEEP } from './peephole.js';
import { AttackMovie } from './attack_movie.js';
import { Hud } from './hud.js';
import { Rooms } from './rooms.js';
import { HUD_TEXT } from './hud_text.js';
import { storyDecor, setLiveDrip } from './story_doors.js';
import { Exterior, EXT_U } from './exterior.js';
import { DoorFx } from './door_fx.js';
import { ViewLock } from './view_lock.js';
import { Watcher } from './watcher.js';
import { Tutorial } from './tutorial.js';
import { Title } from './title.js';
import { HUD } from './hud.js';
import { Story } from './story.js';
import { Spaces } from './spaces.js';
import { Power } from './power.js';

const PARAMS = new URLSearchParams(location.search);
// 見学モード(?tour): 建物だけを見て回る。管理人を出さない(scene から外す・AI と声/足音を止める)、死亡・襲撃ムービーなし。
// P3b-3: 扉は通常プレイと同じ(内装のある部屋だけ開く。空室・物語の部屋・地下の鉄扉は開かない)。?tour&floor=N(1〜7・RB・B1)で開始階を指定
const TOUR = PARAMS.has('tour');
// P3b: 物語の進行で解放するフラグ(P5 で条件を決める)。roofA = 410 のバルコニーから屋上A へ乗り越えられる(P3b-3: 401 からは不可)。?tour と ?roofA では最初から真
// P3c-2: entranceOut = 正面玄関の外側の自動ドアが動く(2026-11-01 ユーザー指示: 最初は開かない)。?tour と ?entranceOut では最初から真
const FLAGS = { roofA: TOUR || PARAMS.has('roofA'), entranceOut: TOUR || PARAMS.has('entranceOut') };
// P5b-1: 物語(story.js)のモード。通常プレイと ?test=story = 'play'(段・目標・鍵・221/6F の罠・最終追跡・エンディング)、?tour = 'tour'(全部解放・別空間に入れる)、
//  他のテスト(?test=enemy/rooms/building)= 'off'(物語の扉は施錠のまま、それ以外は P5a までと同じ)
const STORY_MODE = TOUR ? 'tour' : (!PARAMS.has('test') || PARAMS.get('test') === 'story' || PARAMS.get('test') === 'spaces' || PARAMS.get('test') === 'x105' || PARAMS.get('test') === 'xb1' || PARAMS.get('test') === 'audio' || PARAMS.get('test') === 'tutorial') ? 'play' : 'off';   // P5b-2a: ?test=spaces も 'play'。P4b: ?test=audio も

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
  emissiveScale: { MX_WinOut: 0.15, MX_SecMon: 0.5, M_Window: 0.15, M_LampCover: 1.0, M_ExitSign: 1.0, M_Button: 1.0, M_CarCeiling: 0.0,  // カゴ照明=待機中は消灯
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
  // P3b: 仮の夜空(外観 build/exterior.glb が読めるまでの間だけ。読めたら ext_sky に差し替え)。露出 4.5 で見るので、ごく暗い色
  skyTop: '#010103', skyHorizon: '#06080e', skyGround: '#020203',
  mirrorEnv: 0.012,
  // P3c-2: 廊下端の窓のガラス(外が見える 1 枚の面)。夜の暗いガラス: ほぼ透明・わずかな青緑・映り込みは弱く(glass_smudge の粗さ)
  corrGlass: { color: [0.10, 0.125, 0.125], opacity: 0.12, roughness: 0.06, env: 0.16 },
  // P3c: 外観・外環境(src/exterior.js)。値は線形(露出 4.5 の前)。月明かりと空の明るさは外観・外環境の材質だけに効く
  ext: {
    far: 3000,                         // カメラの遠クリップ(遠景の山並みは 2400m)
    moon: [0.060, 0.066, 0.085],       // 月(南西・曇り越し)の照度
    sky: [0.048, 0.056, 0.072],        // 空(上向きの面)
    ground: [0.004, 0.0037, 0.0034],   // 照り返し(下向きの面)
    fogColor: [0.0024, 0.0027, 0.0035],// 外の霧の色(夜の森の霞。空の地平線より少し暗い)
    fogDensity: 0.0021,                // 外の霧(FogExp2 と同じ式。500m で 6 割)
    skyGain: 1.0,                      // 空の明るさの倍率
    treeLight: [0.045, 0.052, 0.062],  // 中景の木(板)の明るさ
    ridgeBase: [0.0012, 0.0014, 0.0018],
    cityGlow: [0.0014, 0.0009, 0.0004],
    cityGain: 2.8, cityBody: [0.0010, 0.0011, 0.0014],
    winGlow: [1.0, 0.72, 0.45], winGlowGain: 0.9,   // カーテン越しの灯り
    lobbyGlow: 1.1, lampGlow: 3.0,
    // P3c-2: 階の GLB が出ていない時の廊下端の窓の奥(外観の帯の、開口の奥 1.8m の廊下の箱)。壁・床 / 天井・突き当たり
    corrDepth: [0.008, 0.009, 0.010], corrDepthLit: [0.024, 0.026, 0.029], corrLamp: 0.3,   // corrLamp = 奥の常夜灯のカバーの明るさ(本物の M_LampCover 比)
    corrWinDist: 10.0,                 // 廊下端の窓からこの距離まで(同じ階・窓の室内側で窓が視野にある時)は外を描く
    poolPole: [0.05, 0.038, 0.024], poolPorch: [0.05, 0.04, 0.028], poolPilotis: [0.03, 0.024, 0.016],
    windowCull: 4.0,                   // 入れる部屋の扉からこの距離までは、開いた扉越しに窓が見えるかもしれないので外を描く
    gtaoDivOutdoor: 3,                 // 屋外の GTAO の解像度(1/3。屋内は 1/2)
    glassOutdoorOpacity: 0.22,         // 敷地にいる間の風除室のガラス(透過の再描画をやめ、半透明にする)
  },
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
// P3b: 夜空の仮の背景(地平線がわずかに明るい濃紺のグラデーション)。窓・バルコニー・屋上から見える空が真っ黒の穴にならないように。
// 本番の空(曇った夜空・月・遠景)は P3c で差し替える
{
  const cv = document.createElement('canvas'); cv.width = 4; cv.height = 256;
  const g = cv.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0.0, LOOK.skyTop); gr.addColorStop(0.47, LOOK.skyHorizon); gr.addColorStop(0.53, LOOK.skyHorizon); gr.addColorStop(1.0, LOOK.skyGround);
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(cv);
  t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace;
  scene.background = t;
}
scene.fog = new THREE.FogExp2(LOOK.fogColor, LOOK.fogDensity);
const ambientFloor = new THREE.HemisphereLight(LOOK.ambientSky, LOOK.ambientGround, LOOK.ambientFloor);
scene.add(ambientFloor);
const camera = new THREE.PerspectiveCamera(68, 16 / 9, 0.05, LOOK.ext.far);   // P3c: 遠景(山並み・街)まで
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
let gtaoDiv = 2;   // P3c: 屋外では 1/3 解像度(updateOutdoorQuality)
gtao.setSize = (w, h) => gtaoSetSize(Math.max(1, Math.round(w / gtaoDiv)), Math.max(1, Math.round(h / gtaoDiv)));
composer.addPass(gtao);
// P3c: GTAO の法線パスから遠景・中景の木(アルファの板)を外す(四角く AO が乗るため。遠くの AO は見えないので省いて軽くする)
{
  const gtaoRender = gtao.render.bind(gtao);
  gtao.render = (...a) => {
    const ex = exterior && exterior.ready && exterior.shown;
    if (ex) exterior.gtaoBegin();
    gtaoRender(...a);
    if (ex) exterior.gtaoEnd();
  };
}
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
{ const d = world.doorById.get('ENTRANCE_OUT'); if (d) d.locked = !FLAGS.entranceOut; }   // P3c-2: 最初は外側の自動ドアは反応しない(解放は P5。デバッグ: doorApi.setLocked('ENTRANCE_OUT', false))
// P3c: 外観・外環境(建物の後に読む。?noext で読まない)
const exterior = new Exterior({ scene, renderer, camera, world, look: LOOK, envTex });
let rooms = null;   // P3b: 入れる部屋の仕掛け(下で作る)
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
  lastUseLocked = false; lastUseAutoLocked = false;
  if (!best) return null;
  if (best.kind === 'auto') {                                       // 自動ドアは近づけば開く
    if (best.locked && best.open01 === 0) lastUseAutoLocked = true;   // P3c-2: 施錠中の自動ドアで E → 「反応しない」(1 秒)
    return best.roomId;
  }
  if (best.operable && !(best.locked && best.target === 0)) {
    best.target = best.target > 0 ? 0 : best.openAngle;
    best.speedMul = 1;
    if (ai) ai.noise((best.collision.minX + best.collision.maxX) / 2, (best.collision.minZ + best.collision.maxZ) / 2, 9.0);   // 扉の開閉音(聴覚 9m)
  } else if (best.chained && story) {   // P6b-C(§3.10 #3): 鎖のかかった鉄扉(ふだんは story の画面ガイドが先に拾う。ここは視線の判定の境目の保険)
    story.rattleChain(best.roomId);
  } else {
    best.rattle = 0.25; lastUseLocked = true;   // 開かない扉: ノブだけ鳴る。ごく小さく揺らす(扉板の姿勢は world._poseLeaf)
    // P3a-2: 開かない扉はガチャ音(地下の鉄扉など)
    enemyAudio.play('rattle', new THREE.Vector3((best.collision.minX + best.collision.maxX) / 2, levelY(playerLevel) + 1.0, (best.collision.minZ + best.collision.maxZ) / 2), 0.8);
  }
  return best.roomId;
}
let lastUseLocked = false, lastUseAutoLocked = false;
// E を押した(短押しが確定した)時: EV の呼びボタン/カゴの行き先ボタン、それ以外は扉
function useAndReport() {
  const t = hud.target;
  if (t && t.kind === 'story') { story.use(t); return null; }   // P5b-1: 拾う・鍵を使う・調べる・戻る・乗る
  if (t && (t.kind === 'ev' || t.kind === 'evbutton') && story && story.evDisabled) { hud.flash(HUD_TEXT.ev.noResponse); return null; }   // P5b-1: 第9段から EV は反応しない
  if (t && t.kind === 'ev') {
    const r = elevator.call(playerLevel);
    if (r === 'called' && !TOUR) ai.evGambleCheck(playerLevel);   // P5a: EV の賭け(管理人が降りた直後に呼ぶと、中にいる)
    hud.onUse(null);
    hud.flash(r === 'open' ? HUD_TEXT.ev.opened : HUD_TEXT.ev.called);
    return null;
  }
  if (t && t.kind === 'evbutton') { elevator.select(t.floor); hud.flash(HUD_TEXT.ev.selected(t.floor)); return null; }
  if (t && t.rt) {   // P3b: 窓・隠れ場所・屋上A の隔て板
    const r = rooms.use(t.rt);
    if (r === 'blocked') hud.flash(HUD_TEXT.room.cantClimb);
    if (r === 'window') ai.noise(player.pos.x, player.pos.z, 4.0);   // 窓を開け閉めする音(扉より小さい)
    return null;
  }
  const r = useNearestDoor();
  hud.onUse({ locked: lastUseLocked });
  if (lastUseAutoLocked) hud.flash(HUD_TEXT.door.autoLocked);
  return r;
}
// 扉 API(AI・デバッグ用)。roomId は全館で一意
const doorApi = {
  get: (id) => world.doorById.get(String(id)) || null,
  isOpen: (id) => { const d = doorApi.get(id); return !!(d && d.collision && d.collision.disabled); },
  open: (id, speed = 1) => { const d = doorApi.get(id); if (d && d.operable && d.kind !== 'auto' && !d.chained) { d.target = d.openAngle; d.speedMul = speed; } },   // P6b-C: 鎖の扉は開かない
  close: (id, speed = 1) => { const d = doorApi.get(id); if (d && d.operable && d.kind !== 'auto') { d.target = 0; d.speedMul = speed; } },
  setLocked: (id, v) => { const d = doorApi.get(id); if (d) d.locked = !!v; },
  // P5a: 空室(管理人が潜む施錠された部屋)の扉。プレイヤーは開けられないが、管理人は普通に開けて出入りし、飛び出す時は壊す
  npcOpen: (id, angle = 1.15, speed = 1) => { const d = doorApi.get(id); if (d && d.lurkable && !d.broken) { if (doorFx) doorFx.prepare(id); d.target = angle; d.speedMul = speed; } },
  npcClose: (id, speed = 1) => { const d = doorApi.get(id); if (d && d.lurkable && !d.broken) { d.target = 0; d.speedMul = speed; } },
  breakDoor: (id) => world.breakDoor(id),
  repairDoor: (id) => world.repairDoor(id),
};
let doorFx = null;   // P5a(下で作る)
let story = null, spaces = null;   // P5b-1(下で作る)
function updateDoors(dt) {
  world.updateDoors(dt, [
    { level: playerLevel, x: player.pos.x, z: player.pos.z },
    ...(ai && !ai.transit && !TOUR ? [{ level: ai.level, x: enemy.pos.x, z: enemy.pos.z }] : []),
  ]);
  world.updateDecor(dt, playerLevel, player.pos.x, player.pos.z);
}

// ---------------------------------------------------------------- player
// P5b-3: 床の嵩上げ(シアターの段床 room.tiers)。その階の (x, z) の床からの高さ。段床の無い階は null
const TIERS = new Map();
for (const f of building.floors) for (const r of f.rooms) for (const t of r.tiers || []) {
  if (!TIERS.has(f.level)) TIERS.set(f.level, []);
  TIERS.get(f.level).push(t);
}
function liftAt(key, x, z) {
  const ts = TIERS.get(key);
  let h = 0;
  if (ts) for (const t of ts) { const [tx, tz, tw, td] = t.rect; if (x > tx && x < tx + tw && z > tz && z < tz + td && t.h > h) h = t.h; }
  return h;
}
let enemyLift = 0;
function floorAtFor(key) { return TIERS.has(key) ? (x, z) => liftAt(key, x, z) : null; }
const player = new Player(camera, renderer.domElement, { collisions: world.collisions(playerLevel), floorY: levelY(playerLevel), floorAt: floorAtFor(playerLevel) });
player.onUse = onUseKey;
player.setPose(region.spawn.x, region.spawn.z, region.spawn.yaw, -0.03);

// ---------------------------------------------------------------- enemy (P2b)
// 常夜灯(manifest.lamps)・非常口サイン・窓の位置に「敵だけに効く」弱い光を置く(enemy.js のシェーダ注入)。階ごと
function lampDefsFor(lv) {
  if (isSpace(lv)) return { lamps: [], exitLamps: [], windowLamps: spaces ? spaces.lampsFor(lv) : [] };   // P5b-1: 別空間(裸電球)
  if (lv === 'G') return { lamps: [], exitLamps: [], windowLamps: building.site.poles.map(([x, z]) => [x, 3.4, z]) };   // P5b-1: 敷地(照明柱)
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
// P4b: 採用した音(assets/audio の wav と声)の共通の再生器。管理人の音・EV・部屋・物語・別空間はこれで鳴らす(読み込み中・失敗しても遊べる)
const bank = new AudioBank({ listener: enemyAudio.listener });
enemyAudio.bank = bank;
const bankLoad = bank.load();
// AudioContext はユーザー操作で起こす(P4a: 常時ループの鼻歌を削除したので見学モードとの差は無くなった)
const resumeAudio = () => enemyAudio.resume();
window.addEventListener('pointerdown', resumeAudio);
window.addEventListener('keydown', resumeAudio);
const CHECKPOINT = { x: 8.75, z: 7.3, yaw: Math.PI / 2 };   // 410 の入口(室内、扉を向く)
const ENEMY_HOME = { x: 6.9, z: 20.6, yaw: Math.PI };       // 復帰時の管理人(EV ホール、北を向く)
// P5b-6: 逃げ込みの確率(DESIGN §3.4.1)。?pEnter=0.7&pCloset=0.5 で起動時に上書き(既定は enemy_ai.js の HIDE_ODDS)
const HIDE_ODDS_START = hideOddsFrom(PARAMS);
const ai = new EnemyAI({ enemy, audio: enemyAudio, player, world, building, getPlayerLevel: () => playerLevel, doors: doorApi, doorInfo,
  hideOdds: HIDE_ODDS_START,
  onLevel: (lv) => enemy.setLevel(levelY(lv), world.collisions(lv), lampDefsFor(lv)),
  onKill: () => { movie.hit(); startDeath(); },
  onAttackStart: () => { if (peephole.active) { peephole.forced = false; peephole.set(false); } pendingE = null; viewLock.handoff(); movie.start(); },
  // P5b-1b: 空振り(段の途中など)→ 襲撃ムービーを畳む。入力は他に止める理由が無ければ返す
  onAttackMiss: () => { if (death) return; movie.end({ restore: true }); player.frozen = inputHeld(); },
  // P5a: 管理人がプレイヤーの階に着いた(EV で降りた)時に一度だけ「同じ階で…」(DESIGN §3.8 C)。着くたびに新しい滞在
  onArrive: (lv) => { if (!TOUR && lv === playerLevel) hud.notice(HUD_TEXT.sameFloor, 3.0); },
  // P2d: スコープ演出の入出力(覗いているか／扉が開く瞬間に覗き穴視点を閉じる／レンズ位置)
  isPeeking: () => peephole.active,
  onScopeOpen: () => { peephole.forced = false; peephole.set(false); pendingE = null; },
  getLens: (rid) => lensFor(rid || '410'),   // P6b-A(§3.9 #1): 部屋ごとのレンズ(覗き返しで顔を寄せる先)
  lensEyeY: 1.48 });
// P2c: 襲撃ムービー(固定カメラ・顔の補助光・血飛沫)。血の合成は最終段(粒子の後)
const movie = new AttackMovie({ camera, player, enemy, scene, audio: enemyAudio });
composer.addPass(movie.pass);
// P5a: 視点を管理人へ向ける短いムービー(潜伏室からの飛び出し・EV の賭け)
const viewLock = new ViewLock({ camera, player, holdFrozen: () => inputHeld() });
ai.onViewLock = (o) => viewLock.start((out) => enemy.headWorld(out).add(new THREE.Vector3(0, 0.02, 0)), o);
// P5a: 空室の扉まわり(扉の下の隙間・奥の闇の箱・壊れた扉の破片)
doorFx = new DoorFx({ scene, world, building, audio: enemyAudio });
// P5a: 窓越しの管理人(見えるだけの演出体。本体が別の階にいる時、静かな時間帯に)。テストでは自動では出さない(N.watcher.enabled / force)
const watcher = new Watcher({ scene, camera, enemy, world, building, ai, getLevel: () => playerLevel,
  isBusy: () => movie.active || viewLock.active || !!death, enabled: !TOUR && !PARAMS.has('test') && !PARAMS.has('noai') });
// P6b-F1(§3.12 #4): 停電の時計(階に依存しない 1 つ)と灯りの一斉制御(src/power.js)。通常プレイだけ自動で起こす(?test・?tour では起こさない)。
//  ?blackout=now(3 秒後)/?blackout=<秒>・?flicker=now|<秒> で最初の 1 回を早める、?power=off で止める
const POWER_ON = !TOUR && PARAMS.get('power') !== 'off' && (!PARAMS.has('test') || PARAMS.has('blackout') || PARAMS.has('flicker'));
const power = new Power({ world, exterior, enemy, ai, player, ambient: ambientFloor, ambientBase: LOOK.ambientFloor, getLevel: () => playerLevel, enabled: POWER_ON,
  // 起こさない(新しく始めない): 異空間・地下・死亡演出中。進行中の停電も打ち切る: タイトル・チュートリアル・エンディング
  excluded: () => (isSpace(playerLevel) ? 'space' : playerLevel === 'B1' ? 'b1' : death ? 'death' : null),
  hard: () => ((title && title.active) ? 'title' : (tutorial && tutorial.active) ? 'tutorial' : (story && story.ending) ? 'ending' : null) });
{
  const at = (v) => (v === 'now' || v === '' ? 3 : Math.max(0, parseFloat(v) || 3));
  if (PARAMS.has('blackout')) power.nextBlackout = at(PARAMS.get('blackout'));
  if (PARAMS.has('flicker')) power.nextFlicker = at(PARAMS.get('flicker'));
}
world.onDoorBroken = (d) => doorFx.onBroken(d);
world.onDoorRepaired = (d) => doorFx.onRepaired(d);
if (TOUR) { ai.setState('SCRIPTED'); enemy.root.removeFromParent(); }
else if (PARAMS.has('noai')) ai.setState('SCRIPTED');
else ai.reset(ENEMY_HOME.x, ENEMY_HOME.z, ENEMY_HOME.yaw);
ai.home = ENEMY_HOME;   // P6b-H: 復帰時に管理人を移す先の EV ホールの立ち位置

// ---------------------------------------------------------------- peephole (P2b → P6b-A §3.9 #1: 覗き穴のある居室すべて)
const door410 = world.doorById.get('410');
// P6b-A: 覗き穴のある居室(内装のある 1K。食堂・シアター・管理室・別空間 105/312/705/B1 は除く)。レンズは扉の位置・向きから:
//  扉板の廊下側の面(扉の中心・床から 1.48m)の 1.5cm 外、廊下を向く。扉板が読めていない(別の階)・開いている時は当たりの箱の廊下側の面
const PEEP_ROOMS = new Map();
for (const f of building.floors) {
  if (f.level > 7) continue;
  for (const r of f.rooms) {
    if (!(r.kind === 'unit' && r.door && r.door.enterable && r.interior)) continue;
    PEEP_ROOMS.set(r.id, { id: r.id, level: f.level, n: FACING_N[r.door.facing], pos: r.door.pos, door: world.doorById.get(r.id) });
  }
}
const _lensCache = new Map();
const _lensRc = new THREE.Raycaster();
function lensFor(rid) {
  const R = PEEP_ROOMS.get(String(rid));
  if (!R || !R.door || !R.door.collision) return null;
  if (_lensCache.has(R.id)) return _lensCache.get(R.id);
  const d = R.door, c = d.collision, [nx, nz] = R.n;
  const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2, y = levelY(R.level) + PEEP.eyeY;
  let hit = null;
  if (d.node && d.angle < 0.005) {
    d.node.updateMatrixWorld(true);
    _lensRc.set(new THREE.Vector3(cx + nx * 0.4, y, cz + nz * 0.4), new THREE.Vector3(-nx, 0, -nz));
    _lensRc.far = 1;
    hit = _lensRc.intersectObject(d.node, true)[0] || null;
  }
  const fx = hit ? hit.point.x : nx > 0 ? c.maxX : nx < 0 ? c.minX : cx;
  const fz = hit ? hit.point.z : nz > 0 ? c.maxZ : nz < 0 ? c.minZ : cz;
  const L = { x: nx !== 0 ? fx + nx * 0.015 : cx, z: nz !== 0 ? fz + nz * 0.015 : cz, yaw: Math.atan2(-nx, -nz), room: R.id, level: R.level, floorY: levelY(R.level) };
  if (hit) _lensCache.set(R.id, L);   // 扉板で測れた時だけ覚える(GLB を読み直しても扉の位置は同じ)
  return L;
}
// プレイヤーが今いる覗き穴のある部屋(バルコニーは除く = 部屋の矩形の内)
function peepRoomHere() {
  if (typeof playerLevel !== 'number') return null;
  const p = player.pos;
  for (const R of PEEP_ROOMS.values()) {
    if (R.level !== playerLevel) continue;
    const r = world.roomById.get(R.id).room, [rx, rz, rw, rd] = r.rect;
    if (p.x > rx && p.x < rx + rw && p.z > rz && p.z < rz + rd) return R.id;
  }
  return null;
}
const lens = lensFor('410');   // 410(チュートリアル場面 4 と P2 のテストの基準)
const peephole = new Peephole({ camera, player, floorY, lens });
composer.insertPass(peephole.pass, composer.passes.indexOf(grainPass));
// 覗く部屋のレンズへ差し替える(覗いていない時は 410 に戻す = チュートリアルの強制の覗き穴は 410)
function setPeepLens(rid) {
  const L = (rid && lensFor(rid)) || lens;
  peephole.setLens(L, L.floorY);
}
let doorScope = null;
let doorScopeDoor = null;
let doorScopeLensMat = null;
buildDoorScopeInside(door410);
// 階を読み直したら、室内側のドアスコープを今いる部屋(無ければ 410)の新しい扉板へ付け直す
world.onFloorReady = (lv, rec) => {
  updateDoorScope();
  if (lv === glbLevel(playerLevel)) hud.evPanel = rec.panel;
};
// P6b-A: 室内側のドアスコープは 1 組だけ持ち、プレイヤーが入った覗き穴のある部屋の扉板へ付け替える(廊下からは扉板の裏で見えない = 全室に置く必要がない)
function updateDoorScope() {
  const rid = peepRoomHere();
  const d = (rid && PEEP_ROOMS.get(rid).door) || door410;
  if (!d || !d.node) return;
  if (doorScope && doorScope.parent === d.node && doorScopeDoor === d) return;
  if (d.angle > 0.005) return;   // 閉じた姿勢で測って付ける(開いている間は次の機会に)
  buildDoorScopeInside(d);
}

// P2c: ドアスコープを室内側から見えるように(§3.4.1)。扉板の内面・目の高さに真鍮のリングとレンズ。
// 扉板(d.node)の子にするので扉と一緒に回る。レンズには廊下側の光の点(小さな発光)と環境反射。
// P6b-A: 扉の向き(facing)に合わせて回す(410 = 西向きの扉で回転 0)
function buildDoorScopeInside(d) {
  if (!d || !d.node || !d.collision) return;
  if (doorScope) { doorScope.removeFromParent(); doorScope.traverse((m) => { if (m.geometry) m.geometry.dispose(); }); doorScope = null; }
  const c = d.collision, [nx, nz] = FACING_N[d.facing];
  const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2, y = levelY(d.level) + PEEP.eyeY;
  d.node.updateMatrixWorld(true);
  const rc = new THREE.Raycaster(new THREE.Vector3(cx - nx * 0.5, y, cz - nz * 0.5), new THREE.Vector3(nx, 0, nz), 0, 1);
  const hit = rc.intersectObject(d.node, true)[0];
  const inner = hit ? hit.point : new THREE.Vector3(nx > 0 ? c.minX : nx < 0 ? c.maxX : cx, y, nz > 0 ? c.minZ : nz < 0 ? c.maxZ : cz);
  const grp = new THREE.Group();
  grp.name = 'DoorScopeInside_' + d.roomId;
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
  doorScopeLensMat = lensMat;   // P6b-F1: 停電の間はレンズに映る常夜灯の点も消す
  const lensMesh = new THREE.Mesh(new THREE.CircleGeometry(0.011, 24).rotateY(Math.PI / 2), lensMat);
  lensMesh.position.x = 0.0085;
  grp.add(ring, barrel, lensMesh);
  for (const m of [ring, barrel, lensMesh]) { m.castShadow = false; m.receiveShadow = true; }
  // 扉板ローカル(開閉角 0 のとき世界の向きと同じ。原点 = 蝶番)。リングの軸(ローカル +x)を部屋の側(−n)へ向ける
  grp.rotation.y = Math.atan2(nz, -nx);
  grp.position.set(inner.x - nx * 0.004 - d.node.position.x, y - d.node.position.y, inner.z - nz * 0.004 - d.node.position.z);
  d.node.add(grp);
  doorScope = grp;
  doorScopeDoor = d;
}
let pendingE = null;   // E の長押し判定 {t, held}
// P6b-A(§3.9 #1): 覗き穴のある居室の中・扉の内側 1.0m 以内(扉面からの奥行き)・レンズまで 1.2m 以内・扉に正対(P2c のヒントと同じ角度)・扉が閉じている
function canPeep() {
  const rid = peepRoomHere();
  if (!rid) return false;
  const R = PEEP_ROOMS.get(rid), d = R.door;
  if (!d || d.angle > 0.03) return false;
  const L = lensFor(rid);
  if (!L) return false;
  const p = player.object.position, [nx, nz] = R.n;
  const depth = -((p.x - R.pos[0]) * nx + (p.z - R.pos[1]) * nz);
  if (depth < 0 || depth > 1.0) return false;
  const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
  const dx = L.x - p.x, dz = L.z - p.z, dist = Math.hypot(dx, dz);
  return dist < 1.2 && (dx * fwd.x + dz * fwd.z) / dist > 0.5;
}
// 覗き穴を開く(E 長押し・P)。今いる部屋のレンズへ差し替えてから
function peepOn() { setPeepLens(peepRoomHere()); peephole.set(true); }
function peepOff() { peephole.set(false); setPeepLens(null); }
function onUseKey() {
  if (canPeep()) { pendingE = { t: 0, held: false }; return null; }   // 短押し=扉、長押し=覗き穴(離した時に決まる)
  return useAndReport();
}
player.onKey = (code) => {
  if (code === 'KeyH') hud.showControls();
  if (death) return;
  if (code === 'KeyE' && rooms.hidden && rooms.hidden.phase === 'hidden' && !movie.active) { rooms.unhide(); return; }   // P3b: 隠れ場所から出る
  // カゴの中: 数字キーで行き先(1〜7)
  const dm = /^Digit([1-7])$/.exec(code);
  if (dm && elevator.inCar(player.pos.x, player.pos.z, playerLevel)) {
    if (story && story.evDisabled) hud.flash(HUD_TEXT.ev.noResponse);
    else { const n = +dm[1]; elevator.select(n); hud.flash(HUD_TEXT.ev.selected(n)); }
  }
  // P5a: L キーの施錠/解錠は撤去(DESIGN §3.7・§3.8 B「施錠要素は全廃」)。L は何もしない
  if (code === 'KeyP' && canPeep()) peepOn();
};
function updatePeepInput(dt) {
  if (pendingE) {
    if (player.keys.has('KeyE')) {
      pendingE.t += dt;
      if (!pendingE.held && pendingE.t >= 0.35) { pendingE.held = true; peepOn(); }
    } else {
      if (pendingE.held) peepOff(); else useAndReport();
      pendingE = null;
    }
  }
  if (peephole.active && !pendingE && !player.keys.has('KeyP') && !peephole.forced) peepOff();
  if (!peephole.active && peephole.lens !== lens) setPeepLens(null);   // 他の経路で閉じた(襲撃・死亡・スコープ演出)→ 410 に戻す
  updateDoorScope();
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
// P5b-1b: 入力を止めておく理由がまだ残っているか(視点固定・襲撃ムービーが終わった時に frozen を戻す判定)
function inputHeld() { return !!(stairs && stairs.busy) || !!death || movie.active || viewLock.active || !!(story && (story.trans || story.ending)) || !!(rooms && rooms.hidden) || peephole.active; }
// P2c: ヒット(t=0)の後は血飛沫を見せてから暗転。ATTACK 開始から暗転完了まで ≈0.85+1.75 = 2.6 秒
const DEATH = { flash: 0.08, blackFrom: 1.1, toBlack: 1.75, hold: 3.0, fadeIn: 0.8, sound: 0.85 };   // P4b: sound = 倒れる音(death 採用 A)を鳴らす時刻(暗転の手前)
function startDeath(why = null) {
  if (death) return;
  death = { t: 0, respawned: false, why };
  caption.firstChild.textContent = HUD_TEXT.death.title;
  if (peephole.active) { peephole.forced = false; peephole.set(false); }
  pendingE = null;
  player.frozen = true;
}
function updateDeath(dt) {
  if (!death) return;
  death.t += dt;
  const t = death.t;
  if (!death.snd && t >= DEATH.sound) { death.snd = true; bank.play('death'); }
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
    viewLock.cancel();
    movie.end();
    rooms.forceUnhide();
    stairs.cancel();   // P5b-1b: 段の途中で死んだ時、上り下りを打ち切る(残ると復帰後に段へ引き戻される)
    player.object.rotation.z = 0;
    player.invert = false; player.controls.pointerSpeed = 1;   // P5b-2a: 反転の上書きを戻す
    // P5b-1: 物語の段の開始位置へ(段・持ち物・壊れた扉・解放はそのまま)。物語なし(他のテスト)は従来の 410
    const sp = story && story.active ? story.respawnPoint() : { level: 4, ...CHECKPOINT };
    if (playerLevel !== sp.level) setPlayerLevel(sp.level);
    spaces.show(isSpace(sp.level) ? sp.level : null);
    player.setPose(sp.x, sp.z, sp.yaw, 0);
    player.frozen = false;
    ai.reset(ENEMY_HOME.x, ENEMY_HOME.z, ENEMY_HOME.yaw);
    if (story && story.active) story.afterRespawn();
    // P6b-H(§3.14 #1): 復帰先の階に管理人がいたら(向かっていたら・潜んでいたら)2 階以上離れた階の EV ホールへ移し、その階を 45 秒避ける(第1段の待機はそのまま)
    if (!TOUR && !PARAMS.has('noai')) ai.onPlayerRespawn(sp.level);
    deathCount++;
  }
  if (t >= respawnAt + DEATH.fadeIn) { death = null; overlay.style.opacity = '0'; flash.style.opacity = '0'; caption.style.opacity = '0'; }
}
let deathCount = 0;
renderer.domElement.addEventListener('click', () => { if (!player.isLocked()) player.lock(); });
// P2e: 画面ガイド
const hud = new Hud({
  camera, player, doors: doorsHere(), lens, evPanel: world.floors.get(4).panel, canPeep, inRoom410: () => playerLevel === 4 && player.pos.x > 7.86 && player.pos.z > 5.8 && player.pos.z < 8.7,
  inRoomOf: (door) => ai._rid(player.pos.x, player.pos.z, playerLevel) === door.roomId,
  extraTarget: () => extraTarget(),
  peepKey: () => (peephole.active ? (pendingE && pendingE.held ? 'E' : player.keys.has('KeyP') ? 'P' : 'E') : null),
  isMovie: () => movie.active || viewLock.active, isDead: () => !!death,
  storyTarget: () => (story ? story.target() : null), isEnding: () => !!(story && story.ending),   // P5b-1
});
player.controls.addEventListener('lock', () => { document.body.classList.add('locked'); hud.setPointer(true); });
player.controls.addEventListener('unlock', () => { document.body.classList.remove('locked'); hud.setPointer(false); });
resize();

// ---------------------------------------------------------------- 階の移動(P3a)
// 階を移る: 当たり・床の高さ・読み込み(±1)・画面ガイドの対象を差し替える。dy を渡すと足元の位置を保ったまま上下へ
function setPlayerLevel(key, { dy = null } = {}) {
  const prev = playerLevel;
  playerLevel = key;
  player.setWorld({ collisions: world.collisions(key), floorY: levelY(key), floorAt: floorAtFor(key) });
  if (dy !== null) player.placeAt(player.pos.x, levelY(key), player.pos.z);
  world.focus(key);
  hud.doors = doorsHere();
  const rec = world.floors.get(glbLevel(key));
  hud.evPanel = rec && rec.panel ? rec.panel : null;
  levelLog.push({ from: prev, to: key, t: +simTime.toFixed(2) });
  updateVisibility();
}
const levelLog = [];
const elevator = new Elevator({ building, world, player, camera, listener: enemyAudio.listener, bank, getLevel: () => playerLevel,
  setLevel: (key, o) => setPlayerLevel(key, o) });
// 行き先(±1)を先に読み始める(到着は読み終わってから)。P5b-3: 出発階(カゴを描いている階)は到着まで解放しない
//  (旧: 2 階以上離れた行き先では出発階が解放され、移動中は何も描かれず画面が暗転していた = docs/p5b3/NOTES.md §1)
elevator.onRideStart = (to) => world.focus(to, { keep: [playerLevel] });
// P6b-A(§3.9 #9): プレイヤーのカゴが管理人のいる階へ向かう → 管理人は EV ホールで待ち構える(条件は ai.evRideCheck)
elevator.onPlayerRide = (to, info) => { if (!TOUR && !tutorial.active) ai.evRideCheck(to, info); };   // (呼ばれるのはループが回り始めた後 = tutorial は定義済み)
// P3b: 入れる部屋の仕掛け(掃き出し窓・隠れ場所・落ちる物・屋上A の乗り越え)
rooms = new Rooms({ building, world, scene, player, camera, listener: enemyAudio.listener, bank, getLevel: () => playerLevel, flags: FLAGS,
  onNoise: (f) => { if (!TOUR && !(tutorial && tutorial.active)) ai.noiseRoom(f.room, f.x, f.z, f.level); },
  onHide: () => {} });
world.onBind = (lv, binds) => rooms.onBind(lv, binds);
world.onUnbind = (lv) => rooms.onUnbind(lv);
for (const [lv, rec] of world.floors) if (rec.state === 'ready' && rec.binds) rooms.onBind(lv, rec.binds);
ai.roomsSys = rooms;
ai.elevator = elevator;                              // P3b-A: 管理人も同じカゴで移動する(階数表示が動く)
elevator.attach(scene);
const stairs = new Stairs({ building, player, camera, getLevel: () => playerLevel,
  onStart: (from, to) => { world.focus(to); updateVisibility(); },
  onArrive: (to) => { setPlayerLevel(to); } });
// P5b-1: 物語の別空間と物語の状態機械。P5b-2a: 空間ごとのモジュール(src/spaces/<key>.js)。共有物は ctx に渡す(story は後から share)
spaces = new Spaces({ scene, world, building, camera, player, ai, enemy, audio: enemyAudio, hud, getLevel: () => playerLevel,
  busy: () => movie.active || viewLock.active || !!death,          // 襲撃ムービー・視点固定・死亡演出の間(カメラを触らない)
  kill: (why) => { if (!death && !TOUR) startDeath(why); } });     // 空間の中の死(312 の溺れ)
ai.spaceNav = (lv, fx, fz, tx, tz) => spaces.nav(lv, fx, fz, tx, tz);   // P5b-2a: 別空間の中の管理人の経路(105 の分岐の扉)
story = new Story({ mode: STORY_MODE, world, building, scene, camera, player, ai, hud, rooms, elevator, doorFx, flags: FLAGS, spaces, audio: enemyAudio, viewLock,
  envTex, aiControl: !TOUR && !PARAMS.has('noai'), getLevel: () => playerLevel,
  teleport: (key, x, z, yaw) => { setPlayerLevel(key); player.setPose(x, z, yaw, 0); updateVisibility(); } });
story.watcher = watcher; story.watcherBase = watcher.enabled;
story.onAIReset = (lv) => ai.reset(ENEMY_HOME.x, ENEMY_HOME.z, ENEMY_HOME.yaw, lv);   // P6b-C: 異空間から出た時は出た階でない EV ホールへ(lv 省略 = 4F)
spaces.share({ story });
// 見せる階: ふだんは今の階だけ。外階段・北階段の区画にいる時と上り下りの最中は上下の階も(吹き抜けで見えるので)
function updateVisibility() {
  if (isSpace(playerLevel)) { world.setVisible([]); if (rooms) rooms.syncVisible(world.visible); return; }   // P5b-1: 別空間では建物を描かない
  const c = glbLevel(playerLevel);
  const open = stairs.busy || !!stairs.inStairArea(player.pos.x, player.pos.z) || outdoorsHere();
  world.setVisible(open ? [c - 1, c, c + 1] : [c]);
  if (rooms) rooms.syncVisible(world.visible);
}
// P3b: 風の音の場所(屋上A / バルコニー / 屋内)
function outdoorKind() {
  if (playerLevel === 'G') return 'balcony';   // P3c: 敷地(地上の風は弱め)
  if (typeof playerLevel !== 'number') return null;
  const f = building.floors.find((ff) => ff.level === playerLevel);
  const p = player.pos;
  const a = f.shell.roomAir.find((q) => (q.kind === 'balcony' || q.kind === 'roofA') && p.x > q.rect[0] && p.x < q.rect[0] + q.rect[2] && p.z > q.rect[1] && p.z < q.rect[1] + q.rect[3]);
  return a ? a.kind : null;
}
// P3b: バルコニー・屋上A にいる(吹きさらしなので上下の階も見える)。開いた窓の前(室内)からも外が見える
function outdoorsHere() {
  if (playerLevel === 'G') return true;   // P3c: 敷地
  if (typeof playerLevel !== 'number') return false;
  const f = building.floors.find((ff) => ff.level === playerLevel);
  const p = player.pos;
  return f.shell.roomAir.some((a) => (a.kind === 'balcony' || a.kind === 'roofA') && p.x > a.rect[0] - 0.6 && p.x < a.rect[0] + a.rect[2] + 0.6 && p.z > a.rect[1] - 0.6 && p.z < a.rect[1] + a.rect[3] + 0.6);
}
// 画面ガイドの追加対象: カゴの行き先ボタン/階段の口
function extraTarget() {
  const b = elevator.buttonAt(camera, playerLevel);
  if (b) return { kind: 'evbutton', floor: b.floor, items: [HUD_TEXT.ev.button(b.floor)] };
  if (elevator.facingPanel(camera, playerLevel)) return { kind: 'evpanel', items: [HUD_TEXT.ev.panel] };
  const m = stairs.hint;
  if (m && !stairs.busy) return { kind: 'stair', items: [m.toKey === 'RB' ? HUD_TEXT.stair.roof : m.toKey === 'B1' ? HUD_TEXT.stair.basement : m.dir === 'up' ? HUD_TEXT.stair.up : HUD_TEXT.stair.down] };
  const rt = rooms.target(playerLevel);
  if (rt) {
    const R = HUD_TEXT.room;
    const items = rt.kind === 'window' ? [rt.open ? R.winClose : R.winOpen] : rt.kind === 'closet' ? [R.hide] : rt.kind === 'unhide' ? [R.unhide]
      : rt.kind === 'gate' ? [FLAGS.roofA ? R.climb : R.cantClimb] : [];
    return { kind: 'room_' + rt.kind, rt, items };
  }
  return null;
}

// ---------------------------------------------------------------- 場所ごとの環境音・自分の足音(P4b)
// 採用した環境音を場所で 1 本ずつ選んで鳴らす(AudioBank のループ。目標音量へなめらかに寄せ、0 になったら止まる):
//  廊下・EV ホール = amb_corridor A「空調のうなり」/ 敷地・外階段・北階段 = amb_outdoor B「森を抜ける風」/ 屋上A・屋上B(強)とバルコニー(弱)= amb_roof A「強い風」/
//  地下(B1・XB1 は強く、1F の地下への階段の区画は遠く小さく)= amb_b1 B「流れる水」(P3a-2 の仮音の水滴 updateDrips を置き換え)。105 の中は spaces/x105.js が amb_x105 を鳴らす。
//  「なし」= 居室(amb_room)・1F ロビー(amb_lobby)・カゴの中(ev_car_quiet)・705(amb_x705)・迷路(amb_maze)は無音。312 の中は spaces/x312.js の仮音のまま(3 周目)
const AMB = { corridor: 1.0, outdoor: 1.0, outdoorStair: 0.7, roofA: 1.0, roofB: 1.0, balcony: 0.4, b1: 0.8, xb1: 1.0, b1Stair: 0.35 };
const ROOM_RECTS = new Map();   // level → [{ rect, kind }](居室・共用室・EV。階段の区画は stairs.inStairArea で見る)
for (const f of building.floors) ROOM_RECTS.set(f.level, f.rooms.filter((r) => r.kind !== 'stair').map((r) => ({ rect: r.rect, kind: r.kind })));
function roomKindAt(lv, x, z) {
  for (const r of ROOM_RECTS.get(lv) || []) if (inRect(x, z, r.rect)) return r.kind;
  return null;
}
function ambienceAt() {
  const p = player.pos, lv = playerLevel, w = { corridor: 0, outdoor: 0, roof: 0, b1: 0 };
  if (lv === 'G') w.outdoor = AMB.outdoor;
  else if (lv === 'RB') w.roof = AMB.roofB;
  else if (lv === 'B1') w.b1 = AMB.b1;
  else if (lv === 'XB1') w.b1 = AMB.xb1;
  else if (typeof lv === 'number') {
    const st = stairs.inStairArea(p.x, p.z), ok = outdoorKind();
    if (ok === 'roofA') w.roof = AMB.roofA;
    else if (ok === 'balcony') w.roof = AMB.balcony;
    else if (st === 'basement') w.b1 = AMB.b1Stair;
    else if (st) w.outdoor = AMB.outdoorStair;
    else if (!roomKindAt(lv, p.x, p.z)) w.corridor = AMB.corridor;
  }
  return w;
}
function updateAmbience() {
  const w = TOUR || !death ? ambienceAt() : { corridor: 0, outdoor: 0, roof: 0, b1: 0 };
  bank.loop('amb_corridor').set(w.corridor);
  bank.loop('amb_outdoor').set(w.outdoor);
  bank.loop('amb_roof').set(w.roof);
  bank.loop('amb_b1').set(w.b1);
}
// 自分の足音: 居室の床(410 などの入れる部屋と 312 の複製の部屋)は pl_step_room A「靴下・柔らかい」。
// P6b-C(§3.10 #4): 走りは全面で鳴らす(歩きは従来どおり居室だけ)。同じ素材を面ごとに加工する(新しい wav は作らない):
//  廊下(カーペット)= 低域寄り(lowpass 1.2kHz)・音量 0.6 / 屋外・外階段・北階段・地下 = 硬く短く(highpass 300Hz・0.12 秒)・0.8。管理人の聴覚は変えない(enemy_ai の走りの音)
const STEP_SURF = { corridor: { cutoff: 1200, vol: 0.6 }, hard: { highpass: 300, dur: 0.12, vol: 0.8 } };
function stepSurface() {
  const lv = playerLevel, p = player.pos;
  if (lv === 'X312' || (typeof lv === 'number' && roomKindAt(lv, p.x, p.z) === 'unit' && !outdoorKind())) return 'room';
  if (lv === 'G' || lv === 'RB' || lv === 'B1' || lv === 'XB1' || lv === 'X705') return 'hard';
  if (typeof lv === 'number' && (stairs.busy || stairs.inStairArea(p.x, p.z) || outdoorKind())) return 'hard';
  return 'corridor';   // 廊下・EV ホール・共用室・105 の廊下
}
player.onStep = ({ run }) => {
  if (runGate.active) return;   // P6b-A2: 走り確認の間は歩いても進まない(足音も出さない)
  const surf = stepSurface();
  if (surf === 'room') bank.play('pl_step_room', { vol: run ? 1.0 : 0.75, tag: 'room' });
  else if (run) bank.play('pl_step_room', { ...STEP_SURF[surf], tag: surf });
};

// ---------------------------------------------------------------- P3c: 敷地への出入り・外を描くか・外の霧
// 正面玄関の線(外側の自動ドア)を越えたら 1F ⇔ 敷地 'G' を切り替える(床の高さは同じ。当たりだけ差し替わる)
function updatePortal() {
  const S = building.site;
  if (!S) return;
  const P = S.portal, p = player.pos;
  if (p.x < P.x0 || p.x > P.x1) return;
  if (Math.abs(p.z - P.z) > 1.0) return;   // P6b #12: 玄関の線の近くだけ(敷地の自転車置き場 x 14.9〜19.5・z 3〜13 も同じ x の範囲にあり、そこで 1F に化けていた)
  if (playerLevel === 1 && p.z > P.z + 0.02) setPlayerLevel('G');
  else if (playerLevel === 'G' && p.z < P.z - 0.02) setPlayerLevel(1);
}
// 外を描くか: 屋外(敷地・屋上・バルコニー・階段)では常に。屋内は「窓のある部屋の中で窓が視野にある」「1F のロビー・風除室から南を見る」
// 「入れる部屋の開いた扉の近く」だけ(屋内の奥＝廊下の途中などでは外観・外環境を描かない)
const _frustum = new THREE.Frustum(), _pm = new THREE.Matrix4(), _box = new THREE.Box3();
const ROOM_WINDOWS = new Map();   // level → [{ rect(部屋＋バルコニー), box(窓), door }]
for (const f of building.floors) {
  if (f.level > 7) continue;
  const list = [];
  for (const r of f.rooms) {
    if (!(r.door && r.door.enterable && r.window)) continue;
    const w = r.window, y0 = levelY(f.level);
    const [wx, wz] = w.pos;
    const hw = w.width / 2;
    const box = w.axis === 'z' ? new THREE.Box3(new THREE.Vector3(wx - 0.2, y0, wz - hw), new THREE.Vector3(wx + 0.2, y0 + 2.1, wz + hw))
      : new THREE.Box3(new THREE.Vector3(wx - hw, y0, wz - 0.2), new THREE.Vector3(wx + hw, y0 + 2.1, wz + 0.2));
    list.push({ id: r.id, rect: r.rect, bal: r.balcony ? r.balcony.rect : null, box, door: r.door.pos });
  }
  ROOM_WINDOWS.set(f.level, list);
}
// P3c-2: 廊下端の窓(shell.windows)。窓の箱が視野にあり、同じ階で窓の室内側 corrWinDist 以内なら外を描く
const CORR_WINDOWS = new Map();   // level → [{ pos, nin, box }]
for (const f of building.floors) {
  if (f.level > 7) continue;
  CORR_WINDOWS.set(f.level, f.shell.windows.map((w) => {
    const [x, z] = w.pos, nin = FACING_N[w.facing];   // 窓の facing = 室内側への向き
    const y0 = levelY(f.level) + w.sill, hw = w.w / 2;
    const box = nin[1] !== 0 ? new THREE.Box3(new THREE.Vector3(x - hw, y0, z - 0.3), new THREE.Vector3(x + hw, y0 + w.h, z + 0.3))
      : new THREE.Box3(new THREE.Vector3(x - 0.3, y0, z - hw), new THREE.Vector3(x + 0.3, y0 + w.h, z + hw));
    return { pos: [x, z], nin, box };
  }));
}
const ENTRANCE_VIEW = { rect: [14.0, 20.3, 8.0, 7.8], box: new THREE.Box3(new THREE.Vector3(15.6, 0, 28.0), new THREE.Vector3(19.6, 2.4, 28.3)) };
const inRect = (x, z, r, m = 0) => x > r[0] - m && x < r[0] + r[2] + m && z > r[1] - m && z < r[1] + r[3] + m;
function wantExterior() {
  if (playerLevel === 'G' || playerLevel === 'RB') return true;
  if (stairs.busy || stairs.inStairArea(player.pos.x, player.pos.z) || outdoorsHere()) return true;
  if (typeof playerLevel !== 'number') return false;
  camera.updateMatrixWorld();
  _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  _frustum.setFromProjectionMatrix(_pm);
  const p = player.pos;
  if (playerLevel === 1 && inRect(p.x, p.z, ENTRANCE_VIEW.rect) && _frustum.intersectsBox(ENTRANCE_VIEW.box)) return true;
  for (const w of CORR_WINDOWS.get(playerLevel) || []) {
    const dx = p.x - w.pos[0], dz = p.z - w.pos[1];
    if (dx * w.nin[0] + dz * w.nin[1] > 0 && Math.hypot(dx, dz) < LOOK.ext.corrWinDist && _frustum.intersectsBox(w.box)) return true;
  }
  for (const w of ROOM_WINDOWS.get(playerLevel) || []) {
    const inside = inRect(p.x, p.z, w.rect) || (w.bal && inRect(p.x, p.z, w.bal));
    const nearDoor = Math.hypot(p.x - w.door[0], p.z - w.door[1]) < LOOK.ext.windowCull && world.doorById.get(w.id)?.angle > 0.2;
    if ((inside || nearDoor) && _frustum.intersectsBox(w.box)) return true;
  }
  return false;
}
// 外の霧: 屋外にいる間は scene.fog を外観と同じ薄い霧へ(本物の階の外壁・バルコニーが外観と同じ見え方になる)。屋内は従来の濃さ
const FOG_IN = new THREE.Color(LOOK.fogColor), FOG_OUT = new THREE.Color().setRGB(...LOOK.ext.fogColor, THREE.LinearSRGBColorSpace);
let outdoorMix = 0;
function updateOutdoorLook(dt) {
  const out = playerLevel === 'G' || playerLevel === 'RB' || outdoorsHere() || !!stairs.inStairArea(player.pos.x, player.pos.z) || stairs.busy;
  outdoorMix += ((out && exterior.ready ? 1 : 0) - outdoorMix) * Math.min(1, dt * 2.5);
  scene.fog.density = LOOK.fogDensity + (LOOK.ext.fogDensity - LOOK.fogDensity) * outdoorMix;
  scene.fog.color.copy(FOG_IN).lerp(FOG_OUT, outdoorMix);
  if (exterior.ready) {
    exterior.show(wantExterior());
    exterior.update(dt, camera);
  }
  updateOutdoorQuality(out && exterior.ready);
}
// 屋外の描画負荷(計測: 敷地では外観・外環境が加わる分を、GTAO の解像度と風除室のガラスの透過で取り返す。docs/p3c/NOTES.md)
//  - GTAO: 屋外は 1/3 解像度(遠くの AO は見えない)
//  - 風除室の物理ガラス(transmission)は「背景をもう一度描く」ので、敷地にいる間は外観・森まで2回描くことになる → 敷地では半透明に切り替える
let outdoorQ = false;
function updateOutdoorQuality(on) {
  if (on !== outdoorQ) {
    outdoorQ = on;
    gtaoDiv = on ? LOOK.ext.gtaoDivOutdoor : 2;
    resize();
  }
  // P5b-2b: 物語の別空間では GTAO を切る(別空間の 1 フレームはほぼ後処理の負荷で、GTAO が約 3ms。霧と暗さで AO の差はほとんど見えない = docs/p5b2b/NOTES.md §6)
  gtao.enabled = !isSpace(playerLevel);
  const glassOut = playerLevel === 'G';
  for (const rec of world.floors.values()) {
    for (const m of rec.mats) {
      if (!m.userData.physGlass || m.userData.glassOut === glassOut) continue;
      m.userData.glassOut = glassOut;
      if (glassOut) { m.userData.tr = m.transmission; m.transmission = 0; m.transparent = true; m.opacity = LOOK.ext.glassOutdoorOpacity; m.depthWrite = false; }
      else { m.transmission = m.userData.tr ?? LOOK.glass.transmission; m.transparent = false; m.opacity = 1; m.depthWrite = true; }
      m.needsUpdate = true;
    }
  }
}

// ---------------------------------------------------------------- loop
const frameTimes = []; // [timestamp, frameMs, cpuMs]
let last = performance.now();
let simTime = 0;
// P6b-A2(§3.9 #18): 221 の初回の走り確認。管理人が玄関へ視点を向け終えて操作を返す瞬間(ai.onRunGate)に表示し、
//  プレイヤーが Shift を押しながら W で実際に前へ動くまで時間を止める: 管理人(AI・アニメ)・物語の時計(電話の鳴り)・窓の管理人は止め、
//  見回し(マウス)だけできる。W だけ・A/S/D では動かない(位置を戻す・表示はそのまま)。走って動いた瞬間に表示を消して再開(grace はそこから)
const runGate = { active: false, t: 0, log: [] };
ai.onRunGate = () => {
  runGate.active = true; runGate.t = 0;
  hud.runPrompt(true);
  runGate.log.push({ ev: 'on', at: +simTime.toFixed(3) });
};
function updateRunGate(dt, gx, gz) {
  if (!runGate.active) return;
  if (!ai.runGate || death) { runGate.active = false; hud.runPrompt(false); runGate.log.push({ ev: 'cancel', at: +simTime.toFixed(3) }); return; }   // 復帰・死亡などで解けた
  runGate.t += dt;
  const k = player.keys, run = (k.has('ShiftLeft') || k.has('ShiftRight')) && k.has('KeyW');
  const dx = player.pos.x - gx, dz = player.pos.z - gz, moved = Math.hypot(dx, dz);
  if (run && moved > 1e-4 && !player.frozen) {
    runGate.active = false; ai.runGate = false; hud.runPrompt(false);
    runGate.log.push({ ev: 'go', at: +simTime.toFixed(3), waited: +runGate.t.toFixed(3), speed: +(moved / Math.max(dt, 1e-4)).toFixed(2) });
    return;
  }
  if (moved > 0) {   // 歩き・横歩き・後ろ歩きでは進まない
    player.pos.x = gx; player.pos.z = gz;
    player.object.position.x -= dx; player.object.position.z -= dz;
    if (!runGate.walkTried && k.has('KeyW')) { runGate.walkTried = true; runGate.log.push({ ev: 'walk_ignored', at: +simTime.toFixed(3) }); }
  }
}
function step(dt) {
  // P6b-F1: タイトルの間はゲームの時間を止めたまま、タイトルの背景(廊下・管理人・灯り・血)だけを進める
  if (title.active) { title.update(dt); grainPass.uniforms.time.value += dt; return; }
  simTime += dt;
  const gx = player.pos.x, gz = player.pos.z;
  player.update(dt);
  updateRunGate(dt, gx, gz);
  updatePortal();
  if (!movie.active && !death) stairs.update(dt);   // P5b-1b: 襲撃ムービー・死亡演出の間は段の上り下りを止める
  rooms.update(dt, playerLevel);
  if (tutorial.waking) tutorial.updateWake(dt);   // P6b-F3: ?notutorial の開始の起き上がり(rooms の後 = カメラを上書き)
  if (tutorial.active) tutorial.update(dt);   // P6a: 場面を映すチュートリアル(カメラ・演出体の管理人・扉・EV を動かす。rooms の後 = 隠れ場所のカメラの向きを上書き)
  rooms.updateWind(dt, outdoorKind());   // P4b: 風の音は updateAmbience(amb_roof)。ここは場所の記録だけ
  if (!tutorial.active && !runGate.active) story.update(dt);   // P5b-1(P6a: チュートリアルの間は止める。P6b-A2: 走り確認の間も)
  updatePeepInput(dt);
  camera.updateMatrixWorld();
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  if (!TOUR) {
    if (!tutorial.active && !runGate.active) ai.update(dt);   // P6a: チュートリアルの間は AI の通常動作を止める(管理人は tutorial.js が演出体として動かす)。P6b-A2: 走り確認の間も
    if (!runGate.active) enemy.update(dt, camera);   // P6b-A2: 走り確認の間は管理人の動き(アニメ・足音)も止める
    // P5b-3: 管理人もシアターの段床に乗る(見た目の足元の高さだけ。当たり・経路・視線の判定は床のまま。段は約 0.1 秒で登る)
    if (!ai.transit && TIERS.has(ai.level)) {
      const want = liftAt(ai.level, enemy.pos.x, enemy.pos.z);
      enemyLift += THREE.MathUtils.clamp(want - enemyLift, -3.2 * dt, 3.2 * dt);
      enemy.root.position.y = levelY(ai.level) + enemyLift;
    } else enemyLift = 0;
    movie.update(dt);
    viewLock.update(dt);
  }
  updateDoors(dt);
  if (!TOUR) ai.afterDoors();   // P6b-A: 空室の扉が閉まり切ったこのフレームで潜む(描かない)
  elevator.update(dt);
  enemy.root.visible = !TOUR && ai.level === playerLevel && !ai.transit && !ai.concealed;   // P5a: 空室の中に潜んでいる間は描かない
  updateCarLamp();
  doorFx.update(dt, { level: playerLevel, x: player.pos.x, z: player.pos.z,
    busy: TOUR || movie.active || viewLock.active || !!death || ['CHASE', 'ATTACK', 'EVAMBUSH'].includes(ai.state) }, TOUR ? null : tutorial.active ? tutorial.lurkId : ai.lurkRoomId);
  updateVisibility();
  updateOutdoorLook(dt);
  power.update(dt);   // P6b-F1: 停電・消え掛かり(灯りの倍率を書くだけ。管理人・EV の動きは変えない)
  if (doorScopeLensMat && doorScopeDoor) doorScopeLensMat.emissiveIntensity = 0.9 * power.emAt(doorScopeDoor.level);
  spaces.update(dt);   // P5b-2a: 今いる別空間の演出(霧などの見た目の上書きもあるので外の見た目の後)
  if (!TOUR && !tutorial.active && !runGate.active) watcher.update(dt);
  if (!TOUR) enemyAudio.update(dt);
  updateAmbience();   // P4b: 場所ごとの環境音(地下の水滴 updateDrips を置き換え)
  bank.update(dt);
  updateDeath(dt);
  hud.update(dt);
  grainPass.uniforms.time.value = simTime;
}
// P5a 監査: EV のカゴの中・戸口の管理人をカゴの照明で照らす(敵だけに効く光。カゴの照明が点いている時だけ)。
//  天井の乳白パネルの前寄り(扉側)から＝顔と胸の前に当たる。値は CAR_LAMP
const CAR_LAMP = { color: 0xfff2e0, intensity: 1.1, range: 3.4, y: 2.05, toDoor: 0.55, reach: 2.4 };
const _carLampC = new THREE.Color(CAR_LAMP.color).multiplyScalar(CAR_LAMP.intensity);
function updateCarLamp() {
  const c = elevator.car, lit = elevator.light.visible;
  const g = elevator.rooms[c.level] && elevator.rooms[c.level].geom;
  const e = enemy.pos;
  if (!lit || !g || ai.level !== c.level || ai.transit || Math.hypot(e.x - g.center[0], e.z - g.center[1]) > CAR_LAMP.reach) { enemy.carLamp = null; return; }
  const lamp = enemy.carLamp || { p: new THREE.Vector3(), c: _carLampC, r: CAR_LAMP.range };
  lamp.p.set(g.center[0], levelY(c.level) + CAR_LAMP.y, g.center[1] - CAR_LAMP.toDoor);
  enemy.carLamp = lamp;
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
  if (!window.__n2 || !window.__n2.paused) step(Math.min(Math.max(dt, 0), 0.1));   // paused: 監査スクリプトが pump で進める間、本物のループを止める。P6b-F1: タイトルの間は step がタイトルの背景だけを進める(ゲームの時間は止まる)
  render();
  const cpu = performance.now() - t0;
  frameTimes.push([now, dt * 1000, cpu]);
  while (frameTimes.length && now - frameTimes[0][0] > 1000) frameTimes.shift();
  requestAnimationFrame(frame);
}
// P2c: 襲撃ムービーの血(ShaderPass)と血煙(Points)のシェーダを先にコンパイルしておく(初回発動時の 50ms 級の引っかかり対策)
// P5b-1: 物語の開始(?stage=N はその段の開始状態)
if (STORY_MODE === 'play') {
  story.applyStage(parseInt(PARAMS.get('stage'), 10) || 1);
  if (PARAMS.has('roofA')) FLAGS.roofA = true;
  if (PARAMS.has('entranceOut')) { FLAGS.entranceOut = true; story._applyEntrance(); }
}
// P6a: タイトル(「NOLIFE」＋「クリックで開始」)→ 場面を映すチュートリアル → 410 のベッド脇。
//  タイトルは通常プレイと ?test=tutorial だけ(?tour・他の ?test=… では出さない)。チュートリアルは ?notutorial で出さない(タイトルのクリックで通常プレイへ)
const tutorial = new Tutorial({ camera, player, ai, enemy, enemyAudio, bank, world, elevator, rooms, doorFx, peephole, hud, scene, ambientFloor, door410, renderer, movie, exterior, look: LOOK,
  loadExterior: () => (exterior.ready ? Promise.resolve(exterior) : (window.__n2._extLoad ||= exterior.load())),
  teleport: (key, x, z, yaw, pitch = 0) => { setPlayerLevel(key); player.setPose(x, z, yaw, pitch); updateVisibility(); },
  getLevel: () => playerLevel, controlsSec: HUD.controlsSec,
  resetAI: (dormant) => { ai.reset(ENEMY_HOME.x, ENEMY_HOME.z, ENEMY_HOME.yaw); if (dormant) ai.setDormant(true); } });
const TITLE_ON = !TOUR && (!PARAMS.has('test') || PARAMS.get('test') === 'tutorial');
const title = new Title({ show: TITLE_ON, lock: () => player.lock(), resumeAudio,
  // P6b-F3(§3.13 #2): チュートリアルなし(?notutorial)の開始もベッドから起き上がる(?stage=N・物語なしでは起き上がらない)
  onStart: () => { if (!PARAMS.has('notutorial') && STORY_MODE === 'play') tutorial.start(); else if (STORY_MODE === 'play' && !PARAMS.has('stage')) tutorial.wakeUp(); },
  // P6b-F1(§3.12 #1): 背景 = 4F の廊下の生レンダ(管理人は演出体・灯りは power の manual)
  camera, player, ai, enemy, world, power, renderer, hud, exterior, scene, ambientFloor, look: LOOK, getLevel: () => playerLevel,
  teleport: (key, x, z, yaw, pitch = 0) => { setPlayerLevel(key); player.setPose(x, z, yaw, pitch); updateVisibility(); },
  resetAI: (dormant) => { ai.reset(ENEMY_HOME.x, ENEMY_HOME.z, ENEMY_HOME.yaw); if (dormant) ai.setDormant(true); } });
player.controls.addEventListener('unlock', () => { if (tutorial.active) tutorial.requestSkip('unlock'); });   // ポインタロック中の Esc はロックが外れるだけでキーが届かないことがある
movie.pass.enabled = true; movie.mist.points.visible = true;
render();
movie.pass.enabled = false; movie.mist.points.visible = false;
requestAnimationFrame(frame);
// P3c: 建物の後に外観・外環境を読む(読み込み中・失敗しても遊べる)
//  ?test=building は 8 番(外環境のロード前後の負荷)で自分で読むので、ここでは読まない
const exteriorLoad = PARAMS.has('noext') || PARAMS.get('test') === 'building' ? null : exterior.load().catch((e) => { console.error('exterior load failed', e); return null; });

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
    exterior: exterior.stats(),
  };
}
window.__n2 = {
  THREE, scene, camera, renderer, player, composer, doors, manifest, manifests, LOOK, building, world, elevator, stairs, stairsArrival,   // P6b-C: 着く位置(テスト)
  get collisions() { return world.collisions(playerLevel); },   // プレイヤーの今の階の当たり(P0 のテストは 4F)
  get level() { return playerLevel; },
  levelLog,
  setLevel(key) { setPlayerLevel(key); return world.focus(key); },
  // 階・位置へ直接移る(テスト・スクショ用)。読み込み完了の Promise を返す
  teleport(key, x, z, yaw = 0, pitch = 0) { setPlayerLevel(key); player.setPose(x, z, yaw, pitch); stairs.quiet = 0;   // P6b #5: テレポートで到着直後の無ヒント時間を持ち越さない
    updateVisibility(); return world.focus(key); },
  get hideOdds() { return { ...ai.hideOdds, open: +ai.hideOpenOdds().toFixed(3), start: { ...HIDE_ODDS_START } }; },   // P5b-6: 逃げ込みの確率の現在値(起動時の値)
  enemyObj: enemy, ai, enemyAudio, bank, get bankLoad() { return bankLoad; }, ambienceAt, peepholeObj: peephole, doorApi, CHECKPOINT, ENEMY_HOME, rooms, flags: FLAGS,
  get lens() { return peephole.active ? peephole.lens : (lensFor(peepRoomHere()) || lens); },   // P6b-A: 今いる部屋のレンズ(覗いている間はその部屋)
  lensFor, peepRoomHere, canPeep, get doorScopeDoor() { return doorScopeDoor && doorScopeDoor.roomId; },   // P6b-A
  runGate,   // P6b-A2: 221 の初回の走り確認({ active, t, log })
  movie, ambientFloor, get doorScope() { return doorScope; }, hud, hudState: () => hud.state(),
  doorFx, viewLock, watcher, tutorial, title,   // P5a・P6a
  power,   // P6b-F1: 停電(power.state()・startBlackout(秒)・startFlicker()・emitterFactors(階))
  story, spaces,   // P5b-1: 物語(story.state()・applyStage(n)・enterSpace(id)…)と別空間
  storyDecor, setLiveDrip,   // P3b-4: 怖い扉(部屋ごとのデカールの頂点数など)・生乾きの垂れの伸び(0..1)
  exterior, EXT_U, wantExterior,   // P3c: 外観・外環境(exterior.ready / show / stats)。?noext なら load() を手で呼ぶ
  loadExterior: () => (exterior.ready ? Promise.resolve(exterior) : (window.__n2._extLoad ||= exterior.load())),
  get exteriorLoad() { return exteriorLoad; },
  // 手動ポンプ: 本物のループと同じ順(player → peephole入力 → AI → enemy(mixer) → doors → 音 → 死亡演出)で n 回進め、最後に1回描画
  pump(dt = 1 / 60, n = 1, render = true) { for (let i = 0; i < n; i++) step(dt); if (render) this.render(); return ai.stats(); },
  peephole(on) { peephole.forced = !!on; if (on) { if (!peephole.active) setPeepLens(peepRoomHere()); peephole.set(true); } else { peephole.set(false); setPeepLens(null); } return { active: peephole.active, fov: camera.fov, pos: camera.position.toArray(), room: peephole.lens.room }; },
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
  setView(x, z, yaw, pitch = 0) { player.setPose(x, z, yaw, pitch); },   // P4a-2: しゃがみ廃止で crouch 引数を外した
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
    const key = fl === 'RB' || fl === 'B1' || fl === 'G' ? fl : Math.min(7, Math.max(1, parseInt(fl, 10) || 4));
    if (key === 'RB') await window.__n2.teleport('RB', ...building.roofB.spawn, -Math.PI / 2);
    else if (fl === 'G') await window.__n2.teleport('G', ...building.site.spawn, 0);   // P3c: エントランス前(建物を向く)
    else if (key === 'B1') await window.__n2.teleport('B1', ...building.basement.spawn, Math.PI / 2);
    else await window.__n2.teleport(key, 6.9, 20.7, Math.PI);   // EV ホール前で EV を向く
  }
}
if (PARAMS.get('test') === 'enemy') import('../tools/test_enemy.js').then((m) => m.run(window.__N2)).catch(showErr);
if (PARAMS.get('test') === 'building') import('../tools/test_building.js').then((m) => m.run(window.__N2)).catch(showErr);
if (PARAMS.get('test') === 'rooms') import('../tools/test_rooms.js').then((m) => m.run(window.__N2)).catch(showErr);
if (PARAMS.get('test') === 'story') import('../tools/test_story.js').then((m) => m.run(window.__N2)).catch(showErr);
if (PARAMS.get('test') === 'spaces') import('../tools/test_spaces.js').then((m) => m.run(window.__N2)).catch(showErr);   // P5b-2a: 異世界 105・312
if (PARAMS.get('test') === 'x105') import('../tools/test_x105.js').then((m) => m.run(window.__N2)).catch(showErr);       // P6b-A: 105 の追跡の前倒し(§3.9 #15)
if (PARAMS.get('test') === 'xb1') import('../tools/test_xb1.js').then((m) => m.run(window.__N2)).catch(showErr);        // P6b-D: 地下の潜んでやり過ごす(§3.10 #6 C)
if (PARAMS.get('test') === 'tutorial') import('../tools/test_tutorial.js').then((m) => m.run(window.__N2)).catch(showErr);   // P6a: タイトルとチュートリアル
if (PARAMS.get('test') === 'audio') import('../tools/test_audio.js').then((m) => m.run(window.__N2)).catch(showErr);     // P4b: 音の接続
