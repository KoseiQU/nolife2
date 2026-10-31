// test_enemy.js — P2b 管理人の決定的テスト(ブラウザ内)。http://localhost:8001/?test=enemy で自動実行。
// rAF に依存せず window.__N2.pump(dt, n) で本物のループと同じ順に進める。キーは keydown/keyup をペアで送る。
// 結果: window.__N2.testResult と画面左上の <pre>。?test=enemy&fps=1 で 1080p の fps 実測も行う(タブが前面にあること)。

const DT = 1 / 60;
// 消灯時の黒つぶれ判定(画面中央 50% 領域の平均輝度、表示値 0..1)。P2b 時点: 410 室内 0.007 / 廊下 0.16
const DARK_MIN = { room: 0.035, corridor: 0.12 };

export async function run(N) {
  const out = { ok: true, cases: {} };
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:fixed;left:8px;top:8px;z-index:9;color:#9fe39f;background:rgba(0,0,0,.75);font:11px/1.35 monospace;padding:8px;max-width:46vw;max-height:94vh;overflow:auto;white-space:pre-wrap;';
  document.body.appendChild(pre);
  const show = () => { pre.textContent = JSON.stringify(out, null, 1); };
  const T = (name, fn) => {
    try { const r = fn(); out.cases[name] = r; if (!r.pass) out.ok = false; }
    catch (e) { out.cases[name] = { pass: false, error: String(e && e.stack || e) }; out.ok = false; }
    show();
  };
  const W = harness(N);

  T('1_patrol_no_wallclip', () => {
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

  T('2_run_noise_to_alert', () => {
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

  T('3_sight_to_chase', () => {
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

  T('4_attack_death_respawn', () => {
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

  T('5_locked_door_key_entry', () => {
    W.reset();
    N.setView(8.75, 7.3, Math.PI / 2, 0); N.setFlashlight(false);
    N.pump(DT, 2, false);
    W.key('KeyL', true); N.pump(DT, 1, false); W.key('KeyL', false); N.pump(DT, 1, false);
    const locked = W.door410().locked;
    N.enemy.place(6.9, 12.5, Math.PI);
    N.ai.lastKnown = { x: 8.75, z: 7.3 };
    N.ai.knownRoomId = '410';   // P2d 以降: 鍵で入るのは「中にいると知っている」時だけ(物音を聞いた想定)
    N.ai.setState('ALERT', { force: true, log: true, react: true });
    const ev0 = N.ai.events.length;
    let t = 0, enteredAt = null, maxAngle = 0, wallClip = 0;
    for (let i = 0; i < Math.round(45 / DT) && enteredAt === null; i++) {
      N.pump(DT, 1, false); t += DT;
      maxAngle = Math.max(maxAngle, W.door410().angle);
      if (!N.ai.uninterruptible && W.penetration(N.enemyObj.pos.x, N.enemyObj.pos.z, 0) > 0) wallClip++;
      if (N.ai.events.slice(ev0).some((e) => e.ev === 'entered')) enteredAt = t;
    }
    const evs = N.ai.events.slice(ev0).filter((e) => ['keys', 'unlock', 'door_open_in', 'door_opened', 'entered', 'stuck', 'state'].includes(e.ev)).map((e) => `${e.t.toFixed(2)} ${e.ev}${e.to ? ':' + e.to : ''}${e.x !== undefined ? ` (${e.x},${e.z})` : ''}`);
    const order = ['keys', 'unlock', 'door_open_in', 'door_opened', 'entered'];
    const idx = order.map((k) => N.ai.events.slice(ev0).findIndex((e) => e.ev === k));
    const inOrder = idx.every((v, i) => v >= 0 && (i === 0 || v > idx[i - 1]));
    const e = N.enemyObj.pos;
    return { pass: locked && inOrder && enteredAt !== null && e.x > 7.95 && maxAngle > 1.2 && wallClip === 0, lockedByL: locked, enteredAfter_s: enteredAt && +enteredAt.toFixed(2), enemyInRoomX: +e.x.toFixed(2), doorMaxAngle_rad: +maxAngle.toFixed(2), unlockedAfter: !W.door410().locked, wallClipFrames: wallClip, events: evs };
  });

  T('6_peephole_on_off', () => {
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

  T('7_lurk_ambush_attack', () => {
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

  T('8_dark_visibility', () => {
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

  T('9_witness_scope_return_out', () => {
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
      if (peepAtUnlock === null && evs.some((e) => e.ev === 'unlock')) peepAtUnlock = N.peepholeObj.active;
      if (N.deathState()) hitAt = t;
    }
    const order = ['room_known', 'scope_start', 'scope_pass', 'scope_hide', 'scope_return', 'scope_stare', 'keys', 'unlock', 'door_opened', 'attack_start', 'hit'];
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

  T('10_unwitnessed_dark_safe', () => {
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

  T('11_hud_hints', () => {
    W.reset();
    N.ai.setState('SCRIPTED', { force: true }); N.enemy.place(6.9, 21.0, Math.PI);
    const H = () => N.hudState();
    const at = (x, z, yaw) => { N.setView(x, z, yaw, 0); N.pump(DT, 2, false); return H(); };
    const tap = (code, frames = 3) => { W.key(code, true); N.pump(DT, frames, false); W.key(code, false); N.pump(DT, 2, false); };
    const r = {};
    r.corridorDoor = at(6.95, 7.25, -Math.PI / 2).hint;                 // 廊下から 410 の扉を見る(0.85m)
    r.away = at(6.9, 12.5, Math.PI).hint;                                // 離れる(扉を見ていない・遠い)
    r.inside = at(8.75, 7.3, Math.PI / 2).hint;                          // 室内から扉(スコープ 0.97m・正対)
    tap('KeyL'); r.insideLocked = H().hint;
    N.peephole(true); N.pump(DT, 2, false); r.peep = H(); N.peephole(false); N.pump(DT, 2, false);
    tap('KeyL'); r.unlockedAgain = H().hint;
    at(6.95, 13.05, Math.PI / 2); tap('KeyE'); r.otherDoorToast = H().toast;   // 開かない扉(403)で E(P3b: 404 は入れる部屋になった)
    const ev = N.hud.evPanel;
    const ex = ev.x - 0.9 * 0.2, ez = ev.z - 0.9;
    r.ev = at(ex, ez, Math.atan2(-(ev.x - ex), -(ev.z - ez))).hint; tap('KeyE'); r.evToast = H().toast;
    tap('KeyF'); N.pump(DT, 12, false); r.flashToast = H().toast; tap('KeyF'); N.pump(DT, 12, false);
    tap('KeyH'); r.controls = H().controls;
    const pass = r.corridorDoor.includes('開ける') && !r.corridorDoor.includes('施錠') && r.away === ''
      && r.inside.includes('覗く') && r.inside.includes('開ける') && r.inside.includes('施錠')
      && r.insideLocked.includes('解錠') && r.insideLocked.includes('施錠中')
      && r.peep.hint === '' && r.peep.release.includes('やめる')
      && r.unlockedAgain.includes('施錠') && r.otherDoorToast === '鍵がかかっている'
      // P3a: EV が動くようになったので、呼ぶと「エレベーターを呼んだ」(カゴがこの階なら「扉が開く」)。P2e の期待値は「反応がない」だった
      && r.ev.includes('呼ぶ') && ['エレベーターを呼んだ', '扉が開く'].includes(r.evToast) && r.flashToast.includes('懐中電灯') && r.controls;
    return { pass, ...r, peep: { hint: r.peep.hint, release: r.peep.release } };
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
      for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'KeyE', 'KeyP', 'KeyL']) this.key(k, false);
      N.peephole(false);
      const d = door410();
      d.angle = 0; d.target = 0; d.locked = false; d.speedMul = 1; if (d.collision) d.collision.disabled = false;
      d.node.rotation.y = 0;
      N.player.frozen = false;
      N.movie.end();
      // 死亡演出が残っていれば流し切る
      for (let i = 0; i < 400 && N.deathState(); i++) N.pump(DT, 1, false);
      N.ai.reset(N.ENEMY_HOME.x, N.ENEMY_HOME.z, N.ENEMY_HOME.yaw);
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
