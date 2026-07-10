/**
 * Console パネル: 情報/警告/エラーのフィルタトグル + Clear (+ Clear on Play)。
 */
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Info, XCircle } from 'lucide-react'
import { useEditorStore } from '../../store/editorStore'

export function ConsolePanel() {
  const logs = useEditorStore((s) => s.logs)
  const clearOnPlay = useEditorStore((s) => s.clearOnPlay)
  const [show, setShow] = useState({ info: true, warn: true, error: true })
  const [selected, setSelected] = useState<number | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const st = useEditorStore.getState

  const counts = {
    info: logs.filter((l) => l.level === 'info').length,
    warn: logs.filter((l) => l.level === 'warn').length,
    error: logs.filter((l) => l.level === 'error').length,
  }
  const filtered = logs.filter((l) => show[l.level])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [logs.length])

  return (
    <div className="h-full flex flex-col bg-u-list">
      <div className="flex items-center gap-1 px-1 h-[24px] bg-u-toolbar border-b border-u-border flex-none">
        <button className="u-btn !h-[18px] !px-2 text-[11px]" onClick={() => st().clearLogs()}>
          Clear
        </button>
        <label className="flex items-center gap-1 text-[11px] text-u-sub px-1">
          <input
            type="checkbox"
            className="u-check !w-[11px] !h-[11px]"
            checked={clearOnPlay}
            onChange={(e) => st().setClearOnPlay(e.target.checked)}
          />
          Clear on Play
        </label>
        <div className="flex-1" />
        <FilterButton
          icon={<Info size={12} className="text-[#8ab4dd]" />}
          count={counts.info}
          active={show.info}
          onClick={() => setShow((s) => ({ ...s, info: !s.info }))}
        />
        <FilterButton
          icon={<AlertTriangle size={12} className="text-u-warn" />}
          count={counts.warn}
          active={show.warn}
          onClick={() => setShow((s) => ({ ...s, warn: !s.warn }))}
        />
        <FilterButton
          icon={<XCircle size={12} className="text-u-error" />}
          count={counts.error}
          active={show.error}
          onClick={() => setShow((s) => ({ ...s, error: !s.error }))}
        />
      </div>
      <div className="flex-1 overflow-y-auto font-[Inter]">
        {filtered.map((l) => (
          <div
            key={l.id}
            className="u-log-row"
            data-selected={selected === l.id}
            onMouseDown={() => setSelected(l.id)}
          >
            {l.level === 'info' ? (
              <Info size={13} className="text-[#8ab4dd] flex-none" />
            ) : l.level === 'warn' ? (
              <AlertTriangle size={13} className="text-u-warn flex-none" />
            ) : (
              <XCircle size={13} className="text-u-error flex-none" />
            )}
            <span className="text-u-sub text-[10px] flex-none">[{l.time}]</span>
            <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap select-text">{l.message}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  )
}

function FilterButton({
  icon,
  count,
  active,
  onClick,
}: {
  icon: React.ReactNode
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      className="u-toolbtn !w-auto !h-[18px] px-1.5 gap-1 flex items-center"
      data-active={active}
      onClick={onClick}
    >
      {icon}
      <span className="text-[11px]">{count > 99 ? '99+' : count}</span>
    </button>
  )
}
