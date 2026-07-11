# Brackeys「How to Make a Video Game」(Cubethon) を UnityThree Editor で作る — 対応ガイド

世界で最も視聴されたUnity入門シリーズ、Brackeysの **How to Make a Video Game** (通称 Cubethon —
青いキューブで障害物コースを駆け抜けるランナー) を本エディタでそのまま進めるためのガイドです。

- 参照サイト (公式):
  - **YouTube公式プレイリスト: https://www.youtube.com/playlist?list=PLPV2KyIb3jR53Jce9hP7G5xC4O9AgnOuL**
    (E01 BASICS → E02 MOVEMENT → E03 COLLISION → E04 FOLLOWING → E05 LEVEL → E06 GAME OVER → E07 UI → E08-10 WIN/BUILD)
- 原典C#コードの出典 (動画を追走したコミュニティリポジトリ、スクリプトは動画と同一):
  - https://github.com/ccerrato147/cubethon (PlayerMovement / PlayerCollision / FollowPlayer / GameManager)
  - https://github.com/Angelo-1123/Cubethon-Brackeys-Unity-Study (EndTrigger)
- 本エディタでの再現は `e2e/cubethon.mjs` で全エピソードを自動検証済み
  (衝突死 → 落下死 → 自動リスタート → 完走 "LEVEL COMPLETE" まで16チェック green)。

## C# → 本エディタJS の対応早見表 (Roll-a-Ball編との差分)

