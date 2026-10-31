// rooms.js — P3b: 入れる部屋の仕掛け(掃き出し窓・隠れ場所のクローゼット/ロッカー・触れると落ちる物・屋上A へ乗り越える台)。
//  見た目は階の GLB(build_rooms.py)。窓の障子・折戸・ロッカーの扉は動くノードとして world.js が結び付けて渡す(onBind)。
//  当たりは building.json(walls.js の 'window' 箱・家具の 'furn'/'furnT')。状態は全館ぶん常駐し、GLB を読み直しても保つ。
//  - 掃き出し窓: E で開閉(引き違いの室内側の障子が はめ殺し の前へ滑る)。開いている間は当たりが無効 → バルコニーへ出られる。外からも開く
//  - 隠れる: クローゼット(居室)/ロッカー(管理室)の前で E。中から扉の隙間越しに見る(マウスで少し見回せる)。もう一度 E で出る
//  - 落ちる物: プレイヤーの体(半径 0.28m)が触れると落ちて転がる(約1秒)＋落下音。onNoise で管理人へ(同じ階なら部屋を知られる)
//  - 屋上A: 410/401 のバルコニー北端の隔て板。flags.roofA が真なら室外機(台)の前で E → 室外機に乗る(目線が一段上がる)→ 隔て板を越える →
//    屋上に降りる(偽なら「乗り越えられない」)。屋上側からは逆順(越える→室外機に降りる→バルコニーに降りる)
//  update(dt) 駆動(rAF 非依存。手動ポンプで決定的に動く)。音は WebAudio の仮音(P4 で録音へ差し替え)。

import * as THREE from 'three';
import { levelY } from './world.js';
import { PLAYER } from './player.js';

export const ROOMS = {
  winTime: 0.9,          // 障子の開閉(秒)
  closetTime: 0.55,      // 折戸の開閉(秒)
  closetAngle: 1.5,      // 折戸の外側の板の開き角(rad)。内側の板は逆に 2 倍折れる
  lockerAngle: 1.75,
  reach: 1.25,           // 窓・クローゼットの操作距離
  facing: 0.55,
  touchMargin: 0.08,     // 落ちる物: 体の半径＋この距離で触れたことにする
  fallTime: 1.1,
  vaultTime: 2.05,       // 乗り越え全体(秒)= 下の4区間の和
  vaultSeg: { mount: 0.55, hold: 0.3, over: 0.65, drop: 0.55 },   // 室外機に乗る / 乗って一拍 / 隔て板を越える / 降りる
  vaultClear: 0.27,      // 越える時の足の高さ = 台の天板＋これ(目線は隔て板 1.85m の上)
  hideYaw: 0.75,         // 隠れている間に見回せる左右(rad)
  hidePitch: 0.45,
  eyeY: 1.52,            // 隠れている時の目の高さ
  hideGap: 0.09,         // 隠れている間の扉の開き(隙間越しに部屋が見える)
};
const FACING_VEC = { E: [1, 0], W: [-1, 0], S: [0, 1], N: [0, -1] };

export class Rooms {
  // ctx: { building, world, scene, player, camera, listener, getLevel(), flags, onNoise(fallable), onHide(hidden|null) }
  constructor(ctx) {
    Object.assign(this, ctx);
    this.windows = new Map();
    this.closets = new Map();
    this.fallables = [];
    this.gates = [];
    this.hidden = null;
    this.vault = null;
    this.events = [];
    this.groups = new Map();      // level → THREE.Group(落ちる物)
    for (const f of this.building.floors) {
      if (f.level > 7) continue;
      const lv = f.level;
      const cols = this.world.collisions(lv);
      for (const r of f.rooms) {
        if (r.window && r.window.operable) {
          const box = cols.find((c) => c.kind === 'window' && c.roomId === r.id);
          this.windows.set(r.id, { id: r.id, level: lv, w: r.window, box, node: null, base: null, dir: null, dist: 0, open01: 0, target: 0 });
        }
        const it = r.interior;
        if (!it) continue;
        if (it.hide) this.closets.set(r.id, { id: r.id, level: lv, h: it.hide, nodes: [], open01: 0, target: 0, speed: 1, locker: !!it.hide.locker });
        for (const fl of it.fallables) this.fallables.push({ ...fl, level: lv, state: 'rest', mesh: null, t: 0, vel: new THREE.Vector3(), spin: new THREE.Vector3() });
      }
      for (const g of f.gates || []) this.gates.push({ ...g, level: lv });
    }
    this._buildFallables();
    this._initAudio();
  }

