// test_tutorial.js — P6a タイトルと場面を映すチュートリアル(DESIGN §3.8「チュートリアル」の表 0〜8・§7 P6a)の決定的テスト(ブラウザ内)。
// http://127.0.0.1:8001/index.html?test=tutorial で自動実行。rAF に依存せず window.__N2.pump(dt, n) で進める(階の読み込み待ちの間だけ実時間を待つ)。結果: window.__N2.testResult
//  0) タイトル: 「NOLIFE」(「2」は付けない。2026-11-02 ユーザー指示)と「クリックで開始」。クリックでチュートリアルが始まり、入力が止まり HUD が隠れる
//  1) 通し: 場面 0,1,2,3,3b,4,5,6,6b,7,7b,8 の順序・各場面の所要時間(表の値 ±0.05 秒)と合計 60〜100 秒(P6b-A2)・文言が表のとおり(句読点・「、、、」も)・場面ごとの仕込み
//     (P6b 3b 3F の外階段の踊り場から段を見る・管理人は映らない / 6b 手前の 410 の扉が開いたまま・奥の 409 は閉まっている・場面 7 では 410 が閉まっている)
//     (2 光だけ = 管理人の体は壁の向こう・懐中電灯は点灯 / 3 階数表示 1→2→3 とチャイム・扉は開かない / 4 見つかる→扉を閉める→覗き穴→通り過ぎる /
//      5 クローゼットの中 / 6 扉の下の揺らぎ・ロッカーの軋み・光漏れ / 7 花瓶が割れる音・遠いチャイム・足音)・演出中は AI の時計が止まっている
//  2) 終わり: 410 のベッド脇・操作が戻る・操作一覧・管理人/扉/EV/帯/クローゼット/ロッカー/覗き穴/懐中電灯/環境光が開始前と同じ・目標「1階の食堂へ」・既読になる
//  3) 初回(未読)は Esc で飛ばせない
//  4) 既読なら Esc で飛ばせる(場面 4 の途中 = 扉・覗き穴・EV が動いた後)→ 場面 8 → 終わりの状態は 2) と同じ。ポインタロックが外れた時も飛ばせる
//  5) P6b-E1(§3.11 #3): チュートリアルの露出。場面 0 は本編の値・場面 1〜7b は 3.2・場面 8 の暗転で本編(4.5)へ戻る。
//     場面 1(410)の画面中央 50%(test_enemy の centerLuma・P2c の暗さの判定と同じ範囲。960×540 で描く)の平均輝度が 4.5 の時の 0.6〜0.75 倍・
//     中間調(sRGB 表示値の Rec.709 輝度 40〜120/255)が 15% 以上(場面 1 の 3 か所の平均。画面全体の値も記録する)。Esc・ロック解除で飛ばしても 4.5 に戻る
//     (2〜4 の終わりの状態の比較にも露出を入れている)
//  P6b-F1(§3.12): 0) タイトルの背景(4F の廊下・管理人・常夜灯のちらつき 3〜8 秒おき・全消灯 20〜40 秒に 1 回 0.4〜0.8 秒・血の滴 8〜10 本が 20〜30 秒で伸び切る・
//     ゲームの時間は止まる)→ クリックで 1.4 秒の黒 → 片付け(開始前と同じ)→ チュートリアル。1) 場面 1 = 外観(敷地 'G'・霧 0.06・見上げる・管理人なし)、
//     7c = 覗き穴の向こうの顔(入りは黒のカット・grin→attack・打撃音 1 回・レンズの血・文言なし)。5) 露出は 1 = 3.7・7c = 6.0・他 3.2

const DT = 1 / 60;
const EXPECT = [
  'ノーライフ学生会館　午前3時',
  'いつもと様子が違う。不気味だ。',
  '管理人があなたを探している！',
  '深夜の館内を歩き回っている。ライトの光と移動する音に耳をすませろ！',
  '管理人は階段を使うことはできない',
  '見つかったら部屋の中に逃げろ！ドアの隙間から廊下の様子を確認しろ！',
  'クローゼットの中に身を隠すこともできる',
  '管理人は至る所に潜んでいる、、、部屋の中、ロッカーの中にもいるかも？自分の懐中電灯の光には気をつけろ！',
  '施錠された部屋と空いてる部屋があるから一度訪れた部屋は開けておくとわかりやすい',
  '決して音をたてるな！',
  '走ると足音が響く！管理人に聞こえる！',   // 7b(P6b-A2 §3.9 #17)
  '',   // 7c(P6b-F1 §3.12 #2: 文言なし)
  '',
];
// P6b(§3.9 #11): 並びは 0,1,2,3,3b,4,5,6,6b,7,8。P6b-A2(§3.9 #17): 7 の後に 7b(添字 0〜11)。合計 94.0 秒(≤100)
const IDS = ['0', '1', '2', '3', '3b', '4', '5', '6', '6b', '7', '7b', '7c', '8'];   // P6b-F1: 7c(合計 97.0 秒)
const PLAN = [5.0, 8.0, 8.5, 8.0, 6.0, 13.0, 7.5, 13.5, 7.0, 8.0, 6.5, 3.0, 3.0];
const IX = (id) => IDS.indexOf(id);
const LAST = IDS.length - 1;

