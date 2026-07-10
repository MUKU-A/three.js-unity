/**
 * エディタの Single Source of Truth (Zustand)。
 * - シーンの正はここ (scene: SceneGraph)。Three.js は engine/ThreeEngine が購読して派生させる。
 * - すべての編集は Command 経由 (execute / pushApplied)。transient* はドラッグ中のみの例外で、
 *   ドラッグ終了時に必ず pushApplied で1コマンドとして履歴に載せる (D-005)。
 * - 再生モードはスナップショット + 履歴トランケートで完全復元 (D-006)。
 */
import { create } from 'zustand'
import type { AssetMeta, Component, NodeId, SceneGraph, SceneNode, Transform } from '../types/scene'
import { defaultCamera, defaultLight, defaultTransform, newId, vec3 } from '../types/scene'
import { clearAssets } from '../engine/assets'
import * as ops from './sceneOps'

/* ---------------------------------- Command ---------------------------------- */

export interface Command {
  name: string
  apply(): void
  revert(): void
}

/* ---------------------------------- Logs ---------------------------------- */

export type LogLevel = 'info' | 'warn' | 'error'
export interface LogEntry {
  id: number
  level: LogLevel
  message: string
  time: string
}
let logId = 0

/* ---------------------------------- Store ---------------------------------- */

export type Tool = 'move' | 'rotate' | 'scale'
export type EditorMode = 'edit' | 'play' | 'paused'
export type ShadingMode = 'shaded' | 'wireframe'

interface PlaySnapshot {
  scene: SceneGraph
  selection: NodeId[]
  undoLen: number
  redoLen: number
}

export interface EditorState {
  scene: SceneGraph
  assets: AssetMeta[]
  selection: NodeId[] // 順序付き。末尾 = アクティブ
  expanded: Record<NodeId, boolean>
  renamingId: NodeId | null
  tool: Tool
  transformSpace: 'local' | 'world'
  mode: EditorMode
  logs: LogEntry[]
  clearOnPlay: boolean
  showGrid: boolean
  shadingMode: ShadingMode
  /** F キー: インクリメントで engine にフォーカス要求を伝える */
  focusRequestId: number
  clipboard: SceneNode[][] // コピーされたサブツリー群 (各要素の[0]がルート)

  undoStack: Command[]
  redoStack: Command[]
  playSnapshot: PlaySnapshot | null

  /* --- history --- */
  execute(cmd: Command): void
  /** 既に適用済みの変更を履歴に積む (ギズモ/スクラブのドラッグ終了時) */
  pushApplied(cmd: Command): void
  undo(): void
  redo(): void

  /* --- transient (履歴に載せない一時更新。ドラッグ中専用) --- */
  transientPatchNode(id: NodeId, patch: Partial<SceneNode>): void
  transientPatchComponent(id: NodeId, componentIndex: number, patch: Partial<Component>): void
  transientSetTransform(id: NodeId, transform: Transform): void
  /** ランタイム動的生成/破棄 (Instantiate/Destroy, 履歴に載せない。停止時にスナップショットで消える) */
  transientAddSubtree(nodes: SceneNode[], parentId: NodeId | null): void
  transientRemoveSubtree(id: NodeId): void

  /* --- scene全置換 (ロード時) --- */
  replaceScene(scene: SceneGraph, assets: AssetMeta[]): void

  /* --- selection --- */
  select(ids: NodeId[]): void
  toggleSelect(id: NodeId): void
  clearSelection(): void

  /* --- ui --- */
  setExpanded(id: NodeId, v: boolean): void
  setRenaming(id: NodeId | null): void
  setTool(t: Tool): void
  setTransformSpace(s: 'local' | 'world'): void
  setShowGrid(v: boolean): void
  setShadingMode(m: ShadingMode): void
  /** File > New Scene: 初期シーンへ戻す (アセット・履歴もクリア) */
  newScene(): void
  requestFocus(): void
  setClipboard(subtrees: SceneNode[][]): void
  setAssets(assets: AssetMeta[]): void
  setSceneName(name: string): void

  /* --- play mode --- */
  play(): void
  pause(): void
  stop(): void

