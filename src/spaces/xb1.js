// spaces/xb1.js — 別空間 XB1「地下 B1」(DESIGN §3.8 I 4 行目・H 第10段)。P5b-2b。
//  鉄扉の先は湿ったコンクリートの踊り場 → 横の扉から白いタイルのトンネル(参考 14: 丸タイルの床・市松の腰壁・奥に標識灯。水音・滴り)
//  → 途中で白い仕切り壁の迷路(参考 07: 低い天井・白い壁)→ 奥の小部屋 = 管理人の作業場(道具・洗い場。死体は見せず匂わせのみ)。奥の壁のフックに車のキー(slot hook/key)。
//  異世界の要素: ①ループ(トンネルは 24m ごとに同じ区画 = 同じ標識灯。前へ歩くと継ぎ目なしに 24m 戻す。標識灯を 3 回通ると気づく(標識灯が激しく瞬く)。
//    その後、一度立ち止まるか振り返ると抜ける = 次は先(迷路)へ進める。閉じ込めないよう 6 回通ったら自然に抜ける)
//   ②歪み(迷路の仕切りは視線を外した間に配置が変わる。見えている壁・近くの壁は動かさない。入口・プレイヤー・作業場がいつも繋がっている時だけ変える)
//   ③伸びる(キーを取って戻ると、灯りが背後から消えていき、踊り場の扉は 2 周余計に歩くまで開かない = 戻る道は行きより長い)
//  P6b(§3.9 #13「地下が何をすればいいか分からない」→ 簡潔化。上の①〜③を置き換える):
//   ①ループは標識灯を 2 回通ると瞬く(気づく)→ 3 回目で自然に抜ける(立ち止まる/振り返る条件は廃止)
//   ②迷路は固定の一本道(曲がり 3 回。配置は変わらない。最後の曲がりの先、行き止まりの脇が作業場の灯りの点いた入口)
//   ③戻りは灯りが背後から消えるだけ。踊り場への扉はキーを取るとすぐ少し開く(2 周余計は廃止)
//  管理人は地下には来ない(enemy_ai の経路も無い)。上の階の足音・遠い悲鳴(音だけ)。
//  P6b-D(§3.10 #6 C「潜んでやり過ごす」。上の「管理人は地下には来ない」は失効): 作業場を 6×8m に広げ、棚・吊るした布・作業台(道具板付き)で
//   裸電球の光が届かない陰を 3 か所(A 棚の裏・B 布の裏・C 作業台の裏)。車のキーを取ると 3 秒で鉄扉の音 → 8 秒で管理人(演出体 = 本体のメッシュを
//   SCRIPTED で地下へ連れて来る)が足音と光でトンネル側から近づく → 作業場に入る(画面下「ライトを消して動くな」)→ 固定の経路を約 20 秒、光で掃く
//   (立ち止まり 2 回。2 回目はフックの 2m 以内で息遣い = 非声の素材が無いので無音・記録だけ)→ 迷路へ戻り 10 秒で去る → 鉄扉の音 → 「鉄扉へ戻れ」。
//   見つかる: 懐中電灯が点いている/0.1m 以上動く/光の円錐(半角 25°・8m・棚や壁で切れる)の中で 4m 以内(作業場の外 = 近づく・去る間は円錐だけ)。
//   見つかると「みぃつけた」→ 追跡(逃げ切れない速さ・鉄扉からは出られない)→ 死亡 → 鉄扉の内側から・キーはフックへ戻る(第10段)。
//  光はすべてシェーダの中の計算(トンネルの周期の灯り・標識灯・迷路の格子の灯り・裸電球。three.js のライトは足さない)＋懐中電灯。
//  座標: 局所 u = x − 520、v = z。トンネルは u −1〜1 を +v へ。周期の窓 v [−6, 18)(踊り場への扉は v 6 の西の壁、標識灯は v 14)。

import * as THREE from 'three';
import { SPACE_Y } from '../world.js';
import { GB, GLSL_NOISE, actx } from './gb.js';
import { HUD_TEXT } from '../hud_text.js';

