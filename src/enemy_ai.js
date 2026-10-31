// enemy_ai.js — 管理人の AI(P2b)。前作 tenko/src/phantom.js の状態機械と知覚を移植・簡素化。
//  状態: PATROL / ALERT / CHASE / ATTACK / SCRIPTED
//  知覚: 視錐(半頂角45°・距離は懐中電灯/しゃがみ/静止で段階)＋遮蔽(壁箱・閉扉の XZ 線分判定)＋聴覚半径
//        (走り 12m / 歩き 6m / しゃがみ 2.4m / 扉操作 9m)。phantom.js の _visionCheck を移植。
//        遮蔽はメッシュではなく当たり判定の箱(building.json 由来=データが真実)に対して取る(結合済みメッシュより軽く正確)。
//  経路: P0 は直線廊下＋EVホールなので、廊下軸上の点列＋410 室内の点のグラフ(ダイクストラ＋見通しで間引き)。
//  鍵で入室: 施錠扉の前で「鍵束→錠」→ door_open_in で扉を押し開けて入る(ルートモーション)。
//  行動はジェネレータ(=update(dt) ごとに 1 歩進むコルーチン)で書く。setTimeout 非依存なので手動ポンプで決定的に進む。

import * as THREE from 'three';
import { segmentHitT } from './enemy.js';

export const AI = {
  radius: 0.30,
  eyeY: 1.62,
  speed: { PATROL: 0.62, ALERT: 1.35, CHASE: 3.2, SCRIPTED: 1.0 },
  clip: { PATROL: 'walk_oldman', ALERT: 'walk_hurried', CHASE: 'run_intent', SCRIPTED: 'walk_standard' },
  turnRate: { PATROL: 2.2, ALERT: 3.5, CHASE: 7.0, SCRIPTED: 3.0 },
  vision: {
    flashlight: 18.0,      // 懐中電灯 ON: 視錐内・遮蔽なしなら廊下全長級
    darkBase: 5.0,         // OFF・立って移動
    darkCrouch: 3.5,       // OFF・しゃがみ
    darkStill: 2.5,        // OFF・静止
    halfAngle: Math.PI / 4,
    rayEvery: 0.12,
  },
  hear: { run: 12.0, walk: 6.0, crouch: 2.4, door: 9.0, occludedMul: 0.6 },
  proximity: 2.0,          // この距離で遮蔽なしなら視線問わず気づく
  attackRange: 1.4,        // CHASE でこの距離 → ATTACK
  hitRange: 1.9,           // 振り下ろしの瞬間にこの距離以内なら命中
  hitTime: 0.85,           // attack_downward の振り下ろし(右手が最も前に出る ≈ f25)
  windup: 0.8,             // 振りかぶり区間(attack 表情 1.0 に同期)
  chaseLose: 6.0,
  alertSearch: 12.0,
  door: {
    startDist: 0.54,       // door_open_in 開始時の本体と扉面(廊下側)の距離。手が f50〜90 で ≈0.5m 先に届く
    lateral: 0.14,         // 右手(押す手)がノブ側に来るよう扉中心からずらす量
    openAt: 2.55,          // door_open_in 再生開始から扉が動き出すまで(秒、f77)
    openSpeed: 2.6,        // 敵が押すときの扉の速さ倍率
    keysTime: 1.6,
    lockTime: 0.7,
  },
};

const NODES = {
  N0: [6.9, 6.3], C1: [6.9, 7.38], C2: [6.9, 10.15], C3: [6.9, 13.05], C4: [6.9, 15.95], C5: [6.9, 18.85],
  J: [6.9, 21.2], JE: [8.2, 21.2], EV: [6.95, 21.75], R: [8.75, 7.38],
};
const EDGES = [['N0', 'C1'], ['C1', 'C2'], ['C2', 'C3'], ['C3', 'C4'], ['C4', 'C5'], ['C5', 'J'], ['J', 'JE'], ['J', 'EV'], ['C1', 'R', '410']];

