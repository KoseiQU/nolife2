// story.js — P5b-1: 物語の状態機械(DESIGN §3.8 G・H「章構成と解放の連鎖 v3」の 11 段)。動線の骨組み。
//  - 段 1〜11・持ち物(鍵 1 本)・解放(roofA・entranceOut・物語の扉・キーボックス・グローブボックス)・チェックポイント(各段の開始時)
//  - 目標の常時表示(hud_text.objective)と持ち物の札、拾う/鍵を使う/調べる/戻る/乗る(画面ガイドの対象 = hud.storyTarget)
//  - 221 と 6F の罠 3 室の奥の窓際のロッカーからの飛び出し(ai.lockerBurst = ワープ。P5b-1b: 扉がゆっくり開いて中が見えてから)。
//    P5b-1b: 221 は初回、奥へ進むと出る → 逃げ切ると机に小さな鍵。冒頭の見せ場(初めて 410 から廊下へ出ると 4F の EV の管理人 → 2F へ)、705 の別空間からの最終追跡(階段で追う)、
//    最後だけ敷地まで追う管理人(ai.portals に正面玄関)、黒い車でのエンディング
//  - 別空間(異世界 4 空間の差し替え口): enterSpace(id)/leaveSpace()。中身は src/spaces/<key>.js(P5b-2a: 105 の長い廊下、P5b-4: 312 の無限の自室、P5b-2b: 705 の柱の広間・B1 のトンネル)。
//    戻る口・空間の中の扉・この空間で死んだ時の戻り先・物の置き場所の移動は spaces.exits/target/respawn/slotPos に聞く
//  - デバッグ: ?stage=N でその段の開始状態から。window.__N2.story で状態(state())と操作(applyStage・give・unlockDoor・enterSpace…)
//  モード: 'play'(通常・?test=story)/ 'tour'(?tour: 全部解放・別空間にも入れる・目標なし)/ 'off'(他のテスト: 物語の扉は施錠のまま、他は何もしない)
import * as THREE from 'three';
import { HUD_TEXT } from './hud_text.js';
import { levelY, isSpace, FACING_N } from './world.js';
import { SPACE_DEFS } from './spaces.js';
import * as P from './story_props.js';
import { InsideWatcher } from './watcher.js';   // P5b-2b: 第7段の窓の内側から見下ろす管理人

export const STORY = {
  reach: 1.45,            // 拾う・使うの距離(カメラから水平)
  facing: 0.6,            // 視線と対象の向きの cos
  trapDist: 1.2,          // 罠の部屋: 机の上の「鍵に見える物」にこの距離まで近づくとクローゼットから管理人
  trapRooms: ['601', '606', '611'],   // 互いに隣り合わない 3 室(601 西棟西列・606 南棟・611 東ブロック)
  keyRoom6F: '609',       // 220 の鍵(罠でない部屋。南棟の東端)
  fade: 0.22,             // 別空間の出入りの暗転(片道・秒)
  siteChaseDist: 6.0,     // 第11段: 敷地へ出て玄関からこれだけ離れたら管理人が玄関から追ってくる
  chaseAppearDelay: 0.5,  // 第9段: 鍵を取ってから管理人が背後に現れるまで
  // P5b-1b 221 の組み替え: 初回は 221 の奥(玄関の壁から u 3.5m = 洋室の入口 LIVING_U0)へ進むと奥の窓際のロッカーから管理人(鍵は拾わない)。
  //  逃げ切る(追跡が解ける・階を変える)と奥の机に小さな鍵が現れる(sub: null → 'flee' → 'return')
  burst221U: 3.5,
  // P5b-1b 冒頭の見せ場: 410 の戸口(扉の面 x 7.8・z 7.25)を廊下側へこれだけ越えたら(初回だけ)。管理人は 4F の EV ホール(enemy_ai AI.intro)
  introDoor: { x: 7.8, z: 7.25, out: 0.12, half: 0.6 },
};
// 段の開始位置(チェックポイント・?stage=N)。yaw 0 = 北(−z)
export const SPAWN = {
  1: { level: 4, x: 8.75, z: 7.3, yaw: Math.PI / 2 },       // 410 の玄関(扉を向く)
  2: { level: 2, x: 21.65, z: 21.2, yaw: Math.PI / 2 },     // 221 の前の廊下(西=EV の方を向く)
  3: { level: 1, x: 20.9, z: 24.6, yaw: -Math.PI / 2 },     // 管理室(東の壁のキーボックスを向く)
  4: { level: 3, x: 6.9, z: 7.25, yaw: -Math.PI / 2 },      // 312 の前(扉を向く)
  5: { level: 6, x: 6.9, z: 20.7, yaw: 0 },                 // 6F の EV ホール
  6: { level: 2, x: 24.55, z: 21.2, yaw: 0 },               // 220 の前(扉を向く)
  7: { level: 1, x: 17.6, z: 24.2, yaw: Math.PI },          // 1F ロビー(正面玄関を向く)
  8: { level: 4, x: 8.75, z: 7.3, yaw: -Math.PI / 2 },      // 410 の玄関(窓の方を向く)
  9: { level: 7, x: 18.8, z: 21.2, yaw: -Math.PI / 2 },     // 7F の 705 の手前(東を向く)
  '9c': { level: 7, x: 16.2, z: 21.2, yaw: Math.PI / 2 },   // 最終追跡の途中で死んだ時: 705 の西の廊下(外階段の方を向く)
  10: { level: 1, x: 6.9, z: 7.0, yaw: 0 },                 // 食堂(奥の地下への階段の方を向く)
  11: { level: 1, x: 17.6, z: 24.2, yaw: Math.PI },         // 1F ロビー(正面玄関を向く)
};
// 段の開始時に持っている鍵
const START_ITEM = { 1: null, 2: 'small', 3: '312', 4: '105', 5: null, 6: '220', 7: 'entrance', 8: 'padlock', 9: '705', 10: 'b1', 11: 'car' };
// 解放(この段から開いている)
const UNLOCK_AT = { KEYBOX: 3, 312: 4, 105: 5, 220: 7, KEYSWITCH: 8, GLOVEBOX: 8, PADLOCK: 9, 705: 10, B1DOOR: 11 };
// 鍵穴(扉・箱)と鍵
const LOCKS = { 312: '312', 105: '105', 220: '220', 705: '705', B1DOOR: 'b1', KEYBOX: 'small', KEYSWITCH: 'entrance', PADLOCK: 'padlock' };
const SPACE_OF_DOOR = { 105: 'X105', 312: 'X312', 705: 'X705', B1DOOR: 'XB1' };
const STORY_DOORS = ['105', '220', '312', '705', 'B1DOOR'];
const KEYBOX = { x: 21.876, z: 24.85, y: 1.5 };            // 管理室の東の壁(焼いたキーボックスの前に重ねる)
const KEYSWITCH = { x: 19.54, z: 27.72, y: 1.12 };         // 風除室の外側ドアの脇(東の壁の南端。正面は西)
const PADLOCK = { x: 14.72, z: 5.875, y: 1.12 };           // 410 のバルコニーの隔て板(バルコニー側の面の外寄り)
const ROOF_KEY = { x: 2.0, z: 0.5 };                       // 屋上A(北のパラペットの近く)

