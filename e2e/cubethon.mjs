/* Brackeys「How to make a Video Game」(Cubethon) をエピソード順に再現するE2E。
   https://www.youtube.com/playlist?list=PLPV2KyIb3jR53Jce9hP7G5xC4O9AgnOuL
   原典C#: PlayerMovement / PlayerCollision / FollowPlayer / GameManager / EndTrigger
   (コミュニティ追走リポジトリ ccerrato147/cubethon ほかから取得した動画通りのコードをJSへ逐語変換)

   E02 MOVEMENT   : Ground + Player + PlayerMovement (forwardForce 2000 / sidewayForce 500 / VelocityChange)
   E03 COLLISION  : 赤いObstacle (Tag/Rigidbody) + PlayerCollision (movement.enabled=false) + CCD
   E04 CAMERA     : FollowPlayer (offset 0,1,-5)
   E05 LEVEL      : 長いGround + 障害物コース + マテリアル
   E06 GAME OVER  : GameManager (EndGame → Invoke Restart 1s → LoadScene相当) + 落下判定 y<-1
   E07-09 WIN     : EndTrigger (Mesh Renderer OFF + Is Trigger) + LEVEL COMPLETE UI
   各段階でスクリーンショットを撮影 (cube01〜cube12) */
import { chromium } from 'playwright-core'
const OUT = new URL('./out', import.meta.url).pathname
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const check = (label, cond) => console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}`)
const S = () => page.evaluate(() => window.__store.getState())
const nodeByName = async (nm) => page.evaluate((n) => {
  const st = window.__store.getState()
  return Object.values(st.scene.nodes).find((x) => x.name === n) ?? null
}, nm)

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)

/* ---------------- 原典スクリプト (C#→JS逐語変換) ---------------- */
const PLAYER_MOVEMENT_V1 = `// Brackeys E02: PlayerMovement.cs
const props = { forwardForce: 2000, sidewayForce: 500 }
let rb

function onStart(ctx) {
  ctx.log('Script started')
  rb = ctx.node.getComponent('rigidbody')
}

// FixedUpdate works better for Unity Physics engine
function onFixedUpdate(ctx, dt) {
  // Add a forward force
  rb.addForce({ x: 0, y: 0, z: ctx.props.forwardForce * dt })

  if (ctx.input.getKey('d')) {
    // ForceMode.VelocityChange 相当: 質量を無視して速度へ直接加算
    const v = rb.velocity
    rb.velocity = { x: v.x + ctx.props.sidewayForce * dt, y: v.y, z: v.z }
  }
  if (ctx.input.getKey('a')) {
    const v = rb.velocity
    rb.velocity = { x: v.x - ctx.props.sidewayForce * dt, y: v.y, z: v.z }
  }
}
`
const PLAYER_MOVEMENT_V2 = PLAYER_MOVEMENT_V1.replace(
  /}\n$/,
  `
  // End game if player falls off the edge (E06)
  if (ctx.node.position.y < -1) {
    ctx.findObjectOfType('GameManager').EndGame()
  }
}
`,
)
const PLAYER_COLLISION_V1 = `// Brackeys E03: PlayerCollision.cs
let movement

function onStart(ctx) {
  movement = ctx.node.getComponent('PlayerMovement')
}

function onCollisionEnter(ctx, other) {
  if (other.tag === 'Obstacle') {
    ctx.log('We hit an obstacle!')
    movement.enabled = false
  }
}
`
const PLAYER_COLLISION_V2 = `// Brackeys E06: PlayerCollision.cs (EndGame呼び出しを追加)
let movement

function onStart(ctx) {
  movement = ctx.node.getComponent('PlayerMovement')
}

function onCollisionEnter(ctx, other) {
  if (other.tag === 'Obstacle') {
    movement.enabled = false
    ctx.findObjectOfType('GameManager').EndGame()
  }
}
`
const FOLLOW_PLAYER = `// Brackeys E04: FollowPlayer.cs
const props = { offsetX: 0, offsetY: 1, offsetZ: -5 }
let player

function onStart(ctx) {
  player = ctx.find('Player')
}

