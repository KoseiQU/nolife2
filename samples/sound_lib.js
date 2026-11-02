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
//  - P4a-3: 管理人の声の候補(cand.tts あり)は assets/audio/tts/*.wav(macOS say の仮声。docs/lines.md)を素材にする。
//    renderCandidate は自分で読み込む。生の AudioContext に直接 render する時は先に await prepare(cand)。kind 'loud' は +3dB の正規化。

export const SR = 48000;
export const NORM = {
  sfx: { peakDb: -6, rmsDb: -18 },
  amb: { peakDb: -6, rmsDb: -26 },
  quiet: { peakDb: -20, rmsDb: -36 },
  loud: { peakDb: -3, rmsDb: -15 },    // P4a-3: 怖さの要求で他より +3dB(走り・扉の破壊・一撃・ロッカーの飛び出し)
};
const db = (d) => Math.pow(10, d / 20);

import { Kit, rng, hash, loadTTS, prepare, ttsBuf } from '../src/audio_kit.js';
import { VOICE } from '../src/audio_voice.js';   // P4b: ゲームと共有する声の場面の加工   // P4b: Kit と声の素材の読み込みは src/audio_kit.js へ移した(ゲームの声の加工と共有)
export { Kit, loadTTS, prepare };

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

// ---------------------------------------------------------------- P4a-3 の道具(物理の層を増やす)
// 硬い靴底の一歩: 踵の角(広帯域の短いクリック)＋踵と床の硬い鳴り(不調和な固有振動)＋踵の胴(短い低音)＋床の鳴り(床スラブの共鳴)
//  ＋爪先(遅れて小さく)＋たまに擦り。毎歩、音程・強さ・踵→爪先の間をゆらす
function hardStep(K, t, o = {}) {
  const { vol = 0.6, click = 3500, ring = [1700, 2900, 4300], body = 180, floor = 95, toe = 0.09, scuff = 0.2, bright = 1, to = K.out } = o;
  const j = () => K.rnd(0.94, 1.06), v = vol * K.rnd(0.85, 1.1);
  K.nz(t, 0.005, { type: 'highpass', f: click * j(), vol: v * 0.9 * bright, to });
  K.nz(t, 0.02, { f: click * 0.55 * j(), q: 1.4, vol: v * 0.45, to });
  K.modal(t, ring.map((f, i) => [f * j(), K.rnd(0.018, 0.04) / (1 + i * 0.35), [1, 0.6, 0.35, 0.22][i] ?? 0.2]), v * 0.33, to, 0);
  K.tn(t, 0.045, { f: body * 1.5 * j(), f2: body, vol: v * 0.5, to });
  K.tn(t + 0.002, 0.11, { f: floor * j(), vol: v * 0.2, to });
  if (toe) {
    const tt = t + toe * K.rnd(0.85, 1.2), tv = v * K.rnd(0.2, 0.35);
    K.nz(tt, 0.006, { f: click * 0.8, q: 1.2, vol: tv * bright, to }); K.tn(tt, 0.03, { f: body * 1.3, f2: body, vol: tv * 0.6, to });
  }
  if (K.r() < scuff) K.nz(t + 0.03, K.rnd(0.05, 0.1), { f: 2600, q: 0.7, vol: v * 0.07, env: 'swell', to });
}
// 大柄な人の重い一歩(管理人): 低い踵の踏み込み＋床スラブの鈍い鳴り＋体重の沈み(こもった低音)＋靴底の角
function heavyStep(K, t, o = {}) {
  const { vol = 0.8, click = 2400, body = 95, floor = 58, ring = [900, 1600, 2600], roll = 0.13, scuff = 0.3, to = K.out } = o;
  const j = () => K.rnd(0.93, 1.07), v = vol * K.rnd(0.85, 1.1);
  K.nz(t, 0.007, { type: 'highpass', f: click * j(), vol: v * 0.55, to });
  K.nz(t, 0.03, { f: click * 0.45 * j(), q: 1.1, vol: v * 0.4, to });
  K.modal(t, ring.map((f, i) => [f * j(), K.rnd(0.025, 0.05) / (1 + i * 0.4), [1, 0.5, 0.25][i] ?? 0.2]), v * 0.22, to, 0);
  K.tn(t, 0.09, { f: body * 1.7 * j(), f2: body, vol: v * 0.7, to });
  K.tn(t + 0.003, 0.22, { f: floor * j(), f2: floor * 0.85, vol: v * 0.38, to });
  K.nz(t, 0.12, { color: 'brown', type: 'lowpass', f: 260, vol: v * 0.5, to });
  const tt = t + roll * K.rnd(0.85, 1.25);
  K.tn(tt, 0.06, { f: body * 1.4, f2: body, vol: v * 0.3, to }); K.nz(tt, 0.012, { f: click * 0.6, q: 1, vol: v * 0.18, to });
  if (K.r() < scuff) K.nz(t + 0.05, K.rnd(0.08, 0.16), { f: 1800, q: 0.7, vol: v * 0.08, env: 'swell', to });
}
// 爆発のような衝撃: 沈み込む低音(sub)＋低域のノイズの塊(圧)＋前の破裂(広帯域)。sat を通して太く割る
function boom(K, t, o = {}) {
  const { vol = 1, f = 70, f2 = 26, d = 1.0, crack = 0.8, to = K.out } = o;
  K.tn(t, d, { f, f2, vol, a: 0.002, to });
  K.tn(t, d * 0.5, { f: f * 1.9, f2: f2 * 1.6, vol: vol * 0.5, a: 0.002, to });
  K.nz(t, d * 0.9, { color: 'brown', type: 'lowpass', f: 500, f2: 90, vol: vol * 0.9, a: 0.001, to });
  K.nz(t, 0.06, { type: 'highpass', f: 700, vol: vol * crack, a: 0.0005, to });
  K.nz(t, 0.25, { color: 'pink', type: 'bandpass', f: 1200, f2: 400, q: 0.6, vol: vol * crack * 0.5, to });
}
// 木が裂ける・砕ける: 細かい破断の粒(高め)＋繊維が裂ける速い軋み＋木片の鳴り
function splinter(K, t, dur, o = {}) {
  const { vol = 0.6, f = 1800, to = K.out } = o;
  K.grains(t, dur, { rate: 260, len: 0.004, f, q: 0.7, vol, p: 0.4, to });
  K.creak(t, dur * 0.8, { rate: 260, rate2: 90, jit: 0.6, f: f * 0.45, f2: f * 1.1, q: 3, vol: vol * 0.5, p: 0.3, to });
  for (let i = 0; i < 8; i++) { const tt = t + Math.pow(K.r(), 1.5) * dur, ff = K.rnd(500, 1600); K.modal(tt, [[ff, K.rnd(0.03, 0.08), 1], [ff * 2.3, 0.03, 0.4]], vol * K.rnd(0.2, 0.5), to, 0.5); }
}
// 鋼板の扉・ロッカーの鳴り(低い固有振動の束＋打撃)
function steelPanel(K, t, o = {}) {
  const { vol = 0.5, base = 175, d = 0.9, to = K.out } = o;
  K.modal(t, [[base, d, 1], [base * 2.37, d * 0.8, 0.75], [base * 4.1, d * 0.6, 0.55], [base * 7.3, d * 0.4, 0.35], [base * 11.6, d * 0.25, 0.2]], vol, to, 0.8);
  K.tn(t, 0.12, { f: base * 0.6, f2: base * 0.4, vol: vol * 0.8, to });
}
// 金属蝶番の「キイィ」: スティックスリップの周期で鳴る音程のある軋み。音程の揺らぎ・粘りの強弱・擦れのざらつき
function squeal(K, t, dur, o = {}) {
  const { f = 1150, fc = () => 1, amp = (u) => Math.pow(Math.sin(Math.PI * u), 0.4), jit = 0.015, harm = 6, grit = 0.35, vol = 0.4, to = K.out } = o;
  const b = K.buf(dur, (d, sr, n) => {
    let ph = 0, w = 0, tg = 0, wt = 0, pa = 1, pv = 1, at = 0;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      if (i >= wt) { tg = (K.r() * 2 - 1) * jit; wt = i + sr * K.rnd(0.01, 0.05); }
      w += (tg - w) * 0.0015;
      if (i >= at) { pa = K.rnd(0.35, 1); at = i + sr * K.rnd(0.006, 0.04); }
      pv += (pa - pv) * 0.004;
      ph += (f * fc(u) * (1 + w)) / sr; ph -= Math.floor(ph);
      let s = 0; for (let h = 1; h <= harm; h++) s += Math.sin(2 * Math.PI * ph * h) / Math.pow(h, 1.15);
      d[i] = amp(u) * pv * (s * 0.6 + grit * (K.r() * 2 - 1) * (ph < 0.12 ? 1 : 0.15));
    }
  });
  const hp = K.filt('highpass', 500, 0.7), pk = K.filt('peaking', f * 2.1, 3, null, 5); hp.connect(pk); pk.connect(K.gain(vol, to));
  K.play(b, t, hp);
}
// 車が門を抜ける時のタイヤの転がり(舗装・砂利なし): 低く滑らかなノイズのうなり
function tireRoll(K, t, dur, o = {}) {
  const { vol = 0.3, f = 300, env = (u) => 1, to = K.out } = o;
  const g = K.shape(t, dur, vol, env, to);
  const s = K.c.createBufferSource(); s.buffer = K.noiseBuf('brown'); s.loop = true;
  const l = K.filt('lowpass', f, 0.8), p = K.filt('peaking', f * 0.4, 2, null, 6); s.connect(l); l.connect(p); p.connect(g);
  s.start(K.T(t), K.rnd(0, 2.5)); s.stop(K.T(t + dur + 0.05));
}

// ================================================================ 場面と候補
const S = [];
function scene(id, group, title, when, callers, temp, cands) { S.push({ id, group, title, when, callers, temp, cands }); }
function P(id, name, dur, desc, fn, kind = 'sfx') { return { id, name, dur, desc, fn, kind }; }
// 声の素材を使う候補(P4a-3)。tts = 使う assets/audio/tts の ID の列(描く前に読み込む)
function PV(id, name, dur, desc, tts, fn, kind = 'sfx') { return { id, name, dur, desc, fn, kind, tts }; }

