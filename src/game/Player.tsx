import { useRef, useEffect, useMemo } from 'react'
import type { MutableRefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { World } from './maze'
import type { Hum } from './audio'
import { cameraMotion, cameraFx, hudState, lightFx, worldFx, playerState, playerControl, deathCam, DEATH_FALL, gameState, huntFx, touchInput } from './retro'

const EYE = 1.6
const SENS = 0.0022

// Shortest-path angular lerp (handles the ±π wrap) — used to swing the view onto
// the entity during the death "grab" without spinning the long way round.
function angleLerp(a: number, b: number, t: number): number {
  const d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI
  return a + d * t
}

export function Player({
  world,
  hum,
  lockRef,
  onLock,
  onUnlock,
}: {
  world: World
  hum: Hum
  lockRef: MutableRefObject<{ lock: () => void } | null>
  onLock: () => void
  onUnlock: () => void
}) {
  const { camera, gl } = useThree()
  const keys = useRef({ f: false, b: false, l: false, r: false, sprint: false, creep: false })
  const light = useRef<THREE.PointLight>(null!)

  const yaw = useRef(0)
  const pitch = useRef(0)
  const prevYaw = useRef(0)
  const prevPitch = useRef(0)
  const vel = useRef({ x: 0, y: 0 })
  const pos = useRef({ x: world.spawn.x, z: world.spawn.z })
  const bobT = useRef(0)
  const prevStep = useRef(0)
  const euler = useMemo(() => new THREE.Euler(0, 0, 0, 'YXZ'), [])
  const huntTimer = useRef(6 + Math.random() * 8)
  const hunt = useRef(0)
  const lastRespawn = useRef(0)
  const deathT = useRef(0) // clock within the current death beat (grab/fall/down)
  const lastDeathPhase = useRef<string>('none')

  // Keep latest lock callbacks in refs so the pointer-lock effect can stay stable.
  const onLockRef = useRef(onLock)
  const onUnlockRef = useRef(onUnlock)
  onLockRef.current = onLock
  onUnlockRef.current = onUnlock

  // Custom pointer lock + mouse look. Replaces drei PointerLockControls so the
  // hand-held sway can be layered on top of the aim without fighting it.
  useEffect(() => {
    const el = gl.domElement
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== el) return
      // Lock the look during the catch→respawn (frozen): the death camera owns the
      // view, so mouse movement must not fight it.
      if (playerControl.frozen) return
      yaw.current -= e.movementX * SENS
      pitch.current -= e.movementY * SENS
      pitch.current = Math.max(-1.5, Math.min(1.5, pitch.current))
    }
    const onChange = () => {
      if (document.pointerLockElement === el) onLockRef.current()
      else onUnlockRef.current()
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('pointerlockchange', onChange)
    lockRef.current = { lock: () => el.requestPointerLock() }
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('pointerlockchange', onChange)
    }
  }, [gl, lockRef])

  useEffect(() => {
    const set = (e: KeyboardEvent, v: boolean) => {
      switch (e.code) {
        case 'KeyW': case 'ArrowUp': keys.current.f = v; break
        case 'KeyS': case 'ArrowDown': keys.current.b = v; break
        case 'KeyA': case 'ArrowLeft': keys.current.l = v; break
        case 'KeyD': case 'ArrowRight': keys.current.r = v; break
        case 'ShiftLeft': case 'ShiftRight': keys.current.sprint = v; break
        case 'KeyC': keys.current.creep = v; break
      }
    }
    const down = (e: KeyboardEvent) => set(e, true)
    const up = (e: KeyboardEvent) => set(e, false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  useFrame((state, delta) => {
    const k = keys.current

    // Before "Entrar" (or while paused) the scene is a still life: hold the camera
    // dead still at the spawn so the menu reads as a static, untouched recording.
    if (!gameState.playing && !deathCam.active && deathCam.phase === 'none') {
      camera.position.set(pos.current.x, EYE, pos.current.z)
      euler.set(0, yaw.current, 0)
      camera.quaternion.setFromEuler(euler)
      if (light.current) {
        light.current.position.copy(camera.position)
        light.current.intensity = 10 + (1 - worldFx.lights) * 30
      }
      playerState.moving = false
      playerState.sprint = false
      return
    }

    // Respawn ("the tape cuts and we're somewhere else"): the death director bumps
    // respawnSeq with new coords; snap there, clear momentum and level the horizon so
    // the camera powers back up looking straight ahead (no leftover death tilt).
    if (playerControl.respawnSeq !== lastRespawn.current) {
      lastRespawn.current = playerControl.respawnSeq
      pos.current.x = playerControl.x
      pos.current.z = playerControl.z
      pitch.current = 0
    }

    // Found-footage death, in three beats driven by the entity via deathCam.phase:
    //  • grab — the rig is wrenched round to FRAME the entity (a forced, shaking look
    //           at the thing) under the loud stinger.
    //  • fall — the camcorder is dropped: it accelerates to the floor and tips onto
    //           its side.
    //  • down — it lies on the carpet, settling, until the signal cuts to static.
    if (deathCam.phase !== 'none') {
      if (deathCam.phase !== lastDeathPhase.current) {
        lastDeathPhase.current = deathCam.phase
        deathT.current = 0
      }
      deathT.current += delta
      const dpt = deathT.current
      const yFloor = 0.2

      if (deathCam.phase === 'grab') {
        // Swing yaw/pitch onto the entity and shake hard at the moment of the grab.
        const ddx = deathCam.ex - pos.current.x
        const ddz = deathCam.ez - pos.current.z
        const dd = Math.hypot(ddx, ddz) || 1
        const tYaw = Math.atan2(-ddx, -ddz)
        const tPitch = Math.max(-0.4, Math.min(0.5, Math.atan2(deathCam.ey - EYE, dd)))
        const kf = Math.min(1, delta * 9)
        yaw.current = angleLerp(yaw.current, tYaw, kf)
        pitch.current = THREE.MathUtils.lerp(pitch.current, tPitch, kf)
        const jolt = Math.exp(-dpt * 4) // violent at first, settling as it holds
        const sh = 0.05 + jolt * 0.11
        euler.set(
          pitch.current + (Math.random() - 0.5) * sh,
          yaw.current + (Math.random() - 0.5) * sh,
          (Math.random() - 0.5) * sh * 0.6,
        )
        camera.quaternion.setFromEuler(euler)
        camera.position.set(pos.current.x, EYE - jolt * 0.12, pos.current.z)
      } else if (deathCam.phase === 'fall') {
        const p = Math.min(1, dpt / DEATH_FALL)
        const pe = p * p // accelerate like gravity
        const y = THREE.MathUtils.lerp(EYE, yFloor, pe)
        const roll = deathCam.dir * THREE.MathUtils.lerp(0, 1.5, pe) // tip onto its side
        const pitchFall = THREE.MathUtils.lerp(pitch.current, -0.1, pe)
        const sh = (1 - p) * 0.035
        euler.set(pitchFall + (Math.random() - 0.5) * sh, yaw.current + (Math.random() - 0.5) * sh, roll)
        camera.quaternion.setFromEuler(euler)
        camera.position.set(pos.current.x, Math.max(yFloor, y), pos.current.z)
        pitch.current = pitchFall // carry the final tilt into the resting shot
      } else {
        // down: a small damped bounce as it comes to rest on its side.
        const y = yFloor + Math.sin(dpt * 22) * Math.exp(-dpt * 8) * 0.05
        euler.set(-0.1, yaw.current, deathCam.dir * 1.5)
        camera.quaternion.setFromEuler(euler)
        camera.position.set(pos.current.x, Math.max(yFloor, y), pos.current.z)
      }

      if (light.current) {
        light.current.position.copy(camera.position)
        light.current.intensity = 10 + (1 - worldFx.lights) * 30
      }
      return
    }
    lastDeathPhase.current = 'none'

    // Touch look: fold the accumulated drag deltas into yaw/pitch, then clear them.
    // Done before the movement basis is computed so walking tracks the new heading.
    if (touchInput.active && !playerControl.frozen) {
      yaw.current -= touchInput.lookDX * SENS
      pitch.current -= touchInput.lookDY * SENS
      pitch.current = Math.max(-1.5, Math.min(1.5, pitch.current))
      touchInput.lookDX = 0
      touchInput.lookDY = 0
      keys.current.sprint = touchInput.sprint
      keys.current.creep = touchInput.creep
    }

    const sinY = Math.sin(yaw.current)
    const cosY = Math.cos(yaw.current)

    // Movement derives from yaw only, so sway/pitch never affect where you walk.
    let mx = 0
    let mz = 0
    if (k.f) { mx += -sinY; mz += -cosY }
    if (k.b) { mx += sinY; mz += cosY }
    if (k.r) { mx += cosY; mz += -sinY }
    if (k.l) { mx += -cosY; mz += sinY }
    // Touch joystick: analog forward/strafe folded into the same movement basis.
    if (touchInput.active && (touchInput.mvX !== 0 || touchInput.mvY !== 0)) {
      mx += -sinY * touchInput.mvY + cosY * touchInput.mvX
      mz += -cosY * touchInput.mvY - sinY * touchInput.mvX
    }
    // During the signal-loss sequence the player is frozen (no input).
    const frozen = playerControl.frozen
    const moving = !frozen && (mx !== 0 || mz !== 0)
    if (moving) {
      const len = Math.hypot(mx, mz)
      mx /= len
      mz /= len
    }

    // Creep (Ctrl) overrides sprint: a slow, near-silent prowl. The entity hunts by
    // sound, so moving slow is how the intruder buys time and stays hidden — though it
    // only ever delays the inevitable.
    const creep = k.creep && !k.sprint
    const speed = creep ? 1.25 : k.sprint ? 4.6 : 2.7
    const step = moving ? speed * delta : 0
    const prevX = pos.current.x
    const prevZ = pos.current.z
    const nx = pos.current.x + mx * step
    const nz = pos.current.z + mz * step
    if (!world.collides(nx, pos.current.z)) pos.current.x = nx
    if (!world.collides(pos.current.x, nz)) pos.current.z = nz

    // How much noise the intruder is making (0..1) — what the entity can hear. Still =
    // silent, creep = near-silent, walk = moderate, sprint = loud. Scraping a wall
    // (blocked movement) spikes it: clumsy = heard.
    let noise = 0
    if (moving) noise = creep ? 0.12 : k.sprint ? 1.0 : 0.5
    const movedDist = Math.hypot(pos.current.x - prevX, pos.current.z - prevZ)
    if (moving && movedDist < step * 0.5) noise = Math.max(noise, creep ? 0.3 : 0.75)

    // Publish live state for the entity's perception + the catch test.
    playerState.x = pos.current.x
    playerState.z = pos.current.z
    playerState.moving = moving
    playerState.sprint = k.sprint && moving && !creep
    playerState.creep = creep && moving
    playerState.noise = noise

    // Hand-held camera: constant breathing sway, amplified a bit while walking.
    const t = state.clock.elapsedTime
    const amp = moving ? 2.8 : 1.0
    const sYaw = (Math.sin(t * 1.1) * 0.005 + Math.sin(t * 0.37) * 0.0035) * amp
    const sPitch = (Math.sin(t * 1.7) * 0.004 + Math.sin(t * 0.23) * 0.003) * amp
    const sRoll = Math.sin(t * 0.8) * 0.009 * amp
    const swayX = Math.sin(t * 1.3) * 0.02 * amp
    const swayY = Math.sin(t * 2.1) * 0.016 * amp

    // Hunt unease: a chase gets a panicked-but-comfortable treatment — a tunnel-vision
    // vignette (in the VHS pass), a gentle FOV creep, and a LIGHT camera tremor. The
    // tremor is deliberately low-frequency (a tense, heavy-breathing wobble, ~0.7–1.3
    // Hz) and small in amplitude: the old version's fast high-frequency jitter was
    // what caused motion sickness, so this reads as adrenaline without the nausea.
    const panic = huntFx.level
    let pYaw = 0
    let pPitch = 0
    let pRoll = 0
    if (panic > 0.001) {
      pYaw = Math.sin(t * 6.1) * panic * 0.006
      pPitch = (Math.sin(t * 8.0) * 0.004 + Math.sin(t * 4.3) * 0.004) * panic
      pRoll = Math.sin(t * 5.0) * panic * 0.007
    }
    const targetFov = 75 + panic * 5
    const pcam = camera as THREE.PerspectiveCamera
    if (Math.abs(pcam.fov - targetFov) > 0.05) {
      pcam.fov += (targetFov - pcam.fov) * Math.min(1, delta * 3)
      pcam.updateProjectionMatrix()
    }

    bobT.current += delta * (k.sprint ? 11 : creep ? 5 : 8) * (moving ? 1 : 0)
    const bob = moving ? Math.sin(bobT.current) * (creep ? 0.045 : 0.075) : 0

    // Footstep on each head-bob dip (so steps stay in sync with the visible bob).
    if (moving) {
      const stepIdx = Math.floor(bobT.current / Math.PI)
      if (stepIdx !== prevStep.current) {
        prevStep.current = stepIdx
        hum.footstep(creep ? 0.3 : k.sprint ? 1.0 : 0.78)
      }
    }

    euler.set(pitch.current + sPitch + pPitch, yaw.current + sYaw + pYaw, sRoll + pRoll)
    camera.quaternion.setFromEuler(euler)
    camera.position.set(pos.current.x, EYE + bob, pos.current.z)
    camera.translateX(swayX)
    camera.translateY(swayY)

    if (light.current) {
      light.current.position.copy(camera.position)
      // Your camcorder lamp: a subtle warm glow normally, but it becomes a real,
      // brighter flashlight when the room blacks out (the only thing you can see by).
      light.current.intensity = 10 + (1 - worldFx.lights) * 30
    }

    // Camera angular velocity → motion blur (consumed by the VHS effect).
    const dYaw = yaw.current - prevYaw.current
    const dPitch = pitch.current - prevPitch.current
    prevYaw.current = yaw.current
    prevPitch.current = pitch.current
    vel.current.x += (dYaw - vel.current.x) * 0.4
    vel.current.y += (dPitch - vel.current.y) * 0.4
    cameraMotion.x = vel.current.x
    cameraMotion.y = vel.current.y * 0.45

    // Auto-gain: lift the exposure a touch when the fluorescents dim or stutter.
    // Reacts to the actual light level, NOT to head pitch — looking up/down no
    // longer pumps the brightness (that pumping was causing motion sickness).
    const targetExp = THREE.MathUtils.lerp(1.18, 1.0, lightFx.level)
    gl.toneMappingExposure += (targetExp - gl.toneMappingExposure) * Math.min(1, delta * 2.5)
    cameraFx.exposure = gl.toneMappingExposure

    // Occasional autofocus hunt (a brief focus blur) + LOW LIGHT signal for the HUD.
    huntTimer.current -= delta
    if (huntTimer.current <= 0 && hunt.current <= 0) {
      hunt.current = 0.7
      huntTimer.current = 9 + Math.random() * 9
    }
    if (hunt.current > 0) {
      hunt.current -= delta
      cameraFx.focus = Math.sin((1 - hunt.current / 0.7) * Math.PI)
    } else {
      cameraFx.focus = 0
    }
    hudState.lowLight = lightFx.level < 0.72
  })

  // A soft warm light rides with the camera, like a camcorder lamp: nearby walls
  // glow yellow as you approach (sells the found-footage/VHS feel). It lights
  // SURFACES only — it never moves the ceiling fixtures (those are fixed geometry,
  // and their halos no longer billboard, so nothing appears to drift or rotate).
  return <pointLight ref={light} intensity={10} distance={13} decay={2} color="#ffe7a6" />
}
