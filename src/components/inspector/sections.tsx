/**
 * Inspector のコンポーネントセクション群 (Transform / Mesh / Material / Light / Camera)。
 * すべて SSoT 経由: transient 適用 + pushApplied で1操作=1Undo。
 */
import { useState, type ReactNode } from 'react'
import { Box, Camera, ChevronRight, Lightbulb, Move3d, Palette, MoreVertical, Type } from 'lucide-react'
import type {
  CameraComponent,
  Component,
  LightComponent,
  MaterialComponent,
  MeshComponent,
  NodeId,
  PrimitiveKind,
  SceneNode,
  Transform,
  UITextComponent,
} from '../../types/scene'
import { defaultTransform } from '../../types/scene'
import { cmdPatchComponent, cmdPatchNode, cmdRemoveComponent, useEditorStore } from '../../store/editorStore'
import { getAsset } from '../../engine/assets'
import { useContextMenu, type MenuItem } from '../common/ContextMenu'
import { CheckboxRow, ColorRow, NumberField, NumberRow, SelectRow, SliderRow, Vector3Row, FieldRow } from './fields'

/* ---------------------------------- 共通ヘッダ ---------------------------------- */

function ComponentHeader({
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
  /** Unityのビヘイビアチェックボックス (Light/Camera等)。undefined なら非表示 */
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

function Section({ children }: { children: ReactNode }) {
  return <div className="py-1 flex flex-col gap-[2px]">{children}</div>
}

/* ---------------------------------- Transform ---------------------------------- */

export function TransformSection({ node }: { node: SceneNode }) {
  const [open, setOpen] = useState(true)
  const st = useEditorStore.getState

  const transientVec = (key: keyof Transform) => (v: { x: number; y: number; z: number }) => {
    const t = st().scene.nodes[node.id]?.transform
    if (t) st().transientSetTransform(node.id, { ...t, [key]: v })
  }
  const commitVec = (key: keyof Transform, label: string) => (before: { x: number; y: number; z: number }, after: { x: number; y: number; z: number }) => {
    const t = st().scene.nodes[node.id]?.transform ?? node.transform
    const beforeT = { ...t, [key]: before }
    const afterT = { ...t, [key]: after }
    st().transientSetTransform(node.id, afterT)
    st().pushApplied(cmdPatchNode(node.id, { transform: beforeT }, { transform: afterT }, label))
  }

  return (
    <div>
      <ComponentHeader
        icon={<Move3d size={13} className="text-u-sub" />}
        title="Transform"
        open={open}
        onToggle={() => setOpen(!open)}
        menuItems={[
          {
            label: 'Reset',
            onClick: () => {
              const before = st().scene.nodes[node.id]?.transform ?? node.transform
              st().execute(cmdPatchNode(node.id, { transform: before }, { transform: defaultTransform() }, 'Reset Transform'))
            },
          },
        ]}
      />
      {open && (
        <Section>
          <Vector3Row label="Position" value={node.transform.position} onTransient={transientVec('position')} onCommit={commitVec('position', 'Move')} />
          <Vector3Row label="Rotation" value={node.transform.rotation} onTransient={transientVec('rotation')} onCommit={commitVec('rotation', 'Rotate')} />
          <Vector3Row label="Scale" value={node.transform.scale} onTransient={transientVec('scale')} onCommit={commitVec('scale', 'Scale')} />
        </Section>
      )}
    </div>
  )
}

/* ---------------------------------- コンポーネント共通の commit ---------------------------------- */

function useComponentCommit(id: NodeId, index: number) {
  const st = useEditorStore.getState
  const transient = (patch: Partial<Component>) => st().transientPatchComponent(id, index, patch)
  const commit = (before: Partial<Component>, after: Partial<Component>, name: string) => {
    st().transientPatchComponent(id, index, after)
    st().pushApplied(cmdPatchComponent(id, index, before, after, name))
  }
  /** 単一キーの糖衣 */
  const key =
    <K extends string, V>(k: K, name?: string) => ({
      onTransient: (v: V) => transient({ [k]: v } as Partial<Component>),
      onCommit: (b: V, a: V) => commit({ [k]: b } as Partial<Component>, { [k]: a } as Partial<Component>, name ?? `Set ${k}`),
    })
  return { transient, commit, key }
}

function removeMenu(id: NodeId, index: number): MenuItem[] {
  return [
    {
      label: 'Remove Component',
      onClick: () => useEditorStore.getState().execute(cmdRemoveComponent(id, index)),
    },
  ]
}

/* ---------------------------------- Mesh ---------------------------------- */

const GEOMETRIES: Array<{ value: PrimitiveKind; label: string }> = [
  { value: 'box', label: 'Cube' },
  { value: 'sphere', label: 'Sphere' },
  { value: 'capsule', label: 'Capsule' },
  { value: 'cylinder', label: 'Cylinder' },
  { value: 'cone', label: 'Cone' },
  { value: 'plane', label: 'Plane' },
  { value: 'quad', label: 'Quad' },
  { value: 'torus', label: 'Torus' },
]

export function MeshSection({ node, comp, index }: { node: SceneNode; comp: MeshComponent; index: number }) {
  const [open, setOpen] = useState(true)
  const { key } = useComponentCommit(node.id, index)
  const assetName = comp.assetId ? (getAsset(comp.assetId)?.meta.name ?? '(missing asset)') : null
  const clips = comp.assetId ? (getAsset(comp.assetId)?.model?.animations ?? []) : []
  /* animationClip: undefined=All(旧互換) / null=None / 名前 (D-028) */
  const animValue = comp.animationClip === undefined ? '__all__' : comp.animationClip === null ? '__none__' : comp.animationClip
  const commitAnim = (after: string) => {
    const mapped = after === '__all__' ? undefined : after === '__none__' ? null : after
    key<'animationClip', string | null | undefined>('animationClip', 'Set Animation').onCommit(comp.animationClip, mapped)
  }

  return (
    <div>
      <ComponentHeader
        icon={<Box size={13} className="text-u-sub" />}
        title="Mesh Filter"
        open={open}
        onToggle={() => setOpen(!open)}
        menuItems={removeMenu(node.id, index)}
        enabled={comp.enabled !== false}
        onToggleEnabled={() => key<'enabled', boolean>('enabled', 'Toggle Renderer').onCommit(comp.enabled !== false, comp.enabled === false)}
      />
      {open && (
        <Section>
          {assetName ? (
            <FieldRow label="Mesh">
              <div className="u-input flex items-center gap-1 bg-u-darker! text-u-label overflow-hidden">
                <Box size={11} className="flex-none" />
                <span className="overflow-hidden text-ellipsis whitespace-nowrap">{assetName}</span>
              </div>
            </FieldRow>
          ) : (
            <SelectRow label="Mesh" value={comp.geometry} options={GEOMETRIES} onCommit={(b, a) => key<'geometry', PrimitiveKind>('geometry', 'Change Mesh').onCommit(b, a)} />
          )}
          {clips.length > 0 && (
            <SelectRow
              label="Animation"
              value={animValue}
              options={[
                { value: '__all__', label: 'All Clips' },
                { value: '__none__', label: 'None' },
                ...clips.map((c) => ({ value: c.name, label: c.name })),
              ]}
              onCommit={(_b, a) => commitAnim(a)}
            />
          )}
          <CheckboxRow label="Cast Shadows" value={comp.castShadow} onCommit={(b, a) => key<'castShadow', boolean>('castShadow').onCommit(b, a)} />
          <CheckboxRow label="Receive Shadows" value={comp.receiveShadow} onCommit={(b, a) => key<'receiveShadow', boolean>('receiveShadow').onCommit(b, a)} />
        </Section>
      )}
    </div>
  )
}

/* ---------------------------------- Material ---------------------------------- */

export function MaterialSection({ node, comp, index }: { node: SceneNode; comp: MaterialComponent; index: number }) {
  const [open, setOpen] = useState(true)
  const { transient, commit, key } = useComponentCommit(node.id, index)
  const assets = useEditorStore((s) => s.assets)
  const textures = assets.filter((a) => a.type === 'texture')

  /* Tiling/Offset の軸別編集 (Unityのマテリアル毎 Tiling/Offset) */
  const uvKey = (slot: 'tiling' | 'offset', axis: 'x' | 'y', c: MaterialComponent) => {
    const cur = slot === 'tiling' ? (c.tiling ?? { x: 1, y: 1 }) : (c.offset ?? { x: 0, y: 0 })
    return {
      onTransient: (v: number) => transient({ [slot]: { ...cur, [axis]: v } }),
      onCommit: (b: number, a: number) =>
        commit({ [slot]: { ...cur, [axis]: b } }, { [slot]: { ...cur, [axis]: a } }, `Set ${slot}`),
    }
  }

  return (
    <div>
      <ComponentHeader
        icon={<Palette size={13} className="text-u-sub" />}
        title="Material"
        open={open}
        onToggle={() => setOpen(!open)}
        menuItems={removeMenu(node.id, index)}
      />
      {open && (
        <Section>
          <ColorRow label="Base Color" value={comp.color} onCommit={(b, a) => key<'color', string>('color', 'Set Color').onCommit(b, a)} />
          <SelectRow
            label="Base Map"
            value={comp.textureAssetId ?? ''}
            options={[{ value: '', label: 'None (Texture)' }, ...textures.map((t) => ({ value: t.id, label: t.name }))]}
            onCommit={(b, a) =>
              key<'textureAssetId', string | null>('textureAssetId', 'Set Texture').onCommit(b === '' ? null : b, a === '' ? null : a)
            }
          />
          <SelectRow
            label="Normal Map"
            value={comp.normalMapAssetId ?? ''}
            options={[{ value: '', label: 'None (Texture)' }, ...textures.map((t) => ({ value: t.id, label: t.name }))]}
            onCommit={(b, a) =>
              key<'normalMapAssetId', string | null>('normalMapAssetId', 'Set Normal Map').onCommit(b === '' ? null : b, a === '' ? null : a)
            }
          />
          <FieldRow label="Tiling">
            <NumberField label="X" value={comp.tiling?.x ?? 1} {...uvKey('tiling', 'x', comp)} />
            <NumberField label="Y" value={comp.tiling?.y ?? 1} {...uvKey('tiling', 'y', comp)} />
          </FieldRow>
          <FieldRow label="Offset">
            <NumberField label="X" value={comp.offset?.x ?? 0} {...uvKey('offset', 'x', comp)} />
            <NumberField label="Y" value={comp.offset?.y ?? 0} {...uvKey('offset', 'y', comp)} />
          </FieldRow>
          <SliderRow label="Metallic" value={comp.metalness} {...key<'metalness', number>('metalness')} />
          <SliderRow label="Roughness" value={comp.roughness} {...key<'roughness', number>('roughness')} />
          <SliderRow label="Opacity" value={comp.opacity} {...key<'opacity', number>('opacity')} />
          <ColorRow label="Emission" value={comp.emissive} onCommit={(b, a) => key<'emissive', string>('emissive', 'Set Emission').onCommit(b, a)} />
          <NumberRow label="Emission Intensity" value={comp.emissiveIntensity} {...key<'emissiveIntensity', number>('emissiveIntensity')} />
          <CheckboxRow label="Wireframe" value={comp.wireframe} onCommit={(b, a) => key<'wireframe', boolean>('wireframe').onCommit(b, a)} />
        </Section>
      )}
    </div>
  )
}

/* ---------------------------------- Light ---------------------------------- */

export function LightSection({ node, comp, index }: { node: SceneNode; comp: LightComponent; index: number }) {
  const [open, setOpen] = useState(true)
  const { key } = useComponentCommit(node.id, index)

  return (
    <div>
      <ComponentHeader
        icon={<Lightbulb size={13} className="text-[#ffd76b]" />}
        title="Light"
        open={open}
        onToggle={() => setOpen(!open)}
        menuItems={removeMenu(node.id, index)}
        enabled={comp.enabled !== false}
        onToggleEnabled={() => key<'enabled', boolean>('enabled', 'Toggle Light').onCommit(comp.enabled !== false, comp.enabled === false)}
      />
      {open && (
        <Section>
          <SelectRow
            label="Type"
            value={comp.lightType}
            options={[
              { value: 'directional', label: 'Directional' },
              { value: 'point', label: 'Point' },
              { value: 'spot', label: 'Spot' },
            ]}
            onCommit={(b, a) => key<'lightType', string>('lightType', 'Change Light Type').onCommit(b, a)}
          />
          <ColorRow label="Color" value={comp.color} onCommit={(b, a) => key<'color', string>('color', 'Set Light Color').onCommit(b, a)} />
          <NumberRow label="Intensity" value={comp.intensity} {...key<'intensity', number>('intensity')} />
          {comp.lightType !== 'directional' && <NumberRow label="Range" value={comp.range} {...key<'range', number>('range')} />}
          {comp.lightType === 'spot' && (
            <>
              <SliderRow label="Spot Angle" value={comp.spotAngle} min={1} max={179} {...key<'spotAngle', number>('spotAngle')} />
              <SliderRow label="Penumbra" value={comp.penumbra} {...key<'penumbra', number>('penumbra')} />
            </>
          )}
          <CheckboxRow label="Cast Shadows" value={comp.castShadow} onCommit={(b, a) => key<'castShadow', boolean>('castShadow').onCommit(b, a)} />
        </Section>
      )}
    </div>
  )
}

/* ---------------------------------- Camera ---------------------------------- */

export function CameraSection({ node, comp, index }: { node: SceneNode; comp: CameraComponent; index: number }) {
  const [open, setOpen] = useState(true)
  const { key } = useComponentCommit(node.id, index)

  return (
    <div>
      <ComponentHeader
        icon={<Camera size={13} className="text-u-sub" />}
        title="Camera"
        open={open}
        onToggle={() => setOpen(!open)}
        menuItems={removeMenu(node.id, index)}
        enabled={comp.enabled !== false}
        onToggleEnabled={() => key<'enabled', boolean>('enabled', 'Toggle Camera').onCommit(comp.enabled !== false, comp.enabled === false)}
      />
      {open && (
        <Section>
          <SelectRow
            label="Projection"
            value={comp.projection}
            options={[
              { value: 'perspective', label: 'Perspective' },
              { value: 'orthographic', label: 'Orthographic' },
            ]}
            onCommit={(b, a) => key<'projection', string>('projection', 'Change Projection').onCommit(b, a)}
          />
          {comp.projection === 'perspective' ? (
            <SliderRow label="Field of View" value={comp.fov} min={1} max={179} {...key<'fov', number>('fov')} />
          ) : (
            <NumberRow label="Size" value={comp.orthoSize} {...key<'orthoSize', number>('orthoSize')} />
          )}
          <FieldRow label="Clipping Planes">
            <NumberField label="Near" labelWidth={32} value={comp.near} {...key<'near', number>('near')} />
          </FieldRow>
          <FieldRow label="">
            <NumberField label="Far" labelWidth={32} value={comp.far} {...key<'far', number>('far')} />
          </FieldRow>
        </Section>
      )}
    </div>
  )
}

/* ---------------------------------- UI Text (D-035) ---------------------------------- */

function TextValueRow({ label, value, onCommit }: { label: string; value: string; onCommit: (b: string, a: string) => void }) {
  const [text, setText] = useState(value)
  const commit = () => {
    if (text !== value) onCommit(value, text)
  }
  return (
    <FieldRow label={label}>
      <input
        className="u-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          e.stopPropagation()
        }}
      />
    </FieldRow>
  )
}

