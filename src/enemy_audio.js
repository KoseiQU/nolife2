// enemy_audio.js — 管理人の音(P2b のプレースホルダ)。録音の差し替えは P4(ファイル名体系は docs/p2b/NOTES.md)。
//  - 鼻歌/唸りのループ(WebAudio でその場合成)を頭の位置から PositionalAudio で 3D 再生。
//  - 足音(接地に同期)・鍵束・錠・ノブのガチャを足元/扉の位置から鳴らす。
//  - 壁越し: AI の遮蔽判定(壁箱・閉扉)の結果で lowpass の cutoff を 18kHz → 600Hz へ落とす(=こもる)。
// AudioContext はユーザー操作まで suspended。main がクリック/キーで resume() を呼ぶ。

import * as THREE from 'three';

export const ENEMY_AUDIO = {
  humVolume: { PATROL: 0.55, ALERT: 0.0, CHASE: 0.9, ATTACK: 0.0, SCRIPTED: 0.55, DOOR: 0.25 },
  stepVolume: { walk: 0.7, run: 1.0 },
  refDistance: 1.4,
  rolloff: 1.3,
  maxDistance: 40,
  cutoffClear: 18000,
  cutoffOccluded: 600,
  occludedGain: 0.55,
};

export class EnemyAudio {
  constructor(camera, enemy) {
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);
    this.ctx = this.listener.context;
    this.enemy = enemy;
    this.occluded = 0;          // 0..1(なめらかに追従)
    this.occludedTarget = 0;
    this.humTarget = 0;
    this.buffers = {
      hum: synthHum(this.ctx),
      steps: [0, 1, 2, 3].map((i) => synthStep(this.ctx, i)),
      keys: synthKeys(this.ctx),
      lock: synthLock(this.ctx),
      rattle: synthRattle(this.ctx),
    };
    this.hum = this._makeSource(enemy.bones.head, true);
    this.hum.setBuffer(this.buffers.hum);
    this.hum.setLoop(true);
    this.hum.setVolume(0);
    this.pool = Array.from({ length: 6 }, () => this._makeSource(null, false));
    this._poolIdx = 0;
    this.log = [];              // 鳴らした音の記録(テスト用)
  }

  _makeSource(parent, isHum) {
    const a = new THREE.PositionalAudio(this.listener);
    a.setRefDistance(ENEMY_AUDIO.refDistance);
    a.setRolloffFactor(ENEMY_AUDIO.rolloff);
    a.setMaxDistance(ENEMY_AUDIO.maxDistance);
    a.setDistanceModel('inverse');
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = ENEMY_AUDIO.cutoffClear;
    lp.Q.value = 0.5;
    a.setFilter(lp);
    a.userData.lp = lp;
    a.userData.isHum = isHum;
    (parent || this.enemy.scene).add(a);
    return a;
  }

  resume() {
    if (this.ctx.state !== 'running') this.ctx.resume();
    if (!this.hum.isPlaying && this.ctx.state === 'running') { try { this.hum.play(); } catch (e) { /* 後で再試行 */ } }
  }

  setState(state) { this.humTarget = ENEMY_AUDIO.humVolume[state] ?? 0; }
  setOccluded(v) { this.occludedTarget = v ? 1 : 0; }

  // name: 'step'|'keys'|'lock'|'rattle'。pos: 世界座標
  play(name, pos, volume = 1) {
    this.log.push({ name, t: this.ctx.currentTime, pos: pos ? [pos.x, pos.y, pos.z].map((v) => +v.toFixed(2)) : null });
    if (this.log.length > 200) this.log.shift();
    if (this.ctx.state !== 'running') return;
    const buf = name === 'step' ? this.buffers.steps[(Math.random() * 4) | 0] : this.buffers[name];
    if (!buf) return;
    const a = this.pool[this._poolIdx++ % this.pool.length];
    if (a.isPlaying) a.stop();
    a.position.copy(pos);
    a.updateMatrixWorld();
    a.setBuffer(buf);
    a.setLoop(false);
    a.setPlaybackRate(name === 'step' ? 0.92 + Math.random() * 0.16 : 1);
    a.setVolume(volume * (1 - this.occluded * (1 - ENEMY_AUDIO.occludedGain)));
    a.play();
  }

  update(dt) {
    if (!this.hum.isPlaying && this.ctx.state === 'running') { try { this.hum.play(); } catch (e) { /* noop */ } }
    const k = 1 - Math.exp(-dt * 5);
    this.occluded += (this.occludedTarget - this.occluded) * k;
    // cutoff は対数で補間(耳の感じ方に合わせる)
    const lc = Math.log(ENEMY_AUDIO.cutoffClear), lo = Math.log(ENEMY_AUDIO.cutoffOccluded);
    this.cutoff = Math.exp(lc + (lo - lc) * this.occluded);
    for (const a of [this.hum, ...this.pool]) a.userData.lp.frequency.setTargetAtTime(this.cutoff, this.ctx.currentTime, 0.05);
    const gOcc = 1 - this.occluded * (1 - ENEMY_AUDIO.occludedGain);
    const cur = this.hum.getVolume();
    const want = this.humTarget * gOcc;
    this.hum.setVolume(cur + (want - cur) * (1 - Math.exp(-dt * 2.5)));
  }
}

// ------------------------------------------------------------ 合成(プレースホルダ)
function makeBuffer(ctx, seconds, sr, fill) {
  const n = Math.round(seconds * sr);
  const buf = ctx.createBuffer(1, n, sr);
  fill(buf.getChannelData(0), sr, n);
  return buf;
}
function rng(seed) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }

