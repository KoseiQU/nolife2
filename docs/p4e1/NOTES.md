# P4e-1 NOTES — 録音した声の加工と接続(2026-11-02)

入力:ユーザーの録音 3 本(`tools/import_rec.sh` で取り込み済み。`assets/audio/tts/recorded.txt`)。
| ID | 台詞 | 長さ | ピーク |
|---|---|---|---|
| `mgr_line_know_01` | いるのは…… わかってるよ | 3.79 秒 | −2.5dBFS |
| `mgr_door_laugh_01` | ふふふ…… ふふ | 1.54 秒 | −16.5dBFS |
| `mgr_line_found_01` | みぃつけた | 2.27 秒 | −8.4dBFS |

ユーザーの依頼:「少し加工して使えるようにして」。

## 1. 仕組み
- **録音かどうか**:`assets/audio/tts/recorded.txt` にある ID を「録音」とみなす(`src/audio_voice.js` の `loadRec`。ゲームは `AudioBank.load` が、試聴盤は起動時に読む)。無い ID は従来の仮声の加工のまま。
- **聞こえ方** `recFx(ID)`:録音でなければ `null`(仮声)、録音なら `rec_fx[ID]` の A/B/C(未選択・不正な値は **B**)。
- 声の場面の加工 `VOICE[場面].fn(K, take, P)` は、素材ごとに `P(ID)` を見て、仮声の加工か録音プロファイルかを選ぶ(共通の `say`)。**どのプロファイルでも場面の空間処理は同じ**で、録音は**全長を使う**(`len` で切らない・ループしない)。
- 音量は従来どおり読み込み時の自動合わせ(`AUDIO.voiceNorm`:ピーク −6dBFS・RMS −18 の小さい方)。P4e-1 で、描く長さを素材の長さから見積もる(`voiceSpan` = 素材の秒 ÷ 0.7 + 0.6 + 2.5 と場面の `dur` の大きい方)、RMS は尻の無音(ピークの −66dB 未満)を除いて測るようにした。仮声の take の倍率は変わらない(扉の向こう `mgr_door_line_02` 0.596・105 の悲鳴 0.839 で前後一致を確認)。
- 検査用に `Kit.vox` が `K.trace`(配列がある時だけ)へ渡った数値を残す。`AudioBank.voiceTrace[場面][take] = { take, prof, vox }`、再生の記録(`bank.log`)にも `take`・`prof` が付く。

## 2. プロファイルの数値(A/B/C)
素材に掛ける加工(→ その後に場面の空間処理)。

| | A 素のまま | B 軽い加工(既定) | C 強い加工 |
|---|---|---|---|
| 考え方 | 空間処理だけ | わずかに低く遅く | 仮声と同じ数値(低く遅く・かすれ) |
| 再生速度 | 1.0 | **0.9** | 場面の仮声の値(扉 0.74・目の前 0.9・悲鳴 1.2/1.27) |
| 高域通過 | 80Hz | 80Hz | 仮声の値 |
| かすれ rasp・揺らぎ jit・歪み | なし | なし | 仮声の値(扉 rasp 0.3・jit 25 / 目の前 rasp 2.4・jit 15 の囁き＋低い芯の 2 層 / 悲鳴 rasp 0.9〜1.0・jit 45〜55・歪み 1.4) |
| 長さ | 全長 | 全長 | **全長**(仮声の `len` は使わない。悲鳴のループもしない) |

場面ごとの空間処理(A/B/C 共通。仮声の経路は P4b のまま変えていない):
| 場面 | 録音の空間処理 | 距離 |
|---|---|---|
| `enemy_breath_door`(扉の向こう) | 扉の向こうの部屋の残響(0.7 秒・送り 0.4)→ 扉板の 240Hz の山(+6dB)→ lowpass 800Hz | ゲームの位置音(扉の位置・ref 1.0) |
| `enemy_breath_close`(目の前) | 耳元の近さ(lowshelf 180Hz +4dB)→ わずかな残響(0.3 秒・送り 0.3)。ほぼ素のまま | 管理人の頭の位置(HRTF・ref 1.4)。遮蔽のこもり・減衰は掛けない |
| `x105_scream`(はるか奥。まだ録音なし) | hp 250Hz・lp 1500Hz → 4 秒の残響＋0.5 秒の反響。一声目の後 0.6 秒置いて二声目 | 従来どおり |
| まだ場面に繋いでいない録音(試聴盤だけ) | 空間処理なし。C は rate 0.75・rasp 0.3・jit 25 | — |

