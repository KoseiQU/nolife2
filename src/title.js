// title.js — P6a: タイトル画面(DESIGN §7 P6a ①)。表記は「NOLIFE」(2026-11-02 ユーザー指示。「2」は付けない)。
//  P6b-F1(§3.12 #1): 背景を案 C の生レンダに置き換えた(docs/p6b-e1/NOTES.md の C・docs/p6b-f1/NOTES.md §2):
//   - 黒地 → 4F の廊下の北端から南を見る(管理人は z 10.0 で常夜灯 z 12.8 を背にこちらを向く。look_idle の極低速 = 呼吸と体重移動。ハンマーは腰。露出 4.3)
//   - 文字「NOLIFE」の下端から血が 8〜10 本垂れる(2D キャンバス 1 枚。太さ・色・輪郭・艶・速さの不均一・止まって再び流れる・先端の玉・下端の溜まり。20〜30 秒で伸び切って保持)
//   - 常夜灯: 3〜8 秒おきに手前か奥の 1 灯が 0.2〜0.6 秒ちらつく(明滅 2〜4 回)。20〜40 秒に 1 回、0.4〜0.8 秒だけ廊下の灯りが全部消える → 0.1 秒の点滅で一斉に戻る
//     (灯りの制御は本編の停電と同じ src/power.js の差し込み。タイトルは manual で値を入れる)
//   - 音楽なし(ちらつきの採用音は無い = 無音)
//  ゲームの時間は止めたまま(main の step はタイトルの間 update(dt) だけを呼ぶ = AI・物語・扉は進まない)。管理人は本体のメッシュを演出体として置く。
//  クリック: ポインタロック と AudioContext の開始(クリックの中で)→ 1.4 秒で黒へ → 片付け(管理人・露出・霧・灯り・カメラ・視野角・滴)→ onStart(チュートリアルか通常プレイ)。
//  テストは click() / preview(on)(DOM なしで背景だけ回す。?test=enemy 24)/ update(dt)。

import { HUD_TEXT } from './hud_text.js';
import { levelY } from './world.js';

export const TITLE = {
  level: 4,
  cam: { x: 6.9, z: 6.3, eye: 1.75, tx: 6.9, ty: 1.6, tz: 21.0, fov: 46, sway: 0.006 },   // 案 C(北端から南の EV ホールへ)
  enemy: { x: 6.85, z: 10.0, turn: -0.4, clip: 'look_idle', grin: 0.8, t0: 5.3, t1: 6.0, period: 11.0 },   // look_idle の t0〜t1(こちらを向いてハンマーが腰の横に下がる区間)を period 秒で往復(極低速)
  exposure: 4.3,
  fadeIn: 2.6,          // 4F が読めてから黒が明けるまで
  leave: 1.4,           // クリックから黒になるまで
  handoff: 0.6,         // 片付けの後、タイトルの黒が消えるまで(下の画面 = チュートリアルの黒/本編へ)
  lamps: [[6.9, 12.8], [6.9, 19.3]],   // 手前(管理人の背)・奥(EV ホールの手前)。天井の灯具の中心の高さ = 床 + 2.36
  flicker: { every: [3, 8], dur: [0.2, 0.6], blinks: [2, 4] },
  outage: { every: [20, 40], dur: [0.4, 0.8], back: 0.1, lm: 0.02, amb: 0.5, expo: 0.6, enemyLamp: 0.12 },   // 消えている間は環境光と露出も落とす(真っ黒に近く、管理人の輪郭だけ僅かに)
  text: { size: 0.096, y: 0.19, spacing: 0.62, color: '#a9a196', font: '"Hiragino Mincho ProN", "Yu Mincho", "YuMincho", serif', in: 3.2, delay: 0.4 },
  blood: { n: [8, 10], w: [3, 6], start: 2.2, done: [20, 30], len: [0.07, 0.36] },   // 太さは CSS px、長さは画面の高さの割合
};

