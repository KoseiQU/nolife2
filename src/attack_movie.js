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
  fallFrom: 0.55, fallTo: 0.85, fallDrop: 0.45,   // ヒット直前から視点が沈む(下から見上げる)
  spatter: 170,        // 画面の飛沫の数(大小。大きいものほど少ない)
  drips: 9,            // 下へ垂れる筋の数
  mist: 26,            // 3D 血煙(霧状スプライト)の数
  bloodW: 1280, bloodH: 720,
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
    // ヒット後も顔を追い続ける(急な振りは時定数 0.15s で平滑化)。注視点を顔の少し下に置き、顔を中央〜やや上に保つ
    target.y -= 0.06;
    this._look.lerp(target, 1 - Math.exp(-dt / 0.15));
    const toFace = target.clone().sub(this.eye); toFace.y = 0;
    const d = toFace.length(); if (d > 1e-4) toFace.divideScalar(d);
    cam.position.copy(this.eye).addScaledVector(toFace, Math.min(MOVIE.pushIn, Math.max(0, d - 0.75)) * k);
    cam.position.y -= MOVIE.lower * k;
    // 振り下ろしに合わせて崩れ落ちる(0.55→0.85 秒で 0.45m 沈む)。前かがみで覗き込む顔を下から見上げ続けるため
    const fall = smooth(Math.min(1, Math.max(0, (this.t - MOVIE.fallFrom) / (MOVIE.fallTo - MOVIE.fallFrom))));
    cam.position.y -= MOVIE.fallDrop * fall;
    cam.position.addScaledVector(toFace, -0.12 * fall);
    cam.fov = MOVIE.fovFrom + (MOVIE.fovTo - MOVIE.fovFrom) * k;
    cam.updateProjectionMatrix();
    cam.up.set(0, 1, 0);
    cam.lookAt(this._look);
    // ヒットの衝撃: 下へ沈み、傾き、短く揺れる
    if (this.hitT >= 0) {
      const th = this.t - this.hitT;
      const sink = 1 - Math.exp(-th * 7);
      cam.position.y -= 0.12 * sink;
      const shake = Math.exp(-th * 9) * 0.03;
      cam.position.x += (Math.random() - 0.5) * shake;
      cam.position.z += (Math.random() - 0.5) * shake;
      cam.rotateZ(0.22 * sink);
    }
    cam.updateMatrixWorld();
    this.player.flashlight.visible = this.player.flashlightOn;
    this.enemy.faceFill = MOVIE.faceFill * k * (this.hitT >= 0 ? Math.max(0, 1 - (this.t - this.hitT) * 1.5) : 1);
    this.blood.update(dt);
  }

  // restore: 空振り(P5b-1b)の時はカメラの向きも襲撃前へ戻す(復帰の時は setPose が置き直すので不要)
  end({ restore = false } = {}) {
    if (!this.active) { this.blood.clear(); return; }
    const cam = this.camera, s = this.saved;
    cam.fov = s.fov;
    cam.updateProjectionMatrix();
    if (restore) { cam.quaternion.copy(s.quat); cam.position.copy(s.pos); this.player.object.rotation.setFromQuaternion(s.quat, 'YXZ'); this.player.object.rotation.z = 0; cam.updateMatrixWorld(); }
    this.player.frozen = false;
    this.active = false;
    this.enemy.faceFill = 0;
    this.blood.clear();
    this.mist.reset();
  }
}

function smooth(x) { return x * x * (3 - 2 * x); }

