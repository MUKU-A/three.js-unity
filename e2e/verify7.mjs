/* 実走検証 7: スクリプト (MonoBehaviour相当) / 物理 (Rapier) / マテリアルマップ (D-025/D-026) */
import { chromium } from 'playwright-core'
const SCRATCH = new URL('./out', import.meta.url).pathname
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const check = (label, cond) => console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}`)

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)

/* ---------- 1. スクリプト: デフォルトテンプレート (Y回転) ---------- */
await page.evaluate(async () => {
  const acts = await import('/src/store/actions.ts')
  acts.createPrimitive('box', null)
})
await page.waitForTimeout(300)
// Add Component → New Script
await page.getByText('Add Component', { exact: true }).click()
await page.locator('.u-menu-item', { hasText: 'New Script' }).click()
await page.waitForTimeout(300)
check('Script section appears', (await page.getByText('NewBehaviour (Script)').count()) > 0)
check('props auto-exposed in Inspector (Speed)', (await page.getByText('Speed', { exact: true }).count()) > 0)

await page.getByTitle('Play', { exact: true }).click()
await page.waitForTimeout(1200)
const scriptResult = await page.evaluate(() => {
  const st = window.__store.getState()
  const cube = Object.values(st.scene.nodes).find((n) => n.name === 'Cube')
  return {
    rotY: cube.transform.rotation.y,
    log: st.logs.some((l) => l.message.includes('[NewBehaviour] Cube started')),
    mode: st.mode,
  }
})
check(`script onUpdate rotates cube (rotY=${scriptResult.rotY.toFixed(1)})`, scriptResult.rotY > 30)
check('script onStart log in console', scriptResult.log)
await page.getByTitle('Stop', { exact: true }).click()
await page.waitForTimeout(400)
const rotAfterStop = await page.evaluate(() => {
  const st = window.__store.getState()
  return Object.values(st.scene.nodes).find((n) => n.name === 'Cube').transform.rotation.y
})
check('stop restores rotation', rotAfterStop === 0)

/* ---------- 2. スクリプトエディタ: props変更が反映される ---------- */
await page.evaluate(() => {
  const st = window.__store.getState()
  const cube = Object.values(st.scene.nodes).find((n) => n.name === 'Cube')
  st.select([cube.id])
})
await page.getByText('Open Script Editor', { exact: true }).click()
await page.waitForTimeout(300)
const ta = page.locator('textarea')
check('script editor modal opens', (await ta.count()) === 1)
await ta.fill(`const props = { speed: 10, jump: true, label: 'hi' }
function onUpdate(ctx, dt) { ctx.node.position.x += ctx.props.speed * dt }`)
await page.getByText('Save', { exact: true }).last().click()
await page.waitForTimeout(300)
const propsAfter = await page.evaluate(() => {
  const st = window.__store.getState()
  const cube = Object.values(st.scene.nodes).find((n) => n.name === 'Cube')
  return cube.components.find((c) => c.type === 'script').props
})
/* Unity同様、既存キーは編集済みの値(90)を保持し、新キーは宣言のデフォルトが入る */
check('saved script re-extracts props (speed kept=90, new jump/label)', propsAfter.speed === 90 && propsAfter.jump === true && propsAfter.label === 'hi')
check('boolean/string props render', (await page.getByText('Jump', { exact: true }).count()) > 0 && (await page.getByText('Label', { exact: true }).count()) > 0)

/* ---------- 3. 物理: 落下と復元 ---------- */
await page.evaluate(async () => {
  const scene = await import('/src/types/scene.ts')
  const store = await import('/src/store/editorStore.ts')
  const st = store.useEditorStore.getState()
  // 地面: Plane + BoxCollider(10x0.2x10)
  const ground = store.makePrimitiveNode('plane')
  ground.name = 'Ground'
  ground.components.push({ ...scene.defaultCollider('box'), size: { x: 10, y: 0.2, z: 10 }, center: { x: 0, y: -0.1, z: 0 } })
  st.execute(store.cmdAddObject([ground], null))
  // 落下キューブ: y=4, Rigidbody + BoxCollider
  const faller = store.makePrimitiveNode('box')
  faller.name = 'Faller'
  faller.transform.position = { x: 0.5, y: 4, z: 0.5 }
  faller.components.push(scene.defaultRigidbody())
  faller.components.push(scene.defaultCollider('box'))
  st.execute(store.cmdAddObject([faller], null))
  // 回転スクリプトのCubeは物理と干渉しないよう遠くへ
  const cube = Object.values(st.scene.nodes).find((n) => n.name === 'Cube')
  st.transientSetTransform(cube.id, { position: { x: 30, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } })
})
await page.waitForTimeout(300)
check('collider gizmo (green wireframe) on selected', await page.evaluate(() => {
  const st = window.__store.getState()
  const id = st.selection[st.selection.length - 1]
  let found = false
  window.__engine.objectMap.get(id)?.traverse((o) => {
    if (o.isLineSegments && o.material?.color?.getHexString?.() === '74f274') found = true
  })
  return found
}))

await page.getByTitle('Play', { exact: true }).click()
await page.waitForTimeout(2500) // Rapier WASM初期化 + シミュレーション
const phys = await page.evaluate(() => {
  const st = window.__store.getState()
  const f = Object.values(st.scene.nodes).find((n) => n.name === 'Faller')
  return { y: f.transform.position.y, logs: st.logs.map((l) => l.message).filter((m) => m.includes('Physics')) }
})
check(`physics: cube fell from y=4 (now y=${phys.y.toFixed(2)})`, phys.y < 3)
check(`physics: rests on ground, not through it (y=${phys.y.toFixed(2)})`, phys.y > 0.3)
check('physics world log', phys.logs.length > 0)
await page.screenshot({ path: `${SCRATCH}/shot-physics.png` })
await page.getByTitle('Stop', { exact: true }).click()
await page.waitForTimeout(400)
const yAfter = await page.evaluate(() => {
  const st = window.__store.getState()
  return Object.values(st.scene.nodes).find((n) => n.name === 'Faller').transform.position.y
})
check('stop restores faller to y=4', yAfter === 4)

/* ---------- 4. マテリアル: Normal Map / Tiling ---------- */
await page.evaluate(async () => {
  const assets = await import('/src/engine/assets.ts')
  // 2x2 px PNG (青一色) を生成して法線マップに使う
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 2
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#8080ff'
  ctx.fillRect(0, 0, 2, 2)
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'))
  const meta = await assets.importAsset('flat-normal.png', await blob.arrayBuffer())
  const st = window.__store.getState()
  st.setAssets([...st.assets, meta])
  const faller = Object.values(st.scene.nodes).find((n) => n.name === 'Faller')
  const idx = faller.components.findIndex((c) => c.type === 'material')
  st.transientPatchComponent(faller.id, idx, { normalMapAssetId: meta.id, tiling: { x: 3, y: 2 }, offset: { x: 0.5, y: 0 }, textureAssetId: meta.id })
  st.select([faller.id])
})
await page.waitForTimeout(400)
const matCheck = await page.evaluate(() => {
  const st = window.__store.getState()
  const faller = Object.values(st.scene.nodes).find((n) => n.name === 'Faller')
  let r = null
  window.__engine.objectMap.get(faller.id).traverse((o) => {
    if (o.isMesh && !o.userData.pickProxy) {
      r = {
        hasNormal: !!o.material.normalMap,
        repeat: o.material.map ? [o.material.map.repeat.x, o.material.map.repeat.y] : null,
        offset: o.material.map ? [o.material.map.offset.x, o.material.map.offset.y] : null,
      }
    }
  })
  return r
})
check('normalMap assigned to three material', matCheck?.hasNormal === true)
check(`tiling 3x2 applied (${matCheck?.repeat})`, matCheck?.repeat?.[0] === 3 && matCheck?.repeat?.[1] === 2)
check(`offset 0.5,0 applied`, matCheck?.offset?.[0] === 0.5)
check('Normal Map row in Inspector', (await page.getByText('Normal Map', { exact: true }).count()) > 0)
check('Tiling row in Inspector', (await page.getByText('Tiling', { exact: true }).count()) > 0)

/* ---------- 5. シリアライズ往復 (script/physics/маterialマップ込み) ---------- */
const rt = await page.evaluate(async () => {
  const mod = await import('/src/engine/serialization.ts')
  const json = JSON.stringify(mod.serializeScene())
  const before = JSON.stringify(window.__store.getState().scene)
  await mod.importSceneFromJson(json)
  return { same: before === JSON.stringify(window.__store.getState().scene) }
})
check('roundtrip with script+physics+maps identical', rt.same)

console.log('page errors:', errors.length === 0 ? 'none' : errors)
await browser.close()
