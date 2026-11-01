// enemy_ai.js — 管理人の AI(P2b)。前作 tenko/src/phantom.js の状態機械と知覚を移植・簡素化。
//  状態: PATROL / ALERT / CHASE / ATTACK / SCRIPTED
//  知覚: 視錐(半頂角45°・距離は懐中電灯/しゃがみ/静止で段階)＋遮蔽(壁箱・閉扉の XZ 線分判定)＋聴覚半径
//        (走り 12m / 歩き 6m / しゃがみ 2.4m / 扉操作 9m)。phantom.js の _visionCheck を移植。
//        遮蔽はメッシュではなく当たり判定の箱(building.json 由来=データが真実)に対して取る(結合済みメッシュより軽く正確)。
//  経路: P0 は直線廊下＋EVホールなので、廊下軸上の点列＋410 室内の点のグラフ(ダイクストラ＋見通しで間引き)。
//  入室: door_open_in で扉を押し開けて入る(ルートモーション)。P5a で「鍵束→錠」の段取りは撤去(施錠要素の全廃)。
//  行動はジェネレータ(=update(dt) ごとに 1 歩進むコルーチン)で書く。setTimeout 非依存なので手動ポンプで決定的に進む。
//  P2c: LURK(潜伏)を追加。隠れ場所に立ち止まり消灯して待つ。近づく(≤4m)/同じ部屋に入る/懐中電灯を向けると、
//  grin で無言のまま walk_brutal で近づき ATTACK。時間配分 潜伏 60〜120 秒 : 巡回 20〜40 秒(DESIGN §3.4.1)。
//  懐中電灯は PATROL/ALERT/CHASE で点灯、LURK で消灯(§3.2.1)。
//  P2d: 「部屋を知っている」(knownRoomId)。①入室の瞬間(扉通過から 1.5 秒)を視錐＋遮蔽なしで目撃 ②室内の懐中電灯の光漏れ
//  (廊下側で扉から 6m、開いていれば 10m)③室内の物音を聞いた、のどれかで立つ。知らなければ、室内で消灯して潜む限り
//  扉の前で止まってもノブを鳴らして去る。知っていてプレイヤーがスコープを覗いていれば SCOPE 演出(通り過ぎ→消える→
//  約 2 秒の静寂→戻ってスコープを覗き込む→鍵→扉を開けて襲う)。

//  P3b: 「部屋」を 410 だけから入れる部屋すべてへ一般化(_rid=その点のある部屋の id。バルコニーは部屋の内)。鍵で入る扉は居室と管理室、
//  食堂・シアターは共用扉(押して開ける)。物音の障害物(rooms.js の落ちる物)は同じ階なら knownRoomId=その部屋(noiseRoom)。
//  演出②(LOCKER): 知っている部屋のクローゼット/ロッカーに隠れた → ゆっくり近づき目の前で立ち止まって焦らす(息遣い・取っ手)→開けて襲う。
//  知らなければ見回りで部屋を一通り見て出て行く(SWEEP)。
//  P3a: 全7階。移動グラフ(ai_graph.js)と当たり(world.js)を全階ぶん常駐し、管理人は自分の階(this.level)で動く。
//  プレイヤーと別の階にいる間は見えない・聞こえない(物音は同じ階だけ)。経路が階をまたぐと EV/階段で移る
//  (_transfer: 待つ→姿を消す→移動時間→次の階の同じ点に現れる)。410・覗き穴・スコープ演出は 4F だけの話。
//  P5a(DESIGN §3.8 A・B): 潜伏の主形態は「空の施錠された部屋(内装のない 73 室)の中」(部屋 8：廊下の角・EV の死角 2)。
//  部屋の中では描かず音も出さず、扉の前の帯(扉の中心から幅方向 ±1.2m)をプレイヤーが通過したら、点灯なら扉を壊して即座に襲う
//  (視点を向けさせて襲撃ムービー)、消灯なら扉から 4〜6m 離れた時に扉を壊して飛び出し、視点を固定する短いムービー → 追跡。
//  プレイヤーが階を移ると 20〜60 秒後に静かに扉を開けて出てくる(扉は壊さない)。階の移動は EV だけ(階段を使わない)。
//  行き先の階は重み付き乱数＋監督役(director: 直近の遭遇からの経過で重みを変える)。大きな音は別の階にも届き(階差で減衰)、EV でその階へ来る。
//  EV の賭け: EV で降りてから T 秒以内にプレイヤーが別の階で EV を呼ぶと、カゴの中に乗っている(EVAMBUSH)。

import * as THREE from 'three';
import { segmentHitT } from './enemy.js';
import { buildAIGraph, nodeId, P0_NODES } from './ai_graph.js';
import { levelY, FACING_N, isSpace, SPACE_HOST } from './world.js';
// P5b-1: 移動グラフの無い階(敷地 'G'・物語の別空間 'X…')。そこでは経路を引かず、まっすぐ追う。階の間は portals(story.js が足す)で移る
const graphless = (lv) => lv === 'G' || isSpace(lv);

export const AI = {
  radius: 0.30,
  eyeY: 1.62,
  speed: { PATROL: 0.62, ALERT: 1.35, CHASE: 3.2, SCRIPTED: 1.0 },
  clip: { PATROL: 'walk_oldman', ALERT: 'walk_hurried', CHASE: 'run_intent', SCRIPTED: 'walk_standard' },
  turnRate: { PATROL: 2.2, ALERT: 3.5, CHASE: 7.0, SCRIPTED: 3.0 },
  vision: {
    flashlight: 18.0,      // 懐中電灯 ON: 視錐内・遮蔽なしなら廊下全長級
    darkBase: 5.0,         // OFF・立って移動
    darkCrouch: 3.5,       // OFF・しゃがみ
    darkStill: 2.5,        // OFF・静止
    halfAngle: Math.PI / 4,
    rayEvery: 0.12,
  },
  hear: { run: 12.0, walk: 6.0, crouch: 2.4, door: 9.0, occludedMul: 0.6 },
  proximity: 2.0,          // この距離で遮蔽なしなら視線問わず気づく
  attackRange: 1.4,        // CHASE でこの距離 → ATTACK
  hitRange: 1.9,           // 振り下ろしの瞬間にこの距離以内なら命中
  hitTime: 0.85,           // attack_downward の振り下ろし(右手が最も前に出る ≈ f25)
  windup: 0.8,             // 振りかぶり区間(attack 表情 1.0 に同期)
  chaseLose: 6.0,
  alertSearch: 12.0,
  lurk: {
    standMin: 60, standMax: 120,     // 潜伏して立っている時間
    patrolMin: 20, patrolMax: 40,    // その後の巡回時間
    near: 4.0,                       // この距離まで近づかれたら(遮蔽なし)発見
    lightRange: 12.0,                // プレイヤーの懐中電灯の円錐に入ったら発見(この距離まで)
    lightHalfAngle: 0.55,            // 円錐の判定角(rad)。FLASHLIGHT.angle の 8 割弱
    approachSpeed: 1.6,              // 無言の接近(walk_brutal)
    giveUp: 10.0,                    // これより離れたら CHASE(点灯)へ切り替える
    idleTimeScale: 0.25,             // 立っている間の look_idle の速さ
  },
  // P5a: 空室への潜伏と飛び出し(DESIGN §3.8 A)
  roomLurk: {
    share: 0.8,                  // 潜伏のうち空室に潜む割合(残りは廊下の角・EV ホールの死角)
    inside: 0.5,                 // 潜伏中の立ち位置: 扉面から部屋の奥へ(描かない)
    band: { half: 1.2, depth: 2.8 },   // 扉の前の帯: 扉の中心から幅方向 ±1.2m、廊下側へ 0〜2.8m(廊下の幅いっぱい)
    darkBurst: [4, 6],           // 消灯で通過 → 扉からこの距離(乱数)離れた時に飛び出す
    releaseAfter: [20, 60],      // プレイヤーが別の階にいる時間がこれ(乱数)に達したら、静かに扉を開けて出てくる
    maxSameLevel: 240,           // 同じ階にプレイヤーがいても、通過がないままこれだけ経ったら静かに出る(ずっとは潜まない)
    avoidNear: 5.0,              // プレイヤーがこの距離より近い扉は潜伏先に選ばない
    breath: { dist: 1.5, still: 1.0, every: 5.0, vol: 0.16, cutoff: 900 },   // 扉の前で静止すると、ごく小さな呼吸
    litLunge: 4.2, litReach: 1.1,       // 点灯通過: 飛び出してプレイヤーへ詰める速さ(m/s)と ATTACK に入る距離
    darkLock: 1.5,               // 消灯通過: 視点を管理人に固定する長さ(秒。1.2〜1.8)
    darkStep: 0.9,               // 消灯通過: 戸口から廊下へ出る距離
    chaseDelay: 0.6,             // 消灯通過: ムービーが終わってから追い始めるまで(飛び出した体勢を立て直す間。P5a 監査で 0.3→0.6)
    darkChase: { speed: 2.5, time: 3.0 },   // 消灯通過: 追い始めて最初の time 秒はこの速さ(走り 3.6 m/s で確実に引き離せる。その後は CHASE 3.2)
    crash: { vol: [1.0, 0.32, 0.1], cutoff: [0, 700, 380], ref: 9.0 },   // 破壊音(同じ階・1 階差・2 階差)。ref が大きいほど同じ階の遠くまで届く
    doorOpen: 1.15, latchVol: 0.55,
  },
  // P5a: 徘徊の行き先の階(重み付き乱数)と監督役(DESIGN §3.8 B)
  director: {
    base: 1.0, player: 6.0, adjacent: 2.5,           // 全階に base、プレイヤーの階に +player、隣接階に +adjacent
    noiseGain: 2.0, noiseMax: 4.0, noiseHalfLife: 90,  // 音の履歴: 聞いた大きさ×gain(上限 max)を加算。半減期(秒)
    stayMax: 2,                                       // 同じ階で続けて潜伏するのはこの回数まで(超えたらその階の重み 0)
    calmAfter: 90, tenseAfter: 240,                   // 直近の遭遇からの経過(秒): calmAfter 未満=静か、tenseAfter 超=緊張
    calm: { player: 0.3, adjacent: 0.7, patrolMul: 1.3 },   // 静か: プレイヤーの階から離れがち・巡回は長め
    tense: { player: 2.5, adjacent: 1.3, patrolMul: 0.5, nearRooms: 3 },   // 緊張: プレイヤーの階へ寄せる・巡回は短く・プレイヤーに近い空室から選ぶ
  },
  // P5a: 別の階の音(階差で減衰)。聞こえた大きさ = loud × att[階差]。threshold 以上ならその階へ EV で向かう
  floorHear: { att: [1, 0.5, 0.22, 0], threshold: 0.4, cooldown: 25, runEvery: 1.5,
    loud: { run: 1.0, fall: 1.0, crash: 2.0, door: 0.45, window: 0.3 } },
  // P5a: EV の賭け。管理人を乗せたカゴが止まってから T 秒以内にプレイヤーが別の階で呼ぶと、中に管理人
  evGamble: { T: 25, reach: 3.0, lunge: 4.0 },
  door: {
    startDist: 0.54,       // door_open_in 開始時の本体と扉面(廊下側)の距離。手が f50〜90 で ≈0.5m 先に届く
    lateral: 0.14,         // 右手(押す手)がノブ側に来るよう扉中心からずらす量
    openAt: 2.55,          // door_open_in 再生開始から扉が動き出すまで(秒、f77)
    openSpeed: 2.6,        // 敵が押すときの扉の速さ倍率
  },
};

// 隠れ場所(P0 区間)。P3 で建物データ(building.json)へ移す前提で、座標と向く先だけの素朴な配列にしておく。
// area: 'R' = 410 室内(扉を鍵で開けて入り、中から閉める) / 'C' = 廊下・EV ホール
export const HIDE_SPOTS = [
  { id: 'r410_back', area: 'R', x: 9.4, z: 7.05, faceTo: [7.8, 7.25] },           // 410 の玄関の先(トイレの扉の前の暗がり。P3b-2 の鏡像でトイレが北側へ)
  { id: 'r410_door_shadow', area: 'R', x: 8.3, z: 6.56, faceTo: [8.7, 7.6] },     // 扉の陰(開いた扉板の裏。P3b-2 の鏡像でシューズケースが北側へ来たのでその手前)
  { id: 'corridor_north', area: 'C', x: 6.32, z: 6.2, faceTo: [6.9, 9.5] },       // 廊下北端の角(窓の下の暗がり)
  { id: 'ev_blind', area: 'C', x: 8.38, z: 21.72, faceTo: [6.9, 21.2] },          // EV ホール東の死角
];

const ROOM_POINT = { x: 8.7, z: 7.4 };   // 「その部屋にいる」と知った時に向かう点(410 室内)
const DOOR410 = { x: 7.8, z: 7.25 };
export const SCOPE = {
  passSpeed: 0.62,         // 気づかないふりで通り過ぎる速さ(巡回と同じ)
  hide: 2.0,               // 視界から消えて静まる時間
  returnSpeed: 1.7,        // いきなり戻ってくる
  stareX: 7.36,            // 覗き込む立ち位置(扉面 7.74 − 半径)
  headGap: 0.30,           // 頭(骨)をレンズの手前この距離へ(顔の前面はさらに約 8cm 前=レンズの約 20cm 手前。近すぎると近クリップで唇を突き抜ける)
  stare: 1.6,              // 覗き込んでいる時間(grin 1.0 → 0.5 秒で attack)
  knob: 0.6,               // P5a: ノブに手を掛けてから扉が開くまで(旧: 鍵束 1.1 秒＋錠 0.5 秒)
};

const P0_ORDER = ['405', '406', 'EV', '404', '407', '410', '403', '408', '402', '409', '401', '410', 'N0'];   // 410(プレイヤーの部屋)は一巡に2回
// P3b: 演出②(ロッカー/クローゼットに隠れた時)
export const LOCKER = {
  approachFrom: 1.4,       // 立ち止まる点のこれだけ手前から、ゆっくり
  slowSpeed: 0.42,
  tease: [2.0, 4.0],       // 目の前で立ち止まって焦らす(秒)
  openAfter: 0.35,         // 扉を開けてから襲いかかるまで
};
const XFER = { evWait: 2.0, evBase: 2.4, evPerFloor: 1.5, stairPerFloor: 4.0 };
void P0_NODES;

