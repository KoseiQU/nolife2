// spaces/x312.js — 別空間 X312「312 のプール」(DESIGN §3.8 I 2 行目・D③・H 第3段)。P5b-2a。
//  玄関を入ると 1K の廊下(木の床・白い壁)がそのまま青いタイルの通路(参考 13: 手すり・青い霧)になり、水の揺らぎの光(参考 09)が壁を流れる。
//  抜けると天井の高い室内プール(参考 12: 暗いティールの水面・濡れた青タイル・奥にスライダーの口)。浅瀬(1.0m)から深く(3.0m)なり、底に 105 の鍵。
//  潜水: 水に入ると泳ぎ(遅い・浮いている)。Ctrl 長押しで潜る、離すと浮上。息ゲージ(潜っている間だけ)。切れたら溺れて第3段の開始位置から。
//  異世界の要素: ①歪む水面(潜ると上の照明が歪んで揺れる・音がこもる)②伸びる(泳ぐほど対岸が遠のく = v 24.5 より奥の頂点を uStretch だけずらす。鍵を取ると戻る)
//   ③反転(鍵を取って浮上すると、入ってきた入口(北)が閉じて反対側(南)の壁に入口がある = 戻りの通路はそこから)。
//  管理人: 鍵を取って浮上するとプールサイドに立って見ているだけ(SCRIPTED・襲わない。浮上した時の視線の先)。戻りの通路に入ると消える。
//  光はすべてシェーダの中の計算(点光源 16 個の配列。three.js のライトは足さない)＋懐中電灯。当たりは平面の箱だけ(水面・プールの縁・階段では詰まらない)。
//  座標: 局所 u = x − 330、v = z。y は SPACE_Y からの高さ(デッキ = 0、水面 = −0.2)。

import * as THREE from 'three';
import { SPACE_Y } from '../world.js';

const OX = 330, OZ = 0;
// 調整値(docs/p5b2a/NOTES.md §4)
export const X312 = {
  hall: { u0: -5.2, u1: 6.8, v0: 12, v1: 32, h: 6.0 },
  pool: { u0: -3.2, u1: 4.8, v0: 15, v1: 29, shallow: 1.0, deep: 3.0, slope: [16.5, 22] },
  water: -0.2,                       // 水面(デッキからの高さ)
  passage: { u0: 0, u1: 1.6, v0: 5, v1: 12, h: 2.6 },
  genkan: { u0: 0.2, u1: 1.4, v0: 0, v1: 5, h: 2.4 },
  back: { v0: 32, v1: 39, gv1: 44 },  // 戻りの通路(反転の後)。39〜44 は 1K の玄関
  cut: 24.5,                         // ②伸びる: これより奥(南)の頂点がずれる
  stretch: { from: 19, k: 0.85, max: 14, back: 4.0 },
  key: [0.8, 23.5],
  swim: { wade: 1.0, swim: 1.1, under: 0.95, down: 1.2, up: 1.0, enter: 1.5, climb: 1.2, floatEye: 0.10, diveEye: 0.42, bob: 0.03, inset: 0.35 },
  breath: { max: 18, refill: 3.0 },
  watch: { dist: 1.2, minDist: 3.0 },
  fog: { hall: [0x02090b, 0.06], under: [0x062a31, 0.17], passage: [0x03100f, 0.06] },
};
const P = X312.pool, HL = X312.hall, WY = X312.water;

export const DEF = {
  origin: [OX, OZ], host: { level: 3, door: '312' },
  entry: [0.8, 0.75, Math.PI],       // 玄関の内側・奥(南)を向く
  exit: [0.8, 0.02],
  slots: { key: [X312.key[0], -(P.deep + 0.2) + 0.012, X312.key[1]] },   // 105 の鍵(深い所の底)
};

const floorDepth = (v) => { const [a, b] = P.slope; const k = Math.min(1, Math.max(0, (v - a) / (b - a))); return P.shallow + (P.deep - P.shallow) * k * k * (3 - 2 * k); };
const poolFloorY = (v) => WY - floorDepth(v);   // 底の高さ(デッキからの相対)

// ================================================================ 材質
const SURF = { deck: 0, wallT: 1, mosaic: 2, ceil: 3, wood: 4, white: 5, metal: 6, slide: 7, void: 8, lamp: 9, poolLamp: 10, door: 11, frame: 12, coping: 13 };
const NL = 16;
// 水の揺らぎの光: 自作の継ぎ目のない網の模様(256² の生成テクスチャ、うねる正弦の網)を 2 枚、違う向きに流して重ねる(UV アニメ)
const CAUSTIC = `
  uniform sampler2D uCaus;
  float caust(vec2 p, float t) {
    float a = texture2D(uCaus, p * 0.31 + vec2(t * 0.021, t * 0.013)).r;
    float b = texture2D(uCaus, p * 0.23 + vec2(-t * 0.017, t * 0.024) + 0.37).r;
    return max(a, b) * 0.9 + a * b * 0.6;
  }
`;
function makeCausticTexture(N = 256) {
  const d = new Uint8Array(N * N), T = Math.PI * 2;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = i / N * T, y = j / N * T;   // 整数倍の周波数だけ = 継ぎ目なし
    const a = Math.sin(2 * x + Math.sin(1 * y + 0.4) * 1.6 + 0.7) + Math.sin(3 * y + Math.sin(2 * x - 0.3) * 1.8);
    const b = Math.sin(3 * x - Math.sin(2 * y + 1.1) * 1.4 + 2.0) + Math.sin(2 * y + Math.sin(3 * x) * 1.5 + 0.9);
    const la = Math.pow(1 - Math.min(1, Math.abs(a) * 0.55), 5), lb = Math.pow(1 - Math.min(1, Math.abs(b) * 0.55), 5);
    d[j * N + i] = Math.round(Math.min(1, Math.max(la, lb) * 0.9 + la * lb * 0.5) * 255);
  }
  const t = new THREE.DataTexture(d, N, N, THREE.RedFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}
