import { useEffect } from 'react'
import { AlertTriangle, Info, XCircle } from 'lucide-react'
import { Toolbar } from './components/Toolbar'
import { DockLayout } from './components/DockLayout'
import { useShortcuts } from './hooks/useShortcuts'
import { useEditorStore } from './store/editorStore'

export default function App() {
  useShortcuts()
  const playing = useEditorStore((s) => s.mode !== 'edit')

  /* ランタイムエラーを Console パネルへ */
  useEffect(() => {
    const onError = (e: ErrorEvent) => useEditorStore.getState().log('error', e.message)
    const onRejection = (e: PromiseRejectionEvent) =>
      useEditorStore.getState().log('error', `Unhandled rejection: ${String(e.reason)}`)
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  return (
    <div className={`h-full flex flex-col bg-u-window ${playing ? 'u-playing' : ''}`}>
      <Toolbar />
      <div className="flex-1 min-h-0">
        <DockLayout />
      </div>
      <StatusBar />
    </div>
  )
}

/** Unity風ステータスバー (最終ログの1行プレビュー) */
function StatusBar() {
  const last = useEditorStore((s) => (s.logs.length > 0 ? s.logs[s.logs.length - 1] : null))
  return (
    <div className="h-[22px] flex items-center gap-1.5 px-2 bg-u-toolbar border-t border-u-window-border flex-none text-u-sub">
      {last &&
        (last.level === 'info' ? (
          <Info size={12} className="text-[#8ab4dd] flex-none" />
        ) : last.level === 'warn' ? (
          <AlertTriangle size={12} className="text-u-warn flex-none" />
        ) : (
          <XCircle size={12} className="text-u-error flex-none" />
        ))}
      <span className="overflow-hidden text-ellipsis whitespace-nowrap">{last?.message}</span>
      <div className="flex-1" />
      <span className="text-[10px]">UnityThree Editor — three.js r185</span>
    </div>
  )
}
