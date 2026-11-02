// spaces/x105.js — 別空間 X105「105 の長い廊下」(DESIGN §3.8 I 1 行目・D②・H 第4段)。P5b-2a。
//  建物の廊下と同じ仕上げ(カーペット・クロスの壁・幅木・天井の格子・丸い常夜灯・左右の居室の扉)で始まり、進むほど色が抜けて
//  灰色の均質な廊下(参考 05: 低い天井・等間隔の灯り・突き当たりの小さな光)になる。幅 1.6m・高さ 2.4m。
//  全長は「区画の継ぎ足し」: 4m の直線区画(1 つのジオメトリ)をプールで使い回し、同時に置くのはプレイヤーの前後の数区画だけ。
//  形は「レーン」(run)の連なり。どのレーンも +z(南)へ進み、終わりは分岐(扉 2 枚)・扉・出口のどれか。
//    R0(x 0)z 0〜70 → 分岐 F1(左 施錠/右)→ R1(x 1.1)70〜96 → 分岐 F2(1 回目: 右 施錠/左 = 折り返し RL へ、2 回目: 左 施錠/右)
//    → R2(x 2.2)96〜110 → 反転の扉 → R3(x 2.2)110〜140 → 分岐 F3(左 施錠/右)→ R4(x 3.3)140〜166 → 出口(105 の玄関へ)
//    RL(x 0)96〜166 は R0 の写し(見た目の座標 = z − 96)。中で扉が閉まったら z − 96 へ継ぎ目なしに移す = 最初の地点へ戻る
//  異世界の要素(§3.8 I): ①伸びる(R0 の z 10〜46 の間、前の分岐 F1 がプレイヤーの 24m 先を保って遠のき、来た道は背後 7m の壁になる)
//   ②折り返し(F2 の左)③反転(R2 の扉を抜けるとカメラが 180° ロール。当たりと床の高さはそのまま)④歪み(追跡中は壁と天井が呼吸し、背後から灯りが消える)
//  追跡: R3 の z 121 で反転の扉の前に管理人(悲鳴)→ 追跡(全知・経路はこのモジュールの nav)。止まると捕まる、走り続ければ出口へ。
//  光はすべてシェーダの中の計算(三角関数の周期の灯り。three.js のライトは足さない = 他の材質のシェーダを作り直さない)＋懐中電灯。
//  座標: 局所 u = x − 300(R0 の中心線)、v = z。y は SPACE_Y からの高さ。

import * as THREE from 'three';
import { SPACE_Y } from '../world.js';

const OX = 300, OZ = 0;
const W = 1.6, H = 2.4, SEG = 4.0, BAY = 2.0, BAYW = 3.8, DOORW = 0.82, DOORH = 2.0;
// 調整値(docs/p5b2a/NOTES.md §3)
export const X105 = {
  stretch: { from: 10, keep: 24, until: 46, endMax: 70, time: 45, glide: 3.0, backGap: 7.0 },   // ①伸びる
  loop: { closeAt: 1.6, jumpAt: 2.2, closeSec: 0.8 },                                          // ②折り返し(RL の扉から何 m 入ったら閉じ・移すか)
  roll: { sec: 3.2 },                                                                           // ③反転
  chase: { at: 121, appear: [2.2, 110.7], slow: 3.0, offLead: 4.0, offBehind: 6.0, offRate: 3.2, warpIn: 2.0 },   // 追跡・灯りが消える・歪み
  look: { bld: 10, gray: 40 },                                                                  // 見た目の座標: これより手前は建物の仕上げ、奥は灰色
  fog: { density: 0.022, color: 0x050506 },
  pool: 14, ahead: 46, behind: 10,
  lamp: { bld: [1.0, 0.86, 0.66], gray: [0.78, 0.84, 0.9], gain: 0.55, bay: [1.0, 0.8, 0.55], bayGain: 0.22, exit: [1.0, 0.97, 0.9], exitGain: 2.6 },
};
// レーン(局所 u・v)。end = 'fork' | 'door' | 'exit' | 'fake'。doors = 分岐の扉の u(左・右)
const RUNS = [
  { id: 'R0', xc: 0.0, z0: 0, z1: 70, look: 0, end: 'fork', start: '105' },
  { id: 'R1', xc: 1.1, z0: 70, z1: 96, look: 0, end: 'fork', start: 'door' },
  { id: 'RL', xc: 0.0, z0: 96, z1: 166, look: -96, end: 'fake', start: 'door' },
  { id: 'R2', xc: 2.2, z0: 96, z1: 110, look: 0, end: 'door', start: 'door' },
  { id: 'R3', xc: 2.2, z0: 110, z1: 140, look: 0, end: 'fork', start: 'door' },
  { id: 'R4', xc: 3.3, z0: 140, z1: 166, look: 0, end: 'exit', start: 'door' },
];
const RUN = Object.fromEntries(RUNS.map((r, i) => [r.id, Object.assign(r, { i })]));
const NEXT = { R0: ['R1'], R1: ['RL', 'R2'], RL: [], R2: ['R3'], R3: ['R4'], R4: [] };
const PREV = { R1: 'R0', RL: 'R1', R2: 'R1', R3: 'R2', R4: 'R3' };
const CHAIN = ['R2', 'R3', 'R4'];   // 追跡の道筋(nav)

export const DEF = {
  origin: [OX, OZ], host: { level: 1, door: '105' },
  entry: [0, 0.75, Math.PI],          // 105 の扉の内側・奥(南)を向く
  exit: [0, 0.02],
  // メモ「鍵は 6 階のどこかの部屋」は出口の扉の手前の床(DESIGN H 第4段。P5b-2a で入口脇から移した)
  slots: { memo: [3.3 + 0.42, 0.0, 165.3] },
};

