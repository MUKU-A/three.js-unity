/* 実走検証 8: ゲームロジックAPI — Instantiate/Destroy・衝突/トリガーイベント・Raycast・
   コルーチン・FixedUpdate/LateUpdate・アニメClip選択・OBJインポート (D-028) */
import { chromium } from 'playwright-core'
const SCRATCH = new URL('./out', import.meta.url).pathname
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const check = (label, cond) => console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}`)

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)

/* シーン構築: Ground / Proto(落下+衝突script) / TriggerZone / Victim / Manager(script) */
await page.evaluate(async () => {
  const scene = await import('/src/types/scene.ts')
  const store = await import('/src/store/editorStore.ts')
  const st = store.useEditorStore.getState()

  const ground = store.makePrimitiveNode('plane')
  ground.name = 'Ground'
  ground.components.push({ ...scene.defaultCollider('box'), size: { x: 10, y: 0.2, z: 10 }, center: { x: 0, y: -0.1, z: 0 } })
  st.execute(store.cmdAddObject([ground], null))

  const proto = store.makePrimitiveNode('box')
  proto.name = 'Proto'
  proto.transform.position = { x: 0, y: 5, z: 0 }
  proto.components.push(scene.defaultRigidbody())
  proto.components.push(scene.defaultCollider('box'))
  proto.components.push({
    ...scene.defaultScript('Faller'),
    code: `function onCollisionEnter(ctx, other) { ctx.log('col:' + other.name) }`,
    props: {},
  })
  st.execute(store.cmdAddObject([proto], null))

  const zone = store.makeEmptyNode('TriggerZone')
  zone.transform.position = { x: 0, y: 1.5, z: 0 }
  zone.components.push({ ...scene.defaultCollider('box'), size: { x: 3, y: 3, z: 3 }, isTrigger: true })
  zone.components.push({
    ...scene.defaultScript('Zone'),
    code: `function onTriggerEnter(ctx, other) { ctx.log('trig:' + other.name) }`,
    props: {},
  })
  st.execute(store.cmdAddObject([zone], null))

  const victim = store.makePrimitiveNode('sphere')
  victim.name = 'Victim'
  victim.transform.position = { x: 8, y: 0.5, z: 0 }
  st.execute(store.cmdAddObject([victim], null))

  const mgr = store.makeEmptyNode('Manager')
  mgr.components.push({
    ...scene.defaultScript('Manager'),
    code: `
