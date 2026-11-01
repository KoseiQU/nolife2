// sound_lib.js — NOLIFE 2 の音の候補(P4a サンプル盤)。すべて WebAudio の合成で自作(録音素材なし・CC0 扱い)。
//
// 使い方(P4b もこのまま再利用する):
//   import { SCENES, renderCandidate, encodeWav } from './sound_lib.js';
//   const cand = SCENES.find((s) => s.id === 'ev_chime').cands.find((c) => c.id === 'b');
//   cand.render(ctx, dest, t0);                   // 生の AudioContext / OfflineAudioContext のどちらにも組める(dest に繋ぐ)
//   const buf = await renderCandidate(cand);       // OfflineAudioContext で描いて正規化した AudioBuffer(48kHz モノラル)
//   const wav = encodeWav(buf);                    // 16bit PCM の .wav(ArrayBuffer)
//
// 約束:
//  - 乱数は候補ごとに固定の種(場面 id + 候補 id のハッシュ)。何度描いても同じ波形になる(書き出しの再現性)。
//  - 正規化は renderCandidate がやる: ピーク −6dBFS を上限に、RMS が上限(効果音 −18 / 環境音 −26 / 静けさ −36 dBFS)を超えないよう下げる。
//    「静けさ」の候補(quiet)はピーク −20dBFS まで。ゲーム内の最終的な音量は P4b の接続側で決める。
//  - 環境音(amb)はループ前提の長さ(10 秒前後)。P4b でループの継ぎ目(頭と尻のクロスフェード)を付ける。

export const SR = 48000;
export const NORM = {
  sfx: { peakDb: -6, rmsDb: -18 },
  amb: { peakDb: -6, rmsDb: -26 },
  quiet: { peakDb: -20, rmsDb: -36 },
};
const db = (d) => Math.pow(10, d / 20);

function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// ================================================================ 合成の道具箱
// t は候補の頭からの秒。to は繋ぎ先(既定 = 候補の出口)。
export class Kit {
  constructor(ctx, dest, t0 = 0, seed = 1) {
    this.c = ctx; this.t0 = t0; this.r = rng(seed); this.sr = ctx.sampleRate;
    this.out = ctx.createGain(); this.out.connect(dest);
    this._nb = {};
  }
  rnd(a = 0, b = 1) { return a + (b - a) * this.r(); }
  T(t) { return this.t0 + Math.max(0, t); }
  gain(v = 1, to) { const g = this.c.createGain(); g.gain.value = v; if (to) g.connect(to); return g; }
  filt(type, f, q = 0.707, to, gdb = 0) { const b = this.c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.gain.value = gdb; if (to) b.connect(to); return b; }
  // こもり(壁越し・水中): lowpass を挟んだ入口を返す
  muf(f = 500, vol = 1, to = this.out) { return this.filt('lowpass', f, 0.7, this.gain(vol, to)); }
  // 残響: 種付きノイズの IR。rt = 残響時間(−60dB までの秒)、damp = 高域の減り(0..1)
  verb(rt = 1.5, wet = 0.4, damp = 0.5, to = this.out) {
    const n = Math.ceil(this.sr * rt), b = this.c.createBuffer(1, n, this.sr), d = b.getChannelData(0);
    let lp = 0;
    for (let i = 0; i < n; i++) { const w = this.r() * 2 - 1; lp += (w - lp) * (1 - damp * (i / n) * 0.95); d[i] = lp * Math.exp((-6.9 * i) / n); }
    const cv = this.c.createConvolver(); cv.buffer = b; cv.connect(this.gain(wet, to));
    return cv;
  }
  // 反響(遠い壁・シャフト)
  echo(time = 0.25, fb = 0.35, f = 2000, to = this.out) {
    const dl = this.c.createDelay(2); dl.delayTime.value = time;
    const g = this.gain(fb), lp = this.filt('lowpass', f);
    dl.connect(lp); lp.connect(g); g.connect(dl); lp.connect(to);
    return dl;
  }
  // 送り: node を dry(to)と wet(fx)の両方へ
  split(to, fx, amt = 0.5) { const g = this.gain(1, to); g.connect(this.gain(amt, fx)); return g; }
  ramp(param, t, dur, v1, v2, exp = true) {
    param.setValueAtTime(v1, this.T(t));
    if (exp) param.exponentialRampToValueAtTime(Math.max(1e-4, v2), this.T(t + dur)); else param.linearRampToValueAtTime(v2, this.T(t + dur));
  }
  // 包絡: 打撃型(立ち上がり a、その後 d 秒で −35dB へ)
  penv(t, a, d, v, to) {
    const g = this.gain(0, to);
    g.gain.setValueAtTime(0, this.T(t)); g.gain.linearRampToValueAtTime(v, this.T(t + a)); g.gain.setTargetAtTime(0, this.T(t + a), Math.max(0.002, d / 4));
    return g;
  }
  // 包絡: 形(u=0..1 → 0..1)を dur 秒にわたって
  shape(t, dur, v, fn, to, n = 128) {
    const g = this.gain(0, to), arr = new Float32Array(n);
    for (let i = 0; i < n; i++) arr[i] = Math.max(0, fn(i / (n - 1))) * v;
    g.gain.setValueAtTime(0, this.T(t)); g.gain.setValueCurveAtTime(arr, this.T(t) + 1e-4, Math.max(0.01, dur));
    return g;
  }
  noiseBuf(color = 'white') {
    if (this._nb[color]) return this._nb[color];
    const n = this.sr * 3, b = this.c.createBuffer(1, n, this.sr), d = b.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, br = 0;
    for (let i = 0; i < n; i++) {
      const w = this.r() * 2 - 1;
      if (color === 'pink') { b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.25; }
      else if (color === 'brown') { br = (br + 0.02 * w) / 1.02; d[i] = br * 3.5; }
      else d[i] = w;
    }
    return (this._nb[color] = b);
  }
  buf(dur, fill) { const n = Math.max(1, Math.ceil(dur * this.sr)), b = this.c.createBuffer(1, n, this.sr); fill(b.getChannelData(0), this.sr, n); return b; }
  play(buffer, t, to = this.out, rate = 1) { const s = this.c.createBufferSource(); s.buffer = buffer; s.playbackRate.value = rate; s.connect(to); s.start(this.T(t)); return s; }

  // ノイズの一打/うねり。env: 'perc'(既定)| 'swell'(sin^p の山)| 'flat'(dur の間一定、端だけ 10ms)
  nz(t, dur, o = {}) {
    const { color = 'white', type = 'bandpass', f = 1000, f2, q = 1, vol = 0.5, a = 0.002, env = 'perc', p = 1.5, to = this.out, rate = 1 } = o;
    const s = this.c.createBufferSource(); s.buffer = this.noiseBuf(color); s.loop = true; s.playbackRate.value = rate;
    const fl = this.filt(type, f, q);
    if (f2) this.ramp(fl.frequency, t, env === 'perc' ? dur * 0.6 : dur, f, f2);
    const g = env === 'perc' ? this.penv(t, a, dur, vol, to)
      : env === 'flat' ? this.shape(t, dur, vol, (u) => Math.min(1, u * dur / 0.01, (1 - u) * dur / 0.01), to)
        : this.shape(t, dur, vol, (u) => Math.pow(Math.sin(Math.PI * u), p), to);
    s.connect(fl); fl.connect(g);
    s.start(this.T(t), this.rnd(0, 2.5)); s.stop(this.T(t + dur * (env === 'perc' ? 1.6 : 1) + 0.05));
    return g;
  }
  // 音程のある一打/持続(f→f2 の指数スイープ)
  tn(t, dur, o = {}) {
    const { type = 'sine', f = 440, f2, vol = 0.3, a = 0.003, env = 'perc', p = 1.5, to = this.out, lpf, vib, vibd = 0.01 } = o;
    const os = this.c.createOscillator(); os.type = type;
    if (f2) this.ramp(os.frequency, t, dur, f, f2); else os.frequency.value = f;
    if (vib) { const l = this.c.createOscillator(); l.frequency.value = vib; const lg = this.gain(f * vibd); l.connect(lg); lg.connect(os.frequency); l.start(this.T(t)); l.stop(this.T(t + dur * 1.6 + 0.1)); }
    const g = env === 'perc' ? this.penv(t, a, dur, vol, to)
      : env === 'flat' ? this.shape(t, dur, vol, (u) => Math.min(1, u * dur / 0.02, (1 - u) * dur / 0.05), to)
        : this.shape(t, dur, vol, (u) => Math.pow(Math.sin(Math.PI * u), p), to);
    if (lpf) { const l = this.filt('lowpass', lpf, 0.7); os.connect(l); l.connect(g); } else os.connect(g);
    os.start(this.T(t)); os.stop(this.T(t + dur * (env === 'perc' ? 1.6 : 1) + 0.05));
    return g;
  }
  // 固有振動の和(金属・ガラス・陶器・ベル)。modes = [[周波数, 減衰秒, 振幅], ...]
  modal(t, modes, vol = 0.3, to = this.out, strike = 0.15) {
    for (const [f, d, a] of modes) this.tn(t, d, { f, vol: vol * a, a: 0.0015, to });
    if (strike) this.nz(t, 0.015, { type: 'highpass', f: 2500, vol: vol * strike, to });
  }
  // 粒(紙・砂利・泡立ち・パチパチ): rate 粒/秒、len 粒の長さ(秒)
  grains(t, dur, o = {}) {
    const { rate = 60, len = 0.004, f = 3000, q = 0.8, type = 'bandpass', vol = 0.4, p = 1, to = this.out, tone = 0 } = o;
    const b = this.buf(dur, (d, sr, n) => {
      let x = 0;
      while (x < dur) {
        const i0 = (x * sr) | 0, L = Math.max(4, (len * (0.5 + this.r()) * sr) | 0), amp = (0.3 + 0.7 * this.r()) * Math.pow(Math.sin(Math.PI * Math.min(1, x / dur)), p);
        const ft = tone ? tone * (0.7 + 0.6 * this.r()) : 0;
        for (let k = 0; k < L && i0 + k < n; k++) { const e = Math.exp((-5 * k) / L); d[i0 + k] += amp * e * (ft ? Math.sin((2 * Math.PI * ft * k) / sr) : this.r() * 2 - 1); }
        x += (-Math.log(1 - this.r() * 0.999) / rate);
      }
    });
    const fl = this.filt(type, f, q, this.gain(vol, to));
    this.play(b, t, fl);
  }
  // 摩擦の軋み(木・蝶番・鉄): スティックスリップ。粒(「ギ」の一つ)ごとに f(と f2)で減衰振動する。
  //  rate→rate2 = 粒の速さ(毎秒。遅いほど「ギ…ギ…」、速いほど「ギーー」)、q = 響きの長さ、jit = 粒の間隔の揺らぎ
  creak(t, dur, o = {}) {
    const { rate = 70, rate2, jit = 0.35, f = 900, q = 5, f2 = 0, vol = 0.5, p = 0.6, to = this.out } = o;
    const b = this.buf(dur, (d, sr, n) => {
      const tau = (q / (Math.PI * f)) * sr, L = Math.min(Math.ceil(tau * 5), sr * 0.2);
      let x = 0;
      while (x < dur) {
        const u = x / dur, rr = rate * (1 - u) + (rate2 ?? rate) * u, i = (x * sr) | 0, amp = Math.pow(Math.sin(Math.PI * u), p) * (0.4 + 0.6 * this.r());
        const fa = f * (1 + 0.04 * (this.r() - 0.5)), fb = f2 * (1 + 0.04 * (this.r() - 0.5)), w1 = (2 * Math.PI * fa) / sr, w2 = (2 * Math.PI * fb) / sr;
        for (let k = 0; k < L && i + k < n; k++) {
          const e = Math.exp(-k / tau);
          d[i + k] += amp * (e * (Math.sin(w1 * k) + (f2 ? 0.6 * Math.sin(w2 * k) : 0)) + (this.r() * 2 - 1) * Math.exp(-k / 6) * 0.3);
        }
        x += (1 / rr) * (1 + jit * (this.r() * 2 - 1));
      }
    });
    this.play(b, t, this.filt('highpass', 120, 0.7, this.gain(vol, to)));
  }
  // 声(喉): のこぎり波 → 歪み → フォルマントの並列 bandpass。fc(u) は f0 の倍率の曲線
  voice(t, dur, o = {}) {
    const { f0 = 120, fc = () => 1, vib = 5, vibd = 0.01, form = [[700, 6, 1], [1150, 8, 0.6], [2700, 10, 0.25]], vol = 0.3, drive = 2, breath = 0.15, a = 0.05, rel = 0.3, to = this.out, gate } = o;
    const os = this.c.createOscillator(); os.type = 'sawtooth';
    const arr = new Float32Array(128); for (let i = 0; i < 128; i++) arr[i] = f0 * fc(i / 127);
    os.frequency.setValueAtTime(arr[0], this.T(t)); os.frequency.setValueCurveAtTime(arr, this.T(t) + 1e-4, dur);
    const l = this.c.createOscillator(); l.frequency.value = vib; const lg = this.gain(f0 * vibd); l.connect(lg); lg.connect(os.frequency);
    const ws = this.c.createWaveShaper(), cv = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; cv[i] = Math.tanh(x * drive); } ws.curve = cv;
    const env = this.shape(t, dur, vol, (u) => Math.min(1, (u * dur) / a, ((1 - u) * dur) / rel) * (gate ? gate(u) : 1), to);
    os.connect(ws);
    for (const [f, q, g] of form) { const bp = this.filt('bandpass', f, q); ws.connect(bp); bp.connect(this.gain(g, env)); }
    os.start(this.T(t)); l.start(this.T(t)); os.stop(this.T(t + dur + 0.05)); l.stop(this.T(t + dur + 0.05));
    if (breath) this.nz(t, dur, { color: 'pink', f: form[0][0] * 1.6, q: 0.9, vol: vol * breath * 3, env: 'swell', p: 0.5, to });
  }
  // 環境の床(ループ前提のノイズの層)。lfo = [速さHz, 深さ0..1] のうねり、fade = 頭と尻のフェード秒
  bed(dur, o = {}) {
    const { color = 'pink', type = 'lowpass', f = 400, q = 0.7, vol = 0.3, lfo, fade = 0.6, to = this.out, t = 0 } = o;
    const s = this.c.createBufferSource(); s.buffer = this.noiseBuf(color); s.loop = true;
    const fl = this.filt(type, f, q);
    const g = this.shape(t, dur, vol, (u) => Math.min(1, (u * dur) / fade, ((1 - u) * dur) / fade), to);
    if (lfo) {
      const m = this.gain(1 - lfo[1] / 2); const l = this.c.createOscillator(); l.frequency.value = lfo[0];
      const lg = this.gain(lfo[1] / 2); l.connect(lg); lg.connect(m.gain); l.start(this.T(t)); l.stop(this.T(t + dur + 0.05));
      s.connect(fl); fl.connect(m); m.connect(g);
    } else { s.connect(fl); fl.connect(g); }
    s.start(this.T(t), this.rnd(0, 2.5)); s.stop(this.T(t + dur + 0.05));
    return fl;
  }
}

// ================================================================ よく使う形
function walk(K, n, gap, fn, jit = 0.07, t0 = 0.15) { let t = t0; for (let i = 0; i < n; i++) { fn(t, i, i % 2 ? 0.82 : 1); t += gap * (1 + K.rnd(-jit, jit)); } }
// 打撃の基本形: 低い胴鳴り(f→f/1.6)＋表面のノイズ
function knock(K, t, o = {}) {
  const { f = 90, d = 0.12, vol = 0.6, nf = 1500, nq = 1, nd = 0.03, nv = 0.4, to = K.out } = o;
  K.tn(t, d, { f: f * 1.6, f2: f, vol, to });
  K.nz(t, nd, { f: nf, q: nq, vol: nv, to });
}
// 鍵束(小さな金属片が当たり合う)
function jingle(K, t, dur, n = 10, vol = 0.25, to = K.out) {
  for (let i = 0; i < n; i++) {
    const tt = t + Math.pow(K.r(), 1.4) * dur, f = K.rnd(2600, 6200);
    K.modal(tt, [[f, K.rnd(0.05, 0.14), 1], [f * 2.76, 0.04, 0.4], [f * 1.41, 0.06, 0.3]], vol * K.rnd(0.4, 1), to, 0.3);
  }
}
// 紙のこすれ・くしゃ
function paper(K, t, dur, vol = 0.4, crisp = 1, to = K.out) {
  K.grains(t, dur, { rate: 90 * crisp, len: 0.006, f: 3500, q: 0.6, vol, to });
  K.nz(t, dur, { type: 'highpass', f: 2500, vol: vol * 0.35, env: 'swell', p: 0.8, to });
}
// 木の扉のラッチ(カチャ)
function latch(K, t, vol = 0.5, f = 1700, to = K.out) {
  K.modal(t, [[f, 0.05, 1], [f * 1.48, 0.04, 0.6], [f * 2.9, 0.03, 0.3]], vol, to, 0.6);
  K.modal(t + 0.045, [[f * 1.3, 0.04, 0.8], [f * 2.1, 0.03, 0.4]], vol * 0.7, to, 0.4);
}
// 板の家鳴り(建物がきしむ、遠く)
function houseCreak(K, t, vol = 0.3, to = K.out) { K.creak(t, K.rnd(0.25, 0.7), { rate: K.rnd(25, 60), rate2: K.rnd(15, 45), f: K.rnd(250, 600), q: 4, vol, to }); }
// 心拍(ドッ、ドクン)
function heart(K, t, vol = 0.7, to = K.out) { K.tn(t, 0.16, { f: 70, f2: 40, vol, to }); K.tn(t + 0.18, 0.2, { f: 60, f2: 35, vol: vol * 0.7, to }); }
// 泡
function bubbles(K, t, dur, rate = 12, vol = 0.3, to = K.out) {
  const b = K.buf(dur, (d, sr, n) => {
    let x = 0;
    while (x < dur) {
      const f = K.rnd(300, 1400), L = (0.03 + K.r() * 0.05) * sr, i0 = (x * sr) | 0, amp = 0.3 + 0.7 * K.r();
      let ph = 0;
      for (let k = 0; k < L && i0 + k < n; k++) { ph += (2 * Math.PI * f * (1 + (k / L) * 1.2)) / sr; d[i0 + k] += amp * Math.sin(ph) * Math.exp((-6 * k) / L); }
      x += -Math.log(1 - K.r() * 0.999) / rate;
    }
  });
  K.play(b, t, K.gain(vol, to));
}
// 虫(コオロギ系の鳴き: 4〜5kHz の短い連続パルス)
function cricket(K, t, dur, f = 4600, vol = 0.12, to = K.out) {
  const b = K.buf(dur, (d, sr, n) => {
    let x = K.rnd(0, 0.5);
    while (x < dur) {
      const pulses = 3 + ((K.r() * 3) | 0);
      for (let p = 0; p < pulses; p++) {
        const i0 = ((x + p * 0.028) * sr) | 0, L = 0.018 * sr;
        for (let k = 0; k < L && i0 + k < n; k++) d[i0 + k] += Math.sin((2 * Math.PI * f * k) / sr) * Math.sin((Math.PI * k) / L);
      }
      x += 0.35 + K.r() * 0.6 + (K.r() < 0.15 ? 1.5 : 0);
    }
  });
  K.play(b, t, K.gain(vol, to));
}
// エンジン(点火パルスの列)。rpm(u) は回転数の曲線、cyl 気筒数
function engine(K, t, dur, rpm, o = {}) {
  const { cyl = 4, rough = 0.15, f = 300, vol = 0.5, to = K.out } = o;
  const b = K.buf(dur, (d, sr, n) => {
    let x = 0;
    while (x < dur) {
      const u = x / dur, fire = (rpm(u) / 60) * (cyl / 2), i0 = (x * sr) | 0, L = Math.min(0.04, 1 / fire) * sr, amp = 0.6 + rough * (K.r() * 2 - 1);
      for (let k = 0; k < L && i0 + k < n; k++) d[i0 + k] += amp * Math.exp((-4 * k) / L) * (Math.sin((2 * Math.PI * 70 * k) / sr) + 0.4 * (K.r() * 2 - 1));
      x += (1 / fire) * (1 + rough * 0.3 * (K.r() * 2 - 1));
    }
  });
  K.play(b, t, K.filt('lowpass', f, 0.9, K.gain(vol, to)));
}
// 割れる(陶器/ガラス): 主打撃＋破片の高い粒
function shatter(K, t, o = {}) {
  const { base = 1300, vol = 0.5, shards = 22, spread = 0.6, glass = 1, to = K.out } = o;
  K.modal(t, [[base, 0.3, 1], [base * 1.7, 0.2, 0.6], [base * 2.62, 0.15, 0.4]], vol * 0.6, to, 1.2);
  K.nz(t, 0.12, { type: 'highpass', f: 1800, vol: vol * 0.9, to });
  for (let i = 0; i < shards; i++) {
    const tt = t + 0.01 + Math.pow(K.r(), 1.8) * spread, f = K.rnd(2500, 7000) * glass;
    K.modal(tt, [[f, K.rnd(0.03, 0.12), 1], [f * 1.53, 0.04, 0.5]], vol * K.rnd(0.1, 0.4), to, 0.4);
  }
}

