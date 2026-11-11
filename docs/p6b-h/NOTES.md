# P6b-H 引き継ぎメモ（§3.14 リスポーンと 705 の追跡）

## #1 リスポーン時の管理人の階（`src/enemy_ai.js`・`src/main.js`）

- `main.js` の死亡→復帰（`death.respawned = true` の処理）で、従来どおり `ai.reset(ENEMY_HOME)`（4F の EV ホール）→ `story.afterRespawn()` の**後**に `ai.onPlayerRespawn(sp.level)` を呼ぶ（`?tour`・`?noai` 以外。物語なしのテストでも呼ぶ）。
- `ai.onPlayerRespawn(lv)` = `ai.evacuateFloor(lv, { why: 'respawn' })`:
  - 階は `_floorNum`（`_playerFloorNum` と同じ数え方。異空間は入口の階、敷地・B1 は 1F、屋上B は 7F）。
  - dormant（第1段の待機）なら何もしない（猶予も掛けない）。`respawn_avoid { skip: 'dormant' }`。
  - 管理人の階がその階 or その階へ向かっている（`goalLv`。EV で移動中も `_goTo` が記録）なら移す: 2 階以上離れた階（ほかに避けている階は外す）から乱数で 1 つ。無ければ最も遠い階。その階の EV ホール（`ai.home` = `ENEMY_HOME`）へ `reset`。EV の乗客の印（`elevator.npc`）は外す。暗転中・別の階なので見えない。
  - その階を 45 秒避ける（`AI.respawnAvoid.sec`）。
- 避ける階は階ごとの `Map`（`ai.avoids`）にした。リスポーンの 45 秒と異空間の 30 秒が別の階で重なっても両方効く。同じ階は長い方。`ai.avoid` は最後に掛けた 1 件（従来の読み口・テスト用）。`clearAvoid()`（`applyStage` が使う）。
- `ai.reset` で `goalLv` を消す（古い行き先で「その階へ向かっている」と誤判定しない）。
- 地下（XB1）の C の演出中の死亡: 既存の片付け（`xb1.respawn`）→ main の `reset` で本体は 4F → 復帰先は 1F 扱いなので動かさず 1F を 45 秒避けるだけ。

## #2 705 の追跡（`src/story.js`・`src/spaces/x705.js`・`src/hud_text.js`）

- X705 の出口（第9段の `chase`）→ `_afterSpaceExit` が `_startEscape('exit')`（旧 `space_exit_chase_kept` を置き換え。記録は `space_exit_escape`）:
  - 副段 `escape`、目標キー `'9e'`「エレベーターで1階へ」。
  - `pending` を消す（追跡の開始の「現れる」予定が残っていても出さない）。カゴを 7F に止める（`_parkCar(7)`）。
  - 管理人: chaseOmni・chaseFast を解く、`allowStairs = false`・`noEV = true`（カゴを使わない＝カゴは 7F で待つ。階の移動は姿を消して行う既存の代替）、705 の出入り口（portal）を消す、`evacuateFloor(7, { sec: 45, to: 4 })`（7F・X705 にいれば 4F の EV ホールへ）。
- `evDisabled` は従来どおり第10段以上だけ。EV のカゴの中で扉が閉まったら `_endFinalChaseByEV`（escape も）: 1F にいる・1F へ向かっている・追跡系の状態の管理人だけ 4F へ移し、1F を 30 秒避け、`noEV = false`。1F に着いたら第10段（682 行の条件に escape を追加）。
- 死亡復帰（2026-11-12 改訂の契約）:
  - **705 の中（chase）**: `x705.respawn` が机の手前（`Z(31.4 − 0.4 − 0.55)`・南の机を向く）を返す。広間は同じ空間なので `enter` をやり直さない＝反転したまま（灯りは消え、出口は南）。鍵（b1）は持ったまま、副段 chase のまま。`story._retryFinalChase` が 2.0 秒後（`STORY.chaseRetryDelay`）に従来の追跡の開始と同じ `appear`（ambush = 南の出口の口、lock 1.0・recover 1.5）。復帰の瞬間の管理人は main の `reset` で 4F。
  - **escape（705 を出た後）・それ以外**: 7F の廊下（`SPAWN['9c']`）・副段 escape（`_startEscape('respawn')`。管理人の移動と 7F の 45 秒は #1）。
- 鍵を取った後に 705 へ入り直した暗い広間（keyBefore）から出た時は通常の異空間の出口の処理（7F を 30 秒。Map なので 45 秒の残りは消えない）。

