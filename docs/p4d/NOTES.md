# P4d NOTES — 最終選択の反映と録音の受け口(2026-11-02)

入力は `samples/sound_choice.json`。着手時の作業ツリーの版をそのままコミットした(fa7b83c:新 312 の 8 場面=なし、`amb_x312_room_loop`=未選択、`xb1_loop_notice`=C)。作業中にユーザーが試聴盤で `amb_x312_room_loop` を「なし」にした(19:43 保存)ので、その版も反映した(6b1beb4)。**最終的に新 312 の 9 場面はすべて「なし」**。

## 1. 反映
| 場面 | 結果 | ゲーム側 |
|---|---|---|
| `xb1_loop_notice` | **採用 C「耳鳴りと金属の一打」** | `assets/audio/xb1_loop_notice.wav`(3.30 秒・142KB・ピーク −6dBFS)。`src/spaces/xb1.js` の `sfx(ctx, 'notice')`(標識灯を 3 回目に通って気づく瞬間。`st.passes === XB1.loop.notice`)が `bank.play('xb1_loop_notice')`(耳元・位置なし)を鳴らす。仮音(55Hz のうなりと 82Hz の `tone`)は削除し、`tone` の import も外した。音量の倍率 `AUDIO.gain.xb1_loop_notice = 0.8`(耳で決める値) |
| 新 312 の 8 場面(`x312_clock_tick`・`x312_door_open`・`x312_door_close`・`x312_door_locked`・`x312_key_slam`・`x312_watcher_lookup`・`x312_room_shift`・`x312_bed_creak`) | なし | 元々 AudioBank に接続しておらず、`src/spaces/x312.js` と story.js の 312 用の仮音は触っていない(下の申し送り 2) |
| `amb_x312_room_loop` | 最終選択の時点では**未選択(なし扱い)**。その後ユーザーが「なし」を押した | 同上 |

- 書き出し(`bash tools/build_audio.sh`)の結果:wav **22 本**(+xb1_loop_notice)・声 2 場面・なし **48**・3 周目 0・未選択 0。**既存の wav 21 本は差分 0**(バイト一致。変わったのは manifest と xb1_loop_notice.wav の追加だけ)。wav 合計 4.09MB(+0.14MB)。
- `samples/sound_lib.js`:`ROUND3_DONE` に新 312 の 9 場面を足した(8 場面=`'none'`、`amb_x312_room_loop` は一時 `'unselected'` → 最終 `'none'`)。`'unselected'` の扱い(manifest の `unselected` へ)は `tools/build_audio.html` に残してある(今後「未選択のまま接続しない」場面を作る時に使える)。新設 `P4D_DONE = { xb1_loop_notice: 'c' }`(3 周目以外の反映済みの場面。`sc.p4d`)。
- 試聴盤(`samples/sound.html`):新 312 の 9 行の札は「3 周目・なし」、`xb1_loop_notice` の札は「採用済み C」(`p4dReflected`)。反映後に選び直すと「反映後に変更・書き出しと接続が必要」の札に変わる。案内文も更新。試聴盤を開いた時点で未選択 0。
- `tools/build_audio.mjs` の manifest の説明文を更新(round3 は P4d で空、unselected = ゲームでは無音)。

## 2. 録音の取り込み `tools/import_rec.sh`
使い方(1 行):`assets/audio/rec_in/` に `<台詞ID>.m4a`(wav・aiff・caf・mp3 も可)を置いて、リポジトリの直下で `bash tools/import_rec.sh`、ゲームを再読み込み(Cmd+Shift+R)。ID だけ指定もできる:`bash tools/import_rec.sh mgr_scream_01 …`。