// 低い男声の鼻歌(口を閉じた「んー」)。旋律は短調の数音、句の間に息継ぎ。約 11 秒でループ
function synthHum(ctx) {
  const sr = 24000;
  // [開始秒, 長さ, 半音(D2=0)]
  const notes = [[0.2, 1.4, 5], [1.6, 0.9, 3], [2.5, 2.0, 0], [5.1, 1.1, 3], [6.2, 0.8, 5], [7.0, 0.7, 7], [7.7, 2.3, 5]];
  const f0 = 73.42;
  return makeBuffer(ctx, 11.0, sr, (d, sr2, n) => {
    const r = rng(11);
    let phase = 0, fcur = f0;
    for (let i = 0; i < n; i++) {
      const t = i / sr2;
      let amp = 0, semi = 0;
      for (let j = 0; j < notes.length; j++) {
        const [s, len, st] = notes[j];
        if (t >= s - 0.12 && t < s + len + 0.15) {
          const a = Math.min(1, (t - (s - 0.12)) / 0.12) * Math.min(1, (s + len + 0.15 - t) / 0.25);
          if (a > amp) { amp = a; semi = st; }
        }
      }
      // 音程の滑らかな移り(ポルタメント)はフェーズ積分の周波数をなまらせて作る
      const target = f0 * Math.pow(2, semi / 12);
      fcur += (target - fcur) * 0.0025;
      const vib = 1 + 0.006 * Math.sin(t * 2 * Math.PI * 4.7) + 0.004 * Math.sin(t * 2 * Math.PI * 0.7);
      phase += (2 * Math.PI * fcur * vib) / sr2;
      // 鼻音: 低次倍音が強く、1kHz より上は急に落ちる
      let s = 0;
      for (let h = 1; h <= 14; h++) {
        const fh = fcur * h;
        const formant = Math.exp(-((fh - 260) ** 2) / (2 * 140 ** 2)) * 1.0 + Math.exp(-((fh - 1000) ** 2) / (2 * 200 ** 2)) * 0.12 + 0.18 / h;
        s += Math.sin(phase * h) * formant / Math.sqrt(h);
      }
      const breath = (r() - 0.5) * 0.02 * amp;
      d[i] = (s * 0.22 + breath) * amp;
    }
  });
}

// 足音: 作業靴の踵(低い「ドッ」)＋長尺シートの擦れ
function synthStep(ctx, seed) {
  const sr = 24000;
  return makeBuffer(ctx, 0.28, sr, (d, sr2, n) => {
    const r = rng(101 + seed * 7);
    let lpN = 0;
    const f = 70 + seed * 6;
    for (let i = 0; i < n; i++) {
      const t = i / sr2;
      const thump = Math.sin(2 * Math.PI * f * t * (1 - t * 0.8)) * Math.exp(-t * 38);
      lpN += ((r() - 0.5) - lpN) * 0.25;
      const scuff = lpN * Math.exp(-((t - 0.035) ** 2) / (2 * 0.02 ** 2)) * 0.9;
      const click = (r() - 0.5) * Math.exp(-t * 400) * 0.5;
      d[i] = (thump * 0.8 + scuff + click) * 0.8;
    }
  });
}

// 鍵束: 金属の小片が触れ合う不規則な高音(1.4 秒)
function synthKeys(ctx) {
  const sr = 24000;
  return makeBuffer(ctx, 1.5, sr, (d, sr2, n) => {
    const r = rng(77);
    const hits = Array.from({ length: 26 }, () => [r() * 1.3, 0.3 + r() * 0.7, 2600 + r() * 3200, 4100 + r() * 3500]);
    for (const [s, a, f1, f2] of hits) {
      const i0 = Math.round(s * sr2);
      for (let i = i0; i < Math.min(n, i0 + sr2 * 0.12); i++) {
        const t = (i - i0) / sr2;
        d[i] += a * Math.exp(-t * 55) * (Math.sin(2 * Math.PI * f1 * t) * 0.6 + Math.sin(2 * Math.PI * f2 * t) * 0.4) * 0.35;
      }
    }
  });
}

// 錠: 鍵を差して回す「カチャッ…ガチン」
function synthLock(ctx) {
  const sr = 24000;
  return makeBuffer(ctx, 0.7, sr, (d, sr2, n) => {
    const r = rng(5);
    const clicks = [[0.0, 0.4, 1900], [0.09, 0.3, 2600], [0.38, 1.0, 1200], [0.41, 0.6, 2300]];
    for (const [s, a, f] of clicks) {
      const i0 = Math.round(s * sr2);
      for (let i = i0; i < n; i++) {
        const t = (i - i0) / sr2;
        d[i] += a * Math.exp(-t * 70) * (Math.sin(2 * Math.PI * f * t) * 0.6 + (r() - 0.5) * 0.8) * 0.5;
      }
    }
  });
}

// ノブのガチャ(施錠扉を確かめる)
function synthRattle(ctx) {
  const sr = 24000;
  return makeBuffer(ctx, 0.6, sr, (d, sr2, n) => {
    const r = rng(9);
    for (const s of [0, 0.13, 0.27]) {
      const i0 = Math.round(s * sr2);
      for (let i = i0; i < n; i++) {
        const t = (i - i0) / sr2;
        d[i] += Math.exp(-t * 45) * (Math.sin(2 * Math.PI * 900 * t) * 0.4 + (r() - 0.5) * 0.9) * 0.45;
      }
    }
  });
}
