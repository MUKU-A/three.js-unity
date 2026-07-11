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
  /** MeshRenderer.enabled 相当 (未定義=true)。falseで描画のみ消える (コライダーは生きる, D-036) */
  enabled?: boolean
  /** プリミティブ種別。assetId 指定時は無視される */
  geometry: PrimitiveKind
  /** GLB/FBX/OBJアセット参照 (Projectパネルからのインポート品) */
  assetId?: string | null
  /**
   * 再生時のアニメーション: undefined=全Clip同時 (旧互換) / null=再生しない / 名前=そのClipのみ。
   * スクリプトから ctx.animation.play(name) で切替可能 (D-028)
   */
  animationClip?: string | null
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
  /** Base Map (アルベド) テクスチャアセット参照 */
  textureAssetId?: string | null
  /** Normal Map アセット参照 */
  normalMapAssetId?: string | null
  /** UVタイリング/オフセット (Unityの Tiling / Offset) */
  tiling?: { x: number; y: number }
  offset?: { x: number; y: number }
  wireframe: boolean
}

export type LightKind = 'directional' | 'point' | 'spot'

export interface LightComponent {
  type: 'light'
  /** Unityのビヘイビアチェックボックス相当 (未定義=true) */
  enabled?: boolean
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
  /** Unityのビヘイビアチェックボックス相当 (未定義=true) */
  enabled?: boolean
  projection: 'perspective' | 'orthographic'
  fov: number
  near: number
  far: number
  /** orthographic の半高 (Unity の Size) */
  orthoSize: number
}

/* ---------------------------------- Script / Physics ---------------------------------- */

/**
 * MonoBehaviour相当のスクリプト (D-025)。
 * code 内で onStart(ctx) / onUpdate(ctx, dt) を定義し、const props = {...} で
 * Inspector に露出するプロパティを宣言する。再生モード中のみ実行される。
 */
export interface ScriptComponent {
  type: 'script'
  enabled?: boolean
  name: string
  code: string
  /** Inspector編集可能な公開プロパティ (codeの `const props` から抽出、値はここが正) */
  props: Record<string, number | string | boolean>
}

/** Rigidbody (Rapier結線, D-026)。isKinematic=trueで物理の影響を受けない移動体 */
export interface RigidbodyComponent {
  type: 'rigidbody'
  /** Unityの Collision Detection。高速移動体は 'continuous' (CCD) にしないとすり抜ける (D-036) */
  collisionDetection?: 'discrete' | 'continuous'
  mass: number
  useGravity: boolean
  isKinematic: boolean
  linearDamping: number
  angularDamping: number
}

/** Collider。rigidbodyなしのcolliderは静的衝突体 (Unity互換) */
export interface ColliderComponent {
  type: 'collider'
  shape: 'box' | 'sphere'
  /** box: 各辺サイズ / sphere: radius を使用 */
  size: Vec3
  radius: number
  /** ローカル中心オフセット */
  center: Vec3
  /** 反発係数 0..1 */
  bounciness: number
  friction: number
  /** Unityの Is Trigger: 衝突せず侵入イベントのみ発火 (onTriggerEnter/Exit) */
  isTrigger?: boolean
}

/**
 * AudioSource (D-032)。AudioListenerはUnityのデフォルト構成同様、
 * アクティブなGameカメラへ自動付帯するため専用コンポーネントは持たない。
 */
export interface AudioSourceComponent {
  type: 'audiosource'
  enabled?: boolean
  /** audio アセット参照 */
  assetId?: string | null
  /** 0..1 */
  volume: number
  loop: boolean
  playOnAwake: boolean
  /** true = 3D空間減衰 (PositionalAudio) / false = 2D */
  spatial: boolean
  /** spatial時: 減衰開始距離 / 最大距離 */
  minDistance: number
  maxDistance: number
}

export const defaultAudioSource = (): AudioSourceComponent => ({
  type: 'audiosource',
  enabled: true,
  assetId: null,
  volume: 1,
  loop: false,
  playOnAwake: true,
  spatial: true,
  minDistance: 1,
  maxDistance: 30,
})

/**
 * 物理ジョイント (D-033)。自身に rigidbody (または静的collider) が必要。
 * connectedNodeId=null はワールド空間への固定 (Unityの Connected Body: None 相当)。
 */
export interface JointComponent {
  type: 'joint'
  jointType: 'fixed' | 'hinge' | 'spring'
  connectedNodeId?: NodeId | null
  /** 自身ローカルのアンカー */
  anchor: Vec3
  /** 接続先ローカルのアンカー */
  connectedAnchor: Vec3
  /** hinge: 回転軸 (ローカル) */
  axis: Vec3
  /** spring */
  stiffness: number
  damping: number
  restLength: number
}

