/**
 * SceneNode (ストアの正) → THREE.Object3D の生成・差分更新。
 * 各ノードは Group コンテナで表現し、mesh/light/camera はその子として実体化する。
 * コンテナの userData.nodeId でレイキャスト結果からノードを逆引きする。
 */
import * as THREE from 'three'
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type {
  CameraComponent,
  LightComponent,
  MaterialComponent,
  MeshComponent,
  PrimitiveKind,
  SceneNode,
} from '../types/scene'
import { getComponent } from '../types/scene'
import { getAsset } from './assets'

export const DEG2RAD = Math.PI / 180
export const RAD2DEG = 180 / Math.PI

/** コンテナが保持する部品への参照 */
export interface NodeParts {
  mesh?: THREE.Object3D
  light?: THREE.Light
  lightTarget?: THREE.Object3D
  camera?: THREE.Camera
  animations?: THREE.AnimationClip[]
}

export interface NodeContainer extends THREE.Group {
  userData: {
    nodeId: string
    parts: NodeParts
  }
}

/* ---------------------------------- Geometry ---------------------------------- */

export function buildGeometry(kind: PrimitiveKind): THREE.BufferGeometry {
  switch (kind) {
    case 'box':
      return new THREE.BoxGeometry(1, 1, 1)
    case 'sphere':
      return new THREE.SphereGeometry(0.5, 32, 16)
    case 'plane': {
      // Unity の Plane は 10x10 の水平面
      const g = new THREE.PlaneGeometry(10, 10)
      g.rotateX(-Math.PI / 2)
      return g
    }
    case 'quad':
      return new THREE.PlaneGeometry(1, 1)
    case 'cylinder':
      return new THREE.CylinderGeometry(0.5, 0.5, 2, 32)
    case 'capsule':
      return new THREE.CapsuleGeometry(0.5, 1, 8, 16)
    case 'cone':
      return new THREE.ConeGeometry(0.5, 1, 32)
    case 'torus':
      return new THREE.TorusGeometry(0.5, 0.2, 16, 48)
  }
}

/* ---------------------------------- Material ---------------------------------- */

/** Unity の Default-Material 相当 (material コンポーネント未付与のメッシュ用) */
export function makeDefaultMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: '#c0c0c0', metalness: 0, roughness: 0.5 })
  m.userData.editable = true
  return m
}

function applyMaterialProps(mat: THREE.MeshStandardMaterial, comp: MaterialComponent) {
  mat.color.set(comp.color)
  mat.metalness = comp.metalness
  mat.roughness = comp.roughness
  mat.opacity = comp.opacity
  mat.transparent = comp.opacity < 1
  mat.emissive.set(comp.emissive)
  mat.emissiveIntensity = comp.emissiveIntensity
  mat.wireframe = comp.wireframe
  mat.userData.baseWireframe = comp.wireframe // Sceneビューのワイヤーフレーム表示と区別するための基底値
  const tex = getAsset(comp.textureAssetId)?.texture ?? null
  if (mat.map !== tex) {
    mat.map = tex
    mat.needsUpdate = true
  }
}

/* ---------------------------------- Mesh part ---------------------------------- */

function buildMeshPart(comp: MeshComponent): THREE.Object3D {
  if (comp.assetId) {
    const asset = getAsset(comp.assetId)
    if (asset?.gltf) {
      const inst = skeletonClone(asset.gltf.scene)
      inst.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = comp.castShadow
          o.receiveShadow = comp.receiveShadow
        }
      })
      return inst
    }
    // アセット未ロード → プレースホルダ
    const placeholder = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: '#aa4444', wireframe: true }),
    )
    return placeholder
  }
  const mesh = new THREE.Mesh(buildGeometry(comp.geometry), makeDefaultMaterial())
  mesh.castShadow = comp.castShadow
  mesh.receiveShadow = comp.receiveShadow
  return mesh
}

/** mesh部品の構造キー: これが変わったら作り直し */
const meshKey = (c: MeshComponent) => `${c.assetId ?? ''}|${c.geometry}`

/* ---------------------------------- Light part ---------------------------------- */

