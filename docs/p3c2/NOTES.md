# P3c-2 廊下端の窓をガラス化 — 引き継ぎメモ

ユーザー指示（2026-11-01「マンションの窓は外が見えるガラス素材に」、DESIGN §2.3）。P3a で不透明な発光板（`M_Window`）だった廊下端の窓を、**外壁に本当の開口を抜いた透明ガラス**にした。窓越しに外（森・山並み・谷の向こうの街の灯り・夜空・下の階の屋根・駐車場）が見え、外からは同じ窓から廊下の常夜灯が透けて見える。
当たり判定（walls.js・building.json）と窓の位置・寸法は変えていない（`data/building.json` は無変更）。

## 1. 対象（`building.json` 各階 `shell.windows` の全 15 か所）

| 階 | 窓 | 外に見えるもの |
|---|---|---|
| 1F | 東端（26.0, 21.2） | 駐車場・柵・谷の向こうの街 |
| 1F | 食堂の西 3 つ（x=0, z 5.6/8.0/10.4、1.5×1.3m） | 西の生垣・山の斜面・101〜103 のバルコニー（乳白ガラス） |
| 2F・3F | 縦廊下の北端（6.9, 0） | 北の擁壁の上の山の斜面と森（近い。空はほとんど見えない） |
| 2〜4F | 東端（26.0, 21.2） | 谷・街の灯り・山並み・森・駐車場 |
| 4F | 縦廊下の北端（6.9, 5.8） | 屋上A（防水シート・パラペット・室外機）と北の山 |
| 5F | 縦廊下の北端（6.9, 8.7）・東端（25.2, 21.2） | 4F の屋根のパラペット・山 / 谷・街 |
| 6F | 縦廊下の北端（6.9, 14.5）・東端（23.1, 21.2） | 5F の屋根・山 / 谷・街 |
| 7F | 東端（22.3, 21.2） | 谷・街 |

依頼文の「7F 北側」はデータ上は 7F の横廊下の東端（`facing: W`）の 1 か所だった。食堂の西の 3 つは依頼の列挙に無かったが、同じ `shell.windows` の発光板だったので同じ作りにした（§7-1）。

## 2. 開口の作り（`tools/blender/build_floor.py`）

- `corr_window_geom(w, floor, base_y)`: 窓 1 つの幾何。`inner` = 壁の室内の面（窓を覆う walls の箱のうち一番室内側の面。外周の壁なら外周の線、食堂は部屋の壁の箱の面 0.06、4F 北はフィラー壁の面 5.86）、`outer` = 外壁の面（外の塊は外周の線の 3cm 外、4F 北は屋上A の外壁 `MR_Facade` の面 5.74）。`D = |inner − outer|`（外周 3cm・食堂 9cm・4F 北 12cm）
- **壁の室内の面に穴**: `build()` の壁の面を張るところで、面が窓の `inner`〜`outer` の間にあれば（重なった箱の奥の面も）窓の寸法の穴を抜き、左右・下・上の面に分けて張る（`window_holes_on_face`）。幅木は穴より下なので影響なし
- **外の塊に穴**: `build_rooms.build_massing` の自分の階の外の塊（`MX_Mass`）に同じ穴（`wall_with_holes`）。他の階の塊（外観が読めるまでの仮・`?noext`）は塞いだまま。4F 北は屋上A の外壁が P3a から穴あき（旧 `RoofA_winout` の発光板 `MX_WinOut` と枠は撤去）
- **窓の部品**（`build_window`）:
  - 室内側の額縁（`Window_i_frame`、n2_kind `window`、`M_Stainless`、ライトマップあり）: 見付け 4cm・室内へ 5cm、下は膳板（7cm）。壁に付く背面は張らない
  - 壁の厚みの中・ガラスの面・外側（`Window_i_out`、n2_kind `corrwinout`、`MX_CorrAlu` = アルミ・ライトマップなし）: 見込み（inner〜outer の 4 面）・障子の框（3cm）＋横桟 1 本・外の枠（見付け 3.5cm・外へ 2cm）・水切り（外へ 6cm＋垂れの小口）
  - ガラス（`Window_i_glass`、n2_kind `corrglass`、`MX_CorrGlass`）: 1 枚の面。ガラスの面は inner から外へ min(1.5cm, D/2)
