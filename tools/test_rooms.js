// test_rooms.js — P3b 居室とバルコニー・屋上の決定的テスト(ブラウザ内)。http://localhost:8001/?test=rooms で自動実行。
// rAF に依存せず window.__N2.pump(dt, n) で本物のループと同じ順に進める。キーは keydown/keyup をペアで送る。結果: window.__N2.testResult
//  1) 410 の窓→バルコニー→台→屋上A→(401 側は固定の隔て板で越えられない)→410 の台へ戻って乗り越える→410 の室内(roofA=true)
//     P3b-3: 屋上への動線は 410 のみ(DESIGN §2.3)。401 の北端では「乗り越える」が出ず、E でも乗り越えず、南へ押しても屋上A から出ない
//     P3b-2: 410 の台は室外機。E → 室外機に乗る(目線が天板の分だけ上がる・まだ隔て板の手前)→ 越える → 屋上に降りる、の順を軌跡で確かめる。
//     1b) 逆向き: 屋上A → 隔て板を越えて室外機に降りる → 410 のバルコニー → 窓 → 410 の室内
//  2) roofA=false では台を乗り越えられない(「乗り越えられない」・隔て板を押しても抜けない)
//  3) 演出②: 知っている部屋(413)のクローゼットに隠れる → ゆっくり近づき目の前で立ち止まって焦らす(2〜4秒・足音が止まる・息遣い・取っ手)→開けて襲う(OUT)
//  4) 知らなければ部屋を一通り見て出て行く(410 のクローゼット・扉は開けておく)→生き残る
//  5) 触れると落ちる物: 通路の真ん中を歩けば落ちない／脇へ寄ると落ちる(落下音)→管理人が同じ階なら knownRoomId=その部屋、別の階なら知らない
//  6) 入れる部屋すべてで通路(玄関→洋室→窓→バルコニー)を実際に歩ける(当たりに引っかからない)。管理室は扉→机の前
//  7) 全居室にバルコニー(データ 104 室・読み込んだ階の GLB にバルコニーの床と手すり)

const DT = 1 / 60;

