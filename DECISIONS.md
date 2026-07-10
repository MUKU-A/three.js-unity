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

## D-025: スクリプトシステム = onStart/onUpdate + props宣言のリフレクションUI
- MonoBehaviour相当。`new Function` でコンパイルし、ctx (node proxy/find/input/time/log) を注入。
- **Transformへの書込はストアtransient経由** — SSoT一方向フローを維持し、再生中も
  Inspectorがライブ更新され、停止時はスナップショット復元で自然に巻き戻る。
- `const props = {...}` をInspectorへ自動露出。保存時は「既存キーの編集値保持・新キーは
  デフォルト・消えたキーは破棄」でマージ (Unityのシリアライズ値保持と同挙動)。
- 実行時エラーは1回でそのスクリプトを無効化しConsoleへ (スパム防止)。

## D-026: 物理 = Rapier (rapier3d-compat, WASM遅延ロード)
- 候補: cannon-es / ammo.js / Rapier → 型・性能・メンテ状況でRapierを採用。
  compatビルドはWASMをbase64内蔵するためオフライン/CSP環境でも動く。初回▶で遅延init。
- Unity互換の意味論: Rigidbodyなしコライダー=静的、isKinematic、Use Gravity、質量/反発/摩擦。
- 書き戻しはワールド→ローカル変換してストアtransientへ (D-025と同じくSSoT維持)。
- コライダーは選択中に緑ワイヤーフレーム表示 (Unityの見た目)。

## D-027: マテリアルのマップ拡張はテクスチャ複製で行う
- Normal Map / Tiling / Offset を追加。レジストリのテクスチャは共有物のため、
  アセットID変更時にマテリアル専用cloneを割り当ててから repeat/offset を設定する
  (Unityの「マテリアル毎のTiling」と同じ独立性)。法線マップはNoColorSpace。

## D-028: ゲームロジックAPI (レビュー第2弾対応)
- **ライフサイクル**: onFixedUpdate は固定50Hzアキュムレータ (スパイラル防止0.2sクランプ) で
  物理ステップと同périodで呼ぶ。Update → [FixedUpdate → 物理+イベント]×n → LateUpdate のUnity順。
- **Instantiate/Destroy**: cloneSubtree + transientAdd/RemoveSubtree (履歴に載せない)。
  動的生成物には物理ボディ追加とスクリプト起動 (onStart) を即時実施。停止時は
  スナップショット復元で自然に消滅/復活するため後始末が不要 (D-006の設計が効く)。
- **衝突イベント**: RapierのEventQueueをdrainし、collider handle→nodeId対応表で
  onCollision/onTrigger(Enter|Exit) を両ノードのスクリプトへ配送。isTriggerはセンサー化。
- **コルーチン**: generatorベース。yield 秒数 で待機、Update後に進行 (Unity同順)。
- **アニメ制御**: mesh.animationClip (undefined=全/null=なし/名前) + crossfade API。
  Animatorステートマシンは未実装 (ROADMAP P2) だが、スクリプトからの切替で大半のユースを充足。
- **FBX/OBJ**: three公式ローダーを遅延importし、GLBと同じ ModelAsset 形に正規化して取り込む。

## D-029: Prefabシステム v1 = アセット化テンプレート + 全体置換のApply/Revert
- prefabはアセット (JSONバイナリ) としてレジストリに保存し、既存のbase64内蔵シリアライズに
  自動的に乗る (追加の保存機構ゼロ)。ノードはルートに prefabId を持ちHierarchyで青表示 (Unity互換)。
- **Apply**: インスタンスの内容をアセットへ書き戻し、他インスタンスを一括再構築。
  root の transform/name/visible はインスタンス毎の値として維持 (Unityの意味論)。
  シーン側の伝播は cmdReplaceGraph (グラフ全置換コマンド) で **1 Undo**。
  アセット更新自体はUnity同様Undo対象外。
- **Revert**: インスタンスをテンプレートから再構築 (root transform等は維持)。**Unpack**: リンク解除。
- v1の割り切り: プロパティ単位の差分オーバーライド管理はせず全体置換。
  再構築でノードIDが変わる (選択はcmdReplaceGraphがフィルタ)。Nested/Variant は P2。

## D-030: スクリプトライフサイクルの完全順序
- onAwake → onEnable → onStart を「全インスタンスごとにフェーズ順」で実行 (Unityの
  全Awake→全Start保証を再現)。破棄/停止時は onDisable → onDestroy。
- 再生中の enabled/visible トグルによる OnEnable/OnDisable 発火は未対応 (制限として明記)。

## D-031: スクリプトAPIの空間/入力/コンポーネント補完 (レビュー第4弾対応)
- **マウス入力**: Gameビューcanvasで収集し、mousePositionは左下原点px (Unity互換)。
  getMouseButtonDownはフレーム毎クリア。編集モード中は収集しない。
- **screenPointToRay**: ゲームカメラ基準のRaycaster.setFromCamera。physics.raycastへ
  そのまま渡せる形 ({origin, direction}) で返し、ScreenPointToRay+Physics.Raycastの
  Unity頻出イディオムを2行で再現できる。
