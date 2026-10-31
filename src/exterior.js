// exterior.js — P3c: 外観と外環境(build/exterior.glb ＋ build/exterior_manifest.json ＋ build/exterior_instances.bin ＋ build/tex/ext_*)。
//  - 建物の後に読み込む(読み込み前・失敗しても遊べる。その間は P3b の仮の夜空と平らな塊のまま)
//  - 外観の「階の帯」ExtBand_N は、その階の GLB が scene に出ていない時だけ見せる(出ている時は本物の階が同じ物を描く)
//  - 光: ベイクしない。月明かり(南西・曇り)と空の明るさを、外観・外環境の材質だけにシェーダで足す(屋内には効かない)
//  - 霧: 外観・外環境の材質だけ距離の霧(scene.fog とは別。屋内の濃い霧の中から窓越しに外を見ても遠景が溶けすぎない)
//  - 木: 近景は低ポリの針葉樹、中景は十字の板。どちらも InstancedMesh を方位×距離の塊に分けて視錐台で間引く
//  - 遠景: 山並み3層と街の夜景の帯はカメラに付いて動く(空と同じく無限遠の扱い)。街の灯りはわずかに瞬き、航空障害灯は点滅
//  - 屋内の奥では全部を描かない(main.js が show(false))。GTAO の法線パスからは遠景・中景の木を外す(アルファの板が四角く写るため)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// 外観・外環境の材質が共有する uniform(毎フレーム update が書き換える)
export const EXT_U = {
  uExtMoonDir: { value: new THREE.Vector3(0, 1, 0) },   // ビュー空間
  uExtUp: { value: new THREE.Vector3(0, 1, 0) },        // ビュー空間
  uExtMoonCol: { value: new THREE.Color(0, 0, 0) },
  uExtSkyCol: { value: new THREE.Color(0, 0, 0) },
  uExtGndCol: { value: new THREE.Color(0, 0, 0) },
  uExtFogCol: { value: new THREE.Color(0, 0, 0) },
  uExtFogDen: { value: 0.003 },
};
const DECL = `
uniform vec3 uExtMoonDir; uniform vec3 uExtUp; uniform vec3 uExtMoonCol; uniform vec3 uExtSkyCol; uniform vec3 uExtGndCol;
uniform vec3 uExtFogCol; uniform float uExtFogDen;`;
const LIGHT = `
{
  float nm = max(dot(normal, uExtMoonDir), 0.0);
  float nu = dot(normal, uExtUp) * 0.5 + 0.5;
  reflectedLight.indirectDiffuse += (uExtMoonCol * nm + mix(uExtGndCol, uExtSkyCol, nu)) * BRDF_Lambert(material.diffuseColor);
}`;
const FOG = `
{
  float fd = length(vViewPosition);
  float ff = 1.0 - exp(-uExtFogDen * uExtFogDen * fd * fd);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uExtFogCol, ff);
}`;

// 外観の材質に月明かり・空の明るさ(と外の霧)を足す。fog=false なら scene.fog のまま(階の GLB の外の塊)
export function extShade(m, { fog = true } = {}) {
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, EXT_U);
    if (m.userData.winGlow) sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>',
      '{ vec3 ec = texture2D(emissiveMap, vEmissiveMapUv).rgb; float l = dot(ec, vec3(0.3, 0.55, 0.15)); totalEmissiveRadiance *= 0.45 + 1.2 * mix(vec3(l), ec, 0.35); }');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + DECL)
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + LIGHT);
    if (fog) sh.fragmentShader = sh.fragmentShader.replace('#include <fog_fragment>', FOG);
  };
  m.customProgramCacheKey = () => 'n2ext' + (fog ? 'F' : 'S') + (m.userData.winGlow ? 'W' : '');
  if (fog) m.fog = false;
  m.needsUpdate = true;
}