function stretchVertex(sh) {
  return sh.replace('#include <begin_vertex>', `#include <begin_vertex>
    { vec3 w0 = (modelMatrix * vec4(transformed, 1.0)).xyz; if (aStr > 0.5 && w0.z > uCut + 0.0005) transformed.z += uStretch; }`);
}
function makeMaterial(U) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.0 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = stretchVertex(sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aSurf; attribute float aStr; uniform float uStretch, uCut;
        varying vec3 vWP; varying float vSurf;`))
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vSurf = aSurf;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime, uY, uWY, uLookA, uLookB, uRevealed, uStretchF;
        uniform vec4 uLP[${NL}]; uniform vec3 uLC[${NL}]; uniform vec3 uWater;
        varying vec3 vWP; varying float vSurf;
        float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        ${CAUSTIC}
        vec3 tileCol(vec2 q, float sz, vec3 a, vec3 b, float grout, inout float gr) {
          vec2 t = q / sz; vec2 c = floor(t); vec2 f = fract(t);
          float e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
          float aa = max(fwidth(t.x), fwidth(t.y));   // 遠くの目地は細くなりすぎてちらつくので、画素の幅でぼかして薄める
          gr = (1.0 - smoothstep(grout * 0.5, grout + aa, e)) * clamp(1.5 - aa / grout * 0.5, 0.0, 1.0);
          return mix(a, b, h21(c));
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 Pw = vWP; float fy = Pw.y - uY; int S = int(vSurf + 0.5);
        vec3 nW0 = normalize(cross(dFdx(vWP), dFdy(vWP)));
        vec2 qa = abs(nW0.x) > 0.5 ? vec2(Pw.z, fy) : abs(nW0.z) > 0.5 ? vec2(Pw.x, fy) : Pw.xz;
        float gr = 0.0; vec3 col = vec3(0.5); float rgh = 0.5;
        // 1K の仕上げ → タイル(玄関から 2.4〜4.6m)
        float lz = Pw.z - ${OZ.toFixed(1)};
        float look = lz < 20.0 ? smoothstep(uLookA, uLookB, lz) : smoothstep(uLookA, uLookB, ${(OZ + X312.back.gv1).toFixed(1)} - Pw.z);
        if (S == 0 || (S == 4 && look > 0.0)) {
          vec3 t = tileCol(Pw.xz, 0.25, vec3(0.20, 0.30, 0.33), vec3(0.27, 0.38, 0.41), 0.03, gr);
          t = mix(t, vec3(0.05, 0.08, 0.09), gr);
          col = t; rgh = mix(0.22, 0.6, gr);
          if (S == 4) { vec3 wd = vec3(0.33, 0.22, 0.13) * (0.8 + 0.35 * h21(vec2(floor(Pw.x / 0.12), 3.0))); col = mix(wd, t, look); rgh = mix(0.5, rgh, look); }
        } else if (S == 4) {
          col = vec3(0.33, 0.22, 0.13) * (0.8 + 0.35 * h21(vec2(floor(Pw.x / 0.12), 3.0))); rgh = 0.5;
        } else if (S == 1 || S == 5) {
          vec3 t = tileCol(qa, 0.15, vec3(0.36, 0.47, 0.49), vec3(0.43, 0.54, 0.55), 0.028, gr);
          t = mix(t, vec3(0.2, 0.26, 0.27), gr);
          col = t; rgh = mix(0.2, 0.7, gr);
          if (S == 5) { col = mix(vec3(0.6, 0.6, 0.58), t, look); rgh = mix(0.9, rgh, look); }
        } else if (S == 2) {
          vec3 t = tileCol(qa, 0.07, vec3(0.03, 0.17, 0.27), vec3(0.07, 0.29, 0.38), 0.07, gr);
          col = mix(t, vec3(0.08, 0.2, 0.22), gr * 0.7); rgh = 0.3;
        } else if (S == 3) { col = vec3(0.045, 0.06, 0.065); rgh = 0.95;
        } else if (S == 6) { col = vec3(0.5, 0.56, 0.57); rgh = 0.28;
        } else if (S == 7) { col = vec3(0.08, 0.5, 0.4); rgh = 0.25;
        } else if (S == 8) { col = vec3(0.0); rgh = 1.0;
        } else if (S == 11) { col = vec3(0.30, 0.17, 0.08) * (0.85 + 0.3 * h21(vec2(floor(fy * 30.0), 1.0))); rgh = 0.55;
        } else if (S == 12) { col = vec3(0.04); rgh = 0.5;
        } else if (S == 13) { col = vec3(0.52, 0.56, 0.55) * (0.92 + 0.08 * h21(floor(Pw.xz * 3.0))); rgh = 0.4;
        } else { col = vec3(0.9); }
        float under = step(fy, uWY - 0.002);
        diffuseColor.rgb = col;
        float xR = rgh;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = xR;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (S == 9) totalEmissiveRadiance += vec3(0.85, 0.95, 1.0) * 0.7;
        if (S == 10) totalEmissiveRadiance += vec3(0.55, 1.0, 0.98) * 1.6;
        if (S == 7) totalEmissiveRadiance += vec3(0.01, 0.07, 0.055);   // スライダーの筒(プールの光を受けた樹脂のぼんやりした明るさ)`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        if (S != 8) {
          vec3 n = inverseTransformDirection(normal, viewMatrix);
          vec3 irr = vec3(0.0), sp = vec3(0.0);
          vec3 V = normalize(cameraPosition - Pw);
          bool wet = (S == 0 || S == 1 || S == 2 || S == 13) && xR < 0.6;
          // 区画ごとの灯りだけ回す(玄関と通路 0〜2・ホールとプール 3〜10・戻りの通路 11〜13)
          int i0 = 3, i1 = 11;
          if (lz < ${X312.hall.v0.toFixed(1)}) { i0 = 0; i1 = 3; } else if (lz > ${X312.hall.v1.toFixed(1)} + uStretchF) { i0 = 11; i1 = 14; }
          for (int i = i0; i < i1; i++) {
            vec4 lp = uLP[i]; if (lp.w <= 0.0) continue;
            vec3 d = lp.xyz - Pw; float r2 = dot(d, d);
            if (r2 > lp.w * lp.w) continue;
            vec3 l = d * inversesqrt(r2);
            float nd = max(dot(n, l), 0.0) * 0.8 + 0.2;
            float lUnder = step(lp.y - uY, uWY);
            float k = mix(1.0, 0.22, abs(lUnder - under));   // 水面をまたぐ光は弱く(屈折・散乱)
            irr += uLC[i] * nd * k / (r2 + 0.6) * (1.0 - smoothstep(lp.w * 0.6, lp.w, sqrt(r2)));
            if (wet) { vec3 hv = normalize(l + V); sp += uLC[i] * pow(max(dot(n, hv), 0.0), 70.0) / (r2 * 0.2 + 0.8); }   // 濡れたタイルの灯りの映り
          }
          irr += uWater * 0.03;   // 水からのぼんやりした照り返し
          // 水の中: 揺らぎの光(底・プールの壁)と水の色。水の上: 壁に流れる揺らぎの反射(参考 09)
          if (under > 0.5) {
            float cz = caust((abs(n.y) > 0.5 ? Pw.xz : qa) * 1.5, uTime * 1.1);
            irr *= 0.55 + 1.7 * cz;
            float dep = uWY - fy;
            diffuseColor.rgb = mix(diffuseColor.rgb * vec3(0.55, 0.9, 1.0), uWater * 0.3, 1.0 - exp(-0.32 * dep));
          } else if (S == 1 || S == 3 || S == 5 || S == 13 || S == 0) {
            vec2 cq = abs(n.y) > 0.5 ? Pw.xz * 0.9 : qa * vec2(0.9, 1.4);
            float wv = caust(cq + vec2(0.0, uTime * 0.12), uTime * 0.8);
            // 水面に近いほど(プールの縁からの距離・高さ)強い。通路は弱く一様に
            vec2 lp2 = vec2(Pw.x - ${OX.toFixed(1)}, Pw.z - ${OZ.toFixed(1)});
            vec2 dq = max(vec2(${P.u0.toFixed(2)}, ${P.v0.toFixed(2)}) - lp2, lp2 - vec2(${P.u1.toFixed(2)}, ${(P.v1).toFixed(2)}) - vec2(0.0, uStretchF));
            float dPool = length(max(dq, 0.0));
            float near = lz > ${X312.hall.v0.toFixed(1)} && lz < ${(X312.hall.v1).toFixed(1)} + uStretchF ? exp(-dPool * 0.35) * exp(-max(fy - 1.0, 0.0) * 0.35) : 0.35;
            if (S == 0) near *= 0.4;
            irr += uWater * wv * 0.24 * near * (S == 5 ? look : 1.0);
          }
          reflectedLight.indirectDiffuse += diffuseColor.rgb * irr;
          reflectedLight.indirectSpecular += sp * (1.0 - xR) * 0.12;
        }`);
  };
  m.customProgramCacheKey = () => 'n2_x312_v4';
  return m;
}

// 水面(上から: 暗いティール・下からの光・灯りの映り / 下から: スネルの窓の中で揺れる照明・外は全反射のティール)
function makeWaterMaterial(U) {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
    vertexShader: `
      attribute float aStr; uniform float uStretch, uCut;
      varying vec3 vWP;
      #include <fog_pars_vertex>
      void main() {
        vec3 transformed = position;
        { vec3 w0 = (modelMatrix * vec4(transformed, 1.0)).xyz; if (aStr > 0.5 && w0.z > uCut + 0.0005) transformed.z += uStretch; }
        vec4 wp = modelMatrix * vec4(transformed, 1.0); vWP = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float uTime, uWYw; uniform vec4 uLP[${NL}]; uniform vec3 uLC[${NL}]; uniform vec3 uWater;
      varying vec3 vWP;
      #include <fog_pars_fragment>
      ${CAUSTIC}
      vec3 wn(vec2 p, float t) {
        float e = 0.06;
        float h0 = sin(p.x * 1.7 + t * 1.1) * 0.5 + sin(p.y * 2.3 - t * 0.9) * 0.5 + sin((p.x + p.y) * 3.1 + t * 1.7) * 0.25 + sin((p.x - p.y) * 5.3 - t * 2.3) * 0.12;
        float hx = sin((p.x + e) * 1.7 + t * 1.1) * 0.5 + sin(p.y * 2.3 - t * 0.9) * 0.5 + sin((p.x + e + p.y) * 3.1 + t * 1.7) * 0.25 + sin((p.x + e - p.y) * 5.3 - t * 2.3) * 0.12;
        float hz = sin(p.x * 1.7 + t * 1.1) * 0.5 + sin((p.y + e) * 2.3 - t * 0.9) * 0.5 + sin((p.x + p.y + e) * 3.1 + t * 1.7) * 0.25 + sin((p.x - p.y - e) * 5.3 - t * 2.3) * 0.12;
        return normalize(vec3(-(hx - h0) / e * 0.06, 1.0, -(hz - h0) / e * 0.06));
      }
      void main() {
        vec3 P = vWP;
        vec3 n = wn(P.xz, uTime);
        vec3 V = normalize(cameraPosition - P);
        vec3 col; float a;
        if (cameraPosition.y >= uWYw) {
          float fr = 0.03 + 0.97 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
          vec3 R = reflect(-V, n);
          vec3 refl = vec3(0.004, 0.012, 0.016);
          vec3 glow = vec3(0.0);
          for (int i = 3; i < 11; i++) {
            vec4 lp = uLP[i]; if (lp.w <= 0.0) continue;
            vec3 d = lp.xyz - P; float r2 = dot(d, d);
            if (lp.y < uWYw) { glow += uLC[i] / (r2 * 0.35 + 1.0); }                       // 水の中の灯り: 水がぼんやり光る
            else { float s = pow(max(dot(R, normalize(d)), 0.0), 400.0); refl += uLC[i] * s * 3.0 / (1.0 + r2 * 0.02); }   // 天井の灯りの映り
          }
          float cz = caust(P.xz * 1.2, uTime * 0.9);
          col = uWater * 0.06 + glow * vec3(0.05, 0.2, 0.2) * (0.7 + 0.6 * cz);
          col = mix(col, refl, fr);
          a = mix(0.5, 0.96, fr);
        } else {
          // 下から: 窓の中は上の照明が歪んで揺れる、外は全反射
          float c = dot(-V, vec3(0.0, 1.0, 0.0)) + dot(n.xz, -V.xz) * 1.4;
          float win = smoothstep(0.6, 0.72, c);
          vec3 sky = vec3(0.006, 0.02, 0.024);
          for (int i = 3; i < 5; i++) {
            vec4 lp = uLP[i]; if (lp.w <= 0.0 || lp.y < uWYw) continue;
            vec2 q = P.xz + n.xz * (lp.y - uWYw) * 2.2 - lp.xz;
            sky += uLC[i] * exp(-dot(q, q) * 1.6) * 0.9;
          }
          vec3 tir = uWater * 0.1 * (0.7 + 0.6 * caust(P.xz * 0.8, uTime));
          col = mix(tir, sky + uWater * 0.05, win);
          a = 0.96;
        }
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
  });
}

