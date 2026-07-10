/**
 * スクリプトランタイム (MonoBehaviour相当, D-025/D-028)。
 * ライフサイクル: onStart / onUpdate / onFixedUpdate / onLateUpdate / onDestroy /
 *                 onCollisionEnter・Exit / onTriggerEnter・Exit
 * ctx API: node / props / time / input / find / log /
 *          instantiate / destroy / physics.raycast / startCoroutine / animation
 *
 * Transformへの書き込みはストアの transient 経由 (SSoT一方向フロー維持)。
 * 再生中の変更 (動的生成含む) は停止時にスナップショットから完全復元される (D-006)。
 */
import type { NodeId, ScriptComponent, Transform, Vec3 } from '../types/scene'
import { isDescendantOf } from '../types/scene'
import { useEditorStore } from '../store/editorStore'
import type { RaycastHit } from './physics'

/* ---------------------------------- 公開API (ctx) ---------------------------------- */

export interface VecProxy {
  x: number
  y: number
  z: number
  set(x: number, y: number, z: number): void
}

/** コンポーネントへの読み書きプロキシ (GetComponent相当)。プロパティは live に SSoT を読む */
export type ComponentProxy = Record<string, unknown> & { readonly type: string }

export interface NodeProxy {
  readonly id: NodeId
  readonly name: string
  position: VecProxy
  rotation: VecProxy
  scale: VecProxy
  visible: boolean
  /** UnityのGetComponent: 'material' | 'light' | 'rigidbody' | 'script' 等。scriptは名前でも探せる */
  getComponent(type: string): ComponentProxy | null
  /** Unityの transform.SetParent (nullでルートへ)。再生中のみ有効・停止で復元 */
  setParent(parent: NodeProxy | null): void
  /** ワールド座標 (読み取り専用) */
  readonly worldPosition: { x: number; y: number; z: number }
}

/** エンジンがランタイムへ提供する機能 (物理・動的生成・アニメーション・カメラ) */
export interface EngineBridge {
  raycast(origin: Vec3, dir: Vec3, maxDistance?: number): RaycastHit | null
  /** サブツリー複製を動的生成し、新ルートIDを返す */
  instantiateNode(sourceId: NodeId, position?: Vec3): NodeId | null
  destroyNode(id: NodeId): void
  playAnimation(nodeId: NodeId, clipName: string | null, fadeSeconds: number): void
  /** Gameビュー座標 (左下原点px) からゲームカメラのレイを得る (Camera.ScreenPointToRay相当) */
  screenPointToRay(x: number, y: number): { origin: Vec3; direction: Vec3 } | null
  getWorldPosition(id: NodeId): Vec3
  /** ワンショット音声 (アセット名 or ID)。nodeId 指定でその位置から3D再生 */
  playSound(assetRef: string, volume: number, nodeId: NodeId | null): void
}

export interface GameInput {
  getKey(key: string): boolean
  getKeyDown(key: string): boolean
  /** 0=左 1=中 2=右 (Unity互換) */
  getMouseButton(button: number): boolean
  getMouseButtonDown(button: number): boolean
  /** Gameビュー内のマウス座標 (左下原点px, Unity互換)。ビュー外は最後の値 */
  readonly mousePosition: { x: number; y: number }
}

export interface ScriptCtx {
  node: NodeProxy
  props: Record<string, number | string | boolean>
  time: { elapsed: number; delta: number }
  input: GameInput
  /** Camera.ScreenPointToRay 相当。input.mousePosition と組み合わせてクリック判定に使う */
  screenPointToRay(x: number, y: number): { origin: Vec3; direction: Vec3 } | null
  find(name: string): NodeProxy | null
  log(message: unknown): void
  /** Unityの Instantiate: 既存ノード(名前 or proxy)を複製して配置。返り値は新ノードのproxy */
  instantiate(source: NodeProxy | string, position?: { x: number; y: number; z: number }): NodeProxy | null
  /** Unityの Destroy: ノードをシーンから除去 (onDestroy が呼ばれる) */
  destroy(target?: NodeProxy | string): void
  physics: {
    raycast(
      origin: { x: number; y: number; z: number },
      dir: { x: number; y: number; z: number },
      maxDistance?: number,
    ): { node: NodeProxy; distance: number; point: { x: number; y: number; z: number } } | null
  }
  /** コルーチン: function* を渡し、yield 秒数 で待機 (yield 0.5 → 0.5秒待つ) */
  startCoroutine(gen: Generator | (() => Generator)): void
  animation: {
    /** GLBのAnimationClipを切替 (crossfade)。null で停止 */
    play(clipName: string | null, fadeSeconds?: number): void
  }
  /** AudioSource.PlayOneShot相当: 自ノード位置から3Dワンショット再生 (アセット名でも可) */
  playSound(assetNameOrId: string, volume?: number): void
}

