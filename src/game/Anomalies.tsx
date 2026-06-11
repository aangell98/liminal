import { useMemo, useRef, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { World } from './maze'
import type { Hum } from './audio'
import { anomalyState, worldFx, gameState } from './retro'

// ---------------------------------------------------------------------------
// Anomaly director. On a slow random timer it fires one of several unsettling,
// deliberately-subtle events. Visual events own a mesh/state machine; audio-only
// events just poke the sound engine; the tube blackout drives shared anomalyState
// that Fixtures.tsx reads to kill one specific fluorescent.
// ---------------------------------------------------------------------------

// How long between anomalies (seconds): first one soon-ish, then spread out.
const FIRST_MIN = 7
const FIRST_RND = 8
const GAP_MIN = 20
const GAP_RND = 28

// The big "total blackout" set-piece (haunt) is the showpiece — guarantee the
// player meets it within their first session even if the weighted RNG is shy.
const HAUNT_GUARANTEE = 70 // seconds of play before we force a haunt if none yet

// Weighted menu of anomaly types.
const MENU: { type: string; w: number }[] = [
  { type: 'figure', w: 3 },
  { type: 'blackout', w: 3 },
  { type: 'shadow', w: 2 },
  { type: 'steps', w: 3 },
  { type: 'silence', w: 2 },
  { type: 'bang', w: 3 },
  { type: 'haunt', w: 4 },
]
const TOTAL_W = MENU.reduce((s, m) => s + m.w, 0)

// --- "Haunt" set-piece: blackout → footsteps everywhere → silence → the figure is
// revealed in strobing flashes, closer each time → long dark + laugh → lights back.
// Each step holds for `dur` seconds with the lights at `lit` (0/1); `fig` is the
// distance in front to reveal the figure at (null = hidden); `act` fires a sound.
type HauntStep = { dur: number; lit: number; fig: number | null; act?: 'steps' | 'silence' | 'laugh' }
const HAUNT_SEQ: HauntStep[] = [
  { dur: 2.8, lit: 0, fig: null, act: 'steps' }, // pitch black, footsteps all around
  { dur: 1.4, lit: 0, fig: null, act: 'silence' }, // ...then dead silence
  { dur: 0.45, lit: 1, fig: 13 }, // FLASH: it's there, far off
  { dur: 0.5, lit: 0, fig: null },
  { dur: 0.4, lit: 1, fig: 8 }, // FLASH: closer
  { dur: 0.5, lit: 0, fig: null },
  { dur: 0.32, lit: 1, fig: 4.2 }, // FLASH: right on top of you
  { dur: 2.0, lit: 0, fig: null, act: 'laugh' }, // long dark + a creepy laugh
  { dur: 0.4, lit: 1, fig: null }, // lights snap back — and it's gone
]

// --- Figure tuning ---
const FIG_FADE = 0.8
const FIG_HOLD = 2.6
const FIG_OPACITY = 0.7
const FIG_VANISH = 8
const FIG_DIST_MIN = 11
const FIG_DIST_RND = 6
const LOOK_COS = Math.cos(0.6) // ~34° half-angle "are you looking at it" cone

// --- Shadow-sweep tuning ---
const SHA_DUR = 1.1
const SHA_DIST = 9
const SHA_SPAN = 6 // lateral travel each way
const SHA_OPACITY = 0.6

// --- Blackout tuning ---
const BO_DIE = 0.5
const BO_DARK_MIN = 2.5
const BO_DARK_RND = 3
const BO_RECOVER = 0.5

function makeFigureTexture(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 256
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, 128, 256)
  const cx = 64

  // Gaunt, hunched, unnaturally long-limbed humanoid. Drawn twice — a heavy outer
  // haze plus a softer inner core — so it reads as an indistinct, smoky shape that
  // never quite resolves into focus. Creepier the less you can pin it down.
  const drawBody = (armW: number, legW: number) => {
    ctx.fillStyle = 'rgba(2,2,2,1)'
    ctx.strokeStyle = 'rgba(2,2,2,1)'
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.ellipse(cx + 2, 46, 9, 12, 0.08, 0, Math.PI * 2) // small head, tilted forward
    ctx.fill()
    ctx.lineWidth = 6 // long thin neck, craned forward
    ctx.beginPath()
    ctx.moveTo(cx, 56)
    ctx.lineTo(cx - 2, 74)
    ctx.stroke()
    ctx.beginPath() // narrow, hunched, elongated torso
    ctx.moveTo(cx - 14, 74)
    ctx.lineTo(cx + 14, 74)
    ctx.lineTo(cx + 9, 190)
    ctx.lineTo(cx - 9, 190)
    ctx.closePath()
    ctx.fill()
    ctx.lineWidth = armW // unnaturally long, thin arms hanging well past the hips
    ctx.beginPath()
    ctx.moveTo(cx - 13, 80)
    ctx.quadraticCurveTo(cx - 30, 132, cx - 22, 182)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(cx + 13, 80)
    ctx.quadraticCurveTo(cx + 33, 136, cx + 29, 188) // longer/asymmetric → wrong
    ctx.stroke()
    ctx.lineWidth = legW // long thin legs
    ctx.beginPath()
    ctx.moveTo(cx - 5, 188)
    ctx.lineTo(cx - 7, 252)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(cx + 5, 188)
    ctx.lineTo(cx + 8, 252)
    ctx.stroke()
  }

  ctx.filter = 'blur(10px)' // outer haze
  ctx.globalAlpha = 0.55
  drawBody(11, 13)
  ctx.filter = 'blur(5px)' // softer inner core — still never sharp
  ctx.globalAlpha = 1
  drawBody(7, 9)
  ctx.filter = 'none'
  ctx.globalAlpha = 1

  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function makeShadowTexture(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0.0, 'rgba(0,0,0,0.95)')
  g.addColorStop(0.5, 'rgba(0,0,0,0.5)')
  g.addColorStop(1.0, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export function Anomalies({ world, hum }: { world: World; hum: Hum }) {
  const figRef = useRef<THREE.Mesh>(null!)
  const shaRef = useRef<THREE.Mesh>(null!)
  const hauntRef = useRef<THREE.Mesh>(null!)

  const figTex = useMemo(() => makeFigureTexture(), [])
  const shaTex = useMemo(() => makeShadowTexture(), [])
  const figGeom = useMemo(() => new THREE.PlaneGeometry(1.4, 2.3), [])
  const shaGeom = useMemo(() => new THREE.PlaneGeometry(1.7, 2.4), [])
  const hauntGeom = useMemo(() => new THREE.PlaneGeometry(1.5, 2.4), [])
  const figMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: figTex,
        color: '#000000',
        transparent: true,
        opacity: 0,
        depthWrite: false,
        fog: false,
      }),
    [figTex],
  )
  const shaMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: shaTex,
        color: '#000000',
        transparent: true,
        opacity: 0,
        depthWrite: false,
        fog: false,
      }),
    [shaTex],
  )
  const hauntMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: figTex,
        color: '#000000',
        transparent: true,
        opacity: 0,
        depthWrite: false,
        fog: false,
      }),
    [figTex],
  )

  // Director + per-system state.
  const nextT = useRef(FIRST_MIN + Math.random() * FIRST_RND)
  const debug = useRef<string | null>(null)
  const playT = useRef(0) // accumulated seconds of actual play (for the guarantee)
  const hauntFired = useRef(false)

  const fig = useRef({ phase: 'idle' as 'idle' | 'in' | 'hold' | 'out', t: 0, escalator: false, escalated: false })
  const sha = useRef({ phase: 'idle' as 'idle' | 'sweep', t: 0 })
  const sweep = useRef({ sx: 0, sz: 0, ex: 0, ez: 0 })
  const bo = useRef({ phase: 'idle' as 'idle' | 'die' | 'dark' | 'recover', t: 0, darkLen: 0 })
  const haunt = useRef({ idx: -1, t: 0 })

  // Scratch vectors (avoid per-frame allocation).
  const fwd = useMemo(() => new THREE.Vector3(), [])
  const right = useMemo(() => new THREE.Vector3(), [])

  // Forward direction flattened to the floor plane.
  const forwardFlat = (cam: THREE.Camera) => {
    fwd.set(0, 0, -1).applyQuaternion(cam.quaternion)
    fwd.y = 0
    if (fwd.lengthSq() < 1e-5) fwd.set(0, 0, -1)
    fwd.normalize()
    return fwd
  }

  // Dev/test: keys 1-6 summon each anomaly on demand so every type can be verified
  // without waiting for the random timer. Easy to remove for the "clean" build.
  useEffect(() => {
    const map: Record<string, string> = {
      Digit1: 'figure',
      Digit2: 'shadow',
      Digit3: 'blackout',
      Digit4: 'steps',
      Digit5: 'silence',
      Digit6: 'bang',
      Digit7: 'haunt',
    }
    const onKey = (e: KeyboardEvent) => {
      const t = map[e.code]
      if (t) debug.current = t
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Optionally swap in a real figure image from public/figure.png (rendered as a
  // dark silhouette, true to the entity's look). If it's absent we keep the
  // procedural canvas silhouette. Drop your own transparent PNG in to use it.
  useEffect(() => {
    new THREE.TextureLoader().load(
      'figure.png',
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace
        figMat.map = tex
        figMat.needsUpdate = true
        hauntMat.map = tex
        hauntMat.needsUpdate = true
      },
      undefined,
      () => {
        /* no figure.png — keep the procedural silhouette */
      },
    )
  }, [figMat, hauntMat])

  function startFigure(cam: THREE.Camera) {
    forwardFlat(cam)
    const dist = FIG_DIST_MIN + Math.random() * FIG_DIST_RND
    const x = cam.position.x + fwd.x * dist
    const z = cam.position.z + fwd.z * dist
    if (world.collides(x, z)) return false
    figRef.current.position.set(x, 1.12, z)
    figMat.opacity = 0
    figRef.current.visible = true
    fig.current.phase = 'in'
    fig.current.t = 0
    fig.current.escalator = Math.random() < 0.5
    fig.current.escalated = false
    hum.phantom()
    return true
  }

  function startShadow(cam: THREE.Camera) {
    forwardFlat(cam)
    right.set(fwd.z, 0, -fwd.x) // perpendicular on the floor
    const side = Math.random() < 0.5 ? 1 : -1
    sweep.current.sx = cam.position.x + fwd.x * SHA_DIST + right.x * SHA_SPAN * side
    sweep.current.sz = cam.position.z + fwd.z * SHA_DIST + right.z * SHA_SPAN * side
    sweep.current.ex = cam.position.x + fwd.x * SHA_DIST - right.x * SHA_SPAN * side
    sweep.current.ez = cam.position.z + fwd.z * SHA_DIST - right.z * SHA_SPAN * side
    shaRef.current.position.set(sweep.current.sx, 1.15, sweep.current.sz)
    shaMat.opacity = 0
    shaRef.current.visible = true
    sha.current.phase = 'sweep'
    sha.current.t = 0
    hum.phantom()
    return true
  }

  function startBlackout(cam: THREE.Camera, px: number, pz: number) {
    if (bo.current.phase !== 'idle') return false
    forwardFlat(cam)
    const FIX = world.CELL * 2
    const OFF = world.CELL * 1.5
    const ax = px + fwd.x * 8
    const az = pz + fwd.z * 8
    anomalyState.boI = Math.round((ax - OFF) / FIX)
    anomalyState.boJ = Math.round((az - OFF) / FIX)
    anomalyState.boLevel = 1
    anomalyState.boActive = true
    bo.current.phase = 'die'
    bo.current.t = 0
    bo.current.darkLen = BO_DARK_MIN + Math.random() * BO_DARK_RND
    return true
  }

  // The far-off impact: play the boom and kick the world — every fluorescent
  // flickers (quake) and dust shakes loose from the ceiling (bangSeq edge).
  function startBang() {
    hum.distantBang()
    worldFx.quake = 1
    worldFx.bangSeq++
    return true
  }

  // Apply one step of the haunt set-piece: set the master light level, place/hide
  // the figure directly in front, fire the step's sound cue, and — on a light
  // transition — play the electrical power-down/up of the fluorescents.
  function enterHauntStep(cam: THREE.Camera, step: HauntStep, prevLit: number) {
    worldFx.lights = step.lit
    if (step.lit === 1 && prevLit === 0) hum.powerUp()
    else if (step.lit === 0 && prevLit === 1) hum.powerDown()
    if (step.fig != null) {
      forwardFlat(cam)
      const x = cam.position.x + fwd.x * step.fig
      const z = cam.position.z + fwd.z * step.fig
      hauntRef.current.position.set(x, 1.12, z)
      hauntRef.current.rotation.y = Math.atan2(cam.position.x - x, cam.position.z - z)
      hauntMat.opacity = 0.85
      hauntRef.current.visible = true
    } else {
      hauntMat.opacity = 0
      hauntRef.current.visible = false
    }
    if (step.act === 'steps') hum.stepsAllAround()
    else if (step.act === 'silence') hum.silence(1.1)
    else if (step.act === 'laugh') hum.creepyLaugh((Math.random() * 2 - 1) * 0.2)
  }

  // Kick off the blackout haunt (ignored if one is already running).
  function startHaunt(cam: THREE.Camera) {
    if (haunt.current.idx !== -1) return false
    haunt.current.idx = 0
    haunt.current.t = 0
    enterHauntStep(cam, HAUNT_SEQ[0], 1) // room was lit before this
    return true
  }

  function fire(cam: THREE.Camera, px: number, pz: number) {
    // Guarantee the player meets the total-blackout set-piece early on.
    if (!hauntFired.current && playT.current > HAUNT_GUARANTEE) {
      const ok = startHaunt(cam)
      if (ok) {
        hauntFired.current = true
        return true
      }
    }
    let r = Math.random() * TOTAL_W
    let type = MENU[0].type
    for (const m of MENU) {
      if (r < m.w) {
        type = m.type
        break
      }
      r -= m.w
    }
    switch (type) {
      case 'figure':
        if (fig.current.phase !== 'idle') return false
        return startFigure(cam)
      case 'shadow':
        if (sha.current.phase !== 'idle') return false
        return startShadow(cam)
      case 'blackout':
        return startBlackout(cam, px, pz)
      case 'steps':
        hum.stepsBehind()
        return true
      case 'silence':
        hum.silence()
        return true
      case 'bang':
        return startBang()
      case 'haunt': {
        const ok = startHaunt(cam)
        if (ok) hauntFired.current = true
        return ok
      }
    }
    return false
  }

  useFrame((state, delta) => {
    const cam = state.camera
    const px = cam.position.x
    const pz = cam.position.z

    // Anomalies only happen during play (not on the menu / while paused).
    if (!gameState.playing) return
    playT.current += delta

    // Dev hotkey: fire the requested anomaly immediately (bypasses the timer).
    if (debug.current) {
      const d = debug.current
      debug.current = null
      if (d === 'figure') {
        if (fig.current.phase === 'idle') startFigure(cam)
      } else if (d === 'shadow') {
        if (sha.current.phase === 'idle') startShadow(cam)
      } else if (d === 'blackout') {
        startBlackout(cam, px, pz)
      } else if (d === 'steps') {
        hum.stepsBehind()
      } else if (d === 'silence') {
        hum.silence()
      } else if (d === 'bang') {
        startBang()
      } else if (d === 'haunt') {
        startHaunt(cam)
      }
    }

    // --- Haunt set-piece state machine (owns worldFx.lights while it runs) ---
    const h = haunt.current
    if (h.idx >= 0) {
      const step = HAUNT_SEQ[h.idx]
      worldFx.lights = step.lit // hold the light level for this step
      h.t += delta
      if (h.t >= step.dur) {
        const prevLit = step.lit
        h.idx++
        h.t = 0
        if (h.idx >= HAUNT_SEQ.length) {
          h.idx = -1
          worldFx.lights = 1
          hauntRef.current.visible = false
          hauntMat.opacity = 0
        } else {
          enterHauntStep(cam, HAUNT_SEQ[h.idx], prevLit)
        }
      }
    }

    // Distant-bang shockwave decays over ~1.8s, driving a brief global light flicker
    // (every fluorescent AND the room fill stutter together — a power disturbance).
    if (worldFx.quake > 0) {
      worldFx.quake = Math.max(0, worldFx.quake - delta / 1.8)
      const ph = state.clock.elapsedTime * 47
      const dip = Math.sin(ph) * Math.sin(ph * 1.73)
      worldFx.flick = dip < -0.15 ? 1 - worldFx.quake * 0.85 : 1
    } else if (worldFx.flick !== 1) {
      worldFx.flick = 1
    }

    // Director: when the timer elapses, try to fire something. If it couldn't (a
    // visual system was busy / spot blocked), retry again shortly. The haunt owns
    // the screen while it runs, so don't start anything new on top of it.
    nextT.current -= delta
    if (nextT.current <= 0) {
      const ok = haunt.current.idx < 0 && fire(cam, px, pz)
      nextT.current = ok ? GAP_MIN + Math.random() * GAP_RND : 3 + Math.random() * 4
    }

    // --- Figure state machine ---
    const f = fig.current
    if (f.phase !== 'idle') {
      const m = figRef.current
      const dx = px - m.position.x
      const dz = pz - m.position.z
      m.rotation.y = Math.atan2(dx, dz)
      const distToPlayer = Math.hypot(dx, dz)

      f.t += delta
      if (f.phase === 'in') {
        figMat.opacity = Math.min(FIG_OPACITY, (f.t / FIG_FADE) * FIG_OPACITY)
        if (f.t >= FIG_FADE) {
          f.phase = 'hold'
          f.t = 0
        }
      } else if (f.phase === 'hold') {
        // Escalation: if it's an "escalator" and you look away, it relocates closer
        // so it's nearer when you look back. The classic Backrooms gut-punch.
        if (f.escalator && !f.escalated) {
          forwardFlat(cam)
          const len = Math.max(1e-3, distToPlayer)
          const looking = (-dx / len) * fwd.x + (-dz / len) * fwd.z > LOOK_COS
          if (!looking) {
            const nd = 7
            const nx = px + fwd.x * nd
            const nz = pz + fwd.z * nd
            if (!world.collides(nx, nz)) {
              m.position.set(nx, 1.12, nz)
              f.escalated = true
              f.t = 0
              hum.phantom()
            }
          }
        }
        if (f.t >= FIG_HOLD || distToPlayer < FIG_VANISH) {
          f.phase = 'out'
          f.t = 0
        }
      } else if (f.phase === 'out') {
        figMat.opacity = Math.max(0, FIG_OPACITY * (1 - f.t / FIG_FADE))
        if (f.t >= FIG_FADE) {
          f.phase = 'idle'
          m.visible = false
        }
      }
    }

    // --- Shadow sweep ---
    const s = sha.current
    if (s.phase === 'sweep') {
      s.t += delta
      const u = Math.min(1, s.t / SHA_DUR)
      const m = shaRef.current
      m.position.x = THREE.MathUtils.lerp(sweep.current.sx, sweep.current.ex, u)
      m.position.z = THREE.MathUtils.lerp(sweep.current.sz, sweep.current.ez, u)
      m.quaternion.copy(cam.quaternion)
      shaMat.opacity = Math.sin(u * Math.PI) * SHA_OPACITY
      if (u >= 1) {
        s.phase = 'idle'
        m.visible = false
      }
    }

    // --- Tube blackout ---
    const b = bo.current
    if (b.phase !== 'idle') {
      b.t += delta
      if (b.phase === 'die') {
        // Quick dying stutter as it drops to dark.
        const u = Math.min(1, b.t / BO_DIE)
        const stutter = Math.random() < 0.5 ? 1 : 0
        anomalyState.boLevel = (1 - u) * stutter
        if (b.t >= BO_DIE) {
          anomalyState.boLevel = 0
          b.phase = 'dark'
          b.t = 0
        }
      } else if (b.phase === 'dark') {
        anomalyState.boLevel = 0
        if (b.t >= b.darkLen) {
          b.phase = 'recover'
          b.t = 0
        }
      } else if (b.phase === 'recover') {
        const u = Math.min(1, b.t / BO_RECOVER)
        anomalyState.boLevel = u < 0.6 && Math.random() < 0.4 ? 0.3 : u // a flicker on its way back
        if (b.t >= BO_RECOVER) {
          anomalyState.boLevel = 1
          anomalyState.boActive = false
          b.phase = 'idle'
        }
      }
    }
  })

  return (
    <>
      <mesh ref={figRef} geometry={figGeom} material={figMat} visible={false} frustumCulled={false} />
      <mesh ref={shaRef} geometry={shaGeom} material={shaMat} visible={false} frustumCulled={false} />
      <mesh ref={hauntRef} geometry={hauntGeom} material={hauntMat} visible={false} frustumCulled={false} />
    </>
  )
}