仕様:
- **ID の決め方**:ファイル名の先頭にある、`docs/lines.md` の台詞表の ID のうち**最長のもの**(直後が英数字でないこと。大文字小文字は区別しない)。`mgr_line_found_01 取り直し.m4a`・`mgr_scream_01_take2.wav` は OK。表に無い名前は「警告: 飛ばしました」。同じ ID のファイルが複数あれば更新が新しい方を使い、警告する。対応外の拡張子(txt など)は見ない。
- **変換**:`afconvert -f WAVE -d LEI16@22050 -c 1`(モノラル 22.05kHz 16bit。ステレオ・44.1kHz・m4a でも可。m4a から作られる wav は WAVE_FORMAT_EXTENSIBLE で標準の `wave` モジュールが開けないため、RIFF を自前で読む)。
- **無音詰め**(python3 標準ライブラリだけ):10ms ごとの RMS を見て、**ピークの −42dB と −56dBFS の大きい方**を超える最初〜最後の区間を残し、前 0.10 秒・後ろ 0.30 秒の余白を付ける(囁きの語尾を切らないため後ろを長く)。切り口に頭 4ms・尻 30ms のフェード。音量は揃えない・加工しない(ゲームが読み込み時に自動で揃え、声の加工を掛ける)。ほぼ無音のファイルは詰めずに警告。ピークが −30dBFS より小さい(小さすぎ)/上限に張り付く(割れ)も警告。
- **出力**:`assets/audio/tts/<ID>.wav` へ上書き。取り込んだ ID を `assets/audio/tts/recorded.txt` に記録(重複なし・並べ替え)。
- **make_tts.sh との関係**:`tools/make_tts.sh` は `recorded.txt` の ID を**自動で仮声の上書きから外す**(従来の `KEEP="…"` と併用可。`FORCE=1` で無視して仮声に戻せる)。`docs/lines.md` の末尾に差し替え節を追記した(既存 docs でここだけ追記可の指示どおり)。
- `assets/audio/rec_in/` は `.gitignore`(元ファイルはコミットしない)。`tts/<ID>.wav` と `recorded.txt` はコミットする。
- 動作確認(スクラッチの複製で。リポジトリの tts は触っていない):say で作った声を m4a(AAC)/ステレオ 44.1kHz wav/aif/caf/大文字拡張子にして置き、前後に雑音入りの 2 秒の無音を足したファイルで「7.08 秒 → 3.45 秒(前 1.91 / 後 1.73 秒を詰めた)」、出力が 22.05kHz モノラル 16bit(サイズ一致)、ID の無いファイルは警告して飛ばす、複数あれば新しい方、`make_tts.sh` が記録済み ID を残し `FORCE=1` で仮声に戻ることを確認。bash 3.2(macOS 標準)で動く。**実機の iPhone のボイスメモ(m4a)はエージェントが録れないので、実ファイルでの確認はユーザーの初回の取り込みで**。

## 3. 録音ガイド `docs/recording_guide.md`
ユーザーが読む文書。録る台詞を優先順に ①今ゲームで鳴っている 5 本(`mgr_line_know_01`・`mgr_door_laugh_01`・`mgr_door_line_02`・`mgr_scream_01`・`mgr_scream_02`) ②「なし」にした声の場面を復活させる分(気配の呟き `mgr_mumble_01/04/05` から 2 本、目の前 `mgr_line_found_01`・`mgr_laugh_01`、叫び `mgr_scream_03`、ロッカー飛び出しは scream と共用) ③任意(残り 10 本)。各行に ID・台詞(仮案)・声の方向・長さの目安。録り方・置き場所と取り込み・録音後(P4e)。

## 4. テスト(ヘッドレス Chrome for Testing・1280×720・自前の `tools/serve.py` :8044。P5b-6 の未コミット変更が作業ツリーにある状態)
| スイート | 結果 |
|---|---|
| `?test=audio` | **12/12**(AudioContext running。0〜10 を更新+新 8b) |
| `?test=story` | 19/19 |
| `?test=enemy` | 35/35(25〜35 は P5b-6 のもの) |
| `?test=rooms` | 8/8 |
| `?test=building` | 14/14 |
| `?test=spaces` | 16/16(**1 回目・2 回目は `P_perf_vs_4F_corridor` が落ちた**。下の申し送り 1) |
- `?test=audio` の変更:0 = wav 22・声 2・なし 48(新 312 の 9 場面を含む)・3 周目 0・未選択 0/8b(新)= B1 のトンネルを歩いて標識灯を 3 回通ると `xb1_loop_notice` がちょうど 1 回(`play`)、その後歩き続けても増えない/10 = 採用 24 場面(wav 22＋声 2)がすべて 1 回以上、採用以外(なしの 48 場面)は 0 回。