// ================================================================ 材質(建物の仕上げ → 灰色、周期の灯り、歪み)
function makeMaterial(U) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.0 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aSurf; attribute float aWarp; attribute float aSeg;
        uniform float uTime, uWarp; uniform vec3 uPlayer;
        uniform vec4 uRunA[6]; uniform vec4 uRunB[6];
        varying vec3 vWP; varying float vSurf; varying float vSeg; flat varying int vRun;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec3 wp0 = (modelMatrix * vec4(transformed, 1.0)).xyz;
          float dP = distance(wp0.xz, uPlayer.xz);
          float amp = uWarp * aWarp * 0.24 * smoothstep(2.5, 17.0, dP);
          float br = sin(uTime * 1.55 + wp0.z * 0.42) * 0.7 + sin(uTime * 0.83 + wp0.z * 0.16 + wp0.y * 1.3) * 0.3;
          transformed += objectNormal * amp * br;
        }`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vSurf = aSurf; vSeg = aSeg;
        // どのレーンの光・見た目か(メッシュの原点で決める: 区画はレーンの中心線上、部品はレーンの端に置いてある。扉の板の手前の面は手前のレーンへ)
        {
          vec3 wn = normalize(mat3(modelMatrix) * objectNormal);
          vec3 P0 = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float best = 1e9; vRun = 0;
          for (int i = 0; i < 6; i++) {
            vec4 a = uRunA[i]; if (uRunB[i].x < 0.5) continue;
            float dx = abs(P0.x - a.x); float dz = max(max(a.y - P0.z, P0.z - a.z), 0.0);
            float d = dx + dz * 4.0;
            if (wn.z < -0.5 && P0.z < a.y + 0.3) d += 3.0;
            if (wn.z > 0.5 && P0.z > a.z - 0.3) d += 3.0;
            if (d < best) { best = d; vRun = i; }
          }
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime, uY, uOffZ, uLookBld, uLookGray, uLampGain, uBayGain, uExitGain;
        uniform vec4 uRunA[6]; uniform vec4 uRunB[6];
        uniform vec3 uLampBld, uLampGray, uLampBay, uLampExit;
        varying vec3 vWP; varying float vSurf; varying float vSeg; flat varying int vRun;
        float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
        int gRun; float gLook; vec4 gA; vec4 gB;
        float lampOn(float zk) {
          float x = zk - uOffZ;
          if (x > 2.6) return 1.0;
          if (x < 0.0) return 0.0;
          float fl = step(0.42, h21(vec2(floor(zk * 0.25), floor(uTime * 13.0))));
          return mix(fl * 0.85, 1.0, smoothstep(1.2, 2.6, x)) * smoothstep(0.0, 0.3, x);
        }
        vec3 lampTerm(vec3 L, vec3 p, vec3 n, float down) {
          vec3 d = L - p; float r2 = dot(d, d); vec3 l = d * inversesqrt(r2);
          float nd = max(dot(n, l), 0.0);
          float em = mix(1.0, 0.3 + 0.7 * max(l.y, 0.0), down);
          return vec3(nd * em / (r2 + 0.45));
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 P = vWP; float fy = P.y - uY;
        gRun = vRun; gA = uRunA[gRun]; gB = uRunB[gRun];
        if (vSeg > 0.5 && P.z > gA.z - ${BAY.toFixed(1)} + 0.002) discard;      // 伸びる途中の区画の切れ端(分岐の口の奥)は描かない
        gLook = P.z + gA.w;
        float g = smoothstep(uLookBld, uLookGray, gLook);
        float lx = P.x - gA.x;
        vec3 bld, gry; float rB = 0.85, rG = 0.8;
        int S = int(vSurf + 0.5);
        if (S == 0) {            // 床: カーペット(建物の廊下のタイルカーペット)→ 灰色の滑らかな床と端の黒い線
          float sp = vnoise(P.xz * 38.0) * 0.6 + vnoise(P.xz * 9.0) * 0.4;
          float tile = step(0.985, fract(P.x * 2.0 + 0.5)) + step(0.985, fract(P.z * 2.0));
          bld = vec3(0.105, 0.115, 0.13) * (0.75 + 0.5 * sp) * (1.0 - 0.18 * min(tile, 1.0));
          float edge = smoothstep(0.69, 0.72, abs(lx)) * (1.0 - smoothstep(0.78, 0.8, abs(lx)));
          gry = vec3(0.29) * (0.96 + 0.08 * vnoise(P.xz * 3.0));
          gry = mix(gry, vec3(0.025), edge * step(abs(lx), 0.8) * step(0.5, vSeg));
          rB = 0.95; rG = 0.32;
        } else if (S == 1) {     // 壁: クロス → 灰色の均質な壁
          float w = vnoise(vec2(P.z * 60.0, fy * 60.0)) * 0.5 + vnoise(vec2(P.z * 7.0, fy * 5.0)) * 0.5;
          bld = vec3(0.60, 0.60, 0.585) * (0.93 + 0.1 * w);
          gry = vec3(0.36) * (0.97 + 0.05 * vnoise(vec2(P.z * 1.3, fy * 2.0)));
          rB = 0.9; rG = 0.75;
        } else if (S == 2) {     // 天井: 格子の天井板 → 灰色の天井と縦の目地
          float gx = step(0.985, fract(lx / 0.6 + 0.5)) + step(0.985, fract(P.z / 0.6));
          bld = vec3(0.56, 0.56, 0.55) * (1.0 - 0.35 * min(gx, 1.0)) * (0.95 + 0.06 * vnoise(P.xz * 20.0));
          float seam = step(0.99, fract(lx / 0.4 + 0.5));
          gry = vec3(0.30) * (1.0 - 0.5 * seam);
          rB = 0.95; rG = 0.85;
        } else if (S == 3) {     // 幅木
          bld = vec3(0.035); gry = vec3(0.03); rB = 0.5; rG = 0.4;
        } else if (S == 5) {     // 扉の板(木目 → 灰色に塗られた扉)
          float gr = vnoise(vec2(P.x * 3.0 + P.z * 3.0, fy * 40.0));
          bld = vec3(0.33, 0.17, 0.075) * (0.8 + 0.4 * gr);
          gry = vec3(0.24) * (0.95 + 0.1 * gr);
          rB = 0.55; rG = 0.6;
        } else if (S == 6) {     // 扉の枠(黒に近い)
          bld = vec3(0.03); gry = vec3(0.035); rB = 0.5; rG = 0.5;
        } else if (S == 7) {     // 金物(レバー)
          bld = vec3(0.55); gry = vec3(0.45); rB = 0.3; rG = 0.3;
        } else {                 // 灯具(4 = 丸い常夜灯 / 9 = 灰色の区間の角形の灯具)・出口の光(8)
          bld = vec3(0.9); gry = vec3(0.9); rB = 0.5; rG = 0.5;
          if (S == 4 && g > 0.6) discard;
          if (S == 9 && g <= 0.6) discard;
        }
        diffuseColor.rgb = mix(bld, gry, g);
        float xRough = mix(rB, rG, g);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = xRough;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float kz = floor((P.z - gA.y) / ${SEG.toFixed(1)});
          float zc = gA.y + kz * ${SEG.toFixed(1)} + ${(SEG / 2).toFixed(1)};
          vec3 lc = mix(uLampBld, uLampGray, smoothstep(uLookBld, uLookGray, gLook));
          if (S == 4 || S == 9) totalEmissiveRadiance += lc * (lampOn(zc) * gB.y * mix(2.0, 0.75, smoothstep(uLookBld, uLookGray, gLook)) + 0.02);
          if (S == 10) totalEmissiveRadiance += uLampBay * 1.6;
          if (S == 8) totalEmissiveRadiance += uLampExit * 3.0;
        }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        {
          vec3 n = inverseTransformDirection(normal, viewMatrix);
          vec3 V = normalize(cameraPosition - P);
          float g2 = smoothstep(uLookBld, uLookGray, gLook);
          vec3 lc = mix(uLampBld, uLampGray, g2);
          float k0 = floor((P.z - gA.y) / ${SEG.toFixed(1)});
          float kMax = floor((gA.z - ${BAY.toFixed(1)} - gA.y) / ${SEG.toFixed(1)} - 0.001);
          vec3 irr = vec3(0.0); vec3 spec = vec3(0.0);
          float isFloor = step(0.5, n.y) * (1.0 - step(0.5, vSurf));
          for (int j = -2; j <= 2; j++) {
            float k = k0 + float(j);
            if (k < 0.0 || k > kMax) continue;
            float zk = gA.y + k * ${SEG.toFixed(1)} + ${(SEG / 2).toFixed(1)};
            vec3 L = vec3(gA.x, uY + ${(H - 0.05).toFixed(2)}, zk);
            float on = lampOn(zk) * gB.y;
            if (on <= 0.0) continue;
            vec3 d = L - P; float r2 = dot(d, d); vec3 l = d * inversesqrt(r2);
            irr += vec3(max(dot(n, l), 0.0) * (0.3 + 0.7 * max(l.y, 0.0)) / (r2 + 0.45) + 0.16 / (r2 + 2.0)) * on;   // 直接＋照り返し(天井と陰が真っ黒にならない)
            if (isFloor > 0.5) { vec3 hv = normalize(l + V); spec += vec3(pow(max(dot(n, hv), 0.0), 90.0) * on / (r2 * 0.25 + 0.6)); }   // 床の灯りの映り
          }
          irr *= lc * uLampGain;
          // 分岐・扉の上の小さな灯り / 出口の光
          float toEnd = gA.z - P.z;
          if (toEnd < 9.0 && toEnd > -0.5) {
            if (gB.z > 0.5 && gB.z < 1.5) {          // 分岐: 扉 2 枚の上
              irr += lampTerm(vec3(gA.x - 1.1, uY + 2.2, gA.z - 0.12), P, n, 0.0) * uLampBay * uBayGain;
              irr += lampTerm(vec3(gA.x + 1.1, uY + 2.2, gA.z - 0.12), P, n, 0.0) * uLampBay * uBayGain;
            } else if (gB.z > 1.5 && gB.z < 2.5) {   // 扉 1 枚の上
              irr += lampTerm(vec3(gA.x, uY + 2.2, gA.z - 0.12), P, n, 0.0) * uLampBay * uBayGain;
            } else if (gB.z > 2.5) {                 // 出口: 扉の向こうの光
              irr += lampTerm(vec3(gA.x, uY + 1.1, gA.z + 0.6), P, n, 0.0) * uLampExit * uExitGain;
            }
          }
          float ref = isFloor * smoothstep(0.3, 1.0, g2);
          reflectedLight.indirectDiffuse += diffuseColor.rgb * irr;
          reflectedLight.indirectSpecular += lc * spec * uLampGain * (0.04 + 1.1 * ref);
        }`);
  };
  m.customProgramCacheKey = () => 'n2_x105_v2';
  return m;
}