let fixedCount = 0
let lateLogged = false
let done = false
function onStart(ctx) {
  const c = ctx.instantiate('Proto', { x: 0.4, y: 8, z: 0.4 })
  ctx.log('spawned:' + (c !== null ? c.name : 'null'))
  ctx.startCoroutine(function* () {
    yield 0.3
    ctx.log('coroutine-done')
  })
}
function onFixedUpdate(ctx, dt) { fixedCount++ }
function onLateUpdate(ctx, dt) {
  if (fixedCount > 0 && !lateLogged) { lateLogged = true; ctx.log('late-after-fixed:' + (dt > 0)) }
}
function onUpdate(ctx, dt) {
  if (!done && ctx.time.elapsed > 1.5) {
    done = true
    const hit = ctx.physics.raycast({ x: 3, y: 5, z: 3 }, { x: 0, y: -1, z: 0 }, 50)
    ctx.log('ray:' + (hit ? hit.node.name + '@' + hit.point.y.toFixed(1) : 'none'))
    ctx.destroy('Victim')
    ctx.log('victim-destroyed:' + (ctx.find('Victim') === null))
  }
}
`,
    props: {},
  })
  st.execute(store.cmdAddObject([mgr], null))
  st.select([])
})
await page.waitForTimeout(300)
const nodeCountBefore = await page.evaluate(() => Object.keys(window.__store.getState().scene.nodes).length)

/* ---------- 再生 ---------- */
await page.getByTitle('Play', { exact: true }).click()
await page.waitForTimeout(3000) // WASM init + 落下 + マネージャの1.5s処理

const logsAndState = await page.evaluate(() => {
  const st = window.__store.getState()
  const names = Object.values(st.scene.nodes).map((n) => n.name)
  return { logs: st.logs.map((l) => l.message), names, count: Object.keys(st.scene.nodes).length }
})
const has = (frag) => logsAndState.logs.some((m) => m.includes(frag))
check('instantiate spawns clone (Proto (1))', has('spawned:Proto (1)') && logsAndState.names.includes('Proto (1)'))
check('coroutine yield 0.3s → done', has('coroutine-done'))
check('onLateUpdate after onFixedUpdate', has('late-after-fixed:true'))
check('onCollisionEnter fired (col:Ground)', has('col:Ground'))
check('onTriggerEnter fired (trig:)', has('trig:'))
check('physics.raycast hit Ground', has('ray:Ground@'))
check('destroy removes Victim during play', has('victim-destroyed:true') && !logsAndState.names.includes('Victim'))
await page.screenshot({ path: `${SCRATCH}/shot-gamelogic.png` })

/* ---------- 停止 → 完全復元 (動的生成物が消え、Victimが戻る) ---------- */
await page.getByTitle('Stop', { exact: true }).click()
await page.waitForTimeout(400)
const after = await page.evaluate(() => {
  const st = window.__store.getState()
  return { names: Object.values(st.scene.nodes).map((n) => n.name), count: Object.keys(st.scene.nodes).length }
})
check('stop removes runtime instances & restores Victim', after.count === nodeCountBefore && after.names.includes('Victim') && !after.names.includes('Proto (1)'))

/* ---------- アニメClip選択 ---------- */
await page.locator('input[type=file][accept*="glb"]').setInputFiles([`${SCRATCH}/test-anim.glb`, `${SCRATCH}/test-tri.obj`])
await page.waitForTimeout(1000)
const animSetup = await page.evaluate(async () => {
  const store = await import('/src/store/editorStore.ts')
  const st = store.useEditorStore.getState()
  const anim = st.assets.find((a) => a.name === 'test-anim.glb')
  const node = store.makeGlbNode(anim.id, anim.name)
  st.execute(store.cmdAddObject([node], null))
  const fresh = store.useEditorStore.getState()
  const idx = fresh.scene.nodes[node.id].components.findIndex((c) => c.type === 'mesh')
  fresh.transientPatchComponent(node.id, idx, { animationClip: 'spin' })
  return node.id
})
await page.waitForTimeout(300)
check('Animation dropdown appears for animated model', (await page.getByText('Animation', { exact: true }).count()) > 0)
await page.getByTitle('Play', { exact: true }).click()
await page.waitForTimeout(800)
const animState = await page.evaluate((id) => {
  const e = window.__engine.mixers.get(id)
  const st = window.__store.getState()
  const node = st.scene.nodes[id]
  return {
    current: e?.current?.getClip().name ?? null,
    rotY: node.transform.rotation.y, // three側で回るだけでSSoTは不変のはず
    threeRotY: window.__engine.objectMap.get(id)?.userData.parts.mesh?.children?.[0]?.rotation?.y ?? window.__engine.objectMap.get(id)?.userData.parts.mesh?.rotation?.y,
  }
}, animSetup)
check(`selected clip plays (current=${animState.current})`, animState.current === 'spin')
await page.getByTitle('Stop', { exact: true }).click()
await page.waitForTimeout(300)

/* ---------- OBJインポート ---------- */
const objOk = await page.evaluate(async () => {
  const store = await import('/src/store/editorStore.ts')
  const st = store.useEditorStore.getState()
  const obj = st.assets.find((a) => a.name === 'test-tri.obj')
  if (!obj || obj.type !== 'obj') return { ok: false }
  const node = store.makeGlbNode(obj.id, obj.name)
  st.execute(store.cmdAddObject([node], null))
  let meshCount = 0
  window.__engine.objectMap.get(node.id)?.traverse((o) => {
    if (o.isMesh && !o.userData.pickProxy) meshCount++
  })
  return { ok: true, meshCount, name: store.useEditorStore.getState().scene.nodes[node.id].name }
})
check(`OBJ import & place (meshes=${objOk.meshCount}, name=${objOk.name})`, objOk.ok && objOk.meshCount >= 1 && objOk.name === 'test-tri')

/* ---------- Is Trigger チェックボックス ---------- */
await page.evaluate(() => {
  const st = window.__store.getState()
  const zone = Object.values(st.scene.nodes).find((n) => n.name === 'TriggerZone')
  st.select([zone.id])
})
await page.waitForTimeout(200)
check('Is Trigger row in Inspector', (await page.getByText('Is Trigger', { exact: true }).count()) > 0)

console.log('page errors:', errors.length === 0 ? 'none' : errors)
await browser.close()
