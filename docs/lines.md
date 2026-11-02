# 台詞表(管理人の声)

DESIGN.md §3.5 の「台詞は `docs/lines.md` に集約し、ファイル名と 1 対 1」の正。**ID = ファイル名**(拡張子なし)。

- **今は仮声**:macOS 付属の `say`(日本語音声)で読み上げた wav を `assets/audio/tts/<ID>.wav`(22.05kHz・16bit・モノラル)に置いている。作り方は `tools/make_tts.sh`(音声名・速さ・台詞はこの表と同じ)。
- **ユーザー録音での差し替え**:同じ ID の wav(またはモノラルの wav なら何 Hz でもよい)で `assets/audio/tts/<ID>.wav` を上書きするだけ。試聴盤とゲームの加工(ピッチ下げ・こもり・歪み・残響)は `samples/sound_lib.js` の各候補が素材に掛けるので、録音は**素の声で、加工せずに**録る。録る時の目安は「声の方向」の欄。
  - 加工の多くは再生速度 0.7〜0.78 倍(=低く・遅く)を掛ける前提。録音が最初から低く遅いなら、選ばれた候補の `rate` を 1.0 寄りに直す(P4b)。叫びは逆に 1.1〜1.4 倍で上ずらせている。
- 台詞の言い回しは管理人の性格(§3.4.1・§3.8:60 代後半の大柄な男、無表情、潜んで待つ)に合わせた仮案。ユーザーが変えたらこの表を直し、同じ ID のまま録る(場面との対応が崩れない)。
- 実名・実在の人物・地名は入れない。

| ID(=ファイル名) | 場面(試聴盤の候補) | 台詞 | 声の方向 | 仮声(say の音声・速さ 語/分) | ユーザー録音の差し替え先 |
|---|---|---|---|---|---|
| `mgr_mumble_01` | 管理人の気配 `enemy_presence` A | ちがう…… ここじゃ、ない…… つぎ…… | 誰にも聞かせない独り言。ぼそぼそ、語尾が消える。2〜4 秒 | Grandpa・105(前半 2.9 秒だけ使う) | `assets/audio/tts/mgr_mumble_01.wav` |
| `mgr_mumble_02` | 管理人の気配 `enemy_presence` B | ひとつ…… ふたつ…… みっつ…… よっつ…… | 部屋の扉を数えながら歩く。抑揚なく、間を長く | Rocko・95(「みっつ」まで使う) | `assets/audio/tts/mgr_mumble_02.wav` |
| `mgr_mumble_03` | 管理人の気配 `enemy_presence` C | おきてる こは、いないかなあ。 どこかなあ | 囁き。逆回しで使う(意味の取れない呟き)ので言い回しは何でもよい | Grandpa・125(逆再生して一部を使う) | `assets/audio/tts/mgr_mumble_03.wav` |
| `mgr_laugh_01` | 目の前 `enemy_breath_close` A | ふふ…… ふふふふ…… | 鼻から漏れる低い含み笑い。楽しんでいる | Grandpa・95 | `assets/audio/tts/mgr_laugh_01.wav` |
| `mgr_line_found_01` | 目の前 `enemy_breath_close` B | みぃつけた | 囁きに近い低い声。ゆっくり、近い | Grandpa・85 | `assets/audio/tts/mgr_line_found_01.wav` |
| `mgr_line_there_01` | 目の前 `enemy_breath_close` C | そこに…… いるんだろう | 低く太く、確信している。急がない | Rocko・90 | `assets/audio/tts/mgr_line_there_01.wav` |
| `mgr_laugh_02` | 扉の向こう `enemy_breath_door` A | くっくっくっく…… | 喉の奥で小さく笑う。声を殺している | Grandpa・115 | `assets/audio/tts/mgr_laugh_02.wav` |
| `mgr_line_know_01` | 扉の向こう `enemy_breath_door` B | いるのは…… わかってるよ | 扉に口を寄せて、小声で優しく | Grandpa・100 | `assets/audio/tts/mgr_line_know_01.wav` |
| `mgr_line_awake_01` | 扉の向こう `enemy_breath_door` C | まだ…… おきてるのかい | 普段の管理人の穏やかな口調のまま(だから怖い) | Rocko・100 | `assets/audio/tts/mgr_line_awake_01.wav` |
| `mgr_scream_01` | 叫び `x105_scream` A・C、ロッカー `locker_burst` A | ああああああああああああ | 喉が裂けるほどの長い叫び。息が続く限り | Rocko・150 | `assets/audio/tts/mgr_scream_01.wav` |
| `mgr_scream_02` | 叫び `enemy_scream` C・`x105_scream` C、ロッカー `locker_burst` C | うおおおおおおおおおお | 低く太い咆哮。振りかぶる瞬間 | Rocko・140 | `assets/audio/tts/mgr_scream_02.wav` |
| `mgr_scream_03` | 叫び `enemy_scream` A・`x105_scream` B、ロッカー `locker_burst` B | ぎゃあああああああああああ | 上ずって割れる叫び(素材は「ああ」の部分から使う) | Grandpa・145 | `assets/audio/tts/mgr_scream_03.wav` |
| `mgr_scream_laugh_01` | 叫び `enemy_scream` B | あはははは、あああああああああ | 笑いがそのまま叫びに変わる(§3.4.1 の叫び笑い) | Grandpa・170 | `assets/audio/tts/mgr_scream_laugh_01.wav` |
| `mgr_door_laugh_01` | 扉の向こう `enemy_breath_door`(P4b・採用 B に追加。ゲームで使用) | ふふふ…… ふふ | 扉越しに、小さく楽しそうに笑う。短く | Grandpa・105 | `assets/audio/tts/mgr_door_laugh_01.wav` |
| `mgr_door_line_02` | 扉の向こう `enemy_breath_door`(P4b・採用 B に追加。ゲームで使用) | もうすこし…… ちかくに、おいで | 扉に口を寄せて、優しく誘う小声 | Grandpa・100 | `assets/audio/tts/mgr_door_line_02.wav` |
| `mgr_mumble_04` | 管理人の気配 `enemy_presence` 3 周目 A | どこかなあ…… どこに、いったかなあ…… | 探し物をしながらの独り言。ぼそぼそ | Grandpa・110 | `assets/audio/tts/mgr_mumble_04.wav` |
| `mgr_mumble_05` | 管理人の気配 `enemy_presence` 3 周目 B | ちがう…… ちがう…… ここも、ちがう…… | 歩きながら部屋を確かめる呟き | Rocko・105 | `assets/audio/tts/mgr_mumble_05.wav` |
| `mgr_line_found_02` | 目の前 `enemy_breath_close` 3 周目 B | みいつけた | 低い声で、ゆっくり | Rocko・80 | `assets/audio/tts/mgr_line_found_02.wav` |
| `mgr_line_found_03` | 目の前 `enemy_breath_close` 3 周目 C | みーつけた | 耳元の囁き声 | Grandpa・95 | `assets/audio/tts/mgr_line_found_03.wav` |
| `mgr_scream_04` | 叫び `enemy_scream` 3 周目 B・ロッカー `locker_burst` 3 周目 B | うああああああああああ | 喉が裂ける叫び。息を多めに | Grandpa・130 | `assets/audio/tts/mgr_scream_04.wav` |

