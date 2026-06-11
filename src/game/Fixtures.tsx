import { useMemo, useRef, useLayoutEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { World } from './maze'
import type { Hum } from './audio'
import { anomalyState, worldFx, lightFx, entityState } from './retro'

// Fluorescent fixtures on a regular ceiling grid: every grid point gets a small
// rectangular emissive panel plus a soft downward glow halo (both instanced).
// Each tube flickers INDEPENDENTLY (random per fixture). There are no movable
// lights — the scene is lit by the flat ambient fill — so nothing ever appears to
// shift position. The grid window reaches well past the fog so tubes never pop in.
const FIX_R = 5 // fixtures instanced within this many grid steps (≈50u, beyond fog)
const MAX_FIX = (FIX_R * 2 + 1) ** 2
const PANEL_DROP = 0.06
const GLOW_DROP = 0.25
const EMISSIVE_BASE = 1.3
const BUZZ_RANGE = 12 // how close a failing tube must be to be heard

// Deterministic 0..1 hash per ceiling grid cell, so a tube's flicker timing is
// pinned to its world position and independent of every other tube.
function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h = h ^ (h >>> 16)
  return (h >>> 0) / 4294967295
}

// Per-tube flicker level (0..1). Most tubes burn perfectly steady; ~12% are "bad"
// and stutter in brief, occasional bursts on their own random rhythm — so you'll
// usually catch one or two misbehaving somewhere without it being chaotic.
function tubeFlicker(i: number, j: number, t: number): number {
  const h = hash2(i, j)
  if (h < 0.12) {
    const ph = h * 130.0
    const gate = Math.sin(t * (0.35 + h * 0.7) + ph)
    if (gate > 0.74) {
      const s = Math.sin(t * 34.0 + ph) * Math.sin(t * 19.0 + ph * 1.3)
      return s > 0.0 ? 1.0 : 0.28 // rapid stutter only while the window is open
    }
  }
  return 1.0 // everything else: rock steady
}

