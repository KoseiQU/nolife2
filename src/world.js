// world.js — P3a: 全館の世界(階の読み分け・当たり・扉)。
//  - 当たり: building.json → walls.js の箱を「階ごと」に常駐(GLB の有無に関係なく全7階＋屋上B)。
//    P0 と同じ形 {minX,maxX,minZ,maxZ,y0,y1,kind,roomId,disabled}。EV はカゴに入れるよう塊を殻に置き換え、
//    外階段・北階段は「段の手前で止まる」当たり(guard)を足す(上り下りは stairs.js の移動)。
//  - 見た目: 階ごとの build/floor_N.glb ＋ floor_N_lightmap.webp ＋ manifest。プレイヤーの階 ±1 だけ読み、他は解放する。
//    テクスチャは GLB に入っていないので、manifest.materials の対応表で build/tex の共有ファイルを貼る(全階で使い回し)。
//  - 扉: 全階の扉の状態(角度・施錠・当たり)を常駐。GLB の扉板は読み込まれた時に結び付ける(解放しても状態は残る)。
// 階のキー: 1..7 と 'RB'(屋上B = 7F の屋根。見た目は 7F の GLB に入っている)と 'B1'(P3a-2: 地下の踊り場。見た目は 1F の GLB)と
//  'G'(P3c: 1F の外の敷地。床の高さは 1F と同じ。見た目は 1F の GLB と外観 build/exterior.glb)。

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { floorWallBoxes, GEOM, evOpeningCenter, doorWidth } from './walls.js';
import { decorateStoryDoors, updateStoryDoors } from './story_doors.js';
import { extShade, corrGlass } from './exterior.js';

export const FH = GEOM.FLOOR_H;
export const LEVELS = [1, 2, 3, 4, 5, 6, 7];
// P5b-1: 物語の別空間(異世界 4 空間の差し替え口。今は仮の小部屋 = src/spaces.js)。階キー 'X105'・'X312'・'X705'・'XB1'。
//  床の高さは建物から遠く離した SPACE_Y(見た目も当たりも建物と重ならない)。読み込む階の GLB は入口の扉のある階(戻った時にすぐ見えるよう)
export const SPACE_KEYS = ['X105', 'X312', 'X705', 'XB1'];
export const SPACE_HOST = { X105: 1, X312: 3, X705: 7, XB1: 1 };
export const SPACE_Y = -60;
export const isSpace = (k) => typeof k === 'string' && k[0] === 'X';
export const levelY = (k) => (isSpace(k) ? SPACE_Y : (k === 'RB' ? 7 : k === 'B1' ? -1 : k === 'G' ? 0 : k - 1) * FH);
export const glbLevel = (k) => (isSpace(k) ? SPACE_HOST[k] : k === 'RB' ? 7 : k === 'B1' || k === 'G' ? 1 : k);
// P5b-1: 鍵で開く物語の扉(血の扉 4 枚＋地下の鉄扉)。扉板は結合せず別ノードに残す(開く・血のデカールを扉板に付けて一緒に回す)
export const STORY_DOOR_IDS = new Set(['105', '220', '312', '705', 'B1DOOR']);
export const FACING_N = { W: [-1, 0], E: [1, 0], N: [0, -1], S: [0, 1] };

const box = (minX, minZ, maxX, maxZ, kind, roomId = null, y0 = 0, y1 = GEOM.CEIL_H) => ({ minX, maxX, minZ, maxZ, y0, y1, kind, roomId, disabled: false });

// EV のカゴ(p0b_ev.build_car と同じ寸法: 幅 ±0.78、奥行 0.42〜1.80、扉の面 0.30〜0.42)
export function evCarGeom(room) {
  const [px, pz] = room.door.pos;
  const [ox] = evOpeningCenter(room);
  return { inner: [px - 0.78, pz + 0.42, px + 0.78, pz + 1.80], open: [ox - 0.4, ox + 0.4], doorZ: [pz + GEOM.EV_ALCOVE_D, pz + 0.42], center: [px, pz + 1.1] };
}