const CSS = `
#title { position: fixed; inset: 0; z-index: 30; cursor: pointer; user-select: none; opacity: 1; transition: opacity .6s linear; }
#title.gone { opacity: 0; pointer-events: none; }
#title canvas.ink { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
#title .name { position: absolute; left: 0; right: 0; top: 19vh; text-align: center; font: 400 9.6vh/1 "Hiragino Mincho ProN", "Yu Mincho", "YuMincho", serif;
  letter-spacing: .62em; padding-left: .62em; color: transparent; pointer-events: none; transform: translateY(-50%); }
#title .start { position: absolute; left: 0; right: 0; bottom: 11vh; text-align: center; font: 400 12px/1 "Hiragino Mincho ProN", "Yu Mincho", serif; letter-spacing: .4em; padding-left: .4em;
  color: #8a8379; text-shadow: 0 0 6px rgba(0,0,0,.95); opacity: 0; transition: opacity 2.4s ease 2.0s; pointer-events: none; }
#title.on .start { opacity: .85; animation: titleBreathe 4.2s ease-in-out 4.4s infinite; }
#title .black { position: absolute; inset: 0; background: #000; opacity: 1; pointer-events: none; }
@keyframes titleBreathe { 0%, 100% { opacity: .85; } 50% { opacity: .35; } }
`;