/* ---------------------------------- Node/Vec プロキシ ---------------------------------- */

const st = () => useEditorStore.getState()

function makeVecProxy(id: NodeId, key: keyof Transform): VecProxy {
  const read = (axis: keyof Vec3) => st().scene.nodes[id]?.transform[key][axis] ?? 0
  const write = (axis: keyof Vec3, v: number) => {
    const t = st().scene.nodes[id]?.transform
    if (!t || !Number.isFinite(v)) return
    st().transientSetTransform(id, { ...t, [key]: { ...t[key], [axis]: v } })
  }
  return {
    get x() {
      return read('x')
    },
    set x(v: number) {
      write('x', v)
    },
    get y() {
      return read('y')
    },
    set y(v: number) {
      write('y', v)
    },
    get z() {
      return read('z')
    },
    set z(v: number) {
      write('z', v)
    },
    set(x: number, y: number, z: number) {
      const t = st().scene.nodes[id]?.transform
      if (!t) return
      st().transientSetTransform(id, { ...t, [key]: { x, y, z } })
    },
  }
}

/** コンポーネントの live 読み書きプロキシ (書き込みは transientPatchComponent 経由) */
function makeComponentProxy(id: NodeId, componentIndex: number): ComponentProxy {
  return new Proxy(
    {},
    {
      get(_t, key: string) {
        const c = st().scene.nodes[id]?.components[componentIndex] as unknown as Record<string, unknown> | undefined
        return c?.[key]
      },
      set(_t, key: string, value: unknown) {
        const c = st().scene.nodes[id]?.components[componentIndex]
        if (!c || key === 'type') return false
        st().transientPatchComponent(id, componentIndex, { [key]: value } as never)
        return true
      },
      has(_t, key: string) {
        const c = st().scene.nodes[id]?.components[componentIndex] as unknown as Record<string, unknown> | undefined
        return !!c && key in c
      },
    },
  ) as ComponentProxy
}

export function makeNodeProxy(id: NodeId, bridge?: EngineBridge): NodeProxy {
  return {
    id,
    get name() {
      return st().scene.nodes[id]?.name ?? ''
    },
    position: makeVecProxy(id, 'position'),
    rotation: makeVecProxy(id, 'rotation'),
    scale: makeVecProxy(id, 'scale'),
    get visible() {
      return st().scene.nodes[id]?.visible ?? false
    },
    set visible(v: boolean) {
      if (st().scene.nodes[id]) st().transientPatchNode(id, { visible: v })
    },
    getComponent(type: string) {
      const node = st().scene.nodes[id]
      if (!node) return null
      /* type一致、またはスクリプト名一致 (GetComponent<MyScript>() 相当) */
      const idx = node.components.findIndex(
        (c) => c.type === type || (c.type === 'script' && (c as { name?: string }).name === type),
      )
      return idx >= 0 ? makeComponentProxy(id, idx) : null
    },
    setParent(parent: NodeProxy | null) {
      const g = st().scene
      if (!g.nodes[id]) return
      const pid = parent ? parent.id : null
      if (pid && !g.nodes[pid]) return
      if (pid && isDescendantOf(g.nodes, pid, id)) return // 自分の子孫には付けられない
      st().transientReparent(id, pid)
    },
    get worldPosition() {
      return bridge ? bridge.getWorldPosition(id) : (st().scene.nodes[id]?.transform.position ?? { x: 0, y: 0, z: 0 })
    },
  }
}

/* ---------------------------------- コンパイル ---------------------------------- */

type Hook<A extends unknown[]> = ((...args: A) => void) | null

export interface CompiledScript {
  onAwake: Hook<[ScriptCtx]>
  onEnable: Hook<[ScriptCtx]>
  onStart: Hook<[ScriptCtx]>
  onUpdate: Hook<[ScriptCtx, number]>
  onFixedUpdate: Hook<[ScriptCtx, number]>
  onLateUpdate: Hook<[ScriptCtx, number]>
  onDisable: Hook<[ScriptCtx]>
  onDestroy: Hook<[ScriptCtx]>
  onCollisionEnter: Hook<[ScriptCtx, NodeProxy]>
  onCollisionExit: Hook<[ScriptCtx, NodeProxy]>
  onTriggerEnter: Hook<[ScriptCtx, NodeProxy]>
  onTriggerExit: Hook<[ScriptCtx, NodeProxy]>
  props: Record<string, number | string | boolean> | null
}

const HOOK_NAMES = [
  'onAwake',
  'onEnable',
  'onStart',
  'onUpdate',
  'onFixedUpdate',
  'onLateUpdate',
  'onDisable',
  'onDestroy',
  'onCollisionEnter',
  'onCollisionExit',
  'onTriggerEnter',
  'onTriggerExit',
] as const