// 破片が散る尾(P4a-2): 小さな破片が床に落ちて鳴る。後ろほどまばらで小さい。bounce = 大きめの破片が 1〜2 回跳ねる
function debris(K, t, dur, o = {}) {
  const { n = 20, f0 = 3000, f1 = 8000, vol = 0.25, d = 0.06, bounce = false, to = K.out } = o;
  for (let i = 0; i < n; i++) {
    const u = Math.pow(K.r(), 1.7), tt = t + u * dur, f = K.rnd(f0, f1), a = vol * (1 - 0.75 * u) * K.rnd(0.35, 1);
    K.modal(tt, [[f, d * K.rnd(0.6, 1.4), 1], [f * K.rnd(1.4, 1.7), d * 0.6, 0.45]], a, to, 0.5);
    if (bounce && K.r() < 0.35) { const g = K.rnd(0.06, 0.14); K.modal(tt + g, [[f * 1.02, d * 0.8, 1]], a * 0.5, to, 0.4); }
  }
}

// ================================================================ 場面と候補
const S = [];
function scene(id, group, title, when, callers, temp, cands) { S.push({ id, group, title, when, callers, temp, cands }); }
function P(id, name, dur, desc, fn, kind = 'sfx') { return { id, name, dur, desc, fn, kind }; }

// ---------------------------------------------------------------- 1. 目覚め・410 と 4F
scene('amb_room', '目覚め・410 と 4F', '居室の室内', '410 など居室の中にいる間の空気(BGM の代わりの環境音)。', '新設(P4b で main.js の環境音バスに追加)', '—', [
  P('a', '静まった部屋', 10, 'ほぼ無音の床に、ときどき木の家鳴り。「何も鳴らない」怖さ', (K) => {
    K.bed(10, { color: 'brown', f: 200, vol: 0.05 });
    houseCreak(K, 2.3, 0.35); houseCreak(K, 6.8, 0.25);
    K.modal(8.9, [[2900, 0.05, 1], [4300, 0.03, 0.5]], 0.06);
  }, 'amb'),
  P('b', '窓の外の風', 10, 'ガラス越しの低い風のうねり。ときどき窓枠がかすかに鳴る', (K) => {
    K.bed(10, { color: 'pink', f: 350, vol: 0.35, lfo: [0.13, 0.8] });
    K.bed(10, { color: 'pink', type: 'bandpass', f: 900, q: 8, vol: 0.06, lfo: [0.07, 1] });
    for (const t of [3.1, 3.18, 7.4]) K.modal(t, [[2400, 0.04, 1], [3700, 0.03, 0.5]], 0.12);
  }, 'amb'),
  P('c', '壁の中の水', 10, '配管を水が流れて止む。ぽたりと一滴。人の気配に似た生活音', (K) => {
    K.bed(10, { color: 'brown', f: 120, vol: 0.04 });
    K.nz(2.0, 3.2, { color: 'brown', type: 'bandpass', f: 300, q: 2, vol: 0.35, env: 'swell', p: 0.7 });
    K.grains(2.2, 2.8, { rate: 14, len: 0.02, f: 600, q: 3, vol: 0.15, tone: 500 });
    K.tn(7.6, 0.12, { f: 1800, f2: 900, vol: 0.12 });
  }, 'amb'),
]);
scene('pl_step_room', '目覚め・410 と 4F', '足音：居室のフローリング', 'プレイヤーが居室の床を歩く(歩き・7 歩)。', '新設(P4b で player.js の歩行に接続)', '—', [
  P('a', '靴下・柔らかい', 4.2, '低く短い「トッ」。足音を殺して歩く感じ', (K) => walk(K, 7, 0.55, (t, i, acc) => {
    K.tn(t, 0.07, { f: 120, f2: 80, vol: 0.4 * acc, lpf: 600 }); K.nz(t, 0.04, { type: 'lowpass', f: 600, vol: 0.15 * acc });
  })),
  P('b', '板が軋む', 4.2, '何歩かに一度、床板が「ギッ」と鳴る。音を立てる緊張', (K) => walk(K, 7, 0.55, (t, i, acc) => {
    K.tn(t, 0.08, { f: 100, f2: 70, vol: 0.45 * acc, lpf: 700 }); K.nz(t, 0.03, { f: 1200, vol: 0.1 });
    if (i === 2 || i === 5) K.creak(t + 0.05, 0.35, { rate: 45, rate2: 30, f: 500, q: 4, vol: 0.4 });
  })),
  P('c', '硬い靴', 4.2, '狭い部屋に響く硬い「コツ」。自分の音が大きく聞こえる', (K) => {
    const v = K.verb(0.5, 0.25, 0.4);
    walk(K, 7, 0.55, (t, i, acc) => knock(K, t, { f: 160, d: 0.1, vol: 0.5 * acc, nf: 2200, nd: 0.02, nv: 0.35, to: K.split(K.out, v, 0.6) }));
  }),
]);
scene('pl_flashlight', '目覚め・410 と 4F', '懐中電灯のオン/オフ', 'F キーで懐中電灯を点ける・消す(候補はオン→オフの 2 回)。', '新設(P4b で player.js setFlashlight に接続)', '—', [
  P('a', '樹脂のスイッチ', 1.6, '軽く乾いた「カチッ」。小型ライト', (K) => { for (const t of [0.2, 1.0]) { K.modal(t, [[3200, 0.02, 1], [5100, 0.015, 0.5]], 0.4, K.out, 0.5); K.tn(t, 0.01, { f: 900, vol: 0.1 }); } }),
  P('b', '金属の重いクリック', 1.6, '重い金属ライトの「ガチッ」。存在感がある', (K) => { for (const t of [0.2, 1.0]) { K.modal(t, [[1800, 0.05, 1], [2700, 0.04, 0.6], [4100, 0.02, 0.3]], 0.5); K.tn(t, 0.03, { f: 300, f2: 200, vol: 0.2 }); } }),
  P('c', 'スライドスイッチ', 1.6, '「ジャッ」と擦れてから止まる。静かめ', (K) => { for (const t of [0.2, 1.0]) { K.nz(t, 0.08, { f: 3000, q: 1.2, vol: 0.3, env: 'swell' }); K.modal(t + 0.08, [[2500, 0.02, 1]], 0.3); } }),
]);
scene('pl_crouch', '目覚め・410 と 4F', 'しゃがみ(廃止)', 'P4a-2 でしゃがみ自体を廃止したので使わない(ユーザー回答も「なし」)。312 の潜水の音は x312_dive。', '— (廃止)', '—', [
  P('a', '衣擦れ', 2, '服が擦れる「ササッ」だけ。最小限', (K) => { K.nz(0.1, 0.5, { color: 'pink', f: 2200, q: 0.6, vol: 0.35, env: 'swell' }); K.nz(0.65, 0.3, { color: 'pink', f: 2600, q: 0.6, vol: 0.2, env: 'swell' }); }),
  P('b', '膝が床に', 2, '衣擦れのあと膝が床に当たる鈍い音と小さな軋み', (K) => { K.nz(0.1, 0.3, { color: 'pink', f: 2000, q: 0.6, vol: 0.2, env: 'swell' }); K.tn(0.45, 0.1, { f: 90, f2: 60, vol: 0.5 }); K.creak(0.5, 0.25, { rate: 60, f: 420, q: 4, vol: 0.2 }); }),
  P('c', '息を殺す', 2, '小さく吸って止める→間→鼻から細く吐く。体の緊張', (K) => { K.nz(0.1, 0.35, { color: 'pink', f: 1400, f2: 2200, q: 1, vol: 0.3, env: 'swell' }); K.nz(1.0, 0.9, { color: 'pink', f: 800, q: 1, vol: 0.08, env: 'swell' }); K.nz(0.15, 0.25, { color: 'pink', f: 2500, q: 0.6, vol: 0.08, env: 'swell' }); }),
]);
scene('door_wood', '目覚め・410 と 4F', '扉の開閉：居室の木扉', 'プレイヤーが居室の扉を開けて閉める(E)。', '新設(P4b で main.js useNearestDoor の開閉に接続)', '—(管理人が開け閉めする音は enemy_door_latch)', [
  P('a', '軽い合板', 3.4, 'ラッチ「カチャ」→短い軋み→軽く閉まる。普通の学生会館', (K) => {
    const v = K.verb(0.6, 0.25); const o = K.split(K.out, v, 0.5);
    latch(K, 0.1, 0.5, 1700, o); K.creak(0.3, 0.6, { rate: 60, rate2: 40, f: 700, q: 5, vol: 0.2, to: o });
    knock(K, 2.2, { f: 110, vol: 0.6, nf: 1200, to: o }); latch(K, 2.25, 0.4, 1900, o);
  }),
  P('b', '重い扉', 3.4, '低い「ドン」と空気が押される感じ。閉じ込められる重さ', (K) => {
    const v = K.verb(1.0, 0.3); const o = K.split(K.out, v, 0.6);
    latch(K, 0.1, 0.45, 1300, o); K.nz(0.3, 0.8, { color: 'brown', type: 'lowpass', f: 300, vol: 0.12, env: 'swell' });
    knock(K, 2.2, { f: 75, d: 0.2, vol: 0.8, nf: 600, nv: 0.5, to: o });
  }),
  P('c', '古い蝶番', 3.4, '開ける間ずっと長く軋む。音を立てたくないのに鳴る', (K) => {
    latch(K, 0.1, 0.45); K.creak(0.3, 1.4, { rate: 35, rate2: 22, f: 650, f2: 1500, q: 6, vol: 0.45, p: 0.4 });
    K.creak(2.0, 0.3, { rate: 50, f: 800, q: 5, vol: 0.25 }); knock(K, 2.35, { f: 100, vol: 0.6, nf: 1000 });
  }),
]);
scene('amb_corridor', '目覚め・410 と 4F', '館内の廊下の静けさ', '居室の外・各階の廊下と EV ホールにいる間の空気。', '新設(P4b で main.js の環境音バスに追加。階・場所で切り替え)', '—', [
  P('a', '空調のうなり', 10, '換気の低い広帯域のうなりがゆっくり揺れる。音程は持たせない', (K) => {
    K.bed(10, { color: 'pink', f: 180, vol: 0.4, lfo: [0.21, 0.3] }); K.bed(10, { color: 'brown', type: 'bandpass', f: 90, q: 3, vol: 0.3 });
    K.grains(0, 10, { rate: 3, len: 0.01, f: 700, q: 2, vol: 0.05 });
  }, 'amb'),
  P('b', '風の抜け', 10, '廊下端の窓の隙間風。ときどき細い笛のような音が混じる', (K) => {
    K.bed(10, { color: 'pink', type: 'bandpass', f: 500, q: 0.8, vol: 0.35, lfo: [0.09, 0.9] });
    K.tn(3.5, 2.5, { f: 1100, vol: 0.03, env: 'swell', vib: 3, vibd: 0.004 }); K.tn(7.2, 2.2, { f: 1250, vol: 0.02, env: 'swell', vib: 2.5, vibd: 0.004 });
  }, 'amb'),
  P('c', 'ほぼ無音に家鳴り', 10, '耳が慣れるほど静か。建物が軋み、遠くで扉が一度閉まる', (K) => {
    K.bed(10, { color: 'brown', f: 120, vol: 0.04 });
    houseCreak(K, 2.1, 0.3); houseCreak(K, 6.4, 0.2);
    const v = K.verb(2.2, 0.6); knock(K, 8.6, { f: 90, vol: 0.15, nf: 500, nv: 0.1, to: K.split(K.muf(300), v, 1) });
  }, 'amb'),
]);
// P4a-2: ユーザー回答「こつこつと硬い地面を歩いている感じ」で作り直し(旧: 柔らかいゴム底/硬い踵/擦り。長尺シートの柔らかさは捨てた)
scene('pl_step_corridor', '目覚め・410 と 4F', '足音：廊下(硬い床)', 'プレイヤーが廊下・EV ホールを歩く(歩き・7 歩)。硬い靴底が硬い床を叩く「コツ、コツ」。残響の短い廊下。', '新設(P4b で player.js の歩行に接続。床の種類で切り替え)', '—', [
  P('a', '革靴', 4.2, '革の踵が床を叩く乾いた「コツ」と、爪先の小さな「ッ」。短い残響', (K) => {
    const v = K.verb(0.45, 0.22, 0.55); const o = K.split(K.out, v, 0.55);
    walk(K, 7, 0.55, (t, i, acc) => {
      K.nz(t, 0.012, { f: 3200, q: 1.4, vol: 0.55 * acc, to: o });                       // 踵の角が当たる
      K.modal(t, [[1850, 0.035, 1], [2950, 0.025, 0.5]], 0.22 * acc, o, 0.3);              // 革と床の硬い鳴り
      K.tn(t, 0.05, { f: 210, f2: 120, vol: 0.32 * acc, to: o });                          // 踵の胴
      K.nz(t + 0.085, 0.01, { f: 2400, q: 1.2, vol: 0.18 * acc, to: o });                  // 爪先
    }, 0.05);
  }),
  P('b', '硬いゴム底', 4.2, '硬いゴムの踵の詰まった「コッ」。高域は控えめで重さがある', (K) => {
    const v = K.verb(0.4, 0.2, 0.6); const o = K.split(K.out, v, 0.5);
    walk(K, 7, 0.55, (t, i, acc) => {
      K.nz(t, 0.018, { f: 1600, q: 1.1, vol: 0.5 * acc, to: o });
      K.modal(t, [[1150, 0.03, 1], [1900, 0.02, 0.4]], 0.18 * acc, o, 0.15);
      K.tn(t, 0.07, { f: 170, f2: 95, vol: 0.45 * acc, to: o });
      K.nz(t + 0.08, 0.014, { f: 1300, q: 1, vol: 0.14 * acc, to: o });
    }, 0.05);
  }),
  P('c', 'ヒール寄り', 4.2, '細く硬い踵の高い「カツ、カツ」。廊下の壁から短く返る', (K) => {
    const v = K.verb(0.5, 0.25, 0.45); const e = K.echo(0.07, 0.18, 3500, K.out);
    const o = K.split(K.split(K.out, v, 0.55), e, 0.35);
    walk(K, 7, 0.55, (t, i, acc) => {
      K.nz(t, 0.007, { type: 'highpass', f: 3800, vol: 0.5 * acc, to: o });
      K.modal(t, [[3100, 0.04, 1], [4900, 0.03, 0.55], [7200, 0.02, 0.25]], 0.26 * acc, o, 0.2);
      K.tn(t, 0.035, { f: 280, f2: 180, vol: 0.18 * acc, to: o });
      K.nz(t + 0.11, 0.008, { f: 2600, q: 1.5, vol: 0.12 * acc, to: o });
    }, 0.04);
  }),
]);
scene('door_locked', '目覚め・410 と 4F', '施錠の扉を引く', '開かない扉で E(入れない部屋・221 前の扉)。管理人が扉を確かめる時も同じ音。', 'main.js useNearestDoor / story.js use・useCar / spaces/x105.js・xb1.js useDoor / enemy_ai.js _doorEntry・_patrol(管理人)', 'lock_rattle_01(story rattle)・enemy_knob_rattle_01(enemy rattle)', [
  P('a', 'カタつくだけ', 1.8, 'ラッチが受けに当たって小さくカタカタ', (K) => { for (const t of [0.1, 0.22, 0.36]) { K.modal(t, [[1500, 0.04, 1], [2300, 0.03, 0.5]], 0.35); knock(K, t, { f: 200, d: 0.04, vol: 0.25, nf: 1500, nv: 0.15 }); } }),
  P('b', '強く 2 回', 1.8, 'ノブを強く引いて「ガチャッ、ガチャッ」。苛立ち', (K) => { for (const t of [0.1, 0.6]) { knock(K, t, { f: 120, vol: 0.7, nf: 1000 }); latch(K, t + 0.01, 0.5, 1600); K.modal(t + 0.02, [[900, 0.2, 1], [1400, 0.15, 0.4]], 0.15); } }),
  P('c', '鈍い「ガッ」', 1.8, '扉が枠に当たって止まる鈍い一撃。ばねがゆっくり戻る', (K) => { const v = K.verb(0.8, 0.3); knock(K, 0.15, { f: 80, d: 0.15, vol: 0.8, nf: 500, to: K.split(K.out, v, 0.6) }); K.creak(0.5, 0.4, { rate: 120, rate2: 80, f: 1800, q: 6, vol: 0.12 }); latch(K, 0.95, 0.25, 1500); }),
]);
scene('pl_peephole', '目覚め・410 と 4F', '覗き穴', '扉の覗き穴に顔を寄せる・離す(E 長押し)。', '新設(P4b で peephole.js set(true/false) に接続)', '—', [
  P('a', '金属の蓋をずらす', 2, '覗き穴の小さな蓋を「チッ」とずらす→戻す', (K) => { for (const t of [0.15, 1.5]) { K.nz(t, 0.12, { f: 4000, q: 1.5, vol: 0.2, env: 'swell' }); K.modal(t + 0.12, [[3800, 0.03, 1], [5600, 0.02, 0.4]], 0.2); } }),
  P('b', '額が扉に触れる', 2, '扉に額が当たる鈍い音と、殺した息', (K) => { K.tn(0.15, 0.08, { f: 90, f2: 60, vol: 0.35, lpf: 400 }); K.nz(0.4, 1.2, { color: 'pink', f: 900, q: 1, vol: 0.05, env: 'swell' }); }),
  P('c', '耳鳴りだけ', 2, '何も鳴らない。かすかな耳鳴りで「聞き耳」を表す', (K) => { K.tn(0, 2, { f: 7800, vol: 0.05, env: 'flat' }); K.bed(2, { color: 'brown', f: 100, vol: 0.05, fade: 0.3 }); }, 'quiet'),
]);
scene('pl_closet', '目覚め・410 と 4F', 'クローゼットに隠れる', '居室のクローゼットに入って折戸を閉める・出る。', 'rooms.js openCloset(creak)', 'room_closet_01', [
  P('a', '折戸のレール', 3, 'レールの「ガラガラ」と閉まりの小さな「トン」', (K) => { for (const t of [0.1, 1.8]) { K.nz(t, 0.5, { f: 900, q: 2, vol: 0.15, env: 'flat' }); K.grains(t, 0.5, { rate: 120, len: 0.003, f: 1200, vol: 0.2 }); } knock(K, 2.35, { f: 150, vol: 0.4, nf: 1500 }); }),
  P('b', '蝶番の軋み', 3, '折戸の蝶番が細く軋む。閉めるとき一番鳴る', (K) => { K.creak(0.1, 0.6, { rate: 70, rate2: 50, f: 900, q: 5, vol: 0.35 }); K.creak(1.8, 0.5, { rate: 60, rate2: 40, f: 1000, q: 5, vol: 0.3 }); knock(K, 2.3, { f: 140, vol: 0.35, nf: 1400 }); }),
  P('c', '服とハンガー', 3, '吊った服を押しのける衣擦れと、ハンガーが触れ合う音', (K) => { K.nz(0.2, 0.7, { color: 'pink', f: 2500, q: 0.6, vol: 0.2, env: 'swell' }); for (let i = 0; i < 4; i++) K.modal(0.3 + i * 0.13 + K.rnd(0, 0.05), [[K.rnd(1900, 2900), 0.1, 1], [K.rnd(4000, 5000), 0.05, 0.4]], 0.12); knock(K, 2.0, { f: 140, vol: 0.4, nf: 1400 }); K.nz(2.2, 0.6, { color: 'pink', f: 2200, q: 0.6, vol: 0.12, env: 'swell' }); }),
]);
// P4a-2: ユーザー回答「パリーン！と割れる感じ」で作り直し(旧: 高い陶器/厚いガラス/転がってから割れる)。高い音で砕け散り、破片が散る尾を付ける
scene('room_fall', '目覚め・410 と 4F', '物が落ちて割れる', '触れると落ちる障害物(花瓶・マグ等)。この音で管理人が部屋を知る。「パリーン!」と高く砕け散り、破片が床に散る。缶・本などは P4b で同じ作りから派生。', 'rooms.js _updateFallables(fall_<type>)', 'room_fall_<vase|cans|books|bottle|mug|binders>_01', [
  P('a', '薄いガラス', 2.8, 'コップのような薄いガラスが高く「パリーン」。細かい破片がチリチリと散る', (K) => {
    const v = K.verb(0.7, 0.25, 0.4); const o = K.split(K.out, v, 0.45);
    K.tn(0.1, 0.03, { f: 260, f2: 160, vol: 0.25, to: o });                                    // 床に当たる一瞬
    K.nz(0.1, 0.09, { type: 'highpass', f: 3500, vol: 0.85, to: o });                           // 砕ける「パ」
    K.modal(0.1, [[3300, 0.45, 1], [5100, 0.3, 0.6], [7600, 0.2, 0.35]], 0.35, o, 0.8);        // 薄いガラスの鳴り「リーン」
    shatter(K, 0.11, { base: 2700, vol: 0.45, shards: 34, spread: 0.45, glass: 1.25, to: o });
    debris(K, 0.45, 1.9, { n: 26, f0: 4200, f1: 9000, vol: 0.22, d: 0.05, to: o });
  }),
  P('b', '厚いガラス', 2.8, '瓶や花瓶の厚いガラスが重く砕ける「ガシャーン」。大きめの破片が跳ねて散る', (K) => {
    const v = K.verb(0.9, 0.3, 0.45); const o = K.split(K.out, v, 0.5);
    knock(K, 0.1, { f: 150, d: 0.1, vol: 0.55, nf: 1800, nv: 0.3, to: o });
    K.nz(0.1, 0.22, { type: 'highpass', f: 1800, vol: 0.9, to: o });
    K.modal(0.1, [[1500, 0.5, 1], [2650, 0.35, 0.6], [4300, 0.25, 0.4]], 0.32, o, 1.0);
    shatter(K, 0.11, { base: 1600, vol: 0.55, shards: 30, spread: 0.7, glass: 0.95, to: o });
    debris(K, 0.5, 2.0, { n: 22, f0: 2400, f1: 6200, vol: 0.28, d: 0.08, bounce: true, to: o });
  }),
  P('c', '陶器', 2.8, '皿やマグの陶器が硬く「ガシャン」と割れる。乾いた破片がカラカラと床を滑る', (K) => {
    const v = K.verb(0.6, 0.22, 0.55); const o = K.split(K.out, v, 0.45);
    knock(K, 0.1, { f: 210, d: 0.06, vol: 0.5, nf: 2200, nv: 0.35, to: o });
    K.nz(0.1, 0.12, { type: 'highpass', f: 2200, vol: 0.75, to: o });
    K.grains(0.1, 0.18, { rate: 260, len: 0.003, f: 3000, q: 0.8, vol: 0.45, to: o });           // 砕ける粒
    K.modal(0.1, [[2200, 0.14, 1], [3500, 0.1, 0.6], [5600, 0.07, 0.35]], 0.3, o, 0.6);        // 陶器は響きが短い
    shatter(K, 0.11, { base: 2000, vol: 0.4, shards: 24, spread: 0.5, glass: 0.75, to: o });
    debris(K, 0.4, 1.8, { n: 20, f0: 1800, f1: 4800, vol: 0.22, d: 0.03, to: o });
    K.grains(0.5, 1.2, { rate: 40, len: 0.004, f: 2400, q: 1, vol: 0.18, p: 2, to: o });      // 床を滑る
  }),
]);