  /* --- console --- */
  log(level: LogLevel, message: string): void
  clearLogs(): void
  setClearOnPlay(v: boolean): void
}

/* Unity の新規シーン相当: Main Camera + Directional Light */
function initialScene(): SceneGraph {
  const camId = newId()
  const lightId = newId()
  const cam: SceneNode = {
    id: camId,
    name: 'Main Camera',
    visible: true,
    parentId: null,
    childrenIds: [],
    transform: { position: vec3(0, 1, -10), rotation: vec3(0, 0, 0), scale: vec3(1, 1, 1) },
    components: [defaultCamera()],
  }
  const light: SceneNode = {
    id: lightId,
    name: 'Directional Light',
    visible: true,
    parentId: null,
    childrenIds: [],
    transform: { position: vec3(0, 3, 0), rotation: vec3(50, -30, 0), scale: vec3(1, 1, 1) },
    components: [defaultLight('directional')],
  }
  return { name: 'SampleScene', nodes: { [camId]: cam, [lightId]: light }, rootIds: [camId, lightId] }
}

const timeStr = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const MAX_LOGS = 999

export const useEditorStore = create<EditorState>()((set, get) => ({
  scene: initialScene(),
  assets: [],
  selection: [],
  expanded: {},
  renamingId: null,
  tool: 'move',
  transformSpace: 'world',
  mode: 'edit',
  logs: [
    { id: logId++, level: 'info', message: 'UnityThree Editor ready — Three.js scene initialized', time: timeStr() },
  ],
  clearOnPlay: true,
  showGrid: true,
  shadingMode: 'shaded',
  focusRequestId: 0,
  clipboard: [],

  undoStack: [],
  redoStack: [],
  playSnapshot: null,

  execute(cmd) {
    cmd.apply()
    set((s) => ({ undoStack: [...s.undoStack, cmd], redoStack: [] }))
  },
  pushApplied(cmd) {
    set((s) => ({ undoStack: [...s.undoStack, cmd], redoStack: [] }))
  },
  undo() {
    const s = get()
    // 再生中は再生開始時点より過去へは戻れない (停止時に復元されるため)
    const floor = s.mode !== 'edit' && s.playSnapshot ? s.playSnapshot.undoLen : 0
    if (s.undoStack.length <= floor) return
    const cmd = s.undoStack[s.undoStack.length - 1]
    cmd.revert()
    set((st) => ({ undoStack: st.undoStack.slice(0, -1), redoStack: [...st.redoStack, cmd] }))
  },
  redo() {
    const s = get()
    if (s.redoStack.length === 0) return
    const cmd = s.redoStack[s.redoStack.length - 1]
    cmd.apply()
    set((st) => ({ redoStack: st.redoStack.slice(0, -1), undoStack: [...st.undoStack, cmd] }))
  },

  transientPatchNode(id, patch) {
    set((s) => ({ scene: ops.patchNode(s.scene, id, patch) }))
  },
  transientPatchComponent(id, componentIndex, patch) {
    set((s) => ({ scene: ops.patchComponent(s.scene, id, componentIndex, patch) }))
  },
  transientSetTransform(id, transform) {
    set((s) => ({ scene: ops.patchNode(s.scene, id, { transform }) }))
  },
  transientAddSubtree(nodes, parentId) {
    set((s) => ({ scene: ops.addSubtree(s.scene, nodes, parentId) }))
  },
  transientRemoveSubtree(id) {
    set((s) => ({
      scene: ops.removeSubtree(s.scene, id).graph,
      selection: s.selection.filter((x) => x !== id),
    }))
  },

  replaceScene(scene, assets) {
    set({
      scene,
      assets,
      selection: [],
      expanded: {},
      undoStack: [],
      redoStack: [],
      renamingId: null,
    })
  },

  select(ids) {
    set({ selection: ids })
  },
  toggleSelect(id) {
    set((s) => ({
      selection: s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id],
    }))
  },
  clearSelection() {
    set({ selection: [] })
  },

  setExpanded(id, v) {
    set((s) => ({ expanded: { ...s.expanded, [id]: v } }))
  },
  setRenaming(id) {
    set({ renamingId: id })
  },
  setTool(t) {
    set({ tool: t })
  },
  setTransformSpace(sp) {
    set({ transformSpace: sp })
  },
  setShowGrid(v) {
    set({ showGrid: v })
  },
  setShadingMode(m) {
    set({ shadingMode: m })
  },
  newScene() {
    const s = get()
    if (s.mode !== 'edit') s.stop()
    clearAssets()
    set({
      scene: initialScene(),
      assets: [],
      selection: [],
      expanded: {},
      undoStack: [],
      redoStack: [],
      renamingId: null,
      playSnapshot: null,
    })
    get().log('info', 'New scene created')
  },
  requestFocus() {
    set((s) => ({ focusRequestId: s.focusRequestId + 1 }))
  },
  setClipboard(subtrees) {
    set({ clipboard: subtrees })
  },
  setAssets(assets) {
    set({ assets })
  },
  setSceneName(name) {
    set((s) => ({ scene: { ...s.scene, name } }))
  },

  play() {
    const s = get()
    if (s.mode === 'paused') {
      set({ mode: 'play' })
      return
    }
    if (s.mode !== 'edit') return
    const snapshot: PlaySnapshot = {
      scene: structuredClone(s.scene),
      selection: [...s.selection],
      undoLen: s.undoStack.length,
      redoLen: s.redoStack.length,
    }
    set({
      mode: 'play',
      playSnapshot: snapshot,
      logs: s.clearOnPlay ? [] : s.logs,
    })
    get().log('info', '▶ Entering Play Mode')
  },
  pause() {
    const s = get()
    if (s.mode === 'play') set({ mode: 'paused' })
    else if (s.mode === 'paused') set({ mode: 'play' })
  },
  stop() {
    const s = get()
    if (s.mode === 'edit' || !s.playSnapshot) return
    const snap = s.playSnapshot
    set({
      mode: 'edit',
      scene: snap.scene,
      selection: snap.selection,
      undoStack: s.undoStack.slice(0, snap.undoLen),
      redoStack: [],
      playSnapshot: null,
    })
    get().log('info', '⏹ Exiting Play Mode — scene state restored')
  },

  log(level, message) {
    set((s) => {
      const logs = [...s.logs, { id: logId++, level, message, time: timeStr() }]
      return { logs: logs.length > MAX_LOGS ? logs.slice(logs.length - MAX_LOGS) : logs }
    })
  },
  clearLogs() {
    set({ logs: [] })
  },
  setClearOnPlay(v) {
    set({ clearOnPlay: v })
  },
}))