export async function run(N) {
  const out = { ok: true, cases: {} };
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:fixed;left:8px;top:8px;z-index:9;color:#9fe39f;background:rgba(0,0,0,.75);font:11px/1.35 monospace;padding:8px;max-width:46vw;max-height:94vh;overflow:auto;white-space:pre-wrap;';
  document.body.appendChild(pre);
  const show = () => { pre.textContent = JSON.stringify(out, null, 1); };
  const T = async (name, fn) => {
    try { const r = await fn(); out.cases[name] = r; if (!r.pass) out.ok = false; }
    catch (e) { out.cases[name] = { pass: false, error: String(e && e.stack || e) }; out.ok = false; }
    show();
  };
  const key = (code, down) => document.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
  const tap = (code, frames = 3) => { key(code, true); N.pump(DT, frames, false); key(code, false); N.pump(DT, 2, false); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pos = () => ({ x: +N.player.pos.x.toFixed(2), z: +N.player.pos.z.toFixed(2), level: N.level });
  const face = (x, z) => { const p = N.player.pos; N.player.object.rotation.set(0, Math.atan2(-(x - p.x), -(z - p.z)), 0, 'YXZ'); N.player.object.updateMatrixWorld(); };
  // 目標へ歩く(毎フレーム向きを合わせて W)。着いたら true
  const walkTo = (x, z, maxFrames = 600, tol = 0.12) => {
    key('KeyW', true);
    let ok = false, last = null, still = 0;
    for (let i = 0; i < maxFrames; i++) {
      const p = N.player.pos;
      if (Math.hypot(x - p.x, z - p.z) < tol) { ok = true; break; }
      face(x, z);
      N.pump(DT, 1, false);
      if (last && Math.hypot(p.x - last.x, p.z - last.z) < 1e-4) { if (++still > 30) break; } else still = 0;
      last = { x: p.x, z: p.z };
    }
    key('KeyW', false); N.pump(DT, 2, false);
    return ok;
  };
  const room = (id) => { for (const f of N.building.floors) { const r = f.rooms.find((rr) => rr.id === id); if (r) return { r, level: f.level }; } return null; };
  const rid = () => N.ai._rid(N.player.pos.x, N.player.pos.z, N.level);
  // 乗り越えの軌跡: E を押して終わるまで毎フレーム記録。toRoof=true(バルコニー→屋上): 室外機の天板に乗った時点(vault_on_step)で
  //  目線が 0.55m 以上上がり、まだ隔て板の手前(z > 線)。隔て板の線を越えるのはその後、足が天板より上の時。最後は屋上(z < 線)。
  //  toRoof=false(屋上→バルコニー): 越えてから室外機の天板に降り(z > 線・足 ≈ 天板)、バルコニーの床に降りる
  const traceVault = (toRoof = true) => {
    const y0 = N.player.pos.y, eye0 = N.player.object.position.y;
    const g = N.building.floors.find((f) => f.level === 4).gates.find((gg) => gg.room === '410');
    const lineZ = g.rect[1] + g.rect[3] / 2;
    const rv0 = N.rooms.events.length;
    tap('KeyE');
    let t = 0, stepAt = null, stepY = null, stepZ = null, eyeOnStep = null, crossAt = null, crossY = null, maxEye = 0;
    while ((N.rooms.state().vault || t < 0.1) && t < 5) {
      N.pump(DT, 1, false); t += DT;
      const p = N.player.pos;
      maxEye = Math.max(maxEye, N.player.object.position.y - eye0);
      if (stepAt === null && N.rooms.events.slice(rv0).some((e) => e.ev === 'vault_on_step')) { stepAt = t; stepY = p.y - y0; stepZ = p.z; eyeOnStep = N.player.object.position.y - eye0; }
      if (crossAt === null && (toRoof ? p.z < lineZ : p.z > lineZ)) { crossAt = t; crossY = p.y - y0; }
    }
    const evs = N.rooms.events.slice(rv0).map((e) => e.ev).filter((e) => /vault/.test(e));
    const order = toRoof ? ['vault_start', 'vault_on_step', 'vault_over', 'vault_end'] : ['vault_start', 'vault_over', 'vault_on_step', 'vault_end'];
    const ok = JSON.stringify(evs) === JSON.stringify(order) && stepAt !== null && crossAt !== null
      && Math.abs(stepY - g.stepTop) < 0.03 && stepZ > lineZ && stepZ < g.step[3] + 0.01
      && (toRoof ? (eyeOnStep >= 0.55 && crossAt > stepAt && crossY > g.stepTop) : (crossAt < stepAt))
      && Math.abs(N.player.pos.y - y0) < 1e-3 && !N.player.frozen;
    return { ok, events: evs, onStep_s: stepAt && +stepAt.toFixed(2), footOnStep_m: stepY && +stepY.toFixed(2), eyeRiseOnStep_m: eyeOnStep && +eyeOnStep.toFixed(2), zOnStep: stepZ && +stepZ.toFixed(2), crossLine_s: crossAt && +crossAt.toFixed(2), footAtCross_m: crossY && +crossY.toFixed(2), maxEyeRise_m: +maxEye.toFixed(2), total_s: +t.toFixed(2) };
  };
  const quietAI = () => { N.ai.reset(N.ENEMY_HOME.x, N.ENEMY_HOME.z, N.ENEMY_HOME.yaw, 4); N.ai.setState('SCRIPTED', { force: true }); N.enemy.place(6.9, 19.5, Math.PI); };
  quietAI();

  await T('1_410_roofA_401_blocked_back_to_410', async () => {
    N.flags.roofA = true;
    const w = room('410').r.window;
    await N.teleport(4, 13.1, 7.2, -Math.PI / 2);
    N.pump(DT, 2, false);
    face(13.8, (w.open[0] + w.open[1]) / 2); N.pump(DT, 2, false);
    const winHint = N.hudState().hint;
    tap('KeyE'); N.pump(DT, 70, false);
    const open410 = N.rooms.isWindowOpen('410');
    const toBalcony = walkTo(14.3, (w.open[0] + w.open[1]) / 2, 400);
    const onBalcony = rid() === '410' && N.player.pos.x > 13.85;
    walkTo(14.3, 6.55, 300);
    face(14.3, 5.6); N.pump(DT, 2, false);
    const gateHint = N.hudState().hint;
    const vault = traceVault();
    const onRoof = N.player.pos.z < 5.75 && N.level === 4;
    const roofP = pos();
    // 屋上A を西へ(室外機を避けて z=4.9)→ 401 のバルコニーの北端(固定の隔て板)の前
    const r1 = walkTo(13.0, 4.9, 400) && walkTo(0.4, 4.9, 1200) && walkTo(-0.5, 5.3, 300);
    face(-0.5, 6.3); N.pump(DT, 2, false);
    const at401Hint = N.hudState().hint;
    const target401 = N.hudState().kind;
    const rv0 = N.rooms.events.length;
    tap('KeyE'); N.pump(DT, 30, false);
    const vault401 = N.rooms.events.slice(rv0).some((e) => /vault/.test(e.ev)) || !!N.rooms.state().vault;
    // 南(401 のバルコニー)へ押し込んでも隔て板を抜けない
    walkTo(-0.5, 6.8, 180);
    const pushedZ = N.player.pos.z;
    const stillRoof = pushedZ < 5.8 && rid() !== '401';
    // 410 の台へ戻る → 隔て板を越えて室外機に降りる → バルコニー → (開いたままの)窓 → 410 の室内
    const back = walkTo(0.4, 4.9, 300) && walkTo(13.0, 4.9, 1200) && walkTo(14.3, 5.1, 300);
    face(14.3, 5.8); N.pump(DT, 2, false);
    const backHint = N.hudState().hint;
    const vaultBack = traceVault(false);
    const onBal2 = rid() === '410' && N.player.pos.z > 6.4;
    const inRoom = walkTo(14.3, (w.open[0] + w.open[1]) / 2, 400) && walkTo(12.6, 7.25, 400) && rid() === '410' && N.player.pos.x < 13.7;
    N.rooms.setWindow('410', false); N.pump(DT, 70, false);
    const pass = winHint.includes('窓を開ける') && open410 && toBalcony && onBalcony && gateHint.includes('乗り越える') && vault.ok && onRoof && r1
      && !at401Hint.includes('乗り越え') && !vault401 && stillRoof
      && back && backHint.includes('乗り越える') && vaultBack.ok && onBal2 && inRoom;
    return { pass, winHint, open410, onBalcony, gateHint, vault410: vault, onRoof, roofP, crossedRoof: r1,
      at401: { hint: at401Hint, target: target401, vaultStarted: vault401, pushedSouthZ: +pushedZ.toFixed(2), stillOnRoof: stillRoof },
      backTo410: { walked: back, hint: backHint, vault: vaultBack, onBalcony: onBal2, inRoom }, end: pos() };
  });

  await T('1b_roofA_back_to_410', async () => {
    // 屋上A(410 の北)から隔て板を越えて室外機に降り、410 のバルコニー → 窓 → 室内
    N.flags.roofA = true;
    await N.teleport(4, 14.3, 5.1, 0);
    N.pump(DT, 2, false);
    face(14.3, 5.8); N.pump(DT, 2, false);
    const hint = N.hudState().hint;
    const vault = traceVault(false);
    const onBal = rid() === '410' && N.player.pos.z > 6.4 && N.player.pos.x > 13.85;
    const w = room('410').r.window;
    N.rooms.setWindow('410', false); N.pump(DT, 70, false);
    const toWin = walkTo(14.3, (w.open[0] + w.open[1]) / 2, 400);
    face(13.0, (w.open[0] + w.open[1]) / 2); N.pump(DT, 2, false);
    const winHint = N.hudState().hint;
    tap('KeyE'); N.pump(DT, 70, false);
    const inRoom = walkTo(12.6, 7.25, 400) && rid() === '410' && N.player.pos.x < 13.7;
    N.flags.roofA = false;
    const pass = hint.includes('乗り越える') && vault.ok && onBal && toWin && winHint.includes('窓を開ける') && inRoom;
    return { pass, hint, vault, onBalcony: onBal, toWin, winHint, inRoom, end: pos() };
  });

  await T('2_roofA_locked', async () => {
    N.flags.roofA = false;
    await N.teleport(4, 14.3, 6.6, 0);
    N.pump(DT, 2, false);
    const hint = N.hudState().hint;
    tap('KeyE'); N.pump(DT, 5, false);
    const toast = N.hudState().toast;
    const vault = N.rooms.state().vault;
    walkTo(14.3, 4.5, 180);
    const z = N.player.pos.z;
    const pass = hint.includes('乗り越えられない') && toast.includes('乗り越えられない') && !vault && z > 5.86 && rid() === '410';
    return { pass, hint, toast, vaultStarted: vault, pushedNorthZ: +z.toFixed(2) };
  });

  // 隠れて管理人を待つ。返り値: 管理人の出来事と時刻
  async function hideAndWait(roomId, known, maxSec) {
    const { r, level } = room(roomId);
    const h = r.interior.hide;
    await N.teleport(level, h.out[0], h.out[1], 0);
    N.pump(DT, 2, false);
    face(h.feet[0], h.feet[1]); N.pump(DT, 2, false);
    const hint = N.hudState().hint;
    tap('KeyE');
    for (let i = 0; i < 90; i++) N.pump(DT, 1, false);
    const hidden = N.rooms.state().hidden;
    const ai = N.ai;
    ai.reset(6.9, 20.9, Math.PI, level);
    ai.setHideOdds({ enter: 1, closet: 1 });   // P5b-6: 演出②の通し(必ず入って開ける)。確率は ?test=enemy 25〜34 番
    if (known) ai.knownRoomId = roomId; else ai.knownRoomId = null;
    const ev0 = ai.events.length;
    const log = [];
    let t = 0, teaseStart = null, teaseEnd = null, minDist = 1e9, stepsDuringTease = 0, maxTeaseSpeed = 0, deadAt = null, logAtTease = 0;
    const a0 = N.enemyAudio.log.length; N.enemyAudio.log.length = 0;
    if (!known) ai.setState('SWEEP', { force: true, log: true, room: roomId });
    while (t < maxSec) {
      N.pump(DT, 1, false); t += DT;
      const evs = ai.events.slice(ev0);
      if (teaseStart === null && evs.some((e) => e.ev === 'locker_tease')) { teaseStart = t; logAtTease = N.enemyAudio.log.length; }
      if (teaseStart !== null && teaseEnd === null && evs.some((e) => e.ev === 'locker_open')) { teaseEnd = t; stepsDuringTease = N.enemyAudio.log.slice(logAtTease).filter((l) => l.name === 'step').length; }
      if (teaseStart !== null && teaseEnd === null) maxTeaseSpeed = Math.max(maxTeaseSpeed, N.enemyObj.speed || 0);
      const e = N.enemyObj.pos;
      minDist = Math.min(minDist, Math.hypot(e.x - h.feet[0], e.z - h.feet[1]));
      if (deadAt === null && N.deathState()) deadAt = t;
      if (deadAt !== null && t - deadAt > 0.5) break;
      if (!known && evs.some((ee) => ee.ev === 'sweep_end')) break;
    }
    void a0;
    return { hint, hidden, events: ai.events.slice(ev0).map((e) => e.ev), teaseStart, teaseEnd, minDist, deadAt, stepsDuringTease, maxTeaseSpeed, audio: N.enemyAudio.log.map((l) => l.name) };
  }

  await T('3_locker_known_out', async () => {
    // 413 のクローゼット。管理人は部屋を知っている(物音で知った場合と同じ状態)
    const r = await hideAndWait('413', true, 90);
    const order = ['locker_start', 'locker_approach', 'locker_tease', 'locker_handle', 'locker_open', 'attack_start', 'hit'];
    let k = 0; for (const e of r.events) if (e === order[k]) k++;
    const tease = r.teaseEnd !== null && r.teaseStart !== null ? r.teaseEnd - r.teaseStart : null;
    // 焦らしの間は足音なし(管理人の速さ 0)を、イベント後に確かめる
    // (入る時は鍵束→錠の段取り。プレイヤーが施錠していなければ鍵は使わず押し開ける= door_open_in)
    const pass = r.hint.includes('隠れる') && r.hidden && r.hidden.phase === 'hidden' && k === order.length && tease >= 2.0 && tease <= 4.3
      && r.minDist < 1.3 && r.deadAt !== null && r.audio.includes('breath') && r.audio.includes('handle') && r.events.includes('door_open_in')
      && r.stepsDuringTease === 0 && r.maxTeaseSpeed < 0.05;
    N.pump(DT, 400, false);   // 復帰
    const respawned = !N.rooms.state().hidden && !N.deathState();
    return { pass: pass && respawned, hint: r.hint, hidden: r.hidden, stepsDuringTease: r.stepsDuringTease, maxSpeedDuringTease: +r.maxTeaseSpeed.toFixed(3), sequence: r.events.filter((e) => order.includes(e) || e === 'keys' || e === 'door_open_in'), tease_s: tease && +tease.toFixed(2), minDistToCloset_m: +r.minDist.toFixed(2), deadAt_s: r.deadAt && +r.deadAt.toFixed(1), sounds: [...new Set(r.audio)], respawned };
  });

  await T('4_locker_unknown_safe', async () => {
    // 410 のクローゼット。扉は開けたまま(見回りで入ってくる)、管理人は部屋を知らない → 部屋を一通り見て出て行く
    N.doorApi.open('410'); N.pump(DT, 60, false);
    const r = await hideAndWait('410', false, 70);
    const swept = r.events.includes('sweep_room') && r.events.includes('sweep_end');
    const inRoom = r.minDist < 3.0;
    const pass = r.hidden && swept && inRoom && r.deadAt === null && !r.events.includes('locker_start') && !r.events.includes('attack_start') && N.rooms.state().hidden;
    // 出る
    tap('KeyE'); N.pump(DT, 70, false);
    const unhid = !N.rooms.state().hidden && !N.player.frozen;
    quietAI();
    return { pass: pass && unhid, swept, enemyEnteredRoom: inRoom, minDistToCloset_m: +r.minDist.toFixed(2), died: r.deadAt !== null, events: r.events.filter((e) => /sweep|door|locker|attack|entered/.test(e)).slice(0, 14), unhid };
  });

  await T('5_fallables_noise', async () => {
    quietAI();
    N.rooms.resetFallables();
    const { r } = room('410');
    const it = r.interior;
    const vase = N.rooms.fallables.find((f) => f.room === '410' && f.type === 'vase');
    // a) 通路の真ん中を玄関→窓→玄関と歩いても落ちない
    await N.teleport(4, 8.2, 7.25, -Math.PI / 2);
    const lane = it.passage[0].rect;
    const zc = (lane[1] + lane[3]) / 2;
    walkTo(12.6, zc, 600); walkTo(8.3, zc, 600);
    const fallenCenter = N.rooms.state().fallen.length;
    // b) 管理人は同じ階(廊下・SCRIPTED→巡回)。シューズケースに寄って歩く → 花瓶が落ちる → 部屋を知る
    N.ai.reset(6.9, 16.0, Math.PI, 4);
    N.ai.knownRoomId = null;
    const ev0 = N.ai.events.length, rv0 = N.rooms.events.length;
    walkTo(vase.x, vase.z - 0.05, 120, 0.05);
    let t = 0; while (t < 2.0) { N.pump(DT, 1, false); t += DT; }
    const revs = N.rooms.events.slice(rv0);
    const knocked = revs.some((e) => e.ev === 'knock' && e.id === vase.id);
    const sound = revs.some((e) => e.ev === 'fall_sound' && e.id === vase.id) && revs.some((e) => e.ev === 'sfx' && e.name === 'fall_vase');
    const known = N.ai.knownRoomId;
    const why = (N.ai.events.slice(ev0).find((e) => e.ev === 'room_known') || {}).why;
    const vaseY = +(vase.mesh.position.y - 3 * 2.9).toFixed(2);
    // c) 管理人が別の階(2F)なら知らない(413 の床の空き缶)
    quietAI();
    N.ai.reset(6.9, 20.9, Math.PI, 2);
    N.ai.knownRoomId = null;
    const can = N.rooms.fallables.find((f) => f.room === '413' && f.type === 'cans');
    const { r: r413 } = room('413');
    await N.teleport(4, r413.interior.points.entry[0], r413.interior.points.entry[1], 0);
    const rv1 = N.rooms.events.length;
    walkTo(can.x, can.z, 300, 0.05);
    N.pump(DT, 90, false);
    const knocked2 = N.rooms.events.slice(rv1).some((e) => e.ev === 'knock' && e.id === can.id);
    const known2 = N.ai.knownRoomId;
    quietAI();
    const pass = fallenCenter === 0 && knocked && sound && known === '410' && why === 'noise' && vaseY < 0.2 && knocked2 && known2 === null;
    return { pass, fallenWalkingCenter: fallenCenter, knocked, sound, knownRoomId: known, why, vaseRestY: vaseY, otherFloor: { knocked: knocked2, knownRoomId: known2 } };
  });

  await T('6_passages_all_rooms', async () => {
    quietAI();
    const res = {};
    let pass = true;
    const save = N.flags.roofA;
    for (const f of N.building.floors) {
      if (f.level > 7) continue;
      for (const r of f.rooms) {
        if (!(r.door && r.door.enterable)) continue;
        const it = r.interior;
        const p = it.points;
        const [dx, dz] = r.door.pos;
        const fn = { E: [1, 0], W: [-1, 0], N: [0, -1], S: [0, 1] }[r.door.facing];
        N.teleport(f.level, dx - fn[0] * 0.45, dz - fn[1] * 0.45, 0);   // 扉の内側(読み込みは待たない。当たりはデータから常駐)
        N.pump(DT, 1, false);
        let ok = true;
        const steps = [];
        if (r.kind === 'unit') {
          for (const k of ['entry', 'room', 'living', 'window']) { const a = walkTo(p[k][0], p[k][1], 500, 0.2); steps.push(a); ok = ok && a; }
          // 窓を開けてバルコニーへ
          N.rooms.setWindow(r.id, true); N.pump(DT, 70, false);
          const b = r.balcony.rect;
          const bx = b[0] + b[2] / 2, bz = b[1] + b[3] / 2;
          const w = r.window;
          const wa = (w.open[0] + w.open[1]) / 2;
          const tgt = w.axis === 'z' ? [bx, wa] : [wa, bz];
          const onBal = walkTo(tgt[0], tgt[1], 400, 0.2);
          steps.push(onBal); ok = ok && onBal;
          N.rooms.setWindow(r.id, false); N.pump(DT, 70, false);
        } else {
          for (const k of ['entry', 'room', 'living']) { const a = walkTo(p[k][0], p[k][1], 500, 0.25); steps.push(a); ok = ok && a; }
        }
        res[r.id] = ok ? 'ok' : steps.map((s) => (s ? 1 : 0)).join('') + '@' + JSON.stringify(pos());
        if (!ok) pass = false;
      }
    }
    N.flags.roofA = save;
    await N.teleport(4, 6.9, 7.6, Math.PI);
    return { pass, rooms: Object.keys(res).length, result: res };
  });

  await T('7_all_balconies', async () => {
    const per = {};
    let total = 0, ok = true;
    for (const f of N.building.floors) {
      if (f.level > 7) continue;
      const units = f.rooms.filter((r) => r.kind === 'unit');
      const withBal = units.filter((r) => r.balcony && r.balcony.rect[2] > 0);
      per[f.level] = `${withBal.length}/${units.length}`;
      total += withBal.length;
      if (withBal.length !== units.length) ok = false;
    }
    await N.teleport(4, 6.9, 7.6, Math.PI);
    for (let i = 0; i < 100 && !N.world.isReady(4); i++) await sleep(50);
    const g = N.world.floors.get(4).group;
    const glb = ['merged_MR_BalFloor', 'merged_MR_Rail', 'merged_MR_Partition', 'merged_MX_Bars', 'merged_MR_Roof'].map((n) => [n, !!g.getObjectByName(n)]);
    const glbOk = glb.every(([, v]) => v);
    return { pass: ok && total === 104 && glbOk, total, perFloor: per, glb4F: Object.fromEntries(glb) };
  });

  quietAI();
  N.flags.roofA = false;
  await N.teleport(4, 6.9, 7.6, Math.PI);
  N.render();
  N.testResult = out;
  console.log('[test_rooms]', JSON.stringify(out));
  return out;
}