- **ベイク**: ガラスは `bake.CLEAR_KINDS`（光を遮らない・焼き込み先にしない）と `NO_LIGHTMAP_KINDS`（ライトマップの UV は 0）。`MX_*` の外の部品は n2_lm 0（遮蔽にはなる）
- **開口から差す光**: 開口の外 5cm に室内向きの面光源 `WinSky_i`（窓と同じ大きさ・青白 (0.62, 0.72, 1.0)・0.8W、`--win_sky` で変更）。ワールドの夜空（0.03）も開口から入る。強さを変えるなら `build_floor.py` の既定値（`tools/build.sh` は `--win_sky` を渡さない）。P3b の月（`N2_Moon`）は外殻の組のベイクで消しているので共用しなかった（§7-3）。廊下の端は常夜灯が近いので効果はごく弱く、床・額縁の膳板がわずかに青白くなる程度

## 3. 実行時（`src/world.js`・`src/exterior.js`・`src/main.js`）

- `corrGlass(m, LOOK, envTex)`（exterior.js、world.js から import）: `MX_CorrGlass` を両面・半透明（opacity 0.12）・ごく暗い青緑（0.10, 0.125, 0.125）・環境の映り込み（`LOOK.corrGlass.env` 0.16、共通の `RoomEnvironment`）・粗さ = `glass_smudge.jpg`（指紋・拭き跡）にする。階の GLB と外観の帯で同じ。風除室の物理ガラス（transmission）は「背景をもう一度描く」ので使っていない
- `MX_CorrAlu` は `MX_Mass` と同じく外観と同じ月明かり・空の明るさを足す（`extShade`、霧は scene のまま）
- `LOOK.corrGlass = { color, opacity, roughness, env }`、`LOOK.ext.corrDepth / corrDepthLit / corrLamp / corrWinDist`（`LOOK.ext.corrGlow` は廃止）
- **`wantExterior()`**: 廊下端の窓の判定 `CORR_WINDOWS` を追加。同じ階で、窓の室内側にいて、窓から `LOOK.ext.corrWinDist`（10m）以内で、窓の箱（窓の面 ±0.3m）が視錐台に入っていれば外観・外環境を描く。それより遠い所から見ると窓の外は夜空（背景）だけ

## 4. 外観側（`tools/blender/build_exterior.py`）

- `ExtAlways` の「廊下の端の窓の灯り」（`XE_CorrGlow` の発光板と枠）は**廃止**
- 外観の帯 `ExtBand_N` は階の GLB から取り出すので、外の塊の穴・`corrwinout`（外の枠・見込み・水切り）・`corrglass` がそのまま入る（`WHOLE` に 2 種を追加）
  - (a) その階の GLB が scene に出ている時: 帯は隠れ、開口越しに**本物の廊下**（ベイク済みの壁・扉・常夜灯）が見える
  - (b) 出ていない時（帯だけ）: `corr_depth` が開口の奥に**奥行き 1.8m・幅 1.8m・天井高 2.4m の廊下の箱**を置く（左右の壁・床 = `XE_CorrDepth` 暗い、天井 = `XE_CorrDepthLit`、突き当たり = 暗い、天井の奥 1.6m に常夜灯のカバー `XE_CorrLamp`（本物の `M_LampCover` の 0.3 倍））。発光だけの材質なので月明かりは乗らない。値は `LOOK.ext.corrDepth [0.008,0.009,0.010]`・`corrDepthLit [0.024,0.026,0.029]`・`corrLamp 0.3`。本物の廊下（a）と見比べて明るさを合わせた（`docs/p3c2-screens/p3c2_out_2F_glb.jpg` と `_bandonly.jpg` は同じ構図）
