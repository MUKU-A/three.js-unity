/**
 * Script / Rigidbody / Collider の Inspector セクション (D-025/D-026)。
 * ScriptSection は props宣言を自動でフィールド化する (Unityの[SerializeField]リフレクション相当)。
 */
import { useState, type ReactNode } from 'react'
import { ChevronRight, FileCode, MoreVertical, Shield, Weight } from 'lucide-react'
import type { ColliderComponent, RigidbodyComponent, ScriptComponent, SceneNode, Vec3 } from '../../types/scene'
import { cmdPatchComponent, cmdRemoveComponent, useEditorStore } from '../../store/editorStore'
import { compileScript, extractProps } from '../../engine/scripting'
import { useContextMenu, type MenuItem } from '../common/ContextMenu'
import { CheckboxRow, FieldRow, NumberRow, SelectRow, SliderRow, Vector3Row } from './fields'

const st = useEditorStore.getState

/* sections.tsx と同形のヘッダ (依存を避けるため簡易再実装) */
function Header({
  icon,
  title,
  open,
  onToggle,
  menuItems,
  enabled,
  onToggleEnabled,
}: {
  icon: ReactNode
  title: string
  open: boolean
  onToggle: () => void
  menuItems: MenuItem[]
  enabled?: boolean
  onToggleEnabled?: () => void
}) {
  const menu = useContextMenu()
  return (
    <div className="u-comp-header" onClick={onToggle} onContextMenu={(e) => menu.open(e, menuItems)}>
      <span className="u-foldout" data-open={open}>
        <ChevronRight size={11} />
      </span>
      {enabled !== undefined && (
        <input
          type="checkbox"
          className="u-check !w-[13px] !h-[13px]"
          checked={enabled}
          onClick={(e) => e.stopPropagation()}
          onChange={() => onToggleEnabled?.()}
        />
      )}
      {icon}
      <span className="flex-1 overflow-hidden text-ellipsis">{title}</span>
      <button
        className="u-toolbtn !w-[20px] !h-[18px]"
        onClick={(e) => {
          e.stopPropagation()
          menu.open(e, menuItems)
        }}
      >
        <MoreVertical size={12} />
      </button>
      {menu.element}
    </div>
  )
}

function useComponentCommit(id: string, index: number) {
  const patch = (before: object, after: object, name: string) => {
    st().transientPatchComponent(id, index, after)
    st().pushApplied(cmdPatchComponent(id, index, before, after, name))
  }
  const key = <V,>(k: string, name?: string) => ({
    onTransient: (v: V) => st().transientPatchComponent(id, index, { [k]: v } as object),
    onCommit: (b: V, a: V) => patch({ [k]: b }, { [k]: a }, name ?? `Set ${k}`),
  })
  return { patch, key }
}

const removeMenu = (id: string, index: number): MenuItem[] => [
  { label: 'Remove Component', onClick: () => st().execute(cmdRemoveComponent(id, index)) },
]

/* ---------------------------------- Script ---------------------------------- */