/* ---------------------------------- Selectors ---------------------------------- */

export const activeNodeId = (s: EditorState): NodeId | null =>
  s.selection.length > 0 ? s.selection[s.selection.length - 1] : null

export const isPlaying = (s: EditorState) => s.mode !== 'edit'

/* ---------------------------------- Command factories ---------------------------------- */
/* コマンドは editorStore の setState を閉じ込めた apply/revert を持つ。
   UIは必ずこれら経由でシーンを変更する。 */

const st = () => useEditorStore.getState()
const setScene = (fn: (g: SceneGraph) => SceneGraph) =>
  useEditorStore.setState((s) => ({ scene: fn(s.scene) }))

/** オブジェクト追加 (サブツリー対応)。追加後に選択する */
export function cmdAddObject(subtree: SceneNode[], parentId: NodeId | null, index: number | null = null): Command {
  const rootId = subtree[0].id
  let prevSelection: NodeId[] = []
  return {
    name: `Create ${subtree[0].name}`,
    apply() {
      prevSelection = st().selection
      setScene((g) => ops.addSubtree(g, structuredClone(subtree), parentId, index))
      if (parentId) useEditorStore.setState((s) => ({ expanded: { ...s.expanded, [parentId]: true } }))
      useEditorStore.setState({ selection: [rootId] })
    },
    revert() {
      setScene((g) => ops.removeSubtree(g, rootId).graph)
      useEditorStore.setState({ selection: prevSelection })
    },
  }
}

