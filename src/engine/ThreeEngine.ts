/**
 * Three.js 実行エンジン (シングルトン)。
 * Zustand ストア (SSoT) を購読し、SceneGraph → Object3D ツリーを一方向同期する。
 * ビューポート操作 (選択 / TransformControls / フォーカス / DnD配置) の入口でもあり、
 * それらは必ずストアの action / Command を経由して書き戻す (直接 Object3D を正としない)。
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import type { EditorState } from '../store/editorStore'
import { activeNodeId, cmdAddObject, cmdPatchComponent, cmdPatchNode, makeGlbNode, useEditorStore } from '../store/editorStore'
import type { NodeId, SceneNode, Transform } from '../types/scene'
import { collectSubtreeIds, getComponent } from '../types/scene'
import { cloneSubtree } from '../store/sceneOps'
import { getAsset, isModelType } from './assets'
import { createIconSprite, createPickProxy, type IconKind } from './icons'
import { createContainer, DEG2RAD, disposeObject, RAD2DEG, updateContainer, type NodeContainer } from './objectFactory'
import { ScriptRuntime } from './scripting'
import { ensureRapier, PhysicsWorld } from './physics'

/* UNITY_UI_RESEARCH.md §2 のギズモ軸色 / 選択色 */
const AXIS_X = '#DB3E1D'
const AXIS_Y = '#9AF348'
const AXIS_Z = '#3A7AF8'
const AXIS_ACTIVE = '#F7F332'
const SELECTION_ORANGE = 0xff6600
/* Unity 準拠スナップ: Move 1 / Rotate 15° / Scale 0.1 */
const SNAP_MOVE = 1
const SNAP_ROTATE = 15 * DEG2RAD
const SNAP_SCALE = 0.1

interface Decoration {
  kind: IconKind
  sprite: THREE.Sprite
  proxy: THREE.Mesh
}

