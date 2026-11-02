# P4b NOTES — 音の本実装(2026-11-02)

入力は `samples/sound_choice.json`(68 場面:採用 22 = A12/B5/C5・なし 40・作り直し 6・未選択 1)。着手時の作業ツリーの版をそのままコミットした(7a4b6a5)。

## 1. 仕組み(全体)
- **書き出し(1 コマンド)**:`bash tools/build_audio.sh`(= `node tools/build_audio.mjs`)。依存なしの Node スクリプトが自前の静的サーバーとヘッドレス Chromium(Playwright のキャッシュ → /Applications の Chrome の順に探す。`CHROME=` で指定可)を立て、`tools/build_audio.html` が `samples/sound_lib.js` の採用候補を `OfflineAudioContext` で描く。
  - 出力:`assets/audio/<場面 ID>.wav`(22.05kHz・16bit・モノラル。試聴盤と同じ正規化:効果音ピーク −6dBFS/RMS −18、大きめ −3/−15、環境音 RMS −26)と `assets/audio/manifest.json`(場面ごとの候補・長さ・ループ/足音の区画/区間・調整の印、声の場面、なし・3 周目・未選択の一覧)。
  - 場面 ID と wav 名は 1 対 1。採用から外れた場面の wav は消す。候補 ID は小文字(json の大文字 A/B/C は読む時に小文字へ)。
  - 描画の浮動小数の揺れで数サンプルが ±1(16bit の最下位)変わることがある → その程度なら既存のファイルを残す(git に無意味な差分を出さない)。
  - 切り方は `sound_lib.js` の `GAME`:環境音は尻 2 秒を頭へ等パワーで重ねたループ、足音は 1 歩ずつの区画(sprite)を並べた 1 本、クローゼットは開ける/閉める区間(segs)、落ちる物は割れ物/本/缶の区間。
- **再生器** `src/audio_bank.js`(`AudioBank`):manifest と wav を読み、場面 ID で鳴らす。位置音は PannerNode(inverse。基準は管理人の音と同じ ref 1.4・rolloff 1.3)、壁越しは呼び出し側が渡す lowpass(管理人の音は `EnemyAudio` の遮蔽の cutoff をそのまま渡す)。環境音は `loop(id)` の持ち手に目標音量を渡し、0 まで下がると音源を止める。鳴らそうとした場面は AudioContext が止まっていても `count`・`log` に残す(テスト用)。場面ごとの音量の倍率は `AUDIO.gain`(耳で決める値)。
- **声** `src/audio_voice.js`:声の場面は wav に焼かず、ゲームが鳴らす時に素材 `assets/audio/tts/<台詞 ID>.wav` へ加工(Kit で組む関数)を掛ける。同じ関数を試聴盤の採用候補も使う。音量は読み込み時に 1 回オフラインで描いて揃える(録音に替えても自動で揃う)。
- `Kit`(合成の道具箱)と仮声の読み込みは `samples/sound_lib.js` から `src/audio_kit.js` へ移した(試聴盤・書き出し・ゲームの声で共有)。`Kit.vox` に `dry`(声そのものの量。小さいほど囁き)と `raspQ` を足した。
- 管理人の音 `src/enemy_audio.js` は `ROUTE` で名前 → 場面に振り分け:採用は AudioBank、なし(`rattle`・`handle`・`latch`)は無音で記録だけ(`silent: true`。既存テストが名前で数える記録は今まで通り)、3 周目待ち(歩きの `step`・`scream`・`slam`・`breath`)は合成の仮音のまま。合成の仮音は使わなくなった 6 本(rattle・hit・handle・crash・breathDoor・latch)を消した。

