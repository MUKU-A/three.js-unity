/**
 * Prefab v2: プロパティ単位の差分オーバーライドと3方向マージ (D-034)。
 *
 * ノード対応は prefabNodeId (テンプレート内ID) で取る。
 * マージ規則 (oldTemplate / newTemplate / instance の3方向):
 *  - instance の値が oldTemplate と同じ → 追従 (newTemplate の値を採用)
 *  - instance の値が oldTemplate と異なる (=オーバーライド) → instance の値を保持
 *  - 粒度: transform / name / visible は各グループ単位 (ルートは常にインスタンス所有)、
 *          components は同型なら「プロパティ(キー)単位」まで降りて判定 (Unityの差分粒度)
 *  - ユーザー追加ノード (prefabNodeIdなし) は常に保持
 *  - テンプレートから消えたノードはインスタンスからも削除 / 追加されたノードは挿入
 *  - ユーザーがインスタンス側で削除したテンプレートノードは復活させない
 */
import type { Component, NodeId, SceneGraph, SceneNode } from '../types/scene'
import { newId } from '../types/scene'
import { addSubtree, patchNode, removeSubtree } from './sceneOps'

/* ---------------------------------- helpers ---------------------------------- */

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null) return false
  if (typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined)
  const kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined)
  if (ka.length !== kb.length) return false
  for (const k of ka) {
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false
  }
  return true
}

/** インスタンス配下のノードを prefabNodeId → node で索引化 (ルート含む) */
function indexInstance(graph: SceneGraph, rootId: NodeId): {
  byTid: Map<string, SceneNode>
  all: SceneNode[]
} {
  const byTid = new Map<string, SceneNode>()
  const all: SceneNode[] = []
  const walk = (id: NodeId) => {
    const n = graph.nodes[id]
    if (!n) return
    all.push(n)
    if (n.prefabNodeId) byTid.set(n.prefabNodeId, n)
    n.childrenIds.forEach(walk)
  }
  walk(rootId)
  return { byTid, all }
}

const indexTemplate = (template: SceneNode[]) => new Map(template.map((n) => [n.id, n]))

/* ---------------------------------- オーバーライド数 ---------------------------------- */

/** Inspectorのプレハブバー表示用: インスタンスのオーバーライド項目数を数える */
export function countOverrides(graph: SceneGraph, instanceRootId: NodeId, template: SceneNode[]): number {
  const root = graph.nodes[instanceRootId]
  if (!root || template.length === 0) return 0
  const tmplById = indexTemplate(template)
  const { byTid, all } = indexInstance(graph, instanceRootId)
  let count = 0

  for (const inst of all) {
    const isRoot = inst.id === instanceRootId
    const t = inst.prefabNodeId ? tmplById.get(inst.prefabNodeId) : undefined
    if (!t) {
      if (!isRoot) count++ // ユーザー追加ノード
      continue
    }
    if (!isRoot) {
      if (!deepEqual(inst.transform, t.transform)) count++
      if (inst.name !== t.name) count++
      if (inst.visible !== t.visible) count++
      if ((inst.tag ?? null) !== (t.tag ?? null)) count++
    }
    const len = Math.max(inst.components.length, t.components.length)
    for (let i = 0; i < len; i++) {
      const ic = inst.components[i]
      const tc = t.components[i]
      if (ic && tc && ic.type === tc.type) {
        /* プロパティ単位で数える (Unityの Overrides ドロップダウン相当の粒度) */
        const keys = new Set([...Object.keys(ic as object), ...Object.keys(tc as object)])
        for (const k of keys) {
          if (!deepEqual((ic as unknown as Record<string, unknown>)[k], (tc as unknown as Record<string, unknown>)[k])) count++
        }
      } else if (!deepEqual(ic, tc)) {
        count++
      }
    }
  }
  /* テンプレートにあるがインスタンスで削除されたノード */
  for (const t of template) {
    if (t.id !== template[0].id && !byTid.has(t.id)) count++
  }
  return count
}

/* ---------------------------------- 3方向マージ ---------------------------------- */

/** 同型コンポーネント内の「プロパティ単位」3方向マージ (Unityの差分粒度) */
function mergeComponentProps(o: Component, n: Component, inst: Component): Component {
  const out: Record<string, unknown> = {}
  const keys = new Set([
    ...Object.keys(o as object),
    ...Object.keys(n as object),
    ...Object.keys(inst as object),
  ])
  for (const k of keys) {
    const ov = (o as unknown as Record<string, unknown>)[k]
    const nv = (n as unknown as Record<string, unknown>)[k]
    const iv = (inst as unknown as Record<string, unknown>)[k]
    /* インスタンス値が旧テンプレと同じ → 追従 / 違う (=オーバーライド) → 保持 */
    const pick = deepEqual(iv, ov) ? nv : iv
    if (pick !== undefined) out[k] = pick
  }
  return structuredClone(out) as unknown as Component
}

/** components のインデックス毎3方向マージ (同型ならプロパティ単位まで降りる) */
function mergeComponents(oldC: Component[], newC: Component[], instC: Component[]): Component[] {
  const out: Component[] = []
  const len = Math.max(oldC.length, newC.length, instC.length)
  for (let i = 0; i < len; i++) {
    const o = oldC[i]
    const n = newC[i]
    const inst = instC[i]
    if (o && n && inst && o.type === n.type && n.type === inst.type) {
      out.push(mergeComponentProps(o, n, inst))
      continue
    }
    const overridden = !deepEqual(inst, o)
    const pick = overridden ? inst : n
    if (pick !== undefined) out.push(structuredClone(pick))
  }
  return out
}