export class Story {
  // ctx: { mode, world, building, scene, camera, player, ai, hud, rooms, elevator, doorFx, flags, spaces, audio(EnemyAudio), viewLock,
  //        teleport(level, x, z, yaw), getLevel(), envTex, aiControl }
  constructor(ctx) {
    Object.assign(this, ctx);
    P.setPropEnv(this.envTex);
    this.time = 0;
    this.stage = 1; this.sub = null; this.item = null;
    this.unlocked = new Set(); this.taken = new Set(); this.traps = new Set();
    this.events = []; this.logCount = 0;
    this.trans = null; this.ending = null; this.ended = false;
    this.siteChased = false; this.pending = [];
    this.burst221 = false;    // P5b-1b: 221 の奥のロッカーから出たか(第1段の初回。逃げる途中で死ぬと戻す)
    this.introDone = false;   // P5b-1b: 冒頭の見せ場(4F の EV の管理人)を見せたか。死亡しても戻さない(繰り返さない)
    this.group = new THREE.Group(); this.group.name = 'StoryProps';
    this.scene.add(this.group);
    this._buildFade();
    this._buildPickups();
    this._buildProps();
    // 物語の扉は鍵で開くまで施錠(見学モードでは全部開く)
    for (const id of STORY_DOORS) {
      const d = this.world.doorById.get(id);
      if (!d) continue;
      if (this.mode === 'tour') this.unlockDoor(id, { open: 0, quiet: true });
      else { d.locked = true; d.storyLock = true; }
    }
    if (this.mode === 'tour') { this.flags.roofA = true; this.flags.entranceOut = true; }
  }

  log(ev, extra = {}) { this.logCount++; this.events.push({ n: this.logCount, t: +this.time.toFixed(2), ev, stage: this.stage, ...extra }); if (this.events.length > 300) this.events.shift(); }
  get active() { return this.mode === 'play'; }
  get evDisabled() { return this.active && (this.sub === 'chase' || this.stage >= 10); }
  objectiveKey() {
    if (this.ended) return 'end';
    if (this.stage === 1 && this.sub === 'memo') return '1m';
    if (this.stage === 1 && this.sub === 'flee') return '1f';     // P5b-1b
    if (this.stage === 1 && this.sub === 'return') return '1r';
    if (this.stage === 4 && this.getLevel() === 'X105') return '4x';
    if (this.stage === 9 && this.sub === 'chase') return '9c';
    return this.stage;
  }

