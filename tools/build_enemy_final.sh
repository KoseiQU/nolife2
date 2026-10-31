#!/bin/bash
# tools/build_enemy_final.sh — P1b 管理人の確定像(07)を1コマンドで再現する(無人実行)。
#   enemy_setup.py → enemy_build.py --id 07(質感向上 enemy_p1b.py を含む)→ enemy_check.py(機械チェック)
#   → enemy_render.py: 07_portrait / grin_portrait / insitu / insitu_far / peephole / grin_peephole / threequarter /
#     portrait_export_hair ＋ compare_before_after(P1b 初版 → 差し戻し後)。ハンマーは build/enemy/hammer.fbx / .glb
# 使い方: tools/build_enemy_final.sh [--samples-scale K] [--device GPU|CPU] [--no-render]
# 前提: build/p0_baked.blend(tools/build.sh)と git(比較用に P1b 初版の画像をコミット 849e92c から取り出す)
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
R "$B" --mode portrait --grin --samples $((256 * K)) --out "$OUT/07_grin_portrait.jpg"
R "$B" --mode portrait --attack --samples $((256 * K)) --out "$OUT/07_attack_portrait.jpg"
R build/p0_baked.blend --mode insitu --enemy "$B" --samples $((512 * K)) --out "$OUT/07_insitu.jpg"
R build/p0_baked.blend --mode insitu --far --enemy "$B" --samples $((512 * K)) --out "$OUT/07_insitu_far.jpg"
R build/p0_baked.blend --mode peephole --enemy "$B" --samples $((512 * K)) --out "$OUT/07_peephole.jpg"
R build/p0_baked.blend --mode peephole --grin --enemy "$B" --samples $((512 * K)) --out "$OUT/07_grin_peephole.jpg"
R build/p0_baked.blend --mode peephole --attack --enemy "$B" --samples $((512 * K)) --out "$OUT/07_attack_peephole.jpg"
R "$B" --mode threequarter --samples $((256 * K)) --out "$OUT/07_threequarter.jpg"
R "$B" --mode portrait --strips --samples $((256 * K)) --out "$OUT/07_portrait_export_hair.jpg"
# 前後比較: P1b 初版(コミット 849e92c の画像)→ 差し戻し後
for f in 07_insitu 07_portrait; do git show 849e92c:$OUT/$f.jpg > build/enemy/p1b_v1_$f.jpg; done
"$BLENDER" -b --factory-startup -P tools/blender/enemy_render.py -- --mode compare \
  --inputs build/enemy/p1b_v1_07_insitu.jpg,$OUT/07_insitu.jpg,build/enemy/p1b_v1_07_portrait.jpg,$OUT/07_portrait.jpg \
  --labels "前（P1b 初版）|後（差し戻し後: 帽子・痩せた顔・ハンマー）" \
  --out "$OUT/compare_before_after.jpg" 2>&1 | grep -E '^\[n2|Error|Traceback' || true
echo "== done in $(( $(date +%s) - T0 ))s"
