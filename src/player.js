// player.js — 一人称の移動(前作 NOLIFE player.js の移植)。
// PointerLock + WASD(Shift 走り・Ctrl しゃがみ)、壁AABB(building.json→walls.js)への円柱押し戻し、
// 歩行の上下動、懐中電灯(F トグル・カチッのラグ・手ブレ揺れ)。
// update(dt) は rAF 非依存(外から dt を渡してポンプ可能)。
// P0 で落としたもの: 起床演出・スタミナ・電池・階段ランプ(P0 区間は平床のみ)。

import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

export const PLAYER = {
  height: 1.62,       // 目線(立ち)。前作1.7はやや高く、天井2.4mが近く見えたので下げた
  crouchHeight: 1.0,
  radius: 0.28,
  walkSpeed: 1.6,     // 前作3.2は駆け足。探索ホラーの歩き(ADoNの歩速に近い)に落とす
  runSpeed: 3.6,
  crouchSpeed: 0.9,
  bobFreq: 1.85,      // 歩幅の周期(Hz相当 × walkSpeed比で伸縮)
  bobAmp: 0.022,      // 上下動(m)
  bobSway: 0.012,     // 左右の揺れ(m)
};

export const FLASHLIGHT = {
  angle: 0.72,        // 円錐は広め(外周のこぼれ光まで)。芯の狭さはクッキー(map)で作る
  penumbra: 0.45,
  decay: 2,
  distance: 17,       // 15m 先の突き当たりが白く飛ばないよう、遠方で滑らかに落とす
  intensity: 45,      // candela 相当。LOOK.exposure と組で目視調整
  toggleLag: 0.12,
  swayAmp: 0.010,
  shadowMapSize: 2048,
};

export class Player {
  constructor(camera, domElement, world) {
    this.camera = camera;
    this.world = world; // { collisions, floorY }
    this.controls = new PointerLockControls(camera, domElement);
    this.pos = new THREE.Vector3(0, world.floorY, 0);
    this.crouch = false;
    this.keys = new Set();
    this._justPressed = new Set();
    this.flashlightOn = false;
    this.flashlightPending = null;
    this.flashlightLag = 0;
    this._walkPhase = 0;
    this._moveRatio = 0;
    this._t = 0;
    this.onUse = null;      // E キー(扉)のコールバック。main.js が設定
    this.onKey = null;      // 押された瞬間のキー(e.code)ごとに呼ぶ。main.js が設定(L 施錠・P 覗き穴など)
    this.frozen = false;    // 死亡演出・覗き穴の間は移動とカメラ更新を止める(キー状態の追跡は続ける)
    // P5b-2a: 別空間からの上書き。invert = 画面が上下反転している間(X105 の反転。A/D を入れ替えて画面どおりに動く)、
    //  move = { speed(m/s), eyeY(目の高さ・世界の y。null なら立ち/しゃがみ), noRun, noBob }(X312 の泳ぎ・潜水)
    this.invert = false;
    this.move = null;
    this._buildFlashlight();
    this._bindKeys();
  }

  get object() { return this.controls.object; }

  _buildFlashlight() {
    const F = FLASHLIGHT;
    const light = new THREE.SpotLight(0xffeedd, F.intensity, F.distance, F.angle, F.penumbra, F.decay);
    light.castShadow = true;
    light.shadow.mapSize.set(F.shadowMapSize, F.shadowMapSize);
    light.shadow.camera.near = 0.08;
    light.shadow.camera.far = F.distance;
    light.shadow.bias = -0.0004;
    light.shadow.normalBias = 0.02;
    light.map = flashlightCookie();   // 実物のLEDライトの「芯＋リング＋外周のこぼれ」
    const target = new THREE.Object3D();
    light.target = target;
    this.camera.add(light);
    this.camera.add(target);
    light.position.set(0.12, -0.16, 0.05);  // 胸の右前で持つ
    target.position.set(0.02, -0.18, -2.2);
    light.visible = false;
    this.flashlight = light;
    this.flashlightTarget = target;
  }

  setFlashlight(on) {
    this.flashlightOn = !!on;
    this.flashlightPending = null;
    this.flashlight.visible = this.flashlightOn;
  }