class ThreeEngine {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.03, 5000)
  private renderer: THREE.WebGLRenderer | null = null
  private orbit: OrbitControls | null = null
  private gizmo: TransformControls | null = null
  private mountEl: HTMLElement | null = null
  private resizeObserver: ResizeObserver | null = null
  private rafId = 0

  private readonly objectMap = new Map<NodeId, NodeContainer>()
  private readonly decorations = new Map<NodeId, Decoration>()
  private readonly selectionBoxes = new Map<NodeId, THREE.BoxHelper>()
  private lightHelper: THREE.Object3D | null = null
  private cameraHelper: THREE.CameraHelper | null = null

  private lastNodes: Record<NodeId, SceneNode> = {}
  private prevSceneRef: unknown = null

  private grid: THREE.Mesh
  private sky: THREE.Mesh
  private hemi: THREE.HemisphereLight

  private readonly clock = new THREE.Clock()
  private readonly mixers = new Map<
    NodeId,
    { mixer: THREE.AnimationMixer; actions: Map<string, THREE.AnimationAction>; current: THREE.AnimationAction | null }
  >()

  private dragBefore: Transform | null = null
  private focusAnim: { fromPos: THREE.Vector3; toPos: THREE.Vector3; fromTgt: THREE.Vector3; toTgt: THREE.Vector3; t: number } | null = null
  private unsubscribe: (() => void) | null = null
  private orbitTarget = new THREE.Vector3(0, 0, 0)

  /* --- Gameビュー (D-020) --- */
  private gameRenderer: THREE.WebGLRenderer | null = null
  private gameMount: HTMLElement | null = null
  private gameResizeObserver: ResizeObserver | null = null

  /* --- フライスルー (右ドラッグ+WASD, D-021) --- */
  private fly: { yaw: number; pitch: number; speed: number; pointerId: number } | null = null
  private readonly flyKeys = new Set<string>()
  get isFlying(): boolean {
    return this.fly !== null
  }

  /* --- 矩形選択 (D-021) --- */
  private band: { startX: number; startY: number; el: HTMLDivElement; active: boolean; additive: boolean } | null = null

  /* --- スクリプト/物理ランタイム (D-025/D-026/D-028) --- */
  private readonly gameKeys = new Set<string>()
  private readonly gameKeysDown = new Set<string>()
  private readonly scriptRuntime = new ScriptRuntime(
    {
      getKey: (k) => this.gameKeys.has(k.toLowerCase()),
      getKeyDown: (k) => this.gameKeysDown.has(k.toLowerCase()),
    },
    {
      raycast: (origin, dir, maxDistance) => this.physicsWorld.raycast(origin, dir, maxDistance),
      instantiateNode: (sourceId, position) => this.instantiateNode(sourceId, position),
      destroyNode: (id) => this.destroyNode(id),
      playAnimation: (nodeId, clipName, fade) => this.playAnimation(nodeId, clipName, fade),
    },
  )
  private physicsWorld = new PhysicsWorld()
  private physicsPending = false
  private fixedAcc = 0
  private colliderHelper: THREE.LineSegments | null = null

  constructor() {
    this.camera.position.set(7, 5, -7)
    this.camera.lookAt(0, 0, 0)

    /* Unityの手続きスカイボックス風グラデーション (D: Sceneビューの空) */
    this.sky = makeGradientSky()
    this.scene.add(this.sky)

    /* 環境光 (Unity の Ambient/Skybox lighting 相当。シーングラフ外) */
    this.hemi = new THREE.HemisphereLight(0xbfd4e5, 0x4a4a42, 0.5)
    this.hemi.userData.noPick = true
    this.scene.add(this.hemi)

    /* グリッド (1m間隔・10mメジャー線・距離フェードのシェーダグリッド) */
    this.grid = makeUnityGrid()
    this.scene.add(this.grid)

    /* ゲーム内入力 (再生中のみ収集, ctx.input.getKey / getKeyDown 用) */
    window.addEventListener('keydown', (e) => {
      if (useEditorStore.getState().mode !== 'play') return
      const k = e.key.toLowerCase()
      if (!this.gameKeys.has(k)) this.gameKeysDown.add(k)
      this.gameKeys.add(k)
    })
    window.addEventListener('keyup', (e) => this.gameKeys.delete(e.key.toLowerCase()))

    /* 初期同期 + 購読開始 */
    this.applyState(useEditorStore.getState(), null)
    this.unsubscribe = useEditorStore.subscribe((s, prev) => this.applyState(s, prev))

    /* 描画ループはエンジンが所有する (パネルのマウント状態と独立 — Game/Sceneどちらかだけでも回る) */
    const loop = () => {
      this.rafId = requestAnimationFrame(loop)
      this.tick()
    }
    loop()
  }

  /* ---------------------------------- mount ---------------------------------- */

  mount(el: HTMLElement) {
    if (this.mountEl === el && this.renderer) return
    this.unmountDom()
    this.mountEl = el

    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({ antialias: true })
      this.renderer.shadowMap.enabled = true
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
      this.renderer.setPixelRatio(window.devicePixelRatio)
      /* canvas は再マウントをまたいで使い回すため、リスナーは一度だけ張る */
      this.bindPointer(this.renderer.domElement)
      this.bindDnD(this.renderer.domElement)
      this.bindSnapKeys()
    }
    el.appendChild(this.renderer.domElement)
    this.renderer.domElement.style.display = 'block'
    this.renderer.domElement.style.outline = 'none'
    this.renderer.domElement.tabIndex = -1

    /* Unity互換カメラ操作 (D-021):
       Alt+左=オービット / 中=パン / ホイール=ズーム / 右ドラッグ+WASD=フライスルー / 左ドラッグ=矩形選択 */
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement)
    this.orbit.enableDamping = false
    this.orbit.target.copy(this.orbitTarget)
    this.orbit.mouseButtons = {
      LEFT: null as unknown as THREE.MOUSE, // Altキー押下中のみ ROTATE を割り当てる
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: null as unknown as THREE.MOUSE, // 右は独自フライスルー
    }

    /* TransformControls + Unity軸色 */
    this.gizmo = new TransformControls(this.camera, this.renderer.domElement)
    this.gizmo.setColors(AXIS_X, AXIS_Y, AXIS_Z, AXIS_ACTIVE)
    this.gizmo.getHelper().userData.noPick = true
    this.scene.add(this.gizmo.getHelper())
    this.gizmo.addEventListener('dragging-changed', (e) => {
      const dragging = e.value as boolean
      if (this.orbit) this.orbit.enabled = !dragging
      const st = useEditorStore.getState()
      const id = activeNodeId(st)
      if (dragging) {
        this.dragBefore = id ? structuredClone(st.scene.nodes[id]?.transform ?? null) : null
      } else if (id && this.dragBefore) {
        const after = st.scene.nodes[id]?.transform
        if (after && JSON.stringify(after) !== JSON.stringify(this.dragBefore)) {
          st.pushApplied(
            cmdPatchNode(id, { transform: this.dragBefore }, { transform: structuredClone(after) }, 'Transform'),
          )
        }
        this.dragBefore = null
      }
    })
    this.gizmo.addEventListener('objectChange', () => {
      const st = useEditorStore.getState()
      const id = activeNodeId(st)
      const obj = id ? this.objectMap.get(id) : null
      if (!id || !obj) return
      st.transientSetTransform(id, {
        position: { x: round6(obj.position.x), y: round6(obj.position.y), z: round6(obj.position.z) },
        rotation: {
          x: round6(obj.rotation.x * RAD2DEG),
          y: round6(obj.rotation.y * RAD2DEG),
          z: round6(obj.rotation.z * RAD2DEG),
        },
        scale: { x: round6(obj.scale.x), y: round6(obj.scale.y), z: round6(obj.scale.z) },
      })
    })

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(el)
    this.resize()
    this.syncInteractionState(useEditorStore.getState())
  }

  private unmountDom() {
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    if (this.gizmo) {
      this.gizmo.detach()
      this.scene.remove(this.gizmo.getHelper())
      this.gizmo.dispose()
      this.gizmo = null
    }
    this.orbit?.dispose()
    this.orbit = null
    if (this.renderer && this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement)
    }
    this.mountEl = null
  }

  unmount() {
    this.unmountDom()
  }

  /* ---------------- Gameビューのマウント ---------------- */

  mountGame(el: HTMLElement) {
    if (this.gameMount === el && this.gameRenderer) return
    this.unmountGame()
    this.gameMount = el
    if (!this.gameRenderer) {
      this.gameRenderer = new THREE.WebGLRenderer({ antialias: true })
      this.gameRenderer.shadowMap.enabled = true
      this.gameRenderer.shadowMap.type = THREE.PCFSoftShadowMap
      this.gameRenderer.setPixelRatio(window.devicePixelRatio)
    }
    el.appendChild(this.gameRenderer.domElement)
    this.gameRenderer.domElement.style.display = 'block'
    this.gameResizeObserver = new ResizeObserver(() => {
      if (this.gameMount && this.gameRenderer) {
        this.gameRenderer.setSize(Math.max(1, this.gameMount.clientWidth), Math.max(1, this.gameMount.clientHeight))
      }
    })
    this.gameResizeObserver.observe(el)
    this.gameRenderer.setSize(Math.max(1, el.clientWidth), Math.max(1, el.clientHeight))
  }

  unmountGame() {
    this.gameResizeObserver?.disconnect()
    this.gameResizeObserver = null
    if (this.gameRenderer?.domElement.parentElement) {
      this.gameRenderer.domElement.parentElement.removeChild(this.gameRenderer.domElement)
    }
    this.gameMount = null
  }

  /* ---------------- 方位ギズモからの軸整列 (Unityのシーンギズモ相当) ---------------- */

  /** 指定方向から注視点を見るようカメラをアニメーション (距離・注視点は維持) */
  alignToAxis(dir: THREE.Vector3) {
    if (!this.orbit) return
    const target = this.orbit.target.clone()
    const dist = Math.max(0.5, this.camera.position.distanceTo(target))
    this.focusAnim = {
      fromPos: this.camera.position.clone(),
      toPos: target.clone().addScaledVector(dir.clone().normalize(), dist),
      fromTgt: target.clone(),
      toTgt: target,
      t: 0,
    }
  }

  private resize() {
    if (!this.renderer || !this.mountEl) return
    const w = Math.max(1, this.mountEl.clientWidth)
    const h = Math.max(1, this.mountEl.clientHeight)
    this.renderer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  /* ---------------------------------- store → three 同期 ---------------------------------- */

  private applyState(s: EditorState, prev: EditorState | null) {
    if (!prev || s.scene.nodes !== this.prevSceneRef) {
      this.reconcileNodes(s)
      this.prevSceneRef = s.scene.nodes
    }
    if (!prev || s.selection !== prev.selection || s.scene.nodes !== prev.scene.nodes || s.tool !== prev.tool || s.transformSpace !== prev.transformSpace || s.mode !== prev.mode) {
      this.syncInteractionState(s)
    }
    if (!prev || s.showGrid !== prev.showGrid) this.grid.visible = s.showGrid
    if (!prev || s.shadingMode !== prev.shadingMode || s.scene.nodes !== prev.scene.nodes) this.syncShading(s)
    if (!prev || s.focusRequestId !== prev.focusRequestId) {
      if (prev) this.focusSelection(s)
    }
    if (!prev || s.mode !== prev.mode) this.syncPlayMode(s, prev?.mode ?? 'edit')
  }

  /** Shaded / Wireframe 描画モード (Sceneビューのドローモード, D-023) */
  private syncShading(s: EditorState) {
    const wire = s.shadingMode === 'wireframe'
    for (const obj of this.objectMap.values()) {
      obj.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.isMesh && !m.userData.pickProxy) {
          const mats = Array.isArray(m.material) ? m.material : [m.material]
          for (const mat of mats) {
            const std = mat as THREE.MeshStandardMaterial
            if (std.isMeshStandardMaterial) std.wireframe = wire || (std.userData.baseWireframe ?? false)
          }
        }
      })
    }
  }

  private reconcileNodes(s: EditorState) {
    const nodes = s.scene.nodes

    /* 消えたノードを破棄 */
    for (const [id, obj] of this.objectMap) {
      if (!nodes[id]) {
        obj.removeFromParent()
        disposeObject(obj)
        this.objectMap.delete(id)
        const deco = this.decorations.get(id)
        if (deco) {
          deco.sprite.material.dispose()
          this.decorations.delete(id)
        }
        this.mixers.delete(id)
      }
    }
    /* 1st pass: コンテナ生成 + 差分更新 */
    for (const id in nodes) {
      const node = nodes[id]
      let obj = this.objectMap.get(id)
      if (!obj) {
        obj = createContainer(node)
        this.objectMap.set(id, obj)
        this.updateDecoration(id, node)
        if (node.components !== this.lastNodes[id]?.components) this.resetMixer(id, obj)
      } else if (this.lastNodes[id] !== node) {
        const structuralChange = this.lastNodes[id]?.components !== node.components
        updateContainer(obj, node, this.lastNodes[id] ?? null)
        if (structuralChange) {
          this.updateDecoration(id, node)
          this.resetMixer(id, obj)
        }
      }
    }
    /* 2nd pass: 親子リンク */
    for (const id in nodes) {
      const node = nodes[id]
      const obj = this.objectMap.get(id)!
      const desiredParent: THREE.Object3D = node.parentId ? (this.objectMap.get(node.parentId) ?? this.scene) : this.scene
      if (obj.parent !== desiredParent) desiredParent.add(obj)
    }
    this.lastNodes = nodes
  }

  /** ライト/カメラのアイコン + ピックプロキシ */
  private updateDecoration(id: NodeId, node: SceneNode) {
    const obj = this.objectMap.get(id)
    if (!obj) return
    const light = getComponent(node, 'light')
    const cam = getComponent(node, 'camera')
    const kind: IconKind | null = light
      ? light.lightType === 'directional'
        ? 'sun'
        : light.lightType === 'point'
          ? 'bulb'
          : 'spot'
      : cam
        ? 'camera'
        : null

    const existing = this.decorations.get(id)
    if (existing && existing.kind === kind) return
    if (existing) {
      existing.sprite.removeFromParent()
      existing.proxy.removeFromParent()
      existing.sprite.material.dispose()
      this.decorations.delete(id)
    }
    if (kind) {
      const sprite = createIconSprite(kind)
      const proxy = createPickProxy()
      obj.add(sprite)
      obj.add(proxy)
      this.decorations.set(id, { kind, sprite, proxy })
    }
  }

  private resetMixer(id: NodeId, obj: NodeContainer) {
    this.mixers.delete(id)
    const clips = obj.userData.parts.animations
    const meshRoot = obj.userData.parts.mesh
    if (!clips || clips.length === 0 || !meshRoot) return
    const mixer = new THREE.AnimationMixer(meshRoot)
    const actions = new Map(clips.map((c) => [c.name, mixer.clipAction(c)]))
    /* mesh.animationClip: undefined=全再生(旧互換) / null=なし / 名前=そのClip (D-028) */
    const node = useEditorStore.getState().scene.nodes[id]
    const meshComp = node ? getComponent(node, 'mesh') : undefined
    const sel = meshComp?.animationClip
    let current: THREE.AnimationAction | null = null
    if (sel === undefined) {
      actions.forEach((a) => a.play())
    } else if (sel !== null) {
      const a = actions.get(sel)
      if (a) {
        a.play()
        current = a
      }
    }
    this.mixers.set(id, { mixer, actions, current })
  }

  /** スクリプトAPI: AnimationClip の crossfade 切替 (ctx.animation.play) */
  private playAnimation(nodeId: NodeId, clipName: string | null, fade: number) {
    const e = this.mixers.get(nodeId)
    if (!e) return
    if (clipName === null) {
      e.actions.forEach((a) => a.fadeOut(fade))
      e.current = null
      return
    }
    const next = e.actions.get(clipName)
    if (!next) {
      useEditorStore.getState().log('warn', `animation.play: clip '${clipName}' not found`)
      return
    }
    next.enabled = true
    next.reset()
    if (e.current && e.current !== next) {
      next.play()
      e.current.crossFadeTo(next, fade, false)
    } else {
      next.fadeIn(fade).play()
    }
    e.current = next
  }

  /** スクリプトAPI: サブツリー複製の動的生成 (ctx.instantiate)。履歴に載せない */
  private instantiateNode(sourceId: NodeId, position?: { x: number; y: number; z: number }): NodeId | null {
    const state = useEditorStore.getState()
    const clone = cloneSubtree(state.scene, sourceId)
    if (!clone) return null
    if (position) {
      clone.nodes[0] = {
        ...clone.nodes[0],
        transform: { ...clone.nodes[0].transform, position: { ...position } },
      }
    }
    state.transientAddSubtree(clone.nodes, null) // 購読は同期発火 → objectMap は構築済み
    const nodes = useEditorStore.getState().scene.nodes
    if (this.physicsWorld.active) {
      for (const nid of collectSubtreeIds(nodes, clone.rootId)) {
        this.physicsWorld.addNode(nodes[nid], this.objectMap.get(nid), (lv, msg) => useEditorStore.getState().log(lv, msg))
      }
    }
    this.scriptRuntime.addInstancesForSubtree(clone.rootId)
    return clone.rootId
  }

  /** スクリプトAPI: ノード破棄 (ctx.destroy)。onDestroy配送 → 物理除去 → ストア除去 */
  private destroyNode(id: NodeId) {
    const state = useEditorStore.getState()
    if (!state.scene.nodes[id]) return
    const ids = new Set(collectSubtreeIds(state.scene.nodes, id))
    this.scriptRuntime.removeInstancesFor(ids)
    for (const nid of ids) this.physicsWorld.removeNode(nid)
    state.transientRemoveSubtree(id)
  }

  /* ---------------------------------- 選択・ギズモ・ヘルパー ---------------------------------- */

  private syncInteractionState(s: EditorState) {
    /* 選択ボックス (Unityのオレンジ枠相当, D-007) */
    const selected = new Set(s.selection.filter((id) => s.scene.nodes[id]))
    for (const [id, box] of this.selectionBoxes) {
      if (!selected.has(id)) {
        box.removeFromParent()
        box.dispose()
        this.selectionBoxes.delete(id)
      }
    }
    for (const id of selected) {
      const obj = this.objectMap.get(id)
      if (!obj) continue
      if (!this.selectionBoxes.has(id)) {
        const box = new THREE.BoxHelper(obj, SELECTION_ORANGE)
        ;(box.material as THREE.LineBasicMaterial).depthTest = false
        ;(box.material as THREE.LineBasicMaterial).transparent = true
        ;(box.material as THREE.LineBasicMaterial).opacity = 0.9
        box.renderOrder = 800
        box.userData.noPick = true
        this.scene.add(box)
        this.selectionBoxes.set(id, box)
      }
    }

    /* ギズモは アクティブ(末尾選択) に付ける (D-010) */
    const act = activeNodeId(s)
    const actObj = act ? this.objectMap.get(act) : null
    if (this.gizmo) {
      if (actObj) {
        if (this.gizmo.object !== actObj) this.gizmo.attach(actObj)
        this.gizmo.setMode(s.tool === 'move' ? 'translate' : s.tool === 'rotate' ? 'rotate' : 'scale')
        this.gizmo.setSpace(s.tool === 'scale' ? 'local' : s.transformSpace)
      } else {
        this.gizmo.detach()
      }
    }

    /* ライト/カメラヘルパー (選択中のみ表示) */
    this.lightHelper?.removeFromParent()
    ;(this.lightHelper as unknown as { dispose?: () => void })?.dispose?.()
    this.lightHelper = null
    this.cameraHelper?.removeFromParent()
    this.cameraHelper?.dispose()
    this.cameraHelper = null

    const actNode = act ? s.scene.nodes[act] : null
    if (actNode && actObj) {
      const parts = actObj.userData.parts
      const lightComp = getComponent(actNode, 'light')
      if (lightComp && parts.light) {
        let helper: THREE.Object3D | null = null
        if (lightComp.lightType === 'directional') {
          helper = new THREE.DirectionalLightHelper(parts.light as THREE.DirectionalLight, 1, 0xf7f332)
        } else if (lightComp.lightType === 'point') {
          helper = new THREE.PointLightHelper(parts.light as THREE.PointLight, lightComp.range, 0xf7f332)
        } else {
          helper = new THREE.SpotLightHelper(parts.light as THREE.SpotLight, 0xf7f332)
        }
        helper.userData.noPick = true
        this.lightHelper = helper
        this.scene.add(helper)
      }
      if (parts.camera && getComponent(actNode, 'camera')) {
        this.cameraHelper = new THREE.CameraHelper(parts.camera)
        this.cameraHelper.userData.noPick = true
        this.scene.add(this.cameraHelper)
      }
    }

    /* コライダーの緑ワイヤーフレーム (Unity互換, 選択中のみ) */
    if (this.colliderHelper) {
      this.colliderHelper.removeFromParent()
      this.colliderHelper.geometry.dispose()
      ;(this.colliderHelper.material as THREE.Material).dispose()
      this.colliderHelper = null
    }
    const colComp = actNode ? getComponent(actNode, 'collider') : undefined
    if (colComp && actObj) {
      const geo =
        colComp.shape === 'sphere'
          ? new THREE.WireframeGeometry(new THREE.SphereGeometry(colComp.radius, 16, 10))
          : new THREE.EdgesGeometry(new THREE.BoxGeometry(colComp.size.x, colComp.size.y, colComp.size.z))
      const helper = new THREE.LineSegments(
        geo,
        new THREE.LineBasicMaterial({ color: 0x74f274, transparent: true, opacity: 0.85 }),
      )
      helper.position.set(colComp.center.x, colComp.center.y, colComp.center.z)
      helper.userData.noPick = true
      helper.renderOrder = 750
      actObj.add(helper)
      this.colliderHelper = helper
    }
  }

  /* ---------------------------------- play mode ---------------------------------- */

  private syncPlayMode(s: EditorState, prevMode: EditorState['mode']) {
    if (s.mode === 'play') this.clock.start()
    if (prevMode === 'edit' && s.mode === 'play') {
      /* ▶ 開始: スクリプト起動 + 物理ワールド構築 (Rapier WASMは初回のみ遅延ロード) */
      this.gameKeys.clear()
      this.gameKeysDown.clear()
      this.fixedAcc = 0
      this.scriptRuntime.start()
      this.physicsPending = true
      void ensureRapier()
        .then(() => {
          if (useEditorStore.getState().mode !== 'edit' && this.physicsPending) {
            this.physicsWorld.start(
              useEditorStore.getState().scene.nodes,
              (id) => this.objectMap.get(id),
              (lv, msg) => useEditorStore.getState().log(lv, msg),
            )
          }
          this.physicsPending = false
        })
        .catch((err) => {
          this.physicsPending = false
          useEditorStore.getState().log('error', `Physics init failed: ${String(err)}`)
        })
    } else if (s.mode === 'edit' && prevMode !== 'edit') {
      /* ⏹ 停止: ランタイム破棄 (シーン復元は reconcileNodes が担う) */
      this.scriptRuntime.stop()
      this.physicsWorld.dispose()
      this.physicsPending = false
    }
  }

  /* ---------------------------------- picking ---------------------------------- */

  private raycaster = new THREE.Raycaster()
  private downPos: { x: number; y: number; button: number } | null = null

  private bindPointer(el: HTMLElement) {
    el.addEventListener('contextmenu', (e) => e.preventDefault())

    el.addEventListener('pointerdown', (e) => {
      this.downPos = { x: e.clientX, y: e.clientY, button: e.button }
      if (e.button === 2) {
        /* pointer lock 中の setPointerCapture は例外になるため、
           同一イベントで後続の TransformControls/OrbitControls ハンドラを走らせない */
        e.stopImmediatePropagation()
        e.preventDefault()
        this.startFly(e)
      } else if (e.button === 0 && !e.altKey && !this.gizmo?.dragging && !this.gizmo?.axis) {
        /* 矩形選択の候補 (5px 動いたら発動) */
        this.band = {
          startX: e.clientX,
          startY: e.clientY,
          el: this.ensureBandEl(),
          active: false,
          additive: e.ctrlKey || e.metaKey || e.shiftKey,
        }
      }
    })

    el.addEventListener('pointermove', (e) => {
      if (this.fly && e.pointerId === this.fly.pointerId) {
        const dx = document.pointerLockElement ? e.movementX : e.movementX || 0
        const dy = document.pointerLockElement ? e.movementY : e.movementY || 0
        this.fly.yaw -= dx * 0.0022
        this.fly.pitch = Math.max(-1.55, Math.min(1.55, this.fly.pitch - dy * 0.0022))
        this.camera.quaternion.setFromEuler(new THREE.Euler(this.fly.pitch, this.fly.yaw, 0, 'YXZ'))
        return
      }
      if (this.band && this.downPos?.button === 0) {
        const dx = e.clientX - this.band.startX
        const dy = e.clientY - this.band.startY
        if (!this.band.active && Math.hypot(dx, dy) > 5 && !this.gizmo?.dragging && !this.gizmo?.axis) {
          this.band.active = true
          this.band.el.style.display = 'block'
        }
        if (this.band.active) this.updateBandRect(e.clientX, e.clientY)
      }
    })

    el.addEventListener('pointerup', (e) => {
      const down = this.downPos
      this.downPos = null
      if (this.fly && e.button === 2) {
        this.endFly()
        return
      }
      const band = this.band
      this.band = null
      if (band?.active) {
        band.el.style.display = 'none'
        this.bandSelect(band, e.clientX, e.clientY)
        return
      }
      if (band) band.el.style.display = 'none'
      if (!down || down.button !== 0 || e.button !== 0) return
      if (e.altKey) return // Alt+クリックはオービット系
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return
      if (this.gizmo?.dragging || this.gizmo?.axis) return // ギズモ操作中
      this.pick(e)
    })

    /* Alt押下中のみ 左ボタン=オービット (Unity互換) */
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Alt' && this.orbit) {
        this.orbit.mouseButtons.LEFT = THREE.MOUSE.ROTATE
        e.preventDefault() // ブラウザのメニューフォーカスを抑止
      }
      if (this.fly) {
        const k = e.key.toLowerCase()
        if ('wasdqe'.includes(k) && k.length === 1) {
          this.flyKeys.add(k)
          e.preventDefault()
        }
        if (e.key === 'Shift') this.flyKeys.add('shift')
      }
    })
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Alt' && this.orbit) this.orbit.mouseButtons.LEFT = null as unknown as THREE.MOUSE
      const k = e.key.toLowerCase()
      this.flyKeys.delete(k)
      if (e.key === 'Shift') this.flyKeys.delete('shift')
    })
    window.addEventListener('blur', () => {
      this.flyKeys.clear()
      if (this.orbit) this.orbit.mouseButtons.LEFT = null as unknown as THREE.MOUSE
    })

    /* フライ中のホイール = 移動速度調整 (Unity互換)。通常時はOrbitControlsのズーム */
    el.addEventListener(
      'wheel',
      (e) => {
        if (this.fly) {
          e.preventDefault()
          e.stopImmediatePropagation()
          this.fly.speed = Math.max(0.5, Math.min(50, this.fly.speed * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))
        }
      },
      { capture: true, passive: false },
    )
  }

  /* ---------------- フライスルー ---------------- */

  private startFly(e: PointerEvent) {
    if (!this.renderer) return
    const eu = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ')
    this.fly = { yaw: eu.y, pitch: eu.x, speed: 6, pointerId: e.pointerId }
    if (this.orbit) this.orbit.enabled = false
    try {
      this.renderer.domElement.setPointerCapture(e.pointerId)
      this.renderer.domElement.requestPointerLock?.()
    } catch {
      /* pointer lock 非対応環境 (headless等) では movementX/Y フォールバックで動く */
    }
  }

  private endFly() {
    if (!this.fly) return
    this.fly = null
    this.flyKeys.clear()
    document.exitPointerLock?.()
    if (this.orbit) {
      /* オービットの注視点をカメラ前方へ再設定して滑らかに引き継ぐ */
      const dist = Math.max(1, this.orbit.target.distanceTo(this.camera.position))
      const fwd = this.camera.getWorldDirection(new THREE.Vector3())
      this.orbit.target.copy(this.camera.position).addScaledVector(fwd, dist)
      this.orbit.enabled = true
    }
  }

  /* ---------------- 矩形選択 ---------------- */

  private ensureBandEl(): HTMLDivElement {
    let div = this.mountEl?.querySelector<HTMLDivElement>('[data-band]') ?? null
    if (!div && this.mountEl) {
      div = document.createElement('div')
      div.dataset.band = '1'
      div.style.cssText =
        'position:absolute;display:none;border:1px solid #8cb8e8;background:rgba(70,120,180,0.18);pointer-events:none;z-index:20'
      this.mountEl.appendChild(div)
    }
    return div!
  }

  private updateBandRect(cx: number, cy: number) {
    if (!this.band || !this.mountEl) return
    const host = this.mountEl.getBoundingClientRect()
    const x1 = Math.min(this.band.startX, cx) - host.left
    const y1 = Math.min(this.band.startY, cy) - host.top
    const x2 = Math.max(this.band.startX, cx) - host.left
    const y2 = Math.max(this.band.startY, cy) - host.top
    Object.assign(this.band.el.style, { left: `${x1}px`, top: `${y1}px`, width: `${x2 - x1}px`, height: `${y2 - y1}px` })
  }

  /** 矩形内のオブジェクトを選択 (バウンディングボックス角/中心の投影で判定) */
  private bandSelect(band: NonNullable<typeof this.band>, endX: number, endY: number) {
    if (!this.renderer) return
    const rect = this.renderer.domElement.getBoundingClientRect()
    const x1 = Math.min(band.startX, endX)
    const y1 = Math.min(band.startY, endY)
    const x2 = Math.max(band.startX, endX)
    const y2 = Math.max(band.startY, endY)
    const st = useEditorStore.getState()
    const hits: NodeId[] = []
    const v = new THREE.Vector3()
    const box = new THREE.Box3()
    for (const [id, obj] of this.objectMap) {
      if (!st.scene.nodes[id] || !this.isChainVisible(id, st)) continue
      box.setFromObject(obj)
      const points: THREE.Vector3[] = box.isEmpty()
        ? [obj.getWorldPosition(new THREE.Vector3())]
        : [
            box.getCenter(new THREE.Vector3()),
            new THREE.Vector3(box.min.x, box.min.y, box.min.z),
            new THREE.Vector3(box.max.x, box.max.y, box.max.z),
          ]
      for (const p of points) {
        v.copy(p).project(this.camera)
        if (v.z > 1) continue // カメラ後方
        const sx = rect.left + ((v.x + 1) / 2) * rect.width
        const sy = rect.top + ((1 - v.y) / 2) * rect.height
        if (sx >= x1 && sx <= x2 && sy >= y1 && sy <= y2) {
          hits.push(id)
          break
        }
      }
    }
    if (band.additive) {
      const merged = [...new Set([...st.selection, ...hits])]
      st.select(merged)
    } else {
      st.select(hits)
    }
  }

  private pick(e: PointerEvent) {
    if (!this.renderer) return
    const rect = this.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(ndc, this.camera)
    const st = useEditorStore.getState()

    const pickables: THREE.Object3D[] = []
    for (const [id, obj] of this.objectMap) {
      const node = st.scene.nodes[id]
      if (!node || !this.isChainVisible(id, st)) continue
      obj.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && !o.userData.noPick) pickables.push(o)
      })
    }
    const hits = this.raycaster.intersectObjects(pickables, false)
    const hit = hits.find((h) => this.findNodeId(h.object) !== null)
    const id = hit ? this.findNodeId(hit.object) : null

    if (id) {
      if (e.ctrlKey || e.metaKey) st.toggleSelect(id)
      else st.select([id])
    } else if (!e.ctrlKey && !e.metaKey) {
      st.clearSelection()
    }
  }

  private findNodeId(obj: THREE.Object3D | null): NodeId | null {
    while (obj) {
      const id = (obj.userData as { nodeId?: string }).nodeId
      if (id) return id
      obj = obj.parent
    }
    return null
  }

  private isChainVisible(id: NodeId, st: EditorState): boolean {
    let cur: SceneNode | undefined = st.scene.nodes[id]
    while (cur) {
      if (!cur.visible) return false
      cur = cur.parentId ? st.scene.nodes[cur.parentId] : undefined
    }
    return true
  }

  /* ---------------------------------- Projectパネルからの DnD 配置 ---------------------------------- */

  private bindDnD(el: HTMLElement) {
    el.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('application/x-unitythree-asset')) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }
    })
    el.addEventListener('drop', (e) => {
      const assetId = e.dataTransfer?.getData('application/x-unitythree-asset')
      if (!assetId) return
      e.preventDefault()
      const asset = getAsset(assetId)
      if (!asset) return
      const st = useEditorStore.getState()
      const point = this.dropPoint(e)

      if (asset.meta.type === 'prefab') {
        void import('../store/actions').then((acts) => {
          acts.instantiatePrefab(assetId, { x: round3(point.x), y: round3(point.y), z: round3(point.z) })
          st.log('info', `Instantiated prefab '${asset.meta.name}'`)
        })
      } else if (isModelType(asset.meta.type)) {
        const node = makeGlbNode(assetId, asset.meta.name)
        node.transform.position = { x: round3(point.x), y: round3(point.y), z: round3(point.z) }
        st.execute(cmdAddObject([node], null))
        st.log('info', `Placed '${node.name}' from asset '${asset.meta.name}'`)
      } else {
        /* テクスチャ: ドロップ先オブジェクトの material に割当 */
        const target = this.pickAt(e.clientX, e.clientY)
        if (target) {
          const node = st.scene.nodes[target]
          const idx = node.components.findIndex((c) => c.type === 'material')
          if (idx >= 0) {
            const before = { textureAssetId: (node.components[idx] as { textureAssetId?: string | null }).textureAssetId ?? null }
            st.execute(cmdPatchComponent(target, idx, before, { textureAssetId: assetId }, 'Assign Texture'))
            st.log('info', `Assigned texture '${asset.meta.name}' to '${node.name}'`)
          } else {
            st.log('warn', `'${node.name}' has no Material component`)
          }
        }
      }
    })
  }

  private dropPoint(e: DragEvent): THREE.Vector3 {
    if (!this.renderer) return new THREE.Vector3()
    const rect = this.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(ndc, this.camera)
    /* 地面 (y=0) との交点。外れたらカメラ前方 8m */
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const out = new THREE.Vector3()
    if (this.raycaster.ray.intersectPlane(plane, out)) return out
    return this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(8).add(this.camera.position)
  }

  private pickAt(clientX: number, clientY: number): NodeId | null {
    if (!this.renderer) return null
    const rect = this.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(ndc, this.camera)
    const st = useEditorStore.getState()
    const pickables: THREE.Object3D[] = []
    for (const [id, obj] of this.objectMap) {
      if (!st.scene.nodes[id] || !this.isChainVisible(id, st)) continue
      obj.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && !o.userData.noPick && !o.userData.pickProxy) pickables.push(o)
      })
    }
    const hits = this.raycaster.intersectObjects(pickables, false)
    return hits.length > 0 ? this.findNodeId(hits[0].object) : null
  }

  /* ---------------------------------- snap (Ctrl押下中, Unity互換) ---------------------------------- */

  private bindSnapKeys() {
    const setSnap = (on: boolean) => {
      if (!this.gizmo) return
      this.gizmo.translationSnap = on ? SNAP_MOVE : null
      this.gizmo.rotationSnap = on ? SNAP_ROTATE : null
      this.gizmo.scaleSnap = on ? SNAP_SCALE : null
    }
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Control' || e.key === 'Meta') setSnap(true)
    })
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Control' || e.key === 'Meta') setSnap(false)
    })
    window.addEventListener('blur', () => setSnap(false))
  }

  /* ---------------------------------- focus (F) ---------------------------------- */

  focusSelection(s?: EditorState) {
    const st = s ?? useEditorStore.getState()
    const act = activeNodeId(st)
    const obj = act ? this.objectMap.get(act) : null
    if (!obj || !this.orbit) return

    const box = new THREE.Box3().setFromObject(obj)
    const center = new THREE.Vector3()
    let radius = 1
    if (!box.isEmpty()) {
      box.getCenter(center)
      radius = Math.max(0.5, box.getSize(new THREE.Vector3()).length() / 2)
    } else {
      obj.getWorldPosition(center)
    }
    const dir = this.camera.position.clone().sub(this.orbit.target).normalize()
    if (dir.lengthSq() < 0.0001) dir.set(1, 0.7, -1).normalize()
    const dist = radius * 2.5
    this.focusAnim = {
      fromPos: this.camera.position.clone(),
      toPos: center.clone().add(dir.multiplyScalar(dist)),
      fromTgt: this.orbit.target.clone(),
      toTgt: center.clone(),
      t: 0,
    }
  }

  /* ---------------------------------- loop ---------------------------------- */

  private tick() {
    const st = useEditorStore.getState()
    const dt = this.clock.getDelta()

    if (st.mode === 'play') {
      for (const e of this.mixers.values()) e.mixer.update(dt)
      /* Unityの実行順: Update → (固定ステップ: FixedUpdate → 物理+イベント) → LateUpdate */
      this.scriptRuntime.update(dt)
      const FIXED = 1 / 50
      this.fixedAcc = Math.min(this.fixedAcc + dt, 0.2) // スパイラル防止
      while (this.fixedAcc >= FIXED) {
        this.fixedAcc -= FIXED
        this.scriptRuntime.fixedUpdate(FIXED)
        if (this.physicsWorld.active) {
          const events = this.physicsWorld.step(
            FIXED,
            (id) => this.objectMap.get(id),
            (id, worldPos, worldQuat) => this.writeWorldTransform(id, worldPos, worldQuat),
          )
          if (events.length > 0) this.scriptRuntime.dispatchCollisions(events)
        }
      }
      this.scriptRuntime.lateUpdate(dt)
      this.gameKeysDown.clear()
    }

    /* フライスルー移動 (右ドラッグ中 WASDQE / Shift=高速 / ホイール=速度) */
    if (this.fly) {
      const k = this.flyKeys
      const move = new THREE.Vector3(
        (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0),
        (k.has('e') ? 1 : 0) - (k.has('q') ? 1 : 0),
        (k.has('s') ? 1 : 0) - (k.has('w') ? 1 : 0),
      )
      if (move.lengthSq() > 0) {
        move.normalize().multiplyScalar(this.fly.speed * (k.has('shift') ? 4 : 1) * dt)
        move.applyQuaternion(this.camera.quaternion)
        this.camera.position.add(move)
      }
    }

    if (this.focusAnim && this.orbit) {
      this.focusAnim.t = Math.min(1, this.focusAnim.t + dt / 0.18)
      const k = easeOut(this.focusAnim.t)
      this.camera.position.lerpVectors(this.focusAnim.fromPos, this.focusAnim.toPos, k)
      this.orbit.target.lerpVectors(this.focusAnim.fromTgt, this.focusAnim.toTgt, k)
      if (this.focusAnim.t >= 1) this.focusAnim = null
    }

    if (!this.fly) this.orbit?.update()
    /* グリッド/空をカメラ追従 (グリッド模様はワールド座標基準なので継ぎ目なく無限に見える) */
    this.grid.position.set(Math.round(this.camera.position.x / 10) * 10, 0, Math.round(this.camera.position.z / 10) * 10)
    this.sky.position.copy(this.camera.position)
    for (const box of this.selectionBoxes.values()) box.update()
    ;(this.lightHelper as unknown as { update?: () => void })?.update?.()
    this.cameraHelper?.update()

    /* Sceneビュー (マウント中のみ) */
    if (this.renderer && this.mountEl) {
      const w = this.mountEl.clientWidth
      const h = this.mountEl.clientHeight
      this.renderer.setViewport(0, 0, w, h)
      this.renderer.setScissorTest(false)
      this.renderer.render(this.scene, this.camera)

      /* カメラ選択時のプレビュー (Unity の Camera Preview 相当) */
      const act = activeNodeId(st)
      const actObj = act ? this.objectMap.get(act) : null
      const previewCam = actObj?.userData.parts.camera
      if (previewCam && act && getComponent(st.scene.nodes[act], 'camera')) {
        const pw = Math.max(120, Math.floor(w * 0.24))
        const ph = Math.floor((pw * 9) / 16)
        this.renderClean(this.renderer, previewCam, { x: w - pw - 12, y: 12, w: pw, h: ph })
      }
    }

    /* Gameビュー: 最初の有効なカメラノードから描画 (D-020) */
    if (this.gameRenderer && this.gameMount) {
      const gw = Math.max(1, this.gameMount.clientWidth)
      const gh = Math.max(1, this.gameMount.clientHeight)
      const gameCam = this.findGameCamera(st)
      if (gameCam) {
        this.renderClean(this.gameRenderer, gameCam, { x: 0, y: 0, w: gw, h: gh })
      } else {
        this.gameRenderer.setClearColor(0x1e1e1e)
        this.gameRenderer.clear()
      }
    }
  }

  /** 物理シミュレーション結果 (ワールド変換) をローカル変換へ換算してストアに書き戻す */
  private writeWorldTransform(id: NodeId, worldPos: THREE.Vector3, worldQuat: THREE.Quaternion) {
    const st = useEditorStore.getState()
    const node = st.scene.nodes[id]
    const obj = this.objectMap.get(id)
    if (!node || !obj) return

    const local = new THREE.Matrix4().compose(worldPos, worldQuat, obj.getWorldScale(new THREE.Vector3()))
    if (obj.parent) {
      obj.parent.updateWorldMatrix(true, false)
      local.premultiply(obj.parent.matrixWorld.clone().invert())
    }
    const p = new THREE.Vector3()
    const q = new THREE.Quaternion()
    const s = new THREE.Vector3()
    local.decompose(p, q, s)
    const eu = new THREE.Euler().setFromQuaternion(q, 'YXZ')
    st.transientSetTransform(id, {
      position: { x: round6(p.x), y: round6(p.y), z: round6(p.z) },
      rotation: { x: round6(eu.x * RAD2DEG), y: round6(eu.y * RAD2DEG), z: round6(eu.z * RAD2DEG) },
      scale: node.transform.scale,
    })
  }

  /** シーン階層順で最初の有効カメラ (Unity の Game ビューカメラ相当) */
  private findGameCamera(st: EditorState): THREE.Camera | null {
    const walk = (ids: NodeId[]): THREE.Camera | null => {
      for (const id of ids) {
        const node = st.scene.nodes[id]
        if (!node || !node.visible) continue
        const comp = getComponent(node, 'camera')
        if (comp && comp.enabled !== false) {
          const cam = this.objectMap.get(id)?.userData.parts.camera
          if (cam) return cam
        }
        const found = walk(node.childrenIds)
        if (found) return found
      }
      return null
    }
    return walk(st.scene.rootIds)
  }

  /** エディタ専用表示 (グリッド/ギズモ/ヘルパー/アイコン/選択枠) を隠してカメラ視点を描画 */
  private renderClean(
    renderer: THREE.WebGLRenderer,
    camera: THREE.Camera,
    vp: { x: number; y: number; w: number; h: number },
  ) {
    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      const pc = camera as THREE.PerspectiveCamera
      pc.aspect = vp.w / vp.h
      pc.updateProjectionMatrix()
    }
    const hidden: Array<{ o: { visible: boolean }; was: boolean }> = []
    const hide = (o: { visible: boolean } | null | undefined) => {
      if (o) {
        hidden.push({ o, was: o.visible })
        o.visible = false
      }
    }
    hide(this.cameraHelper)
    hide(this.lightHelper as unknown as { visible: boolean } | null)
    hide(this.gizmo?.getHelper())
    hide(this.grid)
    for (const b of this.selectionBoxes.values()) hide(b)
    for (const d of this.decorations.values()) hide(d.sprite)

    const skyPos = this.sky.position.clone()
    camera.getWorldPosition(this.sky.position)
    const isSelf = renderer === this.renderer
    if (isSelf) {
      renderer.setScissorTest(true)
      renderer.setScissor(vp.x, vp.y, vp.w, vp.h)
    }
    renderer.setViewport(vp.x, vp.y, vp.w, vp.h)
    renderer.render(this.scene, camera)
    if (isSelf) renderer.setScissorTest(false)
    this.sky.position.copy(skyPos)

    for (const { o, was } of hidden) o.visible = was
  }

  dispose() {
    cancelAnimationFrame(this.rafId)
    this.unsubscribe?.()
    this.unmountDom()
    this.unmountGame()
    this.renderer?.dispose()
    this.renderer = null
    this.gameRenderer?.dispose()
    this.gameRenderer = null
  }
}

