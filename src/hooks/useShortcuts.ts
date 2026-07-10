/**
 * Unity互換ショートカット (UNITY_UI_RESEARCH.md §9)。
 * W/E/R=ツール, F=フォーカス, Ctrl+D=複製, Delete=削除, Ctrl+Z/Y=Undo/Redo,
 * Ctrl+S=保存, Ctrl+C/V=コピー/ペースト, F2=リネーム。
 * 入力欄フォーカス中は発火しない。
 */
import { useEffect } from 'react'
import { useEditorStore } from '../store/editorStore'
import { copySelection, deleteSelection, duplicateSelection, pasteClipboard } from '../store/actions'
import { exportSceneToFile } from '../engine/serialization'
import { getEngine } from '../engine/ThreeEngine'

const isEditableTarget = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

export function useShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const st = useEditorStore.getState()
      if (isEditableTarget(e.target)) return
      if (getEngine().isFlying) return // フライスルー中のWASDQE等はカメラ移動専用 (Unity互換)
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()

      /* --- ツール切替 (修飾キーなし) --- */
      if (!mod && !e.altKey) {
        if (key === 'w') return st.setTool('move')
        if (key === 'e') return st.setTool('rotate')
        if (key === 'r') return st.setTool('scale')
        if (key === 'f') return st.requestFocus()
        if (e.key === 'F2') {
          const act = st.selection[st.selection.length - 1]
          if (act) st.setRenaming(act)
          return
        }
        if (e.key === 'Delete') {
          deleteSelection()
          return
        }
      }

      if (!mod) return

      /* --- Ctrl/Cmd 系 --- */
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        return st.undo()
      }
      if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault()
        return st.redo()
      }
      if (key === 'd') {
        e.preventDefault()
        duplicateSelection()
        return
      }
      if (key === 's') {
        e.preventDefault()
        return exportSceneToFile()
      }
      if (key === 'p' && !e.shiftKey) {
        /* Ctrl+P = Play/Stop (Unity互換) */
        e.preventDefault()
        return st.mode === 'edit' ? st.play() : st.stop()
      }
      if (key === 'c') {
        if (st.selection.length === 0) return
        e.preventDefault()
        copySelection()
        return
      }
      if (key === 'v') {
        if (st.clipboard.length === 0) return
        e.preventDefault()
        pasteClipboard()
        return
      }
      if (e.key === 'Backspace') {
        e.preventDefault()
        deleteSelection()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
