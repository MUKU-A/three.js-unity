/**
 * Unity風コンテキスト/ドロップダウンメニュー。
 * items にネスト(submenu)・区切り線・ショートカット表示・無効状態を持てる。
 */
import { useEffect, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'

export interface MenuItem {
  label?: string
  shortcut?: string
  disabled?: boolean
  separator?: boolean
  onClick?: () => void
  children?: MenuItem[]
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  useEffect(() => {
    const el = ref.current
    if (el) {
      const r = el.getBoundingClientRect()
      setPos({
        x: Math.min(x, window.innerWidth - r.width - 4),
        y: Math.min(y, window.innerHeight - r.height - 4),
      })
    }
  }, [x, y])

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  return (
    <div ref={ref} className="u-menu" style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      <MenuList items={items} onClose={onClose} />
    </div>
  )
}

export function MenuList({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  const [openSub, setOpenSub] = useState<number | null>(null)

  return (
    <>
      {items.map((item, i) => {
        if (item.separator) return <div key={i} className="u-menu-sep" />
        const hasChildren = !!item.children?.length
        return (
          <div
            key={i}
            className="u-menu-item"
            data-disabled={item.disabled || undefined}
            onMouseEnter={() => setOpenSub(hasChildren ? i : null)}
            onClick={(e) => {
              e.stopPropagation()
              if (item.disabled || hasChildren) return
              item.onClick?.()
              onClose()
            }}
          >
            <span>{item.label}</span>
            {item.shortcut && <span className="u-menu-shortcut">{item.shortcut}</span>}
            {hasChildren && <ChevronRight size={12} className="text-u-sub -mr-3.5" />}
            {hasChildren && openSub === i && (
              <div className="u-menu" style={{ position: 'absolute', left: '100%', top: -4 }}>
                <MenuList items={item.children!} onClose={onClose} />
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

/** 右クリックメニューの状態管理フック */
export function useContextMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const open = (e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, items })
  }
  const element = menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null
  return { open, element, close: () => setMenu(null) }
}
