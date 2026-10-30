# NOLIFE 2（仮題）

前作 NOLIFE の間取りと仕組みを引き継ぎ、光・素材・敵を本物に寄せて作り直すプロジェクト。契約は `DESIGN.md`、正文は `docs/`。

## 遊ぶ
```
cd ~/Desktop/game/nolife2 && python3 -m http.server 8001
```
→ http://localhost:8001/

## Blenderについて（初めての人へ）
- このプロジェクトでは **あなたがBlenderを操作する場面はありません**。建物の生成・照明の焼き付け・書き出しは、すべて `tools/blender/*.py` をBlenderにヘッドレスで実行させます（画面を出さずに裏で動く）。
- 見たいときだけ `build/*.blend` をダブルクリックで開けます。壊しても再生成できます。
- 敵の候補を選ぶときは `docs/enemy-candidates/` の画像を見て番号を伝えるだけです。
- 自分でやるのは2つ：**Mixamo（Adobe）に無料アカウントでログインする**（敵の動きを取るときに1回）、**声や建物の音を録音する**（後で差し替え）。

## フォルダ
- `data/` 建物データ（真実）と生成・検査スクリプト
- `tools/blender/` Blender用スクリプト（生成→ベイク→GLB）
- `build/` 生成物（GLB・ライトマップ・.blend）
- `assets/` テクスチャ・モデル・音（出典は `assets/LICENSES.md`）
- `src/` ゲーム本体（Three.js）
- `docs/` 正文・台詞表・敵候補・スタディ
