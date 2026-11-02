// enemy.js — 管理人の「見た目」担当(P2b)。DESIGN §3.4 / §3.4.1。
//  - build/enemy/07_rigged.glb(SkinnedMesh＋形状キー grin/attack＋アクション14本)を AnimationMixer で再生。
//    アクションは名前で辞書化し、play(name) でクロスフェード。歩行はその場(in-place)なので移動は AI が行う。
//  - door_open_in だけはルートモーション入り(Hips が前へ 1.79m)。Hips の前後成分をトラックから抜き、
//    抜いた分を「本体を前へ送る量」として update() で root に足す(=見た目は元アニメと同一)。
//  - 右手にハンマー(hammer.glb、meta のオフセットをそのまま)、左手に懐中電灯(自作の円筒＋SpotLight＋光の筋)。
//  - 照明: レベルはベイク済みなので、敵だけに効く「常夜灯の当たり」をシェーダ注入で足す。
//    (WebGLRenderer には光のリンク機能が無く、layers はカメラ単位で光を間引くだけ=物体ごとの分離ができない。
//     そこで敵の材質だけ onBeforeCompile で点光源数個＋半球光＋懐中電灯の照り返しを足す。影なし・ほぼ無料)
//    プレイヤーの懐中電灯(SpotLight)は通常どおり敵にも当たり、敵は影を落とす。
//  - 足音: 歩行アニメの接地(足ボーン高さの極小)を検出して onFootstep を呼ぶ。

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const ENEMY = {
  url: './build/enemy/07_rigged.glb',
  hammerUrl: './build/enemy/hammer.glb',
  // meta.json のハンマーのオフセット(mixamorig:RightHand のローカル)。P5b-5: 握りの点を「握った指の輪の中心」に移した
  // (P2a は掌の中央から 2.5cm 掌側=拳より約 2cm 手首寄りで、指が柄を包めなかった。向き hammerQuat は不変)
  hammerPos: [0.01063, 0.119308, 0.023517],
  hammerQuat: [0.005073, 0.000799, 0.778998, 0.627005],
  // P2d(§3.4.1 ハンマーの持ち方): P2a の向きは柄が小指側から出て頭が後ろ下に垂れていた。
  // ハンマー自身の X 軸(頭の長さ方向)まわりに 180° 回し、柄を親指側へ・頭を前(振り上げで上)にする
  hammerFlipAxis: [1, 0, 0],
  fade: 0.3,                       // 既定のクロスフェード秒
  // P5b-5: 懐中電灯の握り(meta.json flashlight_grip: mixamorig:LeftHand のローカル、左手の指の輪の中心)。
  // 本体(全長 15cm、group の z=-0.115〜0.035)を z=-gripAlong の所で握る = group の原点は握りの点から光の向きへ gripAlong
  flashlightGrip: [-0.010121, 0.123396, 0.025581],
  flashlightGripAlong: 0.06,
  flashlight: {
    angle: THREE.MathUtils.degToRad(25),
    penumbra: 0.75,                // 縁を広くぼかす(壁・天井に輪郭の帯を作らない)
    distance: 12,
    decay: 2,
    intensity: 26,
    color: 0xfff0dc,
    shadowMapSize: 1024,
    pitch: 0.30,                   // 巡回中は足元の少し先を照らす(rad 下向き)
    beamLength: 7.5,
    beamOpacity: 0.07,             // 光の筋(加算)。露出 4.5 の後で白く飛ばない程度
  },
  // 敵だけに効く光(シェーダ注入)。lamps は main が manifest.lamps から渡す
  lamp: { color: 0xffcf9a, intensity: 0.5, range: 6.5, y: 2.3 },
  exitLamp: { color: 0x3cff7a, intensity: 0.10, range: 3.0 },
  windowLamp: { color: 0x8fa6c8, intensity: 0.10, range: 4.0 },
  hemi: { sky: 0x1a2030, ground: 0x0a0806, intensity: 0.010 },
  bounce: { intensity: 0.85, range: 3.5, albedo: 0.5 },   // 懐中電灯が近くの面に当たった照り返し(下・前からの照らし)
  irradianceKnee: 4,              // 敵材質の直接光の膝(W/m² 相当)。小さいほど近距離の白飛びを抑える
};

export const MAX_LAMPS = 7;   // 常夜灯など最大 5 ＋ 照り返し 1 ＋ 襲撃ムービーの顔の補助光 1