// ---------------------------------------------------------------- 2. 冒頭の見せ場・EV
scene('opening_ev', '冒頭の見せ場・EV', '冒頭：EV の管理人が 2F へ', '初めて 410 から廊下へ出ると 4F の EV 付近に管理人→EV で 2F へ(遠く・こもって聞こえる)。', 'story.js(冒頭の見せ場)／elevator.js npcSelect', '—(既存の ev_* の流用)', [
  P('a', '遠いチャイムと扉', 6, '廊下の奥で鳴るチャイム→扉→モーター。遠さで見せる', (K) => {
    const v = K.verb(2.2, 0.5); const o = K.split(K.muf(1200, 0.6), v, 0.8);
    K.modal(0.5, [[784, 1.2, 1], [1568, 0.6, 0.4]], 0.35, o, 0.05); K.modal(1.0, [[659, 1.4, 1], [1318, 0.7, 0.4]], 0.35, o, 0.05);
    K.nz(1.8, 1.3, { color: 'brown', type: 'lowpass', f: 300, vol: 0.25, env: 'swell', to: o }); knock(K, 3.1, { f: 70, vol: 0.5, nf: 400, to: o });
    K.tn(3.4, 2.5, { type: 'sawtooth', f: 55, vol: 0.12, env: 'swell', lpf: 200, to: o });
  }),
  P('b', '閉まる音とモーターが遠ざかる', 6, '扉の「ドン」の後、モーター音だけが下へ遠ざかる', (K) => {
    const o = K.muf(900, 0.8);
    knock(K, 0.5, { f: 70, d: 0.2, vol: 0.7, nf: 400, to: o });
    const g = K.shape(0.8, 5, 0.3, (u) => Math.min(1, u * 10) * Math.pow(1 - u, 1.5), o);
    const os = K.c.createOscillator(); os.type = 'sawtooth'; os.frequency.value = 48; const lp = K.filt('lowpass', 160); os.connect(lp); lp.connect(g); os.start(K.T(0.8)); os.stop(K.T(5.9));
  }),
  P('c', '無音→カゴが動く「コトン」', 6, 'しばらく何もない。ふいに金属の「コトン」とケーブルの音', (K) => {
    K.bed(6, { color: 'brown', f: 100, vol: 0.04 });
    knock(K, 1.6, { f: 60, vol: 0.5, nf: 400 }); K.modal(1.6, [[300, 0.4, 1], [750, 0.3, 0.5]], 0.15);
    K.grains(2.0, 3.5, { rate: 6, len: 0.01, f: 900, q: 3, vol: 0.2 }); K.tn(2.0, 3.8, { type: 'sawtooth', f: 52, vol: 0.06, env: 'swell', lpf: 180 });
  }),
]);
scene('ev_button', '冒頭の見せ場・EV', 'EV：呼び出しボタン', 'EV ホールの呼びボタン・カゴの行き先ボタンを押す。', '新設(P4b で elevator.js call/select に接続)', '—', [
  P('a', 'クリック＋電子音', 1.2, '軽い「カチ」と短い「ピッ」。現代の EV', (K) => { K.modal(0.1, [[3000, 0.02, 1]], 0.4, K.out, 0.5); K.tn(0.15, 0.18, { f: 1760, vol: 0.12, env: 'flat' }); }),
  P('b', '機械的な押し込み', 1.2, '電子音なし。ボタンが沈んで戻る「カチッ…コッ」', (K) => { knock(K, 0.1, { f: 300, d: 0.04, vol: 0.4, nf: 2000, nv: 0.3 }); knock(K, 0.35, { f: 250, d: 0.03, vol: 0.25, nf: 1800, nv: 0.2 }); }),
  P('c', '鈍い押し込みとリレー', 1.2, '鈍い押し込みの後、壁の奥でリレーが「カチ」', (K) => { knock(K, 0.1, { f: 160, d: 0.06, vol: 0.45, nf: 1200 }); K.modal(0.3, [[2400, 0.03, 1], [3700, 0.02, 0.5]], 0.25, K.muf(2500)); }),
]);
scene('ev_chime', '冒頭の見せ場・EV', 'EV：到着チャイム', 'カゴが着く(EV の賭けの合図でもある)。', 'elevator.js update(_sfx chime)', 'ev_chime_01', [
  P('a', '柔らかい 2 音', 2.6, '「ポーン・ポーン」の下がる 2 音。落ち着いた館内放送風', (K) => { K.modal(0.1, [[784, 1.4, 1], [1568, 0.8, 0.4], [2352, 0.5, 0.15], [2164, 0.4, 0.1]], 0.35, K.out, 0.05); K.modal(0.75, [[659, 1.6, 1], [1318, 0.9, 0.4], [1977, 0.5, 0.15], [1819, 0.4, 0.1]], 0.35, K.out, 0.05); }),
  P('b', '電子音 1 つ', 2.6, '短い「ピン」だけ。無機質', (K) => { K.tn(0.1, 0.45, { f: 1318, vol: 0.25, env: 'flat' }); K.tn(0.55, 0.4, { f: 1318, vol: 0.2 }); K.tn(0.1, 0.45, { f: 2637, vol: 0.04, env: 'flat' }); }),
  P('c', '古い機械ベル', 2.6, '少し狂った音程のベルが「ゴーン」とうなる。うなりが不穏', (K) => { K.modal(0.1, [[523, 2.0, 1], [1260, 1.2, 0.5], [2040, 0.7, 0.3], [531, 2.0, 0.5]], 0.3, K.out, 0.2); K.modal(0.16, [[523, 1.0, 0.3]], 0.3, K.out, 0); }),
]);
scene('ev_door', '冒頭の見せ場・EV', 'EV：扉の開閉', 'カゴの扉が開いて閉まる。', 'elevator.js _openHere・update(_sfx door)', 'ev_door_01', [
  P('a', 'モーターとゴム', 3, 'モーターの「ウーン」とゴムの当たり', (K) => { for (const t of [0.1, 1.6]) { K.tn(t, 1.0, { type: 'sawtooth', f: 120, f2: 150, vol: 0.1, env: 'swell', lpf: 400 }); K.nz(t, 1.0, { type: 'lowpass', f: 500, vol: 0.1, env: 'swell' }); knock(K, t + 1.0, { f: 80, vol: 0.4, nf: 300, nv: 0.15 }); } }),
  P('b', 'ガタつくローラー', 3, 'レールのローラーがガタガタ鳴って最後に金属の「ガン」', (K) => { for (const t of [0.1, 1.6]) { K.grains(t, 1.0, { rate: 40, len: 0.008, f: 600, q: 2, vol: 0.4 }); K.nz(t, 1.0, { f: 400, vol: 0.1, env: 'flat' }); K.modal(t + 1.0, [[600, 0.3, 1], [1400, 0.2, 0.5]], 0.3); } }),
  P('c', '静かなスライド＋ドン', 3, '開くのは空気の音だけ。閉まりの「ドン」が重い', (K) => { K.nz(0.1, 1.1, { f: 1500, q: 0.5, vol: 0.08, env: 'swell' }); K.nz(1.6, 1.1, { f: 1500, q: 0.5, vol: 0.08, env: 'swell' }); knock(K, 2.7, { f: 60, d: 0.25, vol: 0.8, nf: 400 }); }),
]);
scene('ev_motor', '冒頭の見せ場・EV', 'EV：走行音', 'カゴが動いている間(乗っている時は耳元、外ではシャフトの中から遠く)。', 'elevator.js _hum・_updateAudio(motor ループ)', 'ev_motor_loop_01', [
  P('a', '低いうなりとケーブル', 8, '巻上機の低いうなりに、ケーブルの小さな音が混じる', (K) => { K.tn(0, 8, { type: 'sawtooth', f: 50, vol: 0.25, env: 'flat', lpf: 180 }); K.tn(0, 8, { f: 100, vol: 0.06, env: 'flat' }); K.bed(8, { color: 'brown', f: 300, vol: 0.2 }); K.grains(0, 8, { rate: 3, len: 0.01, f: 1200, q: 2, vol: 0.2 }); }, 'amb'),
  P('b', '風切り', 8, 'シャフトを抜ける風の音が主。機械音は薄い', (K) => { K.bed(8, { color: 'pink', type: 'bandpass', f: 350, q: 0.6, vol: 0.4, lfo: [0.3, 0.4] }); K.bed(8, { color: 'pink', type: 'highpass', f: 2000, vol: 0.05 }); K.tn(0, 8, { f: 60, vol: 0.05, env: 'flat' }); }, 'amb'),
  P('c', 'ガタンと揺れる', 8, '古いカゴがときどき「ガタン」と揺れ、レールが擦れる', (K) => { K.bed(8, { color: 'brown', f: 200, vol: 0.3 }); for (const t of [1.2, 4.7, 6.9]) { knock(K, t, { f: 55, vol: 0.6, nf: 400 }); K.modal(t, [[280, 0.4, 1], [700, 0.3, 0.5]], 0.12); } K.nz(2.5, 0.8, { f: 900, q: 2, vol: 0.12, env: 'swell' }); }, 'amb'),
]);
scene('ev_car_quiet', '冒頭の見せ場・EV', 'EV：カゴの中の静けさ', '止まったカゴの中にいる間(扉が開くのを待つ・カゴで迷う時間)。', '新設(P4b で elevator.js の乗車中に接続)', '—', [
  P('a', '換気ファン', 10, '天井の小さなファンの羽音。安全だが閉じ込められている', (K) => { K.bed(10, { color: 'pink', f: 900, vol: 0.12, lfo: [11, 0.15] }); K.bed(10, { color: 'brown', f: 120, vol: 0.1 }); }, 'amb'),
  P('b', 'わずかなきしみ', 10, 'ほぼ無音。ケーブルが「キ…」ときしみ、何かが一度当たる', (K) => { K.bed(10, { color: 'brown', f: 150, vol: 0.05 }); K.creak(3.2, 0.6, { rate: 30, f: 380, q: 5, vol: 0.2 }); K.creak(7.4, 0.5, { rate: 26, f: 340, q: 5, vol: 0.15 }); K.modal(5.6, [[1800, 0.1, 1]], 0.08); }, 'amb'),
  P('c', 'ほぼ無音', 10, '自分の耳鳴りしか聞こえない', (K) => { K.bed(10, { color: 'brown', f: 80, vol: 0.05 }); K.tn(0, 10, { f: 6800, vol: 0.006, env: 'flat' }); }, 'quiet'),
]);