/** ユーザーコードを評価して hooks と props 宣言を取り出す。失敗時は Error を投げる */
export function compileScript(code: string): CompiledScript {
  const ret = HOOK_NAMES.map((h) => `${h}: typeof ${h} === 'function' ? ${h} : null`).join(',\n  ')
  const factory = new Function(`"use strict";\n${code}\n;return {\n  ${ret},\n  props: typeof props !== 'undefined' ? props : null,\n};`)
  return factory() as CompiledScript
}

/** コードから props 宣言だけ安全に抽出 (エディタ保存時のリフレクション用) */
export function extractProps(code: string): Record<string, number | string | boolean> {
  try {
    const p = compileScript(code).props
    if (!p || typeof p !== 'object') return {}
    const out: Record<string, number | string | boolean> = {}
    for (const [k, v] of Object.entries(p)) {
      if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

/* ---------------------------------- ランタイム ---------------------------------- */

interface ScriptInstance {
  nodeId: NodeId
  componentIndex: number
  scriptName: string
  hooks: CompiledScript
  ctx: ScriptCtx
  dead: boolean
}

interface Coroutine {
  gen: Generator
  wait: number
  scriptName: string
}

export class ScriptRuntime {
  private instances: ScriptInstance[] = []
  private coroutines: Coroutine[] = []
  private elapsed = 0
  private input: GameInput
  private bridge: EngineBridge
  private proxyCache = new Map<NodeId, NodeProxy>()

  constructor(input: GameInput, bridge: EngineBridge) {
    this.input = input
    this.bridge = bridge
  }

  get running(): boolean {
    return this.instances.length > 0
  }

  private proxyFor(id: NodeId): NodeProxy {
    let p = this.proxyCache.get(id)
    if (!p) {
      p = makeNodeProxy(id, this.bridge)
      this.proxyCache.set(id, p)
    }
    return p
  }

  start() {
    this.stop()
    this.elapsed = 0
    const state = st()
    let started = 0
    for (const id in state.scene.nodes) {
      started += this.createInstancesForNode(id, false)
    }
    /* Unityの実行順: 全Awake → 全OnEnable → 全Start */
    for (const inst of this.instances) this.safeCall(inst, 'onAwake')
    for (const inst of this.instances) this.safeCall(inst, 'onEnable')
    for (const inst of this.instances) this.safeCall(inst, 'onStart')
    if (started > 0) state.log('info', `${started} script(s) started`)
  }

  /** Instantiate されたサブツリーのスクリプトを起動 (onStartも即時呼ぶ) */
  addInstancesForSubtree(rootId: NodeId) {
    const nodes = st().scene.nodes
    const ids: NodeId[] = []
    const walk = (id: NodeId) => {
      if (!nodes[id]) return
      ids.push(id)
      nodes[id].childrenIds.forEach(walk)
    }
    walk(rootId)
    const created: ScriptInstance[] = []
    for (const id of ids) {
      const before = this.instances.length
      this.createInstancesForNode(id, true)
      created.push(...this.instances.slice(before))
    }
    for (const inst of created) this.safeCall(inst, 'onAwake')
    for (const inst of created) this.safeCall(inst, 'onEnable')
    for (const inst of created) this.safeCall(inst, 'onStart')
  }

  /** Destroy されたノード群のスクリプトへ onDisable → onDestroy を配送して除去 */
  removeInstancesFor(ids: Set<NodeId>) {
    for (const inst of this.instances) {
      if (ids.has(inst.nodeId)) {
        this.safeCall(inst, 'onDisable')
        this.safeCall(inst, 'onDestroy')
      }
    }
    this.instances = this.instances.filter((i) => !ids.has(i.nodeId))
  }

  private createInstancesForNode(id: NodeId, quiet: boolean): number {
    const state = st()
    const node = state.scene.nodes[id]
    if (!node) return 0
    let count = 0
    node.components.forEach((comp, componentIndex) => {
      if (comp.type !== 'script' || comp.enabled === false) return
      const sc = comp as ScriptComponent
      let hooks: CompiledScript
      try {
        hooks = compileScript(sc.code)
      } catch (err) {
        if (!quiet) state.log('error', `[${sc.name}] Compile error on '${node.name}': ${String(err)}`)
        return
      }
      this.instances.push({
        nodeId: id,
        componentIndex,
        scriptName: sc.name,
        hooks,
        ctx: this.makeCtx(id, componentIndex, sc.name),
        dead: false,
      })
      count++
    })
    return count
  }

  private makeCtx(id: NodeId, componentIndex: number, scriptName: string): ScriptCtx {
    const self = this
    return {
      node: this.proxyFor(id),
      get props() {
        const c = st().scene.nodes[id]?.components[componentIndex]
        return c && c.type === 'script' ? c.props : {}
      },
      time: {
        get elapsed() {
          return self.elapsed
        },
        delta: 0,
      },
      input: this.input,
      screenPointToRay(x: number, y: number) {
        return self.bridge.screenPointToRay(x, y)
      },
      find(name: string) {
        const found = Object.values(st().scene.nodes).find((n) => n.name === name)
        return found ? self.proxyFor(found.id) : null
      },
      log(message: unknown) {
        st().log('info', `[${scriptName}] ${typeof message === 'object' ? JSON.stringify(message) : String(message)}`)
      },
      instantiate(source, position) {
        const sourceId = typeof source === 'string' ? Object.values(st().scene.nodes).find((n) => n.name === source)?.id : source.id
        if (!sourceId) return null
        const newId = self.bridge.instantiateNode(sourceId, position ? { x: position.x, y: position.y, z: position.z } : undefined)
        return newId ? self.proxyFor(newId) : null
      },
      destroy(target) {
        const targetId =
          target === undefined
            ? id
            : typeof target === 'string'
              ? Object.values(st().scene.nodes).find((n) => n.name === target)?.id
              : target.id
        if (targetId) self.bridge.destroyNode(targetId)
      },
      physics: {
        raycast(origin, dir, maxDistance = 1000) {
          const hit = self.bridge.raycast(
            { x: origin.x, y: origin.y, z: origin.z },
            { x: dir.x, y: dir.y, z: dir.z },
            maxDistance,
          )
          return hit ? { node: self.proxyFor(hit.nodeId), distance: hit.distance, point: hit.point } : null
        },
      },
      startCoroutine(gen) {
        const g = typeof gen === 'function' ? gen() : gen
        self.coroutines.push({ gen: g, wait: 0, scriptName })
      },
      animation: {
        play(clipName, fadeSeconds = 0.25) {
          self.bridge.playAnimation(id, clipName, fadeSeconds)
        },
      },
      playSound(assetNameOrId: string, volume = 1) {
        self.bridge.playSound(assetNameOrId, volume, id)
      },
    }
  }

  update(dt: number) {
    this.elapsed += dt
    for (const inst of this.instances) {
      inst.ctx.time.delta = dt
      this.safeCall(inst, 'onUpdate', dt)
    }
    /* コルーチン (Update後, Unityと同順)。yield 秒数=待機 / yield 0や値なし=次フレーム */
    this.coroutines = this.coroutines.filter((co) => {
      co.wait -= dt
      if (co.wait > 0) return true
      try {
        const r = co.gen.next()
        if (r.done) return false
        co.wait = typeof r.value === 'number' && r.value > 0 ? r.value : 0
        return true
      } catch (err) {
        st().log('error', `[${co.scriptName}] coroutine error: ${String(err)}`)
        return false
      }
    })
  }

  fixedUpdate(fixedDt: number) {
    for (const inst of this.instances) this.safeCall(inst, 'onFixedUpdate', fixedDt)
  }

  lateUpdate(dt: number) {
    for (const inst of this.instances) this.safeCall(inst, 'onLateUpdate', dt)
  }

  /** 物理イベントをスクリプトへ配送 */
  dispatchCollisions(events: Array<{ a: NodeId; b: NodeId; started: boolean; trigger: boolean }>) {
    for (const ev of events) {
      const hookName = ev.trigger
        ? ev.started
          ? ('onTriggerEnter' as const)
          : ('onTriggerExit' as const)
        : ev.started
          ? ('onCollisionEnter' as const)
          : ('onCollisionExit' as const)
      for (const inst of this.instances) {
        if (inst.nodeId === ev.a) this.safeCall(inst, hookName, this.proxyFor(ev.b))
        else if (inst.nodeId === ev.b) this.safeCall(inst, hookName, this.proxyFor(ev.a))
      }
    }
  }

  stop() {
    for (const inst of this.instances) this.safeCall(inst, 'onDisable')
    for (const inst of this.instances) this.safeCall(inst, 'onDestroy')
    this.instances = []
    this.coroutines = []
    this.proxyCache.clear()
  }

  private safeCall(inst: ScriptInstance, hook: keyof CompiledScript & string, arg?: unknown) {
    if (inst.dead) return
    const fn = inst.hooks[hook as (typeof HOOK_NAMES)[number]]
    if (!fn) return
    try {
      ;(fn as (c: ScriptCtx, a?: unknown) => void)(inst.ctx, arg)
    } catch (err) {
      inst.dead = true
      st().log('error', `[${inst.scriptName}] ${hook} error: ${String(err)} — script disabled until next Play`)
    }
  }
}
