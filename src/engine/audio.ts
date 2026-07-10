/**
 * オーディオ (D-032)。再生モード中のみ AudioSource コンポーネントを実体化する。
 * - AudioListener はアクティブな Game カメラへ自動付帯 (Unityのデフォルト構成相当)
 * - spatial=true は THREE.PositionalAudio (ノード追従・距離減衰) / false は 2D THREE.Audio
 * - ▶で playOnAwake を再生、⏸でAudioContext suspend、⏹で全停止・破棄
 * - 再生中の volume/loop 変更は SSoT 購読側から applyChanges で live 反映
 */
import * as THREE from 'three'
import type { AudioSourceComponent, NodeId, SceneNode } from '../types/scene'
import { getComponent } from '../types/scene'
import { getAsset } from './assets'

interface ActiveSource {
  nodeId: NodeId
  sound: THREE.Audio | THREE.PositionalAudio
  comp: AudioSourceComponent
}

export class AudioManager {
  readonly listener = new THREE.AudioListener()
  private active = new Map<NodeId, ActiveSource>()
  private oneShots: Array<THREE.Audio | THREE.PositionalAudio> = []
  private decodeCache = new Map<string, Promise<AudioBuffer | null>>()
  private listenerHost: THREE.Object3D | null = null

  get activeCount(): number {
    return this.active.size
  }

  isPlaying(nodeId: NodeId): boolean {
    return this.active.get(nodeId)?.sound.isPlaying ?? false
  }

  /** リスナーをカメラ (無ければエディタカメラ) に付け替える */
  attachListener(host: THREE.Object3D) {
    if (this.listenerHost === host) return
    this.listener.removeFromParent()
    host.add(this.listener)
    this.listenerHost = host
  }

  private decode(assetId: string): Promise<AudioBuffer | null> {
    let p = this.decodeCache.get(assetId)
    if (!p) {
      const buf = getAsset(assetId)?.buffer
      p = buf
        ? this.listener.context.decodeAudioData(buf.slice(0)).catch(() => null)
        : Promise.resolve(null)
      this.decodeCache.set(assetId, p)
    }
    return p
  }

  /** ▶: playOnAwake なソースを起動 */
  start(
    nodes: Record<NodeId, SceneNode>,
    objectFor: (id: NodeId) => THREE.Object3D | undefined,
    log: (level: 'warn' | 'info', msg: string) => void,
  ) {
    void this.listener.context.resume()
    for (const id in nodes) {
      const comp = getComponent(nodes[id], 'audiosource')
      if (!comp || comp.enabled === false || !comp.playOnAwake) continue
      if (!isChainVisible(nodes, id)) continue
      if (!comp.assetId) {
        log('warn', `'${nodes[id].name}' AudioSource has no clip assigned`)
        continue
      }
      void this.play(id, comp, objectFor)
    }
  }

  /** 個別ソースの (再)生成と再生 */
  private async play(id: NodeId, comp: AudioSourceComponent, objectFor: (id: NodeId) => THREE.Object3D | undefined) {
    const buffer = await this.decode(comp.assetId!)
    const obj = objectFor(id)
    if (!buffer || !obj || this.active.has(id)) return
    const sound = comp.spatial ? new THREE.PositionalAudio(this.listener) : new THREE.Audio(this.listener)
    sound.setBuffer(buffer)
    this.applyProps(sound, comp)
    if (comp.spatial) obj.add(sound)
    sound.play()
    this.active.set(id, { nodeId: id, sound, comp })
  }

  private applyProps(sound: THREE.Audio | THREE.PositionalAudio, comp: AudioSourceComponent) {
    sound.setVolume(comp.volume)
    sound.setLoop(comp.loop)
    if (sound instanceof THREE.PositionalAudio) {
      sound.setRefDistance(Math.max(0.01, comp.minDistance))
      sound.setMaxDistance(Math.max(comp.minDistance + 0.01, comp.maxDistance))
      sound.setDistanceModel('linear')
    }
  }

  /** 再生中の volume/loop 等の live 反映 (SSoT変更の購読側から呼ぶ) */
  applyChanges(nodes: Record<NodeId, SceneNode>) {
    for (const [id, src] of this.active) {
      const node = nodes[id]
      const comp = node ? getComponent(node, 'audiosource') : undefined
      if (!comp) continue
      if (comp !== src.comp) {
        this.applyProps(src.sound, comp)
        src.comp = comp
      }
    }
  }

  /** ワンショット再生 (ctx.playSound)。atObj 指定時はその位置から3D再生 */
  async playOneShot(assetId: string, volume: number, atObj?: THREE.Object3D | null) {
    const buffer = await this.decode(assetId)
    if (!buffer) return false
    const sound = atObj ? new THREE.PositionalAudio(this.listener) : new THREE.Audio(this.listener)
    sound.setBuffer(buffer)
    sound.setVolume(volume)
    sound.setLoop(false)
    if (atObj) atObj.add(sound)
    sound.onEnded = () => {
      sound.removeFromParent()
      this.oneShots = this.oneShots.filter((s) => s !== sound)
    }
    sound.play()
    this.oneShots.push(sound)
    return true
  }

  suspend() {
    void this.listener.context.suspend()
  }

  resume() {
    void this.listener.context.resume()
  }

  /** ⏹: 全停止・破棄 */
  stopAll() {
    for (const { sound } of this.active.values()) {
      if (sound.isPlaying) sound.stop()
      sound.removeFromParent()
    }
    for (const s of this.oneShots) {
      if (s.isPlaying) s.stop()
      s.removeFromParent()
    }
    this.active.clear()
    this.oneShots = []
    void this.listener.context.resume() // 次回再生に備える
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
