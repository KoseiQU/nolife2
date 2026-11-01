// view_lock.js — P5a: 視点を管理人へ強制的に向ける短いムービー(DESIGN §3.8 A)。
//  - 潜伏室から飛び出した時: 懐中電灯 ON → 振り向かされてそのまま襲撃ムービー(attack_movie.js)へ引き継ぐ(handoff)
//                           懐中電灯 OFF → 1.2〜1.8 秒だけ管理人を見せ(操作不能)、元の視点へ戻して操作を返す
//  - EV の賭け: 扉が開いた瞬間にカゴの中の管理人へ振り向く
// 入力は player.frozen で止め、カメラの向きだけを毎フレーム上書きする(位置はそのまま)。update(dt) 駆動(rAF 非依存)。

import * as THREE from 'three';

export const VIEWLOCK = { turn: 0.28, back: 0.32 };

export class ViewLock {
  // holdFrozen(): 終わった時にまだ入力を止めておく理由(階段の途中・死亡演出など)があるか。P5b-1b: 始めた時の frozen を
  //  そのまま戻すと、階段の途中で始まって階段が先に終わった場合に frozen が真のまま残り操作できなくなる
  constructor({ camera, player, holdFrozen = null }) {
    this.camera = camera;
    this.player = player;
    this.holdFrozen = holdFrozen;
    this.active = false;
    this.t = 0;
    this.log = [];
    this._q0 = new THREE.Quaternion();
    this._qT = new THREE.Quaternion();
    this._m = new THREE.Matrix4();
    this._tgt = new THREE.Vector3();
  }

  // getTarget(out) → 見る点(世界座標)。opts: { total(秒。0 = 引き継ぐまで続ける), turn, back, returnView(元の向きへ戻すか), label }
  start(getTarget, opts = {}) {
    const cam = this.camera;
    if (!this.active) {
      this.saved = { euler: new THREE.Euler().copy(this.player.object.rotation), frozen: this.player.frozen };
      this._q0.copy(cam.quaternion);
    } else this._q0.copy(cam.quaternion);
    this.getTarget = getTarget;
    this.opts = { total: 1.5, turn: VIEWLOCK.turn, back: VIEWLOCK.back, returnView: true, label: '', ...opts };
    this.player.frozen = true;
    this.active = true;
    this.t = 0;
    this.maxAimErr = 0;
    this.log.push({ ev: 'start', label: this.opts.label, total: this.opts.total });
  }

  // 襲撃ムービーへ引き継ぐ: 入力は止めたまま(ムービーが解く)、向きの上書きだけやめる
  handoff() {
    if (!this.active) return;
    this.active = false;
    this.log.push({ ev: 'handoff', label: this.opts.label, t: +this.t.toFixed(2) });
  }

  // 中断(死亡・復帰など)。入力の凍結は呼び出し側に任せる
  cancel() { if (this.active) { this.active = false; this.log.push({ ev: 'cancel', label: this.opts.label }); } }

  aimError() {
    if (!this.getTarget) return Math.PI;
    const cam = this.camera;
    const f = cam.getWorldDirection(new THREE.Vector3());
    const to = this.getTarget(this._tgt).clone().sub(cam.position).normalize();
    return f.angleTo(to);
  }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    const O = this.opts, cam = this.camera;
    const tgt = this.getTarget(this._tgt);
    this._m.lookAt(cam.position, tgt, cam.up);
    this._qT.setFromRotationMatrix(this._m);
    const holdEnd = O.total > 0 ? O.total - O.back : Infinity;
    if (this.t <= holdEnd) {
      const k = smooth(Math.min(1, this.t / O.turn));
      cam.quaternion.copy(this._q0).slerp(this._qT, k);
    } else if (O.returnView) {
      // 元の向きへ戻す
      const k = smooth(Math.min(1, (this.t - holdEnd) / O.back));
      const qBack = new THREE.Quaternion().setFromEuler(this.saved.euler);
      cam.quaternion.copy(this._qT).slerp(qBack, k);
    }
    cam.updateMatrixWorld();
    if (this.t >= O.turn && this.t <= holdEnd) this.maxAimErr = Math.max(this.maxAimErr, this.aimError());
    if (O.total > 0 && this.t >= O.total) {
      if (O.returnView) this.player.object.rotation.copy(this.saved.euler);
      else this.player.object.rotation.setFromQuaternion(cam.quaternion, 'YXZ');
      this.player.frozen = this.saved.frozen && (this.holdFrozen ? this.holdFrozen() : true);
      this.active = false;
      this.log.push({ ev: 'end', label: O.label, t: +this.t.toFixed(2) });
    }
  }
}

function smooth(x) { return x * x * (3 - 2 * x); }