## 2. 採用 22 場面 → wav → 発火点
| 場面 | 候補 | wav(秒) | 発火点(ファイル:どこ) | 音量・備考 |
|---|---|---|---|---|
| `pl_step_room` | A | pl_step_room.wav(足音 4 区画) | main.js `player.onStep`(player.js が一歩ごとに合図)。居室(kind unit)と 312 の中だけ | 歩き 0.75・走り 1.0 × 0.35 |
| `amb_corridor` | A | amb_corridor.wav(8.0 ループ) | main.js `updateAmbience`:1〜7F の各階で部屋・階段の区画の外(廊下・EV ホール) | 1.0 × 0.5 |
| `pl_closet` | A | pl_closet.wav(open 0–0.75 / close 1.7–2.65) | rooms.js `openCloset`(open)・`closeCloset`(close)。隠れる・出る・管理人がクローゼットを開ける | ×0.6 |
| `room_fall` | A(調整) | room_fall.wav(glass/books/cans の区間) | rooms.js `_updateFallables` の着地。種類 → 区間は manifest の `types` | ×1.0 |
| `ev_chime` | A | ev_chime.wav | elevator.js 到着時 `_sfx('chime')`(カゴの位置) | ref 2 |
| `ev_motor` | A | ev_motor.wav(6.5 ループ) | elevator.js `_updateAudio`:走行中だけ。乗っていれば耳元 0.8、外ならカゴの位置で 0.28。止まると音源を止める | — |
| `enemy_step_run` | C(調整) | enemy_step_run.wav(足音 4 区画) | enemy_ai.js の接地コールバック(`run_intent` の時 `{ run }`) | ×1.3 |
| `enemy_breath_door` | B(＋台詞 2 本) | 声(wav なし) | enemy_ai.js `_roomLurkTick`(潜伏室の扉の前で 1 秒静止・5 秒おき)。3 本を順に | AI の 0.16 × 2.5。扉越しのこもりは加工の中 |
| `enemy_door_smash` | C(調整) | enemy_door_smash.wav | enemy_ai.js `_burst`(同じ階 / 1 階差 0.32・cutoff 700 / 2 階差 0.1・380) | ref 9 |
| `enemy_hit` | A(調整) | enemy_hit.wav | attack_movie.js `hit` | ×1.0 |
| `death` | A | death.wav | main.js `updateDeath` の 0.85 秒(暗転の手前。襲撃・別空間の死の両方) | ×0.9 |
| `story_221_lure` | A | story_221_lure.wav | story.js `_lure221`:第 1 段で 221 に入ると 0.6 秒後、居る間 11 秒おき(奥の窓際のロッカーの前から。飛び出しの後は鳴らない) | ×0.7・ref 2.5 |
| `pickup_key` | A | pickup_key.wav | story.js `pick`(鍵) | ×0.6 |
| `pickup_paper` | A | pickup_paper.wav | story.js `pick`(メモ) | ×0.6 |
| `amb_x105` | C | amb_x105.wav(8.0 ループ) | spaces/x105.js `sound`:灰色の区間へ進むほど 0.6→1.0、追跡中に消えた灯りの所は半分。`leave` で 0 | ×0.7 |
| `x105_scream` | C(調整) | 声(wav なし) | spaces/x105.js 追跡の始まり(`appear_105`)・spaces/xb1.js 戻りの遠い悲鳴(0.35・cutoff 450) | ref 6 |
| `amb_outdoor` | B | amb_outdoor.wav(8.0 ループ) | main.js `updateAmbience`:敷地 G(1.0)・外階段/北階段の区画(0.7) | ×0.8 |
| `amb_roof` | A | amb_roof.wav(8.0 ループ) | main.js `updateAmbience`:屋上A・屋上B(1.0)・バルコニー(0.4)。rooms.js の風の合成を置き換え | ×1.0 |
| `x705_lights_off` | B | x705_lights_off.wav | spaces/x705.js 鍵を取った瞬間 `sfx('lights_off')` | ×0.9 |
| `amb_b1` | B | amb_b1.wav(8.0 ループ) | main.js `updateAmbience`:XB1(1.0)・B1(0.8)・1F の地下への階段の区画(0.35)。main.js の水滴 `updateDrips` と xb1.js の水の合成を置き換え | ×0.9 |
| `car_engine` | B | car_engine.wav | story.js `_engine('start')`(座った瞬間) | ×0.8 |
| `ending_gate` | C(調整) | ending_gate.wav | story.js `_engine('drive')`(t=2.4。エンジンを 1.2 秒で畳んで受け渡し)→ `stop`(エンディング画面、0.6 秒で消す) | ×0.9 |