const OX = 520, OZ = 0;
// 調整値(docs/p5b2b/NOTES.md §4)
export const XB1 = {
  tun: { w: 2.0, h: 2.6, L: 24, w0: -6, door: 6, sign: 14, lamp0: 3, lampDu: 6, from: -30, to: 50 },   // トンネル(周期 L・窓 [w0, w0+L))
  landing: { u0: -5.0, u1: -1.2, v0: 0, v1: 8, h: 2.6, door: -3.1, bulb: [-3.1, 2.3, 4.2] },
  loop: { notice: 2, safety: 3, hyst: 6.0 },   // P6b #13: 2 回目に気づく(標識灯が瞬く)・3 回目で抜ける
  // P6b #13: 迷路は固定の一本道(path = 升 [列, 行] の並び。北 → 東 → 北 → 東 の 3 曲がり、行き止まり (7,11) の北の壁が作業場の入口)
  maze: { u0: -9, v0: 52, nc: 9, nr: 12, cell: 2.0, h: 2.45, wall: 2.05, entry: [4, 0], goal: [7, 11],
    path: [[4, 0], [4, 1], [4, 2], [4, 3], [4, 4], [4, 5], [5, 5], [5, 6], [5, 7], [5, 8], [5, 9], [5, 10], [5, 11], [6, 11], [7, 11]] },
  shop: { u0: 2.5, u1: 8.5, v0: 76.2, v1: 84.2, h: 2.4, door: 6, bulb: [5.4, 2.15, 80.3] },   // P6b-D: 6 × 8m(旧 5 × 5.8m)
  ret: { loops: 0, offBehind: 6.0, offRate: 2.6 },   // P6b #13: 戻りで余計に回る周回 0(踊り場への扉はキーを取るとすぐ開く)
  fog: [0x050607, 0.045],
  sounds: { stepsEvery: [9, 18], stepsEveryRet: [5, 10] },
  // P6b-D: 潜んでやり過ごす(docs/p6b-d/NOTES.md)。座標は局所 u・v。時刻はキーを取ってからの秒
  hunt: {
    doorDelay: 3.0, approach: 8.0, leave: 10.0, walk: 1.0,
    pathIn: [[2, 69.0], [2, 75.0], [6, 75.0], [6, 76.6]],              // 迷路の一本道 → 作業場の入口(約 8 秒)
    route: [['walk', 5.6, 79.2], ['stop', 4.0, 0, 1.25, 'stop1'], ['walk', 5.5, 82.5], ['stop', 4.5, 0, 0.7, 'hook'], ['walk', 5.6, 79.2], ['walk', 6.0, 76.6]],
    pathOut: [[6, 75.0], [2, 75.0], [2, 67.0]],                         // 迷路へ戻って去る(約 10 秒)
    cone: { half: 25 * Math.PI / 180, range: 8.0, near: 4.0 }, eye: 1.3, pitch: -0.28,
    move: 0.1, chase: 4.2, sayAfter: 0.8, whisper: 2.5, doorVol: 0.55, doorCut: 700, avoid: 30.0,   // avoid: 去った後に 1F を避ける秒(P6b-C の猶予と同じ)
    // 光と見通しを遮る物(u0, v0, u1, v1, y0, y1)
    occ: [{ id: 'shelf', b: [3.4, 77.3, 3.85, 80.7, 0, 2.05] }, { id: 'cloth', b: [7.26, 79.8, 7.34, 81.9, 0.2, 2.3] }, { id: 'bench', b: [7.1, 76.5, 7.75, 78.9, 0, 2.0] }],
    furn: [[2.5, 82.6, 3.25, 84.0], [4.2, 76.25, 5.3, 76.95], [7.7, 82.8, 8.5, 84.1]],   // 洗い場・冷凍庫・袋の山(低い = 光は遮らない。追跡の経路だけ回り込む)
    spots: [{ id: 'A', u: 2.95, v: 79.0, by: 'shelf' }, { id: 'B', u: 8.0, v: 80.9, by: 'cloth' }, { id: 'C', u: 8.1, v: 77.6, by: 'bench' }],
    hook: [5.6, 84.16],
  },
};
const T = XB1.tun, LD = XB1.landing, MZ = XB1.maze, SH = XB1.shop, HU = XB1.hunt;

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
        // P6b-D: 作業場の裸電球の光を遮る物(棚・布・作業台)。電球 → P の線分が箱を通れば影
        float boxHit(vec3 o, vec3 d, vec3 bmin, vec3 bmax) {
          vec3 P = o + d;
          if (all(greaterThan(P, bmin - 0.07)) && all(lessThan(P, bmax + 0.07))) return 0.0;   // その物の面・載っている物は自分の影にしない
          vec3 inv = 1.0 / d; vec3 t0 = (bmin - o) * inv, t1 = (bmax - o) * inv;
          vec3 tn = min(t0, t1), tf = max(t0, t1);
          float a = max(max(tn.x, tn.y), tn.z), b = min(min(tf.x, tf.y), tf.z);
          return (b > max(a, 0.0) && a < 0.985 && b > 0.0) ? 1.0 : 0.0;
        }
        float shopVis(vec3 L, vec3 P) {
          vec3 d = P - L; float hit = 0.0;
          ${HU.occ.map((o) => { const [u0, v0, u1, v1, y0, y1] = o.b; return `hit = max(hit, boxHit(L, d, vec3(${X(u0).toFixed(3)}, ${Y(y0).toFixed(3)}, ${Z(v0).toFixed(3)}), vec3(${X(u1).toFixed(3)}, ${Y(y1).toFixed(3)}, ${Z(v1).toFixed(3)})));`; }).join('\n          ')}
          return 1.0 - hit;
        }
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
            float on = lampOn(L.z) * mix(0.06, 1.0, shopVis(L, P + n * 0.02));   // P6b-D: 棚・布・作業台の陰(わずかな回り込みだけ残す)
            irr += vec3(1.0, 0.82, 0.5) * on * (max(dot(n, l), 0.0) * 0.8 + 0.2) * 0.75 / (r2 + 0.5);
            if (gloss) { vec3 hv = normalize(l + V); sp += vec3(1.0, 0.85, 0.6) * on * pow(max(dot(n, hv), 0.0), 50.0) / (r2 * 0.3 + 1.0); }
          }
          reflectedLight.indirectDiffuse += diffuseColor.rgb * irr;
          reflectedLight.indirectSpecular += sp * (1.0 - xR) * 0.5;
        }`);
  };
  m.customProgramCacheKey = () => 'n2_xb1_v2';
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
  // 作業場(古いタイルの壁・コンクリートの床・排水口と染み・洗い場・道具・袋・冷凍庫)。P6b-D: 6 × 8m に広げ、棚・布・作業台は別のメッシュ(buildShopProps。影を落とす)
  const S0 = SH;
  b.surf = SURF.cFloor; b.floor(X(S0.u0), X(S0.u1), Z(S0.v0 - 0.2), Z(S0.v1), Y(0));
  b.surf = SURF.cCeil; b.floor(X(S0.u0), X(S0.u1), Z(S0.v0 - 0.2), Z(S0.v1), Y(S0.h), false);
  b.surf = SURF.shopWall;
  b.wallX(X(S0.u0), Z(S0.v0 - 0.2), Z(S0.v1), Y(0), Y(S0.h), 1); b.wallX(X(S0.u1), Z(S0.v0 - 0.2), Z(S0.v1), Y(0), Y(S0.h), -1);
  b.wallZ(Z(S0.v1), X(S0.u0), X(S0.u1), Y(0), Y(S0.h), -1);
  b.wallZ(Z(S0.v0 - 0.2), X(S0.u0), X(sd - 0.5), Y(0), Y(S0.h), 1); b.wallZ(Z(S0.v0 - 0.2), X(sd + 0.5), X(S0.u1), Y(0), Y(S0.h), 1); b.wallZ(Z(S0.v0 - 0.2), X(sd - 0.5), X(sd + 0.5), Y(2.05), Y(S0.h), 1);
  b.surf = SURF.dark; b.box(X(sd - 0.5), Y(0), Z(v1), X(sd + 0.5), Y(0.02), Z(S0.v0 - 0.2), 'py');
  for (const a of [sd - 0.56, sd + 0.5]) b.box(X(a), Y(0), Z(v1) - 0.02, X(a + 0.06), Y(2.1), Z(S0.v0 - 0.18), 'px nx pz nz');
  // 排水口(染みはシェーダの床の中)
  b.surf = SURF.dark; b.floor(X(6.28), X(6.52), Z(79.48), Z(79.72), Y(0.005));
  // 洗い場(北西の隅: 深いシンクと蛇口)
  b.surf = SURF.prop; b.col = [0.55, 0.56, 0.55];
  b.box(X(S0.u0), Y(0.0), Z(82.6), X(S0.u0 + 0.75), Y(0.62), Z(84.0), 'px py pz nz');
  b.col = [0.22, 0.23, 0.22]; b.box(X(S0.u0 + 0.08), Y(0.4), Z(82.7), X(S0.u0 + 0.67), Y(0.621), Z(83.9), 'py');
  b.surf = SURF.dark; b.box(X(S0.u0 + 0.02), Y(0.62), Z(83.3), X(S0.u0 + 0.08), Y(1.05), Z(83.38)); b.box(X(S0.u0 + 0.02), Y(1.0), Z(83.3), X(S0.u0 + 0.3), Y(1.04), Z(83.38));
  b.surf = SURF.prop; b.col = [0.18, 0.32, 0.2];
  for (let k = 0; k < 3; k++) b.addGeo(new THREE.TorusGeometry(0.28 - k * 0.03, 0.018, 6, 24).rotateX(Math.PI / 2), new THREE.Matrix4().makeTranslation(X(4.4), Y(0.02 + k * 0.035), Z(82.6)));
  // 道具の板(東の壁・布の裏): 吊るした道具の影のような形(長柄・のこぎり・ロープ)
  b.surf = SURF.wood; b.box(X(S0.u1 - 0.03), Y(0.9), Z(80.0), X(S0.u1), Y(2.0), Z(81.7), 'nx');
  b.surf = SURF.dark;
  b.rbox(X(S0.u1 - 0.06), Y(1.42), Z(80.3), 0.03, 0.9, 0.04); b.rbox(X(S0.u1 - 0.06), Y(1.55), Z(80.8), 0.02, 0.35, 0.28);
  b.rbox(X(S0.u1 - 0.06), Y(1.5), Z(81.35), 0.02, 0.5, 0.06, 0, 0.0, 0.0);
  b.surf = SURF.prop; b.col = [0.5, 0.42, 0.28]; b.addGeo(new THREE.TorusGeometry(0.17, 0.03, 6, 20).rotateY(Math.PI / 2), new THREE.Matrix4().makeTranslation(X(S0.u1 - 0.07), Y(1.25), Z(81.5)));
  // ゴムの前掛けと手袋(北の壁)・バケツとモップ・漂白剤の容器(白い・ラベルなし)・黒い袋の山(北東)・冷凍庫(南の壁・鎖)
  b.col = [0.2, 0.17, 0.1]; b.rbox(X(7.2), Y(1.25), Z(S0.v1 - 0.05), 0.55, 0.85, 0.03);
  b.col = [0.32, 0.28, 0.12]; b.rbox(X(6.75), Y(1.55), Z(S0.v1 - 0.05), 0.12, 0.25, 0.03, 0, 0, 0.2);
  b.col = [0.3, 0.32, 0.36]; b.addGeo(new THREE.CylinderGeometry(0.15, 0.13, 0.32, 12), new THREE.Matrix4().makeTranslation(X(4.1), Y(0.16), Z(82.0)));
  b.col = [0.4, 0.35, 0.28]; b.rbox(X(4.25), Y(0.75), Z(81.95), 0.025, 1.5, 0.025, 0, 0.0, 0.18);
  b.col = [0.84, 0.84, 0.8]; for (let k = 0; k < 4; k++) b.rbox(X(3.95 + k * 0.17), Y(0.16), Z(83.85), 0.14, 0.3, 0.1, k * 0.2);
  b.col = [0.035, 0.035, 0.04];
  for (const [u, v, s] of [[8.0, 83.3, 0.55], [8.1, 83.8, 0.5], [7.85, 83.65, 0.45], [8.05, 83.0, 0.4]]) b.rbox(X(u), Y(s * 0.4), Z(v), s * 0.9, s * 0.8, s, u * 3.1, 0.1, -0.1);
  b.col = [0.82, 0.82, 0.8]; b.box(X(4.2), Y(0), Z(76.25), X(5.3), Y(0.85), Z(76.95));
  b.surf = SURF.dark; for (let k = 0; k < 9; k++) b.rbox(X(4.7 + (k % 2) * 0.03), Y(0.8 - k * 0.075), Z(76.96), 0.05, 0.035, 0.02, 0, 0, 0.6);
  // フックの板(車のキー)・裸電球
  const [hu, hy, hv] = DEF.slots.hook;
  b.surf = SURF.wood; b.box(X(hu - 0.3), Y(hy - 0.12), Z(hv) - 0.02, X(hu + 0.3), Y(hy + 0.08), Z(hv) + 0.02);
  b.surf = SURF.dark; for (const o of [-0.18, 0, 0.18]) b.box(X(hu + o) - 0.004, Y(hy - 0.025), Z(hv) - 0.06, X(hu + o) + 0.004, Y(hy - 0.015), Z(hv) - 0.02);
  b.surf = SURF.bulb; b.addGeo(new THREE.SphereGeometry(0.045, 10, 8), new THREE.Matrix4().makeTranslation(X(SH.bulb[0]), Y(SH.bulb[1]), Z(SH.bulb[2])));
  b.surf = SURF.dark; b.box(X(SH.bulb[0]) - 0.006, Y(SH.bulb[1] + 0.04), Z(SH.bulb[2]) - 0.006, X(SH.bulb[0]) + 0.006, Y(SH.h), Z(SH.bulb[2]) + 0.006, 'px nx pz nz');
}

// P6b-D: 作業場の陰を作る物(棚・作業台と道具板・布を吊るす棒)。影を落とすので別のメッシュ(管理人の懐中電灯の光も切れる)
function buildShopProps(b) {
  const O = Object.fromEntries(HU.occ.map((o) => [o.id, o.b]));
  // 棚(スチールの棚。裏板と箱で詰まっている = 向こうが見えない)
  { const [u0, v0, u1, v1, , y1] = O.shelf;
    b.surf = SURF.iron;
    for (const u of [u0, u1 - 0.04]) for (const v of [v0, (v0 + v1) / 2, v1 - 0.04]) b.box(X(u), Y(0), Z(v), X(u + 0.04), Y(y1), Z(v + 0.04));
    for (const y of [0.08, 0.62, 1.16, 1.7, y1 - 0.03]) b.box(X(u0), Y(y), Z(v0), X(u1), Y(y + 0.03), Z(v1));
    b.surf = SURF.wood; b.box(X(u0), Y(0.05), Z(v0), X(u0 + 0.025), Y(y1), Z(v1), 'px nx');   // 裏板
    b.surf = SURF.prop; let k = 0;
    for (const y of [0.11, 0.65, 1.19, 1.73]) for (let v = v0 + 0.08; v < v1 - 0.3; v += 0.42) {
      const w = 0.28 + ((k * 37) % 9) / 60, h = 0.3 + ((k * 53) % 7) / 40; b.col = [[0.33, 0.27, 0.18], [0.24, 0.24, 0.26], [0.4, 0.33, 0.22], [0.18, 0.2, 0.19]][k % 4];
      b.box(X(u0 + 0.04), Y(y + 0.03), Z(v), X(u1 - 0.03), Y(y + 0.03 + Math.min(h, 0.5)), Z(v + w)); k++;
    } }
  // 作業台(天板 0.9m)と、西の縁に立てた道具板(〜2.0m)・下の幕板 = 西から見ると壁
  { const [u0, v0, u1, v1, , y1] = O.bench;
    b.surf = SURF.wood; b.box(X(u0), Y(0.86), Z(v0), X(u1), Y(0.92), Z(v1));
    b.surf = SURF.iron; for (const u of [u0 + 0.03, u1 - 0.07]) for (const v of [v0 + 0.03, v1 - 0.07]) b.box(X(u), Y(0), Z(v), X(u + 0.04), Y(0.86), Z(v + 0.04));
    b.surf = SURF.wood; b.box(X(u0), Y(0.04), Z(v0), X(u0 + 0.03), Y(0.86), Z(v1));               // 幕板
    b.box(X(u0), Y(0.92), Z(v0), X(u0 + 0.04), Y(y1), Z(v1));                                       // 道具板
    b.surf = SURF.dark;
    for (let v = v0 + 0.25; v < v1 - 0.2; v += 0.38) b.rbox(X(u0 - 0.03), Y(1.35 + ((v * 7) % 0.3)), Z(v), 0.03, 0.45 + ((v * 13) % 0.3), 0.05, 0, 0, 0.15);   // 掛けた道具の影
    b.surf = SURF.prop; b.col = [0.3, 0.31, 0.33]; b.rbox(X(u0 + 0.3), Y(1.0), Z(v0 + 0.6), 0.35, 0.16, 0.25);   // 台の上の工具箱
    b.col = [0.5, 0.48, 0.44]; b.rbox(X(u0 + 0.35), Y(0.97), Z(v1 - 0.5), 0.25, 0.1, 0.4, 0.3); }
  // 布を吊るす棒(布は別のメッシュ = 揺れる)
  { const [u0, v0, , v1, , y1] = HU.occ.find((o) => o.id === 'cloth').b;
    b.surf = SURF.iron; b.addGeo(new THREE.CylinderGeometry(0.012, 0.012, v1 - v0 + 0.3, 8).rotateX(Math.PI / 2), new THREE.Matrix4().makeTranslation(X(u0 + 0.04), Y(y1 + 0.03), Z((v0 + v1) / 2)));
    for (const v of [v0 - 0.1, v1 + 0.1]) b.box(X(u0 + 0.035), Y(y1 + 0.03), Z(v) - 0.006, X(u0 + 0.047), Y(SH.h), Z(v) + 0.006, 'px nx pz nz'); }
}
// 吊るした布(汚れた帆布)。原点 = 上の縁(棒)。両面
function buildCloth() {
  const b = new GB(); const [u0, v0, u1, v1, y0, y1] = HU.occ.find((o) => o.id === 'cloth').b; const uc = (u0 + u1) / 2;
  b.surf = SURF.prop; b.col = [0.36, 0.33, 0.27];
  for (const nx of [1, -1]) b.quad([nx * 0.004, -(y1 - y0), 0], [0, 0, v1 - v0], [0, y1 - y0, 0], [nx, 0, 0], 6, 4);
  b.col = [0.2, 0.17, 0.13]; b.quad([0.006, -(y1 - y0) + 0.05, (v1 - v0) * 0.55], [0, 0, 0.5], [0, 0.6, 0], [1, 0, 0]);   // 染み
  const g = b.geometry(); return { g, x: X(uc), y: Y(y1), z: Z(v0) };
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
// P6b #13: 固定の一本道。道の升どうしの辺は開け、道の升を囲む辺だけ壁にする(道から見えない奥の升の壁は立てない)
function initMaze(st) {
  const onPath = new Set(MZ.path.map(([c, r]) => cid(c, r)));
  const link = new Set();
  for (let i = 0; i + 1 < MZ.path.length; i++) { const a = cid(...MZ.path[i]), b = cid(...MZ.path[i + 1]); link.add(Math.min(a, b) + ':' + Math.max(a, b)); }
  for (const e of st.edges) {
    const a = cid(...e.a), b = cid(...e.b);
    e.on = (onPath.has(a) || onPath.has(b)) && !link.has(Math.min(a, b) + ':' + Math.max(a, b));
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
  // P6b-D: 作業場の棚・作業台・布(管理人の懐中電灯の影を落とす)
  { const b = new GB(); buildShopProps(b); st.shopProps = mesh(b.geometry(), 'XB1_shopProps'); st.shopProps.castShadow = true; }
  { const c = buildCloth(); const m = st.cloth = new THREE.Mesh(c.g, mat); m.name = 'XB1_cloth'; m.position.set(c.x, c.y, c.z); m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; g.add(m); }
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
  // P6b-D: 洗い場(北西)・冷凍庫(南の壁)・袋の山(北東)・棚・作業台・布
  for (const [f, h] of HU.furn.map((b, i) => [b, [1.0, 0.85, 0.6][i]])) col(ctx, f[0], f[1], f[2], f[3], 'furn', h);
  for (const o of HU.occ) { const [u0, v0, u1, v1, , y1] = o.b; col(ctx, u0, v0, u1, v1, 'furn', y1 + 0.1); }
  for (const e of st.edges) {
    const t = 0.06, L = MZ.cell / 2;
    e.col = e.vert ? col(ctx, e.u - t, e.v - L, e.u + t, e.v + L, 'wall', MZ.wall) : col(ctx, e.u - L, e.v - t, e.u + L, e.v + t, 'wall', MZ.wall);
  }
  // 敵の照明(踊り場の電球・P6b-D: 作業場の裸電球 = 見回りに来た管理人を照らす)
  ctx.lamps.push([X(LD.bulb[0]), Y(LD.bulb[1]), Z(LD.bulb[2])], [X(SH.bulb[0]), Y(SH.bulb[1]), Z(SH.bulb[2])]);
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
  Object.assign(st, { t: 0, released: false, passes: 0, lastPassV: null, armed: false, travel: 1, prevV: null, teleports: 0, walked: 0,
    keyTaken: false, keyBefore: false, retLoops: 0, retOpen: false, offZ: 1e4, door: 0.9, doorTarget: 0.9, doorLocked: false, flips: 0, log: [], noticed: false,
    stepsT: 9 + Math.random() * 6, steps: null, screamed: false, walkIn: 0, walkRet: 0, lastPos: null, edgeLog: [], hunt: null });
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
export function leave(ctx) {
  stopSound(ctx);
  const h = ctx.state.hunt;   // P6b-D: 見回りの途中で出た(管理人の後始末は story._afterSpaceExit が本体を別の階へ戻す)
  if (h && !['done', 'aborted'].includes(h.phase)) { h.phase = 'aborted'; ctx.state.log.push({ t: ctx.state.t, ev: 'hunt_aborted' }); if (ctx.ai) { ctx.ai.chaseFast = 0; ctx.ai.chaseOmni = false; } }
}
export function dispose(ctx) {
  for (const o of [...ctx.group.children]) { ctx.group.remove(o); o.traverse((m) => { if (m.geometry) m.geometry.dispose(); }); }
  if (ctx.state.mat) ctx.state.mat.dispose();
  ctx.cols.length = 0; ctx.lamps.length = 0;
}

// ================================================================ 毎フレーム
function shift(ctx, dz) {
  const st = ctx.state, pl = ctx.player;
  pl.pos.z += dz; pl.object.position.z += dz;
  if (st.offZ < 1e3) st.offZ += dz;
  if (st.lastPassV !== null) st.lastPassV += dz;
  st.prevV += dz;
  st.teleports++;
}
export function update(dt, ctx) {
  const st = ctx.state, U = st.U, pl = ctx.player;
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
        if (st.passes >= XB1.loop.safety && !st.released) release(ctx, 'third');   // P6b #13: 3 回目で自然に抜ける
      }
    }
  }
  const dv = v - st.prevV;
  if (Math.abs(dv) > 1e-4) st.travel = Math.sign(dv);
  U.uSignFl.value += ((st.noticed && !st.released ? 1 : 0) - U.uSignFl.value) * Math.min(1, dt * 3);
  st.prevV = v;
  st.lastPos = { x: pl.pos.x, z: pl.pos.z };
  // 踊り場の扉: 入ってトンネルで 3m 離れたら閉まる(重い音)。E でまた開く。戻り(キーの後)は 2 周するまで開かない
  const dDoor = Math.hypot(u - (-T.w / 2), v - T.door);
  if (st.doorTarget > 0 && dDoor > 3.0 && inTun && !st.keyTaken) { st.doorTarget = 0; st.log.push({ t: st.t, ev: 'door_close' }); sfx(ctx, 'clank'); }
  if (st.keyTaken && !st.retOpen && st.retLoops >= XB1.ret.loops) { st.retOpen = true; st.doorLocked = false; st.doorTarget = 0.55; st.log.push({ t: st.t, ev: 'door_ajar' }); sfx(ctx, 'creak'); }
  if (Math.abs(st.door - st.doorTarget) > 1e-3) setDoor(ctx, st.door + THREE.MathUtils.clamp(st.doorTarget - st.door, -dt * 0.9, dt * 0.9));
  // ② 迷路: P6b #13 で配置の変化は廃止(固定の一本道)
  // 鍵(物語の pickups): 取ったら戻りの演出(灯りが背後から消える・扉は 2 周まで開かない)
  const s = ctx.story;
  if (!st.keyBefore && !st.keyTaken && s && s.taken && s.taken.has('kCar')) {
    st.keyTaken = true; st.doorLocked = true; st.doorTarget = 0; st.offZ = pl.pos.z + XB1.ret.offBehind + 2.0;
    st.log.push({ t: st.t, ev: 'key', u, v }); sfx(ctx, 'key_drone');
    if (s.active && s.aiControl) { st.hunt = { t: 0, phase: 'wait', log: [] }; st.log.push({ t: st.t, ev: 'hunt_start' }); }   // P6b-D
  }
  if (st.cloth) { const w = Math.sin(st.t * 0.9) * 0.035 + Math.sin(st.t * 2.3 + 1.1) * 0.012; st.cloth.rotation.z = w; st.cloth.rotation.x = Math.sin(st.t * 0.6) * 0.01; }   // P6b-D: 布の揺れ
  huntUpdate(ctx, dt);
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

// ================================================================ 物語とのつなぎ
// 戻る口: 鉄扉(歩いて近づくか E で出る)
export function exits(ctx) {
  const h = ctx.state.hunt;
  if (h && h.phase === 'found') return [];   // P6b-D: 見つかった後は鉄扉から出られない(逃げ切れない)
  return [{ x: X(LD.door), z: Z(LD.v0 + 0.02), n: [0, 1], auto: true, reach: 1.3, depth: 0.6, half: 0.6 }];
}
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


// ================================================================ P6b-D: 潜んでやり過ごす(§3.10 #6 C)
const wrapA = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
// 時刻表(キーを取ってからの秒 → 管理人の位置・体の向き・光の向き)。純粋な関数(テストが全経路を数える)
let _tl = null;
function timeline() {
  if (_tl) return _tl;
  const segs = []; let t = HU.doorDelay;
  const poly = (pts, dur, kind) => { const L = []; let tot = 0; for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); L.push(d); tot += d; } segs.push({ kind, t0: t, t1: t + dur, pts, L, tot }); t += dur; };
  poly(HU.pathIn, HU.approach, 'approach');
  const tSweep = t; let cur = HU.pathIn[HU.pathIn.length - 1];
  for (const r of HU.route) {
    if (r[0] === 'walk') { const to = [r[1], r[2]], d = Math.hypot(to[0] - cur[0], to[1] - cur[1]); segs.push({ kind: 'sweep', t0: t, t1: t + d / HU.walk, pts: [cur, to], L: [d], tot: d }); t += d / HU.walk; cur = to; }
    else { segs.push({ kind: 'sweep', stop: r[4], t0: t, t1: t + r[1], at: cur, base: r[2], amp: r[3] }); t += r[1]; }
  }
  const tLeave = t;
  poly([cur, ...HU.pathOut], HU.leave, 'leave');
  _tl = { segs, tSweep, tLeave, tEnd: t };
  return _tl;
}
export function huntPose(t) {
  const TL = timeline();
  if (t < HU.doorDelay) return { phase: 'wait' };
  if (t >= TL.tEnd) return { phase: 'done' };
  const sg = TL.segs.find((q) => t < q.t1);
  if (sg.stop) {
    const k = (t - sg.t0) / (sg.t1 - sg.t0), aim = sg.base + sg.amp * Math.sin(k * 2 * Math.PI);
    return { phase: 'sweep', u: sg.at[0], v: sg.at[1], yaw: sg.base + (aim - sg.base) * 0.45, aim, moving: false, stop: sg.stop, speed: 0 };
  }
  let d = (t - sg.t0) / (sg.t1 - sg.t0) * sg.tot, i = 0;
  while (i < sg.L.length - 1 && d > sg.L[i]) { d -= sg.L[i]; i++; }
  const a = sg.pts[i], b = sg.pts[i + 1], k = Math.min(1, d / Math.max(sg.L[i], 1e-6));
  const yaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
  return { phase: sg.kind, u: a[0] + (b[0] - a[0]) * k, v: a[1] + (b[1] - a[1]) * k, yaw, aim: yaw, moving: true, speed: sg.tot / (sg.t1 - sg.t0) };
}
// 見通しを遮る物(局所 u・v の矩形): 棚・布・作業台、作業場の南の壁(入口の左右)、迷路の外周の壁、立っている迷路の仕切り
function blockers(st) {
  const R = HU.occ.map((o) => o.b.slice(0, 4));
  R.push([SH.u0 - 0.2, 75.95, SH.door - 0.5, 76.2], [SH.door + 0.5, 75.95, SH.u1 + 0.2, 76.2], [MZ.u0, 75.95, SH.u0, 76.2], [SH.u1, 75.95, MZ.u0 + MZ.nc * MZ.cell, 76.2]);
  R.push([MZ.u0, 51.8, -T.w / 2, 52.0], [T.w / 2, 51.8, MZ.u0 + MZ.nc * MZ.cell, 52.0]);
  if (st && st.edges) for (const e of st.edges) if (e.on) R.push(e.vert ? [e.u - 0.06, e.v - MZ.cell / 2, e.u + 0.06, e.v + MZ.cell / 2] : [e.u - MZ.cell / 2, e.v - 0.06, e.u + MZ.cell / 2, e.v + 0.06]);
  return R;
}
function segHitsRect(au, av, bu, bv, r) {
  let t0 = 0, t1 = 1; const du = bu - au, dv = bv - av;
  for (const [p, q] of [[-du, au - r[0]], [du, r[2] - au], [-dv, av - r[1]], [dv, r[3] - av]]) {
    if (Math.abs(p) < 1e-9) { if (q < 0) return false; continue; }
    const t = q / p; if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t0 < t1 && t1 > 0.001 && t0 < 0.999;
}
// 管理人の光(pose)から局所 (u, v) が見えるか: 円錐の中(水平の角 ≤ 半角・8m 以内)・4m 以内・遮る物なし
export function coneSees(P, u, v, st = null) {
  const du = u - P.u, dv = v - P.v, dist = Math.hypot(du, dv);
  const ang = Math.abs(wrapA(Math.atan2(du, dv) - P.aim));
  const inCone = ang <= HU.cone.half && dist <= HU.cone.range;
  const los = !blockers(st).some((r) => segHitsRect(P.u, P.v, u, v, r));
  return { seen: inCone && dist <= HU.cone.near && los, inCone, dist, ang, los };
}
function huntSay(ctx, name, extra = {}) { const h = ctx.state.hunt; h.log.push({ t: +h.t.toFixed(2), ev: name, ...extra }); ctx.state.log.push({ t: ctx.state.t, ev: 'hunt_' + name, ...extra }); }
function mgrSetup(ctx, P) {
  const ai = ctx.ai, e = ctx.enemy;
  ai.uninterruptible = false;
  ai.setState('SCRIPTED', { force: true, log: true });
  if (ai.level !== ctx.key) ai.setLevel(ctx.key);
  ai.dormant = false; ai.concealed = false; ai.transit = false; ai.chaseOmni = false; ai.chaseFast = 0;
  e.place(X(P.u), Z(P.v), P.yaw); e.setFlashlight(true); e.speed = 0;
  ctx.state.hunt.yaw = P.yaw;
}
function steelDoor(ctx, which) {
  const p = ctx.player.pos;
  if (ctx.audio && ctx.audio.play) ctx.audio.play('crash', new THREE.Vector3(p.x, SPACE_Y + 2.5, p.z - 22), HU.doorVol, { cutoff: HU.doorCut, ref: 8 });   // 上の鉄扉(遠く・こもる)
  huntSay(ctx, 'steel_door', { which });
}
function huntUpdate(ctx, dt) {
  const st = ctx.state, h = st.hunt;
  if (!h || ['done', 'aborted'].includes(h.phase)) return;
  if (!ctx.ai || !ctx.enemy) return;
  h.t += dt;
  const ai = ctx.ai, e = ctx.enemy, pl = ctx.player;
  const pu = pl.pos.x - OX, pv = pl.pos.z - OZ;
  if (h.phase === 'found') {
    if (!h.chasing && h.t - h.foundAt >= HU.sayAfter && ai.state !== 'ATTACK') {
      h.chasing = true;
      ai.chaseOmni = true; ai.chaseFast = HU.chase; ai.lastKnown = { x: pl.pos.x, z: pl.pos.z, lv: ctx.key };
      ai.setState('CHASE', { force: true });
      huntSay(ctx, 'chase');
    }
    return;
  }
  const P = huntPose(h.t);
  if (P.phase === 'wait') return;
  if (P.phase === 'done') {
    // 去った: 演出体を消し、本体は上の階の巡回へ(1F は 30 秒避ける = P6b-C の猶予)
    h.phase = 'done';
    e.aimPoint = null; e.speed = 0; e.setFlashlight(false); ai.concealed = true;
    if (ctx.story && ctx.story.onAIReset) ctx.story.onAIReset(4);
    if (ai.avoidFloor) ai.avoidFloor(1, HU.avoid);
    steelDoor(ctx, 'leave');
    huntSay(ctx, 'done');
    return;
  }
  if (!h.placed) { h.placed = true; steelDoor(ctx, 'enter'); mgrSetup(ctx, P); huntSay(ctx, 'appear', { u: P.u, v: P.v }); }
  h.phase = P.phase;
  // 演出体を時刻表どおりに動かす(体の向きはなめらかに)
  h.yaw += THREE.MathUtils.clamp(wrapA(P.yaw - h.yaw), -3.5 * dt, 3.5 * dt);
  e.place(X(P.u), Z(P.v), h.yaw);
  e.speed = P.speed;
  if (P.moving) { const cs = e.clipSpeed.walk_standard || 1; if (e.current !== 'walk_standard') e.play('walk_standard', { fade: 0.3, timeScale: P.speed / cs }); else e.setTimeScale(P.speed / cs); }
  else if (e.current !== 'look_idle') e.play('look_idle', { fade: 0.35 });
  const cp = Math.cos(HU.pitch), sp = Math.sin(HU.pitch);
  (e.aimPoint ||= new THREE.Vector3()).set(X(P.u) + Math.sin(P.aim) * cp * 3, Y(HU.eye) + sp * 3, Z(P.v) + Math.cos(P.aim) * cp * 3);
  const inShop = P.v > SH.v0;
  if (inShop && !h.inShop) {
    h.inShop = true; h.anchor = { u: pu, v: pv };
    if (ctx.hud && ctx.hud.whisper) ctx.hud.whisper(HUD_TEXT.story.xb1Hide, HU.whisper);
    huntSay(ctx, 'enter_shop');
  }
  if (P.stop === 'hook' && !h.breath) { h.breath = true; huntSay(ctx, 'breath', { silent: true, dHook: +Math.hypot(P.u - HU.hook[0], P.v - HU.hook[1]).toFixed(2) }); }   // 息遣い: 非声の息の素材が無い = 無音
  // 見つかる
  let why = null;
  if (inShop && pl.flashlightOn) why = 'light';
  else if (inShop && h.anchor && Math.hypot(pu - h.anchor.u, pv - h.anchor.v) >= HU.move) why = 'move';
  else { const c = coneSees(P, pu, pv, st); if (c.seen) why = 'cone'; }
  if (why) found(ctx, why, P);
}
function found(ctx, why, P) {
  const st = ctx.state, h = st.hunt, e = ctx.enemy, pl = ctx.player;
  h.phase = 'found'; h.foundAt = h.t; h.why = why;
  const dx = pl.pos.x - e.pos.x, dz = pl.pos.z - e.pos.z;
  e.place(e.pos.x, e.pos.z, Math.atan2(dx, dz)); e.speed = 0;
  e.play('look_idle', { fade: 0.2 });
  (e.aimPoint ||= new THREE.Vector3()).set(pl.pos.x, pl.pos.y + 1.2, pl.pos.z);
  if (ctx.audio && ctx.audio.play) ctx.audio.play('breath', e.headWorld(new THREE.Vector3()), 0.9);   // 「みぃつけた」(mgr_line_found_01)
  huntSay(ctx, 'found', { why, u: +(pl.pos.x - OX).toFixed(2), v: +(pl.pos.z - OZ).toFixed(2), mu: +P.u.toFixed(2), mv: +P.v.toFixed(2) });
}
// この空間で死んだ時(見つかって捕まった): 第10段の開始(鉄扉の内側)へ。車のキーはフックに戻る(taken・item・段を巻き戻す)
export function respawn(ctx) {
  const st = ctx.state, h = st.hunt, s = ctx.story;
  if (!h || h.phase !== 'found') return null;
  if (s) { s.taken.delete('kCar'); s.item = null; s.stage = 10; s.sub = null; s.log('stage', { stage: 10, sub: null, why: 'xb1_found' }); }
  const rel = st.released;
  reset(ctx);
  if (rel) applyRelease(ctx, true);   // ループはもう抜けている(解いた謎を繰り返させない)
  st.log.push({ t: st.t, ev: 'respawn_found' });
  if (ctx.ai) { ctx.ai.chaseOmni = false; ctx.ai.chaseFast = 0; }
  return { level: ctx.key, x: X(DEF.entry[0]), z: Z(DEF.entry[1]), yaw: DEF.entry[2] };
}
// 管理人の経路(見つかった後の追跡): 作業場 ↔ 入口 ↔ 迷路の一本道 ↔ 前室 ↔ トンネル ↔ 踊り場 の折れ線。作業場の中は棚・布・作業台を回り込む
const NAV = [[6, 77.3], [6, 76.0], [6, 75], [2, 75], [2, 63], [0, 63], [0, 53], [0, 50.5], [0, 6], [-1.6, 6], [-3.1, 5]];
const NAV_L = NAV.slice(1).map((p, i) => Math.hypot(p[0] - NAV[i][0], p[1] - NAV[i][1]));
function navAt(u, v) {
  if (v > SH.v0) return { i: -1, s: -1 };   // 作業場の中
  let best = null;
  for (let i = 0; i < NAV_L.length; i++) {
    const [ax, az] = NAV[i], [bx, bz] = NAV[i + 1], L = NAV_L[i];
    const k = THREE.MathUtils.clamp(((u - ax) * (bx - ax) + (v - az) * (bz - az)) / (L * L), 0, 1);
    const d = Math.hypot(u - (ax + (bx - ax) * k), v - (az + (bz - az) * k));
    if (!best || d < best.d) best = { i, k, d, s: NAV_L.slice(0, i).reduce((a, b) => a + b, 0) + k * L };
  }
  return best;
}
// 作業場の中の最短路(障害物の角を 0.55m 外へ出した点だけを通る見通しのグラフ。障害物は 0.32m 太らせて当てる)。返り値 = 途中の点(始点・終点は含まない)
function shopPath(fu, fv, tu, tv) {
  const boxes = [...HU.occ.map((o) => o.b.slice(0, 4)), ...HU.furn];
  const fat = boxes.map((r) => [r[0] - 0.32, r[1] - 0.32, r[2] + 0.32, r[3] + 0.32]);
  const clear = (au, av, bu, bv) => !fat.some((r) => segHitsRect(au, av, bu, bv, r));
  const inside = (u, v) => fat.some((r) => u > r[0] && u < r[2] && v > r[1] && v < r[3]);
  if (clear(fu, fv, tu, tv)) return [];
  const nodes = [[fu, fv], [tu, tv]];
  for (const r of boxes) for (const [cu, cv] of [[r[0] - 0.55, r[1] - 0.55], [r[2] + 0.55, r[1] - 0.55], [r[0] - 0.55, r[3] + 0.55], [r[2] + 0.55, r[3] + 0.55]]) {
    if (cu > SH.u0 + 0.3 && cu < SH.u1 - 0.3 && cv > SH.v0 + 0.3 && cv < SH.v1 - 0.3 && !inside(cu, cv)) nodes.push([cu, cv]);
  }
  const n = nodes.length, dist = new Array(n).fill(Infinity), prev = new Array(n).fill(-1), done = new Array(n).fill(false);
  dist[0] = 0;
  for (let it = 0; it < n; it++) {
    let k = -1; for (let i = 0; i < n; i++) if (!done[i] && (k < 0 || dist[i] < dist[k])) k = i;
    if (k < 0 || dist[k] === Infinity) break;
    done[k] = true; if (k === 1) break;
    for (let j = 0; j < n; j++) {
      if (done[j] || !clear(nodes[k][0], nodes[k][1], nodes[j][0], nodes[j][1])) continue;
      const d = dist[k] + Math.hypot(nodes[j][0] - nodes[k][0], nodes[j][1] - nodes[k][1]);
      if (d < dist[j]) { dist[j] = d; prev[j] = k; }
    }
  }
  if (prev[1] < 0) return [];
  const path = []; for (let k = prev[1]; k > 0; k = prev[k]) path.unshift(nodes[k]);
  return path;
}
export function nav(ctx, fx, fz, tx, tz) {
  const fu = fx - OX, fv = fz - OZ, tu = tx - OX, tv = tz - OZ, pts = [];
  const a = navAt(fu, fv), b = navAt(tu, tv);
  if (a.i === -1 && b.i === -1) {   // 作業場の中: 棚・布・作業台・洗い場・冷凍庫・袋の山を回る(角の点の見通しの最短路)
    for (const q of shopPath(fu, fv, tu, tv)) pts.push({ x: X(q[0]), z: Z(q[1]) });
    pts.push({ x: tx, z: tz }); return pts;
  }
  if (a.i === -1 || b.i === -1) {   // 作業場 ↔ 外: 作業場の中は入口の内側の点まで回り込む
    const inner = NAV[0];
    if (a.i === -1) { for (const q of shopPath(fu, fv, inner[0], inner[1])) pts.push({ x: X(q[0]), z: Z(q[1]) }); pts.push({ x: X(inner[0]), z: Z(inner[1]) }); }
    const sa2 = a.i === -1 ? 0 : a.s, sb2 = b.i === -1 ? 0 : b.s, ia2 = a.i === -1 ? 0 : a.i, ib2 = b.i === -1 ? 0 : b.i;
    if (sa2 < sb2) { for (let k = ia2 + 1; k <= ib2; k++) pts.push({ x: X(NAV[k][0]), z: Z(NAV[k][1]) }); }
    else if (sa2 > sb2) { for (let k = ia2; k > ib2; k--) pts.push({ x: X(NAV[k][0]), z: Z(NAV[k][1]) }); }
    if (b.i === -1) { pts.push({ x: X(inner[0]), z: Z(inner[1]) }); for (const q of shopPath(inner[0], inner[1], tu, tv)) pts.push({ x: X(q[0]), z: Z(q[1]) }); }
    pts.push({ x: tx, z: tz }); return pts;
  }
  const ia = a.i === -1 ? -1 : a.i, ib = b.i === -1 ? -1 : b.i;
  const sa = a.i === -1 ? -1 : a.s, sb = b.i === -1 ? -1 : b.s;
  if (sa < sb) { for (let k = ia + 1; k <= ib; k++) pts.push({ x: X(NAV[k][0]), z: Z(NAV[k][1]) }); }
  else if (sa > sb) { for (let k = ia; k > ib; k--) pts.push({ x: X(NAV[k][0]), z: Z(NAV[k][1]) }); }
  pts.push({ x: tx, z: tz });
  return pts;
}

// ================================================================ 音(P4b)
//  水の流れ・滴り = 採用 amb_b1 B「流れる水」のループ。地下(B1・XB1・1F の地下への階段)の空気は main.js の環境音(updateAmbience)がまとめて鳴らす。
//  踊り場の扉が閉まる音(door_steel)・抜ける音と鍵の低音(space_release)・戻りで扉が開く軋み(door_creak_slow)は「なし」で外した(無音)。
//  3 回目に気づく音 = 採用 xb1_loop_notice C「耳鳴りと金属の一打」(P4d。src/audio_bank.js)。上の足音(enemy_step_walk 3 周目 A・P4c で wav)と遠い悲鳴(x105_scream 採用 C・声)は enemy_audio をこもらせて
function sound(ctx, dt, inTun) {
  void inTun;
  const st = ctx.state, c = actx(ctx); if (!c) return;
  // 上の階の足音(管理人は地下には来ない。音だけ)
  st.stepsT -= dt;
  if (st.hunt && !['done', 'aborted'].includes(st.hunt.phase)) { st.steps = null; st.stepsT = Math.max(st.stepsT, 6); }   // P6b-D: 見回りの間は上の足音を鳴らさない
  if (st.stepsT <= 0 && !st.steps) { st.steps = { n: 6 + ((Math.random() * 4) | 0), t: 0 }; const E = st.keyTaken ? XB1.sounds.stepsEveryRet : XB1.sounds.stepsEvery; st.stepsT = E[0] + Math.random() * (E[1] - E[0]); }
  if (st.steps) {
    st.steps.t -= dt;
    if (st.steps.t <= 0 && ctx.audio && ctx.audio.play) {
      const p = ctx.player.pos; ctx.audio.play('step', new THREE.Vector3(p.x + 2, SPACE_Y + 4.5, p.z + 3), 0.9, { cutoff: 320, ref: 3 });
      st.steps.t = 0.58; if (--st.steps.n <= 0) st.steps = null;
    }
  }
  if (st.keyTaken && !st.screamed && st.retLoops >= 1 && ctx.audio && ctx.audio.play) { st.screamed = true; const p = ctx.player.pos; ctx.audio.play('x105_scream', new THREE.Vector3(p.x, SPACE_Y + 6, p.z + 10), 0.35, { cutoff: 450, ref: 2 }); }
}
function stopSound(ctx) { void ctx; }
function sfx(ctx, name) {
  const st = ctx.state; st.sfx = st.sfx || []; st.sfx.push(name);
  const bank = ctx.audio && ctx.audio.bank;
  if (name === 'notice' && bank) bank.play('xb1_loop_notice');   // 標識灯の 3 回目(耳元。仮音の低いうなりは廃止)
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
    // P6b #13: 一本道の曲がりの数(入口から作業場まで)
    turns: () => { let n = 0; for (let i = 2; i < MZ.path.length; i++) { const a = MZ.path[i - 2], b = MZ.path[i - 1], c = MZ.path[i]; if ((b[0] - a[0]) !== (c[0] - b[0]) || (b[1] - a[1]) !== (c[1] - b[1])) n++; } return n; },
    local: (x, z) => ({ u: x - OX, v: z - OZ }), world: (u, v) => ({ x: X(u), z: Z(v) }),
    // P6b-D
    hunt: () => (st.hunt ? { t: +st.hunt.t.toFixed(2), phase: st.hunt.phase, why: st.hunt.why || null, inShop: !!st.hunt.inShop, chasing: !!st.hunt.chasing, log: st.hunt.log.slice() } : null),
    huntPose, coneSees: (P, u, v) => coneSees(P, u, v, st), timeline: () => { const TL = timeline(); return { tSweep: TL.tSweep, tLeave: TL.tLeave, tEnd: TL.tEnd }; },
    skipHunt: (t) => { if (st.hunt) st.hunt.t = t; },
    startHunt: (t = 0) => { st.keyTaken = true; st.hunt = { t, phase: 'wait', log: [] }; },   // テスト: 時刻表の途中から(作業場に入る前の時刻なら入った瞬間に立ち位置を覚える)
    // 3 つの陰が全経路(時刻表を dt 刻み)で光の円錐の 4m 以内に入るか(陰の中心と ±r の 5 点)
    spotsVsRoute: (dt = 0.05, r = 0.25) => {
      const TL = timeline(), out = {};
      for (const sp of HU.spots) {
        let hits = 0, minDist = 1e9, minLosDist = 1e9;
        for (let t = HU.doorDelay; t < TL.tEnd; t += dt) {
          const P = huntPose(t);
          for (const [du, dv] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
            const c = coneSees(P, sp.u + du, sp.v + dv, st);
            if (c.seen) hits++;
            minDist = Math.min(minDist, c.dist);
            if (c.inCone && c.los) minLosDist = Math.min(minLosDist, c.dist);
          }
        }
        out[sp.id] = { hits, minDist: +minDist.toFixed(2), minConeLosDist: minLosDist < 1e8 ? +minLosDist.toFixed(2) : null };
      }
      return out;
    },
    spots: () => HU.spots.map((p) => ({ ...p, x: X(p.u), z: Z(p.v) })),
  };
}