// ================================================================ ジオメトリの組み立て(位置・法線・面の種類・歪みの重み・区画の印)
class GB {
  constructor() { this.p = []; this.n = []; this.s = []; this.w = []; this.g = []; this.i = []; }
  // o + U*a + V*b(a,b ∈ [0,1])、法線 N の向きの面。nu × nv に分割
  quad(o, U, V, N, surf, warp = 0, nu = 1, nv = 1, seg = 0) {
    const base = this.p.length / 3;
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const a = i / nu, b = j / nv;
      this.p.push(o[0] + U[0] * a + V[0] * b, o[1] + U[1] * a + V[1] * b, o[2] + U[2] * a + V[2] * b);
      this.n.push(...N); this.s.push(surf); this.w.push(warp); this.g.push(seg);
    }
    const c = [U[1] * V[2] - U[2] * V[1], U[2] * V[0] - U[0] * V[2], U[0] * V[1] - U[1] * V[0]];
    const flip = c[0] * N[0] + c[1] * N[1] + c[2] * N[2] < 0;
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = base + j * (nu + 1) + i, b = a + 1, cc = a + nu + 1, d = cc + 1;
      if (!flip) this.i.push(a, b, d, a, d, cc); else this.i.push(a, d, b, a, cc, d);
    }
  }
  // 箱(外向きの面。faces で面を選ぶ: px nx py ny pz nz)
  box(x0, y0, z0, x1, y1, z1, surf, warp = 0, faces = 'px nx py ny pz nz', seg = 0) {
    const f = faces.split(' ');
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    if (f.includes('px')) this.quad([x1, y0, z0], [0, 0, dz], [0, dy, 0], [1, 0, 0], surf, warp, 1, 1, seg);
    if (f.includes('nx')) this.quad([x0, y0, z0], [0, 0, dz], [0, dy, 0], [-1, 0, 0], surf, warp, 1, 1, seg);
    if (f.includes('py')) this.quad([x0, y1, z0], [dx, 0, 0], [0, 0, dz], [0, 1, 0], surf, warp, 1, 1, seg);
    if (f.includes('ny')) this.quad([x0, y0, z0], [dx, 0, 0], [0, 0, dz], [0, -1, 0], surf, warp, 1, 1, seg);
    if (f.includes('pz')) this.quad([x0, y0, z1], [dx, 0, 0], [0, dy, 0], [0, 0, 1], surf, warp, 1, 1, seg);
    if (f.includes('nz')) this.quad([x0, y0, z0], [dx, 0, 0], [0, dy, 0], [0, 0, -1], surf, warp, 1, 1, seg);
  }
  // 円盤(下向き)
  disc(cx, y, cz, r, surf, nseg = 20) {
    const base = this.p.length / 3;
    this.p.push(cx, y, cz); this.n.push(0, -1, 0); this.s.push(surf); this.w.push(1); this.g.push(1);
    for (let k = 0; k <= nseg; k++) { const a = k / nseg * Math.PI * 2; this.p.push(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r); this.n.push(0, -1, 0); this.s.push(surf); this.w.push(1); this.g.push(1); }
    for (let k = 0; k < nseg; k++) this.i.push(base, base + 1 + k, base + 2 + k);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('aSurf', new THREE.Float32BufferAttribute(this.s, 1));
    g.setAttribute('aWarp', new THREE.Float32BufferAttribute(this.w, 1));
    g.setAttribute('aSeg', new THREE.Float32BufferAttribute(this.g, 1));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}
const SURF = { floor: 0, wall: 1, ceil: 2, base: 3, lampR: 4, wood: 5, frame: 6, metal: 7, glow: 8, lampP: 9, lampBay: 10 };

// 4m の直線区画(局所: x −0.8〜0.8・z 0〜4・y 0〜2.4)。壁と天井は歪むよう細かく分ける
function segmentGeometry() {
  const b = new GB(), h = W / 2;
  b.quad([-h, 0, 0], [W, 0, 0], [0, 0, SEG], [0, 1, 0], SURF.floor, 0, 2, 4, 1);
  b.quad([-h, H, 0], [W, 0, 0], [0, 0, SEG], [0, -1, 0], SURF.ceil, 1, 4, 16, 1);
  b.quad([-h, 0, 0], [0, 0, SEG], [0, H, 0], [1, 0, 0], SURF.wall, 1, 16, 6, 1);
  b.quad([h, 0, 0], [0, 0, SEG], [0, H, 0], [-1, 0, 0], SURF.wall, 1, 16, 6, 1);
  // 幅木(高さ 7cm・厚 1.2cm)
  b.box(-h, 0, 0, -h + 0.012, 0.07, SEG, SURF.base, 1, 'px py', 1);
  b.box(h - 0.012, 0, 0, h, 0.07, SEG, SURF.base, 1, 'nx py', 1);
  // 灯具: 建物の丸い常夜灯 / 灰色の区間の角形の灯具(どちらかをシェーダで捨てる)
  b.disc(0, H - 0.012, SEG / 2, 0.15, SURF.lampR);
  b.box(-0.11, H - 0.02, SEG / 2 - 0.45, 0.11, H - 0.004, SEG / 2 + 0.45, SURF.lampP, 1, 'ny px nx pz nz', 1);
  return b.geometry();
}

// 扉の板(蝶番 = 原点、+x へ幅、厚さ z ±0.02)。レバーは両面
function leafGeometry() {
  const b = new GB();
  b.box(0.005, 0, -0.02, DOORW - 0.005, DOORH, 0.02, SURF.wood, 0);
  for (const s of [-1, 1]) {
    b.box(DOORW - 0.13, 0.98, s * 0.02, DOORW - 0.1, 1.01, s * 0.065, SURF.metal, 0);
    b.box(DOORW - 0.24, 0.985, s * 0.06, DOORW - 0.1, 1.005, s * 0.075, SURF.metal, 0);
  }
  return b.geometry();
}

