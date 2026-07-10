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
import { getComponent } from '../types/scene'
import { getAsset } from './assets'
import { createIconSprite, createPickProxy, type IconKind } from './icons'
import { createContainer, DEG2RAD, disposeObject, RAD2DEG, updateContainer, type NodeContainer } from './objectFactory'

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
  private readonly mixers = new Map<NodeId, THREE.AnimationMixer>()

  private dragBefore: Transform | null = null
  private focusAnim: { fromPos: THREE.Vector3; toPos: THREE.Vector3; fromTgt: THREE.Vector3; toTgt: THREE.Vector3; t: number } | null = null
  private unsubscribe: (() => void) | null = null

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

    /* 初期同期 + 購読開始 */
    this.applyState(useEditorStore.getState(), null)
    this.unsubscribe = useEditorStore.subscribe((s, prev) => this.applyState(s, prev))
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

    /* OrbitControls: 左=オービット / 右=パン / ホイール=ズーム (D-009) */
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement)
    this.orbit.enableDamping = false
    this.orbit.target.set(0, 0, 0)

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

    cancelAnimationFrame(this.rafId)
    const loop = () => {
      this.rafId = requestAnimationFrame(loop)
      this.tick()
    }
    loop()
  }

  private unmountDom() {
    cancelAnimationFrame(this.rafId)
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
    if (!prev || s.focusRequestId !== prev.focusRequestId) {
      if (prev) this.focusSelection(s)
    }
    if (!prev || s.mode !== prev.mode) this.syncPlayMode(s)
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
    if (clips && clips.length > 0 && meshRoot) {
      const mixer = new THREE.AnimationMixer(meshRoot)
      clips.forEach((c) => mixer.clipAction(c).play())
      this.mixers.set(id, mixer)
    }
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
  }

  /* ---------------------------------- play mode ---------------------------------- */

  private syncPlayMode(s: EditorState) {
    if (s.mode === 'play') this.clock.start()
    // mixers は tick 内で mode を見て進める。stop 時のシーン復元は reconcileNodes が担う
  }

  /* ---------------------------------- picking ---------------------------------- */

  private raycaster = new THREE.Raycaster()
  private downPos: { x: number; y: number; button: number } | null = null

  private bindPointer(el: HTMLElement) {
    el.addEventListener('pointerdown', (e) => {
      this.downPos = { x: e.clientX, y: e.clientY, button: e.button }
    })
    el.addEventListener('pointerup', (e) => {
      const down = this.downPos
      this.downPos = null
      if (!down || down.button !== 0 || e.button !== 0) return
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return // ドラッグはオービット
      if (this.gizmo?.dragging || this.gizmo?.axis) return // ギズモ操作中
      this.pick(e)
    })
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

      if (asset.meta.type === 'glb') {
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
    if (!this.renderer || !this.mountEl) return
    const st = useEditorStore.getState()
    const dt = this.clock.getDelta()

    if (st.mode === 'play') {
      for (const mixer of this.mixers.values()) mixer.update(dt)
    }

    if (this.focusAnim && this.orbit) {
      this.focusAnim.t = Math.min(1, this.focusAnim.t + dt / 0.18)
      const k = easeOut(this.focusAnim.t)
      this.camera.position.lerpVectors(this.focusAnim.fromPos, this.focusAnim.toPos, k)
      this.orbit.target.lerpVectors(this.focusAnim.fromTgt, this.focusAnim.toTgt, k)
      if (this.focusAnim.t >= 1) this.focusAnim = null
    }

    this.orbit?.update()
    /* グリッド/空をカメラ追従 (グリッド模様はワールド座標基準なので継ぎ目なく無限に見える) */
    this.grid.position.set(Math.round(this.camera.position.x / 10) * 10, 0, Math.round(this.camera.position.z / 10) * 10)
    this.sky.position.copy(this.camera.position)
    for (const box of this.selectionBoxes.values()) box.update()
    ;(this.lightHelper as unknown as { update?: () => void })?.update?.()
    this.cameraHelper?.update()

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
      const px = w - pw - 12
      const py = 12
      if ((previewCam as THREE.PerspectiveCamera).isPerspectiveCamera) {
        const pc = previewCam as THREE.PerspectiveCamera
        pc.aspect = pw / ph
        pc.updateProjectionMatrix()
      }
      const helperWasVisible = this.cameraHelper?.visible ?? false
      if (this.cameraHelper) this.cameraHelper.visible = false
      const gizmoHelper = this.gizmo?.getHelper()
      const gizmoWasVisible = gizmoHelper?.visible ?? false
      if (gizmoHelper) gizmoHelper.visible = false
      const gridWas = this.grid.visible
      this.grid.visible = false
      const boxesWere: boolean[] = []
      for (const b of this.selectionBoxes.values()) {
        boxesWere.push(b.visible)
        b.visible = false
      }
      const decosWere: boolean[] = []
      for (const d of this.decorations.values()) {
        decosWere.push(d.sprite.visible)
        d.sprite.visible = false
      }

      /* 空はプレビューカメラ位置へ移して描く (BackSide球の内側に入れる) */
      const skyPos = this.sky.position.clone()
      previewCam.getWorldPosition(this.sky.position)
      this.renderer.setScissorTest(true)
      this.renderer.setScissor(px, py, pw, ph)
      this.renderer.setViewport(px, py, pw, ph)
      this.renderer.render(this.scene, previewCam)
      this.renderer.setScissorTest(false)
      this.sky.position.copy(skyPos)

      if (this.cameraHelper) this.cameraHelper.visible = helperWasVisible
      if (gizmoHelper) gizmoHelper.visible = gizmoWasVisible
      this.grid.visible = gridWas
      let i = 0
      for (const b of this.selectionBoxes.values()) b.visible = boxesWere[i++]
      i = 0
      for (const d of this.decorations.values()) d.sprite.visible = decosWere[i++]
    }
  }

  dispose() {
    this.unsubscribe?.()
    this.unmountDom()
    this.renderer?.dispose()
    this.renderer = null
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
