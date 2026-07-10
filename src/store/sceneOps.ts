/**
 * SceneGraph に対する純粋・イミュータブルな操作関数群。
 * ここだけがシーングラフの構造変更方法を知っている (Command と serialization が利用)。
 */
import type { Component, NodeId, SceneGraph, SceneNode } from '../types/scene'
import { collectSubtreeIds, newId } from '../types/scene'

/** 親の childrenIds (または rootIds) から id を除いた新配列 */
const removeFromSiblings = (list: NodeId[], id: NodeId) => list.filter((x) => x !== id)

const insertAt = (list: NodeId[], id: NodeId, index: number | null) => {
  const next = [...list]
  if (index === null || index < 0 || index > next.length) next.push(id)
  else next.splice(index, 0, id)
  return next
}

/** サブツリー(複数ノードの束)を追加。nodes[0] がサブツリーのルートであること */
export function addSubtree(
  graph: SceneGraph,
  subtree: SceneNode[],
  parentId: NodeId | null,
  index: number | null = null,
): SceneGraph {
  if (subtree.length === 0) return graph
  const root = subtree[0]
  const nodes = { ...graph.nodes }
  for (const n of subtree) nodes[n.id] = n
  nodes[root.id] = { ...root, parentId }

  if (parentId === null) {
    return { ...graph, nodes, rootIds: insertAt(graph.rootIds, root.id, index) }
  }
  const parent = nodes[parentId]
  if (!parent) return graph
  nodes[parentId] = { ...parent, childrenIds: insertAt(parent.childrenIds, root.id, index) }
  return { ...graph, nodes, rootIds: [...graph.rootIds] }
}

/** サブツリーを取り除く。undo 用に除去したノード束と位置を返す */
export function removeSubtree(
  graph: SceneGraph,
  rootId: NodeId,
): { graph: SceneGraph; removed: SceneNode[]; parentId: NodeId | null; index: number } {
  const node = graph.nodes[rootId]
  if (!node) return { graph, removed: [], parentId: null, index: -1 }

  const ids = collectSubtreeIds(graph.nodes, rootId)
  const removed = ids.map((id) => graph.nodes[id])
  const nodes = { ...graph.nodes }
  for (const id of ids) delete nodes[id]

  let rootIds = graph.rootIds
  let index: number
  if (node.parentId === null) {
    index = graph.rootIds.indexOf(rootId)
    rootIds = removeFromSiblings(graph.rootIds, rootId)
  } else {
    const parent = nodes[node.parentId]
    index = parent ? parent.childrenIds.indexOf(rootId) : -1
    if (parent) nodes[node.parentId] = { ...parent, childrenIds: removeFromSiblings(parent.childrenIds, rootId) }
  }
  return { graph: { ...graph, nodes, rootIds }, removed, parentId: node.parentId, index }
}

/** 親子付け替え + 兄弟内並べ替え */
export function reparent(
  graph: SceneGraph,
  id: NodeId,
  newParentId: NodeId | null,
  index: number | null,
): SceneGraph {
  const node = graph.nodes[id]
  if (!node) return graph
  const nodes = { ...graph.nodes }
  let rootIds = [...graph.rootIds]

  // 1) 現位置から外す
  if (node.parentId === null) {
    rootIds = removeFromSiblings(rootIds, id)
  } else {
    const oldParent = nodes[node.parentId]
    if (oldParent) nodes[node.parentId] = { ...oldParent, childrenIds: removeFromSiblings(oldParent.childrenIds, id) }
  }
  // 2) 新位置へ挿す
  nodes[id] = { ...node, parentId: newParentId }
  if (newParentId === null) {
    rootIds = insertAt(rootIds, id, index)
  } else {
    const newParent = nodes[newParentId]
    if (!newParent) return graph
    nodes[newParentId] = { ...newParent, childrenIds: insertAt(newParent.childrenIds, id, index) }
  }
  return { ...graph, nodes, rootIds }
}

/** ノードの浅いプロパティ更新 (name / visible / transform / components) */
export function patchNode(graph: SceneGraph, id: NodeId, patch: Partial<SceneNode>): SceneGraph {
  const node = graph.nodes[id]
  if (!node) return graph
  return { ...graph, nodes: { ...graph.nodes, [id]: { ...node, ...patch } } }
}

/** components 配列内の1コンポーネントを差し替え */
export function patchComponent(
  graph: SceneGraph,
  id: NodeId,
  componentIndex: number,
  patch: Partial<Component>,
): SceneGraph {
  const node = graph.nodes[id]
  if (!node || !node.components[componentIndex]) return graph
  const components = node.components.map((c, i) => (i === componentIndex ? ({ ...c, ...patch } as Component) : c))
  return patchNode(graph, id, { components })
}

export function addComponent(graph: SceneGraph, id: NodeId, component: Component): SceneGraph {
  const node = graph.nodes[id]
  if (!node) return graph
  return patchNode(graph, id, { components: [...node.components, component] })
}

export function removeComponentAt(graph: SceneGraph, id: NodeId, componentIndex: number): SceneGraph {
  const node = graph.nodes[id]
  if (!node) return graph
  return patchNode(graph, id, { components: node.components.filter((_, i) => i !== componentIndex) })
}

/** サブツリーの複製 (新IDを振り直し、"name (1)" 方式で命名) */
export function cloneSubtree(
  graph: SceneGraph,
  rootId: NodeId,
): { nodes: SceneNode[]; rootId: NodeId } | null {
  const src = graph.nodes[rootId]
  if (!src) return null
  const idMap = new Map<NodeId, NodeId>()
  const ids = collectSubtreeIds(graph.nodes, rootId)
  for (const id of ids) idMap.set(id, newId())

  const cloned: SceneNode[] = ids.map((id) => {
    const n = graph.nodes[id]
    return {
      ...structuredClone(n),
      id: idMap.get(id)!,
      parentId: n.parentId && idMap.has(n.parentId) ? idMap.get(n.parentId)! : n.parentId,
      childrenIds: n.childrenIds.map((c) => idMap.get(c)!),
    }
  })
  cloned[0] = { ...cloned[0], name: duplicateName(graph, src.name, src.parentId) }
  return { nodes: cloned, rootId: idMap.get(rootId)! }
}

/** Unity風の複製名: "Cube" → "Cube (1)" → "Cube (2)" */
function duplicateName(graph: SceneGraph, base: string, parentId: NodeId | null): string {
  const stripped = base.replace(/ \(\d+\)$/, '')
  const siblings = parentId === null ? graph.rootIds : (graph.nodes[parentId]?.childrenIds ?? [])
  const names = new Set(siblings.map((id) => graph.nodes[id]?.name))
  let i = 1
  let candidate = `${stripped} (${i})`
  while (names.has(candidate)) {
    i++
    candidate = `${stripped} (${i})`
  }
  return candidate
}