const FOG_GLSL = `
uniform vec3 uExtFogCol; uniform float uExtFogDen;
vec3 extFog(vec3 c, float d) { float ff = 1.0 - exp(-uExtFogDen * uExtFogDen * d * d); return mix(c, uExtFogCol, ff); }`;

export class Exterior {
  // ctx: { scene, renderer, camera, world, look, envTex }
  constructor(ctx) {
    Object.assign(this, ctx);
    this.L = ctx.look.ext;
    this.ready = false;
    this.root = new THREE.Group(); this.root.name = 'Exterior';
    this.far = new THREE.Group(); this.far.name = 'ExteriorFar';   // カメラに付いて動く(山並み・街)
    this.bands = new Map();
    this.shown = true;
    this.time = 0;
    this.gtaoHidden = [];
    this.stats0 = {};
  }

  async load() {
    const t0 = performance.now();
    const man = this.man = await (await fetch('./build/exterior_manifest.json', { cache: 'no-cache' })).json();
    const [gltf, instBuf] = await Promise.all([
      new GLTFLoader().loadAsync('./build/' + man.glb),
      fetch('./build/' + man.instances, { cache: 'no-cache' }).then((r) => r.arrayBuffer()),
    ]);
    const L = this.L;
    const tex = (p, srgb) => this.world.texture(p, srgb);
    const mats = new Map();
    const prep = (m) => {
      if (mats.has(m)) return mats.get(m);
      const def = man.materials[m.name] || {};
      let out = m;
      if (m.name === 'M_GlassClear') {
        out = new THREE.MeshStandardMaterial({ name: m.name, color: 0x0b0e10, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.35, depthWrite: false, envMap: this.envTex, envMapIntensity: 0.15 });
      } else {
        if (def.map) { m.map = tex(def.map, true); m.color.setRGB(1, 1, 1); }
        if (def.tint) m.color.fromArray(def.tint);
        if (def.roughnessMap) { m.roughnessMap = tex(def.roughnessMap, false); m.roughness = 1; }
        if (def.normalMap) { m.normalMap = tex(def.normalMap, false); const s = def.normalScale ?? 1; m.normalScale.set(s, -s); }
        if (def.emissiveMap) { m.emissiveMap = tex(def.emissiveMap, true); m.emissive.setRGB(1, 1, 1); }
        if (def.opacity !== undefined) { m.transparent = true; m.opacity = Math.max(m.opacity < 1 ? m.opacity : def.opacity, 0.08); m.depthWrite = false; }
        m.lightMap = null;
        m.envMapIntensity = 0;
        if (m.metalness > 0.5) { m.envMap = this.envTex; m.envMapIntensity = this.look.metalEnv; }
        if (m.name === 'MX_WinGlass') { m.color.setRGB(0.1, 0.115, 0.125); m.opacity = 0.16; m.envMap = this.envTex; m.envMapIntensity = this.look.glassEnv * 0.5; m.roughness = 0.08; }
        if (m.name === 'MX_Bars' || m.name === 'XE_Fence') { m.alphaTest = 0.5; m.side = THREE.DoubleSide; m.transparent = false; }
        if (m.name === 'XE_WinGlow') {
          // カーテン越しの灯り: 色見本(カーテンの色)を電球色へ寄せて薄める(布を透かした光は色が浅い)
          m.color.setRGB(0, 0, 0); m.emissive.setRGB(...L.winGlow); m.emissiveIntensity = L.winGlowGain;
          m.userData.winGlow = true;
        }
        if (m.name === 'XE_CorrGlow') m.emissiveIntensity = L.corrGlow;
        if (m.name === 'XE_LobbyGlow') m.emissiveIntensity = L.lobbyGlow;
        if (m.name === 'XE_Lamp') m.emissiveIntensity = L.lampGlow;
        if (this.look.emissiveScale[m.name] !== undefined) m.emissiveIntensity *= this.look.emissiveScale[m.name];
        if (m.name === 'MX_WinOut') m.emissiveIntensity *= 0.15;
        extShade(m, { fog: true });
      }
      mats.set(m, out);
      return out;
    };
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    const byName = (n) => root.getObjectByName(n);
    const take = (o) => {   // 多材質のノードは Group(子に Mesh)。材質を整えて外す
      const meshes = [];
      o.traverse((c) => { if (c.isMesh) meshes.push(c); });
      for (const c of meshes) {
        c.material = prep(c.material);
        c.castShadow = false; c.receiveShadow = false;
        if (c.material.transparent) c.renderOrder = 2;
      }
      o.removeFromParent();
      return o;
    };
    // 階の帯・常時・外構・地形
    for (let lv = 1; lv <= 7; lv++) {
      const o = byName('ExtBand_' + lv);
      if (!o) continue;
      this.bands.set(lv, take(o));
      this.root.add(o);
    }
    this.always = take(byName('ExtAlways')); this.root.add(this.always);
    this.site = take(byName('Site')); this.root.add(this.site);
    this.terrain = take(byName('Terrain')); this.root.add(this.terrain);
    this.terrain.traverse((c) => { if (c.isMesh) c.receiveShadow = false; });
    // 木
    const inst = this._decodeInstances(instBuf, man.trees);
    this.trees = this._buildNearTrees([take(byName('TreeProto_0')), take(byName('TreeProto_1'))], inst.near);
    for (const m of this.trees) this.root.add(m);
    this.billboards = this._buildBillboards(byName('Billboard'), inst.bb);
    for (const m of this.billboards) this.root.add(m);
    // 遠景
    this.ridges = [];
    for (let i = 0; i < 3; i++) {
      const o = byName('Ridge_' + i);
      const mesh = o.isMesh ? o : o.getObjectByProperty('isMesh', true);
      mesh.removeFromParent();
      mesh.material = this._ridgeMaterial(i, man.ridges[i]);
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;   // 不透明の後(地形・木の奥は深度で捨てる)
      this.far.add(mesh); this.ridges.push(mesh);
    }
    {
      const o = byName('City');
      const mesh = o.isMesh ? o : o.getObjectByProperty('isMesh', true);
      mesh.removeFromParent();
      mesh.material = this._cityMaterial(man.materials.XE_City.map);
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      this.far.add(mesh); this.city = mesh;
    }
    // 灯りの溜まり(照明柱・ポーチ・張り出しの下)と灯りの点いた窓の漏れ
    this.pools = this._buildPools(man);
    this.root.add(this.pools);
    // 空
    this.skyTex = await new THREE.TextureLoader().loadAsync('./build/tex/ext_sky.webp');
    this.skyTex.mapping = THREE.EquirectangularReflectionMapping;
    this.skyTex.colorSpace = THREE.SRGBColorSpace;
    this.prevBackground = this.scene.background;
    this.scene.background = this.skyTex;
    this.scene.backgroundIntensity = L.skyGain / man.skyK;
    // 月の向き(世界)
    const az = THREE.MathUtils.degToRad(man.moon.azDeg), el = THREE.MathUtils.degToRad(man.moon.elDeg);
    this.moonWorld = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
    this._applyLook();
    this.scene.add(this.root);
    this.scene.add(this.far);
    // 遠景・中景の木は GTAO の法線パスに入れない
    this.gtaoHidden = [this.far, ...this.billboards];
    // 階の GLB の「他の階の外壁の塊」と仮の地面を隠す(この外観が代わりに描く)
    this.world.setExteriorReady(true);
    this.ready = true;
    this.loadMs = Math.round(performance.now() - t0);
    let tris = 0;
    this.root.traverse((c) => { if (c.isMesh && !c.isInstancedMesh) tris += (c.geometry.index ? c.geometry.index.count : c.geometry.attributes.position.count) / 3; });
    this.stats0 = { loadMs: this.loadMs, staticTris: tris, nearTrees: inst.near.length, billboards: inst.bb.length, treeMeshes: this.trees.length, bbMeshes: this.billboards.length };
    return this;
  }