export function ScriptSection({ node, comp, index }: { node: SceneNode; comp: ScriptComponent; index: number }) {
  const [open, setOpen] = useState(true)
  const [editorOpen, setEditorOpen] = useState(false)
  const { patch, key } = useComponentCommit(node.id, index)

  const propRow = (name: string, value: number | string | boolean) => {
    const commitProp = (before: unknown, after: unknown) => {
      patch({ props: { ...comp.props, [name]: before } }, { props: { ...comp.props, [name]: after } }, `Set ${name}`)
    }
    /* Unityと同じくキャメルケースを "Speed" 風の表示名へ */
    const label = name.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())
    if (typeof value === 'number') {
      return (
        <NumberRow
          key={name}
          label={label}
          value={value}
          onTransient={(v) => st().transientPatchComponent(node.id, index, { props: { ...comp.props, [name]: v } })}
          onCommit={commitProp}
        />
      )
    }
    if (typeof value === 'boolean') {
      return <CheckboxRow key={name} label={label} value={value} onCommit={commitProp} />
    }
    return (
      <FieldRow key={name} label={label}>
        <input
          className="u-input"
          defaultValue={value}
          onBlur={(e) => e.target.value !== value && commitProp(value, e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
      </FieldRow>
    )
  }

  return (
    <div>
      <Header
        icon={<FileCode size={13} className="text-[#8fd98f]" />}
        title={`${comp.name} (Script)`}
        open={open}
        onToggle={() => setOpen(!open)}
        menuItems={[{ label: 'Edit Script…', onClick: () => setEditorOpen(true) }, { separator: true }, ...removeMenu(node.id, index)]}
        enabled={comp.enabled !== false}
        onToggleEnabled={() => key<boolean>('enabled', 'Toggle Script').onCommit(comp.enabled !== false, comp.enabled === false)}
      />
      {open && (
        <div className="py-1 flex flex-col gap-[2px]">
          <FieldRow label="Script">
            <button className="u-input text-left bg-u-darker! flex items-center gap-1" onClick={() => setEditorOpen(true)}>
              <FileCode size={11} className="flex-none text-u-sub" />
              <span className="overflow-hidden text-ellipsis whitespace-nowrap">{comp.name}.js</span>
            </button>
          </FieldRow>
          {Object.entries(comp.props).map(([k, v]) => propRow(k, v))}
          <div className="px-1 pt-1">
            <button className="u-btn w-full justify-center" onClick={() => setEditorOpen(true)}>
              Open Script Editor
            </button>
          </div>
        </div>
      )}
      {editorOpen && <ScriptEditorModal node={node} comp={comp} index={index} onClose={() => setEditorOpen(false)} />}
    </div>
  )
}

/** 簡易スクリプトエディタ (モーダル)。保存時に props 宣言を再抽出して Inspector に反映 */
function ScriptEditorModal({
  node,
  comp,
  index,
  onClose,
}: {
  node: SceneNode
  comp: ScriptComponent
  index: number
  onClose: () => void
}) {
  const [code, setCode] = useState(comp.code)
  const [name, setName] = useState(comp.name)
  const [error, setError] = useState<string | null>(null)

  const save = () => {
    let compileError: string | null = null
    try {
      compileScript(code)
    } catch (err) {
      compileError = String(err)
    }
    /* propsマージ: 宣言に残っているキーは既存値を保持、新規はデフォルト、消えたものは破棄 */
    const declared = extractProps(code)
    const merged: ScriptComponent['props'] = {}
    for (const [k, v] of Object.entries(declared)) {
      merged[k] = k in comp.props && typeof comp.props[k] === typeof v ? comp.props[k] : v
    }
    st().execute(
      cmdPatchComponent(
        node.id,
        index,
        { code: comp.code, name: comp.name, props: comp.props },
        { code, name: name.trim() || comp.name, props: merged },
        'Edit Script',
      ),
    )
    if (compileError) {
      st().log('error', `[${name}] ${compileError}`)
      setError(compileError)
    } else {
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-[1100] bg-black/55 flex items-center justify-center" onMouseDown={onClose}>
      <div
        className="w-[720px] max-w-[92vw] h-[520px] max-h-[85vh] bg-[#333] border border-[#1c1c1c] rounded-[4px] shadow-2xl flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="h-[30px] flex items-center gap-2 px-2 border-b border-u-border bg-u-header rounded-t-[4px]">
          <FileCode size={13} className="text-[#8fd98f]" />
          <input
            className="u-input !w-[200px] font-semibold"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <span className="text-u-sub text-[11px]">Script Editor — onStart(ctx) / onUpdate(ctx, dt) / const props</span>
        </div>
        <textarea
          className="flex-1 bg-[#1e1e1e] text-[#d4d4d4] font-mono text-[12px] leading-[1.5] p-3 outline-none resize-none select-text"
          value={code}
          spellCheck={false}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Tab') {
              e.preventDefault()
              const t = e.target as HTMLTextAreaElement
              const s = t.selectionStart
              t.setRangeText('  ', s, t.selectionEnd, 'end')
              setCode(t.value)
            }
          }}
        />
        <div className="min-h-[34px] flex items-center gap-2 px-2 py-1 border-t border-u-border">
          <span className="flex-1 text-u-error text-[11px] overflow-hidden text-ellipsis whitespace-nowrap select-text">
            {error ?? ''}
          </span>
          <button className="u-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="u-btn !bg-u-btn-press" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------- Rigidbody ---------------------------------- */

export function RigidbodySection({ node, comp, index }: { node: SceneNode; comp: RigidbodyComponent; index: number }) {
  const [open, setOpen] = useState(true)
  const { key } = useComponentCommit(node.id, index)
  return (
    <div>
      <Header
        icon={<Weight size={13} className="text-u-sub" />}
        title="Rigidbody"
        open={open}
        onToggle={() => setOpen(!open)}
        menuItems={removeMenu(node.id, index)}
      />
      {open && (
        <div className="py-1 flex flex-col gap-[2px]">
          <NumberRow label="Mass" value={comp.mass} {...key<number>('mass')} />
          <NumberRow label="Linear Damping" value={comp.linearDamping} {...key<number>('linearDamping')} />
          <NumberRow label="Angular Damping" value={comp.angularDamping} {...key<number>('angularDamping')} />
          <CheckboxRow label="Use Gravity" value={comp.useGravity} onCommit={(b, a) => key<boolean>('useGravity').onCommit(b, a)} />
          <CheckboxRow label="Is Kinematic" value={comp.isKinematic} onCommit={(b, a) => key<boolean>('isKinematic').onCommit(b, a)} />
        </div>
      )}
    </div>
  )
}

/* ---------------------------------- Collider ---------------------------------- */

export function ColliderSection({ node, comp, index }: { node: SceneNode; comp: ColliderComponent; index: number }) {
  const [open, setOpen] = useState(true)
  const { key } = useComponentCommit(node.id, index)
  return (
    <div>
      <Header
        icon={<Shield size={13} className="text-[#74f274]" />}
        title={comp.shape === 'box' ? 'Box Collider' : 'Sphere Collider'}
        open={open}
        onToggle={() => setOpen(!open)}
        menuItems={removeMenu(node.id, index)}
      />
      {open && (
        <div className="py-1 flex flex-col gap-[2px]">
          <SelectRow
            label="Shape"
            value={comp.shape}
            options={[
              { value: 'box', label: 'Box' },
              { value: 'sphere', label: 'Sphere' },
            ]}
            onCommit={(b, a) => key<string>('shape', 'Change Collider Shape').onCommit(b, a)}
          />
          <Vector3Row label="Center" value={comp.center} onTransient={(v) => key<Vec3>('center').onTransient(v)} onCommit={(b, a) => key<Vec3>('center').onCommit(b, a)} />
          {comp.shape === 'box' ? (
            <Vector3Row label="Size" value={comp.size} onTransient={(v) => key<Vec3>('size').onTransient(v)} onCommit={(b, a) => key<Vec3>('size').onCommit(b, a)} />
          ) : (
            <NumberRow label="Radius" value={comp.radius} {...key<number>('radius')} />
          )}
          <SliderRow label="Bounciness" value={comp.bounciness} {...key<number>('bounciness')} />
          <SliderRow label="Friction" value={comp.friction} min={0} max={2} {...key<number>('friction')} />
        </div>
      )}
    </div>
  )
}
