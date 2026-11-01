// enemy_audio.js — 管理人の音(P2b のプレースホルダ)。録音の差し替えは P4(ファイル名体系は docs/p2b/NOTES.md)。
//  - 鼻歌/唸りのループ(WebAudio でその場合成)を頭の位置から PositionalAudio で 3D 再生。
//  - 足音(接地に同期)・ノブのガチャなどを足元/扉の位置から鳴らす(P5a: 鍵束・錠の音は撤去)。
//  - 壁越し: AI の遮蔽判定(壁箱・閉扉)の結果で lowpass の cutoff を 18kHz → 600Hz へ落とす(=こもる)。
// AudioContext はユーザー操作まで suspended。main がクリック/キーで resume() を呼ぶ。

import * as THREE from 'three';

export const ENEMY_AUDIO = {
  humVolume: { PATROL: 0.55, ALERT: 0.0, CHASE: 0.9, ATTACK: 0.0, SCRIPTED: 0.55, DOOR: 0.25, LURK: 0.0 },
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
      rattle: synthRattle(this.ctx),
      scream: synthScream(this.ctx),
      hit: synthHit(this.ctx),
      breath: synthBreath(this.ctx),      // P3b 演出②: 目の前で立ち止まった時の息遣い(enemy_breath_close_01)
      handle: synthHandle(this.ctx),      // P3b 演出②: クローゼット/ロッカーの取っ手に触れる音(enemy_handle_touch_01)
      // P5a(仮音。P4 で録音に差し替え。ファイル名は docs/p5a/NOTES.md)
      crash: synthCrash(this.ctx),        // 扉を破って飛び出す(enemy_door_smash_01)
      breathDoor: synthBreathDoor(this.ctx),   // 潜伏中の扉の向こうの、ごく小さな呼吸(enemy_breath_behind_door_01)
      latch: synthLatch(this.ctx),        // 空室の扉を普通に開け閉めする(ラッチ＋蝶番のきしみ)(door_latch_creak_01)
      slam: synthSlam(this.ctx),          // ガタガタ扉: 中で何かが暴れて扉が激しく鳴る(room_door_rattle_violent_01)
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

  // name: buffers のキー('step' は 4 種から選ぶ)。pos: 世界座標
  // opts(P5a): cutoff = この音だけ固定のこもり(Hz。管理人の遮蔽に従わない＝扉・別の階の音)、ref = 距離減衰の基準距離(大きいほど遠くまで届く)、
  //  dur = この秒数で切る(長い音の一部だけ鳴らす)
  play(name, pos, volume = 1, opts = {}) {
    this.logCount = (this.logCount || 0) + 1;   // P5a: 通し番号(log は 200 件で古い物から消えるので、テストは番号で区切る)
    this.log.push({ n: this.logCount, name, t: this.ctx.currentTime, vol: +volume.toFixed(3), pos: pos ? [pos.x, pos.y, pos.z].map((v) => +v.toFixed(2)) : null, ...(opts.cutoff ? { cutoff: opts.cutoff } : {}) });
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
    a.setRefDistance(opts.ref ?? ENEMY_AUDIO.refDistance);
    a.userData.fixedCutoff = opts.cutoff || null;
    if (opts.cutoff) a.userData.lp.frequency.setValueAtTime(opts.cutoff, this.ctx.currentTime);
    a.gain.gain.cancelScheduledValues(this.ctx.currentTime);
    a.setVolume(volume * (opts.cutoff ? 1 : (1 - this.occluded * (1 - ENEMY_AUDIO.occludedGain))));
    a.play();
    if (opts.dur) a.gain.gain.setTargetAtTime(0, this.ctx.currentTime + Math.max(0.05, opts.dur - 0.25), 0.08);
  }

  update(dt) {
    if (!this.hum.isPlaying && this.ctx.state === 'running') { try { this.hum.play(); } catch (e) { /* noop */ } }
    const k = 1 - Math.exp(-dt * 5);
    this.occluded += (this.occludedTarget - this.occluded) * k;
    // cutoff は対数で補間(耳の感じ方に合わせる)
    const lc = Math.log(ENEMY_AUDIO.cutoffClear), lo = Math.log(ENEMY_AUDIO.cutoffOccluded);
    this.cutoff = Math.exp(lc + (lo - lc) * this.occluded);
    for (const a of [this.hum, ...this.pool]) a.userData.lp.frequency.setTargetAtTime(a.userData.fixedCutoff || this.cutoff, this.ctx.currentTime, 0.05);
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

// ノブのガチャ(開かない扉を確かめる)
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

// 叫び笑い(振りかぶりの瞬間): 喉を絞った「あ゛ぁぁ」。のこぎり波＋母音 a のフォルマント＋がなり(ノイズ変調)、音程が上ずる
function synthScream(ctx) {
  const sr = 24000;
  return makeBuffer(ctx, 1.3, sr, (d, sr2, n) => {
    const r = rng(31);
    let ph = 0, lp1 = 0, lp2 = 0, bp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr2;
      const f = 170 + 150 * Math.min(1, t / 0.35) + 8 * Math.sin(t * 2 * Math.PI * 7) + (r() - 0.5) * 18;
      ph += f / sr2;
      const saw = 2 * (ph - Math.floor(ph)) - 1;
      const growl = 1 + 0.5 * Math.sin(t * 2 * Math.PI * 38) * (r() * 0.5 + 0.5);
      const src = saw * growl + (r() - 0.5) * 0.6;
      // 粗い母音フィルタ(2 段のローパスとバンド強調の混合)
      lp1 += (src - lp1) * 0.22; lp2 += (lp1 - lp2) * 0.22;
      bp += ((src - lp1) - bp) * 0.35;
      const env = Math.min(1, t / 0.05) * Math.min(1, (1.3 - t) / 0.4);
      d[i] = Math.tanh((lp2 * 1.2 + bp * 0.7) * 2.2) * 0.5 * env;
    }
  });
}

// 打撃: 鈍い「ゴッ」＋骨に当たる乾いた割れ
function synthHit(ctx) {
  const sr = 24000;
  return makeBuffer(ctx, 0.5, sr, (d, sr2, n) => {
    const r = rng(53);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr2;
      const thump = Math.sin(2 * Math.PI * 55 * t * (1 - t)) * Math.exp(-t * 14);
      lp += ((r() - 0.5) - lp) * 0.5;
      const crack = lp * Math.exp(-t * 60) * 1.6;
      d[i] = Math.tanh((thump * 1.4 + crack) * 1.5) * 0.9;
    }
  });
}

