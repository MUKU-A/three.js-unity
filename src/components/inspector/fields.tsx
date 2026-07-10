/**
 * Inspector のフィールド部品群。
 * Unityの手触りの核: ラベル横ドラッグ(スクラブ)による数値増減、
 * ドラッグ中は transient 反映・終了時に1つの Undo コマンド (D-005)。
 *
 * 変更プロトコル:
 *  - onTransient(v): ドラッグ中の一時反映 (ストアへ直書き, 履歴なし)
 *  - onCommit(before, after): 確定 (呼び側が after を適用し、履歴に積む)
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'

/* 表示丸め: Unityは有効桁を詰めて表示する */
const fmt = (v: number) => {
  if (!Number.isFinite(v)) return '0'
  const r = Math.round(v * 1e4) / 1e4
  return String(r)
}

/**
 * Unity 2021.2+ の数値フィールド数式入力を再現: "1+2*3" "(4-1)/2" 等の四則演算を受け付ける。
 * 数字と + - * / ( ) . 空白のみ許可した上で評価する。
 */
export function evalNumericExpression(text: string): number {
  const t = text.replace(',', '.').trim()
  const direct = Number(t)
  if (t !== '' && Number.isFinite(direct)) return direct
  if (!/^[0-9+\-*/(). ]+$/.test(t) || !/[0-9]/.test(t)) return NaN
  try {
    const v = new Function(`"use strict"; return (${t});`)() as unknown
    return typeof v === 'number' && Number.isFinite(v) ? v : NaN
  } catch {
    return NaN
  }
}

/* ---------------------------------- 行レイアウト ---------------------------------- */

/** ラベル列 ~40% : フィールド列 (UNITY_UI_RESEARCH.md §5) */
export function FieldRow({ label, children, labelEl }: { label?: string; children: ReactNode; labelEl?: ReactNode }) {
  return (
    <div className="flex items-center min-h-[20px] px-1 gap-1">
      <div className="w-[40%] flex-none text-u-label overflow-hidden text-ellipsis whitespace-nowrap pl-3">
        {labelEl ?? label}
      </div>
      <div className="flex-1 flex items-center gap-1 min-w-0">{children}</div>
    </div>
  )
}

/* ---------------------------------- スクラブ ---------------------------------- */

interface ScrubOpts {
  value: () => number
  onTransient: (v: number) => void
  onCommit: (before: number, after: number) => void
  speed?: number
}

/** ラベルに付ける横ドラッグハンドラ (pointer capture + 1ドラッグ=1コミット) */
function useScrub({ value, onTransient, onCommit, speed = 1 }: ScrubOpts) {
  const state = useRef<{ startX: number; startV: number; last: number; moved: boolean } | null>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    state.current = { startX: e.clientX, startV: value(), last: value(), moved: false }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const s = state.current
    if (!s) return
    const dx = e.clientX - s.startX
    if (!s.moved && Math.abs(dx) < 2) return
    s.moved = true
    document.body.dataset.scrubbing = 'true'
    /* 感度: 値の大きさに応じた適応 + Shift粗く / Alt細かく (§10) */
    const base = Math.max(0.01, Math.abs(s.startV) * 0.003)
    const mult = e.shiftKey ? 4 : e.altKey ? 0.25 : 1
    const raw = s.startV + dx * base * mult * speed
    const v = Math.round(raw * 1e3) / 1e3
    if (v !== s.last) {
      s.last = v
      onTransient(v)
    }
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const s = state.current
    state.current = null
    delete document.body.dataset.scrubbing
    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
    if (s?.moved && s.last !== s.startV) onCommit(s.startV, s.last)
  }
  return { onPointerDown, onPointerMove, onPointerUp, className: 'u-scrub select-none' }
}

/* ---------------------------------- NumberField ---------------------------------- */

export function NumberInput({
  value,
  onTransient,
  onCommit,
  className = '',
}: {
  value: number
  onTransient: (v: number) => void
  onCommit: (before: number, after: number) => void
  className?: string
}) {
  const [text, setText] = useState<string | null>(null) // null = 非編集中 (storeの値を表示)
  const beforeRef = useRef(value)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (text === null && ref.current) ref.current.value = fmt(value)
  }, [value, text])

  const commitTyped = () => {
    if (text === null) return
    const parsed = evalNumericExpression(text) // "1+2*3" 等の数式も許容 (Unity 2021.2+)
    setText(null)
    if (Number.isFinite(parsed) && parsed !== beforeRef.current) {
      onCommit(beforeRef.current, parsed)
      if (ref.current) ref.current.value = fmt(parsed)
    } else {
      /* 無効入力は元値へ戻す */
      onTransient(beforeRef.current)
      if (ref.current) ref.current.value = fmt(beforeRef.current)
    }
  }

  return (
    <input
      ref={ref}
      className={`u-input ${className}`}
      defaultValue={fmt(value)}
      onFocus={(e) => {
        beforeRef.current = value
        setText(e.target.value)
        e.target.select()
      }}
      onChange={(e) => {
        setText(e.target.value)
        /* Unity同様、タイプ中も即時反映 */
        const parsed = Number(e.target.value.replace(',', '.'))
        if (Number.isFinite(parsed)) onTransient(parsed)
      }}
      onBlur={commitTyped}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commitTyped()
          ;(e.target as HTMLInputElement).blur()
        } else if (e.key === 'Escape') {
          setText(null)
          onTransient(beforeRef.current)
          if (ref.current) ref.current.value = fmt(beforeRef.current)
          ;(e.target as HTMLInputElement).blur()
        }
        e.stopPropagation()
      }}
    />
  )
}