// ---------------------------------------------------------------- 3. 管理人(徘徊・潜伏・襲撃)
scene('enemy_presence', '管理人', '管理人の気配(常時ハムの置き換え)', '管理人が同じ階を巡回している間、間を置いて鳴る小さな音(常時ループにはしない)。P4a で削除した鼻歌ループの代わり。', '新設(P4b で enemy_ai.js の PATROL 中に 6〜15 秒おきに鳴らす)', 'enemy_hum_loop_01(P4a で削除)', [
  P('a', '鍵束の揺れ', 8, '歩くたびに腰の鍵束が小さく鳴る。近づくと分かる', (K) => { const o = K.muf(3000, 0.9); walk(K, 6, 0.75, (t, i, acc) => { jingle(K, t + 0.03, 0.12, 5, 0.2 * acc, o); K.tn(t, 0.1, { f: 70, f2: 50, vol: 0.15, to: o }); }, 0.1, 0.3); }),
  P('b', '靴の擦りと咳払い', 8, '作業靴を引きずる音、少しして低い咳払い。人間の生々しさ', (K) => {
    const o = K.muf(1500, 0.9);
    for (const t of [0.5, 1.3, 2.1]) K.nz(t, 0.3, { f: 700, q: 1, vol: 0.3, env: 'swell', to: o });
    K.voice(4.0, 0.35, { f0: 110, form: [[500, 4, 1], [1500, 6, 0.5]], drive: 4, vol: 0.35, breath: 0.5, a: 0.02, rel: 0.15, to: o });
    K.voice(4.55, 0.22, { f0: 100, form: [[480, 4, 1], [1400, 6, 0.4]], drive: 4, vol: 0.25, breath: 0.6, a: 0.02, rel: 0.1, to: o });
  }),
  P('c', '鼻歌の断片', 8, '一節だけの低い鼻歌が聞こえて、すぐ止む。ずっとは続けない', (K) => {
    const o = K.muf(900, 0.9); const notes = [[1.0, 0.7, 1], [1.75, 0.5, 0.944], [2.3, 1.1, 0.891]];
    for (const [t, d, m] of notes) K.voice(t, d, { f0: 98 * m, form: [[260, 3, 1], [1000, 5, 0.1]], drive: 1.5, vol: 0.3, breath: 0.05, a: 0.08, rel: 0.2, vibd: 0.006, to: o });
  }),
]);
scene('enemy_step_walk', '管理人', '管理人の足音(通常)', '巡回・扉に向かう歩き。B1 では上の階の足音としてこもらせて流用。', 'enemy_ai.js constructor の接地コールバック(step)・_reveal／spaces/xb1.js sound(上の階)', 'enemy_step_walk_01..04・xb1_steps_above_01', [
  P('a', '作業靴の重い踵', 5, '重い踵の「ドッ」と短い擦れ。体格の大きさが分かる', (K) => walk(K, 7, 0.7, (t, i, acc) => { knock(K, t, { f: 70, d: 0.15, vol: 0.7 * acc, nf: 900, nv: 0.25 }); K.nz(t + 0.05, 0.12, { type: 'lowpass', f: 700, vol: 0.15, env: 'swell' }); })),
  P('b', 'ゴム底の擦り歩き', 5, '足を少し引きずる「ズッ、ズッ」。ゆっくり探している', (K) => walk(K, 7, 0.75, (t, i, acc) => { K.tn(t, 0.1, { f: 90, f2: 60, vol: 0.5 * acc }); K.nz(t, 0.25, { f: 900, q: 0.8, vol: 0.3 * acc, env: 'swell' }); })),
  P('c', '片足を引きずる', 5, '片足だけ長く引きずる不規則な歩調。人でないような違和感', (K) => walk(K, 7, 0.8, (t, i, acc) => { if (i % 2) { K.nz(t, 0.5, { f: 700, q: 0.9, vol: 0.35, env: 'swell' }); knock(K, t + 0.4, { f: 80, vol: 0.35, nf: 800 }); } else knock(K, t, { f: 70, d: 0.15, vol: 0.7, nf: 900 }); }, 0.25)),
]);
scene('enemy_step_run', '管理人', '管理人の足音(追跡)', '追跡(CHASE)の走り。', 'enemy_ai.js 接地コールバック(step・run 時の音量 1.0)', 'enemy_step_run_01..04(予定・現状は歩きの音量違い)', [
  P('a', '重い踏み込み', 3, '全力の重い踏み込みが速く迫る', (K) => walk(K, 9, 0.3, (t, i, acc) => knock(K, t, { f: 65, d: 0.18, vol: 0.9 * acc, nf: 700, nv: 0.3 }), 0.08, 0.1)),
  P('b', '速い擦り', 3, '軽く速い足取りと靴の鳴き。素早さが怖い', (K) => walk(K, 10, 0.26, (t, i, acc) => { knock(K, t, { f: 90, d: 0.08, vol: 0.6 * acc, nf: 1300, nv: 0.35 }); if (i % 4 === 2) K.tn(t + 0.03, 0.06, { f: 2000, f2: 2400, vol: 0.06, env: 'swell' }); }, 0.08, 0.1)),
  P('c', '床が揺れる', 3, '低域の「ドスッ」と、周りの物が震えるカタカタ', (K) => walk(K, 8, 0.33, (t, i, acc) => { knock(K, t, { f: 50, d: 0.25, vol: 1.0 * acc, nf: 300, nv: 0.2 }); K.tn(t, 0.3, { f: 45, vol: 0.3 }); K.grains(t + 0.02, 0.1, { rate: 80, len: 0.003, f: 2500, vol: 0.1 }); }, 0.08, 0.1)),
]);
scene('enemy_breath_close', '管理人', '息遣い(目の前)', '隠れたクローゼット/ロッカーの前で管理人が立ち止まる。', 'enemy_ai.js _locker(breath)', 'enemy_breath_close_01', [
  P('a', '湿った鼻息', 5, 'ゆっくり吸って、湿った音を立てて吐く。2 回', (K) => { for (const t of [0.1, 2.6]) { K.nz(t, 1.1, { color: 'pink', f: 700, f2: 900, q: 1.2, vol: 0.4, env: 'swell' }); K.nz(t + 1.2, 1.3, { color: 'pink', f: 600, f2: 450, q: 1.2, vol: 0.5, env: 'swell' }); K.grains(t + 1.3, 1.0, { rate: 15, len: 0.004, f: 1500, vol: 0.08 }); } }),
  P('b', '口を開けた荒い呼吸', 5, '速く荒い「ハッ、ハァ」。興奮している', (K) => { for (let i = 0; i < 4; i++) { const t = 0.1 + i * 1.15; K.nz(t, 0.5, { color: 'pink', f: 1200, q: 0.7, vol: 0.35, env: 'swell' }); K.nz(t + 0.5, 0.6, { color: 'pink', f: 1000, q: 0.7, vol: 0.45, env: 'swell' }); K.tn(t + 0.5, 0.5, { type: 'sawtooth', f: 90, vol: 0.04, env: 'swell', lpf: 500 }); } }),
  P('c', '喉が鳴る', 5, '吐くたびに喉の奥が「ゴロゴロ」と鳴る。人でない感じ', (K) => { for (const t of [0.1, 2.6]) { K.nz(t, 1.0, { color: 'pink', f: 800, q: 1, vol: 0.3, env: 'swell' }); K.voice(t + 1.1, 1.3, { f0: 60, form: [[300, 3, 1], [800, 5, 0.4]], drive: 6, vol: 0.18, breath: 0.4, gate: (u) => 0.5 + 0.5 * Math.sin(u * 2 * Math.PI * 18) }); } }),
]);
scene('enemy_breath_door', '管理人', '息遣い(扉の向こう)', '管理人が潜伏する空き部屋の扉の前で止まると聞こえる静かな予兆(歩いていると気づかない)。', 'enemy_ai.js _roomLurkTick(breathDoor)', 'enemy_breath_behind_door_01', [
  P('a', 'こもった長い鼻息', 5, '扉越しにくぐもった、長い吸気と吐気', (K) => { const o = K.muf(450); K.nz(0.2, 1.6, { color: 'pink', f: 600, f2: 750, q: 1, vol: 0.6, env: 'swell', to: o }); K.nz(2.1, 2.0, { color: 'pink', f: 550, f2: 420, q: 1, vol: 0.7, env: 'swell', to: o }); }),
  P('b', '扉に口を付けた吐息', 5, 'すぐ向こうで、扉に口を付けて「フー」と吐く。近い', (K) => { const o = K.filt('peaking', 220, 2, K.muf(900), 6); K.nz(1.0, 1.5, { color: 'pink', f: 900, f2: 500, q: 0.8, vol: 0.6, env: 'swell', to: o }); }),
  P('c', '止めていた息を吐く', 5, '長い無音の後、こらえていた息を震えながら 1 回だけ吐く', (K) => { const o = K.muf(500); K.nz(1.8, 1.4, { color: 'pink', f: 700, f2: 450, q: 1, vol: 0.4, env: 'swell', to: K.shape(1.8, 1.4, 1, (u) => 0.55 + 0.45 * Math.sin(u * 2 * Math.PI * 9), o) }); }),
]);
scene('enemy_handle', '管理人', '取っ手に触れる', '隠れ場所の取っ手・410 の扉のノブに管理人の指が触れる(開けないで去ることもある)。', 'enemy_ai.js _locker・_scope(handle)', 'enemy_handle_touch_01', [
  P('a', '爪がノブを叩く', 2, '爪が金属に当たる小さな「チッ、チッ」。そして止まる', (K) => { for (const t of [0.1, 0.28, 0.41]) K.modal(t, [[3400, 0.07, 1], [2500, 0.05, 0.5]], 0.3, K.out, 0.3); }),
  P('b', 'ゆっくり回す', 2, 'ノブが少しずつ回ってばねが鳴る→そっと戻る', (K) => { K.creak(0.2, 1.0, { rate: 140, rate2: 90, f: 1800, q: 6, vol: 0.2 }); K.modal(1.2, [[2000, 0.04, 1]], 0.2); latch(K, 1.5, 0.3, 1600); }),
  P('c', '指先が扉板を擦る', 2, '指先か爪が扉の表面を「ススス」と擦る', (K) => { K.nz(0.2, 1.2, { f: 2200, q: 1.2, vol: 0.2, env: 'swell' }); K.grains(0.2, 1.2, { rate: 40, len: 0.003, f: 2600, vol: 0.12 }); }),
]);
scene('room_door_rattle', '管理人', '扉のガタガタ(ランダム演出)', '部屋の中で何かが暴れて扉が激しく鳴り揺れる。絶対に出てこない(潜伏の静かな予兆と意味を分ける)。', 'door_fx.js(ガタガタ扉 slam)・enemy_ai.js _appear(slam)', 'room_door_rattle_violent_01', [
  P('a', '激しい連打', 4, '扉板が掛け金に当たる速い連打が波のように強まる', (K) => {
    let t = 0.1;
    while (t < 3.6) { const s = Math.pow(Math.max(0, Math.sin(t * 2 * Math.PI * 0.9)), 2), v = 0.3 + 0.7 * s * (0.6 + 0.4 * K.r()); knock(K, t, { f: 100, d: 0.08, vol: 0.7 * v, nf: 1100, nv: 0.4 * v }); K.modal(t, [[1700, 0.03, 1]], 0.1 * v, K.out, 0); t += s > 0.3 ? 1 / (11 + K.r() * 4) : 0.12 + K.r() * 0.1; }
  }),
  P('b', '体当たり(不規則)', 4, '間隔の読めない重い体当たり。合間の静けさが怖い', (K) => { for (const t of [0.2, 0.9, 1.25, 2.6, 3.1]) { knock(K, t, { f: 60, d: 0.3, vol: 1, nf: 500, nv: 0.5 }); K.creak(t + 0.05, 0.2, { rate: 80, f: 700, q: 4, vol: 0.15 }); K.modal(t + 0.03, [[1600, 0.05, 1]], 0.2); K.modal(t + 0.09, [[1750, 0.04, 1]], 0.12); } }),
  P('c', 'ノブだけ激しく回す', 4, '扉は揺れず、ノブだけが狂ったように「ガチャガチャ」', (K) => { for (const [s, d] of [[0.2, 1.2], [2.0, 1.4]]) for (let t = s; t < s + d; t += 1 / 18 * (0.8 + 0.4 * K.r())) K.modal(t, [[K.rnd(1600, 2200), 0.03, 1], [K.rnd(3000, 3600), 0.02, 0.4]], 0.3, K.out, 0.3); }),
]);
scene('enemy_door_latch', '管理人', '空室の扉を普通に開け閉め', '襲撃でない潜伏の解除(管理人が普通に扉を開けて出てくる)。扉は壊れない。', 'enemy_ai.js _npcDoor(latch)', 'door_latch_creak_01', [
  P('a', 'ゆっくり開く軋み', 4, 'ラッチの後、扉がゆっくり軋みながら開く', (K) => { latch(K, 0.1, 0.35); K.creak(0.3, 1.8, { rate: 30, rate2: 18, f: 600, f2: 1400, q: 6, vol: 0.35, p: 0.4 }); }),
  P('b', 'カチャ…静かに閉じる', 4, '開け閉めとも静か。「誰かが出入りした」だけ分かる', (K) => { latch(K, 0.1, 0.35); K.nz(0.3, 0.8, { color: 'brown', type: 'lowpass', f: 300, vol: 0.08, env: 'swell' }); knock(K, 2.0, { f: 100, vol: 0.35, nf: 1000 }); latch(K, 2.05, 0.3); }),
  P('c', '開く→間→閉まる', 4, '短く開いて、しばらくして閉まる。その間に出てきた', (K) => { latch(K, 0.1, 0.35); K.creak(0.3, 0.5, { rate: 45, f: 700, q: 5, vol: 0.25 }); knock(K, 3.0, { f: 90, vol: 0.5, nf: 900 }); latch(K, 3.05, 0.35); }),
]);
scene('enemy_door_smash', '管理人', '扉を破る(飛び出し)', '懐中電灯を点けて潜伏部屋の前を通った時、管理人が扉を破って飛び出す。同じ階全域と上下階に届く大きな音。', 'enemy_ai.js _burst(crash)', 'enemy_door_smash_01', [
  P('a', '体当たりで割れる', 2.5, '重い衝撃と板の裂け、金具が床に落ちて跳ねる', (K) => {
    const v = K.verb(1.2, 0.35); const o = K.split(K.out, v, 0.6);
    knock(K, 0.05, { f: 50, d: 0.4, vol: 1, nf: 500, nv: 0.9, to: o }); K.nz(0.05, 0.4, { type: 'highpass', f: 1500, vol: 0.7, to: o });
    K.grains(0.07, 0.6, { rate: 200, len: 0.003, f: 2500, vol: 0.6, to: o });
    for (const [t, a] of [[0.55, 0.35], [0.74, 0.22], [0.86, 0.13], [0.93, 0.08]]) K.modal(t, [[2900, 0.12, 1], [4100, 0.08, 0.4]], a, o);
  }),
  P('b', '二撃目で割れる', 2.5, '一撃目で扉がたわみ、二撃目で砕ける。予告がある', (K) => {
    const v = K.verb(1.2, 0.35); const o = K.split(K.out, v, 0.6);
    knock(K, 0.1, { f: 60, d: 0.3, vol: 0.8, nf: 500, to: o }); K.creak(0.15, 0.25, { rate: 90, f: 600, q: 4, vol: 0.3, to: o });
    knock(K, 0.75, { f: 50, d: 0.4, vol: 1, nf: 500, nv: 0.9, to: o }); K.nz(0.75, 0.4, { type: 'highpass', f: 1500, vol: 0.7, to: o }); K.grains(0.77, 0.6, { rate: 200, len: 0.003, f: 2500, vol: 0.6, to: o });
  }),
  P('c', '蝶番が飛ぶ', 2.5, '割れると同時に蝶番が金属音を立てて飛び、扉が床に倒れる', (K) => {
    const v = K.verb(1.2, 0.35); const o = K.split(K.out, v, 0.6);
    knock(K, 0.05, { f: 55, d: 0.35, vol: 1, nf: 600, nv: 0.8, to: o }); K.grains(0.06, 0.4, { rate: 160, len: 0.003, f: 2200, vol: 0.5, to: o });
    K.modal(0.08, [[1800, 0.4, 1], [2700, 0.3, 0.5], [4200, 0.2, 0.3]], 0.35, o);
    K.grains(0.3, 0.4, { rate: 20, len: 0.02, f: 3000, vol: 0.3, tone: 3500, to: o });
    knock(K, 1.2, { f: 70, d: 0.3, vol: 0.8, nf: 800, to: o }); K.nz(1.2, 0.2, { type: 'lowpass', f: 800, vol: 0.4, to: o });
  }),
]);
scene('enemy_scream', '管理人', '悲鳴・叫び(襲撃)', '襲撃の振りかぶりの瞬間の叫び(105 の追跡の始まりにも流用中)。', 'enemy_ai.js _attack(scream)／spaces/x105.js update', 'enemy_scream_attack_01(105 の悲鳴は x105_scream)', [
  P('a', '喉を絞った叫び', 2.5, '喉を絞った「あ゛ぁぁ」が上ずる。人間の声に近い', (K) => { const v = K.verb(1.2, 0.3); K.voice(0.05, 1.6, { f0: 230, fc: (u) => 1 + 0.5 * Math.min(1, u * 3), form: [[850, 5, 1], [1250, 6, 0.7], [2900, 8, 0.35]], drive: 4, vol: 0.45, a: 0.04, rel: 0.5, vib: 7, vibd: 0.03, to: K.split(K.out, v, 0.5) }); }),
  P('b', '笑いが混じる', 2.5, '「ハッ、ハッ」と笑ってから叫びに変わる。狂気', (K) => { const v = K.verb(1.0, 0.3); K.voice(0.05, 2.0, { f0: 260, fc: (u) => 1 + 0.3 * u, form: [[800, 5, 1], [1200, 6, 0.6], [2800, 8, 0.3]], drive: 3, vol: 0.45, a: 0.02, rel: 0.4, gate: (u) => (u < 0.45 ? Math.pow(Math.abs(Math.sin(u * Math.PI * 9)), 0.6) : 1), to: K.split(K.out, v, 0.5) }); }),
  P('c', '低い咆哮', 2.5, '獣のような低い「ゴアァ」。重さと体格', (K) => { const v = K.verb(1.4, 0.35); const o = K.split(K.out, v, 0.5); K.voice(0.05, 1.8, { f0: 95, fc: (u) => 1 + 0.25 * Math.sin(Math.PI * u), form: [[500, 4, 1], [900, 5, 0.7], [2400, 7, 0.2]], drive: 8, vol: 0.5, a: 0.05, rel: 0.5, to: o }); K.nz(0.05, 1.5, { color: 'brown', type: 'lowpass', f: 300, vol: 0.3, env: 'swell', to: o }); }),
]);
scene('enemy_hit', '管理人', 'ハンマーの一撃', '襲撃ムービーで振り下ろしが当たる瞬間(画面は血しぶき)。', 'attack_movie.js hit', 'enemy_hit_hammer_01', [
  P('a', '鈍い「ゴッ」', 1.5, '重く鈍い衝撃。見せすぎない', (K) => { knock(K, 0.05, { f: 55, d: 0.25, vol: 1, nf: 700, nv: 0.7 }); K.nz(0.05, 0.04, { type: 'highpass', f: 1200, vol: 0.6 }); K.tn(0.05, 0.3, { f: 40, vol: 0.5 }); }),
  P('b', '乾いた割れ', 1.5, '硬い物が割れる「バキッ」が混じる。痛い', (K) => { knock(K, 0.05, { f: 80, d: 0.15, vol: 0.9, nf: 1500 }); K.grains(0.05, 0.08, { rate: 400, len: 0.002, f: 2200, vol: 0.7 }); K.nz(0.06, 0.06, { f: 1800, q: 1, vol: 0.7 }); }),
  P('c', '湿った重さ', 1.5, '低い衝撃に湿った音が続く。生々しい', (K) => { knock(K, 0.05, { f: 45, d: 0.35, vol: 1, nf: 400 }); K.nz(0.08, 0.25, { color: 'pink', type: 'lowpass', f: 900, vol: 0.5, env: 'swell' }); K.grains(0.08, 0.3, { rate: 60, len: 0.01, f: 900, vol: 0.3 }); }),
]);
scene('death', '管理人', '死亡', '捕まって倒れる(襲撃ムービーの最後→暗転)。', '新設(P4b で main.js の死亡演出に接続)', '—', [
  P('a', '倒れる体と耳鳴り', 3.5, '体が床に崩れる音の後、耳鳴りが残る', (K) => { knock(K, 0.1, { f: 60, d: 0.3, vol: 1, nf: 500, nv: 0.4 }); K.nz(0.1, 0.4, { color: 'pink', f: 1500, q: 0.6, vol: 0.2, env: 'swell' }); K.tn(0.3, 3.0, { f: 6500, vol: 0.08, env: 'swell', p: 0.4 }); }),
  P('b', '心拍が止まる', 3.5, '心拍が遅く弱くなって、止む', (K) => { heart(K, 0.1, 0.8); heart(K, 0.95, 0.5); heart(K, 1.95, 0.25); }),
  P('c', '低い衝撃の残響', 3.5, '低い一撃が長く響いて消える。意識が遠のく', (K) => { const v = K.verb(3.5, 0.8, 0.8); knock(K, 0.1, { f: 40, d: 0.6, vol: 1, nf: 300, to: K.split(K.out, v, 1) }); K.nz(0.1, 2.5, { color: 'brown', type: 'lowpass', f: 200, vol: 0.3, env: 'swell' }); }),
]);
scene('gameover', '管理人', 'ゲームオーバー', '死亡画面(チェックポイントからやり直す前)。音楽は使わない。', '新設(P4b で hud.js の死亡画面に接続)', '—', [
  P('a', '低い残響の「ドン」', 4, '一度だけ低く重い音が鳴って長く残る', (K) => { const v = K.verb(3.5, 0.7, 0.7); knock(K, 0.1, { f: 35, d: 1.2, vol: 1, nf: 200, nv: 0.2, to: K.split(K.out, v, 1) }); }),
  P('b', '遠くで扉が閉まる', 4, '遠い廊下で扉が閉まる音が響く。置き去りにされた感じ', (K) => { const v = K.verb(3, 0.8); const o = K.split(K.muf(700), v, 1); latch(K, 0.3, 0.3, 1500, o); knock(K, 0.35, { f: 80, d: 0.2, vol: 0.6, nf: 600, to: o }); }),
  P('c', '耳鳴りが消える', 4, '耳鳴りと低い床が、ゆっくり消えていく', (K) => { K.tn(0, 3.8, { f: 7000, vol: 0.08, env: 'swell', p: 0.3 }); K.nz(0, 3.8, { color: 'brown', type: 'lowpass', f: 80, vol: 0.3, env: 'swell', p: 0.3 }); }, 'quiet'),
]);
scene('checkpoint', '管理人', 'チェックポイント', '各段の開始時に記録される(死亡後はここから)。音楽ではなく小さな合図。', '新設(P4b で story.js 各段の開始に接続)', '—', [
  P('a', '安堵の息', 2, '自分の小さな吐息。「ひと段落」', (K) => { K.nz(0.2, 1.2, { color: 'pink', f: 900, f2: 600, q: 1, vol: 0.3, env: 'swell' }); }),
  P('b', '時計の一回の「チク」', 2, 'どこかの時計が一度だけ進む。時間が記録された', (K) => { const v = K.verb(1.2, 0.4); K.modal(0.2, [[3000, 0.04, 1], [4500, 0.03, 0.5]], 0.3, K.split(K.out, v, 0.6)); }),
  P('c', '柔らかい低い打音', 2, '木を軽く叩いたような低い一音', (K) => { K.tn(0.15, 1.2, { f: 110, f2: 100, vol: 0.4 }); K.tn(0.15, 0.6, { f: 220, vol: 0.1 }); }),
]);
scene('watcher_silence', '管理人', '窓越しの管理人(無音の圧)', '廊下端・居室の窓の外に、こちらを見上げる管理人が見えた時(襲ってこない)。', '新設(P4b で watcher.js の見えた瞬間に接続)', '—', [
  P('a', '耳鳴り', 8, '細く高い耳鳴りが二重にうなる。音が消えたように感じる', (K) => { K.tn(0, 8, { f: 8200, vol: 0.05, env: 'swell', p: 0.3 }); K.tn(0, 8, { f: 8350, vol: 0.02, env: 'swell', p: 0.3 }); K.bed(8, { color: 'brown', f: 80, vol: 0.1 }); }, 'quiet'),
  P('b', '気圧のうねり', 8, '耳がつまるような低いうねり。体で感じる圧', (K) => { K.tn(0, 8, { f: 28, vol: 0.5, env: 'swell', p: 0.6 }); K.bed(8, { color: 'brown', f: 60, vol: 0.4, lfo: [0.15, 0.8] }); }, 'quiet'),
  P('c', '心拍が一つ', 8, '完全な無音の中で、自分の心拍が一度だけ鳴る', (K) => { K.bed(8, { color: 'brown', f: 70, vol: 0.03 }); heart(K, 4.0, 0.7); }, 'quiet'),
]);

