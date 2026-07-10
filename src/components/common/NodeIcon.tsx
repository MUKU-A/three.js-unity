/**
 * ノード型 → アイコン (Lucideによる独自代替, 権利ガード遵守)。
 * Hierarchy行・Inspectorヘッダで共用。
 */
import { Box, Camera, Circle, Cone, Cylinder, Disc3, Lightbulb, Package, Square, Sun, Zap } from 'lucide-react'
import type { SceneNode } from '../../types/scene'
import { getComponent } from '../../types/scene'

export function NodeIcon({ node, size = 13 }: { node: SceneNode; size?: number }) {
  const cls = 'flex-none text-[#8fb6d9]'
  const light = getComponent(node, 'light')
  if (light) {
    if (light.lightType === 'directional') return <Sun size={size} className="flex-none text-[#ffd76b]" />
    if (light.lightType === 'point') return <Lightbulb size={size} className="flex-none text-[#ffd76b]" />
    return <Zap size={size} className="flex-none text-[#ffd76b]" />
  }
  if (getComponent(node, 'camera')) return <Camera size={size} className={cls} />
  const mesh = getComponent(node, 'mesh')
  if (mesh) {
    if (mesh.assetId) return <Package size={size} className={cls} />
    switch (mesh.geometry) {
      case 'sphere':
        return <Circle size={size} className={cls} />
      case 'plane':
      case 'quad':
        return <Square size={size} className={cls} />
      case 'cylinder':
      case 'capsule':
        return <Cylinder size={size} className={cls} />
      case 'cone':
        return <Cone size={size} className={cls} />
      case 'torus':
        return <Disc3 size={size} className={cls} />
      default:
        return <Box size={size} className={cls} />
    }
  }
  return <Box size={size} className="flex-none text-u-sub" />
}