export class EnemyAI {
  // ctx: { enemy, audio, player, collisions, doors(API), doorInfo[], floorY, onKill }
  constructor(ctx) {
    Object.assign(this, ctx);
    this.state = 'PATROL';
    this.task = null;
    this.time = 0;
    this.dt = 0;
    this.events = [];
    this.lastKnown = null;
    this.canSee = false;
    this.heard = false;
    this.occluded = false;
    this._rayTimer = 0;
    this._prevPlayer = new THREE.Vector3().copy(this.player.pos);
    this.playerMoving = false;
    this.uninterruptible = false;
    this.pending = null;
    this.perception = true;
    this.patrolIdx = 0;
    this._rand = mulberry(1234);
    this.selfBox = { minX: 0, maxX: 0, minZ: 0, maxZ: 0, y0: -1e9, y1: 1e9, kind: 'enemy', roomId: null, disabled: false };
    this.collisions.push(this.selfBox);
    this.enemy.onFootstep = (foot, pos) => {
      if (!this.audio) return;
      const run = this.enemy.current === 'run_intent';
      this.audio.play('step', pos, run ? 1.0 : (this.state === 'PATROL' ? 0.6 : 0.8));
    };
    this.setState('PATROL');
  }

  log(ev, extra = {}) {
    this.events.push({ t: +this.time.toFixed(3), ev, state: this.state, ...extra });
    if (this.events.length > 400) this.events.shift();
  }

  // ------------------------------------------------------------ 状態
  setState(s, opts = {}) {
    if (this.uninterruptible && !opts.force) { this.pending = [s, opts]; return; }
    this.pending = null;
    this.uninterruptible = false;
    const prev = this.state;
    this.state = s;
    this.stateTime = 0;
    this.enemy.aimPoint = null;
    if (s !== 'CHASE' && s !== 'ATTACK') this.enemy.setFace('grin', 0);
    if (s !== 'ATTACK') this.enemy.setFace('attack', 0);
    const gen = {
      PATROL: () => this._patrol(),
      ALERT: () => this._alert(opts),
      CHASE: () => this._chase(),
      ATTACK: () => this._attack(),
      SCRIPTED: () => this._scripted(opts),
    }[s];
    this.task = gen ? gen() : null;
    if (this.audio) this.audio.setState(s);
    if (prev !== s || opts.log) this.log('state', { from: prev, to: s });
  }

  reset(x, z, yaw) {
    this.uninterruptible = false;
    this.pending = null;
    this.enemy.place(x, z, yaw);
    this.enemy.setFace('grin', 0, true);
    this.enemy.setFace('attack', 0, true);
    this.lastKnown = null;
    this.canSee = false;
    this.inProximity = false;
    this.heard = false;
    this._noise = null;
    this._rayTimer = 0;
    this._prevPlayer.copy(this.player.pos);
    this.setState('PATROL', { force: true, log: true });
  }

  // ------------------------------------------------------------ update
  update(dt) {
    if (!this.enemy.ready) return;
    this.dt = dt;
    this.time += dt;
    this.stateTime += dt;
    this._trackPlayer(dt);
    if (this.perception && this.state !== 'SCRIPTED' && this.state !== 'DEAD') this._perceive(dt);
    else this._updateOcclusionOnly(dt);
    if (this.pending && !this.uninterruptible) { const [s, o] = this.pending; this.pending = null; this.setState(s, o); }
    if (this.task) {
      const r = this.task.next();
      if (r.done) {
        this.task = null;
        if (this.state !== 'SCRIPTED' && this.state !== 'DEAD') this.setState('PATROL');
      }
    }
    const p = this.enemy.pos;
    const r = AI.radius * 0.9;
    Object.assign(this.selfBox, { minX: p.x - r, maxX: p.x + r, minZ: p.z - r, maxZ: p.z + r, y0: p.y, y1: p.y + 1.8 });
    this.selfBox.disabled = this.state === 'DEAD';
    if (this.audio) this.audio.setOccluded(this.occluded);
  }

  _trackPlayer(dt) {
    const p = this.player.pos;
    const v = Math.hypot(p.x - this._prevPlayer.x, p.z - this._prevPlayer.z) / Math.max(dt, 1e-4);
    this._prevPlayer.copy(p);
    const teleport = v > 8.0;          // setPose/復帰などの瞬間移動は「動いた音」にしない
    this.playerMoving = !teleport && v > 0.25;
    this.playerSpeed = teleport ? 0 : v;
  }