/** 複数オブジェクト削除 */
export function cmdDeleteObjects(ids: NodeId[]): Command {
  // ネスト選択(親と子を両方選択)の二重削除を防ぐ: 先頭側の親だけ残す
  const roots = topmostOnly(ids)
  type Removed = { removed: SceneNode[]; parentId: NodeId | null; index: number }
  let captured: Removed[] = []
  let prevSelection: NodeId[] = []
  return {
    name: `Delete ${roots.length} object(s)`,
    apply() {
      prevSelection = st().selection
      captured = []
      setScene((g) => {
        let cur = g
        for (const id of roots) {
          const r = ops.removeSubtree(cur, id)
          captured.push({ removed: r.removed, parentId: r.parentId, index: r.index })
          cur = r.graph
        }
        return cur
      })
      useEditorStore.setState({ selection: [] })
    },
    revert() {
      setScene((g) => {
        let cur = g
        // 逆順で戻すと元 index が有効
        for (let i = captured.length - 1; i >= 0; i--) {
          const c = captured[i]
          cur = ops.addSubtree(cur, structuredClone(c.removed), c.parentId, c.index)
        }
        return cur
      })
      useEditorStore.setState({ selection: prevSelection })
    },
  }
}

/** 複製 (Ctrl+D) */
export function cmdDuplicate(ids: NodeId[]): Command | null {
  const g0 = st().scene
  const roots = topmostOnly(ids)
  const clones = roots
    .map((id) => ({ src: id, clone: ops.cloneSubtree(g0, id) }))
    .filter((c) => c.clone !== null) as Array<{ src: NodeId; clone: { nodes: SceneNode[]; rootId: NodeId } }>
  if (clones.length === 0) return null
  let prevSelection: NodeId[] = []
  return {
    name: 'Duplicate',
    apply() {
      prevSelection = st().selection
      setScene((g) => {
        let cur = g
        for (const { src, clone } of clones) {
          const srcNode = cur.nodes[src]
          const siblings = srcNode?.parentId === null ? cur.rootIds : (cur.nodes[srcNode!.parentId!]?.childrenIds ?? [])
          const idx = siblings.indexOf(src)
          cur = ops.addSubtree(cur, structuredClone(clone.nodes), srcNode?.parentId ?? null, idx >= 0 ? idx + 1 : null)
        }
        return cur
      })
      useEditorStore.setState({ selection: clones.map((c) => c.clone.rootId) })
    },
    revert() {
      setScene((g) => {
        let cur = g
        for (const { clone } of clones) cur = ops.removeSubtree(cur, clone.rootId).graph
        return cur
      })
      useEditorStore.setState({ selection: prevSelection })
    },
  }
}

/** 親子変更 (Hierarchy DnD) */
export function cmdReparent(id: NodeId, newParentId: NodeId | null, index: number | null): Command {
  const g = st().scene
  const node = g.nodes[id]
  const oldParentId = node?.parentId ?? null
  const oldSiblings = oldParentId === null ? g.rootIds : (g.nodes[oldParentId]?.childrenIds ?? [])
  const oldIndex = oldSiblings.indexOf(id)
  return {
    name: 'Reparent',
    apply() {
      setScene((gr) => ops.reparent(gr, id, newParentId, index))
      if (newParentId) useEditorStore.setState((s) => ({ expanded: { ...s.expanded, [newParentId]: true } }))
    },
    revert() {
      setScene((gr) => ops.reparent(gr, id, oldParentId, oldIndex))
    },
  }
}

/** 汎用: ノードのプロパティ変更 (name / visible / transform)。before/after 明示版 */
export function cmdPatchNode(
  id: NodeId,
  before: Partial<SceneNode>,
  after: Partial<SceneNode>,
  name = 'Modify Properties',
): Command {
  return {
    name,
    apply() {
      setScene((g) => ops.patchNode(g, id, structuredClone(after)))
    },
    revert() {
      setScene((g) => ops.patchNode(g, id, structuredClone(before)))
    },
  }
}

/** 汎用: コンポーネントのプロパティ変更 */
export function cmdPatchComponent(
  id: NodeId,
  componentIndex: number,
  before: Partial<Component>,
  after: Partial<Component>,
  name = 'Modify Component',
): Command {
  return {
    name,
    apply() {
      setScene((g) => ops.patchComponent(g, id, componentIndex, structuredClone(after)))
    },
    revert() {
      setScene((g) => ops.patchComponent(g, id, componentIndex, structuredClone(before)))
    },
  }
}

