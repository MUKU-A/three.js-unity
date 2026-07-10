/**
 * 物理演算 (Rapier, D-026/D-028)。再生モード中のみワールドを構築してステップする。
 * - rigidbody あり: dynamic (isKinematic なら kinematicPositionBased)
 * - collider のみ: fixed (Unityの「Rigidbodyなしコライダー=静的」互換)
 * - isTrigger: センサー化し、onTriggerEnter/Exit イベントとして通知
 * - 衝突イベント / raycast / 動的ボディ追加・削除 (Instantiate/Destroy) をスクリプトへ提供
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

export interface CollisionEvent {
  a: NodeId
  b: NodeId
  started: boolean
  /** どちらかがトリガー(センサー)の場合 true → onTrigger 系として配送 */
  trigger: boolean
}

export interface RaycastHit {
  nodeId: NodeId
  distance: number
  point: { x: number; y: number; z: number }
}

interface BodyEntry {
  nodeId: NodeId
  body: RAPIER_NS.RigidBody
  kinematic: boolean
  dynamic: boolean
}

export class PhysicsWorld {
  private world: RAPIER_NS.World | null = null
  private entries = new Map<NodeId, BodyEntry>()
  private colliderToNode = new Map<number, NodeId>()
  private sensorHandles = new Set<number>()
  private eventQueue: RAPIER_NS.EventQueue | null = null

  get active(): boolean {
    return this.world !== null
  }

  /** シーンから物理ボディを構築 */
  start(
    nodes: Record<NodeId, SceneNode>,
    objectFor: (id: NodeId) => THREE.Object3D | undefined,
    log: (level: 'info' | 'warn', msg: string) => void,
  ) {
    if (!RAPIER) return
    this.dispose()
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
    this.eventQueue = new RAPIER.EventQueue(true)

    let count = 0
    for (const id in nodes) {
      if (!isChainVisible(nodes, id)) continue
      if (this.addNode(nodes[id], objectFor(nodes[id].id), log)) count++
    }
    /* 全ボディ生成後にジョイントを張る (D-033) */
    let joints = 0
    for (const id in nodes) {
      if (!this.entries.has(id)) continue
      const jc = getComponent(nodes[id], 'joint')
      if (jc && this.createJoint(nodes[id], jc, objectFor, log)) joints++
    }
    if (count > 0)
      log('info', `Physics world started — ${count} bod${count === 1 ? 'y' : 'ies'}${joints > 0 ? `, ${joints} joint(s)` : ''}`)
  }

