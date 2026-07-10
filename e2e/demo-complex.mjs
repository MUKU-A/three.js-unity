/* 複合デモテスト: 1シーンで全サブシステムを同時稼働させ、要所を撮影する。
   - Prefab v2 (Crate x3、1つに色オーバーライド、プレハブバー)
   - 物理 (クレートのスタック崩し、Hinge振り子、トリガー収集)
   - スクリプト (回転、コルーチンでのInstantiate、onTriggerEnterでdestroy)
   - GLB + テクスチャ/ノーマルマップ/タイリング、スポットライト+影
   - ▶Game自動切替 → 実測アサーション → ⏹完全復元 */
import { chromium } from 'playwright-core'
const OUT = new URL('./out', import.meta.url).pathname
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const check = (label, cond) => console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}`)

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)

/* ---------- アセット (GLB + テクスチャ) ---------- */
await page.locator('input[type=file][accept*="glb"]').setInputFiles([`${OUT}/test-model.glb`, `${OUT}/test-tex.png`])
await page.waitForTimeout(1000)

/* ---------- シーン構築 ---------- */
const ids = await page.evaluate(async () => {
  const scene = await import('/src/types/scene.ts')
  const store = await import('/src/store/editorStore.ts')
  const acts = await import('/src/store/actions.ts')
  const S = () => store.useEditorStore.getState()

  /* カメラを引きの構図に */
  const cam = Object.values(S().scene.nodes).find((n) => n.name === 'Main Camera')
  S().transientSetTransform(cam.id, { position: { x: 0, y: 4.2, z: -13 }, rotation: { x: 12, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } })

  /* 地面 */
  const ground = store.makePrimitiveNode('plane')
  ground.name = 'Ground'
  ground.components.push({ ...scene.defaultCollider('box'), size: { x: 10, y: 0.2, z: 10 }, center: { x: 0, y: -0.1, z: 0 } })
  const gmat = ground.components.find((c) => c.type === 'material')
  gmat.color = '#9aa5ad'
  S().execute(store.cmdAddObject([ground], null))

  /* スポットライト (影) */
  const spot = store.makeLightNode('spot')
  spot.transform.position = { x: 0, y: 8, z: -2 }
  spot.transform.rotation = { x: 90, y: 0, z: 0 }
  const sl = spot.components[0]
  sl.intensity = 250
  sl.range = 25
  sl.spotAngle = 70
  sl.color = '#fff2d8'
  S().execute(store.cmdAddObject([spot], null))

  /* Crate プレハブ → 3インスタンスのスタック (1つは色オーバーライド) */
  acts.createPrimitive('box', null)
  const crateSrc = S().selection[0]
  S().execute(store.cmdPatchNode(crateSrc, { name: 'Cube' }, { name: 'Crate' }, 'Rename'))
  const cm = S().scene.nodes[crateSrc].components.findIndex((c) => c.type === 'material')
  S().execute(store.cmdPatchComponent(crateSrc, cm, { color: '#ffffff' }, { color: '#c8965a' }, 'Set Color'))
  S().execute(store.cmdAddComponent(crateSrc, scene.defaultRigidbody()))
  S().execute(store.cmdAddComponent(crateSrc, scene.defaultCollider('box')))
  acts.createPrefabFromNode(crateSrc)
  const prefabId = S().scene.nodes[crateSrc].prefabId
  S().transientSetTransform(crateSrc, { position: { x: 0, y: 0.5, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } })
  /* 意図的に傾いた塔 (B+Cの合成重心がAの支持面外 → 決定論的に崩れる) */
  const crateB = acts.instantiatePrefab(prefabId, { x: 0.45, y: 1.55, z: 0.06 })
  const crateC = acts.instantiatePrefab(prefabId, { x: 0.9, y: 2.6, z: -0.08 })
  /* crateC に色オーバーライド (赤) */
  const cIdx = S().scene.nodes[crateC].components.findIndex((c) => c.type === 'material')
  S().execute(store.cmdPatchComponent(crateC, cIdx, { color: '#c8965a' }, { color: '#d84a4a' }, 'Set Color'))

  /* Hinge 振り子 */
  const anchor = store.makePrimitiveNode('box')
  anchor.name = 'PendulumAnchor'
  anchor.transform.position = { x: 4.2, y: 6, z: 0 }
  anchor.transform.scale = { x: 0.4, y: 0.4, z: 0.4 }
  anchor.components.push(scene.defaultCollider('box'))
  S().execute(store.cmdAddObject([anchor], null))
  const ball = store.makePrimitiveNode('sphere')
  ball.name = 'WreckingBall'
  ball.transform.position = { x: 6.7, y: 6, z: 0 }
  const bm = ball.components.find((c) => c.type === 'material')
  bm.color = '#5a7ec8'
  bm.metalness = 0.7
  bm.roughness = 0.25
  ball.components.push(scene.defaultRigidbody())
  ball.components.push(scene.defaultCollider('sphere'))
  ball.components.push({ ...scene.defaultJoint('hinge'), connectedNodeId: anchor.id, anchor: { x: -2.5, y: 0, z: 0 }, connectedAnchor: { x: 0, y: 0, z: 0 }, axis: { x: 0, y: 0, z: 1 } })
  S().execute(store.cmdAddObject([ball], null))

  /* GLBノット + テクスチャ/ノーマル/タイリング + 回転スクリプト */
  const glb = S().assets.find((a) => a.type === 'glb')
  const tex = S().assets.find((a) => a.type === 'texture')
  const knot = store.makeGlbNode(glb.id, glb.name)
  knot.name = 'ShowpieceKnot'
  knot.transform.position = { x: -3.6, y: 1.4, z: -1 }
  S().execute(store.cmdAddObject([knot], null))
  /* base mapはテストテクスチャが暗色のためノーマルマップのみ (テクスチャ経路はこれで通る) */
  S().execute(store.cmdAddComponent(knot.id, { ...scene.defaultMaterial(), color: '#7fd4ff', metalness: 0.6, roughness: 0.3, normalMapAssetId: tex.id, tiling: { x: 3, y: 3 } }))
  S().execute(store.cmdAddComponent(knot.id, { ...scene.defaultScript('Spinner'), code: 'function onUpdate(ctx, dt) { ctx.node.rotation.y += 45 * dt }', props: {} }))

  /* コイン (トリガー収集) + 落下ボール */
  const coin = store.makePrimitiveNode('torus')
  coin.name = 'Coin'
  coin.transform.position = { x: -1.6, y: 0.7, z: -2.5 }
  const coinMat = coin.components.find((c) => c.type === 'material')
  coinMat.color = '#ffd34d'
  coinMat.metalness = 0.9
  coinMat.roughness = 0.2
  coin.components.push({ ...scene.defaultCollider('box'), size: { x: 1.4, y: 1.4, z: 1.4 }, isTrigger: true })
  coin.components.push({
    ...scene.defaultScript('Collectible'),
    code: `function onUpdate(ctx, dt) { ctx.node.rotation.y += 120 * dt }
