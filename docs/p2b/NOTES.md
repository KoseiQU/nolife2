# P2b 敵の動き（ゲーム内）— 引き継ぎメモ

## ファイル
| ファイル | 役割 |
|---|---|
| `src/enemy.js` | 見た目。GLB 読込・AnimationMixer・クロスフェード・表情（grin/attack）・ハンマー（右手）・懐中電灯（左手：円筒＋SpotLight 影 1024＋光の筋）・敵専用ライトのシェーダ注入・足音の接地検出・door_open_in のルートモーション |
| `src/enemy_ai.js` | AI。PATROL / ALERT / CHASE / ATTACK / SCRIPTED（＋内部状態 DEAD）。知覚・経路・鍵で入室。行動はジェネレータ（update(dt) で 1 歩ずつ進むコルーチン） |
| `src/enemy_audio.js` | 音（仮）。WebAudio で合成した鼻歌ループ・足音・鍵束・錠・ノブを PositionalAudio で 3D 再生、壁越しは lowpass |
| `src/peephole.js` | 覗き穴。レンズ位置へカメラ、FOV 110°＋等距離魚眼＋円形マスク＋周辺減光（ShaderPass） |
| `src/main.js` | 統合。扉 API（施錠フラグ・速度倍率）、L 施錠、E 長押し／P 覗き穴、死亡演出とチェックポイント、`window.__N2` |
| `tools/check_enemy.mjs` | Node の機械テスト（GLB を自前パース） |
| `tools/test_enemy.js` | ブラウザ内の決定的テスト。`?test=enemy`（`&fps=1` で 1080p fps 実測） |

## 調整値（コード上の 1 か所）
- `ENEMY`（enemy.js）：懐中電灯（角度 25°・12m・26cd・影 1024）、光の筋の不透明度、敵専用ライト（常夜灯・非常口・窓・半球光・照り返し）、`irradianceKnee`
- `AI`（enemy_ai.js）：速度（巡回 0.62／警戒 1.35／追跡 3.2 m/s）、使うクリップ、視覚距離、聴覚半径、攻撃距離、扉の段取り（開始距離・扉が動くタイミング）
- `ENEMY_AUDIO`（enemy_audio.js）：状態ごとの鼻歌の音量、距離減衰、こもりの cutoff（18kHz→600Hz）
- 歩行の足滑り対策：各歩行クリップの「接地中の足の流れる速さ」をロード時に測り（`clipSpeed`）、移動速度÷clipSpeed を timeScale にする
  - 実測：walk_oldman 0.41 / walk_standard 1.10 / walk_hurried 1.66 / walk_brutal 1.26 / run_intent 3.43 m/s

## 巡回の歩き（DESIGN §3.4.1 の比較）
- 既定は `walk_oldman`（timeScale ≈1.5 で 0.62 m/s）。`AI.clip.PATROL = 'walk_standard'`・`AI.speed.PATROL = 1.0` に変えれば standard で比較できる。実機で決めてほしい

## 音ファイルの名前（P4 で録音に差し替える体系）
置き場所 `assets/audio/enemy/`。`EnemyAudio.buffers` のキーと 1 対 1。
| キー | ファイル名 | 内容 |
|---|---|---|
| `hum` | `enemy_hum_loop_01.ogg` | 巡回中の鼻歌/唸り（ループ、10〜15 秒） |
| `steps[0..3]` | `enemy_step_walk_01..04.ogg` | 作業靴・長尺シートの足音（歩き） |
| （予定） | `enemy_step_run_01..04.ogg` | 走りの足音（現状は歩きの音量違い） |
| `keys` | `enemy_keys_01.ogg` | 鍵束を探る音（約 1.5 秒） |
| `lock` | `enemy_lock_unlock_01.ogg` | 錠を回す音（プレイヤーの施錠 L も同じ音を小さく流用） |
| `rattle` | `enemy_knob_rattle_01.ogg` | 施錠扉のノブを確かめる音 |
| （予定） | `enemy_breath_chase_loop_01.ogg` | 追跡中の息 |
台詞（声）は P4 で `docs/lines.md` と 1 対 1 にする（`enemy_line_<id>.ogg`）。

## デバッグ API（`window.__N2`）
- `pump(dt, n, render=true)`：本物のループと同じ順（player → 覗き穴入力 → AI → enemy(mixer) → doors → 音 → 死亡演出）で n 回
- `enemy.place(x,z,yaw)` / `setState(s)` / `play(name)` / `face(name,v)` / `goto(x,z)` / `flashlight(on)` / `stats()` / `events()`
- `peephole(on)`、`deathState()`、`deaths()`、`doorApi`、`setView`、`setRenderSize`
- `?noai` で AI を止めて起動（SCRIPTED）

## 座標の約束
- 敵の yaw：0 で +Z を向く（モデルの正面）。π/2 で +X
- 410 の扉面 x=7.8（廊下側の面 7.74）、扉中心 z=7.25、蝶番 z=6.835（ノブは +z 側）
- door_open_in の開始位置：扉面から 0.54m 手前、ノブ側へ 0.14m。扉は再生 2.55 秒（f77）で動き出す
- チェックポイント（410 の室内）(8.75, 7.3)、復帰時の管理人 (6.9, 20.6) 北向き
