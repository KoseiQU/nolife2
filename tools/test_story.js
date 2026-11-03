// test_story.js — P5b-1 動線の骨組み(DESIGN §3.8 H の 11 段)の決定的テスト(ブラウザ内)。http://127.0.0.1:8001/index.html?test=story で自動実行。
// rAF に依存せず window.__N2.pump(dt, n) で本物のループと同じ順に進める。キーは keydown/keyup をペアで送る。結果: window.__N2.testResult
//  0) ?stage=N の開始状態(段・持ち物・解放・フラグ・開始位置・管理人がいるか)を 1〜11 すべて
// 1a) P5b-1b 冒頭の見せ場: 410 から廊下へ出ると 4F の EV ホールに管理人(戸口から見える)→ EV で 2F へ(表示 2)→ 2F を歩いても遭遇しない・EV は空で来る
//  1) 第1段(P5b-1b 組み替え): 館内に管理人がいない・1F 食堂の卓のメモ→「221号室へ」・221 は鍵なしで入れる・洋室の入口までは何も起きず鍵も無い・
//     奥(u 3.5 = 洋室の入口)へ進むと奥の窓際のロッカーから管理人(ゆっくり開く → ゆっくり出る → 視点が出口へ → 操作が戻って grace の後に追跡 = 8.0〜8.7 秒)・
//     「逃げろ」→ 走って逃げ切れる(2.5m より近づかれない・OUT なし)→
//     「221号室へ戻れ」・机に小さな鍵 → 戻って拾うと第2段「管理室へ」(2 回目は出ない)
// 1c) P5b-1c 人の速さ: 操作が戻ってから 0.8 秒待って、歩き(Shift なし)で廊下へ出ても追いつかれない → 廊下を走って外階段で 1F へ逃げ切れる
// 1b) 221 から逃げる途中で死ぬ → 410 から・飛び出しの前(「221号室へ」・管理人は眠る・ロッカーは閉じる)、見せ場は繰り返さない、奥へ進むとまた出る
//  P6b-C(§3.10 #1): 章の順序 2 管理室(105 の鍵)→ 3 105 → 4 6F(220 の鍵)→ 5 220(312 の鍵)→ 6 312(正面玄関の鍵)
//  2) 第2段: キーボックス(小さな鍵で開く・105 の鍵だけ・鍵なしでは開かない)
//  3) 第3段: 105 → X105(目標「出口へ」)→ 出口の手前のメモ → 第4段 → 出口を抜けると 105 の前(中の長い廊下は test_spaces.js)
//  4) 第4段: 6F の罠 3 室で飛び出し・他の部屋では起きない・609 の机の 220 の鍵
//  5) 第5段: 220(鍵で開く)→ 荒れた部屋 → 312 の鍵
//  6) 第6段: 312(鍵のない扉は開かない→鍵で開く→少し開く→別空間 X312(無限の自室)→ R5 の机の正面玄関の鍵 → 312 の扉から 3F。中身は test_spaces.js)
//  7) 第7段: 正面玄関(鍵スイッチの前は外側の自動ドアが開かない→鍵で開く)→ 駐車場の車 3 台(2 台は鍵・黒い車のグローブボックスに南京錠の鍵)
//  8) 第8段: 410 の隔て板の南京錠(鍵なしでは越えられない→鍵で roofA)→ 屋上A の 705 の鍵
//  9) 第9段: 705 → X705(P5b-2b: 柱の広間。机まで歩く)→ 地下の鉄扉の鍵 → 灯りが消え、反対側(南)の出口から管理人 → 西の壁際を回って南の出口へ → 追跡(EV は反応しない・管理人は階段で追う経路)→ 7F へ戻ると管理人も出てくる → 1F で第10段
// 10) 第10段: 地下の鉄扉(鍵)→ XB1 → 車のキー(管理人は地下へ来ない。P5b-2b: ループ・迷路は test_spaces.js、ここでは抜けたことにして作業場へ)
// 11) 第11段: 敷地へ出ると管理人が玄関から敷地へ追ってくる → 黒い車まで走って間に合う → エンディング(運転席の視点 → 「脱出した」)
// 12) チェックポイント: 死亡 → 段の開始位置へ。段・持ち物・解放・壊れた扉が残る
// 13) 目標の文言が段ごとに変わり、章が変わる時だけ強調される(P6b: 3 秒)・持ち物の札
// 17) P6b #7: 221 の床のスマホ(入ると 3 秒以内に画面が明滅して鳴る・鳴る位置はスマホ 0.3m 以内・玄関から画面へ視線が通る・家具に埋まらない)
// 16) P6b #6・#8: 目標表示 1.6 倍・半透明の帯・強調 3 秒＋明滅 2 回・持ち物の札も拡大 / 右下の懐中電灯 ON/OFF(文字・色・切替の 1 秒・隠れ中は出さない)
// 15) P5b-1b → P5b-1c 登場演出: 予兆(扉が揺れる・閉じている間は中が見えない)→ 扉が 1.0〜1.6 秒かけて開く間は管理人が動かず中に見える(視点は管理人へ)→
//     目が合う → ゆっくり 2 歩で出てくる(見える・遅い)→ 視点が出口へ旋回して操作が戻る(扉の方 ±25°・向きの跳びなし・マウスが続く)→
//     grace(≥2.5 秒、221 が最長)の後に歩いて追い始める。ライト消灯なら中で自分の懐中電灯。221(点灯)と 606(消灯)。
//     611: 視点固定中〜grace に管理人の目の前に置いても・ATTACK を直接要求しても死なない。609: 同じロッカーがあるが開かない
// 19) P6b-C #3: 外階段・北階段の鉄扉の鎖(第3段〜第9段の追跡の前。開いていた扉も閉じる・管理人も開けない・追跡の開始で外れる)
// 20) P6b-C #3: 異空間(105・312)から出たら管理人は追跡を終え、出た階に 30 秒来ない(走る音でも)
// 21) P6b-C #5: 地下への階段の口の灯り(2 灯・影なし・札「地下」・1F の通路の端から見ると口が周囲より明るい)
// 14) P5b-1b フリーズの再現: 追跡中に外階段で 1F へ逃げても描画・視点・操作が戻る、段の途中で死んでも復帰後に歩ける、空振りでムービーが畳まれる

const DT = 1 / 60;
const CHAIN_IDS = ['MST1', 'MST2', 'MST3', 'MST4', 'MST5', 'MST6', 'MST7', 'NST2', 'NST3'];   // P6b-C: 鎖の扉(story.js の CHAIN_DOORS と同じ)
const BASEMENT_VIEW = { at: [6.5, 8.0], look: [7.55, 2.3, 1.45] };   // P6b-C: 1F の食堂から北の通路の突き当たり(地下の口)を見る

