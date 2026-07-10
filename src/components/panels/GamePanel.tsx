/**
 * Game ビュー: シーン階層で最初の有効なカメラから描画 (Unity の Game ビュー相当, D-020)。
 * ▶ 再生でこのタブへ自動切替される (DockLayout 側で制御)。
 */
import { useEffect, useRef } from 'react'
import { VideoOff } from 'lucide-react'
import { getEngine } from '../../engine/ThreeEngine'
import { useEditorStore } from '../../store/editorStore'
import { getComponent } from '../../types/scene'

export function GamePanel() {
  const ref = useRef<HTMLDivElement>(null)
  const hasCamera = useEditorStore((s) =>
    Object.values(s.scene.nodes).some((n) => n.visible && getComponent(n, 'camera')),
  )
  const mode = useEditorStore((s) => s.mode)

  useEffect(() => {
    const engine = getEngine()
    if (ref.current) engine.mountGame(ref.current)
    return () => engine.unmountGame()
  }, [])

  return (
    <div className="h-full flex flex-col bg-[#1e1e1e]">
      <div className="h-[24px] flex items-center gap-2 px-2 bg-u-toolbar border-b border-u-border flex-none u-tint-target">
        <span className="text-[11px] text-u-sub">Display 1</span>
        <span className="text-[11px] text-u-sub">Free Aspect</span>
        <div className="flex-1" />
        {mode !== 'edit' && <span className="text-[11px] text-[#9fc3e8]">{mode === 'play' ? '▶ Playing' : '⏸ Paused'}</span>}
      </div>
      <div ref={ref} className="flex-1 min-h-0 relative overflow-hidden">
        {!hasCamera && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-u-sub pointer-events-none">
            <VideoOff size={28} />
            <span>No cameras rendering</span>
            <span className="text-[11px]">Add a Camera component to a GameObject</span>
          </div>
        )}
      </div>
    </div>
  )
}