export class Enemy {
  constructor(scene, { floorY = 0, collisions = [], lamps = [], exitLamps = [], windowLamps = [] } = {}) {
    this.scene = scene;
    this.floorY = floorY;
    this.collisions = collisions;
    this.root = new THREE.Group();
    this.root.name = 'Enemy';
    this.yaw = 0;                  // 本体の向き。0 = +Z を向く(モデルの正面)
    this.actions = {};
    this.current = null;           // 再生中のアクション名
    this.face = { grin: 0, attack: 0 };
    this.faceTarget = { grin: 0, attack: 0 };
    this.faceRate = { grin: 0.8, attack: 3.0 };   // 1秒あたりの変化量
    this.aimPoint = null;          // 懐中電灯を向ける点(null なら進行方向の足元)
    this.onFootstep = null;        // (foot:'L'|'R', worldPos) => void
    this.onActionEnd = null;       // (name) => void
    this.rootMotion = null;        // door_open_in の前方送り {times, fwd, last}
    this._dir = new THREE.Vector3(0, -0.3, 1).normalize();
    this._lampDefs = { lamps, exitLamps, windowLamps };
    this._feet = { L: { min: 1e9, max: -1e9, armed: false, prevY: 0, hist: [] }, R: { min: 1e9, max: -1e9, armed: false, prevY: 0, hist: [] } };
    this._prevPos = new THREE.Vector3();
    this.speed = 0;                // 実移動速度(足音・アニメの判定用。AI が設定)
    this.faceFill = 0;             // 襲撃ムービーの顔の補助光(0 = 消灯)
    this.underLight = 0;           // P5b-1b: ロッカーの中で自分の懐中電灯を胸の前で上へ向けた光(顔を下から照らす。0 = 消灯)
    this.lean = 0;                 // 上体を前へ倒す角度(rad)。スコープを覗き込む時など(mixer の後に背骨へ足す)
    this.carLamp = null;           // P5a: EV のカゴの照明(敵だけに効く光の 1 枠。main がカゴの中・戸口にいる間だけ { p, c, r } を入れる)
    this.ready = false;
  }

