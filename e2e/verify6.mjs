/* 実走検証 6: メニューバー / Gameビュー+再生自動切替 / Unity操作系(矩形選択・Altオービット・フライ) /
   方位ギズモ / Wireframe / 数式入力 / コンポーネントenabled / New Scene */
import { chromium } from 'playwright-core'
const SCRATCH = new URL('./out', import.meta.url).pathname
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
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

/* --- 1. メニューバー: GameObject > 3D Object > Cube --- */
for (const m of ['File', 'Edit', 'GameObject', 'Component', 'Window', 'Help']) {
  check(`menubar ${m}`, (await page.getByText(m, { exact: true }).count()) > 0)
}
await page.getByText('GameObject', { exact: true }).click()
await menuClick(['3D Object', 'Cube'])
await page.waitForTimeout(350)
let names = await page.evaluate(() => Object.values(window.__store.getState().scene.nodes).map((n) => n.name))
check('GameObject menu creates Cube', names.includes('Cube'))

/* --- 2. Edit > Undo (動的ラベル) --- */
await page.getByText('Edit', { exact: true }).first().click()
const undoLabel = await page.locator('.u-menu').getByText(/^Undo /).textContent()
check(`Edit menu shows dynamic undo label (${undoLabel?.trim()})`, /Undo Create/.test(undoLabel ?? ''))
await page.locator('.u-menu').getByText(/^Undo /).click()
await page.waitForTimeout(250)
names = await page.evaluate(() => Object.values(window.__store.getState().scene.nodes).map((n) => n.name))
check('Edit > Undo removes Cube', !names.includes('Cube'))

/* --- 3. Component メニューで Light 追加 --- */
await page.getByText('GameObject', { exact: true }).click()
await menuClick(['3D Object', 'Cube'])
await page.waitForTimeout(300)
await page.getByText('Component', { exact: true }).first().click()
await page.locator('.u-menu').getByText('Light', { exact: true }).click()
await page.waitForTimeout(250)
const hasLight = await page.evaluate(() => {
  const st = window.__store.getState()
  const id = st.selection[st.selection.length - 1]
  return st.scene.nodes[id].components.some((c) => c.type === 'light')
})
check('Component menu adds Light to selection', hasLight)

/* --- 4. コンポーネント enabled チェックボックス → three light.visible --- */
const lightHeader = page.locator('.u-comp-header', { hasText: 'Light' })
await lightHeader.locator('input[type=checkbox]').click()
await page.waitForTimeout(250)
const lightState = await page.evaluate(() => {
  const st = window.__store.getState()
  const id = st.selection[st.selection.length - 1]
  const comp = st.scene.nodes[id].components.find((c) => c.type === 'light')
  const part = window.__engine.objectMap.get(id).userData.parts.light
  return { enabled: comp.enabled, visible: part.visible }
})
check('Light enabled=false → three light.visible=false', lightState.enabled === false && lightState.visible === false)

/* --- 5. Wireframe 描画モード --- */
await page.getByTitle('Draw mode').click()
await page.locator('.u-menu').getByText('Wireframe', { exact: true }).click()
await page.waitForTimeout(250)
const wire = await page.evaluate(() => {
  const st = window.__store.getState()
  const id = st.selection[st.selection.length - 1]
  let w = false
  window.__engine.objectMap.get(id).traverse((o) => {
    if (o.isMesh && !o.userData.pickProxy) w = o.material.wireframe
  })
  return { mode: st.shadingMode, wire: w }
})
check('Wireframe mode applies to meshes', wire.mode === 'wireframe' && wire.wire === true)
await page.getByTitle('Draw mode').click()
await page.locator('.u-menu').getByText('Shaded', { exact: true }).click()
await page.waitForTimeout(200)

/* --- 6. 数式入力: Position X に "1+2*3" --- */
const px = page.locator('div:has(> div:text-is("Position")) input').first()
await px.click()
await px.fill('1+2*3')
await px.press('Enter')
await page.waitForTimeout(250)
const exprX = await page.evaluate(() => {
  const st = window.__store.getState()
  const id = st.selection[st.selection.length - 1]
  return st.scene.nodes[id].transform.position.x
})
check('numeric expression 1+2*3 → 7', exprX === 7)

/* --- 7. 矩形選択: 2個目のCubeを離れた位置に作成し、全面ドラッグで両方選択 --- */
await page.evaluate(async () => {
  const acts = await import('/src/store/actions.ts')
  acts.createPrimitive('box', null)
  const st = window.__store.getState()
  const id = st.selection[st.selection.length - 1]
  st.transientSetTransform(id, { position: { x: -3, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } })
  st.select([])
})
await page.waitForTimeout(250)
const cv = await page.locator('canvas').first().boundingBox()
await page.mouse.move(cv.x + 30, cv.y + 30)
await page.mouse.down()
await page.mouse.move(cv.x + cv.width - 30, cv.y + cv.height - 30, { steps: 10 })
await page.mouse.up()
await page.waitForTimeout(300)
const bandSel = await page.evaluate(() => window.__store.getState().selection.length)
check(`rubber-band select catches objects (${bandSel})`, bandSel >= 2)