// 1 階ぶん(key)の当たり
export function buildLevelCollisions(building, key) {
  const y0 = levelY(key), y1 = y0 + GEOM.CEIL_H;
  const cols = [];
  const push = (b) => { b.y0 = y0; b.y1 = y1; cols.push(b); };
  if (key === 'RB') {
    const R = building.roofB;
    for (const b of floorWallBoxes({ rooms: [], footprint: R.footprint, fillWalls: [] })) push(box(b.cx - b.w / 2, b.cz - b.d / 2, b.cx + b.w / 2, b.cz + b.d / 2, 'wall'));
    for (const o of R.obstacles) { const [x, z, w, d] = o.rect; push(box(x, z, x + w, z + d, 'solid', o.id)); }
  } else if (key === 'G') {
    // P3c: 敷地(柵・擁壁・建物の外壁＝外周、正面玄関の扉＝perimDoor、車・ラック・植え込みなどの箱)
    const S = building.site;
    for (const b of floorWallBoxes({ rooms: [], footprint: S.footprint, perimOpenings: S.perimOpenings, fillWalls: [] })) push(box(b.cx - b.w / 2, b.cz - b.d / 2, b.cx + b.w / 2, b.cz + b.d / 2, b.kind, b.kind === 'perimDoor' ? 'ENTRANCE_OUT' : null));
    for (const o of S.obstacles) { const [x, z, w, d] = o.rect; push(box(x, z, x + w, z + d, 'solid', o.id)); }
  } else if (key === 'B1') {
    // P3a-2: 地下の踊り場(階段の箱の4壁＋施錠扉のブロッカ)
    const B = building.basement;
    for (const b of floorWallBoxes({ rooms: B.rooms, footprint: B.footprint, fillWalls: [] })) push(box(b.cx - b.w / 2, b.cz - b.d / 2, b.cx + b.w / 2, b.cz + b.d / 2, b.kind, b.roomId || null));
  } else {
    const floor = building.floors.find((f) => f.level === key);
    for (const b of floorWallBoxes(floor)) {
      if (b.kind === 'solid' && b.part === 'evBack') {
        // カゴに入れるよう、シャフトの塊を殻(前壁・扉・側壁・奥壁)に置き換える
        const room = floor.rooms.find((r) => r.id === b.roomId);
        const [x, z, w, d] = room.rect;
        const g = evCarGeom(room);
        const fz0 = g.doorZ[0], fz1 = g.doorZ[1];
        push(box(x, fz0, g.open[0], fz1, 'solid', room.id));
        push(box(g.open[1], fz0, x + w, fz1, 'solid', room.id));
        push(box(g.open[0], fz0, g.open[1], fz1, 'evdoor', room.id));
        push(box(x, fz1, g.inner[0], z + d, 'solid', room.id));
        push(box(g.inner[2], fz1, x + w, z + d, 'solid', room.id));
        push(box(x, g.inner[3], x + w, z + d, 'solid', room.id));
        continue;
      }
      push(box(b.cx - b.w / 2, b.cz - b.d / 2, b.cx + b.w / 2, b.cz + b.d / 2, b.kind, b.roomId || null));
    }
    const t = 0.12;
    for (const c of floor.shell.caps) {
      const minX = c.normal === 'W' ? c.x : c.x - t;
      push(box(minX, c.z0, minX + t, c.z1, 'cap'));
    }
    for (const p of floor.props || []) {
      if (p.kind === 'mailboxes') push(box(p.pos[0], p.pos[2], p.pos[0] + 0.06 + p.size[0], p.pos[2] + p.size[2], 'solid', 'MAILBOXES'));
    }
    // P3b: 入れる部屋の家具(低い物 'furn' は視線を遮らない・背の高い物 'furnT' は遮る)。屋上A の乗り越えの台
    for (const r of floor.rooms) {
      if (!r.interior) continue;
      for (const [x0, z0, x1, z1, fy0, fy1, tall] of r.interior.solids) {
        const b = box(x0, z0, x1, z1, tall ? 'furnT' : 'furn', r.id);
        b.fy = [fy0, fy1];
        cols.push(Object.assign(b, { y0: y0 + fy0, y1: y0 + fy1 }));
      }
    }
    for (const r of floor.rooms) {   // 入れる部屋のバルコニーの室外機
      if (!(r.door && r.door.enterable && r.balcony && r.balcony.ac)) continue;
      const [x0, z0, x1, z1] = r.balcony.ac;
      cols.push(Object.assign(box(x0, z0, x1, z1, 'furn', r.id), { y0, y1: y0 + 0.6 }));
    }
    for (const o of (floor.roofA && floor.roofA.obstacles) || []) {
      const [x, z, w, d] = o.rect;
      cols.push(Object.assign(box(x, z, x + w, z + d, 'furn', o.id), { y0, y1: y0 + o.h }));
    }
    for (const g of floor.gates || []) {
      const [sx0, sz0, sx1, sz1] = g.step;
      cols.push(Object.assign(box(sx0, sz0, sx1, sz1, 'furn', g.id), { y0, y1: y0 + (g.stepTop || 0.6) }));   // 台(室外機)
    }
  }
  // 階段の段の手前で止める当たり(踊り場の床の高さでは階段側へ進めない。上り下りは stairs.js)
  for (const st of building.stairs) {
    if (!st.stops.includes(key)) continue;
    const [x, z, w, d] = st.geom.guard;
    push(box(x, z, x + w, z + d, 'stairguard', st.id));
  }
  return cols;
}

// 扉の開き方(build_floor.py build_door と同じ規則: 扉板はヒンジ(pos - 幅/2 側)から伸び、部屋の内側へ回る)
function doorSign(room) {
  const [fx, fz] = FACING_N[room.door.facing];
  const rd = [-fx, -fz];
  return (room.door.facing === 'N' || room.door.facing === 'S') ? (rd[1] < 0 ? 1 : -1) : (rd[0] > 0 ? 1 : -1);
}