/* ---------------------------------- helpers ---------------------------------- */

const round6 = (n: number) => Math.round(n * 1e6) / 1e6
const round3 = (n: number) => Math.round(n * 1e3) / 1e3
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)

/**
 * Unity風シェーダグリッド。
 * GridHelper(長大なGL_LINES)はソフトウェアGL環境でクリッピング欠けが出るため、
 * クアッド+fwidthアンチエイリアスの手続きグリッドにする (実GPUでも距離フェードで見た目が良い)。
 */
function makeUnityGrid(): THREE.Mesh {
  const SIZE = 500
  const geo = new THREE.PlaneGeometry(SIZE, SIZE)
  geo.rotateX(-Math.PI / 2)
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      minorColor: { value: new THREE.Color('#5f5f5f') },
      majorColor: { value: new THREE.Color('#8b8b8b') },
      fadeDist: { value: 120.0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 minorColor; uniform vec3 majorColor; uniform float fadeDist;
      varying vec3 vWorld;
      float gridLine(vec2 p, float scale) {
        vec2 c = p / scale;
        vec2 g = abs(fract(c - 0.5) - 0.5) / fwidth(c);
        float line = min(g.x, g.y);
        return 1.0 - min(line, 1.0);
      }
      void main() {
        vec2 p = vWorld.xz;
        float minor = gridLine(p, 1.0);
        float major = gridLine(p, 10.0);
        float dist = distance(cameraPosition.xz, p);
        float fade = 1.0 - smoothstep(fadeDist * 0.45, fadeDist, dist);
        float alpha = max(minor * 0.30, major * 0.55) * fade;
        if (alpha < 0.003) discard;
        vec3 col = major > minor ? majorColor : minorColor;
        gl_FragColor = vec4(col, alpha);
        #include <colorspace_fragment>
      }
    `,
  })
  const grid = new THREE.Mesh(geo, mat)
  grid.userData.noPick = true
  grid.renderOrder = -500
  grid.frustumCulled = false
  return grid
}

function makeGradientSky(): THREE.Mesh {
  /* 半径は小さくてよい: 頂点シェーダで常に far 平面へ張り付け、位置はカメラ追従させる */
  const geo = new THREE.SphereGeometry(1, 24, 12)
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color('#4a6b8c') },
      horizon: { value: new THREE.Color('#96a0a9') },
      bottom: { value: new THREE.Color('#3d4145') },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position.z = gl_Position.w * 0.999999; // 常に最遠 (どの far 設定でも描ける)
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom;
      varying vec3 vDir;
      void main() {
        float y = vDir.y;
        /* 地平線上: 空グラデ / 下: Unity風フラットな暗いグラウンド */
        vec3 c = y > 0.0
          ? mix(horizon, top, pow(min(y * 1.6, 1.0), 0.8))
          : mix(horizon, bottom, min(-y * 18.0, 1.0));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }
    `,
  })
  const sky = new THREE.Mesh(geo, mat)
  sky.userData.noPick = true
  sky.frustumCulled = false
  sky.renderOrder = -1000
  return sky
}

/** シングルトン */
let engine: ThreeEngine | null = null
export function getEngine(): ThreeEngine {
  if (!engine) {
    engine = new ThreeEngine()
    /* E2E検証・デバッグ用フック */
    ;(window as unknown as { __engine: ThreeEngine }).__engine = engine
  }
  return engine
}
