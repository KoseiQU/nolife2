// test_spaces.js — P5b-2a 異世界 2 空間(105 の長い廊下・312 のプール)の決定的テスト(ブラウザ内)。http://127.0.0.1:8001/index.html?test=spaces で自動実行。
// rAF に依存せず window.__N2.pump(dt, n) で本物のループと同じ順に進める。キーは keydown/keyup をペアで送る。結果: window.__N2.testResult。?only=105_1,312_2 で絞れる
//  105_1) 伸びる: 歩いても前の分岐との距離が縮まない期間がある・振り返ると来た道が壁(背後 7m)・伸び終わると近づける
//  105_2) 分岐と折り返し: F1 の左は施錠・右で R1 へ、F2 の右は施錠・左を抜けると扉が閉まって最初の地点(R0 の入口)へ戻る(継ぎ目なし: 見た目の座標が同じ)・2 回目は左が施錠で右が開く
//  105_3) 反転: 反転の扉を抜けるとカメラのロールが π に達する・床の高さと当たりは変わらない・A/D が入れ替わる
//  105_4) 追跡: 管理人が背後に現れて CHASE・壁と天井が歪む・背後から灯りが消える(消えた灯りはすべてプレイヤーの後ろ)・走り続ければ出口 → 105 の扉の前(第5段)
//  105_5) 止まると捕まる → 105 の扉の前(扉を向く)・次に入ると追跡の区間の前から
//  312_1) 通路 → プール: 入口から青い通路を抜けてプールサイドへ・入水で泳ぎ(遅い・浮いている)
//  312_2) 潜水: Ctrl 長押しで潜る・離すと浮上・息ゲージは潜っている間だけ出る・切れたら溺れて第3段の開始位置へ
//  312_3) 伸びる・底の鍵・反転・見ているだけの管理人: 泳ぐほど対岸が遠のく → 底の 105 の鍵で第4段・対岸が元に戻る・浮上すると入口が反対側の壁に・
//         プールサイドの管理人は見ているだけ(ATTACK/CHASE にならない)・戻りの通路に入ると消える・戻ると 312 の扉の前
//  P) 性能(P_perf_vs_4F_corridor): 各空間の代表の視点と 4F の廊下を同じ計り方(1080p・40 フレームの中央値の 5 回の最小。4F は最初と最後)で。描画コール・三角形数

const DT = 1 / 60;