export class World {
  // ctx: { scene, renderer, building, manifests{level: manifest}, envTex, look, onFloorReady(level, rec) }
  constructor(ctx) {
    Object.assign(this, ctx);
    this.maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.keys = [...LEVELS, 'RB', 'B1', 'G'];
    this.cols = new Map(this.keys.map((k) => [k, buildLevelCollisions(this.building, k)]));
    for (const k of SPACE_KEYS) this.cols.set(k, []);   // P5b-1: 別空間の当たり(spaces.js が中身を入れる)
    this.floors = new Map();       // level → { state:'loading'|'ready', promise, group, lightMap, mats:Set, geoms:[] }
    this.texCache = new Map();
    this.doors = [];
    this.doorById = new Map();
    this.roomById = new Map();     // P5a: roomId → { room, level }(壊れた扉の奥の当たり・扉の前の帯の計算用)
    // P5a: 管理人が潜む「空の施錠された部屋」(内装なし・物語の部屋を除く居室 73 室)。扉板を結合せず別ノードに残す(揺れ・開閉・壊れ)
    this.lurkableIds = new Set();
    for (const f of this.building.floors) {
      if (f.level > 7) continue;
      for (const r of f.rooms) {
        this.roomById.set(r.id, { room: r, level: f.level });
        if (r.kind === 'unit' && r.door && !r.door.enterable && !r.story) this.lurkableIds.add(r.id);
      }
    }
    // P3a-2: 地下の踊り場の施錠扉も扉として持つ(開かない＝operable なし。E で「鍵がかかっている」＋ガチャ音)
    const levelsWithDoors = this.building.floors.filter((f) => f.level <= 7)
      .map((f) => ({ key: f.level, rooms: f.rooms, ops: new Set(f.shell.operable) }));
    if (this.building.basement) levelsWithDoors.push({ key: 'B1', rooms: this.building.basement.rooms, ops: new Set() });
    for (const { key, rooms, ops } of levelsWithDoors) {
      for (const r of rooms) {
        if (!r.door || r.kind === 'elevator') continue;
        // P3b-3: 見学モード(?tour)でも開くのは通常プレイで開く扉だけ(内装のない部屋の扉は開けない＝無の空間を見せない。DESIGN §2.3)。
        //  以前は見学モードで施錠扉も全部開けられた
        const operable = ops.has(r.id);
        const d = {
          roomId: r.id, level: key, kind: r.door.auto ? 'auto' : 'swing', unit: r.kind === 'unit', steel: !!r.door.steel,
          operable, sign: doorSign(r), openAngle: operable ? 1.75 : 0, angle: 0, target: 0, open01: 0,
          locked: false, speedMul: 1, rattle: 0, node: null, leaves: [], sealed: !!r.door.sealed, tryable: !!r.door.sealed,
          pos: r.door.pos, facing: r.door.facing, width: doorWidth(r),
          // P5a: lurkable = 管理人が潜む空室の扉(開かない扉だが、管理人は開けて出入りする・壊して飛び出す・中で何かが暴れて揺れる)
          lurkable: this.lurkableIds.has(r.id), broken: null, shake: 0, shakeT: 0, shakePhase: 0, nodeBase: null, blockers: [],
          collision: this.cols.get(key).find((c) => c.kind === 'door' && c.roomId === r.id) || null,
        };
        this.doors.push(d);
        this.doorById.set(r.id, d);
      }
    }
    // P3c: 正面玄関の外側の自動ドア(1F の perimDoor と敷地 'G' の perimDoor の両方を当たりに持つ。どちらの側からでも近づくと開く)
    if (this.building.site) {
      const f1 = this.building.floors.find((f) => f.level === 1);
      const po = f1.perimOpenings[0];
      const d = {
        roomId: 'ENTRANCE_OUT', level: 1, alsoLevel: 'G', kind: 'auto', unit: false, steel: false, operable: true, sign: 1, openAngle: 1.75,
        angle: 0, target: 0, open01: 0, locked: false, speedMul: 1, rattle: 0, node: null, leaves: [], sealed: false, tryable: false,
        pos: po.pos, facing: 'S', width: po.width,
        collision: this.cols.get(1).find((c) => c.kind === 'perimDoor') || null,
        collision2: this.cols.get('G').find((c) => c.kind === 'perimDoor') || null,
      };
      this.doors.push(d);
      this.doorById.set(d.roomId, d);
    }
    this.visible = new Set();
    this.exteriorReady = false;   // P3c: 外観(build/exterior.glb)が読めたら、階の GLB の「他の階の外壁の塊」と仮の地面を隠す
  }

  // P3c: 外観が読めた/外れた。階の GLB の他の階の塊(MX_Mass の自分の階以外)と仮の地面(MX_Ground)の出し入れ
  setExteriorReady(on) {
    this.exteriorReady = on;
    for (const rec of this.floors.values()) for (const m of rec.extOther || []) m.visible = !on;
  }

  collisions(key) { return this.cols.get(key); }

  // ------------------------------------------------------------ テクスチャ(共有)
  texture(path, srgb) {
    const key = path + (srgb ? ':s' : ':l');
    if (this.texCache.has(key)) return this.texCache.get(key);
    let done;
    const ready = new Promise((r) => { done = r; });
    const t = new THREE.TextureLoader().load('./' + path, () => done(), undefined, () => done());
    t.userData.ready = ready;
    t.flipY = false;                       // glTF の UV 規約
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = this.maxAniso;
    this.texCache.set(key, t);
    return t;
  }

  // ------------------------------------------------------------ 読み込み・解放
  load(level) {
    const rec0 = this.floors.get(level);
    if (rec0) return rec0.promise;
    const man = this.manifests[level];
    const rec = { state: 'loading', level, group: null, lightMap: null, mats: new Set(), geoms: [] };
    rec.promise = (async () => {
      const [gltf, lightMap, lightMap2] = await Promise.all([
        new GLTFLoader().loadAsync('./build/' + man.glb),
        new THREE.TextureLoader().loadAsync('./build/' + man.lightmap.file),
        man.lightmap2 ? new THREE.TextureLoader().loadAsync('./build/' + man.lightmap2.file) : Promise.resolve(null),
      ]);
      if (rec.cancelled) { disposeTree(gltf.scene); lightMap.dispose(); if (lightMap2) lightMap2.dispose(); return rec; }
      for (const [lm, def] of [[lightMap, man.lightmap], [lightMap2, man.lightmap2]]) {
        if (!lm) continue;
        lm.flipY = false;
        lm.channel = def.channel;
        lm.colorSpace = def.encoding === 'srgb' ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
        lm.generateMipmaps = true;
        lm.minFilter = THREE.LinearMipmapLinearFilter;
      }
      rec.lightMap = lightMap;
      rec.lightMap2 = lightMap2;   // P3b: 部屋の組(MR_* の材質)
      this._prepare(gltf.scene, man, rec);
      rec.group = gltf.scene;
      rec.group.name = 'Floor_' + level;
      // 見せない階は scene から外しておく(描画リスト・影・GTAO の走査に入れない)。setVisible で出し入れする
      if (this.visible.has(level)) this.scene.add(rec.group);
      rec.state = 'ready';
      this._bind(level, rec);
      decorateStoryDoors(this, level, rec);   // P3b-4: 進行解放の5室の扉の血痕(見た目だけ。読み終わった後に非同期で足す)
      // 風除室の静的環境は、この階の材質のテクスチャが読み終わってから描く(未読込の面は黒く写るため)
      if (man.envProbe) {
        const waits = [];
        for (const m of rec.mats) for (const k of ['map', 'normalMap', 'roughnessMap', 'emissiveMap']) if (m[k] && m[k].userData.ready) waits.push(m[k].userData.ready);
        rec.probeReady = Promise.all(waits).then(() => { if (!rec.cancelled && this.floors.get(level) === rec) this._captureEnv(rec, man.envProbe); });
      }
      if (this.onFloorReady) this.onFloorReady(level, rec);
      return rec;
    })();
    this.floors.set(level, rec);
    return rec.promise;
  }

