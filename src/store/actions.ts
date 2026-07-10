/**
 * 高レベル編集アクション (Hierarchyメニュー・ショートカット・ツールバーで共用)。
 * すべて Command 経由で SSoT を変更する。
 */
import type { LightKind, NodeId, PrimitiveKind, SceneNode } from '../types/scene'
import {
  cmdAddObject,
  cmdDeleteObjects,
  cmdDuplicate,
  cmdPatchNode,
  makeCameraNode,
  makeEmptyNode,
  makeLightNode,
  makePrimitiveNode,
  topmostOnly,
  useEditorStore,
} from './editorStore'
import { cloneSubtree, uniqueSiblingName } from './sceneOps'

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
