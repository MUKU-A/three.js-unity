/**
 * Project パネル: アセット (GLB/テクスチャ) のインポート・一覧・Viewport への DnD。
 * RunPod/ComfyUI パイプライン等で生成した GLB の取り込み口 (Import ボタン / ここへの直接ドロップ)。
 */
import { useRef, useState } from 'react'
import { Box, FileUp, Image as ImageIcon, Package, Trash2 } from 'lucide-react'
import { useEditorStore, cmdAddObject, makeGlbNode } from '../../store/editorStore'
import { getAsset, importFile, removeAsset } from '../../engine/assets'
import { instantiatePrefab } from '../../store/actions'
import { useContextMenu } from '../common/ContextMenu'

export function ProjectPanel() {
  const assets = useEditorStore((s) => s.assets)
  const [selected, setSelected] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const menu = useContextMenu()
  const st = useEditorStore.getState

  const doImport = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      try {
        const meta = await importFile(file)
        st().setAssets([...st().assets, meta])
        st().log('info', `Imported asset '${meta.name}' (${(meta.size / 1024).toFixed(1)} KB)`)
      } catch (err) {
        st().log('error', `Import failed for '${file.name}': ${String(err)}`)
      }
    }
  }

  const deleteAsset = (id: string) => {
    removeAsset(id)
    st().setAssets(st().assets.filter((a) => a.id !== id))
  }

  return (
    <div
      className={`h-full flex flex-col bg-u-list ${dragOver ? 'outline outline-1 -outline-offset-1 outline-u-accent' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragOver(true)
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        setDragOver(false)
        if (e.dataTransfer.files.length > 0) {
          e.preventDefault()
          void doImport(e.dataTransfer.files)
        }
      }}
    >
      {/* ツールバー */}
      <div className="flex items-center gap-1 px-1 h-[24px] bg-u-toolbar border-b border-u-border flex-none">
        <button className="u-btn !h-[18px] !px-2 text-[11px]" onClick={() => fileRef.current?.click()}>
          <FileUp size={11} />
          Import
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".glb,.gltf,.fbx,.obj,.png,.jpg,.jpeg,.webp"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void doImport(e.target.files)
            e.target.value = ''
          }}
        />
        <span className="text-u-sub text-[11px] px-1">Assets</span>
        <div className="flex-1" />
        <span className="text-u-sub text-[11px] px-1">{assets.length} items</span>
      </div>

      {/* アセットグリッド */}
      <div className="flex-1 overflow-y-auto p-2" onClick={() => setSelected(null)}>
        {assets.length === 0 ? (
          <div className="h-full flex items-center justify-center text-u-sub text-center leading-5">
            Drop GLB / texture files here
            <br />
            or use Import
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-2">
            {assets.map((a) => (
              <AssetTile
                key={a.id}
                id={a.id}
                selected={selected === a.id}
                onSelect={(e) => {
                  e.stopPropagation()
                  setSelected(a.id)
                }}
                onContext={(e) => {
                  setSelected(a.id)
                  menu.open(e, [
                    {
                      label: 'Add to Scene',
                      disabled: a.type === 'texture',
                      onClick: () => {
                        if (a.type === 'prefab') {
                          instantiatePrefab(a.id)
                        } else {
                          st().execute(cmdAddObject([makeGlbNode(a.id, a.name)], null))
                        }
                        st().log('info', `Placed '${a.name}' in scene`)
                      },
                    },
                    { separator: true },
                    { label: 'Delete', onClick: () => deleteAsset(a.id) },
                  ])
                }}
              />
            ))}
          </div>
        )}
      </div>
      {menu.element}
      {selected && (
        <div className="h-[20px] flex items-center px-2 gap-2 border-t border-u-border bg-u-toolbar text-u-sub flex-none">
          <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
            {assets.find((a) => a.id === selected)?.name}
          </span>
          <button className="u-toolbtn !w-[20px] !h-[16px]" title="Delete asset" onClick={() => deleteAsset(selected)}>
            <Trash2 size={11} />
          </button>
        </div>
      )}
    </div>
  )
}

function AssetTile({
  id,
  selected,
  onSelect,
  onContext,
}: {
  id: string
  selected: boolean
  onSelect: (e: React.MouseEvent) => void
  onContext: (e: React.MouseEvent) => void
}) {
  const meta = useEditorStore((s) => s.assets.find((a) => a.id === id))
  if (!meta) return null
  const data = getAsset(id)

  return (
    <div
      className={`flex flex-col items-center gap-1 p-1 rounded-[3px] ${selected ? 'bg-u-select' : 'hover:bg-white/5'}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-unitythree-asset', id)
        e.dataTransfer.effectAllowed = 'copy'
      }}
      onMouseDown={onSelect}
      onContextMenu={onContext}
      title={`${meta.name} — drag into Scene view`}
    >
      <div className="w-[52px] h-[52px] rounded-[2px] bg-u-darker border border-u-border flex items-center justify-center overflow-hidden">
        {meta.type === 'texture' && data?.objectUrl ? (
          <img src={data.objectUrl} className="w-full h-full object-cover" draggable={false} />
        ) : meta.type === 'texture' ? (
          <ImageIcon size={22} className="text-u-sub" />
        ) : meta.type === 'prefab' ? (
          <Box size={24} className="text-[#8ab8e8]" />
        ) : (
          <Package size={24} className="text-[#8fb6d9]" />
        )}
      </div>
      <span className={`text-[10px] leading-3 text-center break-all line-clamp-2 ${selected ? 'text-white' : 'text-u-label'}`}>
        {meta.name}
      </span>
    </div>
  )
}