  unload(level) {
    const rec = this.floors.get(level);
    if (!rec) return;
    this.floors.delete(level);
    if (rec.state !== 'ready') { rec.cancelled = true; return; }
    for (const d of this.doors) if (d.level === level) { d.node = null; d.leaves = []; }
    if (this.onFloorUnload) this.onFloorUnload(level, rec);
    if (this.onUnbind) this.onUnbind(level);
    rec.group.removeFromParent();
    for (const g of rec.geoms) g.dispose();
    rec.group.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    for (const m of rec.mats) m.dispose();
    rec.lightMap.dispose();
    if (rec.lightMap2) rec.lightMap2.dispose();
    if (rec.probeEnv) rec.probeEnv.dispose();
  }

  isReady(level) { const r = this.floors.get(level); return !!(r && r.state === 'ready'); }

  // プレイヤーの階 ±1 を読み、それ以外を解放。返り値: その階が読めた時に解決
  //  P5b-3: keep = 解放しない階(EV で移動中のカゴのある出発階。到着して setPlayerLevel が focus し直すまで残す)
  focus(key, { keep = [] } = {}) {
    const c = glbLevel(key);
    const want = new Set([c - 1, c, c + 1].filter((l) => l >= 1 && l <= 7));
    for (const k of keep) { const l = glbLevel(k); if (l >= 1 && l <= 7) want.add(l); }
    for (const l of [...this.floors.keys()]) if (!want.has(l)) this.unload(l);
    const center = this.load(c);
    for (const l of want) if (l !== c) center.then(() => this.load(l));
    return center;
  }

  setVisible(levels) {
    const next = new Set(levels);
    let same = next.size === this.visible.size;
    if (same) for (const l of next) if (!this.visible.has(l)) { same = false; break; }
    if (same) return;   // 毎フレーム呼ばれるので、変わった時だけ出し入れする
    this.visible = next;
    for (const [l, rec] of this.floors) {
      if (!rec.group) continue;
      const want = this.visible.has(l);
      if (want && rec.group.parent !== this.scene) this.scene.add(rec.group);
      else if (!want && rec.group.parent) rec.group.removeFromParent();
    }
  }

  loadedLevels() { return [...this.floors.entries()].filter(([, r]) => r.state === 'ready').map(([l]) => l).sort(); }

