# P5b-6b 空室のガタガタ扉の廃止

ユーザー指示(2026-11-02)「消したかったガタガタ演出は、むしろ空室の扉が揺れる演出」。DESIGN §3.8 E(廃止)・§7 の P5b-6b 行に従う。
P5b-6 で管理人が扉を揺らす動きは消してあった。今回は `door_fx.js` の「ガタガタ扉」(数分に 1 回、プレイヤーから 4〜15m の空室の扉が 3〜5 秒揺れて鳴る)を消した。

## 消した範囲
| ファイル | 内容 |
|---|---|
| `src/door_fx.js` | `DOORFX.rattle`・`rattleT`・`rattling`・`rattle()`・`_scheduleRattle()`・`update` からの呼び出し・`stats()` の `rattleIn`/`rattling`・使わなくなった `_rand`/`rand()`・ヘッダの説明 |
| `src/main.js` | `if (PARAMS.has('test')) doorFx.rattleT = 1e9;`(テストでの抑止)・コメントの「ガタガタ扉」 |
| `src/world.js` | ガタガタ専用だった `door.shake`/`shakeT`/`shakePhase`(初期値・減算・`_poseLeaf` の揺れの分岐・`_leafAtRest` の条件・`breakDoor` の `shake = 0`) |
| `src/enemy_ai.js` | 巡回で扉を選ぶ時の `!(d.shake > 0)` の除外条件(shake は無くなった) |
| `tools/test_enemy.js` | 20 番を `20_no_rattle_door`(不在の確認)に置き換え。35 番のコメントの「残している」を直した |

`story.js` に rattle を起こす呼び出しは無かった(story の `_sfx('rattle')` は「開かない扉のノブ音」で別物)。

## 残した範囲
- `door_fx.js` の扉の下の隙間(帯・潜伏中の揺らぎ)・奥の闇の箱・壊れた扉の破片・`prepare`・`onBroken`/`onRepaired`。
- `door.rattle`(`world.js` の減算と `_poseLeaf` の 0.004rad)と `main.js` の `best.rattle = 0.25`:プレイヤー自身が開かない扉のノブを試した時のごく小さな揺れ。ガタガタ扉(空室が勝手に揺れる演出)とは別で、プレイヤーの操作への応答なので残した。`enemy_ai.js` 側は P5b-6 で `door.rattle` を立てなくなっている。
- `enemyAudio` の `rattle`(開かない扉のガチャ音)・`slam`(クローゼット等。P4c で「なし」)・`tools/test_audio.js`・`room_door_rattle` の音の扱いは触っていない(音は P4c/P4d の範囲)。

## 判断
- `door.shake` 系は参照が door_fx の `rattle()` だけだったので世界側も一緒に削除した(死んだコードを残さない)。`_poseLeaf` の他の姿勢(開き角・壊れた傾き・ノブの小さな揺れ)は変えていない。
- プレイヤーが開かない空室の扉を押した時の小さな揺れ(0.25 秒・0.004rad)を消すかは、ユーザーの指示(「空室の扉が揺れる演出」)の範囲外と判断して残した。消す場合は `main.js` の `best.rattle = 0.25` と `world.js` の `d.rattle` 周りを消すだけ。
- 管理人が扉を揺らす動き(P5b-6 で消した方)は DESIGN の決定ログどおり消したまま。

## テスト 20 番 `20_no_rattle_door`
- door_fx に `rattle`・`_scheduleRattle`・`rattleT`・`rattling` が無く、`stats()` にも `rattleIn`/`rattling` が無い。
- 4F の空室の扉 14 枚を 600 秒(0.1 秒刻み 6000 フレーム。旧スケジュールなら 90〜160 秒後に初回、以後 150〜300 秒おき)進めても、扉板の回転は常に 0・開き角 0・当たりは閉じたまま・`shake` フィールドなし・doorFx の `rattle` イベントなし・`slam` の再生なし。隙間の帯は 66 枚残っている。

## 結果(ヘッドレス Chromium 1280×720・自前のサーバー 8031)
| スイート | 結果 |
|---|---|
| `?test=enemy` | 35/35 |
| `?test=rooms` | 8/8 |
| `?test=story` | 19/19 |
| `?test=spaces` | 16/16 が 1 回・15/16 が 3 回。落ちるのは `P_perf_vs_4F_corridor`(描画時間。4F 廊下の基準が 8.2〜12.3ms で揺れる計測のゆれ)だけ。p5b6 でも同じ既知の揺れ。この変更は描画を軽くする側 |
| `?test=audio` | 12/12 |
| `?test=building` | 14/14 |