  _applyLook() {
    const L = this.L;
    EXT_U.uExtMoonCol.value.setRGB(...L.moon);
    EXT_U.uExtSkyCol.value.setRGB(...L.sky);
    EXT_U.uExtGndCol.value.setRGB(...L.ground);
    EXT_U.uExtFogCol.value.setRGB(...L.fogColor);
    EXT_U.uExtFogDen.value = L.fogDensity;
    if (this.scene && this.man) this.scene.backgroundIntensity = L.skyGain / this.man.skyK;
    if (this.cityMat) this.cityMat.uniforms.uGain.value = L.cityGain;
  }

  _decodeInstances(buf, meta) {
    const dv = new DataView(buf);
    const nNear = dv.getUint32(4, true), nBB = dv.getUint32(8, true);
    const a = new Int16Array(buf, 12, nNear * 7 + nBB * 6);
    const near = [], bb = [];
    for (let i = 0; i < nNear; i++) {
      const o = i * 7;
      near.push({ x: a[o] / 10, y: a[o + 1] / 10, z: a[o + 2] / 10, h: a[o + 3] / 100, rot: a[o + 4] / 1000, v: a[o + 5], t: a[o + 6] / 1000 });
    }
    const b0 = nNear * 7;
    for (let i = 0; i < nBB; i++) {
      const o = b0 + i * 6;
      bb.push({ x: a[o] / 10, y: a[o + 1] / 10, z: a[o + 2] / 10, h: a[o + 3] / 100, v: a[o + 4], t: a[o + 5] / 1000 });
    }
    if (near.length !== meta.near || bb.length !== meta.billboards) console.warn('instances mismatch');
    return { near, bb };
  }