// ---------------------------------------------------------------- 4. 1F・221・管理室
scene('amb_lobby', '1F・221・管理室', '1F ロビー・風除室', '1F の共用部(エントランス・風除室・メールコーナー・食堂前)にいる間。', '新設(P4b で main.js の環境音バスに追加)', '—', [
  P('a', '広い空間と遠くの車', 10, '天井の高い空間の静けさに、遠くを車が一台通り過ぎる', (K) => { K.bed(10, { color: 'brown', f: 150, vol: 0.1 }); const o = K.muf(600); K.nz(2.5, 4.5, { color: 'pink', type: 'lowpass', f: 600, vol: 0.25, env: 'swell', to: o }); K.tn(2.5, 4.5, { type: 'sawtooth', f: 60, vol: 0.05, env: 'swell', lpf: 200, to: o }); }, 'amb'),
  P('b', '風除室のガラスが鳴る', 10, '外の風で自動ドアのガラスがときどき細かく震える', (K) => { K.bed(10, { color: 'pink', type: 'bandpass', f: 400, q: 1, vol: 0.2, lfo: [0.1, 0.9] }); for (const t of [3.3, 7.0]) K.grains(t, 0.25, { rate: 30, len: 0.01, f: 2500, q: 2, vol: 0.3 }); K.modal(5.2, [[3100, 0.08, 1]], 0.08); }, 'amb'),
  P('c', '時計が止まる', 10, '壁の時計の秒針が刻み、途中でふっと止まる', (K) => { K.bed(10, { color: 'brown', f: 100, vol: 0.04 }); const v = K.verb(1.5, 0.4); const o = K.split(K.out, v, 0.6); for (let i = 0; i < 6; i++) K.modal(0.5 + i, [[2800, 0.03, 1], [4200, 0.02, 0.4]], i === 5 ? 0.1 : 0.2, o, 0.3); }, 'amb'),
]);
scene('door_glass', '1F・221・管理室', '扉の開閉：ガラス扉', '1F 食堂の透明なガラス扉(P5b-3)。', '新設(P4b で main.js useNearestDoor に接続。扉の種類で切り替え)', '—', [
  P('a', '軽いガラス扉', 3.2, '開けるとガラスが小さく震え、閉めると軽く鳴る', (K) => { for (let i = 0; i < 3; i++) K.modal(0.1 + i * 0.07, [[2600 + i * 200, 0.05, 1]], 0.12); K.nz(0.2, 0.6, { type: 'lowpass', f: 500, vol: 0.08, env: 'swell' }); knock(K, 2.0, { f: 180, vol: 0.4, nf: 2500 }); K.modal(2.0, [[1900, 0.35, 1], [3100, 0.25, 0.5], [4700, 0.15, 0.3]], 0.3); }),
  P('b', '強化ガラスとクローザー', 3.2, 'ドアクローザーの「シュー」でゆっくり閉まり、低めに鳴る', (K) => { knock(K, 0.1, { f: 150, vol: 0.3, nf: 1500 }); K.nz(0.6, 1.4, { f: 1200, q: 0.6, vol: 0.12, env: 'swell' }); knock(K, 2.1, { f: 120, vol: 0.4, nf: 1200 }); K.modal(2.1, [[1400, 0.4, 1], [2300, 0.3, 0.5]], 0.25); }),
  P('c', '金属枠の「カタン」', 3.2, '金属の枠が当たる「カタン」とガラスのびびり', (K) => { K.modal(0.1, [[1200, 0.1, 1], [2000, 0.06, 0.5]], 0.3); K.modal(2.0, [[880, 0.25, 1], [1350, 0.2, 0.6], [2600, 0.1, 0.3]], 0.5); knock(K, 2.0, { f: 150, vol: 0.4, nf: 1600 }); K.grains(2.02, 0.2, { rate: 120, len: 0.004, f: 3000, vol: 0.2 }); }),
]);
scene('door_steel', '1F・221・管理室', '扉の開閉：鉄扉', 'シアターの鉄製二重扉・EV ホールの鉄扉・北階段・食堂奥の地下の鉄扉・B1 踊り場の扉。', '新設(P4b で main.js useNearestDoor)／spaces/xb1.js sfx(clank)', 'xb1_door_clank_01', [
  P('a', '重い鉄扉の「ガーン」', 3.6, '閉まると鉄板が低く長く鳴って響く', (K) => { const v = K.verb(2, 0.35); const o = K.split(K.out, v, 0.7); K.modal(0.1, [[900, 0.1, 1], [1500, 0.06, 0.4]], 0.25, o); K.nz(0.3, 1.0, { color: 'brown', type: 'lowpass', f: 300, vol: 0.12, env: 'swell' }); knock(K, 2.0, { f: 55, d: 0.3, vol: 0.9, nf: 400, to: o }); K.modal(2.0, [[180, 1.2, 1], [410, 0.9, 0.6], [730, 0.6, 0.4], [1150, 0.4, 0.25]], 0.45, o); }),
  P('b', '錆びた蝶番', 3.6, '錆びた蝶番が低く長く軋み、「ドン」と閉まる', (K) => { K.creak(0.3, 1.3, { rate: 28, rate2: 18, f: 520, f2: 1300, q: 7, vol: 0.5, p: 0.4 }); knock(K, 2.3, { f: 70, d: 0.25, vol: 0.8, nf: 500 }); K.modal(2.3, [[200, 0.8, 1], [460, 0.6, 0.5]], 0.3); }),
  P('c', 'プッシュバー「ガチャン」', 3.6, '非常扉のバーを押す金属音と、ばねで閉まる音', (K) => { const v = K.verb(1.5, 0.3); const o = K.split(K.out, v, 0.6); K.modal(0.1, [[1100, 0.15, 1], [2300, 0.1, 0.5]], 0.4, o); knock(K, 0.1, { f: 200, vol: 0.5, nf: 1800, to: o }); knock(K, 2.2, { f: 70, d: 0.2, vol: 0.8, nf: 500, to: o }); K.modal(2.25, [[1500, 0.1, 1]], 0.25, o); }),
]);
scene('story_221_lure', '1F・221・管理室', '221 の口実(奥へ誘う音)', '221 は普通の部屋。奥まで進ませる口実の音(鳴る電話・机の手紙・クローゼットの開閉音)。', '新設(P4b で story.js の 221 に接続)', '—', [
  P('a', '壁越しの電話', 6, '奥の部屋で黒電話のベルが鳴っては止む。壁越しにこもる', (K) => { const v = K.verb(0.8, 0.3); const o = K.split(K.muf(1500), v, 0.5); for (const s of [0.2, 3.2]) for (let t = s; t < s + 1.0; t += 0.05) { K.modal(t, [[1050, 0.06, 1], [2650, 0.04, 0.4]], 0.18, o, 0); K.modal(t + 0.025, [[1300, 0.06, 1], [3100, 0.04, 0.4]], 0.18, o, 0); } }),
  P('b', '机の手紙が揺れる', 6, '窓の隙間風で机の紙がときどき「カサッ」と鳴る', (K) => { K.bed(6, { color: 'pink', type: 'bandpass', f: 500, q: 1, vol: 0.05 }); for (const [t, d] of [[0.5, 0.3], [1.8, 0.5], [3.6, 0.25], [4.4, 0.4]]) paper(K, t, d, 0.3); }),
  P('c', 'クローゼットがひとりでに閉まる', 6, '奥でクローゼットの戸がゆっくり軋み、「パタン」と閉まる', (K) => { const v = K.verb(0.8, 0.3); const o = K.split(K.muf(2500), v, 0.6); K.creak(0.5, 1.4, { rate: 40, rate2: 25, f: 700, q: 5, vol: 0.35, to: o }); knock(K, 2.1, { f: 130, vol: 0.5, nf: 1200, to: o }); }),
]);
scene('locker_tease', '1F・221・管理室', 'ロッカーの中で何かが当たる(予兆)', '221・6F の罠のロッカー登場の 1 段目(中で当たる音・扉がわずかに揺れる)。', 'enemy_ai.js _reveal(lockerRattle)', 'room_locker_rattle_01', [
  P('a', '中で当たる', 2.5, 'スチールの中で肘が当たるような「ゴン」が数回', (K) => { for (const [t, v] of [[0.2, 1], [0.55, 0.5], [1.4, 0.7]]) { knock(K, t, { f: 120, vol: 0.4 * v, nf: 900 }); K.modal(t, [[210, 0.5, 1], [470, 0.4, 0.6], [880, 0.3, 0.4], [1500, 0.2, 0.2]], 0.3 * v); } }),
  P('b', '扉が内側から押される', 2.5, '薄い鉄板が内側から押されて「ボコッ」とへこみ、戻る', (K) => { for (const t of [0.3, 1.1]) { knock(K, t, { f: 300, d: 0.04, vol: 0.3, nf: 2000 }); K.modal(t, [[340, 0.3, 1], [760, 0.25, 0.5]], 0.4); } }),
  P('c', '爪で掻く', 2.5, '内側から鉄板を爪で掻く音がこもって響く', (K) => { const g = K.gain(1); g.connect(K.filt('bandpass', 900, 4, K.out)); g.connect(K.filt('bandpass', 2000, 4, K.gain(0.6, K.out))); K.grains(0.3, 1.2, { rate: 60, len: 0.003, f: 3000, vol: 1.2, to: g }); }),
]);
scene('locker_open_slow', '1F・221・管理室', 'ロッカーの扉がゆっくり開く', 'ロッカー登場の 2 段目(軋み→扉がゆっくり 1.0〜1.5 秒で開き、中に管理人が立っている)。', 'enemy_ai.js _reveal(lockerCreak)', 'room_locker_creak_slow_01', [
  P('a', '高い金属の軋み', 3, 'ラッチが外れ、細く高い金属の軋みが続く', (K) => { K.modal(0.1, [[2000, 0.05, 1]], 0.3); K.creak(0.2, 2.0, { rate: 50, rate2: 30, f: 1200, f2: 2600, q: 8, vol: 0.45, p: 0.3 }); }),
  P('b', '低くうなる軋み', 3, '低く唸るような軋みで開き、最後に扉が軽く当たる', (K) => { K.creak(0.2, 2.2, { rate: 22, rate2: 14, f: 420, f2: 900, q: 6, vol: 0.5, p: 0.4 }); K.modal(2.4, [[230, 0.4, 1], [520, 0.3, 0.4]], 0.15); }),
  P('c', '途切れ途切れ', 3, '軋んでは止まり、また少し開く。中から押している', (K) => { latch(K, 0.1, 0.25, 2000); for (const [t, d, r] of [[0.2, 0.5, 45], [0.9, 0.4, 35], [1.5, 0.8, 25]]) K.creak(t, d, { rate: r, rate2: r * 0.7, f: 800, f2: 1800, q: 7, vol: 0.45 }); }),
]);
scene('locker_burst', '1F・221・管理室', 'ロッカーから出てくる', 'ロッカー登場の 3 段目(管理人がゆっくり出てくる→追跡へ)。', '新設(P4b で enemy_ai.js _reveal の emerge に接続。今は無音)', '—', [
  P('a', '扉が叩きつけられる', 2.5, '扉が壁に叩きつけられる金属の轟音、重い 2 歩', (K) => { const v = K.verb(1, 0.3); const o = K.split(K.out, v, 0.5); K.modal(0.1, [[180, 0.8, 1], [420, 0.6, 0.7], [760, 0.5, 0.5], [1300, 0.3, 0.3]], 0.5, o); knock(K, 0.1, { f: 70, d: 0.2, vol: 0.9, nf: 600, to: o }); knock(K, 0.7, { f: 65, d: 0.15, vol: 0.6, nf: 800 }); knock(K, 1.2, { f: 65, d: 0.15, vol: 0.7, nf: 800 }); }),
  P('b', '重い足が出てくる', 2.5, 'ロッカーの中で一歩、外へ一歩。衣擦れ。ゆっくり', (K) => { knock(K, 0.2, { f: 90, vol: 0.4, nf: 900 }); K.modal(0.2, [[230, 0.3, 1]], 0.15); K.nz(0.5, 0.6, { color: 'pink', f: 1800, q: 0.6, vol: 0.2, env: 'swell' }); knock(K, 0.8, { f: 65, d: 0.18, vol: 0.8, nf: 800 }); K.modal(1.4, [[400, 0.3, 1], [900, 0.2, 0.4]], 0.15); }),
  P('c', '吐息と一緒に', 2.5, '中から強い吐息が漏れ、同時に扉が開け放たれる', (K) => { K.nz(0.05, 0.6, { color: 'pink', f: 700, q: 1, vol: 0.5, env: 'swell' }); K.modal(0.15, [[180, 0.8, 1], [420, 0.6, 0.7], [760, 0.5, 0.5]], 0.45); knock(K, 0.15, { f: 70, d: 0.2, vol: 0.8, nf: 600 }); }),
]);
scene('pickup_key', '1F・221・管理室', '鍵を拾う', '鍵を取る(221 の小さな鍵・管理室のキーボックスの 312 の鍵・各段の鍵)。', 'story.js pick(key)', 'key_pickup_01', [
  P('a', '小さな金属音', 1.2, '机から鍵をつまむ「チャリ」。軽い', (K) => { knock(K, 0.08, { f: 400, d: 0.03, vol: 0.15, nf: 3000 }); K.modal(0.1, [[3800, 0.12, 1], [5200, 0.08, 0.5], [2600, 0.1, 0.4]], 0.35); }),
  P('b', '鍵と輪', 1.2, '鍵に付いた輪と札が触れ合う', (K) => { jingle(K, 0.1, 0.25, 5, 0.3); K.modal(0.12, [[2200, 0.2, 1]], 0.15); }),
  P('c', '机からすべらせる', 1.2, '机の上を滑らせてから持ち上げる', (K) => { K.nz(0.05, 0.35, { f: 2500, q: 1, vol: 0.12, env: 'swell' }); K.modal(0.42, [[3600, 0.1, 1], [5000, 0.07, 0.4]], 0.3); }),
]);
scene('pickup_paper', '1F・221・管理室', 'メモを拾う', '食堂の「221」のメモ・105 の玄関のメモなどを拾って読む。', 'story.js pick(paper)', 'paper_pickup_01', [
  P('a', 'つまむ', 1.2, '紙を一枚つまみ上げる「カサ」', (K) => paper(K, 0.1, 0.3, 0.4)),
  P('b', '折った紙を開く', 1.2, '折りたたんだ紙を開く「パリ…」', (K) => { paper(K, 0.1, 0.25, 0.35); paper(K, 0.45, 0.35, 0.45, 1.5); K.nz(0.8, 0.02, { f: 3000, vol: 0.2 }); }),
  P('c', '湿った紙', 1.2, '湿って柔らかくなった紙。音が鈍い', (K) => { K.nz(0.1, 0.5, { color: 'pink', type: 'lowpass', f: 1500, vol: 0.3, env: 'swell' }); K.grains(0.1, 0.5, { rate: 25, len: 0.01, f: 1200, vol: 0.2 }); }),
]);
scene('key_unlock', '1F・221・管理室', '鍵を使う', '扉の前で E →「鍵を使った」→解錠して少し開く(312・105・220・705・地下・屋上の南京錠)。', 'story.js useKey(unlock)', 'key_unlock_01', [
  P('a', 'シリンダー「カチャリ」', 1.5, '差し込み、回し、デッドボルトが引っ込む', (K) => { K.grains(0.1, 0.2, { rate: 150, len: 0.002, f: 4000, vol: 0.2 }); K.modal(0.45, [[1800, 0.06, 1], [2900, 0.05, 0.6]], 0.35); knock(K, 0.5, { f: 300, d: 0.04, vol: 0.3, nf: 2200 }); K.modal(0.62, [[1200, 0.06, 1]], 0.3); knock(K, 0.62, { f: 180, d: 0.05, vol: 0.35, nf: 1500 }); }),
  P('b', '固い錠「ガチッ」', 1.5, '固くて回らない→力を入れて「ガチッ」と外れる', (K) => { K.grains(0.1, 0.2, { rate: 150, len: 0.002, f: 4000, vol: 0.2 }); K.creak(0.4, 0.25, { rate: 120, f: 2000, q: 6, vol: 0.2 }); knock(K, 0.7, { f: 220, d: 0.05, vol: 0.7, nf: 1800 }); K.modal(0.7, [[1400, 0.08, 1], [2200, 0.06, 0.5]], 0.5); }),
  P('c', '南京錠「カシャン」', 1.5, 'つるがばねで跳ね上がり、錠がぶら下がって揺れる', (K) => { K.grains(0.1, 0.15, { rate: 150, len: 0.002, f: 4000, vol: 0.2 }); K.modal(0.5, [[2400, 0.15, 1], [3600, 0.1, 0.6], [1500, 0.2, 0.4]], 0.5); knock(K, 0.5, { f: 500, d: 0.03, vol: 0.3, nf: 3000 }); jingle(K, 0.65, 0.3, 4, 0.15); }),
]);

