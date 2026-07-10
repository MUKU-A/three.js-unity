/**
 * シーン方位ギズモ (Unityの右上オリエンテーションキューブ相当, D-022)。
 * カメラの向きに追従して6軸ハンドルを表示し、クリックでその軸ビューへアニメーション整列。
 * three.js の ViewHelper は位置が右下固定のため、Unity同様の右上配置で独自実装。
 */
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { getEngine } from '../../engine/ThreeEngine'

const AXES: Array<{ name: string; dir: [number, number, number]; color: string; label?: string }> = [
  { name: '+x', dir: [1, 0, 0], color: '#DB3E1D', label: 'X' },
  { name: '-x', dir: [-1, 0, 0], color: '#DB3E1D' },
  { name: '+y', dir: [0, 1, 0], color: '#9AF348', label: 'Y' },
  { name: '-y', dir: [0, -1, 0], color: '#9AF348' },
  { name: '+z', dir: [0, 0, 1], color: '#3A7AF8', label: 'Z' },
  { name: '-z', dir: [0, 0, -1], color: '#3A7AF8' },
]

const R = 26 // ハンドル配置半径(px)

export function AxisGizmo() {
  const [proj, setProj] = useState<Array<{ x: number; y: number; z: number }>>(
    AXES.map(() => ({ x: 0, y: 0, z: 0 })),
  )
  const lastQ = useRef(new THREE.Quaternion())

  useEffect(() => {
    let raf = 0
    const inv = new THREE.Quaternion()
    const v = new THREE.Vector3()
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const cam = getEngine().camera
      if (lastQ.current.equals(cam.quaternion)) return
      lastQ.current.copy(cam.quaternion)
      inv.copy(cam.quaternion).invert()
      setProj(
        AXES.map((a) => {
          v.set(a.dir[0], a.dir[1], a.dir[2]).applyQuaternion(inv)
          return { x: v.x * R, y: -v.y * R, z: v.z }
        }),
      )
    }
    loop()
    return () => cancelAnimationFrame(raf)
  }, [])

  /* 奥→手前の順に描画 */
  const order = proj.map((p, i) => ({ ...p, i })).sort((a, b) => a.z - b.z)

  return (
    <div
      className="absolute top-2 right-2 w-[72px] h-[72px] rounded-full hover:bg-white/5 z-10"
      title="Click an axis to align the view"
    >
      <svg viewBox="-36 -36 72 72" className="w-full h-full">
        {/* 正軸への接続線 */}
        {order
          .filter((o) => AXES[o.i].name.startsWith('+'))
          .map((o) => (
            <line key={`l${o.i}`} x1="0" y1="0" x2={o.x} y2={o.y} stroke={AXES[o.i].color} strokeWidth="1.6" opacity={0.9} />
          ))}
        {order.map((o) => {
          const axis = AXES[o.i]
          const positive = axis.name.startsWith('+')
          const front = o.z >= 0
          return (
            <g
              key={axis.name}
              transform={`translate(${o.x}, ${o.y})`}
              className="cursor-pointer"
              onClick={() => getEngine().alignToAxis(new THREE.Vector3(...axis.dir))}
            >
              <circle
                r={positive ? 7 : 5.5}
                fill={positive ? axis.color : '#38383877'}
                stroke={axis.color}
                strokeWidth={positive ? 0 : 1.4}
                opacity={front ? 1 : 0.45}
              />
              {axis.label && front && (
                <text y="3" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="#1e1e1e">
                  {axis.label}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
