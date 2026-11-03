// audio_bank.js — P4b: ゲームの音の共通の再生器。試聴盤で採用した場面の wav(assets/audio/<場面 ID>.wav。tools/build_audio.sh が生成)と、
// 声の場面(素材 assets/audio/tts/<台詞 ID>.wav ＋ src/audio_voice.js の加工)を、場面 ID の名前で鳴らす。
//  - 位置音: PannerNode(inverse の距離減衰。基準は管理人の音 ENEMY_AUDIO と同じ)。壁越しのこもりは呼び出し側が cutoff(lowpass)を渡す(既存の遮蔽の仕組み)。
//  - 環境音(ループ): loop(id) が返す持ち手に目標音量を渡すと、なめらかに寄せる。音量 0 まで下がったら音源を止める(鳴りっぱなしにしない)。
//  - 記録: 鳴らそうとした場面は AudioContext が止まっていても log / count に残す(?test=audio の「採用場面ごとに再生 API が呼ばれる」の確認用)。
//  - P4e-1: 声の素材のうち assets/audio/tts/recorded.txt にある ID(録音)は src/audio_voice.js の録音プロファイル(試聴盤の rec_fx。未選択は B)で鳴る。
//  - 「なし」の場面はここに来ない(呼び出し側で無音にしている。manifest.none)。3 周目・未選択の場面は各モジュールの仮音のまま。
import { Kit, loadTTS } from './audio_kit.js';
import { VOICE, voiceLines, loadRec, recFx, voiceSpan, REC } from './audio_voice.js';

export const AUDIO = {
  // 場面ごとの音量の倍率(wav は正規化済み: 効果音ピーク −6dBFS、大きめ −3、環境音 RMS −26)。目視(耳)で決める値
  gain: {
    pl_step_room: 0.35, pl_closet: 0.6, room_fall: 1.0, ev_chime: 0.9, ev_motor: 1.0,
    enemy_step_walk: 1.0, enemy_step_run: 1.3, enemy_breath_door: 2.5, enemy_breath_close: 1.0, enemy_door_smash: 1.0, enemy_hit: 1.0, death: 0.9,
    story_221_lure: 0.7, pickup_key: 0.6, pickup_paper: 0.6, x105_scream: 1.0, x705_lights_off: 0.9,
    car_engine: 0.8, ending_gate: 0.9, xb1_loop_notice: 0.8,
    amb_corridor: 0.5, amb_outdoor: 0.8, amb_roof: 1.0, amb_b1: 0.9, amb_x105: 0.7,
  },
  ref: 1.4, rolloff: 1.3, maxDistance: 40,   // 位置音の既定(ENEMY_AUDIO と同じ)
  loopRate: 1.5,                              // 環境音の目標音量への寄り方(1/秒)
  voiceNorm: { sfx: [-6, -18], loud: [-3, -15] },   // 声の音量合わせ(ピーク dBFS・RMS dBFS の上限。試聴盤の NORM と同じ)
};
const db = (d) => Math.pow(10, d / 20);

export class AudioBank {
  constructor({ listener, base = new URL('../assets/audio/', import.meta.url).href }) {
    this.listener = listener;
    this.ctx = listener.context;
    this.out = listener.getInput();
    this.base = base;
    this.manifest = null;
    this.bufs = new Map();      // 場面 ID → AudioBuffer
    this.voiceGain = {};        // 声の場面 → [take ごとの音量合わせの倍率]
    this.voiceTrace = {};       // P4e-1: 声の場面 → [take ごとの { prof: 素材ごとの聞こえ方(null=仮声/A/B/C), vox: Kit.vox に渡った数値 }](検査用)
    this.rec = REC;             // P4e-1: 録音の状態(recorded.txt の ID・rec_fx の選択とその出どころ)
    this.voiceNext = {};        // 声の場面 → 次に使う take
    this.loops = new Map();     // 持ち手の名前 → loop の持ち手
    this.log = []; this.count = {}; this.n = 0;
    this.ready = false; this.error = null;
  }