  // ------------------------------------------------------------ 材質・結合
  _prepare(root, man, rec) {
    const L = this.look;
    const GLASS = new Set(['M_WireGlass', 'M_WireGlassOut', 'M_Window', 'M_EVDisplay', 'M_EVCarDisplay', 'M_GlassClear', 'MX_WinGlass', 'MX_CorrGlass', 'MR_Mirror']);
    const NO_SHADOW = new Set(['lampcover', 'exitsign_face', 'windowglass', 'void', 'evbutton', 'glass', 'glassedge', 'decal', 'rail', 'backdrop',
      'massing', 'bars', 'winout', 'secmon', 'roof', 'balcony', 'corrglass']);
    // P3a-2: 風除室の透明ガラスは物理材質(透過・屈折・薄い青緑の吸収・低い粗さ＋指紋/汚れの粗さマップ)に置き換える
    const phys = new Map();
    root.traverse((o) => {
      if (!o.isMesh || !PHYS_GLASS.has(o.material.name)) return;
      const src = o.material;
      if (!phys.has(src.name)) {
        const def = (man.materials || {})[src.name] || {};
        const G = L.glass;
        const pm = new THREE.MeshPhysicalMaterial({
          name: src.name, color: 0xffffff, metalness: 0, roughness: G.roughness, ior: 1.52, specularIntensity: 1,
          transmission: G.transmission, thickness: G.thickness, attenuationColor: new THREE.Color(G.tint), attenuationDistance: G.tintDistance,
          side: THREE.DoubleSide,
        });
        if (def.roughnessMap) { pm.roughnessMap = this.texture(def.roughnessMap, false); }
        pm.userData.physGlass = true;
        phys.set(src.name, pm);
        src.dispose();
      }
      o.material = phys.get(src.name);
    });
    this._splitMassing(root, man, rec);
    root.traverse((o) => {
      if (!o.isMesh) return;
      const kind = o.userData.n2_kind || o.parent?.userData.n2_kind || '';
      // P3c-2 差し戻し(2026-11-01 ユーザー「窓はステンレス感を強めて」): 廊下端の窓の額縁は専用材質にする。
      // 共有の M_Stainless は 1F で風除室の静的環境(暖色)を受けて木枠のように見えるため、中立の環境・低い粗さ・やや冷たい色にする
      if (kind === 'window' && !Array.isArray(o.material) && o.material.name === 'M_Stainless') {
        if (!rec.winFrameMat) { rec.winFrameMat = o.material.clone(); rec.winFrameMat.name = 'M_WinFrameSS'; }
        o.material = rec.winFrameMat;
      }
      o.castShadow = !NO_SHADOW.has(kind);
      o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (rec.mats.has(m)) continue;
        rec.mats.add(m);
        const def = (man.materials || {})[m.name];
        if (m.userData.physGlass) {
          // ライトマップは使わない(ベイクの対象外)。映り込みは風除室の静的環境(_captureEnv)、それまでは共通の環境
          m.lightMap = null; m.envMap = this.envTex; m.envMapIntensity = L.glassEnv;
          m.userData.n2Emissive = 0; m.needsUpdate = true;
          continue;
        }
        if (def) {
          if (def.map) { m.map = this.texture(def.map, true); m.color.setRGB(1, 1, 1); }
          if (def.tint) m.color.fromArray(def.tint);   // P3a-2: 同じテクスチャの色違い(地下へ下る壁・床)
          if (def.roughnessMap) { m.roughnessMap = this.texture(def.roughnessMap, false); m.roughness = 1; }
          if (def.normalMap) { m.normalMap = this.texture(def.normalMap, false); const s = def.normalScale ?? 1; m.normalScale.set(s, -s); }
          if (def.emissiveMap) { m.emissiveMap = this.texture(def.emissiveMap, true); m.emissive.setRGB(1, 1, 1); }
          if (def.opacity !== undefined) { m.transparent = true; m.opacity = Math.max(m.opacity < 1 ? m.opacity : def.opacity, 0.08); m.depthWrite = false; }
        }
        // EV の三方枠とカゴの内装は細い面が多くライトマップが数テクセルしかなく、カゴの中から見るとギザギザになる(しかも
        // ベイクはカゴの照明が消えた状態)→ ライトマップを使わず、カゴの照明(elevator.js の PointLight)＋環境光＋懐中電灯で見せる
        // P3b: MR_* = 部屋の組(2枚目のライトマップ)、MX_* = ライトマップなし(ガラス・動く障子・細い格子・遠景の塊)
        if (m.name.startsWith('MX_')) m.lightMap = null;
        else if (m.name.startsWith('MR_') && rec.lightMap2) m.lightMap = rec.lightMap2;
        else m.lightMap = NO_LIGHTMAP.has(m.name) ? null : rec.lightMap;
        m.lightMapIntensity = (m.lightMap === rec.lightMap2 && rec.lightMap2 ? man.lightmap2.intensity : man.lightmap.intensity) * L.lightmapGain;
        m.envMapIntensity = 0;
        if (m.metalness > 0.5 || GLASS.has(m.name)) { m.envMap = this.envTex; m.envMapIntensity = m.metalness > 0.5 ? L.metalEnv : L.glassEnv; }
        if (m.name === 'M_WinFrameSS') { m.color.setRGB(0.70, 0.72, 0.74); m.roughness = 0.24; m.metalness = 1.0; m.envMap = this.envTex; m.envMapIntensity = L.metalEnv * (L.winFrameEnv ?? 1.8); }   // P3c-2: 廊下端の窓の額縁(ステンレス)
        if (m.name === 'MR_Mirror') m.envMapIntensity = L.mirrorEnv ?? 0.012;   // 夜の暗い部屋の鏡(共通の環境は明るすぎる)
        if (m.name === 'MX_WinGlass') { m.color.setRGB(0.1, 0.115, 0.125); m.opacity = 0.12; m.envMapIntensity = L.glassEnv * 0.5; m.roughness = 0.08; }   // 掃き出し窓のガラス(夜は暗く、映り込みだけ)
        if (m.name === 'MX_Bars') { m.alphaTest = 0.5; m.side = THREE.DoubleSide; m.transparent = false; }   // P3b: バルコニーの格子(透過テクスチャ)
        if (m.name === 'MX_CorrGlass') corrGlass(m, L, this.envTex);   // P3c-2: 廊下端の窓のガラス(外が見える)
        if (m.name === 'MX_Mass' || m.name === 'MX_CorrAlu') extShade(m, { fog: false });   // P3c: 外の塊は外観と同じ月明かり(霧は scene のまま)。P3c-2: 廊下端の窓の外の枠も
        m.userData.n2Emissive = m.emissiveIntensity;   // 倍率を掛ける前(EV のカゴの照明を点ける時に使う)
        if (L.emissiveScale[m.name] !== undefined) m.emissiveIntensity *= L.emissiveScale[m.name];
        m.needsUpdate = true;
      }
    });
    rec.panel = (() => {
      const n = root.getObjectByName('EVCallPanel_EV' + man.level);
      if (!n) return null;
      n.updateMatrixWorld(true);
      return new THREE.Box3().setFromObject(n).getCenter(new THREE.Vector3());
    })();
    this._merge(root, rec);
    rec.extOther = [];
    root.traverse((o) => { if (o.isMesh && o.material.userData.extOther) rec.extOther.push(o); });
    for (const m of rec.extOther) m.visible = !this.exteriorReady;
  }

  // P3c: 外の塊(build_rooms.build_massing)を「この階の帯の壁」と「他の階の塊・屋根・仮の地面」に分ける。後者は外観が読めたら隠す
  _splitMassing(root, man, rec) {
    const y0 = (man.level - 1) * FH, y1 = y0 + FH;
    const nodes = [];
    root.traverse((o) => { if (o.isMesh && (o.userData.n2_kind === 'massing' || o.parent?.userData.n2_kind === 'massing')) nodes.push(o); });
    let otherMat = null;
    for (const o of nodes) {
      if (o.material.name === 'MX_Ground') {
        o.material = o.material.clone(); o.material.userData.extOther = true; continue;
      }
      if (o.material.name !== 'MX_Mass') continue;
      const g = o.geometry, pos = g.attributes.position, idx = g.index;
      if (!idx) continue;
      const own = [], other = [];
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
      o.updateMatrixWorld(true);
      for (let t = 0; t < idx.count; t += 3) {
        a.fromBufferAttribute(pos, idx.getX(t)).applyMatrix4(o.matrixWorld);
        b.fromBufferAttribute(pos, idx.getX(t + 1)).applyMatrix4(o.matrixWorld);
        c.fromBufferAttribute(pos, idx.getX(t + 2)).applyMatrix4(o.matrixWorld);
        n.subVectors(b, a).cross(c.clone().sub(a)).normalize();
        const cy = (a.y + b.y + c.y) / 3;
        const tri = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
        if (Math.abs(n.y) < 0.3 && cy > y0 + 0.01 && cy < y1 - 0.01) own.push(...tri); else other.push(...tri);
      }
      if (!other.length) continue;
      if (!otherMat) { otherMat = o.material.clone(); otherMat.userData.extOther = true; }
      if (own.length) {
        g.setIndex(own);
        const g2 = g.clone(); g2.setIndex(other);
        const m2 = new THREE.Mesh(g2, otherMat);
        m2.position.copy(o.position); m2.quaternion.copy(o.quaternion); m2.scale.copy(o.scale);
        m2.userData = { ...o.userData };
        o.parent.add(m2);
      } else {
        o.material = otherMat;
      }
    }
  }

  // P3a-2: 風除室の静的環境(キューブカメラ1回＋PMREM)。この階の GLB だけを一時シーンに置き、ガラスを隠して
  //  probe.pos から6方向を描く(ロビーのダウンライト・石の壁・床が映る)。probe.mats の材質の envMap に差し替える。
  //  解放時(unload)に dispose。描くのは読み込み時の1回だけ(毎フレームのコストなし)
  _captureEnv(rec, probe) {
    const r = this.renderer;
    const rt = new THREE.WebGLCubeRenderTarget(probe.size || 256, { type: THREE.HalfFloatType, generateMipmaps: false });
    const cam = new THREE.CubeCamera(0.05, 40, rt);
    cam.position.fromArray(probe.pos);
    const tmp = new THREE.Scene();
    tmp.background = new THREE.Color(0x000000);
    tmp.add(new THREE.HemisphereLight(this.look.ambientSky, this.look.ambientGround, this.look.ambientFloor));
    const parent = rec.group.parent;
    const hidden = [];
    rec.group.traverse((o) => { if (o.isMesh && o.visible && (o.material.userData.physGlass || PROBE_HIDE.has(o.material.name))) { o.visible = false; hidden.push(o); } });
    tmp.add(rec.group);
    const auto = r.autoClear, info = r.info.autoReset;
    r.autoClear = true;
    cam.update(r, tmp);
    r.autoClear = auto; r.info.autoReset = info;
    if (parent) parent.add(rec.group); else tmp.remove(rec.group);
    for (const o of hidden) o.visible = true;
    const pmrem = new THREE.PMREMGenerator(r);
    const env = pmrem.fromCubemap(rt.texture).texture;
    pmrem.dispose(); rt.dispose();
    rec.probeEnv = env;
    const gain = probe.intensity || {};
    for (const m of rec.mats) {
      if (!(m.name in gain)) continue;
      m.envMap = env; m.envMapIntensity = gain[m.name] * (this.look.probeGain ?? 1); m.needsUpdate = true;
      if (m.metalness < 0.5 && !m.userData.physGlass) specularOnlyEnv(m);   // 石の床・壁: 拡散はライトマップが担うので映り込みだけ
    }
    rec.probe = probe;
  }

  // 静的メッシュを材質ごとに1つへ(P0 mergeStatic と同じ)。動く扉板(開閉できる扉・EV 扉・自動ドア)だけ残す
  _merge(root, rec) {
    root.updateMatrixWorld(true);
    const isMovable = (o) => {
      for (let p = o; p; p = p.parent) {
        const u = p.userData || {};
        if (u.n2_kind === 'evdoor' || u.n2_kind === 'closetdoor' || u.n2_kind === 'lockerdoor') return true;
        if (u.n2_kind === 'winsash' && u.n2_operable) return true;
        if ((u.n2_kind === 'door' || u.n2_kind === 'autodoor') && u.n2_operable) return true;
        if (u.n2_kind === 'door' && this.lurkableIds.has(String(u.n2_room))) return true;   // P5a: 空室の扉板(揺れ・開閉・壊れ)
        if (u.n2_kind === 'door' && STORY_DOOR_IDS.has(String(u.n2_room))) return true;     // P5b-1: 鍵で開く物語の扉
      }
      return false;
    };
    const groups = new Map();
    const victims = [];
    root.traverse((o) => {
      if (!o.isMesh || isMovable(o)) return;
      const key = o.material.uuid + (o.castShadow ? ':s' : ':n');
      if (!groups.has(key)) groups.set(key, { material: o.material, castShadow: o.castShadow, geoms: [] });
      const g = o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'uv1'].includes(name)) g.deleteAttribute(name);
      groups.get(key).geoms.push(g);
      victims.push(o);
    });
    for (const o of victims) { o.removeFromParent(); o.geometry.dispose(); }
    for (const { material, castShadow, geoms } of groups.values()) {
      const merged = mergeGeometries(geoms, false);
      for (const g of geoms) g.dispose();
      if (!merged) { console.warn('merge failed', material.name); continue; }
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = 'merged_' + material.name;
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      if (material.transparent) mesh.renderOrder = 2;
      root.add(mesh);
      rec.geoms.push(merged);
    }
  }

  // GLB の扉板・自動ドア・EV 扉を状態に結び付ける
  _bind(level, rec) {
    rec.evLeaves = [];
    rec.binds = [];   // P3b: 掃き出し窓の障子・クローゼットの折戸・ロッカーの扉(rooms.js が状態に結び付ける)
    rec.group.traverse((o) => {
      const u = o.userData;
      if (u.n2_kind === 'door' && (u.n2_operable || this.lurkableIds.has(String(u.n2_room)) || STORY_DOOR_IDS.has(String(u.n2_room)))) {
        const d = this.doorById.get(String(u.n2_room));
        if (d) { d.node = o; o.rotation.order = 'YXZ'; d.nodeBase = o.position.clone(); this._poseLeaf(d); }
      } else if (u.n2_kind === 'autodoor' && u.n2_operable) {
        const d = this.doorById.get(String(u.n2_room));
        if (d) d.leaves.push({ node: o, base: o.position.clone(), dir: new THREE.Vector3().fromArray(u.n2_slide), dist: u.n2_slide_dist });
      } else if (u.n2_kind === 'evdoor') {
        rec.evLeaves.push({ node: o, base: o.position.clone(), dir: new THREE.Vector3().fromArray(u.n2_slide), dist: u.n2_slide_dist });
      } else if (u.n2_kind === 'winsash' && u.n2_operable) {
        rec.binds.push({ kind: 'window', room: String(u.n2_room), node: o, base: o.position.clone(), dir: new THREE.Vector3().fromArray(u.n2_slide), dist: u.n2_slide_dist });
      } else if (u.n2_kind === 'closetdoor' || u.n2_kind === 'lockerdoor') {
        rec.binds.push({ kind: u.n2_kind, room: String(u.n2_room), node: o, part: u.n2_part || 'leaf', side: u.n2_side || '' });
      }
    });
    if (this.onBind) this.onBind(level, rec.binds);
    for (const d of this.doors) if (d.level === level && d.kind === 'auto') this._applyAuto(d);
    this._rebuildLurkMerged(level);
  }

  // P5a: 空室の扉板(14 枚前後/階 × 3 材質)を別ノードのまま描くと描画コールが 1 階で約 +100 になる(影・GTAO の走査込み)。
  //  止まっている扉板は階ごとに材質単位で 1 つへ結合して描き、動いている扉(管理人の出入り・ガタガタ・壊れた・ノブを試した)だけ別ノードを見せる
  _leafAtRest(d) { return !d.broken && d.angle === 0 && d.target === 0 && !(d.shake > 0) && !(d.rattle > 0); }
  _rebuildLurkMerged(level) {
    const rec = this.floors.get(level);
    if (!rec || rec.state !== 'ready' || !rec.group) return;
    for (const m of rec.lurkMerged || []) { m.removeFromParent(); m.geometry.dispose(); }
    rec.lurkMerged = [];
    rec.group.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(rec.group.matrixWorld).invert();
    const groups = new Map();
    for (const d of this.doors) {
      if (d.level !== level || !d.lurkable || !d.node) continue;
      const rest = this._leafAtRest(d);
      d._merged = rest;
      d.node.visible = !rest;
      if (!rest) continue;
      d.node.traverse((o) => {
        if (!o.isMesh) return;
        const key = o.material.uuid + (o.castShadow ? ':s' : ':n');
        if (!groups.has(key)) groups.set(key, { material: o.material, castShadow: o.castShadow, geoms: [] });
        const g = o.geometry.clone();
        g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
        for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'uv1'].includes(name)) g.deleteAttribute(name);
        groups.get(key).geoms.push(g);
      });
    }
    for (const { material, castShadow, geoms } of groups.values()) {
      const merged = geoms.length ? mergeGeometries(geoms, false) : null;
      for (const g of geoms) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = 'merged_lurkLeaves_' + material.name;
      // 閉じた扉板は壁の面に収まっていて影は壁と同じ → 影のパス(懐中電灯 2 灯)には入れない(P5a 監査: 描画コールを減らす)
      mesh.castShadow = false; mesh.receiveShadow = true; void castShadow;
      rec.group.add(mesh);
      rec.lurkMerged.push(mesh);
    }
  }

  // P3b-4: 怖い扉の「生乾きの垂れ」(見た目だけ。扉の前に初めて来ると伸びる)
  updateDecor(dt, levelKey, x, z) { updateStoryDoors(dt, levelKey, x, z); }

  _applyAuto(d) {
    for (const l of d.leaves) l.node.position.copy(l.base).addScaledVector(l.dir, l.dist * d.open01);
  }

  // ------------------------------------------------------------ 扉の毎フレーム(P0 updateDoors＋自動ドア)
  // movers: [{ level, x, z }](プレイヤー・管理人)。自動ドアは同じ階で 1.7m 以内に誰かいれば開く
  updateDoors(dt, movers) {
    const SPEED = 2.4;
    let dirty = null;
    for (const d of this.doors) {
      if (d.kind === 'auto') {
        const near = movers.some((m) => (m.level === d.level || (d.alsoLevel && m.level === d.alsoLevel)) && Math.hypot(m.x - d.pos[0], m.z - d.pos[1]) < 1.7);
        const want = near && !d.locked ? 1 : 0;
        const nv = d.open01 + Math.sign(want - d.open01) * Math.min(Math.abs(want - d.open01), dt / 1.1);
        if (nv !== d.open01) { d.open01 = nv; this._applyAuto(d); }
        if (d.collision) d.collision.disabled = d.open01 > 0.85;
        if (d.collision2) d.collision2.disabled = d.open01 > 0.85;
        d.angle = d.open01 * 1.75; d.target = want * 1.75;
        continue;
      }
      if (d.operable) {
        const delta = d.target - d.angle;
        if (Math.abs(delta) > 1e-4) {
          const k = 0.35 + 0.65 * Math.min(1, Math.abs(d.angle) / 0.4);
          d.angle += Math.sign(delta) * Math.min(Math.abs(delta), SPEED * k * (d.speedMul || 1) * dt);
        }
        if (d.node) d.node.rotation.y = d.sign * d.angle;
        if (d.collision) d.collision.disabled = d.angle > 0.25;
      } else {
        // P5a: 開かない扉。管理人が出入りする空室の扉は target へ動かす(プレイヤーは開けられない)。壊れた扉は大きく開いて傾いたまま
        if (d.broken) {
          const b = d.broken;
          b.t += dt;
          const delta = b.angle - d.angle;
          d.angle += Math.sign(delta) * Math.min(Math.abs(delta), DOOR_FX_SPEED.broken * dt);
          if (d.collision) d.collision.disabled = true;
        } else if (d.lurkable) {
          const delta = d.target - d.angle;
          if (Math.abs(delta) > 1e-4) {
            const k = 0.35 + 0.65 * Math.min(1, Math.abs(d.angle) / 0.4);
            d.angle += Math.sign(delta) * Math.min(Math.abs(delta), SPEED * k * (d.speedMul || 1) * dt);
          }
          if (d.collision) d.collision.disabled = d.angle > 0.25;
        }
        if (d.rattle > 0) d.rattle -= dt;
        if (d.shake > 0) { d.shake -= dt; d.shakeT += dt; }
      }
      if (d.node && !d.operable) this._poseLeaf(d);
      if (d.lurkable && d.node && this._leafAtRest(d) !== d._merged) (dirty ||= new Set()).add(d.level);
    }
    if (dirty) for (const lv of dirty) this._rebuildLurkMerged(lv);
  }

  // P5a: 開かない扉の扉板の姿勢(開き角・壊れた傾き・ガタガタの揺れ・ノブを試した時のごく小さな揺れ)
  _poseLeaf(d) {
    const n = d.node;
    if (!n) return;
    let ry = d.sign * d.angle, rx = 0, rz = 0;
    if (n.rotation.order !== 'YXZ') n.rotation.order = 'YXZ';
    if (d.nodeBase) n.position.copy(d.nodeBase);
    const ns = d.facing === 'N' || d.facing === 'S';
    if (d.broken) {
      // 蝶番が外れて扉板が垂れる: 板の面の法線まわりに傾け(戸先が下がる)、少し沈める
      const b = d.broken, k = Math.min(1, b.t / 0.25);
      if (ns) rz = -b.tilt * k; else rx = b.tilt * k;
      n.position.y -= b.drop * k;
    } else if (d.shake > 0) {
      // ガタガタ: 中から激しく引かれて掛け金の遊びの分だけ部屋側へ跳ねる(ラッチで止まる)。2 Hz の波の中に 11〜15 Hz の震え
      const t = d.shakeT, env = Math.min(1, t / 0.15) * Math.min(1, d.shake / 0.3);
      const surge = Math.max(0, Math.sin(t * 2 * Math.PI * 1.9 + d.shakePhase)) ** 2;
      const buzz = Math.abs(Math.sin(t * 2 * Math.PI * 13.0) + 0.6 * Math.sin(t * 2 * Math.PI * 11.3 + 1.7));
      ry = d.sign * (0.004 + 0.022 * surge * (0.5 + 0.5 * buzz)) * env;
      const [fx, fz] = FACING_N[d.facing];
      const push = -0.004 * surge * env;   // 部屋側へ(扉板ごと数 mm)
      n.position.x += fx * push; n.position.z += fz * push;
    } else if (d.angle === 0 && d.rattle > 0) ry = d.sign * 0.004;
    n.rotation.set(rx, ry, rz);
  }

  // P5a: 扉を壊す(管理人の飛び出し)。大きく開いて傾いたまま残る。当たりは開いた扱い(通れる)。
  //  奥は内装のない部屋なので、戸口から 1.2m より奥と、戸口の左右には入れない当たりを置く(奥の闇の箱は door_fx.js)
  breakDoor(id, { angle = 1.18, tilt = 0.075, drop = 0.025 } = {}) {
    const d = this.doorById.get(String(id));
    if (!d || d.broken) return false;
    d.broken = { angle, tilt, drop, t: 0 };
    d.target = 0; d.shake = 0;
    if (d.collision) d.collision.disabled = true;
    const rr = this.roomById.get(d.roomId);
    if (rr) {
      const cols = this.cols.get(d.level);
      const y0 = levelY(d.level), y1 = y0 + GEOM.CEIL_H;
      d.blockers = brokenDoorBlockers(rr.room, d).map(([x0, z0, x1, z1]) => Object.assign(box(x0, z0, x1, z1, 'solid', d.roomId), { y0, y1, brokenDoor: true }));
      cols.push(...d.blockers);
    }
    if (this.onDoorBroken) this.onDoorBroken(d);
    return true;
  }
  // デバッグ・テスト用: 壊れた扉を元に戻す
  repairDoor(id) {
    const d = this.doorById.get(String(id));
    if (!d || !d.broken) return false;
    const cols = this.cols.get(d.level);
    for (const b of d.blockers) { const i = cols.indexOf(b); if (i >= 0) cols.splice(i, 1); }
    d.blockers = []; d.broken = null; d.angle = 0; d.target = 0;
    if (d.collision) d.collision.disabled = false;
    this._poseLeaf(d);
    if (this.onDoorRepaired) this.onDoorRepaired(d);
    return true;
  }
}

