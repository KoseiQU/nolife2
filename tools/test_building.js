// test_building.js — P3a 全館の外殻の決定的テスト(ブラウザ内)。http://localhost:8001/?test=building で自動実行。
// rAF に依存せず window.__N2.pump(dt, n) で本物のループと同じ順に進める。キーは keydown/keyup をペアで送る。
// 階の読み込みは非同期なので、読み込み待ちだけ await する。結果: window.__N2.testResult と画面左上の <pre>。
//  1) 読み分け: 居る階 ±1 だけ読み、離れた階は解放(4F→1F→7F→4F)。解放→再読み込みでも扉・覗き穴が壊れない
//  2) 各階の扉数(居室)= 図面の号室数。GLB の号室プレート・EV 扉・外階段の鉄扉が結び付いている
//  3) EV: 4F で呼ぶ→カゴが来て開く→歩いて乗る→7 を押す→7F で開く→歩いて降りる。閉じた扉は通れない
//  4) 外階段: 4F の鉄扉→踊り場→上る(5F,6F,7F,屋上B)→屋上を歩く(落ちない)→下る(…→1F)。段の手前の当たりで階段へ踏み外さない
//  5) 北階段: 1F→2F→3F→2F→1F
//  6) 1F 風除室: 内側の自動ドアは近づくと開き、外側(正面玄関)は閉じたまま
//  7) 管理人が別の階へ(EV/階段)移っても状態機械が破綻しない。読み込まれていない階でも論理が進み、描画はされない

const DT = 1 / 60;
const EXPECT_UNITS = { 1: 9, 2: 22, 3: 22, 4: 19, 5: 16, 6: 11, 7: 5 };

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
  const loadedSet = () => N.world.loadedLevels().join(',');
  async function settle(expect, ms = 15000) {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) { if (loadedSet() === expect) return true; await sleep(50); }
    return false;
  }
  const pos = () => ({ x: +N.player.pos.x.toFixed(2), y: +N.player.pos.y.toFixed(2), z: +N.player.pos.z.toFixed(2), level: N.level });
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
    const vis = N.world.loadedLevels().map((l) => [l, N.world.floors.get(l).group.visible]);
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

  await T('5_north_stairs', async () => {
    await N.teleport(1, 8.6, 1.45, -Math.PI / 2); await settle('1,2');
    const g = N.building.stairs.find((s) => s.id === 'north').geom;
    const go = async (dir) => {
      const lane = dir === 'up' ? g.lanes.up : g.lanes.down;
      const from = N.level;
      N.setView(g.s0 - 0.3, (lane[0] + lane[1]) / 2, -Math.PI / 2, 0); N.pump(DT, 1, false);
      key('KeyW', true); let t = 0;
      while (N.level === from && t < 20) { N.pump(DT, 1, false); t += DT; }
      key('KeyW', false); N.pump(DT, 2, false);
      return { from, to: N.level, y: +N.player.pos.y.toFixed(2) };
    };
    const r = [await go('up'), await go('up'), await go('down'), await go('down')];
    return { pass: r.map((x) => x.to).join(',') === '2,3,2,1' && Math.abs(N.player.pos.y) < 1e-3, moves: r };
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
    return { pass: before === 0 && z > 25.6 && z < 28.1 - 0.27 && opened > 0.85 && closedAgain === 0, before, openedWhenNear: +opened.toFixed(2), reachedZ: +z.toFixed(2), outerDoorStopsAt: 28.1 - 0.28, closedAfterLeaving: closedAgain };
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
