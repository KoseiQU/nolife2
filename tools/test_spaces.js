// test_spaces.js — P5b-2a/2b/4 異世界 4 空間(105 の長い廊下・312 の無限の自室・705 の柱の広間・B1 のトンネルと迷路)と第7段の窓の管理人の決定的テスト(ブラウザ内)。http://127.0.0.1:8001/index.html?test=spaces で自動実行。
// rAF に依存せず window.__N2.pump(dt, n) で本物のループと同じ順に進める。キーは keydown/keyup をペアで送る。結果: window.__N2.testResult。?only=105_1,312_2 で絞れる
//  105_1) 伸びる: 歩いても前の分岐との距離が縮まない期間がある・振り返ると来た道が壁(背後 7m)・伸び終わると近づける
//  105_2) 分岐と折り返し: F1 の左は施錠・右で R1 へ、F2 の右は施錠・左を抜けると扉が閉まって最初の地点(R0 の入口)へ戻る(継ぎ目なし: 見た目の座標が同じ)・2 回目は左が施錠で右が開く
//  105_3) 反転: 反転の扉を抜けるとカメラのロールが π に達する・床の高さと当たりは変わらない・A/D が入れ替わる
//  105_4) 追跡: 管理人が背後に現れて CHASE・壁と天井が歪む・背後から灯りが消える(消えた灯りはすべてプレイヤーの後ろ)・走り続ければ出口 → 105 の扉の前(第5段)
//  105_5) 止まると捕まる → 105 の扉の前(扉を向く)・次に入ると追跡の区間の前から
//  312_1) 無限の自室(P5b-4): 312 の中は 410 の複製。窓の扉を開けて 5 部屋(R1〜R5)を抜ける(R2 床の物・R3 白いポスター/止まった時計/閉じたカーテン・R4 乱れた布団/半開きのクローゼット・R5 消灯)。
//         R5 のベッド脇に管理人が座って見ている(SCRIPTED・追跡しない)・懐中電灯で顔を上げる・奥の扉は開かない・机の 105 の鍵(R5 でだけ拾える)で第4段
//  312_2) 戻り: 鍵の後は 7 部屋(B1〜B7・鏡像)。各部屋で管理人が出口の扉に近づく(座る → 立つ → 戸口の脇)・襲わない・B7 の玄関の扉 = 312 の扉 → 3F(目標「105号室へ」)
//  312_3) 鏡像でも当たりは正しい(乱数で歩き回って壁・家具に入らない・閉じ込めない)・Ctrl は何もしない・死なない・鍵の後に入り直すと 1 部屋だけの普通の 410(奥は開かない)
//  705_1) 増える(P5b-2b): 奥へ進むほど柱が増える(見ていない・離れた所にだけ)・机の前では入口の扉が柱の列に隠れる(最初の柱だけなら見えていた)
//  705_2) 反転: 鍵で灯りが一斉に消え、出口は反対側(南)・管理人はそこから現れる → 西の壁際を回って南の出口 → 7F・管理人も出入り口から追ってくる(追跡中は歪み 1)
//  705_3) 歪みは見た目だけ: 歪み 0 と 1 で当たりの一覧が同じ・柱に当たって止まる所が同じ
//  B1_1) ループ: 標識灯を 3 回通ると気づく(その間 z は窓の外へ出ない)・歩き続けると環状のまま・立ち止まると抜けて迷路へ。入り直して振り返る版も抜ける
//  B1_2) 迷路: 作業場まで歩く間に変わった仕切りは、どれもその瞬間の視野の外・入口と作業場はいつも繋がっている
//  B1_3) 伸びる: 車のキー(第11段)→ 戻ると背後の灯りが消え(前は点いている)、踊り場の扉は 2 周するまで「開かない」→ 開いた扉から鉄扉 → B1 → 1F で「駐車場の車で逃げろ」。戻り道 > 行き
//  W_7) 第7段の窓の内側の管理人: 自動では出ない・force で 409 の窓に出る・見える(遮る物なし)・見た後に目をそらすと消える・近づくと消える・第8段/第6段では出ない
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
  const pickNow = (id) => { const p = S.pickups.find((q) => q.id === id); face(p.pos.x, p.pos.z, -0.6); N.pump(DT, 2, false); const h = N.hudState().hint; tap('KeyE'); N.pump(DT, 2, false); return h; };
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

  // ================================================================ 312(P5b-4: 無限の自室。型の局所 tu・tz は D312().world(部屋, tu, tz) で世界へ)
  const enter312 = async () => {
    S.applyStage(3); quiet();
    for (let i = 0; i < 200 && !D312().ready(); i++) await new Promise((r) => setTimeout(r, 50));   // 410 の型(4F の GLB)の読み込み
    const b = SP.def('X312').back;
    await tp(3, b.x, b.z, b.yaw + Math.PI);
    S.item = '312';
    return openAndEnter('312');
  };
  const st312 = () => D312().state();
  const hold = (code, sec, each = null) => { key(code, true); let t = 0; for (; t < sec; t += DT) { N.pump(DT, 1, false); if (each && each(t)) break; } key(code, false); N.pump(DT, 2, false); return t; };
  const Wr = (i, tu, tz) => { const p = D312().world(D312().roomAt(i), tu, tz); return [p.x, p.z]; };
  // 部屋 i の出口の扉を E で開けて通り抜ける(行き = 窓の扉 tu 6、戻り = 玄関の扉 tu 0)
  const passDoor = (i) => {
    const r = D312().roomAt(i), back = r.exit === 'genkan';
    const tz = back ? 1.45 : r.farTz, tu = back ? 0 : 6;
    walkTo(...Wr(i, back ? 0.85 : 5.15, tz), { max: 900, tol: 0.12 });
    face(...Wr(i, tu, tz), 0); N.pump(DT, 2, false);
    const hint = N.hudState().hint; tap('KeyE'); N.pump(DT, 50, false);
    const ok = walkTo(...Wr(i, back ? -0.9 : 6.9, tz), { max: 900, tol: 0.12 });
    N.pump(DT, 40, false);
    return { hint, ok, room: st312().room.id };
  };
  // 戻りの部屋 i を窓の扉から玄関の扉へ(管理人の横を A 側 tz 1.8 で抜ける)
  const crossBack = (i, each) => walkPath([[4.3, 1.75], [3.2, 1.85], [2.0, 1.85], [1.1, 1.8], [0.85, 1.45]].map(([tu, tz]) => Wr(i, tu, tz)), { max: 900, tol: 0.14, each });
  const mgrDistToExit = (i) => { const e = N.enemyObj.pos, d = Wr(i, 0, 1.45); return Math.hypot(e.x - d[0], e.z - d[1]); };

  await T('312_1_five_rooms_key_watcher', async () => {
    const lv = await enter312();
    const obj = N.hudState().objective;
    const k = S.pickups.find((q) => q.id === 'k105');
    const canPickR1 = k.need();
    const rooms = [];
    for (let i = 0; i < 5; i++) {
      N.pump(DT, 10, false);
      const lk = D312().look(i), r = st312().room;
      rooms.push({ id: r.id, extras: lk.extras, poster: lk.blank ? 'blank' : 'orig', curtain: lk.curtainProc ? 'closed' : 'orig', bed: lk.messy ? 'messy' : 'orig', closet: lk.closet, lamp: lk.lamp, clockRun: r.clock === 'run' });
      if (i < 4) { const p = passDoor(i); rooms[i].doorHint = p.hint; if (!p.ok) rooms[i].stuck = true; }
    }
    // 時計: R1 は秒針が進む(2 秒で 2 目盛り)、R5 は止まっている
    const h0 = D312().look(4).hand; N.pump(DT, 120, false); const h1 = D312().look(4).hand;
    // 管理人: ベッド脇に座ってこちらを見ている(追跡でない・見えている)
    walkTo(...Wr(4, 3.9, 1.7), { max: 600 });
    const e = N.enemyObj.pos; face(e.x, e.z, -0.2); N.pump(DT, 4, false);
    const c = N.camera.position, f = N.camera.getWorldDirection(new N.THREE.Vector3());
    const dx = e.x - c.x, dz = e.z - c.z, L = Math.hypot(dx, dz);
    const mgr = { ...st312().mgr, aiState: N.ai.state, aiLevel: N.ai.level, visible: N.enemyObj.root.visible, dist: +L.toFixed(2), angleDeg: +(Math.acos((dx * f.x + dz * f.z) / L / Math.hypot(f.x, f.z)) * 180 / Math.PI).toFixed(1) };
    const bed = D312().cols(4)[6 + 10];   // 型の当たりの 10 番 = ベッド
    const besideBed = e.z > bed.minZ - 0.1 && e.z < bed.maxZ + 0.15 && e.x > bed.minX && e.x < bed.maxX;
    // 懐中電灯を当てると顔を上げる
    N.setFlashlight(true); N.pump(DT, 30, false); face(e.x, e.z, -0.15);
    for (let t = 0; t < 1.5; t += DT) N.pump(DT, 1, false);
    const lookUp = st312().mgr.look, raisedLog = st312().log.some((l) => l.ev === 'mgr_look_up');
    N.setFlashlight(false); N.pump(DT, 10, false);
    // 奥(窓の扉)は開かない
    walkTo(...Wr(4, 5.2, 1.45), { max: 600 }); face(...Wr(4, 6, 1.45)); N.pump(DT, 2, false);
    tap('KeyE'); N.pump(DT, 10, false);
    const farToast = N.hudState().toast, farAngle = D312().door(5).angle;
    // 机の 105 の鍵
    walkTo(...Wr(4, 4.42, 1.72), { max: 600 });
    const canPickR5 = k.need();
    const pickHint = pickNow('k105');
    N.pump(DT, 30, false);
    const st = S.state(), ph = st312().phase;
    const stateSeen = N.ai.state;
    const okRooms = rooms.length === 5 && rooms.every((r, i) => r.id === 'R' + (i + 1) && !r.stuck)
      && !rooms[0].extras && rooms[0].poster === 'orig' && rooms[0].curtain === 'orig' && rooms[0].bed === 'orig' && rooms[0].closet === 0 && rooms[0].lamp > 0.5 && rooms[0].clockRun
      && rooms[1].extras && rooms[1].poster === 'orig' && rooms[1].bed === 'orig'
      && rooms[2].poster === 'blank' && rooms[2].curtain === 'closed' && !rooms[2].clockRun && rooms[2].bed === 'orig'
      && rooms[3].bed === 'messy' && rooms[3].closet !== 0 && rooms[3].lamp > 0.5
      && rooms[4].lamp === 0 && rooms[4].bed === 'messy' && rooms.slice(0, 4).every((r) => r.doorHint.includes('開ける'));
    const pass = lv === 'X312' && obj === '312号室へ' && okRooms && !canPickR1 && canPickR5 && Math.abs(h1 - h0) < 0.05
      && mgr.room === 'R5' && mgr.pose === 'sit' && mgr.aiState === 'SCRIPTED' && mgr.aiLevel === 'X312' && mgr.visible && mgr.angleDeg < 20 && besideBed
      && lookUp > 0.8 && raisedLog && farToast === '開かない' && Math.abs(farAngle) < 0.01
      && pickHint.includes('拾う') && st.stage === 4 && st.item === '105' && ph === 'ret' && !['CHASE', 'ATTACK'].includes(stateSeen);
    return { pass, level: lv, objective: obj, rooms, canPick: { R1: canPickR1, R5: canPickR5 }, clockR5: [h0, h1], mgr, besideBed, lookUp: +lookUp.toFixed(2), raisedLog, farDoor: { toast: farToast, angle: farAngle }, pickHint, stage: st.stage, item: st.item, phase: ph };
  });

  await T('312_2_return_seven_rooms_watcher_closer_exit_3F', async () => {
    if (N.level !== 'X312' || st312().phase !== 'ret') return { pass: false, why: 'needs 312_1' };
    const deaths0 = N.deaths(), states = new Set(), rooms = [];
    const r5 = passDoor(0);
    for (let i = 1; i <= 7; i++) {
      N.pump(DT, 20, false);
      const st = st312();
      const rec = { id: st.room.id, mirror: st.room.mirror, mgrRoom: st.mgr && st.mgr.room, pose: st.mgr && st.mgr.pose, mgrToExit: st.mgr && st.mgr.room === st.room.id ? +mgrDistToExit(i).toFixed(2) : null, mgrVisible: N.enemyObj.root.visible };
      crossBack(i, () => { states.add(N.ai.state); return false; });
      rec.passed = true;
      rooms.push(rec);
      if (i < 7) { const p = passDoor(i); rec.doorHint = p.hint; }
    }
    // B7 の玄関の扉 = 312 の扉 → 3F
    const exits = SP.exits('X312');
    const exitHint = (() => { face(...Wr(7, 0, 1.45), 0); N.pump(DT, 2, false); return N.hudState().hint; })();
    walkTo(...Wr(7, -0.5, 1.45), { max: 600 });
    waitTrans();
    const at = pos(), b = SP.def('X312').back;
    const dists = rooms.map((r) => r.mgrToExit);
    const closer = dists.every((d, i) => d !== null && (i === 0 || d <= dists[i - 1] + 0.01)) && dists[6] < 1.0 && dists[0] > 3.5;
    const poses = rooms.map((r) => r.pose);
    const pass = r5.room === 'B1' && rooms.length === 7 && rooms.every((r, i) => r.id === 'B' + (i + 1) && r.mirror && r.mgrRoom === r.id && r.mgrVisible) && closer
      && poses[0] === 'sit' && poses[6] === 'stand' && poses.indexOf('stand') > 0 && poses.lastIndexOf('sit') < poses.indexOf('stand')
      && !states.has('CHASE') && !states.has('ATTACK') && N.deaths() === deaths0 && exits.length === 1 && exitHint.includes('戻る')
      && at.level === 3 && Math.hypot(at.x - b.x, at.z - b.z) < 0.1 && N.hudState().objective === '105号室へ' && S.state().stage === 4 && N.ai.level !== 'X312';
    return { pass, firstBack: r5, rooms, mgrToExit: dists, poses, aiStates: [...states], exitHint, exits: exits.map((e) => [+e.x.toFixed(2), +e.z.toFixed(2)]), back: at, objective: N.hudState().objective, aiLevel: N.ai.level };
  });

  await T('312_3_mirror_collision_ctrl_nodeath_reentry', async () => {
    const lv = await enter312();
    const deaths0 = N.deaths();
    let deathSeen = false;
    // R5 へ移して鍵 → 戻りの B3(鏡像)へ
    D312().jump(4, 4.42, 1.72); N.pump(DT, 20, false);
    pickNow('k105'); N.pump(DT, 60, false);
    D312().jump(3, 4.9, 1.6); N.pump(DT, 30, false);
    const r = D312().cur();
    const bed = D312().cols(3)[6 + 10], bedR = (() => { const s = D312().solids()[10]; return { minZ: s[1], maxZ: s[3] }; })();
    const mirrored = r.mirror && Math.abs(bed.minZ - (r.zBase - bedR.maxZ)) < 1e-6 && Math.abs(bed.maxZ - (r.zBase - bedR.minZ)) < 1e-6;
    // 当たり: 乱数の向きで 2400 フレーム歩き回る。体の中心はいつも、実体のある部屋の床の中(壁の中に入らない)・家具の箱の中に入らない
    const inside = () => {
      const p = N.player.pos;
      for (const i of [st312().idx - 1, st312().idx, st312().idx + 1]) {
        const q = D312().roomAt(i); if (!q || q.slot == null) continue;
        const L = { tu: p.x - q.x0, tz: q.mirror ? q.zBase - p.z : p.z - q.zBase };
        if (L.tu > 0.06 + 0.27 && L.tu < 5.94 - 0.27 && L.tz > 0.06 + 0.27 && L.tz < 2.84 - 0.27) return true;
        if (Math.abs(L.tu) < 0.4 && Math.abs(L.tz - 1.45) < 0.45) return true;          // 玄関の扉の戸口
        if (Math.abs(L.tu - 6) < 0.4 && Math.abs(L.tz - q.farTz) < 0.45) return true;   // 窓の扉の戸口
      }
      return false;
    };
    const inSolid = () => { const p = N.player.pos; return N.collisions.some((c) => !c.disabled && c.kind !== 'enemy' && p.x > c.minX + 0.02 && p.x < c.maxX - 0.02 && p.z > c.minZ + 0.02 && p.z < c.maxZ - 0.02 && c.y0 < N.player.pos.y + 1.0); };
    let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    let out = 0, solid = 0, moved = 0, last = { ...N.player.pos };
    key('KeyW', true);
    for (let f = 0; f < 2400; f++) {
      if (f % 45 === 0) N.player.object.rotation.set(0, rnd() * Math.PI * 2, 0, 'YXZ');
      N.pump(DT, 1, false);
      if (!inside()) out++;
      if (inSolid()) solid++;
      if (N.deathState()) deathSeen = true;
      moved += Math.hypot(N.player.pos.x - last.x, N.player.pos.z - last.z); last = { ...N.player.pos };
    }
    key('KeyW', false); N.pump(DT, 2, false);
    // 閉じ込めない: 今の部屋から玄関の扉へ(戻りの出口の向き)歩いて次の部屋へ行ける
    D312().jump(3, 3.0, 1.85); N.pump(DT, 10, false);
    const walked = crossBack(3);
    const p = passDoor(3);
    // Ctrl を押しても何も起きない(目の高さ・位置が同じ)
    const eye0 = N.camera.position.y, pos0 = { ...N.player.pos };
    hold('ControlLeft', 1.0);
    const ctrl = { eyeDiff: +Math.abs(N.camera.position.y - eye0).toFixed(4), moved: +Math.hypot(N.player.pos.x - pos0.x, N.player.pos.z - pos0.z).toFixed(4) };
    // 鍵の後にもう一度入る: 1 部屋だけの普通の 410(奥の扉は開かない・312 の扉から出られる)
    D312().jump(7, 1.2, 1.45); N.pump(DT, 30, false);
    walkTo(...Wr(7, -0.5, 1.45), { max: 600 }); waitTrans();
    const outAt = pos();
    const b = SP.def('X312').back;
    await tp(3, b.x, b.z, b.yaw + Math.PI);
    const d312 = N.doorApi.get('312');
    face(d312.pos[0], d312.pos[1], 0); N.pump(DT, 2, false);
    if (d312.angle < 0.3) tap('KeyE');
    N.pump(DT, 60, false);
    walkTo(d312.pos[0] + 0.6, d312.pos[1], { max: 240, tol: 0.1 }); waitTrans();
    const lv2 = N.level;
    const plain = { ...st312() };
    walkTo(...Wr(0, 5.2, 1.45), { max: 900 }); face(...Wr(0, 6, 1.45)); N.pump(DT, 2, false);
    tap('KeyE'); N.pump(DT, 10, false);
    const plainToast = N.hudState().toast;
    walkTo(...Wr(0, -0.5, 1.45), { max: 900 }); waitTrans();
    const back2 = pos();
    const pass = lv === 'X312' && mirrored && out === 0 && solid === 0 && moved > 10 && walked && p.room === 'B4' && ctrl.eyeDiff < 0.001 && ctrl.moved < 0.001
      && !deathSeen && N.deaths() === deaths0 && outAt.level === 3 && lv2 === 'X312' && plain.phase === 'plain' && plain.pathLen === 1 && plainToast === '開かない'
      && back2.level === 3 && Math.hypot(back2.x - b.x, back2.z - b.z) < 0.1;
    return { pass, level: lv, mirrored, bedWorldZ: [+bed.minZ.toFixed(2), +bed.maxZ.toFixed(2)], randomWalk: { frames: 2400, outsideRoom: out, insideSolid: solid, moved_m: +moved.toFixed(1) }, walkedToGenkan: walked, nextRoom: p.room, ctrl,
      deaths: N.deaths() - deaths0, deathSeen, reentry: { phase: plain.phase, rooms: plain.pathLen, farDoorToast: plainToast, out: back2 } };
  });

  // ================================================================ 705(P5b-2b)
  const W705 = (u, v) => [420 + u, v];
  const D705 = () => SP.debug('X705');
  const st705 = () => D705().state();
  const frustum = () => { const F = new N.THREE.Frustum(), M = new N.THREE.Matrix4(); N.camera.updateMatrixWorld(); M.multiplyMatrices(N.camera.projectionMatrix, N.camera.matrixWorldInverse); F.setFromProjectionMatrix(M); return F; };
  const boxIn = (F, x0, y0, z0, x1, y1, z1) => F.intersectsBox(new N.THREE.Box3(new N.THREE.Vector3(x0, y0, z0), new N.THREE.Vector3(x1, y1, z1)));
  const enter705 = async () => {
    S.applyStage(9); quiet();
    N.ai.dormant = false;
    const b = SP.def('X705').back;
    await tp(7, b.x, b.z, b.yaw + Math.PI);
    return openAndEnter('705');
  };

  await T('705_1_pillars_grow_hide_exit', async () => {
    const lv = await enter705();
    const obj = N.hudState().objective;
    const s0 = st705();
    const visibleAtStart = !D705().exitHiddenWith(0, 30.3, ['base']);   // 最初の柱だけなら机の前から出口が見える
    const bad = []; let prev = D705().pillars();
    const fillBy = [];
    walkTo(...W705(0, 30.3), { max: 3000, each: () => {
      const now = D705().pillars(), F = frustum(), p = N.player.pos;
      now.forEach((q, i) => { if (q.on && !prev[i].on) {
        const inView = boxIn(F, 420 + q.u - 0.33, -60, q.v - 0.33, 420 + q.u + 0.33, -60 + 4.4, q.v + 0.33);
        const d = Math.hypot(420 + q.u - p.x, q.v - p.z);
        if (inView || d < 1.5) bad.push({ u: q.u, v: q.v, kind: q.kind, inView, d: +d.toFixed(2) });
        if (q.kind === 'fill') fillBy.push([+p.z.toFixed(1), q.v]);
      } });
      prev = now; return false;
    } });
    const s1 = st705();
    const at = pos();
    const hidden = D705().exitHidden(at.x - 420, at.z);
    // 振り返ると入口の扉は柱の列の向こう(画面の中央の線上に柱)
    const pass = lv === 'X705' && obj === '705号室へ' && s0.pillarsOn < 45 && visibleAtStart && s1.pillarsOn >= s0.pillarsOn + 20 && bad.length === 0 && hidden && !!s1.exitHiddenAt
      && fillBy.length >= 6 && fillBy.every(([pz, v]) => pz >= v - 6.01) && Math.abs(at.z - 30.3) < 0.2;
    return { pass, level: lv, objective: obj, pillarsStart: s0.pillarsOn, pillarsAtDesk: s1.pillarsOn, appearedInViewOrNear: bad, exitVisibleFromDeskAtStart: visibleAtStart,
      exitHiddenAtDesk: hidden, exitHiddenFirstAt: s1.exitHiddenAt, fillAppearedAt_playerZ_vs_pillarV: fillBy.slice(0, 8), at };
  });

  await T('705_2_key_lightsout_reverse_manager_chase_7F', async () => {
    if (N.level !== 'X705') return { pass: false, why: 'needs 705_1' };
    const t0 = N.ai.time;
    const D = SP.def('X705');
    const exBefore = SP.exits('X705').map((e) => +e.z.toFixed(2));
    const hint = pickNow('kB1');
    const st = S.state();
    const objChase = N.hudState().objective;
    N.pump(DT, 30, false);
    const s1 = st705();
    const exAfter = SP.exits('X705');
    const portal = N.ai.portals.find((p) => p.id === 'X705');
    N.pump(DT, 20, false);
    const appear = N.ai.events.find((e) => e.t > t0 && e.ev === 'appear_705');
    const ePos = { x: N.enemyObj.pos.x, z: N.enemyObj.pos.z, lv: N.ai.level };
    const atAmbush = appear && ePos.lv === 'X705' && Math.hypot(ePos.x - D.at('ambush').x, ePos.z - D.at('ambush').z) < 0.8;
    const fromNewExit = Math.abs(ePos.z - exAfter[0].z) < 4.5 && Math.abs(exBefore[0] - ePos.z) > 40;
    while (N.viewLock.active) N.pump(DT, 1, false);
    // 逃げる: 西の壁際を回って南の出口へ(柱の林の外側。追ってくる管理人とすれ違う)
    const path = [W705(-6, 29.5), W705(-13.7, 26), W705(-13.7, 46.0), W705(-0.0, 46.0), W705(0, 50.6)];
    let dead = false, minD = 1e9, maxWarp = 0, wi = 0, colsEq = null;
    const cols0 = D705().colsSnapshot();
    key('ShiftLeft', true); key('KeyW', true);
    for (let i = 0; i < 60 * 40 && N.level === 'X705' && wi < path.length; i++) {
      const p = N.player.pos, [x, z] = path[wi];
      if (Math.hypot(x - p.x, z - p.z) < 0.4) { wi++; continue; }
      face(x, z, 0); N.pump(DT, 1, false);
      if (N.ai.level === 'X705') minD = Math.min(minD, Math.hypot(N.enemyObj.pos.x - p.x, N.enemyObj.pos.z - p.z));
      const w = st705().warp; if (w > maxWarp) { maxWarp = w; if (w > 0.99 && colsEq === null) colsEq = D705().colsSnapshot() === cols0 || D705().colsSnapshot().length >= cols0.length; }
      if (N.ai.state === 'ATTACK' || N.deathState()) { dead = true; break; }
    }
    key('ShiftLeft', false); key('KeyW', false);
    waitTrans();
    const on7 = N.level === 7, back = pos();
    // 管理人も出口(出入り口)を通って 7F へ追ってくる
    let enemyOn7 = null;
    walkTo(16.0, 21.2, { max: 300, run: true });
    for (let i = 0; i < 60 * 8 && enemyOn7 === null; i++) { N.pump(DT, 1, false); if (N.ai.level === 7 && !N.ai.transit) enemyOn7 = +(N.ai.time - t0).toFixed(2); if (N.ai.state === 'ATTACK') { dead = true; break; } }
    const pass = hint.includes('拾う') && st.item === 'b1' && objChase === '逃げろ' && s1.on < 0.05 && s1.revealed && exAfter.length === 1 && exAfter[0].z > 49 && exBefore[0] < 1
      && portal && portal.a.z > 49 && !!appear && atAmbush && fromNewExit && !dead && maxWarp > 0.99 && on7 && Math.hypot(back.x - D.back.x, back.z - D.back.z) < 0.1 && enemyOn7 !== null && N.ai.state === 'CHASE';
    return { pass, pickHint: hint, item: st.item, objective: objChase, lightsOn: s1.on, revealed: s1.revealed, exitsBefore_z: exBefore, exitsAfter_z: exAfter.map((e) => +e.z.toFixed(2)), portalA: portal && portal.a,
      appear: appear || null, enemyAt: ePos, atAmbush, fromNewExit, dead, minDist: +minD.toFixed(2), maxWarp, colsUnchangedAtWarp1: colsEq, on7, back, enemyOn7_s: enemyOn7, aiState: N.ai.state };
  });

  await T('705_3_warp_visual_only_same_collision', async () => {
    const lv = await enter705();
    D705().showAll(); N.pump(DT, 2, false);
    const c0 = D705().colsSnapshot();
    // 柱 (−4, 15) に北から歩いて当たる: 歪み 0 と 1 で止まる所が同じ
    const bump = (w) => { D705().st.forceWarp = w; return (async () => { await tp('X705', ...W705(-4, 12.5), Math.PI); N.pump(DT, 10, false); walkTo(...W705(-4, 17), { max: 240 }); return +N.player.pos.z.toFixed(3); })(); };
    const z0 = await bump(0);
    const w0 = D705().st.U.uWarp.value;
    const z1 = await bump(1);
    const w1 = D705().st.U.uWarp.value;
    const c1 = D705().colsSnapshot();
    D705().st.forceWarp = null;
    const pass = lv === 'X705' && w0 === 0 && w1 === 1 && c0 === c1 && Math.abs(z0 - z1) < 1e-3 && z0 < 15 - 0.33;
    return { pass, level: lv, warp: [w0, w1], stoppedAt_z: [z0, z1], colsSame: c0 === c1, cols: c0.split(';').length };
  });

  // ================================================================ B1(P5b-2b)
  const WB1 = (u, v) => [520 + u, v];
  const DB1 = () => SP.debug('XB1');
  const stB1 = () => DB1().state();
  const enterB1 = async () => {
    S.applyStage(10); quiet();
    const B = N.building.basement;
    await tp('B1', B.spawn[0], B.spawn[1], Math.PI / 2);
    walkTo(8.5, 1.45, { max: 200 });
    const d = N.doorApi.get('B1DOOR');
    face(d.pos[0], d.pos[1], 0); N.pump(DT, 2, false);
    tap('KeyE'); N.pump(DT, 60, false);
    const n = FN[d.facing];
    walkTo(d.pos[0] + n[0] * 0.6, d.pos[1] + n[1] * 0.6, { max: 240, tol: 0.1 });
    waitTrans();
    return N.level;
  };
  // トンネルを v の向きへ歩き続ける(each が true で止める)
  const walkDir = (dir, sec, each = null) => {
    key('KeyW', true);
    let t = 0;
    for (; t < sec; t += DT) { const p = N.player.pos; face(p.x + (520 - p.x) * 0.2, p.z + dir * 5, 0); N.pump(DT, 1, false); if (each && each(t)) break; }
    key('KeyW', false); N.pump(DT, 2, false);
    return t;
  };

  // 迷路を升ごとに歩く: 今の迷路で道を引き直し、今の升の中心へ寄せてから隣の升の中心へ(升の角に引っかからない・フレーム時間に依らない)
  const mazeWalk = (toGoal, max = 160) => {
    const M = DB1().XB1.maze, cell = (u, v) => [Math.floor((u - M.u0) / M.cell), Math.floor((v - M.v0) / M.cell)];
    const center = (c, r) => [M.u0 + (c + 0.5) * M.cell, M.v0 + (r + 0.5) * M.cell];
    for (let k = 0; k < max; k++) {
      const p = N.player.pos, u = p.x - 520, v = p.z;
      const r = DB1().route(u, v, toGoal);
      if (!r) return false;
      const [c0, r0] = cell(u, v), [cu0, cv0] = center(Math.min(Math.max(c0, 0), M.nc - 1), Math.min(Math.max(r0, 0), M.nr - 1));
      if (v >= M.v0 && Math.hypot(u - cu0, v - cv0) > 0.3) walkTo(...WB1(cu0, cv0), { max: 300, tol: 0.15 });
      if (!r.length) return true;
      walkTo(...WB1(r[0][0], r[0][1]), { max: 300, tol: 0.15 });
    }
    return false;
  };

  await T('B1_1_loop_three_signs_then_stop_or_turn', async () => {
    const lv = await enterB1();
    const obj = N.hudState().objective;
    walkPath([WB1(-3.1, 5.9), WB1(-1.5, 6.0), WB1(0, 6.2)], { max: 600 });
    const doorClosedBehind = [];
    let maxZ = -1e9, armedAt = null;
    walkDir(1, 60, () => { maxZ = Math.max(maxZ, N.player.pos.z); if (stB1().armed && armedAt === null) armedAt = { t: stB1().teleports, z: +N.player.pos.z.toFixed(2) }; return stB1().armed; });
    const atNotice = stB1();
    // 気づいた後も歩き続けると環状のまま(抜けない)
    walkDir(1, 6, () => { maxZ = Math.max(maxZ, N.player.pos.z); return false; });
    const stillLooping = !stB1().released && stB1().teleports > atNotice.teleports;
    doorClosedBehind.push(stB1().door);
    // 立ち止まる → 抜ける
    N.pump(DT, 90, false);
    const rel = stB1();
    // 先へ: 標識灯を 4 回目に通って、継ぎ足しの終わり(迷路の前室)へ
    walkDir(1, 45, () => N.player.pos.z > 53);
    const reached = N.player.pos.z > 52;
    const afterWalk = { ...pos(), released: stB1().released };
    const relEv = rel.log.find((e) => e.ev === 'release');
    // 振り返る版: 入り直して 3 回通ってから後ろを向く
    const S2 = (SP.show(null), await enterB1(), walkPath([WB1(-3.1, 5.9), WB1(-1.5, 6.0), WB1(0, 6.2)], { max: 600 }), walkDir(1, 60, () => stB1().armed), stB1());
    walkDir(-1, 1.0, () => stB1().released);
    const rel2 = stB1();
    const relEv2 = rel2.log.find((e) => e.ev === 'release');
    const pass = lv === 'XB1' && obj === '地下へ' && atNotice.passes === 3 && atNotice.teleports >= 2 && maxZ < 18.01 && stillLooping && rel.released && relEv && relEv.why === 'still' && relEv.passes === 3
      && reached && S2.armed && rel2.released && relEv2 && relEv2.why === 'turn' && doorClosedBehind[0] < 0.05;
    return { pass, level: lv, objective: obj, atNotice: { passes: atNotice.passes, teleports: atNotice.teleports }, maxZBeforeRelease: +maxZ.toFixed(2), stillLooping, release: relEv, reachedMaze: reached,
      afterWalk, turnVariant: relEv2 || null, turnState: { passes: S2.passes, armed: S2.armed, level: N.level, log: rel2.log.slice(-6) }, sideDoorAngleBehind: doorClosedBehind[0] };
  });

  await T('B1_2_maze_changes_only_unseen_walls', async () => {
    if (N.level !== 'XB1' || !stB1().released) return { pass: false, why: 'needs B1_1' };
    walkDir(1, 25, () => N.player.pos.z > 53.2);
    let prev = DB1().edges().map((e) => e.on), viol = [], disc = 0, changes = 0, frames = 0;
    const step = () => {
      frames++;
      const now = DB1().edges(), F = frustum();
      now.forEach((e, i) => { if (e.on !== prev[i]) { changes++; const L = 1.0, t = 0.05;
        const inV = e.vert ? boxIn(F, 520 + e.u - t, -60, e.v - L, 520 + e.u + t, -60 + 2.05, e.v + L) : boxIn(F, 520 + e.u - L, -60, e.v - t, 520 + e.u + L, -60 + 2.05, e.v + t);
        if (inV) viol.push({ i, t: frames }); } });
      prev = now.map((e) => e.on);
      if (!DB1().connected()) disc++;
    };
    // 作業場まで: 升ごとに今の迷路で道を引き直して歩く。毎フレーム(歩きの合間の止まったフレームも)変わった壁を視錐台で調べる
    const pump0 = N.pump;
    N.pump = function (dt, n = 1, render = true) { for (let i = 0; i < n; i++) { pump0.call(N, dt, 1, false); step(); } if (render) N.render(); return null; };
    let ok = false;
    try {
      if (mazeWalk(true)) { walkPath([WB1(6, 75.5), WB1(6, 77.4)], { max: 300 }); ok = N.player.pos.z > 77; }
      // 見ていない間に入口の方の壁が変わっている(戻る道の見え方が変わる)。少し立ち止まって見回すと変わっていく
      for (let t = 0; t < 3; t += DT) { face(N.player.pos.x, N.player.pos.z + 5, 0); N.pump(DT, 1, false); }
    } finally { N.pump = pump0; }
    const s = stB1();
    const pass = ok && changes >= 5 && viol.length === 0 && disc === 0 && s.flips >= 5;
    return { pass, reachedWorkshop: ok, wallChanges: changes, flips: s.flips, changedInView: viol.slice(0, 5), disconnectedFrames: disc, frames };
  });

  await T('B1_3_key_return_longer_lights_off_exit_stage11', async () => {
    if (N.level !== 'XB1' || N.player.pos.z < 76.5) return { pass: false, why: 'needs B1_2' };
    const kp = S.pickups.find((q) => q.id === 'kCar');
    walkTo(kp.pos.x, kp.pos.z - 0.8, { max: 300 });
    const hint = pickNow('kCar');
    const st = S.state();
    const objKey = N.hudState().objective;
    // 戻る: 迷路の入口 → トンネル → 踊り場の扉(開かない)→ 2 周 → 扉が少し開く → 踊り場 → 鉄扉
    let lampSample = null, okRoute = true;
    okRoute = mazeWalk(false);
    walkTo(...WB1(0, 51.5), { max: 600 });
    walkTo(...WB1(0, 40), { max: 1500 });
    lampSample = DB1().lampsBehind().filter((l) => Math.abs(l.z - (N.player.pos.z)) < 14);
    walkTo(...WB1(-0.4, 6.2), { max: 3000 });
    face(...WB1(-1.2, 6.0), 0); N.pump(DT, 2, false);
    const lockedHint = N.hudState().hint; tap('KeyE'); N.pump(DT, 2, false);
    const lockedToast = N.hudState().toast;
    // 歩き続ける(−v)。扉が少し開くまで
    walkDir(-1, 60, () => stB1().retOpen);
    const s2 = stB1();
    // 開いた扉へ(次の周回の扉)
    walkDir(-1, 30, () => N.player.pos.z < 6.6 && N.player.pos.z > 5.8);
    walkPath([WB1(-0.5, 6.0), WB1(-1.6, 6.0), WB1(-3.1, 5.0), WB1(-3.1, 0.15)], { max: 900 });
    waitTrans();
    const out = { level: N.level, at: pos() };
    const s3 = stB1();
    await tp(1, 6.9, 7.0, 0);
    const obj11 = N.hudState().objective;
    const behindOff = lampSample.filter((l) => !l.ahead && l.z > N.player.pos.z);   // 参考
    const offBehind = lampSample.filter((l) => !l.ahead && l.off).length, onAhead = lampSample.filter((l) => l.ahead && !l.off).length, offAhead = lampSample.filter((l) => l.ahead && l.off).length;
    void behindOff;
    const pass = hint.includes('拾う') && st.stage === 11 && st.item === 'car' && objKey === '駐車場の車で逃げろ' && okRoute && lockedToast === '開かない' && s2.retLoops >= 2 && s2.retOpen
      && offBehind >= 1 && onAhead >= 1 && offAhead === 0 && s3.walkRet > s3.walkIn && out.level === 'B1' && obj11 === '駐車場の車で逃げろ';
    return { pass, pickHint: hint, stage: st.stage, item: st.item, objective: objKey, lockedHint, lockedToast, retLoops: s2.retLoops, doorAjar: s2.retOpen,
      lamps: { offBehind, onAhead, offAhead }, walkIn_m: s3.walkIn, walkRet_m: s3.walkRet, out, objective1F: obj11 };
  });

  // ================================================================ 第7段: 窓の内側から見下ろす管理人(P5b-2b)
  await T('W_7_window_watcher_inside', async () => {
    const WW = () => S.winWatcher;
    S.applyStage(7); quiet();
    await tp('G', 33.0, 5.5, Math.PI / 2);   // 駐車場・東(車の方)を向く
    N.pump(DT, 60, false);
    const autoOff = !WW().stats().visible;    // ?test では自動で出さない
    const forced = WW().force();
    N.pump(DT, 2, false);
    const root = WW().root;
    const head = new N.THREE.Vector3(root.position.x, root.position.y + 1.6, root.position.z);
    // 見上げる
    face(head.x, head.z, Math.atan2(head.y - N.camera.position.y, Math.hypot(head.x - N.camera.position.x, head.z - N.camera.position.z)));
    N.pump(DT, 30, false);
    const v = head.clone().project(N.camera);
    const onScreen = Math.abs(v.x) < 0.3 && Math.abs(v.y) < 0.3 && v.z < 1;
    const seen = WW().stats();
    // 遮る物: カメラ → 頭の線上の不透明なメッシュ(ガラス・格子・カーテンの発光面は除く)
    const ray = new N.THREE.Raycaster(N.camera.position.clone(), head.clone().sub(N.camera.position).normalize(), 0.1, head.distanceTo(N.camera.position) - 0.5);
    const objs = []; N.scene.traverseVisible((o) => { if (o.isMesh && !o.isSkinnedMesh && !o.isInstancedMesh && !(o.material && (o.material.transparent || o.material.isShaderMaterial))) objs.push(o); });
    const hits = ray.intersectObjects(objs, false).map((h) => ({ name: h.object.name, mat: h.object.material.name, d: +h.distance.toFixed(2) })).filter((h) => !/Glass|Window|Bars|Rail|Glow|Curtain/i.test(h.mat + h.name));
    const visibleNow = root.visible;
    // 見た後に視線を外すと消える
    face(40, 5.5, 0); N.pump(DT, 12, false);
    const hideLook = WW().events.filter((e) => e.ev === 'hide').pop();
    // もう一度出して、建物の方へ後ずさりで近づく(見ていない)と消える
    WW().done = false; await tp('G', 31.5, 10.5, Math.PI / 2); N.pump(DT, 5, false);
    const forced2 = WW().force(); N.pump(DT, 2, false);
    let goneAt = null;
    face(40, 10.5, 0); key('KeyS', true);
    for (let i = 0; i < 60 * 12 && goneAt === null; i++) { face(N.player.pos.x + 5, 10.5, 0); N.pump(DT, 1, false); if (!WW().stats().visible) goneAt = { x: +N.player.pos.x.toFixed(2), dist: +Math.hypot(N.player.pos.x - 13.756, N.player.pos.z - 10.52).toFixed(2) }; }
    key('KeyS', false); N.pump(DT, 2, false);
    const lastHide = WW().events.filter((e) => e.ev === 'hide').pop();
    // 第7段以外では出ない(第8段・第6段に駐車場で force しても出ない)
    S.applyStage(8); quiet(); await tp('G', 33.0, 5.5, Math.PI / 2); N.pump(DT, 10, false);
    const f8 = WW().force(); N.pump(DT, 2, false); const v8 = WW().stats().visible;
    S.applyStage(6); quiet(); await tp('G', 33.0, 5.5, Math.PI / 2); N.pump(DT, 10, false);
    const f6 = WW().force(); N.pump(DT, 2, false); const v6 = WW().stats().visible;
    const pass = autoOff && forced && visibleNow && onScreen && seen.active && seen.active.seenT > 0.2 && hits.length === 0 && hideLook && hideLook.why === 'looked_away' && forced2 && goneAt && lastHide && lastHide.why === 'near' && !f8 && !v8 && !f6 && !v6
      && Math.abs(root.position.x - 13.83) < 0.1 && Math.abs(root.position.y - 8.7) < 0.05;
    return { pass, autoOff, forced, at: { x: +root.position.x.toFixed(3), y: +root.position.y.toFixed(2), z: +root.position.z.toFixed(2) }, onScreen, ndc: [+v.x.toFixed(2), +v.y.toFixed(2)], seen: seen.active,
      blockers: hits.slice(0, 5), lookAwayHide: hideLook && hideLook.why, goneAt, hideWhy: lastHide && lastHide.why, stage8: { forced: f8, visible: v8 }, stage6: { forced: f6, visible: v6 } };
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
    // P5b-4: 312 の無限の自室(R1 の玄関・R4 の洋室・R5 の暗い部屋と懐中電灯と座る管理人・戻りの鏡像の部屋と立つ管理人)
    const d312 = async (i, tu, tz, yaw, pitch = 0, key105 = false) => {
      SP.show(null); await enter312();
      if (key105) { D312().jump(4, 4.42, 1.72); N.pump(DT, 20, false); pickNow('k105'); N.pump(DT, 30, false); }
      D312().jump(i, tu, tz, yaw); N.player.object.rotation.x = pitch; N.pump(DT, 30, false);
    };
    res.X312_R1_genkan = await measure(() => d312(0, 0.75, 1.45, -Math.PI / 2));
    res.X312_R4_living = await measure(() => d312(3, 3.3, 1.6, -Math.PI / 2 - 0.3, -0.12));
    res.X312_R5_dark_watcher = await measure(async () => { await d312(4, 3.9, 1.7, -Math.PI / 2); const e = N.enemyObj.pos; face(e.x, e.z, -0.15); N.setFlashlight(true); N.pump(DT, 40, false); });
    N.setFlashlight(false); N.pump(DT, 2, false);
    res.X312_B3_mirror_watcher = await measure(async () => { await d312(3, 5.1, 1.5, Math.PI / 2, 0, true); N.pump(DT, 30, false); const e = N.enemyObj.pos; face(e.x, e.z, -0.05); N.pump(DT, 5, false); });
    // P5b-2b: 705 の広間(入口・机の前で後ろを向く・消灯後の追跡と歪み)・B1(トンネル・迷路・作業場)
    const d705 = async (u, v, yaw, f) => { SP.show(null); await enter705(); if (f) f(); await tp('X705', ...W705(u, v), yaw); N.pump(DT, 20, false); };
    res.X705_entry = await measure(() => d705(0, 3.5, Math.PI));
    res.X705_desk_back = await measure(() => d705(0, 30.3, 0, () => D705().showAll()));
    res.X705_dark_chase_warp = await measure(async () => {
      await d705(0, 30.3, Math.PI, () => D705().showAll());
      pickNow('kB1'); N.pump(DT, 200, false);
      N.ai.setState('SCRIPTED', { force: true }); D705().st.forceWarp = 1; N.pump(DT, 5, false);   // 計る間に捕まらないよう管理人を止める(消灯・歪みはそのまま)
      const e = N.enemyObj.pos; face(e.x, e.z, 0);
    });
    D705().st.forceWarp = null;
    quiet(); S.applyStage(10);
    const dB1 = async (u, v, yaw, rel) => { SP.show(null); await enterB1(); if (rel) DB1().release('perf'); await tp('XB1', ...WB1(u, v), yaw); N.pump(DT, 20, false); };
    res.XB1_tunnel = await measure(() => dB1(0, -4, Math.PI));
    res.XB1_maze = await measure(() => dB1(0, 53.0, Math.PI, true));
    res.XB1_workshop = await measure(() => dB1(6, 77.2, Math.PI, true));
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