  _bindKeys() {
    const down = (e) => {
      if (!this.keys.has(e.code)) this._justPressed.add(e.code);
      this.keys.add(e.code);
      if (e.code === 'ControlLeft' || e.code === 'ControlRight') this.crouch = true;
    };
    const up = (e) => {
      this.keys.delete(e.code);
      if (e.code === 'ControlLeft' || e.code === 'ControlRight') this.crouch = false;
    };
    document.addEventListener('keydown', down);
    document.addEventListener('keyup', up);
    window.addEventListener('blur', () => { this.keys.clear(); this.crouch = false; });
  }

  // 足元(x, 床y, z)へ移動し、向き(yaw, pitch)をセット
  setPose(x, z, yaw = null, pitch = 0) {
    this.pos.set(x, this.world.floorY, z);
    if (yaw !== null) this.controls.object.rotation.set(pitch, yaw, 0, 'YXZ');
    this._applyCamera(0);
  }

  // P3a: 足元を3D位置で置く(階段・EV の移動中。床の高さを通らない)
  placeAt(x, y, z, bob = 0) {
    this.pos.set(x, y, z);
    this._applyCamera(bob);
  }

  // P3a: 階を移ったときに当たりと床の高さを差し替える
  setWorld(world) { this.world = world; }

  _applyCamera(bob) {
    const eye = this.crouch ? PLAYER.crouchHeight : PLAYER.height;
    const o = this.controls.object;
    // 上下動は目線、左右揺れはカメラ右方向へ
    const sway = Math.sin(this._walkPhase * 0.5) * PLAYER.bobSway * this._moveRatio;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(o.quaternion);
    right.y = 0;
    const ey = this.move && this.move.eyeY != null ? this.move.eyeY : this.pos.y + eye;   // P5b-2a: 泳ぎ・潜水の目の高さ
    o.position.set(this.pos.x + right.x * sway, ey + bob, this.pos.z + right.z * sway);
  }