function buildLightPart(comp: LightComponent): { light: THREE.Light; target?: THREE.Object3D } {
  let light: THREE.Light
  let target: THREE.Object3D | undefined
  switch (comp.lightType) {
    case 'directional': {
      const l = new THREE.DirectionalLight(comp.color, comp.intensity)
      l.shadow.mapSize.set(2048, 2048)
      l.shadow.camera.left = -20
      l.shadow.camera.right = 20
      l.shadow.camera.top = 20
      l.shadow.camera.bottom = -20
      l.shadow.camera.far = 100
      l.shadow.bias = -0.0005
      target = l.target
      light = l
      break
    }
    case 'point': {
      const l = new THREE.PointLight(comp.color, comp.intensity, comp.range)
      l.shadow.bias = -0.0005
      light = l
      break
    }
    case 'spot': {
      const l = new THREE.SpotLight(comp.color, comp.intensity, comp.range)
      l.angle = (comp.spotAngle / 2) * DEG2RAD // Unity は全角、three は半角
      l.penumbra = comp.penumbra
      l.shadow.bias = -0.0005
      target = l.target
      light = l
      break
    }
  }
  light.castShadow = comp.castShadow
  // Unity の forward(+Z) 方向を照射方向にする: target をコンテナローカル (0,0,1) に置く
  if (target) target.position.set(0, 0, 1)
  return { light, target }
}

function applyLightProps(light: THREE.Light, comp: LightComponent) {
  light.visible = comp.enabled !== false
  light.color.set(comp.color)
  light.intensity = comp.intensity
  light.castShadow = comp.castShadow
  if (comp.lightType === 'point') {
    ;(light as THREE.PointLight).distance = comp.range
  } else if (comp.lightType === 'spot') {
    const sl = light as THREE.SpotLight
    sl.distance = comp.range
    sl.angle = (comp.spotAngle / 2) * DEG2RAD
    sl.penumbra = comp.penumbra
  }
}

/* ---------------------------------- Camera part ---------------------------------- */

function buildCameraPart(comp: CameraComponent): THREE.Camera {
  let cam: THREE.Camera
  if (comp.projection === 'perspective') {
    cam = new THREE.PerspectiveCamera(comp.fov, 16 / 9, comp.near, comp.far)
  } else {
    const s = comp.orthoSize
    const aspect = 16 / 9
    cam = new THREE.OrthographicCamera(-s * aspect, s * aspect, s, -s, comp.near, comp.far)
  }
  // Unity のカメラは +Z を向く。three は -Z なので 180° 回す
  cam.rotation.y = Math.PI
  return cam
}

function applyCameraProps(cam: THREE.Camera, comp: CameraComponent) {
  if (comp.projection === 'perspective' && (cam as THREE.PerspectiveCamera).isPerspectiveCamera) {
    const c = cam as THREE.PerspectiveCamera
    c.fov = comp.fov
    c.near = comp.near
    c.far = comp.far
    c.updateProjectionMatrix()
  } else if (comp.projection === 'orthographic' && (cam as THREE.OrthographicCamera).isOrthographicCamera) {
    const c = cam as THREE.OrthographicCamera
    const s = comp.orthoSize
    const aspect = 16 / 9
    c.left = -s * aspect
    c.right = s * aspect
    c.top = s
    c.bottom = -s
    c.near = comp.near
    c.far = comp.far
    c.updateProjectionMatrix()
  }
}

const cameraKey = (c: CameraComponent) => c.projection

/* ---------------------------------- Container ---------------------------------- */

export function createContainer(node: SceneNode): NodeContainer {
  const group = new THREE.Group() as NodeContainer
  group.userData = { nodeId: node.id, parts: {} }
  group.rotation.order = 'YXZ' // Unity のオイラー適用順
  updateContainer(group, node, null)
  return group
}

