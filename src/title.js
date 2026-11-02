// title.js — P6a: タイトル画面(DESIGN §7 P6a ①)。起動直後、黒地に「NOLIFE」と小さく「クリックで開始」。音楽なし。
//  表記は「NOLIFE」(2026-11-02 ユーザー指示。「2」は付けない)。装飾は控えめ: 明朝体・小さい文字・ゆっくりフェード。
//  クリックで ポインタロック と AudioContext の開始を兼ねる(既存の「クリックで開始」を置き換える)→ onStart(チュートリアルか通常プレイ)。
//  表示中はゲームの時間を止める(main が active を見て step を止める)。テストは click() を呼ぶ。

import { HUD_TEXT } from './hud_text.js';

const CSS = `
#title { position: fixed; inset: 0; z-index: 30; background: #000; display: flex; flex-direction: column; align-items: center; justify-content: center;
  cursor: pointer; opacity: 1; transition: opacity 1.4s ease; user-select: none; }
#title.out { opacity: 0; pointer-events: none; }
#title .name { font: 400 34px/1 "Hiragino Mincho ProN", "Yu Mincho", "YuMincho", serif; letter-spacing: .62em; padding-left: .62em; color: #a9a196;
  opacity: 0; transition: opacity 3.2s ease .4s; }
#title .start { margin-top: 46px; font: 400 12px/1 "Hiragino Mincho ProN", "Yu Mincho", serif; letter-spacing: .4em; padding-left: .4em; color: #6f6960;
  opacity: 0; transition: opacity 2.4s ease 2.0s; }
#title.on .name { opacity: 1; }
#title.on .start { opacity: .85; animation: titleBreathe 4.2s ease-in-out 4.4s infinite; }
@keyframes titleBreathe { 0%, 100% { opacity: .85; } 50% { opacity: .35; } }
`;

export class Title {
  // ctx: { show(bool), lock()(ポインタロック), resumeAudio(), onStart() }
  constructor(ctx) {
    Object.assign(this, ctx);
    this.active = !!ctx.show;
    this.log = [];
    if (!this.active) return;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    this.root = document.createElement('div'); this.root.id = 'title';
    this.root.innerHTML = `<div class="name"></div><div class="start"></div>`;
    this.root.querySelector('.name').textContent = HUD_TEXT.title.name;
    this.root.querySelector('.start').textContent = HUD_TEXT.title.start;
    document.body.appendChild(this.root);
    requestAnimationFrame(() => requestAnimationFrame(() => this.root && this.root.classList.add('on')));
    this.root.addEventListener('click', () => this.click());
    this.log.push({ ev: 'show' });
  }

  click() {
    if (!this.active) return false;
    this.active = false;
    try { if (this.lock) this.lock(); } catch (e) { /* ヘッドレスなどでポインタロックできなくても進める */ }
    try { if (this.resumeAudio) this.resumeAudio(); } catch (e) { /* 同上 */ }
    this.root.classList.add('out');
    setTimeout(() => { if (this.root) this.root.style.display = 'none'; }, 1600);
    this.log.push({ ev: 'click' });
    if (this.onStart) this.onStart();
    return true;
  }

  state() {
    return { active: this.active, shown: !!this.root, name: this.root ? this.root.querySelector('.name').textContent : null,
      start: this.root ? this.root.querySelector('.start').textContent : null };
  }
}
