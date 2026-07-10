/**
 * dockview による Unity 風ドッキングレイアウト (D-001)。
 * デフォルト配置: 左 Hierarchy / 中央 Scene / 右 Inspector / 下 Project+Console (タブ共有)。
 * 全パネルはドラッグで再配置・タブ化・リサイズ可能。
 */
import { DockviewReact, type DockviewReadyEvent, type IDockviewPanelHeaderProps, type IDockviewPanelProps } from 'dockview-react'
import { Camera, FolderClosed, Info, Layers, ListTree } from 'lucide-react'
import { HierarchyPanel } from './panels/HierarchyPanel'
import { InspectorPanel } from './panels/InspectorPanel'
import { ViewportPanel } from './panels/ViewportPanel'
import { ProjectPanel } from './panels/ProjectPanel'
import { ConsolePanel } from './panels/ConsolePanel'

const components = {
  hierarchy: () => <HierarchyPanel />,
  scene: () => <ViewportPanel />,
  inspector: () => <InspectorPanel />,
  project: () => <ProjectPanel />,
  console: () => <ConsolePanel />,
} satisfies Record<string, React.FC<IDockviewPanelProps>>

const TAB_ICONS: Record<string, React.ReactNode> = {
  hierarchy: <ListTree size={12} />,
  scene: <Camera size={12} />,
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

function onReady(event: DockviewReadyEvent) {
  const api = event.api

  const scene = api.addPanel({ id: 'scene', component: 'scene', title: 'Scene' })
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

  /* Unityデフォルト比率 (§1): Hierarchy ~17% / Inspector ~24% / 下段 ~30% */
  const total = window.innerWidth
  hierarchy.api.setSize({ width: Math.max(230, total * 0.16) })
  inspector.api.setSize({ width: Math.max(300, total * 0.24) })
  project.api.setSize({ height: Math.max(180, window.innerHeight * 0.28) })

  project.api.setActive()
  scene.api.setActive()
}

export function DockLayout() {
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
