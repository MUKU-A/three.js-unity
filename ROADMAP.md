# ROADMAP.md — Unityとのギャップ評価と実装計画

外部レビュー (2026-07) で指摘されたUnityとのギャップを評価し、対応状況と優先度を記録する。
判断基準は一貫して「Unityユーザーが違和感なくthree.jsを使えるか」(究極のゴール)。

## レビュー指摘の事実確認

指摘のうち以下は**事実誤認**だったため対応不要:
- 「Consoleウィンドウ・ProjectウィンドウのUIが見当たらない」→ `ConsolePanel.tsx` / `ProjectPanel.tsx`
  として実装済みで、フィルタ・Clear on Play・インポート・DnD配置までE2E検証済み。

## 対応済み (このリポジトリで実装済み)

| 指摘 | 対応 |
|---|---|
| 1. カスタムスクリプト (MonoBehaviour相当) | ✅ `ScriptComponent` + `engine/scripting.ts`。onStart/onUpdate、ctx (node/find/input/time/log)、`const props` のInspector自動露出 (D-025) |
| 1. イベント/入力 | ✅ ctx.input.getKey / getKeyDown (再生中のキーボード)。マウス/EventSystemは未対応 (下記) |
| 7. リフレクション的Inspector生成 | ✅ スクリプトprops宣言 → 型別フィールド自動生成、既存値保持マージ |
| 2. Rigidbody / Collider / 物理エンジン | ✅ Rapier (WASM遅延ロード)。dynamic/kinematic/静的、Box/Sphereコライダー、質量/反発/摩擦、緑ワイヤーフレームギズモ (D-026) |
| 3. Normal Map / Tiling / Offset | ✅ MaterialComponentに追加、マテリアル毎テクスチャ複製で共有汚染なし |
| (前回対応) Gameビュー/メニューバー/Unity操作系 | ✅ D-019〜D-024 |

## 未対応 — 優先度順の実装計画

### P1 (次のイテレーション候補)
- **Prefabシステム**: サブツリーをアセット化し、インスタンスへの変更同期・オーバーライドを管理。
  データモデル案: `assets` に `prefab` 型を追加し、ノードに `prefabId`+`overrides` を持たせる。
- **ゲーム内Raycast/衝突イベント**: ctx.raycast()、onCollisionEnter (Rapierのイベントキュー結線)。
- **URLベースのアセット管理**: base64内蔵JSON (D-011) はプロトタイプ用。Supabase Storage等の
  参照型へ移行し、`SerializedScene.assets[].url` を許可する (後方互換のまま拡張可能な構造は確保済み)。
- **マウス入力API**: ctx.input.getMouseButton / mousePosition (Gameビュー座標系)。

### P2 (価値は高いが規模が大きい)
- **AnimatorステートマシンとClip選択**: 現状はGLB全Clipを同時再生。最低限「再生Clipの選択」を
  mesh/animationコンポーネントに追加 → その後ステートマシン/ブレンド。
- **HDRI環境 (.hdr/.exrインポート → scene.environment)** とReflection相当。
- **ポストプロセス**: EffectComposer (Bloom/AO/Tonemap)。D-007のOutlinePass移行と同時に。
- **複数マテリアル (SubMesh)**: GLBは元マテリアルを保持済みだが、material コンポーネント適用時に
  全メッシュへ一括適用している。materials配列+インデックス割当への拡張。
- **ビルド出力**: エディタ抜きランタイム (scene JSON + 最小ローダーの単一HTML) を生成する
  「File > Build」。エンジン層がUI非依存なので分離可能な設計になっている。

### P3 (スコープ外を維持 / 需要が出たら)
- ゲーム内UI (Canvas/RectTransform)、Particle System、Timeline編集UI、
  Lightmapベイク/Light Probe、カメラスタッキング/RenderTexture/Culling Mask、
  Profiler、オーディオ/.obj/.fbxインポータ、シェーダーグラフ。

## 実装しない (意図的な差異)
- .metaファイル方式のアセット管理: ブラウザ完結の本エディタではID正規化JSONの方が適切。
- C#互換: スクリプトはJS (ブラウザネイティブ)。UnityのライフサイクルAPI名は踏襲する。
