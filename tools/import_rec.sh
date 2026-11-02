#!/bin/bash
# import_rec.sh — P4d: ユーザーの声の録音を 1 コマンドでゲームに取り込む(macOS 専用。afconvert と python3 の標準ライブラリだけ。外部ツール不要)。
# 使い方:
#   1) iPhone のボイスメモで録った m4a(wav / aiff / caf / mp3 でも可)を assets/audio/rec_in/ に置く。
#      ファイル名の先頭が台詞 ID(docs/lines.md の ID)ならよい。  例: mgr_line_found_01.m4a / "mgr_line_found_01 取り直し.m4a" / mgr_scream_01_take2.wav
#   2) リポジトリの直下で  bash tools/import_rec.sh   (特定の ID だけなら  bash tools/import_rec.sh mgr_scream_01 …)
#   3) ゲーム(と試聴盤)を再読み込み(Cmd+Shift+R)。build_audio.sh は要らない
# 何をするか:
#   rec_in/ の各ファイル → afconvert でモノラル 22.05kHz 16bit の wav → 前後の無音を詰める(下記)→ assets/audio/tts/<ID>.wav へ上書き。
#   音量は揃えない(ゲームが読み込み時に自動で揃える: src/audio_bank.js)。加工(低く・遅く・こもり・残響)も要らない(ゲームが掛ける)。
#   ID が docs/lines.md の台詞表に無いファイルは警告して飛ばす。同じ ID のファイルが複数あれば、更新が新しい方を使う(警告する)。
#   取り込んだ ID は assets/audio/tts/recorded.txt に記録する。tools/make_tts.sh はこの一覧の ID を仮声で上書きしない(FORCE=1 で上書き)。
#   rec_in/ は gitignore(元ファイルはリポジトリに入れない)。tts/ の wav と recorded.txt はコミットする。
# 無音の詰め方: 10ms ごとの音量を見て、ピークの −42dB(または −56dBFS の大きい方)を超える最初〜最後の区間を残し、前に 0.10 秒・後ろに 0.30 秒の余白を付ける
#   (ささやきの語尾・息の消え際を切らないため後ろは長め)。切り口には短いフェードを付ける。
set -euo pipefail
cd "$(dirname "$0")/.."
IN=assets/audio/rec_in
OUT=assets/audio/tts
mkdir -p "$IN" "$OUT"
command -v afconvert >/dev/null || { echo "afconvert が見つかりません(macOS 専用です)" >&2; exit 1; }

# 台詞表の ID(docs/lines.md の表の 1 列目)
IDS=$(grep -oE '^\| `[a-z0-9_]+`' docs/lines.md | sed -E 's/^\| `//; s/`$//' | sort -u)
[ -n "$IDS" ] || { echo "docs/lines.md から台詞 ID が読めません" >&2; exit 1; }
ONLY=" $* "

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

n_ok=0; n_skip=0
DONE=(); PICK_ID=(); PICK_FILE=()