// P3b: 息遣い(鼻と口から、ゆっくり吸って吐く×2。低く湿った雑音)
function synthBreath(ctx) {
  const sr = 24000;
  return makeBuffer(ctx, 4.2, sr, (d, sr2, n) => {
    const r = rng(61);
    let lp = 0, lp2 = 0;
    const cyc = [[0.0, 0.9, 0.55], [1.0, 1.1, 0.8], [2.2, 0.9, 0.5], [3.2, 0.9, 0.75]];   // [開始, 長さ, 強さ](吸う・吐く)
    for (let i = 0; i < n; i++) {
      const t = i / sr2;
      let a = 0;
      for (const [s0, len, amp] of cyc) if (t >= s0 && t < s0 + len) { const u = (t - s0) / len; a = Math.sin(Math.PI * u) ** 1.5 * amp; }
      lp += ((r() - 0.5) - lp) * 0.18; lp2 += (lp - lp2) * 0.3;
      d[i] = (lp2 * 1.6 + (lp - lp2) * 0.6) * a;
    }
  });
}

// P3b: 取っ手に触れる(爪が当たる小さな金属音と、わずかに引く擦れ)
function synthHandle(ctx) {
  const sr = 24000;
  return makeBuffer(ctx, 0.5, sr, (d, sr2, n) => {
    const r = rng(71);
    for (const [s0, f, a] of [[0.0, 3100, 0.5], [0.07, 2400, 0.35], [0.2, 1800, 0.25]]) {
      const i0 = Math.round(s0 * sr2);
      for (let i = i0; i < n; i++) { const t = (i - i0) / sr2; d[i] += a * Math.exp(-t * 60) * (Math.sin(2 * Math.PI * f * t) * 0.7 + (r() - 0.5) * 0.4); }
    }
  });
}

