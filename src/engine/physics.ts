/**
 * 物理演算 (Rapier, D-026)。再生モード中のみワールドを構築してステップする。
 * - rigidbody あり: dynamic (isKinematic なら kinematicPositionBased)
 * - collider のみ: fixed (Unityの「Rigidbodyなしコライダー=静的」互換)
 * 変換の書き戻しはエンジン側でワールド→ローカル変換してストア transient へ (SSoT維持)。
 */
import * as THREE from 'three'
import type RAPIER_NS from '@dimforge/rapier3d-compat'
import type { NodeId, SceneNode } from '../types/scene'
import { getComponent } from '../types/scene'

let RAPIER: typeof RAPIER_NS | null = null
let initPromise: Promise<void> | null = null

/** WASM初期化 (初回のPlayで遅延ロード) */
export function ensureRapier(): Promise<void> {
  if (!initPromise) {
    initPromise = import('@dimforge/rapier3d-compat').then(async (mod) => {
      const R = (mod.default ?? mod) as typeof RAPIER_NS
      await R.init()
      RAPIER = R
    })
  }
  return initPromise
}

/** WASM初期化済みか */
export const isRapierReady = () => RAPIER !== null

interface BodyEntry {
  nodeId: NodeId
  body: RAPIER_NS.RigidBody
  kinematic: boolean
  dynamic: boolean
}

export class PhysicsWorld {
  private world: RAPIER_NS.World | null = null
  private entries: BodyEntry[] = []

  get active(): boolean {
    return this.world !== null
  }

  /** シーンから物理ボディを構築 */
  start(nodes: Record<NodeId, SceneNode>, objectFor: (id: NodeId) => THREE.Object3D | undefined, log: (level: 'info' | 'warn', msg: string) => void) {
    if (!RAPIER) return
    this.dispose()
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })

    const pos = new THREE.Vector3()
    const quat = new THREE.Quaternion()
    const scl = new THREE.Vector3()

    let count = 0
    for (const id in nodes) {
      const node = nodes[id]
      const rb = getComponent(node, 'rigidbody')
      const col = getComponent(node, 'collider')
      if (!rb && !col) continue
      if (!isChainVisible(nodes, id)) continue
      const obj = objectFor(id)
      if (!obj) continue

      obj.updateWorldMatrix(true, false)
      obj.matrixWorld.decompose(pos, quat, scl)

      let desc: RAPIER_NS.RigidBodyDesc
      if (!rb) {
        desc = RAPIER.RigidBodyDesc.fixed()
      } else if (rb.isKinematic) {
        desc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      } else {
        desc = RAPIER.RigidBodyDesc.dynamic()
          .setLinearDamping(rb.linearDamping)
          .setAngularDamping(rb.angularDamping)
          .setGravityScale(rb.useGravity ? 1 : 0)
      }
      desc.setTranslation(pos.x, pos.y, pos.z).setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
      const body = this.world.createRigidBody(desc)

      if (col) {
        let shape: RAPIER_NS.ColliderDesc
        if (col.shape === 'sphere') {
          const r = col.radius * Math.max(Math.abs(scl.x), Math.abs(scl.y), Math.abs(scl.z))
          shape = RAPIER.ColliderDesc.ball(Math.max(0.001, r))
        } else {
          shape = RAPIER.ColliderDesc.cuboid(
            Math.max(0.001, (col.size.x * Math.abs(scl.x)) / 2),
            Math.max(0.001, (col.size.y * Math.abs(scl.y)) / 2),
            Math.max(0.001, (col.size.z * Math.abs(scl.z)) / 2),
          )
        }
        shape
          .setTranslation(col.center.x * scl.x, col.center.y * scl.y, col.center.z * scl.z)
          .setRestitution(col.bounciness)
          .setFriction(col.friction)
        if (rb && !rb.isKinematic) shape.setMass(Math.max(0.001, rb.mass))
        this.world.createCollider(shape, body)
      } else if (rb && !rb.isKinematic) {
        body.setAdditionalMass(Math.max(0.001, rb.mass), true)
        log('warn', `'${node.name}' has a Rigidbody but no Collider — it will fall through objects`)
      }

      this.entries.push({ nodeId: id, body, kinematic: !!rb?.isKinematic, dynamic: !!rb && !rb.isKinematic })
      count++
    }
    if (count > 0) log('info', `Physics world started — ${count} bod${count === 1 ? 'y' : 'ies'}`)
  }

  /**
   * 1ステップ進める。
   * kinematic はノードの現在ワールド変換を反映し、dynamic はシミュレーション結果を sync へ渡す。
   */
  step(
    dt: number,
    objectFor: (id: NodeId) => THREE.Object3D | undefined,
    sync: (id: NodeId, worldPos: THREE.Vector3, worldQuat: THREE.Quaternion) => void,
  ) {
    if (!this.world) return
    const pos = new THREE.Vector3()
    const quat = new THREE.Quaternion()
    const scl = new THREE.Vector3()

    for (const e of this.entries) {
      if (!e.kinematic) continue
      const obj = objectFor(e.nodeId)
      if (!obj) continue
      obj.updateWorldMatrix(true, false)
      obj.matrixWorld.decompose(pos, quat, scl)
      e.body.setNextKinematicTranslation({ x: pos.x, y: pos.y, z: pos.z })
      e.body.setNextKinematicRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
    }

    this.world.timestep = Math.min(0.05, Math.max(0.001, dt))
    this.world.step()

    for (const e of this.entries) {
      if (!e.dynamic || e.body.isSleeping()) continue
      const t = e.body.translation()
      const r = e.body.rotation()
      sync(e.nodeId, pos.set(t.x, t.y, t.z), quat.set(r.x, r.y, r.z, r.w))
    }
  }

  dispose() {
    this.world?.free()
    this.world = null
    this.entries = []
  }
}

function isChainVisible(nodes: Record<NodeId, SceneNode>, id: NodeId): boolean {
  let cur: SceneNode | undefined = nodes[id]
  while (cur) {
    if (!cur.visible) return false
    cur = cur.parentId ? nodes[cur.parentId] : undefined
  }
  return true
}
