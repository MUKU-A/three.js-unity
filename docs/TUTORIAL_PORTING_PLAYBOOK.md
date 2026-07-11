# チュートリアル移植ワークフロー指示書
## — Web上のUnity解説を UnityThree Editor で実走検証し、不具合を直しながら完走させる —

**対象読者: このリポジトリで作業するAIエージェント (Claude Opus 等、どのモデルでも)。**
この1ファイルだけを渡されて「この指示書に従って次のチュートリアルをやってください」と
依頼される前提で書かれている。過去2回の実績 (Roll-a-Ball = D-035 / Cubethon = D-036) と
同じ品質を、会話の記憶なしで再現することがゴール。

> この指示書は Claude Fable 5 が実際に2本完走した際の全判断を明文化したもの。
> 「Fableなら暗黙にやること」も省略せず書いてあるので、**書いてある通りに愚直に実行すれば良い**。
> 逆に、書いていない大胆なショートカット (工程の省略・まとめ実行) は品質を落とすのでしないこと。

---

## 0. 最初に必ずやること (着手前チェックリスト)

1. **この指示書を最後まで読む** (§11 の落とし穴一覧まで)。読んでから着手する。
2. 以下を読んで現状を把握する (合計10分):
   - `README.md` — エディタの全機能と操作
   - `ROADMAP.md` — 「対応済み」表 = 使える機能の一覧 / 「未対応」= 実装しないと使えない機能
   - `DECISIONS.md` の **D-035 と D-036** — 過去2回のチュートリアル移植で何を実装したか
   - `docs/TUTORIAL_ROLL_A_BALL.md` と `docs/TUTORIAL_CUBETHON.md` — 完成品の見本
   - `e2e/README.md` と `e2e/cubethon.mjs` — E2Eの書き方の見本 (**新規に書き起こさず、これを雛形にする**)
3. TaskCreate で本指示書の §3 のフェーズをそのままタスク化し、進行に合わせて TaskUpdate する。
4. 判断に迷ったら常にこの基準に戻る: **「Unityユーザーが一切の学習コスト・違和感なく使えるか」**。

### モデル間差異への配慮 (この指示書の読み方)

- **推測でAPIを呼ばない。** 関数シグネチャは呼ぶ直前に毎回 grep で確認する (§6 に必須grep一覧)。
  過去の実績でも、シグネチャの思い込み (`cmdReparent` に配列を渡した) が唯一の手戻り原因だった。
- **一度に1つ。** 「機能を1つ実装 → `npx tsc --noEmit` → 関連E2E」を繰り返す。
  複数機能をまとめて実装してからまとめてテストすると、原因切り分けが不可能になる。
- **FAILが出たら §8 の決定木を上から順に適用する。** 順番を飛ばしてエンジンを疑わない
  (過去2回の全FAILのうち、エンジン起因は1件のみ。残りは全てテスト側の問題だった)。
- **スクリーンショットは全数 Read ツールで開いて目視確認する。** 「撮れたはず」で済ませない。
- **コンテキスト要約が入っても続行できるよう**、節目ごとにタスク更新+コミットで進捗を刻む。

---

## 1. このプロジェクトの構造 (最低限)

```
UI操作 → Command → Zustandストア (正規化シーングラフ = SSoT) → subscribe → ThreeEngine → Object3D
```

