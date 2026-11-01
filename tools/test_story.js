// test_story.js — P5b-1 動線の骨組み(DESIGN §3.8 H の 11 段)の決定的テスト(ブラウザ内)。http://127.0.0.1:8001/index.html?test=story で自動実行。
// rAF に依存せず window.__N2.pump(dt, n) で本物のループと同じ順に進める。キーは keydown/keyup をペアで送る。結果: window.__N2.testResult
//  0) ?stage=N の開始状態(段・持ち物・解放・フラグ・開始位置・管理人がいるか)を 1〜11 すべて
//  1) 第1段: 館内に管理人がいない・410 の扉の下のメモ→「221号室へ」・221 は鍵なしで入れる・机の小さな鍵を拾った瞬間に奥のクローゼットから管理人(ワープ)→
//     1.5 秒の間→追跡→走って廊下へ逃げ切れる(追跡中 2.5m より近づかれない・OUT なし)
//  2) 第2段: キーボックス(小さな鍵で開く・312 の鍵だけ・鍵なしでは開かない)
//  3) 第3段: 312(鍵のない扉は開かない→鍵で開く→少し開く→別空間 X312→105 の鍵→戻る)
//  4) 第4段: 105 → X105(目標「出口へ」)→ メモ → 第5段
//  5) 第5段: 6F の罠 3 室で飛び出し・他の部屋では起きない・609 の机の 220 の鍵
//  6) 第6段: 220(鍵で開く)→ 荒れた部屋 → 正面玄関の鍵
//  7) 第7段: 正面玄関(鍵スイッチの前は外側の自動ドアが開かない→鍵で開く)→ 駐車場の車 3 台(2 台は鍵・黒い車のグローブボックスに南京錠の鍵)
//  8) 第8段: 410 の隔て板の南京錠(鍵なしでは越えられない→鍵で roofA)→ 屋上A の 705 の鍵
//  9) 第9段: 705 → X705 → 地下の鉄扉の鍵 → 背後に管理人 → 追跡(EV は反応しない・管理人は階段で追う経路)→ 7F へ戻ると管理人も出てくる → 1F で第10段
// 10) 第10段: 地下の鉄扉(鍵)→ XB1 → 車のキー(管理人は地下へ来ない)
// 11) 第11段: 敷地へ出ると管理人が玄関から敷地へ追ってくる → 黒い車まで走って間に合う → エンディング(運転席の視点 → 「脱出した」)
// 12) チェックポイント: 死亡 → 段の開始位置へ。段・持ち物・解放・壊れた扉が残る
// 13) 目標の文言が段ごとに変わり、章が変わる時だけ 2 秒強調される・持ち物の札

const DT = 1 / 60;

