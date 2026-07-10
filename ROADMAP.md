# ROADMAP.md — Unityとのギャップ評価と実装計画

外部レビュー (2026-07) で指摘されたUnityとのギャップを評価し、対応状況と優先度を記録する。
判断基準は一貫して「Unityユーザーが違和感なくthree.jsを使えるか」(究極のゴール)。

## レビュー指摘の事実確認

外部レビューはコードを完読せずに書かれることがあるため、事実誤認を記録しておく
(いずれもE2Eテストで動作検証済みの機能):

**レビュー第1弾の誤認:**
- 「Consoleウィンドウ・ProjectウィンドウのUIが見当たらない」→ `ConsolePanel.tsx` / `ProjectPanel.tsx`
  として実装済みで、フィルタ・Clear on Play・インポート・DnD配置までE2E検証済み。

**レビュー第3弾の誤認 (指摘時点で既に実装済みだったもの):**
- 「完全なUndo/Redoが不足」→ 初回コミットから全編集がCommandパターン経由 (D-003/D-005)。
  追加/削除/複製/親子変更/プロパティ/ギズモドラッグ=1Undo/Prefab Applyまで検証済み。
- 「Play/Editの厳密な分離と状態復元が鍵」→ D-006で初期実装済み。スナップショット+完全復元は
  ランタイムInstantiate/Destroyを含めてE2E検証済み。
- 「コルーチンが不足」→ ctx.startCoroutine (generator + yield秒) 実装済み (D-028)。
- 「ライフサイクル不足 (FixedUpdate/LateUpdate/OnDestroy等)」→ 大半実装済み。
  残っていた Awake/OnEnable/OnDisable は今回追加し全順序を再現 (D-030)。
- 「コライダー枠・ライト範囲等のギズモ描画がない」→ コライダー緑ワイヤーフレーム、
  Point/Spotの範囲ヘルパー、カメラFrustum、選択ボックスすべて実装済み。
  (ユーザースクリプトからの OnDrawGizmos 相当APIは未実装 → P2)
- 「GUIDによる参照解決がない」→ アセットは生成IDで参照しており、名前変更でリンクは切れない。
  未実装なのは .meta 相当のインポート設定のみ。
- 「グリッドスナップがない」→ Ctrl押下スナップ (移動1/回転15°/スケール0.1) 実装済み。
  頂点スナップ(V)・整列ツールは未実装 → P2。
- 「スクリプト変数のリアルタイム監視ができない」→ props (シリアライズ対象フィールド相当) は
  SSoT管理のため再生中もInspectorでライブ表示・編集可能。ローカル変数の監視は対象外。

## 対応済み (このリポジトリで実装済み)

| 指摘 | 対応 |
|---|---|
| 1. カスタムスクリプト (MonoBehaviour相当) | ✅ `ScriptComponent` + `engine/scripting.ts`。ctx (node/find/input/time/log)、`const props` のInspector自動露出 (D-025) |
| 1. ライフサイクル全般 | ✅ onStart / onUpdate / **onFixedUpdate (固定50Hz) / onLateUpdate / onDestroy** (D-028) |
| 1. Instantiate / Destroy | ✅ ctx.instantiate(src, pos) / ctx.destroy(target)。物理ボディ・スクリプトも動的に追従、停止で完全復元 (D-028) |
| 1. 衝突イベント | ✅ onCollisionEnter/Exit・onTriggerEnter/Exit (RapierのEventQueue結線) (D-028) |
| 1. 物理Raycast | ✅ ctx.physics.raycast(origin, dir, maxDist) → {node, point, distance} (D-028) |
| 1. コルーチン | ✅ ctx.startCoroutine(function*(){ yield 秒 }) (D-028) |
| 1. イベント/入力 | ✅ ctx.input.getKey / getKeyDown (再生中のキーボード)。マウスは未対応 (下記) |
| 7. リフレクション的Inspector生成 | ✅ スクリプトprops宣言 → 型別フィールド自動生成、既存値保持マージ |
| 2. Rigidbody / Collider / 物理エンジン | ✅ Rapier (WASM遅延ロード)。dynamic/kinematic/静的、Box/Sphereコライダー、質量/反発/摩擦、緑ワイヤーフレームギズモ (D-026) |
| 4. トリガーコライダー | ✅ Collider.isTrigger (センサー化 + onTrigger系イベント) (D-028) |
| 3. アニメーションClip制御 | ✅ mesh.animationClip (All/None/Clip名のInspector選択) + ctx.animation.play(name, fade) のcrossfade切替 (D-028) |
| 3. 対応フォーマット | ✅ GLB/GLTF + **FBX / OBJ** (モデル)、PNG/JPG/WebP (テクスチャ)。オーディオは未対応 (下記) |
| 3. Normal Map / Tiling / Offset | ✅ MaterialComponentに追加、マテリアル毎テクスチャ複製で共有汚染なし |
| (前回対応) Gameビュー/メニューバー/Unity操作系 | ✅ D-019〜D-024 |
| **Prefabシステム v1** | ✅ 作成/インスタンス化/Apply(全インスタンス伝播・1Undo)/Revert(root transform維持)/Unpack、Hierarchy青表示、JSON永続化 (D-029)。差分オーバーライド・Nested/Variantは残 (P2) |
| ライフサイクル完全化 | ✅ onAwake → onEnable → onStart → (Update系) → onDisable → onDestroy の厳密順序 (D-030) |
| **マウス入力 + ScreenPointToRay** | ✅ ctx.input.getMouseButton/Down・mousePosition (Gameビュー左下原点px) + ctx.screenPointToRay → physics.raycast でクリック判定が完結 (D-031) |
| **GetComponent / SetParent / worldPosition** | ✅ ctx.node.getComponent(型 or スクリプト名) の live読み書きプロキシ、setParent (循環ガード付き)、worldPosition (D-031) |
| **オーディオ (AudioSource)** | ✅ .mp3/.wav/.oggインポート、AudioSource (volume/loop/playOnAwake/spatial/距離減衰)、GameカメラへのListener自動付帯、⏸連動suspend、ctx.playSound ワンショット (D-032)。Audio Mixerは対象外 |
| **物理ジョイント** | ✅ Fixed / Hinge / Spring (Rapier impulse joints)。Connected Body選択、None=ワールド係留、Anchor/Axis/バネ係数 (D-033)。振り子・同伴落下・係留をE2E実測 |

## 未対応 — 優先度順の実装計画

### P1 (次のイテレーション候補)
- **Prefab v2**: プロパティ単位の差分オーバーライド (現状は全体置換のv1)、Nested Prefab、Variant、
  差分のApply/Revert個別選択UI。
- **URLベースのアセット管理**: base64内蔵JSON (D-011) はプロトタイプ用。Supabase Storage等の
  参照型へ移行し、`SerializedScene.assets[].url` を許可する (後方互換のまま拡張可能な構造は確保済み)。

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