## 5. 判断と申し送り(ユーザー判断待ち)
1. **`?test=spaces` の性能(P_perf_vs_4F_corridor)は不安定**:作業ツリーで 2 回落ちた(worst X312_B3_mirror_watcher 13.6/14.6ms vs 4F 廊下 11.8/12.5ms)後、3 回目に 16/16。切り分け:P4d の前(ecc7c64 を `git archive` で別フォルダへ)でも同じ手順で 1 回通り 1 回落ち、P4d 直後のコミット(P5b-6 の未コミットを含まない)でも 1 回落ち 1 回通った。同じ姿勢の描画コール・三角形数は両者で一致し、4F 廊下の基準値自体が 7.8〜12.7ms と揺れる=**当日の負荷(LINE が CPU 約 90% など)による計測のゆれ**で、P4d・P5b-6 の退行ではない。負荷が下がった時に再実行を。
2. **新 312 は無音**:312 の中の音は spaces/x312.js の WebAudio の仮音のまま(開かない扉は story.js の `_sfx('rattle')`)という P4c の申し送りは変えていない。9 場面が「なし」になったので、この仮音を消して無音にするかは**ユーザー判断待ち**(今回は指示に無かったので触っていない。x312.js は触らない契約)。消すなら x312.js の `sfx`/`sound` の合成と story.js の 312 用 rattle の仮音を外し、`?test=audio` の 1 に 312 を足す。
3. **amb_x312_room_loop**:指示は「未選択(なし扱い)」だったが、作業中にユーザーが試聴盤で「なし」を押したので「なし」で確定した。
4. **xb1_loop_notice の音量・定位**:耳元(位置なし)、倍率 0.8。仮音(0.09 の低いうなり)より明らかに大きい金属の一打。耳で決める値(`AUDIO.gain.xb1_loop_notice`)。
5. **録音が来た後(P4e)**:「なし」にした声の場面(`enemy_presence`・`enemy_breath_close`・`enemy_scream`・`locker_burst`)を録音で接続し直す。`mgr_*` を録音に替えると、既存の 2 場面(`enemy_breath_door` の `len: 3.0`、`x105_scream` の `len`/`loop`)の切り出しが録音の長さに合うかを `src/audio_voice.js` で見直す(録音が短ければ `Math.min` で自動的に切り詰められるが、叫びのループ区間 0.4〜1.2 秒は録音が 1.5 秒以上ある前提)。
6. `docs/p4a/sounds.md`・`docs/p4b/NOTES.md`・`docs/p4c/NOTES.md` は既存 docs なので更新していない(この NOTES が正)。

## 6. 変更したファイル
- 新規:`assets/audio/xb1_loop_notice.wav`・`tools/import_rec.sh`・`docs/recording_guide.md`・この NOTES
- 変更:`samples/sound_choice.json`(ユーザーの選択をそのまま)・`samples/sound_lib.js`・`samples/sound.html`・`assets/audio/manifest.json`・`src/audio_bank.js`(gain 1 行)・`src/spaces/xb1.js`・`tools/build_audio.html`・`tools/build_audio.mjs`(説明文)・`tools/make_tts.sh`(recorded.txt・FORCE)・`tools/test_audio.js`・`docs/lines.md`(末尾に追記のみ)・`.gitignore`
- 触っていない:`src/enemy_ai.js`・`src/main.js`・`src/world.js`・`src/enemy.js`・`src/door_fx.js`・`tools/test_enemy.js`・`tools/test_rooms.js`・`tools/blender/*`・`build/enemy/*`・`docs/p5b6*`・`src/spaces/x312.js`・`src/tutorial.js`・DESIGN.md・既存 docs