- 主人公・放送の声は今は無い(P4a-3 の範囲外)。増えたらこの表に行を足す。

## P4b: ゲームでの使い方と差し替え(2026-11-02)
- ゲームで鳴る声の場面は 2 つ:`enemy_breath_door`(採用 B。`mgr_line_know_01`・`mgr_door_laugh_01`・`mgr_door_line_02` を立ち止まるたびに順に)と `x105_scream`(採用 C。`mgr_scream_01`＋`mgr_scream_02`。B1 の戻りの遠い悲鳴にも)。他の行は試聴盤の候補用(3 周目の選択の後に接続)。
- 声は **wav に焼き込まない**。ゲームが鳴らす時に素材(`assets/audio/tts/<ID>.wav`)へ `src/audio_voice.js` の加工(低く遅く・扉越しのこもり・残響など。試聴盤の採用候補と同じ関数)を掛ける。音量は読み込み時に自動で揃える。
- **録音への差し替え**:録った wav(モノラル。何 Hz でもよい)を同じ ID の名前で `assets/audio/tts/` に置き、ゲーム(と試聴盤)を再読み込みするだけ。`tools/build_audio.sh` の再実行は要らない。
  - `tools/make_tts.sh` を引数なしで実行すると全部を仮声で作り直す(録音も上書きされる)。録音を残したい ID は `KEEP="mgr_line_know_01 …" bash tools/make_tts.sh`、特定の ID だけ作るなら `bash tools/make_tts.sh <ID> …`。
  - 録音の長さが仮声と違って切れ方がおかしい時は `src/audio_voice.js` の `len`(切り出す秒)・`loop`(伸ばす区間)を直す。録音が最初から低く遅いなら `rate` を 1.0 寄りに。


## P4d: 録音の取り込みと仮声の関係(2026-11-02)
- **録音は 1 コマンドで取り込む**:iPhone のボイスメモなどで録った m4a / wav / aiff を `assets/audio/rec_in/` に、ファイル名の先頭を台詞 ID にして置く(例 `mgr_line_found_01.m4a`、`mgr_line_found_01 取り直し.m4a`、`mgr_scream_01_take2.wav`)。リポジトリの直下で `bash tools/import_rec.sh`。macOS 付属の `afconvert` でモノラル 22.05kHz 16bit の wav にし、前後の無音を詰めて `assets/audio/tts/<ID>.wav` へ上書きする。ID がこの表に無いファイルは警告して飛ばす。ゲームを再読み込み(Cmd+Shift+R)すれば鳴る。録り方と優先順は `docs/recording_guide.md`。
- **仮声との関係(KEEP)**:取り込んだ ID は `assets/audio/tts/recorded.txt` に追記される。`tools/make_tts.sh` はこの一覧の ID を**仮声で上書きしない**(従来の `KEEP="ID …"` と併用できる)。仮声に戻したい時だけ `FORCE=1 bash tools/make_tts.sh <ID>`。`rec_in/` は gitignore(元ファイルはコミットしない)。変換後の `tts/<ID>.wav` と `recorded.txt` はコミットする。
- 台詞の言い回しを変えた時は、この表の「台詞」の欄を直す(ID は変えない)。
