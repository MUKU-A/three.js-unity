# Roll-a-Ball (玉転がし) を UnityThree Editor で作る — 公式チュートリアル対応ガイド

Unity公式の入門チュートリアル **Roll-a-Ball** を、本エディタでそのまま進めるためのガイドです。

- 参照サイト (公式 Unity Learn):
  - 日本語: **https://learn.unity.com/course/rollaball** (「玉転がし」)
  - 英語 (最新版): **https://learn.unity.com/course/roll-a-ball**
  - 旧プロジェクト版: https://learn.unity.com/project/roll-a-ball
- ゴール: ボールを転がして12個の回転するキューブを集め、カウンター表示と **"You Win!"** を出す。
- 本エディタでの再現は `e2e/rollaball.mjs` で全手順を自動検証済み
  (実キーボード操縦で12個収集 → You Win! → ⏹完全復元まで全チェック green)。

## C# → 本エディタJS の対応早見表

| Unity (C#) | UnityThree Editor (JS) |
|---|---|
| `public float speed = 0;` | `const props = { speed: 10 }` (Inspectorに自動表示) |
| `void Start()` / `FixedUpdate()` / `LateUpdate()` | `function onStart(ctx)` / `onFixedUpdate(ctx, dt)` / `onLateUpdate(ctx, dt)` |
| `rb = GetComponent<Rigidbody>()` | `rb = ctx.node.getComponent('rigidbody')` |
| `Input.GetAxis("Horizontal")` (または OnMove) | `ctx.input.getAxis('Horizontal')` (WASD+矢印) |
| `rb.AddForce(movement * speed)` | `rb.addForce({ x: mx * speed, y: 0, z: mz * speed })` |
| `void OnTriggerEnter(Collider other)` | `function onTriggerEnter(ctx, other)` |
| `other.gameObject.CompareTag("PickUp")` | `other.compareTag('PickUp')` |
| `other.gameObject.SetActive(false)` | `other.setActive(false)` |
| `transform.Rotate(new Vector3(15,30,45) * Time.deltaTime)` | `ctx.node.rotation.x += 15 * dt` (y,zも同様) |
| `public TextMeshProUGUI countText` (参照をドラッグ) | `ctx.find('CountText').getComponent('uitext')` (名前で取得) |
| `winTextObject.SetActive(true)` | `ctx.find('WinText').setActive(true)` |

## Unit 1 — ゲームのセットアップ

| Unity Learnの手順 | 本エディタでの操作 |
|---|---|
| 新規3Dプロジェクト作成 | File > New Scene (最初から Main Camera + Directional Light がある) |
| GameObject > 3D Object > **Plane** → "Ground" | 同じ (Hierarchy右クリック or GameObjectメニュー)。PlaneはUnityと同じ**10×10** |
| Ground の Scale を **(2, 1, 2)** | Inspector の Transform でそのまま入力 (数値ラベルを左右ドラッグでも可) |
| — (UnityのPlaneはCollider内蔵) | **Add Component > Box Collider** を追加し、Size **(10, 0.1, 10)** / Center **(0, -0.05, 0)** ← 本エディタはコライダーを明示追加する |
| GameObject > 3D Object > **Sphere** → "Player"、Position **(0, 0.5, 0)** | 同じ。**Add Component > Sphere Collider** も追加 (半径0.5がデフォルト) |
| Materialsフォルダを作り、色を設定してドラッグ | 本エディタはオブジェクトの **Material コンポーネント**で直接色を設定 (Groundを紺 `#204066` など) |

## Unit 2 — プレイヤーの移動

1. Player を選択 → **Add Component > Rigidbody**
2. **Add Component > New Script** → 名前を `PlayerController` に → **Open Script Editor** で以下を貼り付け:

```js
const props = { speed: 10 }
let rb
let count = 0

function onStart(ctx) {
  rb = ctx.node.getComponent('rigidbody')
  count = 0
  setCountText(ctx)
  ctx.find('WinText').setActive(false)
}

function onFixedUpdate(ctx, dt) {
  const moveHorizontal = ctx.input.getAxis('Horizontal')
  const moveVertical = ctx.input.getAxis('Vertical')
  rb.addForce({ x: moveHorizontal * ctx.props.speed, y: 0, z: moveVertical * ctx.props.speed })
}

function onTriggerEnter(ctx, other) {
  if (other.compareTag('PickUp')) {
    other.setActive(false)
    count = count + 1
    setCountText(ctx)
  }
}

function setCountText(ctx) {
  ctx.find('CountText').getComponent('uitext').text = 'Count: ' + count
  if (count >= 12) {
    ctx.find('WinText').setActive(true)
  }
}
```

> `onTriggerEnter` / `setCountText` は Unit 5・6 の内容を含みます。チュートリアル通り
> 段階的に書き足してもOK (UI作成前に再生すると `find('CountText')` がnullでスクリプトが
> 停止するので、その場合は該当行をUnit 6まで後回しに)。

3. Inspector の PlayerController に **Speed** フィールドが自動で出る → **10** に設定
4. ▶ 再生 → **WASD / 矢印キー**でボールが転がる (Unityと同じ `AddForce` の加速感)

## Unit 3 — カメラとプレイエリア

1. Main Camera: Position **(0, 10, -10)**、Rotation **(45, 0, 0)**
2. Main Camera に **Add Component > New Script** → `CameraController`:

```js
let player
let offset

function onStart(ctx) {
  player = ctx.find('Player')
  const c = ctx.node.position
  const p = player.position
  offset = { x: c.x - p.x, y: c.y - p.y, z: c.z - p.z }
}

function onLateUpdate(ctx) {
  const p = player.position
  ctx.node.position.set(p.x + offset.x, p.y + offset.y, p.z + offset.z)
}
```

> Unityでは `public GameObject player` へ参照をドラッグしますが、本エディタのpropsは
> プリミティブ型のみのため **`ctx.find('Player')`** で名前検索します (対応表参照)。

3. **Create Empty** → "Walls" (原点)。その下に Cube を4枚 (右クリック > 3D Object > Cube し、WallsへDnDで子に):

| 壁 | Position | Scale |
|---|---|---|
| West Wall | (-10, 0, 0) | (0.5, 2, 20.5) |
| East Wall | (10, 0, 0) | (0.5, 2, 20.5) |
| North Wall | (0, 0, 10) | (20.5, 2, 0.5) |
| South Wall | (0, 0, -10) | (20.5, 2, 0.5) |

各壁に **Box Collider** を追加 (Rigidbodyなし = 静的コライダー、Unityと同じ扱い)。

## Unit 4 — 収集アイテム (PickUp)

1. Cube を作成 → "PickUp"、Position **(0, 0.5, 0)**、Rotation **(45, 45, 45)**、Scale **(0.5, 0.5, 0.5)**。Materialで金色に (例 `#ffd34d`)
2. **Add Component > New Script** → `Rotator`:

```js
function onUpdate(ctx, dt) {
  ctx.node.rotation.x += 15 * dt
  ctx.node.rotation.y += 30 * dt
  ctx.node.rotation.z += 45 * dt
}
```

3. **Unit 5の設定を先に済ませる** (Inspector上部の **Tag** 欄に `PickUp` と入力 /
   **Box Collider** 追加 → **Is Trigger** ✔ / **Rigidbody** 追加 → **Is Kinematic** ✔)
4. Hierarchyで右クリック → **Create Prefab** (Hierarchyの表示が青くなり、ProjectにPickUp.prefabが入る)
5. **Create Empty** → "PickUps" を作り、PickUp をDnDで子にする
6. **Ctrl+D で11回複製** (複製もプレハブインスタンスのまま) し、Playerの周りに散らして配置。例 (半径5の円、30°間隔):
   (5, 0.5, 0) / (4.33, 0.5, 2.5) / (2.5, 0.5, 4.33) / (0, 0.5, 5) / (-2.5, 0.5, 4.33) / (-4.33, 0.5, 2.5) /
   (-5, 0.5, 0) / (-4.33, 0.5, -2.5) / (-2.5, 0.5, -4.33) / (0, 0.5, -5) / (2.5, 0.5, -4.33) / (4.33, 0.5, -2.5)

## Unit 5 — 衝突判定

- PlayerController の `onTriggerEnter` (Unit 2で貼り付け済み) がUnityの
  `OnTriggerEnter(Collider other)` に相当。`other.compareTag('PickUp')` → `other.setActive(false)` で
  収集したPickUpが**表示・物理・スクリプトごと無効化**される (⏹停止で全て復元)。
- Is Trigger / Is Kinematic の意味付けはUnityと同一 (センサー化・物理演算対象外)。

## Unit 6 — スコアUIと勝利表示

1. **GameObject > UI > Text** → 名前を `CountText` に。UI Textコンポーネントで:
   Text `Count: 0` / Font Size 20 / Anchor X=Left, Y=Top / Offset (10, 10)
2. もう一つ **UI > Text** → `WinText`: Text `You Win!` / Font Size 32 /
   Anchor X=Center, Y=Middle / Offset (0, -60)
3. WinText は再生開始時にスクリプトが `setActive(false)` で隠し、12個集めると再表示 —
   現行のUnity公式スクリプトと同じ流儀 (エディタ上では見えたままでOK)
4. ▶ 再生 → 集めるたびに `Count: n` が増え、12個で **You Win!**

## 意図的な差異 (本エディタの仕様)

- スクリプトは **C#ではなくJS** (フック名はUnityのライフサイクル準拠)。
- コライダーは**明示追加** (UnityのPlane/Cube等はCollider内蔵)。
- マテリアルはアセットではなく**コンポーネント** (色変更はInspectorで直接)。
- スクリプトのpropsはプリミティブのみ → オブジェクト参照は `ctx.find(名前)` で解決。
- Tagは自由入力 (Tag Managerはない)。
- UI TextはUnityのCanvas/TextMeshProの**最小サブセット** (アンカー+オフセット+フォントサイズ+色)。
- 入力は新Input SystemのOnMoveではなく **`input.getAxis`** (旧Input Manager互換の使い勝手)。
