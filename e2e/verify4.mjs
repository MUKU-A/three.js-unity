/* 実走検証 4: 複数選択 / Hierarchy検索 / Consoleフィルタ / 再生ティント / Ctrlスナップ */
import { chromium } from 'playwright-core'
const SCRATCH = new URL('./out', import.meta.url).pathname
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const check = (label, cond) => console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}`)

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(1800)

/* 3つキューブ作成 */
await page.evaluate(() => {
  const m = window.__store.getState()
  return Promise.resolve()
})
for (let i = 0; i < 3; i++) {
  await page.evaluate(async () => {
    const acts = await import('/src/store/actions.ts')
    acts.createPrimitive('box', null)
  })
}
await page.waitForTimeout(400)

/* --- 1. Ctrl+クリック複数選択 → 一括削除 → 一括Undo --- */
await page.locator('.u-tree-row', { hasText: /^Cube$/ }).first().click()
await page.locator('.u-tree-row', { hasText: 'Cube (1)' }).first().click({ modifiers: ['Control'] })
await page.locator('.u-tree-row', { hasText: 'Cube (2)' }).first().click({ modifiers: ['Control'] })
let sel = await page.evaluate(() => window.__store.getState().selection.length)
check('Ctrl+click multi-select = 3', sel === 3)
// Shift範囲選択
await page.locator('.u-tree-row', { hasText: /^Main Camera$/ }).first().click()
await page.locator('.u-tree-row', { hasText: 'Cube (2)' }).first().click({ modifiers: ['Shift'] })
sel = await page.evaluate(() => window.__store.getState().selection.length)
check('Shift+click range select = 5', sel === 5)
await page.locator('.u-tree-row', { hasText: /^Cube$/ }).first().click()
await page.locator('.u-tree-row', { hasText: 'Cube (1)' }).first().click({ modifiers: ['Control'] })
await page.keyboard.press('Delete')
await page.waitForTimeout(250)
let names = await page.evaluate(() => Object.values(window.__store.getState().scene.nodes).map((n) => n.name))
check('multi delete removed 2 cubes', !names.includes('Cube') && !names.includes('Cube (1)') && names.includes('Cube (2)'))
await page.keyboard.press('Control+z')
await page.waitForTimeout(250)
names = await page.evaluate(() => Object.values(window.__store.getState().scene.nodes).map((n) => n.name))
check('single undo restores both', names.includes('Cube') && names.includes('Cube (1)'))

/* --- 2. Hierarchy検索フィルタ --- */
await page.locator('.bg-u-toolbar input').first().fill('Camera')
await page.waitForTimeout(300)
const rowCount = await page.locator('.u-tree-row').count()
check('search "Camera" filters rows', rowCount === 1)
await page.locator('.bg-u-toolbar input').first().fill('')
await page.waitForTimeout(300)
check('clearing search restores tree', (await page.locator('.u-tree-row').count()) === 5)

/* --- 3. Console フィルタ + Clear --- */
await page.getByText('Console', { exact: true }).click()
await page.waitForTimeout(300)
await page.evaluate(() => {
  const st = window.__store.getState()
  st.log('warn', 'test warning')
  st.log('error', 'test error')
})
await page.waitForTimeout(200)
const logRows = await page.locator('.u-log-row').count()
check('console shows rows', logRows >= 3)
// warnフィルタOFF
await page.locator('button:has(svg.text-u-warn)').first().click()
await page.waitForTimeout(200)
const afterFilter = await page.locator('.u-log-row').count()
check('warn filter hides warning', afterFilter === logRows - 1)
await page.getByText('Clear', { exact: true }).first().click()
await page.waitForTimeout(200)
check('Clear empties console', (await page.locator('.u-log-row').count()) === 0)

/* --- 4. 再生ティント + Pause --- */
await page.getByTitle('Play', { exact: true }).click()
await page.waitForTimeout(400)
await page.screenshot({ path: `${SCRATCH}/shot-playing.png` })
const playState = await page.evaluate(() => window.__store.getState().mode)
check('playing', playState === 'play')
await page.getByTitle('Pause', { exact: true }).click()
check('pause toggles', (await page.evaluate(() => window.__store.getState().mode)) === 'paused')
await page.getByTitle('Pause', { exact: true }).click()
check('unpause', (await page.evaluate(() => window.__store.getState().mode)) === 'play')
await page.getByTitle('Stop', { exact: true }).click()
await page.waitForTimeout(300)
check('stop → edit', (await page.evaluate(() => window.__store.getState().mode)) === 'edit')

/* --- 5. ギズモへの Ctrl スナップ設定 --- */
await page.locator('.u-tree-row', { hasText: 'Cube (2)' }).first().click()
await page.keyboard.down('Control')
await page.waitForTimeout(150)
const snap = await page.evaluate(() => {
  const g = window.__engine.gizmo
  return { t: g?.translationSnap, r: g?.rotationSnap, s: g?.scaleSnap }
})
await page.keyboard.up('Control')
const snapOff = await page.evaluate(() => window.__engine.gizmo?.translationSnap)
check('Ctrl down → snap 1 / 15deg / 0.1', snap.t === 1 && Math.abs(snap.r - 0.2618) < 0.001 && snap.s === 0.1)
check('Ctrl up → snap off', snapOff === null)

console.log('page errors:', errors.length === 0 ? 'none' : errors)
await browser.close()