- `check_glb.mjs` の「帯に建物の中の面が無い」は `XE_Corr(Depth|Lamp)` を除外（意図して建物の中＝食堂の 3 窓の奥が部屋の矩形に入る）

## 5. テスト・容量・性能

- `node tools/check_glb.mjs`: OK。**10) 廊下端の窓**を追加: 全 15 窓で窓の中心（横桟の上下 2 点）を壁・外の塊・外壁（facade）の面が塞いでいない／ガラスの面がある／外の枠・水切りがある／旧い発光板の材質（`M_Window`・`MX_WinOut`）が GLB に無い
- `node data/build_assert.mjs`: OK（データは無変更）
- ブラウザ（ヘッドレス Chrome・Metal・M4）:
  - `?test=building` **12/12**（**10_corridor_windows** を追加: 各窓の正面 1.5m に立ち、ア) 窓の中心へのレイの最初の面が `MX_CorrGlass`（opacity 0.12・両面）でその奥 0.4m に壁が無い、イ) `exterior.shown`、ウ) 外を出した画と隠した画（`exterior.force`）で窓の領域の画素が 5% 超変わる（実測 51〜81%）、エ) 1080p の1フレーム（4F は ≤16.7ms））
  - `?test=building&tour` **1/1**・`?test=rooms` **8/8**・`?test=enemy` **11/11**
- 容量: **22.70 → 22.88 MB**（+0.18MB: 階の GLB 7本 +0.07・ライトマップ ±0・外観 GLB +0.10。上限 35MB）
- 性能（1920×1080・`N.step+render+readPixels` の同期の1フレーム、中央値。外あり / 外を描かない）:

| 場所 | 外あり | 外なし |
|---|---|---|
| 4F 縦廊下の北端の窓の正面 | 11.9 ms | 10.6 ms |
| 4F 横廊下の東端の窓の正面 | 11.8 | 10.6 |
| 2F 東端の窓の正面 | 10.9 | 9.3 |
| 4F 廊下の途中（外は描かない・参考） | 11.9 | 11.8 |

  10 番の記録: 全窓 9.8〜12.1ms（4F 11.8/12.1ms）。外観・外環境の上乗せは +1.2〜1.6ms。屋内からの近景の木の間引きは不要だった

## 6. スクリーンショット（`docs/p3c2-screens/`、1600×900、`?tour&noai`・懐中電灯なし）

| ファイル | 内容 |
|---|---|
| `p3c2_4F_north_in.jpg` | 4F 縦廊下の北端の窓を室内から（屋上A のパラペットと北の山。ガラスの上に天井の映り込み） |
| `p3c2_2F_east_in.jpg` / `p3c2_2F_east_angle.jpg` | 2F 東端の窓を室内から（谷の向こうの街の灯り・山並み・森・駐車場の柵）／斜めから（220 の怖い扉の脇） |
| `p3c2_1F_east_in.jpg` | 1F 東端の窓（駐車場の照明柱の灯りの溜まり・柵・街） |
| `p3c2_5F_north_in.jpg` | 5F 縦廊下の北端（4F の屋根のパラペットと斜面の森） |
| `p3c2_out_1F_east_real.jpg` | 外（駐車場）から 1F 東端の窓（階の GLB あり＝本物の廊下と扉） |
| `p3c2_out_east_real_and_band.jpg` | 駐車場から東面を見上げ: 1F・2F は階の GLB（本物の廊下・非常口サイン・常夜灯）、3F・4F は帯だけ（奥の廊下の箱と常夜灯） |
| `p3c2_out_2F_glb.jpg` / `p3c2_out_2F_bandonly.jpg` | 同じ構図で 2F の窓を「階の GLB あり」と「帯だけ」（2F の GLB を scene から外して帯を出した比較用） |
| `p3c2_roofA_4F_win.jpg` / `p3c2_roofA_4F_corridor.jpg` | 屋上A から 4F 北の窓（廊下の扉）／窓越しに縦廊下の奥の EV まで |