| パス | 役割 |
|---|---|
| `src/types/scene.ts` | データモデル (SceneNode / 各Component型 / default〇〇() ファクトリ / DEFAULT_SCRIPT_CODE) |
| `src/store/editorStore.ts` | ストア本体、`execute`/`pushApplied`/undo、`cmd〇〇` Commandファクトリ、`make〇〇Node` |
| `src/store/actions.ts` | 高レベル操作 (create系/duplicate/prefab系/createUIText)。UIメニューが呼ぶのはここ |
| `src/store/sceneOps.ts` | 純関数のグラフ操作 (addSubtree/reparent/cloneSubtree/uniqueSiblingName) |
| `src/engine/ThreeEngine.ts` | SSoT→three.js同期、再生ループ、GameInput、EngineBridge (スクリプトへの機能提供) |
| `src/engine/scripting.ts` | スクリプトランタイム (コンパイル/ライフサイクル/ctx API/NodeProxy/ComponentProxy) |
| `src/engine/physics.ts` | Rapier結線 (ボディ/コライダー/ジョイント/イベント/raycast/CCD) |
| `src/components/panels/` | Hierarchy/Inspector/Viewport/Game/Project/Console の各パネル |
| `src/components/inspector/` | Inspectorのセクション実装 (sections.tsx / scriptPhysicsSections.tsx / fields.tsx) |
| `e2e/` | 検証スクリプト群 (playwright-core直叩き)。`e2e/out/` に成果物 |
| `docs/TUTORIAL_*.md` | ユーザー向けチュートリアル対応ガイド (成果物) |

