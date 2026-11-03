// tutorial.js — P6a: 場面を映すチュートリアル(DESIGN §3.8「チュートリアル(2026-11-01 ユーザー決定)」の表 0〜8。P5a の仮の文字カードを置き換えた)。
//  P6b(§3.9 #11): 場面 3b(外階段の踊り場)・6b(開いた扉と閉まった扉)を追加。並びは 0,1,2,3,3b,4,5,6,6b,7,8(TUT.ids)、合計 87.5 秒。
//  P6b-A2(§3.9 #17): 場面 7b(4F の廊下を走る足音 → 遠くの EV の表示が 2→3→4 と動いてチャイム)を追加。並びは …,7,7b,8、合計 94.0 秒。
//  P6b-F1(§3.12 #2・#3): 場面 1 を外観に(敷地の南東の門の内側の低いカメラから建物を見上げる 8 秒。案 A の構図・霧 0.06・露出 3.7・管理人なし)。
//    410 の仕込み(動かないスマホ・場面 1 の環境光の持ち上げ)は撤去。場面 7c(7b の後 3.0 秒: 覗き穴の向こうの管理人の顔 grin→attack・レンズの血・打撃音 1 発。
//    入りは 0.1 秒の黒のカット、終わりは即暗転 → 8)を追加。並びは …,7,7b,7c,8、合計 97.0 秒。
//  タイトルのクリックの後、操作を奪ったカメラが館内の場面 0〜8 を順に映し、各場面に表の一文を出す(0 は黒の中央、1〜7 は画面下)。
//  音楽なし。環境音(main の updateAmbience)と場面の音(AudioBank の採用場面: 管理人の足音・EV のチャイム・花瓶の割れる音)だけ。
//  - 管理人は演出体として置く: AI の通常動作(ai.update)は main が止め、ここが enemy を直接置いて歩かせる(位置・向き・クリップ・懐中電灯・照らす点)。
//    見せない時は ai.concealed(main が描かない)。光で見せる(§3.4): 場面 2 は廊下の奥の角の向こうに置いて光だけ、場面 4 は逆光と覗き穴越し。
//  - プレイヤーの入力は止める(player.frozen・PointerLockControls.enabled = false)。カメラは毎フレーム上書き(場面 5 の位置は rooms の隠れ場所、場面 4 の後半は覗き穴)。
//  - 2 回目以降は Esc(ポインタロック中に Esc でロックが外れた時も)で飛ばせる → 場面 8 へ。既読は localStorage(TUT.seenKey)。
//  - 終わると(場面 8 の暗転の中で)演出で動かした物を開始時の状態へ戻す: 管理人(main の resetAI)・410 の扉・EV のカゴ・扉の下の帯・クローゼット/ロッカー・
//    覗き穴・懐中電灯・環境光。410 のベッド脇でフェードインして、既存の操作一覧(hud.showControls)を数秒。
//  update(dt) 駆動(rAF 非依存。手動ポンプで決定的に進む)。階の読み込みを待つ間は場面の時計を止める(暗転のまま)。

import * as THREE from 'three';
import { HUD_TEXT } from './hud_text.js';
import { levelY, glbLevel } from './world.js';

export const TUT = {
  seenKey: 'nolife2.tutorialSeen',
  // 場面の並び(P6b §3.9 #11 で 3b・6b を追加。配列の添字 = this.index、表の番号 = ids[index])
  ids: ['0', '1', '2', '3', '3b', '4', '5', '6', '6b', '7', '7b', '7c', '8'],
  // 場面ごとの所要時間(秒。読み込み待ちを除く)。合計 97.0 秒(契約 ≤100。P6a の 74.5 秒 ＋ 3b 6.0 ＋ 6b 7.0 ＋ 7b 6.5 ＋ 7c 3.0)
  dur: [5.0, 8.0, 8.5, 8.0, 6.0, 13.0, 7.5, 13.5, 7.0, 8.0, 6.5, 3.0, 3.0],
  edgeFade: 0.6,       // 場面の始めと終わりの暗転(秒)
  cutFade: 0.3,        // 場面 6 の中のカット
  bedside: { level: 4, x: 12.35, z: 7.25, yaw: Math.PI / 2, pitch: -0.04 },   // 終わりの位置: 410 のベッド脇(西 = 玄関の方を向く)
  stripBoost: 7.0,     // 場面 6: 扉の下の帯の揺らぎを見せるための倍率(DOORFX.stripLeak ×)。終われば戻す
  jiggle: 0.05,        // 場面 6: ロッカーが内側から軋む時の扉の小さな開き(rad)
  lurkDoor: '409',     // 場面 6: 下の闇が揺らぐ空室(4F・410 の隣)
  lockerRoom: '611',   // 場面 6: 内側から軋むロッカー(6F の罠の部屋の奥の窓際)
  ambient5: 0.5,       // 場面 5: クローゼットの隙間から薄暗い部屋が読める程度に
  gap5: 0.15,          // 場面 5: 隙間の開き(ROOMS.hideGap 0.09 より少し広く。映す時だけ)
  flashScale: 0.38,    // 場面 6・7: 近い壁・扉が白く飛ばないよう、自分の懐中電灯をこの倍率に(終われば戻す)
  stair3b: { level: 3 },   // P6b 場面 3b: 3F の外階段の踊り場(場面 3 と同じ階 = 読み込み待ちなし)
  open6b: '410', closed6b: '409',   // P6b 場面 6b: 4F の廊下の北端から、手前の開いた扉(410)と奥の閉まった扉(409)
  // P6b-A2 場面 7b: 4F の廊下を南(EV ホール)へ走る。z0→z1 を run 秒(≈2.5 m/s)、足音の間隔 step 秒、目の上下 bob m。
  //  カゴは 2F から呼ばれて travel 秒で 4F へ(表示 2→3→4・チャイム。扉は開けない)
  // P6b-E1(§3.11 #3): チュートリアルの間(場面 1〜7b)だけ露出を 1 段暗く(本編 LOOK.exposure 4.5)。場面 0 の黒はそのまま、場面 8 の暗転(片付け)で開始時の値へ戻す
  exposure: 3.2,
  // P6b-F1: 場面ごとの露出の上書き。1 = 外観(案 A の 3.7。3.2 だと建物が霧に沈んで「見上げる」形が読めない = docs/p6b-f1/NOTES.md §3)、
  //  7c = 覗き穴(案 B の 6.0。魚眼の外の黒が画面の 7 割あるので中を持ち上げる)
  exposureBy: { '1': 3.7, '7c': 6.0 },
  // P6b-F1 場面 1: 敷地 'G' の南東の門の内側・地面近く(案 A のカメラ)から北西の建物を見上げる。見る先の高さを y0 → y1 へ 8 秒で上げ、少しだけ寄る(push m)。
  //  霧は外観・木の材質の霧(LOOK.ext.fogDensity)を 0.06 に(案 A。場面を出る時に戻す)
  ext1: { x: 35.4, z: 32.4, eye: 0.85, tx: 16.0, tz: 14.0, y0: 3.2, y1: 9.5, push: 0.45, fov: 50, fogD: 0.06, fogC: [0.016, 0.018, 0.024] },
  // P6b-F1 場面 7c: 410 の室内(覗き穴の前)から。管理人は扉の前 0.4m(案 B)。grin → attack(見開き)、打撃音と同時にレンズに血
  peep7c: { cam: [8.62, 7.25], enemy: [7.1, 7.24], clip: 'walk_oldman', time: 0.3, grin: [0.5, 0.6], attackAt: 1.05, attackIn: 0.35, attack: 0.95, hitAt: 1.75, lean: 0.0, under: 0.3, cut: 0.1 },
  run7b: { x: 6.9, z0: 8.6, z1: 14.0, t0: 0.3, run: 2.2, step: 0.3, bob: 0.035, eye: 1.52, callAt: 0.6, from: 2, to: 4, travel: 3.4 },
};
const LAST = TUT.ids.length - 1;   // 最後の場面(黒 → ベッド脇)
const DUR = (id) => TUT.dur[TUT.ids.indexOf(id)];