  // ------------------------------------------------------------ 知覚(phantom.js _updatePerception / _visionCheck の移植)
  _updateOcclusionOnly(dt) {
    this._rayTimer -= dt;
    if (this._rayTimer > 0) return;
    this._rayTimer = AI.vision.rayEvery;
    this.occluded = this._blocked(this.player.pos);
  }

  _perceive(dt) {
    const p = this.player.pos;
    const e = this.enemy.pos;
    const dist = Math.hypot(p.x - e.x, p.z - e.z);
    this._rayTimer -= dt;
    if (this._rayTimer <= 0) {
      this._rayTimer = AI.vision.rayEvery;
      this.occluded = this._blocked(p);
      this.canSee = !this.occluded && this._inVision(p, dist);
      this.inProximity = !this.occluded && dist <= AI.proximity;
    }
    // 聴覚
    let hearR = 0;
    if (this.playerMoving) {
      const k = this.player.keys;
      const run = k && (k.has('ShiftLeft') || k.has('ShiftRight')) && !this.player.crouch && this.playerSpeed > 2.0;
      hearR = this.player.crouch ? AI.hear.crouch : run ? AI.hear.run : AI.hear.walk;
      if (this.occluded) hearR *= AI.hear.occludedMul;
    }
    this.heard = dist <= hearR;
    if (this._noise) { // 扉操作などの一時的な音
      const n = this._noise; this._noise = null;
      if (Math.hypot(n.x - e.x, n.z - e.z) <= n.r) { this.heard = true; this._heardAt = { x: n.x, z: n.z }; this.log('heard_noise', { r: n.r }); }
    }
    if (this.state === 'DEAD') return;
    if (this.canSee || this.inProximity) {
      this.lastKnown = { x: p.x, z: p.z };
      this.lastSeenTime = this.time;
      if ((this.state === 'PATROL' || this.state === 'ALERT') && !(this.pending && this.pending[0] === 'CHASE')) { this.log('seen', { dist: +dist.toFixed(2) }); this.setState('CHASE'); }
    } else if (this.heard) {
      const at = this._heardAt || { x: p.x, z: p.z };
      this._heardAt = null;
      this.lastKnown = { x: at.x, z: at.z };
      this.lastHeardTime = this.time;
      if (this.state === 'PATROL' && !this.pending) { this.log('heard', { dist: +dist.toFixed(2) }); this.setState('ALERT', { react: true }); }
    }
  }

  _inVision(p, dist) {
    const V = AI.vision;
    let range;
    if (this.player.flashlightOn) range = V.flashlight;
    else if (!this.playerMoving) range = V.darkStill;
    else if (this.player.crouch) range = V.darkCrouch;
    else range = V.darkBase;
    if (dist > range) return false;
    const e = this.enemy;
    const ang = Math.atan2(p.x - e.pos.x, p.z - e.pos.z);
    if (Math.abs(wrap(ang - e.yaw)) > V.halfAngle) return false;
    return true;
  }

  // 敵の目 → プレイヤーの胸 の線分が壁箱・閉扉に遮られるか(XZ)
  _blocked(p) {
    const e = this.enemy.pos;
    return segmentHitT(e.x, e.z, p.x, p.z, this.collisions, (c) => c.kind === 'enemy') < 1;
  }

  // 外部からの音(扉の開閉・施錠)。main が呼ぶ
  noise(x, z, r) { this._noise = { x, z, r }; }

  // ------------------------------------------------------------ 移動の部品
  _area(x, z) { return (x > 7.86 && z > 5.8 && z < 8.7) ? 'R' : 'C'; }