// ---------------------------------------------------------------- P4b の道具(3 周目・調整)
// 金属の鳴りを持たない重い一歩(ゴム・革の靴底)。踵の鈍い「ドッ」＋床の沈み＋靴底の擦れ。音程のある成分は低い胴だけ(3 周目 enemy_step_walk「金属音感をなくして」)
function softStep(K, t, o = {}) {
  const { vol = 0.8, body = 90, floor = 55, heel = 700, scuff = 0.35, drag = 0, creak = 0, to = K.out } = o;
  const j = () => K.rnd(0.92, 1.08), v = vol * K.rnd(0.85, 1.1);
  K.nz(t, 0.025, { color: 'pink', type: 'lowpass', f: heel * j(), vol: v * 0.9, a: 0.001, to });       // 踵が床を叩く鈍い面
  K.nz(t, 0.012, { color: 'pink', type: 'bandpass', f: 1300 * j(), q: 0.7, vol: v * 0.2, to });         // 靴底の縁(乾いた成分を少しだけ)
  K.tn(t, 0.08, { f: body * 1.6 * j(), f2: body, vol: v * 0.65, to });
  K.tn(t + 0.004, 0.2, { f: floor * j(), f2: floor * 0.85, vol: v * 0.32, to });
  K.nz(t, 0.14, { color: 'brown', type: 'lowpass', f: 240, vol: v * 0.55, to });                        // 体重の沈み
  const tt = t + 0.12 * K.rnd(0.85, 1.25);                                                            // 爪先(柔らかく)
  K.nz(tt, 0.02, { color: 'pink', type: 'lowpass', f: heel * 1.3, vol: v * 0.3, to }); K.tn(tt, 0.05, { f: body * 1.3, f2: body, vol: v * 0.25, to });
  if (K.r() < scuff) K.nz(t + 0.04, K.rnd(0.07, 0.14), { color: 'pink', f: 1100, q: 0.6, vol: v * 0.1, env: 'swell', to });
  if (drag) K.nz(t + 0.1, drag, { color: 'pink', f: 750, f2: 500, q: 0.7, vol: v * 0.16, env: 'swell', p: 0.8, to });
  if (creak && K.r() < creak) K.creak(t + 0.03, 0.12, { rate: 140, rate2: 90, f: 520, q: 3, vol: v * 0.08, to });   // 革のきしみ(ごく小さく)
}
// 追跡の一歩(採用 enemy_step_run C の調整「もっと大きい音でドタバタ」): 重い踏み込み＋床を踏み鳴らす低音＋ときどき二度踏み＋周りの物のカタつき
function runStomp(K, t, v = 1, to = K.out, dbl = null) {
  heavyStep(K, t, { vol: 1.15 * v, body: 80, floor: 48, roll: 0.05, scuff: 0.5, to });
  K.tn(t, 0.32, { f: 48, f2: 34, vol: 0.6 * v, to });                                                  // 床を踏み鳴らす「ドン」
  K.nz(t, 0.16, { color: 'brown', type: 'lowpass', f: 320, vol: 0.7 * v, a: 0.001, to });
  if (dbl ?? K.r() < 0.3) heavyStep(K, t + K.rnd(0.06, 0.09), { vol: 0.55 * v, body: 88, floor: 54, roll: 0.04, to });   // つまずくような二度踏み
  if (K.r() < 0.5) for (let k = 0; k < 3; k++) K.modal(t + 0.02 + k * K.rnd(0.02, 0.035), [[K.rnd(1400, 3000), 0.03, 1]], 0.05 * v, to, 0.2);   // 周りの物がカタつく
}
// 小さなスイッチの「カチッ」(押し込みの「カ」と戻りの「チッ」)
function click(K, t, v = 0.5, o = {}) {
  const { f = 3000, body = 300, ring = 0, gap = 0.022, to = K.out } = o;
  K.nz(t, 0.003, { type: 'highpass', f: f * 1.2, vol: v, a: 0.0003, to });
  K.modal(t, [[f, 0.012, 1], [f * 1.63, 0.008, 0.5]], v * 0.3, to, 0);
  K.tn(t, 0.02, { f: body * 1.3, f2: body, vol: v * 0.25, to });
  K.nz(t + gap, 0.0025, { type: 'highpass', f: f * 1.5, vol: v * 0.6, a: 0.0003, to });
  K.modal(t + gap, [[f * 1.25, 0.01, 1]], v * 0.2, to, 0);
  if (ring) K.modal(t + gap, [[ring, 0.05, 1], [ring * 1.5, 0.03, 0.5]], v * 0.08, to, 0);
}
// 木の扉の胴を叩く(体当たり・揺さぶり)。音程のある成分は扉板の低い鳴りだけで、毎回ゆらす(機械的な繰り返しにしない)
function doorHit(K, t, v = 0.6, to = K.out) {
  knock(K, t, { f: K.rnd(85, 115), d: 0.13, vol: v, nf: 800, nq: 0.8, nd: 0.025, nv: v * 0.35, to });
  K.modal(t, [[K.rnd(165, 195), 0.16, 1], [K.rnd(320, 360), 0.1, 0.55], [K.rnd(600, 680), 0.06, 0.3]], v * 0.4, to, 0.2);
  K.nz(t, 0.09, { color: 'brown', type: 'lowpass', f: 380, vol: v * 0.6, to });
  if (K.r() < 0.6) K.modal(t + K.rnd(0.005, 0.02), [[K.rnd(1500, 2400), 0.03, 1], [K.rnd(3000, 3800), 0.02, 0.4]], v * 0.08, to, 0.3);   // 掛け金がかすかに鳴る
}
// ノブ・掛け金のガチャつき(手で揺する)
function knobRattle(K, t, dur, v = 0.3, to = K.out) {
  K.grains(t, dur, { rate: 110, len: 0.003, f: 2100, q: 1.1, vol: v, to });
  for (let i = 0; i < Math.ceil(dur * 12); i++) K.modal(t + K.rnd(0, dur), [[K.rnd(1600, 2600), 0.025, 1], [K.rnd(3000, 4000), 0.015, 0.4]], v * K.rnd(0.2, 0.5), to, 0.3);
}
// 息を吸う/吐く(声の前後に置いて、生きている人の気配を足す)
function inhale(K, t, dur, vol = 0.4, to = K.out, f = 1500) { K.nz(t, dur, { color: 'pink', f, f2: f * 1.6, q: 0.9, vol, env: 'swell', p: 0.7, to }); K.nz(t, dur, { type: 'highpass', f: 4000, vol: vol * 0.2, env: 'swell', p: 1, to }); }
function exhale(K, t, dur, vol = 0.3, to = K.out, f = 900) { K.nz(t, dur, { color: 'pink', f, f2: f * 0.65, q: 0.8, vol, env: 'swell', p: 0.5, to }); }
// 同じ声を数本わずかにずらして重ねる(合成音声の平らさ・機械っぽさを崩す)。list = [[遅れ秒, 速さ, セント, 音量], ...]
function voxStack(K, t, name, list, o = {}) {
  const c0 = o.cents || (() => 0);
  for (const [d, r, c, g] of list) K.vox(t + d, name, { ...o, rate: r, cents: (u) => c0(u) + c, vol: (o.vol ?? 0.8) * g });
}
// 滑らかなエンジン(点火の粒やノイズを持たない倍音の和。ending_gate C の調整「ジャリジャリ感をなくして」)
function smoothEngine(K, t, dur, rpm, o = {}) {
  const { cyl = 4, f = 240, vol = 0.5, wob = 0.04, to = K.out } = o;
  const b = K.buf(dur, (d, sr, n) => {
    let ph = 0, ph2 = 0;
    for (let i = 0; i < n; i++) {
      const u = i / n, fire = (rpm(u) / 60) * (cyl / 2);
      ph += fire / sr; ph -= Math.floor(ph); ph2 += fire / 2 / sr; ph2 -= Math.floor(ph2);
      let s = 0; for (let h = 1; h <= 6; h++) s += Math.sin(2 * Math.PI * ph * h + h * 0.7) / Math.pow(h, 1.4);
      const am = 1 + wob * Math.sin(2 * Math.PI * u * dur * 3.1) + 0.5 * wob * Math.sin(2 * Math.PI * u * dur * 7.3);
      d[i] = (s * 0.5 + 0.4 * Math.sin(2 * Math.PI * ph2)) * am;
    }
  });
  K.play(b, t, K.filt('lowpass', f, 0.7, K.gain(vol, to)));
}

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
  P('a', '小さなスイッチの「カチッ」', 1.6, '樹脂の小さなスイッチ。押し込みの「カ」と戻りの「チッ」が短く続く、軽く乾いた「カチッ」', (K) => {
    for (const [t, v] of [[0.2, 0.7], [1.0, 0.6]]) click(K, t, v, { f: 3400, body: 380, gap: 0.02 });
  }),
  P('b', '金属の「カチッ」', 1.6, '金属の胴のライト。硬く澄んだ「カチッ」で、胴がほんのわずかに鳴る', (K) => {
    for (const [t, v] of [[0.2, 0.7], [1.0, 0.6]]) click(K, t, v, { f: 4200, body: 520, gap: 0.016, ring: 6200 });
  }),
  P('c', '少し重い「カチッ」', 1.6, '大きめのスイッチ。低めで手応えのある「カチッ」。ばねの戻りが少し遅い', (K) => {
    for (const [t, v] of [[0.2, 0.75], [1.0, 0.65]]) { click(K, t, v, { f: 1900, body: 220, gap: 0.032 }); K.tn(t + 0.035, 0.04, { f: 260, f2: 200, vol: v * 0.12 }); }
  }),
]);
scene('pl_crouch', '目覚め・410 と 4F', 'しゃがみ(廃止)', 'P4a-2 でしゃがみ自体を廃止したので使わない(ユーザー回答も「なし」)。312 の潜水の音は x312_dive。', '— (廃止)', '—', [
  P('a', '衣擦れ', 2, '服が擦れる「ササッ」だけ。最小限', (K) => { K.nz(0.1, 0.5, { color: 'pink', f: 2200, q: 0.6, vol: 0.35, env: 'swell' }); K.nz(0.65, 0.3, { color: 'pink', f: 2600, q: 0.6, vol: 0.2, env: 'swell' }); }),
  P('b', '膝が床に', 2, '衣擦れのあと膝が床に当たる鈍い音と小さな軋み', (K) => { K.nz(0.1, 0.3, { color: 'pink', f: 2000, q: 0.6, vol: 0.2, env: 'swell' }); K.tn(0.45, 0.1, { f: 90, f2: 60, vol: 0.5 }); K.creak(0.5, 0.25, { rate: 60, f: 420, q: 4, vol: 0.2 }); }),
  P('c', '息を殺す', 2, '小さく吸って止める→間→鼻から細く吐く。体の緊張', (K) => { K.nz(0.1, 0.35, { color: 'pink', f: 1400, f2: 2200, q: 1, vol: 0.3, env: 'swell' }); K.nz(1.0, 0.9, { color: 'pink', f: 800, q: 1, vol: 0.08, env: 'swell' }); K.nz(0.15, 0.25, { color: 'pink', f: 2500, q: 0.6, vol: 0.08, env: 'swell' }); }),
]);
// P4b 3 周目: メモ「がちゃっというような単純な音でいい」で作り直し(旧 2 周目: 重い無垢の扉/軽い中空の扉/古くて軋む扉)。開ける「ガチャッ」→閉める「ガチャッ」だけ
scene('door_wood', '目覚め・410 と 4F', '扉の開閉：居室の木扉', 'プレイヤーが居室の扉を開けて閉める(E)。', '新設(P4b で main.js useNearestDoor の開閉に接続)', '—(管理人が開け閉めする音は enemy_door_latch)', [
  P('a', 'レバーの「ガチャッ」', 2.4, 'レバーを下ろしてラッチが抜ける「ガチャッ」。閉める時は扉が枠に当たって「ガチャッ」', (K) => {
    const o = K.split(K.out, K.verb(0.3, 0.12, 0.5), 0.3);
    latch(K, 0.1, 0.55, 1700, o); K.nz(0.1, 0.05, { color: 'pink', type: 'lowpass', f: 900, vol: 0.25, to: o }); knock(K, 0.16, { f: 140, d: 0.04, vol: 0.15, nf: 1200, nv: 0.08, to: o });
    knock(K, 1.4, { f: 100, d: 0.1, vol: 0.55, nf: 700, nv: 0.25, to: o }); latch(K, 1.41, 0.5, 1650, o);
  }),
  P('b', '丸ノブの「ガチャ」', 2.4, 'ノブを回す短い擦れのあとラッチの「ガチャ」。閉まりは軽い「トン」とラッチ', (K) => {
    const o = K.split(K.out, K.verb(0.3, 0.12, 0.5), 0.3);
    K.grains(0.1, 0.1, { rate: 200, len: 0.002, f: 2500, vol: 0.15, to: o }); latch(K, 0.2, 0.5, 1500, o);
    knock(K, 1.4, { f: 95, d: 0.08, vol: 0.45, nf: 800, nv: 0.2, to: o }); latch(K, 1.41, 0.45, 1450, o);
  }),
  P('c', '少し重い「ガチャッ」', 2.4, '低めの金具の「ガチャッ」。閉める時は扉の重さで「ドッ」とラッチが掛かる', (K) => {
    const o = K.split(K.out, K.verb(0.35, 0.14, 0.5), 0.3);
    latch(K, 0.1, 0.6, 1250, o); knock(K, 0.13, { f: 120, d: 0.05, vol: 0.25, nf: 900, nv: 0.1, to: o });
    knock(K, 1.4, { f: 80, d: 0.14, vol: 0.7, nf: 600, nv: 0.25, to: o }); latch(K, 1.405, 0.55, 1200, o); K.modal(1.42, [[2200, 0.03, 1]], 0.06, o, 0.2);
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
  P('a', '革底・タイル床', 4.4, '革底の踵の「コツ」に床の硬い鳴りと爪先の小さな「ッ」。歩幅と強さが毎歩少しずつ違う。短い残響と壁の返り', (K) => {
    const v = K.verb(0.55, 0.25, 0.5), e = K.echo(0.045, 0.15, 4000, K.out), o = K.split(K.split(K.out, v, 0.6), e, 0.35);
    walk(K, 7, 0.55, (t, i, acc) => hardStep(K, t, { vol: 0.6 * acc, click: 3600, ring: [1750, 2900, 4400], body: 200, floor: 110, toe: 0.085, scuff: 0.25, to: o }), 0.06);
  }),
  P('b', '硬いラバー・コンクリート', 4.4, '硬いラバーの踵が打ちっぱなしの床を叩く「コッ」。少し重く、靴底が細かい砂を噛む', (K) => {
    const v = K.verb(0.45, 0.22, 0.6), o = K.split(K.out, v, 0.5);
    walk(K, 7, 0.56, (t, i, acc) => { hardStep(K, t, { vol: 0.62 * acc, click: 2600, ring: [1300, 2100, 3300], body: 160, floor: 85, toe: 0.1, bright: 0.7, scuff: 0.3, to: o }); K.grains(t + 0.004, 0.03, { rate: 300, len: 0.001, f: 4500, vol: 0.06, to: o }); }, 0.06);
  }),
  P('c', 'ローファー・長い廊下', 4.4, '細く硬い踵の高い「コツ」が長い廊下に響き、壁の間で細かく返る。少し急ぎ足', (K) => {
    const v = K.verb(1.1, 0.3, 0.45), e = K.echo(0.09, 0.25, 3500, K.out), o = K.split(K.split(K.out, v, 0.6), e, 0.3);
    walk(K, 7, 0.52, (t, i, acc) => hardStep(K, t, { vol: 0.55 * acc, click: 4200, ring: [2100, 3400, 5200, 7000], body: 230, floor: 120, toe: 0.07, scuff: 0.15, to: o }), 0.05);
  }),
]);
scene('door_locked', '目覚め・410 と 4F', '施錠の扉を引く', '開かない扉で E(入れない部屋・221 前の扉)。管理人が扉を確かめる時も同じ音。', 'main.js useNearestDoor / story.js use・useCar / spaces/x105.js・xb1.js useDoor / enemy_ai.js _doorEntry・_patrol(管理人)', 'lock_rattle_01(story rattle)・enemy_knob_rattle_01(enemy rattle)', [
  P('a', 'ガチャッと止まる', 1.8, 'レバーを下ろして引くと、ボルトが受けに当たって「ガチャッ」と止まる。扉がわずかに動いて枠で止まり、ばねが戻る。2 回目は弱く', (K) => {
    const v = K.verb(0.6, 0.25), o = K.split(K.out, v, 0.5);
    for (const [t, s] of [[0.1, 1], [0.85, 0.6]]) {
      K.creak(t, 0.08, { rate: 350, f: 2400, q: 5, vol: 0.1 * s, to: o });
      K.modal(t + 0.07, [[1350, 0.06, 1], [2200, 0.05, 0.6], [3500, 0.03, 0.3]], 0.5 * s, o, 0.8);
      K.tn(t + 0.07, 0.12, { f: 120, f2: 80, vol: 0.6 * s, to: o }); K.modal(t + 0.07, [[230, 0.12, 1], [450, 0.08, 0.5]], 0.3 * s, o, 0);
      K.modal(t + 0.35, [[2000, 0.04, 1], [3100, 0.03, 0.4]], 0.25 * s, o, 0.4);
    }
  }),
  P('b', 'ノブが空回り', 1.8, 'ノブが噛まずに空回りして「カラカラ」と細かく鳴る。手を離すと「カタン」。もう一度、今度は速く', (K) => {
    for (const [s, d, r] of [[0.1, 0.45, 22], [1.0, 0.35, 30]]) {
      K.nz(s, d, { f: 2400, q: 1, vol: 0.06, env: 'swell' });
      for (let t = s; t < s + d; t += (1 / r) * K.rnd(0.8, 1.25)) K.modal(t, [[K.rnd(2600, 3000), 0.015, 1], [K.rnd(4200, 4800), 0.01, 0.4]], 0.18 * K.rnd(0.5, 1), K.out, 0.3);
      knock(K, s + d + 0.04, { f: 260, d: 0.04, vol: 0.3, nf: 1800, nv: 0.2 }); K.modal(s + d + 0.04, [[1700, 0.04, 1]], 0.15);
    }
  }),
  P('c', '扉が枠で鳴る', 1.8, '強く 2 回引いて、扉全体が枠の中で「ガタン、ガタン」と鳴る。木の胴の低い響きと金具の音', (K) => {
    const v = K.verb(0.7, 0.3), o = K.split(K.out, v, 0.55);
    for (const t of [0.1, 0.62]) {
      K.tn(t, 0.18, { f: 70, f2: 50, vol: 0.8, to: o }); K.modal(t, [[140, 0.2, 1], [260, 0.15, 0.7], [470, 0.1, 0.4], [820, 0.06, 0.25]], 0.5, o, 0.7);
      K.modal(t + 0.005, [[1500, 0.05, 1], [2400, 0.04, 0.5]], 0.35, o, 0.5);
      knock(K, t + 0.07, { f: 110, d: 0.08, vol: 0.35, nf: 900, nv: 0.15, to: o });
    }
  }),
]);
scene('pl_peephole', '目覚め・410 と 4F', '覗き穴', '扉の覗き穴に顔を寄せる・離す(E 長押し)。', '新設(P4b で peephole.js set(true/false) に接続)', '—', [
  P('a', '真鍮の蓋を回す', 2, '覗き穴の真鍮の蓋を回すと細かく擦れて、止まる所で「チン」と小さく鳴る。離す時に戻す', (K) => {
    for (const t of [0.15, 1.45]) {
      K.grains(t, 0.14, { rate: 250, len: 0.0015, f: 5000, q: 1.2, vol: 0.12 }); K.nz(t, 0.14, { f: 6000, q: 2, vol: 0.06, env: 'swell' });
      K.modal(t + 0.14, [[5200, 0.12, 1], [7400, 0.08, 0.45], [3100, 0.1, 0.3]], 0.2, K.out, 0.3);
    }
  }),
  P('b', '布擦れと息を殺す', 2, '扉に体を寄せる服の擦れ、小さく吸って息を止め、少しして鼻から細く吐く', (K) => {
    K.nz(0.1, 0.45, { color: 'pink', f: 2300, q: 0.5, vol: 0.3, env: 'swell' }); K.grains(0.1, 0.45, { rate: 70, len: 0.004, f: 2800, q: 0.6, vol: 0.12 });
    K.nz(0.55, 0.3, { color: 'pink', f: 1600, f2: 2400, q: 1.2, vol: 0.13, env: 'swell' });
    K.nz(1.2, 0.7, { color: 'pink', f: 900, f2: 700, q: 1.5, vol: 0.07, env: 'swell' });
  }),
  P('c', 'こもる耳', 2, 'ほぼ無音。扉に耳を寄せたように周りがこもり、低い圧と自分の鼓動がかすかに聞こえる', (K) => {
    K.bed(2, { color: 'brown', f: 120, vol: 0.08, fade: 0.4 }); K.nz(0, 2, { color: 'brown', type: 'lowpass', f: 90, vol: 0.18, env: 'swell', p: 0.6 });
    heart(K, 0.5, 0.15); heart(K, 1.35, 0.12);
  }, 'quiet'),
]);
scene('pl_closet', '目覚め・410 と 4F', 'クローゼットに隠れる', '居室のクローゼットに入って折戸を閉める・出る。', 'rooms.js openCloset(creak)', 'room_closet_01', [
  P('a', '折戸のレール', 3, 'レールの「ガラガラ」と閉まりの小さな「トン」', (K) => { for (const t of [0.1, 1.8]) { K.nz(t, 0.5, { f: 900, q: 2, vol: 0.15, env: 'flat' }); K.grains(t, 0.5, { rate: 120, len: 0.003, f: 1200, vol: 0.2 }); } knock(K, 2.35, { f: 150, vol: 0.4, nf: 1500 }); }),
  P('b', '蝶番の軋み', 3, '折戸の蝶番が細く軋む。閉めるとき一番鳴る', (K) => { K.creak(0.1, 0.6, { rate: 70, rate2: 50, f: 900, q: 5, vol: 0.35 }); K.creak(1.8, 0.5, { rate: 60, rate2: 40, f: 1000, q: 5, vol: 0.3 }); knock(K, 2.3, { f: 140, vol: 0.35, nf: 1400 }); }),
  P('c', '服とハンガー', 3, '吊った服を押しのける衣擦れと、ハンガーが触れ合う音', (K) => { K.nz(0.2, 0.7, { color: 'pink', f: 2500, q: 0.6, vol: 0.2, env: 'swell' }); for (let i = 0; i < 4; i++) K.modal(0.3 + i * 0.13 + K.rnd(0, 0.05), [[K.rnd(1900, 2900), 0.1, 1], [K.rnd(4000, 5000), 0.05, 0.4]], 0.12); knock(K, 2.0, { f: 140, vol: 0.4, nf: 1400 }); K.nz(2.2, 0.6, { color: 'pink', f: 2200, q: 0.6, vol: 0.12, env: 'swell' }); }),
]);
// P4a-2: ユーザー回答「パリーン！と割れる感じ」で作り直し(旧: 高い陶器/厚いガラス/転がってから割れる)。高い音で砕け散り、破片が散る尾を付ける
scene('room_fall', '目覚め・410 と 4F', '物が落ちて割れる', '触れると落ちる障害物(花瓶・マグ等)。この音で管理人が部屋を知る。「パリーン!」と高く砕け散り、破片が床に散る。缶・本などは P4b で同じ作りから派生。', 'rooms.js _updateFallables(fall_<type>)', 'room_fall_<vase|cans|books|bottle|mug|binders>_01', [
  P('a', '薄いガラス(パリーン！)', 2.8, 'コップのような薄いガラスが高く「パリーン」。P4b: メモ「パリーン！と割れる感じ」で、砕ける瞬間の鋭い「パ」と高い鳴り「リーン」を強く長くし、破片を増やした', (K) => {
    const v = K.verb(0.8, 0.28, 0.4); const o = K.split(K.out, v, 0.45);
    K.tn(0.1, 0.03, { f: 260, f2: 160, vol: 0.2, to: o });                                    // 床に当たる一瞬
    K.nz(0.1, 0.006, { type: 'highpass', f: 2500, vol: 1.0, a: 0.0003, to: o });              // 砕ける瞬間の鋭い「パ」
    K.nz(0.1, 0.12, { type: 'highpass', f: 3500, vol: 0.9, to: o });
    K.modal(0.1, [[3300, 0.7, 1], [5100, 0.5, 0.7], [7600, 0.35, 0.45], [4350, 0.55, 0.5]], 0.45, o, 0.9);   // 薄いガラスの鳴り「リーン」(長く)
    K.modal(0.13, [[3900, 0.5, 1], [6200, 0.35, 0.5]], 0.25, o, 0.4);
    shatter(K, 0.11, { base: 2700, vol: 0.5, shards: 44, spread: 0.5, glass: 1.25, to: o });
    debris(K, 0.45, 1.9, { n: 32, f0: 4200, f1: 9000, vol: 0.22, d: 0.05, to: o });
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
scene('enemy_presence', '管理人', '管理人の気配(呟き。常時ハムの置き換え)', '管理人が同じ階を巡回している間、間を置いて鳴る小さな音(常時ループにはしない)。P4a で削除した鼻歌ループの代わり。', '新設(P4b で enemy_ai.js の PATROL 中に 6〜15 秒おきに鳴らす)', 'enemy_hum_loop_01(P4a で削除)', [
  PV('a', '壁越しのぼそぼそ(声)', 7, '壁の向こうで、低い男がひとりでぼそぼそ呟いている。言葉は聞き取れない程度にこもる(仮声「どこかなあ…」「ちがう…」)', ['mgr_mumble_04', 'mgr_mumble_01'], (K) => {
    const o = K.split(K.muf(1100, 1), K.verb(0.9, 0.35, 0.6), 0.5);
    K.vox(0.4, 'mgr_mumble_04', { rate: 0.9, len: 4.0, hp: 120, lp: 1600, rasp: 0.35, raspF: 1200, jit: 18, jitHz: 2, vol: 0.85, to: o });
    K.vox(5.0, 'mgr_mumble_01', { rate: 0.9, len: 1.7, hp: 120, lp: 1500, rasp: 0.35, raspF: 1200, jit: 18, jitHz: 2, vol: 0.6, to: o });
  }),
  PV('b', '通り過ぎながら呟く(声)', 7, '廊下を歩きながら小声で呟き、近づいて遠ざかる。重い足音がかすかに混じる(仮声「ちがう…ちがう…ここも、ちがう…」)', ['mgr_mumble_05'], (K) => {
    const g = K.shape(0, 7, 1, (u) => Math.pow(Math.sin(Math.PI * u), 0.8), K.out);
    const o = K.split(g, K.verb(1.2, 0.4, 0.6), 0.5);
    K.vox(0.6, 'mgr_mumble_05', { rate: 0.88, len: 4.3, hp: 110, lp: 2400, rasp: 0.6, raspF: 1600, dry: 0.75, jit: 22, jitHz: 2.5, vol: 0.85, to: o });
    walk(K, 8, 0.8, (t, i, acc) => softStep(K, t, { vol: 0.22 * acc, to: K.muf(600, 1, o) }), 0.06, 0.3);
  }),
  PV('c', '囁きの呟き(声)', 7, '息だけの囁きで何かを繰り返し呟く。人の声なのに、何を言っているか分からない(仮声を囁きに変える)', ['mgr_mumble_03'], (K) => {
    const o = K.split(K.muf(2600, 1), K.verb(0.8, 0.35, 0.6), 0.5);
    K.vox(0.4, 'mgr_mumble_03', { rate: 0.95, len: 5.6, hp: 200, lp: 5000, dry: 0.15, rasp: 2.0, raspF: 2000, raspQ: 0.5, jit: 15, jitHz: 2, vol: 0.9, to: o });
  }),
]);
// P4b 3 周目: メモ「金属音感をなくして」で作り直し(旧 2 周目: 重い革の作業靴/安全靴の踏み込み/踵に金具)。踵の固有振動(金属・硬い鳴り)を全部外し、鈍い「ドッ」と沈み・擦れだけで重さを出す
scene('enemy_step_walk', '管理人', '管理人の足音(通常)', '巡回・扉に向かう歩き。B1 では上の階の足音としてこもらせて流用。', 'enemy_ai.js constructor の接地コールバック(step)・_reveal／spaces/xb1.js sound(上の階)', 'enemy_step_walk_01..04・xb1_steps_above_01', [
  P('a', 'ゴム底の重い足音', 5.6, '大柄な体重の乗った鈍い「ドッ」と床の沈み。響きのない、硬さを感じさせない重い歩き', (K) => {
    const o = K.split(K.out, K.verb(0.5, 0.2, 0.6), 0.45);
    walk(K, 7, 0.78, (t, i, acc) => softStep(K, t, { vol: 0.85 * acc, heel: 650, scuff: 0.3, to: o }), 0.07);
  }),
  P('b', '革底(響きなし)', 5.6, '革の靴底の「ドッ」に、ときどき革のきしみ。床は鳴らない', (K) => {
    const o = K.split(K.out, K.verb(0.5, 0.2, 0.6), 0.45);
    walk(K, 7, 0.8, (t, i, acc) => softStep(K, t, { vol: 0.85 * acc, heel: 1050, body: 100, creak: 0.45, scuff: 0.2, to: o }), 0.07);
  }),
  P('c', '片足を擦る', 5.6, '一歩おきに靴底を床に擦って引きずる。ゆっくりで不揃い', (K) => {
    const o = K.split(K.out, K.verb(0.5, 0.2, 0.6), 0.45);
    walk(K, 7, 0.85, (t, i, acc) => softStep(K, t, { vol: 0.85 * acc, heel: 700, drag: i % 2 ? 0.28 : 0, scuff: 0.15, to: o }), 0.12);
  }),
]);
scene('enemy_step_run', '管理人', '管理人の足音(追跡)', '追跡(CHASE)の走り。', 'enemy_ai.js 接地コールバック(step・run 時の音量 1.0)', 'enemy_step_run_01..04(予定・現状は歩きの音量違い)', [
  P('a', 'ドタバタ全力', 3.4, '乱れた歩幅で床を踏み鳴らす全力疾走。時々つまずくように二度踏みし、周りの物がカタカタ震える', (K) => {
    const o = K.split(K.out, K.verb(0.8, 0.3, 0.5), 0.5);
    let t = 0.08, i = 0;
    while (t < 3.0) {
      const acc = i % 2 ? 0.85 : 1; heavyStep(K, t, { vol: 1.0 * acc, body: 85, floor: 52, roll: 0.06, scuff: 0.5, to: o });
      if (K.r() < 0.25) heavyStep(K, t + 0.07, { vol: 0.5, body: 90, floor: 55, roll: 0.04, to: o });
      if (i % 3 === 1) K.grains(t + 0.01, 0.12, { rate: 90, len: 0.003, f: 2600, vol: 0.12, to: o });
      t += 0.24 * K.rnd(0.7, 1.35); i++;
    }
  }, 'loud'),
  P('b', '床が鳴る重い走り', 3.4, '一歩ごとに床が低く「ドン」と鳴り、天井の照明や扉の金具がビリつく。重さで迫る', (K) => {
    const o = K.split(K.out, K.verb(1.0, 0.35, 0.55), 0.5);
    walk(K, 10, 0.3, (t, i, acc) => {
      heavyStep(K, t, { vol: 0.95 * acc, body: 80, floor: 48, roll: 0.07, to: o }); K.tn(t, 0.35, { f: 46, f2: 38, vol: 0.45 * acc, to: o });
      for (let k = 0; k < 4; k++) K.modal(t + 0.02 + k * 0.025, [[K.rnd(1500, 3200), 0.03, 1]], 0.05 * acc, o, 0.2);
    }, 0.12, 0.08);
  }, 'loud'),
  P('c', '奥から迫って急停止(大きく・ドタバタ)', 3.4, '遠くこもった足音がみるみる大きく明るくなり、目の前で靴を擦って急停止、最後に一度踏み鳴らす。P4b: メモ「もっと大きい音でドタバタ恐怖感を煽る」で一歩ごとに床を踏み鳴らす低音・二度踏み・周りの物のカタつきを足し、全体を大きく', (K) => {
    const lp = K.filt('lowpass', 500, 0.7), g = K.gain(1, K.out); lp.connect(g); K.ramp(lp.frequency, 0, 2.2, 500, 9000);
    g.gain.setValueAtTime(0.35, K.T(0)); g.gain.linearRampToValueAtTime(1, K.T(2.2));
    const o = K.split(lp, K.verb(0.9, 0.3, 0.5), 0.5);
    let t = 0.05, i = 0;
    while (t < 2.45) { runStomp(K, t, i % 2 ? 0.9 : 1.05, o); t += 0.22 * K.rnd(0.75, 1.3); i++; }
    K.nz(2.55, 0.25, { f: 1800, f2: 2600, q: 1.2, vol: 0.4, env: 'swell' }); K.tn(2.6, 0.18, { type: 'sawtooth', f: 1900, f2: 2300, vol: 0.05, env: 'swell', lpf: 3000 });
    runStomp(K, 2.85, 1.25, K.out, false);
  }, 'loud'),
]);
scene('enemy_breath_close', '管理人', '笑い声・セリフ(目の前)', '隠れたクローゼット/ロッカーの前で管理人が立ち止まる。', 'enemy_ai.js _locker(breath)', 'enemy_breath_close_01', [
  PV('a', '囁き「みいつけた」(声)', 4.5, '息を吸ってから、ほとんど息だけの囁きで「み…つけた」。低い芯がほんの少しだけ残る(仮声)', ['mgr_line_found_01'], (K) => {
    const o = K.split(K.out, K.verb(0.3, 0.12, 0.5), 0.35);
    inhale(K, 0.15, 0.55, 0.45, o);
    K.vox(0.85, 'mgr_line_found_01', { rate: 0.9, len: 2.05, dry: 0.12, rasp: 2.4, raspF: 2300, raspQ: 0.5, hp: 180, lp: 7000, jit: 15, jitHz: 2.5, vol: 0.9, to: o });
    K.vox(0.85, 'mgr_line_found_01', { rate: 0.9, len: 2.05, hp: 110, lp: 1100, jit: 15, jitHz: 2.5, vol: 0.2, to: o });
    exhale(K, 3.3, 0.8, 0.2, o);
  }),
  PV('b', '低い声と息(二重)', 4.5, '低い声で「みいつけた」。同じ声を 2 本わずかにずらして重ね、言い終わりに鼻から重く息を吐く(仮声)', ['mgr_line_found_02'], (K) => {
    const o = K.split(K.out, K.verb(0.35, 0.15, 0.5), 0.35);
    voxStack(K, 0.5, 'mgr_line_found_02', [[0, 0.86, 0, 0.6], [0.014, 0.875, 14, 0.45]], { len: 1.7, jit: 30, jitHz: 2.2, rasp: 0.7, raspF: 1800, dry: 0.8, hp: 90, lp: 4200, vol: 0.9, to: o });
    exhale(K, 2.75, 0.9, 0.35, o, 700);
  }),
  PV('c', '耳元で、間を置いて(声)', 4.5, '耳元で息を吸い、少し間を置いてから低い囁き声で「みーつけた」。最後に笑うような鼻息(仮声)', ['mgr_line_found_03'], (K) => {
    const o = K.split(K.out, K.verb(0.25, 0.1, 0.5), 0.3);
    inhale(K, 0.1, 0.5, 0.4, o, 1200);
    K.vox(1.2, 'mgr_line_found_03', { rate: 0.84, len: 1.5, dry: 0.55, rasp: 1.3, raspF: 2100, hp: 120, lp: 5200, jit: 25, jitHz: 2, vol: 0.9, to: o });
    for (const t of [3.2, 3.42]) exhale(K, t, 0.18, 0.3, o, 1100);
  }),
]);
scene('enemy_breath_door', '管理人', '笑い声・呟き(扉の向こう)', '管理人が潜伏する空き部屋の扉の前で止まると聞こえる静かな予兆(歩いていると気づかない)。', 'enemy_ai.js _roomLurkTick(breathDoor)', 'enemy_breath_behind_door_01', [
  PV('a', '扉越しの小さな笑い(声)', 4.5, '扉のすぐ向こうで「くっくっく…」と喉で笑う。扉板越しにこもる(仮声)', ['mgr_laugh_02'], (K) => {
    const door = K.filt('peaking', 220, 2, K.muf(650, 1), 6);
    K.vox(1.0, 'mgr_laugh_02', { rate: 0.7, len: 1.6, lp: 900, drive: 1.6, jit: 30, vol: 1, to: door });
  }),
  PV('b', '「いるのは…わかってるよ」ほか 3 本(声)', 13.5, '扉に口を寄せて、こもった低い声でゆっくり。P4b: メモ「息遣いではなく、笑い声かセリフにして」で、短い笑い「ふふふ…ふふ」と「もうすこし…ちかくに、おいで」を足した 3 本(ゲームでは立ち止まるたびに 1 本ずつ順に)。加工は src/audio_voice.js(仮声)', VOICE.enemy_breath_door.takes.flat(), (K) => {
    VOICE.enemy_breath_door.takes.forEach((tk, i) => VOICE.enemy_breath_door.fn(new Kit(K.c, K.out, K.t0 + i * 4.5, 101 + i), tk));
  }),
  PV('c', '軽いノック→「まだ…おきてるのかい」(声)', 4.5, '指の背で 2 回そっと叩いてから、扉越しに穏やかな声。管理人らしい口調が逆に怖い(仮声)', ['mgr_line_awake_01'], (K) => {
    const door = K.filt('peaking', 220, 2, K.muf(700, 1), 6);
    for (const t of [0.1, 0.32]) { K.tn(t, 0.08, { f: 160, f2: 120, vol: 0.4, to: door }); K.modal(t, [[230, 0.1, 1], [480, 0.06, 0.4]], 0.2, door, 0.3); }
    K.vox(0.9, 'mgr_line_awake_01', { rate: 0.72, len: 2.6, lp: 1000, jit: 25, vol: 1, to: door });
  }),
]);
scene('enemy_handle', '管理人', '取っ手に触れる', '隠れ場所の取っ手・410 の扉のノブに管理人の指が触れる(開けないで去ることもある)。', 'enemy_ai.js _locker・_scope(handle)', 'enemy_handle_touch_01', [
  P('a', 'レバーにそっと手を掛ける', 2, '指が金属のレバーを撫でる擦れ、わずかに下がって「カチ」、ばねが細く鳴って、そっと戻る', (K) => {
    K.nz(0.15, 0.3, { type: 'lowpass', f: 1500, vol: 0.18, env: 'swell' });
    K.modal(0.5, [[2400, 0.03, 1], [3700, 0.02, 0.4]], 0.18, K.out, 0.3); K.modal(0.62, [[2500, 0.03, 1]], 0.12, K.out, 0.3);
    K.creak(0.7, 0.25, { rate: 200, f: 2600, q: 6, vol: 0.1 });
    K.modal(1.3, [[2300, 0.03, 1], [3500, 0.02, 0.4]], 0.15, K.out, 0.3);
  }),
  P('b', '指輪が取っ手に当たる', 2, '指輪が金属の取っ手に当たる澄んだ「チン」。間を置いてもう一度、最後は軽く', (K) => {
    for (const [t, v] of [[0.2, 1], [0.9, 0.8], [1.5, 0.45]]) { K.modal(t, [[3300, 0.35, 1], [5100, 0.2, 0.5], [7800, 0.1, 0.25]], 0.22 * v, K.out, 0.4); K.modal(t, [[1200, 0.08, 1]], 0.06 * v, K.out, 0); }
  }),
  P('c', '取っ手を握って少し引く', 2, '取っ手を握って引くと薄い鋼板が「ペコッ」とたわみ、ラッチが張って「ギ」。手を離すと板が「ポコ」と戻る', (K) => {
    K.modal(0.2, [[340, 0.2, 1], [760, 0.15, 0.6], [1500, 0.08, 0.3]], 0.3, K.out, 0.3); knock(K, 0.2, { f: 300, d: 0.03, vol: 0.2, nf: 1800, nv: 0.15 });
    K.creak(0.35, 0.3, { rate: 160, f: 1900, q: 6, vol: 0.14 });
    K.modal(1.2, [[360, 0.18, 1], [800, 0.12, 0.5]], 0.25, K.out, 0.2); K.modal(1.22, [[1800, 0.03, 1]], 0.1);
  }),
]);
// P4b 3 周目: メモ「機械音感をなくして」で作り直し(旧 2 周目: 扉全体が暴れる/金物が鳴る/間欠)。周期的な連打をやめ、毎回強さ・間隔・扉板の鳴りがばらつく人の力の揺さぶりに
scene('room_door_rattle', '管理人', '扉のガタガタ(ランダム演出)', '部屋の中で何かが暴れて扉が激しく鳴り揺れる。絶対に出てこない(潜伏の静かな予兆と意味を分ける)。', 'door_fx.js(ガタガタ扉 slam)・enemy_ai.js _appear(slam)', 'room_door_rattle_violent_01', [
  P('a', '激しく揺さぶる(不規則)', 4.5, '中から扉を両手で揺さぶる。強まったり弱まったり、間隔も毎回違う。最後は唐突に止む', (K) => {
    const o = K.split(K.out, K.verb(0.6, 0.2, 0.5), 0.4);
    let t = 0.08;
    while (t < 3.9) {
      const surge = 0.5 + 0.5 * Math.sin(t * 2.3 + 1);
      const v = (0.45 + 0.55 * surge) * K.rnd(0.7, 1.05);
      doorHit(K, t, v, o);
      if (K.r() < 0.35) knobRattle(K, t + 0.02, 0.1, v * 0.4, o);
      t += K.rnd(0.07, 0.16) / (0.6 + surge * 0.8) + (K.r() < 0.1 ? K.rnd(0.15, 0.35) : 0);
    }
  }),
  P('b', 'ノブを回す→体当たり', 4.5, 'ノブを乱暴に何度も回すガチャガチャの後、肩でぶつかる重い「ドン」が 3 回', (K) => {
    const o = K.split(K.out, K.verb(0.7, 0.25, 0.5), 0.45);
    knobRattle(K, 0.1, 0.5, 0.45, o); knobRattle(K, 0.75, 0.4, 0.4, o); knobRattle(K, 1.3, 0.25, 0.35, o);
    for (const [t, v] of [[1.7, 0.9], [2.55, 0.85], [3.4, 1.0]]) { doorHit(K, t, v, o); boom(K, t, { vol: 0.25 * v, f: 70, f2: 40, d: 0.3, crack: 0.1, to: o }); knobRattle(K, t + 0.03, 0.15, 0.25, o); }
  }),
  P('c', '間欠(数回→沈黙→一番大きく)', 4.5, '数回ずつ激しく揺れては止む。長い沈黙のあと、一番大きな一撃', (K) => {
    const o = K.split(K.out, K.verb(0.7, 0.25, 0.5), 0.45);
    for (const [s, n] of [[0.1, 4], [1.05, 3]]) { let t = s; for (let i = 0; i < n; i++) { doorHit(K, t, K.rnd(0.5, 0.85), o); t += K.rnd(0.08, 0.15); } }
    doorHit(K, 3.4, 1.1, o); boom(K, 3.4, { vol: 0.45, f: 65, f2: 35, d: 0.45, crack: 0.2, to: o }); knobRattle(K, 3.43, 0.2, 0.3, o);
  }),
]);
scene('enemy_door_latch', '管理人', '空室の扉を普通に開け閉め', '襲撃でない潜伏の解除(管理人が普通に扉を開けて出てくる)。扉は壊れない。', 'enemy_ai.js _npcDoor(latch)', 'door_latch_creak_01', [
  P('a', 'ゆっくり開く軋み', 4, 'ラッチの後、扉がゆっくり軋みながら開く', (K) => { latch(K, 0.1, 0.35); K.creak(0.3, 1.8, { rate: 30, rate2: 18, f: 600, f2: 1400, q: 6, vol: 0.35, p: 0.4 }); }),
  P('b', 'カチャ…静かに閉じる', 4, '開け閉めとも静か。「誰かが出入りした」だけ分かる', (K) => { latch(K, 0.1, 0.35); K.nz(0.3, 0.8, { color: 'brown', type: 'lowpass', f: 300, vol: 0.08, env: 'swell' }); knock(K, 2.0, { f: 100, vol: 0.35, nf: 1000 }); latch(K, 2.05, 0.3); }),
  P('c', '開く→間→閉まる', 4, '短く開いて、しばらくして閉まる。その間に出てきた', (K) => { latch(K, 0.1, 0.35); K.creak(0.3, 0.5, { rate: 45, f: 700, q: 5, vol: 0.25 }); knock(K, 3.0, { f: 90, vol: 0.5, nf: 900 }); latch(K, 3.05, 0.35); }),
]);
scene('enemy_door_smash', '管理人', '扉を破る(飛び出し)', '懐中電灯を点けて潜伏部屋の前を通った時、管理人が扉を破って飛び出す。同じ階全域と上下階に届く大きな音。', 'enemy_ai.js _burst(crash)', 'enemy_door_smash_01', [
  P('a', '爆発のような一撃', 3, '低域の衝撃波が床ごと揺らす爆発のような破壊音。木が砕ける音と破片が後に続き、長く響く', (K) => {
    const v = K.verb(1.8, 0.5, 0.55), o = K.split(K.out, v, 0.6), d = K.sat(2.5, o, 7000);
    boom(K, 0.05, { vol: 1, f: 68, f2: 24, d: 1.3, crack: 0.9, to: d });
    splinter(K, 0.05, 0.4, { vol: 0.5, f: 1600, to: o });
    K.nz(0.07, 0.8, { color: 'brown', type: 'lowpass', f: 160, vol: 0.5, env: 'swell', p: 0.8, to: o });
    debris(K, 0.3, 1.4, { n: 14, f0: 500, f1: 1800, vol: 0.18, d: 0.05, bounce: true, to: o });
  }, 'loud'),
  P('b', '木が砕け散る', 3, '衝撃のあと板が裂ける音が長く続き、木片が床に降りそそぐ。蝶番の金属が鳴る', (K) => {
    const o = K.split(K.out, K.verb(1.4, 0.45, 0.55), 0.6);
    boom(K, 0.05, { vol: 0.8, f: 75, f2: 30, d: 0.8, to: K.sat(2, o) });
    splinter(K, 0.06, 0.9, { vol: 0.65, f: 1900, to: o });
    K.modal(0.15, [[1700, 0.5, 1], [2600, 0.35, 0.5], [4100, 0.2, 0.25]], 0.2, o, 0.4);
    debris(K, 0.25, 1.9, { n: 28, f0: 450, f1: 2200, vol: 0.22, d: 0.05, bounce: true, to: o });
  }, 'loud'),
  P('c', '二重の衝撃(爆発のように)', 3.5, '一撃で扉が割れ、半拍おいて扉板が床に倒れて地響き。P4b: メモ「もっと爆発音のような感じ」で一撃目を爆発の衝撃波に(低域を長く深く・圧の「ボフッ」・地鳴りの尾)', (K) => {
    const o = K.split(K.out, K.verb(1.8, 0.5, 0.55), 0.6);
    boom(K, 0.05, { vol: 1.2, f: 62, f2: 20, d: 1.6, crack: 1.1, to: K.sat(3, o, 7000) });
    K.nz(0.05, 1.8, { color: 'brown', type: 'lowpass', f: 220, f2: 60, vol: 0.7, to: o });                // 地鳴りの尾
    K.nz(0.05, 0.4, { color: 'pink', type: 'lowpass', f: 2500, f2: 300, vol: 0.6, to: o });               // 圧の「ボフッ」
    splinter(K, 0.05, 0.35, { vol: 0.5, to: o });
    boom(K, 0.5, { vol: 0.9, f: 55, f2: 22, d: 1.1, crack: 0.5, to: K.sat(2, o) });                       // 扉板が倒れる二撃目
    K.modal(0.5, [[120, 0.3, 1], [230, 0.22, 0.7], [410, 0.15, 0.4]], 0.5, o, 0.8);
    debris(K, 0.3, 1.6, { n: 16, f0: 500, f1: 2000, vol: 0.16, d: 0.05, bounce: true, to: o });
    K.grains(0.6, 1.6, { rate: 40, len: 0.003, f: 3000, vol: 0.08, p: 1.5, to: o });
  }, 'loud'),
]);
scene('enemy_scream', '管理人', '悲鳴・叫び(襲撃)', '襲撃の振りかぶりの瞬間の叫び(105 の追跡の始まりにも流用中)。', 'enemy_ai.js _attack(scream)／spaces/x105.js update', 'enemy_scream_attack_01(105 の悲鳴は x105_scream)', [
  PV('a', '息の多い絶叫(声を 3 本重ねる)', 3, '鋭く息を吸ってから、喉が擦り切れるような息の多い「ああぁぁ」。3 本の声がわずかにずれて太く、最後に裏返って落ちる(仮声)', ['mgr_scream_03'], (K) => {
    const o = K.split(K.out, K.verb(0.9, 0.3, 0.5), 0.4);
    inhale(K, 0.0, 0.25, 0.5, o, 1300);
    const c = (u) => 260 * Math.min(1, u * 3) + 60 * Math.sin(u * 9) - 380 * Math.max(0, u - 0.75) / 0.25;
    voxStack(K, 0.25, 'mgr_scream_03', [[0, 1.12, 0, 0.5], [0.011, 1.14, 18, 0.38], [0.023, 1.1, -14, 0.3]],
      { from: 0.7, loop: [1.0, 1.8], hold: 2.3, cents: c, jit: 40, jitHz: 3, vib: 5, vibd: 14, drive: 1.3, rasp: 1.6, raspF: 1900, raspQ: 0.5, dry: 0.45, hp: 200, lp: 6500, vol: 0.9, to: o });
  }),
  PV('b', '喉が裂ける叫び(声＋喉の息)', 3, '「うああぁ」と叫ぶ声に、声にならない喉の息が強く混じる。声の芯は細く、息の音が前に出る(仮声)', ['mgr_scream_04'], (K) => {
    const o = K.split(K.out, K.verb(0.8, 0.3, 0.5), 0.4);
    const c = (u) => 200 * Math.min(1, u * 2.5) + 80 * Math.sin(u * 6);
    voxStack(K, 0.08, 'mgr_scream_04', [[0, 1.08, 0, 0.55], [0.017, 1.1, 22, 0.4]], { loop: [0.4, 1.2], hold: 2.4, cents: c, jit: 45, jitHz: 3, vib: 4.5, vibd: 12, rasp: 2.2, raspF: 1500, raspQ: 0.45, dry: 0.35, hp: 160, lp: 6000, vol: 0.9, to: o });
    for (const [f, g] of [[850, 0.18], [1350, 0.12], [2700, 0.07]]) K.nz(0.1, 2.35, { color: 'pink', f, q: 4, vol: g, env: 'swell', p: 0.35, to: o });   // 声にならない喉の息(母音の帯域のノイズ)
  }),
  PV('c', '低い咆哮(胸に響く)', 3, '低く太い「うおぉぉ」。2 本の声を重ね、1 オクターブ下をごく薄く。胸と部屋が鳴る(仮声)', ['mgr_scream_02'], (K) => {
    const o = K.split(K.filt('peaking', 180, 1.2, K.out, 4), K.verb(1.4, 0.45, 0.5), 0.5);
    inhale(K, 0.0, 0.2, 0.35, o, 900);
    const c = (u) => 200 * Math.sin(Math.PI * u) + 40 * Math.sin(u * 7);
    voxStack(K, 0.2, 'mgr_scream_02', [[0, 0.92, 0, 0.55], [0.015, 0.94, 16, 0.42]], { loop: [0.4, 1.3], hold: 2.4, cents: c, jit: 40, jitHz: 3, drive: 1.5, rasp: 0.9, raspF: 1100, dry: 0.65, hp: 80, lp: 4000, vol: 0.9, to: o });
    K.vox(0.2, 'mgr_scream_02', { loop: [0.3, 1.2], hold: 2.4, rate: 0.47, cents: c, jit: 30, jitHz: 3, rasp: 0.5, raspF: 600, hp: 50, lp: 900, vol: 0.18, to: o });
  }),
]);
scene('enemy_hit', '管理人', 'ハンマーの一撃', '襲撃ムービーで振り下ろしが当たる瞬間(画面は血しぶき)。', 'attack_movie.js hit', 'enemy_hit_hammer_01', [
  P('a', '重い鈍器(より重く)', 1.8, '低域の重い衝撃が腹に来る「ドゴッ」。P4b: メモ「もっと重量感のあるものに」で衝撃の低音を深く長く、胴に響く塊と床まで伝わる余韻を足し、骨の鳴りを低くした', (K) => {
    const o = K.split(K.out, K.verb(0.7, 0.22, 0.5), 0.3), d = K.sat(3, o, 5000);
    boom(K, 0.05, { vol: 1.15, f: 55, f2: 22, d: 0.9, crack: 0.45, to: d });
    K.tn(0.05, 0.5, { f: 90, f2: 40, vol: 0.6, to: d });                                   // 胴に響く鈍い塊
    K.nz(0.05, 0.25, { color: 'brown', type: 'lowpass', f: 300, vol: 0.9, to: o });          // 食い込む重さ
    K.modal(0.055, [[700, 0.05, 1], [1300, 0.04, 0.5]], 0.3, o, 0.4);                        // 鈍い骨(低め)
    K.nz(0.07, 0.2, { color: 'pink', type: 'lowpass', f: 1000, vol: 0.4, env: 'swell', to: o });
    K.tn(0.12, 0.9, { f: 38, vol: 0.35, to: o });                                           // 床まで伝わる余韻
  }, 'loud'),
  P('b', '骨が砕ける', 1.6, '衝撃と同時に乾いた「バキッ」が前に出て、細かく砕ける音が一瞬続く', (K) => {
    const o = K.split(K.out, K.verb(0.5, 0.2, 0.5), 0.3);
    boom(K, 0.05, { vol: 0.75, f: 75, f2: 35, d: 0.4, crack: 0.4, to: K.sat(2, o) });
    K.grains(0.05, 0.07, { rate: 450, len: 0.002, f: 2500, q: 0.8, vol: 0.7, to: o });
    K.modal(0.05, [[2200, 0.04, 1], [3400, 0.03, 0.6], [1300, 0.05, 0.5]], 0.45, o, 1);
    K.creak(0.07, 0.09, { rate: 300, f: 1600, q: 2, vol: 0.3, to: o });
  }, 'loud'),
  P('c', '湿った重さ', 1.6, '鈍い低音の衝撃に湿って潰れる音が続き、低い余韻が残る。生々しい', (K) => {
    const o = K.split(K.out, K.verb(0.6, 0.2, 0.5), 0.3);
    boom(K, 0.05, { vol: 1, f: 52, f2: 26, d: 0.7, crack: 0.3, to: K.sat(2.2, o) });
    K.nz(0.08, 0.32, { color: 'pink', type: 'lowpass', f: 900, vol: 0.55, env: 'swell', to: o });
    K.grains(0.08, 0.32, { rate: 80, len: 0.01, f: 700, q: 1, vol: 0.35, to: o });
    K.tn(0.1, 0.6, { f: 40, vol: 0.3, to: o });
  }, 'loud'),
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
  P('a', '短い「キイ」', 2, 'ラッチが外れる小さな「カチ」の後、細く短い「キイ」。語尾が少し上がる', (K) => {
    K.modal(0.05, [[2100, 0.03, 1], [3300, 0.02, 0.4]], 0.18);
    squeal(K, 0.14, 0.55, { f: 1450, fc: (u) => 1 + 0.12 * u, amp: (u) => Math.pow(Math.sin(Math.PI * u), 0.5), vol: 0.5 });
    K.modal(0.14, [[175, 0.8, 1], [415, 0.6, 0.5]], 0.04, K.out, 0);
  }),
  P('b', '「キ…イ」と二段', 2, '一度引っかかって「キ」、少し間を置いてもう一段高く「イ」', (K) => {
    K.modal(0.05, [[2100, 0.03, 1]], 0.15);
    squeal(K, 0.14, 0.22, { f: 1300, vol: 0.45 });
    squeal(K, 0.52, 0.45, { f: 1520, fc: (u) => 1 + 0.08 * u, vol: 0.5 });
    K.modal(0.52, [[190, 0.7, 1], [440, 0.5, 0.5]], 0.04, K.out, 0);
  }),
  P('c', 'ゆっくり「キイィ」(錆)', 2, '錆びた蝶番の少しざらついた「キイィ」が 1 秒。開き切って鋼板が小さく「コン」', (K) => {
    squeal(K, 0.12, 1.0, { f: 1250, fc: (u) => 1 + 0.06 * Math.sin(u * 5), jit: 0.02, grit: 0.5, vol: 0.45 });
    K.modal(0.15, [[175, 1.0, 1], [415, 0.8, 0.5]], 0.06, K.out, 0);
    steelPanel(K, 1.2, { vol: 0.12, base: 200, d: 0.4 });
  }),
]);
// P4b 3 周目: 2 周目は「なし」＋メモ「もっと驚かせる音で」。前置きを短くして一気に大きく(扉の轟音・叫び・金属の悲鳴が同時)、どれも大きめ(+3dB)
scene('locker_burst', '1F・221・管理室', 'ロッカーから出てくる', 'ロッカー登場の 3 段目(管理人がゆっくり出てくる→追跡へ)。', '新設(P4b で enemy_ai.js _reveal の emerge に接続。今は無音)', '—', [
  PV('a', '無音→轟音と金切り声', 3, '小さな「カチ」の後に一瞬の無音。鋼板の扉が壁に叩きつけられる轟音、扉の金属が擦れる甲高い悲鳴、管理人の叫びが同時に来て、重い 2 歩(仮声)', ['mgr_scream_03'], (K) => {
    const o = K.split(K.out, K.verb(1.0, 0.35, 0.5), 0.5);
    K.modal(0.05, [[2100, 0.03, 1]], 0.08);
    boom(K, 0.7, { vol: 1, f: 64, f2: 24, d: 0.9, crack: 1.0, to: K.sat(2.5, o) });
    steelPanel(K, 0.7, { vol: 0.85, base: 170, d: 1.2, to: o }); steelPanel(K, 0.78, { vol: 0.4, base: 210, d: 0.7, to: o });
    squeal(K, 0.7, 0.4, { f: 2300, fc: (u) => 1 - 0.25 * u, grit: 0.6, vol: 0.35, to: o });
    voxStack(K, 0.72, 'mgr_scream_03', [[0, 1.15, 0, 0.55], [0.012, 1.17, 18, 0.4]], { from: 0.7, loop: [1.0, 1.8], hold: 1.2, cents: (u) => 220 * u, jit: 40, jitHz: 3, rasp: 1.5, raspF: 1900, dry: 0.5, drive: 1.3, hp: 180, lp: 6500, vol: 0.85, to: o });
    softStep(K, 1.75, { vol: 1.1, to: o }); softStep(K, 2.35, { vol: 1.2, to: o });
  }, 'loud'),
  PV('b', '扉が二度叩きつけられる', 3, '扉が内側から蹴り開けられ「ガーン」、壁に当たって跳ね返りもう一度「ガン」。叫びがかぶさり、重い足が床に落ちる(仮声)', ['mgr_scream_04'], (K) => {
    const o = K.split(K.out, K.verb(1.0, 0.35, 0.5), 0.5);
    boom(K, 0.1, { vol: 0.85, f: 70, f2: 28, d: 0.6, crack: 0.9, to: K.sat(2, o) }); steelPanel(K, 0.1, { vol: 0.75, base: 180, d: 0.9, to: o });
    boom(K, 0.42, { vol: 0.6, f: 80, f2: 35, d: 0.4, crack: 0.7, to: K.sat(2, o) }); steelPanel(K, 0.42, { vol: 0.55, base: 150, d: 0.8, to: o });
    voxStack(K, 0.15, 'mgr_scream_04', [[0, 1.1, 0, 0.55], [0.015, 1.12, 20, 0.4]], { loop: [0.4, 1.2], hold: 1.3, cents: (u) => 180 * u, jit: 40, jitHz: 3, rasp: 1.8, raspF: 1600, dry: 0.45, hp: 160, lp: 6000, vol: 0.85, to: o });
    debris(K, 0.45, 0.6, { n: 8, f0: 1500, f1: 4000, vol: 0.12, to: o });
    softStep(K, 1.45, { vol: 1.2, to: o }); softStep(K, 2.05, { vol: 1.1, to: o });
  }, 'loud'),
  PV('c', '鋭く息を吸う→炸裂', 3, 'ロッカーの中で誰かが鋭く息を吸う。その直後、扉・叫び・床の低い衝撃が一度に炸裂する(仮声)', ['mgr_scream_01'], (K) => {
    const o = K.split(K.out, K.verb(1.1, 0.4, 0.5), 0.5);
    inhale(K, 0.0, 0.42, 0.7, K.muf(3000, 1, o), 1100);
    boom(K, 0.48, { vol: 1, f: 58, f2: 20, d: 1.2, crack: 1.0, to: K.sat(2.5, o) }); steelPanel(K, 0.48, { vol: 0.8, base: 170, d: 1.1, to: o });
    K.tn(0.48, 1.0, { f: 45, f2: 25, vol: 0.6, to: o });
    voxStack(K, 0.5, 'mgr_scream_01', [[0, 1.12, 0, 0.55], [0.013, 1.14, 18, 0.4]], { loop: [0.3, 1.2], hold: 1.4, cents: (u) => 250 * Math.min(1, u * 3), jit: 45, jitHz: 3, rasp: 1.5, raspF: 1800, dry: 0.5, drive: 1.3, hp: 180, lp: 6500, vol: 0.85, to: o });
    softStep(K, 1.7, { vol: 1.2, to: o });
  }, 'loud'),
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
  P('a', 'ピンを越えて重い「ガコン」', 1.6, '鍵が鍵穴のピンを「カチカチカチ」と越えて入り、回すと重いデッドボルトが「ガコン」と引っ込む', (K) => {
    for (let k = 0; k < 6; k++) K.modal(0.1 + k * 0.045 * K.rnd(0.8, 1.2), [[K.rnd(3800, 4600), 0.012, 1]], 0.15, K.out, 0.4);
    K.nz(0.1, 0.3, { f: 5000, q: 1.5, vol: 0.05, env: 'swell' });
    K.creak(0.5, 0.2, { rate: 150, f: 2200, q: 5, vol: 0.08 });
    K.tn(0.75, 0.1, { f: 180, f2: 110, vol: 0.55 }); K.modal(0.75, [[900, 0.06, 1], [1500, 0.05, 0.6], [2500, 0.03, 0.3]], 0.45, K.out, 0.7);
  }),
  P('b', '鍵束から選んで「カチッ」と開く', 1.6, '鍵束が鳴り、1 本を差して軽く「カチッ」。ノブが回って扉が少し開き、短く軋む', (K) => {
    jingle(K, 0.05, 0.3, 7, 0.2);
    K.nz(0.45, 0.12, { f: 4500, q: 1.5, vol: 0.08, env: 'swell' });
    K.modal(0.72, [[2600, 0.03, 1], [4000, 0.02, 0.4]], 0.35, K.out, 0.5);
    latch(K, 0.95, 0.35, 1700); K.creak(1.05, 0.35, { rate: 50, f: 650, q: 5, vol: 0.18 });
  }),
  P('c', '古い錠の引っかかり', 1.6, '錆びた鍵穴でザリザリと擦れ、2 度引っかかって止まり、3 度目に「ガチャン」と大きく噛み合う', (K) => {
    K.grains(0.05, 0.3, { rate: 140, len: 0.003, f: 3000, vol: 0.18 });
    for (const t of [0.45, 0.66]) { knock(K, t, { f: 260, d: 0.03, vol: 0.25, nf: 2000, nv: 0.2 }); K.modal(t, [[1700, 0.03, 1]], 0.15); }
    K.tn(0.95, 0.12, { f: 150, f2: 100, vol: 0.55 }); K.modal(0.95, [[1300, 0.07, 1], [2100, 0.05, 0.6], [3300, 0.03, 0.3]], 0.5, K.out, 0.8);
    K.modal(1.03, [[1500, 0.04, 1]], 0.15);
  }),
]);

// ---------------------------------------------------------------- 5. 312 無限の自室(異世界・P5b-4)。P4b 3 周目で新設(旧 312 プールの 6 場面は廃止)。
//  場面は docs/p5b4/NOTES.md「新 312 の音の場面案」。ゲームへの接続は 3 周目の選択の後(src/spaces/x312.js は今は WebAudio の仮音)
const X312C = 'spaces/x312.js(P5b-4。接続は 3 周目の選択の後)';
scene('amb_x312_room_loop', '312 無限の自室', '部屋の空気(312)', '312 の部屋(410 の複製)にいる間。冷蔵庫の低いうなり。消灯の R5 では小さく。', X312C, '50Hz のこぎり波 lowpass 140Hz', [
  P('a', '冷蔵庫(柔らかく)', 10, '台所の冷蔵庫の低く柔らかいうなり。音程はほとんど持たせず、ときどき中で小さく何かが鳴る', (K) => {
    K.bed(10, { color: 'brown', type: 'bandpass', f: 65, q: 1.2, vol: 0.35, lfo: [0.07, 0.3] }); K.bed(10, { color: 'pink', f: 300, vol: 0.04 });
    K.modal(4.2, [[1800, 0.03, 1], [2700, 0.02, 0.4]], 0.05); K.modal(8.1, [[1500, 0.03, 1]], 0.035);
  }, 'amb'),
  P('b', 'ほぼ無音(部屋の空気)', 10, '耳が慣れるほど静かな部屋。遠くの換気がかすかに流れ、一度だけ家が鳴る', (K) => {
    K.bed(10, { color: 'brown', f: 160, vol: 0.05 }); K.bed(10, { color: 'pink', type: 'bandpass', f: 500, q: 0.7, vol: 0.02, lfo: [0.1, 0.5] });
    houseCreak(K, 5.5, 0.15);
  }, 'amb'),
  P('c', '冷蔵庫が止まる', 10, '冷蔵庫のうなりが続き、「カチッ」と止まって静かになる。しばらくして「カチッ」とまた動き出す', (K) => {
    K.bed(6.5, { color: 'brown', type: 'bandpass', f: 62, q: 1.6, vol: 0.38, fade: 0.25 });
    K.bed(0.9, { t: 9.1, color: 'brown', type: 'bandpass', f: 62, q: 1.6, vol: 0.38, fade: 0.6 });
    K.modal(6.35, [[1900, 0.03, 1], [3100, 0.02, 0.4]], 0.12); K.modal(9.05, [[1900, 0.03, 1], [3100, 0.02, 0.4]], 0.1);
    K.bed(10, { color: 'brown', f: 140, vol: 0.03 });
  }, 'amb'),
]);
scene('x312_clock_tick', '312 無限の自室', '時計の秒', '壁の時計の秒針(R1・R2 だけ。R3 で止む = 止まった時計の合図)。ゲームでは 1 秒ごとに 1 打。', X312C, '0.025 秒のクリック', [
  P('a', '静かな秒針「チッ」', 4, '壁掛けのクオーツ時計。小さく乾いた「チッ」が 1 秒ごと', (K) => { for (let i = 0; i < 4; i++) { K.nz(0.2 + i, 0.003, { type: 'highpass', f: 3500, vol: 0.25 }); K.modal(0.2 + i, [[3200, 0.015, 1], [5100, 0.01, 0.4]], 0.25, K.out, 0); } }),
  P('b', '「カチ・コチ」', 4, '一打ごとに少し音の高さが違う「カチ」「コチ」。古い掛け時計', (K) => { for (let i = 0; i < 4; i++) { const f = i % 2 ? 2100 : 2700; K.modal(0.2 + i, [[f, 0.025, 1], [f * 1.6, 0.015, 0.4]], 0.3, K.out, 0.2); K.tn(0.2 + i, 0.03, { f: 420, f2: 300, vol: 0.06 }); } }),
  P('c', '置時計(少し響く)', 4, '箱の中で鳴る少し低めの「コッ」が、部屋に小さく響く', (K) => { const o = K.split(K.out, K.verb(1.0, 0.3, 0.5), 0.5); for (let i = 0; i < 4; i++) { K.modal(0.2 + i, [[1700, 0.03, 1], [2900, 0.02, 0.4]], 0.25, o, 0.2); K.tn(0.2 + i, 0.05, { f: 520, f2: 380, vol: 0.12, to: o }); } }),
]);
scene('x312_door_open', '312 無限の自室', '奥の扉が開く', 'R1〜の奥の扉(元は窓の所)を開ける。', X312C, '軋み＋短いノイズ', [
  P('a', '「ガチャッ」→ゆっくり開く', 2.5, 'ラッチの「ガチャッ」の後、蝶番が低くゆっくり軋みながら開く', (K) => { const o = K.split(K.out, K.verb(0.4, 0.15, 0.5), 0.3); latch(K, 0.1, 0.5, 1600, o); K.creak(0.3, 1.3, { rate: 35, rate2: 20, f: 520, q: 5, vol: 0.28, to: o }); K.nz(0.3, 1.2, { color: 'brown', type: 'lowpass', f: 260, vol: 0.15, env: 'swell', to: o }); }),
  P('b', '静かに開く', 2.5, 'ラッチの小さな音と、扉が空気を押す気配だけ', (K) => { latch(K, 0.1, 0.35, 1700); K.nz(0.25, 1.2, { color: 'brown', type: 'lowpass', f: 380, vol: 0.18, env: 'swell' }); }),
  P('c', '長い軋み', 2.5, 'ラッチの後、扉の重みで蝶番が細く長く「ギィィ」と鳴り続ける', (K) => { const o = K.split(K.out, K.verb(0.5, 0.2, 0.5), 0.35); latch(K, 0.1, 0.45, 1500, o); squeal(K, 0.3, 1.7, { f: 620, fc: (u) => 1 - 0.15 * u, grit: 0.45, jit: 0.025, vol: 0.3, to: o }); }),
]);
scene('x312_door_close', '312 無限の自室', '扉が閉まる(ひとりでに)', '通ってきた扉が閉まる(ひとりでに閉まる時も)。', X312C, '低いノイズ', [
  P('a', '「バタン」', 2, '扉が枠に当たる「バタン」とラッチの「カチャ」', (K) => { const o = K.split(K.out, K.verb(0.5, 0.2, 0.5), 0.35); doorHit(K, 0.1, 0.9, o); latch(K, 0.11, 0.45, 1600, o); }),
  P('b', '静かに「カチャン」', 2, '音を立てずに閉まり、ラッチだけが「カチャン」と掛かる', (K) => { knock(K, 0.1, { f: 110, d: 0.06, vol: 0.25, nf: 800, nv: 0.1 }); latch(K, 0.12, 0.5, 1700); }),
  P('c', '背後で閉まる(こもる)', 2, '少し離れた背後で扉が閉まり、壁越しにこもって響く', (K) => { const o = K.split(K.muf(700, 1), K.verb(1.4, 0.5, 0.6), 0.6); doorHit(K, 0.1, 0.9, o); latch(K, 0.11, 0.4, 1500, o); }),
]);
scene('x312_door_locked', '312 無限の自室', '扉が開かない', 'R5 の奥・入り直した時の奥の扉で E(開かない)。', X312C, 'story の rattle', [
  P('a', '「ガチッ」と止まる', 1.5, 'ノブは回るがボルトが受けに当たって「ガチッ」と止まる', (K) => { K.grains(0.05, 0.08, { rate: 200, len: 0.002, f: 2400, vol: 0.12 }); K.modal(0.15, [[1300, 0.05, 1], [2100, 0.03, 0.5]], 0.35, K.out, 0.6); knock(K, 0.15, { f: 140, d: 0.05, vol: 0.4, nf: 1200, nv: 0.2 }); }),
  P('b', '枠で 2 回鳴る', 1.5, '引いても開かず、扉が枠の中で 2 回「ガタン」と鳴る', (K) => { doorHit(K, 0.1, 0.55); latch(K, 0.1, 0.25, 1500); doorHit(K, 0.42, 0.45); }),
  P('c', '重い手応え', 1.5, '鍵の掛かった重い扉。ノブがわずかに動いて鈍い「ゴッ」で止まる', (K) => { K.creak(0.05, 0.12, { rate: 250, f: 1800, q: 3, vol: 0.08 }); knock(K, 0.18, { f: 90, d: 0.1, vol: 0.55, nf: 600, nv: 0.15 }); K.modal(0.18, [[1100, 0.04, 1]], 0.15); }),
]);
scene('x312_key_slam', '312 無限の自室', '鍵を取ると玄関の扉が閉まる', 'R5 の机で 105 の鍵を取った瞬間、背後で玄関の扉が閉まる。', X312C, '低いノイズ＋40Hz のうなり', [
  P('a', '遠くで「バーン」', 3, '部屋の向こう(玄関)で扉が叩きつけられ、廊下に響く', (K) => { const o = K.split(K.muf(1500, 1), K.verb(1.8, 0.55, 0.6), 0.6); doorHit(K, 0.1, 1.0, o); boom(K, 0.1, { vol: 0.4, f: 70, f2: 35, d: 0.5, crack: 0.3, to: o }); latch(K, 0.12, 0.4, 1500, o); }),
  P('b', '部屋ごと揺れる', 3, '扉が閉まる衝撃で部屋全体が低く揺れ、棚の物がかすかに鳴る', (K) => { const o = K.split(K.out, K.verb(1.2, 0.4, 0.6), 0.5); doorHit(K, 0.1, 0.9, K.muf(1200, 1, o)); boom(K, 0.1, { vol: 0.7, f: 50, f2: 25, d: 1.0, crack: 0.2, to: o }); for (let i = 0; i < 5; i++) K.modal(0.15 + K.rnd(0, 0.3), [[K.rnd(1500, 3500), 0.04, 1]], 0.04, o, 0.2); }),
  P('c', '閉まる→鍵が掛かる', 3, '玄関の扉が閉まり、少しして外から鍵が掛かる「カチャン」', (K) => { const o = K.split(K.muf(1800, 1), K.verb(1.2, 0.4, 0.6), 0.5); doorHit(K, 0.1, 0.85, o); latch(K, 0.11, 0.4, 1600, o); K.modal(0.85, [[1900, 0.05, 1], [2800, 0.04, 0.5]], 0.3, o, 0.5); knock(K, 0.86, { f: 300, d: 0.03, vol: 0.2, nf: 2000, nv: 0.15, to: o }); }),
]);
scene('x312_watcher_lookup', '312 無限の自室', '管理人が顔を上げる', 'R5 でベッド脇に座った管理人に懐中電灯を当てると、顔を上げてこちらを見る。', X312C, '三角波 180→150Hz＋息', [
  P('a', '衣擦れと首の鳴り', 2.5, '服が擦れる音と、首の骨がかすかに鳴る小さな音。ゆっくり息を吐く', (K) => { K.nz(0.1, 0.5, { color: 'pink', f: 2200, q: 0.6, vol: 0.18, env: 'swell' }); K.modal(0.45, [[900, 0.03, 1], [1600, 0.02, 0.4]], 0.08, K.out, 0.3); exhale(K, 0.9, 1.2, 0.2, K.out, 650); }),
  P('b', '低く息を吸う', 2.5, '顔を上げながら、鼻から低くゆっくり息を吸う', (K) => { inhale(K, 0.2, 1.2, 0.3, K.out, 700); }),
  P('c', '静寂に心拍が一つ', 2.5, '何も鳴らない中で、自分の心拍が一度だけ', (K) => { K.bed(2.5, { color: 'brown', f: 70, vol: 0.03 }); heart(K, 0.8, 0.6); }, 'quiet'),
]);
scene('x312_room_shift', '312 無限の自室', '振り返った時の小さな気配', '通ってきた扉が移った後に振り返った時の小さな気配(案)。', X312C, 'なし', [
  P('a', '家鳴り一つ', 3, '部屋のどこかで木が一度だけ軋む', (K) => { houseCreak(K, 0.5, 0.35); }),
  P('b', '遠くで扉が閉まる', 3, 'ずっと遠くの部屋で、扉がそっと閉まる音', (K) => { const o = K.split(K.muf(500, 1), K.verb(2.0, 0.6, 0.6), 0.7); knock(K, 0.3, { f: 100, d: 0.08, vol: 0.4, nf: 600, nv: 0.1, to: o }); latch(K, 0.31, 0.25, 1400, o); }),
  P('c', '耳がつまる', 3, '気圧が変わったように耳が一瞬つまり、戻る', (K) => { K.tn(0.1, 2.6, { f: 28, vol: 0.5, env: 'swell', p: 0.6 }); K.bed(2.8, { color: 'brown', f: 60, vol: 0.25, lfo: [0.3, 0.8] }); }, 'quiet'),
]);
scene('x312_bed_creak', '312 無限の自室', 'ベッドの軋み', 'R5 で管理人が座っているベッドの軋み(近づくと)(案)。', X312C, 'なし', [
  P('a', 'スプリングの軋み', 2.5, 'マットレスのばねが体重で「ギシ」と鳴り、小さく震える', (K) => { K.creak(0.2, 0.4, { rate: 60, rate2: 30, f: 900, q: 6, vol: 0.3 }); K.modal(0.25, [[440, 0.25, 1], [910, 0.15, 0.4]], 0.06, K.out, 0); }),
  P('b', '木枠の軋み', 2.5, 'ベッドの木の枠が低くゆっくり軋む', (K) => { K.creak(0.2, 0.8, { rate: 30, rate2: 15, f: 380, q: 4, vol: 0.4 }); }),
  P('c', '体重を移す軋みと布擦れ', 2.5, '座り直すように体重が移り、軋みと掛け布団の擦れる音', (K) => { K.creak(0.2, 0.5, { rate: 45, rate2: 25, f: 500, q: 5, vol: 0.3 }); K.nz(0.3, 0.8, { color: 'pink', f: 2500, q: 0.6, vol: 0.15, env: 'swell' }); }),
]);

// ---------------------------------------------------------------- 6. 105 長い廊下(異世界)
scene('amb_x105', '105 長い廊下', '105 の廊下(灯具のうなり)', '105 の中。灰色の均質な廊下を進むほど灯具のうなりが大きくなり、消えた灯りの所で弱まる。', 'spaces/x105.js sound(st.hum)', 'x105_hum_loop_01', [
  P('a', '蛍光灯のうなり', 10, '100Hz の蛍光灯のうなりと安定器の細かい音。昔の廊下', (K) => { K.tn(0, 10, { type: 'sawtooth', f: 100, vol: 0.12, env: 'flat', lpf: 900 }); K.tn(0, 10, { f: 200, vol: 0.05, env: 'flat' }); K.grains(0, 10, { rate: 8, len: 0.003, f: 4000, vol: 0.04 }); }, 'amb'),
  P('b', '遠くで唸る', 10, '音程のはっきりしない低い唸りが、廊下の奥からゆっくり寄せる', (K) => { K.bed(10, { color: 'brown', type: 'bandpass', f: 120, q: 2, vol: 0.4, lfo: [0.05, 0.6] }); K.tn(0, 10, { f: 50, vol: 0.06, env: 'swell', p: 0.5 }); }, 'amb'),
  P('c', '長すぎる廊下の静けさ', 10, 'ほぼ無音。遠くの小さな音が異様に長く響いて戻る', (K) => { K.bed(10, { color: 'brown', f: 100, vol: 0.05 }); const v = K.verb(3.5, 0.9, 0.7); const e = K.echo(0.6, 0.45, 1500, K.out); for (const t of [3, 7]) K.modal(t, [[3000, 0.05, 1]], 0.15, K.split(K.split(K.out, v, 1), e, 0.6)); }, 'amb'),
]);
scene('x105_scream', '105 長い廊下', '遠い悲鳴(追跡の始まり)', '105 でしばらく進むと後ろから管理人が悲鳴を上げて追ってくる。B1 の戻りの遠い悲鳴にも使う。', 'spaces/x105.js update(scream)／spaces/xb1.js sound(遠い悲鳴)', 'x105_scream_01・xb1_scream_far_01', [
  PV('a', '声そのまま・奥から響く', 4.5, '背後のはるか奥で、人の声の悲鳴が上ずって裏返る。揺れる音程と歪みで機械っぽさを消し、廊下に長く響く(仮声)', ['mgr_scream_01'], (K) => {
    const v = K.verb(3.0, 0.8, 0.6), e = K.echo(0.35, 0.35, 2000, K.out), o = K.split(K.split(K.gain(0.6, K.out), v, 1), e, 0.5);
    K.vox(0.1, 'mgr_scream_01', { loop: [0.3, 1.2], hold: 2.6, rate: 1.35, cents: (u) => 300 * Math.min(1, u * 5) - 500 * Math.max(0, u - 0.75) / 0.25, jit: 70, vib: 5.5, vibd: 40, drive: 5, hp: 220, lp: 3000, vol: 0.9, to: o });
  }),
  PV('b', '声＋ノイズ・かすれた悲鳴', 4, '喉が裂けるようなかすれた悲鳴。声で変調したノイズが強く、息の音が前に出る(仮声)', ['mgr_scream_03'], (K) => {
    const o = K.split(K.gain(0.7, K.out), K.verb(2.5, 0.7, 0.6), 1);
    K.vox(0.1, 'mgr_scream_03', { from: 0.7, loop: [1.0, 1.8], hold: 2.4, rate: 1.4, cents: (u) => 200 * u, jit: 60, vib: 6, vibd: 25, drive: 3, rasp: 1.2, raspF: 2400, hp: 250, lp: 3500, vol: 0.85, to: o });
    K.nz(0.2, 2.2, { color: 'pink', f: 1800, q: 0.7, vol: 0.06, env: 'swell', to: o });
  }),
  PV('c', '声を遠く反響・はるか奥', 5.5, 'ずっと奥で短く一声、間を置いてもう一声。ほとんど残響だけが届く。P4b: メモ「もっと機械音感をなくしたい」で歪みを弱め、息の混じった喉のかすれを主に、声を 2 本ずらして重ね、音程の揺れを遅いうねりに(加工は src/audio_voice.js)(仮声)', VOICE.x105_scream.takes[0], (K) => VOICE.x105_scream.fn(K, VOICE.x105_scream.takes[0])),
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
  P('a', '門のレールを越える', 8, '舗装の上の低い走行音とエンジン。門のレールを前輪・後輪が「ゴトン、ゴトン」と越え、遠ざかって消える(砂利の音なし)', (K) => {
    const env = (u) => (u < 0.55 ? Math.min(1, u * 6) : Math.pow((1 - u) / 0.45, 1.6)), g = K.shape(0, 8, 1, env, K.out);
    engine(K, 0, 8, (u) => 1100 + 400 * Math.min(1, u * 2), { cyl: 4, f: 280, vol: 0.45, to: g });
    tireRoll(K, 0, 8, { vol: 0.35, f: 280, to: g });
    for (const t of [3.2, 3.58]) { knock(K, t, { f: 60, d: 0.2, vol: 0.7, nf: 400, nv: 0.2, to: g }); K.modal(t + 0.01, [[300, 0.4, 1], [760, 0.3, 0.5], [1400, 0.2, 0.25]], 0.15, g, 0.3); K.creak(t + 0.05, 0.25, { rate: 50, f: 400, q: 4, vol: 0.08, to: g }); }
    K.bed(8, { color: 'pink', f: 500, vol: 0.03 });
  }),
  P('b', '鉄の門の脇を抜けて後ろで閉まる', 8, '車が開いた鉄の門の脇を抜けると、門が振動でビリつき、少しして後ろで「ガシャン」と閉まる音が遠く響く', (K) => {
    const g = K.shape(0, 8, 1, (u) => (u < 0.4 ? Math.min(1, u * 6) : Math.pow((1 - u) / 0.6, 1.4)), K.out);
    engine(K, 0, 8, () => 1400, { cyl: 4, f: 300, vol: 0.45, to: g }); tireRoll(K, 0, 8, { vol: 0.3, f: 300, to: g });
    for (let t = 2.4; t < 3.4; t += 1 / K.rnd(14, 20)) K.modal(t, [[K.rnd(600, 900), 0.05, 1], [K.rnd(1500, 2000), 0.03, 0.4]], 0.05, K.out, 0.2);
    const far = K.split(K.muf(2000, 0.7), K.verb(2.0, 0.7, 0.6), 1);
    K.creak(4.4, 0.8, { rate: 25, f: 380, f2: 820, q: 6, vol: 0.25, to: far }); steelPanel(K, 5.3, { vol: 0.5, base: 140, d: 1.2, to: far }); K.modal(5.31, [[1400, 0.1, 1], [2300, 0.08, 0.5]], 0.3, far, 0.5);
  }),
  P('c', '車内のこもった走行音→静寂', 8, '車内から聞く低くこもった走行音。門の段差で車体が一度「ドン」と揺れ、音がゆっくり引いて夜風だけが残る。P4b: メモ「ジャリジャリ感をなくして」でエンジンを点火の粒の無い滑らかなうなりに替え、タイヤの音を低く丸め、段差の軋みを外した', (K) => {
    const g = K.shape(0, 6.5, 1, (u) => (u < 0.6 ? Math.min(1, u * 8) : Math.pow((1 - u) / 0.4, 1.3)), K.muf(260, 1));
    smoothEngine(K, 0, 6.5, (u) => 1300 + 200 * u, { cyl: 4, f: 220, vol: 0.6, to: g });
    K.bed(6.5, { color: 'brown', type: 'lowpass', f: 140, vol: 0.35, fade: 0.4, to: g });      // タイヤの低いうなり(粒なし)
    K.tn(3.5, 0.3, { f: 55, f2: 40, vol: 0.6 }); K.nz(3.5, 0.15, { color: 'brown', type: 'lowpass', f: 300, vol: 0.3 });
    K.bed(3.5, { t: 4.5, color: 'pink', f: 450, vol: 0.06, lfo: [0.2, 0.7], fade: 1.2 });
  }),
]);

// P4a-2: 候補を作り直した場面(ユーザーが「作り直し」を選んだもの)。試聴盤は pick が redo のままなら「作り直し済み・再選択」と出す
export const REDONE = { pl_step_corridor: 'P4a-3 2 周目(本物の靴音に寄せる)', room_fall: 'P4a-2 作り直し(パリーンと割れる)' };
// P4a-3(2 周目): 2026-11-01 の選択で「作り直し」になった 20 場面。候補をすべて新しくした(旧候補は消した。履歴は docs/p4a/sounds.md)
export const ROUND2 = ['pl_flashlight', 'door_wood', 'pl_step_corridor', 'door_locked', 'pl_peephole', 'enemy_presence', 'enemy_step_walk', 'enemy_step_run',
  'enemy_breath_close', 'enemy_breath_door', 'enemy_handle', 'room_door_rattle', 'enemy_door_smash', 'enemy_scream', 'enemy_hit', 'locker_open_slow',
  'locker_burst', 'key_unlock', 'x105_scream', 'ending_gate'];
for (const id of ROUND2) if (!REDONE[id]) REDONE[id] = 'P4a-3 2 周目';
// P4b(3 周目・2026-11-02): 2 周目の選択で「作り直し」6 場面と「なし＋メモ」3 場面の候補を新しくし(旧候補は消した。履歴は docs/p4a/sounds.md)、
//  新 312(無限の自室)の場面を足した。from = 2 周目の答え、note = その時のメモ(試聴盤は pick がこの答えのままなら「3 周目・選んでください」と出す)
export const ROUND3 = {
  pl_flashlight: { from: 'redo', note: 'カチッという音' },
  door_wood: { from: 'redo', note: 'がちゃっというような単純な音でいい' },
  enemy_presence: { from: 'none', note: 'なにかぼそぼそ呟いてる' },
  enemy_step_walk: { from: 'redo', note: '金属音感をなくして' },
  enemy_breath_close: { from: 'redo', note: 'みいつけたで、ただまだ機械音感がする' },
  room_door_rattle: { from: 'redo', note: '機械音感をなくして' },
  enemy_scream: { from: 'redo', note: '機械音感をなくして' },
  locker_open_slow: { from: 'none', note: 'キイという音がいい' },
  locker_burst: { from: 'none', note: 'もっと驚かせる音で' },
  amb_x312_room_loop: { from: 'new' }, x312_clock_tick: { from: 'new' }, x312_door_open: { from: 'new' }, x312_door_close: { from: 'new' },
  x312_door_locked: { from: 'new' }, x312_key_slam: { from: 'new' }, x312_watcher_lookup: { from: 'new' }, x312_room_shift: { from: 'new' }, x312_bed_creak: { from: 'new' },
};
for (const id of Object.keys(ROUND3)) REDONE[id] = 'P4b 3 周目';
// P4c(2026-11-02): 3 周目の結果をゲームに反映した場面(場面 → 結果)。'a' = 3 周目の候補 A を採用(wav に書いて接続)、'none' = なし(仮音を消して無音)。
//  ユーザーの所見「作り直しのものは全て機械音感がすごい」で、足音以外はすべてなし。room_door_rattle は pick が redo(メモ「扉のガタガタ演出自体を無くす」)だが、
//  演出ごと無くす(動きの削除は P5b-6)ので音はなし扱い。新 312 の 9 場面は未選択のまま(ここに無い = 選ばれたら接続する)
export const ROUND3_DONE = {
  enemy_step_walk: 'a',
  pl_flashlight: 'none', door_wood: 'none', enemy_breath_close: 'none', enemy_scream: 'none', enemy_presence: 'none', locker_open_slow: 'none', locker_burst: 'none',
  room_door_rattle: 'none',
  // P4d(2026-11-02): 新 312 の 9 場面はすべて「なし」(最終選択では amb_x312_room_loop だけ未選択だったが、その後ユーザーが試聴盤で「なし」を押した)。
  //  'unselected' = 未選択のまま(ゲームでは無音 = なし扱い。選ばれたら接続する)も書き出しと試聴盤が扱える
  x312_clock_tick: 'none', x312_door_open: 'none', x312_door_close: 'none', x312_door_locked: 'none', x312_key_slam: 'none', x312_watcher_lookup: 'none',
  x312_room_shift: 'none', x312_bed_creak: 'none', amb_x312_room_loop: 'none',
};
// P4d: 3 周目以外でゲームに反映した場面(場面 → 結果)。xb1_loop_notice = 候補 C「耳鳴りと金属の一打」を wav に書いて B1 の標識灯(spaces/xb1.js)へ接続
export const P4D_DONE = { xb1_loop_notice: 'c' };
// P4b: 採用のままメモの方向へ調整した候補(場面 → 説明)。ゲームの wav はこの調整後の音
export const ADJUSTED = {
  room_fall: 'A を調整(パリーン！と割れる)', enemy_step_run: 'C を調整(もっと大きくドタバタ)', enemy_breath_door: 'B に笑い・台詞を 2 本追加',
  enemy_door_smash: 'C を調整(爆発のように)', enemy_hit: 'A を調整(もっと重く)', x105_scream: 'C を調整(機械音感をなくす)', ending_gate: 'C を調整(ジャリジャリ感をなくす)',
};

// ================================================================ ゲーム用の書き出し(P4b。tools/build_audio.sh が使う)
// 採用候補(sound_choice.json の pick)を assets/audio/<場面 ID>.wav に書く時の切り方。ここに無い採用場面は候補をそのまま 1 本の効果音として書く。
//  loop   = 環境音のループ(頭と尻を等パワーで重ねて継ぎ目を消す。xfade 秒)
//  sprite = 1 歩ずつ鳴らす足音: 同じ形の n 通り(毎回ゆらす)を slot 秒おきに並べた 1 本。ゲームは鳴らすたびに 1 区画を選ぶ
//  segs   = 1 本の中の区間に名前を付ける(ゲームは名前で区間だけ鳴らす)
//  voice  = 声の場面。wav に焼かず、ゲームが鳴らす時に素材(assets/audio/tts)へ src/audio_voice.js の加工を掛ける
export const GAME = {
  sr: 22050,
  scenes: {
    pl_step_room: { sprite: { n: 4, slot: 0.4 }, step: (K, t, i) => {
      const acc = i % 2 ? 0.82 : 1;
      K.tn(t, 0.07, { f: 120 * K.rnd(0.9, 1.1), f2: 80, vol: 0.4 * acc, lpf: 600 }); K.nz(t, 0.04, { type: 'lowpass', f: 600 * K.rnd(0.9, 1.1), vol: 0.15 * acc });
    } },
    // P4c: 管理人の歩き = 3 周目 A「ゴム底の重い足音」の一歩(softStep・同じ残響)を 4 通り。歩幅は AI の接地が決めるので 1 歩ずつ
    enemy_step_walk: { sprite: { n: 4, slot: 0.7 }, step: (K, t, i) => softStep(K, t, { vol: 0.85 * (i % 2 ? 0.82 : 1), heel: 650, scuff: 0.3, to: K.split(K.out, K.verb(0.5, 0.2, 0.6), 0.45) }) },
    enemy_step_run: { sprite: { n: 4, slot: 0.55 }, step: (K, t, i) => runStomp(K, t, i % 2 ? 0.92 : 1.05, K.split(K.out, K.verb(0.5, 0.18, 0.5), 0.4), i === 2) },
    pl_closet: { segs: { open: [0, 0.75], close: [1.7, 3.0] } },
    // 落ちる物: 割れ物(花瓶・マグ・コップ・瓶)は採用 A(パリーン)。本・ファイルと缶は割れないので、A と同じ残響の作りで派生させた区間を同じ 1 本に並べる(sounds.md の申し送り)
    room_fall: { parts: [['glass', null], ['books', 1.3, (K) => {
      const o = K.split(K.out, K.verb(0.8, 0.28, 0.4), 0.45);
      knock(K, 0.05, { f: 110, d: 0.1, vol: 0.7, nf: 900, nv: 0.35, to: o }); K.nz(0.05, 0.06, { color: 'pink', type: 'lowpass', f: 1800, vol: 0.5, to: o });
      paper(K, 0.08, 0.3, 0.22, 1, o); knock(K, 0.21, { f: 130, d: 0.07, vol: 0.4, nf: 1100, nv: 0.25, to: o }); knock(K, 0.42, { f: 150, d: 0.05, vol: 0.18, nf: 1200, nv: 0.1, to: o });
    }], ['cans', 1.8, (K) => {
      const o = K.split(K.out, K.verb(0.8, 0.28, 0.4), 0.45);
      for (const [t, v] of [[0.05, 1], [0.21, 0.6], [0.33, 0.45], [0.5, 0.3], [0.63, 0.2], [0.72, 0.12]]) { const f = K.rnd(1900, 2600); K.modal(t, [[f, 0.07, 1], [f * 2.7, 0.04, 0.5], [f * 0.55, 0.06, 0.4]], 0.35 * v, o, 0.6); knock(K, t, { f: 300, d: 0.02, vol: 0.12 * v, nf: 2500, nv: 0.1, to: o }); }
      K.grains(0.6, 0.9, { rate: 30, len: 0.004, f: 2200, vol: 0.08, p: 1.5, to: o });
    }]], types: { vase: 'glass', mug: 'glass', cup: 'glass', bottle: 'glass', books: 'books', binders: 'books', cans: 'cans' } },
    amb_corridor: { loop: true, xfade: 2 }, ev_motor: { loop: true, xfade: 1.5 }, amb_x105: { loop: true, xfade: 2 },
    amb_outdoor: { loop: true, xfade: 2 }, amb_roof: { loop: true, xfade: 2 }, amb_b1: { loop: true, xfade: 2 },
    enemy_breath_door: { voice: true }, x105_scream: { voice: true },
  },
};
for (const sc of S) { if (REDONE[sc.id]) sc.redone = REDONE[sc.id]; if (ROUND2.includes(sc.id)) sc.round = 2; if (ROUND3[sc.id]) { sc.round = 3; sc.r3 = { ...ROUND3[sc.id], ...(ROUND3_DONE[sc.id] ? { done: ROUND3_DONE[sc.id] } : {}) }; } if (ADJUSTED[sc.id]) sc.adjusted = ADJUSTED[sc.id]; if (P4D_DONE[sc.id]) sc.p4d = P4D_DONE[sc.id]; }

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
  await prepare(cand);   // 声の素材(tts)を使う候補は先に読み込む
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
