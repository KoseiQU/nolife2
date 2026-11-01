// spaces/xb1.js — 別空間 XB1「地下 B1」(DESIGN §3.8 I 4 行目・H 第10段)。P5b-2b。
//  鉄扉の先は湿ったコンクリートの踊り場 → 横の扉から白いタイルのトンネル(参考 14: 丸タイルの床・市松の腰壁・奥に標識灯。水音・滴り)
//  → 途中で白い仕切り壁の迷路(参考 07: 低い天井・白い壁)→ 奥の小部屋 = 管理人の作業場(道具・洗い場。死体は見せず匂わせのみ)。奥の壁のフックに車のキー(slot hook/key)。
//  異世界の要素: ①ループ(トンネルは 24m ごとに同じ区画 = 同じ標識灯。前へ歩くと継ぎ目なしに 24m 戻す。標識灯を 3 回通ると気づく(標識灯が激しく瞬く)。
//    その後、一度立ち止まるか振り返ると抜ける = 次は先(迷路)へ進める。閉じ込めないよう 6 回通ったら自然に抜ける)
//   ②歪み(迷路の仕切りは視線を外した間に配置が変わる。見えている壁・近くの壁は動かさない。入口・プレイヤー・作業場がいつも繋がっている時だけ変える)
//   ③伸びる(キーを取って戻ると、灯りが背後から消えていき、踊り場の扉は 2 周余計に歩くまで開かない = 戻る道は行きより長い)
//  管理人は地下には来ない(enemy_ai の経路も無い)。上の階の足音・遠い悲鳴(音だけ)。
//  光はすべてシェーダの中の計算(トンネルの周期の灯り・標識灯・迷路の格子の灯り・裸電球。three.js のライトは足さない)＋懐中電灯。
//  座標: 局所 u = x − 520、v = z。トンネルは u −1〜1 を +v へ。周期の窓 v [−6, 18)(踊り場への扉は v 6 の西の壁、標識灯は v 14)。

import * as THREE from 'three';
import { SPACE_Y } from '../world.js';
import { GB, GLSL_NOISE, rng, actx, noiseBuf, burst, tone } from './gb.js';

const OX = 520, OZ = 0;
// 調整値(docs/p5b2b/NOTES.md §4)
export const XB1 = {
  tun: { w: 2.0, h: 2.6, L: 24, w0: -6, door: 6, sign: 14, lamp0: 3, lampDu: 6, from: -30, to: 50 },   // トンネル(周期 L・窓 [w0, w0+L))
  landing: { u0: -5.0, u1: -1.2, v0: 0, v1: 8, h: 2.6, door: -3.1, bulb: [-3.1, 2.3, 4.2] },
  loop: { notice: 3, still: 1.2, turn: 0.4, safety: 6, hyst: 6.0 },
  maze: { u0: -9, v0: 52, nc: 9, nr: 12, cell: 2.0, h: 2.45, wall: 2.05, entry: [4, 0], goal: [7, 11], every: 0.4, near: 2.6, density: 0.4, densityRet: 0.48, maxIn: 34, maxRet: 44, seed: 1001 },
  shop: { u0: 3.5, u1: 8.5, v0: 76.2, v1: 82, h: 2.4, door: 6, bulb: [6.0, 2.15, 79.0] },
  ret: { loops: 2, offBehind: 6.0, offRate: 2.6 },
  fog: [0x050607, 0.045],
  sounds: { stepsEvery: [9, 18], stepsEveryRet: [5, 10] },
};
const T = XB1.tun, LD = XB1.landing, MZ = XB1.maze, SH = XB1.shop;

export const DEF = {
  origin: [OX, OZ], host: { level: 'B1', door: 'B1DOOR' },
  entry: [LD.door, 0.8, Math.PI],     // 鉄扉の内側・奥(南)を向く
  exit: [LD.door, 0.02],              // 鉄扉(E で戻る)
  slots: { hook: [5.6, 1.45, SH.v1 - 0.04], key: [5.6, 1.32, SH.v1 - 0.08] },   // 作業場の奥の壁のフック・車のキー
};
const X = (u) => OX + u, Y = (h) => SPACE_Y + h, Z = (v) => OZ + v;