- wav 20 本 **合計 3.83MB**(manifest.totalBytes 4,017,354 バイト)、仮声 20 本 2.9MB。`node tools/check_glb.mjs` の 24.20MB(上限 35MB)は build/ だけを数えるので変わらない。音を足しても 24.20+3.83+2.9 ≈ 30.9MB。
- 「なし」で消した仮音(31 場面。プール系 6 場面はコードに既に無い):開かない扉のガチャ(main・story・105・B1 の扉、管理人がノブを確かめる)、取っ手、空室の扉の開け閉め、鍵を使う、車のドア、6F の偽の鍵、EV の扉、窓と乗り越え、ロッカーの中で当たる予兆、105 の背後の灯りが消える音、705 の空気と歪みのうなり、705/B1 の扉がひとりでに開く軋み、B1 の扉が閉まる音・抜ける音・鍵の低音。居室・ロビー・カゴの中・705・迷路・廊下/屋外/外階段の足音・ゲームオーバー・チェックポイント・窓越しの管理人などは元々音が無い(新設予定だった)ので無音のまま。
- 3 周目の選択待ち(仮音のまま):管理人の歩き(`step`)・襲撃の叫び・ガタガタ扉・目の前の息遣い・ロッカーがゆっくり開く軋み、312 の中の音(x312.js の WebAudio の仮音。x312.js は触っていない。312 の開かない扉は story の `rattle` を呼ぶので、312 の中にいる時だけ story.js が今の仮音を鳴らす)、未選択の `xb1_loop_notice`(B1 の標識灯)。懐中電灯・木扉・気配・ロッカーの飛び出しは元々音が無い。
- **EV モーターの音量 0 の鳴りっぱなし**(P4a の申し送り)は解消:ループの持ち手は音量 0 まで下がると音源を止める(`?test=audio` 4 番で到着後 4 秒で止まるのを確認)。

## 3. 調整(採用＋メモ)
| 場面 | メモ | 調整 |
|---|---|---|
| `room_fall` A | パリーン！と割れる感じ | 砕ける瞬間の鋭い「パ」(6ms の広帯域)を足し、薄いガラスの鳴り「リーン」を 0.45→0.7 秒に伸ばして強め、2 つ目の鳴りと破片(34→44・尾 26→32)を増やした。本・ファイルと缶は割れないので、同じ残響の作りで「本が落ちる(鈍い 2 打＋紙)」「缶が跳ねて転がる」を派生させて同じ wav の区間に並べた |
| `enemy_step_run` C | もっと大きい音でドタバタ恐怖感を煽る | 一歩ごとに床を踏み鳴らす低音(48→34Hz)と体重の塊を足し、3 割で二度踏み、半分の歩で周りの物がカタつく。歩幅を乱し、最後の踏み鳴らしを 1.25 倍。ゲームの 1 歩もこの形(4 通り)。音量 ×1.3 |
| `enemy_breath_door` B | 息遣いではなく、笑い声かセリフにして | B は 2 周目で既に台詞(「いるのは…わかってるよ」)。メモの方向で短い笑い「ふふふ…ふふ」(`mgr_door_laugh_01`)と台詞「もうすこし…ちかくに、おいで」(`mgr_door_line_02`)を台詞表に足し、3 本を立ち止まるたびに順に鳴らす。加工は B のまま |
| `enemy_door_smash` C | もっと爆発音のような感じ | 一撃目を爆発の衝撃波に:低音の沈み 70→28Hz/0.8 秒 → 62→20Hz/1.6 秒・歪み 2.5→3、地鳴りの尾(1.8 秒)と圧の「ボフッ」を足した。二撃目(扉板が倒れる)はそのまま |
| `enemy_hit` A | もっと重量感のあるものに | 衝撃の低音を 62→30Hz/0.55 秒 → 55→22Hz/0.9 秒、胴に響く 90→40Hz の塊・食い込む低いノイズ・床まで伝わる 38Hz の余韻を足し、骨の鳴りを 900→700Hz に下げた |
| `x105_scream` C | もっと機械音感をなくしたい | 歪み 4→1.4(ブザーのような倍音を出さない)、声でノイズを変調する rasp を主に(息の混じった喉)、同じ素材を 2 本ずらして重ね(18ms・25 セント)、音程の揺れを遅いうねりに(7Hz の震え → 3Hz)、二声目の前に息を吸う音 |
| `ending_gate` C | ジャリジャリ感をなくして | ジャリジャリの元 = 点火パルスにノイズを混ぜたエンジン(`engine`)と段差の軋み。エンジンを倍音の和の滑らかなうなり(`smoothEngine`)に、タイヤを粒の無い低いうなり(brown・140Hz)に替え、軋みを外した |
- 調整した候補は試聴盤でもその音になっている(候補の説明に「P4b: …」、表に「採用・P4b で調整済み」の札)。

