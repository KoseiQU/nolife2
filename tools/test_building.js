// test_building.js — P3a 全館の外殻の決定的テスト(ブラウザ内)。http://localhost:8001/?test=building で自動実行。
// rAF に依存せず window.__N2.pump(dt, n) で本物のループと同じ順に進める。キーは keydown/keyup をペアで送る。
// 階の読み込みは非同期なので、読み込み待ちだけ await する。結果: window.__N2.testResult と画面左上の <pre>。
//  1) 読み分け: 居る階 ±1 だけ読み、離れた階は解放(4F→1F→7F→4F)。解放→再読み込みでも扉・覗き穴が壊れない
//  2) 各階の扉数(居室)= 図面の号室数。GLB の号室プレート・EV 扉・外階段の鉄扉が結び付いている
//  3) EV: 4F で呼ぶ→カゴが来て開く→歩いて乗る→7 を押す→7F で開く→歩いて降りる。閉じた扉は通れない
//  3c) P3b-A: 階数表示がカゴの現在地に追従(1→2→3→4、▲)。カゴの天井は常時点灯。管理人の EV 移動でも表示が動く
//  3d) P5b-3: EV で 1F→4F に乗って移動中(扉が閉まってから開くまで)、画面中央と四隅の平均輝度が出発時の ±15% 以内(毎フレーム)
//  4) 外階段: 4F の鉄扉→踊り場→上る(5F,6F,7F,屋上B)→屋上を歩く(落ちない)→下る(…→1F)。段の手前の当たりで階段へ踏み外さない
// 4b) P6b #5: 階段で着く位置 = 段の口の外・扉から約 1.0m・扉を向く、着いて 1.5 秒はヒントなし(外階段 1→RB→1・北階段・地下の全停留所)
//  5) 北階段(P3a-2: 屋外の鉄骨): 3F の鉄扉→屋外通路→3F→2F→1F の地面(小さな矩形から出ない)→2F→3F
//  5b) 地下への階段: 1F→B1 の踊り場→施錠扉(「鍵がかかっている」＋ガチャ音・開かない)→1F
//  9) 見学モード(?test=building&tour のときだけ): 管理人が scene に無い。P3b-3: 内装のない部屋(空室 73・物語の部屋 5)の扉は開かない
//     P5b-1: 空室 66 は開かない。入れる居室 35(220 を含む)と物語の扉 105・312・705・地下の鉄扉は開く(奥は別空間)
//     (「開ける」が出ない・E で「鍵がかかっている」)、内装のある部屋の扉は開く、地下の鉄扉は開かない
//  6) 1F 風除室: 内側の自動ドアは近づくと開く(P3c: 外側の正面玄関も開くようになった。外への出入りは 8 番)
//  8) P3c 外観と外環境: 読み込み前後の負荷・屋上A/屋上B/エントランス前から見える・屋内の奥では描かない・敷地の境で止まる・玄関の出入り
//  7) 管理人が別の階へ(EV/階段)移っても状態機械が破綻しない。読み込まれていない階でも論理が進み、描画はされない
//  11) P5b-3: 食堂のガラス扉・シアターの二重扉(前室)を E で開けて通る・段床を登る・管理人が 2 枚を抜けて来る
// 8c) P6b #12: 敷地の外周と車 3 台の周りを 0.25m 刻み × 16 方向に走って、敷地 'G' の外・1F の当たり・床の高さの異常に出ない(自転車置き場で 1F に化けていた)
//  10) P3c-2 廊下端の窓: 各窓の正面でガラスが透明・開口が抜けている・外を描く・窓越しに外が見える(画素の差)・1フレームの時間

const DT = 1 / 60;
const EXPECT_UNITS = { 1: 9, 2: 22, 3: 22, 4: 19, 5: 16, 6: 11, 7: 5 };