録音 3 本の鳴る長さ(試聴盤で描いた値。残響の尾込み):`mgr_line_know_01` A 3.9/B 4.3/C 5.2 秒、`mgr_door_laugh_01` 1.7/1.8/2.2 秒、`mgr_line_found_01` 2.5/2.7/2.7 秒。**切れていない**(素材 3.79 秒を全部使う。以前の len 3.0 の切れは解消)。
ゲームの音量合わせの倍率(B):know_01 0.50・door_laugh_01 1.74・line_found_01 1.09(録音のピークの差 −2.5/−16.5/−8.4dBFS を吸収)。

## 3. 接続
| 場面 | 状態 | 発火点 | 音量 |
|---|---|---|---|
| `enemy_breath_door` | 声(既存)。3 本のうち録音 2 本が録音プロファイル、`mgr_door_line_02` は仮声のまま | enemy_ai.js `_roomLurkTick`(変更なし) | AI の 0.16 × `AUDIO.gain` 2.5(変更なし) |
| **`enemy_breath_close`** | **なし → 声(録音で復活・`mgr_line_found_01`)** | enemy_ai.js 1460 行 `audio.play('breath', 頭の位置, 0.9)`(クローゼットの前で焦らし始めた瞬間に 1 回。**enemy_ai.js は触っていない**) | 0.9 × `AUDIO.gain.enemy_breath_close` 1.0(新設・耳で決める値) |

- `src/enemy_audio.js`:`ROUTE.breath = 'enemy_breath_close'`。声の場面なので AudioBank の `voice` へ。扉越しと同じく cutoff は 0(近さは加工の中)、さらに目の前なので**遮蔽の音量減衰(occludedGain)も掛けない**。
- manifest:`samples/sound_lib.js` の反映表 `ROUND3_DONE.enemy_breath_close = 'rec'`(新しい値 = 録音で復活)。`tools/build_audio.html` の振り分けが `rec` を声の場面(候補 `'rec'`)に入れる。`bash tools/build_audio.sh` を再実行:**wav 22 本は差分 0**、manifest は voice 3(+enemy_breath_close)・なし 47・`rec_fx` 欄の追加だけ。json の pick は none のまま(ユーザーの記録を書き換えない)。
- 試聴盤の `enemy_breath_close` の札は「録音で復活(mgr_line_found_01)」。3 周目の候補 A/B/C(仮声用の数値)はそのまま残っている(候補 A は同じ素材なので録音の声で鳴る)。

## 4. 聞こえ方の選択と保存先
- 試聴盤 `samples/sound.html` の上部に「**録音の聞こえ方**」の節(`recorded.txt` が空なら出ない)。録音ごとに 1 行:台詞(`docs/lines.md` の表)・ID・場面(`VOICE` から引く。繋いでいない録音は「まだゲームに接続していない」と台詞表の場面)・A/B/C の ▶ とラジオ。札は「未選択(既定 B 軽い加工)」/「選択: X」。
- ラジオを押すと **`samples/sound_choice.json` の `rec_fx` 欄**(`{ "rec_fx": { "mgr_line_know_01": "C" } }`)に自動保存。`choices` とは別の欄なので既存の選択と衝突しない(`tools/build_audio` は `choices` だけを見る)。保存は今までの `POST /api/sound_choice`(本文の JSON をそのまま書く)なので **`tools/serve.py` は変更していない** → 8001 で動いているサーバーもそのまま使える(再起動不要)。
- **ゲームの読み順**:`samples/sound_choice.json` の `rec_fx` を直接読む(**build 不要、再読み込みで反映**)→ 読めなければ manifest の `rec_fx`(`tools/build_audio.sh` が写す。配布版で samples/ を外した時の予備)→ どちらも無ければ B。読んだ出どころは `__N2.bank.rec.from`。
- 動作確認(リポジトリの複製を別ポートの serve.py で配信して実施。本物の `sound_choice.json` は触っていない):C を押す → 1 回保存・`rec_fx` だけ増え `choices` 78 件は同一 → 再読み込みで C が選ばれたまま → `loadRec` が `sound_choice.json` から C を読む。

