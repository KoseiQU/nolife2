#!/bin/bash
# make_tts.sh — 管理人の仮声(P4a-3)。macOS 付属の say(日本語音声)で台詞を読み上げ、22.05kHz/16bit/モノラルの wav にする。
# 台詞の正は docs/lines.md(ID = ファイル名)。ユーザーの録音が来たら同じ名前の wav で assets/audio/tts/ を上書きする(このスクリプトは再実行しない。
# 再実行すると録音を仮声で上書きしてしまう。P4d 以降は tools/import_rec.sh で取り込んだ ID(assets/audio/tts/recorded.txt)を自動で残す。手で置いた録音は KEEP="ID1 ID2" を付ける)。
# 使い方: bash tools/make_tts.sh            (全部を作り直す。リポジトリの直下で。macOS 専用)
#         bash tools/make_tts.sh mgr_door_laugh_01 mgr_door_line_02   (指定した ID だけ)
#         KEEP="mgr_line_know_01" bash tools/make_tts.sh              (KEEP の ID は作らない = 録音を残す)
#         FORCE=1 bash tools/make_tts.sh mgr_scream_01                (recorded.txt を無視して仮声に戻す)
# P4b: ゲームは声を wav に焼き込まず、鳴らす時に加工する(src/audio_voice.js)ので、作り直した仮声・置いた録音はそのまま試聴盤とゲームに効く。
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=assets/audio/tts
TMP=$(mktemp -d)
mkdir -p "$OUT"
ONLY=" $* "
# P4d: tools/import_rec.sh が取り込んだ録音の ID は assets/audio/tts/recorded.txt に残る。その ID は仮声で上書きしない(仮声に戻したい時は FORCE=1)
REC=""
if [ -z "${FORCE:-}" ] && [ -f "$OUT/recorded.txt" ]; then REC=$(tr '\n' ' ' <"$OUT/recorded.txt"); fi
KEEP=" ${KEEP:-} $REC "
line() { # ID 音声 速さ(語/分) 台詞
  if [ "$ONLY" != "  " ] && [[ "$ONLY" != *" $1 "* ]]; then return; fi
  if [[ "$KEEP" == *" $1 "* ]]; then echo "keep $1"; return; fi
  say -v "$2" -r "$3" -o "$TMP/$1.aiff" "$4"
  afconvert -f WAVE -d LEI16@22050 -c 1 "$TMP/$1.aiff" "$OUT/$1.wav"
}
# 気配(呟き)
line mgr_mumble_01       Grandpa 105 "ちがう…… ここじゃ、ない…… つぎ……"
line mgr_mumble_02       Rocko    95 "ひとつ…… ふたつ…… みっつ…… よっつ……"
line mgr_mumble_03       Grandpa 125 "おきてる こは、いないかなあ。 どこかなあ"
line mgr_mumble_04       Grandpa 110 "どこかなあ…… どこに、いったかなあ……"        # P4b 3 周目
line mgr_mumble_05       Rocko   105 "ちがう…… ちがう…… ここも、ちがう……"        # P4b 3 周目
# 目の前(笑い・セリフ)
line mgr_laugh_01        Grandpa  95 "ふふ…… ふふふふ……"
line mgr_line_found_01   Grandpa  85 "みぃつけた"
line mgr_line_there_01   Rocko    90 "そこに…… いるんだろう"
line mgr_line_found_02   Rocko    80 "みいつけた"                                # P4b 3 周目
line mgr_line_found_03   Grandpa  95 "みーつけた"                                # P4b 3 周目
# 扉の向こう(笑い・呟き)
line mgr_laugh_02        Grandpa 115 "くっくっくっく……"
line mgr_line_know_01    Grandpa 100 "いるのは…… わかってるよ"
line mgr_line_awake_01   Rocko   100 "まだ…… おきてるのかい"
line mgr_door_laugh_01   Grandpa 105 "ふふふ…… ふふ"                             # P4b(enemy_breath_door の追加)
line mgr_door_line_02    Grandpa 100 "もうすこし…… ちかくに、おいで"            # P4b(enemy_breath_door の追加)
# 叫び・悲鳴
line mgr_scream_01       Rocko   150 "ああああああああああああ"
line mgr_scream_laugh_01 Grandpa 170 "あはははは、あああああああああ"
line mgr_scream_02       Rocko   140 "うおおおおおおおおおお"
line mgr_scream_03       Grandpa 145 "ぎゃあああああああああああ"
line mgr_scream_04       Grandpa 130 "うああああああああああ"                    # P4b 3 周目
rm -rf "$TMP"
ls -l "$OUT"