  // 方位(12)×距離(2)の塊に分ける(視錐台で間引くため)
  _chunks(list, cx, cz, r0) {
    const ch = new Map();
    for (const it of list) {
      const a = Math.atan2(it.z - cz, it.x - cx);
      const s = Math.floor(((a + Math.PI) / (2 * Math.PI)) * 12) % 12;
      const ring = Math.hypot(it.x - cx, it.z - cz) < r0 ? 0 : 1;
      const k = s * 2 + ring;
      if (!ch.has(k)) ch.set(k, []);
      ch.get(k).push(it);
    }
    return [...ch.values()];
  }

  _buildNearTrees(protos, list) {
    const [cx, cz] = this.man.terrain.center;
    const out = [];
    // 原型の2材質(幹・葉)を頂点色に焼いて1材質に(描画を塊×種類ごとの1回にする)
    const geoms = protos.map((p) => {
      const parts = [];
      p.traverse((c) => {
        if (!c.isMesh) return;
        const g = c.geometry.clone();
        c.updateMatrixWorld(true);
        g.applyMatrix4(c.matrixWorld);
        const col = c.material.color.clone();
        const n = g.attributes.position.count;
        const arr = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
        g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
        parts.push(g.index ? g.toNonIndexed() : g);
      });
      const m = mergeGeometries(parts, false);
      m.computeVertexNormals();
      return m;
    });
    const mat = new THREE.MeshStandardMaterial({ name: 'XE_TreeNear', vertexColors: true, roughness: 0.92, metalness: 0 });
    extShade(mat, { fog: true });
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    for (const chunk of this._chunks(list, cx, cz, 70)) {
      for (let v = 0; v < geoms.length; v++) {
        const items = chunk.filter((it) => it.v === v);
        if (!items.length) continue;
        const im = new THREE.InstancedMesh(geoms[v], mat, items.length);
        items.forEach((it, i) => {
          dummy.position.set(it.x, it.y, it.z);
          dummy.rotation.set((Math.sin(it.rot * 3.1) * 0.035), it.rot, (Math.cos(it.rot * 2.3) * 0.035));
          dummy.scale.set(it.h * (0.9 + 0.2 * ((it.rot * 7.3) % 1)), it.h, it.h * (0.9 + 0.2 * ((it.rot * 5.1) % 1)));
          dummy.updateMatrix();
          im.setMatrixAt(i, dummy.matrix);
          im.setColorAt(i, col.setScalar(it.t));
        });
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        im.castShadow = false; im.receiveShadow = false;
        im.name = 'NearTrees';
        out.push(im);
      }
    }
    return out;
  }