// ================================================================ 材質
const SURF = { tFloor: 0, tWall: 1, tChk: 2, tCeil: 3, tLamp: 4, sign: 5, cFloor: 6, cWall: 7, iron: 8, dark: 9, prop: 10, void: 11, oWall: 12, oFloor: 13, oCeil: 14, oLamp: 15, shopWall: 16, bulb: 17, wood: 18, stain: 19, pil: 20, border: 21, cCeil: 22 };
const W0Z = (OZ + T.w0).toFixed(2);
function makeMaterial(U) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.0 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aSurf; attribute vec3 aCol;
        varying vec3 vWP; varying float vSurf; varying vec3 vCol; varying float vK0;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        { vec4 q = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          q = instanceMatrix * q;
        #endif
          vWP = (modelMatrix * q).xyz; vSurf = aSurf; vCol = aCol;
          vK0 = abs(modelMatrix[3].z - ${(OZ).toFixed(2)}) < 0.5 ? 1.0 : 0.0; }`);   // 周期の区画の k = 0(踊り場の本物がある区画)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime, uY, uOffZ, uDoorOpen, uSignFl, uRetOn;
        varying vec3 vWP; varying float vSurf; varying vec3 vCol; varying float vK0;
        ${GLSL_NOISE}
        // 周期のあるノイズ(トンネルの継ぎ目なし。per = 格子の数)
        float h21p(vec2 i, float per) { i.y = mod(i.y, per); return h21(i); }
        float vnoiseP(vec2 p, float per) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21p(i, per), h21p(i + vec2(1, 0), per), f.x), mix(h21p(i + vec2(0, 1), per), h21p(i + vec2(1, 1), per), f.x), f.y); }
        float lampOn(float z) {   // 戻りで背後から消える灯り(z が uOffZ より奥なら消える。境目は瞬く)
          float x = uOffZ - z;
          if (x > 1.6) return 1.0;
          if (x < 0.0) return 0.0;
          return mix(step(0.45, h21(vec2(floor(z), floor(uTime * 12.0)))) * 0.8, 1.0, smoothstep(0.8, 1.6, x));
        }
        // 7 セグメントの数字(標識灯の「07」)。brk = 欠けた画(瞬く)
        float seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return 1.0 - smoothstep(0.035, 0.06, length(pa - ba * h)); }
        float digit(vec2 p, int d, float brk) {
          // 画: a 上 b 右上 c 右下 d 下 e 左下 f 左上 g 中
          float A = seg(p, vec2(-0.2, 0.4), vec2(0.2, 0.4)), B = seg(p, vec2(0.22, 0.38), vec2(0.22, 0.02)), C = seg(p, vec2(0.22, -0.02), vec2(0.22, -0.38));
          float D = seg(p, vec2(-0.2, -0.4), vec2(0.2, -0.4)), E = seg(p, vec2(-0.22, -0.02), vec2(-0.22, -0.38)), F = seg(p, vec2(-0.22, 0.38), vec2(-0.22, 0.02));
          if (d == 0) return max(max(max(A, B), max(C, D)), max(E, F * brk));
          return max(max(A, B), C);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 P = vWP; float fy = P.y - uY; int S = int(vSurf + 0.5);
        vec2 Lc = P.xz - vec2(${OX.toFixed(1)}, ${OZ.toFixed(1)});
        float pz = mod(P.z - ${W0Z}, ${T.L.toFixed(1)});   // 周期の座標(トンネル)
        vec3 nW0 = normalize(cross(dFdx(vWP), dFdy(vWP)));
        vec3 col = vec3(0.5); float rgh = 0.6;
        if (S == 11) { if (vK0 > 0.5) discard; col = vec3(0.0); rgh = 1.0; }
        if (S == 0 || S == 21) {
          // 丸タイル(八角の白いタイルと角の黒い小さな石)・壁際の濃い帯。湿った所は暗く艶
          vec2 q = vec2(Lc.x, pz) / 0.2; vec2 f = fract(q) - 0.5;
          float dsum = abs(f.x) + abs(f.y);
          float oct = max(max(abs(f.x), abs(f.y)), dsum * 0.72);
          float aa = fwidth(q.x) * 1.5;
          vec3 white = vec3(0.78, 0.78, 0.75) * (0.94 + 0.08 * h21(floor(q)));
          col = mix(white, vec3(0.32, 0.31, 0.3), smoothstep(0.43 - aa, 0.47 + aa, oct));
          col = mix(col, vec3(0.04), smoothstep(0.66 - aa, 0.7 + aa, dsum));
          if (S == 21) col = vec3(0.13, 0.13, 0.13) * (0.9 + 0.2 * h21(floor(q)));
          float wet = smoothstep(0.58, 0.72, vnoiseP(vec2(Lc.x * 0.7, pz * 0.5), 12.0));
          col *= mix(1.0, 0.55, wet); rgh = mix(0.42, 0.06, wet);
        } else if (S == 1 || S == 20) {
          // 上の壁: 白い漆喰(水の筋)。付け柱は丸タイル
          vec2 qa = vec2(abs(nW0.x) > 0.5 ? pz : Lc.x, fy);
          col = vec3(0.74, 0.74, 0.71) * (0.95 + 0.07 * vnoiseP(qa * vec2(1.0, 3.0), 24.0));
          col *= 1.0 - 0.18 * smoothstep(0.55, 0.85, vnoiseP(vec2(qa.x * 2.0, 0.0), 48.0)) * smoothstep(2.4, 0.9, fy);   // 水の筋
          rgh = 0.8;
          if (S == 20) { vec2 q = qa / 0.18; vec2 f = fract(q) - 0.5; float dsum = abs(f.x) + abs(f.y); col = mix(vec3(0.8, 0.8, 0.77), vec3(0.05), smoothstep(0.66, 0.72, dsum)); rgh = 0.35; }
        } else if (S == 2) {
          // 腰壁: 市松(白と濃い灰の 15cm 角)
          vec2 qa = vec2(abs(nW0.x) > 0.5 ? pz : Lc.x, fy) / 0.15;
          float ch = mod(floor(qa.x) + floor(qa.y), 2.0);
          vec2 f = fract(qa); float e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
          col = mix(vec3(0.76, 0.76, 0.73), vec3(0.17, 0.17, 0.17), ch);
          col = mix(col, vec3(0.3), (1.0 - smoothstep(0.02, 0.05, e)) * 0.6);
          rgh = 0.3;
        } else if (S == 3) { col = vec3(0.66, 0.66, 0.63); rgh = 0.9;
        } else if (S == 4 || S == 15 || S == 17) { col = vec3(0.9); rgh = 0.5;
        } else if (S == 5) { col = vec3(0.03, 0.025, 0.02); rgh = 0.4;
        } else if (S == 6) {   // コンクリートの床(水たまり)
          col = vec3(0.27, 0.27, 0.26) * (0.85 + 0.25 * vnoise(Lc * 1.7)) * (0.9 + 0.1 * vnoise(Lc * 11.0));
          float wet = smoothstep(0.55, 0.7, vnoise(Lc * 0.6 + 3.1)); col *= mix(1.0, 0.5, wet); rgh = mix(0.75, 0.05, wet);
          // 作業場の排水口のまわりの乾いた茶色の染み(匂わせ)
          float rs = length(Lc - vec2(6.4, 79.6)) + 0.25 * vnoise(Lc * 5.0) + 0.2 * vnoise(Lc * 1.3);
          col = mix(col, vec3(0.10, 0.045, 0.03), (1.0 - smoothstep(0.35, 1.05, rs)) * 0.8);
        } else if (S == 7 || S == 22) {   // コンクリートの壁・天井(染み)
          vec2 qa = abs(nW0.y) > 0.5 ? Lc : vec2(abs(nW0.x) > 0.5 ? P.z : P.x, fy);
          col = vec3(0.36, 0.36, 0.34) * (0.8 + 0.3 * vnoise(qa * 1.3)) * (0.92 + 0.1 * vnoise(qa * 9.0));
          col *= 1.0 - 0.3 * smoothstep(0.6, 0.85, vnoise(vec2(qa.x * 1.5, qa.y * 0.3)));
          rgh = 0.9;
        } else if (S == 8) { col = vec3(0.16, 0.19, 0.17) * (0.85 + 0.25 * vnoise(vec2(P.x + P.z, fy) * 4.0)); rgh = 0.5;
        } else if (S == 9) { col = vec3(0.05); rgh = 0.5;
        } else if (S == 10) { col = vCol * (0.9 + 0.15 * vnoise(P.xz * 7.0 + fy * 3.0)); rgh = 0.7;
        } else if (S == 12) { vec2 qa = vec2(abs(nW0.x) > 0.5 ? P.z : P.x, fy); col = vec3(0.74, 0.73, 0.70) * (0.96 + 0.05 * vnoise(qa * 2.0)); col *= mix(0.8, 1.0, smoothstep(0.0, 0.12, fy)); rgh = 0.85;
        } else if (S == 13) { col = vec3(0.6, 0.6, 0.58) * (0.95 + 0.06 * vnoise(Lc * 3.0)); rgh = 0.55;
        } else if (S == 14) { vec2 g = abs(fract(Lc / 0.6) - 0.5); col = vec3(0.7, 0.7, 0.68) * (1.0 - 0.3 * (1.0 - smoothstep(0.47, 0.49, max(g.x, g.y)) * 0.0) - 0.25 * step(0.48, max(g.x, g.y))); rgh = 0.9;
        } else if (S == 16) {   // 作業場の壁: 古い薄緑のタイル(汚れ)
          vec2 qa = vec2(abs(nW0.x) > 0.5 ? P.z : P.x, fy) / 0.15; vec2 f = fract(qa); float e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
          col = vec3(0.46, 0.52, 0.46) * (0.9 + 0.12 * h21(floor(qa))); col = mix(col, vec3(0.2, 0.2, 0.17), (1.0 - smoothstep(0.02, 0.06, e)) * 0.7);
          col *= 1.0 - 0.45 * smoothstep(0.5, 0.9, vnoise(qa * 0.18)) * smoothstep(1.4, 0.0, fy);
          rgh = 0.35;
        } else if (S == 18) { col = vec3(0.25, 0.16, 0.09) * (0.85 + 0.3 * h21(vec2(floor(fy * 25.0), 2.0))); rgh = 0.6;
        } else if (S == 19) {   // 床の染み(排水口のまわりの乾いた茶色)
          float r = length(vCol.xy - Lc); col = mix(vec3(0.12, 0.06, 0.045), vec3(0.24, 0.22, 0.2), smoothstep(0.2, vCol.z, r + 0.12 * vnoise(Lc * 6.0))); rgh = 0.5;
        }
        diffuseColor.rgb = col;
        float xR = rgh;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = xR;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (S == 4) totalEmissiveRadiance += vec3(0.9, 0.95, 1.0) * 1.3 * lampOn(${(OZ + T.w0).toFixed(1)} + floor(pz / ${T.lampDu.toFixed(1)}) * ${T.lampDu.toFixed(1)} + ${T.lamp0.toFixed(1)} + (P.z - ${W0Z} - pz));
        if (S == 15) totalEmissiveRadiance += vec3(0.92, 0.96, 1.0) * 1.1 * lampOn(P.z);
        if (S == 17) totalEmissiveRadiance += vec3(1.0, 0.8, 0.5) * 2.2 * (P.z < ${(OZ + LD.v1 + 1).toFixed(1)} ? 1.0 : lampOn(P.z));
        if (S == 5) {
          // 標識灯(琥珀色): 矢印と「07」。左上の画が欠けていて瞬く。3 回目に気づく頃は激しく瞬く
          vec3 an = abs(nW0);
          vec2 q = vec2(nW0.z > 0.0 ? Lc.x : -Lc.x, fy - 2.26) / 0.13;
          float g = 0.0;
          float fl = mix(step(0.3, sin(uTime * 7.0 + sin(uTime * 2.3) * 3.0)), step(0.5, h21(vec2(floor(uTime * 18.0), 1.0))), uSignFl);
          g = max(g, digit(q - vec2(0.5, 0.0), 0, fl)); g = max(g, digit(q - vec2(1.2, 0.0), 7, 1.0));
          // 矢印(上向き = この先へ)
          vec2 ar = q + vec2(1.3, 0.0);
          float arrow = max(seg(ar, vec2(0.0, -0.42), vec2(0.0, 0.4)), max(seg(ar, vec2(0.0, 0.42), vec2(-0.26, 0.12)), seg(ar, vec2(0.0, 0.42), vec2(0.26, 0.12))));
          g = max(g, arrow);
          totalEmissiveRadiance += vec3(1.0, 0.55, 0.12) * (0.08 + 2.6 * g) * (an.z > 0.5 ? 1.0 : 0.1) * (0.7 + 0.3 * (1.0 - uSignFl * step(0.6, h21(vec2(floor(uTime * 9.0), 7.0))))) * uRetOn;
        }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        if (S != 4 && S != 5 && S != 11 && S != 15 && S != 17) {
          vec3 n = inverseTransformDirection(normal, viewMatrix);
          vec3 V = normalize(cameraPosition - P);
          vec3 irr = vec3(0.0), sp = vec3(0.0);
          bool gloss = (S == 0 || S == 2 || S == 6 || S == 20 || S == 16) && xR < 0.5;
          // 区画ごとの灯り
          if (Lc.x > -1.25 && Lc.x < 1.25 && Lc.y < ${(MZ.v0 - 2).toFixed(1)}) {
            // トンネル: 天井の灯り(6m ごと・近い 4 つ)と標識灯
            float base = P.z - pz + ${T.lamp0.toFixed(1)};
            float k0 = floor((pz - ${T.lamp0.toFixed(1)}) / ${T.lampDu.toFixed(1)});
            for (int i = -1; i <= 2; i++) {
              float lz = base + (k0 + float(i)) * ${T.lampDu.toFixed(1)};
              vec3 L = vec3(${OX.toFixed(1)}, uY + ${(T.h - 0.05).toFixed(2)}, lz);
              vec3 d = L - P; float r2 = dot(d, d); vec3 l = d * inversesqrt(r2);
              float on = lampOn(lz);
              irr += vec3(0.86, 0.92, 1.0) * on * (max(dot(n, l), 0.0) * 0.8 + 0.2) * (0.35 + 0.65 * max(l.y, 0.0)) * 1.15 / (r2 + 0.8);
              if (gloss) { vec3 hv = normalize(l + V); sp += vec3(0.9, 0.95, 1.0) * on * pow(max(dot(n, hv), 0.0), 60.0) * 1.2 / (r2 * 0.25 + 1.0); }
            }
            float sz = P.z - pz + ${T.sign.toFixed(1)} + (pz > ${(T.sign + T.L / 2).toFixed(1)} ? ${T.L.toFixed(1)} : 0.0) - (pz < ${(T.sign - T.L / 2).toFixed(1)} ? ${T.L.toFixed(1)} : 0.0);
            { vec3 d = vec3(${OX.toFixed(1)}, uY + 2.2, sz) - P; float r2 = dot(d, d); vec3 l = d * inversesqrt(r2);
              irr += vec3(1.0, 0.5, 0.12) * uRetOn * 0.16 * (max(dot(n, l), 0.0) * 0.7 + 0.3) / (r2 + 0.4); }
            // 踊り場の扉が開いている間の、扉ごしの電球の光(本物の区画だけ)
            if (uDoorOpen > 0.0) { vec3 d = vec3(${X(-1.6).toFixed(2)}, uY + 1.6, ${Z(T.door).toFixed(2)}) - P; float r2 = dot(d, d); vec3 l = d * inversesqrt(r2);
              irr += vec3(1.0, 0.78, 0.5) * uDoorOpen * 0.35 * max(dot(n, l), 0.0) * smoothstep(-1.0, -0.6, -abs(P.z - ${Z(T.door).toFixed(2)}) / 3.0 + 0.0) / (r2 + 0.5); }
          } else if (Lc.x <= -1.0 && Lc.y < ${(LD.v1 + 0.5).toFixed(1)}) {
            // 踊り場: 籠の付いた裸電球
            vec3 d = vec3(${X(LD.bulb[0]).toFixed(2)}, uY + ${LD.bulb[1].toFixed(2)}, ${Z(LD.bulb[2]).toFixed(2)}) - P; float r2 = dot(d, d); vec3 l = d * inversesqrt(r2);
            irr += vec3(1.0, 0.76, 0.48) * (max(dot(n, l), 0.0) * 0.8 + 0.2) * 0.9 / (r2 + 0.5);
            if (gloss) { vec3 hv = normalize(l + V); sp += vec3(1.0, 0.8, 0.55) * pow(max(dot(n, hv), 0.0), 60.0) * 1.0 / (r2 * 0.3 + 1.0); }
          } else if (Lc.y < ${(SH.v0 - 0.1).toFixed(1)}) {
            // 迷路: 天井の格子の灯り(4m ごと・近い 3×3)。入口の手前の通路はトンネルの終わりの灯り
            float gi = clamp(floor((Lc.x + 6.0) / 4.0 + 0.5), 0.0, 3.0), gj = clamp(floor((Lc.y - 54.0) / 4.0 + 0.5), 0.0, 5.0);
            for (int a = -1; a <= 1; a++) for (int b = -1; b <= 1; b++) {
              float i = gi + float(a), j = gj + float(b); if (i < 0.0 || i > 3.0 || j < 0.0 || j > 5.0) continue;
              vec3 L = vec3(${(OX - 6).toFixed(1)} + i * 4.0, uY + ${(MZ.h - 0.05).toFixed(2)}, ${(OZ + 54).toFixed(1)} + j * 4.0);
              vec3 d = L - P; float r2 = dot(d, d); vec3 l = d * inversesqrt(r2);
              float on = lampOn(L.z);
              irr += vec3(0.9, 0.95, 1.0) * on * (max(dot(n, l), 0.0) * 0.8 + 0.2) * (0.3 + 0.7 * max(l.y, 0.0)) * 1.7 / (r2 + 1.0);
            }
            { vec3 d = vec3(${OX.toFixed(1)}, uY + 2.3, ${(OZ + MZ.v0 - 3).toFixed(1)}) - P; float r2 = dot(d, d); vec3 l = d * inversesqrt(r2);
              irr += vec3(0.86, 0.92, 1.0) * lampOn(${(OZ + MZ.v0 - 3).toFixed(1)}) * max(dot(n, l), 0.0) * 1.0 / (r2 + 0.8); }
          } else {
            // 作業場: 裸電球(黄色い)
            vec3 L = vec3(${X(SH.bulb[0]).toFixed(2)}, uY + ${SH.bulb[1].toFixed(2)}, ${Z(SH.bulb[2]).toFixed(2)});
            vec3 d = L - P; float r2 = dot(d, d); vec3 l = d * inversesqrt(r2);
            float on = lampOn(L.z);
            irr += vec3(1.0, 0.82, 0.5) * on * (max(dot(n, l), 0.0) * 0.8 + 0.2) * 0.75 / (r2 + 0.5);
            if (gloss) { vec3 hv = normalize(l + V); sp += vec3(1.0, 0.85, 0.6) * on * pow(max(dot(n, hv), 0.0), 50.0) / (r2 * 0.3 + 1.0); }
          }
          reflectedLight.indirectDiffuse += diffuseColor.rgb * irr;
          reflectedLight.indirectSpecular += sp * (1.0 - xR) * 0.5;
        }`);
  };
  m.customProgramCacheKey = () => 'n2_xb1_v1';
  return m;
}

