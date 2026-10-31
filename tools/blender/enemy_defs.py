# enemy_defs.py — 管理人候補6体の定義(データのみ)。enemy_build.py / enemy_render.py が読む。
#
# phenotype : MPFB のマクロ(0..1)。age は AGE(歳) で MakeHuman の換算(25歳=0.5, 90歳=1.0)に直す。
#             race は日本の学生会館の管理人なので asian を主体に、少しだけ混ぜて顔立ちを散らす。
# targets   : MPFB 同梱ターゲット(顔・体の細部)。{名前: 値(0..1)}。名前は .target.gz の basename。
# expr      : 表情ユニット(MPFB 同梱 expression/units/asian/*)。無表情〜わずかに不気味の範囲に留める。
# skin      : system assets の肌。skin_tint=(彩度倍率, 明度倍率)=血色の悪さ。skin_rough=肌の粗さ(低い=脂っぽい)。
# hair / eyebrows / clothes : MakeHuman アセット(.mhclo の basename)。
# recolor   : {アセット名: [(マスク, RGB(sRGB), 混ぜ率, 濃淡の残し率), ...]}
#             マスク None=全体 / ('hue', 中心度, 幅度, 最低彩度) / ('lum_below', 閾値)
#             元テクスチャの濃淡(しわ・縫い目・柄)は「濃淡の残し率」だけ残して色だけ差し替える。
#             5番目(任意)=(下限, 上限[, 白消し閾値]): 元の相対輝度をこの範囲に切る。白消し閾値を与えると
#             その明るさを超える白い領域(ワッペン・ロゴ文字・反射帯)を周囲の地の色で塗りつぶす。
# strip     : {アセット名: 'sleeves'|'hem'} = 袖を落としてベスト化 / 裾を腰下で切る(簡易加工)。
# push      : {アセット名: m} = 外側の服を法線方向へ膨らませて下の服の突き抜けを隠す。
# flat      : [アセット名] = 法線マップ・AO を外す(元アセットのロゴの凹凸を消す)。
# extras    : enemy_build.py が自作する小物。'armband'(腕章「管理」) / 'nametag'(名札) / 'badge'(真鍮の徽章) /
#             'vest:元シャツ:R:G:B'(シャツを複製して袖・襟を落としたベスト)。
# pose      : 立ち姿。arm_out=腕の開き(鉛直から度), elbow=肘の曲げ(度), slouch=猫背(背骨の前傾合計),
#             neck=首の前傾, head_tilt=頭の前傾(+で顎を引く=上目遣い), head_turn=首の左右, head_roll=首の傾げ。

def AGE(years):
    return 0.5 + (years - 25) / 65 * 0.5 if years >= 25 else years / 25 * 0.5


GRAYWHITE = (0.80, 0.79, 0.76)

