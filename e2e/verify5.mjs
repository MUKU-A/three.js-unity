/* 実走検証 5: TransformControlsの実マウスドラッグ → SSoT → Inspector 同期 (完了条件3) */
import { chromium } from 'playwright-core'
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const check = (label, cond) => console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}`)

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(1800)

/* Cube作成 + 選択 */
await page.evaluate(async () => {
  const acts = await import('/src/store/actions.ts')
  acts.createPrimitive('box', null)
})
await page.waitForTimeout(400)

/* ギズモX軸矢印の画面座標を計算 (ワールド (0.75,0,0) 付近が矢印シャフト) */
const pts = await page.evaluate(() => {
  const e = window.__engine
  const toScreen = (x, y, z) => {
    const v = e.camera.position.clone().set(x, y, z).project(e.camera)
    const r = document.querySelector('canvas').getBoundingClientRect()
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height }
  }
  return { from: toScreen(0.75, 0, 0), to: toScreen(2.5, 0, 0) }
})
const undoBefore = await page.evaluate(() => window.__store.getState().undoStack.length)

/* X軸矢印をドラッグ */
await page.mouse.move(pts.from.x, pts.from.y)
await page.waitForTimeout(150) // hover検出 (axis設定)
await page.mouse.down()
await page.waitForTimeout(100)
const steps = 15
for (let i = 1; i <= steps; i++) {
  await page.mouse.move(pts.from.x + ((pts.to.x - pts.from.x) * i) / steps, pts.from.y + ((pts.to.y - pts.from.y) * i) / steps)
  await page.waitForTimeout(16)
}
/* ドラッグ中: Inspectorの値がリアルタイム更新されているか (マウスを離す前に確認) */
const midInspector = await page.locator('div:has(> div:text-is("Position")) input').first().inputValue()
const midStore = await page.evaluate(() => {
  const st = window.__store.getState()
  const n = Object.values(st.scene.nodes).find((x) => x.name === 'Cube')
  return n.transform.position.x
})
await page.mouse.up()
await page.waitForTimeout(300)

const after = await page.evaluate(() => {
  const st = window.__store.getState()
  const n = Object.values(st.scene.nodes).find((x) => x.name === 'Cube')
  return { x: n.transform.position.x, undo: st.undoStack.length, lastCmd: st.undoStack.at(-1)?.name }
})
check(`gizmo drag moved cube on X (x=${after.x.toFixed(2)})`, Math.abs(after.x) > 0.3)
check(`Inspector live-updates during drag (showed ${midInspector})`, Math.abs(parseFloat(midInspector) - midStore) < 0.05 && Math.abs(midStore) > 0.05)
check('gizmo drag = exactly 1 undo entry', after.undo === undoBefore + 1 && after.lastCmd === 'Transform')

/* Undoで原点へ戻る + three側も追従 */
await page.keyboard.press('Control+z')
await page.waitForTimeout(250)
const undone = await page.evaluate(() => {
  const st = window.__store.getState()
  const n = Object.values(st.scene.nodes).find((x) => x.name === 'Cube')
  const objX = window.__engine.objectMap.get(n.id).position.x
  return { storeX: n.transform.position.x, objX }
})
check('undo returns to origin (store+three)', undone.storeX === 0 && undone.objX === 0)

console.log('page errors:', errors.length === 0 ? 'none' : errors)
await browser.close()