// ================================================================ ジオメトリ
// トンネルの 1 周期(窓 [w0, w0+L) の k = 0 の位置で組む。写しはメッシュの位置を ±L ずらす)
function buildPeriod(b) {
  const hw = T.w / 2, z0 = Z(T.w0), z1 = Z(T.w0 + T.L), dz = Z(T.door);
  b.surf = SURF.tFloor; b.floor(X(-hw + 0.25), X(hw - 0.25), z0, z1, Y(0));
  b.surf = SURF.border; b.floor(X(-hw), X(-hw + 0.25), z0, z1, Y(0)); b.floor(X(hw - 0.25), X(hw), z0, z1, Y(0));
  // 天井(中央の帯は一段高い)
  b.surf = SURF.tCeil;
  b.floor(X(-hw), X(-0.35), z0, z1, Y(T.h), false); b.floor(X(0.35), X(hw), z0, z1, Y(T.h), false);
  b.floor(X(-0.35), X(0.35), z0, z1, Y(T.h + 0.14), false);
  b.wallX(X(-0.35), z0, z1, Y(T.h), Y(T.h + 0.14), 1); b.wallX(X(0.35), z0, z1, Y(T.h), Y(T.h + 0.14), -1);
  // 壁(腰の市松 0〜0.9・上は漆喰)。西の壁は踊り場への扉の開口
  const dw = 0.45;
  for (const [u, nx] of [[-hw, 1], [hw, -1]]) {
    const segs = nx > 0 ? [[z0, dz - dw], [dz + dw, z1]] : [[z0, z1]];
    for (const [a, c] of segs) { b.surf = SURF.tChk; b.wallX(X(u), a, c, Y(0), Y(0.9), nx); b.surf = SURF.tWall; b.wallX(X(u), a, c, Y(0.9), Y(T.h), nx); }
    if (nx > 0) { b.surf = SURF.tWall; b.wallX(X(u), dz - dw, dz + dw, Y(2.05), Y(T.h), nx); }
    // 付け柱(丸タイル)6m ごと(灯りの下。踊り場への扉の開口とは重ねない)
    b.surf = SURF.pil;
    for (let v = T.w0 + T.lamp0; v < T.w0 + T.L; v += T.lampDu) { const z = Z(v); b.box(nx > 0 ? X(u) : X(u) - 0.07, Y(0), z - 0.28, nx > 0 ? X(u) + 0.07 : X(u), Y(T.h), z + 0.28, nx > 0 ? 'px pz nz' : 'nx pz nz'); }
  }
  // 扉の枠と奥(写しは黒い箱 = 本物の区画では捨てる)
  b.surf = SURF.dark;
  b.box(X(-hw - 0.2), Y(0), dz - dw - 0.06, X(-hw + 0.03), Y(2.1), dz - dw, 'pz px'); b.box(X(-hw - 0.2), Y(0), dz + dw, X(-hw + 0.03), Y(2.1), dz + dw + 0.06, 'nz px');
  b.box(X(-hw - 0.2), Y(2.05), dz - dw - 0.06, X(-hw + 0.03), Y(2.11), dz + dw + 0.06, 'ny px');
  b.surf = SURF.void; b.box(X(-hw - 1.4), Y(0), dz - dw, X(-hw - 0.05), Y(2.05), dz + dw, 'px py nx pz nz'.replace('px ', ''));
  // 天井の灯り(中央の帯の中の長い灯具)
  b.surf = SURF.tLamp;
  for (let v = T.w0 + T.lamp0; v < T.w0 + T.L; v += T.lampDu) { const z = Z(v); b.box(X(-0.22), Y(T.h + 0.12), z - 0.9, X(0.22), Y(T.h + 0.135), z + 0.9, 'ny'); }
  // 標識灯(天井から吊る琥珀色の箱)
  { const z = Z(T.sign);
    b.surf = SURF.dark; b.box(X(-0.012), Y(2.42), z - 0.012, X(0.012), Y(T.h + 0.14), z + 0.012, 'px nx pz nz');
    b.box(X(-0.56), Y(2.08), z - 0.07, X(0.56), Y(2.44), z + 0.07, 'px nx py ny');
    b.surf = SURF.sign; b.box(X(-0.52), Y(2.11), z - 0.072, X(0.52), Y(2.41), z + 0.072, 'pz nz'); }
}

