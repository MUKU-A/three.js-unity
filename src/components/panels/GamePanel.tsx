/**
 * Game ビュー: シーン階層で最初の有効なカメラから描画 (Unity の Game ビュー相当, D-020)。
 * ▶ 再生でこのタブへ自動切替される (DockLayout 側で制御)。
 * uitext コンポーネントは DOM オーバーレイとして描画 (UnityのScreen Space Canvas相当, D-035)。
 */
import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import { VideoOff } from 'lucide-react'
import { getEngine } from '../../engine/ThreeEngine'
import { useEditorStore } from '../../store/editorStore'
import { getComponent } from '../../types/scene'
import type { NodeId, SceneGraph, UITextComponent } from '../../types/scene'

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
        <UITextOverlay />
      </div>
    </div>
  )
}

/* ---------------------------------- UI Text オーバーレイ (D-035) ---------------------------------- */

function chainVisible(graph: SceneGraph, id: NodeId): boolean {
  let cur = graph.nodes[id]
  while (cur) {
    if (!cur.visible) return false
    cur = cur.parentId ? graph.nodes[cur.parentId] : (undefined as never)
  }
  return true
}

function anchorStyle(c: UITextComponent): CSSProperties {
  const s: CSSProperties = { position: 'absolute', whiteSpace: 'pre-line' }
  if (c.anchorX === 'left') s.left = c.offsetX
  else if (c.anchorX === 'right') s.right = c.offsetX
  else {
    s.left = '50%'
    s.marginLeft = c.offsetX
  }
  if (c.anchorY === 'top') s.top = c.offsetY
  else if (c.anchorY === 'bottom') s.bottom = c.offsetY
  else {
    s.top = '50%'
    s.marginTop = c.offsetY
  }
  if (c.anchorX === 'center' || c.anchorY === 'middle') {
    s.transform = `translate(${c.anchorX === 'center' ? '-50%' : '0'}, ${c.anchorY === 'middle' ? '-50%' : '0'})`
  }
  return s
}

function UITextOverlay() {
  const scene = useEditorStore((s) => s.scene)
  const texts: Array<{ id: NodeId; comp: UITextComponent }> = []
  for (const id in scene.nodes) {
    const comp = getComponent(scene.nodes[id], 'uitext')
    if (comp && comp.enabled !== false && chainVisible(scene, id)) texts.push({ id, comp })
  }
  if (texts.length === 0) return null
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-10" data-testid="uitext-overlay">
      {texts.map(({ id, comp }) => (
        <span
          key={id}
          style={{
            ...anchorStyle(comp),
            fontSize: comp.fontSize,
            color: comp.color,
            fontFamily: 'Inter, sans-serif',
            textShadow: '0 1px 2px rgba(0,0,0,0.6)',
            lineHeight: 1.25,
          }}
        >
          {comp.text}
        </span>
      ))}
    </div>
  )
}
