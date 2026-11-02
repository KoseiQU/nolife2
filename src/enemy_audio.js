// enemy_audio.js — 管理人の音(P2b のプレースホルダ → P4b で採用した音に接続 → P4c で 3 周目を反映し、合成の仮音を全部外した)。
//  - play(名前) は ROUTE で場面へ振り分ける。採用した場面は AudioBank(src/audio_bank.js)の wav／声、「なし」の場面は無音(記録だけ残す)。
//    ROUTE に無い名前も無音(記録だけ)。対応表は docs/p4b/NOTES.md §2 と docs/p4c/NOTES.md。
//  - P4a: 常時ループの鼻歌/唸り(hum = enemy_hum_loop_01)は削除(ユーザー所見「ずっと流れているジーという音」の正体)。
//    管理人の気配は間欠的な音(足音・息・取っ手…)だけで出す。置き換えの音は P4b(samples/sound.html の選択)で決める。
//  - 足音(接地に同期)・ノブのガチャなどを足元/扉の位置から鳴らす(P5a: 鍵束・錠の音は撤去)。
//  - 壁越し: AI の遮蔽判定(壁箱・閉扉)の結果で lowpass の cutoff を 18kHz → 600Hz へ落とす(=こもる)。
// AudioContext はユーザー操作まで suspended。main がクリック/キーで resume() を呼ぶ。

import * as THREE from 'three';

// P4b/P4c: 名前 → 場面 ID(採用 = AudioBank で鳴らす)/ null(なし = 無音。呼ばれても記録だけ)
export const ROUTE = {
  step: 'enemy_step_walk',         // P4c: 3 周目 A(ゴム底の重い足音)。走り(opts.run)は enemy_step_run(採用 C)。B1 の上の階の足音(xb1.js)もこれをこもらせる
  run: 'enemy_step_run',
  crash: 'enemy_door_smash',       // 採用 C(爆発のように調整)
  hit: 'enemy_hit',                // 採用 A(より重く調整)
  breathDoor: 'enemy_breath_door', // 採用 B(声。笑い・台詞を足して 3 本を順に)
  x105_scream: 'x105_scream',      // 採用 C(声。105 の追跡の始まり・B1 の戻りの遠い悲鳴)
  rattle: null,                    // door_locked なし(開かない扉・管理人がノブを確かめる)
  handle: null,                    // enemy_handle なし
  latch: null,                     // enemy_door_latch なし
  scream: null,                    // P4c: enemy_scream なし(3 周目。機械音感が強い)
  slam: null,                      // P4c: room_door_rattle なし(扉のガタガタ演出ごと廃止。演出の削除は P5b-6)。クローゼットを開ける時の 'slam' も無音
  breath: null,                    // P4c: enemy_breath_close なし(3 周目)
};

export const ENEMY_AUDIO = {
  stepVolume: { walk: 0.7, run: 1.0 },
  refDistance: 1.4,
  rolloff: 1.3,
  maxDistance: 40,
  cutoffClear: 18000,
  cutoffOccluded: 600,
  occludedGain: 0.55,
};

export class EnemyAudio {
  constructor(camera, enemy) {
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);
    this.ctx = this.listener.context;
    this.enemy = enemy;
    this.occluded = 0;          // 0..1(なめらかに追従)
    this.occludedTarget = 0;
    this.state = null;          // AI の状態(記録のみ。P4a で常時ループを削除したので音量には使わない)
    this.bank = null;           // P4b: AudioBank(main が渡す)。採用した場面はここで鳴らす
    // P4c: 合成の仮音(歩き・叫び・目の前の息・ガタガタ)は全部外した。鳴る音はすべて AudioBank 経由
    this.log = [];              // 鳴らした音の記録(テスト用)
  }

  resume() {
    if (this.ctx.state !== 'running') this.ctx.resume();
  }

  setState(state) { this.state = state; }
  setOccluded(v) { this.occludedTarget = v ? 1 : 0; }

  // name: ROUTE のキー('step' は足音 4 区画から選ぶ)。pos: 世界座標
  // opts(P5a): cutoff = この音だけ固定のこもり(Hz。管理人の遮蔽に従わない＝扉・別の階の音)、ref = 距離減衰の基準距離(大きいほど遠くまで届く)、
  //  dur = この秒数で切る(長い音の一部だけ鳴らす)
  play(name, pos, volume = 1, opts = {}) {
    // P4b: 走り(opts.run)は別の場面。記録の名前は今まで通り(テストが 'step' などで数える)
    const route = name === 'step' && opts.run ? ROUTE.run : (Object.hasOwn(ROUTE, name) ? ROUTE[name] : null);   // P4c: ROUTE に無い名前も無音
    this.logCount = (this.logCount || 0) + 1;   // P5a: 通し番号(log は 200 件で古い物から消えるので、テストは番号で区切る)
    this.log.push({ n: this.logCount, name, t: this.ctx.currentTime, vol: +volume.toFixed(3), pos: pos ? [pos.x, pos.y, pos.z].map((v) => +v.toFixed(2)) : null, ...(opts.cutoff ? { cutoff: opts.cutoff } : {}),
      ...(route === null ? { silent: true } : { scene: route }) });
    if (this.log.length > 200) this.log.shift();
    if (route === null || !this.bank) return;       // 「なし」の場面
    // 採用した場面(wav / 声)。壁越しは今のこもり(遮蔽の仕組み)を固定の cutoff として渡す
    const occ = !opts.cutoff;
    const o = { pos, vol: volume * (occ ? (1 - this.occluded * (1 - ENEMY_AUDIO.occludedGain)) : 1), ref: opts.ref ?? ENEMY_AUDIO.refDistance, rolloff: ENEMY_AUDIO.rolloff,
      cutoff: opts.cutoff || (this.cutoff && this.cutoff < 17000 ? this.cutoff : 0), dur: opts.dur };
    if (route === ROUTE.step) o.rate = 0.95 + Math.random() * 0.1;   // P4c: 歩きは 1 歩ごとに少しだけ音程を揺らす(P2b の仮音と同じ考え方)
    if (this.bank.status(route) === 'voice') { if (route === ROUTE.breathDoor) o.cutoff = 0; this.bank.voice(route, o); }   // 扉越しのこもりは声の加工に入っている
    else this.bank.play(route, o);
  }

  update(dt) {
    const k = 1 - Math.exp(-dt * 5);
    this.occluded += (this.occludedTarget - this.occluded) * k;
    // cutoff は対数で補間(耳の感じ方に合わせる)
    const lc = Math.log(ENEMY_AUDIO.cutoffClear), lo = Math.log(ENEMY_AUDIO.cutoffOccluded);
    this.cutoff = Math.exp(lc + (lo - lc) * this.occluded);
  }
}
