// hud.js — 画面ガイド(P2e, DESIGN §7 P2e)。文言は hud_text.js に集約。
//  - 文脈ヒント: 視線の先 1.5m 以内の対象(扉・ドアスコープ・EV 呼びボタン)だけ、照準の少し下に小さく(半透明の黒帯＋白文字、0.15s フェード)
//  - 一時表示: 「鍵がかかっている」「反応がない」「懐中電灯 ON/OFF」など 1 秒
//  - 開始時の操作一覧(6 秒で消える。H で 2 秒再表示)、中央の「クリックで開始/再開」
//  - 覗き穴視点・襲撃ムービー・死亡演出の間は文脈ヒントを隠す(覗き穴中は画面下端に「E を離す やめる」だけ)
//  - P6b(§3.9 #6): 左上の目標表示は文字 1.6 倍・下に薄い半透明の帯。章が変わる時 3 秒強調(明滅 2 回)。持ち物の札も同じ比率
//  - P6b(§3.9 #8): 右下に懐中電灯の ON/OFF の常時表示(ON = 琥珀色・OFF = 灰色、切替の 1 秒は明るく)。
//    タイトル・チュートリアル(root ごと隠れる)・死亡・ムービー・エンディング・隠れ中は出さない
// update(dt) 駆動(rAF 非依存。手動ポンプでも決定的に変わる)。

import * as THREE from 'three';
import { HUD_TEXT as TX } from './hud_text.js';

export const HUD = {
  reach: 1.5,          // 扉ヒントの距離
  scopeReach: 1.2,     // ドアスコープ(正対)
  evReach: 1.2,        // EV 呼びボタン
  facing: 0.6,         // 視線と対象方向の cos(これ以上で「見ている」)
  flashSec: 1.0,
  controlsSec: 6.0,
  controlsKeySec: 2.0,
  objEmSec: 3.0,       // P6b #6: 章が変わる時の強調(明滅 2 回を含む)
  lightPulseSec: 1.0,  // P6b #8: 懐中電灯を切り替えた時に表示を明るくする時間
};

