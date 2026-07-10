/**
 * Scene ビューポート: Three.js エンジンのマウント先 + Sceneビュー内ツールバー。
 */
import { useEffect, useRef } from 'react'
import { Grid3x3, Sun } from 'lucide-react'
import { getEngine } from '../../engine/ThreeEngine'
import { useEditorStore } from '../../store/editorStore'

export function ViewportPanel() {
  const ref = useRef<HTMLDivElement>(null)
  const showGrid = useEditorStore((s) => s.showGrid)
  const mode = useEditorStore((s) => s.mode)
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
        <button className="u-btn !h-[18px] !px-2 text-[11px]" title="Shading mode">
          Shaded
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
          <span className="text-[11px] text-[#9fc3e8] pr-2">
            {mode === 'play' ? '▶ Playing' : '⏸ Paused'}
          </span>
        )}
        <span className="text-u-sub text-[11px] pr-1">Gizmos</span>
      </div>
      {/* Three.js canvas マウント先 */}
      <div ref={ref} className="flex-1 min-h-0 relative overflow-hidden" />
    </div>
  )
}
