// tutorial.js — P5a: 管理人の行動パターンの説明(仮。DESIGN §3.8 冒頭「チュートリアルで説明する」)。
//  ゲーム開始直後に短い文字カードを 1 枚ずつ出す(クリック/Esc/Enter/Space で次へ)。最後のカードを送ると閉じ、いつもの「クリックで開始」へ。
//  既読は持たない(毎回出す)。?notutorial・?tour・?test=… では出さない。文言は hud_text.js の tutorial(P6 で正文化)。
//  表示中はゲームの時間を止める(main が active を見て step を止める)。

import { HUD_TEXT } from './hud_text.js';

const CSS = `
#tut { position: fixed; inset: 0; z-index: 7; display: flex; align-items: center; justify-content: center; background: rgba(2,3,5,.72);
  font-family: -apple-system, "Hiragino Sans", "Hiragino Kaku Gothic ProN", sans-serif; color: #e4ded4; cursor: pointer; opacity: 0; transition: opacity .35s linear; }
#tut.on { opacity: 1; }
#tut .card { width: min(560px, 86vw); padding: 30px 34px 22px; background: rgba(10,11,13,.86); border: 1px solid rgba(228,222,212,.16); border-radius: 3px; }
#tut .title { font: 500 19px/1.3 "Hiragino Mincho ProN", "Yu Mincho", serif; letter-spacing: .32em; color: #d9d0c2; margin-bottom: 16px; }
#tut .body { font-size: 15px; line-height: 1.95; letter-spacing: .06em; white-space: pre-line; color: #cfc8bd; }
#tut .foot { display: flex; justify-content: space-between; margin-top: 22px; font-size: 11px; letter-spacing: .14em; color: #8b857c; }
`;

export class Tutorial {
  constructor({ cards = HUD_TEXT.tutorial, onDone = null } = {}) {
    this.cards = cards;
    this.onDone = onDone;
    this.index = -1;
    this.active = false;
    this.log = [];
  }

  start() {
    if (!this.root) {
      const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
      this.root = document.createElement('div'); this.root.id = 'tut';
      this.root.innerHTML = '<div class="card"><div class="title"></div><div class="body"></div><div class="foot"><span class="page"></span><span class="next"></span></div></div>';
      document.body.appendChild(this.root);
      this.root.addEventListener('click', (e) => { e.stopPropagation(); this.next(); });
      this._key = (e) => { if (!this.active) return; if (['Escape', 'Enter', 'Space'].includes(e.code)) { e.preventDefault(); e.stopPropagation(); this.next(); } };
      window.addEventListener('keydown', this._key, true);
    }
    this.root.style.display = ''; this.root.style.pointerEvents = '';
    this.active = true;
    this.index = -1;
    this.next();
    requestAnimationFrame(() => this.root.classList.add('on'));
    this.root.classList.add('on');
  }

  next() {
    if (!this.active) return;
    this.index++;
    if (this.index >= this.cards.length) { this.close(); return; }
    const c = this.cards[this.index];
    this.root.querySelector('.title').textContent = c.title;
    this.root.querySelector('.body').textContent = c.body;
    this.root.querySelector('.page').textContent = `${this.index + 1} / ${this.cards.length}`;
    this.root.querySelector('.next').textContent = HUD_TEXT.tutorialNext;
    this.log.push({ ev: 'card', index: this.index, title: c.title });
  }

  close() {
    this.active = false;
    if (this.root) { this.root.classList.remove('on'); this.root.style.pointerEvents = 'none'; setTimeout(() => { if (!this.active && this.root) this.root.style.display = 'none'; }, 400); }
    this.log.push({ ev: 'close' });
    if (this.onDone) this.onDone();
  }

  state() { return { active: this.active, index: this.index, count: this.cards.length, title: this.active ? this.cards[this.index].title : null }; }
}
