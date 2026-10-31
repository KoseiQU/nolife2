# 素材の出典とライセンス（必ず追記すること）
| ファイル | 出典URL | ライセンス | 取得日 |
|---|---|---|---|
| assets/textures/wall_cloth/{albedo,normal,roughness}.jpg（ambientCG Wallpaper001A, 2K-JPG） | https://ambientcg.com/view?id=Wallpaper001A （取得: https://ambientcg.com/get?file=Wallpaper001A_2K-JPG.zip） | CC0 1.0 | 2026-10-31 |
| assets/textures/ceiling_tile/{albedo,normal,roughness,ao}.jpg（ambientCG OfficeCeiling001, 2K-JPG） | https://ambientcg.com/view?id=OfficeCeiling001 （取得: https://ambientcg.com/get?file=OfficeCeiling001_2K-JPG.zip） | CC0 1.0 | 2026-10-31 |
| assets/textures/door_wood/{albedo,normal,roughness,ao}.jpg（Poly Haven teak_veneer, 2k jpg。作者 Jenelle van Heerden） | https://polyhaven.com/a/teak_veneer （API: https://api.polyhaven.com/files/teak_veneer） | CC0 1.0 | 2026-10-31 |
| build/tex_exit_sign.png（避難口誘導灯の面。build_scene.py が numpy で描く自作図形） | 自作（tools/blender/build_scene.py `make_exit_sign_image`） | 自作（CC0扱い） | 2026-10-31 |
| vendor/three/（three.js r187 = npm three@0.187.0 の build/ と examples/jsm/） | https://www.npmjs.com/package/three （`npm pack three@0.187.0`） | MIT（vendor/three/LICENSE） | 2026-10-31 |
| build/tex_wire_glass.png・tex_ev_display.png・tex_ev_plate.png・tex_car_stone.png・tex_exit_sign_sq.png（P0b: 網入りガラス・EV階数表示「4」・呼びボタン板・カゴ石目・非常口サイン） | 自作（tools/blender/n2tex.py が numpy で描く） | 自作（CC0扱い） | 2026-10-31 |
| build/tex_floor_{albedo,normal,roughness}.png（廊下・EVホールの淡いグレーのまだら長尺シート。P0bでテラゾー床を置換） | 自作（tools/blender/n2tex.py `floor_sheet`） | 自作（CC0扱い） | 2026-10-31 |
