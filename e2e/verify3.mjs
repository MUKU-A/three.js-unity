/* 実走検証 3: GLB/テクスチャインポート・配置、Add Component、Hierarchy DnD、リネーム、目玉トグル、マテリアル結線 */
import { chromium } from 'playwright-core'

const SCRATCH = new URL('./out', import.meta.url).pathname
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
const errors = []
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
const check = (label, cond) => console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}`)

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)

/* --- 1. GLB + PNG インポート --- */
await page.locator('input[type=file][accept*="glb"]').setInputFiles([`${SCRATCH}/test-model.glb`, `${SCRATCH}/test-tex.png`])
await page.waitForTimeout(1200)
let assets = await page.evaluate(() => window.__store.getState().assets.map((a) => `${a.type}:${a.name}`))
check('GLB imported', assets.includes('glb:test-model.glb'))
check('texture imported', assets.includes('texture:test-tex.png'))
check('asset tiles rendered', (await page.locator('[draggable="true"]', { has: page.locator('img,svg') }).count()) >= 2)

/* --- 2. GLBタイルをSceneビューへドラッグ → 配置 --- */
const tile = page.getByTitle(/test-model\.glb/)
const canvas = page.locator('canvas')
await tile.dragTo(canvas, { targetPosition: { x: 480, y: 300 } })
await page.waitForTimeout(800)
let nodes = await page.evaluate(() => Object.values(window.__store.getState().scene.nodes).map((n) => n.name))
check('GLB drop creates node', nodes.includes('test-model'))
const glbInfo = await page.evaluate(() => {
  const st = window.__store.getState()
  const id = Object.keys(st.scene.nodes).find((k) => st.scene.nodes[k].name === 'test-model')
  const obj = window.__engine.objectMap.get(id)
  let meshCount = 0
  obj?.traverse((o) => { if (o.isMesh && !o.userData.pickProxy) meshCount++ })
  return { meshCount, hasMeshComp: st.scene.nodes[id].components.some((c) => c.type === 'mesh' && c.assetId) }
})
check('GLB node has mesh component w/ assetId', glbInfo.hasMeshComp)
check('GLB instantiated as three meshes', glbInfo.meshCount >= 1)
await page.screenshot({ path: `${SCRATCH}/shot-glb.png` })

/* --- 3. Cube作成 → Material色変更が three に反映 --- */
await page.getByTitle('Create', { exact: true }).click()
await page.locator('.u-menu').last().getByText('3D Object', { exact: true }).hover()
await page.waitForTimeout(250)
await page.locator('.u-menu').last().getByText('Cube', { exact: true }).click()
await page.waitForTimeout(300)
const matResult = await page.evaluate(() => {
  const st = window.__store.getState()
  const id = st.selection[st.selection.length - 1]
  const idx = st.scene.nodes[id].components.findIndex((c) => c.type === 'material')
  // ColorRow相当の操作: commit経由
  st.transientPatchComponent(id, idx, { color: '#ff4400' })
  const obj = window.__engine.objectMap.get(id)
  let hex = ''
  obj.traverse((o) => { if (o.isMesh && !o.userData.pickProxy) hex = '#' + o.material.color.getHexString() })
  return hex
})
check('material color SSoT→three sync', matResult === '#ff4400')

/* --- 4. Base Map セレクトでテクスチャ割当 --- */
const texAssign = await page.evaluate(() => {
  const st = window.__store.getState()
  const id = st.selection[st.selection.length - 1]
  const idx = st.scene.nodes[id].components.findIndex((c) => c.type === 'material')
  const tex = st.assets.find((a) => a.type === 'texture')
  st.transientPatchComponent(id, idx, { textureAssetId: tex.id })
  const obj = window.__engine.objectMap.get(id)
  let has = false
  obj.traverse((o) => { if (o.isMesh && o.material?.map) has = true })
  return has
})
check('texture assign → material.map set', texAssign)
// UI側のセレクトにも出ているか
const baseMapValue = await page.locator('div:has(> div:text-is("Base Map")) select').inputValue()
check('Base Map select reflects store', baseMapValue !== '')

/* --- 5. Add Component (Light) --- */
await page.getByText('Add Component', { exact: true }).click()
await page.locator('.u-menu-item', { hasText: 'Light' }).click()
await page.waitForTimeout(300)
const lightAdded = await page.evaluate(() => {
  const st = window.__store.getState()
  const id = st.selection[st.selection.length - 1]
  const comp = st.scene.nodes[id].components.some((c) => c.type === 'light')
  const part = !!window.__engine.objectMap.get(id)?.userData.parts.light
  return comp && part
})
check('Add Component Light → store + three light part', lightAdded)
check('Light section visible', (await page.getByText('Intensity', { exact: true }).count()) > 0)

/* --- 6. Hierarchy DnD: Cube を test-model の子へ --- */
const cubeRow = page.locator('.u-tree-row', { hasText: 'Cube' }).first()
const modelRow = page.locator('.u-tree-row', { hasText: 'test-model' }).first()
await cubeRow.dragTo(modelRow) // 中央 = inside
await page.waitForTimeout(400)
const reparented = await page.evaluate(() => {
  const st = window.__store.getState()
  const cube = Object.values(st.scene.nodes).find((n) => n.name === 'Cube')
  const model = Object.values(st.scene.nodes).find((n) => n.name === 'test-model')
  const threeOk = window.__engine.objectMap.get(cube.id)?.parent === window.__engine.objectMap.get(model.id)
  return { parented: cube.parentId === model.id, threeOk }
})
check('Hierarchy DnD reparent (store)', reparented.parented)
check('Hierarchy DnD reparent (three parent)', reparented.threeOk)
await page.keyboard.press('Control+z')
await page.waitForTimeout(300)
check('reparent undo', await page.evaluate(() => Object.values(window.__store.getState().scene.nodes).find((n) => n.name === 'Cube').parentId === null))

/* --- 7. F2リネーム --- */
await page.locator('.u-tree-row', { hasText: 'Cube' }).first().click()
await page.keyboard.press('F2')
await page.waitForTimeout(200)
await page.keyboard.type('MyBox')
await page.keyboard.press('Enter')
await page.waitForTimeout(250)
nodes = await page.evaluate(() => Object.values(window.__store.getState().scene.nodes).map((n) => n.name))
check('F2 rename → MyBox', nodes.includes('MyBox'))
check('rename is undoable', await page.evaluate(() => window.__store.getState().undoStack.at(-1)?.name === 'Rename'))

/* --- 8. 目玉トグルで非表示 → three.visible false --- */
const row = page.locator('.u-tree-row', { hasText: 'MyBox' }).first()
await row.hover()
await row.locator('button[title="Disable"]').click()
await page.waitForTimeout(250)
const visResult = await page.evaluate(() => {
  const st = window.__store.getState()
  const n = Object.values(st.scene.nodes).find((x) => x.name === 'MyBox')
  return { store: n.visible, three: window.__engine.objectMap.get(n.id).visible }
})
check('eye toggle → store visible=false', visResult.store === false)
check('eye toggle → three visible=false', visResult.three === false)

/* --- 9. Camera ノード選択でプレビュー描画 (エラーなく1フレーム) --- */
await page.evaluate(() => {
  const st = window.__store.getState()
  const cam = Object.values(st.scene.nodes).find((n) => n.components.some((c) => c.type === 'camera'))
  st.select([cam.id])
})
await page.waitForTimeout(500)
check('camera preview renders without error', errors.length === 0)
await page.screenshot({ path: `${SCRATCH}/shot-campreview.png` })

/* --- 10. JSON往復 (アセット込み) --- */
const rt = await page.evaluate(async () => {
  const mod = await import('/src/engine/serialization.ts')
  const json = JSON.stringify(mod.serializeScene())
  const before = JSON.stringify(window.__store.getState().scene)
  await mod.importSceneFromJson(json)
  const after = JSON.stringify(window.__store.getState().scene)
  const assets = window.__store.getState().assets.length
  return { same: before === after, assets, kb: (json.length / 1024).toFixed(1) }
})
check(`asset-embedded JSON roundtrip (${rt.kb}KB, ${rt.assets} assets)`, rt.same && rt.assets === 2)
// GLB参照が復元後も解決される (メッシュ再構築)
const glbAfter = await page.evaluate(() => {
  const st = window.__store.getState()
  const id = Object.keys(st.scene.nodes).find((k) => st.scene.nodes[k].name === 'test-model')
  let meshCount = 0
  window.__engine.objectMap.get(id)?.traverse((o) => { if (o.isMesh && !o.userData.pickProxy) meshCount++ })
  return meshCount
})
check('GLB re-resolved after load', glbAfter >= 1)

console.log('page errors:', errors.length === 0 ? 'none' : errors)
await browser.close()
