// ai_graph.js — P3a: 管理人の移動グラフ(全7階を常駐。ロードされていない階でも経路と当たりはデータから)。
//  4F は P0 の点(N0, C1..C5, J, JE, EV, R)を同じ名前・同じ座標で残す(P2 の AI テストの前提)。他の階は 'L:名前'。
//  辺: 歩き(door=通る扉の roomId)・EV(階の間)・外階段/北階段(階の間)。
//  縦廊下は 2.9m おき、横廊下は JE(8.2)から 2.9m おきの点。扉の前の立ち位置は enemy_ai の _doorFront が扉データから作る。

export const P0_NODES = {
  N0: [6.9, 6.3], C1: [6.9, 7.38], C2: [6.9, 10.15], C3: [6.9, 13.05], C4: [6.9, 15.95], C5: [6.9, 18.85],
  J: [6.9, 21.2], JE: [8.2, 21.2], EV: [6.95, 21.75], R: [8.75, 7.38],
};
const P0_EDGES = [['N0', 'C1'], ['C1', 'C2'], ['C2', 'C3'], ['C3', 'C4'], ['C4', 'C5'], ['C5', 'J'], ['J', 'JE'], ['J', 'EV'], ['C1', 'R', '410']];

export function nodeId(lv, name) { return lv === 4 && P0_NODES[name] ? name : `${lv}:${name}`; }

