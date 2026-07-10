/* テスト用GLB生成 (Node上でGLTFExporterを実行) */
// GLTFExporterが使うFileReaderの最小ポリフィル
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((ab) => {
      this.result = ab
      this.onloadend?.({ target: this })
      this.onload?.({ target: this })
    })
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((ab) => {
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(ab).toString('base64')}`
      this.onloadend?.({ target: this })
      this.onload?.({ target: this })
    })
  }
}
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { writeFileSync } from 'node:fs'

const scene = new THREE.Scene()
const mesh = new THREE.Mesh(
  new THREE.TorusKnotGeometry(0.5, 0.18, 64, 12),
  new THREE.MeshStandardMaterial({ color: 0x2288ff, roughness: 0.3, metalness: 0.6 }),
)
mesh.name = 'TestKnot'
scene.add(mesh)

const exporter = new GLTFExporter()
const ab = await exporter.parseAsync(scene, { binary: true })
writeFileSync(new URL('./out/test-model.glb', import.meta.url).pathname, Buffer.from(ab))
console.log('wrote test-model.glb', ab.byteLength, 'bytes')

/* テスト用テクスチャPNG (8x8 チェッカー) も生成 */
const png = Buffer.from(
  // 最小PNG: zlib非圧縮の8x8白黒チェッカーを事前生成済みbase64で埋め込み
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAKElEQVR4nGP8//8/AzGAiShVDAwMDP///2fEqRLZJKzKMd2AUzk+lQBhchP1sSHYzgAAAABJRU5ErkJggg==',
  'base64',
)
writeFileSync(new URL('./out/test-tex.png', import.meta.url).pathname, png)
console.log('wrote test-tex.png', png.length, 'bytes')
