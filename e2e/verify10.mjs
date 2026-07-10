/* 実走検証 10: スクリプトAPI拡充 — getComponent / setParent / worldPosition /
   マウス入力 (mousePosition, getMouseButtonDown) / screenPointToRay (D-031) */
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

  const ground = store.makePrimitiveNode('plane')
  ground.name = 'Ground'
  /* ゲームカメラ(0,1,-10)から画面下部クリックのレイが届くよう広めに */
  ground.components.push({ ...scene.defaultCollider('box'), size: { x: 40, y: 0.2, z: 40 }, center: { x: 0, y: -0.1, z: 0 } })
  st.execute(store.cmdAddObject([ground], null))

  const child = store.makePrimitiveNode('sphere')
  child.name = 'ChildTarget'
  child.transform.position = { x: 2, y: 0, z: 0 }
  st.execute(store.cmdAddObject([child], null))

  const player = store.makePrimitiveNode('box')
  player.name = 'Player'
  player.transform.position = { x: 1, y: 2, z: 3 }
  player.components.push({
    ...scene.defaultScript('TesterScript'),
    code: `
function onStart(ctx) {
  const mat = ctx.node.getComponent('material')
  ctx.log('col0:' + mat.color)
  mat.color = '#123456'
  ctx.log('col1:' + mat.color)
  ctx.log('groundFriction:' + ctx.find('Ground').getComponent('collider').friction)
  ctx.log('byname:' + (ctx.node.getComponent('TesterScript') !== null))
  ctx.find('ChildTarget').setParent(ctx.node)
  const cwp = ctx.find('ChildTarget').worldPosition
  ctx.log('childwp:' + cwp.x + ',' + cwp.y + ',' + cwp.z)
}
function onUpdate(ctx, dt) {
  if (ctx.input.getMouseButtonDown(0)) {
    const m = ctx.input.mousePosition
    ctx.log('mouse:' + (m.x > 0 && m.y > 0))
    const ray = ctx.screenPointToRay(m.x, m.y)
    if (ray) {
      const hit = ctx.physics.raycast(ray.origin, ray.direction, 200)
      ctx.log('clickhit:' + (hit ? hit.node.name : 'none'))
    }
  }
}
`,
    props: {},
  })
  st.execute(store.cmdAddObject([player], null))
  st.select([])
})
await page.waitForTimeout(300)

/* ---------- 再生 (GameタブへPlayが自動切替) ---------- */
await page.getByTitle('Play', { exact: true }).click()
await page.waitForTimeout(2200) // Rapier init 待ち

const logs1 = await page.evaluate(() => window.__store.getState().logs.map((l) => l.message))
const has = (arr, frag) => arr.some((m) => m.includes(frag))
check('getComponent(material) read', has(logs1, 'col0:#ffffff'))
check('component proxy write → live', has(logs1, 'col1:#123456'))
const matHex = await page.evaluate(() => {
  const st = window.__store.getState()
  const p = Object.values(st.scene.nodes).find((n) => n.name === 'Player')
  /* setParentで子が付いているため traverse ではなく自身の mesh part を直接読む */
  const mesh = window.__engine.objectMap.get(p.id)?.userData.parts.mesh
  return mesh ? '#' + mesh.material.color.getHexString() : ''
})
check(`proxy write reaches three material (${matHex})`, matHex === '#123456')
check('cross-node getComponent(collider).friction', has(logs1, 'groundFriction:0.5'))
check('getComponent by script name', has(logs1, 'byname:true'))
check('setParent + worldPosition (child local(2,0,0)→world(3,2,3))', has(logs1, 'childwp:3,2,3'))
const parentOk = await page.evaluate(() => {
  const st = window.__store.getState()
  const p = Object.values(st.scene.nodes).find((n) => n.name === 'Player')
  const c = Object.values(st.scene.nodes).find((n) => n.name === 'ChildTarget')
  const threeOk = window.__engine.objectMap.get(c.id)?.parent === window.__engine.objectMap.get(p.id)
  return c.parentId === p.id && threeOk
})
check('setParent store+three linkage', parentOk)

/* ---------- マウスクリック → screenPointToRay → 物理ヒット ---------- */
const gameCanvas = page.locator('canvas').first() // Gameタブアクティブ中は唯一のcanvas
const bb = await gameCanvas.boundingBox()
await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height * 0.82) // 画面下部 → 下向きレイ → Ground
await page.waitForTimeout(400)
const logs2 = await page.evaluate(() => window.__store.getState().logs.map((l) => l.message))
check('getMouseButtonDown + mousePosition', has(logs2, 'mouse:true'))
check('screenPointToRay + raycast hits Ground', has(logs2, 'clickhit:Ground'))

await page.getByTitle('Stop', { exact: true }).click()
await page.waitForTimeout(400)
const restored = await page.evaluate(() => {
  const st = window.__store.getState()
  const c = Object.values(st.scene.nodes).find((n) => n.name === 'ChildTarget')
  const p = Object.values(st.scene.nodes).find((n) => n.name === 'Player')
  const mat = p.components.find((x) => x.type === 'material')
  return { parent: c.parentId, color: mat.color }
})
check('stop restores parenting + material', restored.parent === null && restored.color === '#ffffff')

console.log('page errors:', errors.length === 0 ? 'none' : errors)
await browser.close()