## 4. 試聴盤 3 周目(`samples/sound.html`・`sound_lib.js`)
- 72 場面(69 − プール系 6 + 新 312 の 9)。上部の帯を 3 周目の案内に。表の札:3 周目の行は「3 周目・選んでください」/新 312 は「3 周目・新しい場面(312)」、未選択の `xb1_loop_notice` は「未選択」、調整済みの採用は金色の小さな札。開いた時点で「選択済み 53 / 72・要再選択 18」。
  - 「なし＋メモ」から作り直した 3 場面は、pick が none のままでメモが 2 周目と同じ間は「選んでください」と数える(ユーザーが選び直すかメモを変えると消える)。
- 保存先は今まで通り `POST /api/sound_choice`(tools/serve.py)。`sound_choice.json` は触っていない(盤から消したプール系の記録も残る)。
- 3 周目の候補(作り直した 9 場面＋新 312 の 9 場面 = 54 本。旧候補は消した):
| 場面 | A | B | C |
|---|---|---|---|
| `pl_flashlight`(カチッ) | 小さなスイッチの「カチッ」 | 金属の「カチッ」 | 少し重い「カチッ」 |
| `door_wood`(がちゃっ) | レバーの「ガチャッ」 | 丸ノブの「ガチャ」 | 少し重い「ガチャッ」 |
| `enemy_presence`(ぼそぼそ呟く) | 壁越しのぼそぼそ(声) | 通り過ぎながら呟く(声) | 囁きの呟き(声) |
| `enemy_step_walk`(金属音感なし) | ゴム底の重い足音 | 革底(響きなし) | 片足を擦る |
| `enemy_breath_close`(みいつけた・機械音感なし) | 囁き「みいつけた」 | 低い声と息(二重) | 耳元で、間を置いて |
| `room_door_rattle`(機械音感なし) | 激しく揺さぶる(不規則) | ノブを回す→体当たり | 間欠(数回→沈黙→一番大きく) |
| `enemy_scream`(機械音感なし) | 息の多い絶叫(3 本重ね) | 喉が裂ける叫び(声＋喉の息) | 低い咆哮(胸に響く) |
| `locker_open_slow`(キイ) | 短い「キイ」 | 「キ…イ」と二段 | ゆっくり「キイィ」(錆) |
| `locker_burst`(もっと驚かせる) | 無音→轟音と金切り声 | 扉が二度叩きつけられる | 鋭く息を吸う→炸裂 |
| `amb_x312_room_loop` | 冷蔵庫(柔らかく) | ほぼ無音(部屋の空気) | 冷蔵庫が止まる |
| `x312_clock_tick` | 静かな秒針「チッ」 | 「カチ・コチ」 | 置時計(少し響く) |
| `x312_door_open` | 「ガチャッ」→ゆっくり開く | 静かに開く | 長い軋み |
| `x312_door_close` | 「バタン」 | 静かに「カチャン」 | 背後で閉まる(こもる) |
| `x312_door_locked` | 「ガチッ」と止まる | 枠で 2 回鳴る | 重い手応え |
| `x312_key_slam` | 遠くで「バーン」 | 部屋ごと揺れる | 閉まる→鍵が掛かる |
| `x312_watcher_lookup` | 衣擦れと首の鳴り | 低く息を吸う | 静寂に心拍が一つ |
| `x312_room_shift`(案) | 家鳴り一つ | 遠くで扉が閉まる | 耳がつまる |
| `x312_bed_creak`(案) | スプリングの軋み | 木枠の軋み | 体重を移す軋みと布擦れ |
- 機械音感への手当て(声の候補すべて):再生速度を 0.7 倍前後 → 0.82〜0.95 倍に(大きく音程を動かすと合成音声の継ぎ目が目立つ)、強い歪みをやめる、音程の揺れは 2〜3Hz のうねり、囁き(dry を下げて rasp を主に)、同じ声を 2〜3 本ずらして重ねる、前後に息を吸う/吐く音。足音・扉は金属の固有振動を外し(`softStep`)、揺さぶりは毎回強さ・間隔・扉板の鳴りをばらつかせた(`doorHit`)。
- 仮声を 7 本足した(台詞表 `docs/lines.md`):`mgr_door_laugh_01`・`mgr_door_line_02`(ゲームで使用)、`mgr_mumble_04/05`・`mgr_line_found_02/03`・`mgr_scream_04`(3 周目の候補用)。既存 13 本は作り直しても同一(say は決定的)。