// ================================================================ ジオメトリ(世界座標で組む。aStr = ②伸びるでずれる)
class GB {
  constructor() { this.p = []; this.n = []; this.s = []; this.t = []; this.i = []; this.surf = 0; this.str = 0; }
  quad(o, U, V, N, nu = 1, nv = 1) {
    const base = this.p.length / 3;
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const a = i / nu, b = j / nv;
      this.p.push(o[0] + U[0] * a + V[0] * b, o[1] + U[1] * a + V[1] * b, o[2] + U[2] * a + V[2] * b);
      this.n.push(...N); this.s.push(this.surf); this.t.push(this.str);
    }
    const c = [U[1] * V[2] - U[2] * V[1], U[2] * V[0] - U[0] * V[2], U[0] * V[1] - U[1] * V[0]];
    const flip = c[0] * N[0] + c[1] * N[1] + c[2] * N[2] < 0;
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = base + j * (nu + 1) + i, b = a + 1, cc = a + nu + 1, d = cc + 1;
      if (!flip) this.i.push(a, b, d, a, d, cc); else this.i.push(a, d, b, a, cc, d);
    }
  }
  // z の範囲を伸びるの切れ目(cut と cut+1mm)で分けて置く。make(z0, z1) が 1 枚を足す
  splitZ(z0, z1, make) {
    const c = OZ + X312.cut;
    if (!this.str || z1 <= c || z0 >= c + 0.001) { make(z0, z1); return; }
    make(z0, c); make(c, c + 0.001); make(c + 0.001, z1);
  }
  // 床・天井(y の面。up = 上向きか)
  floor(x0, x1, z0, z1, y, up = true) { this.splitZ(z0, z1, (a, b) => this.quad([x0, y, a], [x1 - x0, 0, 0], [0, 0, b - a], [0, up ? 1 : -1, 0])); }
  // x = 一定の壁(nx = 向き ±1)
  wallX(x, z0, z1, y0, y1, nx) { this.splitZ(z0, z1, (a, b) => this.quad([x, y0, a], [0, 0, b - a], [0, y1 - y0, 0], [nx, 0, 0])); }
  // z = 一定の壁(nz = 向き ±1)
  wallZ(z, x0, x1, y0, y1, nz) { this.quad([x0, y0, z], [x1 - x0, 0, 0], [0, y1 - y0, 0], [0, 0, nz]); }
  box(x0, y0, z0, x1, y1, z1, faces = 'px nx py ny pz nz') {
    const f = faces.split(' '), dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    if (f.includes('px')) this.quad([x1, y0, z0], [0, 0, dz], [0, dy, 0], [1, 0, 0]);
    if (f.includes('nx')) this.quad([x0, y0, z0], [0, 0, dz], [0, dy, 0], [-1, 0, 0]);
    if (f.includes('py')) this.quad([x0, y1, z0], [dx, 0, 0], [0, 0, dz], [0, 1, 0]);
    if (f.includes('ny')) this.quad([x0, y0, z0], [dx, 0, 0], [0, 0, dz], [0, -1, 0]);
    if (f.includes('pz')) this.quad([x0, y0, z1], [dx, 0, 0], [0, dy, 0], [0, 0, 1]);
    if (f.includes('nz')) this.quad([x0, y0, z0], [dx, 0, 0], [0, dy, 0], [0, 0, -1]);
  }
  // 既存のジオメトリ(位置・法線)をこの面の種類で足す
  addGeo(g) {
    g = g.index ? g.toNonIndexed() : g;
    const base = this.p.length / 3, pa = g.attributes.position, na = g.attributes.normal;
    for (let k = 0; k < pa.count; k++) { this.p.push(pa.getX(k), pa.getY(k), pa.getZ(k)); this.n.push(na.getX(k), na.getY(k), na.getZ(k)); this.s.push(this.surf); this.t.push(this.str); this.i.push(base + k); }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('aSurf', new THREE.Float32BufferAttribute(this.s, 1));
    g.setAttribute('aStr', new THREE.Float32BufferAttribute(this.t, 1));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}
