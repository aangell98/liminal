import { useMemo, useLayoutEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { makeWallpaper, makeCarpet, makeCeiling } from './textures'
import { worldFx } from './retro'
import type { World, Prop } from './maze'

// Streaming capacities for the visible window. (2R+1)^2 cells; wall density ~27%
// per orientation, clutter ~8%, columns ~13% of open cells, so these are oversized.
const MAX_WALLS = 900
const MAX_PROP = 90
const MAX_COL = 160

type PropType = Prop['type']
const PROP_TYPES: PropType[] = ['chairpile', 'desk', 'cabinet', 'chairs']

// --- Procedural clutter geometry (built once). Simple box assemblies that read as
// abandoned office furniture: a desk, a filing cabinet, lone chairs, a toppled pile
// of chairs, and a floor-to-ceiling support column. Each sits on the floor (y≥0),
// centred on the origin, so it can be instanced at a cell with a yaw rotation.
function box(w: number, h: number, d: number, x: number, y: number, z: number, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d)
  if (ry) g.rotateY(ry)
  g.translate(x, y, z)
  return g
}
function chairGeo(x: number, z: number, ry: number, tilt = 0) {
  const seat = box(0.46, 0.08, 0.46, 0, 0.45, 0)
  const back = box(0.46, 0.5, 0.07, 0, 0.72, -0.2)
  const g = mergeGeometries([seat, back])!
  if (tilt) g.rotateZ(tilt)
  g.rotateY(ry)
  g.translate(x, 0, z)
  return g
}
function buildPropGeometry(type: PropType): THREE.BufferGeometry {
  switch (type) {
    case 'desk': {
      const top = box(1.5, 0.07, 0.78, 0, 0.74, 0)
      const l = box(0.06, 0.72, 0.7, -0.7, 0.37, 0)
      const r = box(0.06, 0.72, 0.7, 0.7, 0.37, 0)
      const back = box(1.4, 0.5, 0.05, 0, 0.45, 0.36)
      return mergeGeometries([top, l, r, back])!
    }
    case 'cabinet': {
      const body = box(0.55, 1.45, 0.7, 0, 0.725, 0)
      const d1 = box(0.5, 0.02, 0.02, 0, 1.15, 0.36)
      const d2 = box(0.5, 0.02, 0.02, 0, 0.72, 0.36)
      const d3 = box(0.5, 0.02, 0.02, 0, 0.32, 0.36)
      return mergeGeometries([body, d1, d2, d3])!
    }
    case 'chairs':
      return mergeGeometries([chairGeo(0, 0, 0.2), chairGeo(0.15, 0.55, -1.1)])!
    case 'chairpile':
    default: {
      // A toppled heap — chairs at rising heights, rotated and tilted every which way.
      const parts: THREE.BufferGeometry[] = []
      const cfg = [
        [0, 0, 0.0, 0.0, 0.0],
        [0.18, 0.1, 0.6, 0.5, 0.35],
        [-0.12, -0.08, 1.7, 0.9, 0.6],
        [0.05, 0.2, 2.6, 0.2, 0.9],
        [-0.2, 0.12, 3.4, -0.5, 1.15],
      ]
      for (const [x, z, ry, tilt, lift] of cfg) {
        const c = chairGeo(x, z, ry, tilt)
        c.translate(0, lift, 0)
        parts.push(c)
      }
      return mergeGeometries(parts)!
    }
  }
}