// 壁(z = zw の面。向き dir = +1 なら +z 向き)に、x の範囲 [xa, xb] で開口 openings([cx, w, h])を抜いた面と枠
function wallWithOpenings(b, xa, xb, zw, dir, openings, frame = true) {
  const N = [0, 0, dir];
  let x = xa;
  const ops = openings.slice().sort((p, q) => p[0] - q[0]);
  for (const [cx, w, oh] of ops) {
    const l = cx - w / 2, r = cx + w / 2;
    if (l > x) b.quad([x, 0, zw], [l - x, 0, 0], [0, H, 0], N, SURF.wall, 0, 2, 4);
    b.quad([l, oh, zw], [w, 0, 0], [0, H - oh, 0], N, SURF.wall, 0, 1, 1);
    if (frame) {   // 枠(見付 6cm・見込み 7cm)
      const fz0 = dir > 0 ? zw : zw - 0.07, fz1 = dir > 0 ? zw + 0.07 : zw;
      b.box(l - 0.06, 0, fz0, l + 0.03, oh + 0.06, fz1, SURF.frame, 0);   // 戸当たりまで(扉の板との隙間をふさぐ)
      b.box(r - 0.03, 0, fz0, r + 0.06, oh + 0.06, fz1, SURF.frame, 0);
      b.box(l, oh - 0.03, fz0, r, oh + 0.06, fz1, SURF.frame, 0);
    }
    x = r;
  }
  if (xb > x) b.quad([x, 0, zw], [xb - x, 0, 0], [0, H, 0], N, SURF.wall, 0, 2, 4);
  // 幅木
  const bz0 = dir > 0 ? zw : zw - 0.012, bz1 = dir > 0 ? zw + 0.012 : zw;
  x = xa;
  for (const [cx, w] of ops) { const l = cx - w / 2 - 0.06; if (l > x) b.box(x, 0, bz0, l, 0.07, bz1, SURF.base, 0, dir > 0 ? 'pz py' : 'nz py'); x = cx + w / 2 + 0.06; }
  if (xb > x) b.box(x, 0, bz0, xb, 0.07, bz1, SURF.base, 0, dir > 0 ? 'pz py' : 'nz py');
}

// 分岐の口(レーンの最後の 2m。幅 3.8m に広がり、突き当たりの壁に扉 2 枚と小さな灯り)。局所: 中心 x 0・突き当たり z 0(手前が −z)
function forkGeometry(doorXs) {
  const b = new GB(), hw = BAYW / 2, h = W / 2, z0 = -BAY;
  b.quad([-hw, 0, z0], [BAYW, 0, 0], [0, 0, BAY], [0, 1, 0], SURF.floor, 0, 4, 2);
  b.quad([-hw, H, z0], [BAYW, 0, 0], [0, 0, BAY], [0, -1, 0], SURF.ceil, 0, 4, 2);
  b.quad([-hw, 0, z0], [0, 0, BAY], [0, H, 0], [1, 0, 0], SURF.wall, 0, 2, 4);
  b.quad([hw, 0, z0], [0, 0, BAY], [0, H, 0], [-1, 0, 0], SURF.wall, 0, 2, 4);
  b.quad([-hw, 0, z0], [hw - h, 0, 0], [0, H, 0], [0, 0, 1], SURF.wall, 0, 2, 4);   // 肩(+z 向き)
  b.quad([h, 0, z0], [hw - h, 0, 0], [0, H, 0], [0, 0, 1], SURF.wall, 0, 2, 4);
  b.box(-hw, 0, z0, -hw + 0.012, 0.07, 0, SURF.base, 0, 'px py');
  b.box(hw - 0.012, 0, z0, hw, 0.07, 0, SURF.base, 0, 'nx py');
  b.box(-hw, 0, z0, -h, 0.07, z0 + 0.012, SURF.base, 0, 'pz py');
  b.box(h, 0, z0, hw, 0.07, z0 + 0.012, SURF.base, 0, 'pz py');
  wallWithOpenings(b, -hw, hw, 0, -1, doorXs.map((x) => [x, DOORW + 0.04, DOORH + 0.03]));
  for (const x of doorXs) b.box(x - 0.09, 2.17, -0.06, x + 0.09, 2.23, 0, SURF.lampBay, 0, 'nz ny');   // 扉の上の小さな灯り
  return b.geometry();
}
// 扉 1 枚の突き当たり(反転の扉・出口)。glow = 扉の向こうの光の箱
function doorEndGeometry(glow) {
  const b = new GB(), h = W / 2;
  wallWithOpenings(b, -h, h, 0, -1, [[0, DOORW + 0.04, DOORH + 0.03]]);
  b.box(-0.09, 2.17, -0.06, 0.09, 2.23, 0, SURF.lampBay, 0, 'nz ny');
  if (glow) {   // 扉の向こう: 光の満ちた小さな箱(内向き)
    b.quad([-h, 0, 0.1], [W, 0, 0], [0, 0, 1.2], [0, 1, 0], SURF.glow, 0);
    b.quad([-h, H, 0.1], [W, 0, 0], [0, 0, 1.2], [0, -1, 0], SURF.glow, 0);
    b.quad([-h, 0, 0.1], [0, 0, 1.2], [0, H, 0], [1, 0, 0], SURF.glow, 0);
    b.quad([h, 0, 0.1], [0, 0, 1.2], [0, H, 0], [-1, 0, 0], SURF.glow, 0);
    b.quad([-h, 0, 1.3], [W, 0, 0], [0, H, 0], [0, 0, -1], SURF.glow, 0);
  }
  return b.geometry();
}
// レーンの始まりの壁(+z 向き)。door = 中央に扉の開口
function startGeometry(door) {
  const b = new GB(), h = W / 2;
  if (door) wallWithOpenings(b, -h, h, 0, 1, [[0, DOORW + 0.04, DOORH + 0.03]]);
  else b.quad([-h, 0, 0], [W, 0, 0], [0, H, 0], [0, 0, 1], SURF.wall, 0, 2, 4);
  return b.geometry();
}
// 伸びる間の背後の壁(+z 向き)
function backWallGeometry() {
  const b = new GB(), h = W / 2;
  b.quad([-h, 0, 0], [W, 0, 0], [0, H, 0], [0, 0, 1], SURF.wall, 1, 2, 6);
  b.box(-h, 0, 0, h, 0.07, 0.012, SURF.base, 1, 'pz py');
  return b.geometry();
}
// 入口の数 m の「建物の廊下」の名残: 左右の居室の扉(壁に付いた扉と枠・番号のない札)
function startDecorGeometry() {
  const b = new GB(), h = W / 2;
  const doors = [[-1, 3.6], [1, 6.2], [-1, 9.8], [1, 12.4]];
  for (const [s, z] of doors) {
    const xw = s * h, d = -s;   // 壁の面と室内向き
    const x0 = Math.min(xw, xw + d * 0.04), x1 = Math.max(xw, xw + d * 0.04);
    b.box(x0, 0.0, z - DOORW / 2, x1, DOORH, z + DOORW / 2, SURF.wood, 0, d > 0 ? 'px pz nz py' : 'nx pz nz py');
    const f0 = Math.min(xw, xw + d * 0.06), f1 = Math.max(xw, xw + d * 0.06);
    b.box(f0, 0, z - DOORW / 2 - 0.06, f1, DOORH + 0.06, z - DOORW / 2, SURF.frame, 0);
    b.box(f0, 0, z + DOORW / 2, f1, DOORH + 0.06, z + DOORW / 2 + 0.06, SURF.frame, 0);
    b.box(f0, DOORH, z - DOORW / 2, f1, DOORH + 0.06, z + DOORW / 2, SURF.frame, 0);
    const k0 = Math.min(xw + d * 0.04, xw + d * 0.1), k1 = Math.max(xw + d * 0.04, xw + d * 0.1);
    b.box(k0, 0.98, z + s * 0.26 - 0.015, k1, 1.0, z + s * 0.26 + 0.015, SURF.metal, 0);
    b.box(Math.min(xw + d * 0.04, xw + d * 0.05), 1.48, z - 0.06, Math.max(xw + d * 0.04, xw + d * 0.05), 1.56, z + 0.06, SURF.frame, 0);   // 番号のない札
  }
  return b.geometry();
}