const X = (u) => OX + u, Y = (h) => SPACE_Y + h, Z = (v) => OZ + v;

// 1K の玄関と青い通路(back = 戻りの通路。南へ向かって玄関 → 扉)
function buildPassage(b, back) {
  const G = X312.genkan, Pa = X312.passage;
  const zf = back ? (v) => Z(X312.back.gv1 - v) : (v) => Z(v);
  const zr = (a, c) => (back ? [Math.min(zf(a), zf(c)), Math.max(zf(a), zf(c))] : [zf(a), zf(c)]);
  const inward = back ? -1 : 1;   // 扉の壁の内向き
  b.str = 0;
  // 玄関(木の床・白い壁)。v 0〜5
  { const [z0, z1] = zr(G.v0, G.v1);
    b.surf = SURF.wood; b.floor(X(G.u0), X(G.u1), z0, z1, Y(0), true);
    b.surf = SURF.white; b.floor(X(G.u0), X(G.u1), z0, z1, Y(G.h), false);
    b.wallX(X(G.u0), z0, z1, Y(0), Y(G.h), 1); b.wallX(X(G.u1), z0, z1, Y(0), Y(G.h), -1);
    // 扉の壁(扉の開口つき)と、通路への段差の壁(玄関の天井 2.4 → 通路 2.6)
    const zd = zf(0);
    b.wallZ(zd, X(G.u0), X(0.39), Y(0), Y(G.h), inward); b.wallZ(zd, X(1.21), X(G.u1), Y(0), Y(G.h), inward); b.wallZ(zd, X(0.39), X(1.21), Y(2.05), Y(G.h), inward);
    b.surf = SURF.door; b.box(X(0.4), Y(0), back ? zd - 0.04 : zd, X(1.2), Y(2.04), back ? zd : zd + 0.04);
    b.surf = SURF.frame;
    for (const [a, c] of [[0.34, 0.4], [1.2, 1.26]]) b.box(X(a), Y(0), back ? zd - 0.07 : zd, X(c), Y(2.1), back ? zd : zd + 0.07);
    b.box(X(0.34), Y(2.04), back ? zd - 0.07 : zd, X(1.26), Y(2.1), back ? zd : zd + 0.07);
    b.surf = SURF.metal; b.box(X(1.02), Y(0.98), back ? zd - 0.09 : zd + 0.04, X(1.16), Y(1.0), back ? zd - 0.04 : zd + 0.09);
    // 玄関の上がり框(木)・幅木
    b.surf = SURF.frame; b.box(X(G.u0), Y(0), back ? zf(1.0) - 0.04 : zf(1.0), X(G.u1), Y(0.035), back ? zf(1.0) : zf(1.0) + 0.04, 'py pz nz');
    const zs = zf(G.v1);
    b.surf = SURF.white; b.wallZ(zs, X(Pa.u0), X(G.u0), Y(0), Y(Pa.h), inward); b.wallZ(zs, X(G.u1), X(Pa.u1), Y(0), Y(Pa.h), inward); b.wallZ(zs, X(G.u0), X(G.u1), Y(G.h), Y(Pa.h), inward);
  }
  // 青い通路。v 5〜12。手すり(参考 13)
  { const [z0, z1] = zr(Pa.v0, Pa.v1);
    b.surf = SURF.wood; b.floor(X(Pa.u0), X(Pa.u1), z0, z1, Y(0), true);   // 木 → タイル(シェーダで混ぜる)
    b.surf = SURF.ceil; b.floor(X(Pa.u0), X(Pa.u1), z0, z1, Y(Pa.h), false);
    b.surf = SURF.white; b.wallX(X(Pa.u0), z0, z1, Y(0), Y(Pa.h), 1); b.wallX(X(Pa.u1), z0, z1, Y(0), Y(Pa.h), -1);
    b.surf = SURF.metal;
    for (const [u, s] of [[Pa.u0 + 0.06, 1], [Pa.u1 - 0.06, -1]]) {
      for (const h of [0.92, 0.5]) b.box(X(u - 0.02), Y(h - 0.02), z0 + 0.2, X(u + 0.02), Y(h + 0.02), z1 - 0.1, 'px nx py ny');
      for (let v = Pa.v0 + 0.4; v < Pa.v1; v += 1.6) { const z = zf(v); b.box(X(u - 0.02), Y(0), z - 0.02, X(u + 0.02), Y(0.94), z + 0.02, 'px nx pz nz'); }
      void s;
    }
    b.surf = SURF.lamp;
    for (const v of [6.5, 10.0]) { const z = zf(v); b.box(X(0.55), Y(Pa.h - 0.02), z - 0.3, X(1.05), Y(Pa.h - 0.005), z + 0.3, 'ny'); }
    { const z = zf(1.6); b.box(X(0.65), Y(G.h - 0.02), z - 0.15, X(0.95), Y(G.h - 0.005), z + 0.15, 'ny'); }
  }
}

