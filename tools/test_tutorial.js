// test_tutorial.js — P6a タイトルと場面を映すチュートリアル(DESIGN §3.8「チュートリアル」の表 0〜8・§7 P6a)の決定的テスト(ブラウザ内)。
// http://127.0.0.1:8001/index.html?test=tutorial で自動実行。rAF に依存せず window.__N2.pump(dt, n) で進める(階の読み込み待ちの間だけ実時間を待つ)。結果: window.__N2.testResult
//  0) タイトル: 「NOLIFE」(「2」は付けない。2026-11-02 ユーザー指示)と「クリックで開始」。クリックでチュートリアルが始まり、入力が止まり HUD が隠れる
//  1) 通し: 場面 0〜8 の順序・各場面の所要時間(表の値 ±0.05 秒)と合計 60〜80 秒・文言が表のとおり(句読点・「、、、」も)・場面ごとの仕込み
//     (2 光だけ = 管理人の体は壁の向こう・懐中電灯は点灯 / 3 階数表示 1→2→3 とチャイム・扉は開かない / 4 見つかる→扉を閉める→覗き穴→通り過ぎる /
//      5 クローゼットの中 / 6 扉の下の揺らぎ・ロッカーの軋み・光漏れ / 7 花瓶が割れる音・遠いチャイム・足音)・演出中は AI の時計が止まっている
//  2) 終わり: 410 のベッド脇・操作が戻る・操作一覧・管理人/扉/EV/帯/クローゼット/ロッカー/覗き穴/懐中電灯/環境光が開始前と同じ・目標「1階の食堂へ」・既読になる
//  3) 初回(未読)は Esc で飛ばせない
//  4) 既読なら Esc で飛ばせる(場面 4 の途中 = 扉・覗き穴・EV が動いた後)→ 場面 8 → 終わりの状態は 2) と同じ。ポインタロックが外れた時も飛ばせる

