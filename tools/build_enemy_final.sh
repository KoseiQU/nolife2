#!/bin/bash
# tools/build_enemy_final.sh — P1b 管理人の確定像(07)を1コマンドで再現する(無人実行)。
#   enemy_setup.py → enemy_build.py --id 07(質感向上 enemy_p1b.py を含む)→ enemy_check.py(機械チェック)
#   → enemy_render.py: 07_portrait / 07_insitu / 07_peephole / 07_threequarter ＋ compare_before_after
# 使い方: tools/build_enemy_final.sh [--samples-scale K] [--device GPU|CPU] [--no-render]
# 前提: build/p0_baked.blend(tools/build.sh)と、比較用の P1 画像 docs/enemy-candidates/02_insitu.jpg・04_portrait.jpg
set -euo pipefail
cd "$(dirname "$0")/.."
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
K=1; DEVICE=GPU; RENDER=1
while [ $# -gt 0 ]; do
  case "$1" in
    --samples-scale) K="$2"; shift 2;;
    --device) DEVICE="$2"; shift 2;;
    --no-render) RENDER=0; shift;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done
export BLENDER
T0=$(date +%s)
OUT=docs/enemy-candidates/p1b; mkdir -p "$OUT"
B=build/enemy/07_kanrinin_final.blend
echo "== 1/4 setup"
python3 -I tools/blender/enemy_setup.py | grep -E '^==|SHA|ライセンス不明' || true
echo "== 2/4 build 07"
BLENDER_USER_RESOURCES="$PWD/build/blender_user" "$BLENDER" -b --factory-startup -P tools/blender/enemy_build.py -- --id 07 \
  2>&1 | grep -E '^\[n2|Error|Traceback|AssertionError' || true
rm -f build/enemy/*.blend1
test -f "$B"
echo "== 3/4 check"
"$BLENDER" -b "$B" -P tools/blender/enemy_check.py -- --out "$OUT/check.json" 2>&1 | grep -E '^\[n2|Error|Traceback' || true
python3 -I -c "import json,sys; r=json.load(open('$OUT/check.json'))['results']; ng=[x['check'] for x in r if not x['ok']]; print('check:', len(r)-len(ng), '/', len(r)); sys.exit(1 if ng else 0)"
[ "$RENDER" = 1 ] || { echo "== done (no render) in $(( $(date +%s) - T0 ))s"; exit 0; }
echo "== 4/4 render"
R() { "$BLENDER" -b "$1" -P tools/blender/enemy_render.py -- "${@:2}" --device "$DEVICE" 2>&1 | grep -E '^\[n2|Error|Traceback' || true; }
R "$B" --mode portrait --samples $((256 * K)) --out "$OUT/07_portrait.jpg"
R build/p0_baked.blend --mode insitu --enemy "$B" --samples $((512 * K)) --out "$OUT/07_insitu.jpg"
R build/p0_baked.blend --mode peephole --enemy "$B" --samples $((512 * K)) --out "$OUT/07_peephole.jpg"
R "$B" --mode threequarter --samples $((256 * K)) --out "$OUT/07_threequarter.jpg"
R "$B" --mode portrait --strips --samples $((256 * K)) --out "$OUT/07_portrait_export_hair.jpg"
"$BLENDER" -b --factory-startup -P tools/blender/enemy_render.py -- --mode compare \
  --inputs docs/enemy-candidates/02_insitu.jpg,$OUT/07_insitu.jpg,docs/enemy-candidates/04_portrait.jpg,$OUT/07_portrait.jpg \
  --out "$OUT/compare_before_after.jpg" 2>&1 | grep -E '^\[n2|Error|Traceback' || true
echo "== done in $(( $(date +%s) - T0 ))s"
