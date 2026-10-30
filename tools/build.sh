#!/bin/bash
# tools/build.sh — P0 パイプラインを1コマンドで再現する(無人実行)。
#   building.json → build_scene.py → bake.py → export.py → check_glb.mjs
# 使い方: tools/build.sh [--samples N] [--size PX] [--device GPU|CPU]
# 環境変数 BLENDER で Blender の場所を上書きできる。
set -euo pipefail
cd "$(dirname "$0")/.."
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
SAMPLES=1024; SIZE=2048; DEVICE=GPU
while [ $# -gt 0 ]; do
  case "$1" in
    --samples) SAMPLES="$2"; shift 2;;
    --size) SIZE="$2"; shift 2;;
    --device) DEVICE="$2"; shift 2;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done
mkdir -p build
T0=$(date +%s)
echo "== 0/4 textures (CC0, 取得済みならスキップ)"
python3 -I tools/fetch_textures.py
echo "== 1/4 build_scene"
"$BLENDER" -b --factory-startup -P tools/blender/build_scene.py -- --out build/p0_scene.blend 2>&1 | grep -E '^\[n2|Error|Traceback' || true
test -f build/p0_scene.blend
echo "== 2/4 bake (samples=$SAMPLES size=$SIZE device=$DEVICE)"
"$BLENDER" -b --factory-startup build/p0_scene.blend -P tools/blender/bake.py -- \
  --samples "$SAMPLES" --size "$SIZE" --device "$DEVICE" --out build/p0_lightmap.png --blend_out build/p0_baked.blend \
  2>&1 | grep -E '^\[n2|Error|Traceback' || true
test build/p0_lightmap.png -nt build/p0_scene.blend
echo "== 3/4 export"
"$BLENDER" -b --factory-startup build/p0_baked.blend -P tools/blender/export.py -- --out build/p0.glb --manifest build/p0_manifest.json \
  2>&1 | grep -E '^\[n2|Error|Traceback' || true
test build/p0.glb -nt build/p0_lightmap.png
echo "== 4/4 check"
node tools/check_glb.mjs
echo "== done in $(( $(date +%s) - T0 ))s"