const CSS = `
#hud { position: fixed; inset: 0; pointer-events: none; font-family: -apple-system, "Hiragino Sans", "Hiragino Kaku Gothic ProN", sans-serif; color: #eae6df; z-index: 5; }
#hud .pill { position: absolute; left: 50%; transform: translateX(-50%); white-space: nowrap; background: rgba(6,7,9,.58); border-radius: 3px;
  padding: 5px 12px; font-size: 15px; line-height: 1.4; letter-spacing: .06em; opacity: 0; transition: opacity .15s linear; }
#hud .pill.on { opacity: 1; }
#hud .k { display: inline-block; min-width: 1.2em; padding: 0 5px; margin-right: 6px; border: 1px solid rgba(234,230,223,.55); border-radius: 2px;
  font-size: 12px; line-height: 1.5; text-align: center; color: #fff; }
#hud .sep { display: inline-block; width: 18px; }
#hud .badge { margin-left: 12px; font-size: 12px; color: #d9c48c; }
#hud-hint { top: calc(50% + 34px); }
#hud-toast { top: calc(50% + 70px); font-size: 14px; }
#hud-release { bottom: 3.5vh; font-size: 13px; }
#hud-controls { bottom: 6vh; font-size: 13px; letter-spacing: .1em; padding: 7px 16px; white-space: normal; width: max-content; max-width: 92vw; text-align: center; }
#hud-whisper { bottom: 15vh; font-size: 14px; letter-spacing: .2em; background: rgba(6,7,9,.42); color: #d8d2c8; transition: opacity .5s linear; }
#hud-notice { top: 13vh; font-size: 13px; letter-spacing: .14em; background: rgba(6,7,9,.42); color: #d8d2c8; transition: opacity .6s linear; }
#hud-center { top: 50%; transform: translate(-50%, -50%); font-size: 16px; letter-spacing: .2em; padding: 9px 20px; }
#hud-tl { position: absolute; left: 18px; top: 16px; display: flex; flex-direction: column; align-items: flex-start; gap: 7px; }
#hud-obj { font-size: 21px; line-height: 1.35; letter-spacing: .12em; color: #e2dccf; opacity: .9; text-shadow: 0 1px 3px rgba(0,0,0,.9);
  background: rgba(0,0,0,.35); border-radius: 5px; padding: 4px 13px 5px;
  transition: color .35s ease, opacity .35s ease, background-color .35s ease; white-space: nowrap; }
#hud-obj.em { color: #fff6e2; opacity: 1; background: rgba(0,0,0,.5); animation: hudObjBlink .75s ease-in-out .15s 2; }
#hud-obj.off { opacity: 0; animation: none; }
@keyframes hudObjBlink { 0%, 100% { opacity: 1; } 50% { opacity: .22; } }
#hud-item { font-size: 19px; letter-spacing: .1em; color: #d9c48c; background: rgba(6,7,9,.45); border: 1px solid rgba(217,196,140,.35);
  border-radius: 3px; padding: 2px 12px 3px; opacity: 0; transition: opacity .3s linear; }
#hud-item.on { opacity: .9; }
#hud-light { position: absolute; right: 20px; bottom: 18px; display: flex; align-items: center; gap: 8px; padding: 4px 11px 4px 9px; border-radius: 5px;
  background: rgba(0,0,0,.3); font-size: 13px; letter-spacing: .12em; color: #7d7a74; opacity: 0; transition: opacity .3s linear, color .25s linear, background-color .25s linear; }
#hud-light svg { width: 22px; height: 14px; display: block; }
#hud-light .beam { opacity: 0; transition: opacity .25s linear; }
#hud-light.shown { opacity: .62; }
#hud-light.on { color: #e3a648; }
#hud-light.on .beam { opacity: .75; }
#hud-light.shown.pulse { opacity: 1; background: rgba(0,0,0,.5); }
#hud-light.on.pulse { color: #ffc56a; }
#hud-light.pulse:not(.on) { color: #b9b5ad; }
#hud-run { position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-50%); padding: 18px 0; text-align: center; background: rgba(0,0,0,.55);
  font-size: 34px; font-weight: 600; letter-spacing: .16em; color: #fff3dc; text-shadow: 0 2px 6px rgba(0,0,0,.9); opacity: 0; transition: opacity .2s linear; }
#hud-run.on { opacity: 1; }
#hud-banner { position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-50%); padding: 16px 0; text-align: center; background: rgba(0,0,0,.55);
  font-size: 26px; font-weight: 600; letter-spacing: .14em; color: #fff3dc; text-shadow: 0 2px 6px rgba(0,0,0,.9); opacity: 0; transition: opacity .3s linear; }
#hud-banner.on { opacity: 1; }
#hud-dot { position: absolute; left: 50%; top: 50%; width: 3px; height: 3px; margin: -1.5px 0 0 -1.5px; border-radius: 50%; background: rgba(234,230,223,.45); }
`;