// ================================================================ 当たり
function box(ctx, minX, minZ, maxX, maxZ, kind = 'wall') {
  const c = { minX: OX + minX, maxX: OX + maxX, minZ: OZ + minZ, maxZ: OZ + maxZ, y0: SPACE_Y, y1: SPACE_Y + H, kind, roomId: ctx.key, disabled: false };
  ctx.cols.push(c);
  return c;
}

// ================================================================ build
export function build(ctx) {
  const st = ctx.state;
  const U = st.U = {
    uTime: { value: 0 }, uWarp: { value: 0 }, uPlayer: { value: new THREE.Vector3() }, uY: { value: SPACE_Y }, uOffZ: { value: -1e4 },
    uLookBld: { value: X105.look.bld }, uLookGray: { value: X105.look.gray },
    uLampGain: { value: X105.lamp.gain }, uBayGain: { value: X105.lamp.bayGain }, uExitGain: { value: X105.lamp.exitGain },
    uLampBld: { value: new THREE.Vector3(...X105.lamp.bld) }, uLampGray: { value: new THREE.Vector3(...X105.lamp.gray) },
    uLampBay: { value: new THREE.Vector3(...X105.lamp.bay) }, uLampExit: { value: new THREE.Vector3(...X105.lamp.exit) },
    uRunA: { value: RUNS.map((r) => new THREE.Vector4(OX + r.xc, OZ + r.z0, OZ + r.z1, r.look)) },
    uRunB: { value: RUNS.map((r) => new THREE.Vector4(1, 1, { fork: 1, fake: 1, door: 2, exit: 3 }[r.end], 0)) },
  };
  const mat = st.mat = makeMaterial(U);
  const g = ctx.group;
  const add = (geo, x, z, name) => { const m = new THREE.Mesh(geo, mat); m.position.set(OX + x, SPACE_Y, OZ + z); m.name = name; m.receiveShadow = true; m.castShadow = false; m.frustumCulled = false; g.add(m); return m; };
  // 区画のプール
  const segGeo = st.segGeo = segmentGeometry();
  st.pool = [];
  for (let i = 0; i < X105.pool; i++) { const m = add(segGeo, 0, 0, 'X105_seg'); m.visible = false; m.userData.slot = null; st.pool.push(m); }
  // レーンごとの決まった部品
  st.pieces = [];
  const piece = (geo, x, z, runs, name) => { const m = add(geo, x, z, name); m.userData.runs = runs; st.pieces.push(m); return m; };
  const forkGeo = forkGeometry([-1.1, 1.1]);
  const startDoorGeo = startGeometry(true), decoGeo = startDecorGeometry();
  st.f1 = piece(forkGeo, RUN.R0.xc, RUN.R0.z1, ['R0', 'R1'], 'X105_F1');
  piece(forkGeo, RUN.R1.xc, RUN.R1.z1, ['R1', 'RL', 'R2'], 'X105_F2');
  piece(forkGeo, RUN.RL.xc, RUN.RL.z1, ['RL'], 'X105_F1copy');
  piece(doorEndGeometry(false), RUN.R2.xc, RUN.R2.z1, ['R2', 'R3'], 'X105_INV');
  piece(forkGeo, RUN.R3.xc, RUN.R3.z1, ['R3', 'R4'], 'X105_F3');
  piece(doorEndGeometry(true), RUN.R4.xc, RUN.R4.z1, ['R4'], 'X105_EXIT');
  piece(startDoorGeo, RUN.R0.xc, RUN.R0.z0, ['R0'], 'X105_S0');
  piece(decoGeo, RUN.R0.xc, RUN.R0.z0, ['R0'], 'X105_D0');
  for (const id of ['R1', 'RL', 'R2', 'R3', 'R4']) piece(startDoorGeo, RUN[id].xc, RUN[id].z0, [id, PREV[id]], 'X105_S_' + id);
  piece(decoGeo, RUN.RL.xc, RUN.RL.z0, ['RL'], 'X105_DL');
  st.back = piece(backWallGeometry(), 0, 0, ['R0'], 'X105_BACK'); st.backOn = false;
  // 扉(蝶番は −x 側、+z へ開く)
  const leafGeo = leafGeometry();
  st.doors = [];
  const door = (id, run, x, z, o = {}) => {
    const pv = new THREE.Group(); pv.position.set(OX + x - DOORW / 2, SPACE_Y, OZ + z); pv.name = 'X105_door_' + id;
    const leaf = new THREE.Mesh(leafGeo, mat); leaf.receiveShadow = true; pv.add(leaf); g.add(pv);
    const col = box(ctx, x - DOORW / 2, z - 0.05, x + DOORW / 2, z + 0.05, 'door');
    const d = { id, run, x, z, pv, col, angle: 0, target: 0, locked: !!o.locked, exit: !!o.exit, auto: !!o.auto, runs: o.runs || [run], speed: 1 };
    st.doors.push(d); pv.userData.runs = d.runs; st.pieces.push(pv);
    return d;
  };
  st.d105 = door('105', 'R0', 0, 0.02, { runs: ['R0'] });
  st.dF1L = door('F1L', 'R0', -1.1, 70, { locked: true, runs: ['R0', 'R1'] });
  st.dF1R = door('F1R', 'R0', 1.1, 70, { runs: ['R0', 'R1'] });
  st.dF2L = door('F2L', 'R1', 0, 96, { runs: ['R1', 'RL'] });
  st.dF2R = door('F2R', 'R1', 2.2, 96, { runs: ['R1', 'R2'] });
  st.dINV = door('INV', 'R2', 2.2, 110, { runs: ['R2', 'R3'] });
  st.dF3L = door('F3L', 'R3', 1.1, 140, { locked: true, runs: ['R3', 'R4'] });
  st.dF3R = door('F3R', 'R3', 3.3, 140, { runs: ['R3', 'R4'] });
  st.dEXIT = door('EXIT', 'R4', 3.3, 166, { runs: ['R4'] });
  st.dRLfakeL = door('FL1', 'RL', -1.1, 166, { locked: true, runs: ['RL'] });
  st.dRLfakeR = door('FL2', 'RL', 1.1, 166, { locked: true, runs: ['RL'] });
  // F1 の写しは 2 枚とも閉じた見た目だけ
  // 当たり(レーンの壁・分岐の口・突き当たり・始まりの壁)
  st.runCols = {};
  for (const r of RUNS) {
    const cs = [];
    const z1b = r.z1 - BAY;
    cs.push(box(ctx, r.xc - W / 2 - 0.2, r.z0, r.xc - W / 2, z1b), box(ctx, r.xc + W / 2, r.z0, r.xc + W / 2 + 0.2, z1b));
    if (r.end === 'fork' || r.end === 'fake') {
      cs.push(box(ctx, r.xc - BAYW / 2 - 0.2, z1b, r.xc - BAYW / 2, r.z1), box(ctx, r.xc + BAYW / 2, z1b, r.xc + BAYW / 2 + 0.2, r.z1));
      cs.push(box(ctx, r.xc - BAYW / 2, z1b - 0.2, r.xc - W / 2, z1b), box(ctx, r.xc + W / 2, z1b - 0.2, r.xc + BAYW / 2, z1b));
      const gaps = [-1.1, 1.1];
      let x = r.xc - BAYW / 2;
      for (const gx of gaps) { cs.push(box(ctx, x, r.z1 - 0.08, r.xc + gx - DOORW / 2, r.z1 + 0.08)); x = r.xc + gx + DOORW / 2; }
      cs.push(box(ctx, x, r.z1 - 0.08, r.xc + BAYW / 2, r.z1 + 0.08));
    } else {
      cs.push(box(ctx, r.xc - W / 2 - 0.2, z1b, r.xc - W / 2, r.z1), box(ctx, r.xc + W / 2, z1b, r.xc + W / 2 + 0.2, r.z1));
      cs.push(box(ctx, r.xc - W / 2, r.z1 - 0.08, r.xc - DOORW / 2, r.z1 + 0.08), box(ctx, r.xc + DOORW / 2, r.z1 - 0.08, r.xc + W / 2, r.z1 + 0.08));
    }
    if (r.start === '105') cs.push(box(ctx, r.xc - W / 2, r.z0 - 0.2, r.xc + W / 2, r.z0));
    else cs.push(box(ctx, r.xc - W / 2, r.z0 - 0.08, r.xc - DOORW / 2, r.z0 + 0.08), box(ctx, r.xc + DOORW / 2, r.z0 - 0.08, r.xc + W / 2, r.z0 + 0.08));
    st.runCols[r.id] = cs;
  }
  st.backCol = box(ctx, -W / 2, 0, W / 2, 0.15);
  // F1 の分岐の口は伸びる間に動く: 動く当たりを覚えておく(R0 の終わりの側)
  st.f1Cols = st.runCols.R0.slice(2, 2 + 2 + 2 + 3);   // 口の左右・肩・突き当たり 3
  st.f1Base = st.f1Cols.map((c) => ({ c, minZ: c.minZ - OZ - RUN.R0.z1, maxZ: c.maxZ - OZ - RUN.R0.z1 }));
  st.r0Walls = st.runCols.R0.slice(0, 2);
  // 敵の照明(追跡の区間 R2〜R4 の灯り)
  for (const id of CHAIN) { const r = RUN[id]; for (let z = r.z0 + SEG / 2; z < r.z1 - BAY; z += SEG) ctx.lamps.push([OX + r.xc, SPACE_Y + H - 0.1, OZ + z]); }
  reset(ctx, false);
  g.visible = false;
}

