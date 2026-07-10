/**
 * Hierarchy パネル (UNITY_UI_RESEARCH.md §4)。
 * 行高18px / インデント14px / 展開三角 / 選択青 #2C5D87 / hover目玉トグル。
 * DnD: 行上部=前に挿入, 中央=子にする, 下部=後に挿入。
 */
import { useMemo, useRef, useState } from 'react'
import { ChevronRight, Eye, EyeOff, Plus, Search } from 'lucide-react'
import type { NodeId, SceneNode } from '../../types/scene'
import { isDescendantOf } from '../../types/scene'
import { cmdReparent, topmostOnly, useEditorStore } from '../../store/editorStore'
import {
  applyToPrefab,
  copySelection,
  createCamera,
  createEmpty,
  createLight,
  createPrefabFromNode,
  createPrimitive,
  deleteSelection,
  duplicateSelection,
  pasteClipboard,
  renameNode,
  revertToPrefab,
  setNodeVisible,
  unpackPrefab,
} from '../../store/actions'
import { useContextMenu, type MenuItem } from '../common/ContextMenu'
import { NodeIcon } from '../common/NodeIcon'

interface Row {
  id: NodeId
  depth: number
}

/** 作成系メニュー (右クリック/[+]共用)。parentId=null でルート作成 */
export function creationMenuItems(parentId: NodeId | null): MenuItem[] {
  return [
    { label: 'Create Empty', onClick: () => createEmpty(parentId) },
    {
      label: '3D Object',
      children: [
        { label: 'Cube', onClick: () => createPrimitive('box', parentId) },
        { label: 'Sphere', onClick: () => createPrimitive('sphere', parentId) },
        { label: 'Capsule', onClick: () => createPrimitive('capsule', parentId) },
        { label: 'Cylinder', onClick: () => createPrimitive('cylinder', parentId) },
        { label: 'Cone', onClick: () => createPrimitive('cone', parentId) },
        { label: 'Plane', onClick: () => createPrimitive('plane', parentId) },
        { label: 'Quad', onClick: () => createPrimitive('quad', parentId) },
        { label: 'Torus', onClick: () => createPrimitive('torus', parentId) },
      ],
    },
    {
      label: 'Light',
      children: [
        { label: 'Directional Light', onClick: () => createLight('directional', parentId) },
        { label: 'Point Light', onClick: () => createLight('point', parentId) },
        { label: 'Spot Light', onClick: () => createLight('spot', parentId) },
      ],
    },
    { label: 'Camera', onClick: () => createCamera(parentId) },
  ]
}

