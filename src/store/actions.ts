/**
 * 高レベル編集アクション (Hierarchyメニュー・ショートカット・ツールバーで共用)。
 * すべて Command 経由で SSoT を変更する。
 */
import type { LightKind, NodeId, PrimitiveKind, SceneNode, Vec3 } from '../types/scene'
import { collectSubtreeIds } from '../types/scene'
import {
  cmdAddObject,
  cmdDeleteObjects,
  cmdDuplicate,
  cmdPatchNode,
  cmdReplaceGraph,
  makeCameraNode,
  makeEmptyNode,
  makeLightNode,
  makePrimitiveNode,
  topmostOnly,
  useEditorStore,
} from './editorStore'
import { addSubtree, cloneSubtree, patchNode, removeSubtree, uniqueSiblingName } from './sceneOps'
import { createPrefabAsset, getPrefabNodes, updatePrefabAsset } from '../engine/assets'
import { buildTemplateFromInstance, mergeTemplateUpdate } from './prefabSync'

const st = () => useEditorStore.getState()

/** Unity同様、作成時に兄弟内で名前を一意化 ("Cube" → "Cube (1)") */
const uniquify = (node: SceneNode, parentId: NodeId | null): SceneNode => {
  node.name = uniqueSiblingName(st().scene, node.name, parentId)
  return node
}

export function createEmpty(parentId: NodeId | null = null) {
  st().execute(cmdAddObject([uniquify(makeEmptyNode(), parentId)], parentId))
}

export function createPrimitive(kind: PrimitiveKind, parentId: NodeId | null = null) {
  const node = uniquify(makePrimitiveNode(kind), parentId)
  st().execute(cmdAddObject([node], parentId))
  st().log('info', `Created ${node.name}`)
}

export function createLight(kind: LightKind, parentId: NodeId | null = null) {
  st().execute(cmdAddObject([uniquify(makeLightNode(kind), parentId)], parentId))
}

export function createCamera(parentId: NodeId | null = null) {
  st().execute(cmdAddObject([uniquify(makeCameraNode(), parentId)], parentId))
}

export function deleteSelection(ids?: NodeId[]) {
  const targets = ids ?? st().selection
  if (targets.length === 0) return
  st().execute(cmdDeleteObjects(targets))
}

export function duplicateSelection(ids?: NodeId[]) {
  const targets = ids ?? st().selection
  if (targets.length === 0) return
  const cmd = cmdDuplicate(targets)
  if (cmd) st().execute(cmd)
}

export function copySelection(ids?: NodeId[]) {
  const targets = topmostOnly(ids ?? st().selection)
  if (targets.length === 0) return
  const scene = st().scene
  const subtrees = targets
    .map((id) => cloneSubtree(scene, id))
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .map((c) => c.nodes)
  st().setClipboard(subtrees)
}

export function pasteClipboard(parentId: NodeId | null = null) {
  const clip = st().clipboard
  if (clip.length === 0) return
  for (const subtree of clip) {
    /* ペーストのたびに新IDを振る (連続ペースト対応) */
    const tmp: Record<string, SceneNode> = {}
    subtree.forEach((n) => (tmp[n.id] = n))
    const re = cloneSubtree({ name: '', nodes: tmp, rootIds: [subtree[0].id] }, subtree[0].id)
    if (re) st().execute(cmdAddObject(re.nodes, parentId))
  }
}

export function renameNode(id: NodeId, newName: string) {
  const node = st().scene.nodes[id]
  const trimmed = newName.trim()
  if (!node || !trimmed || node.name === trimmed) return
  st().execute(cmdPatchNode(id, { name: node.name }, { name: trimmed }, 'Rename'))
}

export function setNodeVisible(id: NodeId, visible: boolean) {
  const node = st().scene.nodes[id]
  if (!node || node.visible === visible) return
  st().execute(cmdPatchNode(id, { visible: node.visible }, { visible }, visible ? 'Activate' : 'Deactivate'))
}

/* ---------------------------------- Prefab v2 (D-029/D-034) ---------------------------------- */

/** テンプレートノード群を新IDで複製し、prefabNodeId をテンプレートIDに設定 (DFS順が対応) */
function reidTemplate(template: SceneNode[]): { nodes: SceneNode[]; rootId: NodeId } | null {
  if (template.length === 0) return null
  const tmp: Record<string, SceneNode> = {}
  template.forEach((n) => (tmp[n.id] = n))
  const re = cloneSubtree({ name: '', nodes: tmp, rootIds: [template[0].id] }, template[0].id)
  if (!re) return null
  re.nodes = re.nodes.map((n, i) => ({ ...n, prefabNodeId: template[i]?.id ?? null }))
  return re
}