  _nearestNode(x, z) {
    const area = this._area(x, z);
    if (area === 'R') return 'R';
    let best = null, bd = 1e9;
    for (const [k, [nx, nz]] of Object.entries(NODES)) {
      if (k === 'R') continue;
      const d = Math.hypot(nx - x, nz - z);
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }

  _route(fromX, fromZ, toX, toZ) {
    const a = this._nearestNode(fromX, fromZ), b = this._nearestNode(toX, toZ);
    // ダイクストラ(ノード 10 個なので素朴に)
    const dist = {}, prev = {}, todo = new Set(Object.keys(NODES));
    for (const k of todo) dist[k] = Infinity;
    dist[a] = 0;
    while (todo.size) {
      let u = null;
      for (const k of todo) if (u === null || dist[k] < dist[u]) u = k;
      todo.delete(u);
      if (u === b) break;
      for (const [p, q] of EDGES) {
        const v = p === u ? q : q === u ? p : null;
        if (!v || !todo.has(v)) continue;
        const w = Math.hypot(NODES[u][0] - NODES[v][0], NODES[u][1] - NODES[v][1]);
        if (dist[u] + w < dist[v]) { dist[v] = dist[u] + w; prev[v] = u; }
      }
    }
    const names = [];
    for (let k = b; k; k = prev[k]) { names.unshift(k); if (k === a) break; }
    const pts = names.map((k) => ({ x: NODES[k][0], z: NODES[k][1], node: k }));
    pts.push({ x: toX, z: toZ, node: null });
    // 見通しで間引く(扉をまたぐ C1→R / R→C1 は残す)
    const out = [];
    let cx = fromX, cz = fromZ;
    for (let i = 0; i < pts.length; i++) {
      const next = pts[i + 1];
      const isDoorHop = (pts[i].node === 'C1' && next && next.node === 'R') || (pts[i].node === 'R' && next && next.node === 'C1');
      if (next && !isDoorHop && this._clear(cx, cz, next.x, next.z)) continue;
      out.push(pts[i]);
      cx = pts[i].x; cz = pts[i].z;
    }
    return out;
  }

  // 幅のある見通し(中心線と左右 0.25m の 3 本)
  _clear(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
    if (L < 1e-4) return true;
    const nx = -dz / L * 0.25, nz = dx / L * 0.25;
    const skip = (c) => c.kind === 'enemy';
    for (const s of [0, 1, -1]) if (segmentHitT(ax + nx * s, az + nz * s, bx + nx * s, bz + nz * s, this.collisions, skip) < 1) return false;
    return true;
  }

  _resolve(x, z) {
    const r = AI.radius;
    for (let pass = 0; pass < 2; pass++) {
      for (const c of this.collisions) {
        if (c.disabled || c.kind === 'enemy') continue;
        const dx1 = (x + r) - c.minX, dx2 = c.maxX - (x - r);
        const dz1 = (z + r) - c.minZ, dz2 = c.maxZ - (z - r);
        if (dx1 <= 0 || dx2 <= 0 || dz1 <= 0 || dz2 <= 0) continue;
        const m = Math.min(dx1, dx2, dz1, dz2);
        if (m === dx1) x = c.minX - r; else if (m === dx2) x = c.maxX + r;
        else if (m === dz1) z = c.minZ - r; else z = c.maxZ + r;
      }
    }
    return [x, z];
  }

  // 1 フレーム分、target へ歩く。着いたら true
  _stepToward(tx, tz, speed, clip, turnRate, arrive = 0.12) {
    const e = this.enemy, dt = this.dt;
    const dx = tx - e.pos.x, dz = tz - e.pos.z;
    const d = Math.hypot(dx, dz);
    if (d <= arrive) { e.speed = 0; return true; }
    const want = Math.atan2(dx, dz);
    const dy = wrap(want - e.yaw);
    e.yaw += THREE.MathUtils.clamp(dy, -turnRate * dt, turnRate * dt);
    const align = Math.max(0, Math.cos(dy));
    const step = Math.min(d, speed * dt * (0.25 + 0.75 * align));
    const [nx, nz] = this._resolve(e.pos.x + dx / d * step, e.pos.z + dz / d * step);
    const moved = Math.hypot(nx - e.pos.x, nz - e.pos.z);
    e.pos.x = nx; e.pos.z = nz;
    e.speed = moved / Math.max(dt, 1e-4);
    const cs = e.clipSpeed[clip] || speed;
    e.play(clip, { timeScale: THREE.MathUtils.clamp(speed / cs, 0.6, 1.9) });
    this._stuck = moved < speed * dt * 0.1 ? (this._stuck || 0) + dt : 0;
    return false;
  }

  *_wait(sec) { let t = 0; while (t < sec) { t += this.dt; yield; } }

  *_turnTo(yaw, idleClip = 'look_idle') {
    const e = this.enemy;
    let dy = wrap(yaw - e.yaw);
    e.speed = 0;
    if (Math.abs(dy) > 1.2) {
      const y0 = e.yaw;
      e.play(dy > 0 ? 'turn_left' : 'turn_right', { fade: 0.2 });
      const T = 0.9;
      for (let t = 0; t < T; t += this.dt) { const k = t / T; e.yaw = y0 + dy * (k * k * (3 - 2 * k)); yield; }
      e.yaw = yaw;
      e.play(idleClip, { fade: 0.35 });
      return;
    }
    e.play(idleClip, { fade: 0.35 });
    while (Math.abs(dy) > 0.02) {
      const s = THREE.MathUtils.clamp(dy, -2.5 * this.dt, 2.5 * this.dt);
      e.yaw += s; dy -= s;
      yield;
    }
  }

  // 経路に沿って goal まで。扉 410 が閉まっていれば doorEntry(useKey)。stopIf() が真なら途中で抜ける
  *_goTo(gx, gz, mode, { useKey = true, stopIf = null, arrive = 0.15 } = {}) {
    const e = this.enemy;
    let route = this._route(e.pos.x, e.pos.z, gx, gz);
    this._stuck = 0;
    while (route.length) {
      if (stopIf && stopIf()) return 'stopped';
      const wp = route[0];
      // 扉をまたぐ区間: 廊下→室内は鍵で開けて入る。室内→廊下で閉まっていれば内側から開ける
      const here = this._area(e.pos.x, e.pos.z);
      if (wp.node === 'R' && here === 'C' && !this.doors.isOpen('410')) {
        const r = yield* this._doorEntry(this.doors.get('410'), useKey);
        if (r !== 'entered') return r;
        route.shift();
        continue;
      }
      if (wp.node === 'C1' && here === 'R' && !this.doors.isOpen('410')) {
        this.doors.setLocked('410', false);
        this.doors.open('410', 1.5);
        this.log('door_opened_inside', { room: '410' });
        e.play('look_idle', { fade: 0.3 });
        yield* this._wait(0.9);
      }
      if (this._stepToward(wp.x, wp.z, AI.speed[mode], AI.clip[mode], AI.turnRate[mode], route.length === 1 ? arrive : 0.35)) route.shift();
      else if (this._stuck > 1.5) { this.log('stuck', { x: +e.pos.x.toFixed(2), z: +e.pos.z.toFixed(2) }); return 'stuck'; }
      yield;
    }
    e.speed = 0;
    return 'arrived';
  }

  // 扉の前(廊下側)の立ち位置と向き
  _doorFront(roomId, startDist = 0.75, lateral = 0) {
    const info = this.doorInfo.find((d) => d.roomId === roomId);
    const [x, z] = info.pos, [nx, nz] = info.normal, [kx, kz] = info.knob;
    // 横ずらし: ノブ側へ(door_open_in は右手で押す。410 は正面を向いた本体の右 = +z = ノブ側)
    return { x: x + nx * startDist + kx * lateral, z: z + nz * startDist + kz * lateral, yaw: Math.atan2(-nx, -nz) };
  }

  // 鍵で入室(410 のみ開閉可能)。door_open_in の間は割り込み不可
  *_doorEntry(door, useKey) {
    const e = this.enemy, D = AI.door;
    const f = this._doorFront(door.roomId, D.startDist + 0.25, D.lateral);
    const mode = this.state === 'CHASE' ? 'CHASE' : this.state === 'ALERT' ? 'ALERT' : 'PATROL';
    // 扉の 25cm 手前まで来て、扉に正対
    while (!this._stepToward(f.x, f.z, Math.min(AI.speed[mode], 1.4), mode === 'CHASE' ? 'walk_brutal' : AI.clip[mode], AI.turnRate[mode], 0.06)) {
      if (this._stuck > 1.5) return 'stuck';
      yield;
    }
    this.uninterruptible = true;
    this.enemy.aimPoint = new THREE.Vector3(door.collision ? (door.collision.minX + door.collision.maxX) / 2 : f.x, this.floorY + 1.0, f.z);
    yield* this._turnTo(f.yaw);
    if (door.locked) {
      if (!useKey) {
        door.rattle = 0.25;
        if (this.audio) this.audio.play('rattle', doorPos(door, this.floorY));
        this.log('rattle', { room: door.roomId });
        yield* this._wait(1.2);
        this.uninterruptible = false;
        this.enemy.aimPoint = null;
        return 'locked';
      }
      e.play('look_idle', { fade: 0.3 });
      if (this.audio) this.audio.play('keys', doorPos(door, this.floorY));
      this.log('keys', { room: door.roomId });
      yield* this._wait(D.keysTime);
      if (this.audio) this.audio.play('lock', doorPos(door, this.floorY));
      this.log('unlock', { room: door.roomId });
      yield* this._wait(D.lockTime);
      this.doors.setLocked(door.roomId, false);
    }
    // 開始位置へ合わせる(25cm 前へ詰める)
    const s = this._doorFront(door.roomId, D.startDist, D.lateral);
    for (let t = 0; t < 0.6; t += this.dt) {
      if (this._stepToward(s.x, s.z, 0.6, 'walk_standard', 2.0, 0.02)) break;
      yield;
    }
    e.pos.x = s.x; e.pos.z = s.z; e.yaw = s.yaw; e.speed = 0;
    e.play('door_open_in', { fade: 0.25 });
    this.log('door_open_in', { room: door.roomId });
    let opened = false;
    const a = e.actions.door_open_in;
    const dur = a.getClip().duration;
    while (a.time < dur - 0.02 && e.current === 'door_open_in') {
      if (!opened && a.time >= D.openAt) { this.doors.open(door.roomId, D.openSpeed); opened = true; this.log('door_opened', { room: door.roomId }); }
      e.speed = 0.6;
      yield;
      // 室内のプレイヤーに重ならない(ルートモーションの前進をプレイヤーの手前 0.7m で止める)
      const p = this.player.pos, fx = Math.sin(e.yaw), fz = Math.cos(e.yaw);
      const ahead = (p.x - e.pos.x) * fx + (p.z - e.pos.z) * fz;
      const side = Math.abs((p.x - e.pos.x) * fz - (p.z - e.pos.z) * fx);
      if (ahead > -0.2 && ahead < 0.7 && side < 0.5) { const back = 0.7 - ahead; e.pos.x -= fx * back; e.pos.z -= fz * back; }
    }
    if (!opened) this.doors.open(door.roomId, D.openSpeed);
    // 室内に収める(ルートモーションで行き過ぎても壁箱の内側へ)
    const [rx, rz] = this._resolve(e.pos.x, e.pos.z);
    e.pos.x = rx; e.pos.z = rz;
    e.speed = 0;
    this.uninterruptible = false;
    this.enemy.aimPoint = null;
    this.log('entered', { room: door.roomId, x: +e.pos.x.toFixed(2), z: +e.pos.z.toFixed(2) });
    return 'entered';
  }

  // ------------------------------------------------------------ PATROL
  *_patrol() {
    const e = this.enemy;
    e.setFace('grin', 0);
    // 室内にいたら廊下へ戻り、扉を閉める
    if (this._area(e.pos.x, e.pos.z) === 'R') yield* this._leaveRoom();
    const order = ['405', '406', 'EV', '404', '407', '410', '403', '408', '402', '409', '401', '410', 'N0'];   // 410(プレイヤーの部屋)は一巡に2回
    while (true) {
      const tgt = order[this.patrolIdx++ % order.length];
      if (tgt === 'EV' || tgt === 'N0') {
        const [x, z] = NODES[tgt];
        yield* this._goTo(x, z, 'PATROL');
        yield* this._turnTo(tgt === 'EV' ? 0 : Math.PI);
        e.play('look_idle', { fade: 0.4 });
        yield* this._wait(2.0 + this._rand() * 2.0);
        continue;
      }
      const f = this._doorFront(tgt, 0.75, 0);
      const r = yield* this._goTo(f.x, f.z, 'PATROL');
      if (r !== 'arrived') { yield* this._wait(0.5); continue; }
      yield* this._turnTo(f.yaw);
      // 扉の前で耳を澄ます。410(プレイヤーの部屋)の前では体を回さない見回し=覗き穴から顔が見える
      if (tgt === '410') e.play('look_nervous', { fade: 0.4, timeScale: 0.6 });
      else e.play('look_idle', { fade: 0.4 });
      yield* this._wait(tgt === '410' ? 3.0 + this._rand() * 2.0 : 1.5 + this._rand() * 2.0);
      const door = this.doors.get(tgt);
      if (door && door.operable && this._rand() < 0.6) {
        // 覗く: 開いていればそのまま、施錠ならノブを確かめて去る
        const res = yield* this._doorEntry(door, false);
        if (res === 'entered') {
          e.play('look_idle', { fade: 0.4 });
          yield* this._wait(2.5);
          yield* this._leaveRoom();
        }
      } else if (this._rand() < 0.3 && door) {
        door.rattle = 0.25;
        if (this.audio) this.audio.play('rattle', doorPos(door, this.floorY), 0.7);
      }
    }
  }

  *_leaveRoom() {
    const e = this.enemy;
    const out = this._doorFront('410', 0.7, 0);
    const mode = this.state === 'PATROL' ? 'PATROL' : 'ALERT';
    yield* this._goTo(out.x, out.z, mode);
    // 扉に向き直って閉める
    yield* this._turnTo(out.yaw);
    this.doors.close('410');
    this.log('door_closed', { room: '410' });
    yield* this._wait(0.8);
    void e;
  }

  // ------------------------------------------------------------ ALERT
  *_alert(opts) {
    const e = this.enemy;
    if (opts.react !== false) {
      // 物音の方へ向き直りながら驚く
      e.play('react_surprised', { fade: 0.2 });
      const k = this.lastKnown;
      for (let t = 0; t < 1.3; t += this.dt) {
        if (k) { const want = Math.atan2(k.x - e.pos.x, k.z - e.pos.z); e.yaw += THREE.MathUtils.clamp(wrap(want - e.yaw), -2 * this.dt, 2 * this.dt); }
        yield;
      }
    }
    let searched = 0;
    while (true) {
      const k = this.lastKnown;
      if (!k) break;
      const target = { ...k };
      const r = yield* this._goTo(target.x, target.z, 'ALERT', { useKey: true, stopIf: () => this.lastKnown && (this.lastKnown.x !== target.x || this.lastKnown.z !== target.z) });
      if (r === 'stopped') continue;   // 新しい音 → そちらへ
      // 着いたら見回す
      e.play('look_nervous', { fade: 0.4 });
      const since = () => this.time - Math.max(this.lastHeardTime || 0, this.lastSeenTime || 0);
      while (since() < AI.alertSearch && searched < AI.alertSearch * 2) {
        searched += this.dt;
        if (this.lastKnown && (this.lastKnown.x !== target.x || this.lastKnown.z !== target.z)) break;
        yield;
      }
      if (since() >= AI.alertSearch || searched >= AI.alertSearch * 2) break;
    }
    // 捜索終了 → 巡回へ
  }

  // ------------------------------------------------------------ CHASE
  *_chase() {
    const e = this.enemy;
    e.setFace('grin', 0.8);
    let lost = 0;
    let route = null, replan = 0;
    while (true) {
      const p = this.player.pos;
      if (this.canSee || this.inProximity) { lost = 0; this.lastKnown = { x: p.x, z: p.z }; } else lost += this.dt;
      if (lost > AI.chaseLose) { this.setState('ALERT', { react: false }); yield; return; }
      const dist = Math.hypot(p.x - e.pos.x, p.z - e.pos.z);
      if (dist <= AI.attackRange && !this.occluded) { this.setState('ATTACK'); yield; return; }
      const tgt = (this.canSee || this.inProximity) ? { x: p.x, z: p.z } : this.lastKnown;
      // 扉の向こう(410 室内)なら鍵で開けて入る
      if (this._area(tgt.x, tgt.z) === 'R' && this._area(e.pos.x, e.pos.z) === 'C' && !this.doors.isOpen('410')) {
        yield* this._doorEntry(this.doors.get('410'), true);
        route = null;
        continue;
      }
      replan -= this.dt;
      if (!route || replan <= 0) { route = this._route(e.pos.x, e.pos.z, tgt.x, tgt.z); replan = 0.25; }
      const wp = route[0] || tgt;
      e.aimPoint = new THREE.Vector3(p.x, this.floorY + 1.1, p.z);
      // 近いときは大股の歩き(walk_brutal)、離れていれば走る
      const close = dist < 3.0;
      const sp = close ? 1.6 : AI.speed.CHASE;
      const clip = close ? 'walk_brutal' : 'run_intent';
      if (this._stepToward(wp.x, wp.z, sp, clip, AI.turnRate.CHASE, 0.3) && route.length) route.shift();
      yield;
    }
  }

  // ------------------------------------------------------------ ATTACK
  *_attack() {
    const e = this.enemy;
    e.speed = 0;
    this.uninterruptible = true;
    e.play('attack_downward', { fade: 0.15 });
    e.setFace('grin', 0);
    this.log('attack_start');
    const a = e.actions.attack_downward;
    const dur = a.getClip().duration;
    let hit = false;
    while (a.time < dur - 0.02 && e.current === 'attack_downward') {
      const t = a.time;
      const p = this.player.pos;
      if (t < AI.hitTime) {   // 振りかぶりの間はプレイヤーへ向き続ける
        const want = Math.atan2(p.x - e.pos.x, p.z - e.pos.z);
        e.yaw += THREE.MathUtils.clamp(wrap(want - e.yaw), -6 * this.dt, 6 * this.dt);
        e.aimPoint = new THREE.Vector3(p.x, this.floorY + 1.2, p.z);
      }
      e.setFace('attack', t < 1.25 ? 1.0 : 0.0);
      if (!hit && t >= AI.hitTime) {
        hit = true;
        const dist = Math.hypot(p.x - e.pos.x, p.z - e.pos.z);
        if (dist <= AI.hitRange && !this._blocked(p)) {
          this.log('hit', { dist: +dist.toFixed(2) });
          this.uninterruptible = false;
          this.state = 'DEAD';
          if (this.onKill) this.onKill();
          // 振り下ろしを最後まで見せる
          while (a.time < dur - 0.02) { e.setFace('attack', a.time < 1.25 ? 1 : 0); yield; }
          e.play('look_idle', { fade: 0.5 });
          while (this.state === 'DEAD') yield;
          return;
        }
        this.log('miss', { dist: +dist.toFixed(2) });
      }
      yield;
    }
    this.uninterruptible = false;
    this.setState('CHASE');
  }

  // ------------------------------------------------------------ SCRIPTED(デバッグ)
  *_scripted(opts) {
    if (opts.goto) {
      yield* this._goTo(opts.goto.x, opts.goto.z, 'SCRIPTED', { useKey: true });
      this.enemy.play('look_idle');
    }
    while (true) yield;
  }

  stats() {
    const e = this.enemy;
    return {
      state: this.state, pos: [+e.pos.x.toFixed(3), +e.pos.z.toFixed(3)], yaw: +e.yaw.toFixed(3), action: e.current,
      face: { grin: +e.face.grin.toFixed(2), attack: +e.face.attack.toFixed(2) },
      canSee: this.canSee, heard: this.heard, occluded: this.occluded, lastKnown: this.lastKnown,
      uninterruptible: this.uninterruptible,
    };
  }
}

function doorPos(door, floorY) {
  const c = door.collision;
  return new THREE.Vector3(c ? (c.minX + c.maxX) / 2 : 0, floorY + 1.0, c ? (c.minZ + c.maxZ) / 2 : 0);
}
function wrap(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
function mulberry(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
