# E2E 検証スクリプト

開発サーバー (`npm run dev`) を起動した状態で実行する。ブラウザは Playwright 用 Chromium
(`CHROMIUM_PATH` 環境変数、既定 `/opt/pw-browsers/chromium`) を使用。

```bash
node e2e/make-glb.mjs   # テスト用GLB/PNGを e2e/out/ に生成 (verify3の前に1回)
node e2e/verify1.mjs    # 起動・5パネル・初期ノード・コンソールエラー
node e2e/verify2.mjs    # 作成/選択/スクラブ/W-E-R/複製/削除/Undo-Redo/再生復元/F/JSON往復
node e2e/verify3.mjs    # GLB/テクスチャ取込・DnD配置・AddComponent・Hierarchy DnD・リネーム・可視トグル
node e2e/verify4.mjs    # 複数選択/検索/Consoleフィルタ/再生ティント/Pause/Ctrlスナップ
node e2e/verify5.mjs    # ギズモ実マウスドラッグ→Inspector同期→1-Undo
```

スクリーンショットは `e2e/out/` に出力される。
