#!/bin/bash
# tools/build.sh — P3a: 全館の外殻を1コマンドで再現する(無人実行)。
#   building.json → make_textures.py(build/tex) → 階ごとに build_floor.py → bake.py → export.py → ライトマップ WebP 化
#   → P3c: ext_textures.py(build/tex/ext_*) → build_exterior.py(build/exterior.glb。階の GLB から外観の帯を取り出すので階の後) → check_glb.mjs
# 使い方: tools/build.sh                 全階(1〜7。7F は屋上B込み)
#         tools/build.sh --floor 4       1階だけ
#         tools/build.sh --samples 512 --size 2048 --device GPU|CPU
#         tools/build.sh --p0            旧 P0(4F の1区間 build/p0.glb)を作る(参考用)
#         tools/build.sh --exterior      外観・外環境だけ作り直す(階の GLB はそのまま)
#   P6b-E2 で追加(既定の動きは変えない):
#         --no-data       0 段目(building.json・テクスチャの再生成)を飛ばす
#         --no-exterior   外観(exterior.glb)を作り直さない
#         --no-bake       ベイクせず、既存のライトマップ(webp)と bake_info で書き出す(ライトマップ UV が変わらない時だけ。
#                         材質だけを変えた時用。UV が変わっていないかは docs/p6b-e2/NOTES.md の比べ方で確かめる)
#         --safe          実行時に読むファイル(GLB・manifest・ライトマップ webp)を build/.stage に書いてから mv で差し替える
#                         (書き換え中に別のサーバーが読んでも壊れた GLB を返さない)
# 環境変数 BLENDER で Blender の場所を上書きできる。
set -euo pipefail
cd "$(dirname "$0")/.."
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
SAMPLES=1024; SIZE=2048; DEVICE=GPU; FLOORS="1 2 3 4 5 6 7"; P0=0; EXT_ONLY=0
NO_DATA=0; NO_EXT=0; NO_BAKE=0; SAFE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --samples) SAMPLES="$2"; shift 2;;
    --size) SIZE="$2"; shift 2;;
    --device) DEVICE="$2"; shift 2;;
    --floor) FLOORS="$2"; shift 2;;
    --p0) P0=1; shift;;
    --exterior) EXT_ONLY=1; FLOORS=""; shift;;
    --no-data) NO_DATA=1; shift;;
    --no-exterior) NO_EXT=1; shift;;
    --no-bake) NO_BAKE=1; shift;;
    --safe) SAFE=1; shift;;
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
if [ "$NO_DATA" = 0 ]; then
echo "== 0 data + textures"
node data/build_building.mjs | tail -1
python3 -I tools/fetch_textures.py
python3 tools/make_textures.py | tail -1
fi
ST=build; [ "$SAFE" = 1 ] && { ST=build/.stage; mkdir -p "$ST"; }
for N in $FLOORS; do
  echo "== floor $N: build_floor"
  "$BLENDER" -b --factory-startup -P tools/blender/build_floor.py -- --level "$N" --out "build/floor_${N}_scene.blend" > "build/logs/floor_${N}_build.log" 2>&1 || true
  grep -E '^\[n2|Error|Traceback' "build/logs/floor_${N}_build.log" || true
  test -f "build/floor_${N}_scene.blend"
  if [ "$NO_BAKE" = 1 ]; then
    echo "== floor $N: no bake (reuse build/floor_${N}_lightmap.webp / rooms / bake_info)"
    test -f "build/floor_${N}_lightmap.webp"
    BAKED="build/floor_${N}_scene.blend"
    if [ "$SAFE" = 1 ]; then
      cp "build/floor_${N}_lightmap.webp" "$ST/"
      if [ -f "build/floor_${N}_rooms_lightmap.webp" ]; then cp "build/floor_${N}_rooms_lightmap.webp" "$ST/"; fi
    fi
  else
  echo "== floor $N: bake (samples=$SAMPLES size=$SIZE device=$DEVICE)"
  "$BLENDER" -b --factory-startup "build/floor_${N}_scene.blend" -P tools/blender/bake.py -- \
    --samples "$SAMPLES" --size "$SIZE" --device "$DEVICE" --out "build/floor_${N}_lightmap.png" --out2 "build/floor_${N}_rooms_lightmap.png" \
    --blend_out "build/floor_${N}_baked.blend" --info "build/floor_${N}_bake_info.json" > "build/logs/floor_${N}_bake.log" 2>&1 || true
  grep -E '^\[n2|Error|Traceback' "build/logs/floor_${N}_bake.log" || true
  test "build/floor_${N}_lightmap.png" -nt "build/floor_${N}_scene.blend"
  python3 -c "from PIL import Image; Image.open('build/floor_${N}_lightmap.png').convert('RGB').save('$ST/floor_${N}_lightmap.webp', quality=92, method=6)"
  # P3b: 部屋の組のライトマップ(入れる部屋の内装・バルコニー・屋上A)
  if [ -f "build/floor_${N}_rooms_lightmap.png" ] && [ "build/floor_${N}_rooms_lightmap.png" -nt "build/floor_${N}_scene.blend" ]; then
    python3 -c "from PIL import Image; Image.open('build/floor_${N}_rooms_lightmap.png').convert('RGB').save('$ST/floor_${N}_rooms_lightmap.webp', quality=80, method=6)"
  fi
  BAKED="build/floor_${N}_baked.blend"
  fi
  echo "== floor $N: export"
  "$BLENDER" -b --factory-startup "$BAKED" -P tools/blender/export.py -- --out "$ST/floor_${N}.glb" \
    --manifest "$ST/floor_${N}_manifest.json" --info "build/floor_${N}_bake_info.json" --lightmap "$ST/floor_${N}_lightmap.webp" \
    --lightmap2 "$ST/floor_${N}_rooms_lightmap.webp" --images NONE \
    > "build/logs/floor_${N}_export.log" 2>&1 || true
  grep -E '^\[n2|Error|Traceback' "build/logs/floor_${N}_export.log" || true
  grep -q '^\[n2.*exported' "build/logs/floor_${N}_export.log"   # (-nt は --no-bake だと同じ秒になり誤って止まる)
  if [ "$SAFE" = 1 ]; then   # 実行時に読む 4 つを差し替える(GLB を最後に)
    for F in "floor_${N}_lightmap.webp" "floor_${N}_rooms_lightmap.webp" "floor_${N}_manifest.json" "floor_${N}.glb"; do
      if [ -f "$ST/$F" ]; then mv -f "$ST/$F" "build/$F"; fi
    done
  fi
done
if [ "$SAFE" = 1 ]; then rmdir "$ST" 2>/dev/null || true; fi
if [ "$NO_EXT" = 0 ]; then
echo "== exterior (P3c)"
python3 tools/ext_textures.py | tail -1
"$BLENDER" -b --factory-startup -P tools/blender/build_exterior.py -- --out build/exterior.glb --manifest build/exterior_manifest.json \
  > build/logs/exterior_build.log 2>&1 || true
grep -E '^\[n2|Error|Traceback' build/logs/exterior_build.log || true
test build/exterior.glb -nt build/tex/ext_sky.webp
fi
echo "== check"
node tools/check_glb.mjs
echo "== done in $(( $(date +%s) - T0 ))s"