| Unity (C#) | UnityThree Editor (JS) |
|---|---|
| `rb.AddForce(0, 0, forwardForce * Time.deltaTime)` | `rb.addForce({ x: 0, y: 0, z: ctx.props.forwardForce * dt })` |
| `rb.AddForce(x, 0, 0, ForceMode.VelocityChange)` | `rb.velocity = { x: v.x + x, ... }` (速度へ直接加算) |
| `Input.GetKey("d")` | `ctx.input.getKey('d')` |
| `movement.enabled = false` | 同じ (`getComponent('PlayerMovement').enabled = false`) — 再生中に反映 |
| `FindObjectOfType<GameManager>().EndGame()` | `ctx.findObjectOfType('GameManager').EndGame()` |
| 他スクリプトのpublicメソッド呼び出し | スクリプトの**トップレベル関数**がそのままメソッドになる (第1引数に相手のctxが渡る) |
| `Invoke("Restart", restartDelay)` | `ctx.invoke('Restart', ctx.props.restartDelay)` |
| `SceneManager.LoadScene(GetActiveScene().name)` | `ctx.restartScene()` (再生モードのままシーンを初期状態へ) |
| `GetComponent<MeshRenderer>().enabled = false` (Inspector) | Mesh Filter ヘッダの**チェックボックスをOFF** (コライダーは生きる) |
| Rigidbody > Collision Detection > Continuous | 同じ (Rigidbodyセクションのドロップダウン) — 高速キューブのすり抜け対策 |
| `collisionInfo.collider.tag == "Obstacle"` | `other.tag === 'Obstacle'` |

## E02 — MOVEMENT

1. Plane「Ground」を作成 (+ **Box Collider**: Size (10, 0.1, 10) / Center (0, -0.05, 0))
2. Cube「Player」を (0, 1, 0) に作成 + **Rigidbody** + **Box Collider**
3. New Script → `PlayerMovement`:

```js
const props = { forwardForce: 2000, sidewayForce: 500 }
let rb

function onStart(ctx) {
  ctx.log('Script started')
  rb = ctx.node.getComponent('rigidbody')
}

function onFixedUpdate(ctx, dt) {
  rb.addForce({ x: 0, y: 0, z: ctx.props.forwardForce * dt })

  if (ctx.input.getKey('d')) {
    const v = rb.velocity
    rb.velocity = { x: v.x + ctx.props.sidewayForce * dt, y: v.y, z: v.z }
  }
  if (ctx.input.getKey('a')) {
    const v = rb.velocity
    rb.velocity = { x: v.x - ctx.props.sidewayForce * dt, y: v.y, z: v.z }
  }

  // E06で追記: 落下判定
  if (ctx.node.position.y < -1) {
    ctx.findObjectOfType('GameManager').EndGame()
  }
}
```

▶ 再生: A/Dで左右に動かしながら加速。動画同様、プレーンの端から落ちたら成功です。

## E03 — COLLISION

1. Cube「Obstacle」を (0, 0.5, 4) に作成、Materialを赤に、**Tag欄に `Obstacle`**、
   **Rigidbody** + **Box Collider** を追加
2. Playerの **Rigidbody > Collision Detection を `Continuous`** に (高速化するとすり抜けるため — 動画と同じ手順)
3. Playerへ New Script → `PlayerCollision`:

```js
let movement

function onStart(ctx) {
  movement = ctx.node.getComponent('PlayerMovement')
}

function onCollisionEnter(ctx, other) {
  if (other.tag === 'Obstacle') {
    movement.enabled = false
    ctx.findObjectOfType('GameManager').EndGame() // E06で追記
  }
}
```

▶ 障害物に突っ込むと吹き飛ばし、以後の前進が止まります (movement無効化)。

## E04 — FOLLOWING PLAYER (カメラ)

Main Camera を (0, 2, -5) / Rotation (10, 0, 0) に置き、New Script → `FollowPlayer`:

```js
const props = { offsetX: 0, offsetY: 1, offsetZ: -5 }
let player

function onStart(ctx) {
  player = ctx.find('Player')
}

function onUpdate(ctx, dt) {
  const p = player.position
  ctx.node.position.set(p.x + ctx.props.offsetX, p.y + ctx.props.offsetY, p.z + ctx.props.offsetZ)
}
```

> 原典は `public Transform player` へ参照ドラッグ + `public Vector3 offset`。
> 本エディタでは `ctx.find('Player')` + 数値props 3つで同等。
> Updateでの追従はUnityでも1フレーム遅れます (原典準拠)。

## E05 — BUILDING THE LEVEL

- Ground を Scale **(3, 1, 50)**、Position (0, 0, 240) に → 30×500 のコース
- Player のMaterialを青 (#2f6fd1)、Ground をグレー (#8a8f98) に
- Obstacle を Ctrl+D で複製してコースに配置 (例: z=30, 70, 110, 200, 300, 410 / xは0〜4で散らす)

## E06 — GAME OVER (リスタート)

Create Empty「GameManager」+ New Script → `GameManager`:

```js
const props = { restartDelay: 1 }
let gameHasEnded = false

function CompleteLevel(ctx) {
  ctx.find('LevelComplete').setActive(true)
}

function EndGame(ctx) {
  if (!gameHasEnded) {
    gameHasEnded = true
    ctx.log('Game Over!')
    ctx.invoke('Restart', ctx.props.restartDelay)
  }
}

function Restart(ctx) {
  ctx.restartScene()
}
```

PlayerMovement に落下判定、PlayerCollision に `EndGame()` 呼び出しを追記 (上記コード内コメント参照)。
▶ 落下 or 衝突の1秒後、**再生モードのまま**シーンが初期状態から再開します (LoadScene相当)。
Consoleのログはリスタート後も残ります (Unityと同じ)。

## E07-09 — LEVEL COMPLETE (勝利)

1. **GameObject > UI > Text** → 名前 `LevelComplete`、Text `LEVEL COMPLETE`、Font Size 44、
   Anchor Center/Middle。**ヘッダのActiveチェックをOFF** (初期非表示)
2. コース終端にCube「EndTrigger」(0, 1.5, 476) / Scale (30, 4, 12):
   - **Mesh Filter ヘッダのチェックをOFF** (= MeshRenderer.enabled false、見えないが判定は生きる)
   - **Box Collider → Is Trigger ✔**
   - New Script → `EndTrigger`:

```js
function onTriggerEnter(ctx, other) {
  ctx.log('Hit')
  ctx.findObjectOfType('GameManager').CompleteLevel()
}
```

▶ 障害物をかわして走り切ると **LEVEL COMPLETE** が表示されます。

## 意図的な差異

- スクリプトはJS。**トップレベル関数=公開メソッド** (第1引数に自分のctx) — C#のpublicメソッド相当。
- `ForceMode.VelocityChange` は `rb.velocity` への直接加算で表現 (数値は原典のまま)。
- 参照ドラッグ (`public Transform` 等) は `ctx.find(名前)` / `ctx.findObjectOfType(スクリプト名)` で解決。
- E08 (メニュー/ポリッシュ) のフォント変更・シーン遷移メニュー、E10のビルド出力は未対応 (ROADMAP参照)。