const CSS = `
#tutx { position: fixed; inset: 0; z-index: 8; pointer-events: none; background: #000; opacity: 0; }
#tutcap { position: fixed; left: 50%; bottom: 9vh; transform: translateX(-50%); z-index: 9; pointer-events: none; width: max-content; max-width: 84vw;
  text-align: center; font: 400 19px/1.75 "Hiragino Mincho ProN", "Yu Mincho", "YuMincho", serif; letter-spacing: .14em; color: #e6dfd2;
  text-shadow: 0 0 6px rgba(0,0,0,.95), 0 1px 2px rgba(0,0,0,.95); opacity: 0; }
#tutcenter { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 9; pointer-events: none; white-space: nowrap;
  font: 400 21px/1 "Hiragino Mincho ProN", "Yu Mincho", "YuMincho", serif; letter-spacing: .32em; color: #b9b2a8; opacity: 0; }
#tutskip { position: fixed; right: 22px; bottom: 18px; z-index: 9; pointer-events: none; font: 400 11px/1 -apple-system, "Hiragino Sans", sans-serif;
  letter-spacing: .18em; color: #8b857c; opacity: 0; transition: opacity .6s linear; }
`;

const smooth = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const yawTo = (fx, fz, tx, tz) => Math.atan2(-(tx - fx), -(tz - fz));   // カメラの yaw(0 = 北 −z)
// キーフレーム { t, x, z, eye, yaw, pitch } を時刻 t で補間(区間ごとに smoothstep。yaw は近い方へ回す)
function keys(K, t) {
  if (t <= K[0].t) return { ...K[0] };
  for (let i = 0; i < K.length - 1; i++) {
    const a = K[i], b = K[i + 1];
    if (t <= b.t) {
      const k = smooth((t - a.t) / Math.max(1e-6, b.t - a.t));
      const o = {};
      for (const f of ['x', 'z', 'eye', 'pitch']) o[f] = a[f] + (b[f] - a[f]) * k;
      o.yaw = a.yaw + wrap(b.yaw - a.yaw) * k;
      return o;
    }
  }
  return { ...K[K.length - 1] };
}

export class Tutorial {
  // ctx: { camera, player, ai, enemy, enemyAudio, bank, world, elevator, rooms, doorFx, peephole, hud, scene, ambientFloor, door410,
  //        teleport(level, x, z, yaw, pitch), getLevel(), resetAI(dormant), controlsSec,
  //        renderer, movie(襲撃ムービー: 7c のレンズの血), exterior, loadExterior(), look(LOOK: 場面 1 の外の霧) }
  constructor(ctx) {
    Object.assign(this, ctx);
    this.active = false;
    this.index = -1;        // 場面の添字(0〜LAST。表の番号は TUT.ids[index])
    this.t = 0;             // 場面の中の時刻(読み込み待ちを除く)
    this.total = 0;         // 開始からの合計(読み込み待ちを除く)
    this.log = [];
    this.lurkId = null;     // main が doorFx.update に渡す(場面 6 の扉の下の揺らぎ)
    this.cap = '';
    this._shot = -1;
    this._build();
  }

  // ------------------------------------------------------------ 既読
  get seen() { try { return localStorage.getItem(TUT.seenKey) === '1'; } catch (e) { return false; } }
  set seen(v) { try { if (v) localStorage.setItem(TUT.seenKey, '1'); else localStorage.removeItem(TUT.seenKey); } catch (e) { /* 使えない環境では毎回初回扱い */ } }