export async function run(N) {
  const out = { ok: true, cases: {} };
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:fixed;left:8px;top:8px;z-index:10;color:#9fe39f;background:rgba(0,0,0,.78);font:11px/1.35 monospace;padding:8px;max-width:46vw;max-height:94vh;overflow:auto;white-space:pre-wrap;';
  document.body.appendChild(pre);
  const show = () => { pre.textContent = JSON.stringify(out, null, 1); };
  const T = async (name, fn) => {
    try { const r = await fn(); out.cases[name] = r; if (!r.pass) out.ok = false; }
    catch (e) { out.cases[name] = { pass: false, error: String(e && e.stack || e) }; out.ok = false; }
    show();
  };
  N.paused = true;
  const S = N.story;
  const key = (code, down) => document.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
  const tap = (code, frames = 3) => { key(code, true); N.pump(DT, frames, false); key(code, false); N.pump(DT, 2, false); };
  const pos = () => ({ x: +N.player.pos.x.toFixed(2), z: +N.player.pos.z.toFixed(2), level: N.level });
  const face = (x, z, pitch = -0.35) => { const p = N.player.pos; N.player.object.rotation.set(pitch, Math.atan2(-(x - p.x), -(z - p.z)), 0, 'YXZ'); N.player.object.updateMatrixWorld(); };
  const walkTo = (x, z, maxFrames = 900, tol = 0.14, run = false) => {
    key('KeyW', true); if (run) key('ShiftLeft', true);
    let ok = false, last = null, still = 0;
    for (let i = 0; i < maxFrames; i++) {
      const p = N.player.pos;
      if (Math.hypot(x - p.x, z - p.z) < tol) { ok = true; break; }
      face(x, z, 0);
      N.pump(DT, 1, false);
      if (last && Math.hypot(p.x - last.x, p.z - last.z) < 1e-4) { if (++still > 30) break; } else still = 0;
      last = { x: p.x, z: p.z };
    }
    key('KeyW', false); if (run) key('ShiftLeft', false); N.pump(DT, 2, false);
    return ok;
  };
  const walkPath = (pts, run = false) => pts.every(([x, z]) => walkTo(x, z, 900, 0.18, run));
  const room = (id) => { for (const f of N.building.floors) { const r = f.rooms.find((rr) => rr.id === id); if (r) return { r, level: f.level }; } return null; };
  const FN = { W: [-1, 0], E: [1, 0], N: [0, -1], S: [0, 1] };
  const front = (id, d = 0.8) => { const r = room(id).r; const n = FN[r.door.facing]; return [r.door.pos[0] + n[0] * d, r.door.pos[1] + n[1] * d]; };
  const useE = () => { N.pump(DT, 2, false); const h = N.hudState(); tap('KeyE'); N.pump(DT, 2, false); return h.hint; };
  const pickAt = (pk) => { face(pk.pos.x, pk.pos.z, -0.6); return useE(); };
  const pk = (id) => S.pickups.find((q) => q.id === id);
  const evs = (n0) => S.events.filter((e) => e.n > n0).map((e) => e.ev);
  const aiEvs = (t0) => N.ai.events.filter((e) => e.t > t0).map((e) => e.ev);
  const quiet = () => { N.ai.reset(N.ENEMY_HOME.x, N.ENEMY_HOME.z, N.ENEMY_HOME.yaw, 4); N.ai.setState('SCRIPTED', { force: true }); N.enemy.place(6.9, 19.5, Math.PI); };
  const settle = async (lv) => { const k = typeof lv === 'string' && lv[0] === 'X' ? null : lv; if (k !== null) await N.world.focus(k); N.pump(DT, 30, false); };
  const tp = async (lv, x, z, yaw) => { await N.teleport(lv, x, z, yaw); await settle(lv); };
  const waitTrans = () => { for (let i = 0; i < 120 && S.trans; i++) N.pump(DT, 1, false); N.pump(DT, 4, false); };
  const door = (id) => N.doorApi.get(id);
  // 鍵のない状態で扉を試す: E で「鍵がかかっている」・開かない・解錠されない
  const tryLocked = (id) => {
    const d = door(id);
    const c = d.collision ? [(d.collision.minX + d.collision.maxX) / 2, (d.collision.minZ + d.collision.maxZ) / 2] : d.pos;
    face(c[0], c[1], 0); N.pump(DT, 2, false);
    tap('KeyE'); N.pump(DT, 30, false);
    return { toast: N.hudState().toast, angle: +d.angle.toFixed(3), unlocked: S.unlocked.has(id) };
  };
  // 物語の扉を鍵で開けて、戸口を越えて別空間へ
  const openAndEnter = (id) => {
    const d = door(id);
    face(d.pos[0], d.pos[1], 0); N.pump(DT, 2, false);
    const hint = N.hudState().hint;
    const n0 = S.logCount;
    tap('KeyE'); N.pump(DT, 60, false);
    const angle = +d.angle.toFixed(2);
    const n = FN[d.facing], inward = id === 'B1DOOR' ? 1 : -1;
    walkTo(d.pos[0] + n[0] * inward * 0.6, d.pos[1] + n[1] * inward * 0.6, 240, 0.1);
    waitTrans();
    return { hint, angle, events: evs(n0), level: N.level };
  };
  const leave = () => { const L = N.spaces.def(N.level); if (!L) return { hint: '', level: N.level, at: pos() }; walkTo(L.exit.x, L.exit.z + 0.95, 600); face(L.exit.x, L.exit.z, 0); const h = useE(); waitTrans(); return { hint: h, level: N.level, at: pos() }; };

  // ---------------------------------------------------------------- 0) ?stage=N
  await T('0_stage_param_start_states', async () => {
    const want = {
      1: { item: null, un: [], roofA: false, ent: false, dormant: true },
      2: { item: 'small', un: [], dormant: false },
      3: { item: '312', un: ['KEYBOX'] },
      4: { item: '105', un: ['312'] },
      5: { item: null, un: ['105'] },
      6: { item: '220', un: [] },
      7: { item: 'entrance', un: ['220'] },
      8: { item: 'padlock', un: ['GLOVEBOX', 'KEYSWITCH'], ent: true },
      9: { item: '705', un: ['PADLOCK'], roofA: true },
      10: { item: 'b1', un: ['705'] },
      11: { item: 'car', un: ['B1DOOR'] },
    };
    const res = {};
    let pass = true;
    // 読み込み時の ?stage(このページ)
    const q = new URLSearchParams(location.search).get('stage');
    const initial = q ? { stage: S.stage, item: S.item } : null;
    for (let n = 1; n <= 11; n++) {
      S.applyStage(n);
      await settle(N.level);
      const st = S.state(), w = want[n];
      const sp = S.respawnPoint();
      const okItem = st.item === w.item;
      const okUn = w.un.every((k) => st.unlocked.includes(k));
      const NEXT = { 1: 'KEYBOX', 2: 'KEYBOX', 3: '312', 4: '105', 5: '220', 6: '220', 7: 'KEYSWITCH', 8: 'PADLOCK', 9: '705', 10: 'B1DOOR' };   // この段ではまだ開いていない物
      const okNot = n === 11 || !st.unlocked.includes(NEXT[n]);
      const okFlags = (w.roofA === undefined || st.flags.roofA === w.roofA) && (w.ent === undefined || st.flags.entranceOut === w.ent) && st.flags.roofA === (n >= 9) && st.flags.entranceOut === (n >= 8);
      const okAI = w.dormant === undefined ? N.ai.dormant === (n === 1) : N.ai.dormant === w.dormant;
      const okPos = N.level === sp.level && Math.hypot(N.player.pos.x - sp.x, N.player.pos.z - sp.z) < 0.05;
      const okObj = N.hudState().objective === st.objective && !!st.objective;
      const okEV = st.evDisabled === (n >= 10);
      const ok = st.stage === n && okItem && okUn && okNot && okFlags && okAI && okPos && okObj && okEV;
      if (!ok) pass = false;
      res[n] = { ok, item: st.item, unlocked: st.unlocked, flags: st.flags, dormant: N.ai.dormant, level: N.level, objective: N.hudState().objective, evDisabled: st.evDisabled };
    }
    if (initial) { res.initialFromParam = { q: +q, ...initial }; if (initial.stage !== +q) pass = false; }
    return { pass, res };
  });

  // ---------------------------------------------------------------- 1) 第1段・221 のロッカーの飛び出し
  await T('1_wake_memo_221_locker_burst_escape', async () => {
    S.applyStage(1); await settle(4);
    N.setFlashlight(true);
    const noEnemy = N.ai.dormant && !N.enemyObj.root.visible;
    const obj0 = N.hudState().objective;
    const memoHint = pickAt(pk('memo221'));
    N.pump(DT, 2, false);
    const obj1 = N.hudState().objective, em1 = N.hudState().objectiveEm, toast = N.hudState().toast;
    // EV は動く(第1段)
    const evOK = !S.evDisabled;
    // 221 へ(鍵なしで開く普通の部屋)
    const r = room('221').r;
    await tp(2, ...front('221', 0.9), 0);
    face(r.door.pos[0], r.door.pos[1], 0); N.pump(DT, 2, false);
    const doorHint = N.hudState().hint;
    tap('KeyE'); N.pump(DT, 60, false);
    const opened = door('221').angle > 0.5;
    const pts = r.interior.points;
    const walked = walkPath([[r.door.pos[0], r.door.pos[1] - 0.6], pts.entry, pts.room, pts.deskFront]);
    const stillDormant = N.ai.dormant;
    const t0 = N.ai.time;
    const keyHint = pickAt(pk('small'));
    N.setFlashlight(false);   // 消して逃げる(P5a の消灯の飛び出しと同じ基準)
    const st = S.state();
    // 飛び出し: その場(221 のクローゼット)に現れる(ワープ)
    N.pump(DT, 6, false);
    const appearEv = N.ai.events.find((e) => e.t > t0 && e.ev === 'locker_burst');
    const ePos = { x: N.enemyObj.pos.x, z: N.enemyObj.pos.z, level: N.ai.level };
    const closet = N.rooms.closets.get('221');
    N.pump(DT, 30, false);
    const closetOpen = closet.open01 > 0.3;
    // 1.5 秒の間 → 追跡。プレイヤーは視点固定が解けたら走って逃げる
    let chaseAt = null, minD = 1e9, t = 0, dead = false;
    while (N.viewLock.active && t < 3) { N.pump(DT, 1, false); t += DT; }
    const exit = [[pts.room[0], pts.room[1]], [pts.entry[0], pts.entry[1]], [r.door.pos[0], r.door.pos[1] + 0.9], [8.5, 21.2], [6.9, 21.2], [6.9, 12.0], [6.9, 2.0]];
    key('ShiftLeft', true); key('KeyW', true);
    let wi = 0;
    for (let i = 0; i < 60 * 14 && wi < exit.length; i++) {
      const p = N.player.pos, [x, z] = exit[wi];
      if (Math.hypot(x - p.x, z - p.z) < 0.3) { wi++; continue; }
      face(x, z, 0);
      N.pump(DT, 1, false); t += DT;
      if (chaseAt === null && N.ai.state === 'CHASE') chaseAt = +(N.ai.time - t0).toFixed(2);
      if (N.ai.state === 'CHASE' && N.ai.level === N.level) minD = Math.min(minD, Math.hypot(N.enemyObj.pos.x - p.x, N.enemyObj.pos.z - p.z));
      if (N.deathState() || N.ai.state === 'ATTACK') { dead = true; break; }
    }
    key('ShiftLeft', false); key('KeyW', false);
    const lost = N.ai.state !== 'CHASE';
    const endDist = Math.hypot(N.enemyObj.pos.x - N.player.pos.x, N.enemyObj.pos.z - N.player.pos.z);
    const pass = noEnemy && obj0 === '扉の下の紙を拾う' && memoHint.includes('拾う') && obj1 === '221号室へ' && em1 && toast.includes('221') && evOK
      && doorHint.includes('開ける') && opened && walked && stillDormant && keyHint.includes('拾う') && st.stage === 2 && st.item === 'small'
      && !!appearEv && appearEv.lv === 2 && Math.hypot(appearEv.x - r.interior.hide.feet[0], appearEv.z - r.interior.hide.feet[1]) < 0.05 && closetOpen
      && chaseAt !== null && chaseAt >= 1.4 && chaseAt <= 1.8 && minD > 2.5 && !dead && wi >= exit.length - 1 && (lost || endDist > 6);
    quiet();
    return { pass, noEnemy, obj0, memoHint, obj1, objEmphasized: em1, toast, doorHint, opened, walked, stillDormant, keyHint, stage: st.stage, item: st.item,
      burst: appearEv || null, enemyAt: ePos, closetOpen, chaseStart_s: chaseAt, minDistDuringChase: +minD.toFixed(2), dead, escaped: wi, lost, endDist: +endDist.toFixed(2), enemyState: N.ai.state, end: pos() };
  });

  // ---------------------------------------------------------------- 2) キーボックス
  await T('2_office_keybox', async () => {
    S.applyStage(2); quiet();
    await tp(1, 20.9, 24.6, -Math.PI / 2);
    const n0 = S.logCount;
    S.item = null;                                    // 鍵なしでは開かない
    face(21.876, 24.85, -0.1); N.pump(DT, 2, false);
    const hintNoKey = N.hudState().hint;
    tap('KeyE'); N.pump(DT, 4, false);
    const toastNoKey = N.hudState().toast, stillLocked = !S.unlocked.has('KEYBOX');
    S.item = 'small';
    N.pump(DT, 2, false);
    const hintKey = N.hudState().hint;
    tap('KeyE'); N.pump(DT, 40, false);
    const open = S.unlocked.has('KEYBOX') && S.item === null && S.keybox.userData.pivot.rotation.y < -1.0;
    const hooks = Object.keys(S.keybox.userData.hooks);
    const onlyKey = S.pickups.filter((q) => q.level === 1 && !S.taken.has(q.id)).map((q) => q.id);
    const pickHint = pickAt(pk('k312'));
    const st = S.state();
    const pass = hintNoKey.includes('調べる') && toastNoKey.includes('錠') && stillLocked && hintKey.includes('鍵を使う') && open
      && ['105', '220', '312', '705', 'B1', '玄関', '車'].every((k) => hooks.includes(k)) && hooks.length >= 9 && onlyKey.join() === 'k312'
      && pickHint.includes('拾う') && st.stage === 3 && st.item === '312' && N.hudState().objective === '312号室へ';
    return { pass, hintNoKey, toastNoKey, stillLocked, hintKey, open, hooks, keysOnFloor1: onlyKey, pickHint, stage: st.stage, item: st.item, events: evs(n0) };
  });

  // ---------------------------------------------------------------- 3) 312 → X312 → 105 の鍵
  await T('3_312_space_key105', async () => {
    S.applyStage(3); quiet();
    await tp(3, ...front('312', 0.9), -Math.PI / 2);
    S.item = null;
    const noKey = tryLocked('312');
    S.item = '312';
    const ent = openAndEnter('312');
    const inSpace = N.level === 'X312';
    walkTo(pk('k105').pos.x, pk('k105').pos.z - 0.8, 600);
    const pickHint = pickAt(pk('k105'));
    const st = S.state();
    const back = leave();
    const pass = noKey.toast === '鍵がかかっている' && noKey.angle < 0.01 && !noKey.unlocked && ent.hint.includes('鍵を使う') && ent.angle >= 0.45
      && ent.events.includes('unlock_door') && ent.events.includes('enter_space') && inSpace && pickHint.includes('拾う') && st.stage === 4 && st.item === '105'
      && back.hint.includes('戻る') && back.level === 3 && Math.hypot(back.at.x - front('312', 0.9)[0], back.at.z - front('312', 0.9)[1]) < 0.1;
    return { pass, noKey, enter: ent, inSpace, pickHint, stage: st.stage, item: st.item, back };
  });

  // ---------------------------------------------------------------- 4) 105 → X105 → メモ
  await T('4_105_space_memo', async () => {
    S.applyStage(4); quiet();
    await tp(1, ...front('105', 0.9), -Math.PI / 2);
    S.item = null;
    const noKey = tryLocked('105');
    S.item = '105';
    const ent = openAndEnter('105');
    const objIn = N.hudState().objective;
    const memoHint = pickAt(pk('memo6F'));
    const toast = N.hudState().toast;
    const st = S.state();
    const back = leave();
    const pass = noKey.toast === '鍵がかかっている' && !noKey.unlocked && ent.level === 'X105' && objIn === '出口へ' && memoHint.includes('拾う') && toast.includes('6 階')
      && st.stage === 5 && st.item === null && N.hudState().objective === '6階の部屋から鍵を探せ' && back.level === 1;
    return { pass, noKey, enter: ent, objectiveInside: objIn, memoHint, toast, stage: st.stage, back };
  });

  // ---------------------------------------------------------------- 5) 6F: 罠 3 室・罠でない部屋・609 の 220 の鍵
  await T('5_6F_traps_and_key220', async () => {
    S.applyStage(5);
    const res = {};
    const rooms6 = N.building.floors.find((f) => f.level === 6).rooms.filter((r) => r.kind === 'unit').map((r) => r.id);
    const allEnterable = rooms6.length === 11 && rooms6.every((id) => room(id).r.door.enterable);
    let pass = allEnterable;
    for (const id of ['601', '604', '605', '606', '608', '611', '602', '603', '607', '610']) {
      quiet();
      N.ai.dormant = false;
      const r = room(id).r;
      await tp(6, ...front(id, 0.9), 0);
      N.openDoor(id, true); N.pump(DT, 60, false);
      const t0 = N.ai.time, n0 = S.logCount;
      const p = r.interior.points;
      const goal = p.deskFront || p.living;
      const walked = walkPath([[r.door.pos[0] - FN[r.door.facing][0] * 0.6, r.door.pos[1] - FN[r.door.facing][1] * 0.6], p.entry, p.room, goal]);
      N.pump(DT, 10, false);
      const trapped = evs(n0).includes('trap');
      const bev = N.ai.events.find((e) => e.t > t0 && e.ev === 'locker_burst');
      const burst = !!bev;
      const want = ['601', '606', '611'].includes(id);
      const at = bev ? { x: bev.x, z: bev.z, lv: bev.lv, room: bev.room } : null;
      const nearCloset = !want || (at && at.lv === 6 && at.room === id && Math.hypot(at.x - r.interior.hide.feet[0], at.z - r.interior.hide.feet[1]) < 0.05);
      const ok = (walked || want) && trapped === want && burst === want && nearCloset;   // 罠の部屋は飛び出しの視点固定で歩みが止まる
      if (!ok) pass = false;
      res[id] = { ok, walked, trapped, burst, enemyAt: want ? at : undefined };
    }
    quiet();
    // 609(罠でない): 220 の鍵
    const r = room('609').r;
    await tp(6, ...front('609', 0.9), 0);
    N.openDoor('609', true); N.pump(DT, 60, false);
    const p = r.interior.points;
    const walked = walkPath([[r.door.pos[0], r.door.pos[1] + 0.6], p.entry, p.room, p.deskFront]);
    const n0 = S.logCount;
    const hint = pickAt(pk('k220'));
    const st = S.state();
    const ok609 = walked && hint.includes('拾う') && !evs(n0).includes('trap') && st.stage === 6 && st.item === '220' && N.hudState().objective === '220号室へ';
    if (!ok609) pass = false;
    if (S.traps.size !== 3) pass = false;
    return { pass, allEnterable, rooms: res, room609: { ok: ok609, walked, hint, stage: st.stage, item: st.item }, trapsFired: [...S.traps] };
  });

  // ---------------------------------------------------------------- 6) 220 → 荒れた部屋 → 正面玄関の鍵
  await T('6_220_wrecked_entrance_key', async () => {
    S.applyStage(6); quiet();
    await tp(2, ...front('220', 0.9), 0);
    S.item = null;
    const noKey = tryLocked('220');
    S.item = '220';
    const d = door('220');
    face(d.pos[0], d.pos[1], 0); N.pump(DT, 2, false);
    const hint = N.hudState().hint;
    tap('KeyE'); N.pump(DT, 60, false);
    const opened = S.unlocked.has('220') && d.angle > 0.4 && !d.locked;
    // 管理人も通常どおり入れる扉になった(物語の施錠が外れた)
    const r = room('220').r;
    const p = r.interior.points;
    N.openDoor('220', true); N.pump(DT, 60, false);   // 全開に
    const walked = walkPath([[r.door.pos[0], r.door.pos[1] - 0.6], p.entry, p.room, p.deskFront]);
    const wrecked = r.interior.variant.type === 'wrecked';
    const pickHint = pickAt(pk('kEntrance'));
    const st = S.state();
    const pass = noKey.toast === '鍵がかかっている' && noKey.angle < 0.01 && hint.includes('鍵を使う') && opened && !d.storyLock && walked && wrecked
      && pickHint.includes('拾う') && st.stage === 7 && st.item === 'entrance' && N.hudState().objective === '正面玄関から駐車場へ';
    return { pass, noKey, hint, opened, walked, wrecked, pickHint, stage: st.stage, item: st.item };
  });

  // ---------------------------------------------------------------- 7) 正面玄関の鍵スイッチ・駐車場の車
  await T('7_entrance_keyswitch_cars', async () => {
    S.applyStage(7); quiet();
    await tp(1, 17.6, 27.4, Math.PI);
    N.pump(DT, 90, false);
    const outer = N.doorApi.get('ENTRANCE_OUT');
    const closedBefore = outer.open01 === 0 && outer.locked;
    walkTo(17.6, 28.5, 120);
    const blocked = N.level === 1 && N.player.pos.z < 28.1;
    S.item = null;
    walkTo(18.9, 27.6, 200);
    face(19.54, 27.72, -0.1); N.pump(DT, 2, false);
    const hintNoKey = N.hudState().hint;
    tap('KeyE'); N.pump(DT, 4, false);
    const toastNoKey = N.hudState().toast, stillLocked = outer.locked && !N.flags.entranceOut;
    S.item = 'entrance';
    N.pump(DT, 2, false);
    const hintKey = N.hudState().hint;
    tap('KeyE'); N.pump(DT, 4, false);
    const unlocked = N.flags.entranceOut && !outer.locked && S.item === null;
    const outOK = walkTo(17.6, 27.6, 200) && walkTo(17.6, 30.0, 300) && N.level === 'G';
    // 車: 銀・紺は鍵、黒はグローブボックス
    const cars = N.building.site.cars;
    const res = [];
    for (const i of [1, 2, 0]) {
      const [x, z, w, dd] = cars[i].rect;
      await tp('G', x - 0.7, z + dd / 2, -Math.PI / 2);
      face(x + w / 2, z + dd / 2, -0.2); N.pump(DT, 2, false);
      const h = N.hudState().hint;
      tap('KeyE'); N.pump(DT, 4, false);
      res.push({ car: i, hint: h, toast: N.hudState().toast, item: S.item });
    }
    const st = S.state();
    const pass = closedBefore && blocked && hintNoKey.includes('調べる') && toastNoKey.includes('鍵穴') && stillLocked && hintKey.includes('鍵を使う') && unlocked && outOK
      && res[0].toast === '鍵がかかっている' && res[1].toast === '鍵がかかっている' && res[2].toast.includes('グローブボックス') && st.item === 'padlock'
      && st.stage === 8 && st.unlocked.includes('GLOVEBOX') && N.hudState().objective.startsWith('屋上へ');
    return { pass, closedBefore, blocked, hintNoKey, toastNoKey, hintKey, unlocked, outOK, cars: res, stage: st.stage, item: st.item };
  });

  // ---------------------------------------------------------------- 8) 南京錠 → 屋上A → 705 の鍵
  await T('8_padlock_roofA_key705', async () => {
    S.applyStage(8); quiet();
    await tp(4, 14.3, 6.6, 0);
    S.item = null;
    face(14.72, 5.875, -0.3); N.pump(DT, 2, false);
    const hintNoKey = N.hudState().hint;
    tap('KeyE'); N.pump(DT, 6, false);
    const toastNoKey = N.hudState().toast;
    const noVault = !N.rooms.state().vault && !N.flags.roofA;
    S.item = 'padlock';
    N.pump(DT, 2, false);
    const hintKey = N.hudState().hint;
    tap('KeyE'); N.pump(DT, 6, false);
    const roofA = N.flags.roofA && S.item === null;
    face(14.3, 6.05, -0.3); N.pump(DT, 2, false);
    const climbHint = N.hudState().hint;
    tap('KeyE');
    for (let i = 0; i < 200 && N.rooms.state().vault; i++) N.pump(DT, 1, false);
    N.pump(DT, 10, false);
    const onRoof = N.level === 4 && N.player.pos.z < 5.7;
    const walked = walkPath([[13.0, 4.9], [5.0, 4.6], [2.0, 1.4]]);
    const pickHint = pickAt(pk('k705'));
    const st = S.state();
    const pass = hintNoKey.includes('調べる') && toastNoKey.includes('南京錠') && noVault && hintKey.includes('鍵を使う') && roofA && climbHint.includes('乗り越える')
      && onRoof && walked && pickHint.includes('拾う') && st.stage === 9 && st.item === '705' && N.hudState().objective === '705号室へ';
    return { pass, hintNoKey, toastNoKey, noVault, hintKey, roofA, climbHint, onRoof, walked, pickHint, stage: st.stage, item: st.item };
  });

  // ---------------------------------------------------------------- 9) 705 → X705 → 地下の鍵 → 背後に管理人 → 追跡(階段・EV なし)→ 1F で第10段
  await T('9_705_space_final_chase', async () => {
    S.applyStage(9); quiet();
    N.ai.dormant = false;
    await tp(7, ...front('705', 0.9), Math.PI);
    // 第9段の 705 に入る前は EV が反応する
    const evBefore = !S.evDisabled;
    S.item = null;
    const noKey = tryLocked('705');
    S.item = '705';
    const ent = openAndEnter('705');
    const D = N.spaces.def('X705');
    const deskP = pk('kB1').pos;
    walkTo(deskP.x - 0.75, deskP.z, 300);
    const t0 = N.ai.time;
    const pickHint = pickAt(pk('kB1'));
    const objChase = (N.pump(DT, 2, false), N.hudState().objective);
    const evDis = S.evDisabled && N.ai.noEV && N.ai.allowStairs;
    N.pump(DT, 40, false);
    const appear = N.ai.events.find((e) => e.t > t0 && e.ev === 'appear_705');
    const ePos = { x: N.enemyObj.pos.x, z: N.enemyObj.pos.z, lv: N.ai.level };
    const behind = appear && ePos.lv === 'X705' && Math.hypot(ePos.x - D.at('ambush').x, ePos.z - D.at('ambush').z) < 0.6;
    // 逃げる: 出口へ走ると 7F の廊下へ(自動で戻る)
    while (N.viewLock.active) N.pump(DT, 1, false);
    let dead = false;
    key('ShiftLeft', true); key('KeyW', true);
    for (let i = 0; i < 300 && N.level === 'X705'; i++) { face(D.exit.x, D.exit.z, 0); N.pump(DT, 1, false); if (N.ai.state === 'ATTACK') { dead = true; break; } }
    key('ShiftLeft', false); key('KeyW', false);
    waitTrans();
    const on7 = N.level === 7;
    // 管理人も 705 から出てくる(出入り口を通って 7F へ)
    let enemyOn7 = null;
    walkTo(16.0, 21.2, 300, 0.2, true);
    for (let i = 0; i < 60 * 8 && enemyOn7 === null; i++) { N.pump(DT, 1, false); if (N.ai.level === 7 && !N.ai.transit) enemyOn7 = +(N.ai.time - t0).toFixed(2); if (N.ai.state === 'ATTACK') { dead = true; break; } }
    // EV は反応しない(呼びボタン)
    quiet();
    const panel = N.world.floors.get(7).panel;
    { const ex = panel.x - 0.18, ez = panel.z - 0.9; await tp(7, ex, ez, Math.atan2(-(panel.x - ex), -(panel.z - ez))); }
    N.pump(DT, 2, false);
    const callHint = N.hudState().hint;
    const ev0 = N.elevator.events.length ? N.elevator.events[N.elevator.events.length - 1].n : 0;
    tap('KeyE'); N.pump(DT, 4, false);
    const evToast = N.hudState().toast;
    const evCalled = N.elevator.events.some((e) => e.n > ev0 && e.ev === 'call');
    // 管理人の経路: 7F → 1F は階段(EV を使わない)
    N.ai.allowStairs = true; N.ai.noEV = true;
    const route = N.ai._route(16.0, 21.2, 17.6, 23.5, 7, 1);
    const vias = [...new Set(route.map((w) => w.via))];
    // 1F へ下りたら第10段「地下へ」
    await tp(1, 17.6, 23.5, 0);
    N.pump(DT, 4, false);
    const st = S.state();
    const pass = evBefore && noKey.toast === '鍵がかかっている' && ent.level === 'X705' && pickHint.includes('拾う') && objChase === '逃げろ' && evDis && !!appear && behind
      && !dead && on7 && enemyOn7 !== null && callHint.includes('呼ぶ') && evToast === '反応がない' && !evCalled
      && vias.includes('stair') && !vias.includes('ev') && st.stage === 10 && st.item === 'b1' && N.hudState().objective === '地下へ' && !N.ai.allowStairs;
    return { pass, evBefore, noKey, enter: ent, pickHint, objChase, evDisabled: evDis, appear: appear || null, enemyAt: ePos, behind, dead, on7, enemyOn7_s: enemyOn7,
      callHint, evToast, evCalled, routeVias: vias, stage: st.stage, item: st.item, objective: N.hudState().objective };
  });

  // ---------------------------------------------------------------- 10) 地下の鉄扉 → XB1 → 車のキー
  await T('10_B1_space_carkey', async () => {
    S.applyStage(10); quiet();
    const B = N.building.basement;
    await tp('B1', B.spawn[0], B.spawn[1], Math.PI / 2);
    walkTo(8.5, 1.45, 200);
    S.item = null;
    const noKey = tryLocked('B1DOOR');
    S.item = 'b1';
    const ent = openAndEnter('B1DOOR');
    walkTo(pk('kCar').pos.x, pk('kCar').pos.z - 0.8, 600);
    const pickHint = pickAt(pk('kCar'));
    const st = S.state();
    // 管理人は地下へ来ない(経路が無い)
    const routeB1 = N.ai._route(17.6, 23.5, 8.5, 1.45, 1, 'B1');
    const routeXB1 = N.ai._route(17.6, 23.5, 300, 3, 1, 'XB1');
    const back = leave();
    const pass = noKey.toast === '鍵がかかっている' && !noKey.unlocked && ent.hint.includes('鍵を使う') && ent.level === 'XB1' && pickHint.includes('拾う')
      && st.stage === 11 && st.item === 'car' && N.hudState().objective === '駐車場の車で逃げろ' && routeB1.length === 0 && routeXB1.length === 0 && back.level === 'B1';
    return { pass, noKey, enter: ent, pickHint, stage: st.stage, item: st.item, routeB1: routeB1.length, routeXB1: routeXB1.length, back };
  });

  // ---------------------------------------------------------------- 11) 最後だけ敷地まで追ってくる → 黒い車 → エンディング
  await T('11_site_chase_car_ending', async () => {
    S.applyStage(11); quiet();
    N.ai.dormant = false;
    await tp(1, 17.6, 27.0, Math.PI);
    const t0 = N.ai.time;
    // 正面玄関から外へ → 車まで走る
    const car = N.building.site.cars[0].rect;
    const path = [[17.6, 30.0], [24.0, 30.6], [28.9, 30.6], [28.9, 3.0], [30.7, 0.75]];
    let appearAt = null, onSite = null, minD = 1e9, dead = false, wi = 0;
    key('ShiftLeft', true); key('KeyW', true);
    for (let i = 0; i < 60 * 25 && wi < path.length; i++) {
      const p = N.player.pos, [x, z] = path[wi];
      if (Math.hypot(x - p.x, z - p.z) < 0.35) { wi++; continue; }
      face(x, z, 0);
      N.pump(DT, 1, false);
      if (appearAt === null && N.ai.events.some((e) => e.t > t0 && e.ev === 'appear_site')) appearAt = { t: +(N.ai.time - t0).toFixed(2), playerFromDoor: +Math.hypot(p.x - 17.6, p.z - 28.1).toFixed(2) };
      if (onSite === null && N.ai.level === 'G') onSite = +(N.ai.time - t0).toFixed(2);
      if (N.ai.level === N.level) minD = Math.min(minD, Math.hypot(N.enemyObj.pos.x - p.x, N.enemyObj.pos.z - p.z));
      if (N.ai.state === 'ATTACK' || N.deathState()) { dead = true; break; }
    }
    key('ShiftLeft', false); key('KeyW', false);
    const reached = wi >= path.length;
    const chaseState = N.ai.state;
    face(car[0] + car[2] / 2, car[1] + car[3] / 2, -0.2); N.pump(DT, 1, false);
    const rideHint = N.hudState().hint;
    tap('KeyE');
    const endingStarted = !!S.ending;
    let seatedLevel = null, camMoved = 0;
    const c0 = N.camera.position.clone();
    for (let i = 0; i < 60 * 12 && !S.ended; i++) { N.pump(DT, 1, false); if (seatedLevel === null && S.ending && S.ending.seated) seatedLevel = N.level; camMoved = Math.max(camMoved, N.camera.position.distanceTo(c0)); }
    const endEl = document.getElementById('story-end');
    const pass = appearAt !== null && onSite !== null && N.level === 'G' && reached && !dead && minD > 1.5 && rideHint.includes('乗る') && endingStarted
      && seatedLevel === 'G' && camMoved > 10 && S.ended && !!endEl && endEl.textContent.includes('脱出した') && (S.engineLog || []).includes('start');
    const res = { pass, appear: appearAt, enemyOnSite_s: onSite, reachedCar: reached, dead, minDist: +minD.toFixed(2), chaseState, rideHint, endingStarted, seatedLevel, camMoved: +camMoved.toFixed(1),
      ended: S.ended, endText: endEl ? endEl.textContent : null, engine: S.engineLog };
    if (endEl) endEl.remove();
    S.ending = null; S.ended = false; N.player.frozen = false; S._dash(false); S.fadeEl.style.opacity = '0';
    return res;
  });

  // ---------------------------------------------------------------- 12) チェックポイント
  await T('12_checkpoint_keeps_state', async () => {
    S.applyStage(6); quiet();
    N.doorApi.breakDoor('407');
    await tp(2, 22.0, 21.2, Math.PI / 2);
    const un0 = [...S.unlocked].sort();
    N.ai.dormant = false;
    N.enemy.place(21.0, 21.2, Math.PI / 2);
    N.ai.setLevel(2);
    N.enemy.setState('ATTACK');
    let died = false;
    for (let i = 0; i < 60 * 12; i++) { N.pump(DT, 1, false); if (N.deathState()) died = true; if (died && !N.deathState()) break; }
    N.pump(DT, 10, false);
    const sp = { level: N.level, ...pos() };
    const st = S.state();
    const pass = died && st.stage === 6 && st.item === '220' && JSON.stringify(st.unlocked) === JSON.stringify(un0) && un0.includes('105') && un0.includes('312') && un0.includes('KEYBOX')
      && !!N.doorApi.get('407').broken && sp.level === 2 && Math.abs(sp.x - 24.55) < 0.05 && Math.abs(sp.z - 21.2) < 0.05 && N.hudState().objective === '220号室へ';
    N.doorApi.repairDoor('407');
    return { pass, died, stage: st.stage, item: st.item, unlocked: st.unlocked, broken407: true, respawn: sp };
  });

  // ---------------------------------------------------------------- 13) 目標の文言と強調・持ち物の札
  await T('13_objective_text_and_item_tag', async () => {
    S.applyStage(3); quiet(); N.pump(DT, 2, false);
    const a = N.hudState();
    N.pump(DT, 150, false);
    const b = N.hudState();
    S.applyStage(4); N.pump(DT, 2, false);
    const c = N.hudState();
    const pass = a.objective === '312号室へ' && a.objectiveEm && !b.objectiveEm && b.objective === '312号室へ' && a.item === '鍵　312' && c.objective === '105号室へ' && c.objectiveEm && c.item === '鍵　105';
    return { pass, start: a, after25s: b, next: c };
  });

  quiet();
  S.applyStage(1);
  N.testResult = out;
  show();
  return out;
}
