// test_audio.js — P4b 音の本実装(P4c で 3 周目を反映)の決定的テスト(ブラウザ内)。http://127.0.0.1:8001/index.html?test=audio で自動実行。結果: window.__N2.testResult
// rAF に依存せず window.__N2.pump(dt, n) で本物のループと同じ順に進める。AudioContext が止まっていても(ユーザー操作なし)、
// AudioBank は「鳴らそうとした場面」を count / log に残すので、ゲームの出来事 → 再生 API の接続を確かめられる。
//  0) 読み込み: manifest の採用 21 場面の wav がすべて読めて長さが合う・声の場面 2 つ(素材＋加工)の音量合わせができる・なし 39／3 周目 9(新 312)／未選択 1 の振り分け
//  1) なし = 無音: 開かない扉・取っ手・空室の扉・鍵を使う・車のドア・偽の鍵・窓・ロッカーの予兆・EV の扉・705 の空気・B1 の扉の音は AudioBank に行かない(記録だけ)。
//     P4c: 3 周目でなしになった 叫び(scream)・目の前の息(breath)・ガタガタ扉(slam)・ロッカーの軋み(lockerCreak)も同じ。合成の仮音が残っていない
//  2) 居室: 自分の足音(pl_step_room)・クローゼットの開け閉め(pl_closet の open/close 区間)・落ちる物(room_fall の割れ物/本の区間)
//  3) 環境音: 廊下(amb_corridor)・敷地(amb_outdoor)・屋上B(amb_roof)・地下(amb_b1)。居室・1F ロビーでは鳴らない。離れると止まる(鳴りっぱなしにしない)
//  4) EV: 走行音(ev_motor)→ 到着チャイム(ev_chime)→ 止まって数秒で走行音の音源が止まる(P4a の申し送り)
//  5) 管理人: 巡回の歩き(enemy_step_walk。P4c)・追跡の足音(enemy_step_run)・扉の向こうの声(enemy_breath_door)・扉を破る(enemy_door_smash)→ 一撃(enemy_hit)→ 死亡(death)
//  6) 物語: 221 の電話(story_221_lure)・メモ(pickup_paper)・鍵(pickup_key)
//  7) 105: 空気(amb_x105)・追跡の始まりの悲鳴(x105_scream)
//  8) 705: 鍵で灯りが消える(x705_lights_off)
//  9) エンディング: エンジン(car_engine)→ 門を抜ける(ending_gate)
//  10) まとめ: 採用 23 場面すべてが 1 回以上呼ばれ、採用以外の場面(なしの 39 場面を含む)は 1 回も呼ばれていない
const DT = 1 / 60;
const ADOPTED = ['pl_step_room', 'amb_corridor', 'pl_closet', 'room_fall', 'ev_chime', 'ev_motor', 'enemy_step_run', 'enemy_breath_door', 'enemy_door_smash', 'enemy_hit',
  'death', 'story_221_lure', 'pickup_key', 'pickup_paper', 'amb_x105', 'x105_scream', 'amb_outdoor', 'amb_roof', 'x705_lights_off', 'amb_b1', 'car_engine', 'ending_gate',
  'enemy_step_walk'];   // P4c: 3 周目 A
