#!/bin/bash
# build_audio.sh — P4b: 試聴盤の選択(samples/sound_choice.json)からゲームの音 assets/audio/<場面 ID>.wav と manifest.json を作り直す(1 コマンド)。
#  - 中身は tools/build_audio.mjs(ヘッドレス Chromium で samples/sound_lib.js の候補を描く。22.05kHz・16bit・モノラル)。
#  - 声(管理人の台詞・叫び)は wav に焼かない。素材 assets/audio/tts/<ID>.wav(仮声 = tools/make_tts.sh、録音は同名で置くだけ)にゲームが加工を掛ける。
# 使い方: bash tools/build_audio.sh   (リポジトリの直下で。Node 22 以上)
set -euo pipefail
cd "$(dirname "$0")/.."
node tools/build_audio.mjs "$@"
