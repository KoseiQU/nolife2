// audio_voice.js — 声の場面の「素材＋加工」(P4b)。声は wav に焼き込まず、ゲームが鳴らす時に素材(assets/audio/tts/<ID>.wav)へこの加工を掛ける。
//  - 素材 = 台詞表 docs/lines.md の ID。ユーザーの録音を同じ名前の wav で置けば、加工はそのまま録音に掛かる(tools/build_audio.sh の再実行は不要)。
//  - 加工 = Kit(src/audio_kit.js)で組む関数 fn(K, take, P)。試聴盤(samples/sound_lib.js の採用候補・「録音の聞こえ方」)とゲーム(src/audio_bank.js の voice)が同じ関数を使う。
//  - takes = 1 回の再生で使う素材の組。ゲームは鳴らすたびに順に回す(同じ台詞が続かない)。
//  - 音量は src/audio_bank.js が読み込み時に 1 度オフラインで描いて揃える(kind の基準: sfx はピーク −6dBFS・RMS −18、loud は −3/−15)。
//
// P4e-1: 録音プロファイル。assets/audio/tts/recorded.txt にある ID(tools/import_rec.sh が記録)は「録音」とみなし、仮声用の加工(低く遅く・rasp・jit・len で切る)を使わない。
//  P(line) = その素材の聞こえ方: null = 仮声(従来の加工)/ 'A' 素のまま / 'B' 軽い加工(既定)/ 'C' 強い加工(仮声と同じ数値)。
//  A/B/C の選択は試聴盤の「録音の聞こえ方」で選び、samples/sound_choice.json の rec_fx[ID] に保存される(未選択は B)。
//  A・B・C どれでも、場面ごとの空間処理(扉越し・目の前・はるか奥)は同じものを掛け、素材は全長を使う(切らない)。数値の表は docs/p4e1/NOTES.md。
import { TTS } from './audio_kit.js';

// ================================================================ 録音の状態(recorded.txt と rec_fx の選択)
export const REC_FX = ['A', 'B', 'C'];
export const REC_FX_DEFAULT = 'B';
export const REC = { ids: new Set(), fx: {}, from: null, loaded: false };
// 録音プロファイルの数値(場面の空間処理の前に素材へ掛ける。C は場面ごとの仮声の数値。len は使わない=切らない)
export const REC_PROFILE = {
  A: { rate: 1.0, hp: 80 },          // 素のまま: 空間処理だけ
  B: { rate: 0.9, hp: 80 },          // 軽い加工: わずかに低く遅く(rasp・jit・歪みなし)
};
const RECORDED_URL = new URL('../assets/audio/tts/recorded.txt', import.meta.url);
const CHOICE_URL = new URL('../samples/sound_choice.json', import.meta.url);

// 素材の聞こえ方。録音でなければ null(仮声の加工)
export function recFx(line) {
  if (!REC.ids.has(line)) return null;
  const f = String(REC.fx[line] || '').toUpperCase();
  return REC_FX.includes(f) ? f : REC_FX_DEFAULT;
}
// recorded.txt と選択を読む。選択は samples/sound_choice.json の rec_fx(試聴盤が保存。build なしで即反映)→ 無ければ manifest.rec_fx(tools/build_audio.sh が写す)→ 無ければ B
export async function loadRec({ manifest = null, choice = undefined } = {}) {
  const ids = new Set();
  try {
    const r = await fetch(RECORDED_URL, { cache: 'no-store' });
    if (r.ok) for (const s of (await r.text()).split(/\r?\n/)) { const id = s.trim(); if (id && !id.startsWith('#')) ids.add(id); }
  } catch (e) { /* 録音なし */ }
  let fx = null, from = 'default';
  if (choice !== undefined) { fx = choice; from = 'arg'; }
  else {
    try {
      const r = await fetch(CHOICE_URL, { cache: 'no-store' });
      if (r.ok) { const d = await r.json(); if (d && d.rec_fx && typeof d.rec_fx === 'object') { fx = d.rec_fx; from = 'sound_choice.json'; } }
    } catch (e) { /* 試聴盤の選択が無い(配布版など) */ }
    if (!fx && manifest && manifest.rec_fx) { fx = manifest.rec_fx; from = 'manifest'; }
  }
  REC.ids = ids; REC.fx = { ...(fx || {}) }; REC.from = from; REC.loaded = true;
  return REC;
}