// ------------------------------------------------------------ P5a(仮音)
// 扉を破る: 低い衝撃(体当たり)＋板の裂ける音(広帯域の割れ)＋木片の細かい弾け＋金具の転がる尾
function synthCrash(ctx) {
  const sr = 24000;
  return makeBuffer(ctx, 1.8, sr, (d, sr2, n) => {
    const r = rng(907);
    let lp = 0, lp2 = 0;
    const cracks = Array.from({ length: 34 }, () => [0.02 + r() ** 1.6 * 0.75, 0.2 + r() * 0.8, 900 + r() * 3800]);
    for (let i = 0; i < n; i++) {
      const t = i / sr2;
      const thump = Math.sin(2 * Math.PI * 48 * t * (1 - 0.5 * t)) * Math.exp(-t * 9) * 1.2 + Math.sin(2 * Math.PI * 95 * t) * Math.exp(-t * 16) * 0.5;
      lp += ((r() - 0.5) - lp) * 0.35; lp2 += (lp - lp2) * 0.12;
      const split = (r() - 0.5) * Math.exp(-t * 7) * 1.1 + lp * Math.exp(-t * 4) * 1.4;
      const body = lp2 * Math.exp(-t * 2.2) * 2.2;
      d[i] = thump + split + body;
    }
    for (const [s0, a, f] of cracks) {
      const i0 = Math.round(s0 * sr2);
      for (let i = i0; i < Math.min(n, i0 + sr2 * 0.05); i++) { const t = (i - i0) / sr2; d[i] += a * Math.exp(-t * 120) * (Math.sin(2 * Math.PI * f * t) * 0.5 + (r() - 0.5)) * 0.6; }
    }
    // 金具(ラッチの受け)が床に落ちて跳ねる
    for (const [s0, a] of [[0.55, 0.35], [0.74, 0.22], [0.86, 0.13], [0.93, 0.08]]) {
      const i0 = Math.round(s0 * sr2);
      for (let i = i0; i < n; i++) { const t = (i - i0) / sr2; d[i] += a * Math.exp(-t * 40) * Math.sin(2 * Math.PI * 2900 * t) * 0.5; }
    }
    for (let i = 0; i < n; i++) d[i] = Math.tanh(d[i] * 1.3) * 0.9;
  });
}
// 扉の向こうの呼吸: 鼻からの長い吸気と、ゆっくりの呼気。ごく低く、こもった雑音(呼吸 1 回 ≈3.6 秒)
function synthBreathDoor(ctx) {
  const sr = 24000;
  return makeBuffer(ctx, 3.8, sr, (d, sr2, n) => {
    const r = rng(83);
    let lp = 0, lp2 = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr2;
      let a = 0;
      if (t < 1.5) a = Math.sin(Math.PI * t / 1.5) ** 1.8 * 0.6; else if (t > 1.8 && t < 3.6) a = Math.sin(Math.PI * (t - 1.8) / 1.8) ** 1.4 * 0.9;
      lp += ((r() - 0.5) - lp) * 0.08; lp2 += (lp - lp2) * 0.15;
      d[i] = lp2 * 3.0 * a;
    }
  });
}
// 空室の扉を普通に開け閉め: ラッチの「カチャ」＋短い蝶番のきしみ
function synthLatch(ctx) {
  const sr = 24000;
  return makeBuffer(ctx, 1.1, sr, (d, sr2, n) => {
    const r = rng(17);
    for (const [s0, a, f] of [[0.0, 0.5, 1700], [0.05, 0.35, 2400]]) {
      const i0 = Math.round(s0 * sr2);
      for (let i = i0; i < n; i++) { const t = (i - i0) / sr2; d[i] += a * Math.exp(-t * 80) * (Math.sin(2 * Math.PI * f * t) * 0.6 + (r() - 0.5) * 0.7) * 0.6; }
    }
    let ph = 0;
    for (let i = Math.round(0.18 * sr2); i < n; i++) {
      const t = (i - 0.18 * sr2) / sr2;
      const f = 620 - 160 * t + 25 * Math.sin(t * 2 * Math.PI * 9);
      ph += f / sr2;
      const env = Math.min(1, t / 0.06) * Math.max(0, 1 - t / 0.8);
      d[i] += Math.sin(2 * Math.PI * ph) * (0.5 + 0.5 * Math.sin(t * 2 * Math.PI * 31)) * env * 0.08;
    }
  });
}
// ガタガタ: 扉板が掛け金に当たる重い連打(2 Hz の波の中に 11〜15 Hz)＋ノブの金属のガチャつき。5 秒(短く切って使う)
function synthSlam(ctx) {
  const sr = 24000;
  return makeBuffer(ctx, 5.0, sr, (d, sr2, n) => {
    const r = rng(311);
    const hits = [];
    for (let t = 0.02; t < 4.9;) {
      const surge = Math.max(0, Math.sin(t * 2 * Math.PI * 1.9)) ** 2;
      hits.push([t, 0.25 + 0.75 * surge * (0.6 + 0.4 * r())]);
      t += surge > 0.3 ? 1 / (11 + r() * 4) : 0.09 + r() * 0.08;
    }
    for (const [s0, a] of hits) {
      const i0 = Math.round(s0 * sr2);
      const f = 85 + r() * 30;
      for (let i = i0; i < Math.min(n, i0 + sr2 * 0.12); i++) {
        const t = (i - i0) / sr2;
        d[i] += a * (Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 30) * 0.9 + (r() - 0.5) * Math.exp(-t * 90) * 0.8 + Math.sin(2 * Math.PI * (1800 + r() * 900) * t) * Math.exp(-t * 70) * 0.15);
      }
    }
    for (let i = 0; i < n; i++) { const t = i / sr2; d[i] = Math.tanh(d[i] * 1.4) * 0.8 * Math.min(1, t / 0.05) * Math.min(1, (5.0 - t) / 0.3); }
  });
}