  // manifest と wav・声の素材を読む(失敗しても遊べる: 鳴らないだけ)
  async load() {
    try {
      const r = await fetch(this.base + 'manifest.json', { cache: 'no-store' });
      if (!r.ok) throw new Error('manifest ' + r.status);
      this.manifest = await r.json();
      await Promise.all(Object.entries(this.manifest.scenes).map(async ([id, m]) => {
        const rr = await fetch(this.base + m.file, { cache: 'no-store' });
        if (!rr.ok) throw new Error(m.file + ' ' + rr.status);
        this.bufs.set(id, await this.ctx.decodeAudioData(await rr.arrayBuffer()));
      }));
      const vids = Object.keys(this.manifest.voice || {}).filter((id) => VOICE[id]);
      await loadRec({ manifest: this.manifest });   // P4e-1: recorded.txt の ID は録音プロファイル(選択は sound_choice.json の rec_fx → manifest → B)
      await loadTTS(voiceLines(vids));
      for (const id of vids) {
        this.voiceTrace[id] = [];
        this.voiceGain[id] = await Promise.all(VOICE[id].takes.map((tk, i) => this._measureVoice(id, tk, i)));
      }
      this.ready = true;
    } catch (e) { this.error = String(e && e.message || e); console.warn('audio bank:', this.error); }
    return this;
  }
  // 声の 1 take をオフラインで 1 度描いて、試聴盤と同じ基準の音量に合わせる倍率を出す(録音に差し替えても自動で揃う)
  //  P4e-1: 録音は全長を使うので、描く長さは素材から見積もる(voiceSpan)。RMS は尻の無音(ピークの −66dB 未満)を除いて測る
  async _measureVoice(id, take, i = 0) {
    const V = VOICE[id], sr = 22050, oc = new OfflineAudioContext(1, Math.ceil((voiceSpan(id, take) + 0.3) * sr), sr);
    const K = new Kit(oc, oc.destination, 0, 7); K.trace = [];
    V.fn(K, take);
    this.voiceTrace[id][i] = { take, prof: take.map((l) => recFx(l)), vox: K.trace };
    const d = (await oc.startRendering()).getChannelData(0);
    let pk = 0; for (const v of d) { const a = Math.abs(v); if (a > pk) pk = a; }
    let end = d.length; while (end > 1 && Math.abs(d[end - 1]) < pk * 5e-4) end--;
    let s2 = 0; for (let k = 0; k < end; k++) s2 += d[k] * d[k];
    const [p, r] = AUDIO.voiceNorm[V.kind] || AUDIO.voiceNorm.sfx, rms = Math.sqrt(s2 / Math.max(1, end));
    return pk < 1e-6 ? 0 : Math.min(db(p) / pk, db(r) / Math.max(rms, 1e-9));
  }

  // 場面の状態: 'wav' | 'voice' | 'none' | 'round3' | 'unselected' | null(manifest に無い)
  status(id) {
    const M = this.manifest; if (!M) return null;
    if (M.scenes[id]) return 'wav';
    if (M.voice && M.voice[id]) return 'voice';
    for (const k of ['none', 'round3', 'unselected']) if ((M[k] || []).includes(id)) return k;
    return null;
  }
  has(id) { return this.bufs.has(id) || !!this.voiceGain[id]; }
  _rec(id, o, kind) {
    this.n++;
    this.count[id] = (this.count[id] || 0) + 1;
    this.log.push({ n: this.n, id, kind, t: +this.ctx.currentTime.toFixed(3), vol: +(o.vol ?? 1).toFixed(3), ...(o.seg ? { seg: o.seg } : {}), ...(o.pos ? { pos: [o.pos.x, o.pos.y, o.pos.z].map((v) => +v.toFixed(2)) } : {}),
      ...(o.tag ? { tag: o.tag } : {}), ...(o.cutoff ? { cutoff: o.cutoff } : {}), ...(o.highpass ? { highpass: o.highpass } : {}), ...(o.dur ? { dur: o.dur } : {}) });   // P6b-C: 足音の面(tag)と加工
    if (this.log.length > 300) this.log.shift();
  }
  get running() { return this.ctx.state === 'running'; }