- **getComponent**: JS Proxyで実装し、読みは常にSSoTの現在値・書きはtransientPatchComponent。
  型名に加えスクリプト名でも検索可 (GetComponent<MyScript>()相当)。
  制限: rigidbody/colliderの物理パラメータ変更は再生中のワールドへは反映されない
  (ボディは▶時に構築されるため。ROADMAPに記載)。
- **setParent**: transientReparent (履歴外・停止で復元)。自己の子孫への付け替えはガード。
- **worldPosition**: エンジンのObject3Dから読む読み取り専用値。

## D-032: オーディオ = AudioSourceコンポーネント + Gameカメラ自動Listener
- AudioListenerは専用コンポーネントにせず、▶時にアクティブなGameカメラへ自動付帯
  (Unityの新規シーンでMain CameraにListenerが付いているデフォルト構成の再現)。
- spatial=true は THREE.PositionalAudio (ノード追従・linear減衰 minDistance/maxDistance)、
  false は 2D。デコードはアセットID毎にキャッシュし、▶クリック(ユーザージェスチャ)で
  AudioContextをresume。⏸でsuspend/再開、⏹で全停止・破棄。
- 再生中の volume/loop 変更はSSoT購読からlive反映 (getComponentプロキシ経由の変更も効く)。
- ctx.playSound(名前|ID, volume) は自ノード位置からの3Dワンショット (PlayOneShot相当)。
- Audio Mixer / エフェクトルーティングはスコープ外 (ROADMAP)。

## D-033: 物理ジョイント = Rapier impulse joints (Fixed/Hinge/Spring)
- JointComponent はジョイントを持つ側のノードに付け、Connected Body でもう一方を選ぶ
  (候補は rigidbody/collider を持つノード)。None はワールド係留 —
  自身アンカーの現在ワールド位置に固定ボディを生成して接続 (Unityの Connected Body: None 互換)。
- Hinge は revolute (Axis正規化)、Spring は restLength/stiffness/damping。
  アンカーはコライダー同様ワールドスケールを乗算。
- ボディ全生成後の第2パスで張る。ボディ除去時のジョイント破棄は Rapier 側が保証。
- 拘束の実測E2E: 振り子がアンカーから2.00m を維持して振れる / Fixedペアが Δy=2.00 を
  保ったまま落下 / Spring がワールド係留で自由落下しない。

## D-034: Prefab v2 = prefabNodeId対応付け + 3方向マージの差分オーバーライド
- 各インスタンスノードに prefabNodeId (テンプレート内ID) を持たせ、ノード対応を安定化。
  Apply時のテンプレートIDはこの値を再利用するため、複数回のApplyをまたいで対応が保たれる。
- **3方向マージ** (oldTemplate/newTemplate/instance): インスタンス値が旧テンプレと同じなら追従、
  異なれば (=オーバーライド) 保持。粒度は transform/name/visible がグループ単位、
  **componentsは同型ならプロパティ(キー)単位** — 色だけ変えたインスタンスは色を保持したまま
  roughness等の他プロパティはテンプレート更新へ追従する (Unityの意味論)。
- ノード構造: テンプレ追加ノードは挿入 (tid付与)、テンプレ削除ノードはインスタンスからも削除、
  ユーザー追加ノードは保持、ユーザーが消したテンプレノードは復活させない。
- Apply: 対象インスタンスからテンプレートを再構築 (ユーザー追加ノードはプレハブ入り) →
  他インスタンスへマージ。シーン側は cmdReplaceGraph で1 Undo。マージでインスタンスの
  既存ノードIDは変えない (選択・参照が壊れない)。
- Revert: rootのid/transform/name/visible/兄弟位置を維持して全オーバーライド破棄
  (ユーザー追加ノードも除去 = UnityのRevert All)。
- Nested: テンプレートは子ノードの prefabId を保持するため、内側インスタンスのリンクが
  外側プレハブを通じて生きる (Variantは未対応 → ROADMAP)。
- InspectorのPrefabバー: アセット名 + Overrides(n) (オンデマンドdiff計算) + Apply/Revert。

## D-018: Unity公式ドキュメントはリポジトリに含めない (リンク索引のみ)
- 「公式ドキュメント全量をGitHubに追加」する案は不採用。理由:
  (1) Unity公式ドキュメントはUnity Technologiesの著作物でオープンライセンスではなく、
      **publicリポジトリへのコミットは再配布にあたり許諾範囲(個人のオフライン利用)を超える**。
  (2) 本プロジェクトの権利ガード(素材を複製せず観察して独自実装する)と正面から矛盾する。
  (3) 実務上も数百MB規模でGitHubの制限・クローン性能を大きく損なう。
- 代替として docs/UNITY_DOC_LINKS.md に公式ページへのリンク索引(記述は自前)を整備し、
  オフライン利用は公式配布zipを gitignore 済みの docs/unity-offline/ にローカル展開する運用とした。