const DOOR_FX_SPEED = { broken: 14.0 };   // 壊れた扉板が開き切る速さ(rad/s)

// 壊れた扉の奥の当たり(AABB [x0,z0,x1,z1] の配列)。戸口の奥行 entry と幅 ±(扉幅/2+side) の箱だけ入れる
export function brokenDoorBlockers(room, d, entry = 1.2, side = 0.12) {
  const [rx, rz, rw, rd] = room.rect;
  const [nx, nz] = FACING_N[d.facing];          // 廊下側
  const [px, pz] = d.pos;
  const half = d.width / 2 + side;
  const out = [];
  if (nx !== 0) {   // W/E 向き: 奥は x 方向
    const inX = -nx;                                  // 部屋の奥へ
    const a = px, b = px + inX * entry, far = inX > 0 ? rx + rw : rx;
    out.push([Math.min(b, far), rz, Math.max(b, far), rz + rd]);
    if (pz - half > rz) out.push([Math.min(a, b), rz, Math.max(a, b), pz - half]);
    if (pz + half < rz + rd) out.push([Math.min(a, b), pz + half, Math.max(a, b), rz + rd]);
  } else {          // N/S 向き: 奥は z 方向
    const inZ = -nz;
    const a = pz, b = pz + inZ * entry, far = inZ > 0 ? rz + rd : rz;
    out.push([rx, Math.min(b, far), rx + rw, Math.max(b, far)]);
    if (px - half > rx) out.push([rx, Math.min(a, b), px - half, Math.max(a, b)]);
    if (px + half < rx + rw) out.push([px + half, Math.min(a, b), rx + rw, Math.max(a, b)]);
  }
  return out.filter(([x0, z0, x1, z1]) => x1 - x0 > 0.01 && z1 - z0 > 0.01);
}

// 環境マップを鏡面反射だけに使う(拡散の IBL を足さない。拡散はベイク済みライトマップ)
const SPEC_ONLY_CHUNK = THREE.ShaderChunk.lights_fragment_maps.replace('iblIrradiance += getIBLIrradiance( geometryNormal );', '');
function specularOnlyEnv(m) {
  m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_maps>', SPEC_ONLY_CHUNK); };
  m.customProgramCacheKey = () => 'n2SpecOnlyEnv';
}
const PHYS_GLASS = new Set(['M_GlassClear']);

const PROBE_HIDE = new Set(['M_GlassEdge']);
const NO_LIGHTMAP = new Set(['M_EVFrame', 'M_CarBeige', 'M_CarStone', 'M_CarFloor', 'M_CarPanel', 'M_EVCarDisplay', 'M_Mirror', 'M_GlassEdge', 'M_Decal']);

function disposeTree(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.dispose();
    for (const m of [].concat(o.material)) m.dispose();
  });
}