export function cmdAddComponent(id: NodeId, component: Component): Command {
  return {
    name: `Add ${component.type}`,
    apply() {
      setScene((g) => ops.addComponent(g, id, structuredClone(component)))
    },
    revert() {
      setScene((g) => {
        const node = g.nodes[id]
        if (!node) return g
        return ops.removeComponentAt(g, id, node.components.length - 1)
      })
    },
  }
}

export function cmdRemoveComponent(id: NodeId, componentIndex: number): Command {
  const comp = st().scene.nodes[id]?.components[componentIndex]
  return {
    name: `Remove ${comp?.type ?? 'component'}`,
    apply() {
      setScene((g) => ops.removeComponentAt(g, id, componentIndex))
    },
    revert() {
      setScene((g) => {
        if (!comp) return g
        const node = g.nodes[id]
        if (!node) return g
        const components = [...node.components]
        components.splice(componentIndex, 0, structuredClone(comp))
        return ops.patchNode(g, id, { components })
      })
    },
  }
}

/**
 * グラフ全置換コマンド (Prefab Apply/Revert のような複数サブツリーの一括差し替え用, D-029)。
 * before/after のイミュータブル参照を保持するだけなのでメモリ・実装ともに安全。
 */
export function cmdReplaceGraph(before: SceneGraph, after: SceneGraph, name: string): Command {
  return {
    name,
    apply() {
      useEditorStore.setState((s) => ({ scene: after, selection: s.selection.filter((id) => after.nodes[id]) }))
    },
    revert() {
      useEditorStore.setState((s) => ({ scene: before, selection: s.selection.filter((id) => before.nodes[id]) }))
    },
  }
}

/** 選択中ノード群のうち、選択に祖先が含まれるものを除外 */
export function topmostOnly(ids: NodeId[]): NodeId[] {
  const g = st().scene
  const idSet = new Set(ids)
  return ids.filter((id) => {
    let p = g.nodes[id]?.parentId
    while (p) {
      if (idSet.has(p)) return false
      p = g.nodes[p]?.parentId ?? null
    }
    return true
  })
}

/* ---------------------------------- GameObject factories ---------------------------------- */

import { defaultMaterial, defaultMesh } from '../types/scene'
import type { LightKind, PrimitiveKind } from '../types/scene'

export function makeEmptyNode(name = 'GameObject'): SceneNode {
  return {
    id: newId(),
    name,
    visible: true,
    parentId: null,
    childrenIds: [],
    transform: defaultTransform(),
    components: [],
  }
}

const PRIMITIVE_LABELS: Record<PrimitiveKind, string> = {
  box: 'Cube',
  sphere: 'Sphere',
  plane: 'Plane',
  cylinder: 'Cylinder',
  capsule: 'Capsule',
  cone: 'Cone',
  torus: 'Torus',
  quad: 'Quad',
}

export function makePrimitiveNode(kind: PrimitiveKind): SceneNode {
  const n = makeEmptyNode(PRIMITIVE_LABELS[kind])
  n.components = [defaultMesh(kind), defaultMaterial()]
  return n
}

export function makeLightNode(kind: LightKind): SceneNode {
  const label = kind === 'directional' ? 'Directional Light' : kind === 'point' ? 'Point Light' : 'Spot Light'
  const n = makeEmptyNode(label)
  if (kind === 'directional') n.transform.rotation = vec3(50, -30, 0)
  else n.transform.position = vec3(0, 3, 0)
  if (kind === 'spot') n.transform.rotation = vec3(90, 0, 0)
  n.components = [defaultLight(kind)]
  return n
}

export function makeCameraNode(): SceneNode {
  const n = makeEmptyNode('Camera')
  n.transform.position = vec3(0, 1, -10)
  n.components = [defaultCamera()]
  return n
}

export function makeGlbNode(assetId: string, assetName: string): SceneNode {
  const n = makeEmptyNode(assetName.replace(/\.(glb|gltf|fbx|obj)$/i, ''))
  n.components = [{ ...defaultMesh('box'), assetId }]
  return n
}
