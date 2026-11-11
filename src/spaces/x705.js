// spaces/x705.js — 別空間 X705「705 管理人の部屋」(DESIGN §3.8 I 3 行目・H 第9段)。P5b-2b。
//  1K の玄関(木の床・白い壁)を入ると、ありえない広さの柱と天窓の大広間(参考 06: 暖色の床タイル・等間隔の角柱・天窓から差す光)。
//  天窓の外は夜空ではなく廊下の常夜灯(建物の内側を見上げている)。中央に管理人の机、キーボックスから消えた鍵束(鍵の板)と住人の持ち物の山。
//  机に地下の鉄扉の鍵(slot key。story.js の kB1)。
//  異世界の要素: ①増える(奥へ進むほど柱が増える。机に近づくと背後の出口が柱の列に隠れる。柱は見ていない間・離れた所にだけ足す)
//   ②反転(鍵を取ると広間の灯りが一斉に消え、出口は最初と反対側(南の壁)。管理人はそこから現れる = slot ambush。北の入口はふさがる)
//   ③歪み(追跡中は柱の間隔が詰まり床のタイルが傾く。頂点シェーダだけ。当たりは変えない)
//  追跡: 鍵を取ると story が第9段「逃げろ」・管理人を ambush へ(_startFinalChase)。このモジュールは管理人に全知(chaseOmni)と広間の経路(nav = 格子の A*)を与え、
//   出口の出入り口(ai.portals の X705)を南の出口に付け替える。南の出口を抜けると 7F の 705 の前へ。
//   P6b-H(§3.14 #2): 出口を抜けたら追跡は終わり(story._startEscape: 管理人は 7F 以外へ・7F を 45 秒避ける・目標「エレベーターで1階へ」)。
//  光はすべてシェーダの中の計算(天窓の格子・玄関と出口の灯り。three.js のライトは足さない)＋懐中電灯。
//  座標: 局所 u = x − 420、v = z。y は SPACE_Y からの高さ。北(v 0)が入口、南(v 50)が反転後の出口。

import * as THREE from 'three';
import { SPACE_Y } from '../world.js';
import { GB, GLSL_NOISE, rng } from './gb.js';

const OX = 420, OZ = 0;
// 調整値(docs/p5b2b/NOTES.md §3)
export const X705 = {
  hall: { u0: -15, u1: 15, v0: 3, v1: 47, h: 4.4 },
  genkan: { w: 1.2, h: 2.4, n: [0, 3], s: [47, 50] },          // 北の玄関(入口)・南の玄関(反転後の出口)の v の範囲
  sky: { u: [-8, 0, 8], v: [9, 17, 25, 33, 41], w: 2.4, d: 3.2, well: 1.0 },   // 天窓(中心の格子)
  desk: { u: 0, v: 31.4, w: 1.8, d: 0.8 },
  pillar: { s: 0.56, base: 0.66 },
  grow: { fillLead: 6, screenAt: 22, deepAt: 26, minDist: 1.6, margin: 0.4 },  // ①増える
  lightsOff: { flicker: 0.35, dim: 0.035 },                     // ②反転: 灯りが消える秒・残る天窓のかすかな明るさ
  warp: { inSec: 2.0, near: 3.5, squeeze: 0.32, tilt: 0.045 },  // ③歪み
  fog: { on: [0x0a0705, 0.036], off: [0x020202, 0.05] },
  nav: { cell: 0.5, inflate: 0.42 },
};
const HL = X705.hall, G = X705.genkan, SK = X705.sky, DK = X705.desk;

export const DEF = {
  origin: [OX, OZ], host: { level: 7, door: '705' },
  entry: [0, 0.75, Math.PI],          // 北の玄関の内側・奥(南)を向く
  exit: [0, 0.02],                    // 入口の扉(反転の前の戻る口)
  slots: {
    desk: [DK.u, 0.0, DK.v],
    key: [0.22, 0.765, DK.v + 0.1],   // 地下の鉄扉の鍵(机の天板の手前の縁の近く。机の前から 1.45m 以内)
    ambush: [0, 0.0, 46.3],           // 管理人が現れる所(反転後の出口 = 南の玄関の口)
  },
};
const X = (u) => OX + u, Y = (h) => SPACE_Y + h, Z = (v) => OZ + v;

// 柱(局所 u, v・種類)。base = 最初から / fill = 奥へ進むと(±8 の列)/ screen = 机に近づくと背後に(入口の線上)/ deep = 机の奥の林
function pillarList() {
  const out = [];
  for (let v = 7; v <= 43; v += 4) for (const u of [-12, -8, -4, 0, 4, 8, 12]) {
    let kind = Math.abs(u) === 8 ? 'fill' : (Math.abs(u) === 12 || Math.abs(u) === 4) ? 'base' : (v <= 23 ? 'screen' : null);
    if (Math.abs(u) <= 4 && (v === 31 || v === 35)) kind = null;   // 机のまわり(広場)
    if (kind) out.push({ u, v, kind });
  }
  for (const v of [9, 13, 17, 21]) for (const u of [-2, 2]) out.push({ u, v, kind: 'screen' });
  for (const [u, v] of [[-2, 41], [2, 41], [-6, 37], [6, 37], [-6, 45], [6, 45], [-10, 41], [10, 41], [-10, 45], [10, 45]]) out.push({ u, v, kind: 'deep' });
  return out.map((p, i) => ({ ...p, i }));
}

