/* 実走検証 2: 操作フロー — 作成/選択/Inspector同期/スクラブ/ギズモ/複製/削除/Undo/再生/保存 */
import { chromium } from 'playwright-core'

const SCRATCH = new URL('./out', import.meta.url).pathname
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
const errors = []
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

const state = () => page.evaluate(() => {
  const s = window.__store.getState()
  const nodes = Object.values(s.scene.nodes).map((n) => `${n.name}@${n.parentId ? 'child' : 'root'}(${n.transform.position.x.toFixed(2)},${n.transform.position.y.toFixed(2)},${n.transform.position.z.toFixed(2)})`)
  return { nodes, selection: s.selection.map((id) => s.scene.nodes[id]?.name), tool: s.tool, mode: s.mode, undo: s.undoStack.length, redo: s.redoStack.length }
})
const check = (label, cond) => console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}`)
const menuClick = async (path) => {
  for (let i = 0; i < path.length; i++) {
    const item = page.locator('.u-menu').last().getByText(path[i], { exact: true }).first()
    if (i < path.length - 1) {
      await item.hover()
      await page.waitForTimeout(250)
    } else {
      await item.click()
    }
  }
}

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)

/* --- 1. 行の右クリック → 3D Object > Cube は「子」として作成 (Unity挙動) --- */
await page.locator('.u-tree-row').first().click({ button: 'right' })
await menuClick(['3D Object', 'Cube'])
await page.waitForTimeout(350)
let s = await state()
check('right-click on row creates Cube as child', s.nodes.some((n) => n.startsWith('Cube@child')))
await page.keyboard.press('Control+z')
await page.waitForTimeout(200)
check('Ctrl+Z removes child cube', !(await state()).nodes.some((n) => n.startsWith('Cube@')))

/* --- 2. [+]ボタン → 3D Object > Cube はルートに作成 --- */
await page.getByTitle('Create', { exact: true }).click()
await menuClick(['3D Object', 'Cube'])
await page.waitForTimeout(350)
s = await state()
check('+ menu creates root Cube', s.nodes.some((n) => n.startsWith('Cube@root')))
check('Cube selected after create', s.selection.join(',') === 'Cube')

/* --- 3. Inspector セクション --- */
for (const sec of ['Transform', 'Mesh Filter', 'Material']) {
  check(`Inspector section ${sec}`, (await page.getByText(sec, { exact: true }).count()) > 0)
}
await page.screenshot({ path: `${SCRATCH}/shot-cube.png` })

/* --- 4. Position X 入力 → 反映 --- */
const px = page.locator('div:has(> div:text-is("Position")) input').first()
await px.click()
await px.fill('2.5')
await px.press('Enter')
await page.waitForTimeout(250)
s = await state()
check('Position X typed = 2.5 applied', s.nodes.some((n) => n.includes('Cube@root(2.50,')))
const undoAfterType = s.undo

/* --- 5. ラベルスクラブ --- */
const xLabel = page.locator('div:has(> div:text-is("Position")) span.u-scrub').first()
const bb = await xLabel.boundingBox()
await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2)
await page.mouse.down()
await page.mouse.move(bb.x + bb.width / 2 + 120, bb.y + bb.height / 2, { steps: 12 })
await page.mouse.up()
await page.waitForTimeout(250)
s = await state()
check('scrub moved Position X', !s.nodes.some((n) => n.includes('Cube@root(2.50,')))
check('scrub = 1 undo entry', s.undo === undoAfterType + 1)
await page.keyboard.press('Control+z')
await page.waitForTimeout(200)
check('undo scrub → back to 2.5', (await state()).nodes.some((n) => n.includes('Cube@root(2.50,')))

/* --- 6. W/E/R --- */
await page.mouse.click(500, 150)
await page.keyboard.press('e')
check('E → rotate tool', (await state()).tool === 'rotate')
await page.keyboard.press('r')
check('R → scale tool', (await state()).tool === 'scale')
await page.keyboard.press('w')
check('W → move tool', (await state()).tool === 'move')
check('viewport empty click cleared selection', (await state()).selection.length === 0)

/* --- 7. ビューポートクリックで Cube 選択 --- */
const cubeXY = await page.evaluate(() => {
  const e = window.__engine
  const st = window.__store.getState()
  const id = Object.keys(st.scene.nodes).find((k) => st.scene.nodes[k].name === 'Cube')
  const obj = e.objectMap.get(id)
  const THREEV = obj.getWorldPosition(new obj.position.constructor())
  const v = THREEV.project(e.camera)
  const r = document.querySelector('canvas').getBoundingClientRect()
  return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height }
})
await page.mouse.click(cubeXY.x, cubeXY.y)
await page.waitForTimeout(250)
s = await state()
check('raycast click selects Cube', s.selection.join(',') === 'Cube')

/* --- 8. Ctrl+D 複製 --- */
await page.keyboard.press('Control+d')
await page.waitForTimeout(250)
s = await state()
check('Ctrl+D duplicates → Cube (1)', s.nodes.some((n) => n.startsWith('Cube (1)@')))
check('duplicate selected', s.selection.join(',') === 'Cube (1)')

/* --- 9. Delete / Undo / Redo --- */
await page.keyboard.press('Delete')
await page.waitForTimeout(200)
check('Delete removes Cube (1)', !(await state()).nodes.some((n) => n.startsWith('Cube (1)@')))
await page.keyboard.press('Control+z')
await page.waitForTimeout(200)
check('Undo restores Cube (1)', (await state()).nodes.some((n) => n.startsWith('Cube (1)@')))
await page.keyboard.press('Control+y')
await page.waitForTimeout(200)
check('Redo re-deletes', !(await state()).nodes.some((n) => n.startsWith('Cube (1)@')))

/* --- 10. 再生モード --- */
await page.evaluate(() => window.__store.getState().select([]))
const before = await state()
await page.getByTitle('Play', { exact: true }).click()
await page.waitForTimeout(300)
check('Play mode entered', (await state()).mode === 'play')
await page.evaluate(() => {
  const st = window.__store.getState()
  const id = Object.keys(st.scene.nodes).find((k) => st.scene.nodes[k].name === 'Cube')
  st.transientSetTransform(id, { position: { x: 99, y: 9, z: 9 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } })
})
check('edit during play applied', (await state()).nodes.some((n) => n.includes('(99.00,')))
await page.getByTitle('Stop', { exact: true }).click()
await page.waitForTimeout(300)
s = await state()
check('Stop restores scene & edit mode', !s.nodes.some((n) => n.includes('(99.00,')) && s.mode === 'edit')
check('scene equals pre-play', JSON.stringify([...s.nodes].sort()) === JSON.stringify([...before.nodes].sort()))

/* --- 11. F フォーカス --- */
await page.evaluate(() => {
  const st = window.__store.getState()
  const id = Object.keys(st.scene.nodes).find((k) => st.scene.nodes[k].name === 'Cube')
  st.select([id])
})
const camBefore = await page.evaluate(() => window.__engine.camera.position.toArray())
await page.mouse.move(700, 400)
await page.keyboard.press('f')
await page.waitForTimeout(600)
const camAfter = await page.evaluate(() => window.__engine.camera.position.toArray())
check('F focus moves camera', JSON.stringify(camBefore) !== JSON.stringify(camAfter))

/* --- 12. シーンJSON往復 --- */
const roundtrip = await page.evaluate(async () => {
  const mod = await import('/src/engine/serialization.ts')
  const json = JSON.stringify(mod.serializeScene())
  const before = JSON.stringify(window.__store.getState().scene)
  await mod.importSceneFromJson(json)
  const after = JSON.stringify(window.__store.getState().scene)
  return { same: before === after, size: json.length }
})
check(`scene JSON roundtrip identical (${roundtrip.size}B)`, roundtrip.same)

await page.screenshot({ path: `${SCRATCH}/shot-final.png` })
console.log('page errors:', errors.length === 0 ? 'none' : errors)
await browser.close()
