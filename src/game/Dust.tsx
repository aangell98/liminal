import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { worldFx } from './retro'
const COUNT = 450
const FIELD = 16 // size of the world-space box of dust kept around the player
const ROOM_H = 3.2 // keep motes between floor and ceiling
const DEBRIS = 150 // one-shot motes shaken from the ceiling by a distant bang
const DEBRIS_R = 7 // spawn radius around the player
const DEBRIS_LIFE = 2.8

// Floating dust motes: faint warm specks that hang in the air. They live in WORLD
// space (additive blend, slow drift) and only wrap around the player so coverage
// is maintained — so as you move and turn they drift past you with real parallax
// instead of riding along with the camera.
export function Dust() {
  const { camera } = useThree()
  const ref = useRef<THREE.Points>(null!)

  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const pos = new Float32Array(COUNT * 3)
    for (let i = 0; i < COUNT; i++) {
      pos[i * 3] = (Math.random() - 0.5) * FIELD
      pos[i * 3 + 1] = Math.random() * ROOM_H
      pos[i * 3 + 2] = (Math.random() - 0.5) * FIELD
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    return g
  }, [])

  const sprite = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = c.height = 64
    const ctx = c.getContext('2d')!
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    g.addColorStop(0.0, 'rgba(255,255,255,1)')
    g.addColorStop(0.25, 'rgba(255,255,255,0.45)')
    g.addColorStop(1.0, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 64, 64)
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [])

  const mat = useMemo(
    () =>
      new THREE.PointsMaterial({
        map: sprite,
        color: '#fff3cf',
        size: 0.04,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      }),
    [sprite],
  )

  // Falling-debris burst: motes shaken from the ceiling when a distant bang hits.
  // Idle below the floor; on each worldFx.bangSeq edge they're scattered up near the
  // ceiling around the player and rain down with gravity, fading out as a group.
  const debrisRef = useRef<THREE.Points>(null!)
  const debrisVel = useRef(new Float32Array(DEBRIS * 3))
  const debrisLife = useRef(new Float32Array(DEBRIS))
  const lastSeq = useRef(0)
  const burstAge = useRef(Infinity)

  const debrisGeom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const pos = new Float32Array(DEBRIS * 3)
    for (let i = 0; i < DEBRIS; i++) pos[i * 3 + 1] = -100 // parked far below the floor
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    return g
  }, [])

  const debrisMat = useMemo(
    () =>
      new THREE.PointsMaterial({
        map: sprite,
        color: '#fbeccb',
        size: 0.06,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      }),
    [sprite],
  )

  useFrame((_, delta) => {
    const cx = camera.position.x
    const cz = camera.position.z
    const H = FIELD / 2
    const arr = geom.attributes.position.array as Float32Array
    for (let i = 0; i < arr.length; i += 3) {
      // Slow upward drift + a gentle horizontal sway, all in world space.
      arr[i + 1] += delta * 0.05
      arr[i] += Math.sin((arr[i + 1] + arr[i]) * 0.5) * delta * 0.02
      if (arr[i + 1] > ROOM_H) arr[i + 1] -= ROOM_H

      // Toroidal wrap around the player: motes stay within a FIELD-sized box but
      // keep their true world position, so they never stick to the camera.
      if (arr[i] - cx > H) arr[i] -= FIELD
      else if (arr[i] - cx < -H) arr[i] += FIELD
      if (arr[i + 2] - cz > H) arr[i + 2] -= FIELD
      else if (arr[i + 2] - cz < -H) arr[i + 2] += FIELD
    }
    geom.attributes.position.needsUpdate = true
    // Additive motes self-glow, so in a scripted blackout they'd float as embers in
    // the pure dark — fade them with the master light level so only torch-lit air
    // (well, near-black) remains.
    mat.opacity = 0.5 * worldFx.lights

    // --- Ceiling-debris burst, triggered by the distant-bang shockwave ---
    const dpos = debrisGeom.attributes.position.array as Float32Array
    const vel = debrisVel.current
    const life = debrisLife.current
    if (worldFx.bangSeq !== lastSeq.current) {
      lastSeq.current = worldFx.bangSeq
      burstAge.current = 0
      for (let i = 0; i < DEBRIS; i++) {
        dpos[i * 3] = cx + (Math.random() - 0.5) * DEBRIS_R * 2
        dpos[i * 3 + 1] = ROOM_H - 0.15 - Math.random() * 0.35 // up near the ceiling
        dpos[i * 3 + 2] = cz + (Math.random() - 0.5) * DEBRIS_R * 2
        vel[i * 3] = (Math.random() - 0.5) * 0.3
        vel[i * 3 + 1] = -(0.3 + Math.random() * 0.9) // initial downward nudge
        vel[i * 3 + 2] = (Math.random() - 0.5) * 0.3
        life[i] = DEBRIS_LIFE * (0.6 + Math.random() * 0.4)
      }
    }
    if (burstAge.current < DEBRIS_LIFE + 0.5) {
      burstAge.current += delta
      for (let i = 0; i < DEBRIS; i++) {
        if (life[i] <= 0) continue
        vel[i * 3 + 1] -= 1.5 * delta // gravity
        dpos[i * 3] += vel[i * 3] * delta
        dpos[i * 3 + 1] += vel[i * 3 + 1] * delta
        dpos[i * 3 + 2] += vel[i * 3 + 2] * delta
        life[i] -= delta
        if (life[i] <= 0 || dpos[i * 3 + 1] < 0.03) {
          dpos[i * 3 + 1] = -100 // park it out of sight
          life[i] = 0
        }
      }
      debrisGeom.attributes.position.needsUpdate = true
      debrisMat.opacity = 0.8 * Math.max(0, 1 - burstAge.current / DEBRIS_LIFE) * worldFx.lights
    } else if (debrisMat.opacity !== 0) {
      debrisMat.opacity = 0
    }
  })

  // Anchored at the world origin and never moved — positions are true world coords.
  return (
    <>
      <points ref={ref} geometry={geom} material={mat} frustumCulled={false} />
      <points ref={debrisRef} geometry={debrisGeom} material={debrisMat} frustumCulled={false} />
    </>
  )
}
