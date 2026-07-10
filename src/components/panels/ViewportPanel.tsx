/**
 * Scene ビューポート: Three.js エンジンのマウント先 + Sceneビュー内ツールバー + 方位ギズモ。
 * カメラ操作 (D-021): Alt+左=オービット / 中=パン / 右ドラッグ+WASD=フライスルー / 左ドラッグ=矩形選択
 */
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Grid3x3, Sun } from 'lucide-react'
import { getEngine } from '../../engine/ThreeEngine'
import { useEditorStore } from '../../store/editorStore'
import { ContextMenu } from '../common/ContextMenu'
import { AxisGizmo } from './AxisGizmo'

export function ViewportPanel() {
  const ref = useRef<HTMLDivElement>(null)
  const showGrid = useEditorStore((s) => s.showGrid)
  const shading = useEditorStore((s) => s.shadingMode)
  const mode = useEditorStore((s) => s.mode)
  const [shadingMenu, setShadingMenu] = useState<{ x: number; y: number } | null>(null)
  const st = useEditorStore.getState

  useEffect(() => {
    const engine = getEngine()
    if (ref.current) engine.mount(ref.current)
    return () => engine.unmount()
  }, [])

  return (
    <div className="h-full flex flex-col bg-[#292929]">
      {/* Sceneビュー内ツールバー */}
      <div className="h-[24px] flex items-center gap-1 px-1 bg-u-toolbar border-b border-u-border flex-none u-tint-target">
        <button
          className="u-btn !h-[18px] !px-2 text-[11px] gap-1"
          title="Draw mode"
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            setShadingMenu({ x: r.left, y: r.bottom + 2 })
          }}
        >
          {shading === 'shaded' ? 'Shaded' : 'Wireframe'}
          <ChevronDown size={10} />
        </button>
        <span className="w-px h-[14px] bg-u-border mx-0.5" />
        <button
          className="u-toolbtn !h-[18px]"
          data-active={showGrid}
          title="Toggle grid"
          onClick={() => st().setShowGrid(!showGrid)}
        >
          <Grid3x3 size={13} />
        </button>
        <button className="u-toolbtn !h-[18px]" data-active="true" title="Scene lighting">
          <Sun size={13} />
        </button>
        <div className="flex-1" />
        {mode !== 'edit' && (
          <span className="text-[11px] text-[#9fc3e8] pr-2">{mode === 'play' ? '▶ Playing' : '⏸ Paused'}</span>
        )}
        <span className="text-u-sub text-[11px] pr-1">Gizmos</span>
      </div>
      {/* Three.js canvas マウント先 + オーバーレイ */}
      <div className="flex-1 min-h-0 relative overflow-hidden">
        <div ref={ref} className="absolute inset-0" />
        <AxisGizmo />
      </div>
      {shadingMenu && (
        <ContextMenu
          x={shadingMenu.x}
          y={shadingMenu.y}
          onClose={() => setShadingMenu(null)}
          items={[
            { label: 'Shaded', onClick: () => st().setShadingMode('shaded') },
            { label: 'Wireframe', onClick: () => st().setShadingMode('wireframe') },
          ]}
        />
      )}
    </div>
  )
}
