/**
 * dockview による Unity 風ドッキングレイアウト (D-001)。
 * デフォルト配置: 左 Hierarchy / 中央 Scene+Game (タブ) / 右 Inspector / 下 Project+Console (タブ)。
 * ▶ 再生で Game タブへ自動切替、⏹ 停止で Scene へ戻る (Unity互換, D-020)。
 */
import { useEffect, useRef } from 'react'
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
} from 'dockview-react'
import { Camera, FolderClosed, Gamepad2, Info, Layers, ListTree } from 'lucide-react'
import { HierarchyPanel } from './panels/HierarchyPanel'
import { InspectorPanel } from './panels/InspectorPanel'
import { ViewportPanel } from './panels/ViewportPanel'
import { GamePanel } from './panels/GamePanel'
import { ProjectPanel } from './panels/ProjectPanel'
import { ConsolePanel } from './panels/ConsolePanel'
import { useEditorStore } from '../store/editorStore'

const components = {
  hierarchy: () => <HierarchyPanel />,
  scene: () => <ViewportPanel />,
  game: () => <GamePanel />,
  inspector: () => <InspectorPanel />,
  project: () => <ProjectPanel />,
  console: () => <ConsolePanel />,
} satisfies Record<string, React.FC<IDockviewPanelProps>>

const TAB_ICONS: Record<string, React.ReactNode> = {
  hierarchy: <ListTree size={12} />,
  scene: <Camera size={12} />,
  game: <Gamepad2 size={12} />,
  inspector: <Layers size={12} />,
  project: <FolderClosed size={12} />,
  console: <Info size={12} />,
}

/** Unity風タブ (アイコン+タイトル、閉じるボタンなし) */
function UnityTab(props: IDockviewPanelHeaderProps) {
  return (
    <div className="flex items-center gap-1.5 px-3 h-full text-[12px] whitespace-nowrap">
      <span className="opacity-70">{TAB_ICONS[props.api.id]}</span>
      <span>{props.api.title}</span>
    </div>
  )
}

/** MenuBar (Window > Reset Layout) から呼ぶための制御フック */
export const layoutControl: { reset: () => void } = { reset: () => {} }

function buildDefaultLayout(api: DockviewApi) {
  api.clear()
  const scene = api.addPanel({ id: 'scene', component: 'scene', title: 'Scene' })
  api.addPanel({
    id: 'game',
    component: 'game',
    title: 'Game',
    position: { referencePanel: 'scene', direction: 'within' },
  })
  const hierarchy = api.addPanel({
    id: 'hierarchy',
    component: 'hierarchy',
    title: 'Hierarchy',
    position: { referencePanel: 'scene', direction: 'left' },
  })
  const inspector = api.addPanel({
    id: 'inspector',
    component: 'inspector',
    title: 'Inspector',
    position: { referencePanel: 'scene', direction: 'right' },
  })
  const project = api.addPanel({
    id: 'project',
    component: 'project',
    title: 'Project',
    position: { referencePanel: 'scene', direction: 'below' },
  })
  api.addPanel({
    id: 'console',
    component: 'console',
    title: 'Console',
    position: { referencePanel: 'project', direction: 'within' },
  })

  /* Unityデフォルト比率 (UNITY_UI_RESEARCH.md §1) */
  const total = window.innerWidth
  hierarchy.api.setSize({ width: Math.max(230, total * 0.16) })
  inspector.api.setSize({ width: Math.max(300, total * 0.24) })
  project.api.setSize({ height: Math.max(180, window.innerHeight * 0.28) })

  project.api.setActive()
  scene.api.setActive()
}

export function DockLayout() {
  const apiRef = useRef<DockviewApi | null>(null)

  /* ▶再生 → Gameタブ / ⏹停止 → Sceneタブ (Unity互換) */
  const mode = useEditorStore((s) => s.mode)
  const prevMode = useRef(mode)
  useEffect(() => {
    const api = apiRef.current
    if (!api) return
    if (prevMode.current === 'edit' && mode === 'play') api.getPanel('game')?.api.setActive()
    if (prevMode.current !== 'edit' && mode === 'edit') api.getPanel('scene')?.api.setActive()
    prevMode.current = mode
  }, [mode])

  const onReady = (event: DockviewReadyEvent) => {
    apiRef.current = event.api
    buildDefaultLayout(event.api)
    layoutControl.reset = () => buildDefaultLayout(event.api)
  }

  return (
    <DockviewReact
      className="dockview-theme-unity h-full"
      components={components}
      defaultTabComponent={UnityTab}
      onReady={onReady}
      disableFloatingGroups={false}
    />
  )
}
