// hud_text.js — 画面ガイドの文言(P2e)。P4/P6 で正文化するため、表示する文字列はすべてここに集約する。
// 形式: キー = 用途。{ key: 'E', text: '開ける' } のように「キー表示」と「動作」を分けて持つ(キーの差し替えに強くする)。
export const HUD_TEXT = {
  door: {
    open: { key: 'E', text: '開ける' },
    close: { key: 'E', text: '閉める' },
    lock: { key: 'L', text: '施錠' },
    unlock: { key: 'L', text: '解錠' },
    lockedBadge: '🔒 施錠中',
    lockedOther: '鍵がかかっている',          // 開かない扉で E を押した時(1 秒)
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
  controls: 'WASD 移動　／　Shift 走る　／　Ctrl しゃがむ　／　F 懐中電灯　／　E 調べる　／　L 施錠　／　H 操作の表示',
  flashlight: { on: '懐中電灯　ON', off: '懐中電灯　OFF' },
  start: 'クリックで開始',
  resume: 'クリックで再開',
  death: { title: '見つかった', sub: '…　チェックポイントへ戻ります' },
};