  // 出口の鎖: 音量 → [lowpass(壁越し)] → [Panner(位置音)] → listener
  _chain(id, o) {
    const c = this.ctx, nodes = [];
    const g = c.createGain(); g.gain.value = (o.vol ?? 1) * (AUDIO.gain[id] ?? 1); nodes.push(g);
    let node = g;
    if (o.cutoff) { const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = o.cutoff; lp.Q.value = 0.5; node.connect(lp); node = lp; nodes.push(lp); }
    if (o.highpass) { const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = o.highpass; hp.Q.value = 0.7; node.connect(hp); node = hp; nodes.push(hp); }   // P6b-C(§3.10 #4): 硬い面の足音
    if (o.pos) {
      const p = c.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
      p.refDistance = o.ref ?? AUDIO.ref; p.rolloffFactor = o.rolloff ?? AUDIO.rolloff; p.maxDistance = AUDIO.maxDistance;
      p.positionX.value = o.pos.x; p.positionY.value = o.pos.y; p.positionZ.value = o.pos.z;
      node.connect(p); node = p; nodes.push(p);
    }
    node.connect(this.out);
    return { input: g, gain: g, nodes, dispose: () => { for (const n of nodes) { try { n.disconnect(); } catch (e) { /* */ } } } };
  }

  // 1 回鳴らす。o: { pos(Vector3。無ければ耳元), vol, ref, rolloff, cutoff(Hz), highpass(Hz), rate, seg(区間の名前), slot(足音の何番目。無ければ乱数), dur(秒で切る), delay(秒), tag(記録用) }
  play(id, o = {}) {
    this._rec(id, o, 'play');
    const b = this.bufs.get(id);
    if (!b || !this.running) return null;
    const m = this.manifest.scenes[id], c = this.ctx;
    let off = 0, len;
    if (m.sprite) { const k = o.slot ?? Math.floor(Math.random() * m.sprite.n); off = (k % m.sprite.n) * m.sprite.slot; len = m.sprite.slot; }
    if (o.seg && m.segs && m.segs[o.seg]) { off = m.segs[o.seg][0]; len = m.segs[o.seg][1] - off; }
    if (o.dur) len = Math.min(len ?? Infinity, o.dur);
    const ch = this._chain(id, o);
    const s = c.createBufferSource(); s.buffer = b; s.playbackRate.value = o.rate || 1; s.connect(ch.input);
    const t = c.currentTime + (o.delay || 0);
    if (len !== undefined && Number.isFinite(len)) s.start(t, off, len); else s.start(t, off);
    if (o.dur && len !== undefined && Number.isFinite(len)) { const gg = ch.gain.gain, v = gg.value; gg.setValueAtTime(v, t + Math.max(0, len - 0.025)); gg.linearRampToValueAtTime(0, t + len); }   // P6b-C: 短く切る時の尻を 25ms で落とす(クリック音を出さない)
    s.onended = () => { try { s.disconnect(); } catch (e) { /* */ } ch.dispose(); };
    return { src: s, gain: ch.gain, stop: (fade = 0.3) => { const n = c.currentTime; ch.gain.gain.cancelScheduledValues(n); ch.gain.gain.setValueAtTime(ch.gain.gain.value, n); ch.gain.gain.linearRampToValueAtTime(0, n + fade); try { s.stop(n + fade + 0.02); } catch (e) { /* */ } } };
  }