export class Hud {
  // ctx: { camera, player, doors, lens, evPanel(Vector3|null), canPeep(), peepKey()→'E'|'P'|null, isMovie(), isDead() }
  constructor(ctx) {
    Object.assign(this, ctx);
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = '<div id="hud-dot"></div><div class="pill" id="hud-hint"></div><div class="pill" id="hud-toast"></div>'
      + '<div class="pill" id="hud-release"></div><div class="pill" id="hud-controls"></div><div class="pill" id="hud-center"></div><div class="pill" id="hud-notice"></div><div class="pill" id="hud-whisper"></div>'
      + '<div id="hud-tl"><div id="hud-obj" class="off"></div><div id="hud-item"></div></div><div id="hud-run"></div><div id="hud-banner"></div>'
      + '<div id="hud-light"><svg viewBox="0 0 22 14" aria-hidden="true"><path class="beam" d="M15 4.2 L22 0.5 L22 13.5 L15 9.8 Z" fill="currentColor"/>'
      + '<rect x="0.5" y="5" width="8.5" height="4" rx="1" fill="currentColor"/><path d="M9 4.2 L14.5 3 L14.5 11 L9 9.8 Z" fill="currentColor"/></svg><span></span></div>';
    document.body.appendChild(this.root);
    this.el = {
      dot: this.root.querySelector('#hud-dot'), hint: this.root.querySelector('#hud-hint'), toast: this.root.querySelector('#hud-toast'),
      release: this.root.querySelector('#hud-release'), controls: this.root.querySelector('#hud-controls'), center: this.root.querySelector('#hud-center'),
      notice: this.root.querySelector('#hud-notice'),
      whisper: this.root.querySelector('#hud-whisper'),   // P6b-D: 画面下の小さな一言(地下の作業場「ライトを消して動くな」)
      obj: this.root.querySelector('#hud-obj'), item: this.root.querySelector('#hud-item'),
      light: this.root.querySelector('#hud-light'), lightText: this.root.querySelector('#hud-light span'),
      run: this.root.querySelector('#hud-run'),
      banner: this.root.querySelector('#hud-banner'),   // P6b-D: 画面中央の帯つきの一文(鎖が掛かった時。時間は止めない)   // P6b-A2(§3.9 #18): 221 の初回の「Shift＋W で走って逃げろ！」(画面中央・大きめ・帯)
    };
    this.lightPulseT = 0; this._lightKey = '';   // P6b #8
    this.objective = ''; this.objEmT = 0; this.objLog = []; this.itemText = '';   // P5b-1
    this.noticeT = 0;
    this.noticeLog = [];
    this.whisperT = 0; this.whisperLog = [];   // P6b-D
    this.bannerT = 0; this.bannerLog = [];     // P6b-D
    this.el.controls.textContent = TX.controls;
    this.started = false;
    this.locked = false;
    this.toastT = 0;
    this.controlsT = 0;
    this.target = null;          // 現在の対象 { kind, door?, items }
    this._hintKey = '';
    this._lastFlashlight = null;
    this._fwd = new THREE.Vector3();
  }

  // ---------------------------------------------------------------- 外部から
  // P6b-A2(§3.9 #18): 走り確認の表示(出している間は main が時間を止める)
  runPrompt(on) {
    this.el.run.textContent = TX.runGate;
    this.el.run.classList.toggle('on', !!on);
  }
  flash(text, sec = HUD.flashSec) {
    this.el.toast.textContent = text;
    this.toastT = sec;
  }
  // P6b-D: 画面中央の帯つきの一文(#18 の走り確認と同じ作り。sec 秒で消える。時間は止めない)
  banner(text, sec = 3.5) {
    this.el.banner.textContent = text;
    this.bannerT = sec;
    this.bannerLog.push({ text, sec });
  }
  // P6b-D: 画面下の小さな一言(sec 秒)
  whisper(text, sec = 2.5) {
    this.el.whisper.textContent = text;
    this.whisperT = sec;
    this.whisperLog.push({ text, sec });
  }
  // P5a: 画面上部の小さなお知らせ(管理人が同じ階に来た時など。3 秒)
  notice(text, sec = 3.0) {
    this.el.notice.textContent = text;
    this.noticeT = sec;
    this.noticeLog.push({ text, sec });
  }
  // P5b-1: 目標(一文)。文言が変わった時だけ em 秒強調する(章が変わる時)。空文字で隠す
  setObjective(text, em = HUD.objEmSec) {
    text = text || '';
    if (text === this.objective) return;
    this.objective = text;
    this.el.obj.textContent = text;
    this.objEmT = text ? em : 0;
    if (text) { this.el.obj.classList.remove('em'); void this.el.obj.offsetWidth; }   // P6b #6: 続けて変わった時も明滅をやり直す
    this.objLog.push({ text });
  }
  // P5b-1: 持ち物の札(null で隠す)
  setItem(text) {
    text = text || '';
    if (text === this.itemText) return;
    this.itemText = text;
    if (text) this.el.item.textContent = text;
  }
  showControls(sec = HUD.controlsKeySec) { this.controlsT = Math.max(this.controlsT, sec); }
  setPointer(locked) {
    if (locked && !this.started) { this.started = true; this.showControls(HUD.controlsSec); }
    this.locked = locked;
  }
  // E を押した時: 開かない扉なら「鍵がかかっている」。EV(呼びボタン・行き先ボタン)なら true(表示は main が出す。P3a で EV が動くようになった)
  onUse(result) {
    if (this.target && (this.target.kind === 'ev' || this.target.kind === 'evbutton')) return true;
    if (result && result.locked) this.flash(TX.door.lockedOther);
    return false;
  }

