# Unity 公式ドキュメント リンク索引

> **なぜリンク集なのか**: Unity公式ドキュメントは Unity Technologies の著作物であり、
> オープンライセンスではないため、**このpublicリポジトリへ本文を複製・コミットすることはできない**
> (再配布にあたる)。本プロジェクトの権利ガード (DECISIONS.md / UNITY_UI_RESEARCH.md 冒頭) とも
> 同じ方針。ここでは開発時に参照する公式ページへのリンクと、当プロジェクトとの対応だけを
> 自分の言葉でまとめる。リンク先の内容の権利はすべて Unity Technologies に帰属する。

バージョン表記のないリンクは最新安定版にリダイレクトされる。特定バージョンは
`https://docs.unity3d.com/<version>/Documentation/Manual/...` の形式。

## エディタUI・操作 (本プロジェクトの再現対象)

| トピック | 公式ページ | 当プロジェクトでの対応 |
|---|---|---|
| エディタ全体像 | https://docs.unity3d.com/Manual/UsingTheEditor.html | 5パネルdockviewレイアウト |
| Hierarchy ウィンドウ | https://docs.unity3d.com/Manual/Hierarchy.html | `HierarchyPanel.tsx` |
| Inspector ウィンドウ | https://docs.unity3d.com/Manual/UsingTheInspector.html | `InspectorPanel.tsx` |
| Scene ビュー操作 | https://docs.unity3d.com/Manual/SceneViewNavigation.html | OrbitControls結線 (D-009) |
| 位置決め (ギズモ/スナップ) | https://docs.unity3d.com/Manual/PositioningGameObjects.html | TransformControls + Ctrlスナップ |
| Project ウィンドウ | https://docs.unity3d.com/Manual/ProjectView.html | `ProjectPanel.tsx` |
| Console ウィンドウ | https://docs.unity3d.com/Manual/Console.html | `ConsolePanel.tsx` |
| ショートカット (Shortcuts Manager) | https://docs.unity3d.com/Manual/ShortcutsManager.html | `useShortcuts.ts` |
| 再生モード | https://docs.unity3d.com/Manual/GameView.html | スナップショット復元 (D-006) |

## コンポーネント対応

| Unity | 公式ページ | 当プロジェクト |
|---|---|---|
| Transform | https://docs.unity3d.com/Manual/class-Transform.html | `TransformSection` (オイラー度数, YXZ順) |
| Mesh Filter / Renderer | https://docs.unity3d.com/Manual/class-MeshFilter.html | `MeshComponent` |
| Material (Standard Shader) | https://docs.unity3d.com/Manual/StandardShaderMaterialParameters.html | `MeshStandardMaterial` 結線 |
| Light | https://docs.unity3d.com/Manual/class-Light.html | `LightComponent` (Directional/Point/Spot) |
| Camera | https://docs.unity3d.com/Manual/class-Camera.html | `CameraComponent` + プレビュー |

## エディタデザイン仕様 (フェーズ0リサーチの出典)

- USS 組み込み変数 (エディタ全色): https://docs.unity3d.com/Manual/UIE-USS-UnityVariables.html
- エディタデザインシステム (Foundations): https://www.foundations.unity.com/
- Handles 軸色 (ギズモ): https://docs.unity3d.com/ScriptReference/Handles-xAxisColor.html
- 調査済みの具体値は [../UNITY_UI_RESEARCH.md](../UNITY_UI_RESEARCH.md) に記録済み (独自にまとめた観察値)

## オフラインでドキュメントを使いたい場合 (ローカル専用・コミット禁止)

Unityは個人利用向けに**公式のオフラインドキュメント**(zip)を配布している:

1. https://docs.unity3d.com/Manual/OfflineDocumentation.html の手順で対象バージョンのzipを入手
2. このリポジトリでは `docs/unity-offline/` に展開する (この場所は `.gitignore` 済み)
3. **絶対にコミット・プッシュしないこと** — publicリポジトリでの再配布はUnityの規約違反になる

AIエージェントにドキュメントを参照させたい場合も、上記のローカル展開先を読ませる運用とし、
リポジトリへは入れないこと。
