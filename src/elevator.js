// elevator.js — P3a: エレベーター(プレイヤー用)。カゴは1台、全7階に停まる(8F は物語決定後)。
//  ホールの呼びボタン(E)→ カゴが来て扉が開く → 乗って行き先ボタン(E。視線の先のボタン／数字キー 1〜7)
//  → 扉が閉まる → 移動(仮音: モーターの唸り＋到着のチャイム。WebAudio で合成)→ 行き先の階で扉が開く。
//  扉の見た目は各階 GLB の EV 扉2枚(p0b_ev: 片寄せ2枚・左へ退避、手前の扉は2倍動く=n2_slide_dist)。
//  当たりは world の 'evdoor' 箱(開いている間だけ無効)。カゴの中は world がシャフトを殻に置き換えてある。
//  カゴの見た目は各階に同じものがあるので、移動=到着時にプレイヤーを行き先の階の同じ場所へ移す(Δy = 階高×階差)。
//  P3b-A(DESIGN §2.2 末尾2項目): カゴの中は常に明るい(天井の乳白パネルはカゴのいる階で常時発光、扉が開いている間・
//  乗っている間はカゴの PointLight(影なし)も点ける)。階数表示(全階のホールの呼びパネル上段＋カゴの操作盤)は
//  カゴの現在地を表示し、移動中は通過階ごとに切り替わり ▲▼ が点く。アトラス(build/tex/ev_display.png・
//  ev_car_display.png、8列=階 × 3段=矢印なし/▲/▼)の共有テクスチャの repeat/offset をずらす(全階が同じ1枚を見る)。
//  管理人も同じカゴを使う(enemy_ai の _evRide: 呼ぶ→乗る→行き先を押す→降りる)。

import * as THREE from 'three';
import { levelY, evCarGeom } from './world.js';

export const EV = {
  doorTime: 1.5,       // 扉の開閉(秒)
  hold: 5.0,           // 開いたまま待つ(秒。扉の間に人がいれば延長)
  travelBase: 2.4,     // 移動の基本時間＋1階あたり
  travelPerFloor: 1.5,
  callReact: 0.5,      // 呼んでから動き出すまで
  chimeLead: 0.3,      // P5a: 到着のチャイムから扉が開き始めるまで(チャイム→開き切るまで = 0.3 + doorTime 1.5 = 1.8 秒。EV の賭けの猶予)
  carLightIntensity: 1.3,
  carCeiling: 0.3,     // 天井の乳白パネルの発光の倍率(manifest の発光の強さ × これ)
  stops: [1, 2, 3, 4, 5, 6, 7],
};

export class Elevator {
  // ctx: { building, world, player, camera, listener, getLevel(), setLevel(key, {dy}), hud }
  constructor(ctx) {
    Object.assign(this, ctx);
    this.rooms = {};
    for (const f of this.building.floors) {
      if (f.level > 7) continue;
      const r = f.rooms.find((rr) => rr.kind === 'elevator');
      this.rooms[f.level] = { room: r, geom: evCarGeom(r) };
    }
    this.car = { level: 1, open: 0, state: 'idle', hold: 0, to: null, t: 0, dur: 0, riding: false, pending: [] };
    this.light = new THREE.PointLight(0xfff2e0, 0, 4.0, 2);
    this.light.castShadow = false;
    this.light.visible = false;
    this.ctx3 = null;
    this.events = [];
    this.shown = { floor: null, dir: null };     // 表示中の階数と矢印(0=なし 1=▲ 2=▼)
    this.shownLog = [];                          // 表示が切り替わった履歴(テスト用)
    this.npc = null;                             // 管理人が乗っている({ to })
    this.time = 0;                               // P5a: カゴの時計(EV の賭け: 管理人を乗せたカゴが止まった時刻)
    this.npcStop = null;                         // P5a: { level, t } 管理人が最後に降りた階と時刻
    this._initAudio();
  }

  log(ev, extra = {}) { this.logCount = (this.logCount || 0) + 1; this.events.push({ n: this.logCount, ev, level: this.car.level, ...extra }); if (this.events.length > 200) this.events.shift(); }

