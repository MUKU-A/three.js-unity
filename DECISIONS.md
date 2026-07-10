# DECISIONS.md — 設計判断の記録

すべての判断は「Unityユーザーが一切の学習コスト・違和感なくThree.jsを使えること」を基準に行う。

## D-001: ドッキングライブラリ = dockview
- 候補: dockview / rc-dock / flexlayout-react / golden-layout
- 採用: **dockview** (v7)
- 理由: TypeScriptネイティブで型が効く、活発にメンテされている、タブ化・分割・ドラッグ再配置・
  リサイズがUnityのウィンドウドッキングと同等、CSS変数でテーマを完全上書きできる。
  rc-dockはメンテ頻度が低く、golden-layoutはReact統合が古い。

## D-002: スタイリング = Tailwind CSS v4 + CSS変数テーマ
- Tailwind v4 の CSS-first 設定(@theme)で `UNITY_UI_RESEARCH.md` のパレットを
  `--color-unity-*` として定義。dockviewの `--dv-*` 変数も同じパレットで上書きし、
  「Unityに近い独自ダークテーマ」を単一ソースで管理する。

## D-003: アイコン = lucide-react、フォント = Inter (@fontsource/inter)
- 権利ガード遵守のため、Unity公式アイコンは使わずLucide(ISC)で等価置換。
- UnityエディタはInterを公式採用(2021.2+)しており、Inter自体はSIL OFLのため
  自前バンドルで完全再現できる。基本12px。

## D-004: SSoT = Zustandストアの正規化シーングラフ
- `nodes: Record<NodeId, SceneNode>` + `rootIds` の正規化構造(将来のSupabase保存を想定)。
- Three.jsの`Object3D`はストア購読で派生生成する一方向フロー。イミュータブル更新なので
  参照比較(prevNode !== nextNode)だけで差分反映でき、毎フレーム全走査は不要。
- three.js editorのSignal同期思想をZustand購読に置き換えた形。

## D-005: Undo/Redoは「適用済みプッシュ」対応のCommandパターン
- 全編集はCommand(execute/undo)経由。連続操作(ギズモドラッグ、数値スクラブ)は
  ドラッグ中transient更新→終了時に before/after を持つCommandを **既適用として** 履歴に積む
  (`push(cmd, {applied:true})`)。Unityと同じく「1ドラッグ=1 Undo」。

## D-006: 再生モード = スナップショット復元 + 履歴トランケート
- ▶で `structuredClone` によるシーン+選択のスナップショット、⏹で完全復元。
- 再生中の編集はUnity同様「許可するが停止時に破棄」。履歴は再生開始時点の長さまで巻き戻す。
- 再生中のランタイム挙動: GLBに含まれるAnimationClipをAnimationMixerで再生(⏸で停止)。
  スクリプトシステムは今回スコープ外(拡張余地: componentsにscript型を追加するだけの構造)。

## D-007: 選択表示 = BoxHelper(オレンジ #FF6600)
- Unityはオレンジのアウトライン。OutlinePass(ポストプロセス)は品質は高いが
  レンダリングパイプラインが重くなるため、three.js editor同様のBoxHelper方式を採用し
  色をUnityのオレンジに合わせる。将来OutlinePassへ差し替え可能なよう選択表示はEngine内に隔離。

## D-008: ギズモ = TransformControls + Unity軸色
- TransformControlsのマテリアル色を X=#DB3E1D / Y=#9AF348 / Z=#3A7AF8 (Handles既定値)に
  差し替え。W/E/Rで切替、Ctrl押下中スナップ(移動1・回転15°・スケール0.1)。

## D-009: カメラ操作 = OrbitControls (左=オービット/右=パン/ホイール=ズーム) + Alt互換
- Unityの右ドラッグフライスルーは初期スコープ外。クリック=選択とドラッグ=オービットは
  ドラッグ閾値(5px)で区別する。F=フォーカスはUnity同等に実装。

## D-010: マルチ選択時のInspector/ギズモはアクティブ(最後に選択)オブジェクト対象
- Unityはマルチ編集(共通値表示)だが、初期実装は複製/削除/親子変更のみマルチ対応とし、
  Inspector表示とギズモはアクティブオブジェクトに限定。拡張余地として記録。

## D-011: シーン保存 = 正規化JSON、アセットはbase64内蔵
- `{version, name, nodes, rootIds, assets[]}` 形式。GLB/テクスチャはbase64で内蔵し
  単一ファイルで完全往復可能にする。Ctrl+S=エクスポート(ダウンロード)。
  Supabase移行時は assets を Storage参照(URL)に差し替えるだけの構造。

## D-012: カラーピッカー = ネイティブ input[type=color]
- Unity風スウォッチ(下部アルファ帯)の見た目を再現しつつ、ピッカー本体はネイティブを使用。
  透明度はMaterialのopacityプロパティが担うため実用上の不足なし。カスタムピッカーは拡張余地。