  // ---------------------------------------------------------------- 毎フレーム
  update(dt) {
    const hidden = this.isMovie() || this.isDead();
    const peeping = !!this.peepKey();
    // 懐中電灯の切替
    const fl = this.player.flashlightOn;
    if (this._lastFlashlight !== null && fl !== this._lastFlashlight && !hidden) this.flash(fl ? TX.flashlight.on : TX.flashlight.off);
    if (this._lastFlashlight !== null && fl !== this._lastFlashlight) this.lightPulseT = HUD.lightPulseSec;
    this._lastFlashlight = fl;
    // P6b #8: 右下の懐中電灯の表示
    this.lightPulseT = Math.max(0, this.lightPulseT - dt);
    const lightShown = this._lightVisible(hidden);
    const lk = fl ? 'on' : 'off';
    if (lk !== this._lightKey) { this._lightKey = lk; this.el.lightText.textContent = fl ? TX.flashlight.on : TX.flashlight.off; }
    this.el.light.classList.toggle('on', fl);
    this.el.light.classList.toggle('shown', lightShown);
    this.el.light.classList.toggle('pulse', lightShown && this.lightPulseT > 0);

    this.target = (hidden || peeping) ? null : this._findTarget();
    const html = this.target ? this._render(this.target.items, this.target.badge) : '';
    if (html !== this._hintKey) { if (html) this.el.hint.innerHTML = html; this._hintKey = html; }
    this.el.hint.classList.toggle('on', !!html);

    // 覗き穴中は「離す」案内だけ
    const rel = peeping && !hidden ? (this.peepKey() === 'P' ? TX.scope.releaseP : TX.scope.release) : null;
    if (rel) this.el.release.innerHTML = this._render([rel]);
    this.el.release.classList.toggle('on', !!rel);

    this.toastT = Math.max(0, this.toastT - dt);
    this.el.toast.classList.toggle('on', this.toastT > 0 && !hidden && !peeping);
    this.noticeT = Math.max(0, this.noticeT - dt);
    this.el.notice.classList.toggle('on', this.noticeT > 0 && !hidden && !peeping);
    this.bannerT = Math.max(0, this.bannerT - dt);
    this.el.banner.classList.toggle('on', this.bannerT > 0 && !this.isDead());
    this.whisperT = Math.max(0, this.whisperT - dt);
    this.el.whisper.classList.toggle('on', this.whisperT > 0 && !hidden && !peeping);
    this.objEmT = Math.max(0, this.objEmT - dt);
    const showObj = !!this.objective && !this.isDead() && !(this.isEnding && this.isEnding());
    this.el.obj.classList.toggle('off', !showObj);
    this.el.obj.classList.toggle('em', showObj && this.objEmT > 0);
    this.el.item.classList.toggle('on', !!this.itemText && showObj && !hidden);
    this.controlsT = Math.max(0, this.controlsT - dt);
    this.el.controls.classList.toggle('on', this.controlsT > 0 && !hidden && !peeping);

    const center = this.isDead() ? '' : !this.started ? TX.start : !this.locked ? TX.resume : '';
    if (center) this.el.center.textContent = center;
    this.el.center.classList.toggle('on', !!center && !this.isMovie());
    this.el.dot.style.opacity = (hidden || peeping || !this.locked) ? '0' : '1';
  }

  // P6b #8: 懐中電灯の表示を出すか(タイトル・死亡・ムービー・エンディング・隠れ中は出さない。チュートリアル中は root ごと隠れている)
  _lightVisible(hidden) {
    if (hidden) return false;
    if (this.isEnding && this.isEnding()) return false;
    if (this.player && this.player.hidden) return false;   // 隠れ中(rooms.hide が player.hidden を立てる)
    if (this.root.style.visibility === 'hidden') return false;
    const t = document.getElementById('title');
    if (t && !t.classList.contains('out')) return false;
    return true;
  }