export class EnemyAI {
  // ctx: { enemy, audio, player, world, building, getPlayerLevel(), doors(API), doorInfo[], onKill, onLevel(lv) }
  constructor(ctx) {
    Object.assign(this, ctx);
    this.cfg = AI;                   // P5a: テスト・デバッグから値を差し替えるため
    this.level = 4;
    this.transit = false;
    this.G = buildAIGraph(this.building);
    this.spots = this.building.floors.filter((f) => f.level <= 7).flatMap((f) => f.shell.hideSpots);
    this.state = 'PATROL';
    this.task = null;
    this.time = 0;
    this.dt = 0;
    this.events = [];
    this.lastKnown = null;
    this.canSee = false;
    this.heard = false;
    this.occluded = false;
    this._rayTimer = 0;
    this._prevPlayer = new THREE.Vector3().copy(this.player.pos);
    this.playerMoving = false;
    this.uninterruptible = false;
    this.pending = null;
    this.perception = true;
    this.patrolIdx = 0;
    this._rand = mulberry(1234);
    this.knownRoomId = null;     // P2d: プレイヤーがいると知っている部屋
    this._playerArea = 'C';
    this._playerRoom = null;
    // P3b: 部屋(入れる部屋＋食堂・シアター)。rid → { id, level, rect, bal(バルコニー), key(鍵で入る扉か), points }
    this.rooms = new Map();
    this.roomsByLevel = new Map();
    for (const f of this.building.floors) {
      if (f.level > 7) continue;
      for (const r of f.rooms) {
        if (!r.door || !(r.door.enterable || r.id === 'DINING' || r.id === 'THEATER')) continue;
        const pts = r.interior && r.interior.points;
        const rec = { id: r.id, level: f.level, rect: r.rect, bal: r.balcony && r.door.enterable ? r.balcony.rect : null,
          key: !!r.door.enterable, points: pts || null, hide: r.interior && r.interior.hide };
        this.rooms.set(r.id, rec);
        if (!this.roomsByLevel.has(f.level)) this.roomsByLevel.set(f.level, []);
        this.roomsByLevel.get(f.level).push(rec);
      }
    }
    this._enterWatch = 0;
    // P5b-1(DESIGN §3.8 H): 物語からの制御
    this.dormant = false;            // 第1段(221 の飛び出しまで)は館内に管理人がいない(描かない・動かない・何も感じない)
    this.allowStairs = false;        // 第9段の最終追跡だけ階段で追ってくる(§3.8 B の「階の移動は EV だけ」は徘徊の規則。追跡の台本上の例外)
    this.noEV = false;               // 第9段の最終追跡では EV を使わない(EV は来ない)
    this.portals = [];               // [{ id, a:{lv,x,z}, b:{lv,x,z} }] グラフの無い階との出入り口(705 の別空間・正面玄関＝第11段だけ)
    // P5a
    this.concealed = false;          // 空室の中に潜んでいる(描かない・当たりなし)
    this.lurkMode = null;            // 'room' | 'corner'
    this.lurkRoomId = null;          // 潜んでいる空室(中に入ってから)
    this.lurkTargetRoom = null;      // 潜みに向かっている空室
    this.noiseHist = {};             // 階 → 音の履歴(減衰)
    this.lastEncounter = -AI.director.calmAfter;   // 開始時は「ふつう」
    this.floorStreak = 0; this._lastLurkLevel = null;
    this._lastFloorGo = -1e9; this._lastRunHeard = -1e9;
    this.lurkable = this.building.floors.filter((f) => f.level <= 7).flatMap((f) => f.rooms.filter((r) => r.kind === 'unit' && r.door && !r.door.enterable && !r.story).map((r) => ({ id: r.id, level: f.level })));
    this.selfBox = { minX: 0, maxX: 0, minZ: 0, maxZ: 0, y0: -1e9, y1: 1e9, kind: 'enemy', roomId: null, disabled: false };
    this.collisions.push(this.selfBox);
    this.playerLevelAt = () => (this.getPlayerLevel ? this.getPlayerLevel() : 4);
    this.enemy.onFootstep = (foot, pos) => {
      if (!this.audio) return;
      const run = this.enemy.current === 'run_intent';
      this.audio.play('step', pos, run ? 1.0 : (this.state === 'PATROL' ? 0.6 : this.state === 'LURK' ? 0.4 : 0.8));
    };
    this.setState('PATROL');
  }

  // ------------------------------------------------------------ 階(P3a)
  get collisions() { return this.world.collisions(this.level); }
  get floorY() { return levelY(this.level); }
  _plv() { return this.playerLevelAt(); }
  setLevel(lv) {
    if (lv === this.level) return;
    const a = this.world.collisions(this.level), i = a.indexOf(this.selfBox);
    if (i >= 0) a.splice(i, 1);
    this.level = lv;
    this.world.collisions(lv).push(this.selfBox);
    if (this.onLevel) this.onLevel(lv);
    this.log('level', { lv });
  }

  log(ev, extra = {}) {
    this.events.push({ t: +this.time.toFixed(3), ev, state: this.state, ...extra });
    if (this.events.length > 400) this.events.shift();
  }

  // ------------------------------------------------------------ 状態
  setState(s, opts = {}) {
    if (this.uninterruptible && !opts.force) { this.pending = [s, opts]; return; }
    this.pending = null;
    this.uninterruptible = false;
    const prev = this.state;
    this.state = s;
    this.stateTime = 0;
    this.enemy.aimPoint = null;
    if (s !== 'CHASE' && s !== 'ATTACK' && s !== 'LURK') this.enemy.setFace('grin', 0);
    if (s !== 'ATTACK') this.enemy.setFace('attack', 0);
    // 懐中電灯: 探している時だけ点ける(§3.2.1)。潜伏中は消して闇に溶ける
    // (ATTACK は直前の状態のまま: 潜伏からの襲撃は消灯のまま、追跡からなら点灯のまま)
    if (s !== 'SCRIPTED' && s !== 'ATTACK') this.enemy.setFlashlight(s !== 'LURK');
    if (s !== 'SCOPE') { this.enemy.lean = 0; if (s !== 'ATTACK') this.enemy.faceFill = 0; }
    const gen = {
      LURK: () => this._lurk(opts),
      SCOPE: () => this._scope(),
      LOCKER: () => this._locker(),
      SWEEP: () => this._sweep(opts),
      PATROL: () => this._patrol(),
      ALERT: () => this._alert(opts),
      CHASE: () => this._chase(),
      APPEAR: () => this._appear(opts),
      ATTACK: () => this._attack(),
      EVAMBUSH: () => this._evAmbush(opts),
      SCRIPTED: () => this._scripted(opts),
    }[s];
    if (s !== 'LURK') { this.lurkMode = null; this.lurkTargetRoom = null; if (!opts.keepConcealed) { this.concealed = false; this.lurkRoomId = null; } }
    if ((s === 'CHASE' && prev !== 'CHASE') || s === 'ATTACK' || s === 'SCOPE' || s === 'LOCKER') this._encounter(s);
    this.task = gen ? gen() : null;
    if (this.audio) this.audio.setState(s);
    if (prev !== s || opts.log) this.log('state', { from: prev, to: s });
  }

  reset(x, z, yaw, lv = 4) {
    this.uninterruptible = false;
    this.pending = null;
    this.transit = false;
    this.setLevel(lv);
    this.enemy.place(x, z, yaw);
    this.enemy.setFace('grin', 0, true);
    this.enemy.setFace('attack', 0, true);
    this.lastKnown = null;
    this.canSee = false;
    this.inProximity = false;
    this.heard = false;
    this._noise = null;
    this._rayTimer = 0;
    this._prevPlayer.copy(this.player.pos);
    this.knownRoomId = null;
    this.lurkFound = null;
    this._enterWatch = 0;
    this._playerRoom = this._rid(this.player.pos.x, this.player.pos.z, this._plv());
    this._playerArea = this._playerRoom ? 'R' : 'C';
    this.enemy.lean = 0;
    this.enemy.faceFill = 0;
    // P5a: 潜伏・EV の賭けの途中なら片付ける(開けかけの空室の扉は閉める。壊れた扉はそのまま残る)
    if (this._npcDoorId) { const d = this.doors.get(this._npcDoorId); if (d && !d.broken) this.doors.npcClose(this._npcDoorId, 3.0); this._npcDoorId = null; }
    if (this.elevator && this.elevator.npc && this.elevator.npc.ambush) this.elevator.npc = null;
    this.concealed = false; this.lurkRoomId = null; this.lurkMode = null; this.lurkTargetRoom = null; this._lurkWake = null; this._chaseSlowUntil = 0;
    this.setState('PATROL', { force: true, log: true });
  }

  // ------------------------------------------------------------ P5b-1: 物語(story.js)から
  setDormant(on) {
    this.dormant = !!on;
    if (on) {
      this.uninterruptible = false;
      this.setState('SCRIPTED', { force: true });
      this.enemy.setFlashlight(false); this.enemy.speed = 0;
      this.concealed = true; this.lurkRoomId = null;
    } else this.concealed = false;
    this.log('dormant', { on: this.dormant });
  }
  // ロッカー(居室のクローゼット)から飛び出す(DESIGN §3.8 D①・H 第1段/第5段)。本体の現在地と無関係にその部屋のクローゼットの中に現れる(ワープ)
  lockerBurst(rid) {
    const c = this.roomsSys && this.roomsSys.closets.get(String(rid));
    if (!c) return false;
    this.dormant = false;
    this.setState('APPEAR', { force: true, log: true, closet: c, level: c.level, x: c.h.feet[0], z: c.h.feet[1], out: c.h.out, label: 'locker_burst', room: String(rid) });
    return true;
  }
  // 指定の場所に現れて(ワープ)、体勢を立て直す間の後に追う(705 の別空間で鍵を取った時・最後の敷地)。o: { level, x, z, lock(視点固定の秒・0 で無し), recover }
  appear(o) {
    this.dormant = false;
    this.setState('APPEAR', { force: true, log: true, label: 'appear', ...o });
    return true;
  }
  *_appear(o) {
    const e = this.enemy, R = AI.roomLurk;
    this.uninterruptible = true;
    this.transit = false; this.concealed = false; this.lurkRoomId = null;
    if (o.level !== this.level) this.setLevel(o.level);
    const p0 = this.player.pos;
    e.place(o.x, o.z, Math.atan2(p0.x - o.x, p0.z - o.z));
    e.setFace('grin', 1.0, true);
    e.setFlashlight(true);
    this._encounter(o.label || 'appear');
    this.log(o.label || 'appear', { room: o.room || null, lv: o.level, x: +o.x.toFixed(2), z: +o.z.toFixed(2) });
    if (o.closet && this.roomsSys) { this.roomsSys.openCloset(o.room, 3.5); o.closet.revealed = true; if (this.audio) this.audio.play('slam', new THREE.Vector3(o.x, this.floorY + 1.1, o.z), 0.9, { dur: 0.6 }); }
    const lock = o.lock ?? 1.0, recover = o.recover ?? 1.5;
    if (lock > 0 && this.onViewLock) this.onViewLock({ total: lock, label: o.label || 'appear', returnView: true });
    e.play('walk_brutal', { fade: 0.1 });
    let t = 0;
    if (o.out) for (; t < 0.7; t += this.dt) { if (this._stepToward(o.out[0], o.out[1], 1.8, 'walk_brutal', 8.0, 0.08)) break; yield; }
    e.speed = 0;
    e.play('look_idle', { fade: 0.25 });
    for (; t < recover; t += this.dt) {   // 体勢を立て直す間(こちらを向いて照らす)
      const p = this.player.pos;
      e.yaw += THREE.MathUtils.clamp(wrap(Math.atan2(p.x - e.pos.x, p.z - e.pos.z) - e.yaw), -5 * this.dt, 5 * this.dt);
      e.aimPoint = new THREE.Vector3(p.x, this.floorY + 1.3, p.z);
      yield;
    }
    this.uninterruptible = false;
    this.lastKnown = { x: this.player.pos.x, z: this.player.pos.z, lv: this._plv() };
    this.lastSeenTime = this.time;
    this._chaseSlowUntil = this.time + (o.slow ?? R.darkChase.time);   // P5a の消灯の飛び出しと同じ「走れば逃げ切れる」基準
    this.setState('CHASE');
    yield;
  }
  // 階の間の出入り口(グラフの無い階)
  _portalBetween(a, b) {
    for (const p of this.portals) {
      if (p.a.lv === a && p.b.lv === b) return { from: p.a, to: p.b, id: p.id };
      if (p.b.lv === a && p.a.lv === b) return { from: p.b, to: p.a, id: p.id };
    }
    return null;
  }

  // ------------------------------------------------------------ update
  update(dt) {
    if (!this.enemy.ready) return;
    if (this.dormant) { this.concealed = true; this.selfBox.disabled = true; this.enemy.speed = 0; return; }   // P5b-1: 第1段
    this.dt = dt;
    this.time += dt;
    this.stateTime += dt;
    { const k = Math.exp(-dt * Math.LN2 / AI.director.noiseHalfLife); for (const lv in this.noiseHist) this.noiseHist[lv] *= k; }
    this._trackPlayer(dt);
    this._updateRoomKnowledge(dt);
    // P3b 演出②: 知っている部屋のクローゼット/ロッカーに隠れた
    const hid = this.player.hidden;
    if (hid && this.knownRoomId === hid.room && !['LOCKER', 'ATTACK', 'DEAD', 'SCRIPTED', 'SCOPE'].includes(this.state) && !this.uninterruptible) {
      this.setState('LOCKER');
    }
    // 知られている部屋でスコープを覗いている → 覗き返しの演出へ
    if (this.knownRoomId === '410' && this._playerArea === 'R' && this.isPeeking && this.isPeeking()
      && !['SCOPE', 'ATTACK', 'DEAD', 'SCRIPTED'].includes(this.state) && !this.uninterruptible
      && this.level === 4 && this._area(this.enemy.pos.x, this.enemy.pos.z) === 'C' && !this.doors.isOpen('410') && !(this.state === 'LURK' && this.lurkFound)) {
      this.setState('SCOPE');
    }
    if (this.perception && this.state !== 'SCRIPTED' && this.state !== 'DEAD') this._perceive(dt);
    else this._updateOcclusionOnly(dt);
    if (this.pending && !this.uninterruptible) { const [s, o] = this.pending; this.pending = null; this.setState(s, o); }
    if (this.task) {
      const r = this.task.next();
      if (r.done) {
        this.task = null;
        if (this.state !== 'SCRIPTED' && this.state !== 'DEAD') this.setState('PATROL');
      }
    }
    const p = this.enemy.pos;
    const r = AI.radius * 0.9;
    Object.assign(this.selfBox, { minX: p.x - r, maxX: p.x + r, minZ: p.z - r, maxZ: p.z + r, y0: p.y, y1: p.y + 1.8 });
    this.selfBox.disabled = this.state === 'DEAD' || this.transit || this.concealed;
    if (this.audio) this.audio.setOccluded(this.occluded);
  }