// 踊り場(湿ったコンクリート)と鉄扉
function buildLanding(b) {
  const { u0, u1, v0, v1, h } = LD;
  b.surf = SURF.cFloor; b.floor(X(u0), X(u1), Z(v0), Z(v1), Y(0));
  b.surf = SURF.cCeil; b.floor(X(u0), X(u1), Z(v0), Z(v1), Y(h), false);
  b.surf = SURF.cWall;
  b.wallX(X(u0), Z(v0), Z(v1), Y(0), Y(h), 1);
  b.wallX(X(u1), Z(v0), Z(T.door - 0.45), Y(0), Y(h), -1); b.wallX(X(u1), Z(T.door + 0.45), Z(v1), Y(0), Y(h), -1); b.wallX(X(u1), Z(T.door - 0.45), Z(T.door + 0.45), Y(2.05), Y(h), -1);
  b.wallZ(Z(v1), X(u0), X(u1), Y(0), Y(h), -1);
  const dx = LD.door;
  b.wallZ(Z(v0), X(u0), X(dx - 0.5), Y(0), Y(h), 1); b.wallZ(Z(v0), X(dx + 0.5), X(u1), Y(0), Y(h), 1); b.wallZ(Z(v0), X(dx - 0.5), X(dx + 0.5), Y(2.1), Y(h), 1);
  // 鉄扉(内側)と枠・レバー
  b.surf = SURF.iron; b.box(X(dx - 0.47), Y(0), Z(v0), X(dx + 0.47), Y(2.08), Z(v0 + 0.05));
  b.surf = SURF.dark; for (const [a, c] of [[dx - 0.53, dx - 0.47], [dx + 0.47, dx + 0.53]]) b.box(X(a), Y(0), Z(v0), X(c), Y(2.14), Z(v0 + 0.08)); b.box(X(dx - 0.53), Y(2.08), Z(v0), X(dx + 0.53), Y(2.14), Z(v0 + 0.08));
  b.box(X(dx + 0.22), Y(0.98), Z(v0 + 0.05), X(dx + 0.38), Y(1.02), Z(v0 + 0.11));
  // 天井の配管・籠の電球
  b.surf = SURF.dark;
  for (const [u, r] of [[-4.4, 0.06], [-4.1, 0.04], [-1.7, 0.05]]) b.addGeo(new THREE.CylinderGeometry(r, r, v1 - v0, 10).rotateX(Math.PI / 2), new THREE.Matrix4().makeTranslation(X(u), Y(h - 0.18), Z((v0 + v1) / 2)));
  b.surf = SURF.bulb; b.addGeo(new THREE.SphereGeometry(0.05, 10, 8), new THREE.Matrix4().makeTranslation(X(LD.bulb[0]), Y(LD.bulb[1]), Z(LD.bulb[2])));
  b.surf = SURF.dark; b.addGeo(new THREE.CylinderGeometry(0.09, 0.09, 0.16, 8, 1, true), new THREE.Matrix4().makeTranslation(X(LD.bulb[0]), Y(LD.bulb[1]), Z(LD.bulb[2])));
  b.box(X(LD.bulb[0]) - 0.008, Y(LD.bulb[1] + 0.05), Z(LD.bulb[2]) - 0.008, X(LD.bulb[0]) + 0.008, Y(h), Z(LD.bulb[2]) + 0.008, 'px nx pz nz');
  // 濡れた段ボール・バケツ
  b.surf = SURF.prop; b.col = [0.3, 0.24, 0.16]; b.rbox(X(u0 + 0.4), Y(0.18), Z(v1 - 1.0), 0.5, 0.36, 0.4, 0.3);
  b.col = [0.2, 0.25, 0.3]; b.addGeo(new THREE.CylinderGeometry(0.15, 0.12, 0.3, 12), new THREE.Matrix4().makeTranslation(X(u0 + 0.35), Y(0.15), Z(2.0)));
}

