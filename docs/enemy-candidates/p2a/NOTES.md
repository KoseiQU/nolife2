# P2a リグ移植（候補 07「管理人」）

再生成: `tools/build_enemy_rigged.sh`（merge → 機械チェック → レンダ 12 枚、約 3 分）

## ① 方式
- 入力: `build/enemy/mixamo/idle_breathing_skin.fbx`（スキン付き・Standard Skeleton 65 骨）＋スキンなしアニメ 11 本（FBX 7.7・30fps）。
- `tools/blender/mixamo_merge.py`
  1. 本番メッシュ `07_prod_mesh.blend`（形状キー grin/attack・13 材質）を読み、三角形化。服・靴の材質は不透明に固定（FBX 由来の Alpha 接続で靴が白く透けたため）。
  2. スキン付き FBX を読み、Mixamo メッシュが 1/100 で入る癖を骨格側の拡大率で補正（高さ比 0.01 → 補正後の中心ずれ 0）。
  3. 重みの移植: 本番頂点ごとに Mixamo メッシュの最近傍 4 頂点から距離逆数で重みを補間し、4 影響・正規化（形状キー付きメッシュは Data Transfer を適用できないため自前実装）。Mixamo メッシュは削除。
  4. アニメ 11 本を読み、骨名を `mixamorig:` に揃え、アクション名＝ファイル名。各アクションをミュートした NLA トラックに置く。
  5. ハンマー: `hammer.glb` を `mixamorig:RightHand` の子に。握り位置＝中指付け根寄り 75%＋掌側 2.5cm、柄＝人差し指〜小指の並び方向、頭＝親指・人差し指側。
  6. 右手の指 15 骨を「握り」の定数キーで全アクション上書き（Mixamo の素の右手は開いており、ハンマーが浮いて見えたため）。
  7. テクスチャ縮小（肌 4096・他 2048）→ GLB（スキン・形状キー・アクション）。ハンマーは GLB に入れない。
- `tools/blender/enemy_render.py` に `--action <名前> --frame mid|peak_hand|max_head|<数>` を追加（threequarter/peephole/insitu 対応）。

## ② 機械チェック（19/19 OK、詳細は `check.json`）
| 項目 | 値 | 基準 |
|---|---|---|
| GLB 再読込: 三角形数 | 57,879 | 57,879 |
| GLB 再読込: 形状キー | grin, attack | 2 本 |
| GLB 再読込: アクション数 / 各長さ>0 | 11 / 21〜191 フレーム | 11 / >0 |
| GLB のアニメ名＝ファイル名 | 一致 | 一致 |
| 重みなし頂点 | 0 / 46,295 | 0 |
| 最近傍が 2cm より遠い本番頂点 | 0 | 0 |
| `mixamorig:RightHand` | あり（65 骨） | あり |
| アニメ骨名の一致 | 全一致 | 不一致なし |
| 帽子の追従（look_nervous f21・首振り 61.9°） | Δ0.0mm | ±5mm |
| 髪の追従（同フレーム） | Δ0.0mm | ±5mm |
| 服の貫通（walk_careful f70） | 0 頂点 | 0 |
| ハンマー: 骨の子での位置誤差 / GLB 骨階層からの再計算誤差 | 1e-7 / 0.0 m | <1e-4 |
| GLB サイズ | 16.4 MB | ≤40 MB |

## レンダ
- 各アニメ代表フレーム 11 枚（斜め 45°・中立照明・ハンマー付き）: `<アクション名>.jpg`。中間フレーム、ただし look_nervous は首振り最大、attack_downward / attack_bash は右手が最も高いフレーム。
- `attack_downward_peak_attack_peephole.jpg`: attack_downward f25（振りかぶり頂点）＋ attack 1.0、覗き穴距離・懐中電灯を下から。

## 自己批評（1 周）
- 関節の破綻: 膝の深い曲げ（walk_careful の高い膝上げ・run_intent）、肩の挙上（attack 2 本）とも崩れなし。
- 服の貫通: 目視でも肌の露出なし。襟元は首を強く振ると内側の暗い縁が見える程度（覗き穴画像の首元）。
- 帽子・髪: 全 12 枚で頭に密着して追従。歪みなし。
- ハンマーの向き: 振りかぶりで頭が上、歩きで前向き水平。→ 1 周目で「右手が開いていてハンマーが浮く」を発見し、指の握り固定（①-6）で修正済み。

## ③ 既知の妥協点
- 左手は無視: attack_downward（片手振り）で左手は空いたまま。両手持ちにはしていない。
- 両手を寄せるアニメ（look_idle・run_intent・walk_brutal）で、ハンマーの頭が左前腕・腕章に重なるフレームがある（素材のアニメが手ぶら前提のため）。P2b でこの 3 本を使う場面ではハンマーを隠すか、カメラから見えにくい区間に限る。
- 右手の指は全アクションで握りっぱなし（Mixamo の指の動きは捨てた）。react_surprised でも右手は握ったまま、親指だけ立つ。
- `idle_breathing` は GLB に入れていない（スキンの供給元としてのみ使用。必要なら `--keep_idle`）。
- door_open_in のみルートモーション入り（Hips が前へ 1.79m 進む）。他 10 本はその場（turn_* の横ずれ 2cm 程度）。
- 書き出し時に glTF の「1 材質に画像ノードが複数」警告が出る（肌の汚れ重ね用。先頭の画像の sampler が使われるだけで見た目に影響なし）。

## ④ P2b への引き継ぎ
- ファイル: `build/enemy/07_rigged.glb`（16.4 MB）＋ `build/enemy/07_rigged_meta.json`、ハンマーは別ファイル `build/enemy/hammer.glb`。
- 単位 m、glTF の +Y が上、キャラは +Z を向く。30fps。
- ノード: メッシュ `N2E_07_kanrinin`（skin 0・morph `grin` / `attack`）、骨格ルート `N2E_07_rig`（+90°X の回転を持つ。Mixamo FBX 由来、外さないこと）、骨は `mixamorig:*` 65 本。
- アクション（名前 / フレーム数）: walk_careful 138, walk_brutal 42, run_intent 21, look_idle 190, look_nervous 188, door_open_in 191, turn_left 31, turn_right 31, react_surprised 110, attack_downward 68, attack_bash 120。
- ルートモーション: door_open_in のみ（`meta.root_motion_m`、Hips 親空間で +Y 1.791 = 前方へ 1.79m）。three.js では Hips の位置トラックを削るか、終端で本体を前へ送る。
- ハンマーのオフセット（`mixamorig:RightHand` のローカル、GLB の骨空間）:
  - position_m = [0.006118, 0.098233, 0.025449]
  - quaternion_xyzw = [0.005073, 0.000799, 0.778998, 0.627005]
  - scale = [1, 1, 1]
  - three.js: `h.position.fromArray(p); h.quaternion.fromArray(q); handBone.add(h)`。hammer.glb は Z-up のまま書き出してある（原点＝握り、+Y＝柄尻→頭、+X＝頭の長さ方向）ので、ノードの回転を追加しないこと。
