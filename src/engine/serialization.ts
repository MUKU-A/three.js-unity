/**
 * シーンの JSON エクスポート / インポート (D-011)。
 * 正規化構造 {version, name, nodes, rootIds, assets[]} — 将来の Supabase 保存は
 * assets を Storage 参照に差し替えるだけでよい。
 */
import type { SerializedScene } from '../types/scene'
import { useEditorStore } from '../store/editorStore'
import { base64ToBuffer, bufferToBase64, clearAssets, getAsset, importAsset } from './assets'

export function serializeScene(): SerializedScene {
  const s = useEditorStore.getState()
  return {
    version: 1,
    type: 'unitythree-scene',
    name: s.scene.name,
    nodes: structuredClone(s.scene.nodes),
    rootIds: [...s.scene.rootIds],
    assets: s.assets.map((meta) => ({
      ...meta,
      dataBase64: bufferToBase64(getAsset(meta.id)?.buffer ?? new ArrayBuffer(0)),
    })),
  }
}

export function exportSceneToFile() {
  const s = useEditorStore.getState()
  const data = JSON.stringify(serializeScene())
  const blob = new Blob([data], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${s.scene.name || 'scene'}.unity3.json`
  a.click()
  URL.revokeObjectURL(url)
  s.log('info', `Scene '${s.scene.name}' saved (${(data.length / 1024).toFixed(1)} KB)`)
}

export async function importSceneFromJson(json: string) {
  const store = useEditorStore.getState()
  let parsed: SerializedScene
  try {
    parsed = JSON.parse(json)
  } catch {
    store.log('error', 'Failed to load scene: invalid JSON')
    return
  }
  if (parsed.type !== 'unitythree-scene' || parsed.version !== 1 || !parsed.nodes || !parsed.rootIds) {
    store.log('error', 'Failed to load scene: not a UnityThree scene file')
    return
  }

  /* アセットを先に復元してから scene を置換 (エンジンの再構築時に参照解決させる) */
  clearAssets()
  const metas = []
  for (const a of parsed.assets ?? []) {
    try {
      metas.push(await importAsset(a.name, base64ToBuffer(a.dataBase64), a.id))
    } catch (err) {
      store.log('error', `Failed to load asset '${a.name}': ${String(err)}`)
    }
  }
  store.replaceScene({ name: parsed.name || 'Scene', nodes: parsed.nodes, rootIds: parsed.rootIds }, metas)
  store.log('info', `Scene '${parsed.name}' loaded — ${Object.keys(parsed.nodes).length} objects, ${metas.length} assets`)
}

export function openSceneFilePicker() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json,application/json'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (file) await importSceneFromJson(await file.text())
  }
  input.click()
}
