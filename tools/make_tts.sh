#!/bin/bash
# make_tts.sh — 管理人の仮声(P4a-3)。macOS 付属の say(日本語音声)で台詞を読み上げ、22.05kHz/16bit/モノラルの wav にする。
# 台詞の正は docs/lines.md(ID = ファイル名)。ユーザーの録音が来たら同じ名前の wav で assets/audio/tts/ を上書きする(このスクリプトは再実行しない)。
# 使い方: bash tools/make_tts.sh   (リポジトリの直下で。macOS 専用)
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=assets/audio/tts
TMP=$(mktemp -d)
mkdir -p "$OUT"
line() { # ID 音声 速さ(語/分) 台詞
  say -v "$2" -r "$3" -o "$TMP/$1.aiff" "$4"
  afconvert -f WAVE -d LEI16@22050 -c 1 "$TMP/$1.aiff" "$OUT/$1.wav"
}
# 気配(呟き)
line mgr_mumble_01       Grandpa 105 "ちがう…… ここじゃ、ない…… つぎ……"
line mgr_mumble_02       Rocko    95 "ひとつ…… ふたつ…… みっつ…… よっつ……"
line mgr_mumble_03       Grandpa 125 "おきてる こは、いないかなあ。 どこかなあ"
# 目の前(笑い・セリフ)
line mgr_laugh_01        Grandpa  95 "ふふ…… ふふふふ……"
line mgr_line_found_01   Grandpa  85 "みぃつけた"
line mgr_line_there_01   Rocko    90 "そこに…… いるんだろう"
# 扉の向こう(笑い・呟き)
line mgr_laugh_02        Grandpa 115 "くっくっくっく……"
line mgr_line_know_01    Grandpa 100 "いるのは…… わかってるよ"
line mgr_line_awake_01   Rocko   100 "まだ…… おきてるのかい"
# 叫び・悲鳴
line mgr_scream_01       Rocko   150 "ああああああああああああ"
line mgr_scream_laugh_01 Grandpa 170 "あはははは、あああああああああ"
line mgr_scream_02       Rocko   140 "うおおおおおおおおおお"
line mgr_scream_03       Grandpa 145 "ぎゃあああああああああああ"
rm -rf "$TMP"
ls -l "$OUT"
