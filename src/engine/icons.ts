/**
 * Sceneビュー内のギズモアイコン (Unityのライト/カメラ アイコン相当)。
 * 権利ガードのため独自にcanvas描画する簡易ラインアイコン。
 */
import * as THREE from 'three'

export type IconKind = 'sun' | 'bulb' | 'spot' | 'camera'

const cache = new Map<IconKind, THREE.Texture>()

function draw(kind: IconKind): THREE.Texture {
  const cached = cache.get(kind)
  if (cached) return cached

  const S = 64
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = S
  const ctx = canvas.getContext('2d')!
  ctx.strokeStyle = 'rgba(220,220,220,0.9)'
  ctx.fillStyle = 'rgba(220,220,220,0.12)'
  ctx.lineWidth = 3.5
  ctx.lineCap = 'round'
  const c = S / 2

  switch (kind) {
    case 'sun': {
      ctx.beginPath()
      ctx.arc(c, c, 11, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2
        ctx.beginPath()
        ctx.moveTo(c + Math.cos(a) * 17, c + Math.sin(a) * 17)
        ctx.lineTo(c + Math.cos(a) * 25, c + Math.sin(a) * 25)
        ctx.stroke()
      }
      break
    }
    case 'bulb': {
      ctx.beginPath()
      ctx.arc(c, c - 4, 13, Math.PI * 0.85, Math.PI * 0.15)
      ctx.lineTo(c + 7, c + 14)
      ctx.lineTo(c - 7, c + 14)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(c - 6, c + 19)
      ctx.lineTo(c + 6, c + 19)
      ctx.stroke()
      break
    }
    case 'spot': {
      ctx.beginPath()
      ctx.moveTo(c - 6, c - 16)
      ctx.lineTo(c + 6, c - 16)
      ctx.lineTo(c + 15, c + 10)
      ctx.lineTo(c - 15, c + 10)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      ctx.beginPath()
      ctx.ellipse(c, c + 14, 15, 5, 0, 0, Math.PI * 2)
      ctx.stroke()
      break
    }
    case 'camera': {
      ctx.beginPath()
      ctx.roundRect(c - 17, c - 9, 22, 20, 3)
      ctx.fill()
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(c + 5, c - 1)
      ctx.lineTo(c + 17, c - 9)
      ctx.lineTo(c + 17, c + 11)
      ctx.lineTo(c + 5, c + 3)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      break
    }
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  cache.set(kind, tex)
  return tex
}

/** 定サイズ表示のアイコンスプライト (描画専用、ピッキングは別プロキシ) */
export function createIconSprite(kind: IconKind): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({
    map: draw(kind),
    sizeAttenuation: false,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  })
  const sprite = new THREE.Sprite(mat)
  sprite.scale.setScalar(0.032)
  sprite.renderOrder = 900
  sprite.userData.noPick = true
  return sprite
}

/** ライト/カメラ/空ノードをクリック選択可能にする不可視プロキシ */
export function createPickProxy(): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(0.4, 8, 6),
    new THREE.MeshBasicMaterial(),
  )
  m.visible = false // レンダリングはスキップされるがレイキャストには乗る
  m.userData.pickProxy = true
  return m
}
