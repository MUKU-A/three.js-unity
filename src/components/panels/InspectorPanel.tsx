/**
 * Inspector パネル: 選択オブジェクトのヘッダ + コンポーネント群 + Add Component。
 * マルチ選択時はアクティブ(末尾)を表示 (D-010)。
 */
import { useRef, useState } from 'react'
import { Box, Camera, FileCode, Lightbulb, Palette, Plus, Search, Shield, Weight } from 'lucide-react'
import { activeNodeId, cmdAddComponent, cmdPatchNode, useEditorStore } from '../../store/editorStore'
import {
  defaultCamera,
  defaultCollider,
  defaultLight,
  defaultMaterial,
  defaultMesh,
  defaultRigidbody,
  defaultScript,
  getComponent,
} from '../../types/scene'
import type { Component } from '../../types/scene'
import { NodeIcon } from '../common/NodeIcon'
import { CameraSection, LightSection, MaterialSection, MeshSection, TransformSection } from '../inspector/sections'
import { ColliderSection, RigidbodySection, ScriptSection } from '../inspector/scriptPhysicsSections'

export function InspectorPanel() {
  const node = useEditorStore((s) => {
    const id = activeNodeId(s)
    return id ? s.scene.nodes[id] : null
  })
  const count = useEditorStore((s) => s.selection.length)

  if (!node) {
    return (
      <div className="h-full bg-u-panel flex items-center justify-center text-u-sub">
        {count > 0 ? '' : 'No object selected'}
      </div>
    )
  }

  return (
    <div className="h-full bg-u-panel overflow-y-auto overflow-x-hidden select-none">
      <Header key={`h-${node.id}`} nodeId={node.id} />
      <TransformSection key={`t-${node.id}`} node={node} />
      {node.components.map((c, i) => {
        const k = `${node.id}-${i}-${c.type}`
        switch (c.type) {
          case 'mesh':
            return <MeshSection key={k} node={node} comp={c} index={i} />
          case 'material':
            return <MaterialSection key={k} node={node} comp={c} index={i} />
          case 'light':
            return <LightSection key={k} node={node} comp={c} index={i} />
          case 'camera':
            return <CameraSection key={k} node={node} comp={c} index={i} />
          case 'script':
            return <ScriptSection key={k} node={node} comp={c} index={i} />
          case 'rigidbody':
            return <RigidbodySection key={k} node={node} comp={c} index={i} />
          case 'collider':
            return <ColliderSection key={k} node={node} comp={c} index={i} />
          default:
            return null
        }
      })}
      {count > 1 && (
        <div className="text-u-sub text-center py-2 border-t border-u-border mt-2">
          {count} objects selected — showing active
        </div>
      )}
      <AddComponentButton nodeId={node.id} />
    </div>
  )
}

/* ---------------------------------- ヘッダ ---------------------------------- */

function Header({ nodeId }: { nodeId: string }) {
  const node = useEditorStore((s) => s.scene.nodes[nodeId])
  const st = useEditorStore.getState
  if (!node) return null

  return (
    <div className="px-2 py-2 border-b border-u-border bg-u-panel flex items-center gap-1.5">
      <NodeIcon node={node} size={18} />
      <input
        type="checkbox"
        className="u-check"
        checked={node.visible}
        title="Active"
        onChange={() => st().execute(cmdPatchNode(nodeId, { visible: node.visible }, { visible: !node.visible }, node.visible ? 'Deactivate' : 'Activate'))}
      />
      <NameField key={node.name} nodeId={nodeId} name={node.name} />
    </div>
  )
}

function NameField({ nodeId, name }: { nodeId: string; name: string }) {
  const [text, setText] = useState(name)
  const st = useEditorStore.getState
  const commit = () => {
    const trimmed = text.trim()
    if (trimmed && trimmed !== name) {
      st().execute(cmdPatchNode(nodeId, { name }, { name: trimmed }, 'Rename'))
    } else {
      setText(name)
    }
  }
  return (
    <input
      className="u-input font-semibold"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          setText(name)
          ;(e.target as HTMLInputElement).blur()
        }
        e.stopPropagation()
      }}
    />
  )
}

/* ---------------------------------- Add Component ---------------------------------- */

const COMPONENT_DEFS: Array<{
  type: Component['type']
  label: string
  icon: React.ReactNode
  make: () => Component
  /** Unityのスクリプトのように同型を複数付けられるもの */
  allowMultiple?: boolean
}> = [
  { type: 'mesh', label: 'Mesh Filter', icon: <Box size={13} />, make: () => defaultMesh('box') },
  { type: 'material', label: 'Material', icon: <Palette size={13} />, make: () => defaultMaterial() },
  { type: 'light', label: 'Light', icon: <Lightbulb size={13} />, make: () => defaultLight('point') },
  { type: 'camera', label: 'Camera', icon: <Camera size={13} />, make: () => defaultCamera() },
  { type: 'script', label: 'New Script', icon: <FileCode size={13} />, make: () => defaultScript(), allowMultiple: true },
  { type: 'rigidbody', label: 'Rigidbody', icon: <Weight size={13} />, make: () => defaultRigidbody() },
  { type: 'collider', label: 'Box Collider', icon: <Shield size={13} />, make: () => defaultCollider('box') },
  { type: 'collider', label: 'Sphere Collider', icon: <Shield size={13} />, make: () => defaultCollider('sphere') },
]

function AddComponentButton({ nodeId }: { nodeId: string }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const node = useEditorStore((s) => s.scene.nodes[nodeId])
  const wrapRef = useRef<HTMLDivElement>(null)
  const st = useEditorStore.getState
  if (!node) return null

  const items = COMPONENT_DEFS.filter(
    (d) => d.label.toLowerCase().includes(query.toLowerCase()) && (d.allowMultiple || !getComponent(node, d.type)),
  )

  return (
    <div className="flex flex-col items-center py-4 relative" ref={wrapRef}>
      <button className="u-btn w-[200px] justify-center font-semibold" onClick={() => setOpen(!open)}>
        <Plus size={13} />
        Add Component
      </button>
      {open && (
        <div className="absolute top-[44px] z-50 w-[230px] bg-[#333] border border-[#1c1c1c] rounded-[3px] shadow-[0_8px_20px_rgba(0,0,0,0.5)]">
          <div className="flex items-center gap-1 m-1 px-1 u-input h-[20px]">
            <Search size={11} className="text-u-sub flex-none" />
            <input
              autoFocus
              className="bg-transparent outline-none flex-1 text-u-text"
              placeholder="Search..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setOpen(false)
                e.stopPropagation()
              }}
            />
          </div>
          <div className="max-h-[180px] overflow-y-auto pb-1">
            {items.length === 0 && <div className="text-u-sub text-center py-2">No components</div>}
            {items.map((d) => (
              <div
                key={d.label}
                className="u-menu-item items-center !justify-start gap-2"
                onClick={() => {
                  st().execute(cmdAddComponent(nodeId, d.make()))
                  setOpen(false)
                  setQuery('')
                }}
              >
                <span className="text-u-sub">{d.icon}</span>
                <span>{d.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}
    </div>
  )
}