function buildHall(b) {
  // 床(デッキ)はプールの穴を除いて 4 枚。プールの縁(笠石)
  b.str = 1;
  b.surf = SURF.deck;
  b.floor(X(HL.u0), X(HL.u1), Z(HL.v0), Z(P.v0), Y(0));
  b.floor(X(HL.u0), X(HL.u1), Z(P.v1), Z(HL.v1), Y(0));
  b.floor(X(HL.u0), X(P.u0), Z(P.v0), Z(P.v1), Y(0));
  b.floor(X(P.u1), X(HL.u1), Z(P.v0), Z(P.v1), Y(0));
  b.surf = SURF.coping;
  const cw = 0.3;
  b.floor(X(P.u0 - cw), X(P.u1 + cw), Z(P.v0 - cw), Z(P.v0), Y(0.012));
  b.floor(X(P.u0 - cw), X(P.u1 + cw), Z(P.v1), Z(P.v1 + cw), Y(0.012));
  b.floor(X(P.u0 - cw), X(P.u0), Z(P.v0), Z(P.v1), Y(0.012));
  b.floor(X(P.u1), X(P.u1 + cw), Z(P.v0), Z(P.v1), Y(0.012));
  // 天井・壁(タイル)。北の壁は通路の開口、南の壁は戻りの開口(反転の前はふさぐ板 = 別メッシュ)
  b.surf = SURF.ceil; b.floor(X(HL.u0), X(HL.u1), Z(HL.v0), Z(HL.v1), Y(HL.h), false);
  b.surf = SURF.wallT;
  b.wallX(X(HL.u0), Z(HL.v0), Z(HL.v1), Y(0), Y(HL.h), 1);
  b.wallX(X(HL.u1), Z(HL.v0), Z(HL.v1), Y(0), Y(HL.h), -1);
  const Pa = X312.passage;
  b.str = 0;
  b.wallZ(Z(HL.v0), X(HL.u0), X(Pa.u0), Y(0), Y(HL.h), 1); b.wallZ(Z(HL.v0), X(Pa.u1), X(HL.u1), Y(0), Y(HL.h), 1); b.wallZ(Z(HL.v0), X(Pa.u0), X(Pa.u1), Y(Pa.h), Y(HL.h), 1);
  b.str = 1;
  b.wallZ(Z(HL.v1), X(HL.u0), X(Pa.u0), Y(0), Y(HL.h), -1); b.wallZ(Z(HL.v1), X(Pa.u1), X(HL.u1), Y(0), Y(HL.h), -1); b.wallZ(Z(HL.v1), X(Pa.u0), X(Pa.u1), Y(Pa.h), Y(HL.h), -1);
  // プール(モザイク): 底(浅瀬 → 斜面 → 深い所)・壁(底の形に沿う)・北の壁の段
  b.surf = SURF.mosaic;
  const rows = [P.v0, P.slope[0]];
  for (let k = 1; k <= 8; k++) rows.push(P.slope[0] + (P.slope[1] - P.slope[0]) * k / 8);
  rows.push(P.v1);
  for (let k = 0; k < rows.length - 1; k++) {
    const a = rows[k], c = rows[k + 1], ya = poolFloorY(a), yc = poolFloorY(c);
    if (Math.abs(ya - yc) < 1e-4) b.floor(X(P.u0), X(P.u1), Z(a), Z(c), Y(ya));
    else { const dz = c - a, dy = yc - ya, L = Math.hypot(dz, dy); b.quad([X(P.u0), Y(ya), Z(a)], [P.u1 - P.u0, 0, 0], [0, dy, dz], [0, dz / L, -dy / L]); }
    for (const [u, nx] of [[P.u0, 1], [P.u1, -1]]) {   // 横の壁(底の線に沿った台形を 2 枚の三角で)
      b.splitZ(Z(a), Z(c), (za, zc) => {
        const ka = (za - Z(a)) / (c - a), kc = (zc - Z(a)) / (c - a);
        const y0a = Y(ya + (yc - ya) * ka), y0c = Y(ya + (yc - ya) * kc);
        const base = b.p.length / 3;
        for (const [zz, yy] of [[za, y0a], [zc, y0c], [zc, Y(0)], [za, Y(0)]]) { b.p.push(X(u), yy, zz); b.n.push(nx, 0, 0); b.s.push(b.surf); b.t.push(b.str); }
        if (nx > 0) b.i.push(base, base + 2, base + 1, base, base + 3, base + 2); else b.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
      });
    }
  }
  b.wallZ(Z(P.v0), X(P.u0), X(P.u1), Y(poolFloorY(P.v0)), Y(0), 1);
  b.wallZ(Z(P.v1), X(P.u0), X(P.u1), Y(poolFloorY(P.v1)), Y(0), -1);
  // 北の段(入水の階段: 4 段)
  b.surf = SURF.coping;
  for (let k = 0; k < 4; k++) { const y = -0.25 * (k + 1), z1 = P.v0 + 0.32 * (k + 1); b.box(X(-0.4), Y(poolFloorY(P.v0)), Z(P.v0), X(2.0), Y(y), Z(z1), 'py px nx pz'); }
  // プールの中の灯り(左右の壁・水面の下 0.7m)
  b.surf = SURF.poolLamp;
  for (const v of [18, 22.5, 27]) for (const [u, nx] of [[P.u0 + 0.01, 1], [P.u1 - 0.01, -1]]) { const x0 = Math.min(X(u), X(u) + nx * 0.03), x1 = Math.max(X(u), X(u) + nx * 0.03); b.box(x0, Y(WY - 0.85), Z(v - 0.18), x1, Y(WY - 0.55), Z(v + 0.18), nx > 0 ? 'px' : 'nx'); }
  // 天井の灯り(暗い・2 つ)
  b.surf = SURF.lamp;
  for (const v of [18.5, 27.5]) b.box(X(0.2), Y(HL.h - 0.03), Z(v - 0.7), X(1.4), Y(HL.h - 0.005), Z(v + 0.7), 'ny');
  // はしご(深い所の東の縁)
  b.surf = SURF.metal;
  for (const dv of [-0.28, 0.28]) {
    const pts = [new THREE.Vector3(X(P.u1 - 0.25), Y(WY - 1.2), Z(26.5 + dv)), new THREE.Vector3(X(P.u1 - 0.12), Y(0.2), Z(26.5 + dv)), new THREE.Vector3(X(P.u1 + 0.18), Y(0.95), Z(26.5 + dv)), new THREE.Vector3(X(P.u1 + 0.45), Y(0.25), Z(26.5 + dv)), new THREE.Vector3(X(P.u1 + 0.5), Y(0.0), Z(26.5 + dv))];
    b.addGeo(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.022, 8, false));
  }
  for (const h of [-0.35, -0.75]) b.box(X(P.u1 - 0.2), Y(WY + h - 0.02), Z(26.5 - 0.28), X(P.u1 - 0.12), Y(WY + h), Z(26.5 + 0.28), 'py ny px nx');
  // スライダーの出口(参考 12): 南の壁の高い所から降りてきて、プールの南の端の上で口を開ける太い筒。中は暗い
  { const r = 0.55;
    const pts = [[-4.6, 4.9, 32.6], [-4.3, 4.3, 31.2], [-3.4, 3.0, 30.4], [-2.6, 1.7, 29.9], [-2.2, 1.05, 29.55]].map(([u, h, v]) => new THREE.Vector3(X(u), Y(h), Z(v)));
    const curve = new THREE.CatmullRomCurve3(pts);
    b.surf = SURF.slide; b.addGeo(new THREE.TubeGeometry(curve, 40, r, 24, false));
    const inner = new THREE.TubeGeometry(curve, 40, r - 0.05, 24, false).toNonIndexed();
    const na = inner.attributes.normal; for (let k = 0; k < na.count; k++) na.setXYZ(k, -na.getX(k), -na.getY(k), -na.getZ(k));
    const pa = inner.attributes.position; for (let k = 0; k < pa.count; k += 3) { const x = pa.getX(k + 1), y = pa.getY(k + 1), z = pa.getZ(k + 1); pa.setXYZ(k + 1, pa.getX(k + 2), pa.getY(k + 2), pa.getZ(k + 2)); pa.setXYZ(k + 2, x, y, z); }
    b.surf = SURF.void; b.addGeo(inner);
    // 口の縁(筒の向きに合わせた輪)
    const end = curve.getPoint(1), tan = curve.getTangent(1);
    const rim = new THREE.TorusGeometry(r - 0.02, 0.045, 10, 40);
    rim.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tan)); rim.translate(end.x, end.y, end.z);
    b.surf = SURF.slide; b.addGeo(rim);
    // 支柱 2 本
    b.surf = SURF.metal;
    for (const [u, v, h] of [[-2.4, 30.3, 1.25], [-3.6, 31.1, 2.6]]) b.box(X(u) - 0.05, Y(0), Z(v) - 0.05, X(u) + 0.05, Y(h), Z(v) + 0.05, 'px nx pz nz');
  }
}

function buildBackPassage(b) { buildPassage(b, true); }

// ================================================================ 当たり
function box(ctx, u0, v0, u1, v1, kind = 'wall') {
  const c = { minX: X(u0), maxX: X(u1), minZ: Z(v0), maxZ: Z(v1), y0: SPACE_Y, y1: SPACE_Y + HL.h, kind, roomId: ctx.key, disabled: false };
  ctx.cols.push(c);
  return c;
}