CANDIDATES = [
    dict(
        id='01', name='01_kanrinin_standard', short='標準の管理人',
        age=64, build='痩身', outfit='灰色の作業ジャンパー＋濃灰のカーゴパンツ',
        phenotype=dict(gender=1.0, age=AGE(64), muscle=0.30, weight=0.18, height=0.52, proportions=0.45,
                       race=dict(asian=0.92, caucasian=0.08, african=0.0)),
        targets={'r-eye-bag-incr': 0.7, 'l-eye-bag-incr': 0.7, 'r-cheek-volume-decr': 0.6, 'l-cheek-volume-decr': 0.6,
                 'head-age-incr': 0.3, 'neck-scale-horiz-decr': 0.4, 'mouth-scale-horiz-decr': 0.2,
                 'mouth-angles-down': 0.5},
        expr={'eye-left-opened-up': 0.15, 'eye-right-opened-up': 0.15,
              'eyebrows-left-down': 0.10, 'eyebrows-right-down': 0.10},
        skin='old_asian_male', skin_tint=(0.45, 0.95), skin_rough=0.40, eyes='brown',
        hair='short02', eyebrows='eyebrow001', eyelashes='eyelashes01',
        clothes=['elvs_emt_uniform_jacket_male', 'cortu_cargo_pants', 'shoes02'],
        recolor={
            'short02': [(None, GRAYWHITE, 1.0, 0.8)],
            'eyebrow001': [(None, (0.62, 0.61, 0.58), 0.9, 0.8)],
            # 救急隊ジャケット(赤・反射帯)→ くすんだ灰色の作業ジャンパー(濃淡を弱めて反射帯・ワッペンを目立たなくする)
            'elvs_emt_uniform_jacket_male': [(None, (0.36, 0.37, 0.36), 1.0, 0.45, (0.7, 1.1, 0.5))],
            'cortu_cargo_pants': [(None, (0.19, 0.19, 0.20), 1.0, 0.8)],
        },
        strip={}, extras=[], flat=['elvs_emt_uniform_jacket_male'],
        pose=dict(arm_out=7, elbow=10, slouch=6, neck=6, head_tilt=4, head_turn=0, head_roll=0),
        aim='最も「らしい」基準形。痩せて白髪、くたびれた作業着。普通の老人に見えることが怖さ',
        risk='地味で他の5体より印象が弱い／遠目では一般の老人と区別がつきにくい',
    ),
    dict(
        id='02', name='02_kanrinin_burly', short='がっしりした作業着',
        age=55, build='がっしり', outfit='紺のつなぎ作業着＋腕章「管理」',
        phenotype=dict(gender=1.0, age=AGE(55), muscle=0.75, weight=0.78, height=0.61, proportions=0.40,
                       race=dict(asian=0.88, caucasian=0.07, african=0.05)),
        targets={'neck-scale-horiz-incr': 0.7, 'neck-double-incr': 0.4, 'head-fat-incr': 0.4, 'head-square': 0.6,
                 'stomach-pregnant-incr': 0.35, 'r-eye-bag-incr': 0.4, 'l-eye-bag-incr': 0.4,
                 'measure-shoulder-dist-incr': 0.5},
        expr={'eyebrows-left-down': 0.35, 'eyebrows-right-down': 0.35,
              'eye-left-slit': 0.10, 'eye-right-slit': 0.10},
        skin='middleage_asian_male', skin_tint=(0.60, 0.88), skin_rough=0.32, eyes='brown',
        hair='short01', eyebrows='eyebrow003', eyelashes='eyelashes01',
        clothes=['elvs_male_coveralls_1', 'shoes04'],
        recolor={
            'short01': [(None, (0.17, 0.165, 0.16), 0.9, 0.9)],
            # 胸の MakeHuman ロゴ刺繍は白消しで地の紺に
            'elvs_male_coveralls_1': [(None, (0.13, 0.16, 0.25), 1.0, 0.85, (0.4, 1.6, 0.17))],
        },
        strip={}, extras=['armband'], flat=['elvs_male_coveralls_1'],
        pose=dict(arm_out=10, elbow=14, slouch=2, neck=2, head_tilt=8, head_turn=0, head_roll=0),
        aim='腕力で逃げ道を塞ぐ圧。腕章が「仕事として回っている」ことを示す',
        risk='「怖い管理人」として最もわかりやすいが、ゲームの敵として既視感がある',
    ),
    dict(
        id='03', name='03_jimuin', short='事務員風',
        age=46, build='中肉', outfit='眼鏡＋水色シャツとネクタイ＋茶のカーディガン＋名札',
        phenotype=dict(gender=1.0, age=AGE(46), muscle=0.45, weight=0.50, height=0.48, proportions=0.50,
                       race=dict(asian=0.95, caucasian=0.05, african=0.0)),
        targets={'head-oval': 0.5, 'r-cheek-volume-incr': 0.3, 'l-cheek-volume-incr': 0.3,
                 'r-eye-bag-incr': 0.5, 'l-eye-bag-incr': 0.5, 'nose-scale-horiz-incr': 0.2},
        # 貼り付いた薄笑い(口角だけ上げて目は笑っていない)
        expr={'mouth-corner-puller': 0.22, 'eye-left-opened-up': 0.10, 'eye-right-opened-up': 0.10},
        skin='middleage_asian_male', skin_tint=(0.50, 0.97), skin_rough=0.38, eyes='brown',
        hair='short02', eyebrows='eyebrow006', eyelashes='eyelashes01',
        clothes=['elvs_male_shirt_tie_tucked1', 'mindfront_cardigan_long_open_front', 'mindfront_male_trousers_2',
                 'mindfront_shoes_oxford_male', 'spamrakuen_tbm_glasses_frames_01'],
        recolor={
            'short02': [(None, (0.09, 0.085, 0.08), 0.9, 0.9)],
            'elvs_male_shirt_tie_tucked1': [(('lum_below', 0.35), (0.70, 0.76, 0.82), 1.0, 0.5)],
            'mindfront_cardigan_long_open_front': [(None, (0.36, 0.30, 0.24), 1.0, 0.7)],
            'mindfront_male_trousers_2': [(None, (0.24, 0.24, 0.25), 1.0, 0.8)],
        },
        strip={'mindfront_cardigan_long_open_front': 'hem'}, extras=['nametag'],
        push={'mindfront_cardigan_long_open_front': 0.012},
        pose=dict(arm_out=6, elbow=18, slouch=3, neck=4, head_tilt=-2, head_turn=0, head_roll=6),
        aim='人当たりの良さそうな事務員。愛想笑いのまま鍵を開けて入ってくる不一致',
        risk='怖さが表情頼み。暗所・遠目では「普通の人」に寄りすぎる可能性',
    ),
    dict(
        id='04', name='04_keibiin', short='警備員風',
        age=67, build='小柄・猫背', outfit='制帽＋紺のベスト＋水色シャツ',
        phenotype=dict(gender=1.0, age=AGE(67), muscle=0.30, weight=0.35, height=0.34, proportions=0.35,
                       race=dict(asian=0.92, caucasian=0.03, african=0.05)),
        targets={'r-eye-bag-incr': 0.8, 'l-eye-bag-incr': 0.8, 'head-age-incr': 0.5, 'r-cheek-volume-decr': 0.4,
                 'l-cheek-volume-decr': 0.4, 'nose-scale-vert-incr': 0.3, 'head-triangular': 0.4,
                 'mouth-angles-down': 0.4},
        expr={'eye-left-opened-up': 0.30, 'eye-right-opened-up': 0.30, 'eyebrows-left-inner-up': 0.15,
              'eyebrows-right-inner-up': 0.15},
        skin='old_asian_male', skin_tint=(0.50, 0.88), skin_rough=0.42, eyes='brown',
        hair='short01', eyebrows='eyebrow002', eyelashes='eyelashes01',
        clothes=['elvs_male_shirt_untucked_bd1', 'mindfront_male_trousers_2',
                 'mindfront_shoes_oxford_male', 'mindfront_patrol_cap'],
        recolor={
            'short01': [(None, (0.55, 0.54, 0.52), 1.0, 0.8)],
            'eyebrow002': [(None, (0.55, 0.54, 0.52), 0.9, 0.8)],
            'elvs_male_shirt_untucked_bd1': [(None, (0.62, 0.68, 0.74), 1.0, 0.5)],
            'mindfront_male_trousers_2': [(None, (0.13, 0.14, 0.19), 1.0, 0.8)],
            'mindfront_patrol_cap': [(None, (0.11, 0.12, 0.18), 1.0, 0.25)],
        },
        strip={}, extras=['vest:elvs_male_shirt_untucked_bd1:0.035:0.045:0.085'],
        push={'mindfront_patrol_cap': 0.012},
        pose=dict(arm_out=10, elbow=22, slouch=16, neck=6, head_tilt=-26, head_turn=0, head_roll=0),
        aim='小さく丸まった老人が下から見上げてくる。帽子のつばで目元が影になる',
        risk='小柄なので追われる圧は弱い。帽子で顔が隠れ、覗き穴での「顔の発見」が弱まる',
    ),
    dict(
        id='05', name='05_young_kanrinin', short='若い管理人',
        age=33, build='長身・細身', outfit='白いワイシャツ＋黒ズボン',
        phenotype=dict(gender=1.0, age=AGE(33), muscle=0.50, weight=0.38, height=0.66, proportions=0.60,
                       race=dict(asian=0.93, caucasian=0.07, african=0.0)),
        targets={'head-rectangular': 0.4, 'r-cheek-bones-incr': 0.3, 'l-cheek-bones-incr': 0.3,
                 'neck-scale-vert-incr': 0.4, 'r-eye-bag-incr': 0.3, 'l-eye-bag-incr': 0.3},
        # 完全な無表情。瞬きしないような見開きをごくわずかに
        expr={'eye-left-opened-up': 0.25, 'eye-right-opened-up': 0.25},
        skin='young_asian_male', skin_tint=(0.55, 1.00), skin_rough=0.48, eyes='brown',
        hair='short04', eyebrows='eyebrow007', eyelashes='eyelashes01',
        clothes=['elvs_male_shirt_untucked_bd1', 'elvs_male_trouser', 'mindfront_shoes_oxford_male'],
        recolor={
            'short04': [(None, (0.06, 0.06, 0.06), 0.9, 0.9)],
            'elvs_male_shirt_untucked_bd1': [(None, (0.86, 0.86, 0.84), 1.0, 0.45)],
            'elvs_male_trouser': [(None, (0.07, 0.07, 0.075), 0.9, 0.8)],
        },
        strip={}, extras=[],
        pose=dict(arm_out=4, elbow=4, slouch=0, neck=0, head_tilt=0, head_turn=0, head_roll=0),
        aim='清潔で静か、背が高い。真っ直ぐ立って動かない「感情のなさ」が怖い',
        risk='白シャツは懐中電灯で最も明るく飛ぶ。管理人らしさ(制服感)は最も薄い',
    ),
    dict(
        id='06', name='06_moto_kanrinin', short='元の管理人',
        age=74, build='大柄・禿頭', outfit='色あせた灰緑の制服(上下)＋真鍮の徽章＋白シャツとネクタイ',
        phenotype=dict(gender=1.0, age=AGE(74), muscle=0.55, weight=0.80, height=0.64, proportions=0.35,
                       race=dict(asian=0.85, caucasian=0.10, african=0.05)),
        targets={'head-age-incr': 0.6, 'r-eye-bag-incr': 1.0, 'l-eye-bag-incr': 1.0,
                 'head-fat-incr': 0.3, 'stomach-pregnant-incr': 0.5, 'nose-scale-horiz-incr': 0.3,
                 'nose-volume-incr': 0.3, 'r-cheek-trans-down': 0.4, 'l-cheek-trans-down': 0.4,
                 'mouth-angles-down': 0.3},
        expr={'eye-left-slit': 0.20, 'eye-right-slit': 0.20,
              'eyebrows-left-down': 0.20, 'eyebrows-right-down': 0.20},
        skin='old_asian_male', skin_tint=(0.35, 0.90), skin_rough=0.30, eyes='brown',
        hair='', eyebrows='eyebrow011', eyelashes='eyelashes01',
        clothes=['mindfront_m_suit_01', 'mindfront_shoes_oxford_male'],
        recolor={
            'eyebrow011': [(None, (0.70, 0.69, 0.66), 0.9, 0.8)],
            # 黒いスーツ→色あせた灰緑の制服(白シャツとネクタイは暗部マスクで避ける)
            'mindfront_m_suit_01': [(('lum_below', 0.45), (0.25, 0.26, 0.22), 1.0, 0.65)],
        },
        strip={}, extras=['badge'], push={'mindfront_m_suit_01': 0.012},
        pose=dict(arm_out=9, elbow=16, slouch=10, neck=6, head_tilt=-2, head_turn=0, head_roll=-3),
        aim='辞めたはずの前の管理人。大きな体に古い制服、重い瞼。物語の「匂わせ」と相性が良い',
        risk='禿頭＋大柄は記号的に強く、他の5体と並ぶと「ボス感」が出すぎる',
    ),
]