export async function run(N) {
  const out = { ok: true, cases: {} };
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:fixed;left:8px;top:8px;z-index:40;color:#9fe39f;background:rgba(0,0,0,.78);font:11px/1.35 monospace;padding:8px;max-width:46vw;max-height:94vh;overflow:auto;white-space:pre-wrap;';
  document.body.appendChild(pre);
  const show = () => { pre.textContent = JSON.stringify(out, null, 1); };
  const T = async (name, fn) => {
    try { const r = await fn(); out.cases[name] = r; if (!r.pass) out.ok = false; }
    catch (e) { out.cases[name] = { pass: false, error: String(e && e.stack || e) }; out.ok = false; }
    show();
  };
  N.paused = true;
  const tu = N.tutorial, ti = N.title;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // 進める: 読み込み待ちの間は実時間を待つ。each(state) を 6 フレームごとに呼ぶ
  const advance = async (sec, each = null, stop = null) => {
    let t = 0, guard = 0;
    while (t < sec - 1e-9) {
      if (stop && stop()) break;
      if (tu.active && tu.waiting) { N.pump(DT, 1, false); await sleep(40); if (++guard > 1500) throw new Error('読み込み待ちが終わらない'); continue; }
      const k = each && each.fineAt && each.fineAt(tu.state()) ? 1 : 6;   // P6b-F1: 7c の 0.1 秒の黒のカットは 1 フレームずつ見る
      N.pump(DT, k, false); t += k * DT;
      if (each) each(tu.state());
      if ((t * 60 | 0) % 240 < 6) await sleep(0);
    }
  };
  const snapshot = () => {
    const ai = N.ai.stats(), car = N.elevator.state(), d = N.world.doorById.get('410');
    return { ai: { state: ai.state, level: ai.level, pos: ai.pos, concealed: ai.concealed, dormant: N.ai.dormant, transit: ai.transit },
      car: { level: car.level, state: car.state, open: car.open, pending: car.pending.join(',') }, npc: N.elevator.npc,
      door410: { angle: +d.angle.toFixed(3), target: d.target, blocked: !(d.collision && d.collision.disabled) },
      lurk: N.doorFx.lurkId, hidden: N.rooms.hidden, closet410: N.rooms.closets.get('410').open01, burst611: [N.rooms.bursts.get('611').open01, N.rooms.bursts.get('611').jiggle],
      peep: N.peepholeObj.active, fov: N.camera.fov, flashlight: N.player.flashlightOn, flashI: N.player.flashlight.intensity, ambient: +N.ambientFloor.intensity.toFixed(3),
      exposure: +N.renderer.toneMappingExposure.toFixed(3) };   // P6b-E1
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const endState = async (before) => {
    const p = N.player.pos, yaw = N.player.object.rotation.y;
    const after = snapshot();
    const r = {
      active: tu.active, level: N.level, pos: [+p.x.toFixed(2), +p.z.toFixed(2)], yaw: +yaw.toFixed(3), frozen: N.player.frozen, controlsEnabled: N.player.controls.enabled,
      hudVisible: N.hud.root.style.visibility !== 'hidden', controlsShown: N.hud.state().controls, seen: tu.seen,
      worldSame: same(before, after), before, after,
    };
    await advance(1.0);
    r.objective = N.hud.state().objective; r.stage = N.story.stage; r.sub = N.story.sub;
    r.aiAfter1s = N.ai.stats().state;
    r.pass = !r.active && r.level === 4 && Math.hypot(p.x - 12.35, p.z - 7.25) < 0.05 && Math.abs(yaw - Math.PI / 2) < 0.02 && !r.frozen && r.controlsEnabled
      && r.hudVisible && r.controlsShown && r.seen && r.worldSame && r.objective === '1階の食堂へ' && r.stage === 1 && r.sub === 'memo';
    return r;
  };

  try { localStorage.removeItem('nolife2.tutorialSeen'); } catch (e) { /* */ }
  let before = null;

  // 0) タイトル(P6b-F1: 背景の生レンダ・ちらつき・全消灯・血の滴・クリックで 1.4 秒の黒 → 片付け → チュートリアル)
  await T('0_title', async () => {
    const s0 = ti.state();
    const el = document.getElementById('title');
    const textAll = el ? el.textContent : '';
    const aiTime0 = N.ai.time, simT0 = N.levelLog.length;
    // 背景を 35 秒回す(ゲームの時間は止まったまま)
    const outs = [], flicks = [], lens = [];
    let enemyOk = 0, camOk = 0, n = 0, maxBlackOut = 0;
    const y4 = N.world ? 3 * 2.9 : 8.7;
    for (let i = 0; i < 35 * 60; i++) {
      N.pump(DT, 1, false);
      const st = ti.state().bg;
      if (!st || !st.ready) continue;
      n++;
      const e = N.enemyObj.pos, c = N.camera.position;
      if (N.enemyObj.root.visible && Math.hypot(e.x - 6.85, e.z - 10.0) < 0.05) enemyOk++;
      if (N.level === 4 && Math.hypot(c.x - 6.9, c.z - 6.3) < 0.05 && Math.abs(c.y - (y4 + 1.75)) < 0.02 && N.camera.fov === 46) camOk++;
      if (i % 60 === 0 && st.drips) lens.push(st.drips.map((d) => d.len));
      if (st.lights.lm < 0.1) maxBlackOut = Math.max(maxBlackOut, N.renderer.toneMappingExposure);
    }
    for (const l of ti.log) { if (l.ev === 'outage') outs.push(l); if (l.ev === 'flicker') flicks.push(l); }
    const bg = ti.state().bg;
    const drips = bg.drips;
    const gaps = flicks.slice(1).map((f, i) => +(f.at - flicks[i].at).toFixed(2));
    const grows = lens.length > 25 && drips.every((d, k) => lens[3][k] < d.len && lens[20][k] <= d.len);
    const doneBy30 = drips.every((d) => d.T >= 20 && d.T <= 30 && d.done);
    const stalls = drips.map((_, k) => lens.slice(3, 30).filter((v, j, A) => j > 0 && v[k] === A[j - 1][k] && v[k] > 0 && v[k] < drips[k].L).length);   // 途中で止まった秒の数(本ごと。1 秒ごとの標本)
    const titleBg = { frames: n, enemyOk, camOk, exposure: N.renderer.toneMappingExposure, flicks: flicks.length, flickDur: flicks.map((f) => f.dur), blinks: flicks.map((f) => f.blinks), gaps,
      outs: outs.map((o) => [o.at, o.dur]), drips: drips.length, widths: drips.map((d) => d.w), stallSec: drips.map((d) => d.stall), branches: drips.filter((d) => d.branch).length, doneBy30, grows, stalls, aiFrozen: N.ai.time === aiTime0, levelLog: N.levelLog.length - simT0 };
    const bgPass = n > 1500 && enemyOk === n && camOk === n && titleBg.exposure === 4.3
      && flicks.length >= 4 && flicks.every((f) => f.dur >= 0.2 && f.dur <= 0.6 && f.blinks >= 2 && f.blinks <= 4) && gaps.every((g) => g >= 2.9 && g <= 8.9)
      && outs.length >= 1 && outs[0].at >= 20 && outs[0].at <= 40 && outs.every((o) => o.dur >= 0.4 && o.dur <= 0.8)
      && drips.length >= 8 && drips.length <= 10 && drips.every((d) => d.w >= 2 && d.w <= 6 && d.wBot / d.wTop >= 1.3) && doneBy30 && grows && titleBg.aiFrozen
      // 差し戻し(2026-11-04): 2〜3 本が途中で 3〜8 秒止まって再び流れる・2 本が枝分かれ・伸び切ってから乾く
      && drips.filter((d) => d.stall >= 3 && d.stall <= 8).length >= 2 && drips.filter((d) => d.stall >= 3).length <= 3
      && drips.every((d, k) => !(d.stall >= 3) || stalls[k] >= 2) && drips.filter((d) => d.branch).length >= 2 && drips.some((d) => d.dry > 0);
    // クリック → 1.4 秒で黒 → 片付け → チュートリアル(片付けの直後 = チュートリアルの開始前に、終わりの比較の基準を取る)
    ti.onRestored = () => { before = snapshot(); };
    ti.click();
    const leave = [];
    for (let i = 0; i < 180 && ti.active; i++) { N.pump(DT, 1, false); leave.push(ti.state().bg ? ti.state().bg.black : 1); }
    const s1 = ti.state(), st = tu.state(), r0 = ti.restored, sn = ti.snap;
    const restored = !!r0 && r0.exposure === sn.exposure && r0.fov === sn.fov && r0.ambient === (sn.ambient === null ? r0.ambient : sn.ambient) && r0.level === sn.level
      && Math.hypot(r0.x - sn.x, r0.z - sn.z) < 1e-6 && r0.ai.state === sn.ai.state && r0.ai.dormant === sn.ai.dormant && r0.ai.level === sn.ai.level
      && r0.flashlight === sn.flashlight && r0.extForce === sn.extForce && r0.manual === false && r0.lm.every((v) => v === 1) && r0.em.every((v) => v === 1) && r0.inkCleared;
    return { pass: s0.active && s0.shown && s0.name === 'NOLIFE' && !/2/.test(s0.name) && s0.start === 'クリックで開始' && !textAll.includes('NOLIFE 2')
      && bgPass && leave.length >= 80 && leave.length <= 90 && leave[40] > 0.4 && restored
      && !s1.active && st.active && st.index === 0 && N.player.frozen && !N.player.controls.enabled && N.hud.root.style.visibility === 'hidden' && N.ai.time === aiTime0,
      title: s0, titleBg, leaveFrames: leave.length, leaveBlackMid: leave[40], restored, restoredState: r0, snap: { exposure: sn.exposure, fov: sn.fov, level: sn.level, ai: sn.ai }, afterClick: s1, tutorial: st };
  });

  // 1) 通し
  await T('1_full_run', async () => {
    const aiTime0 = N.ai.time;
    const seenCaption = {};
    const S = { s2: { n: 0, blocked: 0, light: 0, shown: 0 }, s3: { maxOpen: 0, disp: [] }, s4: { peep: false, doorClosedAtPeep: null }, s5: { hidden: false }, s6: { lurk: 0, leak: 0, jig: 0 },
      s3b: { n: 0, onLanding: 0, lookStairs: 0, enemyShown: 0 }, s6b: { n: 0, open410: 0, closed409: 0 }, after6b: null,
      s7b: { z0: null, zMax: -1e9, maxSpeed: 0, lastZ: null, disp: [], open: 0, enemyShown: 0, lookUpEnd: null, endBlack: 0 },
      // P6b-F1: 場面 1 = 外観、7c = 覗き穴の向こうの顔
      s1: { n: 0, onSite: 0, extShown: 0, enemyShown: 0, fov50: 0, fog06: 0, pitch0: null, pitch1: null },
      s7c: { n: 0, cutBlack: [], after: [], peep: 0, enemyAtDoor: 0, maxAttack: 0, bloodOn: 0, hitT: null, caption: [] } };
    const fog0 = N.LOOK.ext.fogDensity;
    const LZ = N.building.stairs.find((q) => q.id === 'main').geom;
    const bank0 = N.bank.n, steps0 = N.enemyAudio.logCount || 0, ev0 = N.elevator.logCount || 0;
    let scene7Bank = null;
    const each1 = (st) => {
      if (!st.active) return;
      if (st.index === IX('1') && st.t > 0.7) {   // P6b-F1: 外観(敷地 'G')・外観が出ている・管理人は映らない・視野角 50°・外の霧 0.06・見上げる(pitch が上がる)
        const A = S.s1; A.n++;
        if (N.level === 'G') A.onSite++;
        if (N.exterior.ready && N.exterior.shown) A.extShown++;
        if (N.enemyObj.root.visible && !N.ai.concealed) A.enemyShown++;
        if (N.camera.fov === 50) A.fov50++;
        if (N.LOOK.ext.fogDensity === 0.06) A.fog06++;
        if (A.pitch0 === null) A.pitch0 = N.camera.rotation.x;
        A.pitch1 = N.camera.rotation.x;
      }
      if (st.index === IX('7b') && st.t > PLAN[IX('7b')] - 0.25) S.s7b.endBlack = Math.max(S.s7b.endBlack, st.black);
      if (st.index === IX('7c')) {   // P6b-F1: 入りは黒(0.1 秒)→ 覗き穴・管理人は扉の前・attack・打撃音・レンズの血
        const C = S.s7c; C.n++;
        if (st.t > 0 && st.t < 0.09) C.cutBlack.push(st.black); else if (st.t > 0.15) C.after.push(st.black);
        if (N.peepholeObj.active) C.peep++;
        const e = N.enemyObj.pos;
        if (N.enemyObj.root.visible && Math.hypot(e.x - 7.1, e.z - 7.24) < 0.05) C.enemyAtDoor++;
        C.maxAttack = Math.max(C.maxAttack, N.enemyObj.face.attack);
        if (N.movie.blood.pass.enabled) C.bloodOn++;
        C.caption.push(st.caption);
      }
      if (st.index === IX('7b')) {   // P6b-A2: 走る(速さ・前進)→ EV の表示 2→3→4・チャイム・扉は開かない・管理人は映らない
        const z = N.player.pos.z, B = S.s7b;
        if (B.z0 === null) B.z0 = z;
        if (B.lastZ !== null) B.maxSpeed = Math.max(B.maxSpeed, (z - B.lastZ) / (6 * DT));
        B.lastZ = z; B.zMax = Math.max(B.zMax, z);
        const f = N.elevator.shown.floor; if (B.disp[B.disp.length - 1] !== f) B.disp.push(f);
        B.open = Math.max(B.open, N.elevator.car.open);
        if (N.enemyObj.root.visible && !N.ai.concealed) B.enemyShown++;
        if (st.t > PLAN[IX('7b')] - 0.4) B.lookUpEnd = N.camera.getWorldDirection(new N.THREE.Vector3()).z;
      }
      if (st.t > 1.6 && st.t < PLAN[st.index] - 1.0) seenCaption[st.index] = st.caption;
      if (st.index === 2 && st.t > 0.7) {
        S.s2.n++;
        if (N.ai._blocked(N.player.pos)) S.s2.blocked++;
        if (N.enemyObj.flashlight.on) S.s2.light++;
        if (N.enemyObj.root.visible) S.s2.shown++;
      }
      if (st.index === 3) { S.s3.maxOpen = Math.max(S.s3.maxOpen, N.elevator.car.open); const f = N.elevator.shown.floor; if (S.s3.disp[S.s3.disp.length - 1] !== f) S.s3.disp.push(f); }
      if (st.index === IX('3b') && st.t > 0.7) {
        S.s3b.n++; const p = N.player.pos, f = N.camera.getWorldDirection(new N.THREE.Vector3());
        if (N.level === 3 && p.x > LZ.landing[0] && p.x < LZ.landing[0] + LZ.landing[2] && p.z > LZ.landing[1] && p.z < LZ.s0) S.s3b.onLanding++;
        if (f.z > 0.5) S.s3b.lookStairs++;
        if (N.enemyObj.root.visible && !N.ai.concealed) S.s3b.enemyShown++;
      }
      if (st.index === IX('6b') && st.t > 0.3) {
        S.s6b.n++; const d410 = N.world.doorById.get('410'), d409 = N.world.doorById.get('409');
        if (N.level === 4 && d410.angle > 1.5) S.s6b.open410++;
        if (d409.angle < 0.01) S.s6b.closed409++;
      }
      if (st.index === IX('7') && S.after6b === null) S.after6b = +N.world.doorById.get('410').angle.toFixed(3);
      if (st.index === IX('4') && N.peepholeObj.active && !S.s4.peep) { S.s4.peep = true; S.s4.doorClosedAtPeep = N.world.doorById.get('410').angle < 0.02; }
      if (st.index === IX('5') && N.rooms.hidden && N.rooms.hidden.phase === 'hidden') S.s5.hidden = true;
      if (st.index === IX('6') && st.shot === 0 && N.doorFx.lurkId === '409' && N.doorFx.lurkAmt > 0.99) S.s6.lurk++;
      if (st.index === IX('6') && st.shot === 1) S.s6.jig = Math.max(S.s6.jig, N.rooms.bursts.get('611').jiggle);
      if (st.index === IX('6') && st.shot === 2) S.s6.leak = Math.max(S.s6.leak, tu.leakMat.opacity);
      if (st.index === IX('7') && !scene7Bank) scene7Bank = N.bank.n;
    };
    each1.fineAt = (st) => st.active && (st.index === IX('7c') || (st.index === IX('7b') && st.t > PLAN[IX('7b')] - 0.3) || (st.index === IX('7c') - 1 && st.t > PLAN[IX('7b')] - 0.05));
    await advance(100, each1, () => !tu.active);
    const scenes = tu.log.filter((l) => l.ev === 'scene' && l.at !== undefined);
    const lastRun = scenes.slice(-IDS.length);
    const order = lastRun.map((l) => l.index);
    const endAt = tu.log.filter((l) => l.ev === 'end').slice(-1)[0];
    const at = [...lastRun.map((l) => l.at), endAt ? endAt.total : NaN];
    const durs = PLAN.map((_, i) => +(at[i + 1] - at[i]).toFixed(3));
    const total = +(at[IDS.length] - at[0]).toFixed(3);
    const texts = lastRun.map((l) => l.text);
    const L = (ev) => tu.log.filter((l) => l.ev === ev);
    const bankNew = N.bank.log.filter((l) => l.n > bank0);
    const evNew = N.elevator.events.filter((e) => e.n > ev0);
    const stepsNew = N.enemyAudio.log.filter((l) => l.n > steps0 && l.name === 'step');
    const r = {
      order, durs, total, texts,
      textsMatch: EXPECT.length === IDS.length && EXPECT.every((t, i) => texts[i] === t), captionsShown: EXPECT.slice(0, LAST).every((t, i) => seenCaption[i] === t),
      ids: lastRun.map((l) => l.id), s3b: S.s3b, s6b: S.s6b, after6b: S.after6b,
      s2: S.s2, s3: { displays: S.s3.disp, chime: evNew.some((e) => e.ev === 'sfx' && e.name === 'chime'), maxOpen: +S.s3.maxOpen.toFixed(3) },
      s4: { found: L('found').length, doorClose: L('door_close').length, peep: S.s4.peep, doorClosedAtPeep: S.s4.doorClosedAtPeep, passed: L('passed_lens').length },
      s5: S.s5, s6: { lurkFrames: S.s6.lurk, maxJiggle: +S.s6.jig.toFixed(3), maxLeak: +S.s6.leak.toFixed(2) },
      s7b: { ...S.s7b, runSteps: L('run_step').length, stepSounds: bankNew.filter((l) => l.id === 'pl_step_room').length, call: L('ev_call_7b').length, chime7b: evNew.filter((e) => e.ev === 'sfx' && e.name === 'chime').length },
      s7: { vaseBreak: L('vase_break').length, fallSound: bankNew.filter((l) => l.id === 'room_fall').length, chimeSound: bankNew.filter((l) => l.id === 'ev_chime').length, steps: stepsNew.length },
      s1: S.s1, s7c: { ...S.s7c, caption: [...new Set(S.s7c.caption)], hits: L('hit_7c').map((l) => l.t), hitSound: bankNew.filter((l) => l.id === 'enemy_hit').length },
      after: { fogRestored: N.LOOK.ext.fogDensity === fog0, bloodOff: !N.movie.blood.pass.enabled, fov: N.camera.fov },
      aiFrozen: N.ai.time === aiTime0,
    };
    r.pass = same(order, IDS.map((_, i) => i)) && same(r.ids, IDS) && durs.every((d, i) => Math.abs(d - PLAN[i]) < 0.05) && total >= 60 && total <= 100 && r.textsMatch && r.captionsShown
      && r.s7b.zMax - r.s7b.z0 > 4 && r.s7b.maxSpeed > 2.2 && r.s7b.runSteps >= 5 && r.s7b.stepSounds >= 5 && r.s7b.call === 1 && same(r.s7b.disp, [2, 3, 4]) && r.s7b.chime7b >= 2 && r.s7b.open === 0 && r.s7b.enemyShown === 0 && r.s7b.lookUpEnd > 0.9
      && S.s3b.n > 10 && S.s3b.onLanding === S.s3b.n && S.s3b.lookStairs === S.s3b.n && S.s3b.enemyShown === 0
      && S.s6b.n > 10 && S.s6b.open410 === S.s6b.n && S.s6b.closed409 === S.s6b.n && S.after6b === 0
      && S.s2.n > 10 && S.s2.blocked === S.s2.n && S.s2.light === S.s2.n && S.s2.shown === S.s2.n
      && same(S.s3.disp, [1, 2, 3]) && r.s3.chime && S.s3.maxOpen === 0
      && r.s4.found === 1 && r.s4.doorClose === 1 && S.s4.peep && S.s4.doorClosedAtPeep && r.s4.passed === 1
      && S.s5.hidden && S.s6.lurk > 5 && S.s6.jig > 0.02 && S.s6.leak > 0.5
      && r.s7.vaseBreak === 1 && r.s7.fallSound === 1 && r.s7.chimeSound >= 1 && r.s7.steps >= 3 && r.aiFrozen
      && S.s1.n > 20 && S.s1.onSite === S.s1.n && S.s1.extShown === S.s1.n && S.s1.enemyShown === 0 && S.s1.fov50 === S.s1.n && S.s1.fog06 === S.s1.n && S.s1.pitch1 - S.s1.pitch0 > 0.15
      && S.s7b.endBlack < 0.05
      && S.s7c.cutBlack.length >= 2 && S.s7c.cutBlack.every((b) => b === 1) && S.s7c.after.length > 100 && S.s7c.after.every((b) => b === 0)
      && S.s7c.peep === S.s7c.n && S.s7c.enemyAtDoor >= S.s7c.n - 1 && S.s7c.maxAttack >= 0.9 && S.s7c.bloodOn > 60
      && r.s7c.hits.length === 1 && r.s7c.hitSound === 1 && r.s7c.caption.length === 1 && r.s7c.caption[0] === ''
      && r.after.fogRestored && r.after.bloodOff && r.after.fov === 68;
    return r;
  });

  // 2) 終わりの状態
  await T('2_end_state', async () => endState(before));

  // 3) 初回(未読)は Esc で飛ばせない
  await T('3_esc_first_time', async () => {
    try { localStorage.removeItem('nolife2.tutorialSeen'); } catch (e) { /* */ }
    const b = snapshot();
    tu.start();
    await advance(6.0);
    const before3 = tu.state();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape', key: 'Escape', bubbles: true }));
    await advance(0.5);
    const after3 = tu.state();
    const ignored = tu.log.filter((l) => l.ev === 'skip_ignored').length;
    for (const an of document.getElementById('tutskip').getAnimations()) an.finish();
    const skipHint = getComputedStyle(document.getElementById('tutskip')).opacity;
    // 片付け: 最後まで流す
    await advance(100, null, () => !tu.active);
    const e = await endState(b);
    return { pass: before3.index === 1 && after3.index === 1 && after3.active && ignored >= 1 && +skipHint === 0 && e.pass, before: before3, after: after3, ignored, skipHint, end: e.pass };
  });

  // 4) 既読なら Esc で飛ばせる(場面 4 の途中)・ポインタロックが外れても飛ばせる
  await T('4_esc_skip_when_seen', async () => {
    tu.seen = true;
    const b = snapshot();
    tu.start();
    const skipEl = document.getElementById('tutskip');
    for (const an of skipEl.getAnimations()) an.finish();   // CSS の遷移(実時間 0.6 秒)を終わらせてから読む(前面のページでは遷移の途中の値になる)
    const hint = +getComputedStyle(skipEl).opacity;
    await advance(PLAN.slice(0, IX('4')).reduce((a, b) => a + b, 0) + 7.0, null, () => !tu.active);   // 場面 4 の 7 秒目(覗き穴・扉は閉じた・EV は 3F)
    const mid = { ...tu.state(), peep: N.peepholeObj.active, car: N.elevator.car.level };
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape', key: 'Escape', bubbles: true }));
    const jumped = tu.state();
    await advance(5, null, () => !tu.active);
    const e = await endState(b);
    // ポインタロックが外れた(Esc でロックが外れるとキーが届かないことがある)
    tu.start();
    await advance(14);
    const mid2 = tu.state();
    N.player.controls.dispatchEvent({ type: 'unlock' });
    const jumped2 = tu.state();
    await advance(5, null, () => !tu.active);
    const e2 = await endState(b);
    return { pass: hint > 0 && mid.index === IX('4') && mid.peep && mid.car === 3 && jumped.index === LAST && e.pass && mid2.index === 2 && jumped2.index === LAST && e2.pass,
      hint, mid, jumped: jumped.index, end: e, mid2: mid2.index, jumped2: jumped2.index, end2: e2.pass };
  });

  // 5) P6b-E1: チュートリアルの露出(場面 1〜7b は 3.2、本編 4.5)と場面 1 の輝度
  await T('5_exposure', async () => {
    const R = N.renderer, X0 = N.LOOK.exposure;
    // 960×540 で描く。中央 50%(480×270)と画面全体: sRGB 表示値の Rec.709 輝度の平均(0..1)と、中間調(40〜120/255)の割合
    const measure = () => {
      N.setRenderSize(960, 540); N.render();
      const gl = R.getContext(), w = 960, h = 540, px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      N.setRenderSize(0);
      let s = 0, mid = 0, cs = 0, cm = 0, cn = 0;
      for (let i = 0; i < px.length; i += 4) {
        const y = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2], m = y >= 40 && y <= 120;
        s += y; if (m) mid++;
        const X = (i >> 2) % w, Y = ((i >> 2) / w) | 0;
        if (X >= 240 && X < 720 && Y >= 135 && Y < 405) { cn++; cs += y; if (m) cm++; }
      }
      return { mean: cs / cn / 255, mid: cm / cn, fullMean: s / (w * h) / 255, fullMid: mid / (w * h) };
    };
    const at = (i) => PLAN.slice(0, i).reduce((a, b) => a + b, 0);
    tu.seen = false;
    const ex = { start: null, s0: null, s1: null, s7b: null, s8: null, end: null };
    tu.start();
    ex.start = R.toneMappingExposure;
    await advance(2.0); ex.s0 = { index: tu.state().index, v: R.toneMappingExposure };
    // 場面 1 の 3 か所(P6b-F1: 外観を見上げる途中)で場面の露出と 4.5 を描き比べる(同じフレーム。暗転が明けた後)
    const shots = [];
    const seen = []; let s8first = null;   // 場面ごとの露出(最初に見えたフレームの値)
    const rec = (st) => { if (st.active && seen[st.index] === undefined) seen[st.index] = R.toneMappingExposure; };
    let clock = 2.0;   // チュートリアルの開始からの時刻
    for (const t of [2.2, 4.2, 6.6]) {
      await advance(at(1) + t - clock, rec); clock = at(1) + t;
      const st = tu.state();
      const v = R.toneMappingExposure;
      const dark = measure();
      R.toneMappingExposure = X0; const ref = measure(); R.toneMappingExposure = v;
      shots.push({ t, index: st.index, black: st.black, exposure: v, mean32: +dark.mean.toFixed(4), mean45: +ref.mean.toFixed(4), ratio: +(dark.mean / ref.mean).toFixed(3), mid32: +dark.mid.toFixed(3), mid45: +ref.mid.toFixed(3),
        full: { mean32: +dark.fullMean.toFixed(4), mean45: +ref.fullMean.toFixed(4), mid32: +dark.fullMid.toFixed(3), mid45: +ref.fullMid.toFixed(3) } });
    }
    const avg = (k) => shots.reduce((a, s) => a + s[k], 0) / shots.length;
    const scene1 = { mean32: +avg('mean32').toFixed(4), mean45: +avg('mean45').toFixed(4), ratio: +(avg('mean32') / avg('mean45')).toFixed(3), mid32: +avg('mid32').toFixed(3), mid45: +avg('mid45').toFixed(3),
      fullMid: +(shots.reduce((a, s) => a + s.full.mid32, 0) / shots.length).toFixed(3) };   // P6b-F1: 場面 1 は外観(露出 3.7)。mean32/mid32 の名前は従来のまま(値はその場面の露出)
    // P6b-F1: 1 段暗い露出(3.2)の比は 410 の場面 5(クローゼットの前。旧場面 1 の 410 は外観になった)で見る
    await advance(at(IX('5')) + 0.9 - clock, rec); clock = at(IX('5')) + 0.9;
    const s5 = (() => { const v = R.toneMappingExposure, d = measure(); R.toneMappingExposure = X0; const f = measure(); R.toneMappingExposure = v; return { index: tu.state().index, exposure: v, mean32: +d.mean.toFixed(4), mean45: +f.mean.toFixed(4), ratio: +(d.mean / f.mean).toFixed(3), mid32: +d.mid.toFixed(3) }; })();
    // 7b(最後の暗い場面)→ 8 の暗転で戻る
    await advance(200, (st) => {
      if (!st.active) return;
      rec(st);
      if (st.index === LAST && s8first === null) s8first = { t: st.t, v: R.toneMappingExposure, black: st.black };
    }, () => !tu.active);
    ex.s1 = seen[1]; ex.s7b = seen[IX('7b')]; ex.s8 = s8first; ex.end = R.toneMappingExposure;
    const mids = Array.from({ length: LAST - 1 }, (_, i) => seen[i + 1]);   // 穴(見ていない場面)は undefined のまま比べる
    // Esc で飛ばす(既読・場面 2 の途中)・ロック解除で飛ばす(場面 5 の途中)
    tu.seen = true;
    tu.start(); await advance(at(2) + 3.0, null, () => !tu.active);
    const escMid = R.toneMappingExposure;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape', key: 'Escape', bubbles: true }));
    const escJump = R.toneMappingExposure;
    await advance(5, null, () => !tu.active);
    const escEnd = R.toneMappingExposure;
    tu.start(); await advance(at(IX('5')) + 2.0, null, () => !tu.active);
    const unlockMid = R.toneMappingExposure;
    N.player.controls.dispatchEvent({ type: 'unlock' });
    await advance(5, null, () => !tu.active);
    const unlockEnd = R.toneMappingExposure;
    const r = { lookExposure: X0, ex, scene1, scene5: s5, shots, perScene: seen.map((v) => v), esc: { mid: escMid, jump: escJump, end: escEnd }, unlock: { mid: unlockMid, end: unlockEnd } };
    r.pass = X0 === 4.5 && ex.start === 4.5 && ex.s0.index === 0 && ex.s0.v === 4.5
      && shots.every((s) => s.index === 1 && s.black < 0.01 && s.exposure === 3.7)
      && scene1.mid32 >= 0.15 && scene1.fullMid >= 0.15 && s5.index === IX('5') && s5.exposure === 3.2 && s5.ratio >= 0.6 && s5.ratio <= 0.8
      && mids.length === LAST - 1 && mids.every((v, i) => v === (IDS[i + 1] === '1' ? 3.7 : IDS[i + 1] === '7c' ? 6.0 : 3.2)) && ex.s8 && ex.s8.v === 4.5 && ex.s8.black > 0.99 && ex.end === 4.5 && !tu.active
      && escMid === 3.2 && escJump === 4.5 && escEnd === 4.5 && unlockMid === 3.2 && unlockEnd === 4.5;
    return r;
  });

  N.testResult = out;
  show();
  return out;
}