// ================================================================ build
export function build(ctx) {
  const st = ctx.state;
  const U = st.U = {
    uTime: { value: 0 }, uY: { value: SPACE_Y }, uWY: { value: WY }, uLookA: { value: 2.4 }, uLookB: { value: 4.6 }, uRevealed: { value: 0 },
    uStretch: { value: 0 }, uStretchF: { value: 0 }, uCut: { value: OZ + X312.cut },
    uLP: { value: Array.from({ length: NL }, () => new THREE.Vector4(0, 0, 0, 0)) }, uLC: { value: Array.from({ length: NL }, () => new THREE.Vector3()) },
    uWater: { value: new THREE.Vector3(0.05, 0.3, 0.32) },
    uCaus: { value: makeCausticTexture() },
  };
  const mat = st.mat = makeMaterial(U);
  const g = ctx.group;
  const mesh = (geo, m, name) => { const o = new THREE.Mesh(geo, m); o.name = name; o.receiveShadow = true; o.castShadow = false; o.frustumCulled = false; g.add(o); return o; };
  // 本体(玄関・通路・ホール・プール)= 1 つのジオメトリ
  { const b = new GB(); buildPassage(b, false); buildHall(b); st.main = mesh(b.geometry(), mat, 'X312_main'); }
  // 戻りの通路(反転の後だけ)
  { const b = new GB(); buildBackPassage(b); st.backMesh = mesh(b.geometry(), mat, 'X312_back'); }
  // 開口をふさぐ板(北 = 反転の後、南 = 反転の前)
  { const Pa = X312.passage;
    const mk = (v, nz, str) => { const b = new GB(); b.str = str; b.surf = SURF.wallT; b.wallZ(Z(v), X(Pa.u0), X(Pa.u1), Y(0), Y(Pa.h), nz); return mesh(b.geometry(), mat, 'X312_plug'); };
    st.plugN = mk(HL.v0, 1, 0); st.plugS = mk(HL.v1, -1, 1); }
  // 水面
  { const b = new GB(); b.str = 1; b.floor(X(P.u0), X(P.u1), Z(P.v0), Z(P.v1), Y(WY));
    const geo = b.geometry();
    const wm = st.water = makeWaterMaterial(U);
    Object.assign(wm.uniforms, { uTime: U.uTime, uWYw: { value: Y(WY) }, uLP: U.uLP, uLC: U.uLC, uWater: U.uWater, uStretch: U.uStretch, uCut: U.uCut, uCaus: U.uCaus });
    st.waterMesh = mesh(geo, wm, 'X312_water'); st.waterMesh.receiveShadow = false; st.waterMesh.renderOrder = 2; }
  // 灯り(局所 u, y, v・色・強さ・届く距離)
  const L = st.lights = [
    { p: [0.8, 2.25, 1.6], c: [1.0, 0.9, 0.75], k: 0.16, r: 7 },              // 玄関
    { p: [0.8, 2.5, 6.5], c: [0.75, 0.95, 1.0], k: 0.13, r: 8 },              // 通路
    { p: [0.8, 2.5, 10.0], c: [0.75, 0.95, 1.0], k: 0.13, r: 8 },
    { p: [0.8, 5.9, 18.5], c: [0.8, 0.92, 1.0], k: 0.4, r: 16, str: 0 },     // ホールの天井
    { p: [0.8, 5.9, 27.5], c: [0.8, 0.92, 1.0], k: 0.4, r: 16, str: 1 },
  ];
  for (const v of [18, 22.5, 27]) for (const u of [P.u0 + 0.15, P.u1 - 0.15]) L.push({ p: [u, WY - 0.7, v], c: [0.45, 1.0, 0.95], k: 0.55, r: 11, str: v > X312.cut ? 1 : 0 });   // プールの中
  L.push({ p: [0.8, 2.5, 35.5], c: [0.75, 0.95, 1.0], k: 0.13, r: 8, back: 1 }, { p: [0.8, 2.5, 38.5], c: [0.75, 0.95, 1.0], k: 0.13, r: 8, back: 1 }, { p: [0.8, 2.25, 42.4], c: [1.0, 0.9, 0.75], k: 0.16, r: 7, back: 1 });
  for (const l of L) if (l.str === undefined) l.str = l.p[2] > X312.cut && l.p[2] < HL.v1 ? 1 : 0;
  // 敵の照明(ホールの天井とプールの灯り)
  for (const l of L.slice(3, 11)) ctx.lamps.push([X(l.p[0]), Y(Math.max(l.p[1], 0.5)), Z(l.p[2])]);
  // 当たり
  const G = X312.genkan, Pa = X312.passage, Bk = X312.back;
  box(ctx, G.u0, -0.2, G.u1, 0);                              // 玄関の扉の壁
  box(ctx, G.u0 - 0.2, 0, G.u0, G.v1); box(ctx, G.u1, 0, G.u1 + 0.2, G.v1);
  box(ctx, Pa.u0 - 0.2, Pa.v0, Pa.u0, Pa.v1); box(ctx, Pa.u1, Pa.v0, Pa.u1 + 0.2, Pa.v1);
  box(ctx, Pa.u0 - 0.05, G.v1 - 0.05, G.u0, G.v1); box(ctx, G.u1, G.v1 - 0.05, Pa.u1 + 0.05, G.v1);
  box(ctx, HL.u0, HL.v0 - 0.2, Pa.u0, HL.v0); box(ctx, Pa.u1, HL.v0 - 0.2, HL.u1, HL.v0);
  st.colPlugN = box(ctx, Pa.u0, HL.v0 - 0.2, Pa.u1, HL.v0);
  st.colW = box(ctx, HL.u0 - 0.2, HL.v0, HL.u0, HL.v1); st.colE = box(ctx, HL.u1, HL.v0, HL.u1 + 0.2, HL.v1);
  st.colS = [box(ctx, HL.u0, HL.v1, Pa.u0, HL.v1 + 0.2), box(ctx, Pa.u1, HL.v1, HL.u1, HL.v1 + 0.2)];
  st.colPlugS = box(ctx, Pa.u0, HL.v1, Pa.u1, HL.v1 + 0.2);
  st.colBack = [box(ctx, Pa.u0 - 0.2, Bk.v0, Pa.u0, Bk.v1), box(ctx, Pa.u1, Bk.v0, Pa.u1 + 0.2, Bk.v1),
    box(ctx, G.u0 - 0.2, Bk.v1, G.u0, Bk.gv1), box(ctx, G.u1, Bk.v1, G.u1 + 0.2, Bk.gv1), box(ctx, G.u0, Bk.gv1, G.u1, Bk.gv1 + 0.2),
    box(ctx, Pa.u0 - 0.05, Bk.v1, G.u0, Bk.v1 + 0.05), box(ctx, G.u1, Bk.v1, Pa.u1 + 0.05, Bk.v1 + 0.05)];
  reset(ctx);
  g.visible = false;
}

function reset(ctx) {
  const st = ctx.state;
  Object.assign(st, { t: 0, stretch: 0, maxV: 0, revealed: false, keyTaken: false, eye: null, inWater: false, under: false, breath: 1, drowned: false,
    watch: null, watchGone: false, log: [], surfacedAfterKey: false, farLog: [] });
  applyReveal(ctx, false);
  setStretch(ctx, 0);
}
function applyReveal(ctx, on) {
  const st = ctx.state;
  st.revealed = on;
  st.U.uRevealed.value = on ? 1 : 0;
  st.plugN.visible = on; st.colPlugN.disabled = !on;
  st.plugS.visible = !on; st.colPlugS.disabled = on;
  st.backMesh.visible = on; for (const c of st.colBack) c.disabled = !on;
}
function setStretch(ctx, d) {
  const st = ctx.state;
  st.stretch = d;
  st.U.uStretch.value = d; st.U.uStretchF.value = d;
  for (const c of [st.colW, st.colE]) c.maxZ = Z(HL.v1 + d);
  for (const c of [...st.colS, st.colPlugS]) { c.minZ = Z(HL.v1 + d); c.maxZ = Z(HL.v1 + d + 0.2); }
  // 灯り(伸びる側はずらす。戻りの通路の灯りは反転の後だけ)
  st.lights.forEach((l, i) => {
    const on = !l.back || st.revealed;
    st.U.uLP.value[i].set(X(l.p[0]), Y(l.p[1]), Z(l.p[2] + (l.str ? d : 0)), on ? l.r : 0);
    st.U.uLC.value[i].set(l.c[0] * l.k, l.c[1] * l.k, l.c[2] * l.k);
  });
}