/* --- 8. Alt+左ドラッグ = オービット --- */
const camBefore = await page.evaluate(() => window.__engine.camera.position.toArray())
await page.keyboard.down('Alt')
await page.mouse.move(cv.x + cv.width / 2, cv.y + cv.height / 2)
await page.mouse.down()
await page.mouse.move(cv.x + cv.width / 2 + 150, cv.y + cv.height / 2 + 60, { steps: 10 })
await page.mouse.up()
await page.keyboard.up('Alt')
await page.waitForTimeout(200)
const camAfterOrbit = await page.evaluate(() => window.__engine.camera.position.toArray())
check('Alt+LMB drag orbits camera', JSON.stringify(camBefore) !== JSON.stringify(camAfterOrbit))
/* Alt+ドラッグで選択が変わっていないこと */
check('Alt+drag does not change selection', (await page.evaluate(() => window.__store.getState().selection.length)) >= 2)

/* --- 9. 右ドラッグ+W = フライスルー前進 --- */
const camBeforeFly = await page.evaluate(() => window.__engine.camera.position.toArray())
await page.mouse.move(cv.x + cv.width / 2, cv.y + cv.height / 2)
await page.mouse.down({ button: 'right' })
await page.waitForTimeout(100)
check('isFlying during RMB', await page.evaluate(() => window.__engine.isFlying))
await page.keyboard.down('w')
await page.waitForTimeout(500)
await page.keyboard.up('w')
await page.mouse.up({ button: 'right' })
await page.waitForTimeout(200)
const camAfterFly = await page.evaluate(() => window.__engine.camera.position.toArray())
const flyDist = Math.hypot(camAfterFly[0] - camBeforeFly[0], camAfterFly[1] - camBeforeFly[1], camAfterFly[2] - camBeforeFly[2])
check(`RMB+W flythrough moves camera (${flyDist.toFixed(2)}m)`, flyDist > 0.5)
check('fly ends on RMB up', !(await page.evaluate(() => window.__engine.isFlying)))
check('W key did not switch tool during fly', (await page.evaluate(() => window.__store.getState().tool)) === 'move')

/* --- 10. 方位ギズモ: +X クリックでX軸ビューへ --- */
await page.locator('[title="Click an axis to align the view"] g').first().waitFor({ timeout: 3000 }).catch(() => {})
// +X ハンドル (fill=#DB3E1D の circle を持つ g) をクリック
const gizmoBox = await page.getByTitle('Click an axis to align the view').boundingBox()
check('axis gizmo rendered top-right', !!gizmoBox && gizmoBox.x > cv.x + cv.width - 120)
await page.evaluate(() => {
  const THREEV = window.__engine.camera.position.clone()
  window.__engine.alignToAxis(THREEV.set(1, 0, 0))
})
await page.waitForTimeout(500)
const aligned = await page.evaluate(() => {
  const e = window.__engine
  const t = e.orbit.target
  const d = e.camera.position.clone().sub(t)
  return { x: d.x, y: Math.abs(d.y), z: Math.abs(d.z) }
})
check('alignToAxis(+X) puts camera on +X of target', aligned.x > 0.5 && aligned.y < 0.05 && aligned.z < 0.05)

/* --- 11. Gameビュー: タブ存在 + 再生で自動アクティブ化 + カメラ描画 --- */
check('Game tab exists', (await page.getByText('Game', { exact: true }).count()) > 0)
await page.getByTitle('Play', { exact: true }).click()
await page.waitForTimeout(600)
const gameActive = await page.evaluate(() => {
  const tabs = [...document.querySelectorAll('.dv-tab')]
  const gameTab = tabs.find((t) => t.textContent?.includes('Game'))
  return gameTab?.className ?? ''
})
check(`play auto-activates Game tab (${gameActive})`, /active/.test(gameActive))
/* dockviewは非表示タブをアンマウントするため、Gameアクティブ時はGameキャンバスのみ存在 */
const gameMounted = await page.evaluate(() => {
  const e = window.__engine
  return { mounted: !!e.gameMount, size: e.gameRenderer ? [e.gameRenderer.domElement.width, e.gameRenderer.domElement.height] : null }
})
check(`game renderer mounted & sized (${gameMounted.size})`, gameMounted.mounted && gameMounted.size && gameMounted.size[0] > 100)
await page.screenshot({ path: `${SCRATCH}/shot-gameview.png` })
await page.getByTitle('Stop', { exact: true }).click()
await page.waitForTimeout(400)
const sceneActive = await page.evaluate(() => {
  const tabs = [...document.querySelectorAll('.dv-tab')]
  const t = tabs.find((t) => t.textContent?.includes('Scene'))
  return /active/.test(t?.className ?? '')
})
check('stop re-activates Scene tab', sceneActive)

/* --- 12. File > New Scene (confirmダイアログ) --- */
page.once('dialog', (d) => d.accept())
await page.getByText('File', { exact: true }).click()
await page.locator('.u-menu').getByText('New Scene', { exact: true }).click()
await page.waitForTimeout(400)
const fresh = await page.evaluate(() => {
  const st = window.__store.getState()
  return { n: Object.keys(st.scene.nodes).length, undo: st.undoStack.length, assets: st.assets.length }
})
check('File > New Scene resets to Camera+Light', fresh.n === 2 && fresh.undo === 0 && fresh.assets === 0)

await page.screenshot({ path: `${SCRATCH}/shot-menubar.png` })
console.log('page errors:', errors.length === 0 ? 'none' : errors)
await browser.close()