  async load() {
    const loader = new GLTFLoader();
    const [g, h] = await Promise.all([loader.loadAsync(ENEMY.url), loader.loadAsync(ENEMY.hammerUrl)]);
    this.gltf = g;
    const model = g.scene;
    this.model = model;
    this.root.add(model);
    this.scene.add(this.root);

    // ---- メッシュ・材質
    this.meshes = [];
    this.uniforms = makeEnemyLightUniforms();
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;     // SkinnedMesh の境界は静止姿勢なので、腕を振ると欠ける→切る
      if (o.morphTargetDictionary) this.meshes.push(o);
      // 眼球: 角膜(透明)の部分が GLB では不透明で白く出るため、テクスチャのアルファで抜く
      if (/high-poly/.test(o.material.name)) { o.material.alphaTest = 0.5; o.material.transparent = false; o.castShadow = false; }
      // 作業着・制帽: 粗さテクスチャ(G≈0.36)のままだと懐中電灯(視点とほぼ同じ位置の光)で布全体がテカる(§3.4.1 テカリ禁止)→綾織りの粗さに固定
      if (/coverall|cap_/.test(o.material.name)) { o.material.roughnessMap = null; o.material.roughness = 0.88; }
      patchEnemyMaterial(o.material, this.uniforms);
    });

    // ---- 骨
    const bone = (n) => model.getObjectByName(n);
    this.bones = {
      hips: bone('mixamorigHips'), head: bone('mixamorigHead'),
      lhand: bone('mixamorigLeftHand'), rhand: bone('mixamorigRightHand'),
      lfoot: bone('mixamorigLeftFoot'), rfoot: bone('mixamorigRightFoot'),
    };
    for (const [k, v] of Object.entries(this.bones)) if (!v) throw new Error('enemy bone missing: ' + k);

    // ---- ハンマー(右手)
    const hammer = h.scene.children[0] || h.scene;
    hammer.position.fromArray(ENEMY.hammerPos);
    hammer.quaternion.fromArray(ENEMY.hammerQuat);
    if (ENEMY.hammerFlipAxis) hammer.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3().fromArray(ENEMY.hammerFlipAxis), Math.PI));
    hammer.scale.set(1, 1, 1);
    hammer.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; patchEnemyMaterial(o.material, this.uniforms); } });
    this.bones.rhand.add(hammer);
    this.hammer = hammer;

    // ---- 懐中電灯(左手)
    this._buildFlashlight();

    // ---- アニメ
    this.mixer = new THREE.AnimationMixer(model);
    this.clips = {};
    for (const clip of g.animations) {
      if (clip.name === 'door_open_in') this.rootMotionDef = extractRootMotion(clip);
      this.clips[clip.name] = clip;
      const a = this.mixer.clipAction(clip);
      this.actions[clip.name] = a;
    }
    this.clipSpeed = {};
    for (const name of Object.keys(this.clips)) this.clipSpeed[name] = measureClipSpeed(this, name);
    this.mixer.addEventListener('finished', (e) => {
      const name = e.action.getClip().name;
      if (this.onActionEnd) this.onActionEnd(name);
    });

    // ---- 敵専用ライト
    this._buildLampWorld();

    this.place(6.9, 19.5, Math.PI);
    this.play('look_idle', { fade: 0 });
    this.ready = true;
    return this;
  }

  // 敵専用ライトの候補(階の常夜灯・非常口・窓)。毎フレーム近い順に MAX_LAMPS-2 個だけ使う(後ろの 2 枠は照り返し・顔の補助光)
  _buildLampWorld() {
    this._lampAll = [];
    const L = ENEMY.lamp;
    for (const [x, z] of this._lampDefs.lamps) this._lampAll.push({ p: new THREE.Vector3(x, this.floorY + L.y, z), c: new THREE.Color(L.color).multiplyScalar(L.intensity), r: L.range });
    for (const [x, y, z] of this._lampDefs.exitLamps) this._lampAll.push({ p: new THREE.Vector3(x, y, z), c: new THREE.Color(ENEMY.exitLamp.color).multiplyScalar(ENEMY.exitLamp.intensity), r: ENEMY.exitLamp.range });
    for (const [x, y, z] of this._lampDefs.windowLamps) this._lampAll.push({ p: new THREE.Vector3(x, y, z), c: new THREE.Color(ENEMY.windowLamp.color).multiplyScalar(ENEMY.windowLamp.intensity), r: ENEMY.windowLamp.range });
    this._lampWorld = this._lampAll.slice(0, MAX_LAMPS - 2);
    this._lampSortT = 0;
  }

  // P3a: 階を移った(床の高さ・当たり・敵専用ライトの候補を差し替える)
  setLevel(floorY, collisions, lampDefs) {
    this.floorY = floorY;
    this.collisions = collisions;
    if (lampDefs) this._lampDefs = lampDefs;
    if (this.ready || this._lampAll) this._buildLampWorld();
    this.root.position.y = floorY;
    this._prevPos.copy(this.root.position);
  }

  _buildFlashlight() {
    const F = ENEMY.flashlight;
    const grp = new THREE.Group();
    grp.name = 'EnemyFlashlight';
    grp.matrixAutoUpdate = false;
    // 本体: 黒いアルミの円筒(全長 18cm・径 3.4cm)＋ヘッド(太め)＋レンズ(発光)
    const metal = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.42, metalness: 0.85 });
    patchEnemyMaterial(metal, this.uniforms);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.15, 14).rotateX(Math.PI / 2), metal);
    body.position.z = -0.04;
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.018, 0.045, 16).rotateX(Math.PI / 2), metal);
    head.position.z = 0.055;
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.021, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(F.color).multiplyScalar(6), toneMapped: true }));
    lens.position.z = 0.078;
    for (const m of [body, head]) { m.castShadow = false; m.receiveShadow = true; }
    lens.castShadow = false;
    grp.add(body, head, lens);

    const light = new THREE.SpotLight(F.color, F.intensity, F.distance, F.angle, F.penumbra, F.decay);
    light.position.set(0, 0, 0.09);
    light.castShadow = true;
    light.shadow.mapSize.set(F.shadowMapSize, F.shadowMapSize);
    light.shadow.camera.near = 0.1;
    light.shadow.camera.far = F.distance;
    light.shadow.bias = -0.0006;
    light.shadow.normalBias = 0.03;
    const target = new THREE.Object3D();
    target.name = 'EnemyFlashlightTarget';
    this.scene.add(target);
    light.target = target;
    grp.add(light);

    // 光の筋(霧の代わりの半透明円錐。加算・深度書き込みなし)
    const beam = new THREE.Mesh(makeBeamGeometry(F.beamLength, Math.tan(F.angle * 0.9) * F.beamLength), makeBeamMaterial(F.color, F.beamOpacity, F.beamLength));
    beam.position.z = 0.08;
    beam.renderOrder = 10;
    beam.frustumCulled = false;
    beam.castShadow = false; beam.receiveShadow = false;
    grp.add(beam);

    this.bones.lhand.add(grp);
    this.flashlight = { group: grp, light, target, beam, lens, on: true };
  }

  setFlashlight(on) {
    this.flashlight.on = !!on;
    this.flashlight.light.visible = this.flashlight.beam.visible = !!on;
    this.flashlight.lens.material.color.setScalar(on ? 6 : 0.02);
    this.flashlight.lens.visible = !!on;   // 消灯時はレンズ面を出さない(暗所で白い円盤に見えたため)
  }

  // ------------------------------------------------------------ pose / anim
  place(x, z, yaw = this.yaw) {
    this.root.position.set(x, this.floorY, z);
    this.yaw = yaw;
    this.root.rotation.set(0, yaw, 0);
    this._prevPos.copy(this.root.position);
    this.rootMotion = null;
  }
  get pos() { return this.root.position; }
  forward(out = new THREE.Vector3()) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }

  // name: アクション名。opts: { fade, loop(true), timeScale, clamp }
  play(name, opts = {}) {
    const a = this.actions[name];
    if (!a) throw new Error('no action ' + name);
    const fade = opts.fade ?? ENEMY.fade;
    const loop = opts.loop ?? !ONE_SHOT.has(name);
    if (this.current === name && !opts.restart) { if (opts.timeScale !== undefined) a.timeScale = opts.timeScale; return a; }
    for (const [n, other] of Object.entries(this.actions)) {
      if (n === name) continue;
      if (other.isRunning() || other.getEffectiveWeight() > 0) other.fadeOut(fade);
    }
    a.reset();
    a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    a.clampWhenFinished = !loop;
    a.timeScale = opts.timeScale ?? 1;
    a.setEffectiveWeight(1);
    if (fade > 0) a.fadeIn(fade);
    a.play();
    this.current = name;
    this.rootMotion = (name === 'door_open_in') ? { last: 0 } : null;
    return a;
  }
  actionTime() { const a = this.actions[this.current]; return a ? a.time : 0; }
  setTimeScale(s) { const a = this.actions[this.current]; if (a) a.timeScale = s; }

  setFace(name, v, immediate = false) {
    this.faceTarget[name] = THREE.MathUtils.clamp(v, 0, 1);
    if (immediate) this.face[name] = this.faceTarget[name];
  }

  // ------------------------------------------------------------ update
  update(dt, camera) {
    if (!this.ready) return;
    const prevTime = this.actionTime();
    this.mixer.update(dt);

    // door_open_in のルートモーション(抜いた Hips 前後成分を本体に足す)
    if (this.rootMotion && this.current === 'door_open_in') {
      const t = this.actions.door_open_in.time;
      const f = sampleTrack(this.rootMotionDef, t);
      const d = f - this.rootMotion.last;
      this.rootMotion.last = f;
      if (d !== 0) {
        this.root.position.x += Math.sin(this.yaw) * d;
        this.root.position.z += Math.cos(this.yaw) * d;
      }
    }
    void prevTime;

    // 表情
    for (const k of ['grin', 'attack']) {
      const tgt = this.faceTarget[k];
      const r = this.faceRate[k] * dt;
      this.face[k] += THREE.MathUtils.clamp(tgt - this.face[k], -r, r);
    }
    for (const m of this.meshes) {
      const dict = m.morphTargetDictionary;
      m.morphTargetInfluences[dict.grin] = this.face.grin;
      m.morphTargetInfluences[dict.attack] = this.face.attack;
    }

    this.root.rotation.set(0, this.yaw, 0);
    this.root.updateMatrixWorld(true);
    if (this.lean > 1e-4) this._applyLean();
    this._updateFlashlight(dt);
    this._updateFootsteps(dt);
    if (camera) this._updateLightUniforms(camera);
  }

  _updateFlashlight(dt) {
    const fl = this.flashlight;
    this.bones.lhand.updateWorldMatrix(true, false);
    const hand = _v1.fromArray(ENEMY.flashlightGrip).applyMatrix4(this.bones.lhand.matrixWorld);   // 左手の握りの点
    const fwd = this.forward(_v2);
    let want;
    if (this.aimPoint) {
      want = _v3.copy(this.aimPoint).sub(hand).normalize();
    } else {
      // 進行方向の足元。手の振り(体に対する左右のずれ)で筋がわずかに揺れる
      const hips = this.bones.hips.getWorldPosition(_v4);
      const right = _v5.set(-fwd.z, 0, fwd.x);   // 右 = fwd × up の逆(三次元: (cos,0,-sin)) ※符号は揺れの見た目だけ
      const lat = hand.clone().sub(hips).dot(right);
      const yawOff = THREE.MathUtils.clamp(lat * 0.5, -0.25, 0.25);
      const c = Math.cos(yawOff), s = Math.sin(yawOff);
      const fx = fwd.x * c - fwd.z * s, fz = fwd.x * s + fwd.z * c;
      const p = ENEMY.flashlight.pitch;
      want = _v3.set(fx * Math.cos(p), -Math.sin(p), fz * Math.cos(p)).normalize();
    }
    const k = 1 - Math.exp(-dt * 7);
    this._dir.lerp(want, dt > 0 ? k : 1).normalize();
    // 世界での姿勢 = 手の位置・_dir 方向(+Z)。親(左手)の逆行列でローカル行列に直す
    const m = _m1.lookAt(_v6.set(0, 0, 0), _v7.copy(this._dir).negate(), _up);   // lookAt は -Z を向けるので反転
    _q1.setFromRotationMatrix(m);
    const world = _m2.compose(_v8.copy(hand).addScaledVector(this._dir, ENEMY.flashlightGripAlong), _q1, _one);
    const parentInv = _m3.copy(this.bones.lhand.matrixWorld).invert();
    fl.group.matrix.multiplyMatrices(parentInv, world);
    fl.group.matrixWorldNeedsUpdate = true;
    fl.group.updateMatrixWorld(true);
    fl.target.position.copy(hand).addScaledVector(this._dir, 5);
    fl.target.updateMatrixWorld();
  }

  // 背骨(Spine)を本体の右軸まわりに前へ倒す(世界空間の回転を骨のローカルへ換算して掛ける)
  _applyLean() {
    const f = this.forward(_v1);
    const right = _v2.set(f.z, 0, -f.x).normalize();        // fwd × up の逆向き=前へ倒す軸
    // 上体を前へ倒し、首で同じだけ起こして顔は正面(覗き込む先)を向いたままにする
    for (const [name, ang] of [['mixamorigSpine', this.lean], ['mixamorigNeck', -this.lean * 0.9]]) {
      const bone = this.model.getObjectByName(name);
      if (!bone) continue;
      const rWorld = _q1.setFromAxisAngle(right, ang);
      const pWorld = bone.parent.getWorldQuaternion(new THREE.Quaternion());
      // q_local' = pWorld^-1 * rWorld * pWorld * q_local
      bone.quaternion.copy(pWorld.clone().invert().multiply(rWorld).multiply(pWorld).multiply(bone.quaternion));
      bone.updateMatrixWorld(true);
    }
  }

  _updateFootsteps(dt) {
    const moving = this.speed > 0.08 || this.current === 'door_open_in';
    for (const [key, b] of [['L', this.bones.lfoot], ['R', this.bones.rfoot]]) {
      const f = this._feet[key];
      const y = b.getWorldPosition(_v1).y - this.root.position.y;
      f.hist.push(y);
      if (f.hist.length > 90) f.hist.shift();
      let mn = 1e9, mx = -1e9;
      for (const v of f.hist) { if (v < mn) mn = v; if (v > mx) mx = v; }
      const span = mx - mn;
      if (span < 0.03 || !moving) { f.armed = false; f.prevY = y; continue; }
      if (y > mn + span * 0.55) f.armed = true;
      if (f.armed && y < mn + span * 0.22 && y <= f.prevY + 1e-4) {
        f.armed = false;
        if (this.onFootstep) this.onFootstep(key, _v1.clone().setY(this.root.position.y));
      }
      f.prevY = y;
    }
  }

  _updateLightUniforms(camera) {
    const u = this.uniforms;
    const view = camera.matrixWorldInverse;
    if (this._lampAll.length > MAX_LAMPS - 2 && (this._lampSortT = (this._lampSortT || 0) - 1) <= 0) {
      this._lampSortT = 20;
      const rp = this.root.position;
      this._lampWorld = this._lampAll.slice().sort((a, b) => a.p.distanceToSquared(rp) - b.p.distanceToSquared(rp)).slice(0, MAX_LAMPS - 2);
    }
    let i = 0;
    // P5a: カゴの照明(天井の乳白パネル＋壁の照り返し)。カゴの PointLight は真上からなので顔・胸の前が暗く、黒い人影になっていた
    const lamps = this.carLamp ? [this.carLamp, ...this._lampWorld.slice(0, MAX_LAMPS - 3)] : this._lampWorld;
    for (const l of lamps) {
      u.n2LampPos.value[i].copy(l.p).applyMatrix4(view);
      u.n2LampColor.value[i].copy(l.c);
      u.n2LampRange.value[i] = l.r;
      i++;
    }
    // 懐中電灯の照り返し: 筋の先で最初に当たる面(壁箱か床)の手前に弱い点光源
    const fl = this.flashlight;
    // カメラが光の円錐の中にいる(=こちらを照らしている)ときは筋を薄く(内側から見ると面全体が光って白く濁るため)
    {
      const o = _v3.setFromMatrixPosition(fl.group.matrixWorld);
      const toCam = _v4.copy(camera.position).sub(o);
      const along = toCam.dot(this._dir);
      const cosA = along / Math.max(1e-4, toCam.length());
      const inside = along > 0 ? THREE.MathUtils.smoothstep(cosA, Math.cos(ENEMY.flashlight.angle * 1.3), Math.cos(ENEMY.flashlight.angle * 0.7)) : 0;
      fl.beam.material.uniforms.uInside.value = inside;
      // レンズの眩しさは「こちらを照らしている」ときだけ(横や後ろから見ればただの灯った口金)
      const facing = along > 0 ? THREE.MathUtils.smoothstep(cosA, Math.cos(ENEMY.flashlight.angle * 2.2), Math.cos(ENEMY.flashlight.angle * 0.5)) : 0;
      fl.lens.material.color.setScalar(fl.on ? 0.35 + 5.0 * facing : 0.02);
    }
    if (fl.on) {
      const origin = this.bones.lhand.getWorldPosition(_v1);
      const hit = castBeam(origin, this._dir, this.collisions, this.floorY, ENEMY.flashlight.distance);
      const dist = hit.distance;
      const p = _v2.copy(origin).addScaledVector(this._dir, Math.max(0.05, dist - 0.08));
      u.n2LampPos.value[i].copy(p).applyMatrix4(view);
      const B = ENEMY.bounce;
      const k = B.intensity * B.albedo / (1 + dist * dist * 0.6);
      u.n2LampColor.value[i].set(ENEMY.flashlight.color).multiplyScalar(k);
      u.n2LampRange.value[i] = B.range;
      this.bounceDistance = dist;
      // 近い面に当たっている時は光量を d² で絞る(1m 先の壁が白く飛んで bloom で画面全体が霞むのを防ぐ。
      // 2.5m より遠くは元の強さ=光の筋と床の円は従来どおり)
      fl.light.intensity = ENEMY.flashlight.intensity * THREE.MathUtils.clamp((dist / 2.5) ** 2, 0.15, 1);
      // 光の筋は最初に当たる面で終える(床や扉を突き抜けた先が霞まないように)。角度は保ったまま全体を縮める
      const k2 = THREE.MathUtils.clamp((dist + 0.15) / ENEMY.flashlight.beamLength, 0.05, 1);
      fl.beam.scale.setScalar(k2);
      fl.beam.material.uniforms.uAxis.value.copy(this._dir);
      i++;
    }
    for (; i < MAX_LAMPS; i++) { u.n2LampColor.value[i].setScalar(0); u.n2LampRange.value[i] = 1; }
    // 襲撃ムービー中だけ: 顔の前・やや下に補助光(叫び顔を見せる。敵の材質だけに効く)
    if (this.faceFill > 0) {
      const k = MAX_LAMPS - 1;
      const head = this.bones.head.getWorldPosition(_v1);
      const f = this.forward(_v2);
      const p = _v3.copy(head).addScaledVector(f, 0.55).add(_v4.set(0, -0.25, 0));
      u.n2LampPos.value[k].copy(p).applyMatrix4(view);
      u.n2LampColor.value[k].set(0xffe2c8).multiplyScalar(this.faceFill);
      u.n2LampRange.value[k] = 1.6;
    }
    // P5b-1b: ロッカーの中(プレイヤーのライトが消えている時)。胸の前・顎の下から上へ。顔の補助光と同じ枠を使う(同時には点けない)
    else if (this.underLight > 0) {
      const k = MAX_LAMPS - 1;
      const head = this.bones.head.getWorldPosition(_v1);
      const f = this.forward(_v2);
      const p = _v3.copy(head).addScaledVector(f, 0.16).add(_v4.set(0, -0.42, 0));
      u.n2LampPos.value[k].copy(p).applyMatrix4(view);
      u.n2LampColor.value[k].set(0xfff0dc).multiplyScalar(this.underLight);
      u.n2LampRange.value[k] = 1.1;
    }
    u.n2UpView.value.set(0, 1, 0).transformDirection(view);
    u.n2HemiSky.value.set(ENEMY.hemi.sky).multiplyScalar(ENEMY.hemi.intensity * 10);
    u.n2HemiGround.value.set(ENEMY.hemi.ground).multiplyScalar(ENEMY.hemi.intensity * 10);
  }

  headWorld(out = new THREE.Vector3()) { return this.bones.head.getWorldPosition(out); }
}

