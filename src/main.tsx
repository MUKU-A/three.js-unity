import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import 'dockview-react/dist/styles/dockview.css'
import './index.css'
import App from './App'
import { useEditorStore } from './store/editorStore'

/* E2E検証・デバッグ用フック */
;(window as unknown as { __store: typeof useEditorStore }).__store = useEditorStore

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