// ------------------------------------------------------------ 画面の血(レンズに付いた飛沫＋垂れる筋)
// 写実寄せ(P2c 監査): 輪郭線・艶の白点なし。暗い深紅(#5a0a0a〜#8a1010)の半透明で縁の柔らかい不規則な斑点を
// 大小数十〜百個(大きいものほど少なく)、一部は飛んできた向きに細い尾を引く。着弾後、一部から下へ細い筋が垂れる。
// 合成は最終段の ShaderPass(膜の厚みの勾配でわずかに屈折させ、縁だけ少し暗くする)
class BloodOverlay {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.canvas = document.createElement('canvas');
    this.canvas.width = w; this.canvas.height = h;
    this.g = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.generateMipmaps = false;
    this.pending = [];   // 着弾待ちの飛沫(数十 ms ばらつかせて付く)
    this.drips = [];
    this.rand = mulberry(7);
    this.pass = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, tBlood: { value: this.tex }, texel: { value: new THREE.Vector2(1 / w, 1 / h) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform sampler2D tBlood; uniform vec2 texel; varying vec2 vUv;
        void main(){
          vec4 b = texture2D(tBlood, vUv);
          // 膜の厚み(アルファ)の勾配 → 屈折。滴の縁で背景が少しずれて見える
          // 4 テクセル離れた差分(細かい点では勾配がほぼ出ない=大きな滴の縁だけ屈折する)
          float ax = texture2D(tBlood, vUv + vec2(texel.x * 4.0, 0.0)).a - texture2D(tBlood, vUv - vec2(texel.x * 4.0, 0.0)).a;
          float ay = texture2D(tBlood, vUv + vec2(0.0, texel.y * 4.0)).a - texture2D(tBlood, vUv - vec2(0.0, texel.y * 4.0)).a;
          vec2 g = vec2(ax, ay) * smoothstep(0.2, 0.6, b.a);
          vec4 c = texture2D(tDiffuse, vUv - g * 0.006);
          float a = b.a;
          // 血は光を吸う: 背景を暗く沈めてから深紅を乗せる(乗算寄り)
          vec3 under = c.rgb * mix(1.0, 0.25, a);
          vec3 blood = b.rgb * (0.45 + 0.4 * c.rgb);
          blood = mix(blood, vec3(dot(blood, vec3(0.299, 0.587, 0.114))), 0.18);   // 彩度を少し落とす
          vec3 col = mix(under, blood, a * 0.9);
          col += vec3(0.05, 0.02, 0.02) * clamp(length(g) * 2.0, 0.0, 1.0) * c.rgb;   // 大きな滴の縁にごく弱い明るみ(屈折で背景光が寄る)
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    // ShaderPass は uniforms を複製する(テクスチャも複製され needsUpdate が届かない)→ 元のテクスチャを差し直す
    this.pass.uniforms.tBlood.value = this.tex;
    this.pass.enabled = false;
  }

  clear() {
    this.g.clearRect(0, 0, this.w, this.h);
    this.pending.length = 0;
    this.drips.length = 0;
    this.tex.needsUpdate = true;
    this.pass.enabled = false;
  }

  _rgb() {   // #5a0a0a〜#8a1010 の範囲で揺らす(暗く・彩度低め。乾きかけの部分ほど黒い)
    const R = this.rand, k = R();
    return [78 + k * 52 | 0, 8 + R() * 7 | 0, 8 + R() * 6 | 0];
  }

  // 縁の柔らかい楕円(中心ほど濃い)
  _soft(x, y, rx, ry, rot, alpha, rgb) {
    const g = this.g;
    g.save();
    g.translate(x, y); g.rotate(rot); g.scale(1, ry / rx);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
    const [r, gg, b] = rgb;
    gr.addColorStop(0, `rgba(${r * 0.8 | 0},${gg},${b},${alpha})`);
    gr.addColorStop(0.55, `rgba(${r},${gg},${b},${alpha * 0.8})`);
    gr.addColorStop(0.85, `rgba(${r},${gg},${b},${alpha * 0.35})`);
    gr.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    g.fillStyle = gr;
    g.beginPath(); g.arc(0, 0, rx, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  // 1 粒の飛沫: 本体(いびつ)＋飛んできた向きの尾＋周りの霧状の微粒
  _drop(x, y, r, ang, elong) {
    const R = this.rand, rgb = this._rgb();
    const a = 0.55 + R() * 0.35;
    const n = r > 4 ? 4 + (R() * 4 | 0) : r > 2 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      // 大きな滴ほど不規則: 中心からずらした大小の楕円を重ね、縁を波打たせる
      const ox = (R() - 0.5) * r * (k === 0 ? 0.2 : 1.1), oy = (R() - 0.5) * r * (k === 0 ? 0.2 : 1.1);
      const sc = k === 0 ? 1 : 0.3 + R() * 0.45;
      this._soft(x + ox, y + oy, r * sc * (0.75 + R() * 0.4), r * sc * (0.5 + R() * 0.4) / (1 + elong * 0.3), ang + (R() - 0.5) * 1.2, a * (k === 0 ? 1 : 0.75), rgb);
    }
    // 尾: 進行方向へ細く伸び、先ほど細く薄い
    if (elong > 0.4) {
      // 尾: 本体から細く短く、すぐ途切れる(点線状に崩れる)
      const L = r * (1.5 + elong * 2.2), steps = Math.max(3, L / 1.5 | 0);
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        if (t > 0.5 && R() < 0.4) continue;
        const rr = Math.max(0.4, r * 0.28 * (1 - t) ** 1.6);
        this._soft(x + Math.cos(ang) * L * t, y + Math.sin(ang) * L * t, rr * 1.3, rr, ang, a * 0.7 * (1 - t), rgb);
      }
    }
    // 衛星の微粒
    for (let k = 0; k < (r > 4 ? 2 + (R() * 6 | 0) : 0); k++) {
      const aa = ang + (R() - 0.5) * 1.4, d = r * (1.4 + R() * 3);
      this._soft(x + Math.cos(aa) * d, y + Math.sin(aa) * d, 0.6 + R() * r * 0.15, 0.6 + R() * r * 0.12, aa, a * 0.8, rgb);
    }
    if (r > 5 && this.drips.length < MOVIE.drips && R() < 0.55) {
      this.drips.push({ x, y: y + r * 0.4, y0: y, w: Math.max(1.2, r * (0.18 + R() * 0.12)), v: 60 + R() * 90, len: 40 + R() * 200, t: 0, a, rgb, wob: R() * 6 });
    }
  }

  splash() {
    const R = this.rand, W = this.w, H = this.h;
    this.pass.enabled = true;
    const cx = W * (0.42 + R() * 0.16), cy = H * (0.36 + R() * 0.12);
    const s = W / 960;   // 解像度に比例
    const N = MOVIE.spatter;
    // 衝撃点のまわりの薄い血の膜(画面全体が一瞬赤黒く濁る部分)
    this._soft(cx, cy, W * 0.22, H * 0.2, 0, 0.16, [70, 6, 6]);
    // 霧吹き状の微粒: 数百の極小点を衝撃点の周りに正規分布で
    for (let i = 0; i < 420; i++) {
      const u1 = R() || 1e-6, u2 = R();
      const gr = Math.sqrt(-2 * Math.log(u1));
      const x = cx + gr * Math.cos(2 * Math.PI * u2) * W * 0.16, y = cy + gr * Math.sin(2 * Math.PI * u2) * H * 0.18;
      const rr = (0.35 + R() ** 3 * 1.6) * s;
      this._soft(x, y, rr, rr * (0.7 + R() * 0.3), R() * 3, 0.35 + R() * 0.45, this._rgb());
    }
    for (let i = 0; i < N; i++) {
      // 大きさは冪分布: ほとんどが小さく、大きいものはわずか
      const u = R();
      const r = (0.7 + 15 * u ** 5) * s;
      const ang = R() * Math.PI * 2;
      const dist = (20 + R() ** 0.7 * W * 0.42) * (1 - u * 0.5);
      const x = cx + Math.cos(ang) * dist, y = cy + Math.sin(ang) * dist * 0.75;
      this.pending.push({ at: R() ** 2 * 0.1, x, y, r, ang, elong: R() < 0.25 ? 0.4 + R() * 1.1 : 0 });
    }
    this.pendT = 0;
  }

  update(dt) {
    if (!this.pass.enabled) return;
    let dirty = false;
    this.pendT = (this.pendT || 0) + dt;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const d = this.pending[i];
      if (d.at <= this.pendT) { this._drop(d.x, d.y, d.r, d.ang, d.elong); this.pending.splice(i, 1); dirty = true; }
    }
    const g = this.g;
    for (const d of this.drips) {
      if (d.t > 1.4) continue;
      d.t += dt;
      d.v *= Math.exp(-dt * 1.2);
      const y1 = Math.min(d.y0 + d.len, d.y + d.v * dt);
      // 細い筋: 柔らかい小粒を詰めて描く(線の輪郭を出さない)
      for (let y = d.y; y < y1; y += 1) {
        const x = d.x + Math.sin(y * 0.04 + d.wob) * 1.2;
        this._soft(x, y, d.w, d.w, 0, d.a * 0.35, d.rgb);
      }
      d.y = y1;
      dirty = true;
    }
    void g;
    if (dirty) this.tex.needsUpdate = true;
  }
}