## 5. 今後の録音
- `tools/import_rec.sh` で取り込むと `recorded.txt` に ID が増える → **何もしなくても**ゲームはその ID を録音プロファイル(既定 B)で鳴らし、試聴盤の「録音の聞こえ方」に行が増える(複製で `mgr_mumble_01`・`mgr_scream_01` を足して確認:悲鳴は x105_scream の空間処理、呟きは「まだゲームに接続していない」で A/B/C が描ける)。
- ただし**場面にまだ繋いでいない台詞**(呟き `mgr_mumble_*`・叫び `mgr_scream_03`・笑い `mgr_laugh_01` など)は、録っても試聴盤で聞けるだけでゲームでは鳴らない。場面の復活(気配・襲撃の叫び・ロッカーの飛び出し)は `VOICE` に場面を足し、発火点を繋ぐ作業が要る(P4e の続き)。
- 新しい声の場面を足す時は、`VOICE` に `space`(説明)と `fn(K, take, P)` を書き、素材は `say(K, t, ID, P, 仮声の数値, 録音の空間処理)` で鳴らす(録音プロファイルが自動で効く)。`GAME.scenes` に `{ voice: true }`、反映表に `'rec'` か採用を入れて `bash tools/build_audio.sh`。

## 6. テスト(ヘッドレス Chrome for Testing・1280×720・自前の `tools/serve.py` :8051)
| スイート | 結果 |
|---|---|
| `?test=audio` | **14/14**(AudioContext running) |
| `?test=enemy` | 35/35 |
| `?test=rooms` | 8/8 |
| `?test=story` | 19/19 |
| `?test=building` | 14/14 |
| `?test=spaces` | **15/16**(`P_perf_vs_4F_corridor` が 4 回とも落ちた。下の注) |
- **spaces の性能ケースは P4e-1 の退行ではない**:P4e-1 の前のコミット(cee46a0 を `git archive` で別フォルダへ、build/enemy は同じ物)でも同じ手順で同じく落ちた(worst 11.7ms vs 4F 廊下の基準 7.8ms)。基準の 4F 廊下は最初 7.7ms・最後 12.4〜12.9ms と測るたびに揺れており、P4d の申し送り 1 と同じ計測のゆれ(当日の負荷)。三角形数・描画コールは前後で一致。負荷の低い時に再実行を。
- `?test=audio` の変更:0 = 声 3 場面・なし 47・`enemy_breath_close` が voice(候補 rec)/**0b(新)** = 録音 3 本が録音プロファイルで描かれる(B:rate 0.9・len なし・素材の全長 3.792/1.536/2.266 秒をそのまま使う・rasp 0・jit 0、選択があればその値)、録音でない `mgr_door_line_02` は仮声のまま(rate 0.74・len 3.0・rasp 0.3・jit 25)/1 = 呼んでも鳴らない名前から `breath` を外した/**5b(新)** = 410 のクローゼットに隠れ、管理人が入って前で焦らす(必ず入る・開けない確率にして)→ `enemy_breath_close` がちょうど 1 回、声として、音量 0.9(遮蔽で弱めない)、take `mgr_line_found_01`・聞こえ方 B/10 = 採用 25 場面(wav 22＋声 3)がすべて 1 回以上、なし 47 場面は 0 回。
- 試聴盤:録音 3 本 × A/B/C の 9 本を描いて例外 0・ピーク −6dBFS、全 216 候補(72 場面×3)をオフラインで描いて例外 0・ピーク上限超え 0。
- **耳では聴いていない**(エージェントは音を聴けない)。A/B/C の聞こえ方・怖さ・音量の釣り合いはユーザーが試聴盤とゲームで判定する。

## 7. 判断と申し送り(ユーザー判断待ち)
1. **既定は B(rate 0.9)**。録音の声は元々人の声なので、0.74 倍は下げ過ぎと見て 0.9 にした。物足りなければ試聴盤で C、素の声がよければ A。B の数値自体を変えるなら `src/audio_voice.js` の `REC_PROFILE.B`。
2. **C は仮声と同じ数値だが、録音は切らない**:仮声の `len`(扉 3.0 秒・目の前 2.05 秒)をそのまま使うと台詞が途中で切れるので、C でも全長を使う。悲鳴の C はループで伸ばさない(録音を区間ループすると継ぎ目が出るため)。
3. **扉越しの録音に部屋の残響(0.7 秒)を足した**:指示「扉越し＝ローパス＋距離・部屋の残響」。仮声の経路(残響なし)は変えていないので、3 本のうち仮声のまま残る `mgr_door_line_02` だけ残響が無い。録音が揃えば揃う。
4. **目の前の声は遮蔽で弱めない**:クローゼットの扉 1 枚越しの目の前なので、管理人の遮蔽(cutoff 600Hz・音量 0.55)は掛けず、近さ(低域 +4dB)とわずかな残響だけ。こもらせたい(扉越しに聞こえる)なら `VOICE.enemy_breath_close` の空間処理に lowpass を足す。
5. **目の前の声が鳴る時刻**:焦らしの始め(足音が止まり、こちらを向いて `look_idle` に入った直後)に 1 回。焦らしは 2 回目のノブの音へ続く。焦らしの長さ・声の間合いの調整は enemy_ai.js 側(今回は触らない契約)。
6. 3 周目の候補にあった**合成の吸う息・吐く息**は使わない(ユーザーの所見「機械音感」)。息が欲しければ録音で。
7. **x105_scream の録音は片方だけでも動く**(録音した方だけ録音プロファイル、もう片方は仮声 1 層)。ただし 2 本とも録るまでは仮声の 2 層重ねより薄くなる。
8. `docs/recording_guide.md` の「声は 0.7〜0.8 倍に遅くして鳴らします」は、録音には B の 0.9 倍が既定になったので古い(既存 docs のため直していない)。メインが直すか判断を。
9. DESIGN.md の P4e-1 の行はメインが書く(指示どおり触っていない)。

## 8. 変更したファイル
- 新規:この NOTES
- 変更:`src/audio_voice.js`(録音の状態・プロファイル・`say`・`voiceSpan`・目の前の場面・空間処理)、`src/audio_bank.js`(`loadRec`・描く長さ・RMS・`voiceTrace`・gain 1 行)、`src/audio_kit.js`(`vox` の検査用の記録 1 行)、`src/enemy_audio.js`(`ROUTE.breath`)、`samples/sound.html`(「録音の聞こえ方」・`rec_fx` の保存/読み込み・札・案内)、`samples/sound_lib.js`(`ROUND3_DONE`・`GAME`・`renderRecFx`・扉の向こう B の間隔 4.5 → 5.5 秒)、`tools/build_audio.html`・`tools/build_audio.mjs`(`rec` の振り分け・manifest の `rec_fx`)、`assets/audio/manifest.json`、`tools/test_audio.js`、`docs/lines.md`(末尾に追記のみ)、`assets/LICENSES.md`(ユーザー自身の録音の行)
- コミットした素材:`assets/audio/tts/mgr_line_know_01.wav`・`mgr_door_laugh_01.wav`・`mgr_line_found_01.wav`(ユーザーの録音)・`assets/audio/tts/recorded.txt`
- 触っていない:`src/enemy_ai.js`・`src/tutorial.js`・`tools/serve.py`・`tools/blender/*`・`build/enemy/*`・DESIGN.md・既存 docs