shopt -s nullglob nocaseglob
for f in "$IN"/*.m4a "$IN"/*.wav "$IN"/*.aiff "$IN"/*.aif "$IN"/*.caf "$IN"/*.mp3 "$IN"/*.mp4 "$IN"/*.aac; do
  base=$(basename "$f" | tr 'A-Z' 'a-z')   # 大文字小文字は区別しない
  # ファイル名の先頭にある、台詞表の最長の ID(直後が英数字でないこと)
  id=""
  for cand in $IDS; do
    case "$base" in
      "$cand"*)
        rest=${base#"$cand"}
        if [[ -z "$rest" || ! "${rest:0:1}" =~ [A-Za-z0-9] ]]; then
          [ ${#cand} -gt ${#id} ] && id=$cand
        fi ;;
    esac
  done
  if [ -z "$id" ]; then
    echo "警告: 飛ばしました — $(basename "$f") (名前の先頭が docs/lines.md の台詞 ID ではありません)"
    n_skip=$((n_skip + 1)); continue
  fi
  if [ "$ONLY" != "  " ] && [[ "$ONLY" != *" $id "* ]]; then continue; fi
  # 同じ ID が複数 → 更新が新しい方
  found=-1
  for ((i = 0; i < ${#PICK_ID[@]}; i++)); do [ "${PICK_ID[$i]}" = "$id" ] && found=$i; done
  if [ $found -ge 0 ]; then
    if [ "$f" -nt "${PICK_FILE[$found]}" ]; then
      echo "警告: $id のファイルが複数あります — 新しい方を使います ($(basename "$f")。飛ばした: $(basename "${PICK_FILE[$found]}"))"
      PICK_FILE[$found]=$f
    else
      echo "警告: $id のファイルが複数あります — 新しい方を使います (飛ばした: $(basename "$f"))"
    fi
    n_skip=$((n_skip + 1))
  else
    PICK_ID+=("$id"); PICK_FILE+=("$f")
  fi
done
shopt -u nullglob nocaseglob

if [ ${#PICK_ID[@]} -eq 0 ]; then
  echo "取り込むファイルがありません。$IN/ に <台詞ID>.m4a などを置いてください(ID は docs/lines.md、手引きは docs/recording_guide.md)。"
  exit 0
fi

for ((i = 0; i < ${#PICK_ID[@]}; i++)); do
  id=${PICK_ID[$i]}; f=${PICK_FILE[$i]}
  if ! afconvert -f WAVE -d LEI16@22050 -c 1 "$f" "$TMP/$id.wav" 2>"$TMP/err.txt"; then
    echo "警告: 変換できませんでした — $(basename "$f") ($(tr '\n' ' ' <"$TMP/err.txt"))"
    n_skip=$((n_skip + 1)); continue
  fi
  # 前後の無音を詰める(標準ライブラリだけ)
  if python3 - "$TMP/$id.wav" "$OUT/$id.wav" "$id" <<'PY'
import array, math, sys, wave
src, dst, name = sys.argv[1:4]
# RIFF を自前で読む(afconvert が m4a から作る wav は WAVE_FORMAT_EXTENSIBLE で、標準の wave モジュールが開けないため)
d = open(src, 'rb').read()
if d[:4] != b'RIFF' or d[8:12] != b'WAVE':
    print('警告: %s — wav として読めません' % name); sys.exit(2)
pos, sr, nch, sw, raw = 12, 0, 0, 0, b''
while pos + 8 <= len(d):
    cid, csz = d[pos:pos + 4], int.from_bytes(d[pos + 4:pos + 8], 'little')
    body = d[pos + 8:pos + 8 + csz]
    if cid == b'fmt ': nch, sr, sw = int.from_bytes(body[2:4], 'little'), int.from_bytes(body[4:8], 'little'), int.from_bytes(body[14:16], 'little') // 8
    elif cid == b'data': raw = body
    pos += 8 + csz + (csz & 1)
if sw != 2 or nch != 1:
    print('警告: %s — 変換後が 16bit モノラルではありません' % name); sys.exit(2)
a = array.array('h'); a.frombytes(raw)
if sys.byteorder == 'big': a.byteswap()
if not len(a):
    print('警告: %s — 録音が空です' % name); sys.exit(2)
pk = max(max(a), -min(a))
dbfs = lambda v: 20 * math.log10(max(v, 1) / 32768.0)
win = max(1, sr // 100)                       # 10ms
rms = []
for i in range(0, len(a), win):
    seg = a[i:i + win]
    rms.append(math.sqrt(sum(x * x for x in seg) / len(seg)))
thr = max(pk * 10 ** (-42 / 20), 32768 * 10 ** (-56 / 20))
idx = [i for i, r in enumerate(rms) if r >= thr]
warn = []
if pk < 32768 * 10 ** (-30 / 20): warn.append('音が小さい(ピーク %.0fdBFS。もう少し近づいて録ると雑音が減ります)' % dbfs(pk))
if pk >= 32767 * 0.995: warn.append('音が割れている可能性(ピークが上限。少し離れて録ってください)')
if not idx:
    s0, s1 = 0, len(a)
    warn.append('無音に近いので詰めませんでした')
else:
    s0 = max(0, idx[0] * win - int(0.10 * sr))
    s1 = min(len(a), (idx[-1] + 1) * win + int(0.30 * sr))
b = array.array('h', a[s0:s1])
fi, fo = int(0.004 * sr), int(0.03 * sr)       # 切り口のフェード(頭 4ms・尻 30ms)
for i in range(min(fi, len(b))): b[i] = int(b[i] * i / fi)
for i in range(min(fo, len(b))): b[len(b) - 1 - i] = int(b[len(b) - 1 - i] * i / fo)
if sys.byteorder == 'big': b.byteswap()
o = wave.open(dst, 'wb'); o.setnchannels(1); o.setsampwidth(2); o.setframerate(sr); o.writeframes(b.tobytes()); o.close()
print('%-22s %.2f秒 → %.2f秒 (前 %.2f / 後 %.2f 秒を詰めた)  ピーク %.1fdBFS%s' % (name, len(a) / sr, len(b) / sr, s0 / sr, (len(a) - s1) / sr, dbfs(pk),
      ''.join('\n  警告: ' + m for m in warn)))
PY
  then
    n_ok=$((n_ok + 1)); DONE+=("$id")
  else
    echo "警告: $id の取り込みに失敗しました"
    n_skip=$((n_skip + 1))
  fi
done

# 録音済みの ID の一覧(make_tts.sh が仮声で上書きしない。重複なし・並べ替え)
if [ ${#DONE[@]} -gt 0 ]; then
  { [ -f "$OUT/recorded.txt" ] && cat "$OUT/recorded.txt"; printf '%s\n' "${DONE[@]}"; } | grep -v '^\s*$' | sort -u >"$TMP/rec.txt"
  cp "$TMP/rec.txt" "$OUT/recorded.txt"
fi
echo "取り込み $n_ok 本 / 飛ばした $n_skip 本 → $OUT/ (録音済みの一覧: $OUT/recorded.txt)。ゲームを再読み込みしてください(Cmd+Shift+R)"
