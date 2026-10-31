// peephole.js — ドアスコープ(覗き穴)。DESIGN §3.7「部屋の内側から覗き穴で廊下を見る」。
// 部屋の中で扉に向かい E 長押し(または P を押している間)で、扉の廊下側レンズ位置へカメラを移し、
// FOV 110° ＋ 魚眼(等距離射影へ変換)＋ 円形マスク ＋ 強い周辺減光。離すと元のカメラへ戻す。

import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export const PEEP = {
  fov: 110,
  eyeY: 1.48,          // レンズの高さ(床から)
  maskRadius: 0.92,    // 画面の縦半分を 1 とした円の半径
};

export class Peephole {
  // lens: { x, z, yaw }(yaw はカメラの rotation.y。廊下を向く)
  constructor({ camera, player, floorY, lens }) {
    this.camera = camera;
    this.player = player;
    this.floorY = floorY;
    this.lens = lens;
    this.active = false;
    this.saved = null;
    this.pass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        aspect: { value: 16 / 9 },
        halfFov: { value: THREE.MathUtils.degToRad(PEEP.fov / 2) },
        maskR: { value: PEEP.maskRadius },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform float aspect; uniform float halfFov; uniform float maskR; varying vec2 vUv;
        vec2 toUv(vec2 p){ return p / (2.0 * vec2(aspect, 1.0)) + 0.5; }
        void main(){
          vec2 p = (vUv - 0.5) * 2.0 * vec2(aspect, 1.0);     // 縦 ±1
          float r = length(p);
          float rho = r / maskR;
          // 等距離射影(魚眼): 出力半径 rho → 角度 θ = rho * halfFov → 透視画像上の半径 tanθ / tan(halfFov)
          float th = min(rho, 1.0) * halfFov;
          float rr = tan(th) / tan(halfFov);
          vec2 dir = r > 1e-5 ? p / r : vec2(0.0);
          // 縁ほどわずかに色ずれ(安いレンズ)
          float ca = 0.012 * rho * rho;
          vec3 c;
          c.r = texture2D(tDiffuse, toUv(dir * rr * (1.0 + ca))).r;
          c.g = texture2D(tDiffuse, toUv(dir * rr)).g;
          c.b = texture2D(tDiffuse, toUv(dir * rr * (1.0 - ca))).b;
          float vig = 1.0 - smoothstep(0.35, 1.0, rho);
          c *= mix(0.18, 1.0, vig);
          float mask = 1.0 - smoothstep(0.97, 1.0, rho);
          gl_FragColor = vec4(c * mask, 1.0);
        }`,
    });
    this.pass.enabled = false;
  }

  set(on) {
    on = !!on;
    if (on === this.active) return;
    const cam = this.camera;
    if (on) {
      this.saved = { pos: cam.position.clone(), quat: cam.quaternion.clone(), fov: cam.fov, flash: this.player.flashlight.visible, frozen: this.player.frozen };
      this.player.frozen = true;
      this.player.flashlight.visible = false;
      cam.fov = PEEP.fov;
      cam.updateProjectionMatrix();
      this._place();
      this.pass.enabled = true;
    } else {
      const s = this.saved;
      cam.position.copy(s.pos);
      cam.quaternion.copy(s.quat);
      cam.fov = s.fov;
      cam.updateProjectionMatrix();
      this.player.frozen = s.frozen;
      this.player.flashlight.visible = this.player.flashlightOn;
      this.pass.enabled = false;
      this.saved = null;
    }
    this.active = on;
  }

  _place() {
    const cam = this.camera, L = this.lens;
    cam.position.set(L.x, this.floorY + PEEP.eyeY, L.z);
    cam.rotation.set(0, L.yaw, 0, 'YXZ');
    cam.updateMatrixWorld();
  }

  update(width, height) {
    this.pass.uniforms.aspect.value = width / height;
    if (this.active) { this._place(); this.player.flashlight.visible = false; }
  }
}