// 状態を作り直す(入るたび)。chaseStart = 追跡の区間の前(R2 の始まり)から
function reset(ctx, fromChase) {
  const st = ctx.state;
  Object.assign(st, {
    t: 0, phase: fromChase ? 'post' : 'start', stretchT: 0, r0End: fromChase ? RUN.R0.z1 : X105.stretch.from + X105.stretch.keep,
    backZ: null, loopDone: !!fromChase, inverted: false, roll: 0, rollT: 0, chase: false, chaseT: 0, warp: 0, offZ: -1e4,
    exited: false, offCount: 0, log: [], frontLog: [], loopJumpAt: null, invAt: null, lampsOffMax: 0, fromChase: !!fromChase, release: !!fromChase, retryArmed: false,
  });
  for (const d of st.doors) { d.angle = 0; d.target = 0; d.col.disabled = false; d.speed = 1; d.pv.rotation.y = 0; }
  st.dF2L.locked = st.loopDone; st.dF2R.locked = !st.loopDone;
  st.dINV.locked = false;
  st.dF3R.target = st.dF3R.angle = 1.25; st.dF3R.col.disabled = true;     // 追跡中の分岐は片方だけ開いている
  st.dEXIT.target = st.dEXIT.angle = 0.95; st.dEXIT.col.disabled = true;  // 出口は少し開いて光が漏れている
  st.dF3R.pv.rotation.y = -st.dF3R.angle; st.dEXIT.pv.rotation.y = -st.dEXIT.angle;
  st.U.uWarp.value = 0; st.U.uOffZ.value = -1e4;
  st.U.uRunB.value[RUN.RL.i].x = st.loopDone ? 0 : 1;
  for (const c of [...st.runCols.RL, st.dRLfakeL.col, st.dRLfakeR.col]) c.disabled = st.loopDone;
  st.backOn = false; st.backCol.disabled = true;
  setR0End(ctx, st.r0End);
}

function setR0End(ctx, z1) {
  const st = ctx.state;
  st.r0End = z1;
  st.U.uRunA.value[RUN.R0.i].z = OZ + z1;
  st.f1.position.z = OZ + z1;
  for (const b of st.f1Base) { b.c.minZ = OZ + z1 + b.minZ; b.c.maxZ = OZ + z1 + b.maxZ; }
  for (const c of st.r0Walls) c.maxZ = OZ + z1 - BAY;
  for (const d of [st.dF1L, st.dF1R]) { d.z = z1; d.pv.position.z = OZ + z1; d.col.minZ = OZ + z1 - 0.05; d.col.maxZ = OZ + z1 + 0.05; }
}

// 入口(死んだ後のやり直しは追跡の区間の前 = R2 の始まりから。DESIGN H 第4段の「105 の前から再挑戦」)
export function entryPoint(ctx) {
  if (ctx.state.fromChase) return { x: OX + RUN.R2.xc, z: OZ + RUN.R2.z0 + 0.75, yaw: Math.PI };   // enter() の後に呼ばれる
  return null;
}
export function enter(ctx) {
  reset(ctx, !!ctx.state.retry);
  ctx.state.retry = false;
  ctx.state.log.push({ t: 0, ev: 'enter', fromChase: ctx.state.fromChase });
}
export function leave(ctx) {
  const st = ctx.state, p = ctx.player;
  setRoll(ctx, 0);
  st.U.uWarp.value = 0;
  stopSound(ctx);
  if (ctx.ai && ctx.ai.level === ctx.key) ctx.ai.chaseOmni = false;
  void p;
}
export function dispose(ctx) {
  for (const o of [...ctx.group.children]) { ctx.group.remove(o); o.traverse((m) => { if (m.geometry) m.geometry.dispose(); }); }
  if (ctx.state.mat) ctx.state.mat.dispose();
  ctx.cols.length = 0; ctx.lamps.length = 0;
}

// ================================================================ 毎フレーム
const _v = new THREE.Vector3();
function local(ctx) { const p = ctx.player.pos; return { u: p.x - OX, v: p.z - OZ }; }
// 点のいるレーン(当たりの内側)
function runAt(u, v, st) {
  let best = null, bd = 1e9;
  for (const r of RUNS) {
    if (r.id === 'RL' && st && st.loopDone) continue;
    const end = r.id === 'R0' && st ? st.r0End : r.z1;
    const hw = (v > end - BAY && (r.end === 'fork' || r.end === 'fake')) ? BAYW / 2 : W / 2;
    const dx = Math.max(0, Math.abs(u - r.xc) - hw), dz = Math.max(0, r.z0 - v, v - end);
    const d = dx + dz * 4;
    if (d < bd) { bd = d; best = r; }
  }
  return best;
}
function camFwd(ctx) { ctx.camera.getWorldDirection(_v); _v.y = 0; return _v.normalize(); }