撮り方: `?tour&noai` → `__N2.paused = true; __N2.setRenderSize(1600, 900); await __N2.teleport(階, x, z, yaw, pitch)` → `__N2.pump(1/60, 120, false); __N2.render()` → `toDataURL('image/jpeg', 0.92)`。帯だけの比較は `world.floors.get(2).group.removeFromParent(); exterior._syncBands(); render()`。

## 7. 判断に迷った点

1. **食堂の西の 3 窓も対象にした**: 依頼の列挙（1F 東端・2〜6F 東端・4〜6F 縦廊下北端・7F 北側）には無いが、`shell.windows` の同じ発光板で、テストの指示も「各階の shell.windows ごと」だったため。外は西の生垣と山の斜面で暗い（画素の差は 73〜77% あり、外は描けている）。不要なら `build_building.mjs` の窓の行を消すのではなく、`build_window` で `w.w > 1.0` を旧方式に戻す等で分けられる
2. **2F・3F の北の窓は山の斜面しか見えない**: P3c の地形（北の擁壁 2.9m＋その上の斜面 0.48）が窓の 5〜15m 先にあり、ほぼ暗い斜面と木の幹。現実的なので変えていない（夜空を見せたいなら地形の北の上がり方を緩める＝P3c の外環境の変更）
3. **月明かりは共用しなかった**: `N2_Moon` を外殻の組のベイクで点けると、P3a で合格した外階段・踊り場の見え方まで変わる。代わりに開口ごとに弱い青白い面光源（ベイクだけ）＋夜空。廊下の端は常夜灯が近く、効果はわずか（§3.2.1 の下限は既存の常夜灯が満たしている。enemy 8 番の消灯時の明るさも通過）
4. **壁の見込みが薄い所がある**: 外周の壁は当たりの箱（12cm）に対して見た目は室内の面と外の塊（3cm 外）しか無いので、開口の見込みは 3cm。室内側の額縁（5cm）と外の枠（2cm）・水切り（6cm）で厚みを補った（食堂 9cm・4F 北 12cm は実寸）
5. **額縁の色**: `M_Stainless`（P3a の枠と同じ）。1F は風除室の静的環境（envProbe）が `M_Stainless` に効くので茶色がかって見える（木の額縁に近い）。他の階は白っぽいステンレス
6. **外を描く距離 10m**: 縦廊下・横廊下の長い所では、窓から 10m より遠いと窓の外は夜空だけになる（窓は小さく見えるので目立たない）。広げると屋内で外を描く時間が増える（+1〜1.6ms）
7. **物理ガラス（transmission）は使わなかった**: 1 枚の半透明＋映り込み＋汚れの粗さで、外が見えることを優先。風除室と同じ質に寄せたい窓があれば、`MX_CorrGlass` をその階だけ `PHYS_GLASS` に入れれば済む（背景をもう一度描くので +2〜6ms）
8. **帯の奥の廊下の箱**は全窓とも同じ形（奥行 1.8m・幅 1.8m）。食堂の 3 窓も同じ箱（食堂は消灯の想定で暗いが、常夜灯のカバーも同じに付く）

## 8. 再生成

```
tools/build.sh                  # 全階＋外観（約 7 分）。1 階だけは --floor N（最後に外観も作り直す）
tools/build.sh --exterior       # 外観だけ（帯の奥の箱・材質）
node tools/check_glb.mjs        # 10) 廊下端の窓 込み
```
ブラウザ: `?test=building`（10_corridor_windows）、`__N2.LOOK.corrGlass`（材質は読み込み時に設定。変えたら再読み込み）、`__N2.LOOK.ext.corrDepth` 等（同上）、`__N2.exterior.force = true|false|null`。
