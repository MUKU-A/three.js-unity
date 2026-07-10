/* 実走検証 13: Prefab v2 — 差分オーバーライド3方向マージ / Nested / プレハブバー (D-034) */
import { chromium } from 'playwright-core'
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const check = (label, cond) => console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}`)

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)

/* ---------- セットアップ: Rigプレハブ (cube+child sphere) → A/B 2インスタンス ---------- */
const ids = await page.evaluate(async () => {
  const store = await import('/src/store/editorStore.ts')
  const acts = await import('/src/store/actions.ts')
  const st = store.useEditorStore.getState()
  acts.createPrimitive('box', null)
  const srcId = store.useEditorStore.getState().selection[0]
  store.useEditorStore.getState().execute(store.cmdPatchNode(srcId, { name: 'Cube' }, { name: 'Rig' }, 'Rename'))
  acts.createPrimitive('sphere', srcId)
  acts.createPrefabFromNode(srcId)
  const prefabId = store.useEditorStore.getState().scene.nodes[srcId].prefabId
  const a = acts.instantiatePrefab(prefabId, { x: 5, y: 0, z: 0 })
  const b = acts.instantiatePrefab(prefabId, { x: -5, y: 0, z: 0 })
  return { srcId, prefabId, a, b }
})
check('prefab created + 2 instances', !!ids.prefabId && !!ids.a && !!ids.b)

/* ---------- B にオーバーライド: 色=青 / cone追加 / root移動 ---------- */
await page.evaluate(async ({ b }) => {
  const store = await import('/src/store/editorStore.ts')
  const acts = await import('/src/store/actions.ts')
  const st = store.useEditorStore.getState()
  const idx = st.scene.nodes[b].components.findIndex((c) => c.type === 'material')
  st.execute(store.cmdPatchComponent(b, idx, { color: '#ffffff' }, { color: '#0000ff' }, 'Set Color'))
  acts.createPrimitive('cone', b)
  store.useEditorStore.getState().transientSetTransform(b, {
    position: { x: -8, y: 1, z: 2 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
  })
}, ids)

/* Inspectorプレハブバー表示 */
await page.evaluate((b) => window.__store.getState().select([b]), ids.b)
await page.waitForTimeout(300)
const barText = await page.getByText(/Overrides \(\d+\)/).textContent().catch(() => null)
check(`prefab bar shows override count (${barText})`, /Overrides \([1-9]\d*\)/.test(barText ?? ''))

/* ---------- A で roughness=0.9 + cylinder追加 → Apply ---------- */
await page.evaluate(async ({ a }) => {
  const store = await import('/src/store/editorStore.ts')
  const acts = await import('/src/store/actions.ts')
  const st = store.useEditorStore.getState()
  const idx = st.scene.nodes[a].components.findIndex((c) => c.type === 'material')
  st.execute(store.cmdPatchComponent(a, idx, { roughness: 0.5 }, { roughness: 0.9 }, 'Set Roughness'))
  acts.createPrimitive('cylinder', a)
  acts.applyToPrefab(a)
}, ids)
await page.waitForTimeout(300)

const merged = await page.evaluate(async ({ b, prefabId }) => {
  const assets = await import('/src/engine/assets.ts')
  const st = window.__store.getState()
  const bNode = st.scene.nodes[b]
  const mat = bNode.components.find((c) => c.type === 'material')
  const childNames = bNode.childrenIds.map((c) => st.scene.nodes[c]?.name).sort()
  const cyl = bNode.childrenIds.map((c) => st.scene.nodes[c]).find((n) => n?.name === 'Cylinder')
  const template = assets.getPrefabNodes(prefabId)
  return {
    roughness: mat.roughness,
    color: mat.color,
    childNames,
    cylHasTid: !!cyl?.prefabNodeId,
    pos: bNode.transform.position,
    templateRoughness: template[0].components.find((c) => c.type === 'material')?.roughness,
    templateCount: template.length,
  }
}, ids)
check(`B follows non-overridden prop (roughness=${merged.roughness})`, merged.roughness === 0.9)
check(`B keeps override (color=${merged.color})`, merged.color === '#0000ff')
check(`B keeps user-added Cone + receives template Cylinder (${merged.childNames.join(',')})`, merged.childNames.includes('Cone') && merged.childNames.includes('Cylinder') && merged.childNames.includes('Sphere'))
check('received node is linked (prefabNodeId)', merged.cylHasTid)
check(`B root position untouched (x=${merged.pos.x})`, merged.pos.x === -8)
check(`template updated (roughness=${merged.templateRoughness}, ${merged.templateCount} nodes)`, merged.templateRoughness === 0.9 && merged.templateCount === 3)

/* ---------- Undo/Redo (Applyのシーン側伝播が1コマンド) ---------- */
await page.keyboard.press('Control+z')
await page.waitForTimeout(250)
const afterUndo = await page.evaluate((b) => {
  const st = window.__store.getState()
  const bNode = st.scene.nodes[b]
  return {
    roughness: bNode.components.find((c) => c.type === 'material').roughness,
    hasCyl: bNode.childrenIds.some((c) => st.scene.nodes[c]?.name === 'Cylinder'),
    undoName: st.undoStack.at(-1)?.name ?? st.redoStack.at(-1)?.name,
  }
}, ids.b)
check(`undo Apply → B back to pre-merge (roughness=${afterUndo.roughness}, cyl=${afterUndo.hasCyl})`, afterUndo.roughness === 0.5 && !afterUndo.hasCyl)
await page.keyboard.press('Control+y')
await page.waitForTimeout(250)

/* ---------- Revert B: オーバーライド破棄・root transform維持 ---------- */
await page.evaluate(async (b) => {
  const acts = await import('/src/store/actions.ts')
  acts.revertToPrefab(b)
}, ids.b)
await page.waitForTimeout(300)
const reverted = await page.evaluate((b) => {
  const st = window.__store.getState()
  const bNode = st.scene.nodes[b]
  const mat = bNode.components.find((c) => c.type === 'material')
  return {
    exists: !!bNode,
    color: mat.color,
    roughness: mat.roughness,
    childNames: bNode.childrenIds.map((c) => st.scene.nodes[c]?.name).sort(),
    pos: bNode.transform.position,
  }
}, ids.b)
check(`Revert: color back to template (${reverted.color}), roughness kept 0.9`, reverted.exists && reverted.color === '#ffffff' && reverted.roughness === 0.9)
check(`Revert: user Cone removed, template children remain (${reverted.childNames.join(',')})`, !reverted.childNames.includes('Cone') && reverted.childNames.includes('Cylinder') && reverted.childNames.includes('Sphere'))
check('Revert: root transform kept', reverted.pos.x === -8)

/* ---------- Nested Prefab ---------- */
const nested = await page.evaluate(async () => {
  const store = await import('/src/store/editorStore.ts')
  const acts = await import('/src/store/actions.ts')
  acts.createPrimitive('sphere', null)
  const s = store.useEditorStore.getState().selection[0]
  acts.createPrefabFromNode(s)
  const p1 = store.useEditorStore.getState().scene.nodes[s].prefabId
  const inner = acts.instantiatePrefab(p1, { x: 0, y: 0, z: 0 })
  acts.createPrimitive('box', null)
  const outer = store.useEditorStore.getState().selection[0]
  // inner を outer の子にしてから P2 化
  store.useEditorStore.getState().execute(store.cmdReparent(inner, outer, null))
  acts.createPrefabFromNode(outer)
  const p2 = store.useEditorStore.getState().scene.nodes[outer].prefabId
  const inst2 = acts.instantiatePrefab(p2, { x: 10, y: 0, z: 0 })
  const st = store.useEditorStore.getState()
  const innerOfInst2 = st.scene.nodes[inst2].childrenIds.map((c) => st.scene.nodes[c]).find((n) => n?.prefabId === p1)
  return { linked: !!innerOfInst2, p1, p2 }
})
check('Nested Prefab: inner instance keeps its own prefab link', nested.linked)

/* ---------- JSON往復で prefabNodeId 保持 ---------- */
const rt = await page.evaluate(async (b) => {
  const mod = await import('/src/engine/serialization.ts')
  const json = JSON.stringify(mod.serializeScene())
  await mod.importSceneFromJson(json)
  const st = window.__store.getState()
  const bNode = st.scene.nodes[b]
  return { ok: !!bNode && bNode.childrenIds.every((c) => !!st.scene.nodes[c]?.prefabNodeId) }
}, ids.b)
check('roundtrip keeps prefabNodeId mapping', rt.ok)

console.log('page errors:', errors.length === 0 ? 'none' : errors)
await browser.close()
