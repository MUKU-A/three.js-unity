/* Unity公式チュートリアル「Roll-a-Ball (玉転がし)」を手順通りに再現するE2E。
   https://learn.unity.com/course/roll-a-ball (日本語: 「玉転がし」)
   Unit 1: Ground(Plane scale 2,1,2) + Player(Sphere y=0.5) + マテリアル
   Unit 2: Rigidbody + PlayerController (Input軸 → AddForce, speed=10)
   Unit 3: カメラ(0,10,-10 / 45°) + CameraController (offset + LateUpdate) + 壁4枚(±10, 0.5x2x20.5)
   Unit 4: PickUp (Cube 0.5倍, 45°回転, Rotatorスクリプト 15/30/45°/s) → プレハブ化 → 12個円形配置
   Unit 5: Tag "PickUp" + Is Trigger + Kinematic Rigidbody + OnTriggerEnter → SetActive(false)
   Unit 6: UI CountText/WinText + カウント + "You Win!"
   検証: 実キーボード入力で操縦して12個収集 → You Win! 表示 → ⏹で完全復元 */
import { chromium } from 'playwright-core'
const OUT = new URL('./out', import.meta.url).pathname
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const check = (label, cond) => console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}`)

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)

/* ---------- シーン構築 (チュートリアルの手順・数値に忠実) ---------- */
await page.evaluate(async () => {
  const scene = await import('/src/types/scene.ts')
  const store = await import('/src/store/editorStore.ts')
  const S = () => store.useEditorStore.getState()

  /* === Unit 1: Setting up the game === */
  /* GameObject > 3D Object > Plane → "Ground", Scale (2,1,2) [Unityと同じPlane=10x10なので20x20になる] */
  const ground = store.makePrimitiveNode('plane')
  ground.name = 'Ground'
  ground.transform.scale = { x: 2, y: 1, z: 2 }
  /* UnityのPlaneはMesh Collider内蔵 → 本エディタでは Box Collider を明示追加 (対応表に記載) */
  ground.components.push({ ...scene.defaultCollider('box'), size: { x: 10, y: 0.1, z: 10 }, center: { x: 0, y: -0.05, z: 0 } })
  const gm = ground.components.find((c) => c.type === 'material')
  gm.color = '#204066' /* "Background" マテリアル (紺) */
  S().execute(store.cmdAddObject([ground], null))

  /* GameObject > 3D Object > Sphere → "Player", Position (0, 0.5, 0) */
  const player = store.makePrimitiveNode('sphere')
  player.name = 'Player'
  player.transform.position = { x: 0, y: 0.5, z: 0 }
  /* === Unit 2: Add Rigidbody + Sphere Collider === */
  player.components.push(scene.defaultRigidbody())
  player.components.push(scene.defaultCollider('sphere'))
  /* PlayerController スクリプト (C#からJSへ、構造は1:1) */
  player.components.push({
    ...scene.defaultScript('PlayerController'),
    props: { speed: 10 },
    code: `const props = { speed: 10 }
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
}`,
  })
  S().execute(store.cmdAddObject([player], null))

  /* === Unit 3: Moving the Camera === */
  /* Main Camera: Position (0, 10, -10), Rotation (45, 0, 0) + CameraController */
  const cam = Object.values(S().scene.nodes).find((n) => n.name === 'Main Camera')
  S().execute(store.cmdPatchNode(cam.id, { transform: cam.transform }, {
    transform: { position: { x: 0, y: 10, z: -10 }, rotation: { x: 45, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
  }, 'Move Camera'))
  S().execute(store.cmdAddComponent(cam.id, {
    ...scene.defaultScript('CameraController'),
    props: {},
    code: `let player
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
}`,
  }))

  /* === Unit 3: Setting up the Play Area (壁4枚) === */
  const walls = store.makeEmptyNode('Walls')
  S().execute(store.cmdAddObject([walls], null))
  const mkWall = (name, pos, scale) => {
    const w = store.makePrimitiveNode('box')
    w.name = name
    w.transform.position = pos
    w.transform.scale = scale
    w.components.push(scene.defaultCollider('box')) /* Rigidbodyなし = 静的コライダー */
    S().execute(store.cmdAddObject([w], walls.id))
  }
  mkWall('West Wall', { x: -10, y: 0, z: 0 }, { x: 0.5, y: 2, z: 20.5 })
  mkWall('East Wall', { x: 10, y: 0, z: 0 }, { x: 0.5, y: 2, z: 20.5 })
  mkWall('North Wall', { x: 0, y: 0, z: 10 }, { x: 20.5, y: 2, z: 0.5 })
  mkWall('South Wall', { x: 0, y: 0, z: -10 }, { x: 20.5, y: 2, z: 0.5 })

  /* === Unit 4: Creating Collectibles === */
  /* Cube "PickUp": y=0.5, Rotation (45,45,45), Scale (0.5,0.5,0.5) */
  const pickup = store.makePrimitiveNode('box')
  pickup.name = 'PickUp'
  pickup.transform.position = { x: 0, y: 0.5, z: 0 }
  pickup.transform.rotation = { x: 45, y: 45, z: 45 }
  pickup.transform.scale = { x: 0.5, y: 0.5, z: 0.5 }
  const pm = pickup.components.find((c) => c.type === 'material')
  pm.color = '#ffd34d'
  pm.metalness = 0.3
  /* Rotator スクリプト: transform.Rotate(new Vector3(15, 30, 45) * Time.deltaTime) */
  pickup.components.push({
    ...scene.defaultScript('Rotator'),
    props: {},
    code: `function onUpdate(ctx, dt) {
  ctx.node.rotation.x += 15 * dt
  ctx.node.rotation.y += 30 * dt
  ctx.node.rotation.z += 45 * dt
}`,
  })
  /* === Unit 5: Tag "PickUp" + Is Trigger + Kinematic Rigidbody === */
  pickup.tag = 'PickUp'
  pickup.components.push({ ...scene.defaultCollider('box'), isTrigger: true })
  pickup.components.push({ ...scene.defaultRigidbody(), isKinematic: true })
  S().execute(store.cmdAddObject([pickup], null))
  return pickup.id
})
await page.waitForTimeout(300)

/* PickUpをプレハブ化 → "PickUps"空オブジェクトの下に12個円形配置 (チュートリアル手順) */
await page.evaluate(async () => {
  const store = await import('/src/store/editorStore.ts')
  const acts = await import('/src/store/actions.ts')
  const S = () => store.useEditorStore.getState()
  const src = Object.values(S().scene.nodes).find((n) => n.name === 'PickUp')
  acts.createPrefabFromNode(src.id)
  const prefabId = S().scene.nodes[src.id].prefabId

  const parent = store.makeEmptyNode('PickUps')
  S().execute(store.cmdAddObject([parent], null))
  S().execute(store.cmdReparent(src.id, parent.id, null))
  /* 12個を半径5の円に (1つ目=元のPickUpを角度0に移動、残り11個をPickUps配下へインスタンス化) */
  const R = 5
  S().transientSetTransform(src.id, { ...S().scene.nodes[src.id].transform, position: { x: R, y: 0.5, z: 0 } })
  for (let i = 1; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    acts.instantiatePrefab(prefabId, { x: Math.cos(a) * R, y: 0.5, z: Math.sin(a) * R }, parent.id)
  }

  /* === Unit 6: UI === */
  acts.createUIText(null)
  let text = Object.values(S().scene.nodes).find((n) => n.name === 'Text')
  S().execute(store.cmdPatchNode(text.id, { name: 'Text' }, { name: 'CountText' }, 'Rename'))
  const ci = S().scene.nodes[text.id].components.findIndex((c) => c.type === 'uitext')
  S().execute(store.cmdPatchComponent(text.id, ci, {}, { text: 'Count: 0', fontSize: 20 }, 'Set Text'))

  acts.createUIText(null)
  text = Object.values(S().scene.nodes).find((n) => n.name === 'Text')
  S().execute(store.cmdPatchNode(text.id, { name: 'Text' }, { name: 'WinText' }, 'Rename'))
  const wi = S().scene.nodes[text.id].components.findIndex((c) => c.type === 'uitext')
  S().execute(store.cmdPatchComponent(text.id, wi, {}, {
    text: 'You Win!', fontSize: 32, anchorX: 'center', anchorY: 'middle', offsetX: 0, offsetY: -60,
  }, 'Set Text'))

  /* 撮影用にPickUpを選択 (Inspector: Tag/Trigger/Kinematic/Rotator/プレハブバー) */
  const pu = Object.values(S().scene.nodes).find((n) => n.name === 'PickUp')
  S().select([pu.id])
})
await page.waitForTimeout(600)

/* ---------- 構造アサーション (チュートリアルの数値通りか) ---------- */
const built = await page.evaluate(() => {
  const st = window.__store.getState()
  const ns = Object.values(st.scene.nodes)
  const byName = (nm) => ns.find((n) => n.name === nm)
  const ground = byName('Ground')
  const player = byName('Player')
  const cam = byName('Main Camera')
  const walls = byName('Walls')
  const pickups = ns.filter((n) => n.tag === 'PickUp')
  return {
    groundScale: ground?.transform.scale,
    playerY: player?.transform.position.y,
    playerComps: player?.components.map((c) => c.type),
    speed: player?.components.find((c) => c.type === 'script')?.props.speed,
    camPos: cam?.transform.position,
    camRotX: cam?.transform.rotation.x,
    camHasScript: !!cam?.components.some((c) => c.type === 'script'),
    wallCount: walls?.childrenIds.length,
    pickupCount: pickups.length,
    pickupsChildren: byName('PickUps')?.childrenIds.length,
    rootStrays: st.scene.rootIds.filter((id) => st.scene.nodes[id]?.tag === 'PickUp').length,
    pickupsPrefab: pickups.every((n) => !!n.prefabId),
    pickupsTrigger: pickups.every((n) => n.components.some((c) => c.type === 'collider' && c.isTrigger)),
    pickupsKinematic: pickups.every((n) => n.components.some((c) => c.type === 'rigidbody' && c.isKinematic)),
    hasCountText: !!byName('CountText'),
    hasWinText: !!byName('WinText'),
  }
})
check('Unit1: Ground plane scale (2,1,2)', JSON.stringify(built.groundScale) === JSON.stringify({ x: 2, y: 1, z: 2 }))
check('Unit1: Player sphere at y=0.5', built.playerY === 0.5)
check(`Unit2: Player has Rigidbody+Collider+Script, speed=${built.speed}`, built.playerComps?.includes('rigidbody') && built.playerComps?.includes('collider') && built.speed === 10)
check('Unit3: Camera (0,10,-10) rot 45° + CameraController', built.camPos?.y === 10 && built.camPos?.z === -10 && built.camRotX === 45 && built.camHasScript)
check('Unit3: 4 walls under Walls', built.wallCount === 4)
check(`Unit4/5: 12 PickUp prefab instances (tag/trigger/kinematic)`, built.pickupCount === 12 && built.pickupsPrefab && built.pickupsTrigger && built.pickupsKinematic)
check('Unit4: all 12 under PickUps group, no root strays', built.pickupsChildren === 12 && built.rootStrays === 0)
check('Unit6: CountText + WinText', built.hasCountText && built.hasWinText)

/* ---------- ① 編集モード全景 ---------- */
await page.screenshot({ path: `${OUT}/rollaball1-scene.png` })

/* ---------- ▶ 再生 → 実キーボードで移動検証 ---------- */
await page.getByTitle('Play', { exact: true }).click()
await page.waitForTimeout(1200) // Rapier初期化 + onStart

/* Dキー(右)を1.2秒押しっぱなし → AddForceで加速するはず */
const before = await page.evaluate(() => {
  const st = window.__store.getState()
  const p = Object.values(st.scene.nodes).find((n) => n.name === 'Player')
  return { ...p.transform.position }
})
await page.keyboard.down('d')
await page.waitForTimeout(1200)
await page.keyboard.up('d')
const after = await page.evaluate(() => {
  const st = window.__store.getState()
  const ns = Object.values(st.scene.nodes)
  const p = ns.find((n) => n.name === 'Player')
  const c = ns.find((n) => n.name === 'Main Camera')
  return { p: { ...p.transform.position }, cam: { ...c.transform.position } }
})
check(`Unit2: getAxis+AddForce moves ball (+x ${(after.p.x - before.x).toFixed(2)}m)`, after.p.x - before.x > 0.4)
/* offset = カメラ(0,10,-10) - プレイヤー(0,0.5,0) = (0, 9.5, -10) [Unityと同じ計算] */
const camOff = { x: after.cam.x - after.p.x, y: after.cam.y - after.p.y, z: after.cam.z - after.p.z }
check(`Unit3: camera follows with offset (0,9.5,-10) → (${camOff.x.toFixed(2)},${camOff.y.toFixed(2)},${camOff.z.toFixed(2)})`,
  Math.abs(camOff.x) < 0.2 && Math.abs(camOff.y - 9.5) < 0.2 && Math.abs(camOff.z + 10) < 0.2)

/* ---------- ② 再生中 (最初の収集後) ---------- */
await page.waitForTimeout(300)
await page.screenshot({ path: `${OUT}/rollaball2-playing.png` })

/* ---------- キーボード操縦で12個収集 (ゲームとしてプレイ) ---------- */
const held = new Set()
const t0 = Date.now()
let lastCount = -1
let lastProgress = Date.now()
while (Date.now() - t0 < 120000) {
  const s = await page.evaluate(() => {
    const st = window.__store.getState()
    const ns = Object.values(st.scene.nodes)
    const p = ns.find((n) => n.name === 'Player')
    const pickups = ns.filter((n) => n.tag === 'PickUp' && n.visible).map((n) => ({ ...n.transform.position }))
    const countText = ns.find((n) => n.name === 'CountText')?.components.find((c) => c.type === 'uitext')?.text
    return { p: { ...p.transform.position }, pickups, countText }
  })
  if (s.pickups.length === 0) break
  const count = 12 - s.pickups.length
  if (count !== lastCount) {
    lastCount = count
    lastProgress = Date.now()
  }
  /* 12秒進展なし → velocity APIで軌道修正 (setLinearVelocityの実地検証を兼ねる) */
  if (Date.now() - lastProgress > 12000) {
    await page.evaluate(() => {
      const st = window.__store.getState()
      const ns = Object.values(st.scene.nodes)
      const p = ns.find((n) => n.name === 'Player')
      const pickups = ns.filter((n) => n.tag === 'PickUp' && n.visible)
      if (!pickups.length) return
      const pp = p.transform.position
      let best = pickups[0].transform.position
      let bd = Infinity
      for (const q of pickups) {
        const qp = q.transform.position
        const d = (qp.x - pp.x) ** 2 + (qp.z - pp.z) ** 2
        if (d < bd) { bd = d; best = qp }
      }
      const dx = best.x - pp.x
      const dz = best.z - pp.z
      const len = Math.hypot(dx, dz) || 1
      window.__engine.physicsWorld.setLinearVelocity(p.id, { x: (dx / len) * 6, y: 0, z: (dz / len) * 6 })
    })
    lastProgress = Date.now()
  }
  /* 最寄りのPickUpへ向けてWASDを切替 */
  let best = s.pickups[0]
  let bd = Infinity
  for (const q of s.pickups) {
    const d = (q.x - s.p.x) ** 2 + (q.z - s.p.z) ** 2
    if (d < bd) { bd = d; best = q }
  }
  const dx = best.x - s.p.x
  const dz = best.z - s.p.z
  const want = new Set()
  if (dx > 0.2) want.add('d')
  else if (dx < -0.2) want.add('a')
  if (dz > 0.2) want.add('w')
  else if (dz < -0.2) want.add('s')
  for (const k of [...held]) if (!want.has(k)) { await page.keyboard.up(k); held.delete(k) }
  for (const k of want) if (!held.has(k)) { await page.keyboard.down(k); held.add(k) }
  await page.waitForTimeout(120)
}
for (const k of held) await page.keyboard.up(k)
await page.waitForTimeout(400)

/* ---------- 勝利状態のアサーション + ③ You Win! ---------- */
const win = await page.evaluate(() => {
  const st = window.__store.getState()
  const ns = Object.values(st.scene.nodes)
  const countText = ns.find((n) => n.name === 'CountText')?.components.find((c) => c.type === 'uitext')?.text
  const winVisible = ns.find((n) => n.name === 'WinText')?.visible
  const activePickups = ns.filter((n) => n.tag === 'PickUp' && n.visible).length
  const errLogs = st.logs.filter((l) => l.level === 'error').map((l) => l.message)
  return { countText, winVisible, activePickups, errLogs }
})
check(`Unit5/6: all 12 collected (${win.countText}), pickups deactivated`, win.countText === 'Count: 12' && win.activePickups === 0)
check('Unit6: "You Win!" shown (WinText SetActive(true))', win.winVisible === true)
check('no script errors during play', win.errLogs.length === 0)
const winTextVisible = await page.getByText('You Win!').isVisible().catch(() => false)
check('You Win! rendered in Game view overlay', winTextVisible)
await page.screenshot({ path: `${OUT}/rollaball3-win.png` })

/* ---------- ⏹ 停止 → 完全復元 ---------- */
await page.getByTitle('Stop', { exact: true }).click()
await page.waitForTimeout(700)
const restored = await page.evaluate(() => {
  const st = window.__store.getState()
  const ns = Object.values(st.scene.nodes)
  const p = ns.find((n) => n.name === 'Player')
  const activePickups = ns.filter((n) => n.tag === 'PickUp' && n.visible).length
  const countText = ns.find((n) => n.name === 'CountText')?.components.find((c) => c.type === 'uitext')?.text
  const winVisible = ns.find((n) => n.name === 'WinText')?.visible
  return { playerPos: { ...p.transform.position }, activePickups, countText, winVisible, mode: st.mode }
})
check('Stop: player restored to (0,0.5,0)', Math.abs(restored.playerPos.x) < 1e-6 && Math.abs(restored.playerPos.y - 0.5) < 1e-6 && Math.abs(restored.playerPos.z) < 1e-6)
check('Stop: 12 pickups reactivated, CountText reset', restored.activePickups === 12 && restored.countText === 'Count: 0')
check('Stop: WinText back to editor state (visible)', restored.winVisible === true && restored.mode === 'edit')
await page.getByText('Scene', { exact: true }).first().click()
await page.waitForTimeout(400)
await page.screenshot({ path: `${OUT}/rollaball4-restored.png` })

console.log('collected in', ((Date.now() - t0) / 1000).toFixed(1) + 's')
console.log('page errors:', errors.length === 0 ? 'none' : errors)
await browser.close()