export const defaultJoint = (jointType: JointComponent['jointType'] = 'hinge'): JointComponent => ({
  type: 'joint',
  jointType,
  connectedNodeId: null,
  anchor: vec3(0, 0, 0),
  connectedAnchor: vec3(0, 0, 0),
  axis: vec3(0, 0, 1),
  stiffness: 100,
  damping: 5,
  restLength: 2,
})

/** スクリーンスペースのUIテキスト (UnityのCanvas+Text相当の最小実装)。Gameビューにオーバーレイ描画 */
export interface UITextComponent {
  type: 'uitext'
  enabled?: boolean
  text: string
  fontSize: number
  color: string
  anchorX: 'left' | 'center' | 'right'
  anchorY: 'top' | 'middle' | 'bottom'
  offsetX: number
  offsetY: number
}

export const defaultUIText = (text = 'New Text'): UITextComponent => ({
  type: 'uitext',
  enabled: true,
  text,
  fontSize: 18,
  color: '#ffffff',
  anchorX: 'left',
  anchorY: 'top',
  offsetX: 10,
  offsetY: 10,
})

export type Component =
  | MeshComponent
  | MaterialComponent
  | LightComponent
  | CameraComponent
  | ScriptComponent
  | RigidbodyComponent
  | ColliderComponent
  | AudioSourceComponent
  | JointComponent
  | UITextComponent
export type ComponentType = Component['type']

/* ---------------------------------- Node / Scene ---------------------------------- */

export interface SceneNode {
  id: NodeId
  name: string
  /** Unity の activeSelf 相当。Object3D.visible に結線 */
  visible: boolean
  /** Unity の Tag 相当 (自由入力)。スクリプトから other.tag / compareTag で参照 */
  tag?: string | null
  parentId: NodeId | null
  childrenIds: NodeId[]
  transform: Transform
  components: Component[]
  /** プレハブインスタンスのルートに付くアセット参照 (D-029)。Hierarchyで青表示 */
  prefabId?: string | null
  /**
   * プレハブテンプレート内での対応ノードID (D-034)。インスタンス配下の各ノードに付き、
   * 差分オーバーライドの3方向マージでノード対応を取るために使う。
   * 未設定 = ユーザーがインスタンスへ後から追加したノード。
   */
  prefabNodeId?: string | null
}

export interface SceneGraph {
  name: string
  nodes: Record<NodeId, SceneNode>
  rootIds: NodeId[]
}

/* ---------------------------------- Assets ---------------------------------- */

export type AssetType = 'glb' | 'texture' | 'fbx' | 'obj' | 'prefab' | 'audio'

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
  normalMapAssetId: null,
  tiling: { x: 1, y: 1 },
  offset: { x: 0, y: 0 },
  wireframe: false,
})

export const DEFAULT_SCRIPT_CODE = `// UnityのMonoBehaviour相当。使えるフック:
//   onAwake / onEnable / onStart / onUpdate / onFixedUpdate / onLateUpdate / onDisable / onDestroy
//   onCollisionEnter/Exit(ctx, other) / onTriggerEnter/Exit(ctx, other)
// ctx API: node.position|rotation|scale / node.tag / node.compareTag(t) / node.setActive(bool)
//          node.getComponent(型名) — rigidbodyは .addForce({x,y,z}) / .velocity も使える。
//          スクリプトのトップレベル関数は他スクリプトから呼べる:
//          ctx.findObjectOfType('GameManager').EndGame() (FindObjectOfType相当)
//          find(name) / instantiate(src, pos) / destroy(target?) / invoke(関数名, 秒) (Invoke相当)
//          restartScene() (LoadScene相当: シーンを初期状態から再開)
//          physics.raycast(origin, dir, maxDist) / startCoroutine(function*(){ yield 秒 })
//          animation.play(clipName, fade) / time.elapsed|delta / log(msg)
//          input.getKey|getKeyDown / input.getAxis('Horizontal'|'Vertical') (WASD+矢印)
// const props = {...} で宣言した値は Inspector から編集できます。
const props = {
  speed: 90,
}

function onStart(ctx) {
  ctx.log(ctx.node.name + ' started')
}

function onUpdate(ctx, dt) {
  // 例: Y軸回転 (度/秒)
  ctx.node.rotation.y += ctx.props.speed * dt
}
`

export const defaultScript = (name = 'NewBehaviour'): ScriptComponent => ({
  type: 'script',
  enabled: true,
  name,
  code: DEFAULT_SCRIPT_CODE,
  props: { speed: 90 },
})

export const defaultRigidbody = (): RigidbodyComponent => ({
  type: 'rigidbody',
  mass: 1,
  useGravity: true,
  isKinematic: false,
  linearDamping: 0,
  angularDamping: 0.05,
})

export const defaultCollider = (shape: 'box' | 'sphere' = 'box'): ColliderComponent => ({
  type: 'collider',
  shape,
  size: vec3(1, 1, 1),
  radius: 0.5,
  center: vec3(0, 0, 0),
  bounciness: 0,
  friction: 0.5,
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
  enabled: true,
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
  enabled: true,
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