## 5. 差し替え手順
- **選び直した時**(試聴盤で A/B/C を変えた・3 周目を選んだ):`bash tools/build_audio.sh` を実行するだけで、wav と manifest が作り直される。ただし**新しく採用された場面の発火点(接続)はコードに足す必要がある**(3 周目の 18 場面は今は仮音/無音。§2 の「3 周目の選択待ち」と docs/p4a/sounds.md の呼び出し元の欄が接続先)。採用 → なしに変わった場面は wav が消え、鳴らなくなる(AudioBank は manifest に無い場面を鳴らさない)。
- **声の録音**:録った wav を同じ台詞 ID の名前で `assets/audio/tts/` に置いて再読み込み(build は不要)。仮声を作り直す時は `KEEP="<録音した ID> …" bash tools/make_tts.sh` で録音を残す。録音の長さで切れ方がおかしければ `src/audio_voice.js` の `len`・`loop` を直す(仮声の長さに合わせてある)。
- **効果音を録音や別の素材に替える**:`assets/audio/<場面 ID>.wav` を同名で置けば鳴る(足音・ループ・区間の場面は manifest の `sprite`・`segs` の秒に合わせるか manifest を直す)。ただし `tools/build_audio.sh` を再実行すると候補の合成で上書きされる。
- 音量の調整は `src/audio_bank.js` の `AUDIO.gain`(場面ごと)と main.js の `AMB`(場所ごとの環境音)。

## 6. テスト(内蔵ブラウザ・tools/serve.py :8001・1280×720 指定)
| スイート | 結果 |
|---|---|
| `?test=audio`(新設) | **11/11** |
| `?test=enemy` | 24/24 |
| `?test=spaces` | 16/16 |
| `?test=story` | 19/19 |
| `?test=rooms` | 8/8 |
| `?test=building` | 14/14 |
- `?test=audio`:0 読み込み(wav 20 本の長さ・声 2 場面の音量合わせ・振り分け なし 31/3 周目 18/未選択 1)/1 なしの場面は AudioBank に行かない(開かない扉を E で引いても記録だけ)/2 居室の足音(廊下では鳴らない)・クローゼットの open/close・落ちる物の glass/books/3 環境音の場所(居室・1F ロビーは無音)と離れると止まる/4 EV の走行音 → チャイム → 走行音が止まる/5 追跡の足音・扉の向こうの声(声として)・扉を破る → 一撃 → 死亡/6 221 の電話(廊下では鳴らない)・メモ・鍵/7 105 の空気と悲鳴(声)・出ると止まる/8 705 の消灯/9 エンジン → 門/10 **採用 22 場面すべてが 1 回以上呼ばれ、それ以外の場面は 0 回**。
- 内蔵ブラウザでは AudioContext が running になり、実際に鳴っている:listener の出力を AnalyserNode で測り、無音 −180dBFS → pickup_key −10 / room_fall −6 / enemy_hit −2.9 / death −6.4 / ev_chime −6.8 / x105_scream −8.6 / 扉越しの声(ゲームの音量 0.16)−14.2 dBFS(ピーク)。ループの継ぎ目は 6 本とも頭と尻の差 15〜124/32768(≈ −50dB)、包絡に欠けなし。
- 試聴盤:216 候補(72×3)をオフラインで描いて例外 0・ピーク上限超え 0。声の 3 周目候補の 0.25 秒刻みの包絡で、台詞・息・衝撃が設計どおりの位置にあるのを確認。
- 耳では聴いていない(エージェントは聴けない)。音色・怖さ・音量の釣り合いはユーザーの試聴と実機で判定。

