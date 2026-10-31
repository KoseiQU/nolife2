// attack_movie.js — 襲撃ムービー(P2c, DESIGN §3.4.1「襲撃はムービー」)。
//  ATTACK 開始: 入力を止め、カメラをプレイヤーの頭の位置に固定して管理人の顔へ向け、0.3 秒で寄る
//  (FOV 68°→44°、少し下げて見上げる構図=上半身が画面いっぱい・顔が中央)。顔だけに補助光(enemy.faceFill)。
//  振り下ろしのヒット: ①画面に飛ぶ飛沫(2D キャンバス→最終段の ShaderPass で合成)②レンズを伝う赤い滴(同)
//  ③3D の血煙(Points)＋カメラの衝撃。その後の暗転・「見つかった」・復帰は main.js の死亡演出。
// update(dt) 駆動(rAF 非依存)。描画結果は renderer の canvas に入るので toDataURL のスクリーンショットにも写る。

import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export const MOVIE = {
  zoomTime: 0.3,
  fovFrom: 68,
  fovTo: 44,
  pushIn: 0.25,        // 寄る距離(m)
  lower: 0.12,         // カメラを下げる量(見上げる構図)
  faceFill: 1.4,       // 顔の補助光の強さ
  spatter: 34,         // 画面の飛沫の数(20〜40)
  drips: 8,            // レンズを伝う滴の数
  mist: 70,            // 3D 血煙の粒の数
  bloodW: 960, bloodH: 540,
};

export class AttackMovie {
  constructor({ camera, player, enemy, scene, audio }) {
    this.camera = camera;
    this.player = player;
    this.enemy = enemy;
    this.scene = scene;
    this.audio = audio;
    this.active = false;
    this.t = 0;
    this.hitT = -1;
    this.blood = new BloodOverlay(MOVIE.bloodW, MOVIE.bloodH);
    this.pass = this.blood.pass;
    this.mist = new BloodMist(scene, MOVIE.mist);
    this._look = new THREE.Vector3();
  }

  start() {
    if (this.active) return;
    const cam = this.camera;
    this.saved = { pos: cam.position.clone(), quat: cam.quaternion.clone(), fov: cam.fov, frozen: this.player.frozen, flash: this.player.flashlight.visible };
    this.player.frozen = true;
    this.active = true;
    this.t = 0;
    this.hitT = -1;
    this.eye = cam.position.clone();
    this._look.copy(this._faceTarget(new THREE.Vector3()));
    this.blood.clear();
  }

  _faceTarget(out) {
    // Head 骨は後頭部寄りの付け根 → 少し上・前を顔の中心にする
    this.enemy.headWorld(out);
    const f = this.enemy.forward(new THREE.Vector3());
    return out.add(new THREE.Vector3(f.x * 0.06, 0.07, f.z * 0.06));
  }

  hit() {
    if (!this.active) this.start();
    this.hitT = this.t;
    this.blood.splash();
    const cam = this.camera;
    const fwd = cam.getWorldDirection(new THREE.Vector3());
    this.mist.burst(cam.position.clone().addScaledVector(fwd, 0.45), fwd);
    if (this.audio) this.audio.play('hit', cam.position.clone().addScaledVector(fwd, 0.3), 1.0);
  }

  update(dt) {
    this.mist.update(dt);
    if (!this.active) return;
    this.t += dt;
    const cam = this.camera;
    const k = smooth(Math.min(1, this.t / MOVIE.zoomTime));
    const target = this._faceTarget(new THREE.Vector3());
    this._look.lerp(target, 1 - Math.exp(-dt * 30));   // 顔を画面の中央に保つ(振りかぶりで頭が動く)
    const toFace = target.clone().sub(this.eye); toFace.y = 0;
    const d = toFace.length(); if (d > 1e-4) toFace.divideScalar(d);
    cam.position.copy(this.eye).addScaledVector(toFace, Math.min(MOVIE.pushIn, Math.max(0, d - 0.75)) * k);
    cam.position.y -= MOVIE.lower * k;
    cam.fov = MOVIE.fovFrom + (MOVIE.fovTo - MOVIE.fovFrom) * k;
    cam.updateProjectionMatrix();
    cam.up.set(0, 1, 0);
    cam.lookAt(this._look);
    // ヒットの衝撃: 下へ沈み、傾き、短く揺れる
    if (this.hitT >= 0) {
      const th = this.t - this.hitT;
      const sink = 1 - Math.exp(-th * 7);
      cam.position.y -= 0.28 * sink;
      const shake = Math.exp(-th * 9) * 0.03;
      cam.position.x += (Math.random() - 0.5) * shake;
      cam.position.z += (Math.random() - 0.5) * shake;
      cam.rotateZ(0.32 * sink);
      cam.rotateX(-0.12 * sink);
    }
    cam.updateMatrixWorld();
    this.player.flashlight.visible = this.player.flashlightOn;
    this.enemy.faceFill = MOVIE.faceFill * k * (this.hitT >= 0 ? Math.max(0, 1 - (this.t - this.hitT) * 1.5) : 1);
    this.blood.update(dt);
  }