  // 声の場面を鳴らす(take を順に回す)。o は play と同じ(pos・vol・cutoff・ref)
  voice(id, o = {}) {
    this._rec(id, o, 'voice');
    const V = VOICE[id], gains = this.voiceGain[id];
    if (!V || !gains || !this.running) return null;
    const i = (this.voiceNext[id] || 0) % V.takes.length;
    this.voiceNext[id] = i + 1;
    const last = this.log[this.log.length - 1]; if (last && last.id === id) { last.take = V.takes[i]; last.prof = V.takes[i].map((l) => recFx(l)); }   // P4e-1: 検査用
    const ch = this._chain(id, { ...o, vol: (o.vol ?? 1) * gains[i] });
    const K = new Kit(this.ctx, ch.input, this.ctx.currentTime + 0.03 + (o.delay || 0), (Math.random() * 1e9) | 0);
    V.fn(K, V.takes[i]);
    setTimeout(() => ch.dispose(), (voiceSpan(id, V.takes[i]) + 1.0 + (o.delay || 0)) * 1000);   // 残響の尾まで待って外す(P4e-1: 録音の全長から見積もる)
    return { take: V.takes[i], prof: V.takes[i].map((l) => recFx(l)) };
  }

  // 環境音・走行音のループの持ち手(name ごとに 1 つ)。h.set(目標音量, { pos }) を毎フレーム呼ぶ → update(dt) で寄せる。0 まで下がると止まる
  loop(id, name = id) {
    if (this.loops.has(name)) return this.loops.get(name);
    const h = { id, name, target: 0, level: 0, src: null, ch: null, pos: null, ref: null, starts: 0,
      set: (v, o = {}) => { h.target = Math.max(0, v); if ('pos' in o) h.pos = o.pos; if (o.ref) h.ref = o.ref; return h; } };
    this.loops.set(name, h);
    return h;
  }
  update(dt) {
    const k = 1 - Math.exp(-dt * AUDIO.loopRate * 2);
    for (const h of this.loops.values()) {
      h.level += (h.target - h.level) * k;
      if (h.target === 0 && h.level < 0.002) h.level = 0;
      const b = this.bufs.get(h.id);
      if (h.level > 0 && (!h.src || (h.src === 'silent' && b && this.running))) {
        if (!h.src) { this._rec(h.id, { vol: h.target }, 'loop'); h.starts++; }
        if (b && this.running) {
          h.ch = this._chain(h.id, { pos: h.pos, ref: h.ref, vol: 0 });
          h.src = this.ctx.createBufferSource(); h.src.buffer = b; h.src.loop = true; h.src.connect(h.ch.input);
          h.src.start(this.ctx.currentTime, Math.random() * b.duration);
        } else h.src = 'silent';   // 鳴らせない(読み込み前・停止中)= 記録だけ。level が 0 に戻れば次にまた試す
      }
      if (h.src && h.src !== 'silent') {
        h.ch.gain.gain.setTargetAtTime(h.level * (AUDIO.gain[h.id] ?? 1), this.ctx.currentTime, 0.05);
        if (h.pos && h.ch.nodes.length) { const p = h.ch.nodes[h.ch.nodes.length - 1]; if (p.positionX) { p.positionX.value = h.pos.x; p.positionY.value = h.pos.y; p.positionZ.value = h.pos.z; } }
      }
      if (h.level === 0 && h.src) {   // 音量 0 になったら止める(P4a の申し送り: EV のモーターが音量 0 で鳴り続けていた)
        if (h.src !== 'silent') { try { h.src.stop(); h.src.disconnect(); } catch (e) { /* */ } h.ch.dispose(); }
        h.src = null; h.ch = null;
      }
    }
  }
  // 鳴っているループ(テスト・デバッグ用)
  playingLoops() { return [...this.loops.values()].filter((h) => h.src).map((h) => ({ name: h.name, id: h.id, level: +h.level.toFixed(3), real: h.src !== 'silent' })); }
  stopLoops() { for (const h of this.loops.values()) { h.target = 0; h.level = 0; } this.update(0); }
}