  // ------------------------------------------------------------ 判定
  inCar(px, pz, key) {
    if (key !== this.car.level) return false;
    const g = this.rooms[key].geom.inner;
    return px > g[0] && px < g[2] && pz > g[1] - 0.05 && pz < g[3];
  }
  inDoorway(px, pz, key) {
    const r = this.rooms[key];
    if (!r) return false;
    const g = r.geom;
    return px > g.open[0] - 0.15 && px < g.open[1] + 0.15 && pz > g.doorZ[0] - 0.45 && pz < g.doorZ[1] + 0.3;
  }
  // カゴの操作盤のボタン(視線の先)。返り値 { floor, pos } | null
  buttonAt(camera, key) {
    const man = this.world.manifests[key];
    if (!man || !man.evButtons || !this.inCar(this.player.pos.x, this.player.pos.z, key)) return null;
    const o = camera.getWorldPosition(new THREE.Vector3());
    const f = camera.getWorldDirection(new THREE.Vector3());
    let best = null, ba = 0.16;
    for (const b of man.evButtons) {
      const v = new THREE.Vector3().fromArray(b.pos).sub(o);
      const d = v.length();
      if (d > 1.3) continue;
      const a = v.normalize().angleTo(f);
      if (a < ba) { ba = a; best = b; }
    }
    // 盤に正対していれば一番近いボタンでなくても「盤を見ている」と扱う(1階ボタンなど)
    return best;
  }
  facingPanel(camera, key) {
    const man = this.world.manifests[key];
    if (!man || !man.evButtons || !this.inCar(this.player.pos.x, this.player.pos.z, key)) return false;
    const c = man.evButtons.reduce((s, b) => s.add(new THREE.Vector3().fromArray(b.pos)), new THREE.Vector3()).multiplyScalar(1 / man.evButtons.length);
    const o = camera.getWorldPosition(new THREE.Vector3());
    const v = c.sub(o); const d = v.length();
    return d < 1.3 && v.normalize().dot(camera.getWorldDirection(new THREE.Vector3())) > 0.75;
  }

  // ------------------------------------------------------------ 操作
  call(level) {
    this.log('call', { from: level });
    if (this.car.level === level && this.car.state !== 'moving') { this._openHere(); return 'open'; }
    if (!this.car.pending.includes(level)) this.car.pending.push(level);
    return 'called';
  }
  select(level) {
    if (!EV.stops.includes(level)) return 'invalid';
    this.log('select', { to: level });
    if (level === this.car.level) { this._openHere(); return 'open'; }
    this.car.pending = this.car.pending.filter((l) => l !== level);
    this.car.pending.unshift(level);
    if (this.car.state === 'open') this.car.hold = 0.4;   // すぐ閉める
    return 'selected';
  }
  _openHere() {
    const c = this.car;
    if (c.state === 'idle' || c.state === 'closing') { c.state = 'opening'; this._sfx('door'); }
    else if (c.state === 'open') c.hold = EV.hold;
  }

  // ------------------------------------------------------------ 毎フレーム
  update(dt) {
    const c = this.car;
    this.time += dt;
    const key = this.getLevel();
    const p = this.player.pos;
    const someoneInDoor = this.inDoorway(p.x, p.z, key) && key === c.level;
    switch (c.state) {
      case 'idle':
        if (c.pending.length) {
          const to = c.pending.shift();
          if (to === c.level) { c.state = 'opening'; this._sfx('door'); break; }
          c.riding = this.inCar(p.x, p.z, key);
          c.to = to; c.t = -EV.callReact; c.dur = EV.travelBase + EV.travelPerFloor * Math.abs(to - c.level);
          c.state = 'moving';
          this.log('depart', { to, riding: c.riding });
          if (c.riding && this.onRideStart) this.onRideStart(to);
          // P6b-A(§3.9 #9): プレイヤーが乗ったカゴの行き先が決まった → AI へ(管理人がその階の廊下にいれば EV ホールで待ち構える)。
          //  eta = 扉が開き始めるまでの秒(動き出すまで＋移動＋チャイム)
          if (c.riding && this.onPlayerRide) this.onPlayerRide(to, { from: c.level, eta: EV.callReact + c.dur + EV.chimeLead });
          this._hum(true);
        }
        break;
      case 'moving': {
        c.t += dt;
        const ready = !c.riding || this.world.isReady(c.to);
        if (c.t >= c.dur && ready) {
          const from = c.level;
          c.level = c.to; c.to = null;
          this._hum(false);
          this._sfx('chime');
          if (c.riding) { this.setLevel(c.level, { dy: levelY(c.level) - levelY(from) }); }
          c.riding = false;
          c.state = 'arrived'; c.lead = EV.chimeLead;
          if (this.npc && !this.npc.ambush) this.npcStop = { level: c.level, t: this.time };   // P5a: EV の賭けの起点
          this.log('arrive', { from, npc: !!this.npc });
        }
        break;
      }
      case 'arrived':   // P5a: チャイムが鳴ってから扉が開き始めるまで
        c.lead -= dt;
        if (c.lead <= 0) { c.state = 'opening'; this._sfx('door'); }
        break;
      case 'opening':
        c.open = Math.min(1, c.open + dt / EV.doorTime);
        if (c.open >= 1) { c.state = 'open'; c.hold = EV.hold; }
        break;
      case 'open':
        c.hold -= dt;
        if (someoneInDoor) c.hold = Math.max(c.hold, 1.5);
        if (c.hold <= 0) { c.state = 'closing'; this._sfx('door'); }
        break;
      case 'closing':
        if (someoneInDoor) { c.state = 'opening'; break; }
        c.open = Math.max(0, c.open - dt / EV.doorTime);
        if (c.open <= 0) c.state = 'idle';
        break;
    }
    this._apply();
    this._applyDisplay();
    this._updateAudio(dt);
  }

