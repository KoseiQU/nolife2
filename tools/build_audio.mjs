// build_audio.mjs — P4b: 試聴盤で採用された音(samples/sound_choice.json)を assets/audio/<場面 ID>.wav と assets/audio/manifest.json に書き出す。
//  ヘッドレス Chromium で tools/build_audio.html を開き、samples/sound_lib.js の候補を OfflineAudioContext で描く(22.05kHz・16bit・モノラル・正規化)。
//  依存なし(Node 22 以上の組み込み WebSocket と http だけ)。Chromium は CHROME=… か Playwright のキャッシュか /Applications の Chrome を使う。
//  使い方: bash tools/build_audio.sh   (= node tools/build_audio.mjs)。声の場面は wav にしない(素材 assets/audio/tts＋src/audio_voice.js の加工をゲームが掛ける)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets', 'audio');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wav': 'audio/wav' };

function findChrome() {
  const c = [process.env.CHROME];
  const pw = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  if (fs.existsSync(pw)) for (const d of fs.readdirSync(pw).sort().reverse()) {
    if (d.startsWith('chromium_headless_shell-')) for (const sub of fs.readdirSync(path.join(pw, d))) c.push(path.join(pw, d, sub, 'chrome-headless-shell'));
    if (d.startsWith('chromium-')) for (const sub of fs.readdirSync(path.join(pw, d))) c.push(path.join(pw, d, sub, 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'));
  }
  c.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/google-chrome');
  const f = c.find((p) => p && fs.existsSync(p));
  if (!f) throw new Error('Chromium が見つからない(CHROME=実行ファイルのパス で指定)');
  return f;
}

const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const f = path.join(ROOT, u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'n2audio-'));
const chrome = spawn(findChrome(), ['--headless', '--remote-debugging-port=0', `--user-data-dir=${prof}`, '--autoplay-policy=no-user-gesture-required', '--no-first-run', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((res, rej) => {
  let buf = '';
  const to = setTimeout(() => rej(new Error('Chromium が起動しない')), 20000);
  chrome.stderr.on('data', (d) => { buf += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) { clearTimeout(to); res(m[1]); } });
});
const done = async (code) => {
  server.close();
  await new Promise((r) => { chrome.once('exit', r); try { chrome.kill(); } catch (e) { r(); } setTimeout(r, 3000); });
  try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) { /* 一時プロファイルの掃除に失敗しても成果物には関係ない */ }
  process.exit(code);
};

// ---- CDP(最小限)
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r));
let seq = 0;
const pend = new Map();
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const cdp = (method, params = {}, sessionId) => new Promise((res, rej) => { const id = ++seq; pend.set(id, (m) => (m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result))); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
await cdp('Page.enable', {}, sessionId);
await cdp('Runtime.enable', {}, sessionId);
await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/tools/build_audio.html` }, sessionId);
const evalP = async (expr) => {
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
  return r.result.value;
};
for (let i = 0; i < 100; i++) { if (await evalP('!!(window.N2B && window.N2B.ready)')) break; await new Promise((r) => setTimeout(r, 100)); if (i === 99) { console.error('build_audio.html が読めない'); done(1); } }

try {
  const plan = await evalP('N2B.plan()');
  fs.mkdirSync(OUT, { recursive: true });
  const scenes = {};
  let total = 0;
  for (const { id, cand, note } of plan.adopted) {
    const r = await evalP(`N2B.render(${JSON.stringify(id)}, ${JSON.stringify(cand)})`);
    const buf = Buffer.from(r.b64, 'base64');
    // 描画の浮動小数の揺れで数サンプルが ±1(16bit の最下位)だけ変わることがある。その程度なら今のファイルを残す(git に意味の無い差分を出さない)
    const fp = path.join(OUT, id + '.wav');
    const old = fs.existsSync(fp) ? fs.readFileSync(fp) : null;
    let same = !!old && old.length === buf.length && old.subarray(0, 44).equals(buf.subarray(0, 44));
    for (let i = 44; same && i < buf.length; i += 2) if (Math.abs(old.readInt16LE(i) - buf.readInt16LE(i)) > 1) same = false;
    if (!same) fs.writeFileSync(fp, buf);
    scenes[id] = { file: id + '.wav', ...r.meta, ...(note ? { note } : {}) };
    total += buf.length;
    console.log(`${id.padEnd(20)} ${cand.toUpperCase()}  ${r.meta.dur.toFixed(2).padStart(6)}s  ${(buf.length / 1024).toFixed(0).padStart(5)}KB  peak ${r.meta.peakDb}dB${r.meta.loop ? '  loop' : ''}${r.meta.sprite ? '  sprite×' + r.meta.sprite.n : ''}`);
  }
  // 採用から外れた場面の古い wav を消す(場面 ID と wav は 1 対 1)
  const keep = new Set(Object.values(scenes).map((s) => s.file));
  for (const f of fs.readdirSync(OUT)) if (f.endsWith('.wav') && !keep.has(f)) { fs.unlinkSync(path.join(OUT, f)); console.log('removed', f); }
  const manifest = {
    _note: 'tools/build_audio.sh が samples/sound_choice.json(試聴盤の選択)から生成。手で直さない。scenes = 採用して wav にした場面、voice = 声の場面(素材 assets/audio/tts＋src/audio_voice.js の加工をゲームが掛ける)、none = 採用なし(ゲーム内で無音)、round3 = 試聴盤 3 周目の選択待ち(ゲームは仮音のまま。反映済みの場面は scenes か none か unselected へ。P4d で空)、unselected = 未選択(ゲームでは無音 = なし扱い。P4d 時点は amb_x312_room_loop)',
    sr: 22050, totalBytes: total, scenes,
    voice: Object.fromEntries(plan.voice.map((v) => [v.id, { cand: v.cand, ...(v.note ? { note: v.note } : {}) }])),
    none: plan.none, round3: plan.round3, unselected: plan.unselected,
  };
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  console.log(`\n${Object.keys(scenes).length} wav ${(total / 1048576).toFixed(2)}MB + 声 ${plan.voice.length} 場面 / なし ${plan.none.length} / 3 周目 ${plan.round3.length} / 未選択 ${plan.unselected.length} → assets/audio/manifest.json`);
  done(0);
} catch (e) { console.error(String(e && e.stack || e)); done(1); }