const ONE_SHOT = new Set(['door_open_in', 'attack_downward', 'attack_bash', 'react_surprised', 'turn_left', 'turn_right']);

// ------------------------------------------------------------ helpers
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _v5 = new THREE.Vector3(), _v6 = new THREE.Vector3(), _v7 = new THREE.Vector3(), _v8 = new THREE.Vector3();
const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _m3 = new THREE.Matrix4();
const _q1 = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _one = new THREE.Vector3(1, 1, 1);

// door_open_in の Hips 位置トラックから前後成分(骨格ローカル +Y = 前)を抜き、{times, fwd} を返す
function extractRootMotion(clip) {
  const tr = clip.tracks.find((t) => t.name === 'mixamorigHips.position');
  if (!tr) return { times: [0], fwd: [0] };
  const v = tr.values;
  const base = v[1];
  const fwd = new Float32Array(tr.times.length);
  for (let i = 0; i < tr.times.length; i++) { fwd[i] = v[i * 3 + 1] - base; v[i * 3 + 1] = base; }
  return { times: tr.times, fwd };
}
function sampleTrack(def, t) {
  const { times, fwd } = def;
  if (t <= times[0]) return fwd[0];
  const n = times.length;
  if (t >= times[n - 1]) return fwd[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (times[mid] <= t) lo = mid; else hi = mid; }
  const a = (t - times[lo]) / (times[hi] - times[lo]);
  return fwd[lo] + (fwd[hi] - fwd[lo]) * a;
}

