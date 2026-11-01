#!/usr/bin/env python3
# serve.py — 開発用の配信サーバー(P4a-2)。
#  - Cache-Control: no-store を全応答に付ける(内蔵ブラウザ/Chrome が import されるモジュールを古いまま使い続ける罠を断つ)
#  - POST /api/sound_choice に JSON を送ると samples/sound_choice.json へ保存する(試聴盤の自動保存)
#  使い方: python3 tools/serve.py [port=8001]   (リポジトリの直下で)
import http.server, json, os, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHOICE = ROOT / 'samples' / 'sound_choice.json'
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8001

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, max-age=0')
        self.send_header('Pragma', 'no-cache')
        super().end_headers()
    def do_POST(self):
        if self.path.split('?')[0] != '/api/sound_choice':
            self.send_error(404); return
        n = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(n)
        try:
            data = json.loads(body.decode('utf-8'))
            assert isinstance(data, dict)
        except Exception:
            self.send_error(400, 'bad json'); return
        CHOICE.parent.mkdir(parents=True, exist_ok=True)
        CHOICE.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        out = json.dumps({'ok': True, 'saved': str(CHOICE.relative_to(ROOT)), 'scenes': len(data.get('choices', data))}).encode()
        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(out))); self.end_headers(); self.wfile.write(out)
    def log_message(self, *a):
        pass

if __name__ == '__main__':
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    with http.server.ThreadingHTTPServer(('127.0.0.1', PORT), H) as s:
        print(f'serving {ROOT} at http://127.0.0.1:{PORT}/ (no-store)', flush=True)
        s.serve_forever()