## テスト

| スイート | テスト | 内容 |
|---|---|---|
| enemy | `42_p6bh_respawn_manager_leaves_floor`（新規） | A: 4F の廊下で捕まる → 復帰の瞬間に管理人 7F（4F から 3 階）・PATROL・4F の重み 0。続く 44.5 秒、4F で走る＋3 秒ごとに 4F の大きな物音＋潜伏先の階を毎 3 フレーム引く → 4F に 0 フレーム・4F へ向かう 0・heard_floor(4F) 0・floor_noise_avoided 29 回・lurk_pick(4F) 0・`_chooseFloor` が 4F 0 回。45.3 秒で猶予が切れて重み 1.35。B: 2F の管理人が 4F の物音で EV に乗って移動中（transit・goalLv 4・カゴ moving）→ `onPlayerRespawn(4)` → 7F・transit なし・goalLv なし・乗客の印なし、15 秒 4F に来ない。C: dormant は動かさず猶予もなし |
| story | `9_705_space_final_chase`（追従） | 出口を抜けてから 5 秒: 管理人が 7F・X705 に 0 フレーム・CHASE/APPEAR 0 フレーム・副段 escape・目標「エレベーターで1階へ」・7F の猶予の残り 39.5 秒・705 の出入り口なし → 呼ぶ → 乗って 1 → 扉が閉まって `final_chase_ev`（1F を避ける）→ 1F で第10段。旧「管理人を東の端へ離して遅くする」細工は削除 |
| story | `22_p6bh_705_death_retry_and_7F_death_escape`（新規） | 705 の机の前で捕まる → 705 の中の机の手前（z 30.45）に復帰・chase・鍵 b1・反転のまま・復帰の瞬間の管理人は 4F（距離 ∞）→ 2.02 秒後に ambush に現れる（距離 15.85m）→ 3.53 秒で CHASE。復帰後の最小距離 12.19m。そのまま逃げて出口 → escape。escape 中に 7F で捕まる → 7F の廊下（16.2, 21.2）・escape・管理人 4F・3 秒 7F に 0 フレーム |
| spaces | `705_2_key_lightsout_reverse_manager_exit_ends_chase`（旧 `..._manager_chase_7F` を改名・新契約に） | 出口を抜けた後 8 秒、管理人は 7F・X705 に 0 フレーム・CHASE でない・escape・目標 9e |

`test_enemy` の `W.reset` で `clearAvoid()` と `ai.events.length = 0` を足した。AI の記録は 400 件で古い方から捨てるので、`ev0 = events.length` の番号で切り出すテスト（34・35）は、死亡 1 回ぶんの記録が増えただけで満杯になって崩れていた（変更前の HEAD では 41/41、変更後は 34・35 だけ落ちる。単独では通る）。

全スイート（1280×720 ヘッドレス、`:8011`）: enemy 42/42・story 26/26・spaces 16/16・building 20/20・tutorial 7/7・xb1 8/8・x105 3/3・audio 15/15・rooms 8/8。

## 既知の妥協点

- 管理人の「transit で移す」は既存の `reset`（瞬間移動）。暗転中か別の階でしか起きないので見えない。
- main は復帰時に必ず管理人を 4F の EV ホールへ `reset` する（既存）。なので「復帰先の階にいる」が実際に起きるのは復帰先が 4F の時（第1段の return・第8段・物語なし）。「向かっている」の取り消しは API の中身としてテストした（main の流れでは reset が先に行き先を消す）。
- 復帰先が 4F の時の移し先は乱数（1・2・6・7F）。7F や 6F に移ることがある（45 秒は 4F を避ける）。
- 705 の中で死んだ時、管理人は従来の追跡の開始と同じ ambush（南の出口の口）から現れる。改訂の連絡にあった「広間の反対側（出口と逆）」は、従来の追跡の開始（出口側から現れる）と食い違うので、「従来と同じ」を優先した。北（入口側）から出す場合は `_retryFinalChase` の appear の座標を変えるだけ。
- escape の間の管理人は `noEV = true`（カゴを使わない。階の移動は姿を消す代替）。カゴが 7F を離れないための選択。プレイヤーが乗って扉が閉まると `noEV = false` に戻る。
- 物語なしの `?test=enemy` でも死亡で管理人が別の階へ移る（テストは `W.reset` で 4F に戻す）。
