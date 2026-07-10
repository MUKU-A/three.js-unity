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

- **Unityデフォルトレイアウト**: 左 Hierarchy / 中央 Scene / 右 Inspector / 下 Project + Console。
  dockviewによりタブ化・分割・ドラッグ再配置・リサイズ自由 (Unityのウィンドウドッキング相当)
- **Hierarchy**: 右クリック作成メニュー (Create Empty / 3D Object / Light / Camera)、
  ドラッグ&ドロップで親子変更・並べ替え、Ctrl/Shift複数選択、F2リネーム、目玉トグル、検索
- **Scene ビュー**: OrbitControls (左ドラッグ=オービット / 右=パン / ホイール=ズーム)、
  クリック選択 (レイキャスト)、TransformControls ギズモ (Unity軸色 X赤/Y緑/Z青)、
  1m/10mシェーダグリッド、手続きスカイ、ライト/カメラのアイコン&ヘルパー、カメラプレビュー
- **Inspector**: Transform (**ラベル横ドラッグで数値スクラブ** — Unityの手触りを再現)、
  Mesh Filter (プリミティブ切替/GLB参照)、Material (色/テクスチャ/Metallic/Roughness/Opacity/Emission)、
  Light (Directional/Point/Spot、影)、Camera (投影方式/FOV/クリップ面)、Add Component (検索付き)
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

設計判断の記録: **[DECISIONS.md](./DECISIONS.md)** / Unity UI調査: **[UNITY_UI_RESEARCH.md](./UNITY_UI_RESEARCH.md)**

## 拡張余地 (スコープ外として設計だけ確保)

- スクリプトコンポーネント (components配列にscript型を足すだけの構造)
- Supabase保存 (シリアライズ形式が正規化済み。assetsをStorage URL参照へ差し替え)
- マルチ編集Inspector、OutlinePassによる選択表示、Game/Sceneタブ分離、シーンギズモ(方位キューブ)

## 権利について

UnityのUIを**観察して得た寸法・配色傾向を独自実装**したものであり、Unityのスクリーンショット・
アイコン素材・ロゴは一切含みません。アイコンは [Lucide](https://lucide.dev) (ISC)、
フォントは [Inter](https://rsms.me/inter/) (SIL OFL) を使用しています。