- 起動: `npm run dev` (http://localhost:5173) / 検証: `npx tsc --noEmit` と `npm run build` の**両方**
- デバッグ用フック: ブラウザ内で `window.__store` (Zustand) と `window.__engine` (ThreeEngine)。
  TypeScriptのprivateは実行時には見えるので、テストから `window.__engine.physicsWorld.getLinearVelocity(id)` 等も呼べる (テスト専用の裏口。製品コードでは使わない)

### スクリプトAPI早見 (D-036時点で使えるもの)

フック: `onAwake/onEnable/onStart/onUpdate(ctx,dt)/onFixedUpdate(固定50Hz)/onLateUpdate/onDisable/onDestroy/onCollisionEnter・Exit(ctx,other)/onTriggerEnter・Exit(ctx,other)`

ctx: `node.position|rotation|scale(.set可)/visible/tag/compareTag/setActive(bool)/activeSelf/worldPosition/setParent`、
`node.getComponent(型名orスクリプト名)` (live読み書き。rigidbodyは `.addForce({x,y,z})`/`.velocity`。
**scriptはトップレベル関数がメソッドとして呼べる**)、`find(名前)`、`findObjectOfType(スクリプト名)`、
`instantiate(名前orProxy, pos)`、`destroy(target?)`、`invoke(関数名orfn, 秒)`、`restartScene()`、
`physics.raycast(origin,dir,maxDist)`、`screenPointToRay(x,y)`、`startCoroutine(function*(){yield 秒})`、
`animation.play(clip,fade)`、`playSound(名前)`、`input.getKey/getKeyDown/getAxis('Horizontal'|'Vertical')/getMouseButton(Down)/mousePosition`、
`time.elapsed|delta`、`log(msg)`、`props` (Inspector編集値)

コンポーネント: mesh(enabled=MeshRenderer.enabled) / material / light / camera / script(enabled即時反映) /
rigidbody(collisionDetection: 'continuous'=CCD) / collider(box|sphere, isTrigger) / audiosource /
joint(fixed|hinge|spring) / uitext(スクリーンスペーステキスト)

---

## 2. 不変の制約 (違反禁止)

1. **権利ガード**: Unityのスクリーンショット・公式アイコン・ロゴ・ドキュメント本文をリポジトリに入れない。
   チュートリアル本文の丸写しも不可 — 手順は自分の言葉の対応表にする。原典C#コードの引用は
   出典URL明記のうえ**E2E内の逐語JS訳**と**ガイド内の変換済みコード**として扱う (これは過去2回の運用)。
2. スクリプトは **JS のみ** (C#は書かない)。Unityのライフサイクル名・API名の意味論は踏襲する。
3. コミットメッセージ等の成果物に**モデルIDを書かない**。gitのトレーラ (Co-Authored-By等) は
   実行中セッションの環境指示に従う。**PRは作らない** (指示があるまで)。ブランチも環境指示のものを使う。
4. エンジンを修正するときは必ず「Unityの実挙動がこうだから」という根拠を添えて `DECISIONS.md` に記録する。
   **テストを通すためだけのエンジン改変は禁止。**

---

## 3. ワークフロー全体図

| フェーズ | 内容 | 完了条件 |
|---|---|---|
| 0 | チュートリアル選定 | 選定理由と正典URLをユーザーに提示できる |
| 1 | 本文・原典コードの取得と裏取り | 数値・コードが取得物で裏付けられている |
| 2 | ギャップ分析 → 不足機能の実装 | tsc/buildが通り、D-記録を書いた |
| 3 | E2Eスクリプト作成 (章立て通り+スクショ) | チェック項目とスクショ計画が揃った |
| 4 | 実行→修正ループ | 全チェックOK・page errors none・スクショ全数目視OK |
| 5 | リグレッション + ドキュメント | 既存E2E緑 / TUTORIAL_*.md / DECISIONS / README / ROADMAP |
| 6 | コミット・プッシュ・報告 | URL+修正一覧+検証結果+スクショを報告 |

---

## 4. フェーズ0: チュートリアル選定

**選定基準 (全て満たすこと):**
- [ ] 「ゲームを1本作る」入門チュートリアルである (単発Tipsではない)
- [ ] 定番・著名で、ユーザーがブラウザで開ける正典URLがある (公式Learn / 著名シリーズ等)
- [ ] **3D** で、プリミティブ+標準コンポーネント中心 (アセットパック依存・2D専用(Rigidbody2D等)・
      Terrain/NavMesh/Animator Controller/Particle 必須のものは避ける)
- [ ] 要求機能の大半が §1 のAPI早見に載っている (不足が0である必要はない —
      不足3〜6個を実装するのがこの作業の価値。ただし10個超えなら別候補を選ぶ)
- [ ] 本文または原典コードが**入手可能** (§5 のネットワーク制約参照)

**済み (再選定しない):** Unity Learn Roll-a-Ball / Brackeys How to Make a Video Game (Cubethon)

**次の候補メモ (参考。自分で再評価すること):**
- Catlike Coding「Game Objects and Scripts」(時計) — 適合度高いが「ゲーム」ではない点をユーザーに確認
- Unity旧公式「Space Shooter」— instantiate/コルーチン/トリガー/スコアUIで適合。アセット部分は
  プリミティブ代替の明記が必要
- ブロック崩し/Pong系 — 記事の多くが2D。**3D版**の記事を選ぶこと (bounciness=1・摩擦0の物理マテリアル、
  パドルはkinematic+velocity という構成なら本エディタで可能)

---

## 5. フェーズ1: 本文の取得 (ネットワーク制約下での取材)

**この環境のネットワーク事情 (毎回まず確認):**
- 一般Webサイトへの curl / WebFetch は**プロキシに403で遮断されることが多い**
  (learn.unity.com, hatenablog, catlikecoding, noobtuts 等は全滅だった)。
  確認: `curl -sS -o /dev/null -w "%{http_code}" --max-time 12 <URL>` → `000` なら遮断。
- **通るもの**: ① WebSearch (スニペットに具体値が載る) ② `raw.githubusercontent.com` への curl
  (公開リポジトリの生ファイル。これが最重要ルート)。
- **通らないもの**: `api.github.com` / `codeload.github.com` / GitHub MCPツールの他リポジトリ操作
  (セッションのGitHubゲートウェイがスコープ外リポジトリを遮断し
  `GitHub access to this repository is not enabled for this session` を返す)。
  → ディレクトリ一覧が取れないので、rawのパスは検索結果やリポジトリ名の慣習から推測して
  1つずつ `curl -w "%{http_code}"` でプローブする。

**手順:**
1. WebSearch でチュートリアル名+具体値 (例: `"West Wall" scale "20.5"`) を検索し、
   正典URLと本文ミラー・追走リポジトリ (「〜 tutorial github」で見つかる) を特定する。
2. ミラー/追走リポジトリの原典コード (.cs) やチュートリアル全文 (.md) を
   `raw.githubusercontent.com` から curl でスクラッチパッドに保存する。
3. **数値の裏取りルール**: Transform値・力の大きさ・個数などの具体値は、
   (a) 取得したミラー/コード、または (b) 独立した複数の検索スニペット、のどちらかで裏付ける。
   裏付けが取れない配置値 (動画内で目分量ドラッグしている類) は「原典が目分量」であることを
   ガイドに明記した上で自分で決めてよい。**記憶だけで断言しない。**
4. 取得した原典C#は逐語でJSへ変換する (フック名対応は `docs/TUTORIAL_*.md` の早見表を踏襲)。
   変数名・定数値・処理順を変えない。`ForceMode.VelocityChange` → `rb.velocity` 直接加算、
   参照ドラッグ → `ctx.find()`/`ctx.findObjectOfType()` 等の定型変換は既存ガイド2本に前例がある。
5. 出典 (URL) をメモし、最終ガイドと報告に必ず記載する。

---

## 6. フェーズ2: ギャップ分析と不足機能の実装

1. 原典スクリプトが使うUnity APIを列挙し、§1 のAPI早見と突き合わせて不足リストを作る。
2. 不足1件ごとに: 型 (`types/scene.ts`) → エンジン (`scripting.ts`/`physics.ts`/`ThreeEngine.ts`/
   `objectFactory.ts`) → UI (Inspectorセクション/メニュー) → `DEFAULT_SCRIPT_CODE` のコメント更新
   → `npx tsc --noEmit`。**1件ずつ**。
3. 実装方針の型 (過去の判断に合わせる):
   - スクリプトから物理のランタイム状態に触るものは Rapier直結 (SSoTを介さない)。
     SSoTはあくまで「設定値」(例: velocityはRapier、massはSSoT)
   - UI表示物はSSoT経由 (uitextのようにストア購読でReactが描く) — Undo/保存/ライブ更新がタダで乗る
   - Unityに同名概念がある場合、**Unityの意味論を再現**する (例: AddForceはステップ毎に消費、
     LoadSceneはConsoleを消さない、SetActiveはサブツリーの物理・スクリプトごと止める)
4. `DECISIONS.md` に `## D-0XX: <チュートリアル名>完走パック — …` を追記
   (D-035/D-036の体裁を踏襲。何を・なぜ・どう実装したかを箇条書き)。

**呼ぶ前にgrepで確認必須のシグネチャ (思い込み事故の実績があるもの):**
```bash
grep -n "export function cmdReparent" src/store/editorStore.ts   # (id, newParentId, index|null) — 単一ID!
grep -n "export function instantiatePrefab" src/store/actions.ts  # (assetId, position?, parentId=null)
grep -n "export function cmdPatchComponent\|export function cmdAddComponent" src/store/editorStore.ts
grep -n "export const default" src/types/scene.ts                 # defaultCollider('box'|'sphere') 等
grep -n "makePrimitiveNode\|makeEmptyNode\|makeLightNode" src/store/editorStore.ts
```

---

## 7. フェーズ3: E2Eスクリプト作成

**`e2e/cubethon.mjs` をコピーして書き換える** (ボイラープレート・check関数・ポーリングの型が全部ある)。

```js
import { chromium } from 'playwright-core'
const OUT = new URL('./out', import.meta.url).pathname
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--use-gl=swiftshader'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const check = (label, cond) => console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}`)
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)
```

**作法:**
- シーン構築は `page.evaluate(async ({...}) => { const store = await import('/src/store/editorStore.ts'); ... }, {...})`
  で行う (UIメニューと同じ関数を呼ぶ)。**スクリプトのコード文字列は第2引数で渡す**
  (テンプレートリテラル内エスケープ地獄の回避)。`page.evaluate` に引数を渡し忘れると
  `Cannot destructure property ...` で落ちる (実績あり)。
- 章立て = チュートリアルの章立て。各章: 構築 → アサーション → スクリーンショット。
- **スクショは積極的に10〜12枚**: 各章の節目 / スクリプトエディタを開いた画面 (`getByText('Open Script Editor').click()`
  → 撮影 → Cancel) / Inspector の決め手 (Tag・Is Trigger・プレハブバー等が写る構図) / 失敗シーン (Game Over) /
  勝利シーン / ⏹復元後。エディタカメラは `window.__engine` の `e.camera.position.set(...)` + `e.orbit?.target.set(...)` で構図を作る。
- **アサーション設計の3原則** (過去のFAILは全部ここ):
  1. **物理は点時刻で見ない。** 振り子のy座標のような振動量は全再生ウィンドウをサンプリングして振幅で判定。
     倒壊などは決定論的になるよう初期条件を設計 (重心を支持面の外に出す等)。
  2. **状態遷移はポーリングで待つ** (`while` + 150ms間隔 + タイムアウト)。固定 `waitForTimeout` で
     「そのはず」の時刻に観測しない (リスタートで想定より早く/遅くなる)。
  3. **期待値は手計算で正当性を確認してから書く。** 例: カメラfollowのoffsetは
     「カメラ(0,10,-10) − プレイヤー(0,0.5,0) = (0,9.5,-10)」であり10ではない。
     Update追従はFixedUpdate移動に1フレーム遅れる (Unityも同じ) → 高速域では数mの許容が要る。
- キーボード入力: `page.keyboard.down('d')` → window keydownに届く (エンジンは `e.key.toLowerCase()` で
  再生中のみ収集)。操縦が要るゲームは bang-bang 制御 (現在座標と速度を読み、レーン境界で短タップ) —
  実装例は `e2e/rollaball.mjs` (円周回収) と `e2e/cubethon.mjs` (レーン維持) にある。
  死亡→自動リスタートが絡む場合、ループは「y<閾値なら待って continue」で自己回復させる。
- 検証の勘所: ストアの `logs` (Consoleログ)、`mode`、ノードの `transform.position`、
  uitextの `text`、`visible` を `page.evaluate` で読む。UIオーバーレイは `page.getByText(...)` で実在確認。

---

## 8. フェーズ4: 実行→修正ループ (最重要規律)

**鉄則: `src/` を1文字でも変更したら dev server を再起動してからE2Eを実行する。**
ViteのHMRが走った後の `page.evaluate(import('/src/...'))` は**別モジュール実体** (別ストア) を掴み、
「テストは動いているのにエンジンに何も起きない」怪現象になる (本プロジェクト最多の時間泥棒)。

```bash
pkill -f vite   # exit code 144 は正常 (killされた報告)。気にしない
# Bashツールの run_in_background=true で: npm run dev
sleep 3 && curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/   # 200 を確認
node e2e/<name>.mjs 2>&1 | tail -25
```
(バックグラウンド起動は必ずBashツールの `run_in_background` を使う。`nohup`/`&` はターン終了で死ぬ)

**FAILが出たときの決定木 (上から順。飛ばさない):**
1. **期待値は物理的・数学的に正しいか?** 手計算する。(実例: offset 9.5 / 振り子の位相)
2. **テストの段取りが原典の状況を再現しているか?** シーン配置を疑う。
   (実例: 地面がまだ10×10の章で z=25 に障害物を置いた → 両方落下して衝突せず)
3. **観測タイミングの問題か?** 固定sleepをポーリングに変える。ログはクリアされ得るか?
   スクショの瞬間は正しいか?
4. **APIシグネチャの思い込みか?** grepで実物を見る。(実例: cmdReparentに配列)
5. ここまで全て潰れて初めて**エンジンのバグ**を疑う。直す場合は:
   Unityの実挙動を根拠として明記 → 最小差分 → `DECISIONS.md` 追記 → **既存E2E全部で回帰確認**。
   (実例: restartSceneがClear on Playを発火してConsoleが消える → UnityのLoadSceneは消さないので修正)

**同じFAILに仮説3つを試して直らないとき**: 推測をやめ、テストに観測コードを足して実際の値を
出力させる (プレイヤー座標のタイムライン、ログ全文など)。観測してから直す。

**スクショの検品 (全数必須):** Read ツールでPNGを開き、以下を確認して不合格は構図を直して撮り直す:
- [ ] 主役 (対象オブジェクト/UI/ログ) がフレーム内で判読できる (遠すぎて点になっていないか)
- [ ] Inspector に見せたい値 (Tag / Is Trigger / props / チェックボックス) が写っているか
- [ ] ステータスバー/Consoleに期待ログが写っているか
- [ ] Hierarchyの状態 (eye-off、プレハブ青、ノード構成) が物語と一致するか

**リグレッション (エンジンを触った場合は必須):**
```bash
node e2e/rollaball.mjs 2>&1 | tail -6
node e2e/cubethon.mjs 2>&1 | tail -6
node e2e/demo-complex.mjs 2>&1 | tail -9
```
全部 OK + `page errors: none` であること。加えて `npx tsc --noEmit` と `npm run build` の両方
(buildの方が厳しいことがある。実例: 自己参照初期化のTS7022はbuildのみで検出 → フィールドに明示型注釈で解消)。

---

## 9. フェーズ5: ドキュメント

1. **`docs/TUTORIAL_<NAME>.md`** (ユーザーが原典を見ながら本エディタで進めるためのガイド)。章立て:
   - タイトル/概要 → 参照サイトURL (正典+コード出典) → E2Eで完走検証済みの一文
   - C#→JS対応早見表 (新規に増えた対応だけでなく、そのチュートリアルで使う全対応)
   - 章 (Unit/Episode) ごと: 原典の手順 → 本エディタでの操作 (メニュー名・数値・コピペ可能なJSスクリプト全文)
   - 「意図的な差異」節 (コライダー明示追加、参照ドラッグ→find、等)
2. **`DECISIONS.md`**: D-0XX エントリ (フェーズ2で書いたものを完成させる)
3. **`README.md`**: 「チュートリアルで試す」節に1行追加 + 新APIを機能説明に反映
4. **`ROADMAP.md`**: 対応済み表に1行追加

---

## 10. フェーズ6: コミット・プッシュ・報告

```bash
git add -A
git -c user.email="<環境指示のメール>" -c user.name="Claude (autonomous dev)" commit -m "feat: ..."
git push -u origin <環境指示のブランチ>   # 失敗時は2s/4s/8s/16sで再試行
```
- コミットメッセージ: 英語。何を実装し、E2Eで何を検証したかを本文に。トレーラは環境指示に従う。

**ユーザーへの報告フォーマット (この順で):**
1. **選定サイトのURL** (冒頭に明示。ユーザーはそれをブラウザで見ながら追走する)
2. 選定理由 (1〜2文) + 原典コードの出典
3. **実装した不足機能** と **発見・修正した不具合** の一覧 (テスト側/エンジン側を区別して正直に)
4. 検証結果 (チェック数、自動プレイの内容、リグレッション)
5. スクリーンショット送付 (SendUserFile等、環境のファイル送付手段で。キャプション付き) +
   対応ガイド (`docs/TUTORIAL_*.md`) の場所

---

## 11. 既知の落とし穴 大全

| 症状 | 原因 | 対処 |
|---|---|---|
| テストがストアを変えてもエディタが無反応 | HMR後のモジュール二重化 | src変更後は**必ず**devサーバ再起動 (§8鉄則) |
| `pkill -f vite` が exit 144 | killの正常な戻り | 気にせず続行 |
| バックグラウンドのサーバが勝手に死ぬ | `nohup`/`&` はターン終了で回収される | Bashツールの `run_in_background` を使う |
| 一般サイトのfetchが403/000 | プロキシのegress制限 | §5 のルート (WebSearch + raw.githubusercontent) |
| api.github.com が「access not enabled」 | セッションのGitHubゲートウェイ | rawのパスをプローブして直接取る |
| `page.evaluate` で `Cannot destructure ...` | 第2引数 (ペイロード) の渡し忘れ | evaluateの引数を確認 |
| 衝突が起きない/物が落ちる | 対象が地面の外・チェーン非表示 (物理は再生開始時に**表示チェーンが有効なノードのみ**構築) | 配置座標と visible を確認 |
| 高速の物体がすり抜ける | 離散衝突判定 | rigidbody の `collisionDetection: 'continuous'` (CCD)。トリガーは奥行きを厚く (12m等) |
| AddForceが効きすぎる/効かない | Rapierの外力は永続 → エンジンがstep毎にリセット済み (Unity互換) | 仕様通り。速度直接操作は `.velocity` |
| リスタート後にConsoleログが消える(た) | 旧: restartSceneがClear on Play発火 | D-036で修正済み。新規に再生系を触るときは同種の忠実度を確認 |
| 再生中の `script.enabled=false` が無視される(た) | 旧: 起動時に固定 | D-036で修正済み (ライブ判定) |
| zustandセレクタで無限再レンダー | セレクタ内で毎回新配列 (`.filter`等) を返す | 安定参照を選び、加工はコンポーネント側で |
| `execute()` 後に古いノードを参照 | 取得済みスナップショットは不変 | 変更後は `getState()` を取り直す |
| Inspectorのタブ/ボタンが2つヒット | 同名テキストが複数 | `.first()` / `getByTitle('Play', { exact: true })` |
| スクショで対象が点になる | 3D距離感 (1mキューブは50m先で数px) | エディタカメラを寄せる。§8の検品チェック |
| Sceneビューのグリッド/空が異常 (SwiftShader) | ソフトレンダラの制約 | 既に対策済 (シェーダグリッド等)。新規シェーダには `#include <colorspace_fragment>` |
| buildだけ落ちる (TS7022等) | `tsc --noEmit` より厳格/キャッシュ差 | クラスフィールドの自己参照には明示型注釈。両方回す |
| キー入力が入らない | 再生中のみ収集 / モーダルにフォーカス | modeを確認、モーダルは閉じる。キーは `e.key` 小文字 |
| デフォルトシーンの前提違い | 初期シーンは Main Camera + Directional Light のみ。Planeは**Unityと同じ10×10**、Cube 1³、Sphere r0.5 | チュートリアルのスケール値がそのまま使える |