// 抜けた後の続き(トンネルの終わり → 白い前室 → 迷路の部屋)と作業場
function buildBeyond(b) {
  const hw = T.w / 2, z0 = Z(T.w0 + 2 * T.L), zv = Z(MZ.v0 - 2), zm = Z(MZ.v0);
  // トンネル(扉のない最後の区間)
  b.surf = SURF.tFloor; b.floor(X(-hw + 0.25), X(hw - 0.25), z0, zv, Y(0));
  b.surf = SURF.border; b.floor(X(-hw), X(-hw + 0.25), z0, zv, Y(0)); b.floor(X(hw - 0.25), X(hw), z0, zv, Y(0));
  b.surf = SURF.tCeil; b.floor(X(-hw), X(-0.35), z0, zv, Y(T.h), false); b.floor(X(0.35), X(hw), z0, zv, Y(T.h), false); b.floor(X(-0.35), X(0.35), z0, zv, Y(T.h + 0.14), false);
  b.wallX(X(-0.35), z0, zv, Y(T.h), Y(T.h + 0.14), 1); b.wallX(X(0.35), z0, zv, Y(T.h), Y(T.h + 0.14), -1);
  for (const [u, nx] of [[-hw, 1], [hw, -1]]) { b.surf = SURF.tChk; b.wallX(X(u), z0, zv, Y(0), Y(0.9), nx); b.surf = SURF.tWall; b.wallX(X(u), z0, zv, Y(0.9), Y(T.h), nx); }
  b.surf = SURF.tLamp; for (let v = T.w0 + 2 * T.L + T.lamp0; v < MZ.v0 - 2; v += T.lampDu) { const z = Z(v); b.box(X(-0.22), Y(T.h + 0.12), z - 0.9, X(0.22), Y(T.h + 0.135), z + 0.9, 'ny'); }
  // 白い前室(天井 2.45)
  b.surf = SURF.tCeil; b.wallZ(zv, X(-hw), X(hw), Y(MZ.h), Y(T.h + 0.14), -1);
  b.surf = SURF.oFloor; b.floor(X(-hw), X(hw), zv, zm, Y(0));
  b.surf = SURF.oCeil; b.floor(X(-hw), X(hw), zv, zm, Y(MZ.h), false);
  b.surf = SURF.oWall; b.wallX(X(-hw), zv, zm, Y(0), Y(MZ.h), 1); b.wallX(X(hw), zv, zm, Y(0), Y(MZ.h), -1);
  // 迷路の部屋
  const u0 = MZ.u0, u1 = MZ.u0 + MZ.nc * MZ.cell, v0 = MZ.v0, v1 = MZ.v0 + MZ.nr * MZ.cell;
  b.surf = SURF.oFloor; b.floor(X(u0), X(u1), Z(v0), Z(v1), Y(0));
  b.surf = SURF.oCeil; b.floor(X(u0), X(u1), Z(v0), Z(v1), Y(MZ.h), false);
  b.surf = SURF.oWall;
  b.wallX(X(u0), Z(v0), Z(v1), Y(0), Y(MZ.h), 1); b.wallX(X(u1), Z(v0), Z(v1), Y(0), Y(MZ.h), -1);
  b.wallZ(Z(v0), X(u0), X(-hw), Y(0), Y(MZ.h), 1); b.wallZ(Z(v0), X(hw), X(u1), Y(0), Y(MZ.h), 1);
  const sd = SH.door;
  b.wallZ(Z(v1), X(u0), X(sd - 0.5), Y(0), Y(MZ.h), -1); b.wallZ(Z(v1), X(sd + 0.5), X(u1), Y(0), Y(MZ.h), -1); b.wallZ(Z(v1), X(sd - 0.5), X(sd + 0.5), Y(2.05), Y(MZ.h), -1);
  b.surf = SURF.oLamp;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 6; j++) { const x = X(-6 + i * 4), z = Z(54 + j * 4); b.box(x - 0.3, Y(MZ.h - 0.02), z - 0.6, x + 0.3, Y(MZ.h - 0.005), z + 0.6, 'ny'); }
  b.surf = SURF.dark; b.box(X(u0), Y(0), Z(v0), X(u1), Y(0.08), Z(v0) + 0.01, 'pz py');
  // 作業場(古いタイルの壁・コンクリートの床・排水口と染み・洗い場・道具・袋・冷凍庫・ビニールの幕)
  const S0 = SH;
  b.surf = SURF.cFloor; b.floor(X(S0.u0), X(S0.u1), Z(S0.v0 - 0.2), Z(S0.v1), Y(0));
  b.surf = SURF.cCeil; b.floor(X(S0.u0), X(S0.u1), Z(S0.v0 - 0.2), Z(S0.v1), Y(S0.h), false);
  b.surf = SURF.shopWall;
  b.wallX(X(S0.u0), Z(S0.v0 - 0.2), Z(S0.v1), Y(0), Y(S0.h), 1); b.wallX(X(S0.u1), Z(S0.v0 - 0.2), Z(S0.v1), Y(0), Y(S0.h), -1);
  b.wallZ(Z(S0.v1), X(S0.u0), X(S0.u1), Y(0), Y(S0.h), -1);
  b.wallZ(Z(S0.v0 - 0.2), X(S0.u0), X(sd - 0.5), Y(0), Y(S0.h), 1); b.wallZ(Z(S0.v0 - 0.2), X(sd + 0.5), X(S0.u1), Y(0), Y(S0.h), 1); b.wallZ(Z(S0.v0 - 0.2), X(sd - 0.5), X(sd + 0.5), Y(2.05), Y(S0.h), 1);
  b.surf = SURF.dark; b.box(X(sd - 0.5), Y(0), Z(v1), X(sd + 0.5), Y(0.02), Z(S0.v0 - 0.2), 'py');
  for (const a of [sd - 0.56, sd + 0.5]) b.box(X(a), Y(0), Z(v1) - 0.02, X(a + 0.06), Y(2.1), Z(S0.v0 - 0.18), 'px nx pz nz');
  // 排水口と染み(aCol.xy = 中心の局所 u・v、z = 半径)
  b.surf = SURF.dark; b.floor(X(6.28), X(6.52), Z(79.48), Z(79.72), Y(0.005));
  // 洗い場(西の壁: 深いシンクと蛇口・ホース)
  b.surf = SURF.prop; b.col = [0.55, 0.56, 0.55];
  b.box(X(S0.u0), Y(0.0), Z(78.0), X(S0.u0 + 0.75), Y(0.62), Z(79.5), 'px py pz nz');
  b.col = [0.22, 0.23, 0.22]; b.box(X(S0.u0 + 0.08), Y(0.4), Z(78.1), X(S0.u0 + 0.67), Y(0.621), Z(79.4), 'py');
  b.surf = SURF.dark; b.box(X(S0.u0 + 0.02), Y(0.62), Z(78.7), X(S0.u0 + 0.08), Y(1.05), Z(78.78)); b.box(X(S0.u0 + 0.02), Y(1.0), Z(78.7), X(S0.u0 + 0.3), Y(1.04), Z(78.78));
  b.surf = SURF.prop; b.col = [0.18, 0.32, 0.2];
  for (let k = 0; k < 3; k++) b.addGeo(new THREE.TorusGeometry(0.28 - k * 0.03, 0.018, 6, 24).rotateX(Math.PI / 2), new THREE.Matrix4().makeTranslation(X(4.6), Y(0.02 + k * 0.035), Z(80.9)));
  // 道具の板(東の壁): 吊るした道具の影のような形(長柄・のこぎり・ロープ)
  b.surf = SURF.wood; b.box(X(S0.u1 - 0.03), Y(0.9), Z(79.0), X(S0.u1), Y(2.0), Z(80.8), 'nx');
  b.surf = SURF.dark;
  b.rbox(X(S0.u1 - 0.06), Y(1.42), Z(79.3), 0.03, 0.9, 0.04); b.rbox(X(S0.u1 - 0.06), Y(1.55), Z(79.8), 0.02, 0.35, 0.28);
  b.rbox(X(S0.u1 - 0.06), Y(1.5), Z(80.35), 0.02, 0.5, 0.06, 0, 0.0, 0.0);
  b.surf = SURF.prop; b.col = [0.5, 0.42, 0.28]; b.addGeo(new THREE.TorusGeometry(0.17, 0.03, 6, 20).rotateY(Math.PI / 2), new THREE.Matrix4().makeTranslation(X(S0.u1 - 0.07), Y(1.25), Z(80.55)));
  // ゴムの前掛けと手袋(南の壁)・バケツとモップ・漂白剤の容器(白い・ラベルなし)・黒い袋の山・冷凍庫(鎖)・ビニールの幕
  b.col = [0.2, 0.17, 0.1]; b.rbox(X(7.6), Y(1.25), Z(S0.v1 - 0.05), 0.55, 0.85, 0.03);
  b.col = [0.32, 0.28, 0.12]; b.rbox(X(7.15), Y(1.55), Z(S0.v1 - 0.05), 0.12, 0.25, 0.03, 0, 0, 0.2);
  b.col = [0.3, 0.32, 0.36]; b.addGeo(new THREE.CylinderGeometry(0.15, 0.13, 0.32, 12), new THREE.Matrix4().makeTranslation(X(4.1), Y(0.16), Z(80.3)));
  b.col = [0.4, 0.35, 0.28]; b.rbox(X(4.25), Y(0.75), Z(80.25), 0.025, 1.5, 0.025, 0, 0.0, 0.18);
  b.col = [0.84, 0.84, 0.8]; for (let k = 0; k < 4; k++) b.rbox(X(3.75 + k * 0.17), Y(0.16), Z(77.6), 0.14, 0.3, 0.1, k * 0.2);
  b.col = [0.035, 0.035, 0.04];
  for (const [u, v, s] of [[7.95, 80.1, 0.55], [8.05, 80.75, 0.5], [7.75, 80.6, 0.45], [7.95, 80.4, 0.4]]) b.rbox(X(u), Y(s * 0.4), Z(v), s * 0.9, s * 0.8, s, u * 3.1, 0.1, -0.1);
  b.col = [0.82, 0.82, 0.8]; b.box(X(7.35), Y(0), Z(77.0), X(8.45), Y(0.85), Z(78.6));
  b.surf = SURF.dark; for (let k = 0; k < 9; k++) b.rbox(X(7.33), Y(0.8 - k * 0.075), Z(77.5 + (k % 2) * 0.03), 0.02, 0.05, 0.035, 0, 0.6, 0);
  b.surf = SURF.prop; b.col = [0.62, 0.64, 0.64]; b.rbox(X(5.0), Y(1.3), Z(77.8), 1.0, 2.1, 0.01, 0.3, 0, 0.03);
  // フックの板(車のキー)・裸電球
  const [hu, hy, hv] = DEF.slots.hook;
  b.surf = SURF.wood; b.box(X(hu - 0.3), Y(hy - 0.12), Z(hv) - 0.02, X(hu + 0.3), Y(hy + 0.08), Z(hv) + 0.02);
  b.surf = SURF.dark; for (const o of [-0.18, 0, 0.18]) b.box(X(hu + o) - 0.004, Y(hy - 0.025), Z(hv) - 0.06, X(hu + o) + 0.004, Y(hy - 0.015), Z(hv) - 0.02);
  b.surf = SURF.bulb; b.addGeo(new THREE.SphereGeometry(0.045, 10, 8), new THREE.Matrix4().makeTranslation(X(SH.bulb[0]), Y(SH.bulb[1]), Z(SH.bulb[2])));
  b.surf = SURF.dark; b.box(X(SH.bulb[0]) - 0.006, Y(SH.bulb[1] + 0.04), Z(SH.bulb[2]) - 0.006, X(SH.bulb[0]) + 0.006, Y(SH.h), Z(SH.bulb[2]) + 0.006, 'px nx pz nz');
}

function buildPartitionGeo() {
  const b = new GB(); const L = MZ.cell, t = 0.08;
  b.surf = SURF.oWall; b.box(-L / 2, 0, -t / 2, L / 2, MZ.wall, t / 2, 'pz nz py px nx');
  b.surf = SURF.dark; b.box(-L / 2, 0, -t / 2 - 0.004, L / 2, 0.08, t / 2 + 0.004, 'pz nz');
  return b.geometry();
}

// ================================================================ 迷路(格子の辺の壁)
function mazeEdges() {
  const E = [];
  for (let r = 0; r < MZ.nr; r++) for (let c = 0; c < MZ.nc - 1; c++) E.push({ a: [c, r], b: [c + 1, r], vert: true, u: MZ.u0 + (c + 1) * MZ.cell, v: MZ.v0 + (r + 0.5) * MZ.cell });
  for (let r = 0; r < MZ.nr - 1; r++) for (let c = 0; c < MZ.nc; c++) E.push({ a: [c, r], b: [c, r + 1], vert: false, u: MZ.u0 + (c + 0.5) * MZ.cell, v: MZ.v0 + (r + 1) * MZ.cell });
  return E.map((e, i) => ({ ...e, i, on: false }));
}
const cid = (c, r) => r * MZ.nc + c;
function adjacency(st) {
  const adj = Array.from({ length: MZ.nc * MZ.nr }, () => []);
  for (const e of st.edges) if (!e.on) { const a = cid(...e.a), b = cid(...e.b); adj[a].push(b); adj[b].push(a); }
  return adj;
}
function bfs(adj, s) { const d = new Int32Array(adj.length).fill(-1); d[s] = 0; const q = [s]; for (let k = 0; k < q.length; k++) for (const n of adj[q[k]]) if (d[n] < 0) { d[n] = d[q[k]] + 1; q.push(n); } return d; }
function initMaze(st) {
  const R = st.R;
  for (const e of st.edges) e.on = true;
  // 種のある乱数の深さ優先で全域木 → 行き止まりの 4 割を開ける(遊べる難しさ)
  const seen = new Uint8Array(MZ.nc * MZ.nr), stack = [MZ.entry.slice()];
  seen[cid(...MZ.entry)] = 1;
  const edgeOf = (a, b) => st.edges.find((e) => (e.a[0] === a[0] && e.a[1] === a[1] && e.b[0] === b[0] && e.b[1] === b[1]) || (e.a[0] === b[0] && e.a[1] === b[1] && e.b[0] === a[0] && e.b[1] === a[1]));
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [cur[0] + dx, cur[1] + dy]).filter(([c, r]) => c >= 0 && r >= 0 && c < MZ.nc && r < MZ.nr && !seen[cid(c, r)]);
    if (!nb.length) { stack.pop(); continue; }
    const n = nb[(R() * nb.length) | 0];
    edgeOf(cur, n).on = false; seen[cid(...n)] = 1; stack.push(n);
  }
  const adj = adjacency(st);
  for (let k = 0; k < adj.length; k++) if (adj[k].length === 1 && R() < 0.4) {
    const c = k % MZ.nc, r = (k / MZ.nc) | 0;
    const cand = st.edges.filter((e) => e.on && ((e.a[0] === c && e.a[1] === r) || (e.b[0] === c && e.b[1] === r)));
    if (cand.length) cand[(R() * cand.length) | 0].on = false;
  }
}