// ---------------------------------------------------------------- 5. 312 プール(異世界)
scene('amb_x312_above', '312 プール', '312 プール(水の上)', '312 の中。青いタイルの通路と天井の高い室内プール(水の上にいる間)。', 'spaces/x312.js ambience(st.amb の水の上の層)', 'x312_pool_room_loop_01', [
  P('a', '循環ポンプとさざ波', 10, 'こもった循環ポンプの音と、プールの縁に寄せるさざ波', (K) => { const v = K.verb(3, 0.4); K.bed(10, { color: 'pink', type: 'bandpass', f: 520, q: 1, vol: 0.25 }); K.bed(10, { color: 'brown', f: 120, vol: 0.1 }); for (let t = 0.5; t < 9.5; t += 1.2 + K.r()) K.nz(t, 0.6, { f: 900, q: 1.2, vol: 0.1, env: 'swell', to: K.split(K.out, v, 0.8) }); }, 'amb'),
  P('b', '広い残響の滴り', 10, '天井から落ちる滴りが、広い空間で長く響く', (K) => { const v = K.verb(4, 0.8); const e = K.echo(0.31, 0.3, 2500, K.out); K.bed(10, { color: 'brown', f: 100, vol: 0.04 }); for (let t = 0.4; t < 9.5; t += 0.8 + K.r() * 2) { const f = K.rnd(1300, 2600); K.tn(t, 0.12, { f, f2: f * 0.55, vol: 0.25, to: K.split(K.split(K.out, v, 0.9), e, 0.3) }); } }, 'amb'),
  P('c', '水面の揺らぎ', 10, '大きくゆっくり揺れる水面の音と、小さな泡', (K) => { const v = K.verb(2.5, 0.4); for (const t of [0, 2.5, 5, 7.5]) K.nz(t, 2.8, { color: 'pink', type: 'lowpass', f: 700, vol: 0.2, env: 'swell', p: 1, to: K.split(K.out, v, 0.6) }); bubbles(K, 0, 10, 4, 0.08); }, 'amb'),
]);
scene('x312_dive', '312 プール', '入水・潜る', '312 の水中で Ctrl 長押しで潜る(息を止めて水中へ)。', 'spaces/x312.js sfx(splash)', 'x312_splash_in_01', [
  P('a', '「ばしゃ」と息を止める', 3, '息を吸って止め、水しぶき→水中のこもった泡', (K) => { K.nz(0.05, 0.4, { color: 'pink', f: 1600, q: 1, vol: 0.3, env: 'swell' }); K.nz(0.5, 0.4, { f: 900, q: 0.8, vol: 0.7 }); K.nz(0.5, 0.25, { type: 'highpass', f: 2500, vol: 0.35 }); K.grains(0.5, 0.6, { rate: 60, len: 0.02, f: 2500, vol: 0.3, tone: 1500 }); bubbles(K, 1.0, 1.6, 15, 0.3, K.muf(600)); }),
  P('b', '静かに沈む', 3, '水しぶきを立てず、すっと沈んで泡が上がっていく', (K) => { K.nz(0.1, 0.5, { type: 'lowpass', f: 900, vol: 0.2, env: 'swell' }); bubbles(K, 0.7, 2.1, 10, 0.3, K.muf(700)); K.tn(0.7, 0.4, { f: 60, vol: 0.2 }); }),
  P('c', '勢いよく飛び込む', 3, '大きな水しぶきと体が水を打つ低い音、泡の渦', (K) => { K.nz(0.1, 0.7, { f: 800, q: 0.6, vol: 0.9 }); K.tn(0.1, 0.2, { f: 70, vol: 0.6 }); K.grains(0.1, 0.8, { rate: 90, len: 0.02, f: 2500, vol: 0.3, tone: 1400 }); bubbles(K, 0.9, 1.0, 30, 0.35, K.muf(600)); }),
]);
scene('amb_x312_under', '312 プール', '312 水中', '潜っている間(上の照明が歪み、音がこもる)。', 'spaces/x312.js ambience(st.amb の水中の層)', 'x312_underwater_loop_01', [
  P('a', 'こもりと泡', 10, '低くこもった水の音に、自分の泡がときどき上がる', (K) => { K.bed(10, { color: 'brown', f: 200, vol: 0.35 }); bubbles(K, 0, 10, 3, 0.15, K.muf(900)); K.tn(0, 10, { f: 52, vol: 0.1, env: 'flat' }); }, 'amb'),
  P('b', '耳の圧迫', 10, '水圧で耳がつまる低いうねり。息が苦しくなる感じ', (K) => { K.bed(10, { color: 'brown', f: 120, vol: 0.4, lfo: [0.2, 0.6] }); K.tn(0, 10, { f: 35, vol: 0.2, env: 'swell', p: 0.5 }); }, 'amb'),
  P('c', '遠い金属音', 10, 'こもった水の中、遠くで何かが金属に当たる音が届く', (K) => { K.bed(10, { color: 'brown', f: 180, vol: 0.25 }); const v = K.verb(4, 0.8, 0.8); K.modal(4.0, [[220, 2, 1], [550, 1.5, 0.5]], 0.3, K.split(K.muf(600), v, 1)); }, 'amb'),
]);
scene('pl_step_water', '312 プール', '足音：水中・水辺', 'プールの浅瀬を歩く・底を歩く・泳ぐ。', '新設(P4b で spaces/x312.js の移動に接続)', '—', [
  P('a', '水を蹴る', 4, '膝までの水をかき分ける「ザブ、ザブ」', (K) => walk(K, 5, 0.75, (t, i, acc) => { K.nz(t, 0.35, { f: 800, q: 0.8, vol: 0.4 * acc, env: 'swell' }); K.grains(t + 0.1, 0.25, { rate: 40, len: 0.02, f: 2500, vol: 0.2, tone: 1700 }); })),
  P('b', '底を歩く(水中)', 4, '水中で底を踏む鈍い音と、小さな泡', (K) => { const o = K.muf(700); walk(K, 6, 0.65, (t, i, acc) => { K.tn(t, 0.15, { f: 80, f2: 60, vol: 0.5 * acc, lpf: 300 }); bubbles(K, t, 0.2, 6, 0.2, o); }); }),
  P('c', '浅瀬のぱちゃぱちゃ', 4, '足首までの水を速めに歩く', (K) => walk(K, 8, 0.45, (t, i, acc) => { K.nz(t, 0.08, { f: 1500, q: 0.8, vol: 0.4 * acc }); K.grains(t + 0.03, 0.1, { rate: 80, len: 0.015, f: 2500, vol: 0.15, tone: 1900 }); })),
]);
scene('x312_gasp', '312 プール', '浮上の息継ぎ', '底の鍵を取って浮上し、息を吸う(プールサイドの管理人は見ているだけ)。', 'spaces/x312.js sfx(gasp)', 'x312_surface_gasp_01', [
  P('a', '大きく吸う', 2.5, '水面を割って「ハァッ」と大きく吸い、吐く', (K) => { K.nz(0.05, 0.2, { f: 1200, vol: 0.3 }); K.nz(0.15, 0.6, { color: 'pink', f: 1500, f2: 2200, q: 1, vol: 0.6, env: 'swell' }); K.tn(0.15, 0.5, { type: 'sawtooth', f: 180, vol: 0.04, env: 'swell', lpf: 900 }); K.nz(0.9, 0.6, { color: 'pink', f: 900, q: 1, vol: 0.35, env: 'swell' }); }),
  P('b', '咳き込む', 2.5, '吸った直後に水を飲んで咳き込む', (K) => { K.nz(0.05, 0.4, { color: 'pink', f: 1600, q: 1, vol: 0.5, env: 'swell' }); for (const t of [0.8, 1.1, 1.45]) K.voice(t, 0.18, { f0: 140, form: [[600, 3, 1], [1700, 5, 0.6]], drive: 6, breath: 0.4, vol: 0.4, a: 0.01, rel: 0.1 }); }),
  P('c', '震える息', 2.5, '吸った後、震えながら吐く。寒さと恐怖', (K) => { K.nz(0.05, 0.5, { color: 'pink', f: 1500, q: 1, vol: 0.5, env: 'swell' }); K.nz(0.7, 1.5, { color: 'pink', f: 900, f2: 600, q: 1, vol: 0.4, env: 'swell', to: K.shape(0.7, 1.5, 1, (u) => 0.5 + 0.5 * Math.sin(u * 2 * Math.PI * 10), K.out) }); }),
]);
scene('x312_drown', '312 プール', '溺れる', '息ゲージが尽きる(水中で死亡)。', 'spaces/x312.js sfx(drown)', 'x312_drown_01', [
  P('a', '水中でもがく', 3.5, '大量の泡ともがく音、こもった叫び', (K) => { const o = K.muf(500); bubbles(K, 0.1, 1.5, 40, 0.4, o); for (const t of [0.2, 0.6, 1.0]) K.tn(t, 0.2, { f: 70, vol: 0.3, to: o }); K.voice(0.3, 1.0, { f0: 200, form: [[600, 3, 1], [1000, 4, 0.5]], drive: 3, vol: 0.3, to: o }); }),
  P('b', '息が尽きる', 3.5, '心拍が遅くなり、泡がまばらになって止む', (K) => { const o = K.muf(600); bubbles(K, 0.1, 1.2, 12, 0.3, o); heart(K, 0.3, 0.6, o); heart(K, 1.4, 0.4, o); heart(K, 2.6, 0.2, o); K.tn(0, 3.4, { f: 40, vol: 0.2, env: 'swell' }); }),
  P('c', '最後の大きな泡', 3.5, 'こもった短い叫びと大きな泡のかたまり→静寂', (K) => { const o = K.muf(400); K.voice(0.2, 0.8, { f0: 160, form: [[500, 3, 1], [900, 4, 0.5]], drive: 4, vol: 0.4, to: o }); bubbles(K, 0.9, 0.8, 50, 0.45, K.muf(800)); }),
]);

