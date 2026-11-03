// test_xb1.js — P6b-D(DESIGN §3.10 #6 C「潜んでやり過ごす」): 地下の作業場の見回り。http://127.0.0.1:8001/index.html?test=xb1 で自動実行。
// rAF に依存せず window.__N2.pump(dt, n) で本物のループと同じ順に進める。キーは keydown/keyup のペア(e.key と e.code)。結果: window.__N2.testResult。?only=1,5 で絞れる
//  1) hide_still_survive_timeline: キーを取る →「息を潜めろ」→ 陰 A へ歩いて消灯・静止 → 3 秒で鉄扉の音・管理人(演出体)が迷路から近づく(足音)→ 11 秒で作業場へ(画面下「ライトを消して動くな」2.5 秒)
//     → 立ち止まり 2 回(2 回目はフックの 2m 以内で息遣い = 無音)→ 去る → 鉄扉の音 →「鉄扉へ戻れ」。見つからない・死なない。合計 40〜45 秒。本体は 4F へ・1F を 30 秒避ける
//  2) move_found_chase_death_key_back: 作業場で 0.1m 以上動く → found(move)・「みぃつけた」→ 追跡(鉄扉から出られない)→ 捕まって死ぬ → 鉄扉の内側から・キーはフックに戻る(第10段)
//  3) light_found: 陰 B で懐中電灯を点ける → found(light)
//  4) cone_near_found_far_safe: 光の円錐の中で 4m 以内 → found(cone)、円錐の中で 4〜8m は安全、円錐の外(背後)2m は安全
//  5) spots_never_in_cone_all_route: 3 つの陰(中心と ±0.25m)は全経路(0.05 秒刻み)で円錐の 4m 以内に入らない。陰 B・C でも通しで生存
//  6) shadow_floor_luminance: 3 つの陰の床の輝度が、同じ作業場の照らされた床の 1/3 以下
//  7) no_key_no_hunt: キーを取らなければ管理人は来ない(30 秒)
//  8) found_run_caught_before_exit: 見つかってから鉄扉へ走っても捕まる(地下の一本道では逃げ切れない)

const DT = 1 / 60;

