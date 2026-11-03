// test_x105.js — P6b-A(DESIGN §3.9 #15): 105 の追跡の前倒しと登場の分かりやすさ。http://localhost:8001/?test=x105 で自動実行。
// rAF に依存せず window.__N2.pump(dt, n) で本物のループと同じ順に進める(test_spaces.js と同じ作り)。結果: window.__N2.testResult
//  1) chase_at_72_viewlock_escape: F1 を抜けて R1 の v 72 → 同じフレームで背後 8m に落下音(room_fall 音量 1.0)・管理人(R0 の (0, 64)、F1 の右の扉は開け放し)・悲鳴 →
//     視点を管理人へ 1.5 秒固定(固定中は管理人が 1.1 m/s で歩く・距離 ≥5m・操作できない)→ 0.6 秒で前へ戻る → 追跡。折り返しは使わない(F2 の左は施錠・右は開いている)
//     → 反転の扉 → R3 → F3 → R4 → 出口まで走って生存(ATTACK 0・死亡 0)・105 の扉の前・第5段。管理人は反転の扉を通って追ってくる
//  2) nav_chain_r0_to_r4: 管理人の経路が R0 → F1 の右 → R1 → F2 の右 → R2 → 反転の扉 → R3 → F3 の右 → R4 を通る(扉の口の点)
//  3) stop_die_retry_from_r1: 追跡で止まると捕まる → 105 の扉の前 → もう一度入ると R1 の始まり(追跡の区間の前)から、v 72 でまた追跡が始まる

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
  const key = (code, down) => document.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code === 'KeyE' ? 'e' : code === 'KeyW' ? 'w' : code === 'ShiftLeft' ? 'Shift' : '', bubbles: true }));
  const tap = (code, frames = 3) => { key(code, true); N.pump(DT, frames, false); key(code, false); N.pump(DT, 2, false); };
  const pos = () => ({ x: +N.player.pos.x.toFixed(2), z: +N.player.pos.z.toFixed(2), level: N.level });
  const face = (x, z, pitch = 0) => { const p = N.player.pos; N.player.object.rotation.set(pitch, Math.atan2(-(x - p.x), -(z - p.z)), N.player.object.rotation.z, 'YXZ'); N.player.object.updateMatrixWorld(); };
  // 歩く/走る。凍結中(視点固定)は向きを触らない。each(i) が真で止める
  const walkTo = (x, z, { max = 1600, tol = 0.14, run = false, each = null } = {}) => {
    key('KeyW', true); if (run) key('ShiftLeft', true);
    let ok = false, stopped = false, still = 0, last = null;
    for (let i = 0; i < max; i++) {
      const p = N.player.pos;
      if (Math.hypot(x - p.x, z - p.z) < tol) { ok = true; break; }
      if (!N.player.frozen) face(x, z, 0);
      N.pump(DT, 1, false);
      if (each && each(i)) { stopped = true; break; }
      if (S.trans) { ok = true; break; }
      if (!N.player.frozen && last && Math.hypot(p.x - last.x, p.z - last.z) < 1e-4) { if (++still > 30) break; } else still = 0;
      last = { x: p.x, z: p.z };
    }
    key('KeyW', false); if (run) key('ShiftLeft', false); N.pump(DT, 1, false);
    return ok || stopped;
  };
  const walkPath = (pts, o = {}) => pts.every(([x, z]) => walkTo(x, z, { tol: 0.2, ...o }));
  const waitTrans = () => { for (let i = 0; i < 120 && S.trans; i++) N.pump(DT, 1, false); N.pump(DT, 4, false); };
  const quiet = () => { N.ai.reset(N.ENEMY_HOME.x, N.ENEMY_HOME.z, N.ENEMY_HOME.yaw, 4); N.ai.setState('SCRIPTED', { force: true }); N.enemyObj.place(6.9, 19.5, Math.PI); };
  const tp = async (lv, x, z, yaw) => { if (typeof lv === 'string' && lv[0] === 'X') SP.show(lv); await N.teleport(lv, x, z, yaw); if (!(typeof lv === 'string' && lv[0] === 'X')) await N.world.focus(lv); N.pump(DT, 30, false); };
  const useE = () => { N.pump(DT, 2, false); const h = N.hudState(); tap('KeyE'); N.pump(DT, 2, false); return { hint: h.hint, toast: N.hudState().toast }; };
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
  const W = (u, v) => [300 + u, v];
  const enter105 = async () => {
    S.applyStage(3); quiet();   // P6b-C(§3.10 #1): 105 は第3段
    const b = SP.def('X105').back;
    await tp(1, b.x, b.z, b.yaw + Math.PI);
    return openAndEnter('105');
  };
  const C = () => D105().X105.chase;
  const dist = () => Math.hypot(N.enemyObj.pos.x - N.player.pos.x, N.enemyObj.pos.z - N.player.pos.z);
  const aimErr = () => { const f = N.camera.getWorldDirection(new N.THREE.Vector3()); const h = N.enemyObj.headWorld(new N.THREE.Vector3()).sub(N.camera.position).normalize(); return f.angleTo(h); };

  // ================================================================ 1
  await T('1_chase_at_72_viewlock_escape', async () => {
    const lv = await enter105();
    D105().skip('post');
    await tp('X105', ...W(0, 66), Math.PI);
    // F1: 右の扉を開けて R1 へ
    walkPath([W(0, 68.4), W(1.1, 69.1)]); face(...W(1.1, 70)); const f1R = useE(); N.pump(DT, 50, false);
    const deaths0 = N.deaths(), vl0 = N.viewLock.log.length, b0 = N.bank.n || 0, ev0 = N.ai.time;
    let trig = null, lock = null, fwd0 = null;
    const L = { frames: [], minDist: 1e9, aimMax: 0, aimFrames: 0, moved: 0, states: new Set(), frozenAll: true };
    // R1 を歩いて v 72 を越える(発火まで。発火後は凍結されて動けない)
    walkTo(...W(1.1, 75), { each: () => {
      const s = D105().state();
      if (s.chase && !trig) {
        fwd0 = N.camera.getWorldDirection(new N.THREE.Vector3());   // 固定が始まる前の向き(戻った後と比べる)
        N.pump(DT, 1, false);   // 管理人が現れるのは次の AI の更新(空間の更新は AI の後)。1 フレーム進めて測る
        const e = N.enemyObj.pos;
        trig = { v: +N.player.pos.z.toFixed(3), run: s.run, ePos: [+(e.x - 300).toFixed(2), +e.z.toFixed(2)], dist: +dist().toFixed(2), aiState: N.ai.state, aiLevel: N.ai.level,
          f1R: D105().door('F1R').angle, f2L: D105().door('F2L').locked, f2R: { locked: D105().door('F2R').locked, angle: D105().door('F2R').angle }, loopDone: s.loopDone };
        return true;
      }
      return false;
    } });
    const bankSince = (N.bank.log || []).filter((l) => l.n > b0);
    const fall = bankSince.filter((l) => l.id === 'room_fall'), scream = bankSince.filter((l) => l.id === 'x105_scream');
    // 視点固定: 発火から毎フレーム(手放しで止まっている)。管理人への向きの誤差・距離・管理人の歩き
    let t = 0, holdUntil = null, endAt = null, ep = { x: N.enemyObj.pos.x, z: N.enemyObj.pos.z };
    for (let i = 0; i < Math.round(3.0 / DT); i++) {
      N.pump(DT, 1, false); t += DT;
      if (N.viewLock.active) {
        if (!N.player.frozen) L.frozenAll = false;
        L.minDist = Math.min(L.minDist, dist());
        L.states.add(N.ai.state);
        const a = aimErr();
        if (t >= 0.3) { if (a < 0.12) { L.aimFrames++; holdUntil = t; } }
        if (t >= 0.3 && t <= 1.45) L.aimMax = Math.max(L.aimMax, a);
        L.moved = Math.hypot(N.enemyObj.pos.x - ep.x, N.enemyObj.pos.z - ep.z);
      } else if (endAt === null && t > 0.1) endAt = t;
      if (endAt !== null && t > endAt + 0.2) break;
    }
    const vlog = N.viewLock.log.slice(vl0);
    const st0 = vlog.find((l) => l.ev === 'start'), en = vlog.find((l) => l.ev === 'end');
    const fwdBack = N.camera.getWorldDirection(new N.THREE.Vector3()).angleTo(fwd0);
    lock = { label: st0 && st0.label, total: st0 && st0.total, end: en && en.t, activeFor_s: endAt && +endAt.toFixed(3), aimedUntil_s: holdUntil && +holdUntil.toFixed(3), aimMaxDuringHold_rad: +L.aimMax.toFixed(3),
      minDist_m: +L.minDist.toFixed(2), enemyWalked_m: +L.moved.toFixed(2), enemySpeed: +(L.moved / Math.max(endAt || 1, 1e-3)).toFixed(2), states: [...L.states], frozenAll: L.frozenAll, forwardBackErr_rad: +fwdBack.toFixed(3), stateAfter: N.ai.state };
    // 追跡: 走る。R1 → F2 の右(開いている)→ R2 → 反転の扉(E)→ R3 → F3 の右 → R4 → 出口
    let attacks = 0, minRun = 1e9, maxEZ = -1e9, eRuns = new Set(), maxWarp = 0, offSeen = 0, offAhead = 0, rollMax = 0;
    const each = () => {
      if (N.ai.state === 'ATTACK') attacks++;
      if (N.ai.level === 'X105') { minRun = Math.min(minRun, dist()); maxEZ = Math.max(maxEZ, N.enemyObj.pos.z); eRuns.add(D105().state && runOf(N.enemyObj.pos.x, N.enemyObj.pos.z)); }
      const s = D105().state(); maxWarp = Math.max(maxWarp, s.warp); rollMax = Math.max(rollMax, s.roll);
      const lo = D105().lampsOff(); offSeen = Math.max(offSeen, lo.off); if (lo.offZ !== undefined && lo.offZ !== null && lo.offZ > N.player.pos.z) offAhead++;
      return N.level !== 'X105' || !!N.deathState();
    };
    const runOf = (x, z) => { const u = x - 300; const R = D105().RUNS; let best = null, bd = 1e9; for (const r of R) { if (r.id === 'RL') continue; const dx = Math.max(0, Math.abs(u - r.xc) - 0.8), dz = Math.max(0, r.z0 - z, z - r.z1); const d = dx + dz * 4; if (d < bd) { bd = d; best = r.id; } } return best; };
    const ok1 = walkPath([W(1.1, 93.6), W(2.2, 95.3), W(2.2, 97.0), W(2.2, 109.1)], { run: true, each });
    face(...W(2.2, 110)); const inv = useE();
    const ok2 = walkPath([W(2.2, 111.0), W(2.2, 137.6), W(3.3, 139.2), W(3.3, 141.0), W(3.3, 166.5)], { run: true, each });
    waitTrans();
    const b = SP.def('X105').back, at = pos(), st = S.state();
    const evs = N.ai.events.filter((e) => e.t >= ev0);
    const pass = lv === 'X105' && f1R.hint.includes('開ける') && trig && trig.v >= 72 && trig.v < 72.2 && trig.run === 'R1' && trig.aiState === 'APPEAR'
      && Math.abs(trig.ePos[0] - 0) < 0.01 && Math.abs(trig.ePos[1] - 64) < 0.05 && trig.dist >= 7.9 && trig.f1R > 1.2 && trig.f2L && !trig.f2R.locked && trig.f2R.angle > 1 && trig.loopDone
      && fall.length === 1 && fall[0].vol === 1 && Math.hypot(fall[0].pos[0] - 300, fall[0].pos[2] - 64) < 0.01 && scream.length === 1
      && lock.label === 'appear_105' && Math.abs(lock.total - 2.1) < 1e-6 && Math.abs(lock.end - 2.1) < 0.04 && lock.aimedUntil_s >= 1.45 && lock.aimedUntil_s <= 1.62 && lock.aimMaxDuringHold_rad < 0.12
      && lock.minDist_m >= 5 && lock.enemySpeed > 0.9 && lock.enemySpeed < 1.2 && lock.frozenAll && lock.forwardBackErr_rad < 0.02 && lock.stateAfter === 'CHASE'
      && ok1 && inv.hint.includes('開ける') && ok2 && attacks === 0 && N.deaths() === deaths0 && at.level === 1 && Math.hypot(at.x - b.x, at.z - b.z) < 0.1 && st.stage === 4
      && maxEZ > 112 && eRuns.has('R3') && maxWarp === 1 && Math.abs(rollMax - Math.PI) < 1e-3 && offSeen >= 3 && offAhead === 0 && !evs.some((e) => e.ev === 'stuck');
    return { pass, level: lv, f1R, trigger: trig, sounds: { fall: fall.map((l) => ({ vol: l.vol, pos: l.pos })), scream: scream.length }, viewLock: lock,
      escape: { ran: ok1 && ok2, invDoor: inv.hint, attacks, deaths: N.deaths() - deaths0, minDistWhileRunning_m: +minRun.toFixed(2), enemyMaxZ: +maxEZ.toFixed(1), enemyRuns: [...eRuns], warpMax: maxWarp, rollMax: +rollMax.toFixed(4), lampsOff: offSeen, offAheadOfPlayer: offAhead },
      at, back: { x: b.x, z: b.z }, stage: st.stage, stuck: evs.filter((e) => e.ev === 'stuck').length };
  });

  // ================================================================ 2
  await T('2_nav_chain_r0_to_r4', async () => {
    if (N.level !== 'X105') await enter105();
    D105().skip('post');   // R0 が伸び終わった後(終わりは 70)
    const path = N.ai.spaceNav('X105', 300, 64, 303.3, 160);
    const near = (u, v) => path.some((p) => Math.hypot(p.x - (300 + u), p.z - v) < 1.2);
    const doors = { F1R: near(1.1, 70), F2R: near(2.2, 96), INV: near(2.2, 110), F3R: near(3.3, 140) };
    const pass = Object.values(doors).every(Boolean) && path.length >= 8;
    return { pass, doors, points: path.map((p) => [+(p.x - 300).toFixed(2), +p.z.toFixed(2)]) };
  });

  // ================================================================ 3
  await T('3_stop_die_retry_from_r1', async () => {
    await enter105();
    D105().skip('post');
    await tp('X105', ...W(1.1, 70.9), Math.PI);
    walkTo(...W(1.1, 73));
    const chased = D105().state().chase;
    let t = 0, attackAt = null;
    for (; t < 25 && !N.deathState(); t += DT) { N.pump(DT, 1, false); if (attackAt === null && N.ai.state === 'ATTACK') attackAt = t; }
    const died = !!N.deathState();
    for (let i = 0; i < 60 * 7 && N.deathState(); i++) N.pump(DT, 1, false);
    const b = SP.def('X105').back, at = pos();
    N.doorApi.open('105'); N.pump(DT, 60, false);
    walkTo(8.4, 15.95, { max: 300, tol: 0.1 });
    waitTrans();
    const re = { level: N.level, at: pos(), run: N.level === 'X105' ? D105().state().run : null };
    let again = false;
    if (N.level === 'X105') walkTo(...W(1.1, 73), { each: () => { again = D105().state().chase; return again; } });
    for (let i = 0; i < 400 && !N.deathState() && N.viewLock.active; i++) N.pump(DT, 1, false);
    const pass = chased && died && attackAt !== null && at.level === 1 && Math.hypot(at.x - b.x, at.z - b.z) < 0.05 && re.level === 'X105' && re.run === 'R1' && Math.abs(re.at.z - 70.75) < 0.05 && again;
    return { pass, chased, died, attackAfter_s: attackAt && +attackAt.toFixed(2), respawn: at, reenter: re, chaseAgain: again };
  });

  // 片付け: 建物へ戻す(製品の初期状態)
  if (N.level === 'X105') { const b = SP.def('X105').back; SP.show(null); await N.teleport(1, b.x, b.z, b.yaw + Math.PI); }
  for (let i = 0; i < 400 && N.deathState(); i++) N.pump(DT, 1, false);
  quiet();
  N.render();
  N.testResult = out;
  console.log('[test_x105]', JSON.stringify(out));
  return out;
}