## 7. 判断と申し送り(ユーザー判断待ち)
1. **声の場面は wav 20 本に含めない**:指示「声は素材＋ゲーム側で加工(焼き込まない)」に従い、採用 22 のうち声の 2 場面(`enemy_breath_door`・`x105_scream`)は `assets/audio/<場面>.wav` を作らず、素材(tts)＋`src/audio_voice.js` の加工で鳴らす。場面 ↔ 台詞 ID の対応は `audio_voice.js` と `docs/lines.md`。
2. **落ちる物の本・缶**:採用 A は割れるガラスの音なので、本・ファイル(18 個)と缶(16 個)は同じ作りで派生させた区間を鳴らす(sounds.md の P4a の申し送りどおり)。ユーザーが試聴していない音なので、気になれば 3 周目に足す。
3. **6F の罠の偽の鍵**:`decoy_key` が「なし」なので、偽の鍵を取っても無音(本物の鍵だけ pickup_key が鳴る)。本物と同じ音にしたい場合は `story.js pick` の `_sfx('decoy')` を `'key'` に戻すだけ。
4. **312 の中の自分の足音**:312 の部屋は 410 の複製なので、居室と同じ `pl_step_room` を鳴らす(main.js。x312.js は触っていない)。
5. **221 の電話**:鳴る位置は奥の窓際のロッカーの前、間隔 11 秒(`STORY.lureEvery`)。部屋に入った時だけで、飛び出しの後と廊下では鳴らない。
6. **廊下の環境音**:採用 A は空調の広帯域のうなり(音程なし)のループで、1〜7F の廊下・EV ホールにいる間は常に鳴る(P4a で消した「ジー」とは別物だが、常時鳴る音)。うるさければ `AUDIO.gain.amb_corridor`(0.5)を下げる。
7. **エンディング**:門の段差の「ドン」は ending_gate の 3.5 秒 = 走り出しから 3.5 秒(t=5.9)で、映像の門(t≈10)とは合っていない(候補の作りのまま)。合わせるなら候補の段差の時刻を 7.5 秒へ。
8. **音量は全部仮**:`AUDIO.gain`・`AMB`・扉越しの声(AI の 0.16 × 2.5)など、耳で決める値。実機で調整してほしい。
9. 3 周目の選択が終わったら、選ばれた場面の接続を足す(§5)。`xb1_loop_notice` も未選択のまま。
10. `samples/sound_lib.js` の旧 `REDONE`/`ROUND2` は残し、`ROUND3`・`ADJUSTED`・`GAME` を足した。`docs/p4a/sounds.md` は既存 docs なので更新していない(3 周目の履歴・新しい候補はこの NOTES が正)。

## 8. 変更したファイル
- 新規:`src/audio_bank.js`・`src/audio_kit.js`・`src/audio_voice.js`・`tools/build_audio.sh`・`tools/build_audio.mjs`・`tools/build_audio.html`・`tools/test_audio.js`・`assets/audio/*.wav`(20)・`assets/audio/manifest.json`・`assets/audio/tts/` の 7 本・この NOTES。
- 変更:`src/main.js`(AudioBank・環境音・自分の足音・死亡の音・`?test=audio`・`__N2.bank`)、`src/enemy_audio.js`(ROUTE)、`src/enemy_ai.js`(走りの印 1 行)、`src/elevator.js`・`src/rooms.js`・`src/story.js`・`src/player.js`(一歩の合図)、`src/spaces/x105.js`・`x705.js`・`xb1.js`、`samples/sound_lib.js`・`sound.html`、`tools/make_tts.sh`、`docs/lines.md`(台詞 7 行と P4b の使い方)、`assets/LICENSES.md`。
- 触っていない:`src/spaces/x312.js`・`src/enemy.js`・`tools/blender/*`・`build/enemy/*`・`src/tutorial.js`・DESIGN.md。