  _trackPlayer(dt) {
    const p = this.player.pos;
    const v = Math.hypot(p.x - this._prevPlayer.x, p.z - this._prevPlayer.z) / Math.max(dt, 1e-4);
    this._prevPlayer.copy(p);
    const teleport = v > 8.0;          // setPose/復帰などの瞬間移動は「動いた音」にしない
    this.playerMoving = !teleport && v > 0.25;
    this.playerSpeed = teleport ? 0 : v;
  }

  // ------------------------------------------------------------ 知覚(phantom.js _updatePerception / _visionCheck の移植)
  _updateOcclusionOnly(dt) {
    this._rayTimer -= dt;
    if (this._rayTimer > 0) return;
    this._rayTimer = AI.vision.rayEvery;
    this.occluded = this._blocked(this.player.pos);
  }

  _perceive(dt) {
    const p = this.player.pos;
    const e = this.enemy.pos;
    if (this._plv() !== this.level || this.transit) {
      // 別の階: 見えない。音は同じ階の物音に加えて、P5a で別の階の大きな音(走り・落ちる物・扉)も階差で減衰して届く
      this.canSee = false; this.inProximity = false; this.occluded = true; this.heard = false;
      if (this._noise && this._noise.lv === this.level && Math.hypot(this._noise.x - e.x, this._noise.z - e.z) <= this._noise.r && this.state === 'PATROL' && !this.pending) {
        this.lastKnown = { x: this._noise.x, z: this._noise.z, lv: this.level };
        this.log('heard_noise', { r: this._noise.r, otherLevel: true });
        this.setState('ALERT', { react: true });
      } else if (this._noise && this._noise.lv !== this.level && !this.transit) {
        this.floorNoise(this._noise.lv, this._noise.x, this._noise.z, this._noise.r >= 8 ? 'door' : 'window');
      }
      this._noise = null;
      // プレイヤーが別の階で走っている(数秒おきに 1 回として数える)
      if (this.playerMoving && !this.transit && this.time - this._lastRunHeard >= AI.floorHear.runEvery) {
        const k = this.player.keys;
        const run = k && (k.has('ShiftLeft') || k.has('ShiftRight')) && !this.player.crouch && this.playerSpeed > 2.0;
        if (run) { this._lastRunHeard = this.time; this.floorNoise(this._plv(), p.x, p.z, 'run'); }
      }
      return;
    }
    const dist = Math.hypot(p.x - e.x, p.z - e.z);
    this._rayTimer -= dt;
    if (this._rayTimer <= 0) {
      this._rayTimer = AI.vision.rayEvery;
      this.occluded = this._blocked(p);
      // P3b: クローゼット/ロッカーに隠れている間は見えない(扉が開けられるまで)
      const hidden = !!this.player.hidden;
      this.canSee = !hidden && !this.occluded && this._inVision(p, dist);
      this.inProximity = !hidden && !this.occluded && dist <= AI.proximity;
    }
    // 聴覚
    let hearR = 0;
    if (this.playerMoving) {
      const k = this.player.keys;
      const run = k && (k.has('ShiftLeft') || k.has('ShiftRight')) && !this.player.crouch && this.playerSpeed > 2.0;
      hearR = this.player.crouch ? AI.hear.crouch : run ? AI.hear.run : AI.hear.walk;
      if (this.occluded) hearR *= AI.hear.occludedMul;
    }
    this.heard = dist <= hearR;
    if (this._noise) { // 扉操作などの一時的な音
      const n = this._noise; this._noise = null;
      if (Math.hypot(n.x - e.x, n.z - e.z) <= n.r) { this.heard = true; this._heardAt = { x: n.x, z: n.z }; this.log('heard_noise', { r: n.r }); }
    }
    if (this.state === 'DEAD' || this.state === 'EVAMBUSH') return;
    if (this.state === 'LURK') {
      if (this.lurkMode !== 'room') { this._lurkTrigger(p, dist); return; }
      if (this.lurkRoomId || this.concealed) return;      // P5a: 空室の中(扉の前の帯の判定は _roomLurkTick)
    }
    // P5a: 空室へ潜みに向かう途中(LURK・room)は巡回と同じに見つける
    const roaming = this.state === 'PATROL' || this.state === 'ALERT' || (this.state === 'LURK' && this.lurkMode === 'room' && !this.uninterruptible);
    if (this.canSee || this.inProximity) {
      this.lastKnown = { x: p.x, z: p.z, lv: this._plv() };
      this.lastSeenTime = this.time;
      if (roaming && !(this.pending && this.pending[0] === 'CHASE')) { this.log('seen', { dist: +dist.toFixed(2) }); this.setState('CHASE'); }
    } else if (this.heard) {
      const at = this._heardAt || { x: p.x, z: p.z };
      this._heardAt = null;
      this.lastKnown = { x: at.x, z: at.z, lv: this._plv() };
      this.lastHeardTime = this.time;
      if (this._playerArea === 'R' && this.knownRoomId !== this._playerRoom) this._learnRoom('heard');
      if ((this.state === 'PATROL' || (roaming && this.state === 'LURK')) && !this.pending) { this.log('heard', { dist: +dist.toFixed(2) }); this.setState('ALERT', { react: true }); }
      if (this.state === 'ALERT' || this.state === 'PATROL') this.noiseHist[this.level] = (this.noiseHist[this.level] || 0) + 0.3;
    }
  }

  // ------------------------------------------------------------ 「部屋を知っている」(P2d)
  _updateRoomKnowledge(dt) {
    const p = this.player.pos;
    const rid = this._rid(p.x, p.z, this._plv());
    const area = rid ? 'R' : 'C';
    if (rid && rid !== this._playerRoom) this._enterWatch = 1.5;   // 扉を通過した瞬間から 1.5 秒が「入るところ」
    this._playerArea = area;
    this._playerRoom = rid;
    if (area !== 'R') {
      if (this.knownRoomId) this.log('room_forgot');
      this.knownRoomId = null; this._enterWatch = 0;
      return;
    }
    if (this.knownRoomId === rid || this.state === 'DEAD' || this.state === 'SCRIPTED') return;
    const e = this.enemy.pos;
    let why = null;
    if (this._enterWatch > 0) {
      this._enterWatch -= dt;
      if (this._seesPoint(p, 15)) why = 'witness';
    }
    const door = this.doors.get(rid);
    if (!why && this.player.flashlightOn && this.level === this._plv() && !this._rid(e.x, e.z) && door) {
      const d = Math.hypot(e.x - door.pos[0], e.z - door.pos[1]);
      if (d <= (this.doors.isOpen(rid) ? 10 : 6)) why = 'light';
    }
    if (why) this._learnRoom(why);
  }

  // 視錐(半頂角 45°)＋遮蔽なし＋距離。暗さによる視認距離は問わない(人が扉を出入りする動きは見える)
  _seesPoint(p, range) {
    const e = this.enemy;
    const dist = Math.hypot(p.x - e.pos.x, p.z - e.pos.z);
    if (dist > range) return false;
    if (Math.abs(wrap(Math.atan2(p.x - e.pos.x, p.z - e.pos.z) - e.yaw)) > AI.vision.halfAngle) return false;
    return !this._blocked(p);
  }

  _learnRoom(why, rid = this._playerRoom) {
    if (!rid) return;
    this.knownRoomId = rid;
    this.log('room_known', { why, room: rid });
    // 探しに行く(追跡中・潜伏からの接近中・演出中はそのまま)
    if ((this.state === 'PATROL' || this.state === 'ALERT' || this.state === 'SWEEP' || (this.state === 'LURK' && !this.lurkFound)) && !this.uninterruptible) {
      this.lastKnown = { ...this._roomPoint(rid), lv: this.rooms.get(rid).level };
      this.setState('ALERT', { react: why === 'noise' });
    }
  }

  // P3b: 部屋で物音(落ちる物)。管理人が同じ階なら、その部屋にいると知る(DESIGN §3.4.1 ③)
  noiseRoom(rid, x, z, lv) {
    this.log('room_noise', { room: rid, lv, same: lv === this.level });
    if (lv !== this.level && !this.transit) { this.floorNoise(lv, x, z, 'fall'); return false; }   // P5a: 別の階の落下音は階差で減衰して届く
    if (lv !== this.level || this.transit || ['ATTACK', 'DEAD', 'SCRIPTED', 'SCOPE', 'LOCKER', 'EVAMBUSH'].includes(this.state)) return false;
    if (!this.rooms.has(rid)) return false;
    this._learnRoom('noise', rid);
    return true;
  }

  // その部屋で向かう点(410 は P2 と同じ)
  _roomPoint(rid) {
    if (rid === '410') return { ...ROOM_POINT };
    const r = this.rooms.get(rid);
    const p = r && r.points ? r.points.room : null;
    if (p) return { x: p[0], z: p[1] };
    const [x, z, w, d] = r.rect;
    return { x: x + w / 2, z: z + d / 2 };
  }

  // P3b: 点 (x,z) のある部屋(入れる部屋＋食堂・シアター。入れる部屋のバルコニーはその部屋)。無ければ null
  _rid(x, z, lv = this.level) {
    const list = this.roomsByLevel.get(lv);
    if (!list) return null;
    for (const r of list) {
      const [rx, rz, rw, rd] = r.rect;
      if (x > rx + 0.06 && x < rx + rw - 0.06 && z > rz + 0.06 && z < rz + rd - 0.06) return r.id;
      if (r.bal) { const [bx, bz, bw, bd] = r.bal; if (x > bx && x < bx + bw && z > bz && z < bz + bd) return r.id; }
    }
    return null;
  }
  _keyDoor(rid) { const r = this.rooms.get(rid); return !!(r && r.key); }

  // 潜伏中の発見条件: 近い(遮蔽なし)/同じ部屋/懐中電灯を向けられた
  _lurkTrigger(p, dist) {
    if (this.lurkFound) return;
    const L = AI.lurk;
    let why = null;
    if (this.player.hidden) return;
    if (!this.occluded && dist <= L.near) why = 'near';
    else if (!this.player.hidden && this._rid(p.x, p.z, this._plv()) && this._rid(p.x, p.z, this._plv()) === this._rid(this.enemy.pos.x, this.enemy.pos.z)) why = 'room';
    else if (this.player.flashlightOn && !this.occluded && dist <= L.lightRange && this._inPlayerLight()) why = 'light';
    if (why) {
      this.lurkFound = why;
      this.lastKnown = { x: p.x, z: p.z, lv: this._plv() };
      this.log('lurk_found', { why, dist: +dist.toFixed(2) });
    }
  }

  // 管理人(胸の高さ)がプレイヤーの懐中電灯の円錐の中にいるか
  _inPlayerLight() {
    const cam = this.player.camera;
    const f = cam.getWorldDirection(_tmpV);
    const e = this.enemy.pos;
    const dx = e.x - cam.position.x, dy = e.y + 1.3 - cam.position.y, dz = e.z - cam.position.z;
    const d = Math.hypot(dx, dy, dz);
    return (dx * f.x + dy * f.y + dz * f.z) / Math.max(d, 1e-4) >= Math.cos(AI.lurk.lightHalfAngle);
  }

  _inVision(p, dist) {
    const V = AI.vision;
    let range;
    if (this.player.flashlightOn) range = V.flashlight;
    else if (!this.playerMoving) range = V.darkStill;
    else if (this.player.crouch) range = V.darkCrouch;
    else range = V.darkBase;
    if (dist > range) return false;
    const e = this.enemy;
    const ang = Math.atan2(p.x - e.pos.x, p.z - e.pos.z);
    if (Math.abs(wrap(ang - e.yaw)) > V.halfAngle) return false;
    return true;
  }

  // 敵の目 → プレイヤーの胸 の線分が壁箱・閉扉に遮られるか(XZ)
  _blocked(p) {
    if (this._plv() !== this.level) return true;
    const e = this.enemy.pos;
    // P3b: 低い家具(furn)は視線を遮らない。背の高い家具(furnT)は遮るが、プレイヤーが中にいる物(隠れたクローゼット)は除く
    const inside = (c) => p.x >= c.minX && p.x <= c.maxX && p.z >= c.minZ && p.z <= c.maxZ;
    return segmentHitT(e.x, e.z, p.x, p.z, this.collisions, (c) => c.kind === 'enemy' || c.kind === 'furn' || (c.kind === 'furnT' && inside(c))) < 1;
  }

  // 外部からの音(扉の開閉・施錠)。main が呼ぶ
  noise(x, z, r, lv = this._plv()) { this._noise = { x, z, r, lv }; }

  // ------------------------------------------------------------ 移動の部品
  // 'R' = 部屋の中(P3b: 入れる部屋すべて＋食堂・シアター。P2 までは 410 だけ)。lv を省くと管理人の階
  _area(x, z, lv = this.level) { return this._rid(x, z, lv) ? 'R' : 'C'; }

