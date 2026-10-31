#!/bin/bash
# tools/build_enemies.sh — P1 管理人候補カタログを1コマンドで再現する(無人実行)。
#   enemy_setup.py(MPFB2 とアセットパックの取得・SHA-256照合・導入・ライセンス確認)
#   → enemy_build.py ×6(build/enemy/NN_*.blend と Mixamo 用 .fbx)
#   → enemy_render.py ×12(docs/enemy-candidates/NN_portrait.jpg / NN_insitu.jpg)＋一覧 00_overview.jpg
# 使い方: tools/build_enemies.sh [--ids "01 02 ..."] [--portrait-samples N] [--insitu-samples N] [--device GPU|CPU] [--no-render]
# 前提: build/p0_baked.blend(tools/build.sh の生成物)。環境変数 BLENDER で Blender の場所を上書きできる。
set -euo pipefail
cd "$(dirname "$0")/.."
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
IDS="01 02 03 04 05 06"; PS=256; IS=512; DEVICE=GPU; RENDER=1
while [ $# -gt 0 ]; do
  case "$1" in
    --ids) IDS="$2"; shift 2;;
    --portrait-samples) PS="$2"; shift 2;;
    --insitu-samples) IS="$2"; shift 2;;
    --device) DEVICE="$2"; shift 2;;
    --no-render) RENDER=0; shift;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done
test -f build/p0_baked.blend || { echo "build/p0_baked.blend がない。先に tools/build.sh を回す" >&2; exit 1; }
export BLENDER
T0=$(date +%s)
echo "== 1/3 setup (MPFB2 + MakeHuman asset packs)"
python3 -I tools/blender/enemy_setup.py
echo "== 2/3 build"
for id in $IDS; do
  BLENDER_USER_RESOURCES="$PWD/build/blender_user" "$BLENDER" -b --factory-startup -P tools/blender/enemy_build.py -- --id "$id" \
    2>&1 | grep -E '^\[n2|Error|Traceback|AssertionError' || true
  ls build/enemy/${id}_*.blend build/enemy/${id}_*.fbx >/dev/null
done
rm -f build/enemy/*.blend1
[ "$RENDER" = 1 ] || { echo "== done (no render) in $(( $(date +%s) - T0 ))s"; exit 0; }
echo "== 3/3 render"
OUT=docs/enemy-candidates; mkdir -p "$OUT"; SHEET=""
for id in $IDS; do
  B=$(ls build/enemy/${id}_*.blend)
  "$BLENDER" -b "$B" -P tools/blender/enemy_render.py -- --mode portrait --samples "$PS" --device "$DEVICE" \
    --out "$OUT/${id}_portrait.jpg" 2>&1 | grep -E '^\[n2|Error|Traceback' || true
  "$BLENDER" -b build/p0_baked.blend -P tools/blender/enemy_render.py -- --mode insitu --enemy "$B" --samples "$IS" \
    --device "$DEVICE" --out "$OUT/${id}_insitu.jpg" 2>&1 | grep -E '^\[n2|Error|Traceback' || true
  test "$OUT/${id}_insitu.jpg" -nt "$B"
  SHEET="$SHEET${SHEET:+,}$OUT/${id}_portrait.jpg"
done
"$BLENDER" -b --factory-startup -P tools/blender/enemy_render.py -- --mode sheet --inputs "$SHEET" --out "$OUT/00_overview.jpg" \
  2>&1 | grep -E '^\[n2|Error|Traceback' || true
echo "== done in $(( $(date +%s) - T0 ))s"
