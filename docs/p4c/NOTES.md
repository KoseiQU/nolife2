# P4c NOTES — 3 周目の反映(2026-11-02)

入力は `samples/sound_choice.json`(着手時の作業ツリーの版をそのままコミット:7218ca3)。3 周目 9 場面の結果は「管理人の歩き = A、ほかはすべてなし」。

ユーザーの所見(理由):**「作り直しのものは全て機械音感がすごい」**。

## 1. 反映の表(3 周目の 9 場面)
| 場面 | json の pick(メモ) | 反映 | ゲーム側 |
|---|---|---|---|
| `enemy_step_walk` | A(メモ「金属音感をなくして」は 2 周目のもの) | **採用 A**「ゴム底の重い足音」 | `assets/audio/enemy_step_walk.wav`(足音 4 区画 × 0.7 秒 = 2.8 秒・121KB・ピーク −6dBFS)。`src/enemy_audio.js` の `ROUTE.step` → AudioBank。発火点は今まで通り enemy_ai.js の接地コールバック(巡回 0.6・潜伏 0.4・他 0.8)と `_reveal`、spaces/xb1.js の上の階の足音(cutoff 320)。距離減衰(inverse・ref 1.4・rolloff 1.3)と壁越しの lowpass(AI の遮蔽の cutoff)は P4b の採用場面と同じ経路。1 歩ごとに再生速度 0.95〜1.05 で揺らす。音量の倍率 `AUDIO.gain.enemy_step_walk = 1.0` |
| `pl_flashlight` | none | なし | 元々音が無い → 無音のまま(新設しない) |
| `door_wood` | none | なし | 同上 |
| `enemy_presence` | none(2 周目と同じメモ「なにかぼそぼそ呟いてる」) | なし | 同上(P4a で消した鼻歌の代わりは置かない) |
| `enemy_breath_close` | none | なし | 仮音 `synthBreath` を削除。AI の `play('breath')` は記録だけ |
| `enemy_scream` | none | なし | 仮音 `synthScream` を削除。AI の `play('scream')`(襲撃の振りかぶり)は記録だけ |
| `locker_open_slow` | none(2 周目と同じメモ「キイという音がいい」) | なし | rooms.js の仮音 `lockerCreak` を削除。`burstSfx('lockerCreak')` は記録だけ |
| `locker_burst` | none(2 周目と同じメモ「もっと驚かせる音で」) | なし | 元々音が無い → 無音のまま |
| `room_door_rattle` | **redo**(メモ「扉のガタガタ演出自体を無くす」) | **なし扱い**(演出ごと廃止) | 仮音 `synthSlam` を削除。`ROUTE.slam = null` → door_fx.js `rattle` と enemy_ai.js のクローゼットを開ける時の `play('slam')` は記録だけ。扉を揺らす動き自体の削除は P5b-6(enemy_ai.js 側) |

- 3 周目の結果は `samples/sound_lib.js` の **`ROUND3_DONE`**(場面 → 'a' / 'none')に置いた。書き出し(`tools/build_audio.html` の plan)は「3 周目の場面で A/B/C 以外の pick → ROUND3_DONE が none ならなし、無ければ 3 周目の選択待ち」。room_door_rattle の pick が redo のままでも none に入るのはこのため。
- 結果:採用 **23 場面**(wav 21 本・声 2 場面)・なし **39**(31＋8)・3 周目の選択待ち **9**(新 312)・未選択 **1**(`xb1_loop_notice`)。wav 合計 3.95MB(+0.12MB)。
- 既存の wav 20 本は書き出しで作り直されたが差分 0(P4b の「±1 なら残す」の仕組み)。manifest は enemy_step_walk の追加・なし/round3 の入れ替え・totalBytes・説明文の 1 行だけが変わった。

## 2. 削除した仮音
| ファイル | 消したもの | 場面 |
|---|---|---|
| `src/enemy_audio.js` | `synthStep`(作業靴の踵 4 種) | enemy_step_walk → wav に置き換え |
| 〃 | `synthScream`(喉を絞った叫び) | enemy_scream(なし) |
| 〃 | `synthBreath`(目の前の息遣い) | enemy_breath_close(なし) |
| 〃 | `synthSlam`(扉板の連打＋ノブ) | room_door_rattle(なし。クローゼットを開ける時の叩きつけも同じ音だった) |
| 〃 | 仮音用の PositionalAudio 6 本の束(`_makeSource`・`pool`)、`'temp'` の振り分け | — |
| `src/rooms.js` | `lockerCreak`(スチールロッカーの軋み)と PositionalAudio 2 本の束 | locker_open_slow(なし) |

- これで `enemy_audio.js` と `rooms.js` には合成の音が無い。管理人の音はすべて AudioBank(採用)か無音(記録だけ)。`ROUTE` に無い名前も無音(以前は仮音へ落ちていた)。
- `play(名前)` の記録(`enemyAudio.log` の `silent: true`)は残しているので、名前で数える既存テストはそのまま通る。enemy_ai.js・door_fx.js・main.js の呼び出しは変えていない。