const smooth = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
function mulberry(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export class Title {
  // ctx: { show(bool), lock(), resumeAudio(), onStart(),
  //        camera, player, ai, enemy, world, power, renderer, hud, exterior, scene, ambientFloor, look(LOOK), teleport(key, x, z, yaw, pitch), getLevel(), resetAI(dormant), seed }
  constructor(ctx) {
    Object.assign(this, ctx);
    this.active = !!ctx.show;
    this.log = [];
    this.rand = mulberry(ctx.seed ?? 20261104);
    this.bg = null;
    if (!this.active) return;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    this.root = document.createElement('div'); this.root.id = 'title';
    this.root.innerHTML = `<canvas class="ink"></canvas><div class="name"></div><div class="start"></div><div class="black"></div>`;
    this.root.querySelector('.name').textContent = HUD_TEXT.title.name;
    this.root.querySelector('.start').textContent = HUD_TEXT.title.start;
    this.canvas = this.root.querySelector('canvas.ink');
    this.blackEl = this.root.querySelector('.black');
    document.body.appendChild(this.root);
    this.root.addEventListener('click', () => this.click());
    this.log.push({ ev: 'show' });
    this._startBg();
  }

  // ------------------------------------------------------------ 背景(4F の廊下・管理人・灯り・血)
  _startBg() {
    const P = this.player, cam = this.camera, ai = this.ai, e = this.enemy, R = this.renderer;
    this.snap = {
      level: this.getLevel(), x: P.pos.x, z: P.pos.z, yaw: cam.rotation.y, pitch: cam.rotation.x, fov: cam.fov,
      exposure: R.toneMappingExposure, ambient: this.ambientFloor ? this.ambientFloor.intensity : null, fog: this.scene.fog ? { c: this.scene.fog.color.clone(), d: this.scene.fog.density } : null,
      extForce: this.exterior ? this.exterior.force : null, hud: this.hud ? this.hud.root.style.visibility : '',
      flashlight: P.flashlightOn, frozen: P.frozen,
      ai: { state: ai.state, level: ai.level, x: e.pos.x, z: e.pos.z, yaw: e.yaw, concealed: ai.concealed, dormant: ai.dormant, transit: ai.transit },
      enemy: { face: { ...e.face }, faceT: { ...e.faceTarget }, lean: e.lean, faceFill: e.faceFill, underLight: e.underLight, flash: !!(e.flashlight && e.flashlight.on), aim: e.aimPoint, speed: e.speed, visible: e.root.visible },
    };
    this.bg = { t: 0, ready: false, readyT: 0, nextFlick: this._roll(TITLE.flicker.every), flick: null, nextOut: this._roll(TITLE.outage.every), out: null, flicks: 0, outs: 0, drips: null, ink: null };
    this.leaving = null;
    if (this.hud) this.hud.root.style.visibility = 'hidden';
    P.frozen = true;
    P.setFlashlight(false);
    this.log.push({ ev: 'bg_start', level: this.snap.level });
  }
  _roll([a, b]) { return a + (b - a) * this.rand(); }

  // 管理人(演出体)を置く: こちらを向いて少し振れた立ち姿。look_idle を極低速で往復(呼吸と体重移動)
  _poseEnemy() {
    const E = TITLE.enemy, ai = this.ai, e = this.enemy;
    if (ai.level !== TITLE.level) ai.setLevel(TITLE.level);
    ai.setState('SCRIPTED', { force: true });
    ai.concealed = false; ai.transit = false;
    e.place(E.x, E.z, Math.PI + E.turn);
    e.setFlashlight(false); e.aimPoint = null; e.speed = 0;
    e.lean = 0; e.faceFill = 0; e.underLight = 0;
    const a = e.play(E.clip, { fade: 0, restart: true });
    a.timeScale = 0; a.time = E.t0;
    e.setFace('grin', E.grin, true); e.setFace('attack', 0, true);
  }

  _cam(t) {
    const C = TITLE.cam, y0 = levelY(TITLE.level);
    const dx = C.tx - C.x, dz = C.tz - C.z;
    const yaw = Math.atan2(-dx, -dz) + C.sway * Math.sin(t * 0.37), pitch = Math.atan2(C.ty - C.eye, Math.hypot(dx, dz)) + C.sway * 0.6 * Math.sin(t * 0.23 + 1.3);
    this.player.setPose(C.x, C.z, yaw, pitch);
    this.camera.position.y = y0 + C.eye;
    if (this.camera.fov !== C.fov) { this.camera.fov = C.fov; this.camera.updateProjectionMatrix(); }
    this.camera.updateMatrixWorld();
  }

  // 灯り: ちらつき(1 灯)と全消灯(廊下の全部)。power.manual に入れる
  _lights(dt) {
    const B = this.bg, F = TITLE.flicker, O = TITLE.outage, y0 = levelY(TITLE.level);
    B.nextFlick -= dt; B.nextOut -= dt;
    if (!B.out && B.nextOut <= 0) {
      B.out = { t: 0, dur: this._roll(O.dur) }; B.outs++; B.nextOut = this._roll(O.every);
      this.log.push({ ev: 'outage', at: +B.t.toFixed(2), dur: +B.out.dur.toFixed(2) });
    }
    if (!B.flick && !B.out && B.nextFlick <= 0) {
      const lamp = TITLE.lamps[this.rand() < 0.5 ? 0 : 1], dur = this._roll(F.dur), n = F.blinks[0] + Math.floor(this.rand() * (F.blinks[1] - F.blinks[0] + 1));
      // 明滅 n 回: 消える区間を dur の中に n 個(長さは不揃い)
      const spans = []; const slot = dur / n;
      for (let i = 0; i < n; i++) { const a = i * slot + slot * 0.1 * this.rand(), b = a + slot * (0.35 + 0.4 * this.rand()); spans.push([a, b, 0.8 + 0.2 * this.rand()]); }
      B.flick = { t: 0, dur, lamp, spans }; B.flicks++; B.nextFlick = this._roll(F.every);
      this.log.push({ ev: 'flicker', at: +B.t.toFixed(2), lamp, dur: +dur.toFixed(2), blinks: n });
    }
    let dim = null, lmAll = 1, emAll = 1, enemyLamp = 1, dark = 0;
    if (B.out) {
      B.out.t += dt;
      const o = B.out, back = o.t - o.dur;   // 戻り: 0.1 秒の点滅(点く 0.03 → 消える 0.04 → 点く)
      const on = back < 0 ? 0 : back < 0.03 ? 1 : back < 0.07 ? 0 : 1;
      lmAll = O.lm + (1 - O.lm) * on; emAll = on; enemyLamp = on ? 1 : O.enemyLamp; dark = 1 - on;
      if (back >= O.back) { B.out = null; this.log.push({ ev: 'outage_end', at: +B.t.toFixed(2) }); }
    } else if (B.flick) {
      const f = B.flick; f.t += dt;
      const amt = f.spans.reduce((a, [s0, s1, k]) => (f.t >= s0 && f.t < s1 ? Math.max(a, k) : a), 0);
      dim = [f.lamp[0], y0 + 2.36, f.lamp[1], amt];
      if (f.t >= f.dur) B.flick = null;
    }
    const arr = (v) => new Array(8).fill(v);
    this.power.manual = { lm: arr(lmAll), em: arr(emAll), dim, enemyLamp };
    this.power.apply();
    B.lights = { lm: lmAll, em: emAll, dim: dim ? dim[3] : 0 };
    this.renderer.toneMappingExposure = TITLE.exposure * (1 - (1 - O.expo) * dark);
    if (this.ambientFloor && this.snap.ambient !== null) this.ambientFloor.intensity = this.snap.ambient * (1 - (1 - O.amb) * dark);
  }

  update(dt) {
    if (!this.bg) return;
    const B = this.bg;
    B.t += dt;
    const lv = TITLE.level;
    if (this.getLevel() !== lv) { this.teleport(lv, TITLE.cam.x, TITLE.cam.z, Math.PI, 0); }
    if (!B.ready) {
      if (!this.world.isReady(lv)) { this._black(1); return; }
      B.ready = true; B.readyT = B.t;
      this._poseEnemy();
      if (this.root) requestAnimationFrame(() => requestAnimationFrame(() => this.root && this.root.classList.add('on')));
      this.log.push({ ev: 'ready', at: +B.t.toFixed(2) });
    }
    const t = B.t - B.readyT;   // 見え始めからの時刻
    // 屋内: 外観の殻を出さない(読み込みが後から終わっても)
    if (this.exterior) { this.exterior.force = false; if (this.exterior.ready) this.exterior.show(false); }
    this._cam(t);
    // 管理人: look_idle の t0〜t1 を往復(極低速)
    const E = TITLE.enemy, e = this.enemy, a = e.actions[E.clip];
    if (a) { a.time = E.t0 + (E.t1 - E.t0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * t / E.period)); a.timeScale = 0; }
    e.root.visible = true;
    e.update(dt, this.camera);
    this._lights(dt);
    // 黒: 見え始めから fadeIn 秒で明ける。クリックの後は leave 秒で黒へ
    let black = 1 - smooth(t / TITLE.fadeIn);
    if (this.leaving) {
      this.leaving.t += dt;
      black = Math.max(this.leaving.b0 + (1 - this.leaving.b0) * Math.min(1, this.leaving.t / TITLE.leave), black);
    }
    this._black(black);
    this._ink(t, dt);
    if (this.leaving && this.leaving.t >= TITLE.leave) this._finish();
  }
  _black(v) { this.blackV = v; if (this.blackEl) this.blackEl.style.opacity = v.toFixed(3); }

  // ------------------------------------------------------------ クリック → 1.4 秒で黒 → 片付け → onStart
  click() {
    if (!this.active || this.leaving) return false;
    try { if (this.lock) this.lock(); } catch (e) { /* ヘッドレスなどでポインタロックできなくても進める */ }
    try { if (this.resumeAudio) this.resumeAudio(); } catch (e) { /* 同上 */ }
    this.leaving = { t: 0, b0: this.blackV ?? 1 };
    if (this.root) this.root.style.cursor = 'default';
    this.log.push({ ev: 'click', at: this.bg ? +this.bg.t.toFixed(2) : 0 });
    return true;
  }

  _finish() {
    this._restore();
    this.restored = this._capture();   // テスト: 片付けの直後(onStart の前)の状態
    if (this.onRestored) this.onRestored();
    this.active = false;
    this.leaving = null;
    this.log.push({ ev: 'start' });
    if (this.root) {
      this.root.classList.add('gone');
      setTimeout(() => { if (this.root) this.root.style.display = 'none'; }, (TITLE.handoff + 0.2) * 1000);
    }
    if (this.onStart) this.onStart();
  }

  // 片付け: 管理人・露出・霧・灯り・カメラ・視野角・懐中電灯・HUD・滴(キャンバス)を開始前へ
  _restore() {
    const s = this.snap, P = this.player, ai = this.ai, e = this.enemy;
    if (!s) return;
    this.power.manual = null; this.power.apply();
    this.renderer.toneMappingExposure = s.exposure;
    if (this.ambientFloor && s.ambient !== null) this.ambientFloor.intensity = s.ambient;
    if (s.fog && this.scene.fog) { this.scene.fog.color.copy(s.fog.c); this.scene.fog.density = s.fog.d; }
    if (this.exterior) this.exterior.force = s.extForce;
    this.camera.fov = s.fov; this.camera.updateProjectionMatrix();
    // 管理人: 開始前が眠り(第1段)なら resetAI(眠り)、止めていた(?noai)なら元の位置で止める、それ以外は EV ホールから
    e.setFace('grin', s.enemy.faceT.grin || 0, true); e.setFace('attack', s.enemy.faceT.attack || 0, true);
    e.lean = s.enemy.lean; e.faceFill = s.enemy.faceFill; e.underLight = s.enemy.underLight;
    e.aimPoint = s.enemy.aim; e.speed = s.enemy.speed;
    if (s.ai.dormant) this.resetAI(true);
    else if (s.ai.state === 'SCRIPTED') {
      if (ai.level !== s.ai.level) ai.setLevel(s.ai.level);
      e.place(s.ai.x, s.ai.z, s.ai.yaw); ai.setState('SCRIPTED', { force: true }); ai.concealed = s.ai.concealed; ai.transit = s.ai.transit;
      e.setFlashlight(s.enemy.flash);
    } else this.resetAI(false);
    e.root.visible = s.enemy.visible;
    if (this.getLevel() !== s.level) this.teleport(s.level, s.x, s.z, s.yaw, s.pitch);
    else P.setPose(s.x, s.z, s.yaw, s.pitch);
    P.setFlashlight(s.flashlight);
    P.frozen = s.frozen;
    if (this.hud) this.hud.root.style.visibility = s.hud;
    if (this.canvas) { const g = this.canvas.getContext('2d'); g.clearRect(0, 0, this.canvas.width, this.canvas.height); }
    this.bg = null;
    this.log.push({ ev: 'restore' });
  }

  // 片付けた状態の記録(テストで開始前の snap と比べる)
  _capture() {
    const P = this.player, ai = this.ai, R = this.renderer, cv = this.canvas;
    let inkCleared = true;
    if (cv && cv.width > 2) { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; for (let i = 3; i < d.length; i += 4 * 97) if (d[i]) { inkCleared = false; break; } }
    return { exposure: R.toneMappingExposure, fov: this.camera.fov, ambient: this.ambientFloor ? this.ambientFloor.intensity : null, level: this.getLevel(), x: P.pos.x, z: P.pos.z,
      ai: { state: ai.state, level: ai.level, dormant: ai.dormant, concealed: ai.concealed }, flashlight: P.flashlightOn, frozen: P.frozen,
      extForce: this.exterior ? this.exterior.force : null, manual: !!this.power.manual, lm: [...this.power._lm], em: [...this.power._em], inkCleared,
      face: { ...this.enemy.face }, hud: this.hud ? this.hud.root.style.visibility : '' };
  }

  // テスト: DOM なしで背景だけ回す(on)/片付ける(off)。?test=enemy 24
  preview(on) {
    if (on) { if (this.active) return false; this.active = true; this._startBg(); return true; }
    if (!this.bg) return false;
    this._restore(); this.active = false; this.leaving = null;
    return true;
  }

  // ------------------------------------------------------------ 文字と血(2D キャンバス 1 枚)
  _ink(t, dt) {
    const cv = this.canvas;
    if (!cv) { this._dripModel(t); return; }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(2, Math.round(window.innerWidth * dpr)), H = Math.max(2, Math.round(window.innerHeight * dpr));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; this.bg.ink = null; }
    const T = TITLE.text, size = T.size * H, cx = W / 2, cy = T.y * H;
    if (!this.bg.ink) this.bg.ink = this._layoutInk(W, H, size, cx, cy);
    const g = cv.getContext('2d');
    g.clearRect(0, 0, W, H);
    const alpha = smooth((t - T.delay) / T.in);
    if (alpha <= 0) return;
    g.save();
    g.globalAlpha = alpha;
    g.drawImage(this.bg.ink.text, 0, 0);
    g.restore();
    this._dripModel(t);
    for (const d of this.bg.drips) drawDrip(g, d, dpr, alpha);   // 太さは CSS px(3〜6px)
  }

  // 文字を描いた層と、文字の下端(列ごとの一番下の画素)から選んだ滴の起点
  _layoutInk(W, H, size, cx, cy) {
    const T = TITLE.text;
    const text = document.createElement('canvas'); text.width = W; text.height = H;
    const g = text.getContext('2d');
    const font = `400 ${size.toFixed(1)}px ${T.font}`;
    g.font = font; g.letterSpacing = `${(T.spacing * size).toFixed(1)}px`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = 'rgba(0,0,0,0.85)'; g.shadowBlur = 14 * H / 1080;
    g.fillStyle = T.color;
    const x = cx + T.spacing * size / 2;   // 字間は末尾にも付くので半分ずらして中央に(案 C と同じ)
    g.fillText(HUD_TEXT.title.name, x, cy);
    // 下端: 影なしの白で描き直して列ごとに拾う
    const m = document.createElement('canvas'); m.width = W; m.height = H;
    const mg = m.getContext('2d');
    mg.font = font; mg.letterSpacing = g.letterSpacing; mg.textAlign = 'center'; mg.textBaseline = 'middle'; mg.fillStyle = '#fff';
    mg.fillText(HUD_TEXT.title.name, x, cy);
    const y0 = Math.max(0, Math.floor(cy - size)), y1 = Math.min(H, Math.ceil(cy + size)), x0 = Math.floor(W * 0.15), x1 = Math.ceil(W * 0.85);
    const d = mg.getImageData(x0, y0, x1 - x0, y1 - y0).data, w = x1 - x0, bottoms = [];
    for (let xx = 0; xx < w; xx += 2) for (let yy = y1 - y0 - 1; yy >= 0; yy--) if (d[(yy * w + xx) * 4 + 3] > 150) { bottoms.push([x0 + xx, y0 + yy]); break; }
    this.bg.drips = null;
    this.bg.bottoms = bottoms;
    return { text, bottoms };
  }

  // 滴の伸び(時刻 t の長さ)。画面の大きさに依らない形(長さは画面の高さの割合)で持ち、描く時に px へ
  _dripModel(t) {
    const B = this.bg, D = TITLE.blood;
    if (!B.drips) {
      const R = mulberry(4 + ((this.seed ?? 0) | 0));
      const H = this.canvas ? this.canvas.height : 1080, W = this.canvas ? this.canvas.width : 1920;
      let bottoms = B.bottoms;
      if (!bottoms || !bottoms.length) bottoms = Array.from({ length: 40 }, (_, i) => [W * (0.3 + 0.4 * i / 39), H * (TITLE.text.y + 0.035)]);
      const maxY = Math.max(...bottoms.map((b) => b[1]));
      const low = bottoms.filter((b) => b[1] > maxY - TITLE.text.size * H * 0.1);
      const pool = low.length > 20 ? low : bottoms;
      const n = D.n[0] + Math.floor(R() * (D.n[1] - D.n[0] + 1));
      const used = [];
      for (const [src, gap] of [[pool, 0.026], [pool, 0.016], [bottoms, 0.016], [bottoms, 0.008]]) {   // 字画の下端(低い所)から、間隔を空けて。足りなければ緩める
        for (let i = 0; i < 400 && used.length < n; i++) {
          const b = src[(R() * src.length) | 0];
          if (used.some((u) => Math.abs(u[0] - b[0]) < W * gap)) continue;
          used.push(b);
        }
      }
      used.sort((a, b) => a[0] - b[0]);
      B.drips = used.map((b) => makeDrip(R, b[0] / W, b[1] / H, D));
    }
    for (const d of B.drips) {
      const tt = t - D.start - d.delay;
      d.len = d.L * lenAt(d, tt);
      d.done = tt >= d.T;
      d.pool = d.done ? smooth((tt - d.T) / 2.0) : 0;
    }
  }

  state() {
    const B = this.bg;
    return { active: this.active, shown: !!this.root, leaving: !!this.leaving, name: this.root ? this.root.querySelector('.name').textContent : null,
      start: this.root ? this.root.querySelector('.start').textContent : null,
      bg: B ? { t: +B.t.toFixed(2), ready: B.ready, flicks: B.flicks, outs: B.outs, lights: B.lights, black: +(this.blackV ?? 1).toFixed(3),
        drips: B.drips ? B.drips.map((d) => ({ x: +d.x.toFixed(3), len: +d.len.toFixed(4), L: +d.L.toFixed(4), w: +d.w.toFixed(2), T: +(d.delay + d.T).toFixed(2), done: d.done })) : null } : null };
  }
}

