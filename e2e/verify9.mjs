/* 実走検証 9: Prefabシステム v1 (作成/インスタンス化/Apply/Revert/Unpack/永続化) + ライフサイクル完全順序 (D-029/D-030) */
import { chromium } from 'playwright-core'
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const check = (label, cond) => console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}`)

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)

/* ---------- 1. プレハブ作成 ---------- */
const created = await page.evaluate(async () => {
  const store = await import('/src/store/editorStore.ts')
  const acts = await import('/src/store/actions.ts')
  const st = store.useEditorStore.getState()
  acts.createPrimitive('box', null)
  const cubeId = store.useEditorStore.getState().selection[0]
  // 赤いマテリアルにしてからプレハブ化
  const fresh = store.useEditorStore.getState()
  const idx = fresh.scene.nodes[cubeId].components.findIndex((c) => c.type === 'material')
  fresh.transientPatchComponent(cubeId, idx, { color: '#ff0000' })
  acts.createPrefabFromNode(cubeId)
  const after = store.useEditorStore.getState()
  return {
    cubeId,
    prefabId: after.scene.nodes[cubeId].prefabId,
    asset: after.assets.find((a) => a.type === 'prefab')?.name ?? null,
  }
})
check(`Create Prefab → asset '${created.asset}'`, created.asset === 'Cube.prefab' && !!created.prefabId)
await page.waitForTimeout(200)
check('hierarchy row marked as prefab (blue)', (await page.locator('.u-tree-row[data-prefab="true"]').count()) >= 1)

/* ---------- 2. インスタンス化 x2 ---------- */
const inst = await page.evaluate(async (prefabId) => {
  const acts = await import('/src/store/actions.ts')
  const store = await import('/src/store/editorStore.ts')
  const a = acts.instantiatePrefab(prefabId, { x: 3, y: 0, z: 0 })
  const b = acts.instantiatePrefab(prefabId, { x: -3, y: 0, z: 0 })
  const st = store.useEditorStore.getState()
  return { a, b, names: [st.scene.nodes[a]?.name, st.scene.nodes[b]?.name], linked: st.scene.nodes[a]?.prefabId === prefabId }
}, created.prefabId)
check(`instantiate x2 (${inst.names.join(', ')})`, !!inst.a && !!inst.b && inst.linked)
check('unique names for instances', inst.names[0] !== inst.names[1])

/* ---------- 3. Apply: インスタンスAを緑に → 他インスタンスへ伝播 ---------- */
const applied = await page.evaluate(async ({ a, prefabId, cubeId }) => {
  const store = await import('/src/store/editorStore.ts')
  const acts = await import('/src/store/actions.ts')
  const assets = await import('/src/engine/assets.ts')
  const st = store.useEditorStore.getState()
  const idx = st.scene.nodes[a].components.findIndex((c) => c.type === 'material')
  st.transientPatchComponent(a, idx, { color: '#00ff00' })
  acts.applyToPrefab(a)
  const fresh = store.useEditorStore.getState()
  const colorOf = (id) => Object.values(fresh.scene.nodes).find((n) => n.name === fresh.scene.nodes[id]?.name)?.components.find((c) => c.type === 'material')?.color
  // 元Cube と インスタンスB は再構築されるためIDが変わる — 名前で探す
  const all = Object.values(fresh.scene.nodes).filter((n) => n.prefabId === prefabId)
  const colors = all.map((n) => n.components.find((c) => c.type === 'material')?.color)
  const template = assets.getPrefabNodes(prefabId)
  return { colors, templateColor: template[0].components.find((c) => c.type === 'material')?.color, undoName: fresh.undoStack.at(-1)?.name, count: all.length }
}, { a: inst.a, prefabId: created.prefabId, cubeId: created.cubeId })
check(`Apply propagates to all ${applied.count} instances (${applied.colors.join(',')})`, applied.count === 3 && applied.colors.every((c) => c === '#00ff00'))
check('prefab asset template updated', applied.templateColor === '#00ff00')
check('Apply is one undoable command', applied.undoName === 'Apply Prefab')

/* ---------- 4. Undo で伝播取り消し ---------- */
await page.keyboard.press('Control+z')
await page.waitForTimeout(250)
const afterUndo = await page.evaluate((prefabId) => {
  const st = window.__store.getState()
  const all = Object.values(st.scene.nodes).filter((n) => n.prefabId === prefabId)
  return all.map((n) => n.components.find((c) => c.type === 'material')?.color).sort()
}, created.prefabId)
check(`undo Apply restores others to red (${afterUndo.join(',')})`, afterUndo.filter((c) => c === '#ff0000').length === 2)
await page.keyboard.press('Control+y')
await page.waitForTimeout(250)

/* ---------- 5. Revert: インスタンスを青+移動 → Revertで色は戻り位置は維持 ---------- */
const reverted = await page.evaluate(async (prefabId) => {
  const store = await import('/src/store/editorStore.ts')
  const acts = await import('/src/store/actions.ts')
  const st = store.useEditorStore.getState()
  const target = Object.values(st.scene.nodes).find((n) => n.prefabId === prefabId && n.transform.position.x === 3)
  const idx = target.components.findIndex((c) => c.type === 'material')
  st.transientPatchComponent(target.id, idx, { color: '#0000ff' })
  st.transientSetTransform(target.id, { ...target.transform, position: { x: 5, y: 1, z: 0 } })
  acts.revertToPrefab(target.id)
  const fresh = store.useEditorStore.getState()
  const now = Object.values(fresh.scene.nodes).find((n) => n.prefabId === prefabId && n.transform.position.x === 5)
  return { color: now?.components.find((c) => c.type === 'material')?.color, pos: now?.transform.position }
}, created.prefabId)
check(`Revert restores color (${reverted.color}) but keeps position (x=${reverted.pos?.x})`, reverted.color === '#00ff00' && reverted.pos?.x === 5 && reverted.pos?.y === 1)

/* ---------- 6. Unpack ---------- */
const unpacked = await page.evaluate(async (prefabId) => {
  const store = await import('/src/store/editorStore.ts')
  const acts = await import('/src/store/actions.ts')
  const st = store.useEditorStore.getState()
  const target = Object.values(st.scene.nodes).find((n) => n.prefabId === prefabId)
  acts.unpackPrefab(target.id)
  return store.useEditorStore.getState().scene.nodes[target.id].prefabId
}, created.prefabId)
check('Unpack clears prefab link', unpacked === null)

/* ---------- 7. JSON往復でプレハブアセット+リンク保持 ---------- */
const rt = await page.evaluate(async (prefabId) => {
  const mod = await import('/src/engine/serialization.ts')
  const assets = await import('/src/engine/assets.ts')
  const json = JSON.stringify(mod.serializeScene())
  await mod.importSceneFromJson(json)
  const st = window.__store.getState()
  const stillLinked = Object.values(st.scene.nodes).filter((n) => n.prefabId === prefabId).length
  const template = assets.getPrefabNodes(prefabId)
  return { stillLinked, templateOk: template?.[0]?.components.some((c) => c.type === 'material') ?? false }
}, created.prefabId)
check(`roundtrip keeps ${rt.stillLinked} linked instances + prefab asset`, rt.stillLinked === 2 && rt.templateOk)

/* ---------- 8. ライフサイクル完全順序 (Awake→OnEnable→Start / OnDisable→OnDestroy) ---------- */
await page.evaluate(async () => {
  const scene = await import('/src/types/scene.ts')
  const store = await import('/src/store/editorStore.ts')
  const st = store.useEditorStore.getState()
  const node = store.makeEmptyNode('LifecycleProbe')
  node.components.push({
    ...scene.defaultScript('Probe'),
    code: `
function onAwake(ctx) { ctx.log('LC:awake') }
function onEnable(ctx) { ctx.log('LC:enable') }
function onStart(ctx) { ctx.log('LC:start') }
function onDisable(ctx) { ctx.log('LC:disable') }
function onDestroy(ctx) { ctx.log('LC:destroy') }
`,
    props: {},
  })
  st.execute(store.cmdAddObject([node], null))
})
await page.getByTitle('Play', { exact: true }).click()
await page.waitForTimeout(800)
await page.getByTitle('Stop', { exact: true }).click()
await page.waitForTimeout(400)
const lcOrder = await page.evaluate(() => {
  const msgs = window.__store.getState().logs.map((l) => l.message).filter((m) => m.includes('LC:'))
  return msgs.map((m) => m.split('LC:')[1])
})
check(`lifecycle order awake→enable→start→disable→destroy (${lcOrder.join('→')})`, JSON.stringify(lcOrder) === JSON.stringify(['awake', 'enable', 'start', 'disable', 'destroy']))

console.log('page errors:', errors.length === 0 ? 'none' : errors)
await browser.close()
