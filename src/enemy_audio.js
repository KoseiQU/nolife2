// enemy_audio.js — 管理人の音(P2b のプレースホルダ → P4b で採用した音に接続)。
//  - P4b: play(名前) は ROUTE で場面へ振り分ける。採用した場面は AudioBank(src/audio_bank.js)の wav／声、「なし」の場面は無音(記録だけ残す)、
//    3 周目の選択待ちの場面は下の合成の仮音のまま。対応表は docs/p4b/NOTES.md §2。
//  - P4a: 常時ループの鼻歌/唸り(hum = enemy_hum_loop_01)は削除(ユーザー所見「ずっと流れているジーという音」の正体)。
//    管理人の気配は間欠的な音(足音・息・取っ手…)だけで出す。置き換えの音は P4b(samples/sound.html の選択)で決める。
//  - 足音(接地に同期)・ノブのガチャなどを足元/扉の位置から鳴らす(P5a: 鍵束・錠の音は撤去)。
//  - 壁越し: AI の遮蔽判定(壁箱・閉扉)の結果で lowpass の cutoff を 18kHz → 600Hz へ落とす(=こもる)。
// AudioContext はユーザー操作まで suspended。main がクリック/キーで resume() を呼ぶ。

import * as THREE from 'three';

// P4b: 名前 → 場面 ID(採用 = AudioBank で鳴らす)/ null(なし = 無音)/ 'temp'(3 周目の選択待ち = 合成の仮音)
export const ROUTE = {
  step: 'temp',                    // enemy_step_walk(3 周目)。走り(opts.run)は enemy_step_run(採用 C)
  run: 'enemy_step_run',
  crash: 'enemy_door_smash',       // 採用 C(爆発のように調整)
  hit: 'enemy_hit',                // 採用 A(より重く調整)
  breathDoor: 'enemy_breath_door', // 採用 B(声。笑い・台詞を足して 3 本を順に)
  x105_scream: 'x105_scream',      // 採用 C(声。105 の追跡の始まり・B1 の戻りの遠い悲鳴)
  rattle: null,                    // door_locked なし(開かない扉・管理人がノブを確かめる)
  handle: null,                    // enemy_handle なし
  latch: null,                     // enemy_door_latch なし
  scream: 'temp',                  // enemy_scream(3 周目)
  slam: 'temp',                    // room_door_rattle(3 周目)
  breath: 'temp',                  // enemy_breath_close(3 周目)
};

export const ENEMY_AUDIO = {
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
    this.state = null;          // AI の状態(記録のみ。P4a で常時ループを削除したので音量には使わない)
    this.bank = null;           // P4b: AudioBank(main が渡す)。採用した場面はここで鳴らす
    // 3 周目の選択待ちの場面の仮音(合成)。採用・なしの場面の合成は P4b で外した(rattle・handle・latch・crash・hit・breathDoor)
    this.buffers = {
      steps: [0, 1, 2, 3].map((i) => synthStep(this.ctx, i)),   // enemy_step_walk(3 周目)
      scream: synthScream(this.ctx),                             // enemy_scream(3 周目)
      breath: synthBreath(this.ctx),      // P3b 演出②: 目の前で立ち止まった時の息遣い(enemy_breath_close。3 周目)
      slam: synthSlam(this.ctx),          // ガタガタ扉: 中で何かが暴れて扉が激しく鳴る(room_door_rattle。3 周目)
    };
    this.pool = Array.from({ length: 6 }, () => this._makeSource());
    this._poolIdx = 0;
    this.log = [];              // 鳴らした音の記録(テスト用)
  }

  _makeSource() {
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
    this.enemy.scene.add(a);
    return a;
  }

  resume() {
    if (this.ctx.state !== 'running') this.ctx.resume();
  }

  setState(state) { this.state = state; }
  setOccluded(v) { this.occludedTarget = v ? 1 : 0; }

  // name: buffers のキー('step' は 4 種から選ぶ)。pos: 世界座標
  // opts(P5a): cutoff = この音だけ固定のこもり(Hz。管理人の遮蔽に従わない＝扉・別の階の音)、ref = 距離減衰の基準距離(大きいほど遠くまで届く)、
  //  dur = この秒数で切る(長い音の一部だけ鳴らす)
  play(name, pos, volume = 1, opts = {}) {
    // P4b: 走り(opts.run)は別の場面。記録の名前は今まで通り(テストが 'step' などで数える)
    const route = name === 'step' && opts.run ? ROUTE.run : (name in ROUTE ? ROUTE[name] : 'temp');
    this.logCount = (this.logCount || 0) + 1;   // P5a: 通し番号(log は 200 件で古い物から消えるので、テストは番号で区切る)
    this.log.push({ n: this.logCount, name, t: this.ctx.currentTime, vol: +volume.toFixed(3), pos: pos ? [pos.x, pos.y, pos.z].map((v) => +v.toFixed(2)) : null, ...(opts.cutoff ? { cutoff: opts.cutoff } : {}),
      ...(route === null ? { silent: true } : route !== 'temp' ? { scene: route } : {}) });
    if (this.log.length > 200) this.log.shift();
    if (route === null) return;                     // 「なし」の場面
    if (route !== 'temp') {                         // 採用した場面(wav / 声)。壁越しは今のこもり(遮蔽の仕組み)を固定の cutoff として渡す
      if (!this.bank) return;
      const occ = !opts.cutoff;
      const o = { pos, vol: volume * (occ ? (1 - this.occluded * (1 - ENEMY_AUDIO.occludedGain)) : 1), ref: opts.ref ?? ENEMY_AUDIO.refDistance, rolloff: ENEMY_AUDIO.rolloff,
        cutoff: opts.cutoff || (this.cutoff && this.cutoff < 17000 ? this.cutoff : 0), dur: opts.dur };
      if (this.bank.status(route) === 'voice') { if (route === ROUTE.breathDoor) o.cutoff = 0; this.bank.voice(route, o); }   // 扉越しのこもりは声の加工に入っている
      else this.bank.play(route, o);
      return;
    }
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
    const k = 1 - Math.exp(-dt * 5);
    this.occluded += (this.occludedTarget - this.occluded) * k;
    // cutoff は対数で補間(耳の感じ方に合わせる)
    const lc = Math.log(ENEMY_AUDIO.cutoffClear), lo = Math.log(ENEMY_AUDIO.cutoffOccluded);
    this.cutoff = Math.exp(lc + (lo - lc) * this.occluded);
    for (const a of this.pool) a.userData.lp.frequency.setTargetAtTime(a.userData.fixedCutoff || this.cutoff, this.ctx.currentTime, 0.05);
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