// 1 本の素材を鳴らす。tts = 仮声の数値(従来の加工)、to = 仮声の出口、rto = 録音の出口(場面の空間処理。無ければ to)、c = 強い加工(C)で仮声の数値に重ねる上書き
// 戻り値: 鳴る長さ(秒)
function say(K, t, line, P, tts, rto, c = {}) {
  const f = P(line);
  if (!f) return K.vox(t, line, tts);
  const { len, to, ...ttsRest } = tts;   // 録音は切らない(len を使わない)
  const o = f === 'C' ? { ...ttsRest, ...c } : { ...REC_PROFILE[f], vol: tts.vol ?? 0.8, rel: 0.15 };
  return K.vox(t, line, { ...o, to: rto || to });
}

// 1 回の再生で使う長さの見積もり(オフラインで描く長さ・後片付けの時刻。素材の全長 ÷ 一番遅い再生速度 0.7 ＋ 残響の尾)
export function voiceSpan(id, take) {
  const V = VOICE[id];
  let s = 0;
  for (const l of take) { const b = TTS.get(l); s += (b ? b.duration : 3) / 0.7 + 0.6; }
  return Math.max(V.dur, s + 2.5);
}

export const VOICE = {
  // 扉の向こう(潜伏中の空き部屋の扉の前で立ち止まると)。採用 B「いるのは…わかってるよ」＋ユーザーのメモ「息遣いではなく、笑い声かセリフに」で
  // 短い笑い・台詞を 2 本足して 3 本を順に回す。仮声の加工は B のまま(扉板越しのこもり＝lowpass 800Hz＋扉板の 240Hz の山、0.74 倍で低く遅く、囁きのかすれ)
  // P4e-1: 録音は、扉の向こうの部屋の残響(0.7 秒)→ 同じ扉板のこもり。距離はゲームの位置音(扉の位置・ref 1.0)
  enemy_breath_door: {
    kind: 'sfx', dur: 4.4,
    takes: [['mgr_line_know_01'], ['mgr_door_laugh_01'], ['mgr_door_line_02']],
    space: '扉越し(部屋の残響 0.7 秒 → 扉板の 240Hz の山＋lowpass 800Hz)',
    fn: (K, [line], P = recFx) => {
      const door = K.filt('peaking', 240, 2, K.muf(800, 1), 6);
      const room = P(line) ? K.split(door, K.verb(0.7, 0.3, 0.6, door), 0.4) : null;
      return 0.05 + say(K, 0.05, line, P, { rate: 0.74, len: 3.0, lp: 1000, rasp: 0.3, jit: 25, vol: 1, to: door }, room);
    },
  },
  // P4e-1: 目の前(隠れたクローゼットの前で管理人が立ち止まり、焦らす時)。3 周目は「なし」だったが、ユーザーの録音「みぃつけた」で復活。
  //  仮声の加工 = 3 周目の候補 A の数値(息だけの囁き＋低い芯)。録音は、耳元の近さ(180Hz の低域を +4dB)＋わずかな残響(0.3 秒)
  enemy_breath_close: {
    kind: 'sfx', dur: 3.5,
    takes: [['mgr_line_found_01']],
    space: '目の前(耳元の近さ = 180Hz 以下 +4dB、わずかな残響 0.3 秒)',
    fn: (K, [line], P = recFx) => {
      const f = P(line), t = 0.1;
      if (f === 'A' || f === 'B') {
        const near = K.filt('lowshelf', 180, 0.7, K.split(K.out, K.verb(0.3, 0.12, 0.5), 0.3), 4);
        return t + say(K, t, line, P, { vol: 0.9 }, near);
      }
      // 仮声・強い加工(C): 囁き(rasp を主に)＋低い芯の 2 層。C は録音の全長
      const o = f ? K.filt('lowshelf', 180, 0.7, K.split(K.out, K.verb(0.3, 0.12, 0.5), 0.35), 4) : K.split(K.out, K.verb(0.3, 0.12, 0.5), 0.35);
      const c = f ? { len: undefined } : { len: 2.05 };
      const d = K.vox(t, line, { rate: 0.9, ...c, dry: 0.12, rasp: 2.4, raspF: 2300, raspQ: 0.5, hp: 180, lp: 7000, jit: 15, jitHz: 2.5, vol: 0.9, to: o });
      K.vox(t, line, { rate: 0.9, ...c, hp: 110, lp: 1100, jit: 15, jitHz: 2.5, vol: 0.2, to: o });
      return t + d;
    },
  },
  // 105 の遠い悲鳴(B1 の戻りの遠い悲鳴にも)。採用 C「声を遠く反響・はるか奥(二声)」＋メモ「機械音感をなくしたい」で調整:
  //  歪み 4 → 1.4(ブザーのような倍音を出さない)、声でノイズを変調する rasp を主にして息の混じった喉に、
  //  同じ素材を 2 本わずかにずらして重ね(18ms・音程 25 セント差)合成音声の平らさを崩す、音程の揺れを遅く(7Hz の震え → 3Hz のうねり)
  //  P4e-1: 録音(まだ無い)は、はるか奥(hp 250・lp 1500 → 4 秒の残響＋0.5 秒の反響)。一声目の後 0.6 秒置いて二声目(切らない・ループしない)
  x105_scream: {
    kind: 'sfx', dur: 5.5,
    takes: [['mgr_scream_01', 'mgr_scream_02']],
    space: 'はるか奥(hp 250Hz・lp 1500Hz → 残響 4 秒＋反響 0.5 秒)',
    fn: (K, [a, b], P = recFx) => {
      const v = K.verb(4.0, 1.0, 0.7), e = K.echo(0.5, 0.5, 1500, K.out), o = K.split(K.split(K.gain(0.3, K.out), v, 1), e, 0.6);
      if (P(a) || P(b)) {
        const far = K.filt('highpass', 250, 0.7, K.filt('lowpass', 1500, 0.7, o));
        const one = (t, nm, tts) => (P(nm) ? say(K, t, nm, P, tts, far, { loop: undefined, hold: 0 }) : K.vox(t, nm, { ...tts, to: o }));
        const d1 = one(0.1, a, { len: 1.0, rate: 1.2, cents: (u) => 150 * u, jit: 45, jitHz: 3, vib: 4.5, vibd: 16, drive: 1.4, rasp: 0.9, raspF: 1500, hp: 250, lp: 900, vol: 0.32 });
        const t2 = 0.1 + d1 + 0.6;
        const d2 = one(t2, b, { loop: [0.4, 1.2], hold: 1.6, rate: 1.27, cents: (u) => 250 * Math.sin(Math.PI * u), jit: 55, jitHz: 3, vib: 5, vibd: 18, drive: 1.4, rasp: 1.0, raspF: 1700, hp: 250, lp: 1500, vol: 0.48 });
        return t2 + d2;
      }
      for (const [d, r, c, g] of [[0, 1.2, 0, 0.32], [0.018, 1.225, 25, 0.24]]) {
        K.vox(0.1 + d, a, { len: 1.0, rate: r, cents: (u) => 150 * u + c, jit: 45, jitHz: 3, vib: 4.5, vibd: 16, drive: 1.4, rasp: 0.9, raspF: 1500, hp: 250, lp: 900, vol: g, to: o });
        K.vox(1.8 + d, b, { loop: [0.4, 1.2], hold: 1.6, rate: 1.27 + d, cents: (u) => 250 * Math.sin(Math.PI * u) + c, jit: 55, jitHz: 3, vib: 5, vibd: 18, drive: 1.4, rasp: 1.0, raspF: 1700, hp: 250, lp: 1500, vol: g * 1.5, to: o });
      }
      K.nz(1.7, 0.5, { color: 'pink', f: 1100, q: 0.8, vol: 0.05, env: 'swell', to: o });   // 二声目の前に息を吸う(遠く、残響の中にかすかに)
      return 3.4;
    },
  },
};

// まだゲームの場面に繋いでいない録音の聞こえ方(試聴盤の「録音の聞こえ方」用)。空間処理なし、C は仮声のよくある数値
export const REC_GENERIC = {
  space: '空間処理なし(まだゲームの場面に繋いでいない)',
  fn: (K, line, f) => K.vox(0.1, line, f === 'C' ? { rate: 0.75, rasp: 0.3, jit: 25, vol: 0.8 } : { ...REC_PROFILE[f], vol: 0.8, rel: 0.15 }) + 0.1,
};

// 声の場面が使う素材の ID(重複なし)
export function voiceLines(ids = Object.keys(VOICE)) {
  return [...new Set(ids.flatMap((id) => VOICE[id].takes.flat()))];
}
// 素材 ID → それを使う声の場面(試聴盤の「録音の聞こえ方」が場面を引く)
export function scenesOfLine(line) {
  return Object.keys(VOICE).filter((id) => VOICE[id].takes.some((tk) => tk.includes(line)));
}