export function NumberField({
  label,
  value,
  onTransient,
  onCommit,
  labelWidth = 12,
}: {
  label: string
  value: number
  onTransient: (v: number) => void
  onCommit: (before: number, after: number) => void
  labelWidth?: number
}) {
  const scrub = useScrub({ value: () => value, onTransient, onCommit })
  return (
    <div className="flex items-center gap-0.5 flex-1 min-w-0">
      <span
        {...scrub}
        className={`${scrub.className} text-u-label flex-none text-center`}
        style={{ width: labelWidth }}
      >
        {label}
      </span>
      <NumberInput value={value} onTransient={onTransient} onCommit={onCommit} />
    </div>
  )
}

/** 行ラベル全体がスクラブになる単一数値行 (Intensity / FOV 等) */
export function NumberRow({
  label,
  value,
  onTransient,
  onCommit,
}: {
  label: string
  value: number
  onTransient: (v: number) => void
  onCommit: (before: number, after: number) => void
}) {
  const scrub = useScrub({ value: () => value, onTransient, onCommit })
  return (
    <FieldRow
      labelEl={
        <span {...scrub} className={`${scrub.className} block w-full`}>
          {label}
        </span>
      }
    >
      <NumberInput value={value} onTransient={onTransient} onCommit={onCommit} />
    </FieldRow>
  )
}

/* ---------------------------------- Vector3 ---------------------------------- */

export interface Vec3Like {
  x: number
  y: number
  z: number
}

export function Vector3Row({
  label,
  value,
  onTransient,
  onCommit,
}: {
  label: string
  value: Vec3Like
  onTransient: (v: Vec3Like) => void
  onCommit: (before: Vec3Like, after: Vec3Like) => void
}) {
  const axis = (k: keyof Vec3Like) => ({
    label: k.toUpperCase(),
    value: value[k],
    onTransient: (v: number) => onTransient({ ...value, [k]: v }),
    onCommit: (b: number, a: number) => onCommit({ ...value, [k]: b }, { ...value, [k]: a }),
  })
  return (
    <FieldRow label={label}>
      <NumberField {...axis('x')} />
      <NumberField {...axis('y')} />
      <NumberField {...axis('z')} />
    </FieldRow>
  )
}

/* ---------------------------------- Slider ---------------------------------- */

export function SliderRow({
  label,
  value,
  min = 0,
  max = 1,
  onTransient,
  onCommit,
}: {
  label: string
  value: number
  min?: number
  max?: number
  onTransient: (v: number) => void
  onCommit: (before: number, after: number) => void
}) {
  const beforeRef = useRef<number | null>(null)
  return (
    <FieldRow label={label}>
      <input
        type="range"
        className="u-slider"
        min={min}
        max={max}
        step={0.001}
        value={value}
        onPointerDown={() => (beforeRef.current = value)}
        onChange={(e) => onTransient(Number(e.target.value))}
        onPointerUp={(e) => {
          const before = beforeRef.current
          beforeRef.current = null
          const after = Number((e.target as HTMLInputElement).value)
          if (before !== null && before !== after) onCommit(before, after)
        }}
      />
      <div className="w-[52px] flex-none">
        <NumberInput value={value} onTransient={onTransient} onCommit={(b, a) => onCommit(b, Math.min(max, Math.max(min, a)))} />
      </div>
    </FieldRow>
  )
}

/* ---------------------------------- Color ---------------------------------- */

export function ColorRow({
  label,
  value,
  onCommit,
}: {
  label: string
  value: string
  onCommit: (before: string, after: string) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const beforeRef = useRef(value)
  return (
    <FieldRow label={label}>
      <button
        className="relative flex-1 h-[17px] rounded-[2px] border border-u-field-border overflow-hidden"
        style={{ background: value }}
        onClick={() => {
          beforeRef.current = value
          ref.current?.click()
        }}
      >
        {/* Unityのスウォッチ下部アルファバー表現 */}
        <span className="absolute bottom-0 left-0 right-0 h-[3px] bg-white" />
        <input
          ref={ref}
          type="color"
          value={value}
          className="absolute opacity-0 w-0 h-0"
          onChange={(e) => {
            const after = e.target.value
            if (after !== beforeRef.current) {
              onCommit(beforeRef.current, after)
              beforeRef.current = after
            }
          }}
        />
      </button>
    </FieldRow>
  )
}

/* ---------------------------------- Select / Checkbox ---------------------------------- */

export function SelectRow<T extends string>({
  label,
  value,
  options,
  onCommit,
}: {
  label: string
  value: T
  options: Array<{ value: T; label: string }>
  onCommit: (before: T, after: T) => void
}) {
  return (
    <FieldRow label={label}>
      <select
        className="u-input appearance-none cursor-default"
        value={value}
        onChange={(e) => onCommit(value, e.target.value as T)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldRow>
  )
}

export function CheckboxRow({
  label,
  value,
  onCommit,
}: {
  label: string
  value: boolean
  onCommit: (before: boolean, after: boolean) => void
}) {
  return (
    <FieldRow label={label}>
      <input type="checkbox" className="u-check" checked={value} onChange={() => onCommit(value, !value)} />
    </FieldRow>
  )
}
