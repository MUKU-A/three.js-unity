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

/* アニメーションClip付きGLB (spin / bob の2クリップ) */
const q0 = new THREE.Quaternion()
const q1 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI)
const spin = new THREE.AnimationClip('spin', 2, [
  new THREE.QuaternionKeyframeTrack('.quaternion', [0, 1, 2], [...q0.toArray(), ...q1.toArray(), ...q0.toArray()]),
])
const bob = new THREE.AnimationClip('bob', 1, [
  new THREE.VectorKeyframeTrack('.position', [0, 0.5, 1], [0, 0, 0, 0, 1, 0, 0, 0, 0]),
])
const animScene = new THREE.Scene()
const animMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xff8800 }))
animMesh.name = 'AnimBox'
animScene.add(animMesh)
const ab2 = await exporter.parseAsync(animScene, { binary: true, animations: [spin, bob] })
writeFileSync(new URL('./out/test-anim.glb', import.meta.url).pathname, Buffer.from(ab2))
console.log('wrote test-anim.glb', ab2.byteLength, 'bytes')

/* OBJ (三角形1枚) */
writeFileSync(new URL('./out/test-tri.obj', import.meta.url).pathname, 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n')
console.log('wrote test-tri.obj')

/* WAV (0.4秒 440Hz サイン波, 22050Hz 16bit mono) */
{
  const sr = 22050
  const n = Math.floor(sr * 0.4)
  const data = Buffer.alloc(n * 2)
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / sr) * 12000), i * 2)
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + data.length, 4)
  h.write('WAVEfmt ', 8)
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20) // PCM
  h.writeUInt16LE(1, 22) // mono
  h.writeUInt32LE(sr, 24)
  h.writeUInt32LE(sr * 2, 28)
  h.writeUInt16LE(2, 32)
  h.writeUInt16LE(16, 34)
  h.write('data', 36)
  h.writeUInt32LE(data.length, 40)
  writeFileSync(new URL('./out/test-tone.wav', import.meta.url).pathname, Buffer.concat([h, data]))
  console.log('wrote test-tone.wav', 44 + data.length, 'bytes')
}

/* テスト用テクスチャPNG (8x8 チェッカー) も生成 */
const png = Buffer.from(
  // 最小PNG: zlib非圧縮の8x8白黒チェッカーを事前生成済みbase64で埋め込み
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAKElEQVR4nGP8//8/AzGAiShVDAwMDP///2fEqRLZJKzKMd2AUzk+lQBhchP1sSHYzgAAAABJRU5ErkJggg==',
  'base64',
)
writeFileSync(new URL('./out/test-tex.png', import.meta.url).pathname, png)
console.log('wrote test-tex.png', png.length, 'bytes')