export function buildAIGraph(building) {
  const nodes = {};
  const edges = [];
  const add = (lv, name, x, z) => { const id = nodeId(lv, name); nodes[id] = { id, name, x: +x.toFixed(3), z: +z.toFixed(3), lv }; return id; };
  const link = (a, b, door = null, kind = 'walk') => edges.push({ a, b, door, kind });
  const doorOf = new Map();
  for (const f of building.floors) for (const r of f.rooms) if (r.door) doorOf.set(r.id, r.door);
  const FN = { W: [-1, 0], E: [1, 0], N: [0, -1], S: [0, 1] };
  // 扉をまたぐ辺: a →(扉の外の正面)→(扉の内の正面)→ b。扉の中心線を通るので半径 0.3m の体が枠に掛からない
  const doorLink = (lv, a, b, roomId) => {
    const d = doorOf.get(roomId);
    const [nx, nz] = FN[d.facing];
    const o = add(lv, 'Do_' + roomId, d.pos[0] + nx * 0.5, d.pos[1] + nz * 0.5);
    const i = add(lv, 'Di_' + roomId, d.pos[0] - nx * 0.5, d.pos[1] - nz * 0.5);
    const da = Math.hypot(nodes[a].x - nodes[o].x, nodes[a].z - nodes[o].z), db = Math.hypot(nodes[a].x - nodes[i].x, nodes[a].z - nodes[i].z);
    const [near, far] = da <= db ? [o, i] : [i, o];
    link(a, near); link(near, far, roomId); link(far, b);
  };
  for (const f of building.floors) {
    const lv = f.level;
    if (lv > 7) continue;
    const sh = f.shell;
    const hAir = sh.air.filter((a) => /^corridor_h/.test(a.id) || a.id === 'lobby_front');
    const scEnd = Math.max(...hAir.map((a) => a.rect[0] + a.rect[2]));
    // 縦廊下
    let top = null;
    if (lv === 4) {
      for (const [k, [x, z]] of Object.entries(P0_NODES)) add(4, k, x, z);
      for (const [a, b, door] of P0_EDGES) link(a, b, door || null);
      top = 'N0';
    } else {
      add(lv, 'J', 6.9, 21.2); add(lv, 'JE', 8.2, 21.2); add(lv, 'EV', 6.95, 21.75);
      link(nodeId(lv, 'J'), nodeId(lv, 'JE')); link(nodeId(lv, 'J'), nodeId(lv, 'EV'));
      if (sh.zTop !== null) {
        const zs = [];
        for (let z = sh.zTop + 0.5; z < 20.0; z += 2.9) zs.push(z);
        let prev = null;
        zs.forEach((z, i) => { const id = add(lv, 'V' + i, 6.9, z); if (prev) link(prev, id); prev = id; });
        link(prev, nodeId(lv, 'J'));
        top = nodeId(lv, 'V0');
      }
    }
    // 横廊下
    let prev = nodeId(lv, 'JE');
    const hs = [];
    for (let x = 8.2 + 2.9, i = 1; x < scEnd - 0.3; x += 2.9, i++) { const id = add(lv, 'H' + i, Math.min(x, scEnd - 0.5), 21.2); hs.push(id); link(prev, id); prev = id; }
    const nearestH = (x) => [nodeId(lv, 'JE'), ...hs].reduce((b, id) => (Math.abs(nodes[id].x - x) < Math.abs(nodes[b].x - x) ? id : b));
    // 外階段の踊り場(鉄扉の向こう)
    add(lv, 'L', 4.6, 21.2);
    doorLink(lv, nodeId(lv, 'J'), nodeId(lv, 'L'), 'MST' + lv);
    // 北階段(P3a-2: 屋外の鉄骨。1〜3F の踊り場。1F は地面で、建物の中からは歩いて行けない)・1F の共用部
    if (lv <= 3) {
      const ns = building.stairs.find((s) => s.id === 'north');
      add(lv, 'NS', ns.geom.landing[0] + ns.geom.landing[2] / 2, ns.geom.landing[1] + ns.geom.landing[3] / 2);
    }
    if (lv === 1) {
      add(1, 'DN', 6.9, 9.0); add(1, 'NP', 6.9, 1.2);
      doorLink(1, top, nodeId(1, 'DN'), 'DINING'); link(nodeId(1, 'DN'), nodeId(1, 'NP'));
      // P5b-3: シアターは前室を挟む二重扉(廊下 →THEATER_V の外扉→ 前室 TV →THEATER の内扉→ 室内 TH)
      add(1, 'TV', 9.0, 22.8); doorLink(1, nearestH(9.0), nodeId(1, 'TV'), 'THEATER_V');
      add(1, 'TH', 9.0, 24.6); doorLink(1, nodeId(1, 'TV'), nodeId(1, 'TH'), 'THEATER');
      add(1, 'LB', 17.6, 23.5); link(nearestH(17.6), nodeId(1, 'LB'));
      add(1, 'WB', 17.6, 26.6); doorLink(1, nodeId(1, 'LB'), nodeId(1, 'WB'), 'ENTRANCE');
    } else if (lv <= 3) {
      doorLink(lv, top, nodeId(lv, 'NS'), 'NST' + lv);
    }
  }
  // P3b: 入れる部屋(居室・管理室)の点。扉をまたぐ辺で一番近い廊下の点へ。410 は P0 の 'R'。食堂・シアターは既存の DN/TH
  const roomNode = { 410: 'R', DINING: nodeId(1, 'DN'), THEATER: nodeId(1, 'TH') };
  const CORR = /^(V\d+|H\d+|J|JE|N0|C\d)$/;
  for (const f of building.floors) {
    const lv = f.level;
    if (lv > 7) continue;
    for (const r of f.rooms) {
      if (!r.door || !r.door.enterable || r.id === '410' || !r.interior || !r.interior.points) continue;
      const [x, z] = r.interior.points.room;
      const id = add(lv, 'R_' + r.id, x, z);
      nodes[id].room = r.id;
      roomNode[r.id] = id;
      const [dx, dz] = r.door.pos;
      let best = null, bd = 1e9;
      for (const n of Object.values(nodes)) {
        if (n.lv !== lv || !CORR.test(n.name)) continue;
        const d = Math.hypot(n.x - dx, n.z - dz);
        if (d < bd) { bd = d; best = n.id; }
      }
      doorLink(lv, best, id, r.id);
    }
  }
  // 階の間
  for (let lv = 1; lv < 7; lv++) {
    link(nodeId(lv, 'EV'), nodeId(lv + 1, 'EV'), null, 'ev');
    link(nodeId(lv, 'L'), nodeId(lv + 1, 'L'), null, 'stair');
  }
  link(nodeId(1, 'NS'), nodeId(2, 'NS'), null, 'stair');
  link(nodeId(2, 'NS'), nodeId(3, 'NS'), null, 'stair');
  const adj = new Map(Object.keys(nodes).map((k) => [k, []]));
  for (const e of edges) { adj.get(e.a).push(e); adj.get(e.b).push(e); }
  return { nodes, edges, adj, roomNode };
}
