// door_fx.js — P5a: 空室(管理人が潜む施錠された部屋)の扉まわりの見た目と「ガタガタ扉」(DESIGN §3.8 A・E)。
//  - 扉の下の隙間: 空室 73 室の扉の下に 1.2cm の暗い帯(階ごとに 1 枚の面に結合)。潜伏中の部屋だけ、帯の明るさがゆっくり揺らぐ
//    (中の弱い明かりを何かが遮っては離れる。歩いていると気付かない程度)
//  - 奥の闇の箱: 空室には内装がないので、扉が開いている間(管理人の出入り)と壊れた後は、戸口の奥 1.25m に暗い箱(床・壁・天井・突き当たり)を置く
//  - 壊れた扉の破片: 戸先側の枠に裂けた木片、廊下の床に木屑。扉が壊れた時に足す(world.breakDoor → onDoorBroken)
//  - ガタガタ扉: 数分に 1 回、プレイヤーから 4〜15m の空室の扉が 3〜5 秒激しく揺れて鳴る。絶対に出てこない。潜伏中の部屋では起こさない
// 実行時の Three.js メッシュだけ(GLB は再ビルドしない)。階ごとの group を world.visible に合わせて出し入れする。

import * as THREE from 'three';
import { levelY, FACING_N } from './world.js';

export const DOORFX = {
  strip: { h: 0.012, y: 0.003, out: 0.003, inset: 0.025 },
  stripBase: [0.0, 0.0, 0.0],                 // ふだんの隙間(真っ暗)
  stripLeak: [0.030, 0.026, 0.022],           // 潜伏中に揺らぐ明るさの最大(線形。露出 4.5 の前)。中の弱い明かりが漏れては遮られる
  stripFade: 2.5,                             // 潜伏が始まって/終わって揺らぎが現れる/消える時間(秒)
  void: { depth: 1.25, h: 2.15, side: 0.12, color: 0x2a2521, back: 0x161311 },
  rattle: { every: [150, 300], first: [90, 160], dur: [3, 5], minDist: 4, maxDist: 15, volume: 1.0 },
};

export class DoorFx {
  // ctx: { scene, world, building, audio(EnemyAudio) }
  constructor(ctx) {
    Object.assign(this, ctx);
    this.groups = new Map();       // level → Group
    this.strips = new Map();       // level → { mesh, ids:[roomId] }
    this.voids = new Map();        // roomId → Group
    this.debris = new Map();       // roomId → Group
    this.events = [];
    this.lurkId = null;            // 潜伏中の部屋(帯が揺らぐ)
    this.lurkAmt = 0;
    this.time = 0;
    this.rattleT = rand(...DOORFX.rattle.first);
    this.rattling = null;
    this._rand = mulberry(4242);
    this.uniforms = {};
    for (const lv of [1, 2, 3, 4, 5, 6, 7]) {
      const g = new THREE.Group(); g.name = 'DoorFx_' + lv;
      this.groups.set(lv, g);
      this.scene.add(g);
      this._buildStrips(lv);
    }
    this.voidMat = new THREE.MeshStandardMaterial({ color: DOORFX.void.color, roughness: 0.95, metalness: 0 });
    this.voidBackMat = new THREE.MeshStandardMaterial({ color: DOORFX.void.back, roughness: 0.97, metalness: 0 });
    this.rawWood = new THREE.MeshStandardMaterial({ color: 0xb89a72, roughness: 0.85 });
    this.doorWood = new THREE.MeshStandardMaterial({ color: 0x5a3a26, roughness: 0.7 });
    // 壊れた扉(死亡から復帰しても残る): 既に壊れていれば破片を作る
    for (const d of this.world.doors) if (d.broken) this.onBroken(d);
  }

  log(ev, extra = {}) { this.events.push({ t: +this.time.toFixed(2), ev, ...extra }); if (this.events.length > 200) this.events.shift(); }