export function Fixtures({ world, hum }: { world: World; hum: Hum }) {
  const meshRef = useRef<THREE.InstancedMesh>(null!)
  const glowRef = useRef<THREE.InstancedMesh>(null!)
  const lastGi = useRef(NaN)
  const lastGj = useRef(NaN)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const glowColor = useMemo(() => new THREE.Color(), [])

  // World-grid coords behind each instance slot, so each panel's flicker tracks
  // its tube even as slots are recycled while streaming.
  const fixI = useMemo(() => new Int32Array(MAX_FIX), [])
  const fixJ = useMemo(() => new Int32Array(MAX_FIX), [])
  const fixCount = useRef(0)
  // Throttle for the electrical zap crackles fired by entity-driven flicker.
  const zapCd = useRef(0)
  const fwdVec = useMemo(() => new THREE.Vector3(), [])

  // Per-instance flicker, fed into the emissive term via onBeforeCompile.
  const flickerAttr = useMemo(() => {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(MAX_FIX).fill(1), 1)
    a.setUsage(THREE.DynamicDrawUsage)
    return a
  }, [])

  const geom = useMemo(() => {
    const g = new THREE.BoxGeometry(2.8, 0.06, 0.9)
    g.setAttribute('aFlicker', flickerAttr)
    return g
  }, [flickerAttr])

  const mat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      color: '#100d05',
      emissive: '#fff6e2',
      emissiveIntensity: EMISSIVE_BASE,
      roughness: 1,
      metalness: 0,
    })
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute float aFlicker;\nvarying float vFlicker;',
        )
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vFlicker = aFlicker;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vFlicker;')
        .replace(
          'vec3 totalEmissiveRadiance = emissive;',
          'vec3 totalEmissiveRadiance = emissive * vFlicker;',
        )
    }
    return m
  }, [])

  // Soft additive halo under each tube — a flat horizontal pad that glows straight
  // down (fixed orientation, never billboards) so the fixtures never appear to spin.
  // Real geometry, not a screen-space sample, so it stays steady — no shimmer.
  const glowTex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = c.height = 128
    const ctx = c.getContext('2d')!
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
    g.addColorStop(0.0, 'rgba(255,244,214,0.9)')
    g.addColorStop(0.35, 'rgba(255,240,200,0.32)')
    g.addColorStop(1.0, 'rgba(255,235,190,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 128, 128)
    const tx = new THREE.CanvasTexture(c)
    tx.colorSpace = THREE.SRGBColorSpace
    return tx
  }, [])
  const glowGeom = useMemo(() => new THREE.PlaneGeometry(4.4, 2.6), [])
  const glowMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: glowTex,
        color: '#fff0d0',
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      }),
    [glowTex],
  )

  useLayoutEffect(() => {
    meshRef.current.count = 0
    glowRef.current.count = 0
  }, [])

  useFrame((state, delta) => {
    const px = state.camera.position.x
    const pz = state.camera.position.z
    // Lock the fixture grid to the maze: pillars sit on the even-cell lattice, so a
    // spacing of 2 cells offset by 1.5 cells centres each tube on the open
    // intersection between four pillars.
    const FIX = world.CELL * 2
    const OFF = world.CELL * 1.5
    const gi = Math.round((px - OFF) / FIX)
    const gj = Math.round((pz - OFF) / FIX)
    const ceilY = world.WALL_H
    const t = state.clock.elapsedTime

    // Re-stream the emissive panels only when the player crosses into a new cell.
    if (gi !== lastGi.current || gj !== lastGj.current) {
      lastGi.current = gi
      lastGj.current = gj
      const m = meshRef.current
      let n = 0
      for (let i = gi - FIX_R; i <= gi + FIX_R; i++) {
        for (let j = gj - FIX_R; j <= gj + FIX_R; j++) {
          dummy.position.set(i * FIX + OFF, ceilY - PANEL_DROP, j * FIX + OFF)
          dummy.rotation.set(0, 0, 0)
          dummy.scale.set(1, 1, 1)
          dummy.updateMatrix()
          m.setMatrixAt(n, dummy.matrix)
          fixI[n] = i
          fixJ[n] = j
          n++
        }
      }
      m.count = n
      fixCount.current = n
      m.instanceMatrix.needsUpdate = true
    }

    // Per-tube flicker every frame: emissive panels (via instance attribute) and the
    // matching glow halos. A blackout anomaly can force one specific tube dark.
    const bo = anomalyState
    const blackout = (i: number, j: number) =>
      bo.boActive && i === bo.boI && j === bo.boJ ? bo.boLevel : 1

    // Distant-bang shockwave + scripted blackout: while a quake is hot, EVERY tube
    // stutters together (worldFx.flick); a haunt blackout (worldFx.lights→0) kills
    // every tube outright. The camera's auto-gain reacts via lightFx.level.
    const quakeFlick = worldFx.flick * worldFx.lights
    lightFx.level = quakeFlick

    const arr = flickerAttr.array as Float32Array
    const n = fixCount.current
    // The entity radiates a disturbance: every tube within a tight radius of it HARD
    // blinks fully on/off (not a gentle dim) — a violent, unmistakable strobe that
    // marks exactly where it is. A diegetic tell: the lights gut out where it prowls.
    const eAura = entityState.active ? entityState.aura : 0
    const eax = entityState.x
    const eaz = entityState.z
    // Strongest entity-driven flicker felt near the player this frame, used to gate the
    // buzz and the electrical crackles (which are panned toward the entity itself).
    let eNear = 0
    for (let s = 0; s < n; s++) {
      let v = tubeFlicker(fixI[s], fixJ[s], t) * blackout(fixI[s], fixJ[s]) * quakeFlick
      if (eAura > 0.01) {
        const fx = fixI[s] * FIX + OFF
        const fz = fixJ[s] * FIX + OFF
        const intensity = Math.max(0, 1 - Math.hypot(fx - eax, fz - eaz) / 10) * eAura
        if (intensity > 0.001) {
          // Reuse the tube's own rapid-stutter waveform, but force a FULL on/off toggle:
          // k reaches 1 well before intensity maxes out, so tubes near it blink hard to
          // black, not merely dim. The lights literally cut out and snap back.
          const ph = hash2(fixI[s], fixJ[s]) * 130.0
          const stut = Math.sin(t * 34.0 + ph) * Math.sin(t * 19.0 + ph * 1.3)
          const flick = stut > 0.0 ? 1.0 : 0.0
          const k = Math.min(1, intensity * 2.4)
          v *= 1 - k * (1 - flick)
          const pNear = intensity * Math.max(0, 1 - Math.hypot(fx - px, fz - pz) / BUZZ_RANGE)
          if (pNear > eNear) eNear = pNear
        }
      }
      arr[s] = v
    }
    flickerAttr.needsUpdate = true

    const gm = glowRef.current
    for (let s = 0; s < n; s++) {
      const fx = fixI[s] * FIX + OFF
      const fz = fixJ[s] * FIX + OFF
      dummy.position.set(fx, ceilY - GLOW_DROP, fz)
      dummy.rotation.set(Math.PI / 2, 0, 0) // flat under the tube, glowing straight down — fixed, never rotates
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      gm.setMatrixAt(s, dummy.matrix)
      // Fog is off for the additive halos, so fade them out by distance instead —
      // distant tubes contribute no glow (no pop-in at the streaming edge).
      const dist = Math.hypot(px - fx, pz - fz)
      const fade = Math.max(0, Math.min(1, 1 - (dist - 16) / 16))
      gm.setColorAt(s, glowColor.setScalar(arr[s] * fade))
    }
    gm.count = n
    gm.instanceMatrix.needsUpdate = true
    if (gm.instanceColor) gm.instanceColor.needsUpdate = true

    // A failing tube near the player sizzles; closer + more dipped = louder. The
    // blackout tube counts too, so its death audibly buzzes out.
    let buzz = 0
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const f = tubeFlicker(gi + di, gj + dj, t) * blackout(gi + di, gj + dj)
        if (f >= 0.999) continue
        const fx = (gi + di) * FIX + OFF
        const fz = (gj + dj) * FIX + OFF
        const prox = Math.max(0, 1 - Math.hypot(px - fx, pz - fz) / BUZZ_RANGE)
        buzz = Math.max(buzz, (1 - f) * prox)
      }
    }
    // The entity's convulsing lights drive that sizzle harder, and on top of the
    // steady buzz they throw sharp electrical crackles — panned toward the failing
    // tube — at a rate that climbs the closer/stronger its presence is.
    hum.setBuzz(Math.max(buzz, eNear))
    zapCd.current -= delta
    if (eNear > 0.06 && zapCd.current <= 0) {
      fwdVec.set(0, 0, -1).applyQuaternion(state.camera.quaternion)
      const fl = Math.hypot(fwdVec.x, fwdVec.z) || 1
      const fwx = fwdVec.x / fl
      const fwz = fwdVec.z / fl
      const dx = eax - px
      const dz = eaz - pz
      const dl = Math.hypot(dx, dz) || 1
      const pan = Math.max(-1, Math.min(1, (dx / dl) * fwz + (dz / dl) * -fwx))
      hum.flickerZap(pan, 0.2 + eNear * 0.6)
      zapCd.current = 0.05 + Math.random() * 0.28 * (1 - eNear)
    }
  })

  return (
    <>
      <instancedMesh ref={meshRef} args={[geom, mat, MAX_FIX]} frustumCulled={false} />
      <instancedMesh ref={glowRef} args={[glowGeom, glowMat, MAX_FIX]} frustumCulled={false} />
    </>
  )
}
