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
//  P) 性能: 各空間の代表の視点と 4F の廊下を同じ計り方(1080p・40 フレームの中央値の 3 回の最小)で。描画コール・三角形数

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

  quiet();
  if (SP.shown) SP.show(null);
  S.applyStage(1);
  N.testResult = out;
  show();
  return out;
}
