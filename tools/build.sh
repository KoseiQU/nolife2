#!/bin/bash
# tools/build.sh — P3a: 全館の外殻を1コマンドで再現する(無人実行)。
#   building.json → make_textures.py(build/tex) → 階ごとに build_floor.py → bake.py → export.py → ライトマップ WebP 化 → check_glb.mjs
# 使い方: tools/build.sh                 全階(1〜7。7F は屋上B込み)
#         tools/build.sh --floor 4       1階だけ
#         tools/build.sh --samples 512 --size 2048 --device GPU|CPU
#         tools/build.sh --p0            旧 P0(4F の1区間 build/p0.glb)を作る(参考用)
# 環境変数 BLENDER で Blender の場所を上書きできる。
set -euo pipefail
cd "$(dirname "$0")/.."
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
SAMPLES=1024; SIZE=2048; DEVICE=GPU; FLOORS="1 2 3 4 5 6 7"; P0=0
while [ $# -gt 0 ]; do
  case "$1" in
    --samples) SAMPLES="$2"; shift 2;;
    --size) SIZE="$2"; shift 2;;
    --device) DEVICE="$2"; shift 2;;
    --floor) FLOORS="$2"; shift 2;;
    --p0) P0=1; shift;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done
mkdir -p build/tex build/logs
T0=$(date +%s)
if [ "$P0" = 1 ]; then
  python3 -I tools/fetch_textures.py
  "$BLENDER" -b --factory-startup -P tools/blender/build_scene.py -- --out build/p0_scene.blend 2>&1 | grep -E '^\[n2|Error|Traceback' || true
  "$BLENDER" -b --factory-startup build/p0_scene.blend -P tools/blender/bake.py -- --samples "$SAMPLES" --size "$SIZE" --device "$DEVICE" \
    --out build/p0_lightmap.png --blend_out build/p0_baked.blend --info build/p0_bake_info.json 2>&1 | grep -E '^\[n2|Error|Traceback' || true
  "$BLENDER" -b --factory-startup build/p0_baked.blend -P tools/blender/export.py -- --out build/p0.glb --manifest build/p0_manifest.json 2>&1 | grep -E '^\[n2|Error|Traceback' || true
  exit 0
fi
echo "== 0 data + textures"
node data/build_building.mjs | tail -1
python3 -I tools/fetch_textures.py
python3 tools/make_textures.py | tail -1
for N in $FLOORS; do
  echo "== floor $N: build_floor"
  "$BLENDER" -b --factory-startup -P tools/blender/build_floor.py -- --level "$N" --out "build/floor_${N}_scene.blend" > "build/logs/floor_${N}_build.log" 2>&1 || true
  grep -E '^\[n2|Error|Traceback' "build/logs/floor_${N}_build.log" || true
  test -f "build/floor_${N}_scene.blend"
  echo "== floor $N: bake (samples=$SAMPLES size=$SIZE device=$DEVICE)"
  "$BLENDER" -b --factory-startup "build/floor_${N}_scene.blend" -P tools/blender/bake.py -- \
    --samples "$SAMPLES" --size "$SIZE" --device "$DEVICE" --out "build/floor_${N}_lightmap.png" --out2 "build/floor_${N}_rooms_lightmap.png" \
    --blend_out "build/floor_${N}_baked.blend" --info "build/floor_${N}_bake_info.json" > "build/logs/floor_${N}_bake.log" 2>&1 || true
  grep -E '^\[n2|Error|Traceback' "build/logs/floor_${N}_bake.log" || true
  test "build/floor_${N}_lightmap.png" -nt "build/floor_${N}_scene.blend"
  python3 -c "from PIL import Image; Image.open('build/floor_${N}_lightmap.png').convert('RGB').save('build/floor_${N}_lightmap.webp', quality=92, method=6)"
  # P3b: 部屋の組のライトマップ(入れる部屋の内装・バルコニー・屋上A)
  if [ -f "build/floor_${N}_rooms_lightmap.png" ] && [ "build/floor_${N}_rooms_lightmap.png" -nt "build/floor_${N}_scene.blend" ]; then
    python3 -c "from PIL import Image; Image.open('build/floor_${N}_rooms_lightmap.png').convert('RGB').save('build/floor_${N}_rooms_lightmap.webp', quality=80, method=6)"
  fi
  echo "== floor $N: export"
  "$BLENDER" -b --factory-startup "build/floor_${N}_baked.blend" -P tools/blender/export.py -- --out "build/floor_${N}.glb" \
    --manifest "build/floor_${N}_manifest.json" --info "build/floor_${N}_bake_info.json" --lightmap "build/floor_${N}_lightmap.webp" \
    --lightmap2 "build/floor_${N}_rooms_lightmap.webp" --images NONE \
    > "build/logs/floor_${N}_export.log" 2>&1 || true
  grep -E '^\[n2|Error|Traceback' "build/logs/floor_${N}_export.log" || true
  test "build/floor_${N}.glb" -nt "build/floor_${N}_lightmap.png"
done
echo "== check"
node tools/check_glb.mjs
echo "== done in $(( $(date +%s) - T0 ))s"