export function UITextSection({ node, comp, index }: { node: SceneNode; comp: UITextComponent; index: number }) {
  const [open, setOpen] = useState(true)
  const { key } = useComponentCommit(node.id, index)

  return (
    <div>
      <ComponentHeader
        icon={<Type size={13} className="text-[#9fd18a]" />}
        title="UI Text"
        open={open}
        onToggle={() => setOpen(!open)}
        menuItems={removeMenu(node.id, index)}
        enabled={comp.enabled !== false}
        onToggleEnabled={() => key<'enabled', boolean>('enabled', 'Toggle UI Text').onCommit(comp.enabled !== false, comp.enabled === false)}
      />
      {open && (
        <Section>
          <TextValueRow key={comp.text} label="Text" value={comp.text} onCommit={(b, a) => key<'text', string>('text', 'Set Text').onCommit(b, a)} />
          <NumberRow label="Font Size" value={comp.fontSize} {...key<'fontSize', number>('fontSize')} />
          <ColorRow label="Color" value={comp.color} onCommit={(b, a) => key<'color', string>('color', 'Set Text Color').onCommit(b, a)} />
          <SelectRow
            label="Anchor X"
            value={comp.anchorX}
            options={[
              { value: 'left', label: 'Left' },
              { value: 'center', label: 'Center' },
              { value: 'right', label: 'Right' },
            ]}
            onCommit={(b, a) => key<'anchorX', string>('anchorX', 'Set Anchor').onCommit(b, a)}
          />
          <SelectRow
            label="Anchor Y"
            value={comp.anchorY}
            options={[
              { value: 'top', label: 'Top' },
              { value: 'middle', label: 'Middle' },
              { value: 'bottom', label: 'Bottom' },
            ]}
            onCommit={(b, a) => key<'anchorY', string>('anchorY', 'Set Anchor').onCommit(b, a)}
          />
          <NumberRow label="Offset X" value={comp.offsetX} {...key<'offsetX', number>('offsetX')} />
          <NumberRow label="Offset Y" value={comp.offsetY} {...key<'offsetY', number>('offsetY')} />
        </Section>
      )}
    </div>
  )
}