// ---------------------------------------------------------------- 6. 105 長い廊下(異世界)
scene('amb_x105', '105 長い廊下', '105 の廊下(灯具のうなり)', '105 の中。灰色の均質な廊下を進むほど灯具のうなりが大きくなり、消えた灯りの所で弱まる。', 'spaces/x105.js sound(st.hum)', 'x105_hum_loop_01', [
  P('a', '蛍光灯のうなり', 10, '100Hz の蛍光灯のうなりと安定器の細かい音。昔の廊下', (K) => { K.tn(0, 10, { type: 'sawtooth', f: 100, vol: 0.12, env: 'flat', lpf: 900 }); K.tn(0, 10, { f: 200, vol: 0.05, env: 'flat' }); K.grains(0, 10, { rate: 8, len: 0.003, f: 4000, vol: 0.04 }); }, 'amb'),
  P('b', '遠くで唸る', 10, '音程のはっきりしない低い唸りが、廊下の奥からゆっくり寄せる', (K) => { K.bed(10, { color: 'brown', type: 'bandpass', f: 120, q: 2, vol: 0.4, lfo: [0.05, 0.6] }); K.tn(0, 10, { f: 50, vol: 0.06, env: 'swell', p: 0.5 }); }, 'amb'),
  P('c', '長すぎる廊下の静けさ', 10, 'ほぼ無音。遠くの小さな音が異様に長く響いて戻る', (K) => { K.bed(10, { color: 'brown', f: 100, vol: 0.05 }); const v = K.verb(3.5, 0.9, 0.7); const e = K.echo(0.6, 0.45, 1500, K.out); for (const t of [3, 7]) K.modal(t, [[3000, 0.05, 1]], 0.15, K.split(K.split(K.out, v, 1), e, 0.6)); }, 'amb'),
]);
scene('x105_scream', '105 長い廊下', '遠い悲鳴(追跡の始まり)', '105 でしばらく進むと後ろから管理人が悲鳴を上げて追ってくる。B1 の戻りの遠い悲鳴にも使う。', 'spaces/x105.js update(scream)／spaces/xb1.js sound(遠い悲鳴)', 'x105_scream_01・xb1_scream_far_01', [
  P('a', '廊下の奥から響く', 3.5, '背後のはるか奥で叫び、廊下全体に反響する', (K) => { const v = K.verb(3, 0.9, 0.6); const e = K.echo(0.35, 0.4, 2000, K.out); const o = K.split(K.split(K.muf(1500), v, 1), e, 0.5); K.voice(0.1, 1.6, { f0: 230, fc: (u) => 1 + 0.5 * Math.min(1, u * 3), form: [[850, 5, 1], [1250, 6, 0.7], [2900, 8, 0.35]], drive: 4, vol: 0.5, rel: 0.5, vib: 7, vibd: 0.03, to: o }); }),
  P('b', '長く伸びる', 3.5, '一息で長く伸び、最後に音程が崩れる', (K) => { const v = K.verb(2.5, 0.7); K.voice(0.1, 2.6, { f0: 300, fc: (u) => 1 + 0.2 * u - 0.45 * u * u, form: [[800, 5, 1], [1200, 6, 0.6], [2800, 8, 0.3]], drive: 3, vol: 0.45, rel: 0.6, vib: 5, vibd: 0.04, to: K.split(K.muf(2200), v, 0.8) }); }),
  P('c', '途切れて近づく', 3.5, '遠くで短く一声、間を置いてもっと近くでもう一声', (K) => { const v = K.verb(2.5, 0.6); K.voice(0.2, 0.8, { f0: 240, fc: (u) => 1 + 0.3 * u, drive: 4, vol: 0.2, rel: 0.3, to: K.split(K.muf(800), v, 1) }); K.voice(1.8, 1.2, { f0: 250, fc: (u) => 1 + 0.4 * u, drive: 4, vol: 0.5, rel: 0.4, to: K.split(K.muf(2500), v, 0.5) }); }),
]);
scene('x105_lamp_off', '105 長い廊下', '背後の灯りが消える', '105 の追跡中、背後から灯りが一つずつ消える。705 の天窓の灯りにも同系の音。', 'spaces/x105.js sound(灯りの消灯ごと)', 'x105_lamp_off_01', [
  P('a', '安定器の「バチッ」', 1.5, '小さな放電音と同時にうなりが途切れる', (K) => { K.tn(0, 0.3, { type: 'sawtooth', f: 100, vol: 0.08, env: 'flat', lpf: 900 }); K.nz(0.3, 0.08, { f: 2400, q: 2, vol: 0.5 }); knock(K, 0.3, { f: 300, d: 0.03, vol: 0.2, nf: 3000 }); }),
  P('b', 'リレーの低い「ガチャン」', 1.5, '遠い配電盤のリレーが落ちる音が長い廊下に響く', (K) => { const v = K.verb(2, 0.5); const o = K.split(K.out, v, 0.8); knock(K, 0.1, { f: 120, vol: 0.5, nf: 800, to: o }); K.modal(0.1, [[700, 0.2, 1], [1300, 0.15, 0.5]], 0.2, o); }),
  P('c', 'ジ…と消える', 1.5, '灯りがジジッと鳴りながら弱まって消える', (K) => { K.tn(0, 0.5, { type: 'sawtooth', f: 120, f2: 60, vol: 0.1, env: 'swell', lpf: 1200 }); K.grains(0, 0.4, { rate: 50, len: 0.003, f: 3000, vol: 0.15 }); }),
]);
scene('space_warp', '105 長い廊下', '歪み・反転', '異世界の歪み(105 の壁のたわみと上下反転・312 の反転・705 の歪み)。', 'spaces/x705.js sound(d1/d2 の歪みのうなり)／x105.js setRoll(反転)・x312.js(反転)は新設', 'x705_warp_drone_01', [
  P('a', '低いうねり', 6, '近い 2 つの低音がうなり合う。めまい', (K) => { K.tn(0, 6, { type: 'sawtooth', f: 41, vol: 0.3, env: 'swell', p: 0.6, lpf: 160 }); K.tn(0, 6, { type: 'sawtooth', f: 43.3, vol: 0.3, env: 'swell', p: 0.6, lpf: 160 }); }, 'amb'),
  P('b', '引き伸ばされる空気', 6, '空気が引き伸ばされるように音程のないノイズが上がっていく', (K) => { K.nz(0, 6, { color: 'pink', f: 200, f2: 1200, q: 3, vol: 0.4, env: 'swell', p: 0.8 }); K.tn(0, 6, { f: 60, f2: 30, vol: 0.2, env: 'swell' }); }, 'amb'),
  P('c', '耳がつまる', 6, '気圧が変わって耳がつまる。高い音が下へ落ちる', (K) => { K.tn(0, 6, { f: 30, vol: 0.4, env: 'swell', p: 0.5 }); K.bed(6, { color: 'brown', f: 150, vol: 0.3, lfo: [0.3, 1] }); K.tn(0, 6, { f: 5000, f2: 3000, vol: 0.02, env: 'swell' }); }, 'amb'),
]);

// ---------------------------------------------------------------- 7. 6F の罠・220
scene('decoy_key', '6F の罠・220', '6F の罠の偽の鍵', '6F の罠の 3 室で机の鍵に近づく/取ると、ロッカーから管理人(偽の鍵)。', 'story.js pick(decoy)', '— (今は key_pickup_01 を流用)', [
  P('a', 'ブリキの鈍い音', 2.5, '拾った鍵が妙に軽く鈍い。「これじゃない」', (K) => { knock(K, 0.1, { f: 300, d: 0.03, vol: 0.2, nf: 2500 }); K.modal(0.12, [[900, 0.05, 1], [1300, 0.04, 0.5]], 0.4); }),
  P('b', '低い弦の擦れ', 2.5, '拾った瞬間、どこからか低い弦を擦るような不協和の音', (K) => { K.modal(0.1, [[3600, 0.1, 1]], 0.25); K.creak(0.4, 1.8, { rate: 90, f: 220, q: 12, vol: 0.25, p: 0.8 }); K.tn(0.4, 1.8, { type: 'sawtooth', f: 92.5, vol: 0.05, env: 'swell', lpf: 400 }); K.tn(0.4, 1.8, { type: 'sawtooth', f: 98, vol: 0.05, env: 'swell', lpf: 400 }); }),
  P('c', '奥でロッカーが一度鳴る', 2.5, '拾うと、部屋の奥のロッカーが一度だけ「ゴン」と鳴る', (K) => { K.modal(0.1, [[3800, 0.1, 1], [5200, 0.07, 0.5]], 0.3); const v = K.verb(0.8, 0.3); const o = K.split(K.muf(800), v, 0.6); knock(K, 1.4, { f: 90, vol: 0.5, nf: 700, to: o }); K.modal(1.4, [[210, 0.6, 1], [480, 0.4, 0.6], [900, 0.3, 0.3]], 0.4, o); }),
]);

// ---------------------------------------------------------------- 8. 正面玄関・駐車場・屋上
scene('door_auto', '正面玄関・駐車場・屋上', '扉の開閉：自動ドア', '風除室の鍵スイッチで外側の自動ドアが動く(第 7 段)。最後の脱走でも通る。', '新設(P4b で story.js の鍵スイッチ・main.js の自動ドアに接続)', '—', [
  P('a', 'モーターとゴム', 4, 'ドアエンジンの「ウィーン」と戸当たりのゴム', (K) => { for (const t of [0.1, 2.3]) { K.tn(t, 1.4, { type: 'sawtooth', f: 180, f2: 240, vol: 0.1, env: 'swell', lpf: 700 }); knock(K, t + 1.4, { f: 90, vol: 0.35, nf: 400 }); } }),
  P('b', '古いレール', 4, '止まりかけのレールがガタガタ鳴り、端で「ガン」', (K) => { for (const t of [0.1, 2.3]) { K.grains(t, 1.4, { rate: 50, len: 0.01, f: 700, q: 1.5, vol: 0.35 }); K.tn(t, 1.4, { type: 'sawtooth', f: 120, vol: 0.06, env: 'swell', lpf: 300 }); K.modal(t + 1.5, [[500, 0.3, 1], [1200, 0.2, 0.5]], 0.3); } }),
  P('c', '鍵スイッチを回して作動', 4, '鍵を差して回す→リレー→ドアが動き出す', (K) => { K.grains(0.1, 0.15, { rate: 150, len: 0.002, f: 4000, vol: 0.2 }); knock(K, 0.45, { f: 400, d: 0.03, vol: 0.35, nf: 2500 }); K.modal(0.6, [[2400, 0.03, 1]], 0.2, K.muf(2500)); K.tn(0.9, 1.6, { type: 'sawtooth', f: 160, f2: 220, vol: 0.1, env: 'swell', lpf: 600 }); knock(K, 2.5, { f: 90, vol: 0.35, nf: 400 }); }),
]);
scene('amb_outdoor', '正面玄関・駐車場・屋上', '屋外(敷地・駐車場・外階段)', '敷地 G・駐車場・外階段の踊り場にいる間。森に囲まれた夜。', '新設(P4b で main.js の環境音バスに追加。updatePortal で敷地に出た時)', '—', [
  P('a', '秋の虫', 10, '草むらの虫が途切れ途切れに鳴く。静かな夜', (K) => { cricket(K, 0, 10, 4600, 0.12); cricket(K, 0.3, 9.7, 5200, 0.08); K.bed(10, { color: 'pink', f: 300, vol: 0.05 }); }, 'amb'),
  P('b', '森を抜ける風', 10, '森の木々を風が抜け、葉がざわめく', (K) => { K.bed(10, { color: 'pink', type: 'bandpass', f: 700, q: 0.5, vol: 0.35, lfo: [0.08, 0.9] }); K.grains(0, 10, { rate: 40, len: 0.006, f: 4000, vol: 0.08, p: 0.5 }); }, 'amb'),
  P('c', '遠い道路と犬', 10, '谷の向こうの道路のかすかな音と、遠くで犬が二声', (K) => { K.bed(10, { color: 'brown', f: 250, vol: 0.1 }); K.nz(2, 5, { color: 'pink', type: 'lowpass', f: 500, vol: 0.15, env: 'swell' }); const v = K.verb(2, 0.6); const o = K.split(K.muf(1200), v, 1); for (const t of [7.2, 7.6]) K.voice(t, 0.12, { f0: 400, form: [[900, 4, 1], [1800, 6, 0.5]], drive: 5, vol: 0.25, a: 0.01, rel: 0.06, breath: 0.2, to: o }); }, 'amb'),
]);
scene('pl_step_outdoor', '正面玄関・駐車場・屋上', '足音：屋外(アスファルト・砂利)', '敷地・駐車場・アプローチを歩く。', '新設(P4b で player.js の歩行に接続。敷地 G で切り替え)', '—', [
  P('a', 'アスファルト', 4, '乾いた硬い「ザッ」。夜の屋外に少し響く', (K) => walk(K, 7, 0.55, (t, i, acc) => { knock(K, t, { f: 130, d: 0.05, vol: 0.4 * acc, nf: 2500, nv: 0.4 }); K.nz(t + 0.02, 0.04, { type: 'highpass', f: 2000, vol: 0.15 }); })),
  P('b', '砂利', 4, '砂利を踏む「ジャリ」。隠れて歩けない', (K) => walk(K, 7, 0.6, (t, i, acc) => { K.grains(t, 0.14, { rate: 900, len: 0.002, f: 2500, q: 0.5, vol: 0.5 * acc }); K.tn(t, 0.08, { f: 80, vol: 0.3 }); })),
  P('c', '濡れた路面', 4, '水たまりの残る路面の「ピチャ」', (K) => walk(K, 7, 0.55, (t, i, acc) => { knock(K, t, { f: 110, d: 0.05, vol: 0.35 * acc, nf: 1800 }); K.nz(t, 0.1, { f: 1800, vol: 0.3, env: 'swell' }); K.grains(t + 0.02, 0.1, { rate: 80, len: 0.01, f: 2500, vol: 0.2, tone: 1800 }); })),
]);
scene('pl_step_stairs', '正面玄関・駐車場・屋上', '足音：外階段の縞鋼板', '外階段・北階段(屋外鉄骨)を上り下りする。', '新設(P4b で player.js の歩行に接続。stairs.js の上で切り替え)', '—', [
  P('a', '鉄板の「カン」', 4, '縞鋼板が足音ごとに金属的に鳴る。遠くまで響きそう', (K) => walk(K, 7, 0.5, (t, i, acc) => { knock(K, t, { f: 120, d: 0.05, vol: 0.5 * acc, nf: 2500 }); K.modal(t, [[340, 0.35, 1], [870, 0.3, 0.6], [1520, 0.2, 0.4], [2600, 0.15, 0.2]], 0.25 * acc); })),
  P('b', '鉄骨の鈍い「ゴン」', 4, '重い鉄骨に響く低い音。足元が揺れる', (K) => walk(K, 7, 0.5, (t, i, acc) => { knock(K, t, { f: 80, d: 0.12, vol: 0.6 * acc, nf: 900 }); K.modal(t, [[150, 0.6, 1], [390, 0.5, 0.5], [700, 0.3, 0.3]], 0.3 * acc); })),
  P('c', '砂のジャリ混じり', 4, '錆と砂が載った鉄板の「ジャリ、カン」', (K) => walk(K, 7, 0.5, (t, i, acc) => { knock(K, t, { f: 110, d: 0.05, vol: 0.45 * acc, nf: 2200 }); K.modal(t, [[360, 0.25, 1], [900, 0.2, 0.5]], 0.15 * acc); K.grains(t, 0.1, { rate: 300, len: 0.002, f: 3000, vol: 0.3 }); })),
]);
scene('car_door', '正面玄関・駐車場・屋上', '車のドア', '駐車場の車 3 台を調べる(開かない車・黒い車の中の南京錠の鍵)・最後に乗り込む。', 'story.js useCar(car・rattle)・startEnding(car)', 'car_door_01', [
  P('a', '重い閉まり', 2.5, 'ハンドルを引いて開け、重く「バン」と閉める', (K) => { K.modal(0.1, [[1200, 0.05, 1]], 0.2); latch(K, 0.15, 0.35, 1400); K.nz(0.3, 0.6, { color: 'brown', type: 'lowpass', f: 400, vol: 0.1, env: 'swell' }); knock(K, 1.4, { f: 70, d: 0.2, vol: 0.9, nf: 400 }); K.modal(1.4, [[250, 0.3, 1], [620, 0.2, 0.4]], 0.3); }),
  P('b', '施錠されたハンドル', 2.5, '鍵の掛かったドアのハンドルが空しく「ガチャ、ガチャ」', (K) => { for (const t of [0.2, 0.6]) { knock(K, t, { f: 200, d: 0.04, vol: 0.4, nf: 1500 }); K.modal(t + 0.01, [[2200, 0.05, 1], [3100, 0.03, 0.4]], 0.25); } }),
  P('c', '古い車の軋み', 2.5, '古い車の蝶番が軋み、ガタつきながら閉まる', (K) => { latch(K, 0.1, 0.35, 1400); K.creak(0.4, 0.8, { rate: 40, f: 700, q: 5, vol: 0.35 }); knock(K, 1.6, { f: 75, d: 0.15, vol: 0.8, nf: 600 }); K.grains(1.62, 0.15, { rate: 100, len: 0.004, f: 2000, vol: 0.2 }); }),
]);
scene('room_window', '正面玄関・駐車場・屋上', '窓を開ける・室外機を乗り越える', '410 のバルコニーの窓を開け、室外機に乗って隔て板を越え屋上へ(第 8 段)。', 'rooms.js toggleWindow(slide)・_startVault/_updateVault(climb)', 'room_window_slide_01・room_climb_01', [
  P('a', 'アルミサッシ', 3.6, 'サッシの「ガラガラ」、乗った室外機の天板が「ボン」と鳴る', (K) => { K.nz(0.1, 0.7, { f: 700, q: 3, vol: 0.2, env: 'flat' }); K.grains(0.1, 0.7, { rate: 200, len: 0.003, f: 1500, vol: 0.25 }); knock(K, 0.85, { f: 200, d: 0.04, vol: 0.3, nf: 2500 }); K.nz(2.0, 0.4, { color: 'pink', f: 2000, q: 0.6, vol: 0.2, env: 'swell' }); K.tn(2.2, 0.1, { f: 80, vol: 0.4 }); K.modal(2.6, [[420, 0.4, 1], [980, 0.3, 0.6], [1650, 0.2, 0.3]], 0.4); }),
  P('b', '重い戸車', 3.6, '重い窓の戸車がゴロゴロと転がり、乗り越えは低く鈍い', (K) => { K.nz(0.1, 1.0, { color: 'brown', type: 'lowpass', f: 250, vol: 0.4, env: 'flat' }); K.grains(0.1, 1.0, { rate: 30, len: 0.01, f: 200, vol: 0.3 }); knock(K, 1.2, { f: 90, vol: 0.4, nf: 600 }); K.tn(2.4, 0.12, { f: 70, vol: 0.5 }); K.modal(2.6, [[300, 0.5, 1], [700, 0.4, 0.5]], 0.3); }),
  P('c', '隙間風が吹き込む', 3.6, '窓を開けると外の風が一気に吹き込み、その中で乗り越える', (K) => { K.nz(0.1, 0.5, { f: 700, q: 3, vol: 0.2, env: 'flat' }); K.nz(0.7, 2.8, { color: 'pink', f: 600, q: 0.7, vol: 0.3, env: 'swell', p: 0.7 }); K.tn(2.8, 0.1, { f: 80, vol: 0.4 }); K.modal(2.9, [[420, 0.3, 1], [980, 0.2, 0.5]], 0.25); }),
]);
scene('amb_roof', '正面玄関・駐車場・屋上', '屋上(バルコニー・屋上A)', 'バルコニー(弱)と屋上A(強)にいる間の風。', 'rooms.js updateWind(風のループ)', 'room_wind_loop_01', [
  P('a', '強い風', 10, '吹きさらしの屋上の強い風のうねり', (K) => { K.bed(10, { color: 'pink', f: 500, vol: 0.5, lfo: [0.12, 0.9] }); K.bed(10, { color: 'pink', type: 'bandpass', f: 1500, q: 1, vol: 0.12, lfo: [0.07, 1] }); }, 'amb'),
  P('b', '風に鳴る手すり', 10, '風で手すりがかすかに笛のように鳴り、一度金属がきしむ', (K) => { K.bed(10, { color: 'pink', f: 400, vol: 0.3, lfo: [0.1, 0.7] }); K.tn(2, 3, { f: 620, vol: 0.04, env: 'swell', vib: 4, vibd: 0.005 }); K.tn(6, 3, { f: 650, vol: 0.03, env: 'swell', vib: 4, vibd: 0.005 }); K.modal(4.4, [[400, 0.8, 1], [1100, 0.5, 0.4]], 0.1); }, 'amb'),
  P('c', '風が止む間', 10, '突風が来て止み、不自然な静けさの後また吹く', (K) => { K.nz(0, 3.2, { color: 'pink', type: 'lowpass', f: 500, vol: 0.5, env: 'swell', p: 0.7 }); K.bed(10, { color: 'brown', f: 100, vol: 0.03 }); K.nz(6.8, 3.2, { color: 'pink', type: 'lowpass', f: 500, vol: 0.5, env: 'swell', p: 0.7 }); }, 'amb'),
]);