// ---------------------------------------------------------------- 滴(1 本)
// 伸びの予定: 動く区間と止まる区間を交互に(本ごとに区間の数・長さ・速さが違う)。delay + T 秒で長さ L に着く(T + delay は 20〜30 秒)
function makeDrip(R, x, y, D) {
  const done = D.done[0] + (D.done[1] - D.done[0]) * R();
  const delay = R() * 3.0, T = done - D.start - delay;
  const n = 3 + Math.floor(R() * 4);            // 動く区間の数
  const seg = [];
  for (let i = 0; i < n; i++) {
    seg.push({ move: true, w: 0.6 + R() * 1.6, d: 0.3 + R() ** 1.7 * 1.6 });     // 区間の時間の重み・進む量の重み
    if (i < n - 1) seg.push({ move: false, w: 0.4 + R() * 2.2 });
  }
  const tw = seg.reduce((a, s) => a + s.w, 0), dw = seg.reduce((a, s) => a + (s.move ? s.d : 0), 0);
  let t = 0, l = 0;
  for (const s of seg) { s.t0 = t; t += s.w / tw * T; s.t1 = t; s.l0 = l; if (s.move) l += s.d / dw; s.l1 = l; }
  const L = D.len[0] + (D.len[1] - D.len[0]) * R() ** 1.3;
  const w = D.w[0] + (D.w[1] - D.w[0]) * R();
  const k = R();
  const rgb = [90 + k * 48 | 0, 10 + R() * 8 | 0, 10 + R() * 8 | 0];   // #5a0a0a〜#8a1212
  return { x, y, L, w, T, delay, seg, rgb, wob: R() * 6.28, wobA: 0.25 + R() * 0.55, len: 0, done: false, pool: 0, k };
}
function lenAt(d, tt) {
  if (tt <= 0) return 0;
  if (tt >= d.T) return 1;
  for (const s of d.seg) {
    if (tt < s.t1) {
      if (!s.move) return s.l0;
      const u = (tt - s.t0) / (s.t1 - s.t0);
      return s.l0 + (s.l1 - s.l0) * (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u));   // 動き出しはゆっくり、流れて、また止まる
    }
  }
  return 1;
}
// 描く: 濃い輪郭 → 本体(縁が暗く中央が少し明るい。止まった所は少し太い)→ 中央寄りの細い艶(途切れる)→ 先端の玉(しずく形)→ 伸び切ったら下端の溜まり
//  太さ w は CSS px(×dpr)。長さ・位置は画面の割合
function drawDrip(g, d, px, alpha) {
  const W = g.canvas.width, H = g.canvas.height, s = px;
  const x0 = d.x * W, y0 = d.y * H, len = d.len * H, w = d.w * s;
  const [r, gg, b] = d.rgb;
  const col = (k, a) => `rgba(${Math.min(255, r * k) | 0},${Math.min(255, gg * k) | 0},${Math.min(255, b * k) | 0},${a * alpha})`;
  const base = col(1, 0.94), dark = col(0.34, 0.9), rim = col(0.22, 0.55);
  const cxAt = (y) => { const u = (y - y0) / s; return x0 + (Math.sin(u * 0.045 + d.wob) * d.wobA + Math.sin(u * 0.013 + d.wob * 1.7) * d.wobA * 1.6) * s; };
  // 止まっていた所(通り過ぎた区間)は少し膨らむ
  const beads = d.seg.filter((q) => !q.move && q.l0 * d.L * H < len - 2 * w).map((q) => y0 + q.l0 * d.L * H);
  const wAt = (y) => {
    const u = (y - y0) / s;
    let k = 0.74 + 0.1 * Math.sin(u * 0.07 + d.wob * 2) + 0.07 * Math.sin(u * 0.19 + d.wob) + 0.6 * Math.max(0, 1 - u / 7);
    for (const by of beads) k += 0.42 * Math.exp(-(((y - by) / (2.6 * w)) ** 2));
    return w * k;
  };
  g.save();
  // 文字の下端に付いた溜まり(横に平たい)
  g.fillStyle = rim; g.beginPath(); g.ellipse(x0, y0 + 0.5 * s, w * 1.15 + s, w * 0.62 + s, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = base; g.beginPath(); g.ellipse(x0, y0 + 0.5 * s, w * 1.05, w * 0.52, 0, 0, Math.PI * 2); g.fill();
  const step = Math.max(1, 1.5 * s);
  const L = [], Rr = [];
  if (len > step) for (let y = y0; y <= y0 + len; y += step) { const c = cxAt(y), hw = wAt(y) / 2; L.push([c - hw, y]); Rr.push([c + hw, y]); }
  const poly = (grow) => { g.beginPath(); g.moveTo(L[0][0] - grow, L[0][1]); for (const p of L) g.lineTo(p[0] - grow, p[1]); for (let i = Rr.length - 1; i >= 0; i--) g.lineTo(Rr[i][0] + grow, Rr[i][1]); g.closePath(); };
  // 先端の玉: しずく形(上が細く筋につながり、下が丸い)。伸び切った後は重さで少し膨らんで溜まる
  const ty = y0 + len, tx = cxAt(ty);
  const rx = w * (0.78 + 0.12 * Math.sin(d.k * 9)) * (1 + 0.45 * d.pool), ry = rx * (1.25 + 0.15 * d.pool);
  const cy = ty + ry * 0.35;
  const drop = (grow) => {
    g.beginPath();
    g.moveTo(tx - w * 0.35 - grow, ty - ry * 1.4);
    g.quadraticCurveTo(tx - rx * 0.6 - grow, ty - ry * 0.4, tx - rx - grow, cy);
    g.ellipse(tx, cy, rx + grow, ry + grow, 0, Math.PI, 0, true);
    g.quadraticCurveTo(tx + rx * 0.6 + grow, ty - ry * 0.4, tx + w * 0.35 + grow, ty - ry * 1.4);
    g.closePath();
  };
  // 輪郭(筋と玉の両方)→ 本体(筋 → 玉)の順に塗る(玉の輪郭が筋を横切らない)
  g.fillStyle = rim;
  if (L.length > 1) { poly(0.7 * s + 0.3); g.fill(); }
  drop(0.7 * s + 0.3); g.fill();
  if (L.length > 1) {
    const gr = g.createLinearGradient(x0 - w * 0.9, 0, x0 + w * 0.9, 0);
    gr.addColorStop(0, dark); gr.addColorStop(0.28, base); gr.addColorStop(0.45, col(1.04, 0.95)); gr.addColorStop(0.72, base); gr.addColorStop(1, dark);
    g.fillStyle = gr; poly(0); g.fill();
  }
  const lg = g.createLinearGradient(tx - rx * 1.05, 0, tx + rx * 1.05, 0);   // 玉も筋と同じ横の陰影(首の所が暗い帯にならない)
  lg.addColorStop(0, dark); lg.addColorStop(0.3, base); lg.addColorStop(0.5, col(1.03, 0.95)); lg.addColorStop(0.7, base); lg.addColorStop(1, dark);
  g.fillStyle = lg; drop(0); g.fill();
  const rg = g.createRadialGradient(tx - rx * 0.25, cy - ry * 0.15, 0, tx - rx * 0.25, cy - ry * 0.15, rx * 0.9);   // 玉の丸み(上寄りの明るみ)
  rg.addColorStop(0, col(1.2, 0.35)); rg.addColorStop(1, col(1.2, 0));
  g.fillStyle = rg; g.beginPath(); g.ellipse(tx, cy, rx, ry, 0, 0, Math.PI * 2); g.fill();
  if (L.length > 1) {
    // 艶: 中央より少し左の細い線(ところどころ途切れる)
    g.strokeStyle = `rgba(255,205,195,${0.24 * alpha})`; g.lineWidth = Math.max(0.6, 0.12 * w); g.lineCap = 'round';
    g.beginPath();
    let pen = false;
    for (let y = y0 + 4 * s; y < y0 + len - w * 1.2; y += step) {
      const on = Math.sin((y - y0) / s * 0.11 + d.wob * 3) + 0.6 * Math.sin((y - y0) / s * 0.031 + d.wob) > -0.35;
      const xx = cxAt(y) - wAt(y) * 0.16;
      if (on && !pen) { g.moveTo(xx, y); pen = true; } else if (on) g.lineTo(xx, y); else pen = false;
    }
    g.stroke();
  }
  g.fillStyle = `rgba(255,220,210,${0.38 * alpha})`; g.beginPath(); g.ellipse(tx - rx * 0.36, cy - ry * 0.3, Math.max(0.5, rx * 0.16), Math.max(0.6, ry * 0.22), -0.35, 0, Math.PI * 2); g.fill();
  g.restore();
}