export async function run(N) {
  const out = { ok: true, cases: {} };
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:fixed;left:8px;top:8px;z-index:10;color:#9fe39f;background:rgba(0,0,0,.78);font:11px/1.35 monospace;padding:8px;max-width:46vw;max-height:94vh;overflow:auto;white-space:pre-wrap;';
  document.body.appendChild(pre);
  const show = () => { pre.textContent = JSON.stringify(out, null, 1); };
  const ONLY = new URLSearchParams(location.search).get('only');
  const T = async (name, fn) => {
    if (ONLY && !ONLY.split(',').includes(name.split('_')[0])) return;
    try { const r = await fn(); out.cases[name] = r; if (!r.pass) out.ok = false; }
    catch (e) { out.cases[name] = { pass: false, error: String(e && e.stack || e) }; out.ok = false; }
    show();
  };
  N.paused = true;
  const S = N.story, SP = N.spaces;
  const KEYS = { KeyE: 'e', KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd', KeyF: 'f', ShiftLeft: 'Shift' };
  const key = (code, down) => document.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: KEYS[code] || '', bubbles: true }));
  const tap = (code, frames = 3) => { key(code, true); N.pump(DT, frames, false); key(code, false); N.pump(DT, 2, false); };
  const resetKeys = () => { for (const k of Object.keys(KEYS)) key(k, false); };
  const face = (x, z, pitch = 0) => { const p = N.player.pos; N.player.object.rotation.set(pitch, Math.atan2(-(x - p.x), -(z - p.z)), 0, 'YXZ'); N.player.object.updateMatrixWorld(); };
  const walkTo = (x, z, { max = 900, tol = 0.12 } = {}) => {
    key('KeyW', true); let ok = false;
    for (let i = 0; i < max; i++) { const p = N.player.pos; if (Math.hypot(x - p.x, z - p.z) < tol) { ok = true; break; } face(x, z, 0); N.pump(DT, 1, false); }
    key('KeyW', false); N.pump(DT, 1, false);
    return ok;
  };
  const quiet = () => { N.ai.reset(N.ENEMY_HOME.x, N.ENEMY_HOME.z, N.ENEMY_HOME.yaw, 4); N.ai.setState('SCRIPTED', { force: true }); N.enemyObj.place(6.9, 19.5, Math.PI); };
  const D = () => SP.debug('XB1');
  const OX = 520, W = (u, v) => [OX + u, v];
  const pk = () => S.pickups.find((q) => q.id === 'kCar');
  // 第10段・地下の中・ループを抜けた状態で作業場の入口へ
  const intoShop = async (u = 6.0, v = 77.4) => {
    resetKeys();
    if (SP.shown) SP.show(null);
    S.applyStage(10); quiet();
    S.unlockDoor('B1DOOR', { quiet: true }); S.item = null;
    SP.show('XB1'); await N.teleport('XB1', OX - 3.1, 0.8, Math.PI); N.pump(DT, 3, false);
    D().release('test_xb1');
    await N.teleport('XB1', ...W(u, v), Math.PI); N.pump(DT, 10, false);
    N.setFlashlight(false); N.pump(DT, 2, false);
  };
  const takeKey = () => {
    const k = pk(); walkTo(k.pos.x, k.pos.z - 0.8);
    face(k.pos.x, k.pos.z, -0.6); N.pump(DT, 2, false);
    const hint = N.hudState().hint; tap('KeyE');
    return hint;
  };
  const spot = (id) => D().spots().find((q) => q.id === id);
  const hunt = () => D().hunt();
  const pumpUntil = (pred, sec, each = null) => { for (let i = 0; i < sec * 60; i++) { N.pump(DT, 1, false); if (each) each(); if (pred()) return true; } return false; };

  // ---------------------------------------------------------------- 1) 陰で消灯・静止 → やり過ごす(時系列の実測)
  await T('1_hide_still_survive_timeline', async () => {
    await intoShop();
    const n0 = N.enemyAudio.logCount || 0, b0 = N.bank.n, deaths0 = N.deaths();
    const hint = takeKey();
    const objKey = (N.pump(DT, 1, false), N.hudState().objective);
    const A = spot('A');
    walkTo(...W(3.05, 81.3)); walkTo(A.x, A.z);   // 陰 A(棚の裏)へ: 棚の北の端を回る
    N.setFlashlight(false);
    const tAt = hunt().t;
    const obs = { whisperAt: null, whisperText: null, whisperEnd: null, objDuring: new Set(), stepsBeforeShop: 0, aiXB1: false, lightOn: false, maxEnemyZ: -1e9, enemyInShop: false };
    const enter = () => { const h = hunt(); return h && h.inShop; };
    pumpUntil(() => { const h = hunt(); return !h || ['done', 'found', 'aborted'].includes(h.phase); }, 60, () => {
      const h = hunt(), hs = N.hudState();
      if (hs.whisper && obs.whisperAt === null) { obs.whisperAt = h.t; obs.whisperText = hs.whisper; }
      if (obs.whisperAt !== null && !hs.whisper && obs.whisperEnd === null) obs.whisperEnd = h.t;
      obs.objDuring.add(hs.objective);
      if (N.ai.level === 'XB1') obs.aiXB1 = true;
      if (N.enemyObj.flashlight.on && N.ai.level === 'XB1') obs.lightOn = true;
      if (N.ai.level === 'XB1') { obs.maxEnemyZ = Math.max(obs.maxEnemyZ, N.enemyObj.pos.z); if (N.enemyObj.pos.z > 76.2) obs.enemyInShop = true; }
      void enter;
    });
    const h = hunt();
    N.pump(DT, 2, false);
    const objAfter = N.hudState().objective;
    const ev = (name) => (h.log.find((l) => l.ev === name) || {}).t ?? null;
    const doors = h.log.filter((l) => l.ev === 'steel_door').map((l) => l.t);
    const ea = N.enemyAudio.log.filter((l) => l.n > n0);
    const steps = ea.filter((l) => l.name === 'step').length, crash = ea.filter((l) => l.name === 'crash').length, say = ea.filter((l) => l.name === 'breath').length;
    const breath = h.log.find((l) => l.ev === 'breath');
    const T0 = { door1: doors[0], appear: ev('appear'), enterShop: ev('enter_shop'), breath: breath ? breath.t : null, done: ev('done'), door2: doors[1] };
    const TL = D().timeline();
    const avoid = N.ai.avoid ? { lv: N.ai.avoid.lv, left: +(N.ai.avoid.until - N.ai.time).toFixed(1) } : null;
    const pass = hint.includes('拾う') && objKey === '息を潜めろ' && h.phase === 'done' && !h.why && N.deaths() === deaths0
      && Math.abs(T0.door1 - 3.0) < 0.05 && Math.abs(T0.appear - 3.0) < 0.05 && T0.enterShop > 10.5 && T0.enterShop < 11.6 && T0.breath !== null && breath.dHook <= 2.0
      && T0.done >= 40 && T0.done <= 45 && Math.abs(T0.door2 - T0.done) < 0.05 && crash === 2 && steps >= 6 && say === 0
      && obs.whisperText === 'ライトを消して動くな' && Math.abs(obs.whisperAt - T0.enterShop) < 0.05 && obs.whisperEnd !== null && Math.abs(obs.whisperEnd - obs.whisperAt - 2.5) < 0.1
      && [...obs.objDuring].every((o) => o === '息を潜めろ') && objAfter === '鉄扉へ戻れ' && obs.aiXB1 && obs.lightOn && obs.enemyInShop
      && N.ai.level === 4 && avoid && avoid.lv === 1 && avoid.left > 29;
    void b0; void tAt;
    return { pass, hint, objKey, timeline_s: T0, planned: TL, hookDist: breath && breath.dHook, steps, crash, foundVoice: say, whisper: { text: obs.whisperText, at: obs.whisperAt, end: obs.whisperEnd },
      objectives: [...obs.objDuring], objAfter, aiAfter: { level: N.ai.level, state: N.ai.state, avoid }, enemyInShop: obs.enemyInShop, maxEnemyV: +obs.maxEnemyZ.toFixed(2), log: h.log };
  });

  // ---------------------------------------------------------------- 2) 動く → found → 追跡 → 死亡 → 鉄扉の内側・キーはフックへ
  await T('2_move_found_chase_death_key_back', async () => {
    await intoShop();
    const n0 = N.enemyAudio.logCount || 0, deaths0 = N.deaths();
    takeKey();
    const A = spot('A'); walkTo(...W(3.05, 81.3)); walkTo(A.x, A.z); N.setFlashlight(false);
    pumpUntil(() => hunt().inShop, 20);
    N.pump(DT, 30, false);
    const tMove = hunt().t;
    walkTo(A.x, A.z + 0.4, { max: 60, tol: 0.05 });   // 0.4m 動く
    pumpUntil(() => hunt().phase === 'found', 2);
    const h1 = hunt();
    const exitsWhileFound = SP.exits('XB1').length;
    let chased = false, attack = false, dead = false, respawned = false;
    pumpUntil(() => respawned && !N.deathState(), 40, () => {
      if (N.ai.state === 'CHASE') chased = true;
      if (N.ai.state === 'ATTACK') attack = true;
      const ds = N.deathState(); if (ds) { dead = true; if (ds.respawned) respawned = true; }
      // その場で立ちすくむ(逃げても追いつかれる速さ 4.2 m/s。鉄扉からは出られない)
    });
    resetKeys(); N.pump(DT, 30, false);
    const say = N.enemyAudio.log.filter((l) => l.n > n0 && l.name === 'breath').length;
    const st = S.state();
    const E = SP.def('XB1').entry;
    const at = { level: N.level, x: +N.player.pos.x.toFixed(2), z: +N.player.pos.z.toFixed(2) };
    const keyBack = !st.taken.includes('kCar') && pk().mesh.visible;
    const pickable = (() => { const k = pk(); return !S.taken.has('kCar'); })();
    const pass = h1.phase === 'found' && h1.why === 'move' && say === 1 && exitsWhileFound === 0 && chased && attack && dead && N.deaths() === deaths0 + 1
      && at.level === 'XB1' && Math.hypot(at.x - E.x, at.z - E.z) < 0.05 && st.stage === 10 && st.item === null && keyBack && pickable && N.hudState().objective === '奥の作業場で車のキーを探せ' && hunt() === null;
    return { pass, foundAt: h1.t, moveAt: tMove, why: h1.why, foundVoice: say, exitsWhileFound, chased, attack, dead, respawn: at, entry: { x: E.x, z: E.z }, stage: st.stage, item: st.item, keyBack, objective: N.hudState().objective, log: h1.log };
  });

  // ---------------------------------------------------------------- 3) 陰で懐中電灯を点ける → found(light)
  await T('3_light_found', async () => {
    await intoShop();
    takeKey();
    const B = spot('B'); walkTo(...W(7.6, 82.3)); walkTo(B.x, B.z); N.setFlashlight(false);
    pumpUntil(() => hunt().inShop, 20);
    N.pump(DT, 20, false);
    const before = hunt().phase;
    N.setFlashlight(true);
    pumpUntil(() => hunt().phase === 'found', 1);
    const h = hunt();
    // 後片付け: 管理人を止めて死ぬ前に戻す
    resetKeys(); N.setFlashlight(false); quiet(); if (SP.shown) SP.show(null);
    const pass = before === 'sweep' && h.phase === 'found' && h.why === 'light';
    return { pass, before, phase: h.phase, why: h.why, t: h.t };
  });

  // ---------------------------------------------------------------- 4) 円錐の 4m 以内で found・4〜8m は安全・背後は安全
  await T('4_cone_near_found_far_safe', async () => {
    const TL = D().timeline();
    const segStop1 = TL.tSweep + Math.hypot(5.6 - 6.0, 79.2 - 76.6) / 1.0;   // 1 回目の立ち止まりの始まり(光は北)
    const res = {};
    const trial = async (label, u, v, t0 = segStop1 + 0.02, sec = 0.5) => {
      await intoShop(u, v);
      D().startHunt(t0 - 0.3);   // 作業場の中で始める(入った瞬間の立ち位置を覚える)
      N.setFlashlight(false); resetKeys();
      // 作業場に入っている時刻なので、最初のフレームで立ち位置を覚える
      pumpUntil(() => hunt().phase === 'found', sec + 0.3);
      const h = hunt(), P = D().huntPose(t0);
      const c = D().coneSees(P, u, v);
      res[label] = { phase: h.phase, why: h.why || null, dist: +c.dist.toFixed(2), angDeg: +(c.ang * 180 / Math.PI).toFixed(1), inCone: c.inCone, los: c.los };
      quiet(); if (SP.shown) SP.show(null);
    };
    await trial('near_in_cone_3m', 5.6, 82.2);        // 北 3m(光の正面)
    await trial('mid_in_cone_4_6m', 5.6, 83.8);       // 北 4.6m(円錐の中・4m より遠い)
    await trial('behind_2m', 5.6, 77.2);              // 南 2m(背後 = 円錐の外)
    const far = D().coneSees({ u: 0, v: 0, aim: 0 }, 0, 8.6);   // 8m より遠い(円錐の長さの外)
    const pass = res.near_in_cone_3m.phase === 'found' && res.near_in_cone_3m.why === 'cone'
      && res.mid_in_cone_4_6m.phase !== 'found' && res.mid_in_cone_4_6m.inCone && res.mid_in_cone_4_6m.los
      && res.behind_2m.phase !== 'found' && !res.behind_2m.inCone && !far.inCone && !far.seen;
    return { pass, trials: res, far8_6m: far };
  });

  // ---------------------------------------------------------------- 5) 3 つの陰は全経路で円錐の 4m 以内に入らない(時刻表)・陰 B・C で通して生存
  await T('5_spots_never_in_cone_all_route', async () => {
    const sv = D().spotsVsRoute(0.05, 0.25);
    const live = {};
    for (const id of ['B', 'C']) {
      await intoShop();
      const deaths0 = N.deaths();
      takeKey();
      const P = spot(id);
      if (id === 'B') walkTo(...W(7.6, 82.3));
      if (id === 'C') { walkTo(...W(7.5, 79.35)); walkTo(...W(8.1, 79.0)); }
      walkTo(P.x, P.z); N.setFlashlight(false);
      const at = { u: +(N.player.pos.x - OX).toFixed(2), v: +N.player.pos.z.toFixed(2) };
      pumpUntil(() => ['done', 'found'].includes(hunt().phase), 60);
      live[id] = { phase: hunt().phase, why: hunt().why, at, died: N.deaths() !== deaths0 };
      quiet(); if (SP.shown) SP.show(null);
    }
    const pass = ['A', 'B', 'C'].every((k) => sv[k].hits === 0) && Object.values(live).every((r) => r.phase === 'done' && !r.died && Math.hypot(r.at.u - spot(Object.keys(live).find((k) => live[k] === r)).u, r.at.v - spot(Object.keys(live).find((k) => live[k] === r)).v) < 0.2);
    return { pass, route: sv, live };
  });

  // ---------------------------------------------------------------- 6) 陰の床の輝度(画面の画素)が照らされた床の 1/3 以下
  await T('6_shadow_floor_luminance', async () => {
    await intoShop();
    const gl = N.renderer.getContext(), Wd = gl.drawingBufferWidth, Hd = gl.drawingBufferHeight, R = 16, px = new Uint8Array(4 * R * R);
    const lumAt = (wx, wy, wz) => {
      const q = new N.THREE.Vector3(wx, wy, wz).project(N.camera);
      const x = Math.floor((q.x * 0.5 + 0.5) * Wd) - R / 2, y = Math.floor((q.y * 0.5 + 0.5) * Hd) - R / 2;
      gl.readPixels(Math.max(0, Math.min(Wd - R, x)), Math.max(0, Math.min(Hd - R, y)), R, R, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let s = 0; for (let i = 0; i < px.length; i += 4) s += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      return { L: +(s / (R * R)).toFixed(1), ndc: [+q.x.toFixed(2), +q.y.toFixed(2)] };
    };
    const look = async (u, v, tu, tv) => {
      await N.teleport('XB1', ...W(u, v), 0); N.pump(DT, 2, false);
      const yaw = Math.atan2(-(tu - u), -(tv - v)), pitch = Math.atan2(-1.6, Math.hypot(tu - u, tv - v));
      N.setView(...W(u, v), yaw, pitch); N.setFlashlight(false); N.pump(DT, 3, false); N.pump(DT, 1, true);
    };
    const floorY = N.player.pos.y + 0.0;
    const res = {};
    // 照らされた床(電球の下の南): 同じ距離感で
    await look(5.4, 78.2, 5.4, 79.8); res.lit = lumAt(...W(5.4, 79.8).slice(0, 1), floorY, 79.8);
    const views = { A: [3.0, 81.9], B: [7.95, 82.45], C: [8.05, 79.6] };
    for (const id of ['A', 'B', 'C']) { const P = spot(id); await look(...views[id], P.u, P.v); res[id] = lumAt(P.x, floorY + 0.01, P.z); }
    const pass = res.lit.L > 10 && ['A', 'B', 'C'].every((k) => res[k].L <= res.lit.L / 3 && Math.abs(res[k].ndc[0]) < 0.9 && Math.abs(res[k].ndc[1]) < 0.9);
    return { pass, luminance: res, ratio: Object.fromEntries(['A', 'B', 'C'].map((k) => [k, +(res[k].L / res.lit.L).toFixed(3)])) };
  });

  // ---------------------------------------------------------------- 8) 見つかってから鉄扉へ走っても逃げ切れない(作業場の入口のそばで見つかり、迷路の一本道を走る)
  await T('8_found_run_caught_before_exit', async () => {
    await intoShop(6.6, 77.6);
    const deaths0 = N.deaths();
    D().startHunt(10.2);   // 管理人が入口に来る直前(この位置は入る時に円錐の正面)
    let foundAt = null, deadAt = null, maxRunV = 1e9, leftSpace = false;
    const route = [W(6, 76.0), W(6, 75), W(2, 75), W(2, 63), W(0, 63), W(0, 53), W(0, 50.5), W(0, 6), W(-1.6, 6), W(-3.1, 4), W(-3.1, 0.1)];
    let wi = 0;
    pumpUntil(() => deadAt !== null || leftSpace, 40, () => {
      const h = hunt(); if (h && h.phase === 'found' && foundAt === null) foundAt = h.t;
      if (N.level !== 'XB1') leftSpace = true;
      if (N.deathState()) { if (deadAt === null) deadAt = h ? h.t : -1; key('KeyW', false); key('ShiftLeft', false); return; }
      if (foundAt !== null && !N.player.frozen) {
        const p = N.player.pos; while (wi < route.length - 1 && Math.hypot(route[wi][0] - p.x, route[wi][1] - p.z) < 0.35) wi++;
        key('KeyW', true); key('ShiftLeft', true); face(...route[wi]); maxRunV = Math.min(maxRunV, p.z);
      }
    });
    resetKeys();
    for (let i = 0; i < 60 * 8 && N.deathState(); i++) N.pump(DT, 1, false);
    const pass = foundAt !== null && deadAt !== null && !leftSpace && N.deaths() === deaths0 + 1;
    return { pass, foundAt, deadAt, caughtAfter_s: deadAt !== null && foundAt !== null ? +(deadAt - foundAt).toFixed(2) : null, reachedV: +maxRunV.toFixed(1), leftSpace };
  });

  // ---------------------------------------------------------------- 7) キーを取らなければ管理人は来ない
  await T('7_no_key_no_hunt', async () => {
    await intoShop();
    pumpUntil(() => false, 30);
    const pass = hunt() === null && N.ai.level !== 'XB1';
    return { pass, hunt: hunt(), aiLevel: N.ai.level };
  });

  resetKeys();
  quiet();
  if (SP.shown) SP.show(null);
  S.applyStage(1);
  N.setFlashlight(false);
  N.testResult = out;
  show();
  return out;
}
