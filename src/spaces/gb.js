// spaces/gb.js — P5b-2b: 別空間のジオメトリを組む小さな道具(705・B1 で共用。105・312 は自前の同じ形の GB を持つ)。
//  世界座標で面を足していき、1 つの BufferGeometry にまとめる。頂点の属性: position・normal・aSurf(面の種類)・aCol(色。小物用)・aC(任意の 4 値)
//  面の種類・色・aC は「今の値」(this.surf・this.col・this.c)を足す時に写す。

import * as THREE from 'three';

export class GB {
  constructor() { this.p = []; this.n = []; this.s = []; this.k = []; this.cc = []; this.i = []; this.surf = 0; this.col = [1, 1, 1]; this.c = [0, 0, 0, 0]; }
  _v(x, y, z, N) { this.p.push(x, y, z); this.n.push(N[0], N[1], N[2]); this.s.push(this.surf); this.k.push(this.col[0], this.col[1], this.col[2]); this.cc.push(this.c[0], this.c[1], this.c[2], this.c[3]); }
  // 平行四辺形 o + U·a + V·b(nu × nv に分割)。N は表の向き
  quad(o, U, V, N, nu = 1, nv = 1) {
    const base = this.p.length / 3;
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const a = i / nu, b = j / nv;
      this._v(o[0] + U[0] * a + V[0] * b, o[1] + U[1] * a + V[1] * b, o[2] + U[2] * a + V[2] * b, N);
    }
    const c = [U[1] * V[2] - U[2] * V[1], U[2] * V[0] - U[0] * V[2], U[0] * V[1] - U[1] * V[0]];
    const flip = c[0] * N[0] + c[1] * N[1] + c[2] * N[2] < 0;
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = base + j * (nu + 1) + i, b = a + 1, cc = a + nu + 1, d = cc + 1;
      if (!flip) this.i.push(a, b, d, a, d, cc); else this.i.push(a, d, b, a, cc, d);
    }
  }
  floor(x0, x1, z0, z1, y, up = true, nu = 1, nv = 1) { this.quad([x0, y, z0], [x1 - x0, 0, 0], [0, 0, z1 - z0], [0, up ? 1 : -1, 0], nu, nv); }
  wallX(x, z0, z1, y0, y1, nx, nu = 1) { this.quad([x, y0, z0], [0, 0, z1 - z0], [0, y1 - y0, 0], [nx, 0, 0], nu, 1); }
  wallZ(z, x0, x1, y0, y1, nz, nu = 1) { this.quad([x0, y0, z], [x1 - x0, 0, 0], [0, y1 - y0, 0], [0, 0, nz], nu, 1); }
  box(x0, y0, z0, x1, y1, z1, faces = 'px nx py ny pz nz') {
    const f = faces.split(' '), dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    if (f.includes('px')) this.quad([x1, y0, z0], [0, 0, dz], [0, dy, 0], [1, 0, 0]);
    if (f.includes('nx')) this.quad([x0, y0, z0], [0, 0, dz], [0, dy, 0], [-1, 0, 0]);
    if (f.includes('py')) this.quad([x0, y1, z0], [dx, 0, 0], [0, 0, dz], [0, 1, 0]);
    if (f.includes('ny')) this.quad([x0, y0, z0], [dx, 0, 0], [0, 0, dz], [0, -1, 0]);
    if (f.includes('pz')) this.quad([x0, y0, z1], [dx, 0, 0], [0, dy, 0], [0, 0, 1]);
    if (f.includes('nz')) this.quad([x0, y0, z0], [dx, 0, 0], [0, dy, 0], [0, 0, -1]);
  }
  // 中心 (cx, cy, cz)・大きさ・回転(y → x の順)の箱(小物)
  rbox(cx, cy, cz, sx, sy, sz, ry = 0, rx = 0, rz = 0) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(cx, cy, cz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(1, 1, 1));
    this.addGeo(new THREE.BoxGeometry(sx, sy, sz), m);
  }
  // 既存のジオメトリ(位置・法線)を今の面の種類・色で足す。m = 置く行列(任意)
  addGeo(g, m = null) {
    g = g.index ? g.toNonIndexed() : g.clone();
    if (m) g.applyMatrix4(m);
    const base = this.p.length / 3, pa = g.attributes.position, na = g.attributes.normal;
    for (let k = 0; k < pa.count; k++) { this._v(pa.getX(k), pa.getY(k), pa.getZ(k), [na.getX(k), na.getY(k), na.getZ(k)]); this.i.push(base + k); }
    g.dispose();
  }
  get count() { return this.p.length / 3; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('aSurf', new THREE.Float32BufferAttribute(this.s, 1));
    g.setAttribute('aCol', new THREE.Float32BufferAttribute(this.k, 3));
    g.setAttribute('aC', new THREE.Float32BufferAttribute(this.cc, 4));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}

// 種のある乱数(テストで決定的に)
export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// シェーダの共通部品(ハッシュ・値ノイズ)
export const GLSL_NOISE = `
  float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
`;

// 仮音の道具(WebAudio。動いている時だけ)
export function actx(ctx) { const a = ctx.audio && ctx.audio.ctx; return a && a.state === 'running' ? a : null; }
export function noiseBuf(c, sec) { const b = c.createBuffer(1, Math.ceil(c.sampleRate * sec), c.sampleRate), a = b.getChannelData(0); for (let i = 0; i < a.length; i++) a[i] = Math.random() * 2 - 1; return b; }
export function burst(ctx, dur, f, q, vol, at = 0, type = 'bandpass') {
  const c = actx(ctx); if (!c) return;
  const out = ctx.audio.listener.getInput(), now = c.currentTime;
  const s = c.createBufferSource(); s.buffer = noiseBuf(c, dur);
  const bp = c.createBiquadFilter(); bp.type = type; bp.frequency.value = f; bp.Q.value = q;
  const g = c.createGain(); g.gain.setValueAtTime(vol, now + at); g.gain.exponentialRampToValueAtTime(0.0001, now + at + dur);
  s.connect(bp); bp.connect(g); g.connect(out); s.start(now + at);
}
export function tone(ctx, f0, f1, dur, vol, type = 'sine', at = 0) {
  const c = actx(ctx); if (!c) return;
  const out = ctx.audio.listener.getInput(), now = c.currentTime;
  const o = c.createOscillator(), g = c.createGain(); o.type = type;
  o.frequency.setValueAtTime(f0, now + at); o.frequency.exponentialRampToValueAtTime(f1, now + at + dur);
  g.gain.setValueAtTime(0.0001, now + at); g.gain.exponentialRampToValueAtTime(vol, now + at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, now + at + dur);
  o.connect(g); g.connect(out); o.start(now + at); o.stop(now + at + dur + 0.05);
}
