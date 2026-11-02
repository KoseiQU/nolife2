// audio_voice.js — 声の場面の「素材＋加工」(P4b)。声は wav に焼き込まず、ゲームが鳴らす時に素材(assets/audio/tts/<ID>.wav)へこの加工を掛ける。
//  - 素材 = 台詞表 docs/lines.md の ID。ユーザーの録音を同じ名前の wav で置けば、加工はそのまま録音に掛かる(tools/build_audio.sh の再実行は不要)。
//  - 加工 = Kit(src/audio_kit.js)で組む関数 fn(K, take)。試聴盤(samples/sound_lib.js の採用候補)とゲーム(src/audio_bank.js の voice)が同じ関数を使う。
//  - takes = 1 回の再生で使う素材の組。ゲームは鳴らすたびに順に回す(同じ台詞が続かない)。
//  - 素材の切り出し(len・loop の秒)は仮声(macOS say)の長さに合わせてある。録音に差し替えて切れ方がおかしければ、ここの数字を直す(docs/p4b/NOTES.md §5)。
//  - 音量は src/audio_bank.js が読み込み時に 1 度オフラインで描いて揃える(kind の基準: sfx はピーク −6dBFS・RMS −18、loud は −3/−15)。

export const VOICE = {
  // 扉の向こう(潜伏中の空き部屋の扉の前で立ち止まると)。採用 B「いるのは…わかってるよ」＋ユーザーのメモ「息遣いではなく、笑い声かセリフに」で
  // 短い笑い・台詞を 2 本足して 3 本を順に回す。加工は B のまま(扉板越しのこもり＝lowpass 800Hz＋扉板の 240Hz の山、0.74 倍で低く遅く、囁きのかすれ)
  enemy_breath_door: {
    kind: 'sfx', dur: 4.4,
    takes: [['mgr_line_know_01'], ['mgr_door_laugh_01'], ['mgr_door_line_02']],
    fn: (K, [line]) => {
      const door = K.filt('peaking', 240, 2, K.muf(800, 1), 6);
      K.vox(0.05, line, { rate: 0.74, len: 3.0, lp: 1000, rasp: 0.3, jit: 25, vol: 1, to: door });
    },
  },
  // 105 の遠い悲鳴(B1 の戻りの遠い悲鳴にも)。採用 C「声を遠く反響・はるか奥(二声)」＋メモ「機械音感をなくしたい」で調整:
  //  歪み 4 → 1.4(ブザーのような倍音を出さない)、声でノイズを変調する rasp を主にして息の混じった喉に、
  //  同じ素材を 2 本わずかにずらして重ね(18ms・音程 25 セント差)合成音声の平らさを崩す、音程の揺れを遅く(7Hz の震え → 3Hz のうねり)
  x105_scream: {
    kind: 'sfx', dur: 5.5,
    takes: [['mgr_scream_01', 'mgr_scream_02']],
    fn: (K, [a, b]) => {
      const v = K.verb(4.0, 1.0, 0.7), e = K.echo(0.5, 0.5, 1500, K.out), o = K.split(K.split(K.gain(0.3, K.out), v, 1), e, 0.6);
      for (const [d, r, c, g] of [[0, 1.2, 0, 0.32], [0.018, 1.225, 25, 0.24]]) {
        K.vox(0.1 + d, a, { len: 1.0, rate: r, cents: (u) => 150 * u + c, jit: 45, jitHz: 3, vib: 4.5, vibd: 16, drive: 1.4, rasp: 0.9, raspF: 1500, hp: 250, lp: 900, vol: g, to: o });
        K.vox(1.8 + d, b, { loop: [0.4, 1.2], hold: 1.6, rate: 1.27 + d, cents: (u) => 250 * Math.sin(Math.PI * u) + c, jit: 55, jitHz: 3, vib: 5, vibd: 18, drive: 1.4, rasp: 1.0, raspF: 1700, hp: 250, lp: 1500, vol: g * 1.5, to: o });
      }
      K.nz(1.7, 0.5, { color: 'pink', f: 1100, q: 0.8, vol: 0.05, env: 'swell', to: o });   // 二声目の前に息を吸う(遠く、残響の中にかすかに)
    },
  },
};

// 声の場面が使う素材の ID(重複なし)
export function voiceLines(ids = Object.keys(VOICE)) {
  return [...new Set(ids.flatMap((id) => VOICE[id].takes.flat()))];
}