export async function run(N) {
  const out = { ok: true, cases: {} };
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:fixed;left:8px;top:8px;z-index:10;color:#9fe39f;background:rgba(0,0,0,.78);font:11px/1.35 monospace;padding:8px;max-width:46vw;max-height:94vh;overflow:auto;white-space:pre-wrap;';
  document.body.appendChild(pre);
  const show = () => { pre.textContent = JSON.stringify(out, null, 1); };
  const ONLY = new URLSearchParams(location.search).get('only');
  const T = async (name, fn) => {
    if (ONLY && !ONLY.split(',').some((k) => name.startsWith(k))) return;
    try { const r = await fn(); out.cases[name] = r; if (!r.pass) out.ok = false; }
    catch (e) { out.cases[name] = { pass: false, error: String(e && e.stack || e) }; out.ok = false; }
    show();
  };
  N.paused = true;
  const S = N.story, SP = N.spaces;
  const key = (code, down) => document.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
  const tap = (code, frames = 3) => { key(code, true); N.pump(DT, frames, false); key(code, false); N.pump(DT, 2, false); };
  const pos = () => ({ x: +N.player.pos.x.toFixed(2), z: +N.player.pos.z.toFixed(2), level: N.level });
  const face = (x, z, pitch = 0) => { const p = N.player.pos; N.player.object.rotation.set(pitch, Math.atan2(-(x - p.x), -(z - p.z)), N.player.object.rotation.z, 'YXZ'); N.player.object.updateMatrixWorld(); };
  // 歩く(each(i) は毎フレーム。true を返したら止める)
  const walkTo = (x, z, { max = 1200, tol = 0.14, run = false, each = null } = {}) => {
    key('KeyW', true); if (run) key('ShiftLeft', true);
    let ok = false, last = null, still = 0, stopped = false;
    for (let i = 0; i < max; i++) {
      const p = N.player.pos;
      if (Math.hypot(x - p.x, z - p.z) < tol) { ok = true; break; }
      face(x, z, 0);
      N.pump(DT, 1, false);
      if (each && each(i)) { stopped = true; break; }
      if (S.trans) { ok = true; break; }
      if (last && Math.hypot(p.x - last.x, p.z - last.z) < 1e-4) { if (++still > 30) break; } else still = 0;
      last = { x: p.x, z: p.z };
    }
    key('KeyW', false); if (run) key('ShiftLeft', false); N.pump(DT, 2, false);
    return ok || stopped;
  };
  const walkPath = (pts, o = {}) => pts.every(([x, z]) => walkTo(x, z, { tol: 0.2, ...o }));
  const waitTrans = () => { for (let i = 0; i < 120 && S.trans; i++) N.pump(DT, 1, false); N.pump(DT, 4, false); };
  const quiet = () => { N.ai.reset(N.ENEMY_HOME.x, N.ENEMY_HOME.z, N.ENEMY_HOME.yaw, 4); N.ai.setState('SCRIPTED', { force: true }); N.enemyObj.place(6.9, 19.5, Math.PI); };
  const settle = async (lv) => { if (!(typeof lv === 'string' && lv[0] === 'X')) await N.world.focus(lv); N.pump(DT, 30, false); };
  const tp = async (lv, x, z, yaw) => { if (typeof lv === 'string' && lv[0] === 'X') SP.show(lv); await N.teleport(lv, x, z, yaw); await settle(lv); };
  const useE = () => { N.pump(DT, 2, false); const h = N.hudState(); tap('KeyE'); N.pump(DT, 2, false); return { hint: h.hint, toast: N.hudState().toast }; };
  // 物語の扉を鍵で開けて、戸口を越えて別空間へ
  const FN = { W: [-1, 0], E: [1, 0], N: [0, -1], S: [0, 1] };
  const openAndEnter = (id) => {
    const d = N.doorApi.get(id);
    face(d.pos[0], d.pos[1], 0); N.pump(DT, 2, false);
    tap('KeyE'); N.pump(DT, 60, false);
    const n = FN[d.facing];
    walkTo(d.pos[0] - n[0] * 0.6, d.pos[1] - n[1] * 0.6, { max: 240, tol: 0.1 });
    waitTrans();
    return N.level;
  };
  const D105 = () => SP.debug('X105');
  const D312 = () => SP.debug('X312');
  const W105 = (u, v) => [300 + u, v];

  // ================================================================ 105
  // 第4段の開始(312 の前)から 1F の 105 の前へ。鍵で開けて X105 へ
  const enter105 = async () => {
    S.applyStage(4); quiet();
    const b = SP.def('X105').back;
    await tp(1, b.x, b.z, b.yaw + Math.PI);
    return openAndEnter('105');
  };

  await T('105_1_stretch_back_wall', async () => {
    const lv = await enter105();
    const st0 = D105().state();
    const objIn = N.hudState().objective;
    // 入口から z 48 まで歩く(伸びる区間 10〜46)。前の分岐(R0 の終わり)との距離を記録
    const rec = [];
    walkTo(...W105(0, 48), { max: 4000, each: () => { const s = D105().state(); rec.push([N.player.pos.z, s.r0End - N.player.pos.z, s.backZ]); return false; } });
    // 距離が縮まない期間: z が 20m 以上進む間、前の扉との距離の変化が 0.05m 以内
    let best = 0;
    for (let i = 0, j = 0; i < rec.length; i++) {
      while (j < i && Math.abs(rec[i][1] - rec[j][1]) > 0.05) j++;
      best = Math.max(best, rec[i][0] - rec[j][0]);
    }
    const keep = rec.filter((r) => r[0] > 15 && r[0] < 40).map((r) => r[1]);
    const st1 = D105().state();
    // 振り返ると来た道が壁: 後ろを向いて歩くと backZ で止まる・105 の入口(z 0)は見えない
    const zBack = st1.backZ;
    face(300, 0, 0); N.pump(DT, 2, false);
    walkTo(...W105(0, 0.5), { max: 900 });
    const stopAt = N.player.pos.z;
    // 前へ向き直して進むと、伸び終わった後は近づける
    walkTo(...W105(0, 64), { max: 3000 });
    const st2 = D105().state();
    const pass = lv === 'X105' && objIn === '出口へ' && st0.phase === 'start' && st0.r0End === 34 && best >= 20 && keep.length > 10
      && Math.max(...keep) - Math.min(...keep) < 0.1 && Math.abs(keep[0] - 24) < 0.3 && st1.phase === 'post' && st1.r0End === 70
      && zBack > 30 && Math.abs(stopAt - (zBack + 0.28)) < 0.1 && st2.r0End === 70 && 70 - N.player.pos.z < 7;
    return { pass, level: lv, objective: objIn, start: { phase: st0.phase, frontZ: st0.r0End }, steadyWalked_m: +best.toFixed(2),
      frontDistWhileStretch: { min: +Math.min(...keep).toFixed(3), max: +Math.max(...keep).toFixed(3) }, after: { phase: st1.phase, frontZ: st1.r0End, backZ: zBack },
      walkBackStoppedAt: +stopAt.toFixed(2), finalDistToFork: +(70 - N.player.pos.z).toFixed(2) };
  });

  await T('105_2_forks_and_loop', async () => {
    if (N.level !== 'X105') await enter105();
    D105().skip('post');
    await tp('X105', ...W105(0, 66), Math.PI);
    // F1: 左は施錠・右で R1
    walkPath([W105(0, 68.4), W105(-1.1, 69.1)]); face(...W105(-1.1, 70)); const f1L = useE();
    walkTo(...W105(1.1, 69.1)); face(...W105(1.1, 70)); const f1R = useE(); N.pump(DT, 60, false);
    walkPath([W105(1.1, 71.0), W105(1.1, 93.0)]);
    const inR1 = D105().state().run;
    // F2(1 回目): 右は施錠・左を開けて抜ける
    walkPath([W105(1.1, 94.4), W105(2.2, 95.1)]); face(...W105(2.2, 96)); const f2R = useE();
    walkTo(...W105(0, 95.1)); face(...W105(0, 96)); const f2L = useE(); N.pump(DT, 60, false);
    const before = D105().state();
    let jumped = null, view = null;
    walkTo(...W105(0, 101), { each: () => { const s = D105().state(); if (s.loopDone && !jumped) { jumped = pos(); return true; } return false; } });
    const after = D105().state();
    const L = D105().st.loopJumpAt;
    // 継ぎ目なし: 見た目の座標(R0 は z、RL は z − 96)と灯りの位相が同じ = 移す前後で z の差がちょうど 96
    if (L) view = { fromV: +L.from.v.toFixed(3), toV: +L.to.v.toFixed(3), delta: +(L.from.v - L.to.v).toFixed(3), u: +L.from.u.toFixed(3) };
    // 2 回目: 戻ってきた所から F2 まで(歩くと長いので F2 の手前へ移す)。左が施錠・右が開く
    await tp('X105', ...W105(1.1, 94.6), Math.PI);
    walkTo(...W105(0, 95.1)); face(...W105(0, 96)); const f2L2 = useE();
    walkTo(...W105(2.2, 95.1)); face(...W105(2.2, 96)); const f2R2 = useE(); N.pump(DT, 60, false);
    const door105 = (() => { const d = D105().door('105'); return { locked: true, z: d.z }; })();
    const pass = f1L.toast === '鍵がかかっている' && f1R.hint.includes('開ける') && inR1 === 'R1' && f2R.toast === '鍵がかかっている' && f2L.hint.includes('開ける')
      && !before.loopDone && after.loopDone && jumped && jumped.z > 2.0 && jumped.z < 4.5 && Math.abs(jumped.x - 300) < 0.3 && view && Math.abs(view.delta - 96) < 1e-6
      && f2L2.toast === '鍵がかかっている' && D105().door('F2R').target > 1;
    return { pass, f1L, f1R, inR1, f2R, f2L, jumpedTo: jumped, view, secondPass: { f2L: f2L2, f2ROpen: D105().door('F2R').target }, door105, log: D105().state().log };
  });

  await T('105_3_inversion_roll', async () => {
    if (N.level !== 'X105') await enter105();
    D105().skip('loopDone');
    const d = D105().door('F2R'); d.target = d.angle = 1.45; d.col.disabled = true; d.pv.rotation.y = -1.45;
    await tp('X105', ...W105(2.2, 97.5), Math.PI);
    const cols0 = N.collisions, y0 = N.player.pos.y;
    walkTo(...W105(2.2, 109.1)); face(...W105(2.2, 110)); const inv = useE(); N.pump(DT, 60, false);
    let maxRoll = 0, yDev = 0, colsSame = true, t = 0, tPi = null;
    walkTo(...W105(2.2, 114), { each: () => { t += DT; const r = N.player.object.rotation.z; maxRoll = Math.max(maxRoll, r); if (tPi === null && r >= Math.PI - 1e-3) tPi = t; yDev = Math.max(yDev, Math.abs(N.player.pos.y - y0)); if (N.collisions !== cols0) colsSame = false; return false; } });
    for (let i = 0; i < 240; i++) { N.pump(DT, 1, false); t += DT; const r = N.player.object.rotation.z; maxRoll = Math.max(maxRoll, r); if (tPi === null && r >= Math.PI - 1e-3) tPi = t; yDev = Math.max(yDev, Math.abs(N.player.pos.y - y0)); }
    const st = D105().state();
    // A/D の入れ替え: 画面の右(= 世界の左)へ動く
    const x0 = N.player.pos.x; face(...W105(2.2, 130)); key('KeyD', true); N.pump(DT, 20, false); key('KeyD', false); N.pump(DT, 2, false);
    const dx = N.player.pos.x - x0;   // +z を向いて世界の右は −x。反転中の D は画面の右 = 世界の +x
    const pass = inv.hint.includes('開ける') && st.inverted && Math.abs(maxRoll - Math.PI) < 1e-3 && tPi !== null && tPi < 4.0 && yDev === 0 && colsSame && N.player.invert && dx > 0.1;
    return { pass, invDoor: inv, roll: +maxRoll.toFixed(4), rollReachedPi_s: tPi && +tPi.toFixed(2), floorYDeviation: yDev, collisionsSame: colsSame, invert: N.player.invert, dWorldX_onD: +dx.toFixed(3), log: st.log };
  });

  await T('105_4_chase_escape_exit', async () => {
    if (N.level !== 'X105' || !D105().state().inverted) return { pass: false, why: 'needs 105_3' };
    const t0 = N.ai.time, deaths0 = N.deaths();
    let appearAt = null, chaseAt = null, minDist = 1e9, attacks = 0, maxWarp = 0, offSeen = 0, offAhead = 0, stateSeq = [];
    const each = () => {
      const s = D105().state();
      if (s.chase && appearAt === null) appearAt = N.player.pos.z;
      if (N.ai.state === 'CHASE' && chaseAt === null) chaseAt = N.ai.time - t0;
      if (stateSeq[stateSeq.length - 1] !== N.ai.state) stateSeq.push(N.ai.state);
      if (N.ai.level === 'X105') minDist = Math.min(minDist, Math.hypot(N.enemyObj.pos.x - N.player.pos.x, N.enemyObj.pos.z - N.player.pos.z));
      if (N.ai.state === 'ATTACK') attacks++;
      maxWarp = Math.max(maxWarp, s.warp);
      const lo = D105().lampsOff(); offSeen = Math.max(offSeen, lo.off); if (lo.offZ !== undefined && lo.offZ !== null && lo.offZ > N.player.pos.z) offAhead++;
      return N.level !== 'X105';
    };
    // 走り続ける: R3 → F3 の右(開いている)→ R4 → 出口
    const ok = walkPath([W105(2.2, 120), W105(2.2, 137.6), W105(3.3, 139.2), W105(3.3, 141.0), W105(3.3, 166.5)], { run: true, each });
    waitTrans();
    const b = SP.def('X105').back;
    const at = pos();
    const st = S.state();
    const pass = appearAt !== null && appearAt >= 121 && chaseAt !== null && stateSeq.includes('CHASE') && attacks === 0 && N.deaths() === deaths0 && minDist > 3
      && maxWarp === 1 && offSeen >= 3 && offAhead === 0 && at.level === 1 && Math.hypot(at.x - b.x, at.z - b.z) < 0.1 && st.stage === 5 && N.ai.level !== 'X105';
    return { pass, ran: ok, appearAtZ: appearAt && +appearAt.toFixed(2), chaseAfter_s: chaseAt && +chaseAt.toFixed(2), states: stateSeq, minDist_m: +minDist.toFixed(2), attacks,
      warpMax: maxWarp, lampsOffMax: offSeen, offAheadOfPlayer: offAhead, at, back: { x: b.x, z: b.z }, stage: st.stage, objective: N.hudState().objective, aiLevel: N.ai.level };
  });

  await T('105_5_stop_and_die_retry', async () => {
    await enter105();
    D105().skip('loopDone');
    const d = D105().door('F2R'); d.target = d.angle = 1.45; d.col.disabled = true; d.pv.rotation.y = -1.45;
    const di = D105().door('INV'); di.target = di.angle = 1.45; di.col.disabled = true; di.pv.rotation.y = -1.45;
    await tp('X105', ...W105(2.2, 108.5), Math.PI);
    walkTo(...W105(2.2, 122.5), { run: true });
    const chased = D105().state().chase;
    // 止まる
    let t = 0, attackAt = null;
    for (; t < 20 && !N.deathState(); t += DT) { N.pump(DT, 1, false); if (attackAt === null && N.ai.state === 'ATTACK') attackAt = t; }
    const died = !!N.deathState();
    for (let i = 0; i < 60 * 7 && N.deathState(); i++) N.pump(DT, 1, false);
    const b = SP.def('X105').back;
    const at = pos();
    const yawFace = N.player.object.rotation.y;
    const st = S.state();
    // もう一度入ると追跡の区間の前(R2 の始まり)から
    N.doorApi.open('105'); N.pump(DT, 60, false);
    walkTo(8.4, 15.95, { max: 300, tol: 0.1 });
    waitTrans();
    const re = { level: N.level, at: pos(), run: N.level === 'X105' ? D105().state().run : null };
    const pass = chased && died && attackAt !== null && attackAt < 12 && at.level === 1 && Math.hypot(at.x - b.x, at.z - b.z) < 0.05 && Math.abs(Math.cos(yawFace - (b.yaw + Math.PI)) - 1) < 1e-3
      && st.stage === 4 && N.player.object.rotation.z === 0 && re.level === 'X105' && re.run === 'R2';
    return { pass, chased, died, attackAfterStop_s: attackAt && +attackAt.toFixed(2), respawn: at, back: b, stage: st.stage, reenter: re };
  });

  // ================================================================ 312
  const W312 = (u, v) => [330 + u, v];
  const enter312 = async () => {
    S.applyStage(3); quiet();
    const b = SP.def('X312').back;
    await tp(3, b.x, b.z, b.yaw + Math.PI);
    S.item = '312';
    return openAndEnter('312');
  };
  const st312 = () => D312().state();
  const eyeRel = () => N.camera.position.y + 60;   // SPACE_Y = −60
  const hold = (code, sec, each = null) => { key(code, true); let t = 0; for (; t < sec; t += DT) { N.pump(DT, 1, false); if (each && each(t)) break; } key(code, false); N.pump(DT, 2, false); return t; };

  await T('312_1_passage_pool_swim', async () => {
    const lv = await enter312();
    const obj = N.hudState().objective;
    const walked = walkPath([W312(0.8, 4.0), W312(0.8, 12.6), W312(0.8, 14.2)]);
    const onDeck = { ...st312(), at: pos() };
    walkTo(...W312(0.8, 16.4));
    const shallow = { ...st312(), eye: +eyeRel().toFixed(2) };
    walkTo(...W312(0.8, 21.0), { max: 2000 });
    N.pump(DT, 90, false);
    const deep = { ...st312(), eye: +eyeRel().toFixed(2), move: N.player.move && { ...N.player.move } };
    // 速さ(1 秒 W)
    const z0 = N.player.pos.z; face(...W312(0.8, 40)); key('KeyW', true); key('ShiftLeft', true); N.pump(DT, 60, false); key('KeyW', false); key('ShiftLeft', false); N.pump(DT, 2, false);
    const speed = (N.player.pos.z - z0) / 1.0;
    const pass = lv === 'X312' && obj === '312号室へ' && walked && !onDeck.inWater && onDeck.at.z > 12.5 && shallow.inWater && shallow.eye > 0.2 && deep.inWater && !deep.under
      && Math.abs(deep.eye - (-0.1)) < 0.06 && speed > 0.8 && speed < 1.2 && deep.move && deep.move.noRun;
    return { pass, level: lv, objective: obj, walked, deck: { inWater: onDeck.inWater, at: onDeck.at }, shallowEye: shallow.eye, deepEye: deep.eye, swimSpeed_mps: +speed.toFixed(2), move: deep.move };
  });

  await T('312_2_dive_breath_drown', async () => {
    if (N.level !== 'X312') return { pass: false, why: 'needs 312_1' };
    await tp('X312', ...W312(0.8, 21.0), Math.PI); N.pump(DT, 60, false);
    const b0 = N.hudState().breath;
    let diveAt = null, gauge = null, eyeMin = 1e9;
    hold('ControlLeft', 3.0, (t) => { const s = st312(); if (s.under && diveAt === null) diveAt = t; if (s.under && gauge === null && N.hudState().breath !== null) gauge = N.hudState().breath; eyeMin = Math.min(eyeMin, eyeRel()); return false; });
    const down = { ...st312(), breathHud: N.hudState().breath };
    let upAt = null;
    for (let t = 0; t < 4; t += DT) { N.pump(DT, 1, false); if (!st312().under && upAt === null) upAt = t; }
    const up = { ...st312(), breathHud: N.hudState().breath, eye: +eyeRel().toFixed(2) };
    // 溺れる: 潜ったまま
    const deaths0 = N.deaths();
    let drownAt = null;
    hold('ControlLeft', 30, (t) => { if (N.deathState() && drownAt === null) { drownAt = t; return true; } return false; });
    const caption = document.body.innerText.includes('溺れた');
    for (let i = 0; i < 60 * 7 && N.deathState(); i++) N.pump(DT, 1, false);
    const at = pos();
    const st = S.state();
    const pass = b0 === null && diveAt !== null && gauge !== null && down.under && down.breathHud < 1 && down.breathHud > 0.7 && eyeMin < -1.5 && upAt !== null && !up.under && up.breathHud === null
      && drownAt !== null && drownAt > 14 && drownAt < 20 && caption && N.deaths() === deaths0 + 1 && at.level === 1 && Math.hypot(at.x - 20.9, at.z - 24.6) < 0.05 && st.stage === 3 && N.player.move === null && N.hudState().breath === null;
    return { pass, breathHudBefore: b0, diveAfter_s: diveAt && +diveAt.toFixed(2), gaugeAtDive: gauge, eyeMin: +eyeMin.toFixed(2), afterHold3s: { under: down.under, breath: down.breathHud },
      surfaceAfter_s: upAt && +upAt.toFixed(2), afterRelease: { under: up.under, breathHud: up.breathHud, eye: up.eye }, drownAfter_s: drownAt && +drownAt.toFixed(2), caption, respawn: at, stage: st.stage };
  });

  await T('312_3_stretch_key_reverse_watcher_return', async () => {
    const lv = await enter312();
    walkPath([W312(0.8, 4.0), W312(0.8, 12.6), W312(0.8, 16.4), W312(0.8, 20.0)], { max: 2000 });
    const far0 = st312().farWall - N.player.pos.z;
    walkTo(...W312(0.8, 27.0), { max: 3000 });
    const far1 = st312().farWall - N.player.pos.z;
    const progressed = 7.0;
    // 鍵へ戻って潜る
    walkTo(...W312(0.8, 23.1), { max: 3000 });
    const farBeforeKey = st312().farWall;
    face(...W312(0.8, 23.5), -0.6);
    key('ControlLeft', true);
    let pickHint = '';
    for (let t = 0; t < 4; t += DT) { N.pump(DT, 1, false); face(...W312(0.8, 23.5), -0.9); const h = N.hudState().hint; if (h.includes('拾う')) { pickHint = h; break; } }
    tap('KeyE');
    const st = S.state();
    for (let t = 0; t < 1.5; t += DT) N.pump(DT, 1, false);
    const afterKey = st312();
    key('ControlLeft', false);
    face(...W312(4.8, 23.5), 0);   // 東を向いて浮上(視線の先のプールサイドに管理人)
    let surfaced = null, watch = null, inView = null;
    for (let t = 0; t < 5; t += DT) {
      N.pump(DT, 1, false);
      if (!st312().under && surfaced === null) surfaced = t;
      if (st312().watch && watch === null) {
        watch = st312().watch; N.pump(DT, 1, false);
        const e = N.enemyObj.pos, c = N.camera.position, f = N.camera.getWorldDirection(new N.THREE.Vector3());
        const dx = e.x - c.x, dz = e.z - c.z, L = Math.hypot(dx, dz);
        inView = { angleDeg: +(Math.acos((dx * f.x + dz * f.z) / L / Math.hypot(f.x, f.z)) * 180 / Math.PI).toFixed(1), dist: +L.toFixed(2), visible: N.enemyObj.root.visible };
      }
    }
    const ex = SP.exits('X312');
    const northClosed = !D312().st.colPlugN.disabled && D312().st.plugN.visible && D312().st.colPlugS.disabled;
    // 見ているだけ: 8 秒間 ATTACK/CHASE にならない
    const states = new Set(); const deaths0 = N.deaths();
    for (let t = 0; t < 8; t += DT) { N.pump(DT, 1, false); states.add(N.ai.state); }
    // 北の入口はふさがっている
    // 南の新しい入口から戻る
    walkPath([W312(0.8, 28.6), W312(0.8, 30.4), W312(0.8, 32.8)], { max: 3000 });
    const gone = { watchGone: st312().watchGone, concealed: N.ai.concealed, visible: N.enemyObj.root.visible };
    walkPath([W312(0.8, 38.0), W312(0.8, 43.9)], { max: 3000 });
    waitTrans();
    const b = SP.def('X312').back;
    const at = pos();
    const pass = lv === 'X312' && far0 > 0 && far1 > far0 - 2.0 && (far0 - far1) < progressed * 0.3 && farBeforeKey > 32.5 && pickHint.includes('拾う') && st.stage === 4 && st.item === '105'
      && afterKey.farWall === 32 && afterKey.revealed && surfaced !== null && watch && inView && inView.angleDeg < 35 && inView.dist >= 3 && inView.visible
      && ex.length === 1 && ex[0].z > 43 && northClosed && !states.has('ATTACK') && !states.has('CHASE') && N.deaths() === deaths0 && gone.watchGone && gone.concealed && !gone.visible
      && at.level === 3 && Math.hypot(at.x - b.x, at.z - b.z) < 0.1 && N.ai.level !== 'X312';
    return { pass, level: lv, farDist: { at20: +far0.toFixed(2), at27: +far1.toFixed(2) }, farWallBeforeKey: farBeforeKey, pickHint, stage: st.stage, item: st.item,
      afterKey: { farWall: afterKey.farWall, revealed: afterKey.revealed, under: afterKey.under }, surfaceAfter_s: surfaced && +surfaced.toFixed(2), watch, inView,
      exits: ex.map((e) => ({ x: +e.x.toFixed(2), z: +e.z.toFixed(2) })), northClosed, aiStates: [...states], gone, back: at, aiLevel: N.ai.level };
  });

  // ================================================================ 性能: ?test=building 10 番と同じ計り方(1080p・40 フレームの中央値を 3 回取り最小)。描画コール・三角形数
  await T('P_perf_vs_4F_corridor', async () => {
    const gl = N.renderer.getContext(), px1 = new Uint8Array(4);
    const frameMs = (n = 40, reps = 3) => {
      let best = Infinity;
      for (let r = 0; r < reps; r++) {
        const ts = [];
        for (let i = 0; i < n; i++) { const a = performance.now(); N.step(DT); N.render(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px1); ts.push(performance.now() - a); }
        ts.sort((a, b) => a - b); best = Math.min(best, ts[ts.length >> 1]);
      }
      return +best.toFixed(2);
    };
    const measure = async (setup) => {
      await setup();
      N.setRenderSize(1920, 1080);
      frameMs(30, 1);   // 初めて描く材質のシェーダの用意を済ませる
      const ms = frameMs(40, 5);
      N.render();
      const s = N.stats();
      N.setRenderSize(0);
      const groups = {}; N.scene.traverseVisible((o) => { if (o.isMesh) { let p = o; while (p.parent && p.parent !== N.scene) p = p.parent; groups[p.name || p.type] = (groups[p.name || p.type] || 0) + 1; } });
      return { ms, calls: s.render.calls, triangles: s.render.triangles, level: N.level, groups };
    };
    quiet(); S.applyStage(4);
    const res = {};
    res['4F_corridor'] = await measure(async () => { SP.show(null); await tp(4, 6.9, 8.2, Math.PI); });
    const d105 = async (u, v, yaw, f) => { await enter105(); if (f) f(); await tp('X105', ...W105(u, v), yaw); N.pump(DT, 20, false); };
    res.X105_entry = await measure(() => d105(0, 0.75, Math.PI));
    res.X105_gray = await measure(() => d105(0, 50, Math.PI, () => D105().skip('post')));
    res.X105_chase_warp = await measure(async () => {
      await d105(2.2, 118, Math.PI, () => { D105().skip('loopDone'); const st = D105().st; st.inverted = true; st.rollT = 10; });
      N.player.pos.z = 121.5; N.pump(DT, 200, false); N.player.object.rotation.y = 0;
      N.ai.setState('SCRIPTED', { force: true });   // 計る間に捕まらないよう管理人を止める(歪み・消えた灯りはそのまま)
    });
    quiet(); S.applyStage(3);
    const d312 = async (u, v, yaw, pitch = 0) => { SP.show(null); await enter312(); await tp('X312', ...W312(u, v), yaw); N.player.object.rotation.x = pitch; N.pump(DT, 20, false); };
    res.X312_passage = await measure(() => d312(0.8, 6.5, Math.PI));
    res.X312_hall = await measure(() => d312(0.8, 12.8, Math.PI, -0.1));
    res.X312_underwater = await measure(async () => { await d312(0.8, 22.0, Math.PI); key('ControlLeft', true); N.pump(DT, 150, false); });
    key('ControlLeft', false); N.pump(DT, 2, false);
    quiet(); S.applyStage(4);
    res['4F_corridor_end'] = await measure(async () => { SP.show(null); await tp(4, 6.9, 8.2, Math.PI); });
    const ref = Math.min(res['4F_corridor'].ms, res['4F_corridor_end'].ms);
    const worst = Math.max(...Object.entries(res).filter(([k]) => k[0] === 'X').map(([, v]) => v.ms));
    return { pass: worst <= ref + 0.5, rule: '各空間 ≤ 4F 廊下(最初と最後に計った小さい方)+ 0.5ms(計測のゆれ)。40 フレームの中央値を 5 回取り最小', ref4F: ref, worst, views: res };
  });

  quiet();
  if (SP.shown) SP.show(null);
  S.applyStage(1);
  N.testResult = out;
  show();
  return out;
}