  // ------------------------------------------------------------ 扉の下の隙間(階ごとに 1 枚)
  _buildStrips(lv) {
    const old = this.strips.get(lv);
    if (old) { old.mesh.removeFromParent(); old.mesh.geometry.dispose(); }
    const S = DOORFX.strip, y0 = levelY(lv) + S.y, y1 = y0 + S.h;
    const pos = [], aDoor = [], aU = [], idx = [], ids = [];
    for (const d of this.world.doors) {
      if (d.level !== lv || !d.lurkable || d.broken || !d.collision) continue;
      const c = d.collision, [nx, nz] = FACING_N[d.facing];
      const face = nx < 0 ? c.minX : nx > 0 ? c.maxX : nz < 0 ? c.minZ : c.maxZ;
      const k = ids.length; ids.push(d.roomId);
      const ns = nz !== 0;
      const t0 = (ns ? d.pos[0] : d.pos[1]) - d.width / 2 + S.inset, t1 = t0 + d.width - 2 * S.inset;
      const f = face + (ns ? nz : nx) * S.out;
      const P = (t, y) => (ns ? [t, y, f] : [f, y, t]);
      const base = pos.length / 3;
      for (const [t, y, u] of [[t0, y0, 0], [t1, y0, 1], [t1, y1, 1], [t0, y1, 0]]) { pos.push(...P(t, y)); aDoor.push(k); aU.push(u); }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aDoor', new THREE.Float32BufferAttribute(aDoor, 1));
    g.setAttribute('aU', new THREE.Float32BufferAttribute(aU, 1));
    g.setIndex(idx);
    g.computeBoundingSphere();
    if (!this.stripMat) {
      this.stripUniforms = {
        uTime: { value: 0 }, uLurk: { value: -1 }, uAmt: { value: 0 }, uHide: { value: -1 },
        uBase: { value: new THREE.Vector3(...DOORFX.stripBase) }, uLeak: { value: new THREE.Vector3(...DOORFX.stripLeak) },
      };
    }
    // 階ごとに uniform を分ける(潜伏中の部屋の番号は階の中の番号)
    const u = THREE.UniformsUtils.clone(this.stripUniforms);
    const mat = new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: `attribute float aDoor; attribute float aU; varying float vDoor; varying float vU;
        void main(){ vDoor = aDoor; vU = aU; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uTime; uniform float uLurk; uniform float uAmt; uniform float uHide; uniform vec3 uBase; uniform vec3 uLeak;
        varying float vDoor; varying float vU;
        void main(){
          if (abs(vDoor - uHide) < 0.5) discard;
          vec3 c = uBase;
          if (abs(vDoor - uLurk) < 0.5) {
            // 中の弱い明かりを、ゆっくり動く何か(足)が遮る: 帯に沿って流れる 2 つの影と、全体の呼吸のような強弱
            float w1 = 0.5 + 0.5 * sin(uTime * 0.83 + vU * 5.5);
            float w2 = 0.5 + 0.5 * sin(uTime * 0.37 + 2.1 - vU * 3.2);
            float breathe = 0.5 + 0.5 * sin(uTime * 0.29 + 0.7);
            float lit = smoothstep(0.15, 0.75, w1 * w2 * 0.9 + 0.35 * breathe);
            c += uLeak * uAmt * lit;
          }
          gl_FragColor = vec4(c, 1.0);
        }`,
      fog: false,
    });
    mat.polygonOffset = true; mat.polygonOffsetFactor = -1; mat.polygonOffsetUnits = -1;
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = 'DoorGapStrips_' + lv;
    mesh.frustumCulled = true;
    mesh.renderOrder = 1;
    this.groups.get(lv).add(mesh);
    this.strips.set(lv, { mesh, ids, u });
  }

  // ------------------------------------------------------------ 奥の闇の箱(扉が開いている間・壊れた後)
  _void(d) {
    let g = this.voids.get(d.roomId);
    if (g) return g;
    const V = DOORFX.void;
    const [nx, nz] = FACING_N[d.facing];
    const ns = nz !== 0;
    const w = d.width + 2 * V.side, D = V.depth, H = V.h;
    g = new THREE.Group(); g.name = 'DoorVoid_' + d.roomId;
    // ローカル: +Z = 部屋の奥、X = 扉の幅方向。原点 = 戸口の中心の床
    const mk = (geo, mat, x, y, z, rx, ry) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); m.receiveShadow = true; g.add(m); return m; };
    mk(new THREE.PlaneGeometry(w, D), this.voidMat, 0, 0.004, D / 2 + 0.05, -Math.PI / 2, 0);          // 床
    mk(new THREE.PlaneGeometry(w, D), this.voidMat, 0, H, D / 2 + 0.05, Math.PI / 2, 0);               // 天井
    mk(new THREE.PlaneGeometry(D, H), this.voidMat, -w / 2, H / 2, D / 2 + 0.05, 0, Math.PI / 2);      // 左
    mk(new THREE.PlaneGeometry(D, H), this.voidMat, w / 2, H / 2, D / 2 + 0.05, 0, -Math.PI / 2);      // 右
    mk(new THREE.PlaneGeometry(w, H), this.voidBackMat, 0, H / 2, D + 0.05, 0, Math.PI);               // 突き当たり
    const inward = new THREE.Vector3(-nx, 0, -nz);
    g.position.set(d.pos[0], levelY(d.level), d.pos[1]);
    g.rotation.y = Math.atan2(inward.x, inward.z);
    void ns;
    g.visible = false;
    this.groups.get(d.level).add(g);
    this.voids.set(d.roomId, g);
    return g;
  }

  // ------------------------------------------------------------ 壊れた扉(world.onDoorBroken から)
  onBroken(d) {
    this._buildStrips(d.level);
    this._void(d).visible = true;
    if (this.debris.has(d.roomId)) return;
    const r = mulberry(hashStr(d.roomId));
    const [nx, nz] = FACING_N[d.facing];
    const ns = nz !== 0;
    const tx = ns ? 1 : 0, tz = ns ? 0 : 1;          // 扉の幅方向(蝶番 → 戸先)
    const g = new THREE.Group(); g.name = 'DoorDebris_' + d.roomId;
    const y0 = levelY(d.level);
    const latch = [d.pos[0] + tx * d.width / 2, d.pos[1] + tz * d.width / 2];   // 戸先側の枠
    // 枠の裂け: 受け金の高さに、白っぽい生木の割れ(細い板が廊下側へ反り返る)
    for (let i = 0; i < 9; i++) {
      const len = 0.06 + r() * 0.18, th = 0.006 + r() * 0.01;
      const m = new THREE.Mesh(new THREE.BoxGeometry(th, len, 0.012 + r() * 0.02), i % 3 === 0 ? this.doorWood : this.rawWood);
      const y = y0 + 0.82 + r() * 0.36;
      m.position.set(latch[0] + nx * (0.02 + r() * 0.03) - tx * r() * 0.03, y, latch[1] + nz * (0.02 + r() * 0.03) - tz * r() * 0.03);
      m.rotation.set((r() - 0.5) * 0.9, Math.atan2(nx, nz) + (r() - 0.5) * 0.8, (r() - 0.5) * 0.9);
      m.castShadow = true; m.receiveShadow = true;
      g.add(m);
    }
    // 廊下の床の木屑・塗装片(戸口から 1.3m 以内)
    for (let i = 0; i < 16; i++) {
      const s = 0.012 + r() ** 2 * 0.06;
      const m = new THREE.Mesh(new THREE.BoxGeometry(s, 0.004 + r() * 0.008, s * (0.3 + r() * 0.9)), r() < 0.55 ? this.rawWood : this.doorWood);
      const out = 0.1 + r() * 1.2, side = (r() - 0.3) * 1.1;
      m.position.set(d.pos[0] + nx * out + tx * side, y0 + 0.004, d.pos[1] + nz * out + tz * side);
      m.rotation.y = r() * Math.PI;
      m.receiveShadow = true;
      g.add(m);
    }
    this.groups.get(d.level).add(g);
    this.debris.set(d.roomId, g);
    this.log('broken', { room: d.roomId });
  }
  onRepaired(d) {
    const g = this.debris.get(d.roomId);
    if (g) { g.removeFromParent(); g.traverse((o) => { if (o.isMesh) o.geometry.dispose(); }); this.debris.delete(d.roomId); }
    this._buildStrips(d.level);
  }

  // ------------------------------------------------------------ ガタガタ扉(§3.8 E)
  // 3〜5 秒、扉板が激しく揺れて鳴る。管理人は出てこない(扉は開かない・壊れない)
  rattle(id, dur = rand(...DOORFX.rattle.dur, this._rand)) {
    const d = this.world.doorById.get(String(id));
    if (!d || !d.lurkable || d.broken || d.angle > 0.01 || id === this.lurkId) return false;
    d.shake = dur; d.shakeT = 0; d.shakePhase = this._rand() * 6.28;
    this.rattling = { id: d.roomId, until: this.time + dur };
    if (this.audio) this.audio.play('slam', new THREE.Vector3(d.pos[0], levelY(d.level) + 1.0, d.pos[1]), DOORFX.rattle.volume, { cutoff: 9000, ref: 3.0, dur });
    this.log('rattle', { room: d.roomId, dur: +dur.toFixed(2) });
    return true;
  }
  // 数分に 1 回。プレイヤーの階で、4〜15m の空室の扉(壊れていない・潜伏中でない)
  _scheduleRattle(dt, ctx) {
    if (this.rattling && this.time > this.rattling.until) this.rattling = null;
    if (!ctx || ctx.busy || typeof ctx.level !== 'number') return;
    this.rattleT -= dt;
    if (this.rattleT > 0) return;
    const R = DOORFX.rattle;
    const cands = this.world.doors.filter((d) => d.level === ctx.level && d.lurkable && !d.broken && d.angle < 0.01 && d.roomId !== this.lurkId
      && (() => { const k = Math.hypot(d.pos[0] - ctx.x, d.pos[1] - ctx.z); return k >= R.minDist && k <= R.maxDist; })());
    if (!cands.length) { this.rattleT = 10; return; }
    this.rattle(cands[Math.floor(this._rand() * cands.length)].roomId);
    this.rattleT = rand(...R.every, this._rand);
  }

  // ------------------------------------------------------------ 毎フレーム
  // ctx: { level, x, z, busy }(プレイヤー)。lurkId: 潜伏中の部屋(null)
  update(dt, ctx, lurkId) {
    this.time += dt;
    // 潜伏中の部屋の帯: 現れる/消えるはゆっくり(部屋が変わる時は前の部屋の揺らぎを消してから)
    if (lurkId !== this.lurkId) {
      this.lurkAmt = Math.max(0, this.lurkAmt - dt / DOORFX.stripFade);
      if (this.lurkAmt === 0 || !this.lurkId) this.lurkId = lurkId;
    } else if (lurkId) this.lurkAmt = Math.min(1, this.lurkAmt + dt / DOORFX.stripFade);
    for (const [lv, st] of this.strips) {
      st.u.uTime.value = this.time;
      const li = this.lurkId ? st.ids.indexOf(this.lurkId) : -1;
      st.u.uLurk.value = li; st.u.uAmt.value = li >= 0 ? this.lurkAmt : 0;
      // 扉が開いている(管理人の出入り)間は帯を隠す(扉板が部屋側へ回るので隙間の位置に浮いて見える)
      let hide = -1;
      for (let i = 0; i < st.ids.length; i++) { const d = this.world.doorById.get(st.ids[i]); if (d.angle > 0.02) { hide = i; break; } }
      st.u.uHide.value = hide;
      void lv;
    }
    for (const [id, g] of this.voids) { const d = this.world.doorById.get(id); g.visible = !!d.broken || d.angle > 0.01; }
    for (const [lv, g] of this.groups) g.visible = this.world.visible.has(lv);
    this._scheduleRattle(dt, ctx);
  }
  // 扉が開き始める前に闇の箱を用意する(管理人が空室へ出入りする時)
  prepare(id) { const d = this.world.doorById.get(String(id)); if (d) this._void(d); }

  stats() {
    return { lurkId: this.lurkId, lurkAmt: +this.lurkAmt.toFixed(2), rattleIn: +this.rattleT.toFixed(1), rattling: this.rattling, strips: [...this.strips].map(([lv, s]) => [lv, s.ids.length]), broken: [...this.debris.keys()] };
  }
}

function rand(a, b, r = Math.random) { return a + (b - a) * r(); }
function hashStr(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
