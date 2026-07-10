/**
 * シーングラフの正 (Single Source of Truth) となるプレーンなデータモデル。
 * Three.js の Object3D はここから派生生成される (engine/ThreeEngine)。
 * 正規化構造 (nodes: Record<id, node> + rootIds) — 将来の Supabase 保存を想定。
 */

export type NodeId = string

export interface Vec3 {
  x: number
  y: number
  z: number
}

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z })

export interface Transform {
  position: Vec3
  /** オイラー角・度数法 (Unity表記)。Three.js へはラジアン変換して結線する */
  rotation: Vec3
  scale: Vec3
}

export const defaultTransform = (): Transform => ({
  position: vec3(0, 0, 0),
  rotation: vec3(0, 0, 0),
  scale: vec3(1, 1, 1),
})

/* ---------------------------------- Components ---------------------------------- */

export type PrimitiveKind =
  | 'box'
  | 'sphere'
  | 'plane'
  | 'cylinder'
  | 'capsule'
  | 'cone'
  | 'torus'
  | 'quad'

export interface MeshComponent {
  type: 'mesh'
  /** プリミティブ種別。assetId 指定時は無視される */
  geometry: PrimitiveKind
  /** GLBアセット参照 (Projectパネルからのインポート品) */
  assetId?: string | null
  castShadow: boolean
  receiveShadow: boolean
}

export interface MaterialComponent {
  type: 'material'
  /** #rrggbb */
  color: string
  metalness: number
  roughness: number
  /** 0..1, 1=不透明 */
  opacity: number
  emissive: string
  emissiveIntensity: number
  /** テクスチャアセット参照 */
  textureAssetId?: string | null
  wireframe: boolean
}

export type LightKind = 'directional' | 'point' | 'spot'

export interface LightComponent {
  type: 'light'
  lightType: LightKind
  color: string
  intensity: number
  castShadow: boolean
  /** point/spot */
  range: number
  /** spot: 度数法の全角 */
  spotAngle: number
  /** spot: 0..1 */
  penumbra: number
}

export interface CameraComponent {
  type: 'camera'
  projection: 'perspective' | 'orthographic'
  fov: number
  near: number
  far: number
  /** orthographic の半高 (Unity の Size) */
  orthoSize: number
}

export type Component = MeshComponent | MaterialComponent | LightComponent | CameraComponent
export type ComponentType = Component['type']

/* ---------------------------------- Node / Scene ---------------------------------- */

export interface SceneNode {
  id: NodeId
  name: string
  /** Unity の activeSelf 相当。Object3D.visible に結線 */
  visible: boolean
  parentId: NodeId | null
  childrenIds: NodeId[]
  transform: Transform
  components: Component[]
}

export interface SceneGraph {
  name: string
  nodes: Record<NodeId, SceneNode>
  rootIds: NodeId[]
}

/* ---------------------------------- Assets ---------------------------------- */

export type AssetType = 'glb' | 'texture'

/** ストアに置くメタデータ。バイナリ本体は engine/assetRegistry が保持 */
export interface AssetMeta {
  id: string
  name: string
  type: AssetType
  /** バイト数 (表示用) */
  size: number
}

/* ---------------------------------- Serialized scene ---------------------------------- */

export interface SerializedScene {
  version: 1
  type: 'unitythree-scene'
  name: string
  nodes: Record<NodeId, SceneNode>
  rootIds: NodeId[]
  /** アセットはbase64内蔵で単一ファイル完全往復 (D-011) */
  assets: Array<AssetMeta & { dataBase64: string }>
}

/* ---------------------------------- Helpers ---------------------------------- */

let idCounter = 0
export const newId = (): NodeId =>
  `${Date.now().toString(36)}-${(idCounter++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`

export const defaultMaterial = (): MaterialComponent => ({
  type: 'material',
  color: '#ffffff',
  metalness: 0,
  roughness: 0.5,
  opacity: 1,
  emissive: '#000000',
  emissiveIntensity: 1,
  textureAssetId: null,
  wireframe: false,
})

export const defaultMesh = (geometry: PrimitiveKind = 'box'): MeshComponent => ({
  type: 'mesh',
  geometry,
  assetId: null,
  castShadow: true,
  receiveShadow: true,
})

export const defaultLight = (lightType: LightKind = 'directional'): LightComponent => ({
  type: 'light',
  lightType,
  color: '#ffffff',
  intensity: lightType === 'directional' ? 1 : lightType === 'point' ? 10 : 30,
  castShadow: true,
  range: 10,
  spotAngle: 30,
  penumbra: 0.2,
})

export const defaultCamera = (): CameraComponent => ({
  type: 'camera',
  projection: 'perspective',
  fov: 60,
  near: 0.3,
  far: 1000,
  orthoSize: 5,
})

export function getComponent<T extends Component['type']>(
  node: SceneNode,
  type: T,
): Extract<Component, { type: T }> | undefined {
  return node.components.find((c) => c.type === type) as Extract<Component, { type: T }> | undefined
}

/** サブツリーのノードIDを親→子順で列挙 */
export function collectSubtreeIds(nodes: Record<NodeId, SceneNode>, rootId: NodeId): NodeId[] {
  const out: NodeId[] = []
  const walk = (id: NodeId) => {
    const n = nodes[id]
    if (!n) return
    out.push(id)
    n.childrenIds.forEach(walk)
  }
  walk(rootId)
  return out
}

/** id が ancestorId の子孫かどうか */
export function isDescendantOf(
  nodes: Record<NodeId, SceneNode>,
  id: NodeId,
  ancestorId: NodeId,
): boolean {
  let cur = nodes[id]?.parentId
  while (cur) {
    if (cur === ancestorId) return true
    cur = nodes[cur]?.parentId ?? null
  }
  return false
}
