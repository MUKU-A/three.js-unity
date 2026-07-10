# UnityThree Editor — Unity風 Three.js エディタ (Web完結)

**UnityのエディタUI・操作体系をそのままに、裏側ではThree.jsがシーンを描画・実行するWebエディタ。**
Unityユーザーが学習コストゼロで Three.js のシーンを構築できることを目指しています。

## 起動

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # 本番ビルド (tsc + vite)
```

## 何ができるか

- **メニューバー**: File (New/Open/Save/Import) / Edit (動的Undo・Redo/複製/再生) /
  GameObject / Component / Window (Reset Layout) / Help
- **Unityデフォルトレイアウト**: 左 Hierarchy / 中央 Scene+**Game** (タブ) / 右 Inspector / 下 Project + Console。
  dockviewによりタブ化・分割・ドラッグ再配置・リサイズ自由 (Unityのウィンドウドッキング相当)
- **Game ビュー**: シーン内の最初の有効カメラから描画。**▶ 再生で自動的に Game タブへ切替、⏹ で Scene へ戻る**
- **Hierarchy**: 右クリック作成メニュー (Create Empty / 3D Object / Light / Camera)、
  ドラッグ&ドロップで親子変更・並べ替え、Ctrl/Shift複数選択、F2リネーム、左ガター可視性トグル、検索
- **Scene ビュー (Unity完全互換操作)**: **Alt+左=オービット / 中=パン / ホイール=ズーム /
  右ドラッグ+WASDQE=フライスルー (Shift=高速・ホイール=速度) / 左ドラッグ=矩形選択 / クリック=選択**、
  TransformControls ギズモ (Unity軸色 X赤/Y緑/Z青)、右上の方位ギズモ (クリックで軸ビューへ整列)、
  Shaded/Wireframe ドローモード、1m/10mシェーダグリッド、手続きスカイ、
  ライト/カメラのアイコン&ヘルパー、カメラプレビュー
- **Inspector**: Transform (**ラベル横ドラッグで数値スクラブ** — Unityの手触りを再現、
  **"1+2*3" のような数式入力**にも対応)、Mesh Filter (プリミティブ切替/GLB参照)、
  Material (色 / Base Map / **Normal Map / Tiling / Offset** / Metallic/Roughness/Opacity/Emission)、
  Light / Camera (**ヘッダのenabledチェックボックス**付き)、Add Component (検索付き)
- **スクリプト (MonoBehaviour相当)**: `onStart(ctx)` / `onUpdate(ctx, dt)` をJSで記述。
  `const props = {...}` の宣言が **Inspectorに自動でフィールド化**され、値は保存される。
  ctx API: `node.position/rotation/scale`、`find(name)`、`input.getKey/getKeyDown`、`time`、`log`。
  内蔵スクリプトエディタ (コンポーネントの「Open Script Editor」) 付き
- **物理演算 (Rapier)**: Rigidbody (質量/重力/キネマティック/減衰) と Box/Sphere Collider
  (反発/摩擦/センター/サイズ、選択中は緑ワイヤーフレーム表示)。▶ 再生で落下・衝突し、
  ⏹ 停止で完全復元。Rigidbodyなしのコライダーは静的衝突体 (Unity互換)
- **Project**: GLB / テクスチャのインポート (ボタン or ファイルドロップ)、
  **タイルをSceneビューへドラッグして配置**、テクスチャはオブジェクトへドロップで割当
- **Console**: info/warn/error フィルタ、Clear、Clear on Play
- **再生モード**: ▶ でスナップショット、再生中の編集は Unity 同様に ⏹ 停止時に完全復元。
  GLBのAnimationClipは再生中に AnimationMixer で再生される
- **Undo/Redo**: 全編集操作が Command 経由。ギズモ/スクラブは 1ドラッグ=1Undo
- **保存/読込**: シーンをJSONへエクスポート/インポート (アセットはbase64内蔵で単一ファイル往復)

## ショートカット (Unity互換)

| キー | 動作 | キー | 動作 |
|---|---|---|---|
| W / E / R | Move / Rotate / Scale | Ctrl+D | 複製 |
| F | 選択にフォーカス | Delete | 削除 |
| Ctrl+Z / Ctrl+Y | Undo / Redo | F2 | リネーム |
| Ctrl+S | シーン保存(JSON) | Ctrl+C / V | コピー / ペースト |
| Ctrl+P | 再生 / 停止 | 右ドラッグ+WASDQE | フライスルー |
| Ctrl(ドラッグ中) | スナップ (移動1 / 回転15° / スケール0.1) | | |

## アーキテクチャ

```
UI操作 ──▶ Command ──▶ Zustandストア (正規化シーングラフ = SSoT)
                            │ subscribe (参照比較の差分反映)
                            ▼
                      ThreeEngine ──▶ Object3D ツリー / TransformControls / ヘルパー
                            │ ギズモ操作・レイキャスト選択
                            └──▶ transient更新 → ドラッグ終了時に Command 化 (一方向フロー維持)
```

- `src/types/scene.ts` — シーングラフのデータモデル (nodes: Record<id, node> + rootIds)
- `src/store/` — Zustandストア、Commandファクトリ、純関数シーン操作、高レベルアクション
- `src/engine/` — SSoT→Three.js 一方向同期エンジン、アセットレジストリ、シリアライズ
- `src/components/` — dockviewレイアウト、5パネル、Inspectorフィールド (スクラブ実装は `inspector/fields.tsx`)

設計判断の記録: **[DECISIONS.md](./DECISIONS.md)** / Unity UI調査: **[UNITY_UI_RESEARCH.md](./UNITY_UI_RESEARCH.md)** /
Unity公式ドキュメント索引: **[docs/UNITY_DOC_LINKS.md](./docs/UNITY_DOC_LINKS.md)** (本文の複製はpublicリポジトリでは権利上不可のためリンク集。D-018参照)

## 拡張余地

Unityとのギャップ評価と優先度付き実装計画は **[ROADMAP.md](./ROADMAP.md)** を参照
(Prefab、衝突イベント/Raycast API、URL参照アセット、Animatorステートマシン、ポストプロセス、ビルド出力ほか)。

## 権利について

UnityのUIを**観察して得た寸法・配色傾向を独自実装**したものであり、Unityのスクリーンショット・
アイコン素材・ロゴは一切含みません。アイコンは [Lucide](https://lucide.dev) (ISC)、
フォントは [Inter](https://rsms.me/inter/) (SIL OFL) を使用しています。