// その場歩行の「足が地面に着いている間に後ろへ流れる速さ」= 足が滑らない移動速度(m/s)
function measureClipSpeed(enemy, name) {
  const clip = enemy.clips[name];
  if (!/walk|run/.test(name)) return 0;
  const mixer = new THREE.AnimationMixer(enemy.model);
  const a = mixer.clipAction(clip);
  a.play();
  const N = Math.max(8, Math.round(clip.duration * 30));
  const rows = [];
  for (let i = 0; i <= N; i++) {
    mixer.setTime((i / N) * clip.duration);
    enemy.model.updateMatrixWorld(true);
    const lf = enemy.bones.lfoot.getWorldPosition(new THREE.Vector3());
    const rf = enemy.bones.rfoot.getWorldPosition(new THREE.Vector3());
    rows.push([lf, rf]);
  }
  a.stop();
  mixer.uncacheRoot(enemy.model);
  const speeds = [];
  for (const k of [0, 1]) {
    const ys = rows.map((r) => r[k].y);
    const mn = Math.min(...ys), mx = Math.max(...ys);
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][k].y < mn + (mx - mn) * 0.25 && rows[i - 1][k].y < mn + (mx - mn) * 0.25) {
        const dz = rows[i - 1][k].z - rows[i][k].z;    // モデルは +Z 向き。接地中の足は後ろ(-Z)へ流れる
        speeds.push(dz / (clip.duration / N));
      }
    }
  }
  speeds.sort((a, b) => a - b);
  const med = speeds.length ? speeds[speeds.length >> 1] : 0;
  return Math.max(0, +med.toFixed(3));
}

