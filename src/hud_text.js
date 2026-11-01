// hud_text.js — 画面ガイドの文言(P2e)。P4/P6 で正文化するため、表示する文字列はすべてここに集約する。
// 形式: キー = 用途。{ key: 'E', text: '開ける' } のように「キー表示」と「動作」を分けて持つ(キーの差し替えに強くする)。
export const HUD_TEXT = {
  door: {
    open: { key: 'E', text: '開ける' },
    close: { key: 'E', text: '閉める' },
    lockedOther: '鍵がかかっている',          // 開かない扉で E を押した時(1 秒)
    autoLocked: '自動ドアが反応しない',        // P3c-2: 最初は動かない正面玄関の外側の自動ドアで E を押した時(1 秒)
  },
  scope: {
    peep: { key: 'E 長押し', text: '覗く' },
    release: { key: 'E を離す', text: 'やめる' },
    releaseP: { key: 'P を離す', text: 'やめる' },
  },
  ev: {
    call: { key: 'E', text: '呼ぶ' },
    noResponse: '反応がない',                 // P0 では EV は動かない(1 秒)。P3a 以降は未使用
    called: 'エレベーターを呼んだ',            // P3a: 呼びボタン(カゴが別の階)
    opened: '扉が開く',                         // P3a: カゴがこの階にいた
    button: (n) => ({ key: 'E', text: `${n}階へ` }),   // カゴの行き先ボタン(視線の先)
    panel: { key: '1〜7', text: '行き先' },
    selected: (n) => `${n}階`,
  },
  stair: {                                      // P3a: 外階段・北階段の段の口
    up: { key: 'W', text: '上の階へ' },
    down: { key: 'W', text: '下の階へ' },
    roof: { key: 'W', text: '屋上へ' },
    basement: { key: 'W', text: '地下へ' },     // P3a-2: 1F 食堂奥の地下への階段
  },
  room: {                                       // P3b: 入れる部屋(掃き出し窓・隠れ場所・屋上A の隔て板)
    winOpen: { key: 'E', text: '窓を開ける' },
    winClose: { key: 'E', text: '窓を閉める' },
    hide: { key: 'E', text: '隠れる' },
    unhide: { key: 'E', text: '出る' },
    climb: { key: 'E', text: '乗り越える' },
    cantClimb: '乗り越えられない',
  },
  // P5a: 管理人がプレイヤーの階に着いた時に一度だけ(3 秒、小さく)。呼称は「プレイヤー」で統一(DESIGN §3.8 C)
  sameFloor: '管理人が同じ階で「プレイヤー」をさがしている。。。',
  // P5a: 行動パターンのチュートリアル(仮文。P6 で正文化)。ゲーム開始直後に 1 枚ずつ(クリック/Esc/Enter で送る)
  tutorial: [
    { title: '管理人', body: '深夜の館内を、管理人が歩いている。\n見つかれば、終わり。' },
    { title: '潜む', body: '管理人は、空いている部屋の中に潜んでいることがある。\n懐中電灯を点けたまま扉の前を通ると、扉を破って襲ってくる。\n消していれば、少し離れてから飛び出してくる。走って逃げろ。' },
    { title: 'エレベーター', body: '管理人はエレベーターで階を移る。\nだれも呼んでいないのに表示が動いたら、管理人が乗っている。' },
    { title: '音', body: '走る音、物の落ちる音は、上下の階にも届く。\n音を立てれば、管理人はその階へ来る。' },
    { title: '賭け', body: '管理人が降りたばかりのエレベーターを呼ぶと、\nまだ中にいるかもしれない。チャイムが鳴ったら、離れろ。' },
  ],
  tutorialNext: 'クリック／Esc で次へ',
  controls: 'WASD 移動　／　Shift 走る　／　Ctrl しゃがむ　／　F 懐中電灯　／　E 調べる　／　H 操作の表示',
  flashlight: { on: '懐中電灯　ON', off: '懐中電灯　OFF' },
  start: 'クリックで開始',
  resume: 'クリックで再開',
  death: { title: '見つかった', sub: '…　チェックポイントへ戻ります' },
};