export function Level0({ world }: { world: World }) {
  const { camera } = useThree()
  const wallpaper = useMemo(() => makeWallpaper(), [])
  const wallTex = useMemo(() => {
    const t = makeWallpaper()
    t.repeat.set(2, 1.3) // tile the paper a couple of times across each 5 m panel
    return t
  }, [])
  const carpet = useMemo(() => makeCarpet(), [])
  const ceiling = useMemo(() => makeCeiling(), [])

  const wallVRef = useRef<THREE.InstancedMesh>(null!)
  const wallHRef = useRef<THREE.InstancedMesh>(null!)
  const colRef = useRef<THREE.InstancedMesh>(null!)
  const propRefs = useRef<Record<PropType, THREE.InstancedMesh | null>>({
    chairpile: null,
    desk: null,
    cabinet: null,
    chairs: null,
  })
  const floorRef = useRef<THREE.Mesh>(null!)
  const ceilRef = useRef<THREE.Mesh>(null!)
  const lastCx = useRef(NaN)
  const lastCz = useRef(NaN)

  const dummy = useMemo(() => new THREE.Object3D(), [])
  const outV = useMemo(() => Array.from({ length: MAX_WALLS }, () => ({ x: 0, z: 0 })), [])
  const outH = useMemo(() => Array.from({ length: MAX_WALLS }, () => ({ x: 0, z: 0 })), [])
  const outCol = useMemo(() => Array.from({ length: MAX_COL }, () => ({ x: 0, z: 0 })), [])
  const propBuf = useMemo(() => new Array<Prop>(MAX_PROP * 3), [])

  // Wall slabs, lengthened by the thickness so corners/junctions read as solid.
  const geomV = useMemo(
    () => new THREE.BoxGeometry(world.WALL_T, world.WALL_H, world.CELL + world.WALL_T),
    [world],
  )
  const geomH = useMemo(
    () => new THREE.BoxGeometry(world.CELL + world.WALL_T, world.WALL_H, world.WALL_T),
    [world],
  )
  // Fat square support column, floor to ceiling.
  const geomCol = useMemo(
    () => new THREE.BoxGeometry(world.COL_W, world.WALL_H, world.COL_W),
    [world],
  )
  const wallMat = useMemo(
    () => new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.95, metalness: 0 }),
    [wallTex],
  )
  const furnitureMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#34322c', roughness: 0.85, metalness: 0.05 }),
    [],
  )
  const columnMat = useMemo(
    () => new THREE.MeshStandardMaterial({ map: wallpaper, roughness: 0.95, metalness: 0 }),
    [wallpaper],
  )
  const propGeoms = useMemo(() => {
    const g = {} as Record<PropType, THREE.BufferGeometry>
    for (const t of PROP_TYPES) g[t] = buildPropGeometry(t)
    return g
  }, [])

  const planeCells = (world.RENDER_RADIUS + 6) * 2
  const planeSize = planeCells * world.CELL

  useLayoutEffect(() => {
    carpet.repeat.set(planeCells, planeCells)
    ceiling.repeat.set(planeCells / 2, planeCells / 2)
  }, [carpet, ceiling, planeCells])

  useLayoutEffect(() => {
    wallVRef.current.count = 0
    wallHRef.current.count = 0
    colRef.current.count = 0
    for (const t of PROP_TYPES) {
      const m = propRefs.current[t]
      if (m) m.count = 0
    }
  }, [])

  useFrame(() => {
    const px = camera.position.x
    const pz = camera.position.z

    // Snap the ground/ceiling planes to their own texture period (no visible drift).
    const fp = world.CELL
    const cp = world.CELL * 2
    floorRef.current.position.set(Math.round(px / fp) * fp, 0, Math.round(pz / fp) * fp)
    ceilRef.current.position.set(Math.round(px / cp) * cp, world.WALL_H, Math.round(pz / cp) * cp)
    ;(ceilRef.current.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.05 * worldFx.lights

    // Re-stream walls + clutter only when the player crosses into a new cell.
    const cx = world.worldToCell(px)
    const cz = world.worldToCell(pz)
    if (cx === lastCx.current && cz === lastCz.current) return
    lastCx.current = cx
    lastCz.current = cz

    const { nv, nh } = world.wallsAround(cx, cz, outV, outH)
    const mv = wallVRef.current
    for (let i = 0; i < nv; i++) {
      dummy.position.set(outV[i].x, world.WALL_H / 2, outV[i].z)
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      mv.setMatrixAt(i, dummy.matrix)
    }
    mv.count = nv
    mv.instanceMatrix.needsUpdate = true

    const mh = wallHRef.current
    for (let i = 0; i < nh; i++) {
      dummy.position.set(outH[i].x, world.WALL_H / 2, outH[i].z)
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      mh.setMatrixAt(i, dummy.matrix)
    }
    mh.count = nh
    mh.instanceMatrix.needsUpdate = true

    // Support columns (solid, floor-to-ceiling).
    const ncol = world.columnsAround(cx, cz, outCol)
    const mc = colRef.current
    for (let i = 0; i < ncol; i++) {
      dummy.position.set(outCol[i].x, world.WALL_H / 2, outCol[i].z)
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      mc.setMatrixAt(i, dummy.matrix)
    }
    mc.count = ncol
    mc.instanceMatrix.needsUpdate = true

    // Bucket clutter by type into its instanced mesh.
    const np = world.propsAround(cx, cz, propBuf)
    const counts: Record<PropType, number> = { chairpile: 0, desk: 0, cabinet: 0, chairs: 0 }
    for (let i = 0; i < np; i++) {
      const p = propBuf[i]
      const m = propRefs.current[p.type]
      if (!m) continue
      const c = counts[p.type]
      if (c >= MAX_PROP) continue
      dummy.position.set(p.x, 0, p.z)
      dummy.rotation.set(0, p.rot, 0)
      dummy.updateMatrix()
      m.setMatrixAt(c, dummy.matrix)
      counts[p.type] = c + 1
    }
    for (const t of PROP_TYPES) {
      const m = propRefs.current[t]
      if (!m) continue
      m.count = counts[t]
      m.instanceMatrix.needsUpdate = true
    }
  })

  return (
    <group>
      <mesh ref={floorRef} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[planeSize, planeSize]} />
        <meshStandardMaterial map={carpet} roughness={1} metalness={0} />
      </mesh>
      <mesh ref={ceilRef} rotation-x={Math.PI / 2}>
        <planeGeometry args={[planeSize, planeSize]} />
        <meshStandardMaterial
          map={ceiling}
          emissive={'#fff3cf'}
          emissiveIntensity={0.05}
          roughness={1}
          metalness={0}
        />
      </mesh>

      <instancedMesh ref={wallVRef} args={[geomV, wallMat, MAX_WALLS]} frustumCulled={false} castShadow={false} />
      <instancedMesh ref={wallHRef} args={[geomH, wallMat, MAX_WALLS]} frustumCulled={false} castShadow={false} />
      <instancedMesh ref={colRef} args={[geomCol, columnMat, MAX_COL]} frustumCulled={false} castShadow={false} />

      {PROP_TYPES.map((t) => (
        <instancedMesh
          key={t}
          ref={(m) => {
            propRefs.current[t] = m
          }}
          args={[propGeoms[t], furnitureMat, MAX_PROP]}
          frustumCulled={false}
        />
      ))}
    </group>
  )
}