  /** ジョイント生成。connectedNodeId=null はワールドへ固定 */
  private createJoint(
    node: SceneNode,
    jc: import('../types/scene').JointComponent,
    objectFor: (id: NodeId) => THREE.Object3D | undefined,
    log: (level: 'info' | 'warn', msg: string) => void,
  ): boolean {
    if (!RAPIER || !this.world) return false
    const selfEntry = this.entries.get(node.id)
    if (!selfEntry) return false

    const selfScale = objectFor(node.id)?.getWorldScale(new THREE.Vector3()) ?? new THREE.Vector3(1, 1, 1)
    const a1 = { x: jc.anchor.x * selfScale.x, y: jc.anchor.y * selfScale.y, z: jc.anchor.z * selfScale.z }

    let otherBody: RAPIER_NS.RigidBody
    let a2 = { x: jc.connectedAnchor.x, y: jc.connectedAnchor.y, z: jc.connectedAnchor.z }
    if (jc.connectedNodeId && this.entries.has(jc.connectedNodeId)) {
      const otherScale = objectFor(jc.connectedNodeId)?.getWorldScale(new THREE.Vector3()) ?? new THREE.Vector3(1, 1, 1)
      otherBody = this.entries.get(jc.connectedNodeId)!.body
      a2 = { x: a2.x * otherScale.x, y: a2.y * otherScale.y, z: a2.z * otherScale.z }
    } else {
      if (jc.connectedNodeId) {
        log('warn', `'${node.name}' joint: connected body has no Rigidbody/Collider — anchoring to world`)
      }
      /* ワールド固定: 自身のアンカーの現在ワールド位置に固定ボディを置く */
      const t = selfEntry.body.translation()
      const r = selfEntry.body.rotation()
      const world = new THREE.Vector3(a1.x, a1.y, a1.z)
        .applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w))
        .add(new THREE.Vector3(t.x, t.y, t.z))
      otherBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(world.x, world.y, world.z))
      a2 = { x: 0, y: 0, z: 0 }
    }

    const IDENT = { w: 1, x: 0, y: 0, z: 0 }
    let data: RAPIER_NS.JointData
    if (jc.jointType === 'fixed') {
      data = RAPIER.JointData.fixed(a1, IDENT, a2, IDENT)
    } else if (jc.jointType === 'spring') {
      data = RAPIER.JointData.spring(Math.max(0, jc.restLength), Math.max(0, jc.stiffness), Math.max(0, jc.damping), a1, a2)
    } else {
      const len = Math.hypot(jc.axis.x, jc.axis.y, jc.axis.z) || 1
      const axis = { x: jc.axis.x / len, y: jc.axis.y / len, z: jc.axis.z / len }
      data = RAPIER.JointData.revolute(a1, a2, axis)
    }
    this.world.createImpulseJoint(data, selfEntry.body, otherBody, true)
    return true
  }

  /** 1ノード分のボディを構築 (再生中の Instantiate でも使用) */
  addNode(
    node: SceneNode,
    obj: THREE.Object3D | undefined,
    log: (level: 'info' | 'warn', msg: string) => void,
  ): boolean {
    if (!RAPIER || !this.world || !obj) return false
    const rb = getComponent(node, 'rigidbody')
    const col = getComponent(node, 'collider')
    if (!rb && !col) return false
    if (this.entries.has(node.id)) return false

    const pos = new THREE.Vector3()
    const quat = new THREE.Quaternion()
    const scl = new THREE.Vector3()
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
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
      if (col.isTrigger) shape.setSensor(true)
      if (rb && !rb.isKinematic) shape.setMass(Math.max(0.001, rb.mass))
      const collider = this.world.createCollider(shape, body)
      this.colliderToNode.set(collider.handle, node.id)
      if (col.isTrigger) this.sensorHandles.add(collider.handle)
    } else if (rb && !rb.isKinematic) {
      body.setAdditionalMass(Math.max(0.001, rb.mass), true)
      log('warn', `'${node.name}' has a Rigidbody but no Collider — it will fall through objects`)
    }

    this.entries.set(node.id, { nodeId: node.id, body, kinematic: !!rb?.isKinematic, dynamic: !!rb && !rb.isKinematic })
    return true
  }

  /** ランタイム破棄 (Destroy) 時のボディ除去 */
  removeNode(id: NodeId) {
    const e = this.entries.get(id)
    if (!e || !this.world) return
    for (const [handle, nodeId] of this.colliderToNode) {
      if (nodeId === id) {
        this.colliderToNode.delete(handle)
        this.sensorHandles.delete(handle)
      }
    }
    this.world.removeRigidBody(e.body)
    this.entries.delete(id)
  }

  /**
   * 固定タイムステップで1ステップ進め、衝突イベントを返す。
   * kinematic はノードの現在ワールド変換を反映し、dynamic はシミュレーション結果を sync へ渡す。
   */
  step(
    fixedDt: number,
    objectFor: (id: NodeId) => THREE.Object3D | undefined,
    sync: (id: NodeId, worldPos: THREE.Vector3, worldQuat: THREE.Quaternion) => void,
  ): CollisionEvent[] {
    if (!this.world || !this.eventQueue) return []
    const pos = new THREE.Vector3()
    const quat = new THREE.Quaternion()
    const scl = new THREE.Vector3()

    for (const e of this.entries.values()) {
      if (!e.kinematic) continue
      const obj = objectFor(e.nodeId)
      if (!obj) continue
      obj.updateWorldMatrix(true, false)
      obj.matrixWorld.decompose(pos, quat, scl)
      e.body.setNextKinematicTranslation({ x: pos.x, y: pos.y, z: pos.z })
      e.body.setNextKinematicRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
    }

    this.world.timestep = fixedDt
    this.world.step(this.eventQueue)

    const events: CollisionEvent[] = []
    this.eventQueue.drainCollisionEvents((h1, h2, started) => {
      const a = this.colliderToNode.get(h1)
      const b = this.colliderToNode.get(h2)
      if (!a || !b) return
      events.push({ a, b, started, trigger: this.sensorHandles.has(h1) || this.sensorHandles.has(h2) })
    })

    for (const e of this.entries.values()) {
      if (!e.dynamic || e.body.isSleeping()) continue
      const t = e.body.translation()
      const r = e.body.rotation()
      sync(e.nodeId, pos.set(t.x, t.y, t.z), quat.set(r.x, r.y, r.z, r.w))
    }
    return events
  }

  /** スクリプト向け物理レイキャスト (ctx.physics.raycast) */
  raycast(
    origin: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
    maxDistance = 1000,
  ): RaycastHit | null {
    if (!RAPIER || !this.world) return null
    const len = Math.hypot(dir.x, dir.y, dir.z)
    if (len < 1e-9) return null
    const nd = { x: dir.x / len, y: dir.y / len, z: dir.z / len }
    const ray = new RAPIER.Ray(origin, nd)
    const hit = this.world.castRay(ray, maxDistance, true)
    if (!hit) return null
    const nodeId = this.colliderToNode.get(hit.collider.handle)
    if (!nodeId) return null
    const p = ray.pointAt(hit.timeOfImpact)
    return { nodeId, distance: hit.timeOfImpact, point: { x: p.x, y: p.y, z: p.z } }
  }

  dispose() {
    this.world?.free()
    this.world = null
    this.eventQueue = null
    this.entries.clear()
    this.colliderToNode.clear()
    this.sensorHandles.clear()
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
