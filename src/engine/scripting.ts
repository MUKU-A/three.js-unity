/**
 * スクリプトランタイム (MonoBehaviour相当, D-025)。
 * ユーザーコードは onStart(ctx) / onUpdate(ctx, dt) を定義し、const props = {...} で
 * Inspectorに露出するプロパティを宣言する。実行は再生モード中のみ。
 *
 * Transformへの書き込みはストアの transient 経由 (SSoT一方向フロー維持)。
 * 再生中の変更は停止時にスナップショットから完全復元される (D-006)。
 */
import type { NodeId, ScriptComponent, Transform, Vec3 } from '../types/scene'
import { useEditorStore } from '../store/editorStore'

/* ---------------------------------- 公開API (ctx) ---------------------------------- */

export interface VecProxy {
  x: number
  y: number
  z: number
  set(x: number, y: number, z: number): void
}

export interface NodeProxy {
  readonly id: NodeId
  readonly name: string
  position: VecProxy
  rotation: VecProxy
  scale: VecProxy
  visible: boolean
}

export interface ScriptCtx {
  node: NodeProxy
  props: Record<string, number | string | boolean>
  time: { elapsed: number; delta: number }
  input: { getKey(key: string): boolean; getKeyDown(key: string): boolean }
  find(name: string): NodeProxy | null
  log(message: unknown): void
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

export function makeNodeProxy(id: NodeId): NodeProxy {
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
  }
}

/* ---------------------------------- コンパイル ---------------------------------- */

export interface CompiledScript {
  onStart: ((ctx: ScriptCtx) => void) | null
  onUpdate: ((ctx: ScriptCtx, dt: number) => void) | null
  props: Record<string, number | string | boolean> | null
}

/** ユーザーコードを評価して hooks と props 宣言を取り出す。失敗時は Error を投げる */
export function compileScript(code: string): CompiledScript {
  const factory = new Function(
    `"use strict";\n${code}\n;return {\n  onStart: typeof onStart === 'function' ? onStart : null,\n  onUpdate: typeof onUpdate === 'function' ? onUpdate : null,\n  props: typeof props !== 'undefined' ? props : null,\n};`,
  )
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
  /** 実行時エラーで停止済み (Unityのコンソールエラー相当。スパム防止に1回で無効化) */
  dead: boolean
}

export class ScriptRuntime {
  private instances: ScriptInstance[] = []
  private elapsed = 0
  private input: { getKey(k: string): boolean; getKeyDown(k: string): boolean }

  constructor(input: { getKey(k: string): boolean; getKeyDown(k: string): boolean }) {
    this.input = input
  }

  get running(): boolean {
    return this.instances.length > 0
  }

  start() {
    this.stop()
    this.elapsed = 0
    const state = st()
    const proxyCache = new Map<NodeId, NodeProxy>()
    const proxyFor = (id: NodeId) => {
      let p = proxyCache.get(id)
      if (!p) {
        p = makeNodeProxy(id)
        proxyCache.set(id, p)
      }
      return p
    }

    for (const id in state.scene.nodes) {
      const node = state.scene.nodes[id]
      node.components.forEach((comp, componentIndex) => {
        if (comp.type !== 'script' || comp.enabled === false) return
        const sc = comp as ScriptComponent
        let hooks: CompiledScript
        try {
          hooks = compileScript(sc.code)
        } catch (err) {
          state.log('error', `[${sc.name}] Compile error on '${node.name}': ${String(err)}`)
          return
        }
        const self = this
        const ctx: ScriptCtx = {
          node: proxyFor(id),
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
          find(name: string) {
            const found = Object.values(st().scene.nodes).find((n) => n.name === name)
            return found ? proxyFor(found.id) : null
          },
          log(message: unknown) {
            st().log('info', `[${sc.name}] ${typeof message === 'object' ? JSON.stringify(message) : String(message)}`)
          },
        }
        this.instances.push({ nodeId: id, componentIndex, scriptName: sc.name, hooks, ctx, dead: false })
      })
    }

    for (const inst of this.instances) this.safeCall(inst, 'onStart', 0)
    if (this.instances.length > 0) state.log('info', `${this.instances.length} script(s) started`)
  }

  update(dt: number) {
    this.elapsed += dt
    for (const inst of this.instances) {
      inst.ctx.time.delta = dt
      this.safeCall(inst, 'onUpdate', dt)
    }
  }

  stop() {
    this.instances = []
  }

  private safeCall(inst: ScriptInstance, hook: 'onStart' | 'onUpdate', dt: number) {
    if (inst.dead) return
    const fn = inst.hooks[hook]
    if (!fn) return
    try {
      fn(inst.ctx, dt)
    } catch (err) {
      inst.dead = true
      st().log('error', `[${inst.scriptName}] ${hook} error: ${String(err)} — script disabled until next Play`)
    }
  }
}
