/* 実走検証 12: 物理ジョイント — Hinge振り子 / Fixed同伴落下 / Springワールド係留 (D-033) */
import { chromium } from 'playwright-core'
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const check = (label, cond) => console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}`)

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)

await page.evaluate(async () => {
  const scene = await import('/src/types/scene.ts')
  const store = await import('/src/store/editorStore.ts')
  const st = store.useEditorStore.getState()

  /* Hinge: 静的アンカー + 振り子ボール */
  const anchor = store.makePrimitiveNode('box')
  anchor.name = 'AnchorBox'
  anchor.transform.position = { x: 0, y: 6, z: 0 }
  anchor.components.push(scene.defaultCollider('box'))
  st.execute(store.cmdAddObject([anchor], null))

  const ball = store.makePrimitiveNode('sphere')
  ball.name = 'PendulumBall'
  ball.transform.position = { x: 2, y: 6, z: 0 }
  ball.components.push(scene.defaultRigidbody())
  ball.components.push(scene.defaultCollider('sphere'))
  st.execute(store.cmdAddObject([ball], null))
  const ballId = ball.id
  const fresh1 = store.useEditorStore.getState()
  fresh1.execute(
    store.cmdAddComponent(ballId, {
      ...scene.defaultJoint('hinge'),
      connectedNodeId: anchor.id,
      anchor: { x: -2, y: 0, z: 0 },
      connectedAnchor: { x: 0, y: 0, z: 0 },
      axis: { x: 0, y: 0, z: 1 },
    }),
  )

  /* Fixed: 2箱が相対位置を保ったまま落下 */
  const boxA = store.makePrimitiveNode('box')
  boxA.name = 'FixA'
  boxA.transform.position = { x: 6, y: 5, z: 0 }
  boxA.components.push(scene.defaultRigidbody())
  boxA.components.push(scene.defaultCollider('box'))
  st.execute(store.cmdAddObject([boxA], null))
  const boxB = store.makePrimitiveNode('box')
  boxB.name = 'FixB'
  boxB.transform.position = { x: 6, y: 7, z: 0 }
  boxB.components.push(scene.defaultRigidbody())
  boxB.components.push(scene.defaultCollider('box'))
  boxB.components.push({
    ...scene.defaultJoint('fixed'),
    connectedNodeId: boxA.id,
    anchor: { x: 0, y: 0, z: 0 },
    connectedAnchor: { x: 0, y: 2, z: 0 },
  })
  st.execute(store.cmdAddObject([boxB], null))

  /* Spring: ワールド係留 (connected=None) */
  const springBall = store.makePrimitiveNode('sphere')
  springBall.name = 'SpringBall'
  springBall.transform.position = { x: -5, y: 6, z: 0 }
  springBall.components.push(scene.defaultRigidbody())
  springBall.components.push(scene.defaultCollider('sphere'))
  springBall.components.push({
    ...scene.defaultJoint('spring'),
    connectedNodeId: null,
    anchor: { x: 0, y: 2, z: 0 },
    stiffness: 120,
    damping: 2,
    restLength: 2,
  })
  st.execute(store.cmdAddObject([springBall], null))
  st.select([])
})
await page.waitForTimeout(300)

/* Inspector 表示確認 */
await page.evaluate(() => {
  const st = window.__store.getState()
  const b = Object.values(st.scene.nodes).find((n) => n.name === 'PendulumBall')
  st.select([b.id])
})
await page.waitForTimeout(250)
check('Hinge Joint section in Inspector', (await page.getByText('Hinge Joint', { exact: true }).count()) > 0)
check('Connected Body row', (await page.getByText('Connected Body', { exact: true }).count()) > 0)

/* 再生して挙動を実測 */
await page.getByTitle('Play', { exact: true }).click()
await page.waitForTimeout(2600) // WASM init + 1.5s+ シミュレーション

const result = await page.evaluate(() => {
  const st = window.__store.getState()
  const get = (name) => Object.values(st.scene.nodes).find((n) => n.name === name)?.transform.position
  const logs = st.logs.map((l) => l.message).filter((m) => m.includes('joint'))
  return { ball: get('PendulumBall'), fixA: get('FixA'), fixB: get('FixB'), spring: get('SpringBall'), logs }
})
const dist = Math.hypot(result.ball.x - 0, result.ball.y - 6, result.ball.z - 0)
check(`hinge: pendulum swung down (y=${result.ball.y.toFixed(2)} < 5.6)`, result.ball.y < 5.6)
check(`hinge: keeps 2m from anchor (d=${dist.toFixed(2)})`, Math.abs(dist - 2) < 0.4)
const rel = result.fixB.y - result.fixA.y
check(`fixed: falling together, offset kept (Δy=${rel.toFixed(2)}≈2)`, result.fixA.y < 3 && Math.abs(rel - 2) < 0.25)
check(`spring: anchored to world, not free-falling (y=${result.spring.y.toFixed(2)} > 2)`, result.spring.y > 2)
check('physics log mentions joints', result.logs.some((m) => m.includes('3 joint')))

/* 停止で復元 */
await page.getByTitle('Stop', { exact: true }).click()
await page.waitForTimeout(400)
const restored = await page.evaluate(() => {
  const st = window.__store.getState()
  const b = Object.values(st.scene.nodes).find((n) => n.name === 'PendulumBall')
  return b.transform.position
})
check('stop restores pendulum to (2,6,0)', restored.x === 2 && restored.y === 6)

console.log('page errors:', errors.length === 0 ? 'none' : errors)
await browser.close()