/**
 * プレハブ更新をインスタンスへ3方向マージで反映した新グラフを返す。
 * インスタンスの既存ノードIDは維持される (選択やUndo参照が壊れない)。
 */
export function mergeTemplateUpdate(
  graph: SceneGraph,
  instanceRootId: NodeId,
  oldTemplate: SceneNode[],
  newTemplate: SceneNode[],
): SceneGraph {
  const root = graph.nodes[instanceRootId]
  if (!root || newTemplate.length === 0) return graph
  const oldById = indexTemplate(oldTemplate)
  const newById = indexTemplate(newTemplate)
  const { byTid } = indexInstance(graph, instanceRootId)
  let g = graph

  /* 1) テンプレートから消えたノードをインスタンスから削除 */
  for (const [tid, inst] of byTid) {
    if (tid === newTemplate[0].id) continue
    if (oldById.has(tid) && !newById.has(tid)) {
      if (g.nodes[inst.id]) g = removeSubtree(g, inst.id).graph
    }
  }

  /* 2) 対応ノードのプロパティを3方向マージ */
  for (const tNew of newTemplate) {
    const inst = byTid.get(tNew.id)
    if (!inst || !g.nodes[inst.id]) continue
    const tOld = oldById.get(tNew.id) ?? tNew
    const isRoot = inst.id === instanceRootId
    const patch: Partial<SceneNode> = {}
    if (!isRoot) {
      if (deepEqual(g.nodes[inst.id].transform, tOld.transform)) patch.transform = structuredClone(tNew.transform)
      if (g.nodes[inst.id].name === tOld.name) patch.name = tNew.name
      if (g.nodes[inst.id].visible === tOld.visible) patch.visible = tNew.visible
      if ((g.nodes[inst.id].tag ?? null) === (tOld.tag ?? null)) patch.tag = tNew.tag ?? null
    }
    patch.components = mergeComponents(tOld.components, tNew.components, g.nodes[inst.id].components)
    g = patchNode(g, inst.id, patch)
  }

  /* 3) テンプレートに追加されたノードをインスタンスへ挿入 (親はtid対応で解決) */
  for (const tNew of newTemplate) {
    if (byTid.has(tNew.id)) continue
    if (oldById.has(tNew.id)) continue // 旧テンプレにあった=ユーザーが削除済み → 復活させない
    if (tNew.id === newTemplate[0].id) continue
    const parentInst = tNew.parentId ? byTid.get(tNew.parentId) : undefined
    const parentId = parentInst ? parentInst.id : instanceRootId
    const node: SceneNode = {
      ...structuredClone(tNew),
      id: newId(),
      prefabNodeId: tNew.id,
      parentId,
      childrenIds: [], // 子はそれぞれの挿入処理で付く (テンプレは親→子順で並んでいる)
    }
    byTid.set(tNew.id, node)
    g = addSubtree(g, [node], parentId)
  }

  return g
}

/* ---------------------------------- Apply (インスタンス → テンプレート) ---------------------------------- */

/**
 * インスタンスの現状から新テンプレートを構築する。
 * - 対応ノードは prefabNodeId をテンプレートIDとして使用
 * - ユーザー追加ノードには新しいテンプレートIDを発番 (graph側にも prefabNodeId を書き戻す)
 * - ルートの transform/name/visible は旧テンプレートの値を維持 (インスタンス所有のため)
 */
export function buildTemplateFromInstance(
  graph: SceneGraph,
  instanceRootId: NodeId,
  oldTemplate: SceneNode[],
): { template: SceneNode[]; graph: SceneGraph } | null {
  const root = graph.nodes[instanceRootId]
  if (!root) return null
  const oldRoot = oldTemplate[0]
  let g = graph

  /* ユーザー追加ノードへ tid を発番 */
  const walkAssign = (id: NodeId) => {
    const n = g.nodes[id]
    if (!n) return
    if (!n.prefabNodeId) {
      g = patchNode(g, id, { prefabNodeId: newId() })
    }
    n.childrenIds.forEach(walkAssign)
  }
  walkAssign(instanceRootId)

  const template: SceneNode[] = []
  const build = (id: NodeId, parentTid: string | null) => {
    const n = g.nodes[id]
    if (!n) return
    const tid = n.prefabNodeId!
    const isRoot = id === instanceRootId
    template.push({
      ...structuredClone(n),
      id: tid,
      parentId: parentTid,
      childrenIds: n.childrenIds.map((c) => g.nodes[c]?.prefabNodeId ?? '').filter(Boolean),
      /* テンプレート自身はインスタンスリンクを持たない (子のNestedリンクは保持) */
      prefabId: isRoot ? null : (n.prefabId ?? null),
      prefabNodeId: null,
      transform: isRoot && oldRoot ? structuredClone(oldRoot.transform) : structuredClone(n.transform),
      name: isRoot && oldRoot ? oldRoot.name : n.name,
      visible: isRoot && oldRoot ? oldRoot.visible : n.visible,
    })
    n.childrenIds.forEach((c) => build(c, tid))
  }
  build(instanceRootId, null)
  return { template, graph: g }
}