// ================================================================ 当たり
function col(ctx, u0, v0, u1, v1, kind = 'wall', h = 2.6) {
  const c = { minX: X(u0), maxX: X(u1), minZ: Z(v0), maxZ: Z(v1), y0: SPACE_Y, y1: SPACE_Y + h, kind, roomId: ctx.key, disabled: false };
  ctx.cols.push(c);
  return c;
}

// ================================================================ build
export function build(ctx) {
  const st = ctx.state;
  const U = st.U = { uTime: { value: 0 }, uY: { value: SPACE_Y }, uOffZ: { value: 1e4 }, uDoorOpen: { value: 0 }, uSignFl: { value: 0 }, uRetOn: { value: 1 } };
  const mat = st.mat = makeMaterial(U);
  const g = ctx.group;
  const mesh = (geo, name) => { const o = new THREE.Mesh(geo, mat); o.name = name; o.receiveShadow = true; o.castShadow = false; o.frustumCulled = false; g.add(o); return o; };
  // トンネルの周期(k = −1, 0, 1 と、抜ける前の続き k = 2)
  { const b = new GB(); buildPeriod(b); const geo = b.geometry();
    st.periods = [-1, 0, 1, 2].map((k) => { const m = mesh(geo, 'XB1_period' + k); m.position.z = k * T.L; return m; }); }
  // 踊り場への扉(周期ごとに同じ角度。西へ開く)
  { const b = new GB(); b.surf = SURF.iron; b.box(0, 0, 0, 0.05, 2.03, 0.88); b.surf = SURF.dark; b.box(0.05, 0.96, 0.66, 0.1, 0.99, 0.82);
    const geo = b.geometry();
    st.doorPivots = [-1, 0, 1, 2].map((k) => { const pv = new THREE.Group(); pv.position.set(X(-T.w / 2 - 0.15), Y(0), Z(T.door - 0.44 + k * T.L)); const leaf = new THREE.Mesh(geo, mat); leaf.receiveShadow = true; pv.add(leaf); g.add(pv); return pv; }); }
  { const b = new GB(); buildLanding(b); st.landing = mesh(b.geometry(), 'XB1_landing'); }
  { const b = new GB(); buildBeyond(b); st.beyond = mesh(b.geometry(), 'XB1_beyond'); }
  // 迷路の仕切り(InstancedMesh。立っていない壁は大きさ 0)
  st.edges = mazeEdges();
  { const pm = st.partMesh = new THREE.InstancedMesh(buildPartitionGeo(), mat, st.edges.length); pm.name = 'XB1_partitions'; pm.receiveShadow = true; pm.castShadow = true; pm.frustumCulled = false; g.add(pm); }
  // 当たり
  const hw = T.w / 2;
  col(ctx, -hw - 0.2, T.from, -hw, T.door - 0.45); col(ctx, -hw - 0.2, T.door + 0.45, -hw, MZ.v0 - 2);   // トンネルの西の壁(扉の開口)
  st.colDoor = col(ctx, -hw - 0.2, T.door - 0.45, -hw, T.door + 0.45);
  col(ctx, hw, T.from, hw + 0.2, MZ.v0 - 2);
  col(ctx, -hw, T.from - 0.2, hw, T.from);
  col(ctx, -hw - 0.2, MZ.v0 - 2, -hw, MZ.v0); col(ctx, hw, MZ.v0 - 2, hw + 0.2, MZ.v0);                      // 前室
  // 踊り場
  col(ctx, LD.u0 - 0.2, LD.v0, LD.u0, LD.v1); col(ctx, LD.u0, LD.v1, LD.u1, LD.v1 + 0.2);
  col(ctx, LD.u0, LD.v0 - 0.2, LD.door - 0.45, LD.v0); col(ctx, LD.door + 0.45, LD.v0 - 0.2, LD.u1, LD.v0); col(ctx, LD.door - 0.45, LD.v0 - 0.2, LD.door + 0.45, LD.v0);
  col(ctx, LD.u0, LD.v1 - 1.25, LD.u0 + 0.7, LD.v1 - 0.75, 'furn', 0.4);
  // 迷路の部屋の外周・作業場
  const mu1 = MZ.u0 + MZ.nc * MZ.cell, mv1 = MZ.v0 + MZ.nr * MZ.cell;
  col(ctx, MZ.u0 - 0.2, MZ.v0, MZ.u0, mv1); col(ctx, mu1, MZ.v0, mu1 + 0.2, mv1);
  col(ctx, MZ.u0, MZ.v0 - 0.2, -hw, MZ.v0); col(ctx, hw, MZ.v0 - 0.2, mu1, MZ.v0);
  col(ctx, MZ.u0, mv1, SH.door - 0.5, mv1 + 0.2); col(ctx, SH.door + 0.5, mv1, mu1, mv1 + 0.2);
  col(ctx, SH.u0 - 0.2, SH.v0 - 0.2, SH.u0, SH.v1); col(ctx, SH.u1, SH.v0 - 0.2, SH.u1 + 0.2, SH.v1); col(ctx, SH.u0, SH.v1, SH.u1, SH.v1 + 0.2);
  col(ctx, SH.u0, SH.v0 - 0.2, SH.door - 0.5, SH.v0); col(ctx, SH.door + 0.5, SH.v0 - 0.2, SH.u1, SH.v0);
  col(ctx, SH.u0, 78.0, SH.u0 + 0.75, 79.5, 'furn', 1.0); col(ctx, 7.35, 77.0, 8.45, 78.6, 'furn', 0.85); col(ctx, 7.5, 79.7, 8.5, 81.1, 'furn', 0.6);
  for (const e of st.edges) {
    const t = 0.06, L = MZ.cell / 2;
    e.col = e.vert ? col(ctx, e.u - t, e.v - L, e.u + t, e.v + L, 'wall', MZ.wall) : col(ctx, e.u - L, e.v - t, e.u + L, e.v + t, 'wall', MZ.wall);
  }
  // 敵の照明(使わない = 管理人は来ない。踊り場の電球だけ)
  ctx.lamps.push([X(LD.bulb[0]), Y(LD.bulb[1]), Z(LD.bulb[2])]);
  reset(ctx);
  g.visible = false;
}

const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s1 = new THREE.Vector3(1, 1, 1), _s0 = new THREE.Vector3(0, 0, 0), _p = new THREE.Vector3(), _yAx = new THREE.Vector3(0, 1, 0);
function setEdge(ctx, e, on) {
  const st = ctx.state;
  e.on = on; e.col.disabled = !on || !st.released;
  _q.setFromAxisAngle(_yAx, e.vert ? Math.PI / 2 : 0);
  _p.set(X(e.u), Y(0), Z(e.v));
  _m4.compose(_p, _q, on ? _s1 : _s0);
  st.partMesh.setMatrixAt(e.i, _m4);
  st.partMesh.instanceMatrix.needsUpdate = true;
}

function reset(ctx) {
  const st = ctx.state;
  Object.assign(st, { t: 0, released: false, passes: 0, lastPassV: null, armed: false, stillT: 0, turnT: 0, travel: 1, prevV: null, teleports: 0, walked: 0,
    keyTaken: false, keyBefore: false, retLoops: 0, retOpen: false, offZ: 1e4, door: 0.9, doorTarget: 0.9, doorLocked: false, flips: 0, flipT: 0, log: [], noticed: false,
    stepsT: 9 + Math.random() * 6, steps: null, screamed: false, walkIn: 0, walkRet: 0, lastPos: null, edgeLog: [] });
  st.R = rng(MZ.seed);
  initMaze(st);
  for (const e of st.edges) setEdge(ctx, e, e.on);
  applyRelease(ctx, false);
  st.U.uOffZ.value = 1e4; st.U.uSignFl.value = 0; st.U.uRetOn.value = 1;
  setDoor(ctx, 0.9);
}
function applyRelease(ctx, on) {
  const st = ctx.state;
  st.released = on;
  st.periods[3].visible = !on;      // k = 2 の写し ↔ 抜けた後の続き
  st.beyond.visible = on; st.partMesh.visible = on;
  st.doorPivots[3].visible = !on;
  for (const e of st.edges) e.col.disabled = !e.on || !on;
}
function setDoor(ctx, a) {
  const st = ctx.state;
  st.door = a;
  for (const pv of st.doorPivots) pv.rotation.y = -a;   // 西(踊り場)へ開く
  st.colDoor.disabled = a > 0.35;
  st.U.uDoorOpen.value = Math.min(1, a / 0.9);
}