/** node の変更をコンテナに反映。prev=null なら全構築 */
export function updateContainer(container: NodeContainer, node: SceneNode, prev: SceneNode | null) {
  const parts = container.userData.parts

  /* transform */
  if (!prev || prev.transform !== node.transform) {
    const t = node.transform
    container.position.set(t.position.x, t.position.y, t.position.z)
    container.rotation.set(t.rotation.x * DEG2RAD, t.rotation.y * DEG2RAD, t.rotation.z * DEG2RAD, 'YXZ')
    container.scale.set(t.scale.x, t.scale.y, t.scale.z)
  }
  if (!prev || prev.visible !== node.visible) container.visible = node.visible
  if (!prev || prev.name !== node.name) container.name = node.name

  if (prev && prev.components === node.components) return

  const meshComp = getComponent(node, 'mesh')
  const prevMeshComp = prev ? getComponent(prev, 'mesh') : undefined
  const matComp = getComponent(node, 'material')
  const lightComp = getComponent(node, 'light')
  const prevLightComp = prev ? getComponent(prev, 'light') : undefined
  const camComp = getComponent(node, 'camera')
  const prevCamComp = prev ? getComponent(prev, 'camera') : undefined

  /* --- mesh --- */
  if (!meshComp && parts.mesh) {
    disposeObject(parts.mesh)
    container.remove(parts.mesh)
    parts.mesh = undefined
    parts.animations = undefined
  } else if (meshComp) {
    const needRebuild = !parts.mesh || !prevMeshComp || meshKey(prevMeshComp) !== meshKey(meshComp)
    if (needRebuild) {
      if (parts.mesh) {
        disposeObject(parts.mesh)
        container.remove(parts.mesh)
      }
      parts.mesh = buildMeshPart(meshComp)
      parts.animations = meshComp.assetId ? (getAsset(meshComp.assetId)?.gltf?.animations ?? []) : undefined
      container.add(parts.mesh)
    } else if (parts.mesh) {
      parts.mesh.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = meshComp.castShadow
          o.receiveShadow = meshComp.receiveShadow
        }
      })
    }
    /* material を mesh 部品(GLBなら全メッシュ)に適用 */
    if (parts.mesh) {
      if (matComp) {
        parts.mesh.traverse((o) => {
          const m = o as THREE.Mesh
          if (m.isMesh) {
            let mat = m.material as THREE.MeshStandardMaterial
            if (!mat.isMeshStandardMaterial || !mat.userData.editable) {
              // GLB由来の共有マテリアルは編集用に複製してから適用
              const std = new THREE.MeshStandardMaterial()
              if (mat.isMeshStandardMaterial) std.copy(mat)
              std.userData.editable = true
              m.material = std
              mat = std
            }
            applyMaterialProps(mat, matComp)
          }
        })
      }
    }
  }

  /* --- light --- */
  if (!lightComp && parts.light) {
    if (parts.lightTarget) container.remove(parts.lightTarget)
    container.remove(parts.light)
    parts.light.dispose()
    parts.light = undefined
    parts.lightTarget = undefined
  } else if (lightComp) {
    const needRebuild = !parts.light || !prevLightComp || prevLightComp.lightType !== lightComp.lightType
    if (needRebuild) {
      if (parts.light) {
        if (parts.lightTarget) container.remove(parts.lightTarget)
        container.remove(parts.light)
        parts.light.dispose()
      }
      const { light, target } = buildLightPart(lightComp)
      parts.light = light
      parts.lightTarget = target
      container.add(light)
      if (target) container.add(target)
      applyLightProps(light, lightComp)
    } else if (parts.light) {
      applyLightProps(parts.light, lightComp)
    }
  }

  /* --- camera --- */
  if (!camComp && parts.camera) {
    container.remove(parts.camera)
    parts.camera = undefined
  } else if (camComp) {
    const needRebuild = !parts.camera || !prevCamComp || cameraKey(prevCamComp) !== cameraKey(camComp)
    if (needRebuild) {
      if (parts.camera) container.remove(parts.camera)
      parts.camera = buildCameraPart(camComp)
      container.add(parts.camera)
    }
    applyCameraProps(parts.camera!, camComp)
  }
}

export function disposeObject(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh) {
      m.geometry?.dispose()
      const mats = Array.isArray(m.material) ? m.material : [m.material]
      // テクスチャは assetRegistry 管理なのでマテリアルのみ破棄
      mats.forEach((mat) => mat?.dispose())
    }
  })
}