export async function run(N) {
  const out = { ok: true, cases: {} };
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:fixed;left:8px;top:8px;z-index:10;color:#9fe39f;background:rgba(0,0,0,.78);font:11px/1.35 monospace;padding:8px;max-width:46vw;max-height:94vh;overflow:auto;white-space:pre-wrap;';
  document.body.appendChild(pre);
  const show = () => { pre.textContent = JSON.stringify(out, null, 1); };
  const ONLY = new URLSearchParams(location.search).get('only');   // 開発用: ?only=1,14 で番号の一致するものだけ
  const T = async (name, fn) => {
    if (ONLY && !ONLY.split(',').includes(name.split('_')[0])) return;
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
      3: { item: '105', un: ['KEYBOX'] },          // P6b-C(§3.10 #1): 105 → 6F → 220 → 312
      4: { item: null, un: ['105'] },
      5: { item: '220', un: ['105'] },
      6: { item: '312', un: ['220'] },
      7: { item: 'entrance', un: ['312'] },
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
      const NEXT = { 1: 'KEYBOX', 2: 'KEYBOX', 3: '105', 4: '220', 5: '220', 6: '312', 7: 'KEYSWITCH', 8: 'PADLOCK', 9: '705', 10: 'B1DOOR' };   // この段ではまだ開いていない物
      const okNot = n === 11 || !st.unlocked.includes(NEXT[n]);
      const okFlags = (w.roofA === undefined || st.flags.roofA === w.roofA) && (w.ent === undefined || st.flags.entranceOut === w.ent) && st.flags.roofA === (n >= 9) && st.flags.entranceOut === (n >= 8);
      const okAI = w.dormant === undefined ? N.ai.dormant === (n === 1) : N.ai.dormant === w.dormant;
      const okPos = N.level === sp.level && Math.hypot(N.player.pos.x - sp.x, N.player.pos.z - sp.z) < 0.05;
      const okObj = N.hudState().objective === st.objective && !!st.objective;
      const okEV = st.evDisabled === (n >= 10);
      const chainWant = n >= 3 && n <= 9, mst = N.doorApi.get('MST2');   // P6b-C(§3.10 #3): 第3段〜第9段(追跡の前)は外階段・北階段の鎖
      const okChain = S.chained === chainWant && !!mst.chained === chainWant && !!N.doorApi.get('NST3').chained === chainWant;
      const ok = st.stage === n && okItem && okUn && okNot && okFlags && okAI && okPos && okObj && okEV && okChain;
      if (!ok) pass = false;
      res[n] = { ok, item: st.item, unlocked: st.unlocked, flags: st.flags, dormant: N.ai.dormant, level: N.level, objective: N.hudState().objective, evDisabled: st.evDisabled, chained: S.chained };
    }
    if (initial) { res.initialFromParam = { q: +q, ...initial }; if (initial.stage !== +q) pass = false; }
    return { pass, res };
  });

  // ---------------------------------------------------------------- 1a) 冒頭の見せ場(P5b-1b 差し戻し 2): 4F の EV の管理人 → 2F へ → 2F を歩いても遭遇しない
  await T('1a_intro_ev_manager_to_2F', async () => {
    S.applyStage(1); await settle(4);
    N.setFlashlight(false);
    const dormant0 = N.ai.dormant && !N.enemyObj.root.visible;
    await tp(4, 8.75, 7.3, Math.PI / 2);   // 410 の玄関(扉を向く)
    const d410 = door('410');
    tap('KeyE'); N.pump(DT, 50, false);
    const notYet = !S.introDone;            // 扉を開けただけでは起きない(廊下へ出た時)
    key('KeyW', true); let f = 0; for (; f < 90 && !S.introDone; f++) N.pump(DT, 1, false); key('KeyW', false);
    const atTrigger = pos();
    N.pump(DT, 2, false);
    // 戸口から EV ホールの方(南)を見る: 管理人が 4F の EV ホールにいて、視野の中・壁に遮られない
    const I = N.ai.cfg.intro;
    const lookAt = (x, z, y = 1.4) => { const c = N.camera.position; const dx = x - c.x, dz = z - c.z; N.player.object.rotation.set(Math.atan2(levelY4(y) - c.y, Math.hypot(dx, dz)), Math.atan2(-dx, -dz), 0, 'YXZ'); N.player.object.updateMatrixWorld(); };
    const levelY4 = (y) => 3 * 2.9 + y;
    const seen = [];
    const visible = () => {
      const e = N.enemyObj; if (!e.root.visible || N.ai.level !== N.level) return false;
      lookAt(e.pos.x, e.pos.z); N.camera.updateMatrixWorld();
      const head = e.headWorld(new N.THREE.Vector3());
      const cam = N.camera.position.clone(), dir = head.clone().sub(cam); const dist = dir.length(); dir.normalize();
      const rc = new N.THREE.Raycaster(cam, dir, 0.05, dist - 0.3);
      const hits = rc.intersectObject(N.world.floors.get(4).group, true).filter((h) => h.object.visible);
      const fr = new N.THREE.Frustum().setFromProjectionMatrix(new N.THREE.Matrix4().multiplyMatrices(N.camera.projectionMatrix, N.camera.matrixWorldInverse));
      return hits.length === 0 && fr.containsPoint(head);
    };
    const t0 = N.ai.time;
    let standVisible = 0, inCarSeen = false, doorOpenSeen = false, aiStates = new Set(), rideAt = null, dormantAt = null, attacked = false;
    for (let i = 0; i < 60 * 30; i++) {
      N.pump(DT, 1, false);
      aiStates.add(N.ai.state);
      if (['CHASE', 'ATTACK', 'ALERT'].includes(N.ai.state)) attacked = true;
      if (i % 6 === 0 && N.ai.state === 'INTRO' && !N.ai.transit) { const v = visible(); if (v && N.ai.time - t0 < I.stand) standVisible++; if (v && N.elevator.car.open > 0.9) doorOpenSeen = true; if (v && N.elevator.car.open > 0.9 && N.enemyObj.pos.z > 21.6) inCarSeen = true; }   // inCarSeen = カゴへ歩いて入るところ(戸口の手前)
      if (rideAt === null && N.ai.events.some((e) => e.ev === 'intro_ride' && e.t >= t0)) rideAt = +(N.ai.time - t0).toFixed(2);
      if (dormantAt === null && N.ai.dormant) { dormantAt = +(N.ai.time - t0).toFixed(2); }
      if (dormantAt !== null && N.elevator.car.state !== 'moving' && N.elevator.car.level === 2 && i > 60 * 2) break;
    }
    N.pump(DT, 60 * 3, false);
    const car = N.elevator.state(), shown = N.elevator.shown.floor, shownLog = N.elevator.shownLog.slice(-6).map((q) => q.floor);
    const end = N.ai.events.find((e) => e.ev === 'intro_end' && e.t >= t0);
    // 2F の廊下を端から端まで歩いても遭遇しない(管理人は 2F で待機の体 = 眠っている)
    await tp(2, 6.9, 20.0, Math.PI);
    const walked2F = walkPath([[6.9, 21.2], [14.0, 21.2], [22.5, 21.2], [14.0, 21.2], [6.9, 21.2], [6.9, 12.0], [6.9, 4.0]]);
    const met = N.enemyObj.root.visible || !N.ai.dormant || ['CHASE', 'ATTACK'].includes(N.ai.state);
    // 呼べば EV は普通に来る(中に管理人はいない・賭けもない)
    N.setView(6.9, 21.2, Math.PI, 0); N.pump(DT, 2, false);
    const n0 = N.ai.events.length;
    tap('KeyE');
    for (let i = 0; i < 60 * 12 && !(N.elevator.car.level === 2 && N.elevator.car.open >= 1); i++) N.pump(DT, 1, false);
    const evCame = N.elevator.car.level === 2 && N.elevator.car.open >= 1, emptyCar = !N.enemyObj.root.visible && N.ai.dormant && !N.ai.events.slice(n0).some((e) => e.ev === 'ev_ambush');
    // 一度だけ: 2 回目に廊下へ出ても起きない
    const again = (() => { S.introDone = true; return !N.ai.events.slice(n0).some((e) => e.ev === 'intro_start'); })();
    const pass = dormant0 && notYet && S.introDone && standVisible >= 3 && doorOpenSeen && inCarSeen && !attacked && rideAt !== null && dormantAt !== null
      && end && end.why === 'arrived' && N.ai.level === 2 && car.level === 2 && shown === 2 && shownLog.includes(3) && walked2F && !met && evCame && emptyCar && again && S.stage === 1;
    quiet();
    return { pass, dormant0, notYet, atTrigger, standVisibleSamples: standVisible, doorOpenSeen, inCarSeen, attacked, aiStates: [...aiStates], rideAt, dormantAt, end: end || null,
      aiLevel: N.ai.level, car, shown, shownLog, walked2F, met, evCame, emptyCar };
  });

  // ---------------------------------------------------------------- 1) 第1段・221(P5b-1b 組み替え): 奥へ進む → 奥の窓際のロッカーから管理人 → 逃げ切る → 戻ると机に小さな鍵
  // 221 の中の点: 玄関の壁(扉の面)からの奥行 u(部屋の外は -1)
  const roomU = (id, x, z) => { const r = room(id).r; const [rx, rz, rw, rd] = r.rect; if (!(x > rx && x < rx + rw && z > rz && z < rz + rd)) return -1; const n = FN[r.door.facing]; return -((x - r.door.pos[0]) * n[0] + (z - r.door.pos[1]) * n[1]); };
  const run221 = async (opts = {}) => {
    const r = room('221').r, pts = r.interior.points, BL = r.interior.burst;
    if (!opts.keepGate) S.runGateShown = !opts.gate;   // P6b-A2: 走り確認(18 番)は opts.gate の時だけ。他のケースは 2 回目以降の扱い(従来の流れ)
    await tp(2, ...front('221', 0.9), 0);
    face(r.door.pos[0], r.door.pos[1], 0); N.pump(DT, 2, false);
    const doorHint = N.hudState().hint;
    if (door('221').angle < 0.5) { tap('KeyE'); N.pump(DT, 60, false); }
    const opened = door('221').angle > 0.5;
    // 玄関の先(u 2.7)まで: まだ何も起きない・鍵は無い
    const walkedRoom = walkPath([[r.door.pos[0], r.door.pos[1] - 0.6], pts.entry, pts.room]);
    N.pump(DT, 4, false);
    const before = { burst: S.burst221, keyVisible: pk('small').mesh.visible, keyPickable: S._pickable(pk('small')), dormant: N.ai.dormant, sub: S.sub };
    // 奥(洋室の真ん中 u 4.4)へ進む → u 3.5 を越えた所で飛び出しが始まる
    const t0 = N.ai.time, n0 = S.logCount;
    key('KeyW', true);
    let uAt = null;
    for (let i = 0; i < 300 && !S.burst221; i++) { face(pts.living[0], pts.living[1], 0); N.pump(DT, 1, false); }
    key('KeyW', false); N.pump(DT, 1, false);
    uAt = +roomU('221', N.player.pos.x, N.player.pos.z).toFixed(2);
    N.setFlashlight(!!opts.light);
    N.pump(DT, 4, false);
    const ev = N.ai.events.find((e) => e.t >= t0 && e.ev === 'locker_burst');
    const objFlee = N.hudState().objective;
    return { r, pts, BL, doorHint, opened, walkedRoom, before, uAt, ev, objFlee, t0, n0 };
  };
  const flee221 = (r, pts, t0) => {
    // 視点固定が解けたら玄関 → 廊下 → EV ホール → 北の端へ走る
    let t = 0, chaseAt = null, minD = 1e9, dead = false;
    // 視点固定が始まるまで → 解けるまで(解けた瞬間から走る。P5b-1c: 管理人は操作が戻ってから grace 秒立ち止まり、歩きから追ってくる)
    while (!N.viewLock.active && N.ai.state === 'APPEAR' && t < 3) { N.pump(DT, 1, false); t += DT; }
    while (N.viewLock.active && t < 8) { N.pump(DT, 1, false); t += DT; }
    const exit = [[pts.room[0], pts.room[1]], [pts.entry[0], pts.entry[1]], [r.door.pos[0], r.door.pos[1] + 0.9], [8.5, 21.2], [6.9, 21.2], [6.9, 12.0], [6.9, 2.0]];
    key('ShiftLeft', true); key('KeyW', true);
    let wi = 0, escapedAt = null;
    for (let i = 0; i < 60 * 16 && wi < exit.length; i++) {
      const p = N.player.pos, [x, z] = exit[wi];
      if (Math.hypot(x - p.x, z - p.z) < 0.3) { wi++; continue; }
      face(x, z, 0);
      N.pump(DT, 1, false); t += DT;
      if (chaseAt === null && N.ai.state === 'CHASE') chaseAt = +(N.ai.time - t0).toFixed(2);
      if (N.ai.state === 'CHASE' && N.ai.level === N.level) minD = Math.min(minD, Math.hypot(N.enemyObj.pos.x - p.x, N.enemyObj.pos.z - p.z));
      if (N.deathState() || N.ai.state === 'ATTACK') { dead = true; break; }
    }
    key('ShiftLeft', false); key('KeyW', false);
    // 逃げ切るまで(見失う)北の端で待つ
    for (let i = 0; i < 60 * 12 && S.sub === 'flee' && !dead; i++) { N.pump(DT, 1, false); if (N.deathState() || N.ai.state === 'ATTACK') dead = true; }
    escapedAt = S.sub === 'return' ? +(N.ai.time - t0).toFixed(2) : null;
    return { chaseAt, minD: +minD.toFixed(2), dead, reached: wi, escapedAt };
  };
  await T('1_wake_memo_221_back_burst_escape_return_key', async () => {
    S.applyStage(1); await settle(4);
    N.setFlashlight(true);
    const noEnemy = N.ai.dormant && !N.enemyObj.root.visible;
    const obj0 = N.hudState().objective;
    await tp(1, 4.15, 9.4, 0);   // 1F 食堂(メモの卓の南。北を向く)
    const memoHint = pickAt(pk('memo221'));
    N.pump(DT, 2, false);
    const obj1 = N.hudState().objective, em1 = N.hudState().objectiveEm, toast = N.hudState().toast;
    const evOK = !S.evDisabled;
    S.introDone = true;   // (冒頭の見せ場は 1a 番)
    const A = await run221({ light: false });
    const B = flee221(A.r, A.pts, A.t0);
    const objReturn = N.hudState().objective;
    const keyShown = { visible: pk('small').mesh.visible || S._visible(pk('small'), 2), pickable: S._pickable(pk('small')) };
    // 戻る: 221 の机の前で小さな鍵を拾う → 第2段「管理室へ」。2 回目は飛び出さない
    const nb0 = N.ai.events.filter((e) => e.ev === 'locker_burst').length;
    N.ai.reset(N.ENEMY_HOME.x, N.ENEMY_HOME.z, N.ENEMY_HOME.yaw, 5); N.ai.setState('SCRIPTED', { force: true });   // 戻る間は管理人を 5F に(徘徊の偶然を除く)
    await tp(2, ...front('221', 0.9), 0);
    const walkedBack = walkPath([[A.r.door.pos[0], A.r.door.pos[1] - 0.6], A.pts.entry, A.pts.room, A.pts.deskFront]);
    N.pump(DT, 30, false);
    const noSecond = N.ai.events.filter((e) => e.ev === 'locker_burst').length === nb0;
    const keyHint = pickAt(pk('small'));
    const st = S.state();
    const objStage2 = N.hudState().objective;
    const pass = noEnemy && obj0 === '1階の食堂へ' && memoHint.includes('拾う') && obj1 === '221号室へ' && em1 && toast.includes('221') && evOK
      && A.doorHint.includes('開ける') && A.opened && A.walkedRoom && !A.before.burst && !A.before.keyVisible && !A.before.keyPickable && A.before.dormant
      && A.uAt >= 3.5 && A.uAt < 3.8 && !!A.ev && A.ev.lv === 2 && A.ev.room === '221' && Math.hypot(A.ev.x - A.BL.feet[0], A.ev.z - A.BL.feet[1]) < 0.05 && A.objFlee === '逃げろ'
      && B.chaseAt !== null && B.chaseAt >= 8.0 && B.chaseAt <= 8.7 && B.minD > 2.5 && !B.dead && B.reached >= 6 && B.escapedAt !== null && objReturn === '221号室へ戻れ'
      && keyShown.visible && keyShown.pickable && walkedBack && noSecond && keyHint.includes('拾う') && st.stage === 2 && st.item === 'small' && objStage2 === '1階の管理室へ';
    quiet();
    return { pass, noEnemy, obj0, memoHint, obj1, objEmphasized: em1, toast, doorHint: A.doorHint, opened: A.opened, beforeBack: A.before, burstAtU: A.uAt, burst: A.ev || null,
      objFlee: A.objFlee, chaseStart_s: B.chaseAt, minDistDuringChase: B.minD, dead: B.dead, reached: B.reached, escapedAfter_s: B.escapedAt, objReturn, keyShown, walkedBack, noSecond, keyHint,
      stage: st.stage, item: st.item, objStage2 };
  });

  // ---------------------------------------------------------------- 1b) 221 から逃げる途中で死ぬ → 第1段の開始位置(410)から・飛び出しの前に戻る(見せ場は繰り返さない)
  await T('1b_221_death_before_escape_rearms', async () => {
    S.applyStage(1); await settle(4);
    S.sub = null; S.introDone = true;
    const A = await run221({ light: true });
    for (let i = 0; i < 60 * 4 && N.ai.state === 'APPEAR'; i++) N.pump(DT, 1, false);
    const fleeing = S.sub === 'flee';
    N.ai.onKill();   // 追いつかれた(ヒット)
    let respawned = false;
    for (let i = 0; i < 60 * 8; i++) { N.pump(DT, 1, false); if (N.deathState() && N.deathState().respawned) respawned = true; if (respawned && !N.deathState()) break; }
    N.pump(DT, 10, false);
    const sp = { ...pos() }, st = S.state();
    const lockerClosed = N.rooms.bursts.get('221').open01 === 0;
    const atStart = sp.level === 4 && Math.hypot(sp.x - 8.75, sp.z - 7.3) < 0.05;
    const nIntro0 = N.ai.events.filter((e) => e.ev === 'intro_start').length;
    // 410 から廊下へ出ても見せ場は起きない
    N.setView(8.75, 7.3, Math.PI / 2, 0); tap('KeyE'); N.pump(DT, 50, false);
    walkTo(7.2, 7.3, 200, 0.15);
    N.pump(DT, 30, false);
    const noIntro = N.ai.events.filter((e) => e.ev === 'intro_start').length === nIntro0 && N.ai.dormant;
    // 221 の奥へ進むとまた出る
    const B = await run221({ light: true });
    const again = !!B.ev && S.sub === 'flee';
    const pass = !!A.ev && fleeing && respawned && atStart && st.stage === 1 && st.sub === null && st.objective === '221号室へ' && lockerClosed && noIntro && again
      && !S._visible(pk('small'), 2);
    quiet();
    return { pass, firstBurst: !!A.ev, fleeing, respawned, respawn: sp, stage: st.stage, sub: st.sub, objective: st.objective, lockerClosed, noIntro, burstAgain: again };
  });

  // ---------------------------------------------------------------- 1c) P5b-1c 人の速さ: 操作が戻ってから 0.8 秒待って W、Shift なし(歩き)で玄関 → 廊下へ。廊下に出て 3m 歩いてから走る → 外階段で 1F へ逃げ切れる
  await T('1c_221_escape_slow_human', async () => {
    S.applyStage(1); await settle(4);
    S.sub = null; S.introDone = true; N.ai.setDormant(true);
    const A = await run221({ light: true });
    const r = A.r, pts = A.pts, t0 = A.t0;
    let t = 0, minD = 1e9, dead = false, attacked = false, ctrlAt = null, firstStepAt = null, walkMinD = 1e9, fr = 0, stairMinD = 1e9;
    const trace = [];
    const watch = () => {
      const p = N.player.pos, e = N.enemyObj.pos;
      if (++fr % 15 === 0) trace.push([+(N.ai.time - t0).toFixed(2), +p.x.toFixed(2), +p.z.toFixed(2), +e.x.toFixed(2), +e.z.toFixed(2), N.ai.state, +Math.hypot(e.x - p.x, e.z - p.z).toFixed(2)]);
      // 襲える間合い(同じ階の床の上)での最短距離。外階段の段の上では高さの差で襲えない(P5b-1b の levelGap)ので別に記録
      if (N.ai.level === N.level && N.enemyObj.root.visible) { const d = Math.hypot(e.x - p.x, e.z - p.z); if (N.stairs.active) stairMinD = Math.min(stairMinD, d); else minD = Math.min(minD, d); }
      if (firstStepAt === null && ctrlAt !== null && (N.ai.state !== 'APPEAR' || !N.ai.revealPhase)) firstStepAt = +(N.ai.time - t0).toFixed(2);
      if (N.ai.state === 'ATTACK') attacked = true;
      if (N.deathState()) dead = true;
    };
    while (!N.viewLock.active && N.ai.state === 'APPEAR' && t < 3) { N.pump(DT, 1, false); t += DT; }
    while (N.viewLock.active && t < 10) { N.pump(DT, 1, false); t += DT; watch(); }
    ctrlAt = +(N.ai.time - t0).toFixed(2);
    // 操作が戻った向きのまま 0.8 秒(人が状況を飲み込む間)
    for (let i = 0; i < 48; i++) { N.pump(DT, 1, false); watch(); }
    // 歩き(Shift なし)で玄関 → 戸口 → 廊下へ出て西へ 3m
    const d = r.door.pos, n = FN[r.door.facing];
    const walkPts = [[pts.room[0], pts.room[1]], [pts.entry[0], pts.entry[1]], [d[0] - n[0] * 0.3, d[1] - n[1] * 0.3], [d[0] + n[0] * 0.9, d[1] + n[1] * 0.9], [d[0] - 3.0, d[1] + n[1] * 0.9]];
    const go = (list, run, lim) => {
      key('KeyW', true); if (run) key('ShiftLeft', true);
      let wi = 0;
      for (let i = 0; i < 60 * lim && wi < list.length && !dead && !attacked; i++) {
        const p = N.player.pos, [x, z] = list[wi];
        if (Math.hypot(x - p.x, z - p.z) < 0.3) { wi++; continue; }
        face(x, z, 0);
        N.pump(DT, 1, false); watch();
        if (!run) walkMinD = Math.min(walkMinD, minD);
      }
      key('KeyW', false); if (run) key('ShiftLeft', false); N.pump(DT, 1, false);
      return wi;
    };
    const walked = go(walkPts, false, 20);
    const walkedAt = +(N.ai.time - t0).toFixed(2);
    const inCorridor = roomU('221', N.player.pos.x, N.player.pos.z) < 0;
    // 廊下を走って EV ホール → 外階段の鉄扉(MST2)→ 下りの段で 1F へ(実機でユーザーが逃げた道。階を変えたら逃げ切り)
    const ran = go([[8.5, 21.2], [7.2, 21.2]], true, 20);
    N.setView(6.5, 21.2, Math.PI / 2, 0); N.pump(DT, 2, false); watch();
    tap('KeyE'); N.pump(DT, 16, false); watch();
    const st = N.building.stairs.find((q) => q.id === 'main'), g = st.geom, lane = (g.lanes.down[0] + g.lanes.down[1]) / 2;
    go([[5.6, 21.2]], true, 5);
    key('KeyW', true); key('ShiftLeft', true);
    for (let i = 0; i < 60 * 14 && N.level === 2 && !dead && !attacked; i++) { if (!N.stairs.active) face(lane, g.s0 + 0.5, 0); N.pump(DT, 1, false); watch(); }
    key('KeyW', false); key('ShiftLeft', false);
    for (let i = 0; i < 60 * 4 && S.sub === 'flee' && !dead && !attacked; i++) { N.pump(DT, 1, false); watch(); }
    const escapedAt = S.sub === 'return' ? +(N.ai.time - t0).toFixed(2) : null;
    N.openDoor('MST2', false); N.pump(DT, 60, false);   // 外階段の鉄扉を閉めておく(14 番は閉じた扉を開けるところから)
    const pass = !!A.ev && walked === walkPts.length && inCorridor && ran === 2 && N.level === 1 && !dead && !attacked && walkMinD > 1.6 && minD > 1.4 && escapedAt !== null
      && firstStepAt !== null && firstStepAt - ctrlAt >= 2.5 && N.hudState().objective === '221号室へ戻れ';
    quiet();
    return { pass, burst: !!A.ev, control_s: ctrlAt, enemyFirstStep_s: firstStepAt, walkedOut: `${walked}/${walkPts.length}`, inCorridorAt_s: walkedAt, inCorridor, ran: `${ran}/2`, level: N.level,
      minDistWhileWalking: +walkMinD.toFixed(2), minDist: +minD.toFixed(2), minDistOnStairs: +stairMinD.toFixed(2), dead, attacked, escapedAt_s: escapedAt, objective: N.hudState().objective, trace: pass ? undefined : trace };
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
    const pickHint = pickAt(pk('k105'));   // P6b-C(§3.10 #1): キーボックスには 105 の鍵だけ
    const st = S.state();
    const pass = hintNoKey.includes('調べる') && toastNoKey.includes('錠') && stillLocked && hintKey.includes('鍵を使う') && open
      && ['105', '220', '312', '705', 'B1', '玄関', '車'].every((k) => hooks.includes(k)) && hooks.length >= 9 && onlyKey.join() === 'k105'
      && pickHint.includes('拾う') && st.stage === 3 && st.item === '105' && N.hudState().objective === '105号室へ' && S.chained;
    return { pass, hintNoKey, toastNoKey, stillLocked, hintKey, open, hooks, keysOnFloor1: onlyKey, pickHint, stage: st.stage, item: st.item, events: evs(n0) };
  });

  // ---------------------------------------------------------------- 3) 105 → X105 → (出口の手前の)メモ → 出口 → 105 の前(P6b-C §3.10 #1: 第3段)
  //  P5b-2a: X105 は長い廊下(tools/test_spaces.js が中身を見る)。ここでは鍵・目標・メモ・出口の流れだけ: 中の段取りは飛ばして出口の手前へ移す
  await T('3_105_space_memo', async () => {
    S.applyStage(3); quiet();
    await tp(1, ...front('105', 0.9), -Math.PI / 2);
    S.item = null;
    const noKey = tryLocked('105');
    S.item = '105';
    const ent = openAndEnter('105');
    const objIn = N.hudState().objective;
    const dbg = N.spaces.debug('X105');
    dbg.skip('loopDone');
    await N.teleport('X105', 303.3, 164.5, Math.PI); N.pump(DT, 10, false);
    const memoHint = pickAt(pk('memo6F'));
    const toast = N.hudState().toast;
    const st = S.state();
    walkTo(303.3, 165.97, 400, 0.1);   // 出口の扉の面(166)の手前 0.12m を越えると出る(歩き続けないよう面の直前で止める)
    waitTrans();
    const b = N.spaces.def('X105').back;
    const back = pos();
    const pass = noKey.toast === '鍵がかかっている' && !noKey.unlocked && ent.level === 'X105' && objIn === '出口へ' && memoHint.includes('拾う') && toast.includes('6 階')
      && st.stage === 4 && st.item === null && N.hudState().objective === '6階の部屋から鍵を探せ' && back.level === 1 && Math.hypot(back.x - b.x, back.z - b.z) < 0.1;
    return { pass, noKey, enter: ent, objectiveInside: objIn, memoHint, toast, stage: st.stage, back };
  });

  // ---------------------------------------------------------------- 4) 6F: 罠 3 室・罠でない部屋・609 の 220 の鍵(P6b-C: 第4段)
  await T('4_6F_traps_and_key220', async () => {
    S.applyStage(4);
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
      const nearCloset = !want || (at && at.lv === 6 && at.room === id && r.interior.burst && Math.hypot(at.x - r.interior.burst.feet[0], at.z - r.interior.burst.feet[1]) < 0.05);   // P5b-1b: 奥の窓際のロッカー
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
    const ok609 = walked && hint.includes('拾う') && !evs(n0).includes('trap') && st.stage === 5 && st.item === '220' && N.hudState().objective === '220号室へ';
    if (!ok609) pass = false;
    if (S.traps.size !== 3) pass = false;
    return { pass, allEnterable, rooms: res, room609: { ok: ok609, walked, hint, stage: st.stage, item: st.item }, trapsFired: [...S.traps] };
  });

  // ---------------------------------------------------------------- 5) 220 → 荒れた部屋 → 312 の鍵(P6b-C: 第5段)
  await T('5_220_wrecked_key312', async () => {
    S.applyStage(5); quiet();
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
    const pickHint = pickAt(pk('k312'));
    const st = S.state();
    const pass = noKey.toast === '鍵がかかっている' && noKey.angle < 0.01 && hint.includes('鍵を使う') && opened && !d.storyLock && walked && wrecked
      && pickHint.includes('拾う') && st.stage === 6 && st.item === '312' && N.hudState().objective === '312号室へ';
    return { pass, noKey, hint, opened, walked, wrecked, pickHint, stage: st.stage, item: st.item };
  });

  // ---------------------------------------------------------------- 6) 312 → X312(無限の自室)→ R5 の机の正面玄関の鍵 → 312 の扉から 3F(P6b-C: 第6段)
  await T('6_312_space_entrance_key', async () => {
    S.applyStage(6); quiet();
    await tp(3, ...front('312', 0.9), -Math.PI / 2);
    S.item = null;
    const noKey = tryLocked('312');
    S.item = '312';
    // P5b-4: 戸口を越えたら止まる(X312 の入口の扉は真後ろ = 歩き続けると 312 の扉からすぐ出てしまう)
    const ent = (() => {
      const d = door('312');
      face(d.pos[0], d.pos[1], 0); N.pump(DT, 2, false);
      const hint = N.hudState().hint, n0 = S.logCount;
      tap('KeyE'); N.pump(DT, 60, false);
      const angle = +d.angle.toFixed(2);
      key('KeyW', true);
      for (let i = 0; i < 240 && !S.trans && N.level === 3; i++) { face(d.pos[0] + 0.6, d.pos[1], 0); N.pump(DT, 1, false); }
      key('KeyW', false); waitTrans();
      return { hint, angle, events: evs(n0), level: N.level };
    })();
    const inSpace = N.level === 'X312';
    // P5b-4: X312 は無限の自室(中身は tools/test_spaces.js)。窓の扉を開けて R5 まで歩き、机の 105 の鍵 → 戻りの最後の部屋(B7)へ移して 312 の扉から出る
    const SPX = N.spaces, D = SPX.debug('X312');
    for (let i = 0; i < 200 && !D.ready(); i++) await new Promise((r) => setTimeout(r, 50));
    const Wr = (i, tu, tz) => { const p = D.world(D.roomAt(i), tu, tz); return [p.x, p.z]; };
    const trace = [];
    for (let i = 0; i < 4; i++) {
      walkTo(...Wr(i, 5.15, 1.45), 900, 0.12);
      face(...Wr(i, 6, 1.45), 0); N.pump(DT, 2, false); tap('KeyE'); N.pump(DT, 50, false);
      walkTo(...Wr(i, 6.9, 1.45), 900, 0.12); N.pump(DT, 30, false);
      trace.push(D.state().room.id);
    }
    walkTo(...Wr(4, 4.42, 1.72), 900, 0.12);
    const pickHint = pickAt(pk('kEntrance'));
    const st = S.state();
    N.pump(DT, 30, false);
    D.jump(7, 1.2, 1.45); N.pump(DT, 20, false);
    trace.push(D.state().room.id);
    key('KeyW', true);
    for (let i = 0; i < 300 && !S.trans && N.level === 'X312'; i++) { face(...Wr(7, -0.5, 1.45), 0); N.pump(DT, 1, false); }   // 戸口の手前 0.45m を越えると出る
    key('KeyW', false); waitTrans();
    const back = pos();
    const pass = noKey.toast === '鍵がかかっている' && noKey.angle < 0.01 && !noKey.unlocked && ent.hint.includes('鍵を使う') && ent.angle >= 0.45
      && ent.events.includes('unlock_door') && ent.events.includes('enter_space') && inSpace && trace.join() === 'R2,R3,R4,R5,B7' && pickHint.includes('拾う') && st.stage === 7 && st.item === 'entrance'
      && back.level === 3 && Math.hypot(back.x - front('312', 0.9)[0], back.z - front('312', 0.9)[1]) < 0.1;
    return { pass, noKey, enter: ent, inSpace, pickHint, stage: st.stage, item: st.item, back, trace };
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
    const D = { ...N.spaces.def('X705'), x0: N.spaces.def('X705').origin[0] };
    const deskP = pk('kB1').pos;
    walkTo(deskP.x, deskP.z - 0.95, 3000);   // P5b-2b: 入口から広間の中央の机の前まで
    const t0 = N.ai.time;
    const pickHint = pickAt(pk('kB1'));
    const objChase = (N.pump(DT, 2, false), N.hudState().objective);
    const evDis = S.evDisabled && N.ai.noEV && N.ai.allowStairs;
    N.pump(DT, 40, false);
    const appear = N.ai.events.find((e) => e.t > t0 && e.ev === 'appear_705');
    const ePos = { x: N.enemyObj.pos.x, z: N.enemyObj.pos.z, lv: N.ai.level };
    const behind = appear && ePos.lv === 'X705' && Math.hypot(ePos.x - D.at('ambush').x, ePos.z - D.at('ambush').z) < 0.6;
    // 逃げる: P5b-2b 反転で出口は南の壁(管理人が現れた側)。西の壁際を回って南の出口へ走ると 7F の廊下へ(自動で戻る)
    while (N.viewLock.active) N.pump(DT, 1, false);
    let dead = false;
    const ex = N.spaces.exits('X705')[0];
    const path = [[D.x0 - 6, 29.5], [D.x0 - 13.7, 26], [D.x0 - 13.7, 46.0], [D.x0, 46.0], [ex.x, ex.z + 0.6]];
    let wi = 0;
    key('ShiftLeft', true); key('KeyW', true);
    for (let i = 0; i < 60 * 40 && N.level === 'X705' && wi < path.length; i++) {
      const p = N.player.pos, [x, z] = path[wi];
      if (Math.hypot(x - p.x, z - p.z) < 0.4) { wi++; continue; }
      face(x, z, 0); N.pump(DT, 1, false); if (N.ai.state === 'ATTACK') { dead = true; break; }
    }
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
      && vias.includes('stair') && !vias.includes('ev') && st.stage === 10 && st.item === 'b1' && N.hudState().objective === '食堂の奥の階段から地下へ' && !N.ai.allowStairs;
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
    N.pump(DT, 2, false);
    const objIn = N.hudState().objective;   // P6b #13: 地下の中「奥の作業場で車のキーを探せ」
    // P5b-2b: トンネルのループと迷路は test_spaces.js(B1_1〜3)。ここではループを抜けたことにして作業場へ移り、キーを取って踊り場から出る
    const DB = N.spaces.debug('XB1'), ox = N.spaces.def('XB1').origin[0];
    DB.release('test_story');
    await tp('XB1', ox + 6, 77.4, Math.PI);
    walkTo(pk('kCar').pos.x, pk('kCar').pos.z - 0.8, 600);
    const pickHint = pickAt(pk('kCar'));
    const st = S.state();
    N.pump(DT, 2, false);
    const objKey = N.hudState().objective;   // P6b #13: 取ったら「鉄扉へ戻れ」
    // 管理人は地下へ来ない(経路が無い)
    const routeB1 = N.ai._route(17.6, 23.5, 8.5, 1.45, 1, 'B1');
    const routeXB1 = N.ai._route(17.6, 23.5, 300, 3, 1, 'XB1');
    await tp('XB1', ox - 3.1, 2.0, 0);
    const back = leave();
    N.pump(DT, 2, false);
    const pass = noKey.toast === '鍵がかかっている' && !noKey.unlocked && ent.hint.includes('鍵を使う') && ent.level === 'XB1' && pickHint.includes('拾う')
      && objIn === '奥の作業場で車のキーを探せ' && objKey === '鉄扉へ戻れ'
      && st.stage === 11 && st.item === 'car' && N.hudState().objective === '駐車場の車で逃げろ' && routeB1.length === 0 && routeXB1.length === 0 && back.level === 'B1';
    return { pass, noKey, enter: ent, pickHint, objIn, objKey, stage: st.stage, item: st.item, routeB1: routeB1.length, routeXB1: routeXB1.length, back };
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
    S.applyStage(5); quiet();   // P6b-C: 220 は第5段
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
    const pass = died && st.stage === 5 && st.item === '220' && JSON.stringify(st.unlocked) === JSON.stringify(un0) && un0.includes('105') && !un0.includes('312') && un0.includes('KEYBOX') && S.chained && N.doorApi.get('MST2').chained
      && !!N.doorApi.get('407').broken && sp.level === 2 && Math.abs(sp.x - 24.55) < 0.05 && Math.abs(sp.z - 21.2) < 0.05 && N.hudState().objective === '220号室へ';
    N.doorApi.repairDoor('407');
    return { pass, died, stage: st.stage, item: st.item, unlocked: st.unlocked, broken407: true, respawn: sp };
  });

  // ---------------------------------------------------------------- 13) 目標の文言と強調・持ち物の札
  await T('13_objective_text_and_item_tag', async () => {
    S.applyStage(5); quiet(); N.pump(DT, 2, false);   // P6b-C: 220(第5段)→ 312(第6段)
    const a = N.hudState();
    N.pump(DT, 200, false);   // P6b #6: 強調は 3 秒
    const b = N.hudState();
    S.applyStage(6); N.pump(DT, 2, false);
    const c = N.hudState();
    const pass = a.objective === '220号室へ' && a.objectiveEm && !b.objectiveEm && b.objective === '220号室へ' && a.item === '鍵　220' && c.objective === '312号室へ' && c.objectiveEm && c.item === '鍵　312';
    return { pass, start: a, after25s: b, next: c };
  });

  // ---------------------------------------------------------------- 16) P6b #6・#8: 目標表示の大きさ・帯・強調 3 秒(明滅 2 回)/ 右下の懐中電灯の表示
  await T('16_p6b_objective_style_and_light', async () => {
    S.applyStage(3); quiet(); N.pump(DT, 2, false);
    const obj = document.getElementById('hud-obj'), item = document.getElementById('hud-item'), light = document.getElementById('hud-light');
    const alpha = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return 0; const v = m[1].split(',').map(Number); return v.length > 3 ? v[3] : 1; };
    const em0 = { em: N.hudState().objectiveEm, anim: getComputedStyle(obj).animationName, iter: getComputedStyle(obj).animationIterationCount };
    N.pump(DT, 170, false); const em29 = N.hudState().objectiveEm;
    N.pump(DT, 14, false); const em31 = N.hudState().objectiveEm;
    const cs = getComputedStyle(obj), ci = getComputedStyle(item);
    const style = { font: parseFloat(cs.fontSize), band: alpha(cs.backgroundColor), radius: parseFloat(cs.borderTopLeftRadius), itemFont: parseFloat(ci.fontSize),
      left: obj.getBoundingClientRect().left, top: obj.getBoundingClientRect().top, itemTop: item.getBoundingClientRect().top, objBottom: obj.getBoundingClientRect().bottom };
    // 懐中電灯: F で ON/OFF に追従(文字と色)。切替の 1 秒は明るい。隠れ中は出さない
    // CSS の遷移(実時間 0.3 秒。ヘッドレスではフレームが粗く進みが遅い)を終わらせてから computed style を読む
    const sleep = async () => { await new Promise((r) => setTimeout(r, 30)); for (const an of light.getAnimations({ subtree: true })) an.finish(); };
    N.player.setFlashlight(false); N.pump(DT, 2, false); await sleep();
    const rgb = () => getComputedStyle(light).color.match(/\d+/g).map(Number);
    const off0 = { ...N.hudState().light, color: rgb() };
    tap('KeyF'); N.pump(DT, 20, false); await sleep();
    const on1 = { ...N.hudState().light, color: rgb(), op: +getComputedStyle(light).opacity };
    N.pump(DT, 70, false); await sleep();
    const on2 = { ...N.hudState().light, op: +getComputedStyle(light).opacity };
    tap('KeyF'); N.pump(DT, 70, false); await sleep();
    const off1 = { ...N.hudState().light, color: rgb() };
    N.player.hidden = { room: 'test', level: 3 }; N.hud.update(0);   // 隠れ中(rooms.hide が立てる印)
    const hidingShown = N.hudState().light.shown;
    N.player.hidden = null; N.hud.update(0);
    const amber = (c) => c[0] > 180 && c[0] > c[1] + 25 && c[1] > c[2] + 25;
    const grey = (c) => Math.max(...c) - Math.min(...c) < 14;
    const pass = style.font >= 13 * 1.5 && style.band > 0 && style.itemFont >= 12 * 1.5 && style.left < 40 && style.top < 40 && style.itemTop >= style.objBottom - 1
      && em0.em && em0.anim === 'hudObjBlink' && em0.iter === '2' && em29 && !em31
      && off0.shown && !off0.on && off0.text === '懐中電灯　OFF' && grey(off0.color)
      && on1.shown && on1.on && on1.text === '懐中電灯　ON' && amber(on1.color) && on1.pulse && !on2.pulse && on1.op > on2.op
      && off1.shown && !off1.on && off1.text === '懐中電灯　OFF' && grey(off1.color) && !hidingShown && N.hudState().light.shown;
    return { pass, style, em0, em29, em31, off0, on1, on2, off1, hidingShown };
  });

  // ---------------------------------------------------------------- 17) P6b #7: 221 のスマホ(入ると 3 秒以内に画面が光り鳴る・鳴る位置はスマホ・玄関から画面が見える)
  await T('17_p6b_221_phone', async () => {
    S.applyStage(1); quiet(); S.sub = 'memo';
    await tp(2, 21.65, 21.0, 0);   // 221 の前の廊下
    N.pump(DT, 30, false);
    const outside = S.state().phone;
    const bank0 = N.bank.n;
    await tp(2, 21.65, 19.6, 0);   // 221 の玄関(戸口の内側)
    let maxE = 0, firstLitAt = null, minE = 9;
    for (let i = 0; i < 180; i++) { N.pump(DT, 1, false); const e = S.state().phone.emissive; if (e > 0.5 && firstLitAt === null) firstLitAt = +(i * DT).toFixed(2); maxE = Math.max(maxE, e); if (firstLitAt !== null) minE = Math.min(minE, e); }
    const ring = N.bank.log.filter((l) => l.n > bank0 && l.id === 'story_221_lure');
    const ph = S.state().phone, pp = S.phonePos;
    const ringPos = ring.length ? ring[ring.length - 1].pos : null;
    const ringDist = ringPos ? +Math.hypot(ringPos[0] - pp.x, ringPos[2] - pp.z).toFixed(3) : null;
    // 家具に埋まらない(221 の内装の当たり)・玄関(戸口)の目の高さから画面までの視線が通る(建物の面に遮られない)
    const R = N.building.floors.find((f) => f.level === 2).rooms.find((r) => r.id === '221');
    const inSolid = R.interior.solids.filter((q) => pp.x + 0.08 > q[0] && pp.x - 0.08 < q[2] && pp.z + 0.08 > q[1] && pp.z - 0.08 < q[3]).length;
    const eye = new N.THREE.Vector3(21.65, N.player.pos.y + 1.6, 20.2), tgt = pp.clone(); tgt.y += 0.0;
    const dir = tgt.clone().sub(eye), len = dir.length(); dir.normalize();
    const rc = new N.THREE.Raycaster(eye, dir, 0.05, len - 0.04);
    const meshes = []; N.scene.traverseVisible((o) => { if (o.isMesh && !o.isSprite && !o.isSkinnedMesh) { let ph2 = false; for (let q = o; q; q = q.parent) if (q === S.phone) ph2 = true; if (!ph2) meshes.push(o); } });
    const hits = rc.intersectObjects(meshes, false).map((h) => [h.object.name || h.object.parent && h.object.parent.name, +h.distance.toFixed(2)]);
    // 対照: 同じ目から 221 の東の壁(浴室の壁の向こう)を狙うと当たる(レイキャストが建物の面を拾えていること)
    const ctrlT = new N.THREE.Vector3(23.6, eye.y - 0.4, 17.6), cd = ctrlT.clone().sub(eye), cl = cd.length(); cd.normalize();
    const ctrlHits = new N.THREE.Raycaster(eye, cd, 0.05, cl).intersectObjects(meshes, false).length;
    // 飛び出し(奥へ進む)の後は鳴らない・暗い画面
    const pass = outside && outside.emissive <= 0.03 && firstLitAt !== null && firstLitAt <= 3.0 && maxE >= 1.5 && minE <= 0.5 && ring.length >= 1 && ringDist !== null && ringDist <= 0.3
      && inSolid === 0 && hits.length === 0 && ctrlHits > 0 && ph.visible;
    return { pass, outside, firstLitAt, maxE, minE, rings: ring.length, ringPos, phone: ph, ringDist, inSolid, sightHits: hits.slice(0, 5), ctrlHits, sightLen: +len.toFixed(2) };
  });

  // ---------------------------------------------------------------- 14) 追跡中に外階段で階を変えてもフリーズしない(P5b-1b 差し戻し 1)
  //  実機の再現手順: 2F の廊下を EV ホールへ走って逃げる → 外階段の鉄扉 MST2(6.5, 21.2 で E)→ 踊り場 → 下りの段 → 1F。管理人は追跡中。
  //  直す前: 段の途中(折り返しで XZ が踊り場の真下)のプレイヤーを踊り場の管理人が襲い、段が進んで空振り → 襲撃ムービーが残り視点が
  //  管理人の顔に固定されたまま(操作不能)。段の途中で殺されると復帰後も段へ引き戻された。
  await T('14_chase_outer_stairs_no_freeze', async () => {
    S.applyStage(2);   // P6b-C: 第3段から外階段に鎖。鎖のない第2段で quiet();
    N.setFlashlight(true);
    await tp(2, 12.0, 21.2, Math.PI / 2);
    // 管理人を東 6m に出して追わせる(視点固定なし)
    N.ai.appear({ level: 2, x: 18.0, z: 21.2, lock: 0, recover: 0.3, slow: 0 });
    N.pump(DT, 30, false);
    const chasing0 = N.ai.state === 'CHASE';
    const frame0 = N.renderer.info.render.frame;
    let attackOnStairs = false, maxGapAttack = 0, onStairs = false, dead = false;
    const watch = () => {
      if (N.stairs.active) onStairs = true;
      if (N.ai.state === 'ATTACK') { const gap = Math.abs(N.player.pos.y - (N.ai.level - 1) * 2.9); maxGapAttack = Math.max(maxGapAttack, gap); if (N.stairs.active) attackOnStairs = true; }
      if (N.deathState()) dead = true;
    };
    walkTo(7.2, 21.2, 600, 0.2, true); watch();
    N.setView(6.5, 21.2, Math.PI / 2, 0); N.pump(DT, 2, false);
    const doorHint = N.hudState().hint;
    tap('KeyE'); N.pump(DT, 16, false); watch();
    const st = N.building.stairs.find((q) => q.id === 'main'), g = st.geom;
    const lane = (g.lanes.down[0] + g.lanes.down[1]) / 2;
    walkTo(5.6, 21.2, 300, 0.2, true); watch();
    // 段の口へ歩き、そのまま W で下りる(着くまで)
    key('KeyW', true); key('ShiftLeft', true);
    for (let i = 0; i < 60 * 14 && N.level === 2; i++) { if (!N.stairs.active) face(lane, g.s0 + 0.5, 0); N.pump(DT, 1, false); watch(); if (dead) break; }
    key('KeyW', false); key('ShiftLeft', false);
    N.pump(DT, 30, false); watch();
    const arrived = N.level === 1;
    const afterArrive = { frozen: N.player.frozen, movie: N.movie.active, viewLock: N.viewLock.active, stairs: !!N.stairs.active };
    // 歩ける
    // 4 方向に 0.5 秒ずつ歩いて、いちばん進んだ距離(壁に向いていても判定できるように。歩き 1.6 m/s × 0.5 秒 = 0.8m)
    const walk1 = () => { let best = 0; for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) { const p0 = N.player.pos.clone(); N.setView(p0.x, p0.z, yaw, 0); key('KeyW', true); N.pump(DT, 30, false); key('KeyW', false); N.pump(DT, 2, false); best = Math.max(best, Math.hypot(N.player.pos.x - p0.x, N.player.pos.z - p0.z)); } return +best.toFixed(2); };
    const moved = walk1();
    // 視点がプレイヤーの目に戻っている(襲撃ムービーが残ると FOV 44°・カメラが管理人の顔の前に固定されたまま)
    const camOK = () => Math.hypot(N.camera.position.x - N.player.pos.x, N.camera.position.z - N.player.pos.z) < 0.1 && Math.abs(N.camera.fov - 68) < 0.5;
    const cam1 = camOK();
    // 管理人を踊り場(2F)の段の口に置いても、1F に着いた・段の下の方のプレイヤーを襲わない
    // 本物のループ(rAF)が止まっていない: 実時間 0.4 秒で描画の通し番号が進む
    N.paused = false; await new Promise((r) => setTimeout(r, 400)); N.paused = true;
    const frame1 = N.renderer.info.render.frame;
    // 段の途中で死ぬ → 復帰後に段へ引き戻されず、歩ける
    S.applyStage(2); quiet(); N.setFlashlight(false);
    await tp(2, 5.2, 21.2, Math.PI);
    key('KeyW', true);
    for (let i = 0; i < 60 * 3 && !N.stairs.active; i++) { face(lane, g.s0 + 0.5, 0); N.pump(DT, 1, false); }
    N.pump(DT, 60, false);
    key('KeyW', false);
    const midStairs = !!N.stairs.active, midY = +N.player.pos.y.toFixed(2);
    N.ai.onKill();   // 段の途中で殴られた(ヒット)
    let respawned = false;
    for (let i = 0; i < 60 * 8; i++) { N.pump(DT, 1, false); if (N.deathState() && N.deathState().respawned) respawned = true; if (respawned && !N.deathState()) break; }
    N.pump(DT, 120, false);
    const sp = S.respawnPoint();
    const atSpawn = N.level === sp.level && Math.hypot(N.player.pos.x - sp.x, N.player.pos.z - sp.z) < 0.05 && !N.stairs.active && !N.player.frozen && !N.movie.active;
    const moved2 = walk1();
    // 空振りの保険: 襲撃ムービーが始まってから届かない所へ離れる → 空振り → ムービーが畳まれ操作が戻る
    S.applyStage(2); quiet();
    await tp(2, 14.0, 21.2, -Math.PI / 2);
    N.ai.dormant = false; N.ai.setLevel(2); N.enemy.place(15.2, 21.2, -Math.PI / 2); N.enemy.setState('ATTACK');
    N.pump(DT, 10, false);
    const movieOn = N.movie.active;
    N.player.setPose(9.0, 21.2, Math.PI / 2, 0);   // 段で運ばれたのと同じ(入力でなく位置が動く)
    let missed = false;
    for (let i = 0; i < 60 * 3; i++) { N.pump(DT, 1, false); if (N.ai.events.some((e) => e.ev === 'miss' && e.t > N.ai.time - 3)) { missed = true; } if (missed && !N.movie.active) break; }
    N.pump(DT, 5, false);
    const afterMiss = { movie: N.movie.active, frozen: N.player.frozen, dead: !!N.deathState() };
    const moved3 = walk1();
    const cam3 = camOK();
    const pass = chasing0 && doorHint.includes('開ける') && onStairs && arrived && !dead && !attackOnStairs && !afterArrive.frozen && !afterArrive.movie && !afterArrive.stairs && moved >= 0.6 && cam1 && frame1 > frame0
      && midStairs && midY < 2.9 - 0.3 && respawned && atSpawn && moved2 >= 0.6 && movieOn && missed && !afterMiss.movie && !afterMiss.frozen && !afterMiss.dead && moved3 >= 0.6 && cam3;
    quiet();
    return { pass, chasing0, doorHint, onStairs, arrived, dead, attackOnStairs, maxGapAttack: +maxGapAttack.toFixed(2), afterArrive, moved, cam1, frames: [frame0, frame1],
      midStairs, midY, respawned, atSpawn, respawnAt: pos(), moved2, movieOn, missed, afterMiss, moved3, cam3 };
  });

  // ---------------------------------------------------------------- 18) P6b-A2(§3.9 #18): 221 の初回の走り確認
  //  視点が玄関へ向き切って操作が戻る瞬間に「Shift＋W で走って逃げろ！」→ 時間が止まる(10 秒待っても管理人が動かず OUT しない・物語の時計も止まる)→
  //  W だけでは動かず解けない(表示はそのまま)→ Shift＋W で走り出すと表示が消え、grace(立ち止まって見ている間)はそこから数える。2 回目(死んで戻った後)は出ない
  await T('18_p6b_221_run_gate', async () => {
    S.applyStage(1); await settle(4);
    S.sub = null; S.introDone = true; N.ai.setDormant(true);
    const G = N.runGate, gl0 = G.log.length;
    const A = await run221({ light: true, gate: true });
    let t = 0;
    for (; t < 12 && !G.active; t += DT) N.pump(DT, 1, false);
    const at = { active: G.active, prompt: N.hudState().runPrompt, phase: N.ai.revealPhase, frozen: N.player.frozen, viewLock: N.viewLock.active, afterBurst_s: +(N.ai.time - A.t0).toFixed(2) };
    // 10 秒待つ(何も押さない)
    const ai0 = N.ai.time, e0 = N.enemyObj.pos.clone(), sl0 = S.logCount, st0 = S.time, p0 = N.player.pos.clone(), d0 = N.deaths(), mix0 = N.enemyObj.mixer ? N.enemyObj.mixer.time : null;
    for (let i = 0; i < 600; i++) N.pump(DT, 1, false);
    const wait = { aiTimeAdvanced: +(N.ai.time - ai0).toFixed(4), enemyMoved: +N.enemyObj.pos.distanceTo(e0).toFixed(4), storyLogs: S.logCount - sl0, storyTimeAdvanced: S.time - st0, mixerAdvanced: mix0 === null ? null : +(N.enemyObj.mixer.time - mix0).toFixed(4),
      dead: !!N.deathState() || N.deaths() !== d0, state: N.ai.state, prompt: N.hudState().runPrompt, active: G.active };
    // 見回しはできる(向きを変えても戻されない)
    const yaw0 = N.player.object.rotation.y; N.player.object.rotation.y = yaw0 + 0.4; N.pump(DT, 5, false);
    const lookOK = Math.abs(N.player.object.rotation.y - (yaw0 + 0.4)) < 1e-6; N.player.object.rotation.y = yaw0; N.pump(DT, 2, false);
    // W だけ(歩き): 動かない・解けない
    key('KeyW', true); for (let i = 0; i < 60; i++) N.pump(DT, 1, false); key('KeyW', false); N.pump(DT, 2, false);
    const walk = { moved: +N.player.pos.distanceTo(p0).toFixed(4), active: G.active, prompt: N.hudState().runPrompt, aiTimeAdvanced: +(N.ai.time - ai0).toFixed(4) };
    // Shift＋W: 走って動き出した瞬間に解ける → grace はそこから
    key('ShiftLeft', true); key('KeyW', true);
    let goAt = null; const tGo0 = N.ai.time;
    for (let i = 0; i < 30 && goAt === null; i++) { N.pump(DT, 1, false); if (!G.active) goAt = i + 1; }
    const go = { frames: goAt, active: G.active, prompt: N.hudState().runPrompt, phase: N.ai.revealPhase, log: G.log.slice(gl0).map((l) => l.ev + (l.speed ? ':' + l.speed : '')) };
    key('KeyW', false); key('ShiftLeft', false); N.pump(DT, 1, false);
    const RL = N.ai.revealLog || {};
    // grace の間(K × 3 秒)は立ち止まったまま。終わると歩き出す
    const eG = N.enemyObj.pos.clone(); let graceMoved = 0, moveAt = null;
    for (let i = 0; i < 60 * 5; i++) { N.pump(DT, 1, false); const d = N.enemyObj.pos.distanceTo(eG); if (N.ai.time - tGo0 < 2.9) graceMoved = Math.max(graceMoved, d); if (moveAt === null && d > 0.05) moveAt = +(N.ai.time - tGo0).toFixed(2); }
    // 2 回目: 逃げる途中で死ぬ → 戻ってもう一度 221 の奥へ → 走り確認は出ない
    N.ai.onKill(); for (let i = 0; i < 60 * 8 && N.deathState(); i++) N.pump(DT, 1, false);
    const shownFlag = S.runGateShown, rearmed = !S.burst221;   // 死んで戻ると飛び出しは再び起きる(初回扱いにはしない)
    const B = await run221({ light: true, keepGate: true });
    let again = false; for (let i = 0; i < 60 * 8; i++) { N.pump(DT, 1, false); if (G.active) again = true; if (N.ai.revealPhase === 'grace' || N.ai.state === 'CHASE') break; }
    void B;
    for (let i = 0; i < 60 * 8 && !N.deathState(); i++) N.pump(DT, 1, false);
    for (let i = 0; i < 60 * 8 && N.deathState(); i++) N.pump(DT, 1, false);
    quiet();
    const pass = at.active && at.prompt === 'Shift＋W で走って逃げろ！' && at.phase === 'runGate' && !at.frozen && !at.viewLock
      && wait.aiTimeAdvanced === 0 && wait.enemyMoved === 0 && wait.storyLogs === 0 && wait.storyTimeAdvanced === 0 && (wait.mixerAdvanced === null || wait.mixerAdvanced === 0) && !wait.dead && wait.state === 'APPEAR' && wait.prompt && wait.active
      && lookOK && walk.moved < 1e-3 && walk.active && walk.prompt && walk.aiTimeAdvanced === 0
      && go.frames !== null && go.frames <= 3 && !go.active && go.prompt === '' && go.log.includes('walk_ignored') && go.log.some((x) => x.startsWith('go:'))
      && RL.control !== undefined && RL.runGate !== undefined && Math.abs(RL.control - RL.runGate) < 0.05 && graceMoved < 0.02 && moveAt !== null && moveAt >= 2.9 && shownFlag && rearmed && !!B.ev && !again;
    return { pass, at, wait, lookOK, walk, go, reveal: { runGate: RL.runGate, control: RL.control, move: RL.move }, graceMoved: +graceMoved.toFixed(3), enemyMovesAfterGo_s: moveAt, secondTime: { flagKept: shownFlag, rearmed, burstAgain: !!B.ev, shown: again } };
  });

  // ---------------------------------------------------------------- 15) 登場演出(P5b-1b 差し戻し 4): 奥の窓際のロッカーがゆっくり開き、中の管理人が見えてから飛び出す
  //  221(ライト点灯)と 6F の罠 606(ライト消灯 = 管理人が中で自分の懐中電灯を点ける)で同じ共通コード
  await T('15_locker_reveal_timeline', async () => {
    const res = {};
    let pass = true;
    const V = N.ai.cfg.reveal;
    // 管理人が見えるか: 顔(頭の骨の少し前)・胸・腰の 3 点のどれかが視野の中で、壁・家具・ロッカーの扉に遮られない
    const headVisible = (lv) => {
      N.scene.updateMatrixWorld();   // pump(…, false) は描かないので、動いた扉板の行列をここで更新する
      const e = N.enemyObj, f = e.forward(new N.THREE.Vector3());
      const head = e.headWorld(new N.THREE.Vector3()).addScaledVector(f, 0.09);
      const pts = [head, head.clone().add(new N.THREE.Vector3(0, -0.4, 0)), head.clone().add(new N.THREE.Vector3(0, -0.75, 0))];
      const fr = new N.THREE.Frustum().setFromProjectionMatrix(new N.THREE.Matrix4().multiplyMatrices(N.camera.projectionMatrix, N.camera.matrixWorldInverse));
      let clear = false, inView = false, hit = null;
      for (const q of pts) {
        const cam = N.camera.position.clone(), dir = q.clone().sub(cam); const dist = dir.length(); dir.normalize();
        const hits = new N.THREE.Raycaster(cam, dir, 0.05, dist - 0.06).intersectObject(N.world.floors.get(lv).group, true).filter((h) => h.object.visible);
        if (!hits.length && fr.containsPoint(q)) { clear = true; inView = true; } else if (hits.length && !hit) hit = hits[0].object.name;
      }
      return { clear, inView, hit };
    };
    const camYawPitch = () => { const d = N.camera.getWorldDirection(new N.THREE.Vector3()); return { yaw: Math.atan2(-d.x, -d.z), pitch: Math.asin(Math.max(-1, Math.min(1, d.y))) }; };
    const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    // 罠の引き金まで歩く(221 = 奥へ、6F = 机の上の「鍵に見える物」へ)
    const toTrigger = async (C) => {
      S.applyStage(C.stage); quiet();
      const r = room(C.id).r, pts = r.interior.points, lv = room(C.id).level;
      if (C.stage === 1) { S.sub = null; S.introDone = true; N.ai.setDormant(true); S.runGateShown = true; }   // P6b-A2: 走り確認は 18 番で見る
      else N.ai.dormant = false;
      N.setFlashlight(C.light);
      await tp(lv, ...front(C.id, 0.9), 0);
      N.openDoor(C.id, true); N.pump(DT, 60, false);
      walkPath([[r.door.pos[0] - FN[r.door.facing][0] * 0.6, r.door.pos[1] - FN[r.door.facing][1] * 0.6], pts.entry, pts.room]);
      const goal = C.stage === 1 ? pts.living : pts.deskFront;
      key('KeyW', true);
      for (let i = 0; i < 400 && N.ai.state !== 'APPEAR'; i++) { face(goal[0], goal[1], 0); N.pump(DT, 1, false); }
      key('KeyW', false);
      return { r, pts, lv, BL: r.interior.burst, L: N.rooms.bursts.get(C.id) };
    };
    for (const C of [{ id: '221', stage: 1, light: true }, { id: '606', stage: 4, light: false }]) {
      const { r, lv, BL, L } = await toTrigger(C);
      const K = V.room[C.id] ?? V.room.default;
      const t0 = N.ai.time;
      const tl = [];
      let jig = 0, openStart = null, openEnd = null, moveDuringOpen = 0, visDuringOpen = 0, visSamples = 0, hiddenWhileClosed = 0, closedSamples = 0, underMax = 0, stareT = 0;
      let vlAll = true, emergeT = 0, emergeMaxSpeed = 0, visEmerge = 0, emergeSamples = 0, ctrlAt = null, moveAt = null, ctrl = null, lockSeen = false, maxTurnStep = 0, lastQ = null, seamJump = null, attackDuringLock = false;
      const feet = new N.THREE.Vector2(BL.feet[0], BL.feet[1]);
      let prevE = N.enemyObj.pos.clone(), walkStart = null, walkDist = null;
      for (let i = 0; i < 60 * 16; i++) {
        const wasLocked = N.viewLock.active, qBefore = N.camera.quaternion.clone();
        N.pump(DT, 1, false);
        const t = N.ai.time - t0, ph = N.ai.revealPhase, o = L.open01, e = N.enemyObj.pos;
        const sp = Math.hypot(e.x - prevE.x, e.z - prevE.z) / DT; prevE = e.clone();
        jig = Math.max(jig, Math.abs(L.jiggle));
        if (openStart === null && o > 0.02) openStart = t;
        if (openEnd === null && o >= 0.99) openEnd = t;
        if (ph === 'omen' || ph === 'open' || ph === 'stare') moveDuringOpen = Math.max(moveDuringOpen, Math.hypot(e.x - feet.x, e.z - feet.y));
        if (ph === 'stare') stareT += DT;
        if (ph === 'open') underMax = Math.max(underMax, N.enemyObj.underLight);
        if (['open', 'stare', 'emerge', 'settle'].includes(ph) && !N.viewLock.active) vlAll = false;
        if (N.viewLock.active) { lockSeen = true; if (lastQ) maxTurnStep = Math.max(maxTurnStep, lastQ.angleTo(N.camera.quaternion)); lastQ = N.camera.quaternion.clone(); }
        if (N.viewLock.active && (N.ai.state === 'ATTACK' || N.deathState())) attackDuringLock = true;
        if (ph === 'emerge') { emergeT += DT; emergeMaxSpeed = Math.max(emergeMaxSpeed, sp); }
        if (i % 4 === 0) {
          if (ph === 'omen') { closedSamples++; if (!headVisible(lv).clear) hiddenWhileClosed++; }
          if ((ph === 'open' && o > 0.55) || ph === 'stare') { visSamples++; const v = headVisible(lv); if (v.clear && v.inView) visDuringOpen++; }
          if (ph === 'emerge') { emergeSamples++; const v = headVisible(lv); if (v.clear && v.inView) visEmerge++; }
        }
        // 操作が戻った瞬間: 視線が出口(部屋の扉)の方 ±25°・その前のフレームからの向きの跳びが無い・マウスがその向きから続く
        if (ctrlAt === null && lockSeen && wasLocked && !N.viewLock.active) {
          ctrlAt = t;
          seamJump = qBefore.angleTo(N.camera.quaternion);
          const p = N.player.pos, d = r.door.pos, yp = camYawPitch();
          const want = Math.atan2(-(d[0] - p.x), -(d[1] - p.z));
          const rot = N.player.object.rotation;
          // マウスを 1 回だけ横へ(PointerLockControls の mousemove)。向きが今の向きから少しだけ動く = 返した後の操作が連続する
          const C2 = N.player.controls, locked0 = C2.isLocked; C2.isLocked = true;
          const y0 = rot.y, x0 = rot.x;
          document.dispatchEvent(new MouseEvent('mousemove', { movementX: 20, movementY: 0 }));
          const qa = new N.THREE.Euler().setFromQuaternion(N.camera.quaternion, 'YXZ');
          const mouseDy = wrapA(qa.y - y0), mouseDx = qa.x - x0;
          document.dispatchEvent(new MouseEvent('mousemove', { movementX: -20, movementY: 0 }));
          C2.isLocked = locked0;
          key('KeyW', true);   // 操作が戻ったら出口の方へ歩き出す(管理人の歩きの速さを測る間に追いつかれないように)
          ctrl = { yawErrDeg: +(Math.abs(wrapA(yp.yaw - want)) * 180 / Math.PI).toFixed(1), pitch: +yp.pitch.toFixed(3), roll: +rot.z.toFixed(4), frozen: N.player.frozen,
            enemyToPlayer: +Math.hypot(e.x - p.x, e.z - p.z).toFixed(2), mouseYawStep: +mouseDy.toFixed(4), mousePitchStep: +mouseDx.toFixed(4), state: N.ai.state };
        }
        if (ctrlAt !== null && moveAt === null && (N.ai.state !== 'APPEAR' || Math.hypot(e.x - BL.out[0], e.z - BL.out[1]) > 0.05)) { moveAt = t; walkStart = e.clone(); }
        if (moveAt !== null && walkDist === null && t - moveAt >= 1.0) walkDist = Math.hypot(e.x - walkStart.x, e.z - walkStart.z);
        if (i % 6 === 0) tl.push([+t.toFixed(2), ph, +o.toFixed(2), N.viewLock.active ? 'L' : '-', +N.enemyObj.underLight.toFixed(2)]);
        if (walkDist !== null) break;
      }
      key('KeyW', false); N.pump(DT, 1, false);
      const atOutAtCtrl = ctrl !== null;
      const openDur = openStart !== null && openEnd !== null ? +(openEnd - openStart).toFixed(2) : null;
      const graceGot = ctrlAt !== null && moveAt !== null ? +(moveAt - ctrlAt).toFixed(2) : null;
      const RL = N.ai.revealLog || {};
      const ok = jig > 0.01 && openDur !== null && openDur >= 1.0 && openDur <= 1.6 && moveDuringOpen < 0.01 && closedSamples > 0 && hiddenWhileClosed === closedSamples
        && visSamples > 0 && visDuringOpen / visSamples >= 0.6 && Math.abs(stareT - V.stare) < 0.05
        && Math.abs(emergeT - V.emerge) < 0.05 && emergeMaxSpeed < 1.2 && emergeSamples > 0 && visEmerge / emergeSamples >= 0.6
        && vlAll && !attackDuringLock && atOutAtCtrl && ctrl.yawErrDeg <= 25 && Math.abs(ctrl.roll) < 1e-3 && !ctrl.frozen && seamJump < 0.01
        && Math.abs(ctrl.mouseYawStep + 0.04) < 0.005 && Math.abs(ctrl.mousePitchStep) < 1e-4 && maxTurnStep < 0.12
        && graceGot !== null && graceGot >= 2.5 && Math.abs(graceGot - V.grace * K) < 0.1 && walkDist !== null && walkDist <= V.walk.speed * 1.0 + 0.1
        && (C.light ? underMax === 0 : underMax > 0.5);
      if (!ok) pass = false;
      res[C.id] = { ok, light: C.light, k: K, jiggleMax: +jig.toFixed(3), openStart_s: openStart && +openStart.toFixed(2), openDur_s: openDur, enemyMovedWhileOpening_m: +moveDuringOpen.toFixed(3),
        hiddenWhileClosed: `${hiddenWhileClosed}/${closedSamples}`, headVisibleWhileOpen: `${visDuringOpen}/${visSamples}`, stare_s: +stareT.toFixed(2),
        emerge_s: +emergeT.toFixed(2), emergeMaxSpeed: +emergeMaxSpeed.toFixed(2), visibleWhileEmerging: `${visEmerge}/${emergeSamples}`, viewLockOpenToSettle: vlAll, attackDuringLock,
        control_s: ctrlAt && +ctrlAt.toFixed(2), atControl: ctrl, seamJumpRad: seamJump && +seamJump.toFixed(4), maxTurnStepRad: +maxTurnStep.toFixed(3),
        firstStep_s: moveAt && +moveAt.toFixed(2), graceAfterControl_s: graceGot, walkFirst1s_m: walkDist && +walkDist.toFixed(2),
        underLightMax: +underMax.toFixed(2), revealLog: RL, timeline: tl.filter((q, k) => k % 2 === 0).slice(0, 40) };
      quiet();
    }
    // 視点固定中に管理人を隣接させても死なない(611・点灯): 固定中〜grace の間、毎フレーム管理人の 0.9m 前に置く・ATTACK を直接要求しても拒まれる
    {
      const C = { id: '611', stage: 4, light: true };
      const { BL } = await toTrigger(C);
      const t0 = N.ai.time;
      let lockSeen = false, ctrlAt = null, attacked = false, died = false, forced = null, adjFrames = 0, minD = 1e9, stateDuring = new Set();
      for (let i = 0; i < 60 * 14; i++) {
        N.pump(DT, 1, false);
        const ph = N.ai.revealPhase;
        if (N.viewLock.active) lockSeen = true;
        if (['open', 'stare', 'emerge', 'settle', 'exit', 'grace'].includes(ph)) {
          const e = N.enemyObj.pos, f = N.enemyObj.forward(new N.THREE.Vector3());
          N.player.pos.x = e.x + f.x * 0.9; N.player.pos.z = e.z + f.z * 0.9;   // 管理人の目の前(攻撃の届く 1.4m より内)
          adjFrames++; minD = Math.min(minD, Math.hypot(N.player.pos.x - e.x, N.player.pos.z - e.z));
          stateDuring.add(N.ai.state);
          if (forced === null && ph === 'settle') { const n0 = N.ai.events.length; N.ai.setState('ATTACK'); forced = { blocked: N.ai.state === 'APPEAR' && N.ai.events.slice(n0).some((q) => q.ev === 'attack_blocked') }; }
        }
        if (N.ai.state === 'ATTACK') attacked = true;
        if (N.deathState()) died = true;
        if (lockSeen && ctrlAt === null && !N.viewLock.active) ctrlAt = +(N.ai.time - t0).toFixed(2);
        if (ctrlAt !== null && !ph) break;   // grace が終わった(以後は普通に追う)
      }
      const ok = lockSeen && ctrlAt !== null && adjFrames > 200 && minD < 1.0 && !attacked && !died && forced && forced.blocked && [...stateDuring].every((s) => s === 'APPEAR');
      if (!ok) pass = false;
      res.adjacent611 = { ok, adjacentFrames: adjFrames, minDist: +minD.toFixed(2), attacked, died, forcedAttack: forced, control_s: ctrlAt, states: [...stateDuring], out: BL.out };
      quiet();
    }
    // 609(220 の鍵の部屋): 同じ見た目のロッカーがあるが開かない(管理人の出所でない・E の対象でない・扉は閉じたまま)
    {
      S.applyStage(4); quiet();   // P6b-C: 6F は第4段
      const r = room('609').r, p = r.interior.points, SL = r.interior.sealedLocker;
      await tp(6, ...front('609', 0.9), 0);
      N.openDoor('609', true); N.pump(DT, 60, false);
      const t0 = N.ai.time, n0 = S.logCount;
      const walked = walkPath([[r.door.pos[0] - FN[r.door.facing][0] * 0.6, r.door.pos[1] - FN[r.door.facing][1] * 0.6], p.entry, p.room, p.deskFront]);
      N.pump(DT, 30, false);
      // ロッカーの脇(管理人が出てくる罠の部屋の out と同じ点)で扉を向いて E。窓が視野に入れば「窓を開ける」は出てよい
      const toFront = walkTo(SL.out[0], SL.out[1], 400, 0.15);
      face(SL.front[0], SL.front[1], -0.2); N.pump(DT, 2, false);
      const hint = N.hudState().hint || '';
      tap('KeyE'); N.pump(DT, 30, false);
      let node = null; N.world.floors.get(6).group.traverse((o) => { if (o.name === 'BurstLockerDoor_609') node = o; });
      const item = r.interior.items.find((q) => q.k === 'burstlocker');
      const noBurst = !N.ai.events.some((e) => e.t > t0 && e.ev === 'locker_burst') && !evs(n0).includes('trap') && N.ai.state !== 'APPEAR';
      const ok = !!SL && !r.interior.burst && !!item && item.sealed && !N.rooms.bursts.has('609') && !!node && Math.abs(node.rotation.y) < 1e-6 && walked && toFront && noBurst
        && !/隠れる|ロッカー/.test(hint) && !N.rooms.hidden;
      if (!ok) pass = false;
      res.sealed609 = { ok, sealedLocker: !!SL, item: !!item, inBursts: N.rooms.bursts.has('609'), doorNode: !!node, doorRot: node && +node.rotation.y.toFixed(4), walked, toFront, hint, noBurst, hidden: !!N.rooms.hidden };
      quiet();
    }
    return { pass, rooms: res };
  });

  // ---------------------------------------------------------------- 19) P6b-C(§3.10 #3): 外階段・北階段の鉄扉の鎖(第3段〜第9段の追跡の前)。第2段は開く/第3段は「鎖がかかっている」・開かない・通れない/
  //  開いていた扉も鎖で閉じる/第9段の追跡の開始で外れて開く/第10段は鎖なし/管理人の扉 API でも開かない
  await T('19_p6bc_chains_stair_doors', async () => {
    const tryDoor = async (lv, x, z, yaw, id, look) => {
      await tp(lv, x, z, yaw); N.setView(x, z, yaw, 0); N.pump(DT, 2, false);
      const d = door(id), hint = N.hudState().hint, a0 = N.enemyAudio.log.length;
      tap('KeyE'); N.pump(DT, 50, false);
      const r = { id, hint, toast: N.hudState().toast, open: N.doorApi.isOpen(id), angle: +d.angle.toFixed(2), rattle: N.enemyAudio.log.slice(a0).some((l) => l.name === 'rattle'), propVisible: !!(S.chains.find((c) => c.id === id) || {}).g?.visible };
      // 扉へ向かって 1 秒歩く(通れない)
      key('KeyW', true); for (let i = 0; i < 60; i++) { N.setView(N.player.pos.x, N.player.pos.z, yaw, 0); N.pump(DT, 1, false); } key('KeyW', false); N.pump(DT, 2, false);
      r.through = look(N.player.pos);
      if (r.open) { N.doorApi.close(id); N.pump(DT, 60, false); }
      return r;
    };
    const westOfMST = (p) => p.x < 5.9, eastOfNST = (p) => p.x > 7.9;
    S.applyStage(2); quiet();
    const s2 = await tryDoor(2, 6.6, 21.2, Math.PI / 2, 'MST2', westOfMST);
    // 開いたまま第3段になる(105 の鍵を取った瞬間)→ 閉じて鎖
    N.doorApi.open('MST2'); N.pump(DT, 60, false);
    const openBefore = N.doorApi.isOpen('MST2');
    S.setStage(3); N.pump(DT, 2, false);
    const closedByChain = !N.doorApi.isOpen('MST2') && door('MST2').angle === 0 && door('MST2').chained;
    S.applyStage(3); quiet();
    const s3m = await tryDoor(2, 6.6, 21.2, Math.PI / 2, 'MST2', westOfMST);
    const s3n = await tryDoor(3, 7.0, 0.725, -Math.PI / 2, 'NST3', eastOfNST);
    const allChained = CHAIN_IDS.every((id) => door(id).chained && door(id).locked && door(id).storyLock);
    N.doorApi.open('MST4'); N.pump(DT, 30, false);
    const npcOpen = N.doorApi.isOpen('MST4');
    // 第5段(220)も鎖(死亡 → 復帰で残ることは 12 番)
    S.applyStage(5); quiet();
    const s5 = await tryDoor(5, 6.6, 21.2, Math.PI / 2, 'MST5', westOfMST);
    // 第9段: 追跡の前は鎖 → 地下の鍵(追跡の開始)で外れる
    S.applyStage(9); quiet();
    const s9before = await tryDoor(7, 6.6, 21.2, Math.PI / 2, 'MST7', westOfMST);
    S.pick('kB1'); N.pump(DT, 2, false); S.pending = []; quiet();
    const chase = S.sub === 'chase' && !S.chained && !door('MST7').chained && !door('NST2').locked;
    const s9chase = await tryDoor(7, 6.6, 21.2, Math.PI / 2, 'MST7', westOfMST);
    S.applyStage(10); quiet();
    const s10 = await tryDoor(1, 6.6, 21.2, Math.PI / 2, 'MST1', westOfMST);
    const ok2 = s2.hint.includes('開ける') && s2.open && s2.through && !s2.propVisible;
    const okC = (r) => r.hint.includes('鎖がかかっている') && r.toast === '鎖がかかっている' && !r.open && r.angle === 0 && r.rattle && !r.through && r.propVisible;
    const pass = ok2 && openBefore && closedByChain && okC(s3m) && okC(s3n) && allChained && !npcOpen && okC(s5) && okC(s9before) && chase
      && s9chase.hint.includes('開ける') && s9chase.open && s9chase.through && !s9chase.propVisible && s10.open && s10.through;
    return { pass, stage2: s2, openBefore, closedByChain, stage3: { MST2: s3m, NST3: s3n }, allChained, npcOpen, stage5: s5, stage9: { before: s9before, chase, after: s9chase }, stage10: s10 };
  });

  // ---------------------------------------------------------------- 20) P6b-C(§3.10 #3): 異空間から出たら管理人は追跡を終え、出た階には 30 秒現れない(走って音を立てても)。312 から出た時に 3F にいた管理人は別の階へ
  await T('20_p6bc_space_exit_manager_avoids_floor', async () => {
    S.applyStage(3); quiet(); N.ai.dormant = false;
    await tp(1, ...front('105', 0.9), -Math.PI / 2);
    const ent = openAndEnter('105');
    const dbg = N.spaces.debug('X105');
    dbg.skip('loopDone');
    await N.teleport('X105', 303.3, 160.5, Math.PI); N.pump(DT, 10, false);
    N.ai.appear({ level: 'X105', x: 303.3, z: 152.0, lock: 0, recover: 0, slow: 0 }); N.ai.chaseOmni = true;
    N.pump(DT, 30, false);
    const before = { state: N.ai.state, level: N.ai.level };
    walkTo(303.3, 165.97, 400, 0.1, true); waitTrans();
    const out1 = { level: N.level, aiLevel: N.ai.level, aiState: N.ai.state, omni: N.ai.chaseOmni, avoid: N.ai.avoid && { ...N.ai.avoid }, stage: S.stage };
    // 30 秒: 1F の廊下を走り回る(走る音は別の階へも届く)。管理人は 1F に来ない・1F へ向かわない
    const t0 = N.ai.time, ev0 = N.ai.events.length;
    let on1 = 0, goal1 = 0, maxT = 0;
    const pts = [[6.9, 12.8], [6.9, 19.6]];
    for (let k = 0; N.ai.time - t0 < 29.5 && k < 40; k++) {
      const [x, z] = pts[k % 2];
      key('KeyW', true); key('ShiftLeft', true);
      for (let i = 0; i < 240 && N.ai.time - t0 < 29.5; i++) { const p = N.player.pos; if (Math.hypot(x - p.x, z - p.z) < 0.2) break; face(x, z, 0); N.pump(DT, 1, false); if (N.ai.level === 1) on1++; if (N.ai.goalLv === 1 && N.ai.level !== 1) goal1++; if (N.deathState()) break; }
      key('KeyW', false); key('ShiftLeft', false);
      maxT = N.ai.time - t0;
    }
    const evs = N.ai.events.slice(ev0);
    const avoidedNoise = evs.filter((e) => e.ev === 'floor_noise_avoided').length, heard1 = evs.filter((e) => e.ev === 'heard_floor' && e.lv === 1).length;
    const lurk1 = evs.filter((e) => e.ev === 'lurk_pick' && e.lv === 1).length;
    for (let i = 0; i < 90; i++) N.pump(DT, 1, false);   // 30 秒を過ぎると避けない
    const after = { avoided: N.ai._avoided(1), w1: +N.ai.floorWeights()[1].toFixed(2) };
    // 312: 3F の廊下に管理人がいる時に 312 から出る → 別の階(4F)へ・3F を避ける
    S.applyStage(6); quiet();
    const D3 = N.spaces.debug('X312');
    await tp(3, ...front('312', 0.9), -Math.PI / 2);
    const ent3 = (() => {   // 戸口を越えたら止まる(X312 の入口の扉は真後ろ。6 番と同じ)
      const d = door('312');
      face(d.pos[0], d.pos[1], 0); N.pump(DT, 2, false);
      tap('KeyE'); N.pump(DT, 60, false);
      key('KeyW', true);
      for (let i = 0; i < 240 && !S.trans && N.level === 3; i++) { face(d.pos[0] + 0.6, d.pos[1], 0); N.pump(DT, 1, false); }
      key('KeyW', false); waitTrans();
      return N.level;
    })();
    for (let i = 0; i < 200 && !D3.ready(); i++) await new Promise((r) => setTimeout(r, 50));
    N.ai.reset(10.0, 21.2, Math.PI / 2, 3);   // 3F の廊下を巡回中
    S.leaveSpace(); waitTrans();
    const out3 = { level: N.level, aiLevel: N.ai.level, aiState: N.ai.state, avoid: N.ai.avoid && { ...N.ai.avoid } };
    quiet();
    const pass = ent.level === 'X105' && before.state === 'CHASE' && before.level === 'X105' && out1.level === 1 && out1.aiLevel !== 1 && out1.aiLevel !== 'X105' && out1.aiState !== 'CHASE' && !out1.omni
      && out1.avoid && out1.avoid.lv === 1 && out1.stage === 4 && maxT >= 29 && on1 === 0 && goal1 === 0 && heard1 === 0 && lurk1 === 0 && !after.avoided && after.w1 > 0
      && ent3 === 'X312' && out3.level === 3 && out3.aiLevel === 4 && out3.aiState === 'PATROL' && out3.avoid && out3.avoid.lv === 3;
    return { pass, before, exit105: out1, run_s: +maxT.toFixed(1), aiOn1F_frames: on1, aiGoal1F_frames: goal1, floorNoiseAvoided: avoidedNoise, heardFloor1: heard1, lurkPick1F: lurk1, after30s: after, exit312: out3 };
  });

  // ---------------------------------------------------------------- 21) P6b-C(§3.10 #5): 地下への階段の口の灯り(天井灯・裸電球・札「地下」)。1F の通路の端から口を見ると、口の付近が周囲より明るい
  await T('21_p6bc_basement_mouth_light', async () => {
    S.applyStage(4); quiet();
    const B = S.basementMouth, U = B.userData;
    const lights = U.lights.map((l) => ({ type: l.type, intensity: l.intensity, shadow: l.castShadow, color: '#' + l.color.getHexString() }));
    const V = BASEMENT_VIEW;
    await tp(1, V.at[0], V.at[1], 0);
    const lookAt = new N.THREE.Vector3(...V.look);
    const yaw = Math.atan2(-(lookAt.x - V.at[0]), -(lookAt.z - V.at[1]));
    const pitch = Math.atan2(lookAt.y - (N.player.pos.y + 1.6), Math.hypot(lookAt.x - V.at[0], lookAt.z - V.at[1]));
    N.setView(V.at[0], V.at[1], yaw, pitch); N.setFlashlight(false); N.pump(DT, 10, false);
    const visible1F = B.visible;
    const gl = N.renderer.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, R = 30, px = new Uint8Array(4 * R * R);
    const lumAt = (u, v) => { gl.readPixels(Math.max(0, Math.min(W - R, Math.floor(u * W) - R / 2)), Math.max(0, Math.min(H - R, Math.floor(v * H) - R / 2)), R, R, gl.RGBA, gl.UNSIGNED_BYTE, px); let s = 0; for (let i = 0; i < px.length; i += 4) s += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]; return s / (R * R); };
    const measure = () => {
      N.pump(DT, 1, true);
      const q = lookAt.clone().project(N.camera), u = q.x * 0.5 + 0.5, v = q.y * 0.5 + 0.5;
      const mouth = lumAt(u, v);
      const around = []; for (const uu of [0.1, 0.3, 0.5, 0.7, 0.9]) for (const vv of [0.15, 0.5, 0.85]) if (Math.hypot(uu - u, vv - v) > 0.18) around.push(lumAt(uu, vv));
      return { mouth: +mouth.toFixed(1), around: +(around.reduce((a, b) => a + b, 0) / around.length).toFixed(1), ndc: [+q.x.toFixed(2), +q.y.toFixed(2)] };
    };
    const on = measure();
    const I0 = U.lights.map((l) => l.intensity);   // 灯りを消した比較(群の表示は story.update が毎フレーム戻すので、強さと発光板で消す)
    U.lights.forEach((l) => { l.intensity = 0; }); U.panel.visible = false; U.glass.visible = false;
    const off = measure();
    U.lights.forEach((l, i) => { l.intensity = I0[i]; }); U.panel.visible = true; U.glass.visible = true; N.pump(DT, 1, false);
    const pass = lights.length === 2 && lights.every((l) => l.type === 'PointLight' && !l.shadow && l.intensity > 0) && U.text === '地下' && U.plate.material.map && visible1F
      && Math.abs(on.ndc[0]) < 0.8 && Math.abs(on.ndc[1]) < 0.8 && on.mouth > on.around * 1.5 && on.mouth > off.mouth + 3;
    return { pass, lights, text: U.text, visible1F, on, off, signAt: S.basementSignPos && [+S.basementSignPos.x.toFixed(2), +S.basementSignPos.y.toFixed(2), +S.basementSignPos.z.toFixed(2)] };
  });

  quiet();
  S.applyStage(1);
  N.testResult = out;
  show();
  return out;
}