  // 表示する階と矢印。移動中は通過階ごとに切り替える(出発階→…→行き先)
  displayState() {
    const c = this.car;
    if (c.state === 'moving' && c.to !== null) {
      const n = Math.abs(c.to - c.level), sg = Math.sign(c.to - c.level);
      const frac = Math.min(1, Math.max(0, c.t / c.dur));
      const k = Math.min(n, Math.floor(frac * n + 0.4));
      return { floor: c.level + sg * k, dir: sg > 0 ? 1 : 2 };
    }
    return { floor: c.level, dir: 0 };
  }
  _displayTextures() {
    if (this._dispTex) return this._dispTex;
    const out = [];
    const man = this.world.manifests[4] || Object.values(this.world.manifests)[0];
    for (const name of ['M_EVDisplay', 'M_EVCarDisplay']) {
      const def = man && man.materials && man.materials[name];
      if (def && def.map) out.push(this.world.texture(def.map, true));
    }
    return (this._dispTex = out);
  }
  _applyDisplay() {
    const d = this.displayState();
    if (d.floor === this.shown.floor && d.dir === this.shown.dir) return;
    this.shown = d;
    this.shownLog.push({ floor: d.floor, dir: d.dir, npc: !!this.npc });
    if (this.shownLog.length > 200) this.shownLog.shift();
    for (const t of this._displayTextures()) {
      t.repeat.set(1 / 8, 1 / 3);
      t.offset.set((d.floor - 1) / 8, d.dir / 3);
    }
  }

  // 扉の位置・当たり・カゴの灯り
  _apply() {
    const c = this.car;
    for (const lv of EV.stops) {
      const open = lv === c.level && c.state !== 'moving' ? c.open : 0;
      const rec = this.world.floors.get(lv);
      if (rec && rec.evLeaves) for (const l of rec.evLeaves) l.node.position.copy(l.base).addScaledVector(l.dir, l.dist * open);
      const col = this.world.collisions(lv).find((b) => b.kind === 'evdoor');
      if (col) col.disabled = open > 0.85;
      // カゴの天井の発光: カゴのいる階では常時点灯(P3b-A。深夜でも消えない。移動中は乗っている時だけ)
      if (rec) for (const m of rec.mats) if (m.name === 'M_CarCeiling') m.emissiveIntensity = (m.userData.n2Emissive ?? 1) * (lv === c.level && (c.state !== 'moving' || c.riding) ? EV.carCeiling : 0);
    }
    // カゴの灯り(PointLight・影なし): 扉が開いている間・乗っている間・カゴの中に立っている間。
    // 閉じた扉の向こうで点けると壁越しに床を照らしてしまう(影なしの光)ので、それ以外は消す(天井の発光面は常時)
    const p = this.player.pos;
    const lit = (c.open > 0 && c.state !== 'moving') || c.riding || this.inCar(p.x, p.z, this.getLevel());
    const g = this.rooms[c.level].geom;
    this.light.visible = lit;
    this.light.intensity = lit ? EV.carLightIntensity : 0;
    this.light.position.set(g.center[0], levelY(c.level) + 2.15, g.center[1]);
  }

  // ------------------------------------------------------------ 音(P4b): 到着チャイム = 採用 ev_chime A「柔らかい 2 音」、走行音 = 採用 ev_motor A「低いうなりとケーブル」(ループ)。
  //  扉の開閉(ev_door)・呼びボタン(ev_button)・カゴの中の静けさ(ev_car_quiet)は「なし」= 無音(扉は記録だけ残す)。bank(AudioBank)は main が渡す。
  //  走行音はループの持ち手で、止まると音量 0 まで下げて音源を止める(P4a の申し送り: 以前は一度乗ると音量 0 のまま鳴り続けていた)
  _initAudio() { this.motorTarget = 0; }
  attach(scene) { scene.add(this.light); }
  _carPos() { const g = this.rooms[this.car.level].geom; return new THREE.Vector3(g.center[0], levelY(this.car.level) + 1.5, g.center[1] - 0.6); }
  _sfx(name) {
    this.log('sfx', { name });
    if (name === 'chime' && this.bank) this.bank.play('ev_chime', { pos: this._carPos(), ref: 2, rolloff: 1.2 });
  }
  _hum(on) { this.motorTarget = on ? 0.8 : 0; }
  _updateAudio() {
    if (!this.bank) return;
    // 乗っていれば耳元(カゴの中)、そうでなければシャフトの中から遠く(カゴの位置)
    const riding = this.car.riding;
    this.bank.loop('ev_motor').set(this.motorTarget * (riding ? 1 : 0.35), { pos: riding ? null : this._carPos(), ref: 2 });
  }
  get motorPlaying() { return !!(this.bank && this.bank.loops.get('ev_motor') && this.bank.loops.get('ev_motor').src); }

  // ------------------------------------------------------------ 管理人(enemy_ai の _evRide が使う)
  // 管理人がカゴの中で行き先を押す。プレイヤーが乗っていれば(同じカゴ)一緒に動く
  npcSelect(to) {
    this.npc = { to };
    this.log('npc_select', { to });
    return this.select(to);
  }
  npcLeave() { this.npc = null; }

  state() {
    const c = this.car;
    return { level: c.level, state: c.state, open: +c.open.toFixed(2), riding: c.riding, to: c.to, pending: [...c.pending] };
  }
}
