// world.js — P3a: 全館の世界(階の読み分け・当たり・扉)。
//  - 当たり: building.json → walls.js の箱を「階ごと」に常駐(GLB の有無に関係なく全7階＋屋上B)。
//    P0 と同じ形 {minX,maxX,minZ,maxZ,y0,y1,kind,roomId,disabled}。EV はカゴに入れるよう塊を殻に置き換え、
//    外階段・北階段は「段の手前で止まる」当たり(guard)を足す(上り下りは stairs.js の移動)。
//  - 見た目: 階ごとの build/floor_N.glb ＋ floor_N_lightmap.webp ＋ manifest。プレイヤーの階 ±1 だけ読み、他は解放する。
//    テクスチャは GLB に入っていないので、manifest.materials の対応表で build/tex の共有ファイルを貼る(全階で使い回し)。
//  - 扉: 全階の扉の状態(角度・施錠・当たり)を常駐。GLB の扉板は読み込まれた時に結び付ける(解放しても状態は残る)。
// 階のキー: 1..7 と 'RB'(屋上B = 7F の屋根。見た目は 7F の GLB に入っている)。

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { floorWallBoxes, GEOM, evOpeningCenter, doorWidth } from './walls.js';

export const FH = GEOM.FLOOR_H;
export const LEVELS = [1, 2, 3, 4, 5, 6, 7];
export const levelY = (k) => (k === 'RB' ? 7 : k - 1) * FH;
export const glbLevel = (k) => (k === 'RB' ? 7 : k);
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
    this.keys = [...LEVELS, 'RB'];
    this.cols = new Map(this.keys.map((k) => [k, buildLevelCollisions(this.building, k)]));
    this.floors = new Map();       // level → { state:'loading'|'ready', promise, group, lightMap, mats:Set, geoms:[] }
    this.texCache = new Map();
    this.doors = [];
    this.doorById = new Map();
    for (const f of this.building.floors) {
      if (f.level > 7) continue;
      const ops = new Set(f.shell.operable);
      for (const r of f.rooms) {
        if (!r.door || r.kind === 'elevator') continue;
        const operable = ops.has(r.id);
        const d = {
          roomId: r.id, level: f.level, kind: r.door.auto ? 'auto' : 'swing', unit: r.kind === 'unit', steel: !!r.door.steel,
          operable, sign: doorSign(r), openAngle: operable ? 1.75 : 0, angle: 0, target: 0, open01: 0,
          locked: false, speedMul: 1, rattle: 0, node: null, leaves: [],
          pos: r.door.pos, facing: r.door.facing, width: doorWidth(r),
          collision: this.cols.get(f.level).find((c) => c.kind === 'door' && c.roomId === r.id) || null,
        };
        this.doors.push(d);
        this.doorById.set(r.id, d);
      }
    }
    this.visible = new Set();
  }

  collisions(key) { return this.cols.get(key); }

  // ------------------------------------------------------------ テクスチャ(共有)
  texture(path, srgb) {
    const key = path + (srgb ? ':s' : ':l');
    if (this.texCache.has(key)) return this.texCache.get(key);
    const t = new THREE.TextureLoader().load('./' + path);
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
      const [gltf, lightMap] = await Promise.all([
        new GLTFLoader().loadAsync('./build/' + man.glb),
        new THREE.TextureLoader().loadAsync('./build/' + man.lightmap.file),
      ]);
      if (rec.cancelled) { disposeTree(gltf.scene); lightMap.dispose(); return rec; }
      lightMap.flipY = false;
      lightMap.channel = man.lightmap.channel;
      lightMap.colorSpace = man.lightmap.encoding === 'srgb' ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
      lightMap.generateMipmaps = true;
      lightMap.minFilter = THREE.LinearMipmapLinearFilter;
      rec.lightMap = lightMap;
      this._prepare(gltf.scene, man, rec);
      rec.group = gltf.scene;
      rec.group.name = 'Floor_' + level;
      // 見せない階は scene から外しておく(描画リスト・影・GTAO の走査に入れない)。setVisible で出し入れする
      if (this.visible.has(level)) this.scene.add(rec.group);
      rec.state = 'ready';
      this._bind(level, rec);
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
    rec.group.removeFromParent();
    for (const g of rec.geoms) g.dispose();
    rec.group.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    for (const m of rec.mats) m.dispose();
    rec.lightMap.dispose();
  }

  isReady(level) { const r = this.floors.get(level); return !!(r && r.state === 'ready'); }

  // プレイヤーの階 ±1 を読み、それ以外を解放。返り値: その階が読めた時に解決
  focus(key) {
    const c = glbLevel(key);
    const want = new Set([c - 1, c, c + 1].filter((l) => l >= 1 && l <= 7));
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
    const GLASS = new Set(['M_WireGlass', 'M_WireGlassOut', 'M_Window', 'M_EVDisplay', 'M_GlassClear']);
    const NO_SHADOW = new Set(['lampcover', 'exitsign_face', 'windowglass', 'void', 'evbutton', 'glass', 'rail', 'backdrop']);
    root.traverse((o) => {
      if (!o.isMesh) return;
      const kind = o.userData.n2_kind || o.parent?.userData.n2_kind || '';
      o.castShadow = !NO_SHADOW.has(kind);
      o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (rec.mats.has(m)) continue;
        rec.mats.add(m);
        const def = (man.materials || {})[m.name];
        if (def) {
          if (def.map) { m.map = this.texture(def.map, true); m.color.setRGB(1, 1, 1); }
          if (def.roughnessMap) { m.roughnessMap = this.texture(def.roughnessMap, false); m.roughness = 1; }
          if (def.normalMap) { m.normalMap = this.texture(def.normalMap, false); const s = def.normalScale ?? 1; m.normalScale.set(s, -s); }
          if (def.emissiveMap) { m.emissiveMap = this.texture(def.emissiveMap, true); m.emissive.setRGB(1, 1, 1); }
          if (def.opacity !== undefined) { m.transparent = true; m.opacity = Math.max(m.opacity < 1 ? m.opacity : def.opacity, 0.08); m.depthWrite = false; }
        }
        // EV の三方枠とカゴの内装は細い面が多くライトマップが数テクセルしかなく、カゴの中から見るとギザギザになる(しかも
        // ベイクはカゴの照明が消えた状態)→ ライトマップを使わず、カゴの照明(elevator.js の PointLight)＋環境光＋懐中電灯で見せる
        m.lightMap = NO_LIGHTMAP.has(m.name) ? null : rec.lightMap;
        m.lightMapIntensity = man.lightmap.intensity * L.lightmapGain;
        m.envMapIntensity = 0;
        if (m.metalness > 0.5 || GLASS.has(m.name)) { m.envMap = this.envTex; m.envMapIntensity = m.metalness > 0.5 ? L.metalEnv : L.glassEnv; }
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
  }

  // 静的メッシュを材質ごとに1つへ(P0 mergeStatic と同じ)。動く扉板(開閉できる扉・EV 扉・自動ドア)だけ残す
  _merge(root, rec) {
    root.updateMatrixWorld(true);
    const isMovable = (o) => {
      for (let p = o; p; p = p.parent) {
        const u = p.userData || {};
        if (u.n2_kind === 'evdoor') return true;
        if ((u.n2_kind === 'door' || u.n2_kind === 'autodoor') && u.n2_operable) return true;
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
    rec.group.traverse((o) => {
      const u = o.userData;
      if (u.n2_kind === 'door' && u.n2_operable) {
        const d = this.doorById.get(String(u.n2_room));
        if (d) { d.node = o; o.rotation.y = d.sign * d.angle; }
      } else if (u.n2_kind === 'autodoor' && u.n2_operable) {
        const d = this.doorById.get(String(u.n2_room));
        if (d) d.leaves.push({ node: o, base: o.position.clone(), dir: new THREE.Vector3().fromArray(u.n2_slide), dist: u.n2_slide_dist });
      } else if (u.n2_kind === 'evdoor') {
        rec.evLeaves.push({ node: o, base: o.position.clone(), dir: new THREE.Vector3().fromArray(u.n2_slide), dist: u.n2_slide_dist });
      }
    });
    for (const d of this.doors) if (d.level === level && d.kind === 'auto') this._applyAuto(d);
  }

  _applyAuto(d) {
    for (const l of d.leaves) l.node.position.copy(l.base).addScaledVector(l.dir, l.dist * d.open01);
  }

  // ------------------------------------------------------------ 扉の毎フレーム(P0 updateDoors＋自動ドア)
  // movers: [{ level, x, z }](プレイヤー・管理人)。自動ドアは同じ階で 1.7m 以内に誰かいれば開く
  updateDoors(dt, movers) {
    const SPEED = 2.4;
    for (const d of this.doors) {
      if (d.kind === 'auto') {
        const near = movers.some((m) => m.level === d.level && Math.hypot(m.x - d.pos[0], m.z - d.pos[1]) < 1.7);
        const want = near && !d.locked ? 1 : 0;
        const nv = d.open01 + Math.sign(want - d.open01) * Math.min(Math.abs(want - d.open01), dt / 1.1);
        if (nv !== d.open01) { d.open01 = nv; this._applyAuto(d); }
        if (d.collision) d.collision.disabled = d.open01 > 0.85;
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
      } else if (d.rattle > 0) {
        d.rattle -= dt;
      }
    }
  }
}

const NO_LIGHTMAP = new Set(['M_EVFrame', 'M_CarBeige', 'M_CarStone', 'M_CarFloor', 'M_CarPanel', 'M_Mirror']);

function disposeTree(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.dispose();
    for (const m of [].concat(o.material)) m.dispose();
  });
}