// ================================================================ 材質
const SURF = { floor: 0, wall: 1, ceil: 2, well: 3, skyView: 4, pillar: 5, wood: 6, white: 7, door: 8, dark: 9, prop: 10, glass: 11, metal: 12, exitGlow: 13, lamp: 14, base: 15, tag: 16 };
function makeMaterial(U) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.0 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aSurf; attribute vec3 aCol;
        uniform float uTime, uWarp; uniform vec3 uPlayer; uniform vec2 uTilt;
        varying vec3 vWP; varying float vSurf; varying vec3 vCol;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
        #ifdef USE_INSTANCING
          // ③歪み: 柱の間隔が詰まる(プレイヤーから ${X705.warp.near}m より遠い柱を寄せる。当たりはそのまま)
          vec3 ic = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          vec2 d = ic.xz - uPlayer.xz; float L = length(d);
          float L2 = L > ${X705.warp.near.toFixed(2)} ? ${X705.warp.near.toFixed(2)} + (L - ${X705.warp.near.toFixed(2)}) * (1.0 - ${X705.warp.squeeze.toFixed(2)} * uWarp) : L;
          if (L > 0.001) transformed.xz += d / L * (L2 - L);
        #else
          // ③歪み: 床が傾く(プレイヤーから 4m より遠い所だけ、ゆっくり回る向きへ)
          if (aSurf < 0.5) {
            vec3 wp = (modelMatrix * vec4(transformed, 1.0)).xyz; vec2 d = wp.xz - uPlayer.xz; float L = length(d);
            transformed.y += uWarp * ${X705.warp.tilt.toFixed(3)} * max(L - 4.0, 0.0) * dot(d / max(L, 0.001), uTilt);
          }
        #endif
        }`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        { vec4 q = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          q = instanceMatrix * q;
        #endif
          vWP = (modelMatrix * q).xyz; vSurf = aSurf; vCol = aCol; }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime, uY, uOn, uDim, uWarp; uniform vec3 uPlayer; uniform vec4 uExitL, uGenL; uniform float uOpenS;
        varying vec3 vWP; varying float vSurf; varying vec3 vCol;
        ${GLSL_NOISE}
        mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 P = vWP; float fy = P.y - uY; int S = int(vSurf + 0.5);
        vec2 Lc = P.xz - vec2(${OX.toFixed(1)}, ${OZ.toFixed(1)});
        vec3 nW0 = normalize(cross(dFdx(vWP), dFdy(vWP)));
        vec3 col = vec3(0.5); float rgh = 0.6; float mtl = 0.0;
        if (S == 0) {
          // 暖色の床タイル(60cm 角・色違いを散らす)。歪みの間は遠いほど目地が回る
          vec2 pl = uPlayer.xz - vec2(${OX.toFixed(1)}, ${OZ.toFixed(1)});
          float dP = length(Lc - pl);
          vec2 q = pl + rot2(uWarp * 0.22 * smoothstep(3.0, 16.0, dP) * sin(uTime * 0.35 + dP * 0.08)) * (Lc - pl);
          vec2 t = q / 0.6; vec2 c = floor(t); vec2 f = fract(t);
          float h = h21(c);
          vec3 a = h < 0.34 ? vec3(0.46, 0.36, 0.26) : h < 0.6 ? vec3(0.56, 0.46, 0.33) : h < 0.8 ? vec3(0.36, 0.26, 0.18) : h < 0.93 ? vec3(0.50, 0.47, 0.42) : vec3(0.64, 0.54, 0.40);
          col = a * 0.8 * (0.86 + 0.22 * vnoise(q * 2.3 + c * 7.0));
          float e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
          float aa = max(fwidth(t.x), fwidth(t.y));
          float gr = (1.0 - smoothstep(0.012, 0.012 + aa, e)) * clamp(1.4 - aa * 6.0, 0.0, 1.0);
          col = mix(col, vec3(0.14, 0.11, 0.08), gr * 0.75);
          rgh = mix(0.2 + 0.18 * vnoise(q * 0.6), 0.7, gr);
        } else if (S == 1) {      // 壁: 漆喰(ベージュ)
          vec2 qa = abs(nW0.x) > 0.5 ? vec2(P.z, fy) : vec2(P.x, fy);
          col = vec3(0.58, 0.52, 0.44) * (0.93 + 0.1 * vnoise(qa * 1.7)); rgh = 0.85;
        } else if (S == 2) {      // 天井(白い漆喰)
          col = vec3(0.42, 0.40, 0.37) * (0.95 + 0.06 * vnoise(Lc * 0.8)); rgh = 0.9;
        } else if (S == 3) {      // 天窓の井戸の側面
          col = vec3(0.7, 0.68, 0.62); rgh = 0.9;
        } else if (S == 4) {      // 天窓の向こう(emissive で描く)
          col = vec3(0.0); rgh = 1.0;
        } else if (S == 5 || S == 15) {   // 角柱(白)・台座(濃い)
          col = S == 5 ? vec3(0.66, 0.64, 0.6) * (0.94 + 0.08 * vnoise(vec2(P.x + P.z, fy) * 2.0)) : vec3(0.12, 0.11, 0.1);
          col *= mix(0.72, 1.0, smoothstep(0.0, 1.1, fy));
          rgh = S == 5 ? 0.6 : 0.4;
        } else if (S == 6) {      // 木(玄関の床・机)
          vec2 qw = abs(nW0.y) > 0.5 ? P.xz : vec2(P.x + P.z, fy);
          col = vec3(0.30, 0.19, 0.11) * (0.8 + 0.3 * h21(vec2(floor(qw.x / 0.13), 3.0))) * (0.9 + 0.15 * vnoise(qw * vec2(1.5, 24.0))); rgh = 0.45;
        } else if (S == 7) { col = vec3(0.62, 0.61, 0.58); rgh = 0.9;
        } else if (S == 8) { col = vec3(0.27, 0.16, 0.08) * (0.85 + 0.3 * h21(vec2(floor(fy * 30.0), 1.0))); rgh = 0.55;
        } else if (S == 9) { col = vec3(0.045, 0.042, 0.04); rgh = 0.5;
        } else if (S == 10 || S == 16) { col = vCol * (0.9 + 0.15 * vnoise(P.xz * 9.0 + fy * 5.0)); rgh = S == 16 ? 0.5 : 0.8;
        } else if (S == 11) { col = vec3(0.018, 0.02, 0.022); rgh = 0.08;
        } else if (S == 12) { col = vCol; rgh = 0.32; mtl = 0.85;
        } else { col = vec3(0.0); rgh = 1.0; }
        diffuseColor.rgb = col;
        float xR = rgh, xM = mtl;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = xR;`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = xM;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (S == 4) {
          // 天窓の向こう: 夜空ではなく建物の廊下の天井(格子の天井板・丸い常夜灯・両脇の壁)。ガラスの枠(十字)
          vec2 cs = vec2(${SK.u[0].toFixed(1)} + floor((Lc.x - ${SK.u[0].toFixed(1)}) / 8.0 + 0.5) * 8.0, ${SK.v[0].toFixed(1)} + floor((Lc.y - ${SK.v[0].toFixed(1)}) / 8.0 + 0.5) * 8.0);
          vec2 q = Lc - cs;
          float wall = smoothstep(0.78, 0.84, abs(q.x));
          vec2 g = abs(fract(q / 0.6 + 0.5) - 0.5);
          float board = 1.0 - (1.0 - smoothstep(0.0, 0.03, g.x)) * 0.4 - (1.0 - smoothstep(0.0, 0.03, g.y)) * 0.4;
          vec3 ceil = vec3(0.30, 0.27, 0.22) * board;
          vec3 wl = vec3(0.13, 0.12, 0.10) * (1.0 - smoothstep(0.84, 1.2, abs(q.x)));
          float r = length(q);
          vec3 lamp = vec3(1.0, 0.86, 0.62) * (smoothstep(0.17, 0.15, r) * 2.4 + 0.5 * exp(-r * r * 3.0));
          vec3 v = mix(ceil, wl, wall) * (0.35 + 0.65 * exp(-r * r * 0.35)) + lamp;
          float fr = 1.0 - (1.0 - smoothstep(0.02, 0.035, abs(q.x))) * (1.0 - smoothstep(0.02, 0.035, abs(q.y))) * 0.0;
          float bar = max(1.0 - smoothstep(0.02, 0.035, abs(q.x)), 1.0 - smoothstep(0.02, 0.035, abs(q.y)));
          v = mix(v, vec3(0.01), bar);
          totalEmissiveRadiance += v * (uOn * 0.95 + uDim) * fr;
        }
        if (S == 13) totalEmissiveRadiance += vec3(1.0, 0.82, 0.58) * 1.6 * uOpenS;
        if (S == 14) totalEmissiveRadiance += vec3(1.0, 0.9, 0.75) * 1.1 * uGenL.w * 6.0;`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        if (S != 4 && S != 13 && S != 14) {
          vec3 n = inverseTransformDirection(normal, viewMatrix);
          vec3 V = normalize(cameraPosition - P);
          vec3 irr = vec3(0.0), sp = vec3(0.0);
          bool gloss = (S == 0 || S == 11 || S == 12);
          float k = uOn + uDim;
          float gk = Lc.y < ${HL.v0.toFixed(1)} ? 0.12 : 1.0;   // 玄関の中には天窓の光はほとんど届かない
          if (k > 0.001) {
            // 天窓(格子の近い 3×3)。下向きの面光源のつもり(真下が明るく、斜めは弱い)
            float gi = clamp(floor((Lc.x - ${SK.u[0].toFixed(1)}) / 8.0 + 0.5), 0.0, ${(SK.u.length - 1).toFixed(1)});
            float gj = clamp(floor((Lc.y - ${SK.v[0].toFixed(1)}) / 8.0 + 0.5), 0.0, ${(SK.v.length - 1).toFixed(1)});
            int Rk = uOn > 0.01 ? 1 : 0;   // 消灯後は真上の天窓のかすかな光だけ(性能)
            for (int a = -1; a <= 1; a++) for (int b = -1; b <= 1; b++) {
              if (abs(a) > Rk || abs(b) > Rk) continue;
              float i = gi + float(a), j = gj + float(b);
              if (i < 0.0 || i > ${(SK.u.length - 1).toFixed(1)} || j < 0.0 || j > ${(SK.v.length - 1).toFixed(1)}) continue;
              vec3 c = vec3(${(OX + SK.u[0]).toFixed(1)} + i * 8.0, uY + ${(HL.h + 0.3).toFixed(2)}, ${(OZ + SK.v[0]).toFixed(1)} + j * 8.0);
              vec3 d = c - P; float r2 = dot(d, d); vec3 l = d * inversesqrt(r2);
              float em = 0.18 + 0.82 * pow(max(l.y, 0.0), 4.0);
              float nd = max(dot(n, l), 0.0) * 0.85 + 0.15;
              irr += vec3(1.0, 0.84, 0.62) * nd * em * 5.5 / (r2 + 4.0) * gk;
              if (gloss) { vec3 hv = normalize(l + V); sp += vec3(1.0, 0.88, 0.7) * pow(max(dot(n, hv), 0.0), S == 0 ? 40.0 : 120.0) * em * 6.0 / (r2 * 0.3 + 2.0); }
            }
            irr = irr * k + vec3(0.022, 0.017, 0.012) * uOn * gk;
            sp *= k;
          }
          // 玄関の灯り・反転後の出口(少し開いた扉の向こうの廊下の灯り)
          for (int q = 0; q < 2; q++) {
            vec4 Lp = q == 0 ? uGenL : uExitL; if (Lp.w <= 0.0) continue;
            vec3 d = Lp.xyz - P; float r2 = dot(d, d); vec3 l = d * inversesqrt(r2);
            irr += vec3(1.0, 0.84, 0.62) * Lp.w * (max(dot(n, l), 0.0) * 0.8 + 0.2) / (r2 + 0.6);
            if (gloss) { vec3 hv = normalize(l + V); sp += vec3(1.0, 0.85, 0.65) * Lp.w * pow(max(dot(n, hv), 0.0), 50.0) * 2.0 / (r2 * 0.3 + 1.0); }
          }
          reflectedLight.indirectDiffuse += diffuseColor.rgb * irr;
          reflectedLight.indirectSpecular += sp * (1.0 - xR * 0.8) * (S == 0 ? 0.35 : 0.6);
        }`);
  };
  m.customProgramCacheKey = () => 'n2_x705_v1';
  return m;
}