/** 選択ノードのサブツリーをプレハブアセット化し、元ノードをインスタンスとしてリンク */
export function createPrefabFromNode(id: NodeId) {
  const g = st().scene
  const node = g.nodes[id]
  if (!node) return
  const built = buildTemplateFromInstance(g, id, [])
  if (!built) return
  const meta = createPrefabAsset(node.name, built.template)
  st().setAssets([...st().assets, meta])
  const after = patchNode(built.graph, id, { prefabId: meta.id })
  st().execute(cmdReplaceGraph(g, after, 'Create Prefab'))
  st().log('info', `Created prefab '${meta.name}' (${built.template.length} node(s))`)
}

/** プレハブをシーンへインスタンス化 */
export function instantiatePrefab(assetId: string, position?: Vec3, parentId: NodeId | null = null): NodeId | null {
  const template = getPrefabNodes(assetId)
  if (!template || template.length === 0) return null
  const re = reidTemplate(template)
  if (!re) return null
  const root = {
    ...re.nodes[0],
    prefabId: assetId,
    name: uniqueSiblingName(st().scene, template[0].name, parentId),
  }
  if (position) root.transform = { ...root.transform, position: { ...position } }
  re.nodes[0] = root
  st().execute(cmdAddObject(re.nodes, parentId))
  return re.rootId
}

/**
 * Apply (v2): インスタンスの現状からテンプレートを再構築してアセットへ書き戻し、
 * 他インスタンスへは3方向マージで伝播 — 各インスタンスのオーバーライドは保持される。
 * シーン側の変更は1コマンドでUndo可能 (アセット更新はUnity同様Undo対象外)。
 */
export function applyToPrefab(instanceRootId: NodeId) {
  const g = st().scene
  const inst = g.nodes[instanceRootId]
  const assetId = inst?.prefabId
  if (!inst || !assetId) return
  const oldTemplate = getPrefabNodes(assetId) ?? []
  const built = buildTemplateFromInstance(g, instanceRootId, oldTemplate)
  if (!built) return
  if (!updatePrefabAsset(assetId, built.template)) return
  st().setAssets(st().assets.map((a) => (a.id === assetId ? { ...a, size: JSON.stringify(built.template).length } : a)))

  let after = built.graph
  let others = 0
  for (const [nid, n] of Object.entries(g.nodes)) {
    if (n.prefabId === assetId && nid !== instanceRootId && after.nodes[nid]) {
      after = mergeTemplateUpdate(after, nid, oldTemplate, built.template)
      others++
    }
  }
  if (after !== g) st().execute(cmdReplaceGraph(g, after, 'Apply Prefab'))
  st().log('info', `Applied to prefab — ${others} other instance(s) merged (overrides preserved)`)
}

/**
 * Revert (v2): 全オーバーライドを破棄しテンプレートへ戻す。
 * root の id/transform/name/visible/親位置 は維持 (Unityのインスタンス所有プロパティ)。
 */
export function revertToPrefab(instanceRootId: NodeId) {
  const g = st().scene
  const inst = g.nodes[instanceRootId]
  const assetId = inst?.prefabId
  if (!inst || !assetId) return
  const template = getPrefabNodes(assetId)
  if (!template || template.length === 0) return
  const re = reidTemplate(template)
  if (!re) return

  const keepParent = inst.parentId
  const siblings = keepParent ? (g.nodes[keepParent]?.childrenIds ?? []) : g.rootIds
  const index = siblings.indexOf(instanceRootId)

  /* root は既存IDを維持して選択やUndo参照を壊さない */
  const oldRootId = re.nodes[0].id
  re.nodes = re.nodes.map((n, i) =>
    i === 0
      ? {
          ...n,
          id: instanceRootId,
          prefabId: assetId,
          transform: structuredClone(inst.transform),
          name: inst.name,
          visible: inst.visible,
        }
      : { ...n, parentId: n.parentId === oldRootId ? instanceRootId : n.parentId },
  )
  let after = removeSubtree(g, instanceRootId).graph
  after = addSubtree(after, re.nodes, keepParent, index)
  st().execute(cmdReplaceGraph(g, after, 'Revert Prefab'))
}

/** Unpack: プレハブリンクを解除して通常のノードにする (配下のtidも除去) */
export function unpackPrefab(instanceRootId: NodeId) {
  const g = st().scene
  const inst = g.nodes[instanceRootId]
  if (!inst?.prefabId) return
  let after = patchNode(g, instanceRootId, { prefabId: null })
  for (const nid of collectSubtreeIds(g.nodes, instanceRootId)) {
    if (after.nodes[nid]?.prefabNodeId) after = patchNode(after, nid, { prefabNodeId: null })
  }
  st().execute(cmdReplaceGraph(g, after, 'Unpack Prefab'))
}