  end() {
    if (!this.active) { this.blood.clear(); return; }
    const cam = this.camera, s = this.saved;
    cam.fov = s.fov;
    cam.updateProjectionMatrix();
    this.player.frozen = false;
    this.active = false;
    this.enemy.faceFill = 0;
    this.blood.clear();
    this.mist.reset();
  }
}

function smooth(x) { return x * x * (3 - 2 * x); }

// ------------------------------------------------------------ 画面の血(飛沫＋垂れる滴)
class BloodOverlay {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.canvas = document.createElement('canvas');
    this.canvas.width = w; this.canvas.height = h;
    this.g = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.generateMipmaps = false;
    this.drops = [];
    this.drips = [];
    this.rand = mulberry(7);
    this.pass = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, tBlood: { value: this.tex }, amount: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform sampler2D tBlood; uniform float amount; varying vec2 vUv;
        void main(){
          vec4 b = texture2D(tBlood, vUv);
          // 血の膜越しに少し歪む(レンズに付いた液体)
          vec2 off = (b.a > 0.01) ? vec2(dFdx(b.a), dFdy(b.a)) * 6.0 : vec2(0.0);
          vec4 c = texture2D(tDiffuse, vUv + off);
          float a = b.a * amount;
          vec3 col = mix(c.rgb, b.rgb, a);
          // 膜の縁にわずかなハイライト
          col += vec3(0.25, 0.08, 0.06) * clamp(length(off) * 30.0, 0.0, 1.0) * a;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.pass.enabled = false;
  }

  clear() {
    this.g.clearRect(0, 0, this.w, this.h);
    this.drops.length = 0;
    this.drips.length = 0;
    this.tex.needsUpdate = true;
    this.pass.enabled = false;
  }

  splash() {
    const R = this.rand, W = this.w, H = this.h;
    this.pass.enabled = true;
    // 衝撃点は画面の中央上寄り(振り下ろされたハンマー)
    const cx = W * (0.45 + R() * 0.1), cy = H * (0.38 + R() * 0.08);
    for (let i = 0; i < MOVIE.spatter; i++) {
      const a = R() * Math.PI * 2;
      const sp = 250 + R() * 900;
      this.drops.push({ x: cx + (R() - 0.5) * 80, y: cy + (R() - 0.5) * 50, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.7 - 120,
        r: 2.5 + R() ** 2 * 12, land: 0.02 + R() * 0.09, t: 0 });
    }
    // 大きな塊を中央付近に数個
    for (let i = 0; i < 4; i++) this._blot(cx + (R() - 0.5) * W * 0.35, cy + (R() - 0.5) * H * 0.3, 14 + R() * 22, true);
    this.tex.needsUpdate = true;
  }

  _color(alpha) {
    const R = this.rand;
    const r = 95 + (R() * 50) | 0, g = (R() * 8) | 0, b = (R() * 10) | 0;
    return `rgba(${r},${g},${b},${alpha})`;
  }

