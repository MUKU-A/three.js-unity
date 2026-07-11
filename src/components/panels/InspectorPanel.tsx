/**
 * Inspector パネル: 選択オブジェクトのヘッダ + コンポーネント群 + Add Component。
 * マルチ選択時はアクティブ(末尾)を表示 (D-010)。
 */
import { useMemo, useRef, useState } from 'react'
import { getPrefabNodes } from '../../engine/assets'
import { countOverrides } from '../../store/prefabSync'
import { applyToPrefab, revertToPrefab } from '../../store/actions'
import { Box, Camera, FileCode, Lightbulb, Link2, Palette, Plus, Search, Shield, Type, Volume2, Weight } from 'lucide-react'
import { activeNodeId, cmdAddComponent, cmdPatchNode, useEditorStore } from '../../store/editorStore'
import {
  defaultAudioSource,
  defaultCamera,
  defaultCollider,
  defaultJoint,
  defaultLight,
  defaultMaterial,
  defaultMesh,
  defaultRigidbody,
  defaultScript,
  defaultUIText,
  getComponent,
} from '../../types/scene'
import type { Component } from '../../types/scene'
import { NodeIcon } from '../common/NodeIcon'
import { CameraSection, LightSection, MaterialSection, MeshSection, TransformSection, UITextSection } from '../inspector/sections'
import { AudioSourceSection, ColliderSection, JointSection, RigidbodySection, ScriptSection } from '../inspector/scriptPhysicsSections'

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
      {node.prefabId && <PrefabBar key={`p-${node.id}`} nodeId={node.id} prefabId={node.prefabId} />}
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
          case 'audiosource':
            return <AudioSourceSection key={k} node={node} comp={c} index={i} />
          case 'joint':
            return <JointSection key={k} node={node} comp={c} index={i} />
          case 'uitext':
            return <UITextSection key={k} node={node} comp={c} index={i} />
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
    <div className="px-2 py-2 border-b border-u-border bg-u-panel flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
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
      <div className="flex items-center gap-1.5 pl-[24px]">
        <span className="text-u-sub text-[11px] flex-none">Tag</span>
        <TagField key={node.tag ?? ''} nodeId={nodeId} tag={node.tag ?? ''} />
      </div>
    </div>
  )
}

/** Unityの Tag 相当 (自由入力, 空=Untagged) */
function TagField({ nodeId, tag }: { nodeId: string; tag: string }) {
  const [text, setText] = useState(tag)
  const st = useEditorStore.getState
  const commit = () => {
    const trimmed = text.trim()
    if (trimmed !== tag) {
      st().execute(cmdPatchNode(nodeId, { tag: tag || null }, { tag: trimmed || null }, 'Set Tag'))
    }
  }
  return (
    <input
      className="u-input !h-[18px] text-[11px]"
      value={text}
      placeholder="Untagged"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          setText(tag)
          ;(e.target as HTMLInputElement).blur()
        }
        e.stopPropagation()
      }}
    />
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

/* ---------------------------------- Prefabバー (D-034) ---------------------------------- */

function PrefabBar({ nodeId, prefabId }: { nodeId: string; prefabId: string }) {
  const scene = useEditorStore((s) => s.scene)
  const assets = useEditorStore((s) => s.assets)
  const meta = assets.find((a) => a.id === prefabId)
  /* オーバーライド数 (テンプレートと現状の差分をオンデマンド計算) */
  const overrides = useMemo(() => {
    const template = getPrefabNodes(prefabId)
    return template ? countOverrides(scene, nodeId, template) : 0
  }, [scene, nodeId, prefabId, meta?.size])

  return (
    <div className="flex items-center gap-1.5 px-2 py-1 bg-[#33404d] border-b border-u-border">
      <Box size={13} className="text-[#8ab8e8] flex-none" />
      <span className="text-[#b8dcff] text-[11px] flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
        {meta?.name ?? 'Missing Prefab'}
      </span>
      <span className="text-u-sub text-[11px]" title="Overridden properties">
        Overrides ({overrides})
      </span>
      <button className="u-btn !h-[18px] !px-2 text-[11px]" disabled={overrides === 0} onClick={() => applyToPrefab(nodeId)}>
        Apply
      </button>
      <button className="u-btn !h-[18px] !px-2 text-[11px]" disabled={overrides === 0} onClick={() => revertToPrefab(nodeId)}>
        Revert
      </button>
    </div>
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
  { type: 'audiosource', label: 'Audio Source', icon: <Volume2 size={13} />, make: () => defaultAudioSource() },
  { type: 'joint', label: 'Hinge Joint', icon: <Link2 size={13} />, make: () => defaultJoint('hinge') },
  { type: 'joint', label: 'Fixed Joint', icon: <Link2 size={13} />, make: () => defaultJoint('fixed') },
  { type: 'joint', label: 'Spring Joint', icon: <Link2 size={13} />, make: () => defaultJoint('spring') },
  { type: 'uitext', label: 'UI Text', icon: <Type size={13} />, make: () => defaultUIText() },
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
