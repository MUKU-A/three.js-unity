/**
 * 高レベル編集アクション (Hierarchyメニュー・ショートカット・ツールバーで共用)。
 * すべて Command 経由で SSoT を変更する。
 */
import type { LightKind, NodeId, PrimitiveKind, SceneGraph, SceneNode, Vec3 } from '../types/scene'
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
import { addSubtree, cloneSubtree, removeSubtree, uniqueSiblingName } from './sceneOps'
import { createPrefabAsset, getPrefabNodes, updatePrefabAsset } from '../engine/assets'

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

/* ---------------------------------- Prefab (D-029) ---------------------------------- */

/** テンプレートノード群を新IDで複製 (ルート名は呼び側で上書きする) */
function reidTemplate(template: SceneNode[]): { nodes: SceneNode[]; rootId: NodeId } | null {
  if (template.length === 0) return null
  const tmp: Record<string, SceneNode> = {}
  template.forEach((n) => (tmp[n.id] = n))
  return cloneSubtree({ name: '', nodes: tmp, rootIds: [template[0].id] }, template[0].id)
}

/** 選択ノードのサブツリーをプレハブアセット化し、元ノードをインスタンスとしてリンク */
export function createPrefabFromNode(id: NodeId) {
  const g = st().scene
  const node = g.nodes[id]
  if (!node) return
  const nodes = collectSubtreeIds(g.nodes, id).map((i) => structuredClone(g.nodes[i]))
  nodes[0] = { ...nodes[0], parentId: null, prefabId: null }
  const meta = createPrefabAsset(node.name, nodes)
  st().setAssets([...st().assets, meta])
  st().execute(cmdPatchNode(id, { prefabId: node.prefabId ?? null }, { prefabId: meta.id }, 'Create Prefab'))
  st().log('info', `Created prefab '${meta.name}' (${nodes.length} node(s))`)
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

/** インスタンス1つをテンプレートから再構築 (root の transform/name/visible/位置は維持) */
function replaceInstanceSubtree(graph: SceneGraph, instanceRootId: NodeId, assetId: string): SceneGraph {
  const inst = graph.nodes[instanceRootId]
  const template = getPrefabNodes(assetId)
  if (!inst || !template || template.length === 0) return graph
  const keep = { transform: inst.transform, name: inst.name, visible: inst.visible }
  const parentId = inst.parentId
  const siblings = parentId ? (graph.nodes[parentId]?.childrenIds ?? []) : graph.rootIds
  const index = siblings.indexOf(instanceRootId)
  const re = reidTemplate(template)
  if (!re) return graph
  re.nodes[0] = { ...re.nodes[0], ...keep, prefabId: assetId }
  const removed = removeSubtree(graph, instanceRootId).graph
  return addSubtree(removed, re.nodes, parentId, index)
}

/**
 * Apply: このインスタンスの内容をプレハブアセットへ書き戻し、他の全インスタンスへ伝播。
 * v1仕様: プロパティ単位の差分ではなく全体置換。他インスタンスの root transform/name/visible は維持。
 * アセット更新自体はUnity同様Undo対象外、シーン側の伝播は1コマンドでUndo可能。
 */
export function applyToPrefab(instanceRootId: NodeId) {
  const g = st().scene
  const inst = g.nodes[instanceRootId]
  const assetId = inst?.prefabId
  if (!inst || !assetId) return
  const prevTemplate = getPrefabNodes(assetId)
  const nodes = collectSubtreeIds(g.nodes, instanceRootId).map((i) => structuredClone(g.nodes[i]))
  nodes[0] = {
    ...nodes[0],
    parentId: null,
    prefabId: null,
    /* プレハブ自体のroot transform/名前は維持 (rootのTransformはインスタンス毎の値というUnity意味論) */
    transform: prevTemplate?.[0]?.transform ?? nodes[0].transform,
    name: prevTemplate?.[0]?.name ?? nodes[0].name,
  }
  if (!updatePrefabAsset(assetId, nodes)) return
  st().setAssets(st().assets.map((a) => (a.id === assetId ? { ...a, size: JSON.stringify(nodes).length } : a)))

  let after = g
  for (const [nid, n] of Object.entries(g.nodes)) {
    if (n.prefabId === assetId && nid !== instanceRootId) after = replaceInstanceSubtree(after, nid, assetId)
  }
  if (after !== g) st().execute(cmdReplaceGraph(g, after, 'Apply Prefab'))
  st().log('info', `Applied changes to prefab — ${countInstances(assetId) - 1} other instance(s) updated`)
}

/** Revert: インスタンスをプレハブの内容へ戻す (root transform/name/visible は維持) */
export function revertToPrefab(instanceRootId: NodeId) {
  const g = st().scene
  const inst = g.nodes[instanceRootId]
  if (!inst?.prefabId) return
  const after = replaceInstanceSubtree(g, instanceRootId, inst.prefabId)
  if (after !== g) st().execute(cmdReplaceGraph(g, after, 'Revert Prefab'))
}

/** Unpack: プレハブリンクを解除して通常のノードにする */
export function unpackPrefab(instanceRootId: NodeId) {
  const inst = st().scene.nodes[instanceRootId]
  if (!inst?.prefabId) return
  st().execute(cmdPatchNode(instanceRootId, { prefabId: inst.prefabId }, { prefabId: null }, 'Unpack Prefab'))
}

const countInstances = (assetId: string) =>
  Object.values(st().scene.nodes).filter((n) => n.prefabId === assetId).length
