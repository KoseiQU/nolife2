#!/bin/bash
# tools/build_enemy_rigged.sh — P2a: Mixamo のリグ・アニメを本番メッシュへ移して GLB を作り、各アニメを静止画で確認する。
#   mixamo_merge.py(build/enemy/mixamo/ のスキン付き FBX＋アニメ 11 本 → build/enemy/07_rigged.glb ＋ _meta.json ＋ .blend)
#   → enemy_render.py: 各アニメの代表フレーム(斜め45°・中立照明・ハンマー付き)11 枚＋attack_downward の振りかぶり頂点で
#     attack 表情を乗せた覗き穴 1 枚(docs/enemy-candidates/p2a/)
# 前提: build/enemy/07_prod_mesh.blend(tools/blender/mixamo_prep.py)・build/enemy/hammer.glb・build/p0_baked.blend
set -euo pipefail
cd "$(dirname "$0")/.."
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
OUT=docs/enemy-candidates/p2a; mkdir -p "$OUT"
B=build/enemy/07_rigged.blend
T0=$(date +%s)
echo "== 1/2 merge"
"$BLENDER" -b --factory-startup -P tools/blender/mixamo_merge.py -- --rigged build/enemy/mixamo/idle_breathing_skin.fbx \
  --anims build/enemy/mixamo --out build/enemy/07_rigged.glb --report "$OUT/check.json" 2>&1 | grep -E '^\[n2|Error|Traceback' || true
python3 -I -c "import json,sys; r=json.load(open('$OUT/check.json'))['results']; ng=[x['check'] for x in r if not x['ok']]; print('check:', len(r)-len(ng), '/', len(r)); sys.exit(1 if ng else 0)"
echo "== 2/2 render"
R() { "$BLENDER" -b "$1" -P tools/blender/enemy_render.py -- "${@:2}" 2>&1 | grep -E '^\[n2|Error|Traceback' || true; }
for a in walk_careful walk_brutal run_intent look_idle door_open_in turn_left turn_right react_surprised; do
  R "$B" --mode threequarter --action $a --frame mid --samples 128 --out "$OUT/${a}.jpg"
done
R "$B" --mode threequarter --action look_nervous --frame max_head --samples 128 --out "$OUT/look_nervous.jpg"
R "$B" --mode threequarter --action attack_downward --frame peak_hand --samples 128 --out "$OUT/attack_downward.jpg"
R "$B" --mode threequarter --action attack_bash --frame peak_hand --samples 128 --out "$OUT/attack_bash.jpg"
R build/p0_baked.blend --mode peephole --enemy "$B" --action attack_downward --frame peak_hand --attack --samples 384 \
  --out "$OUT/attack_downward_peak_attack_peephole.jpg"
echo "== done in $(( $(date +%s) - T0 ))s"
