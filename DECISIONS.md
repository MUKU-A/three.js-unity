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