// 光の筋: 頂点 = 原点、底面 = +Z 方向 L。開いた円錐
function makeBeamGeometry(L, R) {
  const g = new THREE.ConeGeometry(R, L, 36, 12, true);
  g.translate(0, -L / 2, 0);
  g.rotateX(-Math.PI / 2);
  return g;
}
function makeBeamMaterial(color, opacity, L) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity }, uLen: { value: L }, uTime: { value: 0 }, uInside: { value: 0 }, uAxis: { value: new THREE.Vector3(0, 0, 1) } },
    vertexShader: `
      varying float vT; varying vec3 vN; varying vec3 vV; varying vec3 vW; varying float vD;
      uniform float uLen;
      void main(){
        vT = position.z / uLen;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vD = length(mv.xyz);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        vW = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uOpacity; uniform float uTime;
      varying float vT; varying vec3 vN; varying vec3 vV; varying vec3 vW; varying float vD;
      uniform float uInside; uniform vec3 uAxis;
      float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      void main(){
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);      // 縁ほど薄い(円錐の厚みの近似)
        float along = smoothstep(0.0, 0.06, vT) * (1.0 - 0.6 * vT) * smoothstep(1.0, 0.8, vT);
        float dust = 0.85 + 0.15 * h(floor(vW * 9.0));
        // 光源の方を見返しているとき(筋がこちらへ向かう)は面が重なって霞むだけなので消す。横から見た時だけ「筋」になる
        float facing = dot(normalize(vW - cameraPosition), -uAxis);
        float a = uOpacity * edge * along * dust * smoothstep(1.5, 4.5, vD) * (1.0 - 0.75 * uInside) * (1.0 - smoothstep(0.3, 0.8, facing));
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: true,
  });
}

// ---- 敵専用ライト(シェーダ注入)
export function makeEnemyLightUniforms() {
  return {
    n2LampPos: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector3()) },
    n2LampColor: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Color(0, 0, 0)) },
    n2LampRange: { value: new Array(MAX_LAMPS).fill(1) },
    n2UpView: { value: new THREE.Vector3(0, 1, 0) },
    n2HemiSky: { value: new THREE.Color(0, 0, 0) },
    n2HemiGround: { value: new THREE.Color(0, 0, 0) },
  };
}
export function patchEnemyMaterial(mat, uniforms) {
  const mats = Array.isArray(mat) ? mat : [mat];
  for (const m of mats) {
    if (!m || m.userData.n2EnemyPatched) continue;
    m.userData.n2EnemyPatched = true;
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          #define N2_LAMPS ${MAX_LAMPS}
          #define N2_KNEE ${ENEMY.irradianceKnee.toFixed(2)}
          uniform vec3 n2LampPos[N2_LAMPS]; uniform vec3 n2LampColor[N2_LAMPS]; uniform float n2LampRange[N2_LAMPS];
          uniform vec3 n2UpView; uniform vec3 n2HemiSky; uniform vec3 n2HemiGround;`)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
          {
            // 近距離の白飛び抑え: 懐中電灯(SpotLight)の直接光の放射照度に膝(knee)を入れる。
            // 露出 4.5 の画づくりでは 1〜2m の懐中電灯直撃で紺の作業着まで白く飛ぶため、敵の材質だけ穏やかに圧縮する
            {
              vec3 n2Alb = max(BRDF_Lambert(material.diffuseColor), vec3(1e-4));
              vec3 n2Irr = reflectedLight.directDiffuse / n2Alb;
              float n2I = max(max(n2Irr.r, n2Irr.g), n2Irr.b);
              float n2K = 1.0 / (1.0 + n2I / N2_KNEE);
              reflectedLight.directDiffuse *= n2K;
              reflectedLight.directSpecular *= n2K;
            }
            vec3 n2P = - vViewPosition;
            vec3 n2Dv = normalize(vViewPosition);
            for (int i = 0; i < N2_LAMPS; i++) {
              vec3 L = n2LampPos[i] - n2P;
              float d = length(L); L /= max(d, 1e-4);
              float att = getDistanceAttenuation(d, n2LampRange[i], 2.0);
              float ndl = saturate(dot(normal, L));
              vec3 irr = ndl * att * n2LampColor[i];
              reflectedLight.directDiffuse += irr * BRDF_Lambert(material.diffuseColor);
              vec3 H = normalize(L + n2Dv);
              float rough = max(material.roughness, 0.08);
              float sp = pow(saturate(dot(normal, H)), 2.0 / (rough * rough * rough * rough) );
              reflectedLight.directSpecular += irr * sp * (1.0 - rough) * 0.25;
            }
            float n2hw = dot(normal, n2UpView) * 0.5 + 0.5;
            reflectedLight.indirectDiffuse += mix(n2HemiGround, n2HemiSky, n2hw) * BRDF_Lambert(material.diffuseColor);
          }`);
    };
    m.customProgramCacheKey = () => 'n2enemy';
    m.needsUpdate = true;
  }
}

// 2D(XZ)の線分×衝突箱のスラブ判定。最初に当たる t(0..1)を返す(当たらなければ Infinity)
export function segmentHitT(ax, az, bx, bz, collisions, skip) {
  let best = Infinity;
  const dx = bx - ax, dz = bz - az;
  for (const c of collisions) {
    if (c.disabled || c.kind === 'enemy') continue;
    if (skip && skip(c)) continue;
    let t0 = 0, t1 = 1;
    if (Math.abs(dx) < 1e-9) { if (ax < c.minX || ax > c.maxX) continue; }
    else {
      let ta = (c.minX - ax) / dx, tb = (c.maxX - ax) / dx;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) continue;
    }
    if (Math.abs(dz) < 1e-9) { if (az < c.minZ || az > c.maxZ) continue; }
    else {
      let ta = (c.minZ - az) / dz, tb = (c.maxZ - az) / dz;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) continue;
    }
    if (t0 < best) best = t0;
  }
  return best;
}

// 懐中電灯の光線: 壁箱(XZ)と床(y=floorY)のうち近い方までの距離
function castBeam(origin, dir, collisions, floorY, maxD) {
  let d = maxD;
  if (dir.y < -1e-3) d = Math.min(d, (floorY - origin.y) / dir.y);
  const bx = origin.x + dir.x * d, bz = origin.z + dir.z * d;
  const t = segmentHitT(origin.x, origin.z, bx, bz, collisions);
  if (t < Infinity) d = d * t;
  return { distance: Math.max(0.05, d) };
}
