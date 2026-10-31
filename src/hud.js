// hud.js — 画面ガイド(P2e, DESIGN §7 P2e)。文言は hud_text.js に集約。
//  - 文脈ヒント: 視線の先 1.5m 以内の対象(扉・ドアスコープ・EV 呼びボタン)だけ、照準の少し下に小さく(半透明の黒帯＋白文字、0.15s フェード)
//  - 一時表示: 「鍵がかかっている」「反応がない」「懐中電灯 ON/OFF」など 1 秒
//  - 開始時の操作一覧(6 秒で消える。H で 2 秒再表示)、中央の「クリックで開始/再開」
//  - 覗き穴視点・襲撃ムービー・死亡演出の間は文脈ヒントを隠す(覗き穴中は画面下端に「E を離す やめる」だけ)
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
#hud-center { top: 50%; transform: translate(-50%, -50%); font-size: 16px; letter-spacing: .2em; padding: 9px 20px; }
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
      + '<div class="pill" id="hud-release"></div><div class="pill" id="hud-controls"></div><div class="pill" id="hud-center"></div>';
    document.body.appendChild(this.root);
    this.el = {
      dot: this.root.querySelector('#hud-dot'), hint: this.root.querySelector('#hud-hint'), toast: this.root.querySelector('#hud-toast'),
      release: this.root.querySelector('#hud-release'), controls: this.root.querySelector('#hud-controls'), center: this.root.querySelector('#hud-center'),
    };
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
  flash(text, sec = HUD.flashSec) {
    this.el.toast.textContent = text;
    this.toastT = sec;
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
    this._lastFlashlight = fl;

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
    this.controlsT = Math.max(0, this.controlsT - dt);
    this.el.controls.classList.toggle('on', this.controlsT > 0 && !hidden && !peeping);

    const center = this.isDead() ? '' : !this.started ? TX.start : !this.locked ? TX.resume : '';
    if (center) this.el.center.textContent = center;
    this.el.center.classList.toggle('on', !!center && !this.isMovie());
    this.el.dot.style.opacity = (hidden || peeping || !this.locked) ? '0' : '1';
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
    const items = [];
    let badge = null, kind = null;
    if (this.canPeep()) { items.push(TX.scope.peep); kind = 'scope'; }
    if (door && door.operable) {
      const p = this.player.pos;
      // その扉の部屋の中にいる(P3b: 入れる部屋すべて。410 だけだった判定を一般化)
      const inside = this.inRoomOf ? this.inRoomOf(door) : this.inRoom410 ? this.inRoom410() : (p.x > 7.86 && p.z > 5.8 && p.z < 8.7);
      const open = door.target > 0 || door.angle > 0.05;
      if (open) items.push(TX.door.close);
      else if (door.locked) { if (inside) items.push(TX.door.unlock); badge = TX.door.lockedBadge; }
      else { items.push(TX.door.open); if (inside) items.push(TX.door.lock); }
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
    };
  }
}