# ---------------------------------------------------------------------------
# P1b: 確定像(DESIGN §3.4.1)。服は 02、顔は 04 の方向、大柄。質感向上は enemy_p1b.py(final=True で有効)。
#   MakeHuman の髪(板ポリ)と制帽は使わず、髪・眉・まつ毛はヘアカーブ、制帽は自作メッシュ。
#   eyebrows / eyelashes の MakeHuman メッシュは「毛を生やす位置の型紙」としてだけ使い、描画・書き出しはしない。
# ---------------------------------------------------------------------------
FINAL = dict(
    id='07', name='07_kanrinin_final', short='確定: 大柄の管理人', final=True,
    age=67, build='大柄・太めでがっしり', outfit='紺のつなぎ＋黄色い腕章「管理」＋黒の作業靴＋紺の制帽',
    phenotype=dict(gender=1.0, age=AGE(67), muscle=0.62, weight=0.80, height=0.637, proportions=0.38,
                   race=dict(asian=0.90, caucasian=0.05, african=0.05)),
    # 顔だけ痩せこけさせる(2026-10-31 差し戻し): こけた頬・張った頬骨・くぼんだ眼窩・こめかみのへこみ。体は大柄のまま
    targets={'r-eye-bag-incr': 0.8, 'l-eye-bag-incr': 0.8, 'head-age-incr': 0.9, 'head-round': 0.25,
             'head-fat-decr': 0.7, 'neck-scale-horiz-decr': 0.15, 'measure-neck-circ-decr': 0.4,
             'r-cheek-volume-decr': 1.0, 'l-cheek-volume-decr': 1.0, 'r-cheek-bones-incr': 0.6, 'l-cheek-bones-incr': 0.6,
             'r-cheek-inner-decr': 0.6, 'l-cheek-inner-decr': 0.6, 'forehead-temple-decr': 1.0,
             'r-eye-push1-in': 0.45, 'l-eye-push1-in': 0.45, 'r-eye-push2-in': 0.35, 'l-eye-push2-in': 0.35,
             'r-cheek-trans-down': 0.2, 'l-cheek-trans-down': 0.2, 'nose-scale-horiz-incr': 0.15,
             'nose-hump-incr': 0.3, 'mouth-angles-down': 0.55, 'stomach-pregnant-incr': 0.35,
             'mouth-upperlip-volume-decr': 0.5, 'mouth-lowerlip-volume-decr': 0.35, 'mouth-upperlip-height-decr': 0.2,
             'measure-shoulder-dist-incr': 0.4},
    expr={'eye-left-opened-up': 0.22, 'eye-right-opened-up': 0.22, 'eyebrows-left-inner-up': 0.12,
          'eyebrows-right-inner-up': 0.12},
    skin='old_asian_male', skin_tint=(0.42, 0.90), skin_rough=0.45, eyes='brown',
    hair='', eyebrows='eyebrow003', eyelashes='eyelashes01', teeth='teeth_base', tongue='tongue01',
    # 襲う時の「不気味な笑い」= シェイプキー grin(表情ユニットの合成)。口角を大きく上げて歯を見せ、目は見開く、片眉だけ上げる
    grin={'mouth-corner-puller': 1.0, 'mouth-upward-retraction': 0.55, 'mouth-parling': 0.55, 'mouth-retraction': 0.35,
          'eye-left-opened-up': 0.55, 'eye-right-opened-up': 0.45, 'eyebrows-left-up': 0.55, 'eyebrows-right-inner-up': 0.15},
    clothes=['elvs_male_coveralls_1', 'shoes03'],
    hammer=True,   # 右手にハンマー(全長 40cm)。書き出しは build/enemy/hammer.fbx / .glb の別ファイル
    recolor={
        'elvs_male_coveralls_1': [(None, (0.13, 0.16, 0.25), 1.0, 0.85, (0.4, 1.6, 0.17))],
    },
    strip={}, extras=['armband'],
    pose=dict(grip_r=True, arm_out=11, elbow=14, slouch=6, neck=4, head_tilt=7, head_turn=0, head_roll=0),
    aim='§3.4.1 の確定像。大柄な体、上目遣いの丸顔、紺つなぎに腕章と制帽',
    risk='',
)
CANDIDATES.append(FINAL)

BY_ID = {c['id']: c for c in CANDIDATES}