  _render(items, badge) {
    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const parts = items.map((it) => (typeof it === 'string' ? esc(it) : `<span class="k">${esc(it.key)}</span>${esc(it.text)}`));
    return parts.join('<span class="sep"></span>') + (badge ? `<span class="badge">${esc(badge)}</span>` : '');
  }

  // 視線の先の対象(優先: ドアスコープ ＞ 扉 ＞ EV ボタン)
  _findTarget() {
    const cam = this.camera;
    const fwd = cam.getWorldDirection(this._fwd); fwd.y = 0; fwd.normalize();
    const cx = cam.position.x, cz = cam.position.z;
    const look = (x, z, reach) => {
      const dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz);
      if (d > reach) return -1;
      return (dx * fwd.x + dz * fwd.z) / Math.max(d, 1e-4) >= HUD.facing ? d : -1;
    };
    // 扉
    let door = null, bd = 1e9;
    for (const dd of this.doors) {
      const c = dd.collision; if (!c) continue;
      const d = look((c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2, HUD.reach);
      if (d >= 0 && d < bd) { bd = d; door = dd; }
    }
    // P5b-1: 物語の物(鍵・メモ・鍵穴・キーボックス・車・南京錠・別空間の扉)は扉や覗き穴より先
    if (this.storyTarget) { const st = this.storyTarget(); if (st) return st; }
    const items = [];
    const badge = null;
    let kind = null;
    if (this.canPeep()) { items.push(TX.scope.peep); kind = 'scope'; }
    if (door && door.operable) {
      // P5a: 施錠/解錠のヒントと「施錠中」の印は撤去(施錠要素の全廃、DESIGN §3.8 B)
      const open = door.target > 0 || door.angle > 0.05;
      items.push(open ? TX.door.close : TX.door.open);
      kind = kind || 'door';
    } else if (door && door.tryable) {
      items.push(TX.door.open);   // P3a-2: 開かない扉(地下の鉄扉)。試すと「鍵がかかっている」
      kind = kind || 'door';
    }
    if (!kind && this.extraTarget) { const t = this.extraTarget(); if (t) return t; }   // P3a: カゴの行き先ボタン・階段
    if (!kind && this.evPanel && Math.abs(this.evPanel.y - cam.position.y) < 1.6 && look(this.evPanel.x, this.evPanel.z, HUD.evReach) >= 0) { items.push(TX.ev.call); kind = 'ev'; }
    if (!kind) return null;
    if (!items.length && !badge) return null;
    return { kind, door, items, badge };
  }

  state() {
    return {
      hint: this.el.hint.classList.contains('on') ? this.el.hint.textContent : '',
      kind: this.target ? this.target.kind : null,
      toast: this.el.toast.classList.contains('on') ? this.el.toast.textContent : '',
      release: this.el.release.classList.contains('on') ? this.el.release.textContent : '',
      controls: this.el.controls.classList.contains('on'),
      center: this.el.center.classList.contains('on') ? this.el.center.textContent : '',
      runPrompt: this.el.run.classList.contains('on') ? this.el.run.textContent : '',   // P6b-A2
      notice: this.el.notice.classList.contains('on') ? this.el.notice.textContent : '',
      whisper: this.el.whisper.classList.contains('on') ? this.el.whisper.textContent : '',   // P6b-D
      banner: this.el.banner.classList.contains('on') ? this.el.banner.textContent : '',      // P6b-D
      objective: this.el.obj.classList.contains('off') ? '' : this.objective,
      objectiveEm: this.el.obj.classList.contains('em'),
      item: this.el.item.classList.contains('on') ? this.itemText : '',
      light: { shown: this.el.light.classList.contains('shown'), on: this.el.light.classList.contains('on'), pulse: this.el.light.classList.contains('pulse'), text: this.el.lightText.textContent },
    };
  }
}