  _build() {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    this.black = document.createElement('div'); this.black.id = 'tutx';
    this.capEl = document.createElement('div'); this.capEl.id = 'tutcap';
    this.centerEl = document.createElement('div'); this.centerEl.id = 'tutcenter';
    this.skipEl = document.createElement('div'); this.skipEl.id = 'tutskip'; this.skipEl.textContent = HUD_TEXT.tutorial.skip;
    document.body.append(this.black, this.capEl, this.centerEl, this.skipEl);
    for (const el of [this.black, this.capEl, this.centerEl, this.skipEl]) el.style.display = 'none';
    this._key = (e) => {
      if (!this.active || e.code !== 'Escape') return;
      e.preventDefault(); e.stopPropagation();
      this.requestSkip('esc');
    };
    window.addEventListener('keydown', this._key, true);
    // 小道具(この演出の間だけ置く): 場面 7 の机の花瓶と破片・場面 6 の扉の隙間から漏れる光(P6b-F1: 場面 1 のスマホは場面 1 を外観にしたので撤去)
    this.props = new THREE.Group(); this.props.name = 'TutorialProps';
    const vaseMat = new THREE.MeshStandardMaterial({ color: 0x3a5a76, roughness: 0.25 });
    const prof = [[0, 0], [0.045, 0], [0.058, 0.035], [0.062, 0.09], [0.045, 0.17], [0.027, 0.215], [0.032, 0.25], [0.027, 0.25]].map(([x, y]) => new THREE.Vector2(x, y));
    const vase = new THREE.Group();
    vase.add(new THREE.Mesh(new THREE.LatheGeometry(prof, 18), vaseMat));
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.2, 4), new THREE.MeshStandardMaterial({ color: 0x3c5a30, roughness: 0.8 }));
    stem.position.y = 0.32; stem.rotation.z = 0.12; vase.add(stem);
    this.vase = vase;
    this.vaseHome = new THREE.Vector3(12.74, levelY(4) + 0.722, 8.17);
    this.shards = new THREE.Group();
    let s = 11; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 11; i++) {
      const g = new THREE.BufferGeometry();
      const r = 0.02 + rnd() * 0.05;
      g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, r, 0.004, rnd() * 0.02, rnd() * r, 0.01, r * (0.6 + rnd())], 3));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x3a5a76, roughness: 0.22, side: THREE.DoubleSide }));
      m.userData.off = [(rnd() - 0.5) * 0.9, (rnd() - 0.5) * 0.7]; m.rotation.y = rnd() * 6.28;
      this.shards.add(m);
    }
    for (const o of [vase, this.shards]) o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    // 扉の隙間から漏れる自分の懐中電灯の光(410 の扉の下と戸先の細い線。廊下側の床に落ちた光が隙間から見える)
    this.leakMat = new THREE.MeshBasicMaterial({ color: 0xffe2b8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.leak = new THREE.Group();
    // 花瓶は最初から 410 の机の上(場面 1〜6 にも映る。場面 7 で落ちる)。破片は割れるまで隠す
    vase.position.copy(this.vaseHome); vase.rotation.y = 0.4;
    this.shards.visible = false;
    this.props.add(vase, this.shards, this.leak);
  }

  _buildLeak() {
    if (this.leak.children.length || !this.door410 || !this.door410.collision) return;
    const c = this.door410.collision, y0 = levelY(4);
    const w = c.maxZ - c.minZ;
    const under = new THREE.Mesh(new THREE.PlaneGeometry(0.05, w - 0.06).rotateX(-Math.PI / 2), this.leakMat);   // 扉の下の床(内側の縁)
    under.position.set(c.maxX + 0.012, y0 + 0.004, (c.minZ + c.maxZ) / 2);
    const under2 = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.04, 0.008).rotateY(Math.PI / 2), this.leakMat);   // 扉の下端の隙間(高さ 8mm の横の線)
    under2.position.set(c.maxX + 0.003, y0 + 0.006, (c.minZ + c.maxZ) / 2);
    this.leakEdgeMat = this.leakMat.clone();
    const edge = new THREE.Mesh(new THREE.PlaneGeometry(0.004, 1.95).rotateY(Math.PI / 2), this.leakEdgeMat);     // 戸先の縦の隙間(下より弱く)
    edge.position.set(c.maxX + 0.003, y0 + 1.0, c.maxZ - 0.012);
    for (const m of [under, under2, edge]) { m.renderOrder = 12; m.frustumCulled = false; this.leak.add(m); }
  }

  // ------------------------------------------------------------ 開始・飛ばす・終わり
  start() {
    if (this.active) return;
    const { elevator: E, door410: D, player: P } = this;
    this.snap = {
      car: { ...E.car, pending: [...E.car.pending] }, npc: E.npc, npcStop: E.npcStop,
      door410: D ? { angle: D.angle, target: D.target, speedMul: D.speedMul, locked: D.locked } : null,
      flashlight: P.flashlightOn, flashI: P.flashlight.intensity, fov: this.camera.fov, ambient: this.ambientFloor.intensity,
      aiDormant: this.ai.dormant, exposure: this._exposure(),
    };
    this.active = true;
    this.index = -1; this.total = 0;
    this.log.push({ ev: 'start', seen: this.seen });
    P.frozen = true;
    P.controls.enabled = false;
    if (P.flashlightPending !== null) P.flashlightPending = null;
    this.ai.setState('SCRIPTED', { force: true });
    this.ai.concealed = true;
    this.hud.root.style.visibility = 'hidden';
    for (const el of [this.black, this.capEl, this.centerEl, this.skipEl]) el.style.display = '';
    this.black.style.opacity = '1';
    this.skipEl.style.opacity = this.seen ? '0.8' : '0';
    this.scene.add(this.props);
    this._go(0);
  }

  // Esc・ポインタロックが外れた: 2 回目以降(既読)なら場面 8 へ
  requestSkip(why) {
    if (!this.active) return false;
    if (!this.seen || this.index >= LAST) { this.log.push({ ev: 'skip_ignored', why, index: this.index }); return false; }
    this.log.push({ ev: 'skip', why, from: this.index, t: +this.t.toFixed(2) });
    this._go(LAST);
    return true;
  }

  _go(i) {
    if (this.index >= 0) this._exitScene(this.index);
    this.index = i; this.t = 0; this._shot = -1; this.waiting = false;
    this.cap = HUD_TEXT.tutorial.scenes[i] || '';
    if (i === 0) { this.centerEl.textContent = this.cap; this.capEl.textContent = ''; }
    else { this.centerEl.textContent = ''; this.capEl.textContent = this.cap; }
    this.log.push({ ev: 'scene', index: i, id: TUT.ids[i], text: this.cap, at: +this.total.toFixed(3) });
    this._exposure(i >= 1 && i < LAST ? (TUT.exposureBy[TUT.ids[i]] ?? TUT.exposure) : this.snap.exposure);   // P6b-E1: 1〜7c は暗く(P6b-F1: 1 = 3.7・7c = 6.0)、0・8 は開始時の値(場面の頭は暗転の中)
    this._enterScene(i);
  }

  _finish() {
    const P = this.player;
    this.active = false;
    this.black.style.opacity = '0';
    for (const el of [this.black, this.capEl, this.centerEl, this.skipEl]) el.style.display = 'none';
    P.frozen = false;
    P.controls.enabled = true;
    this.index = LAST + 1;
    this._exposure(this.snap.exposure);   // P6b-E1: 念のため(_restore で戻している)
    this.log.push({ ev: 'end', total: +this.total.toFixed(3) });
    if (this.onDone) this.onDone();
  }

  // ------------------------------------------------------------ 共通の部品
  // カメラ: 足元 (x, z)・目の高さ eye(床から)・向き
  _cam(o, level = this.getLevel()) {
    this.player.setPose(o.x, o.z, o.yaw, o.pitch);
    this.camera.position.y = levelY(level) + o.eye;
    this.camera.updateMatrixWorld();
  }
  _look(x, eye, z, tx, ty, tz) { return { x, z, eye, yaw: yawTo(x, z, tx, tz), pitch: Math.atan2(ty - eye, Math.hypot(tx - x, tz - z)) }; }
  _place(level, x, z, yaw = 0, pitch = 0) {
    if (this.getLevel() !== level) this.teleport(level, x, z, yaw, pitch);
    else this.player.setPose(x, z, yaw, pitch);
  }
  // 管理人(演出体)
  _enemy(level, x, z, yaw, { light = true, clip = 'look_idle', aim = null } = {}) {
    const ai = this.ai, e = this.enemy;
    if (ai.level !== level) ai.setLevel(level);
    e.place(x, z, yaw);
    ai.concealed = false; ai.transit = false;
    e.setFlashlight(light);
    e.aimPoint = aim;
    e.speed = 0;
    e.play(clip, { fade: 0.2 });
  }
  _hideEnemy() { this.ai.concealed = true; this.enemy.speed = 0; this.enemy.aimPoint = null; }
  // 目標 (tx, tz) へ速さ v で歩く/走る(着いたら true)。クリップの再生速度を足の速さに合わせる
  _walk(dt, tx, tz, v, clip) {
    const e = this.enemy, p = e.pos;
    const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
    const cs = e.clipSpeed[clip] || 1;
    if (d < 0.02) { e.speed = 0; return true; }
    const step = Math.min(d, v * dt);
    e.place(p.x + dx / d * step, p.z + dz / d * step, Math.atan2(dx, dz));
    e.speed = v;
    if (e.current !== clip) e.play(clip, { fade: 0.25, timeScale: v / cs }); else e.setTimeScale(v / cs);
    return false;
  }
  _stand(clip = 'look_idle') { this.enemy.speed = 0; if (this.enemy.current !== clip) this.enemy.play(clip, { fade: 0.3 }); }
  _aim(level, x, y, z) { (this.enemy.aimPoint ||= new THREE.Vector3()).set(x, levelY(level) + y, z); }
  _fallSeg() { const m = this.bank && this.bank.manifest && this.bank.manifest.scenes.room_fall; return m && m.types ? m.types.vase || 'glass' : 'glass'; }

  // ------------------------------------------------------------ 場面の定義
  // 各場面は shots(順に映すカット)を持つ: { dur, level, enter(), tick(t, dt), exit() }。カットの頭で階が読めていなければ暗転のまま待つ
  _scenes() {
    if (this._S) return this._S;
    const L4 = 4, y4 = levelY(4);
    const S = {};
    // 0: 黒に「ノーライフ学生会館　午前3時」(P6b-F1: 裏で敷地 'G' へ移って 1F と外観の読み込みを済ませる。黒なので読み込みは待たない)
    const X1 = TUT.ext1;
    S['0'] = [{ dur: DUR('0'), level: 'G', black: true, at: [X1.x, X1.z], ready: () => true,
      enter: () => { this._place('G', X1.x, X1.z, -Math.PI * 0.75, 0.1); this._hideEnemy(); this.player.setFlashlight(false); this._kickExterior(); } }];
    // 1(P6b-F1 §3.12 #3): 外観。敷地の南東の門の内側・地面近くから北西の建物をゆっくり見上げる(案 A の構図)。管理人は出さない(場面 2 で初登場)
    const look1 = (t) => {
      const k = smooth(t / DUR('1')), dx = X1.tx - X1.x, dz = X1.tz - X1.z, L = Math.hypot(dx, dz);
      const x = X1.x + dx / L * X1.push * k, z = X1.z + dz / L * X1.push * k;
      return this._look(x, X1.eye, z, X1.tx, X1.y0 + (X1.y1 - X1.y0) * k, X1.tz);
    };
    S['1'] = [{ dur: DUR('1'), level: 'G', at: [X1.x, X1.z], ready: () => this.world.isReady(1) && (!this.exterior || this.exterior.ready || this._extFailed),
      enter: () => {
        this._place('G', X1.x, X1.z, 0, 0); this._hideEnemy(); this.player.setFlashlight(false);
        const E = this.look && this.look.ext;
        if (E) { this._fog1 = { d: E.fogDensity, c: [...E.fogColor] }; E.fogDensity = X1.fogD; E.fogColor = [...X1.fogC]; if (this.exterior && this.exterior.ready && this.exterior._applyLook) this.exterior._applyLook(); }
        this.camera.fov = X1.fov; this.camera.updateProjectionMatrix();
        this._cam(look1(0), 'G');
        this.log.push({ ev: 'exterior_view', ready: !!(this.exterior && this.exterior.ready) });
      },
      tick: (t) => this._cam(look1(t), 'G'),
      exit: () => { this._unfog1(); this.camera.fov = this.snap.fov; this.camera.updateProjectionMatrix(); } }];
    // 2: 4F の無人の廊下の奥。管理人は EV ホールの東の角の向こう(廊下から見えない所)に置き、懐中電灯の光だけが奥の壁を横切る。足音(壁越し)
    const AIM2 = [[0, 6.5, 0.05, 19.4], [2.2, 6.0, 0.95, 20.6], [3.8, 6.0, 1.15, 21.7], [5.2, 6.4, 0.7, 22.05], [6.4, 6.0, 1.0, 20.5], [8.5, 7.4, 0.2, 21.4]];
    S['2'] = [{ dur: DUR('2'), level: 4,
      enter: () => {
        this._place(4, 6.9, 12.1, Math.PI, 0.02);
        this._enemy(4, 10.4, 21.3, -Math.PI / 2, { light: true, clip: 'walk_oldman' });
        this.enemyAudio.setOccluded(true);
      },
      tick: (t, dt) => {
        this._cam({ x: 6.9, z: 12.1 + 0.7 * smooth(t / 8.5), eye: 1.62, yaw: Math.PI, pitch: 0.02 }, L4);
        if (t < 3.6) this._walk(dt, 9.3, 21.3, 0.42, 'walk_oldman');
        else if (t < 6.3) this._stand();
        else this._walk(dt, 11.5, 21.35, 0.45, 'walk_oldman');
        let i = 0; while (i < AIM2.length - 2 && t > AIM2[i + 1][0]) i++;
        const a = AIM2[i], b = AIM2[i + 1], k = smooth((t - a[0]) / (b[0] - a[0]));
        this._aim(4, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k);
      },
      exit: () => { this._hideEnemy(); this.enemyAudio.setOccluded(false); } }];
    // 3: 3F の EV ホール。カゴを 1F から呼び、階数表示が 1→2→3 と動いてチャイム。扉は開けない(中に誰がいるかは見せない)
    S['3'] = [{ dur: DUR('3'), level: 3,
      enter: () => {
        const c = this.elevator.car;
        Object.assign(c, { level: 1, open: 0, state: 'idle', hold: 0, to: null, t: 0, dur: 0, riding: false, pending: [] });
        this.elevator.npc = null;
        this._place(3, 6.75, 20.35, Math.PI, 0);
        this._called = false;
      },
      tick: (t) => {
        const y = levelY(3);
        const a = this._look(6.78 - 0.04 * smooth(t / 8), 1.56, 20.3 + 0.55 * smooth(t / 8), 6.6, 1.62, 22.1);
        this._cam(a, 3);
        if (!this._called && t >= 0.4) { this._called = true; this.elevator.call(3); this.log.push({ ev: 'ev_call', to: 3 }); }
        const c = this.elevator.car;
        if (c.state === 'arrived') c.lead = Math.max(c.lead, 0.5);   // チャイムの後も扉は閉じたまま(場面の終わりまで)
        void y;
      } }];
    // 3b(P6b): 3F の外階段の踊り場。上りの段 → 下りの段へゆっくり視線を移す(管理人は描かない)。「管理人は階段を使うことはできない」
    const K3b = [
      { t: 0.0, ...this._look(5.3, 1.6, 20.62, 3.4, 2.3, 23.6) },
      { t: 2.2, ...this._look(5.25, 1.6, 20.66, 3.5, 2.0, 23.4) },
      { t: 5.0, ...this._look(5.15, 1.6, 20.72, 5.2, -0.4, 23.3) },
      { t: 6.0, ...this._look(5.12, 1.6, 20.74, 5.2, -0.45, 23.3) },
    ];
    S['3b'] = [{ dur: DUR('3b'), level: TUT.stair3b.level,
      enter: () => { this._place(3, 5.3, 20.62, Math.PI, 0); this._hideEnemy(); this.player.setFlashlight(false); this._cam(keys(K3b, 0), 3); this.log.push({ ev: 'stair_landing' }); },
      tick: (t) => this._cam(keys(K3b, t), 3) }];
    // 4: 4F の廊下で見つかる → 410 へ駆け込み扉を閉める → 覗き穴から廊下(管理人が通り過ぎる)
    const K4 = [
      { t: 0.0, x: 6.9, z: 12.7, eye: 1.62, yaw: Math.PI, pitch: 0.0 },
      { t: 2.2, x: 6.9, z: 12.62, eye: 1.6, yaw: Math.PI, pitch: 0.0 },
      { t: 2.75, x: 6.95, z: 11.9, eye: 1.58, yaw: -0.3, pitch: -0.05 },
      { t: 3.45, x: 7.12, z: 8.7, eye: 1.56, yaw: -0.5, pitch: -0.05 },
      { t: 3.95, x: 8.1, z: 7.25, eye: 1.56, yaw: -Math.PI / 2, pitch: -0.05 },
      { t: 4.4, x: 9.05, z: 7.3, eye: 1.58, yaw: -Math.PI / 2 - 0.3, pitch: -0.02 },
      { t: 5.05, x: 8.85, z: 7.27, eye: 1.6, yaw: -Math.PI - 0.9, pitch: -0.02 },
      { t: 5.65, x: 8.62, z: 7.25, eye: 1.6, yaw: Math.PI / 2, pitch: 0.0 },
    ];
    S['4'] = [{ dur: DUR('4'), level: 4,
      enter: () => {
        const D = this.door410;
        D.target = D.openAngle; D.angle = D.openAngle; D.speedMul = 1;
        this._place(4, 6.9, 12.7, Math.PI, 0);
        this._enemy(4, 9.6, 21.2, -Math.PI / 2, { light: true, clip: 'walk_standard' });   // EV ホールの東の角の向こう(まだ見えない)
        this._phase4 = 'walk';
        this.enemyAudio.setOccluded(false);
      },
      tick: (t, dt) => {
        const D = this.door410, e = this.enemy;
        if (t < 5.9) this._cam(keys(K4, t), L4);
        // 管理人: 歩いてくる → 止まってこちらを照らす → 走ってくる
        // 角から半身だけ出て(光が先に来る)→ こちらを照らして止まる(見つかる)→ 走ってくる(カメラはもう逃げている)
        if (t < 1.45) this._walk(dt, 7.95, 21.2, 1.15, 'walk_standard');
        else if (t < 2.2) {
          this._stand('look_idle'); const p = e.pos; e.place(p.x, p.z, e.yaw + wrap(Math.PI - e.yaw) * Math.min(1, dt * 6));
          this._aim(4, this.camera.position.x, 1.5, this.camera.position.z);
          if (this._phase4 === 'walk') { this._phase4 = 'seen'; this.log.push({ ev: 'found', t: +t.toFixed(2) }); }
        }
        else if (t < 4.6) { this._aim(4, this.camera.position.x, 1.3, this.camera.position.z); this._walk(dt, 6.85, 14.4, 2.4, 'run_intent'); }
        else if (this._phase4 !== 'inside') { this._phase4 = 'inside'; this._hideEnemy(); }
        // 扉を閉める(駆け込んだ後)
        if (t >= 4.5 && D.target !== 0) { D.target = 0; D.speedMul = 2.6; this.log.push({ ev: 'door_close', t: +t.toFixed(2) }); }
        // 覗き穴: 管理人が北から南へ戸口の前を通り過ぎる
        if (t >= 5.9 && !this.peephole.active) {
          this.peephole.forced = true; this.peephole.set(true);
          this._enemy(4, 6.72, 5.95, 0, { light: true, clip: 'walk_standard' });
          this.enemyAudio.setOccluded(true);
          this.log.push({ ev: 'peephole_on', t: +t.toFixed(2) });
        }
        if (this.peephole.active && t >= 6.6) {
          if (t < 8.0) this._walk(dt, 6.72, 6.9, 0.55, 'walk_oldman');
          else if (t < 9.2) { this._stand('look_idle'); const p = e.pos; e.place(p.x, p.z, e.yaw + wrap(Math.PI / 2 - e.yaw) * Math.min(1, dt * 4)); }   // 扉の前で止まって、扉の方を向く
          else this._walk(dt, 6.75, 13.5, 0.95, 'walk_standard');
          if (!this._passLogged && e.pos.z > 7.6) { this._passLogged = true; this.log.push({ ev: 'passed_lens', t: +t.toFixed(2) }); }
        }
      },
      exit: () => {
        if (this.peephole.active) { this.peephole.forced = false; this.peephole.set(false); }
        this._hideEnemy(); this.enemyAudio.setOccluded(false); this._passLogged = false;
        const D = this.door410; D.target = 0; D.angle = 0; D.speedMul = 1; if (D.collision) D.collision.disabled = false;
      } }];
    // 5: 410 のクローゼットに隠れる → 折戸が閉まり、隙間から薄暗い部屋
    S['5'] = [{ dur: DUR('5'), level: 4,
      enter: () => { this._place(4, 11.34, 7.0, Math.PI, -0.1); this._cam({ x: 11.34, z: 7.0, eye: 1.6, yaw: Math.PI, pitch: -0.1 }, L4); this._hid = false; this._opened = false; this.ambientFloor.intensity = TUT.ambient5; },
      tick: (t) => {
        const R = this.rooms;
        if (t >= 0.15 && !this._opened) { this._opened = true; R.openCloset('410', 0.9); }
        if (t >= 1.2 && !this._hid) { this._hid = true; R.hide('410'); this.log.push({ ev: 'hide', t: +t.toFixed(2) }); }
        const cam = this.camera;
        if (!this._hid) this._cam({ x: 11.34, z: 7.0 + 0.05 * t, eye: 1.6, yaw: Math.PI, pitch: -0.1 }, L4);
        else {
          const h = R.hidden, k = h && h.phase === 'in' ? smooth(h.t / 0.7) : 1;
          const yaw = Math.PI + wrap(-0.3 - Math.PI) * k + (k >= 1 ? 0.18 * Math.sin((t - 2.0) * 0.55) : 0);   // 隙間の先 = ベッドと窓の方
          const c = R.closets.get('410');
          if (h && h.phase === 'hidden' && c.target <= TUT.gap5 && c.open01 < TUT.gap5) { c.target = TUT.gap5; c.open01 = Math.min(TUT.gap5, Math.max(c.open01, 0.09)); R._applyCloset(c); }
          cam.rotation.set(-0.06 * k - 0.1 * (1 - k), yaw, 0, 'YXZ');
          cam.updateMatrixWorld();
        }
      },
      exit: () => { this.rooms.forceUnhide(); const c = this.rooms.closets.get('410'); c.target = 0; c.open01 = 0; this.rooms._applyCloset(c); this.ambientFloor.intensity = this.snap.ambient; } }];
    // 6: 空室(409)の扉の下の闇が揺らぐ → 6F の部屋(611)の奥のロッカーが内側から軋む(音は「なし」= 動きだけ)→ 自分の懐中電灯が 410 の扉の隙間に光を漏らす(室内から扉)
    const Y = (level) => levelY(level);
    S['6'] = [
      { dur: 4.6, level: 4, fin: TUT.edgeFade, fout: TUT.cutFade,
        enter: () => {
          this._place(4, 6.35, 10.15, -Math.PI / 2, -0.25);
          this.lurkId = TUT.lurkDoor; this.doorFx.lurkId = TUT.lurkDoor; this.doorFx.lurkAmt = 1;
          const st = this.doorFx.strips.get(4); this._leak0 = st.u.uLeak.value.clone(); st.u.uLeak.value.multiplyScalar(TUT.stripBoost);
          this.player.setFlashlight(false);
        },
        tick: (t) => this._cam(this._look(6.32 + 0.22 * smooth(t / 4.6), 0.42, 10.15, 7.8, 0.03, 10.15), L4),
        exit: () => { const st = this.doorFx.strips.get(4); if (st && this._leak0) st.u.uLeak.value.copy(this._leak0); this.lurkId = null; this.doorFx.lurkId = null; this.doorFx.lurkAmt = 0; } },
      { dur: 4.4, level: 6, fin: TUT.cutFade, fout: TUT.cutFade,
        enter: () => { this._place(6, 18.9, 17.2, 0.32, -0.2); this.player.setFlashlight(true); this.player.flashlight.intensity = this.snap.flashI * TUT.flashScale; },
        tick: (t) => {
          const L = this.rooms.bursts.get(TUT.lockerRoom);
          this._cam(this._look(18.9 - 0.15 * smooth(t / 4.4), 1.5, 17.2 - 0.4 * smooth(t / 4.4), 18.045, 1.0, 14.6), 6);
          // 内側から押されて扉がわずかに浮いては戻る(3 回。だんだん強く)
          const pulse = (c, w, a) => a * Math.max(0, 1 - Math.abs(t - c) / w);
          const j = TUT.jiggle * Math.max(pulse(1.2, 0.22, 0.45), pulse(2.1, 0.2, 0.7), pulse(3.1, 0.3, 1.0)) * (0.85 + 0.15 * Math.sin(t * 47));
          if (L) this.rooms.setBurst(TUT.lockerRoom, 0, j);
          if (j > 0.02 && !this._jigLogged) { this._jigLogged = true; this.log.push({ ev: 'locker_jiggle', t: +t.toFixed(2) }); }
        },
        exit: () => { this.rooms.setBurst(TUT.lockerRoom, 0, 0); this._jigLogged = false; } },
      { dur: 4.5, level: 4, fin: TUT.cutFade, fout: TUT.edgeFade,
        enter: () => { this._place(4, 9.3, 7.35, Math.PI / 2, -0.2); this.player.setFlashlight(true); this.player.flashlight.intensity = this.snap.flashI * TUT.flashScale; this._buildLeak(); },
        tick: (t) => {
          this._cam({ x: 9.3 - 0.3 * smooth(t / 4.5), z: 7.33, eye: 1.42, yaw: Math.PI / 2 + 0.06, pitch: -0.24 }, L4);
          this.leakMat.opacity = 0.9 * smooth((t - 0.3) / 1.2) * (0.92 + 0.08 * Math.sin(t * 9.0));
          this.leakEdgeMat.opacity = this.leakMat.opacity * 0.3;
        },
        exit: () => { this.leakMat.opacity = 0; if (this.leakEdgeMat) this.leakEdgeMat.opacity = 0; } },
    ];
    // 6b(P6b): 4F の廊下の北端から南を見る。手前の 410 の扉は開いたまま、奥の 409 の扉は閉まっている(扉はこの場面だけ開け、出る時に戻す)。
    //  「施錠された部屋と空いてる部屋があるから一度訪れた部屋は開けておくとわかりやすい」
    const K6b = [
      { t: 0.0, ...this._look(6.5, 1.6, 5.98, 7.55, 1.15, 9.6) },
      { t: 7.0, ...this._look(6.45, 1.6, 6.55, 7.6, 1.1, 10.1) },
    ];
    S['6b'] = [{ dur: DUR('6b'), level: 4,
      enter: () => {
        const D = this.door410;
        D.target = D.openAngle; D.angle = D.openAngle; D.speedMul = 1; if (D.collision) D.collision.disabled = true;
        this._place(4, 6.5, 5.98, Math.PI, 0); this._hideEnemy(); this.player.setFlashlight(false); this._cam(keys(K6b, 0), L4);
        this.log.push({ ev: 'door_open_6b', door: TUT.open6b });
      },
      tick: (t) => this._cam(keys(K6b, t), L4),
      exit: () => { const D = this.door410; D.target = 0; D.angle = 0; D.speedMul = 1; if (D.collision) D.collision.disabled = false; } }];
    // 7: 410 の机の花瓶が落ちて割れる(room_fall)。遠くで EV のチャイム、近づく足音(廊下を歩く管理人。扉越し)
    S['7'] = [{ dur: DUR('7'), level: 4,
      enter: () => {
        this.player.setFlashlight(true); this.player.flashlight.intensity = this.snap.flashI * TUT.flashScale;
        this.vase.position.copy(this.vaseHome); this.vase.rotation.set(0, 0.4, 0); this.vase.visible = true; this.props.add(this.vase);
        this.shards.visible = false; this._vase = { state: 'rest', vy: 0 }; this._chimed = false; this._stepsOn = false;
        this._cam(this._look(11.5, 1.45, 7.22, 12.74, 0.84, 8.17), L4);
      },
      tick: (t, dt) => {
        const V = this._vase, v = this.vase, y0 = y4;
        const look = this._look(11.5, 1.45, 7.22, 12.74, 0.84, 8.17);
        const door = { x: 11.25, z: 7.25, eye: 1.55, yaw: Math.PI / 2, pitch: -0.02 };
        this._cam(t < 3.8 ? look : keys([{ t: 3.8, ...look }, { t: 6.4, ...door }], t), L4);
        // 花瓶: 傾く → 机の縁から落ちる → 床で割れる
        if (V.state === 'rest' && t >= 1.1) { V.state = 'tip'; V.t = 0; }
        if (V.state === 'tip') { V.t += dt; v.rotation.z = -0.9 * smooth(V.t / 0.35); v.position.z = this.vaseHome.z - 0.05 * smooth(V.t / 0.35); if (V.t >= 0.35) { V.state = 'fall'; V.vy = 0; } }
        if (V.state === 'fall') {
          V.vy -= 9.8 * dt; v.position.y += V.vy * dt; v.position.z -= 0.55 * dt; v.rotation.z -= 6 * dt;
          if (v.position.y <= y0 + 0.01) {
            V.state = 'broken'; v.visible = false;
            const p = v.position;
            this.shards.visible = true;
            for (const m of this.shards.children) m.position.set(p.x + m.userData.off[0], y0 + 0.003, p.z + m.userData.off[1] * 0.6);
            this.props.add(this.shards);
            if (this.bank) this.bank.play('room_fall', { pos: new THREE.Vector3(p.x, y0 + 0.1, p.z), seg: this._fallSeg(), vol: 1, ref: 1.2, rolloff: 1.2 });
            this.log.push({ ev: 'vase_break', t: +t.toFixed(2) });
          }
        }
        // 遠くで EV のチャイム(4F の EV ホール = 410 から約 14m)
        if (!this._chimed && t >= 3.3) {
          this._chimed = true;
          if (this.bank) this.bank.play('ev_chime', { pos: new THREE.Vector3(6.9, y4 + 1.5, 21.5), ref: 2, rolloff: 1.2 });
          this.log.push({ ev: 'chime', t: +t.toFixed(2) });
        }
        // 近づく足音: 管理人が EV ホールから 410 の方へ廊下を歩いてくる(部屋の中からは見えない。扉越しにこもる)
        if (!this._stepsOn && t >= 3.9) {
          this._stepsOn = true; this._enemy(4, 6.85, 19.4, Math.PI, { light: true, clip: 'walk_standard' }); this.enemyAudio.setOccluded(true);
          this.player.setFlashlight(false);   // 足音が近づく → 息を殺して灯りを消す
        }
        if (this._stepsOn) this._walk(dt, 6.85, 9.0, 1.15, 'walk_standard');
      },
      exit: () => { this._hideEnemy(); this.enemyAudio.setOccluded(false); this.vase.removeFromParent(); this.shards.removeFromParent(); } }];
    // 7b(P6b-A2 §3.9 #17): 4F の廊下を走る(走りの高さ・速さ・足音)→ 足を止めると、遠くの EV の階数表示が 2→3→4 と動いてチャイム。
    //  「走ると足音が響く！管理人に聞こえる！」。廊下の自分の足音は本編では「なし」なので、居室の足音(pl_step_room)を走りの音量で鳴らす
    const R7 = TUT.run7b;
    S['7b'] = [{ dur: DUR('7b'), level: 4, fout: 0,   // P6b-F1: 終わりはフェードしない(7c へ 0.1 秒の黒のカット)
      enter: () => {
        const c = this.elevator.car;
        Object.assign(c, { level: R7.from, open: 0, state: 'idle', hold: 0, to: null, t: 0, dur: 0, riding: false, pending: [] });
        this.elevator.npc = null;
        this._place(4, R7.x, R7.z0, Math.PI, 0); this._hideEnemy(); this.player.setFlashlight(true); this.player.flashlight.intensity = this.snap.flashI * TUT.flashScale;
        this._cam({ x: R7.x, z: R7.z0, eye: R7.eye, yaw: Math.PI, pitch: -0.05 }, L4);
        this._called7b = false; this._sped7b = false; this._nextStep7b = R7.t0;
      },
      tick: (t) => {
        const k = Math.min(1, Math.max(0, (t - R7.t0) / R7.run));
        const z = R7.z0 + (R7.z1 - R7.z0) * (k < 0.85 ? k / 0.85 * 0.92 : 0.92 + 0.08 * smooth((k - 0.85) / 0.15));   // 走って、終わりで止まる
        const running = t >= R7.t0 && k < 0.95;
        const bob = running ? Math.abs(Math.sin((t - R7.t0) * Math.PI / R7.step)) * R7.bob : 0;
        const stopT = R7.t0 + R7.run;
        // 走っている間は前、止まってから EV ホールの階数表示(扉の上)を見上げる
        const ahead = { x: R7.x, z, eye: R7.eye + bob, yaw: Math.PI, pitch: -0.05 };
        const disp = this._look(R7.x, 1.6, z, 6.9, 2.35, 22.1);
        this._cam(t < stopT ? ahead : keys([{ t: stopT, ...ahead, eye: R7.eye }, { t: stopT + 1.0, ...disp }], t), L4);
        if (running && t >= this._nextStep7b) {
          this._nextStep7b += R7.step;
          if (this.bank) this.bank.play('pl_step_room', { vol: 1.0 });
          this.log.push({ ev: 'run_step', t: +t.toFixed(2), z: +z.toFixed(2) });
        }
        const c = this.elevator.car;
        if (!this._called7b && t >= R7.callAt) { this._called7b = true; this.elevator.call(R7.to); this.log.push({ ev: 'ev_call_7b', from: R7.from, to: R7.to }); }
        if (!this._sped7b && c.state === 'moving') { this._sped7b = true; c.dur = R7.travel; }
        if (c.state === 'arrived') c.lead = Math.max(c.lead, 0.5);   // チャイムの後も扉は閉じたまま
      },
      exit: () => { this.player.flashlight.intensity = this.snap.flashI; } }];
    // 7c(P6b-F1 §3.12 #2): 覗き穴の視点。レンズの目の前に管理人の顔(grin → attack の見開き)、打撃音(採用 enemy_hit)と同時にレンズに血の飛沫と筋。文言なし。
    //  入りは 0.1 秒の黒のカット(7b の終わりはフェードしない)、終わりは即暗転 → 8。顔の作りは案 B(docs/p6b-e1/NOTES.md)
    const P7 = TUT.peep7c;
    S['7c'] = [{ dur: DUR('7c'), level: 4, blackAt: (t) => (t < P7.cut ? 1 : 0),
      enter: () => {
        const D = this.door410; D.target = 0; D.angle = 0; D.speedMul = 1; if (D.collision) D.collision.disabled = false;
        this.player.setFlashlight(false); this.player.flashlight.intensity = this.snap.flashI;
        this._place(4, P7.cam[0], P7.cam[1], Math.PI / 2, 0);
        this.peephole.forced = true; this.peephole.set(true);
        this._enemy(4, P7.enemy[0], P7.enemy[1], Math.PI / 2, { light: false, clip: P7.clip });
        const a = this.enemy.actions[P7.clip]; if (a) { a.time = P7.time; a.timeScale = 0; }
        this.enemy.underLight = P7.under;
        this.enemy.setFace('grin', P7.grin[0], true); this.enemy.setFace('attack', 0, true);
        this._hit7c = false;
        if (this.movie) this.movie.blood.clear();
        this.log.push({ ev: 'peep_7c' });
      },
      tick: (t, dt) => {
        const e = this.enemy;
        e.place(P7.enemy[0], P7.enemy[1], Math.PI / 2);   // 覗き穴の前から動かない
        e.lean = P7.lean * smooth(t / 1.6);                // 顔をレンズへ寄せる
        const ka = smooth((t - P7.attackAt) / P7.attackIn);
        e.setFace('grin', P7.grin[0] + (P7.grin[1] - P7.grin[0]) * smooth(t / P7.attackAt) * (1 - 0.4 * ka), true);
        e.setFace('attack', P7.attack * ka, true);
        if (!this._hit7c && t >= P7.hitAt) { this._hit7c = true; this._blood7c(); this.log.push({ ev: 'hit_7c', t: +t.toFixed(2) }); }
        if (this.movie && this.movie.blood.pass.enabled) this.movie.blood.update(dt);
      },
      exit: () => {
        if (this.peephole.active) { this.peephole.forced = false; this.peephole.set(false); }
        this.peephole.forced = false;
        const e = this.enemy; e.lean = 0; e.underLight = 0; e.setFace('grin', 0, true); e.setFace('attack', 0, true);
        const a = e.actions[P7.clip]; if (a) a.timeScale = 1;
        this._hideEnemy();
        if (this.movie) this.movie.blood.clear();
      } }];
    // 8: 黒 → (暗転の中で世界を開始時の状態へ戻す)→ 410 のベッド脇でフェードイン → 操作一覧
    S['8'] = [{ dur: DUR('8'), level: 4, black: true,
      enter: () => { this._restore(); this.seen = true; },
      tick: (t) => {
        if (t >= 1.0 && !this._shown) { this._shown = true; this.hud.root.style.visibility = ''; this.hud.showControls(this.controlsSec); this.log.push({ ev: 'fade_in' }); }
      },
      exit: () => { this._shown = false; } }];
    const A = TUT.ids.map((id) => S[id]);
    for (let i = 0; i < A.length; i++) {
      if (!A[i]) throw new Error(`tutorial: 場面 ${TUT.ids[i]} が無い`);
      const tot = A[i].reduce((s, x) => s + x.dur, 0);
      if (Math.abs(tot - TUT.dur[i]) > 1e-6) throw new Error(`tutorial: 場面 ${TUT.ids[i]} の長さ ${tot} ≠ ${TUT.dur[i]}`);
    }
    return (this._S = A);
  }

  // P6b-F1: 外観を読み始める(場面 0 の黒の間。読めなければ場面 1 は待たずに進む)
  _kickExterior() {
    if (!this.loadExterior || (this.exterior && this.exterior.ready)) return;
    Promise.resolve(this.loadExterior()).then((x) => { if (!x) this._extFailed = true; }).catch(() => { this._extFailed = true; });
  }
  _unfog1() {
    const E = this.look && this.look.ext;
    if (!E || !this._fog1) return;
    E.fogDensity = this._fog1.d; E.fogColor = this._fog1.c; this._fog1 = null;
    if (this.exterior && this.exterior.ready && this.exterior._applyLook) this.exterior._applyLook();
  }
  // P6b-F1 7c: レンズの血(案 B と同じ作り: 額の上で潰れた滴＋衛星の微粒 → 太さ・速さの違う筋。襲撃ムービーの画面の血 BloodOverlay を借りる)
  _blood7c() {
    if (this.enemyAudio) this.enemyAudio.play('hit', this.camera.position.clone(), 1.0);
    const Bl = this.movie && this.movie.blood;
    if (!Bl) return;
    Bl.clear(); Bl.pass.enabled = true;
    let a = 21; const R = () => { a = (a * 16807) % 2147483647; return a / 2147483647; };
    for (const [x, y, len, w] of [[612, 205, 300, 2.8], [640, 180, 380, 4.0], [668, 230, 210, 2.2], [696, 196, 330, 3.2]]) {
      Bl._drop(x, y, w * 2.4, Math.PI / 2 + (R() - 0.5) * 0.6, 0);
      for (let k = 0; k < 6; k++) Bl._soft(x + (R() - 0.5) * w * 9, y + (R() - 0.5) * w * 6, 0.8 + R() * w * 0.5, 0.8 + R() * w * 0.4, R() * 3, 0.7, Bl._rgb());
      Bl.drips.push({ x, y: y + w, y0: y + w, w: w * (0.8 + R() * 0.3), v: 220 + R() * 160, len, t: 0, a: 0.85, rgb: Bl._rgb(), wob: R() * 6 });
    }
    // 飛沫: 打撃の点(顔の少し上)のまわりに細かい粒
    for (let i = 0; i < 160; i++) { const g = Math.sqrt(-2 * Math.log(R() || 1e-6)), th = 6.283 * R(); const rr = 0.4 + R() ** 3 * 2.2; Bl._soft(650 + g * Math.cos(th) * 70, 230 + g * Math.sin(th) * 60, rr, rr * 0.8, R() * 3, 0.4 + R() * 0.4, Bl._rgb()); }
    for (let i = 0; i < 26; i++) { const g = Math.sqrt(-2 * Math.log(R() || 1e-6)), th = 6.283 * R(); Bl._drop(650 + g * Math.cos(th) * 90, 230 + g * Math.sin(th) * 70, 0.8 + 6 * R() ** 4, th, R() < 0.4 ? 0.5 + R() : 0); }
    Bl.tex.needsUpdate = true;
  }

  // 演出で動かした物を開始時の状態へ(場面 8 の暗転の中・飛ばした時)
  _restore() {
    const s = this.snap, E = this.elevator, P = this.player, D = this.door410;
    if (this.peephole.active) { this.peephole.forced = false; this.peephole.set(false); }
    this.peephole.forced = false;
    this.rooms.forceUnhide();
    const c = this.rooms.closets.get('410'); if (c) { c.target = 0; c.open01 = 0; this.rooms._applyCloset(c); }
    this.rooms.setBurst(TUT.lockerRoom, 0, 0);
    if (D && s.door410) { Object.assign(D, s.door410); if (D.collision) D.collision.disabled = D.angle > 0.25; }
    Object.assign(E.car, { ...s.car, pending: [...s.car.pending] });
    E.npc = s.npc; E.npcStop = s.npcStop; E._hum(false);
    const st = this.doorFx.strips.get(4); if (st && this._leak0) st.u.uLeak.value.copy(this._leak0);
    this.lurkId = null; this.doorFx.lurkId = null; this.doorFx.lurkAmt = 0;
    this.leakMat.opacity = 0; if (this.leakEdgeMat) this.leakEdgeMat.opacity = 0;
    this.props.removeFromParent();
    this.ambientFloor.intensity = s.ambient;
    this._unfog1();   // P6b-F1: 場面 1 の外の霧
    if (this.movie) this.movie.blood.clear();   // P6b-F1: 7c のレンズの血
    { const e = this.enemy; e.lean = 0; e.underLight = 0; e.setFace('grin', 0, true); e.setFace('attack', 0, true); }
    this._exposure(s.exposure);   // P6b-E1: 本編の露出へ(暗転の中。Esc・ロック解除で飛ばした時もここを通る)
    this.camera.fov = s.fov; this.camera.updateProjectionMatrix();
    this.enemy.aimPoint = null; this.enemy.speed = 0;
    this.enemyAudio.setOccluded(false);
    const B = TUT.bedside;
    this.teleport(B.level, B.x, B.z, B.yaw, B.pitch);
    P.setFlashlight(s.flashlight); P.flashlight.intensity = s.flashI;
    P.frozen = true;
    this.resetAI(s.aiDormant);
    this.log.push({ ev: 'restore' });
  }

  // P6b-E1: レンダラの露出の読み書き(ctx に renderer が無ければ window.__N2 のものを使う。main.js は触らない工程のため)
  _exposure(v) {
    const r = this.renderer || (window.__N2 && window.__N2.renderer);
    if (!r) return undefined;
    if (v !== undefined && Number.isFinite(v)) r.toneMappingExposure = v;
    return r.toneMappingExposure;
  }

  _enterScene(i) { this._nextShot(); }
  _exitScene(i) {
    const S = this._scenes()[i];
    const sh = S && S[this._shot];
    if (sh && sh.exit && this._shotEntered) sh.exit();
    this._shotEntered = false;
  }
  _nextShot() {
    const S = this._scenes()[this.index];
    if (this._shot >= 0 && this._shotEntered) { const prev = S[this._shot]; if (prev.exit) prev.exit(); }
    this._shot++;
    this._shotT = 0; this._shotEntered = false;
    const sh = S[this._shot];
    if (!sh) return;
    // 階を移る(暗転の中)。読み込み待ちは場面の時計を止める
    if (sh.level !== undefined && this.getLevel() !== sh.level) this.teleport(sh.level, sh.at ? sh.at[0] : this.player.pos.x, sh.at ? sh.at[1] : this.player.pos.z, 0, 0);
    this.waiting = !this._ready(sh);
    if (!this.waiting) this._enterShot(sh);
  }
  _ready(sh) { return sh.ready ? sh.ready() : this.world.isReady(glbLevel(sh.level)); }   // P6b-F1: 敷地 'G' = 1F の GLB(＋外観)
  _enterShot(sh) {
    this._shotEntered = true;
    if (sh.enter) sh.enter();
    this.log.push({ ev: 'shot', index: this.index, shot: this._shot, level: sh.level, at: +this.total.toFixed(3) });
  }

  // ------------------------------------------------------------ 毎フレーム
  update(dt) {
    if (!this.active) return;
    const S = this._scenes()[this.index];
    let sh = S[this._shot];
    if (this.waiting) {
      if (this._ready(sh)) { this.waiting = false; this._enterShot(sh); }
      else { this.black.style.opacity = '1'; this.log.push({ ev: 'wait', index: this.index }); if (this.log.length > 600) this.log.splice(0, 100); return; }
    }
    this.t += dt; this._shotT += dt; this.total += dt;
    if (sh.tick) sh.tick(this._shotT, dt);
    // 暗転(場面の始めと終わり・カットの境目)
    const fin = sh.fin ?? (this._shot === 0 ? TUT.edgeFade : TUT.cutFade), fout = sh.fout ?? (this._shot === S.length - 1 ? TUT.edgeFade : TUT.cutFade);
    let b;
    if (this.index === LAST) b = this._shotT < 1.0 ? 1 : 1 - smooth((this._shotT - 1.0) / 2.0);
    else if (sh.black) b = 1;
    else if (sh.blackAt) b = sh.blackAt(this._shotT);   // P6b-F1 7c: 黒のカット(フェードなし)
    else b = Math.max(fin > 0 ? 1 - smooth(this._shotT / fin) : 0, fout > 0 ? smooth((this._shotT - (sh.dur - fout)) / fout) : 0);
    this.black.style.opacity = b.toFixed(3);
    // 文字: 0 は中央、1〜7 は画面下(場面の頭 0.5 秒から出て、終わりの 0.6 秒で消える)
    const dur = TUT.dur[this.index];
    const a0 = this.index === 0 ? 1.6 : 0.5;   // 0 はタイトルが消えて(1.4 秒)から
    const a = this.cap ? smooth((this.t - a0) / 0.8) * (1 - smooth((this.t - (dur - 0.7)) / 0.6)) : 0;
    if (this.index === 0) { this.centerEl.style.opacity = a.toFixed(3); this.capEl.style.opacity = '0'; }
    else { this.capEl.style.opacity = a.toFixed(3); this.centerEl.style.opacity = '0'; }
    if (this._shotT >= sh.dur - 1e-9) {
      if (this._shot < S.length - 1) { this._nextShot(); return; }
      if (this.index < LAST) this._go(this.index + 1);
      else { this._exitScene(LAST); this._finish(); }
    }
  }

  state() {
    return { active: this.active, index: this.index, id: TUT.ids[this.index] ?? null, shot: this._shot, t: +this.t.toFixed(3), total: +this.total.toFixed(3), waiting: !!this.waiting, text: this.cap,
      caption: this.index === 0 ? this.centerEl.textContent : this.capEl.textContent, black: +this.black.style.opacity || 0, seen: this.seen };
  }
}
