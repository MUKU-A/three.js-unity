/**
 * アセット(GLB/テクスチャ)のバイナリ実体と読み込み済みリソースの保管庫。
 * ストアには AssetMeta のみ置き、実体はここで管理する (シリアライズは serialization.ts)。
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { AssetMeta, AssetType } from '../types/scene'
import { newId } from '../types/scene'

/** GLB/FBX/OBJ 共通のモデルテンプレート (配置時に clone する) */
export interface ModelAsset {
  scene: THREE.Group
  animations: THREE.AnimationClip[]
}

export interface AssetData {
  meta: AssetMeta
  buffer: ArrayBuffer
  /** texture 用 */
  objectUrl?: string
  texture?: THREE.Texture
  /** モデル (glb/fbx/obj) 用 */
  model?: ModelAsset
}

export const isModelType = (t: AssetType) => t === 'glb' || t === 'fbx' || t === 'obj'

const registry = new Map<string, AssetData>()
const gltfLoader = new GLTFLoader()

export const getAsset = (id: string | null | undefined): AssetData | undefined =>
  id ? registry.get(id) : undefined

export function removeAsset(id: string) {
  const a = registry.get(id)
  if (a?.objectUrl) URL.revokeObjectURL(a.objectUrl)
  a?.texture?.dispose()
  registry.delete(id)
}

export function allAssets(): AssetData[] {
  return [...registry.values()]
}

function detectType(name: string): AssetType | null {
  if (/\.(glb|gltf)$/i.test(name)) return 'glb'
  if (/\.fbx$/i.test(name)) return 'fbx'
  if (/\.obj$/i.test(name)) return 'obj'
  if (/\.prefab$/i.test(name)) return 'prefab'
  if (/\.(png|jpe?g|webp|bmp|gif)$/i.test(name)) return 'texture'
  return null
}

async function parseModel(type: AssetType, buffer: ArrayBuffer): Promise<ModelAsset> {
  if (type === 'glb') {
    return new Promise((resolve, reject) => {
      gltfLoader.parse(
        buffer.slice(0),
        '',
        (gltf) => resolve({ scene: gltf.scene, animations: gltf.animations ?? [] }),
        reject,
      )
    })
  }
  if (type === 'fbx') {
    const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js')
    const group = new FBXLoader().parse(buffer.slice(0), '')
    return { scene: group, animations: group.animations ?? [] }
  }
  /* obj (アニメーションなし) */
  const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js')
  const group = new OBJLoader().parse(new TextDecoder().decode(buffer))
  return { scene: group, animations: [] }
}

async function loadTexture(buffer: ArrayBuffer, mime: string): Promise<{ texture: THREE.Texture; url: string }> {
  const blob = new Blob([buffer], { type: mime })
  const url = URL.createObjectURL(blob)
  const texture = await new THREE.TextureLoader().loadAsync(url)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  return { texture, url }
}

const mimeFor = (name: string) =>
  /\.png$/i.test(name) ? 'image/png' : /\.webp$/i.test(name) ? 'image/webp' : 'image/jpeg'

/** File/ArrayBuffer からアセット登録 (Project パネルのインポート) */
export async function importAsset(name: string, buffer: ArrayBuffer, forcedId?: string): Promise<AssetMeta> {
  const type = detectType(name)
  if (!type) throw new Error(`Unsupported asset type: ${name}`)
  const id = forcedId ?? newId()
  const meta: AssetMeta = { id, name, type, size: buffer.byteLength }
  const data: AssetData = { meta, buffer }

  if (isModelType(type)) {
    data.model = await parseModel(type, buffer)
  } else if (type === 'texture') {
    const { texture, url } = await loadTexture(buffer, mimeFor(name))
    data.texture = texture
    data.objectUrl = url
  }
  /* prefab はJSONバイナリのまま保持 (getPrefabNodes でパース) */
  registry.set(id, data)
  return meta
}

/* ---------------------------------- Prefab (D-029) ---------------------------------- */

import type { SceneNode } from '../types/scene'

/** サブツリー(nodes[0]=ルート)をプレハブアセットとして登録 */
export function createPrefabAsset(name: string, nodes: SceneNode[]): AssetMeta {
  const id = newId()
  const buffer = new TextEncoder().encode(JSON.stringify(nodes)).buffer as ArrayBuffer
  const meta: AssetMeta = { id, name: name.endsWith('.prefab') ? name : `${name}.prefab`, type: 'prefab', size: buffer.byteLength }
  registry.set(id, { meta, buffer })
  return meta
}

/** プレハブのテンプレートノード群を取得 (毎回パースした新しいオブジェクトを返す) */
export function getPrefabNodes(id: string): SceneNode[] | null {
  const a = registry.get(id)
  if (!a || a.meta.type !== 'prefab') return null
  try {
    return JSON.parse(new TextDecoder().decode(a.buffer)) as SceneNode[]
  } catch {
    return null
  }
}

/** Apply: プレハブアセットの内容を更新 */
export function updatePrefabAsset(id: string, nodes: SceneNode[]): boolean {
  const a = registry.get(id)
  if (!a || a.meta.type !== 'prefab') return false
  a.buffer = new TextEncoder().encode(JSON.stringify(nodes)).buffer as ArrayBuffer
  a.meta = { ...a.meta, size: a.buffer.byteLength }
  return true
}

export async function importFile(file: File): Promise<AssetMeta> {
  const buffer = await file.arrayBuffer()
  return importAsset(file.name, buffer)
}

export function clearAssets() {
  for (const id of [...registry.keys()]) removeAsset(id)
}

/* ---------------------------------- base64 ---------------------------------- */

export function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function base64ToBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}