// 天窓から差す光の筋(加算・奥行きを書かない)。灯りが消えると消える
function makeShaftMaterial(U) {
  return new THREE.ShaderMaterial({
    uniforms: { uOn: U.uOn, uTime: U.uTime, uY: U.uY },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    vertexShader: `
      varying vec3 vWP; varying vec3 vN;
      void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `
      uniform float uOn, uTime, uY; varying vec3 vWP; varying vec3 vN;
      ${GLSL_NOISE}
      void main() {
        float fy = vWP.y - uY;
        vec3 V = normalize(cameraPosition - vWP);
        float side = pow(1.0 - abs(dot(V, vN)), 1.5);
        float h = clamp(fy / ${HL.h.toFixed(2)}, 0.0, 1.0);
        float dc = distance(cameraPosition, vWP);
        float a = (0.1 + 0.9 * h * h) * side * 0.03 * (0.75 + 0.5 * vnoise(vWP.xz * 1.3 + vec2(uTime * 0.05, fy * 0.4)));
        a *= smoothstep(1.2, 4.0, dc) * exp(-dc * 0.025);
        gl_FragColor = vec4(vec3(1.0, 0.85, 0.62) * a * uOn, 1.0);
      }`,
  });
}

// ================================================================ ジオメトリ
function genkan(b, v0, v1, doorAt, ny) {
  const hw = G.w / 2;
  const [z0, z1] = [Z(v0), Z(v1)];
  b.surf = SURF.wood; b.floor(X(-hw), X(hw), z0, z1, Y(0), true);
  b.surf = SURF.white; b.floor(X(-hw), X(hw), z0, z1, Y(G.h), false);
  b.wallX(X(-hw), z0, z1, Y(0), Y(G.h), 1); b.wallX(X(hw), z0, z1, Y(0), Y(G.h), -1);
  // 扉の壁(扉の開口)と枠
  const zd = Z(doorAt), inw = ny;   // inw = 扉の壁の内向き(z)
  b.wallZ(zd, X(-hw), X(-0.41), Y(0), Y(G.h), inw); b.wallZ(zd, X(0.41), X(hw), Y(0), Y(G.h), inw); b.wallZ(zd, X(-0.41), X(0.41), Y(2.05), Y(G.h), inw);
  b.surf = SURF.dark;
  const t = 0.07 * inw;
  for (const [a, c] of [[-0.47, -0.41], [0.41, 0.47]]) b.box(X(a), Y(0), Math.min(zd, zd + t), X(c), Y(2.1), Math.max(zd, zd + t));
  b.box(X(-0.47), Y(2.04), Math.min(zd, zd + t), X(0.47), Y(2.1), Math.max(zd, zd + t));
  // 上がり框・天井の灯り
  b.surf = SURF.dark; { const zf = Z(doorAt + inw * 0.9); b.box(X(-hw), Y(0), Math.min(zf, zf + 0.04 * inw), X(hw), Y(0.04), Math.max(zf, zf + 0.04 * inw), 'py pz nz'); }
  b.surf = SURF.lamp; { const zc = Z(doorAt + inw * 1.6); b.box(X(-0.14), Y(G.h - 0.02), zc - 0.14, X(0.14), Y(G.h - 0.005), zc + 0.14, 'ny'); }
}

function buildHall(b) {
  const hw = G.w / 2;
  // 床(2m の格子に分ける = 歪みの床の傾き用)
  b.surf = SURF.floor; b.floor(X(HL.u0), X(HL.u1), Z(HL.v0), Z(HL.v1), Y(0), true, 15, 22);
  // 天井(天窓の穴を抜く: 天窓の列と行の間の帯で組む)
  b.surf = SURF.ceil;
  const us = [HL.u0]; for (const u of SK.u) us.push(u - SK.w / 2, u + SK.w / 2); us.push(HL.u1);
  const vs = [HL.v0]; for (const v of SK.v) vs.push(v - SK.d / 2, v + SK.d / 2); vs.push(HL.v1);
  for (let i = 0; i < us.length - 1; i++) for (let j = 0; j < vs.length - 1; j++) {
    if (i % 2 === 1 && j % 2 === 1) continue;   // 天窓
    b.floor(X(us[i]), X(us[i + 1]), Z(vs[j]), Z(vs[j + 1]), Y(HL.h), false);
  }
  // 天窓の井戸(側面)と向こうの面
  for (const u of SK.u) for (const v of SK.v) {
    const x0 = X(u - SK.w / 2), x1 = X(u + SK.w / 2), z0 = Z(v - SK.d / 2), z1 = Z(v + SK.d / 2), y0 = Y(HL.h), y1 = Y(HL.h + SK.well);
    b.surf = SURF.well; b.wallX(x0, z0, z1, y0, y1, 1); b.wallX(x1, z0, z1, y0, y1, -1); b.wallZ(z0, x0, x1, y0, y1, 1); b.wallZ(z1, x0, x1, y0, y1, -1);
    b.surf = SURF.skyView; b.floor(x0, x1, z0, z1, y1, false);
  }
  // 壁: 東西は暗いガラスの店先(参考 06 の左右)＋上の漆喰、南北は漆喰。北は玄関の口、南は反転後の口(ふさぐ板は別メッシュ)
  for (const [u, nx] of [[HL.u0, 1], [HL.u1, -1]]) {
    b.surf = SURF.glass; b.wallX(X(u), Z(HL.v0), Z(HL.v1), Y(0.12), Y(3.0), nx);
    b.surf = SURF.wall; b.wallX(X(u), Z(HL.v0), Z(HL.v1), Y(3.0), Y(HL.h), nx); b.wallX(X(u), Z(HL.v0), Z(HL.v1), Y(0), Y(0.12), nx);
    b.surf = SURF.dark;   // 店先の枠(縦の桟 4m ごと・上の横桟)
    for (let v = HL.v0 + 2; v < HL.v1; v += 4) b.box(X(u) - 0.06, Y(0), Z(v) - 0.06, X(u) + 0.06, Y(3.05), Z(v) + 0.06, nx > 0 ? 'px pz nz' : 'nx pz nz');
    b.box(X(u) - 0.05, Y(2.98), Z(HL.v0), X(u) + 0.05, Y(3.06), Z(HL.v1), nx > 0 ? 'px ny py' : 'nx ny py');
  }
  b.surf = SURF.wall;
  for (const [v, nz] of [[HL.v0, 1], [HL.v1, -1]]) {
    b.wallZ(Z(v), X(HL.u0), X(-hw), Y(0), Y(HL.h), nz); b.wallZ(Z(v), X(hw), X(HL.u1), Y(0), Y(HL.h), nz); b.wallZ(Z(v), X(-hw), X(hw), Y(G.h), Y(HL.h), nz);
  }
  // 幅木
  b.surf = SURF.base;
  b.box(X(HL.u0), Y(0), Z(HL.v0), X(-hw), Y(0.1), Z(HL.v0) + 0.012, 'pz py'); b.box(X(hw), Y(0), Z(HL.v0), X(HL.u1), Y(0.1), Z(HL.v0) + 0.012, 'pz py');
  b.box(X(HL.u0), Y(0), Z(HL.v1) - 0.012, X(-hw), Y(0.1), Z(HL.v1), 'nz py'); b.box(X(hw), Y(0), Z(HL.v1) - 0.012, X(HL.u1), Y(0.1), Z(HL.v1), 'nz py');
}

// 机・鍵の板(キーボックスから消えた鍵)・住人の持ち物の山
function buildDesk(b, R) {
  const { u, v, w, d } = DK;
  // 机(木の天板・袖・脚)と椅子
  b.surf = SURF.wood;
  b.box(X(u - w / 2), Y(0.72), Z(v), X(u + w / 2), Y(0.76), Z(v + d));
  b.box(X(u + w / 2 - 0.45), Y(0.0), Z(v + 0.05), X(u + w / 2 - 0.03), Y(0.72), Z(v + d - 0.05), 'px nx pz nz');
  b.surf = SURF.dark;
  for (const [a, c] of [[u - w / 2 + 0.04, v + 0.06], [u - w / 2 + 0.04, v + d - 0.1]]) b.box(X(a), Y(0), Z(c), X(a + 0.05), Y(0.72), Z(c + 0.05));
  b.box(X(u - 0.25), Y(0.44), Z(v + d + 0.25), X(u + 0.25), Y(0.49), Z(v + d + 0.7));          // 椅子の座面
  b.box(X(u - 0.25), Y(0.49), Z(v + d + 0.66), X(u + 0.25), Y(1.0), Z(v + d + 0.71));         // 背
  b.box(X(u - 0.03), Y(0), Z(v + d + 0.45), X(u + 0.03), Y(0.44), Z(v + d + 0.5));
  // 机の上: 鍵束(輪に通した鍵)・帳面・古い卓上ライト(消えている)
  b.surf = SURF.metal;
  for (let k = 0; k < 5; k++) {
    const cx = X(u - 0.7 + k * 0.17 + R() * 0.05), cz = Z(v + 0.3 + R() * 0.3);
    b.col = [0.42, 0.37, 0.26];
    b.addGeo(new THREE.TorusGeometry(0.035, 0.004, 5, 14).rotateX(Math.PI / 2), new THREE.Matrix4().makeTranslation(cx, Y(0.765), cz));
    for (let j = 0; j < 6; j++) { const a = R() * Math.PI * 2; b.col = R() < 0.5 ? [0.46, 0.4, 0.25] : [0.42, 0.42, 0.4]; b.rbox(cx + Math.cos(a) * 0.06, Y(0.764), cz + Math.sin(a) * 0.06, 0.05, 0.004, 0.017, -a); }
  }
  b.surf = SURF.prop; b.col = [0.42, 0.36, 0.26]; b.rbox(X(u + 0.45), Y(0.775), Z(v + 0.45), 0.3, 0.025, 0.22, 0.15);
  b.col = [0.18, 0.16, 0.14]; b.rbox(X(u + 0.62), Y(0.77), Z(v + 0.65), 0.12, 0.02, 0.12); b.rbox(X(u + 0.62), Y(0.95), Z(v + 0.68), 0.02, 0.36, 0.02, 0, 0.25);
  // 鍵の板(机の奥。自立の枠に有孔板・部屋番号の札付きの鍵がびっしり)。左右 2 枚の間は空ける(南の出口から現れる管理人が机の前から見える)
  const tags = [[0.75, 0.2, 0.16], [0.86, 0.74, 0.3], [0.25, 0.42, 0.68], [0.82, 0.8, 0.74], [0.3, 0.55, 0.32]];
  for (const kb of KEYBOARDS.map(([a0, a1]) => ({ u0: u + a0, u1: u + a1, v: v + d + 1.25, y0: 0.55, y1: 2.05 }))) {
    b.surf = SURF.dark;
    b.box(X(kb.u0), Y(kb.y0), Z(kb.v), X(kb.u1), Y(kb.y1), Z(kb.v + 0.03));
    for (const a of [kb.u0, kb.u1 - 0.05]) b.box(X(a), Y(0), Z(kb.v - 0.2), X(a + 0.05), Y(kb.y1 + 0.05), Z(kb.v + 0.25), 'px nx py pz nz');
    const nc = 7;
    for (let r = 0; r < 9; r++) for (let c = 0; c < nc; c++) {
      if (R() < 0.05) continue;
      const kx = X(kb.u0 + 0.12 + c * ((kb.u1 - kb.u0 - 0.24) / (nc - 1))), ky = Y(kb.y1 - 0.1 - r * 0.16), kz = Z(kb.v) - 0.012;
      const sw = (R() - 0.5) * 0.25;
      b.surf = SURF.metal; b.col = [0.6, 0.6, 0.58]; b.rbox(kx, ky - 0.005, kz, 0.004, 0.02, 0.012);   // フック
      b.col = R() < 0.6 ? [0.68, 0.6, 0.38] : [0.64, 0.64, 0.62]; b.rbox(kx, ky - 0.045, kz - 0.006, 0.016, 0.05, 0.003, 0, 0, sw);   // 鍵
      b.surf = SURF.tag; b.col = tags[(R() * tags.length) | 0]; b.rbox(kx + Math.sin(sw) * 0.04, ky - 0.1, kz - 0.008, 0.028, 0.05, 0.004, 0, 0, sw);   // 札
    }
  }
  // 住人の持ち物の山(段ボール・袋・靴・傘・本・衣類)。机の左右と奥の脇
  const heap = (cu, cv, ru, rv, n) => {
    for (let k = 0; k < n; k++) {
      const a = R() * Math.PI * 2, rr = Math.sqrt(R());
      const pu = cu + Math.cos(a) * ru * rr, pv = cv + Math.sin(a) * rv * rr;
      const hgt = (1 - rr) * 0.9 + R() * 0.25;
      const kind = R();
      b.surf = SURF.prop;
      if (kind < 0.35) { b.col = [0.42 + R() * 0.1, 0.31 + R() * 0.06, 0.19]; const s = 0.3 + R() * 0.3; b.rbox(X(pu), Y(hgt * 0.6 + s * 0.35), Z(pv), s, s * 0.7, s * (0.8 + R() * 0.4), R() * 3, (R() - 0.5) * 0.4, (R() - 0.5) * 0.4); }
      else if (kind < 0.6) { const cl = [[0.12, 0.13, 0.16], [0.35, 0.1, 0.1], [0.2, 0.26, 0.2], [0.5, 0.48, 0.44], [0.1, 0.1, 0.1]][(R() * 5) | 0]; b.col = cl; b.rbox(X(pu), Y(hgt * 0.5 + 0.12), Z(pv), 0.45 + R() * 0.3, 0.18 + R() * 0.12, 0.35 + R() * 0.25, R() * 3, (R() - 0.5) * 0.6, (R() - 0.5) * 0.6); }
      else if (kind < 0.72) { b.col = [0.1 + R() * 0.3, 0.1 + R() * 0.2, 0.12]; for (const o of [-0.06, 0.06]) b.rbox(X(pu + o), Y(hgt * 0.4 + 0.05), Z(pv), 0.1, 0.09, 0.27, 0.3 + R() * 0.3); }
      else if (kind < 0.82) { b.col = [[0.6, 0.15, 0.15], [0.15, 0.18, 0.3], [0.1, 0.1, 0.1]][(R() * 3) | 0]; b.rbox(X(pu), Y(hgt * 0.4 + 0.45), Z(pv), 0.03, 0.9, 0.03, R() * 3, (R() - 0.5) * 1.6, (R() - 0.5) * 1.6); }
      else { b.col = [0.3 + R() * 0.4, 0.25 + R() * 0.3, 0.2 + R() * 0.3]; b.rbox(X(pu), Y(hgt * 0.5 + 0.06), Z(pv), 0.16 + R() * 0.1, 0.12 + R() * 0.1, 0.23, R() * 3); }
    }
  };
  heap(-2.2, v + 1.5, 0.75, 1.2, 70);
  heap(2.2, v + 1.5, 0.75, 1.2, 70);
  heap(-0.0, v + d + 2.1, 1.6, 0.45, 40);
}
const KEYBOARDS = [[-1.7, -0.45], [0.45, 1.7]];   // 鍵の板の u の範囲(机の中心から)
const HEAPS = [[-2.2, DK.v + 1.5, 0.8, 1.25], [2.2, DK.v + 1.5, 0.8, 1.25], [0, DK.v + DK.d + 2.1, 1.7, 0.5]];   // 当たり(u, v, 半径 u, 半径 v)

function buildPillarGeo() {
  const b = new GB(); const s = X705.pillar.s / 2, bs = X705.pillar.base / 2;
  b.surf = SURF.pillar; b.box(-s, 0.16, -s, s, HL.h - 0.18, s, 'px nx pz nz');
  b.surf = SURF.base; b.box(-bs, 0, -bs, bs, 0.16, bs, 'px nx pz nz py');
  b.surf = SURF.pillar; b.box(-s - 0.04, HL.h - 0.18, -s - 0.04, s + 0.04, HL.h, s + 0.04, 'px nx pz nz ny');
  return b.geometry();
}

function buildShafts() {
  const b = new GB();
  for (const u of SK.u) for (const v of SK.v) {
    const hw = SK.w / 2 - 0.05, hd = SK.d / 2 - 0.05, sp = 0.35;   // 下ほど少し広がる
    const top = [[X(u - hw), Z(v - hd)], [X(u + hw), Z(v - hd)], [X(u + hw), Z(v + hd)], [X(u - hw), Z(v + hd)]];
    const bot = [[X(u - hw - sp), Z(v - hd - sp)], [X(u + hw + sp), Z(v - hd - sp)], [X(u + hw + sp), Z(v + hd + sp)], [X(u - hw - sp), Z(v + hd + sp)]];
    for (let k = 0; k < 4; k++) {
      const a = top[k], c = top[(k + 1) % 4], a2 = bot[k], c2 = bot[(k + 1) % 4];
      const base = b.count;
      for (const [x, y, z] of [[a2[0], Y(0.02), a2[1]], [c2[0], Y(0.02), c2[1]], [c[0], Y(HL.h), c[1]], [a[0], Y(HL.h), a[1]]]) b._v(x, y, z, [0, 0, 1]);
      b.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = b.geometry(); g.computeVertexNormals(); return g;
}

// ================================================================ 当たり
function col(ctx, u0, v0, u1, v1, kind = 'wall', h = HL.h) {
  const c = { minX: X(u0), maxX: X(u1), minZ: Z(v0), maxZ: Z(v1), y0: SPACE_Y, y1: SPACE_Y + h, kind, roomId: ctx.key, disabled: false };
  ctx.cols.push(c);
  return c;
}

// ================================================================ build
export function build(ctx) {
  const st = ctx.state;
  const U = st.U = {
    uTime: { value: 0 }, uY: { value: SPACE_Y }, uOn: { value: 1 }, uDim: { value: 0 }, uWarp: { value: 0 },
    uPlayer: { value: new THREE.Vector3() }, uTilt: { value: new THREE.Vector2(1, 0) },
    uExitL: { value: new THREE.Vector4(X(0), Y(2.1), Z(G.s[1] + 0.9), 0) }, uGenL: { value: new THREE.Vector4(X(0), Y(2.2), Z(1.6), 0.16) }, uOpenS: { value: 0 },
  };
  const mat = st.mat = makeMaterial(U);
  const g = ctx.group;
  const mesh = (geo, m, name) => { const o = new THREE.Mesh(geo, m); o.name = name; o.receiveShadow = true; o.castShadow = false; o.frustumCulled = false; g.add(o); return o; };
  const R = rng(705);
  { const b = new GB(); genkan(b, G.n[0], G.n[1], 0, 1); buildHall(b); st.main = mesh(b.geometry(), mat, 'X705_main'); }
  { const b = new GB(); buildDesk(b, R); st.desk = mesh(b.geometry(), mat, 'X705_desk'); st.desk.castShadow = true; }
  // 南の玄関(反転の後だけ)・扉の向こうの廊下の灯り(光の箱)・少し開いた扉
  { const b = new GB(); genkan(b, G.s[0], G.s[1], G.s[1], -1);
    b.surf = SURF.exitGlow; b.box(X(-0.6), Y(0), Z(G.s[1] + 0.25), X(0.6), Y(2.3), Z(G.s[1] + 1.4), 'nz px nx');
    st.south = mesh(b.geometry(), mat, 'X705_south'); }
  { const b = new GB(); b.surf = SURF.door; b.box(0, 0, -0.02, 0.8, 2.03, 0.02);
    b.surf = SURF.metal; b.col = [0.6, 0.58, 0.54]; b.box(0.66, 0.96, -0.06, 0.78, 0.98, 0.06);
    const pv = st.southDoor = new THREE.Group(); pv.position.set(X(-0.4), Y(0), Z(G.s[1] + 0.02));
    const leaf = new THREE.Mesh(b.geometry(), mat); leaf.receiveShadow = true; pv.add(leaf); g.add(pv); }
  { const b = new GB(); b.surf = SURF.door; b.box(X(-0.4), Y(0), Z(0.0), X(0.4), Y(2.03), Z(0.04));
    b.surf = SURF.metal; b.col = [0.6, 0.58, 0.54]; b.box(X(0.26), Y(0.96), Z(0.04), X(0.38), Y(0.98), Z(0.09));
    st.northDoor = mesh(b.geometry(), mat, 'X705_northDoor'); }
  // 開口をふさぐ板(北 = 反転の後、南 = 反転の前)
  { const mk = (v, nz) => { const b = new GB(); b.surf = SURF.wall; b.wallZ(Z(v), X(-G.w / 2), X(G.w / 2), Y(0), Y(G.h), nz); b.surf = SURF.base; b.box(X(-G.w / 2), Y(0), nz > 0 ? Z(v) : Z(v) - 0.012, X(G.w / 2), Y(0.1), nz > 0 ? Z(v) + 0.012 : Z(v), nz > 0 ? 'pz py' : 'nz py'); return mesh(b.geometry(), mat, 'X705_plug'); };
    st.plugN = mk(HL.v0, 1); st.plugS = mk(HL.v1, -1); }
  // 柱(InstancedMesh。見えない柱は大きさ 0)
  st.pillars = pillarList();
  { const pm = st.pillarMesh = new THREE.InstancedMesh(buildPillarGeo(), mat, st.pillars.length);
    pm.name = 'X705_pillars'; pm.castShadow = true; pm.receiveShadow = true; pm.frustumCulled = false; g.add(pm); }
  // 光の筋
  { const sm = st.shafts = new THREE.Mesh(buildShafts(), makeShaftMaterial(U)); sm.name = 'X705_shafts'; sm.frustumCulled = false; sm.renderOrder = 3; g.add(sm); }
  // 当たり
  const hw = G.w / 2;
  col(ctx, -hw, -0.2, hw, 0); col(ctx, -hw - 0.2, 0, -hw, HL.v0); col(ctx, hw, 0, hw + 0.2, HL.v0);                  // 北の玄関
  col(ctx, HL.u0, HL.v0 - 0.2, -hw, HL.v0); col(ctx, hw, HL.v0 - 0.2, HL.u1, HL.v0);
  st.colPlugN = col(ctx, -hw, HL.v0 - 0.2, hw, HL.v0);
  col(ctx, HL.u0 - 0.2, HL.v0, HL.u0, HL.v1); col(ctx, HL.u1, HL.v0, HL.u1 + 0.2, HL.v1);
  col(ctx, HL.u0, HL.v1, -hw, HL.v1 + 0.2); col(ctx, hw, HL.v1, HL.u1, HL.v1 + 0.2);
  st.colPlugS = col(ctx, -hw, HL.v1, hw, HL.v1 + 0.2);
  st.colSouth = [col(ctx, -hw - 0.2, HL.v1, -hw, G.s[1]), col(ctx, hw, HL.v1, hw + 0.2, G.s[1]), col(ctx, -hw, G.s[1], hw, G.s[1] + 0.2)];
  { const { u, v, w, d } = DK; st.colDesk = [col(ctx, u - w / 2, v, u + w / 2, v + d, 'furn', 0.76), col(ctx, u - 0.3, v + d + 0.2, u + 0.3, v + d + 0.75, 'furn', 1.0), ...KEYBOARDS.map(([a0, a1]) => col(ctx, u + a0, v + d + 1.15, u + a1, v + d + 1.35, 'furn', 2.1))]; }
  for (const [cu, cv, ru, rv] of HEAPS) col(ctx, cu - ru * 0.85, cv - rv * 0.85, cu + ru * 0.85, cv + rv * 0.85, 'furn', 1.0);
  for (const p of st.pillars) p.col = col(ctx, p.u - X705.pillar.base / 2, p.v - X705.pillar.base / 2, p.u + X705.pillar.base / 2, p.v + X705.pillar.base / 2);
  st.colsBase = ctx.cols.slice();
  // 敵の照明(天窓の下・玄関)。灯りが消えたら出口の灯りだけにする(_setLamps)
  st.lampsOn = []; for (const u of SK.u) for (const v of SK.v) st.lampsOn.push([X(u), Y(HL.h - 0.4), Z(v)]);
  st.lampsOn.push([X(0), Y(2.2), Z(1.6)]);
  st.lampsOff = [[X(0), Y(2.1), Z(G.s[1] - 0.3)]];
  reset(ctx);
  g.visible = false;
}

function setLamps(ctx, arr) { ctx.lamps.length = 0; for (const l of arr) ctx.lamps.push(l); }
const _m4 = new THREE.Matrix4();
function setPillar(ctx, p, on) {
  const st = ctx.state;
  p.on = on; p.col.disabled = !on;
  if (on) _m4.makeTranslation(X(p.u), Y(0), Z(p.v)); else _m4.makeScale(0, 0, 0).setPosition(X(p.u), Y(0), Z(p.v));
  st.pillarMesh.setMatrixAt(p.i, _m4);
  st.pillarMesh.instanceMatrix.needsUpdate = true;
  st.navDirty = true;
}

function reset(ctx) {
  const st = ctx.state;
  Object.assign(st, { t: 0, maxV: 0, keyTaken: false, keyBefore: false, revealed: false, offT: -1, open: 0, warp: 0, chase: false, log: [], appeared: [], exitHiddenAt: null, navDirty: true });
  for (const p of st.pillars) setPillar(ctx, p, p.kind === 'base');
  applyReveal(ctx, false);
  setOn(ctx, 1);
  st.U.uWarp.value = 0;
  setLamps(ctx, st.lampsOn);
}
function setOn(ctx, k) {
  const st = ctx.state;
  st.U.uOn.value = k; st.U.uDim.value = k < 1 ? X705.lightsOff.dim * (1 - k) : 0;
  st.U.uGenL.value.w = 0.16 * k;
}
function applyReveal(ctx, on) {
  const st = ctx.state;
  st.revealed = on;
  st.plugN.visible = on; st.colPlugN.disabled = !on;
  st.plugS.visible = !on; st.colPlugS.disabled = on;
  st.south.visible = on; st.southDoor.visible = on;
  for (const c of st.colSouth) c.disabled = !on;
  st.northDoor.visible = true;
  st.navDirty = true;
}

export function enter(ctx) {
  const st = ctx.state;
  reset(ctx);
  // 鍵を取った後にもう一度入った時は、暗い広間(柱は全部・北の入口から出入りする。反転も管理人もない)
  const s = ctx.story; st.keyBefore = !!(s && s.taken && s.taken.has('kB1'));
  if (st.keyBefore) {
    for (const p of st.pillars) setPillar(ctx, p, true);
    setOn(ctx, 0); setLamps(ctx, [[X(0), Y(2.2), Z(1.6)]]); st.U.uGenL.value.w = 0.1;
    // 最終追跡の出入り口が南を向いたままなら北へ戻す
    portal(ctx, false);
  }
  st.log.push({ t: 0, ev: 'enter', keyBefore: st.keyBefore });
}
export function leave(ctx) {
  const st = ctx.state;
  st.U.uWarp.value = 0;
  stopSound(ctx);
  if (ctx.ai && ctx.ai.level === ctx.key) ctx.ai.chaseOmni = false;
  void st;
}
export function dispose(ctx) {
  for (const o of [...ctx.group.children]) { ctx.group.remove(o); o.traverse((m) => { if (m.geometry) m.geometry.dispose(); }); }
  if (ctx.state.mat) ctx.state.mat.dispose();
  if (ctx.state.shafts) ctx.state.shafts.material.dispose();
  ctx.cols.length = 0; ctx.lamps.length = 0;
}

// ================================================================ 毎フレーム
const _frus = new THREE.Frustum(), _pm = new THREE.Matrix4(), _box = new THREE.Box3();
function pillarInView(ctx, p) {
  const m = X705.grow.margin, s = X705.pillar.base / 2 + m;
  _box.min.set(X(p.u) - s, Y(-0.2), Z(p.v) - s); _box.max.set(X(p.u) + s, Y(HL.h + 0.2), Z(p.v) + s);
  return _frus.intersectsBox(_box);
}
export function update(dt, ctx) {
  const st = ctx.state, U = st.U, pl = ctx.player, cam = ctx.camera;
  st.t += dt; U.uTime.value += dt;
  U.uPlayer.value.copy(pl.pos);
  const u = pl.pos.x - OX, v = pl.pos.z - OZ;
  st.maxV = Math.max(st.maxV, v);
  if (ctx.scene.fog) { const F = st.U.uOn.value > 0.5 ? X705.fog.on : X705.fog.off; ctx.scene.fog.color.setHex(F[0]); ctx.scene.fog.density = F[1]; }
  // ① 増える: 条件を満たした柱を、見ていない間・離れた所にだけ足す
  if (!st.keyBefore) {
    cam.updateMatrixWorld();
    _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); _frus.setFromProjectionMatrix(_pm);
    const Gw = X705.grow;
    const e = ctx.ai && ctx.ai.level === ctx.key && !ctx.ai.concealed ? ctx.ai.enemy.pos : null;
    for (const p of st.pillars) {
      if (p.on) continue;
      const want = p.kind === 'fill' ? st.maxV >= p.v - Gw.fillLead : p.kind === 'screen' ? st.maxV >= Gw.screenAt : p.kind === 'deep' ? st.maxV >= Gw.deepAt : false;
      if (!want) continue;
      if (Math.hypot(p.u - u, p.v - v) < Gw.minDist) continue;
      if (e && Math.hypot(X(p.u) - e.x, Z(p.v) - e.z) < Gw.minDist) continue;
      if (pillarInView(ctx, p)) continue;
      setPillar(ctx, p, true);
      st.appeared.push({ i: p.i, kind: p.kind, t: +st.t.toFixed(2), playerV: +v.toFixed(2) });
    }
    if (st.exitHiddenAt === null && !st.revealed && exitHidden(ctx, u, v)) st.exitHiddenAt = { t: +st.t.toFixed(2), u: +u.toFixed(2), v: +v.toFixed(2) };
  }
  // ② 反転: 鍵を取った(物語の pickups)→ 灯りが一斉に消え、南に出口(北はふさぐ)
  const s = ctx.story;
  if (!st.keyBefore && !st.keyTaken && s && s.taken && s.taken.has('kB1')) {
    st.keyTaken = true; st.offT = 0;
    applyReveal(ctx, true);
    setLamps(ctx, st.lampsOff);
    portal(ctx, true);
    st.log.push({ t: st.t, ev: 'key', u, v });
    sfx(ctx, 'lights_off');
  }
  if (st.offT >= 0) {
    st.offT += dt;
    const F = X705.lightsOff.flicker;
    const k = st.offT >= F ? 0 : (Math.sin(st.offT * 90) > 0.2 ? 0.6 : 0.05) * (1 - st.offT / F);
    setOn(ctx, k);
    // 扉が開いて廊下の灯りが差す(管理人が現れる直前から)
    st.open = Math.min(1, st.open + dt / 1.2 * (st.offT > 0.3 ? 1 : 0));
    st.southDoor.rotation.y = -0.55 * st.open;
    U.uOpenS.value = st.open; U.uExitL.value.w = 1.3 * st.open;
    if (st.open > 0 && !st.creak) { st.creak = true; sfx(ctx, 'creak'); }
  }
  // 追跡: 広間の中では見失わない・経路は格子(nav)。歪み
  const ai = ctx.ai;
  const chasing = !!(ai && ai.level === ctx.key && ['CHASE', 'APPEAR', 'ATTACK'].includes(ai.state));
  if (chasing) { ai.chaseOmni = true; if (!st.chase) { st.chase = true; st.log.push({ t: st.t, ev: 'chase' }); } }
  st.warp = THREE.MathUtils.clamp(st.warp + (chasing && ai.state !== 'APPEAR' ? 1 : -1) * dt / X705.warp.inSec, 0, 1);
  if (st.forceWarp != null) st.warp = st.forceWarp;   // テスト: 歪みを固定する
  U.uWarp.value = st.warp;
  U.uTilt.value.set(Math.cos(st.t * 0.21), Math.sin(st.t * 0.21));
  sound(ctx, dt);
}

// 北の出口(入口の扉)がプレイヤーの目から見えないか(見える柱で線が切れる)
function exitHidden(ctx, u, v) {
  const pts = [[-0.35, HL.v0], [0, HL.v0], [0.35, HL.v0]];
  return pts.every(([eu, ev]) => segBlocked(ctx, u, v, eu, ev, X705.pillar.s / 2));
}
function segBlocked(ctx, u0, v0, u1, v1, r) {
  for (const p of ctx.state.pillars) {
    if (!p.on) continue;
    // 線分と正方形(半幅 r)の交差(スラブ法)
    let t0 = 0, t1 = 1; const du = u1 - u0, dv = v1 - v0;
    let ok = true;
    for (const [o, d, lo, hi] of [[u0, du, p.u - r, p.u + r], [v0, dv, p.v - r, p.v + r]]) {
      if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) { ok = false; break; } continue; }
      let a = (lo - o) / d, c = (hi - o) / d; if (a > c) [a, c] = [c, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, c); if (t0 > t1) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

// 最終追跡の出入り口(story の ai.portals の 'X705'): 反転後は南の出口、それ以外は北の入口
function portal(ctx, south) {
  const ai = ctx.ai; if (!ai || !ai.portals) return;
  const P = ai.portals.find((q) => q.id === 'X705'); if (!P) return;
  P.a = south ? { lv: ctx.key, x: X(0), z: Z(G.s[1] - 0.5) } : { lv: ctx.key, x: X(0), z: Z(0.5) };
}

// ================================================================ 物語とのつなぎ
export function exits(ctx) {
  const st = ctx.state;
  if (!st.revealed) return [{ x: X(0), z: Z(0.02), n: [0, 1], auto: true, reach: 1.3, depth: 0.45, half: 0.6, onLeave: () => onLeave(ctx) }];
  return [{ x: X(0), z: Z(G.s[1] - 0.02), n: [0, -1], auto: true, reach: 1.3, depth: 0.45, half: 0.6, onLeave: () => onLeave(ctx) }];
}
function onLeave(ctx) {
  const st = ctx.state;
  st.log.push({ t: st.t, ev: 'leave', revealed: st.revealed });
  // 広間の中の全知は解く。P6b-H: 追跡はここで終わり、管理人は 7F へ追って来ない(story._afterSpaceExit → _startEscape)
  if (ctx.ai && ctx.ai.level === ctx.key) ctx.ai.chaseOmni = false;
}

// P6b-H(§3.14 #2 改訂 2026-11-12): 最終追跡の途中(鍵を取った後・反転した広間)で死んだ → 追跡をやり直す。復帰は机の手前(鍵を取った直後の位置・南の机を向く)。
//  広間は反転したまま(同じ空間なので enter はやり直さない = 灯りは消えたまま・出口は南)。鍵を取る前・鍵の後に入り直した暗い広間(keyBefore)は null(物語の段の位置)
export function respawn(ctx) {
  const st = ctx.state, s = ctx.story;
  if (!st.keyTaken || st.keyBefore || !s || s.stage !== 9 || s.sub !== 'chase') return null;
  if (ctx.ai) ctx.ai.chaseOmni = false;
  st.log.push({ t: st.t, ev: 'respawn_chase' });
  return { level: ctx.key, x: X(DK.u), z: Z(DK.v - DK.d / 2 - 0.55), yaw: Math.PI };
}

// ================================================================ 管理人の経路(格子の A*。柱・机・山を避ける)
function navGrid(ctx) {
  const st = ctx.state, N = X705.nav;
  if (!st.nav || st.navDirty) {
    const u0 = HL.u0, v0 = -0.5, nu = Math.round((HL.u1 - HL.u0) / N.cell), nv = Math.round((G.s[1] + 1 - v0) / N.cell);
    const blk = new Uint8Array(nu * nv);
    const r = N.inflate;
    const inside = (u, v) => {
      if (u > HL.u0 + r && u < HL.u1 - r && v > HL.v0 + r && v < HL.v1 - r) return true;
      const hw = G.w / 2 - r * 0.6;
      if (!st.revealed && Math.abs(u) < hw && v > 0.3 && v <= HL.v0 + r) return true;
      if (st.revealed && Math.abs(u) < hw && v >= HL.v1 - r && v < G.s[1] - 0.3) return true;
      return false;
    };
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const u = u0 + (i + 0.5) * N.cell, v = v0 + (j + 0.5) * N.cell;
      blk[j * nu + i] = inside(u, v) ? 0 : 1;
    }
    for (const c of ctx.cols) {
      if (c.disabled || (c.kind !== 'furn' && !st.pillars.some((p) => p.col === c))) continue;
      const a0 = Math.floor((c.minX - OX - r - u0) / N.cell), a1 = Math.floor((c.maxX - OX + r - u0) / N.cell);
      const b0 = Math.floor((c.minZ - OZ - r - v0) / N.cell), b1 = Math.floor((c.maxZ - OZ + r - v0) / N.cell);
      for (let j = Math.max(0, b0); j <= Math.min(nv - 1, b1); j++) for (let i = Math.max(0, a0); i <= Math.min(nu - 1, a1); i++) blk[j * nu + i] = 1;
    }
    st.nav = { u0, v0, nu, nv, blk }; st.navDirty = false;
  }
  return st.nav;
}
function cellOf(g, u, v) { return [THREE.MathUtils.clamp(Math.floor((u - g.u0) / X705.nav.cell), 0, g.nu - 1), THREE.MathUtils.clamp(Math.floor((v - g.v0) / X705.nav.cell), 0, g.nv - 1)]; }
function losGrid(g, u0, v0, u1, v1) {
  const L = Math.hypot(u1 - u0, v1 - v0), n = Math.max(1, Math.ceil(L / 0.2));
  for (let k = 1; k < n; k++) { const t = k / n; const [i, j] = cellOf(g, u0 + (u1 - u0) * t, v0 + (v1 - v0) * t); if (g.blk[j * g.nu + i]) return false; }
  return true;
}
export function nav(ctx, fx, fz, tx, tz) {
  const g = navGrid(ctx);
  const fu = fx - OX, fv = fz - OZ, tu = tx - OX, tv = tz - OZ;
  if (losGrid(g, fu, fv, tu, tv)) return [{ x: tx, z: tz }];
  const [si, sj] = cellOf(g, fu, fv);
  let [ti, tj] = cellOf(g, tu, tv);
  // 目標の升がふさがっていれば近い空きへ
  if (g.blk[tj * g.nu + ti]) {
    let best = null, bd = 1e9;
    for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) { const i = ti + di, j = tj + dj; if (i < 0 || j < 0 || i >= g.nu || j >= g.nv || g.blk[j * g.nu + i]) continue; const d = di * di + dj * dj; if (d < bd) { bd = d; best = [i, j]; } }
    if (!best) return [{ x: tx, z: tz }];
    [ti, tj] = best;
  }
  const NN = g.nu * g.nv, S = sj * g.nu + si, T = tj * g.nu + ti;
  const gs = new Float32Array(NN).fill(Infinity), from = new Int32Array(NN).fill(-1), closed = new Uint8Array(NN);
  const heap = [];   // [f, idx]
  const push = (f, i) => { heap.push([f, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  const hh = (i, j) => { const dx = Math.abs(i - ti), dy = Math.abs(j - tj); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
  gs[S] = 0; push(hh(si, sj), S);
  let found = false, it = 0;
  while (heap.length && it++ < 40000) {
    const [, c] = pop();
    if (closed[c]) continue; closed[c] = 1;
    if (c === T) { found = true; break; }
    const ci = c % g.nu, cj = (c / g.nu) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= g.nu || j >= g.nv) continue;
      const n = j * g.nu + i; if (closed[n] || (g.blk[n] && n !== T)) continue;
      if (di && dj && (g.blk[cj * g.nu + i] || g.blk[j * g.nu + ci])) continue;   // 角を切らない
      const ng = gs[c] + (di && dj ? 1.414 : 1);
      if (ng < gs[n]) { gs[n] = ng; from[n] = c; push(ng + hh(i, j), n); }
    }
  }
  if (!found) return [{ x: tx, z: tz }];
  const cells = []; for (let c = T; c !== -1 && c !== S; c = from[c]) cells.push(c); cells.reverse();
  const pts = cells.map((c) => [g.u0 + ((c % g.nu) + 0.5) * X705.nav.cell, g.v0 + (((c / g.nu) | 0) + 0.5) * X705.nav.cell]);
  pts[pts.length - 1] = [tu, tv];
  // 見通しで間引く
  const out = []; let cu = fu, cv = fv, k = 0;
  while (k < pts.length) {
    let far = k;
    for (let m = pts.length - 1; m > k; m--) if (losGrid(g, cu, cv, pts[m][0], pts[m][1])) { far = m; break; }
    out.push({ x: X(pts[far][0]), z: Z(pts[far][1]) }); [cu, cv] = pts[far]; k = far + 1;
  }
  return out;
}

// ================================================================ 音(P4b)
//  広間の空気(amb_x705)・歪みのうなり(space_warp)・南の扉がひとりでに開く軋み(door_creak_slow)は「なし」で外した(無音)。
//  灯りが一斉に消える音は採用 x705_lights_off B「次々と消える」(src/audio_bank.js)。st.sfx は鳴らした名前の記録(テスト用)
function sound(ctx, dt) { void ctx; void dt; }
function stopSound(ctx) { void ctx; }
function sfx(ctx, name) {
  const st = ctx.state; st.sfx = st.sfx || []; st.sfx.push(name);
  const bank = ctx.audio && ctx.audio.bank;
  if (name === 'lights_off' && bank) bank.play('x705_lights_off');
}

// テスト・スクショ用
export function debug(ctx) {
  const st = ctx.state;
  return {
    X705, st,
    state: () => ({ maxV: +st.maxV.toFixed(2), on: +st.U.uOn.value.toFixed(3), revealed: st.revealed, keyTaken: st.keyTaken, keyBefore: st.keyBefore, warp: +st.warp.toFixed(3), chase: st.chase,
      pillarsOn: st.pillars.filter((p) => p.on).length, appeared: st.appeared.length, exitHiddenAt: st.exitHiddenAt, open: +st.open.toFixed(2), log: st.log.slice(-20) }),
    pillars: () => st.pillars.map((p) => ({ u: p.u, v: p.v, kind: p.kind, on: !!p.on })),
    exitHidden: (u, v) => exitHidden(ctx, u, v),
    exitHiddenWith: (u, v, kinds) => { const save = st.pillars.map((p) => p.on); st.pillars.forEach((p) => { p.on = kinds.includes(p.kind); }); const r = exitHidden(ctx, u, v); st.pillars.forEach((p, i) => { p.on = save[i]; }); return r; },
    colsSnapshot: () => ctx.cols.filter((c) => !c.disabled).map((c) => [c.minX, c.minZ, c.maxX, c.maxZ].map((q) => +q.toFixed(3)).join(',')).sort().join(';'),
    showAll: () => { for (const p of st.pillars) setPillar(ctx, p, true); },
    nav: (fx, fz, tx, tz) => nav(ctx, fx, fz, tx, tz),
    local: (x, z) => ({ u: x - OX, v: z - OZ }), world: (u, v) => ({ x: X(u), z: Z(v) }),
  };
}