export function enter(ctx) {
  const st = ctx.state;
  reset(ctx);
  // 車のキーを取った後にもう一度入った時は、ふつうの地下(ループも伸びるもない・迷路は動かない)
  const s = ctx.story; st.keyBefore = !!(s && s.taken && s.taken.has('kCar'));
  if (st.keyBefore) applyRelease(ctx, true);
  st.log.push({ t: 0, ev: 'enter', keyBefore: st.keyBefore });
}
export function leave(ctx) { stopSound(ctx); }
export function dispose(ctx) {
  for (const o of [...ctx.group.children]) { ctx.group.remove(o); o.traverse((m) => { if (m.geometry) m.geometry.dispose(); }); }
  if (ctx.state.mat) ctx.state.mat.dispose();
  ctx.cols.length = 0; ctx.lamps.length = 0;
}

// ================================================================ 毎フレーム
const _frus = new THREE.Frustum(), _pm = new THREE.Matrix4(), _box = new THREE.Box3(), _f = new THREE.Vector3();
function edgeInView(e) {
  const m = 0.35, L = MZ.cell / 2 + m, t = 0.1 + m;
  if (e.vert) { _box.min.set(X(e.u) - t, Y(-0.2), Z(e.v) - L); _box.max.set(X(e.u) + t, Y(MZ.wall + 0.3), Z(e.v) + L); }
  else { _box.min.set(X(e.u) - L, Y(-0.2), Z(e.v) - t); _box.max.set(X(e.u) + L, Y(MZ.wall + 0.3), Z(e.v) + t); }
  return _frus.intersectsBox(_box);
}
function shift(ctx, dz) {
  const st = ctx.state, pl = ctx.player;
  pl.pos.z += dz; pl.object.position.z += dz;
  if (st.offZ < 1e3) st.offZ += dz;
  if (st.lastPassV !== null) st.lastPassV += dz;
  st.prevV += dz;
  st.teleports++;
}
export function update(dt, ctx) {
  const st = ctx.state, U = st.U, pl = ctx.player, cam = ctx.camera;
  st.t += dt; U.uTime.value += dt;
  if (ctx.scene.fog) { ctx.scene.fog.color.setHex(XB1.fog[0]); ctx.scene.fog.density = XB1.fog[1]; }
  let u = pl.pos.x - OX, v = pl.pos.z - OZ;
  if (st.prevV === null) st.prevV = v;
  // 歩いた距離(行き = 抜けてからキーまで / 戻り = キーから踊り場まで)
  if (st.lastPos) { const d = Math.hypot(pl.pos.x - st.lastPos.x, pl.pos.z - st.lastPos.z); if (d < 1.0) { if (st.keyTaken) st.walkRet += d; else if (st.released) st.walkIn += d; } }
  const inTun = Math.abs(u) < T.w / 2 + 0.05 && v < MZ.v0 - 2;
  // ① ループ: 窓 [w0, w0+L) の外へ出たら継ぎ目なしに戻す(抜けた後は前へは戻さない = 先へ進める)
  if (inTun && !st.keyBefore) {
    if (!st.released && v >= T.w0 + T.L) { shift(ctx, -T.L); v -= T.L; st.log.push({ t: st.t, ev: 'loop', dir: 1 }); }
    else if (v < T.w0) {
      shift(ctx, T.L); v += T.L; st.log.push({ t: st.t, ev: 'loop', dir: -1 });
      if (st.keyTaken) { st.retLoops++; st.log.push({ t: st.t, ev: 'ret_loop', n: st.retLoops }); }
    }
  }
  // 標識灯を通る(どちら向きでも。行ったり来たりは数えない)
  if (inTun && !st.keyTaken) {
    for (const sz of [T.sign, T.sign + T.L]) {
      if ((st.prevV - sz) * (v - sz) < 0 && (st.lastPassV === null || Math.abs(v - st.lastPassV) >= XB1.loop.hyst)) {
        st.passes++; st.lastPassV = v; st.lastPassSign = Math.sign(v - st.prevV);
        st.log.push({ t: st.t, ev: 'pass', n: st.passes, v: +v.toFixed(2) });
        if (st.passes === XB1.loop.notice && !st.released) { st.armed = true; st.noticed = true; sfx(ctx, 'notice'); st.log.push({ t: st.t, ev: 'notice' }); }
        if (st.passes >= XB1.loop.safety && !st.released) release(ctx, 'safety');
      }
    }
  }
  const dv = v - st.prevV;
  if (Math.abs(dv) > 1e-4) st.travel = Math.sign(dv);
  // 抜ける: 気づいた後(3 回目)、一度立ち止まる or 振り返る
  if (st.armed && !st.released && inTun) {
    const sp = Math.hypot(pl.pos.x - (st.lastPos ? st.lastPos.x : pl.pos.x), pl.pos.z - (st.lastPos ? st.lastPos.z : pl.pos.z)) / Math.max(dt, 1e-4);
    st.stillT = sp < 0.05 ? st.stillT + dt : 0;
    cam.getWorldDirection(_f); _f.y = 0; _f.normalize();
    st.turnT = _f.z * (st.lastPassSign || st.travel) < -0.3 ? st.turnT + dt : 0;   // 標識灯を通った向きと逆を向いた
    if (st.stillT >= XB1.loop.still) release(ctx, 'still');
    else if (st.turnT >= XB1.loop.turn) release(ctx, 'turn');
  }
  U.uSignFl.value += ((st.noticed && !st.released ? 1 : 0) - U.uSignFl.value) * Math.min(1, dt * 3);
  st.prevV = v;
  st.lastPos = { x: pl.pos.x, z: pl.pos.z };
  // 踊り場の扉: 入ってトンネルで 3m 離れたら閉まる(重い音)。E でまた開く。戻り(キーの後)は 2 周するまで開かない
  const dDoor = Math.hypot(u - (-T.w / 2), v - T.door);
  if (st.doorTarget > 0 && dDoor > 3.0 && inTun && !st.keyTaken) { st.doorTarget = 0; st.log.push({ t: st.t, ev: 'door_close' }); sfx(ctx, 'clank'); }
  if (st.keyTaken && !st.retOpen && st.retLoops >= XB1.ret.loops) { st.retOpen = true; st.doorLocked = false; st.doorTarget = 0.55; st.log.push({ t: st.t, ev: 'door_ajar' }); sfx(ctx, 'creak'); }
  if (Math.abs(st.door - st.doorTarget) > 1e-3) setDoor(ctx, st.door + THREE.MathUtils.clamp(st.doorTarget - st.door, -dt * 0.9, dt * 0.9));
  // ② 迷路: 見ていない・離れた仕切りだけ、繋がりを保って変える
  const inMaze = st.released && v > MZ.v0 - 4;
  if (inMaze && !st.keyBefore) {
    st.flipT -= dt;
    if (st.flipT <= 0) { st.flipT = MZ.every; flip(ctx, u, v); }
  }
  // 鍵(物語の pickups): 取ったら戻りの演出(灯りが背後から消える・扉は 2 周まで開かない)
  const s = ctx.story;
  if (!st.keyBefore && !st.keyTaken && s && s.taken && s.taken.has('kCar')) {
    st.keyTaken = true; st.doorLocked = true; st.doorTarget = 0; st.offZ = pl.pos.z + XB1.ret.offBehind + 2.0;
    st.log.push({ t: st.t, ev: 'key', u, v }); sfx(ctx, 'key_drone');
  }
  if (st.keyTaken) {
    const want = pl.pos.z + XB1.ret.offBehind;
    if (want < st.offZ) st.offZ = Math.max(want, st.offZ - XB1.ret.offRate * dt);
  }
  U.uOffZ.value = st.keyTaken ? st.offZ : 1e4;
  sound(ctx, dt, inTun);
}

function release(ctx, why) {
  const st = ctx.state;
  if (st.released) return;
  applyRelease(ctx, true);
  st.armed = false;
  st.log.push({ t: st.t, ev: 'release', why, passes: st.passes });
  sfx(ctx, 'release');
}