// P4c: 3 周目でなしになった 8 場面(room_door_rattle は演出ごと廃止 = なし扱い)
const R3_NONE = ['pl_flashlight', 'door_wood', 'enemy_presence', 'enemy_breath_close', 'room_door_rattle', 'enemy_scream', 'locker_open_slow', 'locker_burst'];

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
  const S = N.story, SP = N.spaces, B = N.bank;
  const key = (code, down) => document.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
  const tap = (code, frames = 3) => { key(code, true); N.pump(DT, frames, false); key(code, false); N.pump(DT, 2, false); };
  const face = (x, z, pitch = 0) => { const p = N.player.pos; N.player.object.rotation.set(pitch, Math.atan2(-(x - p.x), -(z - p.z)), N.player.object.rotation.z, 'YXZ'); N.player.object.updateMatrixWorld(); };
  const walkTo = (x, z, { max = 1200, tol = 0.14, run = false, each = null } = {}) => {
    key('KeyW', true); if (run) key('ShiftLeft', true);
    let ok = false;
    for (let i = 0; i < max; i++) {
      const p = N.player.pos;
      if (Math.hypot(x - p.x, z - p.z) < tol) { ok = true; break; }
      face(x, z, 0); N.pump(DT, 1, false);
      if (each && each(i)) break;
      if (S.trans) { ok = true; break; }
    }
    key('KeyW', false); if (run) key('ShiftLeft', false); N.pump(DT, 2, false);
    return ok;
  };
  const waitTrans = () => { for (let i = 0; i < 120 && S.trans; i++) N.pump(DT, 1, false); N.pump(DT, 4, false); };
  const quiet = () => { N.ai.reset(N.ENEMY_HOME.x, N.ENEMY_HOME.z, N.ENEMY_HOME.yaw, 4); N.ai.setState('SCRIPTED', { force: true }); N.enemyObj.place(6.9, 19.5, Math.PI); };
  const tp = async (lv, x, z, yaw) => { if (typeof lv === 'string' && lv[0] === 'X') SP.show(lv); else if (SP.shown) SP.show(null); await N.teleport(lv, x, z, yaw); if (!(typeof lv === 'string' && lv[0] === 'X')) await N.world.focus(lv); N.pump(DT, 20, false); };
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
  const cnt = (id) => B.count[id] || 0;
  const pumpS = (sec, each) => { for (let i = 0; i < Math.round(sec / DT); i++) { N.pump(DT, 1, false); if (each && each(i)) return true; } return false; };
  const resetKeys = () => { for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'KeyE', 'KeyP']) key(k, false); };
  const settleDeath = () => { for (let i = 0; i < 600 && N.deathState(); i++) N.pump(DT, 1, false); };

  await N.bankLoad;
  try { await N.enemyAudio.ctx.resume(); } catch (e) { /* ユーザー操作が無いと止まったまま(記録は残る) */ }
  S.introDone = true;   // 冒頭の見せ場(410 から出た瞬間の EV の管理人)を起こさない

  // 0) 読み込み
  await T('0_load_manifest_wav_voice', async () => {
    const M = B.manifest;
    const sc = Object.keys(M.scenes), vo = Object.keys(M.voice);
    const lens = sc.map((id) => ({ id, ok: B.bufs.has(id) && Math.abs(B.bufs.get(id).duration - M.scenes[id].dur) < 0.02 }));
    const vg = Object.fromEntries(vo.map((id) => [id, (B.voiceGain[id] || []).map((g) => +g.toFixed(2))]));
    const statusOK = ADOPTED.every((id) => ['wav', 'voice'].includes(B.status(id)));
    const r3None = R3_NONE.every((id) => B.status(id) === 'none'), r3New = M.round3.every((id) => /^(amb_)?x312_/.test(id));
    const pass = B.ready && !B.error && sc.length === 21 && vo.length === 2 && lens.every((l) => l.ok) && Object.values(vg).every((a) => a.length > 0 && a.every((g) => g > 0 && g < 100))
      && statusOK && r3None && r3New && M.none.length === 39 && M.round3.length === 9 && M.unselected.length === 1 && M.unselected[0] === 'xb1_loop_notice'
      && sc.concat(vo).sort().join() === [...ADOPTED].sort().join();
    return { pass, wav: sc.length, voice: vo, voiceGain: vg, badLength: lens.filter((l) => !l.ok).map((l) => l.id), none: M.none.length, round3: M.round3, round3NoneOK: r3None, unselected: M.unselected,
      totalMB: +(M.totalBytes / 1048576).toFixed(2), ctx: N.enemyAudio.ctx.state };
  });

  // 1) なし = 無音(呼んでも AudioBank に行かない)
  await T('1_none_scenes_silent', async () => {
    const n0 = B.n, p = new N.THREE.Vector3(6.9, 12.1, 13);
    const ea0 = N.enemyAudio.logCount || 0;
    const EA_NONE = ['rattle', 'handle', 'latch', 'scream', 'breath', 'slam'];   // P4c: scream・breath・slam(3 周目でなし)
    for (const nm of EA_NONE) N.enemyAudio.play(nm, p, 0.8);
    for (const nm of ['unlock', 'rattle', 'car', 'decoy']) S._sfx(nm);
    for (const nm of ['slide', 'climb', 'lockerRattle', 'lockerCreak']) N.rooms._sfx(nm, p, 0.6);
    // P4c: 合成の仮音(管理人の歩き・叫び・息・ガタガタ、ロッカーの軋み)のバッファが残っていない
    const noSynth = !N.enemyAudio.buffers && !N.enemyAudio.pool && !N.rooms.bufs && !N.rooms.pool;
    N.elevator._sfx('door');
    const direct = B.n - n0;
    const ea = N.enemyAudio.log.filter((l) => l.n > ea0);
    const silentFlag = ea.length === EA_NONE.length && ea.every((l) => l.silent === true);
    // 開かない扉を E で引く(地下の鉄扉と同じ経路 = main の useNearestDoor): 記録は残るが無音
    await tp(4, 6.9, 12.0, Math.PI);
    const d = N.doorApi.get('408');
    N.setView(6.9, 13.05, -Math.PI / 2, 0); N.pump(DT, 2, false);
    const ea1 = N.enemyAudio.logCount || 0, n1 = B.n;
    tap('KeyE'); N.pump(DT, 10, false);
    const tapCalls = B.log.filter((l) => l.n > n1 && l.kind !== 'loop').length;   // 環境音のループ(廊下)は除く
    const locked = N.enemyAudio.log.filter((l) => l.n > ea1 && l.name === 'rattle');
    const pass = direct === 0 && tapCalls === 0 && silentFlag && noSynth && locked.length >= 1 && locked.every((l) => l.silent) && !d.collision.disabled;
    return { pass, bankCallsDirect: direct, noSynth, bankCallsOnLockedDoor: tapCalls, enemyAudioLogged: ea.map((l) => l.name + (l.silent ? ':silent' : '')), lockedDoorRattle: locked.length };
  });

  // 2) 居室: 足音・クローゼット・落ちる物
  await T('2_room_steps_closet_fall', async () => {
    S.applyStage(1); S.introDone = true; quiet();
    await tp(4, 9.6, 7.3, -Math.PI / 2);
    const s0 = cnt('pl_step_room');
    walkTo(12.6, 7.3, { max: 240 }); walkTo(9.4, 7.3, { max: 240 });
    const steps = cnt('pl_step_room') - s0;
    // 廊下では自分の足音は鳴らない(pl_step_corridor なし)
    await tp(4, 6.9, 9.0, Math.PI);
    const s1 = cnt('pl_step_room');
    walkTo(6.9, 12.0, { max: 200 });
    const corridorSteps = cnt('pl_step_room') - s1;
    // クローゼット: 隠れる(開ける → 閉める)・出る
    await tp(4, 10.5, 7.3, 0);
    const c0 = B.n;
    const hid = N.rooms.hide('410');
    pumpS(2.5);
    N.rooms.unhide(); pumpS(2.5);
    const closet = B.log.filter((l) => l.n > c0 && l.id === 'pl_closet').map((l) => l.seg);
    // 落ちる物: 410 の花瓶(割れ物)と本
    const vase = N.rooms.fallables.find((f) => f.room === '410' && f.type === 'vase');
    const book = N.rooms.fallables.find((f) => f.level === 4 && (f.type === 'books' || f.type === 'binders') && f.mesh);
    const f0 = B.n;
    N.rooms.knock(vase, N.player.pos); if (book) N.rooms.knock(book, N.player.pos);
    pumpS(1.5);
    const falls = B.log.filter((l) => l.n > f0 && l.id === 'room_fall').map((l) => l.seg);
    N.rooms.resetFallables();
    const pass = steps >= 4 && corridorSteps === 0 && hid && closet.includes('open') && closet.includes('close') && falls.includes('glass') && (!book || falls.includes('books'));
    return { pass, roomSteps: steps, corridorSteps, closetSegs: closet, fallSegs: falls };
  });

  // 3) 環境音
  await T('3_ambience_zones_and_stop', async () => {
    const where = {};
    const probe = async (label, lv, x, z, yaw = 0) => { await tp(lv, x, z, yaw); pumpS(1.5); where[label] = { at: N.ambienceAt(), loops: B.playingLoops().map((h) => h.id) }; };
    await probe('corridor4F', 4, 6.9, 15.0, Math.PI);
    await probe('room410', 4, 10.5, 7.3, 0);
    const room410Loops = B.playingLoops().map((h) => h.id);
    pumpS(4);
    const afterRoom = B.playingLoops().map((h) => h.id);   // 廊下の音は 0 まで下がって止まる
    await probe('lobby1F', 1, 17.6, 24.5, 0);
    await probe('site', 'G', ...N.building.site.spawn, 0);
    await probe('roofB', 'RB', ...N.building.roofB.spawn, 0);
    await probe('basementB1', 'B1', ...N.building.basement.spawn, 0);
    const pos = (w, k) => w.at[k] > 0 && Object.entries(w.at).every(([kk, v]) => kk === k || v === 0);
    const zero = (w) => Object.values(w.at).every((v) => v === 0);
    const pass = pos(where.corridor4F, 'corridor') && zero(where.room410) && zero(where.lobby1F) && pos(where.site, 'outdoor') && pos(where.roofB, 'roof') && pos(where.basementB1, 'b1')
      && afterRoom.length === 0 && cnt('amb_corridor') >= 1 && cnt('amb_outdoor') >= 1 && cnt('amb_roof') >= 1 && cnt('amb_b1') >= 1;
    return { pass, where, room410LoopsRightAfter: room410Loops, loopsAfter4sInRoom: afterRoom };
  });

  // 4) EV: 走行音 → チャイム → 走行音が止まる
  await T('4_ev_motor_chime_motor_stops', async () => {
    await tp(4, 6.9, 18.5, Math.PI);
    const E = N.elevator;
    if (E.car.level === 4) { E.select(1); pumpS(12, () => E.car.level === 1 && E.car.state === 'idle'); }
    const m0 = cnt('ev_motor'), c0 = cnt('ev_chime');
    E.call(4);
    let movingSeen = false, motorDuringMove = false;
    pumpS(20, () => { if (E.car.state === 'moving') { movingSeen = true; if (E.motorPlaying) motorDuringMove = true; } return E.car.level === 4 && E.car.state === 'open'; });
    pumpS(4);
    const stopped = !E.motorPlaying;
    const pass = movingSeen && motorDuringMove && cnt('ev_motor') > m0 && cnt('ev_chime') > c0 && stopped;
    return { pass, movingSeen, motorDuringMove, motorStarts: cnt('ev_motor') - m0, chimes: cnt('ev_chime') - c0, motorStoppedAfterArrival: stopped };
  });

  // 5) 管理人: 追跡の足音・扉の向こうの声・扉を破る → 一撃 → 死亡
  await T('5_enemy_walk_run_breathdoor_smash_hit_death', async () => {
    S.applyStage(2); quiet(); resetKeys();
    N.ai.dormant = false; N.ai.lurkEnabled = false;
    await tp(4, 6.9, 8.6, Math.PI);
    // 0) P4c: 巡回の歩き(enemy_step_walk 3 周目 A)。歩きの接地 = wav の足音区画(走りの区画とは別の場面)
    N.ai.reset(6.9, 19.5, Math.PI, 4); N.enemyObj.place(6.9, 15.6, Math.PI);
    N.ai.setState('PATROL', { force: true, log: true });
    const w0 = cnt('enemy_step_walk'), wr0 = cnt('enemy_step_run');
    pumpS(4.0, () => cnt('enemy_step_walk') - w0 >= 2);
    const walkSteps = cnt('enemy_step_walk') - w0, walkAsRun = cnt('enemy_step_run') - wr0;
    const walkLog = B.log.filter((l) => l.id === 'enemy_step_walk').pop() || {};
    quiet(); N.pump(DT, 2, false);
    // a) 追跡の足音(run_intent の接地)
    N.ai.reset(6.9, 19.5, Math.PI, 4); N.ai.lastKnown = { x: 6.9, z: 8.6 };
    N.ai.setState('CHASE', { force: true, log: true });
    const r0 = cnt('enemy_step_run');
    pumpS(2.0, () => cnt('enemy_step_run') > r0);
    const runSteps = cnt('enemy_step_run') - r0;
    const runLog = N.enemyAudio.log.filter((l) => l.scene === 'enemy_step_run').length;
    quiet(); N.pump(DT, 2, false);
    // b) 扉の向こうの声: 潜伏中の 408 の前で静止
    N.setView(6.9, 8.5, Math.PI, 0);
    N.ai.setState('LURK', { force: true, log: true, room: '408', standNow: true }); N.pump(DT, 3, false);
    pumpS(2);
    N.setView(6.8, 13.05, -Math.PI / 2, 0);
    const b0 = cnt('enemy_breath_door');
    pumpS(3.5, () => cnt('enemy_breath_door') > b0);
    const breath = cnt('enemy_breath_door') - b0;
    const voiceKind = (B.log.filter((l) => l.id === 'enemy_breath_door').pop() || {}).kind;
    // c) 点灯で潜伏室(407)の前を通る → 扉を破る → 襲撃 → 一撃 → 死亡
    quiet(); N.pump(DT, 2, false);
    N.setView(6.9, 12.0, Math.PI, 0); N.setFlashlight(true);
    N.ai.setState('LURK', { force: true, log: true, room: '407', standNow: true }); N.pump(DT, 3, false);
    const k0 = { smash: cnt('enemy_door_smash'), hit: cnt('enemy_hit'), death: cnt('death') };
    key('KeyW', true);
    let burst = false;
    pumpS(14, () => { if (!burst && N.ai.events.some((e) => e.ev === 'lurk_burst')) { burst = true; key('KeyW', false); } return cnt('death') > k0.death; });
    key('KeyW', false);
    const got = { smash: cnt('enemy_door_smash') - k0.smash, hit: cnt('enemy_hit') - k0.hit, death: cnt('death') - k0.death };
    settleDeath(); N.setFlashlight(false);
    N.doorApi.repairDoor('407'); N.ai.lurkEnabled = true;
    const pass = walkSteps >= 1 && walkAsRun === 0 && walkLog.kind === 'play' && runSteps >= 1 && runLog >= 1 && breath >= 1 && voiceKind === 'voice' && burst && got.smash >= 1 && got.hit >= 1 && got.death >= 1;
    return { pass, walkSteps, walkStepsCountedAsRun: walkAsRun, runSteps, breathDoor: breath, breathDoorKind: voiceKind, burst, ...got };
  });

  // 6) 物語: 221 の電話・メモ・鍵
  await T('6_story_lure_paper_key', async () => {
    S.applyStage(1); S.introDone = true; quiet();
    await tp(2, 21.65, 21.2, 0);
    N.doorApi.open('221'); pumpS(1.5);
    const l0 = cnt('story_221_lure');
    walkTo(21.65, 19.6, { max: 200 });
    pumpS(1.5);
    const lure = cnt('story_221_lure') - l0;
    const lurePos = (B.log.filter((l) => l.id === 'story_221_lure').pop() || {}).pos;
    await tp(2, 21.65, 21.2, 0); pumpS(12);   // 廊下に出ている間は鳴らない
    const outside = cnt('story_221_lure') - l0 - lure;
    const p0 = cnt('pickup_paper'), k0 = cnt('pickup_key');
    S.pick('memo221'); S.pick('small');
    const pass = lure >= 1 && !!lurePos && outside === 0 && cnt('pickup_paper') - p0 === 1 && cnt('pickup_key') - k0 === 1 && S.state().stage === 2;
    return { pass, lureInside: lure, lurePos, lureWhileOutside: outside, paper: cnt('pickup_paper') - p0, key: cnt('pickup_key') - k0, stage: S.state().stage };
  });

  // 7) 105: 空気と追跡の始まりの悲鳴
  await T('7_x105_amb_scream', async () => {
    S.applyStage(4); quiet();
    const b = SP.def('X105').back;
    await tp(1, b.x, b.z, b.yaw + Math.PI);
    const lv = openAndEnter('105');
    pumpS(1.5);
    const amb = cnt('amb_x105') >= 1 && B.playingLoops().some((h) => h.id === 'amb_x105');
    // 段取りを飛ばして(折り返し後・反転後)、R3 の追跡の始まりの手前から歩く
    const D = SP.debug('X105');
    D.skip('loopDone'); D.st.inverted = true;
    await tp('X105', 302.2, 118.5, Math.PI);
    const s0 = cnt('x105_scream');
    walkTo(302.2, 123.0, { max: 400 });
    const scream = cnt('x105_scream') - s0;
    const kind = (B.log.filter((l) => l.id === 'x105_scream').pop() || {}).kind;
    quiet(); SP.show(null); S.applyStage(1); N.player.invert = false; N.player.object.rotation.z = 0;
    await tp(4, 6.9, 15.0, Math.PI); pumpS(3);
    const stopped = !B.playingLoops().some((h) => h.id === 'amb_x105');
    const pass = lv === 'X105' && amb && scream === 1 && kind === 'voice' && stopped;
    return { pass, level: lv, ambStarted: amb, scream, screamKind: kind, ambStoppedAfterLeaving: stopped };
  });

  // 8) 705: 鍵で灯りが一斉に消える
  await T('8_x705_lights_off', async () => {
    S.applyStage(9); quiet(); N.ai.dormant = false;
    const b = SP.def('X705').back;
    await tp(7, b.x, b.z, b.yaw + Math.PI);
    const lv = openAndEnter('705');
    pumpS(3);
    const n0 = cnt('x705_lights_off'), amb705 = B.playingLoops().map((h) => h.id);
    S.pick('kB1'); pumpS(1);
    const lights = cnt('x705_lights_off') - n0;
    quiet(); SP.show(null); S.applyStage(1);
    await tp(4, 6.9, 15.0, Math.PI);
    const pass = lv === 'X705' && lights === 1 && amb705.length === 0;
    return { pass, level: lv, lightsOff: lights, loopsIn705: amb705 };
  });

  // 9) エンディング: エンジン → 門
  await T('9_ending_engine_gate', async () => {
    S.applyStage(11); quiet();
    await tp('G', ...N.building.site.spawn, 0);
    const e0 = cnt('car_engine'), g0 = cnt('ending_gate');
    S.startEnding();
    pumpS(12, () => S.ended);
    const eng = (S.engineLog || []).slice(-3);
    const r = { engine: cnt('car_engine') - e0, gate: cnt('ending_gate') - g0, ended: S.ended, engineLog: eng };
    const endEl = document.getElementById('story-end'); if (endEl) endEl.remove();
    S.ending = null; S.ended = false; N.player.frozen = false; S._dash(false); S.fadeEl.style.opacity = '0';
    S.applyStage(1);
    await tp(4, 6.9, 15.0, Math.PI);
    return { pass: r.engine === 1 && r.gate === 1 && r.ended && eng.join() === 'start,drive,stop', ...r };
  });

  // 10) まとめ
  await T('10_all_adopted_called_nothing_else', async () => {
    const called = Object.keys(B.count);
    const missing = ADOPTED.filter((id) => !(B.count[id] > 0));
    const extra = called.filter((id) => !ADOPTED.includes(id));
    const noneCalled = R3_NONE.filter((id) => B.count[id] > 0);
    return { pass: missing.length === 0 && extra.length === 0 && noneCalled.length === 0, missing, extra, r3NoneCalled: noneCalled, counts: Object.fromEntries(ADOPTED.map((id) => [id, B.count[id] || 0])) };
  });

  quiet();
  if (SP.shown) SP.show(null);
  S.applyStage(1);
  N.testResult = out;
  show();
  return out;
}