export function HierarchyPanel() {
  const scene = useEditorStore((s) => s.scene)
  const selection = useEditorStore((s) => s.selection)
  const expanded = useEditorStore((s) => s.expanded)
  const clipboardEmpty = useEditorStore((s) => s.clipboard.length === 0)
  const [query, setQuery] = useState('')
  const menu = useContextMenu()
  const anchorRef = useRef<NodeId | null>(null)
  const [dropLine, setDropLine] = useState<{ y: number } | null>(null)
  const [dropInside, setDropInside] = useState<NodeId | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    const q = query.trim().toLowerCase()
    if (q) {
      /* 検索時はフラットな一致リスト (Unityと同じ) */
      for (const id in scene.nodes) {
        if (scene.nodes[id].name.toLowerCase().includes(q)) out.push({ id, depth: 0 })
      }
      return out
    }
    const walk = (id: NodeId, depth: number) => {
      out.push({ id, depth })
      if (expanded[id]) scene.nodes[id]?.childrenIds.forEach((c) => walk(c, depth + 1))
    }
    scene.rootIds.forEach((id) => walk(id, 0))
    return out
  }, [scene, expanded, query])

  const st = useEditorStore.getState

  const handleSelect = (e: React.MouseEvent, id: NodeId) => {
    if (e.shiftKey && anchorRef.current) {
      const a = rows.findIndex((r) => r.id === anchorRef.current)
      const b = rows.findIndex((r) => r.id === id)
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a]
        st().select(rows.slice(lo, hi + 1).map((r) => r.id))
        return
      }
    }
    if (e.ctrlKey || e.metaKey) {
      st().toggleSelect(id)
    } else {
      st().select([id])
    }
    anchorRef.current = id
  }

  const nodeMenuItems = (id: NodeId): MenuItem[] => {
    const node = st().scene.nodes[id]
    const prefabItems: MenuItem[] = node?.prefabId
      ? [
          {
            label: 'Prefab',
            children: [
              { label: 'Apply to Prefab', onClick: () => applyToPrefab(id) },
              { label: 'Revert to Prefab', onClick: () => revertToPrefab(id) },
              { separator: true },
              { label: 'Unpack Prefab', onClick: () => unpackPrefab(id) },
            ],
          },
          { separator: true },
        ]
      : [{ label: 'Create Prefab', onClick: () => createPrefabFromNode(id) }, { separator: true }]
    return [
      { label: 'Copy', shortcut: 'Ctrl+C', onClick: () => copySelection() },
      { label: 'Paste', shortcut: 'Ctrl+V', disabled: clipboardEmpty, onClick: () => pasteClipboard() },
      { label: 'Paste As Child', disabled: clipboardEmpty, onClick: () => pasteClipboard(id) },
      { separator: true },
      { label: 'Rename', shortcut: 'F2', onClick: () => st().setRenaming(id) },
      { label: 'Duplicate', shortcut: 'Ctrl+D', onClick: () => duplicateSelection() },
      { label: 'Delete', shortcut: 'Del', onClick: () => deleteSelection() },
      { separator: true },
      ...prefabItems,
      ...creationMenuItems(id),
    ]
  }

  /* ---------------- DnD ---------------- */

  const dragIds = useRef<NodeId[]>([])

  const onDragStart = (e: React.DragEvent, id: NodeId) => {
    const sel = st().selection.includes(id) ? st().selection : [id]
    dragIds.current = topmostOnly(sel)
    e.dataTransfer.setData('application/x-unitythree-nodes', '1')
    e.dataTransfer.effectAllowed = 'move'
  }

  const zoneOf = (e: React.DragEvent): 'before' | 'inside' | 'after' => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const y = e.clientY - rect.top
    if (y < 5) return 'before'
    if (y > rect.height - 5) return 'after'
    return 'inside'
  }

  const onDragOverRow = (e: React.DragEvent, id: NodeId) => {
    if (!e.dataTransfer.types.includes('application/x-unitythree-nodes')) return
    /* 自分自身や子孫へのドロップは禁止 */
    const invalid = dragIds.current.some((d) => d === id || isDescendantOf(scene.nodes, id, d))
    if (invalid) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const zone = zoneOf(e)
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const listRect = listRef.current!.getBoundingClientRect()
    if (zone === 'inside') {
      setDropInside(id)
      setDropLine(null)
    } else {
      setDropInside(null)
      setDropLine({ y: (zone === 'before' ? rect.top : rect.bottom) - listRect.top + listRef.current!.scrollTop })
    }
  }

  const onDropRow = (e: React.DragEvent, id: NodeId) => {
    if (!e.dataTransfer.types.includes('application/x-unitythree-nodes')) return
    e.preventDefault()
    clearDnd()
    const zone = zoneOf(e)
    const node = scene.nodes[id]
    if (!node) return
    for (const dragged of dragIds.current) {
      if (dragged === id || isDescendantOf(scene.nodes, id, dragged)) continue
      if (zone === 'inside') {
        st().execute(cmdReparent(dragged, id, null))
      } else {
        const siblings = node.parentId ? (scene.nodes[node.parentId]?.childrenIds ?? []) : st().scene.rootIds
        let idx = siblings.indexOf(id)
        if (zone === 'after') idx += 1
        /* 同じ親内で前方から後方へ動かす場合、自分を抜いた分ずれる */
        const cur = st().scene.nodes[dragged]
        if (cur?.parentId === node.parentId) {
          const curIdx = siblings.indexOf(dragged)
          if (curIdx >= 0 && curIdx < idx) idx -= 1
        }
        st().execute(cmdReparent(dragged, node.parentId, idx))
      }
    }
  }

  const onDropEmpty = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-unitythree-nodes')) return
    e.preventDefault()
    clearDnd()
    for (const dragged of dragIds.current) {
      st().execute(cmdReparent(dragged, null, null))
    }
  }

  const clearDnd = () => {
    setDropLine(null)
    setDropInside(null)
  }

  return (
    <div className="h-full bg-u-list flex flex-col select-none">
      {/* パネル内ツールバー */}
      <div className="flex items-center gap-1 px-1 h-[24px] bg-u-toolbar border-b border-u-border flex-none">
        <button className="u-toolbtn !w-[22px] !h-[18px]" title="Create" onClick={(e) => menu.open(e, creationMenuItems(null))}>
          <Plus size={13} />
        </button>
        <div className="flex items-center flex-1 gap-1 u-input !h-[17px]">
          <Search size={10} className="text-u-sub flex-none" />
          <input
            className="bg-transparent outline-none flex-1 min-w-0 text-u-text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>
      </div>

      {/* シーン行 */}
      <div
        className="h-[20px] flex items-center gap-1 px-1 font-semibold border-b border-u-border bg-u-list flex-none"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('application/x-unitythree-nodes')) e.preventDefault()
        }}
        onDrop={onDropEmpty}
      >
        <ChevronRight size={11} className="rotate-90 text-u-sub" />
        <span className="text-u-text">{scene.name}</span>
      </div>

      {/* ツリー */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto overflow-x-hidden relative"
        onContextMenu={(e) => menu.open(e, creationMenuItems(null))}
        onClick={(e) => {
          if (e.target === e.currentTarget) st().clearSelection()
        }}
        onDragOver={(e) => {
          if (e.target === e.currentTarget && e.dataTransfer.types.includes('application/x-unitythree-nodes')) {
            e.preventDefault()
            clearDnd()
          }
        }}
        onDrop={(e) => {
          if (e.target === e.currentTarget) onDropEmpty(e)
        }}
        onDragLeave={(e) => {
          if (e.target === e.currentTarget) clearDnd()
        }}
      >
        {rows.map((r) => (
          <HierarchyRow
            key={r.id}
            row={r}
            node={scene.nodes[r.id]}
            selected={selection.includes(r.id)}
            onSelect={handleSelect}
            onContext={(e, id) => {
              if (!st().selection.includes(id)) {
                st().select([id])
                anchorRef.current = id
              }
              menu.open(e, nodeMenuItems(id))
            }}
            onDragStart={onDragStart}
            onDragOverRow={onDragOverRow}
            onDropRow={onDropRow}
            dropInside={dropInside === r.id}
          />
        ))}
        {dropLine && <div className="u-drop-line" style={{ top: dropLine.y }} />}
      </div>
      {menu.element}
    </div>
  )
}