## D-013: 再生中はGameビュー切替ではなくViewport継続 + UI点灯/ティント
- 本家はGameビューへ切替わるが、本実装はSceneビューがGame描画を兼ねる。
  ▶点灯とツールバーのティントで再生状態を明示(UNITY_UI_RESEARCH.md §2/§7)。
  Game/Sceneタブ分離は拡張余地。

## D-014: Hierarchy行の有効/無効 = 行hoverの目玉トグル + Inspectorチェックボックス
- SceneNode.visible がUnityのactiveSelfに相当。Three.js側は Object3D.visible に結線。

## D-015: グリッド = シェーダベース手続きグリッド (GridHelper不採用)
- GridHelperの±100mに及ぶ長大なGL_LINESは、ソフトウェアGL環境(SwiftShader等)で
  クリッピング欠けを起こし近景の線が消えることをE2Eで実測確認。
- クアッド+fwidthアンチエイリアスの手続きグリッド(1mマイナー/10mメジャー・距離フェード・
  カメラ追従)に置換。実GPUでもUnityのSceneビューグリッドに近い見た目になる。

## D-016: 空 = far平面張り付き + カメラ追従の小型スカイスフィア
- 半径固定の大型スフィアはノードカメラのfar設定次第でクリップされる(カメラプレビューが黒くなる)。
- 頂点シェーダで gl_Position.z = w*0.999999 に張り付け、位置をカメラ追従させることで
  どの far 設定でも背景として描画される。プレビュー描画時はプレビューカメラ位置へ一時移動。

## D-017: 作成時の名前一意化 (Unity互換)
- Unityは同名兄弟が存在する場合 "Cube (1)" と連番を付ける。作成・複製の両方で
  uniqueSiblingName() により同挙動を再現。

## D-019: メニューバー (File/Edit/GameObject/Component/Window/Help) を追加
- Unity最上段のメニュー体系を機能実装 (New/Open/Save Scene、動的ラベルのUndo/Redo、
  作成メニュー共有、コンポーネント追加、レイアウトリセット)。ホバーでのメニュー切替も再現。

## D-020: Gameビュー = 別レンダラー + 再生時の自動タブ切替 (D-013を置換)
- シーン階層で最初の有効カメラから描画する Game タブを Scene とタブ共有で追加。
  ▶ で Game へ、⏹ で Scene へ自動切替 (Unityの実挙動)。
- dockviewは非表示タブをアンマウントするため、描画ループはパネルのマウント状態と独立に
  エンジンが所有する (Sceneが隠れてもGameが回り続ける)。E2Eでフリーズ回帰を検出して修正済み。

## D-021: カメラ操作をUnity完全互換に変更 (D-009を置換)
- Alt+左=オービット / 中=パン / ホイール=ズーム / **右ドラッグ+WASDQE=フライスルー**
  (Shift=高速、フライ中ホイール=速度調整、pointer lock) / **左ドラッグ=矩形選択** (Ctrl/Shift=追加)。
- フライ中はW/E/R等のツールショートカットを抑止 (Unity同様)。
- 右ボタンpointerdownでは stopImmediatePropagation で TransformControls への伝播を止める
  (pointer lock 中の setPointerCapture が例外になるブラウザ仕様への対処)。

## D-022: 方位ギズモ (シーンオリエンテーション) は独自SVGオーバーレイ
- three公式の ViewHelper は右下固定描画のため不採用。カメラクォータニオンから6軸を投影する
  SVGオーバーレイを右上に置き、クリックで注視点・距離を維持したまま軸ビューへアニメーション。

## D-023: Shaded/Wireframe ドローモード
- SceneビューツールバーのShadedドロップダウンで切替。マテリアルの wireframe は
  userData.baseWireframe (コンポーネント値) と描画モードの OR で決定し、SSoT を汚さない。

## D-024: 細部のUnity互換 (2021.2+実機能の再現)
- 数値フィールドの数式入力 ("1+2*3" 等、四則演算のみ許可して評価)
- Light/Camera コンポーネントヘッダの enabled チェックボックス (light.visible / Gameカメラ選定に結線)
- Hierarchyの可視性トグルを左端ガターへ (Unity 2019.3+のScene Visibility配置)
- Ctrl+P = Play/Stop

## D-018: Unity公式ドキュメントはリポジトリに含めない (リンク索引のみ)
- 「公式ドキュメント全量をGitHubに追加」する案は不採用。理由:
  (1) Unity公式ドキュメントはUnity Technologiesの著作物でオープンライセンスではなく、
      **publicリポジトリへのコミットは再配布にあたり許諾範囲(個人のオフライン利用)を超える**。
  (2) 本プロジェクトの権利ガード(素材を複製せず観察して独自実装する)と正面から矛盾する。
  (3) 実務上も数百MB規模でGitHubの制限・クローン性能を大きく損なう。
- 代替として docs/UNITY_DOC_LINKS.md に公式ページへのリンク索引(記述は自前)を整備し、
  オフライン利用は公式配布zipを gitignore 済みの docs/unity-offline/ にローカル展開する運用とした。