function flip(ctx, u, v) {
  const st = ctx.state, cam = ctx.camera, R = st.R;
  cam.updateMatrixWorld();
  _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); _frus.setFromProjectionMatrix(_pm);
  const pc = [THREE.MathUtils.clamp(Math.floor((u - MZ.u0) / MZ.cell), 0, MZ.nc - 1), THREE.MathUtils.clamp(Math.floor((v - MZ.v0) / MZ.cell), 0, MZ.nr - 1)];
  const inside = v >= MZ.v0;
  const on = st.edges.filter((e) => e.on).length, dens = on / st.edges.length;
  const target = st.keyTaken ? MZ.densityRet : MZ.density;
  for (let tries = 0; tries < 6; tries++) {
    const e = st.edges[(R() * st.edges.length) | 0];
    const add = !e.on;
    if (add && dens > target + 0.03 && R() < 0.8) continue;
    if (!add && dens < target - 0.03 && R() < 0.8) continue;
    // 近くの壁(プレイヤーの 2.6m 以内)と見えている壁は変えない
    const L = MZ.cell / 2;
    const du = e.vert ? Math.abs(u - e.u) : Math.max(0, Math.abs(u - e.u) - L), dvv = e.vert ? Math.max(0, Math.abs(v - e.v) - L) : Math.abs(v - e.v);
    if (Math.hypot(du, dvv) < MZ.near) continue;
    if (edgeInView(e)) continue;
    e.on = add;
    // 入口・作業場・プレイヤーの升がいつも繋がっている(行きは作業場まで、戻りは入口まで長すぎない)
    const adj = adjacency(st);
    const dE = bfs(adj, cid(...MZ.entry));
    const ok = dE[cid(...MZ.goal)] >= 0 && (!inside || dE[cid(...pc)] >= 0);
    let len = true;
    if (ok && add && inside) { const dP = bfs(adj, cid(...pc)); const to = st.keyTaken ? dP[cid(...MZ.entry)] : dP[cid(...MZ.goal)]; len = to >= 0 && to <= (st.keyTaken ? MZ.maxRet : MZ.maxIn); }
    if (!ok || !len) { e.on = !add; continue; }
    e.on = !add; setEdge(ctx, e, add);
    st.flips++;
    st.edgeLog.push({ t: +st.t.toFixed(2), i: e.i, on: add });
    if (st.edgeLog.length > 400) st.edgeLog.shift();
    return true;
  }
  return false;
}

// ================================================================ 物語とのつなぎ
// 戻る口: 鉄扉(歩いて近づくか E で出る)
export function exits(ctx) { return [{ x: X(LD.door), z: Z(LD.v0 + 0.02), n: [0, 1], auto: true, reach: 1.3, depth: 0.6, half: 0.6 }]; }
// 画面ガイドの対象: 踊り場への扉(トンネル側・踊り場側から E で開ける。戻りは 2 周まで開かない)
export function target(ctx, look) {
  const st = ctx.state;
  const d = look(X(-T.w / 2 - 0.1), Z(T.door), 1.5);
  if (d < 0) return null;
  const open = st.doorTarget > 0.05;
  return { d, items: [open ? { key: 'E', text: '閉める' } : { key: 'E', text: '開ける' }], use: () => useDoor(ctx) };
}
function useDoor(ctx) {
  const st = ctx.state;
  if (st.doorLocked) {
    if (ctx.hud) ctx.hud.flash('開かない');
    if (ctx.story && ctx.story._sfx) ctx.story._sfx('rattle');
    st.log.push({ t: st.t, ev: 'door_locked' });
    return 'locked';
  }
  st.doorTarget = st.doorTarget > 0.05 ? 0 : 1.2;
  st.log.push({ t: st.t, ev: st.doorTarget > 0 ? 'door_open' : 'door_close_e' });
  return 'door';
}

// ================================================================ 仮音(P4 で録音に差し替え。名前は docs/p5b2b/NOTES.md §5)
//  xb1_water_loop_01: 水の流れる低い音 / xb1_drip_01: 滴り / xb1_door_clank_01: 踊り場の扉が閉まる / xb1_loop_notice_01: 3 回目に気づく / xb1_release_01: 抜ける /
//  xb1_door_creak_01: 戻りで扉が開く / xb1_key_drone_01: キーを取った時 / 上の足音・遠い悲鳴(管理人は来ない。enemy_audio の step・scream をこもらせて)
function sound(ctx, dt, inTun) {
  const st = ctx.state, c = actx(ctx); if (!c) return;
  if (!st.amb) {
    const out = ctx.audio.listener.getInput();
    const src = c.createBufferSource(); src.buffer = noiseBuf(c, 4); src.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.value = 380;
    const g = c.createGain(); g.gain.value = 0.0; src.connect(bp); bp.connect(g); g.connect(out); src.start();
    st.amb = { src, g, drip: 1 };
  }
  st.amb.g.gain.value += ((inTun ? 0.05 : 0.025) - st.amb.g.gain.value) * Math.min(1, dt * 2);
  st.amb.drip -= dt;
  if (st.amb.drip <= 0) { st.amb.drip = 0.6 + Math.random() * 2.2; const f = 1300 + Math.random() * 1400; tone(ctx, f, f * 0.55, 0.12, 0.03 + Math.random() * 0.03, 'sine'); }
  // 上の階の足音(管理人は地下には来ない。音だけ)
  st.stepsT -= dt;
  if (st.stepsT <= 0 && !st.steps) { st.steps = { n: 6 + ((Math.random() * 4) | 0), t: 0 }; const E = st.keyTaken ? XB1.sounds.stepsEveryRet : XB1.sounds.stepsEvery; st.stepsT = E[0] + Math.random() * (E[1] - E[0]); }
  if (st.steps) {
    st.steps.t -= dt;
    if (st.steps.t <= 0 && ctx.audio && ctx.audio.play) {
      const p = ctx.player.pos; ctx.audio.play('step', new THREE.Vector3(p.x + 2, SPACE_Y + 4.5, p.z + 3), 0.9, { cutoff: 320, ref: 3 });
      st.steps.t = 0.58; if (--st.steps.n <= 0) st.steps = null;
    }
  }
  if (st.keyTaken && !st.screamed && st.retLoops >= 1 && ctx.audio && ctx.audio.play) { st.screamed = true; const p = ctx.player.pos; ctx.audio.play('scream', new THREE.Vector3(p.x, SPACE_Y + 6, p.z + 10), 0.35, { cutoff: 450, ref: 2 }); }
}
function stopSound(ctx) { const st = ctx.state; if (!st.amb) return; try { st.amb.src.stop(); } catch (e) { void e; } st.amb = null; }
function sfx(ctx, name) {
  const st = ctx.state; st.sfx = st.sfx || []; st.sfx.push(name);
  if (name === 'clank') { burst(ctx, 0.5, 220, 1.0, 0.4); burst(ctx, 0.2, 1800, 3.0, 0.12, 0.02); }                // xb1_door_clank_01
  else if (name === 'notice') { tone(ctx, 55, 52, 2.4, 0.09, 'sawtooth'); tone(ctx, 82, 80, 2.0, 0.04, 'sine', 0.3); }   // xb1_loop_notice_01
  else if (name === 'release') { burst(ctx, 0.8, 300, 0.7, 0.2); tone(ctx, 140, 70, 1.4, 0.05, 'triangle', 0.1); }    // xb1_release_01
  else if (name === 'creak') { tone(ctx, 260, 200, 1.6, 0.03, 'sawtooth'); tone(ctx, 400, 330, 1.2, 0.012, 'square', 0.2); }   // xb1_door_creak_01
  else if (name === 'key_drone') { tone(ctx, 46, 44, 3.0, 0.1, 'sawtooth'); }                                         // xb1_key_drone_01
}

// テスト・スクショ用
export function debug(ctx) {
  const st = ctx.state;
  return {
    XB1, st,
    state: () => ({ released: st.released, passes: st.passes, armed: st.armed, teleports: st.teleports, keyTaken: st.keyTaken, retLoops: st.retLoops, retOpen: st.retOpen, door: +st.door.toFixed(2),
      doorLocked: st.doorLocked, offZ: st.offZ < 1e3 ? +(st.offZ - OZ).toFixed(2) : null, flips: st.flips, walkIn: +st.walkIn.toFixed(1), walkRet: +st.walkRet.toFixed(1), log: st.log.slice(-30) }),
    edges: () => st.edges.map((e) => ({ i: e.i, on: e.on, vert: e.vert, u: e.u, v: e.v })),
    connected: () => { const adj = adjacency(st); const d = bfs(adj, cid(...MZ.entry)); return d[cid(...MZ.goal)] >= 0; },
    route: (u, v, toGoal = true) => {   // 升の中心の列(BFS)
      const adj = adjacency(st);
      const pc = cid(THREE.MathUtils.clamp(Math.floor((u - MZ.u0) / MZ.cell), 0, MZ.nc - 1), THREE.MathUtils.clamp(Math.floor((v - MZ.v0) / MZ.cell), 0, MZ.nr - 1));
      const tg = toGoal ? cid(...MZ.goal) : cid(...MZ.entry);
      const d = bfs(adj, tg); if (d[pc] < 0) return null;
      const out = []; let c = pc;
      while (c !== tg) { c = adj[c].find((n) => d[n] === d[c] - 1); out.push([MZ.u0 + ((c % MZ.nc) + 0.5) * MZ.cell, MZ.v0 + (((c / MZ.nc) | 0) + 0.5) * MZ.cell]); }
      return out;
    },
    lampsBehind: () => { const pz = ctx.player.pos.z; const offs = []; for (let z = OZ + T.w0 + T.lamp0 - T.L; z < OZ + MZ.v0 + 30; z += T.lampDu) offs.push({ z: +(z - OZ).toFixed(1), off: st.keyTaken && z > st.offZ, ahead: z < pz }); return offs; },
    release: (why = 'debug') => release(ctx, why),
    local: (x, z) => ({ u: x - OX, v: z - OZ }), world: (u, v) => ({ x: X(u), z: Z(v) }),
  };
}