export function update(dt, ctx) {
  const st = ctx.state, U = st.U, pl = ctx.player;
  st.t += dt;
  U.uTime.value += dt;
  U.uPlayer.value.copy(pl.pos);
  const { u, v } = local(ctx);
  const run = runAt(u, v, st);
  st.run = run.id;
  const busy = ctx.busy ? ctx.busy() : false;
  // 霧(廊下の奥の光が見える程度に薄く)
  if (ctx.scene.fog) { ctx.scene.fog.density = X105.fog.density; ctx.scene.fog.color.setHex(X105.fog.color); }
  // ① 伸びる
  const S = X105.stretch;
  if (st.phase === 'start' && run.id === 'R0' && v >= S.from) { st.phase = 'stretch'; st.stretchT = 0; st.backZ = Math.max(0.2, v - S.backGap); st.backOn = true; st.backCol.disabled = false; st.log.push({ t: st.t, ev: 'stretch_start', v }); }
  if (st.phase === 'stretch') {
    st.stretchT += dt;
    const fwd = camFwd(ctx);
    if (!st.release) {
      st.r0End = Math.max(st.r0End, Math.min(S.endMax, v + S.keep));
      if (v >= S.until) { st.release = true; st.log.push({ t: st.t, ev: 'stretch_end', why: 'distance', v }); }
      else if (st.stretchT >= S.time) { st.release = true; st.log.push({ t: st.t, ev: 'stretch_end', why: 'time', v }); }
    } else if (st.r0End < S.endMax) {
      // 時間で終わった時: 見ていない間に最後の位置まで(見ている間は止める)
      if (fwd.z < 0.2) st.r0End = Math.min(S.endMax, st.r0End + S.glide * dt);
    }
    if (st.release && st.r0End >= S.endMax - 1e-6) { st.phase = 'post'; }
    setR0End(ctx, st.r0End);
    // 背後の壁: 振り返っていない間に、来た道を消して背後 backGap m へ寄せる
    if (fwd.z > -0.25) st.backZ = Math.max(st.backZ, v - S.backGap);
    st.frontLog.push([+st.t.toFixed(2), +v.toFixed(2), +(st.r0End - v).toFixed(2)]); if (st.frontLog.length > 4000) st.frontLog.shift();
  }
  if (st.backOn) { st.back.position.set(OX, SPACE_Y, OZ + st.backZ); st.backCol.minZ = OZ + st.backZ - 0.15; st.backCol.maxZ = OZ + st.backZ; }
  // ② 折り返し: RL に入って扉が閉まったら z − 96 へ(R0 の同じ所。見た目の座標・灯りの位相は同じ)
  if (!st.loopDone && run.id === 'RL') {
    const into = v - RUN.RL.z0;
    if (into > X105.loop.closeAt && st.dF2L.target > 0) { st.dF2L.target = 0; st.dF2L.speed = 1 / X105.loop.closeSec; }
    if (into >= X105.loop.jumpAt && st.dF2L.angle <= 0.001 && !busy) {
      const dz = RUN.RL.z0 - RUN.R0.z0;
      const before = { u, v };
      pl.pos.z -= dz;
      pl.object.position.z -= dz;
      st.loopDone = true; st.loopJumpAt = { from: before, to: { u, v: v - dz }, t: st.t };
      st.backOn = false; st.backCol.disabled = true;
      st.dF2L.locked = true; st.dF2R.locked = false;
      U.uRunB.value[RUN.RL.i].x = 0;
      for (const c of [...st.runCols.RL, st.dRLfakeL.col, st.dRLfakeR.col]) c.disabled = true;
      st.log.push({ t: st.t, ev: 'loop', from: before.v, to: v - dz });
    }
  }
  // ③ 反転: 反転の扉(R2 の終わり)を抜けたら
  if (!st.inverted && run.id === 'R3' && v > RUN.R3.z0 + 0.2) { st.inverted = true; st.rollT = 0; st.invAt = st.t; st.log.push({ t: st.t, ev: 'invert', v }); }
  if (st.inverted) {
    st.rollT += dt;
    const k = Math.min(1, st.rollT / X105.roll.sec);
    st.roll = Math.PI * (k * k * (3 - 2 * k));
    if (v > RUN.R3.z0 + 2.0 && !st.dINV.locked) { st.dINV.target = 0; st.dINV.locked = true; st.dINV.speed = 0.8; }
  }
  if (!busy) setRoll(ctx, st.roll);
  // 追跡: R3 の奥へ進むと、反転の扉の前に管理人(悲鳴)→ 追う
  const C = X105.chase;
  if (st.inverted && !st.chase && run.id !== 'R2' && v >= C.at && ctx.ai && ctx.story && ctx.story.aiControl) {
    st.chase = true; st.chaseT = 0; st.retryArmed = true;
    st.offZ = OZ + C.appear[1] - 1.0;
    ctx.ai.chaseOmni = true;
    ctx.ai.appear({ level: ctx.key, x: OX + C.appear[0], z: OZ + C.appear[1], lock: 0, recover: 0.35, slow: C.slow, label: 'appear_105' });
    if (ctx.audio) ctx.audio.play('x105_scream', new THREE.Vector3(OX + C.appear[0], SPACE_Y + 1.6, OZ + C.appear[1]), 1.0, { ref: 6.0 });   // P4b: 採用 x105_scream C(声)
    st.log.push({ t: st.t, ev: 'chase', v });
  }
  if (st.chase) {
    st.chaseT += dt;
    st.warp = Math.min(1, st.chaseT / C.warpIn);
    // 背後から灯りが順に消える(管理人の少し先まで・プレイヤーの offBehind m 手前まで)
    const e = ctx.ai ? ctx.ai.enemy.pos : null;
    const want = Math.min((e && ctx.ai.level === ctx.key ? e.z : st.offZ) + C.offLead, pl.pos.z - C.offBehind);
    if (want > st.offZ) st.offZ = Math.min(want, st.offZ + C.offRate * dt);
  }
  U.uWarp.value = st.warp;
  U.uOffZ.value = st.chase ? st.offZ : -1e4;
  sound(ctx, dt, v);
  // 扉
  for (const d of st.doors) {
    if (d.angle !== d.target) {
      const s = 2.2 * d.speed * dt;
      d.angle += THREE.MathUtils.clamp(d.target - d.angle, -s, s);
      d.pv.rotation.y = -d.angle;
      d.col.disabled = d.angle > 0.35;
    }
  }
  // 出口: 開いた扉を抜けたら 105 の玄関へ(story の戻る口 = exits)
  // 区画の配置と見せる物
  placeSegments(ctx, run, v);
}

// ================================================================ 音(P4b)
//  105 の空気 = 採用 amb_x105 C「長すぎる廊下の静けさ」のループ(src/audio_bank.js)。灰色の区間へ進むほど少し大きく、消えた灯りの所では弱める(仮音の灯具のうなりと同じ曲線)。
//  背後の灯りが消える音(x105_lamp_off)は「なし」なので鳴らさない。追跡の始まりの悲鳴は x105_scream(採用 C・声)を update から鳴らす
function sound(ctx, dt, v) {
  const st = ctx.state, bank = ctx.audio && ctx.audio.bank;
  if (!bank) return;
  if (!st.amb) st.amb = bank.loop('amb_x105');
  const g = Math.min(1, Math.max(0, (v - X105.look.bld) / (X105.look.gray - X105.look.bld)));
  const dark = st.chase && v - (st.offZ - OZ) < 3 ? 0.5 : 1;
  st.amb.set((0.6 + 0.4 * g) * dark);
}
function stopSound(ctx) { const st = ctx.state; if (st.amb) st.amb.set(0); st.amb = null; }

function setRoll(ctx, roll) {
  const pl = ctx.player;
  pl.object.rotation.z = roll;
  const inv = roll > Math.PI / 2;
  pl.invert = inv;
  if (pl.controls) pl.controls.pointerSpeed = inv ? -1 : 1;
}

