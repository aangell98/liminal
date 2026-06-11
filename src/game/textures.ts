import * as THREE from 'three'

function newCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = c.height = size
  return [c, c.getContext('2d')!]
}

function clamp(v: number) {
  return v < 0 ? 0 : v > 255 ? 255 : v
}

function addGrain(ctx: CanvasRenderingContext2D, size: number, amount: number) {
  const img = ctx.getImageData(0, 0, size, size)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 2 * amount
    d[i] = clamp(d[i] + n)
    d[i + 1] = clamp(d[i + 1] + n)
    d[i + 2] = clamp(d[i + 2] + n)
  }
  ctx.putImageData(img, 0, 0)
}

function finish(canvas: HTMLCanvasElement): THREE.Texture {
  const t = new THREE.CanvasTexture(canvas)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

// Mono-yellow wallpaper with faint vertical damask stripes — the Backrooms staple.
// Bright, saturated mustard so it reads luminous under the flat fill light.
export function makeWallpaper(): THREE.Texture {
  const size = 256
  const [c, ctx] = newCanvas(size)
  ctx.fillStyle = '#ccb94f'
  ctx.fillRect(0, 0, size, size)
  for (let x = 0; x < size; x += 16) {
    ctx.fillStyle = 'rgba(0,0,0,0.045)'
    ctx.fillRect(x, 0, 2, size)
    ctx.fillStyle = 'rgba(255,255,255,0.05)'
    ctx.fillRect(x + 8, 0, 2, size)
  }
  addGrain(ctx, size, 9)
  return finish(c)
}

// Damp, dark brown office carpet with subtle fibre rows — much darker than the
// walls so the floor grounds the bright yellow (true to the source image).
export function makeCarpet(): THREE.Texture {
  const size = 256
  const [c, ctx] = newCanvas(size)
  ctx.fillStyle = '#695931'
  ctx.fillRect(0, 0, size, size)
  for (let y = 0; y < size; y += 6) {
    ctx.fillStyle = 'rgba(0,0,0,0.05)'
    ctx.fillRect(0, y, size, 3)
  }
  addGrain(ctx, size, 16)
  return finish(c)
}

// Plain drop-ceiling panels (the bright fluorescent fixtures are now real lit
// meshes in Fixtures.tsx, not painted into this texture).
export function makeCeiling(): THREE.Texture {
  const size = 256
  const half = size / 2
  const [c, ctx] = newCanvas(size)
  ctx.fillStyle = '#c2ba93'
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = '#d2caa4'
  for (let gx = 0; gx < 2; gx++)
    for (let gy = 0; gy < 2; gy++)
      ctx.fillRect(gx * half + 6, gy * half + 6, half - 12, half - 12)
  ctx.strokeStyle = 'rgba(0,0,0,0.32)'
  ctx.lineWidth = 3
  for (let i = 0; i <= 2; i++) {
    ctx.beginPath(); ctx.moveTo(i * half, 0); ctx.lineTo(i * half, size); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, i * half); ctx.lineTo(size, i * half); ctx.stroke()
  }
  addGrain(ctx, size, 6)
  return finish(c)
}