export function enter(ctx) {
  reset(ctx);
  // 鍵を取った後にもう一度入った時は、ふつうのプール(北の入口から戻れる。反転も管理人も起きない)
  const s = ctx.story; ctx.state.keyBefore = !!(s && s.taken && s.taken.has('k105'));
  ctx.state.log.push({ t: 0, ev: 'enter', keyBefore: ctx.state.keyBefore });
}
export function leave(ctx) {
  const st = ctx.state, pl = ctx.player;
  pl.move = null;
  if (ctx.hud) ctx.hud.setBreath(null);
  setUnderAudio(ctx, false);
  stopAmbience(ctx);
  if (st.watch && ctx.ai && ctx.ai.level === ctx.key) { ctx.ai.concealed = true; }
}
export function dispose(ctx) {
  for (const o of [...ctx.group.children]) { ctx.group.remove(o); o.traverse((m) => { if (m.geometry) m.geometry.dispose(); }); }
  if (ctx.state.mat) ctx.state.mat.dispose();
  if (ctx.state.water) ctx.state.water.dispose();
  if (ctx.state.U) ctx.state.U.uCaus.value.dispose();
  ctx.cols.length = 0; ctx.lamps.length = 0;
}

// ================================================================ 毎フレーム
const inPool = (u, v, d, m = 0) => u > P.u0 + m && u < P.u1 - m && v > P.v0 + m && v < P.v1 + d - m;
const lv = (v, d) => (v > X312.cut + d ? v - d : Math.min(v, X312.cut));   // 伸びた分を戻した v(底の深さを引く時)

export function update(dt, ctx) {
  const st = ctx.state, U = st.U, pl = ctx.player, S = X312.swim;
  st.t += dt; U.uTime.value += dt;
  const u = pl.pos.x - OX, v = pl.pos.z - OZ;
  const busy = ctx.busy ? ctx.busy() : false;
  // 鍵(物語の pickups)
  const s = ctx.story;
  const keyNow = !st.keyBefore && !!(s && s.taken && s.taken.has('k105'));
  if (keyNow && !st.keyTaken) { st.keyTaken = true; st.log.push({ t: st.t, ev: 'key', v, far: +(HL.v1 + st.stretch - v).toFixed(2) }); }
  // ② 伸びる: 鍵を取る前、水の中で南へ進んだ分だけ奥がずれる。取ったら戻る
  const d0 = st.stretch;
  if (!st.keyTaken) {
    if (st.inWater) st.maxV = Math.max(st.maxV, v);
    const want = Math.min(X312.stretch.max, Math.max(0, X312.stretch.k * (st.maxV - X312.stretch.from)));
    if (want > st.stretch) setStretch(ctx, want);
  } else if (st.stretch > 0) {
    setStretch(ctx, Math.max(0, st.stretch - Math.max(st.stretch * X312.stretch.back, 2.5) * dt));   // 1 秒ほどで元の大きさへ
  }
  if (d0 !== st.stretch && st.farLog.length < 6000) st.farLog.push([+st.t.toFixed(2), +v.toFixed(2), +(HL.v1 + st.stretch - v).toFixed(2)]);
  // ③ 反転: 鍵を取って奥が元に戻ったら(水の中・霧の中なので見えない)
  if (st.keyTaken && !st.revealed && st.stretch === 0) { applyReveal(ctx, true); setStretch(ctx, 0); st.log.push({ t: st.t, ev: 'reveal', under: st.under }); }
  // 泳ぎ・潜水(目の高さ・速さ・息)
  const d = st.stretch;
  const water = inPool(u, v, d);
  const deckEye = SPACE_Y + 1.62;
  const wy = SPACE_Y + WY;
  if (st.eye === null) st.eye = deckEye;
  let target, rate, speed = null;
  if (water) {
    const floorY = SPACE_Y + poolFloorY(lv(v, d));
    const stand = floorY + 1.62, flt = wy + S.floatEye;
    const rest = Math.max(stand, flt);
    const dive = Math.min(rest, floorY + S.diveEye);
    const diving = (pl.keys.has('ControlLeft') || pl.keys.has('ControlRight')) && !busy;   // P4a-2: しゃがみ廃止。Ctrl の押下そのもの(水の外では何もしない)
    target = diving ? dive : rest + (stand < flt ? Math.sin(st.t * 1.2) * S.bob : 0);
    rate = !st.inWater ? S.enter : diving ? S.down : S.up;
    speed = st.eye < wy - 0.05 ? S.under : stand >= flt ? S.wade : S.swim;
    if (!st.inWater) { st.log.push({ t: st.t, ev: 'enter_water', v }); sfx(ctx, 'splash'); }
    st.inWater = true;
  } else {
    target = deckEye; rate = st.inWater || Math.abs(st.eye - deckEye) > 0.05 ? S.climb : 50;
    if (st.inWater) st.log.push({ t: st.t, ev: 'leave_water', v });
    st.inWater = false;
  }
  if (!busy) st.eye += THREE.MathUtils.clamp(target - st.eye, -rate * dt, rate * dt);
  // 潜っている間は水の外へ出ない(浮上してから上がる)
  if (st.eye < wy - 0.25 && !inPool(u, v, d, S.inset)) {
    pl.pos.x = THREE.MathUtils.clamp(pl.pos.x, X(P.u0 + S.inset), X(P.u1 - S.inset));
    pl.pos.z = THREE.MathUtils.clamp(pl.pos.z, Z(P.v0 + S.inset), Z(P.v1 + d - S.inset));
  }
  const settled = !water && Math.abs(st.eye - deckEye) < 0.01;
  pl.move = settled ? null : { speed: speed ?? (water ? S.swim : 0.9), eyeY: st.eye, noRun: true, noBob: true };
  const under = ctx.camera.position.y < wy;
  if (under !== st.under) {
    st.under = under;
    st.log.push({ t: st.t, ev: under ? 'dive' : 'surface', v });
    setUnderAudio(ctx, under);
    if (!under) sfx(ctx, 'gasp');
    if (!under && st.keyTaken && !st.watch) placeWatcher(ctx);
  }
  // 息
  const B = X312.breath;
  if (under && !busy) st.breath = Math.max(0, st.breath - dt / B.max);
  else if (!under) st.breath = Math.min(1, st.breath + dt / B.refill);
  if (ctx.hud) ctx.hud.setBreath(under && !st.drowned ? st.breath : null);
  if (under && st.breath <= 0 && !st.drowned && ctx.kill) { st.drowned = true; st.log.push({ t: st.t, ev: 'drown' }); sfx(ctx, 'drown'); ctx.kill('drown'); }
  // 霧(ホールの青い霧・水の中は濃いティール)
  const F = under ? X312.fog.under : v < HL.v0 || v > HL.v1 + d ? X312.fog.passage : X312.fog.hall;
  if (ctx.scene.fog) { ctx.scene.fog.color.setHex(F[0]); ctx.scene.fog.density = F[1]; }
  // 管理人(見ているだけ): 浮上した時の視線の先のプールサイド。戻りの通路に入ると消える
  if (st.watch && ctx.ai && ctx.ai.level === ctx.key && !st.watchGone) {
    const e = ctx.ai.enemy;
    const want = Math.atan2(pl.pos.x - e.pos.x, pl.pos.z - e.pos.z);
    let dy = want - e.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    e.yaw += THREE.MathUtils.clamp(dy, -1.2 * dt, 1.2 * dt);
    e.speed = 0;
    if (st.revealed && v > HL.v1 + 0.4) { st.watchGone = true; ctx.ai.concealed = true; st.log.push({ t: st.t, ev: 'watch_gone' }); }
  }
  ambience(ctx, dt);
}