const DT = 1 / 60;
const EXPECT = [
  'ノーライフ学生会館　午前3時',
  'いつもと様子が違う。不気味だ。',
  '管理人があなたを探している！',
  '深夜の館内を歩き回っている。ライトの光と移動する音に耳をすませろ！',
  '見つかったら部屋の中に逃げろ！ドアの隙間から廊下の様子を確認しろ！',
  'クローゼットの中に身を隠すこともできる',
  '管理人は至る所に潜んでいる、、、部屋の中、ロッカーの中にもいるかも？自分の懐中電灯の光には気をつけろ！',
  '決して音をたてるな！',
  '',
];
const PLAN = [5.0, 8.0, 8.5, 8.0, 13.0, 7.5, 13.5, 8.0, 3.0];

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
      N.pump(DT, 6, false); t += 6 * DT;
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
      peep: N.peepholeObj.active, fov: N.camera.fov, flashlight: N.player.flashlightOn, flashI: N.player.flashlight.intensity, ambient: +N.ambientFloor.intensity.toFixed(3) };
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

  // 0) タイトル
  await T('0_title', async () => {
    const s0 = ti.state();
    const el = document.getElementById('title');
    const textAll = el ? el.textContent : '';
    before = snapshot();
    const aiTime0 = N.ai.time;
    ti.click();
    const s1 = ti.state(), st = tu.state();
    return { pass: s0.active && s0.shown && s0.name === 'NOLIFE' && !/2/.test(s0.name) && s0.start === 'クリックで開始' && !textAll.includes('NOLIFE 2')
      && !s1.active && st.active && st.index === 0 && N.player.frozen && !N.player.controls.enabled && N.hud.root.style.visibility === 'hidden' && N.ai.time === aiTime0,
      title: s0, afterClick: s1, tutorial: st };
  });

  // 1) 通し
  await T('1_full_run', async () => {
    const aiTime0 = N.ai.time;
    const seenCaption = {};
    const S = { s2: { n: 0, blocked: 0, light: 0, shown: 0 }, s3: { maxOpen: 0, disp: [] }, s4: { peep: false, doorClosedAtPeep: null }, s5: { hidden: false }, s6: { lurk: 0, leak: 0, jig: 0 } };
    const bank0 = N.bank.n, steps0 = N.enemyAudio.logCount || 0, ev0 = N.elevator.logCount || 0;
    let scene7Bank = null;
    await advance(90, (st) => {
      if (!st.active) return;
      if (st.t > 1.6 && st.t < PLAN[st.index] - 1.0) seenCaption[st.index] = st.caption;
      if (st.index === 2 && st.t > 0.7) {
        S.s2.n++;
        if (N.ai._blocked(N.player.pos)) S.s2.blocked++;
        if (N.enemyObj.flashlight.on) S.s2.light++;
        if (N.enemyObj.root.visible) S.s2.shown++;
      }
      if (st.index === 3) { S.s3.maxOpen = Math.max(S.s3.maxOpen, N.elevator.car.open); const f = N.elevator.shown.floor; if (S.s3.disp[S.s3.disp.length - 1] !== f) S.s3.disp.push(f); }
      if (st.index === 4 && N.peepholeObj.active && !S.s4.peep) { S.s4.peep = true; S.s4.doorClosedAtPeep = N.world.doorById.get('410').angle < 0.02; }
      if (st.index === 5 && N.rooms.hidden && N.rooms.hidden.phase === 'hidden') S.s5.hidden = true;
      if (st.index === 6 && st.shot === 0 && N.doorFx.lurkId === '409' && N.doorFx.lurkAmt > 0.99) S.s6.lurk++;
      if (st.index === 6 && st.shot === 1) S.s6.jig = Math.max(S.s6.jig, N.rooms.bursts.get('611').jiggle);
      if (st.index === 6 && st.shot === 2) S.s6.leak = Math.max(S.s6.leak, tu.leakMat.opacity);
      if (st.index === 7 && !scene7Bank) scene7Bank = N.bank.n;
    }, () => !tu.active);
    const scenes = tu.log.filter((l) => l.ev === 'scene' && l.at !== undefined);
    const lastRun = scenes.slice(-9);
    const order = lastRun.map((l) => l.index);
    const endAt = tu.log.filter((l) => l.ev === 'end').slice(-1)[0];
    const at = [...lastRun.map((l) => l.at), endAt ? endAt.total : NaN];
    const durs = PLAN.map((_, i) => +(at[i + 1] - at[i]).toFixed(3));
    const total = +(at[9] - at[0]).toFixed(3);
    const texts = lastRun.map((l) => l.text);
    const L = (ev) => tu.log.filter((l) => l.ev === ev);
    const bankNew = N.bank.log.filter((l) => l.n > bank0);
    const evNew = N.elevator.events.filter((e) => e.n > ev0);
    const stepsNew = N.enemyAudio.log.filter((l) => l.n > steps0 && l.name === 'step');
    const r = {
      order, durs, total, texts,
      textsMatch: EXPECT.every((t, i) => texts[i] === t), captionsShown: EXPECT.slice(0, 8).every((t, i) => seenCaption[i] === t),
      s2: S.s2, s3: { displays: S.s3.disp, chime: evNew.some((e) => e.ev === 'sfx' && e.name === 'chime'), maxOpen: +S.s3.maxOpen.toFixed(3) },
      s4: { found: L('found').length, doorClose: L('door_close').length, peep: S.s4.peep, doorClosedAtPeep: S.s4.doorClosedAtPeep, passed: L('passed_lens').length },
      s5: S.s5, s6: { lurkFrames: S.s6.lurk, maxJiggle: +S.s6.jig.toFixed(3), maxLeak: +S.s6.leak.toFixed(2) },
      s7: { vaseBreak: L('vase_break').length, fallSound: bankNew.filter((l) => l.id === 'room_fall').length, chimeSound: bankNew.filter((l) => l.id === 'ev_chime').length, steps: stepsNew.length },
      aiFrozen: N.ai.time === aiTime0,
    };
    r.pass = same(order, [0, 1, 2, 3, 4, 5, 6, 7, 8]) && durs.every((d, i) => Math.abs(d - PLAN[i]) < 0.05) && total >= 60 && total <= 80 && r.textsMatch && r.captionsShown
      && S.s2.n > 10 && S.s2.blocked === S.s2.n && S.s2.light === S.s2.n && S.s2.shown === S.s2.n
      && same(S.s3.disp, [1, 2, 3]) && r.s3.chime && S.s3.maxOpen === 0
      && r.s4.found === 1 && r.s4.doorClose === 1 && S.s4.peep && S.s4.doorClosedAtPeep && r.s4.passed === 1
      && S.s5.hidden && S.s6.lurk > 5 && S.s6.jig > 0.02 && S.s6.leak > 0.5
      && r.s7.vaseBreak === 1 && r.s7.fallSound === 1 && r.s7.chimeSound >= 1 && r.s7.steps >= 3 && r.aiFrozen;
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
    const skipHint = getComputedStyle(document.getElementById('tutskip')).opacity;
    // 片付け: 最後まで流す
    await advance(90, null, () => !tu.active);
    const e = await endState(b);
    return { pass: before3.index === 1 && after3.index === 1 && after3.active && ignored >= 1 && +skipHint === 0 && e.pass, before: before3, after: after3, ignored, skipHint, end: e.pass };
  });

  // 4) 既読なら Esc で飛ばせる(場面 4 の途中)・ポインタロックが外れても飛ばせる
  await T('4_esc_skip_when_seen', async () => {
    tu.seen = true;
    const b = snapshot();
    tu.start();
    const hint = +getComputedStyle(document.getElementById('tutskip')).opacity;
    await advance(29.5 + 7.0, null, () => !tu.active);   // 場面 4 の 7 秒目(覗き穴・扉は閉じた・EV は 3F)
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
    return { pass: hint > 0 && mid.index === 4 && mid.peep && mid.car === 3 && jumped.index === 8 && e.pass && mid2.index === 2 && jumped2.index === 8 && e2.pass,
      hint, mid, jumped: jumped.index, end: e, mid2: mid2.index, jumped2: jumped2.index, end2: e2.pass };
  });

  N.testResult = out;
  show();
  return out;
}