  // ================================================================ 物
  _room(id) { for (const f of this.building.floors) { const r = f.rooms.find((q) => q.id === id); if (r) return { r, level: f.level }; } return null; }
  _buildPickups() {
    this.pickups = [];
    const T = HUD_TEXT.story.tags;
    const add = (o) => { o.mesh.position.copy(o.pos); if (o.rotY) o.mesh.rotation.y = o.rotY; this.group.add(o.mesh); this.pickups.push(o); return o; };
    const desk = (rid) => { const { r, level } = this._room(rid); const [x, z] = r.interior.points.desk; return { level, pos: new THREE.Vector3(x, levelY(level) + 0.722, z) }; };
    // 1: 1F 食堂の卓の上のメモ(2026-11-01 ユーザー指示: スタート地点でなく食堂に)・221 の机の小さな鍵
    add({ id: 'memo221', memo: 'memo221', level: 1, pos: new THREE.Vector3(4.15, levelY(1) + 0.705, 8.15), rotY: 0.3, mesh: P.makeMemo(['221']), takenAt: 2, need: () => this.stage === 1 && this.sub === 'memo' });
    // P5b-1b: 小さな鍵は初回は無い(見せない)。221 の奥のロッカーから出た管理人から逃げ切ると机の上に現れる
    { const d = desk('221'); add({ id: 'small', item: 'small', ...d, rotY: 2.2, mesh: P.makeKey(T.small, { small: true }), takenAt: 2,
      need: () => this.stage === 1 && this.sub === 'return', showIf: () => this.stage > 1 || this.sub === 'return' }); }
    // 3: X312 の床の 105 の鍵 / 4: X105 のメモ
    // P5b-4: 105 の鍵は X312 の 5 部屋目(R5)の机(R5 にいる時だけ拾える = spaces.canPick)。メモは X105 の出口の扉の手前
    add({ id: 'k105', item: '105', level: 'X312', space: 'X312', slot: 'key', pos: SPACE_DEFS.X312.at('key'), rotY: 0.8, mesh: P.makeKey('105'), takenAt: 4,
      need: () => this.spaces.canPick('X312', 'key', this.camera.position) });
    add({ id: 'memo6F', memo: 'memo6F', level: 'X105', space: 'X105', slot: 'memo', pos: SPACE_DEFS.X105.at('memo'), rotY: -0.3, mesh: P.makeMemo(['鍵は', '6階の', 'どこかの部屋']), takenAt: 5 });
    // 5: 609 の机の 220 の鍵・罠の 3 室の机の「鍵に見える物」(札だけの古い鍵)
    { const d = desk(STORY.keyRoom6F); add({ id: 'k220', item: '220', ...d, rotY: 1.1, mesh: P.makeKey('220'), takenAt: 6 }); }
    for (const rid of STORY.trapRooms) { const d = desk(rid); add({ id: 'decoy' + rid, decoy: rid, ...d, rotY: 0.6 + rid.length, mesh: P.makeKey(rid, { tagColor: '#d8cfb8' }), takenAt: 99 }); }
    // 6: 220 の机の正面玄関の鍵
    { const d = desk('220'); add({ id: 'kEntrance', item: 'entrance', ...d, rotY: 2.6, mesh: P.makeKey(T.entrance), takenAt: 7 }); }
    // 8: 屋上A の 705 の鍵
    add({ id: 'k705', item: '705', level: 4, pos: new THREE.Vector3(ROOF_KEY.x, levelY(4) + 0.004, ROOF_KEY.z), rotY: 0.3, mesh: P.makeKey('705'), takenAt: 9 });
    // 9: X705 の机の地下の鉄扉の鍵 / 10: XB1 のフックの車のキー
    add({ id: 'kB1', item: 'b1', level: 'X705', pos: SPACE_DEFS.X705.at('key'), rotY: 1.9, mesh: P.makeKey(T.b1), takenAt: 10 });
    { const k = P.hangKey(P.makeKey(T.car)); k.rotation.y = Math.PI; add({ id: 'kCar', item: 'car', level: 'XB1', pos: SPACE_DEFS.XB1.at('key'), mesh: k, takenAt: 11 }); }
  }
  _buildProps() {
    // 管理室のキーボックス(東の壁 = 正面は西)
    const kb = this.keybox = P.makeKeybox();
    kb.position.set(KEYBOX.x, levelY(1) + KEYBOX.y, KEYBOX.z); kb.rotation.y = -Math.PI / 2;
    this.group.add(kb);
    kb.updateMatrixWorld(true);
    const hk = kb.localToWorld(kb.userData.hooks['312'].clone());
    const k312 = P.hangKey(P.makeKey('312'));
    this.pickups.push({ id: 'k312', item: '312', level: 1, pos: hk, mesh: k312, takenAt: 3, need: () => this.unlocked.has('KEYBOX') });
    k312.position.copy(hk); this.group.add(k312);
    // 風除室の鍵スイッチ(南の壁の内側 = 正面は北)
    const ks = this.keyswitch = P.makeKeySwitch();
    ks.position.set(KEYSWITCH.x, levelY(1) + KEYSWITCH.y, KEYSWITCH.z); ks.rotation.y = -Math.PI / 2;
    this.group.add(ks);
    // 410 の隔て板の南京錠(バルコニー側)
    const pl = this.padlock = P.makePadlock(); pl.scale.setScalar(1.3);
    pl.position.set(PADLOCK.x, levelY(4) + PADLOCK.y, PADLOCK.z);
    this.group.add(pl);
    // 黒い車の開いた扉(グローブボックスを開けた後)
    const car = this.building.site.cars[0];
    const [cx, cz, cw, cd] = car.rect;
    const cd0 = this.carDoor = P.makeCarDoor();
    cd0.position.set(cx + cw * 0.64, 0.0, cz + cd); cd0.rotation.y = 0.95; cd0.visible = false;   // 運転席(右・南側)の扉。前の蝶番で外へ開く
    const dome = new THREE.PointLight(0xffd9a8, 0.9, 3.2, 2); dome.position.set(cx + cw * 0.5, 1.15, cz + cd * 0.5); dome.castShadow = false;   // 室内灯(扉が開いている間)
    cd0.userData.dome = dome; this.group.add(dome); dome.visible = false;
    this.group.add(cd0);
    // 地下の鉄扉の奥の闇(踊り場の西。開いた時だけ)
    const v = this.b1void = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.3, 1.4), new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide }));
    const bd = this.world.doorById.get('B1DOOR');
    v.position.set(bd.pos[0] - 0.75, levelY('B1') + 1.15, bd.pos[1]); v.visible = false;
    this.group.add(v);
  }

  // 見せる物(段・取ったか・階)
  _visible(pk, lv) {
    if (this.taken.has(pk.id)) return false;
    if (this.mode === 'off') return false;
    if (pk.showIf && this.mode === 'play' && !pk.showIf()) return false;   // P5b-1b: 221 の小さな鍵は逃げ切るまで無い
    const vis = (pk.level === lv) || (typeof lv === 'number' && typeof pk.level === 'number' && Math.abs(pk.level - lv) <= 1);
    return vis;
  }
  _pickable(pk) { return !this.taken.has(pk.id) && (!pk.need || pk.need()) && this.mode === 'play'; }

  // ================================================================ 画面ガイドの対象
  target() {
    if (this.mode === 'off' || this.trans || this.ending) return null;
    const lv = this.getLevel(), cam = this.camera, p = cam.position;
    const fwd = cam.getWorldDirection(new THREE.Vector3()); fwd.y = 0; fwd.normalize();
    const look = (x, z, reach = STORY.reach) => {
      const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
      if (d > reach) return -1;
      if (d < 0.25) return d;
      return (dx * fwd.x + dz * fwd.z) / d >= STORY.facing ? d : -1;
    };
    const S = HUD_TEXT.story;
    let best = null, bd = 1e9;
    const cand = (d, t) => { if (d >= 0 && d < bd) { bd = d; best = t; } };
    if (this.active) {
      for (const pk of this.pickups) {
        if (pk.level !== lv || !this._pickable(pk) || this.taken.has(pk.id)) continue;
        cand(look(pk.pos.x, pk.pos.z), { kind: 'story', sk: 'pick', pk, items: [S.pick] });
      }
      // 鍵穴(扉・箱)
      if (lv === 1) {
        if (!this.unlocked.has('KEYBOX')) cand(look(KEYBOX.x, KEYBOX.z), { kind: 'story', sk: 'lock', lock: 'KEYBOX', items: [this.item === 'small' ? S.useKey : S.look] });
        if (!this.unlocked.has('KEYSWITCH')) cand(look(KEYSWITCH.x, KEYSWITCH.z, 1.2), { kind: 'story', sk: 'lock', lock: 'KEYSWITCH', items: [this.item === 'entrance' ? S.useKey : S.look] });
      }
      if (lv === 4 && !this.flags.roofA) {
        const g = this.rooms.gates.find((q) => q.id === 'gate410');
        if (g && this.player.pos.z > 5.86) {
          const [sx0, sz0, sx1, sz1] = g.step;
          const d = Math.min(look(PADLOCK.x, PADLOCK.z, 1.6), look((sx0 + sx1) / 2, (sz0 + sz1) / 2, 1.2) >= 0 ? 0.9 : -1);
          if (d >= 0 || look(PADLOCK.x, PADLOCK.z, 1.6) >= 0) cand(Math.max(0, d), { kind: 'story', sk: 'lock', lock: 'PADLOCK', items: [this.item === 'padlock' ? S.useKey : S.look] });
        }
      }
      for (const id of STORY_DOORS) {
        const d = this.world.doorById.get(id);
        if (!d || d.level !== lv || this.unlocked.has(id) || this.item !== LOCKS[id]) continue;
        cand(look(d.pos[0], d.pos[1], 1.5), { kind: 'story', sk: 'lock', lock: id, items: [S.useKey] });
      }
      if (lv === 'G') {
        this.building.site.cars.forEach((c, i) => {
          const [x, z, w, dd] = c.rect;
          const cx = THREE.MathUtils.clamp(p.x, x, x + w), cz = THREE.MathUtils.clamp(p.z, z, z + dd);
          const d = Math.hypot(cx - p.x, cz - p.z);
          if (d > 1.3) return;
          const dir = (( (x + w / 2) - p.x) * fwd.x + ((z + dd / 2) - p.z) * fwd.z) / Math.max(0.01, Math.hypot(x + w / 2 - p.x, z + dd / 2 - p.z));
          if (dir < 0.2 && d > 0.4) return;
          cand(d, { kind: 'story', sk: 'car', car: i, items: [i === 0 && this.item === 'car' ? S.ride : S.look] });
        });
      }
    }
    if (isSpace(lv)) {
      // P5b-2a: 戻る口と空間の中の扉はモジュールに聞く
      for (const e of this.spaces.exits(lv)) if (e.reach > 0) cand(look(e.x, e.z, e.reach), { kind: 'story', sk: 'back', exit: e, items: [S.back] });
      if (this.mode !== 'off') { const st = this.spaces.target(lv, look); if (st) cand(st.d, { kind: 'story', sk: 'space', st, items: st.items }); }
    }
    return best;
  }

  use(t) {
    const S = HUD_TEXT.story;
    if (!t || t.kind !== 'story') return null;
    if (t.sk === 'pick') return this.pick(t.pk.id);
    if (t.sk === 'back') { this.leaveSpace(t.exit); return 'back'; }
    if (t.sk === 'space') return t.st.use();
    if (t.sk === 'car') return this.useCar(t.car);
    if (t.sk === 'lock') {
      const need = LOCKS[t.lock];
      if (this.item !== need) {
        const msg = t.lock === 'KEYBOX' ? S.keyboxLocked : t.lock === 'KEYSWITCH' ? S.keyswitch : t.lock === 'PADLOCK' ? S.padlock : HUD_TEXT.door.lockedOther;
        this.hud.flash(msg); this._sfx('rattle');
        return 'locked';
      }
      this.useKey(t.lock);
      return 'unlocked';
    }
    return null;
  }

  // ================================================================ 操作
  pick(id) {
    const pk = this.pickups.find((q) => q.id === id);
    if (!pk || this.taken.has(id)) return null;
    this.taken.add(id);
    pk.mesh.visible = false;
    const S = HUD_TEXT.story;
    this.log('pick', { id });
    if (pk.decoy) { this.hud.flash(S.decoy); this._sfx('key'); return 'decoy'; }
    if (pk.memo) {
      this._sfx('paper');
      this.hud.flash(pk.memo === 'memo221' ? S.memo221 : S.memo6F, 2.2);
      if (pk.memo === 'memo221' && this.sub === 'memo') { this.sub = null; this.log('stage', { stage: 1, sub: null }); }   // 先に 221 で出会っていたら段はそのまま
      if (pk.memo === 'memo6F') this.setStage(5);
      return 'memo';
    }
    this.item = pk.item;
    this._sfx('key');
    this.hud.flash(S.got(S.tags[pk.item]), 1.4);
    if (pk.item === 'small') this.setStage(2);   // P5b-1b: 逃げ切ってから戻って拾う(飛び出しは奥へ進んだ時 = _check221)
    else if (pk.item === '312') this.setStage(3);
    else if (pk.item === '105') this.setStage(4);
    else if (pk.item === '220') this.setStage(6);
    else if (pk.item === 'entrance') this.setStage(7);
    else if (pk.item === '705') this.setStage(9);
    else if (pk.item === 'b1') this._startFinalChase();
    else if (pk.item === 'car') this.setStage(11);
    return 'key';
  }

  useKey(lock) {
    const S = HUD_TEXT.story;
    this.log('use_key', { lock, item: this.item });
    this.item = null;
    this.hud.flash(S.used);
    this._sfx('unlock');
    if (lock === 'KEYBOX') { this.unlocked.add('KEYBOX'); return; }
    if (lock === 'KEYSWITCH') { this.unlocked.add('KEYSWITCH'); this.flags.entranceOut = true; this._applyEntrance(); this.hud.flash(S.keyswitchOn, 1.6); return; }
    if (lock === 'PADLOCK') { this.unlocked.add('PADLOCK'); this.flags.roofA = true; return; }
    this.unlockDoor(lock);
  }

  // 物語の扉の解錠: 開くようにして「少し開く」。別空間の扉は奥に闇の箱(戸口から奥が見えない)
  unlockDoor(id, { open = 0.5, quiet = false } = {}) {
    const d = this.world.doorById.get(id);
    if (!d) return false;
    d.locked = false; d.storyLock = false; d.operable = true; d.openAngle = 1.75; d.target = Math.max(d.target, open); d.speedMul = 0.5;
    d.sealed = false; d.tryable = false;
    if (SPACE_OF_DOOR[id] && typeof d.level === 'number' && this.doorFx) this.doorFx.prepare(id);
    if (id === 'B1DOOR') this._b1Gap(true);
    this.unlocked.add(id);
    if (!quiet) this.log('unlock_door', { id });
    return true;
  }
  // 物語の扉を施錠に戻す(?stage・テストで前の段へ戻る時)
  lockDoor(id) {
    const d = this.world.doorById.get(id);
    if (!d) return;
    d.locked = true; d.storyLock = true; d.target = 0; d.angle = 0; d.speedMul = 1;
    if (id !== '220') { d.operable = false; d.openAngle = 0; }
    if (id === 'B1DOOR') { d.sealed = true; d.tryable = true; this._b1Gap(false); }
    if (d.collision) d.collision.disabled = false;
    if (d.node) { d.node.rotation.set(0, 0, 0); }
    this.unlocked.delete(id);
  }
  // 地下の踊り場の西の外周の壁(扉の外側に重なる当たり)に、扉の幅の切れ目を作る/戻す
  _b1Gap(open) {
    const cols = this.world.collisions('B1'), d = this.world.doorById.get('B1DOOR');
    if (!this._b1Wall) {
      this._b1Wall = cols.find((b) => b.kind === 'wall' && b.maxX <= d.pos[0] + 0.001 && b.minX < d.pos[0] - 0.05 && b.minZ < d.pos[1] - 0.5 && b.maxZ > d.pos[1] + 0.5);
      if (!this._b1Wall) return;
      const w = this._b1Wall, h = (d.width || 0.9) / 2;
      this._b1Split = [{ ...w, maxZ: d.pos[1] - h, disabled: true }, { ...w, minZ: d.pos[1] + h, disabled: true }];
      cols.push(...this._b1Split);
    }
    this._b1Wall.disabled = open;
    for (const b of this._b1Split) b.disabled = !open;
  }
  _applyEntrance() { const d = this.world.doorById.get('ENTRANCE_OUT'); if (d) d.locked = !this.flags.entranceOut; P.setKeySwitchOn(this.keyswitch, this.flags.entranceOut); }

  useCar(i) {
    const S = HUD_TEXT.story;
    if (i !== 0) { this.hud.flash(S.carLocked); this._sfx('rattle'); this.log('car', { i, r: 'locked' }); return 'locked'; }
    if (this.item === 'car') { this.startEnding(); return 'ride'; }
    if (this.stage === 7 && !this.unlocked.has('GLOVEBOX')) {
      this.unlocked.add('GLOVEBOX');
      this.carDoor.visible = true;
      this.item = 'padlock';
      this._sfx('car');
      this.hud.flash(S.glovebox, 1.8);
      this.log('car', { i, r: 'glovebox' });
      this.setStage(8);
      return 'glovebox';
    }
    this.hud.flash(this.unlocked.has('GLOVEBOX') ? (this.stage >= 11 ? S.noEngine : S.carEmpty) : S.carLocked);
    this._sfx('rattle');
    return 'locked';
  }

  // ================================================================ 段
  setStage(n, sub = null) {
    this.stage = n; this.sub = sub;
    this.log('stage', { stage: n, sub });
    if (n >= 10 && this.aiControl) { this.ai.allowStairs = false; this.ai.noEV = false; this.ai.portals = this.ai.portals.filter((p) => p.id !== 'X705'); }
    if (n === 11 && this.aiControl) this._addEntrancePortal();
  }
  _addEntrancePortal() {
    if (this.ai.portals.some((p) => p.id === 'entrance')) return;
    this.ai.portals.push({ id: 'entrance', a: { lv: 1, x: 17.6, z: 27.5 }, b: { lv: 'G', x: 17.6, z: 28.9 } });
  }
  _startFinalChase() {
    this.stage = 9; this.sub = 'chase';
    this.log('stage', { stage: 9, sub: 'chase' });
    if (!this.aiControl) return;
    this.ai.allowStairs = true; this.ai.noEV = true;
    const D = SPACE_DEFS.X705;
    if (!this.ai.portals.some((p) => p.id === 'X705')) this.ai.portals.push({ id: 'X705', a: { lv: 'X705', x: D.exit.x, z: D.exit.z + 0.5 }, b: { lv: 7, x: D.back.x, z: D.back.z } });
    this.pending.push({ t: STORY.chaseAppearDelay, fn: () => {
      const a = this.getLevel() === 'X705' ? D.at('ambush') : null;
      if (a) this.ai.appear({ level: 'X705', x: a.x, z: a.z, lock: 1.0, recover: 1.5, label: 'appear_705' });
      else this.ai.appear({ level: 7, x: D.back.x, z: D.back.z, lock: 0.8, recover: 1.2, label: 'appear_705' });
    } });
  }

  // ?stage=N / テスト: その段の開始状態へ(必要な解放と鍵)
  applyStage(n, { teleport = true } = {}) {
    n = Math.max(1, Math.min(11, n | 0));
    this.ended = false; this.ending = null; this.trans = null; this.pending = []; this.siteChased = false;
    this.introDone = n > 1;
    this.burst221 = n > 1;
    if (this.rooms.resetBursts) this.rooms.resetBursts();   // P5b-1b: 奥の窓際のロッカーの扉を閉じる(221・罠の部屋)
    this.stage = n; this.sub = n === 1 ? 'memo' : null; this.item = START_ITEM[n];
    this.taken.clear();
    for (const pk of this.pickups) { if (pk.takenAt <= n) this.taken.add(pk.id); pk.mesh.visible = true; }
    this.traps.clear();
    for (const [k, at] of Object.entries(UNLOCK_AT)) {
      const on = n >= at;
      if (STORY_DOORS.includes(k)) { if (on) this.unlockDoor(k, { open: 0.5, quiet: true }); else this.lockDoor(k); }
      else if (on) this.unlocked.add(k); else this.unlocked.delete(k);
    }
    this.flags.entranceOut = n >= UNLOCK_AT.KEYSWITCH; this._applyEntrance();
    this.flags.roofA = n >= UNLOCK_AT.PADLOCK;
    if (this.aiControl) {
      this.ai.allowStairs = false; this.ai.noEV = false; this.ai.portals = [];
      if (n >= 11) this._addEntrancePortal();
    }
    this.log('apply_stage', { stage: n });
    if (this.winWatcher) { this.winWatcher.hide('stage'); this.winWatcher.done = false; }   // P5b-2b
    if (teleport) { const s = SPAWN[n]; this.teleport(s.level, s.x, s.z, s.yaw); }
    if (this.aiControl) {
      if (n === 1) this.ai.setDormant(true);
      else { this.ai.dormant = false; this.onAIReset && this.onAIReset(); }
    }
  }

  // 死亡 → 復帰: 段・持ち物・壊れた扉・解放はそのまま。その段の開始位置へ
  respawnPoint() {
    // P5b-2a: 別空間の中で死んだ時はモジュールが決める(X105 = 105 の扉の前。無ければ段の開始位置。P5b-4: X312 は死なない空間)
    const lv = this.getLevel();
    if (isSpace(lv)) { const r = this.spaces.respawn(lv); if (r) return r; }
    return this.stage === 9 && this.sub === 'chase' ? SPAWN['9c'] : SPAWN[this.stage];
  }
  afterRespawn() {
    this.trans = null; this.siteChased = false; this.pending = [];
    // P5b-1b: 221 から逃げる途中で死んだ → 第1段の開始位置から、飛び出しの前(管理人は 2F で待機の体 = 眠る。221 の奥へ進むとまた出る)。
    //  冒頭の見せ場は繰り返さない。逃げ切った後(sub 'return')の死亡は鍵が机にあるまま・管理人は徘徊を続ける
    if (this.stage === 1 && this.sub === 'flee') {
      this.sub = null; this.burst221 = false;
      if (this.rooms.setBurst) this.rooms.setBurst('221', 0, 0);
      this.log('stage', { stage: 1, sub: null, why: 'respawn_before_escape' });
    }
    if (this.aiControl && this.stage === 1 && this.sub !== 'return') this.ai.setDormant(true);
    if (this.aiControl && this.stage === 9 && this.sub === 'chase') {   // 最終追跡のやり直し: 705 の戸口から現れる
      const D = SPACE_DEFS.X705;
      this.pending.push({ t: 2.0, fn: () => this.ai.appear({ level: 7, x: D.back.x, z: D.back.z, lock: 0.8, recover: 1.2, label: 'appear_705' }) });
    }
    this.log('respawn', { stage: this.stage, sub: this.sub });
  }

  // ================================================================ 別空間
  enterSpace(id) {
    const D = SPACE_DEFS[id];
    if (!D || this.trans) return false;
    this.log('enter_space', { id });
    this._fadeTo(() => { this.spaces.show(id); const E = this.spaces.entry(id) || D.entry; this.teleport(id, E.x, E.z, E.yaw); });
    return true;
  }
  leaveSpace(exit = null) {
    const lv = this.getLevel();
    const D = SPACE_DEFS[lv];
    if (!D || this.trans) return false;
    this.log('leave_space', { id: lv });
    if (exit && exit.onLeave) exit.onLeave();
    this._fadeTo(() => { this.spaces.show(null); this.teleport(D.back.level, D.back.x, D.back.z, D.back.yaw); });
    return true;
  }
  _fadeTo(fn) { this.trans = { t: 0, fn, done: false }; this.player.frozen = true; }

  // ================================================================ 毎フレーム
  update(dt) {
    this.time += dt;
    const lv = this.getLevel(), p = this.player.pos;
    // P5b-2b: 第7段の窓の内側の管理人(見えるだけ)。出せるのは第7段だけ(出ている間に第8段になっても敷地にいる間は消える条件まで残る)
    if (!this.winWatcher && this.watcher && this.mode !== 'tour') { const W = this.watcher; this.winWatcher = new InsideWatcher({ scene: W.scene, camera: W.camera, enemy: W.enemy, world: W.world, building: W.building, ai: W.ai, getLevel: W.getLevel, isBusy: W.isBusy, enabled: !!this.watcherBase }); }
    if (this.winWatcher) { this.winWatcher.allowed = this.active && this.stage === 7 && !this.ending; this.winWatcher.update(dt); }
    // 物の見え方・瞬き
    for (const pk of this.pickups) {
      if (pk.space && pk.space === lv) { const q = this.spaces.slotPos(pk.space, pk.slot); if (q) { pk.pos.copy(q); pk.mesh.position.copy(q); } }   // P5b-2a: 動く置き場所
      pk.mesh.visible = this._visible(pk, lv);
      if (pk.mesh.visible && pk.mesh.userData.glint) P.updateGlint(pk.mesh.userData.glint, this.time);
    }
    this.keybox.visible = this.mode !== 'off' && (lv === 1 || lv === 2 || lv === 'G');
    { const piv = this.keybox.userData.pivot, want = this.unlocked.has('KEYBOX') ? -1.9 : 0; piv.rotation.y += (want - piv.rotation.y) * Math.min(1, dt * 5); }
    this.keyswitch.visible = this.mode !== 'off' && (lv === 1 || lv === 'G' || lv === 2);
    this.padlock.visible = this.mode !== 'off' && !this.flags.roofA && typeof lv === 'number' && Math.abs(lv - 4) <= 1;
    this.carDoor.visible = this.unlocked.has('GLOVEBOX') && (lv === 'G' || lv === 1 || lv === 2);
    this.carDoor.userData.dome.visible = this.carDoor.visible && lv === 'G';
    { const bd = this.world.doorById.get('B1DOOR'); this.b1void.visible = (lv === 'B1' || lv === 1) && bd.angle > 0.01; }
    // 暗転(別空間の出入り)
    if (this.trans) {
      const T = this.trans;
      T.t += dt;
      if (!T.done && T.t >= STORY.fade) { T.done = true; T.fn(); }
      const a = T.t < STORY.fade ? T.t / STORY.fade : Math.max(0, 1 - (T.t - STORY.fade) / STORY.fade);
      this.fadeEl.style.opacity = String(a);
      if (T.t >= STORY.fade * 2) { this.trans = null; this.fadeEl.style.opacity = '0'; this.player.frozen = false; }
    }
    if (this.ending) { this._updateEnding(dt); return; }
    // 予定(遅れて起きること)
    for (const q of this.pending) q.t -= dt;
    const due = this.pending.filter((q) => q.t <= 0); this.pending = this.pending.filter((q) => q.t > 0);
    for (const q of due) q.fn();
    if (this.mode !== 'off') this._checkSpaceDoors(lv, p);
    // 別空間の戻る口の前まで歩くと(走って逃げる時も)そのまま外へ出る。P5b-2a: 口はモジュールが決める(n = 空間の内側への向き)
    if (isSpace(lv) && !this.trans) {
      for (const e of this.spaces.exits(lv)) {
        if (!e.auto) continue;
        const n = e.n || [0, 1], dx = p.x - e.x, dz = p.z - e.z;
        const v = dx * n[0] + dz * n[1], u = Math.abs(dx * n[1] - dz * n[0]);
        if (v < (e.depth ?? 0.45) && v > -1.0 && u < (e.half ?? 0.6)) { this.leaveSpace(e); break; }
      }
    }
    if (!this.active) { this.hud.setObjective(''); this.hud.setItem(''); return; }
    // P5b-1b 221: 奥へ進むと奥の窓際のロッカーから管理人(初回)→ 逃げ切ると机に小さな鍵
    if (this.stage === 1) this._check221(lv, p);
    // P5b-1b 冒頭の見せ場: 初めて 410 から廊下へ出た瞬間、4F の EV ホールに管理人 → EV で 2F へ(DESIGN §3.8 H 第1段)
    if (this.stage === 1 && !this.introDone && lv === 4 && this.aiControl) {
      const I = STORY.introDoor;
      if (p.x < I.x - I.out && p.x > I.x - 1.8 && Math.abs(p.z - I.z) < I.half) {
        this.introDone = true;
        this.log('intro');
        this.ai.introEV();
      }
    }
    // 6F の罠: 机の上の「鍵に見える物」に近づくとクローゼットから管理人(ワープ)
    if (lv === 6 && this.stage >= 2 && this.aiControl) {
      for (const rid of STORY.trapRooms) {
        if (this.traps.has(rid)) continue;
        const pk = this.pickups.find((q) => q.decoy === rid);
        if (Math.hypot(p.x - pk.pos.x, p.z - pk.pos.z) <= STORY.trapDist && !['ATTACK', 'DEAD'].includes(this.ai.state)) {
          this.traps.add(rid);
          this.log('trap', { room: rid });
          this.ai.lockerBurst(rid);
        }
      }
    }
    // 第9段の最終追跡: 1F(または敷地)まで下りたら第10段「地下へ」
    if (this.stage === 9 && this.sub === 'chase' && (lv === 1 || lv === 'G')) this.setStage(10);
    // 第11段: 敷地へ出て玄関から離れたら、管理人が玄関から追ってくる(最後だけ。安全地帯が破られる)
    if (this.stage === 11 && lv === 'G' && !this.siteChased && this.aiControl && Math.hypot(p.x - 17.6, p.z - 28.1) >= STORY.siteChaseDist) {
      this.siteChased = true;
      this.log('site_chase');
      this.ai.appear({ level: 1, x: 17.6, z: 26.7, lock: 0, recover: 0.4, label: 'appear_site', slow: 2.0 });
    }
    // 目標と持ち物
    this.hud.setObjective(HUD_TEXT.objective[this.objectiveKey()]);
    this.hud.setItem(this.item ? HUD_TEXT.story.item(HUD_TEXT.story.tags[this.item]) : '');
    if (this.watcher) this.watcher.enabled = this.watcherBase && this.stage >= 2;
  }

  // P5b-1b: 部屋の中での玄関の壁(扉の面)からの奥行 u(部屋の外は -1)
  _roomU(rid, p, lv) {
    const R = this._room(rid);
    if (!R || R.level !== lv) return -1;
    const [rx, rz, rw, rd] = R.r.rect;
    if (!(p.x > rx && p.x < rx + rw && p.z > rz && p.z < rz + rd)) return -1;
    const [nx, nz] = FACING_N[R.r.door.facing];
    return -((p.x - R.r.door.pos[0]) * nx + (p.z - R.r.door.pos[1]) * nz);
  }
  _check221(lv, p) {
    if (!this.burst221 && (this.sub === 'memo' || this.sub === null) && lv === 2 && this._roomU('221', p, 2) >= STORY.burst221U) {
      this.burst221 = true;
      if (!this.aiControl) { this.sub = 'return'; this.log('stage', { stage: 1, sub: 'return', why: 'noai' }); return; }   // ?noai: 管理人なしで鍵だけ出す
      this.sub = 'flee';
      this.log('burst221');
      this.log('stage', { stage: 1, sub: 'flee' });
      this.ai.lockerBurst('221');
      return;
    }
    // 逃げ切った: 追跡が解けた(見失った)か、プレイヤーが階を変えた(飛び出しの演出中・襲撃中・死亡演出中は数えない)
    if (this.sub === 'flee' && this.aiControl && !['APPEAR', 'ATTACK', 'DEAD'].includes(this.ai.state) && (this.ai.state !== 'CHASE' || lv !== this.ai.level)) {
      this.sub = 'return';
      this.log('escaped', { lv, ai: this.ai.state });
      this.log('stage', { stage: 1, sub: 'return' });
    }
  }

  // 開いた物語の扉(105・312・705・地下の鉄扉)の戸口を奥へ越えたら別空間へ
  _checkSpaceDoors(lv, p) {
    if (this.trans || isSpace(lv)) return;
    for (const [id, sp] of Object.entries(SPACE_OF_DOOR)) {
      if (!this.unlocked.has(id)) continue;
      const d = this.world.doorById.get(id);
      if (!d || d.level !== lv || d.angle < 0.2) continue;
      const [nx, nz] = FACING_N[d.facing];
      const dx = p.x - d.pos[0], dz = p.z - d.pos[1];
      const v = dx * nx + dz * nz, u = Math.abs(dx * nz - dz * nx);
      const inward = id === 'B1DOOR' ? v > 0.12 : v < -0.12;
      if (inward && u < 0.6 && Math.abs(v) < 1.0) { this.enterSpace(sp); return; }
    }
  }

  // ================================================================ エンディング(運転席の視点 → エンジン → 門を抜けて暗転 → 「脱出した」)
  startEnding() {
    if (this.ending) return;
    this.log('ending_start');
    this.item = null;
    this.ending = { t: 0, phase: 'in' };
    this.player.frozen = true;
    if (this.aiControl) this.ai.setDormant(true);
    this.hud.setItem('');
    this._sfx('car');
  }
  _updateEnding(dt) {
    const E = this.ending;
    E.t += dt;
    const t = E.t;
    const car = this.building.site.cars[0];
    const [x0, z0, w, d] = car.rect;
    const o = this.player.object;
    const fadeIn = 0.6;
    if (t < fadeIn) this.fadeEl.style.opacity = String(t / fadeIn);
    if (t >= fadeIn && !E.seated) {
      E.seated = true;
      if (this.getLevel() !== 'G') this.teleport('G', x0 + w * 0.55, z0 + d * 0.72, -Math.PI / 2);
      this._dash(true);
      this._engine('start');
      this.log('ending_seat');
    }
    if (E.seated) {
      // 経路: 運転席(東向き)→ 後ろへ下がりながら南へ向きを変える → 車路を南へ → 南東の門
      const k = (a, b, s) => THREE.MathUtils.clamp((s - a) / (b - a), 0, 1);
      const sm = (v) => v * v * (3 - 2 * v);
      const seat = new THREE.Vector3(x0 + w * 0.55, 1.18, z0 + d * 0.72);
      const back = new THREE.Vector3(28.6, 1.18, 3.0);
      const gate = new THREE.Vector3(33.2, 1.18, 33.0);
      const a = sm(k(2.6, 5.0, t)), b = k(5.0, 10.5, t);
      const south = Math.atan2(-(gate.x - back.x), -(gate.z - back.z));   // 車路の向き(ほぼ南)
      let pos, yaw;
      if (t < 5.0) { pos = seat.clone().lerp(back, a); yaw = THREE.MathUtils.lerp(-Math.PI / 2, south < 0 ? south : south - 2 * Math.PI, a); }   // 東 → 南へ向きを変えながら下がる
      else { pos = back.clone().lerp(gate, b * b * (1.6 - 0.6 * b)); yaw = south; }
      const shake = t < 2.4 && t > 0.9 ? Math.sin(t * 60) * 0.004 : Math.sin(t * 23) * 0.0015;
      o.position.set(pos.x, pos.y + shake, pos.z);
      o.rotation.set(-0.04, yaw, 0, 'YXZ');
      this.player.pos.set(pos.x, 0, pos.z);
      if (t >= 2.4 && !E.drive) { E.drive = true; this._engine('drive'); }
      this.fadeEl.style.opacity = String(t < fadeIn + 0.5 ? Math.max(0, 1 - (t - fadeIn) / 0.5) : t > 9.0 ? Math.min(1, (t - 9.0) / 1.2) : 0);
      if (t > 10.4 && !E.screen) { E.screen = true; this._showEndScreen(); this._dash(false); this._engine('stop'); this.ended = true; this.log('ending_screen'); this.hud.setObjective(''); }
    }
  }
  _dash(on) {
    if (!this.dash) {
      const g = new THREE.Group(); g.name = 'CarDash';
      const m = new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.7 });
      const dashb = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.25, 0.5), m); dashb.position.set(0.1, -0.42, -0.75); g.add(dashb);
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.018, 8, 28), m); wheel.position.set(0.0, -0.3, -0.48); wheel.rotation.x = -0.35; g.add(wheel);
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 8), m); col.rotation.x = Math.PI / 2 - 0.35; col.position.set(0, -0.34, -0.57); g.add(col);
      const gauge = new THREE.Mesh(new THREE.CircleGeometry(0.05, 20), new THREE.MeshBasicMaterial({ color: 0x3b2a12 })); gauge.position.set(0.0, -0.27, -0.6); g.add(gauge);
      const pillarL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, 0.06), m); pillarL.position.set(-0.75, 0.05, -0.62); pillarL.rotation.z = 0.25; g.add(pillarL);
      const pillarR = pillarL.clone(); pillarR.position.x = 0.85; pillarR.rotation.z = -0.25; g.add(pillarR);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.05, 0.6), m); roof.position.set(0.05, 0.48, -0.35); g.add(roof);
      for (const c of g.children) c.renderOrder = 5;
      this.camera.add(g);
      this.dash = g;
    }
    this.dash.visible = on;
  }
  _showEndScreen() {
    const E = HUD_TEXT.ending;
    const el = this.endEl = document.createElement('div');
    el.id = 'story-end';
    el.style.cssText = 'position:fixed;inset:0;z-index:9;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#cfc8bd;font-family:"Hiragino Mincho ProN","Yu Mincho",serif;';
    el.innerHTML = `<div style="font-size:26px;letter-spacing:.6em;margin-left:.6em">${E.title}</div><div style="margin-top:20px;font:400 13px/1 -apple-system,'Hiragino Sans',sans-serif;letter-spacing:.3em;color:#7d776f">${E.sub}</div>`
      + `<button id="story-again" style="margin-top:46px;padding:9px 26px;background:none;border:1px solid rgba(207,200,189,.4);color:#cfc8bd;font:500 13px/1 -apple-system,'Hiragino Sans',sans-serif;letter-spacing:.3em;cursor:pointer">${E.again}</button>`;
    document.body.appendChild(el);
    el.querySelector('#story-again').addEventListener('click', () => { location.search = '?notutorial'; });
    if (document.exitPointerLock) document.exitPointerLock();
  }

  _buildFade() {
    const el = this.fadeEl = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;z-index:6;pointer-events:none;background:#000;opacity:0;';
    document.body.appendChild(el);
  }

  // ================================================================ 仮音(P4 で録音に差し替え。docs/p5b1/NOTES.md の表)
  _ctx() { const c = this.audio && this.audio.ctx; return c && c.state === 'running' ? c : null; }
  _sfx(name) {
    this.sfxLog = this.sfxLog || []; this.sfxLog.push(name); if (this.sfxLog.length > 100) this.sfxLog.shift();
    const ctx = this._ctx(); if (!ctx) return;
    const now = ctx.currentTime, out = ctx.destination;
    const tone = (f0, f1, dur, vol, type = 'sine', at = 0) => {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type;
      o.frequency.setValueAtTime(f0, now + at); o.frequency.exponentialRampToValueAtTime(f1, now + at + dur);
      g.gain.setValueAtTime(0.0001, now + at); g.gain.exponentialRampToValueAtTime(vol, now + at + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, now + at + dur);
      o.connect(g); g.connect(out); o.start(now + at); o.stop(now + at + dur + 0.02);
    };
    const noise = (dur, vol, f, at = 0, q = 1) => {
      const n = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate), a = n.getChannelData(0);
      for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 2 - 1) * (1 - i / a.length);
      const s = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = n; bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q; g.gain.value = vol;
      s.connect(bp); bp.connect(g); g.connect(out); s.start(now + at);
    };
    if (name === 'key') { tone(2400, 2100, 0.12, 0.05, 'triangle'); tone(3100, 2900, 0.1, 0.035, 'triangle', 0.07); }               // key_pickup_01
    else if (name === 'paper') noise(0.25, 0.12, 3200, 0, 0.7);                                                                    // paper_pickup_01
    else if (name === 'unlock') { tone(900, 500, 0.06, 0.08, 'square'); noise(0.08, 0.2, 1800, 0.12, 2); }                          // key_unlock_01
    else if (name === 'rattle') noise(0.18, 0.18, 900, 0, 1.5);                                                                     // lock_rattle_01
    else if (name === 'car') { noise(0.12, 0.3, 500, 0, 1); noise(0.2, 0.2, 260, 0.1, 1); }                                        // car_door_01
  }
  _engine(mode) {
    const ctx = this._ctx();
    this.engineLog = this.engineLog || []; this.engineLog.push(mode);
    if (!ctx) return;
    const now = ctx.currentTime;
    if (mode === 'start' && !this.eng) {                                                                                            // car_engine_start_01 / car_engine_loop_01
      const o = ctx.createOscillator(), o2 = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = 'sawtooth'; o2.type = 'square'; o.frequency.value = 30; o2.frequency.value = 15;
      lp.type = 'lowpass'; lp.frequency.value = 260; g.gain.value = 0.0001;
      o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(ctx.destination);
      o.start(); o2.start();
      o.frequency.setValueAtTime(18, now); o.frequency.linearRampToValueAtTime(46, now + 1.2); o.frequency.linearRampToValueAtTime(34, now + 1.8);
      g.gain.exponentialRampToValueAtTime(0.16, now + 0.4); g.gain.setValueAtTime(0.16, now + 1.8);
      this.eng = { o, o2, g, lp };
    } else if (mode === 'drive' && this.eng) {
      this.eng.o.frequency.linearRampToValueAtTime(70, now + 6); this.eng.lp.frequency.linearRampToValueAtTime(520, now + 6);
    } else if (mode === 'stop' && this.eng) {
      this.eng.g.gain.exponentialRampToValueAtTime(0.0001, now + 0.6); const e = this.eng; setTimeout(() => { e.o.stop(); e.o2.stop(); }, 800); this.eng = null;
    }
  }

  // ================================================================ 状態(window.__N2.story)
  state() {
    return {
      mode: this.mode, stage: this.stage, sub: this.sub, item: this.item, objective: HUD_TEXT.objective[this.objectiveKey()] || '',
      unlocked: [...this.unlocked].sort(), taken: [...this.taken].sort(), traps: [...this.traps].sort(),
      flags: { roofA: !!this.flags.roofA, entranceOut: !!this.flags.entranceOut }, evDisabled: this.evDisabled,
      level: this.getLevel(), inTransition: !!this.trans, ending: this.ending ? +this.ending.t.toFixed(2) : null, ended: this.ended, siteChased: this.siteChased,
    };
  }
}