  update(dt) {
    dt = Math.min(dt, 0.05);
    this._t += dt;
    if (this.frozen) {
      if (this.onKey) for (const c of this._justPressed) this.onKey(c);
      this._justPressed.clear();
      return;
    }
    const fwd = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const str = ((this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0)) * (this.invert ? -1 : 1);
    const M = this.move;
    const run = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) && !this.crouch && !(M && M.noRun);
    const speed = M && M.speed != null ? M.speed : this.crouch ? PLAYER.crouchSpeed : run ? PLAYER.runSpeed : PLAYER.walkSpeed;

    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    dir.y = 0; dir.normalize();
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const move = new THREE.Vector3().addScaledVector(dir, fwd).addScaledVector(right, str);
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed);

    const ox = this.pos.x, oz = this.pos.z;
    const [rx, rz] = this._resolveXZ(this.pos.x + move.x * dt, this.pos.z + move.z * dt);
    this.pos.x = rx; this.pos.z = rz;
    this.pos.y = this.world.floorY;

    // 実際に進んだ距離で歩行位相を進める(壁に押し付けている間は揺れない)
    const moved = Math.hypot(rx - ox, rz - oz) / Math.max(dt, 1e-4);
    const target = Math.min(1, moved / PLAYER.walkSpeed);
    this._moveRatio += (target - this._moveRatio) * Math.min(1, dt * 8);
    this._walkPhase += dt * Math.PI * 2 * PLAYER.bobFreq * Math.max(0.0, moved / PLAYER.walkSpeed) ** 0.6;
    const bob = M && M.noBob ? 0 : Math.abs(Math.sin(this._walkPhase * 0.5)) * PLAYER.bobAmp * this._moveRatio * 2 - PLAYER.bobAmp * this._moveRatio;
    this._applyCamera(bob);

    if (this.onKey) for (const c of this._justPressed) this.onKey(c);
    if (this._justPressed.has('KeyE') && this.onUse) this.onUse();
    this._updateFlashlight(dt);
    this._justPressed.clear();
  }

  _updateFlashlight(dt) {
    if (this._justPressed.has('KeyF')) {
      const cur = this.flashlightPending !== null ? this.flashlightPending : this.flashlightOn;
      this.flashlightPending = !cur;
      this.flashlightLag = FLASHLIGHT.toggleLag;
    }
    if (this.flashlightPending !== null) {
      this.flashlightLag -= dt;
      if (this.flashlightLag <= 0) { this.flashlightOn = this.flashlightPending; this.flashlightPending = null; }
    }
    this.flashlight.visible = this.flashlightOn;
    if (!this.flashlightOn) return;
    // 手ブレ: 止まっている時もごく小さく揺れ、歩くと歩調に同期して揺れる
    const a = FLASHLIGHT.swayAmp * (0.25 + this._moveRatio);
    const t = this._t;
    const nx = Math.sin(t * 1.3) * 0.6 + Math.sin(t * 3.7 + 1.2) * 0.4;
    const ny = Math.sin(t * 1.1 + 0.5) * 0.6 + Math.sin(t * 2.9 + 2.1) * 0.4;
    const wx = Math.sin(this._walkPhase * 0.5) * this._moveRatio;
    const wy = Math.abs(Math.cos(this._walkPhase * 0.5)) * this._moveRatio;
    this.flashlightTarget.position.set(0.02 + (nx * 0.5 + wx) * a * 6, -0.18 + (ny * 0.5 + wy) * a * 4, -2.2);
  }

  // 水平衝突: 重なった各AABBを「めり込み最小の軸・向き」へ押し出す(前作と同じ・2パス)
  _resolveXZ(x, z) {
    const r = PLAYER.radius;
    const y = this.pos.y;
    for (let pass = 0; pass < 2; pass++) {
      for (const c of this.world.collisions) {
        if (c.disabled) continue;
        if (c.y0 !== undefined) {
          const head = y + (this.crouch ? PLAYER.crouchHeight : PLAYER.height);
          if (y > c.y1 || head < c.y0) continue;
        }
        const dx1 = (x + r) - c.minX, dx2 = c.maxX - (x - r);
        const dz1 = (z + r) - c.minZ, dz2 = c.maxZ - (z - r);
        if (dx1 <= 0 || dx2 <= 0 || dz1 <= 0 || dz2 <= 0) continue;
        const m = Math.min(dx1, dx2, dz1, dz2);
        if (m === dx1) x = c.minX - r;
        else if (m === dx2) x = c.maxX + r;
        else if (m === dz1) z = c.minZ - r;
        else z = c.maxZ + r;
      }
    }
    return [x, z];
  }

  lock() { this.controls.lock(); }
  isLocked() { return this.controls.isLocked; }
}

// 懐中電灯の配光(SpotLight.map に投影するクッキー)。中心の芯・反射鏡のリング・外周の弱いこぼれ・
// レンズの汚れムラを canvas で作る。白=明るい。
function flashlightCookie() {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const img = g.createImageData(S, S);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const blot = Array.from({ length: 9 }, () => [rnd() * 0.8 - 0.4, rnd() * 0.8 - 0.4, 0.05 + rnd() * 0.12, rnd() * 0.12]);
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const x = (i + 0.5) / S * 2 - 1, y = (j + 0.5) / S * 2 - 1;
      const r = Math.hypot(x, y);
      let v = 0.07 * Math.max(0, 1 - r) ** 0.5;                  // 外周のこぼれ光(近くの壁がうっすら見える)
      v += 0.80 * Math.exp(-((r / 0.17) ** 2));                   // 芯
      v += 0.22 * Math.exp(-((r / 0.36) ** 2));                   // 芯の裾
      // P2c: 反射鏡のリング(細い山 2 本)は壁・天井に同心円の帯として見えたため、幅の広いなだらかな肩に置き換えた
      v += 0.06 * Math.exp(-(((r - 0.28) / 0.16) ** 2));
      for (const [bx, by, br, bs] of blot) v *= 1 - bs * Math.exp(-(((x - bx) ** 2 + (y - by) ** 2) / (br * br)));
      v = Math.min(1, v * 1.25);
      const k = (j * S + i) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = Math.round(v * 255);
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