---

## 12. 完了条件 (Definition of Done)

- [ ] 選定チュートリアルの正典URLをユーザーに提示した
- [ ] 原典コード/数値が取得物で裏付けられている (出典記録あり)
- [ ] 不足機能を実装し、D-0XX を `DECISIONS.md` に記録した
- [ ] `e2e/<name>.mjs` が**ゲームのゴールまで自動プレイで到達** (全チェックOK / page errors: none)
- [ ] ⏹停止で完全復元することをアサートした
- [ ] スクショ10枚前後を全数目視検品した
- [ ] 既存E2E (rollaball / cubethon / demo-complex) が全緑
- [ ] `npx tsc --noEmit` と `npm run build` が両方成功
- [ ] `docs/TUTORIAL_<NAME>.md` + README + ROADMAP を更新した
- [ ] コミット・プッシュ済み (PRなし、モデルID非記載)
- [ ] 報告: URL / 実装・修正一覧 / 検証結果 / スクショ送付

---

## 付録: 過去2回の実績サマリ (規模感の目安)

| 回 | 選定 | 実装した不足機能 | 発見した不具合 (テスト側) | 発見した不具合 (エンジン側) |
|---|---|---|---|---|
| 1 | Unity Learn **Roll-a-Ball** (learn.unity.com/course/roll-a-ball) | getAxis / rb.addForce・velocity / Tag+compareTag / SetActive / UI Text (D-035) | カメラoffset期待値の計算違い / 振り子ならぬ点時刻観測は前回教訓 | なし |
| 2 | Brackeys **Cubethon** (youtube.com/playlist?list=PLPV2KyIb3jR53Jce9hP7G5xC4O9AgnOuL) | スクリプト間メソッド呼出+findObjectOfType / Behaviour.enabledライブ / Invoke / restartScene / MeshRenderer.enabled / CCD (D-036) | 障害物を地面の外に配置 / evaluate引数忘れ / リスタート検知を固定時刻で観測 | restartSceneがConsoleをクリア (LoadSceneはConsole非クリアが正) |

いずれも「エンジン先行実装 → 章立て通りE2E → FAILは決定木で切り分け → スクショ検品 → 文書化 → コミット」
の順で完走している。この指示書の通りに進めれば3回目も同じ品質で完走できる。