  _buildBillboards(proto, list) {
    const [cx, cz] = this.man.terrain.center;
    const src = proto.isMesh ? proto : proto.getObjectByProperty('isMesh', true);
    const geo = src.geometry.clone();
    const L = this.L;
    const map = this.world.texture(this.man.materials.XE_Billboard.map, true);
    map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
    const mat = new THREE.ShaderMaterial({
      name: 'XE_Billboard',
      uniforms: { map: { value: map }, uLight: { value: new THREE.Color(...L.treeLight) }, ...EXT_U },
      vertexShader: `
        attribute vec2 aInst; varying vec2 vUv; varying float vTint; varying float vH; varying float vD;
        void main() {
          vUv = vec2((uv.x + aInst.x) * 0.25, uv.y);
          vTint = aInst.y; vH = position.y;
          vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          vD = length(mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map; uniform vec3 uLight; ${FOG_GLSL}
        varying vec2 vUv; varying float vTint; varying float vH; varying float vD;
        void main() {
          vec4 t = texture2D(map, vUv);
          if (t.a < 0.5) discard;
          vec3 c = t.rgb * uLight * vTint * (0.7 + 0.45 * vH);
          gl_FragColor = vec4(extFog(c, vD), 1.0);
        }`,
      side: THREE.DoubleSide,
    });
    this.bbMat = mat;
    const out = [];
    const dummy = new THREE.Object3D();
    for (const chunk of this._chunks(list, cx, cz, 450)) {
      const g = geo.clone();
      const aInst = new Float32Array(chunk.length * 2);
      const im = new THREE.InstancedMesh(g, mat, chunk.length);
      chunk.forEach((it, i) => {
        dummy.position.set(it.x, it.y, it.z);
        dummy.rotation.set(0, (it.x * 0.37 + it.z * 0.11) % 6.283, 0);
        dummy.scale.setScalar(it.h);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
        aInst[i * 2] = it.v; aInst[i * 2 + 1] = it.t;
      });
      g.setAttribute('aInst', new THREE.InstancedBufferAttribute(aInst, 2));
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.castShadow = false; im.receiveShadow = false;
      im.name = 'Billboards';
      out.push(im);
    }
    return out;
  }

  _ridgeMaterial(i, def) {
    const L = this.L;
    return new THREE.ShaderMaterial({
      name: 'XE_Ridge' + i,
      uniforms: { uBase: { value: new THREE.Color(...L.ridgeBase) }, uHaze: { value: new THREE.Color(...L.fogColor) }, uK: { value: def.haze },
        uCity: { value: new THREE.Color(...L.cityGlow) }, uCityAz: { value: THREE.MathUtils.degToRad((this.man.city.az0 + this.man.city.az1) / 2) }, uLayer: { value: i } },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform vec3 uBase; uniform vec3 uHaze; uniform float uK; uniform vec3 uCity; uniform float uCityAz; uniform float uLayer;
        varying vec3 vP;
        void main() {
          float a = atan(vP.z, vP.x);
          float d = abs(atan(sin(a - uCityAz), cos(a - uCityAz)));
          vec3 c = mix(uBase, uHaze, uK);
          c += uCity * exp(-d * d / 0.18) * (0.4 + 0.6 * uLayer * 0.5) * (1.0 - smoothstep(-300.0, 200.0, vP.y) * 0.5);
          gl_FragColor = vec4(c, 1.0);
        }`,
      depthWrite: true,
    });
  }

  _cityMaterial(mapPath) {
    const L = this.L;
    const map = this.world.texture(mapPath, true);
    map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
    map.anisotropy = 4;
    this.cityMat = new THREE.ShaderMaterial({
      name: 'XE_City',
      uniforms: { map: { value: map }, uTime: { value: 0 }, uGain: { value: L.cityGain }, uBody: { value: new THREE.Color(...L.cityBody) } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform sampler2D map; uniform float uTime; uniform float uGain; uniform vec3 uBody; varying vec2 vUv;
        float hash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
        void main() {
          vec4 t = texture2D(map, vUv);
          if (t.a < 0.5) discard;
          vec2 cell = floor(vUv * vec2(2048.0, 256.0) / 2.0);
          float h = hash(cell);
          float tw = 0.78 + 0.22 * sin(uTime * (0.6 + 2.2 * h) + h * 60.0);
          float red = step(0.35, t.r) * step(t.g * 5.0, t.r);
          float blink = mix(1.0, step(0.55, fract(uTime * 0.45 + h)), red);
          gl_FragColor = vec4(uBody + t.rgb * uGain * tw * blink, 1.0);
        }`,
    });
    return this.cityMat;
  }