## 3. 未選択のまま(試聴盤に残し、接続しない)
- 新 312(無限の自室)の 9 場面:`amb_x312_room_loop`・`x312_clock_tick`・`x312_door_open`・`x312_door_close`・`x312_door_locked`・`x312_key_slam`・`x312_watcher_lookup`・`x312_room_shift`・`x312_bed_creak`。ゲームは今まで通り spaces/x312.js の WebAudio の仮音(312 の開かない扉は story.js `_sfx('rattle')` の 312 の中だけの仮音)。
- `xb1_loop_notice`(B1 の標識灯):spaces/xb1.js の仮音のまま。
- 試聴盤(`samples/sound.html`)を開いた時点で「選択済み 62 / 72・要再選択 9」+ 未選択 1 = 残り 10 行。3 周目の反映済み 9 行は札が「3 周目・採用済み(A)」「3 周目・なし」「3 周目・なし(演出ごと廃止)」。反映後に選び直すと「3 周目の反映後に変更・書き出しと接続が必要」の札に変わる。

## 4. テスト(ヘッドレス Chrome for Testing・1280×720・自前の tools/serve.py :8031。P5b-6 の未コミット変更が作業ツリーにある状態)
| スイート | 結果 |
|---|---|
| `?test=audio` | **11/11**(AudioContext running) |
| `?test=enemy` | 34/34(25〜34 は P5b-6 が追加中のもの) |
| `?test=rooms` | 8/8 |
| `?test=story` | 19/19 |
| `?test=spaces` | 16/16(性能含む) |
| `?test=building` | 14/14 |
- `?test=audio` の変更:0 読み込み = wav 21・声 2・なし 39(3 周目のなし 8 が `none`)・3 周目 9 がすべて新 312・未選択 1/1 なし = 呼んでも AudioBank に行かない名前に `scream`・`breath`・`slam`・`lockerCreak` を足し、合成のバッファ・束(`enemyAudio.buffers/pool`・`rooms.bufs/pool`)が無いこと/5 = 巡回(PATROL)で `enemy_step_walk` が鳴り、走りの場面に数えられない/10 = 採用 23 場面がすべて 1 回以上、採用以外(なしの 8 を含む)は 0 回。
- wav の 4 区画はそれぞれピーク −6〜−12dBFS、区画の尻 50ms は −90dB(次の区画へ残響が漏れない)。
- 耳では聴いていない。音量の釣り合い(歩き 1.0 と走り 1.3 の差、巡回 0.6 の遠さ)はユーザーの実機で判定。

## 5. 判断と申し送り(ユーザー判断待ち)
1. **room_door_rattle の json は redo のまま**:ユーザーの記録を書き換えず、反映表(`ROUND3_DONE`)で「なし」扱いにした。試聴盤で「なし」を押し直しても同じ扱い(札は変わらない)。
2. **クローゼットを開ける時の叩きつけも無音に**:enemy_ai.js がクローゼットの潜伏から出る時に `play('slam', …, { dur: 0.6 })` を鳴らしていた(ガタガタ扉と同じ仮音)。slam = room_door_rattle = なしなので無音。クローゼットの扉の音そのもの(pl_closet の open 区間)は rooms.js `openCloset` が今まで通り鳴らす。ロッカーの飛び出し(locker_burst)・軋み(locker_open_slow)・襲撃の叫び(enemy_scream)・目の前の声(enemy_breath_close)も無音になったので、**驚かせる場面は今は音なし**。物足りなければ、録音の声に差し替える時に改めて場面を立てる。
3. **enemy_presence・locker_open_slow・locker_burst** は json が 2 周目と同じ「none＋メモ」のまま。指示どおり「なし」で確定扱い(メモは json に残る)。
4. **歩きの音量・揺らぎは仮**:`AUDIO.gain.enemy_step_walk = 1.0`、再生速度 0.95〜1.05、区画 0.7 秒。走り(C 調整・×1.3・大きめ −3dBFS)より明確に小さい。
5. enemy_ai.js 252 行のコメント「歩きは仮音(3 周目)」は古くなったが、enemy_ai.js は P5b-6 が編集中なので触っていない(動作には影響なし)。次に enemy_ai.js を触る人が直す。
6. 新 312 の 9 場面と `xb1_loop_notice` を選んだら:`bash tools/build_audio.sh` → x312.js / xb1.js / story.js の仮音を外して AudioBank へ接続 → `?test=audio` の ADOPTED に足す(P4b NOTES §5)。
7. `docs/p4a/sounds.md`・`docs/p4b/NOTES.md` は既存 docs なので更新していない(3 周目の結果はこの NOTES が正)。

## 6. 変更したファイル
- `samples/sound_choice.json`(ユーザーの選択をそのまま)、`samples/sound_lib.js`(`ROUND3_DONE`・`GAME.scenes.enemy_step_walk`)、`samples/sound.html`(札・案内)
- `tools/build_audio.html`(振り分け)・`tools/build_audio.mjs`(manifest の説明 1 行)、`assets/audio/enemy_step_walk.wav`(新規)・`assets/audio/manifest.json`
- `src/enemy_audio.js`(ROUTE・合成と束の削除)、`src/rooms.js`(lockerCreak と束の削除)、`src/audio_bank.js`(gain 1 行)、`src/spaces/xb1.js`(コメント 1 行)
- `tools/test_audio.js`、この NOTES
- 触っていない:`src/enemy_ai.js`・`src/main.js`・`src/world.js`・`src/enemy.js`・`tools/test_enemy.js`・`tools/test_rooms.js`・`src/spaces/x312.js`・`src/tutorial.js`・DESIGN.md・既存 docs