  _blot(x, y, r, maybeDrip) {
    const g = this.g, R = this.rand;
    g.save();
    g.shadowColor = 'rgba(50,0,0,0.6)'; g.shadowBlur = 3;
    // 塊: 少しずつずらした楕円を重ねていびつにし、縁を濃く・中心をわずかに明るく(液体の厚み)
    for (let k = 0; k < 3 + (R() * 3 | 0); k++) {
      const ox = (R() - 0.5) * r * 0.8, oy = (R() - 0.5) * r * 0.8, rr = r * (0.55 + R() * 0.5);
      const gr = g.createRadialGradient(x + ox - rr * 0.2, y + oy - rr * 0.2, 0, x + ox, y + oy, rr);
      gr.addColorStop(0, 'rgba(138,8,6,0.82)'); gr.addColorStop(0.75, 'rgba(96,0,0,0.9)'); gr.addColorStop(1, 'rgba(60,0,0,0.95)');
      g.fillStyle = gr;
      g.beginPath(); g.ellipse(x + ox, y + oy, rr, rr * (0.7 + R() * 0.5), R() * Math.PI, 0, Math.PI * 2); g.fill();
    }
    // 周りの細かい点
    g.fillStyle = this._color(0.85);
    for (let k = 0; k < 3 + (R() * 6 | 0); k++) {
      const a = R() * Math.PI * 2, d = r * (1.1 + R() * 1.6);
      g.beginPath(); g.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, 0.8 + R() * r * 0.18, 0, Math.PI * 2); g.fill();
    }
    // 濡れた照り
    if (r > 5) { g.shadowBlur = 0; g.fillStyle = 'rgba(255,170,160,0.28)'; g.beginPath(); g.ellipse(x - r * 0.3, y - r * 0.35, r * 0.22, r * 0.12, -0.6, 0, Math.PI * 2); g.fill(); }
    g.restore();
    if (maybeDrip && this.drips.length < MOVIE.drips && r > 5) {
      this.drips.push({ x, y: y + r * 0.6, y0: y, w: Math.max(2.5, r * 0.45), v: 120 + R() * 140, len: 90 + R() * 260, t: 0, wob: R() * 6 });
    }
  }

  update(dt) {
    if (!this.pass.enabled) return;
    const g = this.g;
    let dirty = false;
    for (const d of this.drops) {
      if (d.done) continue;
      const x0 = d.x, y0 = d.y;
      d.t += dt;
      d.vy += 1600 * dt;
      d.x += d.vx * dt; d.y += d.vy * dt;
      g.strokeStyle = this._color(0.55);
      g.lineWidth = Math.max(1.5, d.r * 0.9);
      g.lineCap = 'round';
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(d.x, d.y); g.stroke();
      if (d.t >= d.land) { d.done = true; this._blot(d.x, d.y, d.r, true); }
      dirty = true;
    }
    for (const d of this.drips) {
      if (d.t > 1.0) continue;
      d.t += dt;
      const yPrev = d.y;
      d.v *= Math.exp(-dt * 1.6);
      d.y = Math.min(d.y0 + d.len, d.y + d.v * dt);
      const x = d.x + Math.sin(d.y * 0.05 + d.wob) * 1.5;
      g.strokeStyle = this._color(0.85);
      g.lineWidth = d.w * (1 - Math.min(0.5, d.t * 0.3));
      g.lineCap = 'round';
      g.beginPath(); g.moveTo(x, yPrev); g.lineTo(x, d.y); g.stroke();
      g.fillStyle = this._color(0.9);
      g.beginPath(); g.arc(x, d.y, d.w * 0.75, 0, Math.PI * 2); g.fill();
      dirty = true;
    }
    if (dirty) this.tex.needsUpdate = true;
  }
}

// ------------------------------------------------------------ 3D の血煙
class BloodMist {
  constructor(scene, n) {
    this.n = n;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const sprite = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d');
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();
    this.mat = new THREE.PointsMaterial({ color: 0x4a0202, size: 0.07, map: sprite, transparent: true, opacity: 0, depthWrite: false, sizeAttenuation: true });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.points.renderOrder = 20;
    scene.add(this.points);
    this.t = 0;
    this.rand = mulberry(99);
  }
  burst(center, fwd) {
    const R = this.rand;
    for (let i = 0; i < this.n; i++) {
      this.pos[i * 3] = center.x + (R() - 0.5) * 0.25;
      this.pos[i * 3 + 1] = center.y + (R() - 0.5) * 0.2;
      this.pos[i * 3 + 2] = center.z + (R() - 0.5) * 0.25;
      const sp = 0.8 + R() * 2.6;
      const dx = (R() - 0.5) * 2 + fwd.x * 0.6, dy = R() * 1.2 + 0.2, dz = (R() - 0.5) * 2 + fwd.z * 0.6;
      const L = Math.hypot(dx, dy, dz);
      this.vel[i * 3] = dx / L * sp; this.vel[i * 3 + 1] = dy / L * sp; this.vel[i * 3 + 2] = dz / L * sp;
      this.life[i] = 0.5 + R() * 0.5;
    }
    this.t = 0;
    this.points.visible = true;
    this.points.geometry.attributes.position.needsUpdate = true;
  }
  update(dt) {
    if (!this.points.visible) return;
    this.t += dt;
    for (let i = 0; i < this.n; i++) {
      this.vel[i * 3 + 1] -= 6.0 * dt;
      const drag = Math.exp(-dt * 2.5);
      this.vel[i * 3] *= drag; this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.mat.opacity = Math.max(0, 0.85 * (1 - this.t / 0.9));
    this.mat.size = 0.05 + this.t * 0.12;     // 霧のように広がる
    if (this.t > 0.95) this.points.visible = false;
  }
  reset() { this.points.visible = false; this.t = 0; }
}

function mulberry(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
