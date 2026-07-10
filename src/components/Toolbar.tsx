/**
 * メインツールバー (UNITY_UI_RESEARCH.md §7)。
 * 左: Move/Rotate/Scale + Global/Local | 中央: ▶ ⏸ ⏹ | 右: シーン名 + Save/Load。
 */
import { FolderOpen, Globe, Move3d, Pause, Play, Rotate3d, Save, Scale3d, Square } from 'lucide-react'
import { useEditorStore } from '../store/editorStore'
import { exportSceneToFile, openSceneFilePicker } from '../engine/serialization'

export function Toolbar() {
  const tool = useEditorStore((s) => s.tool)
  const space = useEditorStore((s) => s.transformSpace)
  const mode = useEditorStore((s) => s.mode)
  const sceneName = useEditorStore((s) => s.scene.name)
  const st = useEditorStore.getState

  return (
    <div className="h-[30px] flex items-center px-2 gap-1 bg-u-toolbar border-b border-u-window-border flex-none u-tint-target">
      {/* 左: ツール群 (W/E/R) */}
      <div className="flex items-center gap-0.5">
        <button className="u-toolbtn" data-active={tool === 'move'} title="Move (W)" onClick={() => st().setTool('move')}>
          <Move3d size={15} />
        </button>
        <button className="u-toolbtn" data-active={tool === 'rotate'} title="Rotate (E)" onClick={() => st().setTool('rotate')}>
          <Rotate3d size={15} />
        </button>
        <button className="u-toolbtn" data-active={tool === 'scale'} title="Scale (R)" onClick={() => st().setTool('scale')}>
          <Scale3d size={15} />
        </button>
      </div>
      <span className="w-px h-[16px] bg-u-border mx-1" />
      <button
        className="u-btn !h-[22px] text-[11px]"
        title="Transform gizmo space"
        onClick={() => st().setTransformSpace(space === 'world' ? 'local' : 'world')}
      >
        <Globe size={12} />
        {space === 'world' ? 'Global' : 'Local'}
      </button>

      {/* 中央: 再生コントロール */}
      <div className="flex-1 flex items-center justify-center gap-0.5">
        <button
          className="u-toolbtn !w-[32px]"
          data-active={mode !== 'edit'}
          title="Play"
          onClick={() => (mode === 'edit' ? st().play() : st().stop())}
        >
          <Play size={14} fill={mode !== 'edit' ? 'currentColor' : 'none'} />
        </button>
        <button
          className="u-toolbtn !w-[32px]"
          data-active={mode === 'paused'}
          title="Pause"
          onClick={() => st().pause()}
        >
          <Pause size={14} fill={mode === 'paused' ? 'currentColor' : 'none'} />
        </button>
        <button className="u-toolbtn !w-[32px]" title="Stop" onClick={() => st().stop()} disabled={mode === 'edit'}>
          <Square size={13} fill={mode !== 'edit' ? 'currentColor' : 'none'} className={mode === 'edit' ? 'opacity-40' : ''} />
        </button>
      </div>

      {/* 右: シーン名 + Save/Load */}
      <span className="text-u-sub text-[11px] mr-2">{sceneName}</span>
      <button className="u-btn !h-[22px] text-[11px]" title="Save scene as JSON (Ctrl+S)" onClick={() => exportSceneToFile()}>
        <Save size={12} />
        Save
      </button>
      <button className="u-btn !h-[22px] text-[11px]" title="Load scene from JSON" onClick={() => openSceneFilePicker()}>
        <FolderOpen size={12} />
        Load
      </button>
    </div>
  )
}