export async function run(N) {
  const out = { ok: true, cases: {} };
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:fixed;left:8px;top:8px;z-index:9;color:#9fe39f;background:rgba(0,0,0,.75);font:11px/1.35 monospace;padding:8px;max-width:46vw;max-height:94vh;overflow:auto;white-space:pre-wrap;';
  document.body.appendChild(pre);
  const show = () => { pre.textContent = JSON.stringify(out, null, 1); };
  const ONLY = new URLSearchParams(location.search).get('only');   // P5b-3: ?test=building&only=11 で番号の前方一致だけ走らせる(調整用)
  const T = async (name, fn) => {
    if (ONLY && !name.startsWith(ONLY)) return;
    try { const r = await fn(); out.cases[name] = r; if (!r.pass) out.ok = false; }
    catch (e) { out.cases[name] = { pass: false, error: String(e && e.stack || e) }; out.ok = false; }
    show();
  };
  const key = (code, down) => document.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
  const tap = (code, frames = 3) => { key(code, true); N.pump(DT, frames, false); key(code, false); N.pump(DT, 2, false); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const loadedSet = () => N.world.loadedLevels().join(',');
  async function settle(expect, ms = 15000) {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) { if (loadedSet() === expect) return true; await sleep(50); }
    return false;
  }
  const pos = () => ({ x: +N.player.pos.x.toFixed(2), y: +N.player.pos.y.toFixed(2), z: +N.player.pos.z.toFixed(2), level: N.level });
  if (N.tour) {
    // 見学モード(?test=building&tour): 管理人が scene に無い・AI が動かない。P3b-3: 扉は通常プレイと同じ
    //  (空室 407 は開かない＝「開ける」が出ず E で「鍵がかかっている」、入れる部屋 413 は開く、物語の部屋・地下の鉄扉は開かない)
    await T('9_tour_mode', async () => {
      const inScene = !!N.enemyObj.root.parent;
      const st0 = N.ai.stats();
      await N.teleport(4, 6.9, 13.05, Math.PI / 2); await settle('3,4,5');
      N.pump(DT, 120, false);
      const st1 = N.ai.stats();
      // a) 空室 407(西棟 東列・W 向き): 扉の前に立つ → 「開ける」が出ない → E → 「鍵がかかっている」・開かない
      const d = N.doorApi.get('407');
      N.setView(7.2, d.pos[1], -Math.PI / 2, 0); N.pump(DT, 2, false);
      const emptyHint = N.hudState().hint;
      tap('KeyE'); N.pump(DT, 30, false);
      const emptyToast = N.hudState().toast;
      const emptyOpened = N.doorApi.isOpen('407');
      // b) 入れる部屋 413(南棟・N 向き): 「開ける」→ E → 開く
      const d2 = N.doorApi.get('413');
      N.setView(d2.pos[0], d2.pos[1] - 0.7, Math.PI, 0); N.pump(DT, 2, false);
      const roomHint = N.hudState().hint;
      tap('KeyE'); N.pump(DT, 90, false);
      const roomOpened = N.doorApi.isOpen('413') && !!d2.node && d2.node.rotation.y !== 0;
      N.doorApi.close('413'); N.pump(DT, 90, false);
      // c) 全館: 開く扉 = 内装のある部屋(入れる部屋)だけ。空室・物語の部屋は開かない
      const bad = [];
      let units = 0, enter = 0, story = 0;
      for (const f of N.building.floors) {
        if (f.level > 7) continue;
        for (const r of f.rooms) {
          if (r.kind !== 'unit' && r.id !== 'OFFICE' && r.id !== 'KITCHEN') continue;
          const dd = N.doorApi.get(r.id);
          // P5b-1: 見学モードでは物語の扉(105・312・705。奥は別空間)も開く(DESIGN P5b-1「見学モードでは全ての解放を真にし、仮空間にも入れる」)
          const want = !!(r.door.enterable && r.interior) || ['105', '312', '705'].includes(r.id);
          if (r.kind === 'unit') { units++; if (r.door.enterable && r.interior) enter++; if (r.story) story++; }
          if (!dd || dd.operable !== want) bad.push(r.id);
        }
      }
      const b1 = N.doorApi.get('B1DOOR');
      const tag = document.getElementById('tourTag');
      const pass = !inScene && st0.state === 'SCRIPTED' && JSON.stringify(st0.pos) === JSON.stringify(st1.pos)
        && !emptyHint.includes('開ける') && emptyToast.includes('鍵がかかっている') && !emptyOpened
        && roomHint.includes('開ける') && roomOpened
        && bad.length === 0 && units === 104 && enter === 35 && story === 4
        && b1.operable && !!tag && tag.textContent === '見学モード';   // P5b-1: 入れる居室 26→35(221・220・6F の 7 室)、物語の部屋 5→4(221 は普通の部屋)、地下の鉄扉も見学では開く
      return { pass, enemyInScene: inScene, aiState: st0.state, aiMoved: JSON.stringify(st0.pos) !== JSON.stringify(st1.pos),
        empty407: { hint: emptyHint, toast: emptyToast, opened: emptyOpened }, room413: { hint: roomHint, opened: roomOpened },
        doors: { units, enterableUnits: enter, storyRooms: story, closedUnits: units - enter, mismatch: bad }, b1Operable: b1.operable, tag: tag && tag.textContent };
    });
    N.testResult = out;
    console.log('[test_building]', JSON.stringify(out));
    return out;
  }
  // 管理人を止める(階の移動テストの邪魔をしない)
  N.ai.setState('SCRIPTED', { force: true });
  N.enemy.place(6.9, 19.0, Math.PI);

  await T('1_load_unload', async () => {
    const log = [];
    const s0 = await settle('3,4,5'); log.push(['4F', loadedSet()]);
    const geo0 = N.renderer.info.memory.geometries;
    await N.teleport(1, 6.9, 19.0, 0); const s1 = await settle('1,2'); log.push(['1F', loadedSet()]);
    await N.teleport(7, 10.0, 21.2, Math.PI / 2); const s2 = await settle('6,7'); log.push(['7F', loadedSet()]);
    N.pump(DT, 3, true);
    const geo7 = N.renderer.info.memory.geometries;
    await N.teleport(4, 6.9, 7.6, Math.PI); const s3 = await settle('3,4,5'); log.push(['4F', loadedSet()]);
    N.pump(DT, 3, true);
    const d410 = N.doorApi.get('410');
    const scopeOk = !!(N.doorScope && N.doorScope.parent === d410.node);
    const vis = N.world.loadedLevels().map((l) => [l, N.world.floors.get(l).group.parent === N.scene]);
    return { pass: s0 && s1 && s2 && s3 && !!d410.node && scopeOk && vis.find(([l]) => l === 4)[1] && !vis.find(([l]) => l === 5)[1], log, geometries: { at4F: geo0, at7F: geo7 }, door410Bound: !!d410.node, scopeReattached: scopeOk, visible: vis };
  });

  await T('2_door_counts', async () => {
    const res = {};
    let pass = true;
    for (let lv = 1; lv <= 7; lv++) {
      const units = N.building.floors.find((f) => f.level === lv).rooms.filter((r) => r.kind === 'unit').length;
      const glbDoors = N.manifests[lv].doors.filter((d) => d.kind === 'unit').length;
      const states = N.world.doors.filter((d) => d.level === lv && d.unit).length;
      res[lv] = { plan: EXPECT_UNITS[lv], data: units, glb: glbDoors, state: states };
      if (!(units === EXPECT_UNITS[lv] && glbDoors === units && states === units)) pass = false;
    }
    const total = Object.values(res).reduce((s, r) => s + r.glb, 0);
    return { pass: pass && total === 104, total, perFloor: res };
  });

  await T('3_elevator_ride', async () => {
    await N.teleport(4, 6.9, 21.0, Math.PI); await settle('3,4,5');
    const ev = N.elevator;
    const steps = [];
    // 扉が閉まっている間は入れない
    N.setView(7.1, 21.8, Math.PI, 0); key('KeyW', true); N.pump(DT, 60, false); key('KeyW', false); N.pump(DT, 2, false);
    const blockedZ = N.player.pos.z;
    // 呼びボタンを見て E
    const p = N.hud.evPanel;
    N.setView(p.x - 0.18, p.z - 0.9, Math.atan2(-(p.x - (p.x - 0.18)), -(p.z - (p.z - 0.9))), 0); N.pump(DT, 2, false);
    const hint = N.hudState().hint;
    tap('KeyE');
    steps.push(['call', ev.state(), N.hudState().toast]);
    let t = 0;
    while (!(ev.car.level === 4 && ev.car.state === 'open') && t < 30) { N.pump(DT, 1, false); t += DT; }
    steps.push(['arrived4', ev.state(), +t.toFixed(1)]);
    // 歩いてカゴへ
    N.setView(7.1, 21.6, Math.PI, 0); key('KeyW', true); N.pump(DT, 75, false); key('KeyW', false); N.pump(DT, 2, false);
    const inCar = ev.inCar(N.player.pos.x, N.player.pos.z, 4);
    steps.push(['inCar', pos()]);
    // 行き先ボタン(視線の先)を見て E: ボタンの位置を向く
    const b7 = N.manifests[4].evButtons.find((b) => b.floor === 7);
    N.setView(N.player.pos.x, N.player.pos.z, 0, 0);
    const cam = N.camera.position;
    const dx = b7.pos[0] - cam.x, dy = b7.pos[1] - cam.y, dz = b7.pos[2] - cam.z;
    N.setView(N.player.pos.x, N.player.pos.z, Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
    N.pump(DT, 2, false);
    const btnHint = N.hudState().hint;
    tap('KeyE');
    t = 0;
    let rodeY0 = N.player.pos.y;
    for (let i = 0; !(ev.car.level === 7 && ev.car.state === 'open') && t < 40; i++) { N.pump(DT, 1, false); t += DT; if (i % 30 === 0) await sleep(5); }
    steps.push(['arrived7', ev.state(), pos(), +t.toFixed(1)]);
    const at7 = N.level === 7 && Math.abs(N.player.pos.y - 6 * 2.9) < 1e-3;
    await settle('6,7');
    // 降りる
    N.setView(N.player.pos.x, N.player.pos.z, 0, 0); key('KeyW', true); N.pump(DT, 90, false); key('KeyW', false); N.pump(DT, 2, false);
    const out7 = N.player.pos.z < 22.0 && N.level === 7;
    steps.push(['out7', pos()]);
    // 7F の廊下にいる(壁抜けしていない)
    const pass = blockedZ < 22.1 && hint.includes('呼ぶ') && inCar && btnHint.includes('7') && at7 && out7 && Math.abs(rodeY0 - 3 * 2.9) < 1e-3;
    return { pass, blockedZ: +blockedZ.toFixed(2), hallHint: hint, buttonHint: btnHint, steps };
  });

  await T('3b_ev_button_5', async () => {
    // 4F でカゴに乗り、視線の先の「5」のボタンで E → 5F に着く(ボタンの見た目の位置と判定の対応)
    await N.teleport(4, 7.1, 21.6, Math.PI); await settle('3,4,5');
    const ev = N.elevator;
    ev.call(4);
    let t = 0;
    while (!(ev.car.level === 4 && ev.car.state === 'open') && t < 30) { N.pump(DT, 1, false); t += DT; }
    key('KeyW', true); N.pump(DT, 75, false); key('KeyW', false); N.pump(DT, 2, false);
    const b5 = N.manifests[4].evButtons.find((b) => b.floor === 5);
    N.setView(N.player.pos.x, N.player.pos.z, 0, 0);
    const c = N.camera.position, dx = b5.pos[0] - c.x, dy = b5.pos[1] - c.y, dz = b5.pos[2] - c.z;
    N.setView(N.player.pos.x, N.player.pos.z, Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))); N.pump(DT, 2, false);
    const hint = N.hudState().hint;
    tap('KeyE');
    t = 0;
    for (let i = 0; !(ev.car.level === 5 && ev.car.state === 'open') && t < 30; i++) { N.pump(DT, 1, false); t += DT; if (i % 30 === 0) await sleep(5); }
    return { pass: hint.includes('5階') && N.level === 5 && ev.car.level === 5, hint, level: N.level, sec: +t.toFixed(1) };
  });

  await T('3c_ev_display_follows_car', async () => {
    // P3b-A(DESIGN §2.2): ホールの呼びパネル・カゴの操作盤の階数表示はカゴの現在地。移動中は通過階ごとに切り替わり ▲▼ が点く。
    // 管理人が EV で移動する時も同じカゴが動いて表示が変わる
    const ev = N.elevator;
    const dedupe = (a) => a.filter((v, i) => i === 0 || v !== a[i - 1]);
    await N.teleport(4, 6.9, 20.6, Math.PI); await settle('3,4,5');
    Object.assign(ev.car, { level: 1, state: 'idle', open: 0, pending: [], riding: false, to: null });
    N.pump(DT, 2, false);
    const n0 = ev.shownLog.length;
    const tex = ev._displayTextures();
    const off = () => tex.map((t) => [+(t.offset.x * 8 + 1).toFixed(3), +(t.offset.y * 3).toFixed(3)]);
    const startTex = off();
    ev.call(4);
    let t = 0;
    while (!(ev.car.level === 4 && ev.car.state === 'open') && t < 30) { N.pump(DT, 1, false); t += DT; }
    const seq1 = ev.shownLog.slice(n0);
    const floors1 = dedupe(seq1.map((s) => s.floor));
    const arrows1 = seq1.filter((s) => s.floor < 4).every((s) => s.dir === 1) && seq1[seq1.length - 1].dir === 0;
    const endTex = off();
    // カゴの天井は常時点灯(扉が閉じて待機していても、カゴのいる階では発光)
    while (ev.car.state !== 'idle' && t < 60) { N.pump(DT, 1, false); t += DT; }
    const ceil = [...N.world.floors.get(4).mats].find((m) => m.name === 'M_CarCeiling');
    const ceilingLitIdle = ev.car.state === 'idle' && ceil && ceil.emissiveIntensity > 0;
    // 管理人: 2F から 6F へ(EV を使う)。カゴは 4F→2F へ迎えに行き、2F→6F へ
    const ai = N.ai;
    ai.reset(6.9, 20.9, Math.PI, 2);
    const ev0 = ai.events.length;
    const n1 = ev.shownLog.length;
    ai.lastKnown = { x: 12.0, z: 21.2, lv: 6 };
    ai.setState('ALERT', { force: true, log: true, react: false });
    let t2 = 0;
    while (t2 < 150) { N.pump(DT, 1, false); t2 += DT; if (ai.level === 6 && !ai.transit && ai.events.slice(ev0).some((e) => e.ev === 'transfer_end')) break; }
    const seq2 = ev.shownLog.slice(n1);
    const floors2 = dedupe(seq2.map((s) => s.floor));
    const evs = ai.events.slice(ev0).filter((e) => /transfer|ev_/.test(e.ev)).map((e) => `${e.ev}:${e.via || ''}${e.phase || ''}`);
    const npcRode = ev.events.some((e) => e.ev === 'npc_select' && e.to === 6);
    const want2 = [4, 3, 2, 3, 4, 5, 6];
    const sub = (a, b) => { let i = 0; for (const v of a) if (v === b[i]) i++; return i === b.length; };
    ai.reset(N.ENEMY_HOME.x, N.ENEMY_HOME.z, N.ENEMY_HOME.yaw, 4);
    ai.setState('SCRIPTED', { force: true });
    N.enemy.place(6.9, 19.0, Math.PI);
    const pass = floors1.join(',') === '1,2,3,4' && arrows1 && startTex.every(([f]) => f === 1) && endTex.every(([f, r]) => f === 4 && r === 0)
      && ceilingLitIdle && sub(floors2, want2) && floors2[floors2.length - 1] === 6 && npcRode && ai.level === 4 && evs.some((e) => e.startsWith('transfer_end:ev'));
    return { pass, call4: { floors: floors1, arrowsUpWhileMoving: arrows1, texStart: startTex, texEnd: endTex, sec: +t.toFixed(1) }, ceilingLitIdle,
      managerRide2to6: { floors: floors2, npcRode, events: evs, sec: +t2.toFixed(1) } };
  });

  await T('3d_ev_ride_no_blackout', async () => {
    // P5b-3(DESIGN §2 ④): EV で 1F→4F に乗って移動している間(扉が閉まってから開き始めるまで)、画面中央と四隅の平均輝度が
    // 出発時(扉が閉まり切った最初のフレーム)の ±15% 以内(毎フレーム)。旧: 出発階が解放されて移動中は何も描かれなかった
    const ev = N.elevator;
    const g = ev.rooms[1].geom;
    await N.teleport(1, g.center[0], g.center[1] + 0.2, Math.PI, -0.05); await settle('1,2');   // カゴの奥の壁を向く
    N.pump(DT, 30, false);
    Object.assign(ev.car, { level: 1, state: 'idle', open: 0, hold: 0, pending: [], riding: false, to: null });
    N.pump(DT, 4, false);
    const gl = N.renderer.getContext();
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, S = 24;
    const px = new Uint8Array(4 * S * S);
    const pts = [[0.5, 0.5], [0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]];
    const lum = () => pts.map(([u, v]) => {
      gl.readPixels(Math.floor(u * W) - S / 2, Math.floor(v * H) - S / 2, S, S, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let s = 0; for (let i = 0; i < px.length; i += 4) s += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      return s / (S * S);
    });
    const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    ev.select(4);
    let base = null, worst = 0, worstAt = null, frames = 0, t = 0;
    const lv0 = [];
    while (t < 40) {
      N.pump(DT, 1, true);
      t += DT;
      const st = ev.car.state;
      if (st === 'opening' || st === 'open') break;
      if (st === 'idle' || st === 'closing') continue;     // まだ扉が開いている/閉まりかけ
      const L = lum();
      if (!base) base = L;
      frames++;
      for (let i = 0; i < 5; i++) {
        const r = Math.abs(L[i] - base[i]) / Math.max(base[i], 1);
        if (r > worst) { worst = r; worstAt = { frame: frames, i, base: +base[i].toFixed(1), now: +L[i].toFixed(1), state: st, level: N.level, loaded: N.world.loadedLevels().join(',') }; }
      }
      if (frames % 20 === 1) lv0.push(N.world.loadedLevels().join(','));
      if (N.world.loadedLevels().indexOf(4) < 0) await sleep(0);   // 行き先の読み込みを進める
    }
    const arrived = N.level === 4 && ev.car.level === 4;
    const pass = arrived && !!base && frames > 200 && worst <= 0.15 && avg(base) > 20;
    return { pass, arrived, frames, base: base && base.map((v) => +v.toFixed(1)), worstRatio: +worst.toFixed(3), worstAt, loadedDuringRide: [...new Set(lv0)] };
  });

  // 外階段の口に立って段の方を向き W(上り下りが終わるまで)
  async function climb(dir) {
    const g = N.building.stairs.find((s) => s.id === 'main').geom;
    const lane = dir === 'up' ? g.lanes.up : g.lanes.down;
    const from = N.level;
    N.setView((lane[0] + lane[1]) / 2, g.s0 - 0.3, Math.PI, 0);
    N.pump(DT, 1, false);
    key('KeyW', true);
    let t = 0;
    while (N.level === from && t < 20) { N.pump(DT, 1, false); t += DT; }
    key('KeyW', false); N.pump(DT, 2, false);
    for (let i = 0; i < 100 && N.world.loadedLevels().indexOf(typeof N.level === 'number' ? N.level : 7) < 0; i++) await sleep(50);
    return { from, to: N.level, sec: +t.toFixed(1), y: +N.player.pos.y.toFixed(2) };
  }

  await T('4_outer_stairs', async () => {
    await N.teleport(4, 6.9, 21.2, Math.PI / 2); await settle('3,4,5');
    // 鉄扉を E で開け、踊り場へ歩いて出る
    N.setView(6.5, 21.2, Math.PI / 2, 0); N.pump(DT, 2, false);
    const hint = N.hudState().hint;
    tap('KeyE'); N.pump(DT, 60, false);
    const doorOpen = N.doorApi.isOpen('MST4');
    key('KeyW', true); N.pump(DT, 70, false); key('KeyW', false); N.pump(DT, 2, false);
    const onLanding = N.player.pos.x < 6.0;
    // 段の手前の当たり: レーンの間で南へ進んでも段の方へ出ない
    N.setView(4.3, 21.3, Math.PI, 0); key('KeyW', true); N.pump(DT, 90, false); key('KeyW', false); N.pump(DT, 2, false);
    const guardZ = N.player.pos.z, guardLevel = N.level;
    const ups = [];
    for (let i = 0; i < 4; i++) ups.push(await climb('up'));       // 5,6,7,RB
    // 屋上を歩く(東へ 6 秒、南へ 8 秒。外周のパラペットで止まる)
    N.setView(5.2, 21.0, -Math.PI / 2, 0); key('KeyW', true); N.pump(DT, 360, false); key('KeyW', false);
    const roofX = N.player.pos.x;
    N.setView(N.player.pos.x, 21.0, Math.PI, 0); key('KeyW', true); N.pump(DT, 480, false); key('KeyW', false); N.pump(DT, 2, false);
    const roofP = pos();
    const R = N.building.roofB;
    const inside = R.footprint.some(([x, z, w, d]) => roofP.x > x && roofP.x < x + w && roofP.z > z && roofP.z < z + d);
    const downs = [];
    for (let i = 0; i < 7; i++) downs.push(await climb('down'));   // RB→7→…→1
    const pass = hint.includes('開ける') && doorOpen && onLanding && guardZ < 22.06 && guardLevel === 4
      && ups.map((u) => u.to).join(',') === '5,6,7,RB' && Math.abs(ups[3].y - 7 * 2.9) < 1e-3
      && roofX > 9.0 && inside && Math.abs(roofP.y - 7 * 2.9) < 1e-3
      && downs.map((d) => d.to).join(',') === '7,6,5,4,3,2,1' && Math.abs(N.player.pos.y) < 1e-3;
    return { pass, doorHint: hint, doorOpen, onLanding, guard: { z: +guardZ.toFixed(2), level: guardLevel }, ups, roof: { eastX: +roofX.toFixed(2), end: roofP, insideFootprint: inside }, downs };
  });

  // 階段の口に立って段の方を向き W(上り下りが終わるまで)。st = building.stairs の要素(axis x: 流れは +x)
  async function stairGo(id, dir) {
    const st = N.building.stairs.find((s) => s.id === id);
    const g = st.geom;
    const lane = dir === 'up' ? g.lanes.up : g.lanes.down;
    const from = N.level;
    N.setView(g.s0 - 0.3, (lane[0] + lane[1]) / 2, -Math.PI / 2, 0); N.pump(DT, 1, false);
    const hint = N.hudState().hint;
    key('KeyW', true); let t = 0;
    while (N.level === from && t < 20) { N.pump(DT, 1, false); t += DT; }
    key('KeyW', false); N.pump(DT, 2, false);
    for (let i = 0; i < 100 && N.world.loadedLevels().indexOf(N.level === 'B1' ? 1 : N.level) < 0; i++) await sleep(50);
    return { from, to: N.level, y: +N.player.pos.y.toFixed(2), x: +N.player.pos.x.toFixed(2), z: +N.player.pos.z.toFixed(2), hint };
  }
  const walk = (yaw, frames, x = N.player.pos.x, z = N.player.pos.z) => { N.setView(x, z, yaw, 0); key('KeyW', true); N.pump(DT, frames, false); key('KeyW', false); N.pump(DT, 2, false); return pos(); };

  // P6b #5: 着いた位置 = 段の口の外・扉寄り(扉から約 1.0m・扉を向く)、着いて 1.5 秒は段のヒントを出さない。外階段 1→RB→1・北階段 3→1→3・地下 1→B1→1 の全停留所
  await T('4b_stair_arrival_near_door_no_hint', async () => {
    const S = N.stairs;
    const arrive = async (id, dir) => {
      const st = N.building.stairs.find((s) => s.id === id), g = st.geom;
      const lane = dir === 'up' ? g.lanes.up : g.lanes.down;
      const from = N.level;
      if (g.axis === 'x') N.setView(g.s0 - 0.3, (lane[0] + lane[1]) / 2, -Math.PI / 2, 0); else N.setView((lane[0] + lane[1]) / 2, g.s0 - 0.3, Math.PI, 0);
      N.pump(DT, 1, false);
      key('KeyW', true); let t = 0;
      while (S.busy || N.level === from) { N.pump(DT, 1, false); t += DT; if (t > 25) break; }
      key('KeyW', false);
      N.pump(DT, 1, false);
      const p = N.player.pos, yaw = N.player.object.rotation.y, a = S.lastArrive || {};
      const D = a.door || st.door;
      const want = Math.atan2(-(D[0] - p.x), -(D[1] - p.z));
      let dyaw = want - yaw; while (dyaw > Math.PI) dyaw -= 2 * Math.PI; while (dyaw < -Math.PI) dyaw += 2 * Math.PI;
      const r = 0.28, cols = (N.world.collisions(N.level) || []).filter((c) => !c.disabled && c.kind !== 'door' && p.x + r > c.minX && p.x - r < c.maxX && p.z + r > c.minZ && p.z - r < c.maxZ);
      const hud0 = N.hudState(), m0 = S.mouth(p.x, p.z, N.level);
      N.pump(DT, 60, false); const hud1 = N.hudState();
      N.pump(DT, 40, false); const hud2 = N.hudState();
      for (let i = 0; i < 100 && N.world.loadedLevels().indexOf(N.level === 'B1' ? 1 : N.level === 'RB' ? 7 : N.level) < 0; i++) await sleep(50);
      const stairHint = (h) => h.kind === 'stair' || /の階へ|屋上へ|地下へ/.test(h.hint);
      return { id, from, to: N.level, x: +p.x.toFixed(2), z: +p.z.toFixed(2), door: D, dist: +Math.hypot(D[0] - p.x, D[1] - p.z).toFixed(2), faceDeg: +(Math.abs(dyaw) * 180 / Math.PI).toFixed(1),
        inMouth: !!m0, inSolid: cols.length, hint0: stairHint(hud0), hint1: stairHint(hud1), hint2: stairHint(hud2), quiet0: +S.quiet.toFixed(2) };
    };
    await N.teleport(1, 4.6, 20.85, 0); await settle('1,2');
    const main = [];
    for (let i = 0; i < 7; i++) main.push(await arrive('main', 'up'));     // 1→2→…→7→RB
    for (let i = 0; i < 7; i++) main.push(await arrive('main', 'down'));   // RB→7→…→1
    await N.teleport(3, 14.0, 2.2, -Math.PI / 2); await settle('2,3,4');
    const north = [await arrive('north', 'down'), await arrive('north', 'down'), await arrive('north', 'up'), await arrive('north', 'up')];
    await N.teleport(1, 8.3, 1.45, -Math.PI / 2); await settle('1,2');
    const base = [await arrive('basement', 'down'), await arrive('basement', 'up')];
    const all = [...main, ...north, ...base];
    const ok = (a) => !a.inMouth && a.inSolid === 0 && !a.hint0 && !a.hint1 && !a.hint2 && a.faceDeg < 5;
    const pass = main.map((a) => a.to).join(',') === '2,3,4,5,6,7,RB,7,6,5,4,3,2,1' && north.map((a) => a.to).join(',') === '2,1,2,3' && base.map((a) => a.to).join(',') === 'B1,1'
      && all.every(ok) && main.every((a) => a.dist <= 1.2 && a.dist >= 0.8) && base.every((a) => a.dist <= 1.2);
    return { pass, main, north, base, bad: all.filter((a) => !ok(a)) };
  });

  await T('5_north_stairs', async () => {
    // P3a-2: 北階段は屋外の鉄骨。3F の縦廊下の北端の鉄扉→屋外通路→踊り場→3F→2F→1F の地面(建物へは戻れない)→2F→3F
    await N.teleport(3, 6.9, 0.725, -Math.PI / 2); await settle('2,3,4');
    N.pump(DT, 2, false);
    const doorHint = N.hudState().hint;
    tap('KeyE'); N.pump(DT, 60, false);
    const doorOpen = N.doorApi.isOpen('NST3');
    const through = walk(-Math.PI / 2, 80, 6.9, 0.725);            // 鉄扉を抜けて屋外通路へ
    // 通路を東へ(南寄り=上りレーンの線を歩く。3F は最上階なので上りの口は無く、下りの口を踏まない)、段の手前の当たりで止まる
    const gallery = walk(-Math.PI / 2, 360, through.x, 2.2);
    const st = N.building.stairs.find((s) => s.id === 'north');
    const onLanding = through.x > 7.9 && gallery.x > st.pos[0] && gallery.x < st.geom.s0 + 0.35 && gallery.level === 3 && Math.abs(gallery.y - 5.8) < 1e-3;
    const d1 = await stairGo('north', 'down');
    const d2 = await stairGo('north', 'down');
    const ground = pos();
    // 地面: 西(建物の壁)・北/南(柵)・東(段の下)へ歩いても小さな矩形から出ない
    const w = walk(Math.PI / 2, 120);
    const e = walk(-Math.PI / 2, 180, 14.6, 1.45);
    const n = walk(0, 120, 14.6, 1.45);
    const so = walk(Math.PI, 120, 14.6, 1.45);
    const inGround = [w, e, n, so].every((p) => p.level === 1 && p.x > st.pos[0] && p.x < st.geom.s0 + 0.35 && p.z > 0 && p.z < 2.9 && Math.abs(p.y) < 1e-3);
    const u1 = await stairGo('north', 'up');
    const u2 = await stairGo('north', 'up');
    const noDoor1F = !N.doorApi.get('NST1');
    const pass = doorHint.includes('開ける') && doorOpen && onLanding && d1.to === 2 && d2.to === 1 && Math.abs(ground.y) < 1e-3
      && ground.x > st.pos[0] && inGround && u1.to === 2 && u2.to === 3 && noDoor1F && Math.abs(N.player.pos.y - 2 * 2.9) < 1e-3;
    return { pass, doorHint, doorOpen, gallery, moves: [d1, d2, u1, u2].map((m) => `${m.from}->${m.to} y=${m.y}`), ground, groundWalls: { w, e, n, so }, noDoor1F };
  });

  await T('5b_basement_stairs', async () => {
    // P3a-2: 1F 食堂奥(北の通路)→地下への階段の踊り場→下る→B1 の踊り場→施錠された鉄扉(開かない・「鍵がかかっている」＋ガチャ音)→上って 1F
    await N.teleport(1, 6.9, 1.45, -Math.PI / 2); await settle('1,2');
    const landing = walk(-Math.PI / 2, 60, 6.9, 1.45);
    const down = await stairGo('basement', 'down');
    const atB1 = N.level === 'B1' && Math.abs(N.player.pos.y + 2.9) < 1e-3;
    const door = N.doorApi.get('B1DOOR');
    N.setView(8.75, 1.45, Math.PI / 2, 0); N.pump(DT, 2, false);
    const hint = N.hudState().hint;
    N.enemyAudio.log.length = 0;   // (ログは 200 件で頭から捨てるので、件数の差では数えない)
    tap('KeyE'); N.pump(DT, 30, false);
    const toast = N.hudState().toast;
    const rattle = N.enemyAudio.log.some((l) => l.name === 'rattle');
    const stillClosed = !N.doorApi.isOpen('B1DOOR') && door.angle === 0 && !door.collision.disabled;
    const push = walk(Math.PI / 2, 120, 8.75, 1.45);                // 扉へ向かって歩いても抜けない
    const blocked = push.x > 7.8 + 0.2 && push.level === 'B1';
    const up = await stairGo('basement', 'up');
    const pass = landing.x > 7.9 && down.to === 'B1' && down.hint.includes('地下') && atB1 && hint.includes('開ける') && toast.includes('鍵がかかっている')
      && rattle && stillClosed && blocked && up.to === 1 && Math.abs(N.player.pos.y) < 1e-3;
    return { pass, landing, down, b1: { atB1, doorHint: hint, toast, rattle, stillClosed, push }, up };
  });

  await T('6_entrance_autodoors', async () => {
    await N.teleport(1, 17.6, 22.9, Math.PI); await settle('1,2');
    N.pump(DT, 2, false);
    const before = N.doorApi.get('ENTRANCE').open01;
    key('KeyW', true);
    let opened = 0;
    for (let i = 0; i < 180; i++) { N.pump(DT, 1, false); opened = Math.max(opened, N.doorApi.get('ENTRANCE').open01); }
    key('KeyW', false); N.pump(DT, 2, false);
    const z = N.player.pos.z;
    N.setView(17.6, 23.0, Math.PI, 0); N.pump(DT, 120, false);
    const closedAgain = N.doorApi.get('ENTRANCE').open01;
    // P3c: 外側(正面玄関)も近づくと開き、敷地 'G' へ出られる(出入りは 8 番で検査)。ここでは内側の自動ドアと、離れたら両方閉じることを見る
    const outerClosed = N.doorApi.get('ENTRANCE_OUT').open01;
    return { pass: before === 0 && z > 25.6 && opened > 0.85 && closedAgain === 0 && outerClosed === 0, before, openedWhenNear: +opened.toFixed(2), reachedZ: +z.toFixed(2), closedAfterLeaving: closedAgain, outerClosedAfterLeaving: outerClosed };
  });

  await T('7_enemy_other_levels', async () => {
    await N.teleport(7, 10.0, 21.2, Math.PI / 2); await settle('6,7');
    const ai = N.ai;
    ai.reset(6.9, 19.0, Math.PI, 4);       // 管理人は 4F(読み込まれていない)
    const ev0 = ai.events.length;
    ai.setState('LURK', { force: true, log: true, spot: 'L2_ev_blind' });   // 2F の EV ホールへ潜みに行く
    let t = 0, visibleWhileAway = 0, maxLevelSeen = [];
    const seen = new Set([ai.level]);
    while (t < 120) {
      N.pump(DT, 1, false); t += DT;
      seen.add(ai.level);
      if (N.enemyObj.root.visible) visibleWhileAway++;
      if (ai.events.slice(ev0).some((e) => e.ev === 'lurk_stand')) break;
    }
    const evs = ai.events.slice(ev0).map((e) => e.ev);
    const st = ai.stats();
    maxLevelSeen = [...seen];
    // 次に 7F(プレイヤーの階)へ追わせる: 物音ではなく直接 ALERT で 7F の廊下へ
    ai.lastKnown = { x: 12.0, z: 21.2, lv: 7 };
    ai.setState('ALERT', { force: true, log: true, react: false });
    let t2 = 0, arrived7 = false;
    while (t2 < 90) { N.pump(DT, 1, false); t2 += DT; if (ai.level === 7 && !ai.transit) { arrived7 = true; break; } }
    const vis7 = N.enemyObj.root.visible;
    const pass = st.level === 2 && evs.includes('transfer_start') && evs.includes('transfer_end') && evs.includes('lurk_stand') && !evs.includes('stuck')
      && visibleWhileAway === 0 && arrived7 && vis7;
    ai.reset(N.ENEMY_HOME.x, N.ENEMY_HOME.z, N.ENEMY_HOME.yaw, 4);
    ai.setState('SCRIPTED', { force: true });
    return { pass, reachedLurkAt_s: +t.toFixed(1), lurkLevel: st.level, levelsPassed: maxLevelSeen, framesVisibleWhileOnOtherLevel: visibleWhileAway, events: evs.filter((e) => /transfer|lurk|stuck|door_opened_generic/.test(e)).slice(0, 12), chaseTo7F: { arrived: arrived7, sec: +t2.toFixed(1), visibleOn7F: vis7 } };
  });

  // 8) P3c: 外観と外環境。a) 読み込み前後の1フレームの時間(同じ構図) b) 屋上A・屋上B・エントランス前から外が見える(scene にあり、
  //    外を出した時と隠した時で画が変わる)・屋内の奥(廊下の途中)では描かない c) 敷地の境(柵・擁壁・生垣・門・建物の外壁)で止まる
  //    d) 正面玄関の外側の自動ドアが開き、1F ⇔ 敷地 'G' を行き来できる
  await T('8_exterior', async () => {
    const gl = N.renderer.getContext();
    const px1 = new Uint8Array(4);
    // P5a 監査: 1 回 40 フレームの中央値は内蔵ブラウザで ±5ms 揺れる(P5a 前の 34fec7c でも同じ窓が 13〜19ms。docs/p5a/NOTES.md §8)。
    //  40 フレームの中央値を 3 回取り、一番小さいものを記録する(一時的な GC・裏の処理の影響を除く)
    const frameMs = (n = 40, reps = 3) => {
      let best = Infinity;
      for (let r = 0; r < reps; r++) {
        const ts = [];
        for (let i = 0; i < n; i++) { const a = performance.now(); N.step(DT); N.render(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px1); ts.push(performance.now() - a); }
        ts.sort((a, b) => a - b); best = Math.min(best, ts[ts.length >> 1]);
      }
      return +best.toFixed(2);
    };
    const V = {
      roofA: [4, 2.0, 2.5, 2.356, 0.1, '3,4,5'],
      roofB: ['RB', 14.0, 24.0, -Math.PI / 2, 0.0, '6,7'],
      entrance: ['G', N.building.site.spawn[0], N.building.site.spawn[1], Math.PI, 0.05, '1,2'],   // エントランス前から外(南の森・車路)
      entranceUp: ['G', N.building.site.spawn[0], 34.2, 0, 0.5, '1,2'],                              // エントランス前から建物を見上げる(3F 以上は外観の帯)
      corridor: [4, 6.9, 12.0, Math.PI, 0, '3,4,5'],
    };
    const go = async ([k, x, z, yaw, pitch, lv]) => { await N.teleport(k, x, z, yaw, pitch); await settle(lv); N.pump(DT, 30, false); };
    N.setRenderSize(1920, 1080);
    // a) 読み込み前
    const before = {};
    for (const k of ['roofB', 'entrance']) { await go(V[k]); frameMs(8); before[k] = frameMs(); }
    const t0 = performance.now();
    await N.loadExterior();
    const loadMs = Math.round(performance.now() - t0);
    const after = {};
    for (const k of ['roofB', 'entrance']) { await go(V[k]); frameMs(8); after[k] = frameMs(); }
    const fpsOk = Object.keys(before).every((k) => after[k] <= Math.max(16.7, before[k] * 1.5));
    // b) 見えるか: 外を出した画と隠した画の差(320×180)
    N.setRenderSize(320, 180);
    const buf = new Uint8Array(320 * 180 * 4), buf2 = new Uint8Array(320 * 180 * 4);
    const grab = (b) => { N.render(); gl.readPixels(0, 0, 320, 180, gl.RGBA, gl.UNSIGNED_BYTE, b); };
    const grain0 = N.passes.grain.uniforms.grain.value;
    N.passes.grain.uniforms.grain.value = 0;   // フィルム粒子は毎フレーム変わるので、画の比較の間だけ切る
    const vis = {};
    for (const k of ['roofA', 'roofB', 'entrance', 'entranceUp', 'corridor']) {
      await go(V[k]);
      const shown = N.exterior.shown;
      const inScene = !!N.scene.getObjectByName('Exterior') && N.exterior.root.visible && N.exterior.terrain.parent === N.exterior.root;
      N.exterior.force = true; N.pump(DT, 1, false); grab(buf);
      N.exterior.force = false; N.pump(DT, 1, false); grab(buf2);
      N.exterior.force = null; N.pump(DT, 1, false);
      let diff = 0, changed = 0;
      for (let i = 0; i < buf.length; i += 4) { const d = Math.abs(buf[i] - buf2[i]) + Math.abs(buf[i + 1] - buf2[i + 1]) + Math.abs(buf[i + 2] - buf2[i + 2]); diff += d; if (d > 6) changed++; }
      vis[k] = { shown, inScene, changedPct: +(100 * changed / (320 * 180)).toFixed(1), meanDiff: +(diff / (320 * 180)).toFixed(2), bands: Object.entries(N.exterior.stats().bands).filter(([, v]) => v).map(([l]) => +l) };
    }
    N.passes.grain.uniforms.grain.value = grain0;
    N.setRenderSize(0);
    const visOk = ['roofA', 'roofB', 'entrance', 'entranceUp'].every((k) => vis[k].shown && vis[k].inScene && vis[k].changedPct > 5) && !vis.corridor.shown
      && [3, 4, 5, 6, 7].every((l) => vis.entranceUp.bands.includes(l));
    // c) 敷地の境で止まる(W を押し続ける)
    const B = N.building.site.bounds;
    const walks = {
      south: [B.W + 6, 31.5, Math.PI], east: [30.0, 30.0, -Math.PI / 2], west: [1.0, 31.0, Math.PI / 2],
      gate: [34.5, 31.0, Math.PI], building: [11.0, 31.0, 0], northWall: [28.5, 4.0, 0], courtyardFence: [16.0, 8.0, Math.PI / 2],
      underStairs: [4.3, 27.0, 0], pilotis: [24.0, 27.0, 0],
    };
    const walked = {};
    let walkOk = true;
    for (const [name, [x, z, yaw]] of Object.entries(walks)) {
      await N.teleport('G', x, z, yaw, 0);
      key('KeyW', true); N.pump(DT, 420, false); key('KeyW', false); N.pump(DT, 2, false);
      const p = pos();
      const inside = p.level === 'G' && p.x > B.W - 0.01 && p.x < B.E + 0.01 && p.z > B.N - 0.01 && p.z < B.S + 0.01;
      const fp = N.building.site.footprint.some(([fx, fz, fw, fd]) => p.x >= fx - 0.01 && p.x <= fx + fw + 0.01 && p.z >= fz - 0.01 && p.z <= fz + fd + 0.01);
      walked[name] = { ...p, inside: inside && fp };
      if (!(inside && fp)) walkOk = false;
    }
    // d) 1F の風除室 → 外側の自動ドア → 敷地 → 戻る
    // P3c-2: 最初は外側の自動ドアは施錠(反応しない)。近づいても開かず風除室に留まることを見てから、解錠して出る
    await N.teleport(1, 17.6, 26.6, Math.PI, 0); await settle('1,2');
    const lockedAtStart = !!N.doorApi.get('ENTRANCE_OUT').locked;
    key('KeyW', true); let openedLocked = 0;
    for (let i = 0; i < 120; i++) { N.pump(DT, 1, false); openedLocked = Math.max(openedLocked, N.doorApi.get('ENTRANCE_OUT').open01); }
    key('KeyW', false); N.pump(DT, 2, false);
    const stayed = pos();
    const lockOk = lockedAtStart && openedLocked === 0 && stayed.level === 1 && stayed.z < 29.0;
    N.doorApi.setLocked('ENTRANCE_OUT', false);
    await N.teleport(1, 17.6, 26.6, Math.PI, 0); N.pump(DT, 2, false);
    key('KeyW', true); let opened = 0;
    for (let i = 0; i < 240; i++) { N.pump(DT, 1, false); opened = Math.max(opened, N.doorApi.get('ENTRANCE_OUT').open01); }
    key('KeyW', false); N.pump(DT, 2, false);
    const out1 = pos();
    N.setView(N.player.pos.x, N.player.pos.z, 0, 0);
    key('KeyW', true); N.pump(DT, 260, false); key('KeyW', false); N.pump(DT, 2, false);
    const back = pos();
    const doorOk = lockOk && opened > 0.85 && out1.level === 'G' && out1.z > 29.0 && back.level === 1 && back.z < 28.0;
    N.doorApi.setLocked('ENTRANCE_OUT', true);
    return { pass: fpsOk && visOk && walkOk && doorOk, loadMs, frameMs: { before, after, rule: 'after ≤ max(16.7, before×1.5)' }, visible: vis, walked,
      door: { lockedAtStart, maxOpen01WhileLocked: +openedLocked.toFixed(2), stayedInside: stayed, maxOpen01: +opened.toFixed(2), out: out1, back } };
  });

  // 10) P3c-2 廊下端の窓(外が見えるガラス): 各階の shell.windows ごとに窓の正面(室内側 1.5m)に立つ →
  //  ア) 視線の先(窓の中心)の最初の面がガラス(MX_CorrGlass: 半透明 opacity < 0.3 または transmission)で、その奥 0.4m に自分の階の壁が無い(開口が抜けている)
  //  イ) 外観・外環境を描いている(exterior.shown)
  //  ウ) 外を出した画と隠した画で、窓の領域の画素が変わる(窓越しに外が見えている)
  //  エ) 1080p の1フレームの時間を記録(4F は ≤ 16.7ms)
  // P6b #12(駐車場で裏世界): 敷地の外周の内側と車 3 台の周りを 0.25m 刻みの起点にして、16 方向へ走って(0.5 秒)、敷地 'G' のまま・敷地の矩形の外へ出ない・床の高さ 0 を確かめる
  await T('8c_site_bruteforce_no_escape', async () => {
    const Sd = N.building.site, R = Sd.footprint;
    const inSite = (x, z, m = 0.0) => R.some(([rx, rz, rw, rd]) => x > rx - m && x < rx + rw + m && z > rz - m && z < rz + rd + m);
    const pts = [];
    for (const [rx, rz, rw, rd] of R) {
      for (let x = rx + 0.45; x <= rx + rw - 0.45 + 1e-6; x += 0.25) { pts.push([x, rz + 0.45]); pts.push([x, rz + rd - 0.45]); }
      for (let z = rz + 0.45; z <= rz + rd - 0.45 + 1e-6; z += 0.25) { pts.push([rx + 0.45, z]); pts.push([rx + rw - 0.45, z]); }
    }
    for (const c of Sd.cars) {
      const [cx, cz, cw, cd] = c.rect;
      for (let x = cx - 0.45; x <= cx + cw + 0.45 + 1e-6; x += 0.25) { pts.push([x, cz - 0.45]); pts.push([x, cz + cd + 0.45]); }
      for (let z = cz - 0.45; z <= cz + cd + 0.45 + 1e-6; z += 0.25) { pts.push([cx - 0.45, z]); pts.push([cx + cw + 0.45, z]); }
    }
    const cols = N.world.collisions('G');
    const free = (x, z) => inSite(x, z) && !cols.some((c) => !c.disabled && x + 0.29 > c.minX && x - 0.29 < c.maxX && z + 0.29 > c.minZ && z - 0.29 < c.maxZ);
    const starts = pts.filter(([x, z]) => free(x, z));
    const bad = []; let runs = 0;
    const fix0 = N.story.siteFix || 0;
    await N.teleport('G', starts[0][0], starts[0][1], 0); await settle('1,2');
    key('ShiftLeft', true);
    try {
      for (let i = 0; i < starts.length; i++) {
        const [x0, z0] = starts[i];
        for (let k = 0; k < 16; k++) {
          if (N.level !== 'G') await N.teleport('G', x0, z0, 0);
          N.player.setPose(x0, z0, k * Math.PI / 8, 0);
          key('KeyW', true);
          for (let f = 0; f < 30; f++) {
            N.pump(DT, 1, false);
            const p = N.player.pos;
            if (N.level !== 'G' || !inSite(p.x, p.z, 0.05) || Math.abs(p.y) > 1e-3) { bad.push({ from: [+x0.toFixed(2), +z0.toFixed(2)], dir: k, f, level: N.level, at: [+p.x.toFixed(2), +p.z.toFixed(2), +p.y.toFixed(3)] }); break; }
          }
          key('KeyW', false); N.pump(DT, 1, false); runs++;
        }
        if (i % 60 === 0) await sleep(0);
      }
    } finally { key('ShiftLeft', false); key('KeyW', false); }
    N.pump(DT, 2, false);
    const pass = starts.length > 800 && runs === starts.length * 16 && bad.length === 0;
    return { pass, starts: starts.length, runs, bad: bad.length, sample: bad.slice(0, 8), siteLevelFixes: (N.story.siteFix || 0) - fix0 };
  });

  await T('10_corridor_windows', async () => {
    const THREE = N.THREE;
    await N.loadExterior();
    const gl = N.renderer.getContext();
    const px1 = new Uint8Array(4);
    // P5a 監査: 1 回 40 フレームの中央値は内蔵ブラウザで ±5ms 揺れる(P5a 前の 34fec7c でも同じ窓が 13〜19ms。docs/p5a/NOTES.md §8)。
    //  40 フレームの中央値を 3 回取り、一番小さいものを記録する(一時的な GC・裏の処理の影響を除く)
    const frameMs = (n = 40, reps = 3) => {
      let best = Infinity;
      for (let r = 0; r < reps; r++) {
        const ts = [];
        for (let i = 0; i < n; i++) { const a = performance.now(); N.step(DT); N.render(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px1); ts.push(performance.now() - a); }
        ts.sort((a, b) => a - b); best = Math.min(best, ts[ts.length >> 1]);
      }
      return +best.toFixed(2);
    };
    const W = 320, H = 180;
    const buf = new Uint8Array(W * H * 4), buf2 = new Uint8Array(W * H * 4);
    const grab = (b) => { N.render(); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b); };
    const grain0 = N.passes.grain.uniforms.grain.value;
    const FACE = { W: [-1, 0], E: [1, 0], N: [0, -1], S: [0, 1] };
    const rc = new THREE.Raycaster();
    const res = {};
    let pass = true;
    for (const f of N.building.floors) {
      if (f.level > 7) continue;
      const L = f.level;
      for (let i = 0; i < f.shell.windows.length; i++) {
        const w = f.shell.windows[i];
        const [x, z] = w.pos, nin = FACE[w.facing];
        const yaw = Math.atan2(nin[0], nin[1]);       // 窓の方を向く(yaw 0 = −z)
        const sx = x + nin[0] * 1.5, sz = z + nin[1] * 1.5;
        await N.teleport(L, sx, sz, yaw, 0);
        await settle([L - 1, L, L + 1].filter((l) => l >= 1 && l <= 7).join(','));
        N.pump(DT, 30, false);
        const y0 = (L - 1) * 2.9 + w.sill, yc = y0 + w.h / 2;
        // ア) 窓の中心へのレイ(自分の階の GLB)
        const rec = N.world.floors.get(L);
        const eye = N.camera.getWorldPosition(new THREE.Vector3());
        const tgt = new THREE.Vector3(x, yc + 0.12, z);   // 横桟を避けて上のガラス
        rc.set(eye, tgt.clone().sub(eye).normalize()); rc.far = 6;
        const hits = rc.intersectObject(rec.group, true).filter((h) => h.object.visible);
        const first = hits[0];
        const gm = first && first.object.material;
        const glassOk = !!gm && gm.name === 'MX_CorrGlass' && (gm.opacity < 0.3 || gm.transmission > 0) && gm.side === THREE.DoubleSide;
        const dGlass = first ? first.distance : 0;
        const behind = hits.filter((h) => h.distance > dGlass + 0.02 && h.distance < dGlass + 0.4 && !/^(MX_Corr|M_Stainless)/.test(h.object.material.name)).map((h) => h.object.material.name);
        const holeOk = behind.length === 0;
        // イ) 外を描いているか
        N.exterior.force = null; N.pump(DT, 1, false);
        const shown = N.exterior.shown;
        // ウ) 窓の領域(画面への投影)で、外を出した画と隠した画の差
        N.setRenderSize(W, H);
        N.passes.grain.uniforms.grain.value = 0;
        N.exterior.force = true; N.pump(DT, 1, false); grab(buf);
        N.exterior.force = false; N.pump(DT, 1, false); grab(buf2);
        N.exterior.force = null; N.pump(DT, 1, false);
        N.passes.grain.uniforms.grain.value = grain0;
        const hw = w.w / 2;
        const corners = nin[1] !== 0 ? [[x - hw, y0, z], [x + hw, y0, z], [x - hw, y0 + w.h, z], [x + hw, y0 + w.h, z]] : [[x, y0, z - hw], [x, y0, z + hw], [x, y0 + w.h, z - hw], [x, y0 + w.h, z + hw]];
        let u0 = W, u1 = 0, v0 = H, v1 = 0;
        for (const c of corners) {
          const p = new THREE.Vector3(...c).project(N.camera);
          const u = (p.x * 0.5 + 0.5) * W, v = (p.y * 0.5 + 0.5) * H;   // readPixels は下から
          u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
        }
        u0 = Math.max(0, Math.floor(u0 + 2)); u1 = Math.min(W, Math.ceil(u1 - 2)); v0 = Math.max(0, Math.floor(v0 + 2)); v1 = Math.min(H, Math.ceil(v1 - 2));
        let changed = 0, n = 0, sum = 0;
        for (let v = v0; v < v1; v++) for (let u = u0; u < u1; u++) {
          const k = (v * W + u) * 4;
          const d = Math.abs(buf[k] - buf2[k]) + Math.abs(buf[k + 1] - buf2[k + 1]) + Math.abs(buf[k + 2] - buf2[k + 2]);
          n++; sum += d; if (d > 3) changed++;
        }
        const changedPct = n ? +(100 * changed / n).toFixed(1) : 0;
        const seeOk = n > 50 && changedPct > 5;
        // エ) 1080p の1フレーム
        N.setRenderSize(1920, 1080);
        frameMs(8);
        const ms = frameMs(30);
        N.setRenderSize(0);
        const msOk = L !== 4 || ms <= 16.7;
        const ok = glassOk && holeOk && shown && seeOk && msOk;
        if (!ok) pass = false;
        res[`${L}F_${w.facing}_${x.toFixed(1)},${z.toFixed(1)}`] = { pass: ok, glass: gm ? `${gm.name} op ${+gm.opacity.toFixed(2)}` : null, behind, shown, windowPx: n, changedPct, meanDiff: n ? +(sum / n).toFixed(2) : 0, frameMs: ms };
      }
    }
    return { pass, windows: res, rule: 'ア glass op<0.3・奥 0.4m に壁なし / イ shown / ウ 窓の領域の 5% 超が変わる / エ 4F ≤ 16.7ms' };
  });

  await T('11_theater_double_door', async () => {
    // P5b-3(DESIGN §2 ①〜③): 食堂の扉 = ガラス扉。シアター = 鉄枠のガラス扉 2 枚の前室(間隔 1.2〜1.6m)。
    //  E で 2 枚とも開く・閉じた扉は通れない・段床を登れる(最上段でも目線が天井より下)・管理人が 2 枚を抜けて室内へ来る
    const Dv = N.doorApi.get('THEATER_V'), Dt = N.doorApi.get('THEATER'), Dd = N.doorApi.get('DINING');
    const gap = Dv && Dt ? +Math.abs(Dt.pos[1] - Dv.pos[1]).toFixed(2) : null;
    await N.teleport(1, 9.0, 21.0, Math.PI); await settle('1,2');
    N.pump(DT, 10, false);
    // ガラス: 扉板の子の MX_CorrGlass(半透明)
    const glassOf = (d) => { let m = null; if (d && d.node) d.node.traverse((o) => { if (o.isMesh && o.material && o.material.name === 'MX_CorrGlass') m = o.material; }); return m ? { opacity: +m.opacity.toFixed(2), transparent: m.transparent } : null; };
    const glass = { DINING: glassOf(Dd), THEATER_V: glassOf(Dv), THEATER: glassOf(Dt) };
    const glassOk = Object.values(glass).every((g) => g && g.transparent && g.opacity < 0.3);
    for (const id of ['THEATER_V', 'THEATER']) N.doorApi.close(id);
    N.pump(DT, 90, false);
    // a) 閉じた外扉は通れない
    const walk = (sec, codes = ['KeyW']) => { for (const c of codes) key(c, true); let t = 0; while (t < sec) { N.pump(DT, 1, false); t += DT; } for (const c of codes) key(c, false); N.pump(DT, 2, false); };
    N.setView(9.0, 21.4, Math.PI, 0); N.pump(DT, 2, false);
    walk(1.2);
    const blockedZ = +N.player.pos.z.toFixed(2);
    // b) E で外扉 → 前室へ → E で内扉 → 室内へ
    N.setView(9.0, 21.4, Math.PI, 0); N.pump(DT, 2, false);
    const hintV = N.hudState().hint;
    tap('KeyE'); N.pump(DT, 90, false);
    const openV = N.doorApi.isOpen('THEATER_V');
    walk(1.0);
    const inVest = +N.player.pos.z.toFixed(2);
    N.setView(9.0, Math.min(N.player.pos.z, 22.85), Math.PI, 0); N.pump(DT, 2, false);
    const hintT = N.hudState().hint;
    tap('KeyE'); N.pump(DT, 90, false);
    const openT = N.doorApi.isOpen('THEATER');
    walk(1.2);
    const inRoom = +N.player.pos.z.toFixed(2);
    // c) 段床を登る(南へ歩く)。足元の高さ・目線と天井
    N.setView(10.0, 24.7, Math.PI, 0); N.pump(DT, 2, false);   // 最前列のソファ(x 10.7〜)の西
    let maxLift = 0, maxEye = 0;
    key('KeyW', true);
    for (let i = 0; i < 200; i++) { N.pump(DT, 1, false); maxLift = Math.max(maxLift, N.player.pos.y); maxEye = Math.max(maxEye, N.camera.position.y); }
    key('KeyW', false); N.pump(DT, 2, false);
    const topZ = +N.player.pos.z.toFixed(2);
    N.setView(10.0, 27.6, 0, 0); N.pump(DT, 2, false);   // 北へ下りる
    walk(3.0);
    const downLift = +N.player.pos.y.toFixed(2);
    // d) 管理人: 2 枚とも閉じた状態から、廊下 → 外扉 → 前室 → 内扉 → 室内(段床の脇の隠れ場所の近く)へ
    for (const id of ['THEATER_V', 'THEATER']) N.doorApi.close(id);
    N.pump(DT, 90, false);
    N.setView(6.9, 8.0, 0, 0);    // プレイヤーは食堂(見えない・聞こえない所)
    N.pump(DT, 2, false);
    const ai = N.ai;
    ai.reset(12.5, 21.2, -Math.PI / 2, 1);
    const ev0 = ai.events.length;
    ai.lastKnown = { x: 9.6, z: 25.4, lv: 1 };
    ai.setState('ALERT', { force: true, log: true, react: false });
    let t2 = 0, reached = false, passedV = false, passedT = false;
    while (t2 < 60) {
      N.pump(DT, 1, false); t2 += DT;
      const e = N.enemyObj.pos;
      if (ai.level === 1 && e.z > 22.3 && e.z < 23.4 && e.x < 10.2) passedV = true;
      if (passedV && ai.level === 1 && e.z > 23.7 && e.x < 14.0) { passedT = true; }
      if (passedT && e.z > 24.2) { reached = true; break; }
    }
    const doorEvs = ai.events.slice(ev0).filter((e) => /door/.test(e.ev)).map((e) => `${e.ev}:${e.door || e.room || ''}`).slice(0, 12);
    const enemyAt = { x: +N.enemyObj.pos.x.toFixed(2), z: +N.enemyObj.pos.z.toFixed(2), state: ai.state };
    ai.reset(N.ENEMY_HOME.x, N.ENEMY_HOME.z, N.ENEMY_HOME.yaw, 4);
    ai.setState('SCRIPTED', { force: true });
    for (const id of ['THEATER_V', 'THEATER']) N.doorApi.close(id);
    const y1 = 0;   // 1F の床
    const pass = !!Dv && !!Dt && Dv.operable && Dt.operable && gap >= 1.2 && gap <= 1.6 && glassOk
      && blockedZ < 22.0 && openV && inVest > 22.3 && inVest < 23.4 && openT && inRoom > 23.7
      && Math.abs(maxLift - (y1 + 0.9)) < 0.02 && maxEye < y1 + 2.8 - 0.1 && topZ > 27.0 && downLift < y1 + 0.02
      && reached;
    return { pass, gap, glass, blockedZ, hintV, openV, inVest, hintT, openT, inRoom, maxLift: +maxLift.toFixed(2), maxEye: +maxEye.toFixed(2), topZ, downLift,
      manager: { reached, passedV, passedT, sec: +t2.toFixed(1), enemyAt, doorEvs } };
  });

  await N.teleport(4, 6.9, 7.6, Math.PI);
  await settle('3,4,5');
  N.ai.reset(N.ENEMY_HOME.x, N.ENEMY_HOME.z, N.ENEMY_HOME.yaw, 4);
  N.render();
  if (new URLSearchParams(location.search).get('fps') === '1') { out.fps = await measureFps(N); show(); }
  N.testResult = out;
  console.log('[test_building]', JSON.stringify(out));
  return out;
}

// 1080p で各階の廊下を見て rAF を 2.5 秒回す(パネルが表示されている状態で測る)
async function measureFps(N) {
  const res = {};
  N.setRenderSize(1920, 1080);
  N.ai.setState('SCRIPTED', { force: true });
  const views = { 1: [6.9, 19.5, 0], 2: [6.9, 19.5, 0], 3: [6.9, 19.5, 0], 4: [6.9, 7.6, Math.PI], 5: [6.9, 19.5, 0], 6: [7.0, 21.2, -Math.PI / 2], 7: [7.0, 21.2, -Math.PI / 2] };
  for (const [lv, [x, z, yaw]] of Object.entries(views)) {
    await N.teleport(+lv, x, z, yaw);
    await new Promise((r) => setTimeout(r, 2500));
    const s = N.stats();
    res['F' + lv] = { fps: s.fps, frameMsAvg: s.frameMsAvg, calls: s.render.calls, triangles: s.render.triangles };
  }
  N.setRenderSize(0);
  await N.teleport(4, 6.9, 7.6, Math.PI);
  return res;
}