  log(ev, extra = {}) { this.events.push({ ev, ...extra }); if (this.events.length > 300) this.events.shift(); }

  // ------------------------------------------------------------ GLB の動くノード
  onBind(level, binds) {
    for (const b of binds) {
      if (b.kind === 'window') {
        const w = this.windows.get(b.room);
        if (!w) continue;
        w.node = b.node; w.base = b.base; w.dir = b.dir; w.dist = b.dist;
        this._applyWindow(w);
      } else {
        const c = this.closets.get(b.room);
        if (!c) continue;
        if (!c.nodes.some((n) => n.node === b.node)) c.nodes.push({ node: b.node, part: b.part, side: b.side, sign: 0 });
      }
    }
    for (const c of this.closets.values()) if (c.level === level) { this._closetSigns(c); this._applyCloset(c); }
  }
  onUnbind(level) {
    for (const w of this.windows.values()) if (w.level === level) w.node = null;
    for (const c of this.closets.values()) if (c.level === level) c.nodes = [];
  }

  // 扉の板が開いた時に部屋側(正面の向き)へ出るよう、回転の向きを数値で決める
  _closetSigns(c) {
    const F = FACING_VEC[c.h.f];
    for (const n of c.nodes) {
      if (n.part === 'inner') continue;
      const node = n.node;
      node.updateMatrixWorld(true);
      // 板そのもののメッシュだけで中心を出す(子の内側の板は含めない)
      const bb = new THREE.Box3();
      const visit = (o, root) => {
        if (o !== root && o.userData && (o.userData.n2_kind === 'closetdoor' || o.userData.n2_kind === 'lockerdoor')) return;
        if (o.isMesh) { o.geometry.computeBoundingBox(); bb.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld)); }
        for (const ch of o.children) visit(ch, root);
      };
      visit(node, node);
      const ctr = bb.getCenter(new THREE.Vector3());
      const piv = node.getWorldPosition(new THREE.Vector3());
      const rx = ctr.x - piv.x, rz = ctr.z - piv.z;
      // 回転 +θ(y 軸)の微小変位 = (rz, -rx)。正面 F へ出る向きを正にする
      n.sign = (rz * F[0] - rx * F[1]) >= 0 ? 1 : -1;
    }
    for (const n of c.nodes) {
      if (n.part !== 'inner') continue;
      const outer = c.nodes.find((o) => o.part === 'outer' && o.side === n.side);
      n.sign = outer ? -outer.sign : 1;
    }
  }

  _applyWindow(w) {
    if (w.node) w.node.position.copy(w.base).addScaledVector(w.dir, w.dist * w.open01);
    if (w.box) w.box.disabled = w.open01 > 0.85;
  }

  _applyCloset(c) {
    const a = c.open01;
    for (const n of c.nodes) {
      if (c.locker) n.node.rotation.y = n.sign * ROOMS.lockerAngle * a;
      else if (n.part === 'outer') n.node.rotation.y = n.sign * ROOMS.closetAngle * a;
      else n.node.rotation.y = n.sign * 2 * ROOMS.closetAngle * a * 0.92;
    }
  }

  // ------------------------------------------------------------ 操作
  toggleWindow(id) {
    const w = this.windows.get(id);
    if (!w) return false;
    w.target = w.target > 0.5 ? 0 : 1;
    this._sfx('slide', this._winCenter(w));
    this.log('window', { room: id, open: w.target });
    return true;
  }
  _winCenter(w) {
    const lv = levelY(w.level);
    const a = (w.w.open[0] + w.w.open[1]) / 2;
    return w.w.axis === 'x' ? new THREE.Vector3(a, lv + 1.0, w.w.line) : new THREE.Vector3(w.w.line, lv + 1.0, a);
  }
  setWindow(id, open) {
    const w = this.windows.get(id);
    if (!w || (w.target > 0.5) === !!open) return false;
    return this.toggleWindow(id);
  }
  isWindowOpen(id) { const w = this.windows.get(id); return !!(w && w.box && w.box.disabled); }

  openCloset(id, speed = 1) { const c = this.closets.get(id); if (c) { c.target = 1; c.speed = speed; this._sfx('creak', this._closetFront(c, 0)); this.log('closet_open', { room: id }); } }
  closeCloset(id, speed = 1) { const c = this.closets.get(id); if (c) { c.target = 0; c.speed = speed; } }
  _closetFront(c, d = 0.3) {
    const [x0, z0, x1, z1] = c.h.b;
    const F = FACING_VEC[c.h.f];
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const hd = (F[0] ? (x1 - x0) : (z1 - z0)) / 2;
    return new THREE.Vector3(cx + F[0] * (hd + d), levelY(c.level) + 1.0, cz + F[1] * (hd + d));
  }

  // 隠れる/出る
  hide(id) {
    const c = this.closets.get(id);
    if (!c || this.hidden) return false;
    const p = this.player;
    c.revealed = false;
    this.hidden = { room: id, level: c.level, closet: c, t: 0, phase: 'in', from: p.object.position.clone(), yaw: c.h.yaw };
    p.frozen = true;
    p.hidden = { room: id, level: c.level, stand: c.h.stand, feet: c.h.feet };
    this.openCloset(id, 1.6);
    this.log('hide', { room: id });
    if (this.onHide) this.onHide(p.hidden);
    return true;
  }
  unhide() {
    const H = this.hidden;
    if (!H || H.phase === 'out') return false;
    H.phase = 'out'; H.t = 0;
    this.openCloset(H.room, 1.6);
    this.log('unhide', { room: H.room });
    return true;
  }
  forceUnhide() {   // 死亡・チェックポイント復帰
    if (!this.hidden) return;
    const c = this.hidden.closet;
    c.open01 = 0; c.target = 0; c.revealed = false; this._applyCloset(c);
    this.hidden = null;
    this.player.hidden = null;
    if (this.onHide) this.onHide(null);
  }

  // ------------------------------------------------------------ 画面ガイドの対象(main の extraTarget から)
  target(level) {
    const p = this.player.pos, cam = this.camera;
    if (this.vault) return null;
    if (this.hidden) return this.hidden.phase === 'hidden' ? { kind: 'unhide', room: this.hidden.room } : null;
    const fwd = cam.getWorldDirection(new THREE.Vector3()); fwd.y = 0; fwd.normalize();
    const look = (x, z, reach) => {
      const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
      if (d > reach) return -1;
      return (dx * fwd.x + dz * fwd.z) / Math.max(d, 1e-4) >= ROOMS.facing ? d : -1;
    };
    let best = null, bd = 1e9;
    for (const g of this.gates) {
      if (g.level !== level) continue;
      const [x, z, w, d] = g.rect;
      // バルコニー側からは台(室外機)を、屋上側からは隔て板を見て E
      const balSide = p.z > z + d / 2;
      const [sx0, sz0, sx1, sz1] = g.step;
      const dd = balSide ? look((sx0 + sx1) / 2, (sz0 + sz1) / 2, 1.1) : look(x + w / 2, z + d / 2, 1.3);
      if (dd >= 0 && dd < bd) { bd = dd; best = { kind: 'gate', gate: g }; }
    }
    for (const w of this.windows.values()) {
      if (w.level !== level) continue;
      const c = this._winCenter(w);
      const dd = look(c.x, c.z, ROOMS.reach);
      if (dd >= 0 && dd < bd) { bd = dd; best = { kind: 'window', win: w, open: w.target > 0.5 }; }
    }
    for (const c of this.closets.values()) {
      if (c.level !== level) continue;
      const f = this._closetFront(c, 0.0);
      const dd = look(f.x, f.z, ROOMS.reach);
      if (dd >= 0 && dd < bd) { bd = dd; best = { kind: 'closet', closet: c }; }
    }
    return best;
  }

  use(t) {
    if (!t) return null;
    if (t.kind === 'window') { this.toggleWindow(t.win.id); return 'window'; }
    if (t.kind === 'closet') { this.hide(t.closet.id); return 'hide'; }
    if (t.kind === 'unhide') { this.unhide(); return 'unhide'; }
    if (t.kind === 'gate') {
      if (!this.flags.roofA) { this.log('gate_blocked', { gate: t.gate.id }); return 'blocked'; }
      this._startVault(t.gate);
      return 'vault';
    }
    return null;
  }

  // ------------------------------------------------------------ 屋上A へ乗り越える
  // P3b-2: 区間ごとの動き。up = 目線が先に上がる(足を掛けて体を持ち上げる)/ down = 最後に落ちる(飛び降りる)/ flat = なめらか
  //  バルコニー → 屋上: 台の前 →[mount up]→ 室外機の天板 →[hold]→ 同じ所(一拍)→[over up]→ 隔て板の上 →[drop down]→ 屋上
  //  屋上 → バルコニー: 逆順(隔て板の上 → 室外機の天板 → 一拍 → バルコニーの床)
  _startVault(g) {
    const p = this.player;
    const [sx0, sz0, sx1, sz1] = g.step;
    const lineZ = g.rect[1] + g.rect[3] / 2;
    const onBalcony = p.pos.z > lineZ;
    const y = levelY(g.level);
    const stepTop = g.stepTop || 0.6;
    const S = ROOMS.vaultSeg;
    const stepC = new THREE.Vector3(THREE.MathUtils.clamp(p.pos.x, sx0 + 0.25, sx1 - 0.25), y + stepTop, (sz0 + sz1) / 2);
    const over = new THREE.Vector3((g.over.from[0] + g.over.to[0]) / 2, y + stepTop + ROOMS.vaultClear, lineZ);
    const dst = onBalcony ? new THREE.Vector3(g.over.to[0], y, g.over.to[1]) : new THREE.Vector3(g.over.from[0], y, g.over.from[1]);
    const start = p.pos.clone();
    const segs = onBalcony
      ? [{ to: stepC, d: S.mount, ease: 'up', ev: 'vault_on_step' }, { to: stepC, d: S.hold, ease: 'flat' }, { to: over, d: S.over, ease: 'up', ev: 'vault_over' }, { to: dst, d: S.drop, ease: 'down' }]
      : [{ to: over, d: S.over, ease: 'up', ev: 'vault_over' }, { to: stepC, d: S.mount, ease: 'down', ev: 'vault_on_step' }, { to: stepC, d: S.hold, ease: 'flat' }, { to: dst, d: S.drop, ease: 'down' }];
    this.vault = { g, from: start, segs, i: 0, t: 0, total: 0, dst, toRoof: onBalcony };
    p.frozen = true;
    this._sfx('climb', stepC);
    this.log('vault_start', { gate: g.id, toRoof: onBalcony });
  }

  _updateVault(dt) {
    const V = this.vault;
    V.t += dt; V.total += dt;
    let sg = V.segs[V.i];
    while (V.t >= sg.d && V.i < V.segs.length - 1) {
      V.t -= sg.d; V.from = sg.to.clone();
      if (sg.ev) this.log(sg.ev, { gate: V.g.id, y: +(sg.to.y - levelY(V.g.level)).toFixed(2), z: +sg.to.z.toFixed(2) });
      if (sg.ev === 'vault_on_step') this._sfx('climb', sg.to);
      V.i++; sg = V.segs[V.i];
    }
    const u = Math.min(1, V.t / sg.d);
    const sm = u * u * (3 - 2 * u);
    const yk = sg.ease === 'up' ? 1 - (1 - u) * (1 - u) * (1 - u) : sg.ease === 'down' ? u * u : sm;
    const a = V.from, b = sg.to;
    const pos = new THREE.Vector3(a.x + (b.x - a.x) * sm, a.y + (b.y - a.y) * yk, a.z + (b.z - a.z) * sm);
    // 乗って一拍の間は膝で受けて少し沈む
    const bob = sg.ease === 'flat' && V.i > 0 ? -Math.sin(u * Math.PI) * 0.06 : 0;
    this.player.placeAt(pos.x, pos.y, pos.z, bob);
    const k = V.i === V.segs.length - 1 && u >= 1 ? 1 : 0;
    if (k >= 1) {
      this.player.frozen = false;
      this.player.placeAt(V.dst.x, V.dst.y, V.dst.z, 0);
      this.log('vault_end', { gate: V.g.id, toRoof: V.toRoof, x: +V.dst.x.toFixed(2), z: +V.dst.z.toFixed(2) });
      this.vault = null;
    }
  }

  // ------------------------------------------------------------ 毎フレーム
  update(dt, level) {
    for (const w of this.windows.values()) {
      if (w.open01 !== w.target) {
        w.open01 += Math.sign(w.target - w.open01) * Math.min(Math.abs(w.target - w.open01), dt / ROOMS.winTime);
        this._applyWindow(w);
      }
    }
    for (const c of this.closets.values()) {
      if (c.open01 !== c.target) {
        c.open01 += Math.sign(c.target - c.open01) * Math.min(Math.abs(c.target - c.open01), dt * c.speed / ROOMS.closetTime);
        this._applyCloset(c);
      }
    }
    if (this.vault) this._updateVault(dt);
    if (this.hidden) this._updateHidden(dt);
    this._updateFallables(dt, level);
  }

  _updateHidden(dt) {
    const H = this.hidden, c = H.closet, p = this.player, cam = this.camera;
    const y = levelY(c.level);
    const eye = new THREE.Vector3(c.h.eye[0], y + ROOMS.eyeY, c.h.eye[1]);
    const out = new THREE.Vector3(c.h.out[0], y + PLAYER.height, c.h.out[1]);
    H.t += dt;
    if (H.phase === 'in') {
      const k = Math.min(1, H.t / 0.7);
      const s = k * k * (3 - 2 * k);
      cam.position.lerpVectors(H.from, eye, s);
      if (k >= 1) { H.phase = 'hidden'; this.closeCloset(c.id, 1.4); p.pos.set(c.h.feet[0], y, c.h.feet[1]); cam.rotation.set(0, H.yaw, 0, 'YXZ'); }
    } else if (H.phase === 'hidden') {
      cam.position.copy(eye);
      // 見回しは扉の方向の ±hideYaw まで
      const e = cam.rotation;
      let dy = e.y - H.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
      e.y = H.yaw + THREE.MathUtils.clamp(dy, -ROOMS.hideYaw, ROOMS.hideYaw);
      e.x = THREE.MathUtils.clamp(e.x, -ROOMS.hidePitch, ROOMS.hidePitch);
      // 管理人に開けられた(演出②)後も目線はここ。扉は閉じ切らず隙間を残す(hideGap)
      if (c.target === 0 && c.open01 < ROOMS.hideGap && !c.revealed) { c.open01 = ROOMS.hideGap; c.target = ROOMS.hideGap; this._applyCloset(c); }
    } else if (H.phase === 'out') {
      const k = Math.min(1, H.t / 0.7);
      const s = k * k * (3 - 2 * k);
      cam.position.lerpVectors(eye, out, s);
      if (k >= 1) {
        p.frozen = false;
        p.setPose(out.x, out.z, H.yaw, 0);
        this.closeCloset(c.id, 1.2);
        this.hidden = null;
        p.hidden = null;
        if (this.onHide) this.onHide(null);
      }
    }
    cam.updateMatrixWorld();
  }

  // ------------------------------------------------------------ 落ちる物
  _buildFallables() {
    const M = (color, rough = 0.5, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    const mats = {
      vase: M(0x3a5a76, 0.25), can: M(0xa7aaae, 0.3, 0.9), book: [M(0x7a2f2a, 0.7), M(0x2f4a6a, 0.7), M(0xc7a24a, 0.7)],
      bottle: new THREE.MeshStandardMaterial({ color: 0xc8d8e0, roughness: 0.15, transparent: true, opacity: 0.55 }), mug: M(0xe7e4dc, 0.3),
      binder: [M(0x2c3850, 0.6), M(0x3d5b46, 0.6), M(0x6c7075, 0.6)], cup: M(0xe7e4dc, 0.35),
    };
    for (const f of this.fallables) {
      const g = new THREE.Group();
      let r = 0.06, h = 0.12;
      if (f.type === 'vase') {
        const prof = [[0, 0], [0.05, 0], [0.065, 0.04], [0.07, 0.1], [0.05, 0.19], [0.03, 0.24], [0.036, 0.28], [0.03, 0.28]].map(([x, y]) => new THREE.Vector2(x, y));
        const m = new THREE.Mesh(new THREE.LatheGeometry(prof, 18), mats.vase); g.add(m);
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.22, 4), M(0x3c5a30, 0.8)); stem.position.y = 0.36; stem.rotation.z = 0.15; g.add(stem);
        r = 0.07; h = 0.28;
      } else if (f.type === 'cans') {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.122, 14), mats.can); m.position.y = 0.061; g.add(m);
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0335, 0.0335, 0.05, 14, 1, true), M(0x93302b, 0.4, 0.6)); band.position.y = 0.06; g.add(band);
        r = 0.035; h = 0.122;
      } else if (f.type === 'books') {
        for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.03, 0.21), mats.book[i]); m.position.set((i - 1) * 0.008, 0.015 + i * 0.031, (i % 2) * 0.01); m.rotation.y = (i - 1) * 0.12; g.add(m); }
        r = 0.11; h = 0.095;
      } else if (f.type === 'bottle') {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.036, 0.24, 12), mats.bottle); m.position.y = 0.12; g.add(m);
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.02, 8), M(0xe0e0e0, 0.4)); cap.position.y = 0.25; g.add(cap);
        r = 0.036; h = 0.26;
      } else if (f.type === 'mug' || f.type === 'cup') {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.036, 0.095, 16), mats.mug); m.position.y = 0.048; g.add(m);
        const hd = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.006, 6, 12), mats.mug); hd.position.set(0.045, 0.05, 0); hd.rotation.y = Math.PI / 2; g.add(hd);
        r = 0.045; h = 0.095;
      } else if (f.type === 'binders') {
        for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.24), mats.binder[i]); m.position.set((i - 1) * 0.065, 0.15, 0); g.add(m); }
        r = 0.11; h = 0.3;
      }
      g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      g.position.set(f.x, levelY(f.level) + f.y, f.z);
      g.rotation.y = (f.id.length * 1.7) % 3.1;
      g.name = 'Fallable_' + f.id;
      f.mesh = g; f.r = r; f.h = h;
      f.rest = { pos: g.position.clone(), rot: g.rotation.clone() };
      if (!this.groups.has(f.level)) this.groups.set(f.level, new THREE.Group());
      this.groups.get(f.level).add(g);
    }
  }

  // 見せる階に合わせて scene へ出し入れ(world.visible と同じ)
  syncVisible(visible) {
    for (const [lv, g] of this.groups) {
      const want = visible.has(lv);
      if (want && g.parent !== this.scene) this.scene.add(g);
      else if (!want && g.parent) g.removeFromParent();
    }
  }

  knock(f, from) {
    if (f.state !== 'rest') return;
    f.state = 'fall'; f.t = 0;
    const d = new THREE.Vector3(f.mesh.position.x - from.x, 0, f.mesh.position.z - from.z);
    if (d.lengthSq() < 1e-6) d.set(1, 0, 0);
    d.normalize();
    f.vel.set(d.x * 0.9, f.y > 0.1 ? 0.6 : 0.4, d.z * 0.9);
    f.spin.set(d.z * 7, (Math.random() - 0.5) * 3, -d.x * 7);
    f.hitFloor = false;
    this.log('knock', { id: f.id, room: f.room, type: f.type });
  }

  _updateFallables(dt, level) {
    const p = this.player.pos;
    const touch = PLAYER.radius + ROOMS.touchMargin;
    for (const f of this.fallables) {
      if (f.state === 'rest') {
        if (f.level !== level || this.hidden || this.vault) continue;
        const m = f.mesh.position;
        const dy = m.y - p.y;
        if (dy > 1.4 || dy < -0.2) continue;
        if (Math.hypot(m.x - p.x, m.z - p.z) < touch + f.r * 0.5) this.knock(f, p);
        continue;
      }
      if (f.state !== 'fall') continue;
      f.t += dt;
      const floorY = levelY(f.level);
      const m = f.mesh;
      f.vel.y -= 9.8 * dt;
      const nx = m.position.x + f.vel.x * dt, nz = m.position.z + f.vel.z * dt;
      if (this._hitsWall(f.level, nx, nz, m.position.y, f.r * 0.6)) { f.vel.x *= -0.3; f.vel.z *= -0.3; }
      else { m.position.x = nx; m.position.z = nz; }
      m.position.y += f.vel.y * dt;
      m.rotation.x += f.spin.x * dt; m.rotation.y += f.spin.y * dt; m.rotation.z += f.spin.z * dt;
      if (m.position.y <= floorY + 0.02) {
        m.position.y = floorY + 0.02;
        if (!f.hitFloor) {
          f.hitFloor = true;
          this._sfx('fall_' + f.type, m.position.clone());
          this.log('fall_sound', { id: f.id, room: f.room, type: f.type });
          if (this.onNoise) this.onNoise(f);
        }
        f.vel.y = Math.abs(f.vel.y) > 0.6 ? -f.vel.y * 0.25 : 0;
        f.vel.x *= 0.92; f.vel.z *= 0.92;
        f.spin.multiplyScalar(0.9);
        // 円柱(缶・瓶・花瓶・マグ)は横倒しで転がる
        if (['cans', 'bottle', 'vase', 'mug', 'cup'].includes(f.type)) { m.rotation.x += (Math.PI / 2 - m.rotation.x) * 0.2; }
      }
      if (f.t >= ROOMS.fallTime) { f.state = 'down'; f.vel.set(0, 0, 0); m.position.y = Math.max(m.position.y, floorY + 0.02); }
    }
  }

  _hitsWall(level, x, z, y, r) {
    for (const c of this.world.collisions(level)) {
      if (c.disabled || c.kind === 'enemy' || c.kind === 'stairguard') continue;
      if (c.y0 !== undefined && (y > c.y1 || y < c.y0 - 0.1)) continue;
      if (x + r > c.minX && x - r < c.maxX && z + r > c.minZ && z - r < c.maxZ) return true;
    }
    return false;
  }

  resetFallables() {
    for (const f of this.fallables) { f.state = 'rest'; f.mesh.position.copy(f.rest.pos); f.mesh.rotation.copy(f.rest.rot); }
  }

  // ------------------------------------------------------------ 音(仮。P4 で録音: room_window_slide_01 / room_closet_01 / room_fall_<type>_01 / room_climb_01)
  _initAudio() {
    const ctx = this.listener ? this.listener.context : null;
    if (!ctx) return;
    this.ac = ctx;
    const sr = ctx.sampleRate;
    const rnd = (seed) => { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };
    const mk = (sec, fn, seed = 3) => { const b = ctx.createBuffer(1, Math.floor(sr * sec), sr); const d = b.getChannelData(0); const r = rnd(seed); for (let i = 0; i < d.length; i++) d[i] = fn(i / sr, r); return b; };
    let lp = 0;
    this.bufs = {
      slide: mk(0.9, (t, r) => { lp += ((r() - 0.5) - lp) * 0.08; return lp * 0.5 * Math.min(1, t * 8) * Math.max(0, 1 - t / 0.9) + Math.sin(2 * Math.PI * 60 * t) * 0.02 * (t < 0.85 ? 1 : 0); }, 5),
      creak: mk(0.6, (t, r) => (Math.sin(2 * Math.PI * (380 + 120 * Math.sin(t * 9)) * t) * 0.12 + (r() - 0.5) * 0.05) * Math.exp(-t * 3), 7),
      climb: mk(0.8, (t, r) => ((r() - 0.5) * 0.25 * Math.exp(-((t - 0.15) ** 2) / 0.002) + (r() - 0.5) * 0.2 * Math.exp(-((t - 0.55) ** 2) / 0.003)), 9),
      fall_vase: mk(1.2, (t, r) => (Math.sin(2 * Math.PI * 1320 * t) * 0.4 + Math.sin(2 * Math.PI * 2210 * t) * 0.25 + (r() - 0.5) * 0.6 * Math.exp(-t * 30)) * Math.exp(-t * 6) * 0.8, 11),
      fall_cans: mk(1.2, (t, r) => { const hits = [0, 0.18, 0.31, 0.42]; let v = 0; for (const h of hits) if (t >= h) v += Math.sin(2 * Math.PI * (2600 - h * 900) * (t - h)) * Math.exp(-(t - h) * 40) * 0.5; return v + (r() - 0.5) * 0.08 * Math.exp(-t * 2) * (t < 1.1 ? 1 : 0); }, 13),
      fall_books: mk(0.5, (t, r) => (Math.sin(2 * Math.PI * 90 * t) * Math.exp(-t * 25) + (r() - 0.5) * 0.7 * Math.exp(-t * 35)) * 0.8, 17),
      fall_bottle: mk(0.7, (t, r) => (Math.sin(2 * Math.PI * 420 * t) * Math.exp(-t * 18) * 0.6 + (r() - 0.5) * 0.3 * Math.exp(-t * 20) + Math.sin(2 * Math.PI * 380 * (t - 0.22)) * (t > 0.22 ? Math.exp(-(t - 0.22) * 22) : 0) * 0.3), 19),
      fall_mug: mk(0.8, (t, r) => (Math.sin(2 * Math.PI * 1900 * t) * 0.35 + Math.sin(2 * Math.PI * 3100 * t) * 0.2 + (r() - 0.5) * 0.5 * Math.exp(-t * 40)) * Math.exp(-t * 9) * 0.8, 23),
      fall_binders: mk(0.5, (t, r) => (Math.sin(2 * Math.PI * 110 * t) * Math.exp(-t * 22) + (r() - 0.5) * 0.6 * Math.exp(-t * 30)) * 0.9, 29),
    };
    this.bufs.fall_cup = this.bufs.fall_mug;
    // 風(屋上A・バルコニー)。低いうなりと、ときどき強まる吹き。ループ 9 秒(room_wind_loop_01)
    {
      const n = Math.floor(sr * 9), b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0), r = rnd(41);
      let a = 0, c = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        a += ((r() - 0.5) - a) * 0.02; c += (a - c) * 0.05;
        const gust = 0.55 + 0.45 * Math.sin(2 * Math.PI * t / 9) ** 2 + 0.15 * Math.sin(2 * Math.PI * t * 0.37);
        d[i] = (c * 6 + a * 1.5) * gust;
      }
      for (let i = 0; i < 2000; i++) { const k = i / 2000; d[i] = d[i] * k + d[n - 2000 + i] * (1 - k); }
      this.wind = { src: null, gain: ctx.createGain(), buf: b, level: 0 };
      this.wind.gain.gain.value = 0;
      this.wind.gain.connect(this.listener.getInput ? this.listener.getInput() : ctx.destination);
    }
    this.pool = Array.from({ length: 4 }, () => {
      const a = new THREE.PositionalAudio(this.listener);
      a.setRefDistance(1.2); a.setRolloffFactor(1.2);
      return a;
    });
    this.poolIdx = 0;
  }
  _sfx(name, pos) {
    this.log('sfx', { name });
    if (!this.ac || this.ac.state !== 'running' || !this.bufs[name]) return;
    const a = this.pool[this.poolIdx++ % this.pool.length];
    if (a.isPlaying) a.stop();
    if (!a.parent) this.scene.add(a);
    a.position.copy(pos); a.updateMatrixWorld();
    a.setBuffer(this.bufs[name]); a.setVolume(name.startsWith('fall') ? 1.0 : 0.6);
    try { a.play(); } catch (e) { /* suspended */ }
  }

  // 風の音: where = 'roofA' | 'balcony' | null(屋内)
  updateWind(dt, where) {
    const W = this.wind;
    if (!W || !this.ac || this.ac.state !== 'running') return;
    if (!W.src) { W.src = this.ac.createBufferSource(); W.src.buffer = W.buf; W.src.loop = true; W.src.connect(W.gain); W.src.start(); }
    const want = where === 'roofA' ? 0.32 : where === 'balcony' ? 0.12 : 0;
    W.level += (want - W.level) * Math.min(1, dt * 1.5);
    W.gain.gain.setTargetAtTime(W.level, this.ac.currentTime, 0.1);
    this.windWhere = where;
  }

  state() {
    return {
      hidden: this.hidden ? { room: this.hidden.room, phase: this.hidden.phase } : null,
      vault: !!this.vault,
      openWindows: [...this.windows.values()].filter((w) => w.open01 > 0.5).map((w) => w.id),
      fallen: this.fallables.filter((f) => f.state !== 'rest').map((f) => f.id),
    };
  }
}