/* ---------------------------------- 行 ---------------------------------- */

function HierarchyRow({
  row,
  node,
  selected,
  onSelect,
  onContext,
  onDragStart,
  onDragOverRow,
  onDropRow,
  dropInside,
}: {
  row: Row
  node: SceneNode | undefined
  selected: boolean
  onSelect: (e: React.MouseEvent, id: NodeId) => void
  onContext: (e: React.MouseEvent, id: NodeId) => void
  onDragStart: (e: React.DragEvent, id: NodeId) => void
  onDragOverRow: (e: React.DragEvent, id: NodeId) => void
  onDropRow: (e: React.DragEvent, id: NodeId) => void
  dropInside: boolean
}) {
  const renaming = useEditorStore((s) => s.renamingId === row.id)
  const expandedThis = useEditorStore((s) => !!s.expanded[row.id])
  const st = useEditorStore.getState
  const [hover, setHover] = useState(false)
  if (!node) return null
  const hasChildren = node.childrenIds.length > 0

  return (
    <div
      className="u-tree-row"
      data-selected={selected}
      data-hidden={!node.visible}
      data-prefab={!!node.prefabId}
      data-drop={dropInside ? 'inside' : undefined}
      draggable={!renaming}
      onMouseDown={(e) => {
        if (e.button === 0 && !renaming) onSelect(e, row.id)
      }}
      onDoubleClick={() => st().requestFocus()}
      onContextMenu={(e) => onContext(e, row.id)}
      onDragStart={(e) => onDragStart(e, row.id)}
      onDragOver={(e) => onDragOverRow(e, row.id)}
      onDrop={(e) => onDropRow(e, row.id)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* 左ガター: Sceneビュー可視性トグル (Unity 2019.3+ の左端の目玉) */}
      <span className="w-[16px] h-full flex-none flex items-center justify-center border-r border-black/15">
        {(hover || !node.visible) && !renaming && (
          <button
            className="text-u-sub hover:text-u-text"
            title={node.visible ? 'Disable' : 'Enable'}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              setNodeVisible(row.id, !node.visible)
            }}
          >
            {node.visible ? <Eye size={11} /> : <EyeOff size={11} />}
          </button>
        )}
      </span>
      <span style={{ width: row.depth * 14 }} className="flex-none" />
      <span
        className="u-foldout"
        data-open={expandedThis}
        style={{ visibility: hasChildren ? 'visible' : 'hidden' }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => st().setExpanded(row.id, !expandedThis)}
      >
        <ChevronRight size={11} />
      </span>
      <NodeIcon node={node} />
      {renaming ? (
        <RenameInput node={node} />
      ) : (
        <span className="u-tree-label">{node.name}</span>
      )}
    </div>
  )
}

function RenameInput({ node }: { node: SceneNode }) {
  const [text, setText] = useState(node.name)
  const st = useEditorStore.getState
  const done = (commit: boolean) => {
    if (commit) renameNode(node.id, text)
    st().setRenaming(null)
  }
  return (
    <input
      autoFocus
      className="u-input !h-[16px] flex-1"
      value={text}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => done(true)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') done(true)
        if (e.key === 'Escape') done(false)
      }}
      onMouseDown={(e) => e.stopPropagation()}
    />
  )
}