function onTriggerEnter(ctx, other) { ctx.log('Coin collected by ' + other.name + '!'); ctx.destroy() }`,
    props: {},
  })
  S().execute(store.cmdAddObject([coin], null))
  const dropper = store.makePrimitiveNode('sphere')
  dropper.name = 'DropBall'
  dropper.transform.position = { x: -1.6, y: 6, z: -2.5 }
  dropper.components.push(scene.defaultRigidbody())
  dropper.components.push(scene.defaultCollider('sphere'))
  S().execute(store.cmdAddObject([dropper], null))

  /* GameManager: コルーチンで1秒後にクレートをInstantiate */
  const mgr = store.makeEmptyNode('GameManager')
  mgr.components.push({
    ...scene.defaultScript('Spawner'),
    code: `function onStart(ctx) {
  ctx.startCoroutine(function* () {
    yield 1.0
    const c = ctx.instantiate('Crate', { x: 0.5, y: 7, z: 0.3 })
    ctx.log('Spawned ' + c.name + ' from coroutine')
  })
}`,
    props: {},
  })
  S().execute(store.cmdAddObject([mgr], null))

  S().select([crateC])
  return { crateSrc, crateB, crateC, prefabId, coinId: coin.id, ballId: ball.id }
})
await page.waitForTimeout(600)

/* エディタカメラを構図良く */
await page.evaluate(() => {
  const e = window.__engine
  e.camera.position.set(9.5, 6.5, -10.5)
  e.orbit?.target.set(0.5, 1.8, 0)
})
await page.waitForTimeout(500)

/* ---------- ① 編集モード全景 (赤クレート選択: プレハブバー/コライダー緑枠/ギズモ) ---------- */
await page.screenshot({ path: `${OUT}/demo1-edit.png` })
const bar = await page.getByText(/Overrides \(\d+\)/).textContent().catch(() => null)
check(`prefab bar visible on overridden instance (${bar})`, /Overrides \([1-9]/.test(bar ?? ''))

/* ---------- ② Inspector 拡大 (プレハブバー + Rigidbody/Collider) ---------- */
const inspectorBox = await page.locator('.dv-groupview', { has: page.getByText('Add Component') }).boundingBox()
if (inspectorBox) await page.screenshot({ path: `${OUT}/demo2-inspector.png`, clip: inspectorBox })

/* ---------- ▶ 再生 ---------- */
const before = await page.evaluate(() => JSON.stringify(Object.values(window.__store.getState().scene.nodes).map((n) => [n.name, n.transform.position])))
await page.getByTitle('Play', { exact: true }).click()

/* 振り子は振動するため点時刻のy検証は位相依存 → 再生全体からyをサンプリングして振幅を測る */
const ballSamples = []
const sampleBall = async () => {
  const p = await page.evaluate(() => {
    const st = window.__store.getState()
    const n = Object.values(st.scene.nodes).find((x) => x.name === 'WreckingBall')
    return n ? { ...n.transform.position } : null
  })
  if (p) ballSamples.push(p)
}
for (let i = 0; i < 4; i++) { await page.waitForTimeout(225); await sampleBall() } // ~900ms: Rapier init + 初動
await page.screenshot({ path: `${OUT}/demo3-play-early.png` })

for (let i = 0; i < 10; i++) { await page.waitForTimeout(260); await sampleBall() } // ~2.6s: 沈静化 + spawn + 収集
/* Consoleタブを表示してログを見せる */
await page.getByText('Console', { exact: true }).first().click()
await page.waitForTimeout(400)
await page.screenshot({ path: `${OUT}/demo4-play-settled.png` })

const playState = await page.evaluate(() => {
  const st = window.__store.getState()
  const byName = (nm) => Object.values(st.scene.nodes).find((n) => n.name === nm)
  const names = Object.values(st.scene.nodes).map((n) => n.name)
  return {
    crateCY: byName('Crate (2)')?.transform.position.y,
    ballPos: byName('WreckingBall')?.transform.position,
    coinExists: names.includes('Coin'),
    spawned: names.includes('Crate (3)'),
    knotRotY: byName('ShowpieceKnot')?.transform.rotation.y,
    logs: st.logs.map((l) => l.message),
  }
})
check(`crates toppled by physics (top crate y=${playState.crateCY?.toFixed(2)} < 2.0)`, (playState.crateCY ?? 9) < 2.0)
const ys = ballSamples.map((p) => p.y)
const amp = Math.max(...ys) - Math.min(...ys)
const last = ballSamples[ballSamples.length - 1]
const balld = Math.hypot(last.x - 4.2, last.y - 6, last.z)
check(`pendulum swinging on hinge (y amplitude=${amp.toFixed(2)} > 1.2, |anchor dist|=${balld.toFixed(2)}≈2.5)`, amp > 1.2 && Math.abs(balld - 2.5) < 0.4)
check('coin collected via onTriggerEnter + destroy', !playState.coinExists && playState.logs.some((m) => m.includes('Coin collected by DropBall')))
check('coroutine spawned Crate (3) at 1s', playState.spawned && playState.logs.some((m) => m.includes('Spawned Crate (3)')))
check(`Spinner script rotating knot (rotY=${playState.knotRotY?.toFixed(0)}°)`, (playState.knotRotY ?? 0) > 60)

/* ---------- ⏹ 停止 → 完全復元 ---------- */
await page.getByTitle('Stop', { exact: true }).click()
await page.waitForTimeout(600)
await page.getByText('Scene', { exact: true }).first().click()
await page.waitForTimeout(400)
await page.screenshot({ path: `${OUT}/demo5-restored.png` })
const after = await page.evaluate(() => JSON.stringify(Object.values(window.__store.getState().scene.nodes).map((n) => [n.name, n.transform.position])))
check('stop restores every node exactly (coin back, spawn gone, stack rebuilt)', before === after)

console.log('page errors:', errors.length === 0 ? 'none' : errors)
await browser.close()