// ------------------------------------------------------------ 3D の血煙(霧状のスプライト・通常合成・0.3 秒で広がって消える)
class BloodMist {
  constructor(scene, n) {
    this.n = n;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const sprite = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d');
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();
    this.mat = new THREE.PointsMaterial({ color: 0x3e0606, size: 0.1, map: sprite, transparent: true, opacity: 0, depthWrite: false,
      sizeAttenuation: true, blending: THREE.NormalBlending, fog: false });
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
      this.pos[i * 3] = center.x + (R() - 0.5) * 0.15;
      this.pos[i * 3 + 1] = center.y + (R() - 0.5) * 0.12;
      this.pos[i * 3 + 2] = center.z + (R() - 0.5) * 0.15;
      const sp = 0.4 + R() * 1.4;
      const dx = (R() - 0.5) * 2 + fwd.x * 0.4, dy = (R() - 0.3) * 1.2, dz = (R() - 0.5) * 2 + fwd.z * 0.4;
      const L = Math.hypot(dx, dy, dz) || 1;
      this.vel[i * 3] = dx / L * sp; this.vel[i * 3 + 1] = dy / L * sp; this.vel[i * 3 + 2] = dz / L * sp;
    }
    this.t = 0;
    this.points.visible = true;
    this.points.geometry.attributes.position.needsUpdate = true;
  }
  update(dt) {
    if (!this.points.visible) return;
    this.t += dt;
    const drag = Math.exp(-dt * 4);
    for (let i = 0; i < this.n; i++) {
      this.vel[i * 3 + 1] -= 1.5 * dt;
      for (let k = 0; k < 3; k++) { this.vel[i * 3 + k] *= drag; this.pos[i * 3 + k] += this.vel[i * 3 + k] * dt; }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    const k = Math.min(1, this.t / 0.3);
    this.mat.size = 0.1 + 0.3 * k;                 // 0.3 秒で霧のように広がる
    this.mat.opacity = 0.55 * (1 - k) ** 1.5;      // 同時に薄れて消える
    if (this.t > 0.32) this.points.visible = false;
  }
  reset() { this.points.visible = false; this.t = 0; }
}

function mulberry(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