// 近いレーン(今・次・前)の区画をプールから置く。決まった部品も近いレーンの物だけ見せる
function placeSegments(ctx, run, v) {
  const st = ctx.state;
  const near = new Set([run.id, ...(NEXT[run.id] || []), PREV[run.id]].filter(Boolean));
  if (st.loopDone) near.delete('RL');
  const want = [];
  for (const id of near) {
    const r = RUN[id];
    const end = id === 'R0' ? st.r0End : r.z1;
    const from = id === 'R0' && st.backOn ? Math.max(r.z0, st.backZ - SEG) : r.z0;
    for (let z = r.z0; z < end - BAY - 1e-3; z += SEG) {
      if (z + SEG < from) continue;
      const d = z + SEG < v ? v - (z + SEG) : z > v ? z - v : 0;
      if ((z > v && d > X105.ahead) || (z < v && d > X105.behind)) continue;
      want.push({ key: id + ':' + z, x: r.xc, z, d: d + (id === run.id ? 0 : 3) });
    }
  }
  want.sort((a, b) => a.d - b.d);
  const keep = new Set(want.slice(0, st.pool.length).map((w) => w.key));
  const free = [];
  for (const m of st.pool) { if (m.userData.slot && keep.has(m.userData.slot)) keep.delete(m.userData.slot); else { m.visible = false; m.userData.slot = null; free.push(m); } }
  for (const w of want.slice(0, st.pool.length)) {
    if (!keep.has(w.key)) continue;
    const m = free.pop(); if (!m) break;
    m.userData.slot = w.key; m.position.set(OX + w.x, SPACE_Y, OZ + w.z); m.visible = true;
  }
  for (const m of st.pieces) m.visible = m.userData.runs.some((id) => near.has(id)) && (m !== st.back || st.backOn);
  st.placed = st.pool.filter((m) => m.visible).length;
}

// ================================================================ 物語とのつなぎ
// 戻る口: 105 の扉(伸びる前だけ)と、出口の扉(抜けると 105 の玄関)
export function exits(ctx) {
  const st = ctx.state, out = [];
  if (st.phase === 'start' && !st.fromChase) out.push({ x: OX, z: OZ + 0.02, n: [0, 1], auto: true, reach: 1.3, depth: 0.45, half: 0.6 });
  out.push({ x: OX + RUN.R4.xc, z: OZ + RUN.R4.z1, n: [0, -1], auto: true, reach: 0, depth: 0.12, half: 0.55, onLeave: () => onExit(ctx) });
  return out;
}
function onExit(ctx) {
  const st = ctx.state;
  st.exited = true; st.log.push({ t: st.t, ev: 'exit' });
  const s = ctx.story;
  // メモを拾わずに出た時は、出る時に拾ったことにする(第5段へ進める)
  if (s && s.active && s.stage === 4 && !s.taken.has('memo6F')) { s.pick('memo6F'); st.log.push({ t: st.t, ev: 'memo_auto' }); }
  if (ctx.ai && ctx.ai.level === ctx.key) { ctx.ai.chaseOmni = false; if (s && s.onAIReset) s.onAIReset(); }
}
// この空間で死んだ時: 105 の扉の前(扉を向く)。次に入ると追跡の区間の前から
export function respawn(ctx) {
  const b = ctx.def.back;
  if (ctx.state.chase) ctx.state.retry = true;
  if (ctx.ai) ctx.ai.chaseOmni = false;
  return { level: b.level, x: b.x, z: b.z, yaw: b.yaw + Math.PI };
}
// 画面ガイドの対象: 空間の中の扉(開ける・閉める・鍵がかかっている)
export function target(ctx, look) {
  const st = ctx.state;
  let best = null, bd = 1e9;
  for (const d of st.doors) {
    if (!d.pv.visible || d.id === 'EXIT' || d.id.startsWith('FL')) continue;
    if (d.id === '105' && st.phase === 'start' && !st.fromChase) continue;   // 伸びる前は「戻る」
    const dd = look(OX + d.x, OZ + d.z, 1.5);
    if (dd >= 0 && dd < bd) { bd = dd; best = d; }
  }
  if (!best) return null;
  const d = best;
  const open = d.target > 0.05;
  return { d: bd, door: d.id, items: [open ? { key: 'E', text: '閉める' } : { key: 'E', text: '開ける' }], use: () => useDoor(ctx, d) };
}
function useDoor(ctx, d) {
  const st = ctx.state;
  if (d.locked || (d.id === '105')) {
    if (ctx.hud) ctx.hud.flash(d.id === '105' ? '開かない' : '鍵がかかっている');
    if (ctx.story && ctx.story._sfx) ctx.story._sfx('rattle');
    d.rattle = 0.25;
    st.log.push({ t: st.t, ev: 'door_locked', id: d.id });
    return 'locked';
  }
  d.target = d.target > 0.05 ? 0 : 1.45; d.speed = 1;
  st.log.push({ t: st.t, ev: d.target > 0 ? 'door_open' : 'door_close', id: d.id });
  return 'door';
}

// 管理人の経路(追跡の区間 R2→R3→R4。違うレーンなら扉を通る)
export function nav(ctx, fx, fz, tx, tz) {
  const st = ctx.state;
  const a = runAt(fx - OX, fz - OZ, st), b = runAt(tx - OX, tz - OZ, st);
  const ia = CHAIN.indexOf(a.id), ib = CHAIN.indexOf(b.id);
  if (ia < 0 || ib < 0 || ia === ib) return [{ x: tx, z: tz }];
  const pts = [];
  let z = fz - OZ;
  if (ib > ia) {
    for (let i = ia; i < ib; i++) {
      const r = RUN[CHAIN[i]], nx = RUN[CHAIN[i + 1]].xc;
      if (r.end === 'fork' && z < r.z1 - BAY - 0.3) pts.push({ x: OX + r.xc + Math.sign(nx - r.xc) * 0.35, z: OZ + r.z1 - BAY - 0.3 });
      pts.push({ x: OX + nx, z: OZ + r.z1 - 0.7 }, { x: OX + nx, z: OZ + r.z1 + 0.8 });
      z = r.z1 + 0.8;
    }
  } else {
    for (let i = ia; i > ib; i--) {
      const r = RUN[CHAIN[i]], pr = RUN[CHAIN[i - 1]];
      pts.push({ x: OX + r.xc, z: OZ + r.z0 + 0.8 }, { x: OX + r.xc, z: OZ + r.z0 - 0.7 });
      if (pr.end === 'fork') pts.push({ x: OX + pr.xc, z: OZ + pr.z1 - BAY - 0.3 });
    }
  }
  pts.push({ x: tx, z: tz });
  return pts;
}

// テスト・スクショ用
export function debug(ctx) {
  const st = ctx.state;
  return {
    X105, RUNS, st,
    state: () => ({ phase: st.phase, run: st.run, r0End: +st.r0End.toFixed(2), backZ: st.backZ, loopDone: st.loopDone, inverted: st.inverted, roll: +st.roll.toFixed(4),
      chase: st.chase, warp: st.warp, offZ: st.chase ? +(st.offZ - OZ).toFixed(2) : null, exited: st.exited, placed: st.placed, log: st.log.slice(-30) }),
    // 段取りを飛ばす: 'post'(伸びた後)・'loopDone'(折り返しの後)
    skip(what) {
      if (what === 'post' || what === 'loopDone') { st.phase = 'post'; st.release = true; setR0End(ctx, RUN.R0.z1); st.backOn = false; st.backCol.disabled = true; }
      if (what === 'loopDone') { st.loopDone = true; st.dF2L.locked = true; st.dF2R.locked = false; st.U.uRunB.value[RUN.RL.i].x = 0; for (const c of st.runCols.RL) c.disabled = true; }
    },
    lampsOff: () => { if (!st.chase) return { off: 0, maxOffZ: null }; let off = 0; for (const id of ['R2', 'R3', 'R4']) { const r = RUN[id]; for (let z = r.z0 + SEG / 2; z < r.z1 - BAY; z += SEG) if (OZ + z < st.offZ) off++; } return { off, offZ: +(st.offZ - OZ).toFixed(2) }; },
    door: (id) => st.doors.find((d) => d.id === id),
    local: (x, z) => ({ u: x - OX, v: z - OZ }), world: (u, v) => ({ x: OX + u, z: OZ + v }),
  };
}