// 鍵を取って浮上した時: 視線の先のプールの縁から 1.2m 外のデッキに管理人を置く(SCRIPTED = 何も感じない・襲わない)
function placeWatcher(ctx) {
  const st = ctx.state, ai = ctx.ai, pl = ctx.player;
  if (!ai || !(ctx.story && ctx.story.aiControl)) return;
  const fwd = new THREE.Vector3(); ctx.camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  const u = pl.pos.x - OX, v = pl.pos.z - OZ;
  let t = 1e9;
  if (fwd.x > 1e-4) t = Math.min(t, (P.u1 - u) / fwd.x); if (fwd.x < -1e-4) t = Math.min(t, (P.u0 - u) / fwd.x);
  if (fwd.z > 1e-4) t = Math.min(t, (P.v1 - v) / fwd.z); if (fwd.z < -1e-4) t = Math.min(t, (P.v0 - v) / fwd.z);
  let eu = u + fwd.x * t, ev = v + fwd.z * t;
  const W = X312.watch;
  // 縁の外向きへ
  if (Math.abs(eu - P.u1) < 1e-3) eu += W.dist; else if (Math.abs(eu - P.u0) < 1e-3) eu -= W.dist; else if (Math.abs(ev - P.v1) < 1e-3) ev += W.dist; else ev -= W.dist;
  eu = THREE.MathUtils.clamp(eu, HL.u0 + 0.6, HL.u1 - 0.6); ev = THREE.MathUtils.clamp(ev, HL.v0 + 0.6, HL.v1 - 0.6);
  if (ev > P.v1 - 0.5 && Math.abs(eu - 0.8) < 1.7) eu = eu < 0.8 ? -1.1 : 2.7;   // 戻りの口(南)とそこへ上がる道はふさがない
  if (ev < P.v0 + 0.5 && Math.abs(eu - 0.8) < 1.7) eu = eu < 0.8 ? -1.1 : 2.7;
  if (Math.hypot(eu - u, ev - v) < W.minDist) ev += ev > v ? W.minDist : -W.minDist;
  ev = THREE.MathUtils.clamp(ev, HL.v0 + 0.6, HL.v1 - 0.6);
  ai.uninterruptible = false;
  ai.setState('SCRIPTED', { force: true, log: true });
  if (ai.level !== ctx.key) ai.setLevel(ctx.key);
  ai.dormant = false; ai.concealed = false; ai.transit = false; ai.chaseOmni = false;
  const e = ai.enemy;
  e.place(X(eu), Z(ev), Math.atan2(pl.pos.x - X(eu), pl.pos.z - Z(ev)));
  e.setFlashlight(false);
  e.setFace('grin', 0.25, true);
  e.play('look_idle', { fade: 0.2, timeScale: 0, restart: true });
  e.speed = 0;
  st.watch = { u: eu, v: ev };
  ai.log('watch_312', { x: +X(eu).toFixed(2), z: +Z(ev).toFixed(2) });
  st.log.push({ t: st.t, ev: 'watch', u: +eu.toFixed(2), v: +ev.toFixed(2) });
}

// ================================================================ 物語とのつなぎ
export function exits(ctx) {
  const st = ctx.state;
  if (!st.revealed) return [{ x: X(0.8), z: Z(0.02), n: [0, 1], auto: true, reach: 1.3, depth: 0.45, half: 0.6, onLeave: () => onLeave(ctx) }];
  return [{ x: X(0.8), z: Z(X312.back.gv1 - 0.02), n: [0, -1], auto: true, reach: 1.3, depth: 0.45, half: 0.6, onLeave: () => onLeave(ctx) }];
}
function onLeave(ctx) {
  const st = ctx.state;
  st.log.push({ t: st.t, ev: 'leave' });
  if (st.watch && ctx.ai && ctx.ai.level === ctx.key && ctx.story && ctx.story.onAIReset) ctx.story.onAIReset();
}
// 鍵は潜って底の近くにいる時だけ拾える
export function canPick(ctx, slot, cam) { return slot !== 'key' || cam.y < SPACE_Y + DEF.slots.key[1] + 1.25; }

// ================================================================ 仮音(P4 で録音に差し替え。名前は docs/p5b2a/NOTES.md §5)
function actx(ctx) { const a = ctx.audio && ctx.audio.ctx; return a && a.state === 'running' ? a : null; }
function setUnderAudio(ctx, on) {
  const L = ctx.audio && ctx.audio.listener; if (!L) return;
  const st = ctx.state;
  if (on && !st.lp) { const c = L.context; st.lp = c.createBiquadFilter(); st.lp.type = 'lowpass'; st.lp.frequency.value = 420; st.lp.Q.value = 0.7; try { L.setFilter(st.lp); } catch (e) { void e; } }
  else if (!on && st.lp) { try { L.removeFilter(); } catch (e) { void e; } st.lp = null; }
}
function noiseBuf(c, sec) { const b = c.createBuffer(1, Math.ceil(c.sampleRate * sec), c.sampleRate), a = b.getChannelData(0); for (let i = 0; i < a.length; i++) a[i] = Math.random() * 2 - 1; return b; }
function ambience(ctx, dt) {
  const c = actx(ctx), st = ctx.state; if (!c) return;
  if (!st.amb) {   // x312_pool_room_loop_01(水の循環のこもった音)・x312_underwater_loop_01(水の中の低いうなり)
    const out = ctx.audio.listener.getInput();
    const src = c.createBufferSource(); src.buffer = noiseBuf(c, 4); src.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 0.6;
    const g = c.createGain(); g.gain.value = 0.0;
    src.connect(bp); bp.connect(g); g.connect(out); src.start();
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = 52; const og = c.createGain(); og.gain.value = 0; o.connect(og); og.connect(out); o.start();
    st.amb = { src, g, o, og };
  }
  const k = Math.min(1, dt * 3);
  const room = st.under ? 0.0 : 0.05, hum = st.under ? 0.16 : 0.02;
  st.amb.g.gain.value += (room - st.amb.g.gain.value) * k;
  st.amb.og.gain.value += (hum - st.amb.og.gain.value) * k;
}
function stopAmbience(ctx) { const st = ctx.state; if (!st.amb) return; try { st.amb.src.stop(); st.amb.o.stop(); } catch (e) { void e; } st.amb = null; }
function sfx(ctx, name) {
  const st = ctx.state; st.sfx = st.sfx || []; st.sfx.push(name);
  const c = actx(ctx); if (!c) return;
  const out = ctx.audio.listener.getInput(), now = c.currentTime;
  const burst = (dur, f, q, vol, at = 0) => { const s = c.createBufferSource(); s.buffer = noiseBuf(c, dur); const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q; const g = c.createGain(); g.gain.setValueAtTime(vol, now + at); g.gain.exponentialRampToValueAtTime(0.0001, now + at + dur); s.connect(bp); bp.connect(g); g.connect(out); s.start(now + at); };
  if (name === 'splash') { burst(0.5, 900, 0.8, 0.35); burst(0.3, 2400, 1.2, 0.12, 0.05); }   // x312_splash_in_01
  else if (name === 'gasp') burst(0.35, 1500, 2.0, 0.12);                                      // x312_surface_gasp_01
  else if (name === 'drown') burst(1.2, 300, 0.7, 0.4);                                         // x312_drown_01
}

// テスト・スクショ用
export function debug(ctx) {
  const st = ctx.state;
  return {
    X312, st,
    state: () => ({ inWater: st.inWater, under: st.under, eye: st.eye && +(st.eye - SPACE_Y).toFixed(3), breath: +st.breath.toFixed(3), stretch: +st.stretch.toFixed(3),
      farWall: +(HL.v1 + st.stretch).toFixed(3), keyTaken: st.keyTaken, revealed: st.revealed, watch: st.watch, watchGone: st.watchGone, drowned: st.drowned, log: st.log.slice(-30) }),
    local: (x, z) => ({ u: x - OX, v: z - OZ }), world: (u, v) => ({ x: X(u), z: Z(v) }),
  };
}