function onUpdate(ctx, dt) {
  const p = player.position
  ctx.node.position.set(p.x + ctx.props.offsetX, p.y + ctx.props.offsetY, p.z + ctx.props.offsetZ)
}
`
const GAME_MANAGER = `// Brackeys E06/E07: GameManager.cs
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
  // SceneManager.LoadScene(SceneManager.GetActiveScene().name) 相当
  ctx.restartScene()
}
`
const END_TRIGGER = `// Brackeys E09: EndTrigger.cs
function onTriggerEnter(ctx, other) {
  ctx.log('Hit')
  ctx.findObjectOfType('GameManager').CompleteLevel()
}
`

/* ================= E02: MOVEMENT ================= */
await page.evaluate(async ({ pm }) => {
  const scene = await import('/src/types/scene.ts')
  const store = await import('/src/store/editorStore.ts')
  const S = () => store.useEditorStore.getState()

  const ground = store.makePrimitiveNode('plane')
  ground.name = 'Ground'
  ground.components.push({ ...scene.defaultCollider('box'), size: { x: 10, y: 0.1, z: 10 }, center: { x: 0, y: -0.05, z: 0 } })
  S().execute(store.cmdAddObject([ground], null))

  const player = store.makePrimitiveNode('box')
  player.name = 'Player'
  player.transform.position = { x: 0, y: 1, z: 0 }
  player.components.push(scene.defaultRigidbody())
  player.components.push(scene.defaultCollider('box'))
  player.components.push({ ...scene.defaultScript('PlayerMovement'), props: { forwardForce: 2000, sidewayForce: 500 }, code: pm })
  S().execute(store.cmdAddObject([player], null))
  S().select([player.id])
}, { pm: PLAYER_MOVEMENT_V1 })
await page.waitForTimeout(400)

/* ---- cube01: スクリプトエディタを開いた編集画面 ---- */
await page.getByText('Open Script Editor').click()
await page.waitForTimeout(400)
await page.screenshot({ path: `${OUT}/cube01-script-editor.png` })
await page.getByRole('button', { name: 'Cancel' }).click().catch(async () => {
  await page.keyboard.press('Escape')
})
await page.waitForTimeout(300)

/* ---- 再生: 前進 + 左右移動 ---- */
await page.getByTitle('Play', { exact: true }).click()
/* Rapier初期化 → 前進開始を検知したら即撮影 (カメラ未追従なのですぐ遠ざかる) */
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(100)
  const p = await nodeByName('Player')
  if (p.transform.position.z > 1.2) break
}
await page.screenshot({ path: `${OUT}/cube02-e02-play.png` })
const e02a = await nodeByName('Player')
await page.keyboard.down('d')
await page.waitForTimeout(140)
await page.keyboard.up('d')
await page.waitForTimeout(250)
const e02b = await nodeByName('Player')
const logs02 = await page.evaluate(() => window.__store.getState().logs.map((l) => l.message))
check(`E02: forward force moves cube (+z ${e02b.transform.position.z.toFixed(1)}m)`, e02b.transform.position.z > 3)
check(`E02: 'd' steers right (+x ${(e02b.transform.position.x - e02a.transform.position.x).toFixed(2)})`, e02b.transform.position.x - e02a.transform.position.x > 0.3)
check("E02: Debug.Log → 'Script started'", logs02.some((m) => m.includes('Script started')))
await page.getByTitle('Stop', { exact: true }).click()
await page.waitForTimeout(500)

/* ================= E03: COLLISION ================= */
await page.evaluate(async ({ pc }) => {
  const scene = await import('/src/types/scene.ts')
  const store = await import('/src/store/editorStore.ts')
  const S = () => store.useEditorStore.getState()

  /* E03時点のGroundはまだ10x10 → プレーン内 (z=4) に置く (動画と同じく目の前) */
  const obstacle = store.makePrimitiveNode('box')
  obstacle.name = 'Obstacle'
  obstacle.tag = 'Obstacle'
  obstacle.transform.position = { x: 0, y: 0.5, z: 4 }
  const om = obstacle.components.find((c) => c.type === 'material')
  om.color = '#d64545'
  obstacle.components.push(scene.defaultRigidbody())
  obstacle.components.push(scene.defaultCollider('box'))
  S().execute(store.cmdAddObject([obstacle], null))

  /* Playerへ: PlayerCollision + 高速すり抜け対策 Collision Detection = Continuous (動画E03と同じ) */
  const player = Object.values(S().scene.nodes).find((n) => n.name === 'Player')
  S().execute(store.cmdAddComponent(player.id, { ...scene.defaultScript('PlayerCollision'), props: {}, code: pc }))
  const rbIdx = S().scene.nodes[player.id].components.findIndex((c) => c.type === 'rigidbody')
  S().execute(store.cmdPatchComponent(player.id, rbIdx, {}, { collisionDetection: 'continuous' }, 'Set CCD'))

  S().select([obstacle.id])
}, { pc: PLAYER_COLLISION_V1 })
await page.waitForTimeout(400)
await page.screenshot({ path: `${OUT}/cube03-e03-obstacle.png` })

await page.getByTitle('Play', { exact: true }).click()
/* 衝突ログを検知したら即撮影 (衝突の瞬間の画) */
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(70)
  const hit = await page.evaluate(() => window.__store.getState().logs.some((l) => l.message.includes('We hit an obstacle!')))
  if (hit) break
}
await page.screenshot({ path: `${OUT}/cube04-e03-crash.png` })
await page.waitForTimeout(600)
const e03 = await page.evaluate(() => {
  const st = window.__store.getState()
  const ns = Object.values(st.scene.nodes)
  const player = ns.find((n) => n.name === 'Player')
  const obstacle = ns.find((n) => n.name === 'Obstacle')
  const movementEnabled = player.components.find((c) => c.type === 'script' && c.name === 'PlayerMovement')?.enabled
  return { logs: st.logs.map((l) => l.message), movementEnabled, obstaclePos: obstacle.transform.position }
})
const obstacleMoved = Math.hypot(e03.obstaclePos.x, e03.obstaclePos.y - 0.5, e03.obstaclePos.z - 4)
check("E03: OnCollisionEnter → 'We hit an obstacle!'", e03.logs.some((m) => m.includes('We hit an obstacle!')))
check('E03: movement.enabled = false (再生中のBehaviour無効化)', e03.movementEnabled === false)
check(`E03: obstacle knocked away (moved ${obstacleMoved.toFixed(1)}m)`, obstacleMoved > 1)
await page.getByTitle('Stop', { exact: true }).click()
await page.waitForTimeout(500)

/* ================= E04: CAMERA (FollowPlayer) ================= */
await page.evaluate(async ({ fp }) => {
  const scene = await import('/src/types/scene.ts')
  const store = await import('/src/store/editorStore.ts')
  const S = () => store.useEditorStore.getState()
  const byName = (nm) => Object.values(S().scene.nodes).find((n) => n.name === nm)
  const cam = byName('Main Camera')
  S().execute(store.cmdPatchNode(cam.id, { transform: cam.transform }, {
    transform: { position: { x: 0, y: 2, z: -5 }, rotation: { x: 10, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
  }, 'Move Camera'))
  S().execute(store.cmdAddComponent(cam.id, { ...scene.defaultScript('FollowPlayer'), props: { offsetX: 0, offsetY: 1, offsetZ: -5 }, code: fp }))
  /* 追従テストの間だけ障害物を進路の外へ */
  const obstacle = byName('Obstacle')
  S().execute(store.cmdPatchNode(obstacle.id, { transform: obstacle.transform }, {
    transform: { ...obstacle.transform, position: { x: 4, y: 0.5, z: 4 } },
  }, 'Move Obstacle'))
}, { fp: FOLLOW_PLAYER })
await page.waitForTimeout(300)

await page.getByTitle('Play', { exact: true }).click()
await page.waitForTimeout(1200)
const e04 = await page.evaluate(() => {
  const st = window.__store.getState()
  const ns = Object.values(st.scene.nodes)
  const p = ns.find((n) => n.name === 'Player').transform.position
  const c = ns.find((n) => n.name === 'Main Camera').transform.position
  return { off: { x: c.x - p.x, y: c.y - p.y, z: c.z - p.z }, camZ: c.z }
})
await page.screenshot({ path: `${OUT}/cube05-e04-camera.png` })
/* UpdateでのフォローはFixedUpdate移動へ1フレーム遅れる (Unityでも同じ) → 高速域では数mの遅れを許容 */
check(`E04: camera follows player (offset→(${e04.off.x.toFixed(2)},${e04.off.y.toFixed(2)},${e04.off.z.toFixed(2)}), camZ=${e04.camZ.toFixed(1)})`,
  Math.abs(e04.off.x) < 1 && e04.off.y > 0.3 && e04.off.y < 4.5 && e04.off.z < -3 && e04.off.z > -10 && e04.camZ > 3)
await page.getByTitle('Stop', { exact: true }).click()
await page.waitForTimeout(500)

/* ================= E05: BUILDING THE LEVEL ================= */
await page.evaluate(async () => {
  const scene = await import('/src/types/scene.ts')
  const store = await import('/src/store/editorStore.ts')
  const S = () => store.useEditorStore.getState()
  const byName = (nm) => Object.values(S().scene.nodes).find((n) => n.name === nm)

  /* Groundを長いコースに (10x10プレーン → 30x500) */
  const ground = byName('Ground')
  S().execute(store.cmdPatchNode(ground.id, { transform: ground.transform }, {
    transform: { position: { x: 0, y: 0, z: 240 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 3, y: 1, z: 50 } },
  }, 'Stretch Ground'))
  const gm = ground.components.findIndex((c) => c.type === 'material')
  S().execute(store.cmdPatchComponent(ground.id, gm, {}, { color: '#8a8f98' }, 'Ground Color'))

  /* Playerを青に (動画のPlayerマテリアル) */
  const player = byName('Player')
  const pm = S().scene.nodes[player.id].components.findIndex((c) => c.type === 'material')
  S().execute(store.cmdPatchComponent(player.id, pm, {}, { color: '#2f6fd1', roughness: 0.35 }, 'Player Color'))

  /* 既存Obstacleをコースへ移動 + 5個複製配置 (序盤は動画同様に密, 右半分に集める — 左レーンが攻略ルート) */
  const spots = [
    { x: 0, z: 30 }, { x: 2.5, z: 70 }, { x: 0, z: 110 }, { x: 4, z: 200 }, { x: 1.5, z: 300 }, { x: 3, z: 410 },
  ]
  const src = byName('Obstacle')
  S().execute(store.cmdPatchNode(src.id, { transform: src.transform }, {
    transform: { ...src.transform, position: { x: spots[0].x, y: 0.5, z: spots[0].z } },
  }, 'Move Obstacle'))
  const ops = await import('/src/store/sceneOps.ts')
  for (let i = 1; i < spots.length; i++) {
    const clone = ops.cloneSubtree(S().scene, src.id)
    clone.nodes[0] = { ...clone.nodes[0], name: `Obstacle (${i})`, transform: { ...clone.nodes[0].transform, position: { x: spots[i].x, y: 0.5, z: spots[i].z } } }
    S().execute(store.cmdAddObject(clone.nodes, null))
  }
  S().select([byName('Player').id])
})
await page.waitForTimeout(400)
/* Sceneビューのエディタカメラ: プレイヤー越しに序盤の障害物が読める構図 */
await page.evaluate(() => {
  const e = window.__engine
  e.camera.position.set(10, 6, -10)
  e.orbit?.target.set(2, 0.5, 30)
})
await page.waitForTimeout(400)
await page.screenshot({ path: `${OUT}/cube06-e05-level.png` })
const e05 = await page.evaluate(() => {
  const ns = Object.values(window.__store.getState().scene.nodes)
  return { obstacles: ns.filter((n) => n.tag === 'Obstacle').length, groundScale: ns.find((n) => n.name === 'Ground').transform.scale }
})
check(`E05: 6 obstacles on a 30x500 course`, e05.obstacles === 6 && e05.groundScale.z === 50)

/* ================= E06: GAME OVER + RESTART / E07-09: WIN ================= */
await page.evaluate(async ({ gmr, pm2, pc2, et }) => {
  const scene = await import('/src/types/scene.ts')
  const store = await import('/src/store/editorStore.ts')
  const acts = await import('/src/store/actions.ts')
  const S = () => store.useEditorStore.getState()
  const byName = (nm) => Object.values(S().scene.nodes).find((n) => n.name === nm)

  /* GameManager (空オブジェクト + スクリプト) */
  const mgr = store.makeEmptyNode('GameManager')
  mgr.components.push({ ...scene.defaultScript('GameManager'), props: { restartDelay: 1 }, code: gmr })
  S().execute(store.cmdAddObject([mgr], null))

  /* PlayerMovement/PlayerCollision をE06版へ更新 (落下判定 + EndGame呼び出し) */
  const player = byName('Player')
  const pmIdx = player.components.findIndex((c) => c.type === 'script' && c.name === 'PlayerMovement')
  S().execute(store.cmdPatchComponent(player.id, pmIdx, {}, { code: pm2 }, 'Edit Script'))
  const pcIdx = player.components.findIndex((c) => c.type === 'script' && c.name === 'PlayerCollision')
  S().execute(store.cmdPatchComponent(player.id, pcIdx, {}, { code: pc2 }, 'Edit Script'))

  /* EndTrigger: Mesh Renderer OFF + Is Trigger (動画E09と同じ作り方) */
  const trig = store.makePrimitiveNode('box')
  trig.name = 'EndTrigger'
  trig.transform.position = { x: 0, y: 1.5, z: 476 }
  trig.transform.scale = { x: 30, y: 4, z: 12 }
  const meshIdx = trig.components.findIndex((c) => c.type === 'mesh')
  trig.components[meshIdx] = { ...trig.components[meshIdx], enabled: false }
  trig.components.push({ ...scene.defaultCollider('box'), isTrigger: true })
  trig.components.push({ ...scene.defaultScript('EndTrigger'), props: {}, code: et })
  S().execute(store.cmdAddObject([trig], null))

  /* LEVEL COMPLETE UI (初期非アクティブ — 動画E08と同じ) */
  acts.createUIText(null)
  const text = Object.values(S().scene.nodes).find((n) => n.name === 'Text')
  S().execute(store.cmdPatchNode(text.id, { name: 'Text' }, { name: 'LevelComplete', visible: false }, 'Setup UI'))
  const ui = S().scene.nodes[text.id].components.findIndex((c) => c.type === 'uitext')
  S().execute(store.cmdPatchComponent(text.id, ui, {}, { text: 'LEVEL\nCOMPLETE', fontSize: 44, anchorX: 'center', anchorY: 'middle', offsetY: -40 }, 'Setup UI'))

  S().select([trig.id])
}, { gmr: GAME_MANAGER, pm2: PLAYER_MOVEMENT_V2, pc2: PLAYER_COLLISION_V2, et: END_TRIGGER })
await page.waitForTimeout(400)
/* エディタカメラをEndTriggerへ寄せて撮影 (Mesh Renderer OFFでも緑のトリガー枠が見える) */
await page.evaluate(() => {
  const e = window.__engine
  e.camera.position.set(24, 14, 448)
  e.orbit?.target.set(0, 1, 476)
})
await page.waitForTimeout(400)
await page.screenshot({ path: `${OUT}/cube07-e09-endtrigger.png` })
const trigState = await nodeByName('EndTrigger')
check('E09: EndTrigger mesh renderer disabled + trigger collider',
  trigState.components.some((c) => c.type === 'mesh' && c.enabled === false) &&
  trigState.components.some((c) => c.type === 'collider' && c.isTrigger))

/* GameManagerのスクリプトエディタを開いて撮影 */
await page.evaluate(() => {
  const st = window.__store.getState()
  const mgr = Object.values(st.scene.nodes).find((n) => n.name === 'GameManager')
  st.select([mgr.id])
})
await page.waitForTimeout(300)
await page.getByText('Open Script Editor').click()
await page.waitForTimeout(400)
await page.screenshot({ path: `${OUT}/cube08-e06-gamemanager.png` })
await page.getByRole('button', { name: 'Cancel' }).click().catch(async () => {
  await page.keyboard.press('Escape')
})
await page.waitForTimeout(300)

/* ---------------- 通し再生: 落下死 → 自動リスタート → 左レーン攻略 → LEVEL COMPLETE ---------------- */
await page.getByTitle('Play', { exact: true }).click()
await page.waitForTimeout(900)

/* E06検証: わざと左へ切って落下 */
await page.keyboard.down('a')
await page.waitForTimeout(160)
await page.keyboard.up('a')
await page.waitForTimeout(700)
await page.screenshot({ path: `${OUT}/cube09-e06-falling.png` })

/* Game Over → Invoke(1s) → restartScene を監視 (zが伸びた後に0付近へ戻れば = LoadScene相当) */
let sawGameOver = false
let sawRestart = false
let maxZ = 0
const tDeath = Date.now()
while (Date.now() - tDeath < 7000) {
  const s = await page.evaluate(() => {
    const st = window.__store.getState()
    const p = Object.values(st.scene.nodes).find((n) => n.name === 'Player')
    return { z: p.transform.position.z, y: p.transform.position.y, mode: st.mode, logs: st.logs.map((l) => l.message) }
  })
  if (s.logs.some((m) => m.includes('Game Over!'))) sawGameOver = true
  maxZ = Math.max(maxZ, s.z)
  if (sawGameOver && s.mode === 'play' && s.z < maxZ - 5 && s.z < 15 && s.y > -0.5) {
    sawRestart = true
    break
  }
  await page.waitForTimeout(150)
}
check("E06: fell off edge → 'Game Over!' (console kept across restart)", sawGameOver)
check('E06: scene auto-restarted while playing (LoadScene equivalent)', sawRestart)

/* 左レーン(x≈-4)を維持して完走するステアリング */
const t0 = Date.now()
let midShot = false
let won = false
while (Date.now() - t0 < 30000) {
  const s = await page.evaluate(() => {
    const st = window.__store.getState()
    const ns = Object.values(st.scene.nodes)
    const p = ns.find((n) => n.name === 'Player')
    const done = ns.find((n) => n.name === 'LevelComplete')?.visible
    const v = window.__engine.physicsWorld.getLinearVelocity(p.id)
    return { x: p.transform.position.x, y: p.transform.position.y, z: p.transform.position.z, vx: v.x, done }
  })
  if (s.done) { won = true; break }
  if (s.y < -0.5) { await page.waitForTimeout(400); continue } // 万一の落下 → リスタート待ち
  if (!midShot && s.z > 190) {
    midShot = true
    await page.screenshot({ path: `${OUT}/cube10-run-dodging.png` })
  }
  /* bang-bang制御: x∈[-5.5,-2.5]を維持 */
  if (s.x > -2.5 && s.vx > -7) { await page.keyboard.down('a'); await page.waitForTimeout(40); await page.keyboard.up('a') }
  else if (s.x < -5.5 && s.vx < 7) { await page.keyboard.down('d'); await page.waitForTimeout(40); await page.keyboard.up('d') }
  await page.waitForTimeout(70)
}
await page.waitForTimeout(400)
const winState = await page.evaluate(() => {
  const st = window.__store.getState()
  const ns = Object.values(st.scene.nodes)
  return {
    complete: ns.find((n) => n.name === 'LevelComplete')?.visible,
    logs: st.logs.map((l) => l.message),
    errs: st.logs.filter((l) => l.level === 'error').map((l) => l.message),
  }
})
check("E09: EndTrigger hit → 'Hit' log", winState.logs.some((m) => m === '[EndTrigger] Hit'))
check('E07-09: LEVEL COMPLETE shown (CompleteLevel → SetActive)', won && winState.complete === true)
const uiVisible = await page.getByText('LEVEL', { exact: false }).first().isVisible().catch(() => false)
check('LEVEL COMPLETE rendered in Game view', uiVisible)
check('no script errors during play', winState.errs.length === 0)
await page.screenshot({ path: `${OUT}/cube11-level-complete.png` })

/* ---------------- ⏹ 停止 → 復元 ---------------- */
await page.getByTitle('Stop', { exact: true }).click()
await page.waitForTimeout(600)
const restored = await page.evaluate(() => {
  const st = window.__store.getState()
  const ns = Object.values(st.scene.nodes)
  const p = ns.find((n) => n.name === 'Player')
  return {
    playerPos: { ...p.transform.position },
    movementEnabled: p.components.find((c) => c.type === 'script' && c.name === 'PlayerMovement')?.enabled !== false,
    completeHidden: ns.find((n) => n.name === 'LevelComplete')?.visible === false,
    obstacles: ns.filter((n) => n.tag === 'Obstacle').every((n) => Math.abs(n.transform.position.y - 0.5) < 1e-9),
  }
})
check('Stop: player/obstacles/UI all restored', Math.abs(restored.playerPos.z) < 1e-9 && restored.movementEnabled && restored.completeHidden && restored.obstacles)
await page.getByText('Scene', { exact: true }).first().click()
await page.waitForTimeout(300)
await page.evaluate(() => {
  const e = window.__engine
  e.camera.position.set(14, 9, -14)
  e.orbit?.target.set(0, 1, 20)
})
await page.waitForTimeout(300)
await page.screenshot({ path: `${OUT}/cube12-restored.png` })

console.log('page errors:', errors.length === 0 ? 'none' : errors)
await browser.close()