  _nearestNode(x, z, lv = this.level) {
    const rid = this._rid(x, z, lv);
    if (rid === '410' && lv === 4) return 'R';
    if (rid && this.G.roomNode[rid]) return this.G.roomNode[rid];
    let best = null, bd = 1e9;
    for (const n of Object.values(this.G.nodes)) {
      if (n.lv !== lv || n.id === 'R' || n.room) continue;
      const d = Math.hypot(n.x - x, n.z - z);
      if (d > bd) continue;
      const dd = d + (this._clear(x, z, n.x, n.z, lv) ? 0 : 6);   // 壁越しの点は避ける
      if (dd < bd) { bd = dd; best = n.id; }
    }
    return best;
  }

  // 経路(ダイクストラ)。階をまたぐと EV/階段の辺を使う。返り値: [{x,z,lv,node,via}]
  _route(fromX, fromZ, toX, toZ, flv = this.level, tlv = flv) {
    // P5b-1: グラフの無い階(敷地・別空間)。同じ階ならまっすぐ、別の階なら出入り口(portals)を通る。出入り口が無ければ行かない(空の経路)
    if ((flv === 'B1' || tlv === 'B1') && flv !== tlv) return [];   // 管理人は地下には来ない(DESIGN §3.8 H 第10段)
    if (graphless(flv) || graphless(tlv)) {
      if (flv === tlv) return [{ x: toX, z: toZ, lv: tlv, node: null, via: 'walk' }];
      const P = this._portalBetween(flv, tlv);
      if (!P) return [];
      return [...this._route(fromX, fromZ, P.from.x, P.from.z, flv, flv), { x: P.to.x, z: P.to.z, lv: tlv, node: null, via: 'portal' }, ...this._route(P.to.x, P.to.z, toX, toZ, tlv, tlv)];
    }
    const G = this.G;
    const a = this._nearestNode(fromX, fromZ, flv), b = this._nearestNode(toX, toZ, tlv);
    const dist = new Map(), prev = new Map(), prevEdge = new Map(), done = new Set();
    dist.set(a, 0);
    const cost = (e, u, v) => {
      const nu = G.nodes[u], nv = G.nodes[v];
      // P3b-A: EV は乗るまでの待ちを最初の1区間にだけ足す
      if (e.kind === 'ev' && this.noEV) return Infinity;   // P5b-1: 最終追跡では EV を使わない
      if (e.kind === 'ev') { const pe = prevEdge.get(u); return 3 * Math.abs(nu.lv - nv.lv) + (pe && pe.kind === 'ev' ? 0 : 8); }
      // P5a: 管理人は階段を使わない(階の移動は EV だけ。DESIGN §3.8 B)。P5b-1: 第9段の最終追跡だけ外階段・北階段の 2〜3F を使う(1F の北階段は建物の外の地面なので使わない)
      if (e.kind === 'stair') return this.allowStairs && !((nu.name === 'NS' && nu.lv === 1) || (nv.name === 'NS' && nv.lv === 1)) ? 9 * Math.abs(nu.lv - nv.lv) : Infinity;
      return Math.hypot(nu.x - nv.x, nu.z - nv.z);
    };
    while (true) {
      let u = null, du = Infinity;
      for (const [k, d] of dist) if (!done.has(k) && d < du) { du = d; u = k; }
      if (u === null || u === b) break;
      done.add(u);
      for (const e of G.adj.get(u)) {
        const v = e.a === u ? e.b : e.a;
        if (done.has(v)) continue;
        const nd = du + cost(e, u, v);
        if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, u); prevEdge.set(v, e); }
      }
    }
    const names = [];
    for (let k = b; k; k = prev.get(k)) { names.unshift(k); if (k === a) break; }
    let pts = names.map((k) => ({ x: G.nodes[k].x, z: G.nodes[k].z, lv: G.nodes[k].lv, node: k, via: prevEdge.get(k) ? prevEdge.get(k).kind : 'walk' }));
    // 同じ種類の縦の辺が続くなら(EV で 3 階ぶん等)途中の階を飛ばす
    pts = pts.filter((p, i) => !(i > 0 && i + 1 < pts.length && p.via !== 'walk' && pts[i + 1].via === p.via));
    pts.push({ x: toX, z: toZ, lv: tlv, node: null, via: 'walk' });
    // 見通しで間引く(扉をまたぐ区間 = 部屋の内外が変わる点の前後、階の移動の前後は残す)
    const out = [];
    let cx = fromX, cz = fromZ, clv = flv;
    for (let i = 0; i < pts.length; i++) {
      const next = pts[i + 1];
      const isDoorHop = !!next && (this._rid(pts[i].x, pts[i].z, pts[i].lv) !== this._rid(next.x, next.z, next.lv)) && pts[i].lv === next.lv;
      const keep = !next || isDoorHop || next.lv !== pts[i].lv || pts[i].lv !== clv || next.via !== 'walk';
      if (!keep && this._clear(cx, cz, next.x, next.z, clv)) continue;
      out.push(pts[i]);
      cx = pts[i].x; cz = pts[i].z; clv = pts[i].lv;
    }
    return out;
  }

  // 幅のある見通し(中心線と左右 0.25m の 3 本)
  _clear(ax, az, bx, bz, lv = this.level) {
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
    if (L < 1e-4) return true;
    const nx = -dz / L * 0.25, nz = dx / L * 0.25;
    const skip = (c) => c.kind === 'enemy';
    const cols = this.world.collisions(lv);
    for (const s of [0, 1, -1]) if (segmentHitT(ax + nx * s, az + nz * s, bx + nx * s, bz + nz * s, cols, skip) < 1) return false;
    return true;
  }

  // 線分を塞いでいる閉じた扉(開けられるもの。鍵で入る部屋=居室・管理室は鍵の段取りがあるので別)
  _blockingDoor(ax, az, bx, bz) {
    for (const c of this.collisions) {
      if (c.kind !== 'door' || c.disabled || !c.roomId || this._keyDoor(c.roomId)) continue;
      const d = this.doors.get(c.roomId);
      if (!d || !d.operable) continue;
      if (segmentHitT(ax, az, bx, bz, [c]) < 1) return c.roomId;
    }
    return null;
  }

  // 階を移る(EV/階段)。待つ→姿を消す→移動→次の階の点に現れる
  // P3b-A: EV はプレイヤーと同じカゴを使う(呼ぶ→来て開いたら乗る→行き先を押す→着いたら降りる)。階数表示が動く。
  //  カゴが来ない(プレイヤーが使い続けている等)ときは従来どおり(待つ→姿を消す→移動時間→現れる)
  *_transfer(wp) {
    const e = this.enemy;
    const from = this.level, to = wp.lv;
    if (wp.via === 'ev' && this.elevator && typeof from === 'number' && typeof to === 'number') {
      const r = yield* this._evRide(from, to, wp);
      if (r) return;
    }
    e.speed = 0;
    e.play('look_idle', { fade: 0.3 });
    this.log('transfer_start', { via: wp.via, from, to });
    yield* this._wait(wp.via === 'ev' ? XFER.evWait : 0.5);
    this.transit = true;
    const n = Math.abs(levelY(to) - levelY(from)) / 2.9;
    yield* this._wait(wp.via === 'ev' ? XFER.evBase + XFER.evPerFloor * n : XFER.stairPerFloor * n);
    this.setLevel(to);
    e.place(wp.x, wp.z, e.yaw);
    this.transit = false;
    this.log('transfer_end', { via: wp.via, to });
    if (this.onArrive) this.onArrive(to, wp.via);
  }


  *_evRide(from, to, wp) {
    const ev = this.elevator, e = this.enemy, c = ev.car;
    const room = ev.rooms[from].room;
    const g = ev.rooms[from].geom;
    this.log('transfer_start', { via: 'ev', from, to, car: c.level });
    // 1) 呼ぶ(ホールの呼びボタンの前で待つ)
    e.speed = 0;
    e.play('look_idle', { fade: 0.3 });
    ev.call(from);
    let t = 0;
    while (!(c.level === from && c.state === 'open' && c.open >= 1)) {
      t += this.dt;
      if (t > 45) { this.log('ev_timeout', { phase: 'call' }); return false; }
      if (c.state === 'idle' && c.level === from && !c.pending.includes(from)) ev.call(from);
      yield;
    }
    // 2) 乗る(カゴの中へ歩く)
    const inX = g.center[0] + 0.15, inZ = g.center[1];
    for (let k = 0; k < 4 / Math.max(this.dt, 1e-3); k++) {
      if (c.state === 'closing' || c.level !== from) break;
      if (this._stepToward(inX, inZ, 1.0, 'walk_standard', 4.0, 0.15)) break;
      yield;
    }
    void room;
    yield* this._turnTo(Math.PI);   // 扉の方(北)を向く
    // 3) 行き先を押す → 扉が閉まって動き出したら姿を消す(シャフトの中)
    ev.npcSelect(to);
    t = 0;
    while (c.state !== 'moving') { t += this.dt; if (t > 20) { ev.npcLeave(); this.log('ev_timeout', { phase: 'close' }); return false; } yield; }
    this.transit = true;
    t = 0;
    while (!(c.level === to && (c.state === 'opening' || c.state === 'open'))) {
      t += this.dt;
      if (t > 60) { ev.npcLeave(); this.log('ev_timeout', { phase: 'travel' }); break; }
      yield;
    }
    // 4) 着いた階のカゴの中に現れ、扉が開いたら降りる
    this.setLevel(to);
    e.place(inX, inZ, Math.PI);
    this.transit = false;
    if (this.onArrive) this.onArrive(to, 'ev');   // P5a: 同じ階の表示(main)
    while (c.level === to && c.state === 'opening') yield;
    ev.npcLeave();
    for (let k = 0; k < 4 / Math.max(this.dt, 1e-3); k++) {
      if (this._stepToward(wp.x, wp.z, 1.0, 'walk_standard', 4.0, 0.2)) break;
      yield;
    }
    this.log('transfer_end', { via: 'ev', to });
    return true;
  }

  _resolve(x, z) {
    const r = AI.radius;
    for (let pass = 0; pass < 2; pass++) {
      for (const c of this.collisions) {
        if (c.disabled || c.kind === 'enemy') continue;
        const dx1 = (x + r) - c.minX, dx2 = c.maxX - (x - r);
        const dz1 = (z + r) - c.minZ, dz2 = c.maxZ - (z - r);
        if (dx1 <= 0 || dx2 <= 0 || dz1 <= 0 || dz2 <= 0) continue;
        const m = Math.min(dx1, dx2, dz1, dz2);
        if (m === dx1) x = c.minX - r; else if (m === dx2) x = c.maxX + r;
        else if (m === dz1) z = c.minZ - r; else z = c.maxZ + r;
      }
    }
    return [x, z];
  }

  // 1 フレーム分、target へ歩く。着いたら true
  _stepToward(tx, tz, speed, clip, turnRate, arrive = 0.12) {
    const e = this.enemy, dt = this.dt;
    const dx = tx - e.pos.x, dz = tz - e.pos.z;
    const d = Math.hypot(dx, dz);
    if (d <= arrive) { e.speed = 0; return true; }
    const want = Math.atan2(dx, dz);
    const dy = wrap(want - e.yaw);
    e.yaw += THREE.MathUtils.clamp(dy, -turnRate * dt, turnRate * dt);
    const align = Math.max(0, Math.cos(dy));
    const step = Math.min(d, speed * dt * (0.25 + 0.75 * align));
    const [nx, nz] = this._resolve(e.pos.x + dx / d * step, e.pos.z + dz / d * step);
    const moved = Math.hypot(nx - e.pos.x, nz - e.pos.z);
    e.pos.x = nx; e.pos.z = nz;
    e.speed = moved / Math.max(dt, 1e-4);
    const cs = e.clipSpeed[clip] || speed;
    e.play(clip, { timeScale: THREE.MathUtils.clamp(speed / cs, 0.6, 1.9) });
    this._stuck = moved < speed * dt * 0.1 ? (this._stuck || 0) + dt : 0;
    return false;
  }

  *_wait(sec) { let t = 0; while (t < sec) { t += this.dt; yield; } }

  *_turnTo(yaw, idleClip = 'look_idle') {
    const e = this.enemy;
    let dy = wrap(yaw - e.yaw);
    e.speed = 0;
    if (Math.abs(dy) > 1.2) {
      const y0 = e.yaw;
      e.play(dy > 0 ? 'turn_left' : 'turn_right', { fade: 0.2 });
      const T = 0.9;
      for (let t = 0; t < T; t += this.dt) { const k = t / T; e.yaw = y0 + dy * (k * k * (3 - 2 * k)); yield; }
      e.yaw = yaw;
      e.play(idleClip, { fade: 0.35 });
      return;
    }
    e.play(idleClip, { fade: 0.35 });
    while (Math.abs(dy) > 0.02) {
      const s = THREE.MathUtils.clamp(dy, -2.5 * this.dt, 2.5 * this.dt);
      e.yaw += s; dy -= s;
      yield;
    }
  }

  // 経路に沿って goal まで。扉 410 が閉まっていれば doorEntry(useKey)。stopIf() が真なら途中で抜ける
  *_goTo(gx, gz, mode, { useKey = true, stopIf = null, arrive = 0.15, lv = this.level } = {}) {
    const e = this.enemy;
    let route = this._route(e.pos.x, e.pos.z, gx, gz, this.level, lv);
    this._stuck = 0;
    while (route.length) {
      if (stopIf && stopIf()) return 'stopped';
      const wp = route[0];
      if (wp.lv !== this.level && wp.via === 'portal') {   // P5b-1: 出入り口を抜ける(扉の向こうの点へ移る)
        this.setLevel(wp.lv); e.place(wp.x, wp.z, e.yaw); this.log('portal', { to: wp.lv }); route.shift(); continue;
      }
      if (wp.lv !== this.level) { yield* this._transfer(wp); route.shift(); continue; }
      {
        const bd = this._blockingDoor(e.pos.x, e.pos.z, wp.x, wp.z);
        if (bd) {
          this.doors.open(bd, 1.3);
          this.log('door_opened_generic', { room: bd });
          e.play('look_idle', { fade: 0.3 });
          for (let t = 0; t < 2.0 && !this.doors.isOpen(bd); t += this.dt) yield;
        }
      }
      // 扉をまたぐ区間: 廊下→室内は鍵で開けて入る。室内→廊下で閉まっていれば内側から開ける(P3b: 鍵で入る部屋すべて)
      // (経路を引いた時は開いていた扉が後から閉まった場合も、室内の点へ向かうなら扉をまたぐ扱い)
      const here = this._rid(e.pos.x, e.pos.z);
      const wr = this._rid(wp.x, wp.z, wp.lv);
      if (wr && wr !== here && !here && this._keyDoor(wr) && !this.doors.isOpen(wr)) {
        const r = yield* this._doorEntry(this.doors.get(wr), useKey);
        if (r !== 'entered') return r;
        route.shift();
        continue;
      }
      if (here && wr !== here && this._keyDoor(here) && !this.doors.isOpen(here)) {
        this.doors.setLocked(here, false);
        this.doors.open(here, 1.5);
        this.log('door_opened_inside', { room: here });
        e.play('look_idle', { fade: 0.3 });
        yield* this._wait(0.9);
      }
      if (this._stepToward(wp.x, wp.z, AI.speed[mode], AI.clip[mode], AI.turnRate[mode], route.length === 1 ? arrive : 0.35)) route.shift();
      else if (this._stuck > 1.5) { this.log('stuck', { x: +e.pos.x.toFixed(2), z: +e.pos.z.toFixed(2) }); return 'stuck'; }
      yield;
    }
    e.speed = 0;
    return 'arrived';
  }

  // 扉の前(廊下側)の立ち位置と向き
  _doorFront(roomId, startDist = 0.75, lateral = 0) {
    const info = this.doorInfo.find((d) => d.roomId === roomId);
    const [x, z] = info.pos, [nx, nz] = info.normal, [kx, kz] = info.knob;
    // 横ずらし: ノブ側へ(door_open_in は右手で押す。410 は正面を向いた本体の右 = +z = ノブ側)
    return { x: x + nx * startDist + kx * lateral, z: z + nz * startDist + kz * lateral, yaw: Math.atan2(-nx, -nz) };
  }

  // 扉を開けて入室(P5a: 鍵は使わない)。door_open_in の間は割り込み不可
  *_doorEntry(door, useKey) {
    const e = this.enemy, D = AI.door;
    const f = this._doorFront(door.roomId, D.startDist + 0.25, D.lateral);
    const mode = this.state === 'CHASE' ? 'CHASE' : this.state === 'ALERT' ? 'ALERT' : 'PATROL';
    // 扉の 25cm 手前まで来て、扉に正対
    while (!this._stepToward(f.x, f.z, Math.min(AI.speed[mode], 1.4), mode === 'CHASE' ? 'walk_brutal' : AI.clip[mode], AI.turnRate[mode], 0.06)) {
      if (this._stuck > 1.5) return 'stuck';
      yield;
    }
    this.uninterruptible = true;
    this.enemy.aimPoint = new THREE.Vector3(door.collision ? (door.collision.minX + door.collision.maxX) / 2 : f.x, this.floorY + 1.0, f.z);
    yield* this._turnTo(f.yaw);
    // P5b-1: 鍵で開く物語の扉(220)は、プレイヤーが鍵で開けるまで管理人も開けない
    if (door.storyLock) {
      door.rattle = 0.25;
      if (this.audio) this.audio.play('rattle', doorPos(door, this.floorY), 0.6);
      this.log('door_story_locked', { room: door.roomId });
      yield* this._wait(1.2);
      this.uninterruptible = false;
      this.enemy.aimPoint = null;
      return 'locked';
    }
    // P2d: 中にいると知らなければ(目撃も光漏れも物音もない)、閉じた扉は開けない。ノブを確かめて去る
    if (this._rid(this.player.pos.x, this.player.pos.z, this._plv()) === door.roomId && this.knownRoomId !== door.roomId && !this.doors.isOpen(door.roomId)) {
      door.rattle = 0.25;
      if (this.audio) this.audio.play('rattle', doorPos(door, this.floorY), 0.8);
      this.log('door_skip_unknown', { room: door.roomId });
      yield* this._wait(1.2);
      this.uninterruptible = false;
      this.enemy.aimPoint = null;
      return 'locked';
    }
    // P5a: 鍵束→錠の段取りは撤去(施錠要素の全廃)。扉は普通に開けて入る
    if (door.locked) this.doors.setLocked(door.roomId, false);
    void useKey;
    // 開始位置へ合わせる(25cm 前へ詰める)
    const s = this._doorFront(door.roomId, D.startDist, D.lateral);
    for (let t = 0; t < 0.6; t += this.dt) {
      if (this._stepToward(s.x, s.z, 0.6, 'walk_standard', 2.0, 0.02)) break;
      yield;
    }
    e.pos.x = s.x; e.pos.z = s.z; e.yaw = s.yaw; e.speed = 0;
    e.play('door_open_in', { fade: 0.25 });
    this.log('door_open_in', { room: door.roomId });
    let opened = false;
    const a = e.actions.door_open_in;
    const dur = a.getClip().duration;
    while (a.time < dur - 0.02 && e.current === 'door_open_in') {
      if (!opened && a.time >= D.openAt) { this.doors.open(door.roomId, D.openSpeed); opened = true; this.log('door_opened', { room: door.roomId }); }
      e.speed = 0.6;
      yield;
      // 室内のプレイヤーに重ならない(ルートモーションの前進をプレイヤーの手前 0.7m で止める)
      const p = this.player.pos, fx = Math.sin(e.yaw), fz = Math.cos(e.yaw);
      const ahead = (p.x - e.pos.x) * fx + (p.z - e.pos.z) * fz;
      const side = Math.abs((p.x - e.pos.x) * fz - (p.z - e.pos.z) * fx);
      if (ahead > -0.2 && ahead < 0.7 && side < 0.5) { const back = 0.7 - ahead; e.pos.x -= fx * back; e.pos.z -= fz * back; }
    }
    if (!opened) this.doors.open(door.roomId, D.openSpeed);
    // 室内に収める(ルートモーションで行き過ぎても壁箱の内側へ)
    const [rx, rz] = this._resolve(e.pos.x, e.pos.z);
    e.pos.x = rx; e.pos.z = rz;
    e.speed = 0;
    this.uninterruptible = false;
    this.enemy.aimPoint = null;
    this.log('entered', { room: door.roomId, x: +e.pos.x.toFixed(2), z: +e.pos.z.toFixed(2) });
    return 'entered';
  }

  // ------------------------------------------------------------ PATROL
  *_patrol() {
    const e = this.enemy;
    // P5b-1: グラフの無い階(敷地・別空間)では巡回しない。出入り口があれば建物へ戻る
    if (graphless(this.level)) {
      const P = this.portals.find((q) => q.a.lv === this.level || q.b.lv === this.level);
      if (P) { const [from, to] = P.a.lv === this.level ? [P.a, P.b] : [P.b, P.a]; yield* this._goTo(to.x, to.z, 'PATROL', { lv: to.lv }); void from; }
      else { e.speed = 0; e.play('look_idle', { fade: 0.4 }); yield* this._wait(5); }
      return;
    }
    e.setFace('grin', 0);
    // 室内にいたら廊下へ戻り、扉を閉める
    if (this._rid(e.pos.x, e.pos.z) && this._keyDoor(this._rid(e.pos.x, e.pos.z))) yield* this._leaveRoom();
    const order = this.level === 4 ? P0_ORDER : this._levelOrder(this.level);
    const ph = this.phase();
    const budget = (AI.lurk.patrolMin + this._rand() * (AI.lurk.patrolMax - AI.lurk.patrolMin)) * (ph === 'calm' ? AI.director.calm.patrolMul : ph === 'tense' ? AI.director.tense.patrolMul : 1);
    while (true) {
      if (this.stateTime >= budget && this.lurkEnabled !== false) { this.setState('LURK'); yield; return; }   // 巡回は短く、潜伏が主
      const tgt = order[this.patrolIdx++ % order.length];
      if (tgt === 'EV' || tgt === 'N0') {
        const nd = this.G.nodes[this.level === 4 ? tgt : this._levelTop(this.level, tgt)];
        if (!nd) continue;
        const [x, z] = [nd.x, nd.z];
        yield* this._goTo(x, z, 'PATROL');
        yield* this._turnTo(tgt === 'EV' ? 0 : Math.PI);
        e.play('look_idle', { fade: 0.4 });
        yield* this._wait(2.0 + this._rand() * 2.0);
        continue;
      }
      const f = this._doorFront(tgt, 0.75, 0);
      const r = yield* this._goTo(f.x, f.z, 'PATROL');
      if (r !== 'arrived') { yield* this._wait(0.5); continue; }
      yield* this._turnTo(f.yaw);
      // 扉の前で耳を澄ます。410(プレイヤーの部屋)の前では体を回さない見回し=覗き穴から顔が見える
      if (tgt === '410') e.play('look_nervous', { fade: 0.4, timeScale: 0.6 });
      else e.play('look_idle', { fade: 0.4 });
      yield* this._wait(tgt === '410' ? 3.0 + this._rand() * 2.0 : 1.5 + this._rand() * 2.0);
      const door = this.doors.get(tgt);
      if (door && door.operable && !door.storyLock && this._rand() < 0.6) {
        // 覗く: 開いていればそのまま、施錠ならノブを確かめて去る
        const res = yield* this._doorEntry(door, false);
        if (res === 'entered') {
          // P3b: 部屋を一通り見る(奥まで歩いて見回す)→出て行く。隠れていても知らなければ開けない
          yield* this._lookAround(tgt);
          yield* this._leaveRoom();
        }
      } else if (this._rand() < 0.3 && door) {
        door.rattle = 0.25;
        if (this.audio) this.audio.play('rattle', doorPos(door, this.floorY), 0.7);
      }
    }
  }

  // 4F 以外の巡回順: その階の居室の扉(廊下の並び)→途中で EV ホール→端
  _levelOrder(lv) {
    if (!this._orders) this._orders = {};
    if (this._orders[lv]) return this._orders[lv];
    const f = this.building.floors.find((ff) => ff.level === lv);
    const units = f.rooms.filter((r) => r.kind === 'unit' && r.door).sort((a, b) => (a.door.pos[1] - b.door.pos[1]) || (a.door.pos[0] - b.door.pos[0])).map((r) => r.id);
    const half = Math.ceil(units.length / 2);
    return (this._orders[lv] = [...units.slice(0, half), 'EV', ...units.slice(half), 'N0']);
  }
  _levelTop(lv, name) {
    if (name === 'EV') return nodeId(lv, 'EV');
    return this.G.nodes[nodeId(lv, 'V0')] ? nodeId(lv, 'V0') : nodeId(lv, 'H1');
  }

  *_leaveRoom() {
    const e = this.enemy;
    const rid = this._rid(e.pos.x, e.pos.z) || '410';
    if (!this._keyDoor(rid)) return;
    const out = this._doorFront(rid, 0.7, 0);
    const mode = this.state === 'PATROL' || this.state === 'SWEEP' ? 'PATROL' : 'ALERT';
    yield* this._goTo(out.x, out.z, mode, { lv: this.level });
    // 扉に向き直って閉める
    yield* this._turnTo(out.yaw);
    this.doors.close(rid);
    this.log('door_closed', { room: rid });
    yield* this._wait(0.8);
    void e;
  }

  // P3b: 部屋を一通り見る(玄関の先 → 洋室の奥 → 見回す)。410 は P2 の動き(その場で見回す)のまま
  *_lookAround(rid) {
    const e = this.enemy;
    const r = this.rooms.get(rid);
    this.log('sweep_room', { room: rid });
    if (r && r.points) {
      for (const k of ['room', 'living']) {
        const [x, z] = r.points[k];
        const res = yield* this._goTo(x, z, 'PATROL', { arrive: 0.3, lv: r.level });
        if (res !== 'arrived') break;
      }
      e.play('look_nervous', { fade: 0.4, timeScale: 0.7 });
      yield* this._wait(2.6);
      yield* this._turnTo(e.yaw + Math.PI);
      yield* this._wait(0.8);
    } else {
      e.play('look_idle', { fade: 0.4 });
      yield* this._wait(2.5);
    }
  }

  // SWEEP: 部屋へ(開いていれば入り、閉まっていれば鍵を使わずノブを確かめる)→一通り見て→出て行く。opts.room
  *_sweep(opts) {
    const rid = opts.room;
    const r = this.rooms.get(rid);
    if (!r) { this.setState('PATROL'); yield; return; }
    this.log('sweep_start', { room: rid });
    const f = this._doorFront(rid, 0.75, 0);
    const res = yield* this._goTo(f.x, f.z, 'PATROL', { lv: r.level });
    if (res === 'arrived') {
      yield* this._turnTo(f.yaw);
      const door = this.doors.get(rid);
      const ent = this.doors.isOpen(rid) ? 'entered' : yield* this._doorEntry(door, false);
      if (ent === 'entered') {
        if (this.doors.isOpen(rid)) {
          const [x, z] = r.points ? r.points.entry : [f.x, f.z];
          yield* this._goTo(x, z, 'PATROL', { lv: r.level });
        }
        yield* this._lookAround(rid);
        yield* this._leaveRoom();
      }
    }
    this.log('sweep_end', { room: rid });
    this.setState('PATROL');
    yield;
  }

  // ------------------------------------------------------------ LOCKER(演出②: 知っている部屋のクローゼット/ロッカーに隠れた)
  *_locker() {
    const e = this.enemy, K = LOCKER;
    const h = this.player.hidden;
    if (!h) { this.setState('ALERT', { react: false }); yield; return; }
    const room = h.room;
    this.log('locker_start', { room });
    e.setFlashlight(true);
    e.setFace('grin', 0.3);
    // 1) 部屋へ(鍵で入る)、隠れ場所の前の少し手前まで
    const [sx, sz] = h.stand;
    const [fx, fz] = h.feet;
    // ゆっくり近づき始める点: 部屋の通路(居室は通路の中ほど、管理室は机の前)
    const rr = this.rooms.get(room);
    const ap = rr && rr.points ? (rr.points.living && room === 'OFFICE' ? rr.points.living : rr.points.room) : [sx, sz];
    const ax = ap[0], az = ap[1];
    let r = yield* this._goTo(ax, az, 'ALERT', { useKey: true, lv: h.level, arrive: 0.25 });
    if (r !== 'arrived' && this._rid(e.pos.x, e.pos.z) !== room) { r = yield* this._goTo(sx, sz, 'ALERT', { useKey: true, lv: h.level, arrive: 0.3 }); }
    if (!this.player.hidden) { this.setState('ALERT', { react: false }); yield; return; }
    // 2) ゆっくり近づく(足音は小さく、最後は止まる)
    this.uninterruptible = true;
    this.log('locker_approach', { room });
    for (let t = 0; t < 8; t += this.dt) {
      if (this._stepToward(sx, sz, K.slowSpeed, 'walk_oldman', 2.0, 0.06)) break;
      yield;
    }
    e.speed = 0;
    yield* this._turnTo(Math.atan2(fx - e.pos.x, fz - e.pos.z));
    e.aimPoint = new THREE.Vector3(fx, this.floorY + 1.3, fz);
    e.play('look_idle', { fade: 0.5, timeScale: 0.15 });
    // 3) 目の前で立ち止まって焦らす: 足音が止まり、息遣い、取っ手に触れる音
    this.log('locker_tease', { room, dist: +Math.hypot(e.pos.x - fx, e.pos.z - fz).toFixed(2) });
    const tease = K.tease[0] + this._rand() * (K.tease[1] - K.tease[0]);
    const doorPos = new THREE.Vector3((sx + fx) / 2, this.floorY + 1.1, (sz + fz) / 2);
    if (this.audio) this.audio.play('breath', this.enemy.headWorld(), 0.9);
    let touched = 0;
    for (let t = 0; t < tease; t += this.dt) {
      if (touched === 0 && t > tease * 0.45) { touched = 1; if (this.audio) this.audio.play('handle', doorPos, 0.7); this.log('locker_handle'); }
      if (touched === 1 && t > tease * 0.8) { touched = 2; if (this.audio) this.audio.play('handle', doorPos, 0.9); }
      e.setFace('grin', Math.min(1, 0.3 + t / tease));
      yield;
    }
    // 4) 開ける → 襲う
    if (this.roomsSys) this.roomsSys.openCloset(room, 3.0);
    const cl = this.roomsSys && this.roomsSys.closets.get(room);
    if (cl) cl.revealed = true;
    this.log('locker_open', { room });
    e.setFace('grin', 1.0, true);
    yield* this._wait(K.openAfter);
    this.uninterruptible = false;
    this.player.hidden = null;            // もう隠れていない(視線が通る)
    this.lastKnown = { x: fx, z: fz, lv: h.level };
    this.setState('ATTACK');
    yield;
  }

  // ------------------------------------------------------------ ALERT
  *_alert(opts) {
    const e = this.enemy;
    if (opts.react !== false) {
      // 物音の方へ向き直りながら驚く
      e.play('react_surprised', { fade: 0.2 });
      const k = this.lastKnown;
      for (let t = 0; t < 1.3; t += this.dt) {
        if (k) { const want = Math.atan2(k.x - e.pos.x, k.z - e.pos.z); e.yaw += THREE.MathUtils.clamp(wrap(want - e.yaw), -2 * this.dt, 2 * this.dt); }
        yield;
      }
    }
    let searched = 0;
    while (true) {
      const k = this.lastKnown;
      if (!k) break;
      const target = { ...k };
      const r = yield* this._goTo(target.x, target.z, 'ALERT', { useKey: true, lv: target.lv ?? this.level, stopIf: () => this.lastKnown && (this.lastKnown.x !== target.x || this.lastKnown.z !== target.z) });
      if (r === 'stopped') continue;   // 新しい音 → そちらへ
      // 着いたら見回す
      e.play('look_nervous', { fade: 0.4 });
      const since = () => this.time - Math.max(this.lastHeardTime || 0, this.lastSeenTime || 0);
      while (since() < AI.alertSearch && searched < AI.alertSearch * 2) {
        searched += this.dt;
        if (this.lastKnown && (this.lastKnown.x !== target.x || this.lastKnown.z !== target.z)) break;
        yield;
      }
      if (since() >= AI.alertSearch || searched >= AI.alertSearch * 2) break;
    }
    // 捜索終了 → 巡回へ
  }

  // ------------------------------------------------------------ CHASE
  *_chase() {
    const e = this.enemy;
    e.setFace('grin', 0.8);
    let lost = 0;
    let route = null, replan = 0;
    while (true) {
      const p = this.player.pos;
      if (this.canSee || this.inProximity) { lost = 0; this.lastKnown = { x: p.x, z: p.z, lv: this._plv() }; } else lost += this.dt;
      if (lost > AI.chaseLose) { this.setState('ALERT', { react: false }); yield; return; }
      const dist = Math.hypot(p.x - e.pos.x, p.z - e.pos.z);
      if (dist <= AI.attackRange && !this.occluded) { this.setState('ATTACK'); yield; return; }
      let tgt = (this.canSee || this.inProximity) ? { x: p.x, z: p.z, lv: this._plv() } : this.lastKnown;
      // P5b-1: 出入り口(705 の別空間の扉・最後の正面玄関)を抜けて逃げた → 追って抜ける(扉を抜けるのを見ている)
      if (this._plv() !== this.level && this._portalBetween(this.level, this._plv())) { tgt = { x: p.x, z: p.z, lv: this._plv() }; lost = 0; this.lastKnown = tgt; }
      const tlv = tgt.lv ?? this.level;
      // P5b-1: グラフの無い階(敷地・別空間)では、まっすぐ追う
      if (tlv === this.level && graphless(this.level)) {
        e.aimPoint = new THREE.Vector3(p.x, this.floorY + 1.1, p.z);
        const close = dist < 3.0;
        const sp = close ? 1.6 : (this.time < (this._chaseSlowUntil || 0) ? AI.roomLurk.darkChase.speed : AI.speed.CHASE);
        this._stepToward(tgt.x, tgt.z, sp, close ? 'walk_brutal' : 'run_intent', AI.turnRate.CHASE, 0.3);
        yield;
        continue;
      }
      // 別の階へ逃げた: その場所まで(EV/階段で)追う
      if (tlv !== this.level) {
        const r = yield* this._goTo(tgt.x, tgt.z, 'CHASE', { lv: tlv, stopIf: () => this.canSee });
        route = null;
        if (r !== 'stopped') { this.setState('ALERT', { react: false }); yield; return; }
        continue;
      }
      // 扉の向こう(鍵で入る部屋の中)なら鍵で開けて入る
      { const tr = this._rid(tgt.x, tgt.z, tlv), er = this._rid(e.pos.x, e.pos.z);
        if (tr && !er && this._keyDoor(tr) && !this.doors.isOpen(tr)) {
          yield* this._doorEntry(this.doors.get(tr), true);
          route = null;
          continue;
        } }
      replan -= this.dt;
      if (!route || replan <= 0) { route = this._route(e.pos.x, e.pos.z, tgt.x, tgt.z); replan = 0.25; }
      const wp = route[0] || tgt;
      { const bd = this._blockingDoor(e.pos.x, e.pos.z, wp.x, wp.z); if (bd) this.doors.open(bd, 2.0); }
      e.aimPoint = new THREE.Vector3(p.x, this.floorY + 1.1, p.z);
      // 近いときは大股の歩き(walk_brutal)、離れていれば走る
      const close = dist < 3.0;
      const sp = close ? 1.6 : (this.time < (this._chaseSlowUntil || 0) ? AI.roomLurk.darkChase.speed : AI.speed.CHASE);
      const clip = close ? 'walk_brutal' : 'run_intent';
      if (this._stepToward(wp.x, wp.z, sp, clip, AI.turnRate.CHASE, 0.3) && route.length) route.shift();
      yield;
    }
  }

  // ------------------------------------------------------------ ATTACK
  *_attack() {
    const e = this.enemy;
    e.speed = 0;
    this.uninterruptible = true;
    e.play('attack_downward', { fade: 0.15 });
    e.setFace('grin', 0);
    this.log('attack_start');
    if (this.audio) this.audio.play('scream', this.enemy.headWorld(), 1.0);
    if (this.onAttackStart) this.onAttackStart();
    const a = e.actions.attack_downward;
    const dur = a.getClip().duration;
    let hit = false;
    while (a.time < dur - 0.02 && e.current === 'attack_downward') {
      const t = a.time;
      const p = this.player.pos;
      if (t < AI.hitTime) {   // 振りかぶりの間はプレイヤーへ向き続ける
        const want = Math.atan2(p.x - e.pos.x, p.z - e.pos.z);
        e.yaw += THREE.MathUtils.clamp(wrap(want - e.yaw), -6 * this.dt, 6 * this.dt);
        e.aimPoint = new THREE.Vector3(p.x, this.floorY + 1.2, p.z);
      }
      e.setFace('attack', t < 1.25 ? 1.0 : 0.0);
      if (!hit && t >= AI.hitTime) {
        hit = true;
        const dist = Math.hypot(p.x - e.pos.x, p.z - e.pos.z);
        if (dist <= AI.hitRange && !this._blocked(p)) {
          this.log('hit', { dist: +dist.toFixed(2) });
          this.uninterruptible = false;
          this.state = 'DEAD';
          if (this.onKill) this.onKill();
          // 振り下ろしを最後まで見せる
          while (a.time < dur - 0.02) { e.setFace('attack', a.time < 1.25 ? 1 : 0); yield; }
          e.play('look_idle', { fade: 0.5 });
          while (this.state === 'DEAD') yield;
          return;
        }
        this.log('miss', { dist: +dist.toFixed(2) });
      }
      yield;
    }
    this.uninterruptible = false;
    this.setState('CHASE');
  }

  // ------------------------------------------------------------ LURK(潜伏)
  // opts.spot: 隠れ場所 id(省略時は順番に選ぶ)。opts.standNow: その場で即座に潜伏(テスト用)
  *_lurk(opts = {}) {
    const e = this.enemy, L = AI.lurk;
    this.lurkFound = null;
    // P5a: 潜伏先を選ぶ(空室 8：廊下の角 2)。opts.room = 空室の id、opts.spot = 隠れ場所の id
    let spot = opts.spot ? this.spots.find((h) => h.id === opts.spot) : null;
    if (!spot) {
      const pick = opts.room ? { room: String(opts.room) } : this._chooseLurk();
      if (pick.room) { yield* this._lurkRoom(pick.room, opts); return; }
      spot = pick.spot;
    }
    this.lurkMode = 'corner';
    this.lurkSpot = spot.id;
    this.log('lurk_go', { spot: spot.id });
    if (!opts.standNow) {
      const r = yield* this._goTo(spot.x, spot.z, 'PATROL', { useKey: true, lv: spot.level ?? 4, stopIf: () => !!this.lurkFound, arrive: 0.12 });
      if (this.lurkFound) { yield* this._ambush(); return; }
      if (r !== 'arrived') { this.setState('PATROL'); yield; return; }
      // 部屋に入った場合は中から扉を閉める(何もなかったように見せる)
      const sr = spot.room || (spot.area === 'R' ? '410' : null);
      if (sr && this._keyDoor(sr) && this.doors.isOpen(sr) && this._rid(this.player.pos.x, this.player.pos.z, this._plv()) !== sr) {
        const dp = this.doors.get(sr).pos;
        yield* this._turnTo(Math.atan2(dp[0] - e.pos.x, dp[1] - e.pos.z));
        this.doors.close(sr);
        this.log('door_closed_inside', { room: sr });
        yield* this._wait(1.0);
        if (this.lurkFound) { yield* this._ambush(); return; }
      }
      yield* this._turnTo(Math.atan2(spot.faceTo[0] - e.pos.x, spot.faceTo[1] - e.pos.z));
    }
    // 立ち止まって待つ(ごく遅い見回し・消灯・鼻歌なし)
    e.speed = 0;
    e.play('look_idle', { fade: 0.6, timeScale: L.idleTimeScale });
    this.log('lurk_stand', { spot: spot.id });
    const stand = L.standMin + this._rand() * (L.standMax - L.standMin);
    for (let t = 0; t < stand; t += this.dt) {
      if (this.lurkFound) { yield* this._ambush(); return; }
      yield;
    }
    this.setState('PATROL');
    yield;
  }

  // 隠れ場所(廊下の角・EV の死角。入れる部屋の中の隠れ場所は使わない=P5a で潜伏の主は空室)。lv の階から順番に
  _pickSpot(lv = this.level) {
    const list = this.spots.filter((h) => h.level === lv && h.area === 'C');
    if (!list.length) return this.spots.find((h) => h.area === 'C') || this.spots[0];
    this._spotIdx = this._spotIdx || {};
    this._spotIdx[lv] = ((this._spotIdx[lv] ?? -1) + 1) % list.length;
    return list[this._spotIdx[lv]];
  }

  // 発見後: grin、消灯のまま無言で近づく → ATTACK。離されたら CHASE(点灯)
  *_ambush() {
    const e = this.enemy, L = AI.lurk;
    e.setFace('grin', 0.8);
    e.aimPoint = null;
    let route = null, replan = 0, lost = 0;
    while (true) {
      const p = this.player.pos;
      const dist = Math.hypot(p.x - e.pos.x, p.z - e.pos.z);
      if (!this.occluded) { lost = 0; this.lastKnown = { x: p.x, z: p.z, lv: this._plv() }; } else lost += this.dt;
      if (dist <= AI.attackRange && !this.occluded) { this.setState('ATTACK'); yield; return; }
      if (dist > L.giveUp || lost > AI.chaseLose || this._plv() !== this.level) { this.setState('CHASE'); yield; return; }
      const tgt = this.lastKnown;
      { const tr = this._rid(tgt.x, tgt.z, tgt.lv ?? this.level), er = this._rid(e.pos.x, e.pos.z);
        const dr = er || tr;
        if (tr !== er && dr && this._keyDoor(dr) && !this.doors.isOpen(dr)) {
          if (!er) { yield* this._doorEntry(this.doors.get(tr), true); route = null; continue; }
          this.doors.setLocked(er, false); this.doors.open(er, 1.5);
        } }
      replan -= this.dt;
      if (!route || replan <= 0) { route = this._route(e.pos.x, e.pos.z, tgt.x, tgt.z); replan = 0.25; }
      const wp = route[0] || tgt;
      if (this._stepToward(wp.x, wp.z, L.approachSpeed, 'walk_brutal', 5.0, 0.3) && route.length) route.shift();
      yield;
    }
  }

  // ============================================================ P5a: 監督役と行き先の階(DESIGN §3.8 B)
  _encounter(kind) { this.lastEncounter = this.time; this.log('encounter', { kind }); }
  // 直近の遭遇からの経過で 'calm'(静か) / 'normal' / 'tense'(緊張)
  phase() {
    const since = this.time - this.lastEncounter, D = AI.director;
    return since < D.calmAfter ? 'calm' : since > D.tenseAfter ? 'tense' : 'normal';
  }
  _playerFloorNum() {
    const p = this._plv();
    if (isSpace(p)) return typeof SPACE_HOST[p] === 'number' ? SPACE_HOST[p] : 1;   // P5b-1: 別空間は入口の階
    return typeof p === 'number' ? p : p === 'RB' ? 7 : 1;   // 屋上B=7F、敷地・地下=1F として数える
  }
  // 各階の重み(1〜7F)。phase を省くと今の監督役の段階
  floorWeights(phase = this.phase()) {
    const D = AI.director, pn = this._playerFloorNum(), out = {};
    for (let lv = 1; lv <= 7; lv++) {
      let w = D.base;
      const adj = Math.abs(lv - pn) === 1;
      if (lv === pn) w += D.player; else if (adj) w += D.adjacent;
      w += Math.min(D.noiseMax, D.noiseGain * (this.noiseHist[lv] || 0));
      if (phase === 'calm') { if (lv === pn) w *= D.calm.player; else if (adj) w *= D.calm.adjacent; }
      if (phase === 'tense') { if (lv === pn) w *= D.tense.player; else if (adj) w *= D.tense.adjacent; }
      if (lv === this.level && this.floorStreak >= D.stayMax) w = 0;   // 同じ階に居続けない
      out[lv] = w;
    }
    return out;
  }
  _chooseFloor(phase = this.phase(), rnd = this._rand) {
    const w = this.floorWeights(phase);
    let sum = 0; for (const k in w) sum += w[k];
    let r = rnd() * sum;
    for (let lv = 1; lv <= 7; lv++) { r -= w[lv]; if (r <= 0) return lv; }
    return this.level;
  }
  // 潜伏先: 階は重み付き乱数、その階で空室(share)か廊下の角
  _chooseLurk() {
    const lv = this._chooseFloor();
    this.floorStreak = lv === this._lastLurkLevel ? this.floorStreak + 1 : 1;
    this._lastLurkLevel = lv;
    if (this._rand() < AI.roomLurk.share) {
      const room = this._pickLurkRoom(lv);
      if (room) { this.log('lurk_pick', { lv, room, phase: this.phase(), streak: this.floorStreak }); return { room }; }
    }
    const spot = this._pickSpot(lv);
    this.log('lurk_pick', { lv, spot: spot.id, phase: this.phase(), streak: this.floorStreak });
    return { spot };
  }
  // その階の空室(壊れていない・閉まっている・プレイヤーの目の前でない)。緊張の時はプレイヤーに近い数室から
  _pickLurkRoom(lv) {
    const R = AI.roomLurk, p = this.player.pos, same = this._plv() === lv;
    let c = this.lurkable.filter((r) => r.level === lv).map((r) => this.doors.get(r.id))
      .filter((d) => d && !d.broken && d.angle < 0.01 && !(d.shake > 0) && !(same && Math.hypot(d.pos[0] - p.x, d.pos[1] - p.z) < R.avoidNear));
    if (!c.length) return null;
    if (this.phase() === 'tense' && same) {
      c.sort((a, b) => Math.hypot(a.pos[0] - p.x, a.pos[1] - p.z) - Math.hypot(b.pos[0] - p.x, b.pos[1] - p.z));
      c = c.slice(0, AI.director.tense.nearRooms);
    }
    return c[Math.floor(this._rand() * c.length)].roomId;
  }

  // P5a: 別の階の音(階差で減衰)。聞こえたら(閾値以上・間隔)その階へ EV で向かう。返り値: 向かうなら true
  floorNoise(lv, x, z, kind) {
    const F = AI.floorHear;
    if (typeof lv !== 'number' || typeof this.level !== 'number' || lv === this.level) return false;
    const diff = Math.abs(lv - this.level);
    const heard = (F.loud[kind] ?? 0.5) * (F.att[Math.min(diff, F.att.length - 1)] || 0);
    if (heard > 0) this.noiseHist[lv] = (this.noiseHist[lv] || 0) + heard;
    this.log('floor_noise', { lv, kind, heard: +heard.toFixed(2) });
    if (heard < F.threshold || this.time - this._lastFloorGo < F.cooldown) return false;
    if (this.uninterruptible || ['ATTACK', 'DEAD', 'SCRIPTED', 'SCOPE', 'LOCKER', 'CHASE', 'EVAMBUSH'].includes(this.state)) return false;
    this._lastFloorGo = this.time;
    const tgt = { x, z, lv };
    this.log('heard_floor', { lv, kind, heard: +heard.toFixed(2) });
    if (this.state === 'LURK' && this.lurkRoomId) { this._lurkWake = tgt; return true; }   // 空室の中: 静かに出てから向かう
    this.lastKnown = tgt; this.lastHeardTime = this.time;
    this.setState('ALERT', { react: false });
    return true;
  }

  // ============================================================ P5a: 空室への潜伏と飛び出し(DESIGN §3.8 A)
  // 扉の前の座標: u = 扉の中心から幅方向、v = 廊下側への距離
  _doorLocal(d, x, z) {
    const [nx, nz] = FACING_N[d.facing];
    const tx = nz !== 0 ? 1 : 0, tz = nz !== 0 ? 0 : 1;
    const dx = x - d.pos[0], dz = z - d.pos[1];
    return { u: dx * tx + dz * tz, v: dx * nx + dz * nz };
  }
  _doorInside(d, depth) { const [nx, nz] = FACING_N[d.facing]; return { x: d.pos[0] - nx * depth, z: d.pos[1] - nz * depth }; }
  // 空室の扉を開ける/閉める(管理人だけ。ラッチと蝶番の音)
  *_npcDoor(rid, open) {
    const d = this.doors.get(rid);
    if (!d) return;
    if (open) { this._npcDoorId = rid; this.doors.npcOpen(rid, AI.roomLurk.doorOpen, 1.0); } else this.doors.npcClose(rid, 1.0);
    if (this.audio) this.audio.play('latch', doorPos(d, levelY(d.level)), AI.roomLurk.latchVol, { cutoff: 12000 });
    this.log(open ? 'room_door_open' : 'room_door_close', { room: rid });
    for (let t = 0; t < 3; t += this.dt) {
      if (d.broken) break;
      if (open ? d.angle >= AI.roomLurk.doorOpen - 0.05 : d.angle <= 0.005) break;
      yield;
    }
    if (!open) this._npcDoorId = null;
  }

  *_lurkRoom(rid, opts = {}) {
    const e = this.enemy, R = AI.roomLurk;
    const d = this.doors.get(rid);
    if (!d || d.broken) { this.setState('PATROL'); yield; return; }
    this.lurkMode = 'room';
    this.lurkTargetRoom = rid;
    this.lurkSpot = 'room:' + rid;
    this.log('lurk_go', { room: rid, lv: d.level });
    if (!opts.standNow) {
      // 1) 扉の前へ(別の階なら EV で)。歩いている間は点灯(探している)
      e.setFlashlight(true);
      const f = this._doorFront(rid, 0.75, 0);
      const r = yield* this._goTo(f.x, f.z, 'PATROL', { lv: d.level, arrive: 0.15 });
      if (r !== 'arrived' || d.broken) { this.setState('PATROL'); yield; return; }
      yield* this._turnTo(f.yaw);
      // 2) 扉を普通に開けて中へ入り、中から閉める
      this.uninterruptible = true;
      e.setFlashlight(false);
      yield* this._npcDoor(rid, true);
      const inn = this._doorInside(d, R.inside);
      for (let t = 0; t < 4; t += this.dt) { if (this._stepToward(inn.x, inn.z, 0.9, 'walk_standard', 4.0, 0.06)) break; yield; }
      e.pos.x = inn.x; e.pos.z = inn.z;
      yield* this._turnTo(Math.atan2(FACING_N[d.facing][0], FACING_N[d.facing][1]));   // 扉の方(廊下)を向く
      yield* this._npcDoor(rid, false);
      this.uninterruptible = false;
    } else {
      const inn = this._doorInside(d, R.inside);
      e.place(inn.x, inn.z, Math.atan2(FACING_N[d.facing][0], FACING_N[d.facing][1]));
    }
    // 3) 中で待つ(描かない・音を出さない)
    e.setFlashlight(false); e.speed = 0;
    e.play('look_idle', { fade: 0.6, timeScale: AI.lurk.idleTimeScale });
    this.concealed = true;
    this.lurkRoomId = rid;
    const W = this._watch = { inBand: false, lit: false, pending: null, offT: 0, sameT: 0, stillT: 0, lastBreath: -1e9,
      releaseAt: R.releaseAfter[0] + this._rand() * (R.releaseAfter[1] - R.releaseAfter[0]) };
    this.log('lurk_room_in', { room: rid, lv: d.level, releaseAt: +W.releaseAt.toFixed(1) });
    while (true) {
      const res = this._roomLurkTick(d);
      if (res === 'lit' || res === 'dark') { yield* this._burst(rid, res === 'lit'); return; }
      if (res === 'release') { yield* this._roomRelease(rid); return; }
      yield;
    }
  }

  // 潜伏中の 1 フレーム: 'lit'(点灯で通過) / 'dark'(消灯で通過して離れた) / 'release'(静かに出る) / null
  _roomLurkTick(d) {
    const R = AI.roomLurk, W = this._watch, p = this.player.pos;
    if (this._lurkWake) return 'release';
    if (this._plv() !== d.level) {
      // 別の階: 一定時間で静かに出る。通過の判定は取り消す
      if (W.pending) this.log('lurk_pass_cancel', { room: d.roomId });
      W.inBand = false; W.lit = false; W.pending = null; W.stillT = 0; W.sameT = 0;
      W.offT += this.dt;
      return W.offT >= W.releaseAt ? 'release' : null;
    }
    if (W.offT > 0) { W.offT = 0; W.releaseAt = R.releaseAfter[0] + this._rand() * (R.releaseAfter[1] - R.releaseAfter[0]); }
    W.sameT += this.dt;
    const { u, v } = this._doorLocal(d, p.x, p.z);
    const inBand = Math.abs(u) <= R.band.half && v >= -0.1 && v <= R.band.depth;
    if (inBand) {
      if (!W.inBand) this.log('lurk_band_enter', { room: d.roomId, light: this.player.flashlightOn });
      W.inBand = true;
      if (this.player.flashlightOn) W.lit = true;
    } else if (W.inBand) {
      // 帯を出た = 前を通った
      W.inBand = false;
      if (W.lit || this.player.flashlightOn) { this.log('lurk_pass', { room: d.roomId, lit: true }); return 'lit'; }
      W.pending = { at: R.darkBurst[0] + this._rand() * (R.darkBurst[1] - R.darkBurst[0]) };
      this.log('lurk_pass', { room: d.roomId, lit: false, burstAt: +W.pending.at.toFixed(2) });
    }
    if (W.pending && !inBand && Math.hypot(p.x - d.pos[0], p.z - d.pos[1]) >= W.pending.at) return 'dark';
    if (!W.pending && !inBand && W.sameT > R.maxSameLevel) return 'release';
    // 静かな予兆: 扉から 1.5m 以内で 1 秒以上静止すると、ごく小さな呼吸
    const B = R.breath;
    if (Math.hypot(p.x - d.pos[0], p.z - d.pos[1]) <= B.dist && this.playerSpeed < 0.15) {
      W.stillT += this.dt;
      if (W.stillT >= B.still && this.time - W.lastBreath >= B.every) {
        W.lastBreath = this.time;
        if (this.audio) this.audio.play('breathDoor', doorPos(d, levelY(d.level)), B.vol, { cutoff: B.cutoff, ref: 1.0 });
        this.log('lurk_breath', { room: d.roomId });
      }
    } else W.stillT = 0;
    return null;
  }

  // 扉を壊して飛び出す。lit: 点灯で通過(視点を向けさせてそのまま襲う)/消灯(視点を固定する短いムービー → 追跡)
  *_burst(rid, lit) {
    const e = this.enemy, R = AI.roomLurk;
    const d = this.doors.get(rid);
    this.uninterruptible = true;
    this.concealed = false; this.lurkRoomId = null; this._npcDoorId = null;
    this._encounter(lit ? 'burst_lit' : 'burst_dark');
    this.doors.breakDoor(rid);
    // 破壊音: 同じ階は全域(基準距離を大きく)、上下の階には小さくこもって届く
    { const dl = Math.round(Math.abs(levelY(this._plv()) - levelY(this.level)) / 2.9);
      const C = R.crash;
      if (this.audio && dl < C.vol.length) this.audio.play('crash', doorPos(d, levelY(d.level)), C.vol[dl], { ref: C.ref, cutoff: C.cutoff[dl] || 16000 });
      this.log('crash', { room: rid, levelDiff: dl, vol: dl < C.vol.length ? C.vol[dl] : 0 }); }
    this.log('lurk_burst', { room: rid, lit });
    const [nx, nz] = FACING_N[d.facing];
    const p0 = this.player.pos;
    e.place(d.pos[0] - nx * 0.15, d.pos[1] - nz * 0.15, Math.atan2(p0.x - d.pos[0], p0.z - d.pos[1]));
    e.setFace('grin', 1.0, true);
    e.play('walk_brutal', { fade: 0.1 });
    if (lit) {
      // 振り向かされる → 詰めて → 襲撃ムービー(しゃがみ等の救済なし)
      if (this.onViewLock) this.onViewLock({ total: 0, label: 'burst_lit', returnView: false });
      for (let t = 0; t < 1.4; t += this.dt) {
        const p = this.player.pos;
        if (Math.hypot(p.x - e.pos.x, p.z - e.pos.z) <= R.litReach) break;
        this._stepToward(p.x, p.z, R.litLunge, 'run_intent', 14.0, 0.05);
        yield;
      }
      this.uninterruptible = false;
      this.lastKnown = { x: this.player.pos.x, z: this.player.pos.z, lv: this._plv() };
      this.setState('ATTACK');
      yield;
      return;
    }
    // 消灯: 戸口から廊下へ一歩出てこちらを向き、懐中電灯で照らす(視点はその間だけ管理人に固定)
    const out = { x: d.pos[0] + nx * R.darkStep, z: d.pos[1] + nz * R.darkStep };
    e.setFlashlight(true);
    if (this.onViewLock) this.onViewLock({ total: R.darkLock, label: 'burst_dark', returnView: true });
    let t = 0;
    for (; t < 0.6; t += this.dt) { if (this._stepToward(out.x, out.z, 2.2, 'walk_brutal', 8.0, 0.08)) break; yield; }
    e.speed = 0;
    e.play('look_idle', { fade: 0.25 });
    for (; t < R.darkLock + R.chaseDelay; t += this.dt) {
      const p = this.player.pos;
      const want = Math.atan2(p.x - e.pos.x, p.z - e.pos.z);
      e.yaw += THREE.MathUtils.clamp(wrap(want - e.yaw), -5 * this.dt, 5 * this.dt);
      e.aimPoint = new THREE.Vector3(p.x, this.floorY + 1.3, p.z);
      yield;
    }
    this.uninterruptible = false;
    this.lastKnown = { x: this.player.pos.x, z: this.player.pos.z, lv: this._plv() };
    this.lastSeenTime = this.time;
    this._chaseSlowUntil = this.time + R.darkChase.time;
    this.setState('CHASE');
    yield;
  }

  // 静かな解除: 扉を普通に開けて出て、閉める(扉は壊れない・破壊音なし)
  *_roomRelease(rid) {
    const e = this.enemy;
    const d = this.doors.get(rid);
    const wake = this._lurkWake; this._lurkWake = null;
    this.uninterruptible = true;
    this.log('lurk_release', { room: rid, why: wake ? 'floor_noise' : (this._plv() !== d.level ? 'player_left' : 'timeout') });
    yield* this._npcDoor(rid, true);
    this.concealed = false; this.lurkRoomId = null;
    const f = this._doorFront(rid, 0.75, 0);
    for (let t = 0; t < 4; t += this.dt) { if (this._stepToward(f.x, f.z, 0.9, 'walk_standard', 4.0, 0.08)) break; yield; }
    yield* this._turnTo(f.yaw);
    yield* this._npcDoor(rid, false);
    this.uninterruptible = false;
    this.log('lurk_released', { room: rid });
    if (wake) { this.lastKnown = wake; this.lastHeardTime = this.time; this.setState('ALERT', { react: false }); yield; return; }
    this.setState('PATROL');
    yield;
  }

  // ============================================================ P5a: EV の賭け(DESIGN §3.8 B)
  // プレイヤーが EV を呼んだ(main から。カゴが別の階にいた時)。管理人を乗せたカゴが止まってから T 秒以内なら、中に乗っていることにする
  evGambleCheck(lv) {
    const ev = this.elevator, G = AI.evGamble;
    const s = ev && ev.npcStop;
    if (!s) return false;
    const age = ev.time - s.t;
    const ok = age <= G.T && !s.used && ev.car.level === s.level && ev.car.state !== 'moving' && s.level !== lv && this.level === s.level
      && !this.uninterruptible && !this.transit && !['CHASE', 'ATTACK', 'DEAD', 'SCRIPTED', 'SCOPE', 'LOCKER', 'EVAMBUSH'].includes(this.state);
    this.log('ev_gamble_check', { lv, age: +age.toFixed(1), ok });
    if (!ok) return false;
    s.used = true;
    this.setState('EVAMBUSH', { level: lv });
    return true;
  }
  *_evAmbush(opts) {
    const e = this.enemy, ev = this.elevator, c = ev.car, to = opts.level, G = AI.evGamble;
    this.uninterruptible = true;
    this.transit = true;                      // 姿を消す(カゴの中にいる)
    this.log('ev_ambush', { from: this.level, to });
    ev.npc = { to, ambush: true };
    let t = 0;
    while (!(c.level === to && (c.state === 'opening' || c.state === 'open'))) {
      t += this.dt;
      if (t > 60) { this.transit = false; ev.npc = null; this.uninterruptible = false; this.setState('PATROL'); yield; return; }
      yield;
    }
    // 着いた階のカゴの中に現れる(扉が開くと中に管理人)
    const g = ev.rooms[to].geom;
    this.setLevel(to);
    e.place(g.center[0] + 0.1, g.center[1] + 0.15, Math.PI);
    this.transit = false;
    e.setFlashlight(false);
    e.setFace('grin', 1.0, true);
    e.play('look_idle', { fade: 0.2, timeScale: 0.4 });
    const door = { x: (g.open[0] + g.open[1]) / 2, z: g.doorZ[0] };
    while (c.level === to && c.open < 1 && c.state !== 'closing') {
      const p = this.player.pos;
      e.aimPoint = new THREE.Vector3(p.x, this.floorY + 1.3, p.z);
      yield;
    }
    ev.npc = null;
    const p = this.player.pos;
    const dist = Math.hypot(p.x - door.x, p.z - door.z);
    const near = this._plv() === to && dist <= G.reach;
    this._encounter('ev_ambush');
    this.log(near ? 'ev_ambush_attack' : 'ev_ambush_chase', { dist: +dist.toFixed(2) });
    if (near) {
      if (this.onViewLock) this.onViewLock({ total: 0, label: 'ev', returnView: false });
      // カゴの戸口を抜けてから(袖の壁に引っ掛からない)プレイヤーへ詰める
      const exit = { x: door.x, z: door.z - 0.35 };
      let out = false;
      for (let k = 0; k < 2.0; k += this.dt) {
        const q = this.player.pos;
        if (Math.hypot(q.x - e.pos.x, q.z - e.pos.z) <= AI.roomLurk.litReach) break;
        if (!out && (e.pos.z <= exit.z + 0.1 || Math.hypot(q.x - e.pos.x, q.z - e.pos.z) < 1.6)) out = true;
        const tx = out ? q.x : exit.x, tz = out ? q.z : exit.z;
        this._stepToward(tx, tz, G.lunge, 'walk_brutal', 12.0, 0.05);
        yield;
      }
      this.uninterruptible = false;
      this.lastKnown = { x: this.player.pos.x, z: this.player.pos.z, lv: this._plv() };
      this.setState('ATTACK');
      yield;
      return;
    }
    this.uninterruptible = false;
    this.lastKnown = { x: p.x, z: p.z, lv: this._plv() };
    this.lastSeenTime = this.time;
    this.setState('CHASE');
    yield;
  }

  // ------------------------------------------------------------ SCOPE(覗き返し、P2d)
  *_scope() {
    const e = this.enemy, S = SCOPE;
    const lensZ = DOOR410.z;
    this.uninterruptible = true;
    this.log('scope_start');
    e.setFace('grin', 0); e.setFace('attack', 0); e.aimPoint = null; e.setFlashlight(true);
    const fromSouth = e.pos.z >= lensZ;
    const start = fromSouth ? { x: 6.9, z: 9.6 } : { x: 6.9, z: 6.3 };
    const passEnd = fromSouth ? { x: 6.9, z: 6.5 } : { x: 6.9, z: 8.2 };
    const pocket = fromSouth ? { x: 7.42, z: 6.2 } : { x: 7.42, z: 8.32 };   // 扉脇の壁際=スコープの視野(±55°)の外
    // 1) 通り過ぎる起点へ(扉より手前の側。扉に近ければいったん下がる)
    yield* this._goTo(start.x, start.z, 'PATROL', { arrive: 0.25 });
    // 2) 気づかないふりで扉の前を横切る(足音あり)
    let passed = false;
    for (let t = 0; t < 20; t += this.dt) {
      if (!passed && (fromSouth ? e.pos.z < lensZ : e.pos.z > lensZ)) { passed = true; this.log('scope_pass'); }
      if (this._stepToward(passEnd.x, passEnd.z, S.passSpeed, 'walk_oldman', 2.0, 0.12)) break;
      yield;
    }
    // 3) 壁際へ寄って視界から消える → 消灯して静まる
    for (let t = 0; t < 6; t += this.dt) { if (this._stepToward(pocket.x, pocket.z, 0.6, 'walk_standard', 3.0, 0.06)) break; yield; }
    e.setFlashlight(false);
    e.speed = 0;
    e.play('look_idle', { fade: 0.4, timeScale: 0.2 });
    this.log('scope_hide');
    yield* this._wait(S.hide);
    // 4) いきなり戻ってくる(扉の正面へ素早く)。戻る時にはもう満面の笑み
    this.log('scope_return');
    e.setFace('grin', 1.0, true);
    for (let t = 0; t < 3; t += this.dt) {
      if (this._stepToward(S.stareX, lensZ, S.returnSpeed, 'walk_hurried', 12.0, 0.05)) break;
      yield;
    }
    e.yaw = Math.PI / 2;   // 扉(+x)へ正対
    // 5) 覗き込む: 上体を倒して頭をレンズの手前へ。顔は下から懐中電灯の照り返しで浮かぶ
    e.play('look_nervous', { fade: 0.15, timeScale: 0.0 });
    e.actions.look_nervous.time = 5.4;   // 頭がほぼ正面を向く瞬間
    e.setFlashlight(true);
    const L = this.getLens ? this.getLens() : { x: 7.785, z: lensZ };
    const lensY = this.floorY + (this.lensEyeY || 1.48);
    e.aimPoint = new THREE.Vector3(L.x, this.floorY + 0.7, L.z);
    e.faceFill = 0.5;
    e.faceRate.grin = 6; e.faceRate.attack = 4;
    let stareT = 0, logged = false;
    this.scopeFaceDist = Infinity;
    const head = new THREE.Vector3();
    while (stareT < S.stare) {
      e.headWorld(head);
      // 頭の高さ・前後を目標へ寄せる(上体の倒し=lean、立ち位置=root.x)
      // 頭(骨)の高さを上体の倒し(lean)で、前後を立ち位置で合わせる。首で起こすので顔は正面のまま、
      // レンズ(床から 1.48m)の真正面に顔が来る(大柄な管理人が背を丸めて覗き込む)
      const tx = L.x - S.headGap, ty = lensY + 0.04;
      e.lean = THREE.MathUtils.clamp(e.lean + (head.y - ty) * 14.0 * this.dt, 0, 0.8);
      e.pos.x = THREE.MathUtils.clamp(e.pos.x + THREE.MathUtils.clamp((tx - head.x) * 0.8, -0.04, 0.04), 6.9, S.stareX + 0.06);
      e.pos.z += (L.z - e.pos.z) * 0.2;
      const face = head.clone().add(new THREE.Vector3(0.08, 0.07, 0));   // 顔の前面(扉側 +x)
      this.scopeFaceDist = Math.hypot(face.x - L.x, face.y - lensY, face.z - L.z);
      if (this.scopeFaceDist <= 0.3) {
        if (!logged) { logged = true; this.log('scope_stare', { dist: +this.scopeFaceDist.toFixed(3) }); }
        stareT += this.dt;
        if (stareT >= 0.5) { e.setFace('attack', 1.0); e.setFace('grin', 0.6); }
      } else if (stareT === 0) {
        this._stareWait = (this._stareWait || 0) + this.dt;
        if (this._stareWait > 1.5) { stareT = 1e-3; }   // 届かなくても演出は進める
      }
      yield;
    }
    this._stareWait = 0;
    // 6) ノブに手を掛けて扉を開けて入る(P5a: 鍵束・錠は撤去。覗き穴視点はここで閉じる。プレイヤーは室内から扉が開くのを見る)
    if (this.audio) this.audio.play('handle', doorPos(this.doors.get('410'), this.floorY), 0.9);
    this.log('scope_knob', { room: '410' });
    this.doors.setLocked('410', false);
    if (this.onScopeOpen) this.onScopeOpen();
    yield* this._wait(S.knob);
    e.lean = 0; e.faceFill = 0; e.faceRate.grin = 0.8; e.faceRate.attack = 3.0;
    e.setFace('attack', 0); e.setFace('grin', 0.8);
    this.doors.open('410', 3.0);
    this.log('door_opened', { room: '410' });
    yield* this._wait(0.35);
    this.uninterruptible = false;
    this.lastKnown = { x: this.player.pos.x, z: this.player.pos.z, lv: this._plv() };
    this.setState('CHASE');
    yield;
  }

  // ------------------------------------------------------------ SCRIPTED(デバッグ)
  *_scripted(opts) {
    if (opts.goto) {
      yield* this._goTo(opts.goto.x, opts.goto.z, 'SCRIPTED', { useKey: true });
      this.enemy.play('look_idle');
    }
    while (true) yield;
  }

  stats() {
    const e = this.enemy;
    return {
      state: this.state, level: this.level, transit: this.transit, pos: [+e.pos.x.toFixed(3), +e.pos.z.toFixed(3)], yaw: +e.yaw.toFixed(3), action: e.current,
      face: { grin: +e.face.grin.toFixed(2), attack: +e.face.attack.toFixed(2) },
      canSee: this.canSee, heard: this.heard, occluded: this.occluded, lastKnown: this.lastKnown,
      uninterruptible: this.uninterruptible,
      knownRoomId: this.knownRoomId, scopeFaceDist: this.scopeFaceDist, playerRoom: this._playerRoom,
      lurkSpot: this.state === 'LURK' ? this.lurkSpot : null, lurkFound: this.state === 'LURK' ? this.lurkFound : null,
      enemyFlashlight: this.enemy.flashlight.on,
      lurkMode: this.lurkMode, lurkRoom: this.lurkRoomId, concealed: this.concealed, phase: this.phase(),
    };
  }
}

const _tmpV = new THREE.Vector3();
function doorPos(door, floorY) {
  const c = door.collision;
  return new THREE.Vector3(c ? (c.minX + c.maxX) / 2 : 0, floorY + 1.0, c ? (c.minZ + c.maxZ) / 2 : 0);
}
function wrap(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
function mulberry(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