// ---------------------------------------------------------------- 9. 705 柱の広間(異世界)
scene('amb_x705', '705 柱の広間', '705 の広間', '705 の中。ありえない広さの柱の広間(天窓の外は廊下の常夜灯)。', 'spaces/x705.js sound(st.amb)', 'x705_room_tone_loop_01', [
  P('a', '天窓のうなり', 10, '天窓の灯りの低いうなりが広間を満たす', (K) => { K.bed(10, { color: 'pink', type: 'bandpass', f: 180, q: 1.5, vol: 0.3 }); K.tn(0, 10, { f: 120, vol: 0.05, env: 'flat' }); }, 'amb'),
  P('b', '巨大な空間の残響', 10, '遠くの小さな音がいつまでも響く。広さが耳で分かる', (K) => { K.bed(10, { color: 'brown', f: 120, vol: 0.1 }); const v = K.verb(4, 0.9, 0.6); for (const t of [2.5, 6.1]) knock(K, t, { f: 90, vol: 0.3, nf: 1200, to: K.split(K.gain(0.3, K.out), v, 1) }); }, 'amb'),
  P('c', '空気が抜ける', 10, '柱の間を空気がゆっくり流れ、どこかで木が軋む', (K) => { K.bed(10, { color: 'pink', type: 'bandpass', f: 600, q: 0.4, vol: 0.25, lfo: [0.06, 0.7] }); const v = K.verb(3, 0.7); K.creak(5.5, 0.7, { rate: 30, rate2: 20, f: 400, q: 4, vol: 0.2, to: K.split(K.out, v, 1) }); }, 'amb'),
]);
scene('x705_lights_off', '705 柱の広間', '705 の消灯', '705 で鍵を取ると広間の灯りが一斉に消える(振り向くと出口は反対側、そこから管理人)。', 'spaces/x705.js sfx(lights_off)', 'x705_lights_off_01', [
  P('a', '遮断器の「バチン」', 3, '大きな遮断器が落ちる一撃とうなりの崩れ', (K) => { const v = K.verb(3, 0.7); const o = K.split(K.out, v, 0.8); knock(K, 0.1, { f: 140, d: 0.1, vol: 0.9, nf: 2200, to: o }); K.modal(0.1, [[1100, 0.2, 1], [2300, 0.1, 0.5]], 0.3, o); K.tn(0.1, 0.6, { type: 'sawtooth', f: 120, f2: 40, vol: 0.2, to: o }); }),
  P('b', '次々と消える', 3, '「バチッ、バチッ」と奥から手前へ順に消えていく', (K) => { const v = K.verb(2.5, 0.6); const o = K.split(K.out, v, 0.8); [0.1, 0.35, 0.55, 0.7, 0.82, 0.9].forEach((t, i) => { K.nz(t, 0.05, { f: 2400, q: 2, vol: 0.2 + i * 0.08, to: o }); knock(K, t, { f: 200, d: 0.03, vol: 0.1 + i * 0.05, nf: 3000, to: o }); }); }),
  P('c', '低く落ち込む', 3, '電気が抜けるように低い音が沈んでいく', (K) => { K.tn(0.1, 1.5, { f: 120, f2: 30, vol: 0.4, env: 'swell' }); K.nz(0.1, 1.2, { color: 'brown', type: 'lowpass', f: 300, vol: 0.6 }); }),
]);
scene('door_creak_slow', '705 柱の広間', '扉がひとりでに開く', '705 の南の扉が開く(管理人が現れる直前)・B1 の戻りで扉が少し開く。', 'spaces/x705.js sfx(creak)／spaces/xb1.js sfx(creak)', 'x705_door_creak_01・xb1_door_creak_01', [
  P('a', '長い蝶番の軋み', 3.5, '扉がひとりでに長く軋みながら開く。定番の怖さ', (K) => { const v = K.verb(2, 0.4); K.creak(0.2, 2.8, { rate: 30, rate2: 16, f: 550, f2: 1250, q: 6, vol: 0.5, p: 0.4, to: K.split(K.out, v, 0.6) }); }),
  P('b', '重い扉がゆっくり', 3.5, '重い扉が低く軋み、押し出された空気が流れる', (K) => { K.creak(0.2, 3.0, { rate: 18, rate2: 12, f: 300, f2: 700, q: 6, vol: 0.55, p: 0.5 }); K.nz(0.2, 3.0, { color: 'brown', type: 'lowpass', f: 200, vol: 0.2, env: 'swell' }); }),
  P('c', '軋み→止まる→少しだけ', 3.5, '少し開いて止まり、間を置いてもう少しだけ開く', (K) => { K.creak(0.2, 0.9, { rate: 35, rate2: 25, f: 600, f2: 1300, q: 6, vol: 0.45 }); K.creak(1.8, 0.6, { rate: 45, rate2: 35, f: 700, f2: 1500, q: 6, vol: 0.4 }); K.modal(2.5, [[1600, 0.05, 1]], 0.15); }),
]);

// ---------------------------------------------------------------- 10. 地下 B1(異世界)
scene('amb_b1', '地下 B1', '地下 B1(水音・滴り)', '食堂奥の地下への階段・B1 の白いタイルのトンネル(管理人は地下に来ない。音だけ)。', 'main.js updateDrips(地下階段の滴り)／spaces/xb1.js sound(水の流れ・滴り)', 'xb1_water_loop_01・xb1_drip_01', [
  P('a', '滴りと残響', 10, '天井から落ちる滴りがタイルに響き、少し遅れて返ってくる', (K) => { const v = K.verb(2.5, 0.5); const e = K.echo(0.23, 0.42, 2200, K.out); K.bed(10, { color: 'brown', f: 150, vol: 0.05 }); for (let t = 0.3; t < 9.6; t += 0.6 + K.r() * 2.2) { const f = K.rnd(1300, 2700); K.tn(t, 0.12, { f, f2: f * 0.5, vol: 0.25, to: K.split(K.split(K.out, v, 0.8), e, 0.5) }); } }, 'amb'),
  P('b', '流れる水', 10, '壁の向こうを低く流れる水と、ときどき泡の音', (K) => { K.bed(10, { color: 'brown', f: 380, vol: 0.35, lfo: [0.2, 0.4] }); bubbles(K, 0, 10, 6, 0.1, K.muf(1200)); for (const t of [2.2, 6.8]) K.tn(t, 0.12, { f: 1900, f2: 950, vol: 0.15 }); }, 'amb'),
  P('c', '湿ったうなりと配管', 10, '低く湿ったうなり。どこかで配管が一度「ゴン」と鳴る', (K) => { K.bed(10, { color: 'brown', type: 'bandpass', f: 70, q: 1, vol: 0.4 }); const o = K.muf(600); knock(K, 4.2, { f: 80, vol: 0.5, nf: 500, to: o }); K.modal(4.2, [[300, 0.8, 1], [720, 0.5, 0.4]], 0.2, o); for (const t of [1.5, 7.9]) K.tn(t, 0.12, { f: 1600, f2: 800, vol: 0.12 }); }, 'amb'),
]);
scene('amb_maze', '地下 B1', '迷路(白い仕切り)', 'B1 のトンネルの途中、白い仕切り壁の迷路(視線を外すと配置が変わる)。', '新設(P4b で spaces/xb1.js の迷路の区間に接続)', '—', [
  P('a', '蛍光灯のかすかな唸り', 10, '低い天井の蛍光灯がかすかに唸る白い空間(小さめ)', (K) => { K.bed(10, { color: 'pink', type: 'highpass', f: 4000, vol: 0.02 }); K.tn(0, 10, { type: 'sawtooth', f: 100, vol: 0.05, env: 'flat', lpf: 400 }); K.bed(10, { color: 'brown', f: 100, vol: 0.05 }); }, 'amb'),
  P('b', '仕切りの向こうの紙の音', 10, '静かな中、仕切りの向こうで紙が擦れる。誰かいる?', (K) => { K.bed(10, { color: 'brown', f: 100, vol: 0.05 }); const v = K.verb(1.2, 0.4); const o = K.split(K.muf(2000), v, 0.6); paper(K, 3.2, 0.5, 0.3, 1, o); paper(K, 7.7, 0.4, 0.25, 1, o); }, 'amb'),
  P('c', '無音と一打', 10, 'ほぼ無音。一度だけ、仕切りの向こうで何かが動いた音', (K) => { K.bed(10, { color: 'brown', f: 60, vol: 0.05 }); const o = K.muf(1200); knock(K, 6.0, { f: 120, vol: 0.3, nf: 1200, to: o }); K.nz(6.05, 0.3, { f: 1200, q: 1, vol: 0.1, env: 'swell', to: o }); }, 'amb'),
]);
scene('xb1_loop_notice', '地下 B1', 'B1 の標識灯(ループに気づく)', 'B1 のトンネルで同じ標識灯を 3 回通って気づく瞬間。', 'spaces/xb1.js sfx(notice)', 'xb1_loop_notice_01', [
  P('a', '低いうなりが立ち上がる', 3, '足元から低いうなりがゆっくり立ち上がる', (K) => { K.tn(0.1, 2.4, { type: 'sawtooth', f: 55, f2: 52, vol: 0.3, env: 'swell', lpf: 300 }); K.tn(0.4, 2.0, { f: 82, vol: 0.1, env: 'swell' }); }),
  P('b', '標識灯の「ジジッ」', 3, '標識灯が一瞬またたいて放電音を立てる', (K) => { const v = K.verb(1.5, 0.5); const o = K.split(K.out, v, 0.6); K.grains(0.1, 0.6, { rate: 30, len: 0.01, f: 2000, q: 1, vol: 0.4, to: o }); K.tn(0.1, 0.6, { type: 'sawtooth', f: 100, vol: 0.06, env: 'flat', lpf: 1500, to: o }); }),
  P('c', '耳鳴りと金属の一打', 3, '遠くで鉄が一度鳴り、耳鳴りが残る', (K) => { K.modal(0.1, [[523, 2, 1], [1260, 1.4, 0.4], [2040, 1, 0.2]], 0.3, K.muf(3000), 0.1); K.tn(0.2, 2.5, { f: 7000, vol: 0.02, env: 'swell' }); }),
]);
scene('space_release', '地下 B1', '異世界を抜ける・鍵を取った瞬間', 'B1 のループを抜ける・車のキーを取った時の低い音(705 の鍵・312 の鍵を取った瞬間にも使える)。', 'spaces/xb1.js sfx(release・key_drone)', 'xb1_release_01・xb1_key_drone_01', [
  P('a', '空気が抜ける', 3, '詰まっていた空気が一気に抜けるような低い音', (K) => { K.nz(0.1, 1.2, { color: 'brown', type: 'lowpass', f: 300, f2: 80, vol: 0.6, env: 'swell' }); K.tn(0.2, 1.4, { type: 'triangle', f: 140, f2: 70, vol: 0.12, env: 'swell' }); }),
  P('b', '低い沈み込み', 3, '低い音がずっと沈み続ける。取ってはいけない物を取った', (K) => { K.tn(0, 3, { type: 'sawtooth', f: 46, f2: 44, vol: 0.35, env: 'swell', p: 0.5, lpf: 200 }); K.tn(0, 3, { f: 92, vol: 0.1, env: 'swell', p: 0.5 }); }),
  P('c', '圧が戻る(耳抜け)', 3, '耳が「ポン」と抜けて、周りの音が戻ってくる', (K) => { K.nz(0.1, 0.2, { color: 'pink', type: 'lowpass', f: 2000, vol: 0.4 }); K.tn(0.1, 0.8, { f: 40, f2: 60, vol: 0.4, env: 'swell' }); K.modal(0.15, [[1500, 0.03, 1]], 0.2); K.bed(2.5, { color: 'pink', f: 1200, vol: 0.08, t: 0.4 }); }),
]);

// ---------------------------------------------------------------- 11. 脱走・エンディング
scene('car_engine', '脱走・エンディング', '車のエンジン', '最後に黒い車に乗り込み、車のキーでエンジンを掛ける。', 'story.js _engine(start)', 'car_engine_start_01・car_engine_loop_01', [
  P('a', '掛かりの悪いセル→始動', 6, 'セルが 2 度空回りし、3 度目で掛かる。焦り', (K) => { for (const [s, d] of [[0.2, 1.1], [1.8, 1.0]]) { engine(K, s, d, (u) => 200 + 40 * Math.sin(u * 20), { cyl: 2, f: 600, vol: 0.45 }); K.tn(s, d, { type: 'sawtooth', f: 300, vol: 0.04, env: 'swell', lpf: 1200 }); } engine(K, 3.2, 2.8, (u) => 850 + 900 * Math.exp(-u * 6), { cyl: 4, f: 400, vol: 0.6 }); }),
  P('b', '低いアイドリング', 6, '短いセルの後、低く落ち着いたアイドリング', (K) => { engine(K, 0.3, 0.6, () => 220, { cyl: 2, f: 600, vol: 0.4 }); engine(K, 0.9, 5, (u) => 750 + 50 * Math.sin(u * 6), { cyl: 4, f: 250, vol: 0.6 }); }),
  P('c', '荒いディーゼル', 6, 'ガラガラと荒く大きなエンジン。目立つ', (K) => { engine(K, 0.3, 0.6, () => 220, { cyl: 2, f: 600, vol: 0.4 }); engine(K, 0.9, 5, () => 800, { cyl: 4, rough: 0.4, f: 500, vol: 0.6 }); K.grains(0.9, 5, { rate: 50, len: 0.002, f: 2500, vol: 0.2 }); }),
]);
scene('ending_gate', '脱走・エンディング', '門を抜けるエンディング', '車で駐車場から門を抜ける(車内視点のカット)→エンディング画面。音楽なし。', 'story.js _updateEnding(_engine drive・stop)', '—(_engine の drive を流用)', [
  P('a', '砂利を走って門を抜ける', 8, '加速するエンジンと砂利の音、門の金属を越える揺れ、遠ざかって消える', (K) => { const g = K.shape(0, 8, 1, (u) => (u < 0.7 ? 1 : (1 - u) / 0.3), K.out); engine(K, 0, 8, (u) => 1200 + 600 * u, { cyl: 4, f: 300, vol: 0.4, to: g }); K.grains(0, 8, { rate: 600, len: 0.002, f: 2000, vol: 0.2, p: 0.3, to: g }); K.modal(4.5, [[300, 1.0, 1], [760, 0.8, 0.6], [1400, 0.5, 0.3]], 0.3, K.muf(1500)); knock(K, 4.5, { f: 60, vol: 0.5, nf: 400 }); }),
  P('b', '静かに遠ざかる', 8, '門がゆっくり軋んで開き、車がその中を静かに去る', (K) => { K.creak(0.3, 1.8, { rate: 25, rate2: 18, f: 500, f2: 1100, q: 6, vol: 0.4 }); const g = K.shape(1.5, 6.5, 1, (u) => Math.pow(1 - u, 1.5), K.out); engine(K, 1.5, 6.5, () => 1500, { cyl: 4, f: 350, vol: 0.5, to: g }); K.bed(8, { color: 'pink', f: 400, vol: 0.06 }); }),
  P('c', '門を抜けると静寂', 8, '走る音がふっと消え、あとは虫の声だけ', (K) => { const g = K.shape(0, 4.5, 1, (u) => (u < 0.9 ? 1 : (1 - u) / 0.1), K.out); engine(K, 0, 4.5, (u) => 1300 + 400 * u, { cyl: 4, f: 300, vol: 0.45, to: g }); K.grains(0, 4.5, { rate: 400, len: 0.002, f: 2000, vol: 0.15, to: g }); cricket(K, 4.6, 3.4, 4600, 0.1); }),
]);

// P4a-2: 候補を作り直した場面(ユーザーが「作り直し」を選んだもの)。試聴盤は pick が redo のままなら「作り直し済み・再選択」と出す
export const REDONE = { pl_step_corridor: 'P4a-2 作り直し(硬い床のコツコツ)', room_fall: 'P4a-2 作り直し(パリーンと割れる)' };
for (const sc of S) if (REDONE[sc.id]) sc.redone = REDONE[sc.id];

// ================================================================ 書き出し
for (const sc of S) for (const c of sc.cands) {
  const seed = hash(sc.id + ':' + c.id), fn = c.fn;
  c.scene = sc.id;
  c.render = (ctx, dest, t0 = 0) => fn(new Kit(ctx, dest, t0, seed));
}
export const SCENES = S;
export const GROUPS = [...new Set(S.map((s) => s.group))];

// OfflineAudioContext で 1 候補を描いて正規化する(48kHz モノラル。末尾 0.3 秒の余白込み)
export async function renderCandidate(cand, sr = SR) {
  const n = Math.ceil((cand.dur + 0.3) * sr);
  const oc = new OfflineAudioContext(1, n, sr);
  cand.render(oc, oc.destination, 0);
  const buf = await oc.startRendering();
  const d = buf.getChannelData(0);
  let peak = 0, sum = 0;
  for (let i = 0; i < d.length; i++) { const v = d[i]; if (!Number.isFinite(v)) throw new Error(cand.scene + '/' + cand.id + ': NaN'); const a = Math.abs(v); if (a > peak) peak = a; sum += v * v; }
  const rms = Math.sqrt(sum / d.length);
  const N = NORM[cand.kind] || NORM.sfx;
  if (peak < 1e-6) throw new Error(cand.scene + '/' + cand.id + ': silent');
  const g = Math.min(db(N.peakDb) / peak, db(N.rmsDb) / Math.max(rms, 1e-9));
  for (let i = 0; i < d.length; i++) d[i] *= g;
  buf.stats = { peakIn: peak, rmsIn: rms, gain: g, peakDb: 20 * Math.log10(peak * g), rmsDb: 20 * Math.log10(rms * g) };
  return buf;
}

// AudioBuffer → 16bit PCM の WAV(ArrayBuffer)
export function encodeWav(buf) {
  const ch = buf.numberOfChannels, sr = buf.sampleRate, n = buf.length, bytes = n * ch * 2;
  const ab = new ArrayBuffer(44 + bytes), v = new DataView(ab);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, bytes, true);
  const data = [...Array(ch)].map((_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const s = Math.max(-1, Math.min(1, data[c][i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
  return ab;
}
