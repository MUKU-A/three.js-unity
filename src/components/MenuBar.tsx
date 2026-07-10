/**
 * メニューバー (File / Edit / GameObject / Component / Window / Help) — Unity最上段の再現 (D-019)。
 * クリックで開き、開いている間は隣のメニューへホバーで切替 (ネイティブメニュー挙動)。
 */
import { useState } from 'react'
import { activeNodeId, cmdAddComponent, useEditorStore } from '../store/editorStore'
import { copySelection, deleteSelection, duplicateSelection, pasteClipboard } from '../store/actions'
import { exportSceneToFile, openSceneFilePicker } from '../engine/serialization'
import { creationMenuItems } from './panels/HierarchyPanel'
import { MenuList, type MenuItem } from './common/ContextMenu'
import { defaultCamera, defaultLight, defaultMaterial, defaultMesh, getComponent } from '../types/scene'
import { layoutControl } from './DockLayout'

export function MenuBar() {
  const [open, setOpen] = useState<number | null>(null)
  const undoName = useEditorStore((s) => (s.undoStack.length > 0 ? s.undoStack[s.undoStack.length - 1].name : null))
  const redoName = useEditorStore((s) => (s.redoStack.length > 0 ? s.redoStack[s.redoStack.length - 1].name : null))
  const hasSelection = useEditorStore((s) => s.selection.length > 0)
  const clipboardEmpty = useEditorStore((s) => s.clipboard.length === 0)
  const mode = useEditorStore((s) => s.mode)
  const activeNode = useEditorStore((s) => {
    const id = activeNodeId(s)
    return id ? s.scene.nodes[id] : null
  })
  const st = useEditorStore.getState

  const componentItems = (): MenuItem[] => {
    const defs = [
      { label: 'Mesh Filter', type: 'mesh' as const, make: () => defaultMesh('box') },
      { label: 'Material', type: 'material' as const, make: () => defaultMaterial() },
      { label: 'Light', type: 'light' as const, make: () => defaultLight('point') },
      { label: 'Camera', type: 'camera' as const, make: () => defaultCamera() },
    ]
    return defs.map((d) => ({
      label: d.label,
      disabled: !activeNode || !!getComponent(activeNode, d.type),
      onClick: () => {
        if (activeNode) st().execute(cmdAddComponent(activeNode.id, d.make()))
      },
    }))
  }

  const menus: Array<{ label: string; items: () => MenuItem[] }> = [
    {
      label: 'File',
      items: () => [
        {
          label: 'New Scene',
          shortcut: '',
          onClick: () => {
            if (window.confirm('Create a new scene? Unsaved changes will be lost.')) st().newScene()
          },
        },
        { label: 'Open Scene…', onClick: () => openSceneFilePicker() },
        { separator: true },
        { label: 'Save Scene', shortcut: 'Ctrl+S', onClick: () => exportSceneToFile() },
        { separator: true },
        { label: 'Import New Asset…', onClick: () => triggerAssetImport() },
      ],
    },
    {
      label: 'Edit',
      items: () => [
        { label: `Undo ${undoName ?? ''}`, shortcut: 'Ctrl+Z', disabled: !undoName, onClick: () => st().undo() },
        { label: `Redo ${redoName ?? ''}`, shortcut: 'Ctrl+Y', disabled: !redoName, onClick: () => st().redo() },
        { separator: true },
        { label: 'Copy', shortcut: 'Ctrl+C', disabled: !hasSelection, onClick: () => copySelection() },
        { label: 'Paste', shortcut: 'Ctrl+V', disabled: clipboardEmpty, onClick: () => pasteClipboard() },
        { label: 'Duplicate', shortcut: 'Ctrl+D', disabled: !hasSelection, onClick: () => duplicateSelection() },
        { label: 'Delete', shortcut: 'Del', disabled: !hasSelection, onClick: () => deleteSelection() },
        { separator: true },
        { label: mode === 'edit' ? 'Play' : 'Stop', shortcut: 'Ctrl+P', onClick: () => (mode === 'edit' ? st().play() : st().stop()) },
        { label: 'Pause', disabled: mode === 'edit', onClick: () => st().pause() },
      ],
    },
    { label: 'GameObject', items: () => creationMenuItems(null) },
    { label: 'Component', items: componentItems },
    {
      label: 'Window',
      items: () => [
        { label: 'Reset Layout', onClick: () => layoutControl.reset() },
      ],
    },
    {
      label: 'Help',
      items: () => [
        { label: 'Unity Documentation Links', onClick: () => window.open('https://github.com/MUKU-A/three.js-unity/blob/main/docs/UNITY_DOC_LINKS.md', '_blank') },
        { label: 'three.js Documentation', onClick: () => window.open('https://threejs.org/docs/', '_blank') },
        { separator: true },
        { label: 'About UnityThree Editor', onClick: () => st().log('info', 'UnityThree Editor — Unity-style editor UI driving a three.js scene graph (r185)') },
      ],
    },
  ]

  return (
    <div className="h-[24px] flex items-stretch px-1 bg-u-window border-b border-u-window-border flex-none select-none relative z-[900]">
      {menus.map((m, i) => (
        <div key={m.label} className="relative flex">
          <button
            className={`px-2.5 text-[12px] text-u-text rounded-[2px] my-0.5 ${open === i ? 'bg-u-btn-press' : 'hover:bg-u-btn-hover'}`}
            onClick={() => setOpen(open === i ? null : i)}
            onMouseEnter={() => {
              if (open !== null && open !== i) setOpen(i)
            }}
          >
            {m.label}
          </button>
          {open === i && (
            <div className="u-menu" style={{ position: 'absolute', left: 0, top: '100%' }}>
              <MenuList items={m.items()} onClose={() => setOpen(null)} />
            </div>
          )}
        </div>
      ))}
      {open !== null && <div className="fixed inset-0 z-[-1]" onMouseDown={() => setOpen(null)} />}
    </div>
  )
}

/** File > Import New Asset… (Projectパネルと同じ取り込み経路) */
function triggerAssetImport() {
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
  input.accept = '.glb,.gltf,.png,.jpg,.jpeg,.webp'
  input.onchange = async () => {
    if (!input.files) return
    const { importFile } = await import('../engine/assets')
    const st = useEditorStore.getState
    for (const file of Array.from(input.files)) {
      try {
        const meta = await importFile(file)
        st().setAssets([...st().assets, meta])
        st().log('info', `Imported asset '${meta.name}' (${(meta.size / 1024).toFixed(1)} KB)`)
      } catch (err) {
        st().log('error', `Import failed for '${file.name}': ${String(err)}`)
      }
    }
  }
  input.click()
}
