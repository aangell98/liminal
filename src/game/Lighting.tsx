import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { worldFx } from './retro'

// Full, even Backrooms fill light — deliberately bright and near-shadowless, true
// to the source material. The steady look comes from a flat ambient + hemisphere
// fill; per-tube flicker lives on the fixtures (Fixtures.tsx). This rig also reacts
// to two events: a distant-bang strobe (worldFx.flick) dips the fill briefly, and a
// scripted blackout (worldFx.lights→0) kills the fill AND fades the fog/background
// to black so the whole level really goes dark, then snaps back.
const AMBIENT = 0.85
const HEMI = 0.6

export function Lighting() {
  const { scene } = useThree()
  const amb = useRef<THREE.AmbientLight>(null!)
  const hemi = useRef<THREE.HemisphereLight>(null!)
  const baseBg = useRef<THREE.Color | null>(null)
  const baseFog = useRef<THREE.Color | null>(null)

  useFrame(() => {
    const lights = worldFx.lights // 1 normal, 0 during a scripted blackout
    // flick is 1 almost always; only a bang briefly drives it down. Keep a floor so
    // the strobe lurches darker without going pitch black — but a real blackout
    // (lights→0) overrides that and goes fully dark.
    const f = Math.max(0.25, worldFx.flick) * lights
    if (amb.current) amb.current.intensity = AMBIENT * f
    if (hemi.current) hemi.current.intensity = HEMI * f

    // Fade the fog + background toward black during a blackout (so distant haze and
    // the clear colour don't stay lit olive while everything else is dark).
    const bg = scene.background as THREE.Color | null
    if (bg && (bg as THREE.Color).isColor) {
      if (!baseBg.current) baseBg.current = bg.clone()
      bg.copy(baseBg.current).multiplyScalar(lights)
    }
    const fog = scene.fog as THREE.FogExp2 | null
    if (fog) {
      if (!baseFog.current) baseFog.current = fog.color.clone()
      fog.color.copy(baseFog.current).multiplyScalar(lights)
    }
  })

  return (
    <>
      <ambientLight ref={amb} intensity={AMBIENT} color="#fff3cf" />
      <hemisphereLight ref={hemi} args={['#fff3cf', '#2e2a10', HEMI]} />
    </>
  )
}
