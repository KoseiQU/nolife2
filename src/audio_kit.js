// audio_kit.js — 音の合成の道具箱 Kit と声の素材(仮声 TTS)の読み込み(P4b で samples/sound_lib.js から移した)。
//  - 試聴盤(samples/sound_lib.js)と書き出し(tools/build_audio.html)とゲーム(src/audio_bank.js の声の加工)が同じ物を使う。
//  - Kit は生の AudioContext にも OfflineAudioContext にも組める(t0 = 描き始めの時刻)。
//  - 声の素材は assets/audio/tts/<ID>.wav(台詞と ID は docs/lines.md)。ユーザーの録音を同じ名前で置けば差し替わる。

export function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// ================================================================ 声の素材(P4a-3)
// 管理人の仮声は macOS の say(日本語音声)で読み上げた wav(assets/audio/tts/<ID>.wav。台詞と ID は docs/lines.md)を素材にし、
// Kit.vox でピッチ・フィルタ・歪み・残響を掛けて鳴らす。ユーザーの録音が来たら同じ名前の wav を差し替えるだけで全候補に効く。
// render は同期なので、声を使う候補(cand.tts に ID の列)は先に loadTTS で読み込む(renderCandidate と prepare がやる)。
export const TTS = new Map();
const TTS_DIR = new URL('../assets/audio/tts/', import.meta.url);
let ttsDecoder = null;
const TTS_SR = 48000;
export async function loadTTS(names = []) {
  for (const nm of names) {
    if (TTS.has(nm)) continue;
    const r = await fetch(new URL(nm + '.wav', TTS_DIR), { cache: 'no-store' });
    if (!r.ok) throw new Error('tts ' + nm + ': HTTP ' + r.status);
    const ab = await r.arrayBuffer();
    if (!ttsDecoder) ttsDecoder = new OfflineAudioContext(1, 1, TTS_SR);
    TTS.set(nm, await ttsDecoder.decodeAudioData(ab));
  }
}
export const prepare = (cand) => loadTTS(cand.tts || []);
const TTS_REV = new Map();
export function ttsBuf(ctx, nm, rev) {
  const b = TTS.get(nm);
  if (!b) throw new Error('tts not loaded: ' + nm + '(先に loadTTS / prepare)');
  if (!rev) return b;
  if (!TTS_REV.has(nm)) { const r = ctx.createBuffer(1, b.length, b.sampleRate), s = b.getChannelData(0), d = r.getChannelData(0); for (let i = 0; i < s.length; i++) d[i] = s[s.length - 1 - i]; TTS_REV.set(nm, r); }
  return TTS_REV.get(nm);
}

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
  // 歪み(飽和)の入口を返す。drive = 歪みの強さ(1 でほぼ素通り、8 で強く割れる)。後ろに lowpass を挟んで耳障りな高域を落とす
  sat(drive = 3, to = this.out, lp = 6000) {
    const ws = this.c.createWaveShaper(), cv = new Float32Array(2048), k = Math.tanh(drive);
    for (let i = 0; i < 2048; i++) { const x = (i / 2047) * 2 - 1; cv[i] = Math.tanh(x * drive) / k; }
    ws.curve = cv; ws.oversample = '2x'; ws.connect(this.filt('lowpass', lp, 0.7, to));
    return ws;
  }
  // 声の素材を鳴らす(P4a-3)。name = assets/audio/tts の ID。
  //  rate = 再生速度(=音程と速さ。0.6〜0.8 で低く遅い男声、1.2 以上で上ずった叫び)、rev = 逆再生(意味の取れない呟き)
  //  from/len = 素材の切り出し(素材の秒)。loop = [s0, s1] 素材のその区間を繰り返して hold 秒まで伸ばす(叫びの母音を伸ばす)
  //  cents(u) = 音程の曲線(セント、u=0..1)、jit = 音程の揺らぎ(セント。合成音声の平らさを崩す)、vib/vibd = ビブラート(Hz/セント)
  //  hp/lp = フィルタ、drive = 歪み(0 で無し)、rasp = 声でノイズを変調した「ざらつき・かすれ」の量(raspF/raspQ = その帯域)、dry = 声そのものの量(P4b)、a/rel = 頭と尻のフェード
  vox(t, name, o = {}) {
    const { rate = 0.75, rev = false, from = 0, len, loop, hold = 0, vol = 0.8, to = this.out, cents, jit = 0, jitHz = 7, vib = 0, vibd = 0, hp = 90, lp = 0, drive = 0, rasp = 0, raspF = 2600, raspQ = 0.6, dry = 1, a = 0.012, rel = 0.12 } = o;
    const buf = ttsBuf(this.c, name, rev);
    const srcLen = Math.min(len ?? Infinity, buf.duration - from), dur = loop ? hold : srcLen / rate;
    // P4e-1: 検査用の記録(this.trace が配列の時だけ。AudioBank が読み込み時の音量合わせで使い、?test=audio が録音プロファイルの数値を確かめる)
    if (this.trace) this.trace.push({ name, rate, len: len ?? null, srcLen: +srcLen.toFixed(3), bufDur: +buf.duration.toFixed(3), dur: +dur.toFixed(3), loop: loop || null, rasp, jit, drive, lp, hp, dry });
    const s = this.c.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
    if (loop) { s.loop = true; s.loopStart = loop[0]; s.loopEnd = loop[1]; }
    if (cents || jit || vib) {
      const n = Math.max(32, Math.ceil(dur * 200)), arr = new Float32Array(n), K = Math.ceil(dur * jitHz) + 3, tg = [];
      for (let k = 0; k < K; k++) tg.push((this.r() * 2 - 1) * jit);
      const vph = this.r() * 6.28;
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1), x = u * dur * jitHz, k = Math.floor(x), f = x - k, sm = f * f * (3 - 2 * f);
        arr[i] = (cents ? cents(u) : 0) + tg[k] + (tg[k + 1] - tg[k]) * sm + (vib ? vibd * Math.sin(vph + 2 * Math.PI * vib * u * dur) : 0);
      }
      s.detune.setValueAtTime(arr[0], this.T(t)); s.detune.setValueCurveAtTime(arr, this.T(t) + 1e-4, dur);
    }
    const env = this.shape(t, dur, vol, (u) => Math.min(1, (u * dur) / a, ((1 - u) * dur) / rel), to);
    let node = this.filt('highpass', hp, 0.7);
    s.connect(node);
    if (lp) { const l = this.filt('lowpass', lp, 0.7); node.connect(l); node = l; }
    // P4b: dry = 声そのものの量(0 に近いほど rasp のかすれ=囁きだけになる)
    const dg = this.gain(dry); node.connect(dg);
    if (drive) { const pre = this.gain(1.6); dg.connect(pre); const post = this.gain(0.7, env); pre.connect(this.sat(drive, post, lp || 7000)); } else dg.connect(env);
    if (rasp) {
      const nsrc = this.c.createBufferSource(); nsrc.buffer = this.noiseBuf('white'); nsrc.loop = true;
      const vca = this.gain(0); nsrc.connect(vca); node.connect(this.gain(rasp * 3, vca.gain));
      vca.connect(this.filt('bandpass', raspF, raspQ, env));
      nsrc.start(this.T(t), this.rnd(0, 2.5)); nsrc.stop(this.T(t + dur + 0.05));
    }
    if (loop) s.start(this.T(t), from); else s.start(this.T(t), from, srcLen);
    s.stop(this.T(t + dur + 0.05));
    return dur;
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
