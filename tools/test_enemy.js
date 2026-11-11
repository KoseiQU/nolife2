// test_enemy.js — P2b 管理人の決定的テスト(ブラウザ内)。http://localhost:8001/?test=enemy で自動実行。
// rAF に依存せず window.__N2.pump(dt, n) で本物のループと同じ順に進める。キーは keydown/keyup をペアで送る。
// 結果: window.__N2.testResult と画面左上の <pre>。?test=enemy&fps=1 で 1080p の fps 実測も行う(タブが前面にあること)。

import { HIDE_ODDS, HIDE_FORGET, hideOddsFrom } from '../src/enemy_ai.js';
import { levelY } from '../src/world.js';

const DT = 1 / 60;
// 消灯時の黒つぶれ判定(画面中央 50% 領域の平均輝度、表示値 0..1)。P2b 時点: 410 室内 0.007 / 廊下 0.16
const DARK_MIN = { room: 0.035, corridor: 0.12 };

export async function run(N) {
  const out = { ok: true, cases: {} };
  // P5b-6: 起動時の逃げ込みの確率(URL の ?pEnter/?pCloset の反映を 25 番で見る)。以後のテストは W.reset で 1/1(従来の「必ず入る・必ず開ける」)に固定し、
  //  確率のテスト(25〜33)は自分で値と乱数を決める
  const ODDS0 = { ...N.ai.hideOdds };
  N.ai._rand0 = N.ai._rand;
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:fixed;left:8px;top:8px;z-index:9;color:#9fe39f;background:rgba(0,0,0,.75);font:11px/1.35 monospace;padding:8px;max-width:46vw;max-height:94vh;overflow:auto;white-space:pre-wrap;';
  document.body.appendChild(pre);
  const show = () => { pre.textContent = JSON.stringify(out, null, 1); };
  const ONLY = new URLSearchParams(location.search).get('only');   // P6b-A: ?only=36,40 で絞れる(番号の頭で一致)
  const T = async (name, fn) => {
    if (ONLY && !ONLY.split(',').some((k) => name.startsWith(k + '_'))) return;
    try { const r = await fn(); out.cases[name] = r; if (!r.pass) out.ok = false; }
    catch (e) { out.cases[name] = { pass: false, error: String(e && e.stack || e) }; out.ok = false; }
    show();
  };
  const W = harness(N);

  await T('1_patrol_no_wallclip', () => {
    W.reset();
    N.setView(6.9, 7.6, Math.PI, 0); N.setFlashlight(false);
    N.enemy.place(6.9, 15.6, Math.PI);
    N.ai.setState('PATROL', { force: true, log: true });
    let maxPen = 0, inside = 0, path = 0, states = new Set();
    let px = N.enemyObj.pos.x, pz = N.enemyObj.pos.z;
    for (let i = 0; i < 600; i++) {
      N.pump(DT, 1, false);
      const e = N.enemyObj.pos;
      path += Math.hypot(e.x - px, e.z - pz); px = e.x; pz = e.z;
      states.add(N.ai.state);
      const pen = W.penetration(e.x, e.z, 0.0);
      if (pen > 0) inside++;
      maxPen = Math.max(maxPen, W.penetration(e.x, e.z, 0.30));
    }
    const st = N.ai.stats();
    return { pass: inside === 0 && maxPen < 0.02 && path > 2.0 && states.has('PATROL'), framesInsideBox: inside, maxPenetrationAtRadius30cm_m: +maxPen.toFixed(4), pathLength_m: +path.toFixed(2), states: [...states], end: st.pos, action: st.action };
  });

  await T('2_run_noise_to_alert', () => {
    W.reset();
    N.setView(6.9, 7.6, Math.PI, 0); N.setFlashlight(false);
    N.enemy.place(6.9, 15.6, 0);      // 背を向けている(視覚では気づけない)
    N.ai.setState('PATROL', { force: true, log: true });
    N.pump(DT, 10, false);
    const before = N.ai.state;
    W.key('ShiftLeft', true); W.key('KeyW', true);
    let t = 0, alertAt = null, dist = null;
    for (let i = 0; i < 60; i++) {
      N.pump(DT, 1, false); t += DT;
      if (alertAt === null && N.ai.state === 'ALERT') { alertAt = t; dist = W.dist(); }
    }
    W.key('KeyW', false); W.key('ShiftLeft', false);
    N.pump(DT, 1, false);
    return { pass: before === 'PATROL' && alertAt !== null, before, after: N.ai.state, alertAfter_s: alertAt && +alertAt.toFixed(3), distAtAlert_m: dist && +dist.toFixed(2), playerSpeed: +N.ai.playerSpeed.toFixed(2) };
  });

  await T('3_sight_to_chase', () => {
    W.reset();
    N.setView(6.9, 7.6, Math.PI, 0); N.setFlashlight(true);
    N.enemy.place(6.9, 15.6, Math.PI);   // こちらを向いている・8m
    N.ai.setState('PATROL', { force: true, log: true });
    let t = 0, chaseAt = null, grinAt1s = null;
    for (let i = 0; i < 120; i++) {
      N.pump(DT, 1, false); t += DT;
      if (chaseAt === null && N.ai.state === 'CHASE') chaseAt = t;
      if (chaseAt !== null && grinAt1s === null && t - chaseAt >= 1.0) grinAt1s = N.enemyObj.face.grin;
    }
    N.setFlashlight(false);
    return { pass: chaseAt !== null && chaseAt < 0.5, chaseAfter_s: chaseAt && +chaseAt.toFixed(3), distAtStart_m: 8.0, grin1sAfterChase: grinAt1s && +grinAt1s.toFixed(2), action: N.enemyObj.current };
  });

  await T('4_attack_death_respawn', () => {
    W.reset();
    N.setView(6.9, 7.6, Math.PI, 0); N.setFlashlight(false);
    N.enemy.place(6.9, 8.8, Math.PI);    // 1.2m
    N.ai.lastKnown = { x: 6.9, z: 7.6 };
    N.ai.setState('CHASE', { force: true, log: true });
    let t = 0, attackAt = null, hitAt = null, maxAttackFaceWindup = 0, deathSeen = false, movieFov = null, movieFrozen = null;
    for (let i = 0; i < 300 && hitAt === null; i++) {
      N.pump(DT, 1, false); t += DT;
      if (attackAt === null && N.ai.state === 'ATTACK') attackAt = t;
      if (attackAt !== null && movieFov === null && t - attackAt >= 0.4) { movieFov = N.camera.fov; movieFrozen = N.player.frozen; }
      if (attackAt !== null && N.enemyObj.current === 'attack_downward' && N.enemyObj.actionTime() < 0.8) maxAttackFaceWindup = Math.max(maxAttackFaceWindup, N.enemyObj.face.attack);
      if (N.deathState()) { hitAt = t; deathSeen = true; }
    }
    const bloodOn = N.movie.pass.enabled;
    const deathsBefore = N.deaths();
    for (let i = 0; i < Math.round(6.0 / DT); i++) N.pump(DT, 1, false);
    const p = N.player.pos, cp = N.CHECKPOINT;
    const respawnErr = Math.hypot(p.x - cp.x, p.z - cp.z);
    const st = N.ai.stats();
    return {
      pass: attackAt !== null && deathSeen && N.deaths() === deathsBefore + 1 && respawnErr < 1e-3 && st.state === 'PATROL' && maxAttackFaceWindup > 0.95 && N.deathState() === null
        && movieFov !== null && movieFov < 50 && movieFrozen && bloodOn && N.camera.fov === 68 && !N.movie.active,
      movie: { fovAt04s: movieFov && +movieFov.toFixed(1), inputFrozen: movieFrozen, bloodAtHit: bloodOn, fovAfterRespawn: N.camera.fov },
      attackAfter_s: attackAt && +attackAt.toFixed(3), hitAfter_s: hitAt && +hitAt.toFixed(3), attackFaceMaxInWindup: +maxAttackFaceWindup.toFixed(2),
      deaths: N.deaths(), respawnErr_m: +respawnErr.toFixed(4), enemyStateAfter: st.state, enemyPosAfter: st.pos, deathOverlayCleared: N.deathState() === null,
    };
  });

  // P5a: 施錠要素の全廃(DESIGN §3.8 B)。L キーは何もしない。管理人は鍵を使わず、扉を普通に開けて(door_open_in)入ってくる
  await T('5_door_normal_entry_no_lock', () => {
    W.reset();
    N.setView(8.75, 7.3, Math.PI / 2, 0); N.setFlashlight(false);
    N.pump(DT, 2, false);
    const a0 = N.enemyAudio.log.length;
    W.key('KeyL', true); N.pump(DT, 1, false); W.key('KeyL', false); N.pump(DT, 1, false);
    const lAfter = { locked: W.door410().locked, target: W.door410().target, lockSound: N.enemyAudio.log.slice(a0).some((l) => l.name === 'lock'), hint: N.hudState().hint };
    N.enemy.place(6.9, 12.5, Math.PI);
    N.ai.lastKnown = { x: 8.75, z: 7.3 };
    N.ai.knownRoomId = '410';   // P2d 以降: 閉じた扉を開けて入るのは「中にいると知っている」時だけ(物音を聞いた想定)
    N.ai.setState('ALERT', { force: true, log: true, react: true });
    const ev0 = N.ai.events.length;
    let t = 0, enteredAt = null, maxAngle = 0, wallClip = 0;
    for (let i = 0; i < Math.round(45 / DT) && enteredAt === null; i++) {
      N.pump(DT, 1, false); t += DT;
      maxAngle = Math.max(maxAngle, W.door410().angle);
      if (!N.ai.uninterruptible && W.penetration(N.enemyObj.pos.x, N.enemyObj.pos.z, 0) > 0) wallClip++;
      if (N.ai.events.slice(ev0).some((e) => e.ev === 'entered')) enteredAt = t;
    }
    const evAll = N.ai.events.slice(ev0);
    const evs = evAll.filter((e) => ['keys', 'unlock', 'door_open_in', 'door_opened', 'entered', 'stuck', 'state'].includes(e.ev)).map((e) => `${e.t.toFixed(2)} ${e.ev}${e.to ? ':' + e.to : ''}${e.x !== undefined ? ` (${e.x},${e.z})` : ''}`);
    const order = ['door_open_in', 'door_opened', 'entered'];
    const idx = order.map((k) => evAll.findIndex((e) => e.ev === k));
    const inOrder = idx.every((v, i) => v >= 0 && (i === 0 || v > idx[i - 1]));
    const noKeys = !evAll.some((e) => e.ev === 'keys' || e.ev === 'unlock') && !N.enemyAudio.log.slice(a0).some((l) => l.name === 'keys' || l.name === 'lock');
    const e = N.enemyObj.pos;
    return { pass: !lAfter.locked && lAfter.target === 0 && !lAfter.lockSound && !lAfter.hint.includes('施錠') && inOrder && noKeys && enteredAt !== null && e.x > 7.95 && maxAngle > 1.2 && wallClip === 0,
      keyL: lAfter, enteredAfter_s: enteredAt && +enteredAt.toFixed(2), enemyInRoomX: +e.x.toFixed(2), doorMaxAngle_rad: +maxAngle.toFixed(2), noKeysOrLock: noKeys, wallClipFrames: wallClip, events: evs };
  });

  await T('6_peephole_on_off', () => {
    W.reset();
    N.setView(8.75, 7.3, Math.PI / 2, 0); N.setFlashlight(true);
    N.pump(DT, 2, false);
    const cam = N.camera;
    const before = { fov: cam.fov, pos: cam.position.clone(), quat: cam.quaternion.clone() };
    // P(押している間)
    W.key('KeyP', true); N.pump(DT, 2, false);
    const on = { active: N.peepholeObj.active, fov: cam.fov, pos: cam.position.toArray().map((v) => +v.toFixed(3)), lens: [N.lens.x, N.lens.z].map((v) => +v.toFixed(3)), flashlightHidden: !N.player.flashlight.visible };
    W.key('KeyP', false); N.pump(DT, 2, false);
    const offP = { active: N.peepholeObj.active, fov: cam.fov, posErr: cam.position.distanceTo(before.pos), rotErr: cam.quaternion.angleTo(before.quat) };
    // E 長押し(0.5s)→覗く、離す→戻る。扉は動かない
    W.key('KeyE', true); N.pump(DT, 30, false);
    const onE = { active: N.peepholeObj.active, fov: cam.fov };
    W.key('KeyE', false); N.pump(DT, 2, false);
    const offE = { active: N.peepholeObj.active, fov: cam.fov, posErr: cam.position.distanceTo(before.pos), doorTarget: W.door410().target };
    // E 短押し → 扉が開く(覗き穴にはならない)
    W.key('KeyE', true); N.pump(DT, 5, false); W.key('KeyE', false); N.pump(DT, 2, false);
    const shortE = { peep: N.peepholeObj.active, doorTarget: +W.door410().target.toFixed(2) };
    N.doorApi.close('410'); N.pump(DT, 90, false);
    N.setFlashlight(false);
    const pass = on.active && on.fov === 110 && Math.abs(on.pos[0] - N.lens.x) < 1e-3 && !offP.active && offP.fov === before.fov && offP.posErr < 1e-6 && offP.rotErr < 1e-6
      && onE.active && onE.fov === 110 && !offE.active && offE.posErr < 1e-6 && offE.doorTarget === 0 && !shortE.peep && shortE.doorTarget > 1;
    return { pass, before: { fov: before.fov }, on, offP: { ...offP, posErr: +offP.posErr.toExponential(1), rotErr: +offP.rotErr.toExponential(1) }, onE, offE: { ...offE, posErr: +offE.posErr.toExponential(1) }, shortE };
  });

  await T('7_lurk_ambush_attack', () => {
    W.reset();
    N.setView(6.9, 12.0, Math.PI, 0); N.setFlashlight(false);
    N.enemy.place(9.4, 7.05, -1.73);   // P3b: 410 の隠れ場所 r410_back は内装が入って玄関の先(トイレの扉の前)へ移った(P3b-2 の鏡像で北寄りへ)
    N.ai.setState('LURK', { force: true, log: true, spot: 'r410_back', standNow: true });
    const ev0 = N.ai.events.length;
    // ① 離れて(扉は閉)いる間は潜伏のまま・消灯
    for (let i = 0; i < Math.round(3 / DT); i++) N.pump(DT, 1, false);
    const still = { state: N.ai.state, flashlightOn: N.enemyObj.flashlight.on, action: N.enemyObj.current, found: N.ai.lurkFound };
    // ② 扉を開けて戸口に立つ(2m・遮蔽なし)→ 発見 → grin → 無言で接近 → ATTACK → ヒット
    N.doorApi.open('410'); for (let i = 0; i < 60; i++) N.pump(DT, 1, false);
    N.setView(7.3, 7.25, -Math.PI / 2, 0);
    let t = 0, foundAt = null, attackAt = null, hitAt = null, grinAtAttack = null, flashDuringApproach = false, approachClip = null;
    for (let i = 0; i < Math.round(12 / DT) && hitAt === null; i++) {
      N.pump(DT, 1, false); t += DT;
      const evs = N.ai.events.slice(ev0);
      if (foundAt === null && evs.some((e) => e.ev === 'lurk_found')) foundAt = t;
      if (foundAt !== null && attackAt === null) { if (N.enemyObj.flashlight.on) flashDuringApproach = true; if (N.enemyObj.current !== 'look_idle') approachClip = N.enemyObj.current; }
      if (attackAt === null && N.ai.state === 'ATTACK') { attackAt = t; grinAtAttack = N.enemyObj.face.grin; }
      if (N.deathState()) hitAt = t;
    }
    const found = N.ai.events.slice(ev0).find((e) => e.ev === 'lurk_found');
    for (let i = 0; i < Math.round(6 / DT); i++) N.pump(DT, 1, false);
    return {
      pass: still.state === 'LURK' && !still.flashlightOn && !still.found && foundAt !== null && attackAt !== null && hitAt !== null && !flashDuringApproach && approachClip === 'walk_brutal' && grinAtAttack > 0.3,
      beforeDoorOpen: still, foundAfter_s: foundAt && +foundAt.toFixed(2), foundWhy: found && found.why, approachClip, enemyFlashlightDuringApproach: flashDuringApproach,
      grinAtAttack: grinAtAttack && +grinAtAttack.toFixed(2), attackAfter_s: attackAt && +attackAt.toFixed(2), hitAfter_s: hitAt && +hitAt.toFixed(2),
    };
  });

  await T('8_dark_visibility', () => {
    W.reset();
    N.ai.setState('SCRIPTED', { force: true }); N.enemy.place(6.9, 21.0, Math.PI);
    const res = {};
    // P3b: 410 の室内(内装が入った)。洋室の奥から玄関の方を見る(P3b-2: 鏡像に合わせて立ち位置と向きも鏡に)
    const shots = { room_off: [12.4, 7.15, Math.PI / 2 + 0.15, false], room_on: [12.4, 7.15, Math.PI / 2 + 0.15, true], corridor_off: [6.9, 7.6, Math.PI, false], corridor_on: [6.9, 7.6, Math.PI, true] };
    for (const [k, [x, z, yaw, fl]] of Object.entries(shots)) { N.setView(x, z, yaw, 0); N.setFlashlight(fl); N.pump(DT, 3, false); res[k] = W.centerLuma(); }
    N.setFlashlight(false);
    const pass = res.room_off >= DARK_MIN.room && res.corridor_off >= DARK_MIN.corridor;
    return { pass, meanLumaCenter50: res, threshold: DARK_MIN };
  });

  await T('9_witness_scope_return_out', () => {
    W.reset(); N.ai.lurkEnabled = false;
    // 扉を開け、戸口(廊下側)に立つ。管理人は 2.8m 先からこちらを向いている(暗く静止=まだ見つかっていない)
    N.doorApi.open('410'); for (let i = 0; i < 60; i++) N.pump(DT, 1, false);
    N.setView(7.5, 7.05, -Math.PI / 2, 0); N.setFlashlight(false);
    N.enemy.place(6.3, 9.6, Math.atan2(7.8 - 6.3, 7.25 - 9.6));
    N.ai.setState('PATROL', { force: true, log: true });
    N.pump(DT, 2, false);
    const ev0 = N.ai.events.length;
    // 部屋へ入る瞬間を見られる
    N.setView(8.0, 7.05, -Math.PI / 2, 0); N.pump(DT, 3, false);
    const known = N.ai.knownRoomId, why = (N.ai.events.slice(ev0).find((e) => e.ev === 'room_known') || {}).why;
    // 奥へ下がって扉を閉め、消灯したままスコープを覗く
    N.setView(8.85, 7.6, Math.PI / 2, 0); N.doorApi.close('410'); for (let i = 0; i < 90; i++) N.pump(DT, 1, false);
    N.setView(8.75, 7.3, Math.PI / 2, 0); N.pump(DT, 1, false);
    N.peephole(true);
    let t = 0, minFace = Infinity, grinAtStare = null, attackAfterStare = 0, stareAt = null, peepAtUnlock = null, hitAt = null;
    for (let i = 0; i < Math.round(60 / DT) && hitAt === null; i++) {
      N.pump(DT, 1, false); t += DT;
      const evs = N.ai.events.slice(ev0);
      if (N.ai.state === 'SCOPE' && isFinite(N.ai.scopeFaceDist)) minFace = Math.min(minFace, N.ai.scopeFaceDist);
      if (stareAt === null && evs.some((e) => e.ev === 'scope_stare')) { stareAt = t; grinAtStare = N.enemyObj.face.grin; }
      if (stareAt !== null && t - stareAt <= 1.2) attackAfterStare = Math.max(attackAfterStare, N.enemyObj.face.attack);
      if (peepAtUnlock === null && evs.some((e) => e.ev === 'scope_knob')) peepAtUnlock = N.peepholeObj.active;   // P5a: 鍵(unlock)→ノブ(scope_knob)
      if (N.deathState()) hitAt = t;
    }
    const order = ['room_known', 'scope_start', 'scope_pass', 'scope_hide', 'scope_return', 'scope_stare', 'scope_knob', 'door_opened', 'attack_start', 'hit'];
    const evs = N.ai.events.slice(ev0);
    const idx = order.map((k) => evs.findIndex((e) => e.ev === k));
    const inOrder = idx.every((v, i) => v >= 0 && (i === 0 || v > idx[i - 1]));
    const tl = evs.filter((e) => order.includes(e.ev)).map((e) => `${e.t.toFixed(1)} ${e.ev}`);
    for (let i = 0; i < Math.round(6 / DT); i++) N.pump(DT, 1, false);
    N.ai.lurkEnabled = true;
    return {
      pass: known === '410' && why === 'witness' && inOrder && minFace <= 0.3 && grinAtStare >= 0.5 && attackAfterStare > 0.9 && peepAtUnlock === false && hitAt !== null,
      knownWhy: why, faceToLensMin_m: +minFace.toFixed(3), grinAtStare: grinAtStare && +grinAtStare.toFixed(2), attackWithin1_2sOfStare: +attackAfterStare.toFixed(2),
      peepholeClosedAtUnlock: peepAtUnlock === false, outAfter_s: hitAt && +hitAt.toFixed(1), timeline: tl,
    };
  });

  await T('10_unwitnessed_dark_safe', () => {
    W.reset(); N.ai.lurkEnabled = false;
    N.setView(8.75, 7.3, Math.PI / 2, 0); N.setFlashlight(false);
    N.pump(DT, 2, false);
    N.enemy.place(6.9, 11.5, Math.PI);
    N.ai.setState('PATROL', { force: true, log: true });
    N.ai.patrolIdx = 5;                 // 次の巡回先 = 410
    const r0 = N.ai._rand; N.ai._rand = () => 0.1;   // 「扉を確かめる」側へ必ず進む
    const ev0 = N.ai.events.length;
    let skipAt = null, t = 0;
    for (let i = 0; i < Math.round(45 / DT); i++) {
      N.pump(DT, 1, false); t += DT;
      if (skipAt === null && N.ai.events.slice(ev0).some((e) => e.ev === 'door_skip_unknown')) skipAt = t;
      if (skipAt !== null && t - skipAt > 8) break;
    }
    const evs = N.ai.events.slice(ev0).map((e) => e.ev);
    const e = N.enemyObj.pos;
    const leftDoor = Math.hypot(e.x - 7.8, e.z - 7.25);
    const safe = { skipAt: skipAt && +skipAt.toFixed(1), opened: evs.includes('door_open_in') || evs.includes('door_opened'), known: N.ai.knownRoomId, dead: !!N.deathState(), doorAngle: +W.door410().angle.toFixed(2), enemyDistFromDoorAfter8s: +leftDoor.toFixed(2) };
    // おまけ: 室内で懐中電灯を点けると、扉から 6m 以内の管理人に光漏れで気づかれる
    N.enemy.place(6.9, 10.0, Math.PI); N.ai.setState('PATROL', { force: true }); N.ai.patrolIdx = 0;
    N.setFlashlight(true); N.pump(DT, 10, false);
    const lightWhy = (N.ai.events.slice(ev0).find((x) => x.ev === 'room_known') || {}).why || null;
    N.setFlashlight(false); N.ai._rand = r0; N.ai.lurkEnabled = true;
    return { pass: skipAt !== null && !safe.opened && safe.known === null && !safe.dead && safe.doorAngle === 0 && leftDoor > 1.5 && lightWhy === 'light', ...safe, lightLeakKnownWhy: lightWhy };
  });

  await T('11_hud_hints', () => {
    W.reset();
    N.ai.setState('SCRIPTED', { force: true }); N.enemy.place(6.9, 21.0, Math.PI);
    const H = () => N.hudState();
    const at = (x, z, yaw) => { N.setView(x, z, yaw, 0); N.pump(DT, 2, false); return H(); };
    const tap = (code, frames = 3) => { W.key(code, true); N.pump(DT, frames, false); W.key(code, false); N.pump(DT, 2, false); };
    const r = {};
    r.corridorDoor = at(6.95, 7.25, -Math.PI / 2).hint;                 // 廊下から 410 の扉を見る(0.85m)
    r.away = at(6.9, 12.5, Math.PI).hint;                                // 離れる(扉を見ていない・遠い)
    r.inside = at(8.75, 7.3, Math.PI / 2).hint;                          // 室内から扉(スコープ 0.97m・正対)
    tap('KeyL'); r.afterL = H().hint; r.lockedAfterL = W.door410().locked;   // P5a: L は何もしない(施錠の撤去)
    N.peephole(true); N.pump(DT, 2, false); r.peep = H(); N.peephole(false); N.pump(DT, 2, false);
    at(6.95, 13.05, Math.PI / 2); tap('KeyE'); r.otherDoorToast = H().toast;   // 開かない扉(403)で E(P3b: 404 は入れる部屋になった)
    const ev = N.hud.evPanel;
    const ex = ev.x - 0.9 * 0.2, ez = ev.z - 0.9;
    r.ev = at(ex, ez, Math.atan2(-(ev.x - ex), -(ev.z - ez))).hint; tap('KeyE'); r.evToast = H().toast;
    tap('KeyF'); N.pump(DT, 12, false); r.flashToast = H().toast; tap('KeyF'); N.pump(DT, 12, false);
    tap('KeyH'); r.controls = H().controls;
    const pass = r.corridorDoor.includes('開ける') && !r.corridorDoor.includes('施錠') && r.away === ''
      && r.inside.includes('覗く') && r.inside.includes('開ける') && !r.inside.includes('施錠')
      && r.afterL === r.inside && !r.lockedAfterL
      && r.peep.hint === '' && r.peep.release.includes('やめる')
      && r.otherDoorToast === '鍵がかかっている' && !N.hud.el.controls.textContent.includes('施錠')
      // P3a: EV が動くようになったので、呼ぶと「エレベーターを呼んだ」(カゴがこの階なら「扉が開く」)。P2e の期待値は「反応がない」だった
      && r.ev.includes('呼ぶ') && ['エレベーターを呼んだ', '扉が開く'].includes(r.evToast) && r.flashToast.includes('懐中電灯') && r.controls;
    return { pass, ...r, peep: { hint: r.peep.hint, release: r.peep.release } };
  });

  // ================================================================ P5a(DESIGN §3.8 A・B・C・E・F)
  // ai.events / enemyAudio.log は上限で古い物から消えるので、区切りは時刻・通し番号で取る
  const evMark = () => N.ai.time + 1e-4;
  const evSince = (t0) => N.ai.events.filter((e) => e.t >= t0 - 2e-3);
  const has = (t0, name) => evSince(t0).some((e) => e.ev === name);
  const aud0 = () => N.enemyAudio.logCount || 0;
  const sounds = (a0) => N.enemyAudio.log.filter((l) => l.n > a0).map((l) => l.name);
  const audSince = (a0) => N.enemyAudio.log.filter((l) => l.n > a0);
  // 管理人を空室に潜ませる(その場で。扉は閉じている)
  const lurkIn = (room) => { N.ai.setState('LURK', { force: true, log: true, room, standNow: true }); N.pump(DT, 3, false); };
  // 経由点へ向けて歩く/走る(毎フレーム向きを合わせる。凍結中は触らない)
  const steer = (wps, st) => {
    if (N.player.frozen) return;
    const p = N.player.pos;
    let [wx, wz] = wps[st.i];
    if (Math.hypot(wx - p.x, wz - p.z) < 0.4 && st.i < wps.length - 1) { st.i++; [wx, wz] = wps[st.i]; }
    N.player.object.rotation.set(0, Math.atan2(-(wx - p.x), -(wz - p.z)), 0, 'YXZ');
  };

  // 12) 点灯で潜伏室(407)の前を通る → 通り過ぎた瞬間に扉を壊して飛び出し、視点が管理人へ向き、襲撃ムービー → OUT(救済なし。P4a-2 でしゃがみ廃止→普通に歩いて通る)
  await T('12_room_lurk_lit_pass_attack', () => {
    W.reset(); N.ai.lurkEnabled = false;
    N.setView(6.9, 12.0, Math.PI, 0); N.setFlashlight(true);
    lurkIn('407');
    const hidden = { concealed: N.ai.concealed, visible: N.enemyObj.root.visible, doorAngle: N.doorApi.get('407').angle };
    const ev0 = evMark(), a0 = aud0(), vl0 = N.viewLock.log.length;
    W.key('KeyW', true);
    let t = 0, burstAt = null, zAtBurst = null, aimAfter = null, attackAt = null, deadAt = null;
    for (let i = 0; i < Math.round(14 / DT) && deadAt === null; i++) {
      N.pump(DT, 1, false); t += DT;
      if (burstAt === null && has(ev0, 'lurk_burst')) { burstAt = t; zAtBurst = N.player.pos.z; W.key('KeyW', false); }
      if (burstAt !== null && aimAfter === null && t - burstAt >= 0.32) {   // 視点が管理人の頭の方を向いている(振り向かされた → 襲撃ムービー)
        const f = N.camera.getWorldDirection(new N.THREE.Vector3()), h = N.enemyObj.headWorld(new N.THREE.Vector3()).sub(N.camera.position).normalize();
        aimAfter = f.angleTo(h);
      }
      if (attackAt === null && N.ai.state === 'ATTACK') attackAt = t;
      if (N.deathState()) deadAt = t;
    }
    W.key('KeyW', false);
    for (let i = 0; i < Math.round(6 / DT); i++) N.pump(DT, 1, false);
    const pass0 = evSince(ev0).find((e) => e.ev === 'lurk_pass');
    const d = N.doorApi.get('407');
    const vl = N.viewLock.log.slice(vl0).map((l) => l.ev + ':' + l.label);
    const brokenNow = !!d.broken;
    N.doorApi.repairDoor('407');
    N.ai.lurkEnabled = true;
    return {
      pass: hidden.concealed && !hidden.visible && hidden.doorAngle === 0 && pass0 && pass0.lit === true && burstAt !== null && zAtBurst > 15.95 + 1.2
        && sounds(a0).includes('crash') && brokenNow && vl.includes('start:burst_lit') && vl.includes('handoff:burst_lit') && aimAfter !== null && aimAfter < 0.25
        && attackAt !== null && attackAt - burstAt < 1.5 && deadAt !== null,
      hiddenWhileLurking: hidden, passedLit: pass0 && pass0.lit, zAtBurst: zAtBurst && +zAtBurst.toFixed(2), aimErrorAfter0_32s_rad: aimAfter && +aimAfter.toFixed(3),
      burstToAttack_s: attackAt && +(attackAt - burstAt).toFixed(2), out: deadAt !== null, doorBroken: brokenNow, viewLock: vl,
    };
  });

  // 13) 消灯で潜伏室(409)の前を通る → 4〜6m 離れた所で飛び出し、視点を固定する短いムービー(1.2〜1.8 秒・操作不能)→ 元の視点 → 追跡。走って逃げ切れる
  //  P5a 監査: 飛び出す距離の乱数に依存しないよう、4.0 / 5.0 / 6.0m に固定して 3 回とも検査する。時間と距離は秒・m で明示
  //  (逃げ切り = 追跡中に 2.5m より近づかれず、走り出してから 9 秒以内に見失われる(CHASE が終わる)・OUT なし)
  await T('13_room_lurk_dark_pass_chase_escape', () => {
    const R = N.ai.cfg.roomLurk, DB = R.darkBurst.slice();
    const one = (D) => {
      W.reset(); N.ai.lurkEnabled = false;
      R.darkBurst = [D, D];
      N.setView(6.9, 7.6, Math.PI, 0); N.setFlashlight(false);
      lurkIn('409');
      const ev0 = evMark(), vl0 = N.viewLock.log.length;
      W.key('KeyW', true);
      let t = 0, burstAt = null, distAtBurst = null, lockStart = null, lockEnd = null, frozenDuring = true, rot0 = null, rotErr = null, chaseAt = null, distAtChase = null;
      let minDChase = Infinity, lostAt = null, dead = false;
      const st = { i: 0 }, wps = [[6.9, 21.2], [25.0, 21.2]];
      for (let i = 0; i < Math.round(40 / DT); i++) {
        if (W.running && !N.player.frozen) steer(wps, st);
        N.pump(DT, 1, false); t += DT;
        if (burstAt === null && has(ev0, 'lurk_burst')) { burstAt = t; distAtBurst = Math.hypot(N.player.pos.x - 7.8, N.player.pos.z - 10.15); W.key('KeyW', false); }
        if (burstAt !== null && lockStart === null && N.viewLock.active) { lockStart = t; rot0 = N.viewLock.saved.euler.clone(); }
        if (lockStart !== null && lockEnd === null) { if (N.viewLock.active) { if (!N.player.frozen) frozenDuring = false; } else { lockEnd = t; const wr = (a) => Math.abs(Math.atan2(Math.sin(a), Math.cos(a))); rotErr = wr(N.player.object.rotation.y - rot0.y) + wr(N.player.object.rotation.x - rot0.x); } }
        // 視点が戻ったら(操作が返ったら)すぐ走って逃げる
        if (lockEnd !== null && chaseAt === null && !N.player.frozen && !W.running) { W.running = true; W.key('ShiftLeft', true); W.key('KeyW', true); }
        if (chaseAt === null && N.ai.state === 'CHASE') { chaseAt = t; distAtChase = W.dist(); }
        if (chaseAt !== null && lostAt === null) { if (N.ai.state === 'CHASE') minDChase = Math.min(minDChase, W.dist()); else lostAt = t; }
        if (N.deathState()) dead = true;
        if (lostAt !== null || dead) break;
      }
      W.running = false; W.key('KeyW', false); W.key('ShiftLeft', false);
      const passEv = evSince(ev0).find((e) => e.ev === 'lurk_pass');
      const lockLen = lockEnd !== null && lockStart !== null ? lockEnd - lockStart : null;
      const brokenNow = !!N.doorApi.get('409').broken;
      N.doorApi.repairDoor('409');
      for (let i = 0; i < 400 && N.deathState(); i++) N.pump(DT, 1, false);
      const ok = passEv && passEv.lit === false && burstAt !== null && Math.abs(distAtBurst - D) < 0.15 && lockLen !== null && lockLen >= 1.2 && lockLen <= 1.85 && frozenDuring
        && rotErr !== null && rotErr < 1e-3 && chaseAt !== null && minDChase >= 2.5 && lostAt !== null && lostAt - lockEnd < 9 && !dead && brokenNow;
      return { ok, burstAtDist_m: distAtBurst && +distAtBurst.toFixed(2), viewLock_s: lockLen && +lockLen.toFixed(2), inputFrozenDuringLock: frozenDuring, viewRestoredErr_rad: rotErr && +rotErr.toExponential(1),
        distAtChaseStart_m: distAtChase && +distAtChase.toFixed(2), minDistDuringChase_m: +minDChase.toFixed(2), lostAfterRunStart_s: lostAt && lockEnd && +(lostAt - lockEnd).toFixed(1), out: dead,
        viewLockLog: N.viewLock.log.slice(vl0).map((l) => l.ev + ':' + l.label) };
    };
    const runs = {};
    try { for (const D of [4.0, 5.0, 6.0]) runs[D + 'm'] = one(D); } finally { R.darkBurst = DB; N.ai.lurkEnabled = true; }
    return { pass: Object.values(runs).every((r) => r.ok), runs };
  });

  // 14) 壊れた扉は開いた扱い(通れる)のまま残り、死亡 → チェックポイント復帰の後も壊れたまま。戸口の奥(1.2m 先)には入れない
  await T('14_broken_door_persists', () => {
    W.reset();
    const broke = N.doorApi.breakDoor('408') || !!N.doorApi.get('408').broken;
    N.pump(DT, 30, false);
    // 死亡 → 復帰(4 番と同じ)
    N.setView(6.9, 7.6, Math.PI, 0); N.enemy.place(6.9, 8.8, Math.PI);
    N.ai.lastKnown = { x: 6.9, z: 7.6 }; N.ai.setState('CHASE', { force: true, log: true });
    const deaths0 = N.deaths();
    for (let i = 0; i < Math.round(12 / DT) && N.deaths() === deaths0; i++) N.pump(DT, 1, false);
    for (let i = 0; i < Math.round(2 / DT); i++) N.pump(DT, 1, false);
    const d = N.doorApi.get('408');
    const after = { died: N.deaths() === deaths0 + 1, broken: !!d.broken, angle: +d.angle.toFixed(2), open: N.doorApi.isOpen('408'), debris: N.doorFx.stats().broken.includes('408'), blockers: d.blockers.length };
    // 廊下から戸口へ歩いて入る(408 は W 向き・扉面 x=7.8)
    N.ai.setState('SCRIPTED', { force: true }); N.enemy.place(6.9, 20.6, Math.PI);
    N.setView(7.0, 13.05, -Math.PI / 2, 0);
    W.key('KeyW', true); for (let i = 0; i < Math.round(3 / DT); i++) N.pump(DT, 1, false); W.key('KeyW', false); N.pump(DT, 2, false);
    const depth = N.player.pos.x - 7.8;
    N.doorApi.repairDoor('408'); N.setView(6.9, 12.0, Math.PI, 0); N.pump(DT, 2, false);
    return { pass: broke && after.died && after.broken && after.angle > 1.0 && after.open && after.debris && after.blockers > 0 && depth > 0.3 && depth < 1.3, afterRespawn: after, walkedIntoDoorway_m: +depth.toFixed(2) };
  });

  // 15) 前を通らないまま、プレイヤーが別の階へ移ると 20〜60 秒で静かに出てくる(扉は壊れない・破壊音なし・扉は閉じる)
  await T('15_silent_release_after_floor_change', () => {
    W.reset(); N.ai.lurkEnabled = false;
    N.setView(6.9, 12.0, Math.PI, 0);
    lurkIn('407');
    const ev0 = evMark(), a0 = aud0();
    N.ai.playerLevelAt = () => 6;   // プレイヤーは 6F へ移った(AI から見て)
    let t = 0, relAt = null, outAt = null, maxAngle = 0;
    const planned = (N.ai.events.filter((e) => e.ev === 'lurk_room_in').pop() || {}).releaseAt;
    for (let i = 0; i < Math.round(75 / DT); i++) {
      N.pump(DT, 1, false); t += DT;
      maxAngle = Math.max(maxAngle, N.doorApi.get('407').angle);
      if (relAt === null && has(ev0, 'lurk_release')) relAt = t;
      if (outAt === null && has(ev0, 'lurk_released')) outAt = t;
      if (outAt !== null && t - outAt > 1.5) break;
    }
    const d = N.doorApi.get('407');
    const snd = sounds(a0);
    const r = { pass: relAt !== null && relAt >= 20 - 0.1 && relAt <= 60 + 0.5 && maxAngle > 1.0 && d.angle < 0.01 && !d.broken && !snd.includes('crash') && snd.includes('latch') && N.ai.state === 'PATROL' && !N.ai.concealed,
      releaseAfter_s: relAt && +relAt.toFixed(1), plannedReleaseAt_s: planned, outAfter_s: outAt && +outAt.toFixed(1), doorMaxAngle: +maxAngle.toFixed(2), doorClosedAfter: d.angle < 0.01, broken: !!d.broken,
      sounds: [...new Set(snd)], why: (evSince(ev0).find((e) => e.ev === 'lurk_release') || {}).why, stateAfter: N.ai.state };
    N.ai.lurkEnabled = true;
    return r;
  });

  // 16) 管理人の階の移動は常に EV(全ての階の組の経路に階段の辺が無い・実際の移動も EV のカゴが動く)
  await T('16_ev_only_moves', () => {
    W.reset();
    const bad = [];
    let pairs = 0;
    for (let a = 1; a <= 7; a++) for (let b = 1; b <= 7; b++) {
      if (a === b) continue;
      for (const [fx, fz, tx, tz] of [[6.9, 19.0, 6.9, 19.0], [6.9, 21.2, 20.0, 21.2]]) {
        const r = N.ai._route(fx, fz, tx, tz, a, b);
        pairs++;
        if (r.some((w) => w.via === 'stair') || !r.some((w) => w.via === 'ev') || r[r.length - 1].lv !== b) bad.push(`${a}->${b}`);
      }
    }
    // 実際に 4F → 2F へ(ALERT)。カゴの表示が動き、移動は EV だけ
    N.ai.reset(6.9, 20.6, Math.PI, 4);
    const ev0 = evMark(), sh0 = N.elevator.shownLog.length;
    N.ai.playerLevelAt = () => 2;
    N.ai.lastKnown = { x: 12.0, z: 21.2, lv: 2 };
    N.ai.setState('ALERT', { force: true, log: true, react: false });
    let t = 0;
    while (t < 90 && !(N.ai.level === 2 && has(ev0, 'transfer_end'))) { N.pump(DT, 1, false); t += DT; }
    const vias = evSince(ev0).filter((e) => e.ev === 'transfer_start' || e.ev === 'transfer_end').map((e) => e.via);
    const floors = [...new Set(N.elevator.shownLog.slice(sh0).map((x) => x.floor))];
    return { pass: bad.length === 0 && N.ai.level === 2 && vias.length >= 2 && vias.every((v) => v === 'ev') && floors.includes(3) && floors.includes(2),
      routesChecked: pairs, routesWithStairsOrNoEV: bad, ride4to2: { arrived: N.ai.level === 2, vias, displayFloors: floors, sec: +t.toFixed(1) } };
  });

  // 17) 行き先の階の重み付き乱数＋監督役: 1000 回の抽選でプレイヤーの階が最頻。静か(遭遇の直後)は減り、緊張(長く遭遇なし)は増える。同じ階に居続けない
  await T('17_director_floor_weights', () => {
    W.reset();
    N.ai.reset(6.9, 20.6, Math.PI, 2);
    const rng = ((a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; })(99);
    const draw = (phase) => { const c = {}; for (let i = 0; i < 1000; i++) { const lv = N.ai._chooseFloor(phase, rng); c[lv] = (c[lv] || 0) + 1; } return c; };
    const normal = draw('normal'), calm = draw('calm'), tense = draw('tense');
    const top = (c) => +Object.entries(c).sort((a, b) => b[1] - a[1])[0][0];
    // 音の履歴: 6F で何度も音がすると 6F が増える
    N.ai.noiseHist = { 6: 3 };
    const noisy = draw('normal');
    N.ai.noiseHist = {};
    // 同じ階の上限: 4F(プレイヤーの階)で 2 回続けて潜んだ管理人(4F にいる)は、次に 4F を選ばない
    N.ai.reset(6.9, 20.6, Math.PI, 4); N.ai.floorStreak = AI_STAY(); N.ai._lastLurkLevel = 4;
    const capped = draw('normal');
    N.ai.floorStreak = 0; N.ai._lastLurkLevel = null;
    // 監督役の段階: 遭遇の直後は calm、240 秒以上なければ tense
    N.ai.lastEncounter = N.ai.time; const p1 = N.ai.phase();
    N.ai.lastEncounter = N.ai.time - 150; const p2 = N.ai.phase();
    N.ai.lastEncounter = N.ai.time - 300; const p3 = N.ai.phase();
    N.ai.lastEncounter = N.ai.time - 120;
    return { pass: top(normal) === 4 && tense[4] > normal[4] && calm[4] < normal[4] && noisy[6] > normal[6] && !capped[4] && p1 === 'calm' && p2 === 'normal' && p3 === 'tense',
      playerFloor: 4, draws1000: { normal, calm, tense, noisy6F: noisy, stayCapped4F: capped }, phases: [p1, p2, p3], weightsNormal: N.ai.floorWeights('normal') };
  });
  function AI_STAY() { return 2; }

  // 18) EV の賭け: 管理人を乗せたカゴが止まってから T 秒以内に別の階で呼ぶ → チャイム → 扉が開くと中に管理人(近ければ襲撃、3m 以上離れれば追跡)。T を過ぎれば空のカゴ
  await T('18_ev_gamble', () => {
    const ev = N.elevator, panel = N.hud.evPanel;
    const callHere = () => {   // 4F の EV ホールで呼びボタンを E(本物の操作の経路: main → elevator.call → ai.evGambleCheck)
      const ex = panel.x - 0.9 * 0.2, ez = panel.z - 0.9;
      N.setView(ex, ez, Math.atan2(-(panel.x - ex), -(panel.z - ez)), 0); N.pump(DT, 2, false);
      W.key('KeyE', true); N.pump(DT, 3, false); W.key('KeyE', false); N.pump(DT, 2, false);
    };
    const setup = (age) => {
      W.reset(); N.ai.lurkEnabled = false;
      N.ai.reset(6.9, 19.5, Math.PI, 6); N.ai.setState('PATROL', { force: true });
      Object.assign(ev.car, { level: 6, state: 'idle', open: 0, pending: [], riding: false, to: null });
      ev.npc = null; ev.npcStop = { level: 6, t: ev.time - age };
      N.pump(DT, 2, false);
    };
    const runCase = (age, walkAway) => {
      setup(age);
      const ev0 = evMark(), e0 = ev.logCount || 0;
      callHere();
      let t = 0, chimeAt = null, openStartAt = null, openFullAt = null, attack = false, chase = false, dead = false, inCarAtOpen = null;
      for (let i = 0; i < Math.round(30 / DT); i++) {
        N.pump(DT, 1, false); t += DT;
        const evs = ev.events.filter((x) => x.n > e0);
        if (chimeAt === null && evs.some((x) => x.ev === 'sfx' && x.name === 'chime') && ev.car.level === 4) { chimeAt = t; if (walkAway) { N.setView(6.9, 16.5, 0, 0); } }
        if (chimeAt !== null && openStartAt === null && ev.car.state === 'opening') openStartAt = t;
        if (chimeAt !== null && openFullAt === null && ev.car.open >= 1) { openFullAt = t; inCarAtOpen = N.ai.level === 4 && !N.ai.transit && N.enemyObj.root.visible; }
        if (N.ai.state === 'ATTACK') attack = true;
        if (N.ai.state === 'CHASE') chase = true;
        if (N.deathState()) { dead = true; break; }
        if (openFullAt !== null && t - openFullAt > 3) break;
      }
      for (let i = 0; i < Math.round(6 / DT) && N.deathState(); i++) N.pump(DT, 1, false);
      return { ambush: has(ev0, 'ev_ambush'), decided: (evSince(ev0).find((e) => /^ev_ambush_/.test(e.ev)) || {}).ev || null, chimeToOpenStart_s: chimeAt !== null && openStartAt !== null ? +(openStartAt - chimeAt).toFixed(2) : null, chimeToFullOpen_s: chimeAt !== null && openFullAt !== null ? +(openFullAt - chimeAt).toFixed(2) : null,
        managerInCarAtOpen: inCarAtOpen, attack, chase, out: dead, managerLevel: N.ai.level };
    };
    const near = runCase(5, false);
    const away = runCase(5, true);
    const late = runCase(40, false);
    N.ai.lurkEnabled = true;
    return { pass: near.ambush && near.managerInCarAtOpen && near.attack && near.out && near.chimeToFullOpen_s >= 1.5 && near.chimeToFullOpen_s <= 2.0
      && away.ambush && away.decided === 'ev_ambush_chase' && away.chase && near.decided === 'ev_ambush_attack' && !late.ambush && !late.managerInCarAtOpen && late.managerLevel === 6 && !late.out,
      T_s: N.ai.constructor === Object ? null : 25, calledWithin5s: near, walkedAway: away, calledAfter40s: late };
  });

  // 19) 管理人がプレイヤーの階に着くたびに一度だけ「管理人が同じ階で…」(3 秒)。同じ滞在中に二度は出ない。出て行って戻ると、また出る
  await T('19_same_floor_notice', () => {
    W.reset(); N.ai.lurkEnabled = false;
    N.setView(6.9, 10.0, Math.PI, 0);
    const n0 = N.hud.noticeLog.length;
    N.ai.reset(6.9, 20.6, Math.PI, 2);
    const go = (lv, x = 12.0) => { N.ai.lastKnown = { x, z: 21.2, lv }; N.ai.setState('ALERT', { force: true, log: true, react: false }); let t = 0; while (t < 90 && !(N.ai.level === lv && !N.ai.transit)) { N.pump(DT, 1, false); t += DT; } return t; };
    const t1 = go(4);
    N.pump(DT, 20, false);
    const shown1 = N.hudState().notice;
    const c1 = N.hud.noticeLog.length - n0;
    for (let i = 0; i < Math.round(12 / DT); i++) N.pump(DT, 1, false);   // 同じ滞在(4F で探し回る)
    const c1b = N.hud.noticeLog.length - n0;
    const hidAfter = N.hudState().notice === '';
    go(5); const c2 = N.hud.noticeLog.length - n0;     // 5F へ(プレイヤーは 4F): 出ない
    go(4); const c3 = N.hud.noticeLog.length - n0;     // 戻ってきた: また出る
    N.ai.lurkEnabled = true;
    return { pass: c1 === 1 && shown1.includes('管理人が同じ階で「プレイヤー」をさがしている') && c1b === 1 && hidAfter && c2 === 1 && c3 === 2,
      text: shown1, arrive4F_s: +t1.toFixed(1), countAfterArrival: c1, countSameStay12s: c1b, hiddenAfter3s: hidAfter, countAfter5F: c2, countAfterReturn: c3 };
  });

  // 20) ガタガタ扉は存在しない(2026-11-02 ユーザー指示で廃止・P5b-6b): door_fx に rattle の API・タイマー・stats 項目が無い。
  //  10 分(旧: 初回 90〜160 秒・以後 150〜300 秒おき)進めても、プレイヤーの階の空室の扉は一度も揺れず(扉板の回転 0)・開かず・
  //  doorFx の rattle イベントも 'slam' の再生も無い。隙間(帯)は残っている
  await T('20_no_rattle_door', () => {
    W.reset(); N.ai.lurkEnabled = false;
    N.ai.setState('SCRIPTED', { force: true }); N.enemy.place(6.9, 20.6, Math.PI);
    N.setView(6.9, 8.0, Math.PI, 0);
    const F = N.doorFx;
    const noApi = typeof F.rattle === 'undefined' && typeof F._scheduleRattle === 'undefined' && !('rattleT' in F) && !('rattling' in F)
      && !('rattleIn' in F.stats()) && !('rattling' in F.stats());
    const lurkDoors = N.doors.filter((d) => d.level === 4 && d.lurkable);
    const a0 = aud0(), r0 = F.time;
    let maxRot = 0, maxAngle = 0, shakeSeen = false, opened = false;
    const FR = 6000, STEP = 0.1;   // 600 秒
    for (let i = 0; i < FR; i++) {
      N.pump(STEP, 1, false);
      for (const d of lurkDoors) {
        if (d.shake !== undefined) shakeSeen = true;
        maxAngle = Math.max(maxAngle, d.angle);
        if (d.collision && d.collision.disabled) opened = true;
        if (d.node) maxRot = Math.max(maxRot, Math.abs(d.node.rotation.y));
      }
    }
    const rattleEv = F.events.filter((x) => x.t >= r0 - 0.01 && x.ev === 'rattle').length;
    const slam = sounds(a0).includes('slam');
    const strips = F.stats().strips.reduce((n, [, c]) => n + c, 0);
    return { pass: noApi && !shakeSeen && maxRot < 1e-6 && maxAngle === 0 && !opened && rattleEv === 0 && !slam && strips > 0,
      noRattleApi: noApi, doors: lurkDoors.length, simulated_s: +(FR * STEP).toFixed(0), doorLeafRotationMax: maxRot, doorOpenAngleMax: maxAngle, collisionOpened: opened, shakeFieldSeen: shakeSeen, rattleEvents: rattleEv, slamPlayed: slam, gapStrips: strips };
  });

  // 21) 窓越しの管理人: 本体が別の階にいる時、廊下端の窓の外(敷地)に現れ、3 秒見続けると消える/見た後に視線を外すと消える。本体が同じ階なら出ない
  await T('21_window_watcher', async () => {
    W.reset(); N.ai.lurkEnabled = false;
    await N.loadExterior();
    const Wt = N.watcher;
    const wasEnabled = Wt.enabled; Wt.enabled = true;
    N.ai.reset(6.9, 20.6, Math.PI, 2); N.ai.setState('SCRIPTED', { force: true });
    const lookAt = () => { const s = Wt.active.spot, p = N.camera.position; const dx = s.x - p.x, dz = s.z - p.z, dy = s.y + 1.2 - p.y; N.player.object.rotation.set(Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(-dx, -dz), 0, 'YXZ'); };
    // a) 窓に背を向けて置く → 窓へ向き直って見続ける → 3 秒で消える
    N.setView(25.65, 21.2, Math.PI / 2, 0); N.pump(DT, 2, false);
    const placedA = Wt.force();
    const spotA = Wt.active && Wt.active.spot.id, visA = Wt.root && Wt.root.visible;
    if (Wt.active) lookAt();
    let t = 0, goneA = null;
    for (let i = 0; i < Math.round(5 / DT) && goneA === null; i++) { N.pump(DT, 1, false); t += DT; if (!Wt.active) goneA = t; }
    const whyA = (Wt.events.filter((e) => e.ev === 'hide').pop() || {}).why;
    // b) 見て(0.5 秒)から視線を外す → 戻すともういない
    N.setView(25.65, 21.2, Math.PI / 2, 0); N.pump(DT, 2, false);
    const placedB = Wt.force();
    if (Wt.active) lookAt();
    N.pump(DT, 30, false);
    const seenB = Wt.active && Wt.active.seenOnce;
    N.player.object.rotation.set(0, Math.PI / 2, 0, 'YXZ'); N.pump(DT, 20, false);
    const goneB = !Wt.active, whyB = (Wt.events.filter((e) => e.ev === 'hide').pop() || {}).why;
    // c) 本体が同じ階(4F)なら、間隔が来ても出ない
    N.ai.reset(6.9, 20.6, Math.PI, 4); N.ai.setState('SCRIPTED', { force: true });
    Wt.nextAt = Wt.time; N.player.object.rotation.set(0, Math.PI / 2, 0, 'YXZ');
    for (let i = 0; i < 60; i++) N.pump(DT, 1, false);
    const sameFloorShown = !!Wt.active;
    Wt.enabled = wasEnabled; Wt.hide('test');
    N.ai.lurkEnabled = true;
    return { pass: placedA && visA && goneA !== null && goneA >= 2.9 && goneA <= 3.6 && whyA === 'stared' && placedB && seenB && goneB && whyB === 'looked_away' && !sameFloorShown,
      a: { spot: spotA, visible: visA, goneAfter_s: goneA && +goneA.toFixed(2), why: whyA }, b: { seen: seenB, gone: goneB, why: whyB }, sameFloorShown };
  });

  // 22) 別の階の大きな音: プレイヤーが上の階(5F)で走ると、4F の管理人が EV で 5F へ来る。2 階離れた落下音は届かない(履歴にだけ残る)
  await T('22_cross_floor_noise', () => {
    W.reset(); N.ai.lurkEnabled = false;
    N.ai.reset(6.9, 19.0, Math.PI, 4); N.ai.setState('PATROL', { force: true });
    N.ai._lastFloorGo = -1e9;
    const ev0 = evMark();
    // 2 階離れた(6F)落下音
    N.ai.noiseRoom('607', 15.0, 25.0, 6);
    const fall6 = { went: has(ev0, 'heard_floor'), hist6: +(N.ai.noiseHist[6] || 0).toFixed(2) };
    // 5F で走る(AI から見てプレイヤーは 5F)
    N.ai.playerLevelAt = () => 5;
    N.setView(6.9, 8.0, Math.PI, 0);
    W.key('ShiftLeft', true); W.key('KeyW', true);
    let t = 0, heardAt = null;
    for (let i = 0; i < Math.round(3 / DT); i++) { N.pump(DT, 1, false); t += DT; if (heardAt === null && has(ev0, 'heard_floor')) heardAt = t; }
    W.key('KeyW', false); W.key('ShiftLeft', false);
    while (t < 80 && !(N.ai.level === 5 && has(ev0, 'transfer_end'))) { N.pump(DT, 1, false); t += DT; }
    const vias = evSince(ev0).filter((e) => e.ev === 'transfer_end').map((e) => e.via);
    const hf = evSince(ev0).find((e) => e.ev === 'heard_floor');
    N.ai.lurkEnabled = true;
    return { pass: !fall6.went && fall6.hist6 > 0 && heardAt !== null && hf && hf.lv === 5 && hf.kind === 'run' && N.ai.level === 5 && vias.length > 0 && vias.every((v) => v === 'ev'),
      fall2FloorsAway: fall6, heardRunAfter_s: heardAt && +heardAt.toFixed(2), heard: hf && { lv: hf.lv, kind: hf.kind, heard: hf.heard }, arrived5F_s: +t.toFixed(1), vias };
  });

  // 23) 静かな予兆: 潜伏中の部屋だけ扉の下の帯が揺らぐ。扉から 1.5m 以内で 1 秒以上静止すると、ごく小さな呼吸音
  await T('23_omen_strip_and_breath', () => {
    W.reset(); N.ai.lurkEnabled = false;
    N.setView(6.9, 8.5, Math.PI, 0);
    lurkIn('408');
    for (let i = 0; i < Math.round(3 / DT); i++) N.pump(DT, 1, false);
    const fx = N.doorFx.stats();
    const st4 = N.doorFx.strips.get(4);
    const idx = st4.ids.indexOf('408');
    const uni = { lurk: st4.u.uLurk.value, amt: +st4.u.uAmt.value.toFixed(2) };
    // 扉の正面 1.0m(帯の中)で静止 → 1 秒後に呼吸
    const a0 = aud0(), ev0 = N.ai.events.length;
    N.setView(6.8, 13.05, -Math.PI / 2, 0);
    let t = 0, breathAt = null;
    for (let i = 0; i < Math.round(3 / DT); i++) { N.pump(DT, 1, false); t += DT; if (breathAt === null && sounds(a0).includes('breathDoor')) breathAt = t; }
    const passWhileStill = has(ev0, 'lurk_pass');
    const vol = (audSince(a0).find((l) => l.name === 'breathDoor') || {}).vol;
    // 歩いている(静止していない)間は鳴らない
    N.ai.reset(6.9, 20.6, Math.PI, 4); lurkIn('408');
    const a1 = aud0();
    N.setView(6.9, 12.2, Math.PI, 0); W.key('KeyW', true);
    for (let i = 0; i < Math.round(0.9 / DT); i++) N.pump(DT, 1, false);
    W.key('KeyW', false);
    const breathWalking = sounds(a1).includes('breathDoor');
    N.ai.reset(6.9, 20.6, Math.PI, 4);
    N.ai.lurkEnabled = true;
    return { pass: fx.lurkId === '408' && fx.lurkAmt > 0.9 && uni.lurk === idx && uni.amt > 0.9 && breathAt !== null && breathAt >= 0.95 && breathAt < 1.6 && vol < 0.3 && !passWhileStill && !breathWalking,
      strip: { ...uni, index408: idx }, breathAfterStill_s: breathAt && +breathAt.toFixed(2), breathVolume: vol, passWhileStanding: passWhileStill, breathWhileWalking: breathWalking };
  });

  // 24) P6a: タイトルと場面を映すチュートリアルは ?test(tutorial 以外)では出ない(P5a の仮の文字カードは P6a で置き換えた。中身は ?test=tutorial)
  //  P6b-F1(§3.12 #1): タイトルの背景(4F の廊下・演出体の管理人・露出 4.3・視野角 46°・灯りの manual・血)を DOM なしで回して片付けると、
  //   タイトル → 通常プレイの状態が開始前と一致する(管理人・プレイヤーの階と位置・露出・霧・環境光・視野角・懐中電灯・灯りの倍率・外観の強制・HUD)。
  //   背景の間はゲームの時間(AI の時計・物語)が進まない
  await T('24_tutorial_not_under_test', async () => {
    const tu = N.tutorial, ti = N.title;
    const autoShown = tu.active || tu.log.length > 0;
    const noTitle = !autoShown && !ti.active && !ti.state().shown && !document.getElementById('title');
    W.reset();
    await N.teleport(4, 8.75, 7.3, Math.PI / 2); N.pump(DT, 10, false);
    N.ai.reset(N.ENEMY_HOME.x, N.ENEMY_HOME.z, N.ENEMY_HOME.yaw, 4);   // 起動直後と同じ(EV ホールで置き直したばかり。タイトルの片付けも同じ置き直しをする)
    const snap = () => {
      const a = N.ai.stats(), p = N.player.pos, e = N.enemyObj;
      return { ai: { state: a.state, level: a.level, pos: a.pos, concealed: N.ai.concealed, dormant: N.ai.dormant }, level: N.level, pos: [+p.x.toFixed(3), +p.z.toFixed(3)],
        yaw: +N.camera.rotation.y.toFixed(3), exposure: N.renderer.toneMappingExposure, fog: +N.scene.fog.density.toFixed(5), ambient: +N.ambientFloor.intensity.toFixed(4), fov: N.camera.fov,
        flashlight: N.player.flashlightOn, frozen: N.player.frozen, lm: N.power.state().lm, em: N.power.state().em, manual: N.power.state().manual,
        extForce: N.exterior.force, hud: N.hud.root.style.visibility, face: { g: +e.face.grin.toFixed(3), a: +e.face.attack.toFixed(3) } };
    };
    const before = snap();
    const aiT0 = N.ai.time, story0 = N.story && N.story.time;
    const started = ti.preview(true);
    const mid = [];
    for (let i = 0; i < 6 * 60; i++) { N.pump(DT, 1, false); if (i % 60 === 30) mid.push({ exp: N.renderer.toneMappingExposure, fov: N.camera.fov, lvl: N.level, enemy: [+N.enemyObj.pos.x.toFixed(2), +N.enemyObj.pos.z.toFixed(2)], vis: N.enemyObj.root.visible, manual: N.power.state().manual }); }
    const during = { aiFrozen: N.ai.time === aiT0, storyFrozen: !N.story || N.story.time === story0, bg: ti.state().bg && { flicks: ti.state().bg.flicks, ready: ti.state().bg.ready } };
    ti.preview(false);
    const after = snap();
    const same = JSON.stringify(before) === JSON.stringify(after);
    const midOk = mid.length >= 5 && mid.every((m) => m.exp === 4.3 && m.fov === 46 && m.lvl === 4 && m.vis && m.manual && Math.abs(m.enemy[0] - 6.85) < 0.01 && Math.abs(m.enemy[1] - 10.0) < 0.01);
    N.ai.reset(N.ENEMY_HOME.x, N.ENEMY_HOME.z, N.ENEMY_HOME.yaw, 4);
    return { pass: noTitle && started && midOk && during.aiFrozen && during.storyFrozen && same && !ti.active,
      autoShownUnderTest: autoShown, title: ti.state(), mid: mid.slice(0, 2), during, same, before, after };
  });

  // ------------------------------------------------------------ P5b-6: 逃げ込みの確率(DESIGN §3.4.1)
  const room410 = N.building.floors.find((f) => f.level === 4).rooms.find((r) => r.id === '410');
  const H410 = room410.interior.hide;
  const evOf = (ev0) => N.ai.events.slice(ev0);
  const rolls = (ev0) => evOf(ev0).filter((e) => e.ev === 'hide_roll').map((e) => ({ kind: e.kind, p: e.p, r: e.r, result: e.result }));
  // 乱数を差し替える: v を返す。switchTo = { after: 'enter', v } なら enter の判定の後で値を変える(扉前と開ける判定は別に引く)
  const fixRand = (v, switchTo = null) => {
    const s = { v };
    N.ai._rand = () => {
      if (switchTo && !s.switched && N.ai.events.some((e) => e.ev === 'hide_roll' && e.kind === switchTo.after && e.t >= s.t0)) { s.v = switchTo.v; s.switched = true; }
      return s.v;
    };
    s.t0 = N.ai.time;
    return s;
  };
  // 410 に逃げ込んだ状況を作る: 扉は閉める(open なら開けたまま)、hide ならクローゼットの中。管理人は廊下の南 5m で「410 にいる」と知っている
  const setupHide = ({ hide = false, open = false } = {}) => {
    W.reset(); N.ai.lurkEnabled = false;
    if (open) { N.doorApi.open('410'); N.pump(DT, 60, false); }
    N.setFlashlight(false);
    if (hide) {
      N.setView(H410.out[0], H410.out[1], 0, 0); N.pump(DT, 2, false);
      N.rooms.hide('410');
      for (let i = 0; i < 90; i++) N.pump(DT, 1, false);
    } else {
      N.setView(8.75, 7.3, Math.PI / 2, 0); N.pump(DT, 2, false);
    }
    N.enemy.place(6.9, 12.5, Math.PI);
    N.ai.knownRoomId = '410';
    N.ai.lastKnown = { x: 8.7, z: 7.4, lv: 4 };
    N.ai.setState(hide ? 'PATROL' : 'ALERT', { force: true, log: true, react: false });   // 隠れていれば update が LOCKER へ
    return N.ai.events.length;
  };
  // 進める。stop(evs) が真になるか死んで 0.5 秒で止める。扉の揺れ(閉じたまま扉板が動いた最大角)と死亡時刻を記録
  const runHide = (ev0, maxSec, stop = null) => {
    let t = 0, deadAt = null, rattleMax = 0, doorMax = 0;
    const d = W.door410();
    for (let i = 0; i < Math.round(maxSec / DT); i++) {
      N.pump(DT, 1, false); t += DT;
      rattleMax = Math.max(rattleMax, d.rattle || 0);   // P5b-6: 扉は揺らさない(door.rattle は常に 0)
      doorMax = Math.max(doorMax, d.angle);
      if (deadAt === null && N.deathState()) deadAt = t;
      if (deadAt !== null && t - deadAt > 0.5) break;
      if (stop && stop(evOf(ev0))) break;
    }
    return { t, deadAt, rattleMax, doorMax, evs: evOf(ev0).map((e) => e.ev) };
  };
  const tline = (ev0, keep) => evOf(ev0).filter((e) => keep.includes(e.ev)).map((e) => `${e.t.toFixed(1)} ${e.ev}${e.kind ? ':' + e.kind + '=' + e.result : ''}${e.to ? ':' + e.to : ''}`);
  const KEEP = ['hide_roll', 'hide_stand', 'hide_forget', 'hide_left', 'hide_grace_end', 'door_open_in', 'entered', 'locker_start', 'locker_tease', 'locker_spare', 'locker_open', 'attack_start', 'hit', 'door_closed', 'seen', 'scope_stare', 'scope_knob', 'door_opened'];

  // 25) 定数と URL の上書き: 起動時の値 = ?pEnter/?pCloset(無ければ HIDE_ODDS = 0.7/0.5)。数でない値は既定、範囲外は 0..1。開ける確率 = closet/enter
  await T('25_hide_odds_params', () => {
    const want = hideOddsFrom(location.search);
    const near = (a, b) => Math.abs(a - b) < 1e-9;
    const startOk = near(ODDS0.enter, want.enter) && near(ODDS0.closet, want.closet) && near(N.hideOdds.start.enter, want.enter) && near(N.hideOdds.start.closet, want.closet);
    const p1 = hideOddsFrom('?pEnter=0.3&pCloset=0.2'), p2 = hideOddsFrom('?pEnter=2&pCloset=-1'), p3 = hideOddsFrom('?pEnter=abc&pCloset='), p4 = hideOddsFrom('?pCloset=0.25');
    N.ai.setHideOdds({ ...HIDE_ODDS });
    const def = N.hideOdds, st = N.ai.stats().hideOdds;
    const pass = startOk && HIDE_ODDS.enter === 0.7 && HIDE_ODDS.closet === 0.5
      && near(p1.enter, 0.3) && near(p1.closet, 0.2) && p2.enter === 1 && p2.closet === 0 && p3.enter === 0.7 && p3.closet === 0.5 && p4.enter === 0.7 && p4.closet === 0.25
      && Math.abs(def.open - 0.5 / 0.7) < 0.001 && st && st.enter === 0.7 && st.closet === 0.5;
    return { pass, url: location.search, startOdds: ODDS0, fromUrl: want, HIDE_ODDS, parsed: { p1, p2, p3, p4 }, openOdds: def.open, statsHideOdds: st, grace_s: HIDE_FORGET.grace };
  });

  // 26) 扉を閉めるだけ・入らない(30% 側): 扉の前で 1 回引いて外れ → 足音を止めて 1.5〜2.5 秒立ち止まり、無言で立ち去る(扉は揺らさない)・部屋を忘れる・猶予
  await T('26_hide_door_refuse', () => {
    const ev0 = setupHide();
    N.ai.setHideOdds({ ...HIDE_ODDS }); fixRand(0.95);
    const a0 = N.enemyAudio.log.length;
    const r = runHide(ev0, 40, (evs) => evs.some((e) => e.ev === 'hide_forget'));
    const stand = evOf(ev0).find((e) => e.ev === 'hide_stand'), fg = evOf(ev0).find((e) => e.ev === 'hide_forget');
    const standSec = stand && fg ? +(fg.t - stand.t).toFixed(2) : null;
    const rattleSounds = N.enemyAudio.log.slice(a0).filter((l) => l.name === 'rattle').length;
    const atForget = { state: N.ai.state, known: N.ai.knownRoomId, grace: N.ai.stats().grace };
    let away = 0; for (let i = 0; i < Math.round(8 / DT); i++) { N.pump(DT, 1, false); away = Math.hypot(N.enemyObj.pos.x - 7.8, N.enemyObj.pos.z - 7.25); }
    const rl = rolls(ev0);
    N.ai._rand = N.ai._rand0;
    const pass = rl.length === 1 && rl[0].kind === 'enter' && rl[0].p === 0.7 && rl[0].result === 'refuse' && r.evs.includes('hide_stand') && standSec >= 1.45 && standSec <= 2.6
      && r.rattleMax === 0 && rattleSounds === 0
      && !r.evs.includes('door_open_in') && r.doorMax < 0.01 && atForget.state === 'PATROL' && atForget.known === null && atForget.grace && atForget.grace.room === '410'
      && r.deadAt === null && !N.deathState() && away > 3.0;
    return { pass, rolls: rl, standBeforeLeaving_s: standSec, doorRattleMax: r.rattleMax, rattleSounds, doorMaxAngle: +r.doorMax.toFixed(3), atForget, enemyFromDoorAfter8s_m: +away.toFixed(2), timeline: tline(ev0, KEEP) };
  });

  // 27) 猶予: 忘れた部屋は猶予の間、光漏れ・物音で再発見しない → 猶予が切れたら通常どおり(光漏れで知る)。扉を開けた・部屋を出たら猶予は即終わる
  await T('27_hide_grace', () => {
    const ev0 = setupHide();
    N.ai.setHideOdds({ ...HIDE_ODDS }); fixRand(0.95);
    runHide(ev0, 40, (evs) => evs.some((e) => e.ev === 'hide_forget'));
    N.ai._rand = N.ai._rand0;
    const forgetAt = N.ai.time;
    // 猶予の間: 管理人を扉の前 1.5m に戻し(巡回)、室内で点灯・物音(扉の聴覚半径の音・落ちる物)
    N.enemy.place(6.9, 8.6, Math.PI); N.ai.setState('PATROL', { force: true });
    N.setFlashlight(true);
    N.ai.noise(8.75, 7.3, 9.0);
    const fell = N.ai.noiseRoom('410', 8.75, 7.3, 4);
    let learnedIn = null, alertIn = false;
    while (N.ai.time - forgetAt < HIDE_FORGET.grace - 0.3) {
      N.pump(DT, 1, false);
      if (N.ai.knownRoomId) learnedIn = learnedIn || +(N.ai.time - forgetAt).toFixed(2);
      if (N.ai.state === 'ALERT') alertIn = true;
      if (N.enemyObj.pos.z > 10.5) { N.enemy.place(6.9, 8.6, Math.PI); }   // 巡回で離れたら戻す(6m 以内に置き続ける)
    }
    const graceStill = !!N.ai.stats().grace;
    // 猶予が切れる → 光漏れで知る
    let endWhy = null, learnedAfter = null;
    for (let i = 0; i < 120; i++) {
      N.pump(DT, 1, false);
      if (N.enemyObj.pos.z > 10.5) N.enemy.place(6.9, 8.6, Math.PI);
      const ge = evOf(ev0).find((e) => e.ev === 'hide_grace_end'); if (ge) endWhy = ge.why;
      if (N.ai.knownRoomId) { learnedAfter = (evOf(ev0).filter((e) => e.ev === 'room_known').pop() || {}).why; break; }
    }
    N.setFlashlight(false);
    // 扉を開けたら即終わる / 部屋を出たら即終わる
    N.ai.setState('SCRIPTED', { force: true });
    N.ai._forgetRoom('410', 'test'); N.pump(DT, 2, false);
    N.doorApi.open('410'); N.pump(DT, 1, false);
    const byDoor = (evOf(ev0).filter((e) => e.ev === 'hide_grace_end').pop() || {}).why;
    N.doorApi.close('410'); N.pump(DT, 60, false);
    N.ai._forgetRoom('410', 'test'); N.pump(DT, 2, false);
    N.setView(6.9, 7.3, 0, 0); N.pump(DT, 1, false);
    const byLeave = (evOf(ev0).filter((e) => e.ev === 'hide_grace_end').pop() || {}).why;
    const pass = fell === false && learnedIn === null && !alertIn && graceStill && endWhy === 'time' && learnedAfter === 'light' && byDoor === 'door' && byLeave === 'left';
    return { pass, noiseRoomDuringGrace: fell, learnedDuringGrace_s: learnedIn, alertDuringGrace: alertIn, graceAliveAt9_7s: graceStill, graceEnd: endWhy, learnedAfterGraceWhy: learnedAfter, endByDoorOpen: byDoor, endByLeavingRoom: byLeave };
  });

  // 28) 扉を閉めるだけ・入ってくる(70% 側): 入って → 襲撃(従来どおり)
  await T('28_hide_door_enter_attack', () => {
    const ev0 = setupHide();
    N.ai.setHideOdds({ ...HIDE_ODDS }); fixRand(0.1);
    const r = runHide(ev0, 45);
    const rl = rolls(ev0);
    N.ai._rand = N.ai._rand0;
    const order = ['hide_roll', 'door_open_in', 'entered', 'attack_start', 'hit'];
    let k = 0; for (const e of r.evs) if (e === order[k]) k++;
    const pass = rl.length === 1 && rl[0].kind === 'enter' && rl[0].result === 'enter' && k === order.length && r.deadAt !== null && !r.evs.includes('hide_forget');
    return { pass, rolls: rl, deadAt_s: r.deadAt && +r.deadAt.toFixed(1), timeline: tline(ev0, KEEP) };
  });

  // 29) 扉を閉めてクローゼット・入らない(30% 側): 扉の前で外れ → 立ち止まって立ち去る。クローゼットの前の焦らしは無い・隠れたまま
  await T('29_hide_closet_refuse_at_door', () => {
    const ev0 = setupHide({ hide: true });
    N.ai.setHideOdds({ ...HIDE_ODDS }); fixRand(0.95);
    const r = runHide(ev0, 40, (evs) => evs.some((e) => e.ev === 'hide_forget'));
    for (let i = 0; i < Math.round(4 / DT); i++) N.pump(DT, 1, false);
    const rl = rolls(ev0);
    N.ai._rand = N.ai._rand0;
    const stillHidden = !!N.rooms.state().hidden;
    const pass = r.evs.includes('locker_start') && rl.length === 1 && rl[0].kind === 'enter' && rl[0].result === 'refuse' && r.evs.includes('hide_stand') && r.rattleMax === 0
      && !r.evs.includes('locker_tease') && !r.evs.includes('door_open_in') && r.deadAt === null && stillHidden && N.ai.knownRoomId === null && N.ai.state !== 'LOCKER';
    return { pass, rolls: rl, stillHidden, stateAfter: N.ai.state, timeline: tline(ev0, KEEP) };
  });

  // 30) 扉を閉めてクローゼット・入るが去る(20% 側): 入る(0.5 < 0.7)→ 焦らす → 開けるかは別に引く(0.9 ≥ 0.714)→ 手を掛けたまま離れ、部屋を出て扉を閉める・忘れる
  await T('30_hide_closet_spare', () => {
    const ev0 = setupHide({ hide: true });
    N.ai.setHideOdds({ ...HIDE_ODDS }); fixRand(0.5, { after: 'enter', v: 0.9 });
    const r = runHide(ev0, 60, (evs) => evs.some((e) => e.ev === 'hide_left'));
    const graceAtLeft = N.ai.stats().grace;   // 出て行って扉を閉めた時から猶予を数え直す
    N.pump(DT, 60, false);   // 扉が閉じ切るまで
    const rl = rolls(ev0);
    N.ai._rand = N.ai._rand0;
    const e = N.enemyObj.pos;
    const away = Math.hypot(e.x - H410.feet[0], e.z - H410.feet[1]);
    const order = ['hide_roll', 'door_open_in', 'entered', 'locker_tease', 'hide_roll', 'locker_spare', 'hide_forget', 'door_closed', 'hide_left'];
    let k = 0; for (const ev of r.evs) if (ev === order[k]) k++;
    const spare = evOf(ev0).find((x) => x.ev === 'locker_spare'), tease = evOf(ev0).find((x) => x.ev === 'locker_tease');
    const pass = rl.length === 2 && rl[0].kind === 'enter' && rl[0].result === 'enter' && rl[1].kind === 'closet' && Math.abs(rl[1].p - 0.714) < 0.001 && rl[1].result === 'spare'
      && rl[0].r !== rl[1].r && k === order.length && !r.evs.includes('locker_open') && !r.evs.includes('attack_start') && r.deadAt === null
      && !!N.rooms.state().hidden && N.ai.knownRoomId === null && W.door410().angle < 0.01 && away > 2.0
      && graceAtLeft && Math.abs(graceAtLeft.left_s - HIDE_FORGET.grace) < 0.05 && !graceAtLeft.leaving;
    return { pass, rolls: rl, graceAtLeft, teaseToSpare_s: spare && tease && +(spare.t - tease.t).toFixed(2), enemyFromCloset_m: +away.toFixed(2), doorAngleAfter: +W.door410().angle.toFixed(3), stillHidden: !!N.rooms.state().hidden, timeline: tline(ev0, KEEP) };
  });

  // 31) 扉を閉めてクローゼット・捕まる(50% 側): 入る → 焦らす → 開ける → OUT
  await T('31_hide_closet_open_out', () => {
    const ev0 = setupHide({ hide: true });
    N.ai.setHideOdds({ ...HIDE_ODDS }); fixRand(0.5);
    const r = runHide(ev0, 60);
    const rl = rolls(ev0);
    N.ai._rand = N.ai._rand0;
    const order = ['hide_roll', 'door_open_in', 'locker_tease', 'hide_roll', 'locker_open', 'attack_start', 'hit'];
    let k = 0; for (const ev of r.evs) if (ev === order[k]) k++;
    const pass = rl.length === 2 && rl[0].result === 'enter' && rl[1].kind === 'closet' && rl[1].result === 'open' && k === order.length && r.deadAt !== null;
    return { pass, rolls: rl, deadAt_s: r.deadAt && +r.deadAt.toFixed(1), timeline: tline(ev0, KEEP) };
  });

  // 32) 扉を開けたまま: 入室率は 100%(enter の判定を引かない。pEnter=0 でも入る)。クローゼットの判定は引く(enter=0 の時は closet そのまま)
  await T('32_hide_open_door_always_enters', () => {
    const ev0 = setupHide({ hide: true, open: true });
    N.ai.setHideOdds({ enter: 0, closet: 1 }); fixRand(0.5);
    const r = runHide(ev0, 60);
    const rl = rolls(ev0);
    N.ai._rand = N.ai._rand0;
    const pass = rl.length === 1 && rl[0].kind === 'closet' && rl[0].p === 1 && rl[0].result === 'open' && r.evs.includes('locker_tease') && r.deadAt !== null && !r.evs.includes('hide_stand');
    return { pass, rolls: rl, deadAt_s: r.deadAt && +r.deadAt.toFixed(1), timeline: tline(ev0, KEEP) };
  });

  // 33) 去る前に出てくると見つかる: 開けずに離れた直後にクローゼットから出る → 目撃(通常の視認)→ 追跡 → 猶予は終わる
  await T('33_hide_spare_come_out_seen', () => {
    const ev0 = setupHide({ hide: true });
    N.ai.setHideOdds({ ...HIDE_ODDS }); fixRand(0.5, { after: 'enter', v: 0.9 });
    runHide(ev0, 60, (evs) => evs.some((e) => e.ev === 'locker_spare'));
    N.ai._rand = N.ai._rand0;
    for (let i = 0; i < Math.round(HIDE_FORGET.letGo / DT) + 6; i++) N.pump(DT, 1, false);   // 手を離して振り向く
    N.rooms.unhide();
    let seenAt = null, t = 0;
    for (let i = 0; i < Math.round(6 / DT) && seenAt === null; i++) { N.pump(DT, 1, false); t += DT; if (evOf(ev0).some((e) => e.ev === 'seen')) seenAt = t; }
    const ge = evOf(ev0).filter((e) => e.ev === 'hide_grace_end').pop();
    const pass = seenAt !== null && (N.ai.state === 'CHASE' || N.ai.state === 'ATTACK') && ge && ge.why === 'chase';
    for (let i = 0; i < Math.round(6 / DT); i++) N.pump(DT, 1, false);
    return { pass, seenAfterUnhide_s: seenAt && +seenAt.toFixed(2), state: N.ai.state, graceEnd: ge && ge.why, timeline: tline(ev0, KEEP) };
  });

  // 34) スコープ演出①も確率に従う: 覗き返しの後、扉を開ける直前に enter を引く。外れ → 顔を離し、立ち止まって無言で去る(覗き穴は開いたまま・扉は閉じたまま)
  await T('34_scope_refuse', () => {
    W.reset(); N.ai.lurkEnabled = false;
    N.ai.setHideOdds({ ...HIDE_ODDS });
    N.setView(8.75, 7.3, Math.PI / 2, 0); N.setFlashlight(false); N.pump(DT, 2, false);
    N.enemy.place(6.9, 11.5, Math.PI);
    N.ai.knownRoomId = '410';
    N.ai.setState('PATROL', { force: true, log: true });
    N.peephole(true);
    const ev0 = N.ai.events.length;
    fixRand(0.95);
    const r = runHide(ev0, 60, (evs) => evs.some((e) => e.ev === 'hide_forget'));
    const peep = N.peepholeObj.active;
    let away = 0; for (let i = 0; i < Math.round(6 / DT); i++) { N.pump(DT, 1, false); away = Math.hypot(N.enemyObj.pos.x - 7.8, N.enemyObj.pos.z - 7.25); }
    const rl = rolls(ev0);
    N.ai._rand = N.ai._rand0;
    N.peephole(false);
    const pass = r.evs.includes('scope_stare') && rl.length === 1 && rl[0].kind === 'scope' && rl[0].p === 0.7 && rl[0].result === 'refuse' && r.evs.includes('hide_stand') && r.rattleMax === 0
      && !r.evs.includes('scope_knob') && !r.evs.includes('door_opened') && r.doorMax < 0.01 && peep && r.deadAt === null && N.ai.knownRoomId === null && N.enemyObj.lean === 0 && away > 2.0;
    return { pass, rolls: rl, peepholeStillOpen: peep, enemyFromDoorAfter6s_m: +away.toFixed(2), timeline: tline(ev0, KEEP) };
  });

  // 35) 管理人は扉を揺らさない(2026-11-02 ユーザー指示「扉のガタガタ演出も無しにします」): 4F の扉の door.rattle が常に 0・'rattle' の再生 0 回。
  //  場面: 知らない部屋(410・プレイヤーは中・扉は閉)の前で立ち止まって去る(旧: ノブを鳴らす)＋巡回で扉を順に回る(旧: 30% で揺らす。乱数を 0.9/0.1 で交互)
  //  ＋逃げ込みで入らない(旧: 3 回揺らす)。空室の「ガタガタ扉」(door_fx)は P5b-6b で廃止(20 番は不在の確認)
  await T('35_no_door_rattle', () => {
    W.reset(); N.ai.lurkEnabled = false;
    const doors4 = N.doors.filter((d) => d.level === 4);
    const a0 = N.enemyAudio.log.length;
    let maxR = 0, frames = 0;
    const watch = (sec, stop = null) => { for (let i = 0; i < Math.round(sec / DT); i++) { N.pump(DT, 1, false); frames++; for (const d of doors4) maxR = Math.max(maxR, d.rattle || 0); if (stop && stop()) break; } };
    // a) 知らない部屋の前(door_skip_unknown)
    N.setView(8.75, 7.3, Math.PI / 2, 0); N.setFlashlight(false); N.pump(DT, 2, false);
    N.enemy.place(6.9, 11.5, Math.PI);
    N.ai.setState('PATROL', { force: true, log: true }); N.ai.patrolIdx = 5;
    const ev0 = N.ai.events.length;
    N.ai._rand = () => 0.1;
    watch(30, () => N.ai.events.slice(ev0).some((e) => e.ev === 'door_skip_unknown'));
    const skipped = N.ai.events.slice(ev0).some((e) => e.ev === 'door_skip_unknown');
    watch(3);
    // b) 巡回で扉を回る(旧 30% の揺らしの分岐を通る乱数)
    let k = 0; N.ai._rand = () => ((k++ % 2) ? 0.1 : 0.9);
    N.ai.setState('PATROL', { force: true, log: true }); N.ai.patrolIdx = 0;
    watch(60);
    // c) 逃げ込みで入らない
    const ev1 = setupHide(); N.ai.setHideOdds({ ...HIDE_ODDS }); fixRand(0.95);
    watch(40, () => N.ai.events.slice(ev1).some((e) => e.ev === 'hide_forget'));
    const refused = N.ai.events.slice(ev1).some((e) => e.ev === 'hide_stand');
    N.ai._rand = N.ai._rand0;
    const rattleSounds = N.enemyAudio.log.slice(a0).filter((l) => l.name === 'rattle').length;
    const pass = skipped && refused && maxR === 0 && rattleSounds === 0 && !N.deathState();
    return { pass, unknownDoorSkip: skipped, refusedAtDoor: refused, doorRattleMax: maxR, rattleSounds, framesWatched: frames, doorsWatched: doors4.length };
  });

  // ================================================================ P6b-A(DESIGN §3.9 #1・2・3・9・10。通しプレイ 1 回目の指摘)
  const FN = { W: [-1, 0], E: [1, 0], N: [0, -1], S: [0, 1] };
  const doorOf = (rid) => { const R = N.world.roomById.get(String(rid)); return { lv: R.level, pos: R.room.door.pos, n: FN[R.room.door.facing], facing: R.room.door.facing, d: N.doorApi.get(String(rid)) }; };
  // 扉の内側 depth m・扉に正対して立つ(視線 = 廊下側の法線)
  const standInside = async (rid, depth = 0.7) => { const D = doorOf(rid); await N.teleport(D.lv, D.pos[0] - D.n[0] * depth, D.pos[1] - D.n[1] * depth, Math.atan2(-D.n[0], -D.n[1])); N.pump(DT, 30, false); return D; };
  const back4 = async () => { await N.teleport(4, N.CHECKPOINT.x, N.CHECKPOINT.z, N.CHECKPOINT.yaw); N.pump(DT, 10, false); };
  // 見えている部分だけの world AABB(SkinnedMesh はスキニング後の頂点)の、扉面から廊下側への最大突出(m。負 = 部屋の中)
  const _bb = new N.THREE.Box3(), _tb = new N.THREE.Box3();
  const protrusion = (D) => {
    _bb.makeEmpty();
    N.enemyObj.root.updateMatrixWorld(true);
    N.enemyObj.root.traverseVisible((o) => { if (!o.isMesh || !o.geometry) return; _tb.makeEmpty(); _tb.expandByObject(o, !!o.isSkinnedMesh); _bb.union(_tb); });
    if (_bb.isEmpty()) return null;
    const [nx, nz] = D.n;
    return nx > 0 ? _bb.max.x - D.pos[0] : nx < 0 ? D.pos[0] - _bb.min.x : nz > 0 ? _bb.max.z - D.pos[1] : D.pos[1] - _bb.min.z;
  };
  const vRootOf = (D) => (N.enemyObj.pos.x - D.pos[0]) * D.n[0] + (N.enemyObj.pos.z - D.pos[1]) * D.n[1];   // 管理人の足元の扉面からの距離(廊下側 +)
  const spotOn = () => N.enemyObj.root.visible && N.enemyObj.flashlight.light.visible && N.enemyObj.flashlight.light.intensity > 0;

  // 36) #10 監督役の重み: プレイヤーの階 +3.5・緊張 ×1.8。潜伏 1 回ごとの「プレイヤーの階」= 通常 29%・緊張 38%・静か 13%(隣接 3.5×2・残り 4 階 1)
  await T('36_p6b_director_weights', () => {
    W.reset();
    N.ai.reset(6.9, 20.6, Math.PI, 2); N.ai.noiseHist = {}; N.ai.floorStreak = 0; N.ai._lastLurkLevel = null;
    const D = N.ai.cfg.director;
    const share = (ph) => { const w = N.ai.floorWeights(ph); const s = Object.values(w).reduce((a, b) => a + b, 0); return { p4: +(w[4] / s).toFixed(4), w }; };
    const n = share('normal'), te = share('tense'), ca = share('calm');
    const pass = D.player === 3.5 && D.tense.player === 1.8 && Math.abs(n.p4 - 0.2903) < 0.002 && Math.abs(te.p4 - 0.3821) < 0.002 && Math.abs(ca.p4 - 0.1317) < 0.002
      && n.w[3] === 3.5 && n.w[5] === 3.5 && [1, 2, 6, 7].every((l) => n.w[l] === 1) && n.w[4] === 4.5;
    N.ai.reset(N.ENEMY_HOME.x, N.ENEMY_HOME.z, N.ENEMY_HOME.yaw);
    return { pass, playerFloorShare: { normal: n.p4, tense: te.p4, calm: ca.p4 }, weightsNormal: n.w, director: { player: D.player, tensePlayer: D.tense.player } };
  });

  // 37) #1 全室スコープ: 221(2F・南向きの扉)と 605(6F・北向き)で、扉の内側から E 長押し/P → カメラが扉の廊下側(レンズ)・廊下向き。
  //  離すと元に戻る。室内側のドアスコープはその部屋の扉板へ付け替わる。扉から 1.0m より奥・扉を見ていない時は覗けない
  await T('37_p6b_peephole_every_room', async () => {
    W.reset(); N.ai.lurkEnabled = false; N.ai.setState('SCRIPTED', { force: true });
    const res = {};
    for (const rid of ['221', '605']) {
      const D = await standInside(rid, 0.7);
      N.setFlashlight(false);
      const cam = N.camera, y0 = N.player.pos.y;
      const before = { pos: cam.position.clone(), fov: cam.fov };
      const can = N.canPeep(), hint = N.hudState().hint;
      W.key('KeyE', true); N.pump(DT, 30, false);
      const on = { active: N.peepholeObj.active, fov: cam.fov, pos: cam.position.clone(), fwd: cam.getWorldDirection(new N.THREE.Vector3()), room: N.peepholeObj.lens.room };
      W.key('KeyE', false); N.pump(DT, 2, false);
      const off = { active: N.peepholeObj.active, posErr: cam.position.distanceTo(before.pos), fov: cam.fov, door: D.d.target };
      W.key('KeyP', true); N.pump(DT, 2, false); const onP = N.peepholeObj.active && N.peepholeObj.lens.room === rid; W.key('KeyP', false); N.pump(DT, 2, false);
      const v = (on.pos.x - D.pos[0]) * D.n[0] + (on.pos.z - D.pos[1]) * D.n[1];                  // レンズの扉面からの距離(廊下側 +)
      const u = Math.abs((on.pos.x - D.pos[0]) * D.n[1] - (on.pos.z - D.pos[1]) * D.n[0]);           // 扉の中心からの横ずれ
      const dot = on.fwd.x * D.n[0] + on.fwd.z * D.n[1];
      const scopeOn = N.doorScopeDoor;
      // 覗けない: 扉から 1.3m 奥 / 扉に背を向ける
      N.setView(D.pos[0] - D.n[0] * 1.3, D.pos[1] - D.n[1] * 1.3, Math.atan2(-D.n[0], -D.n[1]), 0); N.pump(DT, 2, false); const far = N.canPeep();
      N.setView(D.pos[0] - D.n[0] * 0.7, D.pos[1] - D.n[1] * 0.7, Math.atan2(D.n[0], D.n[1]), 0); N.pump(DT, 2, false); const away = N.canPeep();
      res[rid] = { facing: D.facing, can, hint, on: { active: on.active, fov: on.fov, room: on.room, lensFromDoorFace_m: +v.toFixed(3), lateral_m: +u.toFixed(3), eyeY: +(on.pos.y - levelY(D.lv)).toFixed(3), forwardDotCorridor: +dot.toFixed(4) },
        off: { active: off.active, posErr: +off.posErr.toExponential(1), fov: off.fov, doorTarget: off.door }, pKey: onP, scopeInsideOn: scopeOn, cannotFar: !far, cannotAway: !away, y0 };
      res[rid].pass = can && hint.includes('覗く') && on.active && on.fov === 110 && on.room === rid && v > 0 && v < 0.12 && u < 0.03 && dot > 0.999 && Math.abs(on.pos.y - (levelY(D.lv) + 1.48)) < 0.01
        && !off.active && off.posErr < 1e-6 && off.fov === 68 && off.door === 0 && onP && scopeOn === rid && !far && !away;
    }
    await back4();
    N.ai.lurkEnabled = true;
    return { pass: res['221'].pass && res['605'].pass && N.peepholeObj.lens.room === '410', ...res, lensBackTo410: N.peepholeObj.lens.room };
  });

  // 38) #1 SCOPE(覗き返し)が 221 で成立: 部屋を知られて 221 の覗き穴を覗く → 通り過ぎ → 消える → 戻り → 覗き返し(顔がレンズの 0.3m 以内)→ ノブ → 扉が開く → OUT
  await T('38_p6b_scope_221', async () => {
    W.reset(); N.ai.lurkEnabled = false;
    const D = await standInside('221', 0.7);
    N.setFlashlight(false);
    N.ai.reset(17.4, 21.2, Math.PI / 2, 2);
    N.ai.knownRoomId = '221';
    N.ai.setState('PATROL', { force: true, log: true });
    N.pump(DT, 2, false);
    const ev0 = evMark();
    N.peephole(true);
    const lensRoom = N.peepholeObj.lens.room;
    let t = 0, minFace = Infinity, stareAt = null, attackAfterStare = 0, peepAtKnob = null, hitAt = null, standAt = null;
    for (let i = 0; i < Math.round(70 / DT) && hitAt === null; i++) {
      N.pump(DT, 1, false); t += DT;
      if (N.ai.state === 'SCOPE' && isFinite(N.ai.scopeFaceDist)) minFace = Math.min(minFace, N.ai.scopeFaceDist);
      if (stareAt === null && has(ev0, 'scope_stare')) { stareAt = t; standAt = vRootOf(D); }
      if (stareAt !== null && t - stareAt <= 1.2) attackAfterStare = Math.max(attackAfterStare, N.enemyObj.face.attack);
      if (peepAtKnob === null && has(ev0, 'scope_knob')) peepAtKnob = N.peepholeObj.active;
      if (N.deathState()) hitAt = t;
    }
    const order = ['scope_start', 'scope_pass', 'scope_hide', 'scope_return', 'scope_stare', 'scope_knob', 'door_opened', 'attack_start', 'hit'];
    const evs = evSince(ev0);
    const idx = order.map((k) => evs.findIndex((e) => e.ev === k));
    const inOrder = idx.every((v, i) => v >= 0 && (i === 0 || v > idx[i - 1]));
    const st = evs.find((e) => e.ev === 'scope_start'), kn = evs.find((e) => e.ev === 'scope_knob'), op = evs.find((e) => e.ev === 'door_opened');
    for (let i = 0; i < Math.round(6 / DT); i++) N.pump(DT, 1, false);
    N.peephole(false);
    await back4();
    N.ai.lurkEnabled = true;
    return { pass: lensRoom === '221' && inOrder && st && st.room === '221' && kn && kn.room === '221' && op && op.room === '221' && minFace <= 0.3 && attackAfterStare > 0.9 && peepAtKnob === false && hitAt !== null,
      lensRoom, faceToLensMin_m: +minFace.toFixed(3), stareFromDoorFace_m: standAt && +standAt.toFixed(2), attackWithin1_2s: +attackAfterStare.toFixed(2), peepholeClosedAtKnob: peepAtKnob === false, outAfter_s: hitAt && +hitAt.toFixed(1),
      scope: N.ai.scopeLog, timeline: evs.filter((e) => order.includes(e.ev)).map((e) => `${e.t.toFixed(1)} ${e.ev}`) };
  });

  // 39) #2 クローゼット: 焦らしの間は無言。「みぃつけた」(breath = mgr_line_found_01)は開けると決まった瞬間に 1 回、外れ(spare)は 0 回
  await T('39_p6b_closet_found_only_on_open', () => {
    const runOne = (spare) => {
      const ev0 = setupHide({ hide: true });
      N.ai.setHideOdds({ ...HIDE_ODDS }); fixRand(0.5, spare ? { after: 'enter', v: 0.9 } : null);
      const a0 = aud0(), tEv = evMark();
      let breathBeforeRoll = 0, deadAt = null, t = 0, teaseSeen = false;
      for (let i = 0; i < Math.round(70 / DT); i++) {
        N.pump(DT, 1, false); t += DT;
        const rolled = evSince(tEv).some((e) => e.ev === 'hide_roll' && e.kind === 'closet');
        if (has(tEv, 'locker_tease')) teaseSeen = true;
        if (!rolled) breathBeforeRoll += audSince(a0).filter((l) => l.name === 'breath').length - breathBeforeRoll;
        if (deadAt === null && N.deathState()) deadAt = t;
        if (deadAt !== null && t - deadAt > 0.5) break;
        if (spare && has(tEv, 'hide_left')) break;
      }
      const br = audSince(a0).filter((l) => l.name === 'breath');
      const roll = evSince(tEv).find((e) => e.ev === 'hide_roll' && e.kind === 'closet');
      N.ai._rand = N.ai._rand0;
      void ev0;
      return { teaseSeen, roll: roll && roll.result, foundPlays: br.length, foundScene: br[0] ? br[0].scene || 'silent' : null, beforeRoll: breathBeforeRoll, out: deadAt !== null };
    };
    const sp = runOne(true);
    for (let i = 0; i < 400 && N.deathState(); i++) N.pump(DT, 1, false);
    const op = runOne(false);
    for (let i = 0; i < 400 && N.deathState(); i++) N.pump(DT, 1, false);
    const pass = sp.teaseSeen && sp.roll === 'spare' && sp.foundPlays === 0 && !sp.out && op.teaseSeen && op.roll === 'open' && op.foundPlays === 1 && op.beforeRoll === 0 && op.foundScene === 'enemy_breath_close' && op.out;
    return { pass, spare: sp, open: op };
  });

  // 40) #3 空室潜伏の入室: 4 方向の扉(3F 310 西向き・304 東向き・316 北向き・322 南向き)で、毎フレームの体・ハンマー・懐中電灯の AABB と光を記録。
  //  扉が開き始めてから潜むまで懐中電灯 0・中に収まってから潜むまで廊下側への突出 ≤0・閉める間は扉面から 0.9m 以上(AABB も扉面に触れない)・
  //  閉まり切った時に concealed。続けて「同類」: 潜んでいる間に外へ引き出す理由(向かいの部屋の光漏れ・物音・クローゼット・覗き穴・別の階の音、
  //  入る途中の光漏れ)を 1 つずつ起こし、閉じた空室の中で光る/見える/扉に押し付けて止まる(stuck)フレームが 0 で、扉を開けて出てから動くこと
  await T('40_p6b_room_lurk_no_leak', async () => {
    W.reset(); N.ai.lurkEnabled = false;
    await N.teleport(3, 24.5, 21.2, -Math.PI / 2); N.pump(DT, 20, false);
    N.setFlashlight(false);
    N.ai.playerLevelAt = () => 5;   // 入室の計測の間は見つからない(描画はプレイヤーの実際の階 = 3F)
    const entry = {};
    for (const rid of ['310', '304', '316', '322']) {
      const D = doorOf(rid);
      const tx = D.n[1] !== 0 ? 1 : 0, tz = D.n[1] !== 0 ? 0 : 1;
      N.ai.reset(D.pos[0] + D.n[0] * 0.9 + tx * 3.0, D.pos[1] + D.n[1] * 0.9 + tz * 3.0, 0, 3);
      const ev0 = evMark();
      N.ai.setState('LURK', { force: true, log: true, room: rid });
      let opened = false, spotAfterOpen = 0, fullyIn = false, protAfterIn = 0, maxProtAfterIn = -9, closing = false, minVClosing = 9, maxProtClosing = -9, maxAng = 0, closedNotConcealed = 0, frames = 0, protFrames = 0;
      for (let i = 0; i < Math.round(30 / DT); i++) {
        N.pump(DT, 1, false); frames++;
        const a = D.d.angle; maxAng = Math.max(maxAng, a);
        if (a > 0.01) opened = true;
        if (N.ai.concealed) break;
        const vr = vRootOf(D);
        if (opened && spotOn()) spotAfterOpen++;
        if (opened && N.enemyObj.root.visible && vr < 0.9) {
          const p = protrusion(D); protFrames++;
          if (!fullyIn && p !== null && p <= 0 && vr < 0) fullyIn = true;
          if (fullyIn) { maxProtAfterIn = Math.max(maxProtAfterIn, p); if (p > 0) protAfterIn++; }
          if (maxAng > 1.0 && a < maxAng - 0.01) { closing = true; minVClosing = Math.min(minVClosing, -vr); maxProtClosing = Math.max(maxProtClosing, p); }
        }
        if (closing && a < 0.005 && !N.ai.concealed) closedNotConcealed++;
      }
      const stuck = evSince(ev0).filter((e) => e.ev === 'stuck').length;
      entry[rid] = { facing: D.facing, concealed: N.ai.concealed, doorAngle: +D.d.angle.toFixed(3), spotAfterOpen, fullyIn, protAfterIn, maxProtAfterIn: +maxProtAfterIn.toFixed(3), closing, minDepthWhileClosing: +minVClosing.toFixed(3),
        maxProtWhileClosing: +maxProtClosing.toFixed(3), closedNotConcealed, stuck, standDepth: +(-vRootOf(D)).toFixed(3), protFrames };
      entry[rid].pass = N.ai.concealed && D.d.angle < 0.005 && spotAfterOpen === 0 && fullyIn && protAfterIn === 0 && closing && minVClosing >= 0.9 && maxProtClosing <= -0.05 && closedNotConcealed === 0 && stuck === 0 && Math.abs(-vRootOf(D) - 1.3) < 0.02;
    }
    // ---- 同類: 310 に潜んだまま、外へ引き出す理由を 1 つずつ
    delete N.ai.playerLevelAt; N.ai.playerLevelAt = () => N.level;
    const D = doorOf('310');
    const P305 = doorOf('305');
    const pulls = {};
    const watchPull = (name, setup, done, sec = 30, onFrame = null) => {
      N.ai.reset(6.9, 3.0, 0, 3);
      if (N.rooms.hidden) N.rooms.forceUnhide();
      N.peephole(false); N.setFlashlight(false); N.ai.knownRoomId = null;
      N.ai.setState('LURK', { force: true, log: true, room: '310', standNow: name !== 'light_during_entry' });
      N.pump(DT, 3, false);
      const ev0 = evMark();
      setup();
      let bad = 0, spotIn = 0, frames = 0;
      for (let i = 0; i < Math.round(sec / DT); i++) {
        N.pump(DT, 1, false); frames++;
        const vr = vRootOf(D), inside = vr < -0.05, closed = D.d.angle < 0.005;
        if (inside && closed && (N.enemyObj.root.visible || spotOn()) && (N.ai.lurkRoomId === '310' || N.ai.state !== 'LURK' || !N.ai.concealed)) bad++;
        if (inside && spotOn()) spotIn++;
        if (onFrame) onFrame();
        if (done(evSince(ev0))) break;
      }
      const evs = evSince(ev0);
      const r = { wake: evs.some((e) => e.ev === 'lurk_wake'), release: evs.some((e) => e.ev === 'lurk_released'), stuck: evs.filter((e) => e.ev === 'stuck').length, badFrames: bad, spotInside: spotIn,
        after: N.ai.state, out: vRootOf(D) > 0.3, seq: evs.filter((e) => ['lurk_wake', 'lurk_room_in', 'lurk_release', 'room_door_open', 'room_door_close', 'lurk_released', 'room_known', 'stuck'].includes(e.ev) || (e.ev === 'state')).map((e) => e.ev + (e.to ? ':' + e.to : '')).slice(0, 14) };
      r.pass = (name === 'light_leak_305' ? (!r.wake && !r.release && N.ai.concealed && N.ai.state === 'LURK') : (r.release && r.out)) && r.stuck === 0 && bad === 0 && spotIn === 0;
      pulls[name] = r;
      N.peephole(false); if (N.rooms.hidden) N.rooms.forceUnhide();
      for (let i = 0; i < 400 && N.deathState(); i++) N.pump(DT, 1, false);
      N.player.frozen = false; N.viewLock.cancel(); N.movie.end();
    };
    const in305 = async (depth = 0.9) => { N.setView(P305.pos[0] - P305.n[0] * depth, P305.pos[1] - P305.n[1] * depth, Math.atan2(-P305.n[0], -P305.n[1]), 0); N.pump(DT, 2, false); };
    const released = (evs) => evs.some((e) => e.ev === 'lurk_released');
    await in305(1.5);
    // 光漏れ: 閉じた空室の中からは向かいの部屋の光は見えない = 潜んだまま(光らない・出てこない・扉に押し付けて止まらない)
    watchPull('light_leak_305', () => { N.setFlashlight(true); }, released, 12);
    await in305(1.5);
    watchPull('noise_305', () => { N.ai.noiseRoom('305', 3.3, 13.05, 3); }, released);
    const H305 = N.world.roomById.get('305').room.interior.hide;
    watchPull('closet_305', () => { N.setView(H305.out[0], H305.out[1], 0, 0); N.pump(DT, 2, false); N.rooms.hide('305'); N.pump(DT, 40, false); N.ai.knownRoomId = '305'; }, released);
    await in305(0.7);
    watchPull('peephole_305', () => { N.ai.knownRoomId = '305'; N.peephole(true); }, released);
    await in305(1.5);
    watchPull('floor_noise', () => { N.ai.floorNoise(4, 6.9, 12, 'run'); }, released);
    await in305(1.5);
    // 入る途中(扉を開けてから閉めるまで = 割り込み不可の間)に光漏れで知った → 閉め終えてから静かに出る
    let lit = false;
    watchPull('light_during_entry', () => { lit = false; }, released, 40, () => { if (!lit && D.d.angle > 0.3) { lit = true; N.setFlashlight(true); } });
    N.setFlashlight(false);
    await back4();
    N.ai.lurkEnabled = true;
    const pass = Object.values(entry).every((r) => r.pass) && Object.values(pulls).every((r) => r.pass) && pulls.peephole_305.wake && pulls.closet_305.wake && pulls.noise_305.wake && pulls.light_during_entry.wake;
    return { pass, entry, pulls };
  });

  // 41) #9 管理人のいる階へ EV で降りる: 3F の廊下(巡回中)に管理人、4F のカゴから 3F へ → 管理人は EV ホールの扉の正面で待ち構え、
  //  扉が開いた時に正面 1.5m 以内 → 視点固定 → OUT。遠ければ扉が開く前に立ち位置へ移る。空室に潜んでいる時・眠っている(第1段)時は対象外
  await T('41_p6b_ev_wait_out', async () => {
    const ev = N.elevator, g4 = ev.rooms[4].geom;
    const run = async (mode) => {
      W.reset(); N.ai.lurkEnabled = false;
      Object.assign(ev.car, { level: 4, state: 'idle', open: 0, pending: [], riding: false, to: null }); ev.npc = null; ev.npcStop = null;
      await N.teleport(4, g4.center[0], g4.center[1] + 0.25, 0); N.pump(DT, 5, false);
      N.setFlashlight(false);
      if (mode === 'lurk') { N.ai.reset(6.9, 9.0, 0, 3); N.ai.setState('LURK', { force: true, log: true, room: '310', standNow: true }); }
      else { N.ai.reset(6.9, mode === 'far' ? 3.0 : 17.0, Math.PI, 3); N.ai.setState('PATROL', { force: true, log: true }); }
      if (mode === 'dormant') N.ai.setDormant(true);
      N.pump(DT, 2, false);
      const ev0 = evMark(), vl0 = N.viewLock.log.length;
      const inCar0 = ev.inCar(N.player.pos.x, N.player.pos.z, 4);
      ev.select(3);
      let t = 0, openAt = null, atOpen = null, dead = null, attack = false;
      for (let i = 0; i < Math.round(25 / DT); i++) {
        N.pump(DT, 1, false); t += DT;
        if (openAt === null && ev.car.level === 3 && ev.car.state === 'opening') {
          openAt = t; const e = N.enemyObj.pos, g = ev.rooms[3].geom, dx = (g.open[0] + g.open[1]) / 2, dz = g.doorZ[0];
          atOpen = { lv: N.ai.level, state: N.ai.state, doorDist: +Math.hypot(e.x - dx, e.z - dz).toFixed(2), front: Math.abs(e.x - dx) < 0.3 && e.z < dz, visible: N.enemyObj.root.visible, playerLevel: N.level };
        }
        if (N.ai.state === 'ATTACK') attack = true;
        if (dead === null && N.deathState()) dead = t;
        if (dead !== null && t - dead > 0.5) break;
        if (openAt !== null && t - openAt > 6) break;
      }
      const evs = evSince(ev0);
      const chk = evs.find((e) => e.ev === 'ev_ride_check'), ready = evs.find((e) => e.ev === 'ev_wait_ready');
      const r = { inCar0, check: chk ? chk.ok : null, eta: chk && chk.eta, wait: evs.some((e) => e.ev === 'ev_wait'), ready: ready ? { warped: ready.warped, dist: ready.dist } : null, atOpen, attack, out: dead !== null, outAfterOpen_s: dead !== null && openAt !== null ? +(dead - openAt).toFixed(2) : null,
        viewLock: N.viewLock.log.slice(vl0).map((l) => l.ev + ':' + l.label) };
      for (let i = 0; i < 400 && N.deathState(); i++) N.pump(DT, 1, false);
      if (mode === 'dormant') N.ai.setDormant(false);
      return r;
    };
    const near = await run('near'), far = await run('far'), lurk = await run('lurk'), dorm = await run('dormant');
    Object.assign(ev.car, { level: 4, state: 'idle', open: 0, pending: [], riding: false, to: null });
    await back4();
    N.ai.lurkEnabled = true;
    const okHit = (r) => r.inCar0 && r.check === true && r.wait && r.atOpen && r.atOpen.lv === 3 && r.atOpen.doorDist <= 1.5 && r.atOpen.front && r.atOpen.visible && r.atOpen.playerLevel === 3 && r.attack && r.out && r.viewLock.includes('start:ev_wait');
    const pass = okHit(near) && okHit(far) && near.ready && !near.ready.warped && far.ready && far.ready.warped
      && lurk.check === false && !lurk.wait && !lurk.out && dorm.check === false && !dorm.wait && !dorm.out;
    return { pass, near, far, lurkingInRoom: lurk, dormant: dorm };
  });

  // 42) P6b-H(§3.14 #1): 死亡→復帰の瞬間、復帰先の階(4F)にいた管理人は 2 階以上離れた階の EV ホールへ移り、4F を 45 秒避ける(重み 0・物音で来ない・潜伏先に選ばない)。
  //  復帰先の階へ EV で向かっていた管理人は取り消される。第1段の待機(dormant)はそのまま
  await T('42_p6bh_respawn_manager_leaves_floor', async () => {
    W.reset();
    N.setView(6.9, 7.6, Math.PI, 0); N.setFlashlight(false);
    // A) 4F の廊下で管理人に捕まる → 4F(CHECKPOINT)に復帰
    N.enemy.place(6.9, 8.8, Math.PI);
    N.ai.lastKnown = { x: 6.9, z: 7.6 };
    N.ai.setState('CHASE', { force: true, log: true });
    const d0 = N.deaths(), t0 = N.ai.time;
    let atRespawn = null;
    for (let i = 0; i < 60 * 12 && atRespawn === null; i++) {
      N.pump(DT, 1, false);
      if (N.deaths() === d0 + 1) atRespawn = { aiLevel: N.ai.level, playerLevel: N.level, transit: N.ai.transit, state: N.ai.state, w4: N.ai.floorWeights()[4], avoided: N.ai._avoided(4), t: +(N.ai.time - t0).toFixed(2) };
    }
    const ev = N.ai.events.filter((e) => e.t >= t0 && e.ev === 'respawn_avoid').pop() || null;
    const tR = N.ai.time;
    // 45 秒: 4F で走る(別の階の管理人に足音が届く)・4F の大きな物音を 3 秒ごとに出す・潜伏先の階を毎秒 20 回引く
    let on4 = 0, toward4 = 0, picked4 = 0, noiseGo = 0, maxW4 = 0, frames = 0, run = false;
    const ex = (e) => e.t > tR;
    for (let i = 0; N.ai.time - tR < 44.5; i++) {
      if (i % 90 === 0) { run = !run; W.key('ShiftLeft', run); W.key('KeyW', run); N.setView(6.9, run ? 9.0 : 16.0, run ? 0 : Math.PI, 0); }
      if (i % 180 === 0 && N.ai.floorNoise(4, 6.9, 12.0, 'crash')) noiseGo++;
      if (i % 3 === 0 && N.ai._chooseFloor() === 4) picked4++;
      N.pump(DT, 1, false); frames++;
      if (N.ai.level === 4) on4++;
      if (N.ai.goalLv === 4) toward4++;
      maxW4 = Math.max(maxW4, N.ai.floorWeights()[4]);
      if (N.deaths() > d0 + 1) break;
      if (i % 600 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    W.key('ShiftLeft', false); W.key('KeyW', false); N.pump(DT, 2, false);
    const evs = N.ai.events.filter(ex);
    const heard4 = evs.filter((e) => e.ev === 'heard_floor' && e.lv === 4).length, avoidedNoise = evs.filter((e) => e.ev === 'floor_noise_avoided' && e.lv === 4).length;
    const lurk4 = evs.filter((e) => e.ev === 'lurk_pick' && e.lv === 4).length;
    const during = { frames, on4, toward4, picked4, noiseGo, maxW4, heard4, avoidedNoise, lurk4, dead: N.deaths() > d0 + 1 };
    for (let i = 0; N.ai.time - tR < 45.3; i++) N.pump(DT, 1, false);
    const after = { avoided: N.ai._avoided(4), w4: +N.ai.floorWeights()[4].toFixed(2) };
    const okA = atRespawn && atRespawn.playerLevel === 4 && typeof atRespawn.aiLevel === 'number' && Math.abs(atRespawn.aiLevel - 4) >= 2 && !atRespawn.transit && atRespawn.state === 'PATROL'
      && atRespawn.w4 === 0 && atRespawn.avoided && ev && ev.moved && ev.lv === 4
      && on4 === 0 && toward4 === 0 && picked4 === 0 && noiseGo === 0 && maxW4 === 0 && heard4 === 0 && avoidedNoise >= 10 && lurk4 === 0 && !during.dead && !after.avoided && after.w4 > 0;
    // B) 2F の管理人が 4F の物音で EV に乗って 4F へ向かう途中 → 4F で復帰(main と同じ API)→ 取り消し・2 階以上離れた階へ・4F を避ける
    W.reset();
    N.setView(6.9, 7.6, Math.PI, 0);
    N.ai.reset(N.ENEMY_HOME.x, N.ENEMY_HOME.z, N.ENEMY_HOME.yaw, 2);
    N.ai._lastFloorGo = -1e9;
    const go = N.ai.floorNoise(4, 6.9, 12.0, 'crash');
    let riding = null;
    for (let i = 0; i < 60 * 30 && riding === null; i++) { N.pump(DT, 1, false); if (N.ai.transit && N.ai.goalLv === 4) riding = { level: N.ai.level, goal: N.ai.goalLv, car: N.elevator.car.state, npc: !!N.elevator.npc }; }
    const r = N.ai.onPlayerRespawn(4);
    const afterB = { level: N.ai.level, transit: N.ai.transit, goal: N.ai.goalLv, state: N.ai.state, npc: !!N.elevator.npc, avoided: N.ai._avoided(4) };
    let on4B = 0, toward4B = 0;
    for (let i = 0; i < 60 * 15; i++) { N.pump(DT, 1, false); if (N.ai.level === 4) on4B++; if (N.ai.goalLv === 4) toward4B++; }
    const okB = go && riding && r && r.moved && typeof afterB.level === 'number' && Math.abs(afterB.level - 4) >= 2 && !afterB.transit && afterB.goal === null && afterB.state === 'PATROL' && !afterB.npc && afterB.avoided
      && on4B === 0 && toward4B === 0;
    // C) 第1段の待機(dormant)はそのまま(動かさない・猶予も掛けない)
    W.reset();
    N.ai.setDormant(true);
    const lvC0 = N.ai.level, rC = N.ai.onPlayerRespawn(lvC0);
    const okC = rC === null && N.ai.level === lvC0 && N.ai.dormant && !N.ai._avoided(lvC0);
    N.ai.setDormant(false);
    Object.assign(N.elevator.car, { level: 4, state: 'idle', open: 0, pending: [], riding: false, to: null }); N.elevator.npc = null;
    W.reset();
    return { pass: !!(okA && okB && okC), A: { atRespawn, event: ev, during, after }, B: { floorNoiseGo: go, riding, result: r, after: afterB, on4: on4B, toward4: toward4B }, C: { level: lvC0, result: rC, ok: okC } };
  });

  W.reset();
  N.render();
  if (new URLSearchParams(location.search).get('fps') === '1') { out.fps = await measureFps(N); show(); }
  N.testResult = out;
  console.log('[test_enemy]', JSON.stringify(out));
  return out;
}

function harness(N) {
  const door410 = () => N.doors.find((d) => d.roomId === '410');
  return {
    door410,
    key(code, down) { document.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true })); },
    dist() { const p = N.player.pos, e = N.enemyObj.pos; return Math.hypot(p.x - e.x, p.z - e.z); },
    // 衝突箱(敵自身・無効化中を除く)への最大めり込み(半径 r の円)
    penetration(x, z, r) {
      let m = 0;
      for (const c of N.collisions) {
        if (c.disabled || c.kind === 'enemy') continue;
        const dx = Math.min(x + r - c.minX, c.maxX - (x - r)), dz = Math.min(z + r - c.minZ, c.maxZ - (z - r));
        if (dx > 0 && dz > 0) m = Math.max(m, Math.min(dx, dz));
      }
      return m;
    },
    // 960×540 で描いて画面中央 50% の平均輝度(sRGB 表示値の Rec.709 輝度、0..1)
    centerLuma() {
      N.setRenderSize(960, 540); N.render();
      const gl = N.renderer.getContext(); const w = 480, h = 270; const px = new Uint8Array(w * h * 4);
      gl.readPixels(240, 135, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let s = 0; for (let i = 0; i < px.length; i += 4) s += (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
      N.setRenderSize(0);
      return +(s / (w * h)).toFixed(4);
    },
    reset() {
      for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'KeyE', 'KeyP', 'KeyL', 'ControlLeft']) this.key(k, false);
      N.peephole(false);
      N.viewLock.cancel();
      delete N.ai.playerLevelAt; N.ai.playerLevelAt = () => N.level;   // P5a のテストは「プレイヤーの階」を差し替えることがある
      const d = door410();
      d.angle = 0; d.target = 0; d.locked = false; d.speedMul = 1; if (d.collision) d.collision.disabled = false;
      d.node.rotation.y = 0;
      N.player.frozen = false;
      if (N.rooms.hidden) N.rooms.forceUnhide();   // P5b-6: クローゼットに隠れたままのテストの後
      N.ai.setHideOdds({ enter: 1, closet: 1 });  // P5b-6: 従来のテストは「知っている部屋には必ず入る・必ず開ける」で書いてある(確率は 25〜34 番)
      if (N.ai._rand0) N.ai._rand = N.ai._rand0;
      N.movie.end();
      // 死亡演出が残っていれば流し切る
      for (let i = 0; i < 400 && N.deathState(); i++) N.pump(DT, 1, false);
      N.ai.reset(N.ENEMY_HOME.x, N.ENEMY_HOME.z, N.ENEMY_HOME.yaw);
      if (N.ai.clearAvoid) N.ai.clearAvoid();   // P6b-H: 死亡→復帰で掛かった「階を避ける」猶予を次のテストへ持ち越さない
      N.ai.events.length = 0;   // P6b-H: 記録は 400 件で古い方から捨てる。番号(ev0 = events.length)で切り出すテストが満杯で崩れないよう、テストごとに空にする
      N.pump(DT, 1, false);
    },
  };
}

// 1080p・PixelRatio 1 で rAF を回し、敵が画面内(3m)にいる状態の fps を測る
async function measureFps(N) {
  const res = {};
  N.setRenderSize(1920, 1080);
  N.ai.setState('SCRIPTED', { force: true });
  for (const [label, z, flash] of [['enemy_3m_flashlight', 10.6, true], ['enemy_8m_dark', 15.6, false]]) {
    N.setView(6.9, 7.6, Math.PI, 0); N.setFlashlight(flash);
    N.enemy.place(6.9, z, Math.PI); N.enemyObj.play('walk_oldman');
    await new Promise((r) => setTimeout(r, 2500));
    const s = N.stats();
    res[label] = { fps: s.fps, frameMsAvg: s.frameMsAvg, cpuMsAvg: s.cpuMsAvg, drawingBuffer: s.drawingBuffer, calls: s.render.calls, triangles: s.render.triangles };
  }
  N.setRenderSize(0);
  N.setFlashlight(false);
  N.ai.reset(N.ENEMY_HOME.x, N.ENEMY_HOME.z, N.ENEMY_HOME.yaw);
  return res;
}