  // 地面の灯りの溜まり(加算。照明柱・ポーチの先・張り出しの下)
  _buildPools(man) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const g = cv.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.45)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(cv);
    const L = this.L;
    const defs = [];
    for (const [x, y, z] of man.poleLights) defs.push({ x, z, y: 0.012, r: 6.5, c: L.poolPole });
    defs.push({ x: 17.6, z: 31.4, y: 0.013, r: 3.6, c: L.poolPorch });
    defs.push({ x: man.pilotisLight[0], z: man.pilotisLight[2], y: 0.012, r: 3.2, c: L.poolPilotis });
    const geos = [];
    for (const d of defs) {
      const p = new THREE.PlaneGeometry(d.r * 2, d.r * 2).rotateX(-Math.PI / 2).translate(d.x, d.y, d.z);
      const n = p.attributes.position.count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.set(d.c, i * 3);
      p.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geos.push(p);
    }
    const mat = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: true,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const m = new THREE.Mesh(mergeGeometries(geos, false), mat);
    m.name = 'LightPools'; m.renderOrder = 3;
    return m;
  }

  // 階の GLB が scene に出ている階の帯は隠す
  _syncBands() {
    for (const [lv, o] of this.bands) {
      const rec = this.world.floors.get(lv);
      const real = !!(rec && rec.group && rec.group.parent);
      o.visible = !real;
    }
  }

  show(on) {
    if (!this.ready) return;
    if (this.force === true || this.force === false) on = this.force;   // 計測・テスト用(null で通常)
    this.shown = on;
    this.root.visible = on;
    this.far.visible = on;
  }

  // 毎フレーム
  update(dt, camera) {
    if (!this.ready) return;
    this.time += dt;
    this._syncBands();
    camera.updateMatrixWorld();
    const inv = camera.matrixWorldInverse;
    EXT_U.uExtMoonDir.value.copy(this.moonWorld).transformDirection(inv);
    EXT_U.uExtUp.value.set(0, 1, 0).transformDirection(inv);
    const cp = camera.getWorldPosition(_v);
    this.far.position.set(cp.x, 0, cp.z);
    if (this.cityMat) this.cityMat.uniforms.uTime.value = this.time;
  }

  // GTAO の法線パスの前後で遠景・中景の木を出し入れ
  gtaoBegin() { this._gtaoVis = this.gtaoHidden.map((o) => o.visible); for (const o of this.gtaoHidden) o.visible = false; }
  gtaoEnd() { this.gtaoHidden.forEach((o, i) => { o.visible = this._gtaoVis[i]; }); }

  stats() {
    if (!this.ready) return { ready: false };
    const bands = {};
    for (const [lv, o] of this.bands) bands[lv] = o.visible;
    return { ready: true, shown: this.shown, bands, ...this.stats0 };
  }
}
const _v = new THREE.Vector3();
